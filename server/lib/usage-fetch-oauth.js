/**
 * @file usage-fetch-oauth.js
 * @description Fetches Claude usage (session/5-hour and weekly/7-day
 * rate-limit percentages + reset times) for one account using the OAuth
 * access token `server/lib/claude-cli-credentials.js` reads from the
 * `claude` CLI's own stored login. This does NOT call the internal
 * claude.ai session-cookie endpoint (that needs a browser session cookie,
 * which this app never collects) — it sends a minimal, 1-token request to
 * the real `api.anthropic.com/v1/messages` endpoint with the CLI's OAuth
 * bearer token and reads the rate-limit percentages/resets off the
 * *response headers*, discarding the response body. This mirrors the
 * (undocumented, reverse-engineered) technique third-party Claude usage
 * trackers use for their own "CLI OAuth" fallback path.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";

/** Header utilization is a 0.0-1.0 fraction; convert to a 0-100 percentage. */
function pctFromUtilization(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 1000) / 10 : null;
}

/** Header reset is unix epoch seconds; convert to the ISO string this app's
 *  other `*_reset_raw` columns already use. */
function resetIsoFromEpochSeconds(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/**
 * @param {string} accessToken A CLI OAuth access token from claude-cli-credentials.js.
 * @returns {Promise<{
 *   status: 'ok'|'error', sessionWindowPct: number|null, sessionWindowResetRaw: string|null,
 *   weekWindowPct: number|null, weekResetRaw: string|null, httpStatus: number|null, errorMessage: string|null
 * }>}
 */
async function fetchUsageViaOAuth(accessToken) {
  const empty = {
    sessionWindowPct: null,
    sessionWindowResetRaw: null,
    weekWindowPct: null,
    weekResetRaw: null,
  };

  let response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": OAUTH_BETA_HEADER,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
  } catch (err) {
    return { status: "error", ...empty, httpStatus: null, errorMessage: err.message };
  }

  const sessionUtil = response.headers.get("anthropic-ratelimit-unified-5h-utilization");
  const sessionReset = response.headers.get("anthropic-ratelimit-unified-5h-reset");
  const weekUtil = response.headers.get("anthropic-ratelimit-unified-7d-utilization");
  const weekReset = response.headers.get("anthropic-ratelimit-unified-7d-reset");
  const hasUsageHeaders = sessionUtil != null || weekUtil != null;

  // Drain the (tiny, 1-token) body regardless so the connection is released
  // back to the pool even when only the headers are actually used.
  await response.text().catch(() => {});

  if (!hasUsageHeaders) {
    return {
      status: "error",
      ...empty,
      httpStatus: response.status,
      errorMessage: `No rate-limit headers in response (HTTP ${response.status})`,
    };
  }

  return {
    status: "ok",
    sessionWindowPct: pctFromUtilization(sessionUtil),
    sessionWindowResetRaw: resetIsoFromEpochSeconds(sessionReset),
    weekWindowPct: pctFromUtilization(weekUtil),
    weekResetRaw: resetIsoFromEpochSeconds(weekReset),
    httpStatus: response.status,
    errorMessage: null,
  };
}

module.exports = {
  fetchUsageViaOAuth,
  __pctFromUtilization: pctFromUtilization,
  __resetIsoFromEpochSeconds: resetIsoFromEpochSeconds,
};
