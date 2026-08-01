# Coverage Map — 2026-07-31-focus-untracked-commits

> Authored by `qa-coverage-cartographer`. Maps *existing* test coverage for
> the surfaces this change touches, verdicts per surface, and the current
> green/red baseline actually observed. Does not propose new tests or judge
> risk — see the unit/e2e architects and `risk.md` for that.

## Test stack (discovered)

This project has two test layers, no browser-e2e layer for these surfaces:

- **Server** — Node's built-in test runner (`node --test server/__tests__/*.test.js`),
  run via `npm run test:server`. Flat `server/__tests__/` directory, one file
  per module/route-group (e.g. `focus-report.test.js` tests
  `server/lib/focus-report.js`; `focus-report-route.test.js` tests
  `server/routes/focus-report.js` over real HTTP via `createApp`/`startServer`).
- **Client** — Vitest + React Testing Library, run via `npm run test:client`
  (`cd client && npm test`, which is `vitest run`). Convention: a sibling
  `__tests__/` directory next to the source file
  (`client/src/components/__tests__/Foo.test.tsx`,
  `client/src/pages/__tests__/Foo.test.tsx`). **No `client/src/hooks/__tests__/`
  directory exists yet** — `useHourWindowZoom.ts` is the first hook under
  `client/src/hooks/` that would get one.
- No dedicated integration/e2e suite and no project/tag/bucket convention
  (smoke vs regression) found for either layer — every test in both suites
  runs as one flat pass.

