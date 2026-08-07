# Risk & Regression Analysis — plan-editing-ui (Value Pool Slice 4, Phase 4a)

**Scope:** Phase 4a only (item/sub-item CRUD UI, hierarchy-aware claim picker,
single-claim atomicity fix). Pre-build pass — evaluating the **planned** change
set in `technical-plan.md`, `decisions.md`, `decisions-tech-lead-addendum.md`
against the real tree at `master` (`d384249`).

**Catalog read at committed HEAD**, per instruction — `git show HEAD:PROJECT-CONTEXT.md`
— not the uncommitted 65-line working-tree edit from the concurrent session
(confirmed via `git status`). All `§9.*` references below are to that committed
catalog.

---

## 1. Blast radius

Beyond the literal files in `technical-plan.md` §3:

- **`server/db.js`** — `project_plan_items` (`:770-788`) and `value_claims`
  (`:794-814`) table definitions. Both `parent_item_id INTEGER REFERENCES
  project_plan_items(id)` and `value_claims.item_id INTEGER NOT NULL
  REFERENCES project_plan_items(id)` declare **no `ON DELETE` clause**, and
  `db.pragma("foreign_keys = ON")` is set globally at `server/db.js:135`. This
  is load-bearing for the deletion-interaction question below and is not
  mentioned in the technical plan.
- **`server/lib/plan-lifecycle.js`** — the sole writer of `project_plan_items`
  and `value_claims` (its own file header says so). `updateProjectPlanItem`,
  `insertProjectPlanItem`, `deleteProjectPlanItem`, `closePlan`, and the new
  `claimUnitIntoItem`/re-parent logic all share this one module and its two
  domain-error/validation conventions. A defect in the new re-parent
  validation chain is a defect in the same function every existing caller of
  `updateProjectPlanItem` already depends on (five-field COALESCE path).
- **`server/routes/project-plans.js`** — `POST /:id(\d+)/claims` becomes a
  delegator; `PATCH /items/:itemId` is **not touched in the diff** but
  changes behavior (silently, from a reviewer's perspective — the route file
  has no line change for this, so a diff-only review of `project-plans.js`
  will not surface that `PATCH` just gained real re-parent semantics).
- **`client/src/lib/api.ts`** — `updateItem`'s `parent_item_id: number | null`
  type stops being a lie (`Override 1`). Blast radius: **any existing caller
  of `api.projectPlans.updateItem` anywhere in the client**, not just
  `PlanLedgerPanel.tsx`, is now able to actually move an item in the
  hierarchy. Worth a grep for other callers before assuming
  `PlanLedgerPanel.tsx` is the only surface exercising this path in practice.
- **`client/src/components/PlanLedgerPanel.tsx`** — `buildItemTree`
  (`:266-276`) gains its 2nd/3rd/4th consumers this slice (claim picker via
  `flattenItemTree`, add-item parent picker, edit-in-place parent picker) —
  the exact "consumer #2 appears" moment `§9.1 DERIVED-DUAL-VIEW`'s own
  recorded history says the failure lands (7 prior occurrences in this
  catalog). This file also already carries two **live, uncatalogued
  candidate patterns** from its own history (see §3) that this change adds
  new state and new effects next to, even though it doesn't touch their
  mechanisms directly.
