# Build Task List — Value Pool Slice 2: coverage-on-demand

**Effort:** `2026-08-05-coverage-on-demand` (Slice 2)
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor`
**Branch:** `effort/2026-08-05-coverage-on-demand` @ `b38b4a1`
**Build mode:** FAST — smoke-level verification only (no full `team-qa` stage)
**Guardrail floor:** technical-plan §6 (G1a–G6) inlined as non-negotiable build-time obligations

---

## Pre-Build Verification (must complete before first line of Slice 2 code)

### Task 0: Verify [S1-dep] Shapes Against Slice 1's Actual Landed Code

**Scope:** Before any implementation code is written, re-read intake `decisions.md` DEC-1..DEC-11, WATCH-S2-A..F, OPEN-S2-1 and verify every `[S1-dep]` shape citation against Slice 1's actual landed code at `b38b4a1`, not against the technical-plan's projected shapes.

**Files touched:** none (verification only)

**What changes:** Decision-log accuracy; if any shape has drifted, correct the reference before proceeding.

**Layer:** Planning / verification

**Step type:** MANDATORY PRE-CONDITION

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
git log -1 --oneline | grep -q "b38b4a1" && \
grep -A 20 "function enrichPoolAltitudes" server/lib/value-summary.js | grep -q "counts" && \
grep "ALTITUDE_FRESHNESS" server/lib/value-summary.js | grep -q "stale_refresh_queued"
```
**Verify:**
- `enrichPoolAltitudes` returns `{ altitudes, states, counts }` shape with DEC-14's `counts` key ✓
- `ALTITUDE_FRESHNESS` is exported and includes at least `stale_refresh_queued`, `stale_refresh_unavailable`, `updated_unseen` ✓
- No `input_digest` on `value_unit_summaries` (Slice 1 only creates the column name in schema, does not populate it in this slice) ✓
- Commit message confirms Slice 1 landed ✓
- Intake `decisions.md` DEC-1..DEC-11 / WATCH-S2-A..F / OPEN-S2-1 all present and re-read against the above

---

## Core Implementation Tasks (dependency-ordered)

### Task 1: Schema Migration — `value_summary_sweep_state.coverage_requested_at`

**Files touched:**
- `server/db.js:1823–1843` (CREATE TABLE body + schema comment)
- `server/db.js:1023` (copy PRAGMA precedent from `detourDispositionsColumns`)
- `server/__tests__/db-migration.test.js:UPGRADE_CASES` (new entry)

**What changes:**
1. Add nullable `coverage_requested_at TEXT` column to `value_summary_sweep_state` via **guarded ALTER using PRAGMA `table_info` idiom** (§9.5 MANDATORY — do NOT use deprecated try/`SELECT…LIMIT 1`/catch probe; copy the pattern at `db.js:1023` / `:1466` / `:1484` / `:1503`).
2. Update the schema comment block (~`db.js:1823–1835`) to name the new column and document its NULL-means-passive semantics.
3. Add one `UPGRADE_CASES` entry: legacy-shaped table (no column), seed a legacy row, verify column exists post-migration, legacy row reads NULL, column is writable, second run is a no-op.

**Layer:** Schema / Database

