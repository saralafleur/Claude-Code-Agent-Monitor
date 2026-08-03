/**
 * @file Tests for the global Usage-page color thresholds: the
 * /api/color-thresholds route's GET/PUT CRUD across its four independent
 * scopes (session, weekly, sessionRate, weeklyRate), partial-patch
 * behavior, and input validation.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

// Isolate the DB before loading server.
const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-color-thresholds-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_REMOTE_SYNC_MS = "0";
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const { db } = require("../db");

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

const DEFAULTS = {
  session: { yellowAt: 50, orangeAt: 80, redAt: 100 },
  weekly: { yellowAt: 50, orangeAt: 80, redAt: 100 },
  sessionRate: { yellowAt: 0.5, orangeAt: 1.0, redAt: 1.5 },
  weeklyRate: { yellowAt: 0.5, orangeAt: 1.0, redAt: 1.5 },
};

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

// Every test starts from the pristine default row, since it's process-wide
// global state, not per-test-isolated like a normal table's rows would be.
beforeEach(async () => {
  await put("/api/color-thresholds", DEFAULTS);
});

describe("GET /api/color-thresholds", () => {
  it("returns the default bands for all four scopes on a fresh DB", async () => {
    const res = await get("/api/color-thresholds");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, DEFAULTS);
  });
});

describe("PUT /api/color-thresholds", () => {
  it("persists a full set of thresholds for all four scopes and a follow-up GET reflects it", async () => {
    const thresholds = {
      session: { yellowAt: 30, orangeAt: 60, redAt: 90 },
      weekly: { yellowAt: 40, orangeAt: 70, redAt: 95 },
      sessionRate: { yellowAt: 35, orangeAt: 65, redAt: 92 },
      weeklyRate: { yellowAt: 45, orangeAt: 75, redAt: 98 },
    };
    const putRes = await put("/api/color-thresholds", thresholds);
    assert.equal(putRes.status, 200);
    assert.deepEqual(putRes.body, thresholds);

    const getRes = await get("/api/color-thresholds");
    assert.deepEqual(getRes.body, thresholds);
  });

  it("patches only the given scope, leaving the others untouched", async () => {
    await put("/api/color-thresholds", {
      session: { yellowAt: 30, orangeAt: 60, redAt: 90 },
      weekly: { yellowAt: 40, orangeAt: 70, redAt: 95 },
    });

    const res = await put("/api/color-thresholds", { session: { orangeAt: 65 } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.session, { yellowAt: 30, orangeAt: 65, redAt: 90 });
    assert.deepEqual(res.body.weekly, { yellowAt: 40, orangeAt: 70, redAt: 95 });
    assert.deepEqual(res.body.sessionRate, DEFAULTS.sessionRate);
    assert.deepEqual(res.body.weeklyRate, DEFAULTS.weeklyRate);
  });

  it("patches only the given field within a scope, leaving its other fields untouched", async () => {
    const res = await put("/api/color-thresholds", { weekly: { yellowAt: 45 } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.weekly, { yellowAt: 45, orangeAt: 80, redAt: 100 });
    assert.deepEqual(res.body.session, DEFAULTS.session);
  });

  it("patches the new sessionRate/weeklyRate scopes independently of session/weekly", async () => {
    const res = await put("/api/color-thresholds", {
      sessionRate: { yellowAt: 20, orangeAt: 55, redAt: 85 },
      weeklyRate: { yellowAt: 25, orangeAt: 60, redAt: 90 },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.sessionRate, { yellowAt: 20, orangeAt: 55, redAt: 85 });
    assert.deepEqual(res.body.weeklyRate, { yellowAt: 25, orangeAt: 60, redAt: 90 });
    assert.deepEqual(res.body.session, DEFAULTS.session);
    assert.deepEqual(res.body.weekly, DEFAULTS.weekly);
  });

  // The `color_thresholds_updated` broadcast (so other connected clients pick
  // up a change live) is exercised indirectly: PUT's own response already
  // reflects the persisted, merged result, and a follow-up GET confirms it
  // stuck — see plans-api.test.js for the same convention on `plan_updated`.

  const rejects = [
    ["session not an object", { session: "bad" }],
    ["session.yellowAt not a number", { session: { yellowAt: "50" } }],
    ["session.orangeAt negative", { session: { orangeAt: -1 } }],
    ["weekly.redAt above the max", { weekly: { redAt: 100000 } }],
    ["session.yellowAt equal to session.orangeAt", { session: { yellowAt: 80, orangeAt: 80 } }],
    ["weekly.orangeAt greater than weekly.redAt", { weekly: { orangeAt: 100, redAt: 90 } }],
    ["a full session set out of order", { session: { yellowAt: 90, orangeAt: 50, redAt: 100 } }],
    ["sessionRate not an object", { sessionRate: "bad" }],
    [
      "weeklyRate.yellowAt equal to weeklyRate.orangeAt",
      { weeklyRate: { yellowAt: 80, orangeAt: 80 } },
    ],
  ];
  for (const [name, body] of rejects) {
    it(`rejects ${name} with a 400 + structured error`, async () => {
      const res = await put("/api/color-thresholds", body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_THRESHOLDS");
    });
  }
});
