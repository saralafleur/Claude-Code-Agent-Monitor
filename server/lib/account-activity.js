/**
 * @file account-activity.js
 * @description Infers whether a named account (server/routes/accounts.js)
 * is actively being used, and how long ago it was last used, from movement
 * in its own session/weekly rate-limit percentage between captures —
 * rather than anything CLAUDE_CONFIG_DIR-local (e.g. that config dir's own
 * `history.jsonl`). Real work is very often done through whichever profile
 * is logged into the *default* `~/.claude` dir, not through this account's
 * own named CLAUDE_CONFIG_DIR (that dir exists only so this dashboard can
 * read a separate OAuth credential to poll usage %), so the local CLI
 * directory the user happens to be typing in is disconnected from which
 * Anthropic account is actually being billed — but the percentage itself
 * isn't: it only moves when that account's quota is really consumed.
 * Extracted from routes/accounts.js so this inference is unit-testable
 * without spinning up the Express app or a real credential/capture flow.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const usageCapturesDb = require("./usage-captures-db");

const ACCOUNT_ACTIVE_THRESHOLD_MS = 15 * 60 * 1000;
// How far back through an account's own capture history to look for the
// most recent confirmed usage. At the scheduler's default 5-minute tick
// this is a couple of days' worth — generous enough that "last used" doesn't
// go stale just because nobody's opened the dashboard in a while.
const ACCOUNT_ACTIVITY_LOOKBACK = 500;

/** True if `newer`'s session or weekly percentage is strictly higher than
 *  `older`'s — real quota consumption, not just a different reading. A
 *  *lower* newer percentage means a window rolled over (5h session / 7-day
 *  weekly reset), not usage, so that alone must never count as "active". */
function pctIncreased(newer, older) {
  const sessionUp =
    newer.session_window_pct != null &&
    older.session_window_pct != null &&
    newer.session_window_pct > older.session_window_pct;
  const weekUp =
    newer.week_window_pct != null &&
    older.week_window_pct != null &&
    newer.week_window_pct > older.week_window_pct;
  return sessionUp || weekUp;
}

/**
 * Walks this account's captures newest-first looking for the most recent
 * pair where usage actually moved (see `pctIncreased`), and returns the
 * newer capture's timestamp — real, config-dir-independent evidence the
 * account was in use around that time. Returns null when there's no
 * comparable pair (fewer than two `ok` captures) or no movement was ever
 * detected within the retained lookback.
 */
function computeLastUsedAt(accountId) {
  const captures = usageCapturesDb.listCaptures({
    accountId,
    limit: ACCOUNT_ACTIVITY_LOOKBACK,
  });
  for (let i = 0; i < captures.length - 1; i++) {
    const newer = captures[i];
    const older = captures[i + 1];
    if (newer.status !== "ok" || older.status !== "ok") continue;
    if (pctIncreased(newer, older)) return newer.captured_at;
  }
  return null;
}

function isAccountActive(lastUsedAt) {
  if (!lastUsedAt) return false;
  const ts = new Date(lastUsedAt).getTime();
  return !Number.isNaN(ts) && Date.now() - ts <= ACCOUNT_ACTIVE_THRESHOLD_MS;
}

module.exports = {
  ACCOUNT_ACTIVE_THRESHOLD_MS,
  ACCOUNT_ACTIVITY_LOOKBACK,
  pctIncreased,
  computeLastUsedAt,
  isAccountActive,
};
