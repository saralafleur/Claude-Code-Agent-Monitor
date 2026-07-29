# Request Brief: WIP (work-in-progress) queue page

## Raw ask (verbatim)

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

(Transcribed speech; source doc notes "so forth" / "three calls" reads as
"three columns", and "the whip" is Sara's own pronunciation/name for "WIP".)

## Restated ask

Build a new top-level **WIP** page: a single, live, priority-ordered queue
of session cards for currently-active sessions only, where sessions
awaiting the user's input always float to the top, ties among those broken
by a new per-project priority value (set via drag-and-drop reordering in a
collapsible right-hand sidecar), rendered in a responsive 1/2/3-column
priority-fill layout (not CSS text-flow wrap), reusing the existing session
card with the project name made visually more prominent.

## Requester / source

Sara, dictated in-session (voice-to-text transcription), immediately
preceding invocation of `/engineering-manager auto`, which routed to
`team-intake` → `team-build` since no `PROJECT-CONTEXT.md`/
`status-report.md` exist yet for this repo (first delivery-pipeline run
here). Captured verbatim in
`intake/2026-07-28-wip-queue-page/request-source.md`. Date: 2026-07-28.

## Surface / area touched

- **New client route/page**: `client/src/pages/` (new `WIP.tsx` or similar)
  + nav entry pattern at `client/src/components/Sidebar.tsx:98-114`
  (`NAV_KEYS`) + matching `<Route>` in `client/src/App.tsx:107-127`.
- **New DB column**: `projects` table (`server/db.js:414-419`) needs a
  persisted `priority` field — does not exist today (only a client-side,
  per-browser `localStorage` ordering exists: `client/src/lib/projectOrder.ts`,
  key `"projects-page-order"`, never sent to the API).
- **Shared component**: `client/src/components/SessionCard.tsx` (also used
  by `KanbanBoard.tsx`) — needs a project-name-prominence treatment, scope
  (shared vs. WIP-only variant) undecided.
- **Live pipeline**: `server/websocket.js` broadcast + `server/index.js`
  session lifecycle events; client `client/src/lib/eventBus.ts` +
  `client/src/hooks/useWebSocket.ts`.
- **New UI mechanism**: drag-and-drop reordering in the priority sidecar —
  no DnD library present in `client/`; only hand-rolled native HTML5 DnD
  exists today in `KanbanBoard.tsx`.

## Known-variant relevance

No `PROJECT-CONTEXT.md` is configured for this repo (confirmed absent —
`ls` returned nothing), so there is no project-specific recurring-defect
catalog to check this request against. Noting for the record: this project
does have a documented general pattern of "content must render/behave
identically across near-duplicate surfaces" risk in its history (e.g. the
Kanban board and the new Focus Calendar board both consume the same session
data via different views) — the WIP page is a **third** consumer of
session-card rendering and session-status logic alongside Kanban and
Focus. If `SessionCard.tsx` itself is modified for prominence (rather than
forked), that's a direct fidelity-across-consumers surface worth the
evaluation team watching. This observation is not backed by a configured
`PROJECT-CONTEXT.md` defect class, so it is advisory only, not a hard flag.

## Provisional request type

`new-feature` (PROVISIONAL — Project Manager makes the final call). This is
net-new: a new page, a new DB column, a new sort/layout algorithm, and a
new drag-and-drop mechanism. No existing WIP page or priority concept is
being fixed or restored.

## Attachments / evidence

None — no screenshots, mockups, or example text were provided. The request
is purely descriptive/verbal. The source doc's "Exploratory groundwork"
section is pre-intake code exploration performed by the assistant that ran
`/engineering-manager auto` before handing off; it is **candidate input
only**, explicitly not yet approved by Sara, and is carried into this brief
as context for the evaluation team, not as settled fact.

## Explicit acceptance signals

Sara did not state a formal "done when…" acceptance test. The closest
equivalents, extracted from her own description, function as an implicit
acceptance sketch:

- Page exists, named "WIP" (all uppercase), reachable as its own nav
  destination.
- Queue shows only sessions with `status === "active"`; a session leaving
  active (completed/error) or going abandoned is removed from the queue
  live, no refresh needed.
- Sessions awaiting the user's input sort to the top, automatically, live.
- Projects have a priority; a right-hand sidecar can be expanded, and
  drag-and-drop within it sets/reorders project priority.
- When two sessions are simultaneously awaiting input, they're ordered by
  their project's priority.
- Cards are the existing session card, with project name made more
  prominent than today.
- Layout: single column by default; widens to 2 columns when there's room
  (highest priority filling column 1 top-to-bottom first), widens to 3
  columns when there's enough width/content — a priority-fill/masonry
  distribution, not plain CSS multi-column text wrap.
- "This will all be live" — fully WebSocket-driven, no polling/refresh
  requirement.

