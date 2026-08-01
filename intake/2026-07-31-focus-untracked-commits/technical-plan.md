# Technical Plan: Retroactive Documentation + Two Live Bug Fixes — Focus Surface (`0416066`..`60af828`)

Intake: `intake/2026-07-31-focus-untracked-commits/` · Tech-lead pass, reconciling
`supporting/architect.md`, `supporting/engineer.md`, `supporting/qa.md` against
`pm-plan.md`'s classification (`missed-requirement`, retroactive-process sense).

This plan is **not a build authorization**. Six of its eight action items are
paperwork (retroactive record + two decision entries + two catalogue entries).
Two are real code changes against currently-shipped, currently-live bugs that
this retroactive review surfaced. Both categories are sequenced below so an
implementer can execute end-to-end without re-deriving anything the three
supporting reports already established.

## 1. Objective

Close the process gap `team-status` flagged (seven merged commits with no
intake record) by (a) publishing a verified "what shipped" record, (b) fixing
the two real, live bugs this retroactive review found (a render cascade in
`FocusCalendarView.tsx` and an un-sorted chronology query in
`focus-inference.js`, both fed by the same "row id is not chronological order"
root cause `b3a2cc9` already fixed once on this surface), (c) backfilling the
five QA-identified test gaps in priority order, and (d) cataloguing two
recurring defect-class patterns (`DERIVED-DUAL-VIEW`,
`row-id-as-chronology-proxy`) in `PROJECT-CONTEXT.md` so future touches of this
surface — and any surface reading `events` — don't have to rediscover them
from intake folders and file-header comments. End state: `master` is unchanged
in behavior except for the two bug fixes; the pipeline has a complete paper
trail; the next contributor touching `FocusReport` consumers or the `events`
table has a named pattern to grep for instead of tribal knowledge.

## 2. Recommended approach

**Architect's Option C, adopted as-is, no override.** Catalogue
`DERIVED-DUAL-VIEW` in `PROJECT-CONTEXT.md` (documentation-only) *and* add the
structural cross-consumer test QA's gap #5 and architect's Option C both
independently converged on. No disagreement to resolve between architect and
engineer on this call — architect's code-level read (extraction held, not
duplication) and engineer's `windowedTotals.ts`/hidden-coupling read
(§2 "gotchas") are complementary, not contradictory: the *code* held the
line, the *test scope* (per-field, not per-consumer) is what let the newest
consumer (`FocusPage.tsx`) ship without parity coverage.

**One addition beyond what any single report proposed:** `row-id-as-chronology-proxy`
gets catalogued as its own named pattern, not folded into `DERIVED-DUAL-VIEW`.
QA's §4 and PM's §4 both treat it as "the same shape, one layer down," which is
directionally right, but the fix pattern is different enough (sort-before-use
at a query/aggregation boundary, vs. extract-a-shared-component-or-helper) that
conflating them in the catalogue would blur the acceptance criterion each one
needs. Two entries, cross-referenced, not one.

**Sequencing:** the two live bugs (§4) come before the retroactive test
backfill (§7), per PM's explicit recommendation in `pm-plan.md` §6.B/§8 — both
are root-cause-understood, small, single-surface fixes discovered *by* this
review, not open design questions, so they're scoped as fix tasks inside this
plan rather than spun into separate intake folders. If either fix is found
mid-implementation to need real redesign, stop and split it out — that isn't
expected here (both fixes below are contained one-file changes).

## 3. Retroactive documentation — what shipped (per commit)

Verified against current `master` by the engineer (file/line references) and
QA (test-suite execution), not against commit messages alone.

