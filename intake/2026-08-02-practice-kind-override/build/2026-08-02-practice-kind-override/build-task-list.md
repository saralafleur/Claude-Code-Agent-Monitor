# Build Task List — practice-kind-override

Slug: `2026-08-02-practice-kind-override`
Worktree: `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor`
Base branch: `master`
Effort branch: `effort/2026-08-02-practice-kind-override`

**Execution mode:** sequential, test-first (red-first discipline on all guards)

---

## MANDATORY plan fixes (gates all work after §1–2)

### Task 1 — F1: Atomic coach_observations rebuild in server/db.js

**File(s):** `server/db.js` (lines 1373+, rebuild block after `coach_observations` `CREATE TABLE`)

**What changes:** Rewrite the `coach_observations` severity-CHECK rebuild to wrap the entire DDL in one atomic `BEGIN…COMMIT` block (create-new-then-rename shape), **not** the `plan_items` rename-first precedent. Copy the `agents` rebuild (lines 1478–1514) as the shape model.

**Layer/component:** Data layer / database schema

**Type:** Implementation (plan fix, gates all tests)

**Done-check:** 
- `git diff` shows exactly one `db.exec(...)` containing: `BEGIN;` → `CREATE TABLE coach_observations_new (…CHECK(severity IN ('info','warning'))…);` → `INSERT INTO coach_observations_new SELECT … FROM coach_observations;` → `DROP TABLE coach_observations;` → `ALTER TABLE coach_observations_new RENAME TO coach_observations;` → `COMMIT;`
- `PRAGMA foreign_keys = OFF` is **outside and before** the `BEGIN`, not inside
- Both indexes (`idx_coach_observations_open`, `idx_coach_observations_detected_at`) are recreated after the transaction
- Pre-flight scan (`SELECT COUNT(*) FROM coach_observations WHERE severity NOT IN ('info','warning')`) is preserved; **skip the rebuild (log, no throw, no rewrite) if count > 0**

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (supersedes `technical-plan.md` Step 2.2's non-atomic approach)

**MANDATORY:** Yes — silent total data loss via crashed rebuild orphan is the core defect this plan corrects.

---

### Task 2 — F2: Orphan detection guard in coach_observations rebuild

**File(s):** `server/db.js` (rebuild block, idempotency check)

**What changes:** Add to the rebuild's idempotency guard: gate the rebuild on `hasCheck && !orphanExists`, where `orphanExists` checks for `coach_observations_old` or `coach_observations_new` in `sqlite_master`. On orphan detection: **log loudly, skip the rebuild, never throw** (throwing at `require()` time bricks all servers — Express, MCP, Electron, VS Code extension).

**Layer/component:** Data layer / migration guard

**Type:** Implementation (plan fix, gates all tests)

**Done-check:**
- `git diff` shows the idempotency guard reads `sqlite_master` for orphan table names
- The guard contains **no `throw`** on the orphan-found path, only `console.error()` / `log()` and `return`
- The next boot after an interrupted rebuild skips silently (cheap belt-and-suspenders with F1's atomic wrap)

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (orphan-detection belt)

**MANDATORY:** Yes — acts as both safety net and proof that F1's atomic wrap prevents the failure mode.

---

### Task 3 — F3: Backup and manual double-boot walk-through (deferrable until final gate, but required before merge)

**File(s):** (none — operational task)

**What changes:** (none yet)

**Layer/component:** Ops / manual verification

**Type:** Verification (deferred to Task 31, but required before merge)

**Done-check:** Performed at Task 31 (after all tests pass):
- Real `dashboard.db` copied to a safe backup location
- New build booted twice against a **copy** of the real DB
- Second boot is a clean no-op (no migration re-run)
- All existing `coach_observations` rows readable, byte-identical `id`s and values
- Both indexes present and functional

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (manual verification gate)

**MANDATORY:** Yes — per `technical-plan.md` §6.6 and `test-plan.md` F3.

---

## Phase 1 — Atomicity tests (T1a, T1b, T1c)

### Task 4 — T1a: Structural atomicity scan

**File(s):** `server/__tests__/coach-observations-severity-rebuild.test.js` (new)

**What changes:** Create new test file (mirror `agents-legacy-rebuild.test.js` structure). Write structural scan:

```javascript
it("the coach_observations rebuild's DDL lives inside a single BEGIN…COMMIT db.exec", () => {
  const dbSrc = fs.readFileSync(require.resolve("../db.js"), "utf8");
  const match = dbSrc.match(/db\.exec\(\s*`[^`]*CREATE TABLE coach_observations_new[^`]*`\s*\)/s);
  assert(match, "db.exec not found");
  const execContent = match[0];
  assert(execContent.includes("BEGIN;"), "missing BEGIN");
  assert(execContent.includes("INSERT INTO coach_observations_new"));
  assert(execContent.includes("DROP TABLE coach_observations"));
  assert(execContent.includes("RENAME TO coach_observations"));
  assert(execContent.includes("COMMIT;"), "missing COMMIT");
  assert(!execContent.includes("PRAGMA foreign_keys"), "PRAGMA inside transaction");
});
```

**Layer/component:** Data layer / migration test

**Type:** Test (structural guard)

**Done-check:** 
- Test reads `server/db.js` as text
- Asserts the rebuild DDL is in one `db.exec` template literal
- Asserts `BEGIN` and `COMMIT` bracket the entire operation
- Asserts `PRAGMA foreign_keys = OFF` is **not** inside that string
- **Red-first proof required:** temporarily revert the rebuild to `plan_items` non-atomic shape (separate `ALTER`/`CREATE`/`DROP` statements) → test must **fail** naming §9.6 → restore F1 → test must **pass**. Record the observation in the commit message.

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (structural proof)

**MANDATORY:** Yes — proven red.

---

### Task 5 — T1b: Interruption test (behavior proof)

**File(s):** `server/__tests__/coach-observations-severity-rebuild.test.js`

**What changes:** Interruption test:

```javascript
it("an interrupted rebuild rolls back: every original row is still readable through coach_observations", () => {
  // Build legacy DB with 3 rows (raw better-sqlite3, no db.js)
  const tempDb = buildLegacyDb([
    { id: 1, practice_id: "account-weekly-balance", scope_type: "global", scope_id: "global", values_json: "{}", status: "open", responded_at: null, severity: "info" },
    { id: 2, practice_id: "session-token-ceiling", scope_type: "session", scope_id: "session123", values_json: "{}", status: "dismissed", responded_at: Date.now(), severity: "warning" },
    { id: 3, practice_id: "account-weekly-balance", scope_type: "global", scope_id: "global", values_json: "{}", status: "open", responded_at: null, severity: "info" },
  ]);
  
  // Open with better-sqlite3, run rebuild prefix WITHOUT COMMIT (simulating crash)
  const db = new Database(tempDb);
  const prefix = `BEGIN; CREATE TABLE coach_observations_new (…); INSERT INTO … SELECT …; DROP TABLE coach_observations;`;
  db.exec(prefix); // no COMMIT — transaction left open
  db.close(); // crash simulation
  
  // Reopen and verify rollback
  const dbAfterCrash = new Database(tempDb);
  const rows = dbAfterCrash.prepare("SELECT id FROM coach_observations ORDER BY id").all();
  assert.deepEqual(rows.map(r => r.id), [1, 2, 3], "original rows should be readable");
  const hasCheck = dbAfterCrash.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'").get()?.sql?.includes("CHECK(severity IN");
  assert(!hasCheck, "CHECK should not be present after crash rollback");
  dbAfterCrash.close();
  
  // Now require db.js and let it run the migration to completion
  delete require.cache[require.resolve("../db")];
  require("../db");
  
  // Final checks
  const dbAfterMigration = new Database(tempDb);
  const rowsAfter = dbAfterMigration.prepare("SELECT id, severity FROM coach_observations ORDER BY id").all();
  assert.deepEqual(rowsAfter, rows, "all rows should be preserved");
  const hasCheckAfter = dbAfterMigration.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'").get()?.sql?.includes("CHECK(severity IN");
  assert(hasCheckAfter, "CHECK should be present after successful migration");
  dbAfterMigration.close();
});
```

**Layer/component:** Data layer / migration test

**Type:** Test (behavioral guard)

**Done-check:**
- Test simulates an interrupted migration (open transaction, close without commit)
- Verifies rollback leaves original table intact with all rows readable
- Verifies `sqlite_master` shows no CHECK after rollback
- Then runs `require("../db")` to complete the migration
- Verifies all rows preserved post-migration, `CHECK` now present
- **Red-first proof required:** run against non-atomic rebuild → test must **fail** (original rows unreachable in `coach_observations_old` while new table is empty/CHECK-bearing) → against F1 must **pass**. Record in commit message.

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (behavioral proof of atomicity)

**MANDATORY:** Yes — proven red; this test proves F1 actually shipped.

---

### Task 6 — T1c: Orphan boot guard test

**File(s):** `server/__tests__/coach-observations-severity-rebuild.test.js`

**What changes:** Test that orphan detection prevents data destruction:

```javascript
it("boots without throwing, and without destroying data, when an orphaned coach_observations_old exists alongside a CHECK-bearing table", () => {
  // Seed DB with CHECK-bearing coach_observations (looks migrated) + a populated coach_observations_old (orphan from interrupted migration)
  const tempDb = buildLegacyDb([], true); // builds with CHECK already
  const db = new Database(tempDb);
  db.exec(`CREATE TABLE coach_observations_old (
    id INTEGER PRIMARY KEY,
    practice_id TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    values_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','acknowledged','dismissed')),
    responded_at INTEGER,
    severity TEXT NOT NULL
  )`);
  db.prepare("INSERT INTO coach_observations_old VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    1, "account-weekly-balance", "global", "global", "{}", "open", null, "info"
  );
  db.close();
  
  // Require db.js — must not throw
  delete require.cache[require.resolve("../db")];
  assert.doesNotThrow(() => require("../db"), "boot should not throw on orphan");
  
  // Verify orphan was not silently destroyed
  const dbAfterBoot = new Database(tempDb);
  const orphanRows = dbAfterBoot.prepare("SELECT COUNT(*) as cnt FROM coach_observations_old").get();
  assert.equal(orphanRows.cnt, 1, "orphaned rows should not be destroyed");
  dbAfterBoot.close();
});
```

**Layer/component:** Data layer / migration guard

**Type:** Test (orphan-detection guard)

**Done-check:**
- Boots without throwing when orphan tables exist
- Orphan data is **not** silently dropped
- Logs loudly (check console for warnings)
- **Red-first proof required:** remove F2's `!orphanExists` clause → test must fail (boot throws or orphan is destroyed) → restore F2 → test must pass.

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (orphan-guard proof)

**MANDATORY:** Yes — proven red.

---

## Phase 2 — Migration clean path (T3a–T3d)

### Task 7 — T3a: Clean upgrade path — 6 assertions

**File(s):** `server/__tests__/coach-observations-severity-rebuild.test.js`

**What changes:** Test the normal upgrade path with legacy DB:

```javascript
describe("Migration: coach_observations severity CHECK rebuild", () => {
  it("boots successfully against a legacy pre-CHECK database", () => {
    const tempDb = buildLegacyDb([
      { id: 1, practice_id: "account-weekly-balance", scope_type: "global", scope_id: "global", values_json: "{}", status: "open", responded_at: null, severity: "info" },
      { id: 2, practice_id: "account-weekly-balance", scope_type: "global", scope_id: "global", values_json: "{}", status: "dismissed", responded_at: Date.now(), severity: "warning" },
    ]);
    assert.doesNotThrow(() => require("../db"), "should boot without throwing");
  });
  
  it("adds CHECK constraint to sqlite_master", () => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'").get()?.sql;
    assert(sql.includes("CHECK(severity IN"), "CHECK constraint should be in DDL");
  });
  
  it("preserves all rows byte-identical (id, columns, values, order)", () => {
    const before = [ { id: 1, severity: "info" }, { id: 2, severity: "warning" } ];
    const after = db.prepare("SELECT id, severity FROM coach_observations ORDER BY id").all();
    assert.deepEqual(after, before, "rows should be byte-identical");
  });
  
  it("recreates both indexes", () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='coach_observations'").all();
    const names = indexes.map(i => i.name);
    assert(names.includes("idx_coach_observations_open"), "open index missing");
    assert(names.includes("idx_coach_observations_detected_at"), "detected_at index missing");
  });
  
  it("rejects new out-of-enum values", () => {
    assert.throws(
      () => db.prepare("INSERT INTO coach_observations VALUES (3, 'test', 'global', 'global', '{}', 'open', null, 'critical')").run(),
      /CHECK constraint failed|SQLITE_CONSTRAINT/,
      "should reject severity='critical'"
    );
  });
  
  it("is idempotent: second boot is a no-op", () => {
    const countBefore = db.prepare("SELECT COUNT(*) as cnt FROM coach_observations").get().cnt;
    delete require.cache[require.resolve("../db")];
    require("../db");
    const countAfter = db.prepare("SELECT COUNT(*) as cnt FROM coach_observations").get().cnt;
    assert.equal(countAfter, countBefore, "row count should not change on second boot");
  });
});
```

**Layer/component:** Data layer / migration test

**Type:** Test (migration correctness)

**Done-check:**
- Six independent assertions all pass
- Migration runs on first boot
- Second boot is a no-op (CHECK already present, rebuild skipped)
- All rows preserved with original `id`s and values
- Both indexes recreated
- CHECK constraint enforced (new inserts with bad values rejected)

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (clean-path proof)

**MANDATORY:** Indirectly — gates all downstream work.

---

### Task 8 — T3b: WATCH-3 skip path — exactly-one-bad-row fixture

**File(s):** `server/__tests__/coach-observations-severity-rebuild.test.js`

**What changes:** Test the pre-flight skip behavior (WATCH-3):

```javascript
describe("Migration: coach_observations severity CHECK rebuild — pre-flight skip (WATCH-3)", () => {
  beforeEach(() => {
    // Seed with exactly one out-of-enum row (the count-of-exactly-1 fixture per risk.md §4.2)
    const tempDb = buildLegacyDb([ /* conforming rows */ ], false);
    const db = new Database(tempDb);
    db.prepare("INSERT INTO coach_observations VALUES (999, 'test', 'global', 'global', '{}', 'open', null, 'critical')").run();
    db.close();
  });
  
  it("does not throw at require time", () => {
    assert.doesNotThrow(() => require("../db"), "should skip gracefully, not throw");
  });
  
  it("skips the rebuild when out-of-enum data exists (leaves CHECK absent)", () => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'").get()?.sql;
    assert(!sql.includes("CHECK(severity IN"), "CHECK should not be added (rebuild skipped)");
  });
  
  it("never rewrites the offending row (preserves 'critical' value)", () => {
    const row = db.prepare("SELECT severity FROM coach_observations WHERE id=999").get();
    assert.equal(row.severity, "critical", "offending row should not be rewritten");
  });
});
```

**Layer/component:** Data layer / migration guard

**Type:** Test (WATCH-3 skip behavior)

**Done-check:**
- Three assertions verify the skip path
- No throw (boot succeeds)
- CHECK not added (rebuild skipped)
- Offending row not rewritten (frozen invariant preserved)
- **Red-first proof required:** temporarily disable the pre-flight scan in the rebuild code → test must fail (rebuild proceeds and throws on `INSERT INTO … SELECT` with `'critical'`) → restore pre-flight scan → test must pass.

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (WATCH-3 skip path, per `decisions.md`)

**MANDATORY:** Yes — proven red; guards against destructive rewrites.

---

### Task 9 — T3d: Registry-derived CHECK assertion

**File(s):** `server/__tests__/coach-observations-severity-rebuild.test.js`

**What changes:** Assert DDL CHECK matches exported enum:

```javascript
it("DDL CHECK constraint values match the exported SEVERITY_VALUES registry", () => {
  const { SEVERITY_VALUES, KIND_VALUES } = require("../lib/playbook/practices");
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'").get()?.sql;
  
  // Extract CHECK value list from DDL
  const severityCheck = sql.match(/CHECK\(severity IN \('([^']+)','([^']+)'\)\)/)?.[0];
  const kindCheck = sql.match(/CHECK\(kind IN \('([^']+)','([^']+)','([^']+)'\)\)/)?.[0];
  
  assert(severityCheck, "severity CHECK not found");
  assert(kindCheck, "kind CHECK not found");
  
  // Compare against exported arrays
  const expectedSeverity = ["'info'", "'warning'"].sort().join(",");
  const actualSeverity = severityCheck.match(/'[^']+'/g).sort().join(",");
  assert.equal(actualSeverity, expectedSeverity, `severity CHECK values (${actualSeverity}) must match SEVERITY_VALUES (${expectedSeverity})`);
  
  const expectedKind = ["'risk'", "'info'", "'good'"].sort().join(",");
  const actualKind = kindCheck.match(/'[^']+'/g).sort().join(",");
  assert.equal(actualKind, expectedKind, `kind CHECK values (${actualKind}) must match KIND_VALUES (${expectedKind})`);
});
```

**Layer/component:** Data layer / schema validation

**Type:** Test (source-of-truth guard)

**Done-check:**
- Test parses DDL CHECK value lists
- Compares against `KIND_VALUES` and `SEVERITY_VALUES` exported from `server/lib/playbook/practices.js`
- Deep-equal assertion fails if DDL drifts from registry
- **Red-first proof required:** add a third value to the DDL CHECK (e.g., `'critical'`) without touching `SEVERITY_VALUES` → test must fail with a clear mismatch message → revert → test must pass.

**Catalog ID:** Single-source-of-truth guardrail (T3d in test-plan §Single-source-of-truth guardrail)

**MANDATORY:** Yes — proven red; prevents hand-edited DDL drift from exported registry.

---

### Task 10 — T3c: Real server boots against migrated DB

**File(s):** `server/__tests__/coach-observations-severity-rebuild.test.js` (add to the same describe block as T3a)

**What changes:** After T3a's migration, start a real Express app:

```javascript
it("a real Express server boots and serves the migrated rows via GET /api/coach/observations", async () => {
  const app = createApp();
  const { server, port } = await startServer(app, 0);
  
  try {
    const res = await fetch(`http://localhost:${port}/api/coach/observations`, {
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(res.status, 200, "GET should succeed");
    const observations = await res.json();
    assert(Array.isArray(observations), "response should be an array");
    
    // Spot-check: every row's kind/severity is one of the pinned enum values
    for (const obs of observations) {
      assert(
        ["risk", "info", "good"].includes(obs.kind),
        `invalid kind: ${obs.kind}`
      );
      assert(
        ["info", "warning"].includes(obs.severity),
        `invalid severity: ${obs.severity}`
      );
    }
  } finally {
    server.close();
  }
});
```

**Layer/component:** Integration layer / full-stack test

**Type:** Test (end-to-end server boot proof)

**Done-check:**
- Express app starts without throwing
- GET `/api/coach/observations` returns 200
- Legacy rows are present in the response
- All `kind`/`severity` values are from the pinned enums (not `null`, `undefined`, or raw i18n keys)

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (real server proof)

**MANDATORY:** Indirectly — verifies the whole stack, not just `db.js`.

---

## Phase 3 — Resolver implementation (Task 11)

### Task 11 — Step 1: Pin the enums in practices.js

**File(s):** `server/lib/playbook/practices.js` (above `PRACTICES` export)

**What changes:** Add three new exports before `PRACTICES`:

```javascript
/** The only `kind` values `coach_observations.kind`'s CHECK accepts, and the
 *  only values a kind override may take. Single source for the DB CHECK
 *  text, the route validator, the TS union in client/src/lib/types.ts, and
 *  the client's kindLabel i18n keys. */
