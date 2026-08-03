# Engineer findings — plan lifecycle + value ledger

**Intake:** `intake/2026-08-02-plan-lifecycle-value-ledger/` · Engineer pass 2026-08-02 (auto-pilot; recommendations marked **[REC]**)
All paths relative to `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor` unless absolute.

---

## 0. Headline findings (read these first)

1. **Do not rebuild `plans`/`plan_items` in place.** `plans` is `PRIMARY KEY (cwd)`
   (`server/db.js:561-570`) and `plan_items` is `PRIMARY KEY (cwd, item_id)` with an
   FK to `plans(cwd)` (`server/db.js:596-612`). Grep confirms **10 non-test server
   files** consume the cwd-keyed plan statements (`getPlanByCwd`, `listPlanItems`,
   `getPlanItem`, `getPlanItemById`, `upsertPlanItem`, `deletePlanItemsNotIn`):
   `db.js`, `lib/focus-audit.js`, `lib/focus-commands.js`, `lib/focus-inference.js`,
   `lib/focus-report.js`, `lib/plan-ingest.js`, `lib/plan-writeback.js`,
   `lib/portfolio.js`, `lib/reconciliation.js`, `routes/plans.js`, plus
   `routes/sessions.js`. Re-keying that PK would be a §9.6 double-table rebuild on the
   shared user-global DB **and** a rewiring pass across all of the above.
   **[REC]** Build the lifecycle as **additive new tables** (see §1) and leave the
   ingest-owned mirror tables untouched; retire them later as their own change.

2. **The `deletePlanItemsNotIn` data-loss trap is real and confirmed.**
   `server/lib/plan-ingest.js:396` runs
   `stmts.deletePlanItemsNotIn.run(cwd, JSON.stringify(parsed.items.map(i => i.id)))`
   inside every changed-file ingest — any row in `plan_items` whose id is not in the
   file **is deleted**. Re-ingest fires from three live triggers: the background poll
   (`startPlanPoll`, `server/index.js:613`, mtime-fingerprinted, default-on), the
   SessionStart hook path (`server/routes/hooks.js`), and `POST /api/plans/refresh`
   (`server/routes/plans.js:64`). If DB-authored plan items were stored in
   `plan_items`, the next file touch would silently delete them. The additive-tables
   design in §1 makes this structurally impossible (generation items live in a table
   ingest never writes); if anyone instead proposes reusing `plan_items`, this is a
   blocking objection.

3. **A sibling effort is mid-build on the exact machinery Part B needs.**
   `intake/2026-08-02-trunk-drift-detection/` is at Phase 1a in worktree
   `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor`
   (red/green evidence exists; nothing merged to master yet — `server/lib` has no
   `trunk-drift.js`/`git-refs.js` on master). Per its `technical-plan.md` it lands:
   - `server/lib/git-refs.js` — `execGit`, `resolveDefaultBranch` (which branch is trunk);
   - `server/lib/trunk-drift.js` — `detectTrunkDrift(repoPath, { seenShas })`, the
     direct-to-trunk commit lister with a dedup seam;
   - `server/lib/db-rebuild.js` — `rebuildTableAtomically(...)`, the §9.6 durable cure;
   - `GET /api/projects/:id/trunk-drift` + a `detour_dispositions.source='trunk_drift'`
     CHECK-widening rebuild.
   **[REC]** Sequence this feature **after** trunk-drift merges. Part B's
   "direct-to-trunk commits" pool input is `detectTrunkDrift`'s output almost verbatim
   (its `seenShas` parameter is shaped exactly like the ledger's claimed-commit
   ratchet), and any rebuild this feature needs must call `rebuildTableAtomically`,
   not hand-roll a 7th site. Building both concurrently guarantees a merge collision
   in `server/lib/` and a duplicated commit-walker (§9.1's "copies of its helpers"
   lesson).

