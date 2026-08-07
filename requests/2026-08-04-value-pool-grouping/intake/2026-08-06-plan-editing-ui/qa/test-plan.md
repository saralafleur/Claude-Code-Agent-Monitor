# Test Plan — plan-editing-ui (Value Pool Slice 4, **Phase 4a only**)

> Authored by `qa-lead`, reconciling `change-brief.md`, `supporting/coverage.md`,
> `supporting/risk.md`, `supporting/unit-tests.md`, `supporting/e2e-tests.md`,
> `qa-assessment.md` (verdict **GAPPED**), `decisions-qa-addendum.md`
> (`DEC-S4-8`/`DEC-S4-9`/`DEC-S4-10`, `WATCH-S4-H`) and `catalog-patch-qa.md`
> (§9.9 promotion) into one buildable spec. **Plan only — a later step writes
> the tests.**
>
> **Scope:** Phase 4a. Phase 4b (batch group claiming) is out of scope per
> `DEC-S4-1`; `technical-plan.md` §9's I1-I8 are **not** in this plan and not in
> 4a's Definition of Done.
>
> **Headline:** **28 new-or-rewritten cases (21 server, 7 component) across 4
> spec files, plus 1 new test-helper module** — net suite growth **+20 server**
> (D4 is one existing case split into three) and **+7 client**. The derived
> `assertTableWritersSingleHome` cure is **BUILT NOW** (see §6 — with one scope
> correction the strategist's version does not have, and a live finding that
> makes that correction non-optional).

---

## 1. Objective

