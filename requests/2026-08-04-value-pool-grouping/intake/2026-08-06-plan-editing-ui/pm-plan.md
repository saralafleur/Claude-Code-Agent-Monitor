# PM Plan — Value Pool Slice 4: Plan editing UI + batch group claiming

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/`
**Stage:** `intake-project-manager` (Wave 2) · **Run mode:** `auto-pilot`
**Written:** 2026-08-06
**Inputs read:** `request-brief.md`, `run-plan.md`, all four
`supporting/{product-owner,architect,engineer,qa}.md`, the parent
`request.md`, Slice 1 / Slice 2 / Slice 3 `decisions.md` + `pm-plan.md`,
Slice 1's `decisions-qa-addendum.md`, `PROJECT-CONTEXT.md` **at committed
`HEAD` (`d384249`) only** — the working tree carries an unrelated concurrent
session's uncommitted 65-line edit to that file, which this plan neither read
nor relied on — and the global `team-intake` request-log (62 rows).

Everything below marked "confirmed live" was re-verified by direct read today,
not carried from a document. Two of this intake's load-bearing findings were
re-verified by the PM personally before being ruled on.

Decision ids are folder-local: `DEC-S4-*` / `WATCH-S4-*` in
[`decisions.md`](./decisions.md), matching Slice 3's `DEC-S3-*` convention.

---

## 1. Request summary

Sara asked, on 2026-08-04, for the plan ledger to become **editable** and for
approved value groups to become **actionable**. Slice 4 is the last of the four
slices that request was broken into, and it is where the whole initiative's
payoff stops being a proposal and becomes a recorded outcome. Concretely it is
three pieces that look like one ask: (a) add/edit affordances for plan items and
sub-items inside `PlanLedgerPanel`, which today renders items strictly read-only
— there is not a single edit control on an open plan; (b) a claim-target picker
that *shows* the parent/child hierarchy instead of a flat list (the sub-items are
already in the option data — this is a rendering gap, confirmed live); and (c) a
genuinely net-new server capability: batch-claim every claimable member of an
approved Slice-3 group into an existing item/sub-item, or into a newly created
one, in a single transaction, and move that group's `review_status` to the
`claimed` value Slice 3 reserved for exactly this moment.

Two things about this slice are not like the previous three. It is the only slice
that depends on code which is **not on `master`** — Slice 3 is built and
unmerged, blocked on an administrative conflict. And its own approved requirement
text contains a **factually false premise about our codebase**, which this intake
found and which changes what "reuse the existing atomic path" means.

## 2. Request type

### Final call: **`new-feature`** — triage's provisional call is **UPHELD** — with one **`bug` carve-out**

**Why `new-feature`.** The capability does not exist in any form.
`PlanLedgerPanel.tsx` on `master` has **zero** add/edit-item affordances
(confirmed live — `PlanSection` renders a title and a Close button;
`ItemTree`/`ItemNodeRow` render text and claim labels with no `onClick` in the
render path). No batch-claim route exists (`POST /:id(\d+)/claims` is the only
claim route on `master`, confirmed live). `value_groups` does not exist on
`master` at all.

**Why not `regression`.** Nothing here worked and then broke. The item-CRUD UI
has never existed; the group-claim action was deliberately fenced *out* of Slice
3 rather than lost from it — Slice 3's own approve-handler comment says so
verbatim: *"AC-5: pure bookkeeping — review_status + reviewed_at only, never a
plan item, milestone, or claim (PO §7/§8 fence)."* Slice 4 is the slice that is
supposed to cross that fence.

**Why not `missed-requirement`, which matters because two efforts either side of
this one were.** `value-summary-tick` and Slice 1 were both ruled
missed-requirement, so the standing prior on this surface is "we under-specified
it the first time." The test this project has settled on is *was the requirement
incomplete from the start, or complete and deliberately staged?* Slice 4's
requirement has been written down in Sara's own words in `request.md` since
2026-08-04, as slice 4 of an explicitly sequenced four-slice plan whose own
constraint reads *"slices ship independently, in order."* Slice 3's PO document
then reserved every one of Slice 4's items **by name** (*"its editing/browsing UI
is explicitly Slice 4's deliverable, not Slice 3's"*), and Slice 3's `DEC-S3-8`
reserved the `claimed` enum value in the CHECK constraint specifically so Slice 4
would need no migration. Three artifacts staging a capability on purpose is the
plan executing, not a requirement having been wrong. Triage recorded **zero
blocking questions** and verified all eight of the brief's premises live.

**Why not `text/content-change`.** No approved copy changed. The one fixed
vocabulary in play (`available` / `already_claimed` / `no_longer_in_pool`) is
being *inherited* from Slice 3's `DEC-S3-5`, not rewritten.

### Carve-out — the single-claim `new_item` non-atomicity is a **`bug`**: our cost, not new-ask scope

This is the one part of Slice 4's scope that is not a new capability. Since
**2026-08-02**, `POST /:id(\d+)/claims` has inserted a `new_item` row, *then*
validated `value_source` / `attribution` / `value_ref`, *then* inserted the
claim, with **no `db.transaction(...)` anywhere in the handler** — so a valid
`new_item` plus an invalid `value_source` returns a 400 and leaves a committed,
orphaned plan item behind. The engineer and QA each found this independently;
**I re-read the route and the test myself before ruling**, and both are exactly as
reported.

It is a `bug` and not a `missed-requirement` under this project's own test: the
requirement was never incomplete. It is stated, in the codebase, in the name of
the test written to guard it — `D4: new_item inline form is atomic — failure
leaves neither claim nor item created`. The requirement was clear and the code
did not meet it. That is the textbook definition, and it is billed the way this
project bills its own defects: **our cost.** Ruled into scope, in build phase
**4a**, by **DEC-S4-2**.

### Catalog touch counts

**No occurrence counts are incremented for §9.1, §9.7 or §9.8 by this intake.**
Nothing has been built; per Slice 3's PM rule (and §9.8's own), design-time
pre-flags are not occurrences. **§9.3 is the one exception** — D4 is a *found live
instance in shipped code*, previously unlogged, plus a new sub-shape worth naming
(**NAME-OVERCLAIMING GUARD**, see §4b). Per **DEC-S4-4** that finding ships as a
ready-to-paste patch file rather than an edit to a file another session currently
holds open.

## 3. History / background — where this is coming from

### 3a. Timeline of this exact surface

| Date | Effort | Type | Outcome |
|---|---|---|---|
| 2026-08-02 | `plan-lifecycle-value-ledger` | new-feature | The Value Pool itself: `assembleValuePool`, `value_claims`, `POST /:id/claims`, `CONSUMERS`/DEC-16. **Also where the non-atomic `new_item` path and its false-green `D4` guard shipped.** |
| 2026-08-04 | `value-summary-tick` | **missed-requirement** | Per-unit PROJECT/STAKEHOLDER synthesis, `ALTITUDE_STATES`. Merged `55fe900`. **8 §9.3-family events.** Promoted §9.8 to a numbered entry. |
| 2026-08-04 | Parent request approved (Sara, verbal) | — | Four sequenced slices, one session. Slice 4 written down that day, unchanged since. |
| 2026-08-04 → 05 | **Slice 1** `altitude-invalidation` | **missed-requirement** + new-feature carve-out | Mutability-aware caching/invalidation. Merged `b38b4a1`. **9 §9.3-family events — a record**, set by the build that had been briefed about the previous record. |
| 2026-08-05 | **Slice 2** `coverage-on-demand` | **new-feature** + scheduled-debt carve-out | Priority drain, `value-coverage.js`, `coverageSnapshot.complete`. Merged `4c2e931`. **QA deferred at intake by DEC-F2 (fast mode).** |
| 2026-08-05/06 | Slice 2 **QA-fix round** | our cost | Post-merge `team-qa` returned **BLIND** with 3 live defects; the fix build needed 4 internal loop-backs. Merged `5ec640b`. |
| 2026-08-06 | `c233a36` | — | DEC-10/AC-6 closed: real 40-unit calibration; **Sara's call: sonnet for both stages.** |
| 2026-08-06 | **Slice 3** `auto-group-proposal` | **new-feature** + 2 scheduled-debt carve-outs | Grouping engine, 3 tables, 14 `DEC-S3-*` rulings. **Built (`44720c3`, `72feac9`) — and NOT merged** (confirmed live: `git branch --merged master` does not list its branch). |
| **2026-08-06** | **Slice 4** (this) | **new-feature** + `bug` carve-out | Full roster, direct evaluator set, `auto-pilot` dispositions. |

### 3b. Have we seen this before? — three different answers

- **The ask: NEW. 0×.** Zero matches for plan-item editing, batch claim, or
  group-claim anywhere in the global request-log's 62 rows or in `requests/`.
  This capability has never been requested before. What it *has* been is
  **reserved by name, twice** — Slice 3's PO fence and `DEC-S3-8`'s reserved CHECK
  value. That is the opposite of a recurrence: it is deliberate staging working.
- **The surface: the most-touched in this project's history, and it got worse.**
  Slice 4 is the **6th consecutive effort in 5 days** on the
  `value-ledger` / `value-summary` / `value-coverage` / `PlanLedgerPanel` family,
  and the 4th intake against this one parent request. That family carries **8, 9
  and 4** §9.3-family events across three prior builds.
- **The failure modes: seen 22+ times, and every evaluator got the citations
  right.** §9.1 DERIVED-DUAL-VIEW (7 occurrences — and this slice makes
  `buildItemTree` gain consumers #2 and #3, which the catalog's own design-time
  pre-flag names as the exact moment this class fails), §9.3 (the 8/9/4 runs, plus
  the new live instance below), §9.7 (7), §9.8 (its live instance #1 *is* this
  surface), WATCH-6. All four supporting documents cite the catalog by entry
  number and get it substantially right.

### 3c. Prior decisions this request touches — cited, not re-litigated

Consumed as **closed inputs**: `DEC-3`, `DEC-16`, `WATCH-6`, `DEC-S3-5`,
`DEC-S3-8`, `DEC-S3-9`, `DEC-S3-10`, `DEC-10`/`DEC-11`. The PO and architect
correctly cited `DEC-S3-5`, `DEC-S3-8` and `DEC-S3-9` by id — a real improvement
over Slice 3's intake, where a settled decision was re-derived from scratch.

**One contradiction found, and it is a repeat of the one Slice 3 found.** This
slice's request-brief (lines 35–37) quotes the parent doc's carry-forward
verbatim: *"OPEN-4 (env tune `MAX_PROJECTS_PER_TICK`) is still undecided by
Sara."* **That is false, and it was already ruled false one day ago.** `DEC-3`
(Slice 2, 2026-08-05) closed OPEN-4: the default of 3 is a spec, not a pending
question, and there is to be no second tuning mechanism. Slice 3's PM plan §3c
caught this exact error on 2026-08-05 and ruled *"cite DEC-3, do not re-argue
it."*

The brief is not careless — it is quoting `request.md` accurately. **The problem
is that `request.md` still says it.** Slice 3's correction was written into a
`pm-plan.md`; nobody edited the source. So the next slice's triage read the source
and quoted the stale text, in good faith, one day later. Ruling: **DEC-3 is
closed and stays closed**, and the correction goes into the source this time
(**DEC-S4-5**).

### 3d. Internal-consistency audit of this run's own `decisions.md`

Required under `auto-pilot`, where PREFERENCE gates are decided by the team rather
than asked. This slice's `decisions.md` did not exist before this plan; all six
`DECIDED-AUTO` rows in it are mine, written today. Audited against every
Sara-`DECIDED` item reachable from this initiative's logs:

| Sara-decided item | Where | Does any `DECIDED-AUTO` row here reintroduce something she declined? |
|---|---|---|
| **Sonnet for both synthesis stages** (DEC-10, 2026-08-06 — haiku declined on real 40-unit evidence) | Slice 2 `decisions.md` | **No.** Slice 4 spawns no model at all. No row re-opens tiering, cost, or model choice in any narrower or disguised form. |
| **Confirm before touching the shared main checkout** (Slice 2, 2026-08-05, 3 live sessions) | Slice 2 `decisions.md` Step 1 | **No — and DEC-S4-4 and DEC-S4-5 actively comply with it**, routing both catalog and `request.md` edits onto the effort branch instead of this checkout. DEC-S4-1's constraint 3 restates the `ps`/`lsof`-then-confirm posture for any merge. |
| **Four slices, shipping independently, in order** (verbal, 2026-08-04) | `request.md` | **No, and this was the live risk.** All four evaluators recommended splitting Slice 4; the PO explicitly warned that renumbering the initiative is not an evaluator's call. **DEC-S4-1 splits *build phases*, not *slices*** — one folder, one intake, one QA pass, one decision log, four slices still four. The auto-decision was deliberately shaped to avoid quietly re-shaping a framing Sara approved. |
| **Sara's PENDING veto rows from Slices 1–3** (e.g. DEC-S3-5, DEC-S3-6, DEC-S3-8) | Slices 1–3 `decisions.md` | **None exercised** — these are un-answered offers, not declines. No row here treats an unexercised veto as either taken or refused. |

**Result: no contradiction found.** One near-miss, named above: the split
recommendation arrived unanimously from four evaluators and, taken at face value,
would have converted a Sara-approved four-slice plan into five without asking. It
was landed as a phase split instead. **A second observation worth recording:** the
one thing four independent evaluators agreed on is exactly the thing that touched
Sara's own approved framing — unanimity among agents is not evidence that a
requester-owned decision has become a team-owned one.

## 4. Recurrence diagnosis

This is a repeat — not of the feature, which is genuinely new, but of a
**mechanism**, and this intake surfaced the sharpest evidence yet for what it is.

### 4a. The systemic cause: **`request.md` is read by everyone and written by no one**

Every slice's triage quotes the parent request document as the source of truth.
Correctly — it is the requirement. But nothing in this pipeline ever writes back
to it. Corrections land in downstream `pm-plan.md` / `decisions.md` files that the
*next* slice's triage has no reason to open. The result, twice in this one
101-line approved document:

| Premise in `request.md` | Falsified | By whom | Did the correction reach the source? | What it cost |
|---|---|---|---|---|
| *"OPEN-4… is still undecided by Sara"* | 2026-08-05 by `DEC-3` | Slice 3's PM, §3c | **No** — written into a pm-plan | Slice 4's brief re-quoted it verbatim one day later, as a live constraint binding all four slices |
| *"the claims API's atomic inline `new_item` already supports the shape"* | 2026-08-06 (this intake) | engineer §2, QA §2, PM re-verified | **Not yet** | Three days of every document on this surface repeating it; this slice's acceptance signal 4 and AC-12 are *built on it* |

The second one is the expensive shape. A false premise in a requirements document
does not stay a documentation problem — it becomes a **design instruction**.
"Reuse the existing atomic `new_item` shape" is a perfectly good instruction if
the shape is atomic and a defect-propagation instruction if it is not. This is
§9.1's second-hand-copy mechanism operating one level up: not a copied
*implementation*, a copied *guarantee*.

### 4b. The reinforcing cause: a guard whose **name** is a superset of what it asserts

D4 has been green since 2026-08-02 and reads
`new_item inline form is atomic — failure leaves neither claim nor item created`.
Its assertions are real and its failure case is real. Its failure case is
`new_item: { text: "" }` — which fails inside `insertProjectPlanItem`'s own
validation *before any row is written*, i.e. **the one failure mode that cannot
produce the orphan its name denies.** It never exercises the case the route's own
code makes possible.

This is a §9.3 VACUOUS-GUARD instance and it is **none of §9.3's six catalogued
shapes**: not empty, not a tautology, not an existence check, not an escape hatch,
not an uncalled helper, not an impossible fixture. Proposed name, for the catalog:
**NAME-OVERCLAIMING GUARD** — *the assertions are honest, the test name is a
superset of them, and the name is what the next reader believes.* It is harder to
catch than the other six precisely because nothing about it looks vacuous.

And it did the damage §9.3 predicts, to this intake, today: this slice's own QA
document cites D4 as *"the direct precedent for this slice's atomicity
requirement."* The checkmark was read and the looking stopped.

### 4c. The third cause: WATCH rows live where the next slice does not look

Slice 3's PM-6.2 introduced a cure for the deferral problem — every carried row
states `Fires-on:` and `Lands-in:`. **Slice 4 is that cure's first real test, and
it did not fire as a mechanism.** `WATCH-S3-A` reads, verbatim: *"claim-time
member re-validation… **Fires-on:** Slice 4's batch-claim build. **Lands-in:**
Slice 4's claim route + its transaction test."* You cannot write a more precise
trigger than that.

All four evaluators independently rediscovered its substance (architect §4,
engineer §2, QA I6, brief open question 3). **Zero of four cited `WATCH-S3-A` by
id.** Meanwhile the `DEC-S3-*` rows *were* cited by id, by two different
evaluators. The pattern is legible and fixable: **DEC rows get looked up because
they are binding constraints; WATCH rows do not, because nobody is obliged to read
them** — and this one still lived in the *previous* slice's decision log, a file
this slice's triage had no reason to open. Naming the file was necessary and not
sufficient. The row was in the right format and the wrong document.

### 4d. What is NOT recurring

Slice 2's PM-5 planning note — *"do not intake slice N+1 until slice N's build has
landed"* — **held for Slice 3 and does not hold today.** Slice 3 is code-complete
and unmerged, the tree carries two uncommitted files from a concurrent session, and
Slice 4 was intaken anyway. That is worth saying plainly rather than letting it
pass: the note's predicted cost is precisely the ambiguity this intake had to work
around. It was survivable here only because every evaluator read the unmerged
branch directly (`git show <branch>:<path>`) instead of assuming — which is the
right behavior and should be credited, but it is diligence substituting for a
mechanism again.

## 5. Where this is coming from — root source

Not drift, not a misunderstanding, and — for the main body of the request — not a
defect. The root source of the **ask** is a complete, unchanged, two-day-old
approved requirement arriving on schedule at its turn in a sequence, landing on
the surface this project's own catalog calls its highest-density defect zone. The
design questions it carries (edit-field scope, batch wire shape, transition
ownership) were left open *by design* and are the intended output of exactly the
four evaluator passes this run ran.

Three things make it more than a large feature, and all three are inherited:

1. **A false premise in the approved requirement itself** — `request.md`'s
   "already atomic" claim. Root source: a guard that has been green and wrong
   since 2026-08-02, whose name entered the requirements vocabulary. This is the
   `bug` carve-out.
2. **A hard build-time dependency on unmerged code**, whose blocker is not
   technical at all: Slice 3 is code-complete and cannot merge because another live
   session holds an uncommitted 65-line edit to `PROJECT-CONTEXT.md` in this shared
   working tree. An administrative conflict is currently the critical path for the
   last slice of a four-slice initiative.
3. **An inherited catalog** that predicts, by name and with numbers, exactly how
   this build fails if the guardrails are traded for speed — plus one carried row
   (`WATCH-S3-A`) that was written specifically for this slice and that nobody
   cited.

## 6. Recommendation to the human

**Approve Slice 4 as scoped, split into two build phases, and start 4a today.**
Six dispositions are recorded in [`decisions.md`](./decisions.md); the two that
were routed to me by name are `DEC-S4-1` and `DEC-S4-2`.

### The headline decisions

**`DEC-S4-1` — split into 4a and 4b, as *build phases* within one slice.**
All four evaluators independently recommended a split and I agree with them, with
three constraints they did not specify:
- **It is not a fifth slice.** One folder, one intake, one QA pass, one decision
  log; the parent doc's four-slice shape stays four. The PO was right that
  renumbering a framing you approved verbally is not the team's call, and it is
  not necessary to get the benefit.
- **4a** = item/sub-item CRUD + hierarchy-aware picker + the atomicity fix. Forks
  from `master` **now**. Zero Slice-3 dependency. **4b** = batch group claim +
  the `claimed` transition. Forks from wherever Slice 3 lands.
- **4b's fork point (from Slice 3's branch vs. from a merged `master`) is
  deliberately NOT decided today** — it is a guess about a blocker owned by another
  session. It is deferred with a trigger and an escalation date (`WATCH-S4-C`).
- **The merge-order collision nobody flagged** is handled by `WATCH-S4-A`: 4a and
  Slice 3's branch both edit `PlanLedgerPanel.tsx` (Slice 3: +363 lines), its spec,
  four locale files, and the screens snapshot. Second-to-merge rebases and re-runs
  the client suite with a **reviewed** snapshot diff.

**`DEC-S4-2` — fold the pre-existing atomicity gap into scope, specifically into
4a.** Not 4b, and not a follow-up ticket. Putting it in 4b would chain a live,
shipped, user-reachable data-integrity defect to a branch blocked on another
session's uncommitted file; filing it as a follow-up is the disposition §9.4
explicitly rejects (*"should-fix is a triage label, not a disposition"*), and it
would be recorded in the very artifact §4c shows the next slice doesn't read. It
is also cheaper this way — 4a delivers the transactional core that 4b's shared
composer needs anyway. **D4 is rewritten, not adjusted**, and both the fix and the
new test are mutation-proven once, by someone other than their author.

### Cost framing

- **New ask (your cost, new capability):** the item/sub-item CRUD UI, the
  hierarchy-aware picker, the batch-claim route and composer, the group claim
  action. T-shirt **S** for 4a, **M** for 4b — I agree with the engineer's sizing.
- **Our cost (`bug`, not scope):** the single-claim `new_item` atomicity fix and
  D4's rewrite (`DEC-S4-2`). Small — one transaction wrapper, one reordering, one
  rewritten test — and it is ours because we shipped a green test over it.
- **Our cost (bug prevention, not gold-plating):** everything in QA's Definition of
  Done, including the two new `single-writer-guard.test.js` entries. On a file
  family with an 8/9/4 §9.3-family record and a `value_claims` writer about to go
  from one call site to two, this is the minimum, not the maximum.
- **Not billable to this slice, but on its critical path:** clearing Slice 3's
  merge blocker.

### The durable fix — three things, in order of leverage

1. **Clear the administrative blocker (yours, ~1 minute).** Slice 3 is
   code-complete and cannot merge because a concurrent session holds an
   uncommitted 65-line edit to `PROJECT-CONTEXT.md`. Land it or stash it. Nothing
   else on this initiative's critical path is technical.
2. **Make `request.md` writable — `DEC-S4-5`.** The parent request doc gains a
   dated, **append-only** `## Corrections` section; each slice's intake is obliged
   to append there when it falsifies a parent-doc premise. Sara's own words are
   never rewritten — the correction sits beneath them with its evidence and the
   decision id that governs now. This is the direct cure for §4a, it costs one
   append per falsified premise, and it puts corrections in the one file every
   slice's triage is guaranteed to read. Two entries land immediately: the OPEN-4
   status, and the "already atomic" claim.
