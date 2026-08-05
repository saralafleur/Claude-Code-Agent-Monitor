# Green Evidence — value-summary-tick (Verifier pass)

Worktree used for all commands: `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor`
(uncommitted; branch `effort/2026-08-04-value-summary-tick`, still byte-identical
to `master` at the commit level — the implementer's diff is entirely unstaged
working-tree changes, no commit has landed).

No `red-evidence.md` file existed at the documented path
(`intake/.../build/2026-08-04-value-summary-tick/supporting/red-evidence.md`);
the only supporting doc present was `implementation-log.md`. All verification
below was performed by independently re-running commands and, where a claim
needed a mutation to confirm, by making the mutation myself, observing red,
then restoring the file byte-for-byte (verified via `git status --porcelain`
returning to the implementer's original diff after every probe).

## 1. Full suite counts (re-run independently)

- `npm run test:server`: **1614 tests, 1603 pass, 11 fail, 0 skipped.** Matches
  the implementer's reported count exactly.
- `npm run test:client` (`cd client && npx vitest run`): **795 tests, 794 pass,
  1 fail.** Matches reported count exactly.
- `cd client && npx tsc --noEmit`: **2 errors**, both in
  `PlanLedgerPanel.test.tsx:514-515` (`warnSpy.mock.calls[0]` possibly
  undefined). The implementer's log calls these "pre-existing... not
  introduced by this build's product changes." **That framing is misleading —
  independently confirmed via `git diff master -- client/src/components/__tests__/PlanLedgerPanel.test.tsx`
  that both lines are net-new, added by this build's own Task 15 T-E case.**
  They are not pre-existing; they are a new defect in new test code. `tsc
  --noEmit` is not clean, contrary to the DoD's plain requirement ("Must
  compile clean").
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: exit 0, clean.
- `node --test server/__tests__/openapi-contract.test.js`: 4/4 pass, unaffected.
- `git diff master -- server/db.js | grep -i "ALTER TABLE"`: empty (additive
  schema confirmed).
- Vacuous-guard greps (`assert.ok(true`, `|| true`) in `server/__tests__/`:
  both empty for text-level vacuousness, but see §4 below for a **structural**
  vacuous guard (zero assertions) that neither grep catches.
- `git status --porcelain` in the worktree: unchanged from the implementer's
  own diff throughout my session (confirmed after every mutation probe).

## 2. Per-test red→green / diagnosis verification (all 12 reported reds)

### 2a. `value-summary.test.js` :: T-A concurrency — CONFIRMED, but the
implementer's fix claim is INCOMPLETE

Re-ran `node --test server/__tests__/value-summary.test.js`; observed the
exact failure the implementer reported: `error: 'child.on is not a function'`
at `focus-inference.js:92`, because the injected spawn returns
`deferredSpawn(...)` (a factory) instead of invoking it.

Patched `deferredSpawn(envelope(...), 10)` → `deferredSpawn(envelope(...), 10)()`
(exactly the implementer's proposed fix) and re-ran: **the test still fails**,
now on a different assertion (`"last write wins with a whole payload"`).
Root cause, confirmed by instrumenting the test with a debug print: with the
one-line fix, `spawnCount` ends at **4**, not 2, and the final DB row's
`project_level` is `"P-4"`. `__injectSpawnForTest(fn)` unconditionally resets
`focus-inference.js`'s `probeCache = null` as a side effect, and the T-A test
calls it once immediately before firing the two concurrent
`enrichPoolAltitudes` calls. Both calls therefore see a cold probe cache and
each independently spawns its own CLI probe (2 probe spawns) *in addition to*
its own generation spawn (2 generation spawns) — 4 total, not the 2 the test's
own `deferredSpawn` counter and its `"P-1"/"P-2"` assertions assume.

**Verdict on this item: the implementer's stated fix is necessary but not
sufficient.** The test needs either (a) a way to prime/preserve the probe
cache across the `__injectSpawnForTest` call used to install the racy
generator (no such seam currently exists — `focus-inference.js` only exports
`__injectSpawnForTest`, which always clears the cache), or (b) a rewrite of
the assertions to account for 4 total spawns with `"P-3"/"P-4"` content. This
is real test-authoring work, not a one-character/one-paren fix, and it is not
something I can hand off as a single precise line-edit — it needs a test
author to decide (a) vs (b) and implement it. **Restored the test file
byte-for-byte after the probe** (`deferredSpawn.../ -> ()` reverted, debug
`console.log` removed); `git status --porcelain` on this file returns to the
implementer's own diff from master.

### 2b. `value-summary-tick.test.js` :: `makeSweptProject` — CONFIRMED as the
dominant cause, but TWO additional distinct bugs also block tests, undisclosed
by the implementer

Confirmed `makeSweptProject` never calls `stmts.insertProjectPath.run(...)`,
and confirmed `listValueSweepTargets` does an inner `JOIN (SELECT DISTINCT
project_id FROM project_paths)`, so projects created via `makeSweptProject`
are structurally invisible to the tick. Patching just this one line raised
the file's pass count from 5/15 to only **8/15** — not all 10 failing cases,
contrary to the implementer's claim that this was the sole root cause for all
10.

Two more distinct bugs, found by iterating:

1. **Cross-test contamination.** The file's `beforeEach` clears
   `value_unit_summaries`, `value_summary_sweep_state`, and
   `value_summary_generation_log`, but never `projects` or `project_paths`.
   Since `value_summary_sweep_state` is wiped every test, every project
   created by an *earlier* test (still sitting in `projects`/`project_paths`)
   reappears as "never swept" in every *later* test's `listSweepTargets`
   query, polluting exact-array-equality assertions (e.g. the rotation-order
   test). Confirmed directly: the rotation test's actual array contained 6
   extra project ids left over from the two preceding describe blocks.
   **Fix, precise:** add `db.exec("DELETE FROM project_paths"); db.exec("DELETE
   FROM projects");` to the `beforeEach` at the top of the file (immediately
   after the existing three `DELETE`s).
2. **Wrong assembler-callback signature in the "failure isolation" test.**
   Line 359's `__injectPoolAssemblerForTest(async ({ id: projectId }) => {...})`
   destructures its **first** parameter, but the tick calls
   `poolAssembler(dbModule, { id: projectId })` — the project object is the
   **second** argument, matching `assembleValuePool(dbModule, project, opts)`'s
   real signature. As written, the callback receives `dbModule` where it
   expects `{id}`, so `projectId` is `undefined` inside the callback, both
   projects fail assembly, and the "good" project's log row reads
   `outcome: 'error'` instead of `'ok'`. **Fix, precise:** change the
   parameter list at line 359 to
   `async (dbModule, { id: projectId }) => {`.

With **all three** fixes applied together (`insertProjectPath` in
`makeSweptProject`, the two extra `DELETE`s in `beforeEach`, and the
two-argument destructure at line 359), `node --test
server/__tests__/value-summary-tick.test.js` goes **15/15 green**. Verified
directly. All three patches were then reverted byte-for-byte; `git status
--porcelain` on this untracked file shows it back to the implementer's
original (still-failing) content.

**Verdict on this item:** the implementer's single-line diagnosis is real and
is the majority cause, but their claim that it is "one line" and blocks
"exactly" the 10 named cases for a single reason is inaccurate — two more
distinct, independent test-fixture bugs are required to reach green, neither
of which appears in the implementation log.

### 2c. `PlanLedgerPanel.test.tsx` :: AC-2 `getByText("P")` — CONFIRMED and
correctly diagnosed

Confirmed 39 units share `project: "P"` verbatim (line 461), and
`getByText("P")` at line 472 throws `getMultipleElementsFoundError`. Verified
the load-bearing AC-2 assertions immediately above it (`getAllByText(/Queued/i).length
=== 10`, `getAllByText(/Not available/i).length === 2`) **do pass** — the
actual same-render-distinguishability property this test exists to prove is
intact. Patched line 472 to `screen.getAllByText("P")[0]` (the implementer's
suggested fix) and re-ran: **14/14 pass, file green.** This is the one item of
the three where the implementer's diagnosis and proposed fix are both fully
correct and sufficient on their own. Reverted the file to the implementer's
original content afterward.

## 3. MANDATORY guard red-proofs — independently re-observed (not just read)

I performed my own injection/mutation on each of the following (not relying
on the implementer's self-report, per PROJECT-CONTEXT.md §9.3
AGENT-SELF-REPORTED-RED):

- **§9.1 single-writer guard (`upsertValueUnitSummary`).** Injected a rogue
  `dbModule.stmts.upsertValueUnitSummary.run(...)` call into
  `server/routes/project-plans.js` right after the real
  `enrichPoolAltitudes` call. Re-ran `single-writer-guard.test.js` → **red**
  (`Single-writer structural guard (§9.1 DERIVED-DUAL-VIEW)` failed). Removed
  the injection → **green**, 10/10. Confirmed.
- **CONSUMERS/C2.4 registry (DEC-16).** Removed
  `"server/lib/value-summary-tick.js"` from `value-ledger.js`'s `CONSUMERS`
  array. Re-ran `ledger-metrics-parity.test.js` → **red** (C2.4 mismatch).
  Restored → **green**, 4/4. Confirmed.
- **Chronology disposition.** Removed
  `"server/lib/value-summary-tick.js": "scanned"` from `FILE_DISPOSITIONS` in
  `chronology-ordering.test.js`. Re-ran → **red**, with the exact literal
  message the implementer's log quotes (`...has no disposition in
  FILE_DISPOSITIONS`). Restored → **green**, 6/6. Confirmed.
- **i18n E1.1 parity.** Deleted `planLedger.pool.altitudes.queued` from
  `client/src/i18n/locales/ko/projectDetail.json`. Re-ran
  `i18n.test.ts` → **red**, with the exact mismatch string the implementer's
  log quotes (`projectDetail/ko: missing [planLedger.pool.altitudes.queued]`).
  Restored → **green**, 76/76. Confirmed.

All four independently re-run mutation proofs behaved exactly as claimed.

## 4. NEW findings — not disclosed in the implementer's report

These were found during my own pass through the shipped diff and are **not**
among the 12 reported reds and **not** covered by the implementer's
three-bug explanation.

### 4a. MANDATORY: DEC-16 structural scan (Task 10 Case 8) is entirely
missing from the shipped test file — BLOCKING

`build-brief.md`'s "Durable-cure obligations (MANDATORY)" item 3 and
`test-plan.md` line 276 both require a Case 8: comment-stripped source scan
of `value-summary-tick.js` asserting it imports `assembleValuePool` and does
**not** contain `FROM project_paths` / `FROM detour_dispositions` /
`detectTrunkDrift`, red-proven by injecting a real dead
`db.prepare("SELECT ... FROM project_paths")` and observing failure.

`grep -n "readFileSync\|hand-rolled\|structural scan\|stripped"
server/__tests__/value-summary-tick.test.js` returns **nothing**. There is no
such test anywhere in the shipped suite. The production file itself is
currently clean (verified: `value-summary-tick.js` only imports
`assembleValuePool` from `value-ledger.js` and `enrichPoolAltitudes` from
`value-summary.js`, no raw SQL), so there is no live defect today — but the
**guard that would catch a future regression does not exist**, contrary to
the build brief's explicit MANDATORY obligation #3 and the build-task-list's
own MANDATORY Defect-Catalog Obligations §9.3 line item ("DEC-16 structural
scan: No hand-rolled pool SQL in tick... Status: ✓ ... build report must
include red outputs" — no such red output exists because no such test
exists).

### 4b. MANDATORY §9.3: the "environment wiring" tests are vacuous —
BLOCKING (exactly the catalog's own named failure mode)

`value-summary-tick.test.js`'s two "environment wiring" tests
(`DASHBOARD_VALUE_SUMMARY_TICK_MODE=off prevents timer registration` and
`DASHBOARD_VALUE_SUMMARY_TICK_MS=0 prevents timer registration`) contain
**zero assertions**. Each calls `startValueSummaryTick(() => {})` and a
comment says "No assertion error = mode was recognized" — there is no spy on
`setTimeout`/`setInterval`, so these tests pass regardless of whether a timer
is actually registered. `test-plan.md`'s own Case 7 spec explicitly warns
against exactly this: "...plus the non-disabled control case asserting
`setTimeout` *was* called once (**without it, the two negative assertions
pass vacuously**)." The shipped tests have neither the `setTimeout` spy nor
the positive control case the plan calls for. This is a direct, textbook
instance of `PROJECT-CONTEXT.md`'s own §9.3 VACUOUS-GUARD pattern (a "green
scan" that reads as enforced but structurally cannot fail), which this same
build's task list names as a MANDATORY, non-negotiable obligation to avoid.
Neither the `grep "assert.ok(true"` nor `grep "|| true"` vacuous-guard sweeps
catch this shape (zero assertions, not a fake-true assertion), which is worth
flagging as a gap in the sweep itself, but does not change the outcome: this
guard is vacuous and must be treated as unmet.

### 4c. `npx tsc --noEmit` is not clean, and the 2 errors are new, not
pre-existing (see §1 above and §2c) — mischaracterized in the implementation
log.

### 4d. Task 17 (OPEN-4 latency measurement) was never performed

`intake/2026-08-04-value-summary-tick/decisions.md`'s OPEN-4 row still reads
the unfilled placeholder: `_(implementer fills: P = __, U = __, worst case =
__, shipped defaults = __)_`. The build-task-list's own Build Report
Checklist requires this filled before sign-off ("OPEN-4 filled: P = __, U =
__, worst case = __, shipped defaults recorded").

### 4e. Task 18 (manual browser validation, AC-1/AC-2/LLM-off/fast-path/audit
log) has no recorded evidence anywhere in `implementation-log.md`.

### 4f. Task 21 (adversarial diff review + commit) never happened

The worktree has no commit beyond `b155f83` (`master`'s tip); the entire
change set is uncommitted working-tree state. The implementer's own log says
explicitly: "Tasks 15–21 are test/verification/doc/commit steps handled
inline below and left for orchestrator sign-off on the commit itself" — i.e.
the implementer self-reports these as not done, which is consistent with what
I found, but this means the build is not actually finished per its own task
list, independent of the 12-red-test question.

## 5. DEC-16 / DEC-15 single-composer structural check (requested item 5)

Confirmed directly by reading `server/lib/value-summary-tick.js`:
- Line 40: `const { assembleValuePool } = require("./value-ledger");`
- Line 41: `const { enrichPoolAltitudes } = require("./value-summary");`
- No `db.prepare(...)` calls anywhere in the file, no `FROM project_paths` /
  `FROM detour_dispositions` / `detectTrunkDrift` text anywhere (only in a
  doc comment describing the invariant, not executable code).
- All database access from the tick is via `dbModule.stmts.*` prepared
  statements defined once in `server/db.js` (`listValueSweepTargets`,
  `upsertValueSweepState`, `insertValueSummaryGeneration`) — no ad hoc SQL.

The **code** satisfies DEC-16/DEC-15's single-composer rule today. The
**guard that would catch a regression** (test-plan Case 8) does not exist —
see §4a.

## 6. Four-term audit-log partition assertion (requested item, MANDATORY
obligation #5 from build-brief)

`grep -rn "cache_hits.*generated.*queued.*unavailable" server/__tests__/` —
every occurrence in `value-summary-tick.test.js` (lines 241, 268, 417, 435,
470) uses the corrected four-term `+`/`===` form
(`cache_hits + generated + queued + unavailable === pool_size`). No `<=`
variant, no three-term variant found anywhere in the new test file. This
MANDATORY obligation is met.

## 7. Definition of Done — walked against both plans

| Item | Status | Evidence |
|---|---|---|
| `npm run test:server` 0 fail | **NOT MET** | 11 fail (§1, §2) |
| `npm run test:client` 0 fail | **NOT MET** | 1 fail (§1, §2c) |
| `tsc --noEmit` clean | **NOT MET** | 2 errors, new (§1, §4c) |
| `check-headers.sh` exit 0 | MET | §1 |
| No `ALTER TABLE` | MET | §1 |
| Vacuous-guard text greps | MET (but see §4b — a structural vacuous guard the greps can't see) | §1, §4b |
| T-A..T-E trap table zero unresolved rows | **MET on paper, NOT MET in practice** — T-A's own covering test is red and its fix is nontrivial (§2a); T-C's instrument test is currently red for the makeSweptProject reason (§2b) | §2a, §2b |
| Four-term partition, no `<=`/three-term variant | MET | §6 |
| Red-before-green evidence, all guards, independently re-observed | **PARTIALLY MET** — 4 of the MANDATORY structural guards independently re-confirmed red→green (§3); DEC-16 Case 8 guard **does not exist** (§4a); env-wiring guard is vacuous (§4b) | §3, §4a, §4b |
| `openapi.js` untouched, contract green | MET | §1 |
| MCP not touched, typecheck/build correctly skipped | MET | confirmed `git status --porcelain -- mcp/ server/openapi.js` empty |
| OPEN-4 measured | **NOT MET** | §4d |
| Manual browser pass (AC-1/AC-2/LLM-off/fast-path/audit log) | **NOT MET** | §4e |
| Diff reviewed end-to-end, commit made (Task 21) | **NOT MET** | §4f |

## 8. Docker stack

Not applicable — this repo runs `test:server`/`test:client` against throwaway
SQLite DBs with no container dependency, matching `build-brief.md`'s explicit
"Docker stack: Not provisioned" call. Confirmed no compose files were
referenced anywhere in the plans or by me during verification.

---

# Second Verification Pass (Verifier — re-check of test-author's fix log)

Worktree used: `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor`
(still uncommitted working-tree state on top of `master @ b155f83`, no new
commit exists — same as first pass).

All six findings from my first pass were re-checked independently, not by
reading the fix log's claims. Where a claim needed a mutation to confirm, I
performed the mutation myself, observed the expected result, then restored
the file byte-for-byte (`diff <backup> <file>` confirmed identical after
every probe; `git status --porcelain` matched the fix-log's own diff
throughout).

## 1. Full suite counts (re-run independently, second pass)

- `npm run test:server`: **1616 tests, 1616 pass, 0 fail, 0 skipped.**
  Matches the fix log's reported count exactly. (Up from 1614/1603/11 fail on
  first pass — 2 new tests added: the DEC-16 structural-scan case and one
  extra environment-wiring case for the positive control.)
- `npm run test:client`: **795 tests, 795 pass, 0 fail.** Matches reported.
- `cd client && npx tsc --noEmit`: **0 errors.** Confirmed clean — no output
  at all. The two `PlanLedgerPanel.test.tsx:514-515` errors from the first
  pass are gone.
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: exit 0, clean.
- `git status --porcelain` in the worktree: unchanged from the fix-log's own
  diff throughout my session (confirmed after every mutation probe).

## 2. Finding 1 (T-A concurrency) — RESOLVED, confirmed via direct mutation

Read the shipped test (`server/__tests__/value-summary.test.js` lines
285–314). The fix does exactly what the fix log claims:
`deferredSpawn(...)()` (factory now invoked), `spawnCount >= 2` replacing the
exact `=== 2`, and `project_level.startsWith("P-")` replacing the exact
`["P-1","P-2"].includes(...)`.

**Re-confirmed the root cause is real, not just papered over.** Instrumented
the test with a temporary debug `console.log` and re-ran:
`DEBUG spawnCount=4 project_level=P-4 stakeholder_level=S-4.` — confirms
`__injectSpawnForTest` really does clear the probe cache and really does
produce 4 spawns (2 probe + 2 generation), exactly as both my first pass and
the fix log diagnosed. File restored byte-for-byte after the probe (`diff`
confirmed identical).

**Confirmed the loosened assertions are still genuinely load-bearing, not a
trivial always-pass rewrite,** via two direct product-code mutations
(each applied to `server/lib/value-summary.js`, observed, then reverted
byte-for-byte, `diff` confirmed identical):

- Disabled the `upsertValueUnitSummary.run(...)` call entirely (commented
  out) → test went **red**: `atomic upsert: one row, never a duplicate — 0
  !== 1`. Confirms `rows.length === 1` is a real, currently-passing,
  breakable assertion — not a tautology.
- Forced `altitudes[unit.unitKey]` to never be set (simulating a downgrade
  to unresolved) → test went **red**: `a race must never downgrade a unit to
  queued/unavailable`. Confirms the "never downgraded" invariant, the actual
  subject of T-A's real risk (a race silently marking a resolved unit as
  queued/unavailable), is genuinely enforced.

**One residual caveat, non-blocking:** `assert.ok(spawnCount >= 2, ...)` is
now weak — it only fails if zero or one spawn occurred, which isn't the
scenario T-A actually guards against (WATCH-7's wasteful-but-safe dual-spawn
behavior). This is an honest, disclosed weakening (the fix log's own comment
explains why), not a concealed one, and the properties that actually matter
for T-A (no throw, no duplicate row, no corruption, no downgrade) are all
independently confirmed load-bearing above. Verdict: **RESOLVED**, with the
spawn-count assertion downgraded to a sanity check rather than a strict
invariant — acceptable given the disclosed rationale and the mutation-proven
strength of the assertions that actually carry T-A's intent.

## 3. Finding 2 (tick-fixture 3 bugs) — RESOLVED, confirmed by direct read

Read `server/__tests__/value-summary-tick.test.js`:
- Line 50: `stmts.insertProjectPath.run(id, ...)` present in `makeSweptProject`
  — confirmed.
- Lines 134–138: `beforeEach` now clears all five tables (`value_unit_summaries`,
  `value_summary_sweep_state`, `value_summary_generation_log`,
  `project_paths`, `projects`) — confirmed, matches exactly the two extra
  `DELETE`s I specified in my first pass.
- Line 359: `__injectPoolAssemblerForTest(async (dbModule, { id: projectId }) => {...})`
  — two-argument signature confirmed, matches the tick's real call shape.

`node --test server/__tests__/value-summary-tick.test.js`: **17/17 pass**
(15 original cases + the new DEC-16 structural-scan case + 1 additional
environment-wiring positive-control case). Verdict: **RESOLVED**.

## 4. Finding 3 (PlanLedgerPanel AC-2 ambiguity) — RESOLVED

Line 472 (now `getAllByText("P")[0]`), confirmed by direct read.
`npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx`:
**14/14 pass.** Verdict: **RESOLVED**.

## 5. Finding 4 (2 new tsc errors) — RESOLVED

Lines 514–515 now use `warnSpy.mock.calls[0]!.join(" ")` (non-null
assertion, justified by the `toHaveBeenCalledTimes(1)` assertion immediately
above). `npx tsc --noEmit` independently re-run: 0 errors, confirmed above
in §1. Verdict: **RESOLVED**.

## 6. Finding 5 (missing MANDATORY DEC-16 structural scan) — RESOLVED,
confirmed mutation-provable

The new `describe("value-summary-tick: DEC-16 structural scan", ...)` block
(lines 383–418) exists in the shipped file. **Independently mutation-tested
it myself** (not trusting the fix log's own claimed proof): added a real
(uncommented) dead line to `server/lib/value-summary-tick.js` —
`function __deadProbe(db) { return db.prepare("SELECT project_id FROM project_paths"); }`
— re-ran the test → **red**:
`tick source must not contain 'FROM\s+project_paths' (violates DEC-16
single-composer rule)`. Reverted the file byte-for-byte (`diff` confirmed
identical) → re-ran → **green**. This guard is genuinely load-bearing, not
a loose-assertion pass-regardless shape. Verdict: **RESOLVED**.

## 7. Finding 6 (vacuous environment-wiring tests) — RESOLVED, confirmed
mutation-provable, positive control genuinely works

The shipped `describe("value-summary-tick: environment wiring", ...)` block
(lines 420–492) now has three tests: a positive control (`with mode enabled
(default), timer registration happens on start`, asserting
`setTimeoutCalls.length > 0`) plus the two negative cases, each now spying on
`global.setTimeout` and asserting `setTimeoutCalls.length === 0` (not the
previous zero-assertion shape).

**Independently performed the mutation proof myself** (not trusting the fix
log's self-reported one), on `server/lib/value-summary-tick.js`:

1. Removed the `if (mode === "off") return;` gate (replaced with a comment)
   → re-ran → the **negative** test (`DASHBOARD_VALUE_SUMMARY_TICK_MODE=off
   prevents timer registration`) went **red**
   (`setTimeout must NOT be called when DASHBOARD_VALUE_SUMMARY_TICK_MODE=off`).
   Positive control still passed (unaffected, as expected — it doesn't set
   the env var). Restored byte-for-byte (`diff` confirmed identical).
2. Forced `startValueSummaryTick` to always `return;` immediately (breaking
   the enabled path) → re-ran → the **positive control** itself went **red**
   (`setTimeout MUST be called when tick mode is enabled (positive control)`).
   Restored byte-for-byte (`diff` confirmed identical); full tick suite
   re-confirmed 17/17 green afterward.

Both directions of the intended trap are proven: the guard catches both "off
doesn't gate" and "on doesn't register," and the positive control itself is
provably not vacuous. Verdict: **RESOLVED** — the §9.3 VACUOUS-GUARD pattern
flagged on the first pass is fully cured.

## 8. T-A..T-E trap-coverage table (re-check) — still correct and complete

Re-read `qa/test-plan.md` lines 125–129 (the T-A..T-E table). All five rows'
named covering tests exist in the shipped suite and independently re-run
green: T-A (`value-summary.test.js` concurrency describe, §2 above), T-B
(3-layer coverage: composer truth-table case 3, route Case B, client "45
unavailable units" test — all re-run green), T-C (tick instrument test,
re-run as part of the 17/17 green tick suite), T-D (composer case 4 + "never
in both, never in neither," route Case A, client AC-2 same-render test — all
re-run green), T-E (client out-of-registry warning test — re-run green as
part of the 14/14 PlanLedgerPanel suite). Zero unresolved rows, confirmed.

## 9. Four-term audit-log partition formula (re-check) — still correct

`grep -n "cache_hits.*generated.*queued.*unavailable"` across
`value-summary-tick.test.js` (5 occurrences, lines 245, 272, 514, 532, 567 in
the current file): every occurrence uses the four-term `+`/`===` form. No
`<=` variant, no three-term variant found. MANDATORY obligation still met.

## 10. Standing guards — re-run independently, all still green

- `single-writer-guard.test.js` + `ledger-metrics-parity.test.js` +
  `chronology-ordering.test.js` run together: **20/20 pass, 4 suites.**
- `client/src/i18n/__tests__/i18n.test.ts`: **76/76 pass.**
- All four MANDATORY structural guards independently mutation-proven on the
  first pass (§9.1 single-writer, DEC-16 CONSUMERS/C2.4, chronology
  disposition, i18n E1.1 parity) were not re-mutated this pass (no change to
  those code paths since first pass), but their test files are unmodified
  from the first-pass diff and all re-ran green above — no regression.

## 11. Non-gating outstanding items (still open, as expected — not new
blockers now that the test gate is clean)

- **Task 17 / OPEN-4 (coverage-latency measurement):** still unfilled.
  `intake/2026-08-04-value-summary-tick/decisions.md`'s OPEN-4 row still
  reads the placeholder `_(implementer fills: P = __, U = __, worst case =
  __, shipped defaults = __)_`. Confirmed via direct read, unchanged from
  first pass.
- **Task 18 (manual browser validation):** no evidence found anywhere in
  `implementation-log.md` (grepped for "Task 18", "manual browser" — no
  hits). Unchanged from first pass.
- **Task 21 (adversarial diff review + commit):** no commit exists beyond
  `master`'s tip `b155f83`; `git log --oneline -1` in the worktree confirms.
  `implementation-log.md` line 4 self-reports "Tasks 15–21 ... left for
  orchestrator sign-off on the commit itself." Unchanged from first pass.
- MCP / `openapi.js` untouched: `git status --porcelain -- mcp/
  server/openapi.js` returns empty, confirmed again.

## 12. Updated Definition of Done

| Item | Status | Evidence |
|---|---|---|
| `npm run test:server` 0 fail | **MET** | §1 (1616/1616) |
| `npm run test:client` 0 fail | **MET** | §1 (795/795) |
| `tsc --noEmit` clean | **MET** | §1 (0 errors) |
| `check-headers.sh` exit 0 | MET | §1 |
| No `ALTER TABLE` | MET | (unchanged from first pass) |
| Vacuous-guard sweep, incl. structural (zero-assertion) shape | **MET** | §7 — env-wiring guard now mutation-proven both directions |
| T-A..T-E trap table zero unresolved rows | **MET** | §8 |
| DEC-16 Case 8 structural scan | **MET** | §6 — mutation-proven |
| Four-term partition, no `<=`/three-term variant | MET | §9 |
| Red-before-green evidence, all guards, independently re-observed | **MET** | §2–§7, §10 |
| `openapi.js` untouched, contract green | MET | §11 |
| MCP not touched | MET | §11 |
| OPEN-4 measured | **NOT MET** (non-gating — sign-off item, not a test-suite defect) | §11 |
| Manual browser pass (AC-1/AC-2/LLM-off/fast-path/audit log) | **NOT MET** (non-gating — post-test-gate step) | §11 |
| Diff reviewed end-to-end, commit made (Task 21) | **NOT MET** (non-gating — post-test-gate step, happens after this verdict) | §11 |

## 13. Verdict

**GREEN-WITH-CAVEATS.**

All six findings from my first BLOCKED pass are independently confirmed
resolved — not by trusting the fix log's self-report, but by re-reading the
diffs and, for every item that could hide a trivial/vacuous rewrite,
performing my own mutation proof (T-A's two invariant-breaking product-code
mutations, DEC-16's dead-SQL injection, the env-wiring gate's two-directional
break) and confirming red, then restoring byte-for-byte and confirming
green. `npm run test:server` (1616/1616), `npm run test:client` (795/795),
and `cd client && npx tsc --noEmit` (0 errors) are all independently
reproduced, not just re-quoted. All standing guards (§9.1 single-writer,
DEC-16 CONSUMERS/C2.4, chronology disposition, i18n E1.1, and the now-fixed
DEC-16 Case 8 + env-wiring guards) are present and pass. The T-A..T-E trap
table and the four-term audit-log partition are both complete and correct.

The test/build gate itself is clean with **no caveats on the suite**. The
remaining caveats are the three pre-existing non-test-suite sign-off items
that were always sequenced *after* the test gate, not new problems
discovered this pass:

1. **OPEN-4 coverage-latency measurement is unfilled** — the placeholder in
   `decisions.md` still needs real `P`/`U` numbers recorded before Sara's
   sign-off.
2. **Task 18 manual browser validation has not been performed/recorded.**
3. **Task 21 adversarial diff review + commit has not happened** — the
   entire change set remains uncommitted working-tree state on top of
   `master @ b155f83`.

None of these are test, build, or standing-guard failures — they are the
project's own remaining build-task-list steps that come after the test gate
clears. They should be completed next, in order, before this effort is
considered fully signed off.

---

# Third Verification Pass (Verifier — independent mutation re-proof of B1/B2/S1/S3/S6 and re-check of S2/S4)

Worktree used: `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor`
(still uncommitted working-tree state on top of `master @ b155f83`; `git log
--oneline -3` confirms no new commit — unchanged from both prior passes).

This pass does not trust either fix log's self-report. Every mandated
mutation was performed with my own scratch scripts (not the shipped tests'
own fixtures), each product file was backed up before mutation and confirmed
byte-identical via `diff` after every restore, and `git status --porcelain`
was re-checked after each probe to confirm no residue was left in the
tracked/untracked diff.

## 1. Full suite counts, re-run independently (third pass)

- `npm run test:server`: **1621 tests, 1621 pass, 0 fail.** Matches the
  test-author's final reported count exactly.
- `npm run test:client`: **795 tests, 795 pass, 0 fail.** Matches reported.
- `cd client && npx tsc --noEmit`: **0 errors**, confirmed clean.
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: exit 0, clean.
- `git status --porcelain`: unchanged from the test-author's own diff
  throughout my entire session (re-verified after every mutation probe below).
- Re-run after all mutation probes in this pass, as a final sanity check:
  server 1621/1621, client 795/795, tsc 0 errors, headers clean — all
  unchanged, confirming no probe left product code mutated.

## 2. B2 — independently re-proven by direct script injection (not the shipped test)

Read `server/lib/value-summary-tick.js:79-188` directly. The shape matches
the implementer's log: `catch (err)` now binds and logs
(`console.warn(\`value summary sweep failed for project ${projectId}:\`,
err.message)`), `poolSize = 0` is set inside the `catch`, and on
`outcome === "error"` the bookkeeping block calls
`upsertValueSweepStateKeepPending` (new prepared statement, `server/db.js:3228-3233`,
confirmed by direct read: `ON CONFLICT(project_id) DO UPDATE SET
last_swept_at = excluded.last_swept_at` — no `pending_after_sweep` clause,
so it is structurally impossible for this write path to touch that column)
instead of `upsertValueSweepState`.

**Independent injection probe (own Node script, not `node --test`, using the
production `__injectPoolAssemblerForTest` seam directly):**
1. Seeded one project, ran a real successful tick (45 units, 40 resolved) →
   `pending_after_sweep = 5` confirmed via direct `SELECT` on
   `value_summary_sweep_state`.
2. Injected a pool assembler that always throws (`simulated assembly
   failure`) and ran a second tick → `pending_after_sweep` remained **5**
   (not clobbered to 0), `last_swept_at` **advanced** to a new timestamp,
   and the new generation-log row read `outcome: 'error', pool_size: 0,
   cache_hits: 0, generated: 0, queued: 0, unavailable: 0` — partition holds
   trivially (0 === 0).
3. **Mixed-failure case, independently constructed** (assembly succeeds so
   `poolSize` is set to 45 before the throw, then the composer itself
   throws): monkeypatched `dbModule.stmts.getValueUnitSummary.get` to throw
   mid-`enrichPoolAltitudes` (simulating a realistic `SQLITE_BUSY` on the
   cache read, since `enrichPoolAltitudes` is documented to "never throw" by
   its own design — the only way it can genuinely throw is a DB-statement
   failure, so this is the honest reproduction of the mixed case, not
   `enrichPoolAltitudes` module-export monkeypatching, which I first tried
   and confirmed does NOT work — `value-summary-tick.js` destructures
   `enrichPoolAltitudes` at `require`-time, so patching the module's export
   afterward is silently ignored, a dead end worth noting for future
   probes). Result: `outcome: 'error', pool_size: 0` (the `catch` block's
   `poolSize = 0` correctly overrides the 45 set moments earlier),
   `cache_hits + generated + queued + unavailable === pool_size` → `0 === 0`.
   `pending_after_sweep` for that project stayed at its prior value.

**Verdict: B2 RESOLVED**, confirmed by my own independent injection, not the
shipped tests. Both the simple-failure and the genuine mixed-failure case
(assembly succeeds, synthesis throws) preserve `pending_after_sweep`, advance
rotation, and hold the four-term partition.

## 3. S1 — independently re-proven: audit-log write failure for the FIRST project in a 3-project sweep does not starve the 2nd/3rd

Own script (not the shipped `it()`): seeded 3 projects with
`MAX_PROJECTS_PER_TICK=3`, injected `stmts.insertValueSummaryGeneration.run`
to throw only on its first invocation (targeting the first project swept),
left it working normally thereafter, and ran one tick.

Result: `tick result: { swept: 3, projects: [...] }` — the tick call itself
did not reject and all three projects were processed. Project 1 (whose
audit-log write threw) has `last_swept_at` set (rotation advanced) but no
generation-log row (write genuinely failed, logged via `console.warn`).
Projects 2 and 3 both have `last_swept_at` set AND a generation-log row with
`outcome: 'ok'` — proving the failure on project 1's bookkeeping did not
abort the loop or prevent projects 2/3 from being swept. No starvation.

**Verdict: S1 RESOLVED**, confirmed independently — the write-order fix
(rotation-advance before audit-log insert, both wrapped in their own
try/catch outside a `finally`) genuinely prevents the starvation scenario
the review named.

## 4. S6 — the underlying PRODUCT fix is real and mutation-proven, but the SHIPPED TEST claiming to cover it is vacuous — NEW FINDING, not caught by either prior pass

**Product fix confirmed real,** via my own independently-constructed
duplicate (not the shipped fixture): built 41 raw misses — 40 unique units
plus a second copy of unit 0's `unitKey` appended at the end (so, un-deduped,
the key would occupy both an in-cap slot at position 0 and an over-cap slot
at position 40) — and called `enrichPoolAltitudes` directly. Result: the key
landed in `altitudes` only, never `states` (`exactly one: true`). Then, with
the codebase's dedup line (`server/lib/value-summary.js:203`,
`dedupedMisses = [...new Map(misses.map(u => [u.unitKey, u])).values()]`)
**temporarily removed** (all `dedupedMisses` references reverted to raw
`misses`), the identical probe script went **red**: the duplicate key landed
in **both** `altitudes` and `states` (`in altitudes: true, in states: true
'queued'`, `exactly one: false`). Restored the file byte-for-byte
(`diff` confirmed identical) → probe green again. **This confirms the S6
product fix is real, necessary, and correctly implemented.**

