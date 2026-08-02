# Build Task List — build-project-manager (layers 4–6)

**Effort slug:** `2026-08-01-build-project-manager`  
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor`  
**Branch:** `effort/2026-08-01-build-project-manager` (starting commit `3c2db7d`)  
**Date prepared:** 2026-08-01  

---

## Overview

This is the **single buildable sequence** merging `technical-plan.md`'s implementation steps (§4, layer-ordered 0–30+) with `test-plan.md`'s red-first test specs (steps 1–23) into one ordered task list. Every test is written and observed RED before the product code it guards. Each layer terminates with a "show Sara" checkpoint (DEC-3). Mandatory durable-cure tasks are marked and cited by defect-catalog id; build-blocking constraints (DEC-10, DEC-15) are enforced as implementation requirements, not afterthoughts.

**All work happens in the isolated worktree only** — paths below are relative to the worktree root unless otherwise noted (e.g. `server/db.js` means the worktree's `server/db.js`).

---

## Task 0 — Baseline & Grandfather Sets

**Files touched:** None (read-only audit)  
**Layer:** Setup  
**Type:** Test  
**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor
npm run test:server
# Expected: baseline 1087 pass / 0 fail, 250 suites
```

### Instructions

1. Verify the working tree is clean: `git status` shows only the starting branch, no uncommitted changes.
2. Run the full server test suite and record the baseline count: `npm run test:server`.
3. **Freeze the two grandfather sets** (both needed before writing any product code):
   - **(a) ALTER TABLE grandfather set:** Read `server/db.js` as plain text. Find every line matching `/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/g`. Snapshot the set of all matched `table.column` pairs into `server/__tests__/db-migration.test.js` later (see Task 6). Comment them with today's date (`2026-08-01`). This set must never widen; a new column added without an upgrade-case test must fail step 6's meta-test.
   - **(b) Grandfather queries:** Scan `server/db.js`, `server/lib/detours.js`, `server/lib/reconciliation.js`, and `server/routes/*.js` for SQL string literals that:
     - Select FROM `(events|focus_inferences|detour_dispositions|decision_queue)` AND
     - Contain a `LIMIT` clause
   
     For each match, check if `ORDER BY created_at` appears **before** `LIMIT`. Any that don't will snapshot into `server/__tests__/chronology-ordering.test.js` later (see Task 19). Comment with date.

### Rationale

Both sets are pre-build snapshots of today's codebase. They are **never to be widened** — they exist to catch *future* violations, not today's code. The ratchet works only if established before any new code lands.

---

## Task 1 — Write db-migration.test.js (pre-migration harness, red-first)

**Files touched:** `server/__tests__/db-migration.test.js` (new, write-first)  
**Layer:** 5 (pre-step for schema testing)  
**Type:** Test (RED-FIRST)  
**Component:** Schema & migration  
**Mandatory:** Yes — **G1, new class (no catalog id yet, but no existing ALTER test in any repo has been *executed*)** — this is the first time this repo's 35 ALTER TABLE statements are tested.  
**Done-check:**
```bash
node --test server/__tests__/db-migration.test.js
# Expected: FAIL on "plan_items has target_date column" (module not yet updated)
```

### Instructions

Write the new file `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor/server/__tests__/db-migration.test.js` with:

1. **File header:** Copyright + author line (`@author Son Nguyen <hoangson091104@gmail.com>`) per `.claude/rules/file-headers.md`.

2. **Preamble:** 
   - Freezes the grandfather set collected in Task 0(a) — an array named `GRANDFATHERED` containing all pre-existing `table.column` pairs from the `ALTER TABLE … ADD COLUMN` statements currently in `db.js` (formatted as e.g. `"plan_items.intro_until"`).
   - This must include `agents.workflow_run_id`, `plan_items.item_id` rebuild, `plan_items.parent_item_id` rebuild, `plan_items.cache_write_1h_per_mtok`, `plan_items.intro_until`, and any others found in step 0(a).
   - Comment: `// Grandfather set, snapshotted 2026-08-01 before layer-5 build started. New columns must have an UPGRADE_CASES entry; do not add to this array.`

3. **`UPGRADE_CASES` array** — start with one entry for `plan_items.target_date` (not yet implemented; this entry defines what red means):
   ```javascript
   const UPGRADE_CASES = [
     {
       table: "plan_items",
       column: "target_date",
       legacySql: `...`, // The CREATE TABLE shape WITHOUT target_date
       seed(db) { 
         // Create a plans row + plan_items row in legacy shape
       },
       assertLegacyRow(db) { 
         // Assert pre-existing row reads target_date = null
       },
       assertWritable(stmts) { 
         // Assert stmts.setPlanItemTargetDate.run works on legacy row
       }
     }
   ];
   ```

4. **Helper:** `describe("Migration: plan_items.target_date")` with the six sub-steps from test-plan §A:
   - Create a temp DB with current CREATE TABLE shape minus `target_date`, insert a legacy row
   - Point `DASHBOARD_DB_PATH` at the file, bust the `require("../db")` cache
   - Assert `PRAGMA table_info(plan_items)` now includes `target_date`
   - Assert legacy row reads `target_date === null`
   - Assert `stmts.setPlanItemTargetDate.run(...)` works against the legacy row
   - Re-require DB; idempotent, no throw

5. **Meta-test:** `it("every ALTER TABLE … ADD COLUMN in db.js has an upgrade case or is grandfathered")` — regex scan + assertion per test-plan §A.

6. **Restore DB state:** In `after()` hook, restore `DASHBOARD_DB_PATH` to its original value and `delete require.cache[require.resolve("../db")]`.

### Red-First Observation

Run the spec now. It will fail because `server/db.js` does not yet have `target_date` — the assertion `PRAGMA table_info(plan_items)` will not find it. **Record this red state.** This is what "red-first" means — the test fails by construction before the code exists.

---

## Task 2 — Land Layer 5 Schema (both halves, the sibling-pair rule)

**Files touched:** `server/db.js`  
**Layer:** 5  
**Type:** Implementation  
**Component:** Schema (CREATE + migration)  
**Done-check:**
```bash
# Verify schema loaded, re-run Task 1 spec
node --test server/__tests__/db-migration.test.js
# Expected: PASS on the migration test (green); meta-test still passes
npm run test:server
# Expected: baseline 1087 unchanged (no behavior change yet, just schema)
```

### Instructions

Edit `server/db.js` to add `target_date TEXT` in **two places**:

1. **In the `plan_items` CREATE TABLE block (~L571-586)** — add the column after `declared_done_session`:
   ```sql
   target_date TEXT,
   ```

2. **Extend the schema comment (~L551-570)** to name `target_date` as deliberately excluded, mirroring the `declared_done_at` comment.

3. **In the migration block after the `plan_items` rebuild + unique-index at (~L789)**, add the `try/SELECT/catch/ALTER` pattern (model: `agents.workflow_run_id` at ~L794-799):
   ```js
   // Migrate: give plan_items an optional human-set target date (layer 5 pace
   // tracking). Date-only YYYY-MM-DD, local calendar day. Additive and
   // nullable — no rename-rebuild needed. Deliberately NOT written by
   // upsertPlanItem, so it survives re-ingest exactly like declared_done_at.
   try {
     db.prepare("SELECT target_date FROM plan_items LIMIT 1").get();
   } catch {
     db.prepare("ALTER TABLE plan_items ADD COLUMN target_date TEXT").run();
   }
   ```

4. **Add the prepared statement** next to `setPlanItemDeclaredDone` (~L2186):
   ```js
   setPlanItemTargetDate: db.prepare(
     "UPDATE plan_items SET target_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cwd = ? AND item_number = ?"
   ),
   ```

### Rationale

Both the CREATE TABLE and the ALTER TABLE block must be updated in **all** new column additions. Fresh installs read the CREATE TABLE; upgrading installs read the ALTER. They must agree, or a fresh DB and an upgraded DB end up with different shapes.

---

## Task 3 — Write pace-tracking.test.js (red-first)

**Files touched:** `server/__tests__/pace-tracking.test.js` (new)  
**Layer:** 5  
**Type:** Test (RED-FIRST)  
**Component:** pace.js derivation lib  
**Mandatory:** No, but defines §9.1's pace computation (must be single, exclusive function)  
**Done-check:**
```bash
node --test server/__tests__/pace-tracking.test.js
# Expected: FAIL on module-not-found (server/lib/pace.js does not exist)
```

### Instructions

Write `server/__tests__/pace-tracking.test.js` following `test-plan.md` §B, `unit-tests.md` §1 exactly:

1. **File header** with author line.

2. **Test suite structure** (all sub-steps from test-plan §B and §1):
   - `describe("isComplete")` — 4 cases incl. `checked` precedence over `declared_done_at`
   - `describe("paceStatus — no_target")` — 4 cases, each asserting `status !== "behind"`
   - `describe("paceStatus — on_track/behind boundary")` — 6 cases including the DEC-6 pin: `"target_date equal to today is on_track, not behind"`
   - `describe("paceStatus — completed items never behind")` — 3 cases
   - `describe("localDayString")` — local-vs-UTC boundary case
   - **Meta-test:** `it("exports PACE_STATUSES registry with all values exercised")` — iterates the exported array and asserts no unused value

3. **Helper:** `const item = (overrides = {}) => ({ ... })` — a POJO factory per `unit-tests.md` §1.

4. **Key case assertions:**
   - `isComplete({ checked: 1 }).complete === true`
   - `isComplete({ declared_done_at: "2026-08-01..." }).complete === true`
   - `paceStatus(item { target_date: today }).status === "on_track"` (not `behind`)
   - `paceStatus(item { target_date: yesterday }).status === "behind"` and `days_overdue > 0`
   - `paceStatus(complete_item { target_date: far_past }).status === "done"` (never behind)
   - Invalid date string or malformed → `no_target`

### Red-First Observation

The test fails because `server/lib/pace.js` does not exist. **Record this.**

---

## Task 4 — Land server/lib/pace.js

**Files touched:** `server/lib/pace.js` (new)  
**Layer:** 5  
**Type:** Implementation  
**Component:** Pace derivation lib (§9.1 single shared function, day 1)  
**Done-check:**
```bash
node --test server/__tests__/pace-tracking.test.js
# Expected: PASS (all cases)
```

