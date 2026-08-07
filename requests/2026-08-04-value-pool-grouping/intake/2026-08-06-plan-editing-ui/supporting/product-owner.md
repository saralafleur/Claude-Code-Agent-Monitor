# Product Owner Assessment — Slice 4: Plan editing UI + batch group claiming

**Intake:** `2026-08-06-plan-editing-ui`
**Assessed:** 2026-08-06
**Verdict:** IN SCOPE, approved, build it. Priority: high — this is the slice
that finally makes "act on a group as a unit" a real, executable action
rather than a proposal, and it closes the four-slice Value Pool initiative
Sara approved on 2026-08-04. One sequencing question (below) needs a PM/Sara
call before build branches; it is not a scope objection.

---

## 1. Value & intent

Sara's own words (`request.md`, verbal 2026-08-04) name two outcomes for
this slice specifically: **"edit the plan in the UI — add milestones and
sub-milestones"**, and **"a group or an individual value can be claimed into
an item or a sub-item."** Read together with the parent vision's opening
sentence ("auto-group the pool… then act on a group as a unit: claim a whole
group into an existing plan item/milestone, or have a group create itself as
a new plan item"), Slice 4 is not a UI-polish pass — it is the slice that
converts the entire initiative's payoff from *inert* to *actionable*.

Concretely, before this slice: Slice 3 (built, unmerged) produces named,
reviewed, approved groups sitting in `value_groups` — and per that slice's
own product-owner ruling (§7/§8 of that document), approval is deliberately
"pure bookkeeping," never a plan change. Nothing in the pipeline today can
turn an approved group into delivered-value-recorded-against-a-milestone.
Sara still has to do that by hand, one unit at a time, through the existing
single-claim `<select>` — exactly the manual-reconciliation toil the whole
initiative exists to remove at ~100-200-unit pool scale. Slice 4 is where
that toil actually goes away.

It matters to the end user (Sara, sole user of this local-first tool) for
the same reason named across all three prior PO assessments in this
initiative: the plan ledger is the surface she uses to answer "what did we
actually deliver" and reconcile it into her plan (project memory:
portfolio-reconciliation vision). A grouping engine whose approved output
can never be turned into a claimed, plan-attributed outcome is a dead end —
it would leave the reconciliation gap Slices 1-3 built toward, un-closed.

## 2. Scope check

- **Inside approved scope, verbatim.** The brief's "raw ask" quotes
  `request.md`'s Slice 4 section unparaphrased (lines 76-85), and the
  restated ask does not add capability beyond it. No contradiction found
  against any signed-off spec.
- **Source of truth for this project's scope decisions.** As established by
  the two prior slice PO assessments in this initiative (unchanged here):
  this project has no separate business-requirements doc; `PROJECT-CONTEXT.md`
  is an engineering defect catalog, not a scope source. The source of truth
  is `request.md` (Sara's own words plus the architectural direction she
  approved in-session) at the parent level, and each slice's own
  `decisions.md` at the slice level, once produced — decisions there are
  binding and this document does not re-litigate them.
- **Directly load-bearing, already-closed input: Slice 3's own scope
  ruling names this exact territory as Slice 4's.** Slice 3's
  `supporting/product-owner.md` §7-§8 explicitly reserves, by name, every
  item this brief proposes to build: plan-item/sub-item add/edit UI, a
  claim-target picker showing the hierarchy, batch-claim-into-existing-item,
  and create-new-item(-or-sub-item)-then-claim. That document's own words:
  *"its editing/browsing UI is explicitly Slice 4's deliverable, not Slice
  3's."* This slice is not scope creep — it is filling a gap Slice 3 was
  deliberately fenced away from, on schedule.
- **Schema is already staged for this slice, confirmed by decision record.**
  Slice 3's `decisions.md` **DEC-S3-8** records that `value_groups.review_status`
  reserves `'claimed'` in its CHECK constraint at introduction, proven
  unreachable in Slice 3 by a red-proven structural scan — specifically so
  Slice 4 needs no schema migration to reach it. This slice's technical plan
  can treat that column value as already available; the open question is
  narrower than "does the schema support this" — it is "which module writes
  it" (see §5, AC-14 below).
