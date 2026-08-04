# Red Evidence — F1 & F2 Test Cases

**Date:** 2026-08-03  
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor`  
**Branch:** `effort/2026-08-03-plan-lifecycle-workbench-ui`

## Summary

All 8 new/updated test cases (F1: 7 cases + F2: 1 case) are **RED for the correct reason** — the component and its integration don't exist yet.

- **F1: PlanLedgerPanel.test.tsx** — 7 test cases, all R0 red (module absence)
- **F2: ProjectDetail.test.tsx update** — 1 new test case, functional failure (component not rendered)

---

## F1: `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (NEW, 7 cases)

**File:** `client/src/components/__tests__/PlanLedgerPanel.test.tsx`  
**Layer:** E (client component tests)  
**Run Command:** `npm run test:client 2>&1 | grep -A 10 PlanLedgerPanel`

### Test Case 1: renders 2 open plans with their nested items in the left pane

**Status:** RED (R0)  
**Reason:** Module not found — `PlanLedgerPanel` component does not exist

**Failure Output:**
```
FAIL  src/components/__tests__/PlanLedgerPanel.test.tsx
Error: Failed to resolve import "../PlanLedgerPanel" from 
  "src/components/__tests__/PlanLedgerPanel.test.tsx". Does the file exist?
  Plugin: vite:import-analysis
  File: /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/
       Claude-Code-Agent-Monitor/client/src/components/__tests__/PlanLedgerPanel.test.tsx:18:0
```

**Expected Green Condition:**
- Create `client/src/components/PlanLedgerPanel.tsx`
- Component exports `PlanLedgerPanel` React component
- Component accepts `projectId` prop
- Component renders open plans from mocked API with nested items visible

---

### Test Case 2: pool units render one badge per emitting tier

**Status:** RED (R0)  
**Reason:** Same module absence (test file cannot load)

**Expected Green Condition:**
- Component renders pool units with tier badges
- Badges are labeled by `value_source` (trunk_commit, intake_initiative, merge_commit, detour)
- Badge rendering is derived from `ValueUnit` type union (no new source type without a badge decision fails both typecheck and this case)

---

### Test Case 3: claim gesture calls api.projectPlans.claim and unit disappears

**Status:** RED (R0)  
**Reason:** Same module absence

**Expected Green Condition:**
- Claim button renders for each unit
- Click calls `api.projectPlans.claim(projectId, itemId, unit)` exactly once
- After mocked refetch, unit is removed from pool display

---

### Test Case 4: close calls api.projectPlans.close and plan moves to collapsed closed-generations list

**Status:** RED (R0)  
**Reason:** Same module absence

**Expected Green Condition:**
- Close button renders on open plans
- Click calls `api.projectPlans.close(projectId, planId, {closure_note})`
- Plan disappears from left pane (open plans section)
- Plan appears in collapsed closed history section

---

### Test Case 5: health rendered verbatim from server (37 shown, not pool.length of 5)

**Status:** RED (R0)  
**Reason:** Same module absence

**Expected Green Condition:**
- Mock setup: `health.unclaimedPoolSize = 37`, pool array length = 5
- Display shows **37**, not 5
- Proves no client-side re-derivation (§9.1 DERIVED-DUAL-VIEW guard)
- Red proof (R1 mutation): render `pool.length` as the headline → test fails showing 5

---

### Test Case 6: lastClosureAt null state renders without NaN or Invalid Date

**Status:** RED (R0)  
**Reason:** Same module absence

**Expected Green Condition:**
- Health mock: `lastClosureAt: null, daysSinceLastClosure: null`
- Display renders gracefully (e.g., "—" or "never" or "no closures")
- No `NaN` or `Invalid Date` appears in `container.textContent`

---

### Test Case 7: closed generation exposes no item-edit/claim/unclaim affordances

**Status:** RED (R0)  
**Reason:** Same module absence

**Expected Green Condition:**
- Closed plans render items read-only
- No edit/delete/unclaim buttons on closed items
- Claim gesture not callable against closed plan items
- Close button not present on already-closed plans

---

### Test Case 8: no raw projectDetail.* key leaks into DOM

**Status:** RED (R0)  
**Reason:** Same module absence

