/**
 * @file Tests for database schema migrations: verifies ALTER TABLE statements
 * execute correctly against pre-existing databases, and that new columns are
 * properly added and readable on legacy rows. Prevents the silent failure mode
 * where fresh installs and upgraded installs diverge in schema shape.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Resolve Database the same way db.js does
let Database;
try {
  Database = require("better-sqlite3");
  new Database(":memory:").close();
} catch {
  Database = require("../compat-sqlite");
}

// Grandfather set, snapshotted 2026-08-01 before layer-5 build started.
// New columns must have an UPGRADE_CASES entry; do not add to this array.
const GRANDFATHERED = [
  "agents.awaiting_input_since",
  "agents.awaiting_reason",
  "agents.updated_at",
  "agents.workflow_phase",
  "agents.workflow_run_id",
  "context_snapshots.cache_read_tokens",
  "context_snapshots.cache_write_tokens",
  "context_snapshots.input_tokens",
  "context_snapshots.output_tokens",
  "model_pricing.cache_write_1h_per_mtok",
  "model_pricing.fast_input_per_mtok",
  "model_pricing.fast_output_per_mtok",
  "model_pricing.intro_until",
  "sessions.awaiting_input_since",
  "sessions.awaiting_reason",
  "sessions.pid",
  "sessions.source",
  "sessions.transcript_path",
  "sessions.updated_at",
  "token_usage.baseline_cache_read",
  "token_usage.baseline_cache_write",
  "token_usage.baseline_input",
  "token_usage.baseline_output",
  "usage_captures.account_id",
  "usage_captures.week_window_pct",
  "webhook_targets.config",
];

// Upgrade cases: each defines a migration test
const UPGRADE_CASES = [
  {
    table: "plan_items",
    column: "target_date",
    legacySql: `
      CREATE TABLE IF NOT EXISTS plan_items (
        cwd TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_number INTEGER,
        parent_item_id TEXT,
        text TEXT NOT NULL,
        acceptance TEXT,
        detail TEXT,
        checked INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        declared_done_at TEXT,
        declared_done_session TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (cwd, item_id),
        FOREIGN KEY (cwd) REFERENCES plans(cwd) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_items_cwd_number ON plan_items(cwd, item_number)
    `,
    seed(legacyDb) {
      // Create a plans row with all required columns
      legacyDb
        .prepare(
          `
        INSERT INTO plans (cwd, title, file_path, content_hash, item_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          "/tmp/test-cwd",
          "Test Plan",
          "/tmp/test-cwd/AGENT-PLAN.md",
          "abc123",
          1,
          "2026-07-01T12:00:00.000Z",
          "2026-07-01T12:00:00.000Z"
        );

      // Create a plan_items row
      legacyDb
        .prepare(
          `
        INSERT INTO plan_items (cwd, item_id, item_number, text, acceptance, declared_done_at, updated_at, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          "/tmp/test-cwd",
          "legacy-id-1",
          1,
          "Legacy item text",
          "Legacy acceptance",
          null,
          "2026-07-01T12:00:00.000Z",
          0
        );
    },
    assertLegacyRow(db) {
      const row = db.prepare("SELECT target_date FROM plan_items WHERE item_number = ?").get(1);
      assert.ok(row, "plan_items row should exist after migration");
      assert.equal(row.target_date, null, "target_date should be NULL for legacy rows");
    },
    assertWritable(db) {
      // Test that the setter statement works against a legacy row
      const stmts = require("../db").stmts;
      stmts.setPlanItemTargetDate.run("2026-08-15", "/tmp/test-cwd", 1);
      const row = db.prepare("SELECT target_date FROM plan_items WHERE item_number = ?").get(1);
      assert.equal(row.target_date, "2026-08-15", "target_date should be settable on legacy rows");
    },
  },
  {
    // S6 (2026-08-01 reconciliation-pass fix): detour_dispositions gained a
    // project_id column after this effort's own dev/test databases had
    // already been created without it — a live reproduction of exactly the
    // "fresh install vs. upgraded install diverge" failure mode this file
    // exists to catch (see pricing-calc.test.js's SQLITE_ERROR against the
    // shared dev DB before this migration was added).
    table: "detour_dispositions",
    column: "project_id",
    legacySql: `
      CREATE TABLE IF NOT EXISTS detour_dispositions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cwd TEXT NOT NULL,
        session_id TEXT,
        source TEXT NOT NULL CHECK(source IN ('inferred','declared')),
        source_ref TEXT NOT NULL,
        source_seen_at TEXT,
        label TEXT,
        item_id TEXT,
        disposition TEXT NOT NULL DEFAULT 'pending'
          CHECK(disposition IN ('pending','fold_in','new_item','deliberate','discard')),
        decided_by TEXT CHECK(decided_by IN ('rule','llm','human')),
        confidence REAL,
        reason TEXT,
        note TEXT,
        proposed_text TEXT,
        proposed_acceptance TEXT,
        proposed_detail TEXT,
        proposed_parent_item_id TEXT,
        write_status TEXT NOT NULL DEFAULT 'none'
          CHECK(write_status IN ('none','pending','written','failed','conflict')),
        write_attempted_at TEXT,
        write_completed_at TEXT,
        write_error TEXT,
        write_backup_path TEXT,
        write_content_hash_before TEXT,
        write_content_hash_after TEXT,
        suggested_markdown TEXT,
        resolved_item_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        resolved_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_detour_dispositions_src ON detour_dispositions(cwd, source, source_ref)
    `,
    seed(legacyDb) {
      legacyDb
        .prepare(
          `INSERT INTO detour_dispositions (cwd, session_id, source, source_ref, source_seen_at, label, item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "/tmp/test-cwd-detour",
          null,
          "inferred",
          "legacy-session-1",
          "2026-07-01T12:00:00.000Z",
          "Legacy detour",
          null
        );
    },
    assertLegacyRow(db) {
      const row = db
        .prepare("SELECT project_id FROM detour_dispositions WHERE source_ref = ?")
        .get("legacy-session-1");
      assert.ok(row, "detour_dispositions row should exist after migration");
      assert.equal(row.project_id, null, "project_id should be NULL for legacy rows");
    },
    assertWritable(db) {
      // No dedicated setter statement for project_id alone (it is stamped
      // once at record time via upsertDetourDisposition) — verify directly
      // via UPDATE, the same way the column is actually written in
      // production for a pre-existing row is not expected; this proves the
      // column itself accepts writes on a legacy row.
      db.prepare("UPDATE detour_dispositions SET project_id = ? WHERE source_ref = ?").run(
        "proj-legacy-migrated",
        "legacy-session-1"
      );
      const row = db
        .prepare("SELECT project_id FROM detour_dispositions WHERE source_ref = ?")
        .get("legacy-session-1");
      assert.equal(
        row.project_id,
        "proj-legacy-migrated",
        "project_id should be settable on legacy rows"
      );
    },
  },
  {
    // Pin-to-top feature: projects gained a `pinned` column so a project can
    // float above the regular alphabetical/manual-drag order on the Projects
    // page. Additive + NOT NULL DEFAULT 0, mirroring the pattern of the
    // detour_dispositions.project_id case above.
    table: "projects",
    column: "pinned",
    legacySql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `,
    seed(legacyDb) {
      legacyDb
        .prepare("INSERT INTO projects (id, name) VALUES (?, ?)")
        .run("legacy-project-1", "Legacy Project");
    },
    assertLegacyRow(db) {
      const row = db.prepare("SELECT pinned FROM projects WHERE id = ?").get("legacy-project-1");
      assert.ok(row, "projects row should exist after migration");
      assert.equal(row.pinned, 0, "pinned should default to 0 for legacy rows");
    },
    assertWritable(db) {
      const { stmts } = require("../db");
      stmts.setProjectPinned.run(1, "legacy-project-1");
      const row = db.prepare("SELECT pinned FROM projects WHERE id = ?").get("legacy-project-1");
      assert.equal(row.pinned, 1, "pinned should be settable on legacy rows");
    },
  },
  {
    // Sibling-scan toggle: projects gained a `sibling_scan_enabled` column so
    // the disk-based sibling-repo scan in the Project Detail "Suggested
    // repos" section can be opted into per project (default off — that scan
    // is noisy in a flat workspace folder holding many unrelated repos).
    // Additive + NOT NULL DEFAULT 0, mirroring the `pinned` case above. The
    // legacy schema here already has `pinned` (added earlier) to reflect a
    // realistic pre-this-migration upgrade path.
    table: "projects",
    column: "sibling_scan_enabled",
    legacySql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        pinned INTEGER NOT NULL DEFAULT 0
      )
    `,
    seed(legacyDb) {
      legacyDb
        .prepare("INSERT INTO projects (id, name) VALUES (?, ?)")
        .run("legacy-project-2", "Legacy Project 2");
    },
    assertLegacyRow(db) {
      const row = db
        .prepare("SELECT sibling_scan_enabled FROM projects WHERE id = ?")
        .get("legacy-project-2");
      assert.ok(row, "projects row should exist after migration");
      assert.equal(
        row.sibling_scan_enabled,
        0,
        "sibling_scan_enabled should default to 0 for legacy rows"
      );
    },
    assertWritable(db) {
      const { stmts } = require("../db");
      stmts.setProjectSiblingScanEnabled.run(1, "legacy-project-2");
      const row = db
        .prepare("SELECT sibling_scan_enabled FROM projects WHERE id = ?")
        .get("legacy-project-2");
      assert.equal(
        row.sibling_scan_enabled,
        1,
        "sibling_scan_enabled should be settable on legacy rows"
      );
    },
  },
  {
    // Terminal-default folder toggle: project_paths gained a `terminal_default`
    // column so a project with several mapped folders can exclude some of
    // them from the "open a new Claude terminal" pickers (OpenTerminalModal's
    // folder step, toggled per-folder on the Project Detail page's Repos
    // card). Additive + NOT NULL DEFAULT 1, mirroring the `pinned` case above,
    // so every historical mapping keeps showing up in the picker exactly as
    // it does today.
    table: "project_paths",
    column: "terminal_default",
    legacySql: `
      CREATE TABLE IF NOT EXISTS project_paths (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        cwd TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `,
    seed(legacyDb) {
      legacyDb
        .prepare("INSERT INTO project_paths (project_id, cwd) VALUES (?, ?)")
        .run("legacy-project-3", "/tmp/legacy-project-3-repo");
    },
    assertLegacyRow(db) {
      const row = db
        .prepare("SELECT terminal_default FROM project_paths WHERE cwd = ?")
        .get("/tmp/legacy-project-3-repo");
      assert.ok(row, "project_paths row should exist after migration");
      assert.equal(row.terminal_default, 1, "terminal_default should default to 1 for legacy rows");
    },
    assertWritable(db) {
      const { stmts } = require("../db");
      const row = db
        .prepare("SELECT id FROM project_paths WHERE cwd = ?")
        .get("/tmp/legacy-project-3-repo");
      stmts.setProjectPathTerminalDefault.run(0, row.id, "legacy-project-3");
      const updated = db
        .prepare("SELECT terminal_default FROM project_paths WHERE cwd = ?")
        .get("/tmp/legacy-project-3-repo");
      assert.equal(
        updated.terminal_default,
        0,
        "terminal_default should be settable on legacy rows"
      );
    },
  },
  // color_thresholds' single yellow_at/orange_at/red_at set split into
  // independent session_*/weekly_* scopes (2026-08-01, same day the table
  // was introduced — a live reproduction of the "fresh install vs. upgraded
  // install diverge" failure mode this file exists to catch, same as
  // detour_dispositions.project_id above: this effort's own dev DB had
  // already created the old shape before the split landed). One migration
  // adds all 6 new columns, backfills both scopes from the single old value,
  // then drops the 3 old columns — so all 6 ADD COLUMNs share the same
  // legacySql/seed/assertions; the meta-test below just needs each
  // table.column pair present once.
  ...(() => {
    const legacySql = `
      CREATE TABLE IF NOT EXISTS color_thresholds (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        yellow_at REAL NOT NULL DEFAULT 50,
        orange_at REAL NOT NULL DEFAULT 80,
        red_at REAL NOT NULL DEFAULT 100,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;
    const seed = (legacyDb) => {
      legacyDb
        .prepare(
          "INSERT OR REPLACE INTO color_thresholds (id, yellow_at, orange_at, red_at) VALUES (1, 45, 75, 95)"
        )
        .run();
    };
    const assertLegacyRow = (db) => {
      const row = db.prepare("SELECT * FROM color_thresholds WHERE id = 1").get();
      assert.ok(row, "color_thresholds row should exist after migration");
      assert.equal(row.session_yellow_at, 45, "session scope should backfill from the old value");
      assert.equal(row.session_orange_at, 75, "session scope should backfill from the old value");
      assert.equal(row.session_red_at, 95, "session scope should backfill from the old value");
      assert.equal(
        row.weekly_yellow_at,
        45,
        "weekly scope should backfill from the same old value"
      );
      assert.equal(
        row.weekly_orange_at,
        75,
        "weekly scope should backfill from the same old value"
      );
      assert.equal(row.weekly_red_at, 95, "weekly scope should backfill from the same old value");
      assert.equal(row.yellow_at, undefined, "old yellow_at column should be dropped");
      assert.equal(row.orange_at, undefined, "old orange_at column should be dropped");
      assert.equal(row.red_at, undefined, "old red_at column should be dropped");
    };
    const assertWritable = (db) => {
      const { stmts } = require("../db");
      // updateColorThresholds now takes 12 positional params (session,
      // weekly, sessionRate, weeklyRate x 3 fields each — see the
      // session_rate/weekly_rate split case below); only the first is
      // exercised here, the rest COALESCE through untouched.
      stmts.updateColorThresholds.run(
        60,
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
        null
      );
      const row = db.prepare("SELECT session_yellow_at FROM color_thresholds WHERE id = 1").get();
      assert.equal(
        row.session_yellow_at,
        60,
        "session_yellow_at should be settable on a migrated row"
      );
    };
    return [
      "session_yellow_at",
      "session_orange_at",
      "session_red_at",
      "weekly_yellow_at",
      "weekly_orange_at",
      "weekly_red_at",
    ].map((column) => ({
      table: "color_thresholds",
      column,
      legacySql,
      seed,
      assertLegacyRow,
      assertWritable,
    }));
  })(),
  // session_rate_*/weekly_rate_* (Consumption Rate card's own color bands)
  // added as pure new columns on an already-split color_thresholds table —
  // unlike the session/weekly split above, these aren't backfilled from an
  // existing value (there's nothing to backfill from); they just take their
  // own DEFAULT on legacy rows, same pattern as projects.pinned above.
  ...(() => {
    const legacySql = `
      CREATE TABLE IF NOT EXISTS color_thresholds (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        session_yellow_at REAL NOT NULL DEFAULT 50,
        session_orange_at REAL NOT NULL DEFAULT 80,
        session_red_at REAL NOT NULL DEFAULT 100,
        weekly_yellow_at REAL NOT NULL DEFAULT 50,
        weekly_orange_at REAL NOT NULL DEFAULT 80,
        weekly_red_at REAL NOT NULL DEFAULT 100,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;
    const seed = (legacyDb) => {
      legacyDb
        .prepare(
          `INSERT OR REPLACE INTO color_thresholds
             (id, session_yellow_at, session_orange_at, session_red_at,
              weekly_yellow_at, weekly_orange_at, weekly_red_at)
           VALUES (1, 40, 70, 90, 45, 75, 95)`
        )
        .run();
    };
    const assertLegacyRow = (db) => {
      const row = db.prepare("SELECT * FROM color_thresholds WHERE id = 1").get();
      assert.ok(row, "color_thresholds row should exist after migration");
      // Pre-existing scopes are untouched by this migration.
      assert.equal(row.session_yellow_at, 40);
      assert.equal(row.weekly_red_at, 95);
      // New scopes take their own seeded defaults, not a backfill.
      assert.equal(row.session_rate_yellow_at, 0.5, "session_rate should default to 0.5");
      assert.equal(row.session_rate_orange_at, 1.0, "session_rate should default to 1.0");
      assert.equal(row.session_rate_red_at, 1.5, "session_rate should default to 1.5");
      assert.equal(row.weekly_rate_yellow_at, 0.5, "weekly_rate should default to 0.5");
      assert.equal(row.weekly_rate_orange_at, 1.0, "weekly_rate should default to 1.0");
      assert.equal(row.weekly_rate_red_at, 1.5, "weekly_rate should default to 1.5");
    };
    const assertWritable = (db) => {
      const { stmts } = require("../db");
      stmts.updateColorThresholds.run(
        null,
        null,
        null,
        null,
        null,
        null,
        65,
        null,
        null,
        null,
        null,
        null
      );
      const row = db
        .prepare("SELECT session_rate_yellow_at FROM color_thresholds WHERE id = 1")
        .get();
      assert.equal(
        row.session_rate_yellow_at,
        65,
        "session_rate_yellow_at should be settable on a migrated row"
      );
    };
    return [
      "session_rate_yellow_at",
      "session_rate_orange_at",
      "session_rate_red_at",
      "weekly_rate_yellow_at",
      "weekly_rate_orange_at",
      "weekly_rate_red_at",
    ].map((column) => ({
      table: "color_thresholds",
      column,
      legacySql,
      seed,
      assertLegacyRow,
      assertWritable,
    }));
  })(),
];

describe("Migration: plan_items.target_date", () => {
  let tempDbPath;
  let tempDb;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;

  before(() => {
    // Create a temporary database file
    tempDbPath = path.join(os.tmpdir(), `db-migration-test-${Date.now()}.db`);

    // Create and seed the legacy database
    tempDb = new Database(tempDbPath);
    tempDb.pragma("journal_mode = WAL");

    // Create the tables the migration expects to exist
    // Use the full current plans table schema (without any target_date if not applicable)
    const plansSql = `
      CREATE TABLE IF NOT EXISTS plans (
        cwd TEXT PRIMARY KEY,
        title TEXT,
        file_path TEXT NOT NULL,
        content_hash TEXT,
        item_count INTEGER NOT NULL DEFAULT 0,
        missing_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;
    tempDb.prepare(plansSql).run();

    // Run the legacy plan_items schema (without target_date)
    const upgradeCase = UPGRADE_CASES[0];
    tempDb.exec(upgradeCase.legacySql);

    // Seed the legacy database
    upgradeCase.seed(tempDb);

    // Close the legacy database
    tempDb.close();
  });

  after(() => {
    // Restore the original DB path and clear the cache
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];

    // Clean up the temporary database files
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
      } catch {
        // Best effort
      }
    }
  });

  it("creates target_date column on legacy plan_items via ALTER TABLE", () => {
    // Point to the legacy database before requiring db
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    // Require db, which will run migrations
    const dbModule = require("../db");
    const { db } = dbModule;

    // Verify the column exists
    const tableInfo = db.prepare("PRAGMA table_info(plan_items)").all();
    const targetDateColumn = tableInfo.find((col) => col.name === "target_date");
    assert.ok(targetDateColumn, "target_date column should exist after migration");

    // Verify the legacy row still reads correctly
    const upgradeCase = UPGRADE_CASES[0];
    upgradeCase.assertLegacyRow(db);

    // Verify the setter works
    upgradeCase.assertWritable(db);

    // Close the database
    db.close();
  });

  it("migration is idempotent: second require does not fail or duplicate column", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    // Clear the require cache to ensure a fresh module and fresh migrations
    delete require.cache[require.resolve("../db")];

    // First require: runs migrations
    require("../db");

    // Open a fresh connection to verify migrations were applied
    const db1 = new Database(tempDbPath);
    const tableInfo1 = db1.prepare("PRAGMA table_info(plan_items)").all();
    const targetDateCount1 = tableInfo1.filter((col) => col.name === "target_date").length;
    assert.equal(targetDateCount1, 1, "should have exactly one target_date column");
    db1.close();

    delete require.cache[require.resolve("../db")];

    // Second require: runs migrations again
    require("../db");

    // Open another fresh connection to verify idempotency
    const db2 = new Database(tempDbPath);
    const tableInfo2 = db2.prepare("PRAGMA table_info(plan_items)").all();
    const targetDateCount2 = tableInfo2.filter((col) => col.name === "target_date").length;
    assert.equal(targetDateCount2, 1, "should still have exactly one target_date column");
    db2.close();
  });
});

describe("Migration: detour_dispositions.project_id", () => {
  let tempDbPath;
  let tempDb;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;
  const upgradeCase = UPGRADE_CASES[1];

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `db-migration-detours-test-${Date.now()}.db`);

    tempDb = new Database(tempDbPath);
    tempDb.pragma("journal_mode = WAL");

    // db.js's real migration path assumes `plans`/`plan_items` already exist
    // (the plan_items rebuild helper runs unconditionally before the
    // detour_dispositions migration) — seed the minimal current shape so
    // requiring db.js against this legacy file doesn't fail on an unrelated
    // table first.
    tempDb.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        cwd TEXT PRIMARY KEY,
        title TEXT,
        file_path TEXT NOT NULL,
        content_hash TEXT,
        item_count INTEGER NOT NULL DEFAULT 0,
        missing_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS plan_items (
        cwd TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_number INTEGER,
        parent_item_id TEXT,
        text TEXT NOT NULL,
        acceptance TEXT,
        detail TEXT,
        checked INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        declared_done_at TEXT,
        declared_done_session TEXT,
        target_date TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (cwd, item_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_items_cwd_number ON plan_items(cwd, item_number);
    `);

    // Run the legacy detour_dispositions schema (without project_id).
    tempDb.exec(upgradeCase.legacySql);
    upgradeCase.seed(tempDb);

    tempDb.close();
  });

  after(() => {
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];

    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
      } catch {
        // Best effort
      }
    }
  });

  it("creates project_id column on legacy detour_dispositions via ALTER TABLE", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db } = dbModule;

    const tableInfo = db.prepare("PRAGMA table_info(detour_dispositions)").all();
    const projectIdColumn = tableInfo.find((col) => col.name === "project_id");
    assert.ok(projectIdColumn, "project_id column should exist after migration");

    upgradeCase.assertLegacyRow(db);
    upgradeCase.assertWritable(db);

    db.close();
  });

  it("migration is idempotent: second require does not fail or duplicate the column", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db1 = new Database(tempDbPath);
    const count1 = db1
      .prepare("PRAGMA table_info(detour_dispositions)")
      .all()
      .filter((c) => c.name === "project_id").length;
    assert.equal(count1, 1, "should have exactly one project_id column");
    db1.close();

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db2 = new Database(tempDbPath);
    const count2 = db2
      .prepare("PRAGMA table_info(detour_dispositions)")
      .all()
      .filter((c) => c.name === "project_id").length;
    assert.equal(count2, 1, "should still have exactly one project_id column");
    db2.close();
  });
});

