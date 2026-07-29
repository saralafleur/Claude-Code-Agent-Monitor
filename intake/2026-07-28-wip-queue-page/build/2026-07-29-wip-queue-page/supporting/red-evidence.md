# Red Evidence — WIP queue page (Step 3: Test Author)

All work done in this effort's worktree:
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-07-28-wip-queue-page/Claude-Code-Agent-Monitor`
(branch `effort/2026-07-28-wip-queue-page`).

Baseline (Task 0), confirmed clean before any test file was touched (worktree
initially had no `node_modules` — `npm install` in both root and `client/`
was required first):

```
npm run test:server   → 995/995 pass
npm run test:client   → 43 files, 575/575 tests pass
```

This matches the build-brief/test-plan's cartographer count exactly, so all
tests below are new failures on top of a genuinely clean base — not
pre-existing breakage.

Per the task, `technical-plan.md`'s `session.updated_at` citation was NOT
corrected here (that's Task 1, implementer's plan-correction gate, not a test
file) — `wipQueue.test.ts`'s fixtures/assertions below are written against
the real field, `last_activity` (`client/src/lib/types.ts:698`), per the
explicit instruction.

---

## 1. `client/src/lib/__tests__/wipQueue.test.ts` (client/unit — new)

Command: `cd client && npx vitest run src/lib/__tests__/wipQueue.test.ts`

**RED confirmed** — fails at import, before any assertion runs:

```
FAIL  src/lib/__tests__/wipQueue.test.ts [ src/lib/__tests__/wipQueue.test.ts ]
Error: Failed to resolve import "../wipQueue" from "src/lib/__tests__/wipQueue.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  2  |  import { isWipMember, sortWipQueue, assignToColumns } from "../wipQueue";
     |                                                              ^
```

Reason: `client/src/lib/wipQueue.ts` does not exist yet (Task 16, not yet
built). This is the expected/plan-sanctioned red reason ("Red-first: fails
at import until Task 16 exists" — build-task-list.md Task 17). Covers:
`isWipMember` (active member; completed/error/abandoned non-member; awaiting
flag doesn't affect membership), `sortWipQueue` (awaiting-first regardless
of priority; the primary-awaiting-reason carve-out derived at runtime from
`Object.keys(AWAITING_REASON_CONFIG)` — not hand-typed — with one `it` per
reason, both primary and non-primary; the named "priority 0 beats priority
1" example; unmapped-cwd-falls-back-to-0-not-Infinity; `last_activity`
descending tertiary key with `started_at` fallback, applied to both awaiting
ties and non-awaiting ordering; `sortWipQueue(sessions.filter(isWipMember),
idx)` never surfaces a non-active session) and `assignToColumns` (the full
0/3, 1/1, 1/3, 2/3, 4/1, 4/2, 5/2, 5/3, 6/3, 7/3 boundary table, each its own
named `it`, plus the "column 1's first item is always the top-sorted item"
round-robin-rejection case).

---

## 2. `client/src/lib/__tests__/projectLookup.test.ts` (client/unit — new)

Command: `cd client && npx vitest run src/lib/__tests__/projectLookup.test.ts`

**RED confirmed** — fails at import:

```
FAIL  src/lib/__tests__/projectLookup.test.ts [ src/lib/__tests__/projectLookup.test.ts ]
Error: Failed to resolve import "../projectLookup" from "src/lib/__tests__/projectLookup.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  2  |  import { buildCwdProjectIndex, projectForSession } from "../projectLookup";
     |                                                           ^
```

Reason: `client/src/lib/projectLookup.ts` does not exist yet (Task 12). This
file was authored **before** `KanbanBoard.tsx`'s refactor, per Task
11/build-task-list's gate. Contains the MANDATORY [DERIVED-DUAL-VIEW]
frozen-reference regression case (a comment-dated, verbatim-copied `oldWay`
reference reconstructed from `KanbanBoard.tsx`'s current `sessionsByCwd`
join, ~494-502, and the Projects-view `cwds` derivation, ~707-712, at this
effort's base commit `50a2800`) run against a 5-session/3-project fixture
including one unmapped cwd, one zero-`paths` project, and one
trailing-slash cwd — plus direct `buildCwdProjectIndex`/`projectForSession`
unit coverage. Right now this fails at import for the same reason as
everything downstream of it; once `projectLookup.ts` exists it will exercise
real behavior, not "trivially pass" (both "ways" are genuinely independent
implementations from day one in this file, since `oldWay` is a frozen copy
and `projectForSession`/`buildCwdProjectIndex` are the real new module).

---

## 3. `client/src/lib/__tests__/sessionSurfaceParity.test.ts` (client/unit — new, MANDATORY)

Command: `cd client && npx vitest run src/lib/__tests__/sessionSurfaceParity.test.ts`

**RED confirmed** — fails at import:

```
FAIL  src/lib/__tests__/sessionSurfaceParity.test.ts [ src/lib/__tests__/sessionSurfaceParity.test.ts ]
Error: Failed to resolve import "../wipQueue" from "src/lib/__tests__/sessionSurfaceParity.test.ts". Does the file exist?
  2  |  import { sortWipQueue } from "../wipQueue";
     |                                ^
