# Change Brief — 2026-07-31-focus-untracked-commits

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-07-31
- **Scope source:** intake-handoff
- **Intake link:** `intake/2026-07-31-focus-untracked-commits/` (`technical-plan.md`, `pm-plan.md`, `request-brief.md`, `supporting/architect.md`, `supporting/engineer.md`, `supporting/qa.md`)

## Change summary

This is a **retroactive** intake covering seven already-merged commits
(`0416066`..`60af828`, 2026-07-26 through 2026-07-30) that shipped the
Focus-report surface (windowed stat totals, a new `/focus` stakeholder
page, hour-window zoom control, AI window summaries, board polish, and two
prior bug fixes) with no intake folder behind them. `technical-plan.md`
prescribes two categories of forward work for this pass: (1) pure
documentation/paper-trail (retroactive shipped-record, two decision-log
entries, two `PROJECT-CONTEXT.md` defect-catalogue entries — no code) and
(2) two real, currently-live code bug fixes discovered *by* this review
(a React render cascade in the hour-window-zoom hook, and a
chronology-ordering bug in a server-side digest query), plus 6 prioritized
test-backfill tasks. **None of the code fixes, new tests, decisions.md, or
`PROJECT-CONTEXT.md` catalogue additions have been implemented yet** — this
brief describes the *intended* change set the plan lays out, spot-checked
against current `master`, not a change that has already landed.

## Changed files (by layer)

Two sub-scopes: (A) the seven **already-merged, historical** commits this
intake retroactively documents (verified against current `master`, not
re-litigated), and (B) the **not-yet-implemented** forward work this plan
authorizes (2 bug fixes + 6 tests + 2 docs artifacts). QA planning should
target (B); (A) is context, already shipped and already tested per its own
commit history.

**(A) Historical — already on `master`, documented not modified by this plan**
- `server/routes/focus-report.js`, `server/lib/focus-report.js`,
  `client/src/components/FocusCalendarView.tsx` — windowed stat totals
  (`0416066`).
- `client/src/pages/FocusPage.tsx` (new, 773 lines),
  `client/src/components/Sidebar.tsx`, `App.tsx`,
  `client/src/components/StatTile.tsx`, `FocusActivityCard.tsx`,
  `ProjectScopeFilters.tsx` (all new) — new `/focus` route (`31927e2`).
- `server/lib/focus-report.js:439-441` — chronology sort fix,
  `buildSessionFocusReport` (`b3a2cc9`, already shipped and tested).
- `client/src/hooks/useHourWindowZoom.ts` (new, 203 lines),
  `client/src/components/HourWindowZoomBar.tsx` (new, 219 lines) — hour-window
  zoom extraction (`ed23878`) — **this is the commit that introduced the
  render-cascade bug fixed under (B) below.**
- `server/lib/focus-summary.js` (new, 463 lines), `focus_summaries` cache
  table, `DASHBOARD_FOCUS_SUMMARY_MODEL` env var — AI window summaries
  (`b930824`).
- `client/src/components/ConcurrencyStatTile.tsx` (new), fixes across
  `FocusReportBody`/`StatTile`/`TimePeriodPicker`/`api.ts` — board polish
  (`0d5fbe7`).
- `server/lib/focus-report.js:449-453` — loop-push stack-overflow fix
  (`60af828`, already shipped, **no regression test yet** — see (B) item 5
  below); bundled in the same commit, off-surface:
  `server/lib/data-transfer.js` / `server/routes/settings.js` streaming
  rewrite for `/api/settings/export`.

**(B) Forward work this plan authorizes — not yet implemented (verified: none present on current `master`)**

*Client:*
- `client/src/hooks/useHourWindowZoom.ts` — fix the live-zoom render
  cascade: replace the `forceRefresh` bump-counter (currently lines
  129-134) with a `nowMs` state value read once per `ZOOM_REFRESH_MS` tick,
  used in place of ad hoc `Date.now()` calls at the live-zoom window-bounds
  computation (currently lines 145-147) and `windowIsFuture` (currently
  line 185).
- `client/src/components/__tests__/FocusReportModal.test.tsx` — new
  `[FocusPage extension of the standing template]` cross-view test
  (highest-priority test-backfill item).
- `client/src/hooks/__tests__/useHourWindowZoom.test.ts` (new) — isolated
  hook unit test, doubles as the render-cascade fix's regression test.
- `client/src/components/__tests__/ConcurrencyStatTile.test.tsx` (new) —
  presentational smoke test.