**However, the SHIPPED test claiming to cover S6**
(`server/__tests__/value-summary-tick.test.js:661-696`, `"duplicate unitKey
spanning the cap boundary lands in exactly one map"`) **does not actually
construct a duplicate key at all**, despite its own comments claiming
otherwise ("Create 45 misses: 39 unique + 1 duplicate appearing twice",
"original position: indices 38 and 40"). The fixture is:
```js
const unique39 = makeUnits(39);
const dup = unit({ unitKey: "trunk_commit::dup::/repo", value_ref: "dup" });
const misses = [...unique39, dup]; // 40 units now with duplicate
```
`unique39` contains keys `u0`..`u38` — none of them is `"trunk_commit::dup::/repo"`.
`dup` is therefore the **only** occurrence of that key in the 40-item array.
Independently counted programmatically: `misses.filter(u => u.unitKey ===
"trunk_commit::dup::/repo").length === 1`, not 2. There is no duplicate in
this fixture at all; it is a single unique unit sitting at the 40th (in-cap,
last) slot.

**Proved this test is vacuous with respect to its stated purpose by running
it (not a standalone probe — the actual `node --test` file) against the
codebase with the S6 dedup fix completely removed**: reverted
`server/lib/value-summary.js`'s dedup line exactly as in my own probe above,
then ran `node --test server/__tests__/value-summary-tick.test.js` — the
shipped S6 test (`ok 12 - value-summary-tick: S6 should-fix (duplicate
unitKey deduped)`) **still passed**. Restored the file byte-for-byte (`diff`
confirmed identical), re-ran full suite → 1621/1621 green again, no residue.

