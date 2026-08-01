# Test Plan — 2026-07-31-focus-untracked-commits

> Authored by `qa-lead`, synthesizing Coverage + Risk + Unit + E2E findings. The QA
> deliverable: exactly what tests to add/modify. Detailed enough to implement
> without re-investigating. (Plan only — a separate step writes the tests.)

## Objective

Close the two currently-live, unguarded bugs this intake exists to fix —
the `useHourWindowZoom.ts` render cascade and `focus-inference.js`'s
`buildActivityDigest()` chronology bug — with regression tests that are
proven to fail against the current, unfixed code before the corresponding
fix lands, then keep the two fixes in place with durable guards. End state:
(1) `FocusPage` is pinned as a verified member of the `DERIVED-DUAL-VIEW`
cross-consumer parity chain (same numbers as `FocusReportModal`/
`FocusReportBody` from one shared fixture, both unwindowed and windowed);
(2) `buildActivityDigest()` is pinned to select the chronologically-correct
*subset* of events pre-`LIMIT`, not just present a correct subset in the
wrong order; (3) the render-cascade fix is pinned on both value-stability
*and* the absence of the "Maximum update depth exceeded" console warning,
not pass/fail alone. Three lower-priority backfill items (>65,536-interval
regression, `ConcurrencyStatTile` smoke test, settings-export functional
test) close remaining test-debt on already-shipped, already-correct code —
should-add, not blocking.

## Coverage gap being closed

- `client/src/pages/FocusPage.tsx` vs `FocusReportModal`/`FocusReportBody` —
  **`DERIVED-DUAL-VIEW`** (pending `PROJECT-CONTEXT.md` §9.1 catalogue add,
  4th recorded instance) — no test today feeds one `FocusReport` fixture
  into `FocusPage` AND `FocusReportModal`/`FocusCalendarBoard` and diffs the
  output; the new cross-view parity test pins this.
- `server/lib/focus-inference.js`'s `buildActivityDigest()` — **
  `row-id-as-chronology-proxy`** (pending `PROJECT-CONTEXT.md` §9.2
  catalogue add, 3rd recorded instance, confirmed worse than the prior two
  because the bad order is applied pre-SQL-`LIMIT`) — existing tests are
  green but structurally cannot catch this (both fixtures have
  insertion-order == `created_at`-order); the new >800-row, contradicting-order
  test pins the specific "wrong subset selected" failure mode.
- `client/src/hooks/useHourWindowZoom.ts` — **render stability /
  no-runaway-effect-loop** (not yet a named catalog entry; risk analyst
  flags it as a 3rd-catalog candidate) — no existing test advances fake
  timers past the 60s `ZOOM_REFRESH_MS` tick or asserts on render
  count/`console.error` output; the new hook unit test's case 4 pins both
  value-identity across spurious re-renders and absence of the React
  warning.
- `server/lib/focus-report.js`'s interval-building path (`60af828`,
  already shipped) — UNGUARDED at the >65,536-interval scale the original
  stack-overflow bug lived at; backfill only, no live bug.
- `client/src/components/ConcurrencyStatTile.tsx` — PARTIAL, only indirect
  coverage via `FocusReportModal.test.tsx`; backfill only, no live bug.
- `server/routes/settings.js`'s `GET /api/settings/export` (`60af828`,
  bundled, already shipped) — UNGUARDED, only a route-registration check
  exists, no functional test of the streamed response; backfill only, no
  live bug.

## Test change set

