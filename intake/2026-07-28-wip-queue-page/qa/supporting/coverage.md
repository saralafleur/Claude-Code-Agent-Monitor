# Coverage Map — WIP queue page (pre-build)

> Authored by `qa-coverage-cartographer`. This maps *existing* test coverage
> for every surface the WIP technical plan touches, before any WIP code
> exists. No `PROJECT-CONTEXT.md` is configured for this repo; test stack and
> run commands below are discovered from `package.json` / `client/package.json`.

## Test stack & run commands (discovered)

- **Server**: Node's built-in test runner. `npm run test:server` →
  `node --test server/__tests__/*.test.js`. No project/tag/bucket convention
  (single flat `describe`/`it` tree per file, run in one process).
- **Client**: Vitest + Testing Library. `npm run test:client` → `cd client &&
  npm test` → `vitest run`. No smoke/regression tag convention either — every
  `*.test.ts(x)` under `client/src/**/__tests__/` runs in one pass. Render
  snapshots live in one dedicated file, `screens.snapshot.test.tsx`, distinct
  from behavioral tests.
- No separate e2e/integration layer exists in this repo (no `cypress`,
  `playwright`, or `tests/e2e` directory found) — "integration" here is the
  server suite hitting a real HTTP server + real SQLite temp DB per file
  (e.g. `server/__tests__/projects.test.js`), and "component" coverage is the
  client Vitest suite mounting real React pages/components with the API/
  eventBus layers mocked.
- MCP layer (`npm run mcp:typecheck`, `mcp:build`) is out of scope — the WIP
  plan touches no MCP surface.

## 1–2. Existing coverage by surface, with verdict

### A. Shared session-status predicates — `isSessionAwaitingInput`, `effectiveSessionStatus`, `sessionAwaitingReason`/`isPrimaryAwaitingReason` (`client/src/lib/types.ts:806/863/884`)

- **No dedicated unit test file exists for these predicates.** There is no
  `types.test.ts` and no file under any `__tests__/` directory that imports
  `isSessionAwaitingInput`/`effectiveSessionStatus`/`sessionAwaitingReason`
  directly and asserts on their return value in isolation (confirmed via
  repo-wide grep for those identifiers restricted to `*.test.ts(x)` files —
  zero hits).
- They are exercised **indirectly**, through consumers:
  - `client/src/components/__tests__/SessionCard.test.tsx` — asserts the
    yellow "Waiting" border only appears for `awaiting_reason: "stop"`, not
    `"monitor"` (lines 280–297), and that the last-message-preview fetch only
    fires for a waiting session. This exercises `sessionAwaitingReason`'s
    `"monitor"` vs. other-reason carve-out through a rendered side effect,
    not a direct assertion on the predicate's return value.
  - `client/src/components/__tests__/SessionCard.focus.test.tsx` — exercises
    `status === "active"` gating for the focus breadcrumb (hidden for
    `status: "completed"`), again indirectly via render assertions.
  - `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx` — session
    `status` (`active`/`completed`) drives which column/bucket a session
    lands in and the "Hide completed" filter, but does not touch the
    *awaiting* branch of these predicates at all.
- **Verdict: PARTIAL.** A change that broke `isSessionAwaitingInput` or
  `sessionAwaitingReason`'s reason-classification logic would likely be
  caught by `SessionCard.test.tsx`'s two border-color assertions (a real,
  if narrow, regression net), but there is no standing test that pins the
  predicates' contracts directly, and no existing test exercises
  `effectiveSessionStatus` at all in isolation. This is exactly the surface
  the plan's new `sessionSurfaceParity.test.ts` (§5/§6.3) is designed to
  backstop for the *cross-consumer* case — but that test does not exist yet
  either (see §3 below).

### B. cwd→project join logic in `KanbanBoard.tsx` (two inline sites, ~:492–499 and ~:707–712)

