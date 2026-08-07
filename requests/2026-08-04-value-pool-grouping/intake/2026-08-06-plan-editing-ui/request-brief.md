# Request Brief — Value Pool Slice 4: Plan editing UI + batch group claiming

**Intake date:** 2026-08-06
**Output dir:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/`
**Source doc:** `requests/2026-08-04-value-pool-grouping/request.md`, "### Slice 4 — Plan editing UI + batch group claiming" (lines 76-85), plus the "Constraints / carry-forwards" section (lines 87-101) that binds all four slices.

## Raw ask (verbatim, from request.md)

> - Plan-item hierarchy already exists server-side (`parent_item_id`, full
>   item CRUD in plan-lifecycle.js) — this slice is **UI**: add/edit items
>   and sub-items in PlanLedgerPanel, and a claim-target picker that shows
>   the hierarchy.
> - **Group actions:** claim-all-members-into-existing-item (batch claim,
>   one transaction), or create-new-item(-or-sub-item)-then-claim (the
>   claims API's atomic inline `new_item` already supports the shape).
> - Individual units keep their existing single-claim gesture, now with
>   sub-item targets.

Also carried from the parent request's top-level framing (Sara's own words, verbal, 2026-08-04):

> "...she wants to **edit the plan in the UI** — add milestones and
> sub-milestones — so a group or an individual value can be claimed into an
> item *or a sub-item*."

And the parent request's "Constraints / carry-forwards" section (applies to all four slices, quoted verbatim):

> - Reuse, never re-derive: `assembleValuePool` stays the sole pool composer
>   (DEC-16 / `CONSUMERS` registry); the single-writer guards on
>   `value_unit_summaries` writes must widen deliberately if a new writer
>   appears (WATCH-6 pattern).
> - §9.8 OVERLOADED-ABSENCE is the standing trap for this whole surface:
>   every new "absent from a map" state (a group with no members resolved, a
>   stale-but-not-yet-regenerated unit) must be a named, distinguishable
>   state, never a silent absence.
> - OPEN-4 (env tune `MAX_PROJECTS_PER_TICK`) is still undecided by Sara —
>   Slice 2's coverage-request mechanism partially obsoletes it; reconcile
>   rather than duplicate.
> - Slices ship independently, in order, each through the full
>   team-intake → team-qa → team-build pipeline on its own effort branch.

## Restated ask

Give `PlanLedgerPanel` the ability to create and edit plan items and
sub-items in place (server-side CRUD already exists and needs no new
endpoints for this part), replace the single-claim gesture's flat item
`<select>` with a hierarchy-aware picker, and add two new **group-level**
claim actions — batch-claim every available member of an approved Slice-3
group into an existing item/sub-item in one transaction, or atomically
create a new item/sub-item and claim the whole group into it — reusing the
claims API's existing atomic inline `new_item` shape rather than inventing
a second creation path.

## Requester / source

Sara, verbal, 2026-08-04 (same session that shipped `value-summary-tick`,
merged `55fe900`) — recorded in `request.md`. This is slice 4 of 4, the
last slice of the sequenced request; slices 1 and 2 are merged to `master`,
slice 3 has shipped code but is unmerged (see Live verification below).

## Surface / area touched

- `client/src/components/PlanLedgerPanel.tsx` — the open-plans pane (item
  tree rendering, now needs add/edit affordances), the value-pool pane's
  per-unit claim `<select>` (needs hierarchy display), and — once Slice 3
  merges — its group-review section (needs a claim action added next to
  the existing approve/dismiss actions).
- `server/lib/plan-lifecycle.js` — already has full item CRUD
  (`insertProjectPlanItem`, `updateProjectPlanItem`, `deleteProjectPlanItem`);
  confirmed live, likely needs no new functions for the single-item
  add/edit part of this slice.
- `server/routes/project-plans.js` — the existing single-unit claim route
  (`POST /:id(\d+)/claims`) has no batch counterpart; this slice needs a
  new batch-claim route (or an extension) plus, once Slice 3 merges, a
  route that transitions a `value_groups.review_status` row to `claimed`.
- `server/lib/value-groups.js` (Slice 3, unmerged) — reserves exactly the
  hook this slice needs (see Live verification #6 below).

## Known-variant relevance (PROJECT-CONTEXT.md §9)

This is the same Value Pool surface PROJECT-CONTEXT.md calls "this
project's single highest-density recurring-defect zone" (9/9/4 §9.3-family
events logged across the prior three builds). Specific entries relevant to
this slice's actual diff shape:

- **§9.1 DERIVED-DUAL-VIEW** — `PlanLedgerPanel.tsx` already has exactly
  one tree-builder, `buildItemTree(items)` (lines 266-276), which the
  read-only `ItemTree`/`ItemNodeRow` components consume. A hierarchy-aware
  claim-target picker MUST reuse this same function/output rather than
  hand-rolling a second nesting walk for the `<select>` — a second copy of
  "how does parent_item_id become a tree" is exactly this entry's "rogue
  re-derivation" sub-form (see the 2026-08-02/03 notes under §9.1: "a
  second copy of the grouping-membership or rollup formula is as dangerous
  as a second raw read").
- **§9.8 OVERLOADED-ABSENCE** — the batch-claim action is the first place
  this surface must decide what happens when a group's members have
  **mixed availability** (some `available`, some `already_claimed`, some
  `no_longer_in_pool` — see Live verification #6/#7). This is a live
  instance of the exact shape §9.8 names: "a group with no members
  resolved" is called out by name in the parent request's own Constraints
  section as this surface's standing trap. The per-member batch-claim
  outcome must be a discriminated state on the wire (e.g.
  `claimed`/`skipped_already_claimed`/`skipped_no_longer_in_pool`), never
  collapsed into one boolean "did the batch succeed." Slice 3 already
  established the precedent shape for this
  (`GROUP_MEMBER_AVAILABILITY = ["already_claimed", "available",
  "no_longer_in_pool"]`, `server/lib/value-groups.js`'s
  `resolveMemberAvailability`) — this slice should extend/reuse that
  vocabulary for the claim outcome, not invent a fresh one.
- **WATCH-6 single-writer-guard pattern** (named explicitly in the parent
  request's carry-forwards, there scoped to `value_unit_summaries`, but the
  same house convention applies here): `value_claims` inserts currently
  happen from exactly one call site
  (`server/routes/project-plans.js`'s `POST /:id/claims`, via
  `dbModule.stmts.insertValueClaim`). A batch-claim endpoint is a **second
  producer** of `value_claims` rows — the technical plan should route both
  through one shared composer (loop the existing single-claim logic inside
  one transaction, or extract a shared `insertValueClaim`-wrapping
  function) rather than hand-rolling a second INSERT sequence, matching
  this catalog's repeated finding that a second hand-copy of a writer is
  where this project's defects concentrate. No existing structural guard
  (`server/__tests__/single-writer-guard.test.js`) currently names
  `insertValueClaim` or `insertProjectPlanItem` — confirmed by direct read
  (no matches) — so this slice is also the first to need one if the
  house convention is applied here.
- **§9.3 VACUOUS-GUARD** — whatever guard this slice's technical plan adds
  for the single-writer point above, or for the mixed-availability
  discrimination above, must be red-proven by mutation (inject a rogue
  second `value_claims` insert path; construct a group with mixed
  availability and assert each outcome bucket), not merely reported green
  — this surface's own history (9/9/4 events) is exactly this failure mode
  recurring.

## Provisional request type

**new-feature** (PROVISIONAL — PM makes the final call). Net-new UI
capability (item CRUD affordances, hierarchy-aware picker, batch-claim
actions) layered on already-existing server-side plumbing for the
single-item CRUD half; the batch-claim half is net-new both client and
server.

## Attachments / evidence

None. No screenshots, no mockup, no expected-vs-actual — this is a
from-scratch design ask extracted from Sara's verbal session notes, same
posture as slices 1-3's request-briefs.

## Explicit acceptance signals ("done when…")

The request doc states no numbered "done when" checklist for Slice 4.
Extracted from the prose (flagged as an assumption, not a requester-stated
pass/fail list):

1. A plan-item (and sub-item) can be created and edited from
   `PlanLedgerPanel` without leaving the panel.
2. The claim-target picker (both the individual-unit gesture and any new
   group gesture) visibly shows parent/child structure, not a flat list.
3. A whole approved group can be claimed into an existing item/sub-item in
   one transaction — either all eligible members land, or none do (no
   partial-commit half-claimed group).
4. A whole approved group can be claimed into a **newly created**
   item/sub-item, atomically, reusing the claims API's existing inline
   `new_item` shape rather than a second create-then-claim round trip.
5. The individual single-claim gesture continues to work exactly as today,
   now able to target a sub-item as well as a top-level item.

## Live verification performed (2026-08-06) — corrects/confirms the request doc's premises against current repo state

1. **Item CRUD is real and complete server-side, confirmed by direct
   read.** `server/lib/plan-lifecycle.js` exports `insertProjectPlanItem`
   (accepts `parent_item_id`), `updateProjectPlanItem`, and
   `deleteProjectPlanItem`, each rejecting writes once the owning plan is
   closed. The request doc's "already exists server-side" framing is
   accurate, not stale.
2. **`PlanLedgerPanel.tsx` (master) has zero add/edit-item UI today.**
   `PlanSection`/`ItemTree`/`ItemNodeRow` render items strictly read-only
   (text + claim labels); the only per-plan control is Close. This is a
   real, net-new UI gap this slice must fill, not a partial feature to
   extend.
3. **The individual-claim `<select>` already includes sub-items in its
   option list today** — `openItems` is built from
   `openPlans.flatMap((p) => p.items.map(...))`, and `p.items` is the
   plan's full flat item list (parents and children alike), not just
   top-level items. So "sub-item targets" for the single-claim gesture is
   already reachable *data-wise*; what's missing is that the `<select>`
   renders every item at the same visual level with no indentation or
   parent context — i.e., the request's "claim-target picker that shows
   the hierarchy" is a rendering gap, not a data-availability gap.
4. **No batch-claim endpoint exists on `master`.** `server/routes/
   project-plans.js` has exactly one claim route,
   `POST /:id(\d+)/claims`, which claims one unit at a time (with the
   inline atomic `new_item` option the request doc references). This
   slice needs a new route for the batch case.
5. **`value_groups` does not exist on `master`.** `grep -n "value_groups"
   server/db.js` on `master` returns nothing — confirmed live, not
   assumed.
6. **`value_groups` exists only on the unmerged Slice-3 effort branch
   (`effort/2026-08-06-auto-group-proposal`, commit `72feac9`), and that
   branch already reserves the exact hook Slice 4 needs.** Confirmed by
   direct read of that branch's `server/db.js`:
   `value_groups.review_status` CHECK is
   `('proposed','approved','dismissed','claimed')`, with the schema's own
   comment reading *"'claimed' is RESERVED for Slice 4 ... and is
   UNREACHABLE in Slice 3 — proven by a structural scan, not by prose."*
   Per-member availability is already a three-state discriminated read-time
   derivation (`GROUP_MEMBER_AVAILABILITY = ["already_claimed",
   "available", "no_longer_in_pool"]`, computed by
   `resolveMemberAvailability` in `server/lib/value-groups.js`), never
   persisted — this is a directly reusable §9.8-compliant vocabulary for
   the batch-claim outcome this slice needs to report.
7. **That branch's client diff also confirms the claim action was
   deliberately fenced OUT of Slice 3, not accidentally omitted.**
   `git diff master effort/2026-08-06-auto-group-proposal -- client/src/components/PlanLedgerPanel.tsx`
   shows Slice 3 added a full group-review UI (list groups, approve,
   dismiss) but its own code comment on the approve handler states:
   *"AC-5: pure bookkeeping — review_status + reviewed_at only, never a
   plan item, milestone, or claim (PO §7/§8 fence)."* This slice is the
   one that is supposed to cross that fence.
8. **No existing structural guard names `insertValueClaim` or
   `insertProjectPlanItem`** — `grep -n "insertValueClaim\|
   insertProjectPlanItem" server/__tests__/single-writer-guard.test.js`
   returns nothing. Noted above under Known-variant relevance; not a
   defect in prior work (no second writer has existed until now), but a
   gap this slice's technical plan should consider closing given it is the
   slice that introduces the second writer.