4. **Mechanical slug attribution already exists but is not exported.**
   `fetchMergedEffortSlugs(cwd)` (`server/lib/intake-scan.js:143-160`) already parses
   `Merge effort/<slug>:` commits into a slug→short-hash map in one `git log`
   subprocess — exactly Part B's "mechanical" tier. It is **absent from
   `module.exports`** (`intake-scan.js:223-230`); the pool assembler either adds it to
   the export list (1-line change) or consumes `scanIntakeForCwd()`'s per-initiative
   `mergeCommit` field, which already carries the same data plus stage/worktree.
   **[REC]** consume `scanIntakeForCwd` output — it is the richer, already-public shape.

---

## 1. Exact change set

### Part A — Plan lifecycle (schema + import + API)

**`server/db.js`** — new additive tables (CREATE TABLE IF NOT EXISTS in the main
`db.exec` block; new prepared statements in `stmts`). **[REC]** shape:

- `plan_generations`: `id INTEGER PK AUTOINCREMENT`, `project_id TEXT NOT NULL` (no
  FK — same audit-outlives-parent stance as `detour_dispositions.project_id`,
  `db.js:699`), `cwd TEXT` (nullable provenance: which repo's AGENT-PLAN.md seeded it,
  if any), `title`, `status TEXT NOT NULL DEFAULT 'open' CHECK(status IN
  ('open','closed'))`, `opened_at`, `closed_at`, `closure_note TEXT`,
  `created_at`/`updated_at`. Multiple open rows per project = DEC-P5 satisfied by
  construction (no unique constraint on project_id).
  *Note the WATCH-4 lesson before adding any richer status enum: a CHECK is
  rebuild-to-widen. Two states is the request's own vocabulary; keep it two.*
- `generation_items`: `id INTEGER PK AUTOINCREMENT`, `generation_id INTEGER NOT NULL
  REFERENCES plan_generations(id)`, `parent_id INTEGER` (self-nesting, replaces
  parent_item_id semantics), `text`/`acceptance`/`detail`, `checked`, `position`,
  `source_item_id TEXT` — the legacy `plan_items.item_id` carried through import so
  focus history (`focus_inferences.item_id`, `detour_dispositions.item_id`/
  `resolved_item_id`, `session_focus`) stays correlatable without touching those
  tables.
- `value_claims` (Part D's table, but it ships with A because closure semantics need
  it): `id INTEGER PK`, `generation_item_id INTEGER NOT NULL REFERENCES
  generation_items(id)`, `unit_kind TEXT NOT NULL CHECK(unit_kind IN
  ('trunk_commit','initiative','detour'))`, `unit_ref TEXT NOT NULL` (sha / intake
  slug path / detour_dispositions.id), `unit_meta TEXT` (JSON: subject, date,
  confidence tier), `tier TEXT CHECK(tier IN ('mechanical','correlational','judgment'))`,
  `claimed_at`, `claimed_by`. `UNIQUE(unit_kind, unit_ref, generation_item_id)` — one
  unit may be claimed into multiple items (the open cardinality question resolves to
  many-to-many at the schema level; the UI can still discourage it).