This is exactly the property the review's own B1 finding warns about in a
different guise: a test whose narrative comments describe covering a defect,
with real (non-zero) assertions, that in fact tests something else — here,
an ordinary single-unit-at-the-cap-boundary case, not the "never in both"
duplicate-key property it's named for and claims to prove. It passes
regardless of whether the dedup fix exists, so it provides **zero** actual
regression protection for S6.

**Verdict: S6's product fix is RESOLVED and independently mutation-proven by
me. The test coverage claimed for S6 in `red-evidence.md` ("Product fix S6
works... Verification: ... PASS") is FALSE — the shipped test does not
exercise the fix at all.** This is a genuine gap: **BLOCKING** for the
specific claim "S6 is now tested," though not blocking for "the S6 defect
itself is fixed in product code" (which it is, per my own independent
probe). Recommended fix, precise: change the fixture to include the
duplicate key **twice** in the raw list before the cap, e.g.
`const misses = [...unique39, dup, dup];` (41 raw misses, `dup`'s key
appearing at both position 39 — landing in-cap — and position 40 — which
would land over-cap without the fix) or more directly mirror my own probe
(40 unique + 1 duplicate of the first unique key, appended last). Then
re-run with the fix reverted to confirm this specific test goes red before
trusting it as a regression guard.

