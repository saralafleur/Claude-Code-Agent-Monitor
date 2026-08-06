/**
 * @file Tests for mechanicalPreGroup function: signal clustering, determinism, over-generation
 * M-1…M-9: Pure function specs for slug/time/surface signal clustering
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const path = require("path");
const os = require("os");
// BL-3: this file never touches the DB (mechanicalPreGroup/unitKey are pure
// functions, and value-groups.js itself no longer carries a module-scope
// `require("../db")` singleton) — but every other test file in this suite
// sets DASHBOARD_DB_PATH defensively before its first require, and this one
// does too, so a future edit that DOES add a db-touching assertion here can
// never silently fall through to the real production DB.
process.env.DASHBOARD_DB_PATH =
  process.env.DASHBOARD_DB_PATH ||
  path.join(os.tmpdir(), `value-groups-mechanical-test-${Date.now()}-${process.pid}.db`);

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
// unitKey() always appends `::${cwd || ""}` (server/lib/value-ledger.js) —
// a 3-segment key even when cwd is absent. Build expected keys via the
// real function rather than hand-typing 2-segment literals that can drift.
const { unitKey } = require("../lib/value-ledger");

describe("Mechanical Pre-grouping (M-1…M-9)", () => {
  it("M-1 [R]: Slug signal creates exactly one cluster with matching initiative+commit pair", () => {
    const { mechanicalPreGroup } = require("../lib/value-groups");

    // This will fail: module doesn't exist yet
    const units = [
      {
        value_source: "intake_initiative",
        value_ref: "init-123",
        label: "Database schema improvements",
        project_level: "focus",
      },
      {
        value_source: "trunk_commit",
        value_ref: "c123456",
        subject: "feat(db): Database schema improvements for grouping",
        project_level: "focus",
      },
      {
        value_source: "trunk_commit",
        value_ref: "c999999",
        subject: "fix(client): Unrelated commit",
        project_level: "focus",
      },
    ];

    const result = mechanicalPreGroup(units);

    // Find slug signal cluster
    const slugCluster = result.clusters.find((c) => c.signal === "slug");
    assert.ok(slugCluster, "Should have a slug signal cluster");

    // Should contain exactly the initiative and matching commit
    const expectedKeys = [
      unitKey("intake_initiative", "init-123"),
      unitKey("trunk_commit", "c123456"),
    ].sort();
    const actualKeys = slugCluster.memberUnitKeys.sort();

    assert.deepEqual(
      actualKeys,
      expectedKeys,
      "Slug cluster should contain exactly the matching initiative+commit pair"
    );

    // Unrelated commit should NOT be in the slug cluster
    assert.ok(
      !slugCluster.memberUnitKeys.includes(unitKey("trunk_commit", "c999999")),
      "Unrelated commit should not be in slug cluster"
    );
  });

  it("M-2 [R]: Time signal clusters units on same localDayLabel", () => {
    const { mechanicalPreGroup } = require("../lib/value-groups");

    const units = [
      {
        value_source: "trunk_commit",
        value_ref: "c111",
        seen_at: "2026-08-06T09:15:00Z",
      },
      {
        value_source: "trunk_commit",
        value_ref: "c222",
        seen_at: "2026-08-06T18:45:00Z",
      },
      {
        value_source: "trunk_commit",
        value_ref: "c333",
        seen_at: "2026-08-07T10:00:00Z", // different day
      },
    ];

    const result = mechanicalPreGroup(units);

    // Find time signal cluster
    const timeCluster = result.clusters.find((c) => c.signal === "time");
    assert.ok(timeCluster, "Should have a time signal cluster");

    // Should contain only same-day units
    const timeMembers = timeCluster.memberUnitKeys;
    assert.ok(
      timeMembers.includes(unitKey("trunk_commit", "c111")),
      "Same-day unit c111 should be in time cluster"
    );
    assert.ok(
      timeMembers.includes(unitKey("trunk_commit", "c222")),
      "Same-day unit c222 should be in time cluster"
    );

    // Different-day unit should NOT be in this cluster
    assert.ok(
      !timeMembers.includes(unitKey("trunk_commit", "c333")),
      "Different-day unit c333 should NOT be in time cluster"
    );
  });

  it("M-3 [R]: Units without seen_at are counted in signalAudit.time.units_without_timestamp", () => {
    const { mechanicalPreGroup } = require("../lib/value-groups");

    const units = [
      { value_source: "trunk_commit", value_ref: "c1", seen_at: "2026-08-06T10:00:00Z" },
      { value_source: "trunk_commit", value_ref: "c2" }, // no seen_at
      { value_source: "trunk_commit", value_ref: "c3" }, // no seen_at
      { value_source: "intake_initiative", value_ref: "init1" }, // no seen_at
    ];

    const result = mechanicalPreGroup(units);

    // Should count exactly 3 units without timestamp
    assert.equal(
      result.signalAudit.time.units_without_timestamp,
      3,
      "Should count exactly 3 units without seen_at (not > 0, not 2)"
    );
  });

  it("M-4 [R]: Surface signal (label/path substring) produces expected membership", () => {
    const { mechanicalPreGroup } = require("../lib/value-groups");

    const units = [
      { value_source: "trunk_commit", value_ref: "c1", label: "database: schema update" },
      { value_source: "trunk_commit", value_ref: "c2", label: "database: migration script" },
      { value_source: "trunk_commit", value_ref: "c3", label: "client: UI fix" },
    ];

    const result = mechanicalPreGroup(units);

    // Find surface signal cluster with "database" in it
    const surfaceClusters = result.clusters.filter((c) => c.signal === "surface");
    assert.ok(surfaceClusters.length > 0, "Should have surface signal clusters");

    // At least one cluster should contain both database units
    const hasBothDatabaseUnits = surfaceClusters.some(
      (c) =>
        c.memberUnitKeys.includes(unitKey("trunk_commit", "c1")) &&
        c.memberUnitKeys.includes(unitKey("trunk_commit", "c2"))
    );
    assert.ok(hasBothDatabaseUnits, "Should cluster database units together by surface");
  });

  it("M-5 [M]: Over-generation by design — unit in both slug AND time appears in both clusters", () => {
    const { mechanicalPreGroup } = require("../lib/value-groups");

    const units = [
      {
        value_source: "intake_initiative",
        value_ref: "init-shared",
        label: "Project X",
        seen_at: "2026-08-06T12:00:00Z",
      },
      {
        value_source: "trunk_commit",
        value_ref: "c-shared",
        subject: "feat: Project X implementation",
        seen_at: "2026-08-06T12:30:00Z",
      },
    ];

    const result = mechanicalPreGroup(units);

    // Both units satisfy slug (matching) AND time (same day) signals
    const slugCluster = result.clusters.find((c) => c.signal === "slug");
    const timeCluster = result.clusters.find((c) => c.signal === "time");

    assert.ok(slugCluster, "Should have slug cluster");
    assert.ok(timeCluster, "Should have time cluster");

    // The commit should appear in BOTH clusters (over-generation by design)
    const commitKey = unitKey("trunk_commit", "c-shared");
    assert.ok(slugCluster.memberUnitKeys.includes(commitKey), "Commit should be in slug cluster");
    assert.ok(
      timeCluster.memberUnitKeys.includes(commitKey),
      "Commit should also be in time cluster (over-generation by design)"
    );
  });

  it("M-6 [R]: Determinism — two calls with shuffled input produce identical sorted output", () => {
    const { mechanicalPreGroup } = require("../lib/value-groups");

    const units = [
      { value_source: "trunk_commit", value_ref: "c1", label: "feat: A" },
      { value_source: "trunk_commit", value_ref: "c2", label: "fix: B" },
      { value_source: "trunk_commit", value_ref: "c3", label: "feat: A related" },
    ];

    const result1 = mechanicalPreGroup(units);
    const result2 = mechanicalPreGroup([...units].reverse());

    // Sort both by clusterId
    const sorted1 = result1.clusters.map((c) => c.clusterId).sort();
    const sorted2 = result2.clusters.map((c) => c.clusterId).sort();

    assert.deepEqual(
      sorted1,
      sorted2,
      "Sorted cluster IDs should be identical regardless of input order"
    );
  });

  it("M-7 [R]: clusterId is byte-identical across multiple calls (stable hash)", () => {
    const { mechanicalPreGroup } = require("../lib/value-groups");

    const units = [
      { value_source: "trunk_commit", value_ref: "c1", label: "feat: feature" },
      { value_source: "trunk_commit", value_ref: "c2", label: "feat: feature related" },
    ];

    const result1 = mechanicalPreGroup(units);
    const result2 = mechanicalPreGroup([...units]);

    const clusterIds1 = result1.clusters.map((c) => c.clusterId).sort();
    const clusterIds2 = result2.clusters.map((c) => c.clusterId).sort();

    assert.deepEqual(
      clusterIds1,
      clusterIds2,
      "clusterId should be byte-identical (stable hash, not insertion order)"
    );
  });

  it("M-8 [N]: File-level invariant — mechanicalPreGroup takes zero spawn/db mocks (stated in comment)", () => {
    // This is a reviewer-checked invariant, not a runtime assertion
    // It verifies that the function is pure (no side effects)

    const { mechanicalPreGroup } = require("../lib/value-groups");

    // Just verify the function exists and is callable
    assert.ok(typeof mechanicalPreGroup === "function", "mechanicalPreGroup should be a function");

    // Verify it's pure by checking it doesn't require spawn/db
    const source = mechanicalPreGroup.toString();
    assert.ok(
      !source.includes("spawn") && !source.includes("exec") && !source.includes("dbModule"),
      "Function body should not contain spawn/db references (pure function guarantee)"
    );
  });

  it("M-9 [R]: Completeness — isolated unit lands in ungrouped with reason 'no_shared_signal'", () => {
    const { mechanicalPreGroup } = require("../lib/value-groups");

    const units = [
      {
        value_source: "trunk_commit",
        value_ref: "c1",
        label: "Generic feature",
        seen_at: "2026-08-06T12:00:00Z",
      },
      { value_source: "trunk_commit", value_ref: "c-isolated" }, // no label, no seen_at, no matching initiative
    ];

    const result = mechanicalPreGroup(units);

    // Isolated unit should be in ungrouped
    const ungroupedUnitKey = unitKey("trunk_commit", "c-isolated");
    const ungroupedEntry = result.ungrouped.find((u) => u.unitKey === ungroupedUnitKey);

    assert.ok(ungroupedEntry, "Isolated unit should be in ungrouped");
    assert.equal(
      ungroupedEntry.reason,
      "no_shared_signal",
      "Isolated unit should have reason 'no_shared_signal'"
    );

    // Verify completeness: every input unit appears in a cluster OR ungrouped
    const clusteredKeys = result.clusters.flatMap((c) => c.memberUnitKeys);
    const ungroupedKeys = result.ungrouped.map((u) => u.unitKey);
    const allAccounted = [...clusteredKeys, ...ungroupedKeys];

    const inputKeys = units.map((u) => unitKey(u.value_source, u.value_ref, u.source_cwd));
    for (const key of inputKeys) {
      assert.ok(allAccounted.includes(key), `Unit ${key} should appear in a cluster or ungrouped`);
    }
  });
});
