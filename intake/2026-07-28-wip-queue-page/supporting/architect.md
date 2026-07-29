# Architect evaluation: WIP queue page

No `PROJECT-CONTEXT.md` is configured for this repo, so there is no
project-specific recurring-defect catalog to check this against (confirmed
absent, per the brief). This evaluation is grounded directly in current code
(re-verified, not just carried from `request-source.md`) plus the general
"single source of truth" principle and this repo's own CLAUDE.md bias toward
preserving existing behavior with minimal, reversible, migration-safe diffs.

## 1. Affected subsystems & boundaries

- **Schema/persistence** — `server/db.js`. `projects` table (~line 414-419)
  is `(id, name, created_at, updated_at)` only. Owns the new `priority`
  column. `stmts.listProjects`/`getProject` (~1811-1818) use `SELECT *`, so
  once the column exists it flows through unchanged — no statement rewrite
  needed for reads.
- **API surface** — `server/routes/projects.js`. Owns CRUD for projects
  today (`GET/POST/PATCH/DELETE /api/projects...`, no broadcast on any of
  these — confirmed, see §2). Whichever route accepts a priority write
  (extend `PATCH /:id` vs. a new endpoint) owns validation and persistence
  of the new field.
- **Live pipeline** — `server/websocket.js` (`broadcast(type, data)`,
  :62) + `server/index.js` call sites. Today's session lifecycle emits three
  distinct WS message types that matter for WIP membership, confirmed by
  direct grep (correcting/deepening the source doc's "no explicit
  session_deleted found" note — it exists, just not in `index.js`):
  - `session_updated` on status transitions, including the periodic sweep's
    abandonment path (`server/index.js:952-953`, sets status='abandoned'
    then broadcasts the full row).
  - `session_created` / `session_updated` on ingest (`index.js:639`).
  - `session_deleted` — a **real, separate** message, emitted only from
    `server/routes/sessions.js:581` on hard delete (`DELETE
    /api/sessions/:id`), payload `{ id }` (`SessionDeletedPayload`,
    `types.ts:1266`).
  No `project_updated`/`project_created`/`project_deleted` broadcast exists
  anywhere today (grepped, zero hits) — project CRUD is presently
  request/response only, not pushed live to other tabs/pages.
- **Client state/derivation** — new `client/src/pages/WIP.tsx` (or
  similar), following the `eventBus.subscribe` pattern already used by
  `KanbanBoard.tsx` (~402-462) and `Sessions.tsx`/`Projects.tsx`/
  `SessionDetail.tsx` for `session_created`/`session_updated`/
  `session_deleted`. Owns: active-session membership, awaiting-first sort,
  priority tiebreak, and column assignment.
- **Nav/routing** — `client/src/components/Sidebar.tsx` `NAV_KEYS` (~98-114)
  and `client/src/App.tsx` `<Route>` table (~108-124). Pure additive peer
  entries, same pattern as every existing page.
- **Shared render surface** — `client/src/components/SessionCard.tsx`
  (~554 lines), already consumed by `KanbanBoard.tsx`'s Sessions/Agents
  views. This would become a **third** consumer of the same card alongside
  Kanban and (per the brief) the Focus Calendar board's session data, all
  sourced from the same `Session`/`isSessionAwaitingInput`/
  `effectiveSessionStatus` model in `client/src/lib/types.ts`.
- **DnD mechanism** — no library in `client/` (confirmed, zero `dnd-kit`/
  `react-dnd`/`react-beautiful-dnd` hits). Only hand-rolled native HTML5 DnD
  in `KanbanBoard.tsx` (project-column drag-reorder, ~569-627, and a
  monitor-divider drag, ~629-649), both operating on a **client-only,
  localStorage-persisted** order (`client/src/lib/projectOrder.ts`,
  key `projects-page-order`) — this is the precedent the sidecar would be
  the first case to promote to a real server-side value.
- **Client ordering helper** — `client/src/lib/projectOrder.ts`. Explicitly
  documented in its own header as "purely a personal, per-browser
  arrangement — it has no server-side representation and is never sent to
  the API." The WIP sidecar's priority is a different, semantically new
  thing (a cross-device, tiebreak-driving value), not a relabeling of this.

## 2. Current design

**Priority does not exist.** The only "ordering" today is
`projectOrder.ts`'s localStorage array, consumed by `Projects.tsx` and
`KanbanBoard.tsx`'s Projects view via `applyProjectOrder()`. It never
touches the server, never appears in `GET /api/projects`, and has no
tiebreak semantics — it's purely "what order do the cards visually sit in
on this browser." Nothing today would let two sessions on two different
projects be ranked against each other by a *value*, only by *arbitrary
manual position*.

**Session lifecycle → live UI** already follows one consistent shape:
server mutates `sessions`, broadcasts either `session_created`/
`session_updated` (row included) or `session_deleted` (`{id}` only), and
every current consumer (Kanban, Sessions, Projects, SessionDetail)
subscribes via `eventBus` and either merges the row in place or drops the
id. There is no page that recomputes a *sort* live today, only presence/
absence and field merges — Kanban's "Projects" view reorder is manual drag,
not automatic. The WIP page introduces the first "live automatic re-sort"
requirement in the app.

**Project mutations are not live today.** `routes/projects.js`'s
POST/PATCH/DELETE never call `broadcast(...)`. Every consumer's `useEffect`
watching `session_*` events refetches project aggregates as a side effect
of session changes (e.g. `KanbanBoard.tsx`'s "projects" view, ~439-450), but
a rename/create/delete of a project itself doesn't propagate to a second
open tab until that tab happens to refetch for an unrelated reason. This is
a real, pre-existing gap the priority feature will collide with directly:
if Sara drags in the sidecar in one window while the WIP queue is open in
another, the queue's tiebreak order goes stale with no existing mechanism
to fix it.

**No established single-source-of-truth registry for "priority-like"
values.** Unlike, say, a canonical content registry pattern, this repo's
closest analogous precedent is the migration idiom itself (guarded additive
`ALTER TABLE`, `server/db.js:905-981`) plus the "membership is derived, not
duplicated" design already used for `projects`↔`sessions` (project_paths
join table, explicitly commented at `db.js:409-413`: "there is deliberately
NO project_id column on sessions — membership is derived by joining"). That
comment is itself a documented instance of this codebase's general
preference for single-source derivation over duplicated foreign keys/state,
worth following for `priority` too (one value on `projects`, read
everywhere, not copied onto sessions or cached per-view).

## 3. Options

### (A) Project priority: schema & API

1. **Recommended: additive column + reuse `PATCH /:id`, or a thin sibling
   `PATCH /:id/priority`.** `ALTER TABLE projects ADD COLUMN priority
   INTEGER NOT NULL DEFAULT 0` guarded exactly like `db.js:977-981`
   (`source TEXT NOT NULL DEFAULT 'local'`— the closest precedent, an
   additive NOT-NULL-with-DEFAULT column, not the nullable-timestamp
   variant at :908). Since `stmts.listProjects`/`getProject` are `SELECT *`,
   no statement changes needed for reads; only an UPDATE statement and a
   route handler are new. Single source of truth: `projects.priority`,
   read by both the WIP sidecar and (if ever wanted) the Projects page —
   no duplicate copy on `sessions` (mirrors the existing project_paths
   derivation principle at `db.js:409-413`).
2. **Alternative: a `project_priorities` side table** (id, project_id,
   value) instead of a column. No advantage here — priority is a 1:1
   scalar attribute of a project, not a 1:many relation; this only adds a
   join for no benefit. Reject.
3. **Reject: per-session priority.** Contradicts Sara's own words ("the
   projects will now have a priority") and the brief's confirmed reading;
   would duplicate one value across every session under a project, the
   exact "same fact represented in two places" shape this project's own
   `project_paths` derivation comment already guards against elsewhere.

Whichever route handles the write should also **broadcast** a new
`project_updated` message (additive to the `WSMessage` union in
`types.ts` ~2107-2129, alongside the existing `session_deleted`/
`SessionDeletedPayload` precedent) so any other open tab (WIP, Projects,
Kanban) picks up a priority change live instead of only updating in the tab
where the drag happened. This closes the "project mutations aren't live"
gap identified in §2, is additive/backward-compatible (new message type,
existing consumers ignore unknown types by construction — every current
`eventBus.subscribe` callback is an `if (msg.type === ...)` chain), and
avoids inventing a parallel channel.

### (B) Queue computation: client-derived vs. server-computed sort

1. **Recommended: client-derived from data already being fetched/pushed.**
   The WIP page fetches active sessions (`GET /api/sessions?status=active`
   or equivalent) and projects (`GET /api/projects`) once, then keeps both
   in memory and re-sorts in a `useMemo` keyed off `[sessions, projects]` on
   every relevant WS event — mirroring exactly how Kanban already merges
   `session_created`/`session_updated`/`session_deleted` into local state
   (`KanbanBoard.tsx` ~427-461) rather than asking the server to
   pre-sort. Sort function: primary `isSessionAwaitingInput(session)`
   (types.ts:807) descending, secondary `project.priority` (looked up via
   the same cwd→project derivation the rest of the app already uses, not a
   new join), tertiary — team/PM should confirm, but `last_activity`/
   `updated_at` descending is the natural default matching how every other
   list in this app already tie-breaks. This keeps sort logic in one place
   (a pure function, easily unit-testable) and requires no new query
   surface.
2. **Alternative: server-computed sort (a dedicated `GET /api/wip` endpoint
   returning pre-sorted+joined rows).** Marginally less client work, but:
   duplicates the `isSessionAwaitingInput`/effective-status logic that
   today lives *only* client-side in `types.ts` (there is no server-side
   equivalent function — the server doesn't compute "awaiting" as a
   derived concept, it just stores `awaiting_input_since`/`status`), so
   this option would require inventing and maintaining a second copy of
   that predicate in Node alongside the existing TypeScript one. That's
   exactly the "wording/logic duplicated across two codepaths → drift"
   shape this evaluation's brief already flags as this app's known general
   risk pattern (Kanban vs. Focus Calendar both independently rendering
   session data) — reintroducing it in a third place (server sort logic
   vs. client sort logic) is a real, avoidable regression risk. Reject
   unless a future scale concern (thousands of concurrent active sessions)
   forces it — not the case here.

Either option must handle removal for **all three** signals: `status`
flips off `"active"` via `session_updated` (completed/error, or the sweep's
abandonment path), and `session_deleted`. All three already exist and are
already the exact set Kanban/Sessions/Projects/SessionDetail subscribe to —
no new server-side event is needed for correctness here (this replaces the
brief's open question #2 with a confirmed answer: yes, an explicit deletion
event exists, plus the status-flip path for abandon/complete; team doesn't
need to design a new one).

### (C) Responsive priority-fill 1/2/3-column layout: CSS-only vs. JS-computed

1. **CSS `column-count` (multi-column text-flow), rejected.** This is the
   one approach that superficially "fills column 1 top-to-bottom then
   column 2" — but only under `column-fill: auto`, which requires a fixed/
   constrained column *height* to know where to break; a live, unbounded
   vertical queue page has no natural fixed height to give it. Left at the
   default `column-fill: balance`, the browser instead balances columns by
   estimated total content height, not by item count/order, so which
   column an item lands in shifts unpredictably as card heights vary (the
   waiting-hover popup, differing meta-line lengths) or as items are
   added/removed live — the browser recomputes column breaks on every
   reflow. This is also literally the CSS approach both the brief and
   source doc's own analysis already concluded against ("not a plain CSS
   multi-column text-flow wrap"); re-confirmed here as the wrong tool, not
   just Sara's stated preference.
2. **CSS Grid with `grid-auto-flow: row` (plain responsive grid), also
   wrong for this ask.** `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` is
   this app's existing, pervasive convention (`Dashboard.tsx:217`,
   `Analytics.tsx:645/1062`, etc.) — but auto-flow is row-major: item 2
   goes to column 2 of row 1, not to the top of column 1's own vertical
   run. That produces "highest priority top-left, second-highest top of
   column 2" — not Sara's explicit "column 1 filled top-to-bottom first."
3. **Recommended: JS-computed column assignment, rendered as N independent
   flex columns.** A pure function `assignToColumns(sortedItems,
   columnCount)` splits the single priority-sorted array into `columnCount`
   contiguous chunks (chunk 1 = column 1, filled top-to-bottom in priority
   order; overflow spills into chunk 2, etc. — a literal, deterministic
   read of Sara's "so forth" description). Each column renders as its own
   `flex flex-col` div. This is trivial to unit-test (pure function, no
   DOM), deterministic under live add/remove (recompute the same chunk
   split, no browser-side rebalancing jank), and is a small, self-contained
   addition — no new dependency.

   **Column-count trigger — genuine architectural decision the brief didn't
   fully resolve:** Tailwind viewport breakpoints (`md:`/`lg:`, this app's
   existing convention) react to *window* width only. But the sidecar is
   described as expandable/collapsible *within* the same page — if it's
   a fixed-width panel pushing the queue narrower, viewport-breakpoint
   classes would leave column count unchanged while the actual available
   width shrank, visually cramming 2-3 columns into less space instead of
   dropping a column. The architecturally correct trigger is the *queue
   container's own width*, not the viewport's — via `ResizeObserver`, a
   pattern already used repeatedly and unremarkably in this exact client
   (`Dashboard.tsx:1000`, `CcConfig.tsx:711`, `Sidebar.tsx:237`,
   `Settings.tsx:507`), and already stubbed in the shared test harness
   (`screens.snapshot.test.tsx:489-490`) — so this is a same-pattern
   addition, not a new one. Recommend: `ResizeObserver` on the queue
   container, columnCount = 1/2/3 by container width against the same
   pixel thresholds Tailwind's `md`/`lg` already use for consistency, not
   `window.matchMedia`/viewport classes.

### (D) `SessionCard.tsx`: edit in place vs. variant/wrapper

1. **Recommended: additive prop, not a fork.** Add an optional prop (e.g.
   `emphasizeProject?: boolean`) to `SessionCard` that swaps the project
   name's type-scale/weight when true, defaulting to `false`/current
   behavior everywhere it's already used (Kanban). This is the
   single-source-of-truth-preserving option: one render function, one set
   of markup/tests, still just a config switch — not a second copy of the
   card's ~554 lines that must be kept in sync by hand. This directly
   avoids the exact "content must render identically across near-duplicate
   surfaces, forked copies drift" shape flagged as this app's own general
   history (Kanban + Focus Calendar both already independently consuming
   session data) — WIP would be a *third* consumer; forking the card here
   is how a fourth divergent rendering path gets created. No
   `PROJECT-CONTEXT.md`-configured defect catalog exists to confirm this
   has bitten the project by name before, so this is the general principle
   applied, not a documented recurrence — flagged as such per the brief's
   own instruction to distinguish the two.
2. **Alternative: a full fork/new `WipSessionCard.tsx`.** Only justified if
   the "more prominent" treatment turns out to need structural
   reflow (not just type-scale/weight) that would otherwise require heavy
   conditional branching inside the shared component, making the single
   file harder to reason about for its other two consumers. Given the ask
   as described (visual prominence only), this is unlikely to be needed,
   but flag as the fallback if the prop-based change starts to feel like
   it's fighting the existing layout.

### (E) Drag-and-drop for the priority sidecar

1. **Recommended: reuse the existing native HTML5 DnD pattern**
   (`draggable`, `onDragStart`/`onDragOver`/`onDragEnd`) already
   hand-rolled in `KanbanBoard.tsx` (~574-649) for project-column and
   monitor-divider reordering. No new dependency; same interaction model
   Sara already has in the app today (drag a project card in Kanban's
   Projects view); same "live preview during drag via local state, commit +
   persist on drop" shape (`handleColumnDragStart`/`handleColumnDragOver`/
   `handleColumnDragEnd`, `db.js`/`projectOrder.ts` equivalent). The only
   material change from the existing precedent: persistence target is now
   `PATCH` to the server (§3A) instead of `persistProjectOrder()`
   localStorage, plus broadcasting `project_updated` so it's live across
   tabs.
2. **Alternative: introduce a DnD library (`dnd-kit`, etc.).** Would add
   the app's first client DnD dependency for a single drag-reorder list —
   disproportionate given a working, already-proven native pattern exists
   in the same codebase for the same interaction shape (reordering a
   column of project-like items). Only worth it if the sidecar needs
   accessibility/keyboard-drag support beyond what the native pattern
   already provides in Kanban today (this app doesn't appear to have added
   that even there, so it isn't a regression to match it). Reject unless
   accessibility requirements are raised explicitly.

## 4. Architectural risks

- **Third consumer of `SessionCard` + session-status model.** Kanban, Focus
  Calendar, and now WIP all read the same `Session`/`isSessionAwaitingInput`/
  `effectiveSessionStatus` surface in `types.ts`. Any prop-driven change to
  `SessionCard` must be verified against Kanban's existing snapshot tests
  (`client/src/pages/__tests__/screens.snapshot.test.tsx`) — a default-off
  prop should produce a zero-diff snapshot for Kanban; if it doesn't,
  that's a signal the "additive prop" approach leaked into the default
  render path and needs tightening before it ships.
- **Project mutations are not currently broadcast at all.** Adding
  priority write-and-broadcast is net-new wiring, not an extension of an
  existing broadcast — get the payload shape right the first time
  (full project row, matching the `session_updated` convention of sending
  the whole row rather than a delta) since other pages may eventually want
  to subscribe to the same event.
- **Sort recomputation cost/flicker under rapid WS churn.** If many
  sessions are awaiting input simultaneously and events arrive in a burst
  (e.g. several agents finish a turn at once), naive re-sort-on-every-event
  could cause visible reordering thrash. Kanban's existing debounce pattern
  (300ms `setTimeout` before refetch/recompute, ~426-461) is a directly
  reusable precedent worth carrying over rather than inventing a new
  timing strategy.
- **`priority` collation/uniqueness is undefined.** Decide (with PM/
  product input) whether priority values must be unique/dense-ranked per
  project (like a real ordered list, renumbered on every drag — mirroring
  `applyProjectOrder`'s array-of-ids approach) vs. a sparse integer score
  where ties are allowed and broken by the sort's tertiary key. The
  drag-and-drop UX (reordering a list) more naturally produces a dense
  rank than a sparse score; recommend storing it as a dense rank
  (0..N-1, renumbered server-side on each reorder inside one transaction,
  same shape as the existing `db.transaction(() => ...)` idiom in
  `routes/projects.js:122-125`) rather than free-entry numbers, to avoid
  needing a tie-break spec for priority itself.
- **Migration safety.** Additive `ALTER TABLE ... DEFAULT 0` is safe and
  reversible (matches `db.js:977-981` precedent exactly) — every existing
  project silently gets priority 0 (lowest/equal), no backfill migration
  required, no behavior change for any existing consumer until the sidecar
  is used.
- **Container-width vs. viewport-width column trigger** (§3C) is the one
  place a "looks right in isolation" implementation (Tailwind breakpoint
  classes) would quietly misbehave only once the sidecar is opened
  alongside the queue — worth explicit QA coverage of "resize with sidecar
  open" rather than just "resize the window."
- **No security/trust-boundary concerns** — this is entirely local-first,
  single-user data (project priority, session status), no new external
  input surface, no auth/authorization model changes.

## 5. Recommended approach

Additive column on `projects` (`priority INTEGER NOT NULL DEFAULT 0`,
dense-ranked, renumbered transactionally on reorder) with a
`project_updated` broadcast added to the existing WS message union;
client-derived (not server-computed) queue sort as a pure, unit-testable
function keyed on `isSessionAwaitingInput` → `project.priority` → an
agreed tertiary key, fed by the same `session_created`/`session_updated`/
`session_deleted` events every other page already subscribes to via
`eventBus`; JS-computed contiguous-chunk column assignment (not CSS
multi-column, not plain grid auto-flow) driven by a `ResizeObserver` on the
queue container itself rather than viewport breakpoints; `SessionCard`
extended with a single additive, default-off prop rather than forked; and
the sidecar's drag-and-drop built on the same native HTML5 DnD pattern
already proven in `KanbanBoard.tsx`, with persistence moved from
`localStorage` to the new server column. Every leg of this recommendation
optimizes for the same thing: one source of truth (one priority column,
one sort function, one card component, one DnD pattern) reused by a third
consumer rather than a parallel implementation invented for WIP alone —
this is a recommendation for the PM/team to weigh, not a final decision.