## 5. S3 — independently re-proven by mutation on the shipped test

Read `server/routes/project-plans.js:141-173` directly: the loop now splits
the two rejection cases exactly as described — a unit with a valid, non-empty
`unit_key` but an unrecognized `value_source` is recorded as
`states[u.unit_key] = "unavailable"` before `continue`; a unit with no
usable key (missing/non-string/empty) is still silently dropped (no key to
report a state against). Read the shipped test
(`server/__tests__/value-summary.test.js:500-545`,
`"S2 should-fix: route sanitization preserves rejected units with valid
unit_key in states"`) — it is real: asserts `res.body.altitudes` has exactly
1 key (the good unit), `res.body.states["trunk_commit::bad-source::/repo"]
=== "unavailable"`, and that the empty-key unit appears in neither map
(`allKeys.length === 2`, not 3).

**Independently mutation-tested**: reverted the route's S3 fix (removed the
`states[u.unit_key] = "unavailable"; continue;` branch, restoring the old
unconditional silent-drop for a bad `value_source`) and re-ran
`value-summary.test.js` → the S2/S3 test went **red**:
`assert.ok(res.body.states["trunk_commit::bad-source::/repo"])` failed
(`expected: true, actual: false`). Restored the route file byte-for-byte
(`diff` confirmed identical) → re-ran → 25/25 green again.

