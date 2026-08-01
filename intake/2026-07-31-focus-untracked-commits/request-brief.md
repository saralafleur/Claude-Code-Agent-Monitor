# Request Brief: Retroactive Documentation of Untracked Focus-Surface Commits

## Raw ask (verbatim)

Not a live human request — this intake was opened by the `team-intake`
skill acting on Sara's explicit gate choice, per the source doc:

> "A `team-status` run over `intake/` (2026-07-31) verified two catalogued
> items... In the course of re-verifying those items' claims against live
> `master`, the `focus-calendar-board` scanner flagged that `master` had
> continued to accumulate commits on the exact same "focus" surface...
> after both those items merged, with no corresponding
> `intake/<date>-<slug>/` folder for any of them."

> "Sara reviewed that finding and chose (option **A** of the status
> report's gate) to run `team-intake` on it so the pipeline has a record
> of what actually shipped, rather than ruling it out-of-pipeline or
> leaving it undocumented."

The framed job for the pipeline, per the source doc:

> "`team-intake`'s job here is retroactive: produce the
> `technical-plan.md` / `pm-plan.md` pair a normal request would have
> gotten *before* the work started, so the pipeline has a record of what
> shipped, why, and what (if anything) still needs cleanup or follow-up."

## Restated ask

Seven already-merged commits (`0416066`..`60af828`, 2026-07-26 through
2026-07-30) shipped real, working feature and fix work on the focus-report
surface with no intake folder behind them. We need the team to retroactively
produce the normal planning artifacts (`technical-plan.md`, `pm-plan.md`,
and downstream QA as applicable) documenting what was actually built and
why, verify the shipped work is sound, and surface any genuine follow-up —
not to design or build anything new.

## Requester / source

