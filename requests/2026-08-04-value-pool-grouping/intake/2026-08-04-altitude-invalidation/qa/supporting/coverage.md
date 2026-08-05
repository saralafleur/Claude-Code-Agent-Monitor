# Coverage Map — 2026-08-04-altitude-invalidation (Slice 1)

> Coverage Cartographer output. Maps what is *already* tested on the touched
> surfaces at the real substrate, and the green/red baseline actually observed.

- **Substrate:** `origin/master` @ `55fe900`, verified in a clean detached scratch
  worktree (`git worktree add --detach <scratchpad>/qa-baseline 55fe900`), never
  the dirty main checkout (`d830a44` + 45-entry dirty tree). Dependencies were
  symlinked from the main checkout after verifying the `dependencies`/
  `devDependencies` sections of root and client `package.json` are byte-identical
  between `55fe900` and the main checkout. Every server test run set
  `DASHBOARD_DB_PATH` to a scratch path; the live
  `~/.claude/agent-dashboard/dashboard.db` was never touched. The scratch
  worktree was removed after the runs.
- **Test layers discovered** (no PROJECT-CONTEXT-configured stack section;
  discovered from `package.json`): (1) server unit/integration —
  `node --test server/__tests__/*.test.js` (`npm run test:server`), which also
  hosts the project's structural-guard bucket (`single-writer-guard.test.js`,
  `chronology-ordering.test.js`, the `db-migration.test.js` meta-tests);
  (2) client component/unit — vitest (`npm run test:client`), including
  per-screen snapshots (`client/src/pages/__tests__/screens.snapshot.test.tsx`)
  and the i18n locale-parity suite (`client/src/i18n/__tests__/i18n.test.ts`);
  (3) MCP typecheck (`npm run mcp:typecheck`) — not relevant to this slice.
  There is no e2e layer and no tag/project convention; the guard specs are the
  de-facto "regression registry" bucket.

---

## 1. Current baseline (actually run, at `55fe900`)

Server (`DASHBOARD_DB_PATH=<scratch>/db-<spec>.sqlite node --test server/__tests__/<spec>.test.js`):

| Spec | Result |
|---|---|
| `server/__tests__/value-summary.test.js` | **25/25 pass** (7 suites) |
| `server/__tests__/value-summary-tick.test.js` | **21/21 pass** (14 suites) |
| `server/__tests__/single-writer-guard.test.js` | **10/10 pass** |
| `server/__tests__/db-migration.test.js` | **22/22 pass** |
| `server/__tests__/focus-summary.test.js` | **21/21 pass** (read-only precedent) |
| `server/__tests__/chronology-ordering.test.js` | **6/6 pass** |

Client (`cd client && npx vitest run <specs>`):

| Spec | Result |
|---|---|
| `client/src/components/__tests__/PlanLedgerPanel.test.tsx` | **14/14 pass** |
| `client/src/pages/__tests__/screens.snapshot.test.tsx` | **19/19 pass** |
| `client/src/i18n/__tests__/i18n.test.ts` | **76/76 pass** |

Everything relevant is **green**. Note one bookkeeping discrepancy against the
plan's Step 1 record: the plan says "77/77 server across the four specs"; the
observed sum of the four core specs is 25+21+10+22 = **78**. Trust the per-file
numbers above (recorded from actual runs), not the blanket 77.

Also observed: `value-summary.test.js` has **25** tests (change brief estimated
~30) and `value-summary-tick.test.js` has **21** (brief said 17+).

---

## 2. Existing coverage by surface

### 2a. Altitude synthesis — `server/lib/value-summary.js`

Covered by `server/__tests__/value-summary.test.js` (25 tests):
- `parseOutput` ×4 (lines 131-175) — untouched by this change.
- `buildPrompt` ×1 (177-193) — asserts source/label/stage rendering for a
  `trunk_commit` and an `intake_initiative` unit. The `unitFacts()` refactor must
  keep this rendering byte-identical; both fixture units carry explicit labels so
  the `"(untitled)"` fallback is currently **unasserted**.
- `enrichPoolAltitudes` caching ×5 (194-292) — generate-once/serve-cache, batch
  into one spawn, model override, empty batch, non-llm/probe-fail/garbage.
- Concurrency T-A ×1 (294-350) — two overlapping invokers, one valid row.
- DEC-11 truth table Cases 1-6 ×6 (351-484) — cap/LLM-off/parse-fail partitions,
  Case 5 mutual exclusivity, Case 6 `ALTITUDE_STATES` imported-not-hand-typed.
- `POST /api/project-plans/altitudes` ×7 (486-693) — validation, happy path,
  S2/S4 sanitization, Case A 45-unit batch, Case B LLM-off, LLM-off 200.
- Server-side i18n registry→locale ×1 (695-711) — every `ALTITUDE_STATES` member
  has an `en` `planLedger.pool.altitudes.*` key.

