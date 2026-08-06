# PM Plan — Value Pool coverage-on-demand + progress UX + model tiering (Slice 2)

**Intake:** `2026-08-05-coverage-on-demand`
**Parent request:** `requests/2026-08-04-value-pool-grouping/request.md` (four-slice
vision; this folder is **Slice 2 only**, per DEC-F1)
**Run mode:** **fast** (auto-pilot + direct). Every fork below is taken by the team
and logged `DECIDED-AUTO`; Sara may reverse any of them without reopening the work.
**QA stage deferred** by DEC-F2 — build carries the `FAST — QA debt` stamp.
**PM also absorbing the skipped `intake-product-owner` angle** (open points C and D,
acceptance criteria) and open point H (OPEN-4 reconciliation), per `run-plan.md` §2/§3.
**Date:** 2026-08-05

---

## 1. Request summary

The Value Pool now describes each unit of delivered work in two plain-language
sentences, generated on demand when you open a project and slowly backfilled by a
background sweep that visits three projects every ten minutes. That is fine when
nobody is waiting. It is not fine when you *are* waiting — the measured worst case
for full-fleet coverage is **250 minutes** at the shipped defaults, and today the
product tells you nothing about where it is in that. This slice gives the sweep a
second, explicit demand level: an intentional **coverage request** flags one project
to jump the rotation and drain continuously to 100%, and the panel gains an honest
progress surface — "N of M described · ~X min remaining", where the ETA comes only
from real measured batch durations in `value_summary_generation_log` and never from
a guess, plus a "prioritize now" action. The panel also gets its first-ever
WebSocket subscription, so that progress moves in place instead of on remount.
Separately and independently, a one-time haiku-vs-sonnet calibration is run on one
real 40-unit batch, and a per-stage model env knob is added so per-unit compression
and (in Slice 3) grouping synthesis can run on different tiers.

---

## 2. Request type

### Final call: **`new-feature`** — triage's provisional call is **upheld**, with one **scheduled-debt carve-out**

This is the first intake on this surface in four days that is *not* a
`missed-requirement`, and because the two immediately preceding ones both overturned
to `missed-requirement` on the same test, the reasoning for stopping the streak has
to be explicit rather than assumed.

**The test this project has now applied twice, verbatim:** *is there a load-bearing
claim about the world, written into the shipped code as justification for a design
shortcut, that was falsifiable at the moment of writing from artifacts already in
hand, with nothing in the pipeline able to fail on it?* That test found
`MAX_UNITS_PER_PROMPT = 40`'s *"overflow is expected to be rare"* (falsified by a
182-unit pool recorded the previous day) and `db.js`'s *"immutable once seen …
generated once, served forever"* (falsified by `buildPrompt`'s own `u.stage` read
thirty lines away).

**Applied here, the test comes back clean, and it does so on the record:** the
passive sweep's coverage latency was never claimed to be fast. The prior effort's
DEC-5 **published the coverage-latency formula**, its OPEN-4 required it to be
*measured against the real fleet before sign-off*, and the implementer measured it —
`P = 15`, `U = 182`, `250 min (~4h10m)` — wrote the number into the decision row,
noted it **exceeds the ~2h bar the row itself set**, and put the tuning lever in
front of Sara. That is the exact opposite of an unevidenced claim: it is an
evidenced, disclosed, quantified property with an owner. Nothing about the passive
path is broken relative to its specification, and the specification was not wrong —
it was complete, honest, and slow on purpose ("never eager-backfill all projects" is
the requester's own constraint, restated verbatim as acceptance signal 1 of *this*
slice).

So:

- **Not a bug** — the passive path does what it was designed, documented and
  measured to do.
- **Not a regression** — nothing worked faster before; on-demand coverage has never
  existed.
- **Not a missed-requirement** — the requirement was not incomplete or wrong from the
  start. "Let me ask for coverage on one project and watch it arrive" is a
  genuinely new capability, and the ETA/progress surface, the demand-level
  distinction, the gating state, and per-stage model tiering are all net-new
  behavior nobody previously promised.
- **`new-feature`.** Sara's cost, in the sense that it is a new ask she approved
  verbally on 2026-08-04 — not remediation we owe.

### The one carve-out: the OPEN-3 WebSocket subscriber is **scheduled debt coming due**, not new scope and not a missed requirement

`PlanLedgerPanel` subscribes to no WebSocket message for any of its data. The
`value_altitudes_updated` broadcast has been shipping to **zero subscribers by
design** since the prior effort (DEC-8), tracked as its OPEN-3, re-carried by Slice 1
as its OPEN-1 with the unusually candid framing *"a knowing reduction of this slice's
own headline promise."* This slice is the first feature that genuinely cannot work
without it.

