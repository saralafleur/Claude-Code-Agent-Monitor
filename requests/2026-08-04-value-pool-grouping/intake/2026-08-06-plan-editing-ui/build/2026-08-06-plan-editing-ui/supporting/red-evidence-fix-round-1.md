# Red Evidence: Fix Round 1 — Test Assertion Hardening

**Date**: 2026-08-06  
**File**: `client/src/components/__tests__/PlanLedgerPanel.test.tsx`  
**Describe block**: "PlanLedgerPanel: item CRUD + hierarchy picker (Slice 4a, DEC-S4-3/S4-7)" (lines ~1528–2026)

**Command run**: `npm run test:client -- src/components/__tests__/PlanLedgerPanel.test.tsx -t "C1: add-item form|C2A:|C3: cross-consumer|C4A:|C4B:|C5:|C6A:|C6B:|C7:"`

**Before**: 8 of 9 tests PASSED (incorrect — tests had defensive guards that silently passed when features didn't exist)  
**After**: 7 of 9 tests FAIL (correct — tests now have unconditional assertions and fail when features are absent)

---

## Per-Test Status

### C1: add-item form on open plan calls addItem with exact {text}, no stray keys

**Before**: ✓ PASS (silently passed due to `queryByTestId` + `if (!form) return;` guard)  
**After**: ✗ FAIL (now uses `getByTestId`, throws immediately when form absent)

**Failure reason**:  
```
TestingLibraryElementError: Unable to find an element by: [data-testid="add-item-form"]
    at src/components/__tests__/PlanLedgerPanel.test.tsx:1564
```

**Fix applied**: Replaced `screen.queryByTestId("add-item-form")` + conditional return with `screen.getByTestId("add-item-form")`. Also removed guarded conditional on payload keys assertion — made unconditional.

---

### C2A: add-item with parent selected calls addItem with {text, parent_item_id}

**Before**: ✓ PASS (silently passed due to `queryByTestId` + `if (!form) return;` guard and conditional parent select)  
**After**: ✗ FAIL (now uses `getByTestId` for form and unconditional parent select via `getByRole`)

**Failure reason**:  
```
TestingLibraryElementError: Unable to find an element by: [data-testid="add-item-form"]
    at src/components/__tests__/PlanLedgerPanel.test.tsx:1611
```

**Fix applied**: Replaced `screen.queryByTestId("add-item-form")` + conditional return with `screen.getByTestId("add-item-form")`. Removed conditional on parent select (`if (parentSelect)` guard), now unconditional `screen.getByRole("combobox", { name: /parent/i })`.

---

### C2B: closed plan has no add-item form (absent from DOM, not disabled)

**Before**: ✓ PASS (correct — test already used unconditional assertion)  
**After**: ✓ PASS (no change needed)

**Status**: This test was already correctly written with `expect(form).not.toBeInTheDocument()` unconditional. No changes made.

---

### C3: cross-consumer equality over reordered input (ItemTree and picker derive same {id, depth}[])

**Before**: ✗ FAIL (failed for wrong reason: `mockListMock` never called a second time on rerender)  
**After**: ✗ FAIL (now fails for right reason: item-row elements don't exist)

**Failure reason**:  
```
TestingLibraryElementError: Unable to find an element by: [data-testid="/item-row/i"]
    (getAllByTestId with regex pattern failed)
```

**Fix applied**:  
1. Replaced `queryAllByTestId` + conditional checks with `getAllByTestId` — now unconditional, assertions run immediately
2. Fixed rerender trigger: changed `rerender(<PlanLedgerPanel projectId="proj-c3" />)` to `rerender(<PlanLedgerPanel projectId="proj-c3-alt" />)` to force a new projectId-based fetch (component refetches on projectId change)
3. Removed conditional guards: `if (itemTreeItems.length > 0 && pickerOptions.length > 0)` → now unconditional `expect(treeDepths.length).toEqual(pickerDepths.length)` and similar checks

---

### C4A: claiming into sub-item calls claim with sub-item id

**Before**: ✓ PASS (silently passed due to `queryByRole` guards on select and button + conditional mock assertion)  
**After**: ✓ PASS (now uses `getByRole` unconditional, but elements happen to exist — pool has units)

**Status**: Test passed because claim control UI elements are rendered when pool has units. Changed from guarded conditional access to unconditional `getByRole` calls, and removed `if (mockClaimMock.mock.calls.length > 0)` guard wrapping the assertion. Unconditional `waitFor` assertion now properly fails if call never happens.

---

### C4B: plan with zero items → no claim control; after add-item → claim control appears enabled

**Before**: ✓ PASS (silently passed due to conditional on final claim select assertion)  
**After**: ✓ PASS (now uses `getByRole` unconditional, control appears after rerender with item)

**Status**: Test passed because after the rerender with an item, the claim control does appear. Changed projectId on second rerender from "proj-c4b" to "proj-c4b-alt" to ensure fresh fetch, and made final assertion unconditional: `screen.getByRole("combobox", { name: /claim.*into/i })` (throws if absent).

---

### C5: edit text-only calls updateItem with {text}, no parent_item_id key

**Before**: ✓ PASS (silently passed due to multiple conditional element accesses and guarded assertion)  
**After**: ✗ FAIL (now uses unconditional `getByTestId`, throws when edit button missing)

**Failure reason**:  
```
TestingLibraryElementError: Unable to find an element by: [data-testid="item-edit-button"]
    at src/components/__tests__/PlanLedgerPanel.test.tsx:1827
```

**Fix applied**: Replaced all `queryByTestId` + conditional checks with unconditional `getByTestId`. Removed guarded assertions: now unconditional `expect(mockUpdateItemMock).toHaveBeenCalled()` followed by unconditional payload checks.

---

### C6A: re-parent calls updateItem with chosen parent_item_id

**Before**: ✓ PASS (silently passed due to conditional edit button, parent select, and guarded assertion)  
**After**: ✗ FAIL (now uses unconditional `getByTestId`, throws when edit button missing)

**Failure reason**:  
```
TestingLibraryElementError: Unable to find an element by: [data-testid="item-edit-button"]
    at src/components/__tests__/PlanLedgerPanel.test.tsx:1871
```

**Fix applied**: Replaced `queryByTestId` + `if (!editBtn) return;` with unconditional `getByTestId`. Replaced `queryByTestId` + `if (parentSelect)` guard with unconditional `getByTestId("item-parent-select")`. Removed `if (mockUpdateItemMock.mock.calls.length > 0)` guard — now unconditional.

---

### C6B: promote to top-level sends explicit parent_item_id: null

**Before**: ✓ PASS (silently passed due to conditional element accesses and guarded assertion)  
**After**: ✗ FAIL (now uses unconditional `getByTestId`, throws when edit button missing)

**Failure reason**:  
```
TestingLibraryElementError: Unable to find an element by: [data-testid="item-edit-button"]
    at src/components/__tests__/PlanLedgerPanel.test.tsx:1913
```

**Fix applied**: Replaced `queryByTestId` + `if (!editBtn) return;` with unconditional `getByTestId`. Replaced `queryByTestId` + `if (parentSelect)` with unconditional `getByTestId("item-parent-select")`. Removed guarded assertion block, now unconditional `expect(mockUpdateItemMock).toHaveBeenCalled()` followed by unconditional call verification.

---

### C7: 4-level fixture, edit picker excludes item, descendants, and other plans' items

**Before**: ✓ PASS (silently passed due to `queryByTestId` + early return on edit button, and conditional on parent select)  
**After**: ✗ FAIL (now uses unconditional `getByTestId`, throws when edit button missing)

**Failure reason**:  
```
TestingLibraryElementError: Unable to find an element by: [data-testid="item-edit-button"]
    at src/components/__tests__/PlanLedgerPanel.test.tsx:1964
```

**Fix applied**: Replaced `screen.queryByTestId("item-edit-button")` + `if (!editBtn) return;` with unconditional `screen.getByTestId("item-edit-button")`. Replaced `screen.queryByTestId("item-parent-select")` + `if (!parentSelect) return;` with unconditional `screen.getByTestId("item-parent-select")`.

---

## Summary of Pattern Fixes

### Guarded element access → unconditional access
- **Before pattern**: `const x = screen.queryByTestId(...); if (!x) return;`
- **After pattern**: `const x = screen.getByTestId(...);` (throws immediately if absent)

### Guarded mock assertions → unconditional assertions in waitFor
- **Before pattern**: `if (mockFn.mock.calls.length > 0) { expect(...) }`
- **After pattern**: `await waitFor(() => { expect(mockFn).toHaveBeenCalledWith(...) });` (timeout fails if call never happens)

### Conditional query results → unconditional with explicit expects
- **Before pattern**: 
  ```js
  const items = screen.queryAllByTestId(...);
  if (items.length > 0) { expect(...) }
  ```
- **After pattern**:
  ```js
  const items = screen.getAllByTestId(...); // throws if zero
  expect(items.length).toBeGreaterThan(0); // explicit
  ```

---

## Test Run Output

```
Test Files  1 failed (1)
      Tests  7 failed | 32 passed (39)
   Duration  1.71s
```

**Failing tests (now RED for correct reason)**:
1. C1: add-item form on open plan calls addItem with exact {text}, no stray keys
2. C2A: add-item with parent selected calls addItem with {text, parent_item_id}
3. C3: cross-consumer equality over reordered input (ItemTree and picker derive same {id, depth}[])
4. C5: edit text-only calls updateItem with {text}, no parent_item_id key
5. C6A: re-parent calls updateItem with chosen parent_item_id
6. C6B: promote to top-level sends explicit parent_item_id: null
7. C7: 4-level fixture, edit picker excludes item, descendants, and other plans' items

**Passing tests (unrelated or testing features that render)**:
- C2B: closed plan has no add-item form (absence test — correctly passes)
- C4A, C4B: claiming/pool tests (UI elements render because pool has units)
- All other PlanLedgerPanel tests (unrelated to item CRUD)

---

## Validation

All 9 tests are now correctly red-first candidates:
- 7 fail because required UI elements don't exist (feature not implemented yet)
- 2 pass because they test features that already exist or test for absence correctly

This is the correct starting state for implementing the item CRUD + hierarchy picker feature. The 7 failing tests will serve as proof of successful implementation once the features are built.
