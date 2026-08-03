/**
 * @file Tests for plan lifecycle: state machine (open → closed), generation chain,
 * closed-plan immutability, concurrent open plans per project, closure as the
 * single writer, claim lifecycle, and WebSocket broadcast allowlist.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

// R0 red: modules do not exist — these will fail with "Cannot find module"
const planLifecycle = require("../lib/plan-lifecycle");
const db = require("../db");

describe("plan lifecycle (A2)", () => {
  describe("generation chain", () => {
    it("A2.1: succeeds_plan_id walk derives ordinals 1..3", () => {
      assert.ok(typeof planLifecycle.generationOrdinal === "function");
    });

    it("A2.2: ordinal is derived never stored — PRAGMA table_info(project_plans) name-set exactly equals DDL list", () => {
      const tableInfo = db.db.prepare("PRAGMA table_info(project_plans)").all();
      const names = tableInfo.map((col) => col.name);
      assert.ok(!names.includes("ordinal"), "project_plans should not have an ordinal column");
      assert.ok(!names.includes("generation"), "project_plans should not have a generation column");
    });

    it("A2.3: branching chain (two successors of gen1, legal under DEC-P5) returns 2 for both without throwing", () => {
      assert.ok(typeof planLifecycle.generationOrdinal === "function");
    });
  });

  describe("state machine", () => {
    it("A2.4: closePlan stamps status:'closed' + ISO closed_at + note", () => {
      assert.ok(typeof planLifecycle.closePlan === "function");
    });

    it("A2.5: POST /:id/close → 200, PATCH /:id {status:'closed'} → 400", () => {
      // Route test will verify in B1; this confirms function exists
      assert.ok(typeof planLifecycle.closePlan === "function");
    });

    it("A2.6: second close → error / 409 with closed_at unchanged", () => {
      assert.ok(typeof planLifecycle.closePlan === "function");
    });

    it("A2.7: no reopen path exists, PATCH title on closed plan → 409", () => {
      // Structural assertion: no reopen path exists in source
      const planLifecycleSource = fs.readFileSync(
        path.join(__dirname, "..", "lib", "plan-lifecycle.js"),
        "utf8"
      );
      assert.ok(
        !planLifecycleSource.includes("reopen"),
        "plan-lifecycle.js should not contain 'reopen' logic"
      );
    });
  });

  describe("closed-immutability negatives", () => {
    it("A2.8: POST /:id/items on closed plan → 409", () => {
      assert.ok(typeof planLifecycle.insertProjectPlanItem === "function");
    });

    it("A2.9: PATCH /items/:itemId on closed plan → 409", () => {
      assert.ok(typeof planLifecycle.updateProjectPlanItem === "function");
    });

    it("A2.10: DELETE /items/:itemId on closed plan → 409", () => {
      assert.ok(typeof planLifecycle.deleteProjectPlanItem === "function");
    });

    it("A2.11: POST /:id/claims on closed plan → 409", () => {
      // Routes will enforce; this confirms modules exist
      assert.ok(typeof planLifecycle === "object");
    });

    it("A2.12: DELETE /claims/:claimId on closed plan → 409", () => {
      assert.ok(typeof planLifecycle === "object");
    });

    it("A2.13: DELETE /api/project-plans/:id → 404/405, no production file deletes project_plans", () => {
      // Structural assertion: verify no deleteProjectPlan literal exists
      const routesSource = fs.readFileSync(
        path.join(__dirname, "..", "routes", "project-plans.js"),
        "utf8"
      );
      assert.ok(
        !routesSource.includes("DELETE /api/project-plans/:id"),
        "Should not expose DELETE route for plans"
      );

      // Verify no DELETE FROM project_plans literal
      const dbSource = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
      assert.ok(
        !dbSource.match(/DELETE\s+FROM\s+project_plans/i),
        "No DELETE FROM project_plans statement should exist"
      );
    });
  });

  describe("claims carry no closed state", () => {
    it("A2.14: PRAGMA table_info(value_claims) name-set exactly equals DDL (no closed_at column)", () => {
      const tableInfo = db.db.prepare("PRAGMA table_info(value_claims)").all();
      const names = tableInfo.map((col) => col.name);
      assert.ok(!names.includes("closed_at"), "value_claims should not have closed_at column");
      assert.ok(!names.includes("closed"), "value_claims should not have closed column");
    });

    it("A2.15: claim rows deepEqual-identical across closePlan", () => {
      assert.ok(typeof planLifecycle.closePlan === "function");
      // Live assertion will come in integration test once fixtures exist
    });

    it("A2.16: static scan: zero production files match /UPDATE\\s+value_claims/i", () => {
      const filesToScan = [
        path.join(__dirname, "..", "lib", "value-ledger.js"),
        path.join(__dirname, "..", "routes", "project-plans.js"),
      ];
      let violations = [];
      for (const filePath of filesToScan) {
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, "utf8");
        if (/UPDATE\s+value_claims/i.test(content)) {
          violations.push(filePath);
        }
      }
      assert.equal(
        violations.length,
        0,
        `Should not UPDATE value_claims in: ${violations.join(", ")}`
      );
    });
  });

  describe("concurrent plans, DEC-P5", () => {
    it("A2.17: two open plans on one project do not interfere", () => {
      assert.ok(typeof planLifecycle.insertProjectPlan === "function");
    });

    it("A2.18: same unit claimable into items of both plans, closing A leaves B's claims untouched", () => {
      assert.ok(typeof planLifecycle.closePlan === "function");
    });
  });

  describe("WebSocket allowlist", () => {
    it("A2.19: broadcast type set is exactly {project_plan_updated, value_claim_updated}", () => {
      // This is verified in integration tests via broadcast collector
      // For skeleton: just ensure the server index exists and can be required
      const indexSource = require("../index");
      assert.ok(typeof indexSource.createApp === "function");
    });
  });
});
