# Engineer Assessment — Slice 2 (coverage-on-demand + progress UX + model tiering)

**Intake:** `2026-08-05-coverage-on-demand` · **Author:** intake-engineer · **Date:** 2026-08-05
All file/line references verified by direct read of the working tree at
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor` on 2026-08-05 (master @ `c6f8154`
+ the staged diff — see §0 for what that staged diff actually is).

---

## 0. DEPENDENCY-F1 confirmation — the tree state is NOT what the decision row says

This was the run-plan's item (e), and the actual state materially contradicts both
DEC-F1's and DEPENDENCY-F1's wording. Verified from live git, not from documents:

1. **The ~2,000-line uncommitted diff on the main checkout is NOT Slice 1.** It is the
   *prior effort* — `effort/2026-08-04-value-summary-tick` — re-applied and **staged**
   (23 files, `2012 insertions(+), 82 deletions(-)`, `git diff --cached --stat`; the
   unstaged diff is empty). Its file list and stat are identical to origin's merge
   commit `55fe900` ("Merge effort/2026-08-04-value-summary-tick"), and
   `git diff 55fe900 -- <the 23 files>` is **empty for 16 of the 23**, including
   `server/lib/value-summary-tick.js`, `server/lib/value-summary.js`,
   `server/routes/project-plans.js`, `server/index.js`, `PlanLedgerPanel.tsx`, all four
   locale files, and all five test files. The 7 that differ (`db.js`, `api.ts`,
   `types.ts`, `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `server/README.md`)
   differ only because **local-only commits** (`21ab284` Playbook, `9a36d1c` concurrency
   tile, plus docs) also touch them — the staged hunks themselves are the tick effort's.
2. **Local master and origin/master have diverged:** `git rev-list --left-right --count
   master...origin/master` → **6 ahead / 2 behind**. `55fe900` is **not an ancestor of
   local HEAD** (`git merge-base --is-ancestor` fails); it exists only on
   `remotes/origin/master`. So the tick effort is merged upstream but arrives locally
   only as this staged, uncommitted duplicate.
3. **Slice 1 (`intake/2026-08-04-altitude-invalidation/`) has NO build code anywhere.**
   Grepped the whole working tree: zero hits for `input_digest` on
   `value_unit_summaries` (the only `input_digest` columns are `decision_queue` and
   `focus_summaries`), zero hits for `ALTITUDE_FRESHNESS`, and `enrichPoolAltitudes`
   returns `{altitudes, states}` with **no `counts` key**
   (`server/lib/value-summary.js:181-245`) — i.e. Slice 1's DEC-13/DEC-14 shapes do not
   exist. Its intake folder contains request-brief/pm-plan/technical-plan/qa/decisions
   and **no build artifacts**. Slice 1 is *planned*, not *mid-build*.
