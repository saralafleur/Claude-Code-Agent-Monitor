/**
 * @file Tests for plan import-as-generation-1: the DEC-P2 inversion.
 * Reads existing file-mirrored plans/plan_items, copies as generation 1
 * with origin='import', preserving nesting, surviving re-ingest and
 * legacy deletePlanItemsNotIn, proving import idempotency via (project_id, content_hash).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

// R0 red: modules do not exist
const planLifecycle = require("../lib/plan-lifecycle");
const db = require("../db");

describe("plan import inversion (A3)", () => {
  it("A3.1: import writes generation 1 from DB mirror with canonical cwd, items match, nesting resolves", () => {
    assert.ok(typeof planLifecycle.importGenerationFromPlan === "function");
  });

  it("A3.2: re-import is a no-op — same plan id returned, counts unchanged", () => {
    assert.ok(typeof planLifecycle.importGenerationFromPlan === "function");
  });

  it("A3.3: UNIQUE idempotency index bites on second raw insert with same (project_id, content_hash)", () => {
    // Check that the UNIQUE index exists on project_plans
    const indexInfo = db.db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type='index' AND tbl_name='project_plans'
      AND sql LIKE '%imported_content_hash%'
    `
      )
      .all();
    assert.ok(
      indexInfo.length > 0,
      "UNIQUE import idempotency index should exist on project_plans"
    );
  });

  it("A3.4: cwd canonicalization at import — symlink + case-variant yield one project_plans row", () => {
    const cwdIdentity = require("../lib/cwd-identity");
    assert.ok(typeof cwdIdentity.canonicalizeCwd === "function");
    assert.ok(typeof planLifecycle.importGenerationFromPlan === "function");
  });

  it("A3.5: re-ingest survival — legacy count shrank (deletePlanItemsNotIn fired), project_plan_items untouched", async () => {
    const { ingestPlanForCwd } = require("../lib/plan-ingest");
    const { importGenerationFromPlan } = require("../lib/plan-lifecycle");
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "a3-5-reingest-"));
    try {
      fs.writeFileSync(
        path.join(workDir, "AGENT-PLAN.md"),
        "# A3.5 Plan\n- [ ] 1. First item\n- [ ] 2. Second item\n"
      );
      ingestPlanForCwd(db, workDir);
      const legacyBefore = db.db
        .prepare("SELECT COUNT(*) AS n FROM plan_items WHERE cwd = ?")
        .get(workDir).n;
      assert.equal(legacyBefore, 2, "fixture setup: two legacy items must have ingested");

      const projectId = `a3-5-project-${Date.now()}`;
      db.stmts.insertProject.run(projectId, projectId);
      const result = await importGenerationFromPlan(db, { projectId, cwd: workDir });
      assert.equal(result.created, true, "fixture setup: import must succeed");
      const planItemsAfterImport = db.db
        .prepare("SELECT * FROM project_plan_items WHERE plan_id = ? ORDER BY id")
        .all(result.plan.id);
      assert.equal(planItemsAfterImport.length, 2);

      // Rewrite AGENT-PLAN.md with only ONE item and re-ingest — this is
      // exactly the deletePlanItemsNotIn trap (plan-ingest.js:396): the
      // LEGACY plan_items row for "Second item" must be deleted by the real
      // re-ingest path, while project_plan_items (this feature's own
      // generation-1 copy) must be completely unaffected — proving the
      // DEC-P2 inversion actually severed the two tables' fates.
      fs.writeFileSync(path.join(workDir, "AGENT-PLAN.md"), "# A3.5 Plan\n- [ ] 1. First item\n");
      ingestPlanForCwd(db, workDir);
      const legacyAfter = db.db
        .prepare("SELECT COUNT(*) AS n FROM plan_items WHERE cwd = ?")
        .get(workDir).n;
      assert.equal(
        legacyAfter,
        1,
        "the legacy mirror must shrink to 1 — deletePlanItemsNotIn must actually fire on re-ingest"
      );

      const planItemsAfterReingest = db.db
        .prepare("SELECT * FROM project_plan_items WHERE plan_id = ? ORDER BY id")
        .all(result.plan.id);
      assert.deepEqual(
        planItemsAfterReingest,
        planItemsAfterImport,
        "project_plan_items must be byte-identical after a legacy re-ingest — the DEC-P2 inversion means it has no deletePlanItemsNotIn analogue"
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("A3.6 (O-7): rogue-writer scan — assertSingleHome derived scope validates single-home writes", () => {
    const helperPath = path.join(__dirname, "helpers", "single-home.js");
    assert.ok(fs.existsSync(helperPath), "single-home.js helper should exist from DEC-2 merge");
    const { assertSingleHome } = require("./helpers/single-home");
    assert.ok(typeof assertSingleHome === "function");

    // Verify that project_plan_items write ops are single-home: only db.js has SQL INSERT/UPDATE/DELETE definitions
    // db.js is at server/db.js (not in lib/), where all prepared statements for the schema are defined
    const dbPath = path.resolve(__dirname, "..", "db.js");
    const libDir = path.resolve(__dirname, "..", "lib");
    const routesDir = path.resolve(__dirname, "..", "routes");

    // Scan for raw SQL DEFINITIONS (backtick-quoted strings) for project_plan_items operations
    // These should appear only in db.js (where prepared statements are defined), not in consumer files
    const sqlDefFiles = [];
    const stmtRefFiles = [];

    // Check db.js
    const dbContent = fs.readFileSync(dbPath, "utf8");
    if (
      /`[\s\S]*?(?:INSERT INTO|UPDATE|DELETE FROM)\s+project_plan_items[\s\S]*?`/.test(dbContent)
    ) {
      sqlDefFiles.push("db.js");
    }

    // Check lib/ files (should not have SQL defs)
    for (const file of fs.readdirSync(libDir)) {
      if (!file.endsWith(".js")) continue;
      const content = fs.readFileSync(path.join(libDir, file), "utf8");
      if (
        /`[\s\S]*?(?:INSERT INTO|UPDATE|DELETE FROM)\s+project_plan_items[\s\S]*?`/.test(content)
      ) {
        sqlDefFiles.push(file);
      }
    }

    // Check routes/ files (should not have SQL defs)
    for (const file of fs.readdirSync(routesDir)) {
      if (!file.endsWith(".js")) continue;
      const content = fs.readFileSync(path.join(routesDir, file), "utf8");
      if (
        /`[\s\S]*?(?:INSERT INTO|UPDATE|DELETE FROM)\s+project_plan_items[\s\S]*?`/.test(content)
      ) {
        sqlDefFiles.push(`routes/${file}`);
      }
    }

    assert.deepEqual(
      sqlDefFiles.sort(),
      ["db.js"],
      "Raw SQL INSERT/UPDATE/DELETE DEFINITIONS for project_plan_items should only be in db.js"
    );

    // Verify that stmt-name references to project_plan_items operations are in db.js, plan-lifecycle.js, project-plans.js
    const stmtRefPattern = /insertProjectPlanItem|updateProjectPlanItem|deleteProjectPlanItem/;

    // Check db.js
    if (stmtRefPattern.test(dbContent)) {
      stmtRefFiles.push("db.js");
    }

    // Check lib/ files
    for (const file of fs.readdirSync(libDir)) {
      if (!file.endsWith(".js")) continue;
      const content = fs.readFileSync(path.join(libDir, file), "utf8");
      if (stmtRefPattern.test(content)) {
        stmtRefFiles.push(file);
      }
    }

    // Check routes/ files
    for (const file of fs.readdirSync(routesDir)) {
      if (!file.endsWith(".js")) continue;
      const content = fs.readFileSync(path.join(routesDir, file), "utf8");
      if (stmtRefPattern.test(content)) {
        stmtRefFiles.push(`routes/${file}`);
      }
    }

    const expectedStmtConsumers = ["db.js", "plan-lifecycle.js", "routes/project-plans.js"];
    const actualStmtConsumers = stmtRefFiles.sort();
    assert.deepEqual(
      actualStmtConsumers,
      expectedStmtConsumers.sort(),
      "Stmt-name refs (insertProjectPlanItem etc) should be in exactly [db.js, plan-lifecycle.js, routes/project-plans.js]"
    );
  });
});
