# Build Task List — coverage-on-demand QA-fix (Value Pool Slice 2 QA debt closure)

**Build:** `2026-08-05-coverage-on-demand-qa-fix`  
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor`  
**Branch:** `effort/2026-08-05-coverage-on-demand-qa-fix`  
**Base:** `4c2e931` (already merged to origin/master)  
**Operative spec:** `qa/test-plan.md`  
**Defect catalog entries:** §9.8 (SF-6), §9.3 (SF-7, test discipline), §9.1 (SF-4/T7), §9.7 (N2), §9.4 (fix-round-regression disposition rule)

---

## Task Sequencing Overview

**Total tasks: 22**

| Phase | Items | P-tier | Count | Gating |
|-------|-------|-------|-------|--------|
| P0 MANDATORY | SF-9 (2 subtasks), SF-8 (2 subtasks), SF-6 (3 subtasks) | red-first proof | 7 | yes, gates origin push + Slice 3 |
| P0 verification | both suites green | verification | 1 | yes, gate-closing |
| P1 durable cure | N2, T7 (SF-4) | red-first proof | 2 | yes, structural guards |
| P2 hygiene | SF-7 smoke, screens-snapshot mock/anchor/baseline, decisions.md | mutation proof + docs | 5 | yes, false-confidence removal |
| P3 optional | e2e spec, T8 route-level drain, WS lifecycle edges, N1 char | time-allowing | 4 | no, skip-with-reason if needed |
| **Disposition obligation (§9.4)** | decide P3 + record skips | decisions.md rows | — | yes, part of DoD |

**Sequencing constraints:**
- P0 must complete before P1 starts
- P0 and P1 must be green before P2
- P2 must be green before P3
- Each red-first cycle must complete before the next task
- Snapshot baseline must be generated only after behavioral anchor and mock fix
- qa/decisions.md is a P2 deliverable and a Definition-of-Done item (not optional)

**Concurrent-session hygiene (from build-brief):**
- Multiple `claude` CLI processes attached to main checkout (PIDs 264, 96004, 96133, 98278)
- This build runs exclusively in the new worktree; no git operations on main checkout
- Before every mutation/revert, ensure no unintended side effects in main checkout via `ps`/`lsof` (already verified at triage)

---

## Task 1: SF-9 Test (client, P0 MANDATORY — coverage-fetch failure isolation)

**Files touched (relative to worktree):**
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx`

**What changes:**
Add a new test case inside the existing `describe("PlanLedgerPanel: Value Pool Slice 2 coverage header (DEC-1, DEC-5, R4)")` block, immediately after the R4 out-of-order case (~line 1207).

New `it("SF-9: a failing GET /coverage degrades gracefully — plans and pool still render, not blanked behind an error banner")`  
- Mock `list`/`pool`/`health` to return valid content
- Mock `coverage` to reject with an error
- Assert plan title, pool unit, and no content-replacing banner all render
- This test goes **RED** before the fix (the rejected coverage leg rejects the whole `Promise.all`, so `setPlans`/`setUnits`/`setHealth` never fire)

**Layer/component:** client, `PlanLedgerPanel.tsx` test layer  
**Type:** test (RED state)  
**Done-check:**
```bash
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "SF-9:" --reporter=verbose
# Expect: FAILS with assertion error showing plan title not found or content-replacing error banner present
```

---

## Task 2: SF-9 Fix + Reusable Helper (client, P0 MANDATORY — per-leg failure isolation)

**Files touched (relative to worktree):**
- `client/src/components/PlanLedgerPanel.tsx` (lines 696–701 in `load()` function)
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (helper definition)

**What changes:**
1. In `PlanLedgerPanel.tsx:696–701`, isolate the coverage fetch leg:
   ```javascript
   api.projectPlans.coverage(projectId).catch(() => ({ coverage: null }))
   ```
   (Previously bundled in the same `Promise.all`/`catch` as `list`/`pool`/`health`.)
   
2. In the test file, extract the assertion into a reusable helper function `expectPanelCoreIntact(screen)` that:
   - Asserts `screen.getByText("Phase 1: Intake")` or equivalent plan title is present (takes no coverage-specific arguments)
   - Asserts pool unit element is present
   - Asserts no full-panel error banner is replacing core content
   - **This helper is the template for every future leg added to the same `Promise.all`**

**Layer/component:** client, `PlanLedgerPanel.tsx` (core component)  
**Type:** implementation (GREEN state)  
**Done-check:**
```bash
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "SF-9:" --reporter=verbose
# Expect: PASSES, plan + pool render, coverage-header absent
```

**Defect catalog:** No new catalog id (general no-veto invariant; implementation detail of P1 durable cure)  
**MANDATORY:** Yes, P0 gate; cites test-plan §"Implementation steps" P0 item 1  
**Red-first recorded:** Test fails with `screen.getByText("Phase 1: Intake")` throwing; after fix passes  

---

## Task 3: SF-8 Test (client, P0 MANDATORY — entity-scoped state isolation)

