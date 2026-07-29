# Adversarial Code Review — WIP queue page (Step 6)

Reviewed: `git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-07-28-wip-queue-page/Claude-Code-Agent-Monitor diff 50a28004946e1505e99e9a344bba8a740f5da0c9`
(25 changed tracked files, 13 new untracked files). Cross-checked against
`technical-plan.md`, `build-task-list.md`, and `supporting/green-evidence.md`.
Re-ran `npm run test:server` (1009/1009), `cd client && npx vitest run`
(658/658 across 48 files), `npx tsc -b` (clean), and the file-header audit
(exit 0) myself — all independently reproduced, not taken on faith from the
verifier.

## Verdict

**Clean. 0 blockers, 0 should-fix, 1 nit.** This is one of the more
disciplined implementations of the `DERIVED-DUAL-VIEW` durable cure I've
seen reviewed for this project — both mandatory halves (extract-not-copy,
reuse-not-rederive) genuinely landed, not just satisfied by the test suite
being green.

---

## 1. Third independent re-derivation check — none found

Read `WIP.tsx`, `WipSessionCard.tsx`, `WipPrioritySidecar.tsx` in full,
specifically hunting for a THIRD independent "is this session awaiting" or
"which project owns this session" computation outside what
`sessionSurfaceParity.test.ts` guards:

- **`WIP.tsx`**: imports `isWipMember`/`sortWipQueue`/`assignToColumns` from
  `wipQueue.ts` and `buildCwdProjectIndex`/`projectForSession` from
  `projectLookup.ts`. Its only local logic is `mergeSessionUpdate` (WS
  upsert/remove-on-`!isWipMember`) and `mergeProjectPriorities` (patch
  `priority` in place) — both are pure state-merge plumbing around the
  shared predicates, not new business logic re-deriving "awaiting" or
  "project". Clean.
- **`WipSessionCard.tsx`**: the only project-resolution call is
  `projectForSession(session, projectIndex)` (line 37). No inline cwd
  string-matching, no second index built. Clean.
- **`WipPrioritySidecar.tsx`**: never touches sessions at all — it only
  sorts the `projects` array it's given by `(a.priority ?? 0) - (b.priority
  ?? 0)`. This is a legitimate third "priority-direction" site (the plan
  and task list call it out explicitly as such — `WIP.test.tsx`'s "sidecar
  initial, undragged order" case exists precisely because this site isn't
  reachable from `wipQueue.test.ts`'s pure coverage), but it re-derives
  nothing about session awaiting-state or cwd→project resolution. Clean.

Kanban's own `isPrimaryAwaitingReason`/`isSessionEffectivelyWaiting`
(`KanbanBoard.tsx` ~535/563) remain locally-defined functions, textually
mirrored by `wipQueue.ts`'s `isEffectivelyWaiting` — but this pre-dates the
build (confirmed via `git show 50a2800:client/src/pages/KanbanBoard.tsx`,
same lines already present at the base commit) and is exactly the shape the
plan's mandate addresses: `wipQueue.ts` is required to *reuse*
`isSessionAwaitingInput`/`AWAITING_REASON_CONFIG`/`normalizeAwaitingReason`
from `types.ts` (which it does, verified by import), not to extract
Kanban's own local bucketing helper into a new shared module (which neither
plan nor task list asked for). `sessionSurfaceParity.test.ts` is the
standing guard that would catch drift between the two if it ever
reappears — read the fixture in full (§5 below); it's non-trivial, not
vacuous.

## 2. KanbanBoard.tsx refactor — no dead code, no redundant second join

`git diff` on `KanbanBoard.tsx` (lines ~490-514, ~729-754):

- `sessionsByCwd` (the pre-existing forward join) is **kept**, but its
  comment is correctly updated and its usage is now scoped to **only** the
  Unassigned column (`col.isUnassignedColumn ? ... : sessionsByProjectId.get(...)`)
  — this is not a "leftover inline join sitting alongside a new one", it's a
  genuine remaining use case (the Unassigned column isn't a project, so it
  can't route through `projectForSession`). Confirmed by reading the
  `.map((col) => ...)` block: real project columns exclusively read
  `sessionsByProjectId`, which is built via `buildCwdProjectIndex`/
  `projectForSession` — the extracted module. No path in the file still
  does a hand-rolled cwd→project resolution for a real project column.
- `sessionsByProjectId` and `cwdProjectIndex` are both built from
  `visibleSessions`/`projectsList`, consistent with the pre-existing
  `sessionsByCwd`'s own dependency array — no state/filter mismatch that
  would cause `orderedProjectsList` (Task 12's reorder-aware list) and
  `sessionsByProjectId` (keyed by raw `projectsList` ids) to disagree on
  which ids exist; `orderedProjectsList` is a reordering of the same
  `projectsList`, so `col.key` always resolves.
- One behavioral nuance, already covered by the frozen-reference regression
  test (`projectLookup.test.ts`/`sessionSurfaceParity.test.ts`): the OLD
  per-column `flatMap` over `col.cwds` would show a session in **every**
  project column whose cwd list happened to include it (impossible today
  since `project_paths.cwd` is server-enforced `UNIQUE`, but theoretically
  a multi-column duplicate); the NEW `projectForSession`-based join assigns
  each session to exactly one project (last-write-wins on a duplicate
  index entry). Given the DB's real uniqueness constraint this is a
  same-behavior-in-practice change, and it's exactly the class of thing the
  regression tests were designed to catch — they pass, and I additionally
  confirmed by direct read that the fixture used by `projectLookup.test.ts`
  does not construct a duplicate-cwd scenario (so this specific edge stays
  implicit, matching the "should not happen in practice" framing already in
  `projectLookup.ts`'s own doc comment — not a hidden regression, just an
  acknowledged, database-enforced non-issue).
- `Task 13`/`Task 29` (`KanbanBoard.projectsView.test.tsx`, unmodified) both
  pass — confirmed via direct re-run (22/22), and `git diff` on that test
  file is empty, so this is a genuine unmodified regression proof, not a
  test that was quietly adjusted to match new behavior.

## 3. Priority-direction convention — consistent across all three sites

Verified "lower numeric value = higher priority, 0 = top" holds
identically everywhere:

1. **DB default**: `server/db.js` — `ALTER TABLE projects ADD COLUMN
   priority INTEGER NOT NULL DEFAULT 0` (every pre-existing/new row starts
   at rank 0, i.e. "highest," matching "no explicit reorder yet = nothing
   is de-prioritized").
2. **`wipQueue.ts`'s comparator**: `priorityA - priorityB` (ascending —
   `sortWipQueue`, line 98) — a numerically smaller `priority` sorts
   first. Named unit test: `"project priority 0 must rank above project
   priority 1"` (`wipQueue.test.ts`), fed sessions in reverse array order
   specifically so a passing result proves the comparator does the work,
   not incoming order.
