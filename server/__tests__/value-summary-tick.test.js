/**
 * @file Tests for the value-summary background tick:
 * server/lib/value-summary-tick.js's sweep cycle (overlap guard, per-tick bound,
 * least-recently-swept rotation, generation metrics, failure isolation,
 * environment wiring), the pending_after_sweep re-derivation (§9.3 MANDATORY),
 * and integration with enrichPoolAltitudes for overflow drain (AC-1).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-value-summary-tick-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const dbModule = require("../db");
const { db, stmts } = dbModule;
const {
  runValueSummaryTickOnce,
  listSweepTargets,
  __injectPoolAssemblerForTest,
  __resetTickStateForTest,
} = require("../lib/value-summary-tick");
const { __injectSpawnForTest } = require("../lib/focus-inference");
const { assembleValuePool } = require("../lib/value-ledger");

let nextProjectSuffix = 0;

// Test helpers
function unit(overrides = {}) {
  return {
    unitKey: "trunk_commit::test::/repo",
    value_source: "trunk_commit",
    value_ref: "test",
    label: "Test unit",
    stage: null,
    ...overrides,
  };
}

async function makeSweptProject(name, { lastSweptAt = null } = {}) {
  nextProjectSuffix += 1;
  const id = `tick-test-${Date.now()}-${process.pid}-${nextProjectSuffix}`;
  stmts.insertProject.run(id, name || id);
  // Each project must have a unique cwd in project_paths (UNIQUE constraint)
  stmts.insertProjectPath.run(id, `/test/path-${nextProjectSuffix}`);
  if (lastSweptAt) {
    stmts.upsertValueSweepState.run(id, lastSweptAt, 0);
  }
  return id;
}

function makeUnits(n, { prefix = "u" } = {}) {
  return Array.from({ length: n }, (_, i) =>
    unit({ unitKey: `trunk_commit::${prefix}${i}::/repo`, value_ref: `${prefix}${i}` })
  );
}

function fakeSpawn({ exitCode = 0, stdout = "" } = {}) {
  return () => {
    const { EventEmitter } = require("node:events");
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.resume = () => {};
    child.kill = () => {};
    setImmediate(() => {
      if (stdout) child.stdout.emit("data", stdout);
      child.emit("exit", exitCode);
    });
    return child;
  };
}

function envelope(result) {
  return JSON.stringify({ result: JSON.stringify(result) });
}

function spawnResolvingFirst(n) {
  return () => {
    const spawn = fakeSpawn({
      stdout: envelope({
        units: Array.from({ length: n }, (_, i) => ({
          index: i + 1,
          project: `P${i + 1}`,
          stakeholder: `S${i + 1}`,
        })),
      }),
    });
    return spawn();
  };
}

function lastLogRow(projectId) {
  return db
    .prepare(
      "SELECT * FROM value_summary_generation_log WHERE project_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(projectId);
}

function sweepState(projectId) {
  return db.prepare("SELECT * FROM value_summary_sweep_state WHERE project_id = ?").get(projectId);
}

before(() => {
  // Setup database (schema should be created by db module)
});

after(() => {
  __injectSpawnForTest(null);
  __injectPoolAssemblerForTest(null);
  __resetTickStateForTest();
  try {
    db.close();
  } catch {
    /* already closed */
  }
});

beforeEach(() => {
  __injectSpawnForTest(null);
  __injectPoolAssemblerForTest(null);
  __resetTickStateForTest();
  delete process.env.DASHBOARD_VALUE_SUMMARY_TICK_MODE;
  delete process.env.DASHBOARD_VALUE_SUMMARY_TICK_MS;
  delete process.env.MAX_PROJECTS_PER_TICK;
  db.exec("DELETE FROM value_unit_summaries");
  db.exec("DELETE FROM value_summary_sweep_state");
  db.exec("DELETE FROM value_summary_generation_log");
  db.exec("DELETE FROM project_paths");
  db.exec("DELETE FROM projects");
});

