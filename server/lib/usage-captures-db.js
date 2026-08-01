/**
 * @file usage-captures-db.js
 * @description Persistence layer for the `usage_captures` table (see
 * server/db.js) — one row per manual "Usage" page capture (server/lib/usage-capture.js
 * drives `claude`'s `/status` and `/usage` TUI panels via tmux and parses the
 * rendered text into this shape). Mirrors the read/write split already used
 * by server/lib/dashboard-runs.js for the Run page's history table.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { db } = require("../db");

const insertStmt = db.prepare(`
  INSERT INTO usage_captures (
    cwd, status, error_message,
    account_email, account_org, login_method, cli_version, model,
    session_cost_usd, session_duration_api_s, session_duration_wall_s,
    lines_added, lines_removed,
    session_input_tokens, session_output_tokens,
    session_cache_read_tokens, session_cache_write_tokens,
    session_window_pct, session_window_reset_raw, week_window_pct, week_reset_raw,
    week_pct_by_model_json, contributing_factors_json, skills_json, subagents_json,
    raw_status_text, raw_usage_text
  ) VALUES (
    @cwd, @status, @error_message,
    @account_email, @account_org, @login_method, @cli_version, @model,
    @session_cost_usd, @session_duration_api_s, @session_duration_wall_s,
    @lines_added, @lines_removed,
    @session_input_tokens, @session_output_tokens,
    @session_cache_read_tokens, @session_cache_write_tokens,
    @session_window_pct, @session_window_reset_raw, @week_window_pct, @week_reset_raw,
    @week_pct_by_model_json, @contributing_factors_json, @skills_json, @subagents_json,
    @raw_status_text, @raw_usage_text
  )
`);

// List view omits the two raw-text columns (can be several KB each) since the
// history list only needs the parsed summary fields; GET /api/usage/:id
// fetches the full row including raw text on demand.
const listStmt = db.prepare(`
  SELECT id, captured_at, cwd, status, error_message,
         account_email, account_org, login_method, cli_version, model,
         session_cost_usd, session_window_pct, session_window_reset_raw,
         week_window_pct, week_reset_raw
  FROM usage_captures
  ORDER BY captured_at DESC
  LIMIT @limit
`);

const getStmt = db.prepare(`SELECT * FROM usage_captures WHERE id = @id`);

/**
 * Insert one capture result and return the freshly-inserted row (with its
 * assigned id and DB-default `captured_at`). Every field is optional —
 * callers pass `null`/`undefined` for anything the capture/parse couldn't
 * determine, and this never throws away the raw pane text even when parsing
 * the structured fields failed.
 */
function recordCapture(fields = {}) {
  const row = {
    cwd: fields.cwd || "",
    status: fields.status || "error",
    error_message: fields.errorMessage ?? null,
    account_email: fields.accountEmail ?? null,
    account_org: fields.accountOrg ?? null,
    login_method: fields.loginMethod ?? null,
    cli_version: fields.cliVersion ?? null,
    model: fields.model ?? null,
    session_cost_usd: fields.sessionCostUsd ?? null,
    session_duration_api_s: fields.sessionDurationApiS ?? null,
    session_duration_wall_s: fields.sessionDurationWallS ?? null,
    lines_added: fields.linesAdded ?? null,
    lines_removed: fields.linesRemoved ?? null,
    session_input_tokens: fields.sessionInputTokens ?? null,
    session_output_tokens: fields.sessionOutputTokens ?? null,
    session_cache_read_tokens: fields.sessionCacheReadTokens ?? null,
    session_cache_write_tokens: fields.sessionCacheWriteTokens ?? null,
    session_window_pct: fields.sessionWindowPct ?? null,
    session_window_reset_raw: fields.sessionWindowResetRaw ?? null,
    week_window_pct: fields.weekWindowPct ?? null,
    week_reset_raw: fields.weekResetRaw ?? null,
    week_pct_by_model_json: fields.weekPctByModelJson ?? null,
    contributing_factors_json: fields.contributingFactorsJson ?? null,
    skills_json: fields.skillsJson ?? null,
    subagents_json: fields.subagentsJson ?? null,
    raw_status_text: fields.rawStatusText ?? null,
    raw_usage_text: fields.rawUsageText ?? null,
  };
  const info = insertStmt.run(row);
  return getStmt.get({ id: info.lastInsertRowid });
}

function listCaptures({ limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  return listStmt.all({ limit: safeLimit });
}

function getCapture(id) {
  return getStmt.get({ id }) || null;
}

module.exports = { recordCapture, listCaptures, getCapture };