const KIND_VALUES = ["risk", "info", "good"];

/** The only `severity` values, pinned by this build (see intake
 *  2026-08-02-practice-kind-override, DEC-1). Ordered low -> high. Mirrors
 *  exactly the two values the catalog has ever written, so
 *  coach_observations' new CHECK can never reject pre-existing data. */
const SEVERITY_VALUES = ["info", "warning"];

/** Membership check shared by the resolver (which coerces an invalid stored
 *  value to null) and the route validator (which rejects an invalid incoming
 *  value with 400). Deliberately different dispositions, one shared vocabulary. */
function coerceEnum(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

module.exports = { KIND_VALUES, SEVERITY_VALUES, coerceEnum, … };
```

**Layer/component:** Server catalog/resolver

**Type:** Implementation (foundational)

**Done-check:**
- `node -e "const p = require('./server/lib/playbook/practices'); console.log(p.KIND_VALUES, p.SEVERITY_VALUES);"` outputs the pinned arrays
- `coerceEnum` function is exported and works: `coerceEnum("risk", KIND_VALUES) === "risk"`, `coerceEnum("invalid", KIND_VALUES) === null`

**Catalog ID:** Single-source-of-truth guardrail (Step 1, technical-plan §3)

**MANDATORY:** Yes — all downstream work depends on this.

---

## Phase 4 — Frozen-snapshot engine tests (T2a, T2b, T2c)

### Task 12 — T2a: Frozen snapshot, global scope (account-weekly-balance)

**File(s):** `server/__tests__/playbook.test.js` (in existing `describe("playbook engine")` block, after line 204)

**What changes:** Add full frozen-snapshot regression test:

```javascript
it("freezes kind/severity onto each Observation at fire time; a later override change never relabels an earlier row (account-weekly-balance, global scope)", async () => {
  // Step 1: No override → fire → first row has catalog values
  const { tick, dbModule } = engineWithDb();
  seedAccount({ id: "test-account", weeklyBalance: 0 }); // triggers account-weekly-balance
  await tick();
  const first = dbModule.stmts.getCoachObservation.all()[0];
  assert.equal(first.kind, "info", "first row should have catalog kind");
  assert.equal(first.severity, "info", "first row should have catalog severity");
  
  // Dismiss to allow refire
  dbModule.stmts.updateCoachObservationStatus.run("dismissed", first.id);
  
  // Step 2: Set override → tick → second row has overridden values
  const practiceId = "account-weekly-balance";
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    practiceId,
    1,
    JSON.stringify({ gapThresholdPct: 25, kindOverride: "risk", severityOverride: "warning" })
  );
  seedAccount({ id: "test-account", weeklyBalance: 0 }); // trigger again
  await tick();
  const second = dbModule.stmts.getCoachObservation.get(dbModule.stmts.getCoachObservation.all()[1].id);
  assert.equal(second.kind, "risk", "second row should have overridden kind");
  assert.equal(second.severity, "warning", "second row should have overridden severity");
  
  // Re-read first row — must be unchanged
  const firstUnchanged = dbModule.stmts.getCoachObservation.get(first.id);
  assert.equal(firstUnchanged.kind, "info", "first row's kind must not change");
  assert.equal(firstUnchanged.severity, "info", "first row's severity must not change");
  assert.equal(firstUnchanged.status, "dismissed", "first row's status must still be dismissed");
  
  // Step 3: Change override again → tick → third row has new values
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    practiceId,
    1,
    JSON.stringify({ gapThresholdPct: 25, kindOverride: "good", severityOverride: "info" })
  );
  seedAccount({ id: "test-account", weeklyBalance: 0 });
  await tick();
  const third = dbModule.stmts.getCoachObservation.all()[2];
  assert.equal(third.kind, "good", "third row should have good kind");
  assert.equal(third.severity, "info", "third row should have info severity");
  
  // Re-read both prior rows — must be unchanged
  const firstFinal = dbModule.stmts.getCoachObservation.get(first.id);
  const secondFinal = dbModule.stmts.getCoachObservation.get(second.id);
  assert.deepEqual({ kind: firstFinal.kind, severity: firstFinal.severity }, { kind: "info", severity: "info" });
  assert.deepEqual({ kind: secondFinal.kind, severity: secondFinal.severity }, { kind: "risk", severity: "warning" });
});
```

**Layer/component:** Server engine / playbook evaluation

**Type:** Test (frozen-snapshot regression)

**Done-check:**
- Three-step fire → override → re-fire → override → re-fire cycle completes
- First row frozen as `info`/`info` (catalog)
- Second row frozen as `risk`/`warning` (override)
- Third row frozen as `good`/`info` (new override)
- Re-reading prior rows shows byte-identical values
- **Red-first proof required (§9.3):** run against pre-change engine.js (which still reads bare `practice.kind` at lines 97-98) → test must fail on `second.kind === "risk"` assertion → apply Task 13 (engine step 4) → test must pass. Record verbatim in commit message.

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (inverted form, frozen snapshot), §9.4 FIX-ROUND-REGRESSION (global scope proof)

**MANDATORY:** Yes — proven red; one of the two scope proofs required per §9.4.

---

### Task 13 — Step 4: Engine implementation — both fire sites together

**File(s):** `server/lib/playbook/engine.js` (lines 83, 97-98, 136, 145-146)

**What changes:** Both `evaluateSession()` and `evaluateGlobal()` destructure resolved values and pass them to the insert statement:

In `evaluateSession()` (around line 83):
```javascript
for (const { practice, config, kind, severity } of sessionPractices) {
  // … (unchanged logic)
  const info = stmts.insertCoachObservation.run(
    practice.id, "session", sessionId,
    kind, severity,  // was: practice.kind, practice.defaultSeverity
    JSON.stringify(result.values)
  );
```

In `evaluateGlobal()` (around line 136 and 145-146):
```javascript
for (const { practice, config, kind, severity } of enabledPractices) {
  // … (unchanged logic)
  const info = stmts.insertCoachObservation.run(
    practice.id, "global", "global",
    kind, severity,  // was: practice.kind, practice.defaultSeverity
    JSON.stringify(result.values)
  );
```

**Layer/component:** Server engine

**Type:** Implementation (core wiring)

**Done-check:**
- Both `evaluateSession()` and `evaluateGlobal()` updated in **the same commit**
- `grep -n "practice\.kind\|practice\.defaultSeverity" server/lib/playbook/engine.js` returns **nothing**
- Task 12 (T2a) test now passes
- Task 14 (T2b) test now passes (write it after this task)

**Catalog ID:** §9.4 FIX-ROUND-REGRESSION (both call sites changed together)

**MANDATORY:** Yes — both sites must change in one commit per §9.4.

---

### Task 14 — T2b: Frozen snapshot, session scope (session-token-ceiling)

**File(s):** `server/__tests__/playbook.test.js` (in same `describe("playbook engine")` block, immediately after T2a)

**What changes:** Twin test for session scope, **using deliberately different override values** so a test that accidentally reads the catalog cannot pass by coincidence:

```javascript
it("freezes kind/severity at fire time — session scope (session-token-ceiling); override changes never relabel prior rows", async () => {
  // Step 1: No override → fire → first row has catalog values
  const { tick, dbModule } = engineWithDb();
  const sessionId = seedSession({ tokens: 0 }); // underfunded → session-token-ceiling fires
  await tick();
  const first = dbModule.stmts.getCoachObservation.all()[0];
  assert.equal(first.kind, "risk", "first row catalog kind for session-token-ceiling");
  assert.equal(first.severity, "warning", "first row catalog severity for session-token-ceiling");
  
  // Dismiss to allow refire
  dbModule.stmts.updateCoachObservationStatus.run("dismissed", first.id);
  
  // Step 2: Override with provably-different values (good/info) → tick → second row has overridden values
  const practiceId = "session-token-ceiling";
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    practiceId,
    1,
    JSON.stringify({ kindOverride: "good", severityOverride: "info" })
  );
  seedSession({ tokens: 0 });
  await tick();
  const second = dbModule.stmts.getCoachObservation.all()[1];
  assert.equal(second.kind, "good", "second row should have overridden kind");
  assert.equal(second.severity, "info", "second row should have overridden severity");
  
  // Re-read first — must be unchanged
  const firstUnchanged = dbModule.stmts.getCoachObservation.get(first.id);
  assert.equal(firstUnchanged.kind, "risk", "first row's kind must not change");
  assert.equal(firstUnchanged.severity, "warning", "first row's severity must not change");
  
  // Step 3: Clear the override entirely (no kindOverride key) → tick → third row reverts to catalog
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    practiceId,
    1,
    JSON.stringify({}) // no kindOverride/severityOverride
  );
  seedSession({ tokens: 0 });
  await tick();
  const third = dbModule.stmts.getCoachObservation.all()[2];
  assert.equal(third.kind, "risk", "third row should revert to catalog kind");
  assert.equal(third.severity, "warning", "third row should revert to catalog severity");
  
  // Re-read both prior rows — must be unchanged
  const firstFinal = dbModule.stmts.getCoachObservation.get(first.id);
  const secondFinal = dbModule.stmts.getCoachObservation.get(second.id);
  assert.equal(firstFinal.kind, "risk");
  assert.equal(secondFinal.kind, "good");
});
```

**Layer/component:** Server engine / playbook evaluation

**Type:** Test (frozen-snapshot regression, session scope)

**Done-check:**
- Three-step cycle for session-scoped practice
- Override values deliberately differ from catalog (good/info vs. risk/warning)
- All three rows frozen with correct values
- Prior rows unchanged when override changes
- **Red-first proof required (§9.3):** run against pre-change engine.js → test must fail on `second.kind === "good"` assertion → apply Task 13 (engine step 4) → test must pass. Record in commit message **that both T2a and T2b went red on separate call sites**.

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (inverted form), §9.4 FIX-ROUND-REGRESSION (session scope proof — **two independent call sites, both must be tested**)

**MANDATORY:** Yes — proven red; the §9.4 lesson requires both scope tests to be independent.

---

### Task 15 — T2c: Status isolation test

**File(s):** `server/__tests__/playbook.test.js` (in same `describe("playbook engine")` block, immediately after T2b)

**What changes:** Cheap assertion that `updateCoachObservationStatus` never touches `kind`/`severity`:

```javascript
it("updateCoachObservationStatus never touches kind or severity", () => {
  const { dbModule } = engineWithDb();
  seedAccount({ id: "test-account", weeklyBalance: 0 });
  engine.tick(); // fire an observation
  const obs = dbModule.stmts.getCoachObservation.all()[0];
  const { kind, severity } = obs;
  
  dbModule.stmts.updateCoachObservationStatus.run("acknowledged", obs.id);
  const updated = dbModule.stmts.getCoachObservation.get(obs.id);
  
  assert.equal(updated.kind, kind, "kind should not change");
  assert.equal(updated.severity, severity, "severity should not change");
  assert.equal(updated.status, "acknowledged", "status should change");
});
```

**Layer/component:** Server engine / data layer

**Type:** Test (isolation guard)

**Done-check:**
- Fires an observation
- Updates its status via `updateCoachObservationStatus`
- Re-reads and asserts `kind`/`severity` unchanged, `status` changed
- Passes after Task 13 (engine step 4)

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (inverted form, no mutations)

**MANDATORY:** No — implied by T2a/T2b but named separately for grep-ability.

---

## Phase 5 — Structural guard (T4)

### Task 16 — Step 6: Create playbook-resolver-guard.test.js (new file)

**File(s):** `server/__tests__/playbook-resolver-guard.test.js` (new)

**What changes:** Create structural guard modeled on `single-writer-guard.test.js`:

```javascript
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

