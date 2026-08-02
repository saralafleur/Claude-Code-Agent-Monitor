# QA Plan — Layers 4-6 of the Portfolio/Project-Manager Architecture

Scope: **Layer 4** (detour disposition), **Layer 5** (pace/target-date
tracking), **Layer 6** (hybrid rules+LLM reconciliation pass). Layers 1-3
and 7 are out of scope (see `request-brief.md`).

Test stack confirmed from the repo (no `PROJECT-CONTEXT.md` test-stack
section exists, so this is discovered from `package.json` + existing specs):
- Server: `node:test` + `node:assert/strict`, run via `npm run test:server`
  (`node --test server/__tests__/*.test.js`). One spec file per lib/route,
  each spins up its own temp SQLite file (`process.env.DASHBOARD_DB_PATH`
  set before requiring `../db`) and its own `createApp()`/`startServer()`
  when it needs HTTP.
- Client: Vitest + Testing Library, run via `npm run test:client`
  (`cd client && npm test`). Per-screen render snapshots live in
  `client/src/pages/__tests__/screens.snapshot.test.tsx`, with the API layer
  mocked via `vi.mock("../../lib/api", ...)` to deterministic empty fixtures.
- MCP: `npm run mcp:typecheck` / `npm run mcp:build` (only relevant if this
  work exposes new MCP tools for the decision queue).

---

## 1. How we verify done

### Layer 4 — detour disposition
Manual:
1. Seed a session that pushes a Focus detour (`ccam focus push bug "npm
   conflict"`) and pops it without folding it into any plan item.
2. Run whatever entry point Layer 6's reconciliation pass exposes for a
   single project (CLI/API — exact shape is the architect's call per the
   brief's non-blocking assumption #2) and confirm the detour comes back
   with exactly one of the four dispositions: `fold_into_plan` (new
   milestone under the current item), `new_plan_item`, `deliberate_deviation`,
   or `discard`.
3. Confirm the disposition is **persisted** and idempotent: running the pass
   again over the same, unchanged detour does not re-flag it or duplicate a
   plan item.
4. If disposition is `fold_into_plan` / `new_plan_item`, confirm the new
   plan item actually appears in `plan_items` (or wherever it lands) with
   correct `parent_item_id` nesting and survives a subsequent
   `AGENT-PLAN.md` re-ingest without being clobbered (plan-ingest's own
   identity rule: `(cwd, item_id)` must not collide with or overwrite an
   agent-created disposition row — this needs an explicit decision from the
   architect on how disposition-created items interoperate with
   file-sourced items, and a test locking in whichever answer is chosen).

Automated: see New/updated tests below.

### Layer 5 — pace tracking
Manual:
1. Set a target/expected-arrival value on a `plan_items` row (however the
   architect decides to author it — brief's assumption is manual, on
   `plan_items`, alongside `declared_done_at`).
2. Confirm a plan item with no target date reports pace status
   `no_target` (or equivalent "not applicable"), not a false "on track"/
   "behind" — this must never silently default to on-track.
3. Confirm a plan item whose `declared_done_at` is set (done) never reports
   "behind" pace regardless of how late it finished — completed work isn't
   penalized retroactively; pace only applies to open items.
4. Set a target date in the past on a still-open item; confirm pace reads
   `behind`. Set one in the future; confirm `on_track`.

Automated: see New/updated tests below.

### Layer 6 — reconciliation pass (hybrid escalation)
Manual, per the brief's explicit acceptance constraint (rules decide
*whether*, LLM decides *what*):
1. Construct a project with (a) one item behind its target date beyond
   threshold, (b) one item within threshold, (c) a detour-volume ratio
   above the configured threshold, (d) a detour-volume ratio below it.
   Run the reconciliation pass and confirm escalation fires for (a) and (c)
   only, using purely the fixed-rule inputs — **stub or disable the LLM
   call for this check** and confirm escalation decisions are unchanged
   (proves rules alone drive escalation, per the confirmed design).
2. For a project with a flagged detour, run the pass with the LLM judgment
   stubbed to return each of the four dispositions in turn and confirm the
   decision-queue entry reflects exactly that verdict — proves the LLM only
   classifies *what*, never *whether*.
3. Confirm a project with no escalation-worthy conditions produces an
   **empty** decision queue and makes **zero** LLM calls (cost/quiet-mode
   check — the LLM pass is "reserved specifically for classifying," not run
   speculatively over every detour regardless of rule outcome).
