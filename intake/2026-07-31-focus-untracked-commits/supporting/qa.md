# QA — retroactive coverage audit: focus-surface commits (0416066..60af828)

> Retroactive pass. Nothing below is a "write this before shipping" plan —
> the code is already on `master`. This document answers three things for
> each of the seven commits: (1) does a regression test already exist and
> is it green today, (2) what's genuinely unguarded, (3) what to add so this
> stops being invisible to the pipeline.

## Test stack (confirmed from `package.json` / `client/package.json`)

- Server: Node's built-in test runner. `npm run test:server` →
  `node --test server/__tests__/*.test.js`. Single file:
  `node --test server/__tests__/focus-report.test.js`.
- Client: Vitest. `npm run test:client` → `cd client && npm test` (=
  `vitest run`). Single file:
  `cd client && npx vitest run src/pages/__tests__/FocusPage.test.tsx`.
  Screen snapshots: `client/src/pages/__tests__/screens.snapshot.test.tsx`
  (regenerate with `cd client && npx vitest run -u`, never blind-accept).
- MCP: unaffected by this batch, not exercised here.

## 1. How we verify done (this retroactive pass)

Since all seven commits are already merged, "done" for this QA pass means:
confirm the regression suites that exist for this surface are genuinely
green today, and enumerate — with file-level evidence, not assumption —
where coverage is real vs. incidental vs. absent. Steps taken:

1. `grep`'d `server/__tests__/` and `client/src/**/__tests__/` for every
   surface named in the request brief, cross-checked against
   `git show --stat <sha>` for all seven commits (not just the source
   doc's summarized file lists, which turned out to omit some test/lib
   files — see §3 note).
2. Ran the full server suite: `npm run test:server` →
   **1047/1047 pass, 236 suites, 0 fail.**
3. Ran the full client suite: `cd client && npx vitest run` →
   **645/645 pass, 51 files, 0 fail.**
4. Ran the focus-specific subset in isolation to rule out suite-order
   leakage: `node --test server/__tests__/focus-report.test.js
   server/__tests__/focus-report-route.test.js
   server/__tests__/focus-summary.test.js
   server/__tests__/data-transfer.test.js server/__tests__/api.test.js`
   → 212/212 pass. `cd client && npx vitest run
   src/components/__tests__/FocusCalendarView.test.tsx
   src/components/__tests__/FocusActivityCard.test.tsx
   src/components/__tests__/FocusReportModal.test.tsx
   src/components/__tests__/TimePeriodPicker.test.tsx
   src/pages/__tests__/FocusPage.test.tsx
   src/pages/__tests__/FocusCalendarBoard.test.tsx
   src/lib/__tests__/windowedTotals.test.ts
   src/lib/__tests__/focusActivity.test.ts
   src/lib/__tests__/focusStore.test.ts` → **155/155 pass, 9 files.**

**Result: everything that has a test today passes today.** The finding of
this pass is not "something is red" — it's which pieces of the shipped
surface have no test at all, and one non-blocking runtime warning worth a
follow-up look.

