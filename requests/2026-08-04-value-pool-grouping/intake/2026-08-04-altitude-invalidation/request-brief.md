# Request Brief — Value Pool altitude cache: mutability-aware caching + invalidation (Slice 1)

**Intake:** `2026-08-04-altitude-invalidation`
**Source:** `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/request.md`
**Scope ruling from the orchestrator:** Slice 1 ONLY. Slices 2–4 are a
confirmed follow-on roadmap (each its own future intake on its own effort
branch) and are context here, not scope.

---

## 1. Raw ask (verbatim, from `request.md` §"Slice 1")

> ### Slice 1 — Mutability-aware caching + invalidation
> - `trunk_commit` / `merge_commit` units are content-addressed (a SHA is
>   immutable) → keep today's generate-once-serve-forever cache. Correct as-is.
> - `intake_initiative` / `detour` units are **mutable** (stage progresses,
>   labels can be rewritten by re-inference) → add an **input digest** to
>   `value_unit_summaries` (hash of the prompt-feeding fields: stage, label),
>   mirroring `focus_summaries`' existing digest-gated pattern. Digest
>   mismatch = stale → regenerate that one unit.
> - **Known live staleness example** (found in-session): the Resume project's
>   `2026-08-03-job-pipeline-tracker` initiative cached "The job pipeline
>   tracker is built and being tested" — that text will silently outlive the
>   initiative's actual release unless this slice ships.
> - **Invalidation UX:** a regenerated unit gets a visible "updated — stage
>   changed" marker until seen; the invalidation lands in
>   `value_summary_generation_log` with a reason.

Framing sentence from the same document's vision section, load-bearing for
this slice's UX requirement:

> the UX must always tell the user what's happening, how long it will take,
> and when something they saw before has changed.

## 2. Restated ask

Make the value-pool altitude cache honest about mutable units: keep
commit-keyed units cached forever (content-addressed, correct today), but
gate `intake_initiative`/`detour` cached summaries on an input digest of
their prompt-feeding fields (stage + label) — mirroring `focus_summaries`'
existing `input_digest` pattern — so a stage change or label rewrite marks
that one unit stale and regenerates it. A regenerated unit shows an
"updated — stage changed" marker until seen, and the invalidation is
recorded in `value_summary_generation_log` with a reason.

## 3. Requester / source

- **Who:** Sara (project owner).
- **Channel:** verbal, in-session, 2026-08-04 — the same session that
  shipped `effort/2026-08-04-value-summary-tick` (merged `55fe900`).
  Approval quote recorded in `request.md`: architectural direction "worked
  through in-session, Sara approved 'let's build this'".
- **Written record:** `requests/2026-08-04-value-pool-grouping/request.md`
  (four-slice phased vision; this intake is slice 1).

## 4. Surface / area touched

- `server/lib/value-summary.js` — `enrichPoolAltitudes` (cache read/miss
  logic; DEC-10 `{altitudes, states}` return shape; `ALTITUDE_STATES =
  ["queued","unavailable"]` registry at line 47 of the merged file).
- `server/lib/value-summary-tick.js` — background sweep (second invoker of
  `enrichPoolAltitudes`; stale detection on sweep).
