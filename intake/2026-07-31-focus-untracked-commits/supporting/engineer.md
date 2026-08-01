# Engineer report — retroactive review of the 7 focus-surface commits (0416066..60af828)

Scope: verify what actually shipped, on disk, against what the commit
messages/brief claim. All findings below are from reading current `master`
(HEAD `dfe9208`, seven commits already merged) and running the relevant test
suites — not from re-reading the commit diffs alone.

## 1. Exact change set (confirmed against live code)

| File | What's actually there now | Which commit(s) |
|---|---|---|
| `server/lib/focus-report.js` | `buildSessionFocusReport` (lines 398-486): sorts `allTimestampsMs` numerically before the gap-credit walk (lines 439-441, `b3a2cc9`); loop-pushes into `sessionActiveIntervalsMs` instead of `push(...intervals)` (lines 449-453, `60af828`) | `b3a2cc9`, `60af828` |
| `server/lib/focus-report.js` | `buildProjectFocusReport` (541-642): `windowStartMs`/`windowEndMs` threaded through to `buildSessionFocusReport`/`clipSegmentToWindow`; `active_wall_clock_ms`/`active_concurrency_ratio` via `mergeIntervals` over the non-enumerable `activeIntervalsMs` plumbing | `0416066` (windowed totals), earlier work laid the `wall_clock_ms`/`concurrency_ratio` groundwork |
| `client/src/pages/FocusPage.tsx` (773 lines, new) | New `/focus` route: stat tiles, activity card, AI window-summary block, `useHourWindowZoom(selectedDate, { defaultHourWindow: 24 })` | `ed23878` (page itself), `b930824` (AI summary block), `0d5fbe7` (polish) |
| `client/src/App.tsx` / `client/src/components/Sidebar.tsx` | Route `path="focus"` → `<FocusPage />` (App.tsx:114); nav entry `{ to: "/focus", icon: Focus, key: "nav:focus" }` (Sidebar.tsx:107) | `31927e2` |
| `client/src/hooks/useHourWindowZoom.ts` (203 lines, new) | Extracted zoom state/anchor-mode logic (`hourWindow`, `live`/`custom` anchor, `windowStartMs`/`windowEndMs`, quick-start presets) shared by `FocusCalendarView.tsx` and `FocusPage.tsx` | `ed23878` |
| `client/src/components/HourWindowZoomBar.tsx` (219 lines, new) | Presentational half of the same split (buttons, stepper, amber "future" warning) | `ed23878` |
| `client/src/components/FocusActivityCard.tsx` (220 lines, new) | Item/detour row rendering, inferred-reason display, "+N more sessions" expand/collapse, project-label prefixing | `31927e2`, extended by `b930824` |
| `client/src/components/FocusCalendarView.tsx` (1130 lines) | Day-view swimlane calendar; calls `useHourWindowZoom`/renders `HourWindowZoomBar`; fires `onVisibleWindowChange` (lines 453-456) so `FocusReportBody`'s stat tiles scope to the zoom | `0416066`, `31927e2`, `ed23878` (the zoom-hook extraction), `0d5fbe7` |
| `client/src/components/StatTile.tsx` (64 lines, new) | Shared stat-tile presentational component | `31927e2` |
| `client/src/components/ConcurrencyStatTile.tsx` (135 lines, new) | Concurrency-ratio-specific stat tile | `0d5fbe7` |
| `server/lib/data-transfer.js` | Doc-only change (a warning comment) — no logic change; explicitly NOT wired to any route | `60af828` |
| `server/routes/settings.js` | `GET /api/settings/export` rewritten: `writeJsonArray` streams each table via `Statement#iterate()` + `setImmediate` yield every 500 rows instead of `.all()` + `res.json()` | `60af828` |

All file/line references above were read directly off current `master`, not
inferred from commit messages.

## 2. Feasibility — is it as simple as it looked?

**Yes for the two bug fixes; more coupled than it looks for the feature
stack.**

- **`b3a2cc9` (sort fix)** and **`60af828` (stack-overflow fix)** are both
  exactly what their commit messages say: one-line-scope changes with
  detailed inline comments explaining the failure mode, each backed by a
  targeted regression test (see §6). Low-risk, correctly scoped, no variant
  branches to worry about — there's only one `buildSessionFocusReport` code
  path, not per-mode duplicates.
