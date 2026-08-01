# Unit / Component Test Design — 2026-07-31-focus-untracked-commits

Scope: the 5 fast-layer test-backfill items this pass's parent instruction asked
for, out of the technical plan's §7 list of 6 (item 6, the settings-export
functional test for `60af828`'s bundled off-surface change, is explicitly
out of scope for this design pass — noted briefly at the end for completeness
against the technical plan, not designed here).

Frameworks (confirmed from `package.json` / existing test files, not assumed):
- **Server:** `node:test` + `node:assert/strict`, one temp SQLite DB per file
  (`process.env.DASHBOARD_DB_PATH` pointed at a tmpdir file before `require("../db")`),
  `before`/`after` cleanup. See `server/__tests__/focus-report.test.js`,
  `server/__tests__/focus-inference.test.js` for the exact shape to follow.
- **Client:** Vitest + `@testing-library/react` (`^16.3.2`) + `@testing-library/user-event`,
  `MemoryRouter` wrapper, `vi.mock("../../lib/api", ...)` module mocks, `vi.useFakeTimers()`/
  `vi.setSystemTime()` for anything date-sensitive. See
  `client/src/components/__tests__/FocusReportModal.test.tsx`,
  `client/src/pages/__tests__/FocusPage.test.tsx`.

Every new/edited spec file must carry this repo's file-header comment
(`@author Son Nguyen <hoangson091104@gmail.com>` + a truthful overview) per
`.claude/rules/file-headers.md` — verify with
`bash .claude/skills/file-headers/scripts/check-headers.sh` before calling any
of these tests done.

---

## 1. `useHourWindowZoom.ts` / `HourWindowZoomBar.tsx` — isolated hook unit test