3. **`WipPrioritySidecar.tsx`'s initial/undragged order**: `(a.priority ??
   0) - (b.priority ?? 0)` (line 53) — same ascending direction, i.e. rank
   0 renders at the top of the sidecar list before any drag happens.
   Covered by `WIP.test.tsx`'s dedicated case ("the sidecar's initial,
   undragged display order matches the priority convention — priority 0
   renders above priority 1"), which is the one site `wipQueue.test.ts`'s
   pure-function coverage structurally cannot reach (this component owns
   its own comparator, separate from `sortWipQueue`).

No inversion found at any of the three sites. The `reorder` route's
response (`{ id, priority: index }` for `order.forEach((id, index) => ...)`)
is also consistent — index 0 (first array element = highest priority)
becomes `priority: 0`.

## 4. `PUT /api/projects/reorder` — SQL injection / atomicity / races

- **SQL injection**: every write goes through `better-sqlite3` prepared
  statements with bound params (`stmts.setProjectPriority.run(index, id)`,
  `stmts.getProject.get(id)`) — no string interpolation into SQL anywhere
  in the new route. Safe.
- **Transaction atomicity**: `db.transaction(() => { order.forEach((id,
  index) => stmts.setProjectPriority.run(index, id)); })()` wraps every
  write in one transaction, matching the existing `POST /` precedent. The
  existence-validation loop (`stmts.getProject.get(id)` per id, returning
  404 on the first miss) runs *before* the transaction starts, which is
  fine for atomicity here: `better-sqlite3` is fully synchronous and
  Node.js is single-threaded, so nothing else can execute — and no other
  request handler can interleave — between the validation loop and the
  transaction, or between individual `.run()` calls inside the
  transaction. There is no `await` anywhere in the handler body, so the
  whole route executes as one uninterruptible synchronous unit from the
  event loop's perspective.
- **Concurrent-reorder races**: for the same reason (synchronous,
  single-threaded, no yield points), two concurrent `PUT /reorder` calls
  can never interleave their effects — whichever request Express dispatches
  first will run to completion (read-validate-write-respond-broadcast)
  before the second request's handler body starts. This is a "last write
  wins" semantics at the HTTP layer (the second call's array fully
  determines final state), which is the expected/desired behavior for a
  drag-reorder UI, not an accidental race.
- Verified via the server test suite's own dedicated coverage: happy path,
  DB-round-trip persistence (not just PUT echo), full-replace-not-additive
  re-reorder, partial-reorder (omitted id keeps prior priority) distinct
  from unknown-id 404, duplicate-id 400, non-array 400, non-string-entry
  400, and the explicit empty-array-400 decision — all pass
  (`server/__tests__/projects.test.js`, re-run directly: part of the
  1009/1009 full suite).

## 5. `project_updated` broadcast scope — genuinely priority-only

`grep -rn "project_updated" server/ client/src` (excluding test files)
shows exactly one call site: `server/routes/projects.js:189`, inside the
`PUT /reorder` handler, and nowhere else in the codebase. The server test
suite's own negative test
(`"negative: create/rename/add-path/remove-path/delete never fire
project_updated"`) opens a real `ws` client and asserts zero
`project_updated` messages across those five other mutation types — this
closes the "broadcast trusted by convention only" gap the task list called
out, with an actual assertion rather than just a doc claim. `docs/API.md`/
`docs/DATABASE.md`/`server/README.md` all describe the carve-out in
matching language ("deliberate, narrow exception... every other project
mutation remains plain CRUD").

## 6. General code quality

- **`Project.priority` typed as optional (`priority?: number`)** — a
  deliberate deviation from the plan's literal text (`priority: number;`
  required). The implementer's own doc comment explains why (avoids
  needing to edit every pre-existing hand-typed `Project` fixture across
  the test suite) and every real consumer reads it via `?? 0` (`wipQueue.ts`,
  `WipPrioritySidecar.tsx`) — the same fallback already required for an
  unmapped cwd, so this doesn't introduce an inconsistent code path. Not a
  blocker; flagged as a **nit** only because it's a silent-ish narrowing of
  the plan's stated interface shape that a future consumer could
  theoretically forget to default — low risk given the two current
  consumers both already do it correctly and it's explicitly commented.
