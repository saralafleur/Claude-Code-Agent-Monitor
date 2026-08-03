# E2E / Contract Test Design — plan-lifecycle-value-ledger

> Authored by `qa-e2e-architect` (team-qa), 2026-08-02. Pre-build: every spec
> below is a red-first deliverable against unbuilt code. This layer proves the
> wired-up HTTP/CLI contract; exhaustive permutation coverage (pool assembly,
> git fixtures, canonicalization matrix, static guards) stays in the unit
> layer (T2–T5 per `technical-plan.md` §6).

## This project's "e2e" convention (discovered, not invented)

- **API/contract bucket:** `server/__tests__/<name>.test.js` using `node:test`
  — boot the real app in-process (`createApp()` + `startServer(app, 0)`)
  against a throwaway SQLite DB (`process.env.DASHBOARD_DB_PATH` set *before*
  requiring `../index`), raw `http.request` helper, WAL files cleaned in
  `after()`. Canonical examples: `plans-api.test.js`, `projects.test.js`.
- **CLI bucket:** `server/__tests__/ccam-cli.test.js` — spawns the **real**
  `bin/ccam.js` **asynchronously** (`child_process.spawn`, never `spawnSync`
  — the server lives in the same process; sync spawn deadlocks) with
  `DASHBOARD_PORT` pointed at the in-test server. This harness already
  exists and is mature (online, offline-fallback, REPL, help-completeness
  sections). **No new CLI seam is needed** — the task's "if untested" branch
  does not apply.
- **Tags/buckets:** none — `node:test` has no tag convention here; the file
  *is* the bucket. Everything runs under `npm run test:server`
  (`node --test server/__tests__/*.test.js`). Each spec owns a unique temp DB
  (`Date.now()-pid` suffix), so specs are parallel-safe across files; cases
  *within* a file run in declaration order, which the designs below rely on
  (e.g. close-the-plan cases run after claim cases).
- **No base-URL/environment prerequisite:** specs self-host on port 0. The
  only environment-sensitive spec is the ccam CLI one (already handles
  `CLAUDECODE` env pinning for in-session branching).

---

## 1. Spec: `server/__tests__/project-plans-api.test.js` (new — slice 1 skeleton, grows through slice 3)

The full route contract for `/api/project-plans`. Follows `plans-api.test.js`
setup verbatim: temp DB, tmp `workDir` with a nested `AGENT-PLAN.md`
(`- [ ] 1. ...` + one indented child so import-nesting is provable), a project
created via `POST /api/projects` (201, id captured), and the legacy plan
ingested via `POST /api/plans/refresh` so the import endpoint has source rows.

File header per `.claude/rules/file-headers.md` (overview +
`@author Son Nguyen <hoangson091104@gmail.com>`).

### Group A — create / list / read (5 cases)