**Spec file (new):** `client/src/hooks/__tests__/useHourWindowZoom.test.ts`
(new directory — no `client/src/hooks/__tests__/` exists yet on `master`;
confirmed via `find`). Framework: Vitest, `@testing-library/react`'s
`renderHook`/`act` (already a dependency; not yet used by any hook test in
this repo, so this file sets the convention — keep it plain: no JSX, this is
the hook only, `HourWindowZoomBar` gets its own presentational coverage via
the existing `FocusCalendarView.test.tsx`/`FocusPage.test.tsx` integration
suites, which the technical plan explicitly treats as sufficient (§3's `ed23878`
row: "behavior is correctly tested via 16 integration tests... no isolated
hook unit test yet" — this file closes only the hook gap, not a second
`HourWindowZoomBar` render test).

Read the hook's own code (`client/src/hooks/useHourWindowZoom.ts`) — the fix
this test doubles as a regression for is described in
`technical-plan.md` §4.1: replace the `forceRefresh` bump-counter
(current lines 129-134) with a `nowMs` state value, and read `nowMs` instead
of ad hoc `Date.now()` calls at the live-zoom window-bounds computation
(lines 145-147) and `windowIsFuture` (line 185).

### Test setup
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHourWindowZoom, HOUR_WINDOW_OPTIONS } from "../useHourWindowZoom";
```
Use `vi.useFakeTimers()` / `vi.setSystemTime(...)` in every case that reads
"now" — never rely on real wall-clock time (matches this repo's own
`FocusReportModal.test.tsx`/`FocusPage.test.tsx` convention). Pick a fixed
`NOW` mid-day (e.g. `2026-07-28T15:00:00.000Z` in a way that resolves to a
predictable **local** midnight — mirror `FocusPage.test.tsx`'s own
`ZOOM_NOW`/`todayAt()` helper, built from local `Date` setters, not a raw ISO
string, so the test isn't timezone-fragile) so `dayStart`/`dayEnd` are
deterministic. `afterEach(() => vi.useRealTimers())`.

### Cases

1. **`windowStartMs`/`windowMs` for each of 4h/8h/12h/24h** (today, live mode,
   default `windowAnchorMode`). For each `hours` in `HOUR_WINDOW_OPTIONS`:
   `act(() => result.current.setHourWindow(hours))`; assert
   `result.current.windowEndMs - result.current.windowStartMs` equals the
   documented total (`hours + 2` hours for `hours < 24` — the `FUTURE_PAD_MS`
   the file header documents; `24` hours exactly for the `24` option, no pad).
   Assert `windowStartMs === Math.max(dayStart, NOW - hours*HOUR_MS)` and
   `windowEndMs === Math.min(dayEnd, NOW + FUTURE_PAD_MS)` for the zoomed
   sizes, and `windowStartMs === dayStart && windowEndMs === dayEnd` for `24`.
   *Red-first:* these pass on both old and new code (pure value-shape checks,
   not the cascade) — they exist to pin the windowing formula itself so a
   future edit to `FUTURE_PAD_MS`/`HOUR_MS` math is caught, independent of #4
   below.

2. **`windowIsFuture` true/false at the exact boundary.** Set `NOW` such that
   a quick-start offset lands exactly at "now" (`windowStartMs === Date.now()`
   at that instant) and assert `windowIsFuture === false` (the hook's own
   comparison is strict `>`, not `>=` — pin that exact operator, since an
   off-by-one here would silently flip the future-warning banner). Then
   advance `vi.setSystemTime` back 1ms (so the picked window start is now
   1ms in the future) and re-render (or call `handleQuickStartClick` again to
   force a recompute); assert `windowIsFuture === true`. Also assert
   `windowIsFuture === false` unconditionally on a **non-today** `selectedDate`
   even with a future-looking `customOffsetMs` (the hook gates on `isToday`).

3. **`customOffsetMs` surviving a day-navigation round trip.**
   `act(() => result.current.handleQuickStartClick(8 * HOUR_MS))` (an 8am
   start, using the hook's own `QUICK_START_STEP_HOURS`-aligned offset), then
   `rerender({ selectedDate: <next day> })` (renderHook's `rerender` with a
   changed prop) — the offset is stored as "ms since that day's own local
   midnight", not an absolute timestamp, per the file header
   ("paging through past days keeps looking at the same clock-time window on
   each one"). Assert the new day's `windowStartMs - dayStart === 8 * HOUR_MS`
   still (same clock-time offset carried over), and `effectiveAnchorMode`
   reads `"custom"` on the new day even if it was `"live"` before navigating
   away from today (the hook's own `effectiveAnchorMode` guard: a non-today
   day always renders `"custom"` regardless of stored `windowAnchorMode`).

4. **Live-mode re-anchor advancing `windowStartMs` on a `ZOOM_REFRESH_MS`
   fake-timer tick — the render-cascade regression test.** This is the case
   that guards §4.1's fix. Design:
   - `renderHook(() => useHourWindowZoom(today, { defaultHourWindow: 4 }))`
     with fake timers, `NOW` fixed, live mode (default).
   - Capture `result.current.windowStartMs` as `first`.
   - **Force several *unrelated* re-renders without advancing the clock** —
     e.g. `rerender()` called 5 times in a row (renderHook's own rerender,
     simulating "any render of the consumer for any reason", exactly what
     `FocusCalendarView`'s effect-cascade symptom was triggered by). After
     each, assert `result.current.windowStartMs === first` (bit-identical,
     not just numerically close) and `result.current.windowEndMs` equally
     unchanged. **This assertion is false on current `master`** — pre-fix,
     each re-render recomputes from a fresh `Date.now()` call and (unless the
     fake clock's `Date.now()` truly never advances even by 1ms between calls,
     which real V8 timers/fake timers under Vitest do NOT guarantee bit-for-bit
     across separate `Date.now()` invocations at the same faked instant — the
     safer, unambiguous way to force divergence is documented below) would
     produce a **different** `windowStartMs` object/derivation path each call.
     To make the pre-fix failure deterministic (not depend on sub-ms fake-clock
     jitter), additionally advance the fake clock by 1ms between two of the
     `rerender()` calls via `vi.advanceTimersByTime(1)` **without** letting the
     `ZOOM_REFRESH_MS` interval fire (1ms ≪ 60_000ms) — pre-fix this changes
     `windowStartMs` (still reading raw `Date.now()`); post-fix it must not
     (only reads `nowMs`, which only updates on the interval tick).
   - Then `act(() => vi.advanceTimersByTime(ZOOM_REFRESH_MS))` (the hook's own
     60s constant — import or re-derive it as `60_000`, matching the file's
     `ZOOM_REFRESH_MS`) and assert `windowStartMs` **does** change now (the
     tick fired, `nowMs` advanced, and the live window re-anchored) —
     confirms the fix doesn't just freeze the window forever, only stops the
     *spurious intermediate* re-anchors.
   - Also assert **render-count containment**: track a render counter via a
     `let renderCount = 0;` incremented inside the hook-wrapping test
     component/callback passed to `renderHook`, and after the sequence of
     unrelated `rerender()` calls plus the one legitimate tick, assert
     `renderCount` equals exactly the number of `rerender()`/`act()` calls
     made by the test (i.e., no *extra*, hook-internal re-renders were
     triggered by an effect chasing its own changed dependency) — this is the
     structural form of "no runaway effect loop", not just "the value looks
     stable at the end". A pre-fix run would show `renderCount` inflated by
     the effect's own self-triggered updates (bounded by React's ~25-render
     safety valve before it logs "Maximum update depth exceeded" and gives up,
     which is why this must be asserted on the count/identity, not just
     "did it eventually settle").
   - **stderr capture, per the plan's own Definition-of-Done note** ("assert on
     stderr/console output, not just pass/fail"): wrap this case's body with
     `const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});`
     before rendering, and after the full sequence,
     `expect(errorSpy.mock.calls.some(([msg]) => String(msg).includes("Maximum update depth exceeded"))).toBe(false);`
     then restore the spy. This is the assertion that would have caught
     `ed23878`'s bug even though React's render-count safety valve itself
     doesn't throw — the warning is silent-pass today exactly as the change
     brief describes ("Currently silent in CI... the warning goes to stderr
     without failing any assertion").
   *Red-first:* on current `master` (pre-`nowMs` fix), the bit-identical
   `windowStartMs` assertion across unrelated re-renders fails (values differ
   by however much `Date.now()` moved between calls), and — in the fuller
   `FocusCalendarView`/`FocusReportBody` **integration** context where an
   effect actually depends on these values (this isolated hook test can only
   prove value-identity, not the full effect cascade one layer up; call out
   in the PR description that item 2 in §7's client list —
   `FocusReportModal.test.tsx`'s **existing** calendar-toggle test — is the
   integration-level proof the cascade itself, and its warning, stops firing;
   this hook test is the fast, isolated layer under it, and should fail first
   / cheapest). Post-fix, all assertions in this case pass.

**Test data:** no DB/fixtures — pure hook state, driven entirely by
`selectedDate` + fake system time + the hook's own public setters.

**Run:** `cd client && npx vitest run src/hooks/__tests__/useHourWindowZoom.test.ts`

---

## 2. `focus-inference.js`'s `buildActivityDigest()` — chronology-order regression

**Spec file (existing, extend):** `server/__tests__/focus-inference.test.js`,
inside the existing `describe("buildActivityDigest", ...)` block (currently
lines 157-181) — add two new `it(...)` cases alongside the existing two, same
file, same `seedSession`/`addEvent`-family helpers. Use `stmts.insertEventAt`
(already defined in `server/db.js:1611`, — NOT currently imported by this
test file's `dbModule`/`stmts` destructure at the top; add
`insertEventAt: stmts.insertEventAt` usage or call `stmts.insertEventAt.run(...)`
directly) instead of `stmts.insertEvent` (which stamps `created_at` as
`now()` and can't produce out-of-order timestamps) or the raw
`insertPlainEventRaw`/`insertFocusEventRaw` patterns `focus-report.test.js`
uses (mirror `b3a2cc9`'s own "out-of-order event insertion" fixture shape,
per the technical plan's explicit instruction).

Add a small local helper, colocated with the other `add*` helpers in this
file:
```js
function addEventAt(sessionId, eventType, toolName, data, createdAtIso) {
  stmts.insertEventAt.run(
    sessionId, null, eventType, toolName, null,
    data ? JSON.stringify(data) : null, createdAtIso
  );
}
```
(`insertEventAt`'s column order is `session_id, agent_id, event_type,
tool_name, summary, data, created_at` — confirmed off `server/db.js:1604-1612`.)

### Case A — order preserved by `created_at`, not `id`
Seed 3 `UserPromptSubmit` events for one session, inserted (so `id` ascends)
in this order but with **contradicting** `created_at`:
1. insert prompt `"third chronologically"` at `created_at = t(30)` (id 1)
2. insert prompt `"first chronologically"` at `created_at = t(0)` (id 2)
3. insert prompt `"second chronologically"` at `created_at = t(10)` (id 3)

(`t(minutes)` — reuse or mirror `focus-report.test.js`'s own fixed-epoch
helper so timestamps are exact and independent of real wall-clock time; add
an equivalent local helper here if this file doesn't already have one.)

Call `buildActivityDigest(dbModule, id)`. Assert:
```js
assert.deepEqual(digest.prompts, [
  "first chronologically",
  "second chronologically",
  "third chronologically",
]);
```
*Red-first:* on current `master` (`ORDER BY id ASC`), this returns
`["third chronologically", "first chronologically", "second chronologically"]`
(insertion/id order) — the assertion fails. Post-fix
(`ORDER BY created_at ASC, id ASC`), it returns the chronological order above
and passes.

### Case B — `LIMIT` selects the chronologically-correct *subset*, not an id-ordered one
This is the sharper of the two bugs the technical plan flags (§4.2: "the
`LIMIT` is applied at the SQL level... can select the wrong *subset* of 800
events, not just present a correct subset in the wrong order"). Design so it
stays fast (no slowness concern — one `db.transaction(...)`-wrapped bulk
insert of ~800 prepared-statement calls is sub-second in better-sqlite3, well
under this suite's existing per-file runtime):

1. Insert **`MAX_DIGEST_EVENTS` (800) filler `Bash` events** for one session,
   each a distinct command (`cmd-0` .. `cmd-799`, so none collapse via the
   digest's own dedup `Set`), each with `created_at` set to a time **later**
   than the one target event below (e.g. `t(1000 + i)` for filler `i`),
   inserted **first** so they land at `id` 1..800 — wrap the loop in
   `db.transaction(() => { ... })()` for speed, matching the
   `db.transaction` usage already present elsewhere in this repo's test
   suites (`focus-inference.test.js:673`/`741`, `focus-report.test.js`
   pattern search confirms the API is available on this `db` instance).
2. Insert **one target `UserPromptSubmit` event** (`prompt: "TARGET should
   survive the LIMIT"`) with `created_at = t(0)` — chronologically **before**
   every filler — inserted **last**, so it lands at `id` 801.
