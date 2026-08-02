/**
 * @file accounts.js
 * @description Express router for named Claude accounts used by the
 * multi-account Usage feature — each account just points at a
 * `CLAUDE_CONFIG_DIR` the user has already run `claude login` into (see
 * server/lib/claude-cli-credentials.js). No secret is ever stored or
 * accepted here: `POST /:id/capture` (and the automatic scheduler,
 * server/lib/account-capture-scheduler.js) reads that account's OAuth
 * credential live from the OS keychain (or, on Linux, a file) via
 * server/lib/account-capture.js, which persists the result into the
 * existing `usage_captures` table scoped by `account_id`. Each listed
 * account also carries `last_used_at`/`is_active`: real usage is often
 * done through whichever profile is logged into the *default* `~/.claude`
 * dir, not through this account's own named CLAUDE_CONFIG_DIR (that dir
 * exists only to hold a separate OAuth credential this dashboard can poll),
 * so `last_used_at` is inferred from movement in the account's own
 * session/weekly rate-limit percentage between captures (see
 * server/lib/account-activity.js) rather than from anything
 * CLAUDE_CONFIG_DIR-local — and, deliberately, not from `last_capture_at`,
 * which only reflects manual dashboard refreshes, not actual account
 * activity.
 *
 *   GET    /api/accounts                    — list accounts + each one's latest known %s
 *   POST   /api/accounts                    — add an account { label, configDir }
 *   DELETE /api/accounts/:id                — remove an account (capture history kept)
 *   POST   /api/accounts/:id/capture        — fetch + persist a fresh capture for one account
 *   POST   /api/accounts/:id/login-terminal — open a Terminal.app window running
 *                                             `CLAUDE_CONFIG_DIR=<dir> claude` so the
 *                                             user can log this profile in (macOS only)
 *
 * Security model: same loopback-Origin guard as `/api/usage` and `/api/run`
 * — `/:id/capture` makes a real outbound network call using a live OAuth
 * token, so it must not be drive-by triggerable from an arbitrary webpage
 * (see server/lib/origin-guard.js).
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { stmts } = require("../db");
const { sameOriginGuard } = require("../lib/origin-guard");
const { captureAccount } = require("../lib/account-capture");
const { computeLastUsedAt, isAccountActive } = require("../lib/account-activity");
const usageCapturesDb = require("../lib/usage-captures-db");
// Required as a module object (not destructured) so tests can swap
// `terminalFocus.openLoginTerminalForConfigDir` and this route picks the
// stub up at call time — same idiom routes/projects.js and routes/sessions.js
// use for their own terminal-focus calls.
const terminalFocus = require("../lib/terminal-focus");

const router = Router();

router.use(sameOriginGuard);

function serialize(row) {
  const latest = usageCapturesDb.listCaptures({ accountId: row.id, limit: 1 })[0] || null;
  const lastUsedAt = computeLastUsedAt(row.id);
  return {
    id: row.id,
    label: row.label,
    config_dir: row.config_dir,
    account_email: row.account_email,
    account_org: row.account_org,
    enabled: !!row.enabled,
    status: row.status,
    last_error: row.last_error,
    last_capture_id: row.last_capture_id,
    last_capture_at: row.last_capture_at,
    last_used_at: lastUsedAt,
    is_active: isAccountActive(lastUsedAt),
    created_at: row.created_at,
    updated_at: row.updated_at,
    latest_session_window_pct: latest?.session_window_pct ?? null,
    latest_session_window_reset_raw: latest?.session_window_reset_raw ?? null,
    latest_week_window_pct: latest?.week_window_pct ?? null,
    latest_week_reset_raw: latest?.week_reset_raw ?? null,
  };
}

// GET / — list all accounts with their latest known usage percentages.
router.get("/", (_req, res) => {
  const rows = stmts.listAccounts.all();
  res.json({ accounts: rows.map(serialize) });
});

// POST / — add an account. Validates configDir is a real, existing directory;
// does not require a valid login yet (that's discoverable via /:id/capture).
router.post("/", (req, res) => {
  const body = req.body || {};
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const configDirInput = typeof body.configDir === "string" ? body.configDir.trim() : "";

  if (!label) {
    return res.status(400).json({ error: { code: "EBADLABEL", message: "label is required" } });
  }
  if (!configDirInput) {
    return res
      .status(400)
      .json({ error: { code: "EBADCONFIGDIR", message: "configDir is required" } });
  }

  const absConfigDir = path.resolve(os.homedir(), configDirInput);
  let stat;
  try {
    stat = fs.statSync(absConfigDir);
  } catch {
    return res.status(400).json({
      error: { code: "ENOCONFIGDIR", message: `${configDirInput} does not exist` },
    });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({
      error: { code: "ENOTADIR", message: `${configDirInput} is not a directory` },
    });
  }

  if (stmts.getAccountByConfigDir.get(absConfigDir)) {
    return res.status(409).json({
      error: { code: "EDUPLICATE", message: "An account for this config dir already exists" },
    });
  }

  const id = `acct_${crypto.randomBytes(6).toString("hex")}`;
  stmts.insertAccount.run(id, label, absConfigDir, 1);
  res.status(201).json({ account: serialize(stmts.getAccount.get(id)) });
});

// DELETE /:id — remove the account. Its past captures keep their (now
// orphaned) account_id, same as remote_sources deletion leaving sessions alone.
router.delete("/:id", (req, res) => {
  const existing = stmts.getAccount.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: { code: "ENOTFOUND", message: "account not found" } });
  }
  stmts.deleteAccount.run(req.params.id);
  res.json({ ok: true });
});

/**
 * Trigger a fresh capture for one account (same shared flow the automatic
 * scheduler uses — see server/lib/account-capture.js). If the credential
 * isn't usable (no login yet, expired, or an unreadable/invalid stored
 * credential), that's an expected, actionable state — reported as 200, not
 * a 500 — since nothing on this server is broken.
 */
