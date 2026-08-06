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
    // SF-7 (§9.3 VACUOUS-GUARD): the two cases this replaced only asserted
    // `stmts.requestValueCoverage`/`stmts.clearValueCoverageRequest` EXIST —
    // true even if the SQL behind them were a no-op. This is a real
    // round-trip: write via the actual statement, read back via the actual
    // statement, assert the exact value survived. The real AC-2 mechanism
    // (the full request -> drain -> HTTP/WS flow) is proven end-to-end in
    // `project-plans-api.test.js` T3.
    it("requestValueCoverage round-trip: written value is read back exactly", () => {
      const { stmts } = dbModule;
      stmts.requestValueCoverage.run("test-proj-123", "2026-08-05T14:32:00.000Z");
      const row = stmts.getValueSweepState.get("test-proj-123");
      assert.equal(row.coverage_requested_at, "2026-08-05T14:32:00.000Z");
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

    // SF-7 (§9.3 VACUOUS-GUARD): the "demand field (closed registry)" case
    // this replaced only asserted `snapshot.demand` was in a HAND-TYPED
    // three-value list — a copy of the registry, not a read of it. The real,
    // exact-exemption-closed guard against the actual `DEMAND_STATES`/
    // `ETA_STATES` registries lives in `value-coverage.test.js`'s G1b block
    // (and N2's exact-exemption assertion for the locale-key side of it).

    // SF-7: replaced the CONDITIONAL form ("if (eta.state === 'estimating')
    // ...") with the unconditional form the case's own title already
    // promised — a conditional assertion inside an `if` that might never
    // run is a silent pass, not a guard (§9.3). This fixture (pending > 0,
    // zero qualifying log rows for a fresh project id) deterministically
    // produces `estimating`, so asserting it unconditionally is honest, not
    // fragile.
    it("estimateEta ETA state when pending > 0 but zero qualifying log rows", () => {
      const { estimateEta } = require("../lib/value-coverage");

      const eta = estimateEta(dbModule, {
        projectId: `cold-start-${Date.now()}`,
        pending: 5,
      });

      assert.equal(eta.state, "estimating");
      assert.equal(eta.ms_remaining, undefined);
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

    // SF-7 (§9.3 VACUOUS-GUARD): the "listRecentValueGenerationDurations
    // statement should exist" case this replaced only asserted the
    // statement object was truthy — true even if its SQL never returned a
    // usable row. The real ETA-arithmetic proof (that this statement's
    // output actually drives `estimateEta`'s `measured`/`estimating`
    // branches) lives in `value-coverage.test.js`'s `estimateEta` block.
  });
});
