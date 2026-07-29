# Unit / Parity Test Design — WIP Queue Page (pre-build)

> Scope: the fast, deterministic layer only — `node:test` (server) and
> `vitest` (client). Page-level `WIP.tsx` WS-liveness tests and the
> `screens.snapshot.test.tsx` "WIP" case are already specced in
> `technical-plan.md` §6.4/§6.5 and are out of scope for this document by
> request; everything below is implementable by a later build step without
> re-deriving anything from the plan.

## Grounding note (read before implementing `wipQueue.ts`)

`technical-plan.md` §3/§6.1 specifies `sortWipQueue`'s tertiary key as
`session.updated_at` (fallback `started_at`). **`Session.updated_at` does not
exist on the client `Session` TypeScript interface**
(`client/src/lib/types.ts:662-716`). The only documented recency field is
`last_activity?: string` (a join-only computed column — same value, aliased
server-side: `server/routes/sessions.js:173/227`,
`SELECT s.*, COUNT(a.id) as agent_count, s.updated_at as last_activity`).
Every other existing consumer's recency sort already reads `last_activity`,
never a typed `updated_at` (grep confirms no `.updated_at` read anywhere in
`KanbanBoard.tsx` or `client/src/lib/*.ts`). **Test design below asserts on
`last_activity` (fallback `started_at`)** — if the implementer instead adds
`updated_at` to the `Session` interface, treat that as a deliberate,
documented type change (update `docs/DATABASE.md`/`API.md` accordingly) and
adjust the fixtures' field name to match; don't let `session.updated_at` ship
as silently-always-`undefined` in a `Session`-typed function.

---

## 1. `client/src/lib/wipQueue.ts` — sort/tiebreak + column-fill

**Spec file:** `client/src/lib/__tests__/wipQueue.test.ts` (new; naming
matches sibling pure-fn specs in the same dir, e.g. `calendarLanes.test.ts`,
`eventBuckets.test.ts`).

Isolation: pure functions, no DOM/render, no API/WS mocks — import
`isWipMember`, `sortWipQueue`, `assignToColumns` directly and call them with
in-memory fixtures. Import the real `isSessionAwaitingInput`,
`sessionAwaitingReason`, `AWAITING_REASON_CONFIG` from `../types` (never
re-mock them) so the test exercises the actual shared predicates, not a
stand-in.

### Fixture builders (put at top of the spec file)
```ts
function makeSession(overrides: Partial<Session> = {}): Session { ... }
function makeProject(overrides: Partial<Project> = {}): Project { ... }
```
Follow `SessionCard.test.tsx`'s `makeSession` shape (id, name, status, cwd,
model, started_at, ended_at, metadata, plus optional
awaiting_input_since/awaiting_reason/last_activity).

### `isWipMember`
| Case | Input | Assertion |
|---|---|---|
| active session is a member | `status: "active"` | `isWipMember(s) === true` |
| completed session is not | `status: "completed"` | `=== false` |
| error session is not | `status: "error"` | `=== false` |
| abandoned session is not | `status: "abandoned"` | `=== false` |
| membership ignores awaiting flag | `status: "active", awaiting_input_since: null` | `=== true` (awaiting-ness is a sort concern, not a membership concern — pins that the two never get conflated in one function) |

Red-first: before `isWipMember` exists, every case fails on import. Once
implemented as anything *other than* a strict `status === "active"` check
(e.g. someone "helpfully" also excludes awaiting sessions, or includes
`abandoned`), the completed/error/abandoned/awaiting-ignored cases catch it.

### `sortWipQueue` — primary key (awaiting-first)
- **"awaiting-input session sorts above a non-awaiting session regardless of
  project priority"** — `sessA` (awaiting, project priority `5`), `sessB`
  (not awaiting, project priority `0`, i.e. B's project is objectively
  higher-priority). Assert `sortWipQueue([sessB, sessA], idx)` returns
  `[sessA, sessB]`.
  - Red-first: a naive priority-first comparator (sort by priority, then
    awaiting) would return `[sessB, sessA]` — wrong. This fails until
    awaiting-input is genuinely the primary (not secondary) key.

