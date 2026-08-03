# Build Task List — plan-lifecycle-value-ledger

**Build scope:** slices 1–3 (schema + import + claims + close + pool + health).
**Slice 4:** Sara's checkpoint gate (not in this build).
**Slice 5:** UI (gated behind slice 4; not in this build).

**Effort worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-plan-lifecycle-value-ledger/Claude-Code-Agent-Monitor`

**Repository:** `Claude-Code-Agent-Monitor` (monorepo)

---

## Task sequence (red-first, dependency-ordered)

### SLICE 1 — Schema + import (14 tasks)

#### T1.1 — TEST (Red-first: R0)
- **Description:** Spec T1 skeleton — schema boot test (legacy-shape DB gains the three new tables).
- **Files:** `server/__tests__/db-migration.test.js` (add one `describe("additive portfolio-layer tables")`)
- **Component:** database / schema migration
- **Test step:** A1 case framework only (4 test stubs, all R0 red: module-absence).
- **Done-check:** `node --test server/__tests__/db-migration.test.js` → test exists and fails with R0 (tables absent); `grep "additive portfolio-layer" server/__tests__/db-migration.test.js` returns match.

#### T1.2 — IMPLEMENTATION (Schema: create tables)
- **Description:** Add three `CREATE TABLE IF NOT EXISTS` blocks + indexes to `server/db.js`; locate insertion point by grep for `detour_dispositions`, not line number.
- **Files:** `server/db.js`
- **Component:** database / schema
- **Implementation step:** O-5, technical-plan §3.1. Add `project_plans`, `project_plan_items`, `value_claims` with full vocabularies for `status`, `value_source`, `attribution` in the initial `CREATE TABLE` (CHECK lists). Add 8 indexes.
- **Done-check:** `grep "CREATE TABLE.*project_plans" server/db.js` → found; `grep "source_cwd NOT NULL DEFAULT ''" server/db.js` → found; test T1.1 now R1-ready (db boots, tables present).

#### T1.3 — IMPLEMENTATION (Schema: prepared statements)
- **Description:** Add ~17 prepared statements to `server/db.js` `stmts` object: `listProjectPlans`, `getProjectPlan`, `insertProjectPlan`, `updateProjectPlanTitle`, `closeProjectPlan`, `listProjectPlanItems`, `getProjectPlanItem`, `insertProjectPlanItem`, `updateProjectPlanItem`, `deleteProjectPlanItem`, `insertValueClaim`, `listClaimsForProject`, `listClaimsForPlan`, `getValueClaim`, `deleteValueClaim`, `findProjectPlanByImportHash`, `lastClosureForProject`.
- **Files:** `server/db.js`
- **Component:** database / statements
- **Implementation step:** O-5 cont'd. Every SELECT with LIMIT over `events`/`sessions`/`focus_inferences` orders by `created_at, id` first (§9.2).
- **Done-check:** `grep "stmts.insertProjectPlan" server/db.js` → found; `grep -c "stmts..*ProjectPlan\|Claim" server/db.js` → 17+ matches.

#### T1.4 — TEST (Red-first → Green: A1 cases 1–4)
- **Description:** Prove A1 cases pass now that schema is in place.
- **Files:** `server/__tests__/db-migration.test.js`
- **Component:** database / schema validation
- **Test step:** (a) A1.1: legacy DB gains tables; (b) A1.2: new tables writable; (c) A1.3: second boot no-op (must prove R1 red: mutate CREATE to DROP); (d) A1.4: §9.5/§9.6 inapplicability pin (sqlite_master unchanged, ALTER count pinned).
- **Done-check:** `node --test server/__tests__/db-migration.test.js` → all 4 cases green; build notes record R1 mutation (DROP instead of CREATE).

#### T1.5 — IMPLEMENTATION (Module: cwd-identity.js)
- **Description:** Add `server/lib/cwd-identity.js` with `canonicalizeCwd`, `repoRootFor`, `dirIdentity`, `groupCwdsByIdentity`. Pure sync except `repoRootFor`. Single home for cwd identity — §9.1, CWD-IDENTITY-FANOUT.
- **Files:** `server/lib/cwd-identity.js` (new)
- **Component:** server / lib / cwd canonicalization
- **Implementation step:** O-6. File header: file overview + `@author Son Nguyen <hoangson091104@gmail.com>`. No other module may `realpathSync` a plan/pool cwd.
- **Done-check:** `grep -c "canonicalizeCwd\|repoRootFor\|dirIdentity" server/lib/cwd-identity.js` → 3+; `bash .claude/skills/file-headers/scripts/check-headers.sh` → exit 0.

#### T1.6 — TEST (Red-first: R0)
- **Description:** Spec T4 skeleton — cwd-identity module tests (10 cases).
- **Files:** `server/__tests__/cwd-identity.test.js` (new)
- **Component:** server / lib / cwd canonicalization
- **Test step:** A4 skeleton: 10 test stubs (R0 red: module-absence). Includes the O-7b seam-agreement diagnostic table.
- **Done-check:** `node --test server/__tests__/cwd-identity.test.js 2>&1 | head -3` → shows "Cannot find module" or test count; `grep "seam-agreement" server/__tests__/cwd-identity.test.js` → found.

#### T1.7 — IMPLEMENTATION (Module: plan-lifecycle.js)
- **Description:** Add `server/lib/plan-lifecycle.js` with `closePlan`, `importGenerationFromPlan`, `generationOrdinal`, plus plan/item CRUD. Import rules: resolve cwd via `canonicalizeCwd` → `repoRootFor`; idempotency key is `(project_id, imported_content_hash)`, never `cwd`.
- **Files:** `server/lib/plan-lifecycle.js` (new)
- **Component:** server / lib / plan lifecycle
- **Implementation step:** O-7. File header required. No delete path for a closed plan or any claim of a closed plan. `plan-ingest.js` stays the sole markdown parser.
- **Done-check:** `grep -c "importGenerationFromPlan\|generationOrdinal" server/lib/plan-lifecycle.js` → 2; `grep "content_hash.*idempotency" server/lib/plan-lifecycle.js` → found.

#### T1.8 — IMPLEMENTATION (Route: project-plans.js + mount)
- **Description:** Add `server/routes/project-plans.js` (plan/item/import endpoints only — slice 1 scope; pool/claims in later slices). Mount in `server/index.js` alongside `/api/plans`. Separate namespace from legacy plans; broadcast `project_plan_updated`.
- **Files:** `server/routes/project-plans.js` (new), `server/index.js` (modify)
- **Component:** server / routes / project plans
- **Implementation step:** O-7 cont'd. File header required. Endpoints: `GET /api/project-plans`, `GET /api/project-plans/:id`, `POST /api/project-plans`, `GET|PATCH /api/project-plans/:id(\d+)`, `POST /api/project-plans/:id(\d+)/items`, `PATCH|DELETE /api/project-plans/items/:itemId`, `POST /api/project-plans/import`.
- **Done-check:** `grep "app.use.*project-plans" server/index.js` → found; `grep -c "GET\|POST\|PATCH\|DELETE" server/routes/project-plans.js | head -1` → 8+; test B1 routes will exercise the mount.

#### T1.9 — TEST (Red-first: R0)
- **Description:** Spec T2 + T4 + B1 skeleton — lifecycle + import + route tests.
- **Files:** `server/__tests__/plan-lifecycle.test.js` (new), `server/__tests__/plan-import-inversion.test.js` (new), `server/__tests__/project-plans-api.test.js` (new, skeleton)
- **Component:** server / routes / tests
- **Test step:** A2 (19 cases), A3 (6 cases), B1 Groups A/B/G skeleton (stubs for plan create/list/read, item CRUD, import).
- **Done-check:** `node --test server/__tests__/plan-lifecycle.test.js 2>&1 | head -3` → shows "test count" or R0; `grep -c "describe\|it(" server/__tests__/plan-import-inversion.test.js` → 6+.

#### T1.10 — TEST (Prove A2 / A3 red-first with fixtures)
- **Description:** Write fixture factories (tmp DB, tmp cwd with AGENT-PLAN.md), populate test bodies with real assertions (A2 state machine cases, A3 import cases).
- **Files:** `server/__tests__/plan-lifecycle.test.js`, `server/__tests__/plan-import-inversion.test.js`
- **Component:** server / tests
- **Test step:** A2: generation chain, state machine, closed-immutability negatives (6 cases), concurrent plans (DEC-P5), WS allowlist. A3: import writes generation 1, re-import is no-op, UNIQUE index, cwd canonicalization, re-ingest survival (the `deletePlanItemsNotIn` trap), `assertSingleHome` rogue-writer scan.
- **Done-check:** `node --test server/__tests__/plan-lifecycle.test.js` → 19 cases green; `node --test server/__tests__/plan-import-inversion.test.js` → 6 cases green; build notes record R1 reds: injected `DELETE FROM project_plan_items` (A3.6 + A3.5 both fail), confirmed `assertSingleHome` loads.

#### T1.11 — TEST (Prove A4 red-first)
- **Description:** Write A4 cwd-identity cases (10 cases total): symlink resolution, darwin case-variant fold, nonexistent path, worktree folding, `dirIdentity`, `groupCwdsByIdentity`, single-home guard, O-7b seam-agreement table.
- **Files:** `server/__tests__/cwd-identity.test.js`
- **Component:** server / tests
- **Test step:** 10 cases as listed in test-plan A4 (including the O-7b diagnostic).
- **Done-check:** `node --test server/__tests__/cwd-identity.test.js` → 10 cases green; build notes record R1 red: call `realpathSync` from `value-ledger.js`.

#### T1.12 — TEST (Prove B1 route skeleton → Green)
- **Description:** Wire up B1 Groups A (create/list/read, 5 cases), B (item CRUD, 3 cases), G (import, 3 cases) and complete route logic.
- **Files:** `server/__tests__/project-plans-api.test.js`, `server/routes/project-plans.js`
- **Component:** server / routes / tests
- **Test step:** B1 case bodies: assertions on HTTP status, response shape, nesting, negatives.
- **Done-check:** `node --test server/__tests__/project-plans-api.test.js 2>&1 | grep -E "A1|A2|A3|A4|A5|B1|B2|B3|G1"` → 11 tests green.

#### T1.13 — IMPLEMENTATION / TEST (i18n parity — O-8)
- **Description:** Write `client/src/i18n/__tests__/i18n.test.ts` whole-namespace parity test (E1.1 + E1.2). Plural-suffix exemption required. Also fix `sessions:remoteSourceBadgeTitle` locale divergence.
- **Files:** `client/src/i18n/__tests__/i18n.test.ts` (new), `client/src/i18n/locales/{en,ko,vi,zh}/settings.json` (or other files), `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`
- **Component:** client / i18n / tests
- **Test step:** E1: 21 namespaces × 4 locales, deep-equal sorted keys after plural-suffix exemption; move `sessions:remoteSourceBadgeTitle` to all four locales so E1.1 + E1.2 go green together.
- **Done-check:** `cd client && npx vitest run src/i18n/__tests__/i18n.test.ts` → 2 cases green; `grep "sessions:remoteSourceBadgeTitle" client/src/i18n/locales/ko/settings.json` → found (or correct location per schema).

#### T1.14 — GATE (Slice 1 verification)
- **Description:** Run full slice-1 test suite and hygiene checks.
- **Files:** all test files above
- **Component:** integration
- **Test step:** O-9. Commands: `npm run test:server`, `npm run test:client`, regression floor (144-case nine-spec floor green with zero behaviour edits), `bash .claude/skills/file-headers/scripts/check-headers.sh` exit 0.
- **Done-check:** `npm run test:server 2>&1 | tail -5` → "all tests passed" or similar; `npm run test:client 2>&1 | tail -5` → same; header check exit 0; `grep -rn "assert.ok(true" server/__tests__/ | wc -l` → 0.

---

### SLICE 2 — Claims + close (7 tasks)

#### T2.1 — TEST (Red-first: R0)
- **Description:** Spec T5 skeleton — value-ledger module tests (13 cases).
- **Files:** `server/__tests__/value-ledger.test.js` (new)
- **Component:** server / lib / value ledger
- **Test step:** A5 skeleton: 13 test stubs (R0 red). Includes claims persistence, cardinality, health metrics, closure single-writer guard.
- **Done-check:** `node --test server/__tests__/value-ledger.test.js 2>&1 | head -3` → shows "Cannot find module" or test count.

#### T2.2 — IMPLEMENTATION (Module: value-ledger.js — partial)
- **Description:** Add `server/lib/value-ledger.js` stub with exports: `assembleValuePool`, `computePlanHealth`, `summarizeDeliveredValue`, `unitKey`, `VALUE_SOURCES`, `ATTRIBUTION_TIERS`. Implement only the non-assembly portions: health metrics, summary, mapper exports. Pool assembly is slice 3.
- **Files:** `server/lib/value-ledger.js` (new)
- **Component:** server / lib / value ledger
- **Implementation step:** O-10 (partial). File header required. Export vocabularies matching the DDL CHECKs. Implement `computePlanHealth` (returns `{ unclaimedPoolSize, lastClosureAt, daysSinceLastClosure, openPlanCount }`).
- **Done-check:** `grep -c "computePlanHealth\|VALUE_SOURCES\|ATTRIBUTION_TIERS" server/lib/value-ledger.js` → 3.

#### T2.3 — IMPLEMENTATION (Route: project-plans.js — claims endpoints)
- **Description:** Add value-claims write/read endpoints to the router: `POST /api/project-plans/:id/claims` (claim unit into item or create inline item), `DELETE /api/project-plans/claims/:claimId`.
- **Files:** `server/routes/project-plans.js`
- **Component:** server / routes / project plans
- **Implementation step:** O-10 cont'd. Route logic: canonicalize `source_cwd` at write via `cwd-identity.js`; snapshots are reference + one-line summary only (DEC-P4).
- **Done-check:** `grep "POST.*claims\|DELETE.*claimId" server/routes/project-plans.js` → found; test will exercise cardinality.

#### T2.4 — IMPLEMENTATION (Closure composer: plan-lifecycle.js)
- **Description:** Implement `closePlan(dbModule, planId, {closure_note, now})` in `server/lib/plan-lifecycle.js` as the **single closure composer**: one transaction, one row update to `project_plans` (stamp `closed_at`, `closure_note`, `status='closed'`), broadcast `project_plan_updated` + `value_claim_updated`. Nothing writes a closed flag onto claims.
- **Files:** `server/lib/plan-lifecycle.js`, `server/routes/project-plans.js`
- **Component:** server / lib / plan lifecycle
- **Implementation step:** O-11. Mount the close endpoint: `POST /api/project-plans/:id/close`. Reject: closing an already-closed plan, any item/claim write/delete against closed plan.
- **Done-check:** `grep -A5 "closePlan" server/lib/plan-lifecycle.js | head -10` → shows transaction pattern; `grep "POST.*close" server/routes/project-plans.js` → found.

#### T2.5 — TEST (Prove A5 + B1 C/D → Green)
- **Description:** Write full A5 cases (claims persistence, cardinality, health, closure guard) and B1 Groups C (closure contract, 4 cases), D (claims cardinality, 5 cases).
- **Files:** `server/__tests__/value-ledger.test.js`, `server/__tests__/project-plans-api.test.js`
- **Component:** server / tests
- **Test step:** A5: 3 persistence + 4 cardinality + 1 health + 1 closure guard (export-derived scope, `assertSingleHome` call site). B1 C: close 200, double close 409, refusal sweep, no-other-verb-closes. B1 D: claim visible, duplicate 409, many-to-many, inline `new_item`, unclaim returns to pool.
- **Done-check:** `node --test server/__tests__/value-ledger.test.js` → 13 cases green; `node --test server/__tests__/project-plans-api.test.js 2>&1 | grep -E "C1|C2|C3|C4|D1|D2|D3|D4|D5"` → 9 cases green; build notes record R1 reds: injected second `closeProjectPlan` call site, mutated claim reader.

#### T2.6 — IMPLEMENTATION (CLI: ccam.js)
- **Description:** Add `cmdLedger` function and dispatch case in `bin/ccam.js` for `ccam ledger` commands. Slice 2 commands: `plans|claim|close --project <id|name>`. Health numbers printed from API response verbatim (no CLI-side arithmetic — T6 will test parity).
- **Files:** `bin/ccam.js`
- **Component:** CLI
- **Implementation step:** O-13. Help entry for the new command group.
- **Done-check:** `ccam help | grep ledger` → shows usage; `ccam ledger plans --project <id>` (with seeded test project) → outputs JSON or formatted plan list.

#### T2.7 — GATE (Slice 2 verification)
- **Description:** Run full slice-2 test suite.
- **Files:** all test files, CLI
- **Component:** integration
- **Test step:** O-14. Commands: `npm run test:server`, regression floor green.
- **Done-check:** `npm run test:server 2>&1 | grep "value-ledger\|project-plans-api" | tail -2` → all green; `npm run test:server 2>&1 | grep -E "^(  )?✓" | wc -l` → count includes A5 + B1 C/D.

---

### SLICE 3 — Pool + health + parity + durable cures (19 tasks)

#### T3.1 — TEST (Red-first: R0)
- **Description:** Spec T3 skeleton — value-pool module tests (11 cases).
- **Files:** `server/__tests__/value-pool.test.js` (new)
- **Component:** server / lib / value pool
- **Test step:** A6 skeleton: 11 test stubs (R0 red). Includes mechanical tier from intake, trunk feed, ratchet, backfill, DEC-4 dedupe (3 parts), cross-seam unitKey agreement, chronology, correlational tier, identity warnings.
- **Done-check:** `node --test server/__tests__/value-pool.test.js 2>&1 | head -3` → shows "Cannot find module" or test count.

#### T3.2 — IMPLEMENTATION (Module: value-ledger.js — pool assembly)
- **Description:** Add `assembleValuePool(dbModule, project, opts)` to `server/lib/value-ledger.js`. Assembly order per technical-plan §4.12: (1) mechanical tier from `scanIntakeForCwd` (intake initiatives + merge commits); (2) trunk feed from `detectTrunkDrift(repoRoot, {seenShas})` (direct-to-trunk commits, ratcheted by claims); (3) detours from `detour_dispositions` rows (excluding disposition='discard'); (4) correlational tier (focus-session bracketing, suggestions only); (5) subtract claimed units; (6) dedupe by `unitKey`. Resolve all per-cwd feeds through `cwd-identity.js`.
- **Files:** `server/lib/value-ledger.js`
- **Component:** server / lib / value ledger
- **Implementation step:** O-15. Export the row→unit mapper function (A6.6 will test directly). Emit `identityWarnings` for (a) two mapped cwds resolving to same directory, (b) project path with no git repo, (c) repo root not mapped to any project. Canonicalize each `project_paths.cwd` and fold worktree cwds to parent repo root.
- **Done-check:** `grep -c "assembleValuePool\|detectTrunkDrift\|identityWarnings" server/lib/value-ledger.js` → 3+; `grep "mechanical.*intake_initiative" server/lib/value-ledger.js` → found.

#### T3.3 — TEST (Prove A6.1 / A6.2 — mechanical + trunk feeds)
- **Description:** Write A6 cases 1–2: mechanical tier from intake (both `intake_initiative` and `merge_commit` units from released initiative), trunk feed via real `detectTrunkDrift`, TRUNK_DRIFT_SKIP_REASONS import.
- **Files:** `server/__tests__/value-pool.test.js`
- **Component:** server / tests
- **Test step:** Fixtures: real tmp git repos via `ISOLATED_GIT_ENV` from `intake-scan.test.js`, `makeRepo`, `fs.realpathSync(mkdtemp)` copied verbatim; `project_paths` seeded; backdated commits via `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`. A6.1: released initiative yields both units. A6.2: direct-to-master commit → `trunk_commit` unit, non-repo path no throw + warning.
- **Done-check:** `node --test server/__tests__/value-pool.test.js 2>&1 | grep -E "A6.1|A6.2"` → 2 cases green.

#### T3.4 — TEST (Prove A6.3 — ratchet)
- **Description:** Write A6 case 3: ratchet across two runs. Run 1: N units, claim one sha. Add two new trunk commits. Run 2: pool has (N-1)+2 units, claimed sha absent.
- **Files:** `server/__tests__/value-pool.test.js`
- **Component:** server / tests
- **Test step:** Claim one sha, re-run `assembleValuePool`, assert claimed unit absent from pool by `unitKey` membership and by count.
- **Done-check:** `node --test server/__tests__/value-pool.test.js 2>&1 | grep "A6.3"` → case green; build notes record R1 red: drop `seenShas` pass-through.

#### T3.5 — TEST (Prove A6.4 — backfill)
- **Description:** Write A6 case 4: lookback baseline + `?backfill=1`. Backdated commit absent by default, present with `&backfill=1`; both responses dedupe and claim-subtract identically.
- **Files:** `server/__tests__/value-pool.test.js`
- **Component:** server / tests
- **Test step:** Fixture: commit with `GIT_AUTHOR_DATE` before default lookback. Assert commit absent in default call, present with backfill.
- **Done-check:** `node --test server/__tests__/value-pool.test.js 2>&1 | grep "A6.4"` → case green.

#### T3.6 — **MANDATORY** TEST (Prove DEC-4 dedupe — O-16 all three parts)
- **Description:** Write A6 cases 5–7: DEC-4 dedupe test (primary + diagnostic + tripwire). (a) pragma-seeded full-assembly test with written justification; (b) exported mapper diagnostic; (c) CHECK-still-excludes-`'trunk_drift'` tripwire. **Defect-catalog citation: §9.1 DERIVED-DUAL-VIEW, §9.3 VACUOUS-GUARD, DEC-4.**
- **Files:** `server/__tests__/value-pool.test.js`, `server/lib/value-ledger.js`
- **Component:** server / lib / tests / durable cure
- **Implementation step:** O-16. (a) A6.5: Seed `detour_dispositions` row with `source='trunk_drift'` and same sha under `db.pragma("ignore_check_constraints = 1")`, restored to `0` immediately. Justification block: "This fixture is future-real, not never-real — trunk-drift Phase 1b will produce this row. Seeded under ignore_check_constraints only because the CHECK has not widened yet. §9.3's B4 shape is accepted here on that basis. Do not delete this test; see A6.7." (b) A6.6: Export the mapper function and test directly that `{source:'trunk_drift', source_ref:sha}` maps to `('trunk_commit', sha)`. (c) A6.7: Read `detour_dispositions` CHECK from sqlite_master, assert still excludes `'trunk_drift'`. Failure message: "Phase 1b has landed: drop the pragma, re-seed, re-verify source_ref is full 40-char sha."
- **Test step:** Red-proof (R1, recorded in build notes): delete the unitKey-collapse step → A6.5 fails (two units, doubled health metric).
- **Done-check:** `node --test server/__tests__/value-pool.test.js 2>&1 | grep -E "A6.5|A6.6|A6.7"` → 3 cases green; build notes name the R1 mutation (delete collapse); schema CHECK includes no `'trunk_drift'` in committed code; pragma+justification block present.

#### T3.7 — **MANDATORY** TEST (Prove A6.8 — cross-seam unitKey agreement — O-7a)
- **Description:** Write A6 case 8: cross-seam `unitKey` agreement (CWD-IDENTITY-FANOUT candidate promotion trigger). Claim unit through case-variant (darwin-guarded `.../DND` vs `.../dnd`) or worktree cwd; assemble pool through canonical one. Assert: (i) unit still excluded from pool; (ii) duplicate claim still blocked by UNIQUE index. **Defect-catalog citation: CWD-IDENTITY-FANOUT (candidate, explicit promotion trigger), §9.1.**
- **Files:** `server/__tests__/value-pool.test.js`, `server/__tests__/cwd-identity.test.js`
- **Component:** server / tests / durable cure
- **Test step:** O-17. Fixture: case-variant cwds or worktree path. Claim through one canonical form; assemble through another. Verify unit count unchanged, duplicate blocked. Plus A4 (last case): seam-agreement diagnostic table `[variant × canonical]` asserting `canonicalizeCwd(variant) === canonicalizeCwd(canonical)`.
- **Test step (Red-proof, R1, recorded):** Remove canonicalization from claim-write seam only → unit re-enters pool, duplicate inserts.
- **Done-check:** `node --test server/__tests__/value-pool.test.js 2>&1 | grep "A6.8"` → case green; `node --test server/__tests__/cwd-identity.test.js 2>&1 | tail -3` → all 10 green; build notes record R1 mutation.

#### T3.8 — TEST (Prove A6.9 — chronology: scrambled id vs created_at)
- **Description:** Write A6 case 9: chronology ordering (§9.2). Insert `sessions` / `events` / `focus_inferences` in id-order opposite their `created_at` order. Bracket must attribute commit to the session whose **time window** contains `committedAt`, not latest-id session. Fixture must make a `LIMIT` select the **wrong subset** under id-ordering.
- **Files:** `server/__tests__/value-pool.test.js`, use `assertOrderedByCreatedAt` helper from `server/__tests__/helpers/ordering.js`
- **Component:** server / tests
- **Test step:** A6.9. Reuse `chronology-ordering.test.js`'s scrambled fixture recipe (lines 396-464). Route LIMITed queries through the helper.
- **Test step (Red-proof, R1, recorded):** Swap bracket query's `ORDER BY` to `id` → A6.9 fails (wrong session attributed).
- **Done-check:** `node --test server/__tests__/value-pool.test.js 2>&1 | grep "A6.9"` → case green.

#### T3.9 — TEST (Prove A6.10 — correlational tier + A6.11 identity warnings)
- **Description:** Write A6 cases 10–11: correlational tier is suggestions only (bracketed trunk commit → `attribution:'correlational'`, no auto-claim); identity warnings for (a) case-variant duplicate, (b) unmapped path, (c) worktree fold + unmapped repo.
- **Files:** `server/__tests__/value-pool.test.js`
- **Component:** server / tests
- **Test step:** A6.10: unbracketed commit → unattributed mechanical; no `focus_segment` unit emitted in v1 (matches A5's disposition map). A6.11: warnings shape `{kind, cwds}` pinned; collapse count asserted for (a).
- **Done-check:** `node --test server/__tests__/value-pool.test.js 2>&1 | grep -E "A6.10|A6.11"` → 2 cases green.

#### T3.10 — IMPLEMENTATION (Route: project-plans.js — pool/health/history)
- **Description:** Add endpoints to router: `GET /api/project-plans/pool`, `GET /api/project-plans/health`, `GET /api/project-plans/history`.
- **Files:** `server/routes/project-plans.js`
- **Component:** server / routes
- **Implementation step:** O-15 cont'd. `/pool` returns `{units, identityWarnings}`; `/health` returns `{unclaimedPoolSize, lastClosureAt, daysSinceLastClosure, openPlanCount}`; `/history` returns closed generations with claims, no `closed_at` on claims (join-derived only).
- **Done-check:** `grep "GET.*pool\|GET.*health\|GET.*history" server/routes/project-plans.js` → 3 matches.

#### T3.11 — TEST (Prove B1 E/F/S — pool/health/history routes)
- **Description:** Write B1 Groups E (pool endpoint, 3 cases), F (health + history, 3 cases), S (audit semantics, 1 case).
- **Files:** `server/__tests__/project-plans-api.test.js`
- **Component:** server / tests
- **Test step:** E1: shape + no pre-claimed + no auto-focus_segment. E2: backfill accepted. E3: missing project_id → 400. F1: health key set. F2: health reacts to lifecycle. F3: history closed gens, no `closed_at` on claims. S1: deleted project row, history/health still 200; create/import 404.
- **Done-check:** `node --test server/__tests__/project-plans-api.test.js 2>&1 | grep -E "E1|E2|E3|F1|F2|F3|S1"` → 8 cases green.

#### T3.12 — IMPLEMENTATION (CLI: ccam.js — pool/health/history)
- **Description:** Add `ccam ledger pool|health|history --project <id>` to `cmdLedger`. Health numbers printed from API verbatim (no re-arithmetic).
- **Files:** `bin/ccam.js`
- **Component:** CLI
- **Implementation step:** O-15 cont'd. Commands: `ccam ledger pool [--backfill]`, `ccam ledger health`, `ccam ledger history`.
- **Done-check:** `ccam ledger health --project <id>` (seeded test project) → outputs the four metrics.

#### T3.13 — TEST (Prove C1 cases 1–6 + C2 parity — CLI)
- **Description:** Write C1 cases 1–6 (usage, plans, pool, claim/close round-trip, offline) and C2 cases 1–4 (T6 parity: API vs CLI identical values, null-shape, pool/history smoke, CONSUMERS registry).
- **Files:** `server/__tests__/ccam-cli.test.js`, `server/__tests__/ledger-metrics-parity.test.js` (new)
- **Component:** server / tests
- **Test step:** C1: help, plans output, pool/health/history output, claim/close round-trip, offline posture. C2 (T6): one seeded DB, real in-process server, real spawned `ccam ledger health`, verbatim value equality per metric (no tolerance, no rounding). Null-shape parity (no closures). Pool/history count smoke.  CONSUMERS array with length assertion and DEC-16 quote.
- **Test step (Red-proof, R1, recorded):** Hand-roll `daysSinceLastClosure` in `cmdLedger` → C2.1 fails (value mismatch).
- **Done-check:** `node --test server/__tests__/ccam-cli.test.js` → 7 cases green; `node --test server/__tests__/ledger-metrics-parity.test.js` → 4 cases green; build notes record T6 is driven by **real** consumers (not mocked API); anti-degeneration clause verified.

#### T3.14 — **MANDATORY** TEST (Prove D1 — chronology scan with derived scope — O-18)
- **Description:** Register the four new server files AND derive the scan's scope from real artifacts (§9.7 HAND-SCOPED STRUCTURAL SCAN, durable cure). In the **same commit** as `value-ledger.js`. **Defect-catalog citation: §9.7 (occurrence 7 + cure), §9.2 row-id-as-chronology-proxy.**
- **Files:** `server/__tests__/chronology-ordering.test.js`
- **Component:** server / tests / durable cure
- **Implementation step:** O-18. (1) Register four new files in hand-typed `filesToScan` at lines 80-86: `server/lib/value-ledger.js`, `server/lib/cwd-identity.js`, `server/lib/plan-lifecycle.js`, `server/routes/project-plans.js`. (2) Replace hand-typed list with derived scope: `fs.readdirSync('server/lib/*.js') + fs.readdirSync('server/routes/*.js')` plus explicit per-file disposition map (`"scanned"` | `{status:"grandfathered", dated, reason}`). New assertion: every globbed file has a disposition, every dispositioned file exists. `GRANDFATHERED_QUERIES.length === 2` unchanged (no new grandfather entry).
- **Test step (Red-proof, R1, recorded, mandatory):** Create scratch `server/lib/zz-scratch.js` with LIMITed SELECT over `events`, no disposition → suite fails on **scope**, not SQL shape; delete the scratch file. Build notes record the mutation and scope-failure message.
- **Done-check:** `node --test server/__tests__/chronology-ordering.test.js` → passes; `grep "filesToScan\|disposition" server/__tests__/chronology-ordering.test.js | head -3` → shows derived logic; four new files in the map; `echo $?` after injecting scratch file is non-zero (scope failure).

#### T3.15 — **MANDATORY** TEST + IMPLEMENTATION (Prove D2 — OpenAPI contract — O-19)
- **Description:** Author `server/openapi-extra/project-plans.js` with non-colliding operationIds; register in `server/openapi-extra.js`; write `openapi-contract.test.js` (4 cases); regenerate `openapi.yaml`. **Defect-catalog citation: CONTRACT-SPEC-DRIFT (candidate, explicit promotion trigger).**
- **Files:** `server/openapi-extra/project-plans.js` (new), `server/openapi-extra.js` (modify), `server/__tests__/openapi-contract.test.js` (new), `openapi.yaml`
- **Component:** server / openapi / tests / durable cure
- **Implementation step:** O-19. OperationIds (non-colliding): `listPortfolioPlans`, `getPortfolioPlan`, `createPortfolioPlan`, `closePortfolioPlan`, `importPortfolioPlan`, `createPortfolioPlanItem`, `updatePortfolioPlanItem`, `deletePortfolioPlanItem`, `createValueClaim`, `deleteValueClaim`, `getValuePool`, `getLedgerHealth`, `getLedgerHistory`. Register fragment in `server/openapi-extra.js` (hand-enumerated at :13-26 / :52). Then: `npm run openapi:yaml`.
- **Test step:** D2.1: operationId uniqueness (failure message names colliding pair). D2.2: app.use mount ↔ path completeness (modulo GRANDFATHERED_MOUNTS, dated). D2.3: new namespace fully specced (pool, health, history, import, items, claims, :id, :id/close have operationIds). D2.4: `openapi.yaml` round-trip (failure message: "run `npm run openapi:yaml` and commit").
- **Test step (Red-proof, R1, recorded):** Temporarily name one new operationId `getProjectPlans` → D2.1 fails (collision with legacy plans); D2.4 fails until yaml is regenerated.
- **Done-check:** `node --test server/__tests__/openapi-contract.test.js` → 4 cases green; `git diff openapi.yaml` shows regenerated paths for project-plans routes; build notes record D2.1 collision test mutation and D2.4 regeneration.

#### T3.16 — IMPLEMENTATION (Docs update)
- **Description:** Update `docs/API.md` (new routes + two new WS types), `docs/DATABASE.md` (three new tables), `ARCHITECTURE.md` (portfolio layer), `README.md` and `server/README.md` (`ccam ledger`). Apply `update-project-docs` skill.
- **Files:** `docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`, `README.md`, `server/README.md`
- **Component:** documentation
- **Implementation step:** Final docs pass per project rule (§2). File headers already applied in code files.
- **Done-check:** `grep "project-plans" docs/API.md` → found; `grep "value_claims" docs/DATABASE.md` → found; `bash .claude/skills/file-headers/scripts/check-headers.sh` → exit 0 (no new source files added in this task).

#### T3.17 — GATE (Slice 3 verification)
- **Description:** Run full slice-3 test suite and complete hygiene checks.
- **Files:** all test files
- **Component:** integration
- **Test step:** O-21. Commands: `npm run test:server`, regression floor (144-case nine-spec floor green, zero behaviour edits), header check, §9.3 sweeps (assert.ok true / || true → 0), zero `ALTER` in this diff.
- **Done-check:** `npm run test:server 2>&1 | tail -10` → all green; `grep -rn "assert.ok(true" server/__tests__/ | wc -l` → 0; `git diff master...HEAD -- server/db.js | grep -c "ALTER TABLE"` → 0.

---

### SLICE 4 — Sara's checkpoint (gate, not in this build)

#### T4.1 — GATE SETUP (Mandatory preconditions)
- **Description:** Preconditions before the checkpoint script runs. Not automatable; hand-performed.
- **Component:** data hygiene / database backup
- **Setup step:** DEC-13 (Sara's manual action): merge the `DND`/`dnd` duplicate project in the dashboard UI. Then stop the server.
- **Done-check:** Dashboard Projects page shows one instance of the Coaching Assistant project; no duplicate inode entries.

#### T4.2 — GATE SETUP (Database backup)
- **Description:** Back up the real dashboard DB before any checkpoint trial.
- **Component:** database / backup
- **Setup step:** `sqlite3 ~/.claude/agent-dashboard/dashboard.db ".backup ~/.claude/agent-dashboard/dashboard.db.bak-$(date +%Y%m%d)"`. Then restart the server.
- **Done-check:** `ls -la ~/.claude/agent-dashboard/dashboard.db.bak-*` → today's backup exists.

#### T4.3 — GATE STEP 0 (Checkpoint baseline)
- **Description:** Pre-import baseline: run `ccam ledger health --project "$PROJ"` to see the before-state (should show `openPlanCount 0`, empty/near-empty pool).
- **Component:** CLI / checkpoint
- **Verification step:** Test-plan §7 "DoD," step 0. Evidence: baseline recorded in test run output.
- **Done-check:** Output includes `openPlanCount: 0`.

#### T4.4 — GATE STEP 1 (Generate generation 1)
- **Description:** Import Coaching Assistant's `AGENT-PLAN.md` as generation 1: `curl -s -X POST localhost:$PORT/api/project-plans/import -H 'Content-Type: application/json' -d "{\"project_id\":\"$PROJ\",\"cwd\":\"$CWD\"}"`. Run **twice** to verify idempotency (second response returns same `plan.id`, no gen-2).
- **Component:** API / import
- **Verification step:** Step 1. Evidence: `origin:"import"`, item count and nesting match the real AGENT-PLAN.md.
- **Done-check:** First import returns `plan.id`; second import returns same id, `plan.origin === "import"`.

#### T4.5 — GATE STEP 2 (Assemble pool)
- **Description:** Assemble the pool: `ccam ledger pool --project "$PROJ"` and again with `--backfill`. Evidence: pool shows trunk commits + ~30 intake initiatives with believable tiers.
- **Component:** CLI / pool assembly
- **Verification step:** Step 2. Read `identityWarnings` out loud — any case-variant or worktree warning is checkpoint data and CWD-IDENTITY-FANOUT promotion trigger.
- **Done-check:** Output includes units with tier badges; identityWarnings list (if any) reviewed.

#### T4.6 — GATE STEP 3 (Claim units)
- **Description:** Claim ≥1 `mechanical` and ≥1 `correlational` unit into imported items via `ccam ledger claim`. Verify pool size drops by exactly the number of distinct claimed units and re-claiming same unit into same item is refused.
- **Component:** CLI / claims
- **Verification step:** Step 3. Evidence: `ccam ledger health` before/after shows pool shrinkage matching claim count.
- **Done-check:** Pool size decreased by exactly the number of claimed units; duplicate claim refused with 409.

#### T4.7 — GATE STEP 4 (Create + close retroactive bundle)
- **Description:** Create a retroactive detour-bundle plan, claim detour units into it, and close it: `curl -s -X POST localhost:$PORT/api/project-plans -H 'Content-Type: application/json' -d "{\"project_id\":\"$PROJ\",\"title\":\"Retroactive: detours to date\",\"origin\":\"retroactive_bundle\"}"`. Claim detours, then `ccam ledger close --project "$PROJ" <planId> --note "retro bundle closed at checkpoint"`. Second close should be refused.
- **Component:** API / close
- **Verification step:** Step 4. Evidence: plan moves to closed, stamp + history entry present.
- **Done-check:** `closed_at` timestamp and `closure_note` present; second close returns 409.

#### T4.8 — GATE STEP 5 (Verify AC-6: whole-life answer)
- **Description:** Run `ccam ledger history --project "$PROJ"`. AC-6: "what value did this project deliver?" answered from closed generations + claims **alone**, no archaeology.
- **Component:** CLI / history
- **Verification step:** Step 5. Evidence: history shows the closed generation with its claims and metrics, no queries into raw events or external docs needed.
- **Done-check:** History output includes closed generation title, items, claims; no reference to external sources.

#### T4.9 — GATE STEP 6 (Restart + verify I-2/I-3 in the wild)
- **Description:** Restart the server. Re-run `ccam ledger health`, `pool`, `history`. Claims and the closed generation survived; nothing re-imported or re-derived; pool identical minus claimed units (I-2/I-3 in the wild).
- **Component:** integration / persistence
- **Verification step:** Step 6. Evidence: idempotency proven by byte-identity comparison (or manually verified not recomputed).
- **Done-check:** Commands produce identical output to pre-restart values (except pool shrinks by claimed units); no errors in server logs.

#### T4.10 — **MANDATORY GATE** (DEC-12 checkpoint verdict)
- **Description:** Sara records the verdict on real Coaching Assistant data via the checkpoint script: **"is this pool signal or noise?"** in `decisions.md` DEC-12 status. **Slice 5 stays blocked until this row is answered. Auto-pilot cannot write it.**
- **Component:** decision / gate
- **Verification step:** Step 7 (8-step script). Recorded evidence: DEC-12 amended with verdict and date.
- **Done-check:** `grep -A3 "DEC-12" intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md | grep -E "signal|noise"` → verdict present.

---

### SLICE 5 — UI (gated behind DEC-12; not in this build)

*Slice 5 tasks are listed here for completeness but are not executed in this build. They begin only after Sara answers the DEC-12 checkpoint gate.*

#### T5.1 — IMPLEMENTATION (Types + API)
- **Description:** Add `ProjectPlan`, `ProjectPlanItem`, `ValueUnit`, `ValueClaim`, `PlanHealth`, `ValuePool` types to `client/src/lib/types.ts` and API functions to `client/src/lib/api.ts`.
- **Files:** `client/src/lib/types.ts`, `client/src/lib/api.ts`
- **Implementation step:** O-23. No new CLI type system; existing `Plan`/`PlanItem` untouched.

#### T5.2 — IMPLEMENTATION + TEST (Component + render)
- **Description:** Add `client/src/components/PlanLedgerPanel.tsx` (self-contained two-pane panel: left open plans + items + close action, right pool + claim gesture, collapsed closed history). Render from `ProjectDetail.tsx`. Write F1 (7 cases) + F2 (1 case).
- **Files:** `client/src/components/PlanLedgerPanel.tsx` (new), `client/src/pages/ProjectDetail.tsx`, `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (new), `client/src/pages/__tests__/ProjectDetail.test.tsx`
- **Implementation step:** O-23. File header required. Health numbers render **from server value** — no client-side re-derivation (§9.1).
- **Test step:** F1: left pane (2 open plans, nested items), right pane (tier badges), claim gesture, close, health renders verbatim (mocked health.unclaimedPoolSize=37 while pool length=5 → shows 37). F2: Project Detail card render.