- **No contradiction found.** Nothing in the request-brief's live-verification
  pass, or in this review, asks for anything the parent doc, prior slices'
  decisions, or Sara's verbal framing forecloses.
- **No content/copy retconning.** This slice is net-new UI (add/edit
  affordances, a picker, two new action buttons), not a fix to previously
  agreed-on wording. The "delivered output matches approved source verbatim"
  bar from the standard PO template does not apply here the way it would to
  a content-correction ask; the one place a fixed vocabulary *is* being
  inherited (not invented) is the `available` / `already_claimed` /
  `no_longer_in_pool` per-member outcome language from Slice 3's
  `resolveMemberAvailability` (§9.8/DEC-S3-5) — the brief is right to say
  this slice should extend that vocabulary, not invent a fresh one, and the
  same discipline should extend to the batch-claim outcome states below.

## 3. Acceptance criteria ("done when…")

The source request gives no numbered checklist for Slice 4 (unlike Slices
1-3, which had explicit bullet lists this initiative's PO documents could
lift near-verbatim). The brief's extracted five-point list is a reasonable
floor but under-specifies the two riskiest edges named in its own
Known-variant-relevance section (mixed availability, single-writer). Ruling
these precisely is this document's job. Continuing this initiative's
numbered `AC-` sequence (Slice 3 ended at AC-7):

1. **AC-8 (item/sub-item creation is real, in-panel).** From
   `PlanLedgerPanel`, on any **open** plan, a user can create a new
   top-level item and a new sub-item under an existing item, without
   navigating away from the panel. On a **closed** plan, no create
   affordance is offered (matches `plan-lifecycle.js`'s existing
   closed-plan write rejection — the UI must not offer an action the server
   will reject).
2. **AC-9 (item/sub-item editing covers at minimum text and placement).**
   At minimum, an existing item's `text` is editable in place, and its
   position in the hierarchy (top-level vs. sub-item, and of which parent)
   is changeable — this is the literal minimum needed to satisfy "add
   milestones and sub-milestones" as a *usable* editing surface, not just a
   creation-only one. Whether `acceptance` / `detail` / `target_date` get
   inline UI in this pass is a technical-plan/PM scoping call, not an
   acceptance blocker — but if deferred, it must be a named, disclosed
   deferral (e.g., a decisions.md row), not a silent gap discovered at QA.
3. **AC-10 (one hierarchy renderer, reused, not re-derived).** The
   claim-target picker (both the existing single-claim gesture and any new
   group-claim target selection) visibly renders parent/child structure
   (indentation or equivalent), built from the same `buildItemTree(items)`
   function `ItemTree`/`ItemNodeRow` already use — never a second,
   hand-rolled walk of `parent_item_id`. This is §9.1's DERIVED-DUAL-VIEW
   entry applied directly, and the brief already flags it; this document
   makes it a hard AC because this project's own defect history says this
   is where a "just reuse the pattern" intention quietly drifts into a
   second copy.
4. **AC-11 (batch-claim-into-existing-item is one transaction with a
   discriminated per-member outcome — never a single pass/fail boolean).**
   Claiming an approved group's members into an existing item/sub-item
   commits or fails as one database transaction at the infrastructure
   level. Within that transaction, each member's fate is reported as a
   named state reusing Slice 3's `GROUP_MEMBER_AVAILABILITY` vocabulary
   (`already_claimed`, `available`→now claimed, `no_longer_in_pool`) rather
   than a fresh one. **A group where zero members are actually claimable at
   claim-time (all already-claimed or no-longer-in-pool) is itself a named,
   distinguishable outcome** — not a silently "successful" empty claim and
   not indistinguishable from a request that never ran. This is §9.8
   applied to the exact case the parent doc's own Constraints section names
   by example ("a group with no members resolved").