**Expected Green Condition:**
- No regex matches `/projectDetail\.[a-zA-Z]/` in DOM text
- No regex matches `/planLedger\.[a-zA-Z]/` in DOM text
- All visible strings are localized via i18n (E1 owns parity)

---

## F2: `client/src/pages/__tests__/ProjectDetail.test.tsx` (UPDATED, 1 case added)

**File:** `client/src/pages/__tests__/ProjectDetail.test.tsx`  
**Layer:** E (client page tests)  
**Test Name:** "renders the PlanLedgerPanel card beside existing cards (F2)"  
**Run Command:** `npm run test:client -- ProjectDetail 2>&1`

### Test Case: renders PlanLedgerPanel card beside existing cards

**Status:** RED (functional failure)  
**Reason:** PlanLedgerPanel component does not exist; ProjectDetail.tsx does not render it

**Failure Output:**
```
TestingLibraryElementError: Unable to find an element with the text: Phase 1: Planning. 
This could be because the text is broken up by multiple elements.
...
Expected: <text matching "Phase 1: Planning">
Actual: (page renders Agent Monitor, repos, intake, etc. — but no PlanLedgerPanel content)
```

**Mock Setup:** (in `beforeEach`)
- `projectPlansListMock.mockResolvedValue({ plans: [...] })`
- `projectPlansPoolMock.mockResolvedValue({ units: [...], identityWarnings: [] })`
- `projectPlansHealthMock.mockResolvedValue({ unclaimedPoolSize, ... })`
- `projectPlansClaimMock`, `projectPlansCloseMock` mocked in shared setup (not per-case)

**Expected Green Condition:**
- ProjectDetail.tsx imports and renders `<PlanLedgerPanel projectId={projectId} />`
- Mock setup in beforeEach applies to all ProjectDetail test cases (not duplicated per-case)
- Plan title "Phase 1: Planning" appears in DOM
- Test passes alongside all 15 existing ProjectDetail cases (no regression)

---

## Sanity Check

✓ **Tests fail on assertion, not setup:**
  - PlanLedgerPanel.test.tsx fails at import (R0: expected)
  - ProjectDetail.test.tsx F2 fails at `waitFor(() => screen.getByText(...))`  (functional: expected)

✓ **Mocks are real shapes:**
  - Mocks use actual API response shapes from `server/routes/project-plans.js`
  - No vacuous placeholders like `assert.ok(true)`

✓ **No product code changes:**
  - Only test files written
  - No changes to components, types, or API layer

✓ **Red is actionable:**
  - Component needs to be created
  - Types need to be defined
  - API functions need to be added to mock in api.ts
  - ProjectDetail needs to render the panel

---

## Test Execution Details

**Command Run:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
npm run test:client
```

**Key Output Lines:**
```
 FAIL  src/components/__tests__/PlanLedgerPanel.test.tsx
Error: Failed to resolve import "../PlanLedgerPanel"

 FAIL  src/pages/__tests__/ProjectDetail.test.tsx > ProjectDetail page > renders the PlanLedgerPanel card beside existing cards (F2)
TestingLibraryElementError: Unable to find an element with the text: Phase 1: Planning

Test Files  2 failed | 58 passed
Tests  1 failed | 773 passed
```

---

## Next Steps (for implementer)

1. **Create `client/src/components/PlanLedgerPanel.tsx`**
   - Export `PlanLedgerPanel` component accepting `projectId` prop
   - Left pane: open plans with nested items, close button
   - Right pane: pool with tier badges, claim gesture
   - Collapsed closed history section
   - Render health numbers verbatim (no client-side re-derivation)

2. **Add ProjectPlan, ValueUnit, PlanHealth, ValuePool types to `client/src/lib/types.ts`**
   - F1 tests import these implicitly via the component

3. **Update `client/src/pages/ProjectDetail.tsx`**
   - Import and render `<PlanLedgerPanel projectId={projectId} />`
   - Card rendered alongside existing sections (repos, intake, etc.)

4. **Run test to green:**
   - F1: all 7 cases
   - F2: existing 15 cases stay green, new case turns green
   - All pool/health/claim/close mocks exercised
   - No `NaN`/`Invalid Date` in text
   - Health numbers match mocked verbatim (37 ≠ pool.length)

