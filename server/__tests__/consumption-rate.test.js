/**
 * @file consumption-rate.test.js
 * @description Unit tests for server/lib/consumption-rate.js — the
 * burn-rate/exhaustion-prediction math behind the Usage page's
 * "Consumption Rate" card. Exercises `linearSlopePerHour` directly, then
 * `predictExhaustion`/`computeConsumptionRate` against real `usage_captures`
 * rows seeded through `usage-captures-db.js`, mirroring
 * account-activity.test.js's convention for this kind of derived-metric-
 * over-capture-history calculation.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-consumption-rate-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { db } = require("../db");
const usageCapturesDb = require("../lib/usage-captures-db");
const {
  SESSION_WINDOW_MS,
  WEEK_WINDOW_MS,
  linearSlopePerHour,
  predictExhaustion,
  computeConsumptionRate,
} = require("../lib/consumption-rate");

after(() => {
  if (db) db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe("linearSlopePerHour", () => {
  it("returns null with fewer than two points", () => {
    assert.equal(linearSlopePerHour([]), null);
    assert.equal(linearSlopePerHour([{ t: 0, pct: 10 }]), null);
  });

  it("returns null when every point shares the same instant", () => {
    assert.equal(
      linearSlopePerHour([
        { t: 1000, pct: 10 },
        { t: 1000, pct: 20 },
      ]),
      null
    );
  });

  it("fits an exact rising line (10%/hour)", () => {
    const rate = linearSlopePerHour([
      { t: 0, pct: 10 },
      { t: 3_600_000, pct: 20 },
      { t: 7_200_000, pct: 30 },
    ]);
    assert.ok(Math.abs(rate - 10) < 1e-9);
  });

  it("fits a falling line as a negative rate", () => {
    const rate = linearSlopePerHour([
      { t: 0, pct: 40 },
      { t: 3_600_000, pct: 20 },
    ]);
    assert.ok(Math.abs(rate - -20) < 1e-9);
  });
});

describe("predictExhaustion", () => {
  const now = Date.parse("2026-08-02T00:00:00.000Z");
  // 1h has already elapsed in the 5h session window as of `now`, so the
  // window started at (now - 1h) — leaves the "now - 1h" fixture capture
  // below inside the window, and the reset itself 4h out (not a full
  // window away, which would put the window boundary at exactly `now` and
  // wrongly exclude every earlier capture).
  const sessionResetRaw = new Date(now + SESSION_WINDOW_MS - 3_600_000).toISOString();

  it("returns nulls when the latest percentage or reset time is missing", () => {
    assert.deepEqual(
      predictExhaustion({
        captures: [],
        pctField: "session_window_pct",
        latestPct: null,
        latestResetRaw: "2026-08-02T05:00:00.000Z",
        windowMs: SESSION_WINDOW_MS,
        now,
      }),
      { ratePerHour: null, predictedExhaustionAt: null, observedSpanMs: null }
    );
    assert.deepEqual(
      predictExhaustion({
        captures: [],
        pctField: "session_window_pct",
        latestPct: 40,
        latestResetRaw: null,
        windowMs: SESSION_WINDOW_MS,
        now,
      }),
      { ratePerHour: null, predictedExhaustionAt: null, observedSpanMs: null }
    );
  });

  it("predicts a future exhaustion instant when the trend is rising", () => {
    // Reset 5h from now -> window started at (now - 5h). Two captures 1h
    // apart inside that window, rising 20pct/hour, latest at 40%: needs
    // (100-40)/20 = 3h more to reach 100%.
    const captures = [
      { status: "ok", captured_at: new Date(now).toISOString(), session_window_pct: 40 },
      {
        status: "ok",
        captured_at: new Date(now - 3_600_000).toISOString(),
        session_window_pct: 20,
      },
    ];
    const result = predictExhaustion({
      captures,
      pctField: "session_window_pct",
      latestPct: 40,
      latestResetRaw: sessionResetRaw,
      windowMs: SESSION_WINDOW_MS,
      now,
    });
    assert.ok(Math.abs(result.ratePerHour - 20) < 1e-9);
    assert.equal(result.predictedExhaustionAt, new Date(now + 3 * 3_600_000).toISOString());
    // The two fixture captures are 1h apart, so that's the span the fit
    // actually observed.
    assert.equal(result.observedSpanMs, 3_600_000);
  });

  it("predicts immediate exhaustion once already at/above 100%", () => {
    const captures = [
      { status: "ok", captured_at: new Date(now).toISOString(), session_window_pct: 100 },
      {
        status: "ok",
        captured_at: new Date(now - 3_600_000).toISOString(),
        session_window_pct: 50,
      },
    ];
    const result = predictExhaustion({
      captures,
      pctField: "session_window_pct",
      latestPct: 100,
      latestResetRaw: sessionResetRaw,
      windowMs: SESSION_WINDOW_MS,
      now,
    });
    assert.equal(result.predictedExhaustionAt, new Date(now).toISOString());
  });

  it("predicts no exhaustion (null) when usage is flat or falling", () => {
    const captures = [
      { status: "ok", captured_at: new Date(now).toISOString(), session_window_pct: 30 },
      {
        status: "ok",
        captured_at: new Date(now - 3_600_000).toISOString(),
        session_window_pct: 30,
      },
    ];
    const result = predictExhaustion({
      captures,
      pctField: "session_window_pct",
      latestPct: 30,
      latestResetRaw: sessionResetRaw,
      windowMs: SESSION_WINDOW_MS,
      now,
    });
    assert.equal(result.ratePerHour, 0);
    assert.equal(result.predictedExhaustionAt, null);
  });

  it("excludes captures from before the current window started", () => {
    // Window is only the last 5h; a much-earlier capture at a lower % would,
    // if wrongly included, read as a slow multi-day trend instead of the
    // real (faster) in-window one.
    const captures = [
      { status: "ok", captured_at: new Date(now).toISOString(), session_window_pct: 40 },
      {
        status: "ok",
        captured_at: new Date(now - 3_600_000).toISOString(),
        session_window_pct: 20,
      },
      // Belongs to a previous window (well before windowStart = now - 1h) —
      // must be ignored, not blended in.
      {
        status: "ok",
        captured_at: new Date(now - 30 * 3_600_000).toISOString(),
        session_window_pct: 95,
      },
    ];
    const result = predictExhaustion({
      captures,
      pctField: "session_window_pct",
      latestPct: 40,
      latestResetRaw: sessionResetRaw,
      windowMs: SESSION_WINDOW_MS,
      now,
    });
    assert.ok(Math.abs(result.ratePerHour - 20) < 1e-9);
  });

  it("observedSpanMs is null with fewer than two points in the window", () => {
    const captures = [
      { status: "ok", captured_at: new Date(now).toISOString(), session_window_pct: 40 },
    ];
    const result = predictExhaustion({
      captures,
      pctField: "session_window_pct",
      latestPct: 40,
      latestResetRaw: sessionResetRaw,
      windowMs: SESSION_WINDOW_MS,
      now,
    });
    assert.equal(result.ratePerHour, null);
    assert.equal(result.observedSpanMs, null);
  });

  it("ignores non-ok-status captures", () => {
    const captures = [
      { status: "ok", captured_at: new Date(now).toISOString(), session_window_pct: 40 },
      {
        status: "error",
        captured_at: new Date(now - 1_800_000).toISOString(),
        session_window_pct: 999,
      },
      {
        status: "ok",
        captured_at: new Date(now - 3_600_000).toISOString(),
        session_window_pct: 20,
      },
    ];
    const result = predictExhaustion({
      captures,
      pctField: "session_window_pct",
      latestPct: 40,
      latestResetRaw: sessionResetRaw,
      windowMs: SESSION_WINDOW_MS,
      now,
    });
    assert.ok(Math.abs(result.ratePerHour - 20) < 1e-9);
  });
});

describe("computeConsumptionRate", () => {
  const accountId = "acct_test_consumption_rate";
  // A fixed synthetic clock, independent of the real wall clock, so seeded
  // `captured_at` values and the `now` passed into computeConsumptionRate
  // always line up exactly regardless of how long this test takes to run.
  const FIXED_NOW = Date.parse("2026-08-02T12:00:00.000Z");
  let seedCounter = 0;
  function seedCapture(fields, capturedAtMs) {
    const capture = usageCapturesDb.recordCapture({
      cwd: "/fake/config-dir",
      accountId,
      status: "ok",
      ...fields,
    });
    seedCounter += 1;
    const capturedAt = new Date(capturedAtMs).toISOString();
    db.prepare("UPDATE usage_captures SET captured_at = ? WHERE id = ?").run(
      capturedAt,
      capture.id
    );
    return { ...capture, captured_at: capturedAt };
  }

  it("returns nulls for both scopes when there are no captures yet", () => {
    const result = computeConsumptionRate("acct_never_captured");
    assert.deepEqual(result, {
      session: { ratePerHour: null, predictedExhaustionAt: null, observedSpanMs: null },
      week: { ratePerHour: null, predictedExhaustionAt: null, observedSpanMs: null },
    });
  });

  it("returns nulls when the latest capture is an error", () => {
    seedCapture(
      { status: "error", sessionWindowPct: null, weekWindowPct: null },
      FIXED_NOW - 2 * 3_600_000
    );
    const result = computeConsumptionRate(accountId, { now: FIXED_NOW - 2 * 3_600_000 });
    assert.equal(result.session.ratePerHour, null);
    assert.equal(result.week.ratePerHour, null);
  });

  it("predicts a rising session + weekly trend from real seeded captures", () => {
    // 3h already elapsed in both windows as of FIXED_NOW, so both windows
    // started at FIXED_NOW - 3h — comfortably before both seeded captures
    // (2h and 1h ago), so both land inside the window and there are two
    // points to fit a trend through.
    const ELAPSED_MS = 3 * 3_600_000;
    const sessionReset = new Date(FIXED_NOW + SESSION_WINDOW_MS - ELAPSED_MS).toISOString();
    const weekReset = new Date(FIXED_NOW + WEEK_WINDOW_MS - ELAPSED_MS).toISOString();
    seedCapture(
      {
        sessionWindowPct: 20,
        sessionWindowResetRaw: sessionReset,
        weekWindowPct: 10,
        weekResetRaw: weekReset,
      },
      FIXED_NOW - 2 * 3_600_000
    );
    seedCapture(
      {
        sessionWindowPct: 40,
        sessionWindowResetRaw: sessionReset,
        weekWindowPct: 20,
        weekResetRaw: weekReset,
      },
      FIXED_NOW - 1 * 3_600_000
    );

    const result = computeConsumptionRate(accountId, { now: FIXED_NOW });
    assert.ok(result.session.ratePerHour > 0);
    assert.ok(result.session.predictedExhaustionAt);
    assert.equal(result.session.observedSpanMs, 3_600_000);
    assert.ok(result.week.ratePerHour > 0);
    assert.ok(result.week.predictedExhaustionAt);
    assert.equal(result.week.observedSpanMs, 3_600_000);
  });
});
