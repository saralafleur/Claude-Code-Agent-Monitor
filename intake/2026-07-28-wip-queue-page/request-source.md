# Request source: WIP (work-in-progress) queue page

**Origin:** Not an external ticket — same-session dictated request from Sara,
captured verbatim, immediately followed by `/engineering-manager auto`. That
skill's `triage` command hit its own Step 0 quality gate (no
`status-report.md`/`PROJECT-CONTEXT.md` exist in this repo — the delivery
pipeline has never been run here before), so Sara was asked how to route a
brand-new, never-before-scoped request and chose: run `team-intake`, then
`team-build` (skip `engineering-manager` entirely — there's nothing for it
to triage).

## Sara's own words

> all right, I need a new page and it's gonna be called WIP all uppercase
> and this is for work in progress and its intent is to allow me to
> identify immediately who needs attention so it's gonna look like a single
> queue and anything that needs my input will go to the top of the queue
> automatically now the projects will now have a priority and so I can
> expand a side car on the right, and I can drag drop and change the
> priority of the projects that will set the priority so if two items are
> waiting for input, it will be ordered in the order of the priority and
> what I want to see is the card for the session And I want the project
> name to be more prominent on the card so it's easy to see and that's as
> far as I wanna go. This will all be live. It's simply going to give me a
> vertical queue so that I can look at it now in response of design
> naturethis single column when the size of my browser changes would
> enable from left to right a sense of a wrap so there's a single column if
> there's more than enough to keep everything on the same page, it will go
> to two columns with the highest priority being in the first column
> towards the top and so forth, and if there's enough for three calls it
> will immediately expand to three columns when a session ends or is
> abandoned it comes off of the whip. Only active sessions will be in the
> whip and this is what I need you to build

(Transcribed speech — "so forth" / "three calls" reads as "three columns";
"comes off of the whip" / "the whip" is "WIP", her own name for the page.)

## Restated ask

A new top-level nav destination, **WIP**, showing a single reflowing queue
of session cards for **active sessions only**:

- Sessions currently awaiting the user's input are sorted to the top of the
  queue, automatically, live.
- Projects get a new **priority** attribute (does not exist today — see
  groundwork below). A collapsible right-hand sidecar panel lists projects;
  drag-and-drop inside it reorders/sets each project's priority.
- Priority is the **tiebreaker** among sessions simultaneously awaiting
  input — not the primary sort (awaiting-input-first is primary).
- Cards reuse the existing session card, but with the **project name made
  more visually prominent** than it is today.
- Fully live over the existing WebSocket pipeline — a session leaving
  "active" (completed/error) or going abandoned removes it from the queue
  immediately, no refresh.
- Responsive multi-column reflow, not a plain CSS grid wrap: single column
  by default; widens to 2 columns when there's room, highest-priority items
  filling column 1 top-to-bottom first (i.e. a priority-fill/masonry
  distribution across columns, overflow spilling into the next column);
  widens to 3 columns when there's enough width/content for that.

## Exploratory groundwork already done this session (not yet approved)

Before intake was invoked, the assistant explored the current code to
ground the team's starting point. Sara has **not** picked among any of the
open questions below — this is candidate input only.

- **Nav/route pattern** (same flat-list convention the
  `2026-07-26-focus-calendar-board` intake already documented and built
  against): `client/src/components/Sidebar.tsx:98-114` (`NAV_KEYS` array —
  currently `/`, `/projects`, `/focus-calendar`, `/focus`, `/kanban`
  (labeled `nav:agentBoard`), `/sessions`, `/activity`, `/analytics`,
  `/workflows`, `/cc-config`, `/run`, `/settings`) + matching `<Route>` in
  `client/src/App.tsx:107-127`. A WIP page is one more peer entry in both.
- **Session status / "awaiting input" already exists as a UI overlay, not a
  DB column:** `client/src/lib/types.ts:578` (`SessionStatus = "active" |
  "completed" | "error" | "abandoned"`, persisted),
  `client/src/lib/types.ts:581` (`AgentStatus`), and the
  `AWAITING_STATUS`/`EffectiveSessionStatus` overlay at
  `types.ts:587-644`. `isSessionAwaitingInput` (`types.ts:807`) is exactly
  `!!session?.awaiting_input_since && session.status === "active"` — this
  is almost certainly what "needs my input" should be defined as, and
  "active" for WIP membership should almost certainly mean
  `session.status === "active"` per this same field (abandoned/completed/
  error sessions are excluded by construction). Confirm this reading with
  the team rather than assume.
