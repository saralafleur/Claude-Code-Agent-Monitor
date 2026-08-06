# Coverage Map — Value Pool Slice 3 ("Auto-group proposal engine")

**Role:** Coverage Cartographer (pre-build pass — nothing in Slice 3 is built
yet). This maps EXISTING coverage for the surfaces Slice 3 will touch or
depend on, per the change brief and technical plan. It does not evaluate new
test design (that is the unit/e2e architects) and does not judge risk (that
is the risk analyst).

**Inputs read:** `qa/change-brief.md`, `technical-plan.md`, `PROJECT-CONTEXT.md`
(§9.1, §9.3, §9.6, §9.7, §9.8), plus live reads of `server/lib/value-ledger.js`,
`server/lib/value-summary.js`, `server/lib/focus-summary.js`, `server/db.js`,
`server/routes/project-plans.js`, `server/__tests__/project-plans-api.test.js`,
`server/__tests__/single-writer-guard.test.js`, `server/__tests__/focus-summary.test.js`.

**Test stack (discovered, matches `PROJECT-CONTEXT.md`/`CLAUDE.md`):**
- Backend: Node's built-in `node:test` runner, one spec-per-module convention
  under `server/__tests__/*.test.js`, run via `npm run test:server`
  (also individually: `node --test server/__tests__/<file>.test.js`).
- Frontend: Vitest + React Testing Library, `client/src/**/__tests__/*.test.tsx`,
  run via `npm run test:client`; per-screen render snapshots live at
  `client/src/pages/__tests__/screens.snapshot.test.tsx`.
- No separate e2e/integration layer beyond the above two suites was found for
  this feature area — API-level behavior is exercised by the backend suite's
  in-process route tests (real Express app + real SQLite temp DB, no mocked
  HTTP layer), which functions as this project's "integration" layer. No
  smoke/regression/serial tag convention exists; it's one flat suite per file.

---

## 1. Existing coverage by surface

### 1a. SF-4 extraction target — `buildProbeCoverage` / two coverage-composition call sites

- **Route source (today, pre-extraction):** `server/routes/project-plans.js`
  — `POST /coverage-request` (composition inlined at `:319-334`) and
  `GET /coverage` (`:352-365`), each independently calling
  `valueLedger.assembleValuePool` → `enrichPoolAltitudes(..., {probe:true})` →
  `coverageSnapshot(...)`.
- **Test:** `server/__tests__/project-plans-api.test.js:905`, `it("T7 (SF-4): the
  POST /coverage-request and GET /coverage handlers compose their
  coverageSnapshot call from identical building blocks")`. Confirmed live,
  byte-for-byte matches the brief's citation:
  - Regex-extracts each handler body and asserts each literally contains
    `await valueLedger.assembleValuePool(dbModule, { id: projectId })` and
    `await enrichPoolAltitudes(dbModule, units, { probe: true })` and
    `draining: isDrainingProject(projectId)` (lines 919-948).
  - Then extracts the `coverageSnapshot(dbModule, {...})` argument key set from
    each handler body and asserts `deepEqual(postKeys, getKeys)` **and**
    `deepEqual(postKeys, ["computedAt","counts","draining","projectId","requestedAt"])`
    (lines 988-998) — the anchored half technical-plan.md §6.1 says survives.
  - Adjacent: `T6` (`:886-903`) response-shape assertion on `GET /coverage`
    (unaffected by extraction, will keep passing).
- **`value-coverage-parity.test.js`** (G2, route↔tick) exists and passes today;
  compares the *route* against the *tick*, not route↔route — this is why
  route↔route composition has "no home" per PROJECT-CONTEXT.md's 2026-08-05
  note, and is exactly the gap T7 fills today and `buildProbeCoverage`'s
  single-call-site guard is meant to replace it with.
- **Verdict:** **GUARDED, but by a test that is *designed to go red on
  extraction*.** T7 currently detects the SF-4 duplication (its whole reason
  for existing) and its behavioral half — the anchored response-key-set
  assertion at `:988-998` — is not going anywhere; the *body-substring* half
  (lines 919-948) is inherently coupled to the current inlined-code shape and
  must be deleted, not adapted, when `buildProbeCoverage` lands (technical-plan
  §6.1 / WATCH-S3-D, correctly identified in the plan). There is **no test today**
  for the not-yet-existing `value-coverage-probe.js` module or its
  single-call-site guard — that is new coverage, not a gap in old coverage.