3. **Make carried rows surface themselves — `DEC-S4-6`.** `team-intake`'s
   request-brief template gains a **"Carried rows firing on this slice"** section,
   populated by grepping prior slices' `decisions.md` for `Fires-on:` lines that
   name this slice. One grep, run at triage, output pasted. This is deliberately
   mechanical rather than exhortative: this project's record on prose conventions
   is *recorded 3×, adopted 0×*, and §4c shows the previous cure failed for a
   locatable reason — right format, wrong file. Fixing the file is a one-grep
   change; fixing "please remember to read the previous slice's decision log" is
   not fixable at all. `WATCH-S3-A` stops being carried and becomes a binding 4b
   acceptance criterion in the same ruling.

### Three things I want the build to take seriously, beyond the ACs

- **`buildItemTree` gains consumers #2 and #3 in this slice.** §9.1's own
  design-time pre-flag says this class fails *when consumer #2 appears, not at
  introduction*. That is now. Import it; do not re-walk `parent_item_id` in a
  `<select>`'s render.
- **`insertValueClaim` goes from one call site to two.** Per WATCH-6, both route
  through one composer, and `single-writer-guard.test.js` — which today names
  neither `insertValueClaim` nor `insertProjectPlanItem` (confirmed live) — gains
  entries for both, each mutation-proven once.
