# Architect Assessment — Value Pool Slice 4: Plan editing UI + batch group claiming

**Scope:** branch-sequencing disposition (A/B/C from the task), the
`review_status='claimed'` transition ownership, the batch-claim transaction
design, and the applicable defect-catalog risks (§9.1, §9.3, §9.7, §9.8),
grounded in direct reads of `server/lib/plan-lifecycle.js`,
`server/routes/project-plans.js` (master), `server/lib/value-groups.js` /
`server/db.js` / `server/routes/project-plans.js` (on
`effort/2026-08-06-auto-group-proposal`, commit `72feac9`), and
`client/src/components/PlanLedgerPanel.tsx` (master + the Slice-3 branch
diff). `PROJECT-CONTEXT.md` was read at committed `HEAD`
(`d384249`) only — the working tree currently carries a different,
unrelated session's uncommitted 65-line edit to that file, which this
assessment does not read or rely on, per instruction.

---

## 1. Affected subsystems & boundaries

- **`client/src/components/PlanLedgerPanel.tsx`** (1118 lines, master) —
  owns three surfaces this slice touches: (a) `PlanSection`/`ItemTree`/
  `ItemNodeRow` (lines 258–360), currently strictly read-only, needs
  add/edit affordances; (b) `ValueUnitRow`'s single-claim `<select>`
  (lines 469–596), which already targets sub-items data-wise (`openItems`
  is `openPlans.flatMap((p) => p.items...)`, the plan's full flat list,
  parents and children alike — confirmed live) but renders every item flat
  with no indentation; (c) — once Slice 3 merges — the group-review section
  the Slice-3 branch adds (`groupsList.map(...)`, badge card per group,
  `handleApproveGroup`/`handleDismissGroup` next to a `review_status ===
  'proposed'` conditional), which is where this slice's new claim action
  bolts on next to approve/dismiss for `review_status === 'approved'` rows.
- **`server/lib/plan-lifecycle.js`** — owns plan/item CRUD
  (`insertProjectPlanItem`, `updateProjectPlanItem`, `deleteProjectPlanItem`)
  and the sole closure composer (`closePlan`). Confirmed complete for the
  single-item add/edit half; needs no new exports for that part.
- **`server/routes/project-plans.js`** — owns the single claim route
  (`POST /:id(\d+)/claims`, lines 482–574 on master) and, on the Slice-3
  branch, the group propose/list/approve/dismiss routes (lines 402–531).
  This is where the new batch-claim route belongs, and it is the only
  place today that calls `dbModule.stmts.insertValueClaim` — the
  single-writer surface this slice widens.
- **`server/lib/value-groups.js`** (Slice-3 branch only) — owns
  `resolveMemberAvailability` (the read-time, three-state, never-persisted
  availability derivation this slice must reuse for its claim-outcome
  vocabulary) and is declared, in its own file header, the "SOLE writer of
  `value_group_runs` / `value_groups` / `value_group_members`
  (single-writer-guard.test.js G-8)." That comment is a real ownership
  claim this slice's batch-claim route must not violate by reaching into
  `value_groups` with a hand-rolled `UPDATE` of its own.
- **`server/db.js`** (Slice-3 branch) — schema owner. `value_groups.review_status`
  CHECK already includes `'claimed'` with an explicit "RESERVED for Slice 4"
  comment; `setValueGroupReviewStatus` (`UPDATE value_groups SET
  review_status = ?, reviewed_at = ? WHERE id = ?`) is commented "the ONLY
  writer of review_status/reviewed_at (approve/dismiss)" — a claim this
  slice will make false the moment it writes `'claimed'` through any path,
  unless the module's own comment and test surface are updated in the same
  commit that adds the third caller.

## 2. Current design

**Single-claim path (master, real today).** `POST /:id(\d+)/claims` is a
single Express handler, not wrapped in `dbModule.db.transaction(...)`. It
resolves an `item_id` or inserts one from an inline `new_item` payload via
`planLifecycle.insertProjectPlanItem` (its own single INSERT, no ambient
transaction), validates `value_source`/`attribution`/`value_ref`,
canonicalizes `source_cwd`, then calls `dbModule.stmts.insertValueClaim.run(...)`
directly inline in the route body — the **one** call site in the whole
tree. A `UNIQUE` constraint on `(value_source, value_ref, source_cwd,
item_id)` gives duplicate-claim detection via a caught SQLite error, not a
pre-check. This is the pattern the request brief's WATCH-6 concern is
about widening deliberately.

