# Build Task List — Value Pool altitude cache: mutability-aware caching + invalidation (Slice 1)

**Substrate:** `effort/2026-08-04-altitude-invalidation` branch at worktree
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor`

**Discipline:** Test-first (red → green) throughout. Red proofs are observed per test,
not self-reported. Structural guards ship with the layer they guard (DEPENDENCY-3).
Line numbers in `server/db.js` must be verified by content/grep, not trusted verbatim
(~25-40 lines added between substrate and branch point due to Playbook feature).

**Sequencing notes:**
- **Non-reorderable window: Steps 2→8.** Schema must exist before composer can stamp it;
  composer return shape must exist before tick/route read it; server contract must exist
  before client types it.
- **MANDATORY blocking prerequisite (Step 1.4):** DB backup before any migration.
- **MANDATORY pairing (A-1/A-2):** helper migration adoption and meta-test scans ship
  in the same commit, or all six new columns become invisible to the migration registry.
- **Sequential implementer (no parallelization possible):** one person, one path through.

---

## 1. Environment gate (BLOCKING, DEPENDENCY-1)

**Files touched:** none (verification only)  
**Layer:** environment / session safety  
**Type:** TEST GATE  
**Done-check:**

```bash
# In the effort worktree
git status --porcelain
git log -1 --oneline
git merge-base --is-ancestor 55fe900 HEAD && echo "Ancestor OK"
```

**Task:**

1. Check for live sessions before any git operation:
   ```bash
   ps -eo pid,etime,command | grep -i claude | grep -v grep
   lsof ~/.claude/agent-dashboard/dashboard.db
   ```
   Expect: `concurrently` dev server + live `claude` CLI + Node process holding DB.

2. Verify main checkout (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`) status:
   ```bash
   cd /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor
   git status --porcelain | head
   ```
   Expect: clean working tree (untracked files OK, no modifications to tracked files).

3. Create worktree from `55fe900` (or later, current branch point `c8eecf3`):
   ```bash
   cd /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor
   git fetch origin
   git worktree add /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor \
     -b effort/2026-08-04-altitude-invalidation 55fe900
   cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
   npm run setup
   ```

4. Baseline test run (must be green before any edits):
   ```bash
   npm run test:server
   npm run test:client
   ```
   Expected: 77 server tests (value-summary 25, value-summary-tick 21, single-writer-guard 10,
   db-migration 22) + client + snapshot all green.

---

## 2. MANDATORY: Back up the live DB (BLOCKING, Step 1.4 / DoD obligation)

**Files touched:** `~/.claude/agent-dashboard/dashboard.db` (backup only)  
**Layer:** database / safety  
**Type:** OPERATION (not a test)  
**Done-check:**

```bash
# Verify backup exists and is readable
ls -lh ~/.claude/agent-dashboard/dashboard.db.backup
sqlite3 ~/.claude/agent-dashboard/dashboard.db.backup ".tables" | head
```

**Task:**

This slice ships DDL; `server/db.js` runs migrations at `require()` time against
the live shared `~/.claude/agent-dashboard/dashboard.db`. A dev server currently holds
it open. The columns are additive/nullable so a code-level back-out leaves a working DB,
but a crash mid-migration needs a restore point.

```bash
cp ~/.claude/agent-dashboard/dashboard.db ~/.claude/agent-dashboard/dashboard.db.backup
echo "Backup at $(date)" >> ~/.claude/agent-dashboard/dashboard.db.backup.log
```

**MANDATORY — this task gates everything downstream.**

---

## 3. Copy artifacts to effort branch (Step 1.5 / DEPENDENCY-2)

**Files touched:** `requests/2026-08-04-value-pool-grouping/` (all)  
**Layer:** repository / documentation  
**Type:** PREPARATION  
**Done-check:**

```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
git log --oneline | grep -i "artifacts\|decisions" | head -1
# Expect: commit message mentioning decisions.md
```

**Task:**

Copy the entire `requests/2026-08-04-value-pool-grouping/` tree (this plan,
`decisions.md`, `pm-plan.md`, `request-brief.md`, `supporting/`) into the worktree
**before the first line of build code** and commit.

```bash
cp -r /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping \
      /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor/requests/
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
git add requests/2026-08-04-value-pool-grouping/
git commit -m "docs(intake): copy value-pool-grouping artifacts"
```

**Proves:** `decisions.md` with DEC-1..DEC-15 exists on the branch.

---

## 4. RED: Test framework and structural guards (test layer for Step 2-3)

**Files touched:** `server/__tests__/db-migration.test.js`, `server/__tests__/single-writer-guard.test.js`  
**Layer:** testing / structural guards  
**Type:** TEST (red-first)  
**Done-check:**

```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
# These should be RED at this stage (fixtures exist, code does not)
DASHBOARD_DB_PATH=/tmp/test-alt.db node --test server/__tests__/db-migration.test.js 2>&1 | grep -E "HELPER-CASE-SCAN|ALTER-BLOCK-SCAN" | head
DASHBOARD_DB_PATH=/tmp/test-alt.db node --test server/__tests__/single-writer-guard.test.js 2>&1 | grep -E "FAIL|passed" | head
```

**Task:**

Write test infrastructure and red-first stubs for the migration meta-tests. These tests
will fail until the code is in place:

1. **`HELPER-CASE-SCAN` test skeleton** in `db-migration.test.js`:
   ```js
   it("every column added via addColumnsIfMissing has its own UPGRADE_CASES entry", async () => {
     // Read db.js, find addColumnsIfMissing calls, extract table.column pairs
     // Assert: at least one call site, at least six pairs
     // Assert: every pair in UPGRADE_CASES
   });
   ```

2. **`ALTER-BLOCK-SCAN` test skeleton** in `db-migration.test.js`:
   ```js
   it("no multi-column ALTER block bypasses addColumnsIfMissing", async () => {
     // Find db.exec( with 2+ ALTER TABLE … ADD COLUMN
     // Assert: exact match with GRANDFATHERED_ALTER_BLOCKS registry
   });
   ```

3. **Six `UPGRADE_CASES` entries skeleton** for M1 (five columns) and M2 (one column):
   ```js
   {
     table: "value_unit_summaries",
     column: "input_label", // probe on this one
     legacySql: "CREATE TABLE value_unit_summaries(...)", // pre-slice body
     seed: [...], // legacy rows
     assertLegacyRow: row => { assert.equal(row.input_stage, null); ... },
     assertWritable: () => { /* upsert test */ }
   },
   // ... four more for this table, then M2 for value_summary_generation_log
   ```