*Server:*
- `server/lib/focus-inference.js` — fix `buildActivityDigest()` (currently
  lines 118-125, confirmed still `ORDER BY id ASC LIMIT ?`) to
  `ORDER BY created_at ASC, id ASC LIMIT ?`, matching the codebase's
  established chronology-sort convention.
- `server/__tests__/focus-inference.test.js` — new regression test for the
  above (out-of-order `id`-vs-`created_at` fixture).
- `server/__tests__/focus-report.test.js` — new `>65,536`-interval
  stack-overflow regression test (covers the already-shipped `60af828` fix,
  currently untested).
- `server/__tests__/settings-export.test.js` (new) — functional test for
  `60af828`'s bundled, off-surface settings-export streaming rewrite.

**Database / migration**
- None. No schema change in any part of this plan (the `created_at` sort
  fix uses an already-existing index, `idx_events_created`).

**Tests changed in this set**
- None yet — all six test-backfill items above are *planned*, none exist
  on disk yet (confirmed: `useHourWindowZoom.test.ts`,
  `ConcurrencyStatTile.test.tsx`, `settings-export.test.js` do not exist;
  `focus-inference.test.js` and `focus-report.test.js` exist but not yet
  extended with these specific assertions).

**Config / other**
- `PROJECT-CONTEXT.md` — add a new `## Recurring defect-class patterns`
  section (two entries: `DERIVED-DUAL-VIEW`, `row-id-as-chronology-proxy`).
  Confirmed current file only has `## Repo topology` — this section is not
  yet present.
- `intake/2026-07-31-focus-untracked-commits/decisions.md` (new, not yet
  written) — DEC-7 (`/focus` is an intentional second route, not scope
  drift) and DEC-8 (AI summary model-cost tradeoff accepted).

## Surfaces / features touched

- **Focus Calendar board** (`FocusCalendarView.tsx`, `FocusCalendarBoard.tsx`,
  `FocusReportBody.tsx`, `FocusReportModal.tsx`) — hour-window zoom render
  cascade fix.
- **`/focus` stakeholder page** (`FocusPage.tsx`) — second consumer of the
  same `FocusReport` shape and the same `useHourWindowZoom` hook; the
  cross-view parity test (test-backfill item 1) targets exactly this pairing.
- **`server/lib/focus-inference.js`'s `buildActivityDigest()`** — feeds both
  the heuristic/LLM session classifier (`inferSession`) and the AI
  window-summary feature (`focus-summary.js`, `b930824`) — a chronology bug
  here silently corrupts input to two independent downstream consumers.
- **`server/lib/focus-report.js`'s interval-building path** (`60af828`'s
  loop-push fix) — currently shipped but untested at scale (>65,536
  intervals).
- **`/api/settings/export`** (`server/routes/settings.js`,
  `server/lib/data-transfer.js`) — bundled, off-surface streaming rewrite,
  also currently untested.

## Variant relevance

Yes — this is exactly the project's named recurring pattern
(`DERIVED-DUAL-VIEW`, being formally catalogued by this plan): the
`FocusReport` shape is now rendered by **4 independent consumers**
(`FocusReportBody`, `FocusCalendarView`, `FocusCalendarBoard`, `FocusPage`).
The plan's own diagnosis: the *code* held the extraction discipline (no
hand-copied formulas found), but *test scope* was per-field, not
per-consumer, which is exactly how the newest consumer (`FocusPage.tsx`,
`31927e2`) shipped without parity coverage against the pre-existing
`FocusReportModal`/`FocusReportBody` rendering. Test-backfill item 1 exists
specifically to close this gap. Any test plan built from this brief should
treat "does `FocusPage` agree with `FocusReportModal`/`FocusCalendarBoard`
on the same field, same fixture" as a first-class assertion, not an
afterthought.

## Test-invariants at risk

Project has no prior formally-catalogued defect registry in
`PROJECT-CONTEXT.md` (this plan is what adds the first two entries — not
yet applied as of this brief). Citing the plan's own soon-to-be-catalogued
IDs:

- [x] **Cross-path consistency — `DERIVED-DUAL-VIEW` (§9.1, pending
  catalogue add)** — Directly at risk. 4 rendering consumers of the same
  `FocusReport`/windowed-totals shape; only 2 of the 3 newer ones
  (`FocusCalendarView`+`FocusPage` via `useHourWindowZoom`) currently share
  code, and no test yet asserts `FocusPage` and
  `FocusReportModal`/`FocusCalendarBoard` produce identical numbers from the
  same fixture. This is the plan's #1 priority test-backfill item.