3. Call `buildActivityDigest(dbModule, id)`.
4. Assert the target survived:
   ```js
   assert.equal(digest.prompts.length, 1);
   assert.match(digest.prompts[0], /TARGET should survive the LIMIT/);
   ```
   *Red-first:* on current `master`, `ORDER BY id ASC LIMIT 800` selects
   rows with `id` 1-800 — exactly the 800 fillers — and excludes `id` 801 (the
   target) entirely before the JS loop ever runs, regardless of any
   downstream sort; `digest.prompts` is empty and the assertion fails. A
   JS-level post-sort (the `b3a2cc9`-style fix pattern) would **not** fix
   this case — the row was already dropped by the SQL `LIMIT` — which is
   exactly the "worse than `b3a2cc9`'s original bug" distinction the plan
   calls out; this case is the one that actually pins that distinction, Case
   A alone would not. Post-fix (`ORDER BY created_at ASC, id ASC LIMIT 800`),
   the target (earliest `created_at`) sorts first, survives the `LIMIT`
   (displacing the single chronologically-*latest* filler instead), and the
   assertion passes.

**Test data:** synthetic events via `stmts.insertEventAt`, no external
fixtures. Reuse the file's existing `nextId("sess")` and `seedSession(id)`
helpers for session setup.

**Run:** `node --test server/__tests__/focus-inference.test.js`
(and individually: `node --test server/__tests__/focus-inference.test.js --test-name-pattern "buildActivityDigest"` if narrower iteration is wanted while developing).

