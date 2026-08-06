/**
 * @file Background tick that sweeps projects in least-recently-swept
 * rotation, calls `enrichPoolAltitudes` exactly once per swept project, and
 * logs sweep state & generation metrics. This is the durable fix for
 * `server/lib/value-summary.js`'s ≤40-unit-per-request cap: the request path
 * (`POST /api/project-plans/altitudes`) stays synchronous and unchanged, and
 * this tick drains whatever the request path could not reach this round,
 * unattended, across later cycles.
 *
 * Deliberately does NOT assemble the pool itself — every sweep calls
 * `value-ledger.js`'s `assembleValuePool` and only it (DEC-16's single home
 * for pool membership; a structural test asserts no hand-rolled
 * `FROM project_paths` / `FROM detour_dispositions` / `detectTrunkDrift`
 * query lives in this file). Deliberately does NOT write the stakeholder-
 * altitude cache table itself either — `enrichPoolAltitudes` (in
 * `value-summary.js`) is the ONE lexical writer of that table; this tick is
 * a second *invoker* of that composer, never a second writer (§9.1
 * DERIVED-DUAL-VIEW, single-writer-guard.test.js).
 *
 * `pending_after_sweep` is RE-DERIVED every sweep from that sweep's own
 * `queued + unavailable` counts — never decremented from a prior value, and
 * never read from a stale `pool_size`. A project whose pool grows between
 * sweeps (an active repo minting new units faster than its rotation slot
 * drains) must show that growth here, not a falsely-converging number
 * (qa/decisions.md QA-DEC-2 / WATCH-8).
 *
 * Mirrors `focus-inference.js:554-591` and `reconciliation.js:444-480`'s
 * scheduler shape (boot-delay timeout, then a steady-state interval, both
 * `.unref()`'d), with one deliberate improvement: the overlap guard wraps
 * the exported `runValueSummaryTickOnce` callable itself, not just the
 * timer closure, so it is directly testable.
 *
 * Value Pool Slice 2 (coverage-on-demand, DEC-4/DEC-5/DEC-6/DEC-8) adds
 * `runCoverageDrain(dbModule, projectId, opts)` — a bounded, back-to-back
 * ≤{@link MAX_UNITS_PER_PROMPT}-unit-batch loop for ONE explicitly requested
 * project, sharing this module's SAME `running` overlap guard with
 * `runValueSummaryTickOnce` (DEC-4: one runner, one guard — this makes the
 * inherited WATCH-7 two-writer race structurally impossible, not
 * re-litigated). Both functions route their per-project work through the
 * shared {@link sweepOneProject} helper (mechanical bookkeeping only — never
 * a second computation of `described`/`complete`/`demand`/ETA, which stays
 * exclusively `server/lib/value-coverage.js`'s job, DEC-5/§9.1; the one
 * exception is `pending_after_sweep`, an internal-only `queued+unavailable`
 * echo `sweepOneProject` itself writes/returns as a DB bookkeeping column —
 * neither wire's `pending` is ever read from that value, only from the
 * single-home `coverageSnapshot` result, see `sweepOneProject`'s own doc),
 * and both widen their WS broadcast through {@link shouldBroadcastCoverage}
 * (DEC-6: `generated > 0` OR a `demand`/`complete` transition since the last
 * broadcast for that project — so a terminal "now complete" transition with
 * zero units generated this iteration is never silently dropped).
 *
 * Env knobs:
 *   DASHBOARD_VALUE_SUMMARY_TICK_MODE   on (default) | off
 *   DASHBOARD_VALUE_SUMMARY_TICK_MS     tick interval, default 600000 (10m)
 *   MAX_PROJECTS_PER_TICK               projects swept per tick, default 3
 *     — the drain path (runCoverageDrain) deliberately never reads this
 *     knob (DEC-3.3): it governs PASSIVE rotation width only, never the
 *     drain's own iteration cap, which is the separate, non-tunable
 *     {@link MAX_DRAIN_BATCHES_PER_RUN} safety bound below.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { assembleValuePool } = require("./value-ledger");
const { enrichPoolAltitudes } = require("./value-summary");
const { coverageSnapshot } = require("./value-coverage");

const DEFAULT_TICK_MS = 600_000; // DEC-5, matches DASHBOARD_FOCUS_INFER_MS
const BOOT_DELAY_MS = 30_000; // DEC-5, matches focus-inference.js
const DEFAULT_MAX_PROJECTS_PER_TICK = 3; // DEC-5: lower than reconciliation's
// 10 — each swept project costs a git walk (assembleValuePool) AND up to one
// LLM spawn (enrichPoolAltitudes), so the per-tick cost is higher per unit.

// Value Pool Slice 2 (DEC-8): a coverage request older than this reverts to
// passive — cleared with one loud log line, never silently. Prevents a
// permanently-failing requested project (broken repo root, every unit
// unavailable) from sorting first forever and burning a rotation slot +
// LLM spawns indefinitely.
const COVERAGE_REQUEST_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Value Pool Slice 2 (DEC-3.3): a hard SAFETY BOUND on one runCoverageDrain
// call, NOT an env-tunable knob (no MAX_DRAIN_* family exists — grep
// confirms it before every "done" declaration). Sized against the parent
// effort's own measured real pool (182 units — the same measurement DEC-3
// part 3 requires this bound's declaring comment to cite, per §9.8's bounds
// rule): at MAX_UNITS_PER_PROMPT=40 units/batch, a full from-scratch drain of
// that pool is ceil(182/40) = 5 iterations. 25 gives 5x headroom for real
// fleet growth while still bounding one fire-and-forget drain's worst-case
// LLM spend and wall-clock time.
const MAX_DRAIN_BATCHES_PER_RUN = 25;

let running = false; // module-scope overlap guard, SHARED by
// runValueSummaryTickOnce and runCoverageDrain (DEC-4) — this is what makes
// the two-writer race (WATCH-7) structurally impossible rather than merely
// discouraged: whichever one calls first wins the module-scope flag, and the
// other returns {skipped: "overlap"} immediately.
let poolAssembler = assembleValuePool; // DEC-15 seam; production default only

// Value Pool Slice 2 (build-reviewer SF-3): the project id `runCoverageDrain`
// is ACTIVELY draining right now, or `null` when no drain is in flight. Set
// synchronously the instant the drain acquires the shared `running` guard
// (before its first `await`), cleared in the same `finally` that releases
// `running` — so a caller synchronously kicking `runCoverageDrain(...)` and
// then immediately composing an HTTP response (POST /coverage-request) sees
// this flip to the correct project id before it reads it. Exported via
// {@link isDrainingProject} so both HTTP routes (POST /coverage-request,
// GET /coverage) can report a REAL `demand: "draining"` instead of a
// hardcoded `draining: false` that can disagree with the WS broadcast for
// the same instant.
let drainingProjectId = null;

// Value Pool Slice 2 (DEC-6): per-project memory of the demand/complete pair
// last actually broadcast, so {@link shouldBroadcastCoverage} can detect a
// TRANSITION (not just "generated > 0"). Deliberately in-memory only (never
// persisted) — a process restart simply treats the next observation for
// every project as "no prior broadcast." (SF-6 fix, §9.8 OVERLOADED-ABSENCE:
// this used to be described as a state that "can only ever SUPPRESS one
// redundant early broadcast, never fabricate a false one" — that claim was
// false whenever the first-ever observation was already `complete` with
// `generated === 0`, which silently dropped the terminal broadcast entirely.
// The real rule: a first observation (no prior in this map) broadcasts iff
// the pool is already `complete`; otherwise `generated > 0` alone governs
// it, identical to the pre-Slice-2 behavior.)
let lastBroadcastState = new Map();

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** The TTL cutoff, as an ISO string, computed in JS (never `datetime('now')`
 *  inside a statement — keeps every TTL comparison testable with a fixed
 *  `now`). A `coverage_requested_at` at or after this cutoff is still live;
 *  anything older is treated as expired. */
