# QA Assessment — 2026-07-31-focus-untracked-commits

> Authored by `qa-strategist`. **This is the document the user reads first.** It
> answers: is the change adequately tested, where are the gaps, have we shipped
> this *class* of gap before, and how do we stop it.

## Change summary

This is a retroactive intake for seven already-merged commits
(`0416066`..`60af828`, 2026-07-26 → 2026-07-30) that shipped the Focus-report
surface — windowed stat totals, a new `/focus` stakeholder page, an
hour-window zoom control, AI window summaries, board polish, and two prior
bug fixes. The paperwork half of the plan (retroactive shipped-record,
decisions.md, `PROJECT-CONTEXT.md` catalogue entries) is documentation only.
The code half authorizes two **currently-live, unfixed bugs** discovered by
this review: (1) a React render cascade in `useHourWindowZoom.ts` (the hook
recomputes `windowStartMs`/`windowEndMs` from raw `Date.now()` on every
render in live-zoom mode instead of once per 60s tick), and (2) a
chronology-ordering bug in `focus-inference.js`'s `buildActivityDigest()`
(`ORDER BY id ASC LIMIT ?` instead of `ORDER BY created_at ASC, id ASC LIMIT
?` — confirmed by the risk analyst to be the worse of two prior instances of
this exact defect class, because the `LIMIT` is applied at the SQL level, so
an out-of-order bulk insert can silently select the **wrong subset** of
events feeding a session classifier, not just present a correct subset
out of order). Neither fix, nor any of the 6 planned backfill tests, is on
disk yet.

## Coverage verdict

**BLIND** (today, on current `master` — with a credible, already-designed
path to ADEQUATE if the forward plan lands exactly as specified).

Reasoning: this change lands squarely on **two** of this project's own
demonstrated recurring failure classes, and as of right now, before any of
the forward work lands, there is **zero regression guard for either live
bug**:

- **`DERIVED-DUAL-VIEW`** — 4th recorded touch on this project in 5 days
  (prior: `2026-07-26-focus-report-fidelity`, `2026-07-26-focus-calendar-board`,
  `2026-07-28-wip-queue-page`, per this project's own QA run-log). `FocusPage`
  is a 4th independent rendering consumer of the same `FocusReport` shape and
  has **no** entry in `FocusReportModal.test.tsx`'s "[standing template]"
  cross-consumer chain — the project's own closest thing to a registry of
  "which shapes get cross-checked." Coverage cartographer's verdict:
  UNGUARDED for the specific cross-view-parity claim, despite every
  surrounding test being green.
- **`row-id-as-chronology-proxy`** — 3rd recorded instance of this exact bug
  shape on this codebase (`6e9a443` 2026-04-26, `b3a2cc9` 2026-07-27, now
  `focus-inference.js:123`), and per the risk analyst, worse in kind than
  the prior two: the prior fix's pattern (JS-level post-sort) is explicitly
  documented as **insufficient** here, because the bad ordering happens
  before the SQL `LIMIT`, not after. A naive "copy the `b3a2cc9` fix"
  implementation would look correct in review, pass every existing test, and
  ship still broken. Coverage cartographer's verdict: UNGUARDED for the
  specific defect — the existing `buildActivityDigest` tests are green but
  structurally cannot catch this (insertion order and `created_at` order
  always agree in both existing fixtures).

This is precisely the "ships green but broken" scenario this skill exists to
name — and it is present on `master` today, not merely a hypothetical risk
of the plan.

**Why not GAPPED:** GAPPED implies real-but-addressable surfaces are
unguarded and the fix is "add tests." That undersells the severity here —
both defects are *already shipped*, *repeat* instances of *named* recurring
classes, and one has a documented trap where the obvious fix still ships
broken. That combination — known pattern, live bug, no guard, and a
plausible wrong-fix that would still go green — is the definition of BLIND
this skill uses, and it matches this project's own precedent verdict on the
closest prior case (`2026-07-26-focus-report-fidelity`, called BLIND for the
same reason: "the change lands squarely on two of this project's own
already-demonstrated recurring failure modes with zero guard today").

**Why this isn't "stop and redesign":** unlike a typical BLIND finding, the
path out is not undesigned. The unit-test architect's proposed
`focus-inference.test.js` Case B (§2, unit-tests.md) already anticipates and
defeats the exact "worse than `b3a2cc9`" trap — it seeds >800 rows with a
chronologically-earliest target event inserted *last* (highest `id`),
proving a JS-only sort would still drop it. The e2e/unit architects'
cross-view parity test (unit-tests.md §5 / e2e-tests.md §2.B) is likewise
already scoped to feed one shared fixture into both `FocusPage` and
`FocusReportModal`/`FocusReportBody` and diff windowed totals after a zoom,
not just the raw report. If these land exactly as specified, this verdict
moves to ADEQUATE. The risk is in slippage — either test being cut,
weakened, or "shallow-fixed" under time pressure — not in absent design.

## Current coverage

**Server** (`node --test server/__tests__/*.test.js`, Node's built-in test
runner) — baseline **1047/1047 pass**, 236 suites, independently
re-confirmed by the coverage cartographer.
**Client** (Vitest + RTL, `cd client && npx vitest run`) — baseline
**645/645 pass**, 51 files, independently re-confirmed. A targeted 5-file
subset touching the named surfaces also re-ran green (114/114), with no
"Maximum update depth exceeded" stderr observed — consistent with the
render-cascade bug needing a longer-lived live-zoom mount than any existing
test exercises, not evidence the bug is absent.

By surface (cartographer's verdicts):

| Surface | Verdict | Why |
|---|---|---|
| `FocusCalendarView`/`Board`/`ReportBody`/`Modal` cross-consumer parity | **PARTIAL** | Each of the 4 consumers is well-guarded individually; no test feeds one fixture into `FocusPage` AND `FocusReportModal`/`FocusCalendarBoard` and diffs output. |
| `focus-inference.js`'s `buildActivityDigest()` | **UNGUARDED for the specific defect** | Two green tests exist, both built on insertion-order-equals-`created_at`-order fixtures — the fixture shape that would expose the bug is never constructed. |
| `focus-report.js`'s interval-building path (`60af828`) | **UNGUARDED at the scale that matters** | Heavily tested at normal scale; zero test approaches the >65,536-interval ceiling the fix addresses. |
| `/api/settings/export` streaming route (`60af828`, bundled) | **UNGUARDED** | Appears only in a route-registration/OpenAPI-shape check; no test issues a real `GET` and inspects the response body. |
| `useHourWindowZoom.ts` render stability | **PARTIAL / UNGUARDED for the defect** | Windowing math is well-guarded through both consumers under fake timers; neither advances timers past the 60s tick or asserts on render count/console output — the cascade itself is unexercised. |
| `ConcurrencyStatTile.tsx` | **PARTIAL** | Meaningful indirect coverage via `FocusReportModal.test.tsx` (5+ assertions); no isolated component test. |

## Gaps & test-debt diagnosis

**Systemic reason #1 (DERIVED-DUAL-VIEW):** the project has a *code*
discipline against hand-copied formulas (confirmed — no duplicated math was
found across the 4 consumers), but *test scope* is per-consumer, not
per-shape. The project's closest thing to a registry — the "[standing
template]" chain in `FocusReportModal.test.tsx` — is opt-in and
manually extended; nothing forces a new `FocusReport` consumer to add itself
to that chain before shipping. `FocusPage.tsx` (`31927e2`, 07-26) is the
direct proof: it shipped with its own, independently-hardcoded `75%`/`25%`
assertion instead of a shared-fixture comparison, and every existing test
around it stayed green.

**Systemic reason #2 (row-id-as-chronology-proxy):** the project has an
established convention (`ORDER BY created_at ASC/DESC, id ASC/DESC`, used
elsewhere in `server/db.js`) but no mechanism that *enforces* it at new call
sites — each `events`-table chronological walk is hand-written per function,
so the same class of bug is independently (re)introduced rather than
prevented structurally. It has now been discovered from scratch three
times (`6e9a443`, `b3a2cc9`, `focus-inference.js`) rather than grepped for
once cataloged.

**Have we shipped this class of gap before?**

- **DERIVED-DUAL-VIEW: yes, 4x.** This project's QA run-log records three
  prior touches — `2026-07-26-focus-report-fidelity` (verdict BLIND, for the
  same reason as this run: a recurring pattern landing with zero guard),
  `2026-07-26-focus-calendar-board` (GAPPED — countermeasure existed but
  under-specified), and `2026-07-28-wip-queue-page` (GAPPED — countermeasure
  well-designed this time, and that run explicitly recommended promoting
  `DERIVED-DUAL-VIEW` to a formal `PROJECT-CONTEXT.md` catalog entry "so a
  5th consumer inherits an enforced rule rather than relying on evaluator
  diligence again"). That recommendation was not acted on before this 4th
  instance shipped (`31927e2`). No id yet — `PROJECT-CONTEXT.md` has no
  `## Recurring defect-class patterns` section; this intake's own §9 is the
  first attempt to formally add one, still pending as of this QA pass.
- **row-id-as-chronology-proxy: 3rd code instance, first QA run-log
  mention.** Two prior merged, tested fixes (`6e9a443`, `b3a2cc9`) predate
  this project's QA process being run against this surface, so this is the
  pattern's QA debut, not a repeat QA miss — but it is a real
  regression-of-the-fix-class risk: `b3a2cc9`'s own fix *shape* (sort in
  JS after `.all()`) is exactly the shape that would look like a correct
  copy-paste fix here and still be broken, per the risk analyst.

## Recommendation

**Must-add-now (gate this change, worst-first):**

1. **`focus-inference.test.js` Case B — the >800-row, SQL-`LIMIT`
   wrong-subset regression test** (unit-tests.md §2). This is the single
   highest-priority test in the whole plan: it is the only one that
   distinguishes a correct fix from the plausible-but-still-broken
   "JS-sort-only" fix. Must be written and confirmed red-before/green-after
   *before* the `buildActivityDigest()` fix is considered done — not
   after, and not skipped even if Case A (simple out-of-order, ≤800 rows)
   passes.
2. **The `FocusPage` cross-view parity test** (unit-tests.md §5 /
   e2e-tests.md §2.B), extending `FocusReportModal.test.tsx`'s standing
   template. This is the literal reason this intake exists — landing the
   render-cascade fix without it means shipping a 4th recorded
   `DERIVED-DUAL-VIEW` instance with the fix itself still unguarded. Must
   assert parity on both the raw (24h) totals *and* the windowed (4h)
   totals after both surfaces zoom — the raw-totals-only version of this
   test would pass even if the two surfaces' windowing math diverged.
3. **`useHourWindowZoom.test.ts` case 4** (unit-tests.md §1) — the
   render-count + `console.error` spy assertion, not just the
   value-stability assertion. Per the plan's own Definition of Done, a fix
   that reduces re-render *frequency* without stabilizing the *value* would
   still ship green under a pass/fail-only test.
4. `focus-report.test.js`'s >65,536-interval regression and
   `settings-export.test.js` — lower priority (both underlying fixes are
   already shipped and stable by inspection; these are pure test-backfill
   for already-correct code, not live-bug risk), but still required by the
   plan's own Definition of Done before calling the full backfill complete.

**Durable cure (stops the whole class, distinct from the point fixes):**

- **DERIVED-DUAL-VIEW:** the "[standing template]" pattern is a good
  informal convention but remains opt-in. The durable fix is to formalize
  it — either a lint/review checklist item enforced at PR time ("new
  `FocusReport` consumer → extend the standing-template chain, no
  exceptions"), or, more mechanically, a meta-test that enumerates all
  known `FocusReport`-consuming components (a small registry array) and
  fails if a new one is added to the codebase without a matching entry in
  the parity chain. Given this is now the 4th occurrence with no durable
  guard shipped after the 3rd occurrence explicitly recommended one, this
  should not be deferred again.
- **row-id-as-chronology-proxy:** the durable fix is a one-line convention
  guard rather than a full lint pass — a code comment at each
  chronological-query definition (as the risk analyst suggests for
  `buildActivityDigest`) is necessary but not sufficient given it's already
  failed to prevent 3 instances. Recommend a grep-based or AST-based check
  (mirroring the "registry-derived meta-test" pattern used successfully on
  other projects in this QA program) that flags any `ORDER BY id` (without
  `created_at`) on the `events` table, so a 4th instance is caught at
  review time, not discovered independently again.

**Is this safe to ship once the must-adds are in?** Yes — the must-add-now
tests above are already well-specified (not hand-waved) and each is
grounded in a real red-before/green-after proof method against the actual
defect shape, including the specific trap the risk analyst flagged as the
one a shallow implementation would miss. Landing items 1-3 above closes both
live bugs with real guards; the durable cures are the right next investment
but are not required to make *this* change-set safe.

## Open decisions for the user

- [ ] Accept the durable-cure recommendations (a `FocusReport`-consumer
  registry meta-test; an `ORDER BY id`-without-`created_at` guard) as
  in-scope for this change-set, or explicitly defer them in `decisions.md`
  (mirroring how other projects in this QA program have handled a 3rd/4th
  recurrence — an explicit written deferral, not a silent one)? Given this
  is the 4th `DERIVED-DUAL-VIEW` occurrence after an unactioned
  recommendation from the 3rd, deferring again should be a conscious call,
  not a default.
- [ ] Confirm the plan's own must-add-now tests (in particular
  `focus-inference.test.js` Case B and the cross-view parity test's
  windowed-not-just-raw assertion) are not cut or weakened under time
  pressure — both are more expensive to write than a "does it render"
  smoke test, and both are the specific tests that distinguish this
  BLIND-today verdict from an ADEQUATE one.
- [ ] `PROJECT-CONTEXT.md`'s `## Recurring defect-class patterns` section
  (technical-plan.md §9, two entries) has not landed yet — confirm who owns
  landing it in this pass vs. treating it as pure follow-up paperwork; QA
  did not add it directly since it is not yet a configured catalog (per
  this skill's own instruction not to invent one).

---
*Memory updated:* qa-run-log.md ✅ · this project's recurring-issue catalog:
not yet configured (no `## Recurring defect-class patterns` section exists in
`PROJECT-CONTEXT.md` as of this pass) — not updated directly, per policy;
flagged above as an open decision.