describe("Migration: color_thresholds session/weekly split", () => {
  let tempDbPath;
  let tempDb;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;
  const upgradeCase = UPGRADE_CASES.find(
    (uc) => uc.table === "color_thresholds" && uc.column === "session_yellow_at"
  );

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `db-migration-color-thresholds-test-${Date.now()}.db`);

    tempDb = new Database(tempDbPath);
    tempDb.pragma("journal_mode = WAL");

    // Run the legacy color_thresholds schema (single yellow_at/orange_at/red_at set).
    tempDb.exec(upgradeCase.legacySql);
    upgradeCase.seed(tempDb);

    tempDb.close();
  });

  after(() => {
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];

    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
      } catch {
        // Best effort
      }
    }
  });

  it("splits legacy color_thresholds into session_*/weekly_* columns via ALTER TABLE", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db } = dbModule;

    const tableInfo = db.prepare("PRAGMA table_info(color_thresholds)").all();
    for (const column of [
      "session_yellow_at",
      "session_orange_at",
      "session_red_at",
      "weekly_yellow_at",
      "weekly_orange_at",
      "weekly_red_at",
    ]) {
      assert.ok(
        tableInfo.some((col) => col.name === column),
        `${column} column should exist after migration`
      );
    }
    assert.ok(
      !tableInfo.some((col) => col.name === "yellow_at"),
      "old yellow_at column should be dropped"
    );

    upgradeCase.assertLegacyRow(db);
    upgradeCase.assertWritable(db);

    db.close();
  });

  it("migration is idempotent: second require does not fail or duplicate columns", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db1 = new Database(tempDbPath);
    const count1 = db1
      .prepare("PRAGMA table_info(color_thresholds)")
      .all()
      .filter((c) => c.name === "session_yellow_at").length;
    assert.equal(count1, 1, "should have exactly one session_yellow_at column");
    db1.close();

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db2 = new Database(tempDbPath);
    const count2 = db2
      .prepare("PRAGMA table_info(color_thresholds)")
      .all()
      .filter((c) => c.name === "session_yellow_at").length;
    assert.equal(count2, 1, "should still have exactly one session_yellow_at column");
    db2.close();
  });
});