4. **What this means for branching Slice 2:** the real gate is longer than DEPENDENCY-F1
   states. Sequence: (i) reconcile the local/origin divergence — since the staged
   content is byte-identical to `55fe900`'s for the core files, the clean path is to
   safety-branch/stash, drop the staged duplicate, and merge `origin/master` so the tick
   content arrives via `55fe900` (committing the staged diff instead creates
   duplicate-content history against origin; identical hunks would merge cleanly, but
   it's noise). (ii) **Build Slice 1** on its own effort branch and land it. (iii) Only
   then branch Slice 2. Owner per DEPENDENCY-F1: whoever dispatches `team-build`.
5. **Concurrent-session check (repo standing risk, verified live):** at assessment time
   there are three interactive `claude` CLI processes running (PIDs 264, 40299, 86750)
   plus a Vite dev server + esbuild service running **from this repo's `client/`**
   (PIDs 79851/79853). Do not perform the git reconciliation without re-running
   `ps`/`lsof` and confirming no other session is mid-write — this repo has lost real
   work to exactly this before.

Everything below describes the change set **against a tree containing landed Slice 1**
(per its decisions.md: DEC-4 request-path logging + widened writer guard, DEC-13
`ALTITUDE_FRESHNESS`, DEC-14 `counts` on the enrich return). Where Slice 2 depends on a
Slice 1 shape that is currently only planned, it is marked **[S1-dep]**.

---

## 1. Exact change set

### 1.1 `server/db.js` — schema + statements (§9.5 three-part landing)

**New column:** `value_summary_sweep_state.coverage_requested_at TEXT` (nullable).
A timestamp, not a boolean — it doubles as the flag *and* the FIFO tiebreak when two
projects are both requested, and NULL-vs-set is the named state discriminator.

- **CREATE TABLE body** at `server/db.js:1839-1843` gains the column.
- **Guarded ALTER, PRAGMA `table_info` idiom** (Slice 1 DEC-5 reconfirmed; do NOT use
  the deprecated try/`SELECT … LIMIT 1`/catch probe). Live precedents to copy:
  `db.js:1023` (`detourDispositionsColumns`) and `db.js:1466/1484/1503`
  (`color_thresholds`), the latter citing §9.5 in its own comment at `db.js:1495`.
- **`UPGRADE_CASES` entry** in `server/__tests__/db-migration.test.js` (registry at
  line 56; line 25 is the binding instruction: "New columns must have an UPGRADE_CASES
  entry"). Legacy-shape seed, migrate, column exists, legacy row reads NULL, writable,
  second run no-op. **No new `GRANDFATHERED` entries** (Slice 1 DEC-5).

**Statement changes** (the sweep-state family, currently `db.js:3258-3293`):

- `listValueSweepTargets` (`db.js:3264-3271`) — widen ORDER BY so requested projects
  jump the rotation, and SELECT the flag so the tick can branch on it:
  `ORDER BY (s.coverage_requested_at IS NULL) ASC, s.coverage_requested_at ASC,
  (s.last_swept_at IS NOT NULL) ASC, s.last_swept_at ASC, p.id ASC LIMIT ?`.
  Ordering semantics probed live (§2, probe B): requested-first, then never-swept,
  then oldest-swept — passive behavior for unflagged projects is byte-identical.
- **New** `requestValueCoverage`: `INSERT INTO value_summary_sweep_state (project_id,
  coverage_requested_at) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET
  coverage_requested_at = excluded.coverage_requested_at`.
- **New** `clearValueCoverageRequest`: `UPDATE value_summary_sweep_state SET
  coverage_requested_at = NULL WHERE project_id = ?`.
- **New** `listRecentValueGenerationDurations` (the ETA's only input): e.g.
  `SELECT duration_ms, generated FROM value_summary_generation_log WHERE outcome = 'ok'
  AND generated > 0 AND duration_ms IS NOT NULL ORDER BY created_at DESC, id DESC
  LIMIT ?` — §9.2-compliant by construction (real-timestamp sort **before** the LIMIT,
  `id` tiebreak); `db.js` is a scanned file in `chronology-ordering.test.js`, so a
  non-compliant form fails the suite. The `(project_id, created_at)` index at
  `db.js:1861-1862` already serves a per-project variant if the ETA formula goes
  per-project (open point B; recommendation in §3.2).
- **No change needed** to `upsertValueSweepState` / `upsertValueSweepStateKeepPending`
  (`db.js:3272-3288`): their `DO UPDATE SET` arms list only
  `last_swept_at`/`pending_after_sweep`, so the flag survives a sweep upsert —
  **proven live** (§2, probe A), not assumed.

### 1.2 `server/lib/value-summary-tick.js` — priority drain

All inside `runValueSummaryTickOnce` (`lines 79-191`); the scheduler
(`startValueSummaryTick`, 197-214) is untouched.

- Per-target: if `target.coverage_requested_at` is set, replace the single
  `enrichPoolAltitudes` call (line 111) with a **bounded in-process drain loop**
  (stated assumption A, option ii): re-call `enrichPoolAltitudes(dbModule, units)` with
  the **full unit list** each iteration (cache hits are cheap reads; passing the full
  list keeps every iteration's four-term log partition
  `cache_hits + generated + queued + unavailable === pool_size` true by construction —
  passing only the remaining misses would break the unconditional partition assertion
  in `value-summary-tick.test.js`). Loop exit conditions, all three required:
  1. `queued === 0` in the returned states (nothing left un-attempted);
  2. **no-progress guard**: an iteration with `generated === 0` exits the loop
     (LLM outage marks everything `unavailable` and never `queued`, so condition 1
     already catches outage — this guard catches the parse-failure/garbled-output loop
     where misses stay `queued`-eligible forever);
  3. a hard iteration cap (`ceil(pool/40) + small slack`) as belt.
- **One `insertValueSummaryGeneration` row per iteration**, `source='tick'` — see
  gotcha G2 for why it must NOT be a new enum value.
- **Flag clearing:** on a successful drain reaching `queued === 0 && unavailable === 0`
  (true 100%), call `clearValueCoverageRequest`. On a no-progress exit, leave the flag
  set (next tick retries; per-tick cost stays bounded). Re-derive, never decrement
  (WATCH-8) — the clear decision reads *this* iteration's counts, no stored counter.
- **Broadcast per iteration** (this is where the WS payload actually lives — note:
  the run-plan names `server/index.js`, but the composition is at
  `value-summary-tick.js:170-176`; `index.js:466-467` only threads `broadcast` in and
  needs **zero code change**). Widen the payload additively:
  `{ project_id, unit_keys, pending, coverage: <shared object> }` where
  `<shared object>` is the single server-side computation (§1.3). No subscriber exists
  yet on `55fe900`'s state **[S1-dep: Slice 1 plans none either]**, so widening is
  backward-compatible by construction — this is the cheapest moment.

### 1.3 One shared coverage/ETA computation (§9.1 single home)

New exported function — recommended home `server/lib/value-summary.js` (it already owns
`readCached` and, post-Slice-1, the freshness verdict):

- `computeCoverage(dbModule, units)` → `{ described, pool_size, pending }` — walks the
  units through the same cache/freshness read `enrichPoolAltitudes` uses. **[S1-dep]**
  "described" must mean *fresh-or-immutable* under Slice 1's digest gating (stated
  assumption C) — with Slice 1 unbuilt this distinction does not exist yet, which is
  the concrete reason Slice 2 cannot build first.
- `computeCoverageEta(dbModule, pending)` → discriminated object, e.g.
  `{ state: "measured", seconds }` | `{ state: "estimating" }` (§9.8: cold-start with
  zero qualifying log rows is a **named state**, never `~0 min`). Reads only
  `listRecentValueGenerationDurations`.
- Both consumed by exactly two call sites: the new GET route and the tick's broadcast.
  The client renders, never re-derives (no raw log rows on the wire).
- Gotcha: any new export from `value-summary.js` trips the `assertSingleHome`
  disposition test (§1.6) — by design; update dispositions in the same commit.

### 1.4 `server/lib/value-summary.js` — `summaryModel()` per-stage knob

Current chain at lines 63-70:
`DASHBOARD_VALUE_SUMMARY_MODEL → DASHBOARD_FOCUS_SUMMARY_MODEL →
DASHBOARD_FOCUS_INFER_MODEL → "haiku"`. Extension, not a fork:

- `summaryModel(stage)` with an exported registry (e.g.
  `SUMMARY_STAGES = ["unit", "grouping"]`). Per stage, **prepend** one env var to the
  existing chain: `DASHBOARD_VALUE_SUMMARY_UNIT_MODEL` /
  `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL`, each falling through to
  `DASHBOARD_VALUE_SUMMARY_MODEL` and the rest of today's chain unchanged. Per-stage
  hard default set by the calibration outcome (working hypothesis: unit=haiku,
  grouping=sonnet; note the *shipped* terminal default today is already `"haiku"` —
  Sara's measured sonnet batches came from env config, so "calibration decides the
  default" is a real decision, not a formality).
- Call site: `enrichPoolAltitudes` line 216 → `summaryModel("unit")`. The `grouping`
  stage has **no caller in this slice** — it exists as Slice 3's named seam; export it
  now, consume it never (document that in the JSDoc so §9.3 reviewers don't flag a
  dead export as vacuous — it's a deliberate forward contract).
- Existing test coverage: `value-summary.test.js:251-252` pins
  `DASHBOARD_VALUE_SUMMARY_MODEL` behavior — extend with a per-stage precedence table
  rather than replacing.

### 1.5 `server/routes/project-plans.js` — two new endpoints

File is currently 401 lines; both land in the literal-segment block (before the
`/:id(\d+)` routes for convention; the digit constraint means no actual shadowing) and
the header comment's segment list (lines 12-14) must be updated.

- `POST /api/project-plans/coverage-request` `{project_id}` → runs
  `requestValueCoverage(projectId, nowIso)`, then fire-and-forget
  `runValueSummaryTickOnce(dbModule, { broadcast }).catch(() => {})` for
  responsiveness — safe because the tick's module-scope overlap guard
  (`value-summary-tick.js:49,81`) returns `{skipped:"overlap"}` instead of
  double-running (this is why "prioritize now" doesn't need its own drain
  implementation — WATCH-6 stays narrow). Responds with the shared coverage object.
- `GET /api/project-plans/coverage?project_id=` → `assembleValuePool` (sole composer,
  DEC-16 — the denominator M comes from here and nowhere else) →
  `computeCoverage` + `computeCoverageEta` → one JSON object, byte-same shape as the
  WS payload's `coverage` key (§9.1 parity target).
- **Writer-guard impact:** the route gains a write to `value_summary_sweep_state`
  (`requestValueCoverage`) — that table has **no** single-writer structural guard
  today (only `upsertValueUnitSummary` and `insertValueSummaryGeneration` are guarded,
  `single-writer-guard.test.js:217-265`), and Slice 2 adds **no** new caller of either
  guarded statement: the drain loop invokes `enrichPoolAltitudes` (the one writer,
  unchanged) and logs from inside `value-summary-tick.js` (already the guarded file).
  So **WATCH-6 widening is needed only for whatever Slice 1's DEC-4 already did**
  (request-path logging adds `project-plans.js` to the `insertValueSummaryGeneration`
  file set — `single-writer-guard.test.js:263-264` even carries a comment announcing
  that widening). Slice 2 must build on that widened state and not re-widen.

### 1.6 Guard/test files that must move in the same commits

- `server/__tests__/single-writer-guard.test.js:267-289` — `assertSingleHome`
  dispositions for `value-summary.js` exports: every new export (`computeCoverage`,
  `computeCoverageEta`, `SUMMARY_STAGES`) needs an explicit `shared`/`absent` row per
  consumer, or the suite fails on scope. That failure is the guard working.
- `server/__tests__/chronology-ordering.test.js` — `value-summary.js` /
  `value-summary-tick.js` are `"scanned"` (lines 150-151) and `db.js` is scanned; new
  LIMITed queries are inside the scan automatically. No disposition changes expected
  if the ETA query is written per §1.1.
- `server/__tests__/db-migration.test.js` — the `UPGRADE_CASES` entry (§1.1).
- `server/__tests__/value-summary-tick.test.js` (769 lines) — extend: priority
  ordering (requested beats never-swept beats stale), drain-loop iteration/exit
  matrix (100% reached / outage / no-progress / pool grows mid-drain per WATCH-8),
  flag persistence across the plain upsert, flag cleared only at true 100%,
  per-iteration log rows each satisfying the four-term partition, broadcast payload
  parity with the route object.

### 1.7 Client

- `client/src/lib/api.ts` — `projectPlans.coverage(projectId)` and
  `projectPlans.requestCoverage(projectId)`; the coverage object type once.
- `client/src/lib/types.ts` — `value_altitudes_updated` is already a registered
  `WSMessage` type with `ValueAltitudesUpdatedPayload` (`types.ts:3017`, `:2746` — the
  payload doc at `:2987` literally says "no subscriber"); widen the payload type with
  the optional `coverage` field and the discriminated ETA union
  (`"measured" | "estimating"` — WATCH-E/F: this is a new hand-typed registry at the
  CJS/Vite boundary; carry the canonical-source doc comment per the
  `TrunkDriftResult["skipped"]` precedent).
- `client/src/components/PlanLedgerPanel.tsx` — coverage header ("N of M described ·
  ~X min remaining" / "estimating"), disabled Auto-group button scaffold (stated
  assumption D) with tooltip + "prioritize now", and the panel's **first** `eventBus`
  subscription: `useEffect` + `eventBus.subscribe`, filter
  `msg.type === "value_altitudes_updated" && msg.data.project_id === projectId`, merge
  the server-computed `coverage` object into state. Live precedent for the exact
  pattern: `client/src/lib/colorThresholds.ts:105` and `focusStore.ts` (handlers
  try/catch-wrapped — the bus has no error isolation, per `eventBus.ts`'s own doc).
- Four locale files `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — new
  `planLedger.pool.coverage.*` keys in all four in the same commit (i18n parity test).

### 1.8 Calibration (artifact, not product code)

One real 40-unit batch through `buildPrompt` + `runClaudePromptJson` (both exported:
`value-summary.js:247-254`, `focus-inference.js`) twice — `{model:"haiku"}` and
`{model:"sonnet"}` — from a throwaway script (scratchpad, not committed product code).
Durable outputs: the side-by-side artifact attached to a DECIDED-AUTO row + the chosen
per-stage defaults in §1.4. **Unverified until run:** actual quality difference —
that's the point of measuring.

---

## 2. Mechanism verification (live probes, not memory)

- **Probe A — upsert preserves unlisted columns.** Ran the server's own
  `better-sqlite3` against an in-memory table with the exact upsert shape: a row with
  `coverage_requested_at` set, then the tick's `ON CONFLICT … DO UPDATE SET
  last_swept_at…, pending…` — flag survived (`coverage_requested_at:
  '2026-08-05T01:00:00Z'` after the sweep upsert). The existing sweep upserts need no
  change and cannot clobber a pending request.
- **Probe B — priority ORDER BY.** Same probe: `ORDER BY (coverage_requested_at IS
  NULL) ASC, coverage_requested_at ASC, (last_swept_at IS NOT NULL) ASC,
  last_swept_at ASC, …` returned `[requested, never-swept, oldest-swept]` — requested
  projects jump the rotation, passive order preserved behind them.
- **Git state** (§0): all claims from live `git` commands (`rev-list --left-right`,
  `merge-base --is-ancestor`, `diff 55fe900 --name-only`), not from the decisions docs.
- **`CHECK` cannot be widened in place / PRAGMA idiom**: not re-probed — but not from
  memory either: `db.js:1832-1835` documents the pre-paid `'request'` enum for exactly
  this reason, and the PRAGMA idiom is live shipped code at `db.js:1017-1023`.
- **Unverified, flagged:** haiku-vs-sonnet quality (the calibration exists to measure
  it); Slice 1's final built shapes (DEC-13/DEC-14 are plan-stage — §1's [S1-dep]
  markers must be re-checked against Slice 1's actual landed code).

---

## 3. Feasibility & gotchas

Feasible, and smaller than the run-plan's framing suggests **on the server** — the
rotation/drain mechanics compose from existing seams (overlap guard, sole composer,
per-project fail-safe). The traps:

- **G1 — Rotation starvation by a permanently-failing requested project.** A flagged
  project sorts first every tick forever if it can never reach 100% (broken repo root
  → `assembleValuePool` throws; or every unit `unavailable`). The per-project
  fail-safe advances `last_swept_at` but the *flag* keeps it at the head of the queue,
  consuming 1 of `MAX_PROJECTS_PER_TICK=3` slots indefinitely and — worse — its
  fire-and-forget drain loop burns LLM spawns each tick. Mitigations in-slice: the
  no-progress exit bounds each tick; recommend also an expiry (treat
  `coverage_requested_at` older than ~24h as passive, or clear-with-log on an
  `outcome='error'` sweep). Needs one decision row; don't leave it to the implementer.
- **G2 — Do NOT add a `source` enum value for drain/coverage rows.**
  `value_summary_generation_log.source CHECK(source IN ('tick','request'))`
  (`db.js:1848`). A third value (`'coverage'`) is a §9.6 full-table rebuild — the
  schema comment at `db.js:1832-1835` records that `'request'` was pre-paid precisely
  to avoid this. Drain iterations log as `'tick'`; if drain rows must be
  distinguishable in the audit trail, that's an argument to have (they're identifiable
  anyway: same project, same tick window, multiple rows) — not a CHECK change.
- **G3 — Per-iteration partition math.** The four-term identity is asserted
  unconditionally; the drain loop must pass the **full unit list** each iteration
  (§1.2) or every iteration-2+ log row violates
  `cache_hits + generated + queued + unavailable === pool_size`. WATCH-A adjacency:
  do not "fix" a red partition by adding a term.
- **G4 — ETA cold-start and honesty (§9.8).** Zero qualifying log rows ⇒
  `{state:"estimating"}`, a named wire state with its own locale string — never `~0
  min`, never a hardcoded guess. Also exclude `outcome='error'` and `generated=0` rows
  from the average (a 2ms all-cache-hit sweep would crater the estimate toward zero,
  which reads as a guess in the wrong direction).
- **G5 — WS/HTTP payload parity (§9.1, consumer #2 on day one).** One object, computed
  once (§1.3), carried verbatim by both. The cross-consumer parity assertion belongs
  in `value-summary-tick.test.js` (broadcast side) against the route's response for
  the same seeded DB — per-module specs will not cover it (the catalog's own
  "per-shape spec has no home" history; give it a named case, not an aspiration).
- **G6 — The `assertSingleHome` disposition lists** (§1.6) will go red on every new
  `value-summary.js` export. Budget for updating them in the same commit; that red is
  the §9.7 cure working, not a test bug.
- **G7 — Snapshot tests.** The coverage header + disabled button change
  `screens.snapshot.test.tsx` baselines; regenerate deliberately with a reviewed diff
  (`cd client && npx vitest run -u`), never blindly.
- **G8 — File headers.** Every touched `.js/.ts/.tsx` keeps/gains the mandated header
  (`bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0).

## 4. Effort estimate

| Component | Size | Why |
|---|---|---|
| Schema + statements + UPGRADE_CASES (§1.1) | **S** | Three-part §9.5 landing with live in-file precedents to copy |
| Tick priority drain (§1.2) | **M** | The exit-condition matrix + starvation policy is the real design work; tests dominate |
| Shared coverage/ETA fn + 2 routes (§1.3/1.5) | **S–M** | Thin composition over existing seams; parity test is the cost |
| `summaryModel(stage)` (§1.4) | **S** | Prepend-to-chain + registry + disposition updates |
| Client header/gate/subscriber/i18n (§1.7) | **M** | First subscriber on this panel, 4 locales, snapshots |
| Calibration (§1.8) | **S** | Mostly wall-clock + judgment |
| **Overall** | **M** | A focused multi-day slice — *after* the §0 sequencing (git reconcile + Slice 1 build) which is its own, larger, predecessor cost |

## 5. Dependencies & order

1. **Git reconciliation** (§0.4) — before any build branch; with the concurrent-session
   check (§0.5).
2. **Slice 1 build lands** (its own effort branch) — Slice 2's "described" semantics
   (assumption C), the DEC-14 `counts` shape, and the DEC-4 guard widening are all
   inputs here, and none exist yet.
3. Schema first (§1.1: column + ALTER + UPGRADE_CASES in one commit) — downstream
   statements and the tick read the column.
4. Shared coverage/ETA computation (§1.3) **before** route and tick consume it (the
   §9.1 order: one home exists before consumer #2).
5. Tick drain + broadcast widening (§1.2), then routes (§1.5), then client (§1.7) —
   the client's registry copies (WATCH-E/F) land in the same commit as the wire change.
6. `summaryModel(stage)` + calibration are independent of 3-5; calibration must
   complete **before** the per-stage defaults are pinned (acceptance signal 6).

## 6. Verification hooks (existing specs that would catch a mistake)

- `server/__tests__/value-summary-tick.test.js` — rotation order, overlap guard,
  four-term partition, WATCH-8 re-derive, broadcast shape (the direct extension site).
- `server/__tests__/value-summary.test.js` — DEC-11 partition truth table, model env
  pinning (`:251-252`), `enrichPoolAltitudes` contract.
- `server/__tests__/single-writer-guard.test.js:217-289` — writer file sets +
  `assertSingleHome` export dispositions.
- `server/__tests__/chronology-ordering.test.js` — §9.2 static scan; `db.js` and both
  value-summary libs are `"scanned"` dispositions.
- `server/__tests__/db-migration.test.js` — `UPGRADE_CASES` registry (meta-test rejects
  a column with no entry).
- `server/__tests__/ledger-metrics-parity.test.js` — cross-consumer precedent shape for
  the new WS/HTTP parity case (G5).
- Client: `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (altitude states
  render cases), `client/src/i18n/__tests__/i18n.test.ts` (locale key parity),
  `client/src/pages/__tests__/screens.snapshot.test.tsx` (G7).
- Runners: `npm run test:server`, `npm run test:client`. §9.3 standing rule applies to
  every new guard: recorded red against a real mutation, restored byte-identical —
  under DEC-F2 (QA deferred) this discipline is the *only* gate.