- **`server/__tests__/single-writer-guard.test.js`** and its `scanFiles`/
  `assertSingleHome` helpers — G-A/G-B extend this shared guard file. Its
  scope-derivation conventions (`§9.7 HAND-SCOPED STRUCTURAL SCAN`'s cure)
  are inherited, correctly, but G-B's own *name* creates a new blast-radius
  problem — see §4.
- **`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`** — four files,
  one key set, same commit; mechanical but real (a missed locale ships an
  English-only string, a documented ship blocker per the plan).
- **`server/__tests__/plan-lifecycle.test.js`** — `deleteProjectPlanItem`'s
  only existing test (`:73`) is `assert.ok(typeof planLifecycle.deleteProjectPlanItem
  === "function")` — a bare existence check, one of `§9.3`'s named vacuous
  shapes. This module's delete path is effectively untested today, and this
  slice's deeper, user-populated hierarchies make that path more likely to be
  hit in practice even though no delete UI ships in 4a.

---

## 2. Invariants that must hold, mapped to this project's defect catalog

This project has a configured, actively-maintained defect-class catalog
(`PROJECT-CONTEXT.md` §9, committed HEAD). Mapping directly rather than
reasoning from scratch:

- **`§9.1 DERIVED-DUAL-VIEW`** — `buildItemTree` must produce one hierarchy,
  consumed identically everywhere. The plan's `flattenItemTree(nodes:
  ItemNode[])` projection is the compliant shape (typed to accept the
  *already-materialized* tree, not `ProjectPlanItem[]`, so a second
  `parent_item_id`-walking function is structurally impossible). **Confirmed
  correct as specified.** The catalog's own twice-proven corollary — "a
  rogue-reader scan does not catch a rogue re-derivation" — applies directly
  to the self+descendant exclusion walk in `ItemNodeRow`'s parent picker: it
  must be checked by reading the code or by fixture-driven test (C7), never
  by a structural grep, because a hand-rolled re-implementation of "walk
  `children`" would read no `parent_item_id` and would evade any text scan.
- **`§9.3 VACUOUS-GUARD` → NAME-OVERCLAIMING GUARD sub-shape** — the D4
  rewrite is this pattern's own namesake instance, already correctly
  dispositioned (DEC-S4-2, rewritten not extended, red-proven by someone
  other than its author). **This QA pass finds a second, live instance of
  the same sub-shape in this same change set** — see §4, trap 1.
- **`§9.6 NON-ATOMIC REBUILD`** — not directly touched (no schema rebuild in
  4a: `reparentProjectPlanItem` is one new prepared statement against an
  existing nullable column). Its stated corollary — *"prefer a design that
  makes the entry inapplicable over one that complies with it"* — is the
  right frame for grading `updateProjectPlanItem`'s new statement split
  (Override 2): rather than widening the COALESCE statement into a
  half-capable control, the plan adds a narrow statement invoked only on
  explicit intent. That is inapplicability-by-design, correctly reasoned.
- **`§9.7 HAND-SCOPED STRUCTURAL SCAN`** — G-A/G-B must derive file scope
  from `scanFiles`, never a hand-typed list. **Confirmed compliant on the
  file-scope axis.** But this entry's own sharpest lesson — "a guard with
  one derived axis and one hand-typed axis reads as derived and is trusted
  as such" (occurrence 7, `assertSingleHome`'s consumer-list axis) —
  generalizes to a **second axis of G-B that this pass finds
  under-specified**: see §4, trap 2.
- **`§9.8 OVERLOADED-ABSENCE`** — a re-parent cycle collapses "this item was
  deleted," "this item was never fetched," and "this item is corrupted by a
  cycle" into the same observable state: **absence from `roots`**, hence
  absence from the ledger, the picker, and the snapshot, with no error
  anywhere. `DEC-S4-7` names this correctly and the two-layer mitigation
  (server rejects, UI excludes) is the right shape per `§9.6`'s "structural
  cure first" rule. **One sharpening this pass adds:** `buildItemTree`'s own
  doc comment (`PlanLedgerPanel.tsx:261-264`) currently asserts *"nothing
  silently disappears"* for items whose parent doesn't resolve — a **true**
  claim about the *orphan* case (unresolved parent → falls back to
  top-level) that is **false** about the *cycle* case this phase makes
  reachable (every member of a cycle resolves to another member, so none of
  them reach `roots` — they do silently disappear). This is the same shape
  as the `unitFacts`/`compareUnitInputs` header-overclaim `§9.1` recorded on
  2026-08-05 ("any comment claiming a class of change is impossible is a
  checkable claim… find the loop that proves it or downgrade the comment").
  Recommend the comment be corrected in the same commit that adds the
  server-side cycle guard, so it does not keep asserting a guarantee the
  guard, not the function, actually provides.
- **General invariant — round-trip / partial-update integrity** (not
  catalog-specific, but directly at stake). Two "no-op" idioms now coexist in
  one function: COALESCE-null for the five original fields, `Object.hasOwn`
  intent-detection for `parent_item_id`. `text`-only edits must not touch
  placement (P3, specified) and placement-only edits must not touch `text`
  (mirror case, **not explicitly named as its own row in §5** — flagged
  already in `change-brief.md`'s open questions as an assumption, not a
  confirmed case). This is exactly the kind of two-hand-maintained-idiom seam
  where a value gets silently dropped or overwritten.
- **General invariant — wire-contract boundary integrity.** `updateItem`'s
  `null` vs. **absent key** distinction is now load-bearing
  (`api.ts` doc-comment update, Override 1/2). `undefined` must survive
  JSON serialization as an omitted key; any client code path that builds the
  patch object via spread/defaults (e.g., a form-state object initialized
  with `parent_item_id: null`) rather than deliberately deleting the key
  would silently promote every `text`-only edit to top-level. C5 pins the
  correct case (`{text}`, no `parent_item_id` key); this is the right
  assertion and needs to stay in the suite as a tripwire against any future
  refactor of the edit-in-place form's state handling.

---

## 3. Recurring-issue mapping — including two live, uncatalogued candidate
patterns this change lands next to

Beyond the numbered `§9.*` entries, `PROJECT-CONTEXT.md` carries two
**candidate** (not-yet-numbered) patterns specifically flagged against
`PlanLedgerPanel.tsx` by name, both **first-occurrence-and-fired**, both
currently **live on `master`**:

- **`MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH`** — `PlanLedgerPanel.tsx`'s
  `mergeCoverage` compares `computed_at` across renders without checking
  `project_id`, and the component is mounted unkeyed
  (`ProjectDetail.tsx:1292`), so a project switch can permanently reject the
  new project's real data. **Confirmed: this change does not touch
  `mergeCoverage` or the mount site.** But it adds new component state
  (`openItems` rebuild, add-item form draft, edit-in-place draft/toggle) to
  the *same* component this pattern is named for. `openItems` itself is
  recomputed from props every render (not a sticky ref/state comparison), so
  it is not vulnerable to this specific shape — but the **new edit-in-place
  local state** (whatever holds the in-progress text/parent-select draft)
  should be checked at build time for whether it resets correctly if the
  underlying plan/project reloads mid-edit. This project's own catalog notes
  "every future field `PlanLedgerPanel` gains inherits the same leak" as the
  generalizable risk — worth a build-time spot-check even though this slice
  is not required to fix `mergeCoverage` itself.
- **`STRICTMODE-BLIND CLIENT SUITE`** — RTL renders without `<StrictMode>`,
  so a whole class of double-invoke effect bugs (a ref torn down in cleanup
  and never re-armed on the second setup) is structurally invisible to
  `npm run test:client`, and this exact file already shipped exactly that
  defect once (`mountedRef`, 2026-08-05, caught only by human diff review,
  not by any test). This slice adds new form-local state and, per §3.5's
  spec, no new `useEffect`/`useRef` — if the actual implementation adds one
  (e.g., to reset the edit form on cancel, or to focus the add-item input),
  it should be sanity-checked for setup/cleanup symmetry by a human read,
  because the suite cannot see this class of bug regardless of how green it
  is.

Neither candidate is promoted to a numbered entry yet, and this change does
not trigger either promotion trigger on its own. Flagging both because the
change-brief already names them as "worth the test team's attention" and
because the catalog's own language is explicit that *any* new state on this
component inherits the risk profile of state already there.

**Does this change touch a surface tied to a known OPEN/WATCH/RESOLVED
entry?** Yes, directly:

- **`WATCH-S4-D`** (existing, unchanged) — `insertProjectPlanItem`'s shallow
  `parent_item_id` validation (exists-only, no same-plan/cycle check) stays
  open and unhardened; 4a makes it *reachable-in-principle* by a second
  caller only, not reachable *today*. Correctly scoped as unchanged.
- **`DEC-S4-2`** — regression-of-the-fix risk. This is a **live, shipped,
  user-reachable data-integrity defect** (orphan plan items on invalid
  `value_source`) being fixed in this same phase. Any implementation
  deviation from "validate-then-transact, catch outside the transaction"
  reintroduces a defect this project has already shipped once with a green
  suite (`D4` has been green since 2026-08-02 over exactly this bug). This
  is the single highest-severity item in this change set for exactly that
  reason: it is not hypothetical, it already happened.

---

## 4. The "ships green but broken" traps

1. **G-B's own name overclaims its scope — a second live instance of the
   NAME-OVERCLAIMING GUARD sub-shape this same intake just coined, one
   layer up (in a guard's title rather than a test's).** `technical-plan.md`
   §5 scopes G-B to exactly two regexes:
   `insertProjectPlanItem\s*\.\s*run\s*\(` and
   `reparentProjectPlanItem\s*\.\s*run\s*\(`. Its stated name is
   *"`project_plan_items` writers"* — but `updateProjectPlanItem.run(` (the
   five-field COALESCE path) and `deleteProjectPlanItem.run(` are **also**
   writers of `project_plan_items` and are **not** covered by either regex.
   If this ships as specified, a future rogue second call site to
   `updateProjectPlanItem.run(` or `deleteProjectPlanItem.run(` — e.g., a
   4b batch-claim implementer who needs to bulk-update items and reaches for
   the prepared statement directly instead of the domain function — ships
   green, because G-B's name promises comprehensive coverage of
   "`project_plan_items` writers" that its two regexes do not provide. This
   is exactly `§9.3`'s "the assertion is honest, the name is a superset of
   it" shape, applied to a structural guard instead of a behavioral test.
   **Required disposition, not optional polish:** either (a) widen G-B to
   also pin single-call-site for `updateProjectPlanItem.run(` and
   `deleteProjectPlanItem.run(`, or (b) rename it to state its actual scope
   (e.g., *"insert + reparent are each single-call-site"*) so the next
   reader does not assume delete/update are covered. Either is fine;
   shipping the current name with the current scope is not.
2. **The cycle guard's tested boundary (P5) proves depth-2, not
   depth-N.** The spec's 3-level fixture (grandparent re-parented under
   grandchild) exercises exactly one upward-walk hop past the immediate
   parent. The validation as designed (walk upward from the proposed parent
   until `itemId` is found or the walk is exhausted, bounded by the plan's
   item count) is structurally correct for any depth *if implemented as
   specified* — but this is precisely the kind of loop where an off-by-one
   bound (`< count` vs. `<= count`, or breaking one hop too early) silently
   under-walks and lets a deeper cycle through undetected, while P5 alone
   would still pass. **Required addition:** at least one fixture with depth
   ≥ 4 (so the walk must traverse at least 3 hops before finding `itemId`)
   to distinguish "the guard walks correctly" from "the guard happens to
   catch a 2-hop case." Given `§9.3`'s own repeated finding that bounded
   loops are the commonest place a guard's stated generality and its actual
   tested generality diverge, this is not a hypothetical concern on this
   project.
3. **`WATCH-S4-F`'s own factual premise about deletion is wrong, and that
   matters for anyone who reads it later and designs against it.**
   `WATCH-S4-F` frames the open question as *"whether children are orphaned
   or cascaded"* when an item is deleted. Direct read of the schema
   (`server/db.js:770-788, 794-814`) plus the global `foreign_keys = ON`
   pragma (`server/db.js:135`) shows the current behavior is **neither**:
   `deleteProjectPlanItem` (`server/lib/plan-lifecycle.js:174-181`) is a
   bare `DELETE FROM project_plan_items WHERE id = ?` with no `ON DELETE`
   clause on either the self-referencing `parent_item_id` FK or
   `value_claims.item_id`'s FK, so deleting an item with children **or**
   claims today throws an **uncaught `SQLITE_CONSTRAINT_FOREIGNKEY`**
   exception. `deleteProjectPlanItem` has no try/catch around the `.run(`
   call (unlike the planned `claimUnitIntoItem`'s UNIQUE-catch pattern), and
   no route-level or app-level error middleware was found translating a
   thrown exception into a structured response — so this is very likely a
   **raw, unstructured 500** in violation of this project's own standing
   rule ("never a raw 500," stated verbatim in `insertProjectPlan`'s own
   comment at `plan-lifecycle.js:79-83`). **This is pre-existing and out of
   4a's build scope** (`DELETE /items/:itemId` already exists, unchanged,
   with no UI calling it) — but it is *live today*, reachable by direct API
   call, and this slice's own risk analysis (`DEC-S4-7`) is exactly the
   moment this got noticed. The only test coverage for this path is the
   existence-only check at `plan-lifecycle.test.js:73` — a `§9.3`
   VACUOUS-GUARD shape that has let this ship green since the module was
   written. Not a 4a fix; **a required correction to `WATCH-S4-F`'s own
   wording** so a future implementer doesn't design a cascade/orphan UX
   decision believing the current code silently picks one when it actually
   throws.
4. **The `parent_item_id`-only round-trip mirror case (only-`text`-touches-
   only-`text`) ships as an assumption, not a named test.** If P1/P2's
   fixtures happen to only assert the field each test intends to change
   (rather than *also* asserting the untouched field), a bug where the new
   reparent statement's unconditional companion run of the five-field
   COALESCE statement corrupts an untouched field would ship green. Cheap to
   close: make P1/P2 each assert both "changed field changed" and "other
   field unchanged," or add the mirror case as its own row.
5. **A new `buildItemTree` consumer written to "look similar" instead of
   reusing `flattenItemTree` is invisible to a text-based structural scan.**
   Both the add-item parent picker and the edit-in-place parent picker
   independently need `flattenItemTree(buildItemTree(...))` with exclusion
   logic layered on for the edit case. If a future fix-round (or this
   round, under time pressure) hand-rolls a second flattening for one of the
   two, `§9.7`'s lesson applies directly: a scan for `flattenItemTree` calls
   would report clean while missing a parallel implementation that never
   calls it. C3's cross-consumer equality test is the only thing that
   actually catches this, and only if it is written as a genuine equality
   assertion across a reordered fixture, not "read the same variable twice"
   (`§9.3`'s "hardcoded literal inside a parity fixture" detector applies
   here too: if C3's two "consumers" are ever wired to derive from the same
   already-computed array rather than two independent render paths, it
   degenerates to `deepEqual(f(X), f(X))`).

---

## 5. Severity & priority

Ranked worst-first for build/test-plan sequencing:

1. **CRITICAL — data-loss / data-integrity, live-shipped defect
   (`DEC-S4-2`, D4/D4b).** Committed, orphaned plan items on invalid
   `value_source` after a valid `new_item`. Already happened once with a
   green suite. Must be red-proven by mutation by someone other than its
   author before anything else in this phase is trusted.
2. **CRITICAL — silent, unrecoverable UI corruption (`DEC-S4-7`, P4-P6,
   C7).** A re-parent cycle makes items vanish from the ledger, the picker,
   and the snapshot with no error, and — per trap 2 above — the currently
   specified test (P5) does not distinguish a correctly-general guard from
   one that only happens to catch a 2-hop case. Needs the depth-≥4 fixture
   before this can be called proven.
3. **HIGH — cross-consumer hierarchy drift (`§9.1`, C3, AC-10).** This
   project's single most-recorded defect class (7 prior occurrences). The
   plan's `flattenItemTree` shape is correct; C3 must be a genuine
   cross-consumer equality assertion (confirm at build, per the change
   brief's own flag), not two independently-passing checks.
4. **HIGH — G-B's scope/name mismatch (trap 1).** False confidence is worse
   than no guard, by this project's own stated §9.3 rationale — a green,
   comprehensively-named G-B invites the next 4b implementer to assume
   `updateProjectPlanItem`/`deleteProjectPlanItem` are protected when they
   are not.
5. **MEDIUM — round-trip / partial-update integrity (trap 4, P1-P3, C5/C6
   wire contract).** Real but recoverable if caught: a wrong-field mutation
   would be visible in normal use fairly quickly, unlike the two CRITICAL
   items above which are silent by construction.
6. **MEDIUM — pre-existing deletion/FK-constraint gap (trap 3).** Not
   introduced by 4a, correctly out of 4a's build scope, but live today and
   currently mischaracterized in `WATCH-S4-F`'s own text. Low probability
   (no UI reaches it yet) but a raw 500 on direct API misuse is a real,
   if narrow, exposure.
7. **LOW/COSMETIC — i18n key parity, `WATCH-S4-G` sibling ordering.**
   Mechanical, well-precedented on this project, correctly scoped as
   deferred where deferred.
8. **LOW — the two candidate client patterns (§3).** Not mechanically
   touched by this change; worth a build-time human spot-check on any new
   `useEffect`/`useRef` or entity-scoped state this slice actually adds,
   given the file's own history, but not blocking.

---

## 6. Disclosed-and-declined coverage — what needs a tracked row, not just
this file

Per this project's own rule (and per `technical-plan.md` §7's own table,
which already does this correctly for the deferrals it names): every risk
this pass names that isn't getting a test this round needs a
`decisions.md` PENDING/WATCH row of its own, not just a paragraph here.
Concretely, this pass identifies **three** items that are not yet covered
by an existing row:

1. **`WATCH-S4-F`'s factual premise needs correcting** (trap 3) — its
   current wording ("orphaned or cascaded") does not match the verified
   current behavior ("throws an uncaught FK-constraint exception, likely as
   a raw 500"). This is a correction to an existing row's text, not a new
   row, but it must land as a tracked edit — leaving the wrong premise in
   place risks a future implementer designing an orphan/cascade UX decision
   against a false description of what the code does today.
2. **G-B's scope-vs-name gap** (trap 1) needs an explicit disposition
   recorded before or alongside G-B's authorship — either the widened
   scope, or a dated row stating the narrower scope is deliberate and why
   (e.g., "update/delete have no known second caller yet; revisit when 4b
   or any future caller needs bulk item mutation"). Silently shipping the
   narrower guard under the broader name is the one outcome this needs to
   not be.
3. **The depth-≥4 cycle fixture** (trap 2) — if the test-architect decides
   P5's depth-2 fixture is sufficient for this round and declines the
   deeper case, that is a legitimate call, but per this project's own
   disclosed-and-declined convention it needs a dated WATCH row naming the
   decision, not a silent scope-narrowing inside the test file.

None of these three currently exist as rows in `decisions.md` or
`decisions-tech-lead-addendum.md` as of this pass (2026-08-06).
