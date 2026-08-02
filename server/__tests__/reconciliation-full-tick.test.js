/**
 * @file Full-chain reconciliation tests: end-to-end scenarios proving the
 * complete pipeline from rule evaluation through LLM classification to
 * file write-back and re-ingest. Scenario A = happy path; Scenario B =
 * conflict path with escalation; Scenario C = cross-call-site byte parity
 * (human-resolve route vs. reconciliation tick produce identical writes).
 * All paths run real code; only the LLM spawn is stubbed.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("node:events");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-reconciliation-full-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;
// Set grace days to 0 so a stalled item is immediately flagged
process.env.DASHBOARD_PACE_GRACE_DAYS = "0";

const dbModule = require("../db");
const { db, stmts } = dbModule;
const { PLAN_FILENAME, ingestPlanForCwd } = require("../lib/plan-ingest");
const { reconcileCwd, __injectSpawnForTest } = require("../lib/reconciliation");
const { __injectPreRenameHookForTest } = require("../lib/plan-writeback");
const { createApp, startServer } = require("../index");

let workDir;
let server;
let BASE;

// --- HTTP helper, copied per this repo's one-helper-per-file convention ---
function fetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const http = require("http");
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...options.headers },
    };
    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

/** Fake ChildProcess factory: exits with the given stdout after a tick. */
function fakeSpawn({ exitCode = 0, stdout = "" } = {}) {
  return () => {
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

/** LLM envelope the `claude -p --output-format json` spawn would print. */
function envelope(result) {
  return JSON.stringify({ result: JSON.stringify(result) });
}

function writePlan(cwd, text) {
  fs.writeFileSync(path.join(cwd, PLAN_FILENAME), text);
}

function readPlan(cwd) {
  return fs.readFileSync(path.join(cwd, PLAN_FILENAME), "utf8");
}

before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconciliation-full-tick-"));
  // Start the test server for Scenario C
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://localhost:${server.address().port}`;
});

after(() => {
  if (server) {
    server.close();
  }
  try {
    db.close();
  } catch {
    /* already closed */
  }
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  try {
    fs.rmSync(TEST_DB, { force: true });
    fs.rmSync(`${TEST_DB}-wal`, { force: true });
    fs.rmSync(`${TEST_DB}-shm`, { force: true });
  } catch {
    /* best effort */
  }
});

