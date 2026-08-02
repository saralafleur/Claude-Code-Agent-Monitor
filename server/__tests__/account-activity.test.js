/**
 * @file account-activity.test.js
 * @description Unit tests for server/lib/account-activity.js — the
 * percentage-delta inference behind the Usage page's Activity card.
 * Exercises `pctIncreased` directly (window-reset drops must never count
 * as usage) and `computeLastUsedAt`/`isAccountActive` against real
 * `usage_captures` rows seeded through `usage-captures-db.js`, since the
 * lookback walk reads the database rather than an in-memory list.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-account-activity-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { db } = require("../db");
const usageCapturesDb = require("../lib/usage-captures-db");
const { pctIncreased, computeLastUsedAt, isAccountActive } = require("../lib/account-activity");

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

describe("pctIncreased", () => {
  it("is true when the session percentage rises", () => {
    assert.equal(
      pctIncreased(
        { session_window_pct: 20, week_window_pct: 10 },
        { session_window_pct: 10, week_window_pct: 10 }
      ),
      true
    );
  });

  it("is true when only the weekly percentage rises", () => {
    assert.equal(
      pctIncreased(
        { session_window_pct: 5, week_window_pct: 40 },
        { session_window_pct: 5, week_window_pct: 30 }
      ),
      true
    );
  });

  it("is false when both percentages are unchanged", () => {
    assert.equal(
      pctIncreased(
        { session_window_pct: 20, week_window_pct: 30 },
        { session_window_pct: 20, week_window_pct: 30 }
      ),
      false
    );
  });

  it("is false when the newer percentage is lower (a window reset, not usage)", () => {
    assert.equal(
      pctIncreased(
        { session_window_pct: 0, week_window_pct: 30 },
        { session_window_pct: 80, week_window_pct: 30 }
      ),
      false
    );
  });

  it("ignores a field where either side is null", () => {
    assert.equal(
      pctIncreased(
        { session_window_pct: null, week_window_pct: 30 },
        { session_window_pct: 10, week_window_pct: 20 }
      ),
      true // week_window_pct still rose
    );
    assert.equal(
      pctIncreased(
        { session_window_pct: null, week_window_pct: null },
        { session_window_pct: 10, week_window_pct: 20 }
      ),
      false
    );
  });
});

describe("computeLastUsedAt / isAccountActive", () => {
  const accountId = "acct_test_activity";
  // usage_captures.captured_at defaults to millisecond-resolution "now", so
  // several inserts issued back-to-back in one test could tie and make
  // ORDER BY captured_at DESC's tie-break non-deterministic. Force each
  // seeded row's timestamp a full minute apart instead of trusting wall-clock
  // timing. Anchored 10 minutes before the real "now" (not a fixed calendar
  // date) so every seeded row still falls inside the 15-minute active window
  // that `isAccountActive` checks against.
  const SEED_BASE_MS = Date.now() - 10 * 60 * 1000;
  let seedCounter = 0;
  function seedCapture({ status = "ok", sessionPct = null, weekPct = null } = {}) {
    const capture = usageCapturesDb.recordCapture({
      cwd: "/fake/config-dir",
      status,
      accountId,
      sessionWindowPct: sessionPct,
      weekWindowPct: weekPct,
    });
    const capturedAt = new Date(SEED_BASE_MS + seedCounter * 60_000).toISOString();
    seedCounter += 1;
    db.prepare("UPDATE usage_captures SET captured_at = ? WHERE id = ?").run(
      capturedAt,
      capture.id
    );
    return { ...capture, captured_at: capturedAt };
  }

  it("returns null with fewer than two captures", () => {
    assert.equal(computeLastUsedAt(accountId), null);
    seedCapture({ sessionPct: 5, weekPct: 5 });
    assert.equal(computeLastUsedAt(accountId), null);
  });

  it("returns the newer capture's timestamp once a later capture shows real movement", () => {
    const moved = seedCapture({ sessionPct: 12, weekPct: 5 });
    assert.equal(computeLastUsedAt(accountId), moved.captured_at);
    assert.equal(isAccountActive(computeLastUsedAt(accountId)), true);
  });

  it("does not treat a pure window-reset drop as new movement", () => {
    const lastMoved = computeLastUsedAt(accountId);
    seedCapture({ sessionPct: 0, weekPct: 5 }); // session window rolled over, not usage
    assert.equal(computeLastUsedAt(accountId), lastMoved);
  });

  it("skips error-status captures when looking for a comparable pair", () => {
    const lastMoved = computeLastUsedAt(accountId);
    seedCapture({ status: "error" });
    assert.equal(computeLastUsedAt(accountId), lastMoved);
  });

  it("is inactive once the most recent confirmed movement is older than 15 minutes", () => {
    assert.equal(isAccountActive(new Date(Date.now() - 20 * 60 * 1000).toISOString()), false);
  });

  it("is active within the 15-minute threshold", () => {
    assert.equal(isAccountActive(new Date(Date.now() - 5 * 60 * 1000).toISOString()), true);
  });

  it("is inactive when last_used_at is null", () => {
    assert.equal(isAccountActive(null), false);
  });
});
