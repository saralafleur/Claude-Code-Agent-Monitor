# PM Plan — Value Pool Slice 3: Auto-group proposal engine

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/`
**Stage:** `intake-project-manager` (Wave 2) · **Run mode:** direct (NOT fast)
**Written:** 2026-08-06
**Inputs read:** `request-brief.md`, `run-plan.md`, `supporting/architect.md`,
`supporting/engineer.md`, `supporting/product-owner.md`, `supporting/qa.md`,
`PROJECT-CONTEXT.md` §9.1–§9.8 + all four un-catalogued candidates,
Slice 1 `decisions.md`, Slice 2 `decisions.md` + `pm-plan.md` + `qa/`,
the global `team-intake` request-log, and **live repo state on `master`**
(every claim marked "confirmed live" below was re-verified by direct read
today, not carried from a document).

Decision ids in this plan are **folder-local**: `PM-*` for rulings, `WATCH-S3-*`
for carried risks, matching Slice 2's `WATCH-S2-*` convention.

---

## 1. Request summary

Sara asked, in one session on 2026-08-04, for the Value Pool to stop being a
flat list of ~100–200 individually-described units and start presenting itself
as **named, explained groups she can act on as a unit**. Slice 3 builds the
first half of that: a free, deterministic mechanical pre-grouping pass over a
project's pool (initiative-slug references, time-adjacency, shared surfaces),
then one sonnet refinement pass that turns those raw clusters into named
proposals — each with a stakeholder-level summary sentence, member `unitKey`s,
and a rationale — persisted to new tables and rendered for human review. Groups
are **proposals, never actions**: approve and dismiss change a status and
nothing else; no plan item is created, edited, or claimed anywhere in this
slice. The whole feature is gated on the target project's altitude coverage
being 100%, read from Slice 2's server-authored `coverageSnapshot.complete`.
Slice 4 — the claim-target picker and batch claim — is explicitly out of scope
and is fenced off at the UI-affordance level by the product owner.

## 2. Request type

### Final call: **`new-feature`** — triage's provisional call is **UPHELD**, with two **scheduled-debt carve-outs**

The capability does not exist in any form. `grep -c "value_groups"
server/db.js` returns **0** (confirmed live); there is no grouping module, no
grouping route, no grouping spec file, and `SUMMARY_STAGES`' `"grouping"` entry
carries its own JSDoc saying it "has NO consumer yet in this codebase"
(`server/lib/value-summary.js:103–107`, confirmed live). Nothing here worked
before and broke (not a `regression`), nothing shipped incorrectly against its
own stated requirement (not a `bug`), and no approved copy changed (not
`text/content-change`).

**Why this is not `missed-requirement`, which matters because the two slices
either side of it were.** Slice 1 (`altitude-invalidation`) and the preceding
`value-summary-tick` effort were both ruled missed-requirement, so the default
assumption on this surface is now "we under-specified it the first time." That
test does not fire here. The distinguishing question this project has settled
on is *was the requirement incomplete from the start, or complete and
deliberately staged?* Slice 3's requirement has been written down, in Sara's
own words, in `request.md` since 2026-08-04, as slice 3 of an explicitly
sequenced 4-slice plan whose own constraint reads "slices ship independently,
in order." Building slices 1 and 2 first is the plan executing, not the
requirement having been wrong. The unspecified parts (heuristic widths, rollup
mechanics, schema shape) are *design* latitude the request deliberately left to
the technical stages — triage recorded **zero blocking questions** and verified
all seven of the brief's premises live.

### Carve-out 1 — **SF-4 extraction is scheduled debt now due: our cost, not new-ask scope**

The `buildProbeCoverage` extraction (§6, PM-2) is work we owe from Slice 2,
deferred on 2026-08-05 with an explicit trigger naming this slice. It is billed
the same way this project billed Slice 1's request-path generation logging and
Slice 2's WebSocket subscriber: *scheduled debt, now due* — pre-priced, our
cost, and **not** missed-requirement (nothing was incomplete against its stated
requirement; a known duplication was consciously deferred with a dated row).
The trunk-drift WATCH-4 precedent governs.

### Carve-out 2 — **the AC-7 coverage-gate UI is also scheduled debt, pre-priced in Slice 2**

Slice 2's PM-2 / DEC-2 deliberately did **not** ship the disabled Auto-group
button, and bound the deferral to two conditions: `coverageSnapshot` must carry
a server-authored `complete` boolean (it does — `value-coverage.js:134`,
confirmed live), and Slice 2's acceptance signal 4 is inherited verbatim into
Slice 3. The product owner carried it correctly as **AC-7**. That UI is
therefore not new scope arriving in Slice 3; it is Slice 2 scope that was
consciously moved here with a written condition, and it lands now.

### Catalog touch counts: **no entry incremented by this intake**

Nothing has been built. Per §9.8's own rule — *re-encountering a known instance
is not an occurrence* — the §9.8/§9.1/§9.3/§9.7 hits below are **design-time
pre-flags**, not occurrences. §9.1 stays at **7**, §9.7 at **7**, §9.8's count
is unchanged. The catalog edits I made are two dated corrections plus a
disposition note (§9), not increments.

## 3. History / background — where this is coming from

### 3a. Timeline of this exact surface

| Date | Effort | Type | Outcome |
|---|---|---|---|
| 2026-08-02 | `plan-lifecycle-value-ledger` | new-feature | The Value Pool itself: `assembleValuePool`, `value_claims`, `CONSUMERS`/DEC-16. Origin of everything below. |
| 2026-08-04 | `value-summary-tick` | **missed-requirement** | Per-unit PROJECT/STAKEHOLDER synthesis + discriminated `ALTITUDE_STATES`. Merged `55fe900`. **8 §9.3-family events.** Promoted §9.8 to a numbered catalog entry. |
| 2026-08-04 | Parent request approved (Sara, verbal) | — | Four sequenced slices, one session. Slice 3 written down that day and unchanged since. |
| 2026-08-04 → 08-05 | **Slice 1** `altitude-invalidation` | **missed-requirement** + new-feature carve-out | Mutability-aware caching/invalidation. Merged `b38b4a1`. **9 §9.3-family events** — a record, set by the build that was explicitly briefed about the previous record. |
| 2026-08-05 | **Slice 2** `coverage-on-demand` | **new-feature** + scheduled-debt carve-out | `value_summary_sweep_state`, priority drain, `value-coverage.js`, `coverageSnapshot.complete`. Merged `4c2e931`. **QA was DEFERRED at intake by DEC-F2 (fast mode).** |
| 2026-08-05/06 | Slice 2 **QA-fix round** | our cost | Post-merge `team-qa` returned **BLIND** with 3 live defects. The fix build needed 4 internal loop-backs; `build-reviewer` returned 4 blockers against fixes two prior passes had certified green. Merged `5ec640b`. |
| 2026-08-06 | `c233a36` | — | DEC-10 / AC-6 closed: real 40-unit calibration, sonnet pinned for both stages. |
| **2026-08-06** | **Slice 3** (this) | **new-feature** | QA **not** deferred; `intake-qa` forced on; all four evaluators run. |

### 3b. Have we seen this before?

Three different answers, and keeping them apart is the whole point of this
section.

- **The ask: NEW.** Zero matches for grouping / auto-group / `value_groups` in
  the global request-log (56 rows) or anywhere in `requests/`. This is the
  first time this capability has been requested. **0×.**
- **The surface: the most-touched in this project's history.** Slice 3 is the
  **5th consecutive effort in 3 days** on the `value-ledger` / `value-summary`
  / `value-coverage` file family, and the 4th intake against the same parent
  request. That family carries **9, 9 and 4** §9.3-family events across its
  three prior builds — the densest recurring-defect zone on record here.
- **The failure modes: seen 22+ times, and the run-plan is correctly built
  around that.** §9.1 (7 occurrences), §9.3 (the 8/9/4 runs), §9.7 (7), §9.8
  (its own live instance #1 *is* this surface). Every one of the four supporting
  docs cites the catalog by entry number and gets it substantially right.

### 3c. Decisions this request touches — and one that was re-argued instead of cited

Binding prior decisions Slice 3 consumes as **closed inputs**, correctly
identified by the run-plan and PO and **not** to be re-opened by the technical
plan:

- **DEC-10** (Slice 2, RESOLVED 2026-08-06) — sonnet for both stages after a
  real 40-unit calibration. Slice 3 consumes `summaryModel("grouping")` and
  `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL`. **No re-calibration.**
- **DEC-2** (Slice 2) — no scaffolded Auto-group button in Slice 2; the gate
  ships here, with AC-7 inherited verbatim. Carried correctly by the PO.
- **DEC-16** — `assembleValuePool` is the sole composer; `CONSUMERS` grows
  deliberately.
- **WATCH-6** — `value_unit_summaries` single-writer guards widen only
  deliberately.

**One correction, and it is a real one.** `request-brief.md` verification item
#7 states that OPEN-4 (`MAX_PROJECTS_PER_TICK`) is *"still Sara-undecided …
no new decision row resolves it."* **That is false.** Slice 2's
`decisions.md` **DEC-3** (2026-08-05) closed OPEN-4 *and* Slice 1's carried
OPEN-3 as superseded-in-part: the default of **3** is a **spec, not a pending
question**, there is to be **no second tuning mechanism**, and the drain must
not read that knob at all. The brief reached its conclusion by reading *code*
(the env var is unchanged) rather than the *decision log* — and a knob whose
value is unchanged is exactly what a "closed, keep the default" decision looks
like, so code-reading cannot distinguish "undecided" from "decided to leave
alone." The architect independently arrived at the same outcome ("no touch
needed") but by fresh reasoning rather than by citing DEC-3.

Substantively there is **no contradiction** — everyone landed where DEC-3
landed. Procedurally it is worth naming, because a settled decision that gets
re-derived from scratch is a decision that can come back differently next time,
and this specific question was already asked three times and answered zero
times before DEC-3 finally closed it. **Ruling: cite DEC-3, do not re-argue it.
OPEN-4 is closed and stays closed.**

## 4. Recurrence diagnosis

This is a repeat — not of the *feature*, but of a mechanism, and it is now the
single most reliable predictor of cost on this request family.

### 4a. The pattern: **a correct, dated deferral whose trigger nothing is obliged to check**

Five instances, all on this one parent request, inside eight days:

| Deferred item | Deferred | Trigger written | What actually made it fire |
|---|---|---|---|
| WS subscriber (client) | tick DEC-8/OPEN-3 → Slice 1 OPEN-1 → Slice 2 | 3× carried | Paid in Slice 2, after 3 carries |
| `MAX_PROJECTS_PER_TICK` | tick OPEN-4 → Slice 1 OPEN-3 → Slice 2 | asked 3× | Closed by PM-3 only when a PM went looking |
| **SF-4** probe-composition duplication | 2026-08-05, post-merge QA | *"extract when Slice 3's consumer lands"* | **A brief author's own diligence today** (verification item #6) — no mechanism |
| N2 locale-key fail-open | 2026-08-05 | "Slice 3 growth" | Fixed in the QA-fix round; the **catalog still says OPEN** (stale — see §9) |
| Slice 2's QA stage | DEC-F2, 2026-08-05 | "team-qa runs later" | It did run — post-merge, returned **BLIND**, cost a whole extra build |

The systemic cause is not carelessness and not a missing test. **This pipeline
is excellent at recording deferrals and has no mechanism that makes one come
due.** A WATCH row's trigger is prose in a file, and it fires only if some
agent, on some later run, happens to read the right file and recognise itself
in the trigger. That happened this time — the brief's verification item #6
caught SF-4 — but it happened because a careful author went looking, not
because anything forced it. The same author, in the same document, *missed*
DEC-3 (§3c) and missed that N2 had already been fixed. One-for-three on a
diligence-based mechanism, in the most carefully-run intake on this project's
record.

**The compounding version of the same cause, and the more expensive one:** when
a deferral's trigger doesn't fire, the *next* build lands a third copy of the
thing, and only then does anyone notice — which is precisely why SF-4's own
catalog note says "extract when Slice 3's consumer lands, and replace the guard
then — do not keep both." If Slice 3 deferred again, it would not be a
no-change decision: it would ship the third hand-copy the WATCH was written to
prevent, into a route surface whose two existing copies have **already diverged
once**.

### 4b. The second recurrence, already corrected by this run's own run-plan

Slice 2 deferred QA at intake (DEC-F2, a fast-mode decision) and paid for it
with an entire post-merge QA-fix build. This run forces `intake-qa` on and runs
in direct (not fast) mode. **That is the right correction and it should be made
standing, not re-decided per run** (§6, PM-6).

### 4c. What is NOT recurring — worth saying, because it is the good news

Slice 2's `pm-plan.md` §PM-5 recorded a planning note in `PROJECT-CONTEXT.md`:
*"do not intake slice N+1 of a multi-slice request until slice N's build has
landed."* **This run is the first test of it and it held.** Slices 1 and 2 are
both merged (`b38b4a1`, `4c2e931`, `5ec640b`, confirmed live by `git log`), the
working tree is clean apart from intake documents, and no premise in this
brief rests on an ambiguous staged diff. The specific cost that note was
written about — an intake decision written on a factually wrong premise about
what was in the tree — did not recur.

## 5. Where this is coming from — root source

Not drift, not a defect, not a misunderstanding. The root source is a
**complete, unchanged, eight-day-old approved requirement arriving on schedule
at its turn in a sequence**, landing on the highest-defect-density surface this
project has. The design questions it carries (heuristic widths, rollup
mechanics, schema shape) were left open *by design* and are the intended output
of exactly the four evaluator passes this run ran.

Two things make it more than a large feature, and both are inherited rather
than intrinsic:

1. **An inherited, trigger-fired obligation (SF-4)** whose fix trigger names
   this slice literally.
2. **An inherited catalog** that predicts, by name and with numbers, exactly
   how this build will fail if the guardrails are traded for speed.

## 6. Recommendation to the human

**Approve Slice 3 as scoped, and build it with all four rulings below intact.**
The evaluator set did unusually good work — the architect's two-stage seam and
decompose-*and*-disclose rollup, the engineer's SF-4 design and schema
precedent check, the PO's Slice 3/4 fence and the AC-7 carry-forward, and QA's
negative-proof shape for "proposals never actions" are each better than what
this surface has previously shipped with. My job here is the four dispositions
they deferred to me, plus five internal contradictions only a cross-reading
catches.

### Cost framing

- **New ask (your cost, new capability):** the grouping engine, the new tables,
  the routes, the review UI. T-shirt **L**, and I agree with the engineer's
  sizing — it is comparable to Slice 2, which alone generated 4 QA events.
- **Our cost (scheduled debt now due, pre-priced, not new scope):** the SF-4
  extraction (PM-2) and the AC-7 coverage-gate UI (Slice 2 DEC-2).
- **Our cost (bug prevention, not scope):** everything in QA's Definition of
  Done. This is not gold-plating on a surface with a 9/9/4 record.

---

### PM-1 — **Proposal/live-pool drift: BUILD a v1 mitigation now, in a deliberately narrow read-side form. Do NOT defer it to a WATCH row.** — DECIDED-AUTO

**The finding (architect §4, flagged by them as genuinely new — correct, it is
not in the brief's own enumeration).** `value_groups` rows are persisted; pool
membership is **not** — `assembleValuePool` is recomputed live on every call.
Between the moment a group is proposed and the moment Sara reviews it, a member
can be claimed elsewhere, or reattributed, or otherwise leave the pool.

**Ruling: build it, and here is why deferral is the wrong call specifically
here rather than in general.**

1. **It is a §9.8 instance, on the surface whose parent request names §9.8 as
   its standing trap.** A member that silently vanishes from a displayed group,
   or is silently still shown as available after being claimed, is a
   distinguishable outcome collapsed into an absence. The catalog's own
   acceptance criterion applies verbatim: every member lands in exactly one
   bucket, never zero, never two.
2. **A pre-flag is not a guard — this project has proven that at cost.** §9.1's
   2026-08-05 note is unambiguous: the altitude-invalidation build shipped the
   *exact* failure a pre-flag in this same catalog had named days earlier, with
   a header comment claiming the opposite. *"Prose in the catalog does not
   enforce; only an assertion enforces."* Deferring this to a WATCH row is
   choosing the mechanism that is on record failing.
3. **It silently voids an already-granted acceptance criterion.** AC-4 renders
   member `unitKey`s; AC-5 defines approve as *"Sara has looked at this and it's
   a reasonable candidate."* If the displayed membership can be untrue, AC-5 is
   approving a list that no longer exists. §9.4's how-to-comply is explicit:
   *an item that some earlier decision cited as its own mitigation is never a
   should-fix.*
4. **Slice 4 is a committed next slice, not a hypothetical.** Deferral parks a
   data-integrity bug directly in the path of the batch-claim feature that is
   this slice's only reason to exist.
5. **The cost is genuinely small, because the read path must exist anyway.**
   `GET /groups` already has to join `value_group_members` and return a
   server-computed shape the client renders verbatim (architect §5). Adding a
   per-member state to that same join is incremental, not architectural.

**The v1 is narrow and this narrowing is binding:**

- **Derive, never persist.** Per-member availability is **computed at read
  time** by joining live pool/claims state — there is to be **no
  `still_available` column** on `value_group_members`. This is the "derive,
  don't copy" cure the plan-lifecycle build already proved (`value_claims` has
  no `closed_at` for exactly this reason). It makes member-state staleness
  *structurally impossible* rather than guarded — §9.6's "prefer
  inapplicability over compliance," applied one layer up. It also means **zero
  new CHECK enum** and zero migration surface for these states.
- **Three named states minimum**, server-authored, exported as a registry in
  the shape of `ALTITUDE_STATES`/`DEMAND_STATES`: `available` /
  `already_claimed` / `no_longer_in_pool`. Never a silent drop, never a silent
  include, never a client-side inference from a missing key.
- **IN scope:** display-time truth on `GET /groups`.
- **OUT of scope, explicitly:** no write-back or reconciliation of
  `value_group_members`; no auto-dismiss of a group whose members all left; no
  re-proposal; no claim-time conflict resolution. Those are Slice 4's, and they
  get **WATCH-S3-A** below.

**WATCH-S3-A — claim-time re-validation is Slice 4's, and it is named now.**
Display-time truth does not make a *claim* safe: a member can leave the pool
between render and click. Slice 4's batch claim must re-validate inside its own
transaction and fail loudly on a conflict. **Fires-on:** Slice 4's batch-claim
build. **Lands-in:** Slice 4's claim route + its transaction test. Written in
the `Fires-on:`/`Lands-in:` form PM-5 makes mandatory.

---

### PM-2 — **SF-4: MANDATORY in this slice. Confirmed, and stronger than the brief realised.** — DECIDED-AUTO

**Ruling: extract `buildProbeCoverage` as part of Slice 3. Deferral is not
available.** Four grounds, the last of which nobody in this run found:

1. **The trigger is written, names this slice, and has fired.** The catalog's
   own words: *"Extract `buildProbeCoverage` when Slice 3's consumer lands, and
   replace the guard then — do not keep both."* Slice 3's server-side coverage
   gate (PO's AC-6: a pure read of `coverageSnapshot.complete`, non-negotiable
   per DEC-2's binding condition) **is** that consumer.
2. **Confirmed live today:** both handlers still hand-write the composition —
   `server/routes/project-plans.js:319` and `:352` each carry their own
   `await enrichPoolAltitudes(dbModule, units, { probe: true })`. The two copies
   have **already diverged once**, on `requestedAt`.
3. **Deferring is not a null action.** Without the extraction, Slice 3's gate is
   the **third hand-copy by construction** (engineer §5). §9.4's standing rule —
   a finding ends *fixed with a test* or *dated and disposed*, "should-fix is a
   triage label, not a disposition" — has now been carried once; a second carry
   with a third copy in the diff is the recurrence, not a delay.
4. **The correction this run needs, and it is load-bearing:** the engineer's
   §1.3 states *"I verified no such structural guard currently exists … so there
   is nothing to delete."* **That is wrong.** The guard exists: **T7** in
   `server/__tests__/project-plans-api.test.js:905`, built in the Slice 2
   QA-fix round, and it is the **anchored** version (lines 988–998: a
   `deepEqual(postKeys, getKeys)` *plus* `deepEqual(postKeys, ["computedAt",
   "counts", "draining", "projectId", "requestedAt"])`) — the anchor the
   reviewer had to add after proving the unanchored form green against a
   matched pair of drifts (§9.4's PARITY-WITHOUT-ANCHOR detector). The
   engineer's grep missed it because it searched for `"sorted key set"` and
   `"buildProbeCoverage"`, neither of which appears in T7 — a hand-scoped scan
   (§9.7) at the *investigation* level rather than the test level.

   **This matters concretely: the extraction will turn T7 RED.** T7 asserts
   that each handler *body* literally contains
   `await valueLedger.assembleValuePool(dbModule, { id: projectId })` and
   `await enrichPoolAltitudes(dbModule, units, { probe: true })`. After
   extraction those lines live in `value-coverage-probe.js` and the assertions
   fail. **Disposition, binding: T7 is deleted and replaced in the same commit**
   — never "adjusted until it passes," which is the §9.4-named temptation this
   project's Slice-2 implementer was praised for refusing.

**The replacement guard, ruled (this resolves a real contradiction between two
of this run's own documents).** QA §4 asks for "a route↔route parity guard …
anchored"; the engineer §1.3 argues the single-call-site guard *subsumes* it;
the catalog says "replace the guard then — **do not keep both**." **Ruling: the
engineer and the catalog are right, and an unanchored route↔route parity
assertion after extraction would be a guaranteed-green vacuity** — both sides
would literally call one function, so `deepEqual(A, B)` degenerates to
`deepEqual(f(X), f(X))`, which is *precisely* the shape that made
`value-coverage-parity.test.js` the vacuous guard in Slice 2. Build instead:

- `buildProbeCoverage` is **defined exactly once** (`value-coverage-probe.js`),
  and its **call-site set is exactly three**: `POST /coverage-request`,
  `GET /coverage`, and Slice 3's gate. Scope **derived** from a grep of
  `server/lib` + `server/routes` + `bin/`, **failing closed** on any importer
  with no disposition (§9.7's sharper statement: a derived scope whose miss
  branch `continue`s is a hand-typed scan in derived clothing).
- Keep QA's anchoring instinct where it still bites: retain an anchored
  assertion on the **response key set** of each route (the surviving,
  non-vacuous half of T7's value).
- **Red-proof:** inject a fourth hand-copy of the composition into a route
  handler and watch the guard fail; restore byte-identical. Not reported —
  performed, and re-run by someone other than its author (§9.3
  AGENT-SELF-REPORTED-RED).
- **Preserve the `requestedAt` divergence.** It is load-bearing (POST cannot
  re-read `getValueSweepState` without racing the drain it just kicked — SF-2/
  SF-3). The extraction parameterises it; it does not erase it. A guard that
  forces the two routes to behave identically here would re-introduce a fixed
  bug.

---

### PM-3 — **Three tables, not two: `value_group_runs` is REQUIRED.** — DECIDED-AUTO

**This is an internal contradiction inside this run's own inputs, and following
the wrong half would ship the exact defect QA's own checklist forbids.**

The architect (§5) specifies **three** tables: `value_group_runs` /
`value_groups` / `value_group_members`. The engineer (§2.2) specifies **two** —
`value_groups` with a `run_id TEXT` column, and `value_group_members` — and the
engineer's document is the more detailed, more copy-ready one, so it is the one
a build implementer will follow.

**The two-table shape structurally cannot represent the run-level states QA's
§1a mandates.** With no runs table:

- A project where the mechanical pass produced **zero clusters** has **zero
  rows anywhere**, which is byte-identical to *"grouping was never attempted."*
  That is §9.8's live instance #1 reproduced exactly, on the surface §9.8 was
  catalogued from — `SELECT … WHERE project_id=?` returning `[]` with five
  possible meanings.
- **`in-progress` has no home at all** — and a sonnet pass over a 200-unit pool
  is the single longest-running action in this product. Sara's own standing UX
  constraint ("always tell the user what's happening, how long it will take")
  has nowhere to live without this row.
- **`failed`** at the run level (the whole pass errored before producing any
  group) is likewise unrepresentable; the engineer's per-group
  `refinement_state='failed'` only covers a *batch* that got as far as having a
  group row.

**Ruling: build `value_group_runs` as the architect specified** — the direct
structural analogue of `value_summary_sweep_state`, which already solves this
exact problem one layer down. It carries the exported `GROUP_RUN_STATES`
registry QA §1a requires (`not-attempted` is the intentional absence of a row;
`in-progress` / `completed` / `completed-zero-groups` / `failed` are rows), and
it is also where PM-4's cache digest lives.

**Also ruled, because three documents give three different vocabularies for the
same column** (engineer: `status` ∈ proposed/reviewed/claimed/dismissed;
architect: `review_status` ∈ proposed/approved/dismissed; PO: approve/dismiss
with `claimed` reservable-or-omittable):

- **One column, named `review_status`**, values **`proposed` / `approved` /
  `dismissed` / `claimed`**. `approved` (not `reviewed`) because it is the word
  the PO's AC-5 and the UI copy use, and a schema value that disagrees with the
  button label is a future §9.1-shaped translation layer.
- **`claimed` IS reserved in the CHECK at introduction.** The PO left this
  open either way; I am closing it toward reservation. Grounds: Slice 4 is
  committed and hard-dependent, the full vocabulary is already written in
  `request.md`, and WATCH-4's recorded lesson is that CHECK enums are
  rebuild-to-widen — this project has **five** non-atomic rebuild sites and
  paid real cost learning that. Reserving one value costs one word;
  not reserving it costs Slice 4 a `rebuildTableAtomically` call plus a
  `REBUILD_CASES` entry plus an interruption test.
- **The unreachability is guarded, not asserted in prose.** The structural scan
  QA §5 already mandates gains one more assertion: **zero code paths in Slice 3
  set `review_status = 'claimed'`**, red-proven by injecting one. That converts
  the PO's §7 fence ("Slice 3 may reserve `claimed` but no code path may reach
  it") from a rule someone must remember into a test that fails.
- Keep the engineer's `refinement_state` (`pending`/`refined`/`zero_members`/
  `failed`) as the **separate** per-group axis. Two orthogonal lifecycles must
  not be collapsed into one column — that is §9.8 in miniature.

---

### PM-4 — **Cost-control caching ships in v1, in its minimum honest form.** — DECIDED-AUTO

The architect (§4) recommends v1 and flags that deferral needs a dated row.
Ruling: **build it, minimally**, because at ~200 units "click auto-group again
to see if anything changed" is an unbounded-cost action, and Sara's own framing
names cost/scale at 200 units as a first-class requirement.

- Store the run's **input digest** on `value_group_runs`. On a re-run request,
  if the digest matches the most recent completed run's, return that run's
  proposals with an explicit named state (e.g. `reused_unchanged`) — do **not**
  spawn. One column, one comparison, one wire state.
- This also *is* Sara's "tell me when something I saw before has changed"
  constraint, mechanically: the digest is that signal.
- **Reuse Slice 1's existing input-comparison shape; do not invent a second
  digest formula** (§9.1's rogue-re-derivation sub-form — a second derivation
  is as dangerous as a second read).
- **Mandatory guard, and it is the fix shape this project already proved
  (2026-08-05, `UNCOMPARED_FIELD_GUARANTORS`):** a coverage test that walks the
  keys of the grouping prompt's own fact object, mutates each, and asserts the
  cache key detects the change — with the excepted set asserted to be
  **exactly** the reviewed list. Slice 1 shipped the one-directional version of
  this (`unitFacts` returned three fields, the comparator compared two) with a
  header comment claiming it was physically impossible. Do not ship that
  comment again without the loop that proves it.

---

### PM-5 — **Two gaps no evaluator covered, absorbed here** — DECIDED-AUTO

Both are un-catalogued candidate patterns with "promote on second occurrence"
triggers, and Slice 3 is the likeliest second occurrence on record. Neither
appears in any of the four supporting documents.

**(a) MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH.** Slice 3 extends
`PlanLedgerPanel` — the exact component this candidate was recorded against —
which `ProjectDetail.tsx:1292` renders **unkeyed**, so React reuses its state
across a project switch. The catalog states plainly that "every future field
`PlanLedgerPanel` gains inherits the same leak (its `altitudes` and
`requestedAltitudesRef` already do)." Slice 3 adds several: the group list, the
run status, any in-flight proposal request. **Required:** every new
entity-scoped state resets on `projectId` change, and every new spec file for
this panel carries one *"switch the id, assert the state followed and the old
project's groups are gone"* case, with at least one case holding a response
open **across** the transition (the quiescent-only fixture is how the Slice 2
fix looked complete while the in-flight leak stayed live).

**(b) STRICTMODE-BLIND CLIENT SUITE.** This candidate *fired* on this exact
component in Slice 2 (BL-2): a `useRef(true)` + cleanup-only `useEffect` meant
that in `npm run dev` **no unit ever rendered its PROJECT/STAKEHOLDER text** —
the entire point of Slices 1–2 — with an 817/817 green suite over it.
**Required:** any new effect/ref in `PlanLedgerPanel` re-arms in setup whatever
it tears down in cleanup, and at least one new Slice 3 client test renders
under `<StrictMode>`.

**(c) The registry-at-the-CJS/Vite-boundary axis.** WATCH-S2-F's literal
trigger is "any Slice 3 growth of `demand`/`eta.state`" — Slice 3 does not grow
*those two*, so the letter does not fire, but it adds **new sibling registries
at the same boundary** (`GROUP_RUN_STATES`, `refinement_state`,
`review_status`, PM-1's member states), each needing four locale files.
**Required:** every new registry gets the **anchored exemption-set assertion**
from day one — `assert.deepEqual(exemptStates, [<reviewed list>])`, the exact
two-line shape that closed N2 — so a 5th value breaks the test at the point of
growth. A derived enumeration whose miss branch is `if (!key) continue;` is a
hand-typed scan wearing a derived scan's clothes.

---

### PM-6 — **Process rulings, and the one durable fix I am actually asking for** — DECIDED-AUTO

1. **Standing, not per-run: on this file family, `intake-qa` and
   `build-reviewer` are non-trimmable regardless of mode.** The evidence is
   four-for-four — three consecutive builds where the reviewer found blockers a
   correctly-executed verifier pass had already certified green, plus Slice 2's
   deferred QA costing an entire extra build. The catalog already carries the
   reviewer half as a "standing recommendation"; promote both to a rule so they
   stop being re-decided under speed pressure.

2. **The durable fix for §4's recurrence — every deferral row gets a
   `Fires-on:` and a `Lands-in:`.** SF-4 survived a slice because it had a
   trigger but no *filename*. This project has exactly one mechanism with a
   proven adoption record: **"name the file, and the spec gets written"**
   (T6/`ledger-metrics-parity.test.js`, 2026-08-02, and again with the N2
   two-line fix). Applied to deferrals:

   - Every WATCH / deferred-should-fix / carried-OPEN row states **`Fires-on:`**
     (the concrete event) and **`Lands-in:`** (the file that will change).
   - Every intake's own DoD gains one line: *"every open row whose `Fires-on`
     names this slice is dispositioned in this brief."*

   That is a documentation-shaped fix and I am aware this project's record on
   those is "recorded 3×, adopted 0×" — which is why the ask is one line in a
   template rather than a new process, and why PM-2's ruling does not depend on
   it. Every WATCH row I open in this plan is written in that form already.

3. **Catalog notes are applied now, on `master`, not deferred to the effort
   branch.** Slice 2's PM-5 deferred them because the tree was ambiguous; it is
   not today. The two corrections in §9 are stale-fact fixes that actively
   mislead anyone reading the catalog before this build starts.

## 7. Open decisions for the user

None blocking. Build can start on all of them as ruled.

1. **PM-1 (proposal/live-pool drift).** I am adding read-time per-member state
   re-validation to Slice 3's scope — a real, if small, scope increase over
   what you approved on 2026-08-04. Veto if you would rather see the groups
   ship faster and accept that a displayed member list can be stale until
   Slice 4.
2. **PM-3 (`claimed` reserved in the enum now).** The PO left this open both
   ways; I closed it toward reserving. Cheap to reverse before build, expensive
   after.
3. **PM-4 (cache in v1).** Adds a column and a wire state. Veto if you would
   rather every "auto-group" click always re-run for freshness.
4. **PO §6.2 — what "approve" means.** Approve = *"reviewed, reasonable
   candidate to act on later,"* and claims nothing. If your mental model was
   "approve commits it to the plan," say so — that is a request to loosen the
   never-auto-claims principle and it would need to be an explicit decision,
   not an implementation detail.
5. **PO §5 — the coverage gate reuses the single existing
   `prioritize-now-button`** rather than adding a second group-specific one.
   Flag if you pictured a distinct group-level ETA sentence.
6. **AC-3's disclosure affordance** — what "N units not yet grouped" looks like
   is left to design; PO's bar is only that it exists and is truthful. Worth a
   look once built.
7. **OPEN-S2-1 (carried, still open)** — which real project validates the flow
   end to end. Non-blocking; recorded so it does not silently close.

## 8. WATCH rows opened by this plan

- **WATCH-S3-A — claim-time member re-validation.** PM-1's deferred half.
  **Fires-on:** Slice 4's batch-claim build. **Lands-in:** Slice 4's claim
  route + its transaction test.
- **WATCH-S3-B — shared-surface heuristic narrowed for v1** (architect §3b): a
  label/path-substring proxy, not commit-diff file-path analysis.
  **Fires-on:** an observed real miss (two units on one surface failing to
  cluster), or `trunk-drift.js` commit objects gaining cheap file paths.
  **Lands-in:** `server/lib/value-groups.js`'s `mechanicalPreGroup` + its spec.
- **WATCH-S3-C — time-adjacency width is measured, not guessed** (architect
  §3b + §9.8's bounds rule): the declaring comment must cite the measured
  distribution from the live pool (~102 units today, 182 recorded). A bound
  comment that cannot name a number does not ship. **Fires-on:** build time.
  **Lands-in:** the constant's own declaring comment.
- **WATCH-S3-D — T7 must be deleted, not adjusted**, when SF-4 lands (PM-2).
  **Fires-on:** the extraction commit. **Lands-in:**
  `server/__tests__/project-plans-api.test.js:905` (removal) +
  the new call-site-set guard.

## 9. Memory / catalog updates made by this plan

1. **Request-log** — row appended for this intake.
2. **`PROJECT-CONTEXT.md` §9.7** — dated correction: the "N2, still OPEN" note
   is **stale**; N2 was closed in `5ec640b` by
   `value-coverage.test.js:297`'s anchored exemption-set assertion. Left
   uncorrected, the next reader re-does closed work — which is one of the three
   diligence failures §4 counts.
3. **`PROJECT-CONTEXT.md` §9.1 (SF-4 note)** — dated PM disposition: extraction
   ruled MANDATORY for Slice 3, plus the fact the engineer's investigation
   missed — **T7 exists, is anchored, and will go red on extraction**.
4. **No occurrence counts incremented.** Nothing has been built. §9.1 stays at
   7, §9.7 at 7, §9.8 unchanged. All catalog hits in this intake are
   design-time pre-flags.
