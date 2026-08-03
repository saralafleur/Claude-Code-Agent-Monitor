# Test Plan — 2026-08-02-plan-lifecycle-value-ledger

> Authored by `qa-lead`, reconciling `supporting/coverage.md`, `supporting/risk.md`,
> `supporting/unit-tests.md`, `supporting/e2e-tests.md` and the strategist's
> `qa-assessment.md` (verdict: **GAPPED**). This is the buildable deliverable: the
> exact specs, cases, fixtures, red-first proofs and run commands. It **supersedes
> and concretizes** `technical-plan.md` §6 "Testing & verification" — where the two
> disagree, this document wins, and every divergence is named in §"Layer
> reconciliation" below.
>
> **PRE-BUILD.** None of the change exists on `master`. Every spec here is authored
> red-first against unbuilt code. "Red" therefore has two grades, and the build
> notes must record which one was observed:
> - **R0 (module-absence red)** — `Cannot find module '../lib/…'` / 404 / `exit 1`.
>   Cheap, expected, and **not sufficient** for any structural guard.
> - **R1 (mutation red)** — the guard observed failing on a deliberately injected
>   defect, with the module present. §9.3 (VACUOUS-GUARD) is satisfied **only** by
>   R1. Every case below that carries a "Red-proof:" line requires R1.

---

## Objective

Add ~120 new or changed test cases across six layers so that the portfolio plan
lifecycle, the value-claims ledger and the live-derived unclaimed pool ship with
their invariants **mechanically** guarded rather than described. End state: closure
is provably the only door into closed state (I-1); claims are provably persisted and
never recomputed (I-2/I-3); the legacy `deletePlanItemsNotIn` path is provably
unable to reach the new tables (I-3/R3); the same physical unit is provably one
`unitKey` at all three canonicalization seams (I-8 — today guarded nowhere); the same
health numbers are provably identical through the API route and `ccam ledger` (§9.1);
and four structural scans that are hand-scoped today become **artifact-derived**, so
the seventh file added to `server/lib/` breaks the suite instead of silently
escaping it (§9.7). Three surfaces that no evaluator document owned — cross-seam
`unitKey` agreement, the OpenAPI contract artifact, and the schema-blocked DEC-4
dedupe fixture — are first-class numbered obligations here (O-7, O-19, O-16), not
appendix notes.

---

## Coverage gap being closed

| # | UNGUARDED surface today | Catalog id | Assertion that pins it |
|---|---|---|---|
| 1 | `project_plans` / `project_plan_items` / `value_claims` schema on a legacy-shape DB | §9.5/§9.6 (*inapplicable-by-design — verify it stays so*) | T1: legacy DB boots → three tables + five indexes present, writable, second boot byte-identical; legacy `sqlite_master.sql` text for `plans`/`plan_items`/`detour_dispositions` **unchanged**; `/ALTER TABLE/` match count in `db.js` equals its recorded pre-change value |
| 2 | Plan lifecycle state machine, generation chain, closed-immutability | — (I-1, I-6, DEC-P5, DEC-P6) | T2: 19 cases incl. exact `PRAGMA table_info` column sets (absence proven by exact-set equality, not `!includes`), byte-identical claim rows across `closePlan`, and structural proof that no `DELETE FROM project_plans` literal exists in production code |
| 3 | Import-as-generation-1 and the ingest blast radius | **§9.1** (helper-copy form), I-3/R3 | T4: full `ingestPlanForCwd` cycle where legacy `plan_items` count **shrank** (non-vacuousness anchor) while `project_plan_items` rows are byte-identical; `assertSingleHome`-derived rogue-writer scan over the real `server/**/*.js` set |
| 4 | **Cross-seam `unitKey` agreement** — claim-write vs pool-assembly canonicalization | **CWD-IDENTITY-FANOUT** (candidate; this is its recorded promotion trigger) | O-7 / T3: claim written through a case-variant or worktree cwd, pool assembled through the canonical one → unit still excluded, duplicate still blocked. **Named by `risk.md` trap T2 and adopted by no evaluator document.** |
| 5 | Pool assembly: tiers, ratchet, backfill, cross-feed dedupe, chronology, identity warnings | **§9.1** (feed-level form), **§9.2** | T3: 11 cases over real tmp git repos; scrambled-id fixture where the `LIMIT` selects the **wrong subset** if ordering is by `id` |
| 6 | Cross-consumer parity for every derived value | **§9.1** (announced-consumers form, count 5) | T6: one seeded DB → real route + real spawned `ccam ledger health` → verbatim equality, no tolerance, no mocked API |
| 7 | The four new server files vs the §9.2 chronology scan | **§9.7** (6 occurrences) | Same-commit registration **plus** `filesToScan` derived from `server/lib/*.js` + `server/routes/*.js` with a per-file disposition map; an undispositioned 7th lib file fails the suite on **scope** |
| 8 | **The OpenAPI contract artifact** — `operationId` uniqueness, route↔spec completeness, `openapi.yaml` freshness | **CONTRACT-SPEC-DRIFT** (candidate, recorded `PROJECT-CONTEXT.md` §780) | O-19 / new `openapi-contract.test.js`: live collision at `server/openapi-extra/plans.js:236` (`getProjectPlans`) blocked; every `app.use("/api/…")` mount has a path entry modulo a dated grandfather list; committed `openapi.yaml` byte-equals the regenerated dump |
| 9 | Whole-namespace locale key parity (21 namespaces × 4 locales) | **§9.7** (occurrence 6 — the hand-typed key registry) | O-8 / `i18n.test.ts`: plural-suffix-aware `deepEqual` loop; retires the per-build hand-typed key block permanently |
| 10 | `PlanLedgerPanel` render + no client-side re-derivation | **§9.1** (client form) | T7: `health.unclaimedPoolSize = 37` while the mocked pool array has length 5 → the panel must show **37** |

---

## Test change set

Layers discovered from the repo (not assumed): **(A)** server module unit/integration
(`node:test` + `node:assert/strict`, `server/__tests__/*.test.js`, one spec per
module); **(B)** server HTTP contract (same directory, but boots the real app
in-process on port 0 against a temp DB — `plans-api.test.js` / `projects.test.js`
shape); **(C)** CLI-through-API (`ccam-cli.test.js`, async `spawn` of the real
`bin/ccam.js`) plus cross-consumer parity; **(D)** structural / registry meta-scans
(`chronology-ordering.test.js`, `single-writer-guard.test.js`, and the new
`openapi-contract.test.js`); **(E)** client component/page + per-screen render
snapshots (vitest + RTL); **(F)** the i18n registry spec. There is **no** separate
e2e runner or tag convention in this repo — the spec file *is* the bucket.

### Layer A — server module unit/integration (63 cases)

**A1. `server/__tests__/db-migration.test.js` — T1 (extend) — slice 1 — 4 cases**

