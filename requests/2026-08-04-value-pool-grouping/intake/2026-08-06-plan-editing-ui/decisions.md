# Decision Log — Value Pool Slice 4: Plan editing UI + batch group claiming

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/`
**Opened:** 2026-08-06 by `intake-project-manager` (Wave 2), alongside `pm-plan.md`.
**Run mode:** `auto-pilot` — PREFERENCE gates are decided by the team and logged
`DECIDED-AUTO`; Sara may reverse any of them without reopening the build. QUALITY
gates (a genuinely BLOCKED verdict) still stop.

Ids are folder-local: `DEC-S4-*` for rulings, `WATCH-S4-*` for carried risk,
matching Slice 2's `WATCH-S2-*` / Slice 3's `DEC-S3-*` conventions. Every WATCH
row states **`Fires-on:`** (the concrete event) and **`Lands-in:`** (the file that
will change), per Slice 3's PM-6.2.

Status values: **PENDING** (asked, awaiting answer) · **DECIDED** ·
**DECIDED-AUTO** (decided by the team itself under `auto-pilot`, on its own best
recommendation, without asking) · **PARKED** · **SUPERSEDED**.

**Binding inputs consumed as CLOSED — do not re-litigate:**
**DEC-3** (Slice 2, 2026-08-05 — `MAX_PROJECTS_PER_TICK` default 3 is a *spec*;
OPEN-4 is **closed**, not pending; no second tuning mechanism) ·
**DEC-16** (`assembleValuePool` is the sole pool composer; `CONSUMERS` grows
deliberately) · **WATCH-6** (single-writer guards widen only deliberately) ·
**DEC-S3-5** (`GROUP_MEMBER_AVAILABILITY` = `available`/`already_claimed`/
`no_longer_in_pool`, read-time derived, never persisted) · **DEC-S3-8**
(`claimed` reserved in the `review_status` CHECK at introduction, unreachable in
Slice 3, proven by structural scan) · **DEC-S3-9** (approve/dismiss are two named
route verbs; a body-supplied status is a hole `claimed` could reach the DB
through) · **DEC-S3-10** (`value-groups.js` never calls `assembleValuePool`; it
is still a registered `CONSUMERS` entry) · **DEC-10 / DEC-11** (catalog and
planning-note edits are applied on the effort branch, never on the shared dirty
main checkout).

---

## Rulings summary

| Id | Ruling | Status |
|---|---|---|
| **DEC-S4-1** | **Split into 4a / 4b as two build phases inside ONE slice** (one folder, one intake, one QA pass, one decision log). 4a forks from `master` now; 4b's fork point is decided fresh at 4b's start. The parent doc's "four slices" framing is **not** renumbered. | DECIDED-AUTO |
| **DEC-S4-2** | **The pre-existing single-claim `new_item` non-atomicity is folded into scope — into 4a, not 4b** — and `D4` is **rewritten, not extended**. Billed **our cost (bug carve-out)**, not new-ask scope. | DECIDED-AUTO |
| **DEC-S4-3** | **AC-9 field scope for 4a = `text` + hierarchy placement (`parent_item_id`) only.** `acceptance`/`detail`/`target_date` inline editing is a **named, dated deferral** (WATCH-S4-B), not a silent gap. | DECIDED-AUTO |
| **DEC-S4-4** | **Defect-catalog updates are NOT written to `PROJECT-CONTEXT.md` on this checkout.** They ship as a ready-to-paste patch file in this folder, applied on 4a's effort branch. | DECIDED-AUTO |
| **DEC-S4-5** | **The parent `request.md` gains a dated `## Corrections` section** (append-only, never rewriting Sara's words) carrying the two premises of hers this pipeline has now falsified. Landed on 4a's effort branch. | DECIDED-AUTO |
| **DEC-S4-6** | **WATCH-S3-A's substance is folded into 4b's AC set explicitly**, not carried a fourth time; and the brief template gains a mechanically-populated "carried rows firing on this slice" section. | DECIDED-AUTO |
| **DEC-S4-7** | **Re-parenting an existing item needs a server change; the cycle guard ships with it.** In scope for 4a. (Tech-lead addendum, folded in.) | DECIDED-AUTO |
| **DEC-S4-8** | **G-B is widened to genuinely cover all four `project_plan_items` writers**, not renamed; the derived `assertTableWritersSingleHome` helper ships with it. (QA addendum, folded in.) | DECIDED-AUTO |
| **DEC-S4-9** | **`WATCH-S4-F`'s factual premise is corrected**; the deletion FK/raw-500 defect stays out of 4a's build scope; one characterization test pins today's behavior. (QA addendum, folded in.) | DECIDED-AUTO |
| **DEC-S4-10** | **D4's rewrite keeps `DEC-S4-2`'s invalid-`value_source` fixture** as well as the composer forced-throw case; **P5 requires a depth ≥ 4 fixture**. (QA addendum, folded in.) | DECIDED-AUTO |

---

## DEC-S4-1 — Split Slice 4 into 4a and 4b

- **Item / area:** build sequencing — `client/src/components/PlanLedgerPanel.tsx`,
  `server/routes/project-plans.js`, branch topology
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 (independently, by all four evaluators) ·
  **Decided:** 2026-08-06 · **Decided by:** auto-pilot (`intake-project-manager`)
- **Recurring-issue link:** §9.4 FIX-ROUND-REGRESSION (rebase-driven churn);
  `PROJECT-CONTEXT.md` planning note *"Intake throughput can outrun build
  throughput, and the working tree pays for it"* (2026-08-05)

### The question

Slice 4 contains two halves with different dependency profiles. The item/sub-item
CRUD UI and hierarchy-aware claim picker depend on nothing but already-merged
`master` code. Batch-group-claim is meaningless without Slice 3's `value_groups` /
`value_group_members` schema, which exists only on the unmerged
`effort/2026-08-06-auto-group-proposal` branch (tip `72feac9`, confirmed live —
`git branch --merged master` does not list it), and that branch's own merge is
blocked on a live concurrent session's uncommitted 65-line edit to
`PROJECT-CONTEXT.md` in this shared working tree. Do we build Slice 4 as one
unit, or split it?

### Where we're coming from (history, as of 2026-08-06)

- **2026-08-04:** Sara approves a four-slice sequence, verbally, in one session.
  Its own carry-forward reads *"Slices ship independently, in order, each through
  the full team-intake → team-qa → team-build pipeline on its own effort branch."*