The brief (§6) offered this as arguably `missed-requirement`-shaped. **Ruled: it is
debt, not a missed requirement.** The distinction this project uses is whether the
requirement was *incomplete from the start* (missed-requirement) or *complete,
deliberately under-delivered, and recorded with the user informed* (debt). AC-1 was
stated correctly both times; we knowingly declined ~20 lines, wrote a dated row, and
said so out loud in two consecutive plans. That is the same shape Slice 1 used for
request-path logging — *"scheduled debt, now due"*, following trunk-drift's WATCH-4
precedent — and it should be billed the same way. **Our cost, pre-priced, not new
scope, and not a defect class.**

**Cost framing in one line:** coverage-on-demand, the progress/ETA surface, the
demand-level states and model tiering are **new scope Sara approved**; the WS
subscriber is **debt coming due (our cost, ~20 lines, pre-priced twice)**; nothing
in this slice is remediation of a defect we shipped.

### Catalog touch counts: **no entry incremented by this intake**

Nothing has been built. Every §5 catalog hit is a **design-time pre-flag**, per each
entry's own convention:

| Entry | Status here |
|---|---|
| **§9.8 OVERLOADED-ABSENCE** | This surface is the entry's own **live instance #1**. Per its explicit rule — *"re-encountering a known instance is not an occurrence"* — **count unchanged.** This slice manufactures at least three new absence states (`coverage-requested-not-yet-swept` / `draining` / `passive`; ETA cold-start; drain-stalled); pre-flagged, not counted. |
| **§9.1 DERIVED-DUAL-VIEW** (at 6) | **Count unchanged.** Coverage + ETA are derived values arriving with **consumer #2 (WS) on day one** — the precise moment this entry's history says the failure lands. Pre-flag, with the cure specified (one `coverageSnapshot`, carried verbatim by HTTP and WS). |
| **§9.2 / §9.5 / §9.3 / §9.7** | **Counts unchanged.** All pre-flags: the ETA's log read, the `coverage_requested_at` column, the standing red-proof rule, the `assertSingleHome` / `FILE_DISPOSITIONS` scopes that will go red on the new exports. All are the guards *working*, not obstacles. |

---

## 3. History / background — where this is coming from

### Timeline of this exact surface

| When | Event | Classification |
|---|---|---|
| 2026-08-02 | `plan-lifecycle-value-ledger` creates the value pool (`assembleValuePool`, `value_claims`, unit vocabulary, `CONSUMERS`/DEC-16 sole-composer seam). No altitude layer. | new-feature |
| 2026-08-03 | That effort's **DEC-12** signs off against a rendered **live 182-unit** pool. The number that every subsequent bound on this surface is measured against. | — |
| 2026-08-04 (early) | The altitude layer is found as **~991 uncommitted lines on `master`** and committed as `b155f83`. Its schema comment declares generate-once-serve-forever. | — |
| 2026-08-04 | **`value-summary-tick`** intake: the 40-cap collapses five distinguishable outcomes into one absence. **`missed-requirement`.** Promotes **§9.8** to a numbered entry. Ships the background sweep, `value_summary_sweep_state`, the generation log, and `value_altitudes_updated` **broadcast with no subscriber** (DEC-8 / OPEN-3). Measures **OPEN-4: 250 min worst-case fleet coverage**. Merged as **`55fe900`**. | missed-requirement |
| 2026-08-04 | Sara's four-slice vision approved verbally in the same session. `request.md` written. | — |
| 2026-08-04 | **Slice 1 `altitude-invalidation`** intaken in full (brief, PM plan, technical plan, QA plan, decisions, QA addendum). **`missed-requirement`.** Carries the subscriber forward as OPEN-1 and `MAX_PROJECTS_PER_TICK` forward as OPEN-3. **Zero build code written — then or since.** | missed-requirement |
| 2026-08-05 | **This intake.** Slice 2, fully intaken. Also zero build code. | **new-feature** |

### Have we seen this before?

**The ask: no.** Coverage-on-demand, the progress/ETA header, demand levels and model
tiering have no prior touch anywhere in the request log or the intake tree. This is a
first request for this capability.

**The surface: yes — 4th intake in 4 days, 3rd consecutive touching
`value-summary.js`.** Three of the four were driven by a defect in something already
shipped; this one is not. The surface's velocity is itself the finding (see §4).

**The *deferrals*: yes, and this is the part that matters.** Two specific items have
now been carried forward without resolution across every effort on this surface:

| Carried item | Touch 1 | Touch 2 | Touch 3 | Status |
|---|---|---|---|---|
| Client WS subscriber (~20 lines) | tick effort **DEC-8 / OPEN-3** (2026-08-04) | Slice 1 **OPEN-1** (2026-08-04) | Slice 2 (this slice — the first that cannot ship without it) | **Being paid here.** |
| `MAX_PROJECTS_PER_TICK` / fleet latency | tick effort **OPEN-4** (measured 250 min, PENDING Sara) | Slice 1 **OPEN-3** (re-carried, PENDING Sara) | Slice 2 open point H (this plan) | **Closed here — see PM-3.** |

Neither is a code defect. Both are the same shape: a correct, disclosed decision to
not-do-a-thing, which then survives every subsequent planning pass because each pass
faithfully re-carries it rather than dispositioning it. This project's own catalog
already names the failure mode — §9.4's *"'should-fix' is a triage label, not a
disposition"* — but has only ever applied it to review findings, never to carried
`OPEN` rows. A question asked three times and answered zero times is a decision
nobody wants to make; the fix is to make it (PM-3), not to carry it a fourth time.

### Decisions this request touches, and whether it contradicts any

| Prior decision | Effect here |
|---|---|
| **DEC-16 / `CONSUMERS`** (`assembleValuePool` is the sole pool composer) | **Honored.** Coverage's denominator M comes from the composer, never from new pool SQL. Registry widens in the same commit if a consumer is added. |
| **DEC-15** (sole-composer structural test) | Untouched, must stay green. |
| **DEC-8 / OPEN-3** (broadcast, no subscriber, payload shaped for a pure client addition) | **Consumed as designed.** The payload widens additively at the cheapest moment it will ever be — zero subscribers exist. Working exactly as intended. |
| **DEC-14** (Slice 1: `enrichPoolAltitudes` returns its own `counts`; nothing re-derives them) | **Extended one hop, not bypassed** — `counts` is `coverageSnapshot`'s only numeric input. |
| **DEC-11** (Slice 1: log partition counts *work*, wire partition counts *renderability*; they deliberately disagree) | **Extended.** PM-2's denominator ruling is that same shape one layer up: *described ≠ displayed*, by design. Given its own row so a later reader cannot "fix" it into agreement. |
| **DEC-10/DEC-11** (prior effort: strict `{altitudes, states}` partition, "never both, never neither") | Preserved byte-for-byte. Coverage rides beside it, not inside it. |
| **WATCH-6** (single-writer guards widen deliberately) | Slice 2 adds **no** new caller of `upsertValueUnitSummary` / `insertValueSummaryGeneration` (engineer §1.5, verified). Build on Slice 1's already-widened state; do **not** re-widen. |
| **WATCH-7** (route-vs-tick two-writer race, blessed safe-but-wasteful) | **Made structurally impossible** for the drain, not re-litigated: one runner module, one shared `running` overlap guard (architect §3.2). |
| **WATCH-8 / QA-DEC-2** (progress re-derived live, never decremented) | Binding on the coverage counts and the drain's loop condition. |
| **OPEN-4 / Slice 1 OPEN-3** (`MAX_PROJECTS_PER_TICK`) | **Closed by PM-3**, per the parent request's own "reconcile rather than duplicate" instruction. |
| **DEC-5** (cadence/cap defaults) | **Unchanged.** No shipped source default moves in this slice. |
| **`value_summary_generation_log.source CHECK('tick','request')`** | **Untouched** — drain rows log as `'tick'`. A third enum value would be a §9.6 full-table rebuild (engineer G2). |

**No contradiction of a settled decision.** The one supersession (OPEN-4) is
mandated in the parent request's own Constraints section.

---

## 4. Recurrence diagnosis

**This is a repeat — but not of a defect. What is recurring is that the pipeline is
outrunning the build.**

The evidence is unambiguous and was surfaced independently by two agents in this run
against live git, not against documents:

- The prior effort (`value-summary-tick`) is **merged upstream at `55fe900` and is
  not in local `master`**. Local `master` (`c6f8154`) is **6 ahead / 2 behind**
  `origin/master`, and the ~2,000-line, 23-file staged diff sitting on the main
  checkout is a **duplicate of that already-merged effort** (16 of 23 files
  byte-identical to `55fe900`).
- **Slice 1 has zero build code anywhere** — no `input_stage`/`input_label`, no
  `ALTITUDE_FRESHNESS`, no `counts` on the composer return, no effort branch, no
  worktree. It has a request brief, a PM plan, a technical plan, a QA plan, a
  decisions log **and** a QA decisions addendum. Six documents, no code.
- Slice 2 now has the same: a brief, a run plan, three specialist assessments, a
  decisions log, and this plan. No code.
