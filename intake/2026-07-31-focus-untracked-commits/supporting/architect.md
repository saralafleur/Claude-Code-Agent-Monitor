# Architect Assessment — retroactive review of the 2026-07-26..30 focus-surface commits (0416066..60af828)

Scope note: this is a retroactive design review of already-shipped, already-merged
code. The question is not "should we build this" but "does what shipped hold
together architecturally, does it follow this project's established patterns, and
does it confirm or refute the DERIVED-DUAL-VIEW risk the two prior sibling intakes
(`2026-07-26-focus-calendar-board`, `2026-07-26-focus-report-fidelity`) flagged."

## 1. Affected subsystems & boundaries

- **Server aggregation layer** — `server/lib/focus-report.js` (segment-replay +
  idle-grace math; owns `buildProjectFocusReport`, `buildSessionFocusReport`,
  `activeIdleMs`, `mergeIntervals`, `addToTotals`, `buildActivityChunks`,
  `inferredSegment`/`noFocusSegment`). This is the one and only place raw hook
  event timestamps get turned into `wall_ms`/`active_ms`/`idle_ms`/`chunks`. It
  owns the behavior that `b3a2cc9` and `60af828` fixed (out-of-order timestamp
  sort before the gap-sum walk; loop-push instead of `push(...intervals)` spread
  to avoid the V8 argument-count stack overflow).
- **Server synthesis layer (new)** — `server/lib/focus-summary.js` +
  `server/routes/focus-report.js`'s `GET /api/focus-report/summary` and
  `/summary/config`. This is a *new* subsystem: it consumes `buildProjectFocusReport`'s
  output (never recomputes it) and produces stakeholder-readable prose via the
  existing hermetic `claude -p` spawn contract exported by `server/lib/focus-inference.js`
  (`runClaudePromptJson`) — the same one `focus-audit.js`/`focus-inference.js`
  already use. It owns its own cache table (`focus_summaries`) and access log
  (`focus_summary_access_log`), and a `resolveWindowSessions` helper shared
  between the report route and the summary route so both always agree on which
  sessions a window contains.
- **Client presentation layer** — three consumers now render the same
  `FocusReport` shape: `FocusReportModal.tsx` (per-project modal, List/Calendar
  toggle), `FocusCalendarBoard.tsx` (`/focus-calendar`, cross-project board), and
  the new `FocusPage.tsx` (`/focus`, stakeholder list view). All three sit on top
  of `FocusReportBody.tsx` (shared List rendering + stat tiles) and/or
  `FocusCalendarView.tsx` (shared Calendar rendering), not independent
  reimplementations.
- **Client shared-derivation layer (new files this batch introduced)** —
  `client/src/lib/windowedTotals.ts` (`computeWindowedTotals`, `clipSegment`),
  `client/src/lib/focusActivity.ts` (`groupFocusActivity`),
  `client/src/hooks/useHourWindowZoom.ts` + `client/src/components/HourWindowZoomBar.tsx`
  (state/UI for the hour-window zoom, extracted out of `FocusCalendarView.tsx`),
  `client/src/components/StatTile.tsx` + `ConcurrencyStatTile.tsx` (extracted out
  of `FocusReportBody.tsx`), `client/src/components/ProjectScopeFilters.tsx`
  (extracted out of `FocusCalendarBoard.tsx`), `client/src/components/FocusActivityCard.tsx`
  (new consumer of `groupFocusActivity`).
- **i18n** — `client/src/i18n/locales/{en,ko,vi,zh}/{plan,kanban,nav}.json`, updated
  in lockstep across all four locales in every commit that added user-facing copy
  (verified: no commit in this batch touches only `en`).
- **Config surface (new)** — `.env.example` gained `DASHBOARD_FOCUS_SUMMARY_MODEL`
  (b930824), documented inline with a comment block matching the existing
  `DASHBOARD_FOCUS_INFER_*`/`DASHBOARD_FOCUS_AUDIT_*` var style.