function ttlCutoffIso(nowIso) {
  return new Date(new Date(nowIso).getTime() - COVERAGE_REQUEST_TTL_MS).toISOString();
}

/** Next `limit` projects to sweep, coverage-requested-first (Value Pool
 *  Slice 2, DEC-4 — a live, non-TTL-expired request jumps to the head of the
 *  rotation, oldest request first), then least-recently-swept first among
 *  the rest (never-swept projects sort before any real timestamp — §9.2,
 *  `last_swept_at` is a real timestamp, never a row id). Synchronous — a
 *  plain prepared-statement read. `cutoffIso` defaults to "now minus the
 *  TTL" so every pre-Slice-2 call site (which never passed a third argument)
 *  keeps working unchanged. */
function listSweepTargets(dbModule, limit, cutoffIso) {
  const cutoff = cutoffIso || ttlCutoffIso(new Date().toISOString());
  return dbModule.stmts.listValueSweepTargets.all(cutoff, limit);
}

/**
 * DEC-8's proactive half: clears every coverage request older than the TTL,
 * WITH a loud log line naming the project (never a silent revert), before
 * target selection runs. Belt-and-braces alongside `listValueSweepTargets`'s
 * own cutoff parameter (which merely sorts an expired request as passive
 * without clearing it) — this is what actually reverts `demand` back to
 * `"passive"` on the wire and frees the rotation slot for good, not just for
 * one tick's ordering.
 * @param {object} dbModule
 * @param {string} nowIso
 * @returns {number} how many requests were expired-and-cleared
 */