4. **`M1-INT` (interruption) test skeleton** — seeded mid-crash state:
   ```js
   it("M1-INT: five-column ALTER converges under interruption", async () => {
     // Seed legacy table PLUS input_stage only
     // require("../db")
     // Assert: no throw, all five columns present, second require no-op
   });
   ```

5. **W-1 stripper enhancement** in `single-writer-guard.test.js` — red first:
   The existing guard that checks `upsertValueUnitSummary.run(` stays at exactly 1.
   Update to use a shared `stripComments(source)` that removes **both** `//` and
   `/** */` blocks (the parent build was bit by a JSDoc containing the literal
   function name). Write the skeleton; it will fail when Step 5 refactors
   `value-summary.js` and a JSDoc comment needs stripping.

6. **`A2` structural scan skeleton** (new `it` in `single-writer-guard.test.js`):
   ```js
   it("buildPrompt reads no unit field outside unitFacts(u) — DEC-15 structural scan", async () => {
     // Read value-summary.js, strip comments
     // Brace-walk buildPrompt body
     // Derive ARR = array param, PARAM = map callback param from source
     // Assert scope non-empty + facts. sentinel
     // Assert zero u.<field> / unit.<field> access
     // ... (8 more evasion classes, each with a separate assertion)
   });
   ```
   This test will be RED at this stage (no `unitFacts` exists yet).

7. **`A2-HOME` comparator single-home scan skeleton** (new `it`):
   ```js
   it("input_stage and input_label appear only in db.js and value-summary.js", async () => {
     // scanFiles(serverDir, /input_stage|input_label/)
     // assert.deepEqual(basenames.sort(), ["db.js", "value-summary.js"])
   });
   ```

**Proves:** Framework in place, red proofs will follow in each layer.

---

## 5. RED: Migration test fixtures (Layer 2 — `db-migration.test.js`)

**Files touched:** `server/__tests__/db-migration.test.js`  
**Layer:** database / migration  
**Type:** TEST (red-first)  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db node --test server/__tests__/db-migration.test.js 2>&1 | grep -E "M1|M2|M1-INT" | head
```

**Task:**

Flesh out the M1, M2, and M1-INT test fixtures. These will fail (red) until Step 2-3
implements the schema and migration helper:

1. **M1 — `describe("Migration: value_unit_summaries input-snapshot columns")`**
   - `it 1`: seed legacy table (no input_* columns), require, assert all five present, legacy rows NULL for each.
   - `it 2`: idempotent — second require no-op.
   - `it 3`: writable — widened `upsertValueUnitSummary` and `markValueUnitSummariesSeen` work on legacy rows.
   - `it 4`: behavioral leg (DEC-9) — legacy **mutable** row regenerates (stale), legacy **`trunk_commit`** row serves fresh.
     - Anti-vacuous guard: before calling, assert `input_label === null` **and** `MUTABLE_VALUE_SOURCES.includes(...)`.
   - **`it 5 = M1-INT`**: seed legacy + `input_stage` only (mid-crash), require, assert: (a) no throw, (b) all five present, (c) pre-existing `input_stage` data survived, (d) second require no-op.

2. **M2 — `describe("Migration: value_summary_generation_log.stale_regenerated")`**
   - `it 1`: column exists; legacy row reads **NULL and explicitly not 0**.
   - `it 2`: idempotent.
   - `it 3`: writable — widened `insertValueSummaryGeneration` (11 params) inserts `stale_regenerated = 3`; legacy row still NULL.

3. **`MIG-HELPER-1..4` tests** (helper contract in the same file):
   - (1) non-existent table returns `false`, no throw.
   - (2) failed ALTER caught, logged, `false` returned, **no throw**, other columns converge from partial state.
   - (3) calling twice is idempotent, returns `false` second time.
   - (4) partial state (one of three present) results in exactly the two missing being added.

**Proves (red at this stage):** Fixtures are specified but will fail until helper exists.

---

## 6. GREEN: Step 2 — Schema, migrations, statements (`server/db.js`)

**Files touched:** `server/db.js`  
**Layer:** database / schema  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
# Re-anchor by content, not line numbers (Playbook feature added ~25-40 lines)
grep -n "value_unit_summaries" /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor/server/db.js | head -5
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "db-migration"
```

**Task:**

1. **Rewrite `value_unit_summaries` schema comment** (originally ~821-825, verify by grep):
   Replace the false "generated once, served forever" statement with a comment that
   enumerates the input set and names `unitFacts()`, per §2 "Fixed while we are in here".

2. **Add five nullable columns to `value_unit_summaries` CREATE body:**
   - `input_stage TEXT` — nullable; NULL = (detour with legitimately NULL stage) OR (pre-snapshot legacy)
   - `input_label TEXT` — nullable; NULL = legacy pre-snapshot discriminator
   - `regenerated_at TEXT` — nullable; NULL on first generation, set only when replaced
   - `regen_reason TEXT` — nullable; stamped on every write (`'initial'` first time)
   - `seen_at TEXT` — nullable; server-side acknowledgement timestamp

   Document at the column level (DEC-12):
   ```
   -- input_label IS NULL is the legacy discriminator (unitFacts() guarantees non-empty label).
   --    input_stage IS NULL does NOT discriminate (detour legitimately has no stage).
   -- regen_reason IS NULL also means legacy-only. No CHECK — future reasons stay additive.
   -- regenerated_at is the marker discriminator: NULL on first generation, set only on replacement.
   ```

3. **Add one nullable column to `value_summary_generation_log` CREATE body:**
   - `stale_regenerated INTEGER` — nullable; **no DEFAULT**
   - Comment: "Overlap counter, not a fifth partition term. NULL = predates measurement (≠ measured zero). Identity: `cache_hits + generated + queued + unavailable === pool_size` (unconditional)."

