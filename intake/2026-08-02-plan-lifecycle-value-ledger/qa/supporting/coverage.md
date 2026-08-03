# Coverage Map — 2026-08-02-plan-lifecycle-value-ledger

> Author: `qa-coverage-cartographer` (team-qa). PRE-BUILD pass: the six planned
> new files do not exist yet; this maps what guards the touched/adjacent
> surfaces **today** and records the actually-observed baseline.
> All runs executed 2026-08-02 on master's working tree (dirty — see §5 note).

## 1. Baseline — actually run, actually observed

### 1.1 The nine-spec plan-surface floor (intake QA cited 144/144 — re-verified)

Command (single run, the regression-floor invocation a build-verifier should rerun):

```bash
node --test server/__tests__/plan-ingest.test.js server/__tests__/plans-api.test.js \
  server/__tests__/plan-writeback.test.js server/__tests__/detour-disposition.test.js \
  server/__tests__/db-migration.test.js server/__tests__/reconciliation-full-tick.test.js \
  server/__tests__/chronology-ordering.test.js server/__tests__/single-writer-guard.test.js \
  server/__tests__/pace-tracking.test.js
```

**Result: 144 tests, 144 pass, 0 fail** (46 suites, ~324 ms). The intake
evaluation's 144/144 still holds. Per-spec breakdown (each also run solo):

| Spec | Tests | Result |
|---|---|---|
| `server/__tests__/plan-ingest.test.js` | 27 | 27/27 pass |
| `server/__tests__/plans-api.test.js` | 21 | 21/21 pass |
| `server/__tests__/plan-writeback.test.js` | 27 | 27/27 pass |
| `server/__tests__/detour-disposition.test.js` | 14 | 14/14 pass |
| `server/__tests__/db-migration.test.js` | 15 | 15/15 pass |
| `server/__tests__/reconciliation-full-tick.test.js` | 9 | 9/9 pass |
| `server/__tests__/chronology-ordering.test.js` | 6 | 6/6 pass |
| `server/__tests__/single-writer-guard.test.js` | 5 | 5/5 pass |
| `server/__tests__/pace-tracking.test.js` | 20 | 20/20 pass |

### 1.2 Pool-adjacent server specs (feeds the new pool assembly reads)

```bash
node --test server/__tests__/intake-scan.test.js server/__tests__/repo-topology.test.js
```

**Result: 27 tests, 27 pass, 0 fail** — `intake-scan.test.js` 12/12,
`repo-topology.test.js` 15/15.

### 1.3 Client slice-5 surface

```bash
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx \
  src/pages/__tests__/screens.snapshot.test.tsx
```

**Result: 34 tests, 34 pass, 0 fail** — `ProjectDetail.test.tsx` 15/15,
`screens.snapshot.test.tsx` 19/19 (snapshot baselines currently green against
the dirty working tree).

### 1.4 DEC-2 dependency — trunk-drift worktree (visible, verified by run)

Worktree: `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor`,
branch at `5bed29a` (= master HEAD), **all Phase-1a work uncommitted**
(untracked: `server/lib/git-refs.js`, `server/lib/trunk-drift.js`,
`server/__tests__/git-refs.test.js`, `server/__tests__/trunk-drift.test.js`,
**`server/__tests__/helpers/single-home.js`**).

```bash
cd <worktree> && node --test server/__tests__/git-refs.test.js server/__tests__/trunk-drift.test.js
```

**Result: 36 tests, 36 pass, 0 fail.** Nothing of this exists on master —
slice 1 remains blocked on the merge, but the dependency's own suite is green
in place. Note for the architects: the worktree ships the §9.7 `assertSingleHome`
helper (`server/__tests__/helpers/single-home.js`) — after DEC-2 merges, the
value-ledger closure guard and T4 rogue-writer scan should consume it rather
than re-implement scope derivation.

**No baseline failures were found anywhere.** Total observed: 241/241 across
all runs above (144 + 27 + 34 + 36).

## 2. Existing coverage by surface (verdicts)