5. **AC-12 (create-new-item-then-claim reuses the existing atomic
   `new_item` shape — no second creation path).** Claiming a group into a
   *newly created* item/sub-item is atomic (item creation and every
   claimable member's claim commit together or not at all) and is built by
   reusing the claims API's existing inline `new_item` request shape,
   extended for multiple units, not a hand-rolled second
   create-then-claim round trip. A group where zero members are claimable
   at claim-time still surfaces the same named outcome as AC-11 (the "was a
   plan item created for nothing" question must have one true answer:
   either the item is created regardless — disclosed as such — or creation
   itself is skipped when there is nothing to claim; either is acceptable,
   but it must be a deliberate, documented choice, not accidental).
6. **AC-13 (individual single-claim gesture is behavior-unchanged, target
   set widened only via the picker).** The existing per-unit claim flow's
   *outcome* (one unit, one claim, existing route) does not change. Only
   two things change: the picker now shows hierarchy (AC-10), and a user
   can pick a sub-item as the target (already reachable data-wise per the
   brief's Live verification #3 — this AC is about the picker now
   *presenting* that option legibly, not about unlocking new data access).
7. **AC-14 (the `claimed` transition has exactly one writer, in the same
   transaction as the claims).** `value_groups.review_status` moves to
   `'claimed'` (the value Slice 3's DEC-S3-8 reserved and left unreachable)
   from exactly one call site — the batch-claim endpoint (or a shared
   function it calls) — in the same transaction as the `value_claims`
   inserts for that group. No other code path sets this value.
8. **AC-15 (batch-claim is not a second hand-copied `value_claims`
   writer).** The new batch-claim route produces `value_claims` rows by
   calling through the same composer/function the existing single-claim
   route already uses (looped inside one transaction, or a shared
   extracted function) — never a second, independently hand-written INSERT
   sequence. Per WATCH-6, this slice adds `insertValueClaim` (and, for
   item creation, `insertProjectPlanItem`) to
   `server/__tests__/single-writer-guard.test.js`'s named set — the brief
   confirms neither is named there today, so this slice is the one that
   must close that gap, not defer it.

Items 1-6 above roughly map to the brief's own five extracted signals;
items 7-8 are this document's addition, ruling the two edges the brief
correctly flagged as open (mixed-availability outcome shape, single-writer
status) rather than leaving them to be discovered at QA or build time.

## 4. Priority & impact

- **Who is blocked:** Sara, sole user. Specifically, she is blocked from
  the one action the entire four-slice initiative was pitched around: "act
  on a group as a unit." Slice 3 (built, unmerged) can propose and let her
  review groups, but every approved group is currently a dead end — nothing
  downstream can turn it into recorded, plan-attributed delivered value.
  Until Slice 4 ships, the initiative's headline promise is unfulfilled
  even though 3 of 4 slices are code-complete.
- **Visibility:** internal-only, single-user, local-first tool — no
  external/client-facing visibility, same as all three prior slices.
- **Urgency:** this is the last slice in an already-approved, already
  in-flight sequence ("slices ship independently, in order" — parent doc).
  Nothing is on fire; nothing breaks if this slips a day. But it is the
  slice that retires the open commitment from the 2026-08-04 session, and
  every day it doesn't ship is a day Slice 3's built-but-unmerged work
  produces proposals Sara cannot act on without falling back to the
  original one-unit-at-a-time toil. Recommend treating it as next-up, not
  urgent-emergency.
- **Initiative-closing framing:** because this is the fourth of four, its
  "done" bar is slightly different in kind from Slices 1-3's: it is not
  just "does this slice's own AC list pass," but "does the thing Sara
  described on 2026-08-04 — auto-group, then act on a group as a unit, with
  an editable plan to act into — now actually work end to end, from an
  ungrouped pool through to a claimed milestone." Recommend the technical
  plan and QA pass both include one true end-to-end scenario (assemble
  pool → propose groups → approve one → batch-claim it into a newly created
  sub-item) as a closing smoke test for the initiative as a whole, not only
  per-AC unit coverage.

## 5. Ruling on the requested question — split this slice, or ship together?

**Ruling: do not split the *request/parent-doc* framing into a formal fifth
slice, but the technical plan and build sequencing should treat the two
halves as separably shippable, and the branch-fork decision the brief
already flagged as blocking-for-build should be resolved in favor of
starting the independent half now.**

Reasoning:

1. **The two halves genuinely have different dependency profiles, and the
   brief is right to notice this.** Item/sub-item add/edit UI + the
   hierarchy-aware picker (AC-8, AC-9, AC-10, AC-13) touch only
   already-merged, already-live server code (`plan-lifecycle.js`'s item
   CRUD, the existing single-claim route) — zero dependency on Slice 3.
   Batch-group-claim (AC-11, AC-12, AC-14) is meaningless without
   `value_groups`, which exists only on the unmerged
   `effort/2026-08-06-auto-group-proposal` branch. That is a real,
   structural difference, not a cosmetic one.
2. **Value-wise, the CRUD/picker half is independently worth shipping on
   its own timeline.** Sara's own quoted framing — "she wants to edit the
   plan in the UI — add milestones and sub-milestones" — reads as a
   standalone want, not one that only has value once group-claiming also
   exists. An open plan with zero add/edit affordances today (confirmed
   live, brief's verification #2) is a real, usable gap on its own.
   Gating that behind Slice 3's merge timeline would withhold value that
   doesn't need to be withheld.
3. **But: reshaping the parent doc from "4 slices" to "5" is not a call
   this document makes unilaterally.** The parent doc's carry-forward
   section fixes "slices ship independently, in order" as a four-item
   list Sara verbally approved. Splitting Slice 4 into 4a/4b changes that
   shape, even if only administratively. That is exactly the kind of
   process/sequencing decision the brief itself already routes to PM
   ("noting that option here for the PM rather than deciding it myself") —
   this document agrees with the brief's instinct to flag it rather than
   decide it, and goes one step further by recommending which way to land.
4. **Recommendation, stated plainly:** keep this as one slice folder /
   one intake / one QA pass (avoid doubling this initiative's already-heavy
   per-slice pipeline overhead for a project whose own catalog names this
   exact file family as its highest-density defect zone — more pipeline
   passes is not free here), but **fork the effort branch now, build and
   land AC-8/9/10/13 first as an internally reviewable, independently
   testable unit**, and layer AC-11/12/14/15 on top once either (a) Slice
   3 merges to `master`, or (b) PM explicitly accepts forking from
   `effort/2026-08-06-auto-group-proposal` per the brief's own option (a).
   This gets the independent value shipped at the earliest safe point
   without asking Sara to re-approve a changed slice count, and it does not
   block on Slice 3's merge timeline for the half that doesn't need it.
5. **This is a recommendation, not a unilateral scope change** — flagged
   in §6 as a sign-off item, per the same posture the brief used for the
   branch-fork question.

## 6. Stakeholder questions (sign-off needed before/at delivery)

There is no external client on this work — Sara is the sole stakeholder,
same disposition as all three prior slices (no `intake-client-liaison`
needed). Items below are cheap confirm-or-veto passes, in priority order:

1. **§5's split/sequencing recommendation.** Fork now, ship the CRUD/picker
   half independent of Slice 3's merge status, layer batch-claim on top —
   versus building strictly in the order the request doc lists (which
   effectively gates the whole slice on the Slice 3 merge/fork decision).
   This is the one item this document treats as needing an explicit
   PM/Sara call before build branches, not just a nice-to-know.
2. **AC-9's field scope.** Confirm `text` + hierarchy placement is
   sufficient for "edit" in this pass, or that `acceptance`/`detail`/
   `target_date` inline editing is also wanted now rather than deferred.
3. **AC-11/AC-12's mixed-availability assumption.** Confirm: only
   currently-`available` members are claimed; `already_claimed` and
   `no_longer_in_pool` members are skipped-and-reported, not blockers to
   the rest of the group's claim. Confirm the zero-claimable-members case
   should render as a distinct "nothing to claim" outcome rather than a
   silent no-op or an error.
4. **AC-12's item-creation-when-nothing-claimable edge.** Confirm whether
   a new item/sub-item should still be created when a group turns out to
   have zero currently-claimable members at claim time, or whether
   creation itself should be skipped in that case.
5. **AC-14's transition ownership.** Confirm the batch-claim endpoint (not
   a separate "mark group claimed" action) is the sole writer of
   `review_status='claimed'`, consistent with this project's single-writer
   convention and Slice 3's DEC-S3-8 reservation.

None of items 2-5 block writing the technical plan (each carries a stated,
reasonable default assumption per the brief); item 1 is the one this
document recommends resolving before an effort branch is created, since it
determines which branch the work forks from.
