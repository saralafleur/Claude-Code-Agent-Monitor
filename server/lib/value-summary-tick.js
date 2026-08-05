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
 * Env knobs:
 *   DASHBOARD_VALUE_SUMMARY_TICK_MODE   on (default) | off
 *   DASHBOARD_VALUE_SUMMARY_TICK_MS     tick interval, default 600000 (10m)
 *   MAX_PROJECTS_PER_TICK               projects swept per tick, default 3
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { assembleValuePool } = require("./value-ledger");
const { enrichPoolAltitudes } = require("./value-summary");

const DEFAULT_TICK_MS = 600_000; // DEC-5, matches DASHBOARD_FOCUS_INFER_MS
const BOOT_DELAY_MS = 30_000; // DEC-5, matches focus-inference.js
const DEFAULT_MAX_PROJECTS_PER_TICK = 3; // DEC-5: lower than reconciliation's
// 10 — each swept project costs a git walk (assembleValuePool) AND up to one
// LLM spawn (enrichPoolAltitudes), so the per-tick cost is higher per unit.

let running = false; // module-scope overlap guard
let poolAssembler = assembleValuePool; // DEC-15 seam; production default only

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** Next `limit` projects to sweep, least-recently-swept first (never-swept
 *  projects sort before any real timestamp — §9.2, `last_swept_at` is a real
 *  timestamp, never a row id). Synchronous — a plain prepared-statement read. */
function listSweepTargets(dbModule, limit) {
  return dbModule.stmts.listValueSweepTargets.all(limit);
}

/**
 * Runs one sweep cycle: up to `MAX_PROJECTS_PER_TICK` projects, each swept
 * with exactly one `assembleValuePool` call and exactly one
 * `enrichPoolAltitudes` call. Fail-safe per project — one project's assembly
 * or synthesis failure never stops the rest of the sweep, and that project's
 * rotation still advances (its `last_swept_at` is written unconditionally,
 * in its own guarded try/catch, right after the sweep attempt), so a single
 * pathological project can never starve every project behind it. A failed
 * sweep never overwrites that project's `pending_after_sweep` with 0 (§9.8
 * OVERLOADED-ABSENCE) — only a successful sweep re-derives that count.
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
    const targets = listSweepTargets(dbModule, maxProjects);
    const nowIso = now || new Date().toISOString();
    const projects = [];

    for (const target of targets) {
      const projectId = target.project_id;
      const startedAt = Date.now();
      let outcome = "ok";
      let poolSize = 0;
      let cacheHits = 0;
      let generated = 0;
      let queued = 0;
      let unavailable = 0;
      let model = null;
      const generatedKeys = [];

      try {
        const { units } = await poolAssembler(dbModule, { id: projectId });
        poolSize = units.length;
        const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);
        for (const [unitKey, entry] of Object.entries(altitudes)) {
          if (entry.cached) {
            cacheHits += 1;
          } else {
            generated += 1;
            generatedKeys.push(unitKey);
            if (model == null) model = entry.model;
          }
        }
        for (const state of Object.values(states)) {
          if (state === "queued") queued += 1;
          else if (state === "unavailable") unavailable += 1;
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
          durationMs
        );
        if (generated > 0 && broadcast) {
          broadcast("value_altitudes_updated", {
            project_id: projectId,
            unit_keys: generatedKeys,
            pending: queued + unavailable,
          });
        }
      } catch (err) {
        console.warn(
          `value summary sweep bookkeeping failed for project ${projectId}:`,
          err.message
        );
      }

      projects.push({ project_id: projectId, generated, queued, unavailable });
    }

    return { swept: targets.length, projects };
  } finally {
    running = false;
  }
}

/** Start the scheduler loop: boot-delay tick, then a slow steady-state
 *  interval. Mirrors reconciliation.js's startReconciliation almost
 *  verbatim. Disable with DASHBOARD_VALUE_SUMMARY_TICK_MODE=off or
 *  DASHBOARD_VALUE_SUMMARY_TICK_MS<=0. */
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

/** Resets module-scope state between tests (the overlap guard). */
function __resetTickStateForTest() {
  running = false;
}

module.exports = {
  startValueSummaryTick,
  runValueSummaryTickOnce,
  listSweepTargets,
  __injectPoolAssemblerForTest,
  __resetTickStateForTest,
  DEFAULT_TICK_MS,
  BOOT_DELAY_MS,
  DEFAULT_MAX_PROJECTS_PER_TICK,
};