### Instructions

Write `server/lib/pace.js` with the mandatory file header. Implement per `technical-plan.md` §4 step 6:

```javascript
// Four exported functions + one export array

// localDayString(date) → YYYY-MM-DD in local time
// Use: new Date(...).toLocaleDateString('en-CA')

// isComplete(item) → { complete: bool, signal: "checked"|"declared"|null }
// complete when item.checked === 1 OR item.declared_done_at is set
// signal tells which one fired (precedence: checked first)

// paceStatus(item, { now = new Date(), graceDays = 0 } = {})
// → { status: "no_target"|"on_track"|"behind"|"done", 
//      target_date, days_overdue, completed_signal }
// Resolution order (per DEC-5, DEC-6):
//   1. isComplete(item).complete → "done" (never behind)
//   2. no target_date / invalid format / not real date → "no_target"
//   3. localDayString(now) > target_date by > graceDays → "behind"
//   4. else → "on_track"
// Boundary: target_date === today is on_track; behind starts next day

// PACE_STATUSES export (array, for registry-completeness meta-test)
// = ["no_target", "on_track", "behind", "done"]
```

Never re-implement this logic anywhere else (§9.1 by construction). Layer 6 will call it; no other code may.

---

## Task 5 — Extend plan-ingest.test.js with target_date survival + exports

**Files touched:** `server/__tests__/plan-ingest.test.js`  
**Layer:** 5  
**Type:** Test extension  
**Component:** plan-ingest behavior (preserves target_date out-of-band)  
**Done-check:**
```bash
# After Task 6's exports are added to plan-ingest.js:
node --test server/__tests__/plan-ingest.test.js
# Expected: new case passes (target_date survives re-ingest unchanged)
# Expected: export-surface assertion passes (all regexes + caps exported)
```

### Instructions

Add two things to `server/__tests__/plan-ingest.test.js`:

1. **Case: target_date survives re-ingest** (sibling of existing `declared_done_*` survival test at ~L235):
   ```javascript
   it("preserves target_date across re-ingest, untouched by upsertPlanItem", () => {
     // Set an item's target_date via setPlanItemTargetDate
     // Edit the plan file (unrelated content)
     // Re-ingest
     // Assert target_date is unchanged (not reset, not nulled)
   });
   ```
   
   This case specifically catches the DEC-10-violating design where `target_date` would be in `upsertPlanItem`'s `SET` clause — that implementation resets the value on every reformat, which this test catches.

2. **Export-surface assertion:**
   ```javascript
   it("exports ID_LINE_RE, ACCEPTANCE_LINE_RE, DETAIL_LINE_RE, LINE_SPLIT_RE, and MAX_* caps", () => {
     const planIngest = require("../lib/plan-ingest");
     assert.ok(planIngest.ID_LINE_RE);
     assert.ok(planIngest.ACCEPTANCE_LINE_RE);
     assert.ok(planIngest.DETAIL_LINE_RE);
     assert.ok(planIngest.LINE_SPLIT_RE);
     assert.ok(planIngest.MAX_FILE_BYTES);
     assert.ok(planIngest.MAX_ITEMS);
     assert.ok(planIngest.MAX_TEXT_LEN);
     assert.ok(planIngest.MAX_ACCEPTANCE_LEN);
     assert.ok(planIngest.MAX_DETAIL_LEN);
   });
   ```

This gates a future refactor from silently dropping an export that `plan-writeback.js` depends on (test-plan gap).

---

## Task 6 — Update server/lib/plan-ingest.js: additive exports + header fix

**Files touched:** `server/lib/plan-ingest.js`  
**Layer:** 5  
**Type:** Implementation (exports-only, no behavior change)  
**Component:** plan-ingest exports + header documentation  
**Done-check:**
```bash
node --test server/__tests__/plan-ingest.test.js
# Expected: export-surface assertion passes
```

### Instructions

1. **Update the file header** (currently says "the dashboard never writes AGENT-PLAN.md") to reflect the truth after this build:
   ```javascript
   // server/lib/plan-ingest.js
   // 
   // Read and parse AGENT-PLAN.md into plan_items rows.
   // The file is the single source of truth, human-owned.
   // The dashboard now appends to it through one audited path
   // (server/lib/plan-writeback.js), and reads it back through this
   // ingest like every other trigger.
   ```

2. **Add to `module.exports` block (~L438-445)**:
   ```javascript
   ID_LINE_RE,
   ACCEPTANCE_LINE_RE,
   DETAIL_LINE_RE,
   LINE_SPLIT_RE,
   MAX_FILE_BYTES,
   MAX_ITEMS,
   MAX_TEXT_LEN,
   MAX_ACCEPTANCE_LEN,
   MAX_DETAIL_LEN,
   ```

No other changes. These are existing constants already defined in the file; they are now exported so `plan-writeback.js` can import and re-use them.

---

## Task 7 — Add POST /api/plans/items/target route

**Files touched:** `server/routes/plans.js`, `server/openapi-extra/misc.js`  
**Layer:** 5  
**Type:** Implementation  
**Component:** HTTP route + spec  
**Done-check:**
```bash
# After Task 8 extends the test:
node --test server/__tests__/plans-api.test.js
# Expected: new POST /api/plans/items/target cases pass
# Expected: no new WebSocket message type invented (reuses existing plan_updated)
```

### Instructions

1. **In `server/routes/plans.js`**, add the new route:
   ```javascript
   // POST /api/plans/items/target
   // Set or clear a plan item's target date (layer 5 pace tracking)
   // Body: { cwd, item_number, target_date }
   // target_date: null (clear) or YYYY-MM-DD string that parses to real date
   
   router.post("/plans/items/target", async (req, res) => {
     const { cwd, item_number, target_date } = req.body;
     
     // Validate: cwd non-empty string, item_number positive int,
     // target_date null or YYYY-MM-DD parsing to real date
     // Return 400 with { error: "..." } on validation failure
     
     // getPlanItem(cwd, item_number) → 404 if not found
     
     // stmts.setPlanItemTargetDate.run(target_date, cwd, item_number)
     
     // Broadcast existing plan_updated message type:
     // broadcast("plan_updated", { plan, items: stmts.listPlanItems.all(cwd) })
     
     res.json({ ok: true, item });
   });
   ```

2. **In `server/openapi-extra/misc.js`**, add OpenAPI entry for the route (consult existing route entries for structure).

3. **Validation per `.claude/rules/backend-node.md`:**
   - `cwd`: non-empty string
   - `item_number`: positive integer
   - `target_date`: `null` or matches `/^\d{4}-\d{2}-\d{2}$/` and parses to a valid date
   - Return structured `400 { error: "..." }` on any validation failure

---

## Task 8 — Extend plans-api.test.js with POST /api/plans/items/target

**Files touched:** `server/__tests__/plans-api.test.js`  
**Layer:** 5  
**Type:** Test extension  
**Component:** Route contract  
**Done-check:**
```bash
node --test server/__tests__/plans-api.test.js
# Expected: new POST /api/plans/items/target suite passes
```

### Instructions

Add `describe("POST /api/plans/items/target")` with cases from `test-plan.md` and `unit-tests.md` §1:

- Happy path: set date, read back via `GET /api/plans/for-cwd`
- Clear via `target_date: null` → reads back as `null`
- `400` on malformed dates: `"2026-13-45"`, `"friday"`, `"2026-1-5"` (wrong format)
- `404` unknown `item_number`
- `400` missing `cwd` / non-positive-integer `item_number`
- Broadcasts the **existing** `plan_updated` type (assert no new message type was invented)

---

## Task 9 — Add CLI: focus target subcommand

**Files touched:** `bin/ccam.js`  
**Layer:** 5  
**Type:** Implementation  
**Component:** CLI interface  
**Done-check:**
```bash
# After Task 10 extends the test:
node --test server/__tests__/ccam-cli.test.js
# Expected: focus target help + happy path cases pass
```

### Instructions

In `bin/ccam.js`, add the new subcommand in all three registration points:

1. **`COMMAND_GROUPS`** — add to the "Plan & Focus" group:
   ```javascript
   ["focus target <n>", "<YYYY-MM-DD> | --clear", "Set or clear a plan item's target date (pace tracking)"],
   ```

2. **`SUBCOMMANDS.focus`** — add `"target"` to the array.

3. **Inside `cmdFocus` handler** — add a case for the `target` verb, reusing the existing session/cwd resolution logic.

---

## Task 10 — Extend ccam-cli.test.js with focus target

**Files touched:** `server/__tests__/ccam-cli.test.js`  
**Layer:** 5  
**Type:** Test extension  
**Component:** CLI contract  
**Done-check:**
```bash
node --test server/__tests__/ccam-cli.test.js
# Expected: focus target cases pass
# Expected: registry-derived help assertion passes (sync check)
```

### Instructions

1. **Add `describe("focus target")` suite** with:
   - Help text assertion
   - Happy path: `ccam focus target 3 2026-08-15`
   - Clear: `ccam focus target 3 --clear`
   - Validate: `ccam focus target 3 baddate` → error

2. **Add registry-derived help assertion** (this is new, per test-plan §C):
   ```javascript
   it("all COMMAND_GROUPS/SUBCOMMANDS entries appear in help output", () => {
     // Iterate COMMAND_GROUPS and SUBCOMMANDS registries
     // Run `ccam help` and `ccam commands`
     // Assert every entry from the registry appears in output
     // Catches a command registered in one place but not the others
   });
   ```

---

## CHECKPOINT: LAYER 5 — Show Sara

**Layer 5 complete.** Run:

```bash
npm run test:server
# Expected: baseline 1087 + pace-tracking suite + plan-ingest extension + plans-api extension + ccam-cli extension
# NO failures. All new cases green.
```

Review with Sara: `focus target` command now works, and layer 5 can answer "which items are behind pace" from the CLI without any reconciliation logic. Next: the write-back plumbing that forms the foundation for Layer 4.

---

## Task 11 — Write atomic-file.test.js (red-first)