describe("value-summary-tick: overlap guard (§9.3 RED mutation required)", () => {
  it("a second concurrent call returns { skipped: 'overlap' } without incrementing spawn count", async () => {
    const projectId = await makeSweptProject("overlap test");
    let assemblerCount = 0;
    __injectPoolAssemblerForTest(async () => {
      assemblerCount++;
      // Defer resolution so both calls can overlap
      return new Promise((resolve) => {
        setTimeout(() => resolve({ units: makeUnits(5), identityWarnings: [] }), 50);
      });
    });

    __injectSpawnForTest(spawnResolvingFirst(3));

    // Start first tick
    const first = runValueSummaryTickOnce(dbModule, { now: new Date().toISOString() });
    // Before first completes, start second
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await runValueSummaryTickOnce(dbModule, { now: new Date().toISOString() });

    // Second should be skipped
    assert.deepEqual(second, { skipped: "overlap" });

    // Wait for first to complete
    await first;

    // Only one assembler call should have happened
    assert.equal(assemblerCount, 1, "assembler called only once despite concurrency");
  });
});

describe("value-summary-tick: per-tick bound", () => {
  it("respects MAX_PROJECTS_PER_TICK environment variable", async () => {
    process.env.MAX_PROJECTS_PER_TICK = "2";
    const projects = await Promise.all([
      makeSweptProject("p1"),
      makeSweptProject("p2"),
      makeSweptProject("p3"),
      makeSweptProject("p4"),
      makeSweptProject("p5"),
    ]);

    __injectPoolAssemblerForTest(async () => ({ units: makeUnits(5), identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(5));

    const result = await runValueSummaryTickOnce(dbModule, {});

    assert.equal(result.swept, 2, "exactly 2 projects swept despite 5 eligible");
    const logRows = db.prepare("SELECT project_id FROM value_summary_generation_log").all();
    assert.equal(logRows.length, 2, "2 log rows created");
  });
});

describe("value-summary-tick: least-recently-swept rotation (§9.2)", () => {
  it("sweeps projects in order: never swept, old, recent", async () => {
    const now = new Date();
    const pNever = await makeSweptProject("never");
    const pOld = await makeSweptProject("old", {
      lastSweptAt: new Date(now.getTime() - 7 * 86400_000).toISOString(),
    });
    const pRecent = await makeSweptProject("recent", {
      lastSweptAt: new Date(now.getTime() - 1 * 86400_000).toISOString(),
    });

    const targets = listSweepTargets(dbModule, 10);
    const targetIds = targets.map((t) => t.project_id);

    assert.deepEqual(
      targetIds,
      [pNever, pOld, pRecent],
      "rotation order: never swept first, then oldest, then most recent"
    );

    // Also test starvation-free by doing 3 sequential single-project ticks
    __injectPoolAssemblerForTest(async () => ({ units: makeUnits(1), identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(1));

    for (let i = 0; i < 3; i++) {
      await runValueSummaryTickOnce(dbModule, { now: new Date().toISOString() });
    }

    // Verify all 3 were swept
    const allLogs = db
      .prepare("SELECT DISTINCT project_id FROM value_summary_generation_log")
      .all();
    assert.equal(allLogs.length, 3, "all 3 projects swept in 3 separate ticks");
  });
});

describe("value-summary-tick: overflow drain (45 units across 2 ticks, AC-1)", () => {
  it("tick 1: 45 units, 0 cached, 40 generated → pending_after_sweep = 5", async () => {
    const projectId = await makeSweptProject("drain test");
    const units = makeUnits(45);

    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(40));

    const result = await runValueSummaryTickOnce(dbModule, {});

    const logRow = lastLogRow(projectId);
    assert.equal(logRow.pool_size, 45);
    assert.equal(logRow.cache_hits, 0);
    assert.equal(logRow.generated, 40);
    assert.equal(logRow.queued, 5);
    assert.equal(logRow.unavailable, 0);
    assert.equal(
      logRow.cache_hits + logRow.generated + logRow.queued + logRow.unavailable,
      logRow.pool_size,
      "four-term partition must sum to pool_size"
    );
    assert.equal(sweepState(projectId).pending_after_sweep, 5);
  });

  it("tick 2: same 45 units, now 40 cached, 5 generated → pending_after_sweep = 0", async () => {
    const projectId = await makeSweptProject("drain test 2");
    const units = makeUnits(45);

    // Tick 1
    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(40));
    await runValueSummaryTickOnce(dbModule, {});

    // Tick 2: same pool, now 40 are cached
    __injectSpawnForTest(spawnResolvingFirst(5));
    await runValueSummaryTickOnce(dbModule, {});

    const logRow = lastLogRow(projectId);
    assert.equal(logRow.pool_size, 45);
    assert.equal(logRow.cache_hits, 40);
    assert.equal(logRow.generated, 5);
    assert.equal(logRow.queued, 0);
    assert.equal(logRow.unavailable, 0);
    assert.equal(
      logRow.cache_hits + logRow.generated + logRow.queued + logRow.unavailable,
      logRow.pool_size,
      "four-term partition must sum to pool_size"
    );
    assert.equal(sweepState(projectId).pending_after_sweep, 0);
  });

  it("database preserves all 45 units after 2 ticks", async () => {
    const projectId = await makeSweptProject("drain db test");
    const units = makeUnits(45);

    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(40));
    await runValueSummaryTickOnce(dbModule, {});

    __injectSpawnForTest(spawnResolvingFirst(5));
    await runValueSummaryTickOnce(dbModule, {});

    const count = db.prepare("SELECT COUNT(*) as count FROM value_unit_summaries").get().count;
    assert.equal(count, 45, "all 45 units in database");
  });
});

describe("value-summary-tick: broadcast discipline", () => {
  it("generates sweep broadcasts exactly one value_altitudes_updated with correct payload", async () => {
    const projectId = await makeSweptProject("broadcast test");
    const units = makeUnits(5);
    const broadcasts = [];

    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(3));

    await runValueSummaryTickOnce(dbModule, {
      broadcast: (type, payload) => broadcasts.push({ type, payload }),
    });

    assert.equal(broadcasts.length, 1, "exactly one broadcast");
    assert.equal(broadcasts[0].type, "value_altitudes_updated");
    assert.ok(broadcasts[0].payload.project_id);
    assert.ok(Array.isArray(broadcasts[0].payload.unit_keys));
    assert.ok(typeof broadcasts[0].payload.pending === "number");
  });

  it("all-cached sweep sends zero broadcasts", async () => {
    const projectId = await makeSweptProject("cache test");
    const units = makeUnits(3);

    // Pre-cache all units
    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(3));
    await runValueSummaryTickOnce(dbModule, { broadcast: () => {} });

    // Second sweep: all cached
    const broadcasts = [];
    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    await runValueSummaryTickOnce(dbModule, {
      broadcast: (type, payload) => broadcasts.push({ type, payload }),
    });

    assert.equal(broadcasts.length, 0, "zero broadcasts for all-cached sweep");
  });

  it("LLM-off sweep sends zero broadcasts", async () => {
    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
    const projectId = await makeSweptProject("llm-off test");
    const units = makeUnits(3);

    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));

    const broadcasts = [];
    await runValueSummaryTickOnce(dbModule, {
      broadcast: (type, payload) => broadcasts.push({ type, payload }),
    });
    delete process.env.DASHBOARD_FOCUS_INFER_MODE;

    assert.equal(broadcasts.length, 0, "zero broadcasts when LLM is off");
  });
});

