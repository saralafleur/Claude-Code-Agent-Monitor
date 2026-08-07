# Build Task List — Value Pool Slice 4, Phase 4a

**Effort:** `2026-08-06-plan-editing-ui`  
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-plan-editing-ui/Claude-Code-Agent-Monitor`  
**Branch:** `effort/2026-08-06-plan-editing-ui` (off `master` @ `d3842493`)  
**Build mode:** sequential, one implementer  
**Test-first discipline:** red-first throughout; D4's red observed by second person

---

## Task 1 — MANDATORY: Apply catalog patches and reconcile decisions (doc-ordering obligation)

**Type:** Implementation + documentation  
**Files (worktree-relative):**
- `PROJECT-CONTEXT.md` (target for patches)
- `catalog-patch.md` (source; delete after apply)
- `catalog-patch-qa.md` (source; delete after apply)
- `decisions.md` (reconcile addenda into this)
- `decisions-tech-lead-addendum.md` (fold into decisions.md)
- `decisions-qa-addendum.md` (fold into decisions.md)
- `requests/2026-08-04-value-pool-grouping/request.md` (append `## Corrections`)

**What changes:**
1. Apply `catalog-patch.md` Edit 1–3 to `PROJECT-CONTEXT.md` §9.3 (NAME-OVERCLAIMING GUARD sub-shape)
2. Apply `catalog-patch-qa.md` Edit 1–3 (promote sub-shape to new §9.9, cross-ref in §9.7)
3. Delete both patch files in the same commit
4. Fold `decisions-tech-lead-addendum.md` three rows (DEC-S4-7, WATCH-S4-F/G) into `decisions.md`
5. Fold `decisions-qa-addendum.md` four rows (DEC-S4-8/9/10, WATCH-S4-H) into `decisions.md`
6. Append dated `## Corrections` section to parent `request.md` per DEC-S4-5: two falsified premises (stale "OPEN-4" bullet; "atomic inline `new_item` already supports the shape")

**Catalog references (MANDATORY durable-cure gates):**
- §9.3/§9.9 NAME-OVERCLAIMING GUARD (DEC-S4-2)
- §9.1 DERIVED-DUAL-VIEW (pre-flag; §9.3/§9.9 sub-shape for existing vs. new detection)
- §9.7 HAND-SCOPED STRUCTURAL SCAN (DEC-S4-8 — pre-flag; cure built in Task 9)
- §9.8 OVERLOADED-ABSENCE (DEC-S4-7 — pre-flag; cycle guard built in Tasks 6–7)

**Done-check:**
```bash
# Verify exactly one catalog exists and it has the right sections
grep -c "^### 9.9 NAME-OVERCLAIMING GUARD" PROJECT-CONTEXT.md
# Expected: 1

# Verify both patch files are gone
ls -la catalog-patch.md catalog-patch-qa.md
# Expected: no such file

# Verify decisions are reconciled (no separate addenda files in worktree root)
ls -la decisions-tech-lead-addendum.md decisions-qa-addendum.md
# Expected: no such file (or they live in the request folder, not worktree root)

# Verify request.md has the Corrections section
grep -A 5 "^## Corrections" ../../request.md
# Expected: finds dated append
```

---

## Task 2 — MANDATORY: RED-FIRST — Rewrite D4 (NAME-OVERCLAIMING GUARD, §9.9)

**Type:** Test step (RED-FIRST)  
**Files (worktree-relative):**
- `server/__tests__/project-plans-api.test.js` (Group D)

**What changes:**
- **Replace** lines 494–523 (entire old D4 case) with new D4: valid `new_item` + invalid `value_source` → 400, item count unchanged
- Rename existing passing case to `D4-happy` (kept verbatim)
- Move old empty-text case to separate `D4-empty-text` with honest comment: "exercises insertProjectPlanItem's input guard, not atomicity"
- Add `D4b` case (documentation-only comment): duplicate on pre-existing item → 409, comment: "reuses D2's shape; red-proves nothing D2 does not; never cite as atomicity proof"

**Layer/component:** Server test — route/HTTP (e2e)

**Red-first precondition:**
- On `master` unmodified, D4 must fail because the handler inserts the item **before** validating `value_source`
- Item survives a 400 INVALID_INPUT response
- Exact failure message must appear in the build log (AGENT-SELF-REPORTED-RED per §9.3)