function scanFiles(dir, pattern, extensions = [".js"]) {
  const results = [];
  const walk = (p) => {
    const entries = fs.readdirSync(p, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (["node_modules", "dist", "__tests__"].includes(entry.name)) continue;
      const fullPath = path.join(p, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (pattern.test(content)) {
          results.push(entry.name);
        }
      }
    }
  };
  walk(dir);
  return [...new Set(results)]; // unique basenames
}

describe("Single-resolver structural guard (§9.1 DERIVED-DUAL-VIEW, this practice's effective kind/severity)", () => {
  it("practice.kind / practice.defaultSeverity are read raw only inside server/lib/playbook/practices.js", () => {
    const pattern = /practice\.kind\b|practice\.defaultSeverity\b/;
    const dirs = [path.join(__dirname, "..", "lib"), path.join(__dirname, "..", "routes")];
    const files = [];
    for (const dir of dirs) {
      files.push(...scanFiles(dir, pattern));
    }
    assert.deepEqual(
      files.sort(),
      ["practices.js"],
      "raw practice.kind/practice.defaultSeverity reads must only appear in practices.js"
    );
  });
  
  it("engine.js contains zero raw practice.kind / practice.defaultSeverity reads — both evaluateSession() and evaluateGlobal() must read the resolved value (§9.4)", () => {
    const enginePath = path.join(__dirname, "..", "lib", "playbook", "engine.js");
    const content = fs.readFileSync(enginePath, "utf8");
    const pattern = /practice\.kind\b|practice\.defaultSeverity\b/;
    const matches = (content.match(pattern) || []).length;
    assert.equal(
      matches,
      0,
      "engine.js must read resolved kind/severity from the destructured parameters, not raw practice.kind/practice.defaultSeverity. Both evaluateSession() and evaluateGlobal() must be fixed together (§9.4)."
    );
  });
  
  it("client/src reads practice.kind / practice.defaultSeverity nowhere but types.ts's interface declaration", () => {
    const pattern = /practice\.kind\b|practice\.defaultSeverity\b/;
    const files = scanFiles(
      path.join(__dirname, "..", "..", "client", "src"),
      pattern,
      [".ts", ".tsx"]
    );
    assert.deepEqual(
      files.sort(),
      ["types.ts"],
      "raw practice.kind/practice.defaultSeverity reads in client/src must only appear in types.ts (interface declaration). Check: did a preview card hardcode the catalog value again instead of reading the resolved draft value?"
    );
  });
});
```

**Layer/component:** Server test layer / structural guard

**Type:** Test (structural enforcement)

**Done-check:**
- File created with three assertions
- Each assertion scans the relevant directories for raw reads of `practice.kind` / `practice.defaultSeverity`
- Server assertion allows only `practices.js`
- Engine assertion requires zero occurrences
- Client assertion allows only `types.ts`
- **Red-first proof required (§9.3):** 
  1. Add `const rogue = practice.kind;` inside `evaluateSession()` in `engine.js` → run test → **T4b must fail** naming engine.js and §9.4 → remove
  2. Add `const rogue = practice.kind;` inside `SessionTokenCeilingCard` in `PlaybookPage.tsx` → run test → **T4c must fail** naming PlaybookPage.tsx → remove
  3. Re-run all three → green → record in commit message: "playbook-resolver-guard.test.js proven red by injecting a rogue `practice.kind` reader into `engine.js`'s `evaluateSession()` and into `PlaybookPage.tsx`'s `SessionTokenCeilingCard`; both assertions failed as expected; reverted."

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (primary form), §9.3 VACUOUS-GUARD (mandatory red-first proof), §9.4 FIX-ROUND-REGRESSION (engine-sharpest assertion)

**MANDATORY:** Yes — proven red; guards the single-resolver invariant structurally.

---

## Phase 6 — Route implementation and tests (Task 17–22)

### Task 17 — Step 3: Widen resolvePracticeConfig() return shape

**File(s):** `server/lib/playbook/practices.js` (resolvePracticeConfig function, ~lines 145–175)

**What changes:** Update the function's signature and JSDoc, widen return shape:

```javascript
/**
 * The sole source of truth for "practice defaults + stored overrides".
 * Both the engine (at fire time) and the route (at read time) read through
 * this function so they can never silently disagree about what's configured.
 * 
 * Returns {enabled, config, kindOverride, severityOverride, catalogKind,
 * catalogSeverity, kind, severity}. The *Override fields are the stored
 * values (null = unset); kind/severity are the effective values that the
 * engine will use at fire time.
 */