| # | Case | Assertions |
|---|---|---|
| A1 | `POST /api/project-plans {project_id, title}` | **201** (match `projects.test.js` create precedent — pin it now so the CLI/UI don't fork on 200-vs-201); body `{ plan }` with `status:'open'`, `origin:'manual'`, `opened_at` set, `closed_at:null` |
| A2 | Create validation | 400 missing `project_id`; 400 missing/empty `title`; 400 `origin` outside `manual|import|retroactive_bundle`; 404 unknown `project_id` **on create only** (see stability risk S1) |
| A3 | `GET /api/project-plans?project_id=` | 200 `{ plans: [...] }`, each plan carries nested `items` (ordered by `position`) and per-item `claims`; `?status=open` / `?status=closed` filter; **no `cwd` top-level key on any plan** (R1 anti-blend — a `project_plans` response must never be shaped like a legacy `plans` row) |
| A4 | `GET /api/project-plans/:id` | 200 single plan + items; 404 unknown numeric id; **literal-segment guard:** `GET /api/project-plans/pool` (no query) returns the pool route's 400 (missing project_id), *not* the `:id` 404 — proves `:id(\d+)` constraint holds (Express 4 precedent: `alerts.js:136`) |
| A5 | Generation chain | Create gen-2 with `succeeds_plan_id`; list exposes the **derived** ordinal field (pin the response key name, e.g. `generation`); a bogus `succeeds_plan_id` → 400/404 |

### Group B — item CRUD on open plans (3 cases)

| # | Case | Assertions |
|---|---|---|
| B1 | `POST /:id/items` | 201; nesting via `parent_item_id` round-trips; `position` respected on list |
| B2 | `PATCH /items/:itemId` (text, checked), `DELETE /items/:itemId` | 200; read-back consistent (this is also the repo's indirect proof the `project_plan_updated` broadcast fired — same pattern as `plans-api.test.js`'s "broadcasts the existing plan_updated type" case) |
| B3 | Negatives | 404 unknown itemId; 400 empty text |

### Group C — closure: the only door (4 cases; the contract heart)

| # | Case | Assertions |
|---|---|---|
| C1 | `POST /:id/close {closure_note}` | 200; `status:'closed'`, `closed_at` stamped, note echoed; plan appears under `?status=closed` |
| C2 | Close twice | **409** with a structured error code (follow the `UNKNOWN_ITEM`/`EMPTY_STACK` `error.code` convention — pin the code, e.g. `ALREADY_CLOSED`) |
| C3 | Everything is refused against a closed plan | `PATCH /:id` (rename) → 409; `POST /:id/items` → 409; `PATCH`/`DELETE /items/:itemId` of its items → 409; `POST /:id/claims` → 409; `DELETE /claims/:claimId` of its claims → 409. After the sweep, re-read: plan, items, and claims byte-identical |
| C4 | **No other verb closes** | Route-table sweep on a fresh *open* plan: call every mutating route in the namespace (`PATCH /:id` with `{status:'closed'}` in the body must **not** close it — status is not a PATCHable field; item writes; claim writes; import; create-with-succeeds) and assert `status` is still `'open'` after each. Also: `DELETE /api/project-plans/:id` → 404 (no delete route exists at all, open or closed). The static single-writer scan lives in T5; this is its behavioral twin at the HTTP surface |

### Group D — claims cardinality per DEC-7 (5 cases)

| # | Case | Assertions |
|---|---|---|
| D1 | `POST /:id/claims` with `{value_source, value_ref, source_cwd?, item_id, attribution, ...snapshots}` | 201; claim visible nested under its item on `GET ?project_id=`; snapshot columns echoed |
| D2 | Duplicate claim: same unit → same item | **409** with structured error — the SQLite `UNIQUE(value_source, value_ref, source_cwd, item_id)` violation must be caught and mapped, **never surfaced as a 500 SQLITE_CONSTRAINT** (stability risk S2) |
| D3 | Same unit → a *second* item | allowed (200/201); both claims visible; `health.unclaimedPoolSize` unchanged by the second claim (unit left the pool at first claim — this defines what the metric counts) |
| D4 | `new_item:{...}` inline form | one call creates item + claim atomically; failure of either leaves neither |
| D5 | `DELETE /claims/:claimId` on an open plan | 200; unit re-enters the pool (pool size +1); `value_source` outside the exported `VALUE_SOURCES` → 400 (routes validate against the export, not literals) |

### Group E — pool endpoint (3 cases)

| # | Case | Assertions |
|---|---|---|
| E1 | `GET /pool?project_id=` | 200 `{ units: [...], identityWarnings: [...] }` — pin unit shape: `value_source`, `value_ref`, `attribution`; `identityWarnings` **always an array, present even when empty** (the UI/CLI will iterate it) |
| E2 | Mechanical tier present | seeded intake merge (reuse `intake-scan.test.js`'s fixture shape) yields `intake_initiative` + `merge_commit` units at `attribution:'mechanical'`; no unit ever arrives pre-claimed; no `focus_segment` unit is auto-claimed |
| E3 | `?backfill=1` | accepted (200, same shape); 400 missing `project_id`. Depth/dedupe/ratchet *behavior* is T3's job with real git fixtures — not re-proven here |

### Group F — health + history (3 cases)

| # | Case | Assertions |
|---|---|---|
| F1 | `GET /health?project_id=` | 200 `{ unclaimedPoolSize, lastClosureAt, daysSinceLastClosure, openPlanCount }` — exact key set pinned (this is the T6 parity target shape) |
| F2 | Health reacts to lifecycle | after D-group claims: pool shrank by exactly the distinct claimed units; after C1 close: `lastClosureAt` non-null, `openPlanCount` decremented |
| F3 | `GET /history?project_id=` | 200; closed generations with their claims; **no `closed_at`/closed flag on any claim object** — closed-ness appears only at plan level (the response-shape mirror of the no-closed-at-on-claims DDL rule); answers AC-6 from this payload alone |

### Group G — import (3 cases)

| # | Case | Assertions |
|---|---|---|
| G1 | `POST /import {project_id, cwd}` | 201/200; generation-1 plan with `origin:'import'`, items match the ingested legacy plan (count, text, nesting via `parent_item_id`, `position`), provenance fields set |
| G2 | **Idempotent re-import** | second identical call → **200 no-op returning the existing plan** (same `plan.id`); total `project_plans` count for the project unchanged — not a second generation, not a 409 |
| G3 | Negatives | 400 missing fields; 404 unknown project; 404 cwd with no ingested legacy plan |

### Group H — namespace isolation (1 case)

| # | Case | Assertions |
|---|---|---|
| H1 | Legacy surface untouched | after the entire suite above ran: `GET /api/plans` still returns the exact legacy shape (`plans[].cwd`, `items[].item_number`), contains no portfolio-plan rows, and `POST /api/plans/refresh` still works. The 144-case baseline pins this too, but this in-file assertion catches blending *within one process lifetime* |

**Total: ~27 `it()` cases.** Slice-gated: A/B/C4-partial/G land red in slice 1;
C/D complete in slice 2; E/F in slice 3. Keep one file — the shared seeded
lifecycle (create → items → claims → close) is the point of a contract spec.

---

## 2. CLI surface: extend `server/__tests__/ccam-cli.test.js` (+ T6 stays separate)

The harness already spawns the real CLI against the in-test server — reuse
`ccam(...)`/`ccamEnv(...)` and the `offline(...)` helper as-is. Add one
`describe("ccam CLI — ledger")` block (**6 cases**):

1. `ccam ledger` with no subcommand → exit 1, `Usage: ccam ledger` on stderr
   (matches `session`/`import` precedent).
2. `ccam ledger plans --project <name-or-id>` → exit 0, output contains the
   seeded plan title and its generation.
3. `ccam ledger pool --project ...` → exit 0; prints units and — when
   present — identityWarnings; `--backfill` flag accepted.
4. `ccam ledger claim`/`ccam ledger close` round-trip: claim a pool unit,
   close the plan, output confirms; a second `close` exits 1 with the
   server's 409 reason (proves structured errors survive the CLI formatter).
5. `ccam ledger health` → exit 0; prints the four health values **verbatim
   from the API** (no CLI arithmetic — spot-check by string match against a
   fresh `GET /health` fetch in the test).
6. Offline: ledger **write** verbs (`claim`, `close`, `import`) refuse with a
   server-required reason (pricing-set precedent); decide and pin whether
   reads (`plans`, `pool`, `health`) refuse or fall back — recommendation:
   refuse (`pool`/`health` math is server-side, same stance as `cost`).

Also **update the existing help-completeness case**: add `"ledger"` to the
word list in `help lists every command group` — this is the test that catches
an unregistered dispatch entry.

**T6 `ledger-metrics-parity.test.js`** (slice 3, named deliverable per §5.5)
stays its own spec and reuses the same async-spawn helper: one seeded DB state
→ `GET /api/project-plans/health` and `ccam ledger health` → parse both →
values deep-equal. Keep T6 *only* about cross-consumer parity; CLI UX/exit
codes live in `ccam-cli.test.js`. When MCP/export consumers arrive (DEC-16)
they join T6, not a new spec.

---

## 3. WebSocket surface — explicit statement

The plan **adds two additive message types** (`project_plan_updated`,
`value_claim_updated`) and **must not touch** `plan_updated`'s type or
`{ plan, items }` payload (6 call sites).

- No spec in this repo opens a live WS client; the established conventions are
  (a) lib-level assertion via an injected `broadcast` collector
  (`focus-commands.test.js:38-39`) and (b) route-level indirect proof via
  read-back (`plans-api.test.js` "broadcasts the existing plan_updated type").
  **Do not add a live-WS harness for this feature** — follow both conventions:
  new-type payload assertions belong in T2/T5 where `plan-lifecycle.js` gets
  an injected broadcast; the contract spec proves mutations read back (B2).
- **Recorded non-surface:** no existing WS message type changes, no field is
  added to `plan_updated`, and the two new types are the *only* additions. If
  a review diff shows `routes/project-plans.js` or `plan-lifecycle.js`
  emitting `plan_updated`, that is an R1 blend and a blocking finding.
- One cheap pin worth adding to T2: assert the broadcast collector received
  **only** `project_plan_updated`/`value_claim_updated` types (an allowlist,
  not just a contains-check), so a third silent type can't ride along.

---

## 4. Slice-4 checkpoint script (DEC-12 gate — runnable definition)

Preconditions (order matters): DEC-13 `DND`/`dnd` project merge done in the
dashboard UI → **then** stop the server → back up the DB → restart. `$PORT` =
the real dashboard port; `$PROJ` = Coaching Assistant's project id (from
`curl -s localhost:$PORT/api/projects | jq`); `$CWD` = its repo root.

| Step | Command | Expected outcome (gate evidence) |
|---|---|---|
| 0 | `sqlite3 ~/.claude/agent-dashboard/dashboard.db ".backup ~/.claude/agent-dashboard/dashboard.db.bak-$(date +%Y%m%d)"` | backup exists; dashboard boots after restart; focus/pace/detours/Project Detail unchanged |
| 1 | `ccam ledger health --project "$PROJ"` | pre-import baseline: `openPlanCount 0`, empty/near-empty pool — establishes the before-state |
| 2 | `curl -s -X POST localhost:$PORT/api/project-plans/import -H 'Content-Type: application/json' -d "{\"project_id\":\"$PROJ\",\"cwd\":\"$CWD\"}"` | generation-1 plan, `origin:"import"`, item count/nesting matches the real `AGENT-PLAN.md`. **Run it twice**: second response returns the same `plan.id`, no gen-2 (I3) |
| 3 | `ccam ledger pool --project "$PROJ"` (then once with `--backfill`) | trunk commits + ~30 intake initiatives with believable tiers; **read `identityWarnings` out loud** — any case-variant/worktree warning is itself checkpoint data (DEC-15 promotion trigger) |
| 4 | `ccam ledger claim ...` — ≥1 `mechanical` unit and ≥1 `correlational` unit into imported items | pool size drops by exactly the number of distinct claimed units (`ccam ledger health` before/after); re-claiming the same unit into the same item is refused with the 409 reason |
| 5 | `curl -s -X POST localhost:$PORT/api/project-plans -H 'Content-Type: application/json' -d "{\"project_id\":\"$PROJ\",\"title\":\"Retroactive: detours to date\",\"origin\":\"retroactive_bundle\"}"` then claim detour units into it, then `ccam ledger close --project "$PROJ" <planId> --note "retro bundle closed at checkpoint"` | close succeeds once, stamps `closed_at`; a second close is refused |
| 6 | `ccam ledger history --project "$PROJ"` | the AC-6 question — "what value did this project deliver?" — answered from closed generations + claims **alone**, no archaeology |
| 7 | Restart the server; re-run `ccam ledger health`, `pool`, `history` | claims and the closed generation survived; nothing re-imported or re-derived; pool identical minus claimed units (I2/I3 in the wild) |
| 8 | Sara records the verdict — **"signal or noise?"** — as the DEC-12 status update in `decisions.md` | slice 5 stays blocked until this row is answered; auto-pilot cannot write it |

---

## 5. Single-spec run commands

```bash
# API contract (new)
node --test server/__tests__/project-plans-api.test.js

# CLI ledger surface (extended existing spec)
node --test server/__tests__/ccam-cli.test.js

# Cross-consumer parity (T6, slice 3)
node --test server/__tests__/ledger-metrics-parity.test.js

# Whole server bucket / regression floor (144-case baseline must stay green, zero behaviour edits)
npm run test:server
```

No stack prerequisite: each spec boots its own server on port 0 against its
own temp DB. The checkpoint script (§4) is the only thing that runs against
the real dashboard + real DB — never point a spec's `DASHBOARD_DB_PATH` at
`~/.claude/agent-dashboard/dashboard.db`.

## 6. Cost note — minimum set, and what this layer deliberately skips

The contract layer is one new spec (~27 cases), a 6-case extension to an
existing CLI spec, and T6 (~2 cases). That is the minimum that proves: the
namespace is wired, the closed door is the only door at the HTTP surface,
DEC-7 cardinality maps to correct status codes, import is idempotent, and the
API/CLI pair can't drift. Deliberately **not** covered here (unit layer owns
them, per `technical-plan.md` §6):