**Files touched (relative to worktree):**
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx`

**What changes:**
Add a new test case in the same `describe("PlanLedgerPanel: Value Pool Slice 2 coverage header…")` block, immediately after Task 2's SF-9 case.

New `it("SF-8: switching projectId does not leak the previous project's coverage snapshot under the new project's pool")`  
- Give `mockCoverageMock` a `mockImplementation` keyed on `projectId`:
  - `"proj-A"` → newer `computed_at: "2026-06-10T12:00:00.000Z"`, `pool_size: 10`, `described: 10`, `complete: true`
  - `"proj-B"` → older `computed_at: "2026-06-01T09:00:00.000Z"`, `pool_size: 20`, `described: 3`, `pending: 17`
- Render with `projectId="proj-A"`, wait for header `"10 of 10 described"`
- Rerender same instance with `projectId="proj-B"` (unkeyed mount, same as `ProjectDetail.tsx:1292`)
- Assert header now reads `"3 of 20 described"` and contains no trace of `pool_size: 10`
- This test goes **RED** before the fix (monotonic merge on `computed_at` alone keeps A's newer snapshot)

**Layer/component:** client, `PlanLedgerPanel.tsx` test layer  
**Type:** test (RED state)  
**Done-check:**
```bash
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "SF-8:" --reporter=verbose
# Expect: FAILS, header still shows "10 of 10 described" after rerender to proj-B
```

**Defect catalog:** Candidate pattern "MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH" (registered this QA pass per build-brief §1.2.3); see build-brief "Project-specific risk surfaces" section  
**MANDATORY:** Yes, P0 gate  

---

## Task 4: SF-8 Fix (client, P0 MANDATORY — entity-state reset on prop change)

**Files touched (relative to worktree):**
- `client/src/components/PlanLedgerPanel.tsx` (add `useEffect` hook)

**What changes:**
Add an explicit state reset in the component body (preferred over keying, per test-plan §"Implementation steps" step 2):
```javascript
useEffect(() => {
  setCoverage(null);
}, [projectId]);
```

**Rationale:** Keying only fixes `coverage` and does not prevent the *next* entity-scoped field from inheriting the same leak. This approach is structural and reusable.

**Scope note (do not widen):** `altitudes` and `requestedAltitudesRef` are also instance-shared across a project switch, but they are keyed by unit id and re-fetched, so they do not produce a *visible* cross-project value. Record in qa/decisions.md (Task 20) rather than expanding the diff.

**Layer/component:** client, `PlanLedgerPanel.tsx`  
**Type:** implementation (GREEN state)  
**Done-check:**
```bash
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "SF-8:" --reporter=verbose
# Expect: PASSES, header reads "3 of 20 described", no trace of A
```

**MANDATORY:** Yes, P0 gate  
**Red-first recorded:** Test fails before fix; passes after  

---

## Task 5: SF-6 Test (server, P0 MANDATORY — first-observation broadcast)

**Files touched (relative to worktree):**
- `server/__tests__/value-summary-tick.test.js`

**What changes:**
Add a new `describe("SF-6: shouldBroadcastCoverage on a project's FIRST observation in a process lifetime")` block, placed adjacent to the existing `describe("Broadcast widening (DEC-6)…")` block (~line 1335).

**Case 1 (positive):**  
`it("a project whose first-ever observed sweep is already complete (generated===0) still broadcasts the terminal snapshot")`
- Call `__resetTickStateForTest()` (precondition: empty `lastBroadcastState`)
- Seed via `makeSweptProject` + `__injectPoolAssemblerForTest` a project with all units cached, so `generated: 0`, `cache_hits: poolSize`, `complete: true`
- Call `runValueSummaryTickOnce(dbModule, { broadcast: capture })` **once**
- Assert `broadcasts.length === 1` ← **this is the RED assertion**
- Assert captured payload has `coverage.complete === true` and `coverage.demand === "passive"`
- **This test goes RED before the fix** (with only `generated > 0` broadcast logic, `broadcasts.length` is `0`)

**Case 2 (negative bounding):**  
`it("a project's first-ever observed sweep that is NOT complete does not spuriously broadcast (no false-positive from the fix)")`
- Same `__resetTickStateForTest()` precondition
- Seed a pool with genuinely unresolved units (`generated: 0`, `unavailable > 0`, `complete: false`)
- Assert `broadcasts.length === 0`
- **This test goes GREEN both before and after the fix** (bounds against overcorrection: "always broadcast on first")

**Layer/component:** server, `value-summary-tick.js` test layer  
**Type:** test (RED state for case 1, GREEN state for case 2)  
**Done-check:**
```bash
node --test server/__tests__/value-summary-tick.test.js --grep "SF-6:" --reporter=verbose
# Expect Case 1: FAILS with broadcasts.length === 0
# Expect Case 2: PASSES
```

**Defect catalog:** §9.8 OVERLOADED-ABSENCE; cites build-brief "Project-specific risk surfaces"  
**MANDATORY:** Yes, P0 gate; both cases are P0  

---

## Task 6: SF-6 Fix + Comment Corrections (server, P0 MANDATORY — first-observation logic)

**Files touched (relative to worktree):**
- `server/lib/value-summary-tick.js` (lines 190–195, 111–118, 180–183)

**What changes:**
1. **Core fix** at line 190–195:  
   Change `const transitioned = !!prior && (...)` to:
   ```javascript
   const transitioned = prior ? (prior.demand !== demand || prior.complete !== complete) : complete === true;
   ```
   This treats an absent prior as a transition **only when `complete === true`**.

2. **Comment corrections** (load-bearing, per test-plan §"Implementation steps" step 3):
   - Module-scope comment at `:111-118`: currently claims "it can only ever SUPPRESS one redundant early broadcast, never fabricate a false one" — FALSE after this fix. Rewrite to state the real rule: *"a first observation broadcasts iff the pool is already complete; otherwise `generated > 0` alone governs it."*
   - JSDoc at `:180-183`: currently claims "A project with no prior recorded broadcast is treated as 'unchanged' (never fabricates a transition out of nothing)" — FALSE after this fix. Rewrite to the same rule above.

**Layer/component:** server, `value-summary-tick.js`  
**Type:** implementation (GREEN state) + docs  
**Done-check:**
```bash
node --test server/__tests__/value-summary-tick.test.js --grep "SF-6:" --reporter=verbose
# Expect Case 1: PASSES with broadcasts.length === 1
# Expect Case 2: PASSES with broadcasts.length === 0
grep -n "can only ever SUPPRESS" server/lib/value-summary-tick.js  # should return 0 (comment updated)
```

**Regression watch (critical):** Per test-plan §"Implementation steps" step 3, after this fix run `npm run test:server` immediately and check for any pre-existing broadcast-count assertions that flip. If they do, adjudicate each one individually — the correct expectation is *one* broadcast per newly-observed-complete project per process, with no repeats. **Do not relax any pre-existing assertion to make the suite pass without recording the reason.**

**MANDATORY:** Yes, P0 gate  
**Red-first recorded:** Case 1 fails before fix (broadcasts.length === 0), passes after; Case 2 stays green both before and after  

---

## Task 7: P0 Full Suite Verification (both layers, P0 MANDATORY gate check)

**Files touched (relative to worktree):**
- (no new files; verification only of Tasks 1–6)

**What changes:**
None (verification step only).

**Layer/component:** both client and server test harnesses  
**Type:** verification  
**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor

# Server suite
npm run test:server 2>&1 | tee /tmp/server-test.log
# Expect: ≥1786 passing (1784 baseline + 2 SF-6 cases)
# Confirm: grep "^[0-9]* passing" /tmp/server-test.log shows ≥1786

# Client suite
npm run test:client 2>&1 | tee /tmp/client-test.log
# Expect: ≥819 passing (817 baseline + 2 P0 cases)
# Confirm: grep "^[0-9]* passing" /tmp/client-test.log shows ≥819

# No failures or skipped
grep -E "(failing|skipped)" /tmp/server-test.log  # expect 0
grep -E "(failing|skipped)" /tmp/client-test.log  # expect 0
```

**MANDATORY:** Yes, P0 gate-closing; must complete before P1 starts  
**Defect catalog:** §9.4 FIX-ROUND-REGRESSION — suite was green before these defects were found; it must stay green after the fixes

