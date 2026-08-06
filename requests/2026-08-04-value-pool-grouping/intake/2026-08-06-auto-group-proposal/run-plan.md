# Run Plan — director-of-engineering (direct mode, NOT fast)

**Intake:** `2026-08-06-auto-group-proposal` (Value Pool Slice 3)
**Skill:** `team-intake` · **Mode:** direct (standard, **not** fast)
**Triage verdict:** READY (already run; `request-brief.md` written, with dated
live verification of all seven premises)
**Decided:** 2026-08-06

---

## 1. Scope read

Slice 3 is the **largest and least-specified** of the four slices, and the only
one that introduces a genuinely new persisted concept rather than extending an
existing one. It adds: a new `value_groups` table (confirmed absent from
`server/db.js` today — the first new grouping noun in this codebase); a
deterministic mechanical pre-grouping pass over three named-but-unspecified
signal types (initiative-slug references, time-adjacency, shared surfaces); a
**second sonnet call site** with semantics materially different from the
existing per-unit synthesis — cross-unit judgment over a variable-size
pre-group, with hierarchical decomposition when the pool exceeds one prompt;
a third consumer of `assembleValuePool` (via the `CONSUMERS` registry in
`server/lib/value-ledger.js`); a new route surface; and client-side
review/approval UI for a principle — "proposals, never actions" — that has no
existing implementation to copy. Blast radius spans schema, the synthesis
layer, the pool-composer seam, an HTTP route surface, and the client.

Two things make this *more* than a big feature. First, it lands on this
project's **single highest-density recurring-defect zone**: the same file
family logged 9, 9, and 4 §9.3-family events across the three prior Value Pool
builds, and the parent request names §9.8 OVERLOADED-ABSENCE, in its own words,
"the standing trap for this whole surface." Second, it inherits a **live,
already-logged, not-yet-fixed trap with a fix trigger that fires on precisely
this slice**: WATCH SF-4's 4-step probe-coverage composition is hand-written
twice in `server/routes/project-plans.js`, the two copies have already diverged
once on `requestedAt`, and the standing note says extract `buildProbeCoverage`
"when Slice 3's consumer lands." Slice 3 *is* that consumer.

Against that, the brief's six non-blocking open questions are unusually
design-heavy — three of them (pre-grouping heuristics, hierarchical rollup
shape, WATCH-6 guard-widening) are explicitly assigned by triage to the
architect, and a fourth (`value_groups` schema shape) is assigned to the
technical plan *conditional on* naming every field's discriminated states per
§9.8. This is not a run where formality can be traded for speed by dropping
angles; the leanness direct mode buys here is **inside** each agent's scope
(tight, named remits below), not in the roster.

**Verdict: all four discretionary evaluators run.** That is not a blanket
"keep everything" — §3 records the one genuine skip and §2 records which call
was closest, and why it still went the other way.

## 2. Agents to run

Order preserves the skill's own dependency chain, matching the prior two
slices: evaluators (parallel) → PM → tech-lead. Three waves.

### Wave 1 — parallel fan-out (one message, four tool calls)

1. **`intake-architect`** → `supporting/architect.md`
   The heaviest genuinely-undecided design load of any slice so far, and triage
   assigned it three open questions by name. Must rule: (a) the **two-stage
   seam** — what the mechanical pre-grouping pass emits, and what contract the
   LLM refinement consumes, such that the deterministic half stays independently
   auditable and testable without an LLM (this is the property that makes the
   whole engine reviewable); (b) the **hierarchical rollup shape** — the request
   names `focus-summary`'s day→window rollup only by analogy, and §9.8's own
   case study is that `value-summary.js` copied `focus-summary`'s cap and
   dropped both the decomposition *and* the disclosure that made it honest, so
   the architect must state explicitly what the group-level analogue of
   "decompose, don't drop" and "disclose what was dropped" is here; (c) the
   **pre-grouping heuristics' shape** — what counts as a "shared surface," how
   wide time-adjacency runs, and whether these are tunable or fixed; (d)
   **confirm or overturn open question #6** — that the grouping engine writes
   only to `value_groups` and never to `value_unit_summaries`, so the WATCH-6
   single-writer guard does not widen; if it *does* need to write back, the
   guard widens deliberately in the same change, never by silently gaining a
   call site; (e) the §9.1 **single-home ruling** — the group's summary
   sentence, member set, and any coverage-of-members rollup are computed once
   server-side, watching specifically for §9.1's "rogue re-derivation" sub-form
   (a second copy of the *membership or rollup formula* is as dangerous as a
   second raw read). Consume the already-built `summaryModel("grouping")`
   cascade and the pinned `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL=sonnet`
   default — model tiering is **closed** (DEC-10); do not re-run calibration.
   Do not touch `MAX_PROJECTS_PER_TICK` (OPEN-4) unless a real need appears, in
   which case reconcile with Slice 2's coverage-request mechanism rather than
   adding a second tuning knob.