## Ambiguity

### BLOCKING

None. The core ask — build a new WIP queue page with the described
behaviors (active-sessions-only membership, awaiting-input-first sort with
project-priority tiebreak via a draggable sidecar, reused session cards
with a more prominent project name, live WebSocket-driven updates, and a
priority-fill 1/2/3-column responsive reflow) — is understood well enough
for the evaluation team (architect/engineer/QA/product-owner) to begin
design and estimation.

### Non-blocking (proceed with stated assumption; evaluation team should
confirm/propose and record final answers)

These mirror the "Open questions for the team to actually resolve" section
of the source doc verbatim in substance — carried forward here as
non-blocking judgment calls for the evaluation team, not reasons to halt
intake:

1. **"Needs my input" definition** — assumption: exactly
   `isSessionAwaitingInput` (`types.ts:807`, i.e.
   `awaiting_input_since` set AND `status === "active"`). Team should
   confirm rather than assume.
2. **"Active"/removal-from-queue signal** — assumption: `status ===
   "active"` per `SessionStatus` governs membership; team must confirm
   whether an explicit removal event exists server-side (`session_deleted`)
   or whether the client must infer removal from a `session_updated`
   status change, and confirm what event (if any) represents "abandoned."
3. **Priority is per-project, not per-session** — assumption: confirmed
   reading of Sara's words ("the projects will now have a priority"); the
   schema decision (column on `projects`, not `sessions`) rests on this.
4. **Full sort spec beyond the stated tiebreak** — Sara specified only:
   primary = awaiting-input first, tiebreak = project priority. Sort order
   for sessions *not* awaiting input, and any tertiary tiebreak among
   equal-priority sessions, is unspecified. Team should propose a full spec
   (e.g. last-activity or session-start-time as tertiary) and confirm with
   Sara rather than invent silently.
5. **Sidecar scope** — whether it lists all projects (even those with no
   active session currently in the queue) or only projects currently
   represented in the queue; and whether collapsed-by-default is correct.
6. **Column-fill algorithm** — assumption: priority-ordered fill-by-column
   (fill column 1 top-to-bottom first, then column 2, then column 3 — a
   single priority-sorted queue distributed across columns), not
   independent per-column sorting and not a CSS `column-count` text-flow
   wrap. This is an architecture/CSS-approach decision for the team to
   document explicitly.
7. **Breakpoints for 1→2→3 columns** — no pixel/rem values given by Sara.
   Team should propose concrete breakpoints (ideally reusing existing
   Tailwind breakpoints already in use elsewhere in `client/`) for
   confirmation.
8. **Scope of the "project name more prominent" change** — whether
   `SessionCard.tsx` is edited directly (affecting every existing consumer,
   e.g. Kanban) or a WIP-specific variant/wrapper is created instead.
   CLAUDE.md's bias toward preserving existing behavior elsewhere argues
   for a variant unless the team has a reason otherwise; Sara asked for
   this change on the WIP card specifically.
9. **Drag-and-drop implementation** — reuse the existing hand-rolled native
   HTML5 DnD pattern already in `KanbanBoard.tsx` (no new dependency) vs.
   introduce a DnD library. No existing precedent settles this either way;
   flagged as an architect decision.

## Constraints / non-negotiables (from CLAUDE.md, carried forward for the
evaluation team)

- Preserve existing behavior unless explicitly asked to change it; minimal,
  reversible diffs. API routes: preserve response shapes unless a change is
  requested and documented.
- Database: this request requires a genuinely new, persisted `priority`
  column on `projects` — must use the existing guarded additive-`ALTER
  TABLE` idiom already used repeatedly in `server/db.js` (e.g. `:908`,
  `:925`, `:980`), not a destructive rebuild.
- WebSocket: keep message types stable and backward-compatible; reuse
  existing `session_created`/`session_updated` (and whatever abandonment
  actually emits) rather than inventing a parallel channel unless the team
  finds a real gap.
- Testing: `npm run test:server` for backend changes; `npm run test:client`
  for frontend changes (includes per-screen snapshot tests — review diffs,
  never blindly regenerate).
- Every new/edited source file needs the project's authorship header per
  `.claude/skills/file-headers/` (exact line `@author Son Nguyen
  <hoangson091104@gmail.com>`).
- Docs must stay in sync with any new route, response shape, DB column,
  WebSocket usage, or nav entry (`README` + VN/CN/KO, `ARCHITECTURE.md`,
  `docs/API.md`, `docs/DATABASE.md`, `server/README.md`, `client/README.md`,
  root `index.html`, `wiki/`) — apply `update-project-docs` at the end of
  the change-set.
- No `PROJECT-CONTEXT.md` exists for this project; PM memory falls back to
  `~/.claude/skills/team-intake/memory/`.