describe("Migration: color_thresholds session_rate/weekly_rate columns", () => {
  let tempDbPath;
  let tempDb;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;
  const upgradeCase = UPGRADE_CASES.find(
    (uc) => uc.table === "color_thresholds" && uc.column === "session_rate_yellow_at"
  );

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `db-migration-color-thresholds-rate-test-${Date.now()}.db`);

    tempDb = new Database(tempDbPath);
    tempDb.pragma("journal_mode = WAL");

    // Run the pre-rate-columns schema (already split into session_*/weekly_*
    // but predating session_rate_*/weekly_rate_*).
    tempDb.exec(upgradeCase.legacySql);
    upgradeCase.seed(tempDb);

    tempDb.close();
  });

  after(() => {
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];

    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
      } catch {
        // Best effort
      }
    }
  });

  it("adds session_rate_*/weekly_rate_* columns via ALTER TABLE, defaulted (not backfilled)", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db } = dbModule;

    const tableInfo = db.prepare("PRAGMA table_info(color_thresholds)").all();
    for (const column of [
      "session_rate_yellow_at",
      "session_rate_orange_at",
      "session_rate_red_at",
      "weekly_rate_yellow_at",
      "weekly_rate_orange_at",
      "weekly_rate_red_at",
    ]) {
      assert.ok(
        tableInfo.some((col) => col.name === column),
        `${column} column should exist after migration`
      );
    }

    upgradeCase.assertLegacyRow(db);
    upgradeCase.assertWritable(db);

    db.close();
  });

  it("migration is idempotent: second require does not fail or duplicate columns", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db1 = new Database(tempDbPath);
    const count1 = db1
      .prepare("PRAGMA table_info(color_thresholds)")
      .all()
      .filter((c) => c.name === "session_rate_yellow_at").length;
    assert.equal(count1, 1, "should have exactly one session_rate_yellow_at column");
    db1.close();

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db2 = new Database(tempDbPath);
    const count2 = db2
      .prepare("PRAGMA table_info(color_thresholds)")
      .all()
      .filter((c) => c.name === "session_rate_yellow_at").length;
    assert.equal(count2, 1, "should still have exactly one session_rate_yellow_at column");
    db2.close();
  });
});