function sweepExpiredCoverageRequests(dbModule, nowIso) {
  const cutoff = ttlCutoffIso(nowIso);
  const expired = dbModule.stmts.listExpiredCoverageRequests.all(cutoff);
  for (const row of expired) {
    dbModule.stmts.clearValueCoverageRequest.run(row.project_id);
    console.warn(
      `value summary coverage request TTL-expired for project ${row.project_id} ` +
        `(requested_at=${row.coverage_requested_at}, cutoff=${cutoff}) — reverting to passive`
    );
  }
  return expired.length;
}

/**
 * Decides whether ONE sweep's result should broadcast, and updates this
 * module's per-project memory of the last-broadcast `demand`/`complete` pair
 * (Value Pool Slice 2, DEC-6). Widened from the pre-Slice-2 rule
 * (`generated > 0` alone) to ALSO fire on a `demand`/`complete` TRANSITION —
 * otherwise a terminal iteration that reaches 100% with zero units generated
 * THIS iteration (every remaining miss resolved on a PRIOR iteration, this
 * one's only job was re-deriving `pending` down to 0) would silently never
 * tell an open tab coverage finished. (SF-6 fix, §9.8 OVERLOADED-ABSENCE: a
 * project with no prior recorded broadcast used to be treated unconditionally
 * as "unchanged," which collapsed two genuinely distinguishable outcomes —
 * "never observed" and "first observation, already complete" — into the same
 * silent absence, and dropped the terminal broadcast whenever a pool was
 * already fully described before its first-ever sweep in this process
 * (`generated === 0`). The real rule: a first observation broadcasts iff the
 * pool is already `complete`; otherwise `generated > 0` alone governs it,
 * identical to the pre-Slice-2 behavior — so a first observation that is
 * NOT yet complete still does not spuriously broadcast.)
 * @param {string} projectId
 * @param {number} generated
 * @param {"passive"|"requested"|"draining"} demand
 * @param {boolean} complete
 * @returns {boolean}
 */
function shouldBroadcastCoverage(projectId, generated, demand, complete) {
  const prior = lastBroadcastState.get(projectId);
  const transitioned = prior
    ? prior.demand !== demand || prior.complete !== complete
    : complete === true;
  lastBroadcastState.set(projectId, { demand, complete });
  return generated > 0 || transitioned;
}

/**
 * The mechanical per-project sweep body, shared by `runValueSummaryTickOnce`
 * (one iteration per swept target) and `runCoverageDrain` (repeated for the
 * same project until drained). Fail-safe: one project's assembly/synthesis
 * failure never throws out of this function — it degrades to
 * `outcome: "error"` with a zeroed pool so the audit row still satisfies the
 * unconditional four-term partition. Rotation advance is written BEFORE the
 * audit-log row so a failure on the log insert can never pin this project's
 * rotation slot. Computes `queued + unavailable` ONLY as the
 * `pending_after_sweep` bookkeeping column this function itself writes/
 * returns (never `described`, never `complete`, never `demand`, never an
 * ETA) — that internal value is NOT what either wire carries. Every
 * consumer-facing `pending` (the HTTP route response and the WS broadcast
 * payload) is read from `value-coverage.js`'s `coverageSnapshot` result,
 * which callers build from the SAME counts this function returns, never
 * from this function's own `pending` field (§9.1, build-reviewer SF-1 —
 * do not let this function's internal bookkeeping arithmetic pose as the
 * single home's computation).
 * @param {object} dbModule
 * @param {string} projectId
 * @param {string} nowIso
 * @returns {Promise<{outcome: "ok"|"error", poolSize: number, cacheHits: number,
 *   generated: number, queued: number, unavailable: number, staleRegenerated: number,
 *   model: string|null, generatedKeys: string[], pending: number, bookkeepingOk: boolean}>}
 */