```

Reason: both `wipQueue.ts` and `projectLookup.ts` are missing. Authored
alongside `wipQueue.test.ts` (not deferred), per Task 18's gate. One shared
9-session fixture (every `AwaitingReason` from `AWAITING_REASON_CONFIG` —
4 non-primary + 3 primary — plus a plain active session plus a
no-mapped-project session) drives two assertions: (a) WIP's awaiting-bucket
boolean (probed through `sortWipQueue`'s real ordering against an
artificially-superior-priority sentinel session, since `wipQueue.ts` exposes
no raw boolean — documented as an explicit assumption in the file, flagged
below) matches a frozen copy of Kanban's own
`isPrimaryAwaitingReason`/`isSessionEffectivelyWaiting`; (b)
`projectLookup.projectForSession` matches a frozen copy of Kanban's own
join, plus a non-vacuity check. Once `wipQueue.ts`/`projectLookup.ts` exist,
this file specifically fails if `sortWipQueue` ever re-derives "awaiting"
instead of reusing `isSessionAwaitingInput`/the primary-reason carve-out
as-is — the standing DERIVED-DUAL-VIEW guard.

**Flag for the implementer (not a red-evidence problem, a design-contract
note):** `wipQueue.ts`'s technical-plan.md change set lists only
`isWipMember`/`sortWipQueue`/`assignToColumns` — no raw "is this session in
the awaiting bucket" boolean export. This test observes that behavior
indirectly by pitting each fixture session against a sentinel session in a
project with priority `-1_000_000` and checking which one `sortWipQueue`
ranks first (a genuinely-awaiting session always wins regardless of
priority; a non-awaiting/carved-out session never can, given the sentinel's
artificially superior priority). This is a documented assumption, not a
dictated implementation — if a direct boolean export turns out to be more
natural for `wipQueue.ts`, the probe helper can be swapped for a direct call
without changing the test's actual assertions.

---

## 4. `client/src/components/__tests__/WipSessionCard.test.tsx` (client/component — new)

Command: `cd client && npx vitest run src/components/__tests__/WipSessionCard.test.tsx`

**RED confirmed** — fails at import:

```
FAIL  src/components/__tests__/WipSessionCard.test.tsx [ src/components/__tests__/WipSessionCard.test.tsx ]
Error: Failed to resolve import "../WipSessionCard" from "src/components/__tests__/WipSessionCard.test.tsx". Does the file exist?
  3  |  const __vi_import_3__ = await import("../WipSessionCard");
     |                                       ^
```

Reason: `client/src/components/WipSessionCard.tsx` does not exist yet (Task
19). Reuses the real, unmocked `SessionCard` (mocks only
`api.sessions.transcript`, same as `SessionCard.test.tsx`), and re-asserts
`SessionCard.test.tsx`'s own yellow-Waiting-border and "Monitor"
primary-reason-label assertions as proof of composition, not
reimplementation. Also asserts an explicit project-name element (present or
"no project") and click-forwarding.

**Flag for the implementer:** this test assumes `WipSessionCard` accepts
`{ session, projectIndex, onClick? }` and renders the project name in an
element carrying `data-testid="wip-session-card-project"` — a test-author
design decision (no implementation existed to consult), documented at the
top of the file; the test-plan explicitly forbids asserting a specific
className/font-weight, so this testid is the only structural hook used.

---

## 5. `client/src/pages/__tests__/WIP.test.tsx` (client/page — new)

Command: `cd client && npx vitest run src/pages/__tests__/WIP.test.tsx`

**RED confirmed** — fails at import:

```
FAIL  src/pages/__tests__/WIP.test.tsx [ src/pages/__tests__/WIP.test.tsx ]
Error: Failed to resolve import "../WIP" from "src/pages/__tests__/WIP.test.tsx". Does the file exist?
  3  |  const __vi_import_3__ = await import("../WIP");
     |                                       ^