- **§9.8 is the parent request's own named standing trap for this surface, and 4b
  is where it finally bites.** Every batch-claim member lands in exactly one named
  outcome bucket, never zero and never two; a group with nothing claimable is its
  own named outcome, not a silent empty success.

## 7. Open decisions for the user

None blocking. Build can start on 4a today with everything ruled as recorded.

1. **`DEC-S4-1`'s split.** 4a starts now against `master`; the group-claim half
   waits on Slice 3. Veto if you would rather the whole slice ship as one piece.
2. **`DEC-S4-2`'s fold-in.** Adds a small bug fix plus a rewritten test to 4a.
   Veto if you would rather 4a stay pure-UI — accepting that the orphan-item defect
   stays live until Slice 3 unblocks.
3. **`DEC-S4-3`'s edit-field scope.** 4a ships `text` + hierarchy placement only.
   Say the word if you want `acceptance` / `detail` / `target_date` editable now.
4. **Mixed-availability behavior (4b).** Assumed: only `available` members are
   claimed; the others are skipped-and-reported, not blockers; zero-claimable is a
   named outcome. **Genuinely still open:** whether a new item is still *created*
   for a group that turns out to have nothing claimable, or creation is skipped.
   Either is fine; it must be deliberate. Cheap to answer at 4b's start.