- Pool-assembly permutations, cross-feed sha dedupe, ratchet-across-runs,
  chronology fixtures — **T3** with real tmp git repos (`ISOLATED_GIT_ENV`).
- Closure single-writer **static** guard with export-derived scope, red-proven
  — **T5** (C4 above is only its behavioral twin).
- Import-inversion static rogue-writer scan and the
  `deletePlanItemsNotIn`-deletes-zero proof — **T4**.
- cwd canonicalization matrix (case variants, worktree folding, ENOENT
  fallback) — unit spec on `cwd-identity.js`; the contract layer only sees
  its output via `identityWarnings` shape.
- Legacy-DB boot gains the three tables — **T1** (`db-migration.test.js`).
- All UI behavior — **T7**, gated behind DEC-12; nothing at this layer
  pre-builds for it.

## 7. Contract-stability risks found (for the build + review pass)

- **S1 — unknown-project 404 vs soft-ref audit semantics.** `project_plans.project_id`
  has no FK by design: closed generations must outlive their project row
  (§3.1 comment). A blanket "unknown project_id → 404" on the GET routes
  would make `history`/`health` unreachable the day a project is deleted,
  destroying the audit story. Pin the contract as: **create/import 404 on
  unknown project; list/pool/health/history 404 only when neither a project
  row nor any `project_plans` row exists for the id.** Encode this as an
  explicit case (delete the project row via SQL in-test, re-GET history →
  still 200).
