# Unit / Parity Test Design — plan-lifecycle-value-ledger

> Authored by `qa-unit-architect` (team-qa, 2026-08-02). **PRE-BUILD, red-first:**
> every server spec below fails today with `Cannot find module '../lib/…'` or a
> 404 on `/api/project-plans/*` — that is the recorded red state for module
> existence; the *per-case* red-first notes state the sharper mutation each case
> must be able to catch, per §9.3 (VACUOUS-GUARD).
>
> Frameworks (from `PROJECT-CONTEXT.md` / repo config): server = `node:test` +
> `node:assert/strict` in `server/__tests__/*.test.js`; client = vitest + RTL in
> `client/src/**/__tests__/*.test.tsx`. Naming convention inherited from the
> nine existing specs on this surface.

## Shared fixture kit (reuse, don't reinvent)

| Fixture | Source to copy verbatim | Used by |
|---|---|---|
| Tmp DB per suite: `DASHBOARD_DB_PATH` + `delete require.cache[require.resolve("../db")]` | `chronology-ordering.test.js:190-207` | T2, T4, T5 lib-level cases |
| Live HTTP app: `createApp()` + `startServer(app, 0)` + local `fetch`/`post` helper | `plans-api.test.js:23-93` | T2 route negatives, T3 `/pool` route cases, T6 |
| Real throwaway git repos: `ISOLATED_GIT_ENV`, `makeRepo`, `git()`, `fs.realpathSync(mkdtemp)` | `intake-scan.test.js:31-78` | T3, `cwd-identity.test.js`, T4 canonicalization |
| Scrambled `id` vs `created_at` ordering: `assertOrderedByCreatedAt` | `server/__tests__/helpers/ordering.js` via `chronology-ordering.test.js` | T3 chronology case |
| Structural source scan: `scanFiles(dir, pattern)` walking `server/**/*.js` excluding tests | `single-writer-guard.test.js:16-39` | T4 rogue-writer scan, T5 closure guard |
| CLI subprocess: async `spawn(process.execPath, [CLI, ...args])` against in-process server, `DASHBOARD_PORT` override | `ccam-cli.test.js:41-61` | T6 |
| Legacy-shape DB boot | `db-migration.test.js` `UPGRADE_CASES` harness (but **no** new `UPGRADE_CASES` entry — see T1) | T1 |
| Backdated commits for lookback windows | `git -c` env `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` on the fixture `git()` helper | T3 ratchet/backfill |

Canonical registries these tests must derive from (never hand-retype): the
exported `VALUE_SOURCES` / `ATTRIBUTION_TIERS` from `server/lib/value-ledger.js`
and the `CHECK(...)` text readable from `sqlite_master` — the same
export-mirrors-CHECK pattern as `DISPOSITIONS`.

---

## 1. `server/__tests__/db-migration.test.js` — T1 (extend) — slice 1

Scope per the tech lead's override: **no** `UPGRADE_CASES` entry, no
`REBUILD_CASES`, no interruption case. Add one new `describe("additive
portfolio-layer tables")`:

| Case | Assertions |
|---|---|
| legacy-shape DB boots and gains the three tables | Build a legacy DB containing only the pre-change schema (reuse the file's existing legacy `plans`/`plan_items` DDL + a seeded row); point `DASHBOARD_DB_PATH` at it; require `../db`. Assert `sqlite_master` now contains `project_plans`, `project_plan_items`, `value_claims` and the four indexes (`idx_project_plans_project`, `idx_project_plans_import`, `idx_value_claims_unit_item`, `idx_value_claims_plan`, `idx_value_claims_unit`). Assert the seeded legacy `plans`/`plan_items` rows are untouched (byte-compare before/after). |
| new tables are writable | `stmts.insertProjectPlan`, `insertProjectPlanItem`, `insertValueClaim` each succeed against the upgraded DB. |
| second boot is a no-op | Re-require `../db` (cache cleared); assert `sqlite_master` row count unchanged and table SQL text identical to first boot. |
| §9.5-stays-inapplicable guard | Static assertion on `server/db.js` source: within the diff region there is no new `ALTER TABLE` referencing the three new tables, and no `ALTER TABLE ... plan_items`/`plans` beyond the grandfathered/`UPGRADE_CASES` set. Cheapest form: assert the count of `/ALTER TABLE/` matches in `db.js` equals its pre-change count (record the number at authoring time, with a comment saying why). |

**Red-first:** on today's `db.js` the `sqlite_master` assertions fail (tables
absent). The no-op case guards against a future `DROP`+`CREATE` "cleanup":
mutating `CREATE TABLE IF NOT EXISTS` to `DROP TABLE IF EXISTS; CREATE TABLE`
must fail the second-boot byte-compare (claims would be wiped).