**Step type:** IMPLEMENTATION (required before statements)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
node --test server/__tests__/db-migration.test.js 2>&1 | grep -E "UPGRADE_CASES|migrat" && \
grep "coverage_requested_at" server/db.js && \
grep -A 5 "PRAGMA table_info" server/db.js | grep -q "coverage_requested_at"
```
Confirm:
- `db-migration.test.js` runs green
- Migration logic uses PRAGMA `table_info`, not deprecated try/catch probe
- New legacy-shape entry exists in `UPGRADE_CASES` and exercises the four-step check (exists, NULL on legacy, writable, idempotent)
- No new `GRANDFATHERED` entries introduced

---

### Task 2: Statements & Queries — Schema selects + new DML + chronology-sensitive read

**Files touched:**
- `server/db.js:3264–3271` (`listValueSweepTargets` — widen ORDER BY + TTL param)
- `server/db.js` (new: `requestValueCoverage`, `clearValueCoverageRequest`, `listRecentValueGenerationDurations`)

**What changes:**
1. **`listValueSweepTargets` re-order:** Widen ORDER BY to prioritize requested projects over passive (engineer's live-probed form from build brief):
   ```sql
   ORDER BY (s.coverage_requested_at IS NULL) ASC, s.coverage_requested_at ASC,
   (s.last_swept_at IS NOT NULL) ASC, s.last_swept_at ASC, p.id ASC LIMIT ?
   ```
   Add a TTL cutoff parameter so requests older than cutoff sort as passive (DEC-8).
   Passive ordering for unflagged projects must stay byte-identical.

2. **`requestValueCoverage`** (new): `INSERT … ON CONFLICT(project_id) DO UPDATE SET coverage_requested_at = excluded.coverage_requested_at`

3. **`clearValueCoverageRequest`** (new): `UPDATE … SET coverage_requested_at = NULL WHERE project_id = ?`

4. **`listRecentValueGenerationDurations`** (new, ETA's sole input — §9.2 MANDATORY): 
   ```sql
   SELECT duration_ms, generated FROM value_summary_generation_log 
   WHERE outcome='ok' AND generated > 0 AND duration_ms IS NOT NULL 
   ORDER BY created_at DESC, id DESC LIMIT ?
   ```
   Plus per-project variant (index at ~`db.js:1861–1862` already serves it).
   **Sort before LIMIT, id as tiebreak** — §9.2 chronology-ordering rule, enforced by existing scan.

5. No change to `upsertValueSweepState` / `upsertValueSweepStateKeepPending`: flag survives a sweep upsert (proven live by engineer's probe A).

6. No CHECK constraint changes (value_summary_generation_log.source stays `CHECK(source IN ('tick','request'))` — see WATCH-S2-A).

**Layer:** Database

**Step type:** IMPLEMENTATION (required before tick/routes)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
node --test server/__tests__/chronology-ordering.test.js 2>&1 | grep "pass\|fail" && \
grep -A 3 "listRecentValueGenerationDurations" server/db.js | grep -q "ORDER BY created_at DESC, id DESC"
```
Confirm:
- `chronology-ordering.test.js` green (red-proof by flipping ORDER BY to `ORDER BY id` and observing test fail, then restore byte-identical)
- `listRecentValueGenerationDurations` sorts `created_at DESC, id DESC` **before** LIMIT
- `listValueSweepTargets` ORDER BY widened to three terms (coverage flag, then last_swept, then id)
- TTL cutoff parameter added to `listValueSweepTargets`
- All four new statements exist with correct signatures

---

### Task 3: Single-Home Module — `server/lib/value-coverage.js` (MANDATORY DEC-5, §9.1)

**Files touched:**
- `server/lib/value-coverage.js` (new file, born inside test scope)
- `server/__tests__/value-coverage.test.js` (new spec file)
- `server/__tests__/chronology-ordering.test.js:FILE_DISPOSITIONS` (add `"scanned"` entry for new file)

**What changes:**
Exports exactly two functions:
1. **`coverageSnapshot(dbModule, { projectId, counts, requestedAt, draining, computedAt })`** → one object both HTTP and WS carry:
   ```javascript
   {
     project_id,
     described,         // = counts.pool_size - counts.queued - counts.unavailable
     pool_size,         // = counts.pool_size
     pending,           // = counts.queued + counts.unavailable
     complete,          // = pending === 0
     demand,            // ∈ {"passive","requested","draining"} — closed registry
     requested_at,      // the timestamp
     eta,               // { state, ms_remaining, per_batch_ms, batches_remaining } | { state: "estimating" } | { state: "none" }
     computed_at
   }
   ```
   **The arithmetic exists nowhere else.** This is the one home (§9.1 MANDATORY).

2. **`estimateEta(dbModule, { projectId, pending })`** → 
   `{ state: "measured", ms_remaining, per_batch_ms, batches_remaining }` | `{ state: "estimating" }` (cold start) | `{ state: "none" }` (complete).
   Reads only `listRecentValueGenerationDurations` (K=5, per-project then fleet-wide fallback).
   **No pool SQL, no membership SQL in this module** (DEC-16 MANDATORY).

3. New file has a `FILE_DISPOSITIONS` entry in `chronology-ordering.test.js` with `"scanned"` value, or suite fails by design (§9.7).

**Layer:** Server library / computation

