# Technical Plan — Plan lifecycle + value ledger ("plans as closable value-buckets")

**Intake item:** `intake/2026-08-02-plan-lifecycle-value-ledger/`
**Role:** intake-tech-lead · **Date:** 2026-08-02 · **Run mode:** auto-pilot
**Classification (PM, confirmed):** `new-feature` — the WATCH-2 thread from
`intake/2026-08-01-build-project-manager/`.
**Inputs reconciled:** `request.md`, `request-brief.md`, `decisions.md`
(DEC-P1..P6 = hard constraints), `supporting/{product-owner,architect,engineer,qa}.md`,
`pm-plan.md` (incl. its two corrections), `PROJECT-CONTEXT.md` §9.1–§9.7 +
candidate pattern CWD-IDENTITY-FANOUT.
**Tracked rows this plan opened:** DEC-2 … DEC-18 in this item's `decisions.md`
(appended by this pass — every declined/deferred scope boundary below cites one).

> **Numbering note.** Inside this item, a bare `DEC-n` means *this* item's
> `decisions.md`. Decisions from the prior effort are always cited in full, e.g.
> **`DEC-7 (2026-08-01-build-project-manager)`** — the still-open live-trial gate.

---

## 1. Objective

Add a portfolio-layer **plan lifecycle + value ledger** to the dashboard so that
delivered work can be *claimed into* a plan and the plan *closed*, making
"what value did this project deliver, and did we clear the milestone?" answerable
from recorded state instead of archaeology. End state: three new additive SQLite
tables (`project_plans`, `project_plan_items`, `value_claims`) keyed by
`project_id`; a one-shot DEC-P2 import that turns each existing `AGENT-PLAN.md`
into **generation 1** with no mirror-sync and therefore no data-loss path; one
shared server module (`server/lib/value-ledger.js`) that owns pool assembly,
health metrics and the whole-life summary for *every* consumer; a
`/api/project-plans` route namespace plus a `ccam ledger` CLI surface; and — only
after Sara has judged the pool "signal, not noise" on real Coaching Assistant
data — a self-contained `<PlanLedgerPanel>` component rendered inside the
existing Project Detail page. The legacy cwd-keyed `plans`/`plan_items` mirror,
the focus stack, pace, detours and reconciliation are **untouched** in this
effort.

---

## 2. Recommended approach

**Additive portfolio layer, live-derived pool, persisted claims, derived
closure.** Concretely:

1. **New tables, zero rebuilds, zero `ALTER`** (architect A3 + engineer §0.1).
   `plans.cwd` stays the PK of the legacy mirror; nothing is re-keyed. This makes
   §9.5/§9.6 **inapplicable rather than complied-with** — the stronger outcome
   the PM asked for — and makes the `deletePlanItemsNotIn` data-loss trap
   (`server/lib/plan-ingest.js:396`, fired by three live triggers) *structurally
   impossible* rather than guarded: the new tables have no mirror-sync analogue
   and `plan-ingest.js` never writes them. **Any "just reuse `plan_items`"
   shortcut is a blocking objection at review.**
2. **The PM's merged schema is the schema** (PM correction 2) — architect's table
   names + `succeeds_plan_id` generation chain with a *derived* ordinal;
   architect's **full 5-value** `value_source` vocabulary and **all three**
   `attribution` tiers in the initial `CREATE TABLE` (WATCH-4 / DEC-15 of the
   prior effort: a `CHECK` is rebuild-to-widen, so the final vocabulary lands up
   front even though slice 1–3 only produce three sources); explicit snapshot
   columns, not a JSON blob; **closure derived by join, never copied onto claim
   rows**.
3. **Trunk feed is the live `detectTrunkDrift()` call** (PM correction 1 —
   engineer's form, *not* the architect's Phase-1b `detour_dispositions
   source='trunk_drift'` rows, which would transitively block this whole request
   on `DEC-7 (2026-08-01-build-project-manager)`). A value unit's identity is
   `('trunk_commit', <sha>)` **regardless of which feed produced it**, deduped
   once at assembly, with a named test — otherwise the day trunk-drift Phase 1b
   lands, every direct-to-trunk commit appears twice and the health metric
   doubles (R7).
4. **Pool derived, claims persisted** (architect B3). Observations stay live
   (`repo-topology.js` / `intake-scan.js` posture); judgments persist
   (`detour_dispositions` / `decision_queue` posture). The claim row *is* the
   ratchet: once written, its unit never re-enters the pool.

### Where I overrode an evaluator