**On the "no usable key" reasoning**: confirmed sound. A unit with no key at
all (blank/missing/non-string `unit_key`) has no identifier to attach a
`states` entry to — `states` is keyed by `unit_key`, so there is genuinely no
representable slot for it in either map. This is the one case DEC-11's
per-key partition contract cannot cover by construction, not an oversight —
the implementer's own framing in the fix log is accurate.

**Verdict: S3 RESOLVED, confirmed via my own mutation, not just re-reading
the diff.**

## 6. B1 — the AC-1 flow-proof test IS genuinely load-bearing (mutation-proven), but deviates from the review's specified implementation (route vs. direct call) — worth naming, not blocking

Read `server/__tests__/value-summary-tick.test.js:699-750`
(`"tick writes resolved units to DB, later read-back recovers them even with
LLM off"`). It is not an empty body — it seeds a tick (45 units, 40
resolved via a fake spawn), asserts the DB now holds exactly 40 rows in
`value_unit_summaries`, then with `DASHBOARD_FOCUS_INFER_MODE=heuristic`
(LLM off) calls `enrichPoolAltitudes` directly a second time and asserts the
40 resolved units come back as `altitudes` (from cache) and the remaining 5
as `unavailable` in `states`, with the full 45-unit partition holding.

**Independently mutation-tested**: disabled the single write call inside
`enrichPoolAltitudes`
(`dbModule.stmts.upsertValueUnitSummary.run(unit.unitKey, project,
stakeholder, model);` → commented out) — i.e., broke the tick's write path
at its one lexical writer. Re-ran the suite → this specific test went
**red**: `tick 1 wrote 40 resolved units to the cache table — 0 !== 40`.
Restored the file byte-for-byte (`diff` confirmed identical) → re-ran →
21/21 green in the tick file, 1621/1621 across the full server suite. **This
confirms the test is genuinely load-bearing, not a new vacuous shape** — the
specific defect B1 named (an empty-body `it()`) is resolved, and the
replacement is a real, breakable test.

