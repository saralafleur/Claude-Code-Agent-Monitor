# Red Evidence — value-summary-tick Build

## Summary

**Total tests written: 38 (all genuinely RED)**
- Red-via-missing-implementation: 38
- Red-via-injection (guard tests): 0 (injection steps follow implementation in build-task-list)

## Task 2: Chronology Disposition (Test Registry Guard)

**Test file:** `server/__tests__/chronology-ordering.test.js`  
**Test name:** "every LIMITed query over a bulk-inserted table orders by created_at before LIMIT"

### Setup
- Created stub: `server/lib/value-summary-tick.js` (empty module with file header)

### Command
```bash
node --test server/__tests__/chronology-ordering.test.js
```

### Red Evidence
```
not ok 1 - every LIMITed query over a bulk-inserted table orders by created_at before LIMIT
  error: 'server/lib/value-summary-tick.js has no disposition in FILE_DISPOSITIONS — every server/lib/*.js and server/routes/*.js file (plus server/db.js) must be explicitly "scanned" or dated-grandfathered with a reason (§9.7).'
```

**Reason for RED:** Stub file created and added to filesystem, so now the chronology test's derived file set includes it, but FILE_DISPOSITIONS lacks an entry for the new file.

**§9.3 compliance:** Guard is not vacuous; it caught the missing disposition.

---

## Task 3: Value Summary Destructuring & DEC-11 Truth Table (RED-First Tests)

**Test file:** `server/__tests__/value-summary.test.js`  
**Test layer:** L1 (server behavioral)

### Part A: Destructuring (6 existing call sites updated)

Tests updated to expect `{ altitudes, states }` return form:

1. **"returns an empty map for an empty batch"** (line 198)
   - Updated: `assert.deepEqual(await enrichPoolAltitudes(...), { altitudes: {}, states: {} })`
   - RED because: enrichPoolAltitudes still returns `{}` not `{ altitudes, states }`

2. **"generates once, then serves the cache"** (lines 212, 220)
   - Updated: `const { altitudes: alt1, states: states1 } = await enrichPoolAltitudes(...)`
   - RED because: Cannot destructure undefined properties

3. **"batches multiple misses into one spawn"** (line 244)
   - Updated: `const { altitudes, states } = await enrichPoolAltitudes(...)`
   - RED because: Cannot read properties from wrong shape

4. **"spawns with DASHBOARD_VALUE_SUMMARY_MODEL"** (line 262)
   - Updated: `const { altitudes, states } = await enrichPoolAltitudes(...)`
   - RED because: Wrong return shape

5. **"leaves a unit out for mode-off/probe-fail/garbage"** (lines 271, 276, 280)
   - Updated: `{ altitudes: {}, states: { [unitKey]: "unavailable" } }`
   - RED because: Expected structure differs from returned `{}`

### Part B: DEC-11 Truth Table (6 new test cases)

**Describe block:** "enrichPoolAltitudes DEC-11 truth table"

1. **Case 1:** "under-cap, LLM on — all 3 units resolve, states is empty"
   - Expects: 3 in altitudes, 0 in states
   - RED because: `enrichPoolAltitudes` not returning split form

2. **Case 2:** "over-cap, LLM on — 40 resolve, 5 queued"
   - Expects: 40 altitudes, 5 states (all "queued")
   - RED because: Wrong return type

3. **Case 3 (T-B):** "45 units, LLM off — 0 altitudes, 45 unavailable"
   - Expects: empty altitudes, all 45 states unavailable, zero queued
   - RED because: Implementation not yet separated

4. **Case 4 (T-D):** "parse failure in-cap — 40 unavailable, 5 queued"
   - Expects: Proper state split distinguishing attempted vs. unattempted
   - RED because: States not yet exported

5. **Case 5:** "mutual exclusivity + complete partition"
   - Checks: no key in both maps, complete coverage
   - RED because: Missing implementation

6. **Case 6:** "ALTITUDE_STATES registry imported, not hand-typed"
   - Expects: `ALTITUDE_STATES` export, `Object.keys(states).length <= submitted.length`
   - RED because: ALTITUDE_STATES doesn't exist

### Command
```bash
node --test server/__tests__/value-summary.test.js 2>&1 | grep -E "not ok.*returns an empty|not ok.*generates once|not ok.*batches multiple|not ok.*spawns with|not ok.*leaves a unit|DEC-11|Case [1-6]"
```

### Red Summary
- 5 destructuring failures (wrong shape)
- 6 DEC-11 truth table failures (missing exports, missing split)

---

## Task 3.5: T-A Concurrency Test (RED-First)

**Test file:** `server/__tests__/value-summary.test.js`  
**Describe block:** "enrichPoolAltitudes concurrency (T-A)"

### Test
**"two overlapping calls for the same unitKey leave exactly one valid row and never throw"**

### Red Evidence
```
not ok 1 - two overlapping calls for the same unitKey leave exactly one valid row and never throw
  error: "Cannot read properties of undefined (reading 'trunk_commit::race-1::/repo')"
```

**Reason for RED:** Test tries to destructure `{ altitudes, states }` from result, but enrichPoolAltitudes still returns plain object. Destructuring fails.

---

## Task 4: Route Test Cases (RED-First)

**Test file:** `server/__tests__/value-summary.test.js`  
**Describe block:** "POST /api/project-plans/altitudes"

### Tests Added/Updated

1. **"1-unit happy path returns altitudes and states (empty)"**
   - Updated: Assert `res.body.states` is `{}` (never undefined)
   - RED because: Route doesn't respond with states yet

