/**
 * @file origin-guard.js
 * @description Shared loopback-Origin guard for dashboard routes that spawn
 * processes or otherwise take actions with real side effects (`/api/run`,
 * `/api/usage`). Local-first dashboard: the server is expected to bind to
 * localhost (or the user's intranet at most). To prevent a malicious webpage
 * from drive-by triggering those routes via CSRF, every route behind this
 * guard enforces a same-origin / loopback-Origin check. curl from the
 * terminal (no Origin header) is allowed; browser requests must come from a
 * localhost-ish origin.
 *
 * Referer is checked as a fallback for older browsers / fetch with
 * credentials disabled — the same loopback-host rule applies.
 *
 * Originally lived inline in server/routes/run.js; extracted so
 * server/routes/usage.js can reuse the identical security check instead of
 * duplicating it.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const ALLOWED_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function sameOriginGuard(req, res, next) {
  const checkHost = (raw) => {
    try {
      const u = new URL(raw);
      return ALLOWED_ORIGIN_HOSTS.has(u.hostname);
    } catch {
      return false;
    }
  };
  const origin = req.headers.origin;
  if (origin) {
    if (!checkHost(origin)) {
      return res.status(403).json({
        error: { code: "EBADORIGIN", message: "cross-origin requests are not allowed" },
      });
    }
    return next();
  }
  const referer = req.headers.referer;
  if (referer && !checkHost(referer)) {
    return res.status(403).json({
      error: { code: "EBADORIGIN", message: "cross-origin requests are not allowed" },
    });
  }
  return next();
}

module.exports = { sameOriginGuard, ALLOWED_ORIGIN_HOSTS };