| Override | What the evaluator said | Decision | Why |
|---|---|---|---|
| **Module naming** | Engineer: `server/lib/value-pool.js` (pool + health) | **One module `server/lib/value-ledger.js`** owns pool assembly, claim reads, health metrics *and* the whole-life summary | §9.1 wants *one* home for derived value; splitting pool from ledger invites the second home. QA's spec **paths are kept** (`value-pool.test.js` = pool behaviours, `value-ledger.test.js` = claims/close/health) — two specs, one module, stated here so nobody creates a `value-pool.js` to match a filename. (DEC-5) |
| **QA T1 rebuild work** | QA T1/I4: rebuild `plans`/`plan_items`, atomic + interruption test, land `rebuildTableAtomically` | **Dropped.** There is no rebuild in this design | QA priced T1 against the A1 "re-key in place" option that both architect and engineer rejected. T1 shrinks to a legacy-DB boot test proving `CREATE TABLE IF NOT EXISTS` lands the three new tables on an old DB. `rebuildTableAtomically` belongs to whichever effort actually needs a rebuild (PM §6.2) |
| **QA T4 / I5** | QA: consciously rewrite `plan-ingest.test.js`'s "deletes removed numbers" case; re-point `pace.js` per-plan; concurrent-plan focus disambiguation | **Not in this effort.** `plan-ingest.test.js` stays **unmodified** and green; pace + focus stay on the legacy layer | Under the additive design "deletes removed numbers" remains *correct* behaviour for the file-mirrored layer. That those 36 cases need no edit is the evidence the inversion cost nothing. T4 is repurposed (see §6). Concurrent-plan fallout on focus/pace is deferred → **DEC-18 (WATCH)** |
| **UI placement** | Engineer: new page `/projects/:id/reconcile`; PO/architect: inside Project Detail | **PM's split adopted:** self-contained `<PlanLedgerPanel>` component *file* rendered by Project Detail; no new route/nav/locale namespace in v1 | Meets the engineer's 1,433-line size concern without paying `18196dc`'s revert cost (route + nav + ×4 locales). Promotion to a dedicated page → **DEC-16 (WATCH)** |
| **Architect's `plan-writeback` re-pointing in this effort** | Architect §3: for imported plans, `fold_in`/`new_item` write `project_plan_items` directly | **Not in this effort.** No change to `plan-writeback.js` or `reconciliation.js` | It is Sara's call (both DEC-2 and DEC-13 of the prior effort were her explicit calls against team lean) and it is gated on `DEC-7 (2026-08-01-build-project-manager)`. → **DEC-10 (PENDING)**, **DEC-11 (PENDING)** |

---

## 3. Change set (by layer)

All paths relative to `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`.
Every new `.js`/`.ts`/`.tsx` file starts with the file-overview +
`@author Son Nguyen <hoangson091104@gmail.com>` header
(`bash .claude/skills/file-headers/scripts/check-headers.sh` must exit 0).

### 3.1 Database — `server/db.js` (modify)

Three `CREATE TABLE IF NOT EXISTS` blocks inside the existing main `db.exec`
schema block (place immediately after the `detour_dispositions` block, ~line 696+,
locate by grep not line number), plus new prepared statements in `stmts`.
**No `ALTER TABLE`, no rebuild, no `UPGRADE_CASES` entry needed** (new tables,
not new columns on old tables).

```sql
-- Portfolio-layer plans (DEC-P1/P5/P6). Keyed by project_id, NOT cwd: the
-- legacy cwd-keyed `plans` mirror above is a different layer and is untouched.
-- project_id is a soft ref with NO FK/CASCADE - a closed generation is an
-- audit record that outlives its project row, same stance as
-- detour_dispositions.project_id. Generation ordinal is DERIVED by walking
-- succeeds_plan_id; nothing stores it, so nothing can drift.
CREATE TABLE IF NOT EXISTS project_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  succeeds_plan_id INTEGER REFERENCES project_plans(id),
  origin TEXT NOT NULL DEFAULT 'manual'
    CHECK(origin IN ('manual','import','retroactive_bundle')),
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at TEXT,
  closure_note TEXT,
  imported_from_cwd TEXT,        -- canonicalized (cwd-identity.js) at import
  imported_content_hash TEXT,    -- plans.content_hash at import time
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_project_plans_project
  ON project_plans(project_id, status);
-- Import idempotency is keyed on (project_id, content_hash), NEVER on cwd -
-- CWD-IDENTITY-FANOUT: /SARA/DND and /SARA/dnd are one inode with one
-- content_hash and two plans rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_plans_import
  ON project_plans(project_id, imported_content_hash)
  WHERE imported_content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES project_plans(id),
  parent_item_id INTEGER REFERENCES project_plan_items(id),
  text TEXT NOT NULL,
  acceptance TEXT,
  detail TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  target_date TEXT,              -- same shape pace.js reads; unused in v1 (DEC-18)
  imported_item_id TEXT,         -- legacy plan_items.item_id provenance
  imported_from_cwd TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_project_plan_items_plan
  ON project_plan_items(plan_id, position);
CREATE INDEX IF NOT EXISTS idx_project_plan_items_parent
  ON project_plan_items(parent_item_id);

-- The ONLY persisted judgment in this feature. Note what is absent: there is
-- no closed_at / closed flag here. A claim's closed-ness is a JOIN to
-- project_plans.status - copying the stamp onto N rows is 9.1's
-- write-sequence form (PM correction 2, architect 5).
CREATE TABLE IF NOT EXISTS value_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  plan_id INTEGER NOT NULL REFERENCES project_plans(id),
  item_id INTEGER NOT NULL REFERENCES project_plan_items(id),
  -- Full final vocabulary up front (WATCH-4 / DEC-15 of 2026-08-01: a CHECK is
  -- rebuild-to-widen). v1 emits trunk_commit / merge_commit / intake_initiative
  -- / detour; focus_segment is reserved for the correlational tier.
  value_source TEXT NOT NULL CHECK(value_source IN
    ('trunk_commit','merge_commit','intake_initiative','detour','focus_segment')),
  value_ref TEXT NOT NULL,       -- sha | intake slug | detour_dispositions.id | segment key
  source_cwd TEXT NOT NULL DEFAULT '',  -- canonicalized; '' not NULL so the
                                        -- UNIQUE index below actually bites
  label_snapshot TEXT,
  seen_at_snapshot TEXT,
  stage_snapshot TEXT,
  attribution TEXT NOT NULL CHECK(attribution IN
    ('mechanical','correlational','judgment')),
  claimed_by TEXT NOT NULL DEFAULT 'human' CHECK(claimed_by IN ('human','llm')),
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_value_claims_unit_item
  ON value_claims(value_source, value_ref, source_cwd, item_id);
CREATE INDEX IF NOT EXISTS idx_value_claims_plan ON value_claims(plan_id);
CREATE INDEX IF NOT EXISTS idx_value_claims_unit
  ON value_claims(value_source, value_ref);
```