---

## 3. `focus-report.js`'s `60af828` stack-overflow fix — cheap `>65,536`-interval regression

**Spec file (existing, extend):** `server/__tests__/focus-report.test.js` —
add a new `it(...)` in a `describe("buildSessionFocusReport - high interval volume", ...)`
block (new `describe`, following this file's existing pattern of scoping
regression tests by concern, e.g. its own
`describe("buildSessionFocusReport - out-of-order event insertion")` for
`b3a2cc9`).

**Root cause location (confirmed from source):** `activeIntervals()`
(`server/lib/focus-report.js:203-221`) walks `[startMs, ...inWindow, endMs]`
and pushes one `[a, b]` interval per gap; `buildSessionFocusReport`
(lines 444-453) then does `for (const interval of intervals) sessionActiveIntervalsMs.push(interval)`
(the fixed loop-push) instead of the old `push(...intervals)` spread, which
threw `RangeError: Maximum call stack size exceeded` once `intervals.length`
passed V8's ~65,536 spread-as-arguments ceiling. `activeIntervals` itself is
**not exported** from `focus-report.js` (confirmed:
`module.exports` at line 644 lists `buildFocusSegments`,
`buildSessionFocusReport`, `buildProjectFocusReport`, `buildActivityChunks`,
`clipSegmentToWindow`, `mergeIntervals`, `emptyKindTotals`, `noFocusSegment`,
`DEFAULT_GRACE_SECONDS`, `CHUNK_MS`, `NONE_KIND` — no `activeIntervals`), so
this must be exercised through the public `buildSessionFocusReport(dbModule, session, ...)`
entry point, via real (but bulk-inserted, transaction-wrapped) `events` rows —
exactly what the technical plan's §7 item 2 prescribes ("reuse the file's
existing `seedSession` helper, loop-generate timestamps").