No external requester. Origin is the `team-status` delivery-pipeline
reconciler run on 2026-07-31, escalated to `team-intake` by Sara's own gate
decision (option A: "document retroactively"). Source material:
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-07-31-focus-untracked-commits/request-source.md`.

## Surface / area touched

The focus-report / Focus Calendar / Focus page surface, specifically:

- `server/lib/focus-report.js` — active/idle gap-sum sort fix (`b3a2cc9`),
  stack-overflow fix in interval building (`60af828`).
- `client/src/components/FocusCalendarView.tsx`,
  `FocusReportBody.tsx`, `FocusReportModal.tsx`, `PlanModal.tsx`,
  `SessionCard.tsx`, `TimePeriodPicker.tsx`, `StatTile.tsx` — windowed
  stat totals, board polish, route fidelity fixes.
- `client/src/components/FocusActivityCard.tsx` (new),
  `ProjectScopeFilters.tsx` (new) — stakeholder-readable Focus page and
  plan-less/AI-generated activity summaries with hierarchical multi-day
  rollups.
- `client/src/components/HourWindowZoomBar.tsx` (new),
  `client/src/hooks/useHourWindowZoom.ts` (new) — hour-window zoom control
  for the Focus Calendar.
- `client/src/components/ConcurrencyStatTile.tsx` (new).
- `client/src/pages/FocusPage.tsx` (new) — new stakeholder-facing `/focus`
  route, wired into `App.tsx` and `Sidebar.tsx` nav.
- `.env.example` — new AI-summary-related env vars (undocumented — see
  follow-ups).
- Bundled, off-surface: `server/lib/data-transfer.js`,
  `server/routes/settings.js` — settings data-export streaming, shipped in
  the same commit (`60af828`) as the stack-overflow fix.

Verified against `git log`: all seven SHAs, authors, dates, and subject
lines match `master` exactly (checked via `git show -s --format=...` for
each of the seven commits listed below).

## Known-variant relevance

No `PROJECT-CONTEXT.md` domain-conventions section names a formally
catalogued defect-class pattern yet — the current `PROJECT-CONTEXT.md`
(confirmed 2026-07-31, present at repo root) only documents repo topology,
not recurring-defect surfaces. However, this is directly on-point for the
project's most-flagged recurring hazard regardless: two prior catalogued
items on this exact surface
(`intake/2026-07-26-focus-calendar-board/`,
`intake/2026-07-26-focus-report-fidelity/`) each independently flagged, in
their own QA/build reports, a "DERIVED-DUAL-VIEW" risk — a derived/summary
number (e.g. `wall_ms`) computed once and reused uncritically across
multiple rendering surfaces, where a fix applied to one consumer doesn't
retroactively fix the others (confirmed via `grep -rl "DERIVED-DUAL-VIEW"
intake/`, which returns hits in both prior items' `qa/` and `build/`
artifacts). This batch of seven commits is that exact pattern happening
again, live on `master`, outside the pipeline's visibility — which is the
reason `team-status` flagged it at all. The PM should decide whether this
occurrence is enough to promote DERIVED-DUAL-VIEW from "flagged twice in
passing" to a formally catalogued pattern in `PROJECT-CONTEXT.md`.

## Provisional request type

`missed-requirement` (PROVISIONAL — PM makes the final call), in the
specific retroactive sense: the "requirement" that was missed was
*process*, not product — this work should have gone through
`team-intake`/`team-plan` before merging, and didn't. The product changes
themselves span `new-feature` (Focus page, hour-window zoom, AI summaries),
`bug`/regression-fix (`b3a2cc9` gap-sum sort order, `60af828` stack
overflow), and incidental unrelated work (`60af828`'s settings-export
streaming). The PM should decide whether to split this into multiple
downstream plan entries (one per logical change) or document it as one
retroactive batch — the source doc frames it as one batch, and nothing in
the material argues against that framing given all seven commits are
already merged and interdependent (later commits touch files the earlier
ones introduced).

## Attachments / evidence

- `request-source.md` itself is the full evidentiary record: seven commit
  SHAs, subjects, dates, author, and per-commit file-touch lists.
- Independently re-verified in this intake pass via
  `git show -s --format='%H %an %ad %s' --date=short <sha>` for all seven
  SHAs — every hash, author, date, and subject line matches the source
  doc exactly. No discrepancy found.
- No screenshots or external ticket attachments (none expected — this is a
  git-history reconciliation, not a user-submitted request).

## Explicit acceptance signals

No "done when..." from a requester, since there is no live requester. The
closest proxy is the source doc's own framing of what the retroactive plan
must produce:

> "produce the `technical-plan.md` / `pm-plan.md` pair a normal request
> would have gotten *before* the work started, so the pipeline has a
> record of what shipped, why, and what (if anything) still needs cleanup
> or follow-up (e.g. whether `team-qa` should retroactively write
> regression coverage for anything under-tested, whether the
> `.env.example` AI-summary config needs documentation, and whether this
> confirms "DERIVED-DUAL-VIEW" should become a formally catalogued defect-
> class pattern in `PROJECT-CONTEXT.md`)."

This intake is "done" when `request-brief.md` gives the PM/tech-plan stages
enough verified, unambiguous material to write those artifacts without
needing to re-derive the commit list themselves.

## Open questions

### BLOCKING

None. Every fact needed to proceed (which commits, what they touched, why
they were flagged, what "done" means for this retroactive pass) is either
stated directly in `request-source.md` or independently verifiable via
`git log`/`git show` against `master` — which this pass did. There is no
live requester to ask a clarifying question of, and none of the downstream
work depends on a judgment call only Sara could make; her gate choice
(option A, "document retroactively") already resolved the one decision that
was hers to make.

### Non-blocking (proceed with stated assumption)

1. **Should the seven commits be treated as one retroactive plan entry, or
   split by logical change (new-feature work vs. the two bug fixes vs. the
   bundled settings-export streaming)?**
   Assumption: document as one batch under this intake slug, since the
   source doc frames it that way and the commits are chronologically and
   technically interdependent (e.g. `FocusPage.tsx` in `ed23878` depends on
   nav wiring from `31927e2`). The PM can still call out each logical
   sub-change distinctly inside a single `pm-plan.md`/`technical-plan.md`
   pair rather than opening separate intake folders.

2. **Does `60af828`'s unrelated settings-export streaming work
   (`server/lib/data-transfer.js`, `server/routes/settings.js`) belong in
   this brief at all, since it's off the focus-report surface?**
   Assumption: mention it (done above, under Surface/area touched) for
   completeness since it shipped in the same commit as an in-scope fix, but
   the PM should feel free to scope it out of the focus-surface plan
   entirely and note it as a separate minor process gap (bundling unrelated
   work into one commit) rather than pull it into this plan's design work.

3. **Is retroactive regression-test coverage needed for any of the seven
   commits, and if so which ones?**
   Assumption: worth a real look — `b3a2cc9` (gap-sum sort fix) already
   added `server/__tests__/focus-report.test.js` coverage per the source
   doc, but the newer client surfaces (`FocusPage.tsx`,
   `HourWindowZoomBar.tsx`, `useHourWindowZoom.ts`, `FocusActivityCard.tsx`
   AI summaries) are not confirmed tested anywhere in the source material.
   Non-blocking because it's a `team-qa`-stage investigation, not something
   this brief needs to resolve.

4. **Does the new `.env.example` AI-summary configuration need
   documentation** (README/ARCHITECTURE, per this repo's own
   `docs-markdown` rule to keep docs aligned with behavior)?
   Assumption: likely yes, flag for the technical-plan stage to confirm
   against current README/ARCHITECTURE state rather than resolving here.

5. **Should DERIVED-DUAL-VIEW be formally catalogued in
   `PROJECT-CONTEXT.md`?**
   Assumption: this is a PM-level pattern-recognition call, not something
   for intake to decide — flagged above under Known-variant relevance for
   the PM to pick up.