4. Confirm the periodic mechanism (whatever shape — `/loop` or scheduled
   cron agent, per the brief's non-blocking assumption #4) actually runs on
   its own schedule without a human triggering it, and that a run failure
   (LLM unavailable, DB error) fails safe — i.e. leaves prior state
   untouched and does not silently mark a decision "resolved" — mirroring
   `session-liveness.js`'s `available: false → do nothing` guard.
5. Confirm the decision-queue output is queryable via API/CLI even with no
   UI consumer yet (brief's assumption #2 — layer 6 must produce something
   concrete now, not defer entirely to layer 7).

---

## 2. Regression coverage — existing tests this builds on

Found under `server/__tests__/` (grep confirms these are the closest
existing specs to the touched surface; no dedicated detour/pace/reconciliation
spec exists yet since none of layers 4-6 are built):

| Area this work extends | Existing spec | Current status |
|---|---|---|
| Focus/detour inference this sits on top of | `server/__tests__/focus-report.test.js` (segment reconstruction, detour attribution to the current item, `buildProjectFocusReport` rollups) | Passing on `master` as of this intake — run `npm run test:server` before starting to confirm the baseline. |
| LLM judgment-pass precedent (spawn/cache/prompt-building pattern layer 6's LLM half should follow) | `server/__tests__/focus-summary.test.js` (`generateWindowSummary` digest-gated caching, `__injectSpawnForTest` stubbing, envelope parsing) | Passing baseline; this is the pattern to copy for the LLM half of layer 6, not a spec that itself needs new assertions unless the shared `focus-inference`/`focus-summary` spawn seam is touched. |
| Fixed-rule escalation precedent (rules half of layer 6) | `server/__tests__/session-liveness.test.js` (`isClaudeCommand`, `probeLiveCwds` availability/fail-safe, `livenessReap` rule-based reap) | Passing baseline; this is the pattern to copy for the deterministic pace/detour-ratio thresholds, not itself modified unless the watchdog interval (`WATCHDOG_INTERVAL_MS`, `server/routes/hooks.js`) is reused to schedule the reconciliation pass. |
| Plan/plan_items schema + ingest identity this both reads (milestones) and writes (folded/new detour items) | `server/__tests__/plan-ingest.test.js` (grammar tolerance, re-ingest identity via `(cwd, item_id)`, `declared_done_*` survives re-ingest) and `server/__tests__/plans-api.test.js` (API contract over `plan_items`) | Passing baseline; **must stay green** — any `plan_items` schema addition (target-date column, disposition-created rows) must not change existing column semantics or break the `(cwd, item_id)` upsert identity these specs pin. |
| `plans`/`plan_items` DB layer directly | `server/db.js` schema block ~L540-593 (no dedicated schema-only spec; covered indirectly through `plan-ingest.test.js` and `plans-api.test.js`) | Same as above. |

Action before any implementation: run `npm run test:server` and
`npm run test:client` once on a clean checkout to capture the true
pre-change baseline (the working tree currently has unrelated uncommitted
changes — `usage-captures-db`, `accounts`, etc. — so isolate this effort's
diff before treating any failure as caused by this work).

---

## 3. New/updated tests required

Follow this repo's established one-file-per-lib convention (new `.js` files
under `server/__tests__/`, each owning its own temp DB via
`process.env.DASHBOARD_DB_PATH` set before requiring `../db`, per every
existing spec above). Every new source file needs the mandatory file header
(`@author Son Nguyen <hoangson091104@gmail.com>`) per
`.claude/rules/file-headers.md`.

### `server/__tests__/detour-disposition.test.js` (new) — Layer 4
- **Deterministic mapping of detour → candidate disposition set**: given a
  detour segment (reuse `focus-report.js`'s existing detour-segment shape —
  `kind: "bug"/"feature"/"detour"`, `item_number`, `label`), the disposition
  module accepts exactly one of the four dispositions and rejects anything
  else (schema/enum guard — a fifth "disposition" is a config error, not a
  silently-accepted string).
- **`fold_into_plan`**: produces a new `plan_items` row nested under the
  detour's `item_number` via `parent_item_id`, and the row's identity
  (`item_id`) survives a subsequent `AGENT-PLAN.md` ingest for that cwd
  (regression against `plan-ingest.test.js`'s re-ingest identity contract —
  extend that spec's describe block if the architect decides
  disposition-created items must be recognized specially by the parser/
  ingest path, rather than adding a parallel assertion here that could
  silently drift from it).
- **`new_plan_item`**: produces a new top-level `plan_items` row (no
  `parent_item_id`), distinct from the source item.
- **`deliberate_deviation`**: does NOT touch `plan_items` at all — persists
  only as a logged disposition record. Assert `plan_items` row count is
  unchanged before/after.
- **`discard`**: same "no plan_items mutation" assertion, but additionally:
  the disposition record itself must still be queryable (discard is a
  resolution, not a delete of history) — mirrors this project's
  `declared_done_at`-style "never destructively delete an audit trail"
  convention already seen in `plan_items`' own schema comments.
- **Idempotency**: dispatching the same already-disposed detour a second
  time is a no-op (no duplicate plan item, no duplicate disposition record)
  — mirrors `plans-api.test.js`'s "idempotent same-state dedupe" pattern
  for the focus-write endpoint.
- **Ordering regression (9.2 row-id-as-chronology-proxy)**: seed detours
  with `created_at` values that are NOT in `id`-insertion order (bulk-insert
  out of sequence, same technique as `focus-report.test.js`'s "never lets
  active_ms exceed wall_ms... when events land out of chronological order"
  test) and assert the disposition pass processes/reports them in
  `created_at` order, not `id` order.

### `server/__tests__/pace-tracking.test.js` (new) — Layer 5
- **`no_target`** status for a plan item with no target-date field set —
  explicit assertion this is a distinct third value, not coerced to
  `on_track` or `behind`.
- **`on_track`** for an open item with target date in the future.
- **`behind`** for an open item with target date in the past.
- **Completed items are exempt**: an item with `declared_done_at` set never
  reports `behind`, even with a long-past target date (assert pace status
  is e.g. `done` or `null`, not `behind`).
- **Boundary**: target date exactly equal to "now" — assert whichever side
  of the boundary the architect picks, pinned explicitly (this is exactly
  the kind of off-by-one a future contributor could flip silently).
- If the target-date field lands on `plan_items` (per the brief's
  assumption), extend `plans-api.test.js`'s existing describe blocks for
  the `plan_items` read/write endpoints rather than duplicating HTTP
  plumbing in a new file — add assertions that the new field round-trips
  through `GET /api/plans` and (if authorable via API) a write path.

### `server/__tests__/reconciliation.test.js` (new) — Layer 6
Structure this file with two clearly separated `describe` blocks so the
rules/LLM boundary in the confirmed design is enforced by the test
structure itself, not just by convention:

- **`describe("escalation rules — deterministic, no LLM")`**
  - Table-driven cases across the two named thresholds (pace vs. target
    date, detour-volume ratio): each case asserts escalate/no-escalate
    with the LLM path stubbed to throw (same technique as
    `focus-summary.test.js`'s `__injectSpawnForTest(() => { throw new
    Error("no LLM call expected") })` after a cache hit) — a stray call
    here is a design violation, not just a slow test.
  - Threshold boundary cases (exactly at the ratio/date cutoff) pinned
    explicitly, same rationale as the pace boundary case above.
  - Confirms zero escalations → zero LLM invocations (the "resolve
    everything else quietly" requirement) using the same throw-on-call stub.
- **`describe("LLM judgment pass — detour classification only")`**
  - Reuse the `fakeSpawn`/`fakeSpawnSequence`/`__injectSpawnForTest`
    machinery from `focus-summary.test.js` (via whatever seam the
    reconciliation module's LLM call uses — likely `focus-inference.js`'s
    existing `__injectSpawnForTest`, or a new equivalent seam if the LLM
    call lives in a genuinely new module) so **no real `claude` CLI is ever
    spawned** in CI, exactly like `focus-summary.test.js`'s file header
    states as an explicit design goal.
  - One case per disposition value returned by the stubbed LLM (`fold_into_
    plan` / `new_plan_item` / `deliberate_deviation` / `discard`), asserting
    the decision-queue entry carries that exact verdict through unmodified.
  - Malformed/garbage LLM output (unparseable JSON, missing disposition
    field, a 5th invented value) degrades to a **safe default** — do not
    guess a disposition from garbage; either fail the item into the human
    decision queue as "needs review" or leave it unresolved. This is the
    LLM-pass analog of `parseWindowSummaryOutput`'s existing "returns null
    for garbage" tests in `focus-summary.test.js` — copy that defensive
    pattern rather than trusting LLM output shape.
  - Digest/cache behavior if the LLM pass is cached like `focus-summary.js`
    (regenerate only when the underlying detour data changes) — reuse
    `computeInputDigest`-style stability/change assertions if the
    architecture reuses that caching layer.
- **`describe("decision queue output")`**
  - Confirms the queue is queryable (API/CLI, per whatever shape lands) and
    contains only items that were actually escalated by the rules layer —
    an LLM-classified-but-not-escalated detour must never appear.
  - Confirms a resolved/actioned decision-queue item does not resurface on
    the next periodic run (no infinite re-flagging of the same handled item).
- **`describe("scheduling / fail-safe")`**
  - Mirrors `session-liveness.test.js`'s "does nothing when the probe is
    unavailable" pattern: reconciliation pass encountering an unavailable
    LLM path, DB error, or missing project data must leave existing
    decision-queue state untouched, not partially write or crash the
    scheduler.
  - If reusing the watchdog's `setInterval` mechanism
    (`server/routes/hooks.js`'s `WATCHDOG_INTERVAL_MS` pattern) or a new
    scheduler, test the triggerable function directly (like
    `hooksRouter.watchdogCheck()`/`livenessReap()` are exported and called
    directly in tests) rather than waiting on a real timer.

### Client-side (only if this work adds a UI surface before layer 7)
Per the brief, layer 7 (portfolio rollup UI) is explicitly out of scope,
and the decision queue should be "designed minimally... enough for a CLI/API
check", so **no new page/route is expected**. However:
- If any new server-derived value from this work (pace status, disposition,
  decision-queue entries) gets rendered in *any* existing UI surface (even
  a small badge on `Projects.tsx` or `PlanPanel.tsx`) before layer 7 lands,
  that triggers **PROJECT-CONTEXT.md §9.1 DERIVED-DUAL-VIEW**: it must be
  extracted into a shared component/hook, and a cross-consumer parity test
  must be added following the exact pattern of
  `client/src/components/__tests__/FocusReportModal.test.tsx`'s `[standing
  template]` / `[board-mode extension]` / `[FocusPage extension]` tests
  (search that file for `extend THIS test`) — one canonical assertion that
  every consumer renders the same value, extended (not re-implemented) by
  each new consumer.
- If any new screen/route IS added, `client/src/pages/__tests__/
  screens.snapshot.test.tsx` must be extended with a new route entry and
  its API mock added to the deterministic empty-fixture block (follow the
  existing pattern: mock `../../lib/api`'s new endpoint to a
  zeroed/empty-collection shape, add the route to the rendered set, then
  run `cd client && npx vitest run -u` to generate the baseline snapshot
  and **review the diff by eye** before committing it — never blind-accept
  per `CLAUDE.md`'s testing policy).

---

## 4. Test data / fixtures

- **Detour fixtures**: reuse `focus-report.test.js`'s `focus(sessionId,
  minute, summary, data)` helper pattern (raw `INSERT INTO events ... event_
  type='Focus'`) to construct push/pop detour segments deterministically,
  rather than depending on real hook timing.
- **Plan items with/without target dates**: extend `plan-ingest.test.js`'s
  `writePlan()` / `stmts.upsertPlanItem` helpers with the new target-date
  column once the architect names it; seed both a with-target and a
  no-target row in the same plan to exercise the `no_target` branch
  alongside `on_track`/`behind` in one fixture.
- **LLM stub responses**: copy `focus-summary.test.js`'s `envelope()` /
  `fakeSpawn()` / `fakeSpawnSequence()` helpers verbatim (or extract them to
  a shared test-util if both files need them — small enough that
  copy-per-file matches this repo's own stated one-helper-per-file
  convention, see `focus-summary.test.js`'s comment on `fetch()`).
- **Threshold configuration**: whatever env vars or config the architect
  picks for the pace/detour-ratio thresholds (mirroring
  `DASHBOARD_FOCUS_IDLE_GRACE_SECONDS`'s existing env-driven-threshold
  pattern) should have both an explicit-set-value test and a
  default-when-unset test, same shape as `focus-report.test.js`'s idle
  grace window suite.
- **Out-of-order timestamps**: reuse the exact scrambled-insertion technique
  from `focus-report.test.js`'s "never lets active_ms exceed wall_ms... when
  events land out of chronological order" test for any new query this work
  adds over `events` or another bulk-insertable table (9.2 guard).

---

## 5. Definition of Done checklist

- [ ] `npm run test:server` passes, including all new
      `detour-disposition.test.js` / `pace-tracking.test.js` /
      `reconciliation.test.js` suites.
- [ ] Pre-existing `focus-report.test.js`, `focus-summary.test.js`,
      `session-liveness.test.js`, `plan-ingest.test.js`, `plans-api.test.js`
      all still pass unmodified (or with only additive changes) — confirms
      this work built on top of, not into, the existing machinery.
- [ ] Layer 6's rules-vs-LLM test blocks prove escalation decisions never
      change when the LLM is stubbed to throw (rules decide *whether*), and
      disposition classification never changes escalation outcome (LLM
      decides *what*, only after being flagged) — the brief's explicit
      non-compliance condition is directly falsifiable by these tests.
  - [ ] No real `claude` CLI process is spawned by any new test (grep the
      new spec files for `__injectSpawnForTest`/equivalent stubbing; a CI
      run with network/CLI access disabled should still pass).
- [ ] Any new query over `events` (or another bulk-insert table) sorts by
      `created_at` explicitly (9.2), verified by an out-of-order-insertion
      regression test.
- [ ] Any new server-derived value rendered in more than one UI surface is
      backed by a cross-consumer parity test in the `[standing template]`
      style (9.1), or the divergence-bound exception is documented in the
      introducing file's header per the project's established pattern.
- [ ] If a new screen/route was added: `screens.snapshot.test.tsx` updated,
      snapshot regenerated via `cd client && npx vitest run -u`, diff
      reviewed by a human (not blindly accepted).
- [ ] `npm run test:client` passes.
- [ ] Manual verification steps in Section 1 (layers 4, 5, 6) walked through
      once against a real seeded project before calling this done.
- [ ] Docs updated per `CLAUDE.md`'s `update-project-docs` skill trigger
      (new schema field(s), new scheduled process, any new API/CLI surface
      for the decision queue) — `ARCHITECTURE.md`, `docs/API.md`,
      `docs/DATABASE.md` at minimum given the repo map's own file list.

---

## REVISION (2026-08-01) — Layer 4 real write-back + auto-write test guidance, per DEC-2/DEC-13 (supersedes original Layer 4 section and DEC-12)

Context: `decisions.md` DEC-2 chose **B — real write-back** into `AGENT-PLAN.md`
(overriding my original advisory-only assumption), and DEC-13 chose
**A — auto-write on disposition** (the file write fires the moment a
`fold_in`/`new_item` disposition is decided, including unattended by the
Layer 6 LLM judgment pass). DEC-12 — which rewrote my original `fold_into_plan`
assertion into its inverse ("must NOT create a `plan_items` row") — is now
itself superseded: real write-back means the *original* assertion direction
is correct again, but the mechanism is different (write the file, then
re-run real ingest — never a direct DB write) and it now carries two new
mandatory guards DEC-13 added: (1) sanitize LLM-influenced text before
composing markdown, and (2) every auto-write traceable back to the
`detour_dispositions` row that caused it. This section replaces **only**
the original "Layer 4 — detour disposition" material (§1's Layer 4 subsection,
§2's plan-ingest row, §3's `detour-disposition.test.js` fold_in/new_item
bullets, §4/§5's Layer-4-specific lines above). Layers 5 and 6 guidance in
the original sections is untouched and still applies as written.

Grounded against `supporting/architect.md`'s "REVISION (2026-08-01) — Layer 4
real write-back, per DEC-2" section (designs `server/lib/plan-writeback.js`),
and against the two closest existing precedents in this repo:
- `server/__tests__/plan-ingest.test.js` — the re-ingest identity contract
  (`(cwd, item_id)` upsert, `declared_done_*` survives, `deletePlanItemsNotIn`
  behavior) that `plan-writeback.js` must not regress, since it re-invokes
  the real `ingestPlanForCwd` rather than writing `plan_items` directly.
- `server/lib/cc-mutate.js`'s `atomicWriteFile` (temp file + `fsync` +
  `renameSync`, tmp unlinked on any failure path) — the architect's design
  extracts this into a shared `server/lib/atomic-file.js` for `plan-writeback.js`
  to reuse. **Note for QA tracking:** grepping `server/__tests__/` today finds
  **no existing spec file for `cc-mutate.js`** — the atomic-write primitive
  currently has zero direct test coverage anywhere in this repo. The
  extraction is therefore also the first point this primitive gets tested at
  all; new tests should live on the extracted `atomic-file.js`, not be
  backfilled onto `cc-mutate.js` (out of scope for this effort).

### 1. How we verify done — Layer 4 (real write-back)

Manual:
1. Seed a project with an existing `AGENT-PLAN.md` and an undisposed detour.
   Drive a `fold_in` or `new_item` disposition to completion (via whatever
   entry point Layer 6/CLI exposes) and confirm: (a) `AGENT-PLAN.md` on disk
   now contains a new, well-formed item/sub-item with a synthesized `id:`
   line; (b) a subsequent poll tick / `POST /api/plans/refresh` — i.e. the
   **normal** ingest path, not a special "disposition-aware" one — picks it
   up with no special-casing; (c) `plan_items` now has a **new row** for that
   `item_id` (the direct inverse of DEC-12's now-superseded "must not create
   a row" assertion).
2. Confirm the write survives a completely unrelated subsequent human edit to
   a *different* item in the same file (append doesn't corrupt or reflow
   unrelated content — diff the file before/after by eye once).
3. Simulate a concurrent human edit landing between the dashboard's read and
   its rename (see automated conflict test below) and confirm manually: the
   human's edit is present in the file afterward, the dashboard's write did
   **not** silently overwrite it, and the disposition that attempted the
   write is left in a state (not `resolved`, no `linked_plan_item_id` set)
   that makes it obviously retryable rather than silently dropped.
4. Feed a disposition whose LLM-sourced `text`/`acceptance`/`detail` contains
   an embedded `id:`/`acceptance:` line and a raw newline (simulate a
   worst-case LLM output) and confirm the resulting file has **no** forged
   continuation line — the injected fields land as inert prose, not as
   structure a later ingest would parse as a second field.
5. Pick any one written disposition and confirm it is traceable end-to-end:
   given only the `detour_dispositions` row, find the exact `plan_items` row
   it produced, and confirm that row's `text`/`acceptance` matches what the
   disposition recorded it intended to write.

Automated: see New/updated tests below.

### 2. Regression coverage — updated for Layer 4

| Area this work extends | Existing spec | Current status |
|---|---|---|
| Real ingest path `plan-writeback.js` re-invokes (must not regress) | `server/__tests__/plan-ingest.test.js` — specifically `describe("ingestPlanForCwd")`'s content-hash short-circuit, `describe("reorder identity (item_id survives a number change)")`, and `describe("sub-items end to end")`'s parent-linkage-by-id tests | Passing on `master` as of this intake; **must stay green** — `plan-writeback.js` deliberately calls the *real*, unmodified `ingestPlanForCwd`, so any regression here is a regression in the write-back feature too, not just plan-ingest's own surface. |
| Atomic file write primitive `plan-writeback.js` will reuse | `server/lib/cc-mutate.js`'s `atomicWriteFile` (`cc-mutate.js:218`) | **No existing spec covers this today** (confirmed by grep — no `cc-mutate.test.js` in `server/__tests__/`). Not a regression risk yet because nothing tests it, but it becomes one the moment `atomic-file.js` is extracted and two modules depend on it; the extraction PR should add baseline coverage (see below), not assume the primitive already works because `cc-mutate.js` uses it in production. |
| Plan/plan_items API contract | `server/__tests__/plans-api.test.js` | Passing baseline; unaffected by this revision structurally (write-back never talks to the API layer directly), but re-run as part of the full suite since `ingestPlanForCwd`'s behavior is shared. |

Action before any implementation: run `npm run test:server` once on a clean
checkout to capture the true baseline, same as the original qa.md's
instruction — this still applies unchanged.

### 3. New/updated tests required — Layer 4

**`server/__tests__/plan-writeback.test.js` (new)** — the primary new spec,
following this repo's per-lib-file convention (own temp DB via
`DASHBOARD_DB_PATH`, own `fs.mkdtempSync` work dir for the plan file, mandatory
file header). Structure with separate `describe` blocks so each DEC-13
guard is independently falsifiable:

- **`describe("happy path — real write survives re-ingest")`**
  - `appendPlanItem` on a seeded `AGENT-PLAN.md`, then call the real
    `ingestPlanForCwd(dbModule, cwd)` (not a stub), then assert a **new**
    `plan_items` row exists for the minted `item_id`, with `parent_item_id
    IS NULL`. This is the direct inverse of DEC-12's now-superseded
    assertion — name the test something explicit like `"a fold_in write
    appears as a new plan_items row after write-back + re-ingest"` so a
    future reader doesn't have to cross-reference `decisions.md` to know
    this intentionally reverses an earlier spec.
  - `appendSubItem` under an existing top-level item: assert the new row
    has `parent_item_id` set to the parent's `id`, and `attachDisplayNumbers`
    assigns it a correct `N.M` display number on the next read — regression
    against `plan-ingest.test.js`'s existing sub-item describe block; do not
    re-implement that assertion here, just confirm write-back's output feeds
    it correctly.
  - Re-run `ingestPlanForCwd` a second time with no further changes: assert
    the content-hash short-circuit fires (no row churn) — proves write-back's
    own re-ingest call correctly updates `plans.content_hash` so the *next*
    independent trigger (poll tick, `SessionStart`) harmlessly no-ops, per
    the architect's stated design.
  - Assert an unrelated, pre-existing item elsewhere in the file is
    byte-identical apart from the new block (append doesn't reflow/mangle
    existing content).

