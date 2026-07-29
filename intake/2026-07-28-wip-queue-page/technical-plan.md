# Technical Plan: WIP (work-in-progress) queue page

Status: ready for build. Classification: `new-feature` (PM-confirmed). This
plan reconciles `supporting/architect.md`, `supporting/engineer.md`,
`supporting/qa.md`, and `supporting/product-owner.md` against `pm-plan.md`'s
final decisions. No `PROJECT-CONTEXT.md`/defect catalog exists for this
repo, so the durable-fix discipline named below is PM-established guidance
for this cycle, not a pre-existing catalog entry — treated here as binding
for this build regardless.

## 1. Objective

Build a new top-level **WIP** page: a single, live, priority-ordered queue
of session cards, scoped to `status === "active"` sessions only, where
sessions currently awaiting Sara's input always sort above every session
that isn't, ties among those (and ordering among non-awaiting sessions)
broken by a new per-project `priority` value she sets by dragging projects
in a collapsible right-hand sidecar. Cards are the existing session card,
wrapped (not edited) to make the project name visually prominent. Layout is
a responsive, priority-ordered 1→2→3-column fill (column 1 filled
top-to-bottom before column 2 starts), driven by the container's own
measured width, not the viewport. Everything — queue membership, sort
order, and priority changes made in any tab — is WebSocket-live, no
polling, no manual refresh. End state: a fourth independent consumer of the
`Session`/`isSessionAwaitingInput`/`effectiveSessionStatus` surface (after
Kanban, Focus List, Focus Calendar) that reuses every existing predicate and
extracts a shared cwd→project join once, rather than re-deriving any of it —
per PM's explicit standing-discipline callout, this is the same shape as the
Focus List/Calendar drift two days ago, one consumer later.

## 2. Recommended approach

- **Schema**: additive `projects.priority INTEGER NOT NULL DEFAULT 0`
  (dense rank, **lower value = higher priority**, rank 0 = top), guarded
  `ALTER TABLE` migration identical in shape to the existing `source`
  column migration. No column on `sessions` — membership/priority lookup is
  derived via the existing `cwd` → `project_paths` join, mirroring the
  documented "no `project_id` on sessions, derive by join" convention
  already in `server/db.js:409-413`.
- **API**: a new bulk `PUT /api/projects/reorder` endpoint (no existing
  endpoint does bulk-array-order persistence in this codebase — this is
  first-of-its-kind, modeled directly on the already-merged
  `server/routes/monitors.js` GET/PUT-full-state-broadcast pattern, the
  closest real precedent in this repo for "small shared cross-client
  config, persisted server-side, broadcast on write").
- **Live pipeline**: a new `project_updated` WebSocket message, additive to
  the `WSMessage` union, broadcasting only `{ projects: [{ id, priority }] }`
  — deliberately scoped to the priority field only, not a general "make all
  project CRUD live" change. This is a documented, deliberate exception to
  today's "project mutations are plain CRUD, not broadcast" behavior
  (confirmed: no `project_updated`/`created`/`deleted` broadcast exists
  anywhere today), justified by Sara's explicit "this will all be live" and
  the real cross-tab-drift risk the Architect flagged. `docs/DATABASE.md`
  must carry an explicit carve-out note, not a silent special case.
- **Queue computation**: client-derived, not server-computed. The WIP page
  fetches active sessions + all projects once, keeps both in memory, and
  recomputes sort/columns in a `useMemo` off WS events — exactly Kanban's
  existing merge-on-event shape. Server-side sorting was rejected (Architect
  §3B-2) because it would require a second, Node-side reimplementation of
  `isSessionAwaitingInput`, which is precisely the two-copies-drift shape
  this whole plan exists to avoid.
- **Column layout**: a small pure JS function does contiguous-chunk column
  assignment (col 1 gets the top `ceil(n/columnCount)` priority-sorted
  items, then col 2, etc.) — not CSS `column-count`, not CSS Grid
  `auto-flow`. Column count is driven by a `ResizeObserver` on the queue
  container's own width (not `window`/viewport breakpoints), because the
  sidecar can shrink the queue independent of window size. Reuses Tailwind's
  existing `md` (768px) / `lg` (1024px) pixel values as the concrete
  thresholds: `<768` → 1 col, `768–1023` → 2 cols, `≥1024` → 3 cols.
- **`SessionCard` — overridden decision, stated explicitly.** The Architect's
  own analysis (§3D-1) recommended an additive `emphasizeProject?: boolean`
  prop on `SessionCard.tsx` itself as the default-off, single-source-of-truth
  option. **This plan overrides that recommendation** in favor of forking a
  new `WipSessionCard.tsx` wrapper, per PM's explicit decision (`pm-plan.md`
  §6.3) and the Engineer's and Product Owner's independent, converging
  recommendation for the same option. Reasoning for the override: (a) this
  is the exact "fork vs. edit a shared render surface" fork the Focus
  List/Calendar cycle's DEC-1..6 mandate already resolved once — hold the
  same discipline rather than re-litigate it; (b) zero blast radius to
  Kanban's existing, already-passing `SessionCard`/Kanban snapshot tests,
  vs. a real (if small) risk that a conditional prop still perturbs shared
  layout in ways that quietly drift Kanban's snapshot; (c) "project name
  more prominent" is explicitly scoped by Sara to the WIP card, not a
  request to change Kanban's cards too. The tradeoff (a second place to
  update if this same prominence treatment is ever wanted elsewhere) is
  accepted as a deliberate, `git log`-visible future decision, not an
  accident.
