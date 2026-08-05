/**
 * @file The Coach engine — evaluates the Playbook's enabled practices on a
 * tick and records the results as Observations. Scheduler shape mirrors
 * `../reconciliation.js`'s `startReconciliation` almost verbatim (boot
 * delay, `setInterval`, a `running` re-entrancy guard, `unref()`'d timers,
 * an env-var kill switch) — deliberately, so anyone who already understands
 * that scheduler understands this one.
 *
 * Evaluates session-scoped practices against currently-active sessions, plus
 * global-scoped practices once per tick (see `evaluateGlobal`) against
 * dashboard-wide state (e.g. every enabled account's latest usage). Project
 * scope isn't built yet — the schema supports it
 * (`coach_observations.scope_type`) for whenever a practice needs it.
 *
 * Every tick also runs two independent auto-resolve sweeps — the Coach's
 * closing half, not just its detecting half — one per scope, because a
 * session-scoped practice's condition and a global-scoped one's are
 * fundamentally different shapes:
 *
 *   - `autoResolveStaleObservations` (session scope): a session-scoped
 *     Observation (for a practice with `autoResolveOnSessionEnd` true)
 *     auto-transitions to `resolved` once its session has been ended for at
 *     least `playbook_settings.auto_resolve_after_ms` — a single global
 *     window, not per-practice. A still-active session's Observation is
 *     never auto-resolved regardless of age; `auto_resolve_after_ms = 0`
 *     disables the sweep entirely (not "resolve instantly on session end").
 *     Deliberately time-based, not condition-based: a session-scoped
 *     practice's condition (e.g. cumulative token count) only ever grows,
 *     so re-running `detect()` could never distinguish "fixed" from "still
 *     broken" the way session liveness can.
 *   - `autoResolveClearedGlobalObservations` (global scope): the opposite
 *     shape — a global-scoped practice's condition genuinely reverses (e.g.
 *     `account-weekly-balance`'s active-account-over-threshold clears on a
 *     weekly reset, or once the user actually rotates), so this sweep just
 *     re-runs `detect()` against fresh ctx each tick and resolves any
 *     already-open Observation whose practice no longer fires. No time
 *     window involved.
 *
 * See each function's own doc comment for its full design.
 *
 * Env knobs:
 *   DASHBOARD_PLAYBOOK_MODE  on (default) | off
 *   DASHBOARD_PLAYBOOK_MS    tick interval, default 300000 (5m)
 *   MAX_PLAYBOOK_TARGETS     active sessions evaluated per tick, default 200
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { PRACTICES, resolvePracticeConfig } = require("./practices");
const { computeLastUsedAt, isAccountActive } = require("../account-activity");

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

  for (const { practice, config, kind, severity } of sessionPractices) {
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
      kind,
      severity,
      JSON.stringify(result.values)
    );
    created.push(stmts.getCoachObservation.get(info.lastInsertRowid));
  }
  return created;
}

/** Every enabled account's latest known weekly-quota-used percentage plus
 *  whether it's the one actually in use right now, for a global-scoped
 *  practice's ctx — same "most recent capture" lookup and the exact same
 *  `computeLastUsedAt`/`isAccountActive` inference `routes/accounts.js`'s
 *  `serialize()` uses for the Usage page's own `is_active` field, so the
 *  Coach and the Usage page can never disagree about which account is
 *  active. */
function listAccountsWeeklyCtx(dbModule) {
  const usageCapturesDb = require("../usage-captures-db");
  return dbModule.stmts.listAccounts
    .all()
    .filter((a) => a.enabled)
    .map((a) => {
      const latest = usageCapturesDb.listCaptures({ accountId: a.id, limit: 1 })[0] || null;
      return {
        id: a.id,
        label: a.label,
        weeklyUsedPct: latest?.week_window_pct ?? null,
        isActive: isAccountActive(computeLastUsedAt(a.id)),
      };
    });
}

/** The Usage page's Rotation Plan switch threshold
 *  (`color_thresholds.rotation_switch_pct`) — shared, not duplicated, by
 *  `account-weekly-balance`'s ctx (see practices.js's file header for why
 *  this practice carries no field of its own for it). */
