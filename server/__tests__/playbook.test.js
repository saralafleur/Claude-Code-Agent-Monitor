/**
 * @file Tests for the Coach's Playbook: the engine's tick/evaluateSession
 * (session-token-ceiling firing, dedup against an already-open Observation,
 * and the enabled/disabled config gate), tick/evaluateGlobal
 * (account-weekly-balance firing off enabled accounts' latest weekly %s),
 * tick/autoResolveStaleObservations (a still-active session's observation
 * never auto-resolves; only once a session has been ended for at least
 * `playbook_settings.auto_resolve_after_ms` does it resolve, gated by the
 * per-practice `autoResolveOnSessionEnd`; `auto_resolve_after_ms = 0`
 * disables the sweep entirely), plus the /api/playbook/practices,
 * /api/playbook/settings, and /api/coach/observations routes (CRUD +
 * validation).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

describe("playbook engine", () => {
  let tempDir;
  let dbModule;
  let engine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "playbook-engine-test-"));
    process.env.DASHBOARD_DB_PATH = path.join(tempDir, "test.db");
    delete require.cache[require.resolve("../db")];
    delete require.cache[require.resolve("../lib/playbook/engine")];
    delete require.cache[require.resolve("../lib/playbook/practices")];
    // usage-captures-db.js and account-activity.js each cache a `db`
    // reference (via `require("../db")`) at module-load time, same as
    // every other server/lib module — without also busting these, they'd
    // keep pointing at whichever test's temp DB first loaded them,
    // silently leaking usage_captures rows across tests that reuse the
    // same literal account id (e.g. "acct-a"), which is exactly what
    // isAccountActive/computeLastUsedAt compares two rows to detect.
    delete require.cache[require.resolve("../lib/usage-captures-db")];
    delete require.cache[require.resolve("../lib/account-activity")];
    delete require.cache[require.resolve("../lib/consumption-rate")];
    dbModule = require("../db");
    engine = require("../lib/playbook/engine");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    delete process.env.DASHBOARD_DB_PATH;
  });

  function seedSession(id, { status = "active" } = {}) {
    dbModule.stmts.insertSession.run(
      id,
      `Session ${id}`,
      status,
      "/tmp/proj",
      "claude-sonnet-5",
      null
    );
  }

  function seedTokens(sessionId, total) {
    // Split arbitrarily across input/output; the engine sums every dimension.
    dbModule.stmts.upsertTokenUsage.run(
      sessionId,
      "claude-sonnet-5",
      Math.floor(total / 2),
      total - Math.floor(total / 2),
      0,
      0
    );
  }

  // Seeds one enabled account plus a usage_captures row carrying its latest
  // weekly-window pct — the shape evaluateGlobal's ctx assembly reads.
  // `active: true` seeds an earlier, lower-pct capture first so
  // computeLastUsedAt/isAccountActive (server/lib/account-activity.js)
  // infer real recent usage — the exact same inference routes/accounts.js's
  // `is_active` field uses, now also driving account-weekly-balance's ctx.
  // The earlier capture's `captured_at` is explicitly backdated by a few
  // seconds (raw UPDATE — recordCapture always stamps "now") since two
  // synchronous inserts can otherwise tie at millisecond resolution, which
  // makes `ORDER BY captured_at DESC` (no id tiebreaker) return them in an
  // unpredictable order and `pctIncreased`'s newer-vs-older comparison flaky.
  function seedAccount(id, label, weeklyUsedPct, { active = false } = {}) {
    dbModule.stmts.insertAccount.run(id, label, `/tmp/${id}`, 1);
    const usageCapturesDb = require("../lib/usage-captures-db");
    if (active) {
      const earlier = usageCapturesDb.recordCapture({
        cwd: `/tmp/${id}`,
        status: "ok",
        accountId: id,
        weekWindowPct: Math.max(0, weeklyUsedPct - 5),
      });
      dbModule.db
        .prepare("UPDATE usage_captures SET captured_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 5_000).toISOString(), earlier.id);
    }
    usageCapturesDb.recordCapture({
      cwd: `/tmp/${id}`,
      status: "ok",
      accountId: id,
      weekWindowPct: weeklyUsedPct,
    });
  }

  // Sets the shared Rotation Plan switch threshold account-weekly-balance
  // now reads from ctx (color_thresholds.rotation_switch_pct), leaving
  // every other color-threshold column untouched.
  function setRotationSwitchPct(pct) {
    dbModule.stmts.updateColorThresholds.run(
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      pct
    );
  }

  it("fires session-token-ceiling once a session's summed tokens cross the threshold", () => {
    seedSession("sess-1");
    seedTokens("sess-1", 150_000_000);

    const created = engine.tick(dbModule);
    assert.equal(created.length, 1);
    assert.equal(created[0].practice_id, "session-token-ceiling");
    assert.equal(created[0].scope_type, "session");
    assert.equal(created[0].scope_id, "sess-1");
    assert.equal(created[0].status, "open");
    const values = JSON.parse(created[0].values_json);
    assert.equal(values.totalTokens, 150_000_000);
    assert.equal(values.thresholdTokens, 100_000_000);
  });

  it("does not fire below the threshold", () => {
    seedSession("sess-1");
    seedTokens("sess-1", 50_000_000);

    const created = engine.tick(dbModule);
    assert.equal(created.length, 0);
  });

  it("does not create a duplicate observation while one is still open", () => {
    seedSession("sess-1");
    seedTokens("sess-1", 150_000_000);

    const first = engine.tick(dbModule);
    assert.equal(first.length, 1);
    const second = engine.tick(dbModule);
    assert.equal(
      second.length,
      0,
      "a second tick must not re-fire while the first observation is open"
    );

    const rows = dbModule.stmts.listCoachObservations.all(100);
    assert.equal(rows.length, 1);
  });

  it("fires again once the prior observation has been responded to", () => {
    seedSession("sess-1");
    seedTokens("sess-1", 150_000_000);
    engine.tick(dbModule);
    const [obs] = dbModule.stmts.listCoachObservations.all(100);
    dbModule.stmts.updateCoachObservationStatus.run("dismissed", obs.id);

    const created = engine.tick(dbModule);
    assert.equal(created.length, 1);
  });

  it("does not evaluate a disabled practice", () => {
    seedSession("sess-1");
    seedTokens("sess-1", 150_000_000);
    dbModule.stmts.upsertPlaybookPracticeConfig.run(
      "session-token-ceiling",
      0,
      JSON.stringify({ thresholdTokens: 100_000_000 })
    );

    const created = engine.tick(dbModule);
    assert.equal(created.length, 0);
  });

  it("respects a raised threshold override", () => {
    seedSession("sess-1");
    seedTokens("sess-1", 150_000_000);
    dbModule.stmts.upsertPlaybookPracticeConfig.run(
      "session-token-ceiling",
      1,
      JSON.stringify({ thresholdTokens: 200_000_000 })
    );

    const created = engine.tick(dbModule);
    assert.equal(created.length, 0);
  });

  it("ignores non-active sessions", () => {
    seedSession("sess-1", { status: "completed" });
    seedTokens("sess-1", 150_000_000);

    const created = engine.tick(dbModule);
    assert.equal(created.length, 0);
  });

  describe("autoResolveStaleObservations", () => {
    function fireAndGetObservation() {
      seedSession("sess-1");
      seedTokens("sess-1", 150_000_000);
      const [created] = engine.tick(dbModule);
      return created;
    }

    // Ends sess-1 with its ended_at/updated_at backdated by msAgo, so the
    // sweep's "session has been ended for at least the window" check has a
    // real elapsed time to compare against — a plain updateSession() call
    // would stamp "now", making every ended-session test racy against the
    // window it's supposed to be testing.
    function endSessionAgo(msAgo) {
      const iso = new Date(Date.now() - msAgo).toISOString();
      dbModule.db
        .prepare(
          "UPDATE sessions SET status = 'completed', ended_at = ?, updated_at = ? WHERE id = ?"
        )
        .run(iso, iso, "sess-1");
    }

    it("does not auto-resolve while the session is still active, no matter how long the observation has been open", () => {
      const obs = fireAndGetObservation();
      dbModule.stmts.updatePlaybookSettings.run(1); // 1ms window — as permissive as possible

      engine.tick(dbModule);

      const updated = dbModule.stmts.getCoachObservation.get(obs.id);
      assert.equal(
        updated.status,
        "open",
        "an active session's observation must never auto-resolve"
      );
    });

    it("does not auto-resolve the instant a session ends — only once the configured window has elapsed since", () => {
      const obs = fireAndGetObservation();
      dbModule.stmts.updatePlaybookSettings.run(60_000); // 1 minute window
      endSessionAgo(0); // just ended, no time has elapsed yet

      engine.tick(dbModule);

      const updated = dbModule.stmts.getCoachObservation.get(obs.id);
      assert.equal(updated.status, "open", "must wait out the window, not resolve immediately");
    });

    it("auto-resolves once the session has been ended for at least the configured window (autoResolveOnSessionEnd defaults to true)", () => {
      const obs = fireAndGetObservation();
      dbModule.stmts.updatePlaybookSettings.run(60_000); // 1 minute window
      endSessionAgo(2 * 60_000); // ended 2 minutes ago — past the window

      engine.tick(dbModule);

      const updated = dbModule.stmts.getCoachObservation.get(obs.id);
      assert.equal(updated.status, "resolved");
      assert.ok(updated.responded_at);
    });

    it("respects a per-practice autoResolveOnSessionEnd=false override — stays open no matter how long past the window", () => {
      dbModule.stmts.upsertPlaybookPracticeConfig.run(
        "session-token-ceiling",
        1,
        JSON.stringify({ thresholdTokens: 100_000_000, autoResolveOnSessionEnd: false })
      );
      const obs = fireAndGetObservation();
      dbModule.stmts.updatePlaybookSettings.run(60_000);
      endSessionAgo(365 * 24 * 60 * 60_000); // ended a year ago

      engine.tick(dbModule);

      const updated = dbModule.stmts.getCoachObservation.get(obs.id);
      assert.equal(updated.status, "open");
    });

    it("does not auto-resolve at all when auto_resolve_after_ms is 0 (disabled), even long after the session ends", () => {
      const obs = fireAndGetObservation();
      dbModule.stmts.updatePlaybookSettings.run(0);
      endSessionAgo(365 * 24 * 60 * 60_000); // ended a year ago

      engine.tick(dbModule);

      const updated = dbModule.stmts.getCoachObservation.get(obs.id);
      assert.equal(updated.status, "open");
    });

    it("resolves immediately once the sweep runs if the session was deleted outright (no reference time to wait out)", () => {
      const obs = fireAndGetObservation();
      dbModule.stmts.updatePlaybookSettings.run(60_000);
      dbModule.db.prepare("DELETE FROM sessions WHERE id = ?").run("sess-1");

      engine.tick(dbModule);

      const updated = dbModule.stmts.getCoachObservation.get(obs.id);
      assert.equal(updated.status, "resolved");
    });

    it("never auto-resolves a dismissed observation a second time (idempotent — no-op on non-open rows)", () => {
      const obs = fireAndGetObservation();
      dbModule.stmts.updateCoachObservationStatus.run("dismissed", obs.id);
      dbModule.stmts.updatePlaybookSettings.run(1000);
      endSessionAgo(365 * 24 * 60 * 60_000);

      engine.tick(dbModule);

      const updated = dbModule.stmts.getCoachObservation.get(obs.id);
      assert.equal(updated.status, "dismissed", "an already-dismissed row must stay dismissed");
    });
  });

  it("fires account-weekly-balance once the active account crosses the shared rotation switch threshold", () => {
    seedAccount("acct-a", "Personal", 85, { active: true }); // over the 80 default
    seedAccount("acct-b", "Work", 40);

    const created = engine.tick(dbModule);
    const obs = created.find((o) => o.practice_id === "account-weekly-balance");
    assert.ok(obs, "expected account-weekly-balance to fire");
    assert.equal(obs.scope_type, "global");
    assert.equal(obs.scope_id, null);
    const values = JSON.parse(obs.values_json);
    assert.equal(values.activeAccountId, "acct-a");
    assert.equal(values.activePct, 85);
    assert.equal(values.lowAccountId, "acct-b");
    assert.equal(values.lowPct, 40);
    assert.equal(values.rotationSwitchPct, 80);
  });

  it("does not fire while the active account is still under the rotation switch threshold", () => {
    seedAccount("acct-a", "Personal", 70, { active: true }); // under the 80 default
    seedAccount("acct-b", "Work", 40);

    const created = engine.tick(dbModule);
    assert.ok(!created.some((o) => o.practice_id === "account-weekly-balance"));
  });

  it("does not fire when no account is currently active", () => {
    seedAccount("acct-a", "Personal", 85); // over threshold, but never marked active
    seedAccount("acct-b", "Work", 40);

    const created = engine.tick(dbModule);
    assert.ok(!created.some((o) => o.practice_id === "account-weekly-balance"));
  });

  it("does not fire when no other account has headroom to switch to", () => {
    seedAccount("acct-a", "Personal", 85, { active: true });
    seedAccount("acct-b", "Work", 90); // also past the switch threshold — nothing to rotate onto

    const created = engine.tick(dbModule);
    assert.ok(!created.some((o) => o.practice_id === "account-weekly-balance"));
  });

  it("does not create a duplicate account-weekly-balance observation while one is still open", () => {
    seedAccount("acct-a", "Personal", 85, { active: true });
    seedAccount("acct-b", "Work", 40);

    const first = engine.tick(dbModule).filter((o) => o.practice_id === "account-weekly-balance");
    assert.equal(first.length, 1);
    const second = engine.tick(dbModule).filter((o) => o.practice_id === "account-weekly-balance");
    assert.equal(second.length, 0);
  });

  it("respects a raised shared rotation switch threshold (color_thresholds.rotation_switch_pct)", () => {
    seedAccount("acct-a", "Personal", 85, { active: true });
    seedAccount("acct-b", "Work", 40);
    setRotationSwitchPct(90); // 85 no longer crosses it

    const created = engine.tick(dbModule);
    assert.ok(!created.some((o) => o.practice_id === "account-weekly-balance"));
  });

  it("does not evaluate a disabled account-weekly-balance practice", () => {
    seedAccount("acct-a", "Personal", 85, { active: true });
    seedAccount("acct-b", "Work", 40);
    dbModule.stmts.upsertPlaybookPracticeConfig.run("account-weekly-balance", 0, "{}");

    const created = engine.tick(dbModule);
    assert.ok(!created.some((o) => o.practice_id === "account-weekly-balance"));
  });

  it("auto-resolves once the active account drops back under the rotation switch threshold", () => {
    seedAccount("acct-a", "Personal", 85, { active: true });
    seedAccount("acct-b", "Work", 40);
    const [obs] = engine.tick(dbModule).filter((o) => o.practice_id === "account-weekly-balance");
    assert.ok(obs, "expected account-weekly-balance to fire");

    // Simulates the condition clearing (a weekly reset dropping acct-a's %,
    // or the user actually rotating, would do the same to detect()'s
    // inputs) — raising the shared threshold is the simplest way to prove
    // the re-check sweep reacts to the condition no longer holding.
    setRotationSwitchPct(95);

    engine.tick(dbModule);

    const updated = dbModule.stmts.getCoachObservation.get(obs.id);
    assert.equal(updated.status, "resolved");
  });

  it("leaves the observation open while the active account is still past the switch threshold", () => {
    seedAccount("acct-a", "Personal", 85, { active: true });
    seedAccount("acct-b", "Work", 40);
    const [obs] = engine.tick(dbModule).filter((o) => o.practice_id === "account-weekly-balance");
    assert.ok(obs, "expected account-weekly-balance to fire");

    engine.tick(dbModule); // condition still holds — nothing changed

    const updated = dbModule.stmts.getCoachObservation.get(obs.id);
    assert.equal(updated.status, "open");
  });

  // T2a — Frozen snapshot, global scope (account-weekly-balance)
  it("freezes kind/severity onto each Observation at fire time; a later override change never relabels an earlier row (account-weekly-balance, global scope)", async () => {
    // Step 1: No override → fire → first row has catalog values
    seedAccount("acct-1a", "Account 1A", 85, { active: true });
    seedAccount("acct-1b", "Account 1B", 40);
    const created1 = engine.tick(dbModule);
    const first = created1.find((o) => o.practice_id === "account-weekly-balance");
    assert(first, "expected account-weekly-balance to fire");
    assert.equal(first.kind, "info", "first row should have catalog kind");
    assert.equal(first.severity, "info", "first row should have catalog severity");

    // Dismiss to allow refire
    dbModule.stmts.updateCoachObservationStatus.run("dismissed", first.id);

    // Step 2: Set override → tick → second row has overridden values
    // Use fresh, never-before-used account IDs to avoid UNIQUE constraint
    const practiceId = "account-weekly-balance";
    dbModule.stmts.upsertPlaybookPracticeConfig.run(
      practiceId,
      1,
      JSON.stringify({ kindOverride: "risk", severityOverride: "warning" })
    );
    seedAccount("acct-2a", "Account 2A", 85, { active: true });
    seedAccount("acct-2b", "Account 2B", 40);
    const created2 = engine.tick(dbModule);
    const second = created2.find((o) => o.practice_id === "account-weekly-balance");
    assert(second, "expected second observation to fire");
    assert.equal(second.kind, "risk", "second row should have overridden kind");
    assert.equal(second.severity, "warning", "second row should have overridden severity");

    // Re-read first row — must be unchanged
    const firstUnchanged = dbModule.stmts.listCoachObservations
      .all(100)
      .find((o) => o.id === first.id);
    assert.equal(firstUnchanged.kind, "info", "first row's kind must not change");
    assert.equal(firstUnchanged.severity, "info", "first row's severity must not change");
    assert.equal(firstUnchanged.status, "dismissed", "first row's status must still be dismissed");

    // Dismiss second observation to allow refire for step 3
    dbModule.stmts.updateCoachObservationStatus.run("dismissed", second.id);

    // Step 3: Change override again → tick → third row has new values
    // Use fresh, never-before-used account IDs again
    dbModule.stmts.upsertPlaybookPracticeConfig.run(
      practiceId,
      1,
      JSON.stringify({ kindOverride: "good", severityOverride: "info" })
    );
    seedAccount("acct-3a", "Account 3A", 85, { active: true });
    seedAccount("acct-3b", "Account 3B", 40);
    const created3 = engine.tick(dbModule);
    const third = created3.find((o) => o.practice_id === "account-weekly-balance");
    assert(third, "expected third observation to fire");
    assert.equal(third.kind, "good", "third row should have good kind");
    assert.equal(third.severity, "info", "third row should have info severity");

    // Re-read both prior rows — must be unchanged
    const allObs = dbModule.stmts.listCoachObservations.all(100);
    const firstFinal = allObs.find((o) => o.id === first.id);
    const secondFinal = allObs.find((o) => o.id === second.id);
    assert.deepEqual(
      { kind: firstFinal.kind, severity: firstFinal.severity },
      { kind: "info", severity: "info" }
    );
    assert.deepEqual(
      { kind: secondFinal.kind, severity: secondFinal.severity },
      { kind: "risk", severity: "warning" }
    );
  });

  // T2b — Frozen snapshot, session scope (session-token-ceiling)
  it("freezes kind/severity at fire time — session scope (session-token-ceiling); override changes never relabel prior rows", async () => {
    // Step 1: No override → fire → first row has catalog values
    seedSession("sess-1");
    seedTokens("sess-1", 150_000_000);
    const created1 = engine.tick(dbModule);
    const first = created1.find((o) => o.practice_id === "session-token-ceiling");
    assert(first, "expected session-token-ceiling to fire");
    assert.equal(first.kind, "risk", "first row catalog kind for session-token-ceiling");
    assert.equal(first.severity, "warning", "first row catalog severity for session-token-ceiling");

    // Dismiss to allow refire
    dbModule.stmts.updateCoachObservationStatus.run("dismissed", first.id);

    // Step 2: Override with provably-different values (good/info) → tick → second row has overridden values
    // Use fresh, never-before-used session ID to avoid UNIQUE constraint
    const practiceId = "session-token-ceiling";
    dbModule.stmts.upsertPlaybookPracticeConfig.run(
      practiceId,
      1,
      JSON.stringify({
        thresholdTokens: 100_000_000,
        kindOverride: "good",
        severityOverride: "info",
      })
    );
    seedSession("sess-2");
    seedTokens("sess-2", 150_000_000);
    const created2 = engine.tick(dbModule);
    const second = created2.find((o) => o.practice_id === "session-token-ceiling");
    assert(second, "expected second observation to fire");
    assert.equal(second.kind, "good", "second row should have overridden kind");
    assert.equal(second.severity, "info", "second row should have overridden severity");

    // Re-read first — must be unchanged
    const allObs = dbModule.stmts.listCoachObservations.all(100);
    const firstUnchanged = allObs.find((o) => o.id === first.id);
    assert.equal(firstUnchanged.kind, "risk", "first row's kind must not change");
    assert.equal(firstUnchanged.severity, "warning", "first row's severity must not change");

    // Step 3: Clear the override entirely (no kindOverride key) → tick → third row reverts to catalog
    // Use fresh, never-before-used session ID again
    dbModule.stmts.upsertPlaybookPracticeConfig.run(
      practiceId,
      1,
      JSON.stringify({ thresholdTokens: 100_000_000 }) // no kindOverride/severityOverride
    );
    seedSession("sess-3");
    seedTokens("sess-3", 150_000_000);
    const created3 = engine.tick(dbModule);
    const third = created3.find((o) => o.practice_id === "session-token-ceiling");
    assert(third, "expected third observation to fire");
    assert.equal(third.kind, "risk", "third row should revert to catalog kind");
    assert.equal(third.severity, "warning", "third row should revert to catalog severity");

    // Re-read both prior rows — must be unchanged
    const allObsFinal = dbModule.stmts.listCoachObservations.all(100);
    const firstFinal = allObsFinal.find((o) => o.id === first.id);
    const secondFinal = allObsFinal.find((o) => o.id === second.id);
    assert.equal(firstFinal.kind, "risk");
    assert.equal(secondFinal.kind, "good");
  });

  // T2c — Status isolation
  it("updateCoachObservationStatus never touches kind or severity", () => {
    seedSession("sess-1");
    seedTokens("sess-1", 150_000_000);
    engine.tick(dbModule);
    const obs = dbModule.stmts.listCoachObservations.all(100)[0];
    const { kind, severity } = obs;

    dbModule.stmts.updateCoachObservationStatus.run("acknowledged", obs.id);
    const updated = dbModule.stmts.listCoachObservations.all(100).find((o) => o.id === obs.id);

    assert.equal(updated.kind, kind, "kind should not change");
    assert.equal(updated.severity, severity, "severity should not change");
    assert.equal(updated.status, "acknowledged", "status should change");
  });
});

describe("playbook + coach routes", () => {
  const TEST_DB = path.join(os.tmpdir(), `dashboard-playbook-test-${Date.now()}-${process.pid}.db`);
  process.env.DASHBOARD_DB_PATH = TEST_DB;
  process.env.DASHBOARD_REMOTE_SYNC_MS = "0";
  process.env.DASHBOARD_LIVENESS_PROBE = "0";
  process.env.DASHBOARD_PLAYBOOK_MODE = "off"; // don't let the real scheduler race the tests

  const { createApp, startServer } = require("../index");
  const { db, stmts } = require("../db");

  let server;
  let BASE;

  function fetchJson(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, BASE);
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: { "Content-Type": "application/json", ...options.headers },
      };
      const req = http.request(opts, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on("error", reject);
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  }
  const get = (p) => fetchJson(p);
  const put = (p, body) => fetchJson(p, { method: "PUT", body });
  const post = (p, body) => fetchJson(p, { method: "POST", body });

  before(async () => {
    const app = createApp();
    server = await startServer(app, 0);
    BASE = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    if (server) server.close();
    if (db) db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(TEST_DB + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  describe("GET /api/playbook/practices", () => {
    it("returns the catalog with default config on a fresh DB", async () => {
      const res = await get("/api/playbook/practices");
      assert.equal(res.status, 200);
      assert.equal(res.body.practices.length, 2);
      const byId = new Map(res.body.practices.map((p) => [p.id, p]));

      const tokenCeiling = byId.get("session-token-ceiling");
      assert.equal(tokenCeiling.enabled, true);
      assert.deepEqual(tokenCeiling.config, {
        thresholdTokens: 100_000_000,
        autoResolveOnSessionEnd: true,
      });

      const accountBalance = byId.get("account-weekly-balance");
      assert.ok(accountBalance, "expected account-weekly-balance in the catalog");
      assert.equal(accountBalance.scope, "global");
      assert.equal(accountBalance.enabled, true);
      assert.deepEqual(
        accountBalance.fields,
        [],
        "no fields of its own — it shares rotation_switch_pct with the Usage page instead"
      );
      assert.deepEqual(accountBalance.config, {});
    });
  });

  describe("PUT /api/playbook/practices/:id/config", () => {
    it("persists an enabled/config patch and a follow-up GET reflects it", async () => {
      const putRes = await put("/api/playbook/practices/session-token-ceiling/config", {
        enabled: false,
        config: { thresholdTokens: 50_000_000 },
      });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.body.enabled, false);
      assert.deepEqual(putRes.body.config, {
        thresholdTokens: 50_000_000,
        autoResolveOnSessionEnd: true,
      });

      const getRes = await get("/api/playbook/practices");
      assert.equal(getRes.body.practices[0].enabled, false);
      assert.deepEqual(getRes.body.practices[0].config, {
        thresholdTokens: 50_000_000,
        autoResolveOnSessionEnd: true,
      });

      // restore for later tests
      await put("/api/playbook/practices/session-token-ceiling/config", {
        enabled: true,
        config: { thresholdTokens: 100_000_000 },
      });
    });

    it("404s on an unknown practice id", async () => {
      const res = await put("/api/playbook/practices/does-not-exist/config", { enabled: true });
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, "UNKNOWN_PRACTICE");
    });

    it("400s on an unknown config field", async () => {
      const res = await put("/api/playbook/practices/session-token-ceiling/config", {
        config: { notARealField: 1 },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_CONFIG");
    });

    it("400s on a value below the field's minimum", async () => {
      const res = await put("/api/playbook/practices/session-token-ceiling/config", {
        config: { thresholdTokens: 1 },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_CONFIG");
    });

    it("persists a boolean field (autoResolveOnSessionEnd) and a follow-up GET reflects it", async () => {
      const putRes = await put("/api/playbook/practices/session-token-ceiling/config", {
        config: { autoResolveOnSessionEnd: false },
      });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.body.config.autoResolveOnSessionEnd, false);

      const getRes = await get("/api/playbook/practices");
      const practice = getRes.body.practices.find((p) => p.id === "session-token-ceiling");
      assert.equal(practice.config.autoResolveOnSessionEnd, false);

      // restore for later tests
      await put("/api/playbook/practices/session-token-ceiling/config", {
        config: { autoResolveOnSessionEnd: true },
      });
    });

    it("400s on a non-boolean value for a boolean field", async () => {
      const res = await put("/api/playbook/practices/session-token-ceiling/config", {
        config: { autoResolveOnSessionEnd: "yes" },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_CONFIG");
    });

    it("400s on any config key for account-weekly-balance — it has no fields of its own", async () => {
      const res = await put("/api/playbook/practices/account-weekly-balance/config", {
        config: { gapThresholdPct: 30 },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_CONFIG");
    });

    // T5 — "saved but never applied" (load-bearing route test)
    it("persists a kind override end-to-end: PUT succeeds AND a follow-up GET shows resolvedKind actually changed", async () => {
      // PUT with a kind override
      const putRes = await put("/api/playbook/practices/account-weekly-balance/config", {
        kindOverride: "risk",
      });
      assert.equal(putRes.status, 200, "PUT should succeed");
      assert.equal(putRes.body.kindOverride, "risk", "response should show stored override");
      assert.equal(putRes.body.resolvedKind, "risk", "response should show resolved value");
      assert.equal(putRes.body.kind, "info", "response should still show catalog kind (built-in)");

      // Follow-up GET to prove the override actually persisted (the critical direction)
      const getRes = await get("/api/playbook/practices");
      const practice = getRes.body.practices.find((p) => p.id === "account-weekly-balance");
      assert.equal(practice.kindOverride, "risk", "GET should show override persisted");
      assert.equal(practice.resolvedKind, "risk", "GET should show resolved value changed");

      // Restore state
      await put("/api/playbook/practices/account-weekly-balance/config", {
        kindOverride: null,
      });
    });

    // T5b — Invalid kind value
    it("400s on an invalid kind value", async () => {
      const res = await put("/api/playbook/practices/account-weekly-balance/config", {
        kindOverride: "not-a-kind",
      });
      assert.equal(res.status, 400);
      assert(res.body.error?.message?.includes("kindOverride"));
    });

    // T5c — Invalid severity value
    it("400s on an invalid severity value (proves the pinned enum)", async () => {
      const res = await put("/api/playbook/practices/account-weekly-balance/config", {
        severityOverride: "critical",
      });
      assert.equal(res.status, 400);
      assert(res.body.error?.message?.includes("severityOverride"));
    });

    // T5d — Clear override to default
    it("clearing an override reverts to catalog defaults", async () => {
      await put("/api/playbook/practices/account-weekly-balance/config", {
        kindOverride: "good",
      });
      const clearRes = await put("/api/playbook/practices/account-weekly-balance/config", {
        kindOverride: null,
      });
      assert.equal(clearRes.body.kindOverride, null);
      assert.equal(clearRes.body.resolvedKind, clearRes.body.kind);
    });

    // T5e (partial) — Overriding one practice does not affect another
    it("overriding one practice does not affect another", async () => {
      const beforeRes = await get("/api/playbook/practices");
      const sessionTokenBefore = beforeRes.body.practices.find(
        (p) => p.id === "session-token-ceiling"
      );

      await put("/api/playbook/practices/account-weekly-balance/config", {
        kindOverride: "good",
      });

      const afterRes = await get("/api/playbook/practices");
      const sessionTokenAfter = afterRes.body.practices.find(
        (p) => p.id === "session-token-ceiling"
      );

      assert.equal(sessionTokenAfter.kindOverride, null);
      assert.equal(sessionTokenAfter.resolvedKind, sessionTokenAfter.kind);
    });

    // T6 — Numeric-only PUT preserves override. Uses session-token-ceiling
    // (not account-weekly-balance, which has no fields of its own to edit
    // — see practices.js's file header) since this test's whole premise is
    // editing a real numeric field alongside an override.
    it("a numeric-only config PUT does not clear an existing kind override (partial-patch discipline)", async () => {
      // Set an override first
      await put("/api/playbook/practices/session-token-ceiling/config", {
        kindOverride: "risk",
      });

      // Then edit only a numeric field (the regression case)
      const res = await put("/api/playbook/practices/session-token-ceiling/config", {
        config: { thresholdTokens: 150_000_000 },
      });

      // Override must survive
      assert.equal(res.body.kindOverride, "risk", "override should survive numeric-only save");
      assert.equal(
        res.body.resolvedKind,
        "risk",
        "resolved value should still reflect the override"
      );

      // Follow-up GET to prove it persisted
      const getRes = await get("/api/playbook/practices");
      const practice = getRes.body.practices.find((p) => p.id === "session-token-ceiling");
      assert.equal(practice.kindOverride, "risk", "override should persist across a second fetch");

      // Restore state
      await put("/api/playbook/practices/session-token-ceiling/config", {
        kindOverride: null,
        config: { thresholdTokens: 100_000_000 },
      });
    });

    // T6b — Numeric-only PUT preserves severity override (twin of the kind case above)
    it("a numeric-only config PUT does not clear an existing severity override (partial-patch discipline)", async () => {
      // Set an override first
      await put("/api/playbook/practices/session-token-ceiling/config", {
        severityOverride: "warning",
      });

      // Then edit only a numeric field (the regression case)
      const res = await put("/api/playbook/practices/session-token-ceiling/config", {
        config: { thresholdTokens: 150_000_000 },
      });

      // Override must survive
      assert.equal(
        res.body.severityOverride,
        "warning",
        "override should survive numeric-only save"
      );
      assert.equal(
        res.body.resolvedSeverity,
        "warning",
        "resolved value should still reflect the override"
      );

      // Follow-up GET to prove it persisted
      const getRes = await get("/api/playbook/practices");
      const practice = getRes.body.practices.find((p) => p.id === "session-token-ceiling");
      assert.equal(
        practice.severityOverride,
        "warning",
        "override should persist across a second fetch"
      );

      // Restore state
      await put("/api/playbook/practices/session-token-ceiling/config", {
        severityOverride: null,
        config: { thresholdTokens: 100_000_000 },
      });
    });
  });

  describe("GET /api/coach/observations + POST respond", () => {
    it("lists nothing on a fresh DB", async () => {
      const res = await get("/api/coach/observations");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.observations, []);
    });

    it("lists an inserted observation, filters by status, and accepts a response", async () => {
      const info = stmts.insertCoachObservation.run(
        "session-token-ceiling",
        "session",
        "sess-route-test",
        "risk",
        "warning",
        JSON.stringify({ totalTokens: 150_000_000, thresholdTokens: 100_000_000 })
      );
      const id = info.lastInsertRowid;

      const listRes = await get("/api/coach/observations");
      assert.ok(listRes.body.observations.some((o) => o.id === id));

      const openRes = await get("/api/coach/observations?status=open");
      assert.ok(openRes.body.observations.some((o) => o.id === id));

      const respondRes = await post(`/api/coach/observations/${id}/respond`, {
        response: "dismissed",
      });
      assert.equal(respondRes.status, 200);
      assert.equal(respondRes.body.status, "dismissed");
      assert.ok(respondRes.body.responded_at);

      const dismissedRes = await get("/api/coach/observations?status=dismissed");
      assert.ok(dismissedRes.body.observations.some((o) => o.id === id));
      const stillOpenRes = await get("/api/coach/observations?status=open");
      assert.ok(!stillOpenRes.body.observations.some((o) => o.id === id));
    });

    it("400s on an invalid response value", async () => {
      const info = stmts.insertCoachObservation.run(
        "session-token-ceiling",
        "session",
        "sess-route-test-2",
        "risk",
        "warning",
        "{}"
      );
      const res = await post(`/api/coach/observations/${info.lastInsertRowid}/respond`, {
        response: "not-a-real-response",
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_RESPONSE");
    });

    it("404s responding to an unknown observation id", async () => {
      const res = await post("/api/coach/observations/999999/respond", { response: "dismissed" });
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, "NOT_FOUND");
    });

    it("400s on an unknown status filter", async () => {
      const res = await get("/api/coach/observations?status=not-a-real-status");
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_STATUS");
    });
  });

  describe("GET/PUT /api/playbook/settings", () => {
    it("returns the catalog default (3h) on a fresh DB", async () => {
      const res = await get("/api/playbook/settings");
      assert.equal(res.status, 200);
      assert.equal(res.body.autoResolveAfterMs, 3 * 60 * 60 * 1000);
    });

    it("persists a patch and a follow-up GET reflects it", async () => {
      const putRes = await put("/api/playbook/settings", { autoResolveAfterMs: 60_000 });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.body.autoResolveAfterMs, 60_000);

      const getRes = await get("/api/playbook/settings");
      assert.equal(getRes.body.autoResolveAfterMs, 60_000);

      // restore for later tests
      await put("/api/playbook/settings", { autoResolveAfterMs: 3 * 60 * 60 * 1000 });
    });

    it("allows 0 (disables the time-based backstop)", async () => {
      const putRes = await put("/api/playbook/settings", { autoResolveAfterMs: 0 });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.body.autoResolveAfterMs, 0);

      // restore for later tests
      await put("/api/playbook/settings", { autoResolveAfterMs: 3 * 60 * 60 * 1000 });
    });

    it("400s on a negative value", async () => {
      const res = await put("/api/playbook/settings", { autoResolveAfterMs: -1 });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_SETTINGS");
    });

    it("400s on a non-numeric value", async () => {
      const res = await put("/api/playbook/settings", { autoResolveAfterMs: "3h" });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_SETTINGS");
    });

    it("an empty PUT body is a no-op that returns the current value", async () => {
      const before = await get("/api/playbook/settings");
      const res = await put("/api/playbook/settings", {});
      assert.equal(res.status, 200);
      assert.equal(res.body.autoResolveAfterMs, before.body.autoResolveAfterMs);
    });
  });
});