- Directly covered by `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx`
  (22 tests, all currently passing):
  - "renders a Projects column with its session and an Unassigned column
    with the rest" — exercises both join sites end-to-end (a session's `cwd`
    matching a project's mapped path lands in that project's column; an
    unmapped `cwd` lands in Unassigned).
  - "hides completed sessions and drops any column left empty by the
    filter" — exercises the join combined with status filtering.
  - The drag-to-reorder and monitor-grouping describe blocks (18 more tests)
    exercise the *columns* built from the join but not the join logic itself
    beyond the base render tests above.
- **Verdict: GUARDED**, specifically for the two behaviors above (session→
  project column placement, session→Unassigned fallback). This is the exact
  regression test the plan's step 4 says must "still pass unmodified" after
  the join is extracted into `projectLookup.ts` — confirmed currently green
  (see §4 baseline below).
- Caveat: this test does not cover trailing-slash / cwd-normalization edge
  cases in the join (the change brief's own concern about the new
  `projectLookup.ts` "differing on trailing-slash handling") — no fixture
  in this file exercises a near-miss cwd string. **PARTIAL** on that
  specific edge case; **GUARDED** on the join's primary behavior.

### C. `SessionCard.tsx` render surface

- `SessionCard.test.tsx` (11 tests) — hover-triggered last-message preview
  (fetch-once, loading/empty states, popup sizing/positioning, portal
  target), and the waiting-vs-monitor border-color distinction.
- `SessionCard.focus.test.tsx` (8 tests) — focus breadcrumb rendering,
  detour segments, drift pill, popup, and absence for non-active/no-focus
  sessions.
- Both currently pass in full (19 tests total). Since the plan explicitly
  forks `WipSessionCard.tsx` and gives `SessionCard.tsx` zero edits, these
  19 tests are the regression net proving that promise held — they are
  unmodified re-runs, not new coverage, and the plan's Definition of Done
  explicitly lists both files.
- **Verdict: GUARDED** for `SessionCard.tsx` itself as it exists today. Not
  applicable yet to `WipSessionCard.tsx`, which doesn't exist (no coverage
  possible pre-build — expected).

### D. `projects` table / routes (`server/__tests__/projects.test.js`)

- Existing coverage (all currently passing): project CRUD validation
  (name required, `cwds` must be array), create/list/rename/delete
  round-trip, 404 on unknown-id rename/delete, folder (cwd) mapping
  uniqueness (`ALREADY_MAPPED` 409), add/remove path mapping, aggregated
  session/active counts + `last_activity`, unassigned-cwd bucketing, and
  the per-project `GET /:id/focus-report` route (404, empty-shape, and a
  real bug-detour rollup scenario).
- **No test reads or asserts a `priority` field anywhere** — expected,
  since the `projects` table has no `priority` column yet (verified:
  `grep priority server/db.js` → zero hits).
- **No `PUT /api/projects/reorder` route or test exists** — confirmed via
  `grep 'router\.(get|post|put|patch|delete)' server/routes/projects.js`:
  only `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:id/paths`,
  `DELETE /:id/paths/:pathId`, `GET /:id/focus-report`. No `PUT /reorder`.
- **Verdict: UNGUARDED** for both the `priority` column and the reorder
  endpoint — correctly so, since neither exists yet. This is the expected,
  honest pre-build state, not a defect. It becomes the literal punch list
  for the plan's §6 server test additions (priority default, reorder
  happy-path/404/400/broadcast-shape).

### E. `screens.snapshot.test.tsx` precedent for adding a new page + nav entry