describe("reconciliation-full-tick", () => {
  describe("Scenario A: happy-path full chain", () => {
    it("rule flags → LLM classifies → file write → re-ingest → decision_queue outcome", async () => {
      // Build a fixture with:
      // - A real AGENT-PLAN.md with one unchecked top-level item
      // - That item's target_date set to the past (via DB, not file)
      // - A seeded pending detour_dispositions row
      // - Stub the LLM to return fold_in verdict

      const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-a-"));
      try {
        // Write the plan file
        const planText = `# My Plan

- [ ] 1. Ship the auth migration — acceptance: SSO works`;
        writePlan(cwdA, planText);

        // Ingest it to create the plan_items row
        const ingested = ingestPlanForCwd(dbModule, cwdA);
        assert(ingested.ok, "ingestPlanForCwd failed");
        assert.equal(ingested.items.length, 1, "should have one item");
        const item = ingested.items[0];
        const itemId = item.item_id;
        const itemNumber = item.number;

        // Set target_date to the past
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 10);
        const pastDateStr = pastDate.toISOString().split("T")[0];
        stmts.setPlanItemTargetDate.run(pastDateStr, cwdA, itemNumber);

        // Seed a pending detour_dispositions row
        const detourRes = stmts.upsertDetourDisposition.run(
          cwdA,
          null,
          "session-1",
          "inferred",
          "session-1",
          new Date().toISOString(),
          "Detour detected",
          itemId
        );
        const dispositionId = detourRes.lastInsertRowid;

        // Stub the LLM to return fold_in verdict
        const llmOutput = {
          disposition: "fold_in",
          confidence: 0.95,
          reason: "User worked on related task",
          proposed_text: "Sub-task from detour",
          proposed_acceptance: "It works",
          proposed_detail: null,
          proposed_parent_item_id: itemId,
        };

        __injectSpawnForTest(() => fakeSpawn({ stdout: envelope(llmOutput) })());

        // Call reconcileCwd
        await reconcileCwd(dbModule, cwdA);

        // Assert: file was written
        const newFileContent = readPlan(cwdA);
        assert(
          newFileContent.includes("Sub-task from detour"),
          "file should contain new sub-item text"
        );

        // Assert: disposition row updated with write_status='written'
        const disposition = stmts.getDetourDisposition.get(dispositionId);
        assert.equal(
          disposition.write_status,
          "written",
          "disposition should have write_status='written'"
        );
        assert(disposition.resolved_item_id, "disposition should have resolved_item_id set");

        // Assert: NO writeback_conflict/writeback_failed/detour_disposition
        // row was created for the successful fold_in itself — the write's
        // own audit trail lives on the disposition row, not the queue, when
        // it lands cleanly.
        const queueRows = stmts.listDecisionQueue.all();
        const writeOutcomeRows = queueRows.filter((r) =>
          ["writeback_conflict", "writeback_failed", "detour_disposition"].includes(r.kind)
        );
        assert.equal(
          writeOutcomeRows.length,
          0,
          "no write-outcome decision_queue row for a successful write"
        );

        // B1 regression guard: this fixture is deliberately BOTH behind on
        // pace AND carrying a pending detour in the same tick — the exact
        // shape that used to silently drop the pace_alert row entirely
        // (R1's enqueue lived inside the "nothing flagged for the LLM"
        // branch). A pace_alert row must still be queued even though the
        // detour itself got classified and written in the same tick.
        const paceAlertRows = queueRows.filter((r) => r.kind === "pace_alert");
        assert.equal(
          paceAlertRows.length,
          1,
          "a pace_alert row must be queued even when a detour is also flagged/written"
        );

        // Assert: file was re-ingested and new sub-item is in plan_items
        const reingested = ingestPlanForCwd(dbModule, cwdA);
        assert(reingested.ok, "re-ingest failed");
        const subitems = reingested.items.filter((i) => i.parent_item_id === itemId);
        assert(subitems.length > 0, "should have sub-item after re-ingest");
      } finally {
        fs.rmSync(cwdA, { recursive: true, force: true });
      }
    });

    it("second-tick digest/dedupe assertions", async () => {
      // Run the tick twice on identical input: should not re-write the file
      // or re-spawn the LLM.

      const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-a-digest-"));
      try {
        // Set up the same fixture
        const planText = `# My Plan

- [ ] 1. Do something — acceptance: works`;
        writePlan(cwdA, planText);
        const ingested = ingestPlanForCwd(dbModule, cwdA);
        const item = ingested.items[0];
        const itemId = item.item_id;
        const itemNumber = item.number;

        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 10);
        const pastDateStr = pastDate.toISOString().split("T")[0];
        stmts.setPlanItemTargetDate.run(pastDateStr, cwdA, itemNumber);

        const detourRes = stmts.upsertDetourDisposition.run(
          cwdA,
          null,
          "session-2",
          "inferred",
          "session-2",
          new Date().toISOString(),
          "Found detour",
          itemId
        );
        const dispositionId = detourRes.lastInsertRowid;

        // Stub the LLM, filtering out --version probes to only count real classification spawns
        let spawnCount = 0;
        __injectSpawnForTest((cmd, args) => {
          const isProbe = Array.isArray(args) && args.includes("--version");
          if (!isProbe) spawnCount++;
          const llmOutput = {
            disposition: "fold_in",
            confidence: 0.9,
            reason: "Related work",
            proposed_text: "Subtask",
            proposed_acceptance: null,
            proposed_detail: null,
            proposed_parent_item_id: itemId,
          };
          return fakeSpawn({ stdout: envelope(llmOutput) })();
        });

        // First tick
        const fileContentBefore = readPlan(cwdA);
        await reconcileCwd(dbModule, cwdA);
        const fileContentAfter1 = readPlan(cwdA);
        assert(fileContentAfter1.includes("Subtask"), "first tick should write");
        assert.equal(spawnCount, 1, "should spawn LLM once");

        // Second tick with nothing changed
        await reconcileCwd(dbModule, cwdA);
        const fileContentAfter2 = readPlan(cwdA);
        assert.equal(fileContentAfter2, fileContentAfter1, "second tick should not re-write file");
        assert.equal(spawnCount, 1, "should not spawn LLM again");
      } finally {
        fs.rmSync(cwdA, { recursive: true, force: true });
      }
    });
  });

  describe("Scenario B: conflict/escalation path", () => {
    it("conflict on both attempts → write_status='conflict', human's bytes intact, decision_queue escalation", async () => {
      // Set up a fixture with a target-date-stalled item
      // Inject a conflict on both write attempts via __injectPreRenameHookForTest
      // Assert: write_status='conflict', decision_queue row with kind='writeback_conflict',
      // and the human's bytes are byte-for-byte unchanged

      const cwdB = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-b-"));
      try {
        const originalPlanText = `# My Plan

- [ ] 1. Original item — acceptance: original`;
        writePlan(cwdB, originalPlanText);

        const ingested = ingestPlanForCwd(dbModule, cwdB);
        const item = ingested.items[0];
        const itemId = item.item_id;
        const itemNumber = item.number;

        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 5);
        const pastDateStr = pastDate.toISOString().split("T")[0];
        stmts.setPlanItemTargetDate.run(pastDateStr, cwdB, itemNumber);

        const detourRes = stmts.upsertDetourDisposition.run(
          cwdB,
          null,
          "session-conflict",
          "inferred",
          "session-conflict",
          new Date().toISOString(),
          "Conflict test detour",
          itemId
        );
        const dispositionId = detourRes.lastInsertRowid;

        // Inject a DISTINCT human edit on EACH attempt (B4: since the retry
        // now genuinely re-baselines against its own fresh read, a fixture
        // that writes the SAME bytes on every hook call would let the retry
        // see no change from ITS OWN starting point and succeed — the retry
        // must be given a real, independent conflict of its own to still
        // prove the escalate-after-two-conflicts path).
        let attemptCount = 0;
        __injectPreRenameHookForTest(() => {
          attemptCount++;
          const humanEdit = `# My Plan

- [ ] 1. Original item — acceptance: original
  - [ ] 1.1. Human's own sub-item (edit #${attemptCount})`;
          writePlan(cwdB, humanEdit);
        });

        // Stub LLM to return fold_in
        const llmOutput = {
          disposition: "fold_in",
          confidence: 0.85,
          reason: "Should fold in",
          proposed_text: "Dashboard's sub-item",
          proposed_acceptance: null,
          proposed_detail: null,
          proposed_parent_item_id: itemId,
        };
        __injectSpawnForTest(() => fakeSpawn({ stdout: envelope(llmOutput) })());

        // Call reconcileCwd - should attempt twice, then escalate
        await reconcileCwd(dbModule, cwdB);

        // Assert: two attempts were made
        assert.equal(attemptCount, 2, "should attempt twice (once, then retry)");

        // Assert: human's bytes are still the edited version, not clobbered
        const finalPlanContent = readPlan(cwdB);
        assert(
          finalPlanContent.includes("Human's own sub-item"),
          "human's edit should be preserved"
        );
        assert(
          !finalPlanContent.includes("Dashboard's sub-item"),
          "dashboard's attempted write should NOT be in file"
        );

        // Assert: disposition row shows write_status='conflict'
        const disposition = stmts.getDetourDisposition.get(dispositionId);
        assert.equal(disposition.write_status, "conflict", "should have write_status='conflict'");
        assert(!disposition.resolved_item_id, "resolved_item_id should be NULL on conflict");
        assert(!disposition.resolved_at, "resolved_at should be NULL on conflict");

        // B5 / DEC-14 point 2: the disposition row's OWN suggested_markdown
        // column must carry the exact block that was attempted, even though
        // it never landed — this is specifically so Sara can see what would
        // have been added.
        assert.ok(
          disposition.suggested_markdown,
          "disposition.suggested_markdown must be populated on conflict"
        );
        assert.ok(
          disposition.suggested_markdown.includes("Dashboard's sub-item"),
          "suggested_markdown must contain the exact attempted text"
        );

        // Assert: decision_queue row with kind='writeback_conflict' was created
        const queueRows = stmts.listDecisionQueue.all();
        assert(queueRows.length > 0, "should have decision_queue row");
        const conflictRow = queueRows.find((r) => r.kind === "writeback_conflict");
        assert(conflictRow, "should have writeback_conflict queue row");
        assert.equal(conflictRow.ref_id, dispositionId, "queue row should reference disposition");

        // B5: the queue row's own payload must ALSO carry the attempted
        // markdown (mirrored, not just present on the disposition row) — so
        // a consumer of GET /api/decision-queue alone (without a second
        // lookup into detour_dispositions) can still show what was tried.
        const payload = JSON.parse(conflictRow.payload);
        assert.ok(
          payload.suggested_markdown && payload.suggested_markdown.includes("Dashboard's sub-item"),
          "the writeback_conflict queue row's payload must carry the attempted markdown too"
        );
      } finally {
        fs.rmSync(cwdB, { recursive: true, force: true });
      }
    });
  });

  describe("§9.1 cross-call-site: the human-resolve route and the reconciliation tick write identical bytes", () => {
    it("Scenario C: human-resolve route and reconciliation tick produce byte-identical AGENT-PLAN.md modulo minted id", async () => {
      // This is the highest-stakes test: prove both call sites produce identical bytes.
      // - Build two identical fixture cwds A and B
      // - Drive A through POST /api/detours/:id/resolve (real, unstubbed write)
      // - Drive B through reconcileCwd (real write with LLM stub returning same verdict)
      // - Normalize both files (replace minted id and absolute paths)
      // - Assert byte-identical
      // - Assert both disposition rows land in same write_status state

      const cwdC1 = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-c-path-1-"));
      const cwdC2 = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-c-path-2-"));

      try {
        // Helper to set up identical fixtures
        function setupFixture(cwd) {
          const planText = `# Migration Plan

- [ ] 1. Implement auth — acceptance: login works`;
          writePlan(cwd, planText);

          const ingested = ingestPlanForCwd(dbModule, cwd);
          assert(ingested.ok, "ingest failed");
          const item = ingested.items[0];

          const pastDate = new Date();
          pastDate.setDate(pastDate.getDate() - 3);
          const pastDateStr = pastDate.toISOString().split("T")[0];
          stmts.setPlanItemTargetDate.run(pastDateStr, cwd, item.number);

          const detourRes = stmts.upsertDetourDisposition.run(
            cwd,
            null,
            "session-c",
            "inferred",
            "session-c",
            new Date().toISOString(),
            "Some work",
            item.item_id
          );

          return { item, dispositionId: detourRes.lastInsertRowid };
        }

        const { item: itemC1, dispositionId: dispIdC1 } = setupFixture(cwdC1);
        const { item: itemC2, dispositionId: dispIdC2 } = setupFixture(cwdC2);

        // Path 1: Human resolve via HTTP (real, unstubbed write)
        // Create a detour_dispositions row that the route can update
        const llmVerdictC1 = {
          disposition: "fold_in",
          confidence: 0.92,
          reason: "Work was done",
          proposed_text: "Auth implementation details",
          proposed_acceptance: "SSO + basic auth",
          proposed_detail: null,
          proposed_parent_item_id: itemC1.item_id,
        };

        // Resolve the disposition via HTTP POST
        // Note: This test will fail because the route doesn't exist yet, which is expected RED.
        const resolveRes = await fetch("/api/detours/" + dispIdC1 + "/resolve", {
          method: "POST",
          body: { disposition: "fold_in", decided_by: "human", ...llmVerdictC1 },
        });

        assert.equal(resolveRes.status, 200, "resolve route should succeed");
        assert(resolveRes.body.resolved_item_id, "response should have resolved_item_id");

        // Path 2: Reconciliation tick via reconcileCwd (real write with LLM stub)
        // Build a separate verdict for cwdC2 with its own item_id to match the semantics
        const llmVerdictC2 = {
          ...llmVerdictC1,
          proposed_parent_item_id: itemC2.item_id,
        };
        __injectSpawnForTest(() => fakeSpawn({ stdout: envelope(llmVerdictC2) })());
        await reconcileCwd(dbModule, cwdC2);

        // Read both files
        const fileC1 = readPlan(cwdC1);
        const fileC2 = readPlan(cwdC2);

        // Normalize: replace minted IDs with a placeholder
        const normalizedC1 = fileC1.replace(/\bid: [0-9a-f]{8}\b/g, "id: <ID>");
        const normalizedC2 = fileC2.replace(/\bid: [0-9a-f]{8}\b/g, "id: <ID>");

        // Assert byte-identical (modulo minted ID)
        assert.equal(
          normalizedC1,
          normalizedC2,
          "both paths should produce byte-identical content"
        );

        // Assert both disposition rows land in same state
        const dispC1 = stmts.getDetourDisposition.get(dispIdC1);
        const dispC2 = stmts.getDetourDisposition.get(dispIdC2);

        assert.equal(dispC1.write_status, "written", "path 1 should have write_status='written'");
        assert.equal(dispC2.write_status, "written", "path 2 should have write_status='written'");
        assert(dispC1.resolved_item_id, "path 1 should have resolved_item_id");
        assert(dispC2.resolved_item_id, "path 2 should have resolved_item_id");
        assert(dispC1.resolved_at, "path 1 should have resolved_at stamped");
        assert(dispC2.resolved_at, "path 2 should have resolved_at stamped");
      } finally {
        fs.rmSync(cwdC1, { recursive: true, force: true });
        fs.rmSync(cwdC2, { recursive: true, force: true });
      }
    });
  });

  // S6 (2026-08-01 reconciliation-pass fix): detour_dispositions rows and
  // the decision_queue rows a failed/conflicted write-back enqueues must
  // both carry a real project_id, stamped via project_paths — not a
  // permanently-undefined field.
  describe("S6: project_id is stamped end-to-end, not silently undefined", () => {
    it("recordInferredDetour stamps project_id from project_paths for a registered cwd", () => {
      const { recordInferredDetour } = require("../lib/detours");
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "s6-inferred-"));
      try {
        stmts.insertProject.run("proj-s6-inferred", "S6 inferred test");
        stmts.insertProjectPath.run("proj-s6-inferred", cwd);
        recordInferredDetour(
          dbModule,
          { cwd, id: "s6-session-1" },
          { label: "S6 test", item_id: null }
        );

        const row = db
          .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
          .get(cwd, "s6-session-1");
        assert.ok(row, "should have recorded the detour");
        assert.equal(
          row.project_id,
          "proj-s6-inferred",
          "project_id should be stamped via project_paths"
        );
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });

    it("recordInferredDetour leaves project_id null for an unregistered cwd (no false stamp)", () => {
      const { recordInferredDetour } = require("../lib/detours");
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "s6-unregistered-"));
      try {
        recordInferredDetour(
          dbModule,
          { cwd, id: "s6-session-2" },
          { label: "S6 test 2", item_id: null }
        );
        const row = db
          .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
          .get(cwd, "s6-session-2");
        assert.ok(row, "should have recorded the detour");
        assert.equal(
          row.project_id,
          null,
          "an unregistered cwd must not get a fabricated project_id"
        );
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });

    it("a writeback_failed decision_queue row inherits the disposition's project_id (plan-writeback.js's row.project_id is no longer always undefined)", () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "s6-writeback-"));
      try {
        stmts.insertProject.run("proj-s6-writeback", "S6 writeback test");
        stmts.insertProjectPath.run("proj-s6-writeback", cwd);
        // No AGENT-PLAN.md written -> NO_PLAN_FILE -> non-retryable failure.
        const { recordInferredDetour, resolveDisposition } = require("../lib/detours");
        recordInferredDetour(
          dbModule,
          { cwd, id: "s6-session-3" },
          { label: "S6 writeback", item_id: null }
        );
        const disp = db
          .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
          .get(cwd, "s6-session-3");
        assert.equal(disp.project_id, "proj-s6-writeback");

        resolveDisposition(dbModule, disp.id, {
          disposition: "new_item",
          decided_by: "human",
          proposed_text: "Some new item text",
        });
        const { applyDisposition } = require("../lib/plan-writeback");
        applyDisposition(dbModule, disp.id, {});

        const updated = stmts.getDetourDisposition.get(disp.id);
        assert.equal(updated.write_status, "failed", "no plan file -> non-retryable failure");

        const queueRow = db
          .prepare("SELECT * FROM decision_queue WHERE kind = 'writeback_failed' AND ref_id = ?")
          .get(disp.id);
        assert.ok(queueRow, "should have enqueued a writeback_failed row");
        assert.equal(
          queueRow.project_id,
          "proj-s6-writeback",
          "the queue row must carry the disposition's project_id, not NULL"
        );
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });

    it("GET /api/decision-queue?project_id= filters to only that project's rows", async () => {
      const cwdX = fs.mkdtempSync(path.join(os.tmpdir(), "s6-route-x-"));
      const cwdY = fs.mkdtempSync(path.join(os.tmpdir(), "s6-route-y-"));
      try {
        stmts.insertProject.run("proj-s6-route-x", "S6 route test X");
        stmts.insertProject.run("proj-s6-route-y", "S6 route test Y");
        stmts.insertProjectPath.run("proj-s6-route-x", cwdX);
        stmts.insertProjectPath.run("proj-s6-route-y", cwdY);
        stmts.insertDecisionQueueItem.run(
          cwdX,
          "proj-s6-route-x",
          "pace_alert",
          null,
          null,
          "X needs a look",
          null,
          null
        );
        stmts.insertDecisionQueueItem.run(
          cwdY,
          "proj-s6-route-y",
          "pace_alert",
          null,
          null,
          "Y needs a look",
          null,
          null
        );

        const res = await fetch("/api/decision-queue?project_id=proj-s6-route-x");
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.queue));
        assert.ok(res.body.queue.length > 0, "should return at least the seeded row");
        assert.ok(
          res.body.queue.every((r) => r.project_id === "proj-s6-route-x"),
          "every returned row must belong to the requested project_id"
        );
        assert.ok(
          !res.body.queue.some((r) => r.message === "Y needs a look"),
          "a different project's row must not leak through the filter"
        );
      } finally {
        fs.rmSync(cwdX, { recursive: true, force: true });
        fs.rmSync(cwdY, { recursive: true, force: true });
      }
    });
  });

  // S9 (2026-08-01 reconciliation-pass fix): a detour that reaches
  // classifyFlaggedDetours a second time via listStaleResolvedDetours, while
  // already terminal (fold_in/new_item) from an earlier tick whose write
  // CONFLICTED (write_status='conflict', resolved_at still NULL — the row
  // stays in the stale-detection window), must not have its fresh LLM
  // verdict silently dropped in favor of re-applying the OLD stored
  // proposal. reconciliation.js discarded resolveDisposition's return value
  // and called applyDisposition unconditionally; applyDisposition reads
  // row.proposed_text fresh from the DB by id — since resolveDisposition
  // rejects a re-resolve of an already-terminal row (ALREADY_RESOLVED) and
  // leaves proposed_text untouched, the "fresh" read is actually the STALE
  // value.
  describe("S9: a stale-resolved (terminal) detour's fresh LLM verdict must not re-apply the OLD stored proposal", () => {
    it("skips the write entirely — old proposed_text and write_status are both left untouched", async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "s9-stale-conflict-"));
      try {
        writePlan(cwd, "# Plan\n\n- [ ] 1. Existing item\n      id: existing-001\n");
        const ingested = ingestPlanForCwd(dbModule, cwd);
        assert(ingested.ok, "ingestPlanForCwd failed");

        // Seed the detour row, then hand-craft the exact "already terminal,
        // write conflicted, but still inside the stale-detection window"
        // state: disposition/decided_by/proposed_text set as if a PRIOR
        // tick's resolveDisposition + applyDisposition already ran and the
        // write conflicted (resolved_at stays NULL for conflict/failed —
        // only a successful write stamps it, per plan-writeback.js).
        // source_seen_at > resolved_at is listStaleResolvedDetours' own
        // "the underlying inference changed since the decision" condition;
        // resolved_at is deliberately non-NULL here purely to satisfy that
        // query's WHERE clause and reproduce the exact row shape the
        // review's report described, not to claim this state is reachable
        // through resolveDisposition/applyDisposition alone today (that
        // requires two overlapping reconcileCwd calls for the same cwd —
        // itself possible since reconcileCwd carries no per-cwd mutex of
        // its own; see the review's S9 finding).
        const insertRes = stmts.upsertDetourDisposition.run(
          cwd,
          null,
          "s9-session",
          "inferred",
          "s9-session",
          new Date(Date.now() - 3 * 86_400_000).toISOString(),
          "S9 stale detour",
          null
        );
        const dispositionId = insertRes.lastInsertRowid;
        const resolvedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
        const sourceSeenAt = new Date(Date.now() - 86_400_000).toISOString();
        db.prepare(
          `UPDATE detour_dispositions SET
             disposition = 'new_item', decided_by = 'llm', confidence = 0.9,
             proposed_text = 'OLD PROPOSAL TEXT', write_status = 'conflict',
             resolved_at = ?, source_seen_at = ?
           WHERE id = ?`
        ).run(resolvedAt, sourceSeenAt, dispositionId);

        const beforeFile = readPlan(cwd);
        const beforeRow = stmts.getDetourDisposition.get(dispositionId);
        assert.equal(beforeRow.disposition, "new_item");
        assert.equal(beforeRow.write_status, "conflict");

        // Sanity: this row is actually reachable via listStaleResolvedDetours
        // (the R3 rule), not via listPendingDetours (disposition isn't
        // 'pending') — otherwise this test would prove nothing.
        const stale = stmts.listStaleResolvedDetours.all(cwd, 10);
        assert.ok(
          stale.some((r) => r.id === dispositionId),
          "fixture row must surface via listStaleResolvedDetours"
        );
        const pending = stmts.listPendingDetours.all(cwd, 10);
        assert.ok(
          !pending.some((r) => r.id === dispositionId),
          "fixture row must NOT be in listPendingDetours"
        );

        // Fresh LLM verdict on the re-classification pass — a DIFFERENT
        // proposal than what's already stored.
        const freshVerdict = {
          disposition: "new_item",
          confidence: 0.95,
          reason: "Re-checked, still a new item",
          proposed_text: "NEW PROPOSAL TEXT",
          proposed_acceptance: null,
          proposed_detail: null,
          proposed_parent_item_id: null,
        };
        __injectSpawnForTest(() => fakeSpawn({ stdout: envelope(freshVerdict) })());

        await reconcileCwd(dbModule, cwd);

        const afterRow = stmts.getDetourDisposition.get(dispositionId);
        assert.equal(
          afterRow.proposed_text,
          "OLD PROPOSAL TEXT",
          "resolveDisposition must reject the re-resolve of a terminal disposition — proposed_text must not change"
        );
        assert.equal(
          afterRow.write_status,
          "conflict",
          "applyDisposition must be skipped for an already-terminal row rejected by resolveDisposition — write_status must stay 'conflict', not flip to 'written'/'failed'"
        );
        assert.equal(
          afterRow.resolved_item_id,
          null,
          "no plan_items row should have been created from this tick"
        );

        const afterFile = readPlan(cwd);
        assert.equal(
          afterFile,
          beforeFile,
          "no write attempt — old OR new proposal — should have touched AGENT-PLAN.md"
        );
        assert.ok(!afterFile.includes("OLD PROPOSAL TEXT"));
        assert.ok(!afterFile.includes("NEW PROPOSAL TEXT"));
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });
  });
});
