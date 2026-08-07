# Run Plan — team-intake (direct mode, FAST)

**Request:** AI-generated stakeholder summary card for session transcripts
**Director call date:** 2026-08-06
**Mode:** `direct` + `fast`
**Outcome in one line:** full evaluator roster kept, mandates narrowed — the
fast-mode inversion is overridden by a bullseye defect-catalog match.

---

## 1. Scope read

This is a substantial three-layer feature, not a trim: a **new server-side
LLM-synthesis layer** (modeled on `server/lib/value-summary.js` +
`value-summary-tick.js`, reusing `runClaudePromptJson` from
`focus-inference.js`), a **new DB cache table** in `server/db.js` (confirmed
gap — no existing `sessions` column holds this), and a **new client card**
mounted in `SessionDetail.tsx` above `ConversationView`. Blast radius crosses
three real boundaries: a new persisted schema object, a new server→client wire
contract for the summary's state, and a new consumer of the shared
CLI-spawn LLM path. The brief is unusually pre-digested (it names exact files
and line ranges) and carries **no blocking open questions** — but it also
explicitly states intake did *not* re-verify its own citations, and it leaves
three genuine design decisions open (trigger model, staleness/invalidation,
model tier) plus zero formal acceptance criteria. Two defect classes are named
by the brief as binding, and I verified both against `PROJECT-CONTEXT.md`
directly rather than trusting the paraphrase: **§9.1 DERIVED-DUAL-VIEW** is
real and currently stands at **count 7** (the brief's "7+" is accurate), and
**§9.8 OVERLOADED-ABSENCE** is real at line 1645. The §9.8 match is not
adjacent — it is a direct hit, and it is the single most important fact in this
scope read (see §4).

---

## 2. Agents to run

Ordered. `intake-project-manager` runs as always (classification/PM plan) and
is outside this decision.

1. **`intake-product-owner`** — Fast still wants to confirm we're building the
   right thing, and here that is genuinely unsettled. The brief records **no
   formal acceptance criteria** ("None stated as formal 'done when' criteria"),
   only a behavioral paraphrase. It also carries a scope assumption that is
   explicitly flagged as possibly wrong — open question #1, where Sara's
   "individual person's card > Sessions" framing **matches no existing concept
   in the codebase**. The brief defers that confirmation to "before
   implementation, not before evaluation," which makes it precisely this
   agent's item to land now. Direction-load-bearing.
   *Narrowed for fast:* nail acceptance criteria + confirm the surface
   assumption. Skip exhaustive value/prioritization framing.

2. **`intake-architect`** — Maximally load-bearing. Three of the four
   non-blocking open questions are architecture decisions the brief explicitly
   refuses to let anyone assume silently: **trigger model** (on-demand vs.
   `value-summary-tick`-style background sweep), **staleness/invalidation** for
   a cache with no existing column, and **model tier**. Add a new DB table and
   a new wire contract and there is no reading of "fast" under which this is
   skippable.
   *Narrowed for fast:* decide the three open questions and the §9.8 wire
   contract shape. Skip broad alternatives surveys on settled constraints
   (the `runClaudePromptJson` reuse mandate is binding, not an open option).

3. **`intake-engineer`** — The closest call on this roster, kept for one
   specific reason: **the entire plan is a reuse-of-precedent bet, and the
   brief states on its face that intake did not verify the precedent.** It
   cites `value-summary.js`, `value-summary-tick.js`, `focus-inference.js`,
   `PlanLedgerPanel.tsx` ~433–458, and `db.js` ~835–860 as load-bearing shapes
   while saying re-verification "is evaluation/architecture's job." If
   `runClaudePromptJson` is not reusable as claimed, the approach changes at
   the root — that is a *direction* question, not an implementation detail.
   *Narrowed for fast:* verify the cited precedent files/ranges are real and
   shaped as claimed, and confirm reuse feasibility. Do **not** produce an
   exhaustive line-by-line change set; leave that to build.

4. **`intake-qa`** — **Forced on by defect-catalog match.** Fast mode would
   normally drop this. It does not get to here; see §4 for the full argument.
   *Narrowed for fast:* scope to the two catalog guardrails and their stated
   acceptance criteria **only** — §9.1's cross-consumer criterion and §9.8's
   discriminated-state criterion. Full regression/test-suite planning stays
   deferred to the follow-up QA pass, consistent with fast.

5. **`intake-tech-lead`** — Always required; runs last; synthesizes
   architect + engineer + qa into `technical-plan.md`. Receives all three of
   its normal inputs this run, so no graceful degradation needed.

---

## 3. Agents skipped

**None.** That is an unusual direct-mode result and I want to be explicit that
it is a considered call, not a failure to cut. Direct mode is scope-sizing, and
the honest size here is large: three layers, a new schema object, a new wire
contract, and a catalog bullseye. What fast buys on this run is delivered as
**narrowed mandates per agent** (above) rather than dropped agents — that is
the real dividend, and it is where the time comes back.

---

## 4. Forced back on

**`intake-qa` — §9.8 OVERLOADED-ABSENCE, and it is a direct hit, not an
adjacency.**

My instructions carve out exactly one rule that fast does not bend: a
defect-catalog match forces the guardrail back on. This is the case that carve-out
exists for, and the evidence is unusually strong:

- **§9.8's live evidence #1 *is* `server/lib/value-summary.js`** — the exact
  file this brief instructs the build to model the new synthesis layer on. We
  are being told to copy from the catalog's own canonical defect instance.
- **§9.8 names the copying itself as the mechanism.** Verbatim: *"the
  bounded/never-throwing contract is copied from a sibling that solved the same
  problem more completely, and the half that made the sibling honest is
  dropped."* That is a literal description of this request's plan of record.
- **§9.8 was promoted to a numbered entry by `team-qa`'s `qa-strategist`**,
  during `intake/2026-08-04-value-summary-tick/` — the intake for the very
  sibling feature being cloned here. The QA angle is the one that has
  historically caught this shape on this exact code.
- **The pattern already recurred once inside its own cure.** §9.8 records that
  the build written to fix instances #1 and #2 introduced two *new* collapsing
  surfaces (Trap E on `AltitudeText` — the precedent this brief names for the
  client card — and Trap C on `pending_after_sweep`). Copying this lineage
  without a QA pass is how it lands an eighth time.

**§9.1 DERIVED-DUAL-VIEW reinforces the same call.** Its acceptance criterion is
inherently test-shaped — *"enforced by a cross-consumer test — not eyeballing
two UIs"* — and its own QA-pass note diagnoses the systemic cause as *"test
scope is per-module, not per-shape... the cross-consumer test is nobody's file
and does not get written."* The failure mode of §9.1 is, almost word for word,
"nobody owned the test." Skipping the QA agent on a §9.1-matched change would
be re-enacting the entry's own documented cause. §9.1 also warns that the
failure lands **when consumer #2 appears, not at introduction**, which is
exactly the Board-card-badge scenario the brief pre-flags — so the shared
extraction has to be decided now, on day one, not deferred.

**Not overrides, but noted as reinforcing the no-skip call:**
- **Cross-boundary change.** A new DB table plus a new server→client wire
  contract is a real boundary with more than one dependant; the general rule
  ("never QA-skippable just because it's small") applies independently of the
  catalog.
- **Unresolved scope assumption.** Open question #1's surface mismatch is
  resolved by nothing currently in hand and is assumption-only.

**Deferred-QA debt to stamp at build (per fast-mode convention):** full
regression and test-suite design beyond the two catalog criteria above is
intentionally not covered this pass, and the build stage should carry that
debt forward.