- **`describe("optimistic-lock conflict — no data loss")`** — this is the
  concurrency-without-real-races test the architect's design requires. Do
  **not** attempt real filesystem race conditions (timing-dependent, flaky
  by construction, exactly what `focus-summary.test.js`'s injected-seam
  pattern exists to avoid). Instead, require `plan-writeback.js` to expose a
  test-only synchronous hook mirroring `focus-inference.js`'s
  `__injectSpawnForTest` — e.g. `__injectPreRenameHookForTest(fn)` — that
  fires deterministically after the initial read/hash (architect's step 2)
  but before the immediate-pre-rename re-hash (step 6). Tests use this hook
  to synchronously mutate the file on disk (simulating a human's concurrent
  edit) at exactly the vulnerable instant, with no real threads/timers/sleeps
  involved:
  - Case: human edit lands in the window → assert the call returns/throws a
    `CONFLICT` result (not a silent success, not a thrown generic error).
  - **Both sides verifiable as not lost**: after the `CONFLICT`, assert (a)
    reading the file from disk shows the human's edit intact, byte-for-byte,
    with **no** dashboard content appended over or around it; (b) the
    disposition/caller-side state that was attempting the write was **not**
    advanced to a resolved/completed state as a result of this call — the
    caller must be able to tell "this is still pending, retry me" rather
    than the write silently vanishing. Model this by having the test's
    caller-side stand-in only flip its own "resolved" flag on a non-CONFLICT
    return, and assert it stays unflipped after CONFLICT.
  - Case: cheap pre-filter conflict — the caller passed an `expectedHash` and
    the file already differs *before* any write attempt (architect's step 2
    check) → also produces `CONFLICT`, without even needing the injected
    hook, since the mismatch is detected before any read-modify-write begins.
  - **Racing dashboard-vs-dashboard writes on the same cwd serialize via the
    mutex, not conflict with each other**: two `appendPlanItem` calls issued
    back-to-back (no `await` between them) for the same cwd both eventually
    succeed, each producing its own distinct new row — proving the
    documented `Map<cwd, Promise>` mutex, not the optimistic-lock path,
    is what handles same-process concurrency (they should never see each
    other as a CONFLICT).

- **`describe("sanitization — adversarial LLM-influenced input")`** — unit
  tests on the sanitize function in isolation (no file I/O, no DB), since
  DEC-13 made this mandatory specifically because content can originate
  unattended from Layer 6's LLM half:
  - Embedded fake `id:` continuation line inside `text`/`detail` (e.g.
    `"Some text\n      id: deadbeef"`) is neutralized — assert the composed
    markdown block, when fed back through `parsePlanMarkdown`, does **not**
    produce a second `id` value or a phantom extra item; the forged line
    must not be parseable as a continuation line at all (either the newline
    is stripped/escaped, or the whole line content is quoted/prefixed such
    that `ID_LINE_RE` cannot match it post-composition — assert the actual
    parse-back result, not just that the raw string was transformed, since
    the parse-back is the thing that actually matters here).
  - Same for a forged `acceptance:`/`detail:` continuation line
    (`ACCEPTANCE_LINE_RE`/`DETAIL_LINE_RE`) — one case each.
  - Raw newline injection with no fake field-line keyword at all (e.g.
    `"Ship it\n- [ ] 99. injected fake item"`) — assert the composed output,
    parsed back, does not produce an extra top-level item at all.
  - Oversized content: `text`/`acceptance`/`detail` each individually
    exceeding `plan-ingest.js`'s existing `MAX_TEXT_LEN` / `MAX_ACCEPTANCE_LEN`
    / `MAX_DETAIL_LEN` (import these from `plan-ingest.js`'s exports rather
    than hand-copying the numbers, matching the architect's explicit
    "reuse, never re-derive" instruction) is truncated/rejected by the
    sanitizer itself, **before** composition — do not rely on `plan-ingest.js`'s
    own truncation on the next read to save you; assert the sanitizer's
    output already respects the cap.
  - Combined worst case: a single adversarial string containing newline +
    fake `id:` + oversized length all at once — assert all three guards
    apply together, order-independent of which guard "wins."
  - A clean, ordinary string (no newlines, no field-line keywords, under all
    length caps) is byte-identical after sanitization — a negative control
    proving the sanitizer isn't overly aggressive on legitimate content.

- **`describe("MAX_ITEMS / byte-cap pre-flight")`**
  - A file already at `plan-ingest.js`'s `MAX_ITEMS` (or right at
    `MAX_FILE_BYTES`) rejects the append with a loud, structured error
    (not a silent write that the next ingest would then quietly drop) —
    per the architect's explicit "writer must check the same caps the
    reader has" risk.