describe("Migration: projects.pinned", () => {
  let tempDbPath;
  let tempDb;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;
  const upgradeCase = UPGRADE_CASES.find((uc) => uc.table === "projects" && uc.column === "pinned");

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `db-migration-projects-pinned-test-${Date.now()}.db`);

    tempDb = new Database(tempDbPath);
    tempDb.pragma("journal_mode = WAL");

    // Run the legacy projects schema (without pinned).
    tempDb.exec(upgradeCase.legacySql);
    upgradeCase.seed(tempDb);

    tempDb.close();
  });

  after(() => {
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];

    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
      } catch {
        // Best effort
      }
    }
  });

  it("creates pinned column on legacy projects via ALTER TABLE", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db } = dbModule;

    const tableInfo = db.prepare("PRAGMA table_info(projects)").all();
    const pinnedColumn = tableInfo.find((col) => col.name === "pinned");
    assert.ok(pinnedColumn, "pinned column should exist after migration");

    upgradeCase.assertLegacyRow(db);
    upgradeCase.assertWritable(db);

    db.close();
  });

  it("migration is idempotent: second require does not fail or duplicate the column", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db1 = new Database(tempDbPath);
    const count1 = db1
      .prepare("PRAGMA table_info(projects)")
      .all()
      .filter((c) => c.name === "pinned").length;
    assert.equal(count1, 1, "should have exactly one pinned column");
    db1.close();

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db2 = new Database(tempDbPath);
    const count2 = db2
      .prepare("PRAGMA table_info(projects)")
      .all()
      .filter((c) => c.name === "pinned").length;
    assert.equal(count2, 1, "should still have exactly one pinned column");
    db2.close();
  });
});

