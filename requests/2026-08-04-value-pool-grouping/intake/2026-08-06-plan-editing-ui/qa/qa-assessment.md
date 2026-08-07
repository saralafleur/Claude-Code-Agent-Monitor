# QA Assessment — plan-editing-ui (Value Pool Slice 4, Phase 4a)

> Authored by `qa-strategist`. **This is the document to read first.** It answers:
> is this change adequately tested, where are the gaps, have we shipped this
> *class* of gap before, and how do we stop it.
>
> **Run mode:** `auto-pilot` — PREFERENCE gates decided here and logged
> `DECIDED-AUTO`. The QUALITY gate (BLIND) was evaluated explicitly and **did not
> fire**; see "Why not BLIND" below.
>
> **Catalog read at committed HEAD only** (`git show HEAD:PROJECT-CONTEXT.md`).
> `git status` confirms the working-tree copy still carries the concurrent
> session's uncommitted edit, so nothing in this pass writes to it — the catalog
> addition ships as `catalog-patch-qa.md` instead (see "Memory updated").

---

## Change summary

Slice 4a gives the plan ledger a real editing surface: an add-item form and
edit-in-place (text + where the item sits in the hierarchy) inside
`PlanLedgerPanel`, a claim-target picker that renders the same nested tree the
read-only ledger already renders, and — folded in as a bug carve-out — a genuine
transaction around the single-unit claim route, which today can commit a plan
item and then return a 400, leaving an orphan. Making placement editable turns
out to require a small server change too (`updateProjectPlanItem` cannot
re-parent at all today; `api.ts` has been advertising that it can), which brings
a new prepared statement, four-step re-parent validation including a cycle
guard, and its own transaction. Nothing is built yet — this is a pre-build pass
over a completed technical plan and the test suite it specifies.

---

## Coverage verdict

**GAPPED**

Not ADEQUATE: every capability 4a adds is UNGUARDED today, and one of them is
worse than unguarded. `POST /:id/claims`'s atomicity is *named* by a green test
(`D4: new_item inline form is atomic`) that has been passing since 2026-08-02
over a live, user-reachable orphan-item defect — verified again this pass by
direct read of `server/routes/project-plans.js:499-540`: the handler inserts the
`new_item` row, **then** validates `value_source`/`attribution`/`value_ref`,
with no `dbModule.db.transaction(...)` anywhere. `PATCH /items/:itemId`'s
`parent_item_id` has zero tests. `client/src/lib/api.ts` has no test file at all.
`plan-lifecycle.js`'s dedicated spec is 11-of-19 existence-only checks (below).

Not BLIND: every surface 4a actually changes has a correctly-shaped test planned
against it, and the plan already names the right catalog entries (§9.1, §9.3,
§9.7, §9.8) with the right cures. The disqualifying condition for BLIND —
"lands on a known recurring failure mode with **no guard**" — is not met, because
guards are specified for all of them. This pass adds five dispositions the plan
was missing, none of which requires a redesign.

**Why not BLIND, stated explicitly** (the auto-pilot quality gate was evaluated,
not skipped): the closest call is `plan-lifecycle.test.js`, the file 4a extends
most heavily, whose own named coverage of `closePlan`, closed-plan 409s and
cross-plan claim isolation is fake (see Gaps). It did not trip the gate because
the *real* behavioral coverage for every one of those named behaviors genuinely
exists one layer up in `project-plans-api.test.js` (verified: closed-plan 409s
for `PATCH /items`, `DELETE /items`, `POST /items`, claims and unclaim are all
asserted at lines 351-366), so no 4a surface is left resting on a vacuous guard
as its *only* guard. **If the durable cure below is declined and the A2.x cases
are left as-is, the next slice that touches `plan-lifecycle.js` should expect
this gate to fire.**

---

## Current coverage

**Layers this project has** (no e2e/browser harness exists; "E2E" here means the
real Express app over real HTTP against a throwaway SQLite file):