2. **`intake-engineer`** → `supporting/engineer.md`
   *This was the closest keep/skip call of the run* — on a smaller slice the
   architect could plausibly absorb the mechanics. It stays on because three
   concrete, non-speculative mechanics items here are below architecture
   altitude and each has a catalog or WATCH row attached: (a) the **exact
   `value_groups` schema** — columns, membership as join table vs. JSON
   `unitKey` array, and the proposed→reviewed→claimed/dismissed lifecycle;
   per §9.6's "prefer inapplicability over compliance," a brand-new table is a
   plain `CREATE TABLE IF NOT EXISTS` needing **zero** `ALTER`/rebuild at
   introduction, and if a later fix-round wants a `CHECK` (e.g. a status enum)
   it routes through the existing `rebuildTableAtomically` helper rather than
   hand-rolling; (b) **SF-4** — Slice 3's coverage read is the exact trigger
   condition that WATCH was written to anticipate, so the engineer must either
   extract the shared `buildProbeCoverage` as part of this slice or explicitly
   defer it with a dated reason; **silently adding a third hand-copy of the
   4-step composition is not an option**; (c) **§9.7 registry hygiene** — the
   new consumer registers in the existing `CONSUMERS` registry in
   `server/lib/value-ledger.js`, never a fresh ad hoc scan; plus §9.2 ordering
   discipline on any new time-ordered read (the static `chronology-ordering`
   scan covers `server/db.js` and `server/lib/*`), and the mandated file header
   on every new/edited `.js/.ts/.tsx`.

