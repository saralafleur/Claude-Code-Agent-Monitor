# Build Task List — value-summary-tick

**Status: READY TO BUILD**

**Branch:** `effort/2026-08-04-value-summary-tick` (base: `master` @ `b155f830c79698349952d2c88ea9f60bedaaf66d`)

**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor`

**Approvals cited:** technical-plan.md (§4, steps 1–18), test-plan.md (all layers L1–L4), decisions.md (DEC-1..17, WATCH-1..8, OPEN-1..4), qa/decisions.md (QA-DEC-1..4)

---

## Preconditions (verified in build-brief.md)

**✓ STEP 1 IS ALREADY COMPLETED** — The ~991-line uncommitted altitude layer is committed on `master` at `b155f830c79698349952d2c88ea9f60bedaaf66d` and verified green by `npm run test:server`, `npm run test:client`, and `check-headers.sh`. The branch `effort/2026-08-04-value-summary-tick` is already cut from it. The implementer does **not** repeat step 1; they verify `git diff --name-only master effort/2026-08-04-value-summary-tick` is empty at their own start and begin at Task 1 (the schema).

**Pre-build checklist:**
- [ ] `git status --porcelain` in worktree returns empty
- [ ] `git diff --name-only master effort/2026-08-04-value-summary-tick` returns empty (verifies no hidden drift)
- [ ] Concurrent Claude sessions checked: `ps aux | grep -i claude | grep -v grep` and `lsof +D /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/.git 2>/dev/null | head` both clear
- [ ] `npm install` run (if needed); dev env ready

---

## Task 1 — Schema: additive tables & prepared statements

**Files touched:** `server/db.js`

**Component/Layer:** Server schema & statements

**Step type:** IMPLEMENTATION (no test step precedes this; schema is verified green by existing suite green)

**What changes:**

1. Add new `db.exec(...)` block after ~line 1778 (next to `focus_summary_access_log` precedent):
   - `CREATE TABLE IF NOT EXISTS value_summary_sweep_state` — `project_id TEXT PRIMARY KEY`, `last_swept_at TEXT`, `pending_after_sweep INTEGER NOT NULL DEFAULT 0`
   - `CREATE TABLE IF NOT EXISTS value_summary_generation_log` — `id INTEGER PRIMARY KEY AUTOINCREMENT`, `project_id TEXT NOT NULL`, `source TEXT NOT NULL CHECK(source IN ('tick','request'))`, `outcome TEXT NOT NULL CHECK(outcome IN ('ok','skipped','error'))`, `pool_size INTEGER NOT NULL DEFAULT 0`, `cache_hits INTEGER NOT NULL DEFAULT 0`, `generated INTEGER NOT NULL DEFAULT 0`, `queued INTEGER NOT NULL DEFAULT 0`, `unavailable INTEGER NOT NULL DEFAULT 0`, `model TEXT`, `duration_ms INTEGER`, `created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
   - Two indexes: `idx_value_summary_generation_log_created_at` on `created_at`, `idx_value_summary_generation_log_project` on `(project_id, created_at)`
   - Schema comment explaining each table's purpose and DEC-14's rationale for the unused-in-v1 `source` value

2. Add three prepared statements to `stmts` (~line 3145, next to `getValueUnitSummary`/`upsertValueUnitSummary`):
   - `listValueSweepTargets(limit)` — `SELECT p.id AS project_id, s.last_swept_at FROM projects p JOIN (SELECT DISTINCT project_id FROM project_paths) pp ON pp.project_id = p.id LEFT JOIN value_summary_sweep_state s ON s.project_id = p.id ORDER BY (s.last_swept_at IS NOT NULL) ASC, s.last_swept_at ASC, p.id ASC LIMIT ?` (uses portable `IS NOT NULL`, real timestamp ordering per §9.2)
   - `upsertValueSweepState(project_id, last_swept_at, pending_after_sweep)` — `INSERT ... ON CONFLICT(project_id) DO UPDATE SET last_swept_at = excluded.last_swept_at, pending_after_sweep = excluded.pending_after_sweep`
   - `insertValueSummaryGeneration(project_id, source, outcome, pool_size, cache_hits, generated, queued, unavailable, model, duration_ms)` — plain `INSERT INTO value_summary_generation_log (...) VALUES (...)`

**Done-check:**

```bash
npm run test:server
# Confirms 1583+ passing (existing count), no failures, schema is additive

git diff master -- server/db.js | grep -i "ALTER TABLE"
# Must return nothing — §9.5/§9.6 remain inapplicable
```

**Rationale:** Schema is additive (`CREATE TABLE IF NOT EXISTS`); no migration path needed, no rebuild. New DB gets the tables; existing DB keeps old shape forever (no `ALTER`), but they remain unreferenced until the tick is written.

---

## Task 2 — Create stub & test chronology disposition (RED-FIRST)

**Files touched:** `server/lib/value-summary-tick.js` (new, stub only), `server/__tests__/chronology-ordering.test.js` (no changes yet — test is red against stub)

**Component/Layer:** Server structural guard / file registry

**Step type:** TEST RED (before any real implementation)

**What changes:**

1. Create `server/lib/value-summary-tick.js` as an empty stub:
   ```js
   // @file Background tick that sweeps projects in least-recently-swept rotation,
   // calls enrichPoolAltitudes per project, and logs sweep state & generation metrics.
   // @author Son Nguyen <hoangson091104@gmail.com>

   module.exports = {};
   ```

2. **RUN THE TEST — it must fail:**
   ```bash
   node --test server/__tests__/chronology-ordering.test.js
   # Expected output: "server/lib/value-summary-tick.js has no disposition in FILE_DISPOSITIONS"
   # Capture this output as red-proof
   ```

3. Once red is confirmed, add disposition to `FILE_DISPOSITIONS`:
   ```js
   "server/lib/value-summary-tick.js": "scanned",
   ```

4. **Re-run the test — it must now pass GREEN:**
   ```bash
   node --test server/__tests__/chronology-ordering.test.js
   # Capture output confirming green
   ```

**Done-check:**

- [ ] Captured red output showing the missing disposition error
- [ ] Entry added to `FILE_DISPOSITIONS`
- [ ] Re-run confirms green
- [ ] File header on stub is present (file-headers rule)
- **MANDATORY §9.7 compliance:** Derivation is live (observed red, then green), not grandfathered.

**Rationale:** DEC-9 requires observing the derivation fail *first* before the disposition lands — never adding blind. This is the §9.3 VACUOUS-GUARD enforcement: the tripwire must be proven, not read.

---

## Task 3 — Composer: split return shape & export states registry

**Files touched:** `server/lib/value-summary.js`, `server/__tests__/value-summary.test.js`

**Component/Layer:** Server synthesis composer

**Step type:** IMPLEMENTATION (with red-first test updates)

**Precondition:** Task 1 (schema is ready), Task 2 (chronology check complete)

**What changes:**