function getRotationSwitchPct(dbModule) {
  const row = dbModule.stmts.getColorThresholds.get();
  return row ? row.rotation_switch_pct : null;
}

/** Builds the shared ctx every global-scoped practice's `detect()` reads —
 *  one place so `evaluateGlobal` (new-observation detection) and
 *  `autoResolveClearedGlobalObservations` (resolving stale ones) can never
 *  drift onto two different snapshots of the same tick. */
function buildGlobalCtx(dbModule) {
  return {
    accounts: listAccountsWeeklyCtx(dbModule),
    rotationSwitchPct: getRotationSwitchPct(dbModule),
  };
}

/**
 * Evaluates every enabled global-scoped practice once per tick (not per
 * session) against dashboard-wide ctx, inserting (and returning) a new
 * Observation for each that fires and has no already-`open` Observation for
 * that exact practice — same dedup as `evaluateSession`, keyed with a null
 * `scope_id` since a global observation isn't about any one session/project.
 */
function evaluateGlobal(dbModule, enabledPractices) {
  const { stmts } = dbModule;
  const created = [];
  const globalPractices = enabledPractices.filter((p) => p.practice.scope === "global");
  if (globalPractices.length === 0) return created;

  const ctx = buildGlobalCtx(dbModule);

  for (const { practice, config, kind, severity } of globalPractices) {
    const result = practice.detect(ctx, config);
    if (!result) continue;
    const existing = stmts.getOpenCoachObservation.get(practice.id, "global", null, null);
    if (existing) continue;
    const info = stmts.insertCoachObservation.run(
      practice.id,
      "global",
      null,
      kind,
      severity,
      JSON.stringify(result.values)
    );
    created.push(stmts.getCoachObservation.get(info.lastInsertRowid));
  }
  return created;
}

/**
 * Auto-resolve sweep: closes an open Observation by writing
 * status='resolved' via the same `updateCoachObservationStatus` a human
 * Dismiss uses (just a different status value — 'resolved' vs 'dismissed',
 * so the two dispositions stay distinguishable in the DB even though the
 * Feed currently treats any non-'open' status identically: leave the list).
 * Zero client changes were needed for this — CoachPage.tsx already drops an
 * Observation from the open-only Feed the instant a
 * `coach_observation_updated` push shows a non-'open' status, whatever the
 * new status is.
 *
 * ONE trigger, deliberately: a still-active session's open Observation is
 * NEVER auto-resolved, no matter how long it's been open — only once its
 * session has actually ended does the clock start. For every catalog
 * practice whose *resolved* `autoResolveOnSessionEnd` field is `true`
 * (checked regardless of the practice's own enabled/disabled state — an
 * already-open Observation should still get cleaned up even after its
 * practice is turned off), an open session-scoped Observation resolves once
 * its session has been non-'active' (or deleted outright) for at least
 * `playbook_settings.auto_resolve_after_ms` — a single global window, not a
 * per-practice field (see practices.js's file header), so a new practice
 * never has to configure this itself and there's exactly one dial to reason
 * about. `auto_resolve_after_ms = 0` disables the sweep entirely — it does
 * NOT mean "resolve immediately on session end"; a still-open Observation
 * then only ever leaves the Feed via a human Dismiss. The recommended action
 * ("compact or clear this session") is moot once a session can't be
 * compacted or cleared anymore, independent of whether the practice's own
 * condition (e.g. total tokens still over threshold) still technically
 * holds — a session's cumulative token count only ever grows, so re-running
 * `detect()` here could never tell "no longer an issue" from "still an
 * issue" the way session liveness can.
 *
 * Runs on every tick regardless of `enabledPractices` (unlike
 * evaluateSession/evaluateGlobal, which only run when at least one practice
 * is enabled) - cleanup of what's already open must not depend on anything
 * currently being enabled to detect NEW occurrences.
 */
