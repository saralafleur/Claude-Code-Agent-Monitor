# PM Plan: Retroactive Documentation of Untracked Focus-Surface Commits

Intake: `intake/2026-07-31-focus-untracked-commits/` · Date: 2026-07-31 · PM pass

## 1. Request summary

Between 2026-07-26 and 2026-07-30, seven commits (`0416066`..`60af828`)
shipped real, working feature and fix work on the focus-report surface —
windowed stat totals, an hour-window zoom control, a new stakeholder-facing
`/focus` page, AI-generated window summaries, two correctness/availability
bug fixes in `server/lib/focus-report.js`, and an unrelated settings-export
streaming rewrite bundled into the last commit — with no `team-intake`
folder behind any of them. `team-status`'s reconciler caught this while
re-verifying the two sibling items that *did* go through the pipeline
(`2026-07-26-focus-calendar-board`, `2026-07-26-focus-report-fidelity`), and
Sara chose to run this retroactively so the pipeline has an honest record of
what shipped, why, and what — if anything — still needs real follow-up. This
plan is that record. It is not a build authorization; the code is already
live, tested green (1047/1047 server, 645/645 client), and in daily use.

## 2. Request type

**Final classification: `missed-requirement`, in the specific retroactive
sense the brief proposed — confirmed, not adjusted.** The "requirement" that
was missed was process (route work through `team-intake`/`team-plan` before
merge), not product. Within that outer classification, the seven commits
themselves span multiple types, and this plan calls each out distinctly
rather than forcing one label onto all of them:

- `31927e2` (`/focus` page) and `b930824` (AI window summaries) are
  **new-feature**-shaped — genuinely new UI surface and a new external-cost
  dimension (LLM calls), shipped without the same decision-log discipline
  DEC-1..DEC-6 got for the sibling `/focus-calendar` page.
