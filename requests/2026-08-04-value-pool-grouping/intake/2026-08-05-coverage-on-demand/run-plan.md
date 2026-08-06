# Run Plan — director-of-engineering (direct mode, FAST)

**Intake:** `2026-08-05-coverage-on-demand` (Value Pool Slice 2)
**Skill:** `team-intake` · **Mode:** fast (auto-pilot + direct)
**Triage verdict:** READY (already run; `request-brief.md` written)
**Decided:** 2026-08-05

> **Post-hoc correction (see `decisions.md` DEPENDENCY-F1):** every
> `DEPENDENCY-F1` reference below was written on the triage-time premise that
> the uncommitted main-checkout diff was Slice 1's build. That premise is
> wrong — it's the prior, already-merged `value-summary-tick` effort. Slice 1
> has zero build code anywhere. The roster/order decisions below are
> unaffected; only the environment claim is corrected.

---

## 1. Scope read

Slice 2 is a **real, multi-subsystem feature slice, not a small change**. It
adds a second demand level to the altitude sweep (a coverage-request flag that
jumps the rotation and drains a project to 100%), an honest progress surface
(coverage header "N of M described · ~X min remaining", ETA derived only from
`value_summary_generation_log.duration_ms`), a gated auto-group control, the
first-ever client WebSocket subscriber on `PlanLedgerPanel.tsx` (prior effort
OPEN-3), and a per-stage model env knob preceded by a one-time
haiku-vs-sonnet calibration. Blast radius spans **server tick loop**
(`server/lib/value-summary-tick.js`), **schema** (`value_summary_sweep_state`
gains a column → §9.5 guarded ALTER + `UPGRADE_CASES`), **the broadcast
contract** (`value_altitudes_updated` payload may widen),
**a new HTTP route**, and **four locale files + two client modules**. It
crosses at least three hard boundaries that two or more callers rely on: the
wire payload shared by an HTTP response and a WS message (§9.1), the
`assembleValuePool` sole-composer seam (DEC-16 / `CONSUMERS`), and the
single-writer guard set on `value_unit_summaries` /
`value_summary_generation_log` (WATCH-6). It also sits **on top of an
unlanded Slice 1** (DEPENDENCY-F1), so feasibility must be judged against a
tree state that does not yet exist in `master`.

Fast mode is the right call for *formality* here — the scope is settled
(DEC-F1), the acceptance signals are already enumerated verbatim by the
requester (§8), and every open point in §9 ships with a workable stated
assumption. It is **not** a licence to thin the guardrail angles, because §5
names five direct defect-catalog hits on precisely these surfaces.

## 2. Agents to run

Order preserves the skill's own dependency chain (evaluators → PM →
tech-lead). Three waves.

### Wave 1 — parallel fan-out (one message, three tool calls)

