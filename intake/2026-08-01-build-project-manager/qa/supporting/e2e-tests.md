# E2E / API-Contract Test Plan — build-project-manager (layers 4–6)

> Authored by `qa-e2e-architect`. Designs the thin, wired-up-flow layer over
> the unit tests the technical plan already directs in its own §6. Does not
> re-litigate every permutation the unit layer owns — see "Cost note" at the
> end for the explicit hand-off boundary.

## 0. Tooling grounding (confirmed against live code, not assumed)

This repo has **no separate e2e framework** — no Cypress, no Playwright, no
tagged smoke/regression suites, no bucket config file. Confirmed by:

- `package.json`: `"test:server": "node --test server/__tests__/*.test.js"` —
  a single flat glob over `node:test` spec files. There is no `test:e2e`
  script and no `--grep`/tag convention anywhere in `package.json` or
  `PROJECT-CONTEXT.md`.
- `server/__tests__/plans-api.test.js` — the API-contract pattern: each spec
  file sets `process.env.DASHBOARD_DB_PATH` to a unique temp file **before**
  `require("../db")`, then `require("../index")` for `createApp`/`startServer`,
  starts a real Express server on port `0` (OS-assigned), and drives it with a
  hand-rolled `http.request` `fetch()` helper (no supertest, no axios). Cleans
  up its own DB file + `-wal`/`-shm` and any temp cwd in `after()`.
- `server/__tests__/ccam-cli.test.js` — the CLI-contract pattern: spawns the
  real `bin/ccam.js` **asynchronously** (`child_process.spawn`, never
  `spawnSync` — the test server lives in the same process, so a sync spawn
  would deadlock) against the same in-test server via the `DASHBOARD_PORT` env
  override, and asserts on stdout/stderr/exit code. `focus done`/`focus set`
  and `alerts ack-all`/`pricing set` are the direct precedents for the two new
  commands this effort adds.
- `server/__tests__/focus-audit.test.js` and `focus-summary.test.js` — the
  scheduler/LLM-classification pattern: the module exports its own trigger
  function (`auditSession`) and a spawn-injection seam
  (`__injectSpawnForTest`) so tests call the tick logic directly and stub only
  the outermost `claude -p` process, never a real filesystem race or a real
  wall-clock timer. The technical plan (`§4 step 23(e)`, `§6`) commits
  `reconciliation.js` to the identical shape (`reconcileCwd` exported,
  `startReconciliation` wraps a real `setInterval` that tests never wait on).
