# PM Plan: WIP (work-in-progress) queue page

Date: 2026-07-28. Project: Claude-Code-Agent-Monitor. No `PROJECT-CONTEXT.md`
exists for this repo — PM memory falls back to
`~/.claude/skills/team-intake/memory/` (`request-log.md`, `decision-log.md`),
per the brief.

## 1. Request summary

Sara wants a new top-level page, **WIP**, that gives her a single glance
answer to "who needs me right now, ranked by what I care about." It shows one
live, vertically-flowing queue of session cards for currently **active
sessions only**; sessions awaiting her input always float to the top;
ties among those are broken by a new, per-**project** priority value that she
sets by dragging projects around inside a collapsible right-hand sidecar; the
existing session card is reused but with the project name made visually more
prominent; the whole page is driven by the existing WebSocket pipeline (no
polling); and the layout is a responsive, priority-ordered 1→2→3-column fill
(column 1 filled top-to-bottom by rank before column 2 starts) rather than a
CSS text-wrap. It was dictated verbally, in-session, immediately before
`/engineering-manager auto` routed to `team-intake` → `team-build` since this
is the first delivery-pipeline run in this repo.

## 2. Request type

**`new-feature`** — confirming the brief's provisional call, no change.

Reasoning: every load-bearing piece here is genuinely net-new, not a fix or
restoration of anything that existed before:
- New page/route/nav entry — doesn't exist today.
- New persisted `projects.priority` column and write endpoint — confirmed
  absent (only a client-only, per-browser `localStorage` arrangement exists,
  `client/src/lib/projectOrder.ts`, which is explicitly documented in its own
  file as never reaching the server).
- New live-recompute-a-sort behavior — every existing consumer of the
  WebSocket pipeline today reacts to presence/absence and field merges, none
  recomputes an automatic *rank* live; this is the first.
- New drag-and-drop write-through-to-server mechanism — the only DnD in the
  app today is Kanban's hand-rolled reorder, which persists to
  `localStorage`, not the API.
- New visual element on the card (project name) — `SessionCard.tsx` has no
  project-name field or slot at all today; `Session` has no `project_id`
  (deliberately, by design — membership is derived by joining `cwd`).

None of the other candidate types fit: it's not a **bug** (nothing here ever
worked and broke), not a **regression** (nothing regressed), not a
**missed-requirement** (there was no prior WIP/priority requirement that was
incompletely built — this is the first time either concept has been
requested), and not **text/content-change** or **clarification-only** (this
is code + schema + UI, not wording).

## 3. History / background

**Have we seen this exact request before? No.** No `WIP`, `priority`, or
project-priority-queue request appears anywhere in
`~/.claude/skills/team-intake/memory/request-log.md` or `decision-log.md` for
this project. This is genuinely new ground for the "priority" concept and the
"WIP page" concept both.

**But this project has a directly relevant, very recent history in the same
*shape* of problem**, from two team-intake cycles run on **2026-07-26** (two
days ago, same repo, same delivery pipeline being used for the first time
that day too):

1. **`focus-report-fidelity`** (classified `missed-requirement`) — Sara's own
   round-4 fix to the Focus Calendar view (chunks/idle-stripe rendering,
   active-vs-wall time) was never applied to the Focus **List** view, a
   second, independent consumer of the same underlying
   `wall_ms`/`active_ms`/`chunks` data. The PM plan for that cycle explicitly
   named the mechanism: *"fixed one consumer, not the other"* — a shared data
   model rendered by more than one surface, with no shared helper and no
   cross-view test to catch drift. The fix (DEC-2/DEC-3 in the decision log):
   extract a shared helper (not copy-paste) and add a standing cross-view
   (List vs. Calendar) consistency test.
2. **`focus-calendar-board`** (classified `new-feature`, same day, second
   cycle) — a brand-new aggregate calendar page, which the PM plan flagged
   loudly at the time as creating a **3rd consumer** of the same
   calendar-rendering surface the morning's fix had *just* closed for a 2nd
   consumer. That plan mandated (and DEC-1..6 recorded as decided) the
   architect's "extract chrome into a shared component, do not copy-paste"
   plan plus a cross-entry-path parity test extending the same standing
   template — explicitly to stop the identical defect shape from recurring a
   second time in the same day.

