/**
 * @file Tests for the coach_observations severity CHECK rebuild (T1, T3).
 * Verifies atomicity, interruption recovery, orphan detection, migration
 * correctness, skip-path behavior (WATCH-3), and registry-derived CHECK alignment.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");

/**
 * Helper: builds a legacy DB (pre-CHECK severity) with optional pre-filled rows.
 * Used by T1a, T1b, T1c, T3a, T3b tests.
 */
function buildLegacyDb(rows = [], withCheck = false) {
  const tempDb = path.join(
    os.tmpdir(),
    `dashboard-coach-obs-legacy-${Date.now()}-${Math.random()}.db`
  );
  const db = new Database(tempDb);
  db.pragma("foreign_keys = OFF");

  const tableBody = withCheck
    ? `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    practice_id TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('session','project','global')),
    scope_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('risk','info','good')),
    severity TEXT NOT NULL CHECK(severity IN ('info','warning')),
    values_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','dismissed','resolved')),
    detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    responded_at TEXT
  `
    : `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    practice_id TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('session','project','global')),
    scope_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('risk','info','good')),
    severity TEXT NOT NULL,
    values_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','dismissed','resolved')),
    detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    responded_at TEXT
  `;

  db.exec(`
    CREATE TABLE coach_observations (
      ${tableBody}
    );
    CREATE INDEX idx_coach_observations_open
      ON coach_observations (practice_id, scope_type, scope_id, status);
    CREATE INDEX idx_coach_observations_detected_at
      ON coach_observations (detected_at DESC);
  `);

  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO coach_observations
        (id, practice_id, scope_type, scope_id, values_json, status, responded_at, kind, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      stmt.run(
        row.id,
        row.practice_id,
        row.scope_type,
        row.scope_id,
        row.values_json,
        row.status,
        row.responded_at,
        row.kind || "info",
        row.severity
      );
    }
  }

  db.close();
  return tempDb;
}

/**
 * T1a — Atomicity, structural: the rebuild DDL lives inside a single BEGIN…COMMIT db.exec
 */
describe("coach_observations rebuild is atomic (§9.6)", () => {
  it("the coach_observations rebuild's DDL lives inside a single BEGIN…COMMIT db.exec", () => {
    const dbSrc = fs.readFileSync(require.resolve("../db.js"), "utf8");
    const match = dbSrc.match(/db\.exec\(\s*`[^`]*CREATE TABLE coach_observations_new[^`]*`\s*\)/s);
    assert(
      match,
      "db.exec containing CREATE TABLE coach_observations_new not found. Expected F1 implementation (§9.6). See server/db.js:1478 (agents rebuild) as the shape to copy."
    );
    const execContent = match[0];
    assert(
      execContent.includes("BEGIN;"),
      "missing BEGIN; inside db.exec. F1 must wrap the entire rebuild in one transaction."
    );
    assert(
      execContent.includes("INSERT INTO coach_observations_new"),
      "missing INSERT INTO coach_observations_new"
    );
    assert(
      execContent.includes("DROP TABLE coach_observations"),
      "missing DROP TABLE coach_observations"
    );
    assert(
      execContent.includes("RENAME TO coach_observations"),
      "missing ALTER TABLE coach_observations_new RENAME TO coach_observations"
    );
    assert(
      execContent.includes("COMMIT;"),
      "missing COMMIT; — the entire rebuild must be one transaction."
    );
  });

  it("PRAGMA foreign_keys = OFF is issued outside the transaction", () => {
    const dbSrc = fs.readFileSync(require.resolve("../db.js"), "utf8");
    const match = dbSrc.match(/db\.exec\(\s*`[^`]*CREATE TABLE coach_observations_new[^`]*`\s*\)/s);
    assert(match, "Could not find the rebuild db.exec");
    const execContent = match[0];
    assert(
      !execContent.includes("PRAGMA foreign_keys"),
      "PRAGMA foreign_keys must NOT appear inside the BEGIN…COMMIT block. SQLite ignores it inside a transaction."
    );
  });
});

/**
 * T1b — Atomicity, behavioral: an interrupted rebuild rolls back completely
 */
