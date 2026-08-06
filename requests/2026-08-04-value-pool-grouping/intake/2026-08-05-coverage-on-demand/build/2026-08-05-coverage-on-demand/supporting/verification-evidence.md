# Verification Evidence — Value Pool Slice 2 (coverage-on-demand)

**Verifier:** build-verifier (independent re-execution, no implementer self-report trusted)
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor`
**Branch:** `effort/2026-08-05-coverage-on-demand` @ `b38b4a1` (base)
**Date:** 2026-08-05

Every command below was re-run by me, from scratch, in the worktree. Where the
implementer claimed a guard was "red-proven," I injected the described (or an
equivalent, unambiguous) mutation myself, observed the failure, then restored
the file byte-identical (verified via `git diff --stat` returning to the
pre-mutation state) and re-ran green.

---

## 1. Full suite re-execution (real output, not summarized from a report)

### `node --test server/__tests__/coverage-smoke.test.js`
```
# tests 8
# suites 4
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
Matches claim (8/8). Confirmed same file/assertions as `red-evidence.md`'s
7 recorded failures (line-by-line: `requestValueCoverage`/`clearValueCoverageRequest`
stmt checks, `value-coverage.js` module + `coverageSnapshot`/`estimateEta`
arithmetic + `demand` field + cold-start `estimating`, and
`listRecentValueGenerationDurations` stmt check) — same test names, same
assertion text, same file. Genuine red→green, not a rewritten test.

### `npm run test:server`
```
# tests 1784
# suites 443
# pass 1784
# fail 0
```
Matches claim exactly. Re-ran a second time after all mutation-tests below
were restored: identical result (1784/1784).

### `npm run test:client`
```
Test Files  61 passed (61)
     Tests  816 passed (816)
```
Matches claim exactly.

### `npx tsc --noEmit` (in `client/`)
Exit code 0, no output. Matches claim.

### `bash .claude/skills/file-headers/scripts/check-headers.sh`
```
✔ All applicable files carry the authorship header.
```
Exit code 0. Matches claim.

---

## 2. Pre-existing flaky test claim — INDEPENDENTLY CONFIRMED

Running `server/__tests__/value-summary-tick.test.js` repeatedly surfaces an
intermittent failure in either "S1 should-fix (sweep rotation advances even
on bookkeeping failure)" or "B2 blocker fix (errored sweep preserves
pending_after_sweep)" — both assert `notStrictEqual` on two back-to-back
`new Date().toISOString()` values, which can collide at millisecond
resolution on a fast machine.