**Files touched:** `server/__tests__/atomic-file.test.js` (new)  
**Layer:** 4(a)  
**Type:** Test (RED-FIRST, foundational)  
**Component:** atomic-file.js primitive  
**Mandatory:** No (G7, infrastructure), but write this before the extraction so regression is caught in isolation.  
**Done-check:**
```bash
node --test server/__tests__/atomic-file.test.js
# Expected: FAIL on module-not-found (doesn't exist yet)
```

### Instructions

Write `server/__tests__/atomic-file.test.js` following `test-plan.md` §B + `unit-tests.md` §2 with 5 failure-path cases:

1. **File header** with author line.

2. **Test suite** (per `unit-tests.md` §2):
   - Happy path: write to a nonexistent file, file exists after with correct content
   - Happy path: overwrite an existing file
   - Failed `renameSync` → original file untouched, no `.tmp` residue (this is the highest-stakes case, the safety claim from the code comment)
   - `fsync` failure → exception propagates
   - Directory does not exist → error, file not created

3. **Mock setup** (use `t.mock.method(fs, "renameSync", ...)` for the rename-failure case).

The load-bearing case is the `renameSync` failure: the assertion is that the original file is **byte-identical** before and after, and the `.tmp` file is cleaned up. This pinpoints the safety claim that currently lives only in a code comment.

---

## Task 12 — Extract atomicWriteFile to atomic-file.js (its own commit)

**Files touched:** `server/lib/atomic-file.js` (new), `server/lib/cc-mutate.js` (refactor only)  
**Layer:** 4(a)  
**Type:** Implementation (extraction, zero behavior change)  
**Component:** Atomic write primitive  
**Done-check:**
```bash
# Immediately after extraction, before touching anything else:
node --test server/__tests__/atomic-file.test.js
# Expected: all 5 cases pass
node --test server/__tests__/cc-config.test.js
# Expected: PASS unchanged (regression gate per technical-plan step 11)
npm run test:server
# Expected: baseline 1087 + atomic-file suite; no other changes
```

### Instructions

1. **Create `server/lib/atomic-file.js`** with file header:
   ```javascript
   /**
    * server/lib/atomic-file.js
    * 
    * Atomic write primitive: tmp file + fsync + rename, with fail-safe cleanup.
    * 
    * @author Son Nguyen <hoangson091104@gmail.com>
    */
   
   const fs = require("fs");
   const path = require("path");
   
   // Copy the entire atomicWriteFile function from cc-mutate.js:218-247 verbatim
   // (no modifications)
   
   module.exports = {
     atomicWriteFile,
   };
   ```

2. **Edit `server/lib/cc-mutate.js`:**
   - Delete the local `atomicWriteFile` definition (lines ~218-247)
   - At the top of the file, add:
     ```javascript
     const { atomicWriteFile } = require("./atomic-file");
     ```
   - Update the two call sites (at `:286` and `:437`) — they remain unchanged, just now calling the imported function instead of the local one

3. **The `module.exports` block in `cc-mutate.js`** (~L527-535) is unchanged — `atomicWriteFile` was never exported from there.

4. **CRITICAL:** Before touching anything else, run the regression gate:
   ```bash
   node --test server/__tests__/cc-config.test.js
   ```
   This must pass unchanged. If it fails, the extraction broke an existing use case; stop and fix it.

5. **Then run the new atomic-file suite:**
   ```bash
   node --test server/__tests__/atomic-file.test.js
   ```
   All 5 cases should pass.

6. **Commit this extraction as its own commit** (not bundled with Layer 4's other changes). The message should note this is a pure move with zero behavioral change, extracted to serve as dual-consumer infrastructure for Layer 4's write-back.

---

## Task 13 — Extend plan-ingest.js exports (verify from Task 6)

**Files touched:** `server/lib/plan-ingest.js`  
**Layer:** 4(a)  
**Type:** Verification  
**Component:** plan-ingest re-exported constants  
**Done-check:**
```bash
node --test server/__tests__/plan-ingest.test.js
# Expected: export-surface assertion passes (from Task 5)
```

This was completed in Task 6. Verify the exports are present.

---

## Task 14 — Write single-writer-guard.test.js (MANDATORY, before plan-writeback.js exists)

**Files touched:** `server/__tests__/single-writer-guard.test.js` (new)  
**Layer:** 4(a)  
**Type:** Test (RED-FIRST structural guard, MANDATORY)  
**Component:** Meta-test for write-path exclusivity  
**Mandatory:** Yes — **G3, §9.1 DERIVED-DUAL-VIEW write-sequence form** — a future third write-composer must fail a test, not ship silently.  
**Done-check:**
```bash
node --test server/__tests__/single-writer-guard.test.js
# Expected: FAIL on "appendPlanItem/appendSubItem exist only in plan-writeback.js"
# (the file doesn't exist yet; the set is empty, expected {plan-writeback.js})
```

### Instructions

Write `server/__tests__/single-writer-guard.test.js` per `test-plan.md` §E. This is a pure source-code scan with no DB, no HTTP.

```javascript
// File header with author line

const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

// Scan server/**/*.js recursively, skipping node_modules/, dist/, server/__tests__/
// For each assertion, show a helpful failure message instructing NOT to widen the allowlist

describe("Single-writer structural guard (§9.1 DERIVED-DUAL-VIEW)", () => {
  
  it("upsertPlanItem has exactly one call site — plan-ingest.js", () => {
    // Scan for files containing "upsertPlanItem"
    // Expected set: {server/db.js, server/lib/plan-ingest.js}
    // (db.js defines it, plan-ingest.js calls it)
    // Failure message: "Do not add a call site. Route the write through plan-writeback.applyDisposition() — see DEC-14 and WATCH-11."
  });
  
  it("no direct INSERT INTO plan_items outside db.js", () => {
    // Scan for SQL string literals matching /INSERT\s+INTO\s+plan_items/i
    // Expected set: {server/db.js} only
  });
  
  it("appendPlanItem / appendSubItem exist only inside plan-writeback.js", () => {
    // For each name, scan all files
    // Expected set for each: {server/lib/plan-writeback.js} only
    // Failure message: "Do not add a file here. Route the write through plan-writeback.applyDisposition() — see DEC-14 and WATCH-11."
  });
  
  it("each write primitive has exactly one call site, and it is inside applyDisposition", () => {
    // Within plan-writeback.js source only:
    // Count call expressions to "appendPlanItem(" and "appendSubItem("
    // Exclude function declarations and exports
    // Expected: exactly 1 call site each, both inside applyDisposition's function body
  });
  
  it("__testonly is never referenced by production code", () => {
    // Scan all files except plan-writeback.js itself
    // No file should contain "__testonly"
  });
});
```

### Red-First Observation

The test **will fail** at step 3 because `appendPlanItem` and `appendSubItem` exist nowhere. This is the correct red for a file that hasn't been written. After Task 15, when `plan-writeback.js` lands with both primitives exactly-once inside `applyDisposition`, this test goes green.

**Critical:** Write this test *before* the module exists so the constraint shapes the implementation rather than being retrofitted.

---

## Task 15 — Write plan-writeback.test.js: sanitizer section (red-first)

**Files touched:** `server/__tests__/plan-writeback.test.js` (new, partial)  
**Layer:** 4(a)  
**Type:** Test (RED-FIRST, foundational)  
**Component:** sanitizeLlmPlanText function  
**Done-check:**
```bash
node --test server/__tests__/plan-writeback.test.js
# Expected: FAIL on module-not-found (plan-writeback.js doesn't exist)
```

### Instructions

Start `server/__tests__/plan-writeback.test.js` with file header + imports. Write the **sanitizer section first** (§3c from test-plan §B + `unit-tests.md` §3c):

```javascript
describe("sanitizeLlmPlanText", () => {
  
  // All sanitizer assertions operate on parse-back through parsePlanMarkdown,
  // not on the sanitized string itself (except explicit cap checks)
  
  it("collapses \\r\\n and \\n runs to single space", () => {
    // Input with embedded newlines → output has none when re-parsed
    const { parsePlanMarkdown } = require("../lib/plan-ingest");
    const sanitized = sanitizeLlmPlanText("line1\n\nline2\r\nline3");
    // Re-parse and assert single continuous text field, no embedded newlines
  });
  
  it("strips leading id:/acceptance:/detail: prefix if present", () => {
    // Input "id: generated-id text" → re-parse finds no forged id: line
    // (the collapse+strip makes it "generated-id text")
  });
  
  // NEW (test-plan change iii, G6, WATCH-11 second half):
  it("every boundary plan-ingest's LINE_SPLIT_RE recognizes is neutralized", () => {
    // Import LINE_SPLIT_RE from plan-ingest (now exported from Task 6)
    // Build adversarial inputs using the **imported** delimiters
    // Never use a hand-copied literal like \\r or \\n
    const LINE_SPLIT_RE = require("../lib/plan-ingest").LINE_SPLIT_RE;
    // Test: join(["line1", "line2"], ...regex matches) → sanitizer collapses
  });
  
  it("cap checks: truncates at MAX_TEXT_LEN (imported, not re-typed)", () => {
    // Import MAX_TEXT_LEN from plan-ingest
    // Assert sanitizer output length === MAX_TEXT_LEN on oversized input
    // Assertion is on **return value**, not parse-back (caps are numeric)
  });
  
  // Similar cap tests for MAX_ACCEPTANCE_LEN, MAX_DETAIL_LEN
  
  it("never throws; non-string input returns empty string", () => {
    // null, undefined, 123 → ""
  });
});
```

---

## Task 16 — Write plan-writeback.test.js: append/write paths (red-first)

**Files touched:** `server/__tests__/plan-writeback.test.js` (continued)  
**Layer:** 4(a)  
**Type:** Test (RED-FIRST)  
**Component:** appendPlanItem, appendSubItem, file write paths  
**Done-check:**
```bash
node --test server/__tests__/plan-writeback.test.js
# Expected: all write-path cases FAIL on module-not-found
```

### Instructions

Add to the same spec file the append-path tests per `test-plan.md` §B + `unit-tests.md` §3a–§3d:

1. **`describe("appendPlanItem")` with cases:**
   - NO_PLAN_FILE error when cwd has no AGENT-PLAN.md
   - File bytes before append contains the new block (before ingest runs)
   - Round-trip: append → re-parse → row indistinguishable from human-typed
   - Optimistic lock: pre-check hash vs. expected, abort on CONFLICT before parsing
   - CAPS_EXCEEDED rejection: file byte-identical after rejection (no partial write)
   - Per-cwd mutex serializes two concurrent appends to same cwd

2. **`describe("appendSubItem")` with cases:**
   - Appends under the parent item's block (after parent's checkbox + existing sub-items)
   - Parent boundary detection via parsePlanMarkdown output (not a second regex pass)
   - Same conflict/caps checks as appendPlanItem

