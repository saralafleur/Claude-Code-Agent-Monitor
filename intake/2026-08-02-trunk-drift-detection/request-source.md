# Request source: trunk-drift detection for the Claude Code Agent Monitor

Captured 2026-08-02 from a design conversation with Sara (not a ticket/email —
this is the distilled ask from that conversation).

## The ask

Sara wants the Claude Code Agent Monitor (this repo's own product) to be able
to **notice when real work has happened directly on a repo's trunk/default
branch** (`main`/`master`, whatever it's named) — as opposed to work that
went through a worktree/feature-branch flow the dashboard already tracks via
declared session focus (`ccam focus set/push/pop`, `focus_inferences`,
`detour_dispositions`).

Today, everything in the portfolio-reconciliation model (layers 3-6: declared
activity, detour disposition, pace, reconciliation) is keyed off the **hook
event stream** — it only sees work that happened inside a Claude Code session
that ran the hooks and declared (or was inferred to have) focus. Commits that
land directly on the trunk branch with no session declaring anything (a human
committing by hand, or a session that never called `ccam focus`) are
currently invisible to all of it. `server/lib/repo-topology.js` already
computes live git worktree state (branch, dirty/clean) per request for the
Project Detail page, but doesn't flag "this worktree's branch is the repo's
actual default branch" as a distinct condition, and doesn't look at commit
history at all — only working-tree dirtiness.

## Confirmed scope for THIS request (explicitly narrowed during the conversation)

Sara explicitly split this into two steps and asked to scope **only step 1**
right now:

1. **Detection (this request's scope).** A passive, live-computed signal —
   same posture as `repo-topology.js`'s existing git derivations (recomputed
   per request, not cached) — that answers "is there a body of unattributed
   work on this repo's trunk branch, and what is it (which commits / what
   diff)?" No session required to produce it. Output: the commit range and
   enough content (diff/commit messages) to describe what happened. No
   classification judgment happens in this step.

2. **Classification (out of scope for this request — already exists,
   confirmed during the conversation).** Once a body of unattributed trunk
   work is detected, it should be checked against `AGENT-PLAN.md`: if it
   matches an existing plan item, it's not a "detour" — it's undeclared but
   already-planned work. If it doesn't match anything in the plan, it's a
   genuine detour needing manual mapping/classification into the project
   plan. Sara confirmed this matching logic **already exists**:
   `server/lib/reconciliation.js`'s `buildDispositionPrompt` already sends
   the LLM the current `PLAN ITEMS` alongside each pending detour and asks
   for exactly one of `fold_in` (matches/nests under an existing item) /
   `new_item` / `deliberate` / `discard` — this is the "matches the plan ->
   part of the plan, otherwise -> detour needing manual classification"
   behavior Sara described, already built for hook-observed detours. The
   ask is to plug the new detection signal into that **existing** lifecycle
   (`detour_dispositions` pending state, `decision_queue`, the LLM
   disposition pass, `plan-writeback.js`), not build a parallel one.

## How the pieces should fit (from the conversation, not yet a committed design)

- `detour_dispositions` already carries a `source` column distinguishing
  where a detour observation came from (`"inferred"` from the focus
  classifier, `"declared"` from an explicit `push`/`bug`/`feature`). A third
  source, something like `"trunk_drift"`, would carry the new detector's
  output — keyed by a commit-range identifier instead of a
  `focus_inferences.id`, since there's no session to key on.
- Every detour already starts in an unresolved/pending state before the LLM
  disposition pass runs, and that state is already what the dashboard badges
  as unqualified. Sara's phrase for this was **"a badge indicating unknown
  work"** — the intent is to reuse the existing pending-state badge
  treatment, not invent a new one, so a trunk-drift entry looks the same as
  any other undispositioned detour until it's qualified.
- `reconciliation.js`'s periodic pass is "the process we run today" Sara
  referred to — extending it to also read raw trunk-drift entries (not just
  session-derived ones) is the qualification step. The one likely code
  change: today `buildDispositionPrompt`'s `label` per detour comes from
  session/focus narrative; a `trunk_drift` entry has no session, so its
  label would need to come from the commit diff/messages instead.

## Explicit non-goals for this request

- Not asking for a `team-intake`-triggered build yet in the sense of "go
  implement the whole thing" — Sara wants this run through intake so the
  team can produce a real technical plan and PM plan for it, given it
  touches shared/confirmed portfolio-reconciliation architecture
  (`intake/2026-08-01-build-project-manager/` — layers 4-6, already built).
- Not asking to change the classification/disposition logic itself
  (`fold_in`/`new_item`/`deliberate`/`discard`, `plan-writeback.js`,
  `decision_queue`) — that machinery is confirmed reusable as-is. Scope is
  the new detector plus the minimal plumbing to feed it into that existing
  lifecycle.
- Not asking to build the layer-7 portfolio rollup UI (still deliberately
  deferred per `portfolio-reconciliation-vision` memory).

## Relevant prior art in this repo (for the PM's history reconstruction)

- `intake/2026-08-01-build-project-manager/` — the technical-plan.md and
  pm-plan.md that built layers 4-6 (`detour_dispositions`,
  `server/lib/detours.js`, `server/lib/plan-writeback.js`,
  `decision_queue`, `server/lib/reconciliation.js`,
  `POST /api/detours/:id/resolve`, `GET/POST /api/decision-queue`,
  `ccam decisions`). This request extends that same subsystem with a new
  detour source rather than building anything parallel.
- `intake/2026-07-31-focus-untracked-commits/` — a **retroactive** intake
  Sara ran after `team-status` caught seven commits that shipped real
  feature/bug work directly on trunk with no `team-intake` folder behind
  them and no declared focus. That episode is a real, concrete instance of
  exactly the failure mode this request wants detected automatically going
  forward (undeclared trunk work discovered only by a manual reconciliation
  pass, after the fact). It is not a duplicate of this request — that intake
  was about documenting one specific incident retroactively, not about
  building detection tooling — but it's strong evidence for why this
  detector is worth having.
- `server/lib/repo-topology.js` — the precedent for how this project derives
  live git state on demand (worktree list, branch, dirty-check) without
  caching computed output in SQLite; the new detector should follow the same
  posture.
- `.claude/CLAUDE.md`'s "Durable knowledge library" and this session's
  `portfolio-reconciliation-vision` memory — layers 1-6 confirmed/built,
  layer 7 (portfolio rollup UI) deliberately deferred. This request is
  additive within layer 4 (detour sourcing), not a new layer.