4. **Implement `addColumnsIfMissing` helper** (MANDATORY A-1, sited next to `rebuildTableAtomically`):
   ```js
   /**
    * Adds any missing columns to `table`. Probes PER COLUMN (convergent under interruption)
    * and applies only the missing ones inside ONE transaction. NEVER throws.
    *
    * @param {{ table: string, columns: Record<string,string> }} opts
    * @returns {boolean} true if at least one column was added
    */
   function addColumnsIfMissing({ table, columns }) {
     const meta = db.prepare("PRAGMA table_info(?)").all(table);
     if (!meta) return false; // table doesn't exist
     const existing = new Set(meta.map(c => c.name));
     const toAdd = Object.entries(columns).filter(([name]) => !existing.has(name));
     if (!toAdd.length) return false; // all present
     try {
       const alters = toAdd.map(([name, type]) => `ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).join(";");
       db.exec(`BEGIN; ${alters}; COMMIT;`);
       return true;
     } catch (err) {
       if (db.inTransaction) db.exec("ROLLBACK");
       console.error(`[addColumnsIfMissing] Failed to add columns to ${table}:`, err.message);
       return false;
     }
   }
   ```

5. **Two guarded ALTER blocks** (MANDATORY A-1, PRAGMA form only, DEC-5), executing the helper:
   ```js
   addColumnsIfMissing({
     table: "value_unit_summaries",
     columns: {
       input_stage: "TEXT",
       input_label: "TEXT",
       regenerated_at: "TEXT",
       regen_reason: "TEXT",
       seen_at: "TEXT"
     }
   });
   addColumnsIfMissing({
     table: "value_summary_generation_log",
     columns: { stale_regenerated: "INTEGER" }
   });
   ```

6. **Widen statement `upsertValueUnitSummary`** (originally ~3193-3201, verify by grep):
   Add the five new columns to the column list, params list, and `DO UPDATE SET`:
   ```js
   db.prepare(`
     INSERT INTO value_unit_summaries (unit_key, project_level, stakeholder_level, model, …, input_stage, input_label, regenerated_at, regen_reason, seen_at)
     VALUES (?, ?, ?, ?, …, ?, ?, ?, ?, ?)
     ON CONFLICT(unit_key) DO UPDATE SET
       stakeholder_level = excluded.stakeholder_level,
       model = excluded.model,
       …,
       input_stage = excluded.input_stage,
       input_label = excluded.input_label,
       regenerated_at = excluded.regenerated_at,
       regen_reason = excluded.regen_reason,
       seen_at = NULL  -- engineer G3: reset on every regeneration
   `);
   ```

7. **Add statement `markValueUnitSummariesSeen`:**
   ```js
   db.prepare(`
     UPDATE value_unit_summaries
     SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE unit_key = ? AND regenerated_at IS ?
   `);
   ```
   (A-5: compare-and-set form, not unconditional.)

8. **Widen statement `insertValueSummaryGeneration`** (originally ~3234-3238, verify by grep):
   Add `stale_regenerated` to the column list, params list.

**Proves (all tests pass):** Schema matches fixtures; fresh DB and copied pre-slice DB both open cleanly; second boot a no-op.

---

## 7. GREEN: Step 3 — Migration cases and meta-test scans

**Files touched:** `server/__tests__/db-migration.test.js`  
**Layer:** database / migration  
**Type:** IMPLEMENTATION + STRUCTURAL GUARD  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "db-migration"
# Expect: M1, M2, M1-INT, HELPER-CASE-SCAN, ALTER-BLOCK-SCAN all green
```

**Task:**

1. **Complete six `UPGRADE_CASES` entries** (M1 five columns + M2 one column):
   - Five for `value_unit_summaries` share one `legacySql`/`seed` via the `color_thresholds`
     spread-IIFE precedent; seed one **mutable** row (intake_initiative) and one **`trunk_commit`** row.
   - One for `value_summary_generation_log.stale_regenerated`.

2. **`HELPER-CASE-SCAN` implementation** (MANDATORY A-2):
   ```js
   it("every column added via addColumnsIfMissing has its own UPGRADE_CASES entry", async () => {
     const dbSource = fs.readFileSync("./server/db.js", "utf8");
     const calls = dbSource.match(/addColumnsIfMissing\s*\(\s*{[^}]*columns\s*:\s*{[^}]*}\s*}\s*\)/gs) || [];
     assert(calls.length > 0 && calls.length <= 10, "found " + calls.length + " helper call sites");
     const pairs = new Set();
     for (const call of calls) {
       const tableMatch = call.match(/table\s*:\s*"([^"]+)"/);
       const columnsMatch = call.match(/columns\s*:\s*{([^}]*)}/);
       if (tableMatch && columnsMatch) {
         const table = tableMatch[1];
         const cols = columnsMatch[1].match(/(\w+)\s*:/g) || [];
         for (const col of cols) {
           pairs.add(`${table}.${col.replace(/:/, "")}`);
         }
       }
     }
     assert(pairs.size >= 6, `found ${pairs.size} helper pairs, expected >= 6`);
     const caseKeys = UPGRADE_CASES.map(uc => `${uc.table}.${uc.column}`);
     for (const pair of pairs) {
       assert(caseKeys.includes(pair), `missing UPGRADE_CASES for ${pair} — do not add to GRANDFATHERED`);
     }
   });
   ```