3. **NEW (test-plan §B change ii, G5):**
   ```javascript
   describe("backup lands on disk — WATCH-8's automated half", () => {
     
     it("a successful append leaves exactly one timestamped backup", () => {
       // Capture before = fs.readFileSync(planPath)
       // Append
       // Assert fs.readdirSync(path.join(cwd, ".claude", "agent-plan-backups"))
       //   has ≥1 entry
       // Assert newest entry's content === before (byte-for-byte)
       // Assert filename matches /\d{4}-\d{2}-\d{2}T[\d\-.]+/ (sortable timestamp)
     });
     
     it("a CAPS_EXCEEDED rejection creates no backup", () => {
       // Negative control: backups dir unchanged or absent after rejected append
     });
   });
   ```

4. **`__testonly` namespace:**
   ```javascript
   // At the end of the test file, export these for test access only:
   const { __testonly } = require("../lib/plan-writeback");
   // Access via __testonly.appendPlanItem, __testonly.appendSubItem
   ```

---

## Task 17 — Land server/lib/plan-writeback.js (partial: sanitizer + append primitives)

**Files touched:** `server/lib/plan-writeback.js` (new, partial — functions 1–3 only, not `applyDisposition` yet)  
**Layer:** 4(a)  
**Type:** Implementation  
**Component:** Write-path primitives (file mutation)  
**Done-check:**
```bash
node --test server/__tests__/plan-writeback.test.js
# Expected: sanitizer cases pass
# Expected: append cases pass (using __testonly exports)
# Expected: single-writer-guard.test.js now FAILS differently 
#           (appendPlanItem found in {plan-writeback.js}, but assertion on call sites fails — not yet inside applyDisposition)
```

### Instructions

Write `server/lib/plan-writeback.js` with file header. Implement the first three functions per `technical-plan.md` §4 step 13:

1. **`sanitizeLlmPlanText(input, maxLen)`**
   - Collapse `\r`/`\n` runs (use the imported `LINE_SPLIT_RE` from plan-ingest) to single space
   - Collapse consecutive whitespace
   - Trim
   - Strip leading `id:`/`acceptance:`/`detail:` prefix if the result still matches the field regex
   - `slice(0, maxLen)`
   - Never throws; non-string → `""`

2. **`appendPlanItem(dbModule, { cwd, text, acceptance, detail, expectedHash })`**
   - Acquire per-cwd mutex (Map<cwd, Promise> keyed on the **byte-identical** cwd string)
   - Read file fresh, hash it → `hashBefore`; missing file → `{ ok:false, code:'NO_PLAN_FILE' }`
   - Pre-check: `expectedHash` mismatch → `{ ok:false, code:'CONFLICT', currentHash }`
   - Parse file to find max item number, existing id set, backup path
   - Mint new id via `crypto.randomBytes(4).toString("hex")`; regenerate on collision
   - Sanitize each field independently
   - Pre-flight caps check: would file exceed `MAX_ITEMS` or `MAX_FILE_BYTES`? → `{ ok:false, code:'CAPS_EXCEEDED' }`
   - Timestamped backup to `<cwd>/.claude/agent-plan-backups/AGENT-PLAN.<timestamp>.bak.md`
   - `__injectPreRenameHookForTest` seam (if set, call it before re-check)
   - Re-read and re-hash; changed? → `{ ok:false, code:'CONFLICT', currentHash }`
   - Atomic write via `atomic-file.js`
   - Call real `ingestPlanForCwd(dbModule, cwd)` in-process (never calls `upsertPlanItem`)
   - Return `{ ok:true, itemId, hashBefore, hashAfter, backupPath, markdown, plan, items }`
   - Never throws; all failures are structured `{ ok:false, code }`

3. **`appendSubItem(dbModule, { cwd, parentItemId, text, acceptance, detail, expectedHash })`**
   - Same as `appendPlanItem`, except:
   - Insert after the parent's block boundaries (checkbox line + existing sub-items)
   - Use `parsePlanMarkdown` output to find boundaries, not a second regex pass

4. **`__injectPreRenameHookForTest(fn)`** — setter for the test seam.

5. **`module.exports`:** Export `sanitizeLlmPlanText`, plus `__testonly = { appendPlanItem, appendSubItem }`, plus `__injectPreRenameHookForTest`.

---

## Task 18 — Extend focus-inference.test.js: classification doesn't write (test before hook)

**Files touched:** `server/__tests__/focus-inference.test.js`  
**Layer:** 4(b)  
**Type:** Test extension  
**Component:** Classifier fail-safe (detour recording does not trigger file write)  
**Done-check:**
```bash
# After Task 21 lands the hook:
node --test server/__tests__/focus-inference.test.js
# Expected: new §4h cases pass
```

### Instructions

Add to `server/__tests__/focus-inference.test.js` within the existing `describe("inferSession")` block (per test-plan §C + `unit-tests.md` §4h):

```javascript
describe("recording detours does not write AGENT-PLAN.md", () => {
  
  it("classification never writes AGENT-PLAN.md — file is byte-identical before/after", () => {
    // Create a plan file
    // Call inferSession with a session result that produces a detour
    // Assert file bytes are **identical** before and after
    // (This proves the classifier cannot reach applyDisposition, only recordInferredDetour)
  });
});
```

This is the structural proof that the classifier (the hot path that runs on every session) cannot reach the file-write code.

---

## Task 19 — Write detour-disposition.test.js (red-first)

**Files touched:** `server/__tests__/detour-disposition.test.js` (new)  
**Layer:** 4(b)  
**Type:** Test (RED-FIRST)  
**Component:** Detour disposition lifecycle  
**Mandatory:** No (but defines disposition enum via meta-test)  
**Done-check:**
```bash
node --test server/__tests__/detour-disposition.test.js
# Expected: FAIL on module-not-found (detours.js doesn't exist)
```

### Instructions

Write `server/__tests__/detour-disposition.test.js` per `test-plan.md` §B + `unit-tests.md` §4a–§4f, §4i:

1. **File header** with author line.

2. **Meta-test:**
   ```javascript
   it("DISPOSITIONS enum matches SQL CHECK(disposition IN (...))", () => {
     const { DISPOSITIONS } = require("../lib/detours");
     // Query sqlite_master for the CHECK constraint on detour_dispositions.disposition
     // Parse the enum values
     // Assert DISPOSITIONS array equals the SQL CHECK set (order-independent)
   });
   ```
   
   This is the registry-completeness check. The JS array is the canonical source; SQL is a rendered path.

3. **Enum guard test:**
   ```javascript
   it("disposition values are only fold_in, new_item, deliberate, discard", () => {
     // Iterate DISPOSITIONS and assert only these four values
   });
   ```

4. **Transition tests** (per `unit-tests.md` §4b):
   - `pending` → any disposition via `resolveDisposition`
   - `fold_in`/`new_item` cannot be reverted
   - `deliberate`/`discard` do not write (resolved directly)
   - Durability across re-inference: re-inferencing a session doesn't clobber an already-decided disposition

5. **Idempotency test:**
   - Resolving the same disposition twice produces the same row state

6. **Write-status lifecycle** (with `applyDisposition` stubbed):
   - `pending` → `written` (on successful write)
   - `pending` → `failed` (on non-retryable error)
   - `pending` → `conflict` (on CONFLICT after retry)

---

## Task 20 — Extend plan-writeback.test.js: applyDisposition (red-first)

**Files touched:** `server/__tests__/plan-writeback.test.js` (continued, §3e–§3f)  
**Layer:** 4(b)  
**Type:** Test extension  
**Component:** Disposition orchestration + write-audit  
**Done-check:**
```bash
node --test server/__tests__/plan-writeback.test.js
# Expected: applyDisposition cases FAIL (module structure not yet in place)
```

### Instructions

Add to `server/__tests__/plan-writeback.test.js`:

```javascript
describe("applyDisposition", () => {
  
  it("retry-once policy: CONFLICT on first attempt retries immediately", () => {
    // Inject a conflict on first attempt
    // Assert exactly two write attempts
    // Second attempt succeeds
  });
  
  it("retry-once policy: CONFLICT on second attempt → write_status='conflict'", () => {
    // Inject conflict on both attempts
    // Assert write_status='conflict', resolved_item_id=NULL, resolved_at=NULL
    // Assert decision_queue row kind='writeback_conflict' created
  });
  
  it("non-retryable error → straight to write_status='failed'", () => {
    // NO_PLAN_FILE / CAPS_EXCEEDED → immediate fail, no retry
  });
  
  it("idempotent: disposition already written is a no-op", () => {
    // Call applyDisposition twice
    // Second call returns without re-writing
  });
  
  it("backward pointer: resolved_item_id holds the plan_items.item_id created", () => {
    // After successful write, query detour_dispositions
    // Assert resolved_item_id matches the item_id in plan_items
    // (not the integer PK — DEC-14)
  });
});
```

---

## Task 21 — Land server/lib/detours.js

**Files touched:** `server/lib/detours.js` (new)  
**Layer:** 4(b)  
**Type:** Implementation  
**Component:** Detour disposition module  
**Done-check:**
```bash
node --test server/__tests__/detour-disposition.test.js
# Expected: enum meta-test passes; other cases pass
npm run test:server
# Expected: baseline + detour-disposition suite green
```

### Instructions

Write `server/lib/detours.js` with file header. Implement per `technical-plan.md` §4 step 17:

1. **`DISPOSITIONS` export** (the one place the enum is spelled):
   ```javascript
   const DISPOSITIONS = ["fold_in", "new_item", "deliberate", "discard"];
   module.exports = { DISPOSITIONS, recordInferredDetour, ... };
   ```

2. **`recordInferredDetour(dbModule, row, result)`** (called from classifier)
   - Upsert a `pending` row with `source='inferred'`, `source_ref=row.id` (session id), `source_seen_at=<inferred_at just written>`, `label=result.label`, `item_id=result.item_id`
   - Never throws
   - Never writes a file (recording ≠ deciding)

3. **`backfillDeclaredDetours(dbModule, cwd, sinceIso)`** (called at tick startup)
   - Read `events` where `event_type='Focus'` and parsed `data.verb` is `push`/`bug`/`feature`
   - `ORDER BY created_at ASC, id ASC` (§9.2 — workflow-ingest bulk-inserts, so id order ≠ chronological)
   - Upsert one `source='declared'` row per event

4. **`resolveDisposition(dbModule, id, { disposition, decided_by, confidence, reason, proposed_text, proposed_acceptance, proposed_detail, proposed_parent_item_id, note })`**
   - Validate `disposition` against `DISPOSITIONS`
   - Record the verdict and proposed content
   - **Do NOT write the file** and **do NOT stamp `resolved_at`** for `fold_in`/`new_item` — those are `applyDisposition`'s job
   - For `deliberate`/`discard`, stamp `resolved_at` directly (nothing to write)
   - Return the updated row

---

## Task 22 — Land plan-writeback.js: applyDisposition (complete the module)

**Files touched:** `server/lib/plan-writeback.js` (continued, function 4)  
**Layer:** 4(b)  
**Type:** Implementation  
**Component:** Disposition → file write orchestration  
**Done-check:**
```bash
node --test server/__tests__/plan-writeback.test.js
# Expected: §3e/§3f applyDisposition cases pass
node --test server/__tests__/single-writer-guard.test.js
# Expected: NOW PASSES — both appendPlanItem and appendSubItem are found
#           inside applyDisposition, exactly one call site each
```

### Instructions

Complete `server/lib/plan-writeback.js` with the fourth function per `technical-plan.md` §4 step 13(iv):

**`applyDisposition(dbModule, dispositionId, { broadcast, retried })`** — the single orchestration path both DEC-13 trigger points call:

1. Load the `detour_dispositions` row by id
2. Stamp `write_status='pending'`, `write_attempted_at` (via `markDetourWritePending`)
3. Dispatch on `disposition`:
   - `fold_in` → `appendSubItem(dbModule, { cwd, parentItemId: proposed_parent_item_id, text: proposed_text, ... })`
   - `new_item` → `appendPlanItem(dbModule, { cwd, text: proposed_text, ... })`
   - `deliberate`/`discard` → **no file write**, resolve the row (resolve directly), return

4. For the unattended path, derive `expectedHash` from `stmts.getPlanByCwd.get(cwd).content_hash` immediately before the call
5. For the human-resolve path, use the hash the caller passed

6. **Retry-once-then-escalate policy** (lines 557–562 of `technical-plan.md` table):
   - `CONFLICT` on first attempt: retry immediately with a fully-fresh read/hash, no reused `expectedHash`
   - `CONFLICT` on retry: stop, `write_status='conflict'`, leave `resolved_item_id` and `resolved_at` NULL, insert `decision_queue` row `kind='writeback_conflict'`
   - `CAPS_EXCEEDED`/`NO_PLAN_FILE`/`IO_ERROR`: no retry, straight to `write_status='failed'`, insert `decision_queue` row `kind='writeback_failed'`

7. Write the outcome onto the disposition row in **one** statement (`markDetourWriteResult`):
   - `write_status`, `write_completed_at`, `write_error`, `resolved_item_id`, `suggested_markdown`, `write_backup_path`, `write_content_hash_before`/`_after`, `resolved_at`
   - This ensures the row never ends up half-consistent

8. Idempotency: if the row is already at `write_status='written'`, return the existing `resolved_item_id` without re-writing

9. Return the updated row

---

## Task 23 — Land detour_dispositions + decision_queue schema & statements

**Files touched:** `server/db.js`  
**Layer:** 4(b)  
**Type:** Implementation (schema)  
**Component:** Database tables + prepared statements  
**Mandatory:** Yes — **DEC-15: both tables' full final shape in initial CREATE TABLE** (CHECK constraints can't be widened via ALTER)  
**Done-check:**
```bash
npm run test:server
# Expected: baseline + all prior suites still green
# (No SQL migration needed; fresh DB loads the CREATE, upgrading DB has the tables from this moment forward)
```

### Instructions

In `server/db.js`, in the same `db.exec` block as `focus_inferences` (~L626-639), add both new tables **with their full final shape from the start**:

**1. `detour_dispositions` table** (per `technical-plan.md` §4 step 15, exact SQL):
```sql
CREATE TABLE IF NOT EXISTS detour_dispositions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cwd TEXT NOT NULL,
  session_id TEXT,
  source TEXT NOT NULL CHECK(source IN ('inferred','declared')),
  source_ref TEXT NOT NULL,
  source_seen_at TEXT,
  label TEXT,
  item_id TEXT,
  disposition TEXT NOT NULL DEFAULT 'pending'
    CHECK(disposition IN ('pending','fold_in','new_item','deliberate','discard')),
  decided_by TEXT CHECK(decided_by IN ('rule','llm','human')),
  confidence REAL,
  reason TEXT,
  note TEXT,
  proposed_text TEXT,
  proposed_acceptance TEXT,
  proposed_detail TEXT,
  proposed_parent_item_id TEXT,
  write_status TEXT NOT NULL DEFAULT 'none'
    CHECK(write_status IN ('none','pending','written','failed','conflict')),
  write_attempted_at TEXT,
  write_completed_at TEXT,
  write_error TEXT,
  write_backup_path TEXT,
  write_content_hash_before TEXT,
  write_content_hash_after TEXT,
  suggested_markdown TEXT,
  resolved_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_detour_dispositions_src ON detour_dispositions(cwd, source, source_ref);
CREATE INDEX IF NOT EXISTS idx_detour_dispositions_cwd_created ON detour_dispositions(cwd, created_at);
CREATE INDEX IF NOT EXISTS idx_detour_dispositions_resolved_item ON detour_dispositions(resolved_item_id);
```

Comment block explaining the observation-vs-decision split (inferred vs. declared sources, and the naming trap).

**2. `decision_queue` table** (per `technical-plan.md` §4 step 22, exact SQL):
```sql
CREATE TABLE IF NOT EXISTS decision_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cwd TEXT,
  project_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('pace_alert','detour_volume','detour_disposition','writeback_conflict','writeback_failed')),
  ref_id INTEGER,
  item_id TEXT,
  message TEXT NOT NULL,
  payload TEXT,
  input_digest TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_decision_queue_status_created ON decision_queue(status, created_at);
```

**Key:** Both tables' `CHECK` constraints are **complete and final at creation time** (DEC-15). SQLite cannot ALTER a CHECK — widening either enum requires a full rebuild. Designed for finality.

**3. Prepared statements** (add to the `db.prepare` section per table):

For `detour_dispositions`:
- `upsertDetourDisposition` — ON CONFLICT, update only observation fields (label, item_id, source_seen_at), never decision/write fields
- `listPendingDetours` — `WHERE cwd = ? AND disposition = 'pending' ORDER BY created_at ASC, id ASC LIMIT ?` (§9.2: sort before LIMIT)
- `listStaleResolvedDetours` — detect rows whose underlying inference changed post-decision
- `markDetourWritePending` — sets `write_status='pending'`, `write_attempted_at`
- `markDetourWriteResult` — **one statement** setting all write-audit fields together
- `getDetourDisposition`, `listDetourDispositions`, `resolveDetourDisposition`

For `decision_queue`:
- `insertDecisionQueueItem` — insert a new queue row
- `listDecisionQueue` — `ORDER BY created_at DESC, id DESC` before LIMIT (§9.2)
- `getDecisionQueueItem`, `resolveDecisionQueueItem`
- `findOpenQueueItem` — anti-duplicate guard; `WHERE kind = ? AND ref_id = ? AND item_id = ? AND status = 'pending'`

---

## Task 24 — Land server/routes/detours.js

**Files touched:** `server/routes/detours.js` (new), `server/index.js` (mount), `server/openapi-extra/misc.js` (docs)  
**Layer:** 4(b)  
**Type:** Implementation  
**Component:** HTTP routes  
**Done-check:**
```bash
# After Task 25 extends the test:
node --test server/__tests__/detour-disposition.test.js
# Expected: route contract cases pass
```

### Instructions

1. **Create `server/routes/detours.js`** with file header:

   **`GET /api/detours`** — list dispositions
   - Optional `cwd`, `project_id` (resolved via project_paths join), `status` (`pending`|`resolved`|`conflict`|`failed`), `limit`
   - Returns array of disposition rows

   **`POST /api/detours/:id/resolve`** — resolve a disposition
   - Body: `{ disposition, note, proposed_text?, proposed_acceptance?, proposed_detail?, target_item_id?, expected_hash? }`
   - Validate `disposition` against `DISPOSITIONS` → `400` on mismatch
   - Set `decided_by = 'human'`
   - For `fold_in`/`new_item`: call `applyDisposition(dbModule, id, { broadcast, expectedHash })` **synchronously within the request**
   - Return `{ write_status, resolved_item_id, error? }` in response body
   - Broadcast an additive new type `detour_disposition` with the updated row

2. **In `server/index.js`** (~L98-127), mount the router:
   ```javascript
   app.use("/api/detours", detoursRouter);
   ```

3. **In `server/openapi-extra/misc.js`**, add OpenAPI entries for both endpoints.

---

## Task 25 — Extend detour-disposition.test.js: route contract

**Files touched:** `server/__tests__/detour-disposition.test.js` (continued)  
**Layer:** 4(b)  
**Type:** Test extension  
**Component:** Route contract tests  
**Done-check:**
```bash
node --test server/__tests__/detour-disposition.test.js
# Expected: route cases pass
```

### Instructions