Phase 4a adds a plan-editing surface, a hierarchy-aware claim picker, and a
transactional single-claim composer — and today **every capability it adds is
unguarded, one of them behind a green test whose name already promises the
guarantee it does not check.** This plan pins six invariants that nothing
guards on `master` right now: (a) `POST /:id/claims` is *atomic* — a failure
after the `new_item` insert leaves no orphan item, proven both by the reachable
HTTP ordering fixture and by an independent forced-throw at the composer;
(b) `PATCH /items/:itemId` can genuinely re-parent, with `null` meaning
promote-to-top-level and an **absent key** meaning don't-touch, in both
directions; (c) a re-parent cycle is rejected server-side at arbitrary depth,
and a rejected attempt leaves **zero** trace — no item silently vanishing from
`roots` (§9.8's failure signature); (d) one hierarchy derivation
(`buildItemTree` → `flattenItemTree`) drives every consumer, proven by
cross-consumer *equality* over a reordered fixture, not by two independent
assertions; (e) the parent picker excludes self **and every descendant**, proven
at depth 4; and (f) **every writer of `project_plan_items` and `value_claims` —
derived from `server/db.js`'s own statement registry plus an inline-SQL scan,
never hand-listed — has exactly one call site whose enclosing function is a
named, dated, reviewed home.** End state: the two tables at the centre of this
initiative acquire a writer guard whose scope cannot drift narrower than its
name, and the four newly-editable behaviours acquire real red-proven tests.

---

## 2. Coverage gap being closed

Each row is an UNGUARDED surface from `qa-assessment.md`, tied to this
project's defect-catalog id where one applies.

| # | UNGUARDED surface | Catalog id | What now pins it |
|---|---|---|---|
| 1 | `POST /:id(\d+)/claims` atomicity — **unguarded behind a green, purpose-named test** since 2026-08-02; live orphan-item defect | **§9.9 NAME-OVERCLAIMING GUARD** occ. 1 (promoted by `catalog-patch-qa.md`); `DEC-S4-2` | **D4 (rewritten)**: valid `new_item` + invalid `value_source` → 400 **and item count unchanged**, red on `master`. **PX**: forced `insertValueClaim.run` throw at the composer → item row absent. Both, not either (`DEC-S4-10`). |
| 2 | `PATCH /items/:itemId` → `parent_item_id` (zero tests; documented no-op with nothing asserting even that) | §9.9 (a *type* overclaiming: `api.ts` advertises `number \| null`) | **P1, P2** (`null` = promote, strict `=== null`), **I1** at the wire. |
| 3 | Partial-update integrity — two coexisting "no-op" idioms (`COALESCE` vs `Object.hasOwn`) | general round-trip invariant; risk §4 trap 4 | **P3** (text-only leaves placement) and **P3-mirror** (placement-only leaves text), each asserting *both* "changed changed" and "untouched untouched". |
| 4 | Re-parent cycle → items vanish from `roots`, ledger, picker and snapshot with no error | **§9.8 OVERLOADED-ABSENCE**; `DEC-S4-7` | **P5** at **depth ≥ 4** (`DEC-S4-10`), **P5b** bounded-walk vs. a pre-existing corrupt row, **I2** dynamic cycle + zero-trace `deepEqual`, **C7** UI exclusion at depth 4. |
| 5 | `buildItemTree` gaining consumers #2-#4 with no cross-consumer proof | **§9.1 DERIVED-DUAL-VIEW** (7 occ., OPEN) | **C3** cross-consumer `{id, depth}[]` equality, asserted **before and after reordering the input array**. |
| 6 | No writer guard on `project_plan_items` / `value_claims`; the planned G-A/G-B were themselves hand-scoped | **§9.7 HAND-SCOPED STRUCTURAL SCAN** (7 occ., OPEN — "cure remains half-built"); §9.9 pre-flag 1; `DEC-S4-8` | **G-1/G-2** via the derived `assertTableWritersSingleHome` helper: writer set derived from `db.js`, homes asserted by **enclosing-function identity**, inline SQL writes caught too. |
| 7 | `deleteProjectPlanItem` real behaviour — only test naming it is `A2.10`, an existence check promising a 409 | §9.9 occ. 2; `DEC-S4-9` | **PZ** characterization pin: delete-with-child and delete-with-claim **throw** `SQLITE_CONSTRAINT_FOREIGNKEY` today. Explicitly labelled a pin, not an endorsement. |
| 8 | `client/src/lib/api.ts` `updateItem` — no test file exists; the `null`-vs-absent-key wire contract is exercised by nothing | §9.9 (type-level overclaim) | **C5** (absent key), **C6b** (explicit `null`), **I1 step 5** (the same contract over real HTTP). *Not closed: `api.ts`'s own URL/method construction stays mock-shadowed — see §10.* |
| 9 | Locale parity for new `planLedger.*` keys | — | Already mechanical: `i18n.test.ts` E1.1 derives namespaces from the filesystem and the key set from `en`. **No new test.** Adding the keys to all four locales in the same commit is the whole obligation. |

---

## 3. Test change set

Layers, discovered from `package.json` and the tree (not assumed): **server
suite** (`node --test`, one child process per file) which internally carries
three distinct shapes — *route/HTTP* (this project's "e2e": real Express +
real throwaway SQLite, no browser harness exists), *domain-unit*, and
*structural-guard*; **client component** (Vitest + RTL); **client screen
snapshot**; **i18n parity** (inside the same Vitest run).

### 3.1 Server — route/HTTP layer (this project's "e2e")

`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/project-plans-api.test.js`
— **update**. Reuse the file's own `makeProject`/`post`/`patch`/`fetch`/`del`
helpers (lines 27-68) and its per-group `before()` idiom. No new file: 4a adds
no route and no new behavioural shape.

- **D4 — REWRITE in place** (replaces today's lines 494-523; Group D).
  `POST /:id/claims` with a **valid** `new_item` and an **invalid**
  `value_source` → `400`, and `listProjectPlanItems` for that plan returns the
  same count as before the request. Exact fixture bound by `DEC-S4-2` /
  `DEC-S4-10`. Do **not** extend the old case — replace it (§9.9 "replace,
  never extend").
- **D4-empty-text — ADD** (the old D4's fixture, kept verbatim, honestly
  renamed): `new_item: { text: "" }` → `400 INVALID_INPUT`, item count
  unchanged, with a comment stating it exercises `insertProjectPlanItem`'s
  pre-write input guard and **is not evidence of atomicity**.
- **D4-happy — KEEP** (the passing half of today's D4, renamed): valid
  `new_item` + valid claim fields → `201`; the returned `claim.item_id`
  resolves to an item with the submitted text.
- **D4b — ADD, documentation only.** Duplicate claim on a pre-existing
  `item_id` → `409 DUPLICATE_CLAIM`, byte-identical message to D2's, item count
  unchanged. Comment must say: *reuses D2's shape for `DEC-S4-2` DoD
  traceability; red-proves nothing D2 does not already prove; never cite as the
  atomicity proof.*
- **I1 — ADD** (new `describe("Group I: hierarchy-aware editing + claim flow
  (Slice 4a)")`, placed after Group H, before Group S). One flow, one fixture:
  `POST /:id/items {text:"Parent"}` → `POST /:id/items {text:"Child",
  parent_item_id: parent.id}` → `PATCH /items/child {text:"Child, renamed"}`
  (**no `parent_item_id` key**) → `GET /:id` asserts text changed **and**
  placement unchanged → `PATCH /items/child {parent_item_id: null}` (**no
  `text` key**) → `GET /:id` asserts `parent_item_id === null` **and** text
  still `"Child, renamed"` → `POST /:id/claims {item_id: child.id, …}` → `201`
  whose response key set is `deepEqual` to the key set D1 already asserts
  (AC-13, checked at the wire, not by reading the delegator) → `GET /:id`
  shows the claim nested under the child.
- **I2 — ADD** (same Group I, own fixture). `A` top-level, `B` and `C` both
  children of `A`. `PATCH /items/C {parent_item_id: B.id}` → `200`; the **very
  next** `GET /:id` (no intervening write) shows `C` under `B`. Claim a unit
  into `C` → `201`; next `GET /:id` shows the claim under `C` under `B`.
  Then `PATCH /items/B {parent_item_id: C.id}` — a cycle created **only by
  this test's own prior mutation** → `400 INVALID_INPUT`; the immediately
  following `GET /:id` is `deepEqual` to the pre-attempt read (same edges, same
  claim placement, **same item count** — nothing dropped out of `items`). That
  final `deepEqual` is the §9.8 positive check and is the point of the case.

### 3.2 Server — domain-unit layer

`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/plan-lifecycle.test.js`
— **update**. New cases go in their own `describe("re-parent + claim composer
(Slice 4a, DEC-S4-7/DEC-S4-2)")` block; read the file's existing DB bootstrap
and match it, do not invent a second setup style. All cases call
`planLifecycle.updateProjectPlanItem` / `planLifecycle.claimUnitIntoItem`
directly.

- **P1 — ADD.** `updateProjectPlanItem(db, A.id, {parent_item_id: B.id})` →
  returned row and a **fresh `getProjectPlanItem` read** both show `B.id`.
- **P2 — ADD.** Sub-item `C` → `{parent_item_id: null}` → fresh read
  `assert.equal(row.parent_item_id, null)` — **strict equality to the expected
  new value**, never `!= B.id` (a `COALESCE`-based regression leaves `B.id`,
  which a loose assertion would pass).
- **P3 — ADD.** `{text:"after"}` only, key genuinely absent (`{text}`, **not**
  `{text, parent_item_id: undefined}` — not equivalent to `Object.hasOwn`) →
  `text === "after"` **and** `parent_item_id === B.id`.
- **P3-mirror — ADD.** `{parent_item_id: null}` only → `parent_item_id === null`
  **and** `text === "original text"`. (The change-brief's flagged assumption,
  now its own named case per `qa-assessment.md` must-add #7.)
- **P4 — ADD.** Self-parent → `isDomainError`, `code === "INVALID_INPUT"`,
  message `"an item cannot be its own parent"` (exact string); re-read shows
  the row unchanged.
- **P5 — ADD, depth ≥ 4** (`DEC-S4-10`, binding). Chain `G → H → I → J` (four
  real rows, three hops). Re-parent `G` under `J` → `isDomainError`,
  `"parent_item_id would create a cycle"`, `G.parent_item_id` still `null`.
  A depth-2 or depth-3 fixture is **not acceptable** — it cannot distinguish a
  correct walk from an off-by-one bound.
- **P5b — ADD.** Bounded-walk companion: write a **self-referencing corrupt
  row** directly via a raw statement (bypassing validation, simulating legacy
  import corruption per `WATCH-S4-D`), then re-parent an *unrelated* item in
  the same plan. Assert the call returns within the default test timeout and
  throws no range/recursion error — the walk gives up after at most the plan's
  item count.
- **P6 — ADD.** Parent in a different plan → `INVALID_INPUT`,
  `"parent_item_id belongs to a different plan"`, row unchanged.
- **P7 — ADD.** Re-parent on a **closed** plan → `ALREADY_CLOSED`,
  `"plan is closed"` — grep `updateProjectPlanItem`'s existing closed-plan
  guard first and assert the *identical* string, don't assume it.
- **PA — ADD** (`updateProjectPlanItem`'s own transaction).
  `{text: "new text", parent_item_id: L.id}` (self-parent, guaranteed
  rejection, combined with a text change) → `isDomainError` **and** a fresh
  read shows `text === "old text"` — the rejected placement did not let the
  text edit through.
- **PX — ADD** (the load-bearing atomicity proof, `DEC-S4-10`). Call
  `claimUnitIntoItem` with a valid `new_item` and valid claim fields, with
  `dbModule.stmts.insertValueClaim.run` replaced by a one-shot thrower,
  **restored in a `finally`**. Assert the composer propagates (non-`UNIQUE`
  throws are *not* swallowed into a domain error, per §3.2 step 4's
  catch-outside-the-transaction rule) **and** that no `project_plan_items` row
  with the submitted text exists afterwards.
- **A2.20 — ADD** (rewritten from the e2e architect's under-specified version,
  see §3.6). After re-parenting `C` under `B` **within the same plan**,
  `claimUnitIntoItem(db, planId, {item_id: C.id, …})` still succeeds, and
  `claimUnitIntoItem(db, otherPlanId, {item_id: C.id, …})` returns the existing
  `"item_id does not belong to this plan"` domain error — membership is
  resolved against current state on every call, never cached from a prior
  resolution.
- **PZ — ADD** (`DEC-S4-9` characterization pin). `deleteProjectPlanItem` on an
  item that has a child **throws**, and on an item that has a claim **throws**,
  both `SQLITE_CONSTRAINT_FOREIGNKEY`. Comment verbatim in spirit:
  *characterization of today's behaviour, **not** an endorsement; rewrite this
  case when the cascade-vs-refuse-vs-reparent rule is decided (`WATCH-S4-F`).*

### 3.3 Server — structural-guard layer (the durable cure)

`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/helpers/table-writers.js`
— **NEW file.** Must carry the project file header with the exact
`@author Son Nguyen <hoangson091104@gmail.com>` line (`.claude/rules/file-headers.md`).
Sits beside the existing `helpers/single-home.js`, the project's other
durable-cure helper — reuse that file's conventions, do **not** invent a second
style.

```js
assertTableWritersSingleHome(tableName, { statementHomes, inlineWriterDispositions })
```

Five checks, in order. **Every axis is derived; the only hand-typed input is
the reviewed home/disposition list, and its completeness is itself asserted.**

1. **Parse the registry.** Read `server/db.js`, isolate the `const stmts = {`
   … matching `};` region (today lines 2288-3525) by brace walk, and parse
   every `name: db.prepare(<string literal>)` entry (backtick and quoted forms).
   **Parser-completeness assertion:** the number of parsed entries must equal
   the number of `db.prepare(` occurrences inside that region. If this is red
   on first run, **fix the parser or disposition the offending entry by name —
   never delete or narrow the assertion.** (Verified live 2026-08-06: 222
   registry-shaped entries file-wide, all inside the region.)
2. **Derive the writer set:** entries whose SQL matches
   `/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+<table>\b/i`. Assert non-empty.
   On `master` today: `project_plan_items` → `insertProjectPlanItem`,
   `updateProjectPlanItem`, `deleteProjectPlanItem` (+ `reparentProjectPlanItem`
   after step 8); `value_claims` → `insertValueClaim`, `deleteValueClaim`.
3. **Registry completeness:** `Object.keys(statementHomes).sort()` must
   `deepEqual` the derived writer names, sorted. **A prepared statement added
   tomorrow is automatically in scope and red until someone dispositions it.**
   This is the line that makes the cure a cure.
4. **Identity, not arity** (`DEC-S4-8` finding 4). For each writer: derive its
   file set with `scanFiles(serverDir, new RegExp(name))` (which already skips
   `node_modules`/`dist`/`__tests__`), `stripComments` each file, find every
   `name\s*\.\s*run\s*\(`, and resolve each occurrence's **enclosing span** by
   brace-walking from its declared anchor. Assert the sorted list of actual
   `{file, anchor}` homes `deepEqual`s the expected list. A count assertion is
   explicitly rejected: deleting the legitimate legacy site and adding a rogue
   one elsewhere keeps a count green.
5. **Inline-write axis** (this plan's addition — see §6 for why it is not
   optional). Scan every `server/**/*.js` except `db.js` and `__tests__` for
   `.prepare(` string literals whose SQL writes `<table>`. Each hit's
   `{file, anchor}` must appear in `inlineWriterDispositions`, each entry
   carrying a `dated` and a `reason`. A statement-name regex cannot see these.

Then, in
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/single-writer-guard.test.js`
— **update**, two cases replacing the planned G-A/G-B:

- **G-1 — ADD.** `assertTableWritersSingleHome("project_plan_items", …)` with:
  - `insertProjectPlanItem` → `[{file: "lib/plan-lifecycle.js", anchor: "function insertProjectPlanItem"}, {file: "lib/plan-lifecycle.js", anchor: "const doImport =", dated: "2026-08-06", reason: "legacy AGENT-PLAN.md two-pass import — insert-all-then-resolve-nesting is structurally incompatible with insertProjectPlanItem's single-pass signature; pre-existing, unrelated to 4a"}]`
  - `updateProjectPlanItem` → `[{…, anchor: "function updateProjectPlanItem"}]`
  - `deleteProjectPlanItem` → `[{…, anchor: "function deleteProjectPlanItem"}]`
  - `reparentProjectPlanItem` → `[{…, anchor: "function updateProjectPlanItem"}]` (the placement branch)
  - `inlineWriterDispositions`: **one** entry —
    `server/lib/plan-lifecycle.js`, anchor `const doImport =`, SQL
    `UPDATE project_plan_items SET parent_item_id = ? WHERE id = ?`
    (**live at `plan-lifecycle.js:288-290`, found by this pass**), dated
    `2026-08-06`, reason: legacy import's second pass; obligation to route it
    through `reparentProjectPlanItem` when the import path is next touched
    (**`WATCH-S4-I`**, see §8).
  - Standing comment above both lists, copied in spirit from
    `chronology-ordering.test.js`'s `GRANDFATHERED_QUERIES`: *never widen this
    list silently to make a real new violation go away.*
- **G-2 — ADD.** `assertTableWritersSingleHome("value_claims", …)` with
  `insertValueClaim` → `[{file: "lib/plan-lifecycle.js", anchor: "function claimUnitIntoItem"}]`
  and `deleteValueClaim` →
  `[{file: "routes/project-plans.js", anchor: "router.delete(\"/claims/:claimId"}]`,
  dated `2026-08-06`, reason: the unclaim path is not yet extracted into a
  composer; 4b's batch unclaim must extract it rather than add a second call
  site (**`WATCH-S4-J`**, see §8). No inline writers expected — assert the
  empty set, do not omit the axis.

> `claimUnitIntoItem` must be declared as a `function` declaration (matching
> `plan-lifecycle.js`'s existing style) or G-2's anchor must be updated in the
> same commit.

### 3.4 Client — component layer

`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/components/__tests__/PlanLedgerPanel.test.tsx`
— **update**. New cases go in a **separate `describe("PlanLedgerPanel: item
CRUD + hierarchy picker (Slice 4a, DEC-S4-3/S4-7)")`** block, because this file
already has unrelated `C1:`/`C2:` labels in its freshness-marker tests (~lines
552, 740); keep the plan's `C1`…`C7` labels (the DoD cites them) and let the
describe block disambiguate. Extend the existing `vi.mock("../../lib/api")`
block (lines 35-50) with `mockAddItemMock`/`mockUpdateItemMock`, following the
existing `mockClaimMock`/`mockCloseMock` pattern. Extend the existing
`makePlan`/`makeItem`/`makeUnit` factories — no parallel factories.

- **C1 — ADD.** Add-item form on an open plan: submit `"New top-level item"` →
  `addItem` called **exactly once** with `(planId, { text })` — **exact object
  match, not `objectContaining`**, so a stray `parent_item_id: undefined` key
  fails; after the sequenced refetch the item is visible.
- **C2 — ADD** (two parts). **A:** with a parent selected → `addItem` called
  with `(planId, { text, parent_item_id: 40 })`, exact match. **B:** on a
  `status: "closed"` plan, `data-test="add-item-form"` scoped by `within` is
  **absent from the DOM**, not merely disabled — add this assertion to the
  existing "closed generation exposes no item-edit/claim/unclaim affordances"
  case (line ~357) rather than duplicating the closed-plan fixture a third time.
- **C3 — ADD** (highest-value client case, AC-10, §9.1). 3-level fixture
  `R → Citem → Gitem` plus sibling root `R2`. Derive a `{id, depth}[]` array
  **independently from each consumer**: from `ItemTree`'s rendered rows
  (indent/`paddingLeft`, or a `data-depth` attribute if the build adds one) and
  from the picker's `<option>`s (parse `"  ".repeat(depth) + "└ "`).
  `deepEqual` the two arrays. **Then re-render with `plan.items` in a different
  array order** (same tree, shuffled) and assert both arrays are unchanged from
  step 1 **and** still equal each other. If the two "consumers" ever read the
  same already-computed array, the case degenerates to `deepEqual(f(X), f(X))`
  — the reorder step is what makes it real.
- **C4 — ADD** (two parts). **A:** claiming into a **sub-item** calls
  `claim("proj-1", subItem.id, unit)`. **B:** plan with `items: []` → claim
  control absent; then the add-item flow produces the first item via a
  `list()` refetch **in the same render lifecycle — do not call `render()`
  again** → the claim control appears and its button is **enabled with no
  further interaction** (`effectiveTargetId`'s render-time fallback).
- **C5 — ADD.** Edit-in-place, text only → `updateItem(60, { text })` with
  **no `parent_item_id` key at all** — not `undefined`, not `null`. This is the
  client half of the wire contract and the tripwire against any future
  form-state refactor that spreads a default object.
- **C6 — ADD** (two parts). **A:** re-parent via edit → `updateItem` called
  with the chosen `parent_item_id`, exact object shape (assert whatever the
  real shape is; no silent extra keys). **B:** promote-to-top-level sends
  `parent_item_id: null` **explicitly present and `null`** — the case a
  `selectedValue || undefined` implementation silently breaks. Client mirror of
  P2; review the two together.
- **C7 — ADD, 4-level fixture.** `R → Citem → Gitem → Hitem`, plus unrelated
  root `R2`, plus a second plan `B` with item `X`. Open edit-in-place on
  `Citem` (has both an ancestor and two levels of descendants) and assert its
  parent `<select>` options: `Citem` absent, `Gitem` absent, **`Hitem`
  (grandchild) absent** (the case a direct-`children`-only walk leaks), `R`
  present, `R2` present, a top-level sentinel present, `X` absent.
  **Additionally required by `qa-assessment.md` must-add #5: read the exclusion
  code by hand at review.** A text scan cannot see a hand-rolled
  re-derivation, and a fixture cannot prove the walk reuses
  `ItemNode.children`.
- **Regression, unmodified:** the existing `"calls api.projectPlans.claim
  exactly once with (itemId, unit)"` case (~line 230) must pass with its
  assertion shape **unchanged** after `openItems` is rebuilt.

### 3.5 Client — snapshot & i18n

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/pages/__tests__/screens.snapshot.test.tsx`
  — **update by reviewed regeneration only.** Read the diff, confirm every
  changed node is an intended new affordance, then `cd client && npx vitest run -u`.
  Blind `-u` is a policy violation (CLAUDE.md; `WATCH-S4-A`).
- `client/src/i18n/__tests__/i18n.test.ts` — **no change.** E1.1 is
  filesystem-derived and will fail automatically if `planLedger.*` is missing
  from `ko`/`vi`/`zh`. Do not hand-add a key list anywhere.

### 3.6 Layer reconciliation — what I moved, and why

The unit and e2e architects overlap in three places. Resolved as follows;
**these are decisions, not options**:

1. **Round-trip permutations stay at the domain layer; the wire keeps exactly
   one.** Both directions of "absent means unchanged" are exhaustively pinned by
   **P3 / P3-mirror** (domain, cheap). The e2e design proposed both directions
   at HTTP as well. **Kept at HTTP: both, but only inside I1's single existing
   flow** — because the *placement-only* direction is the one where JSON
   serialization of an explicit `null` versus an omitted key can only be
   observed at the route boundary, and the text-only direction is already the
   free preceding step of the same flow. No separate HTTP cases are added for
   them.
2. **Cycle validation permutations stay at the domain layer.** P4/P5/P5b/P6/P7
   own the exhaustive matrix. E2E gets **exactly one** cycle assertion (I2), and
   only because it must be reached *dynamically* — the cycle exists solely
   because of the test's own prior re-parent, which a static P5 fixture cannot
   demonstrate. Routing the other four validation branches through Express would
   add cost and no information.
3. **The e2e architect's A2.20 is rewritten, not adopted as drafted.** Its own
   text hedges between three mutually-exclusive fixtures ("or equivalently…").
   Replaced by the crisp two-assertion form in §3.2 (same-plan re-parent still
   claimable; cross-plan `item_id` still rejected). **The e2e architect's "flow
   3" non-interference case is dropped as a case entirely** — it is not an
   assertion, it is the file already running; it survives as a DoD line
   (§9) instead.

### 3.7 Fixtures / test data

Reuse everything: `makeProject`/`post`/`patch`/`fetch`/`del`
(`project-plans-api.test.js` lines 27-68); `plan-lifecycle.test.js`'s existing
DB bootstrap; `makePlan`/`makeItem`/`makeUnit` (`makeItem` already supports
`parent_item_id`). **New fixtures needed, all small and per-case:** the depth-4
re-parent chain (P5), the corrupt self-referencing row written via a raw
statement (P5b), the 4-level tree + second plan (C7), and Group I's two
per-flow seeded plans. No shared cross-case state; no new helper factories.

---

## 4. Implementation steps

Numbered in dependency order and interleaved with `technical-plan.md` §4's
build steps (cited as **B1**…**B14**). Each is independently checkable.

1. **B1 (branch cut) unchanged** — including the `ps`/`lsof` + confirm-with-Sara
   check before any git operation, and applying `catalog-patch.md` **then**
   `catalog-patch-qa.md`, deleting both in that commit.
   *Checkable:* one catalog; §9.9 exists; both patch files gone.
2. **Write D4's rewrite and run it against unmodified `master`.**
   *Red-first:* on `master` the handler inserts the item, **then** validates
   `value_source` (`project-plans.js:499-540`), so the 400 comes back with an
   orphan item committed — the item-count assertion fails. **Observe it red and
   paste the actual failure output into the build log** (§9.3
   AGENT-SELF-REPORTED-RED). Add D4-empty-text and D4-happy in the same commit.
   *Checkable:* D4 red for the stated reason, before any product change. (= B2)
3. **Write PX (composer forced-throw).** It cannot run until `claimUnitIntoItem`
   exists, so write it now and let it fail on the missing export; **that failure
   is not the red proof** — step 5 is.
4. **B3/B4: extract `claimUnitIntoItem`, reduce the route to a delegator.**
   *Checkable:* D4 green; every pre-existing Group D case passes **unmodified**;
   the six error strings verified byte-identical by diff-read.
5. **B5: mutation-prove atomicity, by someone other than D4's author.** Remove
   the `transaction(...)` wrapper → **D4 and PX both go red**; restore
   byte-identical → both green. *Red-first for PX:* without the transaction the
   forced `insertValueClaim.run` throw leaves the already-committed item row
   behind; with it, the item insert rolls back. Report actual command output.
   *Checkable:* two observed failure texts in the build log.
6. **Add D4b** (documentation-only, commented as such).
7. **Write P1-P7, P3-mirror, PA against unmodified `master`.**
   *Red-first:* `updateProjectPlanItem` destructures only
   `{text, acceptance, detail, checked, position}` — P1/P2/P4/P5/P6 fail
   (placement silently unchanged / no validation exists); **P3 passes trivially
   and must be expected to** (it is a regression pin — its value is staying
   green while P1/P2 flip). *Checkable:* the exact expected red set observed
   before B6.
8. **B6/B7: add `reparentProjectPlanItem` + the `Object.hasOwn` branch and the
   four-step validation chain inside one transaction.**
   *Checkable:* P1-P7, P3-mirror, PA green; every pre-existing case in that file
   passes unmodified. **Confirm the intermediate red state P5 names:** a build
   that adds the statement but not yet the cycle check makes P5 fail *for a
   different reason* (silent success) — see it, then fix it.
9. **Add P5b, A2.20 and PZ.** *Red-first:* P5b hangs or throws a recursion
   error against a walk with no bound (verify by temporarily removing the bound
   — the same mutation-proof discipline as everywhere else); A2.20 fails until
   `claimUnitIntoItem` exists; **PZ is green on arrival** — it characterizes
   today's behaviour, mutation-proven by disabling the `foreign_keys` pragma
   locally and observing it fail. Comment that distinction in the test.
10. **Build `helpers/table-writers.js`** (§3.3), header first, then **G-2
    (`value_claims`) before G-1**, because G-2 carries a natural red→green:
    *Red-first:* on `master` `insertValueClaim.run(` sits in
    `routes/project-plans.js:549`, not in `claimUnitIntoItem`, so the
    enclosing-function identity check fails. It goes green only because step 4
    moved the write. (If step 4 already landed, re-verify by stashing it.)
11. **Add G-1 (`project_plan_items`).** *Red-first, three mandatory mutation
    proofs — this is the price of shipping the helper* (see §6):
    (a) add a throwaway `insertProjectPlanItem.run(...)` call in a new
    enclosing function → identity check red; revert.
    (b) add a throwaway `db.prepare("DELETE FROM project_plan_items WHERE id = ?")`
    inline call in `server/lib/` → inline-write axis red; revert.
    (c) add a throwaway `zzzTestWriter: db.prepare("UPDATE project_plan_items SET position = ?")`
    to `db.js`'s `stmts` → **registry-completeness** red (undispositioned
    writer); revert.
    Each observed failure text goes in the build log. *Checkable:* G-1 green
    with `reparentProjectPlanItem` present and the two dated dispositions in
    place. (= B8, replacing G-A/G-B)
12. **B9/B10: `flattenItemTree` + `openItems` rebuild; indent the picker; fix
    the stale target.** Write **C3** and **C4** first and observe them red:
    C3 because the picker has no depth to parse (a parse throw counts as a
    failure, never a skip), C4b because `targetItemId` is initial-value-only
    (line 486) and stays `null`/disabled after the first item appears.
    *Checkable:* C3/C4 green; the existing ~line-230 claim test passes with its
    assertion shape unmodified.
13. **B11: add-item form + i18n keys in all four locales.** Write **C1/C2**
    first; both fail hard on a missing `data-test="add-item-form"`.
    *Checkable:* C1/C2 green; `i18n.test.ts` E1.1 green with no hand-typed key
    list.
14. **B12: edit-in-place + self/descendant exclusion.** Write **C5/C6/C7**
    first; all fail on the absent edit UI. *Checkable:* C7's **grandchild**
    assertion green, plus a human read of the exclusion walk confirming it
    consumes `ItemNode.children` and does not re-derive from `parent_item_id`.
15. **B13: full suites + reviewed snapshot regeneration.** `npm run test:server`
    green at **1787 + 20 = ≥ 1807** and `npm run test:client` green at
    **822 + 7 = ≥ 829** (21 server cases are new-or-rewritten; the net count is
    +20 because D4 is one existing case split into three). Snapshot diff read
    before `-u`.
16. **B14: file-header audit + docs**, plus the two non-test corrections this
    plan carries (§8): `WATCH-S4-F`'s wording and `buildItemTree`'s doc comment,
    the latter in the **same commit as the cycle guard**.

---

## 5. Single-source-of-truth guardrail

This project has three canonical sources that drive multiple rendered outputs.
The tests must assert the outputs agree with the source, and must never bless a
hand-edited path that bypasses it.

1. **`server/db.js`'s `stmts` registry is the canonical writer registry.**
   G-1/G-2 derive their entire scope from it (§3.3 checks 1-3) and additionally
   scan for inline SQL that bypasses it (check 5). **Forbidden fixes:** adding a
   statement name to the test by hand, narrowing a regex to dodge a red, or
   widening `statementHomes`/`inlineWriterDispositions` without a name, a date
   and a reason. A new writer must be *dispositioned*, never *absorbed*.
2. **`buildItemTree` is the canonical `parent_item_id → tree` derivation.** Its
   consumers (read-only tree, claim picker, add-item picker, edit-in-place
   picker) must all render `flattenItemTree(buildItemTree(...))`. **C3 is the
   executable proof and it must compare the two consumers to each other, not
   each to a hand-written expectation** — a hand-written expectation is exactly
   the hand-edited path §9.1 says gets blessed. A second hand-rolled flattening
   is invisible to any text scan; only C3's reordered-input equality catches it.
3. **`en/projectDetail.json` is the canonical key set.** E1.1 derives from it.
   Never add a key list to a test; add the keys to all four locales in the same
   commit.

---

## 6. Durable-cure decision — **BUILD `assertTableWritersSingleHome` NOW**

**Decision: build the derived helper in 4a, replacing both planned hand-scoped
guards (G-A, G-B) with two derived cases (G-1, G-2) — and extend it with an
inline-write axis the strategist's version does not have.** This upholds
`DEC-S4-8`'s `DECIDED-AUTO: accept now` and does not require Sara to re-decide.

**Why the scope call goes this way, against `DEC-S4-1`'s tight-scoping bias.**
`DEC-S4-1` scopes *product* work tightly so 4a can ship independently of Slice
3. The helper adds no product surface, no route, no schema, and no runtime
dependency — it is ~80 lines in `server/__tests__/helpers/`, purely subtractive
to revert, and it *replaces* rather than adds to work already committed (two
hand-scoped guards were being written anyway, and all existing writers are
already single-call-site, so it lands green). The tight-scoping principle is
about not entangling 4a's ship with 4b's blockers; the helper entangles nothing.

**And a live finding this pass made converts "cheapest chance" into "the only
version that works."** `server/lib/plan-lifecycle.js:288-290` contains an
**inline, ad-hoc `db.prepare("UPDATE project_plan_items SET parent_item_id = ? WHERE id = ?").run(...)`**
inside `importLegacyPlan`'s `doImport` — a fifth writer of the table, with no
statement name, doing *exactly what 4a's new `reparentProjectPlanItem` will do*.
Neither G-B as specified, nor the widened four-regex G-B of `DEC-S4-8` option B,
nor a helper that only enumerates `db.js`'s prepared statements would see it. A
guard named "`project_plan_items` writers", green, while a hand-rolled re-parent
write sits in the same file it guards, is §9.9 recurring **inside its own cure**
— and §9.1's twice-proven corollary (*a rogue-reader scan does not catch a rogue
re-derivation*) applied to SQL. The inline-write axis (check 5) is therefore not
a refinement; without it the cure is a name-overclaim.

**Consequence of deferring** (for the record, since this is the call being made,
not offered): §9.7's cure stays "half-built" for an eighth occurrence; the four
point guards remain honest but frozen at the writer set someone typed on
2026-08-06; 4b's batch-claim implementer — the concretely foreseeable next
caller who will want to bulk-mutate plan items — gets a green checkmark named
after a guarantee nobody re-derives. Every one of those is a documented failure
this project has already shipped.

**The price, made explicit and non-negotiable.** This project's *other* derived
helper (`helpers/single-home.js`) shipped **two** bugs of exactly the
"resolved-one-directory-too-deep" kind, both recorded in its own header. A
derived guard that is silently under-scanning is worse than a hand-scoped one,
because its name is stronger. So the helper ships **only** with the three
mutation proofs of step 11 (rogue call site → red; inline write → red;
undispositioned new statement → red) observed and pasted into the build log, and
with the parser-completeness assertion of check 1 in place.

**The one permitted fallback, with its trip-wire named** (disclosed-and-declined
discipline, not a menu): if the helper cannot be made green **without weakening
any of its five checks**, abandon it, ship four hand-scoped point guards per
`DEC-S4-8` option B — `insertProjectPlanItem`, `updateProjectPlanItem`,
`deleteProjectPlanItem`, `reparentProjectPlanItem`, each with
enclosing-function identity — **plus** a hand-written case pinning the
`plan-lifecycle.js:288` inline writer, and open a dated WATCH row for the
helper. Weakening a check to keep the helper is the one outcome that is not
permitted.

**Other durable cures, dispositioned:** Cure 2 (widening §9.3's detector to any
artifact stating a guarantee) is documentation and lands via
`catalog-patch-qa.md`'s §9.9 in step 1 — no test work. Cure 3 (the 11 vacuous
`A2.x` cases) stays declined and tracked as `WATCH-S4-H`; 4a writes 13 real
cases into that file and must not "adjust until green" any of the 11.

---

## 7. How to run

`PROJECT-CONTEXT.md` configures no separate QA command set; these are the
project's own commands (CLAUDE.md + `technical-plan.md` §5).

```bash
# Server — all three shapes (route/HTTP, domain-unit, structural guard)
npm run test:server

# Per-file, while iterating (node --test has no per-case name filter)
node --test server/__tests__/project-plans-api.test.js
node --test server/__tests__/plan-lifecycle.test.js
node --test server/__tests__/single-writer-guard.test.js

# Client — component + snapshot + i18n parity, one run
npm run test:client
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "C3"
cd client && npx vitest run -u    # ONLY after reading the snapshot diff

# Headers (must exit 0)
bash .claude/skills/file-headers/scripts/check-headers.sh
```

No external service, Docker, or seeded DB: the server specs boot a throwaway
SQLite file and an ephemeral in-process server on port 0.

---

## 8. Corrections and tracked rows this plan requires

Not tests, but part of this plan's Definition of Done because each is a
name/premise that would otherwise mislead the next reader (§9.9's acceptance
criterion).

- **`WATCH-S4-F`'s wording** — corrected per `DEC-S4-9` to state the verified
  behaviour (FK throw / raw 500; no orphan and no cascade exists to choose
  between; the open product question is three-way). Mandatory; not optional.
- **`buildItemTree`'s doc comment** (`PlanLedgerPanel.tsx:261-264`) — *"nothing
  silently disappears"* is false for the cycle case 4a makes reachable.
  Corrected **in the same commit as the cycle guard**, so it stops asserting a
  guarantee the guard, not the function, provides.
- **`WATCH-S4-I` (new row required)** — `plan-lifecycle.js:288-290`'s inline
  `UPDATE project_plan_items SET parent_item_id = ?` duplicates
  `reparentProjectPlanItem`. Dispositioned (dated) in G-1 for 4a; route it
  through the prepared statement when the legacy-import path is next touched.
  **Fires-on:** any change to `importLegacyPlan`.
- **`WATCH-S4-J` (new row required)** — `deleteValueClaim.run(` lives in the
  unclaim route, not in a composer, so `plan-lifecycle.js`'s header claim to be
  the sole `value_claims` writer is not yet true for the delete path.
  Dispositioned (dated) in G-2. **Fires-on:** 4b's batch unclaim, which must
  extract a composer rather than add a second call site.

---

## 9. Definition of Done — Phase 4a

Supersedes nothing in `technical-plan.md` §8; adds the QA-side rows.

- [ ] **Red-before/green-after observed and pasted as real command output** (not
      described as an intention, §9.3 AGENT-SELF-REPORTED-RED) for: **D4**
      (orphan survives a 400 on `master`), **PX** (forced throw leaves the item
      behind without the transaction), **P1, P2, P4, P5, P6**, **G-2**
      (`insertValueClaim` in the wrong enclosing function), **C1-C7**.
- [ ] **D4's red observed by someone other than its author**, and the
      transaction-removal mutation proof re-run by that same second person
      (`DEC-S4-2`, `technical-plan.md` B5).
- [ ] Cases that are **pins, not natural reds**, are commented as such and
      **mutation-proven instead**: **P3** (stays green throughout), **PZ**,
      **D4b**, **G-1**'s four writers.
- [ ] **G-1's three mutation proofs** all observed: rogue call site → red;
      inline `.prepare` write → red; undispositioned new `stmts` entry → red.
- [ ] `assertTableWritersSingleHome` derives the writer set from `server/db.js`,
      asserts **parser completeness** and **registry completeness**, asserts
      **enclosing-function identity (never a count)**, and covers **inline SQL
      writers**. Every disposition carries a file, an anchor, a date and a
      reason.
- [ ] **P5's fixture is depth ≥ 4** (three hops) and **C7's is 4 levels**
      asserting the **grandchild** is absent. A depth-2 or depth-3 proof is
      rejected (`DEC-S4-10`).
- [ ] **C3 is a cross-consumer equality assertion over a reordered input**, both
      arrays derived independently; it is not two per-component checks and not
      `deepEqual(f(X), f(X))`.
- [ ] **I2's post-rejection `GET` is `deepEqual` to the pre-attempt read**,
      including item count — the §9.8 zero-trace proof.
- [ ] The self/descendant exclusion walk was **read by a human** and confirmed
      to consume `ItemNode.children`, not re-derive from `parent_item_id`
      (a fixture and a text scan both can miss this).
- [ ] `npm run test:server` green at **≥ 1807** (baseline 1787 + net 20), 0
      skipped; every pre-existing Group D case and every pre-existing
      `plan-lifecycle.test.js` case passes **unmodified**.
- [ ] `npm run test:client` green at **≥ 829** (baseline 822 + 7); the existing
      ~line-230 claim test passes with its assertion shape unchanged;
      `screens.snapshot.test.tsx` diff **read** before `npx vitest run -u`.
- [ ] `POST /:id/claims` response shape, status codes and error strings
      byte-identical to `master` (AC-13).
- [ ] All four locales carry an identical `planLedger.*` key set, in the same
      commit; E1.1 green with no hand-typed key list anywhere.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0,
      including the new `server/__tests__/helpers/table-writers.js`.
- [ ] `WATCH-S4-F`'s wording corrected; `buildItemTree`'s doc comment corrected
      in the cycle-guard commit; `WATCH-S4-I` and `WATCH-S4-J` opened.
- [ ] `catalog-patch.md` then `catalog-patch-qa.md` applied and both deleted in
      the branch-cut commit; §9.9 present; `decisions-qa-addendum.md` folded or
      referenced.
- [ ] None of the 11 `A2.x` name-overclaiming cases was "adjusted until green";
      `WATCH-S4-H` still stands.

---

## 10. Residual risk accepted by this plan

Stated so it is a disclosure, not an omission:

- **`client/src/lib/api.ts` stays untested as a module.** C5/C6 and I1 pin the
  contract from both ends (component call shape, route behaviour) but every
  component test mocks `api.ts` wholesale, so its real URL/method construction
  is still exercised by nothing. Closing it means a new spec file for `api.ts`
  — out of 4a's scope, and 4a's specific risk (the `null`-vs-absent-key
  contract) is covered from both sides.
- **StrictMode blindness.** RTL renders without `<StrictMode>`, so any new
  `useEffect`/`useRef` the edit-in-place form introduces is structurally
  invisible to C1-C7 no matter how green. §3.5 of the technical plan says none
  is needed — **if the implementation adds one, it needs a human read for
  setup/cleanup symmetry**, per this component's own 2026-08-05 history.
- **`WATCH-S4-D`** (insert-path `parent_item_id` validation stays shallow) and
  **`WATCH-S4-G`** (sibling ordering) are unchanged and untested here, by
  design.
