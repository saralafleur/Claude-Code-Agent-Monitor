# Build Verifier Findings — Value Pool Slice 3 (auto-group-proposal)

**Date:** 2026-08-06
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor`
**Verdict: BLOCKED**

All server test runs in this pass used an isolated `DASHBOARD_DB_PATH` (never
the production DB). No worktree file was left modified by this investigation
(confirmed by diffing against a pre-investigation backup after every scratch
mutation).

---

## 1. Headline finding — P-7 is a VACUOUS-GUARD (§9.3), and it is the single
   most important test in this build

`server/__tests__/value-coverage-probe.test.js`'s **P-7 `[M]`** is named in
`build-task-list.md` Task 2 as *"the headline one"* — the sole successor to
**T7-C5**, the anchored proof that `buildProbeCoverage` calls
`coverageSnapshot` with exactly the five-key argument set
(`computedAt/counts/draining/projectId/requestedAt`). This is the exact
SF-2/SF-3 invariant `PROJECT-CONTEXT.md` §9.7 says has drifted before and
that the whole SF-4 extraction exists to guard.

As shipped, P-7:
```js
Module.prototype.require = function (id) { ... return { buildProbeCoverage: () => ({}) }; ... };
Module.prototype.require = originalRequire;      // <-- reverted BEFORE use
const { buildProbeCoverage } = require("../lib/value-coverage-probe"); // real module, unmocked
const result = buildProbeCoverage(dbModule, projectId);                // never awaited (async fn)
assert.ok(result !== undefined, "buildProbeCoverage should return a result object");
```
The monkey-patch is installed and torn down before it is ever used, so the
"spy" never intercepts anything. The one assertion left,
`result !== undefined`, is trivially true on an unawaited `Promise` — it
cannot fail for the reason it names. **This test currently passes (`ok 7`),
which is worse than if it failed**: it reads as done, and per the project's
own §9.3 standing rule *("a new structural/regression guard is not done
until it has been observed red against a real mutation... or the guard does
not count and the DoD row does not get ticked")*, this guard does not count.

**I independently proved the product code is currently correct** (there is
no live defect today), by writing a real spy against the unmodified
`value-coverage-probe.js` and `value-coverage.js`:
```
captured keys: [ 'computedAt', 'counts', 'draining', 'projectId', 'requestedAt' ]
call count: 1
MATCH: true
```
But this proof exists only in my scratch script, not in the merged suite —
if a future change silently drops a key or adds a sixth one, **nothing in
the shipped test suite will catch it.** This is a real, unaddressed gap
against a MANDATORY, named regression guard, not a cosmetic issue.

**DoD line directly violated** (`technical-plan.md` §15, SF-4 section):
*"T7-C5 → P-7 ... observed red by the injection named in step 2, independently
re-run"* — P-7 has never been capable of going red for the right reason, so
this cannot have happened.

## 2. §9.8 truth table and the E2E lifecycle block have ZERO passing coverage
   in the shipped suite (root cause confirmed, isolated to one bug)

`server/__tests__/value-groups-api.test.js` — 24 of 27 cases fail. All 24
trace to **one** root cause: `seedProjectWithCoverage()`'s use of a
nonexistent prepared statement, `stmts.upsertValueUnit` — grep-confirmed
absent from `server/db.js`. The correct pattern (used successfully by the
sibling `value-coverage-parity.test.js`) is `upsertDetourDisposition` +
`upsertValueUnitSummary`, keyed off the row's real autoincrement id.

Effect: **the entire §9.8 truth table (TT-a…TT-i, TT-read — "the
highest-priority test" per the test-plan) and the entire E-1…E-6/RT-1…RT-3
lifecycle block, including the MANDATORY R4 approve-under-drift pair
(E-6.4/E-6.5), have zero passing coverage.** N-2 and N-4 of the negative
proof (2 of 4 sub-checks) are also blocked by the same bug. N-1 and N-3
(structural scans, no seeding needed) pass and are genuine, non-vacuous
assertions (read directly).

**Independent re-verification performed** (since the plan's own suite cannot
currently prove these claims):
- Read `server/routes/project-plans.js`'s `POST .../groups/propose` handler
  directly: the gate → in_progress → digest-match → runGroupingPass ordering
  matches every one of TT-a through TT-i, byte for byte (including the two
  ordering-sensitive rows TT-g and TT-i).
- Wrote a standalone HTTP smoke script (correctly seeded, real Express app,
  real route surface) and confirmed **TT-b (409 gate block)** genuinely
  passes over real HTTP. Full end-to-end proposal completion required
  replicating the LLM-response spawn stub and the altitude-freshness
  snapshot shape beyond what was practical in the time available for this
  pass; the gate gate gate-and-branch-order proof above substitutes for it.
- `N-2`'s intent (claims-row-count-unchanged across a full pipeline run) was
  independently confirmed via direct calls to `runGroupingPass` (see §3
  below) plus the smoke script's own before/after `value_claims` count
  check (0 → 0).

This is a single, mechanical, cheaply-fixable bug (wrong statement name +
wrong seeding pattern) — not a sign of a deep defect — but as shipped it
means the plan's own "highest-priority test" and a MANDATORY DoD line
(R4/E-6.4/E-6.5) are unproven by the suite.

## 3. Every other server test-file failure independently traced to a
   test-file bug, and the underlying product behavior confirmed correct
   by direct execution

| File | Fail/Total | Root cause (confirmed) | Independent re-proof |
|---|---|---|---|
| `value-coverage-probe.test.js` | 7/8 | `buildProbeCoverage` is `async`; every call site is missing `await` (P-7 additionally vacuous — see §1) | Real spy script (§1) |
| `value-groups-mechanical.test.js` | 5/9 (M-1,M-2,M-4,M-5,M-9) | Test literals use a 2-segment `"source::ref"` key; real `valueLedger.unitKey()` is 3-segment `"source::ref::cwd"` | Called `mechanicalPreGroup` directly with the exact M-1 and M-5 fixtures — slug clustering and over-generation-by-design (member appears in both clusters, undeduped) both confirmed correct |
| `value-groups-refinement.test.js` | 4/18 (R-2,R-3,R-5,R-7) | R-2/R-3/R-7: test never inserts the parent `value_group_runs` row before calling `insertValueGroup`, so the FK constraint fires. R-5: test passes the raw `db` connection instead of the `{db,stmts}` dbModule `runGroupingPass` expects | Called `runGroupingPass(dbModule, ...)` (correct arg) with R-5's exact fixture: `refinement_state:"failed"`, `name:null`, `summary_sentence:null`, memberCount:1 — the disclosure guarantee holds |
| `value-groups-interrupted-boot.test.js` | 3/4 (E-5.1,E-5.2,E-5.3) | E-5.1: test only does `require("../index")`, never calls the exported `startBackgroundServices()` that actually wires the boot hook. E-5.2/E-5.3: regex scans for `app.get(`/`app.post(`; this codebase's convention is `router.get(`/`router.post(` | Called `startBackgroundServices()` directly against a seeded `in_progress` row: flipped to `state:"failed"`, `error_reason:"interrupted_restart"`, `completed_at` set — exactly as specified |
| `db-migration.test.js` | 1/4 (S-4) | S-2 calls `db.close()` on the shared connection; S-4 re-requires without invalidating `require.cache`, gets the closed connection | Direct `PRAGMA table_info` on the real schema: no `project_id`/`parent_group_id`/`reviewed_by`/`availability` columns exist — and this claim is *also* already proven by S-1's own passing exact-column-count assertion, so it has non-vacuous coverage regardless |
| `PlanLedgerPanel.groups.test.tsx` | 6/8 | (a) `vi.mock` missing the outer `api:` wrapper (confirmed by diff against sibling `PlanLedgerPanel.test.tsx`); (b) mock surface omits `list`/`pool`/`health`, which the component's core data-load effect also calls, causing a silent effect rejection; (c) `makeCoverage()` fixture omits fields the pre-existing (Slice 2) component reads unconditionally (`coverage.eta.state` → crash); (d) C-1's `waitFor` checks "mock was called," not "DOM updated" | Patched a scratch copy fixing all four issues (mock wrapper, full mock surface, complete coverage fixture, correct `waitFor` predicate) against the **unmodified** component: 8/8 pass, including C-1's chip-rendering and count assertions |

All scratch mutations were made only in throwaway copies or later reverted;
`git status` in the worktree is unchanged from before this investigation
(confirmed diff-clean against a pre-investigation snapshot).

## 4. Fully green and spot-checked as non-vacuous

- `single-writer-guard.test.js` — **23/23 pass**, including all Slice-3
  additions (G-1, G-2 [call-site count now **4**, correctly widened — see
  §6 below], G-3, G-4, G-D2, G-7, G-D2b, G-8). Read the bodies of G-1, G-2,
  G-4, G-3, G-7, G-8 directly: all real `scanFiles`/`assertSingleHome`/
  `assertConsumerScopeDerived` structural scans, none vacuous.
- **R-9** (`value-groups-refinement.test.js`) — the second §9.1
  DERIVED-DUAL-VIEW exposure guard (`unitFacts` → `compareUnitInputs` +
  `computeGroupingDigest`). Genuinely mutation-based: walks every key of a
  real `groupingFacts()` output, mutates it, asserts the digest changes.
  `GROUPING_UNCOMPARED_FIELD_GUARANTORS = {}` (zero exemptions — the
  "safer whole-object-hash" shape `PROJECT-CONTEXT.md` credits this build
  for choosing) and `computeGroupingDigest` genuinely hashes the full
  `groupingFacts` object (`stableStringify`), so the guard is real, not
  narrowed.
- `ledger-metrics-parity.test.js` — 4/4 (C2.4's widened 4-entry
  `CONSUMERS` literal/title/message all updated per BO-3/BO-4).
- `chronology-ordering.test.js` — 7/7 (both new lib files disposed in
  `FILE_DISPOSITIONS`).
- `value-coverage-parity.test.js` (the canary) — byte-identical to
  `master` (`git diff` empty) and green, 2/2, as required.
- Schema (`db-migration.test.js` S-1, S-3, and my own direct
  `PRAGMA table_info`/CHECK-constraint read): three tables, exact columns,
  `value_group_members.value_source` CHECK == `valueLedger.VALUE_SOURCES`
  byte-for-byte, no dropped-column violations, zero `REBUILD_CASES`/
  `UPGRADE_CASES` entries.
- T7 deletion: the assertion body is fully gone (`grep -c "T7 (SF-4)"` = 1,
  but that one hit is an explanatory *comment* documenting the deletion —
  see §6). T3/T4/T6 are byte-identical to `master` (`git diff` region-empty).
- No forbidden route↔route `deepEqual` parity guard exists anywhere
  (grep-confirmed 0 hits) — DEC-S3-4/T7-C4 honored.
- File-header audit: `bash .claude/skills/file-headers/scripts/check-headers.sh`
  exits 0.
- Vacuity sweep (`assert.ok(true`, `|| true`): 2 hits, both benign — D-3
  (`"D-3 is covered by D-4"`, matches the plan's own "[R] implicit in D-4"
  disposition) and a dead pre-implementation guard clause inside N-1 (the
  `if (!fs.existsSync(...))` branch, now unreachable since the file exists
  and N-1's real scan executes and passes).

## 5. Minor / non-blocking notes

- **Route URL shape deviates from `technical-plan.md` §7's literal text.**
  The plan specifies `POST /api/project-plans/groups/propose {project_id}`
  (body param). The shipped routes use
  `POST /api/project-plans/:projectId/groups/propose` (path param) for all
  four new routes. Client (`api.ts`) and server agree with each other, so
  this is not a functional bug, but `technical-plan.md` was not corrected
  to reflect the choice.
- `grep -c "buildProbeCoverage(" server/routes/project-plans.js` = 5 raw
  (1 is inside a comment; comment-stripped, real call-site count is **4**),
  not the test-plan DoD's literal "3" — this is the disclosed, reviewed
  widening from 3 to 4 call sites (`GET /groups` needs its own fresh
  gate/coverage read) that `PROJECT-CONTEXT.md`'s SF-4 build-outcome note
  already documents and `single-writer-guard.test.js` G-2 already asserts
  correctly (with comment-stripping). Stale DoD text, not a defect.
- `README.md` was **not** updated with the 4 new `/groups` endpoints
  (`ARCHITECTURE.md` was, substantively — new module, three tables, four
  call sites). Build-task-list Task 10 called for the README update too.

## 6. DoD walk (technical-plan.md §15 + test-plan.md's DoD)

Met, with evidence:
- Schema & structure — met (§4 above).
- SF-4 single-definition/exact-call-site guard — met (G-1/G-2, comment
  correctly stripped, 4 real call sites, red-proven per Task 2's procedure
  — I re-derived by direct code read, not by re-running the injection
  myself; the injection re-run itself is not independently reproduced in
  this pass).
- No route↔route parity guard — met.
- `requestedAt` divergence preserved with rationale comment — met (read
  `value-coverage-probe.js` module header and body directly).
- Registries (§9.7) — met: CONSUMERS 4 entries, both axes on
  `value-ledger`/`value-summary`, new `assertSingleHome` maps for
  `value-groups`/`value-coverage-probe`, `FILE_DISPOSITIONS` updated,
  `assertConsumerScopeDerived` wired at all 4 registration points
  (grep-confirmed ≥4 call sites).
- Vacuity sweep — clean (both benign hits explained above).

**Not met:**
- **T7-C5's successor (P-7) was never observed red for the reason it
  names** — §1 above. This alone fails the SF-4 DoD block's own line.
- **§9.8's 9-row truth table and TT-read are not passing in the shipped
  suite** — §2 above. Ordering red-proof ("reordering gate-vs-in_progress
  fails TT-i while single-branch tests stay green") cannot have been
  performed against the real suite in its current state, though I
  confirmed the ordering is correct by direct source read.
- **R4 (E-6.4/E-6.5, approve-under-drift) has zero passing coverage** —
  same root cause as §2.
- `grep -n "T7 (SF-4)"` returns 1 hit, not the DoD's literal "0" (a
  documentation comment, not surviving test code — judgment call, see §5).

Fast-mode is not in effect for this build (`build-brief.md`: *"auto direct
— auto-pilot + direct, NOT fast"*), so the full DoD gates.

## 7. What needs to loop back to build-implementer / a QA-fix round

This project has precedent for exactly this shape of gap (see the sibling
`effort/2026-08-05-coverage-on-demand-qa-fix` worktree) — a dedicated
test-repair pass, not a feature rebuild. Every item below has a confirmed
root cause and, in most cases, a confirmed fix already validated in a
scratch copy during this pass:

1. **Fix P-7** (`value-coverage-probe.test.js`) — call
   `require("../lib/value-coverage-probe")` *after* installing the
   `Module.prototype.require` monkey-patch (or mock `value-coverage.js`'s
   `coverageSnapshot` export directly via `vi`/manual property replacement
   rather than patching `require`), `await` the call, and assert
   `capturedArgKeys.sort()` deep-equals
   `["computedAt","counts","draining","projectId","requestedAt"]` — the
   actual claim P-7 is supposed to prove. Add `await` to every other P-1…P-8
   call site in the same file.
2. **Fix `value-groups-api.test.js`'s `seedProjectWithCoverage`** — replace
   the nonexistent `stmts.upsertValueUnit` with `stmts.upsertDetourDisposition`
   + `stmts.upsertValueUnitSummary`, following
   `value-coverage-parity.test.js`'s `seedProjectWithDetourPool` pattern
   (read the row's real autoincrement id back before building the unit key).
   This single fix should unblock all 24 currently-failing cases, including
   the §9.8 truth table and R4.
3. **Fix `value-groups-mechanical.test.js`'s expected-key literals** —
   append `::` (empty cwd) to every hand-typed `"source::ref"` literal, or
   build expected keys via `unitKey()` itself rather than hand-typing.
4. **Fix `value-groups-refinement.test.js`** — insert the parent
   `value_group_runs` row before R-2/R-3/R-7's direct `insertValueGroup`
   calls; pass the full `dbModule` (not raw `db`) to `runGroupingPass` in
   R-5/R-6.
5. **Fix `value-groups-interrupted-boot.test.js`** — call the exported
   `startBackgroundServices()` after `require("../index")` in E-5.1;
   change the `app.get(`/`app.post(` regexes in E-5.2/E-5.3 to
   `router.get(`/`router.post(`.
6. **Fix `PlanLedgerPanel.groups.test.tsx`** — add the missing `api:`
   wrapper to `vi.mock`; add `list`/`pool`/`health` to the mocked
   `projectPlans` surface with safe defaults in `beforeEach`; complete
   `makeCoverage()` with `described`/`pending`/`demand`/`requested_at`/
   `computed_at`/`eta`; change C-1's `waitFor` predicate to wait for
   rendered content (e.g. `screen.getByText("Database Schema")`), not
   merely `mockGroupsMock` having been called.
7. **Fix `db-migration.test.js`'s S-4** — re-`delete require.cache` and
   re-`require("../db")` before S-4 (matching S-2's own pattern), so it
   doesn't inherit S-1's closed connection.
8. Non-blocking, but worth doing in the same pass: add the 4 new
   `/groups` endpoints to `README.md`; either update
   `technical-plan.md` §7 to reflect the shipped `:projectId`-path-param
   route shape, or note the deviation as a dated decision.

None of these require product-code changes — every root cause traced back
to the test files, and every product-code claim I was able to
independently re-derive (schema, `mechanicalPreGroup`, `computeGroupingDigest`,
`runGroupingPass`, `buildProbeCoverage`, the route handlers' branching order,
the boot hook, the client component's rendering) held up under direct
execution/mutation. The one exception is that **P-7's actual claim has never
been proven by any test, in the suite or by me, other than a one-off scratch
script** — that is the one item where "the product code is probably fine"
is not yet a checkable claim the way this project's own catalog requires it
to be.
