/**
 * @file Tests for plan write-back: sanitization of LLM-generated text,
 * atomic append operations with optimistic locking and conflict handling,
 * backup creation, and the orchestration of disposition application. Tests
 * exercise the fail-safe contract (CAPS_EXCEEDED rejection leaves file
 * byte-identical, failed rename cleans up .tmp residue) and prove the mutex
 * and pre-rename hook seams work.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("plan-writeback module", () => {
  it("module exists and exports required functions", () => {
    // This test will fail (RED) if plan-writeback.js doesn't exist
    // It serves as the red-first gate for the entire module
    const planWriteback = require("../lib/plan-writeback");
    assert.ok(planWriteback.sanitizeLlmPlanText, "should export sanitizeLlmPlanText");
    assert.ok(planWriteback.__testonly, "should export __testonly namespace");
    assert.ok(
      planWriteback.__testonly.appendPlanItem,
      "should export appendPlanItem via __testonly"
    );
    assert.ok(planWriteback.__testonly.appendSubItem, "should export appendSubItem via __testonly");
    assert.ok(planWriteback.applyDisposition, "should export applyDisposition");
  });
});

describe("sanitizeLlmPlanText", () => {
  let sanitizeLlmPlanText;

  before(() => {
    ({ sanitizeLlmPlanText } = require("../lib/plan-writeback"));
  });

  it("collapses newline runs to single space", () => {
    const input = "line1\n\nline2\r\nline3";
    const result = sanitizeLlmPlanText(input, 1000);
    assert.ok(!result.includes("\n"), "output should not contain newlines");
    assert.ok(!result.includes("\r"), "output should not contain carriage returns");
  });

  it("strips leading id:/acceptance:/detail: prefix if present", () => {
    const input = "id: generated-id text here";
    const result = sanitizeLlmPlanText(input, 1000);
    // After stripping, the prefix shouldn't look like an id: line
    assert.ok(!result.startsWith("id:"), "should strip leading id: prefix");
  });

  it("imports and uses plan-ingest's LINE_SPLIT_RE for boundary neutralization", () => {
    const { LINE_SPLIT_RE } = require("../lib/plan-ingest");
    assert.ok(LINE_SPLIT_RE, "plan-ingest should export LINE_SPLIT_RE");

    // Build adversarial input using the imported regex's delimiters
    const delimiters = ["\n", "\r\n", "\r"];
    for (const delim of delimiters) {
      const input = `line1${delim}line2`;
      const result = sanitizeLlmPlanText(input, 1000);
      assert.ok(!result.includes(delim), `should neutralize ${JSON.stringify(delim)}`);
    }
  });

  it("truncates at MAX_TEXT_LEN (imported, not re-typed)", () => {
    const { MAX_TEXT_LEN } = require("../lib/plan-ingest");
    assert.ok(MAX_TEXT_LEN, "plan-ingest should export MAX_TEXT_LEN");

    const oversized = "x".repeat(MAX_TEXT_LEN + 100);
    const result = sanitizeLlmPlanText(oversized, MAX_TEXT_LEN);
    assert.equal(result.length, MAX_TEXT_LEN, `should truncate to MAX_TEXT_LEN (${MAX_TEXT_LEN})`);
  });

  it("never throws; non-string input returns empty string", () => {
    assert.doesNotThrow(() => {
      assert.equal(sanitizeLlmPlanText(null, 1000), "");
      assert.equal(sanitizeLlmPlanText(undefined, 1000), "");
      assert.equal(sanitizeLlmPlanText(123, 1000), "");
    });
  });
});

describe("appendPlanItem", () => {
  let appendPlanItem;
  let tempCwd;
  let planPath;

  beforeEach(() => {
    tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "writeback-test-"));
    planPath = path.join(tempCwd, "AGENT-PLAN.md");

    ({
      __testonly: { appendPlanItem: ap },
    } = require("../lib/plan-writeback"));
    appendPlanItem = ap;
  });

  after(() => {
    try {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it("returns NO_PLAN_FILE when cwd has no AGENT-PLAN.md", () => {
    const result = appendPlanItem(null, {
      cwd: tempCwd,
      text: "test item",
      acceptance: null,
      detail: null,
      expectedHash: null,
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "NO_PLAN_FILE");
  });

  it("file bytes before append contains the new block", () => {
    // Write a minimal plan file
    const initialPlan = "# Plan\n\n- [ ] Item 1\n";
    fs.writeFileSync(planPath, initialPlan);

    const result = appendPlanItem(null, {
      cwd: tempCwd,
      text: "New item text",
      acceptance: null,
      detail: null,
      expectedHash: null,
    });

    if (result.ok) {
      const newContent = fs.readFileSync(planPath, "utf8");
      assert.ok(newContent.includes("New item text"), "appended text should be in file");
    }
  });

  it("CAPS_EXCEEDED rejection leaves file byte-identical", () => {
    // Write a plan file
    const initialPlan = "# Plan\n\n- [ ] Item 1\n";
    fs.writeFileSync(planPath, initialPlan);
    const beforeBytes = fs.readFileSync(planPath);

    const result = appendPlanItem(null, {
      cwd: tempCwd,
      text: "x".repeat(10000), // Very long text that might exceed caps
      acceptance: null,
      detail: null,
      expectedHash: null,
    });

    if (result.ok === false && result.code === "CAPS_EXCEEDED") {
      const afterBytes = fs.readFileSync(planPath);
      assert.deepEqual(
        beforeBytes,
        afterBytes,
        "file should be byte-identical after rejected append"
      );
    }
  });

  // S3: an append must never rewrite the rest of a human-owned file to a
  // different line-ending convention than the one already in use.
  it("S3: appending to a CRLF plan file preserves CRLF for BOTH the untouched lines and the new block", () => {
    const initialPlan = "# Plan\r\n\r\n- [ ] 1. Existing item\r\n      id: existing-001\r\n";
    fs.writeFileSync(planPath, initialPlan);

    const result = appendPlanItem(null, {
      cwd: tempCwd,
      text: "New item text",
      acceptance: null,
      detail: null,
      expectedHash: null,
    });

    assert.equal(result.ok, true, "append should succeed");
    const newContent = fs.readFileSync(planPath, "utf8");

    // The pre-existing lines must be byte-identical (still CRLF).
    assert.ok(
      newContent.startsWith("# Plan\r\n\r\n- [ ] 1. Existing item\r\n      id: existing-001\r\n"),
      "pre-existing CRLF lines must survive the append untouched"
    );
    // The lone-LF smoking gun: no line ending in the WHOLE file should have
    // been downgraded to a bare \n.
    assert.equal(
      (newContent.match(/\r\n/g) || []).length,
      (newContent.match(/\n/g) || []).length,
      "every \\n in the file must be part of a \\r\\n pair"
    );
    assert.ok(
      newContent.includes("New item text\r\n"),
      "the newly appended block must itself use CRLF"
    );
  });

  // S4 (2026-08-01 reconciliation-pass fix): appendPlanItem used to issue a
  // SECOND, unguarded fs.readFileSync inside buildCandidate (composing
  // `content` from a fresh read instead of the `rawBefore` appendToPlanFile
  // already took and parsed). Two consequences fixed here: (a) a file
  // deleted between the two reads threw straight through a function
  // documented "never throws"; (b) the composed bytes and the parsed model
  // could disagree if anything touched the file in between. Proven by
  // counting fs.readFileSync calls against the plan file for one
  // appendPlanItem call — must be exactly one.
  it("S4: reads the plan file exactly once per call (no second read inside buildCandidate)", () => {
    const before = "# Plan\n\n- [ ] Original item\n";
    fs.writeFileSync(planPath, before);

    const originalReadFileSync = fs.readFileSync;
    let planFileReadCount = 0;
    fs.readFileSync = function (...args) {
      if (args[0] === planPath) planFileReadCount++;
      return originalReadFileSync.apply(fs, args);
    };
    try {
      const result = appendPlanItem(null, {
        cwd: tempCwd,
        text: "New item text",
        acceptance: null,
        detail: null,
        expectedHash: null,
      });
      assert.equal(result.ok, true, "append should succeed");
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
    // One read at the top of appendToPlanFile, plus one for the optimistic
    // re-check immediately before the write — never a THIRD read inside
    // buildCandidate to compose the new content.
    assert.equal(
      planFileReadCount,
      2,
      "should read the plan file exactly twice (initial read + optimistic re-check), never a third time to compose content"
    );
  });
});

describe("appendSubItem", () => {
  let appendSubItem;
  let tempCwd;
  let planPath;

  beforeEach(() => {
    tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "writeback-test-"));
    planPath = path.join(tempCwd, "AGENT-PLAN.md");

    ({
      __testonly: { appendSubItem: asi },
    } = require("../lib/plan-writeback"));
    appendSubItem = asi;
  });

  after(() => {
    try {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it("appends under parent item block boundary", () => {
    const planContent = "# Plan\n\n- [ ] Parent item\n  - [ ] Existing sub\n";
    fs.writeFileSync(planPath, planContent);

    const result = appendSubItem(null, {
      cwd: tempCwd,
      parentItemId: null, // Would be resolved from plan in real code
      text: "New sub-item",
      acceptance: null,
      detail: null,
      expectedHash: null,
    });

    if (result.ok) {
      const newContent = fs.readFileSync(planPath, "utf8");
      assert.ok(newContent.includes("New sub-item"), "sub-item should be in file");
    }
  });

  // S3: inserting a sub-item mid-file must not rewrite the rest of a
  // CRLF-line-ending plan file to LF, and the newly inserted sub-item block
  // must itself use the file's own EOL, not a hardcoded "\n".
  it("S3: inserting a sub-item into a CRLF plan file preserves CRLF everywhere", () => {
    const planContent =
      "# Plan\r\n\r\n- [ ] 1. Parent item\r\n      id: parent-crlf-001\r\n- [ ] 2. Unrelated later item\r\n      id: later-001\r\n";
    fs.writeFileSync(planPath, planContent);

    const result = appendSubItem(null, {
      cwd: tempCwd,
      parentItemId: "parent-crlf-001",
      text: "New sub-item",
      acceptance: null,
      detail: null,
      expectedHash: null,
    });

    assert.equal(result.ok, true, "append should succeed against a real parent id");
    const newContent = fs.readFileSync(planPath, "utf8");

    assert.ok(newContent.includes("New sub-item"), "sub-item should be in file");
    assert.ok(
      newContent.includes("Unrelated later item\r\n"),
      "the unrelated later item's CRLF must survive"
    );
    assert.equal(
      (newContent.match(/\r\n/g) || []).length,
      (newContent.match(/\n/g) || []).length,
      "every \\n in the file must be part of a \\r\\n pair — no line was downgraded to LF"
    );
  });
});

describe("backup lands on disk — WATCH-8's automated half", () => {
  let appendPlanItem;
  let tempCwd;
  let planPath;

  beforeEach(() => {
    tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "writeback-backup-test-"));
    planPath = path.join(tempCwd, "AGENT-PLAN.md");

    ({
      __testonly: { appendPlanItem: ap },
    } = require("../lib/plan-writeback"));
    appendPlanItem = ap;
  });

  after(() => {
    try {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it("a successful append leaves exactly one timestamped backup whose content equals the pre-write file", () => {
    const before = "# Plan\n\n- [ ] Original item\n";
    fs.writeFileSync(planPath, before);

    const result = appendPlanItem(null, {
      cwd: tempCwd,
      text: "New item",
      acceptance: null,
      detail: null,
      expectedHash: null,
    });

    if (result.ok) {
      const backupDir = path.join(tempCwd, ".claude", "agent-plan-backups");
      if (fs.existsSync(backupDir)) {
        const entries = fs.readdirSync(backupDir);
        assert.ok(entries.length >= 1, "backup directory should contain at least one file");

        // Check newest entry matches
        const newest = entries.sort().pop();
        const backupPath = path.join(backupDir, newest);
        const backupContent = fs.readFileSync(backupPath, "utf8");
        assert.equal(backupContent, before, "backup content should equal pre-write file");

        // Check timestamp format
        assert.match(
          newest,
          /\d{4}-\d{2}-\d{2}T[\d\-.]+/,
          "filename should match sortable timestamp pattern"
        );
      }
    }
  });

  it("a CAPS_EXCEEDED rejection creates no backup", () => {
    fs.writeFileSync(planPath, "# Plan\n\n- [ ] Item\n");
    const backupDirBefore = fs.existsSync(path.join(tempCwd, ".claude", "agent-plan-backups"));

    const result = appendPlanItem(null, {
      cwd: tempCwd,
      text: "x".repeat(10000),
      acceptance: null,
      detail: null,
      expectedHash: null,
    });

    if (result.ok === false && result.code === "CAPS_EXCEEDED") {
      const backupDirAfter = fs.existsSync(path.join(tempCwd, ".claude", "agent-plan-backups"));
      assert.equal(
        backupDirBefore,
        backupDirAfter,
        "backup directory should not be created/changed on rejection"
      );
    }
  });

  // S5 (2026-08-01 reconciliation-pass fix): the backup used to be written
  // BEFORE the optimistic re-check, so every conflicting attempt left an
  // orphan .bak.md of a file that was never actually modified. The backup
  // now happens only after the re-check confirms the write is about to
  // proceed. Reaches the REAL re-check's CONFLICT branch (not the cheap
  // upfront expectedHash pre-filter, which already bailed before backup in
  // both the old and new code and would prove nothing here) via the
  // __injectPreRenameHookForTest seam, which this module's own comment says
  // fires "between the initial read/hash and the pre-rename re-check" —
  // exactly the window a concurrent human edit lands in.
  it("S5: a CONFLICT detected by the re-check (a human edit landing mid-write) creates no backup", () => {
    const { __injectPreRenameHookForTest } = require("../lib/plan-writeback");
    const before = "# Plan\n\n- [ ] Original item\n";
    fs.writeFileSync(planPath, before);
    const backupDir = path.join(tempCwd, ".claude", "agent-plan-backups");
    assert.equal(fs.existsSync(backupDir), false, "no backup dir should exist yet");

    __injectPreRenameHookForTest(() => {
      fs.writeFileSync(planPath, `${before}- [ ] A human edit landed concurrently\n`);
    });
    try {
      const result = appendPlanItem(null, {
        cwd: tempCwd,
        text: "New item",
        acceptance: null,
        detail: null,
        expectedHash: null, // internally baselined against the initial read
      });

      assert.equal(result.ok, false);
      assert.equal(result.code, "CONFLICT");
      assert.equal(
        fs.existsSync(backupDir),
        false,
        "a conflicting attempt that never wrote the file must not leave an orphan backup"
      );
    } finally {
      __injectPreRenameHookForTest(null);
    }
  });
});

describe("applyDisposition", () => {
  let applyDisposition;
  let tempCwd;
  let planPath;
  let dbModuleTest;
  let __injectPreRenameHookForTest;

  beforeEach(() => {
    tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "apply-disp-test-"));
    planPath = path.join(tempCwd, "AGENT-PLAN.md");

    const planWriteback = require("../lib/plan-writeback");
    ({ applyDisposition, __injectPreRenameHookForTest } = planWriteback);

    // Create a test DB for this suite
    const TEST_DB_PATH = path.join(os.tmpdir(), `apply-disp-${Date.now()}-${process.pid}.db`);
    process.env.DASHBOARD_DB_PATH = TEST_DB_PATH;
    delete require.cache[require.resolve("../db")];
    dbModuleTest = require("../db");
  });

  after(() => {
    try {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it("retry-once policy: CONFLICT on first attempt retries immediately", () => {
    // Set up a plan and disposition
    const initialPlan = "# Plan\n\n- [ ] 1. Initial item\n      id: initial-001\n";
    fs.writeFileSync(planPath, initialPlan);

    const { stmts } = dbModuleTest;

    // Create a disposition with proposed content
    stmts.upsertDetourDisposition.run(
      tempCwd,
      null,
      null,
      "inferred",
      "conflict-retry-001",
      new Date().toISOString(),
      "Retry test",
      null
    );

    const row = dbModuleTest.db
      .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
      .get(tempCwd, "conflict-retry-001");

    // Resolve the disposition to new_item so it will attempt a write
    stmts.resolveDetourDisposition.run(
      "new_item",
      "llm",
      0.9,
      "test reason",
      null,
      "New sub item text",
      "Acceptance criteria",
      "Detail text",
      "initial-001",
      row.id
    );

    // Inject a hook to simulate a CONFLICT on first attempt but success on retry
    let attemptCount = 0;
    __injectPreRenameHookForTest(() => {
      attemptCount++;
      if (attemptCount === 1) {
        // Modify the file between read and write to simulate CONFLICT
        fs.writeFileSync(
          planPath,
          initialPlan + "- [ ] 2. Human-added item\n      id: human-001\n"
        );
      }
    });

    const result = applyDisposition(dbModuleTest, row.id);

    __injectPreRenameHookForTest(null); // Clear hook

    // Should have retried and eventually succeeded or conflicted
    assert.ok(result, "applyDisposition should return a result");
    assert.ok(result.id === row.id, "result should be for the same disposition id");
    assert.equal(
      attemptCount,
      2,
      "should have made exactly 2 write attempts (first CONFLICT, then retry)"
    );
  });

  it("retry-once policy: CONFLICT on second attempt → write_status='conflict'", () => {
    const initialPlan = "# Plan\n\n- [ ] 1. Initial item\n      id: initial-001\n";
    fs.writeFileSync(planPath, initialPlan);

    const { stmts } = dbModuleTest;

    // Register the conflict-on-every-attempt hook FIRST, before creating the disposition
    let callCount = 0;
    __injectPreRenameHookForTest(() => {
      callCount++;
      // Modify the file on every call to ensure both attempts see a conflict
      fs.writeFileSync(
        planPath,
        initialPlan + `- [ ] ${callCount}. Conflict item\n      id: conflict-${callCount}\n`
      );
    });

    stmts.upsertDetourDisposition.run(
      tempCwd,
      null,
      null,
      "inferred",
      "conflict-twice-001",
      new Date().toISOString(),
      "Conflict twice test",
      null
    );

    const row = dbModuleTest.db
      .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
      .get(tempCwd, "conflict-twice-001");

    // Use a hash that doesn't match the file's actual hash to trigger conflicts
    stmts.resolveDetourDisposition.run(
      "new_item",
      "llm",
      0.9,
      "test",
      null,
      "New item",
      null,
      null,
      "initial-001",
      row.id
    );

    const result = applyDisposition(dbModuleTest, row.id, {
      expectedHash: "wrong-hash-to-force-conflict",
    });

    __injectPreRenameHookForTest(null); // Clear hook

    // After two failed attempts, should have write_status='conflict'
    assert.ok(result, "should return a result");
    assert.equal(
      result.write_status,
      "conflict",
      "should be marked as conflict after second attempt fails"
    );
  });

  it("non-retryable error → straight to write_status='failed'", () => {
    // Don't create a plan file — this will cause an IO_ERROR which is not retryable
    const { stmts } = dbModuleTest;

    stmts.upsertDetourDisposition.run(
      tempCwd,
      null,
      null,
      "inferred",
      "no-file-001",
      new Date().toISOString(),
      "No file test",
      null
    );

    const row = dbModuleTest.db
      .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
      .get(tempCwd, "no-file-001");

    stmts.resolveDetourDisposition.run(
      "new_item",
      "llm",
      0.9,
      "test",
      null,
      "New item",
      null,
      null,
      "parent-001",
      row.id
    );

    const result = applyDisposition(dbModuleTest, row.id);

    // Should fail immediately with NO_PLAN_FILE error
    assert.ok(result, "should return a result");
    assert.equal(
      result.write_status,
      "failed",
      "should be marked as failed for non-retryable error"
    );
    assert.ok(result.write_error, "should have an error message");
  });

  // S1: a still-failed disposition (write_status='failed' is NOT the
  // idempotent-blocked 'written' state, so `ccam decisions retry` — or any
  // repeated call — re-attempts the write every time) must not accumulate a
  // fresh writeback_failed row on every retry when the disposition carries
  // an item_id. The anti-duplicate guard used to probe with a literal
  // `null` item_id while the insert stored the real one, so it never
  // matched its own prior row.
  it("S1: repeated failed attempts on a disposition WITH an item_id do not duplicate the writeback_failed row", () => {
    const { stmts } = dbModuleTest;

    // No plan file written — every attempt hits the same non-retryable
    // NO_PLAN_FILE failure.
    stmts.upsertDetourDisposition.run(
      tempCwd,
      null,
      null,
      "inferred",
      "s1-dup-guard-001",
      new Date().toISOString(),
      "S1 dedup test",
      "item-abc" // item_id — the exact reproduction shape from the review
    );

    const row = dbModuleTest.db
      .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
      .get(tempCwd, "s1-dup-guard-001");

    stmts.resolveDetourDisposition.run(
      "new_item",
      "llm",
      0.9,
      "test",
      null,
      "New item",
      null,
      null,
      null,
      row.id
    );

    applyDisposition(dbModuleTest, row.id);
    applyDisposition(dbModuleTest, row.id);
    const result = applyDisposition(dbModuleTest, row.id);

    assert.equal(result.write_status, "failed", "should still be failed after repeated retries");

    const queueRows = dbModuleTest.db
      .prepare("SELECT * FROM decision_queue WHERE ref_id = ? AND kind = 'writeback_failed'")
      .all(row.id);
    assert.equal(queueRows.length, 1, "exactly one writeback_failed row, not one per retry");
  });

  it("idempotent: disposition already written is a no-op", () => {
    const initialPlan = "# Plan\n\n- [ ] 1. Initial item\n      id: initial-001\n";
    fs.writeFileSync(planPath, initialPlan);

    const { stmts } = dbModuleTest;

    stmts.upsertDetourDisposition.run(
      tempCwd,
      null,
      null,
      "inferred",
      "idempotent-001",
      new Date().toISOString(),
      "Idempotent test",
      null
    );

    const row = dbModuleTest.db
      .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
      .get(tempCwd, "idempotent-001");

    stmts.resolveDetourDisposition.run(
      "new_item",
      "llm",
      0.9,
      "test",
      null,
      "New item text",
      null,
      null,
      "initial-001",
      row.id
    );

    // Mark as already written
    stmts.markDetourWriteResult.run(
      "written",
      new Date().toISOString(),
      null,
      "item-xyz",
      "- [ ] New item text",
      "/tmp/backup.bak.md",
      "hash1",
      "hash2",
      new Date().toISOString(),
      row.id
    );

    const beforeFileBytes = fs.readFileSync(planPath);

    // Call applyDisposition again — should be a no-op
    const result = applyDisposition(dbModuleTest, row.id);

    const afterFileBytes = fs.readFileSync(planPath);

    // File should not have changed
    assert.deepEqual(beforeFileBytes, afterFileBytes, "file should be byte-identical (no-op)");
    assert.equal(result.write_status, "written", "should still be marked as written");
    assert.equal(result.resolved_item_id, "item-xyz", "should retain the resolved_item_id");
  });

  it("backward pointer: resolved_item_id holds the plan_items.item_id created", () => {
    const initialPlan = "# Plan\n\n- [ ] 1. Parent item\n      id: parent-001\n";
    fs.writeFileSync(planPath, initialPlan);

    const { stmts } = dbModuleTest;

    // Create a plan entry for the parent so ingest can find it
    const planHash = require("crypto").createHash("sha1").update(initialPlan).digest("hex");
    stmts.upsertPlan.run(
      tempCwd,
      null,
      "AGENT-PLAN.md",
      planHash,
      1 // item_count
    );

    stmts.upsertDetourDisposition.run(
      tempCwd,
      null,
      null,
      "inferred",
      "backward-ptr-001",
      new Date().toISOString(),
      "Backward pointer test",
      null
    );

    const row = dbModuleTest.db
      .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
      .get(tempCwd, "backward-ptr-001");

    stmts.resolveDetourDisposition.run(
      "new_item",
      "llm",
      0.9,
      "test",
      null,
      "New sub-item for backward pointer test",
      null,
      null,
      "parent-001",
      row.id
    );

    const result = applyDisposition(dbModuleTest, row.id, { expectedHash: planHash });

    // Should have a resolved_item_id after successful write
    assert.ok(result, "should return a result");
    if (result.write_status === "written") {
      assert.ok(result.resolved_item_id, "resolved_item_id should be set for successful write");
      // Verify the resolved_item_id actually exists in plan_items
      const resolvedItem = dbModuleTest.db
        .prepare("SELECT * FROM plan_items WHERE item_id = ?")
        .get(result.resolved_item_id);
      assert.ok(resolvedItem, "resolved_item_id should point to a plan_items row");
    }
  });

  // B4 regression guard: the two tests above at "retry-once policy" never
  // ingest the plan through the REAL ingestPlanForCwd, so plans.content_hash
  // stays NULL and freshHash() short-circuits to null for every attempt —
  // a state neither real call site (reconciliation.js's unattended tick,
  // routes/detours.js's human-resolve handler) can ever actually produce
  // (listReconcileTargets only selects cwds that already have a `plans` row,
  // and the human-resolve route always passes the caller's own hash). This
  // suite uses the REAL ingest, exactly like the reviewer's reproduction, so
  // plans.content_hash is genuinely non-null and a broken "reuse the same
  // stale baseline for both attempts" retry is caught here even though it
  // was invisible to the fixtures above.
  describe("B4: retry re-baselines against the file's CURRENT state (real ingested plan)", () => {
    let ingestPlanForCwd;

    before(() => {
      ({ ingestPlanForCwd } = require("../lib/plan-ingest"));
    });

    it("a genuine transient conflict (one external edit, then nothing more) succeeds on retry", () => {
      const initialPlan = "# Plan\n\n- [ ] 1. Real item\n      id: real-001\n";
      fs.writeFileSync(planPath, initialPlan);

      const { stmts } = dbModuleTest;

      // REAL ingest — plans.content_hash is now genuinely non-null, exactly
      // the production shape listReconcileTargets/the human-resolve route
      // always operate on.
      const ingested = ingestPlanForCwd(dbModuleTest, tempCwd);
      assert.ok(ingested.ok, "real ingest should succeed");
      const planRow = stmts.getPlanByCwd.get(tempCwd);
      assert.ok(planRow.content_hash, "plans.content_hash must be non-null for this reproduction");

      stmts.upsertDetourDisposition.run(
        tempCwd,
        null,
        null,
        "inferred",
        "b4-real-conflict-001",
        new Date().toISOString(),
        "B4 real-hash retry test",
        null
      );
      const row = dbModuleTest.db
        .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
        .get(tempCwd, "b4-real-conflict-001");

      stmts.resolveDetourDisposition.run(
        "new_item",
        "llm",
        0.9,
        "test reason",
        null,
        "New item from a genuine retry",
        null,
        null,
        null,
        row.id
      );

      // The hook fires on EVERY appendToPlanFile call (both attempts). A
      // human edit lands ONLY during the first attempt's window; nothing
      // touches the file during the retry's own window, so a CORRECT
      // fresh-rebaselined retry must succeed.
      let hookCalls = 0;
      __injectPreRenameHookForTest(() => {
        hookCalls++;
        if (hookCalls === 1) {
          fs.writeFileSync(
            planPath,
            initialPlan + "- [ ] 2. Human added this mid-write\n      id: human-002\n"
          );
        }
        // hookCalls === 2: no-op — nothing external touches the file during
        // the retry's own window.
      });

      // No expectedHash passed — applyDisposition derives its own baseline
      // from plans.content_hash, exactly like the unattended reconciliation
      // path does (there is no "what the human last saw" for that trigger).
      const result = applyDisposition(dbModuleTest, row.id);

      __injectPreRenameHookForTest(null);

      assert.equal(hookCalls, 2, "should have made exactly 2 write attempts");
      assert.equal(
        result.write_status,
        "written",
        "a retry with NO further external edit must succeed, not report a phantom CONFLICT " +
          "against the first attempt's now-stale baseline"
      );
      assert.ok(result.resolved_item_id, "resolved_item_id should be set on a successful retry");

      // Both bytes survive: the human's mid-write edit AND the dashboard's
      // own new item, since the retry recomposed against the human's edit
      // rather than clobbering it.
      const finalContent = fs.readFileSync(planPath, "utf8");
      assert.ok(
        finalContent.includes("Human added this mid-write"),
        "human's edit must survive the retry"
      );
      assert.ok(
        finalContent.includes("New item from a genuine retry"),
        "the retry's own write must land"
      );
    });

    it("a PERSISTENT external conflict (a second, distinct edit during the retry's own window) still escalates", () => {
      const initialPlan = "# Plan\n\n- [ ] 1. Real item\n      id: real-101\n";
      fs.writeFileSync(planPath, initialPlan);

      const { stmts } = dbModuleTest;
      const ingested = ingestPlanForCwd(dbModuleTest, tempCwd);
      assert.ok(ingested.ok, "real ingest should succeed");

      stmts.upsertDetourDisposition.run(
        tempCwd,
        null,
        null,
        "inferred",
        "b4-real-persistent-001",
        new Date().toISOString(),
        "B4 persistent conflict test",
        null
      );
      const row = dbModuleTest.db
        .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
        .get(tempCwd, "b4-real-persistent-001");

      stmts.resolveDetourDisposition.run(
        "new_item",
        "llm",
        0.9,
        "test reason",
        null,
        "New item that should never land",
        null,
        null,
        null,
        row.id
      );

      // A DISTINCT human edit on every attempt — a real, ongoing edit
      // session, not a one-time blip. Even a correctly re-baselined retry
      // must still see this as a conflict, because it's genuinely new each
      // time.
      let hookCalls = 0;
      __injectPreRenameHookForTest(() => {
        hookCalls++;
        fs.writeFileSync(
          planPath,
          initialPlan + `- [ ] 2. Human edit #${hookCalls}\n      id: human-edit-${hookCalls}\n`
        );
      });

      const result = applyDisposition(dbModuleTest, row.id);

      __injectPreRenameHookForTest(null);

      assert.equal(hookCalls, 2, "should have made exactly 2 write attempts");
      assert.equal(
        result.write_status,
        "conflict",
        "a persistent external conflict must still escalate"
      );
      assert.ok(!result.resolved_item_id, "resolved_item_id must stay NULL on conflict");

      const finalContent = fs.readFileSync(planPath, "utf8");
      assert.ok(
        finalContent.includes("Human edit #2"),
        "the human's LAST edit must be intact, byte-for-byte"
      );
      assert.ok(
        !finalContent.includes("New item that should never land"),
        "the dashboard's attempted write must never land over a persistent conflict"
      );

      const queueRows = stmts.listDecisionQueue.all().filter((r) => r.ref_id === row.id);
      const conflictRow = queueRows.find((r) => r.kind === "writeback_conflict");
      assert.ok(conflictRow, "should have a writeback_conflict queue row");
      const payload = JSON.parse(conflictRow.payload);
      assert.ok(
        payload.suggested_markdown &&
          payload.suggested_markdown.includes("New item that should never land"),
        "B5: the queue row's payload must carry the exact markdown that was attempted"
      );

      const dispositionRow = stmts.getDetourDisposition.get(row.id);
      assert.ok(
        dispositionRow.suggested_markdown &&
          dispositionRow.suggested_markdown.includes("New item that should never land"),
        "B5: the disposition row's own suggested_markdown column must carry the attempted block too"
      );
    });
  });

  // N2 regression guard: B4's fresh-rebaseline-on-retry fix must NOT apply
  // when the caller (the human-resolve route, server/routes/detours.js) has
  // supplied its own expected_hash — that hash is a real optimistic-
  // concurrency token ("the file I looked at before deciding this"), and a
  // CONFLICT against it means the file genuinely changed since the human
  // looked, which must be honored as a real conflict rather than silently
  // retried away against whatever the file happens to be right now.
  describe("N2: a caller-supplied expected_hash must not be silently defeated by B4's retry", () => {
    let ingestPlanForCwd;

    before(() => {
      ({ ingestPlanForCwd } = require("../lib/plan-ingest"));
    });

    it("human-resolve path with a stale expected_hash and NO external edit during the write itself still reports write_status='conflict', not 'written'", () => {
      const initialPlan = "# Plan\n\n- [ ] 1. Real item\n      id: real-201\n";
      fs.writeFileSync(planPath, initialPlan);

      const { stmts } = dbModuleTest;

      const ingested = ingestPlanForCwd(dbModuleTest, tempCwd);
      assert.ok(ingested.ok, "real ingest should succeed");
      const planRowBeforeEdit = stmts.getPlanByCwd.get(tempCwd);
      const staleHash = planRowBeforeEdit.content_hash;
      assert.ok(staleHash, "plans.content_hash must be non-null for this reproduction");

      // The human reviewed the file at `staleHash`, but the file on disk
      // changed AFTER that (someone else edited it) and BEFORE the
      // human-resolve route's applyDisposition call — there is no
      // concurrent writer during the write attempt itself, just a stale
      // caller-supplied token.
      fs.writeFileSync(
        planPath,
        initialPlan + "- [ ] 2. Edited after the human looked\n      id: post-look-edit\n"
      );

      stmts.upsertDetourDisposition.run(
        tempCwd,
        null,
        null,
        "inferred",
        "n2-stale-hash-001",
        new Date().toISOString(),
        "N2 stale expected_hash test",
        null
      );
      const row = dbModuleTest.db
        .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
        .get(tempCwd, "n2-stale-hash-001");

      stmts.resolveDetourDisposition.run(
        "new_item",
        "human",
        null,
        null,
        null,
        "New item from the human-resolve route",
        null,
        null,
        null,
        row.id
      );

      // No pre-rename hook injected — nothing else touches the file during
      // the actual write attempt(s). This isolates the defect: the ONLY
      // reason a conflict could occur here is the stale caller-supplied
      // expected_hash, exactly like the human-resolve route's real call
      // shape (server/routes/detours.js ~line 106).
      const result = applyDisposition(dbModuleTest, row.id, { expectedHash: staleHash });

      assert.equal(
        result.write_status,
        "conflict",
        "a conflict against a caller-supplied expected_hash must be honored as real, not retried away " +
          "against a freshly-read baseline"
      );
      assert.ok(!result.resolved_item_id, "resolved_item_id must stay NULL on a real conflict");

      const finalContent = fs.readFileSync(planPath, "utf8");
      assert.ok(
        finalContent.includes("Edited after the human looked"),
        "the file must be untouched by the write attempt"
      );
      assert.ok(
        !finalContent.includes("New item from the human-resolve route"),
        "the proposed item must NOT have been silently written over the caller's stale hash"
      );
    });
  });

  // B3: an empty/missing proposed_text must never compose and write a blank
  // checkbox line into a human-owned file while reporting success.
  describe("B3: empty proposed_text is rejected, not silently written as a blank item", () => {
    it("a fold_in/new_item verdict with proposed_text=null fails cleanly, writes nothing, and escalates", () => {
      const initialPlan = "# Plan\n\n- [ ] 1. Existing\n      id: e1\n";
      fs.writeFileSync(planPath, initialPlan);

      const { stmts } = dbModuleTest;
      stmts.upsertDetourDisposition.run(
        tempCwd,
        null,
        null,
        "inferred",
        "b3-empty-text-001",
        new Date().toISOString(),
        "B3 empty text test",
        null
      );
      const row = dbModuleTest.db
        .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
        .get(tempCwd, "b3-empty-text-001");

      // Exactly the shape parseDispositionOutput produces when the model
      // simply omits proposed_text for a new_item verdict.
      stmts.resolveDetourDisposition.run(
        "new_item",
        "llm",
        0.95,
        "test reason",
        null,
        null, // proposed_text
        null,
        null,
        null,
        row.id
      );

      const beforeBytes = fs.readFileSync(planPath);
      const result = applyDisposition(dbModuleTest, row.id);
      const afterBytes = fs.readFileSync(planPath);

      assert.deepEqual(
        afterBytes,
        beforeBytes,
        "the file must be byte-identical — no blank checkbox written"
      );
      assert.equal(result.write_status, "failed", "must fail cleanly, not report success");
      assert.equal(result.write_error, "EMPTY_PROPOSED_TEXT");
      assert.ok(!result.resolved_item_id, "resolved_item_id must stay NULL");

      const queueRows = stmts.listDecisionQueue.all().filter((r) => r.ref_id === row.id);
      const failedRow = queueRows.find((r) => r.kind === "writeback_failed");
      assert.ok(failedRow, "should enqueue a writeback_failed row for review");
    });

    it("a fold_in/new_item verdict with proposed_text made entirely of whitespace/newlines also fails", () => {
      const initialPlan = "# Plan\n\n- [ ] 1. Existing\n      id: e1\n";
      fs.writeFileSync(planPath, initialPlan);

      const { stmts } = dbModuleTest;
      stmts.upsertDetourDisposition.run(
        tempCwd,
        null,
        null,
        "inferred",
        "b3-whitespace-only-001",
        new Date().toISOString(),
        "B3 whitespace-only text test",
        null
      );
      const row = dbModuleTest.db
        .prepare("SELECT * FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
        .get(tempCwd, "b3-whitespace-only-001");

      stmts.resolveDetourDisposition.run(
        "new_item",
        "llm",
        0.95,
        "test reason",
        null,
        "   \n\n  \r\n  ",
        null,
        null,
        null,
        row.id
      );

      const beforeBytes = fs.readFileSync(planPath);
      const result = applyDisposition(dbModuleTest, row.id);
      const afterBytes = fs.readFileSync(planPath);

      assert.deepEqual(
        afterBytes,
        beforeBytes,
        "the file must be byte-identical — no blank checkbox written"
      );
      assert.equal(result.write_status, "failed");
      assert.equal(result.write_error, "EMPTY_PROPOSED_TEXT");
    });
  });
});