- **Project priority does not exist anywhere today — confirmed, not
  assumed:**
  - `server/db.js:414-419` — `projects` table is only `(id, name,
    created_at, updated_at)`. No order/priority/position column.
  - The only "ordering" that exists today is a **client-side-only,
    per-browser, localStorage** arrangement with no server representation
    and never sent to the API: `client/src/lib/projectOrder.ts` (see its
    own file-doc for that exact caveat), key `"projects-page-order"`, used
    by `Projects.tsx` and `KanbanBoard.tsx`. A real cross-session,
    tiebreaker-driving "priority" as Sara describes needs a persisted,
    server-side field — this is genuinely new schema, not a relabeling of
    something that exists.
  - Guarded additive-column migration idiom already used repeatedly in this
    file for exactly this shape of change: `server/db.js:908` (`ALTER TABLE
    sessions ADD COLUMN awaiting_input_since TEXT`), `:925`
    (`awaiting_reason`), `:980` shows the "add column with a DEFAULT"
    variant (`source TEXT NOT NULL DEFAULT 'local'`) — the closest
    precedent for a `priority INTEGER NOT NULL DEFAULT 0`-shaped addition
    to `projects`. Each is wrapped in an existence guard immediately above
    the cited line; read that idiom before writing the migration.
- **Existing card to reuse:** `client/src/components/SessionCard.tsx`
  (already used by `KanbanBoard.tsx` via `import { AgentCard, SessionCard }
  from "../components/"`). Current render includes: folder icon + title +
  truncated session id, a status badge, a left border color accent for
  waiting/active, the `session.cwd` path tail, a focus/breadcrumb line, and
  further meta (model/agent count/cost/last activity) plus a hover popup
  for waiting sessions. "Project name more prominent" is a **visual/layout
  change to this shared component** (or a WIP-specific wrapper around it) —
  worth the team explicitly deciding whether to change `SessionCard` itself
  (affects Kanban too) or fork a WIP-only variant, since CLAUDE.md biases
  toward preserving existing behavior elsewhere in the app.
- **Live update mechanism to reuse:** server broadcasts via
  `server/websocket.js:62` (`broadcast(type, data)`), called for session
  lifecycle events in `server/index.js` (`session_created`/
  `session_updated` at multiple call sites; no explicit
  `session_deleted` broadcast found in this pass, though `SessionDeletedPayload`
  is a defined message type at `types.ts:1266` — confirm whether
  session removal is signaled via a dedicated message or inferred from a
  status change). Client side: `client/src/lib/eventBus.ts` pub/sub +
  `client/src/hooks/useWebSocket.ts` own the socket and publish inbound
  frames; `KanbanBoard.tsx` already subscribes via `eventBus.subscribe(...)`
  to react to these — same pattern a WIP page should use.
- **Drag-and-drop — no library present, would be a new dependency or a
  reuse of hand-rolled native events:** no `dnd-kit`/`react-beautiful-dnd`/
  `react-dnd` anywhere in `client/`. The only existing drag-and-drop is
  native HTML5 DnD events hand-rolled in `KanbanBoard.tsx` (`draggable`,
  `onDragStart`/`onDragOver`/`onDragEnd` handlers around lines 574-636,
  1267). The team should explicitly decide: reuse this native-events
  pattern for the priority sidecar's reordering (no new dependency, matches
  existing convention) vs. bring in a drag-and-drop library — flag as an
  architect decision, don't assume.

## Open questions for the team to actually resolve