**Step type:** IMPLEMENTATION (must exist before any consumer — §9.1 ordering rule)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
node --test server/__tests__/value-coverage.test.js 2>&1 | grep -E "pass|fail" && \
grep -q "value-coverage" server/__tests__/chronology-ordering.test.js && \
grep "const described = " server/lib/value-coverage.js && \
grep "function estimateEta" server/lib/value-coverage.js
```
Confirm:
- Unit tests for `coverageSnapshot` arithmetic (described, pending, complete) **all passing** (G1a / G1b)
- Three `eta.state` branches all tested: `"measured"`, `"estimating"`, `"none"` (G1a)
- Cold-start case (zero qualifying log rows) renders `eta.state === "estimating"`, no fabricated number (G1a MANDATORY)
- All three `demand` states are testable from function output (G1b)
- No pool-membership SQL anywhere in this module
- `FILE_DISPOSITIONS` entry added with `"scanned"` value (§9.7)
- Tests written first, red-proven against mutations (G1a/G1b red-proof)

---

### Task 4: Composer Probe Mode + Model Tiering — `server/lib/value-summary.js`

**Files touched:**
- `server/lib/value-summary.js` (add probe mode to `enrichPoolAltitudes`, add `summaryModel(stage)`)
- `server/__tests__/value-summary.test.js` (extend per-stage env precedence test)
- `server/__tests__/single-writer-guard.test.js:assertSingleHome` (update `CONSUMERS` dispositions for new exports)

**What changes:**
1. **`enrichPoolAltitudes(dbModule, units, { probe: true })`** — one early exit before the spawn: classify only, route every miss to `queued`, reuse existing cap/gate machinery, return the same `counts` shape. **Writes no generation-log row** (DEC-9 MANDATORY).

2. **`summaryModel(stage = "unit")`** + exported `SUMMARY_STAGES = ["unit","grouping"]` (DEC-7 / O2 MANDATORY):
   - One fallback chain (not two separate functions): `DASHBOARD_VALUE_SUMMARY_<STAGE>_MODEL → DASHBOARD_VALUE_SUMMARY_MODEL → DASHBOARD_FOCUS_SUMMARY_MODEL → DASHBOARD_FOCUS_INFER_MODEL → "haiku"`
   - Prepend per-stage env var to the **single** existing chain at `value-summary.js:63–70`
   - Call site at ~`:216` becomes `summaryModel("unit")`
   - JSDoc must state that `"grouping"` has no consumer until Slice 3
   - **One function, one fallback tail** — §9.1 MANDATORY (not a sibling `groupingModel()`)

3. Every new export triggers `assertSingleHome`'s disposition map in `single-writer-guard.test.js:267–289` — update dispositions in the same commit.

**Layer:** Server library / composition

**Step type:** IMPLEMENTATION (prepare before tick uses it)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
node --test server/__tests__/value-summary.test.js 2>&1 | grep -E "probe|model" && \
node --test server/__tests__/single-writer-guard.test.js 2>&1 | grep "pass\|fail"
```
Confirm:
- Probe mode leaves generation-log row count unchanged (DEC-9 MANDATORY — run suite, compare row counts before/after a probe call)
- Per-stage env precedence test passes (extends `:251–252` rather than replacing)
- One `summaryModel()` function exported with `SUMMARY_STAGES` registry
- No second `groupingModel()` function exists (grep for it returns nothing)
- `assertSingleHome` green with updated dispositions

---

### Task 5: Tick Drain Loop — `server/lib/value-summary-tick.js` (MANDATORY DEC-4, WATCH-7)

**Files touched:**
- `server/lib/value-summary-tick.js:49,81` (module-scope `running` guard reused)
- `server/lib/value-summary-tick.js` (new: `runCoverageDrain(dbModule, projectId, opts)`)
- `server/__tests__/value-summary-tick.test.js` (new drain-specific cases: exit conditions, TTL, re-derive, broadcast)

**What changes:**
1. **`runCoverageDrain(dbModule, projectId, opts)`** inside this module, sharing the module-scope `running` guard (~`:49,81`). Overlapping callers get `{skipped:"overlap"}` (DEC-4 / WATCH-7 MANDATORY).

2. **Per iteration:**
   - `assembleValuePool` → `enrichPoolAltitudes(dbModule, units)` with the **full unit list** (engineer G3 — passing only remaining misses breaks the unconditional four-term partition `cache_hits + generated + queued + unavailable === pool_size` on every iteration ≥2) → `upsertValueSweepState` with **re-derived** `pending = queued + unavailable` (WATCH-8 / QA-DEC-2 lineage, MANDATORY) → one `insertValueSummaryGeneration` row, `source='tick'` → build a `coverageSnapshot` → broadcast per DEC-6.