```

Reason: `client/src/pages/WIP.tsx` (Task 21) and `WipPrioritySidecar.tsx`
(Task 25) do not exist yet. Mounts the real `WIP` page with mocked
`api.sessions.list`/`api.projects.list`/`api.projects.reorder` but the REAL,
un-mocked `eventBus` singleton (the `SessionCard.focus.test.tsx`/
`Tabby.test.tsx` publish-then-assert pattern, per the test-plan's explicit
correction of which mock pattern to use). Covers, each its own named case:
`session_created` sorted insertion; `session_updated` setting
`awaiting_input_since` (live reorder, no re-fetch); `session_updated`
flipping status off `"active"` (removal, no re-fetch) as its **own** test,
separate from `session_deleted` (removal, no re-fetch) as a **second,
independently-named** test — not collapsed, per the plan's explicit warning
that both currently produce the same visible outcome; `project_updated`
tiebreak reorder with no session event; sidecar drag-commit calling
`api.projects.reorder` with the expected id order; the sidecar's
initial-undragged-order (priority 0 above priority 1, pre-drag); a
reload/remount round-trip proving persistence isn't optimistic-only; and
column-fill wiring only (a controllable fake `ResizeObserver` driving
1200/900/500px → 3/2/1 columns, plus a bare `window` resize event proving it
does nothing on its own).

**Flag for the implementer:** this file's own top-of-file "ASSUMED CONTRACT"
comment documents three testid conventions it depends on
(`wip-queue-container` on the `ResizeObserver`-observed element,
`wip-queue-column` per rendered column, `wip-sidecar-toggle` +
`wip-sidecar-project` for the sidecar) — none of these are dictated by
either plan document; they're this test's own reasonable, documented design
decisions and may need reconciliation with whatever `WIP.tsx`/
`WipPrioritySidecar.tsx` actually render.

---

## 6. `client/src/pages/__tests__/screens.snapshot.test.tsx` (client/snapshot — extended)

Command: `cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx`

**RED confirmed** — the whole file fails to collect (top-level ES import),
exactly mirroring this file's own documented `FocusCalendarBoard` precedent
comment already in the file:

```
FAIL  src/pages/__tests__/screens.snapshot.test.tsx [ src/pages/__tests__/screens.snapshot.test.tsx ]
Error: Failed to resolve import "../WIP" from "src/pages/__tests__/screens.snapshot.test.tsx". Does the file exist?
  8  |  const __vi_import_8__ = await import("../WIP");
     |                                       ^
```

Reason: `client/src/pages/WIP.tsx` doesn't exist. This is the same
cascading-failure shape the file already documents for how
`FocusCalendarBoard` was added (see the comment directly above the new
`import { WIP }` line) — expected, not itself evidence any other screen's
rendering changed. Added: `it("WIP", ...)` right after `"Dashboard"`
(mirrors the sidebar's planned nav order), plus `priority` support isn't
needed on the (empty) project-list fixture but `api.projects.reorder` was
added to the shared mock's `projects` block per Task 28's instruction.

Full client suite confirms no other regression:
`npm run test:client` → **6 files failed (all 6 are the new/extended files
above, all failing at import for the reasons stated), 42 files passed,
561/561 tests passed** (575 baseline − 14 tests that lived in
`screens.snapshot.test.tsx`, which now fails to collect entirely = 561; every
other previously-green test file is untouched and still green).

---

## 7. `server/__tests__/projects.test.js` (server/integration — extended)

Command: `node --test server/__tests__/projects.test.js`

**RED confirmed** for every new assertion — the pre-existing 12 tests
(Project CRUD / Folder mapping / Aggregated stats / focus-report) remain
green, unmodified. New results: **13 pass, 13 fail** (one new test, the
negative broadcast guard, is legitimately green already — see note below;
not a false green).

### Migration/default coverage (Task 4)

```
not ok - a freshly created project reads priority: 0
  Expected values to be strictly equal: undefined !== 0

not ok - a directly-inserted pre-migration-style row reads priority: 0 with no error
  Expected values to be strictly equal: undefined !== 0

not ok - re-requiring server/db.js re-runs its real guarded priority migration
         against an already-migrated DB, without throwing or duplicating the column
  Got unwanted exception: the priority column must exist (and be queryable
  with no duplicate-column error) after the real migration guard has run twice
  Actual message: "no such column: priority"
```

**Self-caught false-green, fixed before finalizing:** my first draft of the
third case wrote its own inline `try { SELECT } catch { ALTER }` guard and
asserted `doesNotThrow` on that — which passes trivially regardless of
whether `server/db.js` has any real migration, since the test's own body
would silently perform the migration itself the first time it ran. I
rewrote it to force a **second real `require("../db")`** (via
`require.cache` busting) against the already-migrated DB file, asserting
the actual production migration code doesn't throw AND that the column is
genuinely queryable afterward — this version is provably red right now (`no
such column: priority`) and will only go green once `server/db.js` actually
guards the column, at which point it validates genuine idempotency of the
real code, not a copy.

### `PUT /api/projects/reorder` happy path + validation (Tasks 5/6)

```
not ok - sets dense ranks 0..N-1 matching array order, in the exact
         { projects: [{ id, priority }] } response shape
  Expected values to be strictly equal: 404 !== 200

