# Change Brief — wip-queue-page

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-07-29
- **Scope source:** intake-handoff (technical-plan.md, pre-build — no code
  written yet for this feature)
- **Intake link:** `intake/2026-07-28-wip-queue-page/technical-plan.md`
  (reconciles `request-brief.md`, `pm-plan.md`, `supporting/architect.md`,
  `supporting/engineer.md`, `supporting/qa.md`, `supporting/product-owner.md`)

## Change summary
Build a new top-level **WIP** page: a live, single queue of active-only
session cards sorted awaiting-input-first then by a new per-project
`priority` (set via drag-and-drop in a collapsible right-hand sidecar),
rendered in a responsive 1/2/3-column priority-fill layout, fully
WebSocket-driven. This is the fourth independent consumer of
`Session`/`isSessionAwaitingInput`/`effectiveSessionStatus`/cwd→project
derivation (after Kanban, Focus List, Focus Calendar), and the plan's central
discipline is routing every leg of it through shared helpers instead of
re-deriving any of that logic a fourth time.

**Verification against current code: the plan matches reality.** Every
"this doesn't exist yet" claim in the plan checks out against the actual
repo state as of this run:
- `projects` table (`server/db.js:414-419`) has no `priority` column today.
- No `PUT /api/projects/reorder` (or any bulk-order-persistence) endpoint
  exists in `server/routes/projects.js` (routes present: `GET /`, `POST /`,
  `PATCH /:id` at line 133, `DELETE /:id`, `POST /:id/paths`,
  `DELETE /:id/paths/:pathId`, `GET /:id/focus-report`).
- No `project_updated`/`created`/`deleted` broadcast exists in the
  `WSMessage` union (`client/src/lib/types.ts`) today — confirmed union list
  ends at `monitors_updated`.
- `isSessionAwaitingInput`/`effectiveSessionStatus` exist exactly as cited,
  at `client/src/lib/types.ts:806`/`:863` (predicate bodies confirmed).
- `isPrimaryAwaitingReason` exists in `KanbanBoard.tsx` (as a local const at
  line 513, not 574-627 as loosely implied by proximity — the plan's DnD
  line range ~574-627 is the drag handlers specifically, which are correct;
  the awaiting-reason carve-out itself lives a bit earlier in the file).
- `SessionCard.tsx` uses `useTranslation(["kanban", "plan"])` at line 195 exactly as cited.
- `Sidebar.tsx`'s `NAV_KEYS` and `App.tsx`'s `<Route>` list are exactly as
  described, with Dashboard first — the plan's "right after Dashboard"
  placement for `/wip` is a real, achievable insertion point.
