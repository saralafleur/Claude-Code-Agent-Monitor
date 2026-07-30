/**
 * @file Express router for settings-related endpoints, providing system info, database statistics, hook status, and operations to clear data, re-import sessions, reinstall hooks, reset pricing, export data, and perform cleanup of stale sessions. This allows the frontend to manage and maintain the agent monitoring system effectively.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { db, stmts, DB_PATH, DEFAULT_PRICING, applyIntroPricing } = require("../db");
const { getConnectionCount } = require("../websocket");
const { transcriptCache } = require("./hooks");

const router = Router();

const { getSettingsPath, getClaudeHome, setClaudeHome } = require("../lib/claude-home");
const CLAUDE_SETTINGS_PATH = getSettingsPath();

function getDbSize() {
  try {
    const stat = fs.statSync(DB_PATH);
    return stat.size;
  } catch {
    return 0;
  }
}

function getTableCounts() {
  const tables = ["sessions", "agents", "events", "model_pricing"];
  const counts = {};
  for (const t of tables) {
    counts[t] = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
  }
  counts.token_usage = db
    .prepare("SELECT COUNT(DISTINCT session_id) as c FROM token_usage")
    .get().c;
  return counts;
}

// Live snapshot of the focus-window-summary cache for the Settings → Focus
// Summaries section's stat tiles: `size` is the current focus_summaries row
// count (unlike TranscriptCache, this table has no LRU cap — it's meant to
// grow and persist), `hits`/`misses` are cumulative since the log has
// existed (see the Data section's purge_days for retention), and
// `totalBullets` is a cheap proxy for "how much is cached" since these rows
// don't carry a byte size.
function getFocusSummaryCacheStats() {
  const size = db.prepare("SELECT COUNT(*) AS c FROM focus_summaries").get().c;
  const totalBullets = db
    .prepare("SELECT bullets FROM focus_summaries")
    .all()
    .reduce((sum, row) => {
      try {
        const bullets = JSON.parse(row.bullets);
        return sum + (Array.isArray(bullets) ? bullets.length : 0);
      } catch {
        return sum;
      }
    }, 0);
  const { hits, misses } = db
    .prepare(
      `SELECT
         SUM(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
         SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END) AS misses
       FROM focus_summary_access_log`
    )
    .get();
  const h = hits || 0;
  const m = misses || 0;
  const total = h + m;
  return {
    size,
    hits: h,
    misses: m,
    hitRate: total > 0 ? +((h / total) * 100).toFixed(1) : 0,
    totalBullets,
  };
}

function getHookStatus() {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return { installed: false, path: CLAUDE_SETTINGS_PATH, hooks: {} };
    }
    const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf8");
    const settings = JSON.parse(raw);
    const hookTypes = [
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "SubagentStop",
      "Notification",
      "SessionStart",
      "SessionEnd",
    ];
    const hooks = {};
    for (const ht of hookTypes) {
      const entries = settings.hooks?.[ht] || [];
      hooks[ht] = entries.some(
        (e) =>
          (e.command && e.command.includes("hook-handler.js")) ||
          (Array.isArray(e.hooks) &&
            e.hooks.some((h) => h.command && h.command.includes("hook-handler.js")))
      );
    }
    const installed = Object.values(hooks).every(Boolean);
    return { installed, path: CLAUDE_SETTINGS_PATH, hooks };
  } catch {
    return { installed: false, path: CLAUDE_SETTINGS_PATH, hooks: {} };
  }
}

// GET /api/settings/info — system info, db stats, hook status
router.get("/info", (req, res) => {
  const dbSize = getDbSize();
  const counts = getTableCounts();
  const hookStatus = getHookStatus();

  // Advanced SQLite info
  const pragmas = {
    journal_mode: db.pragma("journal_mode", { simple: true }),
    synchronous: db.pragma("synchronous", { simple: true }),
    auto_vacuum: db.pragma("auto_vacuum", { simple: true }),
    encoding: db.pragma("encoding", { simple: true }),
    foreign_keys: db.pragma("foreign_keys", { simple: true }),
    busy_timeout: db.pragma("busy_timeout", { simple: true }),
  };

  // Recent activity load (events in last 5, 15, 60 minutes)
  const getCount = (ms) => {
    const d = new Date(Date.now() - ms).toISOString();
    return db.prepare("SELECT COUNT(*) as c FROM events WHERE created_at > ?").get(d).c;
  };

  const load_stats = {
    m5: getCount(5 * 60 * 1000),
    m15: getCount(15 * 60 * 1000),
    h1: getCount(60 * 60 * 1000),
  };

  res.json({
    db: {
      path: DB_PATH,
      size: dbSize,
      counts,
      pragmas,
      load_stats,
    },
    hooks: hookStatus,
    server: {
      uptime: process.uptime(),
      node_version: process.version,
      platform: process.platform,
      ws_connections: getConnectionCount(),
      memory: process.memoryUsage(),
      cpu_load: os.loadavg(),
      arch: os.arch(),
      total_mem: os.totalmem(),
      free_mem: os.freemem(),
      cpus: os.cpus().length,
    },
    transcript_cache: transcriptCache.stats(),
    focus_summary_cache: getFocusSummaryCacheStats(),
  });
});

// POST /api/settings/clear-data — delete all sessions, agents, events, tokens
router.post("/clear-data", (_req, res) => {
  const counts = getTableCounts();
  db.pragma("foreign_keys = OFF");
  db.prepare("DELETE FROM token_usage").run();
  db.prepare("DELETE FROM events").run();
  db.prepare("DELETE FROM agents").run();
  db.prepare("DELETE FROM sessions").run();
  // Fired alerts reference the cleared sessions — wipe the feed too. Alert
  // *rules* survive: they're user configuration, like model_pricing.
  db.prepare("DELETE FROM alert_events").run();
  // Webhook delivery log is an audit trail of those fired alerts — wipe it too.
  // Webhook *targets* survive, like alert rules and pricing.
  db.prepare("DELETE FROM webhook_deliveries").run();
  // Focus-summary access log is an audit trail too — wipe it alongside the
  // other history. The focus_summaries cache itself is untouched by design:
  // clearing recorded history shouldn't force every cached window/day to
  // regenerate (a finished day's summary is meant to be kept).
  db.prepare("DELETE FROM focus_summary_access_log").run();
  db.pragma("foreign_keys = ON");
  res.json({ ok: true, cleared: counts });
});

// GET /api/settings/cache/timeline?days=30 — day-bucketed hit/miss counts
// for the focus-window-summary cache (server/lib/focus-summary.js), oldest
// first, zero-filled so the client never has to fill gaps. Days are UTC
// calendar days, matching every other timestamp this schema stores.
router.get("/cache/timeline", (req, res) => {
  const parsedDays = parseInt(req.query.days, 10);
  const days = Math.min(90, Math.max(1, Number.isFinite(parsedDays) ? parsedDays : 30));
  const rows = db
    .prepare(
      `SELECT access_day AS day,
              SUM(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
              SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END) AS misses
       FROM focus_summary_access_log
       WHERE access_day >= date('now', ?)
       GROUP BY access_day`
    )
    .all(`-${days - 1} days`);
  const byDay = new Map(rows.map((r) => [r.day, r]));

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const iso = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const r = byDay.get(iso);
    const hits = r ? r.hits : 0;
    const misses = r ? r.misses : 0;
    out.push({ date: iso, hits, misses, total: hits + misses });
  }
  res.json({ days: out });
});

// Resolves a logged access row's scope columns to a human-readable label:
// a session-scoped row names the session, a project-scoped row names the
// project, an unassigned-scoped row is labeled "Unassigned", and anything
// else (shouldn't happen given how routes/focus-report.js builds scope, but
// defensive) falls back to "All projects".
function scopeLabel(row) {
  if (row.session_id) return row.session_name || row.session_id;
  if (row.project_id) return row.project_name || row.project_id;
  if (row.unassigned) return "Unassigned";
  return "All projects";
}

// GET /api/settings/cache/day?date=YYYY-MM-DD&outcome=hit|miss&model=Name&level=window|day —
// summary + entry list for a single UTC calendar day of focus-summary cache
// activity, joined to sessions/projects for a human-readable label. Capped
// at 500 rows (truncated flag tells the client, rather than silently
// dropping the rest of a very busy day).
router.get("/cache/day", (req, res) => {
  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_DATE", message: "date is required as YYYY-MM-DD" } });
  }
  const outcome =
    req.query.outcome === "hit" || req.query.outcome === "miss" ? req.query.outcome : null;
  const level = req.query.level === "window" || req.query.level === "day" ? req.query.level : null;
  const model =
    typeof req.query.model === "string" && req.query.model.trim() ? req.query.model.trim() : null;

  const summary = db
    .prepare(
      `SELECT
         SUM(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
         SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END) AS misses
       FROM focus_summary_access_log WHERE access_day = ?`
    )
    .get(date);

  let sql = `
    SELECT l.cache_key, l.level, l.outcome, l.project_id, l.session_id, l.unassigned,
           l.model, l.bullet_count, l.accessed_at,
           p.name AS project_name, s.name AS session_name
    FROM focus_summary_access_log l
    LEFT JOIN projects p ON p.id = l.project_id
    LEFT JOIN sessions s ON s.id = l.session_id
    WHERE l.access_day = ?`;
  const params = [date];
  if (outcome) {
    sql += " AND l.outcome = ?";
    params.push(outcome);
  }
  if (level) {
    sql += " AND l.level = ?";
    params.push(level);
  }
  if (model) {
    sql += " AND l.model = ?";
    params.push(model);
  }
  sql += " ORDER BY l.accessed_at DESC LIMIT 501";
  const rows = db.prepare(sql).all(...params);
  const truncated = rows.length > 500;
  if (truncated) rows.length = 500;

  const models = db
    .prepare(
      "SELECT DISTINCT model FROM focus_summary_access_log WHERE access_day = ? AND model IS NOT NULL ORDER BY model"
    )
    .all(date)
    .map((r) => r.model);

  res.json({
    date,
    hits: summary.hits || 0,
    misses: summary.misses || 0,
    total: (summary.hits || 0) + (summary.misses || 0),
    models,
    truncated,
    entries: rows.map((r) => ({
      cache_key: r.cache_key,
      level: r.level,
      scope_label: scopeLabel(r),
      model: r.model,
      outcome: r.outcome,
      bullet_count: r.bullet_count,
      accessed_at: r.accessed_at,
    })),
  });
});

// POST /api/settings/reimport — re-import legacy sessions from ~/.claude/
router.post("/reimport", async (_req, res) => {
  try {
    const { importAllSessions } = require("../../scripts/import-history");
    const dbModule = require("../db");
    const result = await importAllSessions(dbModule);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      error: { code: "IMPORT_FAILED", message: err.message },
    });
  }
});

// POST /api/settings/reinstall-hooks — reinstall Claude Code hooks
router.post("/reinstall-hooks", (_req, res) => {
  try {
    const { installHooks } = require("../../scripts/install-hooks");
    const success = installHooks(true);
    const hookStatus = getHookStatus();
    res.json({ ok: success, hooks: hookStatus });
  } catch (err) {
    res.status(500).json({
      error: { code: "HOOK_INSTALL_FAILED", message: err.message },
    });
  }
});

// POST /api/settings/reset-pricing — reset pricing to defaults
router.post("/reset-pricing", (_req, res) => {
  db.prepare("DELETE FROM model_pricing").run();

  const seedPricing = db.prepare(
    "INSERT OR IGNORE INTO model_pricing (model_pattern, display_name, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, cache_write_1h_per_mtok, fast_input_per_mtok, fast_output_per_mtok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const [pattern, name, inp, out, cr, cw, cw1h, fin, fout] of DEFAULT_PRICING) {
    seedPricing.run(pattern, name, inp, out, cr, cw, cw1h, fin, fout);
  }
  // Re-apply time-limited intro rates (e.g. Sonnet 5) — the seed above only
  // carries standard rates, so without this a reset silently drops the promo.
  applyIntroPricing(db);

  const pricing = stmts.listPricing.all();
  res.json({ ok: true, pricing });
});

// GET /api/settings/export — export all data as JSON
router.get("/export", (_req, res) => {
  const sessions = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC").all();
  const agents = db.prepare("SELECT * FROM agents ORDER BY started_at DESC").all();
  const events = db.prepare("SELECT * FROM events ORDER BY created_at DESC").all();
  const tokenUsage = db.prepare("SELECT * FROM token_usage").all();
  const pricing = stmts.listPricing.all();

  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="agent-monitor-export-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.json({
    exported_at: new Date().toISOString(),
    sessions,
    agents,
    events,
    token_usage: tokenUsage,
    model_pricing: pricing,
  });
});

// GET /api/settings/claude-home — get current CLAUDE_HOME path
router.get("/claude-home", (_req, res) => {
  res.json({ claude_home: getClaudeHome() });
});

// PUT /api/settings/claude-home — update CLAUDE_HOME path
router.put("/claude-home", (req, res) => {
  const { path: newPath } = req.body;
  if (!newPath || typeof newPath !== "string") {
    return res.status(400).json({
      error: { code: "INVALID_PATH", message: "path is required and must be a string" },
    });
  }
  try {
    const resolved = setClaudeHome(newPath);
    res.json({ ok: true, claude_home: resolved });
  } catch (err) {
    res.status(400).json({
      error: { code: "INVALID_PATH", message: err.message },
    });
  }
});

// POST /api/settings/cleanup — abandon stale sessions, purge old data
router.post("/cleanup", (req, res) => {
  const { abandon_hours, purge_days } = req.body;
  const result = {
    abandoned: 0,
    purged_sessions: 0,
    purged_events: 0,
    purged_agents: 0,
    purged_focus_summary_log: 0,
  };

  if (abandon_hours && typeof abandon_hours === "number" && abandon_hours > 0) {
    // Mark active sessions with no recent events as abandoned
    const cutoff = new Date(Date.now() - abandon_hours * 3600 * 1000).toISOString();
    const stale = db
      .prepare(
        `SELECT s.id FROM sessions s
         WHERE s.status = 'active'
           AND s.started_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM events e WHERE e.session_id = s.id AND e.created_at > ?
           )`
      )
      .all(cutoff, cutoff);

    for (const row of stale) {
      db.prepare(
        "UPDATE sessions SET status = 'abandoned', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
      ).run(row.id);
      // Also complete any lingering agents
      db.prepare(
        "UPDATE agents SET status = 'completed', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE session_id = ? AND status IN ('waiting','working')"
      ).run(row.id);
    }
    result.abandoned = stale.length;
  }

  if (purge_days && typeof purge_days === "number" && purge_days > 0) {
    const cutoff = new Date(Date.now() - purge_days * 86400 * 1000).toISOString();
    // Only purge completed/error/abandoned sessions, never active
    const toDelete = db
      .prepare(
        "SELECT id FROM sessions WHERE status IN ('completed','error','abandoned') AND started_at < ?"
      )
      .all(cutoff);

    if (toDelete.length > 0) {
      const ids = toDelete.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      // Cascading deletes handle agents/events, but token_usage FK might not cascade on all setups
      result.purged_events = db
        .prepare(`DELETE FROM events WHERE session_id IN (${placeholders})`)
        .run(...ids).changes;
      result.purged_agents = db
        .prepare(`DELETE FROM agents WHERE session_id IN (${placeholders})`)
        .run(...ids).changes;
      db.prepare(`DELETE FROM token_usage WHERE session_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...ids);
      result.purged_sessions = toDelete.length;
    }

    // Focus-summary access log has its own retention, independent of any
    // session still existing — it's activity history, not session data (and
    // not the cache itself, which this purge leaves alone). Reuses the same
    // purge_days input as the rest of this endpoint rather than adding a
    // second setting.
    result.purged_focus_summary_log = db
      .prepare("DELETE FROM focus_summary_access_log WHERE accessed_at < ?")
      .run(cutoff).changes;
  }

  res.json({ ok: true, ...result });
});

module.exports = router;