`readCached` is **internal (unexported)** — no test calls it directly
(verified by grep); its signature change is invisible to the suite. Every
cache-exercising fixture uses the default `trunk_commit` unit
(`unit()` helper, lines 97-106), which is the **immutable arm** of the new
design ("today's behavior byte-for-byte"), so input-gating alone should leave
all 25 green except the two shape-pinned tests in §5 below.

### 2b. Value taxonomy — `server/lib/value-ledger.js`

- `server/__tests__/value-ledger.test.js` — pool assembly, `VALUE_SOURCES`,
  claims (`seen_at_snapshot` there is `value_claims`, unrelated to the new
  `value_unit_summaries.seen_at`).
- `single-writer-guard.test.js:292` — export-disposition guard on
  `value-ledger.js` at its tick consumer.

### 2c. Background sweep — `server/lib/value-summary-tick.js`

Covered by `server/__tests__/value-summary-tick.test.js` (21 tests): overlap
guard, `MAX_PROJECTS_PER_TICK` bound, LRS rotation, AC-1 drain pair (231/254/281),
broadcast discipline ×3, failure isolation, DEC-16 structural scan (386-417:
tick imports `assembleValuePool`, contains **no** `upsertValueUnitSummary`
reference — stays valid when the tick reads `counts`), env wiring ×3, T-C
`pending_after_sweep` re-derivation (499), B2 errored-sweep ×2, S1 rotation-
advance, S6 dup-dedupe, AC-1 flow proof, AC-2 four-term log identity (754).
**All tick fixtures are `trunk_commit` units** (helper at 38-61) — immutable
under the new design, so existing numbers must not move.

### 2d. Request fast lane — `server/routes/project-plans.js` `POST /altitudes`

Covered by the 7 route tests inside `value-summary.test.js` (486-693). The route
currently returns a literal `{ altitudes, states }` (`project-plans.js:173`) —
`counts` stays composer-internal, so route response shape is unchanged.
**No test asserts the absence of a generation-log row on the request path** (the
absence is simply untested), so adding the `source='request'` log write breaks
no route test — only the guard at `single-writer-guard.test.js:259` (by design).
`POST /altitudes/seen` is **net-new**: zero coverage, zero collisions.

### 2e. SQLite schema — `server/db.js`

- `server/__tests__/db-migration.test.js` (22 tests): `UPGRADE_CASES` pattern —
  the named precedent `detour_dispositions.project_id` at 137-160 with its test
  pair at 710-820 (legacy ALTER + idempotence); the **migration meta-test at
  1414-1451** scans db.js for every `ALTER TABLE … ADD COLUMN` and requires a
  `table.column` entry in `UPGRADE_CASES` or `GRANDFATHERED`.
- `chronology-ordering.test.js` — db.js is `FILE_DISPOSITIONS`-"scanned"; the
  scan only matches template literals beginning `SELECT` with `LIMIT` (297), so
  the PRAGMA idiom adds nothing to scan — plan's "no change expected" verified
  against the scanner's actual regex.
- **The false schema comment at `db.js:821-825`** ("immutable once seen …
  generated once, served forever" — verified present at `55fe900`, CREATE body
  826-832): **no test anywhere asserts this comment's text** (grep for "served
  forever"/"immutable once seen"/"generated once" across all test trees: zero
  hits). The comment is UNGUARDED documentation; its rewrite causes zero churn.
- **`input_stage` / `input_label` are confirmed net-new**: zero occurrences of
  `input_stage|input_label|stale_regenerated|regen_reason|regenerated_at|`
  `MUTABLE_VALUE_SOURCES|ALTITUDE_FRESHNESS|unitFacts|compareUnitInputs|`
  `markValueUnitSummariesSeen` anywhere in `server/` or `client/src/` at
  `55fe900` (the `seen_at` grep hits are `detour_dispositions.source_seen_at`
  and `value_claims.seen_at_snapshot` — different tables). Nothing reads them;
  nothing tests them.

### 2f. Client — `PlanLedgerPanel.tsx` + locales

`client/src/components/__tests__/PlanLedgerPanel.test.tsx` (14 tests). The six
altitude cases (lines 370, 411, 428, 451, 477, 497) all build altitude fixtures
as plain `{ project, stakeholder, … }` entries **with no freshness fields**:
- 370 generating→resolved placeholder; 411 missing-unit unavailable;
  428 requests-exactly-once; 451 queued/unavailable distinguishable in the same
  render (T-D); 477 45-unavailable distinct from queued (T-B); 497 T-E
  out-of-registry `states` value warns.
