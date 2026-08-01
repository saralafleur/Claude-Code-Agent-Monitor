# Portfolio / Project-Manager Layer — Design Notes

Working notes from a design conversation on how to manage many concurrent
Claude Code projects/sessions without falling into session-by-session
micromanagement. Captured so a future session (or a post-restart Sara) can
pick this up cold. Nothing here has been built yet except where explicitly
marked BUILT.

## The problem being solved

When running 12–20 concurrent Claude Code sessions across 8–10 projects, it
becomes very difficult to answer, at a glance: what are we building, are we
on track, what did the last hour of work actually accomplish, and how does
new information/discoveries/detours map back to the original intent. Without
a mechanism for this, the only fallback is manually rotating through
individual sessions to reconstruct state — which hits a hard scalability
wall and is exhausting.

The ask: a "project manager" layer that operates at stakeholder altitude
(clear deliverables, plain language) with technical milestones underneath,
persistent knowledge that survives a full outage/restart, cost allocation,
and an "advisor" capability that spots patterns and bad practices — all
without requiring a human to babysit every session. The human should only
get pulled in for architecture calls, UX/acceptance judgment, or "this
doesn't feel right."

## Confirmed architecture: 7 layers

This framing was walked through and explicitly confirmed by Sara
("yes this tracks to the intent I shared").

1. **Objectives (deliverable spine)** — one row per project, kept at
   stakeholder language ("we added X capability"). **BUILT**: `AGENT-PLAN.md`
   per project, authored/maintained via the `project-plan` skill.

2. **Milestones (technical sub-steps)** — the technical bullet points under
   each objective/deliverable, used to track progress without cluttering the
   stakeholder-level view. **Schema-ready, underused**: `plan_items` table
   already supports nesting via `parent_item_id` (see `server/db.js`
   ~L540-593). Plans just need to actually be authored using that nesting
   instead of a flat list.