| Layer | Command | Relevant files |
|---|---|---|
| Server unit + HTTP | `npm run test:server` (`node --test`) | `project-plans-api.test.js`, `plan-lifecycle.test.js`, `single-writer-guard.test.js`, `db-migration.test.js` |
| Client component | `npm run test:client` (Vitest + RTL) | `PlanLedgerPanel.test.tsx` (29 cases), `screens.snapshot.test.tsx` |
| i18n parity | same Vitest run | `i18n.test.ts` E1.1 — filesystem-derived, no hand-typed key list |

**Observed baseline, run live on `master` by the cartographer (2026-08-06):**

```
npm run test:server  → tests 1787 | suites 444 | pass 1787 | fail 0 | skipped 0
npm run test:client  → Test Files 61 passed (61) | Tests 822 passed (822)
```

**Fully green, both layers, 2609/2609.** No skips, no external services. This is
the state D4's rewrite, P1-P7, G-A/G-B and C1-C7 must land against.

**What genuinely guards the touched surfaces today:**

- `PlanLedgerPanel`'s existing render / claim / close paths — GUARDED (real DOM
  assertions, 29 cases), including one live regression pin for each of the two
  uncatalogued candidate patterns this component carries (`SF-8` for
  `MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH`, `BL-2` for `STRICTMODE-BLIND CLIENT
  SUITE`). Both close *one instance each*, not the class.
- `POST /:id/claims` ordinary success / duplicate / unclaim — GUARDED (D1, D2,
  D3, D5).
- `PATCH /items/:itemId` for the five COALESCE fields — GUARDED (B2 for `text`,
  B1/B3 for creation-time validation, plus the closed-plan 409s above).
- `project_plan_items` schema/migration — GUARDED (`db-migration.test.js`).
- Locale parity for the new `planLedger.*` keys — GUARDED *mechanically, once
  the keys are added*: E1.1 derives namespaces from the filesystem and the key
  set from `en`, so a missing `ko`/`vi`/`zh` block fails automatically. This is
  the one place in this change set where the registry does the work instead of a
  human.

---

## Gaps & test-debt diagnosis

### The UNGUARDED surfaces

| Surface | Status | Note |
|---|---|---|
| `POST /:id/claims` atomicity | **UNGUARDED behind a green, purpose-named test** | D4's failure fixture (`new_item: {text: ""}`) is rejected pre-write; nothing ever rolls back. Live orphan-item defect since 2026-08-02. |
| `PATCH /items/:itemId` → `parent_item_id` | UNGUARDED | zero tests patch this field; the field is a documented no-op with nothing asserting even *that* |
| `client/src/lib/api.ts` `updateItem` | UNGUARDED | no test file exists for `api.ts`; every consumer test mocks the module wholesale, so the real URL/method/body — including the `null`-vs-absent-key contract this change makes load-bearing — is exercised by nothing |
| `plan-lifecycle.js` behavioral coverage in its own spec | **PARTIAL and actively misleading** | see below |
| `deleteProjectPlanItem` real behavior | UNGUARDED | see WATCH-S4-F correction below |
| All new 4a capability (add form, edit-in-place, `flattenItemTree`, re-parent, cycle guard, `claimUnitIntoItem`) | UNGUARDED | expected — not built yet |

### The finding this pass adds: `plan-lifecycle.test.js` is 11-of-19 name-overclaiming

The cartographer flagged this file as "mostly existence-only." Quantified here by
direct read: **11 of its 19 cases have a name that states a specific behavioral
property and a body that is `assert.ok(typeof planLifecycle.X === "function")`.**

```
A2.4:  "closePlan stamps status:'closed' + ISO closed_at + note"
A2.9:  "PATCH /items/:itemId on closed plan → 409"
A2.10: "DELETE /items/:itemId on closed plan → 409"
A2.15: "claim rows deepEqual-identical across closePlan"
A2.18: "same unit claimable into items of both plans, closing A leaves B's claims untouched"
   …and six more, all `assert.ok(typeof …=== "function")`
```

This matters for 4a specifically because **this is the file P1-P7 and the
composer atomicity case land in.** A reviewer running `node --test
server/__tests__/plan-lifecycle.test.js` sees a green suite whose case names
describe a thorough behavioral spec for the exact module this phase extends.
It is not one. (The behaviors *are* really covered — one layer up, in
`project-plans-api.test.js`. The ticks are duplicated in the wrong place, not
absent from the project.)