- Three live `claude` CLI sessions and a Vite dev server are running from this repo's
  cwd right now.

**The systemic cause.** Planning throughput on this surface has exceeded build
throughput for two consecutive slices, and the shared main checkout is the state that
absorbs the difference. Nobody did anything wrong: fast mode is *supposed* to plan
quickly, DEC-F1 correctly sequenced Slice 2 next, and the intake agents correctly
verified and corrected the record. But the cost is concrete and it already landed in
this run — **`DEPENDENCY-F1` was originally written on a factually wrong premise**
("Slice 1's build sits uncommitted on the main checkout"), and it was wrong precisely
*because* the working tree contained an unlabelled ~2,000-line diff that could
plausibly have been anybody's. A tree that ambiguous made a reasonable reader wrong.
Had that gone uncorrected, Slice 2 would have been dispatched to build against a tree
with no Slice 1 in it, and the first thing the builder would have had to invent is a
temporary definition of "described" — the exact §9.1 second derivation this slice's
whole design exists to prevent.

**This is the known "capability ships with nothing recording it" thread, inverted.**
That thread has been recorded three times on this project (`focus-untracked-commits`
2026-07-31; the tick effort's 991 uncommitted lines; Slice 1's 44 dirty paths) and
the process fix has been recommended three times and adopted zero times. The
inversion is new and worth naming plainly: **the record now ships with no
capability.** Same root — the working tree is used as an undeclared staging area, and
nothing forces the tree's state to match the documents' claims about it.

**The durable fix is not another recommendation. It is one hard gate, one time:**
*no further slice of this request is intaken until the preceding slice's build has
landed.* Slice 3's intake does not start until Slice 2's build is merged. That single
rule ends the accumulation, costs nothing, and is enforceable by the person
dispatching the work — which is the only kind of process fix this project has any
evidence of adopting. Everything else (the ps/lsof check, the fresh worktree, never
building from the dirty checkout) is already written down three times and is
necessary but demonstrably not sufficient.

Secondary, and cheaper: the git reconciliation in §6's step 1 is the highest-risk
operation in this whole slice — a divergent branch, a staged duplicate of merged
work, three concurrent sessions, and a repo with a documented history of real work
loss. It deserves to be treated as its own task with its own care, not as a
preamble to the build.

---

## 5. Where this is coming from — root source

**Not drift, not a misunderstanding, not a missing test. A changed requirement, and
a correctly-priced constraint whose price became unacceptable once a user was
waiting on it.**

- The **capability** comes from Sara's 2026-08-04 session: once every unit has its
  description, she wants to auto-group. Grouping needs 100% coverage. Coverage at
  passive speed is up to 4h10m. So the vision itself created the need for a second
  demand level — this slice exists because Slice 3 cannot exist without it.
- The **progress UX** comes from one sentence in the vision that is doing more work
  than it looks like: *"the UX must always tell the user what's happening, how long
  it will take, and when something they saw before has changed."* Slice 1 answers the
  third clause; Slice 2 answers the first two. That sentence is also the reason the
  ETA is specified as "never a guess" — this surface's entire defect history (§9.8) is
  about a product that could not distinguish a backlog from an outage, and a
  fabricated ETA would reintroduce that at the very layer built to cure it.