router.post("/:id/capture", async (req, res) => {
  const account = stmts.getAccount.get(req.params.id);
  if (!account) {
    return res.status(404).json({ error: { code: "ENOTFOUND", message: "account not found" } });
  }

  const result = await captureAccount(account);

  if (result.credStatus !== "ok") {
    return res.status(200).json({
      account: serialize(stmts.getAccount.get(account.id)),
      status: result.credStatus,
      message: result.message,
    });
  }

  return res.status(201).json(result.capture);
});

// Maps server/lib/terminal-focus.js's typed failure codes to HTTP status —
// same idiom routes/projects.js's OPEN_TERMINAL_STATUS uses.
const LOGIN_TERMINAL_STATUS = {
  UNSUPPORTED_PLATFORM: 501,
  NO_CONFIG_DIR: 409,
  AUTOMATION_ERROR: 500,
};

/**
 * POST /:id/login-terminal — opens a brand-new Terminal.app window running
 * `CLAUDE_CONFIG_DIR=<this account's config dir> claude` (macOS only), so
 * the user can walk through that profile's interactive login and just close
 * the window when done — the click-through counterpart of the "Needs login"
 * badge's advice. Doesn't touch the account row's status: the login only
 * takes effect on the next capture, which re-reads the credential anyway.
 */
router.post("/:id/login-terminal", (req, res) => {
  const account = stmts.getAccount.get(req.params.id);
  if (!account) {
    return res.status(404).json({ error: { code: "ENOTFOUND", message: "account not found" } });
  }
  const result = terminalFocus.openLoginTerminalForConfigDir(account.config_dir);
  if (result.ok) return res.json({ ok: true });
  const status = LOGIN_TERMINAL_STATUS[result.code] || 500;
  res.status(status).json({ error: { code: result.code, message: result.message } });
});

module.exports = router;