- Neither block is touched by this build's diff (`git diff b38b4a1 --
  server/__tests__/value-summary-tick.test.js` shows no `-` lines removing
  or altering either describe block; both exist verbatim in `b38b4a1`).
- I ran the **unmodified `b38b4a1` Slice-1 worktree**
  (`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor`,
  clean working tree) 8 times: **4/8 runs failed** with the identical
  timestamp-collision symptom.
- Verdict: **genuinely pre-existing**, not a regression this build
  introduced. The implementer's claim holds up under independent
  re-verification.

---

## 3. `server/index.js` diff — CONFIRMED EMPTY

```
git diff b38b4a1 -- server/index.js
```
Zero output. Confirmed byte-identical to `b38b4a1`.

---

## 4. `MAX_PROJECTS_PER_TICK` never read by the drain path — CONFIRMED

```
grep -n "MAX_PROJECTS_PER_TICK" server/lib/value-summary-tick.js
```
Every occurrence is either a doc comment or inside `runValueSummaryTickOnce`
(the **passive** tick). `runCoverageDrain` (lines 455-539) contains zero
references to `MAX_PROJECTS_PER_TICK` or `numEnv("MAX_PROJECTS_PER_TICK", …)`.
Its own bound is the separate, hardcoded `MAX_DRAIN_BATCHES_PER_RUN = 25`
safety constant. Confirmed compliant with DEC-3.3.

---

## 5. §9.3 mutation-injection re-proofs (I performed these myself; I did not
   accept the implementer's "red-proven" claims as reports)

All mutations were applied with `cp` backups first, verified to fail as
expected, then restored via `cp` from the backup and `git diff --stat`
confirmed the file returned to its exact pre-mutation diff size.

### 5a. `db-migration.test.js` — `coverage_requested_at` UPGRADE_CASES entry
- **Mutation:** removed the `coverage_requested_at` column from the
  `addColumnsIfMissing({ table: "value_summary_sweep_state", ... })` call in
  `server/db.js`.
- **Result:** 3 tests went red (`adds coverage_requested_at via guarded
  ALTER…`, `migration is idempotent…`, and the `HELPER-CASE-SCAN` meta-test),
  suite dropped from 35/35 to 32/35.
- **Restored:** 35/35 green again.
- **Verdict:** real guard, genuinely reaches the migration code path (not a
  REGISTRATION≠EXECUTION instance — the test explicitly calls
  `upgradeCase.assertLegacyRow(db)` / `upgradeCase.assertWritable(db)` on the
  found `UPGRADE_CASES` entry, not a blind bulk iteration).

### 5b. `value-coverage-parity.test.js` (G2, the named §9.1 deliverable)
- **First mutation attempt** (`snapshot.pending = counts.queued` in the
  `GET /coverage` route, dropping `+ counts.unavailable`): **did NOT fail**.
  Root cause, confirmed by inspection: this route runs `enrichPoolAltitudes`
  in **probe mode**, which routes every miss to `queued` (never
  `unavailable`) per DEC-9's design — so for this test's fixture,
  `counts.unavailable === 0` on the route path, and the mutation
  coincidentally produced the same numeric answer as the correct formula.
  **This is a real finding worth recording**: a naive "drop one term"
  mutation can pass through undetected purely because of how probe mode
  splits queued/unavailable, not because the guard is weak.
- **Second mutation** (`snapshot.pending = counts.queued + counts.unavailable
  + 5`, unambiguously wrong regardless of the queued/unavailable split):
  **failed as expected** — `assert.deepEqual` reported `described: -4,
  pending: 7` (actual) vs `described: 1, pending: 2` (expected).
- **Restored:** 2/2 green again.
- **Verdict:** the named parity test is real and load-bearing, but note the
  first mutation's near-miss above — the fixture's own probe-mode geometry
  (unavailable always 0 on the route side) narrows what kinds of rogue
  re-derivations it can distinguish. Not a blocker, but worth naming: a
  rogue re-derivation that specifically re-derives `pending` as
  `queued + something-that-equals-unavailable-by-coincidence` on THIS
  fixture would slip through. A future hardening would seed a fixture where
  `unavailable > 0` on the route's own probe path too (currently
  structurally impossible in probe mode, so this is a fixture-design
  limitation of probe mode itself, not a fixable test bug).

### 5c. `chronology-ordering.test.js` — new `listRecentValueGenerationDurations` G4 test
- **Mutation:** flipped `listRecentValueGenerationDurationsForProject`'s
  `ORDER BY created_at DESC, id DESC` to `ORDER BY id DESC` only in
  `server/db.js`.
- **Result:** the new scrambled-insertion-order test failed
  (`expected [3000,2000,1000]`, `actual [2000,3000,1000]`) — a real
  chronology defect, not a tautology (the test does NOT re-sort its own
  query result and compare against itself; it stamps `created_at` values in
  a scrambled order relative to insertion id and checks the query recovers
  real chronological order).
- **Restored:** 7/7 green again.
- **Verdict:** real guard.

### 5d. `single-writer-guard.test.js` — `requestValueCoverage` single-call-site guard
- **Mutation:** added a rogue (dead, `if (false)`-gated) second call site
  `dbModule.stmts.requestValueCoverage.run(...)` inside `runCoverageDrain` in
  `server/lib/value-summary-tick.js`.
- **Result:** the new W-3-shaped guard failed correctly — it is a **lexical**
  scan (`scanFiles` + regex over file contents), so it caught the rogue call
  site even though it was dead code, which is the correct guard shape for
  this pattern (an execution-based check would have missed it).
- **Restored:** 15/15 green again.
- **Verdict:** real guard.

### 5e. `PlanLedgerPanel.test.tsx` — R4 monotonic merge rule
- **Mutation:** `mergeCoverage` in `client/src/components/PlanLedgerPanel.tsx`
  changed from `return next.computed_at > prev.computed_at ? next : prev;` to
  unconditionally `return next;`.
- **Result:** the R4 out-of-order-delivery test failed (`expected '4 of 5
  described'`, got `'1 of 5 described...'` — the stale snapshot overwrote
  the newer one).