not ok - persists to the DB, not just the PUT echo - a follow-up GET
         /api/projects reflects the same values
  Expected values to be strictly equal: 0 !== 1

not ok - re-reordering fully replaces ranks, not additive
  Expected values to be strictly equal: 0 !== 1

not ok - a project omitted from `order` keeps its prior priority unchanged
         (partial reorder, distinct from an unknown id)
  Expected values to be strictly equal: 404 !== 200

not ok - 404s on an unknown id, naming the missing id
  Cannot read properties of undefined (reading 'code')

not ok - 400s on a duplicate id
  Expected values to be strictly equal: 404 !== 400

not ok - 400s on a non-array order
  Expected values to be strictly equal: 404 !== 400

not ok - 400s on a non-string entry
  Expected values to be strictly equal: 404 !== 400

not ok - 400s on an empty array — this test asserts the 400 choice; ...
  Expected values to be strictly equal: 404 !== 400
```

All nine fail with the Express-default `404` (route doesn't exist) or a
downstream consequence of that 404 — exactly the plan's stated red reason
("Red-first: the route 404s today"). The empty-array case asserts the `400`
branch of the explicitly-undecided choice (build-task-list Task 5); flagged
in-line as the implementer's pick-one gate, not silently assumed.

### WebSocket broadcast (Task 7)

```
not ok - a real ws client receives exactly one project_updated message
         shaped { projects: [{ id, priority }] } after a successful reorder
  timed out waiting for a "project_updated" broadcast

ok - negative: create/rename/add-path/remove-path/delete never fire
     project_updated — the documented carve-out against silent scope creep
```

The positive broadcast case is genuinely red (times out — no such broadcast
exists anywhere yet). The negative case is legitimately green **today** and
is *expected* to stay green after implementation too — it's a standing guard
against future scope creep, not a "prove this currently-missing behavior"
case, so a pre-implementation green here is correct, not a false green (no
`project_updated` broadcast exists anywhere in the codebase yet, so "no
mutation other than reorder fires it" is trivially and correctly true right
now).

Full server suite: `npm run test:server` → **996/996 − 13 new failures =
996 pass, 13 fail, 1009 total** (995 baseline + 14 new tests; the 995
previously-green tests are all still green, confirmed by full-suite diff —
no regression from this file's edits). `server/__tests__/session-liveness.test.js`
re-run unmodified and still green (part of the 996), confirming the
`session_updated`/`session_deleted` broadcast contract Task 26's WIP page
tests will depend on hasn't shifted.

---

## Summary

| File | Layer | Command | Status |
|---|---|---|---|
| `client/src/lib/__tests__/wipQueue.test.ts` | client/unit | `npx vitest run src/lib/__tests__/wipQueue.test.ts` | RED — module not found (`../wipQueue`) |
| `client/src/lib/__tests__/projectLookup.test.ts` | client/unit | `npx vitest run src/lib/__tests__/projectLookup.test.ts` | RED — module not found (`../projectLookup`) |
| `client/src/lib/__tests__/sessionSurfaceParity.test.ts` | client/unit (structural guard) | `npx vitest run src/lib/__tests__/sessionSurfaceParity.test.ts` | RED — module not found (`../wipQueue`) |
| `client/src/components/__tests__/WipSessionCard.test.tsx` | client/component | `npx vitest run src/components/__tests__/WipSessionCard.test.tsx` | RED — module not found (`../WipSessionCard`) |
| `client/src/pages/__tests__/WIP.test.tsx` | client/page | `npx vitest run src/pages/__tests__/WIP.test.tsx` | RED — module not found (`../WIP`) |
| `client/src/pages/__tests__/screens.snapshot.test.tsx` (extended) | client/snapshot | `npx vitest run src/pages/__tests__/screens.snapshot.test.tsx` | RED — module not found (`../WIP`), cascades whole file (documented precedent) |
| `server/__tests__/projects.test.js` (extended) | server/integration | `node --test server/__tests__/projects.test.js` | RED — 13 new assertions fail (missing column / 404 route / no broadcast); 1 new negative-guard test legitimately green |

Full-suite confirmation, no regression from any of the above:
- `npm run test:server` → 996 pass / 13 fail / 1009 total (995 pre-existing
  still green).
- `npm run test:client` → 561 pass / 6 files failed at import (575
  pre-existing tests still green, minus the 14 that live in
  `screens.snapshot.test.tsx`, which now fails to collect entirely as a
  documented, expected cascade).
- `bash .claude/skills/file-headers/scripts/check-headers.sh` → exit 0, all
  new files carry the required header.