3. **`ALTER-BLOCK-SCAN` implementation** (MANDATORY A-2):
   ```js
   it("no multi-column ALTER block bypasses addColumnsIfMissing", async () => {
     const dbSource = fs.readFileSync("./server/db.js", "utf8");
     const multiAlters = [];
     const execBlocks = dbSource.match(/db\.exec\s*\(\s*`[^`]*ALTER\s+TABLE[^`]*ALTER\s+TABLE[^`]*`/gs) || [];
     for (const block of execBlocks) {
       const firstCol = block.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/)?.[2];
       if (firstCol) multiAlters.push(`${block.match(/ALTER\s+TABLE\s+(\w+)/)[1]}.${firstCol}`);
     }
     const grandfathered = Object.keys(GRANDFATHERED_ALTER_BLOCKS).sort();
     const found = multiAlters.sort();
     assert.deepEqual(found, grandfathered, "multi-column ALTER blocks must match registry exactly (no orphans, no omissions)");
   });
   ```

4. **`GRANDFATHERED_ALTER_BLOCKS` registry** (new):
   ```js
   const GRANDFATHERED_ALTER_BLOCKS = {
     "agents.workflow_run_id": "2026-08-03, catch-inside-ALTERs (first escape on second)",
     "model_pricing.fast_enabled": "2026-08-03, pre-helper block",
     "color_thresholds.critical_r": "2026-08-03, six-column pre-helper block",
     "color_thresholds.legend_r": "2026-08-03, six-column legacy split",
     "context_snapshots.input_tokens": "2026-08-03, three-column pre-helper block"
     // Comment: A new multi-column ALTER block must go through addColumnsIfMissing;
     //          do not add a row here to make this pass.
   };
   ```

5. **Complete M1-INT red proof documentation:**
   Inject the two red proofs to be recorded:
   - (i) Restore the plan's original single-probe-on-`input_label` block → (a) throws `duplicate column name`.
   - (ii) Change probe to `input_stage` (first column) → (b) red, four columns missing.

**Proves (all scan assertions pass):** Six new columns tracked; no orphan blocks.

---

## 8. GREEN: Step 4 — Mutability registry (`server/lib/value-ledger.js`)

**Files touched:** `server/lib/value-ledger.js`, `server/__tests__/single-writer-guard.test.js`  
**Layer:** synthesis / taxonomy  
**Type:** IMPLEMENTATION + STRUCTURAL GUARD  
**Done-check:**

```bash
grep "MUTABLE_VALUE_SOURCES" /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor/server/lib/value-ledger.js
npm run test:server -- --grep "single-writer-guard" | grep "assertSingleHome"
```

**Task:**

1. **Add `MUTABLE_VALUE_SOURCES` export** to `value-ledger.js`:
   ```js
   const MUTABLE_VALUE_SOURCES = ["intake_initiative", "detour", "merge_commit"];
   // Keyed on value_source, not "has a stage". A merge_commit unit's SHA is
   // immutable but value-ledger.js stamps a mutable stage on it, and buildPrompt
   // feeds stage into the prompt (DEC-6).
   module.exports = { MUTABLE_VALUE_SOURCES, VALUE_SOURCES, … };
   ```

2. **Update `assertSingleHome`'s `absent` lists** in `single-writer-guard.test.js` in the **same commit**:
   ```js
   const shouldNotBeImportedAnywhereElse = [
     "MUTABLE_VALUE_SOURCES",
     "ALTITUDE_FRESHNESS",
     "unitFacts",
     "compareUnitInputs"
     // Route and tick consume only enrichPoolAltitudes's return
   ];
   ```
   The tripwire going red is it working.

**Proves (all scan assertions pass):** Export visible where needed; tripwire red on violation.

---

## 9. RED: Test layer for `unitFacts()` and `buildPrompt` structural scan (test layer for Step 5)

**Files touched:** `server/__tests__/single-writer-guard.test.js`, `server/__tests__/value-summary.test.js`  
**Layer:** testing / structural guard  
**Type:** TEST (red-first)  
**Done-check:**

```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
DASHBOARD_DB_PATH=/tmp/test-alt.db node --test server/__tests__/single-writer-guard.test.js 2>&1 | grep -E "A2|unitFacts" | head
DASHBOARD_DB_PATH=/tmp/test-alt.db node --test server/__tests__/value-summary.test.js 2>&1 | grep "U1\|U2\|U3\|U4" | head
```

**Task:**

1. **Enhance W-1 stripper** in `single-writer-guard.test.js` to use shared `stripComments`:
   ```js
   function stripComments(source) {
     // Remove /* */ blocks first
     let stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
     // Then remove // line comments
     return stripped.split("\n").map(line => line.split("//")[0]).join("\n");
   }
   ```
   Update W-1 to use it; record the fresh red proof (inject rogue call into `readCached`).

2. **Write A2 structural scan test** (MANDATORY DEC-15 strong form):
   This test will be RED at this stage (no `unitFacts` exists).
   ```js
   it("buildPrompt reads no unit field outside unitFacts(u) — DEC-15 structural scan", async () => {
     const source = fs.readFileSync("./server/lib/value-summary.js", "utf8");
     const stripped = stripComments(source);
     // Brace-walk buildPrompt
     const buildPromptMatch = stripped.match(/function\s+buildPrompt\s*\([^)]*\)\s*{/);
     assert(buildPromptMatch, "buildPrompt function not found");
     // Derive ARR and PARAM from source
     const funcSig = stripped.match(/function\s+buildPrompt\s*\(([^)]*)\)/)[1];
     const bodyMatch = stripped.substring(buildPromptMatch.index).match(/\.\s*map\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)/);
     const PARAM = bodyMatch?.[1];
     assert(PARAM, "map callback parameter not found or destructured");
     // 9 assertions covering evasion classes
     // (a) scope non-empty + positive sentinel
     // (b-i) individual evasion classes, each red-proven
   });
   ```

3. **Test case fixtures for comparator** (`U1–U4`, truth table `T1–T11`) in `value-summary.test.js`:
   These will fail (red) until `unitFacts` and `compareUnitInputs` exist:
   ```js
   describe("unitFacts / compareUnitInputs (A1)", () => {
     test("U1: label resolved, value_source included", () => {
       // Will fail: unitFacts is not yet defined
     });
     test("U2: label null, value_ref fallback", () => {});
     test("U3: label null, value_ref empty → untitled", () => {});
     test("U4: detour (no stage key) normalizes to null", () => {});
     // Truth table T1–T11 as separate cases or table-driven
   });
   ```

**Proves (red at this stage):** Framework in place; red proofs will follow.

---

## 10. GREEN: Step 5 — `unitFacts()` + `buildPrompt` refactor (the durable cure)

**Files touched:** `server/lib/value-summary.js`  
**Layer:** synthesis / composer  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
DASHBOARD_DB_PATH=/tmp/test-alt.db node --test server/__tests__/value-summary.test.js -- --grep "U1|U2|U3|U4"
DASHBOARD_DB_PATH=/tmp/test-alt.db node --test server/__tests__/single-writer-guard.test.js -- --grep "A2" 2>&1 | grep -E "passed|FAIL"
```

**Task:**

1. **Add `unitFacts()` function** (the MANDATORY §9.1 durable cure):
   ```js
   /** The complete prompt input set for one unit. The ONLY place a unit's fields
    *  are read for synthesis: buildPrompt renders from this, the cache stores it,
    *  and compareUnitInputs compares it — so the prompt's input set and the
    *  compared input set are the same object by construction. Adding a field to
    *  the prompt is physically impossible without adding it to the comparison. */
   function unitFacts(unit) {
     return {
       value_source: unit.value_source ?? null,
       label: unit.label || unit.value_ref || "(untitled)",
       stage: unit.stage ?? null
     };
   }
   ```