- **Restored:** 25/25 green again.
- **Verdict:** real guard.

### 5f. `i18n.test.ts` — E1.1 whole-namespace key-set parity
- **Mutation:** deleted the `planLedger.pool.coverage.draining` key from
  `client/src/i18n/locales/ko/projectDetail.json`.
- **Result:** the generic (not hand-typed-per-key) E1.1 parity scan failed:
  `"projectDetail/ko: missing [planLedger.pool.coverage.draining] extra []"`.
- **Restored:** 76/76 green again.
- **Verdict:** real, mechanical guard — not a hand-typed key list that could
  silently miss a new key.

---

## 6. §9.3 sweep — one violation found, pre-dating this build in part

```
grep -rn "assert.ok(true" server/__tests__/
```
Returns **2** hits, not 0:
1. `server/__tests__/value-summary-interrupted-boot.test.js:133` —
   **pre-existing**, confirmed present verbatim in `b38b4a1` before this
   build started (`git show b38b4a1:server/__tests__/value-summary-interrupted-boot.test.js`
   contains the identical line). Not introduced by this build.
2. `server/__tests__/coverage-smoke.test.js:177` — **new, introduced by this
   build**. It is the `catch` fallback branch of the AC-5 "ValueAltitudesUpdatedPayload
   type should have optional coverage field" smoke test, reached only if
   reading `client/src/lib/types.ts` by relative path throws. In the current
   repo layout the `try` always succeeds, so this branch is dead in practice
   — but its mere presence means the plan's own literal G5 done-check
   (`grep -rn "assert.ok(true" server/__tests__/` must return 0) is **not
   satisfied**, and the build's own Task 14 confirm-bullet ("Zero vacuous
   guards detected by sweep") is **not accurate as stated**.

```
grep -rn "|| true" server/__tests__/
```
Returns 0. Clean.

**Verdict:** a real, if minor, gap against the plan's own literal G5 gate.
Not safety-critical (the smoke test's real assertion —
`typesDef.includes("coverage")` — still runs and passed on this repo layout),
but the DoD line as written is not true as claimed.

---

## 7. `server/lib/value-summary-tick.js` comment citing "DEC-12" — minor inaccuracy

The `MAX_DRAIN_BATCHES_PER_RUN` comment reads: *"Sized against the parent
effort's own measured real pool (182 units, DEC-12)"*. The decisions log
(both the intake `decisions.md` and this build's own
`build/2026-08-05-coverage-on-demand/decisions.md`) contains rows **DEC-1
through DEC-11 only** — there is no `DEC-12` row anywhere. The "182-unit"
figure itself does appear as established prose in the intake `decisions.md`
discussion (lines ~133/304/310), so the number is plausibly a real measured
figure from intake investigation — but the comment's citation to a specific
decision ID that does not exist is a factual inaccuracy. Minor, non-blocking,
but worth a follow-up correction (cite the actual `decisions.md` discussion,
not a nonexistent `DEC-12` row).