#### T5.3 — IMPLEMENTATION (i18n + snapshots)
- **Description:** Add strings into existing `projectDetail.json` ×4 locales (no new namespace, route or nav entry). Regenerate `screens.snapshot.test.tsx` baselines with reviewed diff.
- **Files:** `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`, `client/src/pages/__tests__/screens.snapshot.test.tsx.snap`
- **Implementation step:** O-23. Run `cd client && npx vitest run -u` on a tree containing **only this effort's UI diff** (F3/O-24). Never blind-regenerate.
- **Test step:** Diff shows only Project Detail (+ shell chrome) changed; panel's markup visible, no empty/error states.

#### T5.4 — GATE (Slice 5 verification)
- **Description:** Run full client test suite.
- **Implementation step:** O-24. `npm run test:client`, header check.
- **Done-check:** `npm run test:client 2>&1 | tail -5` → all green.

---

## Durable-cure obligations (MANDATORY — marked in tasks above)

Listed by defect-catalog id and task number:

1. **§9.1 DERIVED-DUAL-VIEW** (T3.6, T3.7, T3.13)
   - One home `server/lib/value-ledger.js` for every derived value (DEC-5).
   - T6 drives the **real** route AND real spawned CLI off one seeded DB (not mocked API).
   - Cross-feed dedupe on `('trunk_commit', sha)` (DEC-4, A6.5/A6.6/A6.7).
   - Closure derived by join — no `closed_at` on `value_claims`.