- [x] **Round-trip / chronology integrity — `row-id-as-chronology-proxy`
  (§9.2, pending catalogue add)** — Directly at risk, 3rd confirmed instance
  of this exact bug shape on this codebase (`6e9a443`, `b3a2cc9`, and now
  `focus-inference.js`'s `buildActivityDigest()`). Confirmed still live on
  current `master` (spot-checked: `focus-inference.js:123` still reads
  `ORDER BY id ASC LIMIT ?`). Worse than the prior two instances because the
  `LIMIT` is applied at the SQL level ordered by `id` — an out-of-order bulk
  insert can silently select the *wrong subset* of 800 events, not just
  present a correct subset in the wrong order; a JS-level post-sort (the
  `b3a2cc9` fix pattern) would not fully repair that here.
- [x] **Render stability / no-runaway-effect-loop (general invariant, not
  yet named in the catalogue)** — Directly at risk. Confirmed still live on
  current `master` (spot-checked: `useHourWindowZoom.ts:129-134` still uses
  the `forceRefresh` bump-counter, recomputing `windowStartMs`/`windowEndMs`
  from raw `Date.now()` on every render in live-zoom mode, not just on the
  intended 60s tick). Currently silent in CI — the "Maximum update depth
  exceeded" warning goes to stderr without failing any assertion. A test
  plan should assert on stderr/console output, not just pass/fail, per the
  technical plan's own Definition-of-Done note.
- [ ] **No unresolved-boundary-token leak** — Not implicated by this change
  set; no template/placeholder rendering pathway touched.

## Tests already changed in this set

None. This is a retroactive plan describing intended work; per the file
"Tests changed in this set" listed above, all 6 test-backfill files are
still to be written (spot-checked absent from disk: `useHourWindowZoom.test.ts`,
`ConcurrencyStatTile.test.tsx`, `settings-export.test.js`).

## Stated intent / acceptance

From `technical-plan.md` §11 (Definition of Done):
- §4.1 fix applied; "Maximum update depth exceeded" warning no longer
  reproduces when running the `FocusReportModal.test.tsx` suite — **confirm
  by capturing stderr, not just assertion pass/fail.**
- §4.2 fix applied to `buildActivityDigest`'s query.
- All 6 new/extended tests in §7 written and green, run individually and as
  part of their full suite.
- `npm run test:server` green in full (baseline: 1047/1047 pass, must stay
  1047+N/1047+N).
- `cd client && npx vitest run` green in full (baseline: 645/645 pass, must
  stay 645+N/645+N).
- `bash .claude/skills/file-headers/scripts/check-headers.sh` passes.
- `decisions.md` written with DEC-7 and DEC-8.
- `PROJECT-CONTEXT.md` updated with the `## Recurring defect-class patterns`
  section, both entries.
- Explicitly stated: **no snapshot-baseline regeneration expected** — neither
  fix changes rendered output, only timing; if a snapshot diff appears
  anyway, that's a signal to re-check the fix, not to blind-accept per this
  repo's testing policy.
- Explicitly out of scope for new design: this is "not a build
  authorization" for the six paperwork items to expand further, and if
  either fix is found mid-implementation to need real redesign, the plan
  says to stop and split it into a separate intake folder rather than
  absorb scope here.

## Open questions

**Blocking (cannot plan tests):**
- None.

**Non-blocking (proceeding on assumption):**
- The working tree currently has *unrelated* uncommitted changes
  (`server/db.js`, `server/routes/run.js` modified; `capture-claude-usage.sh`,
  `server/lib/origin-guard.js`, `intake/.status-scratch/`,
  `intake/status-report.md` untracked) that are not part of this intake's
  change set and were not touched by the seven historical commits or this
  plan's forward work. → Assumption: these belong to separate, concurrent
  work (possibly another session/effort) and should be left alone by any
  test plan built from this brief; do not attribute their diffs to this
  change set, and do not run destructive git operations that would touch
  them.
- `technical-plan.md` frames the seven historical commits as fully verified
  sound (server suite 1047/1047, client suite 645/645 green at time of
  review) except for the two named live bugs. → Assumption: QA planning
  should treat the *shipped* behavior of `0416066`..`60af828` (minus the two
  named bugs) as a trusted baseline, not itself a target for exploratory
  re-verification — the two named fixes and six backfill tests are the
  actual surface to plan coverage for.
- `.env.example`'s new AI-summary env vars — `request-brief.md` flags doc
  coverage as an open, non-blocking question for a later stage ("does the
  new `.env.example` AI-summary configuration need documentation"), and
  `technical-plan.md` §3's table marks this "closed, no action needed"
  (README.md:640, ARCHITECTURE.md:384 already confirmed complete). →
  Assumption: treat as resolved per the technical plan's own re-verification;
  not a QA test-planning gap.

## Verdict
**READY**