3. **Declared activity (what a session says it's doing)** — the correlation
   hook tying live work to a specific milestone. **BUILT**:
   `ccam focus set/push/pop`.

4. **Detour/discovery disposition** — undeclared session work. **Half-built**:
   focus-inference already classifies undeclared time into a detour summary
   line rather than a raw dump (see the `holistic-focus-history` memory /
   `server/lib/focus-report.js`). **Missing**: the disposition step. Nothing
   today decides what to *do* with a detour — fold it into the plan as a
   newly-discovered milestone, spin it into a new plan item, log it as a
   deliberate accepted deviation, or discard it as noise. It's currently
   observed, not resolved. Open implementation question: does a "detour"
   need to become a real persisted/disposable entity (new table?), or can
   the existing focus-inference output be reused/extended in place?

5. **Pace tracking (are we on track)** — does not exist yet. No plan item
   carries an expected arrival/target time, so nothing can currently say "we
   expected to be here by Thursday and we're not." Needs a lightweight
   target/estimate field added to `plan_items` (or wherever makes sense),
   compared against actual completion timestamps (`declared_done_at` already
   exists on `plan_items`).

6. **Reconciliation pass — the actual missing piece, and the recommended
   build priority.** Everything above only becomes real portfolio management
   if something runs *periodically* (not continuously) per project: reads
   the plan + recent sessions + accumulated detours, decides pace status
   (on-track / behind / stalled), proposes a disposition for each detour, and
   surfaces to Sara **only** what needs a human call — resolving/logging
   everything else quietly. This is the direct fix for the
   micromanagement/scalability wall.

   **Decided (confirmed): hybrid escalation, not uniform.**
   - Fixed rules handle objective/measurable thresholds: pace vs. target
     date, detour-volume ratio. Precedent already in the codebase:
     `server/lib/session-liveness.js` uses hard rules for a comparable
     always-on check.
   - An LLM judgment pass is reserved specifically for classifying *what a
     detour actually is* (fold into plan / spin new item / deliberate
     deviation / discard). Precedent already in the codebase:
     `server/lib/focus-summary.js` runs a comparable per-cycle LLM pass over
     accumulated session context.
   - In short: rules decide *whether* to look; the LLM decides *what to do*
     once flagged.
   - Likely implementation shape: a scheduled/looped agent pass per project
     (not a live continuous process) — candidates are the existing
     `/loop` mechanism or a scheduled cron agent.

7. **Portfolio rollup UI** — one row per project: objective progress %, pace
   flag, cost, and a decision-queue badge if layer 6 flagged anything.
   Deliberately deprioritized until layer 6 exists to feed it real verdicts
   — a static rollup of raw counts (sessions/plan %/cost with no pace or
   detour judgment) was considered as a quick v1 but explicitly set aside in
   favor of building the reconciliation pass first.

## Current-state research notes (as of this conversation)

Gathered via a codebase survey; treat as a snapshot, verify against live
code before relying on it.

**Projects** — `server/db.js` ~L515-533: `projects(id, name, ...)` +
`project_paths(id, project_id, cwd)`. A project is a user-named label over
one or more `cwd` folders; sessions carry no `project_id`, membership is
derived by joining `sessions.cwd` against `project_paths.cwd`. API:
`server/routes/projects.js`. `GET /api/projects` already returns every
project at once with `session_count`, `active_count`, `last_activity` — the
closest thing to an existing cross-project rollup today, but no plan or cost
fields.

**Plans** — `server/db.js` ~L540-593: `plans(cwd, title, file_path,
item_count, ...)`, `plan_items(cwd, item_id, parent_item_id, text, checked,
position, declared_done_at, ...)`. Ingested from `<cwd>/AGENT-PLAN.md` via
`server/lib/plan-ingest.js`. API: `server/routes/plans.js` — `GET
/api/plans` returns every project's plan/items in one call already. No
server-computed status/percent field exists; % complete is computed
client-side in `client/src/components/PlanPanel.tsx`.

**Sessions** — `server/db.js` L138-147: `sessions(id, name, status CHECK IN
('active','completed','error','abandoned'), cwd, model, started_at,
ended_at, metadata)`. `GET /api/sessions` (`server/routes/sessions.js`) is
already global/unscoped with filtering/pagination and per-session
cost/tokens attached. No "recent" status exists in the DB — only
`active`/terminal plus `updated_at` recency, computed ad hoc per caller.
Liveness checks live in `server/lib/session-liveness.js` (hard rules via
`ps`/`lsof`).

**Usage/cost** — two distinct systems, easy to conflate:
- `token_usage` table (`server/db.js` L179+), keyed by `session_id` +
  `model`, has real token counts for cost calc (`server/lib/pricing.js`).
  Since `sessions.cwd` maps to a project, per-project cost is derivable
  today by joining `sessions` → `token_usage`, **but no endpoint does this
  yet** — cost is currently surfaced per-session only.
- `usage_captures` table (`server/lib/usage-captures-db.js`,
  `server/routes/usage.js`, `client/src/pages/Usage.tsx`) backs the newly
  shipped Usage page — this is the Claude *subscription's* plan-usage %
  (`session_window_pct`, `week_window_pct`), scoped to account, not project.
  Its `cwd` column just records where a capture ran, not a real
  cost-per-project breakdown.

**Existing "list all projects" surface** — `client/src/pages/Projects.tsx`
(route `/projects`) already lists every project with mapped folders,
session/active counts, `last_activity`, and per-project plan progress (via
`PlanPanel`). No cost/usage column exists there today. This is the natural
home for the eventual layer-7 rollup.

**Focus report** — `server/lib/focus-report.js` exports
`buildProjectFocusReport(...)`, which takes an arbitrary session array and
isn't inherently single-project at the function level, but its only caller
(`GET /api/projects/:id/focus-report`) always scopes to one project. Bulk
cross-project focus reporting doesn't exist yet and would need new work
(loop per project, or extend the route/function to return a per-project
keyed map).

## Related existing memory

- `holistic-focus-history` (auto-memory, this project) — the sibling design
  thread for a single project's lifetime "what did we do" history,
  time-window UX for the focus report, and multi-plan lifecycle
  reconciliation (a plan being put on hold/superseded/archived — not yet
  modeled). Relevant because layer 4 (detour disposition) and layer 6
  (reconciliation pass) both build directly on the focus-inference /
  focus-summary machinery that thread already shipped.
- `portfolio-reconciliation-vision` (auto-memory, this project) — the memory
  entry this pm.md file was distilled from; keep them in sync if either
  changes materially.

## Open questions / not yet decided

1. **How to move from design to build.** Options discussed, no decision
   made yet:
   - Run this through the `team-intake` skill for a formal technical plan +
     PM plan before any code, given the schema changes and new
     scheduled-agent component.
   - Keep designing in chat first — nail down the detour-entity
     representation and the reconciliation pass's exact output/escalation
     format before formalizing anything.
   - Skip formal process and start with the smallest concrete slice (e.g.
     add the target-date field to `plan_items`) and grow incrementally.
2. **Detour entity representation** — new table vs. extending existing
   focus-inference output in place. Not decided.
3. **Reconciliation pass output/escalation format** — what exactly gets
   written/shown when a project needs a human decision (a new "decision
   queue" concept implied by layer 6/7, not yet designed).
4. **Target-date field shape** — where it lives (`plan_items` column vs.
   separate table) and how it's authored (manual estimate vs. inferred).

## Recommended next step (not yet acted on)

Given the size of what's left — a target-date field, turning "detour" into
a real disposable entity, and the reconciliation pass itself as a
scheduled per-project agent — this was flagged as substantial enough to
warrant a short plan before broad edits (per this repo's CLAUDE.md
guidance), rather than diving straight into implementation.