**Non-blocking observation:** the client run printed a React warning during
`FocusReportModal.test.tsx`'s "switches to the calendar view and back
without a second fetch" test — `Maximum update depth exceeded... at
FocusCalendarView (FocusCalendarView.tsx:55:3)`. The test still passes (it
doesn't assert against console output), but a warning shaped like an
effect-dependency loop, surfacing specifically in `FocusCalendarView` right
after `ed23878`'s large rewrite extracted `useHourWindowZoom`/
`HourWindowZoomBar` out of this file, is worth a quick look — confirm
whether it predates `ed23878` (pre-existing, out of scope) or was
introduced by the extraction (in scope, low-risk fix). Not gating; flagged
for the PM/tech-plan follow-up list.

## 2. Regression coverage that already exists, per commit

| Commit | Subject | Existing spec file(s) | Current state |
|---|---|---|---|
| `0416066` | windowed stat totals for calendar zoom | `client/src/lib/__tests__/windowedTotals.test.ts` (10 tests — clip-at-boundary, concurrent-session union, `none`-kind, no-chunks fallback), `server/__tests__/focus-report.test.js`, `server/__tests__/focus-report-route.test.js` | Green |
| `31927e2` | Focus page + plan-less activity summaries | `client/src/pages/__tests__/FocusPage.test.tsx` (20 tests, added in this commit), `client/src/components/__tests__/FocusActivityCard.test.tsx` (10 tests), `client/src/lib/__tests__/focusActivity.test.ts` (16 tests) | Green |
| `b3a2cc9` | sort event timestamps before gap-sum walk | `server/__tests__/focus-report.test.js` → `describe("buildSessionFocusReport - out-of-order event insertion")`, added **in this commit** | Green. Exact-value assertions (`active_ms === wall_ms === 20min`, not just an inequality), confirmed red-before/green-after per the commit message. This is a model regression test — see §5 for why it matters. |
| `ed23878` | hour-window zoom control (`HourWindowZoomBar`, `useHourWindowZoom`) | No dedicated unit-test file for either new module. Indirectly exercised via `FocusCalendarView.test.tsx`'s `describe("hour-window zoom (default 4h back + 2h ahead)")` (13 tests: default window, wider option, 24h full day, future-pad, non-today midnight anchor, quick-start presets, future-window warning) and `FocusPage.test.tsx`'s `describe("hour-window zoom")` (3 tests: default 24h, narrows tiles+card together, restores on zoom-out) | Green, but see §3 gap #1 |
| `b930824` | AI window summaries, hierarchical rollups | Server: `server/__tests__/focus-summary.test.js` (39 `it`s — prompt building, envelope parsing, input digest, bullet budget, day-chunking, recency-biased session cap, caching, hierarchical rollup, degraded-day fallback, route contract). Client: `FocusPage.test.tsx`'s `describe("window summary block")` (4 tests) + `describe("currently active status")` (8 tests) | Green. Note: the request-brief's per-commit file list under-reported this commit — `git show --stat b930824` shows it also added `server/lib/focus-summary.js` (463 lines) and `server/__tests__/focus-summary.test.js` (473 lines), not visible in the source doc's summarized touch-list. Actual coverage here is broader than the source material implied. |
| `0d5fbe7` | board polish + route fidelity fixes | `client/src/components/__tests__/FocusReportModal.test.tsx` (+69 lines), `client/src/components/__tests__/TimePeriodPicker.test.tsx` (+37), `client/src/lib/__tests__/windowedTotals.test.ts` (+26), `server/__tests__/focus-report.test.js` (+93), `server/__tests__/focus-summary.test.js` (+62) | Green. No dedicated spec for the new `ConcurrencyStatTile.tsx` (136 lines) or the extended `StatTile.tsx`/`ProjectScopeFilters.tsx` — see §3 gap #2. |
| `60af828` | settings-export streaming + focus-report stack-overflow fix | **None added in this commit.** `server/__tests__/data-transfer.test.js` covers `data-transfer.js`'s *own* export/import round trip (a different code path from the streamed `GET /api/settings/export` route in `settings.js`); `server/__tests__/api.test.js` only asserts `/api/settings/export` appears in the OpenAPI path list, not its streaming behavior or content correctness. `server/__tests__/focus-report.test.js` has no test that exercises >65,536 intervals (V8's spread-as-arguments limit named in the fix's own commit message). | Existing tests green, but neither fix in this commit has a regression test — see §3 gaps #3 and #4. |

## 3. Concrete coverage gaps (retroactive backfill candidates)

Ordered worst-first by "how likely is this to silently regress."

**Gap #1 — `useHourWindowZoom.ts` / `HourWindowZoomBar.tsx`: no isolated unit
test.** 422 lines of genuinely edge-case-heavy logic (live vs. custom anchor
mode, `FUTURE_PAD_MS`, day-navigation persistence of `customOffsetMs`,
quick-start step boundaries, the amber future-window warning) — per the
module's own extensive file-header doc comment — is tested only through two
consumers' integration tests (`FocusCalendarView.test.tsx`,
`FocusPage.test.tsx`), never in isolation. This is not zero coverage (16
integration tests between the two files do exercise real zoom behavior),
but a hook-level bug that both consumers happen to trigger identically
would still pass both integration suites; a hook-level bug only one
consumer's props shape triggers could land with neither suite's assertions
built to catch it directly at the hook boundary. Recommend a
`client/src/hooks/__tests__/useHourWindowZoom.test.ts` (React Testing
Library `renderHook`) pinning: `windowStartMs`/`windowMs` math for each of
4h/8h/12h/24h, `windowIsFuture` at the exact boundary, `customOffsetMs`
surviving a day-navigation round trip, and the live-mode re-anchor tick.

**Gap #2 — `ConcurrencyStatTile.tsx` (new, 136 lines): no dedicated spec.**
Only exercised implicitly wherever `FocusReportBody.test.tsx`/
`FocusReportModal.test.tsx` renders it. Lower priority than #1 (it's a
presentational tile, not stateful logic), but worth a smoke test asserting
it renders the concurrency ratio and handles the `null`
`activeConcurrencyRatio` case (an empty window) without throwing —
`computeWindowedTotals` explicitly documents that `null` is a valid output
for this exact input.

**Gap #3 — `60af828`'s stack-overflow fix has no regression test.** The fix
(`push(...intervals)` → loop-push in `buildSessionFocusReport`) exists
specifically because V8's spread-as-arguments limit (~65,536) was hit on a
real high-event-volume session. Nothing in `server/__tests__/focus-report.test.js`
constructs a session with an interval count anywhere near that limit, so
this exact regression — `RangeError: Maximum call stack size exceeded` —
could be silently reintroduced (e.g. by a future refactor reverting to
`push(...x)` for readability) with the full suite staying green. Recommend
a test in `server/__tests__/focus-report.test.js`: seed a session with a
synthetic timestamp list large enough to produce >65,536 active intervals
(or, cheaper, unit-test `activeIntervals()`/the loop-push directly with a
stubbed array of that length) and assert it returns without throwing.

**Gap #4 — `60af828`'s settings-export streaming has no functional test.**
`api.test.js` only confirms the route exists in the OpenAPI path list;
nothing calls `GET /api/settings/export` and asserts (a) the response body
is still valid, complete JSON matching what `.all()`-based export produced
before, and (b) the row-by-row streaming actually yields (e.g. doesn't hold
the event loop for the whole table). Recommend a
`server/__tests__/settings-export.test.js` (or an addition to the existing
settings test) that seeds a handful of sessions/events, calls the route,
and asserts the exported JSON round-trips through the same shape
`data-transfer.test.js` already validates for the sibling export path — at
minimum a content-correctness test; a large-table streaming-behavior test
is a nice-to-have, lower priority given `data-transfer.js`'s own export
builder is explicitly flagged in the commit message as "not yet wired to a
live route" (i.e., not this commit's own regression surface).

**Gap #5 (the request brief's central question) — no genuine cross-view
consistency test for the new third rendering surface (`FocusPage.tsx`)
against the two existing ones (`FocusCalendarView.tsx` /
`FocusReportModal.tsx`).** `FocusPage.test.tsx`'s "renders stat tiles
matching FocusReportBody's on-item/off-plan formula" test asserts a
hardcoded 75%/25% independently computed in a code comment — it does not
render `FocusReportBody`/`FocusReportModal` side-by-side with `FocusPage`
against the same fixture and assert they agree. This is exactly the gap
`2026-07-26-focus-report-fidelity`'s own QA doc closed for
List-vs-Calendar (see
`intake/2026-07-26-focus-report-fidelity/qa/qa-assessment.md`,
"List-vs-Calendar cross-view consistency test," still present today at
`FocusReportModal.test.tsx`'s cross-view describe block) — but that fix
never extended to the *new* third surface this batch added. Recommend a
`FocusPage`-vs-`FocusReportModal` cross-view test, same shape as the
existing List-vs-Calendar one: same fixture report, assert both surfaces'
on-item percentage, active/idle totals, and (once zoomed) windowed totals
are numerically identical. This is the single highest-leverage test to add
out of this whole batch, because it's the literal DERIVED-DUAL-VIEW pattern
the request brief asked QA to check for, and it is currently open on the
newest surface.

## 4. Is the gap-sum sort fix (`b3a2cc9`) a repeat bug class?

**Partially — same root shape, not yet a formal catalogued pattern.**

- `b3a2cc9` itself: `ORDER BY id ASC` used as a chronology proxy for
  `events.created_at`, broken by `workflow-ingest.js` bulk-inserting rows
  out of timestamp order. Confirmed via the commit's own message: "Verified
  against a real corrupted session (7,152 of 8,117 events out-of-order by
  id)." Test added same-commit, exact-value assertions, currently green.
- Searched `git log --all -i --grep` for prior chronology-ordering fixes on
  this codebase: found one prior, unrelated-surface hit —
  `6e9a443` (`fix: sort agents in chronological order (earliest first)`,
  2026-04-26, `client/src/pages/SessionDetail.tsx`) — same *shape* of bug
  (insertion/API order assumed to equal chronological order) but a
  different consequence (display ordering, not arithmetic double-counting)
  and a different surface entirely (agent tree render, not focus-report
  gap-sum). Not a direct repeat of `b3a2cc9`, but confirms "assume row
  order is chronological" is a recurring shape of mistake in this codebase,
  independent of the focus-report surface specifically.
- **Live latent instance found in the same surface this pass audited:**
  `server/lib/focus-inference.js`'s `buildActivityDigest()` (the function
  that builds the prompt digest for the AI window-summary feature shipped
  in `b930824`, same batch) also does `SELECT ... ORDER BY id ASC LIMIT ?`
  against the same `events` table `b3a2cc9`'s fix was written for. It
  doesn't do gap-sum arithmetic (so it can't double-count into a negative
  `idle_ms` the way `b3a2cc9`'s bug did), but a bulk-ingested,
  out-of-timestamp-order session would still hand the LLM a
  non-chronological digest to summarize — a plausible, unaudited source of
  a confusing or wrong AI-generated narrative. Not asserted as a live bug
  (no reproduction attempted here), but the same root cause
  (`workflow-ingest.js` landing rows out of `created_at` order) feeding an
  un-re-sorted `ORDER BY id ASC` query is a live, same-shape gap on a
  surface shipped in this exact batch. Recommend the PM/tech-plan stage
  flag `buildActivityDigest()` for a follow-up look, and consider whether
  `PROJECT-CONTEXT.md` should catalog "row insertion order (`id`) is not
  chronological order once `workflow-ingest.js` is in play" as a named
  defect-class pattern alongside DERIVED-DUAL-VIEW, given it's now shown up
  twice on two different surfaces.

## 5. New/updated tests required (spec + assertions)

1. **`client/src/hooks/__tests__/useHourWindowZoom.test.ts`** (new file).
   Assertions: `windowStartMs`/`windowMs` for each of 4h/8h/12h/24h;
   `windowIsFuture` true/false at the exact "start === now" boundary;
   `customOffsetMs` unchanged across a day-navigation call; live-mode
   re-anchor advances `windowStartMs` on a `ZOOM_REFRESH_MS` tick (fake
   timers).
2. **`server/__tests__/focus-report.test.js`** — add a case under
   `buildSessionFocusReport` (or a direct unit on the interval-building
   helper) seeding >65,536 synthetic active intervals for one session;
   assert it returns without throwing `RangeError`.
3. **`server/__tests__/settings-export.test.js`** (new) or an addition to
   an existing settings route test — seed sessions/events, `GET
   /api/settings/export`, assert the returned JSON's shape/row counts match
   what was seeded (content-correctness regression for the streaming
   rewrite).
4. **`client/src/pages/__tests__/FocusPage.test.tsx`** — add a
   `describe("cross-view consistency with FocusReportModal")` block, same
   fixture rendered through both `FocusPage` and `FocusReportModal` (or
   `FocusReportBody` directly), asserting identical on-item percentage,
   active/idle totals, and windowed totals once zoomed — mirroring the
   existing List-vs-Calendar test in `FocusReportModal.test.tsx`.
5. **`client/src/components/__tests__/ConcurrencyStatTile.test.tsx`** (new,
   lower priority) — smoke test: renders the ratio for a normal input,
   renders sanely (no throw) for `activeConcurrencyRatio: null`.

## 6. Test data / fixtures

- Reuse `server/__tests__/focus-report.test.js`'s existing `seedSession`/
  `focus`/`activity` helpers for gap #2 (large-interval-count case) — no
  new fixture machinery needed, just a loop generating N synthetic
  timestamps.
- Reuse `client/src/lib/__tests__/windowedTotals.test.ts`'s `segment`/
  `session`/`report` builders for gap #5's cross-view fixture — they
  already produce exactly the `FocusReport` shape both `FocusPage` and
  `FocusReportModal` consume, and are already proven to drive the
  75%/25% on-item split `FocusPage.test.tsx` currently hardcodes.
- For gap #3 (streaming export), seed via the same session/event helpers
  `server/__tests__/data-transfer.test.js` already uses, since the goal is
  parity with that file's own round-trip assertions.
- For gap #1 (hook unit test), no live report data needed — pure
  date-math inputs (`selectedDate`, a fixed "now" via fake timers).

## 7. Definition of Done checklist

- [x] `npm run test:server` green (1047/1047, confirmed this pass).
- [x] `npm run test:client` green (645/645, confirmed this pass).
- [x] Every one of the seven commits mapped to its existing regression
      spec(s) (§2 table) — no commit is completely unguarded; `60af828` is
      the only one that shipped with zero new/updated test coverage.
- [ ] Gap #1 (`useHourWindowZoom`/`HourWindowZoomBar` isolated unit test)
      written and green.
- [ ] Gap #3 (>65,536-interval stack-overflow regression test) written and
      confirmed red against the pre-`60af828` code, green after.
- [ ] Gap #4 (settings-export content-correctness test) written and green.
- [ ] Gap #5 (`FocusPage`-vs-`FocusReportModal` cross-view consistency
      test) written and green — highest priority, directly closes the
      DERIVED-DUAL-VIEW question this intake exists to answer.
- [ ] `buildActivityDigest()`'s un-sorted `ORDER BY id ASC` query (§4)
      either fixed to match `b3a2cc9`'s sort-before-use pattern, or
      explicitly reviewed and accepted as safe (digest text, not
      arithmetic) with the reasoning recorded.
- [ ] PM decision recorded on whether DERIVED-DUAL-VIEW (and/or the
      "row-id-as-chronology-proxy" shape) gets formally catalogued in
      `PROJECT-CONTEXT.md`.
- [ ] The `Maximum update depth exceeded` warning observed in
      `FocusReportModal.test.tsx` (§1) triaged — confirm pre-existing vs.
      introduced by `ed23878`'s `FocusCalendarView` rewrite.
