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
      stmts.updateColorThresholds.run(60, null, null, null, null, null);
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
