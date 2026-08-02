# Request Brief — Build the Project Manager (layers 4–6)

## Raw ask (verbatim)

From `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/pm.md`:

> "The ask: a 'project manager' layer that operates at stakeholder altitude
> (clear deliverables, plain language) with technical milestones underneath,
> persistent knowledge that survives a full outage/restart, cost allocation,
> and an 'advisor' capability that spots patterns and bad practices — all
> without requiring a human to babysit every session. The human should only
> get pulled in for architecture calls, UX/acceptance judgment, or 'this
> doesn't feel right.'"

Problem statement, verbatim:

> "When running 12–20 concurrent Claude Code sessions across 8–10 projects,
> it becomes very difficult to answer, at a glance: what are we building,
> are we on track, what did the last hour of work actually accomplish, and
> how does new information/discoveries/detours map back to the original
> intent. Without a mechanism for this, the only fallback is manually
> rotating through individual sessions to reconstruct state — which hits a
> hard scalability wall and is exhausting."

The framing was "explicitly confirmed by Sara ('yes this tracks to the
intent I shared')" as a 7-layer architecture.

## Restated ask

Build the missing middle of the confirmed 7-layer portfolio-management
architecture — specifically **layer 4 (detour/discovery disposition), layer
5 (pace/target-date tracking), and layer 6 (the periodic reconciliation
pass)** — so that undeclared session work gets a resolved disposition,
progress against a target date is measurable, and a scheduled per-project
process can quietly resolve routine cases while surfacing to Sara only the
decisions that genuinely need a human call.

## Requester / source

Sara, via a captured design conversation, distilled into
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/pm.md` (working notes
file, dated implicitly to this intake: 2026-08-01). No separate ticket/email
channel — this is a first-person design-thread request being formalized
through team-intake per the repo's own process, at Sara's direction (see
"Open questions #1" in the source material, now resolved in practice by the
fact this intake is running).

## Surface / area touched

Not "the app" — specifically:
- `server/db.js` (`plan_items` table — needs new field(s) for target
  date/estimate; detour entity representation, if any, lands here too)
- `server/lib/focus-report.js` / `server/lib/focus-summary.js` (existing
  detour/undeclared-time inference this work builds on)
- `server/lib/session-liveness.js` (precedent for the fixed-rule half of the
  hybrid reconciliation logic)
- A new scheduled/periodic per-project process (candidates named in source:
  the existing `/loop` mechanism, or a scheduled cron agent) — this is a new
  component, not an extension of an existing route/file.
- Likely new API surface to expose reconciliation output (a "decision
  queue") — exact shape is explicitly undecided (see blocking-adjacent
  question below).

**Explicitly out of scope for this request** (per the orchestrator's
scoping instruction, confirmed against pm.md's own layer marks):
- Layers 1–3 are already **BUILT**: `AGENT-PLAN.md`/`project-plan` skill
  (objectives), nested `plan_items` via `parent_item_id` (milestones —
  schema-ready though underused), `ccam focus set/push/pop` (declared
  activity). This request is not asking to rebuild or redesign these.
- Layer 7 (portfolio rollup UI, `client/src/pages/Projects.tsx`) is
  explicitly **deprioritized** in the source material until layer 6 exists
  to feed it real verdicts. Not in scope here.

## Known-variant relevance

Checked `PROJECT-CONTEXT.md`'s two named recurring defect classes against
this request's surface:

- **9.1 DERIVED-DUAL-VIEW** (a server-derived summary value consumed by
  multiple independent client rendering surfaces, fixed in one place but not
  propagated to others) — **relevant, flag for the build phase.** Layer 6's
  reconciliation pass will read from `server/lib/focus-report.js` /
  `focus-summary.js`, which already feeds multiple existing UI consumers
  (Calendar board, FocusReportModal, FocusPage — per the pattern's own
  citation history). Any new derived value this work introduces (pace
  status, detour disposition, decision-queue entries) that ends up rendered
  in more than one place (e.g. a future decision-queue view alongside a
  session-detail view) must be extracted into a shared
  component/hook — not hand-copied — per this project's established
  convention.
- **9.2 row-id-as-chronology-proxy** — **relevant, flag for the build
  phase.** The reconciliation pass reads "recent sessions" and accumulated
  detours to compute pace/detour-volume; any query walking `events` or other
  bulk-inserted tables for this must sort by `created_at` explicitly (with
  `id` as tiebreak), never rely on `id` order, per the project's own fix
  history (3 prior live instances of this exact bug in adjacent
  focus-inference code).

## Provisional request type

`new-feature` (PROVISIONAL — PM makes the final call). This is net-new
functionality (detour disposition logic, a target-date field, and a new
scheduled reconciliation process), not a bug fix or content change. It
builds directly on and extends already-built machinery (focus-inference,
session-liveness precedent) rather than being a from-scratch subsystem.

## Attachments / evidence

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/pm.md` — full
  design-conversation notes, including a codebase survey of the exact
  current state of Projects/Plans/Sessions/Usage tables and routes.
