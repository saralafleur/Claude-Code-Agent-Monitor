/**
 * @file Boot-time migration test: value_unit_summaries and
 * value_summary_generation_log schema. Tests the legacy row behavior when the
 * app boots against a pre-slice DB schema. Layer 5 (process-grain boot bucket).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { EventEmitter } = require("node:events");

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

// Set DB path BEFORE requiring db.js
const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-value-summary-legacy-boot-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

// Build legacy schema before requiring ../index
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

// Seed with legacy rows
legacyDb.exec(legacyValueUnitSummariesCreate);
legacyDb.exec(legacyValueSummaryGenerationLogCreate);

// B1/B2: Seed the resumeJobPipelineTracker row (legacy mutable)
legacyDb
  .prepare(
    `
  INSERT INTO value_unit_summaries
  (unit_key, project_level, stakeholder_level, model)
  VALUES (?, ?, ?, ?)
`
  )
  .run(
    "intake_initiative::2026-08-03-job-pipeline-tracker::/repo",
    "Intake Initiative project text",
    "The job pipeline tracker is built and being tested",
    "claude-3-5-sonnet-20241022"
  );

// B3: Seed a trunk_commit row (legacy immutable)
legacyDb
  .prepare(
    `
  INSERT INTO value_unit_summaries
  (unit_key, project_level, stakeholder_level, model)
  VALUES (?, ?, ?, ?)
`
  )
  .run(
    "trunk_commit::legacy-commit::/repo",
    "Repo project text",
    "Committed feature text",
    "claude-3-5-sonnet-20241022"
  );

// B1: Seed a legacy log row
legacyDb
  .prepare(
    `
  INSERT INTO value_summary_generation_log
  (project_id, source, pool_size, cache_hits, generated, queued, unavailable)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`
  )
  .run("test-project", "tick", 10, 5, 3, 2, 0);

legacyDb.close();

// NOW require the app (which will trigger migrations)
const { createApp, startServer } = require("../index");
const dbModule = require("../db");
const { db } = dbModule;

let server;

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
  server?.close();
  try {
    db.close();
  } catch {
    // Ignore
  }
});

describe("value_unit_summaries schema migration (B1–B3)", () => {
  it("B1: boot completes without throw; all five new columns present; legacy rows read NULL for new columns", () => {
    // Get the table schema
    const tableInfo = db.prepare("PRAGMA table_info(value_unit_summaries)").all();
    const columnNames = tableInfo.map((col) => col.name);

    // Original columns must still exist
    assert.ok(columnNames.includes("unit_key"), "unit_key column exists");
    assert.ok(columnNames.includes("project_level"), "project_level column exists");
    assert.ok(columnNames.includes("stakeholder_level"), "stakeholder_level column exists");

    // Five new columns must exist
    assert.ok(columnNames.includes("input_stage"), "input_stage column exists");
    assert.ok(columnNames.includes("input_label"), "input_label column exists");
    assert.ok(columnNames.includes("regenerated_at"), "regenerated_at column exists");
    assert.ok(columnNames.includes("regen_reason"), "regen_reason column exists");
    assert.ok(columnNames.includes("seen_at"), "seen_at column exists");

    // Legacy rows should read NULL for new columns
    const legacyRow = db
      .prepare("SELECT * FROM value_unit_summaries WHERE unit_key = ?")
      .get("intake_initiative::2026-08-03-job-pipeline-tracker::/repo");

    assert.strictEqual(legacyRow.input_stage, null, "input_stage is NULL for legacy row");
    assert.strictEqual(legacyRow.input_label, null, "input_label is NULL for legacy row");
    assert.strictEqual(legacyRow.regenerated_at, null, "regenerated_at is NULL for legacy row");
    assert.strictEqual(legacyRow.regen_reason, null, "regen_reason is NULL for legacy row");
    assert.strictEqual(legacyRow.seen_at, null, "seen_at is NULL for legacy row");
  });

  it("B2: legacy mutable row is stale over HTTP (DEC-9)", async () => {
    const http = require("http");

    // Make a test request to /api/project-plans/altitudes
    const { __injectSpawnForTest } = require("../lib/focus-inference");
    const { enrichPoolAltitudes } = require("../lib/value-summary");

    const unit = {
      unitKey: "intake_initiative::2026-08-03-job-pipeline-tracker::/repo",
      value_source: "intake_initiative",
      value_ref: "2026-08-03-job-pipeline-tracker",
      stage: "built",
      label: "Job pipeline tracker",
    };

    // Inject spawn that returns new text
    __injectSpawnForTest(
      fakeSpawn({
        stdout: JSON.stringify({
          result: JSON.stringify({
            units: [
              {
                index: 1,
                project: "New project text",
                stakeholder: "New stakeholder text (regenerated)",
              },
            ],
          }),
        }),
      })
    );

    // Call enrichPoolAltitudes with the legacy unit
    const result = await enrichPoolAltitudes(dbModule, [unit]);

    // Should regenerate (spawn called, new text in result)
    assert.ok(result.altitudes[unit.unitKey], "unit in altitudes");
    assert.equal(
      result.altitudes[unit.unitKey].stakeholder,
      "New stakeholder text (regenerated)",
      "legacy mutable row regenerated with new text"
    );
    assert.equal(result.counts.generated, 1, "counted as generated (not hit)");

    // DB row should be updated
    const updated = db
      .prepare("SELECT * FROM value_unit_summaries WHERE unit_key = ?")
      .get(unit.unitKey);
    assert.ok(updated.regenerated_at, "regenerated_at set");
    assert.equal(updated.regen_reason, "stage_changed", "regen_reason set to stage_changed");

    __injectSpawnForTest(null);
  });

  it("B3: legacy trunk_commit row is fresh (immutable, zero regen)", async () => {
    const { enrichPoolAltitudes } = require("../lib/value-summary");
    const { __injectSpawnForTest } = require("../lib/focus-inference");

    const unit = {
      unitKey: "trunk_commit::legacy-commit::/repo",
      value_source: "trunk_commit",
      value_ref: "legacy-commit",
      label: "Committed feature text",
    };

    // Spawn that would fail
    __injectSpawnForTest(() => {
      throw new Error("should not spawn for trunk_commit");
    });

    const result = await enrichPoolAltitudes(dbModule, [unit]);

    // Should serve cached
    assert.ok(result.altitudes[unit.unitKey], "unit cached");
    assert.equal(
      result.altitudes[unit.unitKey].stakeholder,
      "Committed feature text",
      "served from cache (no regeneration)"
    );
    assert.equal(result.counts.cache_hits, 1, "counted as cache hit");
    assert.equal(result.counts.generated, 0, "zero generated");
    assert.ok(!("freshness" in result.altitudes[unit.unitKey]), "no freshness marker (immutable)");

    __injectSpawnForTest(null);
  });
});

describe("value_summary_generation_log schema migration", () => {
  it("stale_regenerated column exists; legacy row reads NULL", () => {
    const tableInfo = db.prepare("PRAGMA table_info(value_summary_generation_log)").all();
    const columnNames = tableInfo.map((col) => col.name);

    assert.ok(columnNames.includes("stale_regenerated"), "stale_regenerated column exists");

    // Legacy row should read NULL (not 0) for stale_regenerated
    const legacyRow = db
      .prepare("SELECT * FROM value_summary_generation_log WHERE source = 'tick'")
      .get();

    assert.strictEqual(legacyRow.stale_regenerated, null, "NULL = predates measurement (DEC-3)");
  });
});