5. **`review_status='claimed'` ownership (4b).** The batch-claim endpoint is the
   sole writer, in the same transaction as the claims — no separate "mark group
   claimed" gesture. Flag if you pictured a distinct action.
6. **`OPEN-S2-1` (carried, still open).** Which real project validates the flow
   end to end. This slice is where "end to end" finally means *ungrouped pool →
   proposed groups → approved group → claimed milestone*, so it is the natural
   place to answer it.
7. **The `assertConsumerScopeDerived` escalation is still yours and still open**
   (Slice 3). Not re-litigated here; `WATCH-S4-E` names 4b as at minimum the 5th
   hand-registration if it stays undecided.

## 8. WATCH rows opened by this plan

Full text in [`decisions.md`](./decisions.md). All carry `Fires-on:` / `Lands-in:`
per PM-6.2, and — per `DEC-S4-6` — any of them that fire on a future slice are to
be transcluded into that slice's brief rather than left here.

- **`WATCH-S4-A`** — 4a / Slice-3 merge-order collision in `PlanLedgerPanel.tsx`.
- **`WATCH-S4-B`** — `acceptance`/`detail`/`target_date` inline editing deferred.
- **`WATCH-S4-C`** — 4b's fork point deferred, with a 3-day escalation trigger.
- **`WATCH-S4-D`** — `insertProjectPlanItem`'s shallow `parent_item_id` validation
  (same-plan / cycle checks), made unreachable-from-UI rather than fixed.
