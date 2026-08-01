# Product Owner Assessment — Retroactive Documentation of Untracked Focus-Surface Commits

Intake: `intake/2026-07-31-focus-untracked-commits/` · Date: 2026-07-31 · PO pass

Source: `request-brief.md`, `request-source.md`. This is a **retroactive**
review of seven already-merged commits (`0416066`..`60af828`, 2026-07-26
through 2026-07-30). My job here is not "should we build this" — it's
already built and live on `master` — but "was this in scope, does it serve
the stated mission, what does 'done' mean in hindsight, and what (if
anything) needs stakeholder attention now." I independently re-read the
actual diffs (`git show`) rather than trusting only the brief's summary,
per this project's own "verify before punting" convention.

## Scope-of-truth check for this project

No `PROJECT-CONTEXT.md` domain-conventions section names a formal
scope-decision doc set (confirmed: the current `PROJECT-CONTEXT.md` at repo
root only documents repo topology). For this feature area specifically,
the closest thing to a source-of-truth/sign-off record is each prior
intake's own `decisions.md` / `pm-plan.md`:
- `intake/2026-07-26-focus-calendar-board/decisions.md` — six DECIDED
  entries (DEC-1..DEC-6) covering the `/focus-calendar` standalone page.
- `intake/2026-07-26-focus-report-fidelity/` — the wall_ms/active_ms
  fidelity fix, with no formal `decisions.md` (Sara's own chronological
  instructions in `request-source.md` served as de facto sign-off there).

I checked the seven commits against both.

## 1. Value & intent

**Mission fit: yes, squarely.** All seven commits extend the same
job-to-be-done both prior catalogued items served: give Sara (sole
operator of this local-first dashboard) an accurate, trustworthy,
fleet-wide view of what her Claude Code agents have actually been doing,
without her having to reconstruct it by hand. Specifically:

- `0416066`, `ed23878`, `0d5fbe7` (windowed stat totals, hour-window zoom,
  board polish/route-fidelity) are direct continuations of
  `focus-calendar-board`'s DEC-1/DEC-3 decisions (standalone page,
  day-picker + custom range) — they make the already-approved `/focus-calendar`
  page more usable (zoom into an hour window instead of only a full day),
  not a new capability.
- `b3a2cc9` is a correctness fix in `server/lib/focus-report.js`'s
  active/idle gap-sum walk (unsorted timestamps corrupting the sum) — same
  "the number must be true" mandate `focus-report-fidelity` established as
  this feature's non-negotiable bar.
- `60af828`'s stack-overflow fix (`push(...intervals)` exceeding V8's
  spread-arguments limit on high-event-volume sessions) is an availability
  fix on the same surface — the report crashing outright is a worse
  failure mode than the fidelity bug fidelity-item fixed, so this is
  squarely in the same "the report must work and must be honest" mission.
- `31927e2` and `b930824` genuinely extend the mission's *shape*, not just
  its execution: a new `/focus` page (distinct from `/focus-calendar`)
  that turns the same underlying data into a plain-language "what
  happened" list, and AI-generated window summaries. Both still serve
  "tell Sara accurately what her fleet did," just via a second lens
  (narrative rather than swimlane) rather than a materially different
  goal.

**Why it matters to the end user:** identical rationale to both prior
items — Sara is the sole stakeholder and the dashboard's entire premise is
situational awareness across concurrent agent sessions. A narrative
"what happened" view and an hour-level zoom are natural, low-risk
extensions of an already-validated need, not speculative scope growth.

## 2. Scope check

### In scope, with one clean exception and one real gap

**In scope, extends approved decisions:**
- `0416066`, `ed23878`, `0d5fbe7` — additive polish/functionality on the
  `/focus-calendar` page DEC-1 through DEC-6 already approved. Nothing
  here contradicts a DECIDED entry.
