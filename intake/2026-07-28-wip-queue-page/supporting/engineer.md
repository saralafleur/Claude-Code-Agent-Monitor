# Engineer Assessment — WIP (work-in-progress) queue page

Source: `intake/2026-07-28-wip-queue-page/request-brief.md` +
`request-source.md`. I re-verified every file/line citation below against
the actual code (not trusted from the brief) unless marked otherwise. Read
alongside `supporting/product-owner.md` (recommends: WIP-only card variant,
sidecar scoped to queue-represented projects, most-recent-activity as
tertiary sort) — I did not re-litigate those product calls, only checked
they're technically buildable as proposed.

## 1. Exact change set

### New files
- `client/src/pages/WIP.tsx` — new page component. Owns: fetch sessions +
  projects on mount, subscribe to `eventBus` for live updates, compute
  sort + column-fill layout, render sidecar.
- `client/src/pages/__tests__/WIP.test.tsx` (or fold into
  `screens.snapshot.test.tsx`, see §6) — new test coverage.
- Likely `client/src/lib/wipQueue.ts` (or similar) — pure sort/column-fill
  functions, unit-testable in isolation from React (recommended; see §2).
- Likely `client/src/components/WipSessionCard.tsx` (or
  `WipQueueCard.tsx`) — see §2/§5 on why a variant, not a `SessionCard.tsx`
  edit, is the safer path.
- `server/__tests__/projects-priority.test.js` (or extend
  `server/__tests__/projects.test.js`) — new endpoint coverage.

### Modified files
- **`server/db.js`**
  - `projects` table definition (`:414-419`) is unchanged (CREATE TABLE
    stays historical); add a guarded migration block immediately after the
    existing `source` migration at `:977-981`, following the exact
    try/catch idiom:
    ```js
    try {
      db.prepare("SELECT priority FROM projects LIMIT 1").get();
    } catch {
      db.prepare("ALTER TABLE projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 0").run();
    }
    ```
  - Add `stmts.updateProjectPriority` (or a batch version — see §4) near
    the other project statements (`:1811-1822`, e.g. `renameProject` at
    `:1815`).
- **`server/routes/projects.js`**
  - `GET /` handler (`:60-93`) — the `result.map` at `:74-84` must spread
    `priority` through (it already spreads `...project`, so this is free
    *once the column exists*, but the response needs sorting/shape
    verified against `docs/API.md`).
  - `PATCH /:id` (`:133-146`) currently only accepts/validates `name`
    (`:138-141`) — either extend this handler to also accept an optional
    `priority`, or add a dedicated endpoint (e.g.
    `PATCH /api/projects/:id/priority` or a bulk
    `PUT /api/projects/reorder` taking an ordered id array and writing
    `priority = index` for each — mirrors the drag-and-drop UX directly).
    **No existing endpoint in this codebase does a bulk-array-order
    persist** — `monitorGroups.ts`'s monitor order and
    `client/src/lib/projectOrder.ts`'s project order are both
    localStorage-only (confirmed — grepped every route file, no
    `reorder`/`monitor_order`/`priority` hit anywhere server-side). This
    is a first-of-its-kind endpoint shape for this project, not a
    copy-paste of a precedent.
- **`client/src/lib/types.ts`**
  - `Project` interface (`:1528-1546`) — add `priority: number`.
- **`client/src/lib/api.ts`**
  - `api.projects` block (`:2028-...`, rename at `~2044`) — add a
    `reorder`/`setPriority` method calling the new endpoint.
- **`client/src/components/Sidebar.tsx`**
  - `NAV_KEYS` array (`:98-114`) — add `{ to: "/wip", icon: <TBD>, key:
    "nav:wip" }`. Note the array is placement-sensitive: comments at
    `:100-101` and `:105-106` show prior features (`focus-calendar`,
    `focus`) were placed by an explicit decision (`DEC-5`), not appended
    at the end — confirm placement with the team/PO rather than just
    tacking WIP onto the bottom.
- **`client/src/App.tsx`**
  - Route table (`:107-124`) — add `<Route path="wip" element={<WIP
    />} />` + the matching `import { WIP } from "./pages/WIP";` near
    `:73-86`.
