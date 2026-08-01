# Risk & Regression Analysis — 2026-07-31-focus-untracked-commits

> Author: `qa-risk-analyst`. Scope: the two live-bug fixes forward work
> authorizes (`useHourWindowZoom.ts` render cascade, `focus-inference.js`
> chronology bug), read against current `master` code, not just the plan
> narrative. Corrections to the plan's own claims are called out explicitly
> where inspection of the actual consumer graph disagreed with it.

## 0. Defect-catalog status (read first, per project instructions)

`PROJECT-CONTEXT.md` currently has **no** `## Recurring defect-class
patterns` section — confirmed by direct read, only `## Repo topology`
exists. `technical-plan.md` §9 is the document that *proposes* adding the
first two entries (`DERIVED-DUAL-VIEW` §9.1, `row-id-as-chronology-proxy`
§9.2) as part of this same change-set's paperwork half. This is unusual for
a risk pass: the catalog doesn't exist yet, but its proposed text is
detailed, cites specific prior commits, and independently checks out against
`git log` (`b3a2cc9`, `6e9a443` are both real, present commits). I am
treating the proposed §9.1/§9.2 text as the operative catalog for this
report — it is being formally added by the same change-set this report
evaluates — and citing its IDs throughout. If this plan's doc-only items
(§9) are dropped or altered before landing, this report's catalog citations
should be re-verified against whatever text actually lands in
`PROJECT-CONTEXT.md`.

## 1. Blast radius

### 1.1 `useHourWindowZoom.ts` (render-cascade fix)