### Case — >65,536 active intervals, no `RangeError`, and correct totals
To get `activeIntervals` to emit >65,536 intervals, the *number of qualifying
event timestamps strictly inside the segment's `[start, end)` window* must
exceed 65,536 (each interior point plus the segment edges produces one gap ⇒
one interval, per the function's own per-point loop — grace is irrelevant to
*count*, only to each interval's own capped width). Design:

1. `seedSession(id, CWD)` (existing helper, `focus-report.test.js:69-71`).
2. Open one Focus segment spanning a wide window, e.g.
   `focus(id, 0, "set", { item_number: 1 })` at minute 0 and leave it open
   (or `focus(id, 20000, "done", ...)` at a far-future minute) so the segment
   comfortably contains 70,000 interior points — this file's existing `t(minutesFromStart)`
   helper (`focus-report.test.js:66-68`) is minute-granular; either extend it
   locally for this case with a seconds- or ms-level variant, or space the
   70,000 synthetic events across a wide enough minute range that each still
   gets a distinct, strictly-increasing `created_at` (e.g. one plain event
   every 2 seconds across ~39 hours comfortably yields 70,000 distinct,
   strictly increasing timestamps within one segment).
3. **Bulk-insert 70,000 plain events** (`event_type: "PostToolUse"`, matching
   this file's own `insertPlainEventRaw` helper/pattern used for non-Focus
   filler activity) at those synthetic timestamps, wrapped in
   `db.transaction(() => { for (...) insertPlainEventRaw.run(...) })()` for
   speed — do **not** loop 70,000 unbatched `.run()` calls outside a
   transaction; wrapping keeps this test in the tens-of-milliseconds range
   (better-sqlite3's transaction-wrapped inserts run at ~10^5-10^6 rows/sec),
   which is the "cheaply" the parent task asks for — no `setTimeout`/real
   waiting, no mocked-slow I/O, just enough real rows to cross the actual
   65,536 boundary the bug lived at.
4. Call `buildSessionFocusReport(dbModule, session, null, null)` (the
   session/report object shape this file's other `buildSessionFocusReport`
   calls already use — check an existing call site in this file for the
   exact session-row shape expected, e.g. `{ id, name, cwd, ended_at }`, and
   reuse it) **inside `assert.doesNotThrow(...)`** (or a plain call with no
   `try/catch`, letting `node:test` itself fail the case on an uncaught
   `RangeError` — either is idiomatic here; prefer `assert.doesNotThrow` for
   an explicit, self-documenting assertion rather than relying on an
   unhandled throw to fail the test implicitly).
5. Additionally assert the **result is arithmetically sane**, not just
   "didn't throw" (a silent partial result would be a worse regression than a
   clean crash): `report.segments[0].active_ms <= report.segments[0].wall_ms`
   (the exact invariant `b3a2cc9` was protecting — `active_ms` must never
   exceed `wall_ms`/drive `idle_ms` negative) and
   `report.segments[0].active_ms + report.segments[0].idle_ms === report.segments[0].wall_ms`
   (mirrors this file's existing exact-value assertion style in the
   out-of-order-insertion block).

*Red-first:* on the `push(...intervals)` (pre-`60af828`) code shape, step 4
throws `RangeError: Maximum call stack size exceeded` and the test fails at
the `assert.doesNotThrow`/unhandled-throw point. Since `60af828`'s fix is
**already shipped** on current `master` (per the change brief — this is a
regression test for an already-landed fix, not a new fix), the "red" state
for this specific test is proven by temporarily reverting the loop-push to
the old spread (`sessionActiveIntervalsMs.push(...intervals)`) locally while
developing the test, confirming it fails, then reverting back — call this out
explicitly in the PR/commit description per this repo's own testing policy
("confirm red-before/green-after", the same discipline `b3a2cc9`'s own test
block used per the technical plan's §3 table). Post-fix (current `master`,
unchanged), the test passes.

**Test data:** synthetic, generated in-test (no external fixture file) —
70,000 plain events at 2-second synthetic intervals, one open-ended Focus
segment. Reuses `seedSession`/`t()`/`insertPlainEventRaw` from this file's
existing top-of-file helpers.

**Run:** `node --test server/__tests__/focus-report.test.js`

---

## 4. `ConcurrencyStatTile.tsx` — presentational smoke test

**Spec file (new):** `client/src/components/__tests__/ConcurrencyStatTile.test.tsx`.
Framework: Vitest + `@testing-library/react` `render`/`screen`. No API mocks
needed — this is a pure presentational component (`ConcurrencyStatTile.tsx`),
its only side effect is a try/catch-guarded `localStorage` read/write under
the `CONCURRENCY_PRIMARY_KEY` key (already exported from the component for
exactly this purpose — see `ConcurrencyStatTile.tsx:36`, and see
`FocusReportModal.test.tsx`'s own `localStorage.removeItem(CONCURRENCY_PRIMARY_KEY)`
in its `beforeEach` for the reset convention to mirror here).

### Cases
1. **Renders the ratio for a normal input.** Render with
   `concurrencyRatio={1.5}`, `activeConcurrencyRatio={2.25}`,
   `wallClockMs={2 * 60 * 60_000}`, `activeWallClockMs={90 * 60_000}`. Assert
   the primary value renders as `"2.25x"` (active is primary by default per
   `loadPrimary()`'s fallback), the sub-line shows the active-time
   denominator (`t("report.ofActiveTime", ...)`-driven text — assert via
   `formatMs(90 * 60_000)`'s own rendered substring, not the full i18n
   string, to stay decoupled from locale-file wording per this repo's
   existing test convention of matching on formatted numbers/times rather
   than full translated sentences), and the secondary sub-line shows
   `"1.50"` (the `.toFixed(2)` open ratio). Click the swap button
   (`aria-label`/`title` = `t("report.concurrencyToggle")` — get it by role
   `button` since there's only one interactive element in this component) and
   assert the primary/secondary values invert (`"1.50x"` now primary,
   `"2.25"` now secondary) and `localStorage.getItem(CONCURRENCY_PRIMARY_KEY)`
   becomes `"open"`.
2. **Renders without throwing for `activeConcurrencyRatio: null`** (an empty
   window — the component's own header doc: "`computeWindowedTotals`
   documents this as a valid output"). Render with
   `concurrencyRatio={1.2}`, `activeConcurrencyRatio={null}`,
   `wallClockMs={60_000}`, `activeWallClockMs={null}`. Assert:
   - No throw (the render itself succeeding is the primary smoke assertion).
   - Primary value (active, still primary by default even though it's
     `null`) renders as `"—"` (the component's own null-fallback: `primaryRatio != null ? ... : "—"`).
   - No secondary sub-line node is rendered at all when `secondaryRatio` is
     `null` (`concurrencyRatio` IS non-null here, `1.2`, so with active
     primary the secondary — open — is non-null and DOES render; adjust: to
     actually hit "sub-line omitted", pass `concurrencyRatio={null}` too, OR
     explicitly swap primary to `"open"` first via
     `localStorage.setItem(CONCURRENCY_PRIMARY_KEY, "open")` before mount so
     `activeConcurrencyRatio: null` is the *secondary* value being omitted —
     pick whichever reads more directly as "the null case renders safely";
     either is an acceptable smoke case, just be precise about which ratio is
     primary at assertion time since the component's default primary is
     `"active"`).
   - The swap button still renders and remains clickable (doesn't
     conditionally disappear just because one ratio is null) — per the file
     header: "the swap button stays either way, so the preference can still
     be set for reports that do carry both."
3. **(Optional, cheap to add, closes the `label` prop's only other branch)**
   Render with `label="Concurrent agent sessions"` (the Calendar board's
   DEC-6 relabel per the component's own prop doc) and assert that exact
   text renders instead of the default `t("report.concurrency")` label —
   guards the one-line override branch (`label ?? t("report.concurrency")`)
   from silently breaking.

*Red-first framing:* this is new coverage for an already-shipped,
already-working component (`0d5fbe7`, per the technical plan's own "Yes,
existing suites green" verification) — there is no known live bug here. The
"red-first" bar for this one is: temporarily break the primary/secondary swap
(e.g. comment out the `toggle` function's `setPrimary` call, or hardcode
`activeIsPrimary = true`) and confirm case 1's swap assertion fails, then
restore — this proves the test actually exercises the swap logic rather than
trivially passing on any render. Record that check in the PR description
since there's no pre-existing red commit to point to here (unlike items 2-3
above, which have a real historical bug to anchor to).

**Run:** `cd client && npx vitest run src/components/__tests__/ConcurrencyStatTile.test.tsx`

---

## 5. `/focus` page cross-view consistency test — `DERIVED-DUAL-VIEW` (§9.1)

This is the plan's #1 priority test-backfill item and the direct QA answer to
the `DERIVED-DUAL-VIEW` defect-class pattern (pending catalogue add, §9.1 of
`technical-plan.md`) — "same field, same value, across every consumer of a
given `FocusReport`, enforced by a cross-consumer test — not eyeballing two
UIs."

**Spec file (existing, extend):**
`client/src/components/__tests__/FocusReportModal.test.tsx` — add a new
`it("[FocusPage extension of the standing template] ...")` case immediately
after the existing `[board-mode extension of the standing template]` test
(current lines 737-860), following the exact naming/extend-this-test
convention those two already establish (search this file for
`"extend THIS test"` — both existing docstrings explicitly say to extend
them, not write a view-local test elsewhere; this new case is the third
extension in that chain and should update the two existing tests' own
docstrings to also mention "and `FocusPage`" so a *future* fourth consumer
finds all three, not just the two nearest it, per the change brief's own
framing: "extend THIS test... for any future FocusReport **consumer**").

### Why this file, not `FocusPage.test.tsx`
The technical plan says either file is acceptable "as long as it renders both
surfaces from the *same* fixture in one test." `FocusReportModal.test.tsx`
is preferred here because it already owns the `[standing template]`/
`[board-mode extension]` chain — keeping all three in one file means one
`makeReport()` fixture shape and one place a reviewer checks for "did the
newest consumer get added to the parity chain."

### Mock-setup delta this test needs (do this once, read carefully)
`FocusReportModal.test.tsx`'s existing top-of-file mock only covers
`api.projects.focusReport` (single-project GET, what `FocusReportModal`
calls). `FocusPage.tsx` calls a **different** top-level endpoint —
`api.focusReport` (windowed, cross-project `GET /api/focus-report`,
confirmed at `client/src/lib/api.ts:2046`, distinct from
`api.projects.focusReport` at `api.ts:2176`) — plus `api.focusReportSummary`,
`api.focusReportSummaryConfig`, `api.projects.list`, `api.sessions.list`, and
the `../../lib/focusStore` module's `useFocusMap` hook (confirmed from
`FocusPage.test.tsx`'s own mock block, lines 37-59). **Extend (don't
replace) this file's existing `vi.mock("../../lib/api", ...)`** to add these
additional mocked entries alongside the existing `projects.focusReport`, and
add a second `vi.mock("../../lib/focusStore", () => ({ useFocusMap: () => new Map() }))`
(no live sessions needed for this parity check — keep it inert, matching
`FocusPage.test.tsx`'s own default `useFocusMapMock.mockReturnValue(new Map())`).
Import `FocusPage` from `"../../pages/FocusPage"` at the top of this file.

### Test body
1. `vi.useFakeTimers(); vi.setSystemTime(NOW)` (reuse this file's existing
   `NOW` convention from the two prior standing-template tests, e.g.
   `2026-07-26T15:00:00.000Z`, so all three tests in the chain share one
   deterministic "now").
2. Build **one** `report = makeReport({ ... })` fixture (this file's existing
   builder), with a segment shape rich enough to exercise both the raw
   totals AND the on-item/off-plan split AND a windowed-zoom recompute —
   reuse the existing `[standing template]` test's segment (today,
   09:00-09:20, `wall_ms: 20m`, `active_ms: 10m`, `idle_ms: 10m`, one
   `item`-kind, with `chunks`), plus set `totals`/`wall_clock_ms`/
   `concurrency_ratio` consistently the way the `[board-mode extension]`
   test already does (its own comment explains why: "the 'Total active agent
   time' stat tile reads `report.totals.active_ms` verbatim... an unrelated
   default here would silently pass a stale number").
3. **Feed the same `report` object to both mocked endpoints:**
   `focusReportMock.mockResolvedValue(report)` (the existing
   `api.projects.focusReport` mock, for `FocusReportModal`) **and**
   the new `api.focusReport` mock (top-level), also
   `.mockResolvedValue(report)` — same object reference, not two separately
   constructed fixtures, so any drift between the two render paths can only
   come from the *rendering* code, never from divergent input data.
4. Render `FocusReportModal` (as the existing tests already do via
   `renderModal()`), flush its mock fetch (existing `act(async () => { for (...) await Promise.resolve() })`
   pattern this file already uses under fake timers), switch to Calendar
   view, click `"24h"` (same de-risking the two existing tests already do,
   to sidestep the default 4h live-zoom window).
5. Render `FocusPage` (fresh `render(<MemoryRouter><FocusPage /></MemoryRouter>)`
   in the **same test**, second `render()` call — both mounted trees coexist
   in the same test's DOM, matching how the `[board-mode extension]` test
   already mounts two `FocusReportBody` trees side by side and diffs their
   `container`s), flush its own fetch the same way, and click `"24h"` there
   too (`FocusPage`'s own default is already `24` per
   `useHourWindowZoom(selectedDate, { defaultHourWindow: 24 })` at
   `FocusPage.tsx:464` — so this click may be a no-op confirm-only step
   rather than a required narrowing; assert `aria-pressed="true"` on `FocusPage`'s
   own `"24h"` button either way, to pin that its default truly is unzoomed
   and isn't accidentally narrower than the modal's explicit click).
6. **Assertions — identical numbers, read independently in each container**
   (use `within(modalContainer)`/`within(pageContainer)` scoping throughout,
   never a bare `screen.getBy...` once both trees are mounted, or a query
   could accidentally match text in the wrong tree):
   - **Active/idle totals:** both containers show the segment's
     `active_ms`/`idle_ms` as the same formatted string (`formatMs` output,
     e.g. `"10m 0s"`) — `FocusReportModal`'s List view already renders these
     per-session (per the `[standing template]` test's own
     `within(listRow).getByText(/10m 0s/)`); `FocusPage` renders
     `report.totals.active_ms`/`idle_ms` on its own stat tiles (`StatTile`
     with `label={t("report.activeTime")}`/`t("report.idleTime")` —
     confirm exact label keys against `FocusPage.tsx` around its `<StatTile>`
     block, lines ~605-630). Assert the **exact same formatted substring**
     appears in both `within(...)` scopes.
   - **On-item / off-plan percentage:** `FocusPage.tsx`'s own header comment
     states the formula explicitly ("mirrors `FocusReportBody`'s exact
     formula (`totals.by_kind.item.active_ms / totals.active_ms`) — keep the
     two in lock-step") — assert `FocusPage`'s rendered `onItemPct`
     (`Math.round((totals.by_kind.item.active_ms / totals.active_ms) * 100)`,
     `FocusPage.tsx:575-576`) matches whatever percentage `FocusReportModal`/
     `FocusReportBody` renders for the same fixture (if `FocusReportBody`
     doesn't render a literal `%` stat tile today, compute the expected value
     from the shared `report.totals` directly in the test and assert
     `FocusPage`'s rendered `%` text equals that computed value — this
     **replaces** `FocusPage.test.tsx`'s current independently-hardcoded
     `75%`/`25%` assertion at its own line ~350 per the technical plan's
     explicit instruction: "replacing `FocusPage.test.tsx`'s current
     independently-hardcoded `75%`/`25%` assertion... with a real cross-render
     comparison" — leave a comment in `FocusPage.test.tsx` at that spot
     pointing to this new cross-view test as the parity source of truth, or
     migrate that assertion here entirely and delete the hardcoded one from
     `FocusPage.test.tsx` if the technical plan's implementer prefers one
     canonical location — either is acceptable, but the two must not silently
     diverge going forward).
   - **Windowed totals, once zoomed to the same window:** with both already
     on `"24h"` (the full, unwindowed report — the simplest shared window to
     start with), assert both agree exactly as above. **Then**, as a stronger
     version of the same check, click `"4h"` on **both** (same live-zoom
     window definition, same `useHourWindowZoom` hook, same fake `NOW`) and
     re-assert the (now windowed, `computeWindowedTotals`-derived) active/idle
     numbers still match between the two containers — this is the case that
     actually exercises `DERIVED-DUAL-VIEW`'s risk surface for a
     **windowed** value, not just the raw unwindowed `report.totals` echoed
     verbatim by both (a weaker check that could pass even if the two
     consumers' *windowing* math had silently diverged, since `report.totals`
     itself never changes with the zoom — only each consumer's own
     client-side windowed recompute does).

*Red-first:* before this test exists, nothing asserts `FocusPage` and
`FocusReportModal`/`FocusReportBody` agree on any field for the same input —
confirmed by the change brief itself ("no test yet asserts `FocusPage` and
`FocusReportModal`/`FocusCalendarBoard` produce identical numbers from the
same fixture"). To prove this test actually pins that (not just "renders
without throwing"), temporarily introduce a one-line divergence while
developing it — e.g. change `FocusPage.tsx`'s `onItemPct` rounding from
`Math.round` to `Math.floor`, or swap which of `totals.active_ms`/
`totals.idle_ms` a `StatTile` reads — and confirm the new assertion fails;
then revert. Record that check in the PR/commit description, matching this
repo's "confirm red-before/green-after" convention already used for
`b3a2cc9`'s own test.

**Run:**
`cd client && npx vitest run src/components/__tests__/FocusReportModal.test.tsx`

---

## Full-suite gate (from `technical-plan.md` §7/§11 — run once all 5 above are green)

- `npm run test:server` → must stay **1047+N/1047+N** (N = new server test
  cases added; items 2 and 3 above each add tests to existing server files).
- `cd client && npx vitest run` → must stay **645+N/645+N** (N = new client
  test cases added; items 1, 4, and 5 above add tests, items 1 as a new file,
  4 as a new file, 5 as a new case in an existing file).
- `bash .claude/skills/file-headers/scripts/check-headers.sh` → must exit 0
  (new files `useHourWindowZoom.test.ts` and `ConcurrencyStatTile.test.tsx`
  need the header from the very first line written, per
  `.claude/rules/file-headers.md`).
- No snapshot-baseline regeneration expected from any of the above — the
  technical plan is explicit that neither underlying fix (§4.1, §4.2) changes
  rendered output, only timing/ordering; if `screens.snapshot.test.tsx` shows
  a diff after these changes land, treat it as a signal to re-check the fix
  per this repo's own testing policy (`CLAUDE.md`'s "review the snapshot diff
  and regenerate baselines... never blindly update snapshots"), not something
  to blind-accept.

## Out of scope for this design pass (noted for completeness only)

`technical-plan.md` §7 item 5 / change brief's 6th test-backfill file,
`server/__tests__/settings-export.test.js` (a functional test for `60af828`'s
bundled, off-surface `/api/settings/export` streaming rewrite), was not part
of this instruction's 5-item scope and is not designed here. If picked up
later, it belongs in the **functional/integration** layer (a real `GET`
against the Express route via `supertest`-style or this repo's existing
route-test pattern — check `server/__tests__/` for an existing
`/api/settings` route test to match), not this unit-test design doc; reuse
`data-transfer.test.js`'s seeding helpers per the technical plan's own
pointer.