**One deviation from the review's exact prescribed fix, worth naming
precisely:** B1's "Fix" section explicitly specifies driving the read-back
"then `POST /api/project-plans/altitudes`" — i.e., through the actual HTTP
route, to prove genuine cross-invoker behavior at the wire level (the tick as
one process/invoker, the route as a second, independent invoker, reading
back through the full request path). The shipped test instead calls
`enrichPoolAltitudes` directly a second time in the same test process — the
shared composer function both the tick and the route call, but not the route
itself, and not over HTTP. This still proves the core AC-1 claim (the tick's
DB writes persist and are read back by a second, independent invocation of
the shared composer, with the LLM off so a pass can only come from
persistence) — my mutation proof above confirms the write-path property is
real — but it is a narrower proof than "the route, over HTTP, reads back the
tick's writes," which is what AC-1's own language in `test-plan.md:740-742`
("Case 10 (read-back through `POST /altitudes`..." ) actually promises. This
is a **non-blocking caveat**: the property that matters (persistence
survives a second invocation with the LLM off) is proven and mutation-hard,
but the specific "through the HTTP route" framing of AC-1 is not literally
exercised by this test. Worth a follow-up test that layers the actual
`POST /api/project-plans/altitudes` call on top of this one (parallel to how
`value-summary.test.js`'s Case A/B already do), if genuine wire-level
confidence in this exact path is later required.

## 7. S2/S4 — confirmed real and mutation-proven (not just read)

**S2** (`value-summary.test.js:500-545`): already covered in §5 above via the
same mutation (reverting S3's product fix breaks this test) — confirmed real.

**S4** (`value-summary.test.js:547-571`, `"S4 should-fix: route sends states
even for cached/resolved units (never undefined)"`): read the test — asserts
`res.body` has an own `states` property (`hasOwnProperty`) and that it
deep-equals `{}` for an all-resolved batch. **Independently mutation-tested**:
edited the route to drop `states` from the JSON response entirely
(`res.json({ altitudes: enriched.altitudes })`) → re-ran → test went **red**
(`error: 'states key present', expected: true, actual: false`). Restored the
route file byte-for-byte (`diff` confirmed identical) → re-ran → green again.
**Confirmed non-vacuous.**

## 8. T-A..T-E trap-coverage table and four-term partition — re-checked, still consistent

- Re-read `qa/test-plan.md` lines 125-129. All five named covering tests
  exist in the shipped suite. T-A (`value-summary.test.js` concurrency
  describe — unchanged since second pass, not re-mutated this pass since no
  code changed there), T-B/T-D (3-layer coverage, all files read and
  confirmed present), T-C (the instrument test's `it()` title has drifted
  slightly from the plan's literal quoted string — shipped as `"pool grows
  85→88; pending_after_sweep re-derived to 8 (not cached 5)"` inside a
  `describe("value-summary-tick: T-C instrument (pending_after_sweep
  re-derived, not decremented)")` block, vs. the plan's `"pending_after_sweep
  is re-derived from the live pool each sweep, not decremented"` — a cosmetic
  naming drift, not a coverage gap; the actual assertions (85→88 pool growth,
  `pending_after_sweep` re-derived to 8, not a decremented/stale 5) are
  present and were independently re-read). T-E
  (`PlanLedgerPanel.test.tsx:495`, `"an out-of-registry states value warns
  and does not masquerade as an old-server absence (T-E)"` — confirmed
  present).
- Four-term partition formula: `grep -n
  "cache_hits.*generated.*queued.*unavailable"` across
  `value-summary-tick.test.js` and `server/db.js` → every occurrence (5 in
  the test file, 1 in the schema comment) uses the `+`/`===` four-term form.
  No `<=`, no three-term variant, anywhere. Still consistent.

## 9. Nits (N1-N4) — re-confirmed which are fixed, which remain as accepted gaps

- **N1 (env-var clamp)**: confirmed fixed —
  `Math.max(1, Math.floor(numEnv("MAX_PROJECTS_PER_TICK",
  DEFAULT_MAX_PROJECTS_PER_TICK)))` at `value-summary-tick.js:88-91`.
- **N3 (`let generatedKeys` → `const`)**: confirmed fixed — `const
  generatedKeys = [];` at line 106.
- **N2 (dead empty `before()` hook)**: confirmed still present, unfixed
  (`server/__tests__/value-summary-tick.test.js:112-114`) — a test file, left
  untouched by both the product-only implementer pass and the test-author
  pass; an accepted, documented, non-blocking cosmetic gap.
- **N4 (no double-start guard on `startValueSummaryTick`)**: confirmed still
  absent, unfixed — the review itself called this "not a regression" (matches
  `startReconciliation`'s existing house pattern) and explicitly did not
  request it be fixed. Accepted, documented, non-blocking.

## 10. Updated Definition of Done (third pass)

| Item | Status | Evidence |
|---|---|---|
| `npm run test:server` 0 fail | **MET** | §1 (1621/1621, independently reproduced) |
| `npm run test:client` 0 fail | **MET** | §1 (795/795) |
| `tsc --noEmit` clean | **MET** | §1 (0 errors) |
| `check-headers.sh` exit 0 | MET | §1 |
| B1 (AC-1 flow proof, non-vacuous) | **MET, with a named non-blocking caveat** | §6 — mutation-proven load-bearing; deviates from "through the HTTP route" framing |
| B2 (errored sweep preserves pending_after_sweep, logs loudly, mixed-failure partition holds) | **MET** | §2 — independently re-proven via injection, including the genuine mixed-failure case |
| S1 (rotation advances despite bookkeeping failure, no starvation) | **MET** | §3 — independently re-proven with a 3-project sweep |
| S2 (malformed-entry coverage restored) | **MET** | §5, §7 |
| S3 (bad-value_source unit lands in states as unavailable; no-key unit still dropped, reasoning sound) | **MET** | §5 |
| S4 (states always present, non-vacuous) | **MET** | §7 |
| S6 (product fix: duplicate unitKey lands in exactly one map) | **MET (product code)** | §4 — independently mutation-proven |
| S6 (test coverage claim) | **NOT MET — the shipped test does not exercise the fix** | §4 — proven vacuous by running the actual test file with the fix reverted; still passes |
| T-A..T-E trap table zero unresolved rows | **MET** | §8 |
| Four-term partition, no `<=`/three-term variant | MET | §8 |
| Nits N1/N3 | MET (fixed) | §9 |
| Nits N2/N4 | Accepted, documented, non-blocking gaps | §9 |
| OPEN-4 measured | **NOT MET** (non-gating, unchanged) | placeholder still unfilled in `decisions.md` |
| Manual browser pass (Task 18) | **NOT MET** (non-gating, unchanged) | no evidence in either fix log |
| Diff reviewed end-to-end, commit made (Task 21) | **NOT MET** (non-gating, unchanged) | `git log --oneline -3` still shows `b155f83` as tip |

## 11. Verdict

**GREEN-WITH-CAVEATS.**

Every mandated mutation probe in this pass was performed independently — my
own scratch scripts, not the shipped tests, targeting the actual production
code (`value-summary-tick.js`, `value-summary.js`, `project-plans.js`,
`db.js`) via the real test seams (`__injectPoolAssemblerForTest`,
`__injectSpawnForTest`, direct `dbModule.stmts` monkeypatching) — and every
file was restored byte-for-byte and re-verified via `diff` before moving to
the next probe. `npm run test:server` (1621/1621), `npm run test:client`
(795/795), and `tsc --noEmit` (0 errors) are all independently reproduced.

**B2, S1, S3 are fully resolved** — confirmed by direct injection, not by
reading the fix log. **B1 is resolved as a non-vacuous, mutation-hard test**,
with one disclosed, non-blocking framing deviation from the review's exact
prescribed fix (direct composer call vs. HTTP route). **S2/S4 are confirmed
real and mutation-provable.**

**One new, genuine finding from this pass, not caught by either prior
verification pass**: **S6's underlying product fix (the `dedupedMisses` line
in `value-summary.js`) is real, necessary, and independently mutation-proven
by me** — but **the shipped test that claims to cover S6
(`value-summary-tick.test.js:661-696`) does not actually construct a
duplicate key** (verified by direct count: the fixture's "dup" unit is the
only occurrence of its key), and **I proved this by running the actual test
file with the dedup fix completely removed from product code — the test
still passes.** `red-evidence.md`'s claim ("Verification: ... S6 should-fix
... PASS. Proves: Product fix S6 works... ensures a duplicate key never
lands in both maps") is therefore **false as a coverage claim**, even though
the underlying product defect genuinely is fixed. This is a real regression
gap: if a future change reintroduces the pre-fix behavior (e.g., a refactor
that slices `misses` before dedup again), this test suite will not catch it.

This is a **BLOCKING** finding in the narrow sense that the MANDATORY
should-fix S6 is not actually test-covered as claimed and needs a precise,
actionable fix before this can be called done: **change the S6 test's
fixture to genuinely include a duplicated key** — e.g.
`const misses = [...unique39, dup, dup];` (the same key appearing twice, once
landing in-cap and once over-cap without the fix) — and then verify, by
temporarily reverting the `dedupedMisses` line in `server/lib/value-summary.js`
and re-running, that this specific test goes red before trusting it as a
guard. This is a small, precise, one-line-fixture fix, not a design
question — a test author can act on it directly without re-diagnosing.

All other findings from this pass reconfirm the second pass's `GREEN` state
for the test/build gate itself (B1/B2/S1/S2/S3/S4 all independently
mutation-proven this round) and the same three long-standing non-gating
sign-off items (OPEN-4 measurement, Task 18 manual browser validation, Task
21 commit) remain open, unchanged, and correctly sequenced after the test
gate.

**Net verdict: GREEN-WITH-CAVEATS.** The build itself (product code) is
sound — B2, S1, S3, S6 are all genuinely fixed in `value-summary-tick.js` /
`value-summary.js` / `project-plans.js`, confirmed by my own independent
mutation proofs, not self-reports. The one thing that must be corrected
before full sign-off is **not a product defect but a test-authoring gap**:
S6's covering test needs its fixture corrected to contain an actual
duplicate key (precise fix given above), after which it should be
mutation-verified to go red against the reverted fix. Until that test fixture
is corrected, S6 has zero regression protection despite being reported as
tested. The three previously-identified non-gating sign-off items (OPEN-4,
Task 18, Task 21) remain outstanding and should be completed in sequence
after the S6 test-fixture fix, per the same reasoning as the second pass.

## Orchestrator fix (2026-08-04, after 3rd verify pass) — S6 test was still vacuous

The 3rd verifier pass caught that the shipped "S6" test never actually
constructed a duplicate `unitKey` (fixture had `[...unique39, dup]` — `dup`
appeared once, not twice) and that `spawnResolvingFirst(39)` left the
would-be batch copy unresolved, so the "never both" assertion passed
trivially regardless of whether the dedupe fix was present (JS object keys
can't hold two values for one key either way — the test needed the batch
copy to actually *resolve into `altitudes`* while the overflow copy
independently lands in `states`, which requires resolving all 40 batch
slots, not 39).

Fixed directly by the orchestrator (small, fully-specified, single test
file): `misses = [...unique39, dup, dup]` (41 items, key genuinely doubled)
+ `spawnResolvingFirst(40)` (resolves the full batch, including the
in-batch dup copy) + an added assertion that `states` is empty once deduped
(all 40 distinct keys fit in-cap).

**Mutation proof performed directly:** reverted `dedupedMisses` to
`= misses` (no dedup) in `server/lib/value-summary.js` → this specific test
went **red** (`AssertionError: duplicate unitKey appears in exactly one of
altitudes/states, never both`, expected `true` got `false`) → restored
byte-for-byte (`git diff --stat` confirmed the diff returned to its
pre-mutation shape) → test green again.

**Final suite state:** `npm run test:server` → 1621/1621 pass, 403 suites,
0 fail.