1. **`intake-architect`** → `supporting/architect.md`
   Load-bearing for direction; fast mode explicitly keeps the direction side.
   The three genuinely undecided design shapes are architectural, not
   cosmetic: **§9 open point A** (drain mechanism — priority-select-only vs.
   in-tick batch loop vs. out-of-cadence drain, and its interaction with
   WATCH-5 per-sweep git cost and WATCH-7 two-writer race), **open point F**
   (does `value_altitudes_updated` widen to carry `counts`/coverage/ETA — the
   cheapest moment it will ever be, since no subscriber exists yet), and
   **open point C** (coverage denominator: cached-at-all vs. cached-and-fresh
   under Slice 1's snapshot gating). Must also rule the **§9.1 single-home
   shape**: one server-side computation of coverage + ETA, one object carried
   identically by the route response and the WS payload, extending Slice 1's
   DEC-14 `counts` precedent rather than bypassing it. And must state where
   the ETA function lives — one function, never re-implemented client-side.
   Do **not** re-open Slice 3's grouping engine; name only the seam it
   consumes (the grouping-synthesis model stage).

2. **`intake-engineer`** → `supporting/engineer.md`
   Fast mode wants working code quickly, and this is the agent that makes the
   build cheap. Specific value here, not generic: (a) the exact
   `value_summary_sweep_state` column shape and the §9.5 three-part landing —
   `CREATE TABLE` body + PRAGMA-`table_info`-guarded ALTER + `UPGRADE_CASES`
   legacy-shape entry, with **no new `GRANDFATHERED` rows** (Slice 1 DEC-5);
   (b) how the per-stage knob slots into `summaryModel()`'s existing fallback
   chain at `server/lib/value-summary.js:60-68` **without forking it**;
   (c) the §9.2 ordering discipline on every new
   `value_summary_generation_log` read (`ORDER BY created_at …, id …` with
   the sort before the `LIMIT` — `chronology-ordering.test.js` statically
   scans `server/db.js` and `server/lib/*`); (d) whether the drain path adds
   a new caller of `upsertValueUnitSummary` / `insertValueSummaryGeneration`
   and therefore widens `single-writer-guard.test.js` (WATCH-6) — noting
   Slice 1 DEC-4 already widened it once, so build on that state, **not** on
   `55fe900`; (e) DEPENDENCY-F1 mechanics — the change set must be expressed
   against a tree containing landed Slice 1, and the repo's
   concurrent-session `ps`/`lsof` check applies before any git operation;
   (f) the calibration as an artifact-producing task, not product code.
   Every new/edited `.js/.ts/.tsx` file carries the mandated file header.

3. **`intake-qa`** → `supporting/qa.md` — **FORCED ON** (see §4)
   Scope it tightly: this is **not** a full test plan (DEC-F2 defers the
   `team-qa` stage). It is the **minimum catalog-guardrail checklist the
   build must carry**, because with `team-qa` skipped this document is the
   only place these obligations are written down before code lands. Required
   content, and little else:
   - **§9.8** — enumerate every new absence state this slice manufactures
     (`coverage-requested-but-not-yet-swept`, `draining` vs. passively
     rotating, ETA cold-start "no measured durations yet") as named,
     server-authored, discriminated wire values; prove the "never zero,
     never two buckets" direction explicitly; assert the coverage "N of M"
     is **re-derived live each round, never decremented** (WATCH-8 /
     prior QA-DEC-2). Rendering `~0 min` or any guessed ETA is a
     requirement violation, not a rounding choice.
   - **§9.1** — one cross-consumer parity assertion that the route response
     and the WS payload carry the same computed coverage/ETA object.
   - **§9.5** — the `UPGRADE_CASES` legacy-shape case for the new column.
   - **§9.2** — coverage by the existing `chronology-ordering` static scan.
   - **§9.3 / WATCH-6** — every new guard red-proven against a real
     mutation, red recorded, guard file set widened in the same commit.
   - **WATCH-E / WATCH-F** — any new wire state value must be reflected in
     the hand-typed client registries (`PlanLedgerPanel.tsx`, `api.ts`);
     both triggers fire on "any growth".
   Explicitly mark everything beyond this list as deferred to the
   post-build `team-qa` run under the `FAST — QA debt` stamp.

### Wave 2 — after all of Wave 1 returns

4. **`intake-project-manager`** → `pm-plan.md` (+ PM memory / request-log,
   defect-catalog touch counts)
   Non-skippable: owns the plan the human reviews and the request-type call.
   For this slice specifically it must (a) settle the §6 classification
   tension — `new-feature` overall, but call out that wiring the OPEN-3
   subscriber is the prior effort's knowingly-logged AC-1 reduction now
   coming due, i.e. `missed-requirement`-shaped debt inside a new feature;
   (b) record the §5 catalog hits against their entries' touch counts
   (§9.8 is this surface's live instance #1 — re-encountering a known
   instance is **not** a new occurrence, per §9.8's own note; count only
   real new duplications); (c) **absorb the skipped product-owner angle** —
   write named decision rows for **open point D** (ship the
   visible-but-disabled group button now as scaffolding vs. header-only)
   and **open point C** (does stale-but-cached count toward "N described"),
   and restate the §8 acceptance signals as this plan's acceptance criteria
   verbatim; (d) close **open point H** — one row reconciling OPEN-4 /
   `MAX_PROJECTS_PER_TICK` with the coverage request, adding **no second
   tuning mechanism**; (e) carry DEC-F2's `FAST — QA debt` stamp and
   DEPENDENCY-F1 forward into the plan's sequencing.

### Wave 3 — last

5. **`intake-tech-lead`** → `technical-plan.md`
   Non-skippable synthesizer: the one coherent doc `team-build` and
   `team-status` read. Reads the brief + architect/engineer/qa + the PM's
   classification. Must land the technical plan with the catalog checklist
   inlined as build-time obligations (not as a pointer to a QA stage that
   will not run before build), and must state plainly that the build is
   gated on DEPENDENCY-F1.

## 3. Agents skipped

- **`intake-product-owner`** — skipped under fast's inverted default. Its
  two normal outputs are already supplied: **scope** is settled and
  non-relitigable (DEC-F1 + §10 out-of-scope list), and **acceptance
  criteria** exist verbatim as the requester's own six signals (§8).
  Sign-off is not in play — auto-pilot, Sara reversible, no client ask.
  The one genuine product judgment left is open point D (disabled-button
  scaffolding for a Slice 3 action), which already carries a stated
  assumption and is **explicitly reassigned to the PM** above.
  *Deferred angle, named for the follow-up pass:* nobody in this run
  independently pressure-tests whether the disabled-gate UX is worth
  shipping ahead of the action it gates, or whether "prioritize now" alone
  would deliver the value — revisit if the Slice 3 intake or the QA
  follow-up finds the gate confusing in practice.
- **`intake-client-liaison`** — on-demand only; there is no client ask on
  this work. Sara is the project owner and the requester, in-session.

## 4. Forced back on

- **`intake-qa`, over fast mode's default skip — the decisive call of this
  run.** The rule that a defect-catalog match forces the guardrail back on
  is the one rule fast does not bend, and §5 names **five direct hits plus
  three WATCH rows** on the exact files this slice edits: §9.8
  (OVERLOADED-ABSENCE — this surface *is* the catalog's live instance #1,
  and this slice manufactures at least three new absence states), §9.1
  (derived value with two delivery paths **on day one** — the precise
  "consumer #2 exists at introduction" moment this entry's history says the
  failure lands), §9.2, §9.5, §9.3, plus WATCH-6, DEC-16/`CONSUMERS`, and
  WATCH-E/F. DEC-F2 compounds this rather than excusing it: with the
  `team-qa` stage deferred, build-time red-proof discipline is the **only**
  gate, and `supporting/qa.md` is the only artifact that will tell the
  builder what to red-prove. Skipping it here would be exactly the quiet
  guardrail drop direct mode is forbidden to make.
- **Cross-boundary work keeps the architect and engineer both on** despite
  fast: the WS-payload/HTTP-response pair and the `assembleValuePool`
  sole-composer seam are contracts with more than one caller, and the schema
  change is migration-shaped.
- **No blocking ambiguity forces anything else on.** §9 records zero
  blocking questions; every non-blocking point has a workable default and is
  assigned above to a named agent for a `DECIDED-AUTO` row.