---

## 8. Task 12 (Calibration + Pin Defaults, DEC-10) — NOT VERIFIABLE AS DONE

Per `build-task-list.md` Task 12 and technical-plan §3.7/AC-6: a real 40-unit
batch must run through both `haiku` and `sonnet` via a scratchpad script
(not committed), with both outputs + a recommendation **attached to DEC-10**,
**before** per-stage defaults are pinned.

- No `build-report.md` exists anywhere for this effort (checked both the
  worktree and the main checkout's untracked intake folder) — the artifact
  this task requires to be recorded is simply absent.
- Intake `decisions.md`'s DEC-10 row (the only DEC-10 row that exists — the
  build's own local `decisions.md` has no DEC-10 of its own) contains **no
  attached artifact** — no haiku/sonnet outputs, no recommendation, nothing
  beyond the original planning text.
- Code inspection: `summaryModel(stage = "unit")`'s fallback tail is
  unchanged from before this build — it still ends in `"haiku"`. The new
  per-stage env vars (`DASHBOARD_VALUE_SUMMARY_UNIT_MODEL` /
  `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL`) are **unset by default**
  (confirmed via `server/README.md`'s own new entries: "unset by default").
  No new hardcoded default was actually "pinned" anywhere in code — the only
  concrete deliverable that exists is the env-knob **plumbing**, not a
  calibration-informed default choice.

**Verdict:** I cannot confirm this MANDATORY task was actually executed.
Either the calibration ran and its artifact was never recorded/attached
anywhere I can find, or it did not run at all. Either way, this is a gap
against the build's own stated Definition of Done ("Calibration run … before
… defaults are pinned; artifact attached to DEC-10").

---

## 9. Deviation verdict: `runCoverageDrain` vs. the literal `runValueSummaryTickOnce`

**The implementer's read is correct; this is a plan self-contradiction it
correctly resolved, not an unauthorized design call.**

- Technical-plan §2's own design paragraph, immediately after introducing
  `runCoverageDrain()`, says: *"POST /coverage-request writes the flag and
  kicks the runner fire-and-forget"* — "the runner" reads naturally as the
  just-introduced `runCoverageDrain`, sharing the `running` guard.
- Technical-plan §3.5's literal code snippet instead names
  `runValueSummaryTickOnce`. This is inconsistent with §1's Objective
  ("drains it in **bounded back-to-back** ≤40-unit composer batches until a
  freshly re-derived count reads zero") and with DEC-3.3's own mandate that
  **the drain must never read `MAX_PROJECTS_PER_TICK`** — `runValueSummaryTickOnce`
  *does* read that knob and only performs one bounded rotation-sweep
  (up to `MAX_PROJECTS_PER_TICK` projects, one batch each), never a
  back-to-back loop for one specific project to completion.
- Independent confirmation: `project-plans-api.test.js`'s T3 test
  (`POST /coverage-request stamps the flag, returns 202 …, and is
  idempotent`) demonstrates the fire-and-forget call actually drains an
  empty pool to completion and clears the flag within ~100ms of a single
  route call — behavior only possible if `runCoverageDrain`'s own loop runs,
  not a single `runValueSummaryTickOnce` pass.
- Had the route literally called `runValueSummaryTickOnce` as §3.5 states,
  `runCoverageDrain` would have no production caller at all, defeating the
  entire point of DEC-4's design (a dedicated runner sharing the overlap
  guard).

**Verdict: the deviation is justified and correctly identified as a plan
defect, not scope creep.**

---

## 10. Definition of Done — fast-mode checklist

| Item | Status | Evidence |
|---|---|---|
| §0 P1/P2 preconditions | MET | `build-brief.md`'s own live-verified state; `master`==`origin/master`==`b38b4a1`, Slice 1 landed |
| Existing suites green | MET | `npm run test:server` 1784/1784, `npm run test:client` 816/816 (re-run independently, see §1) |
| Every smoke assertion red→green | MET | `coverage-smoke.test.js` 8/8, confirmed same file/assertions as `red-evidence.md`'s 7 recorded failures |
| Built thing demonstrably runs | MET | `project-plans-api.test.js` Group T end-to-end route tests (200/202/idempotent), parity test proves route↔broadcast agreement |
| Standing guards (§9.1/§9.2/§9.3/§9.5/§9.7) present & passing | MET, independently re-proven | §5 above — 6 separate mutation-injections, all caught correctly, all restored green |
| `server/index.js` diff empty | MET | §3 above |
| Drain never reads `MAX_PROJECTS_PER_TICK` | MET | §4 above |
| File headers pass | MET | §1 above |
| §9.3 sweep clean | **NOT MET** | §6 above — 1 new `assert.ok(true` instance (dead fallback branch), plan's own gate literally requires 0 |
| Calibration run + DEC-10 artifact (Task 12, AC-6) | **NOT VERIFIABLE / LIKELY INCOMPLETE** | §8 above — no artifact anywhere, no build-report.md exists |
| `DEC-12` citation accuracy | MINOR GAP | §7 above — cites a non-existent decision row |
| `FAST — QA debt` stamp recorded | **NOT MET** | No `build-report.md` exists anywhere to carry the stamp; `supporting/qa.md`'s deferred list is never actually written down for this build |
| Deviation (runCoverageDrain) | JUSTIFIED | §9 above |

DEFERRED (fast-mode QA debt, correctly out of scope for this gate per
`decisions.md` DEC-1): full E2E beyond G2, snapshot-baseline sweep, drain
load/perf, WS lifecycle edge cases beyond coverage updates, calibration
judgment **review** (moot until §8's underlying calibration is confirmed to
have actually happened), locale copy review.

---

## Verdict: GREEN-WITH-CAVEATS

All new tests are genuinely red→green (independently re-run, not trusted
from the report). All full suites are green (independently re-run twice,
including after 6 separate mutation-injection/restore cycles I performed
myself). All 4 MANDATORY durable-cure obligations I spot-checked with actual
mutations (§9.1 parity, §9.2 chronology, §9.3/W-3 single-writer, R4 monotonic
merge) hold up under real injection, not self-report. `server/index.js` is
untouched. The `MAX_PROJECTS_PER_TICK` isolation is real. The flagged
deviation (`runCoverageDrain` over the plan's literal but self-contradictory
`runValueSummaryTickOnce` citation) is correctly reasoned and independently
confirmed necessary for the feature to work at all.

This does not reach plain `GREEN` because of three named gaps, none of which
is a suite failure or a vacuous/missing guard on the feature's own core
surfaces:

1. **Task 12 (calibration, DEC-10 artifact) cannot be confirmed done** — no
   artifact exists anywhere, and no default was actually pinned in code
   (§8). This is a MANDATORY build-task-list item.
2. **No `build-report.md` exists** for this effort — the `FAST — QA debt`
   stamp this build's own DoD requires to be recorded was never written down
   anywhere I can find, in either the worktree or the main checkout.
3. **The §9.3 sweep is not literally clean** (1 new `assert.ok(true` dead
   fallback branch in `coverage-smoke.test.js`, non-blocking but contradicts
   the build's own "zero vacuous guards" claim) — plus the pre-existing,
   independently-reproduced flaky timestamp test (not this build's fault,
   named for completeness).

None of these three items are reasons to send this back to the implementer
for a code fix on the feature surfaces themselves — the coverage/ETA
single-home, the drain loop, the routes, the client wiring, and every
standing guard I mutation-tested are real and correctly built. They are
process/documentation gaps (a missing artifact, a missing report file, one
dead vacuous-shaped line) that should be closed before this is called fully
done, and Task 12 in particular should be either actually run or explicitly
descoped with a decision row, not left silent.