function autoResolveStaleObservations(dbModule, opts = {}) {
  const { stmts } = dbModule;
  const staleIds = new Set();

  const settings = stmts.getPlaybookSettings.get();
  const autoResolveAfterMs = settings ? settings.auto_resolve_after_ms : 0;
  if (autoResolveAfterMs > 0) {
    const cutoff = new Date(Date.now() - autoResolveAfterMs).toISOString();
    for (const practice of PRACTICES) {
      if (practice.scope !== "session") continue;
      const row = stmts.getPlaybookPracticeConfig.get(practice.id);
      const { config } = resolvePracticeConfig(row, practice);
      if (config.autoResolveOnSessionEnd !== true) continue;
      for (const { id } of stmts.listOpenSessionObservationsWithEndedSession.all(
        practice.id,
        cutoff
      )) {
        staleIds.add(id);
      }
    }
  }

  const resolved = [];
  for (const id of staleIds) {
    stmts.updateCoachObservationStatus.run("resolved", id);
    resolved.push(stmts.getCoachObservation.get(id));
  }
  if (opts.broadcast) {
    for (const observation of resolved) {
      opts.broadcast("coach_observation_updated", observation);
    }
  }
  return resolved;
}

/**
 * Auto-resolve sweep #2, global scope only: unlike a session-scoped
 * practice's monotonic condition (see `autoResolveStaleObservations`'s doc
 * comment for why that one is time-based, not condition-based), a
 * global-scoped practice's condition genuinely reverses — e.g.
 * `account-weekly-balance`'s "active account over the rotation threshold"
 * clears the moment a weekly reset lands, or once the user actually
 * rotates onto the recommended account. So this sweep just re-runs
 * `detect()` against a fresh ctx each tick: if a global-scoped practice
 * (checked for every catalog entry, regardless of enabled/disabled state —
 * same "cleanup of what's already open doesn't depend on being currently
 * enabled" reasoning as the session sweep) already has an open Observation
 * and `detect()` no longer fires, the recommendation is stale and resolves
 * immediately — no time window involved, since there's nothing here that
 * needs waiting out the way a session needs to actually finish.
 */
function autoResolveClearedGlobalObservations(dbModule, opts = {}) {
  const { stmts } = dbModule;
  const globalPractices = PRACTICES.filter((p) => p.scope === "global");
  if (globalPractices.length === 0) return [];

  const ctx = buildGlobalCtx(dbModule);
  const resolved = [];

  for (const practice of globalPractices) {
    const existing = stmts.getOpenCoachObservation.get(practice.id, "global", null, null);
    if (!existing) continue;
    const row = stmts.getPlaybookPracticeConfig.get(practice.id);
    const { config } = resolvePracticeConfig(row, practice);
    if (practice.detect(ctx, config)) continue; // still firing — leave it open
    stmts.updateCoachObservationStatus.run("resolved", existing.id);
    resolved.push(stmts.getCoachObservation.get(existing.id));
  }

  if (opts.broadcast) {
    for (const observation of resolved) {
      opts.broadcast("coach_observation_updated", observation);
    }
  }
  return resolved;
}

/** One tick: enabled practices × active sessions (capped) + global-scoped practices once, broadcasting each new Observation; then both auto-resolve sweeps. */
function tick(dbModule, opts = {}) {
  const enabledPractices = resolveEnabledPractices(dbModule);
  const created = [];

  if (enabledPractices.length > 0) {
    const maxTargets = numEnv("MAX_PLAYBOOK_TARGETS", DEFAULT_MAX_TARGETS);
    const sessionIds = listActiveSessionIds(dbModule, maxTargets);
    for (const sessionId of sessionIds) {
      try {
        created.push(...evaluateSession(dbModule, sessionId, enabledPractices));
      } catch {
        /* per-session fail-safe: one bad session must not stop the tick */
      }
    }
    try {
      created.push(...evaluateGlobal(dbModule, enabledPractices));
    } catch {
      /* one bad global evaluation must not stop the tick */
    }
  }
  if (opts.broadcast) {
    for (const observation of created) {
      opts.broadcast("coach_observation_created", observation);
    }
  }

  try {
    autoResolveStaleObservations(dbModule, opts);
  } catch {
    /* the auto-resolve sweep must not fail the tick that also created these */
  }
  try {
    autoResolveClearedGlobalObservations(dbModule, opts);
  } catch {
    /* same fail-safe — a bad global re-check must not fail the tick */
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
  evaluateGlobal,
  autoResolveStaleObservations,
  autoResolveClearedGlobalObservations,
  resolveEnabledPractices,
  sumSessionTokens,
};