Layers this project tests at: server unit/integration (`node --test`,
`server/__tests__/*.test.js`, one spec file per module by convention, plus
cross-cutting structural scans), client component/page (vitest +
testing-library, `client/src/**/__tests__/`), per-screen render snapshots
(`screens.snapshot.test.tsx`), CLI-through-API (`ccam-cli.test.js`, 80 cases).
No e2e layer, no tag/bucket convention — spec-file granularity is the unit.

| Surface (per change brief) | What exists today | Verdict |
|---|---|---|
| Legacy plan mirror + ingest (adjacent-untouched) | `plan-ingest.test.js` 27 incl. the `deletePlanItemsNotIn` cases ("deletes removed numbers" at :235, parent-cascade at :436) | **GUARDED** — and per the brief these must stay green **unmodified** |
| `/api/plans` shapes (adjacent-untouched) | `plans-api.test.js` 21 incl. `GET /api/plans/project/:id` rollup (:128) | **GUARDED** |
| Writeback / reconciliation / detours / pace / decision queue (adjacent-untouched) | `plan-writeback` 27, `reconciliation-full-tick` 9 (incl. byte-parity Scenario C), `detour-disposition` 14, `pace-tracking` 20, `single-writer-guard` 5 | **GUARDED** |
| DB migration path | `db-migration.test.js` 15 with `UPGRADE_CASES` registry (:56) — T1's extension point | **GUARDED** for existing schema; **UNGUARDED** for the three new tables (do not exist) |
| Chronology invariant (§9.2) | `chronology-ordering.test.js` 6 — but `filesToScan` is hand-typed to exactly 5 files (:80-86); `GRANDFATHERED_QUERIES` = 2, length-asserted (:178) | **PARTIAL by construction** — every planned new server file is born outside the scan's scope (§9.7 pre-flag confirmed by direct read) |
| Pool feeds: `scanIntakeForCwd` (public at `intake-scan.js:168`), repo topology | `intake-scan.test.js` 12 (real tmp git repos, `ISOLATED_GIT_ENV` at :38 — T3's named template), `repo-topology.test.js` 15 | **GUARDED** as feeds; pool *assembly* over them: **UNGUARDED** (doesn't exist) |
| Pool feed: `detectTrunkDrift` | 36/36 in the worktree only; zero on master | **UNGUARDED on master** (DEC-2) |
| Project Detail page (slice-5 host) | `ProjectDetail.test.tsx` 15, `screens.snapshot.test.tsx` 19 | **GUARDED** for current cards; the new panel slot: UNGUARDED (doesn't exist) |
| Locale key parity (`projectDetail.json` ×4) | `client/src/i18n/__tests__/i18n.test.ts` — spot-checks nav/usage keys via a `LOCALES` table; **no full key-set parity assertion across the four `projectDetail.json` files** | **PARTIAL** — slice 5's new keys are not automatically parity-checked on master today (note: the trunk-drift worktree modifies this test) |
| `ccam` CLI | `ccam-cli.test.js` 80 cases incl. "plan & focus" (:344) and offline-mode (:653) describes — T6's template | **GUARDED** for existing commands; `ccam ledger`: UNGUARDED (doesn't exist) |

### New modules — nearest analogous spec templates + legacy-coverage check

Repo-wide grep (`value.?ledger|cwd.?identity|plan.?lifecycle|project.?plans|PlanLedgerPanel|value_claims|project_plan`)
over `server/ client/ bin/ mcp/` returns **exactly one hit**, and it is not
coverage — see the collision note below. **Confirmed: zero partial/legacy
coverage exists for any planned behavior; nothing to break or duplicate.**

