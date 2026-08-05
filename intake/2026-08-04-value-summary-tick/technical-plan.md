# Technical Plan — value-summary-tick

**Intake:** `intake/2026-08-04-value-summary-tick/`
**Date:** 2026-08-04 · **Classification (PM):** `missed-requirement`, with a
`new-feature` carve-out (Settings observability UI) deferred to a fast-follow.
**Inputs read in full:** `request-brief.md`, `pm-plan.md`,
`supporting/architect.md`, `supporting/engineer.md`, `supporting/qa.md`, plus the
live tree (`server/lib/value-summary.js`, `value-ledger.js`,
`server/routes/project-plans.js`, `server/index.js`, `server/db.js`,
`server/__tests__/single-writer-guard.test.js`, `helpers/single-home.js`,
`chronology-ordering.test.js`, `ledger-metrics-parity.test.js`,
`client/src/lib/types.ts`, `api.ts`, `PlanLedgerPanel.tsx`,
`i18n/locales/en/projectDetail.json`).
**Tracked decisions:** `intake/2026-08-04-value-summary-tick/decisions.md`
(DEC-1..DEC-15, WATCH-1..WATCH-6, OPEN-1..OPEN-4). Every scope boundary this
plan declines is a row there, not a sentence here.

---

## 1. Objective

A project's PROJECT/STAKEHOLDER altitude synthesis currently completes only 40
uncached units per page visit, so a 182-unit pool needs roughly three manual
reloads to fill, and a unit with no text is indistinguishable from a unit whose
synthesis failed. We will keep the existing ≤40 same-visit fast path exactly as
it behaves today, add a bounded background tick that sweeps every tracked project
in least-recently-swept rotation to cover the overflow, make the per-unit
"no text yet" state explicit on the wire (*queued* vs. *unavailable*) instead of
overloading absence, and land an audit table that records what each sweep
actually did. End state: a user opens a large project once, sees 40 units
resolved and the remainder honestly labelled *queued*, and never has to reload to
drive generation again — the tick finishes the pool unattended, and the operator
can prove from the log that it is keeping up.

---

## 2. Recommended approach

**Hybrid (architect Option B), with a server-authored per-unit state.**

- `POST /api/project-plans/altitudes` keeps calling `enrichPoolAltitudes`
  synchronously and keeps its ≤40-per-request cap. No read-only cutover. This is
  the architect's Option B, the product-owner's independent conclusion, and
  `CLAUDE.md`'s "preserve existing behavior unless explicitly asked to change it"
  — all three agree (DEC-3).
- A new `server/lib/value-summary-tick.js`, registered in
  `startBackgroundServices()`, sweeps `MAX_PROJECTS_PER_TICK` (default 3)
  projects per tick, **ordered least-recently-swept first**, and makes exactly
  one `enrichPoolAltitudes` call per swept project. Every project with a
  `project_paths` mapping is eligible; the rotation is starvation-free, so
  coverage does not depend on Sara's click history (DEC-2).
- The response and the internal composer gain a `states` map:
  `queued` (a miss not attempted this round) vs. `unavailable` (a miss that was
  attempted and produced nothing). This is the durable fix for the request's
  actual problem statement — not a bigger cap (DEC-10, DEC-11).
- A `value_summary_generation_log` table and its write sites ship with the tick;
  Settings routes/UI do not (DEC-4, DEC-14).

### What I overrode, and why

1. **Overrode the PM's OPEN-1 recommendation** (separate branch for the
   uncommitted altitude layer) → commit it on `master`, then branch this build.
   The parent effort's earlier slices already live on `master`; re-homing 991
   lines via reset/cherry-pick on a repo with concurrent Claude sessions is the
   exact operation the `concurrent-session-risk` memory note records real work
   loss from. Both options satisfy the actual requirement (a valid ref-anchored
   diff base, an unentangled diff). See **DEC-13**.
