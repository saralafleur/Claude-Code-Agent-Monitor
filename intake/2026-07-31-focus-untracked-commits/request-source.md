# Request source: retroactive documentation of untracked "focus" surface commits

**Origin:** Not an external ticket, and not a forward-looking feature ask —
this is a retroactive intake, opened because `team-status` (the delivery-
pipeline reconciler) found real, already-merged, already-shipped work on
`master` with no intake folder behind it. Sara reviewed that finding and
chose (option **A** of the status report's gate) to run `team-intake` on it
so the pipeline has a record of what actually shipped, rather than ruling it
out-of-pipeline or leaving it undocumented.

## What triggered this

A `team-status` run over `intake/` (2026-07-31) verified two catalogued
items (`2026-07-26-focus-calendar-board`, `2026-07-26-focus-report-fidelity`)
as fully built, tested, and merged. In the course of re-verifying those
items' claims against live `master`, the `focus-calendar-board` scanner
flagged that `master` had continued to accumulate commits on the exact same
"focus" surface (`server/lib/focus-report.js`, the Focus Calendar/Focus page
client components) **after** both those items merged, with no corresponding
`intake/<date>-<slug>/` folder for any of them. This is the same
"DERIVED-DUAL-VIEW" multi-view-drift risk both catalogued items' own reports
had already flagged as a recurring hazard on this surface — now observed
happening for real, outside the pipeline.

## The commits in question

Seven commits on `master`, all authored by Sara LaFleur, 2026-07-26 through
2026-07-30, all touching the focus-report surface:

1. **`0416066`** (2026-07-26) — `feat(focus-report): add windowed stat
   totals for calendar zoom, track delivery-pipeline docs`
   Touches: `client/src/components/FocusCalendarView.tsx` (+796/-),
   `FocusReportBody.tsx`, `FocusReportModal.tsx`, `PlanModal.tsx`,
   `SessionCard.tsx`, plan i18n locales (en/ko/vi), plus doc updates
   (ARCHITECTURE.md, READMEs, client/README.md, .gitignore).

2. **`31927e2`** (2026-07-27) — `feat(focus-report): add stakeholder-
   readable Focus page and plan-less activity summaries`
   Adds: `client/src/components/FocusActivityCard.tsx` (new),
   `ProjectScopeFilters.tsx` (new), `StatTile.tsx` (new). Touches:
   `FocusCalendarView.tsx` (+379), `FocusReportBody.tsx`, `App.tsx`
   (new route wiring), `Sidebar.tsx` (new nav entry), i18n
   (`nav.json`), plus doc updates.

3. **`b3a2cc9`** (2026-07-27) — `fix(focus-report): sort event
   timestamps before the active/idle gap-sum walk`
   Touches: `server/lib/focus-report.js`, adds
   `server/__tests__/focus-report.test.js` coverage, plus wiki/doc sync.

4. **`ed23878`** (2026-07-27) — `feat(focus-report): add hour-window
   zoom control to the Focus Calendar`
   Adds: `client/src/components/HourWindowZoomBar.tsx` (new),
   `client/src/hooks/useHourWindowZoom.ts` (new). Touches:
   `FocusCalendarView.tsx` (net -/+ large rewrite), `focusActivity.ts`,
   `windowedTotals.ts`, `client/src/pages/FocusPage.tsx` (the new
   stakeholder-facing `/focus` route page), kanban i18n locales
   (en/ko/vi/zh), plus doc updates.

5. **`b930824`** (2026-07-28) — `feat(focus-report): AI window
   summaries with hierarchical multi-day rollups`
   Touches: `FocusActivityCard.tsx`, `TimePeriodPicker.tsx`,
   `.env.example` (new AI-summary-related env vars), plan/kanban i18n
   locales (en/ko/vi/zh), plus doc updates.

6. **`0d5fbe7`** (2026-07-28) — `feat(focus-report): Focus Calendar
   board polish + focus-report route fidelity fixes`
   Adds: `client/src/components/ConcurrencyStatTile.tsx` (new).
   Touches: `FocusReportBody.tsx`, `StatTile.tsx`, `TimePeriodPicker.tsx`,
   `client/src/lib/api.ts`, plan i18n locales (en/ko/vi/zh), plus doc
   updates.

7. **`60af828`** (2026-07-30) — `Stream the settings data export and
   fix a stack-overflow in focus-report interval building`
   Touches: `server/lib/focus-report.js` (the stack-overflow fix),
   `server/lib/data-transfer.js`, `server/routes/settings.js` (unrelated
   settings-export streaming work bundled into the same commit).

**Net effect on the product, in plain terms:** a new stakeholder-facing
`/focus` page was added (`FocusPage.tsx`, reachable via a new Sidebar nav
entry), with an hour-window zoom control for the Focus Calendar
(`HourWindowZoomBar.tsx` + `useHourWindowZoom.ts`), AI-generated window
activity summaries with multi-day rollups (`FocusActivityCard.tsx` +
`.env.example` additions), plus a correctness fix in the server-side
active/idle gap-sum computation (`focus-report.js`) and an unrelated
stack-overflow fix bundled into the last commit.

## Why this needs a plan rather than just being logged

This is genuinely already-shipped, merged, working code — not a request to
build something new. But `team-intake`'s job here is retroactive: produce
the `technical-plan.md` / `pm-plan.md` pair a normal request would have
gotten *before* the work started, so the pipeline has a record of what
shipped, why, and what (if anything) still needs cleanup or follow-up
(e.g. whether `team-qa` should retroactively write regression coverage for
anything under-tested, whether the `.env.example` AI-summary config needs
documentation, and whether this confirms "DERIVED-DUAL-VIEW" should become
a formally catalogued defect-class pattern in `PROJECT-CONTEXT.md`).