| Planned module | Verdict today | Best existing template |
|---|---|---|
| `server/lib/value-ledger.js` | UNGUARDED | `detour-disposition.test.js` (CHECK-mirrored vocabulary, `DISPOSITIONS` pattern) + `reconciliation-full-tick.test.js` Scenario C (cross-consumer parity shape for T6) |
| `server/lib/cwd-identity.js` | UNGUARDED | `repo-topology.test.js` (real-git identity/worktree resolution fixtures) |
| `server/lib/plan-lifecycle.js` | UNGUARDED | `plan-writeback.test.js` (transactional composer + negatives) + `single-writer-guard.test.js` (closure single-writer guard, red-proof-by-rogue-injection procedure) |
| `server/routes/project-plans.js` | UNGUARDED | `plans-api.test.js` (route spec shape); `detour-disposition.test.js` for vocab-validated writes |
| `ccam ledger` | UNGUARDED | `ccam-cli.test.js` "plan & focus" + offline-mode describes; T6 parity has **no existing analogue anywhere** — it is the per-shape spec §9.1's QA note says never gets written; it must be a named file (`ledger-metrics-parity.test.js`) |
| `client/src/components/PlanLedgerPanel.tsx` | UNGUARDED | `PlanPanel.test.tsx` / `PlanModal.test.tsx` (component-with-api-mock pattern, `vi.mock("../../lib/api")`); page integration per `ProjectDetail.test.tsx` |

**Naming-collision note (only grep hit):** `server/openapi-extra/plans.js:236`
already defines OpenAPI `operationId: "getProjectPlans"` for the **legacy**
`GET /api/plans/project/{projectId}` rollup. When `/api/project-plans` gets its
OpenAPI entry, that operationId is taken — a live R1 (dual-plan-surface
never-blend) hazard at the docs/openapi layer that the plan does not mention.

## 3. Registry / consistency gap check (§9.1 / §9.7)

- `chronology-ordering.test.js:80-86` `filesToScan` is hand-typed:
  `server/db.js`, `lib/detours.js`, `lib/reconciliation.js`, `routes/detours.js`,
  `routes/decision-queue.js`. Confirmed by direct read. All four planned server
  files fall outside it — §9.7's 5th pre-flag is accurate; same-commit
  registration + derived scope (DEC-9) is a genuine obligation, not hygiene.
- `GRANDFATHERED_QUERIES` = 2 entries, with a length assertion at :178 — the
  "stays 2" DoD line is mechanically checkable today.
- `db-migration.test.js` `UPGRADE_CASES` (:25 "do not add to this array" for
  new columns) — T1's no-`UPGRADE_CASES` scoping matches the file's own
  convention: new tables, not new columns, so nothing to register there.
- §9.3 sweeps run clean on master today: `grep -rn "assert.ok(true"` and
  `grep -rn "|| true"` over `server/__tests__/` both return 0.
- i18n key-set parity: no full-namespace parity registry exists — `i18n.test.ts`
  asserts hand-picked keys. Slice 5's ×4-locale keys will need either explicit
  cases there or a parity loop; today an omitted `ko` key ships green.

## 4. Conventions for placing the new tests

- Server: one spec per module in `server/__tests__/<module-name>.test.js`,
  `node --test`, temp DBs via the suite's existing helpers; structural guards
  colocated as their own spec (`single-writer-guard.test.js` shape) with a
  recorded red state. Real-git fixtures: copy `intake-scan.test.js`'s
  `ISOLATED_GIT_ENV` verbatim (its own comment says so).
- Ordering assertions: `server/__tests__/helpers/ordering.js`
  `assertOrderedByCreatedAt` — use it, don't re-derive (§9.3 tautology trap).
- Client: `client/src/components/__tests__/PlanLedgerPanel.test.tsx` beside
  `PlanPanel.test.tsx`; page updates in `ProjectDetail.test.tsx`; snapshot
  regen via `cd client && npx vitest run -u` with reviewed diff only.
- Single-spec runs: `node --test server/__tests__/<file>` /
  `cd client && npx vitest run <path>`.

## 5. Caveats on this baseline

- **Dirty working tree.** Master's working tree carries substantial uncommitted
  modifications (incl. `ProjectDetail.tsx`, `api.ts`, `types.ts`,
  `projectDetail.json` ×4 — the exact slice-5 files) and the trunk-drift
  worktree modifies the same files. This baseline is against the working tree
  as of 2026-08-02, not a clean `5bed29a` checkout. The R6/DEC-2 sequencing
  collision is live; re-baseline after the DEC-2 merge before slice 1.
- Server suites here were run per-surface, not the full `npm run test:server`
  world — sufficient for this map; the build's DoD still requires the full run.
- Nothing was unrunnable; no result above is assumed.