---

## 2. `server/__tests__/plan-lifecycle.test.js` — T2 (new) — slice 1

Two layers in one spec: lib-level (`require("../lib/plan-lifecycle")` +
tmp-DB `dbModule`) and route-level negatives (HTTP app fixture).

### Generation chain / derived ordinal
| Case | Assertions |
|---|---|
| `succeeds_plan_id` walk derives ordinals 1..3 | Create gen1 (`origin:'manual'`) → close → gen2 (`succeeds_plan_id: gen1.id`) → close → gen3 (`succeeds_plan_id: gen2.id`). `generationOrdinal(gen3, chain) === 3`, gen2 → 2, gen1 → 1. A plan with `succeeds_plan_id: null` and no successor → 1. |
| ordinal is derived, never stored | `PRAGMA table_info(project_plans)` column-name set contains **no** `ordinal`/`generation` column — assert exact column set equals the §3.1 DDL list. This is the schema-shape pin: a builder adding a stored ordinal (the drift path DEC-3 forbids) turns this red. |
| branching chain is not silently linearized | gen2a and gen2b both `succeeds_plan_id: gen1.id` (two successors are legal under DEC-P5); `generationOrdinal` returns 2 for both; no throw, no infinite walk. Also: a self-referencing `succeeds_plan_id` (seeded raw) must terminate with an error, not hang. |

### State machine
| Case | Assertions |
|---|---|
| open→closed happy path | `closePlan(dbModule, id, {closure_note:'shipped', now})` → row has `status:'closed'`, `closed_at` = injected `now` ISO, `closure_note:'shipped'`. Returns the closed plan. |
| close is the only door | `POST /api/project-plans/:id/close` → 200; `PATCH /api/project-plans/:id` with `{status:'closed'}` → 400 (status is not a patchable field); raw CHECK: `UPDATE project_plans SET status='wat'` throws (CHECK 2-state vocabulary). |
| closing a closed plan rejected | Second `closePlan` on same id → error; route → 409. `closed_at` unchanged after the failed second close (no re-stamp). |
| no reopen | No exported function and no route accepts `status:'open'` on a closed plan; `PATCH` title on a closed plan → 409 ("rename open only" per §3.3). |

### Closed-immutability negatives (I1 / DEC-P6 / R11)
For a closed plan with one item and one claim, each of these must be rejected
**and** leave row counts + row bytes unchanged (assert `SELECT * FROM
project_plans|project_plan_items|value_claims` snapshots identical before/after):
- `POST /:id/items` → 409; `PATCH /items/:itemId` → 409; `DELETE /items/:itemId` → 409
- `POST /:id/claims` → 409
- `DELETE /claims/:claimId` (unclaim) → 409 — the plan-is-closed rejection named in §3.3
- No plan delete exists: `DELETE /api/project-plans/:id` → 404/405; **and** structural assertion (scanFiles pattern) that no production file under `server/` contains `/DELETE\s+FROM\s+project_plans/i` and `stmts` has no `deleteProjectPlan` key.