New `stmts` entries (naming follows the existing convention):
`listProjectPlans`, `getProjectPlan`, `insertProjectPlan`, `updateProjectPlanTitle`,
`closeProjectPlan`, `listProjectPlanItems`, `getProjectPlanItem`,
`insertProjectPlanItem`, `updateProjectPlanItem`, `deleteProjectPlanItem`,
`insertValueClaim`, `listClaimsForProject`, `listClaimsForPlan`, `getValueClaim`,
`deleteValueClaim`, `findProjectPlanByImportHash`, `lastClosureForProject`.
Every `SELECT` with a `LIMIT` over `events`/`sessions`/`focus_inferences` orders
by `created_at, id` first (§9.2).

### 3.2 Server libs (new)

| File | Contents |
|---|---|
| `server/lib/cwd-identity.js` **(new)** | `canonicalizeCwd(cwd)` — `fs.realpathSync` (resolves macOS case-variants to on-disk casing), falls back to the input on `ENOENT`; `repoRootFor(cwd)` — `git rev-parse --show-toplevel` + `--git-common-dir` so an effort-worktree cwd folds to its parent repo root; `dirIdentity(cwd)` — `{dev, ino}` for same-directory detection; `groupCwdsByIdentity(cwds)` → canonical groups + duplicate report. Pure/sync except `repoRootFor` (uses `execGit` from `git-refs.js`). **Single home for cwd identity** — no other module may `realpathSync` a plan/pool cwd |
| `server/lib/plan-lifecycle.js` **(new)** | Plan/item CRUD + the **single closure composer** `closePlan(dbModule, planId, {closure_note, now})` (one transaction: guard `status='open'` → stamp `closed_at`/`closure_note`/`status='closed'` → broadcast). `importGenerationFromPlan(dbModule, {projectId, cwd})` — DEC-P2 import: reads the already-ingested `plans`/`plan_items` rows via `stmts.getPlanByCwd`/`listPlanItems` (**`plan-ingest.js` stays the sole markdown parser**), copies them as generation 1 with `origin='import'`, `imported_content_hash`, `imported_item_id`, preserving `parent_item_id` nesting and `position`. Idempotent on `(project_id, imported_content_hash)`. `generationOrdinal(plan, chain)` derives the ordinal by walking `succeeds_plan_id`. **No delete path for a closed plan or for any claim of a closed plan, ever** |
| `server/lib/value-ledger.js` **(new — the §9.1 single home)** | `assembleValuePool(dbModule, project, opts)`, `computePlanHealth(dbModule, project)` (`{ unclaimedPoolSize, lastClosureAt, daysSinceLastClosure, openPlanCount }`), `summarizeDeliveredValue(dbModule, project)` (the AC-6 whole-life answer: closed generations + their claims), `unitKey(source, ref, cwd)`, and the exported vocabularies `VALUE_SOURCES` / `ATTRIBUTION_TIERS` (CHECK-mirrored, same pattern as `DISPOSITIONS`). **Every derived number in this feature is computed here and nowhere else** |

### 3.3 Server routes (new + registration)

- **`server/routes/project-plans.js` (new)**, mounted `app.use("/api/project-plans", projectPlansRouter)` in `server/index.js` (alongside line ~131). Deliberately a **separate namespace** from `/api/plans` — `routes/plans.js`'s own header documents it as a read-only mirror, and R1 requires the two plan surfaces never blend in one response.

  | Method + path | Purpose |
  |---|---|
  | `GET /api/project-plans?project_id=&status=` | plans (open+closed) with nested items and per-item claims |
  | `GET /api/project-plans/pool?project_id=&lookbackDays=&backfill=1` | assembled pool + `identityWarnings` |
  | `GET /api/project-plans/health?project_id=` | health metrics (from `computePlanHealth` only) |
  | `GET /api/project-plans/history?project_id=` | AC-6 whole-life summary |
  | `POST /api/project-plans/import` `{project_id, cwd}` | generation-1 import |
  | `POST /api/project-plans` `{project_id, title, succeeds_plan_id?, origin?}` | create (incl. retroactive bundle) |
  | `GET|PATCH /api/project-plans/:id(\d+)` | read / rename (open only) |
  | `POST /api/project-plans/:id(\d+)/close` `{closure_note}` | **the only door to closed** (DEC-P6) |
  | `POST /api/project-plans/:id(\d+)/items`, `PATCH|DELETE /api/project-plans/items/:itemId(\d+)` | item CRUD (open plans only) |
  | `POST /api/project-plans/:id(\d+)/claims` | claim a unit into an existing item **or** `{new_item:{...}}` in one call |
  | `DELETE /api/project-plans/claims/:claimId(\d+)` | explicit human unclaim; **rejected if the plan is closed** |

  `:id(\d+)` digit-constrained params keep the literal `pool`/`health`/`history`/
  `import`/`items`/`claims` segments unambiguous; literal routes are declared
  before parameterized ones regardless.