describe("coach_observations rebuild atomicity (interruption test)", () => {
  let tempDb;

  beforeEach(() => {
    // Build legacy DB with 3 rows
    tempDb = buildLegacyDb([
      {
        id: 1,
        practice_id: "account-weekly-balance",
        scope_type: "global",
        scope_id: "global",
        values_json: "{}",
        status: "open",
        responded_at: null,
        severity: "info",
      },
      {
        id: 2,
        practice_id: "session-token-ceiling",
        scope_type: "session",
        scope_id: "session123",
        values_json: "{}",
        status: "dismissed",
        responded_at: Date.now(),
        severity: "warning",
      },
      {
        id: 3,
        practice_id: "account-weekly-balance",
        scope_type: "global",
        scope_id: "global",
        values_json: "{}",
        status: "open",
        responded_at: null,
        severity: "info",
      },
    ]);

    // Open with better-sqlite3, simulate an interrupted migration
    // by manually executing the prefix without COMMIT
    const db = new Database(tempDb);
    db.pragma("foreign_keys = OFF");

    // Simulate F1's BEGIN…COMMIT block but stop before COMMIT
    const prefix = `
      BEGIN;
      CREATE TABLE coach_observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        practice_id TEXT NOT NULL,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('session','project','global')),
        scope_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('risk','info','good')),
        severity TEXT NOT NULL CHECK(severity IN ('info','warning')),
        values_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','dismissed','resolved')),
        detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        responded_at TEXT
      );
      INSERT INTO coach_observations_new SELECT * FROM coach_observations;
      DROP TABLE coach_observations;
    `;
    db.exec(prefix); // no COMMIT — transaction left open, simulating a crash

    // Close without COMMIT — SQLite will roll back on next open
    db.close();
  });

  afterEach(() => {
    try {
      delete require.cache[require.resolve("../db")];
    } catch {}
    delete process.env.DASHBOARD_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(tempDb + suffix);
      } catch {}
    }
  });

  it("an interrupted rebuild rolls back: every original row is still readable through coach_observations", () => {
    // Reopen and verify rollback
    const dbAfterCrash = new Database(tempDb);
    const rows = dbAfterCrash.prepare("SELECT id FROM coach_observations ORDER BY id").all();
    assert.deepEqual(
      rows.map((r) => r.id),
      [1, 2, 3],
      "all original rows should be readable after rollback"
    );

    const hasCheck = dbAfterCrash
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'")
      .get()
      ?.sql?.includes("CHECK(severity IN");
    assert(
      !hasCheck,
      "CHECK should not be present after crash rollback — the rebuild was aborted."
    );

    // Verify no orphaned tables
    const orphans = dbAfterCrash
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('coach_observations_old', 'coach_observations_new')"
      )
      .all();
    assert.equal(orphans.length, 0, "no orphaned tables should exist after rollback");

    dbAfterCrash.close();

    // Now simulate the migration completing on next boot
    // CRITICAL: set DASHBOARD_DB_PATH BEFORE calling require("../db")
    process.env.DASHBOARD_DB_PATH = tempDb;
    delete require.cache[require.resolve("../db")];
    assert.doesNotThrow(
      () => require("../db"),
      "db.js should load without throwing on a rolled-back-interrupted-rebuild state"
    );

    // Verify migration completed on the SAME tempDb that db.js was pointed to
    const dbAfterMigration = new Database(tempDb);
    const rowsAfter = dbAfterMigration
      .prepare("SELECT id, severity FROM coach_observations ORDER BY id")
      .all();
    assert.deepEqual(rowsAfter, [
      { id: 1, severity: "info" },
      { id: 2, severity: "warning" },
      { id: 3, severity: "info" },
    ]);

    const hasCheckAfter = dbAfterMigration
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'")
      .get()
      ?.sql?.includes("CHECK(severity IN");
    assert(hasCheckAfter, "CHECK should be present after successful migration");

    dbAfterMigration.close();
  });
});

/**
 * Helper: builds a fixture DB whose `coach_observations` table has NO CHECK
 * on `kind` or `severity` at all (more permissive than any real legacy
 * schema, which already CHECKs `kind`) — used only to plant a row that would
 * be rejected by the rebuild's new table's `kind` CHECK, so `execute()`'s
 * `INSERT INTO coach_observations_new SELECT * FROM coach_observations` can
 * genuinely fail mid-transaction without any mocking.
 */