Two call sites, both confirmed by grep of the client source tree (not just
the plan's narrative):

- `client/src/components/FocusCalendarView.tsx:444` — reached by **two**
  independent page-level entry points that both wrap `FocusCalendarView`
  through the shared `FocusReportBody.tsx` (`viewMode === "calendar"`
  branch, `FocusReportBody.tsx:198`):
  - `client/src/components/FocusReportModal.tsx:147` → `FocusReportBody`
  - `client/src/pages/FocusCalendarBoard.tsx:253` → `FocusReportBody`
- `client/src/pages/FocusPage.tsx:464` — direct call, `defaultHourWindow: 24`
  (not routed through `FocusReportBody`/`FocusCalendarView` at all — a
  second, independent wiring of the same hook).

So a timing regression in the hook's output can surface in **three**
distinct rendered surfaces (`FocusReportModal`, `FocusCalendarBoard`,
`FocusPage`) even though the hook itself has only two call sites. The
effect chain the plan traces (`useHourWindowZoom` → `FocusCalendarView`'s
effect at `FocusCalendarView.tsx:453-456` → `FocusReportBody.tsx`'s
`setVisibleWindow` at line 203 → `FocusReportBody` re-render →
`FocusCalendarView` re-render as child) is confirmed live on `master`.

**Also downstream of the same hook, not called out in the plan's §4.1 fix
scope but sharing the exact same `windowStartMs`/`windowEndMs` values:**
`FocusReportBody.tsx`'s `computeWindowedTotals(report, visibleWindow.startMs,
visibleWindow.endMs)` (line 131-132, and `FocusPage.tsx:558` calling the same
helper independently) — i.e. the *stat tiles*, not just the calendar grid,
are keyed off this hook's stability. A regression in value stability doesn't
just risk a console warning; it risks the on-screen numbers themselves
flickering between renders, since `computeWindowedTotals` re-runs on every
`windowStartMs`/`windowEndMs` change.

**Presentational values that read `Date.now()` directly and are explicitly
out of scope for the fix** (confirmed, `FocusCalendarView.tsx:628`,
`nowPct`) are correctly left alone per the plan — worth naming here only so
a reviewer doesn't confuse "some `Date.now()` reads remain" with "the fix is
incomplete." Because the fix's whole point is to *reduce* re-renders in
live-zoom mode, `nowPct` will now actually update less often too (only on
the `ZOOM_REFRESH_MS` tick, absent some other render trigger) — this is a
behavior-adjacent side effect worth a passing look in manual QA (does the
"now" line still visibly track close enough to real time for a stakeholder
glancing at the board?), even though it's not a broken invariant.

### 1.2 `focus-inference.js`'s `buildActivityDigest()` (chronology fix)

**Correction to the plan/change-brief's stated blast radius, verified by
direct grep of both `server/` and `client/`:** `buildActivityDigest` has
**exactly one** production caller — `inferSession` (`focus-inference.js:471`),
which feeds the heuristic/LLM **session classifier** only. It does **not**
feed `focus-summary.js`'s AI window-summary feature. `focus-summary.js`
imports only `runClaudePromptJson`/`probeClaudeCli` from
`focus-inference.js` (`focus-summary.js:57`); its own "digest" concept
(`computeInputDigest`, `focus-summary.js:106-134`) is an unrelated SHA of a
`FocusReport` (server-computed windowed totals — the *output* of
`focus-report.js`'s already-`b3a2cc9`-fixed chronology walk), not a call
into `buildActivityDigest`'s `events`-table query. The technical plan's own
§10 risk section actually gets this right in passing ("checked — only
`inferSession`, exported for tests") even though §4.2's prose and the change
brief's "Surfaces / features touched" section both overstate this as
feeding "two independent downstream consumers."

**Why this matters for test planning, not just pedantry:** it re-scopes
where the *user-visible* consequence of this bug can land.
- **Confirmed live risk:** a bulk-ingested, out-of-order session can hand
  `inferSession` a wrong-subset/wrong-order digest, producing an incorrect
  or lower-confidence item/detour classification, or a nonsensical
  plan-less-cwd one-sentence summary (`llmSummarize`) — this writes directly
  to `focus_inferences` and is surfaced verbatim as `NONE_KIND` segment text
  in the focus report (per `focus-inference.js`'s own file-header: "that
  reason is kept and surfaced by focus-report.js as the session's
  `NONE_KIND` segment text"). This *is* user-visible, just one hop removed
  (via `focus_inferences`, not directly via `focus-summary.js`).
  Do not scope a test asserting `focus-summary.js`'s AI prose changes as a
  result of this fix — it structurally can't, on the current call graph.
- If a future change *does* wire `focus-summary.js` (or any other
  consumer) through `buildActivityDigest` directly, that new call site
  inherits this exact `row-id-as-chronology-proxy` risk fresh — worth a
  one-line comment at `buildActivityDigest`'s definition noting "sorted by
  `created_at` before `LIMIT` — any new caller relying on `id` order for
  anything other than chronology should re-derive it, don't assume."

**Blast radius beyond `inferSession`:** `focus_inferences` rows feed
`focus-report.js`'s `NONE_KIND` segment rendering for sessions with zero
declared Focus segments — i.e. every one of the 4 `FocusReport` rendering
consumers (`FocusReportBody`/`FocusCalendarView`/`FocusCalendarBoard`/
`FocusPage`) can display a wrong classification or wrong-order-derived
detour title sourced from this bug, making it a (indirect, one-hop)
DERIVED-DUAL-VIEW-adjacent concern too: get the classification wrong once,
upstream, and it's wrong identically on all 4 consumers (which is actually
the *benign* direction — consistent-but-wrong beats inconsistent-and-wrong,
but still wrong).

### 1.3 Shared registries/config

- `MAX_DIGEST_EVENTS = 800` (`focus-inference.js:48`) — the `LIMIT` value
  itself is unaffected by this fix, but the fix changes *which* 800 rows can
  be selected when a session has more qualifying events than that cap. Any
  fixture/test data with exactly-at-or-above-800-row sessions needs the
  `created_at` ordering set up deliberately, not just the `id` ordering
  (see trap in §4).
- `server/db.js`'s established `ORDER BY created_at ASC/DESC, id ASC/DESC`
  convention (already used by `listEvents`, `getEventsBySession`,
  `webhook_deliveries` queries per the technical plan) — this fix brings
  `buildActivityDigest` into line with an existing project-wide convention
  rather than inventing a new one, which lowers risk of the fix itself being
  wrong, but raises the stakes of the *test* actually asserting the ordering
  (an easy-to-write test would assert on `id` order by coincidence if the
  fixture's `id` and `created_at` happen to agree — see trap in §4).
- `idx_events_created ON events(created_at DESC)` — no schema/migration
  risk (already exists, confirmed by the plan and consistent with
  `CLAUDE.md`'s "avoid schema changes without migration-safe logic" rule
  not being implicated here).

## 2. Invariants that must hold

Citing the project's proposed (soon-to-be-formal) catalog IDs where they
apply, per `technical-plan.md` §9:

1. **`DERIVED-DUAL-VIEW` (§9.1)** — same field, same value, across every
   consumer of a given `FocusReport`. At risk here specifically because the
   render-cascade fix touches the *value stability*, not the *value*, of
   `windowStartMs`/`windowEndMs` — a subtly-wrong fix (e.g. `nowMs`
   initialized differently in `FocusCalendarView` vs. `FocusPage`, or the
   interval drifting out of phase between the two hook instances) could
   produce **different** windowed totals between `FocusPage` and
   `FocusReportModal`/`FocusCalendarBoard` at the same wall-clock moment,
   which is exactly the gap the plan's own §7 item 1 (cross-view parity
   test) exists to close — and that test does not exist yet on disk.
2. **`row-id-as-chronology-proxy` (§9.2)** — any `events`-table walk for
   chronological logic must sort by `created_at` (id as tiebreak),
   pre-`LIMIT`. Directly at risk in `buildActivityDigest`; the fix must be
   verified pre-`LIMIT`, not just pre-consumption (see trap in §4 — a fix
   that JS-sorts after `.all()` but leaves `LIMIT` at the SQL level ordered
   by `id` would look identical in a naive diff review but not actually fix
   the "wrong subset" failure mode the plan explicitly calls out as worse
   than `b3a2cc9`'s original bug).
3. **Render stability / no-runaway-effect-loop** (general invariant, not
   yet a named catalog entry — worth flagging as a 3rd catalog-candidate
   given this is the second time this project has needed to reason about it
   explicitly, the first being the `forceRefresh` pattern's own introduction
   in `ed23878`). At risk in `useHourWindowZoom.ts`'s fix directly. Currently
   silent in CI (stderr warning, no failing assertion) — this is itself a
   process gap: a console.error/warn assertion helper does not appear to
   exist yet in the client test setup for this class of bug (worth
   confirming when `useHourWindowZoom.test.ts` is written — Definition of
   Done explicitly requires capturing stderr, not just pass/fail).
4. **Round-trip integrity** — `customOffsetMs` surviving a day-navigation
   round trip (explicitly named as an assertion in §7 item 3) is a real,
   separate invariant from the cascade fix itself; don't let the cascade
   fix's own test coverage crowd out this pre-existing, unrelated-but-
   adjacent hook behavior from getting its first-ever isolated test.
5. **Consistency between the live-mode interval and its dependents** —
   `windowIsFuture` must be derived from the *same* `nowMs` reading as
   `windowStartMs`/`windowEndMs`, not a second independent `Date.now()`
   call (the plan calls this out explicitly as a "hygiene fix, not required
   to close the cascade" — but if skipped, `windowIsFuture` could disagree
   with `windowStartMs` about whether "now" has moved, which is exactly the
   class of two-paths-computing-the-same-thing-differently bug this
   project's `DERIVED-DUAL-VIEW` pattern generalizes from at the hook level,
   not just the component level).

## 3. Recurring-issue mapping

- **`DERIVED-DUAL-VIEW` (§9.1) — 4th recorded touch.** This change touches a
  pattern this project has hit **repeatedly in 5 days**
  (`2026-07-26-focus-calendar-board`, `2026-07-26-focus-report-fidelity`,
  and now this intake — the plan's own count). No entry has ever been marked
  RESOLVED with a durable regression guard; the acceptance criterion the
  plan itself defines (§9.1: "enforced by a cross-consumer test — not
  eyeballing two UIs") does **not yet exist for `FocusPage`** — confirmed:
  `FocusPage.test.tsx:350-352` currently asserts hardcoded `75%`/`25%`
  independently, not against a shared fixture rendered through both
  surfaces. **This is a live, unclosed gap on `master` right now** — it
  predates this change-set (it's a symptom of `31927e2`, 07-26) but this
  change-set is what's slated to close it (§7 item 1). If the render-cascade
  fix lands without that cross-view test also landing, the project ships a
  4th recorded instance of this exact pattern with *still* no regression
  guard — escalate this loudly: it is not optional cleanup, it is the
  literal reason this intake exists.
- **`row-id-as-chronology-proxy` (§9.2) — 3rd recorded instance.** Two prior
  instances (`6e9a443` 2026-04-26 display-ordering, `b3a2cc9` 2026-07-27
  arithmetic) are both confirmed real, merged, tested fixes (verified via
  `git log`). Neither was itself a documentation/catalog entry until now —
  meaning the pattern was **rediscovered from scratch three times** rather
  than grepped-for once it existed. `focus-inference.js:123` is confirmed
  still live/unfixed on current `master` at the time of this report. This is
  a **regression-of-the-fix-class** risk, not a regression of any single
  prior fix: `b3a2cc9`'s fix pattern (sort in JS, post-`.all()`) is
  explicitly documented by the plan as **insufficient** for this call site
  because of the pre-`LIMIT` wrong-subset failure mode — a naive "copy
  `b3a2cc9`'s fix" implementation would look like a fix, pass a shallow
  review, and still be broken. This is the single highest-value thing a
  code reviewer or test author needs to internalize about this change.

## 4. "Ships green but broken" traps

Each of these is a concrete mistake that would pass the *current* suite
(1047/1047 server, 645/645 client) undetected, and each names the assertion
that closes it.

1. **JS-level sort instead of SQL-level pre-`LIMIT` sort.** A plausible,
   easy-to-write "fix" is `.all(...).sort((a,b) => ...)` after the query,
   mirroring `b3a2cc9`'s own fix shape one file over. This passes any test
   that seeds ≤800 rows (order comes out right either way once every
   qualifying row is fetched) and only fails on a >800-row, out-of-order
   session — a scale the existing suite has never exercised for this
   function. **Required assertion:** the regression test (§7 item 4) must
   seed **more than `MAX_DIGEST_EVENTS` (800) qualifying rows**, with the
   out-of-order rows placed such that some fall outside the wrong (id-based)
   top-800 but inside the correct (`created_at`-based) top-800, and assert
   the correct ones are present — not just correctly ordered. A ≤800-row
   fixture would ship green and still be wrong for any real session that
   crosses the cap out of order.
2. **Fixture where `id` and `created_at` happen to agree.** If the new
   `focus-inference.test.js` regression test seeds rows by inserting them in
   `created_at` order (the natural way to write a seed helper), `id` order
   and `created_at` order coincide, and the test would pass **before and
   after** the fix — asserting nothing about the actual bug. **Required
   assertion:** the fixture must explicitly insert rows with `id` order
   contradicting `created_at` order (mirror `b3a2cc9`'s own fixture shape,
   which the plan already specifies) — confirm the test fails against
   current `master` (`ORDER BY id ASC`) before the fix lands, not just
   passes after.
3. **Cascade fix "passes" because the warning is silent, not absent.** A
   fix that reduces the *frequency* of spurious re-renders (e.g. debouncing,
   memoizing the effect's inputs with a shallow-equal check) without
   actually stabilizing the *value* could still occasionally trip 25+
   renders under different timing, and — because nothing in the current
   suite asserts on stderr/console output — would ship green regardless.
   **Required assertion:** capture `console.error`/`console.warn` (or use a
   spy) during the `FocusReportModal.test.tsx` calendar-toggle test and
   `useHourWindowZoom.test.ts`'s live-mode fake-timer test, and assert **no**
   "Maximum update depth exceeded" (or any unexpected React warning) was
   logged — pass/fail on assertions alone is insufficient per the plan's own
   Definition of Done, and per §10's explicit warning that a loosely-written
   fake-timer assertion here would fail to catch a future regression.
4. **`windowStartMs` stable, but `FocusPage`'s and `FocusCalendarView`'s
   `nowMs` states drift out of phase with each other.** Because each
   `useHourWindowZoom` call site gets its **own** independent `nowMs` state
   and its own independent `setInterval`, two mounted instances (e.g.
   `FocusPage` open in one tab-equivalent state and `FocusReportModal` in
   another, or even just re-mounts at different times) are not guaranteed to
   tick in lockstep — each stabilizes internally (closing the cascade bug),
   but the two surfaces' windowed totals could differ from each other by up
   to `ZOOM_REFRESH_MS` (60s) of "now" skew at any given instant, depending
   on exactly when each mounted. This is likely an *acceptable*, pre-existing
   property (each instance already read its own independent `Date.now()`
   before the fix, so this isn't a new divergence budget, just a coarser
   one), but no test currently pins the bound. **Required assertion (or at
   minimum an explicit call-out in the cross-view parity test, §7 item 1):**
   either freeze `Date.now()`/fake timers globally so both rendered surfaces
   in the parity test observe the identical `nowMs`, or explicitly assert the
   two surfaces' windowed totals agree to within one `ZOOM_REFRESH_MS` tick,
   not bit-for-bit — a bit-for-bit assertion without controlling the clock
   would be flaky (intermittently ships green, occasionally red for reasons
   unrelated to a real regression), and a parity test that doesn't control
   time at all could falsely show "pass" while actually never exercising the
   live-anchor code path (e.g. if both renders happen to land in the same
   tick window by luck every CI run).
5. **A registry/enum-completeness gap: `FocusPage` added as a 4th
   `FocusReport` consumer with no corresponding per-consumer test case.**
   Already shipped (`31927e2`, 07-26) and already green — the exact
   `DERIVED-DUAL-VIEW` "ships green but broken" trap this catalog entry
   exists to name. Restating it here because this change-set is what's
   supposed to close it (§7 item 1) — if that specific test item slips or is
   deprioritized relative to the two code fixes, the catalog entry gets
   written to `PROJECT-CONTEXT.md` describing a gap that's still open in the
   very same commit that documents it as a named pattern. **Required
   assertion:** the cross-view parity test must exist, use one shared
   fixture, render at least `FocusPage` and one of
   `FocusReportModal`/`FocusCalendarBoard`, and assert identical numbers —
   not merely that each renders "correctly" against its own independent
   hardcoded expectation (the exact anti-pattern `FocusPage.test.tsx:350-352`
   currently exhibits).

## 5. Severity & priority

Ranked worst-first, by user-visibility and by whether the fix's own test
coverage would actually catch a regression (not just by code-change size):

1. **Highest — Trap #1 (SQL-level pre-`LIMIT` sort) and Trap #2
   (id/created_at-agreeing fixture).** Silent, data-loss-adjacent failure
   mode: a wrong *subset* of a 800+-event session's digest silently
   corrupts what an LLM or heuristic sees, producing a wrong classification
   or plan-less-cwd summary that gets written to `focus_inferences` and
   displayed to a real user as `NONE_KIND` segment text — with **no**
   error, **no** warning, and (if either trap is hit) a test suite that
   stays green throughout. This is the closest thing in this change-set to
   silent data corruption reaching a user-facing surface. Test-plan
   priority: write the >800-row, contradicting-order fixture *before*
   writing the fix, confirm red-then-green.
2. **High — Trap #5 / the `DERIVED-DUAL-VIEW` cross-view parity gap
   itself.** Not caused by this change-set, but this change-set is the
   named vehicle for closing it, and it's the 4th recorded instance of a
   pattern with zero durable regression guards so far. Directly
   user-visible (two different numbers for the same underlying fact on two
   different pages a stakeholder can navigate between) and reputationally
   costly for a stakeholder-facing surface (`/focus` is explicitly a
   stakeholder-facing page per DEC-7).
3. **Medium — Trap #3 (silent console-warning cascade) and the render
   stability invariant.** User-visible as a momentary flicker/jank at worst
   (React's own safety valve caps it at ~25 renders, not an infinite loop or
   crash) but currently completely unguarded in CI, and the plan's own
   Definition of Done singles it out as needing an assertion on stderr
   specifically, not just pass/fail — a natural place for a test author to
   under-scope the fix's own regression test.
4. **Medium — Trap #4 (cross-instance `nowMs` phase drift).** Likely
   cosmetic/negligible in practice (≤60s of skew, matches the pre-fix
   status quo's own precision), but worth an explicit bound in the parity
   test so it doesn't get silently widened by a future change to
   `ZOOM_REFRESH_MS` or the hook's interval logic without anyone noticing.
5. **Low — settings-export/`60af828` bundled scope and the
   `>65,536`-interval regression test.** Real gaps (§7 items 2, 5, 6) but
   both fixes are already shipped and stable by inspection; these are
   pure test-backfill for already-correct code, not live-bug risk. Lowest
   priority relative to the two *currently-live* bugs this report focuses
   on.

## 6. Non-blocking process note

The working tree has unrelated uncommitted changes (`server/db.js`,
`server/routes/run.js`, plus untracked `capture-claude-usage.sh`,
`server/lib/origin-guard.js`) that are **not** part of this intake's scope
per the change brief's own open-questions section. This report's analysis
is scoped strictly to the two named fixes and does not attribute any risk
to those unrelated files.
