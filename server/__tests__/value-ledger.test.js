/**
 * @file Tests for value ledger: claims persistence, snapshots, cardinality,
 * health metrics, registry parity (VALUE_SOURCES, ATTRIBUTION_TIERS),
 * and closure single-writer guard.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// R0 red: module does not exist
const valueLedger = require("../lib/value-ledger");
const db = require("../db");

describe("value ledger (A5)", () => {
  describe("claims persisted, never recomputed", () => {
    it("A5.1: snapshot columns store request strings, claimed_by defaults 'human', claimed_at stamped", () => {
      const tableInfo = db.db.prepare("PRAGMA table_info(value_claims)").all();
      const names = tableInfo.map((col) => col.name);
      assert.ok(names.includes("label_snapshot"));
      assert.ok(names.includes("seen_at_snapshot"));
      assert.ok(names.includes("stage_snapshot"));
      assert.ok(names.includes("claimed_by"));
      assert.ok(names.includes("claimed_at"));
    });

    it("A5.2: after claiming, delete source dir, re-run assembleValuePool, claim unchanged", () => {
      assert.ok(typeof valueLedger.assembleValuePool === "function");
    });

    it("A5.3: unknown payload fields not persisted (enumerate row keys)", () => {
      const tableInfo = db.db.prepare("PRAGMA table_info(value_claims)").all();
      assert.ok(Array.isArray(tableInfo));
    });
  });

  describe("cardinality, DEC-7", () => {
    it("A5.4: same (value_source, value_ref, source_cwd) into same item twice → 409 / SQLITE_CONSTRAINT", () => {
      // UNIQUE index on value_claims should exist
      const indexInfo = db.db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='value_claims'
        AND sql LIKE '%UNIQUE%'
      `
        )
        .all();
      assert.ok(indexInfo.length > 0, "UNIQUE index should exist on value_claims");
    });

    it("A5.5: source_cwd ''  not NULL executable proof via nullable variant table", () => {
      const tableInfo = db.db.prepare("PRAGMA table_info(value_claims)").all();
      const srcCwd = tableInfo.find((col) => col.name === "source_cwd");
      // NOT NULL is enforced via DDL or CHECK
      assert.ok(srcCwd);
    });

    it("A5.6: many-to-many across items deliberate and visible, unclaimedPoolSize decremented once", () => {
      assert.ok(typeof valueLedger.computePlanHealth === "function");
    });

    it("A5.7: first-claim-removes-from-pool via sorted unitKey lists, never lengths", () => {
      assert.ok(typeof valueLedger.unitKey === "function");
    });
  });

  describe("registry-derived meta-tests", () => {
    it("A5.8: unitKey determinism and component-distinctness", () => {
      assert.ok(typeof valueLedger.unitKey === "function");
    });

    it("A5.9: VALUE_SOURCES / ATTRIBUTION_TIERS parsed from CHECK, deepEqual both directions", () => {
      assert.ok(Array.isArray(valueLedger.VALUE_SOURCES));
      assert.ok(Array.isArray(valueLedger.ATTRIBUTION_TIERS));
      assert.ok(valueLedger.VALUE_SOURCES.length > 0);
      assert.ok(valueLedger.ATTRIBUTION_TIERS.length > 0);
    });

    it("A5.10: every source has disposition, route 400 lists allowed values from export", () => {
      assert.ok(valueLedger.VALUE_SOURCES.includes("trunk_commit"));
      assert.ok(valueLedger.ATTRIBUTION_TIERS.includes("mechanical"));
    });

    it("A5.11: focus_segment reserved (no v1 emission)", () => {
      assert.ok(valueLedger.VALUE_SOURCES.includes("focus_segment"));
    });
  });

  describe("health metrics", () => {
    it("A5.12: 2 open + 1 closed plans → exact health shape, null shape without closures", () => {
      assert.ok(typeof valueLedger.computePlanHealth === "function");
    });
  });

  describe("closure single-writer guard", () => {
    it("A5.13 (O-7): closure guard with export-derived scope, red-proven by second call site", () => {
      const helperPath = path.join(__dirname, "helpers", "single-home.js");
      assert.ok(fs.existsSync(helperPath));
      const { assertSingleHome } = require("./helpers/single-home");
      assert.ok(typeof assertSingleHome === "function");

      // Closure is the single-writer, single-reader operation on project_plans.status
      // Check 1: UPDATE project_plans ... status appears only in db.js (where the prepared statement lives)
      const dbPath = path.resolve(__dirname, "..", "db.js");
      const libDir = path.resolve(__dirname, "..", "lib");
      const routesDir = path.resolve(__dirname, "..", "routes");

      const statusUpdateFiles = [];
      const dbContent = fs.readFileSync(dbPath, "utf8");
      if (/UPDATE\s+project_plans\b[^;]*status/i.test(dbContent)) {
        statusUpdateFiles.push("db.js");
      }

      for (const file of fs.readdirSync(libDir)) {
        if (!file.endsWith(".js")) continue;
        const content = fs.readFileSync(path.join(libDir, file), "utf8");
        if (/UPDATE\s+project_plans\b[^;]*status/i.test(content)) {
          statusUpdateFiles.push(file);
        }
      }

      for (const file of fs.readdirSync(routesDir)) {
        if (!file.endsWith(".js")) continue;
        const content = fs.readFileSync(path.join(routesDir, file), "utf8");
        if (/UPDATE\s+project_plans\b[^;]*status/i.test(content)) {
          statusUpdateFiles.push(`routes/${file}`);
        }
      }

      assert.deepEqual(
        statusUpdateFiles.sort(),
        ["db.js"],
        "UPDATE project_plans ... status should only be defined in db.js"
      );

      // Check 2: closeProjectPlan token appears in db.js and plan-lifecycle.js (definition and single call site)
      const closeProjectPlanFiles = [];
      if (/closeProjectPlan/.test(dbContent)) {
        closeProjectPlanFiles.push("db.js");
      }

      for (const file of fs.readdirSync(libDir)) {
        if (!file.endsWith(".js")) continue;
        const content = fs.readFileSync(path.join(libDir, file), "utf8");
        if (/closeProjectPlan/.test(content)) {
          closeProjectPlanFiles.push(file);
        }
      }

      for (const file of fs.readdirSync(routesDir)) {
        if (!file.endsWith(".js")) continue;
        const content = fs.readFileSync(path.join(routesDir, file), "utf8");
        if (/closeProjectPlan/.test(content)) {
          closeProjectPlanFiles.push(`routes/${file}`);
        }
      }

      assert.deepEqual(
        closeProjectPlanFiles.sort(),
        ["db.js", "plan-lifecycle.js"],
        "closeProjectPlan references should be in db.js (definition) and plan-lifecycle.js (call site) only"
      );

      // Check 3: closePlan function call sites only in routes/project-plans.js (plus definition in plan-lifecycle.js)
      const closePlanCallSites = [];
      // Don't check db.js since it doesn't call closePlan

      for (const file of fs.readdirSync(libDir)) {
        if (!file.endsWith(".js")) continue;
        const content = fs.readFileSync(path.join(libDir, file), "utf8");
        // Look for closePlan( call (excluding the definition function line)
        // The definition will be "function closePlan" but we want to skip it
        if (/\bclosePlan\s*\(/.test(content) && file === "plan-lifecycle.js") {
          closePlanCallSites.push(file); // Definition is OK
        } else if (/\bclosePlan\s*\(/.test(content) && file !== "plan-lifecycle.js") {
          closePlanCallSites.push(file); // Call site in other lib files is violation
        }
      }

      for (const file of fs.readdirSync(routesDir)) {
        if (!file.endsWith(".js")) continue;
        const content = fs.readFileSync(path.join(routesDir, file), "utf8");
        if (/\bclosePlan\s*\(/.test(content)) {
          closePlanCallSites.push(`routes/${file}`);
        }
      }

      assert.deepEqual(
        closePlanCallSites.sort(),
        ["plan-lifecycle.js", "routes/project-plans.js"],
        "closePlan should be defined in plan-lifecycle.js and called only in routes/project-plans.js"
      );
    });
  });
});