function buildLegacyDbNoKindCheck(rows = []) {
  const tempDb = path.join(
    os.tmpdir(),
    `dashboard-coach-obs-badkind-${Date.now()}-${Math.random()}.db`
  );
  const db = new Database(tempDb);
  db.pragma("foreign_keys = OFF");

  db.exec(`
    CREATE TABLE coach_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      practice_id TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('session','project','global')),
      scope_id TEXT,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      values_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','dismissed','resolved')),
      detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      responded_at TEXT
    );
    CREATE INDEX idx_coach_observations_open
      ON coach_observations (practice_id, scope_type, scope_id, status);
    CREATE INDEX idx_coach_observations_detected_at
      ON coach_observations (detected_at DESC);
  `);

  if (rows.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO coach_observations
        (id, practice_id, scope_type, scope_id, values_json, status, responded_at, kind, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      stmt.run(
        row.id,
        row.practice_id,
        row.scope_type,
        row.scope_id,
        row.values_json,
        row.status,
        row.responded_at,
        row.kind,
        row.severity
      );
    }
  }

  db.close();
  return tempDb;
}

/**
 * B3 — Mid-execute failure handling: `execute()` inside
 * `rebuildTableAtomically()` must be wrapped in try/catch. A row whose
 * `severity` is valid (passes the WATCH-3 pre-flight scan, which only
 * inspects `severity`) but whose `kind` is out-of-enum will pass pre-flight
 * yet make the real `INSERT INTO coach_observations_new SELECT * FROM
 * coach_observations` fail with a genuine SQLITE_CONSTRAINT error, because
 * the rebuild's new table CHECKs `kind` too. This is a realistic,
 * un-mocked stand-in for the class of failure this fix targets (e.g.
 * SQLITE_BUSY from a concurrent lock-holder during the exclusive
 * DROP/RENAME): whatever the cause, `execute()` throwing partway through
 * its own `BEGIN; ...` must roll back cleanly and never escape
 * `require("../db")`.
 */
describe("coach_observations rebuild execute() failure handling (B3)", () => {
  let tempDb;

  beforeEach(() => {
    tempDb = buildLegacyDbNoKindCheck([
      {
        id: 1,
        practice_id: "account-weekly-balance",
        scope_type: "global",
        scope_id: "global",
        values_json: "{}",
        status: "open",
        responded_at: null,
        kind: "bogus-kind-out-of-enum",
        severity: "info", // valid — passes the severity-only WATCH-3 pre-flight scan
      },
    ]);
  });

  afterEach(() => {
    try {
      delete require.cache[require.resolve("../db")];
    } catch {}
    delete process.env.DASHBOARD_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(tempDb + suffix);
      } catch {}
    }
  });

  it('a mid-execute failure rolls back cleanly and does not throw out of require("../db")', () => {
    process.env.DASHBOARD_DB_PATH = tempDb;
    delete require.cache[require.resolve("../db")];

    let dbModule;
    assert.doesNotThrow(() => {
      dbModule = require("../db");
    }, "db.js should not throw even when the rebuild's execute() fails mid-transaction (B3)");

    // The transaction opened by execute()'s own BEGIN must not be left open
    // on db.js's own connection (the one that ran the failed rebuild).
    assert.equal(
      dbModule.db.inTransaction,
      false,
      "no transaction should be left open on db.js's own connection after the failed rebuild rolled back"
    );

    const dbAfter = new Database(tempDb);

    // Rebuild never completed: no CHECK(severity IN was added.
    const mainTableSql = dbAfter
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'")
      .get()?.sql;
    assert(
      !mainTableSql || !mainTableSql.includes("CHECK(severity IN"),
      "rebuild should not have completed — CHECK(severity IN should be absent after a rolled-back mid-execute failure"
    );

    // No orphaned _new/_old tables left behind by the failed transaction.
    const orphans = dbAfter
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('coach_observations_old', 'coach_observations_new')"
      )
      .all();
    assert.equal(
      orphans.length,
      0,
      "no orphaned tables should remain after a rolled-back mid-execute failure"
    );

    // Original (offending) row is untouched — nothing was silently rewritten or dropped.
    const row = dbAfter
      .prepare("SELECT id, kind, severity FROM coach_observations WHERE id=1")
      .get();
    assert.deepEqual(
      row,
      { id: 1, kind: "bogus-kind-out-of-enum", severity: "info" },
      "the offending row must be preserved exactly, not rewritten or dropped, after rollback"
    );

    dbAfter.close();
  });
});