- `b3a2cc9`, and the `focus-report.js` half of `60af828` — bug fixes on
  the shared `buildProjectFocusReport`/`buildSessionFocusReport` surface
  both prior items already treated as the trusted core computation. In
  scope, no new decision needed (fixing a bug in an already-approved
  computation doesn't require re-approval of the computation).

**In scope but NOT covered by any prior DECIDED entry — a new-feature
addition Sara made herself, mid-stream, without a recorded decision:**
- `31927e2`'s `/focus` page is a **second, separate route** from the
  DEC-1-approved `/focus-calendar` (confirmed via `git show 31927e2 --
  client/src/components/Sidebar.tsx`: it adds a *new* nav entry, `Focus`,
  right after the DEC-5-decided `Calendar` entry — it does not replace or
  extend that entry). Nothing in `focus-calendar-board`'s six decisions
  anticipates a second page. This isn't a contradiction of an approved
  decision (DEC-4's "leave old modal untouched" logic doesn't forbid a
  third view), but it is genuinely new UI surface added without going
  through the same one-by-one decision walkthrough DEC-1..DEC-6 got. Sara
  authored it herself (self-directed, not a delegated build), which is
  presumably why it shipped without a gate — but that's exactly the
  "process, not product" gap this whole retroactive intake exists to
  document. **Recommend recording this as its own decision entry
  (`DEC-7` or similar, added retroactively) in
  `focus-calendar-board/decisions.md` or a new decisions log for this
  intake**, stating explicitly that Sara approved (by building) a second
  `/focus` page as a narrative sibling to the calendar, so future readers
  don't mistake it for an unreviewed feature.
- `b930824`'s AI window-summary feature (`GET /api/focus-report/summary`,
  new `focus_summaries`/`focus_summary_access_log` tables, LLM spawn via
  `claude -p`, new `DASHBOARD_FOCUS_SUMMARY_MODEL` env knob) is the
  clearest **new-feature** item in the batch — it introduces a new
  external-cost dimension (LLM calls, even if cached/gated by input
  digest) that neither prior catalogued item's decision log addresses at
  all. This is not a contradiction of scope, but it is meaningfully
  different in kind from "add a zoom control" — it has ongoing
  cost/latency/failure-mode implications a stakeholder should explicitly
  bless, not just discover after the fact. Recommend the retroactive plan
  flag this distinctly (see §5) rather than folding it silently into "more
  focus-report polish."

**Clean exception — flag for split-out, do not fold into this plan:**
- `60af828`'s settings data-export streaming
  (`server/lib/data-transfer.js`, `server/routes/settings.js`) is **not**
  on the focus-report surface at all — it's an unrelated performance fix
  (avoid blocking the synchronous SQLite event loop for minutes on a
  multi-million-row export). The commit message itself frames it as two
  independent fixes bundled opportunistically ("Separately, ..."). This
  should **not** be pulled into this plan's design/acceptance-criteria
  work. My recommendation, consistent with the brief's own non-blocking
  assumption #2: mention it here for completeness (done), but scope it out
  of this retroactive plan's actual deliverables and log it as a distinct,
  minor process note ("unrelated work got bundled into a bug-fix commit") —
  not as a thing this intake needs to design, test-plan, or seek sign-off
  for. If it needs its own retroactive documentation, that's a separate,
  much smaller intake, not part of the focus-report story.

### Contradiction check

No approved decision is contradicted. DEC-1 through DEC-6 remain accurate
descriptions of the `/focus-calendar` page as shipped (I spot-checked
DEC-5's nav placement — "Calendar" sits right after "Projects" exactly as
decided — and DEC-6's relabeled `concurrency_ratio` copy is present via
`ConcurrencyStatTile.tsx`, added in `0d5fbe7`, sharing that stat between
`FocusReportBody` and the new page per its own file header). The
`focus-report-fidelity` item's core fix (wall_ms/active_ms parity,
idle-visibility) is also untouched by these seven commits — no regression
of that item's own acceptance criteria is evident from the diffs.

## 3. Acceptance criteria ("done when...", assessed retroactively)

Since there was no live requester, these are written as the "done when"
bar a normal pre-build PO pass would have set — and checked against what
actually shipped, since this is retroactive.

1. **`b3a2cc9` (gap-sum sort fix).** Done when: the active/idle gap-sum
   walk in `server/lib/focus-report.js` produces the same numeric result
   regardless of the input event order, verified by a regression test
   with out-of-order timestamps. **Met** — `server/__tests__/focus-report.test.js`
   coverage was added in the same commit per the source doc.

