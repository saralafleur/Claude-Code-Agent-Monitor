/**
 * @file claude-cli-credentials.js
 * @description Reads the OAuth credential the `claude` CLI already stores
 * for a given `CLAUDE_CONFIG_DIR`, so the dashboard's multi-account Usage
 * feature can query Claude usage for several accounts without logging in
 * itself or storing a secret of its own. On macOS the CLI stores the token
 * only in the Keychain — never a `.credentials.json` file — under a
 * service name derived from the config dir's path (see
 * `__computeServiceName`); other platforms fall back to that config dir's
 * `.credentials.json`. This module only ever reads: it never writes back to
 * the CLI's own credential store and never attempts to refresh an expired
 * token itself, since doing so could consume the refresh token out from
 * under the CLI and break the user's real login (see the `expired` status).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

// Referenced as `cp.execFile` (not destructured) so tests can intercept it
// via `mock.method(require("node:child_process"), "execFile", ...)` without
// needing require-order tricks.
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".claude");
const KEYCHAIN_SERVICE_DEFAULT = "Claude Code-credentials";

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, { encoding: "utf8", timeout: 10000, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * The macOS Keychain service name the `claude` CLI stores a config dir's
 * OAuth token under: the default `~/.claude` dir uses a fixed name; any
 * other (custom `CLAUDE_CONFIG_DIR`) dir uses that name suffixed with the
 * first 8 hex characters of the SHA-256 of its absolute path.
 */
function __computeServiceName(absConfigDir) {
  if (absConfigDir === DEFAULT_CONFIG_DIR) return KEYCHAIN_SERVICE_DEFAULT;
  const hash = crypto.createHash("sha256").update(absConfigDir).digest("hex").slice(0, 8);
  return `${KEYCHAIN_SERVICE_DEFAULT}-${hash}`;
}

/** Best-effort, non-fatal read of the account's display info (not secret). */
function readAccountMeta(absConfigDir) {
  try {
    const raw = fs.readFileSync(path.join(absConfigDir, ".claude.json"), "utf8");
    const acct = JSON.parse(raw).oauthAccount || {};
    return {
      accountEmail: acct.emailAddress || null,
      accountOrg: acct.organizationName || null,
    };
  } catch {
    return { accountEmail: null, accountOrg: null };
  }
}

/**
 * Reads the OAuth credential for `configDir` (a `CLAUDE_CONFIG_DIR` the user
 * has already run `claude login` into) without ever storing or modifying
 * it. Returns:
 *   - { status: 'ok', accessToken, expiresAt, subscriptionType, accountEmail, accountOrg }
 *   - { status: 'expired', accessToken: null, expiresAt, ...same account fields }
 *   - { status: 'not_found', message, accountEmail, accountOrg }
 *   - { status: 'invalid', message, accountEmail, accountOrg }
 *
 * `platform` defaults to `process.platform` and only exists so tests can
 * force the non-macOS file-based fallback path deterministically.
 */
async function readCredential(configDir, { platform = process.platform } = {}) {
  const absConfigDir = path.resolve(os.homedir(), configDir || "");
  const meta = readAccountMeta(absConfigDir);

  let raw = null;
  if (platform === "darwin") {
    const serviceName = __computeServiceName(absConfigDir);
    try {
      const { stdout } = await execFileP("/usr/bin/security", [
        "find-generic-password",
        "-s",
        serviceName,
        "-a",
        os.userInfo().username,
        "-w",
      ]);
      raw = stdout.trim();
    } catch {
      raw = null; // no Keychain entry for this profile - not logged in yet
    }
  } else {
    try {
      raw = fs.readFileSync(path.join(absConfigDir, ".credentials.json"), "utf8");
    } catch {
      raw = null;
    }
  }

  if (!raw) {
    return { status: "not_found", message: `No Claude CLI login found for ${configDir}`, ...meta };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { status: "invalid", message: "Stored credential is not valid JSON", ...meta };
  }

  const oauth = payload.claudeAiOauth;
  if (!oauth || !oauth.accessToken || !oauth.expiresAt) {
    return { status: "invalid", message: "Stored credential is missing expected fields", ...meta };
  }

  const expired = oauth.expiresAt <= Date.now();
  return {
    status: expired ? "expired" : "ok",
    accessToken: expired ? null : oauth.accessToken,
    expiresAt: oauth.expiresAt,
    subscriptionType: oauth.subscriptionType || null,
    ...meta,
  };
}

module.exports = { readCredential, __computeServiceName };