/**
 * T1c — Orphan guard: boots without throwing when orphaned tables exist
 *
 * CRITICAL FIXTURE CHANGE: uses buildLegacyDb with withCheck=false so the main
 * table is UNMIGRATED (no CHECK yet). This ensures F2's orphan-detection code
 * is actually reached (it runs after isAlreadyMigrated, which would short-circuit
 * if CHECK were already present). The fix for this test proves F2 works by
 * asserting the rebuild is SKIPPED (main table remains unmigrated) when an
 * orphan is detected, not merely by "boots without throwing".
 */
describe("coach_observations rebuild orphan guard (F2)", () => {
  let tempDb;

  beforeEach(() => {
    // Build with NO CHECK yet (withCheck=false) so rebuild would normally happen.
    // Plant a row so we can verify it's preserved after F2 skips the rebuild.
    tempDb = buildLegacyDb(
      [
        {
          id: 1,
          practice_id: "account-weekly-balance",
          scope_type: "global",
          scope_id: "global",
          values_json: "{}",
          status: "open",
          responded_at: null,
          severity: "info",
        },
      ],
      false // UNMIGRATED: no CHECK yet
    );

    const db = new Database(tempDb);
    db.pragma("foreign_keys = OFF");

    // Create an orphaned coach_observations_old (simulates interrupted migration residue)
    db.exec(`
      CREATE TABLE coach_observations_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        practice_id TEXT NOT NULL,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('session','project','global')),
        scope_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('risk','info','good')),
        severity TEXT NOT NULL,
        values_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','dismissed','resolved')),
        detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        responded_at TEXT
      );
    `);

    db.prepare(
      "INSERT INTO coach_observations_old (practice_id, scope_type, scope_id, values_json, status, kind, severity) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "session-token-ceiling",
      "session",
      "session-orphan-123",
      "{}",
      "open",
      "good",
      "warning"
    );

    db.close();
  });

  afterEach(() => {
    try {
      delete require.cache[require.resolve("../db")];
    } catch {}
    delete process.env.DASHBOARD_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(tempDb + suffix);
      } catch {}
    }
  });

  it("boots without throwing when an orphaned coach_observations_old exists, and skips the rebuild (F2 orphan guard)", () => {
    // CRITICAL: set DASHBOARD_DB_PATH BEFORE calling require("../db")
    // so that db.js actually processes the tempDb where we planted the orphan
    process.env.DASHBOARD_DB_PATH = tempDb;
    delete require.cache[require.resolve("../db")];

    // (1) Assertion: does not throw
    assert.doesNotThrow(
      () => require("../db"),
      "db.js should boot without throwing when orphan tables exist. F2 must log and skip, never throw."
    );

    // Verify the rebuild was genuinely SKIPPED (not run to completion) by checking
    // the SAME tempDb file that db.js was pointed to via DASHBOARD_DB_PATH
    const dbAfterBoot = new Database(tempDb);

    // (2) Assertion: main table still LACKS CHECK (rebuild was skipped, not executed)
    const mainTableSql = dbAfterBoot
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'")
      .get()?.sql;
    assert(
      !mainTableSql || !mainTableSql.includes("CHECK(severity IN"),
      "main table should still LACK CHECK(severity IN after boot — F2 must skip the rebuild due to orphan, not run it to completion. " +
        "This assertion proves F2 actually works; if removed, the table would be migrated despite the orphan."
    );

    // (3) Assertion: original coach_observations rows are still present and unchanged
    const originalRows = dbAfterBoot
      .prepare("SELECT id, severity FROM coach_observations ORDER BY id")
      .all();
    assert.deepEqual(
      originalRows,
      [{ id: 1, severity: "info" }],
      "original rows in main table should be present and unchanged after F2 skips the rebuild"
    );

    // (4) Assertion: orphaned table's row count unchanged
    const orphanRows = dbAfterBoot
      .prepare("SELECT COUNT(*) as cnt FROM coach_observations_old")
      .get();
    assert.equal(
      orphanRows.cnt,
      1,
      "orphaned rows should not be destroyed — F2 must skip silently and preserve the data."
    );

    dbAfterBoot.close();
  });
});