- Two related auto-memory entries referenced in pm.md as sibling
  threads/sources: `holistic-focus-history` and
  `portfolio-reconciliation-vision` (the latter is explicitly the memory
  entry pm.md was distilled from — "keep them in sync if either changes
  materially").

## Explicit acceptance signals

pm.md does not state a formal "done when…" for the overall PM system (it is
design notes, not a spec), but it does state a concrete architectural
decision that functions as an acceptance constraint on layer 6 specifically:

> "Decided (confirmed): hybrid escalation, not uniform. Fixed rules handle
> objective/measurable thresholds: pace vs. target date, detour-volume
> ratio. ... An LLM judgment pass is reserved specifically for classifying
> *what a detour actually is* (fold into plan / spin new item / deliberate
> deviation / discard) ... In short: rules decide *whether* to look; the LLM
> decides *what to do* once flagged."

Any implementation of layer 6 that inverts this (e.g., LLM deciding
whether/when to escalate, or fixed rules attempting to classify detour
type) would violate the confirmed design and should be treated as
non-compliant, not a valid alternative interpretation.

## Ambiguity

### BLOCKING
None. The four items below were explicitly flagged as open in the source
material, but per the orchestrator's scoping instruction they are exactly
the kind of design-space question the evaluation phase (architect,
engineer, QA) and PM are expected to resolve with a concrete recommendation
— not a precondition for meaningful evaluation to begin. Listed below as
non-blocking with the assumption each evaluator should carry forward.

### Non-blocking (assumptions to carry into evaluation)
1. **Detour entity representation** — undecided whether a "detour" becomes
   a new persisted/disposable DB entity (new table) or reuses/extends the
   existing focus-inference output in place. *Assumption for evaluation:*
   architect should propose one, weighing that a disposition (fold-in /
   new-item / deliberate-deviation / discard) implies a decision that must
   persist and be queryable independent of the underlying session/event
   data it was derived from — i.e., favor a durable record over a
   recomputed-on-read summary, but this is the architect's call to make
   explicit and justify.
2. **Reconciliation pass output/escalation format** — the "decision queue"
   concept implied by layers 6/7 has no designed shape yet (what fields,
   where stored, how surfaced). *Assumption for evaluation:* treat this as
   part of layer 6's own deliverable, not deferred to layer 7 — layer 6
   must produce *something* queryable even before any UI consumes it Design
   it minimally (enough for a CLI/API check) rather than over-building for
   a UI that's explicitly deprioritized.
3. **Target-date field shape and authorship** — where it lives (`plan_items`
   column vs. separate table) and whether it's manually authored or
   inferred. *Assumption for evaluation:* start with manual authorship on
   `plan_items` (simplest, matches existing `declared_done_at` precedent on
   the same table) and treat inference as a future enhancement, unless the
   architect finds a concrete reason a separate table is needed now.
4. **Process shape for the reconciliation pass** — pm.md names two
   candidate mechanisms (existing `/loop` mechanism vs. a scheduled cron
   agent) without deciding. *Assumption for evaluation:* this is an
   architecture decision to make explicitly with tradeoffs stated (this
   repo's CLAUDE.md already flags this work as "substantial enough to
   warrant a short plan before broad edits").

## Scope confirmation

Per explicit instruction accompanying this intake request: the buildable
scope of this request is **layers 4, 5, and 6 only**:
- **Layer 4** — detour/discovery disposition (resolve, don't just observe,
  undeclared session work).
- **Layer 5** — pace tracking (target-date field + comparison against
  actual completion).
- **Layer 6** — the reconciliation pass itself, as a scheduled/periodic
  per-project process, using the confirmed hybrid escalation model (fixed
  rules decide *whether* to escalate; LLM judgment decides *what a detour
  is* once flagged).

This is **not** a request to build or redesign layers 1–3 (already built),
and **not** a request for layer 7 (portfolio rollup UI, deliberately
deferred in the source material until layer 6 produces real verdicts to
feed it).
