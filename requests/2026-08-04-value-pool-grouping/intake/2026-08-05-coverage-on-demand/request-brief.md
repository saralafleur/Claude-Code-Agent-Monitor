# Request Brief — Value Pool coverage-on-demand + progress UX + model tiering (Slice 2)

**Intake:** `2026-08-05-coverage-on-demand`
**Source:** `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/request.md`
**Scope ruling (DEC-F1, this folder's `decisions.md` — settled, do not re-litigate):**
Slice 2 ONLY. Slice 1 (`intake/2026-08-04-altitude-invalidation/`) is mid-build;
Slices 3–4 are future intakes. **Run mode: fast** (DEC-F2 — QA deferred, build
carries a `FAST — QA debt` stamp).

---

## 1. Raw ask (verbatim, from `request.md` §"Slice 2")

> ### Slice 2 — Coverage-on-demand + progress UX + model tiering
> - **Two demand levels.** Passive (default): view-triggered fast path +
>   slow background rotation, exactly as today — never eager-backfill all
>   projects. Active (**coverage request**): an explicit intent (e.g.
>   clicking Auto-group) flags the project in `value_summary_sweep_state`
>   to jump the rotation and drain continuously to 100%.
> - **Coverage header** per project: "N of M described · ~X min remaining" —
>   ETA computed from `value_summary_generation_log`'s real per-batch
>   durations, never a guess.
> - **Auto-group gating UX:** the group action is visibly disabled until
>   coverage is 100%, with the ETA and a "prioritize now" action.
> - **Wire the deferred OPEN-3 client WebSocket subscriber** (from the
>   previous effort's decisions.md) — live coverage progress is the first
>   feature that genuinely needs in-place updates.
> - **Model tiering — measure, don't guess** (this project's OPEN-4
>   precedent): run a one-time calibration on one real 40-unit batch —
>   haiku vs. sonnet side-by-side for the per-unit text — before deciding.
>   Working hypothesis: haiku for per-unit compression (simple task, 3×
>   cheaper: $1/$5 vs $3/$15 per Mtok), sonnet reserved for the grouping
>   synthesis (cross-unit judgment). Add a per-stage model env knob.
>   Current measured economics (in-session, real pricing table): ~4¢ per
>   40-unit sonnet batch ≈ $0.001/unit, one-time per unit; a 182-unit
>   backfill ≈ 20¢. Cost is not the driver — quality-per-tier is the open
>   question.

Framing sentence from the vision section, load-bearing for this slice's UX:

> the UX must always tell the user what's happening, how long it will take,
> and when something they saw before has changed.

Constraints section rows that bind this slice directly (verbatim):

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

## 2. Restated ask

Give the altitude-generation sweep two explicit demand levels — the existing
passive default (view-triggered fast path + slow rotation, never
eager-backfill) plus an active **coverage request** that flags a project in
`value_summary_sweep_state` to jump the rotation and drain continuously to
100% coverage — and make progress honest and live: a per-project coverage
header ("N of M described · ~X min remaining", ETA derived only from
`value_summary_generation_log.duration_ms` real measurements), an auto-group
action that is visibly disabled below 100% coverage with the ETA and a
"prioritize now" action, and the previously-deferred OPEN-3 client WebSocket
subscriber wired so an open tab sees coverage progress in place. Separately,
run the one-time haiku-vs-sonnet calibration on one real 40-unit batch and
add a per-stage model env knob so per-unit compression and (future) grouping
synthesis can run on different tiers.

## 3. Requester / source

- **Who:** Sara (project owner).
- **Channel:** verbal, in-session, 2026-08-04 — the session that shipped
  `effort/2026-08-04-value-summary-tick` (merged `55fe900`). Architectural
  direction "worked through in-session, Sara approved 'let's build this'".
- **Written record:** `requests/2026-08-04-value-pool-grouping/request.md`
  (four-slice vision; this intake is Slice 2). Run dispatched by
  `/team-intake fast` 2026-08-05.

## 4. Surface / area touched

All locations verified by direct read during this intake (against the current
working tree, which already contains Slice 1's uncommitted build — see §9.E):

- `server/lib/value-summary-tick.js` — the sweep rotation. Coverage-request
  priority ("jump the rotation, drain continuously") changes project
  selection and possibly per-tick pacing. Second invoker of
  `enrichPoolAltitudes`; bound by DEC-15/DEC-16's `assembleValuePool`
  sole-composer structural test.
- `server/db.js` — `value_summary_sweep_state` (currently `project_id PK,
  last_swept_at, pending_after_sweep` — **no coverage-request flag column**;
  any new column is a §9.5 guarded-ALTER + `UPGRADE_CASES` change);
  `value_summary_generation_log` (already has `duration_ms`, `model`,
  `created_at`, per-project index — the ETA's only legitimate input);
  the sweep-state statement family (`getValueSummarySweepCandidates` join,
  upserts around `db.js:3268-3291`).
- `server/lib/value-summary.js` — `summaryModel()` (lines 60-68): today one
  knob, `DASHBOARD_VALUE_SUMMARY_MODEL` with focus-summary/inference
  fallbacks. "Per-stage model env knob" splits this into per-unit-compression
  vs. grouping-synthesis stages (the latter consumed by Slice 3, named now).
- `server/index.js` — the existing `value_altitudes_updated` broadcast
  (prior effort DEC-8: type-level + broadcast, zero subscribers). Payload may
  need to carry coverage counts for the header; DEC-14 (Slice 1) already
  makes `enrichPoolAltitudes` return `counts` so nothing re-derives them.
- `client/src/components/PlanLedgerPanel.tsx` — coverage header, disabled
  auto-group gate with ETA + "prioritize now", and the first `eventBus`
  WebSocket subscription this panel has ever had (prior effort OPEN-3's
  specified ~20-line shape: `useEffect` + `eventBus.subscribe`, `project_id`
  filter, merge into state).
- `client/src/lib/api.ts` / `types.ts`, four locale files — new
  endpoint(s) for "request coverage" / "prioritize now", header copy in
  en/ko/vi/zh.
- New route surface (likely `server/routes/project-plans.js`): the explicit
  coverage-request intent needs a POST; the header needs coverage + ETA data
  (either on an existing response or a new endpoint).
- One-time calibration: a real 40-unit batch run haiku-vs-sonnet
  side-by-side — an artifact-producing measurement task, not product code
  (its durable output is the model-choice decision row + the env knob).

## 5. Known-variant relevance (PROJECT-CONTEXT.md defect catalog)

This is the same surface as §9.8's live instance #1 — the catalog's most
active territory. Cite by name at review:

- **§9.8 OVERLOADED-ABSENCE — direct hit, this slice manufactures new
  absence states.** At minimum: *coverage-requested-but-not-yet-swept*,
  *draining* vs. *passively rotating*, and the ETA's cold-start ("no measured
  durations yet" must be a named state — rendering `~0 min` or a guessed
  number violates the request's own "never a guess"). Each must be a named,
  server-authored, discriminated value on the wire, never reconstructed
  client-side from what is missing. Also §9.8's acceptance criterion
  verbatim: any progress number **re-derived live each round, never
  decremented** — the coverage header's "N of M" is exactly the
  `pending_after_sweep`/WATCH-8 shape (prior effort QA-DEC-2).
- **§9.1 DERIVED-DUAL-VIEW:** "N of M described" and the ETA are derived
  values with two delivery paths on day one (HTTP response for mount, WS
  message for live update) — the exact "consumer #2 exists at introduction"
  moment this entry's history says the failure lands. One server-side
  computation with one home; the WS payload and the route response must carry
  the same computed object, not two derivations. Slice 1's DEC-14 (`counts`
  computed once inside `enrichPoolAltitudes`) is the precedent to extend, not
  bypass. Same for the ETA formula: one function, never re-implemented in the
  client from raw log rows.
- **§9.2 row-id-as-chronology-proxy:** the ETA reads "recent" rows from
  `value_summary_generation_log` — any such query sorts
  `ORDER BY created_at …, id …` with the sort before the `LIMIT`, per the
  standing convention and the `chronology-ordering.test.js` static scan
  (which scans `server/db.js` and `server/lib/*`).
- **§9.5 FRESH-DB-BLIND SCHEMA CHANGE:** the coverage-request flag on
  `value_summary_sweep_state` (and any log/sweep column) ships as
  `CREATE TABLE` body **plus** PRAGMA-`table_info`-guarded ALTER **plus**
  `UPGRADE_CASES` legacy-shape test (Slice 1's DEC-5 ruling: no new
  `GRANDFATHERED` entries). No CHECK changes → no §9.6 rebuild needed;
  keep it that way.
- **§9.3 VACUOUS-GUARD standing rule:** every new guard red-proven against a
  real mutation, red recorded. This surface holds the project record (eight
  §9.3-family events in the prior effort). Fast mode defers team-qa, which
  makes build-time red-proof discipline the *only* gate — flagged in DEC-F2.
- **WATCH-6 / single-writer guards (prior effort):** if "drain continuously"
  or the coverage route adds any new caller of `upsertValueUnitSummary` /
  `insertValueSummaryGeneration`, widen `single-writer-guard.test.js`'s file
  set deliberately in the same commit, red-proven by injection. Note Slice 1
  (DEC-4) already lands request-path logging and widens the guard once —
  build on that state, not on `55fe900`'s.
- **DEC-16 / `CONSUMERS` (prior effort):** `assembleValuePool` stays the sole
  pool composer. If the coverage header's "M" (denominator) needs pool
  membership, it comes from `assembleValuePool` via the registry — no
  pool-membership SQL in the tick, route, or a new helper.
- **WATCH-E / WATCH-F (Slice 1) — hand-typed client registries at the
  CJS/Vite boundary:** if this slice adds any new wire state value, the
  client-side copies (`PlanLedgerPanel.tsx`, `api.ts`) are the catalog's
  most common drift site; both WATCH rows' triggers fire on "any growth".

## 6. Provisional request type

**`new-feature`** — PROVISIONAL (PM makes the final call). Genuinely new
capability (demand levels, progress UX, live updates, model tiering); no
prior requirement said coverage was requestable. One carve-out a PM might
split differently: wiring the OPEN-3 subscriber is the prior effort's own
already-specified fast-follow — arguably `missed-requirement`-shaped debt
coming due (its absence was a knowing, logged reduction of that effort's
AC-1), now being paid because this slice is the first feature that needs it.

## 7. Attachments / evidence

- **Real economics measured in-session** (in the raw ask): ~4¢ per 40-unit
  sonnet batch ≈ $0.001/unit; 182-unit backfill ≈ 20¢; haiku $1/$5 vs sonnet
  $3/$15 per Mtok. Cost is explicitly not the driver — quality-per-tier is.
- **Prior effort's OPEN-4 measurement** (`intake/2026-08-04-value-summary-tick/decisions.md`):
  `P = 15`, `U = 182`, worst-case full-fleet coverage 250 min (~4h10m) at
  shipped defaults, 100 min at `MAX_PROJECTS_PER_TICK=8`. This is the
  quantified pain the coverage request exists to bypass for the one project
  the user actually cares about right now.
- **Substrate ledger:** prior effort `decisions.md` (DEC-5 cadence defaults,
  DEC-8 broadcast-no-subscriber, DEC-15/16 sole-composer seam + structural
  test, OPEN-3 subscriber spec, OPEN-4, WATCH-5 per-sweep git cost, WATCH-7
  two-writer race, WATCH-8 re-derive-never-decrement); Slice 1 `decisions.md`
  (DEC-4 request-path logging now, DEC-11 wire/log partitions disagree by
  design, DEC-13 `ALTITUDE_FRESHNESS`, DEC-14 `counts`, WATCH-A..G,
  OPEN-1 = re-carried subscriber deferral, OPEN-3 = re-carried
  `MAX_PROJECTS_PER_TICK`).
- No screenshots.

## 8. Explicit acceptance signals (as stated by the requester)

1. Passive default is behavior-preserving: view-triggered fast path + slow
   rotation "exactly as today — **never eager-backfill all projects**".
2. An explicit coverage request flags the project in
   `value_summary_sweep_state`, jumps the rotation, and drains continuously
   to 100% coverage.
3. Coverage header per project: "N of M described · ~X min remaining", ETA
   from `value_summary_generation_log`'s real per-batch durations — "never a
   guess".
4. The group action is visibly disabled until coverage is 100%, showing the
   ETA and a "prioritize now" action.
5. The OPEN-3 client WebSocket subscriber is wired: live coverage progress
   updates in place in an open tab (the vision's "always tell the user
   what's happening / how long it will take", now met without remounting).
6. A one-time haiku-vs-sonnet calibration on one real 40-unit batch is run
   **before** the tier decision, and a per-stage model env knob exists.

## 9. Open questions

### BLOCKING

None. The premise is unambiguous, the substrate is verified present, and
every open point below has a workable default the team can take under fast
mode's DECIDED-AUTO convention (Sara reversible without reopening).

### Non-blocking (preference-/design-shaped — decide and log, do not stop)

- **A. "Drain continuously" mechanism.** Does a coverage-requested project
  (i) merely get selected first each tick (still one batch of ≤40 per tick —
  a 182-unit pool then takes ~5 ticks ≈ 50 min even prioritized), (ii) loop
  batches back-to-back within its tick until drained, or (iii) run an
  immediate out-of-cadence drain loop on request? "Jump the rotation and
  drain continuously to 100%" reads as (ii) or (iii). Interacts with
  WATCH-5 (per-sweep git cost) and WATCH-7 (two-writer race frequency).
  *Stated assumption:* prioritized selection + continuous in-process batch
  loop for the flagged project, bounded per batch as today, flag cleared on
  reaching 100% (or on pool-growth re-check per WATCH-8 — re-derive, never
  assume drained).
- **B. ETA formula inputs.** Per-project or fleet-wide `duration_ms`
  averages; how many recent rows; `source='tick'` only or `'request'` too;
  and the **cold-start named state** when no measured durations exist yet
  (§9.8 — must be a distinguished "estimating" value, not 0, not a guess).
- **C. Coverage denominator semantics.** Is "described" cached-at-all, or
  cached-and-fresh under Slice 1's input-snapshot gating? A stale mutable
  unit serves old text (Slice 1 DEC-11) — does it count toward "N described"
  for grouping purposes? *Stated assumption:* fresh-or-immutable counts;
  stale counts as not-yet-described for the drain target, since grouping
  (Slice 3) should not synthesize over known-stale text. Needs one named
  decision row at PM/plan time — this is the wire/log-partition DEC-11 shape
  again and will be "fixed" into the wrong agreement by a later reader if
  undocumented.
- **D. What the auto-group gate attaches to in this slice — OVERTURNED by the
  PM, see `pm-plan.md`.** The group action itself is Slice 3. *Stated
  assumption below (superseded):* ship the visible-but-disabled group button
  now as scaffolding. **PM ruling:** do NOT ship the disabled button in
  Slice 2 — a scaffolded button that's disabled-for-coverage today and
  disabled-because-the-feature-doesn't-exist after Slice 2 ships would render
  identically while meaning different things, which is §9.8
  OVERLOADED-ABSENCE manufactured by the very slice whose standing trap that
  is. Slice 2 ships only the coverage header + "prioritize now"; `coverageSnapshot`
  must still carry a server-authored `complete` boolean so Slice 3 has
  something real to gate on. ~~Original (superseded): ship the disabled
  control now; it is the coverage request's primary discoverable entry
  point.~~
- **E. Environment / sequencing (DEPENDENCY-F1) — CORRECTED post-triage, see
  `decisions.md`.** The premise below was written at triage time and is
  **factually wrong**: the intake-architect and intake-engineer both
  independently verified live that the uncommitted ~2,000-line main-checkout
  diff is the *prior, already-merged* `value-summary-tick` effort
  (`55fe900`), not Slice 1. **Slice 1 (`altitude-invalidation`) has zero
  build code anywhere** — only its intake docs exist. Corrected chain:
  reconcile the git divergence → build Slice 1 for real → only then branch
  Slice 2. Concurrent-session `ps`/`lsof` check before any git operation, per
  this repo's known risk, applies at the reconciliation step.
  ~~Original (superseded): Slice 1's build sits uncommitted on the main
  checkout; Slice 2's build must branch from a tree containing landed
  Slice 1.~~
- **F. WS payload shape.** Does `value_altitudes_updated` (currently
  broadcast with no subscriber, payload deliberately shaped for a pure
  client addition) already carry what the coverage header needs, or must it
  widen to carry `counts`/coverage/ETA? Widening is additive and
  backward-compatible by construction (no subscriber exists yet — this is
  the cheapest moment it will ever be); the §9.1 requirement is that the
  payload carry the same server-computed object the route returns.
- **G. Calibration judging + disposition.** Quality-per-tier is a judgment
  call. *Stated assumption (fast mode):* the team runs the side-by-side on
  one real 40-unit batch, records both outputs and a recommendation as a
  DECIDED-AUTO row with the artifact attached, ships the per-stage env knob
  with the recommended default, Sara reversible by env var alone. The knob
  must slot into `summaryModel()`'s existing fallback chain, not fork it.
- **H. OPEN-4 / `MAX_PROJECTS_PER_TICK` reconciliation (mandated by the
  request: "reconcile rather than duplicate").** The coverage request
  supersedes global tuning for the it's-blocking-me-now case; the ~4h
  passive full-fleet worst case remains and remains env-tunable. *Stated
  assumption:* close the prior effort's OPEN-4 (and Slice 1's carried
  OPEN-3) into one row here recording: priority drain is the product answer
  for on-demand coverage; `MAX_PROJECTS_PER_TICK=8` stays a standing
  recommendation for Sara's real `.env` for passive-fleet latency; shipped
  source defaults unchanged. Do not add a second tuning mechanism.

## 10. Out of scope

- **Slice 3** — auto-group proposal engine (`value_groups`, mechanical
  pre-grouping, LLM refinement). This slice only *gates and feeds* it
  (coverage = its precondition; the grouping-synthesis model stage of the
  env knob = its consumer).
- **Slice 4** — plan editing UI + batch group claiming.
- Slice 1's own scope (input-snapshot invalidation, freshness markers,
  seen-state) — a hard dependency, not a deliverable here.
- Any change to `MAX_UNITS_PER_PROMPT`, the tick cadence defaults, or the
  passive rotation's fairness beyond the priority flag.

## Standing constraints (bind this slice; from `request.md` + prior ledgers)

1. `assembleValuePool` remains the sole pool composer (prior effort DEC-16 +
   DEC-15 structural test; `CONSUMERS` registry updated in the same change as
   any new consumer).
2. Single-writer guards on `value_unit_summaries` /
   `value_summary_generation_log` writes widen **deliberately, same commit,
   red-proven** if any new writer appears (WATCH-6 pattern).
3. §9.8: every new absence this slice can produce is a named, distinguishable,
   server-authored state; progress numbers re-derived live, never
   decremented (WATCH-8).
4. Slices ship independently, in order, own effort branch — hence
   DEPENDENCY-F1: no Slice 2 build until Slice 1 lands.