2. **Overrode the engineer's Layer B** (read-only endpoint) and **Layer C's
   client subscription** — both dropped from v1. Layer B is superseded by DEC-3.
   Layer C is deferred by DEC-8/**OPEN-3**; the client gains type entries only,
   no `eventBus` wiring. This means the tick broadcasts to nobody in v1, and
   QA's DoD line about a broadcast needing a listener is knowingly unsatisfied
   this round — see §8 and OPEN-3 for the honest statement of what that costs.
3. **Overrode the architect's "recency-bounded `ORDER BY updated_at DESC`"**
   sweep selection in favour of least-recently-swept rotation, per DEC-2 — a
   recency filter reintroduces exactly the staleness-follows-attention problem
   this request exists to remove.
4. **Extended `enrichPoolAltitudes`'s return shape** rather than adding a second
   exported entry point (DEC-10). One composer, one truth; the churn is six
   one-line destructures in its own test file.
5. **Declined the engineer's Layer E cleanup-route fix** in v1 (DEC-12):
   `server/routes/settings.js` is not touched at all, so the fast-follow closes
   all four missing tables in one atomic change instead of leaving a diff where
   only one omission looks new.

### Fixed while we are in here

`server/lib/value-summary.js:36-38` currently says *"Pool batches are small in
practice, so overflow is expected to be rare."* That was false when it was typed
— the parent effort's DEC-12 had rendered a 182-unit pool the previous day. It
must be replaced with the measured number and the new overflow contract, per the
PM's §4 Thread 2 countermeasure (any bound on a user-visible collection cites the
real distribution it was sized against).

---

## 3. Change set

Grouped by layer. Paths are repo-relative to
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`.

### Schema / data (server)

| File | Change |
|---|---|
| `server/db.js` | New `CREATE TABLE IF NOT EXISTS value_summary_sweep_state` and `value_summary_generation_log` (+ indexes), in their own `db.exec(...)` block next to the `focus_summary_access_log` precedent (~line 1778). New prepared statements `listValueSweepTargets`, `upsertValueSweepState`, `insertValueSummaryGeneration` in `stmts`, next to `getValueUnitSummary`/`upsertValueUnitSummary` (~line 3145). |

### Synthesis composer + request path (server)

| File | Change |
|---|---|
| `server/lib/value-summary.js` | `enrichPoolAltitudes` returns `{ altitudes, states }`; new exported `ALTITUDE_STATES = ["queued", "unavailable"]`; the `MAX_UNITS_PER_PROMPT` comment (lines 36-38) rewritten against the measured 182-unit pool; `@file` overview updated to name the tick as the second invoker and to state that this file remains the **only** `upsertValueUnitSummary.run(` call site. |
| `server/routes/project-plans.js` | Line 23: `const valueSummary = require(...)` → `const { enrichPoolAltitudes } = require("../lib/value-summary");` (required by `assertSingleHome`'s destructure check). Line 153-154: `const { altitudes, states } = await enrichPoolAltitudes(...); res.json({ altitudes, states });`. Route doc comment updated to describe `states`. **No other behavior change on this route.** |

### Background tick (server, net-new)

| File | Change |
|---|---|
| `server/lib/value-summary-tick.js` | **NEW.** Exports `startValueSummaryTick(broadcast)`, `runValueSummaryTickOnce(dbModule, opts)`, `listSweepTargets(dbModule, limit)`, `__injectPoolAssemblerForTest(fn)`, `__resetTickStateForTest()`, and the defaults `DEFAULT_TICK_MS`/`BOOT_DELAY_MS`/`DEFAULT_MAX_PROJECTS_PER_TICK`. |
| `server/lib/value-ledger.js` | `CONSUMERS` (line 57) gains `"server/lib/value-summary-tick.js"` (DEC-7). |
| `server/index.js` | One `try { const { startValueSummaryTick } = require("./lib/value-summary-tick"); startValueSummaryTick(broadcast); } catch (err) { console.warn("value summary tick failed to start:", err.message); }` block inside `startBackgroundServices()`, after the reconciliation registration (~line 458). |

### Client (type-level + placeholder states only)

| File | Change |
|---|---|
| `client/src/lib/types.ts` | `WSMessage.type` union gains `"value_altitudes_updated"`, `"project_plan_updated"`, `"value_claim_updated"`; `data` union gains `ValueAltitudesUpdatedPayload`, `ProjectPlanUpdatedPayload`, `ValueClaimUpdatedPayload`; the three new payload interfaces; the `type` field's doc-comment mapping and the module `@file` "WebSocket `type` → payload index" table (~line 537) both updated. **No subscriber anywhere** (DEC-8, OPEN-3). |
| `client/src/lib/api.ts` | `projectPlans.altitudes`'s response type gains `states?: Record<string, "queued" \| "unavailable">`; JSDoc updated to describe the two states instead of "absent means unavailable". |
| `client/src/components/PlanLedgerPanel.tsx` | `Altitude` type becomes `{project;stakeholder} \| "queued" \| "unavailable" \| undefined`; `AltitudeText` (line ~321) gains the `queued` branch and keeps `unavailable` as the fallback for unknown/missing states; the altitude effect (lines ~536-545) maps `res.states?.[u.id] ?? "unavailable"` where it currently writes `null`. Doc comments on `Altitude`/`AltitudeText`/the panel updated. |
| `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` | New key `planLedger.pool.altitudes.queued` in all four locales (the `en` namespace is the registry; `i18n.test.ts` E1.1 derives the parity check from it). |

### Tests

| File | Change |
|---|---|
| `server/__tests__/value-summary.test.js` | Six `enrichPoolAltitudes(...)` call sites destructured; new cases for the DEC-11 truth table; header comment updated for the `states` contract. |
| `server/__tests__/value-summary-tick.test.js` | **NEW.** Overlap guard, per-tick project bound, rotation order, DEC-16 structural assertion, env disable, broadcast on/off, log + sweep-state writes. |
| `server/__tests__/single-writer-guard.test.js` | New `it()` blocks for `upsertValueUnitSummary` and `insertValueSummaryGeneration`, plus two `assertSingleHome` blocks — reusing this file's existing `scanFiles` walker and the shared helper, adding **no** new scope-derivation helper (DEC-6, §9.7). |
| `server/__tests__/ledger-metrics-parity.test.js` | C2.4's expected array gains `"server/lib/value-summary-tick.js"` (DEC-7). |
| `server/__tests__/chronology-ordering.test.js` | `FILE_DISPOSITIONS` gains `"server/lib/value-summary-tick.js": "scanned"` (DEC-9). |
| `client/src/components/__tests__/PlanLedgerPanel.test.tsx` | New >40-unit overflow test asserting *queued* and *unavailable* render distinguishably **in the same render**; existing three altitude tests re-verified against the hybrid contract. |

### Docs

| File | Change |
|---|---|
| `ARCHITECTURE.md` (+ whatever `update-project-docs` resolves: `README.md`, `SETUP.md`) | The new tick in the background-services list, the two new tables, `DASHBOARD_VALUE_SUMMARY_TICK_MS` / `DASHBOARD_VALUE_SUMMARY_TICK_MODE` / `MAX_PROJECTS_PER_TICK` alongside the existing `DASHBOARD_RECONCILE_MS` documentation, and the `states` field on `POST /api/project-plans/altitudes`. |
| `intake/2026-08-04-value-summary-tick/decisions.md` | Already created (step 1). OPEN-4's measurement row filled in at step 15. |

---

## 4. Implementation steps

Each step is independently checkable. Do not reorder 2 → 7; the schema must exist
before the tick can log, and the tick must exist before anything relies on it.

### Step 1 — Unblock the build (OPEN-1 / DEC-13). **Blocking.**

1. Per the `concurrent-session-risk` memory note, check for other live sessions
   in this repo first: `ps aux | grep -i claude | grep -v grep` and
   `lsof +D /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/.git 2>/dev/null | head`.
   If another session is mid-write, stop and coordinate before touching git.
2. Verify the uncommitted altitude layer is green **before** committing it:
   `npm run test:server`, `npm run test:client`,
   `bash .claude/skills/file-headers/scripts/check-headers.sh`.
3. `git add -A && git commit` on `master` with a message referencing this
   intake folder and the parent effort (`intake/2026-08-02-plan-lifecycle-value-ledger`).
   Untracked files `server/lib/value-summary.js` and
   `server/__tests__/value-summary.test.js` must be included — confirm with
   `git status --porcelain` returning empty afterwards.
4. `git checkout -b effort/2026-08-04-value-summary-tick`. Record the commit sha
   in DEC-13 as this build's diff base ref.

**Proves:** `git diff <base-sha>` from here on contains only this build's work,
which is what §9.4's adversarial fix-round review and §9.3's ref-anchored-guard
corollary both require.

### Step 2 — Schema and prepared statements (`server/db.js`)

Add, in a new `db.exec(...)` block modelled on the `focus_summary_access_log`
block at ~line 1778, with a schema comment explaining each table's purpose and
DEC-14's rationale for the unused-in-v1 `source` value:

```sql
CREATE TABLE IF NOT EXISTS value_summary_sweep_state (
  project_id TEXT PRIMARY KEY,
  last_swept_at TEXT,
  pending_after_sweep INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS value_summary_generation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('tick','request')),
  outcome TEXT NOT NULL CHECK(outcome IN ('ok','skipped','error')),
  pool_size INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  generated INTEGER NOT NULL DEFAULT 0,
  queued INTEGER NOT NULL DEFAULT 0,
  unavailable INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_value_summary_generation_log_created_at
  ON value_summary_generation_log(created_at);
CREATE INDEX IF NOT EXISTS idx_value_summary_generation_log_project
  ON value_summary_generation_log(project_id, created_at);
```

Both are additive `CREATE TABLE IF NOT EXISTS` — no `ALTER`, no rebuild, so
§9.5/§9.6 are **inapplicable** rather than complied-with (the stronger outcome
the catalog's own 2026-08-02 lesson asks for). Then add to `stmts`:

- `listValueSweepTargets` — least-recently-swept rotation, NULLs (never swept)
  first, deterministic tiebreak:
  ```sql
  SELECT p.id AS project_id, s.last_swept_at AS last_swept_at
  FROM projects p
  JOIN (SELECT DISTINCT project_id FROM project_paths) pp ON pp.project_id = p.id
  LEFT JOIN value_summary_sweep_state s ON s.project_id = p.id
  ORDER BY (s.last_swept_at IS NOT NULL) ASC, s.last_swept_at ASC, p.id ASC
  LIMIT ?
  ```
  (Uses the portable `IS NOT NULL` form rather than `NULLS FIRST`. `project_paths`
  and `projects` are not in `chronology-ordering.test.js`'s `bulkInsertTables`,
  so this LIMITed query is outside that scan's scope — and its ordering key is a
  real timestamp, not a row id, which is §9.2's actual requirement.)
- `upsertValueSweepState` — `INSERT ... ON CONFLICT(project_id) DO UPDATE SET
  last_swept_at = excluded.last_swept_at, pending_after_sweep = excluded.pending_after_sweep`.
- `insertValueSummaryGeneration` — plain `INSERT INTO value_summary_generation_log (...) VALUES (...)`.

**Proves:** `npm run test:server` still green (schema is additive and no test
reads these yet); a fresh DB and an existing DB both open cleanly.

### Step 3 — Per-unit state in the composer (`server/lib/value-summary.js`)

1. Change `enrichPoolAltitudes` to build and return `{ altitudes, states }`,
   where `altitudes` is today's exact map (unchanged shape and semantics) and
   `states` carries an entry **only** for units with no text, per DEC-11:
   - all misses → `unavailable` when `await llmAvailable()` is false;
   - otherwise `misses.slice(0, MAX_UNITS_PER_PROMPT)` entries that did not
     resolve (null stdout, unparsable output, index dropped by `parseOutput`) →
     `unavailable`, and `misses.slice(MAX_UNITS_PER_PROMPT)` → `queued`.
   - Early returns (`units` empty, `misses` empty) return
     `{ altitudes, states: {} }` — no unit is ever in both maps.
2. Export `ALTITUDE_STATES = ["queued", "unavailable"]`.
3. **Do not move, wrap, or duplicate** the
   `dbModule.stmts.upsertValueUnitSummary.run(...)` call at line 179. It stays
   exactly where it is: one lexical call site, inside `enrichPoolAltitudes`.
   That is the invariant step 9 enforces.
4. Rewrite the lines 36-38 comment to cite the measurement:
   > the cap bounds prompt size, not coverage — the largest measured real pool is
   > 182 units (parent effort DEC-12, 2026-08-03), so overflow is the normal case
   > and is reported explicitly as `queued`, then drained by
   > `value-summary-tick.js`.
5. Update the `@file` overview: two invokers (route fast path, tick overflow
   sweep), one writer.

**Proves:** new `value-summary.test.js` cases — a 45-unit batch with an available
LLM yields 40 resolved + 5 `queued` and zero `unavailable`; the same batch with
`DASHBOARD_FOCUS_INFER_MODE=heuristic` yields 45 `unavailable` and zero `queued`;
a parse failure yields `unavailable` for the attempted slice; no unitKey ever
appears in both `altitudes` and `states`.

### Step 4 — Request path carries the state (`server/routes/project-plans.js`)

Destructure the import (line 23), destructure the call result (line 153), and
respond `res.json({ altitudes, states })`. Nothing else on this route changes —
same validation, same 200-always contract, same ≤40 synchronous synthesis.

**Proves:** the existing route test in `value-summary.test.js` stays green on
`altitudes`; a new assertion confirms `states` is present and that a >40-unit
POST returns `queued` entries for the overflow while still resolving the first 40
inline (the AC-1 fast-path regression check).

### Step 5 — The tick (`server/lib/value-summary-tick.js`, NEW)

File header per `.claude/rules/file-headers.md` (overview + the exact
`@author Son Nguyen <hoangson091104@gmail.com>` line) before any code.

Structure — mirrors `focus-inference.js:554-591` and `reconciliation.js:444-480`,
with one deliberate improvement (the overlap flag guards the exported callable,
not just the timer closure, because QA §3a found neither sibling's scheduling
closure is testable at all):

```js
const { assembleValuePool } = require("./value-ledger");
const { enrichPoolAltitudes } = require("./value-summary");

const DEFAULT_TICK_MS = 600_000;            // DEC-5, matches DASHBOARD_FOCUS_INFER_MS
const BOOT_DELAY_MS = 30_000;               // DEC-5, matches focus-inference.js
const DEFAULT_MAX_PROJECTS_PER_TICK = 3;    // DEC-5, lower than reconciliation's 10:
                                            // each project costs a git walk AND up to one spawn
let running = false;                        // module-scope overlap guard
let poolAssembler = assembleValuePool;      // DEC-15 seam; production default only
```

- `listSweepTargets(dbModule, limit)` → `dbModule.stmts.listValueSweepTargets.all(limit)`.
- `runValueSummaryTickOnce(dbModule, { broadcast, now } = {})`:
  1. `if (running) return { skipped: "overlap" };` then `running = true` in a
     `try/finally`.
  2. Read `MAX_PROJECTS_PER_TICK` from env **inside this function** (not captured
     at start time) so tests can vary it per call.
  3. For each target, inside a per-project `try/catch` (one bad project must
     never stop the sweep — the same fail-safe every sibling tick uses):
     - `const { units } = await poolAssembler(dbModule, { id: project_id });`
     - `const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);`
     - `cacheHits` = entries with `cached === true`; `generated` = entries with
       `cached === false`; `queued`/`unavailable` = counts from `states`;
       `model` = the first generated entry's `.model` or `null`;
       `duration_ms` = elapsed ms for this project.
     - `dbModule.stmts.insertValueSummaryGeneration.run(project_id, "tick", outcome, units.length, cacheHits, generated, queued, unavailable, model, durationMs)`
       — `outcome` is `"ok"`, or `"error"` from the catch block.
     - `dbModule.stmts.upsertValueSweepState.run(project_id, nowIso, queued + unavailable)`
       — **in the `finally`, so a failed project still advances the rotation** and
       cannot starve every project behind it.
     - `if (generated > 0 && broadcast) broadcast("value_altitudes_updated", { project_id, unit_keys: <generated keys>, pending: queued + unavailable })`.
       Never broadcast on a zero-generation sweep.
  4. Return `{ swept, projects: [{ project_id, generated, queued, unavailable }] }`.
- `startValueSummaryTick(broadcast)`: `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off` →
  return; `DASHBOARD_VALUE_SUMMARY_TICK_MS` (default `DEFAULT_TICK_MS`), `<= 0`
  or non-finite → return; otherwise `setTimeout(BOOT_DELAY_MS)` + `setInterval`,
  both `.unref()`'d, both calling
  `runValueSummaryTickOnce(require("../db"), { broadcast }).catch(() => {})`.
- `__injectPoolAssemblerForTest(fn)` sets `poolAssembler` (`fn == null` restores
  the production default); `__resetTickStateForTest()` clears `running`.

**Explicitly not in this file:** any SQL that derives pool membership, any second
`upsertValueUnitSummary` call, any `MAX_UNITS_PER_PROMPT` re-declaration, any
retry/backoff scheduler.

**Proves:** step 10's spec.

### Step 6 — DEC-16 tripwire, closed in the same change

Add `"server/lib/value-summary-tick.js"` to `value-ledger.js`'s `CONSUMERS`
(line 57) **and** to `ledger-metrics-parity.test.js` C2.4's expected array. Run
`node --test server/__tests__/ledger-metrics-parity.test.js` **before** the test
edit to watch C2.4 go red, then after, to watch it go green. That red is the
tripwire working (DEC-7), and observing it is the proof the tripwire is not
vacuous.

**Proves:** C2.4 red → green, with the reason understood, not routed around.

### Step 7 — Register the tick (`server/index.js`)

Add the `try/catch` block inside `startBackgroundServices()` after the
reconciliation registration (~line 458), with a comment in the same house style
naming what it does and how to disable it.

**Proves:** `npm run dev` boots with no warning on stdout; setting
`DASHBOARD_VALUE_SUMMARY_TICK_MODE=off` boots equally cleanly.

### Step 8 — Chronology disposition (DEC-9, in this exact order)

1. **First** run `node --test server/__tests__/chronology-ordering.test.js`
   *without* adding the disposition entry. It must fail with
   `server/lib/value-summary-tick.js has no disposition in FILE_DISPOSITIONS`.
   If it does **not** fail, the `derivedFiles` derivation has regressed — stop
   and fix that; per QA §6 it outranks this feature.
2. Then add `"server/lib/value-summary-tick.js": "scanned"` and re-run to green.

**Proves:** the derivation is live, and the new file is scanned rather than
grandfathered.

### Step 9 — Structural guards (DEC-6, §9.1, §9.7)

All of this goes **into the existing `server/__tests__/single-writer-guard.test.js`**,
reusing its `scanFiles` walker and the shared `assertSingleHome` helper. Do not
create a new guard file and do not write a second scope-derivation helper — that
is §9.7's named failure mode recurring one level up.

1. `it("upsertValueUnitSummary appears only in db.js and value-summary.js")` —
   `scanFiles(serverDir, /upsertValueUnitSummary/)`, filter out tests, assert the
   basenames are exactly `["db.js", "value-summary.js"]`.
2. `it("upsertValueUnitSummary.run( has exactly one lexical call site, inside enrichPoolAltitudes")`
   — read `server/lib/value-summary.js`, strip comments the way the existing
   `applyDisposition` test does (lines 119-129), assert
   `/upsertValueUnitSummary\.run\s*\(/g` matches exactly once, and assert that
   match falls inside `enrichPoolAltitudes`'s body using the same brace-matching
   walk (lines 132-147). **This is the invariant that makes the hybrid safe:**
   two legitimate *invokers* (route, tick), one lexical *writer*. Failure message
   must say so and name DEC-3/DEC-6.
3. `it("insertValueSummaryGeneration has exactly one production call site")` —
   basenames exactly `["db.js", "value-summary-tick.js"]` (WATCH-6 records that
   the fast-follow will widen this deliberately).
4. `it("value-summary.js's exports have an explicit disposition at every consumer")`
   — `assertSingleHome("../lib/value-summary", { "../routes/project-plans": { shared: ["enrichPoolAltitudes"], absent: ["buildPrompt","parseOutput","summaryModel","MAX_UNITS_PER_PROMPT","ALTITUDE_STATES"] }, "../lib/value-summary-tick": { shared: ["enrichPoolAltitudes"], absent: [...same] } })`.
5. `it("value-ledger.js's exports have an explicit disposition at the tick")` —
   `assertSingleHome("../lib/value-ledger", { "../lib/value-summary-tick": { shared: ["assembleValuePool"], absent: [<every other export>] } })`.
   This is the structural half of QA §3a's DEC-16 assertion: the tick imports the
   composer and declares it holds none of the others.
6. **Red-proof each of 2 and 3 by injection (§9.3, non-negotiable):**
   temporarily add a second `dbModule.stmts.upsertValueUnitSummary.run(...)` line
   inside `POST /altitudes`, run the file, confirm it fails with the intended
   message, remove it and confirm green. Same for a second
   `insertValueSummaryGeneration.run(...)` in the route. A guard that has never
   been seen red is a §9.3 vacuous guard.

**Proves:** the single-writer invariant is mechanical, and its scope is derived
(module exports + a directory walk), never hand-typed.

### Step 10 — Tick spec (`server/__tests__/value-summary-tick.test.js`, NEW)

Header comment per the file-headers rule. Use `focus-inference.js`'s
`__injectSpawnForTest` seam (as `value-summary.test.js` already does) plus
`__injectPoolAssemblerForTest`, and reuse `value-summary.test.js`'s
`makeProject()`/`unit()` helpers where practical. Never spawn a real `claude`.

Required cases:

1. **Overlap guard** — hold the first `runValueSummaryTickOnce` open with a
   manually-resolved spawn Promise; assert a concurrent second call returns
   `{ skipped: "overlap" }` and causes no second spawn. **Prove by mutation:**
   remove the `running` guard, see two spawns, restore.
2. **Per-tick project bound** — seed 5 eligible projects with
   `MAX_PROJECTS_PER_TICK=2`; assert exactly 2 sweep-state rows are written and
   exactly 2 log rows appear.
3. **Least-recently-swept rotation** — seed 3 projects, one with
   `last_swept_at` old, one recent, one absent; assert the order is
   (absent, old, recent) and that consecutive ticks with a bound of 1 visit all
   three before revisiting any (the starvation-free property DEC-2 buys).
4. **Overflow drain** — one project with 45 uncached units; assert one tick
   resolves 40 and leaves `pending_after_sweep = 5`, and a second tick resolves
   the remaining 5. This is the direct regression fixture for "182 units, 3
   reloads."
5. **Broadcast discipline** — a spy `broadcast` is called once with
   `("value_altitudes_updated", { project_id, unit_keys, pending })` when units
   are generated, and **not called at all** when a tick generates zero (all
   cached, or LLM off).
6. **Log/state rows on failure** — make `poolAssembler` throw for one of two
   projects; assert the failing project gets an `outcome='error'` log row, its
   `last_swept_at` still advances (no starvation), and the other project is still
   swept.
7. **Env wiring** — `DASHBOARD_VALUE_SUMMARY_TICK_MS=0` and
   `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off` each make `startValueSummaryTick`
   register no timers (assert via a `setInterval` spy or by asserting the
   function returns before touching `require("../db")`).
8. **DEC-16 structural** — read `value-summary-tick.js`'s source; assert it
   destructures `assembleValuePool` from `./value-ledger` and that it contains no
   `FROM project_paths` / `FROM detour_dispositions` / `detectTrunkDrift`
   reference of its own (it may not re-derive pool membership).

### Step 11 — `WSMessage` union (`client/src/lib/types.ts`) — types only

Add three payload interfaces near `PlanUpdatedPayload` (~line 2732), each with a
doc comment naming its server broadcast site:

- `ValueAltitudesUpdatedPayload { project_id: string; unit_keys: string[]; pending: number }`
  — broadcast by `server/lib/value-summary-tick.js`.
- `ProjectPlanUpdatedPayload { plan: ProjectPlan | null }` — broadcast by
  `server/routes/project-plans.js:173/197/222/244/252/262`.
- `ValueClaimUpdatedPayload { claim?: ValueClaim; claim_id?: number; deleted?: boolean }`
  — broadcast by `server/routes/project-plans.js:360/379`.

Add the three strings to the `type` union, the three interfaces to the `data`
union, and update both doc-comment maps (the `type` field's, ~line 2909, and the
module `@file` index, ~line 537). Note in the `ValueAltitudesUpdatedPayload` doc
comment that **v1 ships no subscriber** (OPEN-3), so a reader does not assume
live-update behavior exists.

**Proves:** `npm run test:client` green; `cd client && npx tsc --noEmit` (or the
build) clean. Zero runtime behavior change — this step adds no executable code.

### Step 12 — API client type (`client/src/lib/api.ts`)

Add `states?: Record<string, "queued" | "unavailable">` to the `altitudes`
response type and correct the JSDoc, which currently says absence means "LLM
off/unavailable" — that is now only one of two meanings.

### Step 13 — i18n key (all four locales)

Add `planLedger.pool.altitudes.queued` to
`client/src/i18n/locales/en/projectDetail.json` next to `generating`/`unavailable`
(line ~154), then to `ko`, `vi`, `zh`. Suggested `en` copy: **"Queued"** with the
existing muted-italic styling (short, and the row's three-line shape must not
jump). Do **not** hand-type a key list anywhere — `i18n.test.ts`'s E1.1
whole-namespace parity test derives the key set from the `en` namespace, which is
the registry (§9.7 occurrence 6's own cure).

**Proves:** `cd client && npx vitest run src/i18n/__tests__/i18n.test.ts` fails
until all four locales have the key, then passes.

### Step 14 — Placeholder states in the panel (`client/src/components/PlanLedgerPanel.tsx`)

1. `type Altitude = { project: string; stakeholder: string } | "queued" | "unavailable" | undefined;`
   with the doc comment rewritten to describe the three non-resolved states
   (`undefined` = this mount's fetch has not returned yet; `"queued"` = server
   says a later pass will do it; `"unavailable"` = server attempted and failed).
2. `AltitudeText`: `undefined` → `planLedger.pool.altitudes.generating`
   (still truthful under the hybrid — the request path really is synthesizing
   inline); `"queued"` → the new key; anything else non-object → the existing
   `unavailable` key (this is DEC-11's client fallback, so an older server or a
   live tab across an upgrade renders exactly today's copy).
3. In the altitude effect (~line 542), replace
   `next[u.id] = a ? {...} : null;` with
   `next[u.id] = a ? { project: a.project, stakeholder: a.stakeholder } : (res.states?.[u.id] === "queued" ? "queued" : "unavailable");`
4. **Add no `eventBus` import and no second `useEffect`** (DEC-8, OPEN-3).

Tests in `client/src/components/__tests__/PlanLedgerPanel.test.tsx`:
- New: a 45-unit pool whose mocked `altitudes` response resolves 40 and returns
  `states` with `queued` for units 41-45 and `unavailable` for one deliberately
  failed in-cap unit — assert `/Queued/i` and `/Not available/i` are **both**
  present in the same render, and that the resolved rows show their text.
  This is the AC-2 test.
- Re-verify the three existing altitude tests unchanged: the "Generating…"
  pending-fetch test stays valid under the hybrid, the "missing from response"
  test stays valid via the fallback branch, and the exactly-once dedup test is
  untouched.
- Run `npm run test:client`; if `screens.snapshot.test.tsx` diffs, read the diff
  before regenerating — a diff here should only appear if a snapshot's Value Pool
  section actually renders a state-bearing row.

### Step 15 — Measure and fill OPEN-4

With the dev server against the real DB, record `P` (distinct `project_id` in
`project_paths`) and `U` (largest uncached pool — read it from
`value_summary_generation_log.pool_size` after a first sweep, which is exactly
why DEC-4 put the log in v1). Compute
`ceil(P / MAX_PROJECTS_PER_TICK) × cadence × ceil(U / 40)`. Write P, U, the
worst case, and the shipped defaults into OPEN-4 in `decisions.md`. If the result
exceeds ~2h, retune `MAX_PROJECTS_PER_TICK` up and/or the cadence down —
**env-var defaults only, no code change** — and record what shipped.

### Step 16 — Manual browser pass (QA §5)

1. Temporarily `DASHBOARD_VALUE_SUMMARY_TICK_MS=15000`; `npm run dev`.
2. Open Project Detail for the AC-1 validation project (OPEN-2 recommends
   Coaching Assistant, 182 units). Confirm on first paint: 40 units resolved
   inline, the rest showing **Queued**, none showing a bare ambiguous
   placeholder.
3. Watch 2-3 tick cycles. After each, re-enter the panel (navigate away and
   back, or reload — OPEN-3: the open page does not update in place in v1) and
   confirm coverage has grown by up to 40 units per cycle with **no user action
   in between** driving it.
4. `DASHBOARD_FOCUS_INFER_MODE=off`, reload: confirm uncached units render
   **Not available**, visibly distinct from Queued.
5. Re-check a small (<40-unit) project: altitudes still resolve within one visit
   — the fast path did not regress.
6. Inspect the log directly (`sqlite3 <db> "SELECT * FROM value_summary_generation_log ORDER BY created_at DESC LIMIT 20;"`)
   and confirm real per-sweep hit/generated/queued counts. This is the literal
   manual proof of "observable" available in v1 (the Settings UI is the
   fast-follow).
7. Revert every env override; confirm the shipped defaults are what step 15
   recorded.

### Step 17 — Docs

Apply the `update-project-docs` skill (automatic per `CLAUDE.md`, not on request):
`ARCHITECTURE.md`'s background-services and env-var sections (where
`DASHBOARD_RECONCILE_MS` is already documented), the two new tables, and the
`states` field on `POST /api/project-plans/altitudes`. Keep every command and
path runnable per `.claude/rules/docs-markdown.md`.

### Step 18 — Final verification

`npm run test:server`, `npm run test:client`,
`bash .claude/skills/file-headers/scripts/check-headers.sh`,
`grep -rn "assert.ok(true" server/__tests__/` and
`grep -rn "|| true" server/__tests__/` (both must return nothing for the new
files), then `git diff <base-sha>` read end-to-end as the §9.4 fix-round review.
No MCP or client-API surface changed, so `npm run mcp:typecheck` is not required
— state that explicitly rather than silently skipping it.

---

## 5. Single-source-of-truth guardrails

This change touches five canonical registries this project already enforces
mechanically. Every one of them must be routed through, never hand-edited on one
side:

1. **Pool membership → `value-ledger.js`'s `assembleValuePool`, and only it**
   (DEC-16). The tick calls it; it does not query `project_paths`, walk trunk, or
   read `detour_dispositions` itself. It joins `CONSUMERS` **and**
   `ledger-metrics-parity.test.js` C2.4 in the same change (step 6), and step 10
   case 8 asserts the absence of a hand-rolled pool query structurally.
2. **`value_unit_summaries` writes → `enrichPoolAltitudes`, one lexical
   `upsertValueUnitSummary.run(` call site.** The hybrid has two legitimate
   *invokers* and must keep exactly one *writer*. Step 9's guard asserts the call
   count is 1 and that it is lexically inside `enrichPoolAltitudes`, so a future
   "just write it here too" branch in the route or the tick fails the suite
   instead of shipping. Red-proven by injection.
3. **The client `WSMessage` union is the hand-maintained wire registry**
   (`types.ts`, its own doc comment says append-only). It is already out of sync
   with two live broadcast types; this build adds all three missing entries at
   once (DEC-8) rather than adding one more to a rotting registry. The durable
   scan that would make hand-maintenance unnecessary is WATCH-1, deliberately not
   this build's cost.
4. **The `en` locale namespace is the i18n key registry.** The new `queued` key
   goes into `en/projectDetail.json` and the E1.1 parity test derives the
   four-locale obligation from it — no hand-typed key list is added anywhere
   (§9.7 occurrence 6).
5. **`chronology-ordering.test.js`'s `FILE_DISPOSITIONS` is the derived
   server-file registry.** Step 8 requires observing the new file fail the
   derivation *first*, then dispositioning it — never adding the entry blind.

Corollary rule for the implementer: **all new SQL lives in `server/db.js`'s
`stmts`**, per `.claude/rules/backend-node.md`. The tick contains no SQL string
of its own.

---

## 6. Testing & verification

**Automated (all must be green):**

| Command | Covers |
|---|---|
| `npm run test:server` | new `value-summary-tick.test.js` (step 10, 8 cases), extended `value-summary.test.js` (step 3/4), extended `single-writer-guard.test.js` (step 9, incl. `assertSingleHome`), `ledger-metrics-parity.test.js` C2.4 (step 6), `chronology-ordering.test.js` (step 8) |
| `node --test server/__tests__/value-summary-tick.test.js` | single-spec loop while building step 5 |
| `npm run test:client` | `PlanLedgerPanel.test.tsx` (incl. the new >40 overflow/AC-2 case), `i18n.test.ts` E1.1, `screens.snapshot.test.tsx` |
| `cd client && npx vitest run -u` | **only** after reading a snapshot diff and confirming it is intentional |
| `bash .claude/skills/file-headers/scripts/check-headers.sh` | headers on `value-summary-tick.js` and `value-summary-tick.test.js` |
| `grep -rn "assert.ok(true" server/__tests__/` · `grep -rn "\|\| true" server/__tests__/` | §9.3 vacuous-guard sweep, must be empty for new files |

**Mutation proofs required (§9.3 — a guard never seen red is not a guard):**
- remove the tick's `running` flag → overlap test fails (step 10 case 1);
- add a second `upsertValueUnitSummary.run(` in the route → single-writer guard
  fails (step 9.6);
- add a second `insertValueSummaryGeneration.run(` in the route → log guard fails;
- omit the `FILE_DISPOSITIONS` entry → chronology scan fails on scope (step 8);
- omit `value-summary-tick.js` from `CONSUMERS` → C2.4 fails (step 6).

**Manual:** step 16 in full, multi-cycle, with the fast cadence reverted before
sign-off.

**Acceptance criteria mapping:**
- **AC-1 (scalable)** — step 4's >40 route test (fast path intact, per-visit work
  bounded), step 10 case 4 (overflow drains across ticks), step 16.2/16.3/16.5
  against the real 182-unit pool. **Partially met** — see OPEN-3 and §7.
- **AC-2 (observable)** — step 3's state truth-table tests, step 14's
  same-render distinguishability test, step 16.4, and step 16.6's real log rows.
- **AC-3 (right long-term fix)** — step 6 (DEC-16 preserved and registered),
  step 9 (single-writer guard, derived scope, red-proven), and
  `decisions.md` itself (the read/write split is a recorded decision).

---

## 7. Risks & rollback

**Every declined boundary below is a tracked row in
`intake/2026-08-04-value-summary-tick/decisions.md`. None of them exists only as
prose here** — that is the failure mode the architect flagged in his own
"Architectural risks" §4 closing bullet, and these rows are the carry-forward of
exactly that flag.

| Risk | Watch for | Tracked as | Mitigation / rollback |
|---|---|---|---|
| **AC-1 is only partially met: no live in-place update.** The tick broadcasts to nobody in v1; an open panel shows new coverage on its next mount, not in place. | Sara reading AC-1 literally at sign-off | **OPEN-3** (PENDING, Sara) | The payload is shaped so the follow-up is a pure client addition (~20 lines + QA §3c's two tests). Approve immediately after v1 if the literal criterion matters. |
| **Coverage latency may exceed the ~2h bar at the real fleet size.** `ceil(P/3) × 10min × ceil(U/40)` = 50 min at P≤3 but 3h20m at P=12. | step 15's measured number | **OPEN-4** (PENDING) | Both levers are env vars — raise `MAX_PROJECTS_PER_TICK`, lower `DASHBOARD_VALUE_SUMMARY_TICK_MS`. No code change, no redeploy of logic. |
| **Git cost per swept project.** `assembleValuePool` runs `isGitRepo`/`repoRootFor`/`detectTrunkDrift` on every call (`value-ledger.js:148/152/231`) regardless of LLM cache state. v1 ships no cheap pre-gate. | `duration_ms` in the audit log | **WATCH-5** | `MAX_PROJECTS_PER_TICK` bounds it now; the `startRemoteSourceSync`-style gate is the optimization, deliberately deferred per DEC-2's "bound first, then optimize." |
| **Audit log grows without a purge** (~432 rows/day at defaults). | log row count | **WATCH-4** | Retention lands with the fast-follow's Settings surface, alongside `focus_summary_access_log`'s existing hooks. |
| **"Clear data" still omits `value_unit_summaries`/`value_claims`, and now two more tables.** | the fast-follow's diff | **WATCH-2 + DEC-12** | v1 touches `settings.js` in neither direction, so all four are closed in one atomic follow-up change; DEC-12 makes that a precondition of the fast-follow. |
| **The log's single-writer guard will go red when request-path logging is added.** | fast-follow build | **WATCH-6** | By design — widen the guard deliberately in the same change, exactly as DEC-7 widens `CONSUMERS`. DEC-14's `source` column means no schema rebuild is needed then. |
| **`WSMessage` remains hand-maintained**; this build adds three entries but not the parity scan. | a fourth broadcast type drifting | **WATCH-1** | Own item, not this request's cost. §9.7 already documents `types.ts` as a knowingly hand-typed cross-runtime surface. |
| **Two writers write `value_unit_summaries` concurrently** (route + tick, same row). | `SQLITE_BUSY` in logs, or a user-reported inconsistent altitude description | **WATCH-7** (QA-DEC-1) | Existing infra covers correctness: WAL + `busy_timeout=5000` are global, the upsert is idempotent on a `unit_key` PRIMARY KEY, and `enrichPoolAltitudes` writes per-unit rather than in one long transaction. Worst case is a duplicated spawn for one unit, not corruption — pinned by `qa/test-plan.md`'s T-A concurrency test (`value-summary.test.js` :: "two overlapping calls for the same unitKey leave exactly one valid row and never throw"), which also asserts `spawnCount === 2` so an in-flight-coalescing fix later forces this row to be revisited knowingly. |
| **A pathological project stalls the rotation.** | one project always last-swept | — | `upsertValueSweepState` runs in the per-project `finally`, so a throwing project still advances its `last_swept_at` (step 5) — step 10 case 6 asserts this. |

**Rollback.** Three independent levers, in increasing order of blast radius:
1. **Runtime, no deploy:** `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off` (or
   `DASHBOARD_VALUE_SUMMARY_TICK_MS=0`). The tick stops; the request path is
   untouched and the product behaves exactly as it does today, except that units
   beyond 40 read *Queued* instead of *Not available* — a strictly more honest
   label either way.
2. **Revert the client half only** (steps 11-14): the server keeps sweeping and
   caching; the UI reverts to today's two placeholders. No data change.
3. **Full revert:** `git revert` the build commits. The two new tables stay
   behind as empty, unreferenced `CREATE TABLE IF NOT EXISTS` artifacts — no
   migration to unwind, no `ALTER` to reverse (that is DEC-14/§9.5's payoff).
   `value_unit_summaries` rows written by the tick remain valid and served by the
   unchanged request path.

---

## 8. Definition of Done

**Sequencing / process**
- [ ] The ~991-line altitude layer is committed on `master` with a clean
      `git status --porcelain`, and this build's work sits on
      `effort/2026-08-04-value-summary-tick` with its base sha recorded in DEC-13
      (OPEN-1 closed).
- [ ] `intake/2026-08-04-value-summary-tick/decisions.md` exists with DEC-1..15,
      WATCH-1..6, OPEN-1..4, and OPEN-4's measurement row is filled in with real
      numbers.

**Server**
- [ ] `value_summary_sweep_state` and `value_summary_generation_log` created
      additively (no `ALTER`, no rebuild); three new prepared statements live in
      `server/db.js`.
- [ ] `enrichPoolAltitudes` returns `{ altitudes, states }`; no unitKey ever
      appears in both; the DEC-11 truth table is covered by tests including the
      LLM-off case.
- [ ] `POST /api/project-plans/altitudes` still synthesizes up to 40 units
      inline (unchanged) and now returns `states`.
- [ ] `server/lib/value-summary-tick.js` exists, is registered in
      `startBackgroundServices()`, is disableable by both documented env vars,
      and contains no pool-membership SQL and no second cache write.
- [ ] `value-ledger.js`'s `CONSUMERS` and C2.4's expected array both name the
      tick, changed in the same commit, with C2.4 observed red first.

**Guards (each observed red before green)**
- [ ] `upsertValueUnitSummary.run(` has exactly one lexical call site, inside
      `enrichPoolAltitudes` — asserted structurally, red-proven by injection.
- [ ] `insertValueSummaryGeneration` has exactly one production call site.
- [ ] Both `assertSingleHome` blocks pass, using the shared helper — **no new
      scope-derivation helper was written.**
- [ ] `chronology-ordering.test.js` failed on the un-dispositioned new file
      first, then passes with it marked `"scanned"`.
- [ ] The tick's overlap guard was proven by mutation (guard removed → two
      spawns observed → restored).

**Client**
- [ ] `WSMessage` carries `value_altitudes_updated`, `project_plan_updated`, and
      `value_claim_updated` with their payload interfaces and updated doc maps —
      **and zero new subscribers anywhere** (`grep -rn "eventBus" client/src/components/PlanLedgerPanel.tsx`
      returns nothing).
- [ ] `planLedger.pool.altitudes.queued` exists in all four locales; E1.1 green.
- [ ] A single render shows *Queued* and *Not available* as visibly distinct
      states, asserted in `PlanLedgerPanel.test.tsx`.
- [ ] Any `screens.snapshot.test.tsx` diff was read and consciously accepted, not
      blind-regenerated.

**Verification**
- [ ] `npm run test:server` green.
- [ ] `npm run test:client` green.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] Both §9.3 greps return nothing for the new files.
- [ ] Manual browser pass done per step 16 — multi-cycle, both placeholder states
      seen, small-project fast path re-checked, env overrides reverted.
- [ ] `npm run mcp:typecheck` explicitly **not run** and stated as such (no MCP
      surface changed) — or run, if the implementer touches `mcp/` for any reason.
- [ ] Docs updated via `update-project-docs` (env vars, tables, tick, `states`).
- [ ] `git diff <base-sha>` read end-to-end as the §9.4 fix-round review.