Add to `server/__tests__/detour-disposition.test.js`:

```javascript
describe("GET /api/detours", () => {
  it("lists all pending dispositions for a cwd", () => { ... });
  it("filters by status: resolved, conflict, failed", () => { ... });
  it("respects limit parameter", () => { ... });
});

describe("POST /api/detours/:id/resolve", () => {
  it("accepts fold_in and calls applyDisposition synchronously", () => { ... });
  it("accepts new_item and calls applyDisposition synchronously", () => { ... });
  it("accepts deliberate (no write) and resolves immediately", () => { ... });
  it("accepts discard (no write) and resolves immediately", () => { ... });
  it("400 on unknown disposition", () => { ... });
  it("404 unknown id", () => { ... });
  it("returns write_status and resolved_item_id in response", () => { ... });
  it("broadcasts detour_disposition + plan_updated (if write landed)", () => { ... });
});
```

---

## Task 26 — Wire classifier: focus-inference.js hook

**Files touched:** `server/lib/focus-inference.js`  
**Layer:** 4(b)  
**Type:** Implementation  
**Component:** Classifier integration point  
**Done-check:**
```bash
# After Task 18's test was written:
node --test server/__tests__/focus-inference.test.js
# Expected: §4h byte-identical test passes (file never touched)
npm run test:server
# Expected: baseline + all prior suites still green
```

### Instructions

In `server/lib/focus-inference.js`'s `inferSession` function (~L473-530), immediately **after** the existing `dbModule.stmts.upsertFocusInference.run(...)` call, add (per `technical-plan.md` §4 step 18):

```javascript
if (result.kind === "detour") {
  try {
    require("./detours").recordInferredDetour(dbModule, row, result);
  } catch {
    /* fail-safe: a disposition-record failure must never lose the inference */
  }
}
```

This records a durable detour disposition the instant the classifier sees it, before any decision is made about it. The `try/catch` is the per-stage fail-safe contract.

---

## CHECKPOINT: LAYER 4(a) & (b) — Show Sara

**Layer 4 disposition + write-back complete.** Run:

```bash
npm run test:server
# Expected: baseline + all Layer 4 suites green, NO failures
# (atomic-file, plan-writeback §3a-§3f, detour-disposition, focus-inference §4h)
```

Review with Sara:
- **The write-path plumbing** (`atomic-file.js`, `plan-writeback.js` low-level functions) is fully tested and working.
- **Detour dispositions are durable and resolvable** — every inferred or declared detour has a persistent record that survives re-inference.
- **The file-write path is guarded** by `single-writer-guard.test.js` — a future third write-composer will fail a test, not ship silently.
- **The classifier cannot write the file** — proven by byte-identical assertion in `focus-inference.test.js`.

Next: Layer 6 reconciliation pass, which uses Layer 5's pace logic and Layer 4's disposition records to escalate and classify at scale.

---

## Task 27 — Write chronology-ordering.test.js + helpers/ordering.js (MANDATORY, red-first)

**Files touched:** `server/__tests__/chronology-ordering.test.js` (new), `server/__tests__/helpers/ordering.js` (new)  
**Layer:** 6  
**Type:** Test (RED-FIRST structural guard, MANDATORY)  
**Component:** Meta-test for row-ordering correctness  
**Mandatory:** Yes — **G4, §9.2 row-id-as-chronology-proxy** — all 5 new queries must sort `created_at` before LIMIT; worst case (detour-volume lookback) changes an escalation decision.  
**Done-check:**
```bash
node --test server/__tests__/chronology-ordering.test.js
# Expected: FAIL on detour-volume lookback case (query not yet written)
```

### Instructions

Write two new files:

**1. `server/__tests__/helpers/ordering.js` — helper module** (not a `.test.js` file; safe to exclude from test runner):

```javascript
// File header with author line

const assert = require("assert/strict");

// Helper to test that a query returns the created_at-ordered subset, not id-ordered
// (used by all five chronology-ordering cases)

function assertOrderedByCreatedAt({ seed, run, expected, limit }) {
  // Seed function bulk-inserts rows whose created_at order disagrees with id order
  // (newer timestamps get lower ids — the scrambled-insertion technique)
  // run() executes the query with limit smaller than total row count
  // Assertion: returned set equals the created_at-ordered top-N, not id-ordered
}

module.exports = { assertOrderedByCreatedAt };
```

**2. `server/__tests__/chronology-ordering.test.js`** — behavioral + static scan tests:

**Behavioral cases (in order, worst first — per test-plan §E):**

1. **"Layer 6 detour-volume lookback selects the created_at-ordered window"** (HIGHEST PRIORITY — bug here changes escalation decision)
   - Use `assertOrderedByCreatedAt` helper
   - Query not yet written, so this case is red

2. **"listStaleResolvedDetours returns created_at-ordered rows"**
3. **"listDecisionQueue returns created_at-ordered rows"**
4. **"listPendingDetours returns created_at-ordered rows"**
5. **"backfillDeclaredDetours processes events in created_at order"**

**Static SQL-shape scan (per test-plan §E):**

```javascript
it("every LIMITed query over a bulk-inserted table orders by created_at before LIMIT", () => {
  const fs = require("fs");
  
  // Freeze the grandfather set from Task 0(b):
  const GRANDFATHERED_QUERIES = [
    // Any pre-existing violations found in Task 0, e.g.:
    // "SELECT * FROM events ORDER BY id LIMIT ...", // legacy bad ordering
  ];
  
  // Scan these files for SQL string literals:
  const filesToScan = [
    "server/db.js",
    "server/lib/detours.js",
    "server/lib/reconciliation.js",
    "server/routes/detours.js",
    "server/routes/decision-queue.js",
  ];
  
  // For each file, find SQL literals (both backtick and double-quote strings)
  // matching both:
  //   - FROM (events|focus_inferences|detour_dispositions|decision_queue)
  //   - LIMIT
  // For each match, assert ORDER BY created_at appears before LIMIT
  //
  // Comment grandfathered entries with date
  // Failure message: "New query missing ORDER BY created_at … before LIMIT"
});
```

---

## Task 28 — Write reconciliation.test.js (red-first)

**Files touched:** `server/__tests__/reconciliation.test.js` (new)  
**Layer:** 6  
**Type:** Test (RED-FIRST)  
**Component:** Reconciliation rules + LLM scheduling  
**Mandatory:** No, but rules and digest logic are defined here  
**Done-check:**
```bash
node --test server/__tests__/reconciliation.test.js
# Expected: FAIL on module-not-found (reconciliation.js doesn't exist)
```

### Instructions

Write `server/__tests__/reconciliation.test.js` per `test-plan.md` §B + `unit-tests.md` §5a–§5d:

1. **File header** with author line.

2. **Policy statement in the header** (per test-plan §B):
   ```javascript
   // NOTE: startReconciliation's setInterval registration is untested by
   // deliberate decision, consistent with startFocusAudit/startFocusInference.
   // The tick body (reconcileCwd) is what these tests drive.
   ```

3. **`describe("evaluateRules", () => {`** — pure function, deterministic, zero LLM calls:
   - **R1 pace breach:** for each top-level item, call `pace.paceStatus`; flag when `status === 'behind'` and `days_overdue > DASHBOARD_PACE_GRACE_DAYS`
   - **R2 detour volume:** over a lookback window (`DASHBOARD_RECONCILE_LOOKBACK_DAYS`, default 7), ratio of detour-classified sessions to total classified sessions for the cwd
   - Cases: R1 threshold boundary, R2 ratio threshold, both combined, neither, graceDays knock out case
   - **NEW (per test-plan §B change i, G4 worst case):** `"R2 detour-volume ratio is computed over the created_at-ordered lookback window, not the id-ordered one"` — use the `assertOrderedByCreatedAt` helper with scrambled insertion

4. **`__injectSpawnForTest` installation** in every LLM-expecting test:
   ```javascript
   // Install the throw-on-call stub so the hybrid-escalation-non-inversion invariant is loud
   reconciliation.__injectSpawnForTest(() => { throw new Error("spawn called"); });
   ```

5. **`describe("classifyFlaggedDetours", () => {`** — LLM half:
   - Only ever receives what `evaluateRules` flagged
   - Receives vetted detours in batched prompt
   - Returns structured verdict payload

6. **Hybrid-split guarantee test:**
   ```javascript
   it("evaluateRules is called with 100% of cwds, classifyFlaggedDetours with 0% if rules flag nothing", () => {
     // Seed a cwd with no pace breaches, no high detour volume
     // Call reconcileCwd
     // Assert __injectSpawnForTest throws (evaluateRules never passes a flagged set to LLM)
   });
   ```

7. **Digest gating test:** unchanged flagged set is not re-classified on next tick

---

## Task 29 — Land server/lib/reconciliation.js

**Files touched:** `server/lib/reconciliation.js` (new), `server/index.js` (scheduler wiring), `server/routes/decision-queue.js` (new), `server/openapi-extra/misc.js` (docs)  
**Layer:** 6  
**Type:** Implementation  
**Component:** Reconciliation scheduler + routes  
**Done-check:**
```bash
node --test server/__tests__/reconciliation.test.js
# Expected: all cases pass (no stubs, rules run real, LLM seams injected)
npm run test:server
# Expected: baseline + reconciliation suite green
```

### Instructions

**1. `server/lib/reconciliation.js` with file header:**

- **`startReconciliation(broadcast)`** — start the scheduler loop (uses `DASHBOARD_RECONCILE_MS`, default interval)

- **`reconcileCwd(dbModule, target, opts)`** — one tick for one cwd:
  1. Skip any cwd with `plans.missing_at` set or zero plan items (WATCH-2 mitigation, guards the LLM step)
  2. Call `evaluateRules`
  3. If nothing flagged, return early (cost control)
  4. Call `classifyFlaggedDetours`
  5. For each `fold_in`/`new_item` verdict, call `applyDisposition` — **[DEC-13]** the unattended write trigger point
  6. Broadcast `plan_updated` when a write landed

- **`listReconcileTargets(dbModule, limit)`** — enumerate cwds with plans, skip missing/planless