3. **`intake-product-owner`** → `supporting/product-owner.md`
   Kept, and the case is stronger here than on either prior slice — three
   independent reasons. First, **this slice has no requester-stated acceptance
   criteria at all**: the brief's five "done when" signals are explicitly
   flagged as the triage agent's own extraction from prose, "not verified
   acceptance signals." That gap is exactly what this agent closes, and it is
   the reason the prior slice's skip rationale (acceptance criteria already
   existed verbatim, §8) **does not transfer**. Second, **"proposals, never
   actions" is a product principle with no existing implementation** — it needs
   a concrete answer to what a reviewable proposal looks like, what
   approve/dismiss/edit-membership afford, and what stops an approved group
   from feeling like an auto-claim; this preserves the ledger's standing
   correlational-tier principle and is not an engineering detail. Third,
   Slice 2's run-plan **explicitly deferred an angle into this intake**:
   nobody pressure-tested whether the disabled auto-group gate was worth
   shipping ahead of the action it gates, with the note "revisit if the Slice 3
   intake … finds the gate confusing in practice." Slice 3 ships that action —
   this is where that debt comes due. Also owns Sara's standing UX constraint
   ("always tell the user what's happening, how long it will take, and when
   something they saw before has changed") as it applies to a grouping run over
   a ~200-unit pool.

4. **`intake-qa`** → `supporting/qa.md` — **FORCED ON** (see §4)
   Scope: the **MANDATORY catalog-guardrail checklist the build must carry**,
   written down *before* this surface gains a new consumer. Required content:
   - **§9.8 OVERLOADED-ABSENCE** — the wire representation must distinguish, as
     named server-authored states, at minimum: *not-yet-attempted* grouping,
     *in-progress*, *completed-with-zero-member-proposal* (every candidate unit
     filtered out), and *failed/timed-out refinement*. Four outcomes, four wire
     values — never one silent absence, never a client-side heuristic
     reconstructed from what's missing. Per this entry's own corollary, any new
     bound on a user-visible collection must cite in its declaring comment the
     measured real distribution it was sized against (the live pool is ~102
     units today, 182 recorded historically — a comment forced to name the
     number cannot be written carelessly).
   - **§9.3 VACUOUS-GUARD**, incl. the "the guard is the vacuity" and
     PARITY-WITHOUT-ANCHOR sub-patterns — every guard this plan mandates must
     be **red-proven by mutation**, red state recorded; a guard with no recorded
     red state is not a guard. Any parity assertion must be anchored to a
     concrete expected value, not just to the two sides agreeing. Sweep
     `assert.ok(true` / `|| true` to 0 before done.
   - **Budget an adversarial review pass independent of build/verify**, as both
     prior slices did — justified by the 9/9/4 event density on this exact
     file family.
   - **§9.1** — a cross-consumer parity assertion if the group summary or
     member rollup reaches more than one client surface.
   - **§9.7 / DEC-16** — a guard that the new consumer is registered in
     `CONSUMERS`, and (if SF-4 is extracted) a route↔route parity guard on the
     shared coverage composition.
   This is a build-time obligation checklist, not a full test plan; the
   `team-qa` stage still runs on its own after this intake.

### Wave 2 — after all of Wave 1 returns

5. **`intake-project-manager`** → `pm-plan.md` (+ PM memory / request-log,
   defect-catalog touch counts)
   Non-skippable: owns the plan the human reviews and the final request-type
   call (triage's `new-feature` is PROVISIONAL). For this slice: confirm
   `new-feature`; record the §9 catalog hits against their entries' touch
   counts, applying §9.8's own rule that **re-encountering a known instance is
   not a new occurrence** — count only genuinely new duplications; carry the
   SF-4 disposition (extract now vs. dated defer) as a named decision row; and
   record that model tiering (DEC-10) and the coverage gate
   (`coverageSnapshot.complete`) are **closed inputs**, not open work, so the
   plan does not re-open them.

### Wave 3 — last

6. **`intake-tech-lead`** → `technical-plan.md`
   Non-skippable synthesizer: the one coherent doc `team-build` and
   `team-status` read. Reads the brief + all four supporting docs + the PM's
   classification. Must land the §9.8 discriminated-state enumeration **inline
   as a build obligation** (open question #3 makes the schema shape acceptable
   as technical-plan scope *only on condition* that each field's discriminated
   states are named here rather than deferred to a fix-round), and must state
   the SF-4 disposition explicitly.

## 3. Agents skipped

- **`intake-client-liaison`** — on-demand only, and there is no client ask on
  this work. Sara is the project owner and the requester, in-session, and the
  triage pass found **zero blocking questions** — every premise the slice
  depends on was verified live against the repo on 2026-08-06. Nothing needs
  to be taken back to a requester before work starts.

No discretionary evaluator is skipped. Each of the four owns at least one open
question or catalog obligation that no other agent in the roster is positioned
to answer, enumerated per-agent in §2.

## 4. Forced back on

- **`intake-qa` — forced on by defect-catalog match, and it is not close.**
  Even if I had judged QA skippable on scope alone (I did not), the rule that a
  catalog match forces the guardrail back on would override it. The match here
  is the densest on record for this project: §9.3-family events at 9/9/4 across
  the three prior builds of this exact file family, §9.8 named by the *parent
  request itself* as the standing trap for the whole surface, plus §9.1, §9.5/
  §9.6, and §9.7 all directly implicated by a new table + new consumer + new
  synthesis call. Direct mode buys speed on formality, never a quiet guardrail
  drop — and a new consumer landing on the project's worst recurring-defect
  surface is the precise moment the guardrail exists for.
- **Cross-boundary work independently keeps architect + engineer on.** The
  `assembleValuePool` sole-composer seam (DEC-16 / `CONSUMERS`), the
  `value_unit_summaries` single-writer guard set (WATCH-6), and the
  route-shared coverage composition (SF-4) are each contracts with more than
  one caller. Two of the three already have a documented divergence or a
  standing widening rule attached.
- **An inherited, trigger-fired WATCH keeps the engineer specifically on.**
  SF-4's stated fix trigger — "extract when Slice 3's consumer lands" — fires
  on this slice by name. Running without the agent that owns that mechanic
  would risk landing the third hand-copy the WATCH was written to prevent.
- **The absence of stated acceptance criteria keeps the product-owner on.**
  This is the first slice whose "done when" list is an intake extraction rather
  than the requester's own words, and it carries a deferred UX question handed
  forward explicitly from Slice 2's run-plan.
- **Nothing else is forced on by ambiguity.** Triage recorded zero blocking
  questions; all six non-blocking points ship with a workable stated assumption
  and are assigned above to a named agent for a decision row.