- The **model tiering** comes from an explicit precedent Sara named herself
  ("measure, don't guess" — this project's OPEN-4 precedent). Cost is not the driver
  and should not enter the decision: ~$0.001/unit, ~20¢ for a 182-unit backfill.
  Quality-per-tier is the open question, and it is answerable only by running the
  side-by-side.
- **Nothing here traces to a defect we shipped.** That is what makes this slice
  different from the three intakes before it.

---

## 6. Recommendation to the human

**Approve Slice 2 as scoped, with the two rulings below — and do not let it start
until Slice 1 is actually built.**

### The sequencing, plainly (this is the most important paragraph in the plan)

`DEPENDENCY-F1`'s original wording said Slice 1's build was sitting uncommitted on
the main checkout. **That was wrong**, and it has been corrected in `decisions.md`
after the intake-architect and intake-engineer independently verified live git.
Slice 1 is *planned*, not *mid-build*. The real chain is three steps, in order, and
none of them can be skipped:

1. **Reconcile the git divergence on the main checkout.** Run `ps` / `lsof` first —
   three `claude` sessions and a Vite dev server are live from this cwd, and this
   repo has lost real work to exactly this. Then safety-branch, drop the staged
   duplicate of `55fe900`, and merge `origin/master` so the tick effort arrives
   through its real merge commit rather than as duplicate-content history. Treat this
   as its own task with its own attention.
2. **Build Slice 1 for real**, on its own worktree cut from the reconciled `master`.
   Its `technical-plan.md` already exists and has never been executed.
3. **Then, and only then, branch Slice 2.**

**Why Slice 2 genuinely cannot go first**, in one sentence: this slice's coverage
number is defined as *fresh-or-immutable* (PM-1 below), which is a concept that only
exists inside Slice 1's input-snapshot comparator, and its only numeric input is
Slice 1's DEC-14 `counts` return shape — so building Slice 2 first means inventing a
second, temporary definition of "described" that Slice 1 then contradicts, which is
§9.1's failure landing by construction in the slice whose design exists to avoid it.

### What you are approving

- A per-project **coverage request** (`coverage_requested_at` timestamp on
  `value_summary_sweep_state`) that jumps the sweep rotation and drains that project
  to 100% in bounded back-to-back batches, kicked immediately by the "prioritize now"
  click and resumed by the next passive tick if it is interrupted.
- A **coverage header** — "N of M described · ~X min remaining" — computed in exactly
  one server-side place and carried *verbatim* by both the HTTP response and the
  WebSocket payload, with a named `estimating` state when no real durations have been
  measured yet. The client renders; it never computes.
- **"Prioritize now"** as the discoverable entry point.
- The panel's **first WebSocket subscription**, so all of the above moves in place.
- A **per-stage model knob** (`summaryModel("unit")` / a `grouping` sibling for
  Slice 3) preceded by the one-time haiku-vs-sonnet calibration on a real 40-unit
  batch.
- **Not** the disabled Auto-group button — see PM-2.

### Size and cost framing

Overall **M** on the server and client, with tests and guards the largest single
chunk (as this project's history reliably predicts). The genuinely large cost is the
**predecessor work in steps 1 and 2 above**, which is not this slice's scope and
should not be estimated as if it were. Runtime cost is negligible and should not
enter the decision.

### The durable fixes not to trade away under schedule pressure

1. **One `coverageSnapshot`, one home, carried verbatim by both wires.** Coverage and
   ETA arrive with consumer #2 on day one — the exact moment §9.1's own history says
   this fails — and the twice-proven lesson is that what ships is a rogue
   *re-derivation*, not a rogue read. The cross-consumer parity test (route response
   deep-equals broadcast payload for one seeded DB state) is the single most
   load-bearing test in the slice. This project's evidence is that such a test only
   gets written when it has a filename; give it one.
2. **Every new state is server-authored and named.** `demand`, `eta.state`, drain-
   stalled. The client must never infer a state from silence — "no WS message yet" is
   not "passive," and a cold-start ETA is `estimating`, never `~0 min`.
3. **Counts re-derived from the live pool every iteration, never decremented** — and
   the error path must be *structurally* unable to touch them (the prior build's B2
   blocker wrote `pending = 0` on an errored sweep and overwrote the last good count;
   the cure was a second statement with no such clause in its SQL, and that shape
   should be copied, not re-reasoned).
4. **Red-proof discipline is the only gate.** DEC-F2 defers `team-qa`. This exact
   surface produced **eight** §9.3-family events in one prior pipeline, including a
   vacuous *repair* of a vacuous guard. Every guard observed red against a real
   mutation, restored byte-identical, the red recorded per-test — and **no DoD row
   ticked on an agent's self-report**. In that build every verification pass found
   something the previous pass had mis-claimed; plan for more than one.

### The process fix that matters as much as any of the above

**Do not intake Slice 3 until Slice 2's build has landed.** Two slices are now fully
planned with zero lines of code between them, and the cost of that has already been
paid once in this very run (a decision row written on a wrong premise about the
working tree). See §4.

---

## 7. Decisions ruled in this plan

These are `DECIDED-AUTO`, Sara-reversible, and must be transcribed into this folder's
`decisions.md` before the first line of build code (the parent effort's
cycle-breaker, retained).

### PM-1 — Coverage denominator: **"described" = fresh-or-immutable** (open point C) — DECIDED-AUTO

A stale-but-cached mutable unit counts as **NOT described**, for both the header's N
and the drain's target. Ratifying the architect's §5 ruling, on his argument, which
is architectural rather than preferential: under Slice 1's design a stale hit is
*literally a miss inside the composer*, so this is what the single home already
computes. Ruling the other way would force coverage to be derived from a **second**
classification that disagrees with the composer's own — §9.1 manufactured by a
semantics decision. It is also product-correct: coverage gates Slice 3's grouping,
and grouping must not synthesize over text known to describe a previous stage.

**Two consequences that must be written down, not left implied** — this is DEC-11's
wire/log divergence shape recurring one layer up, and an undocumented version *will*
be "fixed" into the wrong agreement by a later reader:

1. The header can read **"180 of 182 described" while all 182 units display text.**
   The 2 stale units are on the wire with old text plus a freshness marker.
   **Described ≠ displayed, by design.**
2. Copy discipline follows from that: the header and any gate tooltip say
   **"described"** (a current-state claim), never "generated" (a historical one).

### PM-2 — Open point D: **ship the coverage header + "prioritize now" only. The disabled Auto-group button does NOT ship in Slice 2.** — DECIDED-AUTO

**This overturns the brief's stated assumption**, and the run-plan explicitly named
this as the one live product judgment left unexamined when `intake-product-owner` was
skipped. As the assigned surrogate, my answer is no. Four reasons, the first of which
is decisive on its own:

1. **The scaffolding manufactures an overloaded state in the slice whose standing
   trap is §9.8 OVERLOADED-ABSENCE.** Below 100% coverage, a disabled button is
   honest ("disabled — 180 of 182 described, ~2 min remaining"). At 100% coverage —
   the state this slice exists to *reach*, and the only state in which the control
   has anything to say — it must either stay disabled (now lying about why) or enable
   and do nothing. "Disabled because coverage is incomplete" and "disabled because
   the feature does not exist yet" would render identically while meaning entirely
   different things, and the user cannot tell which. That is this entry's exact
   shape, at the UX layer, introduced by the change written to honor it. §9.8's own
   argument for itself is that the failure survives even in the cure; declining to
   prove it a fourth time.
2. **The request's wording describes the end state of Slices 2+3 together, not a
   Slice 2 deliverable.** "The group action is visibly disabled until coverage is
   100%" is a property *of the group action*. The action arrives in Slice 3.
   Shipping the gate before the thing it gates inverts the dependency.
3. **"Prioritize now" alone fully delivers this slice's value.** Acceptance signals
   1, 2, 3 and 5 are met without the button. Signal 4 is a Slice 3 criterion that
   Slice 2 fully *feeds* (see the binding condition below).
4. **It is the cheaper direction, not the more expensive one.** The button costs four
   locale files, a client registry copy at the CJS/Vite boundary (WATCH-E/WATCH-F's
   most common drift site — both triggers fire on any growth) and a snapshot
   baseline regeneration, for a control Slice 3 rewrites anyway. That is paying the
   known-highest-drift cost twice for a placeholder.

**Binding conditions on this ruling — without these it becomes a deferral that
degenerates into nothing, which is precisely what §9.4 warns about:**

- **`coverageSnapshot` MUST still carry a server-authored `complete` boolean** (per
  the architect's §4 shape). Slice 3's gate is then a pure read of one server field,
  not a client-side re-derivation of "is described === pool_size". This is
  non-negotiable and is the whole reason declining the button costs Slice 3 nothing.
- **Acceptance signal 4 is hereby restated as a Slice 3 acceptance criterion,
  verbatim**, and recorded in this plan so it cannot be lost between intakes:
  *"the group action is visibly disabled until coverage is 100%, showing the ETA and
  a 'prioritize now' action."* Slice 3's intake inherits it as an AC it did not
  author.
- **Sara reversible in one direction, cheaply:** if she wants to see the disabled
  control now, it is additive — one component, four locale keys, one snapshot
  regeneration. Say the word.

### PM-3 — Open point H: **OPEN-4 / `MAX_PROJECTS_PER_TICK` is CLOSED here as superseded-in-part. No second tuning mechanism. No shipped default moves.** — DECIDED-AUTO

The parent request's Constraints section mandates a reconciliation rather than a
duplication. Executing it:

**Closed:** the prior effort's **OPEN-4** and Slice 1's carried **OPEN-3** are both
closed by this row. They have been asked three times and answered zero times.

**The ruling, in four parts:**

1. **Priority drain is the product answer for on-demand coverage.** It is strictly
   better than global tuning for the case Sara actually cares about: it targets the
   one project she is looking at, it reports a measured ETA while it works, and it
   costs nothing for the other fourteen. Global tuning speeds up 15 projects to make
   1 arrive sooner, at ~2.7× the per-tick git-walk cost (WATCH-5) forever.
2. **`MAX_PROJECTS_PER_TICK` keeps its shipped default of 3 and its 10-minute
   cadence, unchanged, and stops being a pending decision.** After Slice 2 lands, the
   250-minute worst case describes *passive backfill of projects nobody is looking
   at* — background work with no user waiting on it. That number stops being a
   defect and becomes a spec. It should be documented as such and not tuned. Raising
   it to 8 post-Slice-2 would in fact be mildly **counterproductive**: more passive
   slots contend with the drain for the same single `running` overlap guard and
   multiply the per-tick git cost to improve a latency nobody experiences.
3. **No second tuning mechanism, explicitly.** Slice 2 introduces **no**
   `MAX_DRAIN_*` env-var family. The drain's iteration cap is a *safety bound*, not a
   tuning surface — a constant whose declaring comment cites the measured 182-unit
   pool it was sized against, per §9.8's own bounds rule. And the drain path must
   **not read `MAX_PROJECTS_PER_TICK` at all**: that knob governs passive rotation
   width only. Name this as a build obligation, because the obvious wrong way to
   "reconcile" is to make the drain honor the same knob, which would silently
   couple two mechanisms that answer different questions.
4. **One residual, recorded rather than hidden:** while a drain runs it occupies one
   of the three passive rotation slots, so a long drain slows passive backfill for
   its duration. Bounded by the iteration cap; measured expectation ~5 batches for a
   182-unit pool. **WATCH row, promotion trigger: passive rotation observed stalled
   for more than two consecutive ticks while a drain is active.**

**One operator note for Sara — not a decision, not blocking:** there is a window
between Slice 1 landing and Slice 2 landing during which Slice 1's one-time
regeneration burst (its WATCH-B) drains at passive speed with no way to prioritize
it. If that is visibly slow in those days, set `MAX_PROJECTS_PER_TICK=8` in your
`.env` for that window and drop it back afterwards. That is the last legitimate use
of the knob, it is temporary, it needs no code change, and nothing waits on your
answer.

### PM-4 — Acceptance criteria for this slice (the requester's own six signals, verbatim, as amended by PM-2)

1. Passive default is behavior-preserving: view-triggered fast path + slow rotation
   *"exactly as today — never eager-backfill all projects."*
2. An explicit coverage request flags the project in `value_summary_sweep_state`,
   jumps the rotation, and drains continuously to 100% coverage.
3. Coverage header per project: *"N of M described · ~X min remaining"*, ETA from
   `value_summary_generation_log`'s real per-batch durations — **"never a guess"**
   (cold start is the named `estimating` state; a rendered `~0 min` is a requirement
   violation, not a rounding choice).
4. **AMENDED by PM-2 — moves to Slice 3.** Slice 2's obligation is reduced to:
   *the server-authored coverage snapshot carries `complete`, and "prioritize now"
   exists as the coverage request's entry point.* The disabled group action itself
   becomes a Slice 3 acceptance criterion, restated verbatim in PM-2.
5. The OPEN-3 client WebSocket subscriber is wired: live coverage progress updates
   **in place** in an open tab.
6. A one-time haiku-vs-sonnet calibration on one real 40-unit batch is run **before**
   the tier decision, and a per-stage model env knob exists.

### PM-5 — Catalog notes are a build-phase task on the effort branch, not an edit now — DECIDED-AUTO

`PROJECT-CONTEXT.md` is tracked and clean, inside a checkout that is 6/2 diverged
with a large staged diff. Editing it now risks it being swept into the git
reconciliation of §6 step 1 — the same hazard Slice 1's DEC-10 avoided for the same
reason. The note is therefore written here verbatim and applied on the effort branch
as a DoD line. It belongs in the **"Planning notes for `team-intake` / `team-qa`"**
section, not in the numbered defect catalog: this is a process pattern, not a defect
class, and inventing a numbered entry for it would misrepresent what the catalog is.

> **Intake throughput can outrun build throughput, and the working tree pays for it
> (2026-08-05, `requests/2026-08-04-value-pool-grouping/`).** Slice 1 was intaken
> 2026-08-04 with six documents and zero lines of code; Slice 2 was intaken
> 2026-08-05 on top of it, also with zero lines of code, while the *previous*
> effort's merged work existed locally only as an unlabelled ~2,000-line staged diff
> on a `master` that was 6 ahead / 2 behind origin. The concrete cost landed inside
> the intake itself: Slice 2's `DEPENDENCY-F1` was written on the factually wrong
> premise that the staged diff was Slice 1's build, and was corrected only because
> two agents independently checked live git instead of reading the decision row. A
> working tree ambiguous enough to make a careful reader wrong is a project risk, not
> a housekeeping issue. **This is the known "capability ships with nothing recording
> it" thread (recorded 3x, adopted 0x) running in reverse — the record shipping with
> no capability.** Cheapest durable rule, and the only one this project has evidence
> of being able to adopt: **do not intake slice N+1 of a multi-slice request until
> slice N's build has landed.** The existing worktree/`ps`/`lsof` guidance stays
> necessary and is demonstrably not sufficient.

### PM-6 — Exclusions the specialists named that must become tracked rows, not prose — DECIDED-AUTO

Carried into `decisions.md` at build dispatch, per the architect's §9 and the
engineer's §3. Recorded here so none of them terminates in prose:

| Row | Item |
|---|---|
| DEC (WS) | `value_altitudes_updated` widens additively with `coverage`; **broadcast condition widens too** — broadcast on `generated > 0` **or** a change in `demand`/`complete`, or the terminal "now complete" transition is silent and the Slice 3 gate never enables without a remount. |
| WATCH | No `source='drain'` in the generation log (a third CHECK value is a §9.6 rebuild). Drain rows log as `'tick'`; they remain identifiable by project + tick window. Revisit only on real operational need. |
| WATCH | `requestedAltitudesRef`'s fetch-once semantics were designed for a world without live updates; Slice 2 ends that world. WS `unit_keys` must bypass the ref for exactly those keys. |
| WATCH | After tiering, `duration_ms` rows mix models and skew the ETA average. Acceptable v1. Promotion trigger: the ETA observed materially wrong. |
| DECISION NEEDED at build | **Starvation by a permanently-failing requested project** (engineer G1): a flagged project that can never reach 100% sorts first forever and burns LLM spawns each tick. The no-progress exit bounds each tick; an **expiry** (treat a request older than ~24h as passive, or clear-with-log on an `outcome='error'` sweep) is still needed. **Do not leave this to the implementer** — it is a policy choice with a user-visible consequence. |
| DEC | Probe mode (the mount-time `GET /coverage`) writes **no** generation-log row — logging probes would pollute the ETA's own input. Assert it. |

---

## 8. Open decisions for the user

All non-blocking. The build proceeds on the recommendations above unless Sara says
otherwise.

1. **The disabled Auto-group button (PM-2)** — the team is declining to ship it in
   Slice 2 and moving it to Slice 3, against the brief's own stated assumption. This
   is the one place we are deliberately narrowing what you described. Reversal is
   cheap and additive. **Say the word and it ships now.**
2. **OPEN-4 is closed, not carried (PM-3)** — you no longer owe anyone an answer
   about `MAX_PROJECTS_PER_TICK`. Shipped defaults do not move. The one remaining
   use is the temporary operator note in PM-3 for the window between Slice 1 and
   Slice 2 landing.
3. **Sequencing (§6)** — Slice 1 must be *built*, not just intaken, before Slice 2
   starts, and the git reconciliation comes before that. If you want Slice 2 sooner,
   the lever is dispatching Slice 1's build now, not reordering the slices.
4. **No Slice 3 intake until Slice 2's build lands (§4 / PM-5)** — recommended as a
   hard rule for the remainder of this request. This is the one process change asked
   for in this plan.
5. **OPEN-2 (carried, still PENDING you)** — validation project choice for the parent
   effort. Does not block. Recorded so it does not silently close.
6. **Calibration disposition (open point G)** — the team runs the side-by-side,
   attaches both outputs, records a recommendation as a `DECIDED-AUTO` row, and ships
   the per-stage default. Reversible by env var alone, no code change. Flag only if
   you want to read the two outputs yourself before the default is pinned.

---

## 9. Definition of Done additions owned by this plan

- [ ] Git reconciliation completed per §6 step 1, **after** a `ps` / `lsof`
      concurrent-session check; no build branch cut before it.
- [ ] **Slice 1 built and landed** before Slice 2's effort branch is cut
      (`DEPENDENCY-F1`, corrected).
- [ ] `decisions.md` carries PM-1..PM-6 plus the architect's and engineer's exclusion
      rows **before the first line of build code**.
- [ ] `coverageSnapshot` carries `complete`; no client-side computation of a percent,
      a remaining count, or an ETA anywhere in `PlanLedgerPanel.tsx`.
- [ ] Cross-consumer parity test exists **as a named file/case**, deep-equalling the
      route's `coverage` against the broadcast's `coverage` for one seeded DB state.
- [ ] Acceptance signal 4 recorded verbatim as an inherited Slice 3 acceptance
      criterion in the Slice 3 intake folder when it is opened.
- [ ] PM-5's `PROJECT-CONTEXT.md` planning note applied **on the effort branch**,
      under "Planning notes for `team-intake` / `team-qa`", not in the numbered
      catalog.
- [ ] Build carries the **`FAST — QA debt`** stamp naming `supporting/qa.md`'s
      DEFERRED list, so a later `team-status` pass recommends the follow-up
      `team-qa` run.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0;
      `npm run test:server` and `npm run test:client` green.