**Done-check:**
```bash
# Observe D4 failing against unmodified master before any product change
git stash
npm run test:server 2>&1 | grep -A 10 "D4 —"
# Expected: test fails with assertion that item count increased

# Unstash and note the exact failure output for the build log
```

**Binding constraint:**
- This red must be observed **by someone other than the author of Task 3** (the composer fix)
- Paste the actual failure text (with timestamps, assertion details) into the build log, not a description

---

## Task 3 — Extract `claimUnitIntoItem` composer into `plan-lifecycle.js`

**Type:** Implementation  
**Files (worktree-relative):**
- `server/lib/plan-lifecycle.js` (new export, extend header)
- `server/__tests__/project-plans-api.test.js` (Task 2's D4 should go GREEN here)

**What changes:**
1. New export `claimUnitIntoItem(dbModule, planId, body)` — the SOLE writer of `value_claims`
   - Validate `value_source`/`attribution`/`value_ref` **first** (BEFORE any write) — this reordering is required by DEC-S4-2
   - Open `dbModule.db.transaction(() => { … })` inside it
   - Resolve/create item; call `insertValueClaim.run(...)` inside transaction
   - Catch `UNIQUE` violation **outside the transaction callback** (critical: catch outside, not inside, else orphan item commits)
   - Convert to `domainError("DUPLICATE_CLAIM", …)`
2. Update file header to cite `claimUnitIntoItem` as sole `value_claims` writer
3. Export alongside existing item CRUD

**Layer/component:** Server domain — `plan-lifecycle.js`

**Done-check:**
```bash
# D4 (Task 2's rewritten red-first test) must now go GREEN
npm run test:server 2>&1 | grep -A 3 "D4 —"
# Expected: ✓ D4 (or equivalent pass marker)

# Every pre-existing Group D test must still pass unmodified
npm run test:server 2>&1 | grep "Group D"
# Expected: all tests pass, no test file edits needed
```

---

## Task 4 — Reduce `POST /:id/claims` route to a delegator

**Type:** Implementation  
**Files (worktree-relative):**
- `server/routes/project-plans.js` (lines 482–574)

**What changes:**
- Route body becomes:
  ```js
  const result = planLifecycle.claimUnitIntoItem(dbModule, Number(req.params.id), req.body || {});
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  broadcast("value_claim_updated", { claim: result });
  res.status(201).json({ claim: result });
  ```
- `broadcast` fires **after** transaction returns, never inside it
- Remove imports (`VALUE_SOURCES`, `ATTRIBUTION_TIERS`, `cwdIdentity`) only if no other handler in file uses them (grep before deleting)

**Layer/component:** Server routing

**Done-check:**
```bash
# Byte-identical string check: these six strings must not change
strings_check=(
  "no such plan"
  "plan is closed"
  "item_id or new_item is required"
  "item_id does not belong to this plan"
  "this unit is already claimed into this item"
)

for str in "${strings_check[@]}"; do
  grep -n "$str" server/routes/project-plans.js || echo "MISSING: $str"
done
# Expected: all six found

# Every pre-existing claims test still passes unmodified (AC-13)
npm run test:server 2>&1 | grep "Group D"
# Expected: all pass
```

---

## Task 5 — MANDATORY: RED-PROVEN MUTATION — Verify atomicity fix by removing transaction wrapper

**Type:** Test verification (mutation-proof)  
**Files (worktree-relative):**
- `server/lib/plan-lifecycle.js` (temporarily remove transaction wrapper)
- `server/__tests__/project-plans-api.test.js` (watch D4 fail)
- `server/__tests__/plan-lifecycle.test.js` (watch PX fail — does not exist yet, write it first)

**What changes:**
- Write `PX` test stub in `plan-lifecycle.test.js` (may be red on missing export; that's expected)
- In `claimUnitIntoItem`, **remove** the `dbModule.db.transaction(...)` wrapper around the entire composer body
- Verify D4 goes red again: item orphan survives the 400
- Verify PX goes red: forced throw leaves item behind (uncomment or restore stub throw once composer exists)
- **Restore byte-identical** `dbModule.db.transaction(...)`
- Both should go green

**Layer/component:** Server — domain-unit test

**Red-first observation:**
- **D4**: orphan item count increases (same as Task 2's initial red)
- **PX**: forced `insertValueClaim.run` throw leaves item row in database

**Binding constraint:**
- This mutation proof must be **performed by someone other than the author of Tasks 3–4**
- Paste both observed failure outputs into the build log (not descriptions)

**Done-check:**
```bash
# Red state 1 (remove transaction)
sed -i 's/dbModule\.db\.transaction(/dbModule.db.transactionOFFICE(/' server/lib/plan-lifecycle.js
npm run test:server 2>&1 | tee /tmp/mutation-red-1.log | grep -A 5 "D4 —"
# Expected: D4 fails (orphan survives)

# Red state 2 (if PX stub exists and throws)
npm run test:server 2>&1 | tee /tmp/mutation-red-2.log | grep -A 5 "PX"
# Expected: PX fails (item not rolled back)

# Restore
sed -i 's/dbModule\.db\.transactionOFFICE(/dbModule.db.transaction(/' server/lib/plan-lifecycle.js

# Green state
npm run test:server 2>&1 | grep -E "D4|PX"
# Expected: both pass

# Append both failure outputs to build log
cat /tmp/mutation-red-1.log /tmp/mutation-red-2.log >> build-log.txt
```

---

## Task 6 — Add `reparentProjectPlanItem` prepared statement

**Type:** Implementation  
**Files (worktree-relative):**
- `server/db.js` (new statement, adjacent to `updateProjectPlanItem`)

**What changes:**
- New statement adjacent to line 3349:
  ```js
  reparentProjectPlanItem: db.prepare(
    `UPDATE project_plan_items SET
       parent_item_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ),
  ```
- No schema change, no migration

**Layer/component:** Server database

**Done-check:**
```bash
# Server boots without error
npm run dev > /dev/null 2>&1 &
sleep 2
curl -s http://localhost:5001/health || echo "server failed to boot"
kill %1 2>/dev/null

# test:server still green (all existing tests still pass)
npm run test:server 2>&1 | tail -3
# Expected: pass summary
```

---

## Task 7 — MANDATORY: Extend `updateProjectPlanItem` with re-parent validation and cycle guard (§9.8)

**Type:** Implementation  
**Files (worktree-relative):**
- `server/lib/plan-lifecycle.js` (function `updateProjectPlanItem`)

**What changes:**
1. Add `Object.hasOwn(patch, "parent_item_id")` intent detection (NOT `patch.parent_item_id != null`)
2. When present and non-null, validate in order (each returns `INVALID_INPUT`):
   - `parent_item_id !== itemId` — "an item cannot be its own parent"
   - Parent exists (via `getProjectPlanItem`) — "parent_item_id does not exist"
   - `parent.plan_id === item.plan_id` — "parent_item_id belongs to a different plan"
   - No cycle: walk `parent_item_id` upward from proposed parent; if `itemId` found, reject — "parent_item_id would create a cycle". Bound walk by plan item count.
3. When present and valid, call `dbModule.stmts.reparentProjectPlanItem.run(parentItemId ?? null, itemId)` inside the existing transaction
4. Return shape unchanged (refreshed row or domain error)

**Layer/component:** Server domain — cycle guard (MANDATORY §9.8)

**Intermediate red states to observe (before cycle check is added):**
- P1/P2 fail initially (placement silently unchanged, no validation exists)
- P4/P5/P6 fail with no cycle validation yet
- P3 must pass (regression pin: absent key leaves placement unchanged)

**Done-check:**
```bash
# New cases P1-P7, P3-mirror green (at least the ones that should be)
npm run test:server 2>&1 | grep -E "P[0-7]|P3-mirror"
# Expected: P3 green, others green or with specific anticipated failures

# Every pre-existing plan-lifecycle case still passes unmodified
npm run test:server 2>&1 | grep -c "pre-existing" || echo "baseline regression check"
```

---

## Task 8 — Write `server/__tests__/helpers/table-writers.js` (derived guard helper)

**Type:** Test helper + MANDATORY durable-cure helper (§9.7 — first built instance)  
**Files (worktree-relative):**
- `server/__tests__/helpers/table-writers.js` (NEW file, requires file header)

**What changes:**
- New file: `assertTableWritersSingleHome(tableName, { statementHomes, inlineWriterDispositions })`
- **Five checks, all derived (no hand-typed input except reviewed home list):**
  1. Parse `server/db.js` `stmts { … }` region by brace-walk; assert parser-completeness (parsed count == `db.prepare(` count inside region)
  2. Derive writer set: SQL matching `/\b(INSERT INTO|UPDATE|DELETE FROM)\s+<table>\b/i`; assert non-empty
  3. Registry completeness: `Object.keys(statementHomes).sort()` must equal derived writer names, sorted
  4. Identity check (NOT arity): for each writer, derive file set, find `name\s*\.\s*run\s*\(` calls, resolve enclosing function by brace-walk, assert against expected `{file, anchor}` homes by **function name**, not count
  5. Inline-write axis: scan `server/**/*.js` (except `db.js`, `__tests__`) for `.prepare(` string literals writing `<table>`, each hit's `{file, anchor}` in `inlineWriterDispositions` with `dated` + `reason`

- File must carry file header per `.claude/rules/file-headers.md` with exact `@author Son Nguyen <hoangson091104@gmail.com>` line

**Layer/component:** Server test — structural guard helper

**Done-check:**
```bash
# File exists with header
head -5 server/__tests__/helpers/table-writers.js | grep "@author Son Nguyen"
# Expected: header present

# bash check-headers.sh includes it
bash .claude/skills/file-headers/scripts/check-headers.sh
# Expected: exits 0
```

---

## Task 9 — RED-FIRST: Write G-2 (value_claims single-writer guard)

**Type:** Test step (RED-FIRST)  
**Files (worktree-relative):**
- `server/__tests__/single-writer-guard.test.js`

**What changes:**
- **G-2** (new case): `assertTableWritersSingleHome("value_claims", …)` with:
  - `insertValueClaim` → `[{file: "lib/plan-lifecycle.js", anchor: "function claimUnitIntoItem"}]`
  - `deleteValueClaim` → `[{file: "routes/project-plans.js", anchor: "router.delete(\"/claims/:claimId", dated: "2026-08-06", reason: "unclaim path not yet extracted into composer; 4b's batch unclaim must extract rather than add second call site (WATCH-S4-J)"}]`
  - No inline writers expected (empty set)

**Red-first precondition:**
- On `master` unmodified (before Task 3), `insertValueClaim.run(` lives in `routes/project-plans.js:549`, not in `claimUnitIntoItem`
- Guard fails: enclosing function is `router.post("/claims/...)`, not `claimUnitIntoItem`

**Layer/component:** Server test — structural guard

**Done-check:**
```bash
# Before Task 3 complete, G-2 red (composer does not exist)
git stash
npm run test:server 2>&1 | grep -A 5 "G-2"
# Expected: fails (insertValueClaim not in expected home)

# After Task 3, G-2 green
git stash pop
npm run test:server 2>&1 | grep -A 2 "G-2"
# Expected: ✓ G-2 passes
```

---

## Task 10 — RED-FIRST: Write G-1 (project_plan_items multi-writer guard with inline-write axis)

**Type:** Test step (RED-FIRST + mutation-proofs MANDATORY)  
**Files (worktree-relative):**
- `server/__tests__/single-writer-guard.test.js`

**What changes:**
- **G-1** (new case): `assertTableWritersSingleHome("project_plan_items", …)` with:
  - `insertProjectPlanItem` → `[{file: "lib/plan-lifecycle.js", anchor: "function insertProjectPlanItem"}, {file: "lib/plan-lifecycle.js", anchor: "const doImport =", dated: "2026-08-06", reason: "legacy AGENT-PLAN.md two-pass import — insert-all-then-resolve-nesting structurally incompatible with single-pass signature; unrelated to 4a"}]`
  - `updateProjectPlanItem` → `[{file: "lib/plan-lifecycle.js", anchor: "function updateProjectPlanItem"}]`
  - `deleteProjectPlanItem` → `[{file: "lib/plan-lifecycle.js", anchor: "function deleteProjectPlanItem"}]`
  - `reparentProjectPlanItem` → `[{file: "lib/plan-lifecycle.js", anchor: "function updateProjectPlanItem"}]` (new, added by Task 7)
  - `inlineWriterDispositions`: **one entry** — `plan-lifecycle.js:288-290`, `UPDATE project_plan_items SET parent_item_id = ?` inside `doImport`, dated "2026-08-06", reason "legacy import's second pass; route through `reparentProjectPlanItem` when import path next touched (WATCH-S4-I)"

- Standing comment above both lists: *never widen this list silently to make a real new violation go away*

**Red-first precondition:**
- On `master` unmodified (before Task 6–7), `reparentProjectPlanItem` does not exist; guard is red for undispositioned writer once it's added
- OR: the inline-write check finds the `plan-lifecycle.js:288-290` writer and fails (not in dispositions)

**Mutation proofs (MANDATORY, all three observed red):**
1. Add throwaway `insertProjectPlanItem.run(...)` call in a new test-scoped enclosing function → identity check red; revert
2. Add throwaway `db.prepare("DELETE FROM project_plan_items WHERE id = ?")` inline call in `server/lib/plan-lifecycle.js` → inline-write axis red; revert
3. Add throwaway `zzzTestWriter: db.prepare("UPDATE project_plan_items SET position = ?")` to `db.js` stmts → registry-completeness red; revert

**Layer/component:** Server test — structural guard (MANDATORY §9.7)

**Done-check:**
```bash
# G-1 green with all three mutation proofs observed
npm run test:server 2>&1 | grep "G-1"
# Expected: ✓ G-1 passes

# Build log includes all three mutation-red outputs
grep -c "inline-write\|identity check\|registry-completeness" build-log.txt || echo "mutation proofs must be logged"
```

---

## Task 11 — RED-FIRST: Write PX (atomicity forced-throw composer proof)

**Type:** Test step (RED-FIRST, §9.3 second proof)  
**Files (worktree-relative):**
- `server/__tests__/plan-lifecycle.test.js`

**What changes:**
- **PX** (new case in same `describe()` block as P1–P7):
  - Call `claimUnitIntoItem` with valid `new_item` and valid claim fields
  - Replace `dbModule.stmts.insertValueClaim.run` with a one-shot thrower (using `vi.spyOn` or equivalent), **restored in `finally`**
  - Assert thrown error propagates (not swallowed into domain error per §3.2 step 4's catch-outside rule)
  - Assert **no** `project_plan_items` row with the submitted text exists afterwards (transaction rolled back)

**Red-first:**
- Without transaction wrapper (from Task 5's mutation proof), item row remains after throw
- With transaction wrapper (after Task 3), row is gone

**Layer/component:** Server test — domain-unit (atomicity, §9.3)

**Done-check:**
```bash
# PX red observed (Task 5 already showed this)
# PX green after Task 3
npm run test:server 2>&1 | grep -A 2 "PX"
# Expected: ✓ PX passes
```

---

## Task 12 — Write P1–P7, P3-mirror, PA (re-parent validation cases)

**Type:** Test step  
**Files (worktree-relative):**
- `server/__tests__/plan-lifecycle.test.js`

**What changes:**
- New `describe("re-parent + claim composer (Slice 4a, DEC-S4-7/DEC-S4-2)")` block with:
  - **P1**: re-parent top-level under another → `parent_item_id` set
  - **P2**: promote sub-item to top-level via `parent_item_id: null` → becomes `null` (COALESCE cannot express this)
  - **P3**: omitting `parent_item_id` key leaves placement unchanged while `text` edit applies (regression pin)
  - **P3-mirror**: placement-only edit (no `text` key) leaves text unchanged (regression pin)
  - **P4**: self-parent → `INVALID_INPUT`, row unchanged
  - **P5** (depth ≥ 4 fixture — MANDATORY §9.8): 4-row chain G→H→I→J; re-parent G under J → `INVALID_INPUT` "cycle", G unchanged
  - **P5b**: corrupt self-referencing row written via raw statement; re-parenting unrelated item in same plan returns quickly (walk bounded)
  - **P6**: parent in different plan → `INVALID_INPUT`, row unchanged
  - **P7**: re-parent on closed plan → `ALREADY_CLOSED`
  - **PA**: combined text + placement change, self-parent (rejected) → both unchanged

**Layer/component:** Server test — domain-unit

**Done-check:**
```bash
# All P cases pass
npm run test:server 2>&1 | grep -E "P[0-7]|P3-mirror|PA"
# Expected: all green

# Depth ≥ 4 confirmed (grep fixture)
grep -A 10 "P5" server/__tests__/plan-lifecycle.test.js | grep -E "4|four|chain"
# Expected: fixture shows depth 4
```

---

## Task 13 — Write A2.20 and PZ characterization cases

**Type:** Test step  
**Files (worktree-relative):**
- `server/__tests__/plan-lifecycle.test.js`

**What changes:**
- **A2.20** (wire contract, moved from e2e to unit level): after re-parenting C under B within same plan, `claimUnitIntoItem(db, planId, {item_id: C.id, …})` succeeds; same call against different plan returns "item_id does not belong to this plan"
- **PZ** (characterization pin, NOT endorsement): `deleteProjectPlanItem` on item with child throws `SQLITE_CONSTRAINT_FOREIGNKEY`; on item with claim throws same. Comment: *characterization of today's behavior, not endorsement; rewrite when cascade rule decided (WATCH-S4-F)*

**Layer/component:** Server test — domain-unit

**Done-check:**
```bash
# A2.20 green, PZ green (or appropriately marked as characterization)
npm run test:server 2>&1 | grep -E "A2.20|PZ"
# Expected: both pass
```

---

## Task 14 — RED-FIRST: Write client test cases C1–C7

**Type:** Test step (RED-FIRST)  
**Files (worktree-relative):**
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx`

**What changes:**
- New `describe("PlanLedgerPanel: item CRUD + hierarchy picker (Slice 4a, DEC-S4-3/S4-7)")` block:
  - **C1**: add-item form on open plan → `addItem(planId, {text})` exact match, no stray keys
  - **C2A**: with parent selected → `addItem` with `parent_item_id`; exact object match
  - **C2B**: closed plan has no add-item form (data-test absent from DOM, not disabled)
  - **C3** (MANDATORY §9.1 cross-consumer equality, AC-10): 3-level fixture R→Citem→Gitem + R2; derive `{id, depth}[]` **independently** from ItemTree render and from picker `<option>` indentation; assert equal, then re-render with reordered items array, assert **both** unchanged and still equal (not `deepEqual(f(X), f(X))`)
  - **C4A**: claiming into sub-item → `claim(projectId, subItem.id, unit)`
  - **C4B**: plan with zero items → no claim control; add first item via form (same render, no remount) → claim control appears enabled
  - **C5**: edit text-only → `updateItem(id, {text})` with **no `parent_item_id` key** (tripwire against default object)
  - **C6A**: re-parent → `updateItem` with chosen `parent_item_id`, exact object
  - **C6B**: promote-to-top-level sends explicit `parent_item_id: null` (NOT omitted)
  - **C7** (4-level fixture, MANDATORY §9.8): R→Citem→Gitem→Hitem + R2 + plan B with X; edit Citem parent picker omits: Citem, Gitem, **Hitem (grandchild)**, X (other plan); includes R, R2, top-level sentinel

**Red-first:**
- C1/C2 fail on missing `data-test="add-item-form"`
- C3 fails parsing non-existent indentation; reorder fails because single derivation
- C4B fails (stale target)
- C5/C6/C7 fail on missing edit UI

**Layer/component:** Client test — component (Vitest + RTL)

**Done-check:**
```bash
# All C cases pass (after Task 15–18 add UI)
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx 2>&1 | grep -E "C[0-7]"
# Expected: all green

# Existing claim test still passes unmodified
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "calls api.projectPlans.claim"
# Expected: ✓ passes
```

---

## Task 15 — Client: add `flattenItemTree` projection and rebuild `openItems`

**Type:** Implementation  
**Files (worktree-relative):**
- `client/src/components/PlanLedgerPanel.tsx`

**What changes:**
1. New pure projection immediately below `buildItemTree` (line 266):
   ```ts
   function flattenItemTree(nodes: ItemNode[], depth = 0): Array<{ node: ItemNode; depth: number }>
   ```
   - Takes `ItemNode[]` (not `ProjectPlanItem[]`) — type makes second tree-builder impossible (§9.1)
2. Rebuild `openItems` (line 972) from flattened tree:
   ```ts
   const openItems = openPlans.flatMap((p) =>
     flattenItemTree(buildItemTree(p.items)).map(({ node, depth }) => ({
       id: node.id, text: node.text, depth, planId: p.plan.id,
     }))
   );
   ```
3. Widen `ValueUnitRow.openItems` prop type for new `depth` field

**Layer/component:** Client component — hierarchy projection (no visual change yet)

**Done-check:**
```bash
# Existing PlanLedgerPanel tests still pass unmodified
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "existing"
# Expected: ✓ baseline regression
```

---

## Task 16 — Client: indent claim `<select>` + fix stale target

**Type:** Implementation  
**Files (worktree-relative):**
- `client/src/components/PlanLedgerPanel.tsx`

**What changes:**
1. Claim-target `<select>` (lines 572–583): render each option with depth-proportional indentation (e.g. `"  ".repeat(depth) + "└ "` for `depth > 0`)
2. Fix stale `targetItemId` state (line 486) via render-time fallback:
   ```ts
   const effectiveTargetId =
     targetItemId != null && openItems.some((i) => i.id === targetItemId)
       ? targetItemId
       : (openItems[0]?.id ?? null);
   ```
   Use for `<select>` value, button disabled state, `onClaim` argument

**Layer/component:** Client component — UI update (C3 cross-consumer, C4 stale-target fix)

**Done-check:**
```bash
# C3 passes (cross-consumer equality with reorder)
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "C3"
# Expected: ✓ C3 passes

# C4 passes (stale target fixed)
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "C4"
# Expected: ✓ C4 passes
```

---

## Task 17 — Client: add-item form on `PlanSection` + i18n keys (all 4 locales)

**Type:** Implementation  
**Files (worktree-relative):**
- `client/src/components/PlanLedgerPanel.tsx` (PlanSection)
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` (i18n)

**What changes:**
1. Add-item form on open plans only (reuse existing `closed` prop gate; no new gate)
   - Controlled text input + parent `<select>` sourced from `flattenItemTree(buildItemTree(entry.items))` for **this plan only** + "top-level" option
   - Submit via `api.projectPlans.addItem`
   - `data-test="add-item-form"`, `data-test="add-item-submit"`
2. New i18n keys in **all four locales, identical key set, same commit:**
   - `planLedger.items.add`, `.addPlaceholder`, `.addSubmit`, `.parentTopLevel`, `.parentLabel`, `.edit`, `.save`, `.cancel`, `.saving`

**Layer/component:** Client component + i18n

**Done-check:**
```bash
# C1 and C2 pass (add-item form)
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "C1|C2"
# Expected: ✓ both pass

# i18n parity check: E1.1 green with no hand-typed key list
cd client && npx vitest run src/__tests__/i18n.test.ts -t "E1.1"
# Expected: ✓ E1.1 passes (keys derived from en)

# Verify all four locales have identical planLedger.* key set
for locale in en ko vi zh; do
  jq '.planLedger | keys | sort' "client/src/i18n/locales/$locale/projectDetail.json"
done | sort | uniq | wc -l
# Expected: 1 (all four produce identical output)
```

---

## Task 18 — Client: edit-in-place on `ItemNodeRow` + self/descendant exclusion

**Type:** Implementation  
**Files (worktree-relative):**
- `client/src/components/PlanLedgerPanel.tsx` (ItemNodeRow)

**What changes:**
1. Thread `closed` and handler props from `PlanSection` to `ItemNodeRow` (it is the only caller)
2. Edit control on open plans only; swaps row into:
   - Text input
   - Parent `<select>` excluding item itself + all descendants (walk `ItemNode.children`, not re-derive from `parent_item_id`) + other plans' items
   - Save/cancel buttons
3. Save calls `api.projectPlans.updateItem(id, { text, parent_item_id })`
4. `data-test="item-edit-button"`, `"item-edit-text"`, `"item-parent-select"`, `"item-edit-save"`, `"item-edit-cancel"`
5. Errors route through existing `error` state / `role="alert"` banner (no new error surface)

**Layer/component:** Client component — edit-in-place UI

**Done-check:**
```bash
# C5, C6, C7 pass (edit-in-place + exclusion)
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "C5|C6|C7"
# Expected: ✓ all three pass

# C7's grandchild assertion verified by human read
grep -A 20 "C7" client/src/components/__tests__/PlanLedgerPanel.test.tsx | grep -i "grandchild"
# Expected: assertion present and naming grandchild specifically
```

---

## Task 19 — Full suite run + snapshot review

**Type:** Verification  
**Files (worktree-relative):**
- Server tests (all)
- Client tests + snapshot (all)

**What changes:**
- Run full server suite
- Run full client suite
- **Review** the `screens.snapshot.test.tsx` diff (never blind `-u`)
- Intentional changes to PlanLedgerPanel's DOM (add-item form, edit-in-place, indented picker): regenerate baseline with `cd client && npx vitest run -u` **only after reading diff**

**Layer/component:** All tests

**Done-check:**
```bash
# Server suite green at ≥ 1807 (baseline 1787 + net 20 new/rewritten cases)
npm run test:server 2>&1 | tail -5
# Expected: pass count ≥ 1807

# Client suite green at ≥ 829 (baseline 822 + 7 new cases C1–C7)
npm run test:client 2>&1 | tail -5
# Expected: pass count ≥ 829

# Snapshot diff reviewed (human action required)
cd client && git diff src/pages/__tests__/screens.snapshot.test.tsx | head -50
# Expected: all changes are intentional add-item/edit-in-place/indent affordances

# Snapshot regenerated (after review)
cd client && npx vitest run -u
# Expected: baseline updated
```

---

## Task 20 — File-header audit + docs update

**Type:** Verification + documentation  
**Files (worktree-relative):**
- All touched `.js/.ts/.tsx` files

**What changes:**
1. Every touched file keeps its header with exact `@author Son Nguyen <hoangson091104@gmail.com>` line
2. Apply `update-project-docs` skill (API behavior changed: claims route is now delegator; UI capability added: item editing)
3. Correct `buildItemTree`'s doc comment (§9.9 correction from test-plan §8): *"nothing silently disappears"* is false for cycle case; add note about cycle guard
4. Correct `WATCH-S4-F`'s wording per DEC-S4-9 (verified behavior: throw, not orphan/cascade)
5. Open `WATCH-S4-I` (legacy import's inline `UPDATE parent_item_id` writer, dispositioned in G-1)
6. Open `WATCH-S4-J` (unclaim path not yet in composer, dispositioned in G-2)

**Layer/component:** Documentation + headers

**Done-check:**
```bash
# File-header audit passes
bash .claude/skills/file-headers/scripts/check-headers.sh
# Expected: exits 0

# Docs updated (check for update-project-docs application)
git log --oneline | grep -i "docs\|update-project-docs"
# Expected: recent commit

# Corrections applied in decisions.md (check for updated rows)
grep -A 3 "WATCH-S4-I\|WATCH-S4-J" decisions.md
# Expected: rows present with dates and reasons

# buildItemTree doc corrected
grep -A 2 "nothing silently" client/src/components/PlanLedgerPanel.tsx
# Expected: note about cycle guard added
```

---

## Summary

**Total tasks: 20**

**Red-first test steps (before any product change):**
1. Task 2 — D4 rewrite (§9.9 NAME-OVERCLAIMING GUARD)
2. Task 9 — G-2 (red before Task 3; green after)
3. Task 14 — C1–C7 (red before Tasks 15–18)
4. Task 11 — PX (red before Task 3; green after)

**MANDATORY durable-cure tasks (catalog gates):**
- **Task 1** — Apply catalog patches (DEC-S4-4/5, §9.3/§9.9 promotion)
- **Task 2 + 5 + 11** — D4 rewritten + mutation-proven (§9.9 NAME-OVERCLAIMING GUARD, DEC-S4-2)
- **Task 7** — Cycle guard (§9.8 OVERLOADED-ABSENCE, DEC-S4-7)
- **Task 8 + 9 + 10** — Derived `assertTableWritersSingleHome` helper + G-1/G-2 (§9.7 HAND-SCOPED STRUCTURAL SCAN, DEC-S4-8, first built instance)
- **Task 14 (C3)** — Cross-consumer equality over reordered input (§9.1 DERIVED-DUAL-VIEW, AC-10)

**Sequencing constraints:**
- Task 1 (doc obligation) must be first commit
- Tasks 2, 9, 11, 14 are red-first (before product changes)
- Task 3 before Task 4 (composer before delegator)
- Task 5 is mutation-proof of Task 3 (by different person)
- Task 6 before Task 7 (statement before validation)
- Task 8 before Task 9 (helper before guards)
- Tasks 15–18 before Task 19 (UI complete before snapshot review)

**First task to execute:** Task 1 (doc-ordering obligation)

**Blocking issues:** None. All dependencies are internal to this build.