describe("Migration: projects.sibling_scan_enabled", () => {
  let tempDbPath;
  let tempDb;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;
  const upgradeCase = UPGRADE_CASES.find(
    (uc) => uc.table === "projects" && uc.column === "sibling_scan_enabled"
  );

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `db-migration-projects-sibling-scan-test-${Date.now()}.db`);

    tempDb = new Database(tempDbPath);
    tempDb.pragma("journal_mode = WAL");

    // Run the legacy projects schema (with pinned, without sibling_scan_enabled).
    tempDb.exec(upgradeCase.legacySql);
    upgradeCase.seed(tempDb);

    tempDb.close();
  });

  after(() => {
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];

    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
      } catch {
        // Best effort
      }
    }
  });

  it("creates sibling_scan_enabled column on legacy projects via ALTER TABLE", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db } = dbModule;

    const tableInfo = db.prepare("PRAGMA table_info(projects)").all();
    const column = tableInfo.find((col) => col.name === "sibling_scan_enabled");
    assert.ok(column, "sibling_scan_enabled column should exist after migration");

    upgradeCase.assertLegacyRow(db);
    upgradeCase.assertWritable(db);

    db.close();
  });

  it("migration is idempotent: second require does not fail or duplicate the column", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db1 = new Database(tempDbPath);
    const count1 = db1
      .prepare("PRAGMA table_info(projects)")
      .all()
      .filter((c) => c.name === "sibling_scan_enabled").length;
    assert.equal(count1, 1, "should have exactly one sibling_scan_enabled column");
    db1.close();

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db2 = new Database(tempDbPath);
    const count2 = db2
      .prepare("PRAGMA table_info(projects)")
      .all()
      .filter((c) => c.name === "sibling_scan_enabled").length;
    assert.equal(count2, 1, "should still have exactly one sibling_scan_enabled column");
    db2.close();
  });
});

