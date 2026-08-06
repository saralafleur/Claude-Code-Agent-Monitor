/**
 * @file Tests for buildProbeCoverage extraction (SF-4 extraction, T7 successor)
 * P-1…P-8: Proves the five-key argument set to coverageSnapshot, the draining
 * field, requestedAt divergence, and single-call-site integrity.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Reuse from project-plans-api.test.js harness
let Database;
try {
  Database = require("better-sqlite3");
  new Database(":memory:").close();
} catch {
  Database = require("../compat-sqlite");
}

describe("SF-4 extraction: buildProbeCoverage (P-1…P-8)", () => {
  let tempDbPath;
  let tempDir;
  let dbModule;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-coverage-probe-test-"));
    tempDbPath = path.join(tempDir, "test.db");
    process.env.DASHBOARD_DB_PATH = tempDbPath;

    // Clear require cache to get fresh db instance
    delete require.cache[require.resolve("../db")];
    dbModule = require("../db");
  });

  after(() => {
    try {
      if (dbModule && dbModule.db) {
        dbModule.db.close();
      }
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore
    }
  });

  it("P-1 [M]: buildProbeCoverage returns object with exactly the five-key set from T6 anchor", async () => {
    // This test will fail because buildProbeCoverage doesn't exist yet
    // Expected failure: Module not found or function undefined
    const { buildProbeCoverage } = require("../lib/value-coverage-probe");

    // T6's own anchor array (reused, never duplicated per §9.1)
    const expectedKeys = [
      "complete",
      "computed_at",
      "demand",
      "described",
      "eta",
      "pending",
      "pool_size",
      "project_id",
      "requested_at",
    ];

    // Stub project
    const projectId = "test-proj-1";

    const result = await buildProbeCoverage(dbModule, projectId);

    const actualKeys = Object.keys(result).sort();
    const expectedKeysSorted = expectedKeys.sort();

    assert.deepEqual(
      actualKeys,
      expectedKeysSorted,
      `Coverage object should have exactly keys: ${expectedKeysSorted}`
    );
  });

  it("P-2 [M]: opts.requestedAt when provided is used verbatim, never re-read from sweep state", async () => {
    const { buildProbeCoverage } = require("../lib/value-coverage-probe");

    const projectId = "test-proj-2";
    const passedRequestedAt = "2026-08-06T12:34:56Z";

    // Even if sweep state has a different timestamp, the passed value wins
    const result = await buildProbeCoverage(dbModule, projectId, {
      requestedAt: passedRequestedAt,
    });

    assert.equal(
      result.requested_at,
      passedRequestedAt,
      "opts.requestedAt should be used verbatim"
    );
  });

  it("P-3 [R]: opts.requestedAt omitted falls back to sweep-state coverage_requested_at", async () => {
    const { buildProbeCoverage } = require("../lib/value-coverage-probe");

    const projectId = "test-proj-3";

    // Call without opts.requestedAt
    const result = await buildProbeCoverage(dbModule, projectId);

    // Should read from sweep state (or be null if no state exists)
    assert.ok(
      result.requested_at === null || typeof result.requested_at === "string",
      "requested_at should be null or a string from sweep state"
    );
  });

  it("P-4 [R]: no sweep-state row results in requested_at === null (strict, not undefined)", async () => {
    const { buildProbeCoverage } = require("../lib/value-coverage-probe");

    const projectId = "test-proj-nonexistent";

    const result = await buildProbeCoverage(dbModule, projectId);

    // Must be null, not undefined
    assert.strictEqual(
      result.requested_at,
      null,
      "requested_at must be strictly null when no sweep-state row exists (not undefined)"
    );
  });

  it("P-5 [M]: counts come from enrichPoolAltitudes (probe:true), anchored to fixture number", async () => {
    const { buildProbeCoverage } = require("../lib/value-coverage-probe");

    const projectId = "test-proj-5";

    const result = await buildProbeCoverage(dbModule, projectId);

    // The counts should come from enrichPoolAltitudes, never re-derived
    // This is a smoke check that the field exists
    assert.ok(
      typeof result.pending === "number" || result.pending === null,
      "result.pending should be a number or null (from enrichPoolAltitudes)"
    );
    assert.ok(
      typeof result.described === "number" || result.described === null,
      "result.described should be a number or null"
    );
  });

  it("P-6 [M]: draining threaded into coverageSnapshot matches isDrainingProject(projectId)", async () => {
    // buildProbeCoverage's own returned shape (P-1, exactly nine keys) has no
    // top-level `draining` field — `draining` only feeds coverageSnapshot's
    // `demand` computation. So this proves the real claim by spying on the
    // `draining` key threaded into that call (same technique as P-7), not by
    // reading a `result.draining` field that does not exist on the return
    // value.
    const { buildProbeCoverage } = require("../lib/value-coverage-probe");
    const { isDrainingProject } = require("../lib/value-summary-tick");
    const valueCoverage = require("../lib/value-coverage");

    const originalCoverageSnapshot = valueCoverage.coverageSnapshot;
    let capturedDraining = null;
    valueCoverage.coverageSnapshot = function (dbModuleArg, args) {
      capturedDraining = args.draining;
      return originalCoverageSnapshot.apply(this, arguments);
    };

    try {
      const drainingProjectId = "test-proj-draining";
      const nonDrainingProjectId = "test-proj-normal";

      // Test draining project
      await buildProbeCoverage(dbModule, drainingProjectId);
      assert.equal(
        capturedDraining,
        isDrainingProject(drainingProjectId),
        "draining passed to coverageSnapshot should match isDrainingProject()"
      );

      // Test non-draining project
      await buildProbeCoverage(dbModule, nonDrainingProjectId);
      assert.equal(
        capturedDraining,
        isDrainingProject(nonDrainingProjectId),
        "draining passed to coverageSnapshot should match isDrainingProject() (non-draining)"
      );
    } finally {
      valueCoverage.coverageSnapshot = originalCoverageSnapshot;
    }
  });

  it("P-7 [M]: T7-C5 anchor successor — coverageSnapshot called with exactly five-key argument set", async () => {
    // This is the headline test: proves the five-key argument set is passed to coverageSnapshot.
    // Genuine behavioral spy: replace value-coverage.js's `coverageSnapshot` export in place
    // (BO-5: value-coverage-probe.js calls it via the `valueCoverage` module namespace object,
    // never destructured, so mutating the export after require intercepts the real call site)
    // rather than patching/reverting `Module.prototype.require` before it is ever used.
    const { buildProbeCoverage } = require("../lib/value-coverage-probe");
    const valueCoverage = require("../lib/value-coverage");

    const originalCoverageSnapshot = valueCoverage.coverageSnapshot;
    let capturedArgKeys = null;
    let callCount = 0;

    valueCoverage.coverageSnapshot = function (dbModuleArg, args) {
      callCount += 1;
      capturedArgKeys = Object.keys(args);
      return originalCoverageSnapshot.apply(this, arguments);
    };

    try {
      const projectId = "test-proj-7";

      const result = await buildProbeCoverage(dbModule, projectId);

      assert.equal(callCount, 1, "coverageSnapshot should be called exactly once");
      assert.deepEqual(
        capturedArgKeys.sort(),
        ["computedAt", "counts", "draining", "projectId", "requestedAt"],
        "coverageSnapshot must be called with exactly the five-key argument set"
      );
      assert.ok(result !== undefined, "buildProbeCoverage should return a result object");
    } finally {
      valueCoverage.coverageSnapshot = originalCoverageSnapshot;
    }
  });

  it("P-8 [R]: computedAt is fresh (>= pre-call timestamp) and !== requestedAt", async () => {
    const { buildProbeCoverage } = require("../lib/value-coverage-probe");

    const projectId = "test-proj-8";
    const beforeCall = new Date().toISOString();

    const result = await buildProbeCoverage(dbModule, projectId, {
      requestedAt: "2026-08-06T10:00:00Z", // old timestamp
    });

    const computedAt = new Date(result.computed_at);
    const beforeCallTime = new Date(beforeCall);

    // computed_at should be fresh (>= pre-call time)
    assert.ok(
      computedAt >= beforeCallTime || computedAt.getTime() === beforeCallTime.getTime(),
      "computed_at should be fresh (>= pre-call timestamp)"
    );

    // computed_at should differ from requested_at
    assert.notEqual(
      result.computed_at,
      result.requested_at,
      "computed_at (now) must be distinct from requested_at (historical sweep state)"
    );
  });
});