### Claims carry no closed state — schema + write-shape (§9.1 write-sequence form)
| Case | Assertions |
|---|---|
| `value_claims` schema shape | `PRAGMA table_info(value_claims)` name-set exactly equals `{id, project_id, plan_id, item_id, value_source, value_ref, source_cwd, label_snapshot, seen_at_snapshot, stage_snapshot, attribution, claimed_by, claimed_at}` — asserting **absence of `closed_at`/`closed`/`status`** by asserting the exact set, not a `!includes` (a rename dodge fails an exact-set compare). |
| closure derived by join | Snapshot `SELECT * FROM value_claims WHERE plan_id=?` before `closePlan`; close; re-select; `assert.deepEqual` — **byte-identical rows**. Closed-ness must come only from joining `project_plans.status` (assert the API's plan payload reports the claims under a `status:'closed'` plan without any per-claim closed field in the JSON — enumerate `Object.keys` of a returned claim). |
| no `UPDATE value_claims` anywhere | Structural: scanFiles over production `server/**/*.js` for `/UPDATE\s+value_claims/i` → zero files. Claims are insert-once (+ human unclaim delete), never mutated. |

### Concurrent plans (DEC-P5)
| Case | Assertions |
|---|---|
| two open plans, one project, no interference | Plans A and B open on `proj-1`, items in each, claim different units into each. Close A. Assert: B still `status:'open'`; B's items still writable (`PATCH` → 200); B's claims unchanged; `GET /api/project-plans?project_id=proj-1&status=open` returns exactly `[B]`; `computePlanHealth().openPlanCount === 1`. |
| same unit claimable across the two plans' items | (cardinality bridge to T5) unit claimed into an item of A and an item of B — both rows exist; closing A does not affect B's claim row. |

**Red-first:** whole spec fails today (module absent). Sharpest mutation each
negative must catch: adding a `closed_at` column to `value_claims` (schema-shape
case), an `UPDATE value_claims SET ...` in `closePlan` (byte-identical case), a
convenience `DELETE /api/project-plans/:id` (structural case).

---

## 3. `server/__tests__/plan-import-inversion.test.js` — T4 (new) — slice 1

The plan's T4 name (change-brief line 77). Fixture: tmp cwd dir with a real
`AGENT-PLAN.md` (nested sub-items + acceptance lines, ≥2 levels), ingested
through the **real** `ingestPlanForCwd` so legacy `plans`/`plan_items` rows
exist; `plan-ingest.js` stays the sole parser — the import test never parses
markdown itself.

| Case | Assertions |
|---|---|
| import writes generation 1 from the DB mirror | `importGenerationFromPlan(dbModule, {projectId:'proj-1', cwd})` → one `project_plans` row: `origin:'import'`, `imported_from_cwd` = canonicalized cwd, `imported_content_hash` = the legacy `plans.content_hash`, `succeeds_plan_id: null`. Items: same count as legacy `plan_items`; per-item `text`/`acceptance`/`detail`/`checked`/`position` equal; `imported_item_id` = legacy `item_id`; **parent nesting preserved** (child's `parent_item_id` resolves to the new id of the row whose `imported_item_id` is the legacy parent). |
| re-import is a no-op returning the existing plan | Call `importGenerationFromPlan` again, same inputs. Returns the **same plan id**; `COUNT(project_plans)` unchanged; `COUNT(project_plan_items)` unchanged. |
| UNIQUE idempotency index bites | Raw `stmts.insertProjectPlan` (or direct INSERT) of a second row with same `(project_id, imported_content_hash)` → throws `SQLITE_CONSTRAINT`. And: same hash under a **different** `project_id` inserts fine (the index is pairwise, per DDL). |
| cwd canonicalization at import (CWD-IDENTITY-FANOUT) | Fixture: `real/` dir plus symlink `alias/ → real/` (deterministic on all platforms; add a darwin-only companion using literal case-variant paths `.../DND` vs `.../dnd`, guarded by `process.platform === 'darwin'`). Ingest via both spellings — legacy layer mints **two** `plans` rows (today's live DND shape, same `content_hash`). Import via `alias`, then import via `real`: **one** `project_plans` row total; `imported_from_cwd` equals `fs.realpathSync(real)`. |
| **re-ingest survival — the `deletePlanItemsNotIn` trap** (I3) | With generation-1 items present **plus** one DB-authored item added via `POST /:id/items` (no legacy provenance at all): rewrite `AGENT-PLAN.md` with two items removed, run the full `ingestPlanForCwd` cycle. Assert **(a)** legacy `plan_items` count *shrank* — proving `deletePlanItemsNotIn` (`plan-ingest.js:396`) actually fired, the §9.3 non-vacuousness anchor; **(b)** `COUNT(project_plan_items)` unchanged and every row byte-identical to the pre-ingest snapshot; **(c)** `project_plans` row untouched. |
| static rogue-writer scan (derived scope, §9.7-compliant) | Using the `scanFiles` walker over the **real** `server/**/*.js` production set (derived by walking the tree, not a hand-typed list): any file matching `/INSERT\s+INTO\s+project_plan_items|UPDATE\s+project_plan_items|DELETE\s+FROM\s+project_plan_items/i` must be exactly `["db.js"]`; any file referencing the stmt names `insertProjectPlanItem|updateProjectPlanItem|deleteProjectPlanItem` must be a subset of `["db.js", "plan-lifecycle.js", "project-plans.js"]` (exact `assert.deepEqual` on the sorted basename list). Same two assertions for `project_plans` / `value_claims` write literals with their allowed sets. |

**Red-first:** build notes must record the rogue-writer red run — temporarily
add `stmts.deleteProjectPlanItem.run(...)` (or a raw `DELETE FROM
project_plan_items`) inside `plan-ingest.js`, observe the scan **and** case (b)
both fail, revert. Case (a) is the guard against the survival test passing
vacuously on a fixture where the delete path never fired.

**Unclear in the plan (flagged):** behavior when `AGENT-PLAN.md` *content
changes* and import is called again — new `content_hash`, so the UNIQUE index
permits a **second** generation-1 (`succeeds_plan_id: null`, same project).
Plan §3.2/§4.4 doesn't say whether that's intended (a second gen-1) or should
be rejected/linked. Test is designed as: pin whichever the builder implements
with an explicit case + comment citing this note; if it mints a second gen-1,
also assert `generationOrdinal` still returns 1 for both without throwing.

---

## 4. `server/__tests__/value-ledger.test.js` — T5 (new) — slice 2

Claims / close / health, per DEC-5 (spec name ≠ module split; both this spec and
`value-pool.test.js` import from the one `server/lib/value-ledger.js`).

### Claims: persisted, never recomputed (I2)
| Case | Assertions |
|---|---|
| snapshot columns persist request-time values | `POST /:id/claims` with `{value_source:'intake_initiative', value_ref:'2026-01-05-x', label_snapshot:'Ship X', seen_at_snapshot, stage_snapshot:'released', attribution:'mechanical'}` → row stores exactly those strings; `claimed_by` defaults `'human'`; `claimed_at` stamped. |
| claim unchanged when the underlying source mutates | After claiming, **delete/rename the intake dir** (or amend the fixture repo history) and re-run `assembleValuePool` + `GET /api/project-plans?project_id=` — the claim row re-read raw is byte-identical to its post-insert snapshot; `label_snapshot` still `'Ship X'` even though the source is gone. Nothing recomputes or "refreshes" a claim. |
| DEC-P4 ceiling | `label_snapshot` accepted as a one-line string; a claim payload is reference + summary only — assert route rejects nothing extra silently: unknown fields are not persisted (enumerate row keys). |

### Cardinality (DEC-7)
| Case | Assertions |
|---|---|
| per-(unit,item) UNIQUE blocks duplicates | Same `(value_source, value_ref, source_cwd)` into the **same** `item_id` twice → second `POST` → 409 (route) and `SQLITE_CONSTRAINT` (stmt level); row count 1. |
| `source_cwd ''`-not-NULL makes the index bite | Two claims for the same unit+item **omitting** `source_cwd` entirely → both normalize to `''` → second **fails**. (If the column were nullable, SQLite treats NULLs as distinct and both would insert — this case is the executable proof of the DDL comment; red-provable by seeding a nullable variant table.) |
| many-to-many is deliberate and visible | Same unit into item A and item B → both succeed; `GET` plan payload shows the unit under both items; `unclaimedPoolSize` decremented **once** (unit left the pool at first claim); `summarizeDeliveredValue` lists the unit under both items without double-counting the pool. |
| first-claim-removes-from-pool | `assembleValuePool` before/after one claim: pools differ by exactly one unit and its `unitKey` equals `unitKey(source, ref, source_cwd)` of the claim. `assert.deepEqual` on the sorted `unitKey` lists, not on lengths (a length-only assert is §9.3 bait). |

### `unitKey` + registry completeness (registry-derived meta-tests)
| Case | Assertions |
|---|---|
| `unitKey` vocabulary | `unitKey('trunk_commit', sha, cwd)` deterministic, distinct across the three components; two feeds' identical `('trunk_commit', sha)` collapse regardless of construction order. |
| `VALUE_SOURCES` mirrors the CHECK — derived, both directions | Read `sqlite_master` SQL for `value_claims`, parse the `value_source ... CHECK(... IN (...))` list, `assert.deepEqual(sorted(parsedList), sorted(VALUE_SOURCES))`. Same for `attribution` vs `ATTRIBUTION_TIERS` and `project_plans.status`. A 6th source added in either home alone goes red. |
| every source has a dispositioned test case | Meta-test: a literal map in the spec `{trunk_commit:'emitted-v1', merge_commit:'emitted-v1', intake_initiative:'emitted-v1', detour:'emitted-v1', focus_segment:'reserved-correlational-tier'}`; assert `Object.keys` set-equals `VALUE_SOURCES`. Adding a source without deciding its test disposition can't ship green. |
| CHECK rejects non-members; routes validate from the export | Raw insert with `value_source:'wat'` throws; route returns 400 whose error body lists the allowed values **taken from `VALUE_SOURCES`** (assert the response array equals the export — catches a route hand-typing its own list, §5.2 binding rule). |

### Health metrics (consumed by T6)
| Case | Assertions |
|---|---|
| `computePlanHealth` shape + values | Seed: 2 open plans, 1 closed (known `closed_at`), pool of known size, injected `now`. Assert exact `{unclaimedPoolSize, lastClosureAt, daysSinceLastClosure, openPlanCount}`. `daysSinceLastClosure` computed from injected `now` (deterministic). No closures ever → `lastClosureAt: null`, `daysSinceLastClosure: null` (pin the null shape — T6 must see the identical shape). |

### Closure single-writer guard (export-derived scope, §9.7)
| Case | Assertions |
|---|---|
| one closure composer | Scope derived from `Object.keys(require("../lib/plan-lifecycle"))` — the guard iterates the **real export list** (never typed names) and locates the close-writing one. Assertions: the SQL literal `/UPDATE\s+project_plans\b[^;]*status/i` appears in exactly `["db.js"]` (the `closeProjectPlan` stmt); the token `closeProjectPlan` appears in exactly `["db.js","plan-lifecycle.js"]`; `closePlan(` call sites in production code exist only in `routes/project-plans.js` (+ its definition in `plan-lifecycle.js`), counted with the declaration-subtraction technique from `single-writer-guard.test.js:150-160`. |

**Red-first:** record the guard's red by adding a second
`stmts.closeProjectPlan.run(...)` call site in `routes/project-plans.js` (or a
raw `UPDATE project_plans SET status='closed'` in `value-ledger.js`), watch the
scan fail, revert — the same mutation discipline as `single-writer-guard`'s
history. The mutate-the-source claim case catches the classic "refresh
snapshots on read" convenience regression.

---

## 5. `server/__tests__/value-pool.test.js` — T3 (new) — slice 3

Spec name only — imports from `server/lib/value-ledger.js` (DEC-5; a
`server/lib/value-pool.js` appearing in the tree should itself fail T4's/T5's
structural scans' allowed-set assertions). Fixtures: real tmp git repos via the
`intake-scan.test.js` kit; `project_paths` seeded to map fixture cwds to
`proj-1`.

| Case | Assertions |
|---|---|
| mechanical tier from intake scan | Repo with a released initiative (merge via `Merge effort/<slug>: ...`, the `intake-scan.test.js:228-258` recipe): pool contains one `{value_source:'intake_initiative', value_ref:slug, attribution:'mechanical'}` **and** one `{value_source:'merge_commit', value_ref:<mergeCommit sha>, attribution:'mechanical'}` — sha equals `scanIntakeForCwd(cwd)`'s `initiative.mergeCommit` (single scan feeds both unit kinds, §4.12). |
| trunk feed via real `detectTrunkDrift` | Commit directly on master (no branch, within lookback) → pool unit `{value_source:'trunk_commit', value_ref:sha}`. Design against the **worktree-verified signature** `detectTrunkDrift(repoPath, {seenShas, lookbackDays, maxCommits, timeout, now})` (returns `{commits,...}` or `{skipped: reason}`); prefer the real-git fixture over a mock seam — matches the project's real-git-fixture posture. A non-repo mapped path → no trunk units, no throw (`skipped:'not_a_repo'` handled), and identityWarning (b) below. |
| ratchet across two runs with grown history (I2 / DEC-6) | Run 1: N trunk units. Claim one sha. Add two new direct-to-trunk commits. Run 2: pool = (N−1)+2 units; the **claimed sha absent** — assert by `unitKey` membership, and assert the claimed sha was passed to the walk via `seenShas` behaviorally (it must not reappear even though it is still in `git log`). Claim row byte-identical after run 2. |
| lookback baseline + `?backfill=1` (DEC-6) | Backdate one direct-to-trunk commit beyond the default window (`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`). `GET /api/project-plans/pool?project_id=proj-1` → old sha **absent**; `...&backfill=1` → **present**. Both responses dedupe/claim-subtract identically. |
| **DEC-4 cross-feed dedupe — the named test** | Same sha present in (1) the live `detectTrunkDrift` walk and (2) a `detour_dispositions` row with `source='trunk_drift'`, `source_ref=<sha>`. Assert exactly **one** pool unit `('trunk_commit', sha)` and `computePlanHealth().unclaimedPoolSize` counts it **once**. Companion: a normal detour row (`source:'inferred'`, disposition `'deliberate'`) maps to `('detour', <id>)` — distinct unit; `disposition='discard'` rows excluded entirely. **Schema gap, see “Unclear” below:** today's CHECK is `source IN ('inferred','declared')` (`server/db.js:701`) — `'trunk_drift'` cannot be inserted. Seed the future-shaped row under `db.pragma("ignore_check_constraints = 1")` (restore to 0 after seeding), with a comment naming Phase 1b as the day the pragma can be dropped. |
| chronology: scrambled id vs created_at (§9.2 / I7) | For the correlational focus-bracketing feed: insert `sessions` (and any `events`/`focus_inferences` the bracket query reads) in id-order **opposite** their `started_at`/`created_at` order (the `workflow-ingest` bulk-insert shape, copied from `chronology-ordering.test.js:396-464`). Assert the bracket attributes the commit to the session whose **time window** contains the commit's `committedAt`, not the latest-id session; where the assembly query has a LIMIT, route it through `assertOrderedByCreatedAt`. |
| correlational tier is suggestions only | A trunk commit inside a session bracket → `attribution:'correlational'`; outside any bracket → unattributed mechanical (`trunk_commit`, no auto-tiering to judgment); **zero rows appear in `value_claims`** after any number of pool assemblies — nothing auto-claims (assert `COUNT(value_claims)` unchanged; also no `focus_segment` unit is emitted in v1, per the T5 disposition map). |
| `identityWarnings` | (a) two `project_paths` cwds (symlink alias + real; darwin-only case-variant companion) → warning naming both spellings + one canonical dir; pool units not doubled — intake units from the two spellings collapse (assert count). (b) mapped path that is not a git repo → warning, pool still assembles. (c) worktree cwd folds to parent repo root (`repoRootFor`), its value pooled under the project; a repo root mapped to no project → warning (c). Assert warnings are on the **pool response** (`GET /pool`), shape `{kind, cwds/...}` pinned. |

**Red-first:** dedupe case red = delete the `unitKey`-collapse step (or map
`trunk_drift` rows to `('detour', id)`) → two units, health double-counts — the
exact R7 failure. Ratchet red = drop `seenShas` pass-through → claimed sha
reappears. Chronology red = swap the bracket query's ORDER BY/window filter to
`id`.

---

## 6. `server/__tests__/ledger-metrics-parity.test.js` — T6 (new) — slice 3

The §9.1 per-shape (not per-module) spec — DEC-16's standing home for every
future consumer.

Fixture: one seeded DB state (2 open plans, 1 closed generation with known
`closed_at`, claims, small git fixture pool) + in-process server + the
`ccam-cli.test.js` async-spawn helper (spawn **must** be async — server lives in
this process).

| Case | Assertions |
|---|---|
| API vs `ccam ledger health` — identical values | `GET /api/project-plans/health?project_id=` → capture `{unclaimedPoolSize, lastClosureAt, daysSinceLastClosure, openPlanCount}`. Spawn `ccam ledger health --project proj-1`. For **each** metric, assert the CLI output contains the API's value **verbatim** (label-anchored extraction, e.g. `/unclaimed[^0-9-]*(\d+)/i` → `Number` equality with the API value; `lastClosureAt` matched as the exact ISO string). No tolerance, no rounding — the CLI prints API values verbatim per §3.4. |
| null-shape parity | A project with no closures: API returns the pinned null shape (from T5); CLI renders it without inventing `0`/`NaN`/`Invalid Date` — assert output matches the agreed null rendering and contains no `NaN`. |
| pool/history parity smoke | `ccam ledger pool` unit count == API pool length; `ccam ledger history` closed-generation count == API history length. |
| consumer registry marker | A `CONSUMERS` array constant in this spec: `["route:/api/project-plans/health", "cli:ccam ledger health" /* DEC-16: MCP + AGENT-PLAN.md export MUST register here on arrival */]` with `assert.equal(CONSUMERS.length, 2)` and a message quoting DEC-16 — the same "do not widen silently" convention as `GRANDFATHERED_QUERIES`. |

**Red-first:** pre-build both surfaces are absent (route 404, CLI exit 1 on
unknown command). Post-build mutation it must catch: any CLI-side arithmetic —
e.g. computing `daysSinceLastClosure` from `lastClosureAt` in `bin/ccam.js`
diverges the moment the server's day-boundary convention differs; verify red by
temporarily hand-rolling that subtraction in `cmdLedger`.

---

## 7. `server/__tests__/cwd-identity.test.js` (new) — slice 1

Not named in the plan's T-list (coverage was folded into T3/T4) but the module
is a single-home guardrail (§5.4) and deserves its own fast spec — worth ~10
cheap cases so T3/T4 failures stay diagnosable.

| Case | Assertions |
|---|---|
| `canonicalizeCwd` resolves symlinks | `alias → real` fixture: returns `fs.realpathSync(real)`. |
| case-variant fold (darwin-only) | `canonicalizeCwd('/…/DND'.toLowerCase())` returns on-disk casing; skip unless `process.platform === 'darwin'` (comment why). |
| missing dir fallback | Nonexistent path → returns the input unchanged (ENOENT fallback), never throws. |
| `repoRootFor` on a plain repo | Returns the repo root for a nested subdir cwd. |
| worktree → parent repo fold | `git worktree add` fixture (`intake-scan.test.js:197-215` recipe): `repoRootFor(worktreePath)` returns the **parent** repo root via `--git-common-dir`, not the worktree path. |
| non-repo | `repoRootFor(plainDir)` → null (or the module's documented sentinel — pin it). |
| `dirIdentity` | Equal `{dev, ino}` for alias and real; different for two distinct dirs. |
| `groupCwdsByIdentity` | `[real, alias, other]` → two groups; duplicate report names the alias pair. |
| single-home structural guard | scanFiles: `realpathSync` / `--show-toplevel` / `--git-common-dir` referenced in production `server/lib` + `server/routes` only from `cwd-identity.js` (allowed-set `deepEqual`; pre-existing users outside the plan/pool surface, if the derived scan finds any, get a dated disposition list in the spec — DEC-9's bounded-fallback shape). |

**Red-first:** module absent today. Mutation target: someone calling
`realpathSync` directly in `value-ledger.js` (the second-home failure §5.4
forbids).

---

## 8. §9.7 obligations — build-step edits to existing specs (slice 3, same commit as `value-ledger.js`)

### `server/__tests__/chronology-ordering.test.js` (modify)
1. **Same-commit registration:** `filesToScan` (lines 80–86) gains
   `server/lib/value-ledger.js`, `server/lib/cwd-identity.js`,
   `server/lib/plan-lifecycle.js`, `server/routes/project-plans.js`.
2. **Derived-scope cure (DEC-9):** replace the hand-typed list with
   `fs.readdirSync` over `server/lib/*.js` + `server/routes/*.js` plus an
   explicit per-file disposition map `{ "server/lib/foo.js": "scanned" | {status:"grandfathered", dated, reason} }`.
   New assertion: **every** globbed file has a disposition and every
   dispositioned file exists (no stale entries) — an undispositioned 6th lib
   file fails the suite with a message telling the author to disposition it.
   Bounded fallback if the derived scan surfaces a pre-existing violator set:
   date-disposition them, record the remainder in `decisions.md`, never weaken
   the scan.
3. `GRANDFATHERED_QUERIES.length === 2` assertion **unchanged** — stays 2.
4. Behavioral: no new case needed here — T3's scrambled-id case covers the new
   surface; the static scan now covers every `LIMIT` in the four new files.

**Red-first for the cure itself (§9.3):** before committing, drop a scratch
`server/lib/zz-scratch.js` containing a LIMITed SELECT over `events` with no
disposition → suite must fail on *scope*, not on SQL shape; delete the scratch
file. Record in build notes.

### `server/__tests__/single-writer-guard.test.js` (unchanged) vs closure guard
The closure single-writer guard lives in **T5** (per plan §4.10), not here —
`single-writer-guard.test.js` stays byte-unmodified (it is part of the 144
baseline). T5's guard follows its declaration-subtraction technique and derives
scope from `plan-lifecycle.js`'s real export list per DEC-9's "same instruction".

---

## 9. Client — slice 5 only (after the DEC-12 gate)

### `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (new) — T7
Convention: sibling of `client/src/components/__tests__/OpenTerminalModal.test.tsx`
(vitest + RTL, `vi.mock` of `client/src/lib/api`).

| Case | Assertions |
|---|---|
| left pane renders open plans + nested items | Mock `api.projectPlans.list` with 2 open plans, one with parent/child items → both plan titles rendered; child item nested (role/`within` query). |
| pool units with tier badges | Mock pool with one unit per emitting tier (`mechanical`, `correlational`) → badge text/testid per unit; derive the mocked units' `value_source` values from the `ValueUnit` type's union, so a new source without a badge decision fails type-check + this case. |
| claim gesture | Click claim on unit U targeting item I → `api.projectPlans.claim` called with `(planId/itemId, unit)` exactly once; after mocked refetch resolves **without** U, U is gone from the pool pane. |
| close moves plan to history | Click close (+ confirm if designed) → `api.projectPlans.close` called with plan id + note; after refetch, plan renders in the collapsed closed-generations list, not the open pane. |
| **health rendered verbatim — no client re-derivation** | Mock `health` = `{unclaimedPoolSize: 37, daysSinceLastClosure: 12, ...}` while the mocked pool array has length **5**. Assert the panel shows **37** (server value), not 5 — the §9.1 client-side trap assertion; also `lastClosureAt: null` renders the null state, no `NaN`/`Invalid Date` in `container.textContent`. |
| closed plan is read-only | A closed generation in the history list exposes no item-edit/claim/unclaim affordances (query for the buttons → absent). |
| i18n keys resolve | Render under the test i18n provider; assert no raw `projectDetail.…` key leaks into the DOM (regex on `container.textContent`); key-set parity `en`↔`ko`↔`vi`↔`zh` for the newly added keys (deepEqual on sorted key lists loaded from the four `projectDetail.json` files — extend the existing locale-parity test if one exists, else add it here). |

### `client/src/pages/__tests__/ProjectDetail.test.tsx` (update)
One case: with `api.projectPlans.*` mocked, Project Detail renders the
PlanLedgerPanel card alongside its existing cards (and existing cases stay
green with the new fetch mocked — the mock must be added to the shared setup,
not per-case).

### `client/src/pages/__tests__/screens.snapshot.test.tsx` (reviewed regen)
Add `api.projectPlans` responses to the "Project detail" screen's mock fixture
block (~line 653 entry) so the panel renders deterministically; regenerate with
`cd client && npx vitest run -u`; **review** the diff — the only changed
snapshot should be Project Detail (+ any shell chrome), and the diff must show
the panel's markup, not empty/error states. Never blind-regen (project rule).

**Red-first:** the health-verbatim case is authored to fail against the lazy
implementation (`pool.length` as the headline number) — verify by temporarily
rendering `pool.length` during build.

---

## How to run

```bash
# server layer (T1–T6, cwd-identity, chronology scope)
npm run test:server
node --test server/__tests__/plan-lifecycle.test.js
node --test server/__tests__/plan-import-inversion.test.js
node --test server/__tests__/value-ledger.test.js
node --test server/__tests__/value-pool.test.js
node --test server/__tests__/ledger-metrics-parity.test.js
node --test server/__tests__/cwd-identity.test.js

# client layer (slice 5)
npm run test:client
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
cd client && npx vitest run -u   # snapshot regen — reviewed diff only

# hygiene gates that bind these specs
bash .claude/skills/file-headers/scripts/check-headers.sh
grep -rn "assert.ok(true" server/__tests__/   # must stay empty
grep -rn "|| true" server/__tests__/          # must stay empty
```

Baseline floor: the nine existing specs (144/144) — including
`plan-ingest.test.js` and `single-writer-guard.test.js` — stay green and
**byte-unmodified** except `db-migration.test.js` (T1 extension) and
`chronology-ordering.test.js` (§9.7 scope work).

## Gaps / unclear obligations flagged to the build

1. **DEC-4 seeding is schema-blocked today:** `detour_dispositions.source`
   CHECK is `('inferred','declared')` (`server/db.js:701`) — the named dedupe
   test cannot insert `source='trunk_drift'` through the schema until Phase 1b
   widens it. Design answer: seed under `db.pragma("ignore_check_constraints = 1")`
   (restored after), documented in-spec. If the builder prefers a pure seam,
   export the row→unit mapper from `value-ledger.js` and test the mapping
   directly — but the pragma keeps the full assembly path real.
2. **Re-import after content change is unspecified** (T4 note above): the
   UNIQUE index permits a second generation-1 when `content_hash` changed;
   plan §3.2/§4.4 silent on intent. Pin the built behavior explicitly.
3. **`repoRootFor` failure sentinel unspecified** (null vs input-echo) — pin
   whichever ships; T3's warning (b) depends on it.
4. **`ccam ledger health` output format** is unspecified; T6's label-anchored
   extraction needs stable labels — builder should treat the printed labels as
   part of the parity contract (or add `--json`, which would make T6 exact).
5. **detectTrunkDrift signature** re-confirm at DEC-2 merge: designed against
   the worktree-verified `detectTrunkDrift(repoPath, {seenShas, lookbackDays,
   maxCommits, timeout, now})` returning `{commits[.sha], ...}` /
   `{skipped: reason}`; `TRUNK_DRIFT_SKIP_REASONS` should be imported, never
   retyped, wherever T3 asserts skip handling.
