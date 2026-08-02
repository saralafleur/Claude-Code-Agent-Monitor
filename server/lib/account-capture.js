/**
 * @file account-capture.js
 * @description The shared "capture one named account's usage" flow, used by
 * both `POST /api/accounts/:id/capture` (server/routes/accounts.js, a manual
 * click) and `lib/account-capture-scheduler.js` (an automatic background
 * tick) — extracted so the two callers can't drift. Reads that account's
 * OAuth credential live from the OS keychain (or, on Linux, a file) via
 * `claude-cli-credentials.js` — never stored by this app — and if usable,
 * fetches usage via `usage-fetch-oauth.js` and persists a `usage_captures`
 * row scoped to the account, updating its `status`/`last_error`/
 * `last_capture_*`. If the credential isn't usable (no login yet, expired,
 * or an unreadable/invalid stored credential), that's an expected,
 * actionable state, not a thrown error — the caller decides how to report it
 * (the route as a 200, the scheduler by just moving on to the next account).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { stmts } = require("../db");
const claudeCliCredentials = require("./claude-cli-credentials");
const usageFetchOauth = require("./usage-fetch-oauth");
const usageCapturesDb = require("./usage-captures-db");

/** Human-readable fallback for a credential status that has no explicit
 *  message. Points at the clickable "Needs login" badge (which opens a
 *  terminal via POST /:id/login-terminal) rather than making the user
 *  copy/paste the CLAUDE_CONFIG_DIR command themselves. */
function describeCredentialStatus(status, configDir) {
  if (status === "not_found") {
    return `No Claude CLI login found for ${configDir}. Click 'Needs login' to open a terminal and log in.`;
  }
  if (status === "expired") {
    return `Access token expired. Click 'Needs login' to open a terminal and refresh this profile's login.`;
  }
  return `Stored credential for ${configDir} looks invalid.`;
}

/**
 * Captures one account's usage now. Returns:
 *   - `{ credStatus: "not_found"|"expired"|"invalid", message }` when the
 *     credential isn't usable — no `usage_captures` row is written.
 *   - `{ credStatus: "ok", capture }` once a `usage_captures` row (status
 *     `ok` or `error`) has been persisted and the account row updated.
 */
async function captureAccount(account) {
  const cred = await claudeCliCredentials.readCredential(account.config_dir);

  if (cred.status !== "ok") {
    const accountStatus = cred.status === "invalid" ? "error" : "needs_login";
    const message = cred.message || describeCredentialStatus(cred.status, account.config_dir);
    stmts.setAccountCredentialStatus.run(accountStatus, message, account.id);
    return { credStatus: cred.status, message };
  }

  const usage = await usageFetchOauth.fetchUsageViaOAuth(cred.accessToken);
  const capture = usageCapturesDb.recordCapture({
    cwd: account.config_dir,
    status: usage.status === "ok" ? "ok" : "error",
    errorMessage: usage.errorMessage,
    accountId: account.id,
    accountEmail: cred.accountEmail,
    accountOrg: cred.accountOrg,
    sessionWindowPct: usage.sessionWindowPct,
    sessionWindowResetRaw: usage.sessionWindowResetRaw,
    weekWindowPct: usage.weekWindowPct,
    weekResetRaw: usage.weekResetRaw,
  });

  stmts.setAccountCaptureResult.run(
    usage.status === "ok" ? "ok" : "error",
    usage.status === "ok" ? null : usage.errorMessage,
    capture.id,
    capture.captured_at,
    cred.accountEmail,
    cred.accountOrg,
    account.id
  );

  return { credStatus: "ok", capture };
}

module.exports = { captureAccount, describeCredentialStatus };
