# Technical Plan — Value Pool Slice 4: Plan editing UI + batch group claiming

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/`
**Stage:** `intake-tech-lead` (Wave 3) · **Written:** 2026-08-06
**Classification (PM, binding):** `new-feature` + a `bug` carve-out (DEC-S4-2).
**Inputs reconciled:** `request-brief.md`, `pm-plan.md`, `decisions.md`,
`supporting/{product-owner,architect,engineer,qa}.md`.

**Phase structure is fixed by `DEC-S4-1` and is not re-litigated here:** two
build **phases** inside one slice — **4a** (buildable against `master` today)
and **4b** (hard-blocked on Slice 3's unmerged `value_groups` schema). This
document specifies **4a as a complete, file-by-file, executable change set**
and documents **4b as a deferred phase with a named trigger**, deliberately
without a full change-set spec (§9), because 4b's dependency is code that is
not merged and may still change.

Everything marked "confirmed live" was re-read directly from the working tree
at `master` during this pass. `PROJECT-CONTEXT.md` was **not** read from the
working tree (another live session holds an uncommitted 65-line edit to it —
DEC-S4-4); catalog references below come from the four supporting documents,
which each read it at committed `HEAD` (`d384249`).

---

## 1. Objective

Give `PlanLedgerPanel` a real editing surface and make its claim-target picker
hierarchy-aware, and — in the same phase — make the single-unit claim route
genuinely atomic by extracting its write path into one shared, transactional
composer. At the end of **4a**: an open plan can gain top-level items and
sub-items from the panel, an existing item's `text` and its hierarchy placement
(`parent_item_id`) can be changed in place, the per-unit claim `<select>`
renders parent/child structure built from the *same* `buildItemTree` the
read-only tree uses, and `POST /:id/claims` can no longer leave a committed
orphan plan item behind when a later validation or the `UNIQUE` claim
constraint rejects the request. The extraction is deliberately shaped so that
**4b's batch-claim route is a loop over the composer 4a ships**, not a second
hand-written INSERT sequence. 4b then adds the batch route, the group-claim UI,
and the `review_status='claimed'` transition once Slice 3 lands.

## 2. Recommended approach

One path, chosen from the evaluators' options:

| Question | Chosen | Source |
|---|---|---|
| Branch/phase sequencing | **A3** — 4a from `master` now; 4b's fork point decided at 4b's start | architect §3A / `DEC-S4-1` (binding) |
| Claim write path | **C1** — extract `claimUnitIntoItem`, one transaction, both routes call it | architect §3C, engineer §6, QA §3b |
| Atomicity fix placement | **4a**, D4 **rewritten** not adjusted | `DEC-S4-2` (binding) |
| Edit-field scope | `text` + `parent_item_id` placement only | `DEC-S4-3` (binding) |
| Hierarchy rendering | Reuse `buildItemTree`; picker consumes a **projection** of its output | §9.1, AC-10, all four evaluators |
| `review_status='claimed'` ownership | **B1** — dedicated verb + `value-groups.js`-owned setter | architect §3B — **4b only** |

### Where this plan overrides an input

**Override 1 — the engineer's "`plan-lifecycle.js` needs no changes for item
CRUD" is true for *creation* and false for *placement editing*, which
`DEC-S4-3` puts in 4a's scope.** Confirmed live: `updateProjectPlanItem`
(`server/lib/plan-lifecycle.js:156`) destructures only
`{ text, acceptance, detail, checked, position }` — `parent_item_id` is not
read — and its prepared statement (`server/db.js:3349`) has no
`parent_item_id` in its `SET` list at all. **Re-parenting an existing item is
not supported server-side today.** Worse, `client/src/lib/api.ts`'s
`updateItem` already advertises `parent_item_id: number | null` in its
`Partial<...>` type (confirmed live, ~line 2923) — a type-level promise the
server silently drops on the floor. AC-9 as narrowed by `DEC-S4-3` ("its
position in the hierarchy… is changeable") therefore **requires a server
change**, contrary to the engineer's §1 framing and the request-brief's Live
verification #1. Ruled into 4a and logged as **`DEC-S4-7`**.

**Override 2 — `COALESCE` cannot express this update, so re-parenting gets its
own statement rather than a widened one.** `updateProjectPlanItem`'s SQL is
`text = COALESCE(?, text), …` — a partial-update idiom in which `NULL` means
"leave unchanged." Promoting a sub-item to top-level *is* setting
`parent_item_id = NULL`, which that idiom structurally cannot express. Adding
`parent_item_id = COALESCE(?, parent_item_id)` would produce a control that
can demote an item but never promote one — a silent half-capability. Instead:
one new narrow prepared statement, invoked only when the caller explicitly
supplies the key. Existing partial-update semantics for the other five fields
are untouched (CLAUDE.md: preserve existing behavior; prefer minimal,
reversible diffs).

**Override 3 — a cycle guard *is* in 4a's server scope, narrowly.**
`WATCH-S4-D` records that `insertProjectPlanItem`'s `parent_item_id` check is
shallow (existence only, no same-plan check, no cycle check) and disposes it
as "made unreachable-from-UI rather than fixed." That disposition is correct
and unchanged **for the insert path** — a newly created item has no children,
so a cycle is not reachable through it. It does **not** transfer to the
re-parent path, which is new code this phase introduces: setting item A's
parent to one of A's own descendants is same-plan, passes an existence check,
and is directly offerable by a picker sourced from `buildItemTree(plan.items)`
— the exact mitigation `DEC-S4-3` relies on. The consequence is not cosmetic:
`buildItemTree` (`PlanLedgerPanel.tsx:266-276`) assigns a node to `roots` only
when its parent does not resolve, so a cycle puts every member of the cycle
under some other node and **none of them in `roots`** — the items vanish from
the ledger, from the picker, and from the snapshot, with no error anywhere.
That is a §9.8 OVERLOADED-ABSENCE instance created by our own new capability.
The UI excludes self+descendants from the picker **and** the server rejects
the cycle; per §9.6 the structural cure comes first, but a render-erasing
corruption does not get a UI-only guard. Logged as **`DEC-S4-7`**.

**Override 4 — `claimUnitIntoItem` lives in `plan-lifecycle.js`, not a new
module.** The architect (§3C) named the function and left its home open;
the engineer offered "`plan-lifecycle.js` or a new small module." Ruling:
`plan-lifecycle.js`. It is already the sole writer of `project_plan_items`,
and the whole point of the fix is that the item insert and the claim insert
must commit together — putting them in two modules re-creates the seam the
transaction exists to close. `value_claims` rows are plan-owned by their own
schema (`plan_id`, `item_id`). This does **not** conflict with the
architect's §3B rejection of option B2, which was about `plan-lifecycle.js`
owning `value_groups` — a different table, owned by a different module, and
still out of scope in 4a.

### Not overridden, carried verbatim

QA's I1–I8 matrix, the `GROUP_MEMBER_AVAILABILITY` reuse ruling, the §9.8
named-outcome requirement, and architect §4's claim-time TOCTOU analysis are
all **4b** requirements and are carried into §9 unchanged. Nothing in 4a
weakens them; §4's composer signature is shaped to make them implementable.

---

## 3. Change set — phase 4a (ordered, grouped by layer)

### 3.1 Database layer — `server/db.js`

- **Add one prepared statement**, adjacent to `updateProjectPlanItem`
  (currently line 3349):
  ```js
  reparentProjectPlanItem: db.prepare(
    `UPDATE project_plan_items SET
       parent_item_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ),
  ```
  No schema change, no migration. `project_plan_items.parent_item_id` already
  exists and is already nullable.

### 3.2 Domain layer — `server/lib/plan-lifecycle.js`

- **`updateProjectPlanItem(dbModule, itemId, patch)` — extend, preserving
  current behavior for every existing field.** Add, after the existing
  closed-plan guard and before the existing `updateProjectPlanItem.run(...)`:
  - Detect intent explicitly with `Object.hasOwn(patch, "parent_item_id")` —
    **not** `patch.parent_item_id != null`, because `null` is the meaningful
    "promote to top-level" value. Absent key = no placement change (every
    existing caller keeps its exact current behavior).
  - When present and non-null, validate in this order, each returning a
    `domainError("INVALID_INPUT", …)`:
    1. `parent_item_id !== itemId` — "an item cannot be its own parent".
    2. Parent exists (`getProjectPlanItem`) — "parent_item_id does not exist".
    3. `parent.plan_id === item.plan_id` — "parent_item_id belongs to a
       different plan".
    4. No cycle: walk `parent_item_id` upward from the proposed parent; if
       `itemId` is reached, reject — "parent_item_id would create a cycle".
       Bound the walk by the plan's item count so a pre-existing corrupt row
       cannot hang the request.
  - Then call `dbModule.stmts.reparentProjectPlanItem.run(parentItemId ?? null, itemId)`.
  - Both writes (the existing field update and the re-parent) happen inside
    one `dbModule.db.transaction(...)` so a rejected re-parent cannot leave a
    partially applied text edit.
  - Return shape unchanged: the refreshed item row, or a domain error.

- **New export `claimUnitIntoItem(dbModule, planId, body)`** — the sole
  composer for `value_claims` inserts. This is the extraction 4b loops over.
  ```js
  /**
   * The SOLE writer of value_claims (single-writer-guard.test.js). Resolves
   * or atomically creates the target item, validates the unit fields, and
   * inserts the claim — all inside ONE transaction, so no failure path can
   * leave a committed orphan plan item (DEC-S4-2).
   * @param {object} dbModule
   * @param {number} planId
   * @param {object} body  item_id | new_item, plus the unit's claim fields
   * @returns {object} the created claim row, or a domainError
   */
  function claimUnitIntoItem(dbModule, planId, body) { … }
  ```
  Required internals, in this order:
  1. `getProjectPlan(planId)` → `domainError("NOT_FOUND", "no such plan")`;
     `plan.status !== "open"` → `domainError("ALREADY_CLOSED", "plan is closed")`.
  2. **Validate `value_source` / `attribution` / `value_ref` FIRST**, before
     any write. This reordering is required by `DEC-S4-2` and is what makes
     the common failure mode impossible rather than merely rolled back
     (§9.6 — prefer inapplicability over compliance).
  3. Open `dbModule.db.transaction(() => { … })` and inside it:
     resolve `item_id` (must belong to this plan) **or** create the item via
     the existing `insertProjectPlanItem` (never a second insert path);
     canonicalize `source_cwd` via `cwdIdentity.canonicalizeCwd`; call
     `dbModule.stmts.insertValueClaim.run(...)`; read back via `getValueClaim`.
  4. Catch the `UNIQUE` violation and convert it to
     `domainError("DUPLICATE_CLAIM", "this unit is already claimed into this item")`.
     The throw must propagate out of the transaction callback first so
     better-sqlite3 rolls the item insert back — **catch outside the
     `transaction()` call, not inside it.** Catching inside would commit the
     orphan item and reproduce the exact defect being fixed.
  5. Error messages must be **byte-identical** to today's strings (listed in
     §4, step 4) so no existing assertion or client string changes.