1. Exact definition of "needs my input" for top-of-queue sort — confirm
   it's `isSessionAwaitingInput` (`awaiting_input_since` set AND `status ===
   "active"`) and not some broader/narrower condition.
2. Exact definition of "active" for WIP membership, and exactly what
   removes a card live: does the server send an explicit removal/deleted
   event, or does the client need to react to a `session_updated` whose new
   status is no longer "active" (completed/error) plus whatever event
   represents "abandoned"? Needs a concrete look at abandonment's actual
   signal, not assumed.
3. Priority is per-**project**, not per-session (Sara: "the projects will
   now have a priority... if two items are waiting for input, it will be
   ordered in the order of the priority" — i.e. a session's tiebreak value
   is its project's priority). Confirm this reading; it drives the schema
   decision (column on `projects`, not `sessions`).
4. Priority is only a tiebreaker among sessions in the *same* top-of-queue
   "awaiting input" bucket — sessions not awaiting input are presumably
   ordered by something else (last-activity? still by project priority as
   a secondary sort even outside the awaiting-input bucket?). Sara's words
   only specify the tiebreak case explicitly; the team should propose a
   full sort spec (primary: awaiting-input first; secondary: project
   priority; tertiary: ? — e.g. last-activity or session start time) and
   confirm/adjust with Sara rather than invent silently.
5. Sidecar UX: "expand a side car on the right" — confirmed as a
   collapsible/expandable panel, collapsed by default presumably; confirm
   whether it lists *all* projects (even ones with no active sessions
   currently in WIP) or only projects currently represented in the queue.
6. Column-fill algorithm: Sara's description ("two columns with the highest
   priority being in the first column towards the top and so forth... three
   columns") is a **priority-ordered fill-by-column** (fill column 1 top to
   bottom first, then column 2, etc. — like reading order across a
   masonry/balanced-column layout keyed to the single priority-sorted
   queue), not independent per-column sorting or a plain CSS multi-column
   `column-count` text-flow wrap (which would reflow item *order* oddly and
   doesn't guarantee "highest priority in column 1"). Confirm this reading;
   it's an architectural/CSS-approach decision (flex/grid with JS-computed
   column assignment vs. CSS multi-column) worth the architect documenting
   explicitly.
7. Breakpoints for 1→2→3 columns: no specific pixel/rem values given
   ("when the size of my browser changes... there's more than enough to
   keep everything on the same page") — team should propose concrete
   breakpoints (e.g. matching existing Tailwind breakpoints already used
   elsewhere in `client/`) for confirmation, not invent arbitrarily without
   flagging.
8. Whether `SessionCard.tsx` itself should be changed to make the project
   name more prominent (affecting every place it's already used, e.g.
   Kanban board) or whether the WIP page should use a distinct
   variant/wrapper preserving the existing card everywhere else. CLAUDE.md
   biases toward "preserve existing behavior unless explicitly asked to
   change it" — Sara asked for this on the WIP card specifically, not
   elsewhere.
9. Drag-and-drop implementation approach for the priority sidecar (reuse
   native HTML5 DnD pattern already in `KanbanBoard.tsx`, vs. introduce a
   library) — architect call, no existing precedent settles it either way.

## Constraints / non-negotiables (from CLAUDE.md)

- Preserve existing behavior unless explicitly asked to change it; minimal,
  reversible diffs. API routes: preserve response shapes unless a change is
  requested and documented.
- Database: avoid schema changes without migration-safe logic — this
  request needs a genuinely new `priority` column on `projects`; follow the
  existing guarded-`ALTER TABLE` idiom (`server/db.js:908`/`:925`/`:980`),
  not a destructive rebuild.
- WebSocket: keep message types stable and backward-compatible — reuse
  existing `session_created`/`session_updated` (and whatever abandonment
  actually emits) rather than inventing a parallel channel unless the team
  finds a real gap.
- Backend changes: `npm run test:server` before finishing. Frontend:
  `npm run test:client` (includes per-screen snapshot tests,
  `client/src/pages/__tests__/screens.snapshot.test.tsx` — review diffs,
  never blindly regenerate).
- Every new/edited source file needs the project's authorship header
  (`.claude/skills/file-headers/`, exact line `@author Son Nguyen
  <hoangson091104@gmail.com>`).
- Docs (`README` + VN/CN/KO, `ARCHITECTURE.md`, `docs/API.md`,
  `docs/DATABASE.md`, `server/README.md`, `client/README.md`, root
  `index.html`, `wiki/`) must stay in sync with any new route, response
  shape, DB column, WebSocket usage, or nav entry — apply
  `update-project-docs` at the end of the change-set.
- No `PROJECT-CONTEXT.md` exists for this project — no defect-class catalog
  configured; PM memory falls back to
  `~/.claude/skills/team-intake/memory/`.
