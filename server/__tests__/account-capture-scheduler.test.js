/**
 * @file account-capture-scheduler.test.js
 * @description Tests for server/lib/account-capture-scheduler.js's `tick`
 * function — the automatic per-account capture that keeps rate-limit %'s
 * (and the Activity card's percentage-delta inference) fresh without a
 * manual Refresh click. `startAccountCaptureScheduler` itself isn't
 * exercised here (it just wires `tick` to `setInterval`, unref'd, behind an
 * env-var kill switch — no independent logic worth a real timer in tests);
 * this covers `tick`'s actual behavior: every enabled account gets
 * captured, disabled accounts are skipped, and one account failing doesn't
 * stop the rest.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-account-scheduler-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { db, stmts } = require("../db");
const { tick } = require("../lib/account-capture-scheduler");
const accountCapture = require("../lib/account-capture");

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

afterEach(() => {
  mock.restoreAll();
});

function addAccount(label, enabled = 1) {
  const id = `acct_sched_${label.toLowerCase()}`;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-sched-"));
  stmts.insertAccount.run(id, label, configDir, enabled);
  return id;
}

describe("account-capture-scheduler tick", () => {
  it("captures every enabled account and skips disabled ones", async () => {
    const enabledId = addAccount("Enabled");
    const disabledId = addAccount("Disabled", 0);

    const seen = [];
    mock.method(accountCapture, "captureAccount", async (account) => {
      seen.push(account.id);
      return { credStatus: "ok" };
    });

    await tick();

    assert.ok(seen.includes(enabledId));
    assert.ok(!seen.includes(disabledId));
  });

  it("one account throwing doesn't stop the rest of the tick", async () => {
    const firstId = addAccount("First");
    const secondId = addAccount("Second");

    const seen = [];
    mock.method(accountCapture, "captureAccount", async (account) => {
      seen.push(account.id);
      if (account.id === firstId) throw new Error("boom");
      return { credStatus: "ok" };
    });

    await assert.doesNotReject(tick());
    assert.ok(seen.includes(firstId));
    assert.ok(seen.includes(secondId));
  });
});