- **S2 — UNIQUE violation must not leak as 500.** The DEC-7 duplicate-claim
  guard is a SQLite constraint; without an explicit catch in the route it
  surfaces as a raw `SQLITE_CONSTRAINT` 500 and the CLI/UI get garbage. The
  D2 case pins 409 + structured `error.code` (repo convention:
  `UNKNOWN_ITEM`/`EMPTY_STACK` style).
- **S3 — create status code unstated.** The plan never says 200 vs 201 for
  `POST /api/project-plans`. `projects.test.js` pins 201 for the sibling
  create; A1 pins 201 here before three consumers (route/CLI/UI) can fork.
- **S4 — `:id(\d+)` is Express-4-only syntax.** Fine today (express 4.22.1,
  precedent `server/routes/alerts.js:136`), but path-to-regexp param-regex
  syntax is removed in Express 5 — an eventual upgrade breaks every literal
  segment (`pool`, `health`, `history`, `import`, `items`, `claims`) by
  routing them into `:id`. A4's literal-segment case is the tripwire; the
  plan's "literal routes declared before parameterized ones regardless" line
  is the belt-and-suspenders that must actually be in the file.
- **S5 — CLI offline posture for ledger is undesigned.** `bin/ccam.js` has a
  real offline-fallback layer with per-command stances; the plan is silent on
  `ccam ledger` offline. Case 6 in §2 forces the decision (recommend: refuse,
  server-side math) so it's pinned rather than accidental.