- `client/src/lib/projectOrder.ts` (the existing localStorage-only project
  order) exists exactly as described, confirming the plan's precedent
  ("this plan's DnD writes to the API instead of this file's `localStorage`
  call") is a real, current behavior being changed only for WIP, not touched
  elsewhere.
- No `client/src/lib/projectLookup.ts` or `client/src/lib/wipQueue.ts` exist
  yet (both are net-new per the plan) — confirmed absent.

**One inaccuracy worth flagging (non-blocking, does not change the plan):**
the plan's precedent for the new bulk-endpoint/broadcast pattern —
`server/routes/monitors.js` (`PUT /api/monitors` → `monitors_updated`
broadcast) — is described as "already-merged." It is not: `git log` shows no
commit for it, and `git status` shows `server/routes/monitors.js`,
`server/__tests__/monitors.test.js` as untracked, plus uncommitted
modifications to `server/db.js`, `server/index.js`,
`client/src/lib/types.ts`, `client/src/lib/api.ts`,
`client/src/lib/monitorGroups.ts`, and `client/src/pages/KanbanBoard.tsx`
already sitting in the working tree for that feature. The pattern is real
and fully wired (`server/index.js:71,111` mounts it), so it's a valid
architectural precedent to build against — but it is uncommitted
work-in-progress, not a merged, stable baseline. This matters because the
WIP plan's own line-number citations for `KanbanBoard.tsx`,
`server/db.js`, and `client/src/lib/types.ts` are only accurate against
*this exact working tree* (i.e., they already reflect the in-flight
monitor-groups diff); if that work is committed, reworked, or reverted
before WIP build starts, several of the plan's `~line` references will
drift, and — more importantly — WIP's own refactor of
`KanbanBoard.tsx`'s cwd→project join sites would be landing on top of an
already-modified, not-yet-committed version of the same file. Recommended
assumption: the monitor-groups change set should be committed (as its own,
separate change) before the WIP build begins, so WIP's diff and its
regression test run (`KanbanBoard.projectsView.test.tsx`) are against a
clean, stable base rather than a moving one.

## Changed files (by layer)
No code has been built yet — this is the **planned** change set from
`technical-plan.md` §3, itemized as net-new files/endpoints or specific edit
sites. (This differs from a normal git-diff/explicit-file review because
nothing here exists on disk under this feature's name yet; verified above
that the plan's "doesn't exist yet" claims are all true today.)

**Backend**
- `server/db.js` — new guarded migration (`projects.priority INTEGER NOT
  NULL DEFAULT 0`), placed after the existing `source` migration; new
  `stmts.setProjectPriority`. No `CREATE TABLE projects` edit.
- `server/routes/projects.js` — new `PUT /reorder` route (bulk dense-rank
  persistence + `project_updated` broadcast), placed after the existing
  `PATCH /:id` handler.

**Frontend**
- `client/src/lib/types.ts` — add `Project.priority`, new
  `ProjectPriorityUpdatedPayload`, add `"project_updated"` to the
  `WSMessage` union (additive only).
- `client/src/lib/api.ts` — add `api.projects.reorder(order)`.
- **New** `client/src/lib/projectLookup.ts` — extracted cwd→project join
  (`buildCwdProjectIndex`, `projectForSession`).
- **New** `client/src/lib/wipQueue.ts` — pure `isWipMember`,
  `sortWipQueue`, `assignToColumns`.
- **New** `client/src/components/WipSessionCard.tsx` — wraps `SessionCard`
  unmodified; `SessionCard.tsx` itself gets zero edits.
- **New** `client/src/pages/WIP.tsx` — the page itself (fetch, `eventBus`
  subscription, `ResizeObserver`, column rendering).
- **New** `client/src/components/WipPrioritySidecar.tsx` — collapsible
  drag-reorder panel, committing via `api.projects.reorder`.
- `client/src/components/Sidebar.tsx` — new `NAV_KEYS` entry (`/wip`,
  right after Dashboard).
- `client/src/App.tsx` — new `<Route path="wip">`.
- `client/src/i18n/locales/{en,vi,zh,ko}/nav.json` + new `wip.json` per
  locale — new keys in all four locales in the same change.
- `client/src/pages/KanbanBoard.tsx` — **refactor** (not just an addition):
  its two inline cwd→project join sites replaced with calls into the new
  `projectLookup.ts`. This is the one edit to an existing, already-tested
  surface in the whole change set.

**Database / migration**
- Additive column (`projects.priority`, default 0, guarded `ALTER TABLE`
  idiom identical in shape to the existing `source` migration) — no
  destructive change, no backfill needed.

**Tests changed in this set**
- None exist yet (pre-build). Planned per §6/§8: server —
  `projects.test.js` extension (priority default, reorder happy-path/404/
  400/broadcast shape) + unmodified re-run of `session-liveness.test.js`.
  Client — new `wipQueue.test.ts`, `projectLookup.test.ts`,
  `sessionSurfaceParity.test.ts` (new cross-consumer parity guard, per §5),
  new `WIP.test.tsx`; a new `"WIP"` case added to
  `screens.snapshot.test.tsx`; unmodified re-runs of
  `KanbanBoard.projectsView.test.tsx`, `SessionCard.test.tsx`,
  `SessionCard.focus.test.tsx` as regression proof of the extraction/fork.

**Config / other**
- Docs sync obligated by CLAUDE.md's `update-project-docs`:
  `docs/DATABASE.md` (new column + explicit broadcast carve-out note),
  `docs/API.md` (new endpoint section), `ARCHITECTURE.md`, `README.md`
  (+CN/KO/VN), `server/README.md`, `client/README.md`, `wiki/`.
- File-header audit: every new file must carry the required header +
  `@author Son Nguyen <hoangson091104@gmail.com>` line
  (`.claude/skills/file-headers/scripts/check-headers.sh`).

## Surfaces / features touched
- **New page/route**: `/wip` (`WIP.tsx`) — a fourth top-level consumer of
  session data alongside Kanban Board (`/kanban`), Focus List (`/focus`),
  and Focus Calendar (`/focus-calendar`).
- **`projects` domain**: new persisted `priority` field, new bulk-reorder
  endpoint, new live broadcast channel scoped only to that one field.
- **Shared session-status predicates**: `isSessionAwaitingInput`,
  `effectiveSessionStatus`, and the primary-awaiting-reason carve-out
  (`isPrimaryAwaitingReason`/`sessionAwaitingReason`) — consumed, not
  redefined, by the new `wipQueue.sortWipQueue`.
- **Shared cwd→project join**: extracted out of `KanbanBoard.tsx` into
  `projectLookup.ts` and re-consumed by both Kanban (refactored) and WIP
  (new) — this is the one place existing, shipped behavior (Kanban's
  Projects view and Sessions/Agents view grouping) is directly at risk of
  regressing from a refactor, not just a new-page addition.
- **`SessionCard` render surface**: explicitly NOT edited — forked instead
  into `WipSessionCard.tsx`. Kanban's card rendering has zero code-path
  overlap with the new card.
- **Native HTML5 drag-and-drop**: a second consumer of the pattern
  hand-rolled in `KanbanBoard.tsx` (project-priority sidecar reorder,
  distinct from Kanban's own column-reorder drag).
- **Nav/i18n surface**: new nav entry in all four locales, new `wip.json`
  namespace per locale.

## Variant relevance
Yes — this project's #1 recurring drift shape (per `pm-plan.md`'s
recurrence diagnosis, citing the Focus List/Calendar fidelity gap from two
days ago, even though no formal `PROJECT-CONTEXT.md` defect catalog exists
to assign it a catalog id) is exactly in play here: **multiple independent
render/consumer surfaces that must derive "is this session awaiting input"
and "which project does this session belong to" identically.** WIP is
explicitly the fourth such consumer (Kanban, Focus List, Focus Calendar,
now WIP). The technical plan's whole §5 ("single-source-of-truth
guardrail") exists specifically to close this variant-consistency risk
structurally rather than leave it to code review:
- Reuse, don't duplicate: `isSessionAwaitingInput`/`effectiveSessionStatus`
  imported as-is, no new "is this session waiting" predicate for WIP.
- Extract, don't copy: `projectLookup.ts` is the single join, and
  `KanbanBoard.tsx` is refactored to use it (not left with a second,
  subtly-different inline join).
- Fork, don't edit: `WipSessionCard.tsx` is new; `SessionCard.tsx` gets
  zero edits, so Kanban's card rendering can't drift from this change.
- A new standing cross-consumer parity test
  (`sessionSurfaceParity.test.ts`) is the plan's explicit answer to "how do
  we durably prevent this drift going forward," not just a one-time review
  note.

## Test-invariants at risk
- [ ] **Cross-consumer/variant consistency** (this project's #1 recurring
      defect shape, per `pm-plan.md`'s recurrence diagnosis — no formal
      catalog id exists, so this is PM-established guidance treated as
      binding for this cycle, not a pre-existing catalog entry) — directly
      touched. Concretely: does WIP's "awaiting" partition match Kanban's
      own primary-awaiting-reason-aware bucketing for every fixture
      session? Does `projectLookup.projectForSession` resolve to the same
      project Kanban's own join resolves to, for every fixture session,
      after the refactor? This is the exact thing
      `sessionSurfaceParity.test.ts` is specified to assert.
- [ ] **Refactor-preserves-behavior (regression, not just addition)** — the
      `KanbanBoard.tsx` inline-join extraction is a real edit to a shipped,
      already-tested surface (Kanban's Projects view column contents,
      Sessions/Agents view grouping). `KanbanBoard.projectsView.test.tsx`
      must pass unmodified both immediately after the extraction (step 4)
      and again at the end, per the plan's own sequencing.
- [ ] **Priority-direction convention integrity** — `priority` is
      dense-rank, lower-value-is-higher, defaulting to 0. This convention
      must agree across three independent places: the DB default, the
      `sortWipQueue` comparator direction, and the sidecar's initial
      (undragged) display order. The plan itself names this as a top risk
      (§7) and wants it pinned in unit tests before any visual check.
- [ ] **Round-trip integrity of the new persisted field** — a project's
      `priority`, once dragged, must survive: (a) the `PUT /reorder` write,
      (b) a page refresh (server round-trip), and (c) a second open tab
      receiving the `project_updated` broadcast without re-fetching. The
      migration must also leave every pre-existing project reading
      `priority: 0` with no error (verified via the manual boot check in
      implementation step 1).
- [ ] **Live-membership correctness across both removal paths** — a
      session must leave the WIP queue on both (a) a `session_updated`
      event flipping `status` away from `"active"`, and (b) a distinct
      `session_deleted` event — the plan explicitly calls out these as two
      separate code paths that must each be proven (Engineer's gotcha #2),
      not one path assumed to cover the other.
- [ ] **No stale/ambiguous broadcast scope creep** — `project_updated` is
      documented as carrying only `{ projects: [{ id, priority }] }` and is
      a deliberate, narrow exception to "project mutations are plain CRUD,
      not broadcast." Test coverage should confirm no other project
      mutation (rename, path add/remove, delete) triggers this broadcast,
      so the documented carve-out doesn't silently widen.

## Stated intent / acceptance
From `request-brief.md`'s extracted acceptance sketch (Sara gave no formal
"done when…" test) plus `technical-plan.md` §8 Definition of Done:
- `/wip` page exists, reachable via nav, named "WIP."
- Queue = `status === "active"` sessions only; leaving active (completed/
  error) or `session_deleted` removes the card live, no refresh.
- Awaiting-input sessions always sort above non-awaiting, live.
- Ties among awaiting sessions (and ordering among non-awaiting sessions)
  broken by project `priority`, set via sidecar drag-and-drop.
- Cards are the existing `SessionCard`, wrapped (not edited) with the
  project name made visually more prominent — explicitly flagged as a
  first-pass design guess with no mockup, needing Sara's async sign-off on
  a before/after screenshot; not a build blocker.
- Responsive 1→2→3-column priority-fill layout, driven by the queue
  container's own measured width (`ResizeObserver`), not the viewport —
  this distinction matters because the sidecar can shrink the queue
  independent of window size.
- Everything (membership, sort, priority changes from any tab) is
  WebSocket-live; no polling/manual refresh.
- Nav placement (right after Dashboard), sidecar default-collapsed +
  queue-only-by-default project list, and the card's prominence treatment
  are all explicitly flagged in the plan as build-now defaults pending
  Sara's async confirmation — not yet her sign-off, shippable in that
  state per PM's open items.

## Open questions
**Blocking (cannot plan tests):**
- None. The plan is internally consistent, fully reconciles the four
  supporting docs against `pm-plan.md`'s decisions, and every "this doesn't
  exist yet" claim it makes checks out against the current repo state
  (expected and correct for a pre-build technical plan).

**Non-blocking (proceeding on assumption):**
- The `server/routes/monitors.js` precedent the plan cites as
  "already-merged" is actually uncommitted, in-flight work in the current
  working tree (confirmed via `git log`/`git status`) → assumption: that
  change set gets committed on its own before WIP's build starts, so
  WIP's `KanbanBoard.tsx` refactor and regression-test run land against a
  stable, clean base rather than a second uncommitted feature's diff. If
  the monitor-groups work is instead reworked or reverted first, the
  plan's cited `~line` references for `server/db.js`,
  `client/src/lib/types.ts`, and `KanbanBoard.tsx` will need re-checking,
  but this changes only citation accuracy, not the plan's substance.
- The "project name more prominent" visual treatment has no mockup and is
  explicitly a first-pass guess pending Sara's sign-off → assumption:
  build it now per the plan's description, but the evaluation team should
  not treat any particular font-weight/size choice as a hard pass/fail
  acceptance criterion — only that a project-name element is visually more
  prominent than in the base `SessionCard`, per the plan's own framing.
- Nav placement (`/wip` right after Dashboard) and sidecar defaults
  (collapsed, queue-scoped project list) are stated as build-now defaults,
  not final Sara-confirmed decisions → assumption: test them as specified
  in the plan; do not fail a test run over their eventual reversal, since
  the plan itself frames these as pending async confirmation, not settled.
- Empty-array behavior for `PUT /api/projects/reorder` is left as "pick
  one and assert it" (400 vs. documented no-op) by the plan itself → the
  QA test-design step should pick 400 (consistent with this file's
  existing validation-error conventions) unless the build team documents
  otherwise, and assert whichever is actually implemented.

## Verdict
**READY**