- `0416066`, `ed23878`, `0d5fbe7` (windowed totals, hour-window zoom, board
  polish) are additive extensions of already-DECIDED scope
  (`focus-calendar-board`'s DEC-1/DEC-3) — not new decisions, no
  contradiction of anything on record.
- `b3a2cc9` (gap-sum sort fix) is a genuine **bug** — the active/idle
  gap-sum walk never worked correctly for out-of-order event insertion; it
  is not a regression of anything that used to be right.
- The `focus-report.js` half of `60af828` (stack-overflow fix) is likewise a
  **bug** — `push(...intervals)` never worked correctly once a session
  crossed V8's ~65,536 spread-argument limit; it just took until a
  high-volume real session to surface.
- `60af828`'s settings-export streaming half is **out of scope for this
  plan** — unrelated surface, bundled into the same commit as the
  stack-overflow fix purely by timing. Noted as a process-hygiene footnote
  (§6), not carried into this plan's acceptance criteria.

This is not `regression` (nothing that worked correctly stopped working),
not `text/content-change`, and not `clarification-only` — real code shipped
either way the seven commits are sliced.

## 3. History / background — have we seen this before?

This is the **third** intake-adjacent touch of this exact surface in five
days, and the pattern each prior touch flagged (DERIVED-DUAL-VIEW) is now
confirmed live a third/fourth time. Timeline, reconstructed from both
sibling items' `pm-plan.md`/`decisions.md` and this project's request-log:

| Date | Item | Type | What happened |
|---|---|---|---|
| 2026-07-26 (AM) | `focus-report-fidelity` | missed-requirement + embedded bug | Round-4 idle-stripe fix landed in Calendar view only; List view (`FocusReportModal.tsx`) was never touched and stayed `wall_ms`-only. Durable fix mandated: extract shared helper (`idleStripes.ts`) + permanent List-vs-Calendar cross-view consistency test. Both confirmed present and still in the code as of this pass. |
| 2026-07-26 (PM) | `focus-calendar-board` | new-feature | New `/focus-calendar` standalone page (DEC-1..6, all DECIDED). PM plan explicitly named this a "3rd consumer" of the same rendering surface and mandated "extract, don't copy" + a cross-entry-path parity test as non-optional DoD, not a nice-to-have. |
| 2026-07-28 | `wip-queue-page` | new-feature | Different surface (session-priority queue), but PM explicitly named the same recurring shape ("one surface, many consumers") a third time and mandated the same discipline preemptively. |
| **2026-07-26 → 2026-07-30 (this batch, undocumented)** | 7 commits | mixed | `/focus` page (a **4th** consumer of the same `FocusReport` shape) + AI summaries shipped with **no** decision-log entry and, per QA, **no** cross-view consistency test extended to the new page — the exact gap the two prior items' mandates existed to prevent. |
| 2026-07-31 | this intake | — | `team-status` catches the gap; retroactive documentation ordered. |

**Have we seen this before? How many times?** DERIVED-DUAL-VIEW as a named
risk has now been flagged in four consecutive touches of this feature area
(3 catalogued intakes + this one) and materially recurred twice
(`focus-report-fidelity`'s List-view gap, and now `FocusPage.tsx`'s
uncovered parity gap). It has **not** regressed into duplicated logic each
time — see §4 — but the "did we remember to extend the standing test"
discipline has now failed once (this batch) after holding once
(`focus-calendar-board`). Separately, an **adjacent, previously-uncatalogued
pattern** — "row insertion order (`id`) is not a reliable proxy for
chronological order once `workflow-ingest.js` bulk-inserts are in play" —
has now surfaced twice on two different surfaces: `6e9a443` (2026-04-26,
`SessionDetail.tsx`, display-ordering) and `b3a2cc9` (2026-07-27,
`focus-report.js`, arithmetic double-counting), and QA found a live,
unaudited third instance of the same root cause feeding the brand-new
AI-summary feature this batch shipped (see §4).

## 4. Recurrence diagnosis

**DERIVED-DUAL-VIEW: mostly held, not a clean miss.** The architect's close
read is the most load-bearing finding in this batch: the four evaluators
initially read this differently (PO flagged it as recurring via
`FocusPage.tsx`'s own comments saying it "mirrors" `FocusReportBody`'s
formula; architect found the actual code mostly *extracts* rather than
mirrors — `HourWindowZoomBar`/`useHourWindowZoom`, `StatTile`/
`ConcurrencyStatTile`, `ProjectScopeFilters` are all genuinely shared
components, not copies, with `windowedTotals.ts` as the one bounded,
self-documented exception). Reconciling PO and architect: the **code**
mostly held the line the two prior mandates established (real extraction,
not duplication) — this batch is evidence the discipline is sticking at the
implementation level. What actually broke down is the **process** layer
around it: no decision-log entry for the two new-feature-shaped pieces, and
critically, QA confirms the **cross-view consistency test never got
extended to the new 4th consumer** — `FocusPage.test.tsx`'s own parity
assertion hardcodes an independently-computed 75%/25% split instead of
rendering `FocusPage` and `FocusReportModal` from the same fixture and
asserting agreement, unlike the List-vs-Calendar test this exact gap-class
already produced once. That is the standing-template mandate from
`focus-report-fidelity` not being re-applied to the newest consumer — the
systemic cause is **the standing test's own docstring said "extend THIS
test for any future field," but nothing enforces "extend THIS test for any
future *consumer*."** The guard is scoped to fields, not surfaces, and this
batch is exactly the case that scoping doesn't cover.

**Row-id-as-chronology-proxy: a live, unaudited twin, not yet catalogued.**
`b3a2cc9` fixed `ORDER BY id ASC` used as a chronology proxy in
`focus-report.js`'s gap-sum walk. In the same batch, `server/lib/
focus-inference.js`'s `buildActivityDigest()` — the function feeding the
brand-new AI-summary feature (`b930824`) — does the identical `ORDER BY id
ASC LIMIT ?` against the same `events` table, unaudited. It doesn't do
gap-sum arithmetic, so it can't reproduce `b3a2cc9`'s exact negative-`idle_ms`
failure mode, but a bulk-ingested, out-of-timestamp-order session (the
documented real-world trigger for `b3a2cc9`, confirmed via 7,152/8,117
out-of-order events in a real session) would hand the LLM a non-chronological
digest to narrate — plausible, uncaught, and shipped in the same batch as
the fix for its sibling. This is the systemic root, not a coincidence: the
fix for `b3a2cc9` was applied at the one call site someone was actively
looking at (the gap-sum walk), not at the underlying assumption ("`id`
order == time order" is unsafe project-wide once `workflow-ingest.js` bulk
inserts are possible). Same shape as DERIVED-DUAL-VIEW, one layer down: a
correct fix to one consumer of an unsafe assumption, with no mechanism
forcing a look at sibling consumers of the same assumption.

## 5. Where this is coming from

Two distinct sources, cleanly separable:

- **Process drift, not a technical gap.** Sara self-directed this batch
  (own commits, own review) and it never entered the `team-intake` gate —
  presumably why the two new-feature-shaped pieces (`/focus` page, AI
  summaries) never got a decision-log entry the way `/focus-calendar` did
  hours earlier the same day. The code itself is sound; the paper trail
  is not.
- **A genuine, previously-unflagged bug found only by this retroactive
  review, not by any commit or existing test:** `FocusCalendarView.tsx`'s
  live-zoom mode derives `windowStartMs`/`windowEndMs` from `Date.now()` on
  every render; the `onVisibleWindowChange` effect keyed off those values
  can re-fire every render in live-zoom mode, producing the shape of an
  unbounded render/effect cascade. Both engineer and QA independently
  reproduced the same React **"Maximum update depth exceeded"** warning
  during test runs (engineer: targeted client group; QA: full client suite,
  `FocusReportModal.test.tsx`). No test currently asserts against it — the
  warning is silent in CI today. This is new-in-this-batch (introduced by
  `ed23878`'s extraction of `useHourWindowZoom`/`HourWindowZoomBar` out of
  `FocusCalendarView.tsx`, per QA's flag), not a pre-existing condition.

## 6. Two workstreams — keep these separate

This retroactive pass surfaced two categories of finding that should **not**
be handled the same way. Sequencing them correctly is the main judgment call
in this plan.

**A. Retroactive paperwork (documentation only, no code change required):**
- Record `31927e2` (`/focus` page) and `b930824` (AI summaries) as
  retroactive decisions — see §7.
- Note `60af828`'s bundled, unrelated settings-export streaming as a
  process-hygiene footnote, scoped out of this plan's deliverables.
- Confirm (already done, this pass): no doc gap — `.env.example`,
  `README.md`, `ARCHITECTURE.md` all correctly document
  `DASHBOARD_FOCUS_SUMMARY_MODEL`/the summary endpoint (contrary to the
  brief's own open question #4, which can be closed with no action).

**B. Two real, live bugs in currently-shipped code — this is not
housekeeping, this is active follow-up work:**
1. **Render cascade** — `FocusCalendarView.tsx` live-zoom mode,
   `Date.now()`-on-every-render feeding an effect dependency, reproduced
   independently by two evaluators. Low reproduction cost, plausible
   real-world impact (a stakeholder leaving the Focus Calendar open in
   live-zoom for any length of time), currently invisible to CI.
2. **Chronology-proxy twin** — `focus-inference.js`'s `buildActivityDigest()`
   still does unsorted `ORDER BY id ASC` against the same `events` table
   `b3a2cc9` just proved is unsafe, feeding the new AI-summary feature with
   potentially non-chronological data. Not yet confirmed as an active wrong
   output (no reproduction attempted), but the causal mechanism is proven
   (same table, same unsafe assumption, same real-world trigger
   `workflow-ingest.js` already demonstrated).

**Recommendation on sequencing:** fold both into **this intake's
`technical-plan.md` as explicit, scoped fix tasks**, rather than opening two
new intake folders. Reasoning: both are small, single-surface, root-cause-
understood fixes (not open design questions), both were discovered *by*
this retroactive review rather than needing fresh triage, and forcing them
through a full separate `team-intake` cycle would re-litigate PO/architect
context this plan has already established, adding process overhead without
adding decision quality. This is a bug fix on already-catalogued surfaces,
not a new ask — treat it as **our cost**, prioritized ahead of the
retroactive test-backfill items in §8's ordering (real live bugs before
gap-filling regression tests). If either fix, once scoped in
`technical-plan.md`, turns out to need a design decision (e.g. a
non-trivial re-architecture of live-zoom timing), split it out then — but
default to "fix inside this plan."

## 7. Recommendation to the human

1. **Approve this document as the retroactive record.** No rebuild, no
   re-review of already-shipped, already-green code required.
2. **Add two retroactive decision entries** (new `decisions.md` for this
   intake, or appended to `focus-calendar-board/decisions.md` as `DEC-7`/
   `DEC-8` — PM recommends a new file scoped to this intake, since these
   decisions postdate and are logically independent of DEC-1..6):
   - `/focus` page as an intentional second, narrative-lens route alongside
     `/focus-calendar`, not scope drift — Sara authored it herself; record
     that plainly so future readers don't mistake it for unreviewed scope
     creep.
   - AI window-summary feature's LLM-cost/latency profile
     (`DASHBOARD_FOCUS_SUMMARY_MODEL` defaulting to `sonnet`, not `haiku`,
     specifically because it's stakeholder-facing prose, mitigated by
     digest-gated caching) — record as accepted, not an unexamined default.
3. **Direct `technical-plan.md` to scope the two live bugs from §6.B as
   explicit fix tasks**, sequenced ahead of the retroactive test-backfill
   work in §8.
4. **Catalogue DERIVED-DUAL-VIEW in `PROJECT-CONTEXT.md` now.** This is the
   fourth touch of this pattern in five days across three PM plans, and the
   informal "read the file-header comments" discipline scales worse each
   time a new consumer is added (now 4 rendering consumers of one
   `FocusReport` shape, up from 2 five days ago). Concretely: name the
   pattern, state the acceptance test shape ("same field, same value, across
   every consumer of a given `FocusReport`, enforced by a cross-consumer
   test — not eyeballing"), point to `windowedTotals.ts`'s file header as
   the canonical example of documenting an unavoidable, bounded exception
   rather than silently duplicating. Per architect's Option C: also have
   `team-qa` add the structural cross-consumer test (§8, item 4) so a future
   5th consumer is caught by CI, not code review — and, per this pass's
   finding, scope that test explicitly to "every consumer," not just "every
   field," so the exact gap this batch fell into (new consumer, old test
   scope) can't recur silently.
5. **Catalogue "row-id-as-chronology-proxy" as a second named pattern in
   `PROJECT-CONTEXT.md`.** Two independent surfaces (`SessionDetail.tsx`,
   `focus-report.js`) have now shipped this exact mistake, and a third,
   live, unaudited instance (`focus-inference.js`) is sitting in the same
   batch that fixed the second one. This has crossed the threshold from
   "isolated bug" to "recurring defect class" on its own evidence, independent
   of the DERIVED-DUAL-VIEW question.
6. **Do not treat this batch as "the risk fired again" in the alarming
   sense.** The architect's read should carry: extraction, not duplication,
   is what actually shipped in the code for 4 of 5 shared components; the
   process gap (no decision entry, no test-scope extension) is real but
   narrower than "the team keeps making the same coding mistake." Calibrate
   the catalogue entries and any Sara-facing framing accordingly — this is a
   process/governance fix, not a rebuild.
7. **Settings-export bundling (`60af828`)** — one-line process note only
   ("unrelated work landed in a bug-fix commit"), not a design doc, per PO
   and architect's converged recommendation. Sara's call whether she wants
   even that recorded; PM recommends yes, briefly, since it's zero-cost and
   completes the record.

## 8. Backlog for `technical-plan.md` (ordered)

1. **Fix: render cascade in `FocusCalendarView.tsx` live-zoom mode** (§6.B.1)
   — root-cause and fix the `Date.now()`-per-render / effect-dependency
   loop; add a regression test that would have caught it (currently silent
   in CI).
2. **Fix: sort-before-use in `focus-inference.js`'s `buildActivityDigest()`**
   (§6.B.2) — apply `b3a2cc9`'s same sort-before-use pattern, or explicitly
   review and document why digest-text ordering is safe without it (QA's own
   DoD checklist leaves this as an open item — resolve one way or the
   other, don't leave it silently unresolved).
3. **Add the `FocusPage`-vs-`FocusReportModal` cross-view consistency
   test** (QA gap #5) — same shape as the existing List-vs-Calendar test,
   closes the actual DERIVED-DUAL-VIEW parity gap this batch left open.
   Highest-priority test-backfill item.
4. **Structural cross-consumer test** (architect's Option C) — a
   single, consumer-parameterized test so a future 5th `FocusReport`
   consumer is caught by CI by construction, not by remembering to extend
   a per-pair test.
5. **>65,536-interval stack-overflow regression test** (`60af828`, QA gap
   #3) — proves the fix, guards against a future readability-motivated
   revert to `push(...x)`.
6. **`useHourWindowZoom`/`HourWindowZoomBar` isolated unit test** (QA gap
   #1) — edge-case-heavy hook logic currently only covered indirectly.
7. **Settings-export functional test** (QA gap #4) — content-correctness
   for the streaming rewrite; lower priority, off-surface.
8. **`ConcurrencyStatTile` smoke test** (QA gap #2) — lowest priority,
   presentational only.

## 9. Open decisions for the user

1. **Confirm the two retroactive decision entries** in §7.2 (`/focus` page
   as intentional second route; AI-summary cost/latency profile accepted).
2. **Confirm folding the two live bugs (§6.B) into this intake's
   `technical-plan.md`** rather than opening separate intake folders — PM
   recommendation is yes (§6), but flagging explicitly since it's a scope
   call.
3. **Confirm cataloguing both DERIVED-DUAL-VIEW and
   row-id-as-chronology-proxy in `PROJECT-CONTEXT.md`** — three prior PM
   plans each individually punted this exact call back to Sara; this is the
   fourth. PM recommendation is yes, for both, given the evidence in §3-4.
4. **Settings-export bundling note (§7.7)** — confirm whether even a
   one-line process note is wanted, or drop it entirely.