async function sweepOneProject(dbModule, projectId, nowIso) {
  const startedAt = Date.now();
  let outcome = "ok";
  let poolSize = 0;
  let cacheHits = 0;
  let generated = 0;
  let queued = 0;
  let unavailable = 0;
  let staleRegenerated = 0;
  let model = null;
  const generatedKeys = [];

  try {
    const { units } = await poolAssembler(dbModule, { id: projectId });
    poolSize = units.length;
    // Counts are read verbatim from the composer's own computed-once
    // partition object (DEC-14, §9.8) — this tick never re-derives a
    // hit/generated/queued/unavailable count from `altitudes`/`states`
    // itself, the exact T-A/T-F-shaped hazard the composer's `counts`
    // return exists to close off.
    const { altitudes, counts } = await enrichPoolAltitudes(dbModule, units);
    poolSize = counts.pool_size;
    cacheHits = counts.cache_hits;
    generated = counts.generated;
    queued = counts.queued;
    unavailable = counts.unavailable;
    staleRegenerated = counts.stale_regenerated;
    for (const [unitKey, entry] of Object.entries(altitudes)) {
      if (!entry.cached && model == null) model = entry.model;
      if (!entry.cached) generatedKeys.push(unitKey);
    }
  } catch (err) {
    // Per-project fail-safe: one bad project cannot stop the sweep. Log
    // loudly (§9.6) — a bare swallow makes a genuine outage silent — and
    // zero poolSize so the audit row still satisfies db.js's unconditional
    // four-term partition (cache_hits + generated + queued + unavailable
    // === pool_size) even on a MIXED failure (assembleValuePool succeeded,
    // so poolSize was already set above, and enrichPoolAltitudes threw).
    outcome = "error";
    poolSize = 0;
    console.warn(`value summary sweep failed for project ${projectId}:`, err.message);
  }

  // Deliberately NOT a `finally` on the try above (a finally cannot be
  // caught by its own catch — S1): this runs unconditionally as the next
  // statement, but wrapped in its own try/catch so a DB write failure
  // here (e.g. SQLITE_BUSY on this shared DB_PATH) can't escape and abort
  // the rest of the sweep. Rotation advance is written BEFORE the audit
  // log row so a failure on the audit insert can never pin this
  // project's rotation slot and starve everything behind it.
  let bookkeepingOk = true;
  try {
    const durationMs = Date.now() - startedAt;
    if (outcome === "error") {
      // Do NOT overwrite pending_after_sweep with 0 on a failed sweep —
      // that is indistinguishable from "fully drained" (§9.8
      // OVERLOADED-ABSENCE). Leave whatever the last successful sweep
      // recorded standing (or 0 only if this project has never
      // completed a sweep at all).
      dbModule.stmts.upsertValueSweepStateKeepPending.run(projectId, nowIso);
    } else {
      // Re-derived from THIS sweep's own counts, never decremented from a
      // prior value — see the file header's T-C note.
      dbModule.stmts.upsertValueSweepState.run(projectId, nowIso, queued + unavailable);
    }
    dbModule.stmts.insertValueSummaryGeneration.run(
      projectId,
      "tick",
      outcome,
      poolSize,
      cacheHits,
      generated,
      queued,
      unavailable,
      model,
      durationMs,
      outcome === "error" ? null : staleRegenerated
    );
  } catch (err) {
    bookkeepingOk = false;
    console.warn(`value summary sweep bookkeeping failed for project ${projectId}:`, err.message);
  }

  return {
    outcome,
    poolSize,
    cacheHits,
    generated,
    queued,
    unavailable,
    staleRegenerated,
    model,
    generatedKeys,
    pending: queued + unavailable,
    bookkeepingOk,
  };
}