- **Off-surface, bundled in `60af828`** — `server/lib/data-transfer.js` /
  `server/routes/settings.js` (settings export streaming). This does not share
  any module, table, or code path with the focus-report surface; it landed in the
  same commit purely by timing, not by design coupling. Architecturally
  irrelevant to the focus-report boundary question, but worth flagging as a
  process smell (unrelated concerns in one commit make `git bisect`/revert
  harder if either half needs to be reverted independently).

## 2. Current design — and whether it follows this project's established pattern

**ARCHITECTURE.md already documents this entire batch in detail** (the "Plan-Aware
Monitoring" section, ~370 lines, `client/src/pages/FocusPage.tsx` through the end
of that section) — the doc-update requirement in each commit was genuinely honored,
not just checked off. This matters directly for one of the brief's open questions
(#4, whether `.env.example`'s new AI-summary config needs documentation): it
already is documented, both in `.env.example` itself (inline comments) and in
`ARCHITECTURE.md`'s `server/lib/focus-summary.js` row and the "Model for the Focus
page's..." `.env.example` excerpt. No doc gap found for this batch.

The project's established pattern for "content that must render identically
across variants" here is **compute once server-side in `focus-report.js`, extract
shared client helpers rather than let each new consumer reimplement, and log the
reasoning for any place where duplication looks necessary.** This batch follows
that pattern consistently and, in several places, *strengthens* it:

- `HourWindowZoomBar`/`useHourWindowZoom` were extracted "verbatim" out of
  `FocusCalendarView.tsx` so `FocusPage` gets the identical zoom control instead
  of a second implementation — `FocusCalendarView` now calls the same
  hook/component itself.
- `StatTile`/`ConcurrencyStatTile` were extracted out of `FocusReportBody.tsx`
  so `FocusPage`'s tiles are the same component, not a lookalike.
- `ProjectScopeFilters` was extracted out of `FocusCalendarBoard.tsx` for the
  same reason.
- `resolveWindowSessions` is shared by both the report and summary routes so
  they can never disagree on which sessions a window contains.
- The window summary's LLM call reuses `focus-inference.js`'s existing
  `runClaudePromptJson` hermetic spawn contract rather than opening a second,
  slightly different spawn path or a new external HTTP API. **There is no new
  external dependency or API surface here** — it's the same local `claude -p`
  CLI invocation pattern already in production for focus-audit/focus-inference,
  gated by the same env-var family, with its own cache + digest-based
  invalidation to bound repeated LLM calls.

The one deliberate, *documented* exception is `client/src/lib/windowedTotals.ts`.
Its file header explicitly names the DERIVED-DUAL-VIEW-shaped risk it is
introducing and explains why: `computeWindowedTotals`/`clipSegment` mirror two
small pieces of `focus-report.js`'s aggregation (`addToTotals`, `mergeIntervals`)
client-side, because the server's grace-window `active_ms` math needs raw
per-session event timestamps a `FocusReport` never sends to the client, and a
literal re-fetch on every zoom-drag tick was rejected as a UX cost. The mitigation
actually applied is real, not just a comment: it doesn't re-derive from raw
events, it re-slices the exact same 10-minute `chunks` grid the Calendar's idle
stripes already render from (`idleStripes.ts`), so the client-side number and the
client-side pixels a user is looking at are sourced from the same array — they
cannot silently disagree with what's on screen, only (in principle) with the
server's own more-precise number, and that gap is bounded by chunk granularity
(≤10 min), not unbounded drift.

## 3. Options (for the DERIVED-DUAL-VIEW question specifically)

The brief asks the PM to decide whether to formally catalogue DERIVED-DUAL-VIEW in
`PROJECT-CONTEXT.md`. From the architecture side, the relevant question is
narrower: **does this batch's shipped code reintroduce the failure mode (a value
computed once, consumed by ≥2 surfaces, with no shared helper and no test
enforcing agreement) — or does it demonstrate the safeguard already generalizing
correctly to a third/fourth consumer?** Evidence strongly favors the latter (see
§2), but three options exist for what to do about it going forward:

**Option A — No new safeguard; treat this batch as evidence the informal
discipline (extract-and-share, document intentional exceptions) is working.**
Trade-off: cheap, but relies on every future contributor independently
rediscovering the pattern from reading `windowedTotals.ts`'s file header rather
than a checked rule. Given this surface has now grown to 4 rendering consumers
(modal List, modal Calendar, board, FocusPage) and keeps growing, "read the
comments" scales worse each time.

**Option B — Catalogue DERIVED-DUAL-VIEW as a named pattern in
`PROJECT-CONTEXT.md`, with the concrete acceptance criterion QA already
articulated in the prior sibling item's `risk.md` (§2): "same field, same value,
across every consumer — checked by a cross-view/cross-page test, not eyeballing."
No code changes required; this is a documentation/process safeguard.
Trade-off: doesn't strengthen the code itself, but converts tribal
knowledge (currently living in two intake folders and a handful of file-header
comments) into something the PM/QA/architect stages can point to on every future
touch of this surface, and gives a name to grep for (as this very intake did:
`grep -rl "DERIVED-DUAL-VIEW" intake/`).

**Option C — B, plus a lightweight structural guard: a single shared test (or
test helper) that asserts every rendering surface reading a given `FocusReport`
field agrees, parameterized over consumers, so a future 5th consumer is caught
by CI rather than code review.** `FocusPage.test.tsx` already has the shape of
this per-page (`"renders stat tiles matching FocusReportBody's on-item/off-plan
formula"`), but there is no single cross-page test that would fail if, say, the
Calendar board's Concurrency tile and FocusPage's Concurrency tile ever computed
their ratios differently — they currently don't, because both call the same
`ConcurrencyStatTile`, but nothing *enforces* that they must keep doing so if a
future edit gives one of them a bespoke prop.
Trade-off: real regression-test investment (a `team-qa` stage task, not a docs
change), but this is exactly the class of thing risk.md already predicted would
be needed permanently, not just for round 4.

## 4. Architectural risks

- **Untested new client modules.** `useHourWindowZoom.ts`, `HourWindowZoomBar.tsx`,
  `ConcurrencyStatTile.tsx`, `ProjectScopeFilters.tsx`, and `StatTile.tsx` have no
  dedicated unit test file of their own (verified via `grep -rl` across
  `client/src/**/__tests__`) — they are only exercised indirectly through
  `FocusPage.test.tsx` and `FocusReportModal.test.tsx`. Given these are now
  shared across 3-4 rendering surfaces, a regression in one of them is exactly
  the kind of failure that could silently affect every consumer at once (the
  blast-radius shape `risk.md` §1 already called out for `idleStripes.ts`).
  This is a `team-qa` follow-up, not a design flaw, but worth flagging since the
  brief's non-blocking question #3 raises the same concern.
- **`windowedTotals.ts`'s intentional server/client duplication is bounded, not
  eliminated.** The chunk grid it sums is 10-minute granularity
  (`CHUNK_MS`), so a client-computed windowed total can differ from what the
  server would compute for the exact same window by up to one chunk's worth of
  active/idle misclassification at the window boundary. This is a known,
  accepted trade-off (documented in the file header) rather than an oversight,
  but there is no test pinning "client windowed total vs. server windowed total
  for the same window, difference bounded by one chunk" — that would be the
  concrete regression test this file's own reasoning implies should exist.
