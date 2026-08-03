# Architect Assessment — Plan lifecycle + value ledger

**Intake:** `intake/2026-08-02-plan-lifecycle-value-ledger/`
**Role:** intake-architect (auto-pilot). Read-only investigation of the live code,
2026-08-02. Constraints DEC-P1..P6 treated as settled; recommendations below
marked **[AUTO-REC]** where a preference call was made rather than escalated.

---

## 1. Affected subsystems & boundaries

| Concern | Owner today | Verdict for this build |
|---|---|---|
| Plan storage/identity | `server/db.js` — `plans` (PK `cwd`), `plan_items` (PK `(cwd, item_id)`, FK cascade on `plans(cwd)`) | **Inverted, not rebuilt** — see §3 Option A3 |
| Plan file mirror | `server/lib/plan-ingest.js` (poll + SessionStart, `deletePlanItemsNotIn` mirror-sync) | Load-bearing for legacy cwds during transition; becomes the one-shot **import parser** for the new layer |
| Plan file writes | `server/lib/plan-writeback.js` (sole audited AGENT-PLAN.md mutator, DEC-14) | **Future in question** (request's own flag). Recommendation: retire post-transition; do NOT repurpose as export generator. Needs a `decisions.md` PENDING row |
| Detour decisions | `detour_dispositions` + `server/lib/detours.js` | Load-bearing, unchanged — becomes a primary **pool feed** |
| Escalation | `decision_queue` + `server/lib/reconciliation.js` | Load-bearing, unchanged in slice 1; its fold_in/new_item write target eventually re-points from file to DB items (gated, see §6) |
| Pace | `server/lib/pace.js` (pure, single computation) | Load-bearing, reused as-is against new item rows (same field shapes) |
| Trunk commits | **In-flight sibling intake** `2026-08-02-trunk-drift-detection`: `server/lib/git-refs.js` + `server/lib/trunk-drift.js`, one `detour_dispositions` row per direct-to-trunk commit (`source='trunk_drift'`, `source_ref=<sha>`, UNIQUE `(cwd,source,source_ref)`) | **Hard sequencing dependency** — the pool's "direct-to-trunk commits" feed IS this. Do not build a second trunk walker |
| Merge-commit attribution | `server/lib/intake-scan.js` `fetchMergedEffortSlugs` (one `git log --grep='^Merge effort/'` per cwd, live, never persisted) | Load-bearing, reused as the **mechanical-tier** pool feed |
| Project aggregation | `project_paths` join (`routes/projects.js`, `repo-topology.js`) | Load-bearing — the new plan tables key off `project_id`, aggregating cwds exactly the way sessions/plans/intake already do |
| Read surfaces | `routes/plans.js`, `ccam`, MCP, client Project Detail page | New routes added; legacy `/api/plans` response shapes preserved (backend rule) |

## 2. Current design (and where it does / doesn't follow the project's own patterns)

- **One plan per cwd is structural, not incidental.** `plans.cwd` is the PRIMARY
  KEY; `plan_items` FKs on it with CASCADE; `idx_plan_items_cwd_number` gives
  per-cwd number uniqueness; `session_focus.item_number` + the two-phase
  number-vacate/reorder machinery in `plan-ingest.js` all assume "the plan for
  this cwd." `reconciliation.js`'s `listReconcileTargets` iterates `plans` rows
  directly. Nothing stores a plan id because the cwd *is* the id.
- **The file is master; the DB is a mirror.** `ingestPlanForCwd` re-ingests on
  hash change and `deletePlanItemsNotIn` deletes any DB row not present in the
  file — the exact data-loss trap the brief names for the inversion. Out-of-band
  columns (`declared_done_at`, `target_date`) survive only because the upsert's
  SET list deliberately excludes them.
- **The write path is heavy because the file is human-owned.** ~680 lines of
  sanitizer + optimistic content-hash lock + backup + EOL preservation +
  single-writer guard exist solely to mutate a human's markdown safely. Under
  DEC-P1/P2 (DB leads), that entire problem class disappears for the new layer —
  a DB write inside a transaction needs none of it.
- **Defect-catalog fit:** the codebase already practices §9.1's cure on this
  surface (`pace.js` single computation, `DISPOSITIONS` single vocabulary,
  `decision-queue-enqueue.js` shared enqueue). The new layer must arrive with the
  same shape: one server-side module per derived value, consumed by UI + `ccam` +
  MCP + any export. The live-computed precedent (`repo-topology.js`,
  `intake-scan.js` headers both say "computed live, nothing persisted") is the
  established pattern for cheap git/filesystem derivations; the persisted-decision
  precedent (`detour_dispositions`, `decision_queue`) is the established pattern
  for judgments. The pool/claims split in §4 follows exactly that seam.

## 3. Part A — plan lifecycle: keying, generations, and the two inversions

### Options

**A1 — Rebuild `plans`/`plan_items` in place** (new `plan_id` key, migrate
cwd-keyed rows to generation 1).
- Pros: one plan surface, no transitional dual-view.
- Cons: touches the two highest-fan-out tables in the focus stack
  (`session_focus`, `focus_inferences`, `detour_dispositions.item_id`,
  focus-inference matching, `ccam focus`, drift auditor, reconciliation R1, the
  client plan panel) in one shot; two table rebuilds on the shared user-global DB
  (§9.5/§9.6 — the file's own precedent is 5-of-6 rebuilds done wrong); and it
  couples the portfolio feature's ship date to re-pointing every repo-level focus
  consumer. This is the `wip-queue-page` failure mode: one giant bet.

**A2 — Overload the existing tables** (add nullable `plan_id`/`status`/
`generation` columns; cwd-keyed rows become "generation 0").
- Pros: no new tables.
- Cons: one table then serves two masters with two identity schemes; every
  existing query needs a `WHERE` guard to keep mirror-sync (`deletePlanItemsNotIn`)
  away from DB-first rows — a standing footgun where one missed guard silently
  deletes ledger items. Violates the spirit of DEC-P4's clean altitude split.

**A3 — New portfolio-layer tables; legacy tables untouched** *(recommended)*.
- `project_plans`: `id` (INTEGER PK), `project_id` (soft ref, **no CASCADE** —
  closed generations are retained forever, same audit-outlives-source rule as
  `detour_dispositions.session_id`), `title`, `status CHECK('open','closed')`,
  `succeeds_plan_id` (nullable self-ref → generation chains; generation ordinal
  is *derived* by walking the chain, not stored — nothing to drift),
  `opened_at`, `closed_at`, `closure_note`, `imported_from_cwd`,
  `imported_content_hash` (provenance of a DEC-P2 import).
- `project_plan_items`: `id`, `plan_id`, `parent_item_id`, `text`, `acceptance`,
  `detail`, `done_at`, `position`, `target_date` (same shape `pace.js` already
  reads), `imported_item_id` (provenance link back to the legacy
  `(cwd, item_id)` row so focus history remains traceable).
- Pros: **purely additive schema** — zero `ALTER`, zero rebuilds, so §9.5/§9.6
  are avoided entirely rather than mitigated (fresh-`CREATE TABLE IF NOT EXISTS`
  is upgrade-safe for brand-new tables). Multiple open plans per project
  (DEC-P5) is trivial. Closure/retention semantics live where they belong.
  The focus stack keeps working untouched in slice 1.
- Cons: a **deliberate transitional dual plan surface** (legacy cwd-plans still
  polled/rendered; new project-plans in the workbench). This is §9.1-shaped and
  must be tracked, not just disclosed — see §5 risk 1.

### The two inversions

**plan-ingest as import-only (DEC-P2).** `parsePlanMarkdown` /
`attachDisplayNumbers` are pure and reusable as-is. Add an explicit
`POST /api/project-plans/import {cwd, project_id}` that parses the file once and
creates a generation-1 `project_plans` row + items. Critically: the import path
**never** runs `deletePlanItemsNotIn` semantics against the new tables — there
is no mirror-sync in the DB-first world, so the brief's data-loss caution is
satisfied structurally (the delete statement simply has no analogue), not by a
guard. The continuous poll keeps servicing legacy cwds only; an imported cwd's
legacy plan row can be left in place (focus history points at it) with the new
layer marked as leading.

**plan-writeback under the inversion.** Three options: retire / repurpose as
the read-only export generator / keep for transition. **[AUTO-REC]** Keep it
load-bearing for *not-yet-imported* cwds (reconciliation's DEC-13 auto-write
continues unchanged there); for imported plans, fold_in/new_item verdicts write
`project_plan_items` rows directly in a transaction — retaining
`sanitizeLlmPlanText` on any LLM-authored text (the trust boundary is LLM→Sara's
plan, not LLM→file; the sanitizer survives even though the splice machinery
doesn't). Do **not** repurpose the module as the export generator: its whole
competence is surgical in-place mutation of a human-owned file (block-splicing,
optimistic lock, EOL preservation) — a generated read-only view is full-file
composition from DB state, ~50 lines of new code with a "GENERATED — do not
edit" banner, and dragging 680 lines of splice machinery into that role keeps
alive exactly the complexity DEC-P1 exists to shed. End state: retire. This is
the request's own named open question → needs a **PENDING row in decisions.md**.

## 4. Part B — the unclaimed value pool

### The one big reuse finding

The pool's hardest feed — **direct-to-trunk commits** — is already being built
by the in-flight `2026-08-02-trunk-drift-detection` intake: `git-refs.js`
(canonical "which ref is trunk") + `trunk-drift.js` (one row per unattributed
trunk commit into `detour_dispositions`, `source='trunk_drift'`,
`source_ref=<sha>`, deduped by the existing UNIQUE index, capped at 200/request).
That is precisely "trunk commits, persisted-on-sight, idempotent, with a natural
ratchet" (the existing `source_ref` set is the baseline). **This request must
sequence after trunk-drift lands and consume its rows** — building a second
trunk walker would duplicate a git surface that intake explicitly consolidated
into one home, and would be this project's §9.1 shape reintroduced at module
scale. The `Merge effort/<slug>` mechanical feed likewise already exists
(`intake-scan.fetchMergedEffortSlugs`), live-computed.

### Live-computed vs persisted

- **B1 — fully persisted pool table** (`value_units`, gathering pass, claims FK
  to it): stable ids and cheap metrics, but it re-persists what `intake-scan`
  deliberately computes live, creating a second copy of initiative state that
  drifts from disk — and it pulls pipeline-adjacent detail toward the DB,
  brushing against DEC-P4.
- **B2 — fully live-computed pool** (recompute everything per request, subtract
  claims): matches the repo-topology precedent but makes every workbench load
  pay git-walk costs, and gives claims nothing stable to reference.
- **B3 — hybrid** *(recommended)*: **the pool is a derived view; the claim is the
  only persisted judgment.** Pool assembly = (a) unclaimed, non-discarded
  `detour_dispositions` rows (covers trunk_drift + declared + inferred detours —
  all already persisted-on-sight), + (b) live `intake-scan` results (initiatives
  + merged slugs), + (c) focus segments for correlational bracketing — minus
  anything matching an existing claim's `(value_source, value_ref, source_cwd)`.
  This follows the codebase's own seam exactly: observations live/derived,
  judgments persisted.

DEC-P4 compliance: a claim stores a **reference + snapshot** (slug, sha, label,
seen_at, stage-at-claim), never artifact content. The dashboard remains a map.

### Attribution tiers & ratchet

Tiers are properties of a *suggestion* at assembly time (mechanical = slug/merge
match; correlational = focus-session cwd+timestamp brackets a commit; judgment =
human/LLM proposal, human-gated) and are **frozen onto the claim** when made.
One exported vocabulary (`ATTRIBUTION_TIERS`), CHECK-mirrored, same pattern as
`DISPOSITIONS`. §9.2 applies to the bracketing queries (they walk `events`/focus
tables): `ORDER BY created_at, id` before any `LIMIT`, registered in the
chronology scan's registry — and the scan's scope derived per §9.7, not
hand-typed.

**Ratchet run #1 baseline:** **[AUTO-REC]** start from a bounded default (what
trunk-drift's 200-commit cap and the intake scan already see), with an optional
per-project `pool_baseline` date Sara can push back for a deep backfill — do not
flood pool #1 with full multi-year history. Open question in the brief →
**PENDING row**.

## 5. Part D — claims ledger schema

```sql
value_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,                         -- soft ref, audit outlives
  plan_id INTEGER NOT NULL,                -- -> project_plans
  item_id INTEGER NOT NULL,                -- -> project_plan_items
  value_source TEXT NOT NULL CHECK(value_source IN
    ('trunk_commit','merge_commit','intake_initiative','detour','focus_segment')),
  value_ref TEXT NOT NULL,                 -- sha | slug | disposition id | segment key
  source_cwd TEXT,
  label_snapshot TEXT, seen_at_snapshot TEXT, stage_snapshot TEXT,
  attribution TEXT NOT NULL CHECK(attribution IN
    ('mechanical','correlational','judgment')),
  claimed_by TEXT CHECK(claimed_by IN ('human','llm')),
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_value_claims_unit_item
  ON value_claims(value_source, value_ref, source_cwd, item_id);
```

Design points:

- **Ratchet semantics fall out of persistence:** a claim, once written, removes
  its unit from every future pool assembly by key-match. No recompute, no run
  table in slice 1.
- **Closure stamping: derive, don't copy.** A claim's closed-ness is
  `project_plans.status`/`closed_at` via join — **no** `closed_at` column on
  claims. Copying the stamp onto N claim rows at close time creates two places
  that can disagree (§9.1, write-sequence form — the exact shape the 2026-08-01
  build got burned by). Closing a plan is then a single-row UPDATE + broadcast.
- **Closure invariant (DEC-P6)** is enforced by API shape: there is no endpoint
  that marks a value unit closed; the only closing verb is plan-level. A
  retroactive detour-bundle is just `POST /project-plans` + N claims + close.
- **Claim cardinality:** **[AUTO-REC]** many-to-many allowed (one unit into
  multiple items — a merge commit can deliver two plan items), guarded by the
  UNIQUE above against duplicate claims of the same unit into the same item; the
  pool treats a unit as claimed when ≥1 claim exists. Open question in the brief
  → **PENDING row**.
- **Health metrics** (pool size, time-since-last-closure): one function in one
  new module (working name `server/lib/value-ledger.js`) that also owns pool
  assembly; routes, `ccam`, MCP, and any export all call it. §9.1's pre-flag
  history says the failure lands when consumer #2 appears — here consumers 2–4
  (`ccam`, MCP, export) are *announced in the request*, so the shared-computation
  + cross-consumer-test requirement is day-one, not deferred.

## 6. Architectural risks

1. **Transitional dual plan surface (the top risk).** Legacy cwd-keyed
   `plans`/`plan_items` (+ poll + writeback + focus stack) and new
   `project_plans` coexist. Two things both named "plan" rendering in one UI is
   chronic-drift territory. Mitigations: distinct route namespace
   (`/api/project-plans`, never blended into `/api/plans` responses), distinct
   client types, `imported_*` provenance columns, and a **tracked sunset**: this
   must be a WATCH row in this item's `decisions.md`, not prose here.
2. **Sequencing collision with trunk-drift.** If this build starts before
   trunk-drift merges, the pool has no trunk feed and the temptation is to
   hand-roll one. Record as an explicit dependency (and if trunk-drift's phase 2
   lands `rebuildTableAtomically`/`db-rebuild.js`, this build inherits it should
   any later phase need a rebuild).
3. **Reconciliation's write target after import.** Slice 1 leaves
   `reconciliation.js`/`plan-writeback.js` file-targeted for unimported cwds;
   for imported cwds the fold_in/new_item target must re-point to DB items —
   and whether an LLM verdict may also mint a *claim* (`claimed_by='llm'`)
   should stay **closed until DEC-7's live-trial gate clears** (Sara hasn't
   reviewed real decision-queue output yet). PENDING row.
4. **Invariants to hold:** closed generations immutable (no UPDATE path on a
   closed plan's items — enforce in routes, assert in tests); claims append-only
   (an unclaim, if ever wanted, is a new decision, DELETE only via explicit
   route with audit); `project_plans` rows never CASCADE-deleted by project
   deletion; every pool query over `events`/focus is chronology-registered
   (§9.2); every structural guard red-proven (§9.3) with derived scope (§9.7).
5. **Unmapped-cwd value is invisible.** The pool aggregates via `project_paths`,
   so value in a cwd not mapped to any project has no pool home — consistent
   with how sessions/plans/intake already behave, but worth stating: this is
   accepted, not accidental.
6. **UI blast radius (`wip-queue-page` precedent).** **[AUTO-REC]** slice 1 =
   schema + import + pool/claims API + `value-ledger.js` + a minimal claim flow
   **embedded in the existing Project Detail page** (it already fetches
   topology + intake per project); the full two-pane workbench is slice 2 after
   a checkpoint with Sara. Read-only AGENT-PLAN.md export: **defer** (explicitly
   optional in DEC-P2, and it is a §9.1 consumer the moment it exists).

## 7. Recommended approach (summary)

Additive DB-first portfolio layer (Option A3): new `project_plans` /
`project_plan_items` / `value_claims` tables keyed by `project_id` with
generation chains via `succeeds_plan_id`; `plan-ingest.js`'s pure parser reused
for one-shot DEC-P2 imports with no mirror-sync analogue; the pool as a derived
view assembled by one shared module from persisted judgments
(`detour_dispositions`, incl. trunk-drift's rows — hard dependency) plus live
scans (`intake-scan`), with claims as the only persisted, snapshot-carrying,
never-recomputed artifact; closure derived from the plan row, never copied onto
claims; `plan-writeback.js` kept for the transition and retired rather than
repurposed. Zero rebuilds of existing tables — §9.5/§9.6 avoided by
construction. Sequence: trunk-drift first, then schema+API+minimal claim flow,
checkpoint, then the workbench.

## 8. Items that must land as tracked rows, not prose

Per this assessment, the following need `decisions.md` PENDING/WATCH entries in
this intake item (a disclosed-but-untracked exclusion equals an undiscovered
one):

- **WATCH:** dual plan surface (legacy cwd plans vs `project_plans`) — sunset
  plan and drift guard.
- **PENDING:** fate of `plan-writeback.js` (rec: transition-keep, then retire;
  export generator is new code if ever built).
- **PENDING:** ratchet run-#1 baseline (rec: bounded default + per-project
  `pool_baseline` override).
- **PENDING:** claim cardinality (rec: many-to-many with per-(unit,item) UNIQUE).
- **PENDING:** LLM-minted claims / reconciliation re-pointing — blocked on
  DEC-7's open live-trial gate.
- **DEPENDENCY:** `2026-08-02-trunk-drift-detection` must merge first (pool's
  trunk feed + `git-refs.js` home).
- **DEFERRED:** read-only AGENT-PLAN.md export (a §9.1 consumer by definition);
  separate-page workbench until the Project-Detail-embedded slice survives
  contact with Sara.