- No dead code found: `sessionsByCwd` in `KanbanBoard.tsx` is still live
  (Unassigned column only, not a redundant duplicate — see §2).
  `mergeSessionUpdate`/`mergeProjectPriorities` in `WIP.tsx` are each used
  once, no unused exports.
- No copy-paste-without-adaptation found: the two "frozen reference" copies
  (`projectLookup.test.ts`'s `oldWay`/`sessionSurfaceParity.test.ts`'s
  `oldSessionsByCwd`/`oldProjectSessions`/`oldWayProjectForSession`) are
  intentional, comment-dated, and serve their stated regression-guard
  purpose rather than being an accidental duplicate consumer.
- i18n wiring (`client/src/i18n/index.ts` import/registration of the new
  `wip` namespace across all four locales) is a necessary consequence of
  adding a new namespace, not scope creep — it's the only way the new
  `wip.json` files actually load.
- Docs (`docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`, `README.md`
  +CN/KO/VN, `server/README.md`, `client/README.md`, `wiki/index.html`) are
  all updated consistently with the shipped shapes (route, DB column, WS
  message) — spot-checked several against the actual code and found no
  drift.
- Scope: `git diff --stat` shows no file outside the plan's named change
  set except the necessary `i18n/index.ts` registration file (not itself
  named in the plan's file list, but an unavoidable wiring point for the
  new locale namespace — not unexplained scope creep).

## Things I independently re-verified (not just re-stated from green-evidence.md)

- `npm run test:server` → 1009/1009.
- `cd client && npx vitest run` → 658/658 across 48 files.
- `cd client && npx tsc -b` → clean (confirms the verifier's one fix to
  `WIP.test.tsx`'s `FakeResizeObserver` constructor-param stuck and the
  build stays green).
- `bash .claude/skills/file-headers/scripts/check-headers.sh` → exit 0.
- `git diff --stat` on `SessionCard.tsx` and
  `KanbanBoard.projectsView.test.tsx` → both empty (zero-diff mandates
  genuinely held).
- `grep` for every `broadcast("project_updated"...)` call site → exactly
  one, matching the documented carve-out.

## Residual, already-flagged (not new, not a blocker)

`green-evidence.md` §7 already flags an untested WS-burst reorder-thrash
gap (no debounce, no test proving React 18 batching is sufficient across
separate WS message ticks) and §8 already flags the manual
visual/interactive verification pass as unperformed (no browser-automation
tooling in this environment). Both are genuine, both are already honestly
surfaced by the verifier, and neither gates this build's Definition of
Done per either plan's own text — I re-confirm both are still accurate
(re-read `WIP.tsx`: no debounce present; re-confirmed no
Playwright/Cypress/MCP browser tool available to me either). Not
re-raising these as new findings, just confirming they weren't quietly
dropped.