**Client — hooks (new layer: first file under `client/src/hooks/__tests__/`)**
- `client/src/hooks/__tests__/useHourWindowZoom.test.ts` (new) — 4 cases:
  1. windowStartMs/windowMs for each of 4h/8h/12h/24h (pins the windowing
     formula itself).
  2. `windowIsFuture` true/false at the exact boundary (strict `>`, not `>=`;
     always `false` on a non-today `selectedDate`).
  3. `customOffsetMs` survives a day-navigation round trip; `effectiveAnchorMode`
     reads `"custom"` on a non-today day regardless of stored mode.
  4. **(must-add #3, render-cascade regression)** live-mode re-anchor: force
     several unrelated `rerender()` calls without advancing the clock, assert
     `windowStartMs`/`windowEndMs` are bit-identical across them; advance fake
     time 1ms without crossing the `ZOOM_REFRESH_MS` tick and assert still no
     change; advance fake time by `ZOOM_REFRESH_MS` and assert the window
     *does* re-anchor; assert a `renderCount` counter equals exactly the
     number of `rerender()`/`act()` calls made (no extra hook-internal
     re-renders); wrap with `vi.spyOn(console, "error")` and assert **no**
     call's message includes `"Maximum update depth exceeded"`.

**Client — components**
- `client/src/components/__tests__/FocusReportModal.test.tsx` (extend) —
  **(must-add #2, cross-view parity)** new
  `it("[FocusPage extension of the standing template] ...")` immediately
  after the existing `[board-mode extension]` test. Extend the file's
  `vi.mock("../../lib/api", ...)` to add `api.focusReport`,
  `api.focusReportSummary`, `api.focusReportSummaryConfig`,
  `api.projects.list`, `api.sessions.list`, plus a new
  `vi.mock("../../lib/focusStore", () => ({ useFocusMap: () => new Map() }))`.
  Build one shared `report = makeReport({...})` fixture, feed the **same
  object reference** to both `api.projects.focusReport` (for
  `FocusReportModal`) and `api.focusReport` (for `FocusPage`). Render both
  trees in the same test; scope every query with `within(modalContainer)` /
  `within(pageContainer)`. Assert: (a) identical active_ms/idle_ms formatted
  strings in both containers at the unwindowed 24h view; (b) identical
  on-item/off-plan percentage in both, computed from the shared fixture, not
  a hardcoded literal — this **replaces** `FocusPage.test.tsx`'s current
  independently-hardcoded `75%`/`25%` assertion (~line 350); (c) after
  clicking `"4h"` in **both** trees (same `useHourWindowZoom` hook, same
  fake `NOW`), the *windowed* active/idle totals still agree between the two
  containers — this is the assertion that actually exercises the
  `DERIVED-DUAL-VIEW` risk for a windowed value, not just the raw
  `report.totals` echoed verbatim.
- `client/src/components/__tests__/ConcurrencyStatTile.test.tsx` (new,
  backfill) — 3 cases: (1) normal input renders correct primary/secondary
  ratio, swap button inverts them and persists `CONCURRENCY_PRIMARY_KEY` to
  `localStorage`; (2) `activeConcurrencyRatio: null` (or `concurrencyRatio:
  null`, whichever is the active primary at assertion time) renders `"—"`
  without throwing, swap button still present; (3) `label` prop override
  renders the custom text instead of the i18n default.

**Server — lib**
- `server/__tests__/focus-inference.test.js` (extend, inside existing
  `describe("buildActivityDigest", ...)`) — **(must-add #1, highest
  priority)** two new cases using `stmts.insertEventAt` (add a local
  `addEventAt(sessionId, eventType, toolName, data, createdAtIso)` helper;
  column order confirmed `session_id, agent_id, event_type, tool_name,
  summary, data, created_at` per `server/db.js:1604-1612`):
  - **Case A** — 3 prompts inserted with `id` order contradicting
    `created_at` order; assert `digest.prompts` returns in `created_at`
    order, not `id`/insertion order.
  - **Case B (the trap-defeating case)** — insert `MAX_DIGEST_EVENTS` (800)
    filler `Bash` events first (landing at `id` 1..800, `created_at` set
    *later* than the target, wrapped in `db.transaction(...)` for speed),
    then insert one target `UserPromptSubmit` (`id` 801, `created_at`
    chronologically *earliest*) last. Assert the target survives the
    `LIMIT` and appears in `digest.prompts` — a JS-level post-`.all()` sort
    (the `b3a2cc9`-style fix) would **not** pass this case, since the SQL
    `LIMIT` drops the row before any JS sort runs. This is the assertion
    that distinguishes a correct fix from a plausible-but-still-broken one.
- `server/__tests__/focus-report.test.js` (extend, backfill) — new
  `describe("buildSessionFocusReport - high interval volume", ...)`: bulk-insert
  (transaction-wrapped) 70,000 synthetic plain events inside one open Focus
  segment, call `buildSessionFocusReport` inside `assert.doesNotThrow`
  (or let an uncaught `RangeError` fail the test), and additionally assert
  `active_ms <= wall_ms` and `active_ms + idle_ms === wall_ms` (result must
  be arithmetically sane, not just non-throwing).
- `server/__tests__/settings-export.test.js` (new, backfill) — real
  `GET /api/settings/export` against the running app (`createApp`/
  `startServer`, hand-rolled `http` fetch helper matching this repo's
  per-file convention, no supertest): assert HTTP 200,
  `Content-Type: application/json`, `Content-Disposition` filename pattern,
  valid-JSON-parseable body, seeded row counts per table match exactly, at
  least one specific field value round-trips, ordering matches the route's
  own `ORDER BY started_at DESC`/`created_at DESC`, and an empty-DB call
  still produces valid JSON with `[]` arrays (not malformed comma
  bookkeeping from `writeJsonArray`'s first-flag logic).

**Fixtures / test data**
- No new fixture files. All server cases use synthetic in-test data via
  `stmts.insertEventAt` / bulk transaction-wrapped inserts, reusing each
  file's existing `seedSession`/`t()`/`nextId` helpers. All client cases
  reuse `FocusReportModal.test.tsx`'s existing `makeReport()` builder and
  `FocusPage.test.tsx`'s existing mock-setup pattern for the additional
  `api.*` mocks.

**Reconciliation note (unit vs e2e/integration architects):** both
architects independently converged on the same two spec files for the two
must-add-now items (`focus-inference.test.js` for the chronology bug,
`FocusReportModal.test.tsx` for the cross-view parity test) — no
disagreement to resolve there. The e2e architect additionally proposed and
designed `settings-export.test.js` as a server-side functional/route test
(bucket: API/contract, real HTTP against the real Express app) rather than
a browser e2e flow, correctly noting this project has no browser-e2e layer
and the risk is entirely in stream/response correctness, not UI wiring —
that placement is adopted as-is; no layer move was needed. Exhaustive
per-field `FocusReport` permutation coverage stays at the unit layer
(`FocusReportModal.test.tsx`'s many existing per-field tests); the new
cross-view test asserts only the 3 fields the `DERIVED-DUAL-VIEW` gap
specifically calls out (on-item %, active/idle totals, windowed totals) —
it is not a re-derivation of every field, by design.

## Implementation steps

Sequenced so every regression test is proven RED against the current buggy
code before its corresponding fix lands. Steps 1-3 (server chronology bug),
4-6 (client render cascade), and 7-9 (backfill, pure green-field) can run in
parallel workstreams relative to each other, but within each workstream the
order below is load-bearing.

**Workstream A — chronology fix (`buildActivityDigest`)**
1. Write `server/__tests__/focus-inference.test.js` Cases A and B (must-add
   #1) against **current, unfixed** `master`
   (`ORDER BY id ASC LIMIT ?` still live at `focus-inference.js:123`). Run
   `node --test server/__tests__/focus-inference.test.js --test-name-pattern "buildActivityDigest"`
   and confirm both new cases **fail** — Case A because `digest.prompts`
   comes back in `id`/insertion order, Case B because the target event
   (highest `id`, earliest `created_at`) is dropped entirely by the SQL
   `LIMIT` before any sort runs. Record the red output.
2. Apply the fix: change `buildActivityDigest()`'s query to
   `ORDER BY created_at ASC, id ASC LIMIT ?`.
3. Re-run the same command; confirm both new cases now **pass**, and confirm
   the 2 pre-existing `buildActivityDigest` tests still pass unchanged.

**Workstream B — render-cascade fix (`useHourWindowZoom`)**
4. Write `client/src/hooks/__tests__/useHourWindowZoom.test.ts` case 4 (must-add
   #3) against **current, unfixed** `master` (the `forceRefresh` bump-counter
   still live at `useHourWindowZoom.ts:129-134`). Run
   `cd client && npx vitest run src/hooks/__tests__/useHourWindowZoom.test.ts`
   and confirm case 4 **fails** — the bit-identical `windowStartMs` assertion
   across unrelated re-renders diverges once the fake clock advances even
   1ms between calls. Cases 1-3 are pure value-shape/formula pins, not tied
   to the bug — write them in the same pass but they are expected to pass on
   both old and new code; they are not part of the red-first proof.
5. Apply the fix: replace the `forceRefresh` bump-counter with a `nowMs`
   state value read once per `ZOOM_REFRESH_MS` tick; use `nowMs` in place of
   ad hoc `Date.now()` calls at the live-zoom window-bounds computation
   (lines 145-147) and `windowIsFuture` (line 185).
6. Re-run the same command; confirm case 4 now **passes** in full (value
   stability across spurious re-renders, re-anchor on the real tick,
   `renderCount` matches the number of test-driven renders exactly, no
   `console.error` call containing "Maximum update depth exceeded"), and
   confirm cases 1-3 still pass unchanged. Then run the **integration-level**
   proof: `cd client && npx vitest run src/components/__tests__/FocusReportModal.test.tsx
   src/components/__tests__/FocusCalendarView.test.tsx src/pages/__tests__/FocusPage.test.tsx`
   and confirm no "Maximum update depth exceeded" stderr appears (these
   suites don't yet assert on it directly, but a manual stderr scan here is
   the cheap cross-check that the fix holds one layer up from the isolated
   hook test).

**Workstream C — cross-view parity (must-add #2, depends on nothing above
being fixed first — this test's fixture-parity assertion is orthogonal to
whether the cascade bug is fixed, since it only zooms to "4h" once per tree
and reads the resulting value, not render count)**
7. Write the `[FocusPage extension of the standing template]` case in
   `FocusReportModal.test.tsx` **before** or **after** workstream B — order
   between B and C doesn't matter, but this test must exist and be run
   **before** declaring must-add #2 satisfied. While developing it, prove it
   actually pins parity (not just "renders without throwing") by temporarily
   introducing a one-line divergence — e.g. change `FocusPage.tsx`'s
   `onItemPct` rounding from `Math.round` to `Math.floor`, or swap which of
   `totals.active_ms`/`totals.idle_ms` a `StatTile` reads — run
   `cd client && npx vitest run src/components/__tests__/FocusReportModal.test.tsx`,
   confirm the new case **fails**, then revert the divergence and confirm it
   **passes** again. Record this red/green check in the PR description (no
   real historical bug exists to anchor to here, since `FocusPage.tsx`
   already renders correctly today — this is a genuinely new assertion, not
   a fix regression test).
8. Delete or redirect `FocusPage.test.tsx`'s current independently-hardcoded
   `75%`/`25%` assertion (~line 350) to point at the new cross-view test as
   the parity source of truth — leave a one-line comment, don't let the two
   silently diverge going forward.

**Workstream D — pure backfill, already-correct code (should-add, not
blocking; no fix to sequence against, no red-first bug proof needed — the
"red" state for each is a *manufactured* break used only to prove the test
exercises real logic, not a pre-existing bug)**
9. `server/__tests__/focus-report.test.js`'s >65,536-interval case: prove it
   would have caught the original bug by temporarily reverting
   `focus-report.js`'s loop-push (`for (const interval of intervals)
   sessionActiveIntervalsMs.push(interval)`) back to the old spread
   (`push(...intervals)`) locally, confirm `RangeError: Maximum call stack
   size exceeded` is thrown and the test fails, then revert to current
   `master`'s already-fixed code and confirm it passes.
10. `client/src/components/__tests__/ConcurrencyStatTile.test.tsx`: prove
    case 1's swap assertion is real by temporarily breaking the toggle
    (comment out `setPrimary`'s call, or hardcode `activeIsPrimary = true`),
    confirm the test fails, then revert and confirm it passes.
11. `server/__tests__/settings-export.test.js`: no fix to prove against;
    write directly against the current, already-correct streaming route and
    confirm it passes green on first run (a malformed-JSON or wrong-count
    assertion mismatch here would indicate a real bug in the already-shipped
    route, not an expected red state).

**Final gate**
12. Run the full suites (`npm run test:server`, `cd client && npx vitest run`)
    and confirm `1047+N/1047+N` and `645+N/645+N` respectively (N = new test
    cases added across all workstreams).
13. Run `bash .claude/skills/file-headers/scripts/check-headers.sh` and
    confirm it exits 0 — the 3 new files
    (`useHourWindowZoom.test.ts`, `ConcurrencyStatTile.test.tsx`,
    `settings-export.test.js`) each need the file-header comment
    (`@author Son Nguyen <hoangson091104@gmail.com>` + truthful overview)
    from the first line.
14. Run `cd client && npx vitest run` once more specifically watching
    `screens.snapshot.test.tsx` — no snapshot diff is expected from either
    fix (both change timing/ordering, not rendered output); if one appears,
    treat it as a signal to re-check the fix, not something to blind-accept
    with `-u`.

## Single-source-of-truth guardrail

Not directly applicable in the registry/config sense (no single canonical
registry drives multiple rendered outputs here — `FocusReport` is a runtime
API response shape, not a static config file). The closest analog is the
`DERIVED-DUAL-VIEW` cross-consumer parity chain itself
(`FocusReportModal.test.tsx`'s "[standing template]" tests): every new
`FocusReport`-rendering consumer must add itself to that chain and be
diffed against a **shared fixture object reference**, never a
separately-constructed "equivalent" fixture — step 6/§Test change set
explicitly requires feeding the **same** `report` object to both mocked
endpoints in the parity test so any divergence can only originate in
rendering code, not in accidentally-different input data. Do not accept an
implementation of must-add #2 that builds two separately-authored fixtures
for the two trees, even if their literal values match at write time — that
would silently reintroduce the drift risk the test exists to close.

## Durable-cure decision

**Point tests only for this change-set — the durable structural cures are
explicitly deferred, not adopted here.** Per the strategist's verdict: this
change-set's 3 must-add-now tests (chronology `LIMIT`-subset regression,
cross-view parity, render-cascade value+console assertion) are sufficient to
move the coverage verdict from BLIND to ADEQUATE and are what's required to
ship safely. The two durable cures the strategist recommends —
(a) a `FocusReport`-consumer registry meta-test that fails when a new
consumer is added without a matching parity-chain entry, and (b) an
AST/grep-based guard flagging any `ORDER BY id` without `created_at` on the
`events` table — are **not** built in this pass.

**Consequence of deferring:** this is the 4th recorded `DERIVED-DUAL-VIEW`
instance and the 3rd `row-id-as-chronology-proxy` instance; a prior QA run
(`2026-07-28-wip-queue-page`) already recommended formalizing the
`DERIVED-DUAL-VIEW` registry meta-test after the 3rd occurrence, and that
recommendation was not acted on before this 4th instance shipped. Deferring
the durable cure again means a 5th `DERIVED-DUAL-VIEW` consumer or a 4th
`row-id-as-chronology-proxy` call site can still be added without any
structural enforcement catching it — only future evaluator diligence (a
QA pass, a careful reviewer) would catch it, exactly the failure mode that
let this 4th/3rd instance through. This is flagged as an **open decision
for the user** in `qa-assessment.md` (not a QA-lead unilateral call) — the
implementer should treat this deferral as provisional pending that decision,
and `decisions.md` (DEC-7/DEC-8, already scoped to other topics in this
intake) should get a DEC-9 entry recording whichever way it's resolved,
rather than leaving it silent.

## How to run

No `PROJECT-CONTEXT.md` test-stack section exists yet; commands below are
from `CLAUDE.md` and confirmed against `package.json`/existing suite
conventions by the coverage cartographer.

```bash
# Full server suite (Node's built-in test runner)
npm run test:server

# Full client suite (Vitest + RTL)
npm run test:client   # == cd client && npx vitest run

# Individual new/extended spec files, for fast iteration:
node --test server/__tests__/focus-inference.test.js
node --test server/__tests__/focus-report.test.js
node --test server/__tests__/settings-export.test.js

cd client && npx vitest run src/hooks/__tests__/useHourWindowZoom.test.ts
cd client && npx vitest run src/components/__tests__/FocusReportModal.test.tsx
cd client && npx vitest run src/components/__tests__/ConcurrencyStatTile.test.tsx

# File-header audit (required before calling any new file done)
bash .claude/skills/file-headers/scripts/check-headers.sh
```

## Definition of Done

- [ ] Must-add #1: `focus-inference.test.js` Cases A and B written, observed
      RED against unfixed `master`, GREEN after the `ORDER BY created_at
      ASC, id ASC LIMIT ?` fix lands.
- [ ] Must-add #2: `FocusReportModal.test.tsx`'s `[FocusPage extension of
      the standing template]` case written, proven to catch a manufactured
      one-line divergence (red), passes on the real current code (green),
      asserts parity on both unwindowed (24h) and windowed (4h) totals.
      `FocusPage.test.tsx`'s hardcoded `75%`/`25%` assertion redirected to
      point at this test as the parity source of truth.
- [ ] Must-add #3: `useHourWindowZoom.test.ts` case 4 written, observed RED
      against the unfixed `forceRefresh` bump-counter, GREEN after the
      `nowMs`-state fix lands, including the `console.error` spy assertion
      (not value-stability alone).
- [ ] Should-add: `focus-report.test.js`'s >65,536-interval case,
      `ConcurrencyStatTile.test.tsx`, `settings-export.test.js` all written
      and green; each proven to exercise real logic (manufactured-break
      red/green check for the first two; direct-pass confirmation for the
      third, which has no bug to regress against).
- [ ] `npm run test:server` green in full at `1047+N/1047+N`.
- [ ] `cd client && npx vitest run` green in full at `645+N/645+N`.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] `screens.snapshot.test.tsx` shows no diff (or any diff is investigated
      as a fix-correctness signal, not blind-accepted with `-u`).
- [ ] Both live fixes (`buildActivityDigest`'s `ORDER BY`, `useHourWindowZoom`'s
      `nowMs` state) applied and each individually red-before/green-after per
      steps 1-6 above.
- [ ] Durable-cure decision recorded as an explicit `decisions.md` entry
      (DEC-9 or equivalent) — accept-now or defer-with-rationale, not silent.
