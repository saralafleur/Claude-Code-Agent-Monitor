# Build Verifier Findings — Round 2 (post fix-round-3, 17-blocker re-verification)

**Date:** 2026-08-06
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor`
**Verdict: GREEN-WITH-CAVEATS**

All server test runs in this pass used an isolated `DASHBOARD_DB_PATH`
(`/tmp/verifier-round2-*.db` and per-file variants), never the production
DB. Production `~/.claude/agent-dashboard/dashboard.db` re-checked after
every run: `value_group_runs`/`value_groups`/`value_group_members` all still
0 rows.

This is **not** a from-scratch verification — it is a targeted re-check that
fix round 3 genuinely closed each of the 17 blockers from
`supporting/review-findings.md`, reading the current code and tests
directly rather than trusting the green re-run alone (per this project's own
§9.4 FIX-ROUND-REGRESSION pattern).

---

## Suite results (independently re-run)

- `npm run test:server` (isolated `DASHBOARD_DB_PATH`): **1858/1858 pass**, 0
  fail/skip/todo.
- `npm run test:client`: **831/831 pass**.
- Every new/edited Slice-3 test file re-run individually with its own
  isolated DB path: `db-migration` 39/39, `value-coverage-probe` 8/8,
  `value-groups-mechanical` 9/9, `value-groups-refinement` 19/19,
  `value-groups-interrupted-boot` 4/4, `value-groups-api` 20/20,
  `single-writer-guard` 23/23, `chronology-ordering` 7/7,
  `ledger-metrics-parity` 4/4 — all green.
- `bash .claude/skills/file-headers/scripts/check-headers.sh` — exit 0.
- Production DB: confirmed 0 rows in all three Slice-3 tables before and
  after every run in this pass.
- Canary `value-coverage-parity.test.js`: byte-identical to `master`
  (`git diff` empty), green.
- `grep -c "T7 (SF-4)" server/__tests__/project-plans-api.test.js` = 1 (an
  explanatory comment documenting the deletion, no surviving test code); T3/
  T4/T6 regions byte-identical to `master`.
- No forbidden route↔route `deepEqual` parity guard anywhere (grep-confirmed
  0 hits).
- `assert.ok(true` sweep: 1 hit total in `server/__tests__/`, and it is the
  pre-existing `value-summary-interrupted-boot.test.js:133` hit the original
  review already flagged as pre-existing — the three new Slice-3 hits
  (`single-writer-guard.test.js:796`, `value-groups-refinement.test.js:319`
  D-3, `value-groups-api.test.js:287` N-1) are gone; D-3 is now a real
  behavioral assertion, N-1's escape hatch is deleted.

---

## Blocker-by-blocker re-verification

### BL-1 (client crash on `group.members`) — **CLOSED**
`server/routes/project-plans.js`'s three propose success paths
(`already_running`/`reused_unchanged`/`started`) no longer carry a `groups`
key at all (confirmed by direct read, `:379-450`). The client's
`handleProposeGroups` (`PlanLedgerPanel.tsx:882-910`) no longer reads
`res.groups`; it re-fetches via `loadGroups()`. A new test,
`PlanLedgerPanel.groups.test.tsx`'s **`BL-1 [M]`**, genuinely clicks the
`data-test="auto-group-button"` element, asserts `proposeGroups` was called,
and asserts real enriched content (`"Database Schema"`) renders afterward —
the first test in this file that actually clicks the button. Confirmed
non-vacuous by reading the fixture: the propose mock deliberately omits
`groups`, matching the real server contract.

### BL-2 (`rollupGroups` positional corruption) — **CLOSED**
`persistPassResults` (`value-groups.js:639-680`) now derives `notSelected`
via a set difference over unit keys (never per-cluster subtraction), and
absorbed clusters get a terminal `state: "absorbed"` disposition with no
group row of their own (`:645`). `runGroupingPass`'s rollup-zip logic
(`:762-798`) zips `rollupGroups`'s same-length mapping back onto
`orderedOutcomes` positionally via `refinedIdx`, guarded by an explicit
length check before applying the mapping at all. Most importantly, this is
now **proven**, not just re-derived by direct read: `value-groups-api.test.js`'s
new **E-4.1…E-4.4** test builds a genuine 45-unit, 3-day, 2-batch pool with
an order-independent rollup stub that merges two of three leaf groups by
name, and asserts the persisted result is exactly 2 groups (never 3 = no
merge, never 1 = over-merge/corruption), with the merged group's members
being the exact union of the two source clusters and the untouched group
carrying only its own members — this is the exact fixture shape (3 leaf
groups, one real merge) BL-2's review reproduction used. Verified green
(part of the 20/20 `value-groups-api.test.js` re-run above).

### BL-3 (tests writing to production DB) — **CLOSED**
`value-groups.js:526` no longer has a module-scope `require("../db")`
singleton (grep-confirmed 0 hits of `require(\"../db\")`/`require('../db')`
in the file). Both previously-offending test files
(`value-groups-mechanical.test.js`, `value-groups-refinement.test.js`) now
set `process.env.DASHBOARD_DB_PATH` at module-evaluation time, before any
`require`, with explicit comments citing BL-3. Re-confirmed empirically:
production DB's three Slice-3 tables stayed at 0 rows through this entire
verification pass.

### BL-4 (test-only sync seam, `runGroupingPassSync`) — **CLOSED**
Grep-confirmed 0 hits of `runGroupingPassSync`/`failBatch`/`failFirstBatch`
anywhere in `value-groups.js`. `runGroupingPass` is unconditionally `async`
and its own docblock notes the deleted seam (`:36`). Tests now genuinely
exercise the real LLM-call path via the module-namespace patch technique
(`withStubbedLlm` in the refinement test file, `withLlmMode` in the API test
file) — confirmed by direct read of both helper functions, which stub
`focusInference.probeClaudeCli`/`runClaudePromptJson` through the module
namespace object (BO-5 technique) and restore in `finally`.

### BL-5 (digest-poisoning / OVERLOADED-ABSENCE) — **CLOSED for the primary defect; NARROWER than the reviewer's second requirement, and this narrowing is not disclosed anywhere in-repo**
This is the one blocker requiring a judgment call, per the task's own framing.

**What is genuinely fixed:** `runGroupingPass` (`value-groups.js:800-818`)
computes `poisoned = usableCount === 0 && clusters.length > 0` — a run where
clusters existed but literally zero batches produced usable output. When
`poisoned`, the run lands `state: "failed"` and `input_digest` is left
`null` (never persisted). The route's reuse check
(`latestRun.state === "completed" || latestRun.state === "completed_zero_groups"`)
structurally excludes `"failed"`, so a poisoned run can never be
`reused_unchanged` on the next click — **the permanent-poisoning defect
(BL-5's headline reproduction) is genuinely closed.** This is proven, not
just asserted: `value-groups-api.test.js`'s **TT-c** row constructs a *real*
all-heuristic pass against a genuinely clustering pool, asserts the prior
run's `state === "failed"` by BL-5's own mechanism (not a manual `UPDATE`),
and then asserts the *next* propose call genuinely starts fresh
(`expectedOutcome: "started"`, spawn delta 1) rather than reusing. TT-e/E-3
similarly prove a *real* `completed` run (via a real refined stub) is what a
legitimate cache hit requires.

**What is narrower than what the review asked for:** BL-5's second
requirement was *"add a per-group failure discriminator so 'unavailable' ≠
'unusable output'"* — i.e., when an individual group's `refinement_state`
lands `"failed"` (the partial-batch-failure disclosure case R-5/R-6 cover,
where the *run* stays `"completed"` because other batches succeeded), a
client reading that group still cannot tell *why* it failed. As built, the
`error_reason` discriminator (`llm_unavailable` vs. `llm_output_unusable`,
`runGroupingPass:749`) is written **only onto the run row**, and **only in
the `poisoned` (every batch failed) branch** — `persistPassResults`'s
`insertValueGroupRow` call (`:646`) passes no error-reason argument, and
`value_groups`'s schema (`server/db.js:1985-2002`) still has **no
`error_reason`-shaped column at all**, confirming this directly. So for the
partial-failure case — one group `refined`, a sibling group `failed` inside
the *same, `completed`* run — there is still no way, at any layer (schema,
persistence, route response, or UI), to distinguish that failed group's
"unavailable" from "unusable output." This is the exact original gap,
un-narrowed, for that one specific (partial-failure) shape of the defect.
The fix genuinely covers the *run-level* face of BL-5 (which was also the
more severe, permanent-poisoning half) but does not touch the *per-group*
face at all.

**Disclosure note:** the task instructions describe this as an adaptation
"per the implementer's own report," but I could not find that report, or
any record of this narrowing, anywhere in the repo — not in `decisions.md`
(whose `DEC-S3-FIX3` table dispositions should-fix/nit items individually
but says nothing about any blocker being partially closed), not in a
build-report file (none exists at
`build/2026-08-06-auto-group-proposal/`), and not in a code comment framed
as a scoping decision (the comments at `value-groups.js:692-704` describe
the fix as complete, not as a partial substitute). `decisions.md`'s own
framing states plainly: *"Fix round 3 closed all 17 BLOCKERS with real
product-code + test fixes."* Given the actual code, that statement is true
for BL-5's headline defect (the permanent-poisoning bug that motivated the
whole finding) but overstates the second, per-group half — this should be
recorded as a dated decision (or a WATCH row) the same way `DEC-S3-FIX3`
already handles the should-fix/nit narrowings, not left implicit.

### BL-6 (S-2 vacuous CHECK-vs-registry parity) — **CLOSED**
`db-migration.test.js`'s S-2 (`:2728-2789`) now imports
`GROUP_RUN_ROW_STATES`/`GROUP_REFINEMENT_STATES`/`GROUP_REVIEW_STATES` from
`value-groups.js` and `VALUE_SOURCES` from `value-ledger.js`, parses the
literal value list out of each real `CHECK(<col> IN (...))` clause via
regex, and `deepEqual`s the sorted result against each registry. The old
"verified elsewhere" comment is gone.

### BL-7 (R-7 tautology) — **CLOSED**
`R-7` (`value-groups-refinement.test.js:223-262`) now persists all four
refinement states through the real product writer
(`insertValueGroupRow({db,stmts}, runId, "slug", content, state)`) with the
**same non-null `content`** object for every state, and asserts the
biconditional on what the writer actually persisted. Deleting
`insertValueGroupRow`'s null-vs-non-null branch would now genuinely fail
this test (confirmed by reading the writer's branch and the test's own
explanatory comment, which correctly states this).

### BL-8 (R-9 missing both mandated halves) — **CLOSED**
R-9 (`:281-319`) now includes the anchored assertion
`assert.deepEqual(Object.keys(GROUPING_UNCOMPARED_FIELD_GUARANTORS), [])`
before the key-walk loop. A new **R-9b** (`:321-365`) is the mandated
structural scan: it regex-extracts `buildGroupingPrompt`'s own source,
asserts its parameter list is exactly `(clusters, factsByKey)`, asserts
every `f.<field>` access in its body is a real `groupingFacts()` output key,
and asserts the body never references `unit.` or `unitsByKey` directly.

### BL-9 (client never renders `member_availability_counts`) — **CLOSED**
`PlanLedgerPanel.tsx:1351-1378` now renders
`group.member_availability_counts.{available,already_claimed,no_longer_in_pool}`
verbatim (with `data-test="availability-count-*"` hooks), never
re-deriving from `group.members`. `C-1` now asserts via
`container.querySelector('[data-test="availability-count-*"]')` +
`not.toBeNull()` + literal text match, and additionally asserts the three
rendered texts are pairwise distinct via a `Set` size check — closing the
"three states render identically" gap the review named.

### BL-10 (C-8 locale guard vacuous; `registries.ts` phantom reference) — **CLOSED**
C-8 (`:485-543`) now imports the real six registries (exported from
`PlanLedgerPanel.tsx` itself — `GROUP_RUN_STATES` etc., confirmed present at
`PlanLedgerPanel.tsx:73-81`), asserts each against a literal anchored sorted
array, then walks every wire value × all four locale files, resolving
`planLedger.<namespace>.<value>` and asserting it resolves to a non-empty
string, collecting any misses into a named list asserted empty. The stale
`types.ts` comment claiming a separate `registries.ts` file exists has been
corrected to state plainly that no such file exists and point at the real
location (`types.ts:2860-2868`).

### BL-11 (C-4 dead regex) — **CLOSED**
C-4 (`:337-368`) now uses `/planLedger\.[a-zA-Z]/i` (matching this
codebase's own established pattern in `PlanLedgerPanel.test.tsx`) and
actually asserts `hasPlanLedgerKey === false`, not the old
`/projectDetail\./`-only check that could never match a `planLedger.*` leak.

### BL-12 (duplicate `prioritize-now-button` identifier) — **CLOSED**
`grep -c "prioritize-now-button" client/src/components/PlanLedgerPanel.tsx`
= **1** (confirmed). The new button carries its own
`data-test="auto-group-button"` and a plain Tailwind `className`, no shared
identifier. C-2 now asserts both halves: exactly one
`[data-test="prioritize-now-button"]` element while it is still mounted, and
the auto-group button exists as its own, separately-selectored control; a
follow-up assertion after the coverage-complete transition (when the
prioritize-now button legitimately unmounts) asserts `<= 1`, not exactly 1,
correctly accounting for its conditional rendering.

### BL-13 (propose route awaits the entire LLM pipeline) — **CLOSED, and the async-shape concern for TT-f/TT-g/E-1.3 is adequately handled**
`server/routes/project-plans.js:441` fires
`runGroupingPass(...).catch(() => {})` without `await`, then immediately
re-reads the just-inserted run row and returns `202`. This is safe because
`runGroupingPass`'s synchronous prefix (`dbModule.stmts.insertValueGroupRun.run(...)`
at `:716`, before the function's first `await`) is a plain
better-sqlite3 synchronous call — confirmed by direct read, and this is a
correct application of the JS async-function-runs-synchronously-to-first-await
guarantee the code comments claim.

Regarding whether **TT-f/TT-g/E-1.3** (which seed `in_progress` via a direct
`UPDATE`) still test the real dedup path: yes. The propose route's dedup
branch (`if (latestRun && latestRun.state === "in_progress") return 200
already_running`) only reads `state` off the row — it has no way to
distinguish "genuinely still executing in the background" from "the row
just says in_progress" and does not need to; testing the branch against a
directly-seeded row is testing the real code path, not a shortcut around
it. Separately, the suite **also** now proves the real concurrent-race shape
exists and behaves correctly: **TT-i** and **TT-read** construct a *genuine*
in-flight window using a 300ms-delayed LLM stub, confirm the row is
observably `in_progress` mid-flight via a direct query, and only then
exercise the gate/read behavior against that real race — closing the
concern that no test exercises real concurrency at all. This is a
reasonable, explicitly-commented division of labor (TT-i/TT-read prove the
race is real; TT-f/TT-g/E-1.3 prove the dedup branch's logic against a
row in that state, deterministically) — not vacuous.

### BL-14 (G-2/N-1/N-3 hand-scoped blind spots) — **CLOSED**
**G-2** (`single-writer-guard.test.js:792-856`) now additionally brace-walks
all four coverage-composing handler bodies (POST coverage-request, GET
coverage, POST groups/propose, GET groups) and asserts **zero**
`enrichPoolAltitudes(`/`coverageSnapshot(` occurrences inside each —
closing the exact gap the review named (an inline hand-copy calling those
two functions directly, not `buildProbeCoverage`, would previously have
stayed invisible to the count-based check alone). **N-1**
(`value-groups-api.test.js:533-554`) now scans `value-groups.js` **and**
brace-walks all four route handler bodies (reusing the same
`extractHandlerBody` brace-walker as G-2/N-3), with the vacuous
`if (!fs.existsSync(...))` escape hatch removed. **N-3** (`:568-594`) now
checks both the old assignment-form regex **and** a new
`/setValueGroupReviewStatus\.run\(\s*["']claimed["']/` argument-form regex
— matching this codebase's real write shape
(`dbModule.stmts.setValueGroupReviewStatus.run("claimed", ...)`), which the
old assignment-only regex was blind to by construction.

### BL-15 (§9.8 truth table shipped as 9 isolated `it()`s, no spawn counts) — **CLOSED**
`value-groups-api.test.js:259-468` is now genuinely **one** `it()` driving a
data table of 9 rows (`TT-a`…`TT-i`) plus a separate `TT-read` case, in a
single loop with one shared assertion block per row (status, outcome, and
**exact spawn delta**, measured via the real `focusInference.runClaudePromptJson`
call counter installed once for the file's lifetime). Critically, **TT-d**,
**TT-h**, and **TT-i** — the three rows the review named as never
constructing genuine prior state — each now build real, distinct prior
state through actual product behavior: TT-d runs a real propose-to-failure
pass then genuinely regresses coverage; TT-h uses a single-unit fixture that
structurally cannot cluster (proving a real `completed_zero_groups` row,
distinct from TT-e's clustering fixture); TT-i constructs a real in-flight
`in_progress` row via a delayed stub and confirms it via direct query before
regressing coverage underneath it. **TT-read** now asserts *both* mandated
facts (`run.state === "in_progress"` AND `gate === "blocked_coverage_incomplete"`),
not just the gate half.

### BL-16 (route suite runs entirely LLM-off; `refined`-path assertions dead) — **CLOSED**
`value-groups-api.test.js` still defaults to `DASHBOARD_FOCUS_INFER_MODE=heuristic`
file-wide (correct — most rows genuinely want the LLM off), but a new
`withLlmMode` helper genuinely flips to `"llm"` and stubs
`focusInference.probeClaudeCli`/`runClaudePromptJson` through the module
namespace for every case that needs the `refined` path proven. **E-1.4**
now uses a real stub and asserts `refinedGroups.length > 0` before checking
field non-nullness (so the loop cannot vacuously pass on zero iterations).
**N-4** now constructs a genuinely adversarial payload (`status: "claimed"`,
`review_status: "approved"` alongside legitimate fields), runs it through
the real pipeline, and asserts the **persisted DB row** (not just the
parser's return value) reads `review_status === "proposed"`. **E-4.1…E-4.4**
now seed a real 45-unit, 3-day pool forcing 2 real batches — see BL-2 above,
this is the same test that proves BL-2's fix.

### BL-17 (three `assert.ok(true` hits) — **CLOSED**
Grep-confirmed 0 new hits; the one remaining repo-wide hit is the
pre-existing, already-disclosed one in `value-summary-interrupted-boot.test.js`.
D-3 is now a real, distinct assertion (D-3 tests which bucket `available`/
`no_longer_in_pool` land in; D-4 tests only the sum/no-double-count
properties — genuinely non-overlapping, per the fix's own comment).

---

## New finding from this pass (not one of the 17, non-blocking)

**A residual vacuous `queryByText(...).toBeDefined()` assertion survives in
C-5**, the exact anti-pattern BL-9's own fix explicitly called out and
replaced elsewhere in this same file (`PlanLedgerPanel.groups.test.tsx:394-395`):

```tsx
const groupAName = screen.queryByText("Project A Group");
expect(groupAName).toBeDefined();
```

`screen.queryByText` returns `null` (not `undefined`) on a miss, and
`expect(null).toBeDefined()` passes unconditionally — this line can never
fail, regardless of whether project A's group data actually rendered before
the entity-switch. The test's second half (after switching to project B) is
still real: `expect(groupANameAfterSwitch).toBeNull()` and
`expect(screen.queryAllByText("Database Schema").length).toBeGreaterThan(0)`
are both meaningful assertions. But because the precondition check is
vacuous, C-5 as written could pass even if `PlanLedgerPanel` never rendered
project A's group data at all (e.g., a component that silently fails to
render any group content) — there would be nothing to "leak," so the
post-switch absence check would trivially hold too. This narrows what C-5
actually proves about the PM-5a entity-switch-reset claim, though the
`Database Schema`-presence-under-B check is unaffected. Recommend
`expect(groupAName).not.toBeNull()` for consistency with C-1/BL-9's own
fix in the same file. Not gating — the primary regression this test exists
to catch (stale data rendering after a switch) is still caught by the
second half.

---

## DoD walk (technical-plan.md §15 + qa/test-plan.md's DoD)

**Met, with evidence:**
- Schema & structure — met (S-1/S-2/S-4 all pass with real registry-backed
  assertions; S-3 unchanged).
- SF-4 single-definition/exact-call-site guard — met. Note: DoD text says
  "exactly three call sites"; shipped reality is 4 (GET /groups needs its
  own fresh gate/coverage read), disclosed and asserted correctly by G-2
  with an explanatory comment — this is the same, already-reviewed
  widening the round-1 verifier pass flagged as stale DoD text, not a
  defect.
- No route↔route parity guard — met.
- T7 deleted in full, T3/T4/T6 byte-identical — met.
- Registries (§9.7) — met: `CONSUMERS` 4 entries with widened growth-rule
  comment (BO-3), both `assertSingleHome` axes on `value-ledger`/
  `value-summary`, new maps for `value-groups`/`value-coverage-probe`
  (two-consumer map on `value-groups` including the boot-hook `../index`
  consumer), `chronology-ordering.test.js` disposition entries for both new
  lib files, `assertConsumerScopeDerived` wired at all 4 registration
  points.
- Vacuity sweep — clean (1 pre-existing hit, disclosed).
- Negative proof (N-1…N-4) — all four real and red-proven per the code read
  above.
- Approve-under-drift (R4/E-6.4/E-6.5) — met: drift #2 injected after GET,
  before approve; approve returns 200, doesn't drop the drifted member;
  partition intact on the following GET.
- `WATCH-S3-F` open in `decisions.md`, distinct from `WATCH-S3-A`, naming
  the approve route — confirmed present.
- Flag-backs BO-1/BO-2/BO-4/BO-5/BO-7 — all confirmed applied/discharged in
  `qa/change-brief.md`, `technical-plan.md`, `value-coverage-probe.js`'s
  header, and `decisions.md` respectively.
- Docs — README documents the 4 new `/groups` endpoints; `PROJECT-CONTEXT.md`
  carries the SF-4 build-outcome note. OpenAPI remains undocumented, but
  this is BO-7's own recorded, disclosed decision (documentation-drift risk
  only), not a silent gap.
- File-header audit — exit 0.
- AC-1…AC-7 — each independently spot-checked against its named proof in
  §12 and confirmed present and non-vacuous in the current test files.

**Not fully met / caveat:**
- **BL-5's per-group failure discriminator is not built** — see the BL-5
  section above. The permanent-poisoning defect (the more severe half, and
  the one with a direct reproduction in the original review) is genuinely
  closed and proven (TT-c). The per-group "why did *this* group fail"
  discriminator is not, for the case where a run stays `completed` with a
  mix of refined and failed groups. This narrowing is not recorded as a
  decision anywhere in this intake's `decisions.md`, unlike every should-fix/
  nit item, which each got a named, dated disposition row.
- The residual vacuous assertion in C-5 (new finding above) — narrow,
  non-gating, but worth a follow-up given this exact class was the
  headline finding of BL-9 in the same file.
- Commit hygiene: `build-task-list.md` mandated several "ONE COMMIT" units
  (Task 2, Task 3) with a rationale of avoiding guard-gap windows in
  history. As of this verification pass, the entire fix-round-3 diff is
  still uncommitted working-tree state on `effort/2026-08-06-auto-group-proposal`
  (`git log master..HEAD` is empty). Not a correctness defect — every file
  in the working tree is internally consistent and green — but the
  commit-per-logical-unit structure the plan asked for does not exist yet
  in history. Flagging for whoever finalizes/merges this branch, not
  gating this verification pass.

---

## Verdict

**GREEN-WITH-CAVEATS.**

All 17 blockers were re-checked by reading the current code and tests
directly, not by trusting the green suite alone. 16 of 17 are genuinely,
non-vacuously closed, several (BL-2, BL-15, BL-16 especially) with markedly
stronger, real-behavior-driven tests than the original build shipped —
notably the new 45-unit/2-batch/genuine-rollup-merge test is exactly the
kind of test that would have caught BL-2 before it shipped, and now exists.

**BL-5 is closed for its primary (permanent-poisoning) defect but not for
its secondary (per-group failure discriminator) requirement** — a real,
narrower-than-claimed gap, undocumented as such anywhere in this intake.
This does not block merge on its own (the higher-severity half is fixed and
proven; the residual gap is a UX/observability shortfall, not a data
integrity or repeat-poisoning risk), but it should not be silently counted
as "17/17 blockers fully closed" without a dated decision row, consistent
with how this same fix round handled every should-fix/nit item.

Full suites green (1858 server / 831 client), all new/edited test files
individually green with isolated DB paths, production DB confirmed
untouched, file-header audit clean, and the DoD is otherwise met.

**Recommendation:** add one `decisions.md` row (mirroring `DEC-S3-FIX3`'s
own format) dispositioning BL-5's per-group discriminator as deferred, with
a stated consequence, matching how every should-fix/nit item was already
handled — then this is a clean GREEN. Optionally fix the one-line C-5
vacuous assertion in the same pass (trivial, same file already touched this
round).