2. **§9.2 row-id-as-chronology-proxy** (T3.8, T3.14)
   - Every LIMITed walk of `events`/`sessions`/`focus_inferences` orders by `created_at, id` first.
   - Chronology scan scope derived from real artifacts (T3.14).

3. **§9.3 VACUOUS-GUARD** (all test tasks)
   - Every structural guard ships with recorded R1 red state (mutation named, observed, restored).
   - `assert.ok(true` / `|| true` sweeps stay at 0.

4. **§9.7 HAND-SCOPED STRUCTURAL SCAN** (T3.14)
   - Register four new files in `chronology-ordering.test.js` in the same commit as `value-ledger.js` (not a follow-up).
   - Derive `filesToScan` scope from `server/lib/*.js` + `server/routes/*.js` with per-file disposition map.
   - Adding a 6th lib file must break the scan.

5. **CWD-IDENTITY-FANOUT** (T1.5, T1.6, T3.7)
   - `cwd-identity.js` is the sole canonicalizer; no other module calls `realpathSync` on plan/pool cwds.
   - Import keyed on `(project_id, imported_content_hash)`, never cwd.
   - Cross-seam `unitKey` agreement proven at three seams (claim-write, pool-assembly, no recomputation).

6. **CONTRACT-SPEC-DRIFT** (T3.15)
   - New `openapi-contract.test.js` with 4 cases.
   - OperationId uniqueness, route↔spec completeness, `openapi.yaml` round-trip all enforced.
   - Legacy `getProjectPlans` shipped; new ids namespaced.

