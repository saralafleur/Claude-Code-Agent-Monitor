/**
 * @file The Coach engine — evaluates the Playbook's enabled practices on a
 * tick and records the results as Observations. Scheduler shape mirrors
 * `../reconciliation.js`'s `startReconciliation` almost verbatim (boot
 * delay, `setInterval`, a `running` re-entrancy guard, `unref()`'d timers,
 * an env-var kill switch) — deliberately, so anyone who already understands
 * that scheduler understands this one.
 *
 * v1 only evaluates session-scoped practices against currently-active
 * sessions; project/global-scoped evaluation isn't built yet (the schema
 * supports it — `coach_observations.scope_type` — for when a practice
 * needs it).
 *
 * Env knobs:
 *   DASHBOARD_PLAYBOOK_MODE  on (default) | off
 *   DASHBOARD_PLAYBOOK_MS    tick interval, default 300000 (5m)
 *   MAX_PLAYBOOK_TARGETS     active sessions evaluated per tick, default 200
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { PRACTICES, resolvePracticeConfig } = require("./practices");

const DEFAULT_TICK_MS = 300_000;
const BOOT_DELAY_MS = 30_000;
const DEFAULT_MAX_TARGETS = 200;

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** Every practice's current `{ practice, enabled, config }`, defaults merged with any stored override. */
function resolveEnabledPractices(dbModule) {
  const { stmts } = dbModule;
  const rows = new Map(stmts.listPlaybookPracticeConfigs.all().map((r) => [r.practice_id, r]));
  return PRACTICES.map((practice) => ({
    practice,
    ...resolvePracticeConfig(rows.get(practice.id), practice),
  })).filter((p) => p.enabled);
}

function listActiveSessionIds(dbModule, limit) {
  return dbModule.db
    .prepare("SELECT id FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT ?")
    .all(limit)
    .map((r) => r.id);
}

/** Sum of every token dimension token_usage tracks for one session, baselines included
 *  (same columns `scoped-stats.js`'s `tokenTotals` sums, collapsed to one grand total). */
function sumSessionTokens(dbModule, sessionId) {
  const row = dbModule.db
    .prepare(
      `SELECT COALESCE(SUM(
         input_tokens + baseline_input +
         output_tokens + baseline_output +
         cache_read_tokens + baseline_cache_read +
         cache_write_tokens + baseline_cache_write
       ), 0) AS total
       FROM token_usage WHERE session_id = ?`
    )
    .get(sessionId);
  return row.total;
}

/**
 * Evaluates every enabled session-scoped practice against one session,
 * inserting (and returning) a new Observation for each that fires and has
 * no already-`open` Observation for that exact practice+session — the
 * dedup that keeps the engine from re-firing every tick.
 */
function evaluateSession(dbModule, sessionId, enabledPractices) {
  const { stmts } = dbModule;
  const created = [];
  const sessionPractices = enabledPractices.filter((p) => p.practice.scope === "session");
  if (sessionPractices.length === 0) return created;

  const totalTokens = sumSessionTokens(dbModule, sessionId);
  const ctx = { totalTokens };

  for (const { practice, config } of sessionPractices) {
    const result = practice.detect(ctx, config);
    if (!result) continue;
    const existing = stmts.getOpenCoachObservation.get(
      practice.id,
      "session",
      sessionId,
      sessionId
    );
    if (existing) continue;
    const info = stmts.insertCoachObservation.run(
      practice.id,
      "session",
      sessionId,
      practice.kind,
      practice.defaultSeverity,
      JSON.stringify(result.values)
    );
    created.push(stmts.getCoachObservation.get(info.lastInsertRowid));
  }
  return created;
}

/** One tick: enabled practices × active sessions (capped), broadcasting each new Observation. */
function tick(dbModule, opts = {}) {
  const enabledPractices = resolveEnabledPractices(dbModule);
  if (enabledPractices.length === 0) return [];
  const maxTargets = numEnv("MAX_PLAYBOOK_TARGETS", DEFAULT_MAX_TARGETS);
  const sessionIds = listActiveSessionIds(dbModule, maxTargets);

  const created = [];
  for (const sessionId of sessionIds) {
    try {
      created.push(...evaluateSession(dbModule, sessionId, enabledPractices));
    } catch {
      /* per-session fail-safe: one bad session must not stop the tick */
    }
  }
  if (opts.broadcast) {
    for (const observation of created) {
      opts.broadcast("coach_observation_created", observation);
    }
  }
  return created;
}

/** Start the scheduler loop: boot-delay tick, then a slow steady-state interval. */
function startPlaybookEngine(broadcast) {
  const mode = (process.env.DASHBOARD_PLAYBOOK_MODE || "on").toLowerCase();
  if (mode === "off") return;
  const tickMs = numEnv("DASHBOARD_PLAYBOOK_MS", DEFAULT_TICK_MS);
  if (!Number.isFinite(tickMs) || tickMs <= 0) return;

  const dbModule = require("../../db");
  let running = false;

  const runTick = () => {
    if (running) return;
    running = true;
    try {
      tick(dbModule, { broadcast });
    } catch {
      /* a bad tick must not take down the scheduler */
    } finally {
      running = false;
    }
  };

  const boot = setTimeout(runTick, BOOT_DELAY_MS);
  if (boot.unref) boot.unref();

  const timer = setInterval(runTick, tickMs);
  if (timer.unref) timer.unref();
}

module.exports = {
  startPlaybookEngine,
  tick,
  evaluateSession,
  resolveEnabledPractices,
  sumSessionTokens,
};