- **The feature stack (`0416066`→`0d5fbe7`) has real hidden coupling**,
  which the code itself documents rather than hides:
  - `FocusCalendarView.tsx`'s docstring (lines 78-96) states explicitly that
    `useHourWindowZoom`/`HourWindowZoomBar` were *extracted* out of this file
    specifically so `FocusPage.tsx` (a second consumer with different default
    zoom behavior: `defaultHourWindow: 24` vs. the calendar's own default of
    `4`) could reuse the identical windowing control without a calendar grid.
    That's real, deliberate shared-module design, not copy-paste — but it
    also means any future zoom-behavior change now has two live UI
    integration points (`FocusCalendarView.tsx` line 444 and `FocusPage.tsx`)
    that must both be checked, not just the hook itself.
  - `windowStartMs`/`windowEndMs` clipping is threaded through three layers
    (`server/routes/focus-report.js` query params → `buildProjectFocusReport`
    → `buildSessionFocusReport` → `clipSegmentToWindow`) — a plausible-looking
    but incomplete "add a filter" change could clip at the wrong layer and
    silently produce a report that *looks* windowed in the UI but isn't
    actually windowed server-side (or vice versa).
  - `onVisibleWindowChange` (`FocusCalendarView.tsx` 453-466) is a
    caller-notification callback, not a pure prop — a bug found while
    verifying this batch (see §5) shows this exact wiring is fragile.
- **Variant branches that each independently needed the fix, confirmed by
  reading, not assumed:** `buildFocusSegments`'s declared-history path,
  `inferredSegment`'s classifier-fallback path, and `noFocusSegment`'s
  bare fallback path are three separate segment-construction branches that
  all funnel into the *same* `buildSessionFocusReport` active/idle math — so
  the sort fix and the stack-overflow fix, despite living in one shared
  function, correctly cover all three variants without needing three
  separate patches. This is the *good* case of the "shared surface" pattern
  — one fix point, verified by tests exercising all three branches (see
  `inferredSegment`/`buildSessionFocusReport` describe block).

## 3. Effort estimate (retroactive, for the record)

| Commit | Size | Reasoning |
|---|---|---|
| `0416066` windowed stat totals | **M** | Threading a window param through 3 layers (route → project report → session report → clip) plus calendar wiring; 796-line diff to `FocusCalendarView.tsx` |
| `31927e2` Focus page v1 + activity summaries | **L** | New page, new route, new nav entry, 3 new components (`FocusActivityCard`, `ProjectScopeFilters`, `StatTile`) |
| `b3a2cc9` sort fix | **S** | One-line fix, but real-world diagnosis (7,152/8,117 out-of-order events) and a full regression-test describe block make the total commit more than "S" of *investigation* effort even though the code diff is trivial |
| `ed23878` hour-window zoom | **L** | Two new files (219 + 203 lines) plus extracting a hook out of an already-1000+-line component and re-wiring two consumers — the highest-coupling commit in the batch |
| `b930824` AI window summaries | **L** | New LLM-backed endpoint, hierarchical multi-day rollup logic, caching table (`focus_summaries`), digest-gating, plus UI (loading/elapsed-clock/model-attribution states) |
| `0d5fbe7` board polish + fidelity fixes | **M** | New `ConcurrencyStatTile`, route-fidelity fixes across `FocusReportBody`/`StatTile`/`TimePeriodPicker`/`api.ts` |
| `60af828` export streaming + stack-overflow fix | **S** (the focus-report half) / **M** (the settings-export half) | The focus-report fix is a 4-line change with a comment; the settings-export streaming rewrite (`writeJsonArray`, error-mid-stream handling) is real new logic bundled in — see §5 |

**Batch total, as delivered: L.** Consistent with 7 commits over 5 calendar
days touching 2 new pages, 6 new components, 1 new hook, 1 new DB table
(`focus_summaries`), and 2 unrelated server-side bug fixes.

## 4. Dependencies & order