---

## Task 8: N2 Test (server, P1 MANDATORY durable cure — exact-exemption registry assertion)

**Files touched (relative to worktree):**
- `server/__tests__/value-coverage.test.js`

**What changes:**
Extend `describe("i18n registry → locale (WATCH-S2-F, G6)…")` (line ~276) with one new case placed **before** the per-locale loop to fail fast:

`it("N2: the STATE_TO_LOCALE_KEY exemption set (registry members with NO locale key) is exactly the reviewed closed set, not silently permissive")`
```javascript
const exemptDemand = DEMAND_STATES.filter((s) => !STATE_TO_LOCALE_KEY.demand[s]);
assert.deepEqual(exemptDemand, ["passive"]);

const exemptEta = ETA_STATES.filter((s) => !STATE_TO_LOCALE_KEY.eta[s]);
assert.deepEqual(exemptEta, ["none"]);
```

**Why this is P1:** Registry growth must break the test at the point of growth, not later. This is §9.7's "named exemption set" pattern.

**Layer/component:** server, `value-coverage.js` test layer  
**Type:** test (GREEN state; red-proof by mutation, see Task 9)  
**Done-check:**
```bash
node --test server/__tests__/value-coverage.test.js --grep "N2:" --reporter=verbose
# Expect: PASSES with exact match on exemption sets
```

**Defect catalog:** §9.7 HAND-SCOPED STRUCTURAL SCAN; see build-brief "Project-specific risk surfaces" section  
**MANDATORY:** Yes, P1; structural guard  

---

## Task 9: N2 Red-First Proof (server, P1 MANDATORY — mutate and revert)

**Files touched (relative to worktree):**
- `server/lib/value-coverage.js` (temporary mutation)

**What changes:**
**Temporary only — will be reverted.**

1. Add a 4th member to `DEMAND_STATES` with no corresponding `STATE_TO_LOCALE_KEY.demand` entry:
   ```javascript
   DEMAND_STATES = ["passive", "requested", "draining", "stalled"]; // added "stalled"
   ```
   (Do not add `"stalled"` to `STATE_TO_LOCALE_KEY.demand`.)

2. Run the test:
   ```bash
   node --test server/__tests__/value-coverage.test.js --grep "N2:" --reporter=verbose
   # Expect: FAILS with AssertionError: deep equal
   # Output should show exemptDemand === ["passive", "stalled"] !== ["passive"]
   ```

3. **Revert the temporary change** to the exact byte-for-byte original state.

4. Re-run the test to confirm it passes again:
   ```bash
   node --test server/__tests__/value-coverage.test.js --grep "N2:" --reporter=verbose
   # Expect: PASSES
   ```

**Layer/component:** server, `value-coverage.js`  
**Type:** mutation red-proof (procedural step, not code change)  
**Done-check:** Red state observed and recorded; revert confirmed byte-identical; green state confirmed  
**MANDATORY:** Yes, P1; per test-plan §"Implementation steps" step 5: "Do this, don't skip it"  
**Defect catalog:** §9.3 VACUOUS-GUARD standing rule — "a guard is not done until observed RED"

---

## Task 10: T7/SF-4 Test (server, P1 MANDATORY durable cure — composition-parity guard)

**Files touched (relative to worktree):**
- `server/__tests__/project-plans-api.test.js`

**What changes:**
Extend `describe("Group T: coverage-on-demand routes…")` (line ~826) with one new case:

`it("T7 (SF-4): the POST /coverage-request and GET /coverage handlers compose their coverageSnapshot call from identical building blocks")`

**Logic:**
1. `fs.readFileSync` `server/routes/project-plans.js` and extract:
   - POST handler body: from `router.post("/coverage-request"` to the next `router.get("/coverage"`
   - GET handler body: from `router.get("/coverage"` to the next top-level `router.` call

2. Assert both bodies contain these literal compositions:
   - `await valueLedger.assembleValuePool(dbModule, { id: projectId });`
   - `await enrichPoolAltitudes(dbModule, units, { probe: true });`
   - `draining: isDrainingProject(projectId),`

3. Extract each handler's `coverageSnapshot(dbModule, { … })` argument-object key set via regex (`/(\w+):/g`), sort both, and:
   ```javascript
   assert.deepEqual(postKeys, getKeys);
   assert.deepEqual(postKeys, ["computedAt","counts","draining","projectId","requestedAt"]);
   ```
   The second assertion ensures a *matched pair of drifts* still fails.

4. **Do NOT** assert the two `requestedAt` argument *expressions* are textually identical — they are deliberately different (SF-2 fix); this test asserts *shape* parity only.

**Why P1:** §9.1's "scan for copies of the helpers too" — this seam (route↔route) has no home in any existing per-module spec.

**Layer/component:** server, `project-plans-api.test.js` test layer  
**Type:** test (GREEN state; red-proof by mutation, see Task 11)  
**Done-check:**
```bash
node --test server/__tests__/project-plans-api.test.js --grep "T7 " --reporter=verbose
# Expect: PASSES with composition parity confirmed
```

**Defect catalog:** §9.1 DERIVED-DUAL-VIEW (7th occurrence); see build-brief "Project-specific risk surfaces"  
**MANDATORY:** Yes, P1; structural guard  

---

## Task 11: T7/SF-4 Red-First Proof (server, P1 MANDATORY — mutate and revert)

**Files touched (relative to worktree):**
- `server/routes/project-plans.js` (temporary mutations)

**What changes:**
**Temporary only — will be reverted.** Test-plan requires two independent red proofs (not one).

**Red proof (a): Hardcode `draining` in one route**
1. In one of the route handlers (e.g., POST), change `draining: isDrainingProject(projectId),` to `draining: false,`
2. Run the test:
   ```bash
   node --test server/__tests__/project-plans-api.test.js --grep "T7 " --reporter=verbose
   # Expect: FAILS; the literal-substring assertion should catch the missing `isDrainingProject` call
   ```
3. Revert to exact original state.

**Red proof (b): Add a 6th key in one route only**
1. In one of the route handlers, add an extra key to the `coverageSnapshot` argument (e.g., `demand: "requested",`)
2. Run the test:
   ```bash
   node --test server/__tests__/project-plans-api.test.js --grep "T7 " --reporter=verbose
   # Expect: FAILS; the key-set `deepEqual` must go red
   ```
3. Revert to exact original state.

4. **Final confirmation:**
   ```bash
   node --test server/__tests__/project-plans-api.test.js --grep "T7 " --reporter=verbose
   # Expect: PASSES (both mutations reverted)
   ```