- **WebSocket:** additive types `project_plan_updated`, `value_claim_updated` via
  the existing `broadcast()`. `plan_updated`'s type and `{ plan, items }` payload
  are **not** touched (6 call sites).

### 3.4 CLI — `bin/ccam.js` (modify)

New `cmdLedger(flags, positional)` + a `case "ledger":` in the dispatch and an
entry in `ccam help`:
`ccam ledger plans|pool|health|history|import|claim|close --project <id|name>`.
Health numbers are **printed from the API response verbatim** — no CLI-side
arithmetic (this is T6's parity target).

### 3.5 Client (slice 5 only)

- `client/src/components/PlanLedgerPanel.tsx` **(new)** — self-contained two-pane
  panel (left: open plans + items + close action; right: pool + claim gesture;
  a collapsed closed-generations history list). Rendered by
  `client/src/pages/ProjectDetail.tsx` as one more card; no new route, no nav
  entry, no new i18n namespace.
- `client/src/pages/ProjectDetail.tsx` **(modify)** — one extra fetch + render slot.
- `client/src/lib/api.ts` **(modify)** — `api.projectPlans` namespace beside
  `api.plans` (~line 2511), one typed function per route above.
- `client/src/lib/types.ts` **(modify)** — `ProjectPlan`, `ProjectPlanItem`,
  `ValueUnit`, `ValueClaim`, `PlanHealth`, `ValuePool`. Existing `Plan`/`PlanItem`
  untouched.
- i18n: strings go into the **existing** `projectDetail.json` namespace in all
  four locales `client/src/i18n/locales/{en,ko,vi,zh}/` — no new namespace file
  in v1 (that is exactly the ×4-locale revert cost `18196dc` paid).

### 3.6 Docs (same change-set, per the project rule)

`docs/API.md` (new routes + the two additive WS types), `docs/DATABASE.md` (three
new tables), `ARCHITECTURE.md` (portfolio layer + the DEC-P2 inversion),
`README.md` + `server/README.md` (`ccam ledger`). Apply the
`update-project-docs` skill at the end of each slice that changes behaviour.

---

## 4. Implementation steps (slice-gated, in order)

### Slice 0 — DEPENDENCY (not our code)

1. **Wait for `intake/2026-08-02-trunk-drift-detection` Phase 1a to merge to
   `master`** — it lands `server/lib/git-refs.js` (`execGit`,
   `resolveDefaultBranch`, `isGitRepo`) and `server/lib/trunk-drift.js`
   (`detectTrunkDrift(repoPath, { seenShas, lookbackDays, maxCommits, timeout })`,
   verified signature in the worktree). Do **not** start slice 1 while two
   efforts hold uncommitted `server/lib/` work: run `git worktree list` and check
   running sessions first (project memory: this has caused real work loss).
   **Do not hand-roll a second trunk walker under any schedule pressure.** → **DEC-2**
   *Note: `server/lib/db-rebuild.js` / `rebuildTableAtomically` is Phase **1b**
   and is NOT expected here — this design needs no rebuild, so that is fine.*

### Slice 1 — additive schema + import-as-generation-1

2. Add the three `CREATE TABLE IF NOT EXISTS` blocks + indexes of §3.1 to
   `server/db.js`; add the prepared statements. Nothing else in `db.js` changes.
3. Add `server/lib/cwd-identity.js` (§3.2) with its header.
4. Add `server/lib/plan-lifecycle.js` with plan/item CRUD, `generationOrdinal`,
   and `importGenerationFromPlan`. Import rules, non-negotiable:
   - resolve the target cwd through `canonicalizeCwd` → `repoRootFor` before
     anything else; store the canonical form in `imported_from_cwd`;
   - idempotency key is `(project_id, imported_content_hash)` — **never `cwd`**
     (CWD-IDENTITY-FANOUT: `/SARA/DND` and `/SARA/dnd` are one inode with one
     `content_hash`; a cwd-keyed import would mint two generation-1s from one
     physical file);
   - re-import of the same content hash is a **no-op returning the existing
     plan**, not a second generation;
   - **there is no `deletePlanItemsNotIn` analogue and none may be added.** No
     write path outside `plan-lifecycle.js` and `routes/project-plans.js` may
     touch `project_plan_items`.
5. Add `server/routes/project-plans.js` with the plan/item/import endpoints only
   (pool/claims land in slices 2–3); mount it in `server/index.js`; broadcast
   `project_plan_updated`.
6. Tests: **T1** (extend `server/__tests__/db-migration.test.js` — legacy-shape DB
   boots and gains the three tables; second boot is a no-op) and **T2**
   (`server/__tests__/plan-lifecycle.test.js` — lifecycle state machine, two open
   plans on one project, generation-ordinal derivation, immutability negatives)
   and **T4** (`server/__tests__/plan-import-inversion.test.js` — see §6).
   `server/__tests__/plan-ingest.test.js` must stay **green and unmodified**.
7. `npm run test:server`; docs pass; header check.

### Slice 2 — claims ledger + plan-level close

8. Add `value_claims` write/read statements usage + `POST /:id/claims`,
   `DELETE /claims/:claimId` to the router. `source_cwd` is canonicalized at
   write time; snapshot columns (`label_snapshot`, `seen_at_snapshot`,
   `stage_snapshot`) are filled from the request payload — **reference +
   summary line only, never artifact content** (DEC-P4 ceiling).
9. Implement `closePlan` in `plan-lifecycle.js` as the **single closure
   composer**: one transaction, one row updated, `value_claim_updated` +
   `project_plan_updated` broadcast. Nothing writes a closed flag onto claims.
   Reject: closing an already-closed plan; any item write, claim write, or
   unclaim against a closed plan; any delete of a closed plan.
10. Tests: **T5** (`server/__tests__/value-ledger.test.js`) incl. the closure
    single-writer guard with **scope derived from the module's real export list**
    (§9.7 — no hand-typed names), red-proven by injecting a rogue second
    close-composer call site (template: `single-writer-guard.test.js`).
11. `ccam ledger plans|claim|close` in `bin/ccam.js`.

### Slice 3 — pool assembly (mechanical tier first)

12. Add `server/lib/value-ledger.js`. Assembly order and unit mapping:
    - **mechanical:** `scanIntakeForCwd(cwd)` (already public,
      `server/lib/intake-scan.js:168`) → one `intake_initiative` unit per
      initiative (`value_ref = slug`) and, where `initiative.mergeCommit` is
      non-null, one `merge_commit` unit (`value_ref = <sha>`). Do **not** export
      `fetchMergedEffortSlugs` — `scanIntakeForCwd` is the richer public shape and
      one scan feeds both unit kinds;
    - **mechanical/unattributed:** `detectTrunkDrift(repoRoot, { seenShas })` →
      `trunk_commit` units, where `seenShas` is the set of already-claimed shas
      **and** any sha already emitted by another feed. This is the ratchet;
    - **detours:** `detour_dispositions` rows for the project's cwds, excluding
      `disposition='discard'`. **Mapping rule that makes the dedupe work:** a row
      with `source='trunk_drift'` maps to `('trunk_commit', <source_ref sha>)`;
      every other row maps to `('detour', <disposition id>)`. Therefore the day
      trunk-drift Phase 1b starts persisting rows, its units collide by key with
      the live feed and collapse to one (R7 / **DEC-4**);
    - **correlational (last):** focus-session bracketing of unattributed trunk
      commits from `sessions(cwd, started_at, ended_at)` — *suggestions only*,
      never auto-claimed;
    - finally subtract every unit whose `unitKey` matches an existing
      `value_claims` row, and dedupe the remainder by `unitKey`.
13. Resolve all per-cwd feeds through `cwd-identity.js`: canonicalize each
    `project_paths.cwd`, fold worktree cwds into their repo root, collapse
    duplicates, and emit `identityWarnings` on the pool response for
    (a) two mapped cwds resolving to the same directory, (b) a project path with
    no git repo, (c) a repo root not mapped to any project. **v1 canonicalizes on
    the read side only — it does not rewrite `project_paths`.** Cross-*project*
    fan-out (`/SARA/DND` under project A, `/SARA/dnd` under project B) cannot be
    fixed from inside one project's assembly and is surfaced as a warning for
    Sara's manual cleanup → **DEC-13 (PENDING)**, **DEC-15 (WATCH)**.
14. `computePlanHealth` + `summarizeDeliveredValue` in the same module; wire
    `GET /pool`, `/health`, `/history`; `ccam ledger pool|health|history`.
15. **§9.7 registration — a build step, not a hope.** In the *same commit* as
    step 12: add `server/lib/value-ledger.js`, `server/lib/cwd-identity.js`,
    `server/lib/plan-lifecycle.js` and `server/routes/project-plans.js` to
    `filesToScan` in `server/__tests__/chronology-ordering.test.js:80-86`
    (currently a hand-typed 5-file list). Then **build the durable cure**:
    derive `filesToScan` from `server/lib/*.js` + `server/routes/*.js` with an
    explicit per-file disposition map (`scanned` | dated-grandfathered-with-reason),
    so adding a 6th lib file **breaks the scan** until someone dispositions it.
    `GRANDFATHERED_QUERIES.length === 2` stays 2 unless a new entry gets the same
    dated review — do not widen it to make a violation go away. Bounded fallback
    if the derived scan uncovers a large pre-existing violation set: register the
    four files, land the derived scan with the pre-existing violators
    dated-dispositioned, and record the remainder → **DEC-9**.
16. Tests: **T3** (`server/__tests__/value-pool.test.js`, real tmp git repos,
    `ISOLATED_GIT_ENV`) + the named dedupe test + **T6**
    (`server/__tests__/ledger-metrics-parity.test.js`).

### Slice 4 — SARA CHECKPOINT (a gate, not a demo)

17. Run QA's live trial (§7 DoD). Sara answers one question on real Coaching
    Assistant data via `ccam ledger` / the API: **"is this pool signal or noise?"**
    **Slice 5 does not start until she has answered.** Auto-pilot cannot waive
    this → **DEC-12 (PENDING)**. Before the trial: back up
    `~/.claude/agent-dashboard/dashboard.db`, and clean up the `DND`/`dnd`
    duplicate project (**DEC-13**) or the checkpoint measures a double-counted
    fleet.

### Slice 5 — UI (only after the gate)

18. `client/src/lib/types.ts` + `api.ts` additions.
19. `client/src/components/PlanLedgerPanel.tsx`; render it from
    `ProjectDetail.tsx`; strings into the existing `projectDetail.json` ×4
    locales. Health numbers render **from the server value** — no client-side
    re-derivation (else a documented-bound header is mandatory, per
    `windowedTotals.ts`'s precedent).
20. Tests: **T7** — `client/src/components/__tests__/PlanLedgerPanel.test.tsx`,
    update `client/src/pages/__tests__/ProjectDetail.test.tsx`, and regenerate
    `screens.snapshot.test.tsx` baselines with a **reviewed** diff
    (`cd client && npx vitest run -u`) — never blind.
21. `npm run test:client`; docs pass; header check.

---

## 5. Single-source-of-truth guardrail (§9.1 — mandatory)

This project's canonical-registry convention for derived values is: **one
server-side computation module, exported vocabularies, consumers named and
tested** (`pace.js`, `DISPOSITIONS`, `decision-queue-enqueue.js` are the existing
instances). §9.1's own history says the failure lands when consumer #2 appears —
here consumers 2–4 (`ccam`, MCP, optional AGENT-PLAN.md export) are announced in
the request itself, and two of them are **net-new surfaces**, i.e. three fresh
opportunities to hand-copy a formula.

Binding rules for this build:

1. `unclaimedPoolSize`, `lastClosureAt` / `daysSinceLastClosure`, the pool itself,
   the generation ordinal, and the whole-life summary are computed **only** in
   `server/lib/value-ledger.js`. No route, no CLI command, no React component may
   recompute or partially recompute any of them.
2. `VALUE_SOURCES` and `ATTRIBUTION_TIERS` are exported from `value-ledger.js` and
   mirror the `CHECK` constraints; routes validate against the exports, never
   against typed string literals.
3. Closure state is **derived by join** (`project_plans.status`) everywhere. No
   column, cache, or response field may carry a per-claim closed flag.
4. `cwd-identity.js` is the only home for cwd canonicalization; no other module
   calls `realpathSync` or `rev-parse --show-toplevel` on a plan/pool path.
5. **T6 `ledger-metrics-parity.test.js` is a named deliverable, not an
   aspiration** — it drives one seeded DB state through the API route **and** the
   `ccam ledger health` command and asserts identical values. QA's note stands:
   this "per-shape, not per-module" spec is the one that never gets written
   because it has no home under the one-spec-per-module convention. It ships in
   slice 3. When MCP tools or the AGENT-PLAN.md export arrive they join this spec
   as consumers #3/#4 — that obligation is tracked as **DEC-16 (WATCH)**.

---

## 6. Testing & verification

**Baseline (verified by QA 2026-08-02):** the nine specs on this surface —
`plan-ingest`, `plans-api`, `plan-writeback`, `detour-disposition`,
`db-migration`, `reconciliation-full-tick`, `chronology-ordering`,
`single-writer-guard`, `pace-tracking` — pass **144/144** together. That is the
regression floor. Under this design **none of them needs a behaviour edit**; if
any goes red, the additive boundary has been violated.

| Spec | Slice | Contents |
|---|---|---|
| **T1** `server/__tests__/db-migration.test.js` *(extend)* | 1 | Legacy-shape seeded DB boots → the three new tables exist, are writable, second boot is a no-op. *(No `UPGRADE_CASES` entry — no new columns on existing tables. No `REBUILD_CASES`, no interruption test — there is no rebuild; QA's T1 rebuild scope is dropped, see §2 overrides.)* |
| **T2** `server/__tests__/plan-lifecycle.test.js` *(new)* | 1 | open→closed state machine; **two plans open concurrently on one project** (DEC-P5); `succeeds_plan_id` chain → derived ordinal; closure stamps `closed_at` + note; negatives: no item edit / no claim / no unclaim / no delete on a closed plan; no reopen; **no API or DB path marks a value unit closed except plan closure** (I1 / DEC-P6) |
| **T4** `server/__tests__/plan-import-inversion.test.js` *(new)* | 1 | I3, restated for the additive design: import writes generation 1 from `plans`/`plan_items`; re-import of the same `content_hash` is a no-op (not a second generation); a full `ingestPlanForCwd` cycle (incl. the `deletePlanItemsNotIn` path at `plan-ingest.js:396`) with DB-authored `project_plan_items` present deletes **zero** of them; a **static scan** proves no write to `project_plan_items` outside `plan-lifecycle.js` / `routes/project-plans.js`, scope derived from the repo's real `server/**/*.js` set, red-proven by injecting a rogue writer. Two case-variant cwds (`.../DND`, `.../dnd`) resolving to one directory import **once** |
| **T5** `server/__tests__/value-ledger.test.js` *(new)* | 2 | Claim persistence + snapshot columns; cardinality per **DEC-7** (many-to-many across items, `UNIQUE` blocks a duplicate claim of the same unit into the same item, `source_cwd` `''`-not-NULL proven to make the index bite); pool shrinks by exactly the claimed units; health metrics; **closure single-writer guard with export-derived scope, red-proven** |
| **T3** `server/__tests__/value-pool.test.js` *(new)* | 3 | Real throwaway git repos (`fs.mkdtempSync` + `ISOLATED_GIT_ENV`, copied verbatim from `intake-scan.test.js`): `Merge effort/<slug>:` → `merge_commit`/`intake_initiative` at tier `mechanical`; a focus-bracketed direct-to-trunk commit → `correlational`; an unbracketed one → unattributed, and **nothing auto-claims from the judgment tier**; ratchet across two runs with history grown in between (I2); **the named dedupe test — a sha present in both the live `detectTrunkDrift` feed and a `detour_dispositions source='trunk_drift'` row yields exactly one pool unit and one health count** (R7); chronology fixture where `id` order and `created_at` order disagree (I7); `identityWarnings` emitted for a case-variant duplicate and for an unmapped worktree |
| **T6** `server/__tests__/ledger-metrics-parity.test.js` *(new)* | 3 | One seeded DB → API `/health` and `ccam ledger health` produce identical values (§5.5) |
| **T7** `client/src/components/__tests__/PlanLedgerPanel.test.tsx` *(new)* + `ProjectDetail.test.tsx` *(update)* + `screens.snapshot.test.tsx` *(reviewed regen)* | 5 | Left pane renders multiple open plans with nested items; right pane renders pool units with tier badges; the claim gesture calls the claim API with `(unit, item)` and the unit disappears on refresh; close calls the close API and the plan moves to history; health values render from the server payload |
| **Chronology scan** `server/__tests__/chronology-ordering.test.js` *(modify)* | 3 | Four new files registered **in the same commit**, then scope derived from `server/lib/*.js` + `server/routes/*.js` with per-file dispositions (§4 step 15) |

**Commands:** `npm run test:server`, `npm run test:client`; single specs via
`node --test server/__tests__/value-ledger.test.js` and
`cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx`.
Snapshot regeneration: `cd client && npx vitest run -u`, diff reviewed.
No MCP change in this effort, so `npm run mcp:typecheck` is unaffected (**DEC-16**).

**§9.3 obligation:** every structural guard above (import-write single home,
closure single composer, derived chronology scope, pool dedupe) ships with a
**recorded red state** — the mutation described in the build notes.
`grep -rn "assert.ok(true" server/__tests__/` and `grep -rn "|| true"
server/__tests__/` stay at 0.

---

## 7. Risks & rollback

**Every scope boundary this plan knowingly declines is backed by a row in this
item's `decisions.md`, appended by this pass. Prose alone is how a
declined-scope item becomes a live incident** — including the ones the Architect
flagged in his §8 "must land as tracked rows, not prose" list, all of which are
carried forward below rather than dropped at synthesis.

| # | Risk | Mitigation | Tracked as |
|---|---|---|---|
| R1 | **Transitional dual plan surface** — legacy cwd `plans` (+ poll + writeback + focus stack) beside `project_plans`; two things called "plan" in one UI | Separate route namespace, separate client types, `imported_*` provenance, distinct WS types; sunset tracked | **DEC-14 (WATCH)** |
| R2 | **CWD-IDENTITY-FANOUT** — case-variant cwds, worktree cwds with no project mapping, stale renamed-dir rows; corrupts the headline "what did this project deliver" answer | `cwd-identity.js` canonicalization at import/pool/claim seams; import keyed on `content_hash`+`project_id`; `identityWarnings` on the pool response; manual `DND`/`dnd` cleanup before the trial. **Cross-project fan-out is NOT fixable from inside one project's assembly** | **DEC-13 (PENDING)**, **DEC-15 (WATCH)** |
| R3 | `deletePlanItemsNotIn` data loss | Structurally impossible (new tables, no mirror-sync, no analogue may be added); T4 pins it; "reuse `plan_items`" is a blocking review objection | in plan §2/§4.4 + T4 |
| R4 | **§9.7 blind scan** — new lib files outside `filesToScan`, so §9.2 obligations are unenforced *while green* | Registration in the same commit + derived-scope cure, with a bounded fallback | **DEC-9** |
| R5 | **§9.1 across 3–4 announced consumers**, two net-new | One module; T6 parity spec day one | **DEC-5**, **DEC-16** |
| R6 | **Sequencing collision** — 3 concurrent efforts in `server/lib/`; project memory records real work loss | Trunk-drift Phase 1a merges first; `git worktree list` + running-session check before any git op | **DEC-2 (DEPENDENCY)** |
| R7 | **Double-counted trunk commits** when Phase 1b lands | `('trunk_commit', sha)` identity deduped at assembly + named test | **DEC-4** |
| R8 | **UI blast radius** (`18196dc`) | Gate before the surface; component-in-Project-Detail, no route/nav/locale namespace | **DEC-8**, **DEC-12** |
| R9 | **Pool floods on run #1** and reads as noise exactly when Sara judges signal-vs-noise | Bounded default lookback + explicit `?backfill=1`; no persisted baseline table in v1 | **DEC-6** |
| R10 | `DEC-7 (2026-08-01-build-project-manager)` still open with a 1-of-2 unattended-write failure | Do **not** serialize this effort behind it; run the trial during slice 1; `claimed_by='llm'` claims stay closed until it clears | **DEC-11 (PENDING)** |
| R11 | Closed-generation / claim permanence eroded by a later "cleanup" convenience | No delete path exists for closed plans or their claims — enforced in routes, asserted by T2/T5 negatives | plan §4.9 + T2 |
| R12 | Concurrent-plan fallout on focus/pace/detours (`ccam focus set <n>` assumes one plan per cwd) | Legacy layer untouched; pace stays per-cwd; `target_date` present but unused in v1 | **DEC-18 (WATCH)** |
| R13 | Unmapped cwds (exactly the effort worktrees) have no pool home | Worktree→repo-root folding shrinks the gap; residue surfaced as `identityWarnings` and documented as accepted | **DEC-17 (WATCH)** |
| R14 | `plan-writeback.js` / `reconciliation.js` re-pointing left undone; DEC-2+DEC-13 supersession left implicit in the prior effort's log | No change and **no new call sites** in this effort; supersession amendment owed in both logs | **DEC-10 (PENDING)** |

**Rollback.** Per slice, and cheap by construction:

- *Slices 1–3 (server):* revert the commits. The three tables are additive and
  orphaned — `CREATE TABLE IF NOT EXISTS` leaves them present but unreferenced on
  an already-migrated DB, and **no existing table, column, route response shape
  or WS message type was changed**, so a reverted server boots clean against a
  forward DB. If the tables must actually go, `DROP TABLE value_claims;
  DROP TABLE project_plan_items; DROP TABLE project_plans;` is safe **only** if
  Sara accepts losing claims — never run it as routine cleanup (R11).
- *Slice 5 (UI):* delete `PlanLedgerPanel.tsx`, remove its render slot and the
  `projectDetail.json` keys, regenerate snapshots. No route, nav entry or locale
  namespace to unwind — that is precisely the cost `18196dc` paid and this
  slicing avoids.
- *The gate itself is the rollback for the concept:* if Sara answers "noise" at
  slice 4, slices 1–3 remain useful (import + closable plans + a ledger) and the
  workbench is never built.

---

## 8. Definition of Done

**Engineering**

- [ ] Slice 0 satisfied: trunk-drift Phase 1a on `master`; no hand-rolled trunk walker anywhere in this change set (**DEC-2**).
- [ ] Three tables land via `CREATE TABLE IF NOT EXISTS` with the **full** `value_source` / `attribution` / `status` vocabularies in the initial DDL; **zero `ALTER TABLE`, zero rebuilds** in the diff.
- [ ] No `closed_at`/closed flag on `value_claims`; closure is derived by join everywhere (grep-proven).
- [ ] `plan-ingest.js`, `plan-writeback.js`, `reconciliation.js`, `pace.js`, `routes/plans.js` **unmodified**; `/api/plans` response shapes and the `plan_updated` WS payload unchanged; new WS types additive.
- [ ] One shared module `server/lib/value-ledger.js` owns every derived value; `cwd-identity.js` is the only canonicalizer.
- [ ] `/api/project-plans` + `ccam ledger` shipped; `docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`, `README.md`, `server/README.md` updated in the same change-set.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.

**Tests**

- [ ] `npm run test:server` and `npm run test:client` green; the 144-case baseline green with **no behaviour edits** (any edit named and justified).
- [ ] T1–T7 exist and pass; every structural guard has a **recorded red state** in the build notes (§9.3); `assert.ok(true` / `|| true` sweeps at 0.
- [ ] The four new server files are in `chronology-ordering.test.js`'s scan **and** the scan's scope is derived, not hand-typed (or **DEC-9**'s bounded fallback is recorded); `GRANDFATHERED_QUERIES.length` still 2.
- [ ] The `('trunk_commit', sha)` cross-feed dedupe test exists and is red-proven.
- [ ] T6 parity (API vs `ccam`) passes; snapshot baselines reviewed, not blind-regenerated.

**Process / disclosure**

- [ ] Every review-round finding ended as *fixed-with-a-test* or *recorded-in-`decisions.md`-with-an-id* (§9.4 — no silent remainder), including the fix round's own adversarial pass.
- [ ] DEC-2 … DEC-18 present in this item's `decisions.md`; each PENDING row has a recommendation recorded (auto-pilot).
- [ ] The DEC-P2 → DEC-2/DEC-13 supersession is written into **both** decision logs (**DEC-10**).

**Sara's live trial — this box, not the suite, is sign-off (QA §6)**

- [ ] `~/.claude/agent-dashboard/dashboard.db` **backed up** before anything runs.
- [ ] Migrated dashboard boots; focus, pace, detours, Project Detail and the decision queue look unchanged.
- [ ] Coaching Assistant: real `AGENT-PLAN.md` imported as **generation 1**, exactly once; pool shows its trunk commits and ~30 initiatives with believable tiers; `identityWarnings` reviewed.
- [ ] A handful of units claimed (≥1 mechanical, ≥1 correlational); a **retroactive detour-bundle plan** created and **closed**; stamp + history entry present; pool shrank by exactly the claimed units.
- [ ] "What value did this project deliver" answered from closed generations + claims alone — no archaeology (AC-6).
- [ ] Server restarted: claims and the closed generation survived; nothing re-imported or re-computed (I2/I3 in the wild).
- [ ] Sara has answered the gate question — **"is this pool signal or noise?"** — before slice 5 starts (**DEC-12**).