7. **File headers** (all new-file tasks)
   - Every new source file (`.js`/`.ts`/`.tsx`) starts with file-overview + `@author Son Nguyen <hoangson091104@gmail.com>`.
   - `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.

---

## Sequencing notes (critical constraints)

1. **DEC-2 gate (T1.1-T1.4):** Trunk-drift Phase 1a must merge to `master` **before** slice 1 starts. Verified in build-brief O-2.

2. **§9.7 same-commit rule (T3.14):** The four new files must enter `chronology-ordering.test.js` **in the same commit** as `value-ledger.js`. A follow-up commit means §9.7 recurs (occurrence 7).

3. **O-3 signature re-confirmation (T3.1-T3.9):** Every A6 case is designed against `detectTrunkDrift`'s uncommitted worktree export. The signature must be re-confirmed at the DEC-2 merge: specifically whether `seenShas` is an **exclusion set** (current design) or a since-marker (would break A6.3 ratchet logic). Record confirmation in build notes.

4. **No blind snapshot regeneration (T5.3):** `ProjectDetail.tsx`, `api.ts`, `types.ts`, `projectDetail.json` ×4 and the snapshot file are dirty on `master` **and** modified in the trunk-drift worktree. F3 snapshot regen (O-24) runs **only on a tree containing this effort's UI diff and nothing else**, per `CLAUDE.md`.

5. **Slice 4 gate (T4.1-T4.10):** DEC-12 checkpoint is a gate, not a demo. Auto-pilot cannot write it. Build stops after T3.17; slice 5 does not start until Sara answers "signal or noise?"

---

## Regression floor commands (per-slice verification)

After each slice gate, run the verbatim regression floor for that gate:

```bash
# Slice 1 gate (T1.14) — 144-case nine-spec floor + i18n
npm run test:server
npm run test:client
node --test server/__tests__/plan-ingest.test.js server/__tests__/plans-api.test.js \
  server/__tests__/plan-writeback.test.js server/__tests__/detour-disposition.test.js \
  server/__tests__/db-migration.test.js server/__tests__/reconciliation-full-tick.test.js \
  server/__tests__/chronology-ordering.test.js server/__tests__/single-writer-guard.test.js \
  server/__tests__/pace-tracking.test.js

# Slice 2 gate (T2.7) — same floor
npm run test:server

# Slice 3 gate (T3.17) — same floor
npm run test:server
```

**Must stay green with zero behaviour edits.** Any modification to `plan-ingest.test.js` or `single-writer-guard.test.js` is a violation of the additive design. Only `db-migration.test.js` and `chronology-ordering.test.js` may be modified, as specified.

---

## Summary

- **Task count:** 54 tasks (17 per slice + 7 slice-4 gate + 4 slice-5 deferred, not built)
- **Red-first test steps:** 15 (T1.1, T1.4, T1.6, T1.9-T1.11, T2.1, T2.5, T3.1, T3.3-T3.9, T3.13-T3.15)
- **MANDATORY durable-cure steps:** 7 (§9.1, §9.2, §9.3, §9.7, CWD-IDENTITY-FANOUT, CONTRACT-SPEC-DRIFT, file headers)
- **First task:** T1.1 (spec T1 skeleton — db-migration.test.js, A1 cases, R0 red)
- **Riskiest constraint:** §9.7 same-commit rule — the four new files enter `chronology-ordering.test.js` in the same commit as `value-ledger.js`, never a follow-up. Violations mean scope escapes the scan.