- **2026-08-05:** Slices 1 and 2 merged (`b38b4a1`, `4c2e931`, `5ec640b`).
  Slice 2's `DEPENDENCY-F1` was written on a **factually wrong premise** about
  Slice 1's merge state — this project has already paid, once, for reasoning about
  a stacked branch instead of checking it.
- **2026-08-05:** Slice 2's `pm-plan.md` PM-5 records the planning note *"do not
  intake slice N+1 of a multi-slice request until slice N's build has landed."*
  Slice 3's PM plan §4c reported this note **held** for Slice 3 — Slices 1 and 2
  were merged and the tree was clean.
- **2026-08-06:** It no longer holds. Slice 3 is **code-complete and unmerged**
  (`44720c3` + `72feac9` on its branch), the working tree carries two uncommitted
  files from a concurrent session, and Slice 4 is being intaken anyway. The note's
  own predicted cost — an intake decision resting on an ambiguous tree — is
  exactly the risk in front of us.
- **2026-08-06, this intake:** the request-brief flags the dependency as
  non-blocking-for-intake but a **hard precondition for build to compile**, and
  routes the split option to the PM by name. All four evaluators then
  independently recommended the split: PO §5 (*"treat the two halves as separably
  shippable… fork the effort branch now"*), architect §3A option **A3**
  (*"architecturally it dominates both single-branch options on risk"*), engineer
  §5.2a (*"item CRUD UI + hierarchy picker first — zero Slice-3 dependency"*),
  QA §2 (the Slice-3-only spec `value-groups-api.test.js` *"cannot be asserted
  green on `master` until that branch merges"*).

### Options presented

- **A) A1 — fork all of Slice 4 from `effort/2026-08-06-auto-group-proposal`.**
  Unblocks everything today and builds the batch half against the real schema
  rather than a stub. Cost: Slice 4 inherits every change Slice 3 still needs
  before its own merge — including Slice 3's **still-open, escalated-to-Sara**
  `assertConsumerScopeDerived` decision — as a rebase of a schema-and-route
  branch onto a moving base. That is §9.4's named shape on this project's
  highest-defect surface. It also puts the zero-dependency two-thirds of this
  slice's value behind an administrative blocker it does not need.
- **B) A2 — wait for Slice 3 to merge to `master`, then fork cleanly.**
  Cleanest base, no inherited churn. Cost: the blocker is an *uncommitted edit in
  another session's working tree* with no visible resolution timeline. Waiting on
  it stalls the whole slice indefinitely for a reason that has nothing to do with
  this slice's code.
- **C) A3 — split into 4a (CRUD + picker, forks from `master` today) and 4b
  (batch group claim, forks from wherever Slice 3 lands).** Isolates the risk:
  4a absorbs neither A1's inherited churn nor A2's indefinite stall; 4b's diff
  becomes narrow and reviewable (one route, one composer, one client section)
  instead of tangled with unrelated CRUD work.
- **D) A3 + renumber the initiative to five slices.** Rejected below.

### Decision

**Chosen: C) A3 — split into 4a and 4b — with three binding constraints that no
evaluator specified.**

**Constraint 1 — this is a split of *build phases*, not of *slices*.** One slice
folder, one intake, one `decisions.md`, one QA pass, one `technical-plan.md`
covering both phases. The parent doc's four-slice shape stays four. The PO's §5.3
objection is correct and is honored: reshaping a framing Sara approved verbally is
not an auto-pilot call, and it is not necessary to get the benefit. Option **D**
is rejected on exactly that ground. It also avoids doubling per-slice pipeline
overhead on a file family whose own catalog names it this project's highest-density
defect zone — more passes is not free here.

**Phase split:**
- **4a** (forks from `master` **now**, zero Slice-3 dependency): AC-8, AC-9
  (as narrowed by DEC-S4-3), AC-10, AC-13, **plus DEC-S4-2's atomicity fix**.
- **4b** (forks from wherever Slice 3 lands): AC-11, AC-12, AC-14, AC-15, plus
  WATCH-S3-A's claim-time re-validation (DEC-S4-6).

**Constraint 2 — the A1-vs-A2 question is deferred, not answered, and it is
deferred *with a trigger*.** 4b's fork point is decided at 4b's start, informed by
Slice 3's real merge state *then*. This is the architect's own framing and it is
the honest one: today's answer would be a guess about a blocker owned by another
session. Recorded as **WATCH-S4-C**.

**Constraint 3 — merge-order collision, which nobody flagged, and which is the
one way this split can actually cost more than it saves.** 4a and Slice 3's branch
both edit `client/src/components/PlanLedgerPanel.tsx` (Slice 3's diff there is
**+363 lines**), `PlanLedgerPanel.test.tsx`, all four
`client/src/i18n/locales/*/projectDetail.json` files, and
`client/src/pages/__tests__/screens.snapshot.test.tsx` (Slice 3 already touches
its baseline, +25 lines). Whoever merges second rebases, in the exact file family
this project's catalog is written about. Ruling:

- **Slice 3 merges first if it is mergeable at the moment 4a is review-complete.**
  Expected outcome: Slice 3 is code-complete today and 4a is not started, so this
  should resolve itself.
- **If Slice 3 is still blocked when 4a is review-complete, 4a merges first** —
  the split's whole purpose is to not be hostage to that blocker — and Slice 3's
  branch owner then rebases with a named obligation: re-run `npm run test:client`
  in full and **review** (never blind-regenerate) the `screens.snapshot.test.tsx`
  diff after the rebase. §9.4's rule applies verbatim: the fix round is a build
  round. Recorded as **WATCH-S4-A**.
- **Any git operation that touches this shared checkout follows the posture Sara
  herself set on 2026-08-05** (Slice 2 `decisions.md`, Step 1 reconciliation:
  *"Confirmed with Sara before touching the shared main checkout (3 live Claude
  sessions attached to this cwd at the time)"*), and this project's own memory note
  on concurrent-session risk. Check `ps`/`lsof` first; confirm before merging.

**Rationale / implications:** 4a can start immediately and delivers real,
independently valuable capability (an open plan today has **zero** add/edit
affordances — confirmed live) without waiting on a blocker it does not share.
4b's dependency stops being a silent assumption and becomes a dated row with a
trigger. Reversal cost is low before 4a's branch is cut and rises after.

---

## DEC-S4-2 — The single-claim `new_item` path is not atomic: fix it here, in 4a

- **Item / area:** `server/routes/project-plans.js` `POST /:id(\d+)/claims`;
  `server/__tests__/project-plans-api.test.js` D4
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 (engineer §2 and QA §2, independently, same day) ·
  **Decided:** 2026-08-06 · **Decided by:** auto-pilot (`intake-project-manager`)