**Item CRUD (master, real today).** `insertProjectPlanItem`/
`updateProjectPlanItem`/`deleteProjectPlanItem` in `plan-lifecycle.js` are
already the sole writers of `project_plan_items`, each independently
re-checking the owning plan's `status === 'open'` before writing. No UI
calls any of them yet — `PlanLedgerPanel.tsx` has zero add/edit-item
controls on master, confirmed by direct read.

**Hierarchy rendering (master, real today).** Exactly one tree-builder
exists: `buildItemTree(items)` (lines 266–276), consumed today only by the
read-only `ItemTree`/`ItemNodeRow` pair. This is the project's
`PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW pattern in miniature — one
derived value (a `parent_item_id` flat list turned into a nested tree),
one canonical computer. Today it has exactly one consumer, so the pattern
hasn't yet had a chance to fail; this slice adds the second and third
consumers (the claim-target picker, and — per Slice 3 — a group's claim
target picker), which is precisely the shape §9.1's own "Design-time
pre-flag" language warns about: *"this pattern's own history shows the
failure lands when consumer #2 appears, not at introduction."*

**Group review (Slice-3 branch only, not on master).** `value_groups` /
`value_group_members` / `value_group_runs` exist only on
`effort/2026-08-06-auto-group-proposal`. The schema's own comment
reserves `review_status='claimed'` for this slice and calls it
"UNREACHABLE in Slice 3 — proven by a structural scan, not by prose."
`resolveMemberAvailability` computes `already_claimed`/`available`/
`no_longer_in_pool` at **read time only** from `(value_source, value_ref)`
matched against live pool units and live claims — never persisted, so
staleness between group-approval time and claim-click time is structurally
handled already; this slice's batch-claim route can and should call the
same function rather than re-deriving availability. `approve`/`dismiss`
are two dedicated route verbs, not one body-supplied-status route — the
branch's own `DEC-S3-9` states this explicitly: *"a body-supplied status is
a hole through which 'claimed' could reach the DB; two verbs close it
structurally."* That is a direct, named precedent against giving the new
`claimed` transition a generic "set status" entry point.

## 3. Options

### A. Branch sequencing — fork Slice 4 from Slice 3's branch, wait for merge, or split the slice

**Option A1 — fork from `effort/2026-08-06-auto-group-proposal`.**
Pros: unblocks build today; the batch-claim half is meaningless without
`value_groups`/`value_group_members`, so building against the real schema
(not a stub) is also lower-risk technically. Cons: if Slice 3 needs
changes before its own merge (its `decisions.md` already records an
**open, unresolved cure** — see §4 below, the `assertConsumerScopeDerived`
generalization escalated to Sara — plus two known review-scope items
noted in this same doc), Slice 4 inherits that churn as a rebase, and a
rebase of a schema-and-route-touching branch onto a still-moving base is
exactly the shape that produces silent merge-driven regressions on this
surface's own history (§9.4 FIX-ROUND-REGRESSION names "the fix round is a
build round" as a recurring failure mode here).

**Option A2 — wait for Slice 3 to merge to master, then fork cleanly.**
Pros: cleanest possible base, no inherited churn, no rebase risk. Cons: as
the task framing states, Slice 3's own merge is currently blocked on a
live, uncommitted, concurrent-session conflict in `PROJECT-CONTEXT.md` in
this exact working tree (confirmed by `git status`: `M PROJECT-CONTEXT.md`,
65 lines, uncommitted, unrelated session) — a real, present blocker with
no visible resolution timeline, not a hypothetical one. Waiting on it risks
stalling Slice 4's start indefinitely, which directly contradicts this
project's own already-recorded lesson (`PROJECT-CONTEXT.md` "Intake
throughput can outrun build throughput" note, 2026-08-05): the concrete
cost of stacking unmerged effort branches has already landed once on this
exact initiative (Slice 2's `DEPENDENCY-F1` was written on a factually
wrong premise about Slice 1's merge state).

**Option A3 (recommended shape) — split into 4a (item/sub-item CRUD +
hierarchy picker, master-only) and 4b (batch group claim, depends on
Slice 3).** This is a scope/sequencing question the brief itself already
surfaces as a PM-owned fork (Open question 1) rather than an architect
unilateral call, but architecturally it is the option that best isolates
risk: 4a has zero Slice-3 dependency and can be fully built, tested, and
merged against `master` today, closing acceptance signals 1, 2 (the
single-unit half), and 5 without touching any unmerged code. 4b then forks
from wherever Slice 3 lands (A1 or A2, decided once, at 4b's start rather
than now) with a narrower, better-isolated diff — a single new route plus
a client extension of the already-existing group-review section, not
tangled with the CRUD/picker work. This also directly serves the PM
framing already on record in the brief: *"noting that option here for the
PM rather than deciding it myself."* Architecturally I concur with keeping
the split live as the leading option; A2's blocking-indefinitely risk and
A1's inherited-churn risk are both real, and splitting is the only option
of the three that lets the risk-free two-thirds of this slice's value ship
without absorbing either.

### B. `review_status='claimed'` transition ownership

**Option B1 (recommended) — a new, dedicated route verb + a new
`value-groups.js`-owned setter, called from inside the batch-claim
transaction.** Mirrors `DEC-S3-9`'s own precedent exactly: `approve`/
`dismiss` are two named verbs specifically so no body-supplied status can
reach the DB; a third body-supplied-status caller of
`setValueGroupReviewStatus` (e.g. `POST .../review-status {status:
"claimed"}`) would reopen exactly the hole `DEC-S3-9` closed. Concretely:
add `setValueGroupClaimed(dbModule, groupId, claimedAt)` (or extend
`setValueGroupReviewStatus`'s *comment*, not its call sites, to say "and
the batch-claim route, transactionally") inside `value-groups.js` — not
`plan-lifecycle.js` — because `value_groups` is `value-groups.js`'s owned
table per its own header comment ("SOLE writer... G-8"), and
`plan-lifecycle.js` has never touched that table. The batch-claim **route**
(in `project-plans.js`) calls both `value-groups.js`'s setter and
`insertValueClaim` inside one `dbModule.db.transaction(...)` — it does not
inline a second hand-rolled `UPDATE value_groups` statement itself, which
would be a second, undocumented writer of a table whose own file header
makes an ownership claim.

**Option B2 — `plan-lifecycle.js` owns the transition instead**, on the
theory that claiming is fundamentally a plan-lifecycle event. Rejected:
`plan-lifecycle.js`'s own header comment enumerates exactly two things "no
other module may do" (`closePlan`, `importGenerationFromPlan`) and neither
resembles group review-status; giving it a third responsibility over a
table it has never read or written, defined in a different module's
schema block, muddies the "which module owns this table" boundary this
project's catalog has repeatedly flagged as exactly the kind of
implicit-ownership drift that leads to a second hand-copy (§9.1's
"Build-outcome note," `plan-writeback.applyDisposition` case: the guard
caught the composer the entry was written about and missed a second-order
duplicate one call frame away).

### C. Batch-claim transaction shape

**Option C1 (recommended) — extract the single-claim body's write logic
into a shared function both routes call inside one transaction, looped for
batch.** The single-claim route's actual write is small (validate →
resolve/create `item_id` → `insertValueClaim`, wrapped in a `try`/`catch`
for the `UNIQUE` constraint). Extract that into
`claimUnitIntoItem(dbModule, { planId, itemId, unit-fields })` returning a
discriminated result (`{status: "claimed", claim}` /
`{status: "duplicate"}`), have the existing single-claim route call it
once (no behavior change — acceptance signal 5), and have the new
batch-claim route call it N times inside `dbModule.db.transaction(() =>
{...})()`, filtering to `available` members first via
`resolveMemberAvailability` (reused, not re-derived) so
`already_claimed`/`no_longer_in_pool` members never reach the write path
at all, and are reported back to the client only as informational
skip-reasons. This satisfies WATCH-6's own instruction verbatim ("route
both through one shared composer... rather than hand-rolling a second
INSERT sequence") and closes the gap the brief's own Live verification #8
found: no existing `single-writer-guard.test.js` entry names
`insertValueClaim`, and this slice is the one that must add it (an
`assertSingleHome`-style entry naming `claimUnitIntoItem` as the sole
`insertValueClaim` call site, `project-plans.js` as its sole consumer).

**Option C2 — hand-roll the batch INSERT loop separately from the
single-claim route's inline logic**, matching the shape today (each route
owns its own copy of "validate + insert"). Rejected on WATCH-6's own
express instruction, and because this is the shape this project's own
defect catalog has burned on repeatedly and by name: §9.1's "5th touch" —
Playbook's `resolvePracticeConfig`/`validateConfigPatch` field-validation
rule written twice, independently, failing in opposite directions — is the
generalized version of exactly this risk. A second hand-rolled INSERT
sequence for `value_claims` is this catalog's single most-cited defect
shape, reapplied to a new table.

## 4. Architectural risks

- **The all-`available` invariant is not automatically true — a real
  TOCTOU race exists between group approval and the batch-claim click.**
  Time passes between `GET /groups` returning `available` members and the
  user clicking batch-claim; another route (the individual single-claim
  gesture, or a second browser tab) can claim one of those same units in
  between. `resolveMemberAvailability` is read-time-derived specifically to
  make this race visible rather than assumed away — the batch-claim route
  must re-resolve availability **inside** the same transaction/request that
  performs the writes (not trust a client-supplied "these are the
  available ones" list), or the transaction can attempt a duplicate insert
  that the `UNIQUE (value_source, value_ref, source_cwd, item_id)`
  constraint will then reject mid-loop — which is fine *if* the loop
  catches that per-member and reports it as a discriminated outcome, and
  a defect *if* one member's duplicate-claim exception is allowed to abort
  the whole transaction (contradicts acceptance signal 3's "all eligible
  members land, or none do" — that invariant is about the transaction
  boundary for genuinely-eligible members, not about tolerating zero
  actually-claimable members as a silent no-op success).
- **§9.8 OVERLOADED-ABSENCE is live and specifically named for this
  surface.** A batch-claim response that collapses per-member outcomes
  into one success/fail boolean, or that renders "0 members claimed" the
  same whether the cause was "all already claimed," "all vanished from the
  pool," or "network dropped mid-transaction," reproduces the exact shape
  this catalog has promoted to a numbered entry twice already on this same
  Value Pool surface. `GROUP_MEMBER_AVAILABILITY` is the pre-established,
  reusable vocabulary; the claim outcome should extend it (e.g.
  `claimed` / `skipped_already_claimed` / `skipped_no_longer_in_pool`)
  rather than mint a fresh, unrelated one — a fresh vocabulary that happens
  to mean the same three things as the existing one would itself be a
  small instance of §9.1 (two names for one distinguishable-outcome set).
- **§9.1 DERIVED-DUAL-VIEW — the hierarchy-aware picker is consumer #2 of
  `buildItemTree`, and Slice 3's group-claim picker (once wired) is
  consumer #3.** This is explicitly the shape this catalog's own
  "Design-time pre-flag" language calls out as the failure point: not at
  introduction, but at second-consumer time, which is now. `buildItemTree`
  must be reused (imported, not reimplemented) by whatever new picker
  component this slice adds; a second `parent_item_id`-to-tree walk for the
  `<select>`'s option list is precisely the "rogue re-derivation" this
  catalog's history says is the commonest live shape of this defect class.
- **§9.7 HAND-SCOPED STRUCTURAL SCAN — a `single-writer-guard.test.js`
  entry added for `insertValueClaim` must derive its consumer scope from a
  real import/grep, not a hand-typed list of "the two files I know about."**
  This catalog's own history (the "commonest live shape... now" 2026-08-02
  note) is a static guard that is real and red-provable for the names it
  was hand-typed with, and silently blind to everything else. If a future
  slice adds a third `value_claims` writer, a hand-typed two-entry consumer
  map for this guard would stay green while missing it.
- **The `CONSUMERS` registry growth-rule tension (Slice 3's still-open QA
  finding) is directly adjacent, not resolved, and this slice should not
  reopen it.** `value-ledger.js`'s `CONSUMERS` registry docstring states
  its own growth rule is *"grow this list ONLY when the new consumer reads
  `computePlanHealth`/`assembleValuePool`/`summarizeDeliveredValue`
  directly."* Slice 3's own `decisions.md` records this rule was found to
  be **falsified by Slice 3's own registration** (`value-groups.js` never
  calls `assembleValuePool`) and ruled to be widened "in the same commit as
  the 4th entry" — but confirms the generalized structural cure
  (`assertConsumerScopeDerived`, ~40 lines, both constituent patterns
  already exist in-tree) remains **escalated to Sara as an open decision,
  not yet built** ("declining means a 5th hand-registration in Slice 4").
  This slice's `value-groups.js` import (for `resolveMemberAvailability`)
  does not itself read `assembleValuePool`/`computePlanHealth`/
  `summarizeDeliveredValue` either, so if this slice's technical plan
  touches `CONSUMERS` at all, it inherits the same tension Slice 3 already
  flagged and did not resolve structurally — it should not be silently
  re-litigated inside this slice's own build.
- **Trust boundary / migration note.** `value_groups.review_status`'s
  CHECK constraint already includes `'claimed'` on the Slice-3 branch (no
  schema migration needed for this slice, assuming Slice 4 builds on or
  after that schema exists) — but per this project's `WATCH-4`
  ("CHECK-constrained enums are rebuild-to-widen"), if Slice 3's branch
  merges with a *narrower* CHECK than what's on the branch today (e.g. if
  Slice 3's own review round trims the reserved value before merge), Slice
  4 would need its own rebuild-to-widen migration — a real, if currently
  low-probability, dependency-branch risk that reinforces why Option A3's
  isolation of 4b matters: a narrower merged CHECK is exactly the kind of
  "Slice 3 needs changes before merge" churn A1 explicitly accepts and A3
  defers past the point where it's knowable.

## 5. Out-of-scope items that need tracking, not just prose

The following are named here as **deliberately out of scope for this
architectural pass** and must not be left as prose alone — each needs an
explicit `decisions.md` PENDING/WATCH row once this intake reaches
`pm-plan.md`/`decisions.md`, not just this sentence:

1. **The `assertConsumerScopeDerived` generalized cure** (§4 above) is
   Slice 3's own unresolved escalation to Sara, still open at Slice 3's own
   `decisions.md`. This slice's `CONSUMERS` touch (if any) should not
   silently inherit or re-decide it — it needs its own WATCH row noting
   Slice 4 is (at minimum) the 5th hand-registration if the cure stays
   undecided, cross-referenced to Slice 3's existing escalation rather than
   duplicating the decision.
2. **The branch-sequencing choice itself (A1 vs. A2 vs. A3)** is,
   correctly, a PM call per the brief's own framing — but once made, it
   needs a `decisions.md` row with an explicit trigger for re-evaluation
   (e.g. "if Slice 3 is still unmerged by build start, re-confirm A1 vs.
   A3" for a provisional A1/A3 pick, or "if `PROJECT-CONTEXT.md`'s
   uncommitted conflict is still unresolved after N days, escalate" for a
   provisional A2 pick) — not left as this document's own prose, which
   nobody re-reads once build starts.
3. **The `value_groups.review_status` CHECK-narrowing risk under WATCH-4**
   (§4 above) should get a WATCH row of its own if Option A1/A3-forking-
   from-branch is chosen, since that is the scenario where a narrower
   merged CHECK could surface after Slice 4's build has already started
   against the branch's wider one.

## 6. Recommended approach

**Branch sequencing:** Option A3 (split 4a/4b) as the architecturally
soundest shape — 4a ships value today with zero Slice-3 dependency and
zero risk from either A1's inherited-churn or A2's indefinite-stall
exposure; 4b's narrower diff is deferred to whenever Slice 3 actually lands
(A1 or A2 decided fresh at that point, informed by Slice 3's real merge
state then, not now). This is a scope call the PM should ratify, but
architecturally it dominates both single-branch options on risk.

**`review_status='claimed'` ownership:** Option B1 — a new
`value-groups.js`-owned setter (dedicated verb, not a body-supplied
status), called transactionally from the batch-claim route in
`project-plans.js`. This is the only option consistent with both this
table's stated single-writer ownership and `DEC-S3-9`'s explicit,
already-shipped precedent against a body-supplied-status hole.

**Batch-claim transaction:** Option C1 — extract and share the single-claim
write logic (`claimUnitIntoItem`), call it in a loop inside one
transaction for the batch route, re-resolve availability inside that same
request rather than trusting a client-supplied list, and report a
discriminated per-member outcome extending `GROUP_MEMBER_AVAILABILITY`'s
existing vocabulary. This is the only option that satisfies WATCH-6, keeps
`insertValueClaim` single-sourced, and gives §9.8 a real, named-state fix
rather than a fresh instance.