- `server/db.js` — `value_unit_summaries` (currently `unit_key PK,
  project_level, stakeholder_level, model, created_at` — **no digest
  column**; its own schema comment at lines 821-825 explicitly asserts
  "NOT a content digest like focus_summaries … generated once, served
  forever" and must be rewritten by this change);
  `value_summary_generation_log` (has `source` CHECK `('tick','request')`
  and `outcome` CHECK `('ok','skipped','error')`; **no reason column**);
  `value_summary_sweep_state`.
- `client/src/components/PlanLedgerPanel.tsx` — the "updated — stage
  changed" until-seen marker.
- Digest-pattern precedent to mirror: `focus_summaries.input_digest`
  (`server/db.js:678`; gating logic in `server/lib/focus-summary.js`
  `readCachedSummary`, line 271).

**Substrate location note (verified during intake):** the tick substrate is
merged at `55fe900` on **`origin/master`**; the local checkout at
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor` is at `d830a44`,
which is a parent of `55fe900` — i.e. plainly **behind, fast-forwardable,
not diverged**. `value-summary-tick.js` and the two log/sweep tables do not
exist in the local working tree yet. The effort branch for this slice must
be cut from `55fe900` (or later), and given this repo's known concurrent-
session risk, check for other live sessions before any git operation.

## 5. Known-variant relevance (PROJECT-CONTEXT.md defect catalog)

This request lands squarely on catalogued surfaces — cite these by name at
QA/review:

- **§9.8 OVERLOADED-ABSENCE — direct hit; this is the same surface as the
  entry's live instance #1** (`enrichPoolAltitudes`). This slice introduces
  at least two new distinguishable states: *stale-but-not-yet-regenerated*
  and *regenerated-but-not-yet-seen*. §9.8's acceptance criterion applies:
  each must be a named, discriminated state on the wire (extend the
  `ALTITUDE_STATES`/DEC-10 registry), never a silent absence or a
  client-side heuristic. `request.md`'s own constraints section names this
  trap explicitly.
- **§9.1 DERIVED-DUAL-VIEW (write-sequence + re-derivation forms):** the
  digest must be computed identically at write time and at check time
  (read path and sweep). One shared digest function with one home —
  `focus-summary.js`'s own comment ("kept as a single shared extraction so
  the digest can never drift from what the prompt actually contains") is
  the in-repo statement of the cure. §9.1's twice-proven lesson applies: a
  rogue-*reader* scan does not catch a rogue *re-derivation* of the digest
  formula.
- **§9.5 FRESH-DB-BLIND SCHEMA CHANGE:** adding `input_digest` to
  `value_unit_summaries` (and any new log column) must ship as a guarded
  `ALTER TABLE … ADD COLUMN` + `UPGRADE_CASES` legacy-shape migration test,
  never only in the `CREATE TABLE IF NOT EXISTS` body.
- **§9.6 NON-ATOMIC-REBUILD:** relevant only if the design widens a CHECK
  (e.g. `outcome`) — a CHECK cannot be ALTERed, forcing a full table
  rebuild via `rebuildTableAtomically`. A new nullable column avoids §9.6
  entirely; see open question C.
- **§9.3 VACUOUS-GUARD standing rule:** every new guard red-proven against
  a real mutation, with the red recorded. The prior effort on this exact
  surface holds the project record (eight §9.3-family events).
- **WATCH-6 / WATCH-7 (prior effort's `decisions.md`):** single-writer
  guards on `upsertValueUnitSummary` and `insertValueSummaryGeneration`
  must be widened deliberately in the same change if invalidation adds a
  call site; the route-vs-tick two-writer race is blessed as
  safe-but-wasteful for *misses* — stale-regeneration changes that race's
  frequency profile (see open question D).

## 6. Provisional request type

**`new-feature`** — PROVISIONAL (PM makes the final call). It is a
capability addition (cache invalidation + staleness UX), though it exists
to fix a latent correctness defect (silently stale cached text), so
`missed-requirement` against the prior effort is a defensible alternate
reading. It is not a regression: the generate-once behavior was a
deliberate, documented decision (`db.js` schema comment), now overtaken by
the units' actual mutability.

## 7. Attachments / evidence

- **Known live staleness example (cited in the request, expected-vs-actual):**
  Resume project's `2026-08-03-job-pipeline-tracker` initiative cached
  "The job pipeline tracker is built and being tested"; actual: the
  initiative progresses past that stage and the text never updates. A
  natural QA fixture shape.
- Prior effort's full record: `intake/2026-08-04-value-summary-tick/`
  (decisions DEC-1..18, WATCH-1..8; OPEN-2..4 still open; QA verdict
  GAPPED with corrections applied).
- No screenshots.

## 8. Explicit acceptance signals (as stated by the requester)

1. `trunk_commit`/`merge_commit` units: behavior unchanged —
   generate-once-serve-forever.
2. `intake_initiative`/`detour` units: digest mismatch on stage/label →
   that one unit regenerates (the Resume example's text updates when its
   initiative's stage changes).
3. A regenerated unit shows a visible "updated — stage changed" marker
   until seen.
4. The invalidation lands in `value_summary_generation_log` with a reason.
5. (Vision-level, applies to all slices:) the user is always told when
   something they saw before has changed.

## 9. Open questions

### BLOCKING

None. The request is unusually well-specified (verbally approved design
with named tables, named precedent pattern, a live reproduction example,
and a written scope fence). All identified ambiguities have workable
default assumptions and belong to the evaluation/design phase, not to Sara.

### Non-blocking (flagged for the evaluation phase — NOT resolved here)

- **A. Migration semantics for pre-digest cache rows.** Existing
  `value_unit_summaries` rows (all generated before any digest column
  exists) will read `input_digest = NULL`. Treat as stale-on-first-check
  (regenerate lazily), or backfill digests assuming current state?
  *Stated assumption for proceeding:* stale-on-first-check for mutable
  units only. Intake note for the evaluators: backfilling from *current*
  stage/label would stamp the known-stale Resume row as fresh — the digest
  would match today's state while the cached text was generated from an
  older state — i.e. backfill defeats the request's own motivating
  example. The cost of stale-on-first-check is a one-time regeneration
  burst across the fleet's mutable units (intake/detour only; commit units
  unaffected) — size it against real pool composition. Immutable
  commit-keyed units must be exempt from digest gating entirely (NULL
  digest on them is not staleness).
- **B. Where "seen" state for the updated-marker lives.** Server-side
  (survives reloads/devices; implies schema — a `seen_at`-style column or
  table and a mark-seen write path) or client-local (cheaper; resets per
  browser)? Interacts with §9.8: "regenerated-unseen" must be a named
  state wherever it lives, and with DEC-10's server-authored-state
  principle, which leans server-side. Evaluation phase decides.
- **C. Schema shape for the generation-log "reason".** The log today has
  no reason column; `outcome` is CHECK-constrained
  (`'ok','skipped','error'`). A new nullable column (e.g.
  `invalidation_reason` or a per-run `stale_regenerated` count) is a
  §9.5-pattern ALTER; widening the `outcome` CHECK instead forces a §9.6
  atomic table rebuild. Also note the log is per-*run* (batch), while an
  invalidation reason is per-*unit* — the granularity mismatch is part of
  this question. *Stated assumption:* additive nullable column(s), no
  CHECK change, no rebuild.
- **D. Which paths perform stale-regeneration.** Tick only, or also the
  request-path fast lane? Note for evaluators: with digest gating in the
  shared read path, a stale unit naturally reads as a cache miss on the
  request path too — tick-only staleness would require deliberately
  *excluding* the fast lane. Either way, WATCH-7's blessed two-writer race
  now also covers stale units (frequency profile changes), and WATCH-6's
  single-writer guard on `insertValueSummaryGeneration` goes red by design
  if the request path starts logging (DEC-14's `source='request'` value
  exists for exactly this) — it must be widened deliberately in the same
  change.
- **E. (Intake-added, environment)** Local `master` is behind
  `origin/master` (`d830a44` vs `55fe900`); fast-forward before cutting
  the effort branch, after checking for concurrent sessions per this
  repo's known risk.

## 10. Out of scope (committed follow-on sequence, separate future intakes)

In order, each on its own effort branch through the full
team-intake → team-qa → team-build pipeline:

1. **Slice 2** — coverage-on-demand (explicit coverage requests jump the
   sweep rotation), coverage/ETA header from real per-batch durations,
   auto-group gating UX, OPEN-3 client WebSocket subscriber, model-tiering
   calibration (haiku vs sonnet, measured per OPEN-4 precedent).
2. **Slice 3** — auto-group proposal engine (mechanical pre-grouping + LLM
   refinement; groups are proposals in a new `value_groups` table, never
   auto-claims).
3. **Slice 4** — plan editing UI in PlanLedgerPanel (items/sub-items) +
   batch group claiming.

Standing constraints carried from `request.md` that bind slice 1 too:
`assembleValuePool` stays the sole pool composer (DEC-16/`CONSUMERS`);
single-writer guards widen deliberately (WATCH-6 pattern); §9.8 named
states for every new absence; OPEN-4 reconciled rather than duplicated.