- **Recurring-issue link:** **§9.3 VACUOUS-GUARD** — a new sub-shape (see below)

### The question

The existing single-claim route's inline `new_item` form is described as atomic —
by the code's own test name, by the parent `request.md`, and by this slice's
request-brief. It is not. Should Slice 4 fix it, or log it as a follow-up?

### Where we're coming from (history, as of 2026-08-06)

- **2026-08-02**, `plan-lifecycle-value-ledger` ships `POST /:id/claims` with the
  inline `new_item` form, and ships `D4: new_item inline form is atomic — failure
  leaves neither claim nor item created` green alongside it.
- **2026-08-04**, Sara's `request.md` states, as an approved premise for Slice 4:
  *"the claims API's atomic inline `new_item` already supports the shape."*
- **2026-08-06**, this intake's request-brief repeats it, and its acceptance
  signal 4 is built on it.
- **2026-08-06**, engineer §2 and QA §2 each read the route directly and each
  found the same thing. **Re-verified independently by the PM before ruling**
  (`server/routes/project-plans.js`, `POST /:id(\d+)/claims`): the handler calls
  `planLifecycle.insertProjectPlanItem(...)` first, then validates
  `value_source` / `attribution` / `value_ref` (each of which can `400` **after**
  the item row has already committed under better-sqlite3 autocommit), then calls
  `dbModule.stmts.insertValueClaim.run(...)` in a bare `try`/`catch` for the
  `UNIQUE` collision. There is **no `dbModule.db.transaction(...)` anywhere in the
  handler.** A valid `new_item` plus an invalid `value_source` leaves a committed,
  orphaned plan item and returns a 400.
- D4's own failure case is `new_item: { text: "" }` — **re-read directly and
  confirmed** — which fails inside `insertProjectPlanItem`'s own `INVALID_INPUT`
  guard *before any row is written*. The one failure mode D4 exercises is the one
  that cannot produce the defect its name denies.

### Options presented

- **A) Fold into 4b**, alongside the batch route, since 4b's shared composer
  (`claimUnitIntoItem`) is the natural home for the transaction wrapper.
- **B) Fold into 4a.** The fix is 100% on already-merged `master` code and has
  zero Slice-3 dependency.
- **C) Log as a separate follow-up item**, out of Slice 4's scope entirely.

### Decision

**Chosen: B) fold into 4a.** Billed **our cost — a `bug` carve-out**, not new-ask
scope (see `pm-plan.md` §2 and §6).

Four grounds:

1. **A false premise is load-bearing for a design that has not been built yet.**
   Acceptance signal 4 and AC-12 both say "reuse the existing atomic `new_item`
   shape." Reusing a shape that is not atomic, in the slice whose headline
   requirement is *"either all eligible members land, or none do,"* is how a
   defect gets copied rather than found. This is the §9.1 second-hand-copy
   mechanism operating on a *guarantee* rather than on code.
2. **D4 is a live §9.3 instance in shipped code, and it has already been cited
   forward.** This intake's own QA doc calls D4 *"the direct precedent for this
   slice's atomicity requirement."* A false-green guard is worse than no guard
   precisely because the next change reads the checkmark and stops looking —
   §9.3's own words. This one did exactly that, to this intake, today.
3. **Why 4a rather than 4b (rejecting option A).** The fix touches only
   `server/routes/project-plans.js` and `server/lib/plan-lifecycle.js` on
   `master`. Putting it in 4b chains a live, shipped, user-reachable data-integrity
   defect to a branch that is blocked on another session's uncommitted file. That
   is an unacceptable pairing for a defect that is independently fixable today.
   It is also *cheaper* this way: 4b's shared composer is easier to build correctly
   when the single-claim route it extracts from is already transactional — 4a
   delivers the transactional core, 4b adds the loop and the group transition.
4. **Why not option C.** "Separate follow-up item" is the disposition this
   project's §9.4 rule explicitly rejects: *a finding ends fixed-with-a-test or
   dated-and-disposed; "should-fix" is a triage label, not a disposition.* And the
   deferral would be recorded in a `decisions.md` — which DEC-S4-6 below documents
   is precisely the artifact the next slice does not read.

**Binding on how the fix ships:**

- **The whole `new_item` → validate → `insertValueClaim` sequence is wrapped in one
  `dbModule.db.transaction(...)`.** Reordering validation before the item insert is
  *also* correct and should be done, but it is **not sufficient on its own** — the
  `UNIQUE (value_source, value_ref, source_cwd, item_id)` collision can only be
  discovered at insert time, after the item exists. Both, not either.
- **D4 is rewritten, not extended**, and its replacement must exercise the
  post-item-insert failure case (valid `new_item`, invalid `value_source`) and
  assert **no orphan item survives**. A test whose name overclaims is replaced,
  never adjusted until green — the same disposition WATCH-S3-D set for T7.
- **Red-proven by mutation, once, by someone other than its author** (§9.3
  AGENT-SELF-REPORTED-RED): remove the `transaction(...)` wrapper, watch the new
  case fail, restore byte-identical, re-run green. Reported as an observation, not
  as an intention.
- **Existing single-claim behavior is otherwise unchanged** — acceptance signal 5
  and AC-13 still bind; the happy path's response shape does not move.

**New §9.3 sub-shape, recorded for the catalog (see DEC-S4-4).** D4 is none of
§9.3's six catalogued shapes — it is not empty, not a tautology, not an existence
check, not an escape hatch, not an uncalled helper, not an impossible fixture. It
has real assertions that really pass and would really fail if the thing they check
broke. Its defect is **scope**: it names a guarantee ("atomic") and exercises only
the one failure mode that cannot violate it. Proposed name:
**NAME-OVERCLAIMING GUARD** — *the assertion is honest; the test name is a
superset of it, and the name is what the next reader believes.* This shape is
harder to catch than the other six because nothing about it looks vacuous.

---

## DEC-S4-3 — AC-9 field scope for 4a is `text` + hierarchy placement only

- **Item / area:** `client/src/components/PlanLedgerPanel.tsx` item edit affordances
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 (request-brief open question 2; PO §6.2) ·
  **Decided:** 2026-08-06 · **Decided by:** auto-pilot (`intake-project-manager`)