- **`evaluateRules(dbModule, target, opts)`** — deterministic, ZERO LLM:
  - **R1 pace breach:** for each top-level item, call `pace.paceStatus(item, { now, graceDays })`; flag when `status === 'behind'` and `days_overdue > DASHBOARD_PACE_GRACE_DAYS`
  - **R2 detour volume:** lookback window (`DASHBOARD_RECONCILE_LOOKBACK_DAYS`), ratio of detour-classified sessions (in `focus_inferences` where `kind='detour'`, `created_at` in window) to total classified sessions in same window
  - Returns `{ paceBreaches, detourVolume, flaggedDetours }`

- **`classifyFlaggedDetours(dbModule, target, flaggedDetours, opts)`** — LLM half (called only if `evaluateRules` flagged something):
  - Build one batched prompt per cwd
  - One hermetic `claude -p` spawn, process verdicts
  - Return verdicts keyed by disposition id

- **`computeInputDigest(flaggedDetours)`** — digest gate (avoid re-classifying unchanged flagged set)

- **`buildDispositionPrompt(flaggedDetours, opts)`** — compose the LLM prompt

- **`parseDispositionOutput(text)`** — parse LLM response

- **`__injectSpawnForTest(fn)`** — seam for testing (stub the spawn, not the loop)

**2. `server/routes/decision-queue.js` with file header:**

- **`GET /api/decision-queue`** — list queue items
  - Optional `status` (`pending`|`resolved`|`dismissed`), `kind`, `cwd`
  - Returns array

- **`POST /api/decision-queue/:id/resolve`** — act on a queue item
  - Body: `{ action: "resolve"|"dismiss"|"retry_write" }`
  - For `retry_write`, re-call `applyDisposition` on the linked `detour_dispositions` row
  - Update the queue row's `status` and `resolved_at`

**3. In `server/index.js`:**
- Mount `app.use("/api/decision-queue", decisionQueueRouter)` in the router block
- Start the scheduler in `startBackgroundServices()` (inside its own `try/catch` with same console.warn shape as `startFocusAudit`/`startFocusInference`):
  ```javascript
  try {
    startReconciliation(broadcast);
  } catch (err) {
    console.warn("Failed to start reconciliation scheduler:", err.message);
  }
  ```

**4. In `server/openapi-extra/misc.js`:**
- Add OpenAPI entries for both decision-queue endpoints

---

## Task 30 — Extend ccam-cli.test.js: decisions command

**Files touched:** `server/__tests__/ccam-cli.test.js`  
**Layer:** 6  
**Type:** Test extension  
**Component:** CLI interface  
**Done-check:**
```bash
node --test server/__tests__/ccam-cli.test.js
# Expected: decisions command cases pass
# Expected: registry-derived help assertion passes
```

### Instructions

Add to `server/__tests__/ccam-cli.test.js`:

1. **`describe("decisions")` suite:**
   - Help text
   - List pending queue items: `ccam decisions`
   - Acknowledge: `ccam decisions ack <id>`
   - Dismiss: `ccam decisions dismiss <id>`
   - Retry write: `ccam decisions retry <id>`

2. **Registry-derived help assertion** (if not already added in Task 10):
   - Iterate `COMMAND_GROUPS` and `SUBCOMMANDS` registries
   - Assert every entry appears in `ccam help` output
   - Catches commands registered in one place but not the others

---

## Task 31 — Add CLI: decisions command

**Files touched:** `bin/ccam.js`  
**Layer:** 6  
**Type:** Implementation  
**Component:** CLI interface  
**Done-check:**
```bash
# After Task 30's test:
node --test server/__tests__/ccam-cli.test.js
# Expected: decisions cases pass
```

### Instructions

In `bin/ccam.js`, add the new top-level command in all three registration points:

1. **`COMMAND_GROUPS`** — new entry:
   ```javascript
   ["decisions <action>", "[id]", "View and act on the decision queue"],
   ```

2. **`SUBCOMMANDS.decisions`** — new entry (parallel to existing `SUBCOMMANDS.focus`):
   ```javascript
   decisions: ["", "ack", "dismiss", "retry"],
   ```

3. **`runCommand` switch case** for `"decisions"` — dispatch to `cmdDecisions(args, session)`

4. **`cmdDecisions` handler:**
   - List pending (default): `GET /api/decision-queue`
   - Acknowledge: `POST /api/decision-queue/:id/resolve { action: "resolve" }`
   - Dismiss: `POST /api/decision-queue/:id/resolve { action: "dismiss" }`
   - Retry: `POST /api/decision-queue/:id/resolve { action: "retry_write" }`

---

## Task 32 — Write reconciliation-full-tick.test.js: Scenario A & B (red-first)

**Files touched:** `server/__tests__/reconciliation-full-tick.test.js` (new)  
**Layer:** 6  
**Type:** Test (RED-FIRST, full-chain integration)  
**Component:** End-to-end happy path + conflict escalation  
**Mandatory:** No (base case), but Scenario C (next) is MANDATORY  
**Done-check:**
```bash
node --test server/__tests__/reconciliation-full-tick.test.js
# Expected: FAIL on missing scenarios (scenarios depend on reconciliation.js existing)
```

### Instructions

Write `server/__tests__/reconciliation-full-tick.test.js` per `test-plan.md` §D + `unit-tests.md` §6:

1. **File header** with author line.

2. **Fixture setup** (from `test-plan` §D and §6):
   - Real `fs.mkdtempSync` cwd with real `AGENT-PLAN.md`
   - Real `better-sqlite3` DB
   - Only the `spawn(claude -p ...)` is stubbed (one fake spawn seam)
   - Everything else runs real: `evaluateRules`, `classifyFlaggedDetours`, `applyDisposition`, `atomicWriteFile`, `ingestPlanForCwd`

3. **Scenario A — happy path:**
   - Seed a cwd with a pace-breached item
   - Stub spawn to return `fold_in` verdict
   - Call `reconcileCwd`
   - Assert: file contains the new sub-item, `detour_dispositions` row has `write_status='written'`, `decision_queue` row has `status='pending'`
   - Re-run the tick: digest unchanged, no second spawn call (digest gating)

4. **Scenario B — conflict & escalation:**
   - Seed a cwd with a pace-breached item
   - Stub spawn to return `new_item` verdict
   - **Between stub setup and tick call**, inject the pre-rename hook to simulate a human editor saving the file concurrently
   - Call `reconcileCwd`
   - Assert: write fails, `write_status='conflict'`, `resolved_item_id=NULL`, `resolved_at=NULL`
   - Assert `decision_queue` row `kind='writeback_conflict'`, shows the attempted markdown + current file hash
   - Human's bytes are **byte-identical** before and after (no clobbering)

---

## Task 33 — Write reconciliation-full-tick.test.js: Scenario C (MANDATORY, cross-call-site parity)

**Files touched:** `server/__tests__/reconciliation-full-tick.test.js` (continued)  
**Layer:** 6  
**Type:** Test (RED-FIRST, structural guard, MANDATORY)  
**Component:** Cross-consumer write-sequence parity  
**Mandatory:** Yes — **G2, §9.1 DERIVED-DUAL-VIEW write-sequence form** — the human-resolve route and the reconciliation tick must produce byte-identical plan-file content for identical inputs. This is the only test in the suite where the human-resolve route performs a real write.  
**Done-check:**
```bash
# After Task 29 (reconciliation.js) lands:
node --test server/__tests__/reconciliation-full-tick.test.js
# Expected: Scenario C passes (both call sites now use applyDisposition)
```

### Instructions

Add Scenario C to the same file:

```javascript
describe("§9.1 cross-call-site: human-resolve route and reconciliation tick write identical bytes", () => {
  
  it("both paths produce byte-identical AGENT-PLAN.md for identical inputs", () => {
    // Build two identical fixture cwds A and B
    // Same plan file bytes, same ingested rows, same seeded detour_dispositions row
    
    // Drive cwd A through POST /api/detours/:id/resolve with disposition: "fold_in"
    // and the REAL, UNSTUBBED write path
    // (This is the first and only test where the human-resolve route does a real write)
    
    // Drive cwd B through reconcileCwd with spawn stub returning the SAME verdict
    // (same proposed_text, proposed_acceptance, proposed_parent_item_id)
    
    // Normalize both files identically:
    // - Replace minted id value: /\bid: [0-9a-f]{8}\b/g → id: <ID>
    // - Replace any absolute cwd path
    // - Assert.equal(normalizedA, normalizedB)
    
    // Also assert both detour_dispositions rows land in same state:
    // - write_status === 'written'
    // - resolved_item_id non-null
    // - resolved_at stamped
  });
});
```

**Red-first observation:** This test is red until Task 29 (both call sites unified on `applyDisposition`). It goes green the moment the two paths are proven to delegate to the same orchestration function.

---

## Task 34 — Full suite gate + file-header audit

**Files touched:** None (audit only)  
**Layer:** All  
**Type:** Test & verification  
**Done-check:**
```bash
npm run test:server
# Expected: PASS, 1087 baseline + all new suites
# Exit code: 0
# 0 failures

bash .claude/skills/file-headers/scripts/check-headers.sh
# Expected: exits 0
# All new .js files (8+) have the @author header

npm run test:client
# Expected: PASS, unchanged (zero client changes, WATCH-3)
```

### Instructions

1. **Full server test suite:**
   ```bash
   npm run test:server
   ```
   Record the final count. It should be baseline 1087 plus all new cases.

2. **File-header audit:**
   ```bash
   bash .claude/skills/file-headers/scripts/check-headers.sh
   ```
   This scans all new `.js` source files for the mandatory header. Every new file must have:
   ```javascript
   @author Son Nguyen <hoangson091104@gmail.com>
   ```
   New files in this build: `server/lib/pace.js`, `server/lib/atomic-file.js`, `server/lib/plan-writeback.js`, `server/lib/detours.js`, `server/lib/reconciliation.js`, `server/routes/detours.js`, `server/routes/decision-queue.js`, plus 9 new test files.

3. **Client regression check:**
   ```bash
   npm run test:client
   # Expected: baseline unchanged, 0 failures
   git status
   # Expected: zero client file changes attributable to this effort (WATCH-3)
   ```

---