**Layer/component:** server, `project-plans.js`  
**Type:** mutation red-proof (procedural step, not code change)  
**Done-check:** Both red states observed and recorded; both reverts confirmed byte-identical; final green confirmed  
**MANDATORY:** Yes, P1; per test-plan §"Implementation steps" step 6  
**Defect catalog:** §9.3 VACUOUS-GUARD standing rule

---

## Task 12: SF-9 Helper Generalization Verification (client, P1 MANDATORY durable cure)

**Files touched (relative to worktree):**
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (review only)

**What changes:**
None (verification only). Review the `expectPanelCoreIntact` helper written in Task 2 to confirm:
- Takes no coverage-specific arguments (only `screen` parameter)
- Asserts core content presence only (plan title + pool unit + no replacing banner)
- Can be reused verbatim by a future leg added to the same `Promise.all`

**Layer/component:** client, test helper pattern  
**Type:** review/verification  
**Done-check:**
```bash
grep -A 10 "expectPanelCoreIntact" client/src/components/__tests__/PlanLedgerPanel.test.tsx
# Verify: function signature is "expectPanelCoreIntact(screen)" with no coverage-specific params
# Verify: assertions are generic (plan title, pool unit, no replacing error)
```

**MANDATORY:** Yes, P1; this is the assertion half of the SF-9 durable cure  

---

## Task 13: SF-7 Smoke-Suite Replacement (server, P2 hygiene — vacuous-guard removal)

**Files touched (relative to worktree):**
- `server/__tests__/coverage-smoke.test.js` (in-place replacement)

**What changes:**
Replace the false-confidence existence-only cases with real assertions:

1. **Delete** the two statement-existence cases (lines ~25–34 and ~36–44)
2. **Replace with one real round-trip case:**
   ```javascript
   it("requestValueCoverage round-trip: written value is read back exactly")
   stmts.requestValueCoverage.run(dbModule, {
     projectId: "test-proj-123",
     requestedAt: "2026-08-05T14:32:00.000Z"
   });
   const row = stmts.getValueSweepState.get(dbModule, { projectId: "test-proj-123" });
   assert.equal(row.coverage_requested_at, "2026-08-05T14:32:00.000Z");
   ```
   Add a comment: *"The actual AC-2 mechanism is tested in `project-plans-api.test.js` T3."*

3. **Delete** the demand-field registry case (line ~93–112), with pointer comment to `value-coverage.test.js` G1b.

4. **Replace** the conditional ETA case (lines ~114–136) with **unconditional** form:
   ```javascript
   it("estimateEta ETA state when pending > 0 but zero qualifying log rows")
   // Same fixture: pending > 0, zero qualifying rows
   assert.equal(eta.state, "estimating");
   assert.equal(eta.ms_remaining, undefined);
   ```
   (Remove the `if` condition.)

5. **Keep unchanged** the `ValueAltitudesUpdatedPayload` interface-body regex case (lines ~140–173) — it is genuine.

6. **Delete** `listRecentValueGenerationDurations` existence case (lines ~175–184), with pointer comment.

**Layer/component:** server, `coverage-smoke.test.js` test layer  
**Type:** test hygiene / false-confidence removal  
**Done-check:**
```bash
# Count of existence-only cases should be zero
grep -c 'assert.ok(stmts\.' server/__tests__/coverage-smoke.test.js
# Expect: 0

# Run the suite to confirm new round-trip case passes
node --test server/__tests__/coverage-smoke.test.js --reporter=verbose
# Expect: all cases pass
```

**Red-first proof (critical):** Temporarily flip `requestValueCoverage`'s SQL to a no-op (`SELECT 1`):
```bash
# Temporarily edit the statement in db.js to SELECT 1
# Run the suite
node --test server/__tests__/coverage-smoke.test.js --grep "round-trip" --reporter=verbose
# Expect: NEW case goes red (assertion fails because coverage_requested_at is never written)
# Revert the temporary change
```

**Defect catalog:** §9.3 VACUOUS-GUARD — "the guard is the vacuity" sub-pattern; four existence-only cases removed  
**MANDATORY:** No (P2 hygiene), but red-first proof is required per test-plan  

---

## Task 14: screens-snapshot Mock Fix (client, P2 hygiene — missing API mock methods)

**Files touched (relative to worktree):**
- `client/src/pages/__tests__/screens.snapshot.test.tsx` (shared API mock)

**What changes:**
Add `coverage` and `requestCoverage` to the shared `vi.mock("../../lib/api", …)` `api.projectPlans` object.

Currently it lists only: `list`, `pool`, `health`, `claim`, `close`.  
Add (in order):
```javascript
coverage: vi.fn().mockResolvedValue({ coverage: null }),
requestCoverage: vi.fn().mockResolvedValue({ coverage: null }),
```

**Why:** The convention documented by the cartographer requires **any new API method a page calls must be added to this shared mock**. Without this, any page that mounts `PlanLedgerPanel` would hit SF-9's shared `catch` and throw during snapshot rendering, making the snapshot meaningless.

**Layer/component:** client, test infrastructure  
**Type:** mock/fixture update  
**Done-check:**
```bash
grep -A 5 'vi.mock("../../lib/api"' client/src/pages/__tests__/screens.snapshot.test.tsx | grep coverage
# Expect: coverage and requestCoverage lines present
```

---

## Task 15: ProjectDetail Behavioral Anchor (client, P2 hygiene — anchor before snapshot)

**Files touched (relative to worktree):**
- `client/src/pages/__tests__/ProjectDetail.test.tsx`

**What changes:**
Add one new test case after `"renders the PlanLedgerPanel card beside existing cards (F2)"` (~line 794):

`it("renders the coverage header and 'prioritize now' control when the pool is in-progress")`
```javascript
// Override mocks to return in-progress coverage state
projectPlansCoverageMock.mockResolvedValue({
  coverage: {
    project_id: "proj-1",
    described: 4,
    pool_size: 10,
    pending: 6,
    complete: false,
    demand: "passive",
    requested_at: null,
    eta: { state: "estimating" },
    computed_at: "2026-06-10T13:00:00.000Z"
  }
});
projectPlansPoolMock.mockResolvedValue({
  units: [<one real unit>],
  identityWarnings: []
});

// Assert elements render
assert(screen.getByTestId("coverage-header")); // contains "4 of 10 described"
assert(screen.getByTestId("prioritize-now-button"));
// Assert the exact i18n copy matches PlanLedgerPanel.test.tsx case
assert(screen.getByText(/estimating/i)); // use the same i18n key as the other test
```

**Why before snapshot:** The snapshot baseline must be generated only after this behavioral anchor exists and passes, ensuring the baseline captures the actual coverage-header render and not a "Project not found" stub.