/**
 * Builds this sweep's coverage snapshot and, if warranted, broadcasts it —
 * shared tail of one sweep iteration for both `runValueSummaryTickOnce` and
 * `runCoverageDrain`. Only called on `outcome === "ok"` (an errored sweep's
 * zeroed-out counts would otherwise misreport `complete: true` — the
 * pre-Slice-2 code never broadcast on an error branch either, since
 * `generated` stays 0 there). Guarded in its own try/catch so a coverage-
 * computation or broadcast-callback failure can never abort the sweep loop
 * itself (same fail-safe discipline as the bookkeeping write above).
 * @returns {object|null} the built snapshot, or null if outcome !== "ok"
 */
function buildAndMaybeBroadcastCoverage(
  dbModule,
  projectId,
  result,
  requestedAt,
  draining,
  nowIso,
  broadcast
) {
  if (result.outcome !== "ok") return null;
  try {
    const snapshot = coverageSnapshot(dbModule, {
      projectId,
      counts: {
        pool_size: result.poolSize,
        queued: result.queued,
        unavailable: result.unavailable,
      },
      requestedAt,
      draining,
      computedAt: nowIso,
    });
    if (shouldBroadcastCoverage(projectId, result.generated, snapshot.demand, snapshot.complete)) {
      const payload = {
        project_id: projectId,
        unit_keys: result.generatedKeys,
        // Read from the single-home snapshot (server/lib/value-coverage.js),
        // never `result.pending` — `result.pending` is sweepOneProject's own
        // internal bookkeeping value (also `pending_after_sweep`'s DB input),
        // and this payload must not carry a second computation of the same
        // contract field one field apart from `coverage.pending` (§9.1,
        // build-reviewer SF-1).
        pending: snapshot.pending,
        coverage: snapshot,
      };
      if (broadcast) broadcast("value_altitudes_updated", payload);
      return { snapshot, payload, broadcasted: true };
    }
    return { snapshot, payload: null, broadcasted: false };
  } catch (err) {
    console.warn(`value summary coverage broadcast failed for project ${projectId}:`, err.message);
    return null;
  }
}

/**
 * Runs one sweep cycle: up to `MAX_PROJECTS_PER_TICK` projects,
 * coverage-requested-first (DEC-4's "drain-first resume" — a project whose
 * `runCoverageDrain` was previously interrupted re-enters here, one
 * iteration per passive tick, until either it completes or a fresh
 * `runCoverageDrain` call picks it back up), each swept with exactly one
 * `assembleValuePool` call and exactly one `enrichPoolAltitudes` call via
 * {@link sweepOneProject}.
 *
 * @param {object} dbModule
 * @param {{broadcast?: Function, now?: string}} [opts]
 * @returns {Promise<{skipped: "overlap"} | {swept: number, projects: Array<{project_id: string, generated: number, queued: number, unavailable: number}>}>}
 */
async function runValueSummaryTickOnce(dbModule, opts = {}) {
  const { broadcast, now } = opts;
  if (running) return { skipped: "overlap" };
  running = true;
  try {
    // Clamped to >= 1 (nit N1): an unset/typo'd/empty value coerces to 0,
    // which would silently sweep nothing forever, and SQLite treats a
    // negative LIMIT as "no limit," which would sweep the entire fleet in
    // one tick — exactly what DEC-2/DEC-5 bounded this to avoid.
    const maxProjects = Math.max(
      1,
      Math.floor(numEnv("MAX_PROJECTS_PER_TICK", DEFAULT_MAX_PROJECTS_PER_TICK))
    );
    const nowIso = now || new Date().toISOString();
    // DEC-8 TTL sweep runs BEFORE target selection, so an expired request
    // never even sorts as "requested" for this cycle's rotation.
    sweepExpiredCoverageRequests(dbModule, nowIso);
    const targets = listSweepTargets(dbModule, maxProjects, ttlCutoffIso(nowIso));
    const projects = [];
    const broadcastEvents = [];

    for (const target of targets) {
      const projectId = target.project_id;
      const result = await sweepOneProject(dbModule, projectId, nowIso);

      // Coverage bookkeeping (Value Pool Slice 2, DEC-4 "drain-first
      // resume"): a still-live request that this one sweep iteration
      // brought to zero pending clears here, in the same pass as the
      // bookkeeping sweepOneProject already wrote.
      let requestedAt = target.coverage_requested_at || null;
      if (requestedAt && result.outcome === "ok" && result.pending === 0) {
        dbModule.stmts.clearValueCoverageRequest.run(projectId);
        requestedAt = null;
      }

      const covered = buildAndMaybeBroadcastCoverage(
        dbModule,
        projectId,
        result,
        requestedAt,
        false, // draining: the passive tick never reports "draining" — only
        // runCoverageDrain's own active loop does; a passive resume
        // iteration reports "requested" (or "passive" once cleared above).
        nowIso,
        broadcast
      );
      if (covered && covered.broadcasted) {
        broadcastEvents.push({ event: "value_altitudes_updated", payload: covered.payload });
      }

      projects.push({
        project_id: projectId,
        generated: result.generated,
        queued: result.queued,
        unavailable: result.unavailable,
      });
    }

    return { swept: targets.length, projects, broadcast: broadcastEvents };
  } finally {
    running = false;
  }
}