I verified (not assumed) that this mandate is still actually in the code
today: `client/src/lib/idleStripes.ts` is a shared helper consumed by both
`FocusCalendarView.tsx` and `FocusReportBody.tsx`, and
`client/src/components/__tests__/FocusReportModal.test.tsx` still carries the
cross-view consistency assertions. Git history since (`6e29722` → `e4d4bda`
→ `2416292`/`0ef79b3` → `b3a2cc9` → `ed23878` → `b930824` → `0d5fbe7`) shows
continued, active iteration in exactly this area through the present day —
this is not a closed, forgotten thread, it's a live one.

**This WIP request lands squarely in the same shape of problem, one level
over.** `SessionCard.tsx` and the `Session`/`isSessionAwaitingInput`/
`effectiveSessionStatus` model in `types.ts` are today already consumed
independently by Kanban (`KanbanBoard.tsx`) and, per the brief, the Focus
surfaces. The WIP page would become a **third (arguably fourth, counting
Focus's List/Calendar split)** independent consumer of the same
session-rendering/status-derivation surface. This is not a coincidence of
naming — it is this project's one clearly recurring systemic shape:
**one underlying data/render surface, multiple independent page-level
consumers, no enforced single source of truth or cross-consumer test unless
someone deliberately builds one.**

## 4. Recurrence diagnosis

This is a **repeat of a pattern**, not of a specific defect. The pattern:
whenever a second or third page needs to show the same underlying session (or
focus-report) data, the natural path of least resistance is to
re-derive/re-render it independently in the new page, and unless the team
explicitly extracts a shared helper/component and adds a cross-consumer test,
the copies drift the moment one of them is fixed or extended and the other
isn't touched. That is exactly what happened with Focus List vs. Calendar
two days ago, and exactly the shape the `focus-calendar-board` PM plan
predicted would keep happening across more consumers if not addressed by
policy, not just by one fix.

**The good news, worth stating plainly rather than assuming it's fine:** all
four of this cycle's evaluators (PO, architect, engineer, QA) *independently*
converged on the durable-fix shape already, without a configured defect
catalog telling them to — reuse `isSessionAwaitingInput` as-is rather than
re-deriving a predicate, extract the `cwd`→project join once and use it in
both the card and the sort (engineer's gotcha #3, explicitly citing the
"content must behave identically across near-duplicate surfaces" risk this
project's own history already raised), and treat `SessionCard.tsx` itself
with real caution (fork vs. additive-prop debate below) rather than silently
editing shared render logic. That is the lesson from `focus-calendar-board`'s
DEC-1..6 mandate propagating correctly into a new area, even without a formal
catalog entry forcing it. **This should be named explicitly to the tech lead
and engineer as "this is the same shape as the Focus fidelity issue — hold
the same discipline," not treated as a fresh judgment call each time.**

The systemic fix that actually breaks the cycle for good, and that this
project still does not have: a **named, standing convention** (ideally
promoted into a `PROJECT-CONTEXT.md` defect-class catalog entry, since none
exists yet) stating "any new consumer of `Session`/`SessionCard`/
project-derivation logic must reuse the existing predicate/join/component,
not re-derive it, and must add or extend a cross-consumer identity test" —
today this is being re-discovered and re-applied ad hoc, cycle by cycle, by
conscientious evaluators rather than being enforced by a written rule. It has
held twice in a row so far; it is not yet guaranteed to hold the fourth time
if a different, less careful pass touches this surface.

## 5. Where this is coming from

Not a changed requirement, not drift, not a misunderstanding — this is a
**genuinely new product idea** Sara had in-session, building on top of
existing signal (awaiting-input status, session cards) that already exists
elsewhere in the app but has never been assembled into a dedicated
"attention" view. The root source is straightforwardly "new idea, first
time asked for." The *risk* attached to it (drift across a third/fourth
render consumer) is structural to how this codebase has grown, not to this
specific request.

## 6. Recommendation to the human

**Approve as `new-feature`, next-in-queue** (not backlog) — Sara dictated
this directly as a build ask, immediately routing it through
`team-intake`/`team-build`, and it isn't blocked on anything else. Cost
framing: this is a new ask, our normal build cost, not a bug we owe for
free.

**Durable-fix discipline to carry forward, not just "build it":**
1. Reuse `isSessionAwaitingInput` / `effectiveSessionStatus` exactly as they
   exist today — do not write a parallel predicate for WIP.
2. Extract the `cwd`→project-name join (today only inline in
   `KanbanBoard.tsx`) into one shared helper, used by both the card and the
   sort/tiebreak lookup, rather than hand-rolling a second copy.
3. Do not edit `SessionCard.tsx`'s shared render path in a way that can
   change Kanban's existing, already-passing snapshot. **Decision: fork a
   `WipSessionCard`/wrapper variant** rather than an in-place prop edit — the
   architect's own analysis and the engineer's explicit recommendation both
   land here, and it's the only option with zero blast radius to the other
   two existing consumers. This is the direct, applied lesson from the Focus
   cycle two days ago; flagging it as the same shape rather than a fresh
   judgment call.
4. Add a cross-consumer identity/parity test analogous to the standing Focus
   List/Calendar one — at minimum, unit tests proving the WIP sort and
   Kanban's own awaiting-input bucketing agree on the same inputs.

**Auto-decided defaults (auto-pilot, preference-level — logged, Sara can
override any of these without cost):**
- Tertiary sort (same-priority-tied awaiting sessions, and ordering among
  non-awaiting sessions): most-recent-activity descending (PO's proposal,
  unopposed).
- Sidecar scope: lists projects currently represented in the queue by
  default, with a "show all projects" toggle for pre-ranking dormant
  projects; collapsed by default.
- `SessionCard`: forked `WipSessionCard` variant (see above), not an edit to
  the shared component.
- Column-fill: JS-computed contiguous-chunk assignment via a pure,
  unit-tested function (`fill column 1 top-to-bottom, then column 2, then
  column 3`), column count driven by a `ResizeObserver` on the queue
  container's own width (not viewport breakpoints) — because the sidecar can
  shrink the queue's available width independent of the window, and a
  viewport-only trigger would visually cram columns instead of dropping one.
  Reuse Tailwind's existing `md`/`lg` pixel thresholds as the starting
  breakpoint values.
- Drag-and-drop: reuse the existing native HTML5 DnD pattern already in
  `KanbanBoard.tsx` — no new dependency.
- `priority` storage: a dense rank, `INTEGER NOT NULL DEFAULT 0`, renumbered
  transactionally on every reorder (not a sparse free-entry score) —
  convention pinned here to avoid ambiguity: **lower value = higher
  priority** (rank 0 = top of the sidecar / highest tiebreak precedence),
  consistent across the DB default, the sort function, and the sidecar's
  initial display order. All pre-existing projects default to rank 0
  (effectively tied at the top) until Sara actively re-ranks them.
- Awaiting-input predicate parity: WIP must apply the exact same
  "primary-reason" carve-out Kanban already applies (subagent/shell/monitor
  waits excluded from "awaiting input"), not a redefinition — this is the
  single highest-leverage place a silent divergence could reintroduce the
  recurring drift pattern.
- Priority-change live broadcast: **add a new `project_updated` WS
  broadcast, scoped to this field only** (not a general "make all project
  CRUD live" change). This is a deliberate, documented exception to today's
  otherwise-consistent "project mutations are plain CRUD, not broadcast"
  behavior — justified because Sara explicitly asked for "this will all be
  live," and cross-tab priority drift (drag in one tab, stale order in
  another) would be immediately visible. Document this explicitly in
  `docs/DATABASE.md` rather than silently special-casing one field.

## 7. Open decisions for the user

These are the items no PM-level default can safely stand in for — genuinely
Sara's call, kept intentionally short so as not to block the build:

1. **Visual treatment of "project name more prominent."** Zero mockup/spec
   exists; PO flags this as the single highest-risk-of-mismatch acceptance
   criterion because two engineers could both truthfully claim compliance
   with visibly different results. Recommend: team builds against a
   reasonable first guess, but gets Sara's explicit thumbs-up on a concrete
   before/after screenshot before that change is considered final/merged —
   a lightweight async gate, not a stop-the-build blocker.
2. **Nav placement for the new "WIP" entry.** Prior nav placements
   (`focus-calendar`/`focus`) were placed by an explicit decision (`DEC-5`),
   not appended to the list end. Given Sara's framing suggests this will be
   a primary/daily-use page, recommend placing it near the top of the nav
   (e.g. right after Dashboard) rather than at the bottom — flagging for her
   override since it's cheap to change either way.
3. **Whether the "show all projects" sidecar toggle (auto-decided default
   above) is actually wanted**, vs. always showing every project regardless
   of current queue membership — low-stakes but worth a quick confirm since
   it's the one control she'll open daily.
4. **Whether scoping the new live `project_updated` broadcast to priority
   only (vs. extending it to all project CRUD) is the right cut line** — a
   real, disclosed design choice with a documentation consequence
   (`docs/DATABASE.md`'s current "no WebSocket broadcast" line for
   `projects` becomes partially inaccurate and needs an explicit carve-out
   note), not just an implementation detail.

No item above blocks starting the tech-lead/build phase — all are
resolvable in parallel with early implementation.