`PROJECT-CONTEXT.md` (as of this check) only has a `## Repo topology`
section — no test-stack notes and no `## Recurring defect-class patterns`
registry yet (this plan's own forward work adds the latter).

## Current baseline (run 2026-07-31)

- `npm run test:server` → **1047/1047 pass**, 236 suites, 0 fail. Matches
  the brief's stated baseline exactly.
- `cd client && npx vitest run` (full suite) → **645/645 pass**, 51 files.
  Matches the brief's stated baseline exactly.
- Targeted client re-run (the five files touching the named surfaces):
  `npx vitest run src/components/__tests__/FocusReportModal.test.tsx
  src/components/__tests__/FocusCalendarView.test.tsx
  src/pages/__tests__/FocusPage.test.tsx
  src/pages/__tests__/FocusCalendarBoard.test.tsx
  src/components/__tests__/FocusActivityCard.test.tsx` →
  **114/114 pass**, 5 files, no failures, no "Maximum update depth exceeded"
  stderr observed in this run (consistent with the live-cascade bug only
  reproducing under a longer-lived live-zoom mount than these tests exercise
  — see the render-stability gap below, not evidence the bug is absent).
- Nothing was un-runnable; no service dependency blocked either suite.

## Existing coverage by surface

### FocusCalendarView / FocusCalendarBoard / FocusReportBody / FocusReportModal
- `client/src/components/__tests__/FocusCalendarView.test.tsx` (49 tests) —
  extensive: blocks, lanes, idle stripes, quarter-hour snapping, Scratch
  Work bundling, board-mode additive props, and its own
  `describe("hour-window zoom (default 4h back + 2h ahead)")` block
  (lines 1044–1301) exercising the **hook's behavior through the component**
  (default 4h window, wider presets, 24h full-day, future-pad, quick-start
  presets, future-window warning) — not the hook in isolation.
- `client/src/components/__tests__/FocusReportModal.test.tsx` (23 tests) —
  loading/error/empty states, on-item % math, idle time, concurrency-ratio
  tile (including the swap-primary/localStorage-persistence flow — this is
  today's only real coverage of `ConcurrencyStatTile`), inferred-session
  badging, List/Calendar view-mode toggle, and two **standing-template
  cross-render-parity tests**:
  - `"[standing template] List and Calendar views render the same
    wall-clock/agent-time numbers..."` — parity between `FocusReportModal`'s
    own List and Calendar sub-views, same report object.
  - `"[board-mode extension of the standing template] FocusReportBody
    renders modal-shaped and board-shaped props with identical stat-tile
    numbers..."` — parity between `FocusReportModal`'s modal-shaped
    `FocusReportBody` render and a board-shaped one (mirrors
    `FocusCalendarBoard`'s props), asserting identical stat-tile values and
    idle-stripe geometry.
  - Both are explicitly documented as "extend THIS test, not a page-local
    one" for future `FocusReportBody` consumers — **but `FocusPage` is not
    one of the two shapes exercised here.** `FocusPage` mounts its own
    stat-tile/activity-card markup directly (not via `FocusReportBody`), so
    even extending this test file wouldn't add `FocusPage` parity without a
    third, `FocusPage`-shaped branch.
- `client/src/pages/__tests__/FocusCalendarBoard.test.tsx` (12 tests) —
  default state, the three independent filters never clearing each other
  (DEC-2), zero-result edge cases, DEC-6 aggregate concurrency relabel via
  i18n. Uses `FocusReportBody` under the hood (per the modal test's
  board-shaped branch above), so board-vs-modal parity is covered
  transitively, but this file itself asserts nothing about numeric parity —
  it asserts on filter-independence and i18n keys.
- `client/src/pages/__tests__/FocusPage.test.tsx` (20 tests) — its own
  first-load default, loading/empty/error states, stat tiles matching
  `FocusReportBody`'s on-item/off-plan **formula** (asserted independently,
  not against a shared fixture with the modal/board), activity-card
  rendering, project-label-prefix toggling, the AI window-summary block, the
  "currently active status" resolver, and its own
  `describe("hour-window zoom")` block mirroring
  `FocusCalendarView.test.tsx`'s equivalent block but with `FocusPage`'s own
  fixtures — **not the same fixture as the modal/board tests, so no test
  anywhere feeds one `FocusReport` fixture into `FocusPage` AND
  `FocusReportModal`/`FocusCalendarBoard` and diffs the output.**

**Verdict: PARTIAL.** Each of the four consumers is well-guarded
individually (any per-consumer regression in its own math or state handling
would be caught). The specific behavior named at risk in the brief —
`FocusPage` producing different numbers than `FocusReportModal`/
`FocusCalendarBoard` from the *same* fixture — has **no assertion anywhere**.
This is exactly the `DERIVED-DUAL-VIEW` gap the brief calls out, and it's a
registry/consistency gap in the sense of the standing-template pattern:
`FocusReportModal.test.tsx`'s own two standing-template tests are the
project's canonical registry of "which shapes get cross-checked," and
`FocusPage` has no entry in it — an UNGUARDED gap even though every
surrounding test is green.

### `/focus` stakeholder page (`FocusPage.tsx`)
Covered by `client/src/pages/__tests__/FocusPage.test.tsx` (20 tests, see
above) for its own internal correctness. **GUARDED** for FocusPage-local
regressions (default fetch params, stat-tile formula, activity card,
project-label toggling, AI summary block, active-status resolver, its own
hour-window zoom wiring). **PARTIAL** as the second half of the
cross-consumer pairing above (no fixture-parity assertion against the other
three consumers).

### `server/lib/focus-inference.js`'s `buildActivityDigest()`
- `server/__tests__/focus-inference.test.js`, `describe("buildActivityDigest")`
  (lines 157–181) — two tests: collects prompts/files/commands correctly,
  and returns `null` for a session with no judgeable activity. Both fixtures
  insert events via `addEvent`/`addPrompt`/`addFileEdit`/`addBash` in plain
  sequential order, where insertion order and `created_at` order always
  agree — **neither test constructs an out-of-order `id`-vs-`created_at`
  fixture** (e.g. a bulk `workflow-ingest.js`-style insert landing
  after-the-fact rows at high `id` but with an earlier `created_at`).
- Confirmed still live on `master`: `buildActivityDigest()`
  (`server/lib/focus-inference.js:123`) reads
  `ORDER BY id ASC LIMIT ?` — the exact `row-id-as-chronology-proxy` shape
  already fixed once in `buildSessionFocusReport` (`server/lib/focus-report.js:439-441`,
  commit `b3a2cc9`) and now cited by the brief as a third instance.

**Verdict: UNGUARDED for the specific defect.** The function has tests and
they are green, but green here is a false signal — the fixture shape that
would expose the bug (out-of-order `id` vs `created_at`) is not constructed
anywhere in the suite. **Registry/consistency gap:** per the plan's own
pending `PROJECT-CONTEXT.md` catalogue entry `row-id-as-chronology-proxy`
(§9.2, not yet added), this is the third confirmed instance of the same
defect class on this codebase (prior: `6e9a443`, `b3a2cc9`) and, per the
brief, the worst one — the bad ordering happens at the SQL `LIMIT` boundary,
so it can select the *wrong subset* of events, not just present a correct
subset out of order (a post-sort wouldn't fully repair it). Any test plan
should flag: an entry in this soon-to-be-added defect-class registry with no
corresponding assertion in `focus-inference.test.js` is itself an UNGUARDED
finding, independent of the suite's green baseline.

### `server/lib/focus-report.js`'s interval-building path (loop-push /
stack-overflow fix, `60af828`)
- `server/__tests__/focus-report.test.js` — large `describe` suite (`buildActivityChunks`,
  `clipSegmentToWindow`, `buildSessionFocusReport`, `buildProjectFocusReport`,
  `mergeIntervals`, etc.) exercising `activeIntervals`'s output correctness
  extensively, but **no test in this file (grepped for `65536`/`65,536`/
  `RangeError`/`stack`) constructs a session with enough events to push
  `intervals` past V8's spread-as-arguments ceiling (~65,536)**. The fixed
  code (`server/lib/focus-report.js:449-453`, `for (const interval of
  intervals) sessionActiveIntervalsMs.push(interval)`) is exercised at
  normal scale only.

**Verdict: UNGUARDED at the scale that matters.** The fix is shipped and the
surrounding logic is heavily tested, but the actual regression scenario (a
session with unusually high event volume) has zero coverage — a revert to
`sessionActiveIntervalsMs.push(...intervals)` would pass every existing test
in this file and only fail in production.

### `/api/settings/export` streaming route (`server/routes/settings.js`,
bundled with `60af828`)
- `server/__tests__/api.test.js:57` — `/api/settings/export` appears only in
  `EXPECTED_API_PATHS`, a route-registration/shape check (confirms the path
  is mounted), not a functional test of its response body or streaming
  behavior.
- `server/__tests__/data-transfer.test.js` — thorough round-trip coverage
  (export/import, idempotency, multi-machine merge) of `buildExportBundle`/
  `importExportBundle` in `server/lib/data-transfer.js`. **This module is
  not used by the route at all** — confirmed via `grep` that
  `server/routes/settings.js` never `require`s `../lib/data-transfer`; the
  `GET /export` handler (`settings.js:432-469`) uses its own locally defined
  `writeJsonArray()` streaming helper directly against
  `db.prepare(...).iterate()`. The similarly-named files test two unrelated
  implementations of "export the DB as JSON" — one streaming (the live
  route, untested), one whole-object (a separate backup/restore path,
  well-tested).

**Verdict: UNGUARDED.** No test calls `GET /api/settings/export` and
inspects its actual response — not the streamed shape, not the
`Content-Disposition` header, not error-mid-stream handling
(`settings.js:462-467`, which can only `res.end()` without a JSON error body
since headers are already flushed). `data-transfer.test.js`'s green result
provides no signal for this route.

### `useHourWindowZoom.ts` / `HourWindowZoomBar.tsx`
- No isolated hook or component test exists (`client/src/hooks/__tests__/`
  doesn't exist yet; no `HourWindowZoomBar.test.tsx` under
  `client/src/components/__tests__/`).
- Indirect coverage only, through both consumers' own integration tests:
  `FocusCalendarView.test.tsx`'s `describe("hour-window zoom ...")` block
  (lines 1044–1301, ~13 tests: default window, wider presets, 24h,
  future-pad, per-day custom offsets, Live toggle visibility, quick-start
  presets, future-window warnings) and `FocusPage.test.tsx`'s
  `describe("hour-window zoom")` block (lines 687–824, 3 tests: default
  unzoomed, narrowing both stat tiles and activity card together,
  restoring on zoom-out). Both exercise real hook behavior end-to-end but
  **only under fake timers with `vi.useFakeTimers()`** — neither advances
  fake timers past `ZOOM_REFRESH_MS` (60s) to actually trigger the
  `forceRefresh` interval tick, and neither asserts on render count or
  console/stderr output.

**Verdict: PARTIAL.** Windowing math/behavior is well-guarded through both
consumers. The render-cascade defect itself — `forceRefresh`'s bump-counter
recomputing `windowStartMs`/`windowEndMs` from raw `Date.now()` on every
render while live-zoomed, not just on the 60s tick — is **UNGUARDED**: no
existing test renders long enough (real or advanced-fake timers) to trigger
repeated re-renders, and none inspects `console.error`/stderr output, which
is exactly where "Maximum update depth exceeded" would currently surface
silently per the brief's own Definition-of-Done note.

### `ConcurrencyStatTile.tsx` / `StatTile.tsx`
- No dedicated test file for either (no `ConcurrencyStatTile.test.tsx` or
  `StatTile.test.tsx` under `client/src/components/__tests__/`).
- `ConcurrencyStatTile` gets substantial indirect coverage via
  `FocusReportModal.test.tsx`: the `CONCURRENCY_PRIMARY_KEY` import, the
  swap-primary toggle, localStorage persistence across mounts, the
  while-active sub-line, and the wall-clock-zero fallback dash are all
  asserted there (5+ tests touch this component directly). `StatTile` is
  exercised as a generic rendering primitive across `FocusReportModal.test.tsx`,
  `FocusCalendarBoard.test.tsx`, and `FocusPage.test.tsx` (every "Total
  active/idle agent time" / on-item-% assertion renders through it) but
  never in isolation — no test targets `StatTile`'s own prop contract
  (e.g. `sub` styling variants) directly.

**Verdict: PARTIAL.** `ConcurrencyStatTile`'s behavior is meaningfully
guarded today (a regression in the swap/persist logic would be caught by
`FocusReportModal.test.tsx`), but only through one consumer's integration
test, not a presentational unit test of the tile itself — a prop-contract
regression that `FocusReportModal`'s specific fixtures don't exercise (e.g.
an edge-case prop combination) could still slip through. `StatTile` is
rendered everywhere but has no isolated assertion surface at all.

## Registry/consistency gap check

This project has no `## Recurring defect-class patterns` section in
`PROJECT-CONTEXT.md` yet (confirmed absent as of this check) — this plan is
what would add the first two entries (`DERIVED-DUAL-VIEW`,
`row-id-as-chronology-proxy`). Treating the brief's own citations as the
working registry:

- **`DERIVED-DUAL-VIEW`** — 4 rendering consumers of the same `FocusReport`
  shape (`FocusReportBody`, `FocusCalendarView`, `FocusCalendarBoard`,
  `FocusPage`). The project's own closest thing to a registry entry per
  consumer is `FocusReportModal.test.tsx`'s two "[standing template]" /
  "[board-mode extension...]" tests, explicitly marked as the place to
  extend for any new consumer. **`FocusPage` has no entry there — UNGUARDED**,
  confirmed above.
- **`row-id-as-chronology-proxy`** — third instance
  (`6e9a443`, `b3a2cc9`, now `focus-inference.js:123`). The first instance's
  fix (`buildSessionFocusReport`, `b3a2cc9`) *does* have regression coverage:
  `server/__tests__/focus-report.test.js`, `describe("buildSessionFocusReport
  - out-of-order event insertion")` (line 351, one test: `"never lets
  active_ms exceed wall_ms ... when events land out of chronological
  order"`) constructs exactly the out-of-order fixture that class of bug
  needs. `buildActivityDigest()` has no equivalent test — **UNGUARDED**,
  confirmed above, and notably worse in kind (SQL `LIMIT` wrong-subset
  selection vs. JS-level ordering) than the pattern the existing regression
  test covers, so that existing green test provides no transferable
  assurance here.

## Test-backfill items — existing coverage today (none vs some)

| # | Planned file | Any existing coverage today? |
|---|---|---|
| 1 | `FocusReportModal.test.tsx` — FocusPage cross-view parity extension | **Some, but not the assertion itself.** The file and its "[standing template]"/"[board-mode extension]" pattern exist and are green; `FocusPage` itself is well-tested in its own file. No test anywhere feeds one fixture into `FocusPage` and `FocusReportModal`/`FocusCalendarBoard` and diffs the output — the specific cross-view parity assertion has zero coverage. |
| 2 | `useHourWindowZoom.test.ts` (new hook unit test / cascade regression) | **None isolated.** Only indirect, fake-timer-frozen coverage through `FocusCalendarView.test.tsx` and `FocusPage.test.tsx`'s hour-window-zoom `describe` blocks — neither advances timers past `ZOOM_REFRESH_MS` or asserts on render count/console output, so the specific cascade defect is unexercised. No `client/src/hooks/__tests__/` directory exists yet. |
| 3 | `ConcurrencyStatTile.test.tsx` (presentational smoke test) | **Indirect only**, via `FocusReportModal.test.tsx`'s 5+ concurrency-tile assertions (swap/persist/sub-line/fallback). No isolated component test exists. |
| 4 | `focus-inference.test.js` extension (`buildActivityDigest` chronology fix) | **None.** Existing `describe("buildActivityDigest")` tests (2) both use insertion-order-equals-chronological-order fixtures; no out-of-order `id`-vs-`created_at` case exists, unlike the sibling regression test that already exists for the `b3a2cc9` instance of this same bug class. |
| 5 | `focus-report.test.js` extension (>65,536-interval stack-overflow regression) | **None.** No test in the file approaches that event-volume scale; grepped for `65536`/`RangeError`/`stack`, no matches. |
| 6 | `settings-export.test.js` (new, functional settings-export test) | **None.** `/api/settings/export` appears only in a route-registration path list (`api.test.js`); `data-transfer.test.js`'s green round-trip coverage is for an entirely different, unused-by-the-route module. |

(A 7th item named in the brief's invariants section — render-stability /
no-runaway-effect-loop, asserting on stderr rather than just pass/fail — has
**no existing coverage**, per the `useHourWindowZoom.test.ts` row above; the
brief frames it as folded into that same planned file rather than a
separate one.)

## Conventions for where new tests would land

- Client component/page tests: sibling `__tests__/` directory,
  `<ComponentName>.test.tsx`, e.g.
  `client/src/components/__tests__/ConcurrencyStatTile.test.tsx`,
  `client/src/pages/__tests__/FocusPage.test.tsx` (already exists — the
  cross-view parity item extends `FocusReportModal.test.tsx` instead, per
  the brief, not a new file).
- Client hook tests: no precedent directory yet — `useHourWindowZoom.test.ts`
  would be the first file under a new `client/src/hooks/__tests__/`,
  matching the sibling-`__tests__/` convention used everywhere else in the
  client tree (mirrors `client/src/lib/__tests__/`, `.../components/__tests__/`).
  File extension `.ts` (no JSX), matching `client/src/lib/__tests__/*.test.ts`.
- Server tests: flat `server/__tests__/`, `<module-or-route-group>.test.js`,
  Node's built-in `node:test` + `node:assert/strict`, one file per module —
  `settings-export.test.js` would sit alongside `settings-cache-route.test.js`
  (an existing example of an isolated settings-route test file, distinct
  from the broad `api.test.js`).