Add one `describe("additive portfolio-layer tables")`. No `UPGRADE_CASES` entry
(new tables, not new columns — matches the file's own `:25` convention), no
`REBUILD_CASES`, no interruption case.

| Case | Assertion |
|---|---|
| A1.1 legacy-shape DB gains the three tables | Reuse the file's legacy `plans`/`plan_items` DDL + a seeded row; point `DASHBOARD_DB_PATH` at it; `require("../db")`. `sqlite_master` contains `project_plans`, `project_plan_items`, `value_claims` **and** `idx_project_plans_project`, `idx_project_plans_import`, `idx_value_claims_unit_item`, `idx_value_claims_plan`, `idx_value_claims_unit`. Seeded legacy rows byte-compared before/after. |
| A1.2 new tables writable | `stmts.insertProjectPlan` / `insertProjectPlanItem` / `insertValueClaim` each succeed. |
| A1.3 second boot is a no-op | Clear require cache, re-require. `sqlite_master` row count unchanged **and** table SQL text identical. |
| A1.4 §9.5/§9.6-stay-inapplicable pin (trap T4) | (a) `sqlite_master.sql` text for `plans`, `plan_items`, `detour_dispositions` identical to a constant captured at authoring time; (b) the count of `/ALTER TABLE/` matches in `server/db.js` equals a recorded literal, with an in-file comment saying why the number is pinned. |

Red-proof (R1): mutate a `CREATE TABLE IF NOT EXISTS` into `DROP TABLE IF EXISTS;
CREATE TABLE` → A1.3 must fail (claims would be wiped).
Run: `node --test server/__tests__/db-migration.test.js`

**A2. `server/__tests__/plan-lifecycle.test.js` — T2 (new) — slice 1 — 19 cases**

Two layers in one spec: lib-level (tmp-DB `dbModule`) + route-level negatives.

- *Generation chain (3):* `succeeds_plan_id` walk derives ordinals 1..3; **ordinal is
  derived never stored** — `PRAGMA table_info(project_plans)` name-set **exactly
  equals** the §3.1 DDL list (no `ordinal`/`generation` column); branching chain
  (two successors of gen1, legal under DEC-P5) returns 2 for both without throwing,
  and a raw-seeded self-referencing `succeeds_plan_id` terminates with an error, not
  a hang.
- *State machine (4):* `closePlan(dbModule, id, {closure_note, now})` stamps
  `status:'closed'` + injected ISO `closed_at` + note; `POST /:id/close` → 200 while
  `PATCH /:id {status:'closed'}` → 400 and raw `UPDATE … SET status='wat'` throws on
  the CHECK; second close → error / 409 with `closed_at` **unchanged**; no reopen
  path exists and `PATCH` title on a closed plan → 409.
- *Closed-immutability negatives (6):* `POST /:id/items`, `PATCH /items/:itemId`,
  `DELETE /items/:itemId`, `POST /:id/claims`, `DELETE /claims/:claimId` each → 409;
  `DELETE /api/project-plans/:id` → 404/405 **plus** a structural assertion that no
  production file under `server/` matches `/DELETE\s+FROM\s+project_plans/i` and
  `stmts` has no `deleteProjectPlan` key. After each, `SELECT *` snapshots of all
  three tables are identical.
- *Claims carry no closed state (3):* `PRAGMA table_info(value_claims)` name-set
  **exactly equals** `{id, project_id, plan_id, item_id, value_source, value_ref,
  source_cwd, label_snapshot, seen_at_snapshot, stage_snapshot, attribution,
  claimed_by, claimed_at}`; claim rows `deepEqual`-identical across `closePlan`;
  structural scan for `/UPDATE\s+value_claims/i` over production `server/**/*.js` →
  zero files.
- *Concurrent plans, DEC-P5 (2):* two open plans on one project do not interfere
  (close A → B still open, writable, its claims untouched, `?status=open` returns
  exactly `[B]`, `openPlanCount === 1`); the same unit is claimable into an item of
  A **and** an item of B, and closing A leaves B's claim row untouched.
- *WS allowlist (1, adopted from `e2e-tests.md` §3):* with an injected `broadcast`
  collector (`focus-commands.test.js:38-39` pattern), assert the collected type set
  is **exactly** `{project_plan_updated, value_claim_updated}` — an allowlist, so a
  third type (or a smuggled `plan_updated`) fails.

Red-proof (R1): add a `closed_at` column to `value_claims` → schema-shape case red;
add `UPDATE value_claims SET …` inside `closePlan` → byte-identical case red; add a
convenience `DELETE /api/project-plans/:id` → structural case red.
Run: `node --test server/__tests__/plan-lifecycle.test.js`

**A3. `server/__tests__/plan-import-inversion.test.js` — T4 (new) — slice 1 — 6 cases**

Fixture: tmp cwd with a real nested `AGENT-PLAN.md` (≥2 levels + acceptance lines)
ingested through the **real** `ingestPlanForCwd`. This spec never parses markdown —
`plan-ingest.js` stays the sole parser.

| Case | Assertion |
|---|---|
| A3.1 import writes generation 1 from the DB mirror | One `project_plans` row: `origin:'import'`, `imported_from_cwd` canonical, `imported_content_hash` = legacy `plans.content_hash`, `succeeds_plan_id: null`. Items match count/`text`/`acceptance`/`detail`/`checked`/`position`; `imported_item_id` = legacy `item_id`; **parent nesting resolves** (child's `parent_item_id` → the new id of the row whose `imported_item_id` is the legacy parent). |
| A3.2 re-import is a no-op | Same plan id returned; `COUNT(project_plans)` and `COUNT(project_plan_items)` unchanged. |
| A3.3 UNIQUE idempotency index bites | Second raw insert with the same `(project_id, imported_content_hash)` → `SQLITE_CONSTRAINT`; the same hash under a **different** `project_id` inserts fine. |
| A3.4 cwd canonicalization at import (trap T6) | `real/` + symlink `alias/ → real/` (all platforms) and a darwin-guarded literal case-variant `.../DND` vs `.../dnd`. Legacy layer mints **two** `plans` rows (today's live shape, one `content_hash`); importing via both spellings yields **one** `project_plans` row with `imported_from_cwd === fs.realpathSync(real)`. |
| A3.5 re-ingest survival — the `deletePlanItemsNotIn` trap (I-3) | Generation-1 items **plus** one DB-authored item (`POST /:id/items`, no legacy provenance). Rewrite `AGENT-PLAN.md` with two items removed; run the full ingest cycle. **(a)** legacy `plan_items` count *shrank* — proving `plan-ingest.js:396` actually fired; **(b)** `COUNT(project_plan_items)` unchanged and every row byte-identical; **(c)** `project_plans` row untouched. Sub-assertion (a) is load-bearing: without it (b) passes vacuously. |
| A3.6 rogue-writer scan — **`assertSingleHome` call site** | Consume `server/__tests__/helpers/single-home.js` (arrives with the DEC-2 merge). Write literals `/INSERT INTO\|UPDATE\|DELETE FROM project_plan_items/i` over the derived production set → exactly `["db.js"]`; stmt-name references `insertProjectPlanItem\|updateProjectPlanItem\|deleteProjectPlanItem` → `deepEqual` sorted basenames `["db.js","plan-lifecycle.js","project-plans.js"]`. Same pair for `project_plans` and `value_claims`. **Do not hand-roll a second scope-derivation helper** (risk.md §1e). |

Red-proof (R1, both required and recorded in build notes): inject `DELETE FROM
project_plan_items` into `plan-ingest.js` → A3.6 **and** A3.5(b) both fail; revert.
Then inject an undispositioned export into `plan-lifecycle.js` and confirm
`assertSingleHome` actually **loads and fails** — the trunk-drift build shipped this
helper with its path resolution anchored to the wrong directory, so the scan never
ran while the DoD showed a tick. Consuming it is not the same as trusting it.

*Unresolved behavior to pin at build time (flagged by the unit architect):* when
`AGENT-PLAN.md` content changes, the new `content_hash` permits a **second**
generation-1. Pin whichever the builder implements with an explicit case + a comment
citing this line; if it mints a second gen-1, also assert `generationOrdinal` returns
1 for both without throwing.
Run: `node --test server/__tests__/plan-import-inversion.test.js`

**A4. `server/__tests__/cwd-identity.test.js` (new) — slice 1 — 10 cases**

Not in the plan's T-list; added because `cwd-identity.js` is a single-home guardrail
(§5.4) and T3/T4 failures must stay diagnosable.

`canonicalizeCwd` resolves symlinks to `fs.realpathSync(real)` · darwin-guarded
case-variant fold returns on-disk casing · nonexistent path returns input unchanged
(ENOENT fallback, never throws) · `repoRootFor` on a nested subdir returns the repo
root · **worktree folds to the parent repo root** via `--git-common-dir`
(`intake-scan.test.js:197-215` recipe) · non-repo returns the documented sentinel
(**pin whichever ships** — T3's warning (b) depends on it) · `dirIdentity` equal
`{dev, ino}` for alias/real, different for distinct dirs · `groupCwdsByIdentity`
`[real, alias, other]` → two groups naming the alias pair · single-home structural
guard: `realpathSync` / `--show-toplevel` / `--git-common-dir` appear in production
`server/lib` + `server/routes` only in `cwd-identity.js` (allowed-set `deepEqual`) ·
**O-7b seam-agreement diagnostic (new):** a table of `[symlink-alias, case-variant
(darwin), worktree-path]` × canonical, asserting `canonicalizeCwd(variant)` ===
`canonicalizeCwd(canonical)` for each — the fast failure that tells you *which* seam
broke when O-7a goes red.

Red-proof (R1): call `realpathSync` directly from `value-ledger.js` → single-home
guard red.
Run: `node --test server/__tests__/cwd-identity.test.js`

**A5. `server/__tests__/value-ledger.test.js` — T5 (new) — slice 2 — 13 cases**

Per DEC-5, this spec and `value-pool.test.js` both import from the one
`server/lib/value-ledger.js`; **no `server/lib/value-pool.js` may ever exist** (its
appearance fails A3.6's allowed-set assertions).

- *Claims persisted, never recomputed, I-2 (3):* snapshot columns store exactly the
  request strings, `claimed_by` defaults `'human'`, `claimed_at` stamped · after
  claiming, **delete/rename the source intake dir**, re-run `assembleValuePool` and
  re-read the claim raw → byte-identical, `label_snapshot` still `'Ship X'` ·
  DEC-P4 ceiling: unknown payload fields are not persisted (enumerate row keys).
- *Cardinality, DEC-7 (4):* same `(value_source, value_ref, source_cwd)` into the
  **same** `item_id` twice → 409 at the route and `SQLITE_CONSTRAINT` at the stmt,
  row count 1 · **`source_cwd ''`-not-NULL executable proof**: two claims omitting
  `source_cwd` both normalize to `''` and the second fails; red-provable by seeding a
  nullable variant table where both insert (this is the proof, not a DDL read) ·
  many-to-many across items is deliberate and visible, `unclaimedPoolSize`
  decremented **once** · first-claim-removes-from-pool asserted by `deepEqual` on the
  sorted `unitKey` lists, **never on lengths** (§9.3 bait).
- *Registry-derived meta-tests (4):* `unitKey` determinism and component-distinctness,
  two feeds' identical `('trunk_commit', sha)` collapse regardless of construction
  order · `VALUE_SOURCES` / `ATTRIBUTION_TIERS` / `project_plans.status` parsed out of
  `sqlite_master` CHECK text and `deepEqual`'d against the exports — **both
  directions**, so a 6th member added in either home alone goes red · every source
  carries a test disposition in a literal map whose `Object.keys` set-equals
  `VALUE_SOURCES` (`{trunk_commit:'emitted-v1', merge_commit:'emitted-v1',
  intake_initiative:'emitted-v1', detour:'emitted-v1',
  focus_segment:'reserved-correlational-tier'}`) · CHECK rejects non-members and the
  route's 400 body lists the allowed values **taken from the export** (assert the
  response array equals `VALUE_SOURCES` — catches a route hand-typing its own list).
- *Health metrics (1):* 2 open plans + 1 closed with a known `closed_at` + a
  known-size pool + injected `now` → exact
  `{unclaimedPoolSize, lastClosureAt, daysSinceLastClosure, openPlanCount}`; the
  no-closures case pins the **null shape** (`lastClosureAt: null`,
  `daysSinceLastClosure: null`) that T6 must see identically.
- *Closure single-writer guard (1) — `assertSingleHome` call site:* scope derived
  from `Object.keys(require("../lib/plan-lifecycle"))`, never typed names. Assertions:
  `/UPDATE\s+project_plans\b[^;]*status/i` appears in exactly `["db.js"]`; the token
  `closeProjectPlan` in exactly `["db.js","plan-lifecycle.js"]`; `closePlan(` call
  sites in production code only in `routes/project-plans.js` plus its definition,
  counted with the declaration-subtraction technique from
  `single-writer-guard.test.js:150-160`.

Red-proof (R1): add a second `stmts.closeProjectPlan.run(…)` call site in
`routes/project-plans.js` (or a raw `UPDATE project_plans SET status='closed'` in
`value-ledger.js`) → guard red; revert. Add a "refresh snapshots on read" line to the
claim read path → the mutate-the-source case red.
Run: `node --test server/__tests__/value-ledger.test.js`

**A6. `server/__tests__/value-pool.test.js` — T3 (new) — slice 3 — 11 cases**

Fixtures: real tmp git repos via `intake-scan.test.js`'s `ISOLATED_GIT_ENV` /
`makeRepo` / `fs.realpathSync(mkdtemp)` kit copied verbatim; `project_paths` seeded to
map fixture cwds to `proj-1`; backdated commits via `GIT_AUTHOR_DATE`/
`GIT_COMMITTER_DATE`. Prefer real-git fixtures over mock seams — the repo's posture.

| Case | Assertion |
|---|---|
| A6.1 mechanical tier from intake scan | A released initiative (`Merge effort/<slug>: …`, `intake-scan.test.js:228-258` recipe) yields **both** `{intake_initiative, slug, mechanical}` and `{merge_commit, <sha>, mechanical}`; the sha equals `scanIntakeForCwd(cwd)`'s `initiative.mergeCommit` — one scan feeds both unit kinds. |
| A6.2 trunk feed via real `detectTrunkDrift` | Direct-to-master commit inside the lookback → `{trunk_commit, sha}`. Import `TRUNK_DRIFT_SKIP_REASONS`, never retype it. A non-repo mapped path → no trunk units, no throw (`skipped:'not_a_repo'`), plus warning (b). |
| A6.3 ratchet across two runs (I-2 / DEC-6) | Run 1: N units. Claim one sha. Add two new trunk commits. Run 2: `(N−1)+2`, claimed sha **absent** — asserted by `unitKey` membership, and behaviorally (it must not reappear though it is still in `git log`). Claim row byte-identical after run 2. |
| A6.4 lookback baseline + `?backfill=1` | Backdated commit absent by default, present with `&backfill=1`; both responses dedupe and claim-subtract identically. |
| A6.5 **DEC-4 cross-feed dedupe (O-16a, primary)** | Same sha in the live `detectTrunkDrift` walk **and** a `detour_dispositions` row `{source:'trunk_drift', source_ref:<sha>}` → exactly **one** pool unit `('trunk_commit', sha)` and `unclaimedPoolSize` counts it once. Seed the row under `db.pragma("ignore_check_constraints = 1")`, restored to `0` immediately after, with the written justification required by O-16 (below). |
| A6.6 **DEC-4 mapper diagnostic (O-16b)** | `value-ledger.js` exports the row→unit mapper; assert directly that `{source:'trunk_drift', source_ref:sha}` maps to `('trunk_commit', sha)`, a normal `{source:'inferred', disposition:'deliberate'}` row maps to `('detour', <id>)`, and `disposition:'discard'` rows map to nothing. Fast diagnostic — it proves the mapper, **not** the assembly, which is why A6.5 is the primary. |
| A6.7 **Phase-1b tripwire (O-16c)** | Read `detour_dispositions`' CHECK text from `sqlite_master`; assert it still **excludes** `'trunk_drift'`. Failure message verbatim: *"Phase 1b has landed: drop the `ignore_check_constraints` pragma in A6.5, re-seed through the real writer, and re-verify that `source_ref` carries a full 40-char sha."* Without this the pragma silently outlives its reason and R7 lands exactly where the pragma cannot see. |
| A6.8 **cross-seam `unitKey` agreement (O-7a)** | Write the claim through a **case-variant** (darwin-guarded `.../DND` vs `.../dnd`) or **worktree** cwd; assemble the pool through the canonical one. Assert: (i) the unit is **still excluded** from the pool; (ii) a second claim of the same unit into the same item is **still blocked** by the UNIQUE index. Red-proof (R1): remove canonicalization from **one** seam only (the claim-write seam) → the unit re-enters the pool and the duplicate inserts. |
| A6.9 chronology: scrambled id vs `created_at` (§9.2 / I-7) | Insert `sessions` / `events` / `focus_inferences` in id-order **opposite** their time order (`workflow-ingest` bulk shape, `chronology-ordering.test.js:396-464`). The bracket must attribute the commit to the session whose **time window** contains `committedAt`, not the latest-id session. The fixture must make a `LIMIT` select the **wrong subset** under id-ordering — a fixture that merely presents the right subset misordered is a tautology. Route LIMITed queries through `assertOrderedByCreatedAt` (`server/__tests__/helpers/ordering.js` — use it, don't re-derive). |
| A6.10 correlational tier is suggestions only | Bracketed trunk commit → `attribution:'correlational'`; unbracketed → unattributed mechanical, no auto-tiering to judgment; `COUNT(value_claims)` unchanged after any number of assemblies; **no `focus_segment` unit emitted in v1** (matches A5's disposition map). |
| A6.11 `identityWarnings` | (a) two `project_paths` cwds resolving to one dir (symlink + darwin case-variant companion) → warning naming both spellings and one canonical dir, and intake units from the two spellings **collapse** (assert the count, not just the warning); (b) mapped path that is not a git repo → warning, pool still assembles; (c) worktree cwd folds to the parent repo root and its value pools under the project; a repo root mapped to no project → warning (c). Warnings live on `GET /pool`; pin the `{kind, cwds}` shape. |

Additional red-proofs (R1): delete the `unitKey`-collapse step (or map `trunk_drift`
rows to `('detour', id)`) → A6.5 shows two units and a double-counted health number —
the exact R7 failure · drop the `seenShas` pass-through → A6.3 red · swap the bracket
query's ORDER BY to `id` → A6.9 red.
Run: `node --test server/__tests__/value-pool.test.js`

### Layer B — server HTTP contract (28 cases)

**B1. `server/__tests__/project-plans-api.test.js` (new) — skeleton slice 1, completes slice 3**

Setup copied verbatim from `plans-api.test.js:23-93`: temp DB (`Date.now()-pid`
suffix) set **before** requiring `../index`, `createApp()` + `startServer(app, 0)`,
raw `http.request` helper, WAL cleanup in `after()`. A tmp `workDir` with a nested
`AGENT-PLAN.md`, a project via `POST /api/projects` (201), and the legacy plan
ingested via `POST /api/plans/refresh`. File header per
`.claude/rules/file-headers.md`. **Never** point `DASHBOARD_DB_PATH` at
`~/.claude/agent-dashboard/dashboard.db`.

- **Group A — create/list/read (5):** A1 `POST` → **201** (pins S3) with
  `status:'open'`, `origin:'manual'`, `opened_at` set, `closed_at:null` · A2
  validation 400s + create-only 404 on unknown project · A3 `GET ?project_id=` returns
  nested `items` (by `position`) with per-item `claims`, `?status=` filters, and
  **no `cwd` top-level key on any plan** (R1 anti-blend) · A4 `GET /:id` 200/404 plus
  the **literal-segment guard**: `GET /api/project-plans/pool` returns the pool
  route's 400, *not* the `:id` 404 — the S4 tripwire for the Express-4-only
  `:id(\d+)` syntax · A5 generation chain exposes the **derived** ordinal key
  (pin the name), bogus `succeeds_plan_id` → 400/404.
- **Group B — item CRUD on open plans (3):** create with `parent_item_id` nesting +
  `position`; `PATCH`/`DELETE` read back consistent (indirect broadcast proof, same
  pattern as `plans-api.test.js`); negatives 404/400.
- **Group C — closure, the contract heart (4):** C1 `POST /:id/close` 200 with note
  echoed and the plan under `?status=closed` · C2 double close → **409 with a
  structured `error.code`** (pin `ALREADY_CLOSED`, matching the
  `UNKNOWN_ITEM`/`EMPTY_STACK` convention) · C3 the full refusal sweep against a
  closed plan, then re-read plan/items/claims byte-identical · **C4 no other verb
  closes** — call every mutating route in the namespace against a fresh *open* plan
  (including `PATCH /:id {status:'closed'}`) and assert `status` is still `'open'`
  after each; `DELETE /api/project-plans/:id` → 404.
- **Group D — claims cardinality, DEC-7 (5):** D1 claim visible nested under its item,
  snapshots echoed · **D2 duplicate → 409 with a structured code, never a raw
  `SQLITE_CONSTRAINT` 500** (risk S2) · D3 same unit into a second item allowed and
  `unclaimedPoolSize` unchanged by the second claim · D4 `new_item:{…}` inline form is
  atomic (failure of either leaves neither) · D5 unclaim on an open plan returns the
  unit to the pool (+1) and a `value_source` outside `VALUE_SOURCES` → 400.
- **Group E — pool endpoint (3):** E1 `{units, identityWarnings}` with
  `identityWarnings` **always an array, present even when empty** · E2 mechanical tier
  present, nothing arrives pre-claimed, no `focus_segment` auto-claim · E3 `?backfill=1`
  accepted, 400 on missing `project_id`. Depth/dedupe/ratchet behavior is **not**
  re-proven here — that is A6's job.
- **Group F — health + history (3):** F1 exact key set (the T6 parity target shape) ·
  F2 health reacts to lifecycle · F3 history exposes closed generations with claims and
  **no `closed_at`/closed flag on any claim object** — the response-shape mirror of the
  DDL rule; AC-6 answerable from this payload alone.
- **Group G — import (3):** G1 generation-1 with provenance and nesting · **G2
  idempotent re-import → 200 no-op returning the same `plan.id`**, not a second
  generation and not a 409 · G3 negatives.
- **Group H — namespace isolation (1):** after the whole suite has run in one process
  lifetime, `GET /api/plans` still returns the exact legacy shape (`plans[].cwd`,
  `items[].item_number`), contains no portfolio rows, and `POST /api/plans/refresh`
  still works.
- **Group S — audit semantics (1, new):** delete the project row via raw SQL in-test,
  then `GET /history?project_id=` and `GET /health?project_id=` → **still 200**
  (closed generations outlive their project — `project_plans.project_id` has no FK
  *by design*), while `POST /` and `POST /import` for that id → 404. **Blocked on
  QDEC-15** — if Sara rules the other way, invert this case and record it.

Red-first: today every case is R0 (404, no router). Post-build mutation each group
must catch is named in its bullet.
Run: `node --test server/__tests__/project-plans-api.test.js`

### Layer C — CLI-through-API + cross-consumer parity (11 cases)

**C1. `server/__tests__/ccam-cli.test.js` (extend) — slices 2–3 — 7 cases**

Reuse the existing `ccam(...)`/`ccamEnv(...)`/`offline(...)` helpers as-is. Spawn must
stay **async** (`child_process.spawn`) — the server lives in the same process and
`spawnSync` deadlocks. Add one `describe("ccam CLI — ledger")`:

1. `ccam ledger` with no subcommand → exit 1, `Usage: ccam ledger` on stderr.
2. `ccam ledger plans --project <id|name>` → exit 0, prints the seeded title + generation.
3. `ccam ledger pool --project …` → exit 0, prints units and `identityWarnings` when present; `--backfill` accepted.
4. `ccam ledger claim` / `close` round-trip; a second `close` exits 1 carrying the server's 409 reason (proves structured errors survive the CLI formatter).
5. `ccam ledger health` → exit 0, output non-empty, contains no `NaN`/`Invalid Date`. **Value equality is deliberately NOT asserted here — it lives in T6** (one home per §9.1).
6. Offline: ledger **write** verbs refuse with a server-required reason; **reads also refuse** (pool/health math is server-side, matching `cost`) — pins S5.
7. Update the existing `help lists every command group` case's word list with `"ledger"` — this is the test that catches an unregistered dispatch entry.

Run: `node --test server/__tests__/ccam-cli.test.js`

**C2. `server/__tests__/ledger-metrics-parity.test.js` — T6 (new) — slice 3 — 4 cases**

The §9.1 per-shape spec — the deliverable this whole plan is built around, and the
one the catalog's own note says "never gets written." One seeded DB state (2 open
plans, 1 closed generation with a known `closed_at`, claims, a small git fixture
pool), the in-process server, and the real spawned `ccam ledger health`.

| Case | Assertion |
|---|---|
| C2.1 API vs CLI, identical values | For **each** of the four metrics, the CLI output carries the API's value **verbatim** — no tolerance, no rounding. If QDEC-14 (`--json`) is approved: exact `deepEqual` of parsed JSON against the route body. If not: label-anchored extraction (`/unclaimed[^0-9-]*(\d+)/i` → `Number` equality; `lastClosureAt` matched as the exact ISO string) **with an in-file comment declaring the printed labels part of the parity contract**. |
| C2.2 null-shape parity | A project with no closures: the API's pinned null shape renders in the CLI without inventing `0`/`NaN`/`Invalid Date`. |
| C2.3 pool/history parity smoke | `ccam ledger pool` unit count == API pool length; `ccam ledger history` closed-generation count == API history length. |
| C2.4 consumer registry marker | `const CONSUMERS = ["route:/api/project-plans/health", "cli:ccam ledger health"]` with `assert.equal(CONSUMERS.length, 2)` and a message quoting DEC-16. **State in the file that this is a tripwire on the array, not a completeness guard on the surface** — it catches silent widening, it cannot catch a consumer that arrives and never registers (the exact DEC-16 failure mode). |

**Anti-degeneration clause (risk trap T5, and the reason the strategist grades this
as a possible regression-of-a-fix):** T6 must boot one seeded DB and drive **both**
real consumers. A `ccam` test with the API mocked proves the CLI prints what it is
told, not that two consumers derive identical values from one DB state. If the built
spec mocks the API, that is the 2026-08-01 §9.1 cure regressing — a blocking review
finding, not a fresh gap.
Red-proof (R1): hand-roll `daysSinceLastClosure` from `lastClosureAt` inside
`cmdLedger` → C2.1 must go red.
Run: `node --test server/__tests__/ledger-metrics-parity.test.js`

### Layer D — structural / registry meta-scans (7 assertions)

**D1. `server/__tests__/chronology-ordering.test.js` (modify) — slice 3, same commit as `value-ledger.js` — 3 new assertions**

1. **Same-commit registration.** `filesToScan` (`:80-86`, verified hand-typed to 5
   files) gains `server/lib/value-ledger.js`, `server/lib/cwd-identity.js`,
   `server/lib/plan-lifecycle.js`, `server/routes/project-plans.js`.
2. **Derived-scope cure (DEC-9).** Replace the hand-typed list with `fs.readdirSync`
   over `server/lib/*.js` + `server/routes/*.js` plus an explicit per-file disposition
   map (`"scanned"` | `{status:"grandfathered", dated, reason}`). New assertion:
   **every** globbed file has a disposition **and** every dispositioned file exists
   (no stale entries), with a failure message telling the author to disposition it.
3. `GRANDFATHERED_QUERIES.length === 2` **unchanged** — do not widen it to make a
   violation go away.

No new behavioral case here — A6.9 covers the new surface behaviorally; this scan
covers every `LIMIT` in the four new files statically.
Red-proof (R1, mandatory, recorded in build notes): drop a scratch
`server/lib/zz-scratch.js` containing a LIMITed SELECT over `events` with **no**
disposition; the suite must fail on **scope**, not on SQL shape; delete the scratch
file. `server/__tests__/single-writer-guard.test.js` stays **byte-unmodified** — it is
part of the 144 baseline; the closure guard lives in A5.
Run: `node --test server/__tests__/chronology-ordering.test.js`

**D2. `server/__tests__/openapi-contract.test.js` (new) — slice 3 — 4 cases — O-19**

The surface no evaluator document owned, and it is already broken. Derive everything
from `createOpenApiSpec()` in `server/openapi.js` (the declared single source of
truth) — no HTTP needed.

| Case | Assertion |
|---|---|
| D2.1 `operationId` uniqueness across the merged spec | Collect every `operationId` from every method of every path; assert no duplicates, with the failure message naming the colliding pair. **Red today** the moment `/api/project-plans` reuses `getProjectPlans`. |
| D2.2 mount ↔ path completeness | Regex-scan `server/index.js` for `app.use("/api/…")` mounts (32 today); assert each has **at least one** path entry in the spec, modulo a `GRANDFATHERED_MOUNTS` array carrying a dated reason per entry (populate at authoring time from whatever is genuinely absent **after** the D2.4 regeneration — the known candidates are `topology`, `intake-status`, `color-thresholds`, `terminal-focus`). Length-assert the array with a "do not widen" message, same convention as `GRANDFATHERED_QUERIES`. |
| D2.3 the new namespace is fully specced | Every route declared in `server/routes/project-plans.js` (`pool`, `health`, `history`, `import`, `items`, `claims`, `:id`, `:id/close`) has a path entry with an `operationId`. |
| D2.4 `openapi.yaml` round-trip | Re-run the generator's transform in-memory (`yaml.dump(createOpenApiSpec(), {lineWidth:-1, noRefs:true, sortKeys:false})` + the two header lines, exactly as `scripts/generate-openapi-yaml.js` does) and byte-compare against the committed `openapi.yaml`. Failure message: *"run `npm run openapi:yaml` and commit the result."* **This is red on master today** (last regenerated 2026-07-30) and is fixed by the regeneration build step, not by weakening the test. |

**Build steps this spec forces (not optional):** create
`server/openapi-extra/project-plans.js` with **non-colliding** operationIds —
`listPortfolioPlans`, `getPortfolioPlan`, `createPortfolioPlan`,
`closePortfolioPlan`, `importPortfolioPlan`, `createPortfolioPlanItem`,
`updatePortfolioPlanItem`, `deletePortfolioPlanItem`, `createValueClaim`,
`deleteValueClaim`, `getValuePool`, `getLedgerHealth`, `getLedgerHistory` — register
it in `server/openapi-extra.js` (fragments are hand-enumerated there at `:13-26`,
`:52` — that enumeration **is** the CONTRACT-SPEC-DRIFT mechanism), and run
`npm run openapi:yaml`. **The legacy `getProjectPlans` at
`server/openapi-extra/plans.js:236` is shipped contract and is NOT renamed** —
namespacing the new ids is the fix (QDEC-8).
Run: `node --test server/__tests__/openapi-contract.test.js`

### Layer E — i18n registry (2 cases) — **slice 1, not slice 5**

**E1. `client/src/i18n/__tests__/i18n.test.ts` (modify) — O-8 / M4**

Moved out of `PlanLedgerPanel.test.tsx` deliberately — see "Layer reconciliation".

| Case | Assertion |
|---|---|
| E1.1 whole-namespace key-set parity | Loop all 21 namespaces × 4 locales (en/ko/vi/zh): `deepEqual(sorted(keys(en)), sorted(keys(locale)))` after **stripping/exempting** `_one\|_two\|_few\|_many\|_zero` suffixes for single-plural-form locales. Without that exemption this lands red on day one on ~8 legitimate pairs (`plugins.skills_one`, `sessionCount_one`, `concurrency.active_one`, …) — and a parity test that goes red for a legitimate reason on its first run gets weakened, not fixed. |
| E1.2 the one real divergence, fixed in the same commit | `sessions:remoteSourceBadgeTitle` exists in `en` only (its ko/vi/zh translations live under `settings.json`). Fix the locale files; E1.1 then passes today and holds for every future feature. |

Red-first: E1.1 is **genuinely red on master right now** (E1.2's divergence) — that is
the recorded red state; it goes green when the locale files are fixed. Retire the
per-build hand-typed key block after this lands.
Run: `cd client && npx vitest run src/i18n/__tests__/i18n.test.ts`

### Layer F — client component/page/snapshot (9 cases) — **slice 5 only, after the DEC-12 gate**

**F1. `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (new) — T7 — 7 cases**

Sibling convention of `OpenTerminalModal.test.tsx` / `PlanPanel.test.tsx`: vitest +
RTL, `vi.mock("../../lib/api")`.

Left pane renders 2 open plans with nested items (child nested, proven with `within`) ·
pool units render one badge per emitting tier, with the mocked `value_source` values
**derived from the `ValueUnit` type union** so a new source without a badge decision
fails typecheck *and* this case · claim gesture calls `api.projectPlans.claim` exactly
once with `(planId/itemId, unit)` and the unit disappears after the mocked refetch ·
close calls `api.projectPlans.close` and the plan moves to the collapsed
closed-generations list · **health rendered verbatim**: mocked
`health.unclaimedPoolSize = 37` while the mocked pool array has length **5** → the
panel shows **37**, and `lastClosureAt: null` renders the null state with no
`NaN`/`Invalid Date` in `container.textContent` · a closed generation exposes no
item-edit/claim/unclaim affordances · no raw `projectDetail.…` key leaks into the DOM
(regex on `container.textContent`). Locale parity is **not** asserted here — E1 owns it.

Red-proof (R1): temporarily render `pool.length` as the headline number → the
health-verbatim case must go red.

**F2. `client/src/pages/__tests__/ProjectDetail.test.tsx` (update) — 1 case**

With `api.projectPlans.*` mocked **in the shared setup, not per-case**, Project Detail
renders the PlanLedgerPanel card beside its existing cards; the existing 15 cases stay
green.

**F3. `client/src/pages/__tests__/screens.snapshot.test.tsx` (reviewed regen) — 1 case**

Add `api.projectPlans` responses to the "Project detail" screen's mock fixture block
(~`:653`) so the panel renders deterministically. Regenerate with
`cd client && npx vitest run -u`. **The only changed snapshot must be Project Detail
(+ shell chrome), and the diff must show the panel's markup, not empty/error states.**
See the sequencing warning below — a regen on today's dirty tree would launder a
sibling effort's unreviewed UI diff into reviewed baselines, which `CLAUDE.md`
explicitly forbids.

### Fixtures / test data

Reuse; invent nothing. Copy sources verbatim:

| Fixture | Copy from | Used by |
|---|---|---|
| Tmp DB per suite (`DASHBOARD_DB_PATH` + `delete require.cache[require.resolve("../db")]`) | `chronology-ordering.test.js:190-207` | A2, A3, A5, A6 |
| Live in-process app (`createApp()` + `startServer(app, 0)` + fetch/post helpers) | `plans-api.test.js:23-93` | A2 route negatives, A6 `/pool`, B1, C2 |
| Real throwaway git repos (`ISOLATED_GIT_ENV`, `makeRepo`, `git()`, `fs.realpathSync(mkdtemp)`) | `intake-scan.test.js:31-78` | A3, A4, A6 |
| Worktree fixture (`git worktree add`) | `intake-scan.test.js:197-215` | A4, A6.8, A6.11(c) |
| Backdated commits | `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` on the fixture `git()` helper | A6.3, A6.4 |
| Scrambled id vs `created_at` + `assertOrderedByCreatedAt` | `server/__tests__/helpers/ordering.js` via `chronology-ordering.test.js:396-464` | A6.9 |
| Export-derived single-home scan | **`server/__tests__/helpers/single-home.js`** (arrives with the DEC-2 merge) | A3.6, A5 closure guard, A4 single-home guard |
| Generic source walker `scanFiles(dir, pattern)` | `single-writer-guard.test.js:16-39` | A2 structural negatives (where `assertSingleHome` doesn't fit) |
| Async CLI spawn against the in-process server | `ccam-cli.test.js:41-61` | C1, C2 |
| Legacy-shape DB boot harness | `db-migration.test.js` (**no** new `UPGRADE_CASES` entry) | A1 |
| Component-with-api-mock | `PlanPanel.test.tsx` / `OpenTerminalModal.test.tsx` | F1 |

Canonical registries these tests must **derive from, never hand-retype**: the exported
`VALUE_SOURCES` / `ATTRIBUTION_TIERS` / `TRUNK_DRIFT_SKIP_REASONS`, the `CHECK(...)`
text read out of `sqlite_master`, `Object.keys(require("../lib/plan-lifecycle"))`,
`createOpenApiSpec()`, and the on-disk `server/lib/*.js` + `server/routes/*.js` glob.

---

## Layer reconciliation — what I moved, and why

Explicit record of every place this plan diverges from the two architects' designs, so
build review can see which obligations were designed in versus added at reconciliation
(§9.4 provenance rule).

1. **Cross-seam `unitKey` agreement → unit layer only, in `value-pool.test.js`
   (A6.8), with a diagnostic in `cwd-identity.test.js` (A4).** The strategist proposed
   it in both T5 and T3. One home: the failure is an *assembly* failure and only T3
   owns real git fixtures + `project_paths` seeding + full `assembleValuePool`.
   Duplicating it in T5 would mean two fixtures for one invariant and, historically,
   one of the two rotting. T5 keeps the single-casing UNIQUE/cardinality cases as its
   own complement.
2. **Locale key parity moved OUT of `PlanLedgerPanel.test.tsx` and OUT of slice 5,
   INTO `i18n.test.ts` at slice 1.** The unit architect parked it inside a component
   spec. Wrong home three times over: it is DEC-12-gated (if Sara answers "noise" it
   never ships), it covers only this feature's keys, and a locale-registry invariant
   living in a component spec is nobody's file — the precise mechanism §9.1's
   2026-08-01 note blames for per-shape specs never being written. It is not UI work.
3. **`ccam ledger health` value equality moved out of `ccam-cli.test.js` case 5 into
   T6.** The e2e design had the CLI spec "spot-check by string match against a fresh
   `GET /health`". That is the parity invariant with two homes. `ccam-cli.test.js`
   keeps exit codes, usage, offline posture and no-`NaN`; T6 owns value equality.
4. **T5's static closure single-writer guard and B1's C4 behavioral closed-door sweep
   are KEPT AS COMPLEMENTS — deliberately not deduped.** They have distinct jobs: C4
   proves no *HTTP verb* transitions an open plan to closed; T5 proves no *second code
   path* writes the closure, including ones with no route. Either alone leaves a real
   hole. Same reasoning keeps both the T5 stmt-level `SQLITE_CONSTRAINT` case and B1's
   D2 route-level 409 case (S2 is an error-*mapping* risk, not a constraint risk), and
   both the T2 `PRAGMA table_info` no-`closed_at` case and B1's F3 no-closed-flag-in-JSON
   case (different artifacts: DB column set vs response payload).
5. **Pool permutations stay down at the unit layer; e2e Group E keeps shape pins only.**
   Ratified as the e2e architect designed it — B1's E3 explicitly does not re-prove
   depth/dedupe/ratchet. This is the "push permutations down, keep e2e to the minimum
   flow proof" split.
6. **WS assertions stay lib-level with an injected `broadcast` collector (A2's
   allowlist case) plus B1's read-back proof. No live-WS harness is added** — no spec
   in this repo opens a WS client and this feature is not the place to invent one.
7. **The OpenAPI obligation became its own spec (D2) rather than cases appended to
   `api.test.js`.** It is a per-*artifact* invariant, not a per-module one; the whole
   lesson of §9.1's QA note is that such obligations need a named file or they are
   never written.
8. **Dropped from the intake QA's original T1 scope:** `UPGRADE_CASES`/`REBUILD_CASES`/
   interruption cases (no rebuild exists in this design — the tech lead's override
   stands) and the "consciously rewrite the deletes-removed-numbers case" instruction
   (`plan-ingest.test.js` stays green **and byte-unmodified**; under the additive design
   that case remains correct for the legacy layer).

---

## Implementation steps

Numbered, dependency-ordered, each independently checkable. **O-n = obligation id**;
these are the build checklist. Every step names its red-first expectation.

### Slice 0 — DEC-2 merge (blocking; not our code)

1. **O-1.** Run `git worktree list` **and** check for running Claude sessions
   (`ps`/`lsof`) before any git operation. Three checkouts hold uncommitted
   `server/lib/` work and project memory records real work loss from exactly this.
2. **O-2.** Merge trunk-drift Phase 1a to `master`
   (`server/lib/git-refs.js`, `server/lib/trunk-drift.js`, their specs, and
   **`server/__tests__/helpers/single-home.js`**). Do not hand-roll a second trunk
   walker or a second scope-derivation helper under any schedule pressure.
3. **O-3.** **Re-confirm `detectTrunkDrift`'s real merged export** against every planned
   usage — the full signature `(repoPath, {seenShas, lookbackDays, maxCommits, timeout,
   now})`, the `{commits[].sha}` / `{skipped: reason}` return shapes, and especially
   whether `seenShas` is an **exclusion set** or a since-marker. If it is a since-marker,
   A6.3's ratchet case passes for the wrong reason and must be redesigned. Also confirm
   `isGitRepo` is imported from `server/lib/repo-topology.js:39/:219` (the plan
   misstates its home as `git-refs.js`). Record the confirmation in build notes and
   close it against **QDEC-18**.
4. **O-4.** **Re-baseline on a clean tree**: 241/241 (see "Regression floor"). Today's
   baseline was taken against 60 dirty paths.

### Slice 1 — schema + import (gated by O-5…O-9)

5. **O-5.** Add the three `CREATE TABLE IF NOT EXISTS` blocks + indexes + ~17 prepared
   statements to `server/db.js`. **Locate the insertion point by grep, never by line
   number** — `db.js` carries +129 uncommitted lines right now and the plan's "~line 696"
   anchor is moving. Write **A1** first: R0 red (tables absent) → green after the DDL;
   then R1-red A1.3 by mutating to `DROP+CREATE`.
6. **O-6.** Add `server/lib/cwd-identity.js` + **A4** (`cwd-identity.test.js`, 10 cases,
   incl. the O-7b seam-agreement diagnostic). R0 red → green; R1 red by calling
   `realpathSync` from another module.
7. **O-7.** Add `server/lib/plan-lifecycle.js` (CRUD, `generationOrdinal`,
   `importGenerationFromPlan`) + `server/routes/project-plans.js` (plan/item/import
   endpoints only) mounted in `server/index.js`. Write **A2** (19 cases) and **A3**
   (6 cases) and the **B1** skeleton (Groups A/B/G + partial C4). Idempotency key is
   `(project_id, imported_content_hash)` — **never cwd**. A3.6 must be an
   `assertSingleHome` call site; R1-red it by injecting `DELETE FROM
   project_plan_items` into `plan-ingest.js` and confirming **both** A3.6 and A3.5(b)
   fail, then confirming the helper actually loads (inject an undispositioned export).
8. **O-8.** **`i18n.test.ts` whole-namespace parity (E1)** — ships here, not slice 5.
   Red on the live tree today via `sessions:remoteSourceBadgeTitle`; fix the four locale
   files in the same commit. Plural-suffix exemption is mandatory or it lands red on 8
   legitimate pairs and gets weakened.
9. **O-9.** Slice-1 gate: `npm run test:server` + `npm run test:client` green, the
   144-floor green with **zero behaviour edits**, `plan-ingest.test.js` byte-unmodified,
   header check exits 0, docs pass.

### Slice 2 — claims + close

10. **O-10.** Add `value_claims` write/read usage + `POST /:id/claims` +
    `DELETE /claims/:claimId`. `source_cwd` canonicalized at write time through
    `cwd-identity.js`; snapshots are reference + one-line summary only (DEC-P4).
11. **O-11.** Implement `closePlan` as the **single closure composer**: one transaction,
    one row, both broadcasts, nothing writes a closed flag onto claims.
12. **O-12.** Write **A5** (`value-ledger.test.js`, 13 cases) including the
    `source_cwd ''`-not-NULL **executable** proof (seed a nullable variant table and show
    both rows insert — a DDL read does not prove it) and the `assertSingleHome` closure
    guard. R1-red the guard by injecting a second `closeProjectPlan` call site.
13. **O-13.** Complete **B1** Groups C and D (closure + cardinality, incl. the D2
    409-not-500 mapping) and add `ccam ledger plans|claim|close` with **C1** cases 1–4, 7.
14. **O-14.** Slice-2 gate: A5 + B1 C/D green, both R1 reds recorded in build notes.

### Slice 3 — pool + health + parity + the durable cures

15. **O-15.** Add `server/lib/value-ledger.js` (assembly order per technical-plan §4.12:
    intake → trunk → detours → correlational last → subtract claimed → dedupe by
    `unitKey`), `computePlanHealth`, `summarizeDeliveredValue`; wire `/pool`, `/health`,
    `/history` and `ccam ledger pool|health|history`. Export the row→unit mapper (A6.6
    needs it).
16. **O-16. DEC-4 dedupe — all three parts, in `value-pool.test.js`:**
    **(a)** pragma-seeded full-assembly test (A6.5) with a written justification block
    next to the pragma: *"This fixture is future-real, not never-real — trunk-drift
    Phase 1b will produce this row through a production writer. It is seeded under
    `ignore_check_constraints` only because the CHECK has not been widened yet. §9.3's
    B4 shape is accepted here on that basis. Do not delete this test; see A6.7."*
    **(b)** exported-mapper diagnostic (A6.6). **(c)** the **CHECK-still-excludes-
    `'trunk_drift'` tripwire** (A6.7) whose failure message is the instruction to
    re-verify at Phase 1b, including that `source_ref` carries a full 40-char sha.
    R1-red (a) by deleting the `unitKey`-collapse step.
17. **O-17. Cross-seam `unitKey` agreement (A6.8)** — the highest-value missing
    assertion in the whole set. R1-red by removing canonicalization from the claim-write
    seam **only**.
18. **O-18. §9.7 cure (D1), in the same commit as O-15:** register the four files, then
    replace `filesToScan` with the derived glob + disposition map. R1-red with the
    `server/lib/zz-scratch.js` scratch file — the suite must fail on **scope**, not on SQL
    shape — and record it in build notes. If the derived scan surfaces a large
    pre-existing violator set, the **bounded fallback may only be taken with a dated
    `decisions.md` row naming that set and the remainder** (QDEC-5). Never weaken the scan.
19. **O-19. OpenAPI contract (D2):** author `server/openapi-extra/project-plans.js` with
    the namespaced operationIds, register it in `server/openapi-extra.js`, write
    `openapi-contract.test.js` (4 cases), then run `npm run openapi:yaml` and commit the
    regenerated `openapi.yaml`. Red-first order matters: D2.1 is red the moment a
    colliding id is authored (prove it by temporarily naming one `getProjectPlans`);
    D2.4 is **already red on master** and goes green with the regeneration.
20. **O-20.** Write the rest of **A6** (11 cases) and **T6/C2** (4 cases) and complete
    **B1** Groups E/F/S plus **C1** cases 5–6. T6 must drive both real consumers off one
    seeded DB — see the anti-degeneration clause.
21. **O-21.** Slice-3 gate: A6 + C2 + D1 + D2 + B1 complete and green; all R1 reds
    recorded; `grep -rn "assert.ok(true" server/__tests__/` and
    `grep -rn "|| true" server/__tests__/` both at **0**; `GRANDFATHERED_QUERIES.length`
    still 2; the "zero `ALTER`, zero rebuilds" grep run **against this change-set's diff**
    (`git diff master...HEAD -- server/db.js`), never the whole tree — master already
    carries +129 uncommitted `db.js` lines that can both false-positive and launder a
    smuggled change.

### Slice 4 — Sara's checkpoint (a gate, not a demo; auto-pilot cannot answer it)

22. **O-22.** Run the 8-step checkpoint script below in order. Preconditions, in order:
    **DEC-13 `DND`/`dnd` project merge done in the dashboard UI first** (otherwise the
    gate measures a double-counted fleet and its verdict means nothing) → stop the server
    → back up the DB → restart. `$PORT` = the real dashboard port; `$PROJ` = Coaching
    Assistant's project id (`curl -s localhost:$PORT/api/projects | jq`); `$CWD` = its
    repo root.

| Step | Command | Gate evidence |
|---|---|---|
| 0 | `sqlite3 ~/.claude/agent-dashboard/dashboard.db ".backup ~/.claude/agent-dashboard/dashboard.db.bak-$(date +%Y%m%d)"` | Backup exists; dashboard boots after restart; focus, pace, detours, decision queue and Project Detail look unchanged |
| 1 | `ccam ledger health --project "$PROJ"` | Pre-import baseline: `openPlanCount 0`, empty/near-empty pool — the before-state |
| 2 | `curl -s -X POST localhost:$PORT/api/project-plans/import -H 'Content-Type: application/json' -d "{\"project_id\":\"$PROJ\",\"cwd\":\"$CWD\"}"` | Generation-1 plan, `origin:"import"`, item count and nesting match the real `AGENT-PLAN.md`. **Run it twice** — the second response returns the same `plan.id`, no gen-2 (I-3 in the wild) |
| 3 | `ccam ledger pool --project "$PROJ"` then again with `--backfill` | Trunk commits + ~30 intake initiatives with believable tiers. **Read `identityWarnings` out loud** — any case-variant or worktree warning is itself checkpoint data and the CWD-IDENTITY-FANOUT promotion trigger |
| 4 | `ccam ledger claim …` for ≥1 `mechanical` and ≥1 `correlational` unit into imported items | Pool size drops by **exactly** the number of distinct claimed units (`ccam ledger health` before/after); re-claiming the same unit into the same item is refused with the 409 reason |
| 5 | `curl -s -X POST localhost:$PORT/api/project-plans -H 'Content-Type: application/json' -d "{\"project_id\":\"$PROJ\",\"title\":\"Retroactive: detours to date\",\"origin\":\"retroactive_bundle\"}"`, claim detour units into it, then `ccam ledger close --project "$PROJ" <planId> --note "retro bundle closed at checkpoint"` | Close succeeds once and stamps `closed_at`; a second close is refused |
| 6 | `ccam ledger history --project "$PROJ"` | **AC-6**: "what value did this project deliver?" answered from closed generations + claims **alone**, no archaeology |
| 7 | Restart the server; re-run `ccam ledger health`, `pool`, `history` | Claims and the closed generation survived; nothing re-imported or re-derived; pool identical minus claimed units (I-2/I-3 in the wild) |
| 8 | Sara records the verdict — **"is this pool signal or noise?"** — as the DEC-12 status update in `decisions.md` | **Slice 5 stays blocked until this row is answered. Auto-pilot cannot write it.** If the health number miscounts, promote CWD-IDENTITY-FANOUT to a real catalog entry per its recorded trigger |

*Precedent for treating this literally: `wip-queue-page` (2026-07-30) was fully reverted
two days later (`18196dc`) for shipping a portfolio UI before anyone checked the
underlying data was worth rendering.*

### Slice 5 — UI (only after step 8 is answered)

23. **O-23.** `types.ts` + `api.ts` additions; `PlanLedgerPanel.tsx`; render slot in
    `ProjectDetail.tsx`; strings into the existing `projectDetail.json` ×4 (no new
    namespace, route or nav entry). Write **F1** (7 cases) and **F2** (1 case).
    R1-red the health-verbatim case by temporarily rendering `pool.length`.
24. **O-24.** Snapshot regen (**F3**) — **on a tree containing only this effort's UI
    diff.** `cd client && npx vitest run -u`, then review the diff: only Project Detail
    (+ shell chrome) may change and the diff must show the panel's markup, not empty or
    error states. Never blind-regen.

---

## Single-source-of-truth guardrail

This project's canonical-registry convention is **one server-side computation module,
exported vocabularies, consumers named and tested** (`pace.js`, `DISPOSITIONS`,
`decision-queue-enqueue.js` are the existing instances). Five registries drive rendered
outputs here, and every one of them is asserted **derived**, never hand-blessed:

1. **`server/lib/value-ledger.js` owns every derived value.** `unclaimedPoolSize`,
   `lastClosureAt`/`daysSinceLastClosure`, the pool, the generation ordinal and the
   whole-life summary are computed nowhere else. Pinned by T6 (route vs CLI, verbatim),
   F1's health-verbatim case (client renders 37 while the pool array is length 5), and
   C1 case 5's explicit refusal to re-assert values.
2. **`VALUE_SOURCES` / `ATTRIBUTION_TIERS` mirror the SQL `CHECK` lists.** A5 parses the
   CHECK text out of `sqlite_master` and `deepEqual`s it against the export **in both
   directions**, and additionally requires every member to carry a disposition in a map
   whose `Object.keys` set-equals the export — a 6th source cannot ship green in either
   home, nor without a test decision. Routes validate against the export, and A5 asserts
   the 400 body's allowed-value array **equals the export** so a route cannot hand-type
   its own copy.
3. **`cwd-identity.js` is the only canonicalizer.** A4's allowed-set scan proves no other
   module under `server/lib` or `server/routes` calls `realpathSync`,
   `rev-parse --show-toplevel` or `--git-common-dir` on a plan/pool path; A6.8 proves the
   three seams **agree**, which is the part a single-home scan alone cannot show.
4. **`server/openapi.js`'s `createOpenApiSpec()` is the declared source of truth for the
   HTTP contract, and `openapi.yaml` is a generated mirror.** D2.4 byte-compares the
   committed YAML against a freshly generated dump — the test **never blesses a
   hand-edited `openapi.yaml`**; its failure message is "run `npm run openapi:yaml`".
   D2.2 derives the expected surface from the router mounts in `server/index.js`, not
   from a per-feature list.
5. **`filesToScan` is derived from the on-disk `server/lib/*.js` + `server/routes/*.js`
   glob** (D1), so the registry cannot silently fall behind the artifact it describes.

---

## Durable-cure decision

**Call: take all four durable cures NOW, in this change-set.** They are the entire
difference between GAPPED and ADEQUATE, and three of the four are cheap because the
hard part already exists.

| Cure | Now? | Where | Consequence of deferring |
|---|---|---|---|
| **Derived `filesToScan` scope** (DEC-9 / O-18) | **YES** | `chronology-ordering.test.js` | §9.7 recurs for the **7th** time on the build that could have been its second clean call site, and every §9.2 obligation inside `value-ledger.js` sits unenforced while the suite is green and the DoD shows a tick |
| **Consume `assertSingleHome`** rather than re-derive (O-7/O-12) | **YES** | A3.6, A5 closure guard, A4 | A second hand-rolled scope-derivation helper is §9.1's "scan for copies of its *helpers* too" lesson recurring at the guard level **within the same week** the cure was built |
| **Whole-namespace locale parity** (M4 / O-8) | **YES, in slice 1** | `i18n.test.ts` | Ships a locale registry that only covers keys someone remembered to type; and if it stays in slice 5 it dies entirely the moment Sara answers "noise" at the gate. ~15 lines retires the per-build key-block accretion permanently |
| **OpenAPI contract test + regen** (M2 / O-19) | **YES, in slice 3** | new `openapi-contract.test.js` | This feature ships a **colliding `operationId`** onto the artifact `server/README.md:523` calls the source of truth for request/response contracts, on top of four route families already missing since 2026-07-30. First guard for the CONTRACT-SPEC-DRIFT candidate pattern |

**The escape hatch, closed:** DEC-9's bounded fallback (register the four files, defer
the derived scope) remains available **only** with a dated `decisions.md` row naming
the pre-existing violator set and the remainder — never as the silent default under
schedule pressure (QDEC-5, restated as a DoD line below).

**What is deliberately NOT built now:** a live-WS test harness (no precedent, not this
feature's job); a `CONSUMERS` completeness guard derived from the surface rather than a
length assertion (recorded in C2.4 as a known limitation and tracked by DEC-16); a
pool-assembly perf budget or cache (tracked as a WATCH with an escalation trigger —
QDEC-17); MCP plan tools (DEC-16).

---

## Regression floor

The observed baseline is **241/241, zero failures** (cartographer, 2026-08-02) — but it
was taken against a **dirty tree of 60 modified paths**. **Re-baseline on a clean tree
after the DEC-2 merge, before slice 1 (O-4).** Rerun commands, verbatim:

```bash
# 144-case nine-spec plan-surface floor — must stay green with ZERO behaviour edits
node --test server/__tests__/plan-ingest.test.js server/__tests__/plans-api.test.js \
  server/__tests__/plan-writeback.test.js server/__tests__/detour-disposition.test.js \
  server/__tests__/db-migration.test.js server/__tests__/reconciliation-full-tick.test.js \
  server/__tests__/chronology-ordering.test.js server/__tests__/single-writer-guard.test.js \
  server/__tests__/pace-tracking.test.js

# 27 pool-adjacent (the feeds the new assembly reads)
node --test server/__tests__/intake-scan.test.js server/__tests__/repo-topology.test.js

# 34 client slice-5 host
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx \
  src/pages/__tests__/screens.snapshot.test.tsx

# 36 DEC-2 dependency (in the trunk-drift worktree pre-merge; on master post-merge)
node --test server/__tests__/git-refs.test.js server/__tests__/trunk-drift.test.js
```

Only two files in the 144 floor may be modified at all, and only as specified here:
`db-migration.test.js` (A1 extension) and `chronology-ordering.test.js` (D1 scope work).
Everything else — **especially `plan-ingest.test.js` and `single-writer-guard.test.js`** —
stays byte-unmodified. **If any of the 144 needs a behaviour edit, the additive design
has been violated**; that is a blocking finding, not a test fix. Any test edited between
red-authoring and green must be named in build notes with its reason (risk trap T7: the
fix direction under schedule pressure is to weaken the assertion, not strengthen the code).

---

## How to run

```bash
# Full server layer (all new specs run under this — node --test server/__tests__/*.test.js)
npm run test:server

# Single specs — server
node --test server/__tests__/db-migration.test.js            # A1 / T1
node --test server/__tests__/plan-lifecycle.test.js          # A2 / T2
node --test server/__tests__/plan-import-inversion.test.js   # A3 / T4
node --test server/__tests__/cwd-identity.test.js            # A4
node --test server/__tests__/value-ledger.test.js            # A5 / T5
node --test server/__tests__/value-pool.test.js              # A6 / T3
node --test server/__tests__/project-plans-api.test.js       # B1
node --test server/__tests__/ccam-cli.test.js                # C1
node --test server/__tests__/ledger-metrics-parity.test.js   # C2 / T6
node --test server/__tests__/chronology-ordering.test.js     # D1
node --test server/__tests__/openapi-contract.test.js        # D2

# Client layer
npm run test:client
cd client && npx vitest run src/i18n/__tests__/i18n.test.ts                       # E1
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx     # F1
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx            # F2
cd client && npx vitest run -u    # F3 — snapshot regen, reviewed diff only, clean tree only

# Contract artifact regeneration (a build step, not a test)
npm run openapi:yaml

# Hygiene gates that bind these specs
bash .claude/skills/file-headers/scripts/check-headers.sh   # must exit 0
grep -rn "assert.ok(true" server/__tests__/                 # must stay empty
grep -rn "|| true" server/__tests__/                        # must stay empty
git diff master...HEAD -- server/db.js | grep -nE "ALTER TABLE|RENAME TO .*_old|CREATE TABLE .*_new"   # must be empty
```

No MCP change in this effort, so `npm run mcp:typecheck` / `mcp:build` are unaffected
(DEC-16). No stack prerequisite: every spec self-hosts on port 0 against its own temp
DB. The slice-4 checkpoint script is the **only** thing that touches the real dashboard
and the real DB.

---

## Definition of Done

**Red-first evidence**

- [ ] Every new spec observed **R0 red** (module-absence / 404 / exit 1) before its module existed, and **green** after.
- [ ] Every structural guard observed **R1 red** by mutation, with the mutation named in build notes: rogue `DELETE FROM project_plan_items` injected into `plan-ingest.js` (A3.6 **and** A3.5(b) both fail) · second `closeProjectPlan` call site injected (A5 closure guard) · `unitKey`-collapse step deleted (A6.5) · canonicalization removed from the claim-write seam only (A6.8) · `seenShas` pass-through dropped (A6.3) · bracket ORDER BY swapped to `id` (A6.9) · `server/lib/zz-scratch.js` scratch file fails the scan **on scope** (D1) · a colliding `operationId` fails D2.1 · `pool.length` rendered as the headline number fails F1.
- [ ] `assertSingleHome`'s new call sites were verified to **actually load and actually fail** on an injected undispositioned export — not merely to be present. (The build that shipped this helper anchored its path resolution to the wrong directory, so the scan never ran while the DoD showed a tick.)
- [ ] §9.3 sweeps at **0**: `grep -rn "assert.ok(true" server/__tests__/` and `grep -rn "|| true" server/__tests__/`.

**Suite state**

- [ ] `npm run test:server` and `npm run test:client` green.
- [ ] The 241/241 floor re-baselined on a clean tree post-DEC-2 and green; the 144 nine-spec floor green with **zero behaviour edits**; `plan-ingest.test.js` and `single-writer-guard.test.js` byte-unmodified.
- [ ] All obligations O-1…O-24 satisfied; ~120 new/changed cases exist and pass.

**Registry / source-of-truth in sync**

- [ ] `VALUE_SOURCES` / `ATTRIBUTION_TIERS` / `status` `deepEqual` the `sqlite_master` CHECK lists in both directions, and every source carries a test disposition.
- [ ] `filesToScan` is **derived** from `server/lib/*.js` + `server/routes/*.js` with per-file dispositions (or DEC-9's bounded fallback is recorded as a **dated `decisions.md` row naming the pre-existing violator set** — QDEC-5); `GRANDFATHERED_QUERIES.length` still **2**.
- [ ] The four new server files are registered in the chronology scan **in the same commit** as `value-ledger.js` (O-18), not a follow-up.
- [ ] `server/openapi-extra/project-plans.js` exists with **non-colliding** operationIds, is registered in `server/openapi-extra.js`, `npm run openapi:yaml` was run, and the regenerated `openapi.yaml` is committed in the same change-set; D2.4's round-trip is green.
- [ ] `i18n.test.ts` whole-namespace parity green across 21 namespaces × 4 locales, with the plural-suffix exemption, and `sessions:remoteSourceBadgeTitle` fixed.

**Design-invariant proofs (§9.3 mutation checks + grep-proofs)**

- [ ] No `closed_at`/closed flag on `value_claims` — proven by exact `PRAGMA table_info` set equality (A2), by JSON key enumeration (B1 F3), and by grep.
- [ ] Zero `ALTER TABLE`, zero rebuilds **in this change-set's diff** (`git diff master...HEAD -- server/db.js`), not in a whole-tree grep.
- [ ] `plan-ingest.js`, `plan-writeback.js`, `reconciliation.js`, `pace.js`, `routes/plans.js` unmodified; `/api/plans` shapes and the `plan_updated` WS payload unchanged; the two new WS types are the **only** additions (A2's allowlist case).
- [ ] No `server/lib/value-pool.js` exists (DEC-5) — enforced by A3.6's allowed-set assertions.
- [ ] T6 drives **both real consumers** off one seeded DB; it does **not** mock the API (a mocked-API T6 is the §9.1 cure regressing — blocking finding).

**Process / disclosure**

- [ ] Every review-round finding ended as *fixed-with-a-test* or *recorded-in-`decisions.md`-with-an-id* (§9.4), including the fix round's own adversarial pass.
- [ ] Any test edited between red-authoring and green is named in build notes with its reason (trap T7).
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0; docs pass (`docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`, `README.md`, `server/README.md`) in the same change-set.

**Sara's gates — this box, not the suite, is sign-off**

- [ ] DB backed up; **DEC-13 `DND`/`dnd` merge done before the trial** (else the gate measures a double-counted fleet).
- [ ] The 8-step slice-4 checkpoint script run in order, `identityWarnings` read out loud, and **DEC-12 answered in `decisions.md`** before slice 5 starts. Auto-pilot cannot waive or write this.
- [ ] Sara has ruled on the three items only she can rule on: **durable cures now vs later** (QDEC-13 — plan assumes *now*), **`ccam ledger health --json`** (QDEC-14 — T6 falls back to label-anchored regex if declined), and **S1 unknown-project 404 semantics** (QDEC-15 — B1 Group S is written to the recommendation and must be inverted if she rules otherwise).

---

## Sequencing notes (read before the first commit)

1. **Trunk-drift Phase 1a merges first (DEC-2).** It is a hard gate on slice 1, and it
   carries `server/__tests__/helpers/single-home.js`, which three obligations here
   consume. Nothing of it is on `master` today.
2. **Re-confirm `detectTrunkDrift`'s signature at merge (O-3).** Every A6 case is
   currently designed against an **uncommitted worktree** export. `seenShas`
   exclusion-set-vs-since-marker is the specific semantic that, if wrong, makes A6.3
   pass for the wrong reason.
3. **`server/db.js` anchors move.** Locate the DDL insertion point by grep. The plan's
   "after `detour_dispositions`, ~line 696" is accurate against a clean tree only, and
   master's working tree holds +129 uncommitted lines there.
4. **Master's dirty tree overlaps slice-5 files.** `ProjectDetail.tsx` (+1,287 lines),
   `api.ts`, `types.ts`, `projectDetail.json` ×4 and `screens.snapshot.test.tsx.snap`
   are dirty on master **and** modified in the trunk-drift worktree. **Never blind-regen
   snapshots** — a regen on today's tree would launder a sibling effort's unreviewed UI
   diff into reviewed baselines, which `CLAUDE.md` forbids outright. F3 runs only on a
   tree containing this effort's UI diff and nothing else.
5. **`git worktree list` + a running-session check before every git operation.** Project
   memory records real work loss from exactly this configuration, and
   `PROJECT-CONTEXT.md` was edited by another live session *during* the QA pass itself.
6. **The four new files must enter `chronology-ordering.test.js` in the same commit as
   `value-ledger.js`** (O-18) — a follow-up commit is how §9.7 reaches occurrence 7.