### Four more findings, dispositioned

Each of these came from an evaluator and needed a ruling. All five were verified
independently by this pass before ruling; the rulings are recorded as
`DEC-S4-8`…`DEC-S4-10` / `WATCH-S4-H` in
[`../decisions-qa-addendum.md`](../decisions-qa-addendum.md).

**1. G-B's name overclaims its scope → WIDEN it (DEC-S4-8).** G-B is named
"`project_plan_items` writers" but its two regexes cover only insert and
reparent. Verified live: `updateProjectPlanItem.run(` and
`deleteProjectPlanItem.run(` each have **exactly one** call site today
(`plan-lifecycle.js:163` and `:179`). Widening G-B to all four writers therefore
costs ~10 lines of the same `scanFiles` shape, needs **no** exception entry, and
is green on `master` from day one. Renaming to a narrower scope buys nothing and
leaves the two writers a 4b bulk-mutation implementer is most likely to reach
for. **Widen; do not rename.**

**2. `WATCH-S4-F`'s premise is factually wrong → out of 4a's build scope, but
the row must be corrected (DEC-S4-9).** `WATCH-S4-F` frames the open product
question as "whether children are orphaned or cascaded." Neither happens.
Verified by direct read *and* by executing the schema: `parent_item_id` and
`value_claims.item_id` both declare FKs with **no `ON DELETE` clause**,
`foreign_keys = ON` is global (`db.js:135`), and `deleteProjectPlanItem` is a
bare `DELETE … WHERE id = ?` with no try/catch. Reproduced against the real DDL:

```
delete an item that has children → SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed
delete an item that has a claim  → SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed
```