2. **Refactor `buildPrompt`** (99-105, verify by grep):
   Change from reading `u.label || u.value_ref`, `u.value_source`, `u.stage` directly
   to reading **only** from `unitFacts(u)`:
   ```js
   function buildPrompt(units) {
     return units
       .map(u => {
         const facts = unitFacts(u);
         return `${facts.label} (${facts.value_source}) — ${facts.stage || "—"}`;
       })
       .join("\n");
   }
   ```

3. **Update file-header comment** in `value-summary.js`:
   Rewrite the "generated once, served forever" paragraph (lines ~32-38) to reflect
   that input-snapshot gating replaces this claim. The header must no longer say
   "ONE lexical writer" — narrow it to "one writer of the **synthesis columns**"
   (because `markValueUnitSummariesSeen` is a second production writer).

4. **Export `unitFacts`** so tests can use it:
   ```js
   module.exports = { unitFacts, compareUnitInputs, readCached, enrichPoolAltitudes, … };
   ```

**Proves (all A2 scan assertions pass; U1–U4 green):** 
- A2 assertions fire red before this step; green after.
- U1–U4 fixtures now pass.

---

## 11. RED: Test layer for comparator and gated read (test layer for Step 6)

**Files touched:** `server/__tests__/value-summary.test.js`  
**Layer:** testing  
**Type:** TEST (red-first)  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "value-summary" 2>&1 | grep -E "T1|T2|D1|D2|D3|D4" | head
```

**Task:**

1. **Add comparator truth table test** (T1–T11) to `value-summary.test.js`:
   Table-driven, one assertion per row, including special NULL-matrix cases and precedence.
   These will fail (red) until `compareUnitInputs` exists.

2. **Add lifecycle tests** (D1–D6, D5b):
   - D1: trunk_commit never regenerates, incl. NULL-snapshot leg
   - D2: mutable + unchanged → cache hit
   - D3: stage change regenerates exactly that unit
   - D4: label change, separate proof from D3
   - D5: legacy NULL snapshot regenerates
   - D5b: detour-with-NULL-stage is fresh (not legacy)
   - D6: marker lifecycle (arm/clear/re-arm)

   These test fixtures use seeded cached rows created via the production path.

3. **Add cross-path parity tests** (P1, P2):
   - P1 structural: route-sanitized and assembler shapes produce identical `unitFacts()`
   - P2 behavioral: through the real route, seeded vs. posted produce same result

**Proves (red at this stage):** Fixtures specified; will fail until comparator exists.

---

## 12. GREEN: Step 6 — `compareUnitInputs()` + gated `readCached`

**Files touched:** `server/lib/value-summary.js`  
**Layer:** synthesis / composer  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "T1|T2|D1|D2|D3|D4" 2>&1 | grep -E "passed|FAIL" | head
```

**Task:**

1. **Add `compareUnitInputs()` function**:
   ```js
   /** Returns null when the cached text's input snapshot still matches the unit,
    *  otherwise the reason it does not. Precedence: stage over label. */
   function compareUnitInputs(row, unit) {
     const facts = unitFacts(unit);
     if ((row.input_stage ?? null) !== facts.stage) return "stage_changed";
     if ((row.input_label ?? null) !== facts.label) return "label_changed";
     return null;
   }
   ```

2. **Refactor `readCached(dbModule, unit)`** (was `readCached(dbModule, unitKey)`, ~81-94):
   Add unit parameter and comparison logic:
   ```js
   function readCached(dbModule, unit) {
     const row = dbModule.stmts.getValueUnitSummary.get(unit.unit_key);
     if (!row) return { cached: null, staleReason: null };
     if (!MUTABLE_VALUE_SOURCES.includes(unit.value_source)) {
       return { cached: row, staleReason: null }; // immutable
     }
     const reason = compareUnitInputs(row, unit);
     if (reason) return { cached: null, staleReason: reason };
     return { cached: row, staleReason: null };
   }
   ```

3. **Export `compareUnitInputs`** so tests and guards can use it.

4. **Record red proofs for T-table and D-cases** in comments:
   - DEC-12 NULL-matrix discriminator (T7 red proof)
   - A3 mutation red proof (D2 red proof)
   - Field precedence (T4 red proof)

**Proves (T1–T11, D1–D6, D5b green):** Truth table passes; lifecycle pins both fields separately.

---

## 13. RED: Test layer for wire shape, freshness, and counts (test layer for Step 7)

**Files touched:** `server/__tests__/value-summary.test.js`  
**Layer:** testing  
**Type:** TEST (red-first)  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "R3|Case 5|Case 6|COUNTS|DEC-11" 2>&1 | head
```

**Task:**

1. **Wire shape tests** (R3, Case 5, Case 6, Combination cases):
   - R3: stale unit with old text in altitudes, absent from states
   - Case 5 (widened): 45-unit mix (10 fresh + 5 stale + 30 uncached) → partition exact
   - Case 6 (extended): `ALTITUDE_FRESHNESS` imported, never hand-typed
   - Combination: stale × over-cap, stale × LLM-down

   These will fail (red) until `enrichPoolAltitudes` returns `{ altitudes, states, counts }`.

2. **`COUNTS-SHAPE` test** (DEC-14):
   ```js
   it("counts shape is exact and the four-term identity holds", () => {
     // Assert: Object.keys(counts).sort() === ["cache_hits", "generated", "pool_size", "queued", "stale_regenerated", "unavailable"]
     // Assert: cache_hits + generated + queued + unavailable === pool_size (no stale_regenerated)
   });
   ```

3. **`COUNTS-DROPPED` test** (A-3 / DC-2):
   ```js
   it("enrichPoolAltitudes honors opts.droppedCount (A-3)", () => {
     // Call with droppedCount: 2
     // Assert: counts.pool_size === units.length + 2
     // Assert: counts.unavailable === <composer unavailable> + 2
   });
   ```

4. **`DEC-11-ANTIFIX` test** (BY DESIGN, one fixture, both partitions):
   ```js
   it("a stale-served unit is in altitudes on the wire AND a miss in counts — DEC-11, BY DESIGN", () => {
     // 1 stale-cached unit, LLM OFF
     // res.altitudes[k].stakeholder === <old text> (wire: served, R3)
     // counts.cache_hits === 0 (log: a miss)
     // counts.unavailable === 1
     // Four-term identity exact
     // Comment: "… any test asserting log/wire agreement on stale units is asserting a bug."
   });
   ```

**Proves (red at this stage):** Fixtures specified; will fail until return shape widens.

---

## 14. GREEN: Step 7 — Wire shape, freshness, re-homing, counts

**Files touched:** `server/lib/value-summary.js`  
**Layer:** synthesis / composer  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "value-summary" 2>&1 | grep -E "R3|Case 5|DEC-11" | head
npm run test:server -- --grep "COUNTS-SHAPE|COUNTS-DROPPED"
```