### `sortWipQueue` — the primary-awaiting-reason carve-out (must reuse Kanban's)
- **"a session awaiting only because of a `primary` reason (`subagent`/
  `shell`/`monitor`) is treated as NOT in the awaiting bucket, same as
  Kanban"** — `sessA` (`awaiting_input_since` set, `awaiting_reason:
  "subagent"`, i.e. `AWAITING_REASON_CONFIG.subagent.primary === true`),
  `sessB` (not awaiting at all). Assert `sessA` does **not** get the
  awaiting-bucket priority boost over `sessB` — i.e. ordering between them
  falls through to the project-priority/recency tiebreak exactly as if
  neither were "awaiting," not to the awaiting-first primary key.
- **"a session awaiting for a non-primary reason (`notification`) IS in the
  awaiting bucket"** — same shape, `awaiting_reason: "notification"` —
  asserts it DOES rank above a non-awaiting sibling.
- Repeat the non-boost case for `"shell"` and `"monitor"` in a
  `for (const reason of ["subagent", "shell", "monitor"])` loop — this is
  the registry-completeness angle: every `primary: true` entry in
  `AWAITING_REASON_CONFIG` must be exercised, not just `"subagent"`. Prefer
  deriving the loop directly from
  `Object.entries(AWAITING_REASON_CONFIG).filter(([, c]) => c.primary)`
  rather than a hand-typed list, so a future new `primary` reason is
  automatically covered without anyone remembering to add a case here.
  - Red-first: if `sortWipQueue` re-derives "awaiting" as bare
    `isSessionAwaitingInput(s)` without importing/applying
    `isPrimaryAwaitingReason`/`sessionAwaitingReason`'s carve-out logic (the
    exact drift this feature's cross-consumer discipline exists to
    prevent), the `subagent`/`shell`/`monitor` cases wrongly rank above
    their non-awaiting sibling — this is the assertion that pins it.

### `sortWipQueue` — secondary key (project priority, ascending)
- **"among awaiting sessions, lower project priority number wins"** —
  `sessA` (awaiting, project priority `3`), `sessB` (awaiting, project
  priority `1`). Assert order `[sessB, sessA]`.
- **"among non-awaiting sessions, lower project priority number wins"** —
  same shape, neither awaiting.
- **"a session whose cwd doesn't resolve to any project is treated as
  priority 0"** — `sessA` cwd unmapped (→ `projectForSession` returns
  `undefined`), `sessB` mapped to a project with explicit `priority: 0`.
  Assert they tie on the secondary key (both fall to the tertiary
  recency key) — pins the `?? 0` fallback exactly, not e.g. `Infinity`
  (which would silently sink every unmapped session to the bottom).

### `sortWipQueue` — tertiary key (`last_activity` desc, fallback `started_at`)
- **"same-priority awaiting sessions tie-break by most-recent `last_activity`
  first"** — both on project priority `2`, `sessA.last_activity` earlier than
  `sessB.last_activity`. Assert `[sessB, sessA]`.
- **"same-priority non-awaiting sessions tie-break the same way"** — mirror
  case with `awaiting_input_since: null` on both.
- **"falls back to `started_at` when `last_activity` is absent"** — both
  sessions omit `last_activity`; `sessA.started_at` earlier than
  `sessB.started_at`. Assert `[sessB, sessA]`.
- **"a session with `last_activity` set outranks one without it, recency-wise,
  even if the other's `started_at` is later"** — pins that the fallback is
  per-session (only used when that session's own `last_activity` is
  missing), not a blanket "ignore `last_activity` if any session lacks it."

### `sortWipQueue` — composition / membership boundary
- **"a non-`active` session passed into `sortWipQueue` is never reordered
  into the output ahead of active ones as if it were a tie"** — actually:
  confirm the documented contract explicitly. Since `isWipMember` is a
  separate exported function (§ above) and `sortWipQueue` takes an
  already-filtered list per the plan's signature
  (`sortWipQueue(sessions, projectIndex)`), add one integration-of-the-two
  case: `sortWipQueue(sessions.filter(isWipMember), idx)` on a fixture set
  containing one `completed` session — assert the completed session's id is
  absent from the result. This is the exact case DoD/§6.1 calls "a
  non-`active` session never appears in output," expressed as composition of
  the two exported functions rather than an undocumented third filtering
  responsibility inside `sortWipQueue` itself.

### `assignToColumns<T>` — contiguous-chunk fill, exact boundary math
Isolation: call with plain `string[]`/`number[]` fixtures (e.g.
`["a","b","c"]`), not `Session[]` — this function is generic and has no
session-shape dependency; keep the test that way so it can't accidentally
start asserting sort behavior instead of fill behavior.

| `n` (items) | `columnCount` | Expected columns (0-indexed item ids) |
|---|---|---|
| 0 | 3 | `[[], [], []]` |
| 1 | 1 | `[[0]]` |
| 1 | 3 | `[[0], [], []]` |
| 2 | 3 | `[[0], [1], []]` |
| 4 | 1 | `[[0,1,2,3]]` |
| 4 | 2 | `[[0,1], [2,3]]` |
| 5 | 2 | `[[0,1,2], [3,4]]` (chunk size `ceil(5/2)=3`) |
| 5 | 3 | `[[0,1], [2,3], [4]]` (chunk size `ceil(5/3)=2`) |
| 6 | 3 | `[[0,1], [2,3], [4,5]]` |
| 7 | 3 | `[[0,1,2], [3,4,5], [6]]` (chunk size `ceil(7/3)=3`; last column absorbs the remainder) |

Each row is its own `it(...)` naming the exact `n`/`columnCount` pair (e.g.
`it("7 items into 3 columns: 3/3/1", ...)`) so a future regression pinpoints
exactly which boundary broke.

- **"column 1 always contains the highest-priority (row-0) item"** — for
  every non-empty case above, assert `columns[0][0] === sortedItems[0]`.
- Red-first: a plausible-but-wrong round-robin implementation
  (`item[i] → column[i % columnCount]`) passes the naive "3 columns exist"
  smoke check but fails essentially every row above except the `columnCount
  === 1` ones (e.g. for `n=7, columnCount=3` round-robin puts items
  `0,3,6` in column 1, not `0,1,2`) — that's precisely the discriminating
  power this table is designed to have, per the plan's "testable at exact
  column-count boundaries" framing.

---

## 2. `client/src/lib/projectLookup.ts` — shared cwd→project join

**Spec file:** `client/src/lib/__tests__/projectLookup.test.ts` (new).

Isolation: pure functions over plain `Project[]`/`Session` fixtures, no
render, no API mock.

### `buildCwdProjectIndex(projects: Project[]): Map<string, Project>`
- **"maps every mapped cwd across every project's `paths` to its owning
  project"** — two projects, each with 2 `paths`; assert the returned map
  has 4 entries, each value `=== ` (reference-equal to) the correct project
  object.
- **"a cwd mapped to no project is simply absent from the map"** (not
  present as `undefined`-valued) — `map.has(cwd)` is `false`, not
  `map.get(cwd) === undefined` via an explicit falsy set.
- **"duplicate/malformed input doesn't throw"** — a project with an empty
  `paths: []` array is skipped without error; the function never assumes
  every project has ≥1 path.

### `projectForSession(session, index)`
- **"resolves to the project owning the session's `cwd`"**.
- **"returns `undefined` for a session whose `cwd` is `null`"**.
- **"returns `undefined` for a session whose `cwd` doesn't appear in the
  index"** (unassigned bucket case).

### Regression: byte-identical output vs. the pre-refactor `KanbanBoard.tsx` inline join
This is the specific case requested to prove the extraction didn't silently
change behavior, in addition to (not instead of) re-running
`KanbanBoard.projectsView.test.tsx` unmodified per plan step 4.

- **Add to `projectLookup.test.ts`:** `describe("regression: matches
  KanbanBoard's pre-extraction inline join")`. Reconstruct the exact
  pre-refactor logic as an inline reference function *inside the test file*
  (a frozen copy of the current `sessionsByCwd`-based join —
  `KanbanBoard.tsx:492-493`/`:707-712` — copied verbatim as a comment-dated
  snapshot, not re-derived from memory), then assert, over a shared fixture
  set of ≥5 sessions/≥3 projects (including one unmapped cwd, one project
  with zero paths, and one cwd with a trailing slash to specifically probe
  the "differing on trailing-slash handling" risk the plan itself names in
  §5):
  ```ts
  const oldWay = referenceInlineJoin(sessions, projects); // frozen copy of pre-refactor logic
  const newWay = sessions.map((s) => projectForSession(s, buildCwdProjectIndex(projects))?.id);
  expect(newWay).toEqual(oldWay.map((p) => p?.id));
  ```
  Assert on `.id` equality (or full deep-equality of the resolved project
  objects) for every session in the fixture set, not just a subset —
  "byte-identical" here means: for every fixture session, the two code
  paths resolve to the same project id (or both `undefined`), with no
  divergence on the trailing-slash / empty-paths edge cases.
- Red-first: this test is written and reference-copied **before** the
  `KanbanBoard.tsx` refactor lands (per plan step 4/5 ordering) so the
  reference function is a true, unmodified snapshot of current behavior. It
  passes trivially before the refactor (both "ways" are the same code,
  literally). It becomes meaningful red-first coverage the moment
  `projectLookup.ts` is implemented with any subtly different join
  semantics (e.g. normalizing trailing slashes when the original didn't, or
  vice versa) — that's exactly when this test must fail, proving it
  actually pins parity rather than passing vacuously forever.

---

## 3. `client/src/lib/__tests__/sessionSurfaceParity.test.ts` — cross-consumer guard

**Spec file:** `client/src/lib/__tests__/sessionSurfaceParity.test.ts` (new,
per plan §5/§6.3 — non-negotiable per DoD).

Isolation: imports `sortWipQueue`/`isWipMember`/`projectForSession` from the
new modules, plus reconstructs (or imports, if extracted as a testable
helper) Kanban's own `isPrimaryAwaitingReason`-aware "waiting" bucketing
predicate and its cwd→project resolution — both exercised against **one
shared fixture array** (sessions + projects), not two separately-authored
fixture sets, so there's no way for the two "the same fixtures" claims to
quietly diverge. No render, no DOM — this is comparing two in-memory
derivations against each other and against the fixtures, not comparing
rendered markup.

### Fixture set (shared across every case in this file)
A ≥8-session fixture covering, deliberately: (a) awaiting for each
non-primary reason (`notification`, `stop`, `session_start`, `interrupted`),
(b) awaiting for each primary reason (`subagent`, `shell`, `monitor`), (c) a
plain active non-awaiting session, (d) a session whose cwd maps to no
project. Derive the primary-reason list programmatically from
`AWAITING_REASON_CONFIG` (as in §1) so a newly-added reason is automatically
included here too, per this project's "registry-derived meta-test" pattern.

### Assertions
- **"WIP's awaiting partition matches Kanban's own primary-awaiting-reason-
  aware bucketing for every fixture session"** — for each fixture session,
  compute `wipIsAwaiting = <the boolean WIP's sort treats as "in the
  awaiting bucket">` and `kanbanIsWaiting = isEffectivelyWaiting`-equivalent
  logic (reuse Kanban's actual exported/extractable predicate if step 4's
  refactor exposes one; otherwise the frozen reference copy pattern from §2
  applies here too — comment-dated snapshot of
  `KanbanBoard.tsx`'s `isEffectivelyWaiting`/`isPrimaryAwaitingReason`).
  Assert `wipIsAwaiting === kanbanIsWaiting` for **every** session in the
  fixture array via a single loop with a per-session failure message
  (`` `mismatch for session ${s.id} (reason=${s.awaiting_reason})` ``) so a
  failure names exactly which fixture session/reason diverged, not just
  "some assertion in the array failed."
- **"`projectLookup.projectForSession` resolves to the same project
  Kanban's own (now-shared) join resolves to, for every fixture session"**
  — same shared-fixture, same per-session loop pattern, comparing resolved
  project `id` (or `undefined`) between the two call sites. Once step 4's
  refactor lands, both sides literally call the same `projectForSession`
  function — at that point this assertion is a tautology *unless* a napkin
  test asserts the values are non-trivially populated (i.e. add one
  assertion that at least one resolved project is non-`undefined` and at
  least one is `undefined`, so the test can't pass vacuously on an
  all-`undefined` fixture bug).
- Red-first: authored (per plan step 9, but the awaiting-partition half can
  and should be written as soon as `wipQueue.ts` exists, i.e. alongside step
  5, not deferred to step 9) so that if `wipQueue.sortWipQueue` is ever
  implemented with a re-derived "is this awaiting" check instead of reusing
  `isSessionAwaitingInput`/`sessionAwaitingReason`, this test fails
  immediately — this is the standing guard the plan calls "the test that
  would have caught the Focus List/Calendar drift two days ago."

---

## 4. Server — `projects.priority` column + `PUT /api/projects/reorder`

**Spec file:** extend `server/__tests__/projects.test.js` in place (new
`describe` blocks, following this file's existing `node:test`/
`node:assert/strict` + raw-`http` request-helper convention already in the
file — reuse its existing `fetch`/`post`/`patch`/`del` helpers, add a `put`
helper mirroring `server/__tests__/monitors.test.js`'s `put`). Do not create
a new sibling file — this is additive coverage on an existing router's
existing test file, matching how `PATCH /:id` is already covered there.

Isolation: real `createApp()`/`startServer()` against a throwaway
`DASHBOARD_DB_PATH` (this file's own existing pattern) — a genuine SQLite
round-trip, not mocked, since the exact thing under test (migration
idempotency + persisted-column round-trip) requires a real DB file. No
live WebSocket client is needed for the broadcast assertion — inspect the
broadcast the same way `server/__tests__/session-liveness.test.js` or
`monitors.test.js` do (whatever this repo's existing pattern is for
asserting a broadcast fired: check for an injectable/spy-able `broadcast`
export, or a `ws` test client if that's the file's established approach —
match whichever `monitors.test.js` (the closest precedent, same
bulk-write-then-broadcast shape) actually uses).

### Migration idempotency + default value
- **"a fresh DB's `GET /api/projects` returns `priority: 0` for a
  newly-created project"** — `post("/api/projects", {name: "P"})`; assert
  `created.body.project.priority === 0`.
- **"an existing pre-priority-migration project reads `priority: 0` with no
  error"** — this specifically pins the DoD's "manual boot check" as an
  automated test rather than only a manual step: insert a project via
  `stmts.insertProject.run(...)` directly (bypassing the route, simulating
  a pre-existing row), then `GET /api/projects` and assert its `priority
  === 0`. (Since `beforeEach`/fresh-DB semantics in this file create the
  column from scratch already, this case is really about the guarded
  `ALTER TABLE` idiom being exercised at least once by *some* test in the
  suite touching a DB file that predates the column — if this repo's test
  harness always starts from a brand-new DB file per suite, note this as a
  narrower "default value is 0, full migration-on-existing-DB-file replay is
  the manual boot-check step in DoD, not re-provable by this harness" and
  don't fake a false sense of migration coverage.)
- **"running the migration block twice against the same DB connection does
  not throw or duplicate the column"** — call the module's migration guard
  a second time (import and re-invoke, or re-require after the column
  already exists) and assert `SELECT priority FROM projects LIMIT 1` still
  resolves cleanly — mirrors this exact idempotency shape already proven for
  the `source` column migration (`server/db.js:977-981`); the `priority`
  migration is a copy of that idiom, so this test proves it was copied
  correctly (same try/catch/`ALTER TABLE` guard), not just written once and
  never re-run.

### `PUT /api/projects/reorder` — happy path (dense-rank renumbering)
- **"sets dense ranks 0..N-1 matching array order"** — create 3 projects
  `A`, `B`, `C`; `put("/api/projects/reorder", { order: [C.id, A.id, B.id]
  })`; assert response `{ projects: [{id: C.id, priority: 0}, {id: A.id,
  priority: 1}, {id: B.id, priority: 2}] }` (exact shape, exact order,
  exact 0-indexed ranks) and a follow-up `GET /api/projects` reflects the
  same three priorities.
- **"reordering again with a different array fully re-ranks (not additive/
  incremental)"** — second `put` with `[B.id, C.id, A.id]`; assert the
  first reorder's ranks are fully superseded (`B:0, C:1, A:2`), not merged
  with the previous ranks — pins that this is a full dense-rank replace,
  not a patch.
- **"a project not named in the reorder array keeps its last-set priority
  unchanged"** — create a 4th project `D` never included in either `order`
  array above; assert its `priority` is untouched (still `0`, its default) —
  pins the endpoint's scope to exactly the ids given, no implicit
  renumbering of everything else.

### Validation
- **"unknown id → 404 `NOT_FOUND` naming the missing id"** —
  `put("/api/projects/reorder", { order: [A.id, "does-not-exist"] })`;
  assert `status === 404`, `body.error.code === "NOT_FOUND"`, and (matching
  this file's existing message-content convention, e.g. the `paths` 404s)
  assert the message names the specific missing id
  (`assert.match(res.body.error.message, /does-not-exist/)`).
- **"duplicate id in the array → 400 `INVALID_INPUT`"** —
  `order: [A.id, A.id, B.id]`; assert `status === 400`,
  `body.error.code === "INVALID_INPUT"`.
- **"`order` not an array → 400"** — `{ order: "not-an-array" }`.
- **"`order` containing a non-string entry → 400"** — `{ order: [A.id, 42]
  }`.
- **"empty array → 400 `INVALID_INPUT`"** — per the change-brief's QA
  guidance (pick 400 for consistency with this file's existing
  empty/missing-field validation conventions, e.g. the `POST /` empty-name
  400): `put("/api/projects/reorder", { order: [] })`; assert `status ===
  400`. **If the build instead implements empty-array-as-no-op (200, no
  writes), flip this single assertion to match — do not silently keep
  asserting 400 against a 200-returning implementation; whichever is
  actually shipped, the test must assert it explicitly** (this is exactly
  the ambiguity the change-brief flagged as "pick one and assert it").
  Either way, also assert no project's `priority` changed as a result of an
  empty-array call (whether that's because it 400'd before touching the DB,
  or because the no-op path is a genuine no-op).
- **"a request whose ids collectively omit some existing projects still
  succeeds (partial reorder is allowed)"** — distinguishes "duplicate/
  unknown id → error" from "not naming every project → fine"; already
  partially covered by the "keeps unchanged priority" case above, but assert
  the response status is `200`, not an error, for a deliberately-partial
  valid array.

### Broadcast shape
- **"a successful reorder both responds with and broadcasts exactly
  `{ projects: [{ id, priority }] }`, containing only the reordered ids"**
  — assert the broadcast payload's `projects` array has the same length and
  content as the response body's `projects` array (same ids/priorities, in
  rank order) — no extra fields, no unrelated projects included.
- **"no other project mutation triggers `project_updated`"** — one test per
  other mutation path in this router: `POST /` (create),
  `PATCH /:id` (rename), `POST /:id/paths` (add folder),
  `DELETE /:id/paths/:pathId` (remove folder), `DELETE /:id` (delete). For
  each, assert no `project_updated` broadcast fires (spy/hook into whatever
  broadcast mechanism the `monitors_updated` precedent uses for its own
  "only expected messages fire" coverage, if it has one — otherwise, assert
  the operation succeeds and skip a broadcast-content assertion for these,
  but keep the test's *name* explicit about what it's confirming (no
  broadcast), so a future scope-creep change fails obviously when someone
  looks at what these tests were meant to pin). This directly guards the
  test-invariant "no stale/ambiguous broadcast scope creep" from the
  change-brief.

Red-first note (whole section): all of the above fails at the "route
doesn't exist" level today — `PUT /api/projects/reorder` returns 404 from
Express's default handler, and `priority` is absent from every `GET
/api/projects` project object, so every assertion above fails until both
the migration and the route are implemented. The dense-rank-exact-order and
"unrelated project untouched" cases specifically discriminate a correct
implementation from a plausible-but-wrong one (e.g. an implementation that
increments existing priorities instead of a dense 0..N-1 replace, or one
that renumbers every project in `stmts.listProjects.all()` order instead of
the given array's order).

### Regression re-run (no new code, verification-only)
- Re-run `server/__tests__/session-liveness.test.js` unmodified — confirms
  the `session_updated`-with-new-`status` / no-separate-delete-event
  contract for lifecycle transitions (that WIP's client-side removal logic
  depends on) hasn't shifted. Nothing to author here; just confirm it's
  green in the same `npm run test:server` run before calling this section
  done.

---

## 5. `client/src/components/WipSessionCard.tsx`

**Spec file:** `client/src/components/__tests__/WipSessionCard.test.tsx`
(new; naming/location matches `SessionCard.test.tsx`,
`SessionCard.focus.test.tsx` in the same directory).

Isolation: `render()` with Testing Library inside a `MemoryRouter` (matching
`SessionCard.test.tsx`'s `renderCard` helper exactly — reuse/copy its
`makeSession` fixture builder rather than re-deriving field defaults). Mock
`../../lib/api` the same minimal way `SessionCard.test.tsx` does (only the
`transcript` call it might trigger via the wrapped `SessionCard`) — do
**not** mock `SessionCard` itself; the whole point of "wraps `SessionCard`
unmodified" is that this test renders the real one.

### Assertions
- **"renders the project name prominently when the session's cwd resolves to
  a project"** — pass a `session` + a `projects: Project[]` (or
  pre-built `projectIndex`, matching whatever prop shape the component
  actually takes) where `session.cwd` maps to project `"Agent Monitor"`;
  assert the rendered project name text is present (`screen.getByText("Agent
  Monitor")`) and, per the plan's "visually more prominent" requirement,
  assert it renders in the specific wrapper element the implementation adds
  (e.g. `screen.getByText("Agent Monitor").closest("[data-testid=
  wip-project-header]")` or equivalent — whatever concrete markup marker the
  implementation uses; don't assert on a specific Tailwind class/font-weight
  value per the change-brief's explicit non-blocking framing that no
  particular size/weight choice is a hard pass/fail criterion — assert
  *presence of a distinct project-name element*, not its exact styling).
- **"renders 'Unassigned'/no project header when the session's cwd doesn't
  resolve to any project"** — mirrors Kanban's own Unassigned-bucket
  language if reused, or asserts the header region is simply absent/empty —
  whichever the implementation does, assert it explicitly rather than
  leaving the no-project case unconfirmed.
- **"reuses `SessionCard` unmodified — the wrapped card renders
  `SessionStatusBadge` with the session's effective status"** — for a
  session with `awaiting_input_since` set, assert the same "Waiting"-style
  badge text/reason chip that `SessionCard.test.tsx`/`SessionCard.focus.
  test.tsx` already assert on for the bare `SessionCard`. This is the
  regression-style proof that `WipSessionCard` didn't fork `SessionCard`'s
  internals — it composes the real component, so its badge behavior is
  identical without this file re-testing badge logic itself.
- **"forwards `onClick`/other pass-through props to the inner
  `SessionCard`"** — click the rendered card and assert the same navigation/
  callback behavior `SessionCard.test.tsx` already proves for `SessionCard`
  directly (e.g. clicking navigates via the same handler) — confirms the
  wrapper doesn't swallow interaction props while adding its header.
- **"`SessionCard.tsx` has zero edits"** — not a test in this spec file
  (there is nothing to assert on inside a snapshot for "this file has no
  diff") — this is a DoD/PR-review check, already listed in
  `technical-plan.md` §8; note it here only so this spec doesn't
  redundantly try to encode it as a broken assertion. Rely on
  `SessionCard.test.tsx`/`SessionCard.focus.test.tsx`'s unmodified re-run
  (per plan §6.6) as the actual regression proof of "unedited and still
  behaves the same," not a diff-detection unit test.

Red-first: fails at import (`WipSessionCard.tsx` doesn't exist yet) until
built; once built, the "renders project name" and "Unassigned" cases
specifically discriminate a component that never wired `projectForSession`
at all (would render neither) from one that wired it backwards (always
shows a name, even for unassigned cwds).

---

## Fixtures / test data summary

| Spec | Fixture source |
|---|---|
| `wipQueue.test.ts` | Local `makeSession`/`makeProject` builders in-file, modeled on `SessionCard.test.tsx`'s `makeSession` |
| `projectLookup.test.ts` | Same builders; regression case additionally needs a frozen-copy reference function (comment-dated snapshot of `KanbanBoard.tsx`'s pre-refactor join, ~:492-493/:707-712) |
| `sessionSurfaceParity.test.ts` | One shared ≥8-session fixture array covering every `AwaitingReason` value (derive the primary subset from `AWAITING_REASON_CONFIG` programmatically) |
| `projects.test.js` extension | This file's existing `post`/`patch`/`del` helpers + a new `put` helper (copy `monitors.test.js`'s `put`); real throwaway SQLite DB per this file's existing `before`/`after` pattern |
| `WipSessionCard.test.tsx` | Reuse `SessionCard.test.tsx`'s `makeSession`; add a minimal `Project`/project-index fixture |

## How to run

- Server: `npm run test:server` (runs `node --test server/__tests__/*.test.js`
  — the extended `projects.test.js` runs automatically as part of this glob,
  no new command needed).
- Client: `npm run test:client` (runs `cd client && npm test`, i.e.
  `vitest run` — all five new/extended client spec files above run
  automatically as part of this).
- Establish a clean baseline first, per the technical plan's own
  instruction: `npm run test:server && npm run test:client` before any of
  the above files exist, to confirm nothing is already red.
- After `client/src/lib/wipQueue.ts`/`projectLookup.ts` land, `wipQueue.
  test.ts`/`projectLookup.test.ts` can be run in isolation for fast
  iteration: `cd client && npx vitest run src/lib/__tests__/wipQueue.test.ts
  src/lib/__tests__/projectLookup.test.ts`.
- File-header audit (binding per `CLAUDE.md`) on every new spec file:
  `bash .claude/skills/file-headers/scripts/check-headers.sh`.

## Summary of what each layer pins (for quick cross-reference)

- **`wipQueue.test.ts`** pins the awaiting-first / priority-ascending /
  recency-descending three-key sort order and the exact contiguous-chunk
  column-fill boundary math — the plan's named top risk (§7, "priority
  convention inversion").
- **`projectLookup.test.ts`** pins the extracted join's behavior plus a
  literal byte-identical-output regression against the pre-refactor
  `KanbanBoard.tsx` inline logic — guards "refactor-preserves-behavior."
- **`sessionSurfaceParity.test.ts`** pins cross-consumer agreement between
  WIP and Kanban on both "is this session awaiting" and "which project does
  this resolve to" — this project's #1 recurring drift shape per the
  change-brief (Focus List/Calendar precedent), with no formal catalog id.
- **`projects.test.js` extension** pins the `priority` column's default/
  migration-safety and the reorder endpoint's dense-rank correctness,
  validation, and broadcast scope (guards "no stale/ambiguous broadcast
  scope creep").
- **`WipSessionCard.test.tsx`** pins that the fork genuinely composes
  `SessionCard` (badge/interaction behavior identical) while adding a
  distinct, assertable project-name element — without asserting a specific
  visual treatment, per the change-brief's explicit non-blocking framing.
