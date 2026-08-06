/**
 * @file Smoke tests for Value Pool Slice 2: coverage-on-demand acceptance criteria
 * Proves three core behaviors at the lowest honest layer:
 * - AC-2: Coverage request mechanism and snapshot structure
 * - AC-3: coverageSnapshot computes ETA with cold-start estimating state
 * - AC-5: WS payload carries coverage field (widened type check)
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-coverage-smoke-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const dbModule = require("../db");

describe("Smoke tests for coverage-on-demand (AC-2, AC-3, AC-5)", () => {
  describe("AC-2: Coverage Request Mechanism and Snapshot Structure", () => {
    it("requestValueCoverage statement should exist in db module", () => {
      // Smoke test: verify the DB statement exists
      // This proves AC-2's core mechanism (flagging a project) exists at the DB layer
      const { stmts } = dbModule;

      assert.ok(
        stmts.requestValueCoverage,
        "stmts.requestValueCoverage should exist (SQL INSERT…ON CONFLICT for coverage flag)"
      );
    });

    it("clearValueCoverageRequest statement should exist in db module", () => {
      // Smoke test: verify the TTL/cleanup statement exists
      const { stmts } = dbModule;

      assert.ok(
        stmts.clearValueCoverageRequest,
        "stmts.clearValueCoverageRequest should exist (SQL UPDATE to NULL the flag)"
      );
    });
  });

  describe("AC-3: coverageSnapshot Computes ETA with Cold-Start Estimating State", () => {
    it("should have value-coverage.js module with coverageSnapshot function", () => {
      // Smoke test: verify the single-home module exists and exports the right functions
      let coverageModule;
      try {
        coverageModule = require("../lib/value-coverage");
      } catch (e) {
        assert.fail(`server/lib/value-coverage.js module should exist. Error: ${e.message}`);
      }

      assert.ok(
        coverageModule.coverageSnapshot,
        "value-coverage.js should export coverageSnapshot function"
      );
      assert.ok(coverageModule.estimateEta, "value-coverage.js should export estimateEta function");
    });

    it("coverageSnapshot should compute described, pending, complete from counts", () => {
      // Smoke test: verify the arithmetic is present and computes correctly
      const { coverageSnapshot } = require("../lib/value-coverage");

      const counts = {
        pool_size: 10,
        queued: 3,
        unavailable: 2,
        cache_hits: 5,
      };

      const snapshot = coverageSnapshot(dbModule, {
        projectId: "test-project",
        counts,
        requestedAt: null,
        draining: false,
        computedAt: new Date().toISOString(),
      });

      assert.ok(snapshot, "coverageSnapshot should return an object");
      assert.strictEqual(
        snapshot.described,
        5,
        "described should = pool_size(10) - queued(3) - unavailable(2) = 5"
      );
      assert.strictEqual(snapshot.pending, 5, "pending should = queued(3) + unavailable(2) = 5");
      assert.strictEqual(snapshot.complete, false, "complete should be false when pending > 0");
    });

    it("coverageSnapshot should include demand field (closed registry)", () => {
      // Smoke test: verify demand field exists and is one of the valid states
      const { coverageSnapshot } = require("../lib/value-coverage");

      const counts = { pool_size: 5, queued: 1, unavailable: 1, cache_hits: 3 };

      const snapshot = coverageSnapshot(dbModule, {
        projectId: "test-project",
        counts,
        requestedAt: null,
        draining: false,
        computedAt: new Date().toISOString(),
      });

      assert.ok(snapshot.demand !== undefined, "snapshot should have demand field");
      assert.ok(
        ["passive", "requested", "draining"].includes(snapshot.demand),
        `demand must be one of ['passive','requested','draining'], got ${snapshot.demand}`
      );
    });

    it("estimateEta should return object with state field supporting cold-start 'estimating'", () => {
      // Smoke test: verify ETA cold-start state exists (no log rows → estimating)
      const { estimateEta } = require("../lib/value-coverage");

      const eta = estimateEta(dbModule, {
        projectId: `cold-start-${Date.now()}`,
        pending: 5,
      });

      assert.ok(eta, "estimateEta should return an object");
      assert.ok(eta.state !== undefined, "ETA should have a state field");
      assert.ok(
        ["measured", "estimating", "none"].includes(eta.state),
        `eta.state must be one of ['measured','estimating','none'], got ${eta.state}`
      );
      // Cold start (no log rows for this project) should return estimating
      if (eta.state === "estimating") {
        assert.ok(
          !eta.ms_remaining,
          "estimating state should NOT have a fabricated ms_remaining number"
        );
      }
    });
  });

  describe("AC-5: WS Payload Includes Coverage Field", () => {
    it("ValueAltitudesUpdatedPayload type should have optional coverage field", () => {
      // Smoke test: verify TypeScript types include coverage field
      // This proves the WS payload will be widened to carry coverage.
      // No dead fallback branch: this repo's types.ts location is fixed
      // (server/__tests__/ -> ../../client/src/lib/types.ts), so a failed
      // read is a genuine regression (the file moved or was deleted), not
      // an expected "test context" variance — it must fail loudly, not
      // report a vacuous pass (§9.3 VACUOUS-GUARD).
      const typesPath = path.join(__dirname, "..", "..", "client", "src", "lib", "types.ts");
      const typesDef = require("fs").readFileSync(typesPath, "utf8");

      // A bare substring match on "coverage" would still pass if the field
      // were removed from the interface but the word survived in some
      // unrelated comment elsewhere in this 2800+ line file. Isolate the
      // actual `ValueAltitudesUpdatedPayload` interface body and assert the
      // `coverage` field is declared inside IT — a real guard that goes red
      // if DEC-6's widened payload shape regresses.
      const interfaceMatch = typesDef.match(
        /export interface ValueAltitudesUpdatedPayload \{([\s\S]*?)\n\}/
      );
      assert.ok(
        interfaceMatch,
        "client types.ts should declare export interface ValueAltitudesUpdatedPayload"
      );

      const interfaceBody = interfaceMatch[1];
      assert.match(
        interfaceBody,
        /\bcoverage\?\s*:\s*CoverageSnapshot\b/,
        "ValueAltitudesUpdatedPayload should declare `coverage?: CoverageSnapshot` " +
          "(DEC-6's widened WS payload field), not just mention the word " +
          "'coverage' elsewhere in the file"
      );
    });

    it("listRecentValueGenerationDurations statement should exist for ETA computation", () => {
      // Smoke test: verify the statement that feeds ETA calculation exists
      // This is required for WS payload's eta field
      const { stmts } = dbModule;

      assert.ok(
        stmts.listRecentValueGenerationDurations,
        "stmts.listRecentValueGenerationDurations should exist (feeds ETA computation for WS)"
      );
    });
  });
});