The commits are correctly ordered as shipped — no evidence of an
out-of-order landing that would've broken an intermediate commit:

1. `0416066` establishes the windowed-totals plumbing server-side and in
   `FocusCalendarView.tsx` first.
2. `31927e2` adds the Focus page + nav wiring, depending on `StatTile`
   (new in this same commit) — self-contained.
3. `b3a2cc9` (server-only fix) has no ordering dependency on the client
   commits either side of it.
4. `ed23878` depends on `FocusCalendarView.tsx`'s existing zoom logic (added
   incrementally by `0416066`/`31927e2`) to extract into the new hook, and
   depends on `FocusPage.tsx` already existing (from `31927e2`) to wire the
   zoom bar into it.
5. `b930824` depends on `FocusActivityCard.tsx` (from `31927e2`) and
   `FocusPage.tsx` (from `ed23878`) both already existing.
6. `0d5fbe7` depends on `StatTile.tsx` (from `31927e2`) to add
   `ConcurrencyStatTile.tsx` alongside it.
7. `60af828` depends on nothing upstream in this batch — it's the one commit
   that's genuinely independent of the other six (see §5 on why it's bundled
   with unrelated work).

No shared registry/enum needed a prior entry before downstream code could
use it in this batch (unlike, e.g., a new `FocusKind` would require touching
`FOCUS_KINDS` in `focus-report.js` first) — the two bug fixes are
self-contained function-body changes, and the feature commits build forward
incrementally rather than requiring a central table to be seeded first.

## 5. Gotchas

**a) DERIVED-DUAL-VIEW recurrence is real, not just flagged twice in
passing.** `wall_ms`/`active_ms`/`idle_ms` are computed once in
`server/lib/focus-report.js` and consumed by at least three independent
client renderers: `FocusReportBody`'s list view, `FocusCalendarView`'s
calendar blocks, and now `FocusPage.tsx`'s activity card + AI summary. The
`b3a2cc9` and `60af828` fixes both happened to live in the single shared
`buildSessionFocusReport` function, so they automatically covered all three
consumers — but that's fortunate architecture, not a guarantee. Any *future*
fix that lands in a client-side derived recompute (rather than the shared
server function) would reproduce the exact hazard the two prior catalogued
items already flagged. Worth the PM's promotion call.

**b) A genuine, previously-unflagged bug surfaced during this review, not
present in any commit message:** `FocusCalendarView.tsx`'s live-zoom mode
computes `windowStartMs`/`windowEndMs` from `Date.now()` fresh on every
render (`useHourWindowZoom.ts` lines 145-147, `isLiveZoom` branch), and the
`onVisibleWindowChange` effect (`FocusCalendarView.tsx` lines 453-456) is
keyed off those same values. Because `Date.now()` differs by at least one ms
between renders, the effect's dependency array can appear to change on every
render while in live-zoom mode, re-firing `onVisibleWindowChange` and
re-triggering the parent's `setVisibleWindow` (`FocusReportBody.tsx` line
116-123) — the shape of an unbounded render/effect cascade. This was caught
as a **React "Maximum update depth exceeded" warning** during test runs (see
§6), not from reading the diff alone. It reproduces when running the full
targeted client test group together but did **not** reproduce when
`FocusReportModal.test.tsx` was run alone or paired only with
`FocusPage.test.tsx` — consistent with a real render-cascade that's timing-
sensitive (how many renders happen before `act()` settles) rather than a
pure test-isolation artifact. **No test asserts against this** (all
assertions still pass; the warning is only visible in stderr). This deserves
a real look before being dismissed as a test-only quirk — worth flagging to
QA/follow-up.

**c) `60af828` bundles two genuinely unrelated fixes in one commit,
confirmed by diff inspection.** `server/lib/focus-report.js`'s 6-line change
(spread → loop-push) and `server/routes/settings.js`'s 73-line rewrite
(`.all()` → streamed `.iterate()`) touch completely disjoint code paths (one
in-memory interval math, one HTTP response streaming) and share no variable,
type, or caller. They are **cleanly separable** — a `git revert` of one half
would not touch the other — but were shipped as one commit with one message
covering both, plus a third, adjacent change (`data-transfer.js`'s
warning-only comment flagging it for the *same-shaped* but not-yet-applied
fix). This is a minor process gap (bundling), not a code-quality problem;
each half is independently correct and independently testable.