- **`describe("traceability — plan_items row back to its detour_dispositions row")`**
  - Sequence the real round trip explicitly, since the two identifiers
    involved become known at different times: (1) call `appendPlanItem`,
    capture its returned minted `id:` string; (2) call the real
    `ingestPlanForCwd`; (3) `SELECT` the new `plan_items` row by
    `(cwd, item_id)` to obtain its integer `plan_items.id`; (4) write that
    integer onto a seeded `detour_dispositions` row's `linked_plan_item_id`
    (mirroring the architect's Q1 schema) plus a `resolved_at` timestamp;
    (5) assert a query starting **only** from the `detour_dispositions.id`
    (as if a human were auditing "what did this decision actually write?")
    joins to the correct `plan_items` row and that row's `text`/`acceptance`
    match what the disposition recorded as its intent, and that the
    disposition's `disposition` value (`fold_in`/`new_item`), `session_id`
    it came from, and `resolved_at` are all readable from that same lookup —
    i.e. "which detour, which classification, when" (DEC-13's exact phrasing)
    is answerable in one query, not reconstructed from logs.
  - Negative case: a disposition that resulted in `CONFLICT` (never
    successfully wrote) has `linked_plan_item_id IS NULL` and a status that
    is distinguishable from a successful write — a future audit must be able
    to tell "this disposition never actually landed in the file" apart from
    "this disposition landed and here's where."

**`server/__tests__/detour-disposition.test.js`** (superseding the original
qa.md's spec for this file) — update, don't duplicate, the `fold_in`/
`new_item` bullets:
- Delete/replace DEC-12's "must NOT create a `plan_items` row" assertions —
  they are now factually wrong under real write-back.
- Replace with: disposing a detour as `fold_in`/`new_item` drives a call into
  `plan-writeback.js` (stub it here if this spec's focus is disposition
  logic, not file I/O — integration coverage of the real write lives in
  `plan-writeback.test.js` above; don't re-test file mechanics twice) and,
  on success, sets `linked_plan_item_id` and flips `status` to `resolved`;
  on `CONFLICT`, leaves `status` at `proposed` for retry — this is the
  caller-side half of the "not silently lost" guarantee that
  `plan-writeback.test.js`'s conflict describe block tests from the callee
  side.
- Idempotency assertion (already in the original spec) still holds and now
  additionally must confirm: re-dispatching an already-`resolved` disposition
  does not call `plan-writeback.js` a second time at all (not just "doesn't
  duplicate the row") — a second unnecessary file write is itself a
  regression under DEC-13's minimize-unattended-writes framing.

**`server/lib/atomic-file.js` extraction — minimal new baseline coverage**
(either a new small `server/__tests__/atomic-file.test.js`, or folded into
`plan-writeback.test.js` if the extraction is small enough that a separate
file would be thinner than its own header/boilerplate — architect's call):
- Successful write: content on disk matches exactly, no stray `.tmp` file
  left behind.
- A write failure mid-way (simulate by pointing `filePath` at a directory
  that doesn't exist and isn't creatable, or stub `fs.renameSync` to throw)
  leaves the **original file untouched** and the `.tmp` file removed — the
  existing `atomicWriteFile` in `cc-mutate.js` already claims this behavior
  in its own comment; this is the first test that actually pins it.

### 4. Test data / fixtures — Layer 4

- **Seeded `AGENT-PLAN.md` fixtures**: reuse `plan-ingest.test.js`'s
  `writePlan()` helper pattern verbatim for constructing before-state files;
  do not hand-roll a second file-writing helper in the new spec.
- **Conflict-window fixture**: the injected hook (`__injectPreRenameHookForTest`
  or equivalent) itself *is* the fixture for the race — no timing, sleeps,
  or worker threads needed. The hook's callback body is just
  `fs.writeFileSync(planPath, humanEditedContent)`.
- **Adversarial content fixtures**: build a small table of
  `{ name, input, mustNotAppearAsParsedField }` cases (fake `id:`, fake
  `acceptance:`, fake `detail:`, bare injected item line, embedded newline
  with no keyword, oversized-by-1-byte, oversized-by-10x, combined worst
  case, clean control) — table-driven, one `it()` per row, matching this
  repo's existing table-driven style (see `reconciliation.test.js`'s
  guidance in the untouched Layer 6 section above for the same pattern).
- **`detour_dispositions` seed rows for the traceability test**: minimal
  direct `INSERT` via `stmts`/raw SQL (same technique `plan-ingest.test.js`
  uses to seed `declared_done_at` directly for its reorder-identity tests)
  rather than depending on the full Layer 4 disposition pipeline being
  wired end-to-end — keeps this spec independently runnable regardless of
  `detour-disposition.test.js`'s own build order (per DEC-3's Layer 5 → 4 → 6
  sequencing, this file may need to exist before the disposition module
  that would otherwise seed it).

### 5. Definition of Done checklist — Layer 4 additions

- [ ] `server/__tests__/plan-writeback.test.js` exists and passes, covering:
      happy-path write-survives-re-ingest (both `appendPlanItem` and
      `appendSubItem`), optimistic-lock conflict with verified no-data-loss
      on both sides, same-cwd mutex serialization, adversarial sanitizer
      inputs, `MAX_ITEMS`/byte-cap pre-flight rejection, and the
      disposition-to-plan_items traceability round trip.
- [ ] The DEC-12 "must not create a `plan_items` row" assertions are removed
      from `detour-disposition.test.js` and replaced with the DEC-2/DEC-13
      real-write-back assertions above — grep the test suite for any
      remaining `plan_items row count is unchanged` assertion tied to
      `fold_in`/`new_item` and confirm it no longer exists (a stale copy of
      the superseded assertion silently passing would mean the two dispositions
      are, in practice, not writing anything).
- [ ] Sanitization is proven by parsing the *composed output* back through
      `parsePlanMarkdown`, not merely by inspecting the sanitized string —
      the actual risk is what the parser does with it.
- [ ] Every successful write-back call in the test suite is followed by a
      real (not stubbed) `ingestPlanForCwd` call — no test asserts
      write-back "succeeded" based on the file write alone without proving
      the row it's supposed to produce actually lands via the real ingest
      path.
- [ ] A disposition that ends in `CONFLICT` is distinguishable from one that
      succeeded, purely by querying `detour_dispositions` (no log-reading
      required) — `linked_plan_item_id IS NULL` and a non-`resolved` status.
- [ ] `server/lib/cc-mutate.js`'s `atomicWriteFile` extraction to
      `server/lib/atomic-file.js` ships with baseline coverage (this is
      currently zero-coverage code being promoted to shared, doubly-relied-on
      infrastructure).
- [ ] Pre-existing `plan-ingest.test.js` and `plans-api.test.js` still pass
      unmodified — confirms `plan-writeback.js` really did reuse the real
      ingest path rather than quietly re-deriving file semantics a second
      time (§9.1-shaped risk the architect flagged explicitly).
- [ ] `npm run test:server` passes end-to-end including the new spec(s).
- [ ] Manual verification steps in this section's §1 walked through once
      against a real seeded project (including the injected-hook conflict
      scenario reproduced manually via a paused breakpoint or a temporary
      `console.log`+manual-edit dry run) before calling Layer 4 done.
