/**
 * @file The single home (DEC-5, §9.1 DERIVED-DUAL-VIEW) for Value Pool
 * Slice 2's coverage/ETA computation. `described` / `pending` / `complete` /
 * `demand` / an ETA is computed HERE and nowhere else — the HTTP route
 * (`GET /api/project-plans/coverage`) and the WS broadcast
 * (`value_altitudes_updated`'s widened `coverage` field) both carry this
 * module's object VERBATIM (enforced by the named parity test,
 * `server/__tests__/value-coverage-parity.test.js`, G2). The client
 * (`PlanLedgerPanel.tsx`) renders these fields; it never recomputes any of
 * them.
 *
 * Fed SOLELY by the composer's own `counts` (Slice 1's `enrichPoolAltitudes`
 * return, DEC-14 extended one hop, never bypassed) — this module contains
 * NO pool-membership SQL and NO membership query of its own (DEC-16's
 * sole-composer rule, inherited unmodified from Slice 1: `assembleValuePool`
 * is the only place pool membership is ever read). `estimateEta`'s only SQL
 * is `listRecentValueGenerationDurations(ForProject)` — a read of PAST
 * generation-log rows, not pool membership.
 *
 * `demand` and `eta.state` are closed, server-authored registries (the
 * `ALTITUDE_STATES` precedent) — see {@link DEMAND_STATES} /
 * {@link ETA_STATES}. Never hand-typed at any consumer; the client's own
 * copies (`types.ts`, `PlanLedgerPanel.tsx`) each carry a doc comment naming
 * this module as their canonical source (WATCH-S2-F, the
 * `TrunkDriftResult["skipped"]` precedent).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { MAX_UNITS_PER_PROMPT } = require("./value-summary");

/** The only three values {@link coverageSnapshot}'s `demand` field may carry
 *  — never hand-typed at any consumer; import this export instead.
 *  `passive`: no outstanding coverage request, ordinary least-recently-swept
 *  rotation. `requested`: a coverage request is outstanding but the drain has
 *  not (yet, or not currently) run an iteration for it this instant.
 *  `draining`: a drain iteration is actively in flight for this project right
 *  now. A flag that survives a no-progress exit (WATCH-8/DEC-8) still reads
 *  `requested`, never silently collapsing to `passive` — §9.8
 *  OVERLOADED-ABSENCE is the exact failure this registry exists to close. */
const DEMAND_STATES = ["passive", "requested", "draining"];

/** The only three values {@link estimateEta}'s `state` field may carry —
 *  never hand-typed at any consumer; import this export instead. `measured`:
 *  at least one qualifying historical generation-log row exists, so
 *  `ms_remaining`/`per_batch_ms`/`batches_remaining` are real measurements,
 *  never a guess. `estimating`: `pending > 0` but zero qualifying rows exist
 *  anywhere (cold start, fleet-wide) — the client renders a named string, not
 *  a fabricated `~0 min` (technical-plan.md §8: "a rendered `~0 min` is a
 *  requirement violation, not a rounding choice"). `none`: `pending === 0` —
 *  coverage is already complete, so no ETA is meaningful. */
const ETA_STATES = ["measured", "estimating", "none"];

/** How many of the most recent qualifying generation-log rows feed the
 *  average (architect's ruling, open point B) — recent enough to reflect
 *  current model/pool conditions, wide enough that one anomalous row can't
 *  dominate the average. */
const ETA_SAMPLE_SIZE = 5;

/**
 * Computes the ETA for draining `pending` units to zero, from real measured
 * durations only — never a guess. Reads ONLY
 * `listRecentValueGenerationDurations(ForProject)` (K={@link ETA_SAMPLE_SIZE},
 * `outcome='ok' AND generated > 0 AND duration_ms IS NOT NULL`, sorted
 * `created_at DESC, id DESC` before `LIMIT` — §9.2). Per-project history is
 * tried first; a project with no measurement history of its own falls back
 * to the fleet-wide sample (open point B). `ms_remaining = avg(duration_ms) x
 * ceil(pending / MAX_UNITS_PER_PROMPT)` — the per-BATCH average (not
 * per-unit), since one generation-log row already measures one whole
 * ≤{@link MAX_UNITS_PER_PROMPT}-unit batch.
 *
 * NO pool SQL, no membership SQL in this function (DEC-16).
 *
 * @param {object} dbModule
 * @param {{projectId: string, pending: number}} args
 * @returns {{state: "measured", ms_remaining: number, per_batch_ms: number, batches_remaining: number}
 *   | {state: "estimating"} | {state: "none"}}
 */
function estimateEta(dbModule, { projectId, pending }) {
  if (!(pending > 0)) return { state: "none" };

  let rows = dbModule.stmts.listRecentValueGenerationDurationsForProject.all(
    projectId,
    ETA_SAMPLE_SIZE
  );
  if (!rows || rows.length === 0) {
    rows = dbModule.stmts.listRecentValueGenerationDurations.all(ETA_SAMPLE_SIZE);
  }
  if (!rows || rows.length === 0) return { state: "estimating" };

  const totalMs = rows.reduce((sum, r) => sum + r.duration_ms, 0);
  const perBatchMs = totalMs / rows.length;
  const batchesRemaining = Math.ceil(pending / MAX_UNITS_PER_PROMPT);

  return {
    state: "measured",
    ms_remaining: Math.round(perBatchMs * batchesRemaining),
    per_batch_ms: Math.round(perBatchMs),
    batches_remaining: batchesRemaining,
  };
}

/**
 * The single computed-once coverage object — carried verbatim by the HTTP
 * route and the WS broadcast (G2 parity test). `described`/`pending`/
 * `complete` are the ONLY arithmetic derived from `counts`, and this is the
 * ONLY function in the codebase that derives them (§9.1: the guard must
 * catch a re-COMPUTATION, not merely a rogue read — see
 * `value-coverage-parity.test.js`'s red-proof).
 *
 * @param {object} dbModule
 * @param {{
 *   projectId: string,
 *   counts: {pool_size: number, queued: number, unavailable: number},
 *   requestedAt: string|null,
 *   draining: boolean,
 *   computedAt: string
 * }} args
 * @returns {{
 *   project_id: string,
 *   described: number,
 *   pool_size: number,
 *   pending: number,
 *   complete: boolean,
 *   demand: "passive"|"requested"|"draining",
 *   requested_at: string|null,
 *   eta: object,
 *   computed_at: string
 * }}
 */
function coverageSnapshot(dbModule, { projectId, counts, requestedAt, draining, computedAt }) {
  const poolSize = counts.pool_size;
  const pending = counts.queued + counts.unavailable;
  const described = poolSize - counts.queued - counts.unavailable;
  const complete = pending === 0;

  let demand;
  if (!requestedAt) {
    demand = "passive";
  } else if (draining) {
    demand = "draining";
  } else {
    demand = "requested";
  }

  const eta = estimateEta(dbModule, { projectId, pending });

  return {
    project_id: projectId,
    described,
    pool_size: poolSize,
    pending,
    complete,
    demand,
    requested_at: requestedAt ?? null,
    eta,
    computed_at: computedAt || new Date().toISOString(),
  };
}

module.exports = {
  coverageSnapshot,
  estimateEta,
  DEMAND_STATES,
  ETA_STATES,
  ETA_SAMPLE_SIZE,
};