3. **Loop condition:** `pending > 0` re-derived from *that iteration's own* full-pool counts. Never a local decremented counter (WATCH-8 MANDATORY — G1c red-proof: pool grows mid-drain, observe drain extends, revert, confirm behavior restored).

4. **Exit conditions, all named (G1c test):**
   - (a) `queued === 0 && unavailable === 0` → clear the flag **in the same write** as the final sweep-state upsert, broadcast the terminal snapshot
   - (b) `outcome=error` → stop, **keep the flag**, resume next tick
   - (c) no-progress (`generated === 0` while `pending > 0`) → stop, keep the flag
   - (d) hard iteration cap `MAX_DRAIN_BATCHES_PER_RUN = 25`, whose declaring comment **must cite the measured 182-unit pool** it was sized against (§9.8 MANDATORY bounds rule)

5. **TTL sweep (DEC-8):** a `coverage_requested_at` older than `COVERAGE_REQUEST_TTL_MS = 24h` is cleared with one loud log line before selection; cutoff computed in JS and passed as an ISO parameter.

6. **The drain must not read `MAX_PROJECTS_PER_TICK`** (DEC-3.3 MANDATORY). Grep for it in the drain path before declaring done.

7. **Broadcast widening** at ~`:170–176`: `{ project_id, unit_keys, pending, coverage }`, condition `generated > 0 || (demand or complete changed since last broadcast for this project)` (DEC-6).

**Layer:** Server library / orchestration

**Step type:** IMPLEMENTATION (requires Task 3 single-home, requires Task 4 model tiering)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
node --test server/__tests__/value-summary-tick.test.js 2>&1 | grep -E "drain|overlap|TTL|exit" && \
grep -c "MAX_PROJECTS_PER_TICK" server/lib/value-summary-tick.js && \
grep "MAX_DRAIN_BATCHES_PER_RUN = 25" server/lib/value-summary-tick.js
```
Confirm:
- Exit-condition matrix tested: 100% reached / error / no-progress / pool grows mid-drain / iteration cap / TTL expiry (G1c)
- Flag persistence across plain sweep upsert proven (engineer probe A / upsertValueSweepStateKeepPending side)
- Flag cleared only at true 100% (final iteration)
- Per-iteration log rows each satisfy four-term partition (G1c MANDATORY)
- Overlap guard returns `{skipped:"overlap"}` when drain already running (DEC-4 / WATCH-7 MANDATORY)
- Drain path returns 0 from grep of `MAX_PROJECTS_PER_TICK` (DEC-3.3 MANDATORY)
- `MAX_DRAIN_BATCHES_PER_RUN = 25` comment cites measured 182-unit pool (§9.8 MANDATORY bounds rule)
- `server/index.js` diff is empty (engineer's correction)

---

### Task 6: HTTP Routes — `server/routes/project-plans.js`

**Files touched:**
- `server/routes/project-plans.js:12–14` (update segment list header comment)
- `server/routes/project-plans.js` (new: `POST /api/project-plans/coverage-request`, `GET /api/project-plans/coverage`)

**What changes:**
1. **`POST /api/project-plans/coverage-request`** `{project_id}` → `requestValueCoverage` → fire-and-forget `runValueSummaryTickOnce(dbModule, { broadcast }).catch(() => {})` (safe: overlap guard turns double-run into `{skipped:"overlap"}`) → respond `202` with a probe-built snapshot (`demand: "requested"` or `"draining"`).

2. **`GET /api/project-plans/coverage?project_id=`** → `assembleValuePool` (sole composer, DEC-16 MANDATORY — denominator M comes from here and nowhere else) → `enrichPoolAltitudes(..., {probe:true})` → `coverageSnapshot` → JSON. **Byte-same shape as the WS payload's `coverage` key** (G2 parity test MANDATORY).

3. **`POST /altitudes` is deliberately NOT a coverage producer** — its `counts` cover the *submitted* batch, which is partial on every delta fetch; a coverage object derived from it would lie with full-pool authority.

4. **Writer guards:** Slice 2 adds no new caller of `upsertValueUnitSummary` / `insertValueSummaryGeneration` outside already-guarded files (build on Slice 1 DEC-4's already-widened state per build-brief). Give the new `requestValueCoverage` statement its own single-call-site guard.

**Layer:** Server API

**Step type:** IMPLEMENTATION (requires Task 1 schema, Task 2 statements, Task 3 single-home, Task 5 drain)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
node --test server/__tests__/routes/project-plans.test.js 2>&1 | grep -E "coverage-request|coverage\?" && \
grep "POST /api/project-plans/coverage-request" server/routes/project-plans.js && \
grep "GET /api/project-plans/coverage" server/routes/project-plans.js
```
Confirm:
- GET returns the snapshot; POST returns 202 and is idempotent under a running drain
- `POST /altitudes` response shape unchanged
- Route response `coverage` object is byte-identical to its single-home source (checked in Task 7)
- `requestValueCoverage` has one call site guard (single-writer-guard.test.js)

