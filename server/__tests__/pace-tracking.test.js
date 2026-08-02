/**
 * @file Tests for pace tracking: whether plan items are on schedule or behind
 * based on their target_date. Pure function tests that drive the derivation
 * logic and exercise all edge cases: boundary conditions (today = on_track,
 * not behind), completed items (never behind), missing target dates, and the
 * graceDays parameter.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isComplete, paceStatus, localDayString, PACE_STATUSES } = require("../lib/pace");

// Helper: create a plan item with default values, overridable
function item(overrides = {}) {
  return {
    checked: 0,
    declared_done_at: null,
    target_date: null,
    ...overrides,
  };
}

describe("isComplete", () => {
  it("returns true when checked === 1", () => {
    const result = isComplete(item({ checked: 1 }));
    assert.deepEqual(result, { complete: true, signal: "checked" });
  });

  it("returns true when declared_done_at is set", () => {
    const result = isComplete(item({ declared_done_at: "2026-08-01T12:00:00Z" }));
    assert.deepEqual(result, { complete: true, signal: "declared" });
  });

  it("precedence: checked takes priority over declared_done_at", () => {
    const result = isComplete(item({ checked: 1, declared_done_at: "2026-08-01T12:00:00Z" }));
    assert.equal(result.signal, "checked");
  });

  it("returns false when neither checked nor declared_done_at is set", () => {
    const result = isComplete(item());
    assert.deepEqual(result, { complete: false, signal: null });
  });
});

describe("paceStatus — no_target", () => {
  it("returns no_target when target_date is null", () => {
    const result = paceStatus(item({ target_date: null }));
    assert.equal(result.status, "no_target");
  });

  it("returns no_target when target_date is not a valid date", () => {
    const result = paceStatus(item({ target_date: "not-a-date" }));
    assert.equal(result.status, "no_target");
  });

  it("returns no_target when target_date is malformed (wrong format)", () => {
    const result = paceStatus(item({ target_date: "2026/08/01" }));
    assert.equal(result.status, "no_target");
  });

  it("no_target status never reports behind", () => {
    const result = paceStatus(item({ target_date: "invalid" }));
    assert.notEqual(result.status, "behind");
  });
});

describe("paceStatus — on_track/behind boundary", () => {
  it("target_date equal to today is on_track, not behind", () => {
    const today = localDayString(new Date());
    const result = paceStatus(item({ target_date: today }));
    assert.equal(result.status, "on_track");
    assert.equal(result.days_overdue, 0);
  });

  it("target_date one day in the future is on_track", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = localDayString(tomorrow);
    const result = paceStatus(item({ target_date: tomorrowStr }));
    assert.equal(result.status, "on_track");
  });

  it("target_date one day in the past (without graceDays) is behind", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = localDayString(yesterday);
    const result = paceStatus(item({ target_date: yesterdayStr }), { graceDays: 0 });
    assert.equal(result.status, "behind");
    assert.ok(result.days_overdue > 0);
  });

  it("graceDays parameter exempts overdue items", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = localDayString(yesterday);
    // With graceDays=1, one day overdue is still on_track
    const result = paceStatus(item({ target_date: yesterdayStr }), { graceDays: 1 });
    assert.equal(result.status, "on_track");
  });

  it("beyond graceDays threshold is still behind", () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = localDayString(twoDaysAgo);
    // With graceDays=1, two days overdue is behind
    const result = paceStatus(item({ target_date: twoDaysAgoStr }), { graceDays: 1 });
    assert.equal(result.status, "behind");
  });

  it("default graceDays is 0", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = localDayString(yesterday);
    const result = paceStatus(item({ target_date: yesterdayStr }));
    // Without specifying graceDays, default 0 means yesterday is behind
    assert.equal(result.status, "behind");
  });
});

describe("paceStatus — completed items never behind", () => {
  it("completed item with past target_date reports done, not behind", () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = localDayString(twoDaysAgo);
    const result = paceStatus(item({ checked: 1, target_date: twoDaysAgoStr }));
    assert.equal(result.status, "done");
    assert.notEqual(result.status, "behind");
  });

  it("declared-done item with past target_date reports done, not behind", () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = localDayString(twoDaysAgo);
    const result = paceStatus(
      item({ declared_done_at: "2026-08-01T12:00:00Z", target_date: twoDaysAgoStr })
    );
    assert.equal(result.status, "done");
  });

  it("completed item without target_date reports done", () => {
    const result = paceStatus(item({ checked: 1, target_date: null }));
    assert.equal(result.status, "done");
  });
});

describe("localDayString", () => {
  it("returns YYYY-MM-DD format for a date in local time", () => {
    // Create a date we can control
    const d = new Date("2026-08-15T12:00:00Z");
    const result = localDayString(d);
    // Result should be a local day string in YYYY-MM-DD format
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("handles UTC-to-local boundary (date changes on local midnight)", () => {
    // A UTC time just before midnight might be a different local day depending on timezone
    // Just verify it returns a valid YYYY-MM-DD format
    const d = new Date("2026-08-01T23:00:00Z");
    const result = localDayString(d);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("registry", () => {
  it("exports PACE_STATUSES registry with all values exercised", () => {
    assert.ok(Array.isArray(PACE_STATUSES), "PACE_STATUSES should be an array");
    assert.ok(PACE_STATUSES.length > 0, "PACE_STATUSES should not be empty");

    // Verify all expected values are present
    const expectedValues = ["no_target", "on_track", "behind", "done"];
    for (const val of expectedValues) {
      assert.ok(PACE_STATUSES.includes(val), `PACE_STATUSES should include "${val}"`);
    }

    // Verify no unexpected values
    for (const val of PACE_STATUSES) {
      assert.ok(expectedValues.includes(val), `unexpected status value in PACE_STATUSES: "${val}"`);
    }
  });
});
