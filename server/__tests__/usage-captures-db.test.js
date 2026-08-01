/**
 * @file usage-captures-db.test.js
 * @description Tests for server/lib/usage-captures-db.js: basic
 * insert/list/get round-trips, and the multi-account `accountId` filter
 * added for the CLI-OAuth multi-account Usage feature — a capture recorded
 * with no accountId (the legacy tmux/TUI path) must keep showing up in the
 * unscoped history, while `listCaptures({ accountId })` must only return
 * that one account's captures.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-usage-captures-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { db } = require("../db");
const usageCapturesDb = require("../lib/usage-captures-db");

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

describe("recordCapture / getCapture", () => {
  it("inserts a legacy (no accountId) capture and reads it back", () => {
    const row = usageCapturesDb.recordCapture({
      cwd: "/x",
      status: "ok",
      accountEmail: "solo@example.com",
      sessionWindowPct: 12,
    });
    assert.ok(row.id);
    assert.equal(row.account_id, null);
    assert.equal(usageCapturesDb.getCapture(row.id).account_email, "solo@example.com");
  });

  it("inserts a capture scoped to a named account", () => {
    const row = usageCapturesDb.recordCapture({
      cwd: "/x",
      status: "ok",
      accountId: "acct_abc123",
      accountEmail: "work@example.com",
      sessionWindowPct: 40,
      weekWindowPct: 55,
    });
    assert.equal(row.account_id, "acct_abc123");
    assert.equal(row.session_window_pct, 40);
    assert.equal(row.week_window_pct, 55);
  });
});

describe("listCaptures accountId filter", () => {
  before(() => {
    usageCapturesDb.recordCapture({ cwd: "/a", status: "ok", accountId: "acct_filter_a" });
    usageCapturesDb.recordCapture({ cwd: "/b", status: "ok", accountId: "acct_filter_b" });
    usageCapturesDb.recordCapture({ cwd: "/c", status: "ok" }); // legacy, no account
  });

  it("with no accountId, returns everything (legacy behavior unchanged)", () => {
    const items = usageCapturesDb.listCaptures({ limit: 500 });
    const accountIds = items.map((i) => i.account_id);
    assert.ok(accountIds.includes("acct_filter_a"));
    assert.ok(accountIds.includes("acct_filter_b"));
    assert.ok(accountIds.includes(null));
  });

  it("with an accountId, returns only that account's captures", () => {
    const items = usageCapturesDb.listCaptures({ limit: 500, accountId: "acct_filter_a" });
    assert.ok(items.length > 0);
    assert.ok(items.every((i) => i.account_id === "acct_filter_a"));
  });

  it("an unknown accountId returns an empty list, not an error", () => {
    const items = usageCapturesDb.listCaptures({ limit: 500, accountId: "acct_nope" });
    assert.deepEqual(items, []);
  });
});