function resolvePracticeConfig(row, practice) {
  const config = defaultConfigFor(practice);
  const base = {
    config,
    catalogKind: practice.kind,
    catalogSeverity: practice.defaultSeverity,
  };
  if (!row) {
    return {
      ...base,
      enabled: true,
      kindOverride: null,
      severityOverride: null,
      kind: practice.kind,
      severity: practice.defaultSeverity,
    };
  }
  let stored = {};
  try { stored = JSON.parse(row.config) || {}; } catch { stored = {}; }

  for (const field of practice.fields) {  // existing numeric merge loop, unchanged
    const value = stored[field.key];
    if (typeof value === "number" && Number.isFinite(value) && value >= field.min) {
      config[field.key] = value;
    }
  }

  const kindOverride = coerceEnum(stored.kindOverride, KIND_VALUES);
  const severityOverride = coerceEnum(stored.severityOverride, SEVERITY_VALUES);
  return {
    ...base,
    enabled: !!row.enabled,
    kindOverride,
    severityOverride,
    kind: kindOverride ?? practice.kind,
    severity: severityOverride ?? practice.defaultSeverity,
  };
}

module.exports = { …, resolvePracticeConfig, … };
```

**Layer/component:** Server catalog/resolver

**Type:** Implementation (single resolver)

**Done-check:**
- Function returns all eight fields: `enabled`, `config`, `kindOverride`, `severityOverride`, `catalogKind`, `catalogSeverity`, `kind`, `severity`
- Overrides coerce via `coerceEnum()` (no throw on garbage, default to catalog)
- Effective values computed as `override ?? catalog`
- JSDoc updated to describe the new members

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (primary form, single resolver)

**MANDATORY:** Yes — gates all downstream route/client work.

---

### Task 18 — Step 5.1: Update serializePractice() in playbook.js

**File(s):** `server/routes/playbook.js` (serializePractice, ~lines 33–46)

**What changes:** Read `kind`/`severity` from resolved values, not directly off practice:

```javascript
function serializePractice(practice) {
  const row = stmts.getPlaybookPracticeConfig.get(practice.id);
  const r = resolvePracticeConfig(row, practice);
  return {
    id: practice.id,
    category: practice.category,
    scope: practice.scope,
    kind: r.catalogKind,               // catalog built-in — existing contract, unchanged meaning
    defaultSeverity: r.catalogSeverity,// catalog built-in — existing contract, unchanged meaning
    fields: practice.fields,
    enabled: r.enabled,
    config: r.config,                  // still numeric-only
    kindOverride: r.kindOverride,          // NEW: stored override or null
    severityOverride: r.severityOverride,  // NEW: stored override or null
    resolvedKind: r.kind,                  // NEW: effective value the engine would stamp now
    resolvedSeverity: r.severity,          // NEW: effective value
  };
}
```

**Layer/component:** Server API / route

**Type:** Implementation (route response)

**Done-check:**
- `kind` and `defaultSeverity` still report catalog values
- Four new fields added: `kindOverride`, `severityOverride`, `resolvedKind`, `resolvedSeverity`
- All read from `resolvePracticeConfig()`, never computed inline
- Test Task 20 (T5) will verify the route-level round-trip

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (primary form, route consumer)

**MANDATORY:** Yes — required for API contract and T5 route test.

---

### Task 19 — Step 5.2: Implement validateOverridePatch()

**File(s):** `server/routes/playbook.js` (new function, around line ~70, before PUT handler)

**What changes:** Add validation function alongside `validateConfigPatch`:

```javascript
function validateOverridePatch(body) {
  for (const [key, allowed] of [
    ["kindOverride", KIND_VALUES],
    ["severityOverride", SEVERITY_VALUES],
  ]) {
    if (!(key in body)) continue;             // omitted -> unchanged
    const v = body[key];
    if (v === null) continue;                 // explicit clear -> back to catalog default
    if (coerceEnum(v, allowed) === null) {
      throw new ValidationError(`${key} must be null or one of: ${allowed.join(", ")}`);
    }
  }
}

module.exports = { …, validateOverridePatch, … };
```

**Layer/component:** Server API / route validation

**Type:** Implementation (route validation)

**Done-check:**
- Function validates both override keys
- Rejects invalid values with 400 error message
- Allows explicit `null` (clear the override)
- Allows omitted keys (unchanged)
- Uses shared `KIND_VALUES`/`SEVERITY_VALUES`/`coerceEnum` from Task 11

**Catalog ID:** Single-source-of-truth guardrail (shared enum/coerce vocabulary)

**MANDATORY:** Yes — required for route safety and T5/T6 tests.

---

### Task 20 — Step 5.3: Update PUT /practices/:id/config handler

**File(s):** `server/routes/playbook.js` (PUT handler, ~lines 78–107)

**What changes:** Apply partial-patch discipline using `in` operator:

```javascript
router.put("/practices/:id/config", (req, res) => {
  const { id } = req.params;
  const practice = PRACTICES.find(p => p.id === id);
  if (!practice) {
    return res.status(404).json({ error: "PRACTICE_NOT_FOUND" });
  }

  const current = serializePractice(practice);
  const { body } = req;

  try {
    const enabled = body.enabled === undefined ? current.enabled : Boolean(body.enabled);
    const config = { ...current.config };
    
    if (body.config !== undefined) {
      validateConfigPatch(practice, body.config);
      Object.assign(config, body.config);
    }
    validateOverridePatch(body);
    
    // Partial-patch: use `in` operator, not `=== undefined`
    const kindOverride     = "kindOverride"     in body ? body.kindOverride     : current.kindOverride;
    const severityOverride = "severityOverride" in body ? body.severityOverride : current.severityOverride;
    
    const stored = { ...config };
    if (kindOverride !== null)     stored.kindOverride = kindOverride;
    if (severityOverride !== null) stored.severityOverride = severityOverride;
    
    stmts.upsertPlaybookPracticeConfig.run(practice.id, enabled ? 1 : 0, JSON.stringify(stored));
    
    const updated = serializePractice(practice);
    res.json(updated);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: "INVALID_CONFIG", message: err.message });
    }
    throw err;
  }
});
```

**Layer/component:** Server API / route handler

**Type:** Implementation (route handler)

**Done-check:**
- Uses `in` operator for key-presence checks (not `=== undefined`)
- `validateConfigPatch()` unchanged (still validates numeric fields only)
- Calls new `validateOverridePatch()` for override validation
- Omitting an override key leaves it unchanged
- Explicit `null` clears the override (removes key from stored JSON)
- Numeric-only save (e.g., `{ config: { gapThresholdPct: 30 } }`) leaves overrides intact
- Test Task 21 (T6) will prove the partial-patch discipline

**Catalog ID:** §9.1 (two-independent-validators, Architect risk #4)

**MANDATORY:** Yes — T6 catches the "silently eaten override" regression.

---

### Task 21 — T5: Route-level round-trip — "saved but never applied"

**File(s):** `server/__tests__/playbook.test.js` (in existing `describe("PUT /api/playbook/practices/:id/config")` block, line 313+)

**What changes:** Add the load-bearing route test:

```javascript
it("persists a kind override end-to-end: PUT succeeds AND a follow-up GET shows resolvedKind actually changed", async () => {
  // PUT with a kind override
  const putRes = await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: "risk",
  });
  assert.equal(putRes.status, 200, "PUT should succeed");
  assert.equal(putRes.body.kindOverride, "risk", "response should show stored override");
  assert.equal(putRes.body.resolvedKind, "risk", "response should show resolved value");
  assert.equal(putRes.body.kind, "info", "response should still show catalog kind (built-in)");
  
  // Follow-up GET to prove the override actually persisted (the critical direction)
  const getRes = await get("/api/playbook/practices");
  const practice = getRes.body.find(p => p.id === "account-weekly-balance");
  assert.equal(practice.kindOverride, "risk", "GET should show override persisted");
  assert.equal(practice.resolvedKind, "risk", "GET should show resolved value changed");
  
  // Restore state
  await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: null,
  });
});
```

**Layer/component:** Server API / route test

**Type:** Test (route round-trip, "saved but never applied" direction)

**Done-check:**
- PUT returns 200 with override visible
- Follow-up GET confirms override persisted and resolved value changed
- Both PUT and GET return byte-identical resolved values
- Omitted `config` parameter does not interfere
- Restore state at end

**Catalog ID:** §9.1 (two-independent-validators, "saved but never applied" direction)

**MANDATORY:** Yes — catches route that echoes request without re-resolving.

---

### Task 22 — T5b–T5d: Supporting route tests

**File(s):** `server/__tests__/playbook.test.js` (in same PUT block, immediately after T5)

**What changes:** Add four quick validation tests:

```javascript
it("400s on an invalid kind value", async () => {
  const res = await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: "not-a-kind",
  });
  assert.equal(res.status, 400);
  assert(res.body.message.includes("kindOverride"));
});