**Task:**

1. **Export `ALTITUDE_FRESHNESS` registry**:
   ```js
   const ALTITUDE_FRESHNESS = ["stale_refresh_queued", "stale_refresh_unavailable", "updated_unseen"];
   ```

2. **Widen `enrichPoolAltitudes` return** to `{ altitudes, states, counts }`:
   ```js
   const counts = {
     pool_size: units.length,
     cache_hits: 0,
     generated: 0,
     queued: 0,
     unavailable: 0,
     stale_regenerated: 0
   };
   ```

3. **Implement re-homing rule** (architect R3):
   After states map is computed, move any stale unit that did **not** resolve this round
   from `states` into `altitudes` with its **old** text plus `freshness`:
   ```js
   for (const [key, row] of staleRows) {
     if (!stateKeys.has(key)) {
       const reason = staleReasons.get(key);
       const freshness = reason === "stage_changed" ? "stale_refresh_queued" : "stale_refresh_unavailable";
       altitudes[key] = { …row, freshness };
     }
   }
   ```

4. **Add freshness to regenerated entries** (D6):
   ```js
   if (row.regenerated_at !== null) {
     entry.freshness = "updated_unseen";
     entry.update_reason = row.regen_reason;
     entry.regenerated_at = row.regenerated_at;
   }
   ```
   **NOT** `ALTITUDE_STATES` — that gains nothing (DEC-3).

5. **Accept `opts.droppedCount` parameter** (A-3):
   ```js
   function enrichPoolAltitudes(dbModule, units, opts = {}) {
     const { droppedCount = 0 } = opts;
     counts.pool_size = units.length + droppedCount;
     counts.unavailable += droppedCount;
     …
   }
   ```

**Proves (R3, Case 5, Case 6, COUNTS tests green; DEC-11-ANTIFIX green):**
- Old text never blanked; freshness correct.
- Partition exact; identity holds.
- Stale unit in altitudes + miss in counts (by design).

---

## 15. GREEN: Step 8 — Background sweep (`server/lib/value-summary-tick.js`)

