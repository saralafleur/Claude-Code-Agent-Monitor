/**
 * @file Tests for the Coach's Playbook: the engine's tick/evaluateSession
 * (session-token-ceiling firing, dedup against an already-open Observation,
 * and the enabled/disabled config gate), plus the /api/playbook/practices
 * and /api/coach/observations routes (CRUD + validation).
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
      assert.equal(res.body.practices.length, 1);
      const [practice] = res.body.practices;
      assert.equal(practice.id, "session-token-ceiling");
      assert.equal(practice.enabled, true);
      assert.deepEqual(practice.config, { thresholdTokens: 100_000_000 });
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
      assert.deepEqual(putRes.body.config, { thresholdTokens: 50_000_000 });

      const getRes = await get("/api/playbook/practices");
      assert.equal(getRes.body.practices[0].enabled, false);
      assert.deepEqual(getRes.body.practices[0].config, { thresholdTokens: 50_000_000 });

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
});
