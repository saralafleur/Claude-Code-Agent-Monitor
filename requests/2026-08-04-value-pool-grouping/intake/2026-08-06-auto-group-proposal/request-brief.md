# Request Brief — Value Pool Slice 3: Auto-group proposal engine

**Intake date:** 2026-08-06
**Output dir:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/`
**Source doc:** `requests/2026-08-04-value-pool-grouping/request.md`, "### Slice 3 — Auto-group proposal engine" (lines 61-74)

## Raw ask (verbatim, from request.md)

> - **Mechanical pre-grouping first** (free, deterministic, auditable):
>   trunk commits referencing an initiative slug, time-adjacency clusters,
>   shared surfaces.
> - **LLM refinement second**: one sonnet call over the pre-groups + the
>   units' already-generated (cheap) PROJECT/STAKEHOLDER texts → proposed
>   named groups, each with a stakeholder-level summary sentence, member
>   unitKeys, and a rationale. Hierarchical (like focus-summary's
>   day→window rollup) if the pool exceeds one prompt's worth.
> - **Groups are proposals, never actions** — new `value_groups` table,
>   rendered for review/approval. Preserves the ledger's standing principle
>   (correlational tier suggests, never auto-claims).
> - Requires 100% altitude coverage for the target project (Slice 2's
>   coverage request is the gate).

Also carried from the parent request's top-level framing (Sara's own words,
verbal, 2026-08-04):

> "Once every value-pool unit has its generated PROJECT/STAKEHOLDER text, she
> wants to **auto-group** the pool in a fashion appropriate to the solution,
> then act on a group as a unit… Generation cost/scale must be handled well
> at ~200-unit pools, and the UX must always tell the user what's happening,
> how long it will take, and when something they saw before has changed."

And the parent request's "Constraints / carry-forwards" section (applies to
all four slices, quoted verbatim, not paraphrased):

> - Reuse, never re-derive: `assembleValuePool` stays the sole pool composer
>   (DEC-16 / `CONSUMERS` registry); the single-writer guards on
>   `value_unit_summaries` writes must widen deliberately if a new writer
>   appears (WATCH-6 pattern).
> - §9.8 OVERLOADED-ABSENCE is the standing trap for this whole surface:
>   every new "absent from a map" state (a group with no members resolved, a
>   stale-but-not-yet-regenerated unit) must be a named, distinguishable
>   state, never a silent absence.
> - OPEN-4 (env tune `MAX_PROJECTS_PER_TICK`) is still undecided by Sara —
>   Slice 2's coverage-request mechanism partially obsoletes it (priority
>   drain beats global tuning for the case she cares about); reconcile
>   rather than duplicate.
> - Slices ship independently, in order, each through the full
>   team-intake → team-qa → team-build pipeline on its own effort branch.

## Restated ask

Build a two-stage grouping engine over a project's Value Pool: first a free,
deterministic mechanical pre-grouping pass (initiative-slug references,
time-adjacency, shared surfaces), then one sonnet call that refines the
pre-groups (using the units' already-generated PROJECT/STAKEHOLDER text)
into named groups with a summary sentence, member unitKeys, and a rationale
— persisted as **proposals** in a new `value_groups` table for human
review/approval, never auto-claimed. Available only once a project's
altitude coverage is 100% (gated by Slice 2's coverage mechanism), and must
decompose hierarchically if the pool exceeds one prompt's worth, mirroring
`focus-summary`'s day→window rollup shape.

## Requester / source

Sara, verbal, 2026-08-04 (same session that shipped `value-summary-tick`,
merged `55fe900`) — recorded in `request.md`. This is slice 3 of a 4-slice
sequenced request; slices 1 and 2 have since shipped (verified live below).

## Surface / area touched

Value Pool grouping/synthesis layer: a new `server/lib/value-groups.js` (or
equivalent) composing pre-groups from `assembleValuePool`'s output, a new
sonnet call site alongside the existing per-unit synthesis in
`server/lib/value-summary.js`, a new `value_groups` table in `server/db.js`,
a new route surface under `server/routes/project-plans.js` (or a sibling
route file) for proposing/listing/reviewing groups, and a client-side
review/approval UI (new panel or extension of `PlanLedgerPanel`). Gated by
`server/lib/value-coverage.js`'s `complete` field for the target project.

## Known-variant relevance (PROJECT-CONTEXT.md §9)

This surface is this project's single highest-density recurring-defect
zone (three consecutive Value Pool builds — value-summary-tick,
altitude-invalidation, coverage-on-demand — logged 9, 9, and 4 §9.3-family
events respectively). Directly relevant entries for a new `value_groups`
table + new synthesis call:

- **§9.1 DERIVED-DUAL-VIEW** — if the group proposal (or its summary
  sentence / coverage-of-members) is rendered in more than one client
  surface, it must be computed once and shared, not hand-copied. Watch
  specifically for the "rogue re-derivation" sub-form (§9.1's 2026-08-02/03
  notes): a second copy of the grouping-membership or rollup formula is as
  dangerous as a second raw read.
- **§9.3 VACUOUS-GUARD**, including the "the guard is the vacuity" and
  "PARITY-WITHOUT-ANCHOR" sub-patterns from the last two Value Pool builds
  — any MANDATORY structural guard or parity test this slice's technical
  plan calls for must be red-proven by mutation, not merely reported green.
  Given this file family's density (9/9/4 events across the prior three
  builds), the run-plan should budget for an adversarial review pass
  independent of the build/verify passes, as the prior two slices did.
- **§9.5/§9.6 schema conventions** — `value_groups` is a **brand-new**
  table, so this can and should be built as a plain `CREATE TABLE IF NOT
  EXISTS` with no `CHECK`-widening rebuild needed at introduction (the
  "prefer inapplicability over compliance" principle §9.6 states explicitly
  — a new table needs zero `ALTER`/rebuild). If a later fix-round needs a
  `CHECK` on `value_groups` (e.g. a status enum), route it through the
  existing `rebuildTableAtomically` helper rather than hand-rolling.
- **§9.7 registry/CONSUMERS hygiene** — if the grouping engine adds a new
  consumer of `assembleValuePool`'s output, add it to the existing
  `CONSUMERS` registry in `server/lib/value-ledger.js` rather than a fresh
  ad hoc scan.
- **§9.8 OVERLOADED-ABSENCE** — named explicitly in the parent request's own
  Constraints section as "the standing trap for this whole surface." A
  group with **no members resolved** (e.g. every candidate unit filtered
  out, or the LLM refinement pass fails/times out) must be a distinguishable,
  named state — never silently absent from whatever list/map the UI reads.
  Given this entry's own acceptance criterion ("never zero," "any single
  number reported as progress must be re-derived from the live input each
  round"), the technical plan must state explicitly how a zero-member
  proposal, a not-yet-attempted grouping pass, and a failed grouping pass
  are each represented distinctly on the wire.

## Provisional request type

**new-feature** (PROVISIONAL — PM makes the final call). This is net-new
capability (a proposal-generation engine + a new table), not a bug fix,
regression, or content change.

## Attachments / evidence

None beyond the request doc itself — no screenshots, no example
expected-vs-actual output. This is a from-scratch design ask, not a
defect report.

## Explicit acceptance signals ("done when…")

The request doc does not state an explicit "done when" checklist for Slice
3 the way it did for Slice 2 (which had a numbered acceptance-signal list
elsewhere in the working session). Extracted from the prose, the implicit
acceptance signals are:
1. Mechanical pre-grouping runs deterministically with no LLM call, over
   trunk-commit-slug references, time-adjacency, and shared surfaces.
2. Exactly one sonnet call (per grouping run, or per hierarchical rollup
   node) refines pre-groups into named groups with: a name, a
   stakeholder-level summary sentence, member `unitKey`s, and a rationale.
3. Hierarchical decomposition exists and is exercised when the pool exceeds
   one prompt's worth (parallel to focus-summary's day→window rollup).
4. Proposals persist to a new `value_groups` table and are rendered for
   human review/approval; nothing is auto-claimed into a plan item.
5. The grouping action is unavailable (or the request is rejected/queued)
   until the target project's altitude coverage is 100%, per Slice 2's
   `coverageSnapshot.complete`.

These are reasonable extractions, not requester-stated pass/fail criteria —
flagged as an assumption, not a verified acceptance signal.

## Live verification performed (2026-08-06) — corrects the request doc's stale premises

The request doc's own prose was written 2026-08-04, before Slices 1-2 shipped and
before Slice 2's own open items closed. Per the task instruction, nothing
below was trusted from the doc without a direct check against the current
repo state:

1. **Slices 1 and 2 are both merged to `master`.** `git log --oneline` on
   master shows, in order: `b38b4a1` (Slice 1, mutability-aware caching +
   invalidation), `4c2e931` (Slice 2, coverage-on-demand), `5ec640b` (QA-fix
   commit closing team-qa findings on Slice 2), `b0e3157` (doc sync), and
   `c233a36` (AC-6 closure — see #3 below). Confirmed live, not assumed.
2. **The 100%-coverage gate is real and reachable today.**
   `server/lib/value-coverage.js` computes `complete = pending === 0` (line
   134) and returns it as part of its `coverageSnapshot` shape (documented
   at line 123: `complete: boolean`). This is the literal field Slice 3's
   gate needs, and it ships in the merged Slice 2 code — not a stub, not a
   future promise.
3. **Model tiering (AC-6) is closed, not open.** `.env.example` documents
   `DASHBOARD_VALUE_SUMMARY_UNIT_MODEL` and
   `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL` (lines 137-138) as the two
   per-stage overrides. `requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/decisions.md`
   DEC-10 (resolved 2026-08-06) records a real 40-unit calibration run
   (this repo's own live pool, 102 real units, 40 used) comparing haiku vs.
   sonnet; sonnet was chosen for **both** stages because it showed real
   cross-unit relational reasoning ("paired with its merge (unit 4)") that
   haiku's output lacked entirely, and haiku additionally failed a 120s
   timeout on its first attempt. **Slice 3's technical plan should consume
   the existing `"grouping"` stage of the already-built `summaryModel(stage)`
   cascade and the pinned `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL=sonnet`
   default — it is not starting model-tiering work from scratch, and should
   not re-run its own calibration.**
4. **`value_groups` does not exist yet.** `grep -n "value_groups"
   server/db.js` returns nothing — this is genuinely new schema surface for
   Slice 3 to introduce, confirming the "new `value_groups` table" framing
   in the request doc is still accurate (not something a prior slice
   already partially built).
5. **`assembleValuePool` is confirmed the sole pool composer**, defined once
   in `server/lib/value-ledger.js:143`, with an existing `CONSUMERS`
   registry in the same file (line 70) that Slice 3 should extend rather
   than duplicate.
6. **A live open item on the coverage-composition code Slice 3 will become
   the third consumer of:** PROJECT-CONTEXT.md's post-merge QA note on
   `intake/2026-08-05-coverage-on-demand/` (dated 2026-08-05) records
   **WATCH SF-4**: the 4-step probe composition (assemble →
   `enrichPoolAltitudes({probe:true})` → sweep-state read →
   `coverageSnapshot`) is written **twice**, once per route handler
   (`POST /coverage-request` and `GET /coverage` in
   `server/routes/project-plans.js`), and the two copies have **already
   diverged once** on `requestedAt` — with a route↔route parity guard
   recommended but not yet built. The note explicitly recommends
   extracting a shared `buildProbeCoverage` **"when Slice 3's consumer
   lands."** Confirmed live: both route handlers still exist independently
   in `server/routes/project-plans.js` today. This is not a blocker for
   Slice 3 (it's a known, already-logged risk with a stated fix trigger),
   but it is a concrete, non-speculative technical-plan input: Slice 3's
   own read of coverage state is the trigger condition SF-4 was written to
   anticipate, so the technical plan should either extract
   `buildProbeCoverage` as part of this slice or explicitly defer it with a
   dated reason, not silently add a third hand-copy.
7. **OPEN-4 (`MAX_PROJECTS_PER_TICK`) is still Sara-undecided** —
   confirmed live: the env var and its default (3) are unchanged in
   `server/lib/value-summary-tick.js`, no new decision row resolves it.
   Per the parent request's own instruction, Slice 3 should not need to
   touch this at all — its coverage need is per-project, on-demand, and
   already served by Slice 2's coverage-request priority-drain mechanism,
   not by global tick tuning. Flagged as a non-blocking assumption below.

## Open questions

### BLOCKING
None found. Every premise the request doc depends on for Slice 3 to be
buildable — the coverage gate, the model-tiering knob, `assembleValuePool`
as sole composer, `value_groups` being genuinely new/unclaimed schema
space — checks out against the live repo state as of 2026-08-06.

### Non-blocking (proceed with stated assumption; PM/architect to confirm or override)
1. **Pre-grouping heuristics' exact shape** (what counts as a "shared
   surface," how wide a "time-adjacency" window is) is unspecified in the
   request doc beyond naming the three signal types. Assumption: this is
   exactly the kind of design decision the architect/engineer stages exist
   to resolve, not a triage blocker — flagged for the technical plan, not
   for the PM.
2. **Hierarchical rollup shape** (how a >1-prompt pool's groups compose
   across the LLM refinement calls) is named by analogy to focus-summary's
   day→window rollup but not specified further. Same disposition as #1 —
   architect's job.
3. **`value_groups` schema shape** (columns, whether membership is a join
   table vs. a JSON array of unitKeys, status/lifecycle enum for
   proposed→reviewed→claimed-or-dismissed) is undefined. Assumption: this
   is standard technical-plan scope, not a triage blocker, **provided** the
   technical plan explicitly names each field's discriminated states per
   §9.8 (see Known-variant relevance above) rather than deferring that to a
   later fix-round.
4. **SF-4 route-duplication (coverage composition)**: assumption stated in
   verification item #6 above — Slice 3's technical plan should address
   extraction or explicitly defer it with a dated reason; not treated as
   blocking triage because it's an already-logged, already-scoped risk with
   a known fix, not a new unknown.
5. **OPEN-4 (`MAX_PROJECTS_PER_TICK`)**: assumption per verification item
   #7 — Slice 3 does not need to touch this env var; if the architect finds
   a genuine need to, it must reconcile with Slice 2's coverage-request
   mechanism rather than introduce a second tuning knob for the same
   problem, per the parent request's explicit instruction.
6. **Single-writer guard widening (WATCH-6 pattern)**: the parent
   request's constraint applies to `value_unit_summaries` writers
   specifically. Assumption: Slice 3's LLM refinement call reads units'
   already-generated text but does not need to *write* to
   `value_unit_summaries` — it writes only to the new `value_groups` table,
   so the existing single-writer guard should not need widening. Flagged
   for the architect to confirm; if the grouping engine turns out to need
   to write back to `value_unit_summaries` for any reason, the guard must
   widen deliberately per WATCH-6, not silently gain a second call site.