---

### Task 7: Named Deliverable — Cross-Consumer Parity Test (MANDATORY G2, §9.1)

**Files touched:**
- `server/__tests__/value-coverage-parity.test.js` (new named file — §9.1 structural requirement)

**What changes:**
A named file/case proving that the HTTP route and the WS broadcast carry the identical `coverage` object from the single home, for one seeded DB state. No client-side arithmetic anywhere in this test (G2).

This test is **the single most load-bearing test in this slice** (technical-plan §5 / §6 G2). It guards against a rogue re-derivation of coverage/ETA arithmetic — not just a rogue read. The test must:
1. Seed a known DB state
2. Call the route's internal `coverageSnapshot` builder
3. Call the tick's internal broadcast-building logic
4. Assert deep equality of the `coverage` object from both paths
5. **Prove this test fails when arithmetic is re-implemented anywhere** (§9.3 red-proof: duplicate the arithmetic inline in one path and observe test fail, then restore)

**Layer:** Server tests / verification

**Step type:** TEST (must exist before client step)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
node --test server/__tests__/value-coverage-parity.test.js 2>&1 | grep -E "pass|fail" && \
ls -la server/__tests__/value-coverage-parity.test.js
```
Confirm:
- Test file exists with that exact filename (not `coverage-tests.js` or similar)
- Test seeded DB state and routes through both HTTP and WS paths
- Deep-equals assertion present and specific
- Red-proof recorded: introduce a rogue re-derivation (e.g. `const described = counts.pool_size - counts.queued;` inline in tick), observe test fail, restore byte-identical and re-run green

---

### Task 8: Broadcast Widening — `server/lib/value-summary-tick.js` finalization

**Files touched:**
- `server/lib/value-summary-tick.js:170–176` (payload composition)
- `server/__tests__/value-summary-tick.test.js` (test transition-only broadcast)

**What changes:**
The broadcast condition widens per DEC-6: `generated > 0 **OR** (demand/complete changed since last broadcast for this project)`.

A terminal iteration with `generated === 0` but `complete === true` (i.e., pending transitioned to zero) still emits, carrying the final snapshot (G1c test).

**Layer:** Server library / orchestration

**Step type:** IMPLEMENTATION (finalization of Task 5)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
grep -A 8 "value_altitudes_updated" server/lib/value-summary-tick.js | grep -q "coverage" && \
node --test server/__tests__/value-summary-tick.test.js 2>&1 | grep "transition"
```
Confirm:
- Payload includes `coverage` field
- Broadcast condition includes demand/complete transition check (test transition-only case: `generated === 0` but `demand` changed → broadcast emits)
- Red-proof: narrow condition back to `generated > 0` and observe transition test fail, then restore

---

### Task 9: Client Wire Types + API Client — `client/src/lib/types.ts` + `client/src/lib/api.ts`

**Files touched:**
- `client/src/lib/types.ts` (widen `ValueAltitudesUpdatedPayload` with optional `coverage`, `demand` union, discriminated `eta` union)
- `client/src/lib/types.ts` (update "no subscriber" doc at `:2746–2765` — it stops being true in this slice)
- `client/src/lib/api.ts` (new: `projectPlans.coverage(projectId)` and `projectPlans.requestCoverage(projectId)`)

**What changes:**
1. **`client/src/lib/types.ts`:**
   - Widen `ValueAltitudesUpdatedPayload` with optional `coverage` field
   - Define `demand` union type: `"passive" | "requested" | "draining"` (closed registry, server-authored)
   - Define `eta` discriminated union: `{state:"measured", ms_remaining, per_batch_ms, batches_remaining}` | `{state:"estimating"}` | `{state:"none"}`
   - Carry canonical-source doc comment: "See `server/lib/value-coverage.js`" (WATCH-S2-F precedent)
   - Update "no subscriber" doc at `:2746–2765` to reflect that `PlanLedgerPanel` now subscribes