### 1b. `CONSUMERS` registry (`value-ledger.js`) and `assertSingleHome` consumer maps

- **`CONSUMERS` array** — `server/lib/value-ledger.js:70-74`, exactly 3 entries
  today: `server/routes/project-plans.js`, `bin/ccam.js (cmdLedger)`,
  `server/lib/value-summary-tick.js`. No test directly asserts this array's
  *contents* today (it is a documentation/tripwire list, not itself
  mechanically checked against real importers) — confirmed by reading the full
  file; nothing greps `CONSUMERS` against `require("./value-ledger")` sites.
  **This registry's own completeness is UNGUARDED today** (consistent with
  PROJECT-CONTEXT.md §9.7's "hand-typed, not derived" diagnosis of this exact
  list, occurrence 7/SF-5 on 2026-08-05).
- **`assertSingleHome` maps, `server/__tests__/single-writer-guard.test.js`:**
  - `../lib/value-ledger` map at `:462-479` (`it("value-ledger.js's exports
    have an explicit disposition at the tick")`) — 1 consumer disposed
    (`../lib/value-summary-tick`), confirmed live.
  - `../lib/value-summary` map at `:400-460` (`it("value-summary.js's exports
    have an explicit disposition at every consumer")`) — 3 consumers disposed
    (`../routes/project-plans`, `../lib/value-summary-tick`,
    `../lib/value-coverage`).
  - Both are real, content-anchored tests (each export gets an explicit
    `shared`/`absent` disposition, not existence-only) — this is the shape
    PROJECT-CONTEXT.md's §9.7 2026-08-05 note calls out as *working* when
    applied (the export axis is derived from the real module; the *consumer*
    axis is still hand-typed, which is the exact axis Slice 3 must extend).
  - Neither map currently disposes `../lib/value-groups` (it doesn't exist).
- **Verdict:** **GUARDED for the current, pre-Slice-3 consumer set** (both
  maps are real and would catch a stale disposition today), but **the
  consumer-axis-is-hand-typed weakness PROJECT-CONTEXT.md names is live and
  directly relevant to Slice 3**: this exact axis on this exact test file
  silently went stale once already (SF-5, 2026-08-05, caught only by
  reviewer, in the *same build* that was editing the map). Slice 3 adding
  `value-groups.js` to both maps is new coverage the plan already commits to
  (technical-plan §9, §11.5) — the registry-gap risk is real and is the
  reason technical-plan.md explicitly assigns a red-proof procedure to it
  (§11.5) rather than treating "add it to the map" as low-risk busywork.

### 1c. `summaryModel("grouping")` / `SUMMARY_STAGES` cascade (already shipped, Slice 2/DEC-10)

- **Source:** `server/lib/value-summary.js:107` (`SUMMARY_STAGES = ["unit",
  "grouping"]`), `:122-131` (`summaryModel(stage = "unit")` fallback cascade:
  per-stage env override → shared `DASHBOARD_VALUE_SUMMARY_MODEL` → Focus
  summary model → Focus infer model → `"haiku"`). JSDoc at `:100-106`
  explicitly states the `"grouping"` stage has "NO consumer yet in this
  codebase" and instructs a dead-code sweep not to flag it.
- **Test:** `server/__tests__/value-summary.test.js:342` (`SUMMARY_STAGES is
  the closed two-entry registry`, `deepEqual(SUMMARY_STAGES, ["unit",
  "grouping"])`) and `:357-371` (three cases: per-stage override takes
  precedence for `"grouping"`, falls through the shared chain, falls all the
  way to `"haiku"`).
- **Verdict:** **PARTIAL.** The cascade *function* is real, non-vacuous
  coverage (three genuinely distinguishing cases, confirmed by reading the
  test bodies). But every case calls `summaryModel("grouping")` directly —
  there is no route, tick, or module that actually *invokes* it in a
  production code path, because none exists yet. Slice 3 is genuinely the
  first real caller (matches the brief and the plan's own claim). This is
  coverage of the *utility function in isolation*, not coverage of "grouping
  synthesis picks the right model" as an end-to-end behavior — that gap only
  closes when `value-groups.js`'s `refineBatch` exists and is tested against
  a stubbed spawn asserting the resolved model was actually passed through.

### 1d. `value_claims`'s relational shape (schema precedent for `value_group_members`)

- **Source:** `server/db.js:790-819`. Header comment explicitly states the
  precedent Slice 3 is built to reuse: *"Note what is absent: there is no
  closed_at / closed flag here. A claim's closed-ness is a JOIN to
  project_plans.status — copying the stamp onto N rows is 9.1's write-sequence
  form."* This is the literal design precedent technical-plan.md §4 cites for
  giving `value_group_members` no availability column (§3.4: "the same cure
  `value_claims` used by having no `closed_at`").
- **Test coverage of the precedent itself:** `value_claims`'s schema/CHECK
  shape is exercised incidentally through `server/__tests__/value-ledger.test.js`
  and the route-level plan/claim tests in `project-plans-api.test.js`
  (claim creation, dedupe on the `(value_source, value_ref, source_cwd,
  item_id)` unique index) — real behavioral tests exist for claim creation and
  the join-not-copy closedness pattern, but there is no test asserting
  the *absence of a `closed_at` column* as a structural invariant (i.e.
  nothing would fail if a future edit added one back).
- **Verdict:** **GUARDED for claim read/write correctness** (the pattern
  `value_group_members` is modeled on is itself exercised, not just
  documented); **UNGUARDED for "the derive-don't-copy shape is itself
  protected from regressing"** — that's a design precedent enforced by
  convention/review, not by an assertion, on both the existing table and (per
  the technical plan) the new one. This is a real but narrow gap: it affects
  the *precedent's* durability, not Slice 3's own correctness, and the
  technical plan doesn't claim otherwise.

### 1e. `focus-summary.js`'s day→window rollup pattern (precedent for Slice 3's hierarchical decomposition)

This is the pattern technical-plan.md §5.3 models Slice 3's
mechanical/refinement batching+rollup on, and PROJECT-CONTEXT.md §9.8
identifies it as the **original correct version** of a pattern whose *first
copy* (`value-summary.js`'s `MAX_UNITS_PER_PROMPT`) dropped the two halves
that made the original honest — decompose (no cap ever drops a whole day) and
disclose (a failed day degrades to raw facts instead of vanishing). Slice 3's
own risk section names this as "the single most likely defect in this slice."

- **Source:** `server/lib/focus-summary.js` — `DIRECT_WINDOW_MAX_DAYS = 2`
  (`:70`), `generateHierarchicalSummary` (`:429-538`): per-local-day direct
  summaries cached individually, then one rollup call synthesizes the window
  from the day bullets; a day whose own synthesis call fails degrades to its
  raw fact lines rather than being dropped (module header `:14-21` states this
  explicitly).
- **Test:** `server/__tests__/focus-summary.test.js`, `describe("hierarchical
  (multi-day) summaries")` (`:331-424`), two real, content-anchored cases
  (confirmed by reading both bodies in full):
  - `"summarizes each day, rolls them up, and caches every layer"` (`:357-399`)
    — seeds 3 real sessions across 3 real local days, stubs a 4-call spawn
    sequence (3 day summaries + 1 rollup), asserts the call count is exactly 4,
    asserts the rollup prompt text contains each day's own bullet text
    labeled by date, asserts each day landed in the cache under its own
    scope-qualified key with the right stored content, then re-runs on an
    unchanged window with the spawn stubbed to *throw* if called at all and
    asserts zero spawns / cache hit.
  - `"degrades a failed day to raw fact lines instead of dropping it"`
    (`:401-423`) — the disclose half: day two's spawn call returns `exitCode:
    1`; asserts the run still produces a rollup result, and that the rollup
    *prompt itself* still contains day two's raw fact line (`/unplanned
    work/`) rather than silently omitting the day.
- **Verdict:** **GUARDED, and non-vacuous.** Both the decompose half (whole
  days never split/dropped, one rollup call synthesizes from real per-day
  output) and the disclose half (a failed day survives as raw facts, not
  silence) are exercised with fixture-anchored assertions on actual prompt
  content and actual persisted rows — not existence-only or shape-only checks.
  This is exactly the shape Slice 3's own DoD (§5.3, §11.2) commits to
  reproducing for cluster batching. **The prior copy's failure mode is
  independently confirmed via PROJECT-CONTEXT.md §9.8:** `value-summary.js`'s
  `MAX_UNITS_PER_PROMPT` copied `focus-summary.js`'s cap and rationale comment
  but dropped both halves (no decompose, no disclose) when it first shipped;
  that specific defect was later fixed (2026-08-04, `enrichPoolAltitudes`
  gained `queued`/`unavailable` discrimination and a draining sweep) but via a
  **different concrete mechanism** (background sweep + discriminated state,
  not hierarchical per-batch rollup) — so `value-summary.js`'s fix is not
  itself a second instance of *this* pattern's test shape, and Slice 3 cannot
  inherit coverage from it. Slice 3 is grounded directly in
  `focus-summary.js`'s original (well-tested) pattern, which is the right
  precedent to copy from; the coverage above is real evidence that copying it
  faithfully — including both halves this time — is achievable and testable
  the same way.

---

## 2. Coverage verdict per surface (summary table)

| Surface | Verdict | Why |
|---|---|---|
| SF-4 composition (`buildProbeCoverage` extraction target) | **GUARDED (designed to go red on extraction)** | T7 (`project-plans-api.test.js:905`) currently detects the exact duplication being extracted; its behavioral response-key-set half survives extraction, its body-substring half is deleted by design (technical-plan §6.1) |
| `CONSUMERS` registry completeness | **UNGUARDED (list itself)** | no test greps real importers against the hand-typed array; only the parallel `assertSingleHome` maps are tested, and only on their export axis |
| `assertSingleHome` consumer maps (value-ledger, value-summary) | **GUARDED for current consumer set / structurally weak on the axis Slice 3 must extend** | both maps are real, content-anchored, non-vacuous today; the *consumer* axis is hand-typed and has gone stale before (SF-5, same file family) |
| `summaryModel("grouping")` / `SUMMARY_STAGES` | **PARTIAL** | cascade function itself is well-tested in isolation (3 real cases); zero coverage of it being invoked by a real caller, because none exists pre-Slice-3 |
| `value_claims` relational shape (schema precedent) | **GUARDED for claim behavior / UNGUARDED for the "no closed_at" structural invariant itself** | claim creation/dedupe is exercised; nothing would fail if a future edit reintroduced a copied status column |
| `focus-summary.js` day→window rollup (hierarchical precedent) | **GUARDED, non-vacuous** | both decompose and disclose halves are fixture-anchored and content-asserted; this is the pattern Slice 3 must reproduce faithfully, and the evidence says the pattern itself is trustworthy to copy from |
| Slice 3's own surfaces (`value-groups.js`, 3 new tables, 4 new routes, `PlanLedgerPanel` groups UI) | **UNGUARDED (net-new, none built)** | confirmed 0 hits for `value_groups`/`value-groups` across `server/` and `client/` source and `server/__tests__/`; this is expected and not a defect — it's the reason this slice exists |

---

## 3. Registry/consistency gap check

This project's canonical-source-of-truth surfaces relevant here, per
`PROJECT-CONTEXT.md` §9.1/§9.7 and technical-plan.md §13:

1. **`assembleValuePool` (sole pool composer, DEC-16)** — `CONSUMERS` array,
   `value-ledger.js:70-74`. Today's 3 entries each have a real downstream
   consumer; nothing today mechanically re-derives this list from actual
   `require("./value-ledger")` call sites, so **the list's own completeness is
   an UNGUARDED surface today**, independent of Slice 3. Slice 3 adding
   `value-groups.js` as a 4th, hand-typed entry (technical-plan O-8) does not
   change that — it is one more manually-added row to a list nothing checks
   against reality. Cite PROJECT-CONTEXT.md §9.7 (7 recorded occurrences on
   this project, most recently SF-5/N2 on 2026-08-05, both on this exact file
   family) as the defect-catalog precedent for this exact gap shape.
2. **`buildProbeCoverage` (sole probe-coverage composition, once built)** —
   plan commits to a derived-scope, fail-closed single-call-site guard
   (technical-plan §6.2). This does not exist yet (module doesn't exist);
   flagged here as the specific mechanism that would close today's SF-4 gap
   (T7 currently protects the *duplication*, not a *single home*, since there
   isn't one yet).
3. **`assertSingleHome` consumer maps (`value-ledger.js`, `value-summary.js`)**
   — both real today on the export axis; both need `value-groups.js`
   registered on the consumer axis in the same commit the new `require` lands
   (technical-plan §11.5), citing the exact prior failure (SF-5, 2026-08-05:
   "a build edited the very map it needed to register itself in, and still
   didn't").

No entry in `value_claims`' `value_source` CHECK list currently lacks a test —
`server/__tests__/value-ledger.test.js` and related specs exercise the current
5-value `VALUE_SOURCES` list — but this is scoped to today's claims surface,
not the not-yet-existing `value_group_members.value_source` CHECK the
technical plan requires to assert equal to `valueLedger.VALUE_SOURCES` (§4,
schema-level obligation 1). That assertion is new coverage to be written, not
a gap in what exists.

---

## 4. Current baseline (run 2026-08-06, pre-Slice-3)

**`npm run test:server`** — full backend suite, real Express app + real
SQLite temp DB per suite, no mocked HTTP layer:

```
# tests 1787
# suites 444
# pass 1787
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 59168.814333
```
**GREEN, 1787/1787.**

**`npm run test:client`** — Vitest + React Testing Library:

```
Test Files  61 passed (61)
     Tests  822 passed (822)
  Duration  6.59s
```
**GREEN, 822/822.**

Both suites were run in full (not targeted) because Slice 3 touches
cross-cutting registries (`CONSUMERS`, both `assertSingleHome` maps,
`chronology-ordering.test.js`'s `filesToScan`, `db-migration.test.js`'s
registry-completeness meta-test) whose blast radius isn't confined to one
spec file, and because this is the pre-build baseline the eventual QA verdict
needs to diff against — a partial run would not establish "nothing was
already red before Slice 3 touched anything." No service was unavailable;
nothing was skipped.

**This is the baseline. When Slice 3 lands SF-4 extraction, T7 in
`project-plans-api.test.js` is *expected* to go red as a designed step (see
§1a) — that is not a regression against this baseline, it's the documented,
same-commit replacement the technical plan requires (WATCH-S3-D). Any other
red result in `project-plans-api.test.js`, or any red result anywhere else in
either suite, is a real regression against this 1787/822 baseline.**

---

## 5. Conventions in play (for the test architects)

- **Backend specs:** one file per module/surface under `server/__tests__/`,
  `node:test` + `node:assert`, named `<module-or-feature>.test.js`. The
  technical plan's own file list already follows this:
  `value-groups-mechanical.test.js` (LLM-free stage), `value-groups-refinement.test.js`
  (stubbed spawn/persistence/rollup/disclose), `value-groups-api.test.js`
  (routes/gate/drift/negative proof), `value-coverage-probe.test.js`
  (extraction behavior) — each maps to one real module or one real route
  surface, matching every existing precedent (`value-summary.test.js`,
  `value-coverage.test.js`, `value-ledger.test.js`, `project-plans-api.test.js`).
- **Cross-cutting/registry specs live in shared files, not per-module ones** —
  `single-writer-guard.test.js` (single-home + `assertSingleHome` + writer
  guards), `chronology-ordering.test.js` (`filesToScan`-derived SQL-shape
  scan), `db-migration.test.js` (`UPGRADE_CASES`/`REBUILD_CASES`
  registry-completeness meta-test). Slice 3 edits all three in place rather
  than inventing new homes — matches this project's own repeatedly-stated
  diagnosis (PROJECT-CONTEXT.md, multiple entries) that "per-shape" specs
  need a **named file**, not an assumption that they'll get written inside a
  per-module spec.
- **Client specs:** `client/src/components/__tests__/<Component>.test.tsx`
  (RTL + Vitest); `PlanLedgerPanel.test.tsx` already exists for the current
  panel. The plan's `PlanLedgerPanel.groups.test.tsx` follows the project's
  established `<Component>.<extension-scope>.test.tsx` convention (parallel
  to `Sidebar.openTerminal.test.tsx`, `SessionCard.tokens.test.tsx` in the
  current tree) rather than growing the existing file — right call given the
  file's own PM-5a/PM-5b obligations (entity-switch reset, StrictMode) are
  scoped additions, not a rewrite.
- **Screen snapshots:** `client/src/pages/__tests__/screens.snapshot.test.tsx`
  — per repo policy (CLAUDE.md), review the diff and regenerate deliberately
  with `cd client && npx vitest run -u`, never blind-update.
- **Red-proof discipline (binding, not optional, per PROJECT-CONTEXT.md §9.3):**
  every new structural/regression guard in this change must be observed red
  against a real mutation of the thing it names, independently re-run (not
  self-reported), before it counts as done — this project's own catalog has
  9 recorded §9.3-family events on the immediately preceding build alone
  (`intake/2026-08-04-altitude-invalidation/`) on this exact file family.
