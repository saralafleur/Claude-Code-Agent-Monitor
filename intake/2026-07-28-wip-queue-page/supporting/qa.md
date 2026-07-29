# QA / Test Plan: WIP queue page

Source: `intake/2026-07-28-wip-queue-page/request-brief.md` +
`request-source.md`. No `PROJECT-CONTEXT.md` exists for this repo, so there
is no configured defect-class catalog to check this against; the
"must-stay-in-sync" surface risk noted below is carried forward as an
**advisory** observation from the brief itself (Kanban / Focus Calendar /
WIP all render session data via separate consumers of `SessionCard.tsx`),
not a hard, pre-documented defect class.

Test stack (confirmed from `package.json` / existing suites, not assumed):
- Server: `node --test server/__tests__/*.test.js`, run via `npm run
  test:server`. Single spec: `node --test server/__tests__/<file>.test.js`.
- Client: Vitest, run via `npm run test:client` (= `cd client && npm test` =
  `vitest run`). Single spec: `cd client && npx vitest run
  src/pages/__tests__/<file>.test.tsx`. Snapshot regen (only after reviewing
  the diff): `cd client && npx vitest run -u`.

---

## 1. How we verify done

Manual (dev server, `npm run dev`):
1. Seed at least 4 active sessions across ≥2 projects, at least 2 of them
   with `awaiting_input_since` set (i.e. `isSessionAwaitingInput` true per
   `client/src/lib/types.ts:806`), plus one `completed`/`error`/`abandoned`
   session that must NOT appear.
2. Open `/wip` (or whatever route the team assigns). Confirm:
   - Only the active, non-completed/error/abandoned sessions render.
   - Both awaiting-input sessions are above every non-awaiting session.
   - Between the two awaiting-input sessions, the one whose project has the
     higher priority is first.
3. Resize the browser window across the 1/2/3-column breakpoints the team
   documents (open question 7 — no values given by Sara). At each width,
   confirm: correct column count, and that column 1 fills top-to-bottom with
   the highest-priority items before column 2 starts (not a CSS
   `column-count` text-reflow — verify by checking DOM order/column
   assignment, not just visual wrap).
4. Open the priority sidecar (right-hand, expand/collapse). Drag a
   lower-priority project above a higher one; confirm the WIP queue
   reorders live in the same tab, and (open a second browser tab/window) in
   any other connected client too, without a refresh.
5. Trigger a live end for one visible session (e.g. send its `SessionEnd`
   hook signal, or let the watchdog abandon-sweep run — see `server/index.js`
   `~:905-955`) while the WIP tab stays open. Confirm the card disappears
   immediately with no refresh, and no other card jumps in a way that
   suggests a wholesale re-render/re-sort glitch.
6. Trigger a live start of a new active session while awaiting sidecar is
   both collapsed and expanded; confirm it's correctly inserted into sort
   order live in both states.