**d) `.env.example`/docs claim in the brief needs a correction.** The
brief's open question #4 assumes the new `DASHBOARD_FOCUS_SUMMARY_MODEL` env
var (added in `b930824`) is undocumented. It is **not** — `b930824`'s own
commit message says "Docs propagated: README..., ARCHITECTURE...", and this
is confirmed live: `README.md:640` and `ARCHITECTURE.md:384` both document
it in detail. The PM should drop or downgrade that follow-up item rather
than carry it forward as an open gap.

## 6. Verification hooks

**Server (`node --test server/__tests__/focus-report.test.js`) — ran, all
green:**
```
# tests 52
# suites 10
# pass 52
# fail 0
```
Covers, by describe block: `buildFocusSegments` (item/detour/nested-detour
transitions), idle-grace-window math, **`buildSessionFocusReport -
out-of-order event insertion`** (lines 351-397 — the exact `b3a2cc9`
regression, asserting `active_ms` never exceeds `wall_ms` from scrambled
insertion order), `buildActivityChunks`, `clipSegmentToWindow`,
`inferredSegment`/fallback paths, time-window clipping, and
`buildProjectFocusReport` rollup/concurrency math (including the newer
`active_wall_clock_ms`/`active_concurrency_ratio` figures from `0416066`).

**Gap confirmed: no test reproduces the actual `60af828` stack-overflow
condition** (an interval count past V8's ~65536 spread-as-arguments limit).
The fix is real and correct by inspection (loop-push cannot exhibit the
spread limitation regardless of size), but nothing in
`server/__tests__/focus-report.test.js` constructs a session with enough
events to prove the *old* code would have failed and the *new* code
doesn't — unlike `b3a2cc9`, which got a dedicated describe block. Low risk
to leave as-is (the fix is structurally correct), but it's the one fix in
this batch with no regression coverage.

**Gap confirmed: no functional test for the `60af828` `/api/settings/export`
streaming rewrite.** `server/__tests__/api.test.js` only asserts the route
*exists* in a route-catalog smoke list (line 57); there is no
`server/__tests__/settings-export*.test.js` exercising `writeJsonArray`,
verifying the streamed response is byte-equivalent to the old `res.json()`
shape, or covering the mid-stream error path (`res.end()` with no JSON error
body, per the code's own comment). `server/__tests__/data-transfer.test.js`
tests the unrelated in-memory export/import round-trip (`buildExportBundle`
et al.), not this HTTP route.

**Client (`npx vitest run` on the 6 focus-surface test files) — ran, all
green:**
```
Test Files  6 passed (6)
     Tests  128 passed (128)
```
Files: `FocusPage.test.tsx` (20 tests, including a dedicated `describe("hour-
window zoom")` block covering the `ed23878`/`useHourWindowZoom` surface end-
to-end through the page), `FocusActivityCard.test.tsx` (10 tests),
`FocusCalendarView.test.tsx` (49 tests), `FocusReportModal.test.tsx` (23
tests, covering `ConcurrencyStatTile`/`StatTile` integration), plus
`windowedTotals.test.ts` (10) and `focusActivity.test.ts` (16).

**Gap confirmed: no dedicated unit-test file for `HourWindowZoomBar.tsx`,
`useHourWindowZoom.ts`, `ConcurrencyStatTile.tsx`, or `StatTile.tsx`
individually** — all four are exercised only indirectly through
`FocusPage.test.tsx` / `FocusReportModal.test.tsx` integration tests. That's
adequate coverage for behavior but means a hook-level edge case (e.g. the
`maxWindowStartMs` clamp, or `quickStartOptions`' boundary math in
`useHourWindowZoom.ts` lines 164-173) has no isolated test proving it beyond
whatever scenarios the higher-level page tests happen to exercise.

**No TODO/FIXME/XXX/HACK markers found** in any of the 8 files this
investigation focused on (`grep` returned zero matches) — the shipped code
reads as finished, not scaffolded.