- **`WATCH-S4-E`** — `CONSUMERS` growth-rule tension inherited from Slice 3's open
  escalation; explicitly not re-decided in this slice.

## 9. Memory / catalog updates made by this plan

1. **Request-log** — row appended to
   `~/.claude/skills/team-intake/memory/request-log.md` (the global fallback;
   `PROJECT-CONTEXT.md` at `HEAD` configures no project-specific request-log, and
   its §9 catalog is a defect catalog, not a request log).
2. **Defect catalog — recorded, not applied, per `DEC-S4-4`.** `catalog-patch.md`
   in this folder carries the exact §9.3 text: the D4 live instance (dated
   2026-08-06, discovered in code shipped 2026-08-02) and the new
   **NAME-OVERCLAIMING GUARD** sub-shape. It is applied on 4a's effort branch and
   deleted in the same commit, so there is exactly one catalog. `PROJECT-CONTEXT.md`
   was **not** edited on this checkout — it currently carries another live
   session's uncommitted 65-line edit, and DEC-10 / DEC-11 / Sara's own 2026-08-05
   confirmation posture all govern that case.
3. **No occurrence counts incremented for §9.1 / §9.7 / §9.8.** Nothing has been
   built; those hits are design-time pre-flags. §9.1 stays at 7, §9.7 at 7, §9.8
   unchanged.
4. **Two corrections queued for the parent `request.md`** (`DEC-S4-5`), landing on
   4a's effort branch: the OPEN-4 status (closed by `DEC-3`, not pending) and the
   "already atomic" claim (false since 2026-08-02).