- The file's own history (visible in its comments) shows exactly this
  pattern already executed once for **Focus Calendar board**: a `beforeAll`
  clock/timezone pin, a fully-mocked `api` (including a
  `focusReport`/`focusReportSummary` block added for that page), a no-op
  `eventBus` mock, `ResizeObserver`/`IntersectionObserver`/`matchMedia`
  stubs (needed because the new page used them), a top-level `import {
  FocusCalendarBoard } from "../FocusCalendarBoard"` added alongside the
  existing page imports, and one new `it("Focus calendar board", ...)`
  case placed "right after Projects" per that cycle's DEC-5 ordering
  convention (mirroring the sidebar's own nav ordering).
- This is a directly reusable template for WIP: add `api.projects.reorder`
  (or the whole augmented `Project`/`priority` shape) to the mock block,
  add a no-op `WIP` import once `WIP.tsx` exists, and add one `it("WIP", …)`
  case — placed right after Dashboard per this plan's own nav-ordering
  intent, mirroring how Focus Calendar's case was placed right after
  Projects to mirror *its* sidebar position.
- **Verdict**: N/A as a coverage target (this is a convention precedent,
  not a surface under test) — but worth flagging that the existing 14
  snapshot cases (Dashboard, Projects, Focus calendar board, Focus, Kanban
  board, Sessions, Session detail, Activity feed, Analytics, Workflows,
  Claude Config, Run, Settings, Not found) all currently pass, so the
  baseline this new "WIP" case would be added against is clean today (see
  §4).

### F. `server/routes/monitors.js` + `server/__tests__/monitors.test.js` (uncommitted precedent for the new bulk-endpoint/broadcast pattern)

- **These files are untracked in the working tree** (`git status` confirms
  `server/__tests__/monitors.test.js` and `server/routes/monitors.js` as
  `??`), not yet-merged, committed code — exactly as the change brief flags.
- Their *current* test coverage (as committed-would-be, i.e. what's on disk
  right now): `server/__tests__/monitors.test.js` covers `GET /api/monitors`
  (empty default), `PUT /api/monitors` (full-layout persist + GET
  reflection, partial-patch-leaves-rest-untouched, and 8 parameterized
  400/`INVALID_LAYOUT` rejection cases for malformed `monitors`/
  `monitorMap`/`collapsedProjects` shapes). All these tests pass today
  (part of the 995/995 server total below).
- **Important gap in this precedent itself**: `monitors.test.js` asserts
  the **HTTP response body** matches the persisted state after a `PUT`, but
  **does not open a real WebSocket connection and assert on the actual
  broadcast frame**. No server test file in this repo does — confirmed via
  repo-wide grep for `new WebSocket`/`require("ws")` inside
  `server/__tests__/`: zero hits. Broadcast-content assertions in this
  codebase are, by established convention, verified only indirectly (HTTP
  response echoes what was persisted; `broadcast(...)` is trusted to relay
  the same object) — never by a test that actually listens on the socket.
  This means the WIP plan's own `project_updated` broadcast, even once
  built with server test coverage modeled on `monitors.test.js`, will
  inherit the same **verified-by-convention-only** blind spot: nothing in
  this repo's test suite would catch `broadcast("project_updated", ...)`
  silently not firing, firing with the wrong `type` string, or firing
  twice — only that the HTTP response shape is right.
- **Verdict: GUARDED** for the HTTP-level CRUD/validation contract of
  `PUT /api/monitors` itself (the precedent pattern is real and passes
  today). **UNGUARDED** for the actual "did a WebSocket frame with this
  type/payload get sent" question — a repo-wide convention gap, not
  specific to this feature, that the WIP reorder+broadcast work would
  reproduce rather than close unless QA/architects decide to add a real
  socket-listening test as part of this build (worth flagging to the
  unit/e2e architects, even though closing it isn't this skill's job).

### G. `KanbanBoard.projectsView.test.tsx` (also asked about directly)

Already covered in full under **B** above — this is the same file. Restating
the verdict for clarity: **GUARDED** for the specific behaviors it tests
(Projects/Unassigned column population, hide-completed filtering, drag
reorder, monitor-box grouping — 22 tests, all green); this is the exact
regression gate the plan's step 4 (`projectLookup.ts` extraction) is
required to pass unmodified, both immediately after extraction and again
at the end.

## 3. Registry/consistency gap check

This repo has no formal `PROJECT-CONTEXT.md` defect catalog (confirmed
absent from repo root) and no single canonical "registry" file in the
classic sense (e.g. no central enum/config that several independent
renderers must agree with, checked via lookup). However, the change brief
and technical plan both name a project-specific standing-discipline
equivalent: **the "is this session awaiting input" / "which project does
this session belong to" derivation must agree across every independent
render surface** (Kanban, Focus List, Focus Calendar, and now WIP) — this
project's PM explicitly diagnosed this as its #1 recurring drift shape
(citing the Focus List/Calendar fidelity gap two days ago), with no formal
catalog id assigned since no catalog exists.

Applying the same discipline as a registry check: does every *entry* (each
of the four consumers) have a corresponding assertion that it agrees with
the others?

- **Kanban ↔ Focus List/Calendar parity**: no cross-consumer parity test
  exists today between Kanban's inline join/awaiting-bucketing and Focus
  List's or Focus Calendar's own derivations — each page's test file
  (`KanbanBoard.projectsView.test.tsx`, `FocusPage.test.tsx`,
  `FocusCalendarBoard.test.tsx`) asserts its *own* page's behavior in
  isolation. There is no standing test today that would have caught (or
  would catch a future recurrence of) the Focus List/Calendar drift the PM
  cited — this is confirmed by grep: no test file references more than one
  of these pages' derivation logic in the same assertion.
- **Kanban ↔ WIP parity** (the object of this plan): `sessionSurfaceParity.test.ts`
  is the plan's named answer to this — it does not exist yet (pre-build).
  Until it's written, **this is the single clearest UNGUARDED finding in
  this map**: the project's own named #1 recurring defect shape has *no*
  standing regression test guarding it anywhere in the current suite, for
  any pair of consumers, today. Calling this out explicitly per this
  skill's mandate: an entry (any given consumer surface) with no
  cross-consumer assertion is UNGUARDED even though every individual
  consumer's own page-level suite is green.
- No formal catalog id applies (none exists for this repo); flagging this
  as "PM-established standing discipline, currently unenforced by any
  executable test" is the closest honest equivalent.

## 4. Current baseline (actually run)

Ran today, against the current working tree (which includes the
uncommitted `monitors.js`/monitor-groups changes noted in the change
brief — this is the actual state QA would build WIP against if nothing is
committed first):

- **`npm run test:server`** (`node --test server/__tests__/*.test.js`,
  full suite — targeted run wasn't meaningfully smaller since the runner
  globs all files in one process):
  ```
  # tests 995
  # suites 222
  # pass 995
  # fail 0
  # cancelled 0
  # skipped 0
  # duration_ms ~24368
  ```
  **Result: GREEN, 995/995.** Includes `projects.test.js` and the
  uncommitted `monitors.test.js` (part of the 995).

- **`cd client && npx vitest run` on the four directly-named files**
  (`KanbanBoard.projectsView.test.tsx`, `SessionCard.test.tsx`,
  `SessionCard.focus.test.tsx`, `screens.snapshot.test.tsx`):
  ```
  Test Files  4 passed (4)
       Tests  55 passed (55)
  ```
  **Result: GREEN, 55/55.**

- **Full client suite** (`cd client && npx vitest run`, no filter) — run in
  addition to the targeted set, specifically because the change brief flags
  that several shared files (`types.ts`, `api.ts`, `monitorGroups.ts`,
  `KanbanBoard.tsx`) already carry uncommitted, in-flight monitor-groups
  changes, so a wider check was warranted before treating "targeted" as
  sufficient:
  ```
  Test Files  43 passed (43)
       Tests  575 passed (575)
  ```
  **Result: GREEN, 575/575.**

Nothing was skipped due to an unavailable service — the server suite starts
its own real Express app + temp SQLite DB per file and tears it down; no
external dependency was required or found down.

**Baseline verdict: fully green today, both narrowly (995 server / 55
targeted client) and broadly (575 full client).** This is the clean
starting point the technical plan's §6 preamble ("run
`npm run test:server && npm run test:client` first, unmodified, to
establish a clean baseline") calls for — confirmed actually clean, not
assumed.

## 5. Conventions in play (for the architects)

- **Server new-route tests**: co-locate in the existing file for the
  resource (`server/__tests__/projects.test.js` extended in place, per the
  plan's own §6.1 wording — not a new sibling file), matching how
  `monitors.test.js` sits as its own file only because `monitors.js` is
  itself a new, separate resource, not an extension of an existing one.
  Structure: `describe("<route/feature>")` blocks of `it("<verb> ...")`
  cases, each spinning an isolated temp-file SQLite DB per test *file*
  (not per test) via `DASHBOARD_DB_PATH` set before `require("../index")`,
  torn down in `after()`.
- **Server validation-error convention**: structured `{ error: { code,
  message } }` bodies, `400` for shape/validation failures (`INVALID_INPUT`
  in `projects.js`, `INVALID_LAYOUT` in `monitors.js` — a new
  `PUT /reorder` would coin its own code name), `404` for unknown ids,
  `409` for uniqueness conflicts. The reorder endpoint's 404/400 tests
  should follow this exact `res.body.error.code` assertion shape.
- **Client pure-logic modules**: get their own sibling `__tests__/*.test.ts`
  file with no React/DOM involved (e.g. `lib/__tests__/focusActivity.test.ts`,
  `lib/__tests__/eventBuckets.test.ts`) — `wipQueue.test.ts` and
  `projectLookup.test.ts` both belong at `client/src/lib/__tests__/`,
  matching this pattern exactly (not under `pages/__tests__/` or
  `components/__tests__/`).
- **Client page tests**: `client/src/pages/__tests__/<PageName>.test.tsx` or
  a scoped `<PageName>.<aspect>.test.tsx` when a page has multiple test
  files split by concern (e.g. `KanbanBoard.projectsView.test.tsx`,
  `SessionDetail.nestedAgents.test.tsx`) — `WIP.test.tsx` at
  `client/src/pages/__tests__/WIP.test.tsx` matches this directly; the
  plan's own naming already follows it.
- **Cross-consumer parity tests**: no existing standing example in this
  repo predates the plan's proposed `sessionSurfaceParity.test.ts` (see §3)
  — the plan cites `FocusReportModal.test.tsx` as "analogous," but that
  file asserts one component's own rendering against fixture data, not
  literal agreement between two independent consumers' derivation logic.
  `sessionSurfaceParity.test.ts` would be a genuinely new pattern for this
  repo, not a precedent-following one — worth the architects knowing they
  are not just copying an existing shape here.
- **Snapshot-suite additions**: extend the single shared mock `api` object
  in `screens.snapshot.test.tsx` (not a separate mock file), add any new
  DOM-API stub the new page needs (Focus Calendar's precedent added none
  beyond what already existed; `ResizeObserver` is already stubbed
  globally in that file, so `WIP.tsx`'s own `ResizeObserver` usage needs no
  new stub), then one `it("<Page name>", ...)` case placed to mirror the
  sidebar's nav ordering — "right after Dashboard" for WIP, per this plan.

## Files referenced

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/lib/types.ts` (predicates at lines 806, 863, 884; `WSMessage` union ending at line 2145 with `"monitors_updated"`, no `project_updated` yet)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/pages/KanbanBoard.tsx` (join sites ~492–499, ~707–712)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/components/SessionCard.tsx`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/components/__tests__/SessionCard.test.tsx`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/components/__tests__/SessionCard.focus.test.tsx`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/pages/__tests__/screens.snapshot.test.tsx`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/routes/projects.js`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/projects.test.js`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/routes/monitors.js` (untracked)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/monitors.test.js` (untracked)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/db.js` (no `priority` column present)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/session-liveness.test.js` (status-transition coverage; no WS-frame assertions)
