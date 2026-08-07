# Request: Value Pool — invalidation-aware caching, coverage-on-demand, auto-grouping, and plan editing

**From:** Sara (verbal, 2026-08-04, same session that shipped `effort/2026-08-04-value-summary-tick`, merged `55fe900`)
**Depends on:** the just-merged background tick + `{altitudes, states}` wire state. Everything below builds on that substrate.

## Sara's vision, in her own framing

Once every value-pool unit has its generated PROJECT/STAKEHOLDER text, she
wants to **auto-group** the pool in a fashion appropriate to the solution,
then act on a group as a unit: **claim a whole group into an existing plan
item/milestone**, or **have a group create itself as a new plan item**. She
also wants to **edit the plan in the UI** — add milestones and
sub-milestones — so a group or an individual value can be claimed into an
item *or a sub-item*. Generation cost/scale must be handled well at
~200-unit pools, and the UX must always tell the user what's happening,
how long it will take, and when something they saw before has changed.

## Agreed architectural direction (worked through in-session, Sara approved "let's build this")

### Slice 1 — Mutability-aware caching + invalidation
- `trunk_commit` / `merge_commit` units are content-addressed (a SHA is
  immutable) → keep today's generate-once-serve-forever cache. Correct as-is.
- `intake_initiative` / `detour` units are **mutable** (stage progresses,
  labels can be rewritten by re-inference) → add an **input digest** to
  `value_unit_summaries` (hash of the prompt-feeding fields: stage, label),
  mirroring `focus_summaries`' existing digest-gated pattern. Digest
  mismatch = stale → regenerate that one unit.
- **Known live staleness example** (found in-session): the Resume project's
  `2026-08-03-job-pipeline-tracker` initiative cached "The job pipeline
  tracker is built and being tested" — that text will silently outlive the
  initiative's actual release unless this slice ships.
- **Invalidation UX:** a regenerated unit gets a visible "updated — stage
  changed" marker until seen; the invalidation lands in
  `value_summary_generation_log` with a reason.

### Slice 2 — Coverage-on-demand + progress UX + model tiering
- **Two demand levels.** Passive (default): view-triggered fast path +
  slow background rotation, exactly as today — never eager-backfill all
  projects. Active (**coverage request**): an explicit intent (e.g.
  clicking Auto-group) flags the project in `value_summary_sweep_state`
  to jump the rotation and drain continuously to 100%.
- **Coverage header** per project: "N of M described · ~X min remaining" —
  ETA computed from `value_summary_generation_log`'s real per-batch
  durations, never a guess.
- **Auto-group gating UX:** the group action is visibly disabled until
  coverage is 100%, with the ETA and a "prioritize now" action.
- **Wire the deferred OPEN-3 client WebSocket subscriber** (from the
  previous effort's decisions.md) — live coverage progress is the first
  feature that genuinely needs in-place updates.
- **Model tiering — measure, don't guess** (this project's OPEN-4
  precedent): run a one-time calibration on one real 40-unit batch —
  haiku vs. sonnet side-by-side for the per-unit text — before deciding.
  Working hypothesis: haiku for per-unit compression (simple task, 3×
  cheaper: $1/$5 vs $3/$15 per Mtok), sonnet reserved for the grouping
  synthesis (cross-unit judgment). Add a per-stage model env knob.
  Current measured economics (in-session, real pricing table): ~4¢ per
  40-unit sonnet batch ≈ $0.001/unit, one-time per unit; a 182-unit
  backfill ≈ 20¢. Cost is not the driver — quality-per-tier is the open
  question.

### Slice 3 — Auto-group proposal engine
- **Mechanical pre-grouping first** (free, deterministic, auditable):
  trunk commits referencing an initiative slug, time-adjacency clusters,
  shared surfaces.
- **LLM refinement second**: one sonnet call over the pre-groups + the
  units' already-generated (cheap) PROJECT/STAKEHOLDER texts → proposed
  named groups, each with a stakeholder-level summary sentence, member
  unitKeys, and a rationale. Hierarchical (like focus-summary's
  day→window rollup) if the pool exceeds one prompt's worth.
- **Groups are proposals, never actions** — new `value_groups` table,
  rendered for review/approval. Preserves the ledger's standing principle
  (correlational tier suggests, never auto-claims).
- Requires 100% altitude coverage for the target project (Slice 2's
  coverage request is the gate).

### Slice 4 — Plan editing UI + batch group claiming
- Plan-item hierarchy already exists server-side (`parent_item_id`,
  full item CRUD in plan-lifecycle.js) — this slice is **UI**: add/edit
  items and sub-items in PlanLedgerPanel, and a claim-target picker that
  shows the hierarchy.
- **Group actions:** claim-all-members-into-existing-item (batch claim,
  one transaction), or create-new-item(-or-sub-item)-then-claim (the
  claims API's atomic inline `new_item` already supports the shape).
- Individual units keep their existing single-claim gesture, now with
  sub-item targets.

## Constraints / carry-forwards
- Reuse, never re-derive: `assembleValuePool` stays the sole pool composer
  (DEC-16 / `CONSUMERS` registry); the single-writer guards on
  `value_unit_summaries` writes must widen deliberately if a new writer
  appears (WATCH-6 pattern).
- §9.8 OVERLOADED-ABSENCE is the standing trap for this whole surface:
  every new "absent from a map" state (a group with no members resolved, a
  stale-but-not-yet-regenerated unit) must be a named, distinguishable
  state, never a silent absence.
- OPEN-4 (env tune `MAX_PROJECTS_PER_TICK`) is still undecided by Sara —
  Slice 2's coverage-request mechanism partially obsoletes it (priority
  drain beats global tuning for the case she cares about); reconcile
  rather than duplicate.
- Slices ship independently, in order, each through the full
  team-intake → team-qa → team-build pipeline on its own effort branch.

## Corrections

**2026-08-06, by Slice 4's intake (`intake-project-manager`, per `DEC-S4-5`).**
Two premises above are now known false. Recorded here, append-only — the text
above is Sara's own and is left intact.

1. **"OPEN-4 (env tune `MAX_PROJECTS_PER_TICK`) is still undecided by Sara"**
   (the `## Constraints / carry-forwards` bullet above) — **closed**, not
   pending. `DEC-3` (Slice 2, 2026-08-05) settled `MAX_PROJECTS_PER_TICK`'s
   default of 3 as a spec; there is to be no second tuning mechanism. See
   `DEC-3` in Slice 2's `decisions.md`; do not re-argue it.
2. **"the claims API's atomic inline `new_item` already supports the shape"**
   (the acceptance-signal bullet above, on group-or-unit claim into a new
   item/sub-item) — **false since 2026-08-02.** `POST /:id(\d+)/claims`'s
   `new_item` path inserts the plan item **before** validating
   `value_source`/`attribution`/`value_ref`, with no
   `dbModule.db.transaction(...)` anywhere in the handler — a valid `new_item`
   plus an invalid `value_source` leaves a committed, orphaned plan item. Fixed
   in Slice 4a as an our-cost bug carve-out; see `DEC-S4-2` in this slice's
   `decisions.md`.