2. **`60af828`'s stack-overflow fix (focus-report half only).** Done
   when: `buildSessionFocusReport` no longer throws
   `RangeError: Maximum call stack size exceeded` on a session with
   interval counts past V8's ~65536 spread-argument limit, and a
   regression test proves it at scale. **Partially unverified** — the
   commit message describes the fix (loop-push instead of spread) but I
   did not find a dedicated large-interval-count regression test in this
   pass; the technical-plan stage should confirm one exists or flag it as
   a genuine follow-up (this is exactly the kind of edge-case fix that's
   easy to "fix and move on" without a test that would catch a
   regression).

3. **`0416066`, `ed23878`, `0d5fbe7` (windowed totals, hour-window zoom,
   board polish).** Done when: the stat tiles reflect only the zoomed-in
   hour window (not the full day) when a zoom is active, the zoom control
   is discoverable and its state is not lost on navigation
   inconsistent with the rest of the page's filter state, and the
   existing `/focus-calendar` snapshot/regression suite still passes
   (no visual regression on the already-approved page). Client-side
   verification for these specific pieces is not confirmed in this pass —
   flag for `team-qa`.

4. **`31927e2`, `b930824` (`/focus` page + AI summaries).** Done when:
   - The `/focus` page renders a plain-language "what happened" list that
     is numerically consistent with `/focus-calendar`'s own totals for the
     same project/session/window (the DERIVED-DUAL-VIEW risk both prior
     items flagged, now live a third time — see below). This is **not
     confirmed** in this pass; it needs an explicit cross-view parity
     check, the same discipline `focus-calendar-board`'s PM plan mandated
     for the calendar-vs-page pairing.
   - AI-generated summaries degrade gracefully (`{ summary: null }`, no
     error, per `ARCHITECTURE.md`'s documented contract) when the LLM is
     unavailable, mode is off, or the window is empty. Documented and
     appears implemented per `focus-summary.js`'s description in
     `ARCHITECTURE.md` — **met on paper**, not independently re-verified
     by me against runtime behavior in this pass.
   - The `.env.example`, `ARCHITECTURE.md`, and `docs/API.md` entries for
     `DASHBOARD_FOCUS_SUMMARY_MODEL` and `GET /api/focus-report/summary`
     exist and are accurate. **Confirmed met** — I checked all three
     directly; contrary to the request brief's open question #4 assuming
     this might be missing, docs were already propagated in the same
     commit (`b930824`'s own message states "Docs propagated," and I
     independently verified the `.env.example` and `ARCHITECTURE.md`/
     `docs/API.md` entries exist and describe the shipped behavior
     accurately). **This resolves the brief's open question 4 — no
     doc-sync follow-up is needed for the AI-summary config.**

5. **`60af828`'s settings-export streaming (off-surface).** Done when:
   `GET /api/settings/export` streams rows instead of materializing whole
   tables via `.all()`. Not evaluated further here — out of this plan's
   scope per §2's split-out recommendation; if the PM/architect wants
   acceptance criteria for it, treat it as a one-line separate follow-up,
   not part of this document's criteria set.

## 4. Priority & impact

- **Who is/was blocked:** No one, in the forward-looking sense — this is
  retroactive. But in the process sense: the *pipeline itself* was
  "blocked" from having visibility into this work, which is the actual
  problem this intake exists to close. That's the entire urgency driver
  here, not user-facing urgency.
- **Visibility:** High. `/focus` is a new top-level nav entry seen every
  session, same as `/focus-calendar` was flagged as high-visibility in the
  prior item. The AI-summary feature is also directly stakeholder-facing
  (a "Summary" block on the page) — if it silently produces wrong or
  misleading bullets, that's the same trust-erosion risk
  `focus-report-fidelity` was opened to fix, just in prose form instead of
  a bar chart.
- **Urgency for the retroactive documentation itself:** Medium — nothing
  is on fire (everything shipped and is presumably working, since Sara has
  been actively using and iterating on it across five more commits after
  the two catalogued items), but every commit since without a paired
  intake compounds the exact "process is missing" gap `team-status`
  flagged, and DERIVED-DUAL-VIEW recurring a third time (see below) is a
  live, unmitigated risk, not a hypothetical one.
- **Impact if under-scoped now:** If this retroactive plan treats all
  seven commits as uniformly low-stakes "just document what shipped," it
  will miss that two real, unresolved risks are sitting in production
  right now: (a) no confirmed cross-view parity test between
  `/focus-calendar` and `/focus` for the same underlying numbers, and (b)
  no test coverage found for `HourWindowZoomBar.tsx` /
  `useHourWindowZoom.ts` (I checked; `FocusPage.test.tsx` and
  `FocusActivityCard.test.tsx` exist, but no test file matching
  `HourWindowZoom*` exists anywhere under `client/src`). Both should be
  named as concrete follow-up items in the technical plan, not left
  implicit.

## 5. Stakeholder questions (need Sara's sign-off)

Since this is retroactive and the code is already live, none of these
block "documenting" the plan — they're things that should go back to Sara
for explicit acknowledgment so the record is honest about what was and
wasn't a deliberate, reviewed decision:

1. **Confirm the `/focus` page (as a second, separate route alongside
   `/focus-calendar`) was an intentional product decision, not scope
   drift** — since no decision log entry exists for it the way DEC-1
   covered the original calendar page. Recommend adding a retroactive
   decision entry once confirmed (see §2), purely for the historical
   record — not asking permission to keep something already shipped and
   in daily use.
2. **Confirm the AI-summary feature's ongoing LLM-cost/latency tradeoff is
   accepted** — `DASHBOARD_FOCUS_SUMMARY_MODEL` defaults to a stronger
   model (`sonnet`) than the per-session classifier's cheap default
   (`haiku`) specifically because this is stakeholder-facing prose. Worth
   Sara explicitly confirming she's comfortable with that cost profile
   (mitigated by digest-gated caching, which is a real mitigation, not
   just described intent — confirmed in `ARCHITECTURE.md`) now that it's
   live, rather than this being an implicit default nobody signed off on.
3. **Does the bundled settings-export streaming work in `60af828` need
   its own retroactive record, or is "flagged and scoped out here" 
   sufficient?** My recommendation is the latter (§2) — a one-line
   process note, not a design doc — but this is Sara's call since it's
   her own commit-hygiene pattern being flagged.
4. **Should DERIVED-DUAL-VIEW be formally catalogued in
   `PROJECT-CONTEXT.md` now, given this is the pattern's third live
   occurrence on this exact surface** (once flagged reactively in
   `focus-report-fidelity`, once flagged preemptively and mitigated in
   `focus-calendar-board`'s PM plan via the "extract, don't copy"
   mandate, and now recurring again — `FocusPage.tsx`'s own code comments
   say it "mirrors `FocusReportBody`'s exact formula" rather than
   importing and reusing it directly, which is precisely the copy-not-share
   shape the prior PM plan warned against)? This is a PM-level call per
   the brief's own framing, but I'm flagging it here with concrete
   evidence (comment-level mirroring instead of shared-helper reuse in
   `FocusPage.tsx`) rather than leaving it abstract, since it directly
   affects whether acceptance criterion 4's cross-view parity check in
   §3 should be a one-time QA pass or a permanent standing test (the
   pattern `focus-calendar-board`'s own PM plan already prescribed and
   which should have been applied here too).
5. **Retroactive regression coverage** for the stack-overflow fix
   (large-interval-count case) and the hour-window zoom control
   (`HourWindowZoomBar.tsx`, `useHourWindowZoom.ts`) — both currently
   unconfirmed/absent per §3-4 above. Recommend `team-qa` pick this up as
   a concrete backlog item, not close it as "already fine" without
   checking.

## Summary judgment

All seven commits are in scope for the focus-reporting mission; none
contradicts a signed-off decision. Two items (`31927e2`'s new `/focus`
page, `b930824`'s AI summaries) are new-feature-shaped additions that
shipped without the same decision-log discipline DEC-1..DEC-6 got for the
original calendar page — retroactively document them as decisions, don't
just log them as commits. The bundled settings-export streaming in
`60af828` should be split out of this plan's design scope entirely and
noted only as a minor process gap. The DERIVED-DUAL-VIEW risk is real and
recurring a third time on this exact surface — evidenced concretely in
`FocusPage.tsx`'s own comments — and is the single highest-value thing
for the PM to act on out of this whole retroactive pass.
