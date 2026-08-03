/**
 * @file consumption-rate.js
 * @description Predicts, for a named account (server/routes/accounts.js),
 * when its session (5h) and weekly (7d) quotas will hit 100% if current
 * usage keeps climbing at its recent pace — the data behind the Usage
 * page's "Consumption Rate" card. Fits a least-squares %/hour trend line
 * over that account's own captures (server/lib/usage-captures-db.js) since
 * the CURRENT window started (a window reset drops the percentage back
 * toward 0, so blending captures across that boundary would read as a
 * usage crash rather than a fresh window) and, if that trend is actually
 * rising, projects the instant it would cross 100%.
 *
 * `usage-captures-db.js`'s own `listCaptures` caps at 500 rows. That's a
 * non-issue for the 5h session window (~60 captures at the scheduler's
 * 5-minute cadence, comfortably under the cap) but means the weekly trend
 * is effectively "the most recent ~41 hours of pace" once more than about
 * a day and a half has passed since the last weekly reset, rather than a
 * true full-week average — a deliberate choice (see PROJECT-CONTEXT.md-style
 * decision log in the Usage page work): recent pace predicts near-term
 * behavior better than diluting it with a slower stretch from days ago.
 *
 * Also reports `observedSpanMs` per scope — the wall-clock time between the
 * earliest and latest capture actually used in that scope's trend fit
 * (`null` when there weren't enough points to fit one). The trend is
 * described as "recent pace," but a session fit off 15 minutes of data
 * carries a lot less confidence than one off 4 hours — this is the number
 * that lets the Usage page's Consumption Rate card say so, rather than
 * presenting every rate with the same implied confidence regardless of how
 * much of the window was actually observed.
 *
 * Returns raw numeric facts only (rate, predicted instant, observed span) —
 * no color/threshold decisions, which stay client-side alongside
 * `colorBand` in Usage.tsx, matching how this whole page keeps its color
 * logic in one place.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const usageCapturesDb = require("./usage-captures-db");

const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Matches usage-captures-db.js's own hard cap — requesting more than this
// would just be silently clamped there anyway.
const RATE_LOOKBACK = 500;

/**
 * Least-squares slope of `points` (`{ t: epochMs, pct }`) in percent PER
 * HOUR. Needs at least two points spanning a non-zero duration; otherwise
 * there's no signal to fit a line through.
 */
function linearSlopePerHour(points) {
  if (points.length < 2) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 3_600_000);
  const ys = points.map((p) => p.pct);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null; // every point at the same instant (no duration to fit)
  return (n * sumXY - sumX * sumY) / denom;
}

/** `ok`-status captures with a non-null `pctField` value at/after
 *  `windowStartMs`, sorted oldest-first (the shape `linearSlopePerHour`
 *  wants) — `captures` itself is newest-first, straight from `listCaptures`. */
function pointsSinceWindowStart(captures, pctField, windowStartMs) {
  const points = [];
  for (const c of captures) {
    if (c.status !== "ok" || c[pctField] == null) continue;
    const t = new Date(c.captured_at).getTime();
    if (Number.isNaN(t) || t < windowStartMs) continue;
    points.push({ t, pct: c[pctField] });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/**
 * One quota window's prediction. `ratePerHour` is null when there isn't
 * enough data yet to fit a trend. `predictedExhaustionAt` is an ISO
 * timestamp only when the trend is actually rising (`ratePerHour > 0`) —
 * a flat or falling trend means no exhaustion is predictable, which reads
 * as "safe" rather than "unknown" to a caller that also checks
 * `ratePerHour`. `observedSpanMs` is the time between the oldest and newest
 * point the fit actually used — `null` under the same "fewer than two
 * points" condition that makes `ratePerHour` null, since a span needs two
 * ends to measure.
 */
function predictExhaustion({ captures, pctField, latestPct, latestResetRaw, windowMs, now }) {
  const empty = { ratePerHour: null, predictedExhaustionAt: null, observedSpanMs: null };
  if (latestPct == null || !latestResetRaw) return empty;
  const resetMs = new Date(latestResetRaw).getTime();
  if (Number.isNaN(resetMs)) return empty;

  const windowStartMs = resetMs - windowMs;
  const points = pointsSinceWindowStart(captures, pctField, windowStartMs);
  const observedSpanMs = points.length >= 2 ? points[points.length - 1].t - points[0].t : null;
  const ratePerHour = linearSlopePerHour(points);
  if (ratePerHour == null || ratePerHour <= 0) {
    return { ratePerHour, predictedExhaustionAt: null, observedSpanMs };
  }
  if (latestPct >= 100) {
    return { ratePerHour, predictedExhaustionAt: new Date(now).toISOString(), observedSpanMs };
  }
  const hoursToExhaustion = (100 - latestPct) / ratePerHour;
  return {
    ratePerHour,
    predictedExhaustionAt: new Date(now + hoursToExhaustion * 3_600_000).toISOString(),
    observedSpanMs,
  };
}

/**
 * This account's session + weekly burn-rate prediction, read from its own
 * capture history. `now` is injectable for tests; defaults to the real
 * clock.
 */
function computeConsumptionRate(accountId, { now = Date.now() } = {}) {
  const empty = { ratePerHour: null, predictedExhaustionAt: null, observedSpanMs: null };
  const captures = usageCapturesDb.listCaptures({ accountId, limit: RATE_LOOKBACK });
  const latest = captures[0]; // newest-first
  if (!latest || latest.status !== "ok") {
    return { session: empty, week: empty };
  }
  return {
    session: predictExhaustion({
      captures,
      pctField: "session_window_pct",
      latestPct: latest.session_window_pct,
      latestResetRaw: latest.session_window_reset_raw,
      windowMs: SESSION_WINDOW_MS,
      now,
    }),
    week: predictExhaustion({
      captures,
      pctField: "week_window_pct",
      latestPct: latest.week_window_pct,
      latestResetRaw: latest.week_reset_raw,
      windowMs: WEEK_WINDOW_MS,
      now,
    }),
  };
}

module.exports = {
  SESSION_WINDOW_MS,
  WEEK_WINDOW_MS,
  RATE_LOOKBACK,
  linearSlopePerHour,
  predictExhaustion,
  computeConsumptionRate,
};