/**
 * Value Pool Slice 2 (DEC-4): drains ONE explicitly requested project in
 * bounded back-to-back ≤{@link MAX_UNITS_PER_PROMPT}-unit batches, sharing
 * this module's SAME `running` overlap guard with `runValueSummaryTickOnce`
 * (a concurrent call — from either function — returns
 * `{skipped: "overlap"}`). Each iteration re-assembles the pool and
 * re-derives `pending` from THAT iteration's own full-pool counts (WATCH-8:
 * never a locally decremented counter), so a pool that grows mid-drain
 * extends the drain for free rather than falsely converging.
 *
 * Named, mutually-exclusive exit conditions (never a silent stop):
 *  (a) `complete` — `queued === 0 && unavailable === 0` this iteration: the
 *      flag clears in the SAME write as the final sweep-state upsert, and
 *      the terminal snapshot broadcasts.
 *  (b) `error` — this iteration's `outcome === "error"`: stop, KEEP the
 *      flag (transient errors must resume, DEC-8).
 *  (c) `no_progress` — `generated === 0` while `pending > 0`: stop, KEEP
 *      the flag (nothing was actually attempted/produced this round, so
 *      looping again immediately would only repeat the same outcome).
 *  (d) `ttl_expired` — the request aged past `COVERAGE_REQUEST_TTL_MS`
 *      mid-drain: cleared with a log line, drain stops.
 *  (e) `not_requested` — the flag was already cleared by something else
 *      (e.g. a concurrent TTL sweep) before this drain's first iteration:
 *      stop immediately, nothing to drain.
 *  (f) `iteration_cap` — hit {@link MAX_DRAIN_BATCHES_PER_RUN} without any
 *      of the above: stop, KEEP the flag (a later drain or the passive
 *      tick's drain-first resume picks it back up).
 *
 * @param {object} dbModule
 * @param {string} projectId
 * @param {{broadcast?: Function, now?: string}} [opts]
 * @returns {Promise<{skipped: "overlap"} | {projectId: string, iterations: number,
 *   exitReason: "complete"|"error"|"no_progress"|"ttl_expired"|"not_requested"|"iteration_cap",
 *   lastResult: object|null}>}
 */
async function runCoverageDrain(dbModule, projectId, opts = {}) {
  const { broadcast, now } = opts;
  if (running) return { skipped: "overlap" };
  running = true;
  drainingProjectId = projectId; // SF-3: set synchronously, before any
  // await, so a caller that fires this off (fire-and-forget) and then
  // immediately composes an HTTP response observes the correct project id.
  try {
    let iterations = 0;
    let exitReason = null;
    let lastResult = null;

    while (iterations < MAX_DRAIN_BATCHES_PER_RUN) {
      iterations += 1;
      const nowIso = now || new Date().toISOString();

      const state = dbModule.stmts.getValueSweepState.get(projectId);
      const requestedAt = state ? state.coverage_requested_at : null;
      if (!requestedAt) {
        exitReason = "not_requested";
        break;
      }
      const cutoff = ttlCutoffIso(nowIso);
      if (requestedAt < cutoff) {
        dbModule.stmts.clearValueCoverageRequest.run(projectId);
        console.warn(
          `value summary coverage request TTL-expired for project ${projectId} mid-drain ` +
            `(requested_at=${requestedAt}, cutoff=${cutoff}) — reverting to passive`
        );
        exitReason = "ttl_expired";
        break;
      }

      const result = await sweepOneProject(dbModule, projectId, nowIso);
      lastResult = result;

      const isComplete = result.outcome === "ok" && result.pending === 0;
      let currentRequestedAt = requestedAt;
      if (isComplete) {
        dbModule.stmts.clearValueCoverageRequest.run(projectId);
        currentRequestedAt = null;
      }

      buildAndMaybeBroadcastCoverage(
        dbModule,
        projectId,
        result,
        currentRequestedAt,
        !isComplete, // draining: true for every non-terminal iteration,
        // false the moment this iteration reaches completion (the terminal
        // snapshot reports "requested"'s natural successor state — passive,
        // since the flag is already cleared above — not "draining").
        nowIso,
        broadcast
      );

      if (result.outcome === "error") {
        exitReason = "error"; // keep the flag — resume next tick/drain
        break;
      }
      if (isComplete) {
        exitReason = "complete";
        break;
      }
      if (result.generated === 0) {
        exitReason = "no_progress"; // keep the flag
        break;
      }
      // Progress was made and pending > 0 — loop for another batch.
    }

    if (exitReason === null) exitReason = "iteration_cap";
    return { projectId, iterations, exitReason, lastResult };
  } finally {
    running = false;
    drainingProjectId = null; // SF-3: released in the same finally as the
    // shared overlap guard, on every exit path (including a thrown error).
  }
}