| Commit | Date | What shipped | Verified sound? |
|---|---|---|---|
| `0416066` | 07-26 | Windowed stat totals: `windowStartMs`/`windowEndMs` threaded through `server/routes/focus-report.js` → `buildProjectFocusReport` → `buildSessionFocusReport` → `clipSegmentToWindow`; `FocusCalendarView.tsx` wired to the new zoom-scoped totals. | Yes — server suite green, `windowedTotals.test.ts` (10 tests) covers clip-at-boundary/concurrent-session/`none`-kind/no-chunks cases. |
| `31927e2` | 07-26 | New `/focus` stakeholder page (`FocusPage.tsx`, 773 lines), nav entry (`Sidebar.tsx`), route (`App.tsx`), `StatTile.tsx`, `FocusActivityCard.tsx`, `ProjectScopeFilters.tsx` (all new, extracted-not-copied per architect §2). | Yes — `FocusPage.test.tsx` (20 tests), `FocusActivityCard.test.tsx` (10), `focusActivity.test.ts` (16), all green. Gap: no cross-view parity test vs. `FocusReportModal` (§7, item 1). |
| `b3a2cc9` | 07-27 | **Bug fix.** `buildSessionFocusReport` sorted `allTimestampsMs` numerically before the gap-credit walk (`server/lib/focus-report.js:439-441`) — `ORDER BY id ASC` insertion order is not reliably chronological once `workflow-ingest.js` bulk-inserts events, which was previously inflating `active_ms` past `wall_ms` (driving `idle_ms` negative). Real-world trigger: 7,152/8,117 events out-of-order by id in one corrupted session. | Yes — dedicated `describe("buildSessionFocusReport - out-of-order event insertion")` block, exact-value assertions, confirmed red-before/green-after per commit message, currently green. |
| `ed23878` | 07-28 | Hour-window zoom control extracted out of `FocusCalendarView.tsx` into `useHourWindowZoom.ts` (203 lines) + `HourWindowZoomBar.tsx` (219 lines), shared by `FocusCalendarView` (default 4h) and `FocusPage` (default 24h). | Mostly — behavior is correctly tested via 16 integration tests across the two consumers (no isolated hook unit test yet, §7 item 3). **This commit is also the one that introduced the render-cascade bug fixed in §4.1** — the extraction itself is sound; the live-zoom time-source it introduced was not render-safe. |
| `b930824` | 07-29 | AI-generated window summaries: `server/lib/focus-summary.js` (463 lines, new), `focus_summaries` cache table, hierarchical multi-day rollup, `DASHBOARD_FOCUS_SUMMARY_MODEL` env var, reuses `focus-inference.js`'s existing hermetic `runClaudePromptJson` spawn contract (no new external dependency). | Yes — `server/__tests__/focus-summary.test.js` (39 tests: prompt building, digest, caching, degraded-day fallback), `FocusPage.test.tsx`'s summary-block tests, all green. Docs confirmed complete (`README.md:640`, `ARCHITECTURE.md:384`) — brief's open question #4 is closed, no action needed. |
| `0d5fbe7` | 07-30 | Board polish + route-fidelity fixes: `ConcurrencyStatTile.tsx` (new), fixes across `FocusReportBody`/`StatTile`/`TimePeriodPicker`/`api.ts`. | Yes, existing suites green. No dedicated spec for `ConcurrencyStatTile.tsx` (§7 item 5, lowest priority). |
| `60af828` | 07-30 | **Bug fix** (in-scope half): loop-push instead of `push(...intervals)` in `buildSessionFocusReport` (`server/lib/focus-report.js:449-453`) — avoids V8's ~65,536 spread-as-arguments `RangeError` on high-event-volume sessions. **Out-of-scope half** (bundled, unrelated): `server/routes/settings.js`'s `/api/settings/export` rewritten to stream via `Statement#iterate()` instead of `.all()` + `res.json()`. | Fix is structurally correct by inspection but has **no regression test** for either half (§7 items 4, 6). See §8 for the bundling process note. |

**Test state confirmed by both architect and QA, independently:**
`npm run test:server` → 1047/1047 pass. `cd client && npx vitest run` →
645/645 pass. No red anywhere in this batch's history at time of this review.

## 4. Real fix tasks (live bugs, ahead of test backfill)

### 4.1 `FocusCalendarView.tsx` live-zoom render cascade

**File:** `client/src/hooks/useHourWindowZoom.ts` (root cause). Consumed by
`client/src/components/FocusCalendarView.tsx` (lines 444-456, where the
symptom — the React "Maximum update depth exceeded" warning — surfaces).

**Confirmed root cause (read directly off current `master`):**