Automated: the new/updated specs in Section 3, plus the full existing
suites (`npm run test:server`, `npm run test:client`) passing clean —
including `client/src/pages/__tests__/screens.snapshot.test.tsx`, whose diff
must be reviewed (not blindly `-u`'d) per CLAUDE.md.

---

## 2. Regression coverage — existing tests touching this surface

Discovered by grepping test directories for the relevant surfaces (not
assumed):

| Surface | Spec file | Currently covers | Currently passes? |
|---|---|---|---|
| Per-screen render snapshots (every routed page) | `client/src/pages/__tests__/screens.snapshot.test.tsx` | One `it()` per page rendered under a mocked API + no-op eventBus; a new WIP page/nav entry is a **new gap** here today, and any Sidebar/App.tsx nav-list edit will shift the existing `Sidebar.test.tsx` and every already-snapshotted screen that renders the sidebar chrome | Not run as part of this pass — must be run before/after the change since a new nav entry is very likely to perturb existing snapshots (sidebar item count/order) |
| Sidebar nav entries | `client/src/components/__tests__/Sidebar.test.tsx` | Renders/queries the `NAV_KEYS` list; adding a WIP entry is a new nav item this suite doesn't yet assert on | Run today — should still pass unmodified until WIP nav entry lands, then needs a new assertion |
| Kanban board session/agent bucketing by awaiting-input | `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx` | Exercises `isSessionAwaitingInput`/`isPrimaryAwaitingReason` bucketing logic that WIP's primary sort criterion reuses — good existing reference for how "awaiting input" is asserted today, but does **not** cover WIP's tiebreak-by-project-priority (that field doesn't exist yet) | Passing today per repo state |
| Session card rendering | `client/src/components/__tests__/SessionCard.test.tsx`, `SessionCard.focus.test.tsx` | Snapshots/asserts current `SessionCard` DOM structure (title, folder, status badge, meta line) — if the project-name-prominence change edits `SessionCard.tsx` directly (open question 8), these specs are the direct regression gate for "did we break Kanban's card too" | Passing today; will need new assertions either way (prominence change here, or none if forked) |
| Project CRUD / schema | `server/__tests__/projects.test.js` | `POST/PATCH/DELETE /api/projects`, folder-mapping CRUD; today asserts shape `{ id, name, paths, created_at, updated_at }` with **no `priority` field** | Passing today; will need a new `priority` field + default assertion once schema lands |
| Session lifecycle / abandonment sweep | `server/__tests__/session-liveness.test.js` | Directly exercises the watchdog reap that flips `active` → `completed`/`abandoned` and the `session_updated` broadcast it emits (`server/index.js:905-955`) — this **is** the closest existing regression guard for the exact "when does a session stop counting as active" signal WIP's removal-from-queue behavior depends on | Passing today; confirms the removal signal is a `session_updated` broadcast with a new `status`, **not** a distinct `session_deleted`/removal event — matches the brief's open question 2 |
| Global singleton layout persisted server-side + broadcast on PUT | `server/__tests__/monitors.test.js` (new, untracked in this repo as of this pass — companion to `server/routes/monitors.js`) | GET/PUT `/api/monitors`: full-layout persistence, partial-patch semantics, validation-rejection cases, broadcast-on-write pattern | Not yet confirmed run as part of this evaluation, but structurally the closest **existing precedent** in this codebase for "a small piece of shared, cross-client UI state, persisted server-side, broadcast on change" — worth the architect reviewing before inventing a new pattern for priority persistence/broadcast, and worth QA reusing its test shape (GET default, PUT full, PUT partial patch, PUT validation-rejects) for whatever priority-write endpoint ships |
| Awaiting-input predicate itself | No dedicated unit spec found for `isSessionAwaitingInput`/`effectiveSessionStatus` in `client/src/lib/__tests__/` (grepped — not present) | These are exercised only indirectly via `KanbanBoard.projectsView.test.tsx`'s bucketing assertions, not directly unit-tested | N/A — this is an existing gap, not one WIP introduces, but WIP's sort depends on this predicate being correct, so consider whether to close this gap alongside the new sort-logic test |

Command to actually run these before starting, to establish a clean
baseline: `npm run test:server && npm run test:client`.

---

## 3. New/updated tests required

### 3.1 Sort/tiebreak logic (unit, client)
New file, e.g. `client/src/lib/__tests__/wipQueueOrder.test.ts` (assuming the
sort is extracted to a pure function, e.g. `client/src/lib/wipQueueOrder.ts`
— a pure sort function is much easier to pin than logic buried in the page
component; recommend the architect extract it as such specifically so it's
unit-testable independent of DOM/columns). Assertions:
- Sessions with `isSessionAwaitingInput(session) === true` all sort before
  every session where it's `false`, regardless of priority.
- Among two awaiting-input sessions on different-priority projects, the
  higher-priority project's session sorts first.
- Among two awaiting-input sessions on the *same*-priority project, order is
  stable/deterministic (document and assert whatever tertiary rule the team
  picks per open question 4 — e.g. session start time).
- Sessions not awaiting input: assert whatever tertiary spec the team
  settles on (currently unspecified — this test is what pins the team's
  decision once made, closing open question 4).
- A session whose `status` is `completed`/`error`/`abandoned` never appears
  in the sorted output at all (membership filter, not just sort position).
- Regression guard mirroring `KanbanBoard.tsx`'s existing
  `isPrimaryAwaitingReason` carve-out: confirm whether WIP intends the same
  "primary reason" exception (session waiting on its own subagent/shell,
  not the human) to be excluded from the "awaiting input" bucket the same
  way Kanban excludes it — if WIP's definition diverges from Kanban's here,
  that's worth an explicit test either way so it doesn't silently drift.

### 3.2 Column-fill algorithm (unit, client)
New file, e.g. `client/src/lib/__tests__/wipColumnFill.test.ts` against a
pure `assignColumns(sortedItems, columnCount)`-shaped function (again,
extract as pure logic so it doesn't require rendering/measuring real DOM
widths). Assertions:
- `columnCount = 1`: single column, full sorted order preserved top to
  bottom.
- `columnCount = 2`: fills column 1 top-to-bottom with the first `ceil(n/2)`
  (or whatever exact distribution rule the team documents) highest-priority
  items before column 2 starts — assert the *highest-priority item is
  always in column 1, row 1*, not just "somewhere."
- `columnCount = 3`: same shape, 3-way split; assert overall left-to-right,
  top-to-bottom reading order matches the single priority-sorted queue
  (i.e. this is a masonry/fill-by-column distribution, not independent
  per-column sorting — pins open question 6 once the team decides).
- Edge cases: 0 items, 1 item (all columns other than column 1 empty),
  item count not evenly divisible by column count (uneven remainder lands
  correctly per the documented rule).
- A breakpoint-to-column-count mapping test (or, if breakpoints are CSS
  media queries rather than JS, a note that this piece can only be verified
  via a browser/e2e-level check, not unit test — flag explicitly rather
  than silently skip coverage) once the team confirms concrete breakpoints
  (open question 7).

### 3.3 DB / migration test for the new `priority` column (server)
Add to `server/__tests__/projects.test.js` (existing "Project CRUD" describe
block) or a new file — confirm which once the schema/route design is final:
- Fresh DB: `GET/POST /api/projects` returns a `priority` field with the
  documented default (matches the `server/db.js:980`-style additive
  `ALTER TABLE ... ADD COLUMN priority INTEGER NOT NULL DEFAULT <n>` idiom
  the brief specifies) — every pre-existing row reads with that default,
  no backfill required.
- A migration-safety test in the same shape as the existing guarded-ALTER
  tests: opening the DB a second time (simulating an upgrade of an existing
  installation) does not throw and does not duplicate/reset the column
  (mirror how `awaiting_input_since`/`source` additions are proven safe
  elsewhere in `server/db.js`'s history, even though there isn't a
  standalone spec file per-column — this project verifies migrations
  primarily via the app booting cleanly against a pre-existing on-disk DB
  fixture in `server/__tests__/*`, e.g. check
  `sessions-transcript-path-migration.test.js` for the existing pattern to
  copy).
- Whatever write endpoint sets priority (new route, or an existing
  `PATCH /api/projects/:id`-style extension): success + validation-rejection
  cases, modeled directly on `server/__tests__/monitors.test.js`'s
  GET-default / PUT-full / PUT-partial-patch / PUT-rejects shape, since
  that's the closest existing precedent for "small piece of state, written
  by drag-and-drop, broadcast to every client."
- Broadcast assertion: setting priority via the API triggers a WS broadcast
  every connected client can react to (mirrors `monitors.test.js`'s
  implicit contract at the route level via `broadcast()`; a full WS
  round-trip test would go in the WebSocket integration test below or its
  own file).

### 3.4 WebSocket integration test for live add/update/removal (server or client)
- Server-side: extend or write a sibling to
  `server/__tests__/session-liveness.test.js` asserting the exact broadcast
  contract WIP's client will rely on: when the watchdog reap flips a session
  to `abandoned`/`completed`, the broadcast type/payload is
  `session_updated` with the new `status` (confirms there is genuinely no
  separate `session_deleted` event today — pins open question 2 as
  currently-true behavior, catches it if that ever changes).
- Client-side: a WIP-page test (new
  `client/src/pages/__tests__/WIP.test.tsx` or similar) using the same
  `eventBus`-mock pattern already used in
  `client/src/pages/__tests__/screens.snapshot.test.tsx` / KanbanBoard's own
  subscription tests: publish a `session_created` event → new card appears
  in correctly-sorted position; publish a `session_updated` moving a
  session out of "active" → card disappears immediately without a refetch;
  publish a `session_updated` that sets `awaiting_input_since` on a
  previously-non-waiting session → it live-reorders to the top-of-queue
  position (or top of its priority tier).

### 3.5 Snapshot test impact (client)
- Add a new `it("WIP", …)` case to
  `client/src/pages/__tests__/screens.snapshot.test.tsx` alongside the other
  per-screen cases, using the same empty-fixture mock-API pattern (the file
  already documents the precedent of new pages initially failing to resolve
  at import time until built — same expected sequencing here as the Focus
  Calendar board's addition).
- Run the full existing snapshot suite before AND after adding the WIP nav
  entry to `Sidebar.tsx`/`App.tsx`; review (don't blindly regenerate) any
  diffs in unrelated existing screens' snapshots that include sidebar chrome
  — a new nav item is very likely to shift those.
- If `SessionCard.tsx` itself is edited for project-name prominence (rather
  than forked per open question 8), re-review the Kanban board's own
  snapshot AND `SessionCard.test.tsx`/`SessionCard.focus.test.tsx` diffs
  specifically for unintended layout drift on that other consumer — this is
  the direct test evidence for the brief's advisory
  "third-consumer-of-session-card-rendering" fidelity risk.

---

## 4. Test data / fixtures

Minimum session/project fixture set to exercise every rule above:
- **Project A** (priority = 1, lower), **Project B** (priority = 5, higher).
  Include a priority=0/unset-default project too, to prove the migration
  default doesn't collide with real values.
- Sessions, all `status: "active"`:
  1. Project A session, `awaiting_input_since` set → expect rank 2 (loses
     tiebreak to Project B).
  2. Project B session, `awaiting_input_since` set → expect rank 1.
  3. Project A session, `awaiting_input_since` null, ordinary "active" →
     ranked below both waiting sessions, per whatever tertiary rule is
     chosen.
  4. Project A session with a "primary" awaiting reason (e.g. `"subagent"`)
     — regression case for the Kanban-style carve-out in 3.1's last bullet.
- One session per non-active terminal state (`completed`, `error`,
  `abandoned`) — each must be provably absent from the WIP queue's output,
  not merely low-ranked.
- Column-fill fixture: an ordered array of N synthetic ranked items (no need
  for real session shape) for 4, 5, 6, and 7 items against 1/2/3 columns —
  isolates the fill algorithm from sort-derivation entirely.
- Live-update fixture: a scripted eventBus publish sequence —
  `session_created` (new active, non-waiting) → `session_updated` (same
  session flips to `awaiting_input_since` set) → `session_updated` (status
  → `completed`) — asserting the queue's rendered order/membership after
  each step in turn, not just the final state.
- Drag-and-drop fixture: sidecar project list in one order; simulate the
  same native-HTML5-DnD event sequence `KanbanBoard.tsx` already uses
  (`dragstart`/`dragover`/`drop`/`dragend`) if the team reuses that pattern
  (open question 9), reordering B before A; assert the resulting `priority`
  values persisted and the main queue's tiebreak order flips accordingly.

---

## 5. Definition of Done checklist

- [ ] `npm run test:server` passes, including a new/updated spec proving
      the `projects.priority` column exists, defaults safely on migration,
      and is writable + broadcast over WebSocket.
- [ ] `npm run test:client` passes, including:
  - [ ] a new pure-function unit spec for the awaiting-input-first /
        priority-tiebreak sort (Section 3.1), covering the "primary
        awaiting reason" carve-out decision explicitly (not silently
        matching or diverging from Kanban's).
  - [ ] a new pure-function unit spec for the 1/2/3-column priority-fill
        algorithm (Section 3.2).
  - [ ] a new/updated WIP page test proving live add/update/remove over the
        (mocked) WebSocket event bus, with no refetch/poll involved
        (Section 3.4).
  - [ ] a new `screens.snapshot.test.tsx` case for the WIP page (Section
        3.5), and a reviewed (not blind) diff of every other snapshot that
        includes sidebar chrome.
  - [ ] `SessionCard.test.tsx` / `SessionCard.focus.test.tsx` (and Kanban's
        own snapshot) reviewed for unintended drift if `SessionCard.tsx` was
        edited directly rather than forked.
- [ ] Manual verification steps in Section 1 performed at least once against
      a real dev-server session with multiple projects/priorities.
- [ ] The brief's non-blocking open questions that affect testable behavior
      (definition of "needs input," definition of "active"/removal signal,
      tertiary sort order, column-fill algorithm, breakpoints, sidecar
      scope, SessionCard fork-vs-edit, DnD approach) have each been
      explicitly answered by the team and the answer is reflected in a
      corresponding test assertion above — not left as silent code-only
      decisions.
- [ ] Docs updated per CLAUDE.md's `update-project-docs` obligation
      (new route/nav entry/DB column/WS usage) — outside this QA doc's
      scope but a DoD blocker per project rules.
- [ ] File-header audit passes on every new/edited source file:
      `bash .claude/skills/file-headers/scripts/check-headers.sh`.

---

## QA-relevant risks flagged from the brief's open questions

- **Open question 2 (abandonment/removal signal)** — confirmed today (via
  `server/index.js:905-955` + `session-liveness.test.js`) that there is
  **no dedicated deletion/removal broadcast**; abandonment and completion
  both arrive as a `session_updated` broadcast carrying a new `status`. The
  WIP client must treat "no longer active" as the removal signal, not wait
  for a message type that doesn't exist. If a future change *does* add a
  `session_deleted` event (the brief notes `SessionDeletedPayload` is
  already a defined-but-unused type at `types.ts:1266`), this is a second
  removal path the WIP page would need to also handle — worth a test that
  covers both paths once/if that lands, rather than assuming only one ever
  fires.
- **Race: session ends mid-drag** — if a user is mid-drag-reorder in the
  sidecar when a session it would affect ends/is abandoned via a live
  WebSocket message, verify: (a) the drag operation completes and commits
  the intended priority change without being clobbered by the incoming
  re-render, and (b) the queue's own reflow (session removal) doesn't fight
  the sidecar's separate reflow in a way that causes a stale drop target or
  a dropped update. This is exactly the kind of interaction a snapshot test
  can't catch — needs a dedicated timing-sequenced test (fire the WS event
  synchronously between drag-start and drop in the test) or, at minimum, an
  explicit manual test step and a written note in the implementation PR
  about how the two update paths are serialized (e.g. debounced re-render,
  optimistic local state during drag).
- **Race: two clients drag simultaneously** — since priority is evidently
  intended as shared/global state (per-project, not per-browser, unlike
  today's `localStorage`-only `projectOrder.ts`), verify last-write-wins
  behavior is deliberate and each client's WIP queue reorders correctly
  after receiving the other client's broadcast — mirrors the existing
  `monitors.test.js` pattern's implicit "one shared global layout" model,
  which never had to solve concurrent-edit conflict resolution because its
  test suite only exercises single-client PUT/GET sequentially; the same
  gap would carry over to priority unless explicitly tested or explicitly
  accepted as out of scope.
- **Ambiguity 4 (tertiary sort) left unresolved** = untestable until
  decided. Recommend the team's very first testable artifact from this
  effort be the extracted pure sort function with the full spec (including
  tertiary order) written as executable assertions (Section 3.1) — that
  spec *is* the acceptance criteria once Sara confirms the behavior, so it
  should exist and be reviewable before broad implementation, not only
  after.