2. **`client/src/lib/api.ts`:**
   - `projectPlans.coverage(projectId): Promise<CoverageSnapshot>`
   - `projectPlans.requestCoverage(projectId): Promise<CoverageSnapshot>`

**Layer:** Client library

**Step type:** IMPLEMENTATION (prerequisite for PlanLedgerPanel)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
grep -q "coverage" client/src/lib/types.ts && \
grep -q "demand.*passive.*requested.*draining" client/src/lib/types.ts && \
grep "projectPlans.coverage" client/src/lib/api.ts
```
Confirm:
- `ValueAltitudesUpdatedPayload.coverage` optional field exists
- `demand` and `eta` types defined with canonical-source comments pointing to server home
- Two API methods exist with correct signatures

---

### Task 10: i18n Locales — all four languages (MANDATORY per technical-plan §3.8)

**Files touched:**
- `client/src/i18n/locales/en/projectDetail.json`
- `client/src/i18n/locales/ko/projectDetail.json`
- `client/src/i18n/locales/vi/projectDetail.json`
- `client/src/i18n/locales/zh/projectDetail.json`

**What changes:**
New `planLedger.pool.coverage.*` keys in all four locales, same commit, with canonical-source doc comments (G6 MANDATORY):
- `planLedger.pool.coverage.header` — "N of M described"
- `planLedger.pool.coverage.estimating` — for cold-start ETA case
- `planLedger.pool.coverage.prioritizeNow` — button label
- `planLedger.pool.coverage.requested` — "prioritization requested" copy
- `planLedger.pool.coverage.draining` — "draining now" copy

**Layer:** Client localization

**Step type:** IMPLEMENTATION (all four in one commit)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
for locale in en ko vi zh; do \
  grep -q "planLedger.pool.coverage" "client/src/i18n/locales/$locale/projectDetail.json" || exit 1; \
done && \
node --test client/src/i18n/__tests__/i18n.test.ts 2>&1 | grep -E "pass|fail"
```
Confirm:
- All four locale files contain the new keys (same commit)
- Each locale file carries a canonical-source comment naming the server export
- i18n.test.ts (E1.1 pattern) passes, proving all keys are registered (G6 MANDATORY)

---

### Task 11: PlanLedgerPanel — Header, "Prioritize Now" Button, EventBus Subscriber (MANDATORY client-never-computes, DEC-1/DEC-5)

**Files touched:**
- `client/src/components/PlanLedgerPanel.tsx` (add coverage header, subscriber, button)
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (cold-start render, out-of-order delivery)

**What changes:**
1. **Coverage header rendering** (render only, never compute):
   - Display `described`/`pool_size` as "N of M described"
   - Display ETA: if `eta.state === "measured"`, show "~X min remaining"; if `state === "estimating"`, show the named string (DEC-1 MANDATORY — a rendered `~0 min` is a requirement violation, not a rounding choice)
   - Never render an ETA number for the cold-start case

2. **"Prioritize Now"** button → `requestCoverage` (fire-and-forget call)

3. **First-ever `eventBus` subscription** on this panel (MANDATORY per §3.6c–f):
   - `useEffect` + `eventBus.subscribe`
   - Filter: `msg.type === "value_altitudes_updated" && msg.data.project_id === projectId`
   - Merge snapshot (MANDATORY MERGE RULE: accept a snapshot only if its `computed_at` is newer than the one held — prevents HTTP/WS race regression, R4)
   - **Handler must not throw** — wrap in try/catch per `colorThresholds.ts:105` / `focusStore.ts` precedent
   - Refetch altitude texts only (not coverage), only for the message's `unit_keys` (relaxes `requestedAltitudesRef`'s once-ever semantics for exactly those keys — WATCH-S2-B)
   - Unsubscribe on cleanup

4. **No disabled Auto-group button** (DEC-2), no percent, no remaining count, no ETA arithmetic anywhere in this file (DEC-1 / DEC-5 MANDATORY — client never computes)

**Layer:** Client component