- `server/__tests__/plan-ingest.test.js` — the real-file-fixture pattern:
  `writePlan(text)` writes into a `fs.mkdtempSync(os.tmpdir())` working
  directory (git-free by construction — `os.tmpdir()` is never inside this
  repo's tree) and every ingest assertion re-reads the real file, never a
  mocked parse.
- `import-correctness.test.js` / `workflow-ingest.test.js` — precedent for a
  spec file that spans **multiple libs + the real DB** in one file when the
  thing under test is a pipeline, not a single module. This is the template
  for the one new full-chain file below.

**Conclusion for "bucket"/"tag":** this project's only bucketing unit is *the
spec file itself* — `node --test` runs every file in
`server/__tests__/*.test.js`, and isolation (unique `DASHBOARD_DB_PATH` +
unique `mkdtempSync` cwd per file) is what makes them parallel-safe by
construction, not a serial/parallel flag. No new tagging mechanism is needed
or should be invented for this effort. Where the spec plan below says
"bucket," it means "which spec file" and "why that file, not another."

---

## 1. Flows to cover

Five flows, each proving one wired-up path end to end (not exhaustive
permutations — see Cost note):

1. **Target-date round trip (Layer 5).** Set a target date on a plan item via
   the HTTP route, confirm it changes the item's pace status on the next
   read, clear it, confirm `no_target` returns — proven once through the real
   route + real DB, plus once through `ccam focus target` as a thin HTTP
   client over the same route.
2. **Human detour-resolve round trip (Layer 4, DEC-13 trigger #2).** Resolve a
   pending detour via `POST /api/detours/:id/resolve` with a `fold_in`
   verdict, confirm the response carries the write outcome, confirm the real
   `AGENT-PLAN.md` fixture actually gained a sub-item, and confirm a
   concurrent-edit conflict is surfaced as a retryable state in the response
   body, not a 500.
3. **Decision-queue triage round trip (Layer 6 routes + CLI).** List queue
   rows, `resolve`/`dismiss` one, and `retry_write` a `writeback_conflict` row
   — confirmed through both the HTTP route and `ccam decisions
   ack|dismiss|retry`, and confirmed that resolving a `detour_disposition`
   queue row also resolves its linked `detour_dispositions` row.
4. **The full reconciliation tick — the centerpiece.** In one real temp,
   git-free cwd with a real `AGENT-PLAN.md` fixture: a plan item goes stale
   past its (out-of-band) target date → the rule layer flags it → a
   long-pending inferred detour is also flagged → the (stubbed) LLM
   classifies it `fold_in` → `plan-writeback.applyDisposition` fires for
   real → the file on disk actually changes → the real `ingestPlanForCwd`
   picks the new block up as a `plan_items` row → `detour_dispositions` and
   `decision_queue` both reflect the correct final state. Only the outermost
   `claude -p` spawn seam is stubbed; every other stage runs its real
   implementation.
5. **The same tick's conflict/escalation branch.** Same fixture, but a
   human's concurrent edit lands mid-write (via the documented
   `__injectPreRenameHookForTest` seam, never a real filesystem race): the
   write is retried once, still conflicts, the human's bytes survive on disk,
   and a `writeback_conflict` decision-queue row appears — proving the "Sara
   wins" invariant holds through the *whole* tick, not just inside
   `plan-writeback.js` in isolation.

---

## 2. Spec files

All new/extended files live in `server/__tests__/`, following this project's
one-spec-file-per-surface convention. Four of the five are exactly what the
technical plan's own §6 already directs (cited here for traceability); the
fifth is the new full-chain file this pass adds because nothing in the plan's
own test list proves the *whole* wired-together path with only the LLM seam
stubbed — the plan's own `reconciliation.test.js` guidance explicitly stubs
`plan-writeback.applyDisposition` for its auto-write-boundary case ("stub the
write path here"), which is correct for that file's job (proving reconciliation
*calls* the write path) but leaves the file-actually-changed → re-ingest →
queue-reflects-it chain unproven anywhere else.

| # | Spec file | New/extend | Bucket rationale |
|---|---|---|---|
| 1 | `server/__tests__/plans-api.test.js` | **extend** | Target-date is a plans-route concern; the file already owns every other `plans`/`focus` route contract test. Per technical-plan §6, add a `describe("POST /api/plans/items/target")` block. |
| 2 | `server/__tests__/detour-disposition.test.js` | **new** (technical-plan §6 names this file) | Owns the `detours` lib + `GET/POST /api/detours` route contract. Stubs `plan-writeback.js` per the plan's own instruction ("integration coverage of the real write lives in plan-writeback.test.js") — this file proves the route/lib wiring, not file mechanics. |
| 3 | `server/__tests__/reconciliation.test.js` | **new** (technical-plan §6 names this file) | Owns `reconciliation.js`'s own exports (`evaluateRules`, `classifyFlaggedDetours`, scheduling/fail-safe) plus the `decision-queue` route contract. Stubs the write path for its own auto-write-boundary case, per plan. |
| 4 | `server/__tests__/ccam-cli.test.js` | **extend** | The CLI is a thin HTTP client (`bin/ccam.js`'s own stated design, and this file's own header: "spawns the real CLI... asserts each command's output shape across the whole surface"). Add two `describe` blocks: `"ccam CLI — plan & focus (target)"` next to the existing `"ccam CLI — plan & focus"` block, and a new `"ccam CLI — decisions"` block next to `"ccam CLI — alerts, rules, webhooks"`. Do **not** create a separate CLI spec file — this repo has exactly one, and splitting it would fork the `ccam(...)`/`ccamEnv(...)` spawn helpers. |
| 5 | `server/__tests__/reconciliation-full-tick.test.js` | **new — the E2E addition** | Spans `db.js` + `plan-ingest.js` + `plan-writeback.js` + `detours.js` + `reconciliation.js` + a real fixture file in one process, exactly the shape `import-correctness.test.js`/`workflow-ingest.test.js` already establish for "prove the pipeline, not the unit." Kept as its own file rather than a `describe` block inside `reconciliation.test.js` because (a) it needs its own `fs.mkdtempSync` fixture cwd and real `AGENT-PLAN.md`, which the unit-level `reconciliation.test.js` deliberately does not need, and (b) it is intentionally the *one* place a reviewer can find "does the whole thing actually work," separate from "does each stage behave under stub." |

No spec needs a "serial" bucket: every file above isolates itself with a
unique `DASHBOARD_DB_PATH` and (for #1, #4, #5) a unique `mkdtempSync` working
directory, matching every existing spec in this suite — `node --test`'s
default parallel file execution is safe for all five.

---

## 3. Tag

None to add — this project has no smoke/regression/serial tag mechanism (see
§0). All five files are picked up automatically by
`test:server`'s `server/__tests__/*.test.js` glob the moment they exist; no
registration step, no annotation, no config edit. If a future spec must run
serially against a *shared* resource (none of these five do), the existing
precedent in this suite is simply "don't parallelize that one file's
`describe` blocks internally" (see `ccam-cli.test.js`'s ordered
`clear-data` tests, which rely on `it()` execution order within one file,
not a cross-file serial flag) — not applicable here since nothing here shares
state across files.

---

## 4. Assertions

### 4.1 `plans-api.test.js` — `POST /api/plans/items/target`
- Happy path: `{ cwd, item_number, target_date: "2099-01-01" }` → `200`, and
  a follow-up `GET /api/plans/for-cwd` shows the item's `target_date` field
  round-tripped exactly.
- `400` on a non-`YYYY-MM-DD` string and on an impossible calendar date
  (`"2026-13-45"`) — never silently accepted.
- `404` for an unknown `item_number`.
- `target_date: null` clears it — a subsequent `GET` shows `null`, not an
  empty string.
- The route broadcasts the **existing** `plan_updated` type (assert via a
  captured WebSocket broadcast or the documented broadcast hook) — no new
  message type invented, per the technical plan's explicit instruction.

### 4.2 `detour-disposition.test.js` — routes
- `GET /api/detours` filters correctly by `cwd`, `project_id`, and `status`
  (`pending`/`resolved`/`conflict`/`failed`).
- `POST /api/detours/:id/resolve` with each of the four `DISPOSITIONS` values:
  - `fold_in`/`new_item` (write path stubbed) → response body carries
    `write_status` and `resolved_item_id` (or the conflict/error fields on a
    stubbed failure) — never a bare `200 {}`.
  - `deliberate`/`discard` → response shows the disposition resolved with no
    `write_status` transition beyond `'none'`.
  - A bogus 5th disposition value → structured `400`.
- A stubbed `CONFLICT` outcome from the write path is returned as a normal
  `200` (or documented non-500 status) with the conflict code surfaced in the
  body — never a `500`.

### 4.3 `reconciliation.test.js` — decision-queue routes
- `GET /api/decision-queue?status=&kind=&cwd=` filters correctly; `payload`
  comes back parsed JSON, not a raw string.
- `POST /api/decision-queue/:id/resolve` with `action: "resolve"` and
  `"dismiss"` flips `status` correctly; `"retry_write"` on a non-writeback
  `kind` is rejected (structured error, not silently ignored).
- Resolving a `kind='detour_disposition'` queue row also resolves the linked
  `detour_dispositions` row **in the same request** — assert both tables
  agree afterward (no window where one is resolved and the other isn't).
- `retry_write` on a `writeback_conflict`/`writeback_failed` row re-invokes
  the write path with a **freshly derived** hash (never the stale
  `expectedHash` from the failed attempt) — assert via the stub's captured
  call arguments.

### 4.4 `ccam-cli.test.js` — new blocks
- `ccam focus target <n> <date>` → exit 0, output confirms the date was set;
  a follow-up read (`ccam focus status` or equivalent) shows the pace status
  changed; `ccam focus target <n> --clear` clears it; a malformed date exits
  1 with a usage/validation message on stderr (mirrors the existing `focus
  set` bad-argument test).
- `ccam decisions` lists pending rows (empty queue is fine, mirrors `alerts`'
  "unacknowledged of" empty-feed precedent); `ccam decisions ack <id>` and
  `dismiss <id>` round-trip against a seeded row; `ccam decisions retry <id>`
  against a seeded `writeback_conflict` row exits 0 and reports the retried
  outcome. All four assert **the CLI never re-implements the decision** —
  it is a thin client, so the assertion is "the row's state matches what the
  route alone would produce," not a parallel CLI-side computation.
- `ccam help` and REPL `commands`/`help <cmd>` output include `focus target`
  and `decisions` (extend the existing exhaustive help-word list and
  `commands` assertions rather than adding a parallel check).

### 4.5 `reconciliation-full-tick.test.js` — the centerpiece

**Fixture setup (once, in `before`):**
- `fs.mkdtempSync(os.tmpdir())` working directory — git-free by construction.
- A real `AGENT-PLAN.md` with one top-level, unchecked item (e.g.
  `- [ ] 1. Ship the auth migration — acceptance: SSO works`).
- Ingest it for real (`ingestPlanForCwd`), then set that item's `target_date`
  **out-of-band** via `stmts.setPlanItemTargetDate` (not by editing the file —
  per DEC-10, `target_date` is never file-parsed) to a date well past
  `DASHBOARD_PACE_GRACE_DAYS` in the past, so `pace.paceStatus` computes
  `behind` on the real row.
- Seed one `detour_dispositions` row directly via
  `stmts.upsertDetourDisposition` (or `detours.recordInferredDetour`) with
  `source_seen_at` older than `DASHBOARD_DETOUR_PENDING_DAYS` so R3 flags it
  without needing R2's volume ratio.
- Stub only `require("../lib/focus-inference").__injectSpawnForTest(...)` to
  return one deterministic JSON verdict: `fold_in`, high confidence
  (`>= DASHBOARD_DETOUR_CONFIDENCE_MIN`), with `proposed_text`/
  `proposed_acceptance` and `proposed_parent_item_id` set to the seeded
  top-level item's `item_id`. **Nothing else is stubbed** — `evaluateRules`,
  `classifyFlaggedDetours`'s digest/persistence, `plan-writeback.applyDisposition`,
  `atomicWriteFile`, and `ingestPlanForCwd` all run their real code against
  the real fixture file and a real temp SQLite DB.

**Scenario A — happy path, one tick, `reconcileCwd` called directly (never a
real timer):**
- A `decision_queue` row with `kind='pace_alert'` exists for the stalled
  item, `status='pending'`, `item_id` matching the seeded item.
- The `detour_dispositions` row now has `disposition='fold_in'`,
  `decided_by='llm'`, `write_status='written'`, `resolved_item_id` set to a
  **new** `plan_items.item_id`, and `resolved_at` stamped.
- **The file on disk actually changed:** `AGENT-PLAN.md`'s bytes now contain
  a new sub-item block nested under the parent item's checkbox line, with a
  synthesized `id:` line — read the file directly, not through the DB.
- **Re-ingest really happened:** querying `plan_items` for
  `(cwd, resolved_item_id)` returns a real row with `parent_item_id` equal to
  the parent's PK — proving `ingestPlanForCwd` ran for real, not that the
  disposition merely *claims* it wrote something.
- **No stray decision-queue row for the successful write** — per the
  technical plan's own design, a successful `fold_in`/`new_item` write closes
  the loop on the disposition row alone; assert there is exactly one queue
  row total (the `pace_alert`), not two.
- The `broadcast` collector captured a `plan_updated` event (reconciliation
  owns this broadcast per `plan-ingest.js`'s "caller owns broadcasting"
  contract) — the same existing message type, no new one.
- **Digest/dedupe cost control, same test:** call `reconcileCwd` a second
  time immediately with nothing changed. Assert zero further spawns (the
  spawn stub throws on a second invocation) and no duplicate `pace_alert` row
  (`findOpenQueueItem` guard) — proving the "quiet project spawns nothing on
  the next tick" property holds across the *whole* wired system, not just
  inside `reconciliation.js`'s own unit tests.

**Scenario B — conflict/escalation branch, same fixture, fresh disposition
row:**
- Same setup, but `plan-writeback.__injectPreRenameHookForTest(fn)` is armed
  so a "human" edit (`fs.writeFileSync` with different, legitimate plan
  content) lands in the window between the pre-write read and the
  pre-rename re-check.
- After `reconcileCwd` runs: the disposition row shows
  `write_status='conflict'`, `resolved_item_id IS NULL`,
  `resolved_at IS NULL` (retryable, not silently dropped).
- A `decision_queue` row `kind='writeback_conflict'` exists, `ref_id` equal
  to the disposition's id, and `payload` contains the attempted markdown plus
  the file hash at conflict time.
- **The human's bytes are intact on disk, byte-for-byte** — no dashboard
  content appended over or around them. This is the single highest-stakes
  assertion in this whole test plan, per the change brief's own framing of
  `AGENT-PLAN.md` write ownership as "the single highest-stakes surface in
  this change."
- A second `reconcileCwd` call does **not** silently retry the write — the
  disposition is not in `listPendingDetours` (its `disposition` is already
  `fold_in`, just unwritten) and not in `listStaleResolvedDetours` (no
  `resolved_at` yet), so it stays parked until a human calls
  `ccam decisions retry <id>` / `POST .../retry_write` — proving the "Sara
  wins, dashboard escalates, never auto-retries past one attempt" invariant
  holds at the system level, not only inside `plan-writeback.js`.

---

## 5. How to run a single spec

No base URL, no external stack, no environment bring-up — every spec in this
suite (including all five above) is self-contained: it sets its own
`DASHBOARD_DB_PATH` to a fresh temp SQLite file, starts its own Express app
on an OS-assigned port (`startServer(app, 0)`) when it needs HTTP, and cleans
up in `after()`. This is the project's actual convention (confirmed against
`plans-api.test.js`, `ccam-cli.test.js`, `focus-audit.test.js`) — there is no
shared dev server or "stack must be up" prerequisite to note.

```bash
# Run one spec file directly with node's built-in test runner:
node --test server/__tests__/plans-api.test.js
node --test server/__tests__/detour-disposition.test.js
node --test server/__tests__/reconciliation.test.js
node --test server/__tests__/ccam-cli.test.js
node --test server/__tests__/reconciliation-full-tick.test.js

# Run everything this effort touches (matches CLAUDE.md's required gate):
npm run test:server
```

If `node --test`'s pattern-matching needs narrowing to one `describe` block
while iterating, use `node --test --test-name-pattern="full reconciliation tick"
server/__tests__/reconciliation-full-tick.test.js` (Node's built-in filter —
no project-specific flag exists or is needed).

---

## 6. Cost note — what this layer does and does not prove

E2E-shaped tests here are expensive relative to pure unit tests (real temp
files, real SQLite, a real Express server for the route-contract files) so
this plan is deliberately the **minimum** that proves the wiring, not the
logic:

**Covered here, once each, at the seam that actually matters:**
- The three new routes are reachable, mounted, and return the documented
  shape — one happy path + one boundary case per route, not every validation
  branch (those already live in the unit/route-focused files the technical
  plan's own §6 directs, e.g. `plans-api.test.js`'s existing dense 400/404
  coverage pattern).
- The two new CLI commands are thin HTTP clients — one round-trip each, not
  every flag combination (the existing `ccam-cli.test.js` density for other
  commands, e.g. `pricing set`'s many flags, is not repeated here).
- **Exactly one** full reconciliation tick, in each of exactly two shapes
  (clean write, conflicted write) — proving rule → LLM (stubbed) →
  write-back → disk → re-ingest → queue is actually wired together end to
  end, with a real fixture file in a real temp git-free directory.

**Deliberately left to the unit layer (do not duplicate here):**
- Every `sanitizeLlmPlanText` adversarial-input case (forged `id:`/
  `acceptance:`/`detail:` lines, joinery, oversized fields, the combined
  worst case) — `plan-writeback.test.js`'s own `describe("sanitization…")`
  block is the correct and sufficient owner; re-testing it against a live
  server would only add latency, not confidence.
- The full retry/idempotency matrix (`CONFLICT` → retry → still-`CONFLICT`;
  `CONFLICT` → retry → success; zero-retry codes; idempotent re-dispatch) —
  `plan-writeback.test.js`'s `describe("applyDisposition — retry and
  escalation policy")` with `appendPlanItem`/`appendSubItem` stubbed is
  strictly better for this: deterministic, fast, and already directed by the
  technical plan.
- Every `evaluateRules` threshold/boundary case (R1 grace-day boundary, R2
  volume-ratio boundary, `MAX_DETOURS_PER_TICK` capping) — table-driven unit
  coverage in `reconciliation.test.js` is the right shape; the full-chain
  spec fixes one clearly-past-threshold case per rule so the chain test
  itself stays fast and legible.
- Every disposition value's queue/no-queue behavior
  (`deliberate`/`discard`, malformed LLM output, low confidence,
  `CAPS_EXCEEDED`/`NO_PLAN_FILE`/`IO_ERROR`) — `detour-disposition.test.js`
  and `reconciliation.test.js`'s LLM-judgment-pass block own these with the
  write path stubbed, which is the correct place for a combinatorial sweep.
- Every kill-switch permutation (`DASHBOARD_RECONCILE_MODE=off`,
  `DASHBOARD_FOCUS_INFER_MODE=off`) — `reconciliation.test.js`'s
  `describe("scheduling / fail-safe")` block, not repeated at this layer.
- The `atomic-file.js` primitive's own failure-path coverage (torn write,
  `.tmp` cleanup) — `atomic-file.test.js`, pure unit-level, no fixture needed.
- Any UI assertion — **none exist**; this effort ships zero client changes
  (confirmed in the change brief and WATCH-3), so there is nothing for this
  layer to render-check.
- The DEC-7 live-trial gate itself (Sara reviewing real, unattended content
  written into her actual `AGENT-PLAN.md` files against her real fleet) is
  explicitly **not** something an automated spec can stand in for — the
  technical plan states a green suite is not sufficient sign-off for this
  reason. This test plan proves the mechanism is wired correctly; it does
  not and cannot substitute for that human review step.