**Red-first proof:** Temporarily change `PlanLedgerPanel.tsx`'s render gate from `coverage.pool_size > 0` to `> 100`:
```bash
# Edit PlanLedgerPanel.tsx line ~XXX temporarily
# Run this test
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx -t "pool is in-progress" --reporter=verbose
# Expect: test goes RED (elements not found)
# Revert the edit
# Re-run to confirm GREEN
```

**Layer/component:** client, `ProjectDetail` page test  
**Type:** behavioral anchor test (must be GREEN before snapshot baseline)  
**Done-check:**
```bash
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx -t "pool is in-progress" --reporter=verbose
# Expect: PASSES, coverage header and button visible
```

---

## Task 16: screens-snapshot Baseline Regeneration (client, P2 hygiene — scoped snapshot update)

**Files touched (relative to worktree):**
- `client/src/pages/__tests__/screens.snapshot.test.tsx` (add one case and generate baseline)

**What changes:**
Add one **additive** case after the existing `it("Project detail", …)` snapshot case:

```javascript
it("Project detail (coverage in progress)", async () => {
  mockResolvedValueOnce(api.projects.list, {
    projects: [{ id: "proj-1", title: "Test Project", … }] // a real project
  });
  mockResolvedValueOnce(projectPlansPoolMock, {
    units: [<one real unit>],
    identityWarnings: []
  });
  mockResolvedValueOnce(projectPlansCoverageMock, {
    coverage: {
      project_id: "proj-1",
      described: 4,
      pool_size: 10,
      pending: 6,
      complete: false,
      demand: "passive",
      requested_at: null,
      eta: { state: "estimating" },
      computed_at: "2026-06-10T13:00:00.000Z"
    }
  });
  await snapshot(page, "/projects/proj-1");
});
```

**Baseline generation (scoped, never blanket `-u`):**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor/client
npx vitest run -u -t "Project detail (coverage in progress)"
# This creates a NEW .snap entry, does NOT touch existing "Project detail" entry
```

**Verification after baseline generation:**
1. Read the generated `.snap` entry and confirm:
   - Coverage header text is present (e.g., "4 of 10 described")
   - "prioritize now" button markup is present
   - Snapshot is not the "Project not found" fallback

2. Run the full snapshots suite to confirm no unintended side effects:
   ```bash
   cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx --reporter=verbose
   # Expect: all cases pass, including the new one
   # Confirm via git diff that only the new entry was added, old entries unchanged
   ```

**Layer/component:** client, snapshot test  
**Type:** snapshot baseline (must be generated only after behavioral anchor is in place)  
**Done-check:**
```bash
cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx --reporter=verbose
# Expect: all pass
git diff --stat client/src/pages/__tests__/__snapshots__/screens.snapshot.test.tsx.snap
# Expect: only additions, no changes to pre-existing entries
```

**MANDATORY:** No (P2 hygiene), but scoped update rule is required per CLAUDE.md  

---

## Task 17: qa/decisions.md Creation (documentation, P2 MANDATORY — Definition of Done deliverable)

**Files touched (relative to worktree):**
- `requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/qa/decisions.md` (new file or append)

**What changes:**
Create or append to `qa/decisions.md` with dated 2026-08-05 rows for four required categories. Each row must cite the risk, the decision, and (where applicable) the trigger for re-opening.

**Required rows (test-plan §"Implementation steps" step 10):**

1. **Trap 7 — wire `pending` sourcing (risk disclosure row)**
   ```
   | Trap 7 | 2026-08-05 | Internal `pending` computation in value-summary-tick could silently start feeding the wire again | No test asserts the wire's `pending` is sourced from `coverageSnapshot` rather than merely equal to it | **Trigger:** any future edit to the WS broadcast payload assembly in `value-summary-tick.js`. Re-verify both coverage and `pending` round-trip from `coverageSnapshot` through broadcast. |
   ```

2. **STRICTMODE-BLIND residual scope (risk disclosure row)**
   ```
   | STRICTMODE-BLIND residual | 2026-08-05 | BL-2 fixed one effect; the WS-subscriber effect and the coverage-fetch effect are unexamined for the same class | SF-8/SF-9 fixes live in exactly those effect bodies | **Trigger:** implement client `<StrictMode>` wrapper in shared RTL render helper (Slice 3 or later). **Scope note:** wrapping is deferred; the gap is disclosed. |
   ```

3. **Four deferred durable cures (architectural decisions, with triggers)**

   a. **Entity-scoped state hook (MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH durable cure)**
   ```
   | Entity-scoped state isolation | 2026-08-05 | `PlanLedgerPanel` coverage reset added; next entity-scoped field inherits the same leak; no structural guard | SF-8 fix protects coverage only | **Consequence:** next state field added to PlanLedgerPanel (or similar component) will lack reset. **Interim mitigation:** standing test convention documented: "any component test for a component taking an entity-id prop must include one 'switch the id, assert the state followed' case". **Trigger:** next component gaining entity-scoped state. **Recommended extract:** `useEntityScopedState(projectId, initial)` hook + lint rule. |
   ```

   b. **Per-leg failure-disposition refactor (SF-9 per-leg enhancement pattern)**
   ```
   | Multi-fetch leg isolation | 2026-08-05 | SF-9 fix adds per-leg catch for coverage only; future field can still be joined into blocking set by accident | Reusable `expectPanelCoreIntact` helper exists but structure remains flat | **Consequence:** no guard prevents next fetch from inheriting blocking-fetch behavior. **Trigger:** next field added to PlanLedgerPanel.load(). **Recommended structure:** extract leg `required`/`enhancement` classification with explicit failure handling per category. |
   ```

   c. **Deriving `assertSingleHome` consumer axis (§9.7 hand-scoped structural scan durable cure)**
   ```
   | Single-home consumer scan | 2026-08-05 | T7 structural parity guard added; scope is still hand-typed for each file | §9.1 history: new consumer hand-typed into scope → invisible → found in review | **Consequence:** Slice 3's third consumer (ccam, MCP) will be invisible to guard by construction. **Trigger:** Slice 3's first new consumer of value-summary.js or value-coverage.js. **Recommended:** grep consumer axis from imports, fail on any importer with no disposition. |
   ```

   d. **Wrapping shared RTL helper in StrictMode (STRICTMODE-BLIND durable cure)**
   ```
   | Client effect double-invoke class | 2026-08-05 | SF-8/SF-9 live in effect bodies; WS subscriber and coverage-fetch effect unexamined for StrictMode issues | BL-2 was one effect class | **Consequence:** double-invoke bugs stay structurally invisible. **Expect:** first-run red set on day one; legitimate render parity issues must be re-fixed, not weakened. **Not a gate for this build.** **Trigger:** decision to wrap shared RTL mock helper. **Deliberate slice:** its own distinct effort with triage budget. |
   ```

4. **SF-8 scope note (documentation, not an action row)**
   ```
   | SF-8 altitudes scope | 2026-08-05 | `altitudes` and `requestedAltitudesRef` are also instance-shared across project switch but are keyed by unit id and re-fetched for the new project's units, so no visible cross-project value | Not fixed in this build; noted for completeness | No action. Revisit if the re-fetch semantics change. |
   ```

**Format:** Use the existing `decisions.md` table format (or create a new table if the file doesn't exist). Each row must be dated 2026-08-05 and include a trigger or consequence statement per test-plan text.

**Layer/component:** documentation deliverable  
**Type:** decision log (Definition of Done requirement)  
**Done-check:**
```bash
wc -l requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/qa/decisions.md
# Expect: file exists, ≥4 rows (may have existing pre-fix rows)
grep "2026-08-05" requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/qa/decisions.md
# Expect: 4+ dated rows
```

**MANDATORY:** Yes, P2; part of Definition of Done per test-plan and build-brief  
**Defect catalog:** §9.4 FIX-ROUND-REGRESSION — "every QA finding must end fixed with a test or recorded with an id"  

---

## Task 18: P2 Full Suite Verification + File-Header Audit (verification, P2 gate check)

**Files touched (relative to worktree):**
- (no new source files; verification only of Tasks 13–17)

**What changes:**
None (verification step only).

**Layer/component:** both test harnesses + file audit  
**Type:** verification + hygiene  
**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor

# Run both suites again after P2 changes
npm run test:server 2>&1 | tee /tmp/server-test-p2.log
npm run test:client 2>&1 | tee /tmp/client-test-p2.log

# Confirm counts are still ≥ P0 expectations (no regressions from P2)
grep "^[0-9]* passing" /tmp/server-test-p2.log  # ≥1786
grep "^[0-9]* passing" /tmp/client-test-p2.log  # ≥819

# Vacuous-guard sweeps (per test-plan §"Sweep discipline before declaring done")
grep -rn 'assert.ok(true' server/__tests__/
# Expect: exactly **1** (SF-10.2, pre-existing)

grep -rn '|| true' server/__tests__/
# Expect: 0

# File-header audit (per CLAUDE.md project rule)
bash .claude/skills/file-headers/scripts/check-headers.sh
# Expect: exit 0 (no new non-compliant files)

# Client typecheck
cd client && npx tsc --noEmit
# Expect: clean
```

