# Test Plan — wip-queue-page

> Authored by `qa-lead`, synthesizing `qa/supporting/coverage.md`, `qa/supporting/risk.md`,
> `qa/supporting/unit-tests.md`, `qa/supporting/e2e-tests.md`, and
> `qa/qa-assessment.md` (verdict: **GAPPED**). This is the buildable
> reconciliation of those four inputs — the implementer should not need to
> re-read them to execute this plan. (Plan only — a later step writes the
> tests.)

## Objective

Add the test coverage that makes WIP the **fourth** consumer of the shared
`Session`/`isSessionAwaitingInput`/`effectiveSessionStatus`/cwd→project
derivation surface without repeating this project's recurring
"multiple independent consumers silently disagree" drift (informally tracked
as **DERIVED-DUAL-VIEW**, no formal `PROJECT-CONTEXT.md` catalog exists yet —
this is its 4th occurrence: Focus Calendar-only ship → `focus-report-fidelity`
fix → `focus-calendar-board`'s 3rd-consumer parity test → now WIP). End
state: (1) WIP's "awaiting" partition and cwd→project resolution are proven,
per fixture session, to agree with Kanban's own logic via a standing
cross-consumer test, not asserted by inspection; (2) the extracted
`projectLookup.ts` join is proven behaviorally identical to the inline join
it replaces, so the one real edit to shipped code in this change (Kanban's
refactor) cannot silently regress Kanban's Projects view; (3) both
structurally distinct session-removal paths (`session_updated` status-flip,
`session_deleted`) are independently proven, not assumed to cover each other;
(4) the priority-direction convention (dense-rank, lower = higher) is pinned
at all three sites it must agree at (DB default, sort comparator, sidecar's
undragged display order); and (5) the plan document itself is corrected
before build so the implementer is not working from a spec that cites a
nonexistent `Session` field.

## Coverage gap being closed

UNGUARDED surfaces from `qa-assessment.md`'s gap diagnosis, each tied to this
project's informal defect-shape id where one applies (no formal catalog
exists):

- **Cross-consumer derivation drift** (`DERIVED-DUAL-VIEW`, 4th occurrence) —
  no standing test today proves WIP's awaiting-partition/project-resolution
  agrees with Kanban's, for any fixture session → pinned by
  `sessionSurfaceParity.test.ts`.
