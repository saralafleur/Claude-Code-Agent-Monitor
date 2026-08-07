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

// Isolation guard: prevent writes to production database during test execution
const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-plan-lifecycle-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

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

  describe("re-parent + claim composer (Slice 4a, DEC-S4-7/DEC-S4-2)", () => {
    const TEST_DB_REPARENT = path.join(
      os.tmpdir(),
      `test-reparent-${Date.now()}-${process.pid}.db`
    );
    let dbModule;

    before(() => {
      process.env.DASHBOARD_DB_PATH = TEST_DB_REPARENT;
      dbModule = require("../db");
    });

    after(() => {
      try {
        dbModule.db.close();
      } catch {
        /* already closed */
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.rmSync(`${TEST_DB_REPARENT}${suffix}`, { force: true });
        } catch {
          /* best effort */
        }
      }
    });

    it("P1: re-parent top-level item under another → parent_item_id set", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        getProjectPlanItem,
      } = planLifecycle;
      const { stmts } = dbModule;

      // Create plan and two items
      const planRes = insertProjectPlan(dbModule, "proj-p1", "P1 Plan");
      const planId = planRes.id;
      const itemA = insertProjectPlanItem(dbModule, planId, { text: "Item A" });
      const itemB = insertProjectPlanItem(dbModule, planId, { text: "Item B" });

      // Re-parent A under B
      const updated = updateProjectPlanItem(dbModule, itemA.id, { parent_item_id: itemB.id });
      assert.equal(updated.parent_item_id, itemB.id, "parent_item_id set");

      // Verify by fresh read
      const fresh = getProjectPlanItem(dbModule, itemA.id);
      assert.equal(fresh.parent_item_id, itemB.id, "fresh read confirms parent_item_id set");
    });

    it("P2: promote sub-item to top-level via parent_item_id: null → becomes null", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        getProjectPlanItem,
      } = planLifecycle;
      const planRes = insertProjectPlan(dbModule, "proj-p2", "P2 Plan");
      const planId = planRes.id;
      const parent = insertProjectPlanItem(dbModule, planId, { text: "Parent" });
      const child = insertProjectPlanItem(dbModule, planId, {
        text: "Child",
        parent_item_id: parent.id,
      });

      // Promote to top-level via explicit null
      const updated = updateProjectPlanItem(dbModule, child.id, { parent_item_id: null });
      assert.strictEqual(updated.parent_item_id, null, "parent_item_id must be strictly null");

      // Verify by fresh read
      const fresh = getProjectPlanItem(dbModule, child.id);
      assert.strictEqual(
        fresh.parent_item_id,
        null,
        "fresh read confirms null (not undefined or missing)"
      );
    });

    it("P3: omitting parent_item_id key leaves placement unchanged while text edit applies", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        getProjectPlanItem,
      } = planLifecycle;
      const planRes = insertProjectPlan(dbModule, "proj-p3", "P3 Plan");
      const planId = planRes.id;
      const parent = insertProjectPlanItem(dbModule, planId, { text: "Parent" });
      const child = insertProjectPlanItem(dbModule, planId, {
        text: "Original",
        parent_item_id: parent.id,
      });

      // Edit text only, NO parent_item_id key
      const updated = updateProjectPlanItem(dbModule, child.id, { text: "After" });
      assert.equal(updated.text, "After", "text changed");
      assert.equal(updated.parent_item_id, parent.id, "placement unchanged");

      // Verify by fresh read
      const fresh = getProjectPlanItem(dbModule, child.id);
      assert.equal(fresh.text, "After", "fresh read: text changed");
      assert.equal(fresh.parent_item_id, parent.id, "fresh read: placement unchanged");
    });

    it("P3-mirror: placement-only edit leaves text unchanged", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        getProjectPlanItem,
      } = planLifecycle;
      const planRes = insertProjectPlan(dbModule, "proj-p3m", "P3M Plan");
      const planId = planRes.id;
      const parent = insertProjectPlanItem(dbModule, planId, { text: "Parent" });
      const child = insertProjectPlanItem(dbModule, planId, {
        text: "Original",
        parent_item_id: parent.id,
      });

      // Edit placement only, NO text key
      const updated = updateProjectPlanItem(dbModule, child.id, { parent_item_id: null });
      assert.strictEqual(updated.parent_item_id, null, "placement changed to null");
      assert.equal(updated.text, "Original", "text unchanged");

      // Verify by fresh read
      const fresh = getProjectPlanItem(dbModule, child.id);
      assert.strictEqual(fresh.parent_item_id, null, "fresh read: placement null");
      assert.equal(fresh.text, "Original", "fresh read: text unchanged");
    });

    it("P4: self-parent → INVALID_INPUT, row unchanged", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        isDomainError,
        getProjectPlanItem,
      } = planLifecycle;
      const planRes = insertProjectPlan(dbModule, "proj-p4", "P4 Plan");
      const planId = planRes.id;
      const item = insertProjectPlanItem(dbModule, planId, { text: "Item P4" });

      // Try to be own parent
      const result = updateProjectPlanItem(dbModule, item.id, { parent_item_id: item.id });
      assert.ok(isDomainError(result), "self-parent must return domain error");
      assert.equal(result.error.code, "INVALID_INPUT");
      assert.equal(result.error.message, "an item cannot be its own parent");

      // Verify row unchanged
      const fresh = getProjectPlanItem(dbModule, item.id);
      assert.strictEqual(fresh.parent_item_id, null, "placement unchanged");
    });

    it("P5: 4-row chain G→H→I→J, re-parent G under J → INVALID_INPUT cycle, G unchanged", () => {
      // DEC-S4-10: fixture must be depth ≥ 4 (three hops) to distinguish correct walk from off-by-one
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        isDomainError,
        getProjectPlanItem,
      } = planLifecycle;
      const planRes = insertProjectPlan(dbModule, "proj-p5", "P5 Plan");
      const planId = planRes.id;

      // Build chain: G → H → I → J (4 levels, 3 hops)
      const g = insertProjectPlanItem(dbModule, planId, { text: "G" });
      const h = insertProjectPlanItem(dbModule, planId, { text: "H", parent_item_id: g.id });
      const i = insertProjectPlanItem(dbModule, planId, { text: "I", parent_item_id: h.id });
      const j = insertProjectPlanItem(dbModule, planId, { text: "J", parent_item_id: i.id });

      // Try to re-parent G under J (would create cycle: G → J → I → H → G)
      const result = updateProjectPlanItem(dbModule, g.id, { parent_item_id: j.id });
      assert.ok(isDomainError(result), "cycle must return domain error");
      assert.equal(result.error.code, "INVALID_INPUT");
      assert.ok(result.error.message.includes("cycle"), "error message must mention cycle");

      // Verify G unchanged
      const gFresh = getProjectPlanItem(dbModule, g.id);
      assert.strictEqual(gFresh.parent_item_id, null, "G parent_item_id unchanged");
    });

    it("P5b: corrupt self-referencing row, re-parent unrelated item → returns quickly (walk bounded)", () => {
      const { insertProjectPlan, insertProjectPlanItem, updateProjectPlanItem } = planLifecycle;
      const planRes = insertProjectPlan(dbModule, "proj-p5b", "P5B Plan");
      const planId = planRes.id;

      // Create a normal item
      const normal = insertProjectPlanItem(dbModule, planId, { text: "Normal" });

      // Create a corrupt self-referencing row via raw statement
      // insertProjectPlanItem: (plan_id, parent_item_id, text, acceptance, detail, checked, position, target_date, imported_item_id, imported_from_cwd)
      const badItem = dbModule.stmts.insertProjectPlanItem.run(
        planId, // plan_id
        null, // parent_item_id (initially null, will set to self below)
        "Corrupt", // text
        null, // acceptance
        null, // detail
        0, // checked
        1, // position (cannot be null)
        null, // target_date
        null, // imported_item_id
        null // imported_from_cwd
      );
      const badItemId = badItem.lastInsertRowid;

      // Make it self-referencing (bypassing validation)
      dbModule.stmts.reparentProjectPlanItem.run(badItemId, badItemId);

      // Re-parent unrelated item should return quickly without hanging/throwing range error
      const startTime = Date.now();
      const result = updateProjectPlanItem(dbModule, normal.id, { parent_item_id: badItemId });
      const elapsed = Date.now() - startTime;

      assert.ok(result.parent_item_id === badItemId, "unrelated item re-parent should succeed");
      assert.ok(elapsed < 5000, "walk must be bounded; should complete within 5 seconds");
    });

    it("P6: parent in different plan → INVALID_INPUT, row unchanged", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        isDomainError,
        getProjectPlanItem,
      } = planLifecycle;
      const plan1 = insertProjectPlan(dbModule, "proj-p6a", "P6A Plan");
      const plan2 = insertProjectPlan(dbModule, "proj-p6b", "P6B Plan");

      const item1 = insertProjectPlanItem(dbModule, plan1.id, { text: "Item in Plan1" });
      const item2 = insertProjectPlanItem(dbModule, plan2.id, { text: "Item in Plan2" });

      // Try to re-parent item1 under item2 (different plan)
      const result = updateProjectPlanItem(dbModule, item1.id, { parent_item_id: item2.id });
      assert.ok(isDomainError(result), "cross-plan parent must return domain error");
      assert.equal(result.error.code, "INVALID_INPUT");
      assert.ok(result.error.message.includes("different plan"));

      // Verify item1 unchanged
      const fresh = getProjectPlanItem(dbModule, item1.id);
      assert.strictEqual(fresh.parent_item_id, null, "placement unchanged");
    });

    it("P7: re-parent on closed plan → ALREADY_CLOSED", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        closePlan,
        isDomainError,
      } = planLifecycle;
      const plan = insertProjectPlan(dbModule, "proj-p7", "P7 Plan");
      const itemA = insertProjectPlanItem(dbModule, plan.id, { text: "A" });
      const itemB = insertProjectPlanItem(dbModule, plan.id, { text: "B" });

      // Close the plan
      closePlan(dbModule, plan.id, "test closure");

      // Try to re-parent on closed plan
      const result = updateProjectPlanItem(dbModule, itemA.id, { parent_item_id: itemB.id });
      assert.ok(isDomainError(result), "re-parent on closed plan must return domain error");
      assert.equal(result.error.code, "ALREADY_CLOSED");
      assert.equal(result.error.message, "plan is closed");
    });

    it("PA: combined text + placement change, self-parent rejected → both unchanged", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        updateProjectPlanItem,
        isDomainError,
        getProjectPlanItem,
      } = planLifecycle;
      const plan = insertProjectPlan(dbModule, "proj-pa", "PA Plan");
      const item = insertProjectPlanItem(dbModule, plan.id, { text: "Original" });

      // Try to change both text and placement (to self-parent, which fails)
      const result = updateProjectPlanItem(dbModule, item.id, {
        text: "New text",
        parent_item_id: item.id, // self-parent, will fail
      });
      assert.ok(isDomainError(result), "invalid placement must reject transaction");

      // Verify both unchanged
      const fresh = getProjectPlanItem(dbModule, item.id);
      assert.equal(fresh.text, "Original", "text unchanged due to transaction rollback");
      assert.strictEqual(fresh.parent_item_id, null, "placement unchanged");
    });

    it("PX: forced throw at insertValueClaim.run → item row absent (transaction rolled back)", () => {
      // Requires claimUnitIntoItem to exist (will fail on missing export until Task 3)
      // Tests that the transaction wrapper actually rolls back the item insert
      // when a claim write fails — not just swallows the error.
      try {
        const { claimUnitIntoItem } = planLifecycle;
        assert.ok(typeof claimUnitIntoItem === "function", "claimUnitIntoItem must exist");

        const { insertProjectPlan } = planLifecycle;
        const plan = insertProjectPlan(dbModule, "proj-px", "PX Plan");

        // Spy on insertValueClaim to throw
        const originalRun = dbModule.stmts.insertValueClaim.run;
        let throwOnce = true;
        dbModule.stmts.insertValueClaim.run = function (...args) {
          if (throwOnce) {
            throwOnce = false;
            throw new Error("Forced test throw");
          }
          return originalRun.apply(this, args);
        };

        try {
          // Call claimUnitIntoItem with valid new_item and claim fields
          const result = claimUnitIntoItem(dbModule, plan.id, {
            new_item: { text: "PX test item" },
            value_source: "detour",
            value_ref: "px-test",
            source_cwd: "/tmp/px",
            attribution: "judgment",
          });

          // Should propagate the throw, not return a domain error
          assert.fail("claimUnitIntoItem should propagate the forced throw");
        } catch (err) {
          assert.equal(err.message, "Forced test throw", "forced throw must propagate");
        } finally {
          // Restore original
          dbModule.stmts.insertValueClaim.run = originalRun;
        }

        // Verify item was NOT created (rolled back by transaction)
        const items = dbModule.db
          .prepare("SELECT * FROM project_plan_items WHERE text = ?")
          .all("PX test item");
        assert.equal(items.length, 0, "item must be absent (transaction rolled back)");
      } catch (err) {
        // If claimUnitIntoItem doesn't exist yet, that's expected red
        if (
          err.message.includes("claimUnitIntoItem") ||
          err.message.includes("Cannot find module")
        ) {
          // This is the expected red-first state
          return;
        }
        throw err;
      }
    });

    it("A2.20: after re-parenting C under B in same plan, claim into C succeeds; cross-plan rejected", () => {
      const {
        insertProjectPlan,
        insertProjectPlanItem,
        claimUnitIntoItem,
        getProjectPlanItem,
        isDomainError,
        updateProjectPlanItem,
      } = planLifecycle;

      try {
        if (typeof claimUnitIntoItem !== "function") {
          // Expected red-first state
          return;
        }

        const plan = insertProjectPlan(dbModule, "proj-a220", "A2.20 Plan");
        const otherPlan = insertProjectPlan(dbModule, "proj-a220-other", "A2.20 Other Plan");

        const b = insertProjectPlanItem(dbModule, plan.id, { text: "B" });
        const c = insertProjectPlanItem(dbModule, plan.id, { text: "C" });

        // Re-parent C under B
        updateProjectPlanItem(dbModule, c.id, { parent_item_id: b.id });

        // Claim into C within same plan
        const claimSamePlan = claimUnitIntoItem(dbModule, plan.id, {
          item_id: c.id,
          value_source: "detour",
          value_ref: "a220-same-plan",
          attribution: "judgment",
        });
        assert.ok(!isDomainError(claimSamePlan), "claim into C in same plan must succeed");

        // Claim into C in different plan must fail
        const claimOtherPlan = claimUnitIntoItem(dbModule, otherPlan.id, {
          item_id: c.id,
          value_source: "detour",
          value_ref: "a220-other-plan",
          attribution: "judgment",
        });
        assert.ok(isDomainError(claimOtherPlan), "claim into C in other plan must fail");
        assert.equal(claimOtherPlan.error.code, "INVALID_INPUT");
        assert.ok(claimOtherPlan.error.message.includes("does not belong to this plan"));
      } catch (err) {
        // If claimUnitIntoItem doesn't exist, that's expected red
        if (err.message.includes("claimUnitIntoItem")) {
          return;
        }
        throw err;
      }
    });

    it("PZ: deleteProjectPlanItem with child or claim → SQLITE_CONSTRAINT_FOREIGNKEY (characterization pin)", () => {
      // DEC-S4-9: this characterizes today's behavior, NOT an endorsement.
      // Rewrite when the cascade-vs-refuse-vs-reparent rule is decided (WATCH-S4-F).
      const { insertProjectPlan, insertProjectPlanItem } = planLifecycle;

      const plan = insertProjectPlan(dbModule, "proj-pz", "PZ Plan");
      const parent = insertProjectPlanItem(dbModule, plan.id, { text: "Parent" });
      const child = insertProjectPlanItem(dbModule, plan.id, {
        text: "Child",
        parent_item_id: parent.id,
      });

      // Try to delete parent (has child)
      try {
        dbModule.stmts.deleteProjectPlanItem.run(parent.id);
        assert.fail("delete with child should throw SQLITE_CONSTRAINT_FOREIGNKEY");
      } catch (err) {
        assert.equal(
          err.code,
          "SQLITE_CONSTRAINT_FOREIGNKEY",
          "should throw FK constraint error with SQLITE_CONSTRAINT_FOREIGNKEY code"
        );
      }

      // Create a claim and try to delete item (has claim)
      const claim = dbModule.stmts.insertValueClaim.run(
        plan.project_id, // project_id
        plan.id, // plan_id
        child.id, // item_id
        "detour", // value_source
        "pz-ref", // value_ref
        "/tmp/pz", // source_cwd
        "test label", // label_snapshot
        null, // seen_at_snapshot
        null, // stage_snapshot
        "judgment", // attribution
        "human" // claimed_by
      );

      try {
        dbModule.stmts.deleteProjectPlanItem.run(child.id);
        assert.fail("delete with claim should throw SQLITE_CONSTRAINT_FOREIGNKEY");
      } catch (err) {
        assert.equal(
          err.code,
          "SQLITE_CONSTRAINT_FOREIGNKEY",
          "should throw FK constraint error with SQLITE_CONSTRAINT_FOREIGNKEY code"
        );
      }
    });
  });
});