1. **value-summary.js:**
   - Change `enrichPoolAltitudes` to return `{ altitudes, states }` instead of just the altitudes object
   - Add new export: `ALTITUDE_STATES = ["queued", "unavailable"]`
   - Build `states` map per DEC-11 truth table:
     - All cache hits and resolved units → not in `states`
     - Over-cap misses (beyond `MAX_UNITS_PER_PROMPT`) → `queued` (never attempted)
     - In-cap misses that failed → `unavailable` (attempted but produced nothing)
     - When LLM unavailable, all misses → `unavailable` (nothing attempted)
   - Rewrite lines 36–38 comment: "the cap bounds prompt size, not coverage — the largest measured real pool is 182 units (parent effort DEC-12, 2026-08-03), so overflow is the normal case and is reported explicitly as `queued`, then drained by `value-summary-tick.js`."
   - Update `@file` overview: two invokers (route fast path, tick overflow sweep), one writer
   - **Do not move, wrap, or duplicate** the `dbModule.stmts.upsertValueUnitSummary.run(...)` call — it stays exactly where it is, line 179, one lexical site inside `enrichPoolAltitudes` (invariant enforced by step 9's guard)

2. **value-summary.test.js — RED-FIRST destructure existing call sites:**
   - Run tests before this step — existing 6 call sites will fail on wrong shape
   - Update all 6 destructures: `const { altitudes, states } = await enrichPoolAltitudes(...)`
   - Specific sites per `unit-tests.md` §2a (follow verbatim)
   - Empty batch case: `assert.deepEqual(await enrichPoolAltitudes(dbModule, []), { altitudes: {}, states: {} })` (not lazy `{}`)
   - "Leaves a unit out" case: update each `deepEqual` to include `states` with the unavailable entry

3. **value-summary.test.js — ADD DEC-11 truth-table cases (before any implementation touches composer):**
   - Describe block: `"enrichPoolAltitudes DEC-11 truth table"`
   - **Case 1 (under-cap, LLM on):** 3 units, all resolve → `altitudes` has 3 entries, `states` is `{}`
   - **Case 2 (over-cap, LLM on):** 45 units, 40 resolve → `altitudes` has 40, `states` has 5 `queued`, 0 `unavailable`
   - **Case 3 (over-cap + LLM off, T-B trap):** 45 units, LLM mode heuristic → `altitudes` is `{}`, `states` has 45 `unavailable` (note: **zero queued**, all attempts were skipped)
   - **Case 4 (in-cap failure, T-D trap):** 45 units, parse failure in cap → 0 resolved, 40 `unavailable`, 5 `queued` (over-cap slice untouched)
   - **Case 5 (mutual exclusivity + complete partition):** all four cases above + check `no key in both`, **and** `altKeys.size + stateKeys.size === submitted.length` (the "never in neither" half)
   - **Case 6 (registry import, not hand-typed):** `assert.deepEqual(ALTITUDE_STATES, ["queued", "unavailable"])` and every case: `Object.values(states).every(s => ALTITUDE_STATES.includes(s))` (imported, never hardcoded)

**Done-check:**

```bash
node --test server/__tests__/value-summary.test.js
# 6 destructure failures before the split lands (wrong shape, no export)
# (Do not proceed until these fail)
# Then implement the split above, re-run, all 6 + the 6 truth-table cases pass green
```

**Rationale:** Red-first proof that the 6 call sites actually break when the shape changes. If they don't, a call site was missed or the shape change was wrong. The truth table cases are the acceptance criteria for the per-unit state semantics and must pass independently.

---

## Task 4 — Route: forward composed states (synchronous fast path unchanged)

**Files touched:** `server/routes/project-plans.js`, `server/__tests__/value-summary.test.js`

**Component/Layer:** Server request path

**Step type:** IMPLEMENTATION

**Precondition:** Task 3 (composer split is done and test-passing)

**What changes:**

1. **project-plans.js:**
   - Line 23: change import from `const valueSummary = require(...)` to destructured `const { enrichPoolAltitudes } = require("../lib/value-summary");` (required by `assertSingleHome` check in step 9)
   - Lines 153–154: destructure result `const { altitudes, states } = await enrichPoolAltitudes(...)` and respond `res.json({ altitudes, states })`
   - Update route doc comment to describe `states`
   - **No other behavior change** — same validation, same 200-always contract, same ≤40 synchronous synthesis

2. **value-summary.test.js — ADD route cases (red-first before route change lands):**
   - Inside existing `describe("POST /api/project-plans/altitudes")`
   - **Case A (corrected from e2e-tests.md):** 2 cached + 43 fresh = 45 units, LLM on → `altitudes` has 41 (2 cached + 39 generated), `states` has 4 entries (1 `unavailable` at deliberately-omitted index 40, 3 `queued` for 41–44), 41 + 4 = 45; use imported `ALTITUDE_STATES.includes(s)` not hardcoded array
   - **Case B (LLM outage, T-B):** 45 units, `DASHBOARD_FOCUS_INFER_MODE=heuristic` → all 45 `unavailable`, zero `queued`, zero `altitudes`
   - **Fast-path regressions:** 1-unit happy path must have `states: {}` (present, not undefined); and an existing 3-unit test re-verified still passes

**Done-check:**

```bash
node --test server/__tests__/value-summary.test.js -- --grep "POST /api/project-plans/altitudes"
# Cases A and B fail before route change (res.body.states is undefined)
# (Do not proceed until these fail)
# Then implement route change, re-run, all pass green
```

**Rationale:** The route is the public HTTP contract; it must be proven to carry `states` before being trusted to round-trip it. The 45-unit cases are the first (and only) place AC-1's whole subject (over-cap handling) is observable on the wire.

---

## Task 5 — i18n registry check (RED-FIRST before key is added)

**Files touched:** `server/__tests__/value-summary.test.js` (add registry→locale check), `client/src/i18n/locales/en/projectDetail.json` + `ko`, `vi`, `zh` (add `queued` key when test goes green), `server/__tests__/i18n/__tests__/i18n.test.ts` (no changes — existing E1.1 will fail until all 4 locales match)

**Component/Layer:** Server registry + client i18n

**Step type:** TEST RED → IMPLEMENTATION → TEST GREEN

**Precondition:** Tasks 1–4 (composer and route are settled; ALTITUDE_STATES export exists)

**What changes:**

1. **value-summary.test.js — ADD registry→locale check in L4 section:**
   ```js
   it("every ALTITUDE_STATES member has a planLedger.pool.altitudes key in the en locale", () => {
     const en = JSON.parse(fs.readFileSync(
       path.join(__dirname, "../../client/src/i18n/locales/en/projectDetail.json"), "utf8"));
     const bucket = en.planLedger.pool.altitudes;
     for (const state of ALTITUDE_STATES) {
       assert.ok(
         Object.prototype.hasOwnProperty.call(bucket, state),
         `ALTITUDE_STATES member "${state}" has no planLedger.pool.altitudes.${state} copy in en/projectDetail.json`
       );
     }
   });
   ```
   Scope is **derived from the export**, not hand-typed — this is the §9.7 canonical-source enforcement.

2. **RUN THE TEST — it must fail RED:**
   ```bash
   node --test server/__tests__/value-summary.test.js -- --grep "every ALTITUDE_STATES member"
   # Expected: missing `queued` key
   # Capture output as red-proof
   ```

3. **Add `planLedger.pool.altitudes.queued` to all four locales:**
   - `client/src/i18n/locales/en/projectDetail.json` — add entry next to `generating`/`unavailable` (~line 154), value: **"Queued"** (short, same muted-italic styling, three-line shape must not jump)
   - `client/src/i18n/locales/ko/projectDetail.json` — same key, translated
   - `client/src/i18n/locales/vi/projectDetail.json` — same key, translated
   - `client/src/i18n/locales/zh/projectDetail.json` — same key, translated

4. **Re-run tests — both must now be GREEN:**
   ```bash
   node --test server/__tests__/value-summary.test.js -- --grep "every ALTITUDE_STATES member"
   # Captures green
   
   cd client && npx vitest run src/i18n/__tests__/i18n.test.ts -- --grep "E1.1"
   # E1.1 (whole-namespace parity) verifies ko/vi/zh now match en; captures green
   ```

5. **PROOF BY MUTATION — inject failure to prove test is not vacuous:**
   ```bash
   # Delete the queued key from ko locale
   # Re-run E1.1 → must fail (mismatches detected)
   # Restore key
   # Re-run → green
   # Capture both red and restored green
   ```

**Done-check:**

- [ ] Registry→locale check observed RED (missing key)
- [ ] `queued` key added to all 4 locales
- [ ] Both tests observed GREEN
- [ ] Mutation proof recorded (deleted key → red, restored → green)
- [ ] **MANDATORY §9.3 compliance:** Guard is not vacuous; it failed on real deletion

**Rationale:** §9.7 HAND-SCOPED STRUCTURAL SCAN — the client cannot import the server's CJS `ALTITUDE_STATES`, so the union hard-codes the strings. The server-side derived check (scope = the export) ensures the i18n obligation is impossible to miss. E1.1 enforces parity across locales mechanically. Adding the key is implementation; proving the check works is the gate.

---

## Task 6 — T-A concurrency case (cross-invoker safety)

**Files touched:** `server/__tests__/value-summary.test.js` (add concurrency describe block)

**Component/Layer:** Server concurrency/safety

**Step type:** TEST (no implementation step — the atomicity is already built via SQLite's `ON CONFLICT`, but this case proves it executes as expected under the exact use case: route and tick overlap)

**Precondition:** Tasks 3–4 (two invokers of `enrichPoolAltitudes` now exist: the route and the soon-to-be tick)

**What changes:**

1. **value-summary.test.js — ADD concurrency describe block (T-A trap):**
   ```js
   describe("enrichPoolAltitudes concurrency (T-A)", () => {
     it("two overlapping calls for the same unitKey leave exactly one valid row and never throw", async () => {
       const u = unit({ unitKey: "trunk_commit::race-1::/repo" });
       let spawnCount = 0;
       // Distinct payload per invocation, resolved on a later macrotask
       __injectSpawnForTest(() => {
         const n = ++spawnCount;
         return deferredSpawn(envelope({ units: [{ index: 1, project: `P-${n}`, stakeholder: `S-${n}.` }] }), 10);
       });
       
       const [a, b] = await Promise.all([
         enrichPoolAltitudes(dbModule, [u]),   // route-shaped invoker
         enrichPoolAltitudes(dbModule, [u]),   // tick-shaped invoker
       ]);
       
       const rows = db.prepare("SELECT * FROM value_unit_summaries WHERE unit_key = ?").all(u.unitKey);
       assert.equal(rows.length, 1, "atomic upsert: one row, never a duplicate");
       assert.ok(["P-1", "P-2"].includes(rows[0].project_level),
         "last write wins with a whole payload — never merged, never null");
       assert.ok(rows[0].stakeholder_level.endsWith("."));
       for (const r of [a, b]) {
         assert.ok(r.altitudes[u.unitKey], "a race must never downgrade a unit to queued/unavailable");
         assert.equal(r.states[u.unitKey], undefined);
       }
       // Deliberate: safe but wasteful. Tracked as QA-DEC-1 / WATCH-7.
       // If in-flight coalescing ever lands, update to 1.
       assert.equal(spawnCount, 2);
     });
   });
   ```
   Include local helper `deferredSpawn(stdout, ms)` if `fakeSpawn` doesn't already support delays; reuse `unit()`, `envelope()` from existing fixtures.

**Done-check:**

```bash
node --test server/__tests__/value-summary.test.js -- --grep "two overlapping calls"
# Must pass green (race is safe-but-wasteful, both spawns fire, one row survives, spawnCount === 2)
```

**Rationale:** T-A trap (two-writer race) is resolved by SQLite atomicity. This test proves the use case — concurrent route + tick — never corrupts or throws. The `spawnCount === 2` is the deliberate acceptance of wasteful duplication (in-flight coalescing is future work, WATCH-7).

---

## Task 7 — Create tick body (implementation)

**Files touched:** `server/lib/value-summary-tick.js` (stub → full implementation), `server/lib/value-ledger.js` (CONSUMERS registration)

**Component/Layer:** Server background service

**Step type:** IMPLEMENTATION

**Precondition:** Tasks 1–4 (schema, composer split, route); Task 2 (stub file exists and is registered)

**What changes:**

1. **value-summary-tick.js — full implementation:**

   File header per `.claude/rules/file-headers.md` (overview + exact `@author Son Nguyen <hoangson091104@gmail.com>` line).

   Exports:
   - `startValueSummaryTick(broadcast)` — starts background interval
   - `runValueSummaryTickOnce(dbModule, opts)` — single sweep cycle (synchronous entry for tests)
   - `listSweepTargets(dbModule, limit)` — fetch next N projects to sweep
   - `__injectPoolAssemblerForTest(fn)` — test seam for pool assembly
   - `__resetTickStateForTest()` — reset module state for test isolation
   - Exports: `DEFAULT_TICK_MS`, `BOOT_DELAY_MS`, `DEFAULT_MAX_PROJECTS_PER_TICK`

   Module structure:
   ```js
   const { assembleValuePool } = require("./value-ledger");
   const { enrichPoolAltitudes } = require("./value-summary");
   
   const DEFAULT_TICK_MS = 600_000;           // DEC-5, matches DASHBOARD_FOCUS_INFER_MS
   const BOOT_DELAY_MS = 30_000;              // DEC-5, matches focus-inference.js
   const DEFAULT_MAX_PROJECTS_PER_TICK = 3;
   let running = false;                        // module-scope overlap guard
   let poolAssembler = assembleValuePool;      // DEC-15 seam; production default only
   ```

   `listSweepTargets(dbModule, limit)`:
   - Returns `dbModule.stmts.listValueSweepTargets.all(limit)`

   `runValueSummaryTickOnce(dbModule, { broadcast, now } = {})`:
   1. `if (running) return { skipped: "overlap" };` wrapped in try/finally, `running = true`
   2. Read `MAX_PROJECTS_PER_TICK` from env inside function (not at start time)
   3. For each target project:
      - Inside per-project try/catch (fail-safe, one bad project doesn't stop sweep)
      - `const { units } = await poolAssembler(dbModule, { id: project_id })`
      - `const { altitudes, states } = await enrichPoolAltitudes(dbModule, units)`
      - Compute metrics: `cacheHits` (entries with `cached === true`), `generated` (entries with `cached === false`), `queued`/`unavailable` (counts from `states`), `model` (first generated entry's model or null), `duration_ms`
      - `dbModule.stmts.insertValueSummaryGeneration.run(project_id, "tick", outcome, units.length, cacheHits, generated, queued, unavailable, model, durationMs)` — outcome is `"ok"` or `"error"` from catch block
      - `dbModule.stmts.upsertValueSweepState.run(project_id, nowIso, queued + unavailable)` — **in finally block** (failed project still advances rotation)
      - `if (generated > 0 && broadcast) broadcast("value_altitudes_updated", { project_id, unit_keys: <generated keys>, pending: queued + unavailable })`
   4. Return `{ swept: <count>, projects: [{ project_id, generated, queued, unavailable }] }`

   `startValueSummaryTick(broadcast)`:
   - Return early if `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off`
   - Return early if `DASHBOARD_VALUE_SUMMARY_TICK_MS <= 0` or non-finite
   - `setTimeout(BOOT_DELAY_MS)` then `setInterval(DASHBOARD_VALUE_SUMMARY_TICK_MS)`, both `.unref()`'d, calling `runValueSummaryTickOnce(require("../db"), { broadcast }).catch(() => {})`

   `__injectPoolAssemblerForTest(fn)` / `__resetTickStateForTest()`:
   - First: set `poolAssembler = fn ?? assembleValuePool`
   - Second: set `running = false`

   **Explicitly NOT in this file:** any pool-membership SQL, any second `upsertValueUnitSummary` call, any `MAX_UNITS_PER_PROMPT` re-declaration, any retry/backoff scheduler.

2. **value-ledger.js:**
   - Add `"server/lib/value-summary-tick.js"` to `CONSUMERS` array (line 57) — **same commit as the entry lands in C2.4 (step 8)**

**Done-check:**

```bash
npm run test:server
# Confirms schema + tick skeleton passes existing suite (1583+)
# (Full tick tests come in step 9)
```

**Rationale:** The tick is a background service following the established pattern (focus-inference.js, reconciliation.js). The seam allows tests to inject a fake pool assembler. The stub is complete enough to not break the existing suite, but the full test surface lands in step 9.

---

## Task 8 — Structural guard: single-writer on `enrichPoolAltitudes` (RED-FIRST preparation)

**Files touched:** `server/__tests__/single-writer-guard.test.js` (new test blocks, not a new file), `server/__tests__/ledger-metrics-parity.test.js` (red-first setup)

**Component/Layer:** Server structural guard / registry

**Step type:** TEST RED → IMPLEMENTATION (tick body from task 7) → TEST GREEN

**Precondition:** Tasks 2–7 (composer exists, route exists, tick stub exists, CONSUMERS is about to be updated)

**What changes:**

1. **ledger-metrics-parity.test.js — RED-FIRST setup (no code change yet):**
   - The C2.4 expected array **will gain** `"server/lib/value-summary-tick.js"`, but don't add it yet
   - Run the test first: `node --test server/__tests__/ledger-metrics-parity.test.js` — **it will fail because the tick is not in CONSUMERS yet**
   - Capture this red output

2. **Add CONSUMERS entry** (this is the implementation):
   - Go to `value-ledger.js` line 57, add `"server/lib/value-summary-tick.js"` to the `CONSUMERS` array

3. **ledger-metrics-parity.test.js — GREEN (complete the red-then-green):**
   - Still NO code change to the C2.4 test itself yet
   - Re-run: `node --test server/__tests__/ledger-metrics-parity.test.js` — **it still fails** because C2.4's expected array doesn't include the tick yet (the test catches the mismatch)
   - **This is the tripwire working — CONSUMERS was updated, but C2.4 is still red**

4. **Update C2.4 expected array (second half of red-then-green):**
   - In the same test file, find C2.4's `const expected = [...]`
   - Add `"server/lib/value-summary-tick.js"` to the array

5. **ledger-metrics-parity.test.js — GREEN (final):**
   - Re-run: `node --test server/__tests__/ledger-metrics-parity.test.js` — **now green**
   - Capture this green output

**Done-check:**

- [ ] C2.4 observed RED with CONSUMERS updated but expected array unchanged (tripwire failure)
- [ ] C2.4 observed GREEN after both updates in the same commit
- [ ] **Both red and green outputs captured** — DEC-7's requirement is not optional

**Rationale:** DEC-7 requires observing the structural check fail *before* the production entry lands. This is §9.3 red-first: the mechanism (the check) is proven live, not merely read. If C2.4 does not go red between the two updates, either the check is vacuous or the entry was already there.

---

## Task 9 — Register the tick in server startup

**Files touched:** `server/index.js`

**Component/Layer:** Server initialization

**Step type:** IMPLEMENTATION

**Precondition:** Tasks 7–8 (tick is implemented, CONSUMERS/C2.4 are updated)

**What changes:**

1. **index.js:**
   - Inside `startBackgroundServices()` function, after reconciliation registration (~line 458)
   - Add try/catch block:
     ```js
     try {
       const { startValueSummaryTick } = require("./lib/value-summary-tick");
       startValueSummaryTick(broadcast);
     } catch (err) {
       console.warn("value summary tick failed to start:", err.message);
     }
     ```
   - Comment explains what it does and how to disable it (`DASHBOARD_VALUE_SUMMARY_TICK_MODE=off`)

**Done-check:**

```bash
npm run dev
# Server boots cleanly, no warning about tick startup (DASHBOARD_VALUE_SUMMARY_TICK_MODE is not set, so it starts)

DASHBOARD_VALUE_SUMMARY_TICK_MODE=off npm run dev
# Server boots equally cleanly; tick does not start
```

**Rationale:** The tick is a background service, not critical. If startup fails, it logs a warning but does not brick the server. The env var gates are proven in step 10's test suite.

---

## Task 10 — Tick test suite (comprehensive coverage with mutations)

**Files touched:** `server/__tests__/value-summary-tick.test.js` (new file)

**Component/Layer:** Server behavioral integration

**Step type:** TEST (with required RED mutations before GREEN)

**Precondition:** Tasks 1–9 (all components the tick depends on are implemented)

**What changes:**

Create new `server/__tests__/value-summary-tick.test.js` with file header per `.claude/rules/file-headers.md`.

Setup (per `unit-tests.md` §1 preamble):
- Set `DASHBOARD_DB_PATH` to throwaway before `require("../index")`
- Helper: `makeSweptProject(name, {lastSweptAt})` — create a project eligible for sweep
- Helper: `makeUnits(n, {prefix})` — parameterized unit factory
- Helper: `spawnResolvingFirst(n)` — returns first N units resolved
- Helper: `lastLogRow(pid)` — fetch most recent log row for project
- Helper: `sweepState(pid)` — fetch sweep state for project
- `beforeEach` resets: `__resetTickStateForTest()`, `__injectPoolAssemblerForTest(null)`, `__injectSpawnForTest(null)`

**Case 1 — Overlap guard (§9.3 RED mutation required):**
- Hold first `runValueSummaryTickOnce` open with deferred promise
- Assert concurrent second call returns `{ skipped: "overlap" }`
- Assert assembler called only once
- **MUTATION:** remove `if (running) return ...` → see two spawns → restore and confirm green
- Capture red output

**Case 2 — Per-tick bound:**
- Seed 5 eligible projects
- `MAX_PROJECTS_PER_TICK=2`
- Assert exactly 2 sweep-state rows, 2 log rows

**Case 3 — Least-recently-swept rotation (§9.2 rotation order):**
- Seed 3 projects: one never swept, one old, one recent
- Assert order is (never, old, recent)
- 3 sequential single-project ticks sweep all in order (starvation-free property)
- **MUTATION:** `ORDER BY p.id ASC` or `DESC` → array order changes → restore green

**Case 4 — Overflow drain (45 units across 2 ticks, AC-1):**
- Tick 1: 45 units, 0 cached, 40 generated → `pending_after_sweep = 5`
- Tick 2: same 45, now 40 cached, 5 generated → `pending_after_sweep = 0`
- Assert four-term partition on both: `cache_hits + generated + queued + unavailable === pool_size`
- Assert `SELECT COUNT(*) FROM value_unit_summaries === 45`
- Note: three-term form (`generated + queued + unavailable === pool_size`) would fail tick 2 at `5 ≠ 45`

**Case 5 — Broadcast discipline:**
- Spy on `broadcast` callback
- Generating sweep → exactly one `("value_altitudes_updated", { project_id, unit_keys, pending })` call
- All-cached sweep → zero calls
- LLM-off sweep → zero calls

**Case 6 — Failure isolation:**
- Two projects, one throws during assembly
- Failing project: gets `outcome='error'` log row, `last_swept_at` still advances (in finally)
- Other project: still swept `outcome='ok'` in same call
- **MUTATION:** move `upsertValueSweepState` out of finally → see starvation (no advance) → restore green

**Case 7 — Env wiring:**
- `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off` → `startValueSummaryTick` registers no timers
- `DASHBOARD_VALUE_SUMMARY_TICK_MS=0` → no timers
- **Control (positive proof):** default mode → `setTimeout` spy shows one call (without this, both negative cases pass vacuously)
- **MUTATION (one of the env-gate checks):** remove the `if (mode === "off") return` → timer still registers → restore green

**Case 8 — DEC-16 structural scan (no hand-rolled pool queries):**
- Read source of `value-summary-tick.js`, strip comments (per existing technique)
- Assert it matches `{ assembleValuePool } = require("./value-ledger")`
- Assert it does **not** match `FROM project_paths`, `FROM detour_dispositions`, `detectTrunkDrift`
- **MUTATION:** add dead `db.prepare("SELECT ... FROM project_paths")` → test fails → restore green

**Case 9 — T-C instrument: `pending_after_sweep` is re-derived, not decremented (§9.3 MANDATORY):**

Pool grows from 85 to 88 units; cap binds both ticks.

- Tick 1: `pool_size 85`, `cache_hits 0`, `generated 40`, `queued 45`, `unavailable 0` → `pending_after_sweep = 45`
- **3 new units arrive between ticks (the pool grows)**
- Tick 2: `pool_size 88`, `cache_hits 40` (tick 1's generated now cached), `generated 40`, `queued 8`, `unavailable 0` → `pending_after_sweep = 8`
- Assert four-term partition both ticks: `cache_hits + generated + queued + unavailable === pool_size`
- Assert `pending_after_sweep === queued + unavailable` on both ticks
- Failure message explains: "A decremented counter reads 5; a stale pool_size read also reads 5; only re-derivation reads 8"

Why 85/88 and not 45/48? At 45→48 the 40-unit cap doesn't bind on tick 2 (8 misses, all generated), so `pending_after_sweep = 0` under any implementation — the case would pass vacuously.

- **MUTATION (non-negotiable §9.3 proof):** implement `pending_after_sweep` as a decremented counter instead of re-derivation → tick 2 reads 5 → test fails expecting 8 → restore re-derivation → green
- Capture red output showing the wrong number

**Case 10 — Drain & read-back (flow proof, AC-1):**
- 45-unit batch, tick 1 generates 40
- `POST /api/project-plans/altitudes` for that project → reads back all 45 rows, 40 resolved, 5 queued

**Case 11 — Audit log (flow proof, AC-2):**
- Same as Case 4 tick 2
- Log row: `cache_hits 2 + generated 40 + queued 3 + unavailable 0 === pool_size 45`
- Assert the four-term partition

**Done-check:**

```bash
node --test server/__tests__/value-summary-tick.test.js
# All 9+ cases pass green

# Capture all red mutations:
# - Overlap guard: remove if (running), see 2 spawns, restore
# - Rotation order: ORDER BY p.id, wrong order, restore
# - Failure isolation: move finally block, starvation, restore
# - DEC-16 scan: add dead FROM project_paths, red, restore
# - T-C instrument: decrement counter, reads 5 not 8, restore

# Validate four-term partition everywhere:
grep -rn "cache_hits.*generated.*queued.*unavailable" server/__tests__/value-summary-tick.test.js
# Every occurrence must use + not <=
```

**Rationale:** T-C is §9.3 MANDATORY — the only instrument that could reveal starvation must be proven to distinguish correct (re-derived) from wrong (decremented/stale). This build's own defect class (one number collapsing two trajectories) must not reappear at the observability layer. The case is non-vacuous because the expected value (8) differs from every wrong answer (5).

---

## Task 11 — Structural guards (single-writer invariants) — RED-FIRST injection proofs

**Files touched:** `server/__tests__/single-writer-guard.test.js` (new test blocks), `server/routes/project-plans.js` (temporary injection for red-proof)

**Component/Layer:** Server structural guard

**Step type:** TEST RED → IMPLEMENTATION PROOF → TEST GREEN (not test-then-implement, but test-inject-observe-restore)

**Precondition:** Tasks 3, 4, 7 (both `enrichPoolAltitudes` invokers exist: route and tick)

**What changes:**

Add five test blocks to existing `describe` in `single-writer-guard.test.js` (reusing the file's existing `scanFiles` walker and shared `assertSingleHome` helper; **not** creating a new file or a second scope-derivation helper — DEC-6, §9.7).

**Block 1 — `upsertValueUnitSummary` appears only in two files:**
```js
it("upsertValueUnitSummary appears only in db.js and value-summary.js", () => {
  const files = scanFiles(serverDir, /upsertValueUnitSummary/);
  const basenames = files.map(f => path.basename(f)).filter(f => !f.endsWith('.test.js'));
  assert.deepEqual(basenames.sort(), ["db.js", "value-summary.js"]);
});
```

**Block 2 — `upsertValueUnitSummary.run(` lexical call site inside `enrichPoolAltitudes` (§9.1 MANDATORY):**
```js
it("upsertValueUnitSummary.run( has exactly one lexical call site, inside enrichPoolAltitudes", () => {
  const source = fs.readFileSync(path.join(serverDir, "lib/value-summary.js"), "utf8");
  // Strip comments
  const stripped = source.split('\n').map(line => {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.substring(0, idx);
  }).join('\n');
  
  const callMatches = Array.from(stripped.matchAll(/upsertValueUnitSummary\.run\s*\(/g));
  assert.equal(callMatches.length, 1, "totalCalls === 1 required");
  
  // Verify it's inside enrichPoolAltitudes body
  const enrichStart = stripped.indexOf("function enrichPoolAltitudes");
  assert.ok(enrichStart !== -1, "enrichPoolAltitudes not found");
  const braceDepth = [...stripped.substring(0, enrichStart).matchAll(/{/g)].length 
                   - [...stripped.substring(0, enrichStart).matchAll(/}/g)].length;
  // Parse from enrichStart to find the closing brace of the function
  let depth = braceDepth;
  let i = enrichStart;
  while (i < stripped.length && depth > braceDepth - 1) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') depth--;
    i++;
  }
  const enrichEnd = i;
  const inBodyCall = callMatches[0].index > enrichStart && callMatches[0].index < enrichEnd;
  assert.ok(inBodyCall, 
    "upsertValueUnitSummary.run( must be lexically inside enrichPoolAltitudes body (§9.1 DERIVED-DUAL-VIEW: one composer, one writer, two invokers)");
});
```

**Block 3 — `insertValueSummaryGeneration` appears only in db.js and tick (single-writer invariant):**
```js
it("insertValueSummaryGeneration has exactly one production call site (tick)", () => {
  const files = scanFiles(serverDir, /insertValueSummaryGeneration/);
  const basenames = files.map(f => path.basename(f)).filter(f => !f.endsWith('.test.js'));
  assert.deepEqual(basenames.sort(), ["db.js", "value-summary-tick.js"]);
  // Note: WATCH-6 will deliberately widen this in the fast-follow when request-path logging lands.
});
```

**Block 4 — `assertSingleHome` for `value-summary` exports:**
```js
it("value-summary.js's exports have an explicit disposition at every consumer", () => {
  assertSingleHome("../lib/value-summary", {
    "../routes/project-plans": {
      shared: ["enrichPoolAltitudes"],
      absent: ["buildPrompt", "parseOutput", "summaryModel", "MAX_UNITS_PER_PROMPT", "ALTITUDE_STATES"]
    },
    "../lib/value-summary-tick": {
      shared: ["enrichPoolAltitudes"],
      absent: ["buildPrompt", "parseOutput", "summaryModel", "MAX_UNITS_PER_PROMPT", "ALTITUDE_STATES"]
    }
  });
});
```

**Block 5 — `assertSingleHome` for `value-ledger` exports:**
```js
it("value-ledger.js's exports have an explicit disposition at the tick", () => {
  assertSingleHome("../lib/value-ledger", {
    "../lib/value-summary-tick": {
      shared: ["assembleValuePool"],
      absent: ["recordInferredDetour", "CONSUMERS", "computePlanHealth", /* ...rest of exports... */]
    }
  });
});
```

Then, **red-proof injection cycle (§9.3 MANDATORY):**

For Block 2 (`upsertValueUnitSummary` single-writer):

1. Run test — should pass green (since it's now in only one place in real code)
   ```bash
   node --test server/__tests__/single-writer-guard.test.js -- --grep "upsertValueUnitSummary.run"
   # GREEN (current code is correct)
   ```

2. **INJECT rogue call site** into `server/routes/project-plans.js`, inside the POST handler, after the call to `enrichPoolAltitudes`:
   ```js
   // TEMPORARY INJECTION FOR RED-PROOF:
   dbModule.stmts.upsertValueUnitSummary.run(/*...*/);
   ```

3. Re-run test — **must fail RED**:
   ```bash
   node --test server/__tests__/single-writer-guard.test.js -- --grep "upsertValueUnitSummary.run"
   # RED: "totalCalls === 1 required" (now 2)
   # Capture this output
   ```

4. **Remove injection** — restore exact byte-for-byte state

5. Re-run test — **must be GREEN again**:
   ```bash
   node --test server/__tests__/single-writer-guard.test.js -- --grep "upsertValueUnitSummary.run"
   # GREEN (back to original)
   ```

Repeat injection cycle for Block 3 (`insertValueSummaryGeneration`):

1. Run green
2. Inject rogue `dbModule.stmts.insertValueSummaryGeneration.run(...)` in the route
3. Observe red (totalCalls === 1 now fails)
4. Remove injection, observe green

Repeat for Block 4 and 5 (`assertSingleHome` checks):

1. Run green
2. Inject rogue import: `const { buildPrompt } = require("../lib/value-summary");` into tick, or `const { computePlanHealth } = require("../lib/value-ledger");` into tick
3. Observe red (shared/absent list mismatch)
4. Remove, green

**Done-check:**

- [ ] Block 1 observed green (two files only)
- [ ] Block 2 observed RED (injected rogue call site), then GREEN (removed)
- [ ] Block 3 observed RED (injected rogue call site), then GREEN (removed)
- [ ] Block 4 observed RED (injected rogue import), then GREEN (removed)
- [ ] Block 5 observed RED (injected rogue import), then GREEN (removed)
- [ ] All red outputs captured
- [ ] **MANDATORY §9.1 + §9.3 compliance:** Guards are proven to catch the exact scenario they name, not vacuous checks

**Rationale:** §9.1 DERIVED-DUAL-VIEW write-sequence form is live on this build — exactly the "consumer #2 appears" moment the catalog says the pattern bites. The guard must be proven to fail when violated, not merely read as correct. Injection is the evidence.

---

## Task 12 — Chronology disposition & ledger-metrics C2.4 (RED observed, THEN GREEN)

**Files touched:** `server/__tests__/ledger-metrics-parity.test.js` (update expected array for C2.4)

**Component/Layer:** Server structural guard / registry

**Step type:** TEST RED PROOF (completing the red-then-green sequence started in Task 8)

**Precondition:** Tasks 7–8 (tick is implemented, CONSUMERS is updated)

**What changes:**

From Task 8, the CONSUMERS was updated but C2.4 was not. This task completes the pairing.

1. **Update C2.4 expected array in `ledger-metrics-parity.test.js`:**
   - Find the `const expected = [...]` array in Case C2.4
   - Add `"server/lib/value-summary-tick.js"` to the array

**Done-check:**

```bash
node --test server/__tests__/ledger-metrics-parity.test.js -- --grep "C2.4"
# Must pass green (CONSUMERS includes tick, expected includes tick, parity confirmed)
```

**Rationale:** This completes Task 8's red-then-green sequence. The red observation was captured in Task 8; this task documents that both sides are now in sync.

---

## Task 13 — Client types: WSMessage union & API response shape

**Files touched:** `client/src/lib/types.ts`, `client/src/lib/api.ts`

**Component/Layer:** Client types / API contract

**Step type:** IMPLEMENTATION (types-only, no runtime behavior change)

**Precondition:** Tasks 3–4 (route adds `states` to response)

**What changes:**

1. **types.ts:**
   - Add three new payload interfaces near `PlanUpdatedPayload` (~line 2732):
     - `ValueAltitudesUpdatedPayload { project_id: string; unit_keys: string[]; pending: number }` (doc comment: broadcast by `server/lib/value-summary-tick.js`)
     - `ProjectPlanUpdatedPayload { plan: ProjectPlan | null }` (doc comment: broadcast by `server/routes/project-plans.js:173/197/222/244/252/262`)
     - `ValueClaimUpdatedPayload { claim?: ValueClaim; claim_id?: number; deleted?: boolean }` (doc comment: broadcast by `server/routes/project-plans.js:360/379`)
   - Add three strings to `WSMessage.type` union: `"value_altitudes_updated"`, `"project_plan_updated"`, `"value_claim_updated"`
   - Add three interfaces to `WSMessage.data` union: `ValueAltitudesUpdatedPayload`, `ProjectPlanUpdatedPayload`, `ValueClaimUpdatedPayload`
   - Update two doc-comment maps:
     - `type` field mapping (~line 2909)
     - Module `@file` index (~line 537)
   - Note in `ValueAltitudesUpdatedPayload` doc comment: **v1 ships no subscriber** (OPEN-3), so reader does not assume live-update behavior exists

2. **api.ts:**
   - Update `projectPlans.altitudes` response type: add `states?: Record<string, "queued" | "unavailable">`
   - Correct JSDoc: instead of "absence means unavailable," describe the two states as per DEC-11 truth table

**Done-check:**

```bash
cd client && npx tsc --noEmit
# Must compile clean (type-only changes)

npm run test:client
# No new test cases yet (implementation in task 14)
```

**Rationale:** Type-level only; no runtime behavior or subscriber. The route already emits `states`; the client types now match the wire contract. OPEN-3 is a conscious deferral of in-place updates.

---

## Task 14 — Client component: placeholder rendering for both states

**Files touched:** `client/src/components/PlanLedgerPanel.tsx`

**Component/Layer:** Client UI / rendering

**Step type:** IMPLEMENTATION (test comes in Task 15)

**Precondition:** Tasks 12–13 (types updated, route response shape settled)

**What changes:**

1. **PlanLedgerPanel.tsx:**

   - `Altitude` type definition (update):
     ```ts
     type Altitude = { project: string; stakeholder: string } | "queued" | "unavailable" | undefined;
     ```
     Doc comment: `undefined` = this mount's fetch has not returned yet; `"queued"` = server says a later pass will do it; `"unavailable"` = server attempted and failed.

   - `AltitudeText` function (update):
     ```ts
     // Route the three non-resolved states:
     if (a === undefined) return t("planLedger.pool.altitudes.generating");
     if (a === "queued") return t("planLedger.pool.altitudes.queued");
     if (typeof a === "string") return t("planLedger.pool.altitudes.unavailable"); // fallback for unknown values + "unavailable"
     // Resolved case
     return `${a.project} / ${a.stakeholder}`;
     ```

   - Altitude effect (update, ~line 542):
     ```ts
     next[u.id] = a
       ? { project: a.project, stakeholder: a.stakeholder }
       : (res.states?.[u.id] === "queued" ? "queued" : "unavailable");
     ```
     This is the state mapping: use `res.states` if present, else default to `"unavailable"` (backward compat for old servers)

   - Out-of-registry warning (new):
     In the altitude effect, after mapping `res.states`:
     ```ts
     for (const [uid, state] of Object.entries(res.states ?? {})) {
       if (state && !["queued", "unavailable"].includes(state)) {
         console.warn(`Altitude state "${state}" not in ALTITUDE_STATES registry for unit ${uid}`);
       }
     }
     ```
     Gate with `import.meta.env.DEV` if vitest config defines it; otherwise drop the gate.

   - **No `eventBus` import or `useEffect` for subscription** (DEC-8, OPEN-3)

2. **Doc comment above `Altitude` union:**
   - Name `server/lib/value-summary.js`'s `ALTITUDE_STATES` as the canonical source (cannot import across Vite/Node boundary; this is hand-maintained per §9.7)
   - Precedent: `TrunkDriftResult["skipped"]`

**Done-check:**

```bash
cd client && npx tsc --noEmit
# Must compile clean

npm run test:client
# (No new test yet; that's Task 15)
```

**Rationale:** No live-update behavior in v1. The component renders the three states placeholder-style, with `undefined` meaning "still fetching," and the other two as distinct UI. The out-of-registry check is the T-E trap coverage — catching a malformed new-server response vs. ignoring a missing states field from an old server.

---

## Task 15 — Client tests: AC-2 same-render distinction & edge cases

**Files touched:** `client/src/components/__tests__/PlanLedgerPanel.test.tsx`

**Component/Layer:** Client component testing

**Step type:** TEST (with red-first)

**Precondition:** Tasks 13–14 (types and component are ready)

**What changes:**

1. **Update existing 3 altitude tests:**
   - Line ~370 test (old-server backward-compat, `altitudes` without `states` key):
     - Mock: `{ altitudes: {...} }` **without `states` key** (deliberately old-server scenario)
     - Add: `expect(warnSpy).not.toHaveBeenCalled()` (no console.warn for missing states)
     - Add: `expect(screen.queryByText(/Queued/i)).toBeNull()` (no queued state visible)
   - Line ~411 test (missing-from-response):
     - Mock: keep as `{ altitudes: {} }`
     - Add: `expect(warnSpy).not.toHaveBeenCalled()`
   - Existing dedup test: no change needed

2. **NEW — AC-2 same-render test (T-D):**
   ```ts
   it("a 45-unit pool renders Queued and Not available distinguishably in the same render", async () => {
     const units = makeUnits(45, { /* exact IDs */ });
     const mockAltitudes = {
       altitudes: Object.fromEntries(units.slice(0, 39).map(u => [u.id, { project: "P", stakeholder: "S" }])),
       states: {
         [units[39].id]: "unavailable",
         ...Object.fromEntries(units.slice(40, 45).map(u => [u.id, "queued"]))
       }
     };
     mockAltitudesMock.mockResolvedValue(mockAltitudes);
     
     render(<PlanLedgerPanel ... />);
     await waitFor(() => expect(screen.getAllByText(/Queued/i).length).toBe(10)); // 5 units × 2 rows
     
     expect(screen.getAllByText(/Not available/i).length).toBe(2); // 1 unit × 2 rows (both same render)
     expect(screen.getByText("S (resolved unit text)")).toBeInTheDocument(); // ≥1 resolved row present
   });
   ```

3. **NEW — LLM-off case (T-B):**
   ```ts
   it("45 unavailable units (LLM off) render distinctly from queued", async () => {
     const units = makeUnits(45);
     mockAltitudesMock.mockResolvedValue({
       altitudes: {},
       states: Object.fromEntries(units.map(u => [u.id, "unavailable"]))
     });
     
     render(<PlanLedgerPanel ... />);
     await waitFor(() => expect(screen.getAllByText(/Not available/i).length).toBe(90)); // 45 units × 2 rows
     
     expect(screen.queryAllByText(/Queued/i).length).toBe(0);
   });
   ```

4. **NEW — T-E out-of-registry warning:**
   ```ts
   it("an out-of-registry states value warns and does not masquerade as an old-server absence", async () => {
     const u = unit({ id: "test-unit" });
     const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
     mockAltitudesMock.mockResolvedValue({
       altitudes: {},
       states: { [u.id]: "bogus" }
     });
     
     render(<PlanLedgerPanel ... />);
     await waitFor(() => expect(screen.getAllByText(/Not available/i).length).toBe(2)); // safe fallback
     
     expect(warnSpy).toHaveBeenCalledTimes(1);
     expect(warnSpy.mock.calls[0].join(" ")).toContain("bogus");
     expect(warnSpy.mock.calls[0].join(" ")).toContain(u.id);
     
     warnSpy.mockRestore();
   });
   ```

**Done-check:**

```bash
npm run test:client
# 11 existing + 3 new = 14 altitude/state tests

# Red-first proof: before component changes in Task 14, these cases fail:
# - AC-2 case fails on getAllByText(/Queued/i) — no queued branch exists
# - LLM-off case fails on getAllByText(/Not available/i).length — not distinguishable
# - T-E case fails on warnSpy — no warn in component yet
# (Do not proceed until these fail)

# Then implement Task 14, re-run, all pass green
```

**Rationale:** Same-render test is the load-bearing assertion for AC-2 ("observable states visibly distinct"). The T-E test is the T-E trap coverage — distinguishing malformed new-server response from missing-field old-server response. LLM-off is the T-B trap coverage.

---

## Task 16 — i18n key validation (registry→locale, already added in Task 5)

**Files touched:** None (already completed in Task 5)

**Component/Layer:** Client i18n

**Step type:** VERIFICATION (test already passing from Task 5)

**What changes:** Nothing; this was completed in Task 5 when the `queued` key was added to all 4 locales.

**Done-check:**

```bash
cd client && npx vitest run src/i18n/__tests__/i18n.test.ts -- --grep "E1.1"
# Must pass green (parity across all 4 locales confirmed)
```

**Rationale:** Structural verification that the registry-derived check (Task 5's L4) is live and all locales have the new key.

---

## Task 17 — Measure coverage latency (OPEN-4)

**Files touched:** `intake/2026-08-04-value-summary-tick/decisions.md` (fill OPEN-4 row)

**Component/Layer:** Operations / deployment

**Step type:** MEASUREMENT (manual, against real DB)

**Precondition:** All implementation tasks complete, dev server running against real DB

**What changes:**

1. Temporarily set `DASHBOARD_VALUE_SUMMARY_TICK_MS=15000` (faster cadence for validation)
2. `npm run dev` — boot against the real `~/.claude/agent-dashboard/dashboard.db`
3. Measure:
   - `P` = `SELECT COUNT(DISTINCT project_id) FROM project_paths`
   - `U` = `SELECT MAX(CAST(JSON_EXTRACT(pool_size, '$') AS INTEGER)) FROM value_summary_generation_log WHERE source = 'tick'` (or largest observed pool from a manual observation)
4. Compute worst-case latency: `ceil(P / MAX_PROJECTS_PER_TICK) × DASHBOARD_VALUE_SUMMARY_TICK_MS × ceil(U / MAX_UNITS_PER_PROMPT)`
   - At DEC-5 defaults: `ceil(P/3) × 600000ms × ceil(U/40)`
5. Fill OPEN-4 in `decisions.md`:
   ```
   Measured at build: P = __, U = __, worst case = __, shipped defaults = DASHBOARD_VALUE_SUMMARY_TICK_MS=600000, MAX_PROJECTS_PER_TICK=3
   ```
6. If worst case exceeds ~2h, retune env vars:
   - Increase `MAX_PROJECTS_PER_TICK` (costs more git work per cycle, but fewer cycles)
   - Decrease `DASHBOARD_VALUE_SUMMARY_TICK_MS` (more frequent, smaller sweeps)
   - Record what shipped

**Done-check:**

- [ ] P, U, and worst-case formula filled into OPEN-4
- [ ] Shipped defaults recorded
- [ ] If adjusted, env-var change recorded (no code change)

**Rationale:** DEC-5 and OPEN-4 require the formula to be validated against real data before sign-off. This is the only place a tuning call happens — all other decisions are locked down.

---

## Task 18 — Manual browser validation (AC-1 full cycle, AC-2 distinguishability)

**Files touched:** None (manual validation)

**Component/Layer:** End-to-end / user-facing

**Step type:** MANUAL VERIFICATION

**Precondition:** All tasks complete, dev server running, `DASHBOARD_VALUE_SUMMARY_TICK_MS=15000` (from Task 17)

**What changes:** None; this is exploratory validation.

**Procedure:**

1. Open browser to `http://localhost:5173` (Vite dev server)
2. Navigate to Project Detail for AC-1 validation project (recommended: Coaching Assistant, 182 units per OPEN-2)
3. **First paint (AC-1 observable):**
   - Confirm 40 units resolved inline
   - Remaining 142 units showing **Queued** (not a blank placeholder)
   - No user action needed to drive generation

4. **Watch 2–3 tick cycles (AC-1 scalability):**
   - Re-enter panel (navigate away and back, or reload — OPEN-3: in-place update not in v1)
   - After each tick, coverage grows by up to 40 more units
   - No manual reload required

5. **LLM-off validation (AC-2 distinguishability, T-B):**
   - `DASHBOARD_FOCUS_INFER_MODE=off` (from terminal or env)
   - Reload Project Detail panel
   - All uncached units render **Not available** (visibly distinct from Queued, not a blank)

6. **Fast-path regression check (AC-1 small pools):**
   - Navigate to a small project (<40 units total)
   - Confirm all units resolve within one visit (no Queued state visible)
   - Route fast path did not regress

7. **Audit log (AC-2 observable, manual proof of "observable"):**
   - Inspect `value_summary_generation_log` directly:
     ```bash
     sqlite3 ~/.claude/agent-dashboard/dashboard.db "SELECT project_id, source, pool_size, cache_hits, generated, queued, unavailable FROM value_summary_generation_log ORDER BY created_at DESC LIMIT 20;"
     ```
   - Confirm real per-sweep generation counts (not placeholder rows)
   - This is the v1 observability surface (Settings UI is the fast-follow)

8. **Revert env overrides:**
   - Remove `DASHBOARD_VALUE_SUMMARY_TICK_MS=15000` override
   - `DASHBOARD_FOCUS_INFER_MODE=off` if set
   - `npm run dev` with defaults
   - Confirm shipped defaults are what Task 17 recorded

**Done-check:**

- [ ] AC-1: 40 units resolved, remainder **Queued**, zero manual reloads
- [ ] AC-1: 2–3 cycles, coverage grows to 80–120+ units cumulatively
- [ ] AC-2: **Queued** and **Not available** visibly distinct in same render
- [ ] AC-2: LLM-off: all uncached render **Not available**, none **Queued**
- [ ] Fast path: small project resolves in one visit
- [ ] Audit log: real generation metrics present (not empty rows)
- [ ] Env overrides reverted before completion

**Rationale:** AC-1 and AC-2 acceptance criteria are user-facing; manual browser validation is the last gate before sign-off. The audit log is the evidence-gathering for OPEN-4's real fleet measurement.

---

## Task 19 — Update project documentation

**Files touched:** `ARCHITECTURE.md`, and whatever `update-project-docs` skill resolves (typically `README.md`, `SETUP.md`)

**Component/Layer:** Project documentation

**Step type:** IMPLEMENTATION (automatic via skill, not on request)

**Precondition:** All implementation tasks complete

**What changes:**

Apply the `update-project-docs` skill automatically (per `CLAUDE.md`'s "apply the `update-project-docs` skill automatically at the end of every change-set"):

1. **ARCHITECTURE.md:**
   - Background-services section: add the new tick to the list of services (after reconciliation, before any concluding text)
   - Subsection on tick: list `DEFAULT_TICK_MS`, `BOOT_DELAY_MS`, `DEFAULT_MAX_PROJECTS_PER_TICK`, env-var gates
   - Database-tables section: document the two new tables (`value_summary_sweep_state`, `value_summary_generation_log`) with purpose and schema
   - Environment variables: document `DASHBOARD_VALUE_SUMMARY_TICK_MS`, `DASHBOARD_VALUE_SUMMARY_TICK_MODE`, `MAX_PROJECTS_PER_TICK` alongside existing `DASHBOARD_RECONCILE_MS`
   - Routes section: update `POST /api/project-plans/altitudes` to document the `states` field (queued vs unavailable)

2. **Other docs as identified by the skill:**
   - `README.md`, `SETUP.md`, etc. — keep commands and paths runnable per `.claude/rules/docs-markdown.md`

**Done-check:**

```bash
# Verify docs are consistent with code:
grep -n "value_summary_tick" ARCHITECTURE.md
# Should mention the tick, the tables, the env vars

grep -n "states" ARCHITECTURE.md
# Should document the response shape change
```

**Rationale:** Documentation must stay current with implementation changes (CLAUDE.md rule). Any change to behavior, schema, env vars, or routes requires docs to update at the same time.

---

## Task 20 — Final verification suite

**Files touched:** None (test only)

**Component/Layer:** Cross-cutting

**Step type:** VERIFICATION

**Precondition:** All tasks complete

**What changes:** None; this is the final green gate.

**Commands (in order):**

```bash
# Full server test suite
npm run test:server
# Baseline: 1583+ passing (measured 2026-08-04), 0 fail, 0 skipped
# Must show new tests for tick, composer cases, guards all passing

# Full client test suite
npm run test:client
# Must include i18n E1.1 and PlanLedgerPanel (14 altitude tests)

# Type checking (client only; no MCP changes)
cd client && npx tsc --noEmit
# Must be clean

# File headers check
bash .claude/skills/file-headers/scripts/check-headers.sh
# Must exit 0; checks value-summary-tick.js and value-summary-tick.test.js both have header + @author line

# Vacuous-guard sweep (§9.3 check)
grep -rn "assert.ok(true" server/__tests__/
grep -rn "|| true" server/__tests__/
# Both must return nothing (or only pre-existing, non-new files)

# Schema-class final check (§9.5/§9.6)
git diff master -- server/db.js | grep -i "ALTER TABLE"
# Must return nothing — changes remain additive, inapplicable to §9.5/§9.6

# Snapshots (only after reading diff and confirming intentional)
cd client && npx vitest run -u
# Only after visually reviewing any `screens.snapshot.test.tsx` changes
```

**Additional checks:**

- **MCP typecheck:** `npm run mcp:typecheck` / `npm run mcp:build` **explicitly not required** (no `mcp/` surface changed) — state this in build report
- **OpenAPI contract:** `openapi-contract.test.js` D2.4 requires `server/openapi.js` to document the route; since v1 does not update `openapi.js`, no regenerate is needed — **state whether `openapi.js` was touched** in build report

**Done-check:**

- [ ] `npm run test:server` passes (1583+ cases, all green)
- [ ] `npm run test:client` passes (including 14 altitude tests)
- [ ] `cd client && npx tsc --noEmit` clean
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0
- [ ] Vacuous-guard greps return nothing for new files
- [ ] Schema check: no ALTER TABLE in diff
- [ ] Snapshot review (if any changes) — intentional, approved, or reverted
- [ ] Build report explicitly states:
  - `npm run mcp:typecheck` not run (reason: no MPC surface changed)
  - `openapi.js` status (touched or not)
  - All red mutations captured and restored
  - OPEN-3 re-read and accepted

**Rationale:** Final gate before merge. The suite is the proof that all invariants held, all guards are live, and no regressions shipped.

---

## Task 21 — Review DEC-13 and commit

**Files touched:** `effort/2026-08-04-value-summary-tick` branch (commit history)

**Component/Layer:** SCM / build closure

**Step type:** VERIFICATION (diff review as §9.4 acceptance criterion)

**Precondition:** All tasks complete, all tests passing

**What changes:** None (review only).

**Procedure:**

1. Inspect full diff:
   ```bash
   git diff master -- server/ client/ intake/
   # (Use `git diff master -- <path>` to isolate subsystems)
   ```

2. Per §9.4 FIX-ROUND-REGRESSION, review the diff end-to-end as an adversarial pass:
   - Every new test is load-bearing (not a placeholder)
   - Every guard is proven red (mutations were captured)
   - Every returned structure (altitudes, states) has a matching consumer
   - No silent behavioral changes

3. Verify DEC-13's preconditions were met:
   - Both options (commit on master, then branch vs. move to own branch first) satisfy the actual requirement (valid diff base, unentangled diff)
   - No reset/cherry-pick dance was needed (starting from b155f83 avoids concurrent-session-risk)

4. Commit to `effort/2026-08-04-value-summary-tick`:
   ```bash
   git add -A
   git commit -m "$(cat <<'EOF'
   feat(server,client): value-summary tick + states discrimination

   Add bounded background tick sweeping projects in least-recently-swept
   rotation. Replace overloaded absence with discriminated queued/unavailable
   states on the wire and in the client. Audit log records sweep metrics.

   - server/lib/value-summary-tick.js: background service, registered in
     startBackgroundServices(), disabled via DASHBOARD_VALUE_SUMMARY_TICK_MODE=off
   - server/lib/value-summary.js: enrichPoolAltitudes returns { altitudes, states }
     with one lexical upsertValueUnitSummary call site (guard proven red-first)
   - server/db.js: two new tables (value_summary_sweep_state,
     value_summary_generation_log), three new prepared statements (additive schema,
     no ALTER, no rebuild — §9.5/§9.6 remain inapplicable)
   - server/routes/project-plans.js: forwards states on POST /altitudes (unchanged
     request behavior, additive response shape)
   - client/src/lib/types.ts: WSMessage union gains three broadcast types (no
     subscribers in v1 — OPEN-3)
   - client/src/components/PlanLedgerPanel.tsx: renders queued/unavailable states
     distinguishably; fallback for old servers
   - Locales: planLedger.pool.altitudes.queued in all four (en registry-derived check)
   - Tests: value-summary.test.js (truth table, concurrency T-A), value-summary-tick.test.js (new, 9 cases with mutation proofs), single-writer-guard.test.js (two new invariants proven red-first), PlanLedgerPanel.test.tsx (AC-2 same-render test, LLM-off case, out-of-registry warning).

   Addresses:
   - AC-1: 182-unit pool now reaches full coverage over time via background sweep
   - AC-2: queued and unavailable states visibly distinct; audit log observable
   - AC-3: single-writer invariant on value_unit_summaries (guard proven red-first)
   - §9.1 DERIVED-DUAL-VIEW (write-sequence): one composer (enrichPoolAltitudes),
     two invokers (route, tick), proven by guard + injection red-proof
   - §9.8 OVERLOADED-ABSENCE: replaced with discriminated states (queued vs
     unavailable)
   - §9.3 VACUOUS-GUARD: every new guard observed red via mutation before landing

   DEC-13: Altitude layer committed on master at b155f83; this build branches from
   it. All red-first proofs captured in build report.

   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   EOF
   )"
   ```

**Done-check:**

- [ ] Diff reviewed end-to-end; no silent behavioral changes identified
- [ ] DEC-13 preconditions verified (base ref b155f83, diff is unentangled)
- [ ] All red mutations captured and restored (documented in build report)
- [ ] Commit message cites all three acceptance criteria and defect-catalog ids
- [ ] Build is ready for merge to `master`

**Rationale:** §9.4 acceptance criterion: a build round gets an adversarial review over the diff, not just a re-run of the suite. This is the §9.4 fix-round review discipline applied to the build itself.

---

## MANDATORY Defect-Catalog Obligations (Project-Context.md)

All of the following are **non-negotiable** and must end this build in a proven state:

1. **§9.1 DERIVED-DUAL-VIEW (write-sequence form)** — DEC-10, DEC-6
   - **Invariant:** Exactly one lexical `upsertValueUnitSummary.run(` call site, inside `enrichPoolAltitudes`
   - **Guard:** `single-writer-guard.test.js` :: "upsertValueUnitSummary.run( has exactly one lexical call site"
   - **Red-proof:** Injected rogue call site in `POST /altitudes`, observed test fail, restored green
   - **Invariant:** Exactly one production call site for `insertValueSummaryGeneration`, in the tick
   - **Guard:** `single-writer-guard.test.js` :: "insertValueSummaryGeneration has exactly one production call site"
   - **Red-proof:** Injected rogue call site in route, observed test fail, restored green
   - **Status:** ✓ Tasks 11–12 (guards proven red-first, injection mutations captured)

2. **§9.8 OVERLOADED-ABSENCE (discrimination, direct cure for this build)** — DEC-11, DEC-10
   - **Invariant:** Every unit in exactly one of: `altitudes` (resolved), `queued` (over-cap miss), `unavailable` (in-cap miss or LLM off)
   - **Guard:** `value-summary.test.js` :: Truth-table cases 1–5 (mutual exclusivity + partition)
   - **Guard:** Route case A (41 resolved + 4 unavailable/queued = 45)
   - **Guard:** Client case AC-2 (10 Queued + 2 Not available, same render, no overlap)
   - **Red-proof:** Cases fail before composer split (Tasks 3, 4, 15)
   - **Status:** ✓ Tasks 3–4, 15 (all red-first proofs captured)

3. **§9.3 VACUOUS-GUARD (structural guards, standing rule)** — Every guard must be proven red
   - **Chronology disposition:** FILE_DISPOSITIONS check on new file (Task 2: observed red before entry)
   - **C2.4 CONSUMERS check:** Parity between registry and test expectation (Task 8: observed red when only CONSUMERS updated)
   - **Single-writer guards (Tasks 11–12):** Both `upsertValueUnitSummary` and `insertValueSummaryGeneration` (observed red via injection)
   - **Overlap guard:** Tick's `running` flag (Task 10 Case 1: observed red when guard removed)
   - **Rotation order guard:** ORDER BY timestamp, not id (Task 10 Case 3: observed red with ORDER BY id)
   - **Failure isolation guard:** upsertValueSweepState in finally (Task 10 Case 6: observed red when moved out)
   - **DEC-16 structural scan:** No hand-rolled pool SQL in tick (Task 10 Case 8: observed red with dead FROM project_paths)
   - **T-C instrument:** pending_after_sweep re-derived, not decremented (Task 10 Case 9: observed red with decrement counter)
   - **Registry→locale check:** ALTITUDE_STATES → en locale keys → all 4 locales (Task 5: observed red on missing queued key)
   - **i18n parity (E1.1):** Whole-namespace match across ko/vi/zh (Task 5: observed red on deleted ko key)
   - **Status:** ✓ All mutation proofs captured in Tasks 2, 5, 8–12, 15; build report must include red outputs

---

## Build Report Checklist (for sign-off)

The implementer creates a build report documenting:

### Completion
- [ ] All 21 tasks completed in order
- [ ] `npm run test:server` green (1583+ cases)
- [ ] `npm run test:client` green (including 14 altitude tests)
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0
- [ ] Vacuous-guard greps return nothing for new files
- [ ] Schema check: `git diff master -- server/db.js | grep -i "ALTER TABLE"` returns nothing

### Red-First Proofs (must be captured, not claimed)
- [ ] **Chronology:** FILE_DISPOSITIONS failure → disposition added → green (output pasted)
- [ ] **C2.4:** CONSUMERS updated, expected array not yet → test red → array updated → green (outputs pasted)
- [ ] **Composer truth table:** 6 destructure failures, 6 truth-table case failures before split (outputs pasted)
- [ ] **Overlap guard:** Tick running flag removed → 2 spawns observed → restored → 1 spawn → green
- [ ] **Rotation order:** ORDER BY id ASC → wrong array order observed → ORDER BY timestamp → correct order → green
- [ ] **Failure isolation:** upsertValueSweepState moved out of finally → starvation observed → restored to finally → green
- [ ] **DEC-16 scan:** Dead FROM project_paths added → test red → removed → green
- [ ] **T-C instrument:** Decrement counter → reads 5 instead of 8 → restored re-derivation → green
- [ ] **Single-writer upsertValueUnitSummary:** Rogue call in route → totalCalls error → removed → green
- [ ] **Single-writer insertValueSummaryGeneration:** Rogue call in route → totalCalls error → removed → green
- [ ] **Registry→locale:** queued key missing from en → test red → key added all 4 locales → green
- [ ] **i18n E1.1:** queued key deleted from ko → parity test red → restored → green

### Decisions & Measurement
- [ ] DEC-13 base ref confirmed: `git rev-parse b155f830c79698349952d2c88ea9f60bedaaf66d`
- [ ] OPEN-4 filled: P = __, U = __, worst case = __, shipped defaults recorded
- [ ] OPEN-3 re-read and accepted (no client subscriber in v1)
- [ ] Manual browser pass (AC-1, AC-2, LLM-off, fast path, audit log) — 2–3 cycles observed

### Drift & Regressions
- [ ] `git diff master -- <all-files>` read end-to-end (§9.4 fix-round review)
- [ ] No silent behavioral changes
- [ ] No removal of safety controls
- [ ] No schema migrations (remains additive)
- [ ] No duplicate scope-derivation helpers (reused `assertSingleHome`, shared `scanFiles`)

### External Dependencies
- [ ] `npm run mcp:typecheck` **explicitly stated as not run** (reason: no MCP surface changed)
- [ ] `npm run mcp:build` **explicitly stated as not run** (reason: no MCP surface changed)
- [ ] `openapi.js` status stated (touched or not)
- [ ] Docker stack: **not provisioned** (tests run against throwaway SQLite, no external services)

---

**Build ready for orchestrator handoff at Task 1 start.**

**All MANDATORY defect-catalog gates enforced: §9.1, §9.8, §9.3.**

**No task may be parallelized; implementer follows this sequence strictly.**
