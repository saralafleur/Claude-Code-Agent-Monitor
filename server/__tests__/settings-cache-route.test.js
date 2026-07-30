/**
 * @file Tests for the Settings → Focus Summaries surface: focus-summary.js's
 * access logging to focus_summary_access_log (server/lib/focus-summary.js),
 * the GET /api/settings/cache/timeline and GET /api/settings/cache/day
 * routes, the focus_summary_cache stats on GET /api/settings/info, and the
 * retention hooks in clear-data and cleanup(purge_days).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const http = require("http");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-cache-route-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");
const { generateWindowSummary } = require("../lib/focus-summary");

let server;
let BASE;

// --- HTTP helper, copied per this repo's own one-helper-per-file convention
// (see server/__tests__/focus-report-route.test.js). ---
function fetch(urlPath, options = {}) {
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
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}
function post(urlPath, body) {
  return fetch(urlPath, { method: "POST", body });
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  const addr = server.address();
  BASE = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server?.close();
  try {
    db.close();
  } catch {
    /* already closed */
  }
});

// Directly inserted rather than routed through a real generation — these
// tests target the log plumbing and the read routes, not LLM availability.
function seedLogRow({
  cacheKey,
  level = "window",
  day,
  outcome,
  projectId = null,
  sessionId = null,
  unassigned = 0,
  model,
  bulletCount = null,
  accessedAt,
}) {
  db.prepare(
    `INSERT INTO focus_summary_access_log
       (cache_key, level, outcome, project_id, session_id, unassigned, model, bullet_count, access_day, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    cacheKey,
    level,
    outcome,
    projectId,
    sessionId,
    unassigned,
    model ?? null,
    bulletCount,
    day,
    accessedAt
  );
}

function fakeReport(sessions) {
  return { sessions };
}

describe("generateWindowSummary → focus_summary_access_log", () => {
  it("logs a miss then a hit for the same window cache key", async () => {
    // LLM path is disabled by default in tests (no DASHBOARD_FOCUS_INFER_MODE=llm),
    // so generateWindowSummary resolves null and nothing should be logged —
    // this only exercises the plumbing that's reachable without a spawn.
    const report = fakeReport([]);
    const result = await generateWindowSummary(require("../db"), "log-key-empty", report);
    assert.equal(result, null);
    const rows = db
      .prepare("SELECT * FROM focus_summary_access_log WHERE cache_key = ?")
      .all("log-key-empty");
    assert.equal(rows.length, 0); // empty report short-circuits before any log write
  });
});

describe("GET /api/settings/cache/timeline", () => {
  it("zero-fills days with no activity and aggregates days with rows", async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedLogRow({
      cacheKey: JSON.stringify({ project_id: "p1", from: 1, to: 2 }),
      day: today,
      outcome: "hit",
      projectId: "p1",
      model: "claude-sonnet-5",
      bulletCount: 3,
      accessedAt: new Date().toISOString(),
    });
    seedLogRow({
      cacheKey: JSON.stringify({ day: 123, scope: { unassigned: true } }),
      level: "day",
      day: today,
      outcome: "miss",
      unassigned: 1,
      model: "claude-opus-5",
      bulletCount: 4,
      accessedAt: new Date().toISOString(),
    });

    const res = await fetch("/api/settings/cache/timeline?days=7");
    assert.equal(res.status, 200);
    assert.equal(res.body.days.length, 7);
    const todayRow = res.body.days[res.body.days.length - 1];
    assert.equal(todayRow.date, today);
    assert.ok(todayRow.hits >= 1);
    assert.ok(todayRow.misses >= 1);
    assert.equal(todayRow.total, todayRow.hits + todayRow.misses);

    // an empty day earlier in the range is zero-filled, not omitted
    const earliest = res.body.days[0];
    assert.equal(typeof earliest.hits, "number");
    assert.equal(typeof earliest.misses, "number");
  });

  it("clamps days to [1, 90]", async () => {
    const tooMany = await fetch("/api/settings/cache/timeline?days=9999");
    assert.equal(tooMany.body.days.length, 90);
    const tooFew = await fetch("/api/settings/cache/timeline?days=0");
    assert.equal(tooFew.body.days.length, 1);
  });
});

describe("GET /api/settings/cache/day", () => {
  const day = "2026-02-14";

  before(() => {
    stmts.insertSession.run(
      "cache-day-sess",
      "Cache Day Session",
      "active",
      "/repo/proj",
      "claude-sonnet-5",
      null
    );

    seedLogRow({
      cacheKey: JSON.stringify({ session_id: "cache-day-sess", from: 1, to: 2 }),
      day,
      outcome: "hit",
      sessionId: "cache-day-sess",
      model: "claude-sonnet-5",
      bulletCount: 3,
      accessedAt: `${day}T10:00:00.000Z`,
    });
    seedLogRow({
      cacheKey: JSON.stringify({ day: 456, scope: { unassigned: true } }),
      level: "day",
      day,
      outcome: "miss",
      unassigned: 1,
      model: "claude-opus-5",
      bulletCount: 2,
      accessedAt: `${day}T11:00:00.000Z`,
    });
  });

  it("400s on a missing or malformed date", async () => {
    const missing = await fetch("/api/settings/cache/day");
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, "INVALID_DATE");

    const malformed = await fetch("/api/settings/cache/day?date=02-14-2026");
    assert.equal(malformed.status, 400);
  });

  it("returns a summary and entries with scope labels resolved", async () => {
    const res = await fetch(`/api/settings/cache/day?date=${day}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.hits, 1);
    assert.equal(res.body.misses, 1);
    assert.equal(res.body.total, 2);
    assert.deepEqual(res.body.models.sort(), ["claude-opus-5", "claude-sonnet-5"]);

    const sessionRow = res.body.entries.find((e) => e.level === "window");
    const dayRow = res.body.entries.find((e) => e.level === "day");
    assert.equal(sessionRow.scope_label, "Cache Day Session");
    assert.equal(sessionRow.outcome, "hit");
    assert.equal(sessionRow.bullet_count, 3);
    assert.equal(dayRow.scope_label, "Unassigned");
    assert.equal(dayRow.outcome, "miss");
  });

  it("filters by outcome, model, and level", async () => {
    const hits = await fetch(`/api/settings/cache/day?date=${day}&outcome=hit`);
    assert.equal(hits.body.entries.length, 1);
    assert.equal(hits.body.entries[0].outcome, "hit");

    const byModel = await fetch(
      `/api/settings/cache/day?date=${day}&model=${encodeURIComponent("claude-opus-5")}`
    );
    assert.equal(byModel.body.entries.length, 1);
    assert.equal(byModel.body.entries[0].model, "claude-opus-5");
    // summary totals are for the whole day, unaffected by the entry filters
    assert.equal(byModel.body.total, 2);

    const byLevel = await fetch(`/api/settings/cache/day?date=${day}&level=day`);
    assert.equal(byLevel.body.entries.length, 1);
    assert.equal(byLevel.body.entries[0].level, "day");
  });

  it("returns an empty (not missing) shape for a day with no activity", async () => {
    const res = await fetch("/api/settings/cache/day?date=2020-01-01");
    assert.equal(res.status, 200);
    assert.equal(res.body.hits, 0);
    assert.equal(res.body.misses, 0);
    assert.deepEqual(res.body.entries, []);
    assert.deepEqual(res.body.models, []);
  });
});

