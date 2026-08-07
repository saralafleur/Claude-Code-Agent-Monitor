# Build Task List — Value Pool Slice 3: Auto-group proposal engine

**Effort:** `2026-08-06-auto-group-proposal`
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor`
**Branch:** `effort/2026-08-06-auto-group-proposal` (off `master` @ `c233a36`)
**Date:** 2026-08-06

---

## Sequencing notes

- **Red-first, red-proven throughout.** Every durable-cure and structural guard listed below MUST be observed failing before the feature lands (never reported as done, always performed and independently re-run).
- **No parallelization.** This build uses one sequential implementer; every task depends on prior state.
- **Single commits per logical unit.** Tasks 2 and 3 are explicitly one-commit each (test + code in same commit to avoid windows with no guard).
- **Durable-cure tasks (MANDATORY) marked explicitly.** Task 3 and Task 4 are structural cures tied to defect-catalog ids.

---

## 1. Schema + prepared statements (red-first)

**Files touched:**
- `server/db.js` (three new `CREATE TABLE IF NOT EXISTS` blocks, ~12 new prepared statements)
- `server/__tests__/db-migration.test.js` (new `describe` block with S-1…S-4 assertions)

**Layer:** Server infrastructure  
**Type:** Implementation + test (red-first)

**Changes:**
- Add `value_group_runs`, `value_groups`, `value_group_members` tables to `server/db.js:§4` (technical-plan §4)
- Add prepared statements: `insertValueGroupRun`, `updateValueGroupRunState`, `getLatestValueGroupRun`, `getValueGroupRun`, `listValueGroupRunsForProject`, `markInterruptedValueGroupRuns`, `insertValueGroup`, `listValueGroupsForRun`, `getValueGroup`, `setValueGroupReviewStatus`, `insertValueGroupMember`, `listValueGroupMembersForRun`
- Create test assertions in `db-migration.test.js`:
  - **S-1 [R]:** Three tables exist with exactly the columns and types per technical-plan §4 (use `PRAGMA table_info`)
  - **S-2 [M]:** CHECK-vs-registry parity for four columns (read registry, never hand-copy):
    - `value_group_runs.state` CHECK == `GROUP_RUN_ROW_STATES` (the 4-value persisted set, NOT including `not_attempted`)
    - `value_groups.refinement_state` CHECK == `GROUP_REFINEMENT_STATES`
    - `value_groups.review_status` CHECK == `GROUP_REVIEW_STATES` (including reserved `claimed`)
    - `value_group_members.value_source` CHECK == `valueLedger.VALUE_SOURCES`
  - **S-3 [R]:** Inapplicability asserted: none of the three tables appears in `REBUILD_CASES` or `UPGRADE_CASES`
  - **S-4 [R]:** Dropped-column pin (DEC-S3-1/11): `value_groups` has no `project_id`, no `parent_group_id`, no `reviewed_by`; `value_group_members` has no availability column

**Done check:**
```bash
node --test server/__tests__/db-migration.test.js  # all 4 assertions green
# Boot against a real DB copy; three tables exist
```

**Red-first procedure (S-2):**
- Locally add a 5th value to `GROUP_REFINEMENT_STATES` **without** widening the CHECK → S-2 specifically (not generic failure) names the mismatch → revert

---

## 2. SF-4 extraction + T7 deletion + five T7 successors (ONE COMMIT, never split)

**Files touched:**
- `server/lib/value-coverage-probe.js` (NEW — the extraction)
- `server/routes/project-plans.js` (both `/coverage` handlers call extracted function; SF-2/SF-3 rationale comment moves with the code)
- `server/__tests__/project-plans-api.test.js` (**DELETE T7 lines 905–999 in full**)
- `server/__tests__/value-coverage-probe.test.js` (NEW — P-1…P-8 assertions)
- `server/__tests__/single-writer-guard.test.js` (G-1/G-2/G-4 guard cases)
- `server/__tests__/value-coverage-parity.test.js` (unchanged; this is the canary)

**Layer:** Server routes, SF-4 structural cure  
**Type:** Implementation + test (red-first, deletion + replacement in same commit)

**Changes:**

*New module:*
- Create `server/lib/value-coverage-probe.js` with `buildProbeCoverage(dbModule, projectId, opts = {})` function (technical-plan §6.1)
- **CRITICAL BO-5:** Call `coverageSnapshot` through the module namespace object (`valueCoverage.coverageSnapshot(...)` not destructured), documented in module header so P-7 can observe it
- Preserve the `requestedAt` divergence — it is load-bearing (SF-2/SF-3):
  - POST: `buildProbeCoverage(dbModule, projectId, { requestedAt: nowIso })`
  - GET: `buildProbeCoverage(dbModule, projectId)` (reads from sweep state)
  - This parameterization is what makes both routes correct without forcing parity

*Route handlers:*
- `server/routes/project-plans.js:319-334` (POST) and `:351-365` (GET) — extract the inlined 4-step composition into calls to `buildProbeCoverage`
- Both handlers call it exactly once; SF-2/SF-3 rationale comment moves with the code
- **NO route↔route `deepEqual` parity assertion** — both call one function now, so such an assertion degenerates to `deepEqual(f(X), f(X))` (DEC-S3-4, T7-C4 deliberately not replaced)

*T7 deletion:*
- **DELETE `server/__tests__/project-plans-api.test.js:905-999` in full** — zero lines survive (BO-1 correction: technical-plan §6.1's stale claim that `:988-998` survives is factually wrong)
- T3, T4, T6 are byte-identical to `master` (no edits)

*Five T7 successors (all in this commit):*

Test file: `server/__tests__/value-coverage-probe.test.js` (NEW)

| T7 claim | Successor | Priority | Assertion |
|---|---|---|---|
| **T7-C1** Both handlers call `assembleValuePool(dbModule, { id: projectId })` | `single-writer-guard.test.js` **G-2** + `value-coverage-probe.test.js` **P-1** | `[M]` | **G-2:** call-site count is exactly 3 (brace-walk post/get/propose handlers); **P-1:** `Object.keys(result).sort()` equals T6's own anchor array `["complete","computed_at","demand","described","eta","pending","pool_size","project_id","requested_at"]` (reuse T6's array, never duplicate) |
| **T7-C2** Both call `enrichPoolAltitudes(..., { probe: true })` | **G-2** + **P-5** | `[M]` | **P-5:** counts come from `enrichPoolAltitudes(..., {probe:true})` with no re-derivation inside `buildProbeCoverage` — anchor to a literal fixture-derived number, never `deepEqual(f(x), f(x))` |
| **T7-C3** Both pass `draining: isDrainingProject(projectId)` (SF-3 fix) | **P-6** | `[M]` | `result.draining` matches `isDrainingProject(projectId)` for one draining and one non-draining project. **T7-C3's sole successor.** Must not be dropped or merged. |
| **T7-C4** `postKeys === getKeys` (route↔route parity) | **Deliberately NOT replaced** | `[M]` (as negative instruction) | DEC-S3-4: one function now, parity degenerates. Recorded as intentional non-replacement. A build adding this back fails review. |
| **T7-C5** `postKeys === ["computedAt","counts","draining","projectId","requestedAt"]` (anchor) | **P-7** (behavioral spy) + **P-8** | `[M]` | **P-7** (the headline one): before requiring the probe module, mock `valueCoverage.coverageSnapshot` to capture `Object.keys(argsObject)` on each call; call `buildProbeCoverage` against a seeded project; restore in finally; assert `capturedArgKeys.sort()` equals `["computedAt","counts","draining","projectId","requestedAt"].sort()` with explicit message on the carrier keys; assert spy was called exactly once. **P-8:** `computedAt` is fresh (>= pre-call timestamp, NOT equal to seeded `coverage_requested_at`); proves `computedAt` and `requestedAt` are two distinct facts. |

Additional structure-guard assertions (same file):
- **P-2 [M]:** `opts.requestedAt` when provided is used verbatim, never re-read from sweep state (seed different `coverage_requested_at`, assert passed value wins)
- **P-3 [R]:** omitted → falls back to sweep-state `coverage_requested_at`
- **P-4 [R]:** no sweep-state row → `result.requested_at === null` strictly (not `undefined`)

Single-call-site guard (technical-plan §6.2):
- **G-1 [M]:** `buildProbeCoverage` defined exactly once: `scanFiles(serverDir, /buildProbeCoverage/)` basenames (excl. `*.test.js`) equal exactly `["project-plans.js","value-coverage-probe.js"]`
- **G-2 [M]:** Call-site set is exactly three — brace-walk the three handler bodies (POST coverage-request, GET coverage, POST groups/propose); `buildProbeCoverage(` appears **exactly once in each**, whole-file total **exactly 3**
- **G-4 [M]:** `assertSingleHome("../lib/value-coverage-probe", { "../routes/project-plans": { shared: ["buildProbeCoverage"], absent: [] } })`
- **G-9 [M]:** Negative instruction in top-of-block comment: do NOT add `deepEqual(postCoverageResult, getCoverageResult)` parity assertion (T7-C4 / DEC-S3-4 — vacuous pattern)

**Done check:**
```bash
# All in one commit
git log -1 --pretty=format:"%B" | grep -q "SF-4 extraction"  # commit message names the extraction

# T7 deleted
grep -c "T7 (SF-4)" server/__tests__/project-plans-api.test.js  # must return 0

# Successors present and passing
node --test server/__tests__/value-coverage-probe.test.js  # P-1…P-8 green
node --test server/__tests__/single-writer-guard.test.js  # G-1/G-2/G-4 green

# Canary unchanged
git diff master -- server/__tests__/value-coverage-parity.test.js  # must be empty
node --test server/__tests__/value-coverage-parity.test.js  # must stay GREEN, UNMODIFIED

# T3/T4/T6 byte-identical
git diff master -- server/__tests__/project-plans-api.test.js | grep -E "^@@.*T3|^@@.*T4|^@@.*T6"  # zero changes in those regions
```

**Red-first procedure (exactly as specified):**
1. Inject a **fourth** hand-copy of the 4-step composition inline into a handler → **G-2**'s exactly-3 count fails → revert byte-identical
2. Delete `draining:` from `coverageSnapshot(...)` call → **P-6** fails behaviorally, **P-7** fails naming missing key → restore → green
3. Add a sixth key to `coverageSnapshot(...)` call → **P-7** fails → revert
4. **Each red-proof independently re-run by someone other than the author** (not reported, performed)

---

## 3. Registries + CONSUMERS + assertSingleHome maps + durable-cure helper (ONE COMMIT)

**Files touched:**
- `server/lib/value-groups.js` (NEW — registries only; stub exports for all later-filled functions)
- `server/lib/value-ledger.js` (CONSUMERS gains 4th entry)
- `server/__tests__/single-writer-guard.test.js` (G-3/G-5/G-6/G-7/G-8 cases)
- `server/__tests__/helpers/single-home.js` (NEW — the durable-cure helper `assertConsumerScopeDerived`)
- `server/__tests__/ledger-metrics-parity.test.js` (C2.4 literal, title, failure message updated)
- `server/__tests__/chronology-ordering.test.js` (`FILE_DISPOSITIONS` entries for both new lib files)

**Layer:** Server registries, durable-cure structural guards (§9.7 HAND-SCOPED STRUCTURAL SCAN family)  
**Type:** Implementation + test (red-first)

**MANDATORY DURABLE-CURE ITEMS:**
- **D2 (§9.7, CATALOG ID `9.7` §6–7):** `assertConsumerScopeDerived()` helper — generalize the derived, fail-closed importer scan mandated for `value-coverage-probe.js` into one helper in `server/__tests__/helpers/single-home.js`, and point **all four** registrations at it (`value-coverage-probe`, `value-groups`, `value-ledger`, `value-summary`). Enumerate module's real importers by scanning `server/lib`, `server/routes`, `bin/` for the module's import specifier; **fail (throw, never `continue`)** on any importer absent from disposition map. This cures the 7-occurrence hand-registration class.

**Changes:**

*New registries module:*
- Create `server/lib/value-groups.js` with:
  - `const GROUP_RUN_STATES = ["not_attempted", ...GROUP_RUN_ROW_STATES]` (technical-plan §3.1)
  - `const GROUP_RUN_ROW_STATES = ["in_progress", "completed", "completed_zero_groups", "failed"]`
  - `const GROUP_REFINEMENT_STATES = ["pending", "refined", "zero_members", "failed"]` (technical-plan §3.2)
  - `const GROUP_REVIEW_STATES = ["proposed", "approved", "dismissed", "claimed"]` (§3.3, `claimed` reserved)
  - `const GROUP_MEMBER_AVAILABILITY = ["already_claimed", "available", "no_longer_in_pool"]` (§3.4, derived, never persisted)
  - `const GROUP_PROPOSE_OUTCOMES = ["started", "reused_unchanged", "already_running", "blocked_coverage_incomplete"]` (§3.5)
  - `const GROUP_GATE_STATES = ["ready", "blocked_coverage_incomplete"]` (§3.6)
  - `const UNGROUPED_REASONS = ["no_shared_signal", "not_selected_by_refinement"]` (§3.7, AC-3)
  - `const MAX_UNITS_PER_GROUPING_PROMPT` (technical-plan §5.3, sized against and citing 182-unit measured max, comment must name the number)
  - **Stub exports for all later functions** (implementation steps 5–8 fill bodies): `mechanicalPreGroup`, `groupingFacts`, `GROUPING_UNCOMPARED_FIELD_GUARANTORS`, `buildGroupingPrompt`, `parseGroupingOutput`, `refineBatch`, `rollupGroups`, `computeGroupingDigest`, `resolveMemberAvailability`, `runGroupingPass`, `reconcileInterruptedGroupRuns`
  - File header + `@author Son Nguyen <hoangson091104@gmail.com>` per project rule

*Registries with test assertions (red-first):*
- **M-10 [M]:** In `value-groups-mechanical.test.js` (new file, created later but references here for dependency): `deepEqual(GROUP_RUN_STATES.filter(s => !GROUP_RUN_ROW_STATES.includes(s)), ["not_attempted"])` — anchored exemption-set shape, red-proven by adding 6th value to `GROUP_RUN_STATES` without updating the row set
- **R-1 [R]:** `GROUP_REFINEMENT_STATES` sorted-equals `["failed","pending","refined","zero_members"]`
- Client mirrors (in client layer, Task 10): each registry gets an anchored exemption-set `deepEqual` against the reviewed list

*Consumer registration (durable cure):*
- `server/lib/value-ledger.js:70-74` — add `"server/lib/value-groups.js (derived-values reader: pre-grouping + member availability)"` as 4th entry
- **BO-3 (mandatory):** Widen the declaring-comment growth rule at `:64-69` in the **same commit**: change from "grow only when the new consumer reads `computePlanHealth`/`assembleValuePool`/`summarizeDeliveredValue` directly" to admit derived-value readers (e.g., "…or reads this module's derived values — e.g. `unitKey` — without re-implementing them"). Record that `value-groups.js` never calls `assembleValuePool` (it reads only `unitKey` + anchored text), so by the **existing registry's own stated rule** the new entry qualifies under the widened criterion. This is the write-once moment for this comment; leaving a contradictory comment with the entry is how the highest-severity gaps ship.

*Consumer-scope durable-cure helper (D2):*
- Create `server/__tests__/helpers/single-home.js` with `assertConsumerScopeDerived(modulePath, expectedDispositions)` function:
  - Scan `server/lib`, `server/routes`, `bin/` for the module's import specifier (e.g., `require("../lib/value-groups")`)
  - Compare against `expectedDispositions` (the map from routes/index/other consumers)
  - **Fail (throw) on any importer absent from the map** (never `continue` — fail-closed miss branch)
  - Return or assert; callers invoke it for all four registration points
- **Reuse this for all four:** update `single-writer-guard.test.js` to call it instead of inline scans for `value-coverage-probe` (G-3), `value-groups` (G-3 as part of G-7), `value-ledger` (existing registrations), `value-summary` (existing registrations)

*Single-home assertions (technical-plan §6.2 extended to 4 registrations):*
- **G-3 [D]:** `value-coverage-probe.js` importer scope via `assertConsumerScopeDerived` (becomes the first caller)
- **G-5 [M]:** `assertSingleHome("../lib/value-ledger", …)` (existing block ~`:462`) gains `"../lib/value-groups": { shared: ["unitKey"], absent: ["assembleValuePool","VALUE_SOURCES","ATTRIBUTION_TIERS","BACKFILL_LOOKBACK_DAYS","CONSUMERS","rowToUnit","computePlanHealth","summarizeDeliveredValue","MUTABLE_VALUE_SOURCES"] }` — the **executable** proof that `value-groups` never calls `assembleValuePool` (DEC-S3-10)
- **G-6 [M]:** `assertSingleHome("../lib/value-summary", …)` (existing block ~`:413`) gains `"../lib/value-groups": { shared: ["unitFacts","summaryModel"], absent: ["buildPrompt","parseOutput","SUMMARY_STAGES","MAX_UNITS_PER_PROMPT","ALTITUDE_STATES","compareUnitInputs","ALTITUDE_FRESHNESS","UNCOMPARED_FIELD_GUARANTORS","enrichPoolAltitudes"] }`
- **G-7 [M]:** New `assertSingleHome("../lib/value-groups", …)` with **two** consumer entries:
  - `"../routes/project-plans": { shared: [every route-facing export per technical-plan §9], absent: [...] }`
  - `"../index": { shared: ["reconcileInterruptedGroupRuns"], absent: [...everything else] }` — missing the boot-hook consumer is exactly §9.7's under-registration failure
- **G-8 [R]:** New writer guards for `insertValueGroup*` / `updateValueGroupRunState` / member inserts, matching the `requestValueCoverage` shape (`:346-385`)

*Ledger metrics parity (BO-4 correction):*
- **C2.4 [M]:** Update `server/__tests__/ledger-metrics-parity.test.js:282` literal to 4-entry set:
  ```js
  [
    "server/routes/project-plans.js",
    "bin/ccam.js (cmdLedger)",
    "server/lib/value-summary-tick.js",
    "server/lib/value-groups.js (derived-values reader: pre-grouping + member availability)",
  ]
  ```
  Update test **title** (currently says "exactly the route, the CLI, and the tick") and **failure message** (currently says 4th consumer "must be deliberate reviewed addition") to reflect the widened growth rule (**BO-3**). Without this, C2.4 **goes red by construction** when `CONSUMERS` gains the 4th entry — a mid-build red with no planned case is exactly how guards get ad-hoc "fixed."

*Chronology ordering:*
- **R** `FILE_DISPOSITIONS` in `chronology-ordering.test.js` must gain explicit entries for `value-groups.js` and `value-coverage-probe.js` or the fail-closed check at `:243` throws (the registry already fails closed on both missing and stale branches)

**Done check:**
```bash
# All in one commit with the consumer entry
git log -1 --pretty=format:"%B" | grep -q "Registries"

# Anchored exemption sets green (red-proven in later steps but exist now)
node --test server/__tests__/single-writer-guard.test.js  # G-3/G-5/G-6/G-7/G-8
node --test server/__tests__/ledger-metrics-parity.test.js  # C2.4 updated
node --test server/__tests__/chronology-ordering.test.js  # both new files disposition entries

# Helper exists and is used
grep -c "assertConsumerScopeDerived" server/__tests__/helpers/single-home.js  # >= 1
grep -c "assertConsumerScopeDerived" server/__tests__/single-writer-guard.test.js  # >= 4 (one per registration)
```

**Red-first procedure:**
1. Add a 6th value to `GROUP_RUN_STATES` without updating `GROUP_RUN_ROW_STATES` → M-10 breaks at point of growth (not generic) → revert
2. Add a stray `require("../lib/value-groups")` in an undisposed file → `assertConsumerScopeDerived` throws naming the file → revert
3. Delete one `ko` key from client locale → C-8 fails naming that key (performed in Task 10)

---

## 4. Mechanical pre-grouping stage (red-first)

**Files touched:**
- `server/lib/value-groups.js` (fill `mechanicalPreGroup`, `groupingFacts` function bodies)
- `server/__tests__/value-groups-mechanical.test.js` (NEW — M-1…M-9 assertions)

**Layer:** Server library, pure function (zero spawn, zero DB)  
**Type:** Implementation + test (red-first)

**Changes:**
- Implement `mechanicalPreGroup(units) -> { clusters, ungrouped, signalAudit }` (technical-plan §5.1)
  - Three signals: slug (initiative labels + commit-subject substring match), time (local calendar day), surface (label/path substring proxy, v1 conservative scope)
  - Over-generation by design: a unit satisfying multiple signals appears in multiple clusters
  - Deterministic stable hash: `clusterId = hash(signal + sorted memberUnitKeys)`
  - No DB, no spawn, no async
- Implement `groupingFacts(unit, cachedAltitudeText) -> { unitKey, value_source, label, stage, seen_at, project_level, stakeholder_level }` (technical-plan §5.2 / §5.4)
  - Built **on top of** `value-summary.js`'s exported `unitFacts(unit)` — extended with `seen_at` (time signal), cached altitude text, and `unitKey`
  - Never string-concatenate `unitKey` — use existing `valueLedger.unitKey()` formatter (§9.1 rule)

**Test assertions (new file `value-groups-mechanical.test.js`):**
- **M-1 [R]:** Slug signal: exactly one `signal:"slug"` cluster whose sorted `memberUnitKeys` **equals** expected [initiativeKey, matchingCommitKey].sort(); unrelated commit absent
- **M-2 [R]:** Time signal: same-`localDayLabel()` pair is exactly the `signal:"time"` cluster membership (import `localDayLabel` from `focus-summary.js`, never hand-recompute); day-apart unit absent
- **M-3 [R]:** Units with no `seen_at` are ineligible for time signal **and counted**: `signalAudit.time.units_without_timestamp` equals exact fixture count, not `> 0`; **WATCH-S3-C:** comment must cite measured distribution from live pool (~102 units today, 182 recorded)
- **M-4 [R]:** Shared-surface signal (label/path substring proxy): exact membership as M-1
- **M-5 [M]:** **Over-generation is by design**: a unit satisfying both slug and time appears in **both** clusters' `memberUnitKeys`, never deduped. `risk.md` ranks this the guard most likely to ship vacuous.
- **M-6 [R]:** Determinism: two calls with second shuffled input array, `deepEqual` on full sorted-by-`clusterId` output
- **M-7 [R]:** `clusterId` byte-identical across both calls (stable hash, not insertion order)
- **M-8 [N]:** File-level invariant in top comment: `mechanicalPreGroup(units)` takes **zero** spawn/db mocks — reviewer-checked at diff time
- **M-9 [R]:** Completeness: isolated unit lands in `ungrouped` with `reason:"no_shared_signal"`; every input key appears in at least one cluster **or** `ungrouped`
- **M-10 [M]:** Anchored exemption-set already in registry assertions (Task 3)

**Done check:**
```bash
node --test server/__tests__/value-groups-mechanical.test.js  # M-1…M-9 green
grep -c "dbModule" server/lib/value-groups.js | grep -q "^0"  # zero DB references in pure module
grep -c "await" server/lib/value-groups.js | grep -q "^0"  # zero async
```

**Red-first procedure:**
1. Short-circuit slug matcher → **M-1**'s specific cluster/membership goes missing → restore byte-identical → green
2. Remove time-signal logic → **M-2** fails specifically → restore
3. Remove over-generation deduplication (if present) → **M-5** unit appears only once → restore (M-5 is the guard `risk.md` ranks most likely to ship vacuous)
4. Each independently re-run by other author

---

## 5. Digest + cache + field-parity guard (red-first)

**Files touched:**
- `server/lib/value-groups.js` (fill `computeGroupingDigest`, `GROUPING_UNCOMPARED_FIELD_GUARANTORS`, `buildGroupingPrompt` input validation)
- `server/__tests__/value-groups-refinement.test.js` (NEW — R-9 assertion)

**Layer:** Server library, cost-control hashing  
**Type:** Implementation + test (red-first)

**Changes:**
- Implement `computeGroupingDigest(units, clusters) -> string` (technical-plan §5.4)
  - Reuse Slice 1's shape; do not invent second digest formula (§9.1 rogue re-derivation)
  - Input: sorted `groupingFacts` list + sorted cluster membership
  - Stable hash, byte-identical across runs on the same pool + clusters
- Implement `GROUPING_UNCOMPARED_FIELD_GUARANTORS = { /* exempted keys with stated reasons */ }` registry
  - Any field in `groupingFacts` output **not** included in the digest hash must be listed with a stated reason (comments, not prose narrative)
- Implement structural scan in `buildGroupingPrompt` to verify it reads **only** `groupingFacts` output, never raw unit fields (enforce by construction: accept only the `groupingFacts` object, never the unit itself)

**Test assertions (in `value-groups-refinement.test.js`):**
- **R-9 [M]:** `GROUPING_UNCOMPARED_FIELD_GUARANTORS` key-walk:
  - Walk **every** key of `groupingFacts(testUnit)` 
  - Mutate each key, assert `computeGroupingDigest` changes **or** the key is listed in guarantors with a stated reason
  - Plus a structural scan that `buildGroupingPrompt` reads **only** `groupingFacts` fields (never raw unit)
  - This is the 2nd exposure of §9.1 DERIVED-DUAL-VIEW on this codebase; §9.1's shipped 2026-08-05 claiming the gap was "physically impossible" behind a JSDoc — `unitFacts` now has **two** downstream comparators
  - `risk.md`: this assertion is most likely to be quietly narrowed

**Done check:**
```bash
node --test server/__tests__/value-groups-refinement.test.js  # R-9 green
# Red-proof: add a field to groupingFacts without listing it in guarantors
# → R-9 fails on that key → either include in digest or register with reason
```

---

## 6. Refinement + rollup + orchestration + boot hook (red-first)

**Files touched:**
- `server/lib/value-groups.js` (fill `buildGroupingPrompt`, `parseGroupingOutput`, `refineBatch`, `rollupGroups`, `runGroupingPass`, `reconcileInterruptedGroupRuns`)
- `server/index.js` (boot-hook call to `reconcileInterruptedGroupRuns`)
- `server/__tests__/value-groups-refinement.test.js` (NEW — R-2…R-8, R-10…R-13, D-1…D-4)
- `server/__tests__/value-groups-interrupted-boot.test.js` (NEW — E-5 assertions)

**Layer:** Server library + boot, LLM-driven refinement and state management  
**Type:** Implementation + test (red-first)

**Changes:**

*LLM-driven functions (technical-plan §5.2–5.3):*
- Implement `buildGroupingPrompt(clusters, factsByKey) -> string` — numbered structured fact lines, never prose paragraph (mirror `value-summary.js` idiom); **read-only** from `groupingFacts`
- Implement `parseGroupingOutput(stdout, clusters) -> [{ name, summary, rationale, memberUnitKeys }] | null` — strict whitelist: only these four fields; discard any other (including `status`/`review_status`/`claimed`); drop member keys not in input cluster set; return `null` sentinel for malformed/echoed/parsed-unusable
- Implement `refineBatch(clusters, factsByKey, { model }) -> { name, summary_sentence, rationale, memberUnitKeys }[]` or `null`; one sonnet call per batch via `runClaudePromptJson` from `./focus-inference` (same import `value-summary.js:64` uses); model `summaryModel("grouping")`
- Implement `rollupGroups(leafGroups, { model }) -> [{ merged groups }]` — when `batch_count > 1`, one additional call over `(name, summary, member_count)` of leaf groups; merge by reference; only final post-rollup groups persist; no intermediate rows, no `parent_group_id` (O-6)
- Implement `runGroupingPass(dbModule, projectId, units, factsByKey) -> { run row, group rows, member rows }`
  - **Sole writer** of all three tables
  - Write run row `in_progress` before any spawn
  - Groups + members via batched `refineBatch` calls; single cluster never split across batches (becomes its own batch if oversized)
  - **Disclose** failed batches: persist as `refinement_state='failed'` with members, no LLM text; run is `completed` (not `failed`) if other batches succeeded
  - Write terminal state + error_reason
  - Any throw → `state='failed'` with `error_reason`
- Implement `reconcileInterruptedGroupRuns(dbModule)` — flip surviving `in_progress` rows to `failed` / `error_reason='interrupted_restart'`; called at boot (§5.6, technical-plan)

*Boot integration:*
- `server/index.js:465-470` — add `reconcileInterruptedGroupRuns(dbModule)` in same try/catch posture as `startValueSummaryTick` (fail-safe, non-blocking, per repo `CLAUDE.md`)

**Test assertions (in `value-groups-refinement.test.js`):**
- **R-1 [R]:** Anchored exemption-set (created in Task 3, green here)
- **R-2 [R]:** `pending`: mechanical cluster pre-refinement has `refinement_state === "pending"` and `name`/`summary_sentence`/`rationale` **strictly `null`** (not `""`, not `undefined`)
- **R-3 [R]:** `refined`: stubbed sonnet payload persists with all four fields matching stub's literal strings **field-by-field** (AC-2's bar)
- **R-4 [R]:** `zero_members`: stub whose every `memberUnitKeys` entry is outside cluster set → keys dropped, row lands `zero_members`, not `refined` with empty member list
- **R-5 [M]:** `failed`-batch **disclosure**: stubbed reject → group row persists, `refinement_state === "failed"`, all text fields `null`, `value_group_members` equals mechanical cluster membership byte-for-byte. `risk.md` §4.3: guard checking only "response looks like proposal" would pass while partial write promotes group it never earned.
- **R-6 [R]:** Single batch's failure doesn't fail run: two-batch fixture, one failing → `run.state === "completed"`, not `"failed"` (run-level `failed` reserved for passes producing no groups)
- **R-7 [M]:** **Partition biconditional across all four refinement states**: seed one row per state, one query — `name`/`summary_sentence`/`rationale` are non-NULL **if and only if** `refinement_state === "refined"` — the executable form of "client must never infer state from NULL-ness"
- **R-8 [R]:** `parseGroupingOutput` returns `null` sentinel for: malformed JSON, echoed prompt, missing required field (the `status:"claimed"` adversarial case lives at N-4, not here)
- **R-10 [R]:** `reconcileInterruptedGroupRuns`: surviving `in_progress` row → `state === "failed"`, `error_reason === "interrupted_restart"`, `completed_at` non-null
- **R-11 [R]:** Terminal rows (`completed`/`completed_zero_groups`/`failed` with other `error_reason` like `llm_error`) left byte-identical — doesn't overwrite more-specific existing failure
- **R-12 [R]:** 3 `in_progress` rows across 2 projects all flip in one call
- **R-13 [R]:** Boot-wiring source scan: `server/index.js` contains `reconcileInterruptedGroupRuns(` inside try/catch in same region as `startValueSummaryTick` (`:465-470`), source-text scan (not runtime require)

**Availability resolution (in same file):**
- Implement `resolveMemberAvailability(memberRows, liveUnits, claims) -> { byGroupId, countsByGroupId }` (technical-plan §5.5)
  - Pure function, no DB, no persistence; route passes live `assembleValuePool` units + `listClaimsForProject` rows
  - Precedence: claimed (wins), available (in live pool), no_longer_in_pool (elsewhere)
  - Return by-group and counts

**Availability test assertions (D-1…D-4 in `value-groups-refinement.test.js`):**
- **D-1 [R]:** Anchored exemption-set `["already_claimed","available","no_longer_in_pool"]`
- **D-2 [R]:** Precedence: member in both claims and live pool is `already_claimed`, never `available`; unclaimed live → `available`; neither → `no_longer_in_pool`
- **D-3 [R]:** (implicit in D-4)
- **D-4 [M]:** **Partition**: across multi-group fixture, each group's three counts sum to its member-row count **and** a `Set` of counted keys has size equal to member-row count (no double-counting). Both halves are mandatory: sum alone would pass while a key appears twice (the exact gap that shipped).

**Boot-hook test (new file `value-groups-interrupted-boot.test.js`):**
- Own file, own child process — crashed run must exist **before** requiring index
- **E-5.1 [M]:** Immediately after boot, read crafted `in_progress` row: `state === "failed"`, `error_reason === "interrupted_restart"`, `completed_at` non-null (not via later `GET` — timing is the point)
- **E-5.2 [R]:** `GET /groups` → `run.state === "failed"` reaches client (never stuck spinner) with no groups
- **E-5.3 [R]:** `POST /groups/propose` for same project → **202 `started`** with distinct `run.id`, reaches `completed` normally
- **E-5.4 [N]:** Second boot is inert (re-require): now-`completed` run is not flipped to `failed`

**Done check:**
```bash
node --test server/__tests__/value-groups-refinement.test.js  # R-2…R-13 green
node --test server/__tests__/value-groups-interrupted-boot.test.js  # E-5 green
grep -q "reconcileInterruptedGroupRuns(dbModule)" server/index.js  # boot hook present
```

**Red-first procedures:**
- Drop a field before insert → **R-3** fails field-by-field
- Make failed batch drop its group row instead of persisting → **R-5** fails (disclosure)
- Populate `name` on a `failed` row → **R-7** biconditional fails from inverse direction
- Remove `reconcileInterruptedGroupRuns` call → **R-13** fails
- Flip precedence (live beats claims) → **D-2** fails naming `already_claimed`
- Double-count a key → **D-4**'s `Set`-size assertion fails while sum alone would pass

---

## 7. Routes + gate + negative proof (red-first)

**Files touched:**
- `server/routes/project-plans.js` (4 new handlers: POST propose, GET, POST approve, POST dismiss)
- `server/__tests__/value-groups-api.test.js` (NEW — 5 describe blocks, ~40 test cases, TT-a…TT-i + TT-read, N-1…N-4, E-1…E-4, E-6, RT-1…RT-3)

**Layer:** Server routes, HTTP contract, negative proof  
**Type:** Implementation + test (red-first)

**Changes:**

*Routes (technical-plan §7):*
- `POST /api/project-plans/groups/propose {project_id}` 
  - Validate `project_id` (400 INVALID_INPUT)
  - `buildProbeCoverage(dbModule, projectId)` — if `!complete` → 409 `{ outcome: "blocked_coverage_incomplete", gate, coverage, error }` (full snapshot for client ETA reuse, AC-6/AC-7)
  - If `in_progress` → 200 `already_running` with that run
  - Assemble pool + cached altitude text, `mechanicalPreGroup`, compute digest; digest match on latest completed run → 200 `reused_unchanged` (no spawn)
  - Otherwise `runGroupingPass(...)` → 202 `started`
  - Response: `{ outcome, run, groups (if returned), gate, coverage }`
- `GET /api/project-plans/groups?project_id=` 
  - Return `{ run, groups, gate, coverage }` where `run.state ∈ GROUP_RUN_STATES` (`not_attempted` when no row exists)
  - Each group carries `refinement_state`, `review_status`, `name`, `summary_sentence`, `rationale`, `members: [{ unitKey, availability }]`, `member_availability_counts` (computed server-side, §3.4)
  - Ordering: `created_at ASC, id ASC` (§9.2)
- `POST /api/project-plans/groups/:id/approve` and `POST /api/project-plans/groups/:id/dismiss` (two named routes, not one `/review {status}` — DEC-S3-9)
  - Pure `review_status` + `reviewed_at` update via `setValueGroupReviewStatus`
  - No member mutation, no plan item touch, no claim

*OpenAPI:*
- `server/openapi.js` / `server/openapi-extra/plans.js` — document 4 new endpoints (repo convention)

**Test file: `value-groups-api.test.js`** (reuse harness from `project-plans-api.test.js:1-63`, `makeProject`, `fetch`/`post` helpers; seed with `seedProjectWithDetourPool` + `upsertValueUnitSummary` loop for `coverage.complete === true` with zero altitude spawns; `__injectSpawnForTest` counter; 4 independent `describe` blocks, sequential tests within each, no concurrency)

**Block 1: §9.8 truth table (the highest-priority test)** `[M]`
- **ONE test, ONE 9-row table** (not 9 isolated branches) — per row assert: outcome, HTTP status, **exact spawn call count**
- Plus separate **TT-read** case

| # | Prior run state | `coverage.complete` | Expected outcome | HTTP | Spawn count | Note |
|---|---|---|---|---|---|---|
| TT-a | none | true | `started` | 202 | 1 | baseline |
| TT-b | none | false | `blocked_coverage_incomplete` | 409 | 0 | gate rejects |
| TT-c | `failed` | true | `started` (**fresh**, not reused) | 202 | 1 | risk §4.1: don't resurrect failed |
| **TT-d** | `failed` | false | `blocked_coverage_incomplete` | 409 | 0 | **plan-mandated**: gate + failed history both true in two fields |
| TT-e | `completed` + digest match | true | `reused_unchanged` | 200 | 0 | cache hit |
| TT-f | `in_progress` | true | `already_running` | 200 | 0 | existing run |
| **TT-g** | `in_progress` AND digest matches | true | `already_running` | 200 | 0 | **risk**: step 3 beats step 4; running run not retriggered by matching digest |
| **TT-h** | `completed_zero_groups` + digest match | true | `reused_unchanged` | 200 | 0 | **risk**: the row that fell out of §6; likely conflated with "not attempted" |
| **TT-i** | `in_progress` | false | `blocked_coverage_incomplete` | 409 | 0 | **new**: gate beats `in_progress` ordering; gate at step 2, run check at step 3 |
| **TT-read** | (separate case) | `in_progress` + coverage regresses mid-flight | `GET /groups` returns `run.state === "in_progress"` AND `gate === "blocked_coverage_incomplete"` | 200 | N/A | two both-true facts in two fields |

**Block 2: Negative proof — proposals never actions** `[M]`, all 4 sub-checks red-proven
- **N-1 [M]:** Structural scan (write surface from real code, not memory): `dbModule.stmts.insertValueClaim` and `deleteValueClaim`. Scan `value-groups.js` + four route handlers (brace-walked as in G-2) for substrings — assert **zero** matches. Red-proof: inject real `insertValueClaim` call → scan fails → revert.
- **N-2 [M]:** Behavioral: seed existing `value_claims` row; run pipeline (`mechanicalPreGroup` → stubbed `refineBatch` → `runGroupingPass`); `SELECT COUNT(*) FROM value_claims` before/after — **equal**. Also assert `group_count > 0` so "nothing happened" can't pass vacuously. Red-proof: add `insertValueClaim` call → N-2 count changes → revert.
- **N-3 [M]:** Reserved-but-unreachable: zero code paths assign `'claimed'` to `review_status`. Scope by **file** (`value-groups.js` + four handlers) — `db.js`'s CHECK legitimately contains the string. Red-proof: add `review_status = 'claimed'` assignment → scan fails → revert.
- **N-4 [M]:** Adversarial LLM response, strict whitelist: feed `parseGroupingOutput` payload with legitimate fields **plus** `status: "claimed"` (second case: `review_status: "approved"`); assert parsed group's `review_status === "proposed"`. Then persist via `runGroupingPass` with same malicious stub, assert **actual DB row** reads `review_status === "proposed"`. Red-proof: make parser read `status` off raw payload → N-4 fails → revert.

**Block 3: Propose → refine → review lifecycle** (sequential, one seeded project)
- **E-1.1 [R]:** 6 detour units, one uncached → POST → **409** `{ outcome, gate }` both `blocked_coverage_incomplete`, `coverage` object carries full snapshot (AC-6/AC-7)
- **E-1.2 [R]:** Cache last unit → POST → **202** `started`
- **E-1.3 [R]:** Immediate second POST (spawn pending) → **200** `already_running`, same `run.id`, spawn counter unchanged
- **E-1.4 [M]:** Poll GET to `run.state === "completed"`: every group `refined` with all fields non-NULL; every `members[]` entry is `{unitKey, availability}` with `availability === "available"`; `member_availability_counts` sums to member count
- **E-2.1 [R]:** Approve one group, dismiss another → re-GET: exactly those two rows changed `review_status`+`reviewed_at`; every other group still `proposed` with `reviewed_at === null`; both POST response bodies contain only changed review fields
- **E-2.2 [R]:** Bookkeeping-only: `value_claims`, `project_plans`, `project_plan_items` row counts via direct `db.prepare(...)` before E-1.1 and after E-2.1 — **byte-identical**
- **E-3 [R]:** Digest reuse: third POST against unchanged pool → **200 `reused_unchanged`**, returns first run's groups, spawn counter still unchanged
- **E-4 [N]:** `POST /groups/:id/review` with any body → **404** (no generic body-supplied-status route)
- **RT-1 [R]:** Round-trip: stub with distinct greppable values; GET returns every field **field-by-field** not spot-check
- **RT-2 [R]:** Update → Get: capture RT-1, approve, re-GET, `deepEqual` except `review_status`/`reviewed_at` with explicit checks
- **RT-3 [R]:** No prompt-scaffolding leak: for every `refined` row, `name`/`summary_sentence`/`rationale` contain none of `"CLUSTER "`, `"[trunk_commit]"` etc. (production leak-check; unit test R-8 covers parser)

**Block 4: Hierarchical decomposition** (own project)
- **E-4.1 [R]:** Seed **45** pre-cached detour units (past single-prompt budget); inject spawn returning per-batch response + one rollup response
- **E-4.2 [R]:** After `completed`: `run.batch_count > 1`; spawn called **exactly `batch_count + 1`** times (each batch plus one rollup)
- **E-4.3 [R]:** No cluster split across batches — checked against fixture's known membership
- **E-4.4 [R]:** AC-3 accounting identity: `run.ungrouped_no_signal` and `run.ungrouped_not_selected` present as integers; sum plus every group's member count equals pool size

**Block 5: Read-time drift** (own project, carries R4 mandatory)
- **E-6.1 [R]:** 4 pre-cached units, propose+poll to `completed` with stub grouping all into one proposal
- **E-6.2 [R]:** Drift #1 before read: out-of-band `insertValueClaim` on member B; delete `detour_dispositions` row for member C
- **E-6.3 [R]:** GET → A `available`, B `already_claimed`, C `no_longer_in_pool`, D `available`; counts `{available:2, already_claimed:1, no_longer_in_pool:1}` sum to 4 (partition)
- **E-6.4 [M]:** **Drift #2 AFTER GET and BEFORE approve** — out-of-band claim on member D (R4's ruling: second drift after read preserves E-6.3 proof). This is the write-side half.
- **E-6.5 [M]:** **Approve under drift is pure bookkeeping**: POST approve returns 200, doesn't error, flips `review_status`, **doesn't drop drifted member** — immediately following GET still returns 4 rows with partition intact and D now `already_claimed`. This is what makes "approve is pure bookkeeping" true under drift — the only condition where it could fail. **BO-6 / WATCH-S3-F:** Behavior change (fresh snapshot on approve response) not built this round; recorded in `decisions.md`.

**Done check:**
```bash
node --test server/__tests__/value-groups-api.test.js  # all blocks green
node --test server/__tests__/value-groups-interrupted-boot.test.js  # boot hook tests green
grep -c "POST /api/project-plans/groups/propose" server/routes/project-plans.js  # >= 1
grep -c "GET /api/project-plans/groups" server/routes/project-plans.js  # >= 1
grep -c "POST /api/project-plans/groups.*approve" server/routes/project-plans.js  # >= 1
grep -c "POST /api/project-plans/groups.*dismiss" server/routes/project-plans.js  # >= 1
grep -c "/review" server/routes/project-plans.js  # must be 0 (no generic route)
```

**Red-first procedures:**
- Reorder gate before `in_progress` check → **TT-i** fails (409 expected, `already_running` returned) while branches stay green → restore
- Matching digest beats `in_progress` check → **TT-g** fails on spawn count → restore
- Four injections per Block 2 (each on its own re-run)
- Make approve prune drifted members → **E-6.5** fails on member count → restore

---

## 8. Client: API methods, registries, UI, entity-switch, StrictMode (red-first)

**Files touched:**
- `client/src/lib/api.ts` (add `groups`, `proposeGroups`, `approveGroup`, `dismissGroup` methods to `projectPlans` block)
- `client/src/components/PlanLedgerPanel.tsx` (UI rendering, entity-switch reset, StrictMode-safe effects)
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` (all four, same commit)
- `client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx` (NEW — C-1…C-8 assertions)
- `client/src/pages/__tests__/screens.snapshot.test.tsx` (snapshot review)

**Layer:** Client component and i18n  
**Type:** Implementation + test (red-first)

**Changes:**

*API methods:*
- Add to `api.ts:projectPlans` block (beside existing `coverage`, `:2797`), same `request<T>` idiom and error posture:
  - `groups(projectId): Promise<{ run, groups, gate, coverage }>`
  - `proposeGroups(projectId): Promise<{ outcome, run, groups?, gate?, coverage?, error? }>`
  - `approveGroup(projectId, groupId): Promise<{ review_status, reviewed_at }>`
  - `dismissGroup(projectId, groupId): Promise<{ review_status, reviewed_at }>`

*Client registries (mirrors with anchored exemption-set assertions):*
- File: `client/src/lib/registries.ts` or existing registry location (check project precedent)
  - `const GROUP_RUN_STATES = ["not_attempted", "in_progress", "completed", "completed_zero_groups", "failed"]` (anchored: `deepEqual(RUN_STATES.filter(...), ["not_attempted"])`)
  - `const GROUP_REFINEMENT_STATES = ["pending", "refined", "zero_members", "failed"]` (anchored set assertion)
  - `const GROUP_REVIEW_STATES = ["proposed", "approved", "dismissed", "claimed"]` (anchored set)
  - `const GROUP_MEMBER_AVAILABILITY = ["already_claimed", "available", "no_longer_in_pool"]` (anchored set)
  - `const GROUP_PROPOSE_OUTCOMES = ["started", "reused_unchanged", "already_running", "blocked_coverage_incomplete"]` (anchored)
  - `const GROUP_GATE_STATES = ["ready", "blocked_coverage_incomplete"]` (anchored)
  - Each with a hand-maintained `deepEqual` anchor — `assert.deepEqual(sorted, [reviewed list])` — so a 5th value breaks at point of growth

*i18n:*
- Add to all four `projectDetail.json` files (**same commit**) under `planLedger.*` namespace (already owns `altitudes`/`coverage` keys):
  - `planLedger.runState.*` for each `GROUP_RUN_STATES` value
  - `planLedger.refinementState.*` for each `GROUP_REFINEMENT_STATES` value
  - `planLedger.reviewStatus.*` for each `GROUP_REVIEW_STATES` value (including reserved `claimed`)
  - `planLedger.memberAvailability.*` for each `GROUP_MEMBER_AVAILABILITY` value
  - `planLedger.proposeOutcome.*` for each `GROUP_PROPOSE_OUTCOMES` value
  - `planLedger.gateState.*` for each `GROUP_GATE_STATES` value
  - `planLedger.autoGroupButton` (button label)
  - `planLedger.ungroupedUnitCount` (disclosure label)
  - (Additional keys per UX spec — no hard constraints other than completeness in all 4 locales)

*UI (technical-plan §8):*
- Auto-group button in pane (same as existing coverage header): **disabled while `!coverage.complete`**; reuses existing `handlePrioritizeNow` **and existing** `prioritize-now-button` selector (no second control, no duplicate handler, no duplicate keys per AC-7/PO §5)
- Proposal list: name, summary sentence, rationale, member count + `unitKey`s with per-member availability chip
- Run state + ungrouped-unit disclosure ("N units not yet grouped", AC-3) always visible
- Approve/Dismiss per group (two named buttons, not generic review action)
- **NO "Approve & claim", NO claim-target picker, NO plan-item create/edit affordance** (PO §7/§8 fence)

*Entity-switch reset (PM-5a, SF-8 shape — already failed once):*
- New state for groups/run (`[groups, setGroups]`, `[runState, setRunState]`, any in-flight request)
- **Reset on `projectId` change** structurally, same `useEffect` shape as existing `SF-8` fix (`PlanLedgerPanel.tsx:748-775`)
- **Test C-5/C-6** prove this doesn't stay leaky after the fix looks complete

*StrictMode safety (PM-5b, BL-2 shape — shipped invisible before):*
- Any new effect/ref that tears down in cleanup must **re-arm in setup** whatever it tears down
- At least one new Slice 3 client test renders under `<StrictMode>` and actually renders text (not blank) after setup→cleanup→setup double-invoke
- **Test C-7** catches the BL-2 pattern

**Test assertions (new file `PlanLedgerPanel.groups.test.tsx`)**
- Mirror `PlanLedgerPanel.test.tsx`'s `vi.mock("../../lib/api", …)` shape, adding new mock methods
- **C-1 [M]:** No client-side re-derivation: mock a literal `GET /groups` fixture (one group, 4 members, availabilities `available`/`already_claimed`/`no_longer_in_pool`/`available`) whose `member_availability_counts` deliberately wouldn't match naive `members.filter(...).length`; assert rendered tally equals **server's** numbers; assert three availability states render **visibly distinct** (three states, three renderings)
- **C-2 [R]:** AC-7: Auto-group action disabled while `!coverage.complete`, enables on update `false → true`; **exactly one** element matching `prioritize-now-button` selector (no second control)
- **C-3 [R]:** Approve/Dismiss call methods exactly once; no "Approve & claim" copy, no claim picker, no plan-item affordance (explicit absence check, not happy-path-only)
- **C-4 [R]:** No raw i18n key leaks: render per-state; assert no text matches `/^projectDetail\./` (and reuse existing `/planLedger\./` DOM sweep)
- **C-5 [R]:** PM-5a entity-switch reset: mock keyed per project; render proj-A, rerender proj-B; assert A's name gone, B's present
- **C-6 [R]:** PM-5a in-flight: deferred promise for proj-A, switch to proj-B before resolve, resolve after switch; assert A's stale data never renders under B
- **C-7 [R]:** PM-5b StrictMode: at least one new effect/ref renders correctly under `<StrictMode>` — group list actually renders (not blank) after double-invoke
- **C-8 [R]:** Locale mirror registry: each of 6 registries carries anchored `deepEqual` against reviewed list; **every** wire value has translation key in **each** of `en`/`ko`/`vi`/`zh` `projectDetail.json` — not just `en`. A missing `ko`/`vi`/`zh` key is the N2 fail-open class. Red-proof: delete one `ko` key → C-8 fails naming that key and locale.

**Snapshot test:**
- `client/src/pages/__tests__/screens.snapshot.test.tsx` — review diff, regenerate **deliberately** with `cd client && npx vitest run -u`, never blind-update (repo `CLAUDE.md`)

**Done check:**
```bash
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.groups.test.tsx  # C-1…C-8 green
npm run test:client  # >= 822 tests green (baseline 822 pre-Slice-3)
cd client && npx vitest run  # snapshot baselines reviewed and regenerated
grep -c "prioritize-now-button" client/src/components/PlanLedgerPanel.tsx  # exactly 1 (shared control)
```

**Red-first procedures:**
- Implement group list keyed to `useRef` without `[projectId]` reset → C-5/C-6 fail specifically (other tests pass) → restore (mirrors Slice 2 SF-8 failure shape)
- Implement `useRef(true)` + cleanup-only `useEffect` → renders blank under `<StrictMode>`, green outside → restore
- Delete one `ko` key → C-8 fails naming key and locale → restore

---

## 9. Schema/test file amendments + durable-cure helper integration

**Files touched:**
- `server/__tests__/single-writer-guard.test.js` (integrate `assertConsumerScopeDerived` calls)
- `server/__tests__/helpers/single-home.js` (helper implementation, created in Task 3)

**Layer:** Test infrastructure  
**Type:** Integration

**Changes:**
- Update all four registration points in `single-writer-guard.test.js` to call `assertConsumerScopeDerived` instead of inline scope scans (or alongside them for transition):
  - `value-coverage-probe` (G-3)
  - `value-groups` (G-7)
  - `value-ledger` (existing, expand to use helper)
  - `value-summary` (existing, expand to use helper)
- Ensure helper is invoked exactly 4 times with expected disposition maps

**Done check:**
```bash
grep -c "assertConsumerScopeDerived" server/__tests__/single-writer-guard.test.js  # >= 4
node --test server/__tests__/single-writer-guard.test.js  # all registration tests green
```

---

## 10. Docs + audits + flag-back corrections

**Files touched:**
- `README.md`, `ARCHITECTURE.md`, `SETUP.md` (apply `update-project-docs` skill)
- `PROJECT-CONTEXT.md` (SF-4 build-outcome note)
- `technical-plan.md` (BO-2 corrections: add T7-successor table to §6.1, update DoD line; BO-4 correction: add `ledger-metrics-parity.test.js` to §9 change-set table)
- `qa/change-brief.md` (BO-1 correction: fix the row claiming T7 `:988-998` survives)
- `decisions.md` (BO-6: open `WATCH-S3-F` for approve-under-drift behavior change)

**Layer:** Documentation  
**Type:** Docs + metadata

**Changes:**

*Documentation updates (applied unprompted, per repo `CLAUDE.md`):*
- README: add the 4 new `/groups` endpoints
- ARCHITECTURE: add `value_groups.js` module description, three new tables
- SETUP: mention `GROUP_*` environment variables or any new config (if any)

*Flag-back corrections (binding obligations):*
- **BO-1:** Correct `qa/change-brief.md`'s row claiming ":988-998 survives" — it is factually wrong; T7 deleted in full (performed in Task 2, documented here)
- **BO-2:** Add the five-claim successor table to `technical-plan.md` §6.1 with the exact table from test-plan R2; change DoD line from "*T7 deleted*" to "*every T7 claim has a named successor, each observed red*"
- **BO-3:** Already applied in Task 3 (widened `CONSUMERS` growth rule comment; carried into §9.7 fixes)
- **BO-4:** Correct `technical-plan.md` §9's "Edited — tests" table to include `server/__tests__/ledger-metrics-parity.test.js` (one-line addendum; §9 is the implementer's working reference)
- **BO-5:** Already documented in `value-coverage-probe.js` module header (Task 2)
- **BO-6:** Open `WATCH-S3-F` in `decisions.md`: "*`POST /groups/:id/approve` performs no freshness check; response does not carry recomputed `member_availability_counts`/`members` snapshot. Fires-on: Slice 4 claim build or observed approve-against-stale-render. Lands-in: `server/routes/project-plans.js` approve handler + `value-groups-api.test.js`. Distinct from `WATCH-S3-A` (Slice 4 claim route).*" Behavior change is not built this round (wire-contract change beyond AC-5 scope); `E-6.4/E-6.5` cover correctness.
- **BO-7:** Record in decisions.md or handle per prior slice: OpenAPI fragment for 4 new routes. If team declines (as Slice 1 did for `/altitudes/seen`), record decision row. Documentation-drift risk only; do not let it survive as prose.

*PROJECT-CONTEXT.md:*
- Add SF-4 build-outcome note under §7 DISPOSITION: "Slice 3 (2026-08-06-auto-group-proposal): SF-4 extraction closed; T7 deleted and replaced by 5 successors (P-1…P-8, G-1…G-4); `value-coverage-probe.js` new file; PM-2 mandated. Defect-catalog ids: §9.1, §9.3, §9.7, §9.8."

**File-header audit:**
```bash
bash .claude/skills/file-headers/scripts/check-headers.sh  # must exit 0
```

**Done check:**
```bash
# Corrections present
grep -c "T7-C1\|T7-C2\|T7-C3\|T7-C4\|T7-C5" technical-plan.md  # >= 5
grep "ledger-metrics-parity.test.js" technical-plan.md  # >= 1 hit in §9 table
grep "WATCH-S3-F" decisions.md  # >= 1

# Header audit
bash .claude/skills/file-headers/scripts/check-headers.sh  # exit 0

# File completeness — suite counts
npm run test:server  # >= 1787 tests, 0 fail/skip/todo
npm run test:client  # >= 822 tests, 0 fail/skip
```

---

## 11. Full verification + red-proof re-run

**Type:** Verification (no new code, existing tasks re-run independently)

**Done check — comprehensive:**

*Suites:*
```bash
npm run test:server  # must be >= 1787, 0 fail/skip/todo
npm run test:client  # must be >= 822, 0 fail
node --test server/__tests__/value-coverage-parity.test.js  # GREEN, UNMODIFIED
bash .claude/skills/file-headers/scripts/check-headers.sh  # exit 0
```

*Red proofs independently re-run (§9.3 AGENT-SELF-REPORTED-RED):*
- T7 deletion: inject 4th hand-copy, watch G-2 fail, restore
- T7-C3/C5: delete `draining:`, watch P-6/P-7 fail, restore; add 6th key, watch P-7 fail, restore — **each by different person**
- M-5 (over-generation guard): dedupe the shared unit, watch it disappear from one cluster, restore
- R-7 (partition biconditional): populate `name` on `failed` row, watch inverse fail, restore
- R-5 (failed-batch disclosure): drop group row on batch failure, watch R-5 fail, restore
- E-6.5 (approve under drift): prune drifted member, watch count fail, restore
- N-1…N-4 (negative proof): four injections, each independently re-run, each fails the specific named assertion, each restored

*Durable-cure specific:*
- D2 (`assertConsumerScopeDerived`): inject undisposed importer, watch helper throw (not continue), restore

*Vacuity sweep:*
```bash
grep -rn "assert.ok(true" server/__tests__/value-groups*.test.js server/__tests__/value-coverage-probe.test.js
# must return 0

grep -rn "|| true" server/__tests__/value-groups*.test.js server/__tests__/value-coverage-probe.test.js  
# must return 0

# Manual grep-invisible shapes in new/edited files:
# - typeof checks with no assertion
# - bare Array.isArray( with no comparison
# - valueless assert.ok(
# - empty => {} blocks
```

*Canaries:*
```bash
# T7 completely gone
grep "T7 (SF-4)" server/__tests__/project-plans-api.test.js  # must return 0

# T3/T4/T6 byte-identical
git diff master -- server/__tests__/project-plans-api.test.js | grep -E "^@@.*T3|^@@.*T4|^@@.*T6"
# must show zero changes in those test regions

# No route-parity guard added
grep -n "deepEqual.*postCoverage.*getCoverage\|deepEqual.*Coverage.*POST\|deepEqual.*Coverage.*GET" server/__tests__/
# must return 0
```

---

## Summary of tasks

**Total: 11 ordered steps**

1. **Schema + prepared statements** — 3 new tables, 12 statements, S-1…S-4 red-first
2. **SF-4 extraction + T7 deletion + 5 successors** — ONE COMMIT: P-1…P-8, G-1/G-2/G-4, T7 full delete
3. **Registries + CONSUMERS + durable-cure helper (D2)** — ONE COMMIT: M-10/R-1, C2.4, G-3/G-5/G-6/G-7/G-8, `assertConsumerScopeDerived` helper
4. **Mechanical pre-grouping** — M-1…M-9 red-first, pure functions
5. **Digest + cache + field-parity** — R-9 red-first, two comparators on `unitFacts` now
6. **Refinement + rollup + orchestration + boot hook** — R-2…R-13, D-1…D-4, E-5, stubbed spawn
7. **Routes + gate + negative proof** — 4 handlers, TT-a…TT-i + TT-read (9-row truth table), N-1…N-4 (4-check negative proof), E-1…E-6, RT-1…RT-3
8. **Client: API + registries + UI + entity-switch + StrictMode** — C-1…C-8 red-first, snapshot review
9. **Schema/test amendments + durable-cure integration** — helper wiring
10. **Docs + audits + flag-backs** — BO-1/BO-2/BO-4/BO-6/BO-7, header audit
11. **Full verification + red-proof re-run** — comprehensive suite pass, all reds independently re-run by different person

**Durable-cure tasks (MANDATORY):**
- **D2 (§9.7 HAND-SCOPED STRUCTURAL SCAN, CATALOG ID `9.7`)** — `assertConsumerScopeDerived()` helper (Task 3) — generalizes the derived, fail-closed importer scan mandated for `value-coverage-probe.js` into one reusable helper; points all four registrations (`value-coverage-probe`, `value-groups`, `value-ledger`, `value-summary`) at it; cures 7-occurrence hand-registration class this project has recorded.
- **SF-4 extraction (§6 PM-2-mandated)** — Task 2 — `buildProbeCoverage` extracted as single definition, called exactly 3 times (no 4th hand-copy ever built); T7 deleted and replaced with 5 claim-by-claim successors (not test-by-test); single-call-site guard is fail-closed structural scan, not vacuous route-parity comparison.

**Critical corrections applied (BO-1/BO-2/BO-4):**
- T7 is deleted in full (zero lines survive) — not the stale claim that `:988-998` survives
- T7's 5 claims each have named successor tests applied as build steps
- `ledger-metrics-parity.test.js` C2.4 is explicitly updated and marked as Task 3

**Sequencing notes:**
- All tasks are **sequential** — one implementer, no parallelization
- Tasks 2 and 3 are **one commit each** (test + implementation together to avoid guard windows)
- Red-proof re-runs are **independent** — never by the same person as the injection author
- **No red anywhere else** — T7's deletion is the only expected red; any other red in either suite is a real regression
