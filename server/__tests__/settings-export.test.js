/**
 * @file Functional test for GET /api/settings/export
 * (server/routes/settings.js) — the streamed-response rewrite from 60af828.
 * Confirms the stream actually contains correct, complete, correctly-ordered
 * data, not just that the route exists — server/__tests__/api.test.js's
 * OpenAPI coverage check only proves the path is documented against
 * GET /api/openapi.json, it never issues a real GET or inspects a response
 * body. Distinct from server/__tests__/data-transfer.test.js, which tests
 * the unrelated backup/restore bundle (server/lib/data-transfer.js's
 * buildExportBundle/importExportBundle) built via .all(), not this route's
 * Statement#iterate()-based streaming.
 *
 * Backfill coverage (D3, should-add) for an already-shipped, already-correct
 * route — should-add, not blocking; per this build's own stop-and-report
 * trigger, a failure here on first run against current master would signal
 * a REAL bug in the already-shipped route, not an expected red state.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-settings-export-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db } = require("../db");

let server;
let BASE;

// Raw-body fetch (not JSON-auto-parsed) - the export route sets
// Content-Disposition: attachment, and this test needs the exact bytes to
// assert on stream validity itself (JSON.parse throwing on the raw body is
// the actual assertion), not just a parsed object. Copied per this repo's
// own one-helper-per-file, no-supertest, no-cross-import convention (see
// server/__tests__/focus-report-route.test.js's own comment on this rule).
function fetchRaw(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
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
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
});

// Mirrors data-transfer.test.js's own seedSession shape (1 session, 2 agents
// - main + sub, N events, 1 token_usage row) minus the workflows row, which
// this route doesn't export.
function seedSession(id, { startedAt, endedAt, events = 2 } = {}) {
  db.prepare(
    "INSERT INTO sessions (id, name, status, cwd, model, started_at, ended_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, `Session ${id}`, "completed", `/tmp/${id}`, "claude-opus-4-8", startedAt, endedAt);

  const mainId = `agent_main_${id}`;
  const subId = `agent_sub_${id}`;
  db.prepare(
    "INSERT INTO agents (id, session_id, name, type, status, started_at) VALUES (?,?,?,?,?,?)"
  ).run(mainId, id, "Main", "main", "completed", startedAt);
  const subStartedAt = new Date(new Date(startedAt).getTime() + 10 * 60_000).toISOString();
  db.prepare(
    "INSERT INTO agents (id, session_id, name, type, subagent_type, status, started_at, parent_agent_id) VALUES (?,?,?,?,?,?,?,?)"
  ).run(subId, id, "Sub", "subagent", "explorer", "completed", subStartedAt, mainId);

  for (let i = 0; i < events; i++) {
    const createdAt = new Date(new Date(startedAt).getTime() + i * 60_000).toISOString();
    db.prepare(
      "INSERT INTO events (session_id, agent_id, event_type, tool_name, summary, created_at) VALUES (?,?,?,?,?,?)"
    ).run(id, mainId, "PostToolUse", "Bash", `evt ${i}`, createdAt);
  }

  db.prepare(
    "INSERT INTO token_usage (session_id, model, input_tokens, output_tokens, baseline_input) VALUES (?,?,?,?,?)"
  ).run(id, "claude-opus-4-8", 1000, 500, 250);
}

/** True if `arr[key]` (an ISO timestamp field) is non-increasing across the
 *  whole array - the ordering contract this route's own `.prepare()` calls
 *  declare (`ORDER BY started_at DESC` / `ORDER BY created_at DESC`). */
function isSortedDescBy(arr, key) {
  for (let i = 1; i < arr.length; i++) {
    if (new Date(arr[i - 1][key]).getTime() < new Date(arr[i][key]).getTime()) return false;
  }
  return true;
}

describe("GET /api/settings/export", () => {
  it("streams valid, parseable JSON with empty arrays when the DB has no seeded sessions yet", async () => {
    const res = await fetchRaw("/api/settings/export");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.match(
      res.headers["content-disposition"],
      /attachment; filename="agent-monitor-export-\d{4}-\d{2}-\d{2}\.json"/
    );

    // JSON.parse itself is the assertion that the stream produced
    // well-formed JSON - not malformed output from writeJsonArray's
    // first-flag comma bookkeeping at the empty-array edge case.
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.exported_at);
    assert.ok(!Number.isNaN(new Date(parsed.exported_at).getTime()));
    assert.deepEqual(parsed.sessions, []);
    assert.deepEqual(parsed.agents, []);
    assert.deepEqual(parsed.events, []);
    assert.deepEqual(parsed.token_usage, []);
    // Default pricing rows are seeded at DB init regardless of session data -
    // "empty" here means no session-derived rows, not a literally-empty DB.
    assert.ok(Array.isArray(parsed.model_pricing) && parsed.model_pricing.length > 0);
  });

  it("streams a valid JSON body containing every seeded row, correctly shaped, counted, and ordered", async () => {
    seedSession("exp-s1", {
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
      events: 3,
    });
    seedSession("exp-s2", {
      startedAt: "2026-06-02T00:00:00.000Z",
      endedAt: "2026-06-02T01:00:00.000Z",
      events: 2,
    });

    const res = await fetchRaw("/api/settings/export");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.match(
      res.headers["content-disposition"],
      /attachment; filename="agent-monitor-export-\d{4}-\d{2}-\d{2}\.json"/
    );

    const parsed = JSON.parse(res.body); // throws if the stream produced malformed JSON
    assert.ok(parsed.exported_at);

    // Row counts per table match exactly what was seeded.
    assert.equal(parsed.sessions.length, 2);
    assert.equal(parsed.agents.length, 4); // 2 sessions x (1 main + 1 sub)
    assert.equal(parsed.events.length, 5); // 3 + 2
    assert.equal(parsed.token_usage.length, 2);
    assert.ok(Array.isArray(parsed.model_pricing) && parsed.model_pricing.length > 0);

    // Content correctness, not just counts - a seeded row's specific field
    // values round-trip verbatim.
    const s1 = parsed.sessions.find((s) => s.id === "exp-s1");
    assert.ok(s1);
    assert.equal(s1.status, "completed");
    assert.equal(s1.cwd, "/tmp/exp-s1");
    assert.equal(s1.started_at, "2026-06-01T00:00:00.000Z");

    const s1TokenUsage = parsed.token_usage.find((r) => r.session_id === "exp-s1");
    assert.ok(s1TokenUsage);
    assert.equal(s1TokenUsage.input_tokens, 1000);
    assert.equal(s1TokenUsage.output_tokens, 500);

    // Ordering pin: the route's own `ORDER BY started_at DESC` (sessions,
    // agents) / `ORDER BY created_at DESC` (events) - not incidental.
    assert.equal(isSortedDescBy(parsed.sessions, "started_at"), true);
    assert.equal(isSortedDescBy(parsed.agents, "started_at"), true);
    assert.equal(isSortedDescBy(parsed.events, "created_at"), true);
    // The more-recently-started session/agent sorts first.
    assert.equal(parsed.sessions[0].id, "exp-s2");
    assert.equal(parsed.agents[0].session_id, "exp-s2");
  });
});