- **`focus_summaries` cache correctness depends on the input-digest gate.**
  `focus-summary.js`'s caching (direct path digest = raw report slice; hierarchical
  path digest = per-day summary contents) is the mechanism preventing stale
  AI-generated prose from being served after underlying focus data changes. This
  is new, moderately complex logic (two paths splitting at 2 local calendar days,
  degrading per-day failures to raw fact lines) that a stack-overflow-class bug
  (cf. `60af828`) could silently poison — a wrong digest computation would either
  regenerate every request (cost/latency risk) or serve stale summaries
  indefinitely (correctness risk, silent). Worth a `team-qa` look specifically at
  digest-mismatch behavior, not just the happy path.
- **Trust boundary: LLM output is user-facing prose, not executed or parsed as
  code/config**, and is gated to `{ summary: null }` + 200 on any failure
  (unavailable CLI, parse failure, empty window) rather than propagating an
  error — consistent with the existing `focus-audit`/`focus-inference` fail-open
  posture (`CLAUDE.md`'s "hooks must be fail-safe and non-blocking" principle
  extended correctly to this new synthesis layer). No new trust boundary risk
  identified beyond what `focus-inference.js` already carries.
- **Unrelated commit bundling (`60af828`).** Bundling the settings-export
  streaming fix with the focus-report stack-overflow fix in one commit is a
  process risk, not an architectural one: if either fix needs an isolated
  revert, `git revert 60af828` takes both. No shared code path exists between
  them, so this is purely a hygiene/traceability concern, already flagged by the
  brief as the PM's call to scope out.

## 5. Recommended approach

**Option C** (catalogue DERIVED-DUAL-VIEW in `PROJECT-CONTEXT.md` per Option B,
*and* have `team-qa` add the cross-consumer structural test Option C describes).
Reasoning:

- This batch is strong *evidence for*, not *against*, the informal
  extract-and-share discipline the two prior sibling items established — it is
  not a regression of DERIVED-DUAL-VIEW, and the record should say so plainly
  rather than treat this batch as a third strike. The PM should not read this
  intake as "the risk fired again."
- But the surface has now grown from 2 consumers (List/Calendar) to 4
  (List/Calendar/Board/FocusPage) in five days, entirely by extraction rather
  than duplication — which is the right shape, but it also means the *cost* of
  a future contributor not extracting (copy-pasting instead) has gone up, not
  down, since there are now more places for a copy to diverge from. Naming the
  pattern in `PROJECT-CONTEXT.md` costs nothing and gives every future
  `architect`/`qa` pass on this surface a one-line pointer instead of needing to
  rediscover it from two intake folders' `risk.md` files.
  A minimal `PROJECT-CONTEXT.md` addition (not authored here — PM's call per
  the brief) should record: the pattern name, the acceptance test shape ("same
  field, same value, across every consumer of a given `FocusReport`"), and a
  pointer to `windowedTotals.ts`'s file header as the canonical example of how
  to *document* an unavoidable exception rather than silently accept drift.
- Given `windowedTotals.ts` is the one place this batch chose duplication over
  extraction (for a defensible reason), it is the single highest-value target
  for the Option C structural test — a bounded-difference assertion between
  `computeWindowedTotals`'s output and the server's own windowed
  `buildProjectFocusReport` output for an equivalent window, so a future change
  to either side's aggregation math is caught by CI rather than eyeballing two
  numbers in two different UIs.

## Verification performed

- `npm run test:server` run in full during this review: 1047 passing, 0
  failing, 0 skipped — confirms the shipped server-side focus-report code
  (including the `b3a2cc9` sort fix and `60af828` stack-overflow fix) is
  currently green, not just green-at-merge-time.
- `bash .claude/skills/file-headers/scripts/check-headers.sh` — all applicable
  files in this batch carry the required authorship header.
- Confirmed via `grep` that no commit in this batch touches only one locale
  file when adding user-facing copy (en/ko/vi/zh all move together).
- Did not run `npm run test:client` in this pass (server-focused verification;
  client test execution and coverage-gap confirmation is a `team-qa` stage
  activity per the brief's own framing of open question #3).
