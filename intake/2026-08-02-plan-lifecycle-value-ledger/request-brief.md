# Request Brief — Plan lifecycle + value ledger ("plans as closable value-buckets")

**Intake item:** `intake/2026-08-02-plan-lifecycle-value-ledger/`
**Prepared:** 2026-08-02 (intake clerk, auto-pilot run)
**Source:** `request.md` in this folder — a transcription of an in-session
design conversation with Sara whose rulings are settled and recorded in
session memory (`project_holistic-focus-history.md`) and in this item's
`decisions.md` (DEC-P1..DEC-P6).

---

## Summary

Add a **plan lifecycle + value ledger** to the dashboard: plans become
closable "value-buckets" with generations (open → closed, retained forever),
multiple plans may be open per project concurrently, and a **two-pane
reconciliation workbench** lets Sara pull delivered-but-unclaimed value
(trunk commits, intake initiatives, focus/detour records) from an empirical
right-pane pool into left-pane plan items — with claims persisted as a
ledger, and plan closure as the **only** way value reaches "closed."

## Raw ask (verbatim core)

> "Backward: work happened fast → grab the delivered-but-unclaimed value,
> bundle it into a plan, annotate it with data (what got delivered, when),
> and declare the plan CLOSED. The next plan generation opens and new work
> accrues there."
>
> "THE INVARIANT: the plan is the only door value exits through. Nothing
> reaches 'closed' except by being bundled into a project plan and closing
> that plan. Even a pure bundle-of-detours gets a plan (possibly created
> retroactively just to BE that bundle) and closes through it."
>
> Acceptance framing: "Ask 'what value did this project deliver' and get the
> answer from closed generations + claims, not archaeology." / "'Did we clear
> our milestone or are we just having fun?' becomes measurable."

## Restated ask

Make the project plan the declaration-and-closure layer of the monitoring
stack: DB-backed plans with open/closed generations, an automatically
assembled pool of unclaimed delivered value, a two-pane workbench UI to claim
pool items into plans and close plans, and a persistent claims ledger with
health metrics (pool size, time since last closure).

## Requester / source

- **Requester:** Sara, verbally, in-session (design conversation, 2026-08-02).
- **Channel:** transcribed into `request.md` by the invoking conversation;
  rulings also persisted in session memory `project_holistic-focus-history.md`.
- **Origin context:** reconciling the Coaching Assistant project's 30 intake
  initiatives against its trunk — "which worktree/commits produced them, and
  how do we ever declare value CLOSED?"

## The problem

Delivered effort (trunk commits, merged initiatives, detours) accumulates
faster than any forward plan and is never correlated into a communicable,
closable outcome. Focus answers "what happened" empirically; intake organizes
work-in-motion; **nothing closes value out** — answering "did we clear our
milestone?" requires archaeology.

## Surface / area touched

- `server/db.js` schema: `plans` / `plan_items` (lifecycle columns,
  generations, breaking the one-plan-per-cwd assumption), plus new
  ledger/claims and pool-related tables.
- `server/lib/`: `plan-ingest.js` (becomes the import path),
  `plan-writeback.js` (future in question — see open questions),
  `detours.js`, `reconciliation.js`, `intake-scan.js`, `repo-topology.js`,
  focus tracking (`focus-report.js` et al.) as pool inputs.
- New/changed API routes + WebSocket surface for plans, pool, claims.
- Client: new two-pane reconciliation workbench UI; closed-plan history
  browsing; health metrics display.
- Read surfaces: `ccam` CLI, MCP, optionally a generated read-only
  AGENT-PLAN.md export (per ruling DEC-P2).

## Known-variant relevance (recurring defect-class check — mandatory)

This request **does** touch catalogued surfaces in `PROJECT-CONTEXT.md`:

- **§9.1 DERIVED-DUAL-VIEW — directly implicated.** Ruling DEC-P2 by design
  creates multiple read surfaces of the same plan state (workbench UI, `ccam`,
  MCP, optional exported AGENT-PLAN.md view), and the health metrics
  (pool size, time-since-closure) are derived values that will grow multiple
  consumers. §9.1's own history says the failure lands when consumer #2
  appears — every derived value here must be a single shared computation from
  day one, with cross-consumer tests.
- **§9.2 row-id-as-chronology-proxy.** Pool assembly brackets
  direct-to-trunk commits with focus session timestamps and walks
  `events`/focus tables chronologically — every such query must
  `ORDER BY created_at, id` before any `LIMIT` (use
  `assertOrderedByCreatedAt` + the static scan's registry).
- **§9.5 / §9.6 schema-migration entries.** Breaking one-plan-per-cwd and
  adding lifecycle/ledger tables means `CREATE TABLE` changes and possibly
  table rebuilds on the shared user-global DB. Guarded `ALTER TABLE` +
  `UPGRADE_CASES` legacy-shape tests are mandatory; any rebuild must be
  atomic (copy the `agents` site, currently `server/db.js:1560-1600` — verify
  by grep, not line number) and should use/land the recommended
  `rebuildTableAtomically` helper rather than a fourth hand-roll.
- **§9.3 / §9.7.** Any structural guards written for the above must be
  red-proven by mutation and scope-derived from the real surface, not
  hand-typed.

## Provisional request type

**PROVISIONAL: `new-feature`** (portfolio-layer capability; the design brief
for the deliberately-unscheduled WATCH-2 thread from
`intake/2026-08-01-build-project-manager/decisions.md`). Final call is the
Project Manager's.

## The requested capability, in parts

### A. Plan lifecycle
- Plans have generations: **open → closed**; closed generations retained
  forever (never deleted), stamped with a closure date and closure
  annotations ("this is what got delivered").
- Closing is a deliberate, plan-level action.
- Multiple plans may be open on one project simultaneously (breaks the
  current one-plan-per-cwd assumption in `plans`/`plan_items`).
- Whole-life history question spans closed generations.

### B. Unclaimed value pool (empirical right side)
Assembled from what the dashboard already sees or can cheaply gather:
- **Trunk commits** — `Merge effort/<slug>:` merge commits (mechanically
  attributable to intake initiatives) + direct-to-trunk commits (detour
  candidates).
- **Intake initiatives** and their stages (already scanned live).
- **Focus records / detours** (`focus segments`, `detour_dispositions`) —
  session timestamps+cwd bracket direct-to-trunk commits into *suggested*
  attributions.
- Attribution confidence tiers: **mechanical** (slug match) →
  **correlational** (focus bracketing) → **judgment** (human or
  LLM-proposed, human-gated).

### C. Two-pane reconciliation workbench (UI)
- **Left pane:** this project's open plans (plural), editable in place —
  add first-level items, nest sub-items (`parent_item_id` nesting already in
  schema). Close-plan action lives here.
- **Right pane:** the unclaimed value pool.
- **Core gesture:** pull right → left, claiming value into a plan (attach to
  an existing item or create an item from it).
- Closed plans leave the left pane; browsable as history.

### D. Ledger (persistence)
- Claims (value-unit → plan item) are judgments: **persisted once made,
  never recomputed**. Each reconciliation run deals only with value since the
  last run (**ratchet**).
- Health metrics: unclaimed-pool size + time since last closure.

## Pre-settled rulings (constraints — do NOT re-litigate)

Recorded in this item's `decisions.md` as DEC-P1..P6; full wording in
`request.md` §"Confirmed rulings":

1. **DEC-P1 — DB-first.** Plans, generations, and the value ledger live in
   this app's SQLite DB (like `decision_queue`); the file-first model already
   showed friction (plan-writeback sanitizer + optimistic lock; re-ingest
   deletes DB-only items).
2. **DEC-P2 — AGENT-PLAN.md inverts to import source.** Existing plans
   import as generation 1; DB leads thereafter. Agent visibility via read
   surfaces (`ccam`, MCP, optionally a generated read-only export) — the
   file is a VIEW, never the master.
3. **DEC-P3 — File-based per-solution artifact layer is NOT demoted.**
   DB-first applies only to the portfolio layer; each layer's state lives in
   its native material.
4. **DEC-P4 — Altitude.** The dashboard DB manages exactly three things:
   delivered value, desired value, and their reconciliation. Repo-local
   pipeline detail is never pulled up. (`decision_queue` stays — value-level
   escalations only.)
5. **DEC-P5 — Multiple concurrent plans per project.**
6. **DEC-P6 — Closure invariant.** Value closes only through a plan; even a
   pure detour-bundle gets a (possibly retroactive) plan and closes through it.

## Existing machinery to build on

From the `2026-08-01-build-project-manager` effort:
- `plans` / `plan_items` (+ `parent_item_id` nesting, `target_date`,
  `server/lib/pace.js`).
- `detour_dispositions` + `server/lib/detours.js` +
  `server/lib/plan-writeback.js` (item-level bundling exists; DEC-P2 inverts
  its relationship — write-back path's future needs deciding).
- `decision_queue` + `server/lib/reconciliation.js` (escalation rules +
  batched LLM detour classification).
- Focus tracking (focus segments, focus-report, swimlane calendar, LLM
  window summaries).
- `server/lib/intake-scan.js` (depth-3 recursive) + `server/lib/repo-topology.js`.
- `server/lib/plan-ingest.js` — becomes the import path.
- WATCH-2 (that effort's decisions.md) named plan lifecycle as deliberately
  unscheduled; this request is that thread.

## Cautions / sequencing constraints

- **`wip-queue-page` precedent (2026-07-30):** the repo's first
  portfolio-altitude UI was built and fully reverted in two days. Sequence
  and checkpoint with Sara; do not build the whole surface in one shot.
- **Layer 7 (portfolio rollup UI) is deferred (WATCH-3)** — adjacent but NOT
  this request; keep scopes distinct.
- **`deletePlanItemsNotIn` on re-ingest deletes DB-only items** — the import
  inversion must not lose data.
- **Migration-safe schema changes only** (project rule; see §9.5/§9.6 above).
- **DEC-7's live-trial gate is still open** (Sara hasn't reviewed real
  decision-queue output) — relevant to sequencing.

## Explicit acceptance signals (Sara's "done" sketch)

1. Open a project in the dashboard → open plan(s) on the left, unclaimed
   pool on the right.
2. Pull delivered value into a plan; edit plan items/sub-items in place.
3. Close a plan → stamped, retained as history, claimed value "closed," pool
   shrinks correspondingly.
4. "What value did this project deliver" is answerable from closed
   generations + claims — no archaeology.

## Ambiguities

### BLOCKING
None. The problem, scope, constraints, existing machinery, and an acceptance
sketch are all stated; the previously contentious architectural questions are
pre-settled (DEC-P1..P6). The request is evaluable as written.

### Non-blocking — open design questions for the evaluation phase
1. **Fate of `plan-writeback.js`** after the DEC-P2 inversion — the request
   itself flags "this write-back path's future needs deciding" (retire,
   repurpose as the read-only export generator, or keep for a transition?).
2. **Ratchet baseline / backfill scope:** on first run, does the pool include
   full historical trunk commits per project, or start from a chosen
   baseline? (The ratchet defines "since last run" but not run #1.)
3. **Claim cardinality:** claims are stated as value-unit → plan item;
   whether one value unit may be claimed into multiple items (the request
   mentions "many-to-many claims" in ruling 1's rationale) needs pinning in
   the schema design.
4. **UI placement:** new page vs. extension of the existing Project Detail
   page.
5. **First-slice sequencing:** given the wip-queue-page revert precedent and
   the open DEC-7 live-trial gate, which increment ships first and where the
   checkpoint with Sara lands.
6. **Read-only AGENT-PLAN.md export:** explicitly optional in DEC-P2 —
   in-scope now or deferred (and if built, it is a §9.1 consumer).
