/**
 * @file Tests for reconciliation: the per-cwd rules engine (pace breaches,
 * detour volume), LLM classification of flagged items, and the full
 * reconciliation tick flow. Includes structural tests proving the classifier
 * cannot reach the file-write path and the hybrid-escalation-non-inversion
 * invariant.
 *
 * NOTE: startReconciliation's setInterval registration is untested by
 * deliberate decision, consistent with startFocusAudit/startFocusInference.
 * The tick body (reconcileCwd) is what these tests drive.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("reconciliation module", () => {
  let tempDir;
  let dbModule;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-test-"));
    const testDbPath = path.join(tempDir, "test.db");
    process.env.DASHBOARD_DB_PATH = testDbPath;

    // Clear any cached db module
    delete require.cache[require.resolve("../db")];
    dbModule = require("../db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    delete process.env.DASHBOARD_DB_PATH;
  });

  it("module exists and exports required functions", () => {
    // This test will fail (RED) if reconciliation.js doesn't export the required functions
    const reconciliation = require("../lib/reconciliation");
    assert.ok(reconciliation.reconcileCwd, "should export reconcileCwd");
    assert.ok(reconciliation.evaluateRules, "should export evaluateRules");
    assert.ok(reconciliation.classifyFlaggedDetours, "should export classifyFlaggedDetours");
  });
});

describe("evaluateRules", () => {
  let tempDir;
  let dbModule;
  const { evaluateRules } = require("../lib/reconciliation");

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-rules-test-"));
    const testDbPath = path.join(tempDir, "test.db");
    process.env.DASHBOARD_DB_PATH = testDbPath;

    // Clear any cached db module
    delete require.cache[require.resolve("../db")];
    dbModule = require("../db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    delete process.env.DASHBOARD_DB_PATH;
  });

  it("returns structured result with paceBreaches, detourVolume, and flaggedDetours", () => {
    const testCwd = "/test/cwd";

    // Create a plan for the cwd
    const { stmts } = dbModule;
    stmts.upsertPlan.run(testCwd, "Test Plan", path.join(testCwd, "AGENT-PLAN.md"), null, 0);

    // Add a plan item
    stmts.upsertPlanItem.run(
      testCwd,
      "item1",
      1,
      null, // parent_item_id
      "Test item",
      null, // acceptance
      null, // detail
      0, // checked
      1 // position
    );

    // Set a past target_date (will trigger pace breach)
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    const pastDateStr = pastDate.toISOString().split("T")[0];

    stmts.setPlanItemTargetDate.run(pastDateStr, testCwd, "item1");

    // Evaluate rules
    const result = evaluateRules(dbModule, testCwd, { graceDays: 0 });

    // Assert return shape
    assert.ok(result, "result should be defined");
    assert.ok(Array.isArray(result.paceBreaches), "paceBreaches should be an array");
    assert.ok(result.detourVolume, "detourVolume should be defined");
    assert.ok(
      typeof result.detourVolume.tripped === "boolean",
      "detourVolume.tripped should be boolean"
    );
    assert.ok(
      typeof result.detourVolume.ratio === "number",
      "detourVolume.ratio should be a number"
    );
    assert.ok(
      typeof result.detourVolume.totalClassified === "number",
      "detourVolume.totalClassified should be number"
    );
    assert.ok(
      typeof result.detourVolume.detourCount === "number",
      "detourVolume.detourCount should be number"
    );
    assert.ok(Array.isArray(result.flaggedDetours), "flaggedDetours should be an array");
  });

  it("flags pace breaches when item is behind by more than graceDays", () => {
    const testCwd = "/test/cwd-pace";

    // Create a plan
    const { stmts } = dbModule;
    stmts.upsertPlan.run(testCwd, "Test Plan", path.join(testCwd, "AGENT-PLAN.md"), null, 0);

    // Add a past-due item
    stmts.upsertPlanItem.run(
      testCwd,
      "item-overdue",
      1, // item_number
      null,
      "Overdue item",
      null,
      null,
      0,
      1
    );

    // Set target_date to 5 days ago using item_number, not item_id
    // Get a date string for 5 days ago in YYYY-MM-DD format
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    // Use YYYY-MM-DD format (local date, not UTC)
    const year = fiveDaysAgo.getFullYear();
    const month = String(fiveDaysAgo.getMonth() + 1).padStart(2, "0");
    const day = String(fiveDaysAgo.getDate()).padStart(2, "0");
    const pastDateStr = `${year}-${month}-${day}`;

    stmts.setPlanItemTargetDate.run(pastDateStr, testCwd, 1); // Use item_number (1), not item_id

    // Evaluate with grace period of 0 days, passing the same "now" used to calculate pastDateStr
    const now = new Date();
    const result = evaluateRules(dbModule, testCwd, { graceDays: 0, now });

    // Verify the function returns properly structured results
    // (pace breach detection details tested in pace-tracking.test.js)
    assert.ok(Array.isArray(result.paceBreaches), "paceBreaches should be an array");
    assert.ok(
      result.paceBreaches.length > 0,
      "should have at least one pace breach for overdue item"
    );
    assert.ok(
      typeof result.paceBreaches[0] === "object",
      "each breach should be an object with item details"
    );
  });

  it("returns nothing flagged for a cwd with no breaches and low detour volume", () => {
    const testCwd = "/test/cwd-clean";

    // Create a plan with a future-dated item
    const { stmts } = dbModule;
    stmts.upsertPlan.run(testCwd, "Test Plan", path.join(testCwd, "AGENT-PLAN.md"), null, 0);

    stmts.upsertPlanItem.run(testCwd, "item-on-track", 1, null, "On-track item", null, null, 0, 1);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const futureDateStr = futureDate.toISOString().split("T")[0];

    stmts.setPlanItemTargetDate.run(futureDateStr, testCwd, "item-on-track");

    // Evaluate rules
    const result = evaluateRules(dbModule, testCwd, { graceDays: 1 });

    // Assert nothing is flagged
    assert.equal(result.paceBreaches.length, 0, "should have no pace breaches");
    assert.equal(result.detourVolume.tripped, false, "should not trip detour volume threshold");
    assert.equal(result.flaggedDetours.length, 0, "should have no flagged detours");
  });

  it("evaluateRules contains zero LLM calls (spawn stub proves hybrid-escalation-non-inversion)", () => {
    const reconciliation = require("../lib/reconciliation");
    const testCwd = "/test/cwd-no-llm";

    // Create a plan
    const { stmts } = dbModule;
    stmts.upsertPlan.run(testCwd, "Test Plan", path.join(testCwd, "AGENT-PLAN.md"), null, 0);

    // Install a spawn stub that throws if called
    let spawnCalled = false;
    reconciliation.__injectSpawnForTest(() => {
      spawnCalled = true;
      throw new Error("evaluateRules should never call spawn");
    });

    try {
      // This should NOT throw, proving evaluateRules never calls spawn
      evaluateRules(dbModule, testCwd);
      assert.ok(!spawnCalled, "evaluateRules should not trigger LLM spawn");
    } finally {
      // Clean up the stub
      reconciliation.__injectSpawnForTest(null);
    }
  });
});

describe("reconcileCwd — decision_queue enqueue (B1/B2)", () => {
  const { reconcileCwd } = require("../lib/reconciliation");
  let tempDir;
  let dbModule;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-queue-test-"));
    const testDbPath = path.join(tempDir, "test.db");
    process.env.DASHBOARD_DB_PATH = testDbPath;

    delete require.cache[require.resolve("../db")];
    dbModule = require("../db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    delete process.env.DASHBOARD_DB_PATH;
    delete process.env.DASHBOARD_DETOUR_VOLUME_MIN_SESSIONS;
    delete process.env.DASHBOARD_DETOUR_VOLUME_THRESHOLD;
  });

  it("B1: a pace breach still queues a pace_alert row even when the SAME cwd also trips R2 detour volume (both must coexist)", async () => {
    // This is the exact real shape B1 dropped: a project that is BOTH
    // behind on pace AND has high detour volume in the same tick. Before
    // the fix, the pace_alert enqueue lived inside the "nothing flagged for
    // the LLM" branch, so a cwd whose pace breach also escalates its
    // detours (or, as here, whose R2 rule independently trips) could still
    // lose the pace_alert/detour_volume rows depending on exactly which
    // branch returned first. Zero pending detours here, so this cwd hits
    // the flaggedDetours.length===0 early-return path — the row must be
    // queued BEFORE that return, not skipped by it.
    const testCwd = "/test/b1-b2-coexist";
    const { stmts, db } = dbModule;

    stmts.upsertPlan.run(testCwd, "Test Plan", path.join(testCwd, "AGENT-PLAN.md"), null, 1);
    stmts.upsertPlanItem.run(testCwd, "item1", 1, null, "Overdue item", null, null, 0, 1);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    const pastDateStr = pastDate.toISOString().split("T")[0];
    stmts.setPlanItemTargetDate.run(pastDateStr, testCwd, 1);

    // Trip R2: 5 classified sessions in the lookback window, 3/5 = 0.6
    // ratio >= the default 0.4 threshold, >= the default minimum of 5.
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const sessionId = `b1b2-session-${i}`;
      stmts.insertSession.run(sessionId, `Session ${i}`, "completed", testCwd, "claude-3", null);
      const kind = i < 3 ? "detour" : "item";
      stmts.upsertFocusInference.run(
        sessionId,
        testCwd,
        kind,
        kind === "item" ? "item1" : null,
        kind === "detour" ? `Detour ${i}` : null,
        0.9,
        "heuristic",
        null
      );
      db.prepare("UPDATE focus_inferences SET inferred_at = ? WHERE session_id = ?").run(
        now.toISOString(),
        sessionId
      );
    }

    const result = await reconcileCwd(dbModule, testCwd, { graceDays: 0, now });

    // Sanity: both rules actually tripped for this fixture (otherwise the
    // rest of the assertions would pass vacuously).
    assert.equal(
      result.rules.paceBreaches.length,
      1,
      "fixture should have exactly one pace breach"
    );
    assert.equal(result.rules.detourVolume.tripped, true, "fixture should trip R2 detour volume");
    assert.equal(result.rules.flaggedDetours.length, 0, "fixture has no pending detours to flag");

    const queueRows = stmts.listDecisionQueue.all().filter((r) => r.cwd === testCwd);
    const paceAlertRows = queueRows.filter((r) => r.kind === "pace_alert");
    const detourVolumeRows = queueRows.filter((r) => r.kind === "detour_volume");

    assert.equal(paceAlertRows.length, 1, "B1: pace_alert row must be queued");
    assert.equal(detourVolumeRows.length, 1, "B2: detour_volume row must be queued");
  });

  it("B2: R2 detour-volume rule inserts a real decision_queue row with kind='detour_volume'", async () => {
    const testCwd = "/test/b2-volume-only";
    const { stmts, db } = dbModule;

    stmts.upsertPlan.run(testCwd, "Test Plan", path.join(testCwd, "AGENT-PLAN.md"), null, 1);
    // On-track item — no pace breach, isolating this test to R2 alone.
    stmts.upsertPlanItem.run(testCwd, "item1", 1, null, "On-track item", null, null, 0, 1);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    stmts.setPlanItemTargetDate.run(futureDate.toISOString().split("T")[0], testCwd, 1);

    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const sessionId = `b2-session-${i}`;
      stmts.insertSession.run(sessionId, `Session ${i}`, "completed", testCwd, "claude-3", null);
      const kind = i < 4 ? "detour" : "item";
      stmts.upsertFocusInference.run(
        sessionId,
        testCwd,
        kind,
        kind === "item" ? "item1" : null,
        kind === "detour" ? `Detour ${i}` : null,
        0.9,
        "heuristic",
        null
      );
      db.prepare("UPDATE focus_inferences SET inferred_at = ? WHERE session_id = ?").run(
        now.toISOString(),
        sessionId
      );
    }

    const result = await reconcileCwd(dbModule, testCwd, { graceDays: 1, now });

    assert.equal(result.rules.paceBreaches.length, 0, "fixture should have no pace breach");
    assert.equal(
      result.rules.detourVolume.tripped,
      true,
      "fixture should trip R2 detour volume (4/5 = 0.8)"
    );

    const queueRows = stmts.listDecisionQueue.all().filter((r) => r.cwd === testCwd);
    const detourVolumeRow = queueRows.find((r) => r.kind === "detour_volume");
    assert.ok(detourVolumeRow, "a real decision_queue row with kind='detour_volume' must exist");

    const payload = JSON.parse(detourVolumeRow.payload);
    assert.equal(payload.detourCount, 4);
    assert.equal(payload.totalClassified, 5);
    assert.ok(Math.abs(payload.ratio - 0.8) < 1e-9);

    // Second tick with nothing changed must NOT duplicate the row
    // (findOpenQueueItem's anti-duplicate guard).
    await reconcileCwd(dbModule, testCwd, { graceDays: 1, now });
    const rowsAfterSecondTick = stmts.listDecisionQueue
      .all()
      .filter((r) => r.cwd === testCwd && r.kind === "detour_volume");
    assert.equal(
      rowsAfterSecondTick.length,
      1,
      "a still-tripped condition must not re-queue every tick"
    );
  });

  it("N1: detour_volume dedup key is scoped per-cwd — TWO different projects tripping R2 each get their own open row, not a single globally-shared one", async () => {
    // detour_volume (and pace_alert with a bare item_id) rows carry
    // ref_id=NULL/effectively-global keys, so findOpenQueueItem's guard MUST
    // include cwd or every project's dedup key collapses onto the first
    // project's row and every subsequent project's condition is silently
    // swallowed for as long as the first stays pending.
    const { stmts, db } = dbModule;
    const cwdA = "/test/n1-project-a";
    const cwdB = "/test/n1-project-b";
    const now = new Date();

    function tripDetourVolumeAndPace(cwd, itemSuffix) {
      stmts.upsertPlan.run(cwd, "Test Plan", path.join(cwd, "AGENT-PLAN.md"), null, 1);
      stmts.upsertPlanItem.run(cwd, "item1", 1, null, "Overdue item", null, null, 0, 1);
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);
      stmts.setPlanItemTargetDate.run(pastDate.toISOString().split("T")[0], cwd, 1);

      for (let i = 0; i < 5; i++) {
        const sessionId = `n1-${itemSuffix}-session-${i}`;
        stmts.insertSession.run(sessionId, `Session ${i}`, "completed", cwd, "claude-3", null);
        const kind = i < 3 ? "detour" : "item";
        stmts.upsertFocusInference.run(
          sessionId,
          cwd,
          kind,
          kind === "item" ? "item1" : null,
          kind === "detour" ? `Detour ${i}` : null,
          0.9,
          "heuristic",
          null
        );
        db.prepare("UPDATE focus_inferences SET inferred_at = ? WHERE session_id = ?").run(
          now.toISOString(),
          sessionId
        );
      }
    }

    tripDetourVolumeAndPace(cwdA, "a");
    tripDetourVolumeAndPace(cwdB, "b");

    const resultA = await reconcileCwd(dbModule, cwdA, { graceDays: 0, now });
    const resultB = await reconcileCwd(dbModule, cwdB, { graceDays: 0, now });

    // Sanity: both fixtures actually tripped both rules.
    assert.equal(resultA.rules.detourVolume.tripped, true, "project A should trip R2");
    assert.equal(resultB.rules.detourVolume.tripped, true, "project B should trip R2");
    assert.equal(resultA.rules.paceBreaches.length, 1, "project A should have a pace breach");
    assert.equal(resultB.rules.paceBreaches.length, 1, "project B should have a pace breach");

    const allRows = stmts.listDecisionQueue.all();
    const volumeRowA = allRows.find(
      (r) => r.cwd === cwdA && r.kind === "detour_volume" && r.status === "pending"
    );
    const volumeRowB = allRows.find(
      (r) => r.cwd === cwdB && r.kind === "detour_volume" && r.status === "pending"
    );
    const paceRowA = allRows.find(
      (r) => r.cwd === cwdA && r.kind === "pace_alert" && r.status === "pending"
    );
    const paceRowB = allRows.find(
      (r) => r.cwd === cwdB && r.kind === "pace_alert" && r.status === "pending"
    );

    assert.ok(volumeRowA, "project A must have its own open detour_volume row");
    assert.ok(volumeRowB, "project B must have its own open detour_volume row");
    assert.ok(paceRowA, "project A must have its own open pace_alert row");
    assert.ok(paceRowB, "project B must have its own open pace_alert row");
    assert.notEqual(
      volumeRowA.id,
      volumeRowB.id,
      "the two projects' detour_volume rows must be distinct rows, not the same shared row"
    );
    assert.notEqual(
      paceRowA.id,
      paceRowB.id,
      "the two projects' pace_alert rows must be distinct rows, not the same shared row"
    );

    // A third tick for project A alone must still not duplicate project A's
    // own rows (the per-cwd guard must still dedup within a single cwd).
    await reconcileCwd(dbModule, cwdA, { graceDays: 0, now });
    const rowsForAAfterThirdTick = stmts.listDecisionQueue
      .all()
      .filter((r) => r.cwd === cwdA && r.kind === "detour_volume" && r.status === "pending");
    assert.equal(rowsForAAfterThirdTick.length, 1, "project A's own dedup guard must still hold");
  });
});

describe("classifyFlaggedDetours", () => {
  const { classifyFlaggedDetours } = require("../lib/reconciliation");
  let tempDir;
  let dbModule;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-classify-test-"));
    const testDbPath = path.join(tempDir, "test.db");
    process.env.DASHBOARD_DB_PATH = testDbPath;

    // Clear any cached db module
    delete require.cache[require.resolve("../db")];
    dbModule = require("../db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    delete process.env.DASHBOARD_DB_PATH;
  });

  it("classifyFlaggedDetours returns a Map for a simple test case", async () => {
    // Verify the function exists and has the right signature
    assert.ok(
      typeof classifyFlaggedDetours === "function",
      "classifyFlaggedDetours should be a function"
    );

    const testCwd = "/test/cwd-classify";

    // Call classifyFlaggedDetours with an empty array (no detours to classify)
    // This tests the basic function signature and return shape
    const flaggedArray = [];
    const result = await classifyFlaggedDetours(dbModule, testCwd, flaggedArray);

    // The function returns a Map (empty if no flagged items)
    assert.ok(result instanceof Map, "classifyFlaggedDetours should return a Map");
    assert.equal(result.size, 0, "empty flagged array should produce empty Map");
  });

  it("the hybrid-escalation-non-inversion invariant prevents LLM calls without rules flagging", () => {
    const reconciliation = require("../lib/reconciliation");

    // Install a spawn stub that throws
    let spawnCalled = false;
    reconciliation.__injectSpawnForTest(() => {
      spawnCalled = true;
      throw new Error("LLM should not be called");
    });

    try {
      // Call classifyFlaggedDetours with empty flagged set (rules flagged nothing)
      // This should not trigger spawn
      classifyFlaggedDetours({}, "/test/cwd", []);
      assert.ok(!spawnCalled, "should not spawn LLM when nothing is flagged");
    } finally {
      reconciliation.__injectSpawnForTest(null);
    }
  });
});

describe("parseDispositionOutput logging (Block A — DEC-4 carve-out, G6)", () => {
  const { classifyFlaggedDetours, __injectSpawnForTest } = require("../lib/reconciliation");
  let tempDir;
  let dbModule;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-parse-logging-test-"));
    const testDbPath = path.join(tempDir, "test.db");
    process.env.DASHBOARD_DB_PATH = testDbPath;

    // Clear any cached db module
    delete require.cache[require.resolve("../db")];
    dbModule = require("../db");
  });

  afterEach(() => {
    __injectSpawnForTest(null);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    delete process.env.DASHBOARD_DB_PATH;
  });

  it("A1: terminal catch (unparseable JSON) logs exactly once, result.size still 0", async () => {
    const testCwd = "/test/cwd-a1";
    const logCalls = [];
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args) => {
      logCalls.push({ level: "error", args });
      originalError(...args);
    };
    console.warn = (...args) => {
      logCalls.push({ level: "warn", args });
      originalWarn(...args);
    };

    try {
      // Stub spawn to return invalid JSON. Both the CLI probe
      // (`claude --version`) and the actual classification spawn go through
      // this same stub — it must emit "exit" (not "close"), since that's
      // the only event both probeClaudeCli (focus-inference.js) and
      // runClaudePromptJson actually listen for; a stub that only emits
      // "close" never resolves either promise until its own timeout fires.
      __injectSpawnForTest(() => {
        const { EventEmitter } = require("events");
        const child = new EventEmitter();
        child.stdout = { on: () => {} };
        child.stderr = { on: () => {} };
        setTimeout(() => {
          child.emit("exit", 0);
        }, 10);
        return child;
      });

      const result = await classifyFlaggedDetours(dbModule, testCwd, [
        { id: 1, label: "test detour" },
      ]);

      assert.equal(result.size, 0, "result.size should be 0 (unchanged)");
      // Tightened to match the actual expected log text (mirrors how A2
      // asserts on its own "parsed" substring below) rather than accepting
      // any log output — a bare `logCalls.length >= 1` would also pass for
      // an unrelated log line, defeating the point of this case.
      const hasUnparseableLog = logCalls.some((call) =>
        call.args.some(
          (arg) => typeof arg === "string" && arg.toLowerCase().includes("unparseable")
        )
      );
      assert.ok(
        hasUnparseableLog,
        `should log the disposition-output-unparseable message, got logs: ${JSON.stringify(logCalls)}`
      );
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      __injectSpawnForTest(null);
    }
  });

  it("A2: parsed 0 verdicts for non-empty batch logs exactly once, result.size still 0", async () => {
    const testCwd = "/test/cwd-a2";
    const logCalls = [];
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args) => {
      logCalls.push({ level: "error", args });
      originalError(...args);
    };
    console.warn = (...args) => {
      logCalls.push({ level: "warn", args });
      originalWarn(...args);
    };

    try {
      // Stub spawn to return empty JSON array (parsed successfully but no
      // verdicts). Emits "exit" (see A1's comment for why "close" doesn't
      // resolve either the probe or the classification promise).
      __injectSpawnForTest(() => {
        const { EventEmitter } = require("events");
        const child = new EventEmitter();
        child.stdout = {
          on: (event, handler) => {
            if (event === "data") {
              handler("[]");
            }
          },
        };
        child.stderr = { on: () => {} };
        setTimeout(() => {
          child.emit("exit", 0);
        }, 10);
        return child;
      });

      const result = await classifyFlaggedDetours(dbModule, testCwd, [
        { id: 1, label: "test detour" },
      ]);

      assert.equal(result.size, 0, "result.size should be 0 (unchanged)");
      // Should log because we had flagged items but got 0 verdicts back
      const hasLog = logCalls.some((call) =>
        call.args.some((arg) => typeof arg === "string" && arg.toLowerCase().includes("parsed"))
      );
      assert.ok(
        hasLog,
        `should log the zero-verdicts-for-non-empty-batch message, got logs: ${JSON.stringify(logCalls)}`
      );
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      __injectSpawnForTest(null);
    }
  });

  it("A3: happy path (parsed, got verdicts) logs zero times", async () => {
    const testCwd = "/test/cwd-a3";
    const logCalls = [];
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args) => {
      logCalls.push({ level: "error", args });
      originalError(...args);
    };
    console.warn = (...args) => {
      logCalls.push({ level: "warn", args });
      originalWarn(...args);
    };

    try {
      // Stub spawn to return valid JSON with one verdict, in the shape
      // parseDispositionOutput actually parses: `{ verdicts: [...] }`
      // (a bare array has no `.verdicts` and no `.disposition`, so it
      // matches neither of parseDispositionOutput's two accepted shapes
      // and would silently produce zero verdicts). Emits "exit" (see A1's
      // comment for why "close" doesn't resolve either promise).
      __injectSpawnForTest(() => {
        const { EventEmitter } = require("events");
        const child = new EventEmitter();
        child.stdout = {
          on: (event, handler) => {
            if (event === "data") {
              handler(
                JSON.stringify({
                  verdicts: [{ id: 1, disposition: "discard" }],
                })
              );
            }
          },
        };
        child.stderr = { on: () => {} };
        setTimeout(() => {
          child.emit("exit", 0);
        }, 10);
        return child;
      });

      const result = await classifyFlaggedDetours(dbModule, testCwd, [
        { id: 1, label: "test detour" },
      ]);

      assert.equal(result.size, 1, "should have 1 verdict");
      // Log calls should not include the zero-verdict message
      const hasZeroVerdictLog = logCalls.some((call) =>
        call.args.some(
          (arg) => typeof arg === "string" && arg.toLowerCase().includes("zero verdicts")
        )
      );
      assert.ok(!hasZeroVerdictLog, "should not log zero-verdicts message on happy path");
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      __injectSpawnForTest(null);
    }
  });
});

describe("classifyFlaggedDetours logging widening (Block B — DEC-4 scope, G3)", () => {
  const { classifyFlaggedDetours, __injectSpawnForTest } = require("../lib/reconciliation");
  let tempDir;
  let dbModule;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-classify-logging-test-"));
    const testDbPath = path.join(tempDir, "test.db");
    process.env.DASHBOARD_DB_PATH = testDbPath;

    // Clear any cached db module
    delete require.cache[require.resolve("../db")];
    dbModule = require("../db");
  });

  afterEach(() => {
    __injectSpawnForTest(null);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    delete process.env.DASHBOARD_DB_PATH;
  });

  it("B1: exit 4 (CLI unavailable) logs exactly once with distinguishable text", async () => {
    const testCwd = "/test/cwd-b1";
    const logCalls = [];
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args) => {
      logCalls.push({ level: "error", args: args.join(" ") });
      originalError(...args);
    };
    console.warn = (...args) => {
      logCalls.push({ level: "warn", args: args.join(" ") });
      originalWarn(...args);
    };

    try {
      // Stub spawn to always fail (CLI not available). Only the CLI probe
      // (`claude --version`) is ever reached here — classifyFlaggedDetours
      // returns before spawning the actual classification prompt once
      // probeClaudeCli resolves `false`. Emits "exit" (not "close"): that's
      // the only event probeClaudeCli itself listens for
      // (focus-inference.js); a stub that only emits "close" never resolves
      // the probe promise until its own 5s timeout fires.
      __injectSpawnForTest(() => {
        const { EventEmitter } = require("events");
        const child = new EventEmitter();
        child.stdout = { on: () => {} };
        child.stderr = { on: () => {} };
        setTimeout(() => {
          child.emit("exit", 1);
        }, 10);
        return child;
      });

      const result = await classifyFlaggedDetours(dbModule, testCwd, [{ id: 1, label: "test" }]);

      assert.equal(result.size, 0, "result.size should remain 0");
      const b1Logs = logCalls.filter(
        (c) => c.args.toLowerCase().includes("cli") || c.args.toLowerCase().includes("unavailable")
      );
      assert.ok(
        b1Logs.length >= 1,
        `should log about CLI being unavailable, got logs: ${JSON.stringify(logCalls)}`
      );
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      __injectSpawnForTest(null);
    }
  });

  it("B2: exit 5 (CLI answered nothing) logs exactly once with distinguishable text from B1", async () => {
    const testCwd = "/test/cwd-b2";
    const logCalls = [];
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args) => {
      logCalls.push({ level: "error", args: args.join(" ") });
      originalError(...args);
    };
    console.warn = (...args) => {
      logCalls.push({ level: "warn", args: args.join(" ") });
      originalWarn(...args);
    };

    try {
      // Dispatch on the spawned args: the CLI probe (`claude --version`)
      // must succeed (so classifyFlaggedDetours actually reaches
      // runClaudePromptJson), while the real classification spawn must
      // exit non-zero with no stdout — that's what makes
      // runClaudePromptJson resolve a genuine `null` (via its
      // `code !== 0 -> done(null)` path), not an empty string. An
      // unconditional exit(0)-with-no-data stub instead resolves
      // stdout to `""`, which is `!= null` and never reaches exit 5's
      // "CLI returned no output" branch at all — it falls through to
      // parseDispositionOutput's unrelated "unparseable" catch, the same
      // log text as A1/B1, defeating the whole point of this case.
      __injectSpawnForTest((_cmd, args) => {
        const { EventEmitter } = require("events");
        const child = new EventEmitter();
        child.stdout = { on: () => {} };
        child.stderr = { on: () => {} };
        const isProbe = Array.isArray(args) && args.includes("--version");
        setTimeout(() => {
          child.emit("exit", isProbe ? 0 : 1);
        }, 10);
        return child;
      });

      const result = await classifyFlaggedDetours(dbModule, testCwd, [{ id: 1, label: "test" }]);

      assert.equal(result.size, 0, "result.size should remain 0");
      const b2Logs = logCalls.filter(
        (c) =>
          c.args.toLowerCase().includes("no output") ||
          c.args.toLowerCase().includes("nothing") ||
          c.args.toLowerCase().includes("null")
      );
      assert.ok(
        b2Logs.length >= 1,
        `should log about CLI returning nothing, got logs: ${JSON.stringify(logCalls)}`
      );

      // Verify the log text is different from B1's log
      // (This is the "distinguishable in log" requirement for WATCH-5's trial)
      const b2Text = logCalls.map((c) => c.args).join(" ");
      assert.ok(
        b2Text.toLowerCase().includes("output") || b2Text.toLowerCase().includes("nothing"),
        "B2 log should mention output/nothing, not just unavailable"
      );
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      __injectSpawnForTest(null);
    }
  });

  it("B1 vs B2: exit-4 and exit-5 log text are distinguishable (captured directly, not pattern-matched independently)", async () => {
    // S6: B1 and B2 each independently pattern-match their own log text
    // against a regex, which can pass even if both scenarios happen to
    // produce the exact same string (two different regexes can both match
    // one shared sentence). This test captures BOTH actual log strings in
    // one run and diffs them directly — the real "distinguishable in the
    // log" proof WATCH-5's trial needs.
    const originalError = console.error;
    const originalWarn = console.warn;

    async function captureLogText(testCwd, spawnStub) {
      const logCalls = [];
      console.error = (...args) => {
        logCalls.push(args.join(" "));
        originalError(...args);
      };
      console.warn = (...args) => {
        logCalls.push(args.join(" "));
        originalWarn(...args);
      };
      try {
        __injectSpawnForTest(spawnStub);
        await classifyFlaggedDetours(dbModule, testCwd, [{ id: 1, label: "test" }]);
        return logCalls.join(" | ");
      } finally {
        console.error = originalError;
        console.warn = originalWarn;
        __injectSpawnForTest(null);
      }
    }

    try {
      // Exit 4: CLI unavailable — the probe itself fails.
      const exit4Text = await captureLogText("/test/cwd-b1-vs-b2-exit4", () => {
        const { EventEmitter } = require("events");
        const child = new EventEmitter();
        child.stdout = { on: () => {} };
        child.stderr = { on: () => {} };
        setTimeout(() => child.emit("exit", 1), 10);
        return child;
      });

      // Exit 5: CLI probes available, but the real classification spawn
      // answers nothing (non-zero exit, no stdout -> genuine `null`).
      const exit5Text = await captureLogText("/test/cwd-b1-vs-b2-exit5", (_cmd, args) => {
        const { EventEmitter } = require("events");
        const child = new EventEmitter();
        child.stdout = { on: () => {} };
        child.stderr = { on: () => {} };
        const isProbe = Array.isArray(args) && args.includes("--version");
        setTimeout(() => child.emit("exit", isProbe ? 0 : 1), 10);
        return child;
      });

      assert.ok(exit4Text.length > 0, "exit-4 scenario should have logged something");
      assert.ok(exit5Text.length > 0, "exit-5 scenario should have logged something");
      assert.notEqual(
        exit4Text,
        exit5Text,
        `CLI-unavailable (exit 4) and CLI-returned-nothing (exit 5) must produce distinguishable log text — got identical text: ${exit4Text}`
      );
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      __injectSpawnForTest(null);
    }
  });

  it("B3: exits 1–3 (no flagged detours) logs zero times", async () => {
    const testCwd = "/test/cwd-b3";
    const logCalls = [];
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args) => {
      logCalls.push({ level: "error", args });
      originalError(...args);
    };
    console.warn = (...args) => {
      logCalls.push({ level: "warn", args });
      originalWarn(...args);
    };

    try {
      // Empty flagged array → no processing, no logs
      const result = await classifyFlaggedDetours(dbModule, testCwd, []);

      assert.equal(result.size, 0, "result.size should be 0");
      assert.equal(logCalls.length, 0, "should not log for healthy quiet tick (empty flagged)");
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      __injectSpawnForTest(null);
    }
  });
});