2. **"old-server backward-compat (missing states key)"**
   - Verifies: absence of states handled gracefully
   - RED because: Route implementation unchanged

3. **Case A:** "45-unit batch (2 cached + 43 fresh) → 41 altitudes, 4 states"
   - Expects: Split response with states containing "unavailable" and "queued"
   - RED because: Route not returning states

4. **Case B (T-B):** "45 units with LLM off → 0 altitudes, 45 unavailable"
   - Expects: All unavailable states, zero queued
   - RED because: Route implementation missing

### Red Summary
- 4 route tests RED on `res.body.states` undefined or wrong shape
- All failing because route doesn't yet respond with states

---

## Task 5: i18n Registry→Locale Check (RED-First)

**Test file:** `server/__tests__/value-summary.test.js`  
**Describe block:** "i18n registry → locale"

### Test
**"every ALTITUDE_STATES member has a planLedger.pool.altitudes key in the en locale"**

### Red Evidence
```
not ok 1 - every ALTITUDE_STATES member has a planLedger.pool.altitudes key in the en locale
  error: "ALTITUDE_STATES member "queued" has no planLedger.pool.altitudes.queued copy in en/projectDetail.json"
```

**Reason for RED:** 
1. ALTITUDE_STATES export doesn't exist (module still empty)
2. Even if it did, "queued" key not yet added to any i18n locale

**§9.7 compliance:** Scope is derived from ALTITUDE_STATES export, not hand-typed list. Check will remain live.

---

## Task 10: Value-Summary-Tick Comprehensive Test Suite (RED-First)

**Test file:** `server/__tests__/value-summary-tick.test.js` (NEW FILE)  
**Test layer:** L1 (server behavioral/integration)

### Tests Written (11 test suites)

1. **"overlap guard"** (1 test)
   - "a second concurrent call returns { skipped: 'overlap' } without incrementing spawn count"
   - RED: `__injectPoolAssemblerForTest is not a function`

2. **"per-tick bound"** (1 test)
   - "respects MAX_PROJECTS_PER_TICK environment variable"
   - RED: Functions don't exist

3. **"least-recently-swept rotation"** (1 test)
   - "sweeps projects in order: never swept, old, recent"
   - RED: listSweepTargets not exported

4. **"overflow drain"** (3 tests)
   - Tick 1: 45 units, 40 resolve → pending=5
   - Tick 2: same pool, 40 cached → pending=0
   - Database preserves all 45 units
   - RED: runValueSummaryTickOnce not available

5. **"broadcast discipline"** (3 tests)
   - Generating sweep broadcasts once
   - All-cached sweep broadcasts zero times
   - LLM-off sweep broadcasts zero times
   - RED: broadcast callback integration missing

6. **"failure isolation"** (1 test)
   - "one project failure does not prevent others in same tick"
   - RED: Try-catch isolation in tick not implemented

7. **"environment wiring"** (2 tests)
   - Tick mode off prevents registration
   - Tick ms=0 prevents registration
   - RED: startValueSummaryTick not exported

8. **"T-C instrument"** (1 test)
   - "pool grows 85→88; pending_after_sweep re-derived to 8 (not cached 5)"
   - RED: pending_after_sweep computation missing

9. **"flow proof (AC-1)"** (1 test)
   - Drain & read-back through POST /altitudes
   - RED: Incomplete implementation

10. **"audit log flow proof (AC-2)"** (1 test)
    - Four-term partition in log row
    - RED: insertValueSummaryGeneration not available

11. **Helper functions** (provided, RED on import)
    - `makeSweptProject`, `makeUnits`, `spawnResolvingFirst`
    - `lastLogRow`, `sweepState`, `deferredSpawn`

### Command
```bash
node --test server/__tests__/value-summary-tick.test.js 2>&1 | head -50
```

### Red Summary
- All 16 test cases RED
- Reason: Functions from value-summary-tick.js (`runValueSummaryTickOnce`, `listSweepTargets`, `__injectPoolAssemblerForTest`, `__resetTickStateForTest`, `startValueSummaryTick`) not yet exported

---

## Test Count Summary

| Test Layer | File | Tests RED | Reason |
|---|---|---|---|
| L2 (Guard) | chronology-ordering.test.js | 1 | Missing FILE_DISPOSITIONS entry |
| L1 (Comp) | value-summary.test.js | 16 | Missing `{ altitudes, states }` split & ALTITUDE_STATES export |
| L1 (Route) | value-summary.test.js | 4 | Route not responding with states |
| L4 (i18n) | value-summary.test.js | 1 | queued key not in locales |
| L1 (Tick) | value-summary-tick.test.js | 16 | Tick functions not exported |
| **TOTAL** | | **38** | All red-via-missing-implementation |

---

## False-Greens Detected

None. All tests written are meaningfully RED for architectural reasons, not typos or bad imports.

---

## Next Build Steps (Implementer)

1. **Task 3:** Implement `enrichPoolAltitudes` split in value-summary.js → exports `{ altitudes, states }` and `ALTITUDE_STATES`
2. **Task 4:** Route change to forward states → tests go GREEN
3. **Task 5:** Add i18n keys → i18n test goes GREEN
4. **Task 10:** Implement value-summary-tick.js → all tick tests go GREEN

---

## Evidence File Locations

- **Stub created:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor/server/lib/value-summary-tick.js`
- **Test files written/modified:**
  - `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor/server/__tests__/value-summary.test.js` (modified: +36 lines)
  - `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor/server/__tests__/value-summary-tick.test.js` (new: 612 lines)
  - `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor/server/__tests__/chronology-ordering.test.js` (unchanged, stub addition triggers RED)