- **Export it** in `module.exports` alongside the existing item CRUD.
  Update the file-header overview to name `claimUnitIntoItem` as the sole
  `value_claims` writer (the header is a real ownership claim in this repo —
  see `value-groups.js`'s "SOLE writer … G-8" precedent).

### 3.3 Route layer — `server/routes/project-plans.js`

- **`POST /:id(\d+)/claims` (lines 482-574) becomes a thin delegator.** Whole
  body reduces to:
  ```js
  const result = planLifecycle.claimUnitIntoItem(dbModule, Number(req.params.id), req.body || {});
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  broadcast("value_claim_updated", { claim: result });
  res.status(201).json({ claim: result });
  ```
  Confirmed live that this preserves every status code: `DOMAIN_STATUS`
  (line ~42) already maps `NOT_FOUND: 404`, `ALREADY_CLOSED: 409`,
  `DUPLICATE_CLAIM: 409`, `INVALID_INPUT: 400`. **`broadcast` fires after the
  transaction returns, never inside it** — a WS message for a rolled-back
  write is worse than a late one.
- `VALUE_SOURCES` / `ATTRIBUTION_TIERS` / `cwdIdentity` move with the logic
  into `plan-lifecycle.js`; drop the imports from the route only if no other
  handler in the file still uses them (grep before deleting).
- **No new routes in 4a.** `POST /:id/items`, `PATCH /items/:itemId`,
  `DELETE /items/:itemId` all already exist and already delegate to
  `plan-lifecycle.js` (confirmed live, lines 452-476). `PATCH` passes
  `req.body` straight through, so the new `parent_item_id` key needs no route
  change.

### 3.4 Client API — `client/src/lib/api.ts`

- `addItem` / `updateItem` / `deleteItem` / `claim` all already exist
  (confirmed live, ~2903-2974). **No new methods in 4a.**
- `updateItem`'s `parent_item_id: number | null` type stops being a lie once
  §3.2 lands. Add a one-line doc note that `null` promotes to top-level and an
  **absent key** means "no placement change" — the distinction is now
  load-bearing on the wire. Callers must send `undefined`, not `null`, when
  they mean "don't touch placement".

### 3.5 Client component — `client/src/components/PlanLedgerPanel.tsx`

All changes are in this one file. `buildItemTree` (line 266) is **not
modified** and **not duplicated**.

- **New pure projection, immediately below `buildItemTree`:**
  ```ts
  /** Depth-first flattening of buildItemTree's output — the ONE hierarchy
   *  derivation, projected for consumers that need a flat sequence (the
   *  claim-target <select>, the parent picker). Never re-walks
   *  parent_item_id: it takes ItemNode[], so a second nesting rule is
   *  structurally impossible here (§9.1 DERIVED-DUAL-VIEW). */
  function flattenItemTree(nodes: ItemNode[], depth = 0): Array<{ node: ItemNode; depth: number }>
  ```
  Taking `ItemNode[]` (not `ProjectPlanItem[]`) is the point: the type makes
  it impossible for this function to become a second tree-builder.
- **`openItems` (line 972) is rebuilt from the tree, per plan:**
  ```ts
  const openItems = openPlans.flatMap((p) =>
    flattenItemTree(buildItemTree(p.items)).map(({ node, depth }) => ({
      id: node.id, text: node.text, depth, planId: p.plan.id,
    }))
  );
  ```
  Same ids, same membership as today (parents and children alike — Live
  verification #3), now carrying `depth` and ordered depth-first instead of
  raw array order. Widen `ValueUnitRow`'s `openItems` prop type accordingly.
- **`ValueUnitRow`'s `<select>` (lines 572-583)** renders each option with a
  depth-proportional prefix (e.g. `"  ".repeat(depth) + "└ "` for
  `depth > 0`). `<option>` ignores CSS padding across browsers, so indentation
  must be in the text content. Keep `value={item.id}` unchanged — the claim
  payload does not move (AC-13).
- **Fix the stale claim-target this phase would otherwise introduce.**
  `targetItemId` is `useState(openItems[0]?.id ?? null)` (line 486) —
  initial-value-only. Today that is harmless because the item list cannot
  change while the panel is mounted. From this phase on it can: the whole
  claim control block is gated on `openItems.length > 0`, so a plan that had
  zero items renders no `<select>`, `targetItemId` stays `null`, and after the
  user adds their first item via the new form (`load()` re-renders but does
  not remount the row) the claim button stays permanently disabled. Fix at
  render, with no extra state and no effect:
  ```ts
  const effectiveTargetId =
    targetItemId != null && openItems.some((i) => i.id === targetItemId)
      ? targetItemId
      : (openItems[0]?.id ?? null);
  ```
  Use `effectiveTargetId` for the `<select>`'s `value`, the button's
  `disabled`, and the `onClaim` argument. This also covers the case where the
  currently-selected item is deleted or re-parented out from under the row.
- **`PlanSection` gains an add-item form** (open plans only — reuse the
  existing `closed` prop gate at line 334; do not invent a second gate).
  Controlled text input + a parent `<select>` whose options are
  `flattenItemTree(buildItemTree(entry.items))` for **this plan only** plus a
  "top-level" option — which is what makes cross-plan parenting structurally
  unreachable (`DEC-S4-3`). Submits via `api.projectPlans.addItem`.
  `data-test="add-item-form"`, `data-test="add-item-submit"`.
- **`ItemNodeRow` gains edit-in-place** for `text` and placement, open plans
  only. `ItemNodeRow` currently takes no `closed`/handler props — thread them
  from `PlanSection` (it is already the only caller). An "edit" control swaps
  the row into a text input + a parent `<select>`; save calls
  `api.projectPlans.updateItem(id, { text, parent_item_id })`. **The parent
  `<select>` must exclude the item itself and all of its descendants** —
  computed by walking the `ItemNode`'s own `children` (already materialized by
  `buildItemTree`; do not re-derive from `parent_item_id`). This is the UI
  half of Override 3. `data-test="item-edit-button"`,
  `data-test="item-edit-text"`, `data-test="item-parent-select"`,
  `data-test="item-edit-save"`, `data-test="item-edit-cancel"`.
- **No delete-item control in 4a** — see `WATCH-S4-F`.
- Errors from all three mutations route through the existing `error` state and
  its `role="alert"` banner (line 999). No new error surface.

### 3.6 i18n — `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`

Every new string gets a `planLedger.*` key in **all four** locales in the same
commit (Slice 3's precedent: 45 lines × 4 files, identical shape). New keys:
`planLedger.items.add`, `.addPlaceholder`, `.addSubmit`, `.parentTopLevel`,
`.parentLabel`, `.edit`, `.save`, `.cancel`, `.saving`. English-only is a ship
blocker, not a follow-up.

---

## 4. Implementation steps — phase 4a

Dependency-ordered; each step is independently checkable. Steps 1-4 are the
`DEC-S4-2` bug fix and must land before any 4b work begins, because 4b's batch
route is a loop over what step 3 produces.

1. **Cut the effort branch from `master`.** Before any git operation on this
   shared checkout, run `ps`/`lsof` and confirm with Sara — `DEC-S4-1`
   constraint 3, and this project's own concurrent-session memory note.
   Apply `catalog-patch.md` (`DEC-S4-4`) and the `## Corrections` append to
   the parent `request.md` (`DEC-S4-5`) in the same commit that copies the
   request tree; delete `catalog-patch.md` in that commit so exactly one
   catalog exists.
   *Checkable:* branch exists off `master`; `catalog-patch.md` gone; §9.3
   carries the D4 instance and the NAME-OVERCLAIMING GUARD sub-shape.
2. **Rewrite D4 first, and watch it fail.** Replace
   `project-plans-api.test.js:494` with the post-item-insert failure case
   (valid `new_item`, invalid `value_source`) asserting no orphan item
   survives. Run it against unmodified code and **observe it red**. This is
   the red-evidence step — a rewritten guard that was never seen failing is
   the exact shape `DEC-S4-2` exists to stop.
   *Checkable:* the new D4 fails, for the stated reason, before step 3.
3. **Extract `claimUnitIntoItem` into `plan-lifecycle.js`** (§3.2) with the
   validate-then-transact ordering and the catch-outside-the-transaction
   rule. Export it; update the file header.
   *Checkable:* the new D4 goes green; `npm run test:server` fully green.
4. **Reduce the route to a delegator** (§3.3). Verify by direct diff-read that
   these four strings are unchanged: `"no such plan"`, `"plan is closed"`,
   `"item_id or new_item is required"`, `"item_id does not belong to this
   plan"`, plus `"this unit is already claimed into this item"` and the two
   `must be one of …` messages.
   *Checkable:* every pre-existing claims test in `project-plans-api.test.js`
   passes **unmodified** (AC-13 / acceptance signal 5).
5. **Mutation-prove the atomicity fix, by someone other than its author.**
   Remove the `transaction(...)` wrapper, watch the new D4 fail, restore
   byte-identical, re-run green. Report as an observation with the actual
   failure text, never as an intention (§9.3 AGENT-SELF-REPORTED-RED).
   *Checkable:* the observed failure output appears in the build log.
6. **Add `reparentProjectPlanItem`** to `server/db.js` (§3.1).
   *Checkable:* server boots; `npm run test:server` still green.
7. **Extend `updateProjectPlanItem`** with `Object.hasOwn`-gated placement and
   the four-step validation chain (§3.2), inside one transaction.
   *Checkable:* new `plan-lifecycle.test.js` cases (§5, P1-P6) pass; every
   existing case in that file passes unmodified.
8. **Add the two `single-writer-guard.test.js` entries** (§5, G-A/G-B),
   modeled on the existing `markValueUnitSummariesSeen` / `requestValueCoverage`
   idiom (lines 285-385). Mutation-prove each once.
   *Checkable:* each guard observed failing against an injected second call
   site, then green after revert.
9. **Client: add `flattenItemTree` and rebuild `openItems`** (§3.5). No visual
   change yet beyond option ordering.
   *Checkable:* existing `PlanLedgerPanel.test.tsx` passes unmodified.
10. **Client: indent the claim `<select>` and fix the stale target** (§3.5).
    *Checkable:* new tests C3/C4 (§5) pass; the existing "calls
    `api.projectPlans.claim` exactly once with (itemId, unit)" test at ~line
    230 passes **with its assertion shape unchanged**.
11. **Client: add-item form on `PlanSection`** (§3.5) + i18n keys in all four
    locales.
    *Checkable:* tests C1/C2; `en`/`ko`/`vi`/`zh` have identical key sets.
12. **Client: edit-in-place on `ItemNodeRow`**, including the
    self-and-descendants exclusion in the parent picker.
    *Checkable:* tests C5/C6/C7.
13. **Run the full suites and review the snapshot diff.**
    `npm run test:server`, `npm run test:client`. `PlanLedgerPanel`'s DOM
    changes materially, so `client/src/pages/__tests__/screens.snapshot.test.tsx`
    will fail; regenerate with `cd client && npx vitest run -u` **only after
    reading the diff** and confirming every change is an intended affordance.
    Blind regeneration is a policy violation here (CLAUDE.md; `WATCH-S4-A`).
14. **File-header audit + docs.** Every touched `.js/.ts/.tsx` keeps its
    header with the exact `@author Son Nguyen <hoangson091104@gmail.com>`
    line; run `bash .claude/skills/file-headers/scripts/check-headers.sh`
    (must exit 0). Apply the `update-project-docs` skill — this change-set
    alters API behavior (claims route semantics) and adds UI capability.

---

## 5. Testing & verification — phase 4a

QA's plan (`supporting/qa.md` §3) is folded in below, partitioned by phase.
**I1-I8 are 4b tests and are not in 4a's Definition of Done** — they are
carried verbatim into §9.

### Server — `server/__tests__/project-plans-api.test.js`

- **D4 (REWRITTEN, not extended — `DEC-S4-2`).** Valid `new_item` +
  invalid `value_source` → 400, **and the item count is unchanged**. Keep the
  existing happy-path half. The old `new_item: { text: "" }` case moves to its
  own separate `it(...)` under an honest name (it tests
  `insertProjectPlanItem`'s input guard, which is a real thing worth keeping —
  it just is not evidence of atomicity).
- **New D4b:** valid `new_item` + a `value_ref` that collides with an existing
  claim on the same `(value_source, value_ref, source_cwd, item_id)` → 409
  `DUPLICATE_CLAIM` **and no orphan item**. This is the failure mode
  reordering alone cannot fix and is why the transaction is required as well.
- **Regression, unmodified:** every existing Group D case, including "the SAME
  unit claimed into a DIFFERENT item must be allowed."

### Server — `server/__tests__/plan-lifecycle.test.js`

- **P1** re-parent a top-level item under another item → `parent_item_id` set.
- **P2** promote a sub-item to top-level via explicit `parent_item_id: null` →
  becomes `null`. (This is the case `COALESCE` cannot express — it red-proves
  Override 2.)
- **P3** omitting the `parent_item_id` key leaves placement untouched while a
  `text` edit still applies (the existing-caller regression).
- **P4** self-parent → `INVALID_INPUT`, row unchanged.
- **P5** parent that is a descendant of the item → `INVALID_INPUT` (cycle),
  row unchanged. Build a 3-level fixture and re-parent the grandparent under
  the grandchild.
- **P6** parent in a different plan → `INVALID_INPUT`.
- **P7** any re-parent on a **closed** plan → `ALREADY_CLOSED`.

### Server — `server/__tests__/single-writer-guard.test.js`

- **G-A:** `insertValueClaim` appears only in `db.js` (statement) and
  `plan-lifecycle.js`, and `insertValueClaim\s*\.\s*run\s*\(` has **exactly
  one** lexical call site tree-wide — inside `claimUnitIntoItem`. Derive the
  file set from `scanFiles(serverDir, /insertValueClaim/)`, **never** a
  hand-typed list of files (§9.7 HAND-SCOPED STRUCTURAL SCAN — a guard that
  only knows the two files its author thought of stays green for the third).
- **G-B:** `insertProjectPlanItem\s*\.\s*run\s*\(` and
  `reparentProjectPlanItem\s*\.\s*run\s*\(` each have exactly one lexical call
  site, both in `plan-lifecycle.js` — pinning it as the sole
  `project_plan_items` writer now that a second mutation path exists.
- Mutation-prove each once (add a second call site, observe red, revert).

### Client — `client/src/components/__tests__/PlanLedgerPanel.test.tsx`

- **C1** add-item form on an open plan creates a top-level item
  (`addItem` called with `{ text }`, no `parent_item_id`) and it appears.
- **C2** add-item with a parent selected calls `addItem` with that
  `parent_item_id`; **no add form renders on a closed plan** (AC-8).
- **C3 (§9.1 cross-consumer, AC-10 — the one QA calls out by name).** With a
  3-level fixture, assert the `<select>`'s option **order and depth** match
  `ItemTree`'s rendered row order and indent depth exactly. Then reorder the
  input `items` array and assert **both** consumers change identically. This
  proves one derivation, not two agreeing ones — eyeballing two components
  is explicitly not sufficient.
- **C4** claiming into a **sub-item** calls `api.projectPlans.claim` with the
  sub-item's real id; and after adding the first item to a plan that had zero,
  the claim button becomes enabled without a remount (the §3.5 stale-target
  fix).
- **C5** edit-in-place changes text → `updateItem` called with `{ text }` and
  **no `parent_item_id` key** (proving "absent means unchanged" on the wire).
- **C6** re-parent via edit → `updateItem` called with the chosen
  `parent_item_id`; promoting to top-level sends explicit `null`.
- **C7** the parent `<select>` for an item **omits the item itself and every
  descendant**, and offers only the current plan's items.
- **Regression:** the existing claim test at ~line 230 passes with its
  assertion shape unmodified.

### Commands

```
npm run test:server
npm run test:client
node --test server/__tests__/project-plans-api.test.js
node --test server/__tests__/plan-lifecycle.test.js
node --test server/__tests__/single-writer-guard.test.js
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
bash .claude/skills/file-headers/scripts/check-headers.sh
```

### Manual verification (4a subset of QA §1)

Steps 1, 2 and 6 of QA's manual list. Steps 3-5 are 4b.

---

## 6. Single-source-of-truth guardrail

This project's convention is the **single-writer guard**
(`server/__tests__/single-writer-guard.test.js`) plus the `CONSUMERS` registry
(`DEC-16` / `WATCH-6`). This change set touches that surface in two places and
**must route through it, not hand-edit one path**:

1. **`value_claims` gains its second producer in 4b.** 4a therefore ships the
   composer (`claimUnitIntoItem`) and guard **G-A** *before* the second
   producer exists, so 4b physically cannot hand-roll a parallel INSERT
   sequence without turning a guard red. This is the WATCH-6 instruction taken
   literally: one composer, N callers.
2. **The hierarchy derivation.** `buildItemTree` is the single canonical
   `parent_item_id → tree` computer and gains consumers #2 and #3 in this
   slice — the moment §9.1's own design-time pre-flag says this class fails.
   The picker consumes `flattenItemTree(buildItemTree(...))`, a **projection
   typed to accept `ItemNode[]`**, which makes a second nesting rule
   structurally impossible rather than merely discouraged (§9.6). Test **C3**
   is the executable proof, and it is a cross-consumer equality test, not two
   independent assertions.
3. **i18n keys** are the third sync-critical surface: four locale files, one
   key set, same commit. Not a registry, but the same "never hand-edit one
   path" rule applies.
4. **`CONSUMERS` is not touched by 4a.** 4b inherits `WATCH-S4-E`'s tension
   and must not silently re-litigate Slice 3's open escalation.

---

## 7. Risks & rollback

| Risk | Watch for | Mitigation / rollback |
|---|---|---|
| The route refactor silently changes a status code or error string | Any pre-existing claims test needing edits to pass | Step 4's byte-identical string check; if a test needs changing, the refactor is wrong, not the test. Revert steps 3-4 — they are self-contained |
| The transaction wrapper changes `broadcast` timing | WS clients seeing a claim for a rolled-back write | `broadcast` is outside the transaction by construction (§3.3) |
| Re-parent cycle corrupts the ledger (items vanish) | Items disappearing from `ItemTree` after an edit | Server guard (P5) + UI exclusion (C7). Both, per Override 3 |
| Snapshot churn hides a real regression | A large `screens.snapshot.test.tsx` diff | Review before regenerating; never `-u` blind (`WATCH-S4-A`) |
| Merge-order collision with Slice 3 | Both branches touch `PlanLedgerPanel.tsx` (Slice 3: +363), its spec, 4 locale files, the snapshot | `WATCH-S4-A`: second-to-merge rebases, re-runs `npm run test:client` in full, **reviews** the snapshot diff. `DEC-S4-1` constraint 3 sets the order |
| Concurrent sessions on this checkout | Uncommitted files from another session | `ps`/`lsof` + confirm with Sara before any git operation (step 1) |

**Rollback:** 4a is three independent, separately revertible units — the
atomicity fix (steps 2-5, server-only), the re-parent capability (steps 6-7 +
C5-C7), and the UI affordances (steps 9-12). Reverting the UI leaves the
server strictly improved. The only irreversible-ish artifact is the snapshot
baseline, which regenerates from source.

### Scope boundaries declined here — each backed by a tracked row

Per this project's rule that a declined-scope item must be an artifact, not a
sentence. **Rows appended to [`decisions.md`](./decisions.md) by this plan:
`DEC-S4-7`, `WATCH-S4-F`, `WATCH-S4-G`.** Pre-existing rows are cited, not
duplicated.

| Declined in 4a | Tracked as |
|---|---|
| `acceptance` / `detail` / `target_date` inline editing | **`WATCH-S4-B`** (existing) |
| Server-side same-plan/cycle hardening of the **insert** path | **`WATCH-S4-D`** (existing) — unchanged; the re-parent path is hardened by `DEC-S4-7`, the insert path is not |
| 4b's fork point (Slice-3 branch vs. merged `master`) | **`WATCH-S4-C`** (existing) — escalate if Slice 3 is unmerged 3 days from 2026-08-06 |
| `CONSUMERS` growth-rule tension | **`WATCH-S4-E`** (existing) — carried, explicitly not re-decided |
| Merge-order snapshot/locale collision | **`WATCH-S4-A`** (existing) |
| **Item deletion from the panel** | **`WATCH-S4-F`** (new) — `deleteProjectPlanItem` and `api.deleteItem` both exist; no requester signal, and delete-with-claims needs a rule this slice has no basis to invent |
| **Sibling ordering / reordering** | **`WATCH-S4-G`** (new) — `position` defaults to 0 on insert and re-parent does not set it, so sibling order is insertion order and is not user-controllable. Newly *visible* because of this phase's tree affordances |
| **The re-parent server change itself** (falsifies "item CRUD needs no server changes") | **`DEC-S4-7`** (new) — in scope for 4a, with its validation boundary stated |

Carried forward from `architect.md` §5, which required these be rows rather
than prose: item 1 → `WATCH-S4-E` (already opened), item 2 → `DEC-S4-1` +
`WATCH-S4-C` (already opened), item 3 (the `review_status` CHECK-narrowing
risk under `WATCH-4`) → **re-checked at 4b's start as part of `WATCH-S4-C`'s
fork-point confirmation**; it is inapplicable to 4a, which touches no
`value_groups` schema.

---

## 8. Definition of Done — phase 4a

- [ ] `npm run test:server` green, including rewritten **D4**, new **D4b**,
      and **P1-P7**.
- [ ] `npm run test:client` green, including **C1-C7**; snapshot baseline
      diff **reviewed** and deliberately regenerated (never blind `-u`).
- [ ] `single-writer-guard.test.js` gains **G-A** (`insertValueClaim` — one
      lexical call site, inside `claimUnitIntoItem`, file set derived by
      `scanFiles`) and **G-B** (`project_plan_items` writers), each
      mutation-proven once.
- [ ] The atomicity fix is **red-proven by mutation, by someone other than its
      author**, with the observed failure output reported (not an intention).
- [ ] `POST /:id/claims` response shapes, status codes, and error message
      strings are byte-identical to `master`; every pre-existing claims test
      passes **unmodified** (AC-13 / acceptance signal 5).
- [ ] `insertValueClaim.run(` has exactly one lexical call site tree-wide.
- [ ] The claim-target picker renders hierarchy from `buildItemTree` via
      `flattenItemTree`; **C3** proves one derivation across both consumers by
      equality, not by two independent assertions (AC-10).
- [ ] Add-item and edit-in-place work on open plans and are **absent** on
      closed plans (AC-8, AC-9 as narrowed by `DEC-S4-3`).
- [ ] Re-parenting supports promote-to-top-level (explicit `null`) and rejects
      self-parent, cycles, and cross-plan parents server-side; the UI offers
      neither self, descendants, nor other plans' items.
- [ ] All new strings exist in **all four** locales with identical key sets.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] `catalog-patch.md` applied and deleted (`DEC-S4-4`); `request.md`
      `## Corrections` appended (`DEC-S4-5`).
- [ ] `update-project-docs` applied.
- [ ] `DEC-S4-7`, `WATCH-S4-F`, `WATCH-S4-G` present in `decisions.md`.

---

## 9. Phase 4b — deferred, with a named trigger

**Not started. No change-set spec, deliberately** — 4b extends
`server/lib/value-groups.js`, `server/db.js`'s `value_groups` schema, and
Slice 3's group-review UI, none of which are on `master` and all of which may
still change before Slice 3 merges. Specifying file-by-file diffs against an
unmerged branch would be a guess presented as a plan.

### Trigger condition

**4b starts when Slice 3 is merged to `master`, OR when the PM explicitly
rules that 4b forks from `effort/2026-08-06-auto-group-proposal`.** That
fork-point choice is `WATCH-S4-C` and is **decided fresh at 4b's start**
against Slice 3's real merge state at that moment — today's answer would be a
guess about a blocker owned by another session. **Escalate to Sara if Slice 3
is still unmerged on 2026-08-09** (3 days from 2026-08-06); at that point the
blocker is administrative — a concurrent session's uncommitted 65-line edit to
`PROJECT-CONTEXT.md` — not technical, and it is the single highest-leverage
thing Sara can unblock for this initiative.

### What 4b will need (design constraints already settled, carried forward)

These are binding on 4b's own technical pass; it does not get to re-derive them.

1. **One new route**, a dedicated verb (e.g.
   `POST /:id/groups/:groupId/claim`) — **never** a body-supplied
   `{status: "claimed"}` endpoint. `DEC-S3-9` closed that hole structurally
   and 4b must not reopen it.
2. **The write path is a loop over `claimUnitIntoItem`** (shipped in 4a)
   inside one `dbModule.db.transaction(...)` — not a second INSERT sequence.
   Guard **G-A** will be red if this is violated.
3. **`review_status='claimed'` has exactly one writer** — a
   `value-groups.js`-owned setter (architect option B1), called from inside
   that same transaction. `value-groups.js` declares itself sole writer of
   that table in its own header; the batch route must not inline an `UPDATE`.
   Its "the ONLY writer of review_status (approve/dismiss)" comment must be
   updated in the same commit that adds the third caller. (AC-14.)
4. **Claim-time availability is re-resolved *inside* the transaction** — never
   a client-supplied list and never Slice 3's approval-time snapshot — and a
   `UNIQUE` collision is caught **per member**, never allowed to abort the
   batch. This is `WATCH-S3-A`'s substance, promoted to a binding AC by
   `DEC-S4-6`, and independently rediscovered by architect §4, engineer §2 and
   QA I6.
5. **Per-member outcomes are discriminated**, extending Slice 3's
   `GROUP_MEMBER_AVAILABILITY` vocabulary (`claimed` /
   `skipped_already_claimed` / `skipped_no_longer_in_pool`) — never a single
   pass/fail boolean, never a fresh parallel vocabulary. Every member lands in
   exactly one bucket, never zero and never two. (AC-11, §9.8.)
6. **Zero-claimable is its own named outcome** (e.g.
   `outcome: "no_claimable_members"`), distinguishable from an empty group and
   from a request that never ran. (AC-11/AC-12, QA I4.)
7. **The wire-shape gap the engineer found (§3.1 of `engineer.md`) is real
   work, not reuse:** `ValueGroupMember` carries only
   `{ unitKey, availability }`, but a claim needs the full unit
   (`value_source`, `value_ref`, `source_cwd`, `label`, `attribution`,
   `stage`). Either widen `resolveMemberAvailability`'s return or add a
   sibling function performing the same join with the full payload — decide
   deliberately; widening a shared function for consumer #2 is itself a §9.1
   shape.
8. **The business rule is stricter than the DB constraint.**
   `already_claimed` is keyed on `(value_source, value_ref)`, while the
   `UNIQUE` index is `(value_source, value_ref, source_cwd, item_id)`. Batch
   claim must honor the *business* rule (skip already-claimed anywhere), or
   the single and batch gestures will disagree about what "claimed" means.
9. **Closed-plan guard applies to the batch path** — checked against the plan
   being claimed *into*, since `value_groups` has no `plan_id` of its own.
10. **Open product question to answer at 4b's start** (`decisions.md` PENDING
    #4): whether a new item is still *created* for a group that turns out to
    have nothing claimable, or creation is skipped. Either is acceptable; it
    must be deliberate.

### 4b's test set (QA's I1-I8, carried verbatim)

I1 all-available atomicity · I2 all-or-nothing on injected mid-batch failure
(red-proven by removing the transaction wrapper) · I3 mixed-availability
truth table, one row per member, modeled on `value-groups-api.test.js`'s
`TT [M]` pattern · I4 zero-claimable named outcome · I5 create-new-item-then-
claim (exactly one item regardless of member count; no orphan on failure) ·
I6 live re-check vs. stale snapshot · I7 plan-closed → 409 · I8 route-level
negative proof that approve/dismiss still touch only
`review_status`/`reviewed_at`. Plus a `setValueGroupReviewStatus.run("claimed", …)`
single-call-site guard, and the client-side group-claim button states.

### Initiative-closing smoke test (PO §4)

4b is the last phase of the four-slice initiative, so its done bar includes
one true end-to-end run: **ungrouped pool → proposed groups → approved group →
batch-claimed into a newly created sub-item**. This is also the natural place
to answer the carried `OPEN-S2-1` (which real project validates the flow).