- **Recurring-issue link:** §9.8 OVERLOADED-ABSENCE (a deferral that is silent is
  an absence wearing a decision's clothes)

### The question

`request.md` says "add/edit items and sub-items" without naming fields. Server CRUD
supports `text`, `acceptance`, `detail`, `checked`, `position`, `target_date`.
Which get UI in this pass?

### Where we're coming from (history, as of 2026-08-06)

Sara's verbal framing is *"edit the plan in the UI — add milestones and
sub-milestones."* The PO ruled `text` + hierarchy placement is the literal minimum
for a *usable* editing surface (AC-9) and required that anything deferred be a
named row rather than a gap discovered at QA. No requester signal exists for the
other three fields at all.

### Options presented

- **A) `text` + `parent_item_id` placement only.** Smallest surface that satisfies
  the stated want.
- **B) Add `acceptance` / `detail` / `target_date` inline now.** Complete editing
  surface; three more form controls, three more i18n keys × 4 locales, three more
  test cases, on the component this project's catalog is most written about.
- **C) Everything including `checked` / `position`.** Rejected without discussion —
  `position` has no requester signal and reordering is a distinct interaction
  design problem.

### Decision

**Chosen: A.** 4a ships `text` editing and `parent_item_id` placement
(top-level ↔ sub-item, and of which parent). `acceptance` / `detail` /
`target_date` are deferred as **WATCH-S4-B**, with `Fires-on:` and `Lands-in:`.

**Rationale / implications:** 4a's entire value proposition is shipping the
independent half quickly while Slice 3's merge is stuck; each added field is
i18n fan-out across four locale files plus snapshot churn on the exact component
that carries this project's `MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH` and
`STRICTMODE-BLIND CLIENT SUITE` candidate patterns. Reversal is cheap and purely
additive. Sara can veto by naming which fields she wants and it costs one more
form pass, not a redesign.

**One inherited obligation, carried explicitly because 4a is the first UI to call
`insertProjectPlanItem` with a user-chosen parent:** the engineer found that
`insertProjectPlanItem`'s `parent_item_id` validation only checks that the parent
*exists* — not that it belongs to the same plan, and not that it does not create a
cycle. 4a's parent picker must be sourced from `buildItemTree(plan.items)` for the
**current plan only**, which makes cross-plan parenting structurally unreachable
from the UI rather than merely unlikely (§9.6 — prefer inapplicability over
compliance). Server-side hardening is **not** in 4a's scope; recorded as
**WATCH-S4-D**.

---

## DEC-S4-4 — Catalog updates ship as a patch file, not as an edit to `PROJECT-CONTEXT.md`

- **Item / area:** `PROJECT-CONTEXT.md` §9.3
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 · **Decided:** 2026-08-06 · **Decided by:** auto-pilot
- **Recurring-issue link:** — (process; follows **DEC-10** and **DEC-11**)

### The question

DEC-S4-2 found a new, previously unlogged live §9.3 instance in shipped code, and
a new §9.3 sub-shape worth naming. The PM's standing obligation is to update the
catalog. Do it now, on `master`?

### Where we're coming from (history, as of 2026-08-06)

`git status` shows `PROJECT-CONTEXT.md` carrying an **uncommitted 65-line edit
from a live, unrelated concurrent session** in this shared working tree (this
intake was explicitly instructed to read the file at committed `HEAD` only, and
did). This project has a settled posture for exactly this situation, set twice:
**DEC-10** (Slice 1, 2026-08-04 — catalog notes applied on the effort branch, not
the dirty main checkout), **DEC-11** (Slice 2, 2026-08-05 — same, for the planning
note), and the `team-qa` addendum pattern already living in
`intake/2026-08-04-altitude-invalidation/decisions-qa-addendum.md`, whose own
header states the reason verbatim: *"editing it here risks sweeping QA text into
another session's commit and forking the log."* Sara's own confirmation posture on
this checkout (Slice 2, 2026-08-05) points the same way, as does this project's
memory note that concurrent sessions on this cwd *have caused real work loss*.

Slice 3's PM plan §6.3 applied catalog notes directly to `master` — correctly,
because on that day the tree was clean apart from intake documents. Today it is
not. The condition that justified Slice 3's call is absent.

### Options presented

- **A) Edit `PROJECT-CONTEXT.md` now on `master`** — the catalog is current
  immediately; risks colliding with another session's in-flight 65-line edit to the
  same file.
- **B) Write a ready-to-paste patch file in this intake folder**, applied on 4a's
  effort branch at the request-tree copy step.
- **C) Defer entirely** until the other session lands. Rejected — an unrecorded
  finding is how §9.3 findings get lost, and the trigger would depend on somebody
  noticing.

### Decision

**Chosen: B.** `catalog-patch.md` is written in this folder with the exact §9.3
text to add (the D4 instance, dated, plus the **NAME-OVERCLAIMING GUARD**
sub-shape), and is applied on 4a's effort branch in the same commit that copies
the request tree — then deleted, so there is exactly one catalog.

**Rationale / implications:** consistent with DEC-10/DEC-11 rather than a fresh
posture; zero risk to another session's work; the finding is recorded today either
way. **No occurrence counts are incremented by this intake for §9.1 / §9.7 / §9.8
— nothing has been built, and those are design-time pre-flags** (Slice 3's PM plan
§2 rule, applied unchanged). §9.3 is the sole exception: D4 is a *found live
instance in shipped code*, not a pre-flag.

---

## DEC-S4-5 — The parent `request.md` gains an append-only `## Corrections` section

- **Item / area:** `requests/2026-08-04-value-pool-grouping/request.md`
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 (PM cross-read) · **Decided:** 2026-08-06 ·
  **Decided by:** auto-pilot
- **Recurring-issue link:** — (see `pm-plan.md` §4, the recurrence diagnosis)

### The question

Two premises in Sara's approved `request.md` are now known false, and both were
re-quoted by this slice's request-brief as if live. Where does a correction go?

### Where we're coming from (history, as of 2026-08-06)

1. **`request.md` line ~96:** *"OPEN-4 (env tune `MAX_PROJECTS_PER_TICK`) is still
   undecided by Sara."* **Closed by DEC-3 on 2026-08-05** — the default of 3 is a
   spec, there is to be no second tuning mechanism. Slice 3's PM plan §3c caught
   this **one day ago** and ruled *"cite DEC-3, do not re-argue it."* That
   correction was written into a `pm-plan.md`. **Nobody edited `request.md`.**
   This slice's request-brief (lines 35–37) quotes the stale bullet verbatim,
   under a heading calling it a live constraint binding all four slices. Second
   occurrence in two days.
2. **`request.md` line ~82:** *"the claims API's atomic inline `new_item` already
   supports the shape."* False since 2026-08-02 (DEC-S4-2). Quoted forward by this
   slice's brief and by acceptance signal 4.

### Options presented