**MANDATORY:** Yes, P2 gate-closing  
**Defect catalog:** §9.3 VACUOUS-GUARD — standing sweeps before done  

---

## Task 19: P2 Complete — Decision to Proceed or Skip P3 (planning decision point)

**Files touched (relative to worktree):**
- (no code changes; decision point only)

**What changes:**
None (decision point).

**Decision point:**
After Task 18 confirms P2 is green, decide whether to proceed with P3 (4 optional items) based on available time.

**P3 items (if time allows; if skipped, must record reason in qa/decisions.md):**
- Task 20: `coverage-request-e2e.test.js` (new integration spec)
- Task 21: T8 route-level `draining` under real in-flight drain (deterministic-deferred only; time-box 30 min)
- Task 22: PlanLedgerPanel WS lifecycle-edge `describe` blocks (four lifecycle cases)
- Task 23 (omitted from this list as out of time-box): N1 characterization test (WATCH-S2-C optional)

**Recording obligation (§9.4):** If any P3 item is skipped, add a row to `qa/decisions.md` dated 2026-08-05 with:
- Item name
- Reason for skip (e.g., "time constraint," "deterministic design failed within 30 min budget," "deferred per plan")
- No trigger needed (optional items)

**Layer/component:** process / planning  
**Type:** decision gate  
**Done-check:**
- If P3 proceeded: all four items in Tasks 20–23 completed and recorded
- If P3 skipped: `qa/decisions.md` contains skip-with-reason rows for each omitted item, dated 2026-08-05

---

## Task 20: coverage-request-e2e.test.js (server, P3 OPTIONAL — integration proof of end-to-end flow)

**Files touched (relative to worktree):**
- `server/__tests__/coverage-request-e2e.test.js` (new file)

**What changes:**
Create a new spec file with a single sequential scenario (no `{ concurrency: true }`). One seeded flow:

**`before` hook:**
- Set `TEST_DB` environment variable to a scoped temp path
- Set `DASHBOARD_DB_PATH` to the same temp path
- Create the app and start a real server on port 0
- Open **one real `ws` client** to `ws://127.0.0.1:${port}/ws` (first spec in this repo to do so)
- Collect every parsed `value_altitudes_updated` frame for project A
- Close in `after` hook

**Seed:** Project A with **85 units** (> MAX_UNITS_PER_PROMPT=40, forcing 3 batches); second never-swept project B

**Test case: one seeded flow**
```javascript
it("coverage request → rotation jump → 3-batch drain → 100% → real WS frame → HTTP/WS agreement")
  // Baseline: GET /coverage?project_id=A → demand: "passive", complete: false
  // POST /coverage-request {project_id: A} → 202, coverage.demand !== "passive"
  // Immediate: listSweepTargets → A sorts first (rotation jump)
  // Poll: GET /coverage until complete === true (fail loudly on 2s timeout)
  // Collected WS frames non-empty; last frame: complete === true, demand === "passive"
  // Assert at least one intermediate frame has demand !== "passive"
  // Deep-equal last WS frame's coverage against final poll's coverage (strip computed_at)
  // Starvation bound: immediately after poll, runValueSummaryTickOnce(B, {}) → swept >= 1
  //   (structural proxy for wall-clock "two consecutive ticks" bound)
```

**Determinism:**
- Use `__injectSpawnForTest` + `__injectPoolAssemblerForTest` + `spawnResolvingFirst` (from `value-summary-tick.test.js`)
- **Do NOT** set `DASHBOARD_FOCUS_INFER_MODE=heuristic` (heuristic never generates)
- **No polling timers.** Use manually-resolved deferreds for spawn control.
- **No `{ concurrency: true }`** — sequential execution only

**Red-first proof:** Temporarily remove the `coverage_requested_at` leading term from `listValueSweepTargets`'s `ORDER BY` and confirm the rotation-jump assertion goes red:
```bash
# Edit db.js, remove the "(s.coverage_requested_at IS NULL) ASC, s.coverage_requested_at ASC," term
# Run this test
node --test server/__tests__/coverage-request-e2e.test.js --reporter=verbose
# Expect: rotation-jump assertion fails
# Revert the edit
```