- **`client/src/i18n/locales/{en,vi,zh,ko}/nav.json`** — add the new
  `nav:wip` key (and any WIP-page-specific i18n keys, likely a new
  `wip.json` namespace per locale following the existing per-page
  namespace convention seen in `kanban`/`plan` translations
  `SessionCard.tsx` already uses at `:195` (`useTranslation(["kanban",
  "plan"])`)).
- **Docs** (per CLAUDE.md's `update-project-docs` obligation — confirmed
  live examples of exactly what needs touching):
  - `docs/DATABASE.md` `projects` section (`:574-613`) — add the
    `priority` column row to the **`projects` columns** table (`:595`
    area) and update the "no WebSocket broadcast — plain-CRUD" line at
    `:613` if the team decides priority changes *should* broadcast (see
    §5, gotcha 4).
  - `docs/API.md` `PATCH /api/projects/:id` section (`:1054-1061`
    approx.) and/or a new endpoint section, following the existing
    `/api/projects/*` documentation block starting `:997`.
  - `ARCHITECTURE.md`, `README*.md` (+ CN/KO/VN), `server/README.md`,
    `client/README.md`, `wiki/` — new nav entry / new DB column, per the
    standing rule.

## 2. Feasibility — is it as simple as it looks?

**No — the single biggest thing the brief's groundwork underplays: there
is no "project name" on a session or a `SessionCard` today at all.**
I read the live `SessionCard.tsx` (554 lines) in full. It renders: folder
icon + `session.name`/id (`:349-358`), `SessionStatusBadge` (`:363`),
`session.cwd` path tail via `pathTail()` (`:366-373`), the focus
breadcrumb (`:375-420`), and agent-count/model/cost/last-activity
(`:422-453`). **Nowhere does it render or receive a project name** — and
it can't, structurally: `Session` (types.ts `:662-717`) has no
`project_id`/`project_name` field, and by design (`types.ts:1512-1514`,
`db.js:410-413`) **there is no `project_id` column on sessions at all** —
project membership is derived by joining `session.cwd` against
`project_paths.cwd` server-side. Kanban's "Projects" view (`KanbanBoard.tsx
:492-493, :707-712`) does this join **client-side** to build its columns,
and shows the project name only on the **column header**, never passing it
into `SessionCard` itself.

So "make the project name more prominent on the card" is not a font-weight
bump on an existing field — it requires:
1. Resolving each session's project name (cwd → project lookup, same
   client-side join Kanban already does — reusable logic, but new for this
   component), and
2. Adding an entirely new visual element/prop to display it, since none
   exists.

This is still buildable in an afternoon, but it changes the shape of the
work from "CSS tweak" to "new derived-data + new UI element" — worth
flagging since it changes both the effort read and the "which
variant/coupling" decision (see next).

**Variant vs. shared-component edit — concrete recommendation: fork.**
`SessionCard` is a single 554-line component with real internal state
(hover-preview popup, focus-popup, `useRef`/`useState` for both,
`fetchPreview`/`api.sessions.transcript` call) — none of that logic needs
to change for WIP. Two real options:
- **(a) Add an optional prop** (e.g. `projectName?: string`) to
  `SessionCard` itself, rendered conditionally. Minimal diff, but every
  existing consumer (Kanban's Sessions/Agents/Projects views, all through
  `client/src/pages/__tests__/screens.snapshot.test.tsx`'s "Kanban board"
  snapshot) gets re-rendered through the same component tree — if the
  prop's rendering has *any* effect on layout even when absent (unlikely
  if truly conditional, but worth being careful with `min-w-0`/`truncate`
  interactions already dense in the header row `:349-360`), Kanban's
  snapshot silently changes too.
- **(b) A `WipSessionCard` wrapper** that either duplicates the header
  block or (better) renders `<SessionCard>` and layers the project-name
  treatment via a wrapping element/CSS override from outside — cleanest
  isolation, zero risk to Kanban, matches PO's explicit recommendation.
  Tradeoff: if `SessionCard`'s internals ever need the *same* prominence
  change later (PO flags this as a real possible follow-up), there'll be
  a second place to update — but that's a `git log`-visible, deliberate
  future decision, not an accidental one.

I'd build (b). It's a few more lines but removes literally all risk to the
"third consumer of session-card rendering" fidelity concern the brief
itself raises, and avoids touching Kanban's existing, already-passing
snapshot.

**`isSessionAwaitingInput`/`effectiveSessionStatus` are exactly sufficient
for "needs my input."** Confirmed: `isSessionAwaitingInput` (`types.ts
:806-808`) is `!!session?.awaiting_input_since && session.status ===
"active"` — a pure, already-battle-tested predicate with no variant
branches to worry about (it does not need to special-case
`awaiting_reason`; that's a separate, optional secondary signal
`sessionAwaitingReason` `:884-887` exposes only for the "why" chip). No
new predicate needs to be invented; import and reuse directly.

**Membership ("active" + removal) is genuinely two independent signals,
not one — both must be handled or removal silently fails to work for one
path.** Confirmed by reading the actual emit sites:
- Abandonment (`server/routes/hooks.js:750-751` and
  `server/index.js:951-953`) both call `stmts.updateSession.run(null,
  "abandoned", ...)` then `broadcast("session_updated", ...)` — i.e.
  abandonment is **always** a `session_updated` whose `status` flips away
  from `"active"`, never a distinct message type. A WIP page that only
  listens for `session_deleted` to know when to remove a card would **miss
  every abandonment** — it must re-derive membership from `status` on
  every `session_updated`, same as completion/error.
- Actual row deletion (`server/routes/sessions.js:581`,
  `broadcast("session_deleted", { id })`) is a **separate**, real message
  type (`SessionDeletedPayload`, `types.ts:1262-1266`, part of the
  `WSMessage` union at `:2116-2149`) — this fires only on an explicit
  delete action, not on lifecycle transitions. Both cases need handling:
  filter-out-if-status-not-active on every `session_updated`/
  `session_created`, and outright-remove-by-id on `session_deleted`.

**Live update mechanism: cheapest correct option already has a working
precedent, but it's not literally "instant".** `KanbanBoard.tsx`
(`:425-462`) subscribes via `eventBus.subscribe` and, on any
`session_created`/`session_updated`/`session_deleted`, **debounces 300ms
then does a full `loadSessions()` re-fetch** — it does not merge the
pushed row in place (unlike `plan_updated` at `:407-423`, which does merge
in place). This is good enough that no one has apparently complained, but
it means "when a session ends it comes off the WIP immediately" would, if
built exactly like Kanban's existing pattern, actually mean "within ~300ms
+ one round-trip," not synchronous. That's very likely fine for this
use case (a human reading a queue, not a real-time monitoring alarm), but
worth deciding explicitly rather than assuming "the same pattern
Kanban uses" trivially satisfies the literal "immediately" wording in the
brief. A tighter alternative — merge/filter the pushed `Session` row into
local state directly (no re-fetch) — is more code (one more state-shape
decision: does the WIP page keep its own `Session[]` array merged from
WS pushes, or always re-fetch?) but is a bounded, well-understood React
pattern; I'd size it at most a few hours more than the debounce-refetch
approach, not a different order of complexity.

**Column-fill layout: real, but bounded, JS work — not "just use CSS
grid".** Confirmed there's no existing masonry/priority-fill layout
anywhere in `client/` to reuse (`KanbanBoard.tsx`'s columns are
*project*-columns with independent contents, not a single sorted list
distributed by fill order — different problem shape entirely). Native CSS
options don't fit the actual requirement:
- `column-count`/`columns` (CSS multi-column) fills top-to-bottom
  **column-major** in DOM order, which — for a single sorted array —
  actually does produce roughly the right shape (item 0 top of col 1,
  overflow into col 2, etc.) MODULO one hard problem: CSS multi-column
  text-flow can **split a card's content across the column break** unless
  every card has `break-inside: avoid`, and even then the *browser*
  decides column heights/balancing, not the priority order — for an
  uneven-height list (cards vary with focus breadcrumb/hover state) CSS
  columns balance for *equal column length*, not "column 1 gets the top N
  items regardless of height." That's directly the "not a masonry
  reflow, a wrap" failure mode the brief explicitly calls out (and
  Sara's own words: "highest priority... in the first column... towards
  the top" implies deterministic assignment, not balance-driven).
- CSS Grid with `grid-auto-flow: column` has the same balancing problem
  and additionally needs an explicit row count upfront, which a dynamic
  live list doesn't have.
- **The correct approach is a small pure function**: given the
  priority-sorted array and a column count N (computed from a
  breakpoint/`ResizeObserver` or container width), assign items
  round-not-robin but **sequentially chunked** (fill col 1 fully first per
  Sara's wording — this needs the team's chosen chunking rule, e.g.
  `Math.ceil(n/N)` per column vs. strict round-robin; PO's brief doesn't
  settle this, it's a real algorithm decision) then render N `<div>`
  flex/grid columns each mapping over its slice. This is maybe 20-40 lines
  of pure, easily-unit-tested logic (`wipQueue.ts` above) — genuinely
  simple in isolation, but it's new code, not a CSS attribute.
- Breakpoint detection: reuse `ResizeObserver` (already stubbed in test
  setup, `screens.snapshot.test.tsx:481-492`, so it's an established
  pattern in this codebase) on the page's container, or simpler:
  Tailwind's existing responsive classes conditionally showing/hiding
  columns won't work here since the *distribution*, not just visibility,
  must change with width — needs a JS-read width, not pure CSS media
  queries.

**Priority persistence + drag-and-drop are additive, no real coupling
risk, but two real "new" surfaces.** The DnD reorder algorithm itself
(`KanbanBoard.tsx:574-627`, `handleColumnDragStart`/`DragOver`/`DragEnd`)
is a clean, ~55-line, copy-adaptable pattern — array splice-to-reposition
on drag-over, commit on drag-end. Reusing it needs no new dependency. The
new part is that this reorder must **write through to the server**
(`persistProjectOrder` at `projectOrder.ts:29-35` today only writes
`localStorage` — the WIP feature needs the drag-end handler to also call
the new priority-persisting API endpoint instead of/in addition to
localStorage). That's a small, mechanical addition once the endpoint
exists (§1), but the endpoint doesn't exist yet and has no precedent to
copy verbatim (see §1's bulk-endpoint note).

## 3. Effort estimate — **M** (medium; not S, not L)

Reasoning:
- **Backend: S.** One migration (near-identical copy of an existing
  idiom), one new/extended endpoint, `Project` type field threaded
  through — small, mechanical, low risk. Existing test file
  (`server/__tests__/projects.test.js`) is a direct template to extend.
- **Frontend core page + WS wiring: S–M.** New page, nav/route entries,
  eventBus subscription following an exact existing pattern
  (`KanbanBoard.tsx`), i18n additions across 4 locale files (mechanical
  but must not be skipped or `check-headers`-adjacent i18n completeness
  checks / rendering will show raw keys in non-en locales).
- **Column-fill layout algorithm + responsive breakpoint wiring: M.**
  Genuinely new code with a real (if small) algorithm decision, plus
  `ResizeObserver` wiring and manual verification across three column
  counts — this is the one part of the ask that isn't "assemble existing
  pieces," it's "write a small new layout engine."
  **Note:** if "highest priority first in reading order" needs a live
  re-flow *animation* (cards visibly sliding into new column slots when
  priority/awaiting-state changes) rather than just re-render, that's
  extra polish work the brief doesn't explicitly ask for and I'd flag as
  out-of-scope-unless-requested rather than assumed.
- **Card variant + project-name resolution: S–M.** Forking a card variant
  is small; the cwd→project client-side join logic is new for this
  surface (even though conceptually copied from Kanban's existing
  `Projects` view join) and needs its own small utility + tests to avoid
  silently duplicating that join logic a third time (Kanban already has
  it once; don't hand-roll a second slightly-different version — extract
  a shared helper if one doesn't already exist as a reusable function
  rather than inline in `KanbanBoard.tsx`. Quick check: this join is
  currently inline in `KanbanBoard.tsx` around `:492-493`/`:707-712`, not
  exported anywhere reusable — extracting it is a small but real
  refactor task, not free).
- **Sidecar DnD + priority persistence: S–M.** DnD mechanics reused
  almost verbatim from Kanban; the new bulk-priority-persist endpoint
  design/wiring is the only genuinely new piece.
- **Docs sync across README×4 langs, ARCHITECTURE, API, DATABASE, wiki:
  S**, but real and easy to forget — mechanical.

Net: no single piece is large, but there are **five or six independently
non-trivial pieces** (migration+endpoint, WS membership/removal logic,
column-fill algorithm, card variant + project-name join, DnD+persistence,
docs), each individually S, which is why this reads as M overall rather
than S. Nothing here is architecturally risky or requires a new
dependency — it's breadth of small pieces, not depth of any one.

## 4. Dependencies & order

1. **`server/db.js` migration first** (`priority` column) — everything
   downstream depends on this existing before it can be read/written.
2. **`server/routes/projects.js` endpoint** (extend `PATCH` or add new
   route) — needs the column from (1). Must land before client work that
   calls it, or the client work has to build against a mocked shape and
   integrate later (riskier — prefer sequential).
3. **`client/src/lib/types.ts` `Project.priority` + `client/src/lib/
   api.ts` new method** — needs (2)'s actual response shape to type
   correctly (don't guess the shape before the server settles it).
4. **Shared cwd→project-name join helper** (extracted or newly written) —
   needed by both the card (project-name display) and the sort (priority
   tiebreak lookup by project). Build this once, use in both places, so
   the WIP page doesn't end up with two independent implementations of
   "which project does this session belong to."
5. **Sort/column-fill pure functions** (`wipQueue.ts`) — depends on (4)
   for the priority lookup; independently unit-testable before any React
   wiring exists.
6. **`WipSessionCard`/prominence variant** — independent of (5), can be
   built in parallel once (4) exists.
7. **`WIP.tsx` page** — wires (3)+(4)+(5)+(6) together, adds the
   `eventBus` subscription (copy `KanbanBoard.tsx`'s pattern) and the
   sidecar DnD (copy `KanbanBoard.tsx`'s reorder handlers, but writing to
   (2)'s endpoint instead of `localStorage`).
8. **Nav/route/i18n wiring** — can happen any time after (7) exists (or
   even stubbed earlier with a placeholder component, if the team wants
   to verify nav placement/i18n plumbing independently).
9. **Docs sync** — last, once behavior is final (route path, DB column,
   endpoint shape, WS message usage are all settled facts by then).

The one true **hard gate**: (1) before (2) before (3) — you cannot build
the client type/API layer against a column/endpoint that doesn't exist
yet without guessing its shape.

## 5. Gotchas

1. **The "no project on Session" structural gap (§2) is the single
   biggest thing likely to be underestimated at a glance** — it looks
   like "add a prop to a card" until you check `SessionCard.tsx` and
   `types.ts` and find there's no field to promote. Anyone scoping this
   from the brief's prose alone (rather than the code) would likely
   under-estimate this specific piece.
2. **Abandonment-via-`session_updated` vs. deletion-via-`session_deleted`
   are two different WS messages that must both be handled for removal**
   (§2) — this is exactly the kind of "changed one path, not its sibling"
   trap: it would be very easy to wire up `session_deleted` handling
   (it's the more obviously-named message) and forget that abandonment
   *doesn't* use it, silently leaving abandoned sessions stuck in the
   queue until a manual refresh. Test both paths explicitly (see §6).
3. **Don't hand-roll a second cwd→project join.** Kanban already has this
   logic inline (`KanbanBoard.tsx:492-493`/`:707-712`); the WIP page needs
   the same mapping for both project-name display and priority-tiebreak
   lookup. Two independently-written joins of the same `cwd` against
   `project_paths` is exactly the "content must behave identically across
   near-duplicate surfaces" risk the brief's own "Known-variant
   relevance" section calls out — if Kanban's join and the WIP page's
   join diverge even slightly (e.g. one trims trailing slashes, one
   doesn't), a session could show under a different project name / sort
   tiebreak on the two pages for the same underlying data. Extract once,
   import twice.
4. **Project mutations are documented as explicitly non-broadcast today**
   (`docs/DATABASE.md:613`: "Managed through the `/api/projects/*` routes
   (no WebSocket broadcast — a plain-CRUD config entity ... re-fetched by
   the client after each mutation)"). If the team decides priority
   changes should propagate live to *other open tabs/windows* (not just
   the tab where the drag happened), that's a deliberate deviation from
   documented behavior needing its own WS message type + doc update —
   don't add broadcasting for this one field type silently while every
   other project mutation stays silent; either broadcast all project
   mutations consistently or none, and document the choice either way.
5. **`priority INTEGER NOT NULL DEFAULT 0`** means every existing project
   gets `priority = 0` on migration — if 0 is treated as "highest" by the
   sort (ascending) vs. "lowest" (descending), get this convention
   pinned down and consistent between the DB default, the sort function,
   and the sidecar's initial (undragged) display order, or existing
   projects will all tie at whatever the wrong end of the scale is,
   producing confusing initial ordering the first time this ships.
6. **i18n completeness**: the file-header/i18n conventions in this repo
   are enforced per-locale (`en`/`vi`/`zh`/`ko`, confirmed 4 directories
   under `client/src/i18n/locales/`) — adding `nav:wip` (and any WIP-page
   strings) to only `en/nav.json` will render a raw i18n key in the other
   three languages rather than failing a build; there's no compile-time
   guard for this seen in the repo, so it relies on the author remembering
   to touch all four.
7. **File headers.** Every new file (`WIP.tsx`, `wipQueue.ts`,
   `WipSessionCard.tsx`, new server test) needs the exact
   `@author Son Nguyen <hoangson091104@gmail.com>` header per
   `.claude/skills/file-headers/`; run
   `bash .claude/skills/file-headers/scripts/check-headers.sh` before
   calling this done (binding project rule, not optional).
8. **Snapshot test blast radius.** Adding the WIP page to
   `screens.snapshot.test.tsx` is expected and good (§6), but if the
   project-name-prominence change is done as a `SessionCard.tsx` prop
   edit (option (a) in §2) instead of a fork, the **existing** "Kanban
   board" snapshot (`screens.snapshot.test.tsx:564-566`) could change
   too, and per CLAUDE.md's testing policy that diff must be reviewed
   deliberately, never blindly regenerated with `-u`. Forking avoids this
   entirely (further reason to prefer the variant).

## 6. Verification hooks

- **`npm run test:server`** should include:
  - Extend `server/__tests__/projects.test.js` (currently covers CRUD,
    folder-mapping uniqueness, aggregated stats, unassigned bucket — read
    `:1-60`+ confirms the `fetch`/`post`/`patch` test harness pattern to
    reuse) with cases for: the new `priority` column defaulting to `0` on
    migration for pre-existing rows, the new endpoint's validation
    (invalid/missing priority, unknown project id → 404 matching the
    existing `PATCH /:id` 404 shape at `routes/projects.js:134-137`), and
    that `GET /api/projects` echoes `priority` in its response.
  - `server/__tests__/session-liveness.test.js` and
    `server/__tests__/session-sync.test.js` are the closest existing
    coverage for status-transition/broadcast behavior — worth checking
    they still pass unmodified (no server-side session-status logic
    should need to change for this feature) as a regression guard.
- **`npm run test:client`**:
  - Add a "WIP" case to
    `client/src/pages/__tests__/screens.snapshot.test.tsx` (`:547-599`
    pattern) — mirrors exactly how `FocusCalendarBoard` was added
    previously (see the file's own inline comment at `:461-466`
    documenting that exact precedent). The mocked `api.projects.list`
    fixture (`:417-427`) will need a `priority` field added to stay
    representative once the type changes.
  - New `WIP.test.tsx` (or colocated tests) should explicitly assert: (a)
    a session with `status !== "active"` is excluded from the rendered
    queue: (b) a live `session_updated` message flipping status away from
    `"active"` removes the card without unmount/remount of the whole
    page (regression guard for gotcha #2); (c) a live `session_deleted`
    message also removes its card (the *other* half of gotcha #2 — needs
    its own explicit test, not assumed covered by the `session_updated`
    case); (d) two awaiting-input sessions from different-priority
    projects sort by priority, and (e) the column-fill function assigns
    items to columns in the documented order (unit test the pure
    `wipQueue.ts` function directly — cheapest, most precise place to
    catch a column-fill regression, no DOM rendering needed).
  - `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx` is the
    existing test to re-run (not necessarily modify) as a regression
    check if any shared code (the cwd→project join helper, if extracted
    from `KanbanBoard.tsx`) is touched — confirms the refactor didn't
    change Kanban's own Projects-view behavior.
- **No MCP surface is touched** by this feature as scoped (no new MCP
  tool implied by the brief) — `npm run mcp:typecheck`/`mcp:build` should
  be unaffected; run them anyway per the standing policy if any shared
  type in `client/src/lib/types.ts` that MCP also imports changes shape,
  to be safe.