`DELETE /items/:itemId` (`project-plans.js:468`) does not wrap the call, and no
Express error middleware exists anywhere in `server/` — so this is a raw,
unstructured 500, in direct violation of the standing rule this codebase states
verbatim at `plan-lifecycle.js:79-83` (*"never a raw 500 is a standing project
rule"*). It is pre-existing, no UI reaches it, and no delete UI ships in 4a, so
**it is correctly out of 4a's build scope.** But the row's wording must be
corrected before a future implementer designs a cascade-vs-orphan UX decision
against a description of behavior the code does not have. Note the shape: the
only test naming this path is `A2.10: "DELETE /items/:itemId on closed plan →
409"` — an existence check. A name-overclaiming guard is precisely how this
stayed invisible.

**3. D4b's fixture is unreachable → the finding is right, the resolution is
half-right (DEC-S4-10 — partial push-back).** The unit-architect is correct that
§5's literal fixture cannot happen: `project_plan_items.id` is `INTEGER PRIMARY
KEY AUTOINCREMENT` (verified, `db.js:770`), the UNIQUE index keys on `item_id`
(verified), so a freshly minted `new_item` id can never collide. Good catch,
caught before build.

But the conclusion — "the real atomicity proof moves to a composer-level forced
throw, and D4's rewrite becomes a happy path plus a renamed empty-text case" —
**drops the one fixture `DEC-S4-2` binds D4's replacement to.** `DEC-S4-2` says
the replacement "must exercise the post-item-insert failure case (valid
`new_item`, invalid `value_source`) and assert no orphan item survives." That
case is HTTP-reachable **on `master` today**, because on `master` validation
still runs *after* the insert (verified, `project-plans.js:499-540`). It is red
pre-fix (orphan item survives a 400) and green post-fix. It is a natural
red→green at the HTTP layer — strictly better evidence than a forced throw, and
it is what the binding decision requires.

**Ruling: keep both.** D4's rewrite uses the invalid-`value_source` fixture (it
proves the reordering half and satisfies `DEC-S4-2`); the composer-level forced
throw stays (it is the only way to prove the *transaction* half independently,
which `DEC-S4-2` insists on because reordering alone is "not sufficient"). The
unit-architect's D4b — reusing D2's shape for DoD compliance — is fine but is
documentation, not evidence, and must not be presented as red-proof.

**4. Cycle-guard depth → require the deeper fixture now, no WATCH row
(DEC-S4-10).** P5's 3-level fixture exercises exactly one upward hop past the
immediate parent; an off-by-one in the bounded walk under-walks silently and P5
still passes. A WATCH row is the right answer when the deeper fixture is
expensive. It is not: one more `insertProjectPlanItem` call and one more
re-parent attempt in a fixture that already exists. The client-side C7 is
*already* specified with a 4-level fixture — the server guard, which is the
backstop for a corruption whose symptom is "rows silently vanish from every
view" (§9.8), must not be tested shallower than the UI convenience layer that
sits in front of it. **Require depth ≥ 4** (walk must traverse ≥ 3 hops), and
keep the bounded-walk companion case against a pre-existing corrupt row.

**5. `KNOWN_MULTI_CALL_SITES` → confirmed, with one sharpening (DEC-S4-8).** The
exception-list resolution is the right structural answer and matches this
project's own precedent exactly (`GRANDFATHERED_QUERIES` and `FILE_DISPOSITIONS`
in `chronology-ordering.test.js`, both live). Confirmed. The sharpening: as
drafted, the assertion is `callMatches.length === KNOWN_MULTI_CALL_SITES[…].length`
— a **count**. Someone who deletes the legacy-import call site and adds a rogue
one anywhere else keeps the count at 2 and the guard stays green. That is §9.7's
own occurrence-7 lesson (one derived axis, one hand-typed axis, trusted as
derived) reproduced inside the cure for it. Assert the **enclosing function name**
of each call site against the expected set, using the brace-depth walk G-A
already needs — identity, not arity.

### The systemic reason

Stated plainly, and it is one reason, not five:

> **This project's guards are named for the guarantee they aspire to and scoped
> by hand to the subset someone happened to think of. Nothing derives the second
> from the first, so the name drifts wider than the scope — and the name is what
> the next reader believes.**

Every finding above is an instance of that one mechanism:

- **D4** — name says "atomic," scope is one pre-write validation branch.
- **`plan-lifecycle.test.js`'s A2.x cluster** — names say "stamps `closed_at`,"
  "→ 409," "deepEqual-identical"; scope is `typeof x === "function"`.
- **G-B** — name says "`project_plan_items` writers," scope is 2 of 4 writers.
- **P5** — name says "cycle"; scope is 2 hops.
- **`buildItemTree`'s doc comment** (`PlanLedgerPanel.tsx:261-264`) — claims
  *"nothing silently disappears"*; true for the orphan case, **false** for the
  cycle case this phase makes reachable, where every member resolves to another
  member and none reach `roots`.
- **`assertSingleHome`'s consumer-list axis** — §9.7 occurrence 7, same shape,
  already catalogued.
- **`api.ts`'s `updateItem` type** — the same failure in a *type*: it has
  advertised `parent_item_id: number | null` while the server silently drops it.

This is also why §9.3's new NAME-OVERCLAIMING sub-shape and §9.7 HAND-SCOPED
STRUCTURAL SCAN are the same defect seen from opposite ends: §9.7 says *the scan
enumerates its own blind spot*; NAME-OVERCLAIMING says *the name covers the blind
spot with a promise*. Both exist because scope is hand-typed and names are free
text.

**Have we shipped this class of gap before?**

**Yes — repeatedly, and this pass raises the count materially.**

- **§9.3 VACUOUS-GUARD (OPEN)** — six shapes catalogued from
  `intake/2026-08-01-build-project-manager/` (five spec files, survived two
  consecutive BLOCKED verifier passes). This intake coined a **seventh**,
  NAME-OVERCLAIMING GUARD, recorded in the unapplied `catalog-patch.md` at one
  occurrence (D4). **This pass finds three more instances, one of them a
  cluster:** the 11-case A2.x family in shipped code (occurrence 2, and by count
  the largest single instance this project has), G-B's guard *name* (design-time,
  caught pre-build), and `buildItemTree`'s doc comment (design-time). The
  promotion trigger `catalog-patch.md` itself sets — *"if a second
  name-overclaiming guard is found on any surface, promote to its own numbered
  entry"* — is **met.**
- **§9.7 HAND-SCOPED STRUCTURAL SCAN (OPEN, 7 occurrences)** — its own catalog
  text says *"the cure this entry has recommended since occurrence 6 remains
  half-built."* G-A/G-B are new scans of exactly this shape; the count-not-identity
  weakness above would have been occurrence 8.
- **§9.1 DERIVED-DUAL-VIEW (OPEN, 7 occurrences)** — `buildItemTree` gains
  consumers #2, #3 and #4 in this slice, the exact moment this entry's history
  says the failure lands. The plan's `flattenItemTree(ItemNode[])` shape is
  proactively correct.
- **§9.8 OVERLOADED-ABSENCE (OPEN)** — the re-parent cycle is a textbook
  instance; `DEC-S4-7`'s two-layer mitigation is the right shape.
- **`DEC-S4-2` is regression-of-the-fix territory, not a fresh add.** The orphan
  defect is live, shipped and user-reachable *right now*. Any deviation from
  validate-then-transact-with-the-catch-outside reintroduces a defect this
  project has already shipped once under a green suite.

Per this project's own counting discipline (Slice 3 PM plan §2, applied
unchanged): design-time pre-flags do **not** increment occurrence counts. So
§9.1 / §9.7 / §9.8 counts are **unchanged** by this pass. Only the A2.x cluster
counts — it is a found live instance in already-shipped code, the same exception
`catalog-patch.md` invoked for D4.

---

## Recommendation

### Must-add-now — these gate 4a (worst-first)

1. **D4's rewrite must use the invalid-`value_source`-after-valid-`new_item`
   fixture**, red-proven against unmodified `master` (orphan item survives a
   400), by someone other than its author, reported as command output. This is
   `DEC-S4-2`'s binding text and the single highest-value test in the change set.
2. **Keep the composer-level forced-throw case** in `plan-lifecycle.test.js` as
   the independent proof of the transaction (not merely the reordering), with
   the restore in a `finally`. Both #1 and #2, not either.
3. **P5 at depth ≥ 4**, plus the bounded-walk companion against a pre-existing
   corrupt self-referencing row. Do not accept a depth-2 proof for a guard whose
   failure mode is silent disappearance.
4. **C3 written as a genuine cross-consumer equality assertion** over a
   *reordered* fixture (both consumers derived independently, `deepEqual` of the
   two `{id, depth}[]` arrays, before and after the reorder). If the two
   "consumers" ever read the same already-computed array, it degenerates to
   `deepEqual(f(X), f(X))`.
5. **C7's exclusion proof at 4 levels**, asserting the *grandchild* is absent —
   the case a "direct `children` only" walk leaks. Check the exclusion by reading
   the code too; a text scan cannot see a hand-rolled re-derivation.
6. **G-B widened to all four `project_plan_items` writers**, with
   `KNOWN_MULTI_CALL_SITES` asserting **enclosing-function identity**, not call
   count.
7. **P3 and P3-mirror as separate named cases**, each asserting both "changed
   field changed" *and* "untouched field untouched," in both directions.
8. **Correct `WATCH-S4-F`'s factual premise**, and correct `buildItemTree`'s doc
   comment in the same commit as the cycle guard, so it stops asserting a
   guarantee the guard — not the function — provides.
9. **Reviewed, never blind, `screens.snapshot.test.tsx` regeneration**
   (`npx vitest run -u` only after reading the diff), per `WATCH-S4-A` and this
   project's own testing policy.

Once 1-9 are in and both suites are green at ≥ 2609 + the new cases, **4a is safe
to ship.** Nothing in this assessment requires a redesign of the technical plan.

### The durable cure — this is the recommendation that matters

Adding nine tests fixes this change. It does not stop the class, and the class
has now produced instances in tests, in guard names, in doc comments and in a
TypeScript type, on this one surface, in one pass.

**Cure 1 — derive the writer set from the schema; stop typing it.** Replace
G-A/G-B's hand-listed regexes with one shared helper in
`single-writer-guard.test.js`:

```
assertTableWritersSingleHome("project_plan_items")
```

which scans `server/db.js` for every prepared statement whose SQL matches
`INSERT INTO|UPDATE|DELETE FROM <table>`, builds the statement-name set **from
the schema source**, and asserts each has exactly one call site whose enclosing
function is either canonical or carries a named, dated `KNOWN_MULTI_CALL_SITES`
disposition. A prepared statement added tomorrow is then automatically in scope
and fails until someone dispositions it. **This is the cure §9.7 has recommended
since occurrence 6 and which its own catalog text says "remains half-built."**
4a is the cheapest place it has ever been to build: two guards are being written
this phase anyway, and all four `project_plan_items` writers are already
single-call-site, so the helper is green on arrival. It makes the whole
name-overclaiming class *structurally impossible for single-writer guards*,
because the name is derived from the registry rather than asserted over it.

**Cure 2 — widen §9.3's detector from test names to any artifact stating a
guarantee.** `catalog-patch.md`'s detector currently reads "for any *test* whose
name states a property…". Three of this pass's four instances are not tests:
a guard's name, a doc comment, and a type. One rule covers all of them:

> Any artifact that states a guarantee — test name, guard name, doc comment,
> file header, or type — must either name the enumeration it derives from, or
> state its scope narrowly enough that no derivation is implied. Replace, never
> extend, a name that overclaims.

**Cure 3 — retire the 11 name-overclaiming A2.x cases** in
`plan-lifecycle.test.js`. Their named behaviors are genuinely covered in
`project-plans-api.test.js`; the existence checks add no coverage and actively
mislead the reviewer of the very file 4a extends. Either make each one real or
delete it and cite the covering case by id. This is not 4a's obligation, but 4a
is writing eight new cases into that file, and leaving eleven fakes beside them
is how the next reader concludes the file is trustworthy.

Cures 1 and 2 are small and belong in 4a. Cure 3 is a cleanup pass that can be
its own change; it is tracked as `WATCH-S4-H`.

---

## Open decisions for the user

- [ ] **Durable cure 1 (`assertTableWritersSingleHome`) — accept now, or ship
      the widened point guards only?** Decided `DECIDED-AUTO: accept now` — it is
      strictly cheaper here than later (two guards are being written anyway, all
      four writers are already compliant, so it lands green). Veto and you get
      the widened G-A/G-B point guards instead, and the class stays open.
- [ ] **Cure 3 — the 11 vacuous `A2.x` cases.** Decided `DECIDED-AUTO: track as
      `WATCH-S4-H`, do not expand 4a's scope.` Say the word if you would rather
      4a clean them up while it is in that file.
- [ ] **`deleteProjectPlanItem`'s raw 500 (`WATCH-S4-F`).** Decided
      `DECIDED-AUTO: premise correction is mandatory; the fix stays out of 4a.`
      One cheap characterization test pinning today's actual FK-throw behavior is
      recommended alongside the correction, so the future product decision starts
      from verified reality. Veto if you would rather 4a carry no delete-path test
      at all — or, conversely, say so if you want the cascade-vs-orphan-vs-refuse
      rule decided now rather than deferred (it is a genuine product question:
      what should happen to an item's claims and children when it is deleted?).
- [ ] **Cycle-guard depth.** Decided `DECIDED-AUTO: require depth ≥ 4 now`,
      rather than logging a WATCH row that accepts depth-2. Reverse if you want
      4a's test surface kept minimal.
- [ ] **Catalog promotion.** `catalog-patch.md`'s own rule promotes
      NAME-OVERCLAIMING GUARD to a numbered entry on a second occurrence; this
      pass found it. `catalog-patch-qa.md` proposes **§9.9**. If you would rather
      it stay a §9.3 sub-shape, the substance (occurrence 2 + the generalization
      beyond test names) must still land.

---

*Memory updated:* `~/.claude/skills/team-qa/memory/qa-run-log.md` ✅ (this project
names no QA run-log of its own; global fallback used) · this project's
recurring-issue catalog — **not edited in place.** `PROJECT-CONTEXT.md` still
carries the concurrent session's uncommitted edit (`git status`, verified this
pass), so per `DEC-S4-4` / `DEC-10` / `DEC-11` the catalog addition ships as
[`../catalog-patch-qa.md`](../catalog-patch-qa.md), to be applied on 4a's effort
branch **after** `catalog-patch.md` and deleted in the same commit. Decision rows
are in [`../decisions-qa-addendum.md`](../decisions-qa-addendum.md).