- **A) Edit the bullets in place.** Rejected outright: `request.md` is the record
  of what Sara said and approved. Silently rewriting a requester's own words to
  match what the team later learned is how a requirement document stops being
  evidence.
- **B) Append a dated `## Corrections` section** beneath her text, each entry
  naming the original claim, the falsifying evidence, and the decision id that
  governs now.
- **C) Leave it; the pm-plans carry the corrections.** This is the status quo, and
  §4 of the pm-plan shows the status quo has now failed twice.

### Decision

**Chosen: B.** The section is appended, dated, with the two entries above.
It lands on 4a's effort branch (DEC-S4-4's posture for the shared checkout — note
`request.md` itself is *not* among the files the concurrent session has modified,
so this is precaution, not necessity).

**Rationale / implications:** this is the concrete half of the durable fix in
`pm-plan.md` §6. It costs one append per falsified premise and it puts the
correction in the one file every slice's triage is guaranteed to read. Sara's
original words are preserved intact above it.

---

## DEC-S4-6 — WATCH-S3-A is folded into 4b's ACs; carried rows get transcluded, not carried

- **Item / area:** intake process; 4b's acceptance criteria
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 (PM cross-read) · **Decided:** 2026-08-06 ·
  **Decided by:** auto-pilot
- **Recurring-issue link:** — (Slice 3 PM-6.2's cure, first test)

### The question

Slice 3 opened **WATCH-S3-A** — *"claim-time member re-validation… **Fires-on:**
Slice 4's batch-claim build. **Lands-in:** Slice 4's claim route + its transaction
test"* — the sharpest-possible instance of the `Fires-on:`/`Lands-in:` cure PM-6.2
introduced precisely so deferrals would stop going missing. Slice 4 is that slice.
Did the cure work?

### Where we're coming from (history, as of 2026-08-06)

**The substance fired; the citation did not.** All four evaluators independently
rediscovered the claim-time race — architect §4 (*"must re-resolve availability
inside the same transaction"*), engineer §2 (*"the window reopens for a concurrent
single-claim request"*), QA test **I6**, request-brief open question 3 — and **not
one of the four cited WATCH-S3-A by id.** By contrast, the `DEC-S3-*` rows *were*
cited by id (PO cites DEC-S3-5 and DEC-S3-8; architect cites DEC-S3-9). The
pattern is legible: **DEC rows get looked up because they are binding constraints;
WATCH rows do not, because nobody is obliged to read them.** Naming the file did
not help, because the row still lived in the *previous* slice's decision log —
a file this slice's triage had no reason to open.

That makes PM-6.2's cure, on its first real test, **substantively lucky rather
than mechanically effective** — the same one-for-three diligence record Slice 3's
PM plan §4a diagnosed, reproduced by the fix that was written to end it.

### Options presented

- **A) Note it and carry WATCH-S3-A forward again** (a fourth carry).
- **B) Fold the substance into 4b's acceptance criteria now**, so it is a binding
  AC rather than carried risk, and fix the *mechanism* so the next carried row is
  surfaced automatically.
- **C) Rewrite PM-6.2's convention with stronger prose.** Rejected — this project's
  own record on prose conventions is *recorded 3×, adopted 0×*.

### Decision

**Chosen: B**, in two parts.

1. **WATCH-S3-A stops being carried.** Its requirement becomes an explicit 4b
   acceptance criterion: *the batch-claim route re-resolves each member's
   availability **inside** the same transaction that performs the writes, never
   trusting a client-supplied or approval-time list, and catches the `UNIQUE`
   collision per member rather than letting one race abort the batch.* This is
   already what architect §4, engineer §2 and QA I6 each specified independently —
   it is now one requirement with one id instead of four rediscoveries.
2. **The mechanism fix is mechanical, not exhortative.** `team-intake`'s
   request-brief template gains a **"Carried rows firing on this slice"** section,
   populated by grepping prior slices' `decisions.md` for `Fires-on:` lines naming
   this slice — one grep, run at triage, output pasted. A row that fires is then
   *in the document the next slice actually reads*, rather than in the document it
   does not.

**Rationale / implications:** the cure that failed here failed for a locatable,
fixable reason — the row was in the right *format* and the wrong *file*. Fixing
the file is a one-grep change; fixing "please remember to read the previous
slice's decision log" is not fixable at all. Nothing in this ruling re-opens any
Slice-3 decision; it changes only where a Slice-3 row is surfaced.

---

## DEC-S4-7 — Re-parenting an existing item needs a server change; the cycle guard ships with it

*(Folded in from `decisions-tech-lead-addendum.md`, `intake-tech-lead`, Wave 3, 2026-08-06.)*

- **Item / area:** `server/lib/plan-lifecycle.js` `updateProjectPlanItem`;
  `server/db.js` prepared statements; `client/src/lib/api.ts` `updateItem`
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 by `intake-tech-lead` (found while specifying AC-9) ·
  **Decided:** 2026-08-06 · **Decided by:** auto-pilot (`intake-tech-lead`)
- **Recurring-issue link:** §9.8 OVERLOADED-ABSENCE (a cycle makes items vanish
  from every `buildItemTree` consumer with no error); §9.6 (prefer
  inapplicability over compliance)

### The question

`DEC-S4-3` scopes 4a's editing to "`text` + hierarchy placement
(`parent_item_id`)". Every upstream document treats the server side of item
CRUD as complete — the request-brief's Live verification #1 ("item CRUD is real
and complete server-side"), the engineer's §1 ("no changes needed for item
CRUD"), and `DEC-S4-3` itself, which places *all* server-side hardening out of
scope under `WATCH-S4-D`. Is placement editing actually reachable today, and
if not, how much server work does it pull in?

### Where we're coming from (verified live, 2026-08-06)

1. **`updateProjectPlanItem` (`server/lib/plan-lifecycle.js:156`) does not read
   `parent_item_id` at all.** Its patch destructure is
   `const { text, acceptance, detail, checked, position } = patch;`.
2. **Its prepared statement (`server/db.js:3349`) has no `parent_item_id` in
   its `SET` list.** The column exists on the table and is nullable; the
   *update path* simply never touches it. Re-parenting is therefore
   unsupported server-side — the premise above is true for `insert` (which
   does accept `parent_item_id`) and false for `update`.
3. **`client/src/lib/api.ts`'s `updateItem` already advertises
   `parent_item_id: number | null`** in its `Partial<...>` type (~line 2923).
   A caller can send it today, get a 200, and observe nothing change. This is
   a type-level promise the server silently drops — the client contract is
   already lying, before any of this slice's UI exists.