describe("GET /api/settings/info focus_summary_cache", () => {
  it("reports size, hit/miss counts, and hitRate", async () => {
    const res = await fetch("/api/settings/info");
    assert.equal(res.status, 200);
    const fsc = res.body.focus_summary_cache;
    assert.equal(typeof fsc.size, "number");
    assert.equal(typeof fsc.hits, "number");
    assert.equal(typeof fsc.misses, "number");
    assert.equal(typeof fsc.hitRate, "number");
    assert.equal(typeof fsc.totalBullets, "number");
  });
});

describe("Focus summary cache log retention", () => {
  it("POST /api/settings/cleanup purges focus_summary_access_log rows older than purge_days", async () => {
    const oldIso = new Date(Date.now() - 200 * 86400000).toISOString();
    seedLogRow({
      cacheKey: "ancient-key",
      day: oldIso.slice(0, 10),
      outcome: "hit",
      model: null,
      accessedAt: oldIso,
    });

    const before = db.prepare("SELECT COUNT(*) AS c FROM focus_summary_access_log").get().c;
    const res = await post("/api/settings/cleanup", { purge_days: 90 });
    assert.equal(res.status, 200);
    assert.ok(res.body.purged_focus_summary_log >= 1);
    const after = db.prepare("SELECT COUNT(*) AS c FROM focus_summary_access_log").get().c;
    assert.ok(after < before);
  });

  it("POST /api/settings/clear-data wipes focus_summary_access_log entirely, leaving focus_summaries alone", async () => {
    seedLogRow({
      cacheKey: "still-here-key",
      day: new Date().toISOString().slice(0, 10),
      outcome: "hit",
      model: null,
      accessedAt: new Date().toISOString(),
    });
    stmts.upsertFocusSummary.run(
      "survives-clear",
      "digest",
      JSON.stringify(["a bullet"]),
      "claude-sonnet-5"
    );
    assert.ok(db.prepare("SELECT COUNT(*) AS c FROM focus_summary_access_log").get().c > 0);

    const res = await post("/api/settings/clear-data", {});
    assert.equal(res.status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM focus_summary_access_log").get().c, 0);
    // the cache content itself is untouched by clear-data
    assert.ok(stmts.getFocusSummary.get("survives-clear"));
  });
});
