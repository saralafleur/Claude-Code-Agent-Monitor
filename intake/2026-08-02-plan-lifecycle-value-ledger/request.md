# Request: Plan lifecycle + value ledger ("plans as closable value-buckets")

**Date:** 2026-08-02
**Requested by:** Sara (verbally, in-session; this document is the transcription
of a design conversation whose rulings are also recorded in the session memory
`project_holistic-focus-history.md`)
**Source conversation context:** grew out of reconciling the Coaching Assistant
project's 30 intake initiatives against its trunk — "we have initiatives, but
which worktree/commits produced them, and how do we ever declare value CLOSED?"

## The problem

Work on Sara's projects moves fast — often faster than any forward plan.
Delivered effort (trunk commits, merged initiatives, detours) accumulates
without ever being correlated into a structured, communicable outcome. The
focus system answers "what activities occurred" empirically; the intake
pipeline organizes work-in-motion; but nothing ever *closes* value out. The
result: it's impossible to answer "did we clear our milestone, or are we just
having fun?" without archaeology.

## The vision (Sara's, confirmed this session)

Three layers with distinct jobs:

1. **Focus = empirical sensor.** What actually happened (built).
2. **Intake/pipeline = flow organizer.** Resumable work-in-motion with local
   artifacts (built; dashboard now surfaces initiatives).
3. **Project plan = declaration and CLOSURE layer.** Works in BOTH directions:
   - Forward: declare intent, work flows toward it (classic).
   - **Backward: work happened fast → grab the delivered-but-unclaimed value,
     bundle it into a plan, annotate it with data (what got delivered, when),
     and declare the plan CLOSED. The next plan generation opens and new work
     accrues there.**

**THE INVARIANT: the plan is the only door value exits through.** Nothing
reaches "closed" except by being bundled into a project plan and closing that
plan. Even a pure bundle-of-detours gets a plan (possibly created
retroactively just to BE that bundle) and closes through it.

## Confirmed rulings (do not re-litigate — recorded in session memory)

1. **DB-first.** Plans, plan generations, and the value ledger live in THIS
   app's SQLite database. Rationale (Sara): this app IS the
   monitoring/management solution; the plan ledger is a core function of the
   tool, like the decision_queue. Supporting reasoning (accepted): plans are
   becoming operational state — lifecycle + concurrency + many-to-many claims
   — and the file-first model already showed friction (plan-writeback.js
   needed a sanitizer + optimistic lock; re-ingest deletes DB-only items).
2. **AGENT-PLAN.md inverts from ongoing-sync to import source.** Existing
   plans get imported as the first generation; from then on the DB leads.
   In-repo agent visibility is preserved via read surfaces (`ccam`, MCP,
   optionally a generated read-only export file) — the file becomes a VIEW,
   never the master.
3. **The file-based artifact layer is NOT demoted.** Per-solution pipeline
   artifacts (intake/<slug>/ briefs, technical plans, decisions.md, QA plans,
   build reports) remain each solution's working memory — resumability, the
   "why" behind rulings. DB-first applies ONLY to the portfolio layer above.
   Principle: each layer's state lives in the material native to it.
4. **Altitude: the dashboard's DB manages exactly THREE things — delivered
   value, desired value, and the reconciliation between them.** Repo-local
   pipeline detail (decisions.md content, technical plans, QA/build evidence)
   is NEVER pulled up into the dashboard. The dashboard is a map, not the
   territory; engaging with detail means opening Claude in that repo. (The
   dashboard's own decision_queue stays — it holds value-level escalations,
   distinct from repo pipeline decisions.)
5. **Multiple plans may run concurrently on one project.** This breaks the
   current one-plan-per-cwd assumption in `plans`/`plan_items`.

## The requested capability, concretely

### A. Plan lifecycle
- Plans have generations: open → closed (retained forever as history, never
  deleted). Closing is a deliberate, plan-level action with a date and
  closure annotations ("this is what got delivered").
- Multiple plans can be open on the same project simultaneously.
- History question "what did we do on this project across its whole life"
  spans closed generations.

### B. The unclaimed value pool (empirical right side)
The pool of delivered-but-unclaimed value, assembled from what the dashboard
can already see or cheaply gather:
- **Trunk commits** — merge commits following the `Merge effort/<slug>:`
  convention (mechanically attributable to intake initiatives) and
  direct-to-trunk commits (detour candidates).
- **Intake initiatives** (already scanned live per project) and their stages.
- **Focus records / detours** (focus sessions, detour_dispositions) — session
  timestamps+cwd can bracket direct-to-master commits (suggested
  attributions).
Attribution confidence tiers: mechanical (slug match) → correlational (focus
bracketing) → judgment (human or LLM-proposed, human-gated).

### C. The two-pane reconciliation workbench (UI)
- **Left pane:** this project's open plans (plural). Editable in place: add
  first-level items, nest sub-items (parent_item_id nesting already in
  schema). Close-plan action lives here.
- **Right pane:** the unclaimed value pool.
- **Core gesture:** pull items from right to left — claiming value into a
  plan (attach to an existing item, or create an item from it).
- Closed plans leave the left pane but are browsable as history.

### D. The ledger (persistence)
- Claims (value-unit → plan item) are judgments: persisted once made, never
  recomputed. Each reconciliation run only deals with value since the last
  run (ratchet).
- Health metrics: size of the unclaimed pool + time since last closure.
  ("Did we clear our milestone or are we just having fun?" becomes
  measurable.)

## Existing machinery to build on (from the 2026-08-01-build-project-manager effort)

- `plans` / `plan_items` tables (+ `parent_item_id` nesting,
  `target_date` + `server/lib/pace.js`).
- `detour_dispositions` + `server/lib/detours.js` +
  `server/lib/plan-writeback.js` (item-level bundling already exists —
  fold_in/new_item write back into AGENT-PLAN.md; NOTE ruling #2 above
  inverts this relationship and this write-back path's future needs deciding).
- `decision_queue` + `server/lib/reconciliation.js` (rules decide whether to
  escalate; one batched LLM call classifies detours).
- Focus tracking (`focus segments`, focus-report, swimlane calendar, LLM
  window summaries).
- Intake scanning (`server/lib/intake-scan.js` — now depth-3 recursive) and
  repo topology (`server/lib/repo-topology.js`).
- Plan ingestion (`server/lib/plan-ingest.js`) — becomes the import path.
- WATCH-2 from that effort's decisions.md explicitly named plan lifecycle as
  deliberately unscheduled — this request is that thread, now with its design
  brief.

## Constraints / cautions

- The 2026-07-30 `wip-queue-page` precedent: this repo's first
  portfolio-altitude UI feature was built and fully reverted two days later.
  Sequencing and checkpointing with Sara matters; don't build the whole
  surface in one shot.
- Layer 7 (portfolio rollup UI) was deliberately deferred (WATCH-3) — this
  request is adjacent but NOT that; keep scopes distinct.
- `deletePlanItemsNotIn` on re-ingest deletes DB-only items — the import
  inversion must not lose data.
- Migration-safe schema changes only (project rule).
- DEC-7's live-trial gate from the prior effort is still open (Sara hasn't
  reviewed real decision-queue output yet) — worth noting for sequencing.

## Acceptance sketch (what "done" looks like for Sara)

- Open a project in the dashboard → see open plan(s) on the left and the
  unclaimed pool on the right.
- Pull delivered value into a plan; edit plan items/sub-items in place.
- Close a plan → it's stamped, retained as history, and its claimed value is
  "closed"; the pool shrinks correspondingly.
- Ask "what value did this project deliver" and get the answer from closed
  generations + claims, not archaeology.