/** Value Pool Slice 2 (build-reviewer SF-3): the real, project-scoped drain
 *  accessor — `true` iff `runCoverageDrain` currently has an active
 *  iteration in flight for `projectId`, `false` otherwise (never requested,
 *  requested-but-not-yet-draining, or drained-and-finished). Both HTTP
 *  routes (`POST /coverage-request`, `GET /coverage`) call this instead of
 *  hardcoding `draining: false`, so the closed `demand` registry's
 *  `"draining"` value is actually reachable from the wire and cannot
 *  disagree with a concurrent WS broadcast for the same instant.
 * @param {string} projectId
 * @returns {boolean}
 */
function isDrainingProject(projectId) {
  return drainingProjectId === projectId;
}

/** Start the scheduler loop: boot-delay tick, then a slow steady-state
 *  interval. Mirrors reconciliation.js's startReconciliation almost
 *  verbatim. Disable with DASHBOARD_VALUE_SUMMARY_TICK_MODE=off or
 *  DASHBOARD_VALUE_SUMMARY_TICK_MS<=0. Untouched by Value Pool Slice 2
 *  (engineer's explicit correction — a coverage request's own kick is
 *  fire-and-forget from the route handler, never routed through this
 *  scheduler). */
function startValueSummaryTick(broadcast) {
  const mode = (process.env.DASHBOARD_VALUE_SUMMARY_TICK_MODE || "on").toLowerCase();
  if (mode === "off") return;
  const tickMs = numEnv("DASHBOARD_VALUE_SUMMARY_TICK_MS", DEFAULT_TICK_MS);
  if (!Number.isFinite(tickMs) || tickMs <= 0) return;

  const dbModule = require("../db");

  const boot = setTimeout(() => {
    runValueSummaryTickOnce(dbModule, { broadcast }).catch(() => {});
  }, BOOT_DELAY_MS);
  if (boot.unref) boot.unref();

  const timer = setInterval(() => {
    runValueSummaryTickOnce(dbModule, { broadcast }).catch(() => {});
  }, tickMs);
  if (timer.unref) timer.unref();
}

/** Test seam (DEC-15): overrides the pool assembler production default
 *  (`assembleValuePool`, which does live git work on every call) with a
 *  hermetic stand-in. `fn == null` restores the production default. */
function __injectPoolAssemblerForTest(fn) {
  poolAssembler = fn || assembleValuePool;
}

/** Resets module-scope state between tests (the overlap guard, the
 *  Slice-2 last-broadcast-state memory, and the SF-3 drain accessor). */
function __resetTickStateForTest() {
  running = false;
  lastBroadcastState = new Map();
  drainingProjectId = null;
}

module.exports = {
  startValueSummaryTick,
  runValueSummaryTickOnce,
  runCoverageDrain,
  listSweepTargets,
  isDrainingProject,
  __injectPoolAssemblerForTest,
  __resetTickStateForTest,
  DEFAULT_TICK_MS,
  BOOT_DELAY_MS,
  DEFAULT_MAX_PROJECTS_PER_TICK,
  COVERAGE_REQUEST_TTL_MS,
  MAX_DRAIN_BATCHES_PER_RUN,
};