These stay valid **iff** the marker/dismiss UI renders nothing when `freshness`
is absent (the plan's design). `screens.snapshot.test.tsx` renders Project
Detail incl. the PlanLedgerPanel card (line 531) — snapshot churn only if any
new control renders unconditionally. `i18n.test.ts` (76 tests) derives locale
parity from `en`, so the six new keys are automatically parity-checked across
ko/vi/zh once added to `en`.

---

## 3. Coverage verdicts per surface

| Surface | Verdict | Notes |
|---|---|---|
| Altitude synthesis (batch/cap/partition/cache-hit path) | **GUARDED** | 25 tests incl. partition truth table and T-A concurrency |
| Altitude synthesis — mutability/invalidation behavior | **UNGUARDED** | net-new; no test mutates a unit's stage/label between reads; every cache fixture is immutable `trunk_commit` |
| `buildPrompt` input-set integrity | **PARTIAL** | rendering asserted (1 test); *which fields it may read* is unguarded until the DEC-15 structural scan lands; `"(untitled)"` fallback unasserted |
| Value taxonomy (`VALUE_SOURCES`, pool assembly) | **GUARDED** | `value-ledger.test.js` + export-disposition guard |
| Background sweep (scheduler/rotation/partition/broadcast) | **GUARDED** | 21 tests; four-term identity asserted at 3 sites (AC-1, AC-2, T-C) |
| `POST /altitudes` route behavior | **GUARDED** | 7 tests; request-path log **absence** untested (safe to add) |
| `POST /altitudes/seen` | **UNGUARDED** | endpoint does not exist |
| Schema comment `db.js:821-825` | **UNGUARDED** | no test pins comment text; rewrite is churn-free |
| 6 new columns / migrations | **UNGUARDED today, meta-test-forced** | the 1414 meta-test will go red on unregistered ALTERs — see §4 gap |
| PlanLedgerPanel current altitude rendering | **GUARDED** | 6 altitude tests + snapshot |
| Marker/acknowledge UI | **UNGUARDED** | net-new (C1-C3 are planned, not existing) |
| i18n keys (4 locales) | **GUARDED-by-mechanism** | `i18n.test.ts` derives parity from `en`; server registry→locale test covers `ALTITUDE_STATES` only |

## 4. Registry/consistency gap check

The canonical registry on this surface is `ALTITUDE_STATES`
(`value-summary.js:47`, server home) with three client hand-copies (§9.7
accepted exception: `PlanLedgerPanel.tsx:321` union, `:558` hand-typed list,
`api.ts` ~2715 `Record` arm). Every current member has assertions: Case 6
(imported-not-hand-typed), the server registry→locale test, and client T-D/T-E.
**No gap today.**

Two gaps arrive with the change:

1. **`ALTITUDE_FRESHNESS` is born uncovered.** It will be a fourth hand-copied
   registry (server export → `Altitude` union arm → `api.ts` entry type → i18n
   key set, WATCH-F "must move in the same commit"). No existing mechanism
   covers it: Case 6 covers `ALTITUDE_STATES` only, and the server
   registry→locale test iterates `ALTITUDE_STATES` only. Until Case 6 + the
   registry→locale test are extended, a freshness string could ship with no
   locale copy and no import guard. This is the project's §9.1
   DERIVED-DUAL-VIEW / §9.7 class, on the exact surface that is its live
   instance.
2. **The migration meta-test demands more than the plan's two entries.** The
   meta-test (`db-migration.test.js:1414-1451`) builds its covered-set from
   *one `table.column` string per `UPGRADE_CASES` entry* and will find **six**
   new `ALTER TABLE … ADD COLUMN` pairs (`value_unit_summaries.{input_stage,
   input_label,regenerated_at,regen_reason,seen_at}` +
   `value_summary_generation_log.stale_regenerated`). The plan names two
   entries (M1 on `input_label`, M2 on `stale_regenerated`) and forbids new
   `GRANDFATHERED` rows — as written, the meta-test stays **red** for the other
   four columns. The build must register all six (sibling columns can share
   `legacySql`/fixtures, but each needs its own covered-set entry) or
   restructure the case shape. This is a mechanically-forced red the plan does
   not name.

## 5. Mechanical test-update inventory (existing tests only)

**`value-summary.test.js` — 2 of 25 break mechanically when `enrichPoolAltitudes`
returns `{altitudes, states, counts}`** (the file uses `node:assert/strict`, so
`deepEqual` rejects the extra key):
- "returns an empty map for an empty batch…" (195-200; `deepEqual` at 199
  against `{ altitudes: {}, states: {} }`).
- "leaves a unit out of the result for a non-llm mode, a failed probe, and
  unparsable output" (269-292; three full-return `deepEqual`s at 272/280/287).
The other 23 destructure `{ altitudes, states }` or assert per-property →
untouched by the return-shape change. The route tests are safe because the
route's response literal doesn't forward `counts`. `readCached` gating touches
no existing test directly (unexported; all cache fixtures immutable).

**`value-summary-tick.test.js` — 0 of 21 break mechanically.** The log row is
fetched via `SELECT *` (helper at 103) but every assertion is per-property
(`pool_size`/`cache_hits`/four-term sum at 241-249, 268-276, 509-533, 754-766) —
a new `stale_regenerated` key on the row object trips nothing. S1's spy wraps
`insertValueSummaryGeneration.run` with `(...args)` (629-643) — arity-agnostic.
Caveat: these 21 are the **behavioral guard** on DEC-14's counting-loop
replacement — if `counts` doesn't reproduce today's numbers exactly for all-
immutable pools, AC-1/AC-2/T-C/S6/broadcast tests go red *genuinely*, not
mechanically. Do not "fix" them; fix the composer.

**`single-writer-guard.test.js` — 3 of 10 change, with OPPOSITE expectations:**
- Line 259 "insertValueSummaryGeneration has exactly one production call site
  (tick)" — **goes red deliberately** when the route gains the log write; widen
  `deepEqual` to `["db.js", "project-plans.js", "value-summary-tick.js"]` in the
  same commit. Its own comment (263-264) pre-announces this (prior-effort
  WATCH-6). Observe the red before widening.
- Line 267 value-summary export-disposition — **breaks on any new export**:
  the helper (`helpers/single-home.js:68,83-89`) derives scope from
  `Object.keys(require(module))` and fails any export without a disposition. So
  `ALTITUDE_FRESHNESS` (and `unitFacts`/`compareUnitInputs` if exported for A1
  testing) must be dispositioned in **both** consumer blocks (route + tick).
- Line 292 value-ledger export-disposition — same mechanism; breaks the moment
  `MUTABLE_VALUE_SOURCES` is exported; add to the tick's `absent` list.
- Line 217 (upsert file-set) and **line 223 (exactly-one
  `upsertValueUnitSummary.run(` — must STAY at 1 and stay green**; if it goes
  red the design was violated, do not widen. Trap verified in source: the
  scanner at 226-232 strips only `//` comments, so a rewritten
  `value-summary.js` JSDoc containing the literal `upsertValueUnitSummary.run(`
  counts as a call site (this bit the parent build).
- The remaining 5 (plan-writeback/`__testonly` guards) — untouched.

**`db-migration.test.js` — 0 of 22 break from the code alone; 1 goes red on
under-registration** (the 1414 meta-test, see §4 gap 2). Existing
`UPGRADE_CASES`/`REBUILD_CASES` tests are untouched; no new `GRANDFATHERED` or
`REBUILD_CASES` entries needed (no CHECK is modified → no §9.6 rebuild).

**`PlanLedgerPanel.test.tsx` — 0 of 14 break** provided marker/dismiss UI is
conditional on `freshness` being present: all six altitude cases pass fixtures
without freshness fields, and absent-freshness = today's exact rendering
(DEC-3/R3). T-E (497) must be re-verified as still-out-of-registry after
`ALTITUDE_FRESHNESS` handling exists. C1-C3 are additions, not edits.

**Stay green, untouched (regression sentinels):** `focus-summary.test.js` 21/21
(the digest-gating precedent — `computeInputDigest` stability at 201-210,
regenerate-on-change at 251); `chronology-ordering.test.js` 6/6;
`screens.snapshot.test.tsx` 19/19 (baselines regenerated only after reviewing
the diff, and only if the marker UI intentionally changes the default render);
`i18n.test.ts` 76/76; `value-ledger.test.js`.

## 6. Conventions for new tests

- Server: one spec file per module in `server/__tests__/<module>.test.js`,
  `node --test`, `describe`/`it` from `node:test`, `node:assert/strict`.
  New synthesis/lifecycle tests (A1, D1-D6, parity, Case 5/6 extensions) belong
  in `value-summary.test.js`; sweep tests (L1-L3) in
  `value-summary-tick.test.js`; migration cases as `UPGRADE_CASES` entries in
  `db-migration.test.js` (precedent at 137-160); structural guards in
  `single-writer-guard.test.js` using `scanFiles` + `assertSingleHome`
  (`__tests__/helpers/single-home.js`).
- Naming carries invariant ids in the title ("(T-A)", "(AC-1…)", "§9.x", DEC
  ids) — keep that (e.g. "D3 …", "(DEC-7 parity)").
- Every server spec block that `require`s `../db` must set `DASHBOARD_DB_PATH`
  to a temp path (TEST-AGAINST-LIVE-DB candidate; migrations run at `require()`
  time against the live user-global DB otherwise).
- Client: component tests in `client/src/components/__tests__/*.test.tsx`
  (vitest + testing-library, `vi.mock` of `../lib/api`); i18n keys added to `en`
  first — `i18n.test.ts` derives the ko/vi/zh parity check mechanically.