**Layer/component:** server, integration test (real server + real SQLite + real `ws` client)  
**Type:** integration spec (GREEN state; red-proof by mutation)  
**Done-check:**
```bash
node --test server/__tests__/coverage-request-e2e.test.js --reporter=verbose
# Expect: PASSES, WS frame collected, rotation jump proven, drain to 100% confirmed
```

**Note on `draining` on HTTP:** Per test-plan reconciliation §1, do **NOT** assert that *every* polled GET /coverage response has `draining` absent/false. That premise was based on SF-3 being unfixed; SF-3 **is** fixed. The real residual (cartographer's PARTIAL) is deferred to T8 (Task 21), which observes `demand !== "passive"` on HTTP during a genuine in-flight drain.

**MANDATORY:** No (P3 optional); but red-first proof is required if implemented  
**Defect catalog:** Closure of named debt A.1  

---

## Task 21: T8 Route-Level Draining (server, P3 OPTIONAL — route-level `draining` state during in-flight drain)

**Files touched (relative to worktree):**
- `server/__tests__/project-plans-api.test.js` (add one case to Group T)

**What changes:**
Add one case to `describe("Group T…")`:

`it("T8: GET /coverage reports demand 'draining' while a real multi-batch drain is in flight")`

**Logic:**
1. Inject a spawn whose promise is held open by a manually-resolved deferred
2. Kick `runCoverageDrain` (or `POST /coverage-request`)
3. `GET /coverage` while it is provably still running (`isDrainingProject(projectId) === true`)
4. Assert `coverage.demand === "draining"`
5. Release the deferred and let the drain finish

**Determinism:** **Deferred-spawn design only.** No polling, no timers. If it cannot be made deterministic in under ~30 minutes, **skip it and record the reason** in a new `qa/decisions.md` row dated 2026-08-05: "T8 skipped: deterministic design not feasible within time budget."

**Time-box:** 30 minutes. If this effort exceeds that, abandon it and move to Task 22 (or mark P3 complete if Task 22 is also time-constrained).

**Layer/component:** server, `project-plans-api.test.js` test layer  
**Type:** integration test (GREEN state; not red-proven per the time-box)  
**Done-check (if completed):**
```bash
node --test server/__tests__/project-plans-api.test.js --grep "T8 " --reporter=verbose
# Expect: PASSES, draining demand observed mid-flight
```

**MANDATORY:** No (P3 optional, with time-box)  
**Defect catalog:** Closure of cartographer's PARTIAL on route-level `draining`  

---

## Task 22: PlanLedgerPanel WS Lifecycle-Edge Describe Blocks (client, P3 OPTIONAL — component subscription lifecycle)

**Files touched (relative to worktree):**
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (add two new `describe` blocks)

**What changes:**
Add two new `describe` blocks using the **real** `eventBus` singleton (import style already used elsewhere in the file); only `../lib/api` is mocked.

**Block 1: `describe("PlanLedgerPanel: coverage lifecycle, one continuous mount (QA debt A.1)")`**
- Mount once cold-start (pool: 5 described, 0 pending, passive, estimating ETA)
- Assert `estimating` copy renders
- `eventBus.publish` a frame with `requested`/`estimating` → header updates
- Publish a `draining`/`measured` frame with real `ms_remaining` → minutes string renders
- Publish final `complete: true, demand: "passive"` frame → "N of N described" renders, "prioritize now" button gone
- **Load-bearing assertion:** mocks called exactly once across whole sequence
- **Load-bearing assertion:** `[data-test="coverage-header"]` never disappears
- **Sweep:** rendered header for unresolved i18n keys (`/planLedger\.[a-zA-Z]/`) after each publish

**Block 2: `describe("PlanLedgerPanel: WS subscriber lifecycle edges (debt A.4, WATCH-S2-B)")`**
Four lifecycle cases (each should pass on first write; if any goes red, stop — new defect found):

1. **Reconnect:** mount, take one update, `eventBus.setConnected(false)` → `(true)`, publish another → still renders, value equals **last** message (no duplicated subscription)
2. **Stale-tab merge (fetch-after-WS race):** `mockCoverageMock` returns manually-resolved promise; publish newer-`computed_at` WS frame *first*, then resolve fetch with older values → WS values win (merge rule tested from initial-fetch call site)
3. **Two tabs, same project:** two `render()`s of `projectId="proj-1"` in separate containers; one publish → both update
4. **Two tabs, different projects:** one `proj-1`, one `proj-2`; publish for `proj-1` → `proj-2` header unchanged
5. (**Not included in this build:** WATCH-S2-B negative half — deferred)

**Layer/component:** client, `PlanLedgerPanel.test.tsx` lifecycle cases  
**Type:** subscription lifecycle test (GREEN by design; each should pass on first write)  
**Done-check:**
```bash
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "coverage lifecycle" --reporter=verbose
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "WS subscriber lifecycle" --reporter=verbose
# Expect: all cases PASS; if any RED, stop and investigate (new defect)
```

**MANDATORY:** No (P3 optional)  
**Defect catalog:** Closure of named debt A.1 (UI half) and A.4 (WATCH-S2-B)  

---

## Task 23: N1 Characterization Test (server, P3 OPTIONAL — ETA model evolution insurance)

**Files touched (relative to worktree):**
- `server/__tests__/value-coverage.test.js` (add one case)

**What changes:**
Add one case to `describe("estimateEta state branches (G1a)")` after the K=5 case (line ~250–262):

```javascript
it("N1: estimateEta evolves correctly when per-project history exists", () => {
  // Seed two historical log rows for projectId:
  // { durationMs: 6000, generated: 2, daysAgo: 0 }
  // { durationMs: 6000, generated: 40, daysAgo: 1 }
  
  const eta = estimateEta(dbModule, { projectId, pending: 40 });
  
  assert.equal(eta.per_batch_ms, 6000);
  // Comment: "if this test needs to change because `estimateEta` starts normalizing 
  // by `generated`, that is WATCH-S2-C's trigger firing — update `decisions.md` in 
  // the same commit, don't just fix the number."
});
```

**Red-event nature:** This test goes **GREEN by design** today. Its red event is deliberately **in the future** (when ETA normalization changes). It is optional insurance against silent model drift.

**Comment requirement:** The comment is load-bearing — it converts a future red run from "broken test" to "trigger detected."

**Layer/component:** server, `value-coverage.test.js` test layer  
**Type:** characterization test (GREEN today; red-event in future)  
**Done-check:**
```bash
node --test server/__tests__/value-coverage.test.js --grep "N1:" --reporter=verbose
# Expect: PASSES (green by design)
grep -A 2 "N1:" server/__tests__/value-coverage.test.js | grep "WATCH-S2-C"
# Confirm comment present
```

**MANDATORY:** No (P3 optional)  
**Defect catalog:** Optional closure of N1 (accepted under WATCH-S2-C); not a live defect  

---

## Definition of Done (Comprehensive Checklist)

### P0 Gate (required before origin push and Slice 3)
- [ ] SF-9 test written, observed **RED** before fix, **GREEN** after (Task 2)
- [ ] SF-8 test written, observed **RED** before fix, **GREEN** after (Task 4)
- [ ] SF-6 both cases written; case 1 **RED** before fix / **GREEN** after (Task 6); case 2 **GREEN** before and after (Task 6)
- [ ] `value-summary-tick.js` comments at `:111-118` and `:180-183` updated to reflect true first-observation rule
- [ ] `npm run test:server` green **≥1786** passing (1784 + 2 SF-6), 0 failed
- [ ] `npm run test:client` green **≥819** passing (817 + 2 P0), 0 failed
- [ ] No pre-existing broadcast-count assertion was weakened; any that changed have one-line written justification

### P1 Durable Cure (required for structural integrity)
- [ ] N2 exact-exemption case added with `assert.deepEqual(exemptDemand, ["passive"])` and `assert.deepEqual(exemptEta, ["none"])`
- [ ] N2 red-first proof observed: added 4th `DEMAND_STATES` member → test red; reverted → test green
- [ ] T7 (SF-4) composition-parity case added with literal-substring and key-set assertions
- [ ] T7 red-first proof (a) observed: `draining: false` hardcode → test red; reverted; (b) observed: 6th key in one route → test red; reverted
- [ ] SF-9 helper `expectPanelCoreIntact` extracted and verified to take no coverage-specific arguments

### P2 Hygiene (required for false-confidence removal)
- [ ] `coverage-smoke.test.js` existence-only cases deleted (0 `assert.ok(stmts.…)` instances)
- [ ] `coverage-smoke.test.js` new round-trip case added; red-first proof: SQL mutation → test red; reverted
- [ ] `screens.snapshot.test.tsx` shared mock now includes `coverage` and `requestCoverage`
- [ ] `ProjectDetail.test.tsx` behavioral anchor case added; red-first proof: render-gate mutation → test red; reverted
- [ ] `screens.snapshot.test.tsx` new `.snap` entry generated with scoped `-u -t` (not blanket `-u`), read and verified before commit
- [ ] Pre-existing "Project detail" snapshot entry byte-unchanged
- [ ] `qa/decisions.md` exists with dated 2026-08-05 rows for: Trap 7, STRICTMODE-BLIND residual, four deferred cures (with triggers), SF-8 altitudes scope note
- [ ] `npm run test:server` and `npm run test:client` still green (P2 changes don't regress P0/P1)
- [ ] `grep -rn 'assert.ok(true' server/__tests__/` returns **1** (SF-10.2, pre-existing); `grep -rn '|| true' server/__tests__/` returns **0**

### P3 (optional — mark each done or explicitly skipped)
- [ ] If `coverage-request-e2e.test.js` attempted: file created, red-first proof observed (ORDER BY mutation → rotation-jump assertion red), reverted, test passes
- [ ] If T8 attempted: case added or skipped with time-budget reason in qa/decisions.md
- [ ] If WS lifecycle edges attempted: two describe blocks added, all cases green on first write
- [ ] If N1 attempted: characterization case added with WATCH-S2-C trigger comment

### File Headers & Project Policy
- [ ] Any new `.js`/`.tsx` files include the project-required header with `@author Son Nguyen <hoangson091104@gmail.com>` line
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits **0**
- [ ] `cd client && npx tsc --noEmit` clean

### Project-Specific Requirements
- [ ] No pool-membership SQL outside `assembleValuePool` (verified via review)
- [ ] Drain path does NOT read `MAX_PROJECTS_PER_TICK` (verified via grep)
- [ ] Docs updated if wire behavior changed (SF-6 is a wire-behavior change; verify `docs/API.md` / `ARCHITECTURE.md` / `server/README.md` for old `generated > 0`-or-transition rule and update it)
- [ ] AC-6 (scheduling gate on Slice 3) remains unmet and untouched

### Build Report Requirements (per §9.3 and §9.4)
- [ ] P0 red-first proofs recorded per-case (SF-9, SF-8, SF-6 case 1, not case 2)
- [ ] P1 red-first proofs recorded per-case (N2, T7 mutation a and b)
- [ ] P2 red-first proofs recorded (SF-7 SQL mutation, ProjectDetail render-gate mutation)
- [ ] P3 items: done-or-skipped-with-reason recorded in both build report and `qa/decisions.md`
- [ ] §9.4 compliance: every QA finding (SF-8, SF-9, SF-6, SF-4/T7, N2, SF-7) ends in exactly one of two states: (1) fixed with a test, or (2) recorded in qa/decisions.md with an id

---

## Summary

**22 tasks total across 4 priority tiers:**
- **P0 MANDATORY (gate):** 7 tasks (SF-9 test + fix + helper, SF-8 test + fix, SF-6 test + fix + comments, suite verification)
- **P1 MANDATORY (durable cure):** 2 tasks (N2 test + red-proof, T7 test + red-proofs)
- **P2 hygiene + DoD deliverable:** 5 tasks (SF-7 replacement, screens-snapshot mock/anchor/baseline, decisions.md)
- **P3 optional (time-allowing):** 4 tasks (e2e spec, T8 route-level, WS lifecycle edges, N1 characterization) → skip-with-reason if needed

**Sequencing:** Strictly linear P0 → P1 → P2 → (P3 if time). Each red-first proof must be observed and recorded before proceeding. Snapshot baseline generated only after behavioral anchor and mock fix are in place.

**Defect catalog obligations:**
- §9.8 (SF-6): first-observation broadcast rule is tested and observed red
- §9.3 (SF-7, test discipline): existence-only cases removed; red-first mutation proof recorded
- §9.1 (SF-4/T7): route↔route composition parity guarded; red-first proofs recorded
- §9.7 (N2): exact-exemption registry assertion; red-first proof recorded
- §9.4 (fix-round-regression): every QA finding disposed (fixed + test, or decisions.md row)

**Durable-cure approach:** SF-6, SF-8, SF-9 fixes are live defect closures (P0). N2, T7/SF-4, SF-9 helper are structural guards (P1) preventing the *next* instance. Four cures deferred to later slices with dated triggers and consequences (qa/decisions.md).