In `useHourWindowZoom.ts`, the live-zoom branch computes the window bounds
inline from `Date.now()` on *every* render, not just on the `ZOOM_REFRESH_MS`
(60s) tick the surrounding comment says is the intended cadence:

```js
// current (useHourWindowZoom.ts:145-147)
} else if (isLiveZoom) {
  windowStartMs = Math.max(dayStart, Date.now() - hourWindow * HOUR_MS);
  windowEndMs = Math.min(dayEnd, Date.now() + FUTURE_PAD_MS);
}
```

`FocusCalendarView.tsx` destructures `windowStartMs`/`windowEndMs` from this
hook and keys an effect off them:

```js
// current (FocusCalendarView.tsx:453-456)
useEffect(() => {
  onVisibleWindowChange?.(zoomable ? { startMs: windowStartMs, endMs: windowEndMs } : null);
}, [zoomable, windowStartMs, windowEndMs]);
```

`onVisibleWindowChange` is `FocusReportBody.tsx`'s `setVisibleWindow`
(`FocusReportBody.tsx:116-123, 203`). The cascade: any render of
`FocusCalendarView` (for *any* reason) re-invokes `useHourWindowZoom`, which
in live-zoom mode recomputes `windowStartMs`/`windowEndMs` from a fresh
`Date.now()` call — differing from the previous render's value by at least
1ms essentially every time. The effect's dependency array sees a "changed"
value, re-fires, calls `setVisibleWindow` with a new object, `FocusReportBody`
re-renders, `FocusCalendarView` re-renders as its child, and the loop repeats
until React's runaway-update safety valve (~25 renders) trips and logs
"Maximum update depth exceeded." This reproduced independently for both
engineer (targeted client test group) and QA (full client suite,
`FocusReportModal.test.tsx`'s calendar-toggle test) — consistent with a real,
timing-sensitive cascade, not a test-isolation artifact. **No test currently
asserts against it; it is silent in CI today** (the warning goes to stderr,
assertions still pass).

**Fix — stabilize the live-zoom "now" reading to the same cadence the
`ZOOM_REFRESH_MS` comment already documents as intended,** so a render caused
by anything *other* than the 60s tick reads the same `now` value it read last
time and produces bit-identical `windowStartMs`/`windowEndMs`:

```js
// useHourWindowZoom.ts — replace the bump-counter (current lines 129-134)
const [nowMs, setNowMs] = useState(() => Date.now());
useEffect(() => {
  if (!isLiveZoom) return;
  const id = setInterval(() => setNowMs(Date.now()), ZOOM_REFRESH_MS);
  return () => clearInterval(id);
}, [isLiveZoom]);
```

```js
// useHourWindowZoom.ts — use nowMs instead of Date.now() (current lines 145-147)
} else if (isLiveZoom) {
  windowStartMs = Math.max(dayStart, nowMs - hourWindow * HOUR_MS);
  windowEndMs = Math.min(dayEnd, nowMs + FUTURE_PAD_MS);
}
```

Also update `windowIsFuture` (current line 185, `isToday && windowStartMs >
Date.now()`) to compare against `nowMs` instead of a second, independent
`Date.now()` call, so it can't disagree with the `now` reading
`windowStartMs` was itself derived from. This is a hygiene fix, not required
to close the cascade, but keep it in the same diff since it's the same
line-area and the same underlying "stop reading the live clock ad hoc"
principle.

Do **not** fix this by removing `windowStartMs`/`windowEndMs` from the
effect's dependency array (e.g. `eslint-disable` a stale-closure workaround)
— that would silence the symptom while leaving the hook producing a new
object/value identity on every render, which is a latent perf/correctness
hazard for any other consumer added later. Fix the value's stability at the
source (the hook), not the symptom at the effect.

**Why this is low-risk:** `nowMs` only changes when the interval fires
(matching the existing, already-correct refresh cadence for the block list
and now-line elsewhere in the file, which read `Date.now()` directly for
pure-presentational values that don't feed an effect — leave those as-is,
they're not part of this bug). No behavior change to what a user sees; the
live window still re-anchors every 60s exactly as designed. The only change
is removing the spurious *intermediate* re-anchors that were never intended.

### 4.2 `focus-inference.js` chronology-proxy twin

**File:** `server/lib/focus-inference.js`, `buildActivityDigest()`
(lines 118-125).

**Confirmed root cause (read directly off current `master`):**

```js
// current (focus-inference.js:118-125)
function buildActivityDigest(dbModule, sessionId) {
  const rows = dbModule.db
    .prepare(
      `SELECT event_type, tool_name, data FROM events
       WHERE session_id = ? AND event_type IN ('UserPromptSubmit', 'PreToolUse')
       ORDER BY id ASC LIMIT ?`
    )
    .all(sessionId, MAX_DIGEST_EVENTS);
```

This is the exact bug shape `b3a2cc9` fixed in `focus-report.js`: `ORDER BY id
ASC` used as a chronology proxy, unsafe once `workflow-ingest.js` bulk-inserts
events out of `created_at` order (documented in `b3a2cc9`'s own fix comment,
`focus-report.js:428-438`, and confirmed against a real corrupted session:
7,152/8,117 events out-of-order by id). `buildActivityDigest()` feeds the
prompt digest for both the heuristic/LLM classifier (`inferSession`) and the
new AI window-summary feature (`b930824`, same batch) — a bulk-ingested,
out-of-order session would hand either consumer a non-chronological digest.
It can't reproduce `b3a2cc9`'s exact arithmetic failure (no gap-sum math
here), but a wrong-order digest is a plausible source of a confusing or
incorrect classifier verdict or AI-generated narrative.

**One thing worse than `b3a2cc9`'s original bug, specific to this call site:**
`buildActivityDigest` applies `LIMIT ?` (`MAX_DIGEST_EVENTS = 800`) *at the SQL
level*, ordered by `id`. If a session has more than 800 qualifying events and
some were bulk-inserted out of order, the `LIMIT` can select the wrong
*subset* of 800 — not just present a correct subset in the wrong order. `b3a2cc9`'s
fix pattern (fetch everything, sort in JS after) doesn't fully solve that
here, because the wrong subset would already be excluded before any JS-level
sort runs.

**Fix — sort at the SQL level, before the `LIMIT`, using this codebase's own
established `created_at`-primary/`id`-tiebreak ordering convention** (already
used throughout `server/db.js`, e.g. `listEvents`, `getEventsBySession`,
`webhook_deliveries` queries — `ORDER BY created_at ASC/DESC, id ASC/DESC`).
`events.created_at` is `TEXT NOT NULL DEFAULT
(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` — fixed-width ISO-8601, so it sorts
correctly both lexicographically and chronologically, and it's already
indexed (`idx_events_created ON events(created_at DESC)`), so this needs no
schema change and no new index:

```js
// fixed (focus-inference.js:118-125)
function buildActivityDigest(dbModule, sessionId) {
  const rows = dbModule.db
    .prepare(
      // `ORDER BY id ASC` (insertion order) is NOT reliably chronological —
      // see server/lib/focus-report.js's b3a2cc9 fix comment. A session
      // with heavy Workflow-tool activity can bulk-insert events out of
      // created_at order (server/lib/workflow-ingest.js); sorting by
      // created_at (with id as a tiebreak, matching this codebase's own
      // established ordering convention) before LIMIT ensures both the
      // *order* and the *selected subset* are chronologically correct.
      `SELECT event_type, tool_name, data FROM events
       WHERE session_id = ? AND event_type IN ('UserPromptSubmit', 'PreToolUse')
       ORDER BY created_at ASC, id ASC LIMIT ?`
    )
    .all(sessionId, MAX_DIGEST_EVENTS);
```

No downstream code in `buildActivityDigest` needs to change — `prompts`,
`fileCounts`, `commands` are all built by iterating `rows` in order, which is
now the correct order.

## 5. Change set (ordered, by layer)

**Client:**
1. `client/src/hooks/useHourWindowZoom.ts` — §4.1 fix (`nowMs` state
   replacing the bump-counter; `windowIsFuture` reads `nowMs`).
2. `client/src/components/__tests__/FocusReportModal.test.tsx` — extend the
   existing `[standing template]`/`[board-mode extension]` pattern (line 650,
   737) with a new `[FocusPage extension of the standing template]` test —
   see §7 item 1.
3. `client/src/hooks/__tests__/useHourWindowZoom.test.ts` (new) — §7 item 3.
4. `client/src/components/__tests__/ConcurrencyStatTile.test.tsx` (new) — §7
   item 5.

**Server:**
5. `server/lib/focus-inference.js` — §4.2 fix (`buildActivityDigest`'s query).
6. `server/__tests__/focus-inference.test.js` — add/extend a regression test
   asserting `buildActivityDigest` returns events in `created_at` order even
   when seeded with rows whose `id` order contradicts their `created_at`
   (mirror `b3a2cc9`'s own "out-of-order event insertion" test shape).
7. `server/__tests__/focus-report.test.js` — §7 item 2 (>65,536-interval
   stack-overflow regression) and §7 item 4 helper additions.
8. `server/__tests__/settings-export.test.js` (new) — §7 item 6.

**Docs / process (no code):**
9. `PROJECT-CONTEXT.md` — §6 catalogue additions.
10. `intake/2026-07-31-focus-untracked-commits/decisions.md` (new) — §8
    retroactive decision entries.

## 6. Single-source-of-truth guardrail

This project does not yet have a formally catalogued defect-class registry in
`PROJECT-CONTEXT.md` (confirmed: current file only has "Repo topology"). This
plan is what establishes the first two entries — see §9 for the exact text.
Going forward, any change that touches:

- **A field read by more than one `FocusReport` rendering consumer**
  (`FocusReportBody`/`FocusCalendarView`/`FocusCalendarBoard`/`FocusPage`,
  currently 4 consumers) **must** route through the existing extract-and-share
  discipline this batch itself followed (`HourWindowZoomBar`/
  `useHourWindowZoom`, `StatTile`/`ConcurrencyStatTile`,
  `ProjectScopeFilters`) — never hand-copy a formula into a new consumer. If a
  genuine exception is needed (client-side recompute for a UX reason), it must
  be documented in the introducing file's header the way
  `client/src/lib/windowedTotals.ts` already does, with the bound on how far
  the values can diverge. **This is now the DERIVED-DUAL-VIEW pattern
  (§9.1)** — cite it by name in review.
- **Any query or aggregation over the `events` table that assumes row order
  (`id`) reflects real time order.** `workflow-ingest.js` can bulk-insert
  events out of `created_at` order; any consumer that walks `events` for
  chronological logic (gap-sum math, digest building, display ordering, or
  anything added later) must sort by `created_at` (with `id` as a tiebreak,
  matching the existing `server/db.js` convention) rather than relying on
  `ORDER BY id ASC/DESC` alone. **This is now the row-id-as-chronology-proxy
  pattern (§9.2)** — cite it by name in review.

Both fixes in §4 route through these guardrails rather than being isolated
patches: §4.1 fixes the value-stability problem at its one source
(`useHourWindowZoom.ts`), not by patching every consumer's effect
independently; §4.2 fixes the query at its one source
(`buildActivityDigest`), using the same sort convention `b3a2cc9` established,
not a bespoke re-sort.

## 7. Testing & verification (QA's 5 tests, prioritized, plus the two fix
   regression tests from §4)

Run order matters least-to-most expensive; all must be green before this plan
is considered closed.

1. **Highest priority — `FocusPage` vs. `FocusReportModal` cross-view
   consistency test** (closes the literal DERIVED-DUAL-VIEW gap this intake
   exists to answer). Add to `client/src/components/__tests__/FocusReportModal.test.tsx`
   (or `FocusPage.test.tsx`, either is acceptable as long as it renders both
   surfaces from the *same* fixture in one test) a new
   `describe`/`it` following the exact shape of the existing `[standing
   template]` (line 650) and `[board-mode extension]` (line 737) tests: same
   `makeReport(...)` fixture rendered through both `FocusPage` and
   `FocusReportModal`/`FocusReportBody`, asserting identical on-item
   percentage, active/idle totals, and (once zoomed to the same window)
   windowed totals — replacing `FocusPage.test.tsx`'s current
   independently-hardcoded `75%`/`25%` assertion (line ~350) with a real
   cross-render comparison. Title it so the "extend THIS test" instruction
   explicitly includes "any future `FocusReport` **consumer**," not just "any
   future field" — this closes the exact scope gap PM's §4 diagnosed.
   Run: `cd client && npx vitest run src/components/__tests__/FocusReportModal.test.tsx`
2. **`>65,536`-interval stack-overflow regression** (`60af828`, proves the
   `60af828` fix and guards a future readability-motivated revert to
   `push(...x)`). Add to `server/__tests__/focus-report.test.js`: seed a
   session with a synthetic timestamp list producing >65,536 active
   intervals (reuse the file's existing `seedSession` helper, loop-generate
   timestamps), assert `buildSessionFocusReport` returns without throwing
   `RangeError`. Run: `node --test server/__tests__/focus-report.test.js`
3. **`useHourWindowZoom`/`HourWindowZoomBar` isolated unit test** (new file,
   `client/src/hooks/__tests__/useHourWindowZoom.test.ts`, React Testing
   Library `renderHook`). Assertions: `windowStartMs`/`windowMs` for each of
   4h/8h/12h/24h; `windowIsFuture` true/false at the exact boundary;
   `customOffsetMs` surviving a day-navigation round trip; live-mode
   re-anchor advancing `windowStartMs` on a `ZOOM_REFRESH_MS` fake-timer tick
   — this last assertion is also the regression test for §4.1's fix (assert
   `windowStartMs` does **not** change between two renders that occur
   between ticks, only changes when the tick fires). Run:
   `cd client && npx vitest run src/hooks/__tests__/useHourWindowZoom.test.ts`
4. **`focus-inference.js` chronology regression** (§4.2's fix). Add to
   `server/__tests__/focus-inference.test.js`: seed `events` rows for one
   session where `id` order contradicts `created_at` order (mirror
   `b3a2cc9`'s "out-of-order event insertion" fixture shape), call
   `buildActivityDigest`, assert the returned `prompts`/`commands` reflect
   `created_at` order, not `id` order. Run:
   `node --test server/__tests__/focus-inference.test.js`
5. **Settings-export functional test** (`60af828`, content-correctness for
   the streaming rewrite). New `server/__tests__/settings-export.test.js`:
   seed sessions/events via the same helpers `data-transfer.test.js` uses,
   `GET /api/settings/export`, assert the response JSON's shape/row counts
   match what was seeded. Run:
   `node --test server/__tests__/settings-export.test.js`
6. **`ConcurrencyStatTile` smoke test** (lowest priority, presentational
   only). New `client/src/components/__tests__/ConcurrencyStatTile.test.tsx`:
   renders the ratio for a normal input; renders without throwing for
   `activeConcurrencyRatio: null` (an empty window — `computeWindowedTotals`
   documents this as a valid output). Run:
   `cd client && npx vitest run src/components/__tests__/ConcurrencyStatTile.test.tsx`

**Full-suite gate before closing this plan:**
`npm run test:server` (must stay 1047+N/1047+N, N = new tests added) and
`cd client && npx vitest run` (must stay 645+N/645+N). Do not regenerate
`screens.snapshot.test.tsx` baselines unless a snapshot actually changes as a
*result* of §4's fixes — neither fix changes rendered output, only timing, so
no snapshot diff is expected; if one appears, treat it as a signal to
re-check the fix before blind-accepting per this repo's own
`docs-markdown`/testing-policy rule.

## 8. Retroactive decision entries needed

Write `intake/2026-07-31-focus-untracked-commits/decisions.md` (new file,
scoped to this intake rather than appended to `focus-calendar-board/decisions.md`,
since these postdate and are logically independent of that item's DEC-1..6):

```
# Decisions — 2026-07-31-focus-untracked-commits (retroactive)

## DEC-7: /focus is an intentional second, narrative-lens route
Date recorded: 2026-07-31 (retroactive; feature shipped 2026-07-26, `31927e2`)
Decision: `/focus` (FocusPage.tsx) is an intentional second consumer of the
FocusReport shape alongside `/focus-calendar` (FocusCalendarBoard.tsx), not
scope drift. It serves a stakeholder-facing, narrative/list-first reading of
the same underlying data the calendar board renders spatially. Sara authored
and reviewed this herself; recorded here so a future reader doesn't mistake
a second route on the same data as unreviewed scope creep.
Alternatives considered: none recorded at time of shipping (pre-dates this
retroactive pass) — this entry documents the decision after the fact per the
team-status gate's option A.

## DEC-8: AI window-summary cost/latency profile accepted
Date recorded: 2026-07-31 (retroactive; feature shipped 2026-07-29, `b930824`)
Decision: DASHBOARD_FOCUS_SUMMARY_MODEL defaults to a full-capability model
(sonnet), not a cheaper/faster one (haiku), because the output is
stakeholder-facing prose where quality matters more than latency for this
use case. The associated cost/latency is mitigated, not ignored: digest-based
caching (`focus_summaries` table) bounds repeated LLM calls to real data
changes, and the feature fails open (`{ summary: null }` + 200) rather than
blocking on any LLM unavailability, consistent with this project's existing
focus-audit/focus-inference fail-safe posture.
Alternatives considered: none recorded at time of shipping — this entry
documents the accepted default after the fact per the team-status gate's
option A.
```

## 9. `PROJECT-CONTEXT.md` catalogue additions

Add a new `## Recurring defect-class patterns` section to
`PROJECT-CONTEXT.md` (currently only has `## Repo topology`). Exact text to
paste in, in order:

```markdown
## Recurring defect-class patterns

Named patterns this project has independently rediscovered more than once.
Cite by name in review when a change touches the surface described.

### 9.1 DERIVED-DUAL-VIEW

A derived/summary value (e.g. `wall_ms`, `active_ms`, a concurrency ratio) is
computed once — server-side, in `server/lib/focus-report.js` — and consumed
by multiple independent client rendering surfaces. A fix or new field applied
to one consumer does not automatically apply to the others unless the value
and its rendering are shared via an extracted component/hook, not
hand-copied.

**Flagged in:** `intake/2026-07-26-focus-calendar-board/`,
`intake/2026-07-26-focus-report-fidelity/`,
`intake/2026-07-31-focus-untracked-commits/` (this item — 4th touch).

**Acceptance criterion:** same field, same value, across every consumer of a
given `FocusReport`, enforced by a cross-consumer test — not eyeballing two
UIs. See `client/src/components/__tests__/FocusReportModal.test.tsx`'s
`[standing template]`/`[board-mode extension]`/`[FocusPage extension]` tests
(search `extend THIS test`) for the live implementation of this criterion.

**How to comply:** extract a shared component/hook (see
`HourWindowZoomBar`/`useHourWindowZoom`, `StatTile`/`ConcurrencyStatTile`,
`ProjectScopeFilters` for precedent) rather than reimplementing a formula in
a new consumer. If client-side duplication is genuinely unavoidable (a real
UX cost to a server round-trip), document it in the introducing file's own
header the way `client/src/lib/windowedTotals.ts` does: name the risk
explicitly, explain why extraction wasn't possible, and state the bound on
how far the duplicated value can diverge from the canonical one.

**Known bounded exception:** `client/src/lib/windowedTotals.ts` —
client-side re-slice of the same 10-minute `chunks` grid the Calendar's idle
stripes already render from (not a re-derivation from raw events), bounding
drift from the server's own number to ≤1 chunk (10 min) at a window boundary.

### 9.2 row-id-as-chronology-proxy

A query or aggregation over a table with an auto-increment `id` assumes
`ORDER BY id ASC/DESC` reflects real chronological (`created_at`) order.
Breaks once `server/lib/workflow-ingest.js` bulk-inserts events after the
fact — those rows land at whatever `id` is next, regardless of their own
`created_at`.

**Flagged in:** `6e9a443` (2026-04-26, `client/src/pages/SessionDetail.tsx`,
display-ordering), `b3a2cc9` (2026-07-27, `server/lib/focus-report.js`,
arithmetic double-counting — real session confirmed with 7,152/8,117 events
out-of-order by id), and the `focus-inference.js` `buildActivityDigest()` fix
in `intake/2026-07-31-focus-untracked-commits/` (3rd instance, found live and
unaudited during this retroactive review, same batch as `b930824`'s AI
window-summary feature that consumes it).

**Acceptance criterion:** any code that walks `events` (or any other table
`workflow-ingest.js` bulk-inserts into) for chronological logic must sort by
`created_at` explicitly — never rely on `id` order alone. When a `LIMIT` is
applied in the same query, the `created_at` sort must happen **before** the
`LIMIT`, not after, since an id-ordered `LIMIT` can select the wrong subset
of rows entirely, not just present a correct subset in the wrong order.

**How to comply:** `ORDER BY created_at ASC/DESC, id ASC/DESC` (id as
tiebreak for equal timestamps) — this project's own established convention,
already used throughout `server/db.js` (`listEvents`,
`getEventsBySessionSince`, `webhook_deliveries` queries). `events.created_at`
is fixed-width ISO-8601 text, already indexed
(`idx_events_created ON events(created_at DESC)`) — no schema change needed
to comply.
```

## 10. Risks & rollback

- **§4.1 (`useHourWindowZoom.ts`):** low risk. The change swaps one `useState`
  pattern for another with identical external behavior (same refresh cadence,
  same computed values at steady state) — only intermediate, spurious
  re-computations are removed. Rollback: revert the single file; no data or
  API shape involved. Watch for: the new `useHourWindowZoom.test.ts` (§7
  item 3) failing to catch a regression here in the future if its live-mode
  re-anchor assertion isn't written tightly enough — review that test's fake
  timer setup carefully when it's added.
- **§4.2 (`focus-inference.js`):** low risk. `ORDER BY created_at ASC, id ASC`
  is a strict superset of correctness over `ORDER BY id ASC` for this
  already-indexed column; no new index needed, no measurable performance
  regression expected (SQLite can use `idx_events_created` for either
  direction). Rollback: revert the single-line `ORDER BY` change. Watch for:
  any *other* caller of `buildActivityDigest` (checked — only `inferSession`,
  exported for tests) implicitly depending on `id`-order for something other
  than chronology; none found in this review, but confirm on implementation.
- **Retroactive documentation risk:** none — no code changes in §3/§8/§9.
  The main risk is drift between what's documented and what's actually on
  `master` if a future commit changes the described behavior without a
  matching doc update — mitigated by this repo's own
  `update-project-docs`/`docs-markdown` rules, unchanged by this plan.
- **Test-backfill risk:** none beyond normal test-authoring risk (a badly
  written test that's flaky or asserts the wrong thing). Each new test in §7
  should be run in isolation first, then as part of its full suite, before
  being considered done.

## 11. Definition of Done

- [ ] §4.1 fix applied to `useHourWindowZoom.ts`; `Maximum update depth
      exceeded` warning no longer reproduces when running
      `cd client && npx vitest run src/components/__tests__/FocusReportModal.test.tsx`
      (confirm by capturing stderr, not just assertion pass/fail).
- [ ] §4.2 fix applied to `focus-inference.js`'s `buildActivityDigest` query.
- [ ] All 6 tests in §7 written and green, run both individually and as part
      of their full suite.
- [ ] `npm run test:server` green in full.
- [ ] `cd client && npx vitest run` green in full.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` passes (no
      new/edited applicable file missing the required header — both §4 fixes
      touch existing headered files, confirm the header's file-overview
      comment still accurately describes the file after the edit).
- [ ] `intake/2026-07-31-focus-untracked-commits/decisions.md` written with
      DEC-7 and DEC-8 (§8).
- [ ] `PROJECT-CONTEXT.md` updated with the `## Recurring defect-class
      patterns` section (§9), both entries.
- [ ] Settings-export bundling (`60af828`) noted as a one-line process
      footnote somewhere in this intake's record (PM's §7.7 recommendation) —
      no code or test action required beyond §7 item 5's functional test.
- [ ] This `technical-plan.md`, `pm-plan.md`, and (once written)
      `decisions.md` together stand as the complete retroactive record the
      `team-status` gate asked for — no further intake action needed for the
      seven original commits once the above is complete.