- Because all three are **new** tables, §9.5's ALTER-TABLE burden does not apply,
  but each still needs the fresh-vs-existing-DB awareness test in
  `server/__tests__/db-migration.test.js` (`UPGRADE_CASES` note at line 25: "new
  columns must have an UPGRADE_CASES entry") — for new tables the equivalent is a
  legacy-DB boot test proving `CREATE TABLE IF NOT EXISTS` lands them on an old DB.

**Import path (DEC-P2):** new function in a new module **[REC]**
`server/lib/plan-lifecycle.js` — `importGenerationFromPlan(dbModule, cwd, projectId)`
reads the already-ingested `plans`/`plan_items` rows (via `stmts.getPlanByCwd`/
`listPlanItems` — no new file parsing; `plan-ingest.js` stays the sole parser) and
copies them into `plan_generations`/`generation_items` as generation 1, stamping
`source_item_id`. Idempotency: skip if a generation with this `cwd` provenance
already exists for the project. The legacy per-cwd sync keeps running untouched —
DB-led editing happens only in the new tables, so nothing needs to be disabled and
the `deletePlanItemsNotIn` trap is never in the write path.

**`server/lib/plan-writeback.js` fate:** with the additive design, **no change in
this slice**. It keeps servicing the existing detour→AGENT-PLAN.md flow for
not-yet-imported repos. Its retirement (or repurposing as the read-only
AGENT-PLAN.md export generator) is a follow-on decision — flagged as the request's
own open question #1; nothing in Parts A–D requires deciding it first. The
`single-writer-guard.test.js` (209 lines, exact call-site count) will fail loudly if
anyone touches its call topology by accident — that is protection, not friction.

**Routes** — **[REC]** new `server/routes/plan-lifecycle.js` mounted at
`/api/plan-lifecycle` (or extend `routes/plans.js`; new file preferred — `plans.js`
is documented as "read-only mirror" in its own header, `routes/plans.js:2-9`, and
these are write endpoints with a different owner):
- `GET /projects/:id/generations` (open + closed, items nested)
- `POST /projects/:id/generations` (create, incl. retroactive bundle)
- `POST /generations/:gid/close` `{ closure_note }` — the DEC-P6 door
- `POST /generations/:gid/items`, `PATCH /items/:itemId`, `DELETE /items/:itemId`
- `POST /projects/:id/generations/:gid/import-plan` `{ cwd }` (gen-1 import trigger)
- WebSocket: **additive** message types `plan_generation_updated`,
  `value_claim_updated` via `broadcast()` — additive types satisfy the "keep message
  types stable and backward-compatible" rule; do not overload the existing
  `plan_updated` (6 call sites, established payload shape `{ plan, items }`).

### Part B — Unclaimed value pool

**[REC]** new `server/lib/value-pool.js` — `assembleValuePool(dbModule, project)`,
live-computed per request (the `repo-topology.js` posture), returning units minus
anything present in `value_claims`:
- **Trunk merge commits (mechanical):** from `scanIntakeForCwd()`
  (`server/lib/intake-scan.js:168`) — each initiative's `mergeCommit` + `slug` +
  `stage`.
- **Direct-to-trunk commits (detour candidates):** `detectTrunkDrift(cwd, { seenShas:
  claimedShas })` from the trunk-drift effort's `server/lib/trunk-drift.js` — the
  claims table's shas feed `seenShas`, which *is* the ratchet.
- **Intake initiatives:** same `scanIntakeForCwd()` call (one scan, two unit kinds).
- **Detours:** `detour_dispositions` rows for the project's cwds — statements already
  exist (`server/lib/detours.js`, `server/routes/detours.js:37`).
- **Focus bracketing (correlational):** `sessions(cwd, started_at, ended_at,
  updated_at)` (schema `db.js:138-146`; `updated_at` added by migration at
  `db.js:1110-1114`) joined against commit author dates to produce *suggested*
  session→commit attributions. Any query walking `events`/`focus_inferences` here
  must `ORDER BY created_at, id` before any `LIMIT` (§9.2) and the new module must be
  **added to `filesToScan`** in `server/__tests__/chronology-ordering.test.js`
  (hand-typed list at the `describe` block, currently 5 files — §9.7's exact trap).
- Route: `GET /api/projects/:id/value-pool` in the new router.
- **Baseline (open question #2) [REC]:** default the first-run trunk-commit lookback
  to the trunk-drift module's own env-tunable lookback window rather than full
  history; add `POST .../pool-baseline` to let Sara pin an explicit "start counting
  from here" commit per project. Cheap, reversible, avoids a 3,000-commit pool on
  day one.

### Part C — Two-pane workbench (client)

- **Placement (open question #4) [REC]:** a **new page** `client/src/pages/
  PlanWorkbench.tsx` at route `/projects/:id/reconcile`, linked from
  `ProjectDetail.tsx` — NOT more sections inside `ProjectDetail.tsx`, which is
  already 1,433 lines composing four fetches (its own header documents the
  four-section layout). Route registration follows the existing pattern in the
  client router (where `/projects/:id` is registered).
- `client/src/lib/api.ts`: new namespace (e.g. `api.planLifecycle`) beside the
  existing `plans` namespace (`api.ts:2511`); typed functions for every route above.
- `client/src/lib/types.ts`: `PlanGeneration`, `GenerationItem`, `ValueUnit`,
  `ValueClaim`, pool/health types (existing `Plan`/`PlanItem` at `types.ts:2057-2124`
  stay untouched).
- i18n: new namespace file (e.g. `planWorkbench.json`) in **all four locales** —
  `client/src/i18n/locales/{en,ko,vi,zh}/` — plus registration wherever namespaces
  are enumerated (check `client/src/i18n/` index).
- Tests: new `client/src/pages/__tests__/PlanWorkbench.test.tsx`; add the screen to
  `client/src/pages/__tests__/screens.snapshot.test.tsx` (currently 19 screens) and
  regenerate baselines deliberately (`cd client && npx vitest run -u`, reviewed diff).

### Part D — Ledger + health metrics

- Table ships in Part A (`value_claims` above). Claim/unclaim routes:
  `POST /generations/:gid/claims` `{ unit_kind, unit_ref, unit_meta, tier,
  generation_item_id | new_item: {...} }` (claim-into-existing or
  create-item-from-unit in one call), `DELETE /claims/:id`.
- Health metrics — **§9.1 alert**: pool size and time-since-last-closure are derived
  values that will immediately have ≥2 consumers (workbench UI, Project Detail badge,
  `ccam`, later MCP). **One** server-side computation, **[REC]** in
  `server/lib/value-pool.js` (`computePlanHealth(dbModule, project)`), surfaced
  inside the pool endpoint's response — never recomputed client-side. Note: `mcp/src/tools/`
  currently has **zero** plan-related tools (grep confirmed), and `ccam` reads plans
  only via `/api/plans/*` (`bin/ccam.js:945-1031`) — the CLI/MCP read surfaces DEC-P2
  promises are **net-new work**, not adaptations.

---

## 2. Feasibility

Feasible, and cleaner than the request's own framing fears — *provided* the additive
schema route is taken. The dangerous-looking parts (breaking one-plan-per-cwd,
import inversion, re-ingest data loss) all dissolve when generations live in their
own tables: nothing ingest-owned is re-keyed, no rebuild of `plans`/`plan_items` is
needed at all, and the legacy mirror keeps working for repos that haven't imported
yet. The genuinely new engineering is (a) pool assembly with three attribution tiers,
(b) a substantial new two-page UI, and (c) the claims/ratchet semantics.

Hidden coupling found:
- `pace.js`/pace alerts read `plan_items.target_date` — generations don't carry
  target dates in this slice; pace stays on the legacy layer (fine; DEC-P4 altitude).
- `reconciliation.js` reads plan items for its LLM prompt (`buildDispositionPrompt`)
  — untouched by the additive design.
- `GRANDFATHERED_QUERIES` in `chronology-ordering.test.js` asserts its own length
  `=== 2`; any legitimately non-chronological LIMIT query the pool adds needs a
  dated entry *and* the count bumped — by design, not by accident.

## 3. Effort estimate

| Part | Size | Reasoning |
|---|---|---|
| A. Lifecycle (schema, import, routes, tests) | **M** | 3 new tables, no rebuilds, one import function, one new router; heavy test obligation (migration boot test, route tests, §9.3 red-proofs) |
| B. Pool | **M** *(after trunk-drift merges; L if built concurrently)* | 2 of 4 inputs are existing calls; bracketing queries + ratchet are the new logic |
| C. Workbench UI | **L** | Two-pane editing UI, item CRUD, close flow, history browser, ×4 locales, snapshot updates, wip-queue-precedent checkpointing |
| D. Ledger/metrics | **S** (on top of A) | Table lands with A; claim routes + one shared health computation + tests |

Whole feature: **L**, and per the wip-queue revert precedent it must ship in slices
with a Sara checkpoint after A+B are usable via API/`ccam` and before C is built out.

## 4. Dependencies & build order

1. **Trunk-drift effort merges first** (lands `git-refs.js`, `trunk-drift.js`,
   `db-rebuild.js`/`rebuildTableAtomically`, and the `detour_dispositions` source
   rebuild). Hard ordering; see §0.3.
2. **A** (tables + import + generation routes) — everything else references these ids.
3. **D** (claims + health) — same slice or immediately after A; closure without
   claims is meaningless.
4. **B** (pool endpoint) — needs claims for the ratchet and trunk-drift for commits.
5. **Checkpoint with Sara** — exercise A+B+D via API/`ccam` on the real Coaching
   Assistant data (the originating use case) before any UI.
6. **C** (workbench UI) last, possibly itself sliced (read-only two-pane → claiming →
   in-place editing → close flow).

## 5. Gotchas (defect-class catalog applied)

- **§9.6 / §9.5:** the additive design needs **zero rebuilds** — keep it that way.
  If any later slice must widen a CHECK, use `rebuildTableAtomically` (from
  trunk-drift), never a 7th hand-roll; verify the `agents` reference site **by grep**
  (`ALTER TABLE (\w+) RENAME TO`), not by the catalog's line numbers (already went
  stale once).
- **Ingest deletion trap:** never store DB-authored items in `plan_items`
  (`plan-ingest.js:396` deletes them on the next file change). The additive tables
  are the cure; a review must reject any "reuse plan_items" shortcut.
- **§9.7 hand-scoped scans:** `chronology-ordering.test.js`'s `filesToScan` is a
  hand-typed 5-file list — `value-pool.js` and the new router **must be added**, or
  every §9.2 obligation in Part B is unenforced while green.
- **§9.2:** focus-bracketing queries over `events`/`focus_inferences`/`sessions`
  sort by `created_at, id` before any `LIMIT`; use
  `server/__tests__/helpers/ordering.js`'s `assertOrderedByCreatedAt`.
- **§9.1:** pool size + time-since-closure = one server-side function with named
  consumers from day one; `ccam`/MCP surfaces are net-new consumers, not free.
- **§9.3:** every new structural guard (e.g. "only the lifecycle router writes
  `generation_items`") must be red-proven by mutation before it counts.
- **WebSocket:** additive message types only; do not change `plan_updated`'s payload.
- **Snapshot tests:** `screens.snapshot.test.tsx` will need a deliberate,
  reviewed `-u` regeneration for the new page and any ProjectDetail link changes.
- **i18n:** four locales (`en/ko/vi/zh`) per new namespace — a missing locale file
  fails silently to English, easy to ship unnoticed.
- **File headers:** every new `.js/.ts/.tsx` needs the overview + `@author Son
  Nguyen <hoangson091104@gmail.com>` header
  (`bash .claude/skills/file-headers/scripts/check-headers.sh` must exit 0).
- **Concurrent-session risk (project memory):** two efforts are already working this
  repo's `server/lib/` surface in worktrees; check `git worktree list` and running
  sessions before any git operation.

## 6. Verification hooks (existing tests that would catch mistakes)

- `server/__tests__/plan-ingest.test.js` (477 lines) — regressions in the ingest the
  import path reads from; its delete-semantics cases are the ones that would catch a
  wrong "reuse plan_items" move.
- `server/__tests__/plans-api.test.js` (380) — existing `/api/plans` response shapes
  stay stable (route-preservation rule).
- `server/__tests__/db-migration.test.js` — `UPGRADE_CASES` registry; new-table boot
  coverage goes here.
- `server/__tests__/single-writer-guard.test.js` (209) — fails if the writeback call
  topology is disturbed.
- `server/__tests__/chronology-ordering.test.js` — the §9.2 static scan (after scope
  registration) + `helpers/ordering.js`.
- `server/__tests__/intake-scan.test.js`, `repo-topology.test.js` — the pool's input
  modules.
- `server/__tests__/reconciliation-full-tick.test.js` (805), `detour-disposition.test.js`
  (499), `pace-tracking.test.js` — prove the untouched-by-design surfaces stayed
  untouched.
- Client: `PlanPanel.test.tsx`, `PlanModal.test.tsx`, `ProjectDetail.test.tsx`,
  `screens.snapshot.test.tsx` (19 screens).
- Commands: `npm run test:server`, `npm run test:client`, `npm run mcp:typecheck` if
  MCP tools are added.