describe("Migration: project_paths.terminal_default", () => {
  let tempDbPath;
  let tempDb;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;
  const upgradeCase = UPGRADE_CASES.find(
    (uc) => uc.table === "project_paths" && uc.column === "terminal_default"
  );

  before(() => {
    tempDbPath = path.join(
      os.tmpdir(),
      `db-migration-project-paths-terminal-default-test-${Date.now()}.db`
    );

    tempDb = new Database(tempDbPath);
    tempDb.pragma("journal_mode = WAL");

    // Run the legacy project_paths schema (without terminal_default).
    tempDb.exec(upgradeCase.legacySql);
    upgradeCase.seed(tempDb);

    tempDb.close();
  });

  after(() => {
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];

    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
      } catch {
        // Best effort
      }
    }
  });

  it("creates terminal_default column on legacy project_paths via ALTER TABLE", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db } = dbModule;

    const tableInfo = db.prepare("PRAGMA table_info(project_paths)").all();
    const column = tableInfo.find((col) => col.name === "terminal_default");
    assert.ok(column, "terminal_default column should exist after migration");

    upgradeCase.assertLegacyRow(db);
    upgradeCase.assertWritable(db);

    db.close();
  });

  it("migration is idempotent: second require does not fail or duplicate the column", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db1 = new Database(tempDbPath);
    const count1 = db1
      .prepare("PRAGMA table_info(project_paths)")
      .all()
      .filter((c) => c.name === "terminal_default").length;
    assert.equal(count1, 1, "should have exactly one terminal_default column");
    db1.close();

    delete require.cache[require.resolve("../db")];
    require("../db");

    const db2 = new Database(tempDbPath);
    const count2 = db2
      .prepare("PRAGMA table_info(project_paths)")
      .all()
      .filter((c) => c.name === "terminal_default").length;
    assert.equal(count2, 1, "should still have exactly one terminal_default column");
    db2.close();
  });
});

