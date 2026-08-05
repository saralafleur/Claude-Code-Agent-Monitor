/**
 * @file Boot-time migration resilience test: non-atomic multi-column ALTER
 * under interruption (T-E, §9.6). Seeds legacy DB with only input_stage column
 * (mid-crash state) to verify the helper's per-column probe and convergent
 * semantics. Layer 5 (process-grain boot bucket, app-level proof).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const { EventEmitter } = require("node:events");

// Set DB path BEFORE requiring db.js
const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-value-summary-interrupted-boot-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

// Build mid-crash schema before requiring ../index
const Database = require("better-sqlite3");
let legacyDb = new Database(TEST_DB);

// Legacy CREATE bodies verbatim (pre-slice, from db.js:826-832, 1822-1835)
const legacyValueUnitSummariesCreate = `
  CREATE TABLE IF NOT EXISTS value_unit_summaries (
    unit_key TEXT PRIMARY KEY,
    project_level TEXT NOT NULL,
    stakeholder_level TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`;

const legacyValueSummaryGenerationLogCreate = `
  CREATE TABLE IF NOT EXISTS value_summary_generation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL,
    pool_size INTEGER NOT NULL,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    generated INTEGER NOT NULL DEFAULT 0,
    queued INTEGER NOT NULL DEFAULT 0,
    unavailable INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`;

legacyDb.exec(legacyValueUnitSummariesCreate);
legacyDb.exec(legacyValueSummaryGenerationLogCreate);

// B4: Mid-crash state — add ONLY input_stage column (simulates death between
// statements 1 and 2 of a raw five-ALTER block)
legacyDb.exec("ALTER TABLE value_unit_summaries ADD COLUMN input_stage TEXT");

// Seed a row with non-null input_stage to prove convergence
legacyDb
  .prepare(
    `
  INSERT INTO value_unit_summaries
  (unit_key, project_level, stakeholder_level, model, input_stage)
  VALUES (?, ?, ?, ?, ?)
`
  )
  .run(
    "trunk_commit::interrupt-test::/repo",
    "Repo project",
    "Test unit with partial state",
    "claude-3-5-sonnet-20241022",
    "built" // pre-existing input_stage from prior run
  );

legacyDb.close();

// NOW require the app (which will trigger migrations)
const { createApp, startServer } = require("../index");
const dbModule = require("../db");
const { db } = dbModule;
const { __injectSpawnForTest } = require("../lib/focus-inference");

let server;

/** Fake ChildProcess factory matching `focus-inference.js`'s spawnImpl(cmd,
 * args, opts) contract — `__injectSpawnForTest` replaces `spawnImpl` itself,
 * not `runClaudePromptJson`, so the injected function must return an
 * EventEmitter-like child (`.on`, `.stdout`, `.stderr`, `.kill`), not a
 * Promise. Used for both `probeClaudeCli()`'s `claude --version` probe and
 * the real batch generation spawn. */
function fakeSpawn({ exitCode = 0, stdout = "" } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.resume = () => {};
    child.kill = () => {};
    setImmediate(() => {
      if (stdout) child.stdout.emit("data", stdout);
      child.emit("exit", exitCode);
    });
    return child;
  };
}

before(async () => {
  // Positive control: verify DB_PATH is set correctly
  assert.equal(
    dbModule.DB_PATH,
    TEST_DB,
    "DB_PATH should match test env variable (positive control)"
  );

  const app = createApp();
  server = await startServer(app, 0);
});

after(() => {
  __injectSpawnForTest(null);
  server?.close();
  try {
    db.close();
  } catch {
    // Ignore
  }
});

describe("B4: non-atomic migration convergence under interruption (T-E, §9.6)", () => {
  it("boot succeeds (no throw out of require()); all five columns present; pre-existing input_stage data survived; second boot is no-op", () => {
    // (a) No throw escaping require() — if we got here, we're green
    assert.ok(true, "startServer completed without throwing");

    // (b) All five columns present
    const tableInfo = db.prepare("PRAGMA table_info(value_unit_summaries)").all();
    const columnNames = tableInfo.map((col) => col.name);

    assert.ok(columnNames.includes("input_stage"), "input_stage present");
    assert.ok(columnNames.includes("input_label"), "input_label present");
    assert.ok(columnNames.includes("regenerated_at"), "regenerated_at present");
    assert.ok(columnNames.includes("regen_reason"), "regen_reason present");
    assert.ok(columnNames.includes("seen_at"), "seen_at present");

    // (c) Pre-existing input_stage data survived
    const seededRow = db
      .prepare("SELECT input_stage FROM value_unit_summaries WHERE unit_key = ?")
      .get("trunk_commit::interrupt-test::/repo");

    assert.equal(
      seededRow.input_stage,
      "built",
      "pre-existing input_stage value survived (convergence, not drop-and-recreate)"
    );

    // (d) Second cache-busted require is a no-op
    delete require.cache[require.resolve("../db")];
    delete require.cache[require.resolve("../index")];

    process.env.DASHBOARD_DB_PATH = TEST_DB;
    const db2 = require("../db");

    const tableInfo2 = db2.db.prepare("PRAGMA table_info(value_unit_summaries)").all();
    assert.equal(tableInfo2.length, tableInfo.length, "second boot adds no new columns (no-op)");

    db2.db.close();
  });

  it("POST /api/project-plans/altitudes works post-migration", async () => {
    // Verify the route works against the migrated schema
    const testUrl = `http://127.0.0.1:${server.address().port}/api/project-plans/altitudes`;

    __injectSpawnForTest(
      fakeSpawn({
        stdout: JSON.stringify({
          result: JSON.stringify({
            units: [
              {
                index: 1,
                project: "Test",
                stakeholder: "Test response",
              },
            ],
          }),
        }),
      })
    );

    const payload = JSON.stringify({
      project_id: "test-project",
      units: [
        {
          unit_key: "trunk_commit::post-migration::/repo",
          value_source: "trunk_commit",
          value_ref: "post-migration",
        },
      ],
    });

    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        testUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          });
        }
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    assert.equal(result.status, 200, "POST /altitudes returns 200");
    assert.ok(result.body.altitudes["trunk_commit::post-migration::/repo"], "unit in altitudes");
  });
});