- **Drag-and-drop**: reuse the existing native HTML5 DnD pattern already
  hand-rolled in `KanbanBoard.tsx` (`handleColumnDragStart`/`DragOver`/
  `DragEnd`, ~574-627) — no new dependency. Only change from that precedent:
  persistence target is the new `PUT /api/projects/reorder` endpoint
  instead of `projectOrder.ts`'s `localStorage` write.

## 3. Change set

### Server — schema & persistence
- `server/db.js`
  - New guarded migration block, placed immediately after the existing
    `source` column migration (~:977-981), same try/`SELECT ... LIMIT 1`/
    catch(`ALTER TABLE`) idiom:
    ```js
    try {
      db.prepare("SELECT priority FROM projects LIMIT 1").get();
    } catch {
      db.prepare("ALTER TABLE projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 0").run();
    }
    ```
  - New `stmts.setProjectPriority` (near `renameProject`, ~:1814):
    `db.prepare("UPDATE projects SET priority = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")`.
  - No change to `CREATE TABLE projects` (~:414-419) itself — stays
    historical, per the project's own migration convention; no change to
    `stmts.listProjects`/`getProject` (`SELECT *`, already flows the new
    column through once it exists).

### Server — API & broadcast
- `server/routes/projects.js`
  - New `router.put("/reorder", ...)`, placed after the existing
    `PATCH /:id` handler (~:146). Body: `{ order: string[] }` — project ids
    in top-to-bottom priority order (index 0 = highest priority = rank 0).
    Validation (matching this file's existing error shape): `order` must be
    a non-empty array of strings; every id must resolve via
    `stmts.getProject`, else `404 NOT_FOUND` naming the missing id;
    duplicate ids → `400 INVALID_INPUT`. Inside one `db.transaction`
    (mirrors the existing `POST /` transaction at ~:122-125), call
    `stmts.setProjectPriority.run(index, id)` for every id. Respond with
    `{ projects: [{ id, priority }] }` and call
    `broadcast("project_updated", { projects: [...] })`.

### Client — types & API client
- `client/src/lib/types.ts`
  - `Project` interface (~:1528-1546): add
    `/** Dense rank set via the WIP sidecar; lower = higher priority (0 =
    highest). Defaults to 0 until explicitly reordered. */ priority: number;`
  - New `ProjectPriorityUpdatedPayload` interface (near
    `SessionDeletedPayload`, ~:1266): `{ projects: Array<{ id: string;
    priority: number }> }`.
  - `WSMessage` union (~:2116-2149): add `"project_updated"` to the `type`
    union and `ProjectPriorityUpdatedPayload` to the `data` union, with a
    doc-comment mapping entry alongside the existing
    `monitors_updated → MonitorLayoutPayload` line. Type values only ever
    grow, never rename — this is purely additive.
- `client/src/lib/api.ts`
  - `api.projects` block (~:2028-2062): add
    `reorder: (order: string[]) => request<{ projects: Array<{ id: string; priority: number }> }>("/projects/reorder", { method: "PUT", body: JSON.stringify({ order }) })`.

### Client — shared logic extraction (the guardrail piece)
- **New** `client/src/lib/projectLookup.ts` — extracted, single-source
  cwd→project join:
  - `buildCwdProjectIndex(projects: Project[]): Map<string, Project>` —
    maps every mapped `cwd` to its owning `Project`.
  - `projectForSession(session: Session, index: Map<string, Project>): Project | undefined`.
  - This replaces the inline join currently hand-rolled in
    `KanbanBoard.tsx` (~:492-493 for the Sessions/Agents views' grouping,
    ~:707-712 for the Projects view's per-project cwd list). **Refactor
    `KanbanBoard.tsx` to import and use this helper instead of its inline
    logic** — this is the "extract, not copy" mandate: do not leave
    Kanban's inline join in place while writing a second, WIP-only version.

### Client — pure sort/layout logic
- **New** `client/src/lib/wipQueue.ts`:
  - `isWipMember(session: Session): boolean` — `session.status === "active"`.
    Single place membership is defined so the initial fetch filter and the
    live-merge filter can't drift from each other.
  - `sortWipQueue(sessions: Session[], projectIndex: Map<string, Project>): Session[]`
    — primary: `isSessionAwaitingInput(session)` (imported from
    `client/src/lib/types.ts:806`, not re-derived) descending; secondary:
    `projectForSession(session, projectIndex)?.priority ?? 0` ascending
    (lower value wins); tertiary: `last_activity` (fallback
    `started_at`) descending — most-recent-activity-first, per PM's
    auto-decided default, applied uniformly to same-priority awaiting ties
    *and* to ordering among non-awaiting sessions. (Corrected 2026-07-29 per
    test-plan.md Implementation step 2 / build-task-list.md Task 1:
    `Session.updated_at` does not exist on `client/src/lib/types.ts`'s
    `Session` interface — the only recency field is `last_activity`,
    line 698.)
  - Must apply the same "primary awaiting reason" carve-out Kanban already
    applies (`sessionAwaitingReason`/`isPrimaryAwaitingReason`,
    `types.ts:884-887` and `KanbanBoard.tsx`'s bucketing use of it) —
    reuse that exact logic, do not redefine "awaiting" more narrowly or
    broadly for WIP.
  - `assignToColumns<T>(sortedItems: T[], columnCount: 1 | 2 | 3): T[][]` —
    contiguous-chunk fill: column 1 gets the first `Math.ceil(n / columnCount)`
    items in sorted order, column 2 the next chunk, etc. Pure, no DOM.

### Client — card variant (fork, not edit)
- **New** `client/src/components/WipSessionCard.tsx` — wraps `<SessionCard>`
  (imported unmodified from `client/src/components/SessionCard.tsx`),
  layering a visually-prominent project-name header above/around it using
  `projectForSession`'s lookup, styled to read as part of the same card
  (not a floating separate element). `SessionCard.tsx` itself receives
  **zero edits**. Flag explicitly in the PR: the concrete prominence
  treatment is a first-pass design guess (no mockup exists per the PO's
  finding) and needs Sara's explicit thumbs-up on a before/after screenshot
  before being considered final — ship behind this understanding, don't
  block the rest of the build on it.

### Client — page, sidecar, nav, i18n
- **New** `client/src/pages/WIP.tsx` — fetches
  `api.sessions.list({ status: "active", limit: 500 })` and
  `api.projects.list()` once on mount; subscribes via `eventBus` (same
  pattern as `KanbanBoard.tsx` ~:425-462) to `session_created`,
  `session_updated`, `session_deleted`, and the new `project_updated`;
  merges pushed rows into local state (filter-out on
  `!isWipMember(session)`, remove-by-id on `session_deleted`, patch
  `priority` in place on `project_updated`); measures its own queue
  container via `ResizeObserver` (same established pattern as
  `Dashboard.tsx:1000`/`CcConfig.tsx:711`/`Sidebar.tsx:237`); computes
  `assignToColumns(sortWipQueue(...), columnCount)` in a `useMemo`; renders
  N `flex flex-col` columns of `<WipSessionCard>`.
- **New** `client/src/components/WipPrioritySidecar.tsx` — collapsible
  right-hand panel (collapsed by default per PO/PM), listing projects
  currently represented in the queue by default with a "show all projects"
  toggle (both per PM's auto-decided defaults), native HTML5 DnD reorder
  copied from `KanbanBoard.tsx`'s `handleColumnDragStart`/`DragOver`/
  `DragEnd` (~:574-627), committing on drop via `api.projects.reorder(...)`.
- `client/src/components/Sidebar.tsx` — add to `NAV_KEYS` (~:98-115):
  `{ to: "/wip", icon: <TBD, pick an unused lucide icon>, key: "nav:wip" }`,
  placed **right after Dashboard** (before `/projects`), with an inline
  comment matching this file's existing convention
  (`// Right after Dashboard — primary daily-use "who needs me" view;
  placement default per technical-plan.md, pending Sara's confirm`). This
  is a build-now default per PM's open item, not a silent final decision.
- `client/src/App.tsx` — add `import { WIP } from "./pages/WIP";` (~:73-86)
  and `<Route path="wip" element={<WIP />} />` (~:107-124).
- `client/src/i18n/locales/{en,vi,zh,ko}/nav.json` — add `nav:wip` in all
  four locales in the same change (not just `en`); new
  `{en,vi,zh,ko}/wip.json` namespace for page-specific strings, following
  the existing per-page namespace convention (`SessionCard.tsx:195`'s
  `useTranslation(["kanban", "plan"])` pattern).

### Docs (per CLAUDE.md's `update-project-docs` obligation)
- `docs/DATABASE.md` — `projects` columns table: add `priority` row;
  update the "no WebSocket broadcast" line to carry an explicit carve-out
  ("`priority` changes broadcast `project_updated`; all other project
  mutations remain plain CRUD, not broadcast — see technical-plan.md").
- `docs/API.md` — new `PUT /api/projects/reorder` section alongside the
  existing `/api/projects/*` block.
- `ARCHITECTURE.md`, `README.md` (+ CN/KO/VN), `server/README.md`,
  `client/README.md`, `wiki/` — new nav entry, new DB column, new WS
  message type.

## 4. Implementation steps

1. **Schema/migration** — add the guarded `priority` column migration to
   `server/db.js`. Verify by booting the server against the existing dev DB
   and confirming `GET /api/projects` echoes `priority: 0` for every
   existing row with no error.
2. **API/broadcast** — add `stmts.setProjectPriority`, the
   `PUT /api/projects/reorder` route, and the `project_updated` broadcast.
   Verify with a manual `curl`/Postman round-trip before any client code
   depends on the exact response shape.
3. **Client types/API client** — add `Project.priority`,
   `ProjectPriorityUpdatedPayload`, the `WSMessage` union entry, and
   `api.projects.reorder`. This is the hard dependency gate: do not start
   step 4+ against a guessed shape.
4. **Shared query logic extraction** — write `client/src/lib/
   projectLookup.ts` and refactor `KanbanBoard.tsx`'s two inline join sites
   (~:492-493, ~:707-712) to use it. Run
   `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx`
   immediately after this step, before writing anything WIP-specific — it
   must still pass unmodified, proving the extraction preserved Kanban's
   existing behavior exactly.
5. **Pure sort/column-fill module** — write `client/src/lib/wipQueue.ts`
   (`isWipMember`, `sortWipQueue`, `assignToColumns`) and its unit tests
   (§6.1/§6.2) before any React page exists. This is the cheapest place to
   pin the tertiary-sort and column-fill decisions as executable spec.
6. **`WipSessionCard`** — build the fork, wrapping `SessionCard` unmodified.
   Can happen in parallel with step 5 once step 4's lookup helper exists.
7. **`WIP.tsx` page + nav/route/i18n** — wire steps 3-6 together: fetch,
   `eventBus` subscription, `ResizeObserver`, column rendering, nav entry,
   route, i18n keys in all four locales.
8. **Sidecar DnD** — build `WipPrioritySidecar.tsx`, copying Kanban's native
   HTML5 DnD handlers, wiring drop-commit to `api.projects.reorder`.
9. **Tests** — fill in the remaining specs from §6 (server priority/reorder
   coverage, WIP page WS-liveness tests, snapshot entry, the cross-consumer
   parity test). Some of this overlaps steps 4-8 by necessity (unit tests
   for pure functions land with the functions); this step is where the
   *page-level* and *parity* tests land, once the page and sidecar exist.
10. **Docs sync** — last, once route path, DB column, endpoint shape, and
    WS message usage are all final facts, not moving targets.

## 5. Single-source-of-truth guardrail (binding, not optional)

This is a fourth independent consumer of `Session`/`isSessionAwaitingInput`/
`effectiveSessionStatus`/cwd-project derivation (after Kanban, Focus List,
Focus Calendar). Per PM's explicit standing-discipline callout — this is
the same recurrence shape as the Focus List/Calendar fidelity gap two days
ago — every leg of this plan routes through a single shared surface instead
of a parallel one:

- **Reuse, don't duplicate**: `isSessionAwaitingInput` and
  `effectiveSessionStatus` (`client/src/lib/types.ts:806`/`:863`) are
  imported and used exactly as-is by `wipQueue.sortWipQueue`. No new
  "is this session waiting" predicate is written for WIP, including the
  primary-awaiting-reason carve-out Kanban already applies.
- **Extract, don't copy**: the cwd→project join is extracted once into
  `client/src/lib/projectLookup.ts` and `KanbanBoard.tsx`'s existing inline
  join sites are refactored to use it, rather than the WIP page growing its
  own second, subtly-different join (e.g. differing on trailing-slash
  handling). Step 4 explicitly re-runs Kanban's own Projects-view test
  immediately after this refactor to catch any behavior change before
  building on top of it.
- **Fork, don't edit**: `SessionCard.tsx` is not touched. `WipSessionCard.tsx`
  is a new, separate component with zero blast radius to Kanban's or any
  other existing consumer's snapshot/unit tests.
- **Cross-consumer parity test, not just per-page tests**: add
  `client/src/lib/__tests__/sessionSurfaceParity.test.ts` — a new,
  standing test (analogous to the Focus List/Calendar consistency
  assertions already in `client/src/components/__tests__/
  FocusReportModal.test.tsx`) that, given one shared fixture set of
  sessions + projects, asserts: (a) `wipQueue`'s "awaiting" partition
  matches Kanban's own `isPrimaryAwaitingReason`-aware bucketing for every
  fixture session; (b) `projectLookup.projectForSession` resolves to the
  same project Kanban's own (now-shared) join resolves to for every
  fixture session. This is the test that would have caught the Focus
  List/Calendar drift two days ago had it existed then for that surface;
  it is the concrete deliverable that turns this cycle's "reuse it
  correctly" discipline into an enforced, standing check rather than a
  one-time code review observation.

## 6. Testing & verification

Run `npm run test:server && npm run test:client` first, unmodified, to
establish a clean baseline (QA's explicit recommendation) before starting.

### Server (`npm run test:server`)
1. Extend `server/__tests__/projects.test.js` (or a sibling file): fresh DB
   returns `priority: 0` for pre-existing/newly-created projects;
   `PUT /api/projects/reorder` happy path sets dense ranks 0..N-1 matching
   array order; unknown id → 404; duplicate id → 400; empty array → 400 (or
   documented no-op, pick one and assert it); response and broadcast both
   carry `{ projects: [{ id, priority }] }`.
2. Re-run `server/__tests__/session-liveness.test.js` unmodified as a
   regression guard — confirms the abandonment/completion broadcast
   contract WIP's removal logic depends on (`session_updated` with a new
   `status`, no separate delete event for lifecycle transitions) hasn't
   changed.

### Client (`npm run test:client`)
1. `client/src/lib/__tests__/wipQueue.test.ts` — `sortWipQueue`: awaiting
   sessions always above non-awaiting regardless of priority; higher
   project-priority (lower numeric value) wins ties among awaiting
   sessions; most-recent-activity tertiary order for same-priority
   awaiting ties and for non-awaiting ordering; a non-`active` session
   never appears in output; the primary-awaiting-reason carve-out
   excludes subagent/shell-wait sessions from the "awaiting" partition
   the same way Kanban does. `assignToColumns`: column 1 always contains
   the highest-priority item at row 0; correct 1/2/3-column splits
   including uneven remainders and 0/1-item edge cases.
2. `client/src/lib/__tests__/projectLookup.test.ts` — new, direct unit
   coverage of the extracted join (didn't exist before this feature).
3. `client/src/lib/__tests__/sessionSurfaceParity.test.ts` — the
   cross-consumer parity test described in §5. Non-negotiable per PM's
   standing-discipline mandate.
4. `client/src/pages/__tests__/WIP.test.tsx` — mocked `eventBus`/API
   pattern (same as `screens.snapshot.test.tsx`/Kanban's own subscription
   tests): `session_created` inserts in correctly-sorted position;
   `session_updated` flipping status off `"active"` removes the card with
   no refetch; `session_deleted` also removes its card (distinct test from
   the status-flip case — both removal paths are real and must each be
   proven, per Engineer's gotcha #2); `session_updated` setting
   `awaiting_input_since` live-reorders the card to the top of its
   priority tier; `project_updated` reorders the queue without any session
   event firing; sidecar drag commits call `api.projects.reorder` with the
   expected id order.
5. `client/src/pages/__tests__/screens.snapshot.test.tsx` — add a `"WIP"`
   case following the file's own documented precedent for how
   `FocusCalendarBoard` was added. Run the full suite before AND after the
   `Sidebar.tsx` nav-entry change; review (never blindly `-u`) any diff in
   other screens' snapshots that render sidebar chrome.
6. Re-run `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx`
   and `client/src/components/__tests__/SessionCard.test.tsx`/
   `SessionCard.focus.test.tsx` unmodified — regression proof that the
   `projectLookup` extraction and the `WipSessionCard` fork left Kanban and
   the shared card exactly as they were.

### Manual verification (dev server, `npm run dev`)
Follow QA's §1 script: seed ≥4 active sessions across ≥2 differently
prioritized projects (≥2 awaiting input), plus one terminal-state session
that must not appear; confirm membership, awaiting-first sort, priority
tiebreak, column-count/fill behavior at each breakpoint (including with the
sidecar open, since that's the one place a viewport-only trigger would have
silently misbehaved), live sidecar drag reorder in the same tab and in a
second open tab, and live removal on session end/abandon with no refresh.

## 7. Risks & rollback

- **Third/fourth-consumer drift** (addressed structurally in §5, not just
  flagged) — residual risk is someone bypassing the shared helpers in a
  future edit; the parity test in §5 is the durable guard against that,
  not just this PR's code review.
- **Sort thrash under WS event bursts** — if many sessions flip
  awaiting-input near-simultaneously, naive re-sort-on-every-event could
  visibly reorder rapidly. Mitigate with the same debounce window Kanban
  already uses (~300ms) before recomputing sort/columns, rather than
  inventing a new timing strategy.
- **Priority convention inversion** — `priority` is dense-rank,
  lower-is-higher; this must stay consistent across the DB default (0),
  `sortWipQueue`'s comparator direction, and the sidecar's initial
  (undragged) display order. Get this pinned in the unit tests (§6.1)
  before it ships, not discovered visually.
- **Cross-tab priority drift** — the new `project_updated` broadcast closes
  this, but only for `priority`; every other project mutation (rename,
  path add/remove, delete) is still silent by design. Don't let scope creep
  into "broadcast everything" without a separate, explicit decision.
- **Race: drag mid-session-end** — a sidecar drag committing while a
  WS session event fires concurrently. Verify (manual + a timing-sequenced
  test per QA's flag) that the drag's optimistic local state isn't
  clobbered by an incoming re-render, and that the drop's persisted write
  isn't lost.
- **"Project name more prominent" mismatch** — zero mockup exists; the
  shipped `WipSessionCard` treatment is a first-pass guess. Get Sara's
  explicit sign-off on a before/after screenshot before treating this as
  final — don't let "any font-weight change" silently count as done.
- **Rollback**: every piece here is additive — a new column with a safe
  default, a new endpoint, a new WS message type, new files, and one small,
  test-verified refactor of `KanbanBoard.tsx`'s join call sites. Rollback
  is: revert the nav/route entry (page becomes unreachable, zero user
  impact), and/or revert the `KanbanBoard.tsx` refactor commit in isolation
  if it's ever suspected (it's covered by its own regression test, so this
  should not be needed). The `priority` column can be left in place
  harmlessly if the feature is ever pulled — no destructive migration to
  reverse.

## 8. Definition of Done

- [ ] `npm run test:server` passes, including new coverage for the
      `priority` column default/migration-safety and the
      `PUT /api/projects/reorder` endpoint (success, 404, 400, broadcast).
- [ ] `npm run test:client` passes, including:
  - [ ] `wipQueue.test.ts` (sort + column-fill, all cases in §6).
  - [ ] `projectLookup.test.ts` (new extracted-join coverage).
  - [ ] `sessionSurfaceParity.test.ts` (the cross-consumer parity test —
        non-negotiable per §5).
  - [ ] `WIP.test.tsx` (live add/update/remove via both removal paths,
        priority-driven reorder, sidecar DnD commit).
  - [ ] `screens.snapshot.test.tsx` new "WIP" case, plus a reviewed
        (not blind) diff of every other snapshot touching sidebar chrome.
  - [ ] `KanbanBoard.projectsView.test.tsx`, `SessionCard.test.tsx`,
        `SessionCard.focus.test.tsx` still pass unmodified.
- [ ] Manual verification script (§6, dev server) performed at least once,
      including resize-with-sidecar-open.
- [ ] `SessionCard.tsx` has zero diff in this change set.
- [ ] `project_updated` broadcast and its documented carve-out (priority
      only, not general project CRUD) match `docs/DATABASE.md`'s updated
      text exactly.
- [ ] Nav placement, sidecar scope default, and the project-name-prominence
      visual treatment have each been shown to Sara for explicit
      confirmation (async, non-blocking per PM's open items) — noted in the
      PR description if any ships before her sign-off lands.
- [ ] Docs updated together: `docs/DATABASE.md`, `docs/API.md`,
      `ARCHITECTURE.md`, `README.md` (+ CN/KO/VN), `server/README.md`,
      `client/README.md`, `wiki/`.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` passes —
      every new file (`WIP.tsx`, `WipSessionCard.tsx`,
      `WipPrioritySidecar.tsx`, `wipQueue.ts`, `projectLookup.ts`, new test
      files) carries the required header and
      `@author Son Nguyen <hoangson091104@gmail.com>` line.
- [ ] i18n keys (`nav:wip` + `wip.json` namespace) present in all four
      locales (`en`/`vi`/`zh`/`ko`), not just `en`.