describe("value-summary-tick: failure isolation", () => {
  it("one project failure does not prevent others in the same tick", async () => {
    const pGood = await makeSweptProject("good");
    const pBad = await makeSweptProject("bad");

    const pools = {};
    pools[pGood] = makeUnits(3);
    pools[pBad] = null; // Will cause assembly to fail

    __injectPoolAssemblerForTest(async (dbModule, { id: projectId }) => {
      if (!pools[projectId]) {
        throw new Error(`assembly failed for ${projectId}`);
      }
      return { units: pools[projectId], identityWarnings: [] };
    });

    __injectSpawnForTest(spawnResolvingFirst(2));

    await runValueSummaryTickOnce(dbModule, {});

    const badLog = lastLogRow(pBad);
    assert.equal(badLog.outcome, "error", "failed project logged with error outcome");
    assert.ok(badLog.project_id === pBad);

    const goodLog = lastLogRow(pGood);
    assert.equal(goodLog.outcome, "ok", "successful project logged with ok outcome");

    const badState = sweepState(pBad);
    assert.ok(badState.last_swept_at, "failed project still advances sweep rotation");
  });
});

describe("value-summary-tick: DEC-16 structural scan", () => {
  it("tick imports assembleValuePool from value-ledger and has no hand-rolled pool SQL", () => {
    // Read the source file and verify it conforms to DEC-16's single-composer rule
    const tickSourcePath = require.resolve("../lib/value-summary-tick");
    const source = fs.readFileSync(tickSourcePath, "utf8");
    // Strip comments and whitespace to avoid false positives in doc comments
    const stripped = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");

    // Must import assembleValuePool from value-ledger
    assert.ok(stripped.includes('require("./value-ledger")'), "tick must import from value-ledger");
    assert.ok(
      stripped.includes("assembleValuePool"),
      "tick must use assembleValuePool from value-ledger"
    );

    // Must NOT contain hand-rolled pool-membership queries
    const forbiddenPatterns = [
      /FROM\s+project_paths/i,
      /FROM\s+detour_dispositions/i,
      /detectTrunkDrift/i,
      /upsertValueUnitSummary/i, // that's enrichPoolAltitudes' job, not ours
    ];
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(stripped),
        `tick source must not contain '${pattern.source}' (violates DEC-16 single-composer rule)`
      );
    }
  });
});