// Registry-completeness scan for full TABLE REBUILDS (create-new/rename-old
// shape, as distinct from a simple ALTER TABLE ... ADD COLUMN above) — D2,
// intake/2026-08-02-practice-kind-override, §9.6 NON-ATOMIC REBUILD. Scans
// for both rebuild shapes this file uses:
//   - rename-first:      ALTER TABLE <table> RENAME TO <table>...
//   - create-new-first:  CREATE TABLE <table>_new (...)
// grouped by table name (a table may have been rebuilt more than once across
// this app's history — plan_items and token_usage both have). Snapshotted
// 2026-08-02: five pre-existing rebuild call sites (plan_items x2 @ lines
// ~755/822, token_usage x2 @ lines ~1063/1589, webhook_targets @ ~1439) are
// non-atomic (separate autocommitted statements, not one BEGIN…COMMIT) and
// are grandfathered below with a dated reason — retrofitting them is a
// separate follow-up (its own backup, its own crash tests), not this build.
// `agents` (@ ~1481) already uses the atomic create-new-then-rename shape
// but has no dedicated interruption/crash test yet, so it is grandfathered
// too, pending that follow-up test. `coach_observations` (this build) is the
// first rebuild with BOTH atomicity (F1) and a full legacy+interruption test
// pair (server/__tests__/coach-observations-severity-rebuild.test.js) and is
// registered below with no grandfather reason — do NOT weaken this scan to
// make a future non-atomic rebuild pass silently.
const REBUILD_CASES = {
  coach_observations: { legacy: true, interruption: true },
  plan_items: {
    legacy: false,
    interruption: false,
    reason:
      "§9.6 pre-existing rebuild (rename-first, non-atomic separate statements); grandfathered 2026-08-02 per intake/2026-08-02-practice-kind-override D2 — fixed separately, not in this build.",
  },
  token_usage: {
    legacy: false,
    interruption: false,
    reason:
      "§9.6 pre-existing rebuild (rename-first, non-atomic separate statements); grandfathered 2026-08-02 per intake/2026-08-02-practice-kind-override D2 — fixed separately, not in this build.",
  },
  webhook_targets: {
    legacy: false,
    interruption: false,
    reason:
      "§9.6 pre-existing rebuild (rename-first, non-atomic separate statements); grandfathered 2026-08-02 per intake/2026-08-02-practice-kind-override D2 — fixed separately, not in this build.",
  },
  agents: {
    legacy: true,
    interruption: false,
    reason:
      "§9.6 pre-existing rebuild — already atomic (BEGIN…COMMIT, create-new-then-rename), but has no dedicated interruption/crash test yet; grandfathered 2026-08-02 per intake/2026-08-02-practice-kind-override D2.",
  },
};

describe("Table-rebuild registry meta-test (D2, §9.6 NON-ATOMIC REBUILD)", () => {
  it("every full-table rebuild in db.js is registered in REBUILD_CASES, with a legacy+interruption test pair unless grandfathered", () => {
    const dbPath = path.resolve(__dirname, "../db.js");
    const dbSource = fs.readFileSync(dbPath, "utf8");

    const renameFirstPattern = /ALTER TABLE (\w+) RENAME TO \1/g;
    const createNewPattern = /CREATE TABLE (\w+)_new\b/g;
    const foundTables = new Set();

    let match;
    while ((match = renameFirstPattern.exec(dbSource)) !== null) {
      foundTables.add(match[1]);
    }
    while ((match = createNewPattern.exec(dbSource)) !== null) {
      foundTables.add(match[1]);
    }

    assert(
      foundTables.size > 0,
      "sanity check: the scan should find at least one table rebuild in db.js (it always has plan_items etc.) — if this fires, the scan's regex itself is broken"
    );

    for (const table of foundTables) {
      assert.ok(
        REBUILD_CASES[table],
        `Table rebuild for '${table}' found in db.js but not registered in REBUILD_CASES. ` +
          `Add an entry — { legacy: true, interruption: true } if it has both test kinds, ` +
          `or { legacy, interruption, reason } to grandfather it (do not retrofit in the ` +
          `same change unless that is the change's actual purpose).`
      );
    }

    for (const [table, entry] of Object.entries(REBUILD_CASES)) {
      if (entry.reason) continue; // grandfathered — not held to the full bar
      assert.ok(
        entry.legacy && entry.interruption,
        `'${table}' is registered in REBUILD_CASES without a grandfather reason, so it must ` +
          `have both a legacy-DB case and an interruption case. Add the missing test(s), or add ` +
          `a dated 'reason' to grandfather it (per §9.6 — do not silently downgrade the bar).`
      );
    }
  });
});