4. **`COALESCE` cannot express the operation.** The statement's idiom is
   `text = COALESCE(?, text)`, in which `NULL` means "leave unchanged."
   Promoting a sub-item to top-level *is* setting `parent_item_id = NULL`.
   Widening the existing statement would yield a control that can demote an
   item but never promote one.
5. **Cycles are reachable through re-parenting and only through it.**
   `insertProjectPlanItem` cannot create one (a new item has no children), so
   `WATCH-S4-D`'s "make it unreachable from the UI" disposition is sound for
   the insert path. Re-parenting is different: setting item A's parent to one
   of A's own descendants is same-plan, passes the existing existence check,
   and is directly offerable by a picker sourced from
   `buildItemTree(plan.items)` — the exact mitigation `DEC-S4-3` relies on.
6. **A cycle is not a cosmetic defect.** `buildItemTree`
   (`PlanLedgerPanel.tsx:266-276`) pushes a node to `roots` only when its
   parent does not resolve. Every member of a cycle resolves to another member,
   so **none of them reach `roots`** — the items disappear from the item tree,
   from the claim picker, and from the snapshot, silently and with no error.

### Options presented

- **A)** Declare AC-9's placement half unbuildable in 4a. Rejected: guts the
  half of AC-9 `DEC-S4-3` deliberately kept, and leaves `api.ts`'s type lying.
- **B)** Widen `updateProjectPlanItem`'s existing statement with
  `parent_item_id = COALESCE(?, parent_item_id)`. Rejected on finding 4 —
  demote-only is a silent half-capability, which is itself the §9.8 shape.
- **C)** One new narrow statement + explicit-key intent detection + full
  validation on the re-parent path. Chosen.
- **D)** C, but with the cycle check in the UI only. Rejected on findings 5-6.

### Decision

**Chosen: C.** In scope for **4a**:

- One new prepared statement `reparentProjectPlanItem` in `server/db.js`.
  No schema change, no migration.
- `updateProjectPlanItem` detects intent with
  `Object.hasOwn(patch, "parent_item_id")` — never a truthiness or `!= null`
  check, because `null` is the meaningful "promote to top-level" value and an
  absent key must keep every existing caller byte-identical.