describe("value-summary-tick: environment wiring", () => {
  it("with mode enabled (default), timer registration happens on start", async () => {
    // Positive control: when enabled, setTimeout MUST be called
    delete process.env.DASHBOARD_VALUE_SUMMARY_TICK_MODE;
    delete process.env.DASHBOARD_VALUE_SUMMARY_TICK_MS;

    const setTimeoutCalls = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = function (...args) {
      setTimeoutCalls.push(args);
      return originalSetTimeout(...args);
    };

    try {
      const { startValueSummaryTick } = require("../lib/value-summary-tick");
      startValueSummaryTick(() => {});

      assert.ok(
        setTimeoutCalls.length > 0,
        "setTimeout MUST be called when tick mode is enabled (positive control)"
      );
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it("DASHBOARD_VALUE_SUMMARY_TICK_MODE=off prevents timer registration", async () => {
    process.env.DASHBOARD_VALUE_SUMMARY_TICK_MODE = "off";

    const setTimeoutCalls = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = function (...args) {
      setTimeoutCalls.push(args);
      return originalSetTimeout(...args);
    };

    try {
      // Clear the module cache to force a fresh require with the new env var
      delete require.cache[require.resolve("../lib/value-summary-tick")];
      const { startValueSummaryTick } = require("../lib/value-summary-tick");
      startValueSummaryTick(() => {});

      assert.equal(
        setTimeoutCalls.length,
        0,
        "setTimeout must NOT be called when DASHBOARD_VALUE_SUMMARY_TICK_MODE=off"
      );
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it("DASHBOARD_VALUE_SUMMARY_TICK_MS=0 prevents timer registration", async () => {
    process.env.DASHBOARD_VALUE_SUMMARY_TICK_MS = "0";

    const setTimeoutCalls = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = function (...args) {
      setTimeoutCalls.push(args);
      return originalSetTimeout(...args);
    };

    try {
      // Clear the module cache to force a fresh require with the new env var
      delete require.cache[require.resolve("../lib/value-summary-tick")];
      const { startValueSummaryTick } = require("../lib/value-summary-tick");
      startValueSummaryTick(() => {});

      assert.equal(
        setTimeoutCalls.length,
        0,
        "setTimeout must NOT be called when DASHBOARD_VALUE_SUMMARY_TICK_MS=0"
      );
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });
});

describe("value-summary-tick: T-C instrument (pending_after_sweep re-derived, not decremented)", () => {
  it("pool grows 85→88; pending_after_sweep re-derived to 8 (not cached 5)", async () => {
    const projectId = await makeSweptProject("t-c test");

    // Tick 1: 85 units, cap binds (85 misses)
    const base = makeUnits(85);
    __injectPoolAssemblerForTest(async () => ({ units: base, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(40));
    await runValueSummaryTickOnce(dbModule, {});

    const log1 = lastLogRow(projectId);
    assert.equal(log1.pool_size, 85);
    assert.equal(log1.cache_hits, 0);
    assert.equal(log1.generated, 40);
    assert.equal(log1.queued, 45);
    assert.equal(log1.unavailable, 0);
    assert.equal(log1.cache_hits + log1.generated + log1.queued + log1.unavailable, log1.pool_size);
    assert.equal(sweepState(projectId).pending_after_sweep, 45);

    // Tick 2: 3 new units arrive (85→88), cap still binds (40 cache hits + 40 generated = 80, 8 miss)
    const expanded = base.concat(makeUnits(3, { prefix: "arrival" }));
    __injectPoolAssemblerForTest(async () => ({ units: expanded, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(40));
    await runValueSummaryTickOnce(dbModule, {});

    const log2 = lastLogRow(projectId);
    assert.equal(log2.pool_size, 88, "pool_size re-read from live pool (not cached)");
    assert.equal(log2.cache_hits, 40);
    assert.equal(log2.generated, 40);
    assert.equal(log2.queued, 8);
    assert.equal(log2.unavailable, 0);
    assert.equal(log2.cache_hits + log2.generated + log2.queued + log2.unavailable, log2.pool_size);
    assert.equal(
      sweepState(projectId).pending_after_sweep,
      8,
      "pending_after_sweep = 8 (re-derived). A decremented counter reads 5; a stale pool_size also reads 5. Neither is 8."
    );
    assert.equal(
      sweepState(projectId).pending_after_sweep,
      log2.queued + log2.unavailable,
      "pending_after_sweep is exactly the queued + unavailable set"
    );
  });
});

describe("value-summary-tick: B2 blocker fix (errored sweep preserves pending_after_sweep)", () => {
  it("a failed sweep does not clobber pending_after_sweep with 0; it preserves the last known-good value", async () => {
    const projectId = await makeSweptProject("b2-failure-test");

    // First, do a successful sweep to establish a non-zero pending_after_sweep
    const units45 = makeUnits(45);
    __injectPoolAssemblerForTest(async () => ({ units: units45, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(40));
    await runValueSummaryTickOnce(dbModule, {});

    const firstState = sweepState(projectId);
    assert.equal(firstState.pending_after_sweep, 5, "first sweep sets pending to 5");
    const firstSweptAt = firstState.last_swept_at;

    // Now inject a failure in the pool assembler for the NEXT tick
    __injectPoolAssemblerForTest(async (db, { id }) => {
      if (id === projectId) {
        throw new Error("assembly failed: repo locked");
      }
      return { units: [], identityWarnings: [] };
    });

    // Do the tick again — the assembler will throw
    await runValueSummaryTickOnce(dbModule, {});

    // Check sweep_state: pending_after_sweep MUST still be 5 (preserved),
    // but last_swept_at MUST have advanced
    const secondState = sweepState(projectId);
    assert.equal(
      secondState.pending_after_sweep,
      5,
      "failed sweep preserves pending_after_sweep (not zeroed)"
    );
    assert.notEqual(
      secondState.last_swept_at,
      firstSweptAt,
      "failed sweep still advances last_swept_at (rotation advances)"
    );

    // Also verify the log row has outcome='error'
    const logRow = lastLogRow(projectId);
    assert.equal(logRow.outcome, "error", "failed sweep logged with error outcome");
  });

  it("a failed sweep that already has pending_after_sweep > 0 keeps that value, not zeroed", async () => {
    // B2 blocker: without the upsertValueSweepStateKeepPending fix, a failed
    // sweep would overwrite pending_after_sweep with 0, indistinguishable from
    // "fully drained." This test proves the fix preserves the last-known-good.
    const projectId = await makeSweptProject("b2-preserve-test", {
      lastSweptAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    // Pre-set pending_after_sweep to 10 (simulating a prior sweep that left
    // 10 queued)
    db.prepare(
      "UPDATE value_summary_sweep_state SET pending_after_sweep = 10 WHERE project_id = ?"
    ).run(projectId);

    // Now fail the sweep
    __injectPoolAssemblerForTest(async () => {
      throw new Error("git lock");
    });

    await runValueSummaryTickOnce(dbModule, {});

    // pending_after_sweep should still be 10, not zeroed to 0
    const state = sweepState(projectId);
    assert.equal(state.pending_after_sweep, 10, "pending_after_sweep preserved on failed sweep");
  });
});

describe("value-summary-tick: S1 should-fix (sweep rotation advances even on bookkeeping failure)", () => {
  it("rotation timestamp advances even if the audit-log write fails", async () => {
    const projectId = await makeSweptProject("s1-rotation-test");
    const units3 = makeUnits(3);

    // First successful sweep
    __injectPoolAssemblerForTest(async () => ({ units: units3, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(2));
    await runValueSummaryTickOnce(dbModule, {});

    const firstState = sweepState(projectId);
    const firstSweptAt = firstState.last_swept_at;
    assert.ok(firstSweptAt, "first sweep set last_swept_at");

    // Now inject a write failure in the audit-log insert by monkey-patching
    const originalRun = stmts.insertValueSummaryGeneration.run;
    let callCount = 0;
    stmts.insertValueSummaryGeneration.run = function (...args) {
      callCount++;
      throw new Error("SQLITE_BUSY");
    };

    try {
      __injectPoolAssemblerForTest(async () => ({ units: units3, identityWarnings: [] }));
      __injectSpawnForTest(spawnResolvingFirst(2));
      // This will fail on the audit-log insert
      await runValueSummaryTickOnce(dbModule, {});
      assert.ok(callCount > 0, "audit-log insert was attempted");
    } finally {
      stmts.insertValueSummaryGeneration.run = originalRun;
    }

    // Despite the audit-log write failing, last_swept_at MUST still advance
    const secondState = sweepState(projectId);
    assert.notEqual(
      secondState.last_swept_at,
      firstSweptAt,
      "rotation timestamp advanced despite audit-log write failure (S1 fix)"
    );
  });
});

describe("value-summary-tick: S6 should-fix (duplicate unitKey deduped)", () => {
  it("duplicate unitKey spanning the cap boundary lands in exactly one map", async () => {
    // S6 blocker: if the caller passes a duplicate unitKey that straddles the
    // 40-cap, the old (undeduped) code puts the IN-BATCH copy through the LLM
    // (landing in `altitudes`) while the OVERFLOW copy independently gets
    // marked "queued" in `states` — the same key in BOTH maps. Resolving
    // ALL 40 batch slots (not just 39) is what actually exercises this: if
    // fewer than 40 resolve, the dup's batch copy goes unresolved and lands
    // in `states` too (same object key, last write wins) — which makes the
    // "never both" assertion pass trivially regardless of dedup. That was
    // this test's original bug: it never actually proved the fix.
    const { enrichPoolAltitudes } = require("../lib/value-summary");

    const unique39 = makeUnits(39);
    const dup = unit({ unitKey: "trunk_commit::dup::/repo", value_ref: "dup" });
    // 41 items, "dup"'s key appears TWICE — once in what would be the
    // in-batch slice (index 39), once in what would be the overflow slice
    // (index 40) if the caller's list were sliced without deduping first.
    const misses = [...unique39, dup, dup];

    // Resolve all 40 batch slots (1-based indices 1-40) so, absent dedup,
    // the dup's in-batch copy genuinely resolves into `altitudes` while its
    // overflow copy independently lands in `states` as "queued".
    __injectSpawnForTest(spawnResolvingFirst(40));

    const { altitudes, states } = await enrichPoolAltitudes(dbModule, misses);

    const dupInAlt = dup.unitKey in altitudes;
    const dupInStates = dup.unitKey in states;

    assert.ok(
      dupInAlt !== dupInStates,
      "duplicate unitKey appears in exactly one of altitudes/states, never both"
    );
    // With dedup, all 40 distinct keys (39 unique + 1 deduped "dup") fit
    // inside the cap and every one resolves — no overflow, nothing queued.
    assert.equal(Object.keys(states).length, 0, "no unit is left over once deduped");

    // The full partition still holds: every DISTINCT key accounted for
    // exactly once (not once per occurrence in `misses`).
    const dedupedCount = new Set(misses.map((u) => u.unitKey)).size;
    const actualKeys = new Set([...Object.keys(altitudes), ...Object.keys(states)]);
    assert.equal(actualKeys.size, dedupedCount, "partition holds after deduping");
  });
});

describe("value-summary-tick: flow proof (AC-1, drain & read-back)", () => {
  it("tick writes resolved units to DB, later read-back recovers them even with LLM off", async () => {
    // AC-1 flow proof: the tick's purpose is to reach full coverage via
    // repeated passes. This test proves the tick writes to value_unit_summaries,
    // and a later caller (simulating the route on a subsequent request) can read
    // them back even with the LLM off (since they're cached).
    const projectId = await makeSweptProject("flow-proof");
    const units = makeUnits(45);

    // Tick 1: resolves first 40 of 45
    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(40));
    const tick1 = await runValueSummaryTickOnce(dbModule, {});

    assert.equal(tick1.swept, 1);
    assert.equal(tick1.projects[0].generated, 40, "tick 1 resolved 40");
    assert.equal(tick1.projects[0].queued, 5, "tick 1 left 5 queued");

    // Only 40 rows in DB (the queued ones are not written until they resolve)
    const cachedRows = db.prepare("SELECT COUNT(*) as count FROM value_unit_summaries").get().count;
    assert.equal(cachedRows, 40, "tick 1 wrote 40 resolved units to the cache table");

    // Tick 2: with LLM off, the composer reads back from cache + marks misses
    // as unavailable
    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    // No spawn — heuristic mode skips LLM entirely
    const { enrichPoolAltitudes } = require("../lib/value-summary");
    const result = await enrichPoolAltitudes(dbModule, units);
    delete process.env.DASHBOARD_FOCUS_INFER_MODE;

    // With LLM off and the 40 already in cache:
    // - 40 should come back as altitudes (from cache)
    // - 5 misses should be unavailable (not attempted, LLM is off)
    assert.equal(
      Object.keys(result.altitudes).length,
      40,
      "read-back recovers tick 1's 40 cached altitudes"
    );
    const unavailCount = Object.values(result.states).filter((s) => s === "unavailable").length;
    assert.equal(unavailCount, 5, "5 unconquered units marked unavailable (LLM off, no reattempt)");

    // Full partition preserved
    assert.equal(
      Object.keys(result.altitudes).length + Object.keys(result.states).length,
      45,
      "full 45-unit partition: 40 altitudes + 5 unavailable"
    );
  });
});

describe("value-summary-tick: audit log flow proof (AC-2)", () => {
  it("log row partition: cache_hits + generated + queued + unavailable === pool_size", async () => {
    const projectId = await makeSweptProject("audit test");
    const units = makeUnits(45);

    __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));
    __injectSpawnForTest(spawnResolvingFirst(40));
    await runValueSummaryTickOnce(dbModule, {});

    const logRow = lastLogRow(projectId);
    assert.equal(
      logRow.cache_hits + logRow.generated + logRow.queued + logRow.unavailable,
      logRow.pool_size,
      "four-term partition enforced in audit log"
    );
  });
});