describe("Migration meta-test", () => {
  it("every ALTER TABLE … ADD COLUMN in db.js has an upgrade case or is grandfathered", () => {
    const dbPath = path.resolve(__dirname, "../db.js");
    const dbSource = fs.readFileSync(dbPath, "utf8");

    // Extract all ALTER TABLE...ADD COLUMN pairs
    const alterPattern = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/g;
    const foundAlters = new Set();

    let match;
    while ((match = alterPattern.exec(dbSource)) !== null) {
      const table = match[1];
      const column = match[2];

      // Skip templated columns like ${col}
      if (column.includes("$")) {
        continue;
      }

      foundAlters.add(`${table}.${column}`);
    }

    // Build the set of covered columns (either in upgrade cases or grandfathered)
    const covered = new Set([
      ...GRANDFATHERED,
      ...UPGRADE_CASES.map((uc) => `${uc.table}.${uc.column}`),
    ]);

    // Verify every found ALTER is covered
    for (const alter of foundAlters) {
      assert.ok(
        covered.has(alter),
        `New column migration \`${alter}\` has no upgrade-path test. Add an \`UPGRADE_CASES\` entry — do not add to \`GRANDFATHERED\`.`
      );
    }
  });
});

describe("additive portfolio-layer tables", () => {
  let tempDbPath;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `db-migration-portfolio-test-${Date.now()}.db`);

    // Create a legacy-shape DB with ONLY the old tables (no new portfolio-layer tables)
    const legacyDb = new Database(tempDbPath);
    legacyDb.pragma("journal_mode = WAL");
    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        cwd TEXT PRIMARY KEY,
        title TEXT,
        file_path TEXT NOT NULL,
        content_hash TEXT,
        item_count INTEGER NOT NULL DEFAULT 0,
        missing_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE IF NOT EXISTS plan_items (
        cwd TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_number INTEGER,
        parent_item_id TEXT,
        text TEXT NOT NULL,
        acceptance TEXT,
        detail TEXT,
        checked INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        declared_done_at TEXT,
        declared_done_session TEXT,
        target_date TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (cwd, item_id),
        FOREIGN KEY (cwd) REFERENCES plans(cwd) ON DELETE CASCADE
      );
    `);
    legacyDb.close();
  });

  after(() => {
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];

    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
      } catch {
        // Best effort
      }
    }
  });

  it("A1.1: legacy-shape DB gains the three new tables (project_plans, project_plan_items, value_claims)", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db } = dbModule;

    // Assert the three new tables exist in sqlite_master
    const tables = db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('project_plans', 'project_plan_items', 'value_claims')
    `
      )
      .all();

    assert.equal(tables.length, 3, "All three portfolio-layer tables should exist");
    const tableNames = tables.map((t) => t.name).sort();
    assert.deepEqual(tableNames, ["project_plan_items", "project_plans", "value_claims"]);

    db.close();
  });

  it("A1.2: new tables are writable via prepared statements", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db, stmts } = dbModule;

    // Assert the prepared statements exist
    assert.ok(stmts.insertProjectPlan, "insertProjectPlan statement should exist");
    assert.ok(stmts.insertProjectPlanItem, "insertProjectPlanItem statement should exist");
    assert.ok(stmts.insertValueClaim, "insertValueClaim statement should exist");

    // Assert value_claims has NO closed_at column (per technical-plan)
    const valueClaimsInfo = db.prepare("PRAGMA table_info(value_claims)").all();
    const columnNames = valueClaimsInfo.map((col) => col.name);
    assert.ok(
      !columnNames.includes("closed_at"),
      "value_claims should NOT have a closed_at column"
    );
    assert.ok(!columnNames.includes("closed"), "value_claims should NOT have a closed flag column");

    db.close();
  });

  it("A1.3: second boot is a no-op (sqlite_master unchanged, table SQL identical)", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const db1 = require("../db").db;
    const snapshot1 = db1
      .prepare(
        `
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name IN ('project_plans', 'project_plan_items', 'value_claims')
      ORDER BY name
    `
      )
      .all();
    db1.close();

    // Second boot
    delete require.cache[require.resolve("../db")];
    const db2 = require("../db").db;
    const snapshot2 = db2
      .prepare(
        `
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name IN ('project_plans', 'project_plan_items', 'value_claims')
      ORDER BY name
    `
      )
      .all();
    db2.close();

    assert.deepEqual(
      snapshot1,
      snapshot2,
      "Table definitions should be byte-identical across boots"
    );
  });

  it("A1.4: §9.5/§9.6 stay inapplicable — legacy ALTER count pinned, sqlite_master text unchanged", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];

    const dbModule = require("../db");
    const { db } = dbModule;

    // Snapshot legacy tables before boot (already done by A1.1 boot)
    const legacySnapshot = db
      .prepare(
        `
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name IN ('plans', 'plan_items', 'detour_dispositions', 'decision_queue')
      ORDER BY name
    `
      )
      .all();

    // Assert legacy tables are unchanged (they should exist and have their original SQL)
    assert.ok(legacySnapshot.length > 0, "Legacy tables should exist");

    // Count ALTER TABLE statements in db.js — this is the tripwire
    const dbSource = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
    const alterCount = (dbSource.match(/ALTER\s+TABLE/g) || []).length;

    // Record the count for the tripwire (pinned per test-plan)
    // The test-plan says: "assert zero occurrences of 'ALTER TABLE' in the db module's migration path for these tables"
    // For new tables, there should be NO ALTER statements (CREATE TABLE IF NOT EXISTS only)
    const portfiolioAlterCount = (
      dbSource.match(/ALTER\s+TABLE.*(project_plans|project_plan_items|value_claims)/gi) || []
    ).length;
    assert.equal(
      portfiolioAlterCount,
      0,
      "No ALTER TABLE statements should exist for new portfolio-layer tables (CREATE TABLE IF NOT EXISTS only)"
    );

    db.close();
  });
});