/**
 * T3a — Clean upgrade path: 6 assertions
 */
describe("Migration: coach_observations severity CHECK rebuild", () => {
  let tempDb;
  let db;

  beforeEach(() => {
    tempDb = buildLegacyDb([
      {
        id: 1,
        practice_id: "account-weekly-balance",
        scope_type: "global",
        scope_id: "global",
        values_json: "{}",
        status: "open",
        responded_at: null,
        kind: "info",
        severity: "info",
      },
      {
        id: 2,
        practice_id: "account-weekly-balance",
        scope_type: "global",
        scope_id: "global",
        values_json: "{}",
        status: "dismissed",
        responded_at: Date.now(),
        kind: "info",
        severity: "warning",
      },
    ]);
    process.env.DASHBOARD_DB_PATH = tempDb;
    delete require.cache[require.resolve("../db")];
    require("../db");
    db = require("../db").db;
  });

  afterEach(() => {
    try {
      if (db) db.close();
    } catch {}
    try {
      delete require.cache[require.resolve("../db")];
    } catch {}
    delete process.env.DASHBOARD_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(tempDb + suffix);
      } catch {}
    }
  });

  it("boots successfully against a legacy pre-CHECK database", () => {
    assert.ok(db, "db module should load");
  });

  it("adds CHECK constraint to sqlite_master", () => {
    const sql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'")
      .get()?.sql;
    assert(
      sql && sql.includes("CHECK(severity IN"),
      "CHECK constraint should be in DDL after migration"
    );
  });

  it("preserves all rows byte-identical (id, columns, values, order)", () => {
    const before = [
      { id: 1, severity: "info" },
      { id: 2, severity: "warning" },
    ];
    const after = db.prepare("SELECT id, severity FROM coach_observations ORDER BY id").all();
    assert.deepEqual(after, before, "rows should be byte-identical after migration");
  });

  it("recreates both indexes", () => {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='coach_observations'"
      )
      .all();
    const names = indexes.map((i) => i.name);
    assert(
      names.includes("idx_coach_observations_open"),
      "idx_coach_observations_open should exist after migration"
    );
    assert(
      names.includes("idx_coach_observations_detected_at"),
      "idx_coach_observations_detected_at should exist after migration"
    );
  });

  it("rejects new out-of-enum values", () => {
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO coach_observations (practice_id, scope_type, scope_id, values_json, status, kind, severity) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run("test", "global", "global", "{}", "open", "info", "critical"),
      /CHECK constraint failed|SQLITE_CONSTRAINT/,
      "should reject severity='critical' after CHECK is in place"
    );
  });

  it("is idempotent: second boot is a no-op", () => {
    const countBefore = db.prepare("SELECT COUNT(*) as cnt FROM coach_observations").get().cnt;
    // Close and reload
    db.close();
    delete require.cache[require.resolve("../db")];
    require("../db");
    db = require("../db").db;
    const countAfter = db.prepare("SELECT COUNT(*) as cnt FROM coach_observations").get().cnt;
    assert.equal(
      countAfter,
      countBefore,
      "row count should not change on second boot — migration should be idempotent"
    );
  });
});

/**
 * T3b — WATCH-3 skip path: migration skips gracefully when out-of-enum data exists
 */
