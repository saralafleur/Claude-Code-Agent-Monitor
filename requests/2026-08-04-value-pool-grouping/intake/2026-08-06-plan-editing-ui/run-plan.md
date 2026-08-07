# Run Plan — Value Pool Slice 4: Plan editing UI + batch group claiming

**Mode:** `direct` (not `fast`)
**Calling skill:** `team-intake`
**Triage verdict:** READY
**Brief:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/request-brief.md`
**Decision:** full roster retained — 6 of 6 agents run, in the skill's native order.

## 1. Scope read

Slice 4 is the last and widest slice of the Value Pool initiative, and it is
not a small change. It spans three distinct pieces of work that only look
like one ask: (a) net-new item/sub-item CRUD affordances in
`client/src/components/PlanLedgerPanel.tsx`, which today renders items
strictly read-only; (b) a rendering change to the existing single-claim
`<select>` so it shows hierarchy (data already includes sub-items — this is
presentation, not plumbing); and (c) a genuinely net-new server capability —
a batch-claim route in `server/routes/project-plans.js` that inserts N
`value_claims` rows plus a `value_groups.review_status → 'claimed'`
transition inside one transaction. Blast radius is larger than the file
count suggests: the batch route is a **second producer** of `value_claims`
rows (today there is exactly one, `POST /:id(\d+)/claims` via
`dbModule.stmts.insertValueClaim`), it crosses a real cross-slice boundary
by depending on schema that exists only on the unmerged
`effort/2026-08-06-auto-group-proposal` branch, and it lands squarely in
what PROJECT-CONTEXT.md calls this project's single highest-density
recurring-defect zone (9/9/4 §9.3-family events across the prior three
builds). There is also an unresolved sequencing question — fork from Slice
3's branch, wait for its merge, or split the slice so the CRUD/picker half
ships independently — that is a hard precondition for build and is
currently nobody's decision.

Direct mode is supposed to make a team leaner. Here it does not, and I want
to be explicit that this is the finding rather than a failure to trim: this
change touches a public-ish API contract (a new route shape plus a wire
vocabulary for per-member outcomes), introduces a second writer to a
single-writer table, and matches four catalogued defect classes by name.
Every angle in the roster is load-bearing.

## 2. Agents to run

**Wave 1 — evaluation fan-out (all four in parallel, one message):**

1. **`intake-product-owner`** → `supporting/product-owner.md`
   The request doc is materially terser on Slice 4 than on Slices 1–3: it
   states **no numbered "done when" checklist**, and the five acceptance
   signals in the brief are the triage agent's own extraction, explicitly
   flagged as an assumption rather than a requester-stated pass/fail list.
   There are two live scope questions no other role owns — which item fields
   are editable in this pass (`text`/`parent_item_id` only, or also
   `acceptance`/`detail`/`target_date`), and whether the batch-claim half
   should be split into its own follow-on slice so the CRUD + picker half
   can ship free of Slice 3's merge status. Both are value/scope calls, not
   design calls.

2. **`intake-architect`** → `supporting/architect.md`
   Three real architectural decisions, any one of which would justify the
   agent alone: the branch/sequencing disposition (fork from
   `effort/2026-08-06-auto-group-proposal` vs. wait for merge vs. split the
   slice); the single-writer composition question (WATCH-6 — route both the
   single and batch claim paths through one shared composer rather than
   hand-rolling a second INSERT sequence); and ownership of the
   `review_status='claimed'` transition, which Slice 3's schema comment
   reserves for Slice 4 without naming the writing module. Open questions 1
   and 5 in the brief are addressed to the architect by name.

3. **`intake-engineer`** → `supporting/engineer.md`
   The batch-claim transaction shape needs grounding in the real code, not
   designed in the abstract: whether the batch route reuses the single-claim
   route's inline atomic `new_item` request-body shape (one `new_item`, N
   units) or needs its own, and how the existing single-claim logic is
   looped inside one transaction without duplicating it. On the client side,
   the exact edit points in `PlanLedgerPanel.tsx` matter — in particular
   that the hierarchy-aware picker must consume the existing
   `buildItemTree(items)` (lines 266–276) already used by
   `ItemTree`/`ItemNodeRow`, rather than hand-rolling a second
   `parent_item_id`-to-tree walk.

4. **`intake-qa`** → `supporting/qa.md`
   Non-negotiable here. This slice introduces the first mixed-availability
   decision on this surface (`available` / `already_claimed` /
   `no_longer_in_pool` at claim time, a real race between group approval and
   the claim click), and QA owns the question of whether an
   all-unclaimable group is its own named outcome or a silently empty
   success. It also owns the atomicity/rollback verification (acceptance
   signal 3: all eligible members land or none do — no partial-commit
   half-claimed group) and the §9.3 red-proof requirement that any guard
   added for the single-writer or discrimination points be proven by
   mutation, not reported green.

**Wave 2 — `intake-project-manager`** → `pm-plan.md` (always runs)
   Reads the brief plus all four supporting files, classifies the request
   (provisionally `new-feature`), reconstructs the Slice 1–4 history, and
   updates the request-log and defect catalog. This is also where the
   branch-sequencing decision needs to land as an explicit, recorded PM
   decision — the brief is clear it blocks build even though it did not
   block intake.

**Wave 3 — `intake-tech-lead`** → `technical-plan.md` (always runs)
   Synthesizes architect + engineer + qa plus the PM's classification into
   the final deliverable.

Dependency order is the skill's own and is preserved unchanged: the four
evaluators fan out in parallel, PM consumes all four, tech lead consumes
architect/engineer/qa plus the PM's request type.

## 3. Agents skipped

None. Each of the four evaluation angles maps to a specific, named,
unresolved question in this brief; there is no angle here I can call clearly
inapplicable. Applying the "when genuinely unsure, keep the agent" rule
would have kept any borderline case anyway, but no case was borderline —
the closest to skippable was `intake-product-owner` (this is a sequenced
slice of an already-scoped initiative), and it was kept because the request
doc's silence on Slice 4 acceptance criteria plus the live split-the-slice
option are exactly a PO's call.

## 4. Forced back on

Three overrides apply, though none actually reverse a leaner call I made —
they independently confirm the full roster:

- **Defect-catalog matches (the hard override).** The brief names four by
  id: **§9.1 DERIVED-DUAL-VIEW** (a second `parent_item_id`-to-tree walk for
  the picker), **§9.8 OVERLOADED-ABSENCE** (mixed batch-claim availability
  collapsed into one success boolean — named by the parent request itself as
  "the standing trap for this whole surface"), **§9.3 VACUOUS-GUARD** (any
  new guard must be mutation-proven), and the **WATCH-6** single-writer-guard
  convention (batch claim as a second `value_claims` producer). Per the
  standing rule, a catalog match forces the full roster back on for that
  concern; four matches on one surface with a 9/9/4 event history leaves no
  room for trimming QA or architect.
- **Cross-subsystem / cross-slice boundary.** The slice depends on schema
  (`value_groups`, `value_group_members`) that exists only on an unmerged
  branch, and adds a new server route contract plus a per-member outcome
  vocabulary that a client consumes. That is a real contract boundary with
  two sides.
- **Unresolved sequencing ambiguity.** Nothing in the brief resolves
  fork-vs-wait-vs-split, and it is a hard precondition for build to compile.
  It needs both an architect opinion and a recorded PM decision, which is
  precisely the pair of agents a leaner plan would have been tempted to
  collapse.

Additionally noted for the tech lead, not an override: no existing
structural guard names `insertValueClaim` or `insertProjectPlanItem`
(`server/__tests__/single-writer-guard.test.js`), so this is the first slice
that would need one if the house single-writer convention is applied here.