**Files touched:** `server/lib/value-summary-tick.js`  
**Layer:** background / tick  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "value-summary-tick" 2>&1 | grep -E "L1|L2|L3" | head
```

**Task:**

1. **Replace counting loop** (112-124, verify by grep):
   Remove the manual `cache_hits`, `generated`, etc. arithmetic and read from `counts`:
   ```js
   const { counts } = await enrichPoolAltitudes(db, units, opts);
   ```

2. **Update `insertValueSummaryGeneration.run(` call** (158-169):
   Pass the new `stale_regenerated` parameter:
   ```js
   db.stmts.insertValueSummaryGeneration.run(
     "tick",
     counts.pool_size,
     counts.cache_hits,
     counts.generated,
     counts.queued,
     counts.unavailable,
     counts.stale_regenerated
   );
   ```

3. **No other changes:** scheduler, rotation, overlap-guard, `pending_after_sweep` untouched.

**Proves (L1, L2, L3 green):**
- L1: four-term identity exact (cache_hits === 10, not 15)
- L2: stale_regenerated exact and bounded
- L3: tick drains staleness through shared read path; tick 3 reaches steady state

---

## 16. RED: Test layer for request fast lane and seen endpoint (test layer for Step 9)

**Files touched:** `server/__tests__/value-summary.test.js`, (new client tests to follow)  
**Layer:** testing  
**Type:** TEST (red-first)  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "ROUTE-SEAM|SEEN-" 2>&1 | head
```

**Task:**

1. **`ROUTE-SEAM-1` test** (kills T-F arithmetic defect):
   ```js
   it("POST /altitudes writes exactly one request-source log row whose four terms sum to the SUBMITTED batch size", () => {
     // POST N good + 1 bogus value_source + 1 key-less
     // Assert: exactly one new log row, source='request', pool_size === N+2
     // Assert: cache_hits + generated + queued + unavailable === pool_size
   });
   ```

2. **`SEEN-1..7` test fixtures** (`/altitudes/seen` endpoint):
   - SEEN-1: happy path (D6 state → acknowledge → no freshness)
   - SEEN-2: idempotent
   - SEEN-3: validation matrix (8 ways malformed)
   - SEEN-4: stamp-race semantics (re-arm after mutation)
   - SEEN-5: acknowledge survives cache-hit reads
   - SEEN-6: compare-and-set deterministic (stale stamp no-op; NULL leg passes)
   - SEEN-7: project_id advisory, BY DESIGN

   These will fail (red) until the endpoint and comparator exist.

3. **Request-path logging guards** (W-1, W-2, W-3):
   - W-1: `upsertValueUnitSummary.run(` stays at exactly **1** (fresh red proof after refactor)
   - W-2: `insertValueSummaryGeneration` file set deliberate red → widen (4-step sequence)
   - W-3: `markValueUnitSummariesSeen` single-call-site guard (new)

**Proves (red at this stage):** Fixtures specified; will fail until endpoint exists.

---

## 17. GREEN: Step 9 — Request fast lane (`server/routes/project-plans.js`)

**Files touched:** `server/routes/project-plans.js`  
**Layer:** request / route  
**Type:** IMPLEMENTATION + STRUCTURAL GUARD  
**Done-check:**

```bash
grep "altitudes/seen" /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor/server/routes/project-plans.js
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "SEEN-|ROUTE-SEAM" 2>&1 | grep -E "passed|FAIL" | head
```

**Task:**

1. **Add `POST /api/project-plans/altitudes/seen` endpoint**:
   ```js
   router.post("/altitudes/seen", async (req, res) => {
     const { project_id, units } = req.body;
     
     // Validation: project_id string, units array, each { unit_key: string, regenerated_at: string|null }
     if (!project_id || typeof project_id !== "string") {
       return res.status(400).json({ error: { code: "INVALID_INPUT", … } });
     }
     if (!Array.isArray(units) || units.length === 0 || units.length > 500) {
       return res.status(400).json({ error: { code: "INVALID_INPUT", … } });
     }
     // Per-unit validation …
     
     // Update inside transaction (A-5 compare-and-set form):
     let updated = 0;
     db.transaction(() => {
       for (const { unit_key, regenerated_at } of units) {
         const result = db.stmts.markValueUnitSummariesSeen.run(unit_key, regenerated_at);
         updated += result.changes;
       }
     })();
     
     res.json({ updated });
   });
   ```

2. **Add request-path generation logging** (after composer call, same location):
   ```js
   const { altitudes, states, counts } = await enrichPoolAltitudes(db, units, {
     droppedCount: units.length - clean.length // A-3 fix
   });
   
   db.stmts.insertValueSummaryGeneration.run(
     "request",
     counts.pool_size,
     counts.cache_hits,
     counts.generated,
     counts.queued,
     counts.unavailable,
     counts.stale_regenerated
   );
   ```
   (The route never computes a partition term; it logs `counts` verbatim.)

3. **Update guard W-2 exactly** (deliberately red → widen):
   - Before: run unmodified → green, `["db.js", "value-summary-tick.js"]`.
   - Add logging (this step): unmodified guard → RED `["db.js", "project-plans.js", "value-summary-tick.js"]`.
   - Same commit: widen to exactly that set; record the red.
   - Fresh red proof: inject rogue call into `workflow-ingest.js` → red.

4. **Add W-3 guard** (new):
   ```js
   it("markValueUnitSummariesSeen appears only in db.js and project-plans.js", () => {
     const files = scanFiles(…);
     assert.deepEqual(files.sort(), ["db.js", "project-plans.js"]);
     // Count in routes/project-plans.js: exactly 1, inside `/altitudes/seen` handler
   });
   ```

5. **`POST /altitudes` (141-174) itself unchanged** — same sanitization, same composer call.
   Freshness fields ride out on the response automatically.

**Proves (ROUTE-SEAM-1, SEEN-1..7 green; guards W-1/W-2/W-3 green):**
- Request-path logging writes one row; partition exact.
- Seen endpoint stamps; compare-and-set prevents stale stamp.
- Guards exact, red-proven.

---

## 18. GREEN: Step 10 — DEC-7 cross-path parity test

**Files touched:** `server/__tests__/value-summary.test.js`  
**Layer:** testing  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
DASHBOARD_DB_PATH=/tmp/test-alt.db npm run test:server -- --grep "P1|P2" 2>&1 | grep -E "passed|FAIL"
```

**Task:**

**Verify P1 and P2 tests pass** (written red in §11, implemented in §12-17):
- P1 structural: route-reconstructed and assembler shapes produce identical `unitFacts()`.
- P2 behavioral: through the real route, seeded vs. posted produce same (cache-hit) result.

Red proof for P2: route coerces missing stage to `""` → P2 red (normalization difference).

**Proves:** Unit facts identical across tick and route; no oscillation.

---

## 19. GREEN: Step 11 — Client types, API, panel, i18n

**Files touched:**
- `client/src/lib/types.ts` (entry type + seen request/response types)
- `client/src/lib/api.ts` (widened altitude entry type; new `markAltitudesSeen` call)
- `client/src/components/PlanLedgerPanel.tsx` (marker rendering; dismiss-all control)
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` (six new keys + fallback)

**Layer:** client / rendering  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor/client
npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx 2>&1 | grep -E "C1|C2|C3"
npx vitest run src/__tests__/i18n.test.ts 2>&1 | grep -E "E1"
```

**Task:**

1. **`types.ts`:** Altitude entry gains `freshness?`, `update_reason?`, `regenerated_at?`
   (optional fields for backward compat with old wire). Seen request/response types:
   ```ts
   export interface MarkAltitudeSeenRequest {
     project_id: string;
     units: Array<{ unit_key: string; regenerated_at: string | null }>;
   }
   export interface MarkAltitudeSeenResponse {
     updated: number;
   }
   ```

2. **`api.ts`:** Widen `projectPlans.altitudes` response type (**not** the states `Record`, unchanged).
   Add `markAltitudesSeen(projectId, units)` call.

3. **`PlanLedgerPanel.tsx`:** (Note: component is **`ValueUnitRow`**, not `PoolUnitRow` in actual code — A-7 correction)
   - Line 321: `Altitude` union's object arm gains `freshness?`, `update_reason?`, `regenerated_at?`.
   - Line 331-355: `AltitudeText` **text rendering unchanged**.
   - Line 357-430: `ValueUnitRow` renders marker via i18n key (chosen from `update_reason`, never hardcoded English) + per-unit "×" dismiss; panel-level "dismiss all updated markers" batches keys.
   - Line 542-588: load/effect unchanged except wiring acknowledge call.
   - Line 558: hand-typed state list **unchanged** (DEC-3).

4. **i18n all four locales** (en/ko/vi/zh), new keys under `planLedger.pool.altitudes`:
   - `updatedStageChanged`
   - `updatedLabelChanged`
   - `staleRefreshQueued`
   - `staleRefreshUnavailable`
   - `dismiss`
   - `dismissAll`
   - `updatedGeneric` (fallback, A-6)

   Parity check from `en` via `i18n.test.ts` E1.1 fails loudly on gaps.

**Proves (C1, C2, C3, E1.1 green):**
- Marker renders via i18n key distinct from queued/unavailable.
- Acknowledge calls API exactly once.
- Out-of-registry fixture still out-of-registry (guard still works).

---

## 20. GREEN: Step 11b — Snapshot baseline regeneration

**Files touched:** `client/src/pages/__tests__/screens.snapshot.test.tsx`  
**Layer:** client / testing  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor/client
npx vitest run src/pages/__tests__/screens.snapshot.test.tsx 2>&1 | tail -5
git diff --name-only | grep -E "snapshot|__snapshots__"
```

**Task:**

1. **Review snapshot diff** from Step 11 (intentional UI changes for marker rendering).

2. **Regenerate baselines:**
   ```bash
   cd client
   npx vitest run -u src/pages/__tests__/screens.snapshot.test.tsx
   ```

3. **Commit the snapshot changes separately** or in the same commit as Step 11, with a clear message.

**Proves:** Snapshot baseline matches new intentional UI.

---

## 21. GREEN: Step 12 — Documentation, catalog, headers

**Files touched:** `PROJECT-CONTEXT.md`, `docs/API.md`, `docs/DATABASE.md`,
`server/README.md`, `ARCHITECTURE.md`, file headers

**Layer:** documentation  
**Type:** IMPLEMENTATION  
**Done-check:**

```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
bash .claude/skills/file-headers/scripts/check-headers.sh
git diff PROJECT-CONTEXT.md | head -30
```

**Task:**

1. **PROJECT-CONTEXT.md catalog notes** (§9.1 and §9.8, on effort branch only):
   Append the two DEC-10 notes from `pm-plan.md` §6 **verbatim**, each marked
   *count unchanged / not an occurrence*.

2. **Run `update-project-docs` skill** for:
   - `docs/API.md` — new `/altitudes/seen` endpoint, widened `/altitudes` response
   - `docs/DATABASE.md` — six new columns, comment rewrites
   - `server/README.md` — mutability-aware caching behavior
   - `ARCHITECTURE.md` — input-snapshot gating, seen-state round-trip

3. **File headers:** Every touched `.js/.ts/.tsx` file:
   - If already has the header, verify author and overview are current.
   - If modified, update overview if purpose changed.
   - Run `bash .claude/skills/file-headers/scripts/check-headers.sh` to verify exit 0.

4. **Fill `decisions.md`** (on the branch):
   - WATCH-B's measured burst size (Step 6 manual test).
   - DEC-4's red-proof record (W-2 deliberate red → widen).

**Proves:** Docs consistent; headers audit passes.

---

## 22. GREEN: Step 13 — Full verification

**Files touched:** none (verification only)  
**Layer:** testing / verification  
**Type:** TEST + MANUAL  
**Done-check:**

```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
npm run test:server
npm run test:client
bash .claude/skills/file-headers/scripts/check-headers.sh
# Manual browser test (see below)
```

**Task:**

1. **Full test suite** (all four test layers):
   ```bash
   DASHBOARD_DB_PATH=/tmp/final-alt.db npm run test:server
   # Expected: 78 total (77 baseline + 1 new test class or widened)
   npm run test:client
   ```

2. **Header audit:**
   ```bash
   bash .claude/skills/file-headers/scripts/check-headers.sh
   # Expected: exit 0
   ```

3. **Manual verification in real Google Chrome** (per CLAUDE.md, per §6):
   ```bash
   npm run dev  # in the effort worktree
   # open -a "Google Chrome" "http://localhost:3000/projects/resume"
   ```
   Then:
   - Navigate to Resume project's PlanLedgerPanel.
   - Confirm stale cached text (Resume job-pipeline-tracker) still renders.
   - Mutate the tracker's stage **through the production mutation path** (not a DB poke).
   - Next sweep or panel reopen → text regenerates, marker visible.
   - Acknowledge → marker clears, reload → **stays** cleared.
   - Confirm `value_summary_generation_log` row records invalidation (**both** paths log).
   - Confirm neighbouring `trunk_commit` unit did **not** change.
   - **Separately:** boot against a **copy of pre-slice DB** (any DB at `55fe900`) →
     clean startup, no `SQLITE_ERROR`, legacy mutable rows regenerate lazily.
     **Record the real burst size** into WATCH-B.

**Proves:** Full build verified; all layers green; manual flow confirmed.

---

## Summary: 13 implementation + 9 test/guard stages

| # | Step | Files | Type | MANDATORY | Status |
|---|---|---|---|---|---|
| 1 | Environment gate + DB backup | `~/.claude/agent-dashboard/dashboard.db` | OPERATION | **BLOCKING** | ✓ |
| 1.5 | Copy artifacts | `requests/2026-08-04-value-pool-grouping/` | PREPARATION | DEPENDENCY-2 | ✓ |
| 2 | Schema + migrations + statements | `server/db.js` | IMPLEMENTATION | A-1 (helper) | ✓ |
| 3 | Migration meta-tests + cases | `server/__tests__/db-migration.test.js` | IMPLEMENTATION | A-2 (scans) | ✓ |
| 4 | Mutability registry | `server/lib/value-ledger.js` | IMPLEMENTATION | — | ✓ |
| 5 | `unitFacts()` + `buildPrompt` refactor | `server/lib/value-summary.js` | IMPLEMENTATION | §9.1 durable cure | ✓ |
| 6 | Comparator + gated `readCached` | `server/lib/value-summary.js` | IMPLEMENTATION | — | ✓ |
| 7 | Wire shape + freshness + counts | `server/lib/value-summary.js` | IMPLEMENTATION | A-3 (droppedCount), DEC-14 (counts) | ✓ |
| 8 | Background sweep | `server/lib/value-summary-tick.js` | IMPLEMENTATION | — | ✓ |
| 9 | Request fast lane + seen endpoint | `server/routes/project-plans.js` | IMPLEMENTATION | A-5 (compare-and-set) | ✓ |
| 10 | Cross-path parity test | `server/__tests__/value-summary.test.js` | TEST | DEC-7 | ✓ |
| 11 | Client: types → API → panel → i18n | `client/src/lib/types.ts`, `api.ts`, `PlanLedgerPanel.tsx`, i18n | IMPLEMENTATION | — | ✓ |
| 12 | Docs, catalog, headers | `PROJECT-CONTEXT.md`, docs/, file headers | DOCUMENTATION | DEC-10 (catalog notes) | ✓ |
| 13 | Full verification | all | TEST + MANUAL | — | ✓ |

**Red-first test steps (pre-implementation proof):**
- Step 1: Environment baseline
- Step 4: Migration meta-test skeletons (A2 scans)
- Step 9: Comparator truth table + lifecycle tests
- Step 13: Wire shape + counts tests
- Step 16: Request logging + seen endpoint tests
- Step 18: Cross-path parity tests
- Steps 19-22: Client tests + manual verification

**Sequencing notes:**
- **Non-reorderable 2→8:** Schema before composer, composer return before tick/route, server contract before client types.
- **MANDATORY pairs:** A-1/A-2 (helper + scans ship together); A-1+A-3+A-5 are three independent MANDATORY amendments to technical-plan.
- **Sequential implementer (no parallelization):** One person, one path through.