- Validation on that path, each returning `INVALID_INPUT`: not self-parent;
  parent exists; parent is in the **same plan**; **no cycle** (ancestor walk
  upward from the proposed parent, bounded by the plan's item count).
- Both writes happen inside one `dbModule.db.transaction(...)`.
- The UI parent picker independently excludes the item itself, all of its
  descendants, and every other plan's items.
- `api.ts`'s `updateItem` doc gains an explicit note that `null` promotes to
  top-level and an absent key means "no placement change."

**Boundary:** `WATCH-S4-D` is unchanged and still open. `insertProjectPlanItem`'s
shallow `parent_item_id` validation is not hardened by this ruling.

---

## DEC-S4-8 — G-B is widened, not renamed; the exception list keys on identity, not count

*(Folded in from `decisions-qa-addendum.md`, `qa-strategist`, team-qa, 2026-08-06.)*

- **Item / area:** `server/__tests__/single-writer-guard.test.js` (G-A, G-B)
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 by `qa-risk-analyst` §4 trap 1 and `qa-unit-architect`
  §3 · **Decided:** 2026-08-06 · **Decided by:** auto-pilot (`qa-strategist`)
- **Recurring-issue link:** §9.3 VACUOUS-GUARD → NAME-OVERCLAIMING GUARD;
  §9.7 HAND-SCOPED STRUCTURAL SCAN, occurrence 7's lesson

### The question

`technical-plan.md` originally scoped G-B to two regexes
(`insertProjectPlanItem`, `reparentProjectPlanItem`), omitting
`updateProjectPlanItem` and `deleteProjectPlanItem`, which are also writers of
`project_plan_items`. Widen the guard to match its name, or narrow the name to
match the guard? Separately, G-B's stated "exactly one lexical call site"
premise for `insertProjectPlanItem` is false on `master` (2 sites: the
canonical one and the legacy `doImport` import path).

### Decision

**Chosen: C** — widen G-B to all four writers, and derive the writer set from
`server/db.js`'s own `stmts` registry via a shared
`assertTableWritersSingleHome(tableName)` helper rather than hand-typing
regexes. `KNOWN_MULTI_CALL_SITES`-style dispositions (named, dated, reasoned,
"never widen silently") cover the one legitimate multi-call-site writer
(`insertProjectPlanItem` in legacy `doImport`). Identity (enclosing function
name), not arity (call count), is what each writer's call sites are checked
against — a count-only assertion is explicitly rejected, since deleting the
legitimate call site and adding a rogue one elsewhere would leave a
count-based guard green.

**This build's own §9.7 durable-cure obligation is to build this derived
helper (`server/__tests__/helpers/table-writers.js`) — see build-task-list.md
Task 8 — rather than substitute the hand-scoped point guards technical-plan.md
originally sketched**, unless the derived helper cannot be built without
weakening one of its five checks.

**Boundary:** this ruling covers `project_plan_items` and `value_claims` only.

---

## DEC-S4-9 — `WATCH-S4-F`'s premise is corrected; the deletion defect stays out of 4a

*(Folded in from `decisions-qa-addendum.md`, `qa-strategist`, team-qa, 2026-08-06.)*

- **Item / area:** `WATCH-S4-F`; `server/lib/plan-lifecycle.js`
  `deleteProjectPlanItem`; `server/routes/project-plans.js`
  `DELETE /items/:itemId`
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 by `qa-risk-analyst` §4 trap 3 · **Decided:**
  2026-08-06 · **Decided by:** auto-pilot (`qa-strategist`)
- **Recurring-issue link:** §9.3 VACUOUS-GUARD (NAME-OVERCLAIMING sub-shape)

### Where we're coming from (verified live, 2026-08-06 — read *and* executed)

Neither orphan nor cascade happens on delete: `project_plan_items` and
`value_claims`' foreign keys declare no `ON DELETE` clause, and
`foreign_keys = ON` is global. `deleteProjectPlanItem` is a bare
`DELETE … WHERE id = ?` with no try/catch. Deleting an item with children, or
with a claim, throws `SQLITE_CONSTRAINT_FOREIGNKEY`, unstructured, surfacing as
a raw 500 at the route (no Express error middleware exists anywhere in
`server/`) — violating this codebase's own stated "never a raw 500" rule. The
only test naming this path (`A2.10`) is a `typeof` check; nothing covers the
FK path.

### Decision

**Chosen:** `WATCH-S4-F`'s text is corrected to state the verified behavior
(delete on item-with-children or item-with-claims throws an uncaught FK
constraint error today; the open product question is three-way — cascade,
refuse-with-structured-error, or reparent-children — and the raw 500 is a
defect in its own right regardless of which is chosen). The fix stays out of
4a's build scope; `Fires-on:`/`Lands-in:` are unchanged. One characterization
test (`PZ` in `plan-lifecycle.test.js`) pins today's actual behavior, labelled
explicitly as a characterization pin, not an endorsement.

---

## DEC-S4-10 — D4 keeps its binding fixture; the cycle guard is proven at depth ≥ 4

*(Folded in from `decisions-qa-addendum.md`, `qa-strategist`, team-qa, 2026-08-06.)*

- **Item / area:** `project-plans-api.test.js` (D4/D4b);
  `plan-lifecycle.test.js` (P5, composer atomicity case)
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-06 by `qa-unit-architect` §1 and `qa-risk-analyst` §4
  trap 2 · **Decided:** 2026-08-06 · **Decided by:** auto-pilot (`qa-strategist`)
- **Recurring-issue link:** §9.3 (AGENT-SELF-REPORTED-RED); §9.8
  OVERLOADED-ABSENCE

### Decision

**Chosen: A2 and B1.**

- D4's rewrite uses the invalid-`value_source`-after-valid-`new_item` fixture,
  red-proven against unmodified `master` by someone other than its author,
  reported as actual command output.
- The composer-level forced-throw case (`PX`) is kept **as well**, in
  `plan-lifecycle.test.js`, with the stub restored in a `finally`. D4 carries
  the *ordering* half of the atomicity proof; PX carries the *transaction*
  half. Both, not either.
- D4b (reusing D2's duplicate shape) may stay for Definition-of-Done
  traceability but is commented as documentation, not evidence — it red-proves
  nothing D2 does not already prove.
- P5 requires a fixture of **depth ≥ 4** (the upward walk must traverse ≥ 3
  hops before finding `itemId`), plus a bounded-walk companion case (P5b)
  against a pre-existing corrupt self-referencing row. No WATCH row is opened
  for depth-2 — the deeper proof is four lines, not expensive.

---

## WATCH rows

### WATCH-S4-A — 4a / Slice-3 merge-order collision in `PlanLedgerPanel.tsx`
Both branches edit `PlanLedgerPanel.tsx` (Slice 3: +363 lines), its spec, the four
locale files, and the screens snapshot baseline. Second-to-merge rebases; after any
such rebase, `npm run test:client` runs in full and the snapshot diff is **reviewed**,
never blind-regenerated (§9.4 — the fix round is a build round).
**Fires-on:** whichever of Slice 3 / 4a merges second.
**Lands-in:** `client/src/components/PlanLedgerPanel.tsx`,
`client/src/components/__tests__/PlanLedgerPanel.test.tsx`,
`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`,
`client/src/pages/__tests__/screens.snapshot.test.tsx`.

### WATCH-S4-B — `acceptance` / `detail` / `target_date` inline editing deferred (DEC-S4-3)
Server CRUD already supports all three; only the UI is withheld.
**Fires-on:** Sara asking to edit any of the three from the panel, or a plan-item
workflow that needs `target_date` visible in the ledger.
**Lands-in:** `client/src/components/PlanLedgerPanel.tsx` +
`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` + `PlanLedgerPanel.test.tsx`.

### WATCH-S4-C — 4b's fork point (A1 vs A2) is deferred, not decided (DEC-S4-1, constraint 2)
**Fires-on:** the start of 4b's build. Re-confirm against Slice 3's *actual* merge
state at that moment — do not carry today's assumption.
**Lands-in:** 4b's effort-branch creation + this log (a `DEC-S4-7` row).
**Escalate if:** Slice 3 is still unmerged 3 days from 2026-08-06 — at that point the
blocker is not technical and needs Sara, not another deferral.

### WATCH-S4-D — `insertProjectPlanItem`'s shallow `parent_item_id` validation
It verifies the parent exists, not that it belongs to the same plan and not that it
creates no cycle. 4a makes cross-plan parenting unreachable from the UI (DEC-S4-3)
rather than fixing the server guard. Not a defect 4a introduces; a gap 4a is the
first caller to make reachable-in-principle.
**Fires-on:** any second caller of `insertProjectPlanItem` that can supply a
parent from outside one plan's own item list (MCP tool, `ccam`, an import path).
**Lands-in:** `server/lib/plan-lifecycle.js` `insertProjectPlanItem` +
`server/__tests__/plan-lifecycle.test.js`.

### WATCH-S4-E — `CONSUMERS` growth-rule tension is inherited, not re-decided
`value-ledger.js`'s `CONSUMERS` docstring states a growth rule Slice 3's own
registration already falsified; the generalized cure (`assertConsumerScopeDerived`)
is **escalated to Sara and still open** in Slice 3's log. If 4b touches `CONSUMERS`
at all it is (at minimum) the 5th hand-registration. It must **not** be silently
re-litigated inside 4b's build.
**Fires-on:** 4b importing from `value-groups.js`.
**Lands-in:** cross-reference to Slice 3's open escalation — no new decision here.

### WATCH-S4-F — Item deletion from the panel is declined in 4a
*(Folded in from `decisions-tech-lead-addendum.md`; wording corrected by
`DEC-S4-9`.)* `deleteProjectPlanItem`, `DELETE /items/:itemId` and
`api.projectPlans.deleteItem` all exist and are tested — a delete control is a
small UI addition away. Deliberately **not** built in 4a: no requester
deletion signal, `DEC-S4-3` already narrowed this phase to the smallest usable
editing surface, and deletion carries a genuine unanswered rule this slice has
no basis to invent. **Verified behavior (DEC-S4-9):** deleting an item that has
child items **or** value claims throws an uncaught
`SQLITE_CONSTRAINT_FOREIGNKEY` today and surfaces as a raw 500; there is no
orphan behavior and no cascade to choose between. The open product question is
three-way — cascade, refuse-with-a-structured-error, or reparent-children —
and whichever is chosen, the raw 500 is a defect in its own right.
**Fires-on:** Sara asking to remove a plan item from the panel, or any UI work
that surfaces a delete affordance for `project_plan_items`.
**Lands-in:** `client/src/components/PlanLedgerPanel.tsx` +
`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` +
`client/src/components/__tests__/PlanLedgerPanel.test.tsx`, and — for the
cascade/claims rule — `server/lib/plan-lifecycle.js` `deleteProjectPlanItem` +
`server/__tests__/plan-lifecycle.test.js`.

### WATCH-S4-G — Sibling ordering is insertion-order and not user-controllable
*(Folded in from `decisions-tech-lead-addendum.md`.)* `insertProjectPlanItem`
writes `position` as `Number.isInteger(position) ? position : 0`, and 4a's
add-item form sends no `position`, so every item in a plan gets `position = 0`
and sibling order falls back to whatever the read query's tiebreak is.
`reparentProjectPlanItem` does not set `position` either. `DEC-S4-3` rejected
`position` from 4a's edit scope explicitly and that ruling stands — this row
does not reopen it. What is new is that 4a is the first phase to make the
ordering *visible and mutable*.
**Fires-on:** Sara asking to reorder plan items or sub-items, or any report
that newly added items appear in an unexpected order.
**Lands-in:** `server/lib/plan-lifecycle.js` (`position` on insert/re-parent) +
`client/src/components/PlanLedgerPanel.tsx` +
`client/src/components/__tests__/PlanLedgerPanel.test.tsx`.

### WATCH-S4-H — 11 name-overclaiming `A2.x` cases in `plan-lifecycle.test.js`
*(Folded in from `decisions-qa-addendum.md`.)* 11 of the 19 cases in
`server/__tests__/plan-lifecycle.test.js` have a name stating a specific
behavioral property and a body that is
`assert.ok(typeof planLifecycle.X === "function")`. None of these behaviors is
*unprotected* — each is genuinely asserted one layer up in
`project-plans-api.test.js` — but the ticks are duplicated into the wrong
file, where they read as a thorough behavioral spec for `plan-lifecycle.js`
and are not one. Declined for 4a (pre-existing test debt 4a neither introduces
nor depends on); tracked because 4a writes eight new cases into this exact
file. Disposition: each of the 11 is either made real, or deleted with the
covering case in `project-plans-api.test.js` cited by id in a comment. Never
"adjusted until green."
**Fires-on:** the next change that adds behavioral coverage to
`server/lib/plan-lifecycle.js`, or any review that cites a green `A2.x` tick
as evidence for a behavior.
**Lands-in:** `server/__tests__/plan-lifecycle.test.js`.
**Escalate if:** an `A2.x` tick is ever cited in a Definition of Done or a
decision rationale.

### WATCH-S4-I — legacy plan importer re-parents outside `reparentProjectPlanItem`
`server/lib/plan-lifecycle.js`'s `importLegacyPlan` (`doImport`) writes an
inline `UPDATE project_plan_items SET parent_item_id = ? WHERE id = ?` at
~line 288-290 to fix up parent links after an AGENT-PLAN.md import — a fifth,
un-named writer of `project_plan_items` doing exactly what 4a's new
`reparentProjectPlanItem` does, found by the QA lead while designing the
derived `assertTableWritersSingleHome` helper (`DEC-S4-8`). The helper's
inline-write axis currently absorbs this under `doImport`'s existing
file-level disposition rather than flagging it as a distinct writer (see
`WATCH-S4-J` below for that granularity gap). Declined for 4a: routing the
importer through the real composer is a real behavior change to
import-time re-parenting (no validation/cycle-guard today; the composer
would add both), out of scope for a UI-only phase.
**Disposition:** route `importLegacyPlan`'s inline `UPDATE` through
`reparentProjectPlanItem` so there is exactly one writer.
**Fires-on:** any change to `importLegacyPlan`'s re-parent step, or a
cycle/corruption bug traced to an imported plan.
**Lands-in:** `server/lib/plan-lifecycle.js` (`doImport`).
**Escalate if:** a rogue-writer bug ships through this exact path before
it's routed through the composer.

### WATCH-S4-J — `assertTableWritersSingleHome`'s inline-write check is file-level, not per-anchor
The derived helper's check 5 (inline SQL writes) keys
`inlineWriterDispositions` by file only (`key.split(":")[0]`), not by
`{file, anchor}` as `test-plan.md` §3.3 specifies. Verified live: a second,
different inline writer added inside `plan-lifecycle.js` (a file already
carrying one disposition, for `doImport`/`WATCH-S4-I`) does not go red —
file-level coverage silently absorbs it. This is the one weakening the
test-plan explicitly disallows ("never delete or narrow the assertion"),
disclosed by the implementer, not hidden, but not fixed in this pass.
**Disposition:** sharpen `inlineWriterDispositions` keys to `{file}:{anchor
or line-range}` so a second inline writer in an already-dispositioned file
is still caught.
**Fires-on:** the next inline `.prepare(...)`/`.run(...)` write added to any
file that already has one disposition.
**Lands-in:** `server/__tests__/helpers/table-writers.js`.
**Escalate if:** a real rogue writer ships hidden behind an existing
file-level disposition.

### OPEN-S2-1 (carried, still open)
Which real project validates the end-to-end flow. Non-blocking; recorded so it does
not silently close. This slice is where "end to end" finally means *ungrouped pool →
proposed groups → approved group → claimed milestone*, so it is the natural place to
answer it.

---

## PENDING — cheap-to-reverse vetoes for Sara (none blocking; build proceeds)

1. **DEC-S4-1's split.** 4a starts now against `master`; the group-claim half waits
   on Slice 3. Veto if you would rather the whole slice wait and ship as one piece.
2. **DEC-S4-2's fold-in.** Adds a real (small) bug fix plus a rewritten test to 4a's
   scope. Veto if you would rather 4a stay pure-UI and take the atomicity fix in 4b —
   accepting that the orphan-item defect stays live until Slice 3 unblocks.
3. **DEC-S4-3's field scope.** `text` + placement only. Say the word if you want
   `acceptance` / `detail` / `target_date` editable in this pass.
4. **AC-11 / AC-12 mixed-availability behavior (4b, PO §6.3/§6.4).** Assumed: only
   `available` members are claimed; `already_claimed` / `no_longer_in_pool` members
   are skipped-and-reported, not blockers. Zero-claimable is its own named outcome.
   Still open: whether a **new item is still created** for a group that turns out to
   have nothing claimable, or creation is skipped. Either is acceptable; it must be
   deliberate. Cheap to answer at 4b's start.
5. **AC-14's transition ownership (4b).** The batch-claim endpoint is the sole writer
   of `review_status='claimed'`, in the same transaction as the claims — no separate
   "mark group claimed" action. Flag if you pictured a distinct gesture.
6. **The real blocker is administrative, not technical** — Slice 3 is code-complete
   and cannot merge because another live session holds an uncommitted 65-line edit to
   `PROJECT-CONTEXT.md` in this shared checkout. Landing or stashing that edit is the
   single highest-leverage thing you can do for this initiative today.