## Open questions

### BLOCKING
None found. Every server-side primitive this slice's request text assumes
exists — item CRUD with `parent_item_id`, the claims API's atomic inline
`new_item` shape — is confirmed real on `master` today, and the one piece
that is not yet on `master` (Slice 3's `value_groups` schema/routes) is
confirmed to exist on a real, inspectable branch that already anticipated
and reserved the exact extension point this slice needs. The request
itself is unambiguous about what UI/actions are wanted.

### Non-blocking (proceed with stated assumption; PM/architect to confirm or override)

1. **Slice-3 branch dependency — flagged prominently per task instruction,
   disposed as non-blocking for intake, but requires an explicit PM
   decision before build starts.** Slice 4's group-claim feature is
   meaningless without Slice 3's `value_groups`/`value_group_members`
   tables and routes, which exist only on
   `effort/2026-08-06-auto-group-proposal` (unmerged). Intake itself is
   read-only planning and was able to fully ground this brief by reading
   that branch directly (see Live verification #6/#7 above), so this does
   **not** block writing the brief or (most likely) the team-qa risk pass
   or the technical-plan design pass, which can likewise design against
   the real, already-written Slice-3 code. It **does** block `team-build`:
   the build agent needs actual working code to extend, so the PM/architect
   must explicitly decide, before build starts, whether Slice 4's effort
   branch (a) forks from `effort/2026-08-06-auto-group-proposal` (accepting
   that Slice 3 isn't merged to `master` yet), or (b) waits for Slice 3 to
   merge to `master` first and forks from there. This mirrors the disposed
   pattern in `intake/2026-08-06-auto-group-proposal/request-brief.md`'s
   SF-4 item — an already-logged, already-scoped dependency with a
   known resolution path, not a fresh unknown — but unlike SF-4 it is a
   **hard precondition for build to even compile**, not a code-quality
   risk, so it should be resolved explicitly and early rather than
   deferred silently. The batch-claim feature (the item that actually
   depends on groups) could also, if the PM prefers, be split into its own
   follow-on slice so the item/sub-item CRUD + hierarchy-picker half of
   this brief can ship independently of Slice 3's merge status — noting
   that option here for the PM rather than deciding it myself.
2. **Which item fields are in scope for "edit"** — the request says
   "add/edit items and sub-items" without naming fields. Server CRUD
   supports `text`, `acceptance`, `detail`, `checked`, `position`,
   `target_date`. Assumption: at minimum `text` (and `parent_item_id`
   placement, i.e. "is this a sub-item and of what") must be editable to
   satisfy the request's own framing; whether `acceptance`/`detail`/
   `target_date` get UI in this pass is a technical-plan/PM scoping call,
   not a triage blocker.
3. **Batch-claim's mixed-availability behavior** — the request text says
   "claim-all-members-into-existing-item (batch claim, one transaction)"
   without specifying what happens when some members are
   `already_claimed` or `no_longer_in_pool` at claim time (a real race:
   time passes between group approval and the claim click). Assumption
   (see Known-variant relevance, §9.8): only `available` members are
   claimed; the transaction still commits for those; the response reports
   a discriminated outcome per member id, not a single success/failure
   boolean. Flagged for the technical plan to confirm or override, and to
   decide whether an all-`already_claimed`/all-`no_longer_in_pool` group
   (zero actually-claimable members) is itself a distinct, named outcome
   rather than a silently empty success.
4. **Where the "create-new-item-then-claim" atomic shape lives for the
   batch case** — the request says the claims API's existing inline
   `new_item` "already supports the shape," which is true for the
   single-claim route today. Whether the batch route reuses that same
   request-body shape (one `new_item`, N units) or needs its own is a
   technical-plan design decision, not ambiguous in the request's intent.
5. **`review_status='claimed'` transition ownership** — Slice 3's schema
   comment reserves this value for Slice 4 but does not say which module
   sets it. Assumption: the batch-claim endpoint (or a shared
   `plan-lifecycle`/`value-groups` function it calls) is the sole writer of
   this transition, in the same transaction as the `value_claims` inserts —
   flagged for the architect to confirm, consistent with this project's
   single-writer conventions.
6. **Individual single-claim gesture's "keep working as today" scope** —
   read as literal: no behavior change to the existing per-unit claim flow
   beyond the picker's rendering (hierarchy display) and target set
   (already includes sub-items per Live verification #3). Not treated as
   ambiguous.