**Step type:** IMPLEMENTATION (requires Task 9 types + Task 10 locales)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
grep -q "eventBus.subscribe" client/src/components/PlanLedgerPanel.tsx && \
grep "prioritiz\|priorityNow" client/src/components/PlanLedgerPanel.tsx && \
node --test client/src/components/__tests__/PlanLedgerPanel.test.tsx 2>&1 | grep -E "cold.*start|out.*order"
```
Confirm:
- Cold-start renders `estimating` copy (not a minutes string, not `0`) — G1a requirement
- Out-of-order snapshot delivery does not regress the header — R4 (test delivers snapshots with newer then older `computed_at`, verify only the newer one is displayed)
- No arithmetic for `described`, `pending`, ETA anywhere in component (grep for `counts.*pool` / `queued` / `ms_remaining / per_batch` in file returns 0) — DEC-1/DEC-5 MANDATORY
- `eventBus` subscription present with try/catch handler
- Merge rule implemented: `computed_at` monotonic

---

### Task 12: Calibration + Pin Defaults (DEC-10)

**Files touched:**
- Scratchpad script (not committed): calibration harness
- `server/lib/value-summary.js` (environment defaults for per-stage models)
- DEC-10 (decision log, artifact attached)

**What changes:**
1. Run a real 40-unit batch through `buildPrompt` + `runClaudePromptJson` twice (`{model:"haiku"}`, `{model:"sonnet"}`) from a scratchpad script — not committed.
2. Attach both outputs + the recommendation to DEC-10.
3. Pin the per-stage defaults in `summaryModel`:
   - `DASHBOARD_VALUE_SUMMARY_UNIT_MODEL` (env var, fallback chain) for `summaryModel("unit")`
   - `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL` (env var, fallback chain) for `summaryModel("grouping")` — but no consumer until Slice 3
4. Ensure defaults are in the fallback chain at the right precedence (§3.3 / DEC-7).

**Layer:** Configuration / validation

**Step type:** IMPLEMENTATION (must complete **before** defaults are pinned — AC-6)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
grep "DASHBOARD_VALUE_SUMMARY_UNIT_MODEL" server/lib/value-summary.js && \
grep "DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL" server/lib/value-summary.js && \
grep -q "DEC-10" requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/build/2026-08-05-coverage-on-demand/decisions.md
```
Confirm:
- Calibration artifact attached to DEC-10 (both model outputs + recommendation)
- Environment defaults pinned in code (not left as placeholders)
- Per-stage precedence table in code matches documented fallback chain

---

### Task 13: Documentation Updates (MANDATORY per CLAUDE.md `update-project-docs`)

**Files touched:**
- `docs/DATABASE.md` (new column schema)
- `docs/API.md` (two new endpoints)
- `ARCHITECTURE.md` (demand levels, first WS subscription on PlanLedgerPanel)
- `server/README.md` (new env vars: `DASHBOARD_VALUE_SUMMARY_UNIT_MODEL` / `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL`)

**What changes:**
All documentation reflects:
- New `coverage_requested_at` column on `value_summary_sweep_state`
- Two new routes: `POST /api/project-plans/coverage-request`, `GET /api/project-plans/coverage`
- Three demand levels: `passive`, `requested`, `draining`
- PlanLedgerPanel's first WS event subscription on `value_altitudes_updated`
- New environment variables for per-stage model selection
- Explicit note that `grouping` stage is unused until Slice 3

**Layer:** Documentation