- **Reverse-join parity** — `projectLookup.projectForSession` is new code
  (a direction inversion of Kanban's forward `sessionsByCwd` join), not a
  verbatim lift; "extracted, therefore equivalent" is currently an assumption
  → pinned by `projectLookup.test.ts`'s frozen-reference regression case.
- **Refactor-preserves-behavior** — `KanbanBoard.tsx`'s two inline join sites
  are being edited for the first time since they shipped → pinned by an
  immediate (not deferred) unmodified re-run of
  `KanbanBoard.projectsView.test.tsx`.
- **Live-membership on two independent removal paths** — `session_updated`
  status-flip and `session_deleted` are structurally distinct WS events with
  no shared test today forcing both to be wired → pinned by two
  independently-named cases in `WIP.test.tsx`.
- **`technical-plan.md`'s `session.updated_at` field reference** — the plan
  cites a field that doesn't exist on the client `Session` interface
  (`client/src/lib/types.ts:662-716`; only `last_activity` exists,
  `server/routes/sessions.js:173/227`) — a hand-maintained schema reference
  drifted from the artifact it describes, this project's recurring
  "plan cites a field by hand, no mechanical cross-check" root cause → closed
  by correcting the plan document itself (not just the test fixtures) before
  the sort module is implemented.
- **Priority-direction convention integrity** — three independent sites (DB
  default, `sortWipQueue` comparator, sidecar's undragged initial order) must
  agree on "lower = higher," and only two of the three are reachable by
  `wipQueue.test.ts`'s pure-function coverage → pinned by a named-example
  unit test plus a rendered-output assertion of the sidecar's initial order.
- **No stale/ambiguous broadcast scope creep** — `project_updated` is a
  deliberate, narrow exception to "project mutations are plain CRUD, not
  broadcast" → pinned by an explicit negative test (rename/path-add/
  path-remove/delete must never fire it).
- **WS broadcast-content trusted-by-convention gap** (repo-wide, closed here
  for one endpoint) — no server test in this repo opens a real WebSocket
  client to verify a broadcast frame; the reorder endpoint's server test
  closes this specific instance via a real `ws` client.
- **Real-browser container-width breakpoint proof** — **accepted, documented
  limitation, not closed by this plan.** No Playwright/Cypress exists in this
  repo and jsdom has no layout engine; see "Honest scope limit" below.

## Test change set

Layers as this project actually has them (per `coverage.md`'s discovery): a
client pure-logic layer (`client/src/lib/__tests__/`), a client
component/page layer (`client/src/components/__tests__/`,
`client/src/pages/__tests__/`), and a server integration layer
(`server/__tests__/`, real HTTP + real SQLite per file — this repo's "e2e"
equivalent, since no browser e2e tool exists).

**Client — pure logic (`client/src/lib/__tests__/`)**

- `wipQueue.test.ts` (new) — `isWipMember`: active member, completed/error/
  abandoned non-member, awaiting-flag doesn't affect membership.
  `sortWipQueue`: awaiting-first regardless of priority; the
  primary-awaiting-reason carve-out (loop derived from
  `Object.entries(AWAITING_REASON_CONFIG).filter(([, c]) => c.primary)`, not
  a hand-typed list) excludes `subagent`/`shell`/`monitor` from the awaiting
  bucket the same way Kanban does, while `notification`/`stop`/
  `session_start`/`interrupted` remain in it; secondary key is project
  `priority` ascending (**named-example assertion: "project priority 0 must
  rank above project priority 1," not just "priorities sort"**); unmapped
  cwd falls back to priority `0` (not `Infinity`); tertiary key is
  **`last_activity` descending, fallback `started_at`** (corrected field —
  see Implementation step 2 below); `sortWipQueue(sessions.filter(isWipMember), idx)`
  never surfaces a non-`active` session. `assignToColumns`: exact
  contiguous-chunk boundary table (0/3, 1/1, 1/3, 2/3, 4/1, 4/2, 5/2, 5/3,
  6/3, 7/3 — each its own named `it(...)`), plus "column 1's first item is
  always the top-sorted item" to reject a round-robin-but-plausible wrong
  implementation.
- `projectLookup.test.ts` (new) — `buildCwdProjectIndex`: every mapped cwd
  resolves to its owning project (reference-equal), unmapped cwd absent from
  the map (not `undefined`-valued), zero-`paths` project doesn't throw.
  `projectForSession`: resolves the owning project; `undefined` for
  `cwd: null`; `undefined` for an unmapped cwd. **Frozen-reference regression
  test** (`describe("regression: matches KanbanBoard's pre-extraction inline
  join")`): a comment-dated, verbatim-copied snapshot of the current
  `KanbanBoard.tsx:492-493`/`:707-712` inline join, run against a shared
  ≥5-session/≥3-project fixture set including one unmapped cwd, one
  zero-`paths` project, and one trailing-slash cwd; assert `newWay` (via
  `projectForSession`/`buildCwdProjectIndex`) equals `oldWay` (the frozen
  reference) for every fixture session's resolved project id. **This file
  must exist and pass trivially before the `KanbanBoard.tsx` refactor lands**
  (both "ways" are the same code at that point) — see Implementation step 4.
- `sessionSurfaceParity.test.ts` (new, non-negotiable per plan §5/§6.3) —
  one shared ≥8-session fixture array (not two independently-authored sets)
  covering every non-primary awaiting reason, every primary awaiting reason
  (derived from `AWAITING_REASON_CONFIG`, same pattern as `wipQueue.test.ts`),
  a plain active non-awaiting session, and a session whose cwd maps to no
  project. Two assertions, each a single loop over the shared fixture with a
  per-session failure message naming the session id and reason: (a) WIP's
  awaiting-bucket boolean matches Kanban's own primary-awaiting-reason-aware
  bucketing for every session; (b) `projectLookup.projectForSession` resolves
  to the same project id Kanban's own (now-shared, post-refactor)
  `projectForSession` call resolves to, for every session — plus a
  non-vacuity check (at least one resolved project is defined, at least one
  is `undefined`) so this assertion can't pass trivially on an
  all-`undefined` fixture bug.

**Client — component (`client/src/components/__tests__/`)**

- `WipSessionCard.test.tsx` (new) — renders the project name prominently
  (in a distinct, assertable wrapper element) when `cwd` resolves to a
  project; renders an explicit "no project" state when it doesn't (assert
  it, don't leave it unconfirmed); reuses the real `SessionCard` (not
  mocked) and asserts the same badge/waiting-reason text
  `SessionCard.test.tsx`/`SessionCard.focus.test.tsx` already assert on, as
  proof the fork composes rather than reimplements; forwards click/nav
  behavior identically to bare `SessionCard`. Do **not** assert a specific
  className/font-weight — per the change brief, no particular visual
  treatment is a hard pass/fail criterion; assert presence of a distinct
  project-name element only.

**Client — page (`client/src/pages/__tests__/`)**

- `WIP.test.tsx` (new) — mounts the real `WIP` page with a **mocked `api`**
  but the **real, un-mocked `eventBus`** singleton (the pattern
  `SessionCard.focus.test.tsx`/`Tabby.test.tsx` use, publishing directly via
  `eventBus.publish(...)`; **not** the no-op `eventBus` mock in
  `screens.snapshot.test.tsx`/`KanbanBoard.projectsView.test.tsx`, which
  never invokes a handler and cannot drive a publish-then-assert test — this
  is a correction to `technical-plan.md`/`qa.md`'s cited pattern, not a new
  requirement). Cases:
  - `session_created` (active, non-awaiting) → card appears in correctly
    sorted position.
  - `session_updated` setting `awaiting_input_since` → card live-reorders to
    the top of its priority tier, no `api.sessions.list`/`api.projects.list`
    re-fetch (assert mock call counts unchanged).
  - **`session_updated` flipping `status` off `"active"` → card removed
    immediately, no re-fetch.** *(Required assertion, named separately from
    the next one — see Implementation step 9.)*
  - **`session_deleted` → card removed immediately, no re-fetch.** *(Required
    assertion, its own independently-named test case — must not be collapsed
    into the status-flip case above; both currently produce the same visible
    outcome, which is exactly why implementation pressure could merge them
    into one test that only proves one of the two code paths.)*
  - `project_updated` with a new priority order (no session event) → queue
    tiebreak order changes live.
  - Sidecar drag commit (`dragStart`/`dragOver`/`dragEnd`, no `dataTransfer`
    mock needed — same shape as `KanbanBoard.projectsView.test.tsx`'s
    existing monitor-box drag) → `api.projects.reorder` called with the
    expected id order.
  - **Sidecar's initial, undragged display order matches the priority
    convention** (project `priority: 0` renders above `priority: 1`,
    pre-drag) — this is the third site named in risk.md that
    `wipQueue.test.ts`'s pure-function coverage cannot reach; it must be
    proven as a rendered-output assertion here, not assumed from the
    comparator test alone.
  - Reload round-trip: after a drag commits, unmount/remount against mocked
    list data reflecting the post-drag priorities → queue renders in the new
    order, proving persistence isn't optimistic-only local state.
  - Column-fill **wiring** only (fake `ResizeObserver`, per Honest scope
    limit below): firing the container observer at 1200/900/500px yields
    3/2/1 columns, with `window.innerWidth` left untouched, and a bare
    `window resize` event with no observer callback fires no change — proves
    the page reads container width, not viewport width. Exhaustive fill-math
    boundaries are `wipQueue.test.ts`'s job, not repeated here.
- `screens.snapshot.test.tsx` (extend, existing file) — add one
  `it("WIP", ...)` case following the file's own documented
  `FocusCalendarBoard` precedent (mocked API incl. `priority`/
  `api.projects.reorder`, no-op `eventBus`, empty fixtures; `ResizeObserver`
  is already globally stubbed in this file, no new stub needed), placed
  right after Dashboard to mirror the sidebar nav order. Run the full
  snapshot suite before *and* after the `Sidebar.tsx` nav-entry change;
  review (never blindly `-u`) any diff in other screens' snapshots touching
  sidebar chrome.
- `KanbanBoard.projectsView.test.tsx` (unmodified re-run) — **run
  immediately after the `projectLookup.ts` extraction step, not deferred to
  the end.** See Implementation step 5.
- `SessionCard.test.tsx`, `SessionCard.focus.test.tsx` (unmodified re-runs) —
  regression proof that `WipSessionCard`'s fork left `SessionCard.tsx` with
  zero behavioral drift.

**Server (`server/__tests__/projects.test.js`, extend existing file — not a
new sibling file, matching this file's existing per-route-on-one-router
convention)**

- Migration/default: fresh project reads `priority: 0`; a directly-inserted
  pre-migration-style row (bypassing the route) reads `priority: 0` with no
  error; re-invoking the migration guard a second time doesn't throw or
  duplicate the column (mirrors the existing `source`-column idempotency
  proof).
- `PUT /api/projects/reorder` happy path: dense ranks `0..N-1` matching
  array order, exact response shape, a follow-up `GET /api/projects`
  reflects the same values (DB round-trip, not just the PUT echo);
  re-reordering fully replaces ranks (not additive); a project omitted from
  `order` keeps its prior priority unchanged (partial reorder is valid,
  distinguished from "unknown id" which 404s).
- Validation: unknown id → `404 NOT_FOUND` naming the missing id; duplicate
  id → `400 INVALID_INPUT`; non-array `order` → `400`; non-string entry →
  `400`; empty array → whichever the implementation actually does (see
  Implementation step 8 — pick one and assert it, don't let the test and
  implementation quietly agree on an undocumented choice).
- Broadcast: a real `ws` client connected to the same server (`ws` is
  already a runtime dependency, no new package) receives exactly one
  `project_updated` message shaped `{ projects: [{ id, priority }] }` after
  a successful reorder — this closes, for this one endpoint, the repo-wide
  "broadcast trusted by convention only" gap (`monitors_updated`'s own
  precedent test only checks the HTTP response, never opens a socket).
  **Negative test:** attach the same kind of `ws` client, then `POST /`
  (create), `PATCH /:id` (rename), `POST /:id/paths`, `DELETE /:id/paths/:id`,
  and `DELETE /:id` each — assert no `project_updated` message arrives for
  any of them, closing the documented carve-out against silent scope creep.
- Regression re-run: `server/__tests__/session-liveness.test.js` unmodified —
  confirms the `session_updated`-status-flip / separate-`session_deleted`
  event contract WIP's client removal logic depends on hasn't shifted.

**Fixtures / test data**

- `wipQueue.test.ts`/`projectLookup.test.ts`: local `makeSession`/
  `makeProject` builders modeled on `SessionCard.test.tsx`'s `makeSession`.
- `projectLookup.test.ts`'s regression case additionally needs the
  comment-dated frozen reference function (verbatim copy of the pre-refactor
  join — written before the refactor lands, not re-derived from memory).
- `sessionSurfaceParity.test.ts`: one shared ≥8-session fixture array,
  primary-reason subset derived from `AWAITING_REASON_CONFIG`.
- `projects.test.js` extension: this file's existing `post`/`patch`/`del`
  helpers + a new `put` helper (copy `monitors.test.js`'s `put`); real
  throwaway SQLite DB per this file's existing `before`/`after` pattern.
- `WipSessionCard.test.tsx`: reuse `SessionCard.test.tsx`'s `makeSession` +
  a minimal `Project`/project-index fixture.

**Layer move, stated explicitly:** the unit and e2e architects' designs
already split correctly and this plan keeps that split rather than
re-litigating it — exhaustive `sortWipQueue`/`assignToColumns`
permutations and the full column-fill boundary table live only in
`wipQueue.test.ts` (pure, cheapest place to pin them); `WIP.test.tsx` proves
only the *wiring* (one representative fill at each of 3/2/1 columns, and
that container-width — not viewport — drives it), and does not repeat the
boundary-math table. Similarly, exhaustive `PUT /reorder` validation
permutations live in `projects.test.js`; no e2e-layer file re-asserts them.
Nothing was moved between the two architects' proposals — they already
agreed on this split; this plan confirms it as binding so an implementer
doesn't duplicate the exhaustive cases into `WIP.test.tsx` "for safety."

## Implementation steps

Each numbered step is independently checkable and red-first: the failure
mode before the step, and what makes it pass after, is stated inline.
Sequencing follows `technical-plan.md` §4's dependency order, with the
QA-mandated corrections/gates inserted at the exact points they must land.

1. **Establish clean baseline.** Run `npm run test:server && npm run
   test:client` before touching anything. Must be green (cartographer
   confirmed 995/995 server, 575/575 client today) — if not, stop; this
   plan assumes a clean starting point.
2. **Correct `technical-plan.md` §3/§6.1 before or during the sort-module
   step (gating, not optional).** Replace the `session.updated_at` /
   `session.updated_at (fallback started_at)` tertiary-key reference with
   **`last_activity` (fallback `started_at`)** — `Session.updated_at` does
   not exist on `client/src/lib/types.ts:662-716`; the only recency field is
   `last_activity` (`server/routes/sessions.js:173/227`), which every other
   consumer already reads. This must be a correction to the plan document
   itself, not just to the test fixtures — if left as-is, an implementer
   building from the plan literally either ships `Session.updated_at` as an
   always-`undefined` field (tertiary sort silently becomes arbitrary for
   every queue member) or quietly renames the test fixtures to agree with
   the wrong field, at which point the test would agree with the bug
   instead of catching it. Do this **before or during** step 6 below
   (`wipQueue.ts`'s implementation) — not after, and not left implicit in a
   test-design doc's grounding note as it is today.
3. **Schema/migration** (`server/db.js`) — guarded `priority` migration.
   Red-first: `SELECT priority FROM projects` fails today (column absent).
   Verify by booting against the dev DB and confirming `GET /api/projects`
   echoes `priority: 0` for every existing row.
4. **API/broadcast** (`server/routes/projects.js`) — `stmts.setProjectPriority`,
   `PUT /reorder`, `project_updated` broadcast. Red-first: the route 404s
   today (Express default handler). Verify with a manual round-trip before
   client code depends on the response shape.
5. **Client types/API client** — `Project.priority`,
   `ProjectPriorityUpdatedPayload`, `WSMessage` union entry,
   `api.projects.reorder`. Hard dependency gate: do not start step 6+
   against a guessed shape.
6. **Write `projectLookup.test.ts`'s frozen-reference regression case
   FIRST, before the `KanbanBoard.tsx` refactor lands.** Copy the current
   `KanbanBoard.tsx:492-493`/`:707-712` inline join verbatim into the test
   file as a comment-dated reference function. Red-first: at this point the
   test passes trivially (both "ways" are literally the same code) — this
   is expected, not a false pass; it becomes meaningful the moment
   `projectLookup.ts` exists with any subtly different join semantics.
7. **Extract `client/src/lib/projectLookup.ts` and refactor
   `KanbanBoard.tsx`'s two inline join sites to use it.** Immediately after
   this step (same commit/PR step, not deferred):
   - **Run `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx`
     immediately, before writing anything WIP-specific.** It must pass
     unmodified. This is not optional and not satisfied by "green by the end
     of the build" — it is the only thing standing between "clean
     extraction" and a silent Kanban regression, and `risk.md`/
     `technical-plan.md` both name this exact sequencing as required.
   - Run the rest of `projectLookup.test.ts` (`buildCwdProjectIndex`,
     `projectForSession` direct cases) — red-first: they fail at import
     until `projectLookup.ts` exists.
   - Confirm the frozen-reference regression case from step 6 now compares
     two genuinely independent implementations (not the same code twice) and
     still passes — if it fails here, the extraction changed behavior; fix
     `projectLookup.ts`, not the reference copy.
8. **`wipQueue.ts` + `wipQueue.test.ts`.** Implement `isWipMember`,
   `sortWipQueue` (using the **corrected** `last_activity` tertiary key from
   step 2), `assignToColumns`. Red-first: every case fails at import until
   the module exists; the awaiting-reason-carve-out and priority-direction
   named-example cases specifically fail against a plausible-but-wrong
   implementation (re-derived "awaiting" logic, or a naive priority-first
   comparator), which is their purpose.
9. **Author `sessionSurfaceParity.test.ts` now, alongside this step — not
   deferred to the end.** Per `qa-assessment.md`'s explicit must-add #3:
   write it as soon as `wipQueue.ts` exists (this step), using the
   registry-derived fixture set and both required assertions (awaiting-
   partition parity, project-resolution parity). Red-first: fails today
   because none of `wipQueue.ts`/`projectLookup.ts` exist; once they do, it
   specifically fails if `sortWipQueue` ever re-derives "awaiting" instead of
   reusing `isSessionAwaitingInput`/`sessionAwaitingReason` as-is — this is
   the standing guard against DERIVED-DUAL-VIEW recurring a 5th time.
10. **`WipSessionCard.tsx` + `WipSessionCard.test.tsx`.** Can run in
    parallel with step 8 once step 7's lookup helper exists. Red-first:
    fails at import until built; the project-name/"no project" cases
    specifically discriminate a component that never wired
    `projectForSession` from one that wired it backwards.
11. **`WIP.tsx` page + nav/route/i18n**, wiring steps 5-10 together.
12. **`WipPrioritySidecar.tsx`** — DnD copied from `KanbanBoard.tsx`,
    committing to `api.projects.reorder`.
13. **`WIP.test.tsx`.** Author all cases from the Test change set above,
    explicitly including — as **two separately-named test cases, not one**
    — the `session_updated` status-flip removal and the `session_deleted`
    removal. Red-first: an implementation that only wires one of the two WS
    event handlers passes the other test's setup but fails its specific
    removal assertion; this is the exact failure mode that "one collapsed
    removal test" would hide, since both events currently produce the same
    visible end state (card gone) and a lazy single test could pass by
    accident on whichever path was actually wired. Also include the
    sidecar's initial-undragged-order rendered assertion (the third
    priority-direction site) and the fake-`ResizeObserver` wiring cases.
14. **Server: extend `projects.test.js`** with migration/default,
    happy-path/validation, real-`ws`-client broadcast, and negative
    scope-creep cases. Red-first: every reorder-endpoint assertion fails
    today at the "route doesn't exist" / "column doesn't exist" level.
15. **`screens.snapshot.test.tsx`** — add the `"WIP"` case. Run full suite
    before and after the `Sidebar.tsx` nav change; review any sidebar-chrome
    diff by hand.
16. **Full regression confirmation.** Re-run `KanbanBoard.projectsView.test.tsx`
    (again — second, final confirmation, not just step 7's), `SessionCard.test.tsx`,
    `SessionCard.focus.test.tsx`, `session-liveness.test.js` unmodified.
17. **Manual verification** (`npm run dev`) — per `technical-plan.md` §6's
    script, including resize-with-sidecar-open. This is the **only**
    mitigation for the column-fill real-browser gap (see Honest scope limit
    below) — it is required, not a nice-to-have, for this one surface.
18. **Docs sync** (`docs/DATABASE.md`, `docs/API.md`, `ARCHITECTURE.md`,
    `README.md`+CN/KO/VN, `server/README.md`, `client/README.md`, `wiki/`)
    and the file-header audit — last, once shapes are final facts.

## Single-source-of-truth guardrail

This project has no formal registry/config file, but it has a functional
equivalent that this plan treats with the same discipline: **`projectLookup.ts`
is the single canonical cwd→project join** that both Kanban (refactored) and
WIP (new) must consume — no second, WIP-only join may exist. The tests
enforce this two ways, not by inspection:

1. `projectLookup.test.ts`'s frozen-reference regression case proves the new
   join produces the same output as the pre-refactor inline logic it
   replaces, for every fixture session, including edge cases (null cwd,
   trailing-slash, zero-path project).
2. `sessionSurfaceParity.test.ts` proves, post-refactor, that Kanban's own
   call site and WIP's call site resolve to the same project for every
   fixture session — once step 7 lands, both literally call the same
   function, and the parity test's non-vacuity check guards against that
   becoming a tautological pass.

No test may "bless" a hand-edited path that bypasses `projectLookup.ts` —
if `WIP.tsx` or `WipSessionCard.tsx` is ever found computing its own
cwd→project resolution instead of calling `projectForSession`, that is a
build defect, not an acceptable variant, and `sessionSurfaceParity.test.ts`
is specifically designed to catch it (a re-derived resolution would very
likely diverge from the shared one on at least one adversarial fixture).

## Durable-cure decision

**Adding the structural cure now**, not just point tests — per
`qa-assessment.md`'s explicit call: this plan builds `sessionSurfaceParity.test.ts`
(registry-derived, shared-fixture, adversarial-case cross-consumer guard)
and `projectLookup.ts`'s extract-not-copy + frozen-reference regression test,
which is the same durable mechanism that closed the prior Focus List/Calendar
occurrence of this drift shape. This is the correct, already-designed answer
to DERIVED-DUAL-VIEW for *this* consumer pair (Kanban↔WIP).

**Consequence of what remains deferred:**
- This durable cure does **not** retroactively close the still-open
  Kanban↔Focus List/Focus Calendar parity gap — that gap is pre-existing and
  out of this change's scope, but it means DERIVED-DUAL-VIEW is only
  partially closed project-wide even after this build lands.
- The mechanism is currently enforced by four conscientious evaluators
  converging on it again, not by a written rule. Recommend (per
  `qa-assessment.md`'s open decision) promoting DERIVED-DUAL-VIEW to a formal
  `PROJECT-CONTEXT.md` defect-class catalog entry at this, its 4th
  occurrence, so a 5th consumer inherits an enforced check rather than
  relying on the next evaluator noticing independently. This is a follow-up
  recommendation, not a gate on shipping WIP.
- For the field-drift gap (`session.updated_at`): the durable fix here is
  the plan correction in Implementation step 2, applied now. No process
  change is included in this plan to make "grep-verify every field a plan
  cites" mandatory going forward — flagging that as a separate, cheap
  process improvement worth adopting, not part of this test plan's scope.

## Honest scope limit: column-fill real-browser proof

**This repo has no real-browser e2e tooling** (no Playwright/Cypress
anywhere in the repo; confirmed by direct search). The single highest-risk
visual case in this plan — the sidecar shrinking the queue container
independent of viewport width, and the column count actually dropping at a
real 768/1024px threshold in a real browser — **cannot be proven by any
automated test in this repo as it exists today.**

What this plan actually proves at that boundary: `WIP.test.tsx`'s
fake-`ResizeObserver` wiring cases (step 13) prove the page's column count is
driven by the container's reported width, not `window.innerWidth` — i.e.
they prove the *wiring is correct*. They cannot prove the sidecar's real DOM
geometry actually produces a narrower container in a real layout engine,
because jsdom has no layout engine and no real `ResizeObserver`.

**The only mitigation beyond the jsdom wiring test is the manual verification
step already named in `technical-plan.md` §6** ("resize-with-sidecar-open...
the one place a viewport-only trigger would have silently misbehaved"),
executed as Implementation step 17 above. This is stated here explicitly as
an **accepted, documented limitation of this build's test coverage** — not a
silently dropped requirement and not something a passing `WIP.test.tsx` run
should be read as having closed. If this gap needs to become
automated-test-provable, that requires a separate infrastructure decision
(adding Playwright/Cypress to this repo), which is out of scope for this
change and this test plan.

## How to run

Discovered from `package.json`/`client/package.json` (no `PROJECT-CONTEXT.md`
configured for this repo):

- **Baseline (run first):** `npm run test:server && npm run test:client`
- **Server, full suite:** `npm run test:server` (→ `node --test
  server/__tests__/*.test.js`)
- **Server, this feature's file only:** `node --test
  server/__tests__/projects.test.js`
- **Client, full suite:** `npm run test:client` (→ `cd client && npm test`,
  i.e. `vitest run`)
- **Client, fast iteration on the new pure-logic specs:** `cd client && npx
  vitest run src/lib/__tests__/wipQueue.test.ts
  src/lib/__tests__/projectLookup.test.ts src/lib/__tests__/sessionSurfaceParity.test.ts`
- **Client, page spec only:** `cd client && npx vitest run
  src/pages/__tests__/WIP.test.tsx`
- **Client, component spec only:** `cd client && npx vitest run
  src/components/__tests__/WipSessionCard.test.tsx`
- **Snapshot suite (review diffs, never blind `-u`):** `cd client && npx
  vitest run src/pages/__tests__/screens.snapshot.test.tsx`; regenerate only
  after reviewing: `cd client && npx vitest run -u`
- **File-header audit (binding per `CLAUDE.md`):** `bash
  .claude/skills/file-headers/scripts/check-headers.sh`
- **Manual verification:** `npm run dev`, then follow the seeded-session
  script in `technical-plan.md` §6, explicitly including resize-with-
  sidecar-open (the only mitigation for the Honest scope limit above).

## Definition of Done

- [ ] `technical-plan.md` §3/§6.1 corrected: `session.updated_at` →
      `last_activity` (fallback `started_at`) — done before or during the
      `wipQueue.ts` implementation step, not left implicit.
- [ ] `projectLookup.test.ts`'s frozen-reference regression case written
      **before** the `KanbanBoard.tsx` refactor lands, and still passing
      after it lands.
- [ ] `KanbanBoard.projectsView.test.tsx` run and green **immediately after**
      the `projectLookup.ts` extraction step (not deferred to the end), and
      again at final regression confirmation.
- [ ] `sessionSurfaceParity.test.ts` authored alongside the `wipQueue.ts`
      step (not deferred to the end), with the registry-derived
      primary-reason loop and both required assertions (awaiting-partition
      parity, project-resolution parity), including the non-vacuity check.
- [ ] `WIP.test.tsx` contains **two independently-named** test cases for the
      two removal signals (`session_updated` status-flip, `session_deleted`)
      — confirmed not collapsed into one.
- [ ] `WIP.test.tsx` contains the sidecar's initial-undragged-order rendered
      assertion (the third priority-direction site).
- [ ] Every new test observed RED before its corresponding implementation
      landed, GREEN after (per the red-first notes in Implementation steps).
- [ ] Server: `projects.test.js` extension includes the real-`ws`-client
      broadcast assertion and the negative no-broadcast-on-other-mutations
      case.
- [ ] Empty-array `PUT /reorder` behavior (400 vs. documented no-op) is
      explicitly decided and the test asserts whichever was actually
      implemented — not a guess left unreconciled with `docs/API.md`.
- [ ] `projectLookup.ts` confirmed as the single call site for cwd→project
      resolution in both `KanbanBoard.tsx` and `WIP.tsx`/`WipSessionCard.tsx`
      — no second, hand-rolled join introduced anywhere in this change.
- [ ] Full suite green: `npm run test:server` and `npm run test:client`.
- [ ] Manual verification script performed at least once, including
      resize-with-sidecar-open — the column-fill real-browser gap is
      explicitly accepted as documented-limitation-plus-manual-check, not
      silently treated as fully automated-test-covered.
- [ ] `SessionCard.tsx` has zero diff in this change set (confirmed via
      `SessionCard.test.tsx`/`SessionCard.focus.test.tsx` passing unmodified).
- [ ] File-header audit passes on every new file (`wipQueue.ts`,
      `projectLookup.ts`, `WipSessionCard.tsx`, `WipPrioritySidecar.tsx`,
      `WIP.tsx`, and every new `*.test.ts(x)` above).
- [ ] Docs synced (`docs/DATABASE.md`, `docs/API.md`, `ARCHITECTURE.md`,
      `README.md`+CN/KO/VN, `server/README.md`, `client/README.md`, `wiki/`)
      once the reorder route/broadcast/column shape is final.