it("400s on an invalid severity value (proves the pinned enum)", async () => {
  const res = await put("/api/playbook/practices/account-weekly-balance/config", {
    severityOverride: "critical",
  });
  assert.equal(res.status, 400);
  assert(res.body.message.includes("severityOverride"));
});

it("clearing an override reverts to catalog defaults", async () => {
  await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: "good",
  });
  const clearRes = await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: null,
  });
  assert.equal(clearRes.body.kindOverride, null);
  assert.equal(clearRes.body.resolvedKind, clearRes.body.kind);
});

it("overriding one practice does not affect another", async () => {
  const beforeRes = await get("/api/playbook/practices");
  const sessionTokenBefore = beforeRes.body.find(p => p.id === "session-token-ceiling");
  
  await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: "good",
  });
  
  const afterRes = await get("/api/playbook/practices");
  const sessionTokenAfter = afterRes.body.find(p => p.id === "session-token-ceiling");
  
  assert.equal(sessionTokenAfter.kindOverride, null);
  assert.equal(sessionTokenAfter.resolvedKind, sessionTokenAfter.kind);
});
```

**Layer/component:** Server API / route tests

**Type:** Test (validation and isolation)

**Done-check:**
- All four tests pass after Task 18–20 implementation
- Route correctly rejects invalid override values
- `null` clearing works
- One practice's override does not affect another

**Catalog ID:** Single-source-of-truth guardrail, DEC-2 (generic mechanism, no per-practice special case)

**MANDATORY:** Indirectly — support tests for route-level correctness.

---

### Task 23 — T6: Numeric-only PUT preserves override

**File(s):** `server/__tests__/playbook.test.js` (in PUT block, after T5b–T5d)

**What changes:** Add the critical regression test:

```javascript
it("a numeric-only config PUT does not clear an existing kind override (partial-patch discipline)", async () => {
  // Set an override first
  await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: "risk",
  });
  
  // Then edit only a numeric field (the regression case)
  const res = await put("/api/playbook/practices/account-weekly-balance/config", {
    config: { gapThresholdPct: 30 },
  });
  
  // Override must survive
  assert.equal(res.body.kindOverride, "risk", "override should survive numeric-only save");
  assert.equal(res.body.resolvedKind, "risk", "resolved value should still reflect the override");
  
  // Follow-up GET to prove it persisted
  const getRes = await get("/api/playbook/practices");
  const practice = getRes.body.find(p => p.id === "account-weekly-balance");
  assert.equal(practice.kindOverride, "risk", "override should persist across a second fetch");
});
```

**Layer/component:** Server API / route test

**Type:** Test (regression, partial-patch discipline)

**Done-check:**
- Set override
- Save only numeric field
- Override intact after save
- Override persists in follow-up GET
- **Red-first proof required:** temporarily switch key-presence check from `in`-based to `{ ...row.config, ...body }` in Task 20 → test must fail (override cleared) → restore `in`-based logic → test must pass. Record in commit message.

**Catalog ID:** §9.1 (two-independent-validators, partial-patch discipline), Architect risk #4

**MANDATORY:** Yes — proven red; catches silently-eaten override on every threshold save.

---

### Task 24 — T5e: Full HTTP round-trip through engine tick

**File(s):** `server/__tests__/playbook.test.js` (new `describe("playbook override — API round trip through a live engine tick")` block)

**What changes:** Full-stack integration test:

```javascript
describe("playbook override — API round trip through a live engine tick", () => {
  let app, server, port, db;
  
  before(async () => {
    app = createApp();
    ({ server, port } = await startServer(app, 0));
    db = require("../db");
  });
  
  after(async () => {
    server.close();
  });
  
  it("setting an override persists and fires with the overridden kind/severity", async () => {
    // Seed a pre-existing Observation with no override
    seedAccount({ id: "test-account", weeklyBalance: 0 });
    await engine.tick();
    const preRes = await fetch(`http://localhost:${port}/api/coach/observations`);
    const preObs = (await preRes.json()).find(o => o.practice_id === "account-weekly-balance");
    assert.equal(preObs.kind, "info", "pre-existing observation has catalog kind");
    
    // Set an override via API
    const putRes = await fetch(`http://localhost:${port}/api/playbook/practices/account-weekly-balance/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kindOverride: "risk", severityOverride: "warning" }),
    });
    assert.equal(putRes.status, 200);
    
    // Dismiss the pre-existing Observation to allow re-fire
    db.prepare("UPDATE coach_observations SET status='dismissed' WHERE id=?").run(preObs.id);
    
    // Seed and tick again
    seedAccount({ id: "test-account", weeklyBalance: 0 });
    await engine.tick();
    
    // Fetch the new Observation
    const postRes = await fetch(`http://localhost:${port}/api/coach/observations`);
    const postObs = (await postRes.json()).find(o => o.practice_id === "account-weekly-balance" && o.id !== preObs.id);
    assert.equal(postObs.kind, "risk", "new observation should have overridden kind");
    assert.equal(postObs.severity, "warning", "new observation should have overridden severity");
    
    // Verify pre-existing observation is unchanged
    const preStill = (await (await fetch(`http://localhost:${port}/api/coach/observations`)).json())
      .find(o => o.id === preObs.id);
    assert.equal(preStill.kind, "info", "pre-existing observation should be frozen");
    assert.equal(preStill.severity, "info", "pre-existing observation should be frozen");
    
    // Change the override again and re-fetch the already-created row
    await fetch(`http://localhost:${port}/api/playbook/practices/account-weekly-balance/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kindOverride: "good" }),
    });
    
    const stillSame = (await (await fetch(`http://localhost:${port}/api/coach/observations`)).json())
      .find(o => o.id === postObs.id);
    assert.equal(stillSame.kind, "risk", "previously-fired observation should remain frozen");
  });
});
```

**Layer/component:** Integration layer / full-stack test

**Type:** Test (end-to-end flow)

**Done-check:**
- Seeds a pre-existing non-overridden Observation
- Sets override via HTTP PUT
- Ticks engine to fire a new Observation
- New Observation has overridden values
- Pre-existing Observation frozen at catalog values
- Changing the override later does not relabel the already-created row
- All kind/severity values are pinned enum values (no `null`, `undefined`, raw keys)

**Catalog ID:** §9.4 FIX-ROUND-REGRESSION (flow proof), frozen snapshot (inverted form)

**MANDATORY:** Indirectly — only HTTP round-trip proof; unit tests prove the same invariant at finer granularity.

---

## Phase 7 — Client layer

### Task 25 — Step 9.1: Type definitions

**File(s):** `client/src/lib/types.ts` (PlaybookPractice interface, around line 2100+)

**What changes:** Add enum types and extend PlaybookPractice:

```typescript
export type ObservationKind = "risk" | "info" | "good";
export type ObservationSeverity = "info" | "warning";

export interface PlaybookPractice {
  id: string;
  category: string;
  scope: "session" | "global";
  kind: ObservationKind;              // catalog built-in
  defaultSeverity: ObservationSeverity;
  kindOverride: ObservationKind | null;
  severityOverride: ObservationSeverity | null;
  resolvedKind: ObservationKind;
  resolvedSeverity: ObservationSeverity;
  fields: PlaybookField[];
  enabled: boolean;
  config: Record<string, number>;
}

export interface CoachObservation {
  // … existing fields …
  kind: ObservationKind;
  severity: ObservationSeverity;
}
```

**Layer/component:** Client type definitions

**Type:** Implementation (types)

**Done-check:**
- `ObservationKind` and `ObservationSeverity` union types defined
- `PlaybookPractice` gains four new fields
- `CoachObservation.severity` narrows from `string` to `ObservationSeverity`
- All four new fields required (never optional)

**Catalog ID:** Single-source-of-truth guardrail (TS type union mirrors exported enum)

**MANDATORY:** Yes — gates all client logic.

---

### Task 26 — Step 9.2: API update types

**File(s):** `client/src/lib/api.ts` (updatePracticeConfig type, ~line 2170)

**What changes:** Extend patch type:

```typescript
export type UpdatePracticeConfigParams = {
  enabled?: boolean;
  config?: Record<string, number>;
  kindOverride?: ObservationKind | null;
  severityOverride?: ObservationSeverity | null;
};

/**
 * PATCH /api/playbook/practices/:id/config
 * 
 * All fields are optional. Omitting a field leaves it unchanged.
 * To clear an override, send null; to leave it unchanged, omit the key.
 * Sending an invalid override value returns 400 INVALID_CONFIG.
 */
export async function updatePracticeConfig(
  id: string,
  patch: UpdatePracticeConfigParams
): Promise<PlaybookPractice> {
  // … existing impl, now accepting new fields …
}
```

**Layer/component:** Client API layer

**Type:** Implementation (API types)

**Done-check:**
- `UpdatePracticeConfigParams` includes override fields
- Override fields are optional and nullable
- JSDoc describes null-clears semantics
- Config still stays `Record<string, number>` (no poison)

**Catalog ID:** Single-source-of-truth guardrail (mirrors server types)

**MANDATORY:** Yes — gates client state management.

---

### Task 27 — Step 9.3: playbookStore.ts resolvers + optimistic merge

**File(s):** `client/src/lib/playbookStore.ts` (save method + new exports)

**What changes:** Export client-side resolvers and update optimistic merge:

```typescript
/**
 * Client-side resolution formula (duplicated from server's resolvePracticeConfig).
 * 
 * This is a second, independent copy of the server's resolution logic, and it is
 * unavoidable — the server cannot resolve a value the client has not saved yet,
 * and the live preview's purpose is to reflect what is currently being edited.
 * 
 * CRITICAL: the duplicate is used ONLY for unsaved draft state. On save, it is
 * replaced by the server's resolvedKind/resolvedSeverity, so divergence cannot
 * outlive one save. Per §9.1's documented-duplication pattern, test this via T8's
 * shared case table, driven through both runtimes.
 * 
 * See: technical-plan.md §2.4, §9.1; test-plan.md §Coverage gap / T8.
 */
export const resolveDraftKind = (
  practice: PlaybookPractice,
  draft: ObservationKind | null | undefined
): ObservationKind => {
  return (draft !== undefined ? draft : practice.kindOverride) ?? practice.kind;
};

export const resolveDraftSeverity = (
  practice: PlaybookPractice,
  draft: ObservationSeverity | null | undefined
): ObservationSeverity => {
  return (draft !== undefined ? draft : practice.severityOverride) ?? practice.defaultSeverity;
};

// In the store's save() method:
export async function save(
  id: string,
  draft: { enabled?: boolean; config?: Record<string, number>; kindOverride?: ObservationKind | null; severityOverride?: ObservationSeverity | null }
): Promise<void> {
  const res = await updatePracticeConfig(id, draft);
  
  // Optimistic merge: carry new fields and recompute resolved values
  setPractice(id, p => ({
    ...p,
    enabled: draft.enabled !== undefined ? draft.enabled : p.enabled,
    config: draft.config !== undefined ? { ...p.config, ...draft.config } : p.config,
    kindOverride: "kindOverride" in draft ? draft.kindOverride : p.kindOverride,
    severityOverride: "severityOverride" in draft ? draft.severityOverride : p.severityOverride,
    resolvedKind: resolveDraftKind({ ...p, kindOverride: "kindOverride" in draft ? draft.kindOverride : p.kindOverride }, undefined),
    resolvedSeverity: resolveDraftSeverity({ ...p, severityOverride: "severityOverride" in draft ? draft.severityOverride : p.severityOverride }, undefined),
  }));
  
  // Server response replaces optimistic values with authoritative ones
  setPractice(id, res);
}
```

**Layer/component:** Client state management

**Type:** Implementation (store logic + resolvers)

**Done-check:**
- `resolveDraftKind` and `resolveDraftSeverity` exported
- Formula: `(draft !== undefined ? draft : practice.kindOverride) ?? practice.kind`
- Docstring includes §9.1 documented-duplication warning with stated bound
- Optimistic merge carries all four fields
- Server response replaces optimistic values
- Partial-patch discipline (using `in` operator, not `=== undefined`)

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (second-order form, client-side duplicate), documented-duplication pattern

**MANDATORY:** Yes — enables live preview without flicker; T8 will verify byte-identical results.

---

### Task 28 — Step 9.4: PlaybookPage.tsx — OverrideSelects + preview wiring

**File(s):** `client/src/pages/PlaybookPage.tsx` (new OverrideSelects component + card wiring)

**What changes:** Add shared selector control and wire into both cards:

```typescript
function OverrideSelects({
  practice,
  kindDraft,
  severityDraft,
  onKind,
  onSeverity,
}: {
  practice: PlaybookPractice;
  kindDraft: ObservationKind | null | undefined;
  severityDraft: ObservationSeverity | null | undefined;
  onKind: (v: ObservationKind | null) => void;
  onSeverity: (v: ObservationSeverity | null) => void;
}) {
  return (
    <div className="overrideSelects">
      <label>
        Kind:
        <select value={kindDraft ?? ""} onChange={(e) => onKind(e.target.value === "" ? null : (e.target.value as ObservationKind))}>
          <option value="">{t("playbook.useDefaultOption", { value: t(`kindLabel.${practice.kind}`) })}</option>
          {["risk", "info", "good"].map(v => (
            <option key={v} value={v}>{t(`kindLabel.${v}`)}</option>
          ))}
        </select>
      </label>
      
      <label>
        Severity:
        <select value={severityDraft ?? ""} onChange={(e) => onSeverity(e.target.value === "" ? null : (e.target.value as ObservationSeverity))}>
          <option value="">{t("playbook.useDefaultOption", { value: t(`severityLabel.${practice.defaultSeverity}`) })}</option>
          {["info", "warning"].map(v => (
            <option key={v} value={v}>{t(`severityLabel.${v}`)}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

// Wire into SessionTokenCeilingCard (both card implementations):
function SessionTokenCeilingCard({ practice, onSave, onReset }: …) {
  const [kindDraft, setKindDraft] = useState<ObservationKind | null | undefined>(practice.kindOverride);
  const [severityDraft, setSeverityDraft] = useState<ObservationSeverity | null | undefined>(practice.severityOverride);
  
  const isDirty = () => {
    return kindDraft !== practice.kindOverride || 
           severityDraft !== practice.severityOverride ||
           // … existing config checks …
  };
  
  const handleSave = async () => {
    await onSave({
      kindOverride: kindDraft,
      severityOverride: severityDraft,
      config: { /* … existing … */ },
    });
    setKindDraft(practice.kindOverride);
    setSeverityDraft(practice.severityOverride);
  };
  
  const handleReset = () => {
    setKindDraft(practice.kindOverride);
    setSeverityDraft(practice.severityOverride);
    onReset();
  };
  
  return (
    <Card>
      <OverrideSelects
        practice={practice}
        kindDraft={kindDraft}
        severityDraft={severityDraft}
        onKind={setKindDraft}
        onSeverity={setSeverityDraft}
      />
      
      <ObservationCard
        kind={resolveDraftKind(practice, kindDraft)}  // ← CRITICAL: lines 257 + 335
        severity={resolveDraftSeverity(practice, severityDraft)}
        // … other props …
      />
      
      <button onClick={handleSave} disabled={!isDirty()}>Save</button>
      <button onClick={handleReset} disabled={!isDirty()}>Reset</button>
    </Card>
  );
}

// Same wiring for AccountWeeklyBalanceCard
```

**Layer/component:** Client UI / Playbook page

**Type:** Implementation (UI wiring)

**Done-check:**
- `OverrideSelects` component created as shared control
- Wired into **both** SessionTokenCeilingCard and AccountWeeklyBalanceCard
- **Lines 257 and 335 fixed:** preview passes `resolveDraftKind(practice, kindDraft)` instead of bare `practice.kind`
- Severity selector renders even though `ObservationCard` doesn't display it yet (WATCH-2)
- `isDirty`, `onSave`, `onReset` all handle overrides
- All values freely selectable (DEC-4, no disabling)

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (client display path, preview wiring), DEC-2 (generic mechanism, both cards), §9.4 FIX-ROUND-REGRESSION (both cards at once)

**MANDATORY:** Yes — T7 will verify the preview wiring works.

---

### Task 29 — T7: Live preview wiring test (both cards)

**File(s):** `client/src/pages/__tests__/PlaybookPage.test.tsx` (extend existing file)

**What changes:** Add live-preview test:

```typescript
// At top of file, add non-assertion comment:
// This page only ever shows the live RESOLVED value (draft or saved) — it never
// renders a persisted coach_observations row's frozen kind/severity. Per §9.1's
// explicit INVERTED application here (technical-plan.md §2.4/§5): do NOT add a
// "UI must match a Feed row" cross-check. The two are supposed to diverge after
// an override change; asserting they match would demand the wrong behavior.

describe("OverrideSelects and live preview", () => {
  const practiceIds = ["account-weekly-balance", "session-token-ceiling"];
  
  it.each(practiceIds)("renders kind and severity selectors defaulted to 'use default' (%s)", (id) => {
    const { getByLabelText } = render(
      <PlaybookPage
        practices={id === "account-weekly-balance" ? [ACCOUNT_BALANCE_PRACTICE] : [PRACTICE]}
        // …
      />
    );
    
    const kindSelect = getByLabelText(/kind/i);
    const severitySelect = getByLabelText(/severity/i);
    
    expect(kindSelect.value).toBe("");
    expect(severitySelect.value).toBe("");
  });
  
  it.each(practiceIds)(
    "changing the kind selector updates the live preview immediately, before any save (%s)",
    async (id) => {
      const { getByLabelText, getByText } = render(
        <PlaybookPage
          practices={id === "account-weekly-balance" ? [ACCOUNT_BALANCE_PRACTICE] : [PRACTICE]}
          // …
        />
      );
      
      const practice = id === "account-weekly-balance" ? ACCOUNT_BALANCE_PRACTICE : PRACTICE;
      const kindSelect = getByLabelText(/kind/i);
      
      // Preview starts on catalog label
      expect(getByText(t(`kindLabel.${practice.kind}`))).toBeInTheDocument();
      
      // Select "good"
      fireEvent.change(kindSelect, { target: { value: "good" } });
      
      // Preview updates immediately WITHOUT a save
      await waitFor(() => {
        expect(getByText(t("kindLabel.good"))).toBeInTheDocument();
      });
      
      expect(updatePracticeConfig).not.toHaveBeenCalled();
    }
  );
  
  it.each(practiceIds)("saving sends kindOverride and severityOverride in the patch (%s)", async (id) => {
    // … setup, select override, click save …
    
    await waitFor(() => {
      expect(updatePracticeConfig).toHaveBeenCalledWith(
        id,
        expect.objectContaining({
          kindOverride: "risk",
          severityOverride: "warning",
        })
      );
    });
  });
  
  it.each(practiceIds)("selecting 'use default' sends null (%s)", async (id) => {
    // … setup, set override, change to "use default", save …
    
    await waitFor(() => {
      expect(updatePracticeConfig).toHaveBeenCalledWith(
        id,
        expect.objectContaining({
          kindOverride: null,
        })
      );
    });
  });
});
```

**Layer/component:** Client test / Playbook component test

**Type:** Test (live preview wiring, client UI)

**Done-check:**
- Tests run against **both** card fixtures (DEC-2 validation)
- Live preview updates before any save (the load-bearing test — catches Task 28's lines 257/335)
- Save sends overrides in the patch
- Clearing sends `null`
- **Red-first proof required:** run against unpatched `PlaybookPage.tsx` (lines 257/335 still pass bare `practice.kind`) → "live preview updates" test must fail (preview doesn't change when selector changes) → apply Task 28 (fix lines 257/335) → test must pass. Record in commit message.

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (client display path, live preview), §9.4 FIX-ROUND-REGRESSION (both cards), §9.3 VACUOUS-GUARD (proven red)

**MANDATORY:** Yes — proven red; only test that catches the preview regression.

---

### Task 30 — T8: Client/server resolver parity test (shared case table)

**File(s):** 
- `server/__tests__/fixtures/playbook-resolution-cases.json` (new, shared fixture)
- `server/__tests__/playbook-resolver-parity.test.js` (new, server half)
- `client/src/lib/__tests__/playbookStore.test.ts` (new, client half)

**What changes:**

Create shared case table (`server/__tests__/fixtures/playbook-resolution-cases.json`):

```json
{
  "cases": [
    {
      "name": "catalog default, no override, no draft",
      "catalogKind": "risk",
      "kindOverride": null,
      "draft": "__UNSET__",
      "expected": "risk",
      "serverApplicable": true
    },
    {
      "name": "catalog default + stored override, no draft",
      "catalogKind": "risk",
      "kindOverride": "good",
      "draft": "__UNSET__",
      "expected": "good",
      "serverApplicable": true
    },
    {
      "name": "stored override garbage (out-of-enum)",
      "catalogKind": "risk",
      "kindOverride": "bogus",
      "draft": "__UNSET__",
      "expected": "risk",
      "serverApplicable": true
    },
    {
      "name": "draft wins over stored override",
      "catalogKind": "risk",
      "kindOverride": "good",
      "draft": "info",
      "expected": "info",
      "serverApplicable": false
    },
    {
      "name": "draft with no stored override",
      "catalogKind": "risk",
      "kindOverride": null,
      "draft": "info",
      "expected": "info",
      "serverApplicable": false
    },
    {
      "name": "explicit draft-clear falls to catalog (not stored override)",
      "catalogKind": "risk",
      "kindOverride": "good",
      "draft": null,
      "expected": "risk",
      "serverApplicable": false
    },
    {
      "name": "empty state",
      "catalogKind": "risk",
      "kindOverride": null,
      "draft": null,
      "expected": "risk",
      "serverApplicable": false
    }
  ]
}
```

Server half (`server/__tests__/playbook-resolver-parity.test.js`):

```javascript
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { PRACTICES } = require("../lib/playbook/practices");
const { resolvePracticeConfig } = require("../lib/playbook/practices");

describe("playbook resolver parity (T8) — server resolver", () => {
  const casesPath = path.join(__dirname, "fixtures", "playbook-resolution-cases.json");
  const { cases } = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  
  for (const testCase of cases.filter(c => c.serverApplicable)) {
    it(`resolves kind: ${testCase.name}`, () => {
      const practice = { id: "test", kind: testCase.catalogKind, fields: [], defaultSeverity: "info" };
      const row = testCase.kindOverride !== null
        ? { enabled: 1, config: JSON.stringify({ kindOverride: testCase.kindOverride }) }
        : null;
      
      const resolved = resolvePracticeConfig(row, practice);
      assert.equal(resolved.kind, testCase.expected, testCase.name);
    });
  }
});
```

Client half (`client/src/lib/__tests__/playbookStore.test.ts`):

```typescript
import { resolveDraftKind } from "../playbookStore";
import cases from "../../__tests__/fixtures/playbook-resolution-cases.json";

describe("playbook resolver parity (T8) — client draft resolver", () => {
  // Note: client tests BOTH parity rows (serverApplicable: true) and
  // draft-only rows (serverApplicable: false). Server tests only parity rows.
  
  for (const testCase of cases.cases) {
    it(`resolves kind: ${testCase.name}`, () => {
      const practice = {
        id: "test",
        kind: testCase.catalogKind as ObservationKind,
        kindOverride: testCase.kindOverride as ObservationKind | null,
        // … other fields …
      };
      
      const draft = testCase.draft === "__UNSET__" ? undefined : (testCase.draft as ObservationKind | null | undefined);
      const resolved = resolveDraftKind(practice, draft);
      
      assert.strictEqual(resolved, testCase.expected, testCase.name);
    });
  }
});
```

**Layer/component:** Server + client resolvers

**Type:** Test (resolver parity, §9.1 second-order form)

**Done-check:**
- Shared JSON case table checked in
- Server half tests all `serverApplicable: true` rows
- Client half tests all rows (parity + draft-only)
- Both runtimes produce byte-identical results
- Out-of-enum row tested on both sides (coerce-to-catalog on server, enum-check on client)
- **Red-first proof required:** temporarily change client's precedence to `p.kindOverride ?? draft ?? p.kind` (wrong order) → client half must fail on parity rows while server half stays green (divergence visible in exactly one half) → restore correct formula → both green. Also confirm client fails if enum-validity check omitted. Record in commit message.

**Catalog ID:** §9.1 DERIVED-DUAL-VIEW (second-order form, client/server duplicate), documented-duplication pattern, §9.3 VACUOUS-GUARD (proven red)

**MANDATORY:** Yes — proven red; closes the §9.1 second-order lesson from 2026-08-01.

---

## Phase 8 — i18n (Task 31)

### Task 31 — Step 8: i18n — all four locales

**File(s):** `client/src/i18n/locales/{en,vi,zh,ko}/coach.json`

**What changes:** Add new `severityLabel` block and new `playbook.*` selector-label keys to **all four** locales:

English (`en/coach.json`):
```json
{
  "kindLabel": { … existing … },
  "severityLabel": {
    "info": "Normal",
    "warning": "Elevated"
  },
  "playbook": {
    "kindOverrideLabel": "Kind",
    "severityOverrideLabel": "Severity",
    "useDefaultOption": "Use default ({value})"
  }
}
```

Vietnamese (`vi/coach.json`):
```json
{
  "severityLabel": {
    "info": "Bình thường",
    "warning": "Cần chú ý"
  },
  "playbook": {
    "useDefaultOption": "Dùng mặc định ({value})"
  }
}
```

Chinese (`zh/coach.json`):
```json
{
  "severityLabel": {
    "info": "常规",
    "warning": "需关注"
  },
  "playbook": {
    "useDefaultOption": "使用默认 ({value})"
  }
}
```

Korean (`ko/coach.json`):
```json
{
  "severityLabel": {
    "info": "일반",
    "warning": "주의"
  },
  "playbook": {
    "useDefaultOption": "기본값 사용 ({value})"
  }
}
```

**Layer/component:** Client i18n

**Type:** Implementation (localization)

**Done-check:**
- All four locales have `severityLabel.info` and `severityLabel.warning`
- All four locales have `playbook.useDefaultOption`
- `kindLabel` unchanged and verified present in all four
- No raw i18n keys render to the user (test this in Task 32)

**Catalog ID:** DEC-3 (documentation of the pinned enums), vocabulary completeness

**MANDATORY:** Practically (not technically) — missing keys in even one locale cause raw keys to render to users.

---

## Phase 9 — OpenAPI + docs (Task 32–33)

### Task 32 — Step 7: OpenAPI schema updates

**File(s):** `server/openapi-extra/playbook-coach.js` (schema definitions)

**What changes:** Update PlaybookPractice, PlaybookConfigPatchRequest, CoachObservation schemas:

```javascript
// PlaybookPractice (lines 70–122):
const PlaybookPractice = {
  type: "object",
  required: [
    "id", "category", "scope", "kind", "defaultSeverity", "fields",
    "enabled", "config", "kindOverride", "severityOverride",
    "resolvedKind", "resolvedSeverity" // NEW
  ],
  properties: {
    id: { type: "string" },
    category: { type: "string" },
    scope: { enum: ["session", "global"] },
    kind: {
      type: "string",
      enum: ["risk", "info", "good"],
      description: "Catalog built-in default kind. Use resolvedKind for the effective value after any override."
    },
    defaultSeverity: {
      type: "string",
      enum: ["info", "warning"],
      description: "Catalog built-in default severity. Use resolvedSeverity for the effective value after any override."
    },
    kindOverride: {
      type: "string",
      enum: ["risk", "info", "good"],
      nullable: true,
      description: "Stored override for kind, or null if unset. Use resolvedKind for the effective value."
    },
    severityOverride: {
      type: "string",
      enum: ["info", "warning"],
      nullable: true,
      description: "Stored override for severity, or null if unset. Use resolvedSeverity for the effective value."
    },
    resolvedKind: {
      type: "string",
      enum: ["risk", "info", "good"],
      description: "The effective kind: either the stored kindOverride or the catalog kind."
    },
    resolvedSeverity: {
      type: "string",
      enum: ["info", "warning"],
      description: "The effective severity: either the stored severityOverride or the catalog defaultSeverity."
    },
    fields: { type: "array", items: { $ref: "#/components/schemas/PlaybookField" } },
    enabled: { type: "boolean" },
    config: { type: "object", additionalProperties: { type: "number" } },
  },
};

// PlaybookConfigPatchRequest (lines 136–154):
const PlaybookConfigPatchRequest = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    config: {
      type: "object",
      additionalProperties: { type: "number" },
      description: "Numeric field values. Every key must match a practice field. Leave unset to keep current values."
    },
    kindOverride: {
      type: "string",
      enum: ["risk", "info", "good"],
      nullable: true,
      description: "Override the practice's kind. null clears the override. Omit to leave unchanged."
    },
    severityOverride: {
      type: "string",
      enum: ["info", "warning"],
      nullable: true,
      description: "Override the practice's severity. null clears the override. Omit to leave unchanged."
    },
  },
};

// CoachObservation (lines 192–201):
const CoachObservation = {
  type: "object",
  required: ["id", "practice_id", "scope_type", "scope_id", "kind", "severity", "values_json", "status", "detected_at", "responded_at"],
  properties: {
    id: { type: "integer" },
    practice_id: { type: "string" },
    scope_type: { enum: ["session", "global"] },
    scope_id: { type: "string" },
    kind: {
      type: "string",
      enum: ["risk", "info", "good"],
      description: "The resolved kind (catalog default or the practice's kindOverride if set) frozen at detection time. Never re-derived: changing an override later does not relabel existing Observations."
    },
    severity: {
      type: "string",
      enum: ["info", "warning"],
      description: "The resolved severity (catalog default or the practice's severityOverride if set) frozen at detection time. Never re-derived."
    },
    values_json: { type: "string" },
    status: { enum: ["open", "acknowledged", "dismissed"] },
    detected_at: { type: "integer" },
    responded_at: { type: ["integer", "null"] },
  },
};

// Update both hand-written example blocks (≈ lines 272–309 and 349–361)
```

**Layer/component:** Server API documentation

**Type:** Implementation (OpenAPI schema)

**Done-check:**
- PlaybookPractice schema has all eight fields, four marked as new
- PlaybookConfigPatchRequest has partial-patch properties
- CoachObservation descriptions clarify the freeze (resolved ≠ stored override)
- Both example blocks updated with realistic override values
- No contradictions between schema and actual route behavior (Task 20 implementation matches)

**Catalog ID:** Single-source-of-truth guardrail (schema as contract), DEC-3 (documentation)

**MANDATORY:** Yes — doc must never diverge from code.

---

### Task 33 — Step 13: Doc fix — coach-playbook-vocabulary.md

**File(s):** `library/knowledge/product/coach/coach-playbook-vocabulary.md` (around line 98)

**What changes:** Correct the `kind` enum table and document `severity` enum:

```markdown
#### Kind and Severity Enums

**Kind** — the category of practice, pinned to three values. Corrected 2026-08-02:
the shipped implementation (commit b6d372b, 2026-08-02) uses `risk`/`info`/`good`; 
the five-value set documented below was never built. The code is the source of 
truth — the DB CHECK constraint and four locale files already encode it. See 
`intake/2026-08-02-practice-kind-override/` DEC-3.

| Value | Meaning | UI Label (English) |
|---|---|---|
| `risk` | Problem or risk to address | "Warning" |
| `info` | Informational or status update | "Reminder" |
| `good` | Positive reinforcement | "Win" |

**Severity** — pinned by the 2026-08-02 build (see
`intake/2026-08-02-practice-kind-override/` DEC-1). Represents the urgency of
an Observation. Enforced by `coach_observations.severity CHECK(… IN ('info','warning'))`.

| Value | Meaning | UI Label (English) |
|---|---|---|
| `info` | Standard priority | "Normal" |
| `warning` | Elevated priority | "Elevated" |

#### Per-Practice Overrides

Both `kind` and `severity` are now overridable per practice via 
`playbook_practice_config.config`'s `kindOverride` and `severityOverride` keys
(top-level in the JSON blob, not nested). Overrides are resolved at observation
fire time and frozen onto the row, so changing an override later never relabels
existing Observations.
```

**Layer/component:** Documentation

**Type:** Documentation (vocabulary, DEC-3)

**Done-check:**
- `kind` enum corrected to `risk`/`info`/`good`
- Inline correction dated and cited to intake folder
- `severity` enum documented as `info`/`warning`
- Override mechanism documented
- Landed **in the same commit** as the schema change (per DEC-3's 8-hour-drift precedent)

**Catalog ID:** DEC-3 (documentation update, not runtime change)

**MANDATORY:** Yes — doc accuracy is part of the contract.

---

## Phase 10 — Durable cure (Task 34–35)

### Task 34 — D1: Extract rebuildTableAtomically() helper

**File(s):** `server/db.js` (new function, refactor Task 1)

**What changes:** Extract the atomic rebuild pattern into a helper:

```javascript
/**
 * Atomically rebuild a table using create-new → copy → drop-old → rename shape.
 * All DDL is in one BEGIN…COMMIT transaction to prevent crash-recovery orphans.
 * 
 * Call only at require() time with a fresh DB. Returns true if rebuild ran,
 * false if it was idempotent (already rebuilt).
 */
function rebuildTableAtomically({ table, createSql, copySelect, indexes }) {
  const result = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
  
  // Check if already rebuilt
  if (result?.sql?.includes("CHECK(") || /* other guard */) {
    return false; // already done
  }
  
  // Check for orphans
  const orphans = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?)`
  ).all(`${table}_old`, `${table}_new`);
  if (orphans.length > 0) {
    console.error(`[coach_observations rebuild] orphaned tables exist; skipping: ${orphans.map(r => r.name).join(", ")}`);
    return false;
  }
  
  // Atomic rebuild
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      BEGIN;
      ${createSql}
      ${copySelect}
      DROP TABLE ${table};
      ALTER TABLE ${table}_new RENAME TO ${table};
      COMMIT;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  
  // Recreate indexes
  for (const indexSql of indexes) {
    db.exec(indexSql);
  }
  
  return true;
}
```

Then refactor Task 1's `coach_observations` rebuild:

```javascript
// At require time, after CREATE TABLE IF NOT EXISTS coach_observations:
rebuildTableAtomically({
  table: "coach_observations",
  createSql: `CREATE TABLE coach_observations_new (id INTEGER PRIMARY KEY, …, CHECK(severity IN ('info','warning')))`,
  copySelect: `INSERT INTO coach_observations_new SELECT * FROM coach_observations`,
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_coach_observations_open ON coach_observations(status) WHERE status = 'open'`,
    `CREATE INDEX IF NOT EXISTS idx_coach_observations_detected_at ON coach_observations(detected_at)`,
  ],
});
```

**Layer/component:** Data layer / migration framework

**Type:** Implementation (refactor, durable cure D1)

**Done-check:**
- `rebuildTableAtomically()` function extracted
- `coach_observations` rebuild routed through it
- Task 1's tests (T1a, T1b, T1c, T3a–T3d) remain green with no edits
- Code change is refactor only, no behavior change
- Function is reusable for future rebuilds

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (structural cure), durable cure D1

**MANDATORY:** Yes per test-plan §Durable-cure decision — pays for itself at the next rebuild.

---

### Task 35 — D2: REBUILD_CASES meta-test in db-migration.test.js

**File(s):** `server/__tests__/db-migration.test.js` (extend existing meta-test at ~line 714)

**What changes:** Add registry-completeness scan:

```javascript
describe("db-migration meta-test — structural completeness", () => {
  it("every table rebuild in server/db.js has a legacy-DB case and an interruption case", () => {
    const dbSrc = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
    
    // Scan for rebuild patterns: ALTER TABLE (\w+) RENAME TO \1_old
    const rebuildMatches = dbSrc.match(/ALTER TABLE (\w+) RENAME TO \1_old/g) || [];
    const rebuilds = rebuildMatches.map(m => m.match(/(\w+)/)[1]);
    
    // Expected: coach_observations (new, T1/T3)
    // Grandfathered (non-atomic, to be fixed separately):
    const REBUILD_CASES = {
      coach_observations: { legacy: true, interruption: true }, // NEW, this build
      plan_items: { legacy: true, interruption: false, reason: "§9.6 pre-existing, non-atomic (5 latent instances); fixed separately per test-plan D2" },
      webhook_targets: { legacy: false, interruption: false, reason: "§9.6 pre-existing, non-atomic" },
      agents: { legacy: true, interruption: false, reason: "§9.6 pre-existing, non-atomic" },
      token_usage: { legacy: false, interruption: false, reason: "§9.6 pre-existing, non-atomic" },
      subscriptions: { legacy: false, interruption: false, reason: "§9.6 pre-existing, non-atomic" },
    };
    
    // Verify all found rebuilds are in the registry
    for (const table of rebuilds) {
      assert(
        REBUILD_CASES[table],
        `Table rebuild for '${table}' found in db.js but not in REBUILD_CASES registry`
      );
    }
    
    // Verify every new non-grandfathered rebuild has cases
    for (const [table, config] of Object.entries(REBUILD_CASES)) {
      if (!config.reason) { // non-grandfathered
        assert(
          config.legacy && config.interruption,
          `'${table}' rebuild must have both legacy-DB and interruption cases`
        );
      }
    }
  });
});
```

**Layer/component:** Server test layer / structural completeness

**Type:** Test (meta-test, durable cure D2)

**Done-check:**
- Scan finds all six rebuilds in `server/db.js`
- `coach_observations` is registered as new with both cases
- Five pre-existing rebuilds are grandfathered with dated reasons citing §9.6
- **Red-first proof required:** run test before adding REBUILD_CASES → immediately lights up all five existing sites → add grandfathered list → test green. Record in commit message.
- No attempt to retrofit the five existing sites (separate follow-up)

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (structural meta-test, durable cure D2)

**MANDATORY:** Yes per test-plan §Durable-cure decision — kills the class, not just this instance.

---

## Phase 11 — Final verification (Task 36–37)

### Task 36 — Run full test suite

**File(s):** (none)

**What changes:** (none)

**Layer/component:** (test verification)

**Type:** Verification

**Done-check:**
```bash
npm test
npm run test:server
npm run test:client
```
All pass. Baseline was green (Task done), all new tests pass, existing tests still pass.

**Catalog ID:** Definition of Done (suite gate)

**MANDATORY:** Yes — blocks merge.

---

### Task 37 — Manual double-boot walkthrough (F3, deferred from Task 3)

**File(s):** `dashboard.db` (real DB copy)

**What changes:** (none)

**Layer/component:** Ops / manual verification

**Type:** Verification (deferred from Task 3)

**Done-check:**
- Real `dashboard.db` backed up to a safe location (per F3, Task 3)
- New build booted twice against a **copy** of the real DB
- First boot: migration runs, `coach_observations` table gains `CHECK` constraint
- Second boot: idempotency guard prevents re-run
- All rows readable with original `id`s and byte-identical values
- Both indexes (`idx_coach_observations_open`, `idx_coach_observations_detected_at`) present and functional
- All `kind` and `severity` values are from pinned enums
- All four locale files have `severityLabel` keys + `playbook.useDefaultOption` (no raw key renders)
- No throws, no silent data loss

**Catalog ID:** §9.6 NON-ATOMIC REBUILD (manual DoD gate), technical-plan §6.6

**MANDATORY:** Yes — required before merge.

---

## Summary

**Total tasks:** 37

**Sequencing notes:**
- Tasks 1–2 (F1, F2) are plan fixes that gate everything after
- Tasks 3–10 (T1, T3) are the rebuild tests that prove atomicity
- Tasks 11–16 (resolver + guard) establish single resolver
- Tasks 12–15 (T2a–T2c) prove frozen-snapshot invariant at engine layer
- Tasks 17–24 (route implementation + T5/T6) prove end-to-end persistence
- Tasks 25–30 (client types + T7 + T8) prove client wiring and resolver parity
- Tasks 31–33 (i18n + OpenAPI + docs) complete the contract
- Tasks 34–35 (D1, D2) build the durable cure
- Tasks 36–37 (suite + manual walk) final gates

**Red-first proof points** (§9.3 VACUOUS-GUARD):
- T1a: proven red by reverting to non-atomic shape
- T1b: proven red by simulating crash (original rows unreachable)
- T1c: proven red by removing orphan guard
- T2a: proven red against pre-change engine (both call sites)
- T2b: proven red against pre-change engine (session scope)
- T3b: proven red by disabling pre-flight scan
- T3d: proven red by adding value to DDL without updating registry
- T4a/T4b/T4c: proven red by injecting rogue `practice.kind` readers
- T6: proven red by switching to `=== undefined` logic
- T7: proven red against unpatched preview lines 257/335 (both cards)
- T8: proven red with intentionally reversed precedence (divergence in client half only)

**MANDATORY durable-cure tasks:**
- Task 1 (F1): Atomic rebuild (§9.6) — enforced by T1a/T1b/T1c
- Task 2 (F2): Orphan guard (§9.6) — enforced by T1c
- Task 16 (T4): Structural resolver guard (§9.1) — enforced by T4a/T4b/T4c
- Task 30 (T8): Client/server parity (§9.1 second-order) — enforced by shared case table
- Task 34 (D1): rebuildTableAtomically() helper (§9.6) — refactor, tests stay green
- Task 35 (D2): REBUILD_CASES meta-test (§9.6) — enforced by registry scan

**Catalog IDs cited:**
- §9.1 DERIVED-DUAL-VIEW (primary & second-order forms, inverted application)
- §9.3 VACUOUS-GUARD (red-first proofs)
- §9.4 FIX-ROUND-REGRESSION (both engine call sites, both cards)
- §9.6 NON-ATOMIC REBUILD (atomic rebuild, orphan guard, meta-test)
- DEC-1, DEC-2, DEC-3 (decisions embedded in tasks)
- WATCH-1, WATCH-2, WATCH-3 (scope boundaries in decisions.md)