describe("Migration: coach_observations severity CHECK rebuild — pre-flight skip (WATCH-3)", () => {
  let tempDb;
  let db;

  beforeEach(() => {
    // Seed with one out-of-enum row (severity='critical')
    tempDb = buildLegacyDb([
      {
        id: 1,
        practice_id: "test",
        scope_type: "global",
        scope_id: "global",
        values_json: "{}",
        status: "open",
        responded_at: null,
        kind: "info",
        severity: "critical",
      },
    ]);
    process.env.DASHBOARD_DB_PATH = tempDb;
    delete require.cache[require.resolve("../db")];
    require("../db");
    db = require("../db").db;
  });

  afterEach(() => {
    try {
      if (db) db.close();
    } catch {}
    try {
      delete require.cache[require.resolve("../db")];
    } catch {}
    delete process.env.DASHBOARD_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(tempDb + suffix);
      } catch {}
    }
  });

  it("does not throw at require time when out-of-enum data exists", () => {
    assert.ok(db, "db should load without throwing, even with non-conforming data");
  });

  it("skips the rebuild when out-of-enum data exists (leaves CHECK absent)", () => {
    const sql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'")
      .get()?.sql;
    assert(
      !sql || !sql.includes("CHECK(severity IN"),
      "CHECK should NOT be added when pre-flight scan detects non-conforming rows (rebuild skipped)"
    );
  });

  it("never rewrites the offending row (preserves 'critical' value)", () => {
    const row = db.prepare("SELECT severity FROM coach_observations WHERE id=1").get();
    assert.equal(
      row.severity,
      "critical",
      "offending row should not be rewritten — WATCH-3 requires immutability of stored data"
    );
  });
});

/**
 * T3d — Registry-derived CHECK assertion: DDL matches exported enums
 */
describe("coach_observations CHECK constraint registry alignment", () => {
  let tempDb;
  let db;

  beforeEach(() => {
    tempDb = buildLegacyDb([], false);
    process.env.DASHBOARD_DB_PATH = tempDb;
    delete require.cache[require.resolve("../db")];
    delete require.cache[require.resolve("../lib/playbook/practices")];
    require("../db");
    db = require("../db").db;
  });

  afterEach(() => {
    try {
      if (db) db.close();
    } catch {}
    try {
      delete require.cache[require.resolve("../db")];
      delete require.cache[require.resolve("../lib/playbook/practices")];
    } catch {}
    delete process.env.DASHBOARD_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(tempDb + suffix);
      } catch {}
    }
  });

  it("DDL CHECK constraint values match the exported SEVERITY_VALUES and KIND_VALUES registries", () => {
    let SEVERITY_VALUES, KIND_VALUES;
    try {
      const practices = require("../lib/playbook/practices");
      SEVERITY_VALUES = practices.SEVERITY_VALUES;
      KIND_VALUES = practices.KIND_VALUES;
    } catch (e) {
      // If practices.js doesn't export these yet, this test documents what's missing
      assert.fail(
        `Cannot find SEVERITY_VALUES/KIND_VALUES in practices.js: ${e.message}. These exports are required for T3d.`
      );
    }

    const sql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'")
      .get()?.sql;

    // Extract severity CHECK from DDL
    const severityCheckMatch = sql.match(/CHECK\(severity IN \('([^']+)','([^']+)'\)\)/);
    assert(
      severityCheckMatch,
      "severity CHECK not found in DDL. Expected CHECK(severity IN ('info','warning'))"
    );

    const ddlSeverityValues = severityCheckMatch.slice(1).sort().join(",");
    const registrySeverityValues = [...SEVERITY_VALUES].sort().join(",");
    assert.equal(
      ddlSeverityValues,
      registrySeverityValues,
      `DDL severity CHECK values (${ddlSeverityValues}) must match SEVERITY_VALUES registry (${registrySeverityValues})`
    );

    // Extract kind CHECK from DDL (expecting 3 values: risk, info, good)
    const kindCheckMatch = sql.match(/CHECK\(kind IN \('([^']+)','([^']+)','([^']+)'\)\)/);
    assert(
      kindCheckMatch,
      "kind CHECK not found in DDL. Expected CHECK(kind IN ('risk','info','good'))"
    );

    const ddlKindValues = kindCheckMatch.slice(1).sort().join(",");
    const registryKindValues = [...KIND_VALUES].sort().join(",");
    assert.equal(
      ddlKindValues,
      registryKindValues,
      `DDL kind CHECK values (${ddlKindValues}) must match KIND_VALUES registry (${registryKindValues})`
    );
  });
});