**Step type:** IMPLEMENTATION

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
grep -q "coverage_requested_at" docs/DATABASE.md && \
grep -q "coverage-request" docs/API.md && \
grep -q "eventBus" ARCHITECTURE.md && \
grep -q "DASHBOARD_VALUE_SUMMARY_UNIT_MODEL" server/README.md
```
Confirm:
- All four doc files updated with no stale references to pre-Slice-2 behavior

---

### Task 14: Full Test Suite + Header Verification + `FAST — QA debt` Stamp

**Files touched:**
- Build report (to be written by build-lead)
- `bash .claude/skills/file-headers/scripts/check-headers.sh`

**What changes:**
1. Run full server test suite: `npm run test:server` → green
2. Run full client test suite: `npm run test:client` → green (review snapshot diffs deliberately, not blindly)
3. Run file-header audit: `bash .claude/skills/file-headers/scripts/check-headers.sh` → exit 0
4. Verify guard discipline per §9.3 standing rule:
   - `grep -rn "assert.ok(true" server/__tests__/` → 0 results
   - `grep -rn "\|\| true" server/__tests__/` → 0 results
   - New specs swept for `typeof `, `Array.isArray`, bare `assert.ok(`, empty `=> {}` bodies
   - Every guard recorded red against a real mutation (per-test red-proof in build report, not self-report)
5. Verify structural guards:
   - `single-writer-guard.test.js` green with no new writers added
   - `chronology-ordering.test.js` green with new `value-coverage.js` disposition entry
   - `value-coverage-parity.test.js` (G2) present and proven red (by introducing a rogue re-derivation, then restore)
6. Verify absence-state registries closed: `demand` and `eta.state` enums exported from server, copied to client with canonical-source comment (G6 / WATCH-S2-F)
7. `server/index.js` diff is empty (engineer's explicit correction)
8. Drain path returns 0 from grep of `MAX_PROJECTS_PER_TICK` (DEC-3.3)
9. Build report carries **`FAST — QA debt`** stamp naming `supporting/qa.md`'s deferred list verbatim (DEC-F2):
   - Full E2E test coverage beyond G2
   - Snapshot-baseline comprehensive sweep
   - Drain load/perf scenarios
   - WS lifecycle edge cases beyond coverage updates
   - Calibration judgment call review
   - Locale copy review (beyond existence check)

**Layer:** Verification / documentation

**Step type:** VERIFICATION (final gate)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor && \
npm run test:server && \
npm run test:client && \
bash .claude/skills/file-headers/scripts/check-headers.sh && \
grep -rn "assert.ok(true" server/__tests__/ | wc -l && \
grep -rn "\|\| true" server/__tests__/ | wc -l && \
grep "FAST.*QA debt" <build-report-path>
```
Confirm:
- All test suites pass green
- Zero vacuous guards detected by sweep
- File headers audit passes
- All G1a–G6 guardrails recorded green + red-proven
- Build report includes `FAST — QA debt` stamp with full deferred list
- `server/index.js` untouched
- Drain does not read `MAX_PROJECTS_PER_TICK`

---

## Summary Table

| # | Task | Component(s) | Type | MANDATORY | Catalog Ref |
|---|---|---|---|---|---|
| 0 | [S1-dep] shape verification | Planning | PRE-CONDITION | YES | § |
| 1 | Schema migration | `server/db.js` | IMPL | YES | §9.5 |
| 2 | Statements + chronology | `server/db.js` | IMPL | YES | §9.2 |
| 3 | Single-home module | `server/lib/value-coverage.js` | IMPL | YES | §9.1, DEC-5 |
| 4 | Composer probe + tiers | `server/lib/value-summary.js` | IMPL | YES | §9.1, DEC-7 |
| 5 | Drain loop | `server/lib/value-summary-tick.js` | IMPL | YES | DEC-4, WATCH-7/8 |
| 6 | HTTP routes | `server/routes/project-plans.js` | IMPL | YES | DEC-16 |
| 7 | Parity test (named) | `value-coverage-parity.test.js` | TEST | YES | §9.1, G2 |
| 8 | Broadcast widening | `value-summary-tick.js` | IMPL | YES | DEC-6 |
| 9 | Wire types + API | `client/src/lib/{types,api}.ts` | IMPL | YES | WATCH-S2-F |
| 10 | i18n locales (4) | `client/src/i18n/locales/` | IMPL | YES | G6 |
| 11 | PlanLedgerPanel + sub | `client/src/components/` | IMPL | YES | DEC-1/5, R4 |
| 12 | Calibration + defaults | Config / `summaryModel()` | IMPL | YES | DEC-10 |
| 13 | Docs update | `docs/{DATABASE,API,ARCHITECTURE}.md`, `server/README.md` | IMPL | YES | CLAUDE.md |
| 14 | Full verification | Test suite + headers + stamp | VERIFY | YES | §9.3, DEC-F2 |

---

## Sequencing Notes

**Linear, single implementer:** every task depends on one or more prior tasks. No parallelization possible within the implementer phase. Test-first discipline means:
- G1a/G1b/G1c tests written before implementation (Task 3)
- G2 (parity test) written before client code (Task 11)
- G4 (chronology) proven red by reversing ORDER BY before Task 2 completion
- G5 (vacuous guard sweep) and red-proofs recorded in build report during Task 14

**Service requirements:** all tasks run against a temp DB at `DASHBOARD_DB_PATH` (set per test suite). No live `~/.claude/agent-dashboard/dashboard.db` touched during this build; backup recommended per build-brief.

**Blocking gate at Task 0:** if any [S1-dep] shape has drifted from Slice 1's actual landed code, the entire task list must be updated before implementation begins. This is not a nice-to-have — it is a gate.

---

## Rollback Command

```bash
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor \
  reset --hard b38b4a151fe3e3bcd47c7858684f0b8121b53d57
```

(Worktree is brand new and currently identical to its branch point, so this is a no-op unless/until the build commits.)