## Task 35 — Run the three stale-assertion grep gates

**Files touched:** None (audit only)  
**Layer:** All  
**Type:** Verification  
**Done-check:**
```bash
# All three return zero hits (or zero relevant hits)
grep -rn "linked_plan_item_id" server/
# Expected: 0 hits (DEC-14 spelling not used)

grep -rn "plan_items row count is unchanged" server/__tests__/
# Expected: 0 hits tied to fold_in/new_item (DEC-12 residue deleted)

grep -rn "__injectPreRenameHookForTest\|__injectSpawnForTest" server/ --include="*.js" | grep -v "__tests__"
# Expected: 0 hits (injection seams only used in tests, never in product code)
```

### Instructions

Run the three grep scans per `test-plan.md` step 21:

1. **`linked_plan_item_id`:** DEC-14 chose `resolved_item_id` as the spelling. The losing spelling must not appear anywhere in the code.

2. **Stale `plan_items row count is unchanged` assertions:** DEC-12 had rewritten QA's spec into its inverse (advisory-only design). Now that real write-back exists, the original direction is correct again via a different mechanism. The inverted assertions must be **deleted**, not left passing.

3. **Injection seam references:** Both `__injectPreRenameHookForTest` and `__injectSpawnForTest` are test seams and must appear only in test files, never in product code.

---

## Task 36 — Correct documentation: plan-ingest.js header + downstream docs (DEC-8 item 4)

**Files touched:** `server/lib/plan-ingest.js` (header), `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `server/README.md`  
**Layer:** All  
**Type:** Documentation (mandatory correction)  
**Done-check:**
```bash
grep -n "dashboard never writes" ARCHITECTURE.md docs/API.md docs/DATABASE.md server/README.md server/lib/plan-ingest.js
# Expected: 0 hits (claim is corrected, not removed)

grep -n "the file is.*single source of truth" ARCHITECTURE.md docs/API.md docs/DATABASE.md server/README.md server/lib/plan-ingest.js
# Expected: hits showing the corrected claim
```

### Instructions

The claim "the dashboard never writes `AGENT-PLAN.md`" appears in at least:
- `server/lib/plan-ingest.js`'s own file header
- `ARCHITECTURE.md`
- `docs/API.md`
- `docs/DATABASE.md`
- `server/README.md`

**Correct all occurrences** to the accurate form:

> The file is the single source of truth, human-owned. The dashboard now appends to it through one audited path (`server/lib/plan-writeback.js`), and reads it back through the same ingest as always.

This is not a new feature claim; it is a trust-boundary documentation correction. A stale claim about a boundary between systems is worse than no claim.

---

## Task 37 — Correct decisions.md: WATCH-11 + WATCH-8 pointers

**Files touched:** `intake/2026-08-01-build-project-manager/decisions.md`  
**Layer:** All  
**Type:** Documentation (decision log update)  
**Done-check:**
```bash
grep -A5 "^## WATCH-11" intake/2026-08-01-build-project-manager/decisions.md
# Expected: cites server/__tests__/single-writer-guard.test.js and LINE_SPLIT_RE coupling by path

grep -A3 "^## WATCH-8" intake/2026-08-01-build-project-manager/decisions.md
# Expected: cites the new backup assertion in plan-writeback.test.js
```

### Instructions

1. **WATCH-11:** Update from the phrase "mitigation not yet built" to cite the actual file paths:
   - `server/__tests__/single-writer-guard.test.js` (group E, step 9 in test-plan)
   - `LINE_SPLIT_RE` exported from `plan-ingest.js` and imported by `plan-writeback.js` (step 6 in test-plan)

2. **WATCH-8:** Add a pointer to the new backup assertion in `plan-writeback.test.js` (step 11 in test-plan).

If any of steps 6/9/10 (from the test-plan) were cut during build, **reopen WATCH-11 as "PENDING, mitigation not yet designed"** in the same commit — do not let the row stay closed against tests that were cut.

---

## Task 38 — DEC-7 live-trial gate: manual verification by Sara

**Files touched:** None (live verification)  
**Layer:** All  
**Type:** Verification (non-automatable, MANDATORY)  
**Done-check:** (checklist for Sara, not automated)
```
[ ] Reviewed real decision-queue output against your real fleet for a period
[ ] Confirmed it produces signal, not noise (pace alerts are real, detour-volume ratios are reasonable)
[ ] Reviewed the actual unattended text written into your real AGENT-PLAN.md files
[ ] Confirmed the content is sensible and stakeholder-facing (not garbage output from the LLM)
[ ] Confirmed timestamped backups are landing under <cwd>/.claude/agent-plan-backups/
[ ] Re-runnable via ccam decisions retry — backups let you recover if needed
```

### Instructions

**A passing `npm run test:server` is explicitly NOT sign-off for this change.** Per DEC-7 and DEC-13:

- **Task 34's green suite** proves the code works as designed, and the two write-paths are byte-identical.
- **DEC-7's live-trial gate** proves the design works as intended on your real data, at your real scale.

You must:

1. Let the scheduler run against your real fleet for a period (e.g., a few hours or overnight).
2. Review the **decision-queue items** generated — do they flag real pace breaches, real detour volume spikes? Or false alarms?
3. Review the **actual text written into your `AGENT-PLAN.md` files** — is it sensible? Stakeholder-facing? Free of corrupted/forged content?
4. Confirm **timestamped backups** exist under `<cwd>/.claude/agent-plan-backups/` for each write-back that occurred.
5. Test **recovery**: use `ccam decisions retry <id>` to re-attempt a failed or conflicted write-back, and confirm the backup helped you understand what went wrong.

Only after this live trial confirms "signal, not noise" at the highest-stakes surface (unattended file writes to your plan documents) is the build considered done. A regression here is not a code defect — it's a design judgment that the live trial is designed to catch.

---

## Task 39 — Close-out edits to pm.md + memory entries (DEC-8 items 1–3)

**Files touched:** `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/pm.md` (main repo), auto-memory entries  
**Layer:** All  
**Type:** Documentation (close-out per DEC-8)  
**Done-check:**
```bash
grep -n "/loop" pm.md
# Expected: 0 hits (claim removed; no /loop file/script/skill/command exists)

grep -n "undesigned" /Users/sara/.claude/projects/-Users-sara-CODE-LOCAL-SARA-Claude-Code-Agent-Monitor/memory/project_holistic-focus-history.md
# Expected: entry updated to reflect layers 4–6 now built/shipped
```

### Instructions

Per DEC-8, three non-build close-outs (these happen **after** the live trial in Task 38, so you can confirm the design worked before documenting it):

1. **Correct the `/loop` claim in `pm.md`:** That skill/script/command does not exist. Remove the reference or correct it if it was meant to describe something else.

2. **Sync `portfolio-reconciliation-vision` memory entry:** This entry currently describes layers 4–6 as "undesigned." Update it to reflect that they are now shipped, with a link to this effort's outcomes.

3. **Sync `holistic-focus-history` memory entry:** Same — update the "future direction" section to reflect the three new layers and their delivery.

These edits are low-priority (they're documentation, not functionality) but close the loop on the planning narrative.

---

## Summary Checklist

**Mandatory tasks** (build-blocking):

- [ ] **Task 14** — `single-writer-guard.test.js` (G3, §9.1 DERIVED-DUAL-VIEW) **BEFORE** `plan-writeback.js` is written
- [ ] **Task 27** — `chronology-ordering.test.js` + helpers (G4, §9.2 all 5 queries, worst case first)
- [ ] **Task 1** — `db-migration.test.js` (G1, ALTER TABLE execution test)
- [ ] **Task 33** — `reconciliation-full-tick.test.js` Scenario C (G2, §9.1 cross-call-site byte parity)
- [ ] **Task 2** — Both schema halves (CREATE + migration) for `target_date` per DEC-10 sibling-pair rule
- [ ] **Task 23** — Both new tables' full final shapes in initial CREATE TABLE (DEC-15, CHECK constraints)
- [ ] **Task 34** — File-header audit (all new .js files have `@author` header)
- [ ] **Task 35** — All three grep gates return zero hits (DEC-12 residue, DEC-14 spelling, seam references)
- [ ] **Task 36** — Documentation correction (DEC-8 item 4)
- [ ] **Task 38** — DEC-7 live-trial gate (Sara's manual verification)

**Red-first observation points** (tasks that must be observed RED before product code):
- [ ] Task 1 (`db-migration.test.js`)
- [ ] Task 3 (`pace-tracking.test.js`)
- [ ] Task 11 (`atomic-file.test.js`)
- [ ] Task 14 (`single-writer-guard.test.js`)
- [ ] Task 15 (`plan-writeback.test.js` sanitizer)
- [ ] Task 19 (`detour-disposition.test.js`)
- [ ] Task 27 (`chronology-ordering.test.js`)
- [ ] Task 28 (`reconciliation.test.js`)
- [ ] Task 32 (`reconciliation-full-tick.test.js` Scenarios A–B)
- [ ] Task 33 (Scenario C)

**Checkpoints (show Sara)**:
- [ ] After Task 10: Layer 5 complete (`npm run test:server` green)
- [ ] After Task 26: Layer 4 write-path plumbing complete
- [ ] After Task 34: Layer 6 + full suite complete, before live trial

---

## Notes on Sequencing

- **All work in the isolated worktree** at `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor` on branch `effort/2026-08-01-build-project-manager`.
- **Never parallelize.** This is a single-implementer sequential path. Each task depends on prior tasks.
- **DEC-3 checkpoints are hard stops.** Do not start the next layer until Sara has reviewed the current layer.
- **DEC-10 constraint:** No `target:` line parser in `plan-ingest.js`'s `upsertPlanItem` — ever. Authoring is out-of-band only.
- **DEC-15 constraint:** Both `detour_dispositions` and `decision_queue` land their full final shape in the initial `CREATE TABLE IF NOT EXISTS`, not added via later `ALTER TABLE` — SQLite cannot `ALTER` a `CHECK` constraint.
- **File headers are not optional.** Every new `.js` source file must include the `@author Son Nguyen <hoangson091104@gmail.com>` header per `.claude/rules/file-headers.md`.
