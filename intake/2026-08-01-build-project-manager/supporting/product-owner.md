# Product Owner Assessment — Build the Project Manager (Layers 4–6)

Intake: `intake/2026-08-01-build-project-manager/` · Date: 2026-08-01 · PO pass

Source: `request-brief.md` (distilled ask) and the full design notes at
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/pm.md` (verbatim
design-conversation record this brief was cut down from). I also read the
two auto-memory entries pm.md is derived from
(`project_portfolio-reconciliation-vision.md`,
`project_holistic-focus-history.md`) and spot-checked the code claims in
pm.md against `server/db.js` (`plan_items` schema, `declared_done_at`
column — confirmed present) and `server/lib/session-liveness.js` (fail-safe
hard-rule precedent — confirmed, its own file header states "whenever the
probe cannot produce a trustworthy answer it reports `available: false`").

**A framing note before anything else, because it changes how every section
below should be read:** this is a solo-operator dashboard. Sara is
simultaneously the requester, the sole stakeholder, and the sole end user.
There is no separate "customer" whose needs might diverge from the
person authoring the request — so this assessment is not adjudicating
between competing interests, it's checking the request against Sara's own
already-recorded intent (pm.md, the two memory entries, CLAUDE.md's mission
statement) for internal consistency, and flagging anywhere a build choice
would quietly narrow her stated intent without her explicit say-so.

## 1. Value & intent

**What Sara actually wants:** relief from a specific, named pain — at
12-20 concurrent sessions across 8-10 projects, she can no longer answer
"what are we building, are we on track, what did the last hour accomplish,
how do detours map back to intent" without manually rotating through every
session. That manual rotation "hits a hard scalability wall and is
exhausting" (her own words, pm.md line 11-17, repeated verbatim in the
brief). The ask is not a nice-to-have UI — it's a coping-mechanism failure
at her current concurrency level.

**Why layers 4-6 specifically, not the whole 7-layer stack:** pm.md is
explicit that layers 1-3 are already built and layer 7 is a thin rendering
problem deliberately deferred until layer 6 produces real verdicts to feed
it ("a static rollup of raw counts... was considered as a quick v1 but
explicitly set aside in favor of building the reconciliation pass first" —
pm.md L93-95). Layer 6 (the reconciliation pass) is named directly as "the
actual missing piece, and the recommended build priority" (pm.md L65). The
brief's scoping to 4-6 only is therefore not an arbitrary slice — it's
Sara's own prioritization, made explicitly and prior to this intake, not
something the intake process is inventing on her behalf. Building 4-6
without 7 is coherent: a reconciliation pass that quietly resolves routine
cases and surfaces only real decisions is useful on its own (via API/CLI)
even before there's a rollup UI to view it in.

**Mission fit (CLAUDE.md: "maintain a reliable local-first dashboard for
Claude Code session monitoring"):** yes, but worth naming precisely what
kind of fit this is. The existing mission statement is about *monitoring* —
observing and reporting session state. This request asks for something a
step beyond pure monitoring: a component that *acts* (proposes/records
dispositions, decides what needs escalation) using LLM judgment, not just
displays. That's consistent with precedent already shipped in this exact
codebase (`focus-summary.js`'s LLM pass over session context, cited as
literal precedent in pm.md itself) — so it is not a foreign capability
being grafted on. But it is a genuine expansion of what "monitoring" means
in practice: from "tell me what happened" to "decide some things for me and
tell me only what you couldn't decide." That expansion is *exactly* what
Sara asked for in the original problem statement ("without requiring a
human to babysit every session" — pm.md L23), so I'm not flagging it as
scope creep — I'm flagging it so the technical-plan stage treats
layer 6's LLM-driven disposition logic with the same weight as any other
autonomous-action feature (see §5 below on sign-off), not as "just another
inference pass like focus-summary."

## 2. Scope check

**No PROJECT-CONTEXT.md scope-decision doc names a formal source-of-truth
set for this feature area** — the current `PROJECT-CONTEXT.md` only
documents repo topology and two recurring-defect-class patterns (9.1
DERIVED-DUAL-VIEW, 9.2 row-id-as-chronology-proxy), both correctly flagged
as relevant by the brief already. For this specific request, the closest
things to a source-of-truth/sign-off record are:

- `pm.md` itself — Sara's own working notes, explicitly marked as design
  notes not a spec, but containing one item stated as a **confirmed
  decision**, not an open question (see below).
- The two auto-memory entries it was distilled from
  (`portfolio-reconciliation-vision`, `holistic-focus-history`) — per
  pm.md's own instruction, "keep them in sync if either changes
  materially" once this work lands.

**In scope, no contradiction found.** The brief's scoping to layers 4-6
only, excluding 1-3 (built) and 7 (deferred), matches pm.md's own layer
marks exactly — I independently re-checked each layer's stated status in
pm.md against the brief's characterization and found no mismatch (layer 4
"half-built," layer 5 "does not exist yet," layer 6 "the actual missing
piece," layer 7 "deliberately deprioritized" — all quoted correctly).

**One thing that functions as an approved decision, not just an
assumption, and must not be re-litigated during build:** pm.md states,
verbatim, "**Decided (confirmed):** hybrid escalation, not uniform" for
layer 6 — fixed rules decide *whether* to escalate (pace vs. target date,
detour-volume ratio), an LLM judgment pass decides *what a detour is* once
flagged (fold in / new item / deliberate deviation / discard). This is
phrased as already-settled, the same register as the 7-layer framing
itself ("explicitly confirmed by Sara"). The brief already calls this out
correctly as a compliance constraint. I'm elevating it here because it's
the one place in this request where "is this in scope" and "does this
match what was actually decided" are the same question with real teeth:
an implementation that inverts it (LLM deciding whether to escalate, rules
attempting to classify detour type) would not be "a different but
reasonable interpretation" — per pm.md's own language, it's simply
non-compliant with a decision Sara already made. Flag this explicitly to
the architect and engineer, not just as a design preference.

**The four "non-blocking" open questions in the brief are genuinely
open** — I re-checked pm.md's own "Open questions / not yet decided"
section (L168-186) and confirmed all four (detour entity representation,
reconciliation output/escalation format, target-date field shape, process
shape for the pass) are stated there as undecided, not settled-then-
forgotten. The brief's proposed default assumptions for each are
reasonable starting points (durable record over recompute-on-read for
detours; manual `plan_items` field for target date, matching
`declared_done_at` precedent — confirmed that column exists in
`server/db.js`; minimal queryable output for layer 6 rather than
over-building for the deferred layer-7 UI) and I have no objection to
carrying them into the architecture/engineering evaluation as starting
points, not commitments requiring separate sign-off — provided the
architect states each choice explicitly with tradeoffs, as the brief
already requires.

## 3. Acceptance criteria ("done when...")

These are user-facing and testable, framed for a solo operator who is both
the stakeholder and the one who will judge "does this actually help."

**Layer 4 — detour/discovery disposition**
1. Every undeclared (off-plan) chunk of session time that focus-inference
   already classifies gets a resolved disposition — one of: folded into
   the plan as a new milestone, spun into a new plan item, logged as a
   deliberate accepted deviation, or discarded as noise. Done when: no
   detour remains permanently in an "observed but undecided" state once
   the reconciliation pass has run over it at least once.
2. The disposition is queryable independently of re-deriving it from raw
   session/event data — i.e., re-running the reconciliation pass on
   already-dispositioned time does not silently re-flag or duplicate a
   decision already made. (This is the architect's call on entity shape
   per the brief's open question #1, but the user-facing behavior — "once
   decided, stays decided until something changes" — is the acceptance bar
   regardless of which storage shape is chosen.)
3. A detour that gets folded into the plan or spun into a new item is
   visible in the same place Sara already looks at plan progress (existing
   `plan_items`/`PlanPanel` surface) without a separate lookup step —
   consistent with layers 1-3 already being the source of truth for "what
   are we building."

**Layer 5 — pace tracking**
4. A plan item can carry a target/expected-completion date. Done when:
   for any item with a target date set, the system can answer "on track /
   behind / stalled" by comparing the target against either
   `declared_done_at` (if complete) or current time (if not), with no
   manual arithmetic required from Sara.
5. Pace status is derived from the same fixed-rule logic every time — no
   LLM judgment involved in the pace calculation itself (this is the
   layer-6 hybrid-escalation constraint reaching down into layer 5's own
   acceptance bar: pace is a "measurable threshold," per pm.md's own
   language, so it must stay in the deterministic half of the split).

**Layer 6 — the reconciliation pass**
6. The pass runs periodically per project (not continuously) without
   Sara triggering it manually per project per check-in — done when she
   can walk away from a project for a work session and come back to find
   its detours dispositioned and its pace status current, without having
   opened that project's session at all.
7. **Escalation split is observably hybrid, not uniform** — done when a
   test/audit can show: (a) pace-vs-target-date and detour-volume-ratio
   decisions are made by fixed, inspectable rules with no LLM call
   involved, and (b) the LLM is invoked only for classifying what a
   flagged detour actually is, never for deciding whether something
   should be escalated at all. This is directly testable (mock/stub the
   LLM call path and confirm rule-based decisions are unaffected) and
   should be a concrete QA acceptance test, not just a code-review
   spot-check.
8. **Signal, not noise, at the human layer** — done when routine cases
   (on-pace, low-volume detours, clearly-classifiable detours) resolve
   quietly with no interruption, and only genuinely ambiguous or
   out-of-band cases surface to Sara. This is the actual point of the
   whole request (pm.md L23: "the human should only get pulled in for
   architecture calls, UX/acceptance judgment, or 'this doesn't feel
   right'") — if the reconciliation pass surfaces routine, obviously-
   resolvable cases as often as the current manual-rotation workflow does,
   the feature has not delivered its value regardless of what got built
   underneath. This should be validated empirically against Sara's real
   multi-project fleet before being called done, not just unit-tested
   against synthetic fixtures — the failure mode ("still too noisy to
   trust") is a stakeholder judgment call only she can make, not one QA
   can close on her behalf. See §5.
9. **Fail-safe by design**, matching this codebase's own established
   convention for exactly this class of periodic/rule-based check
   (`server/lib/session-liveness.js`'s own header: "whenever the probe
   cannot produce a trustworthy answer it reports `available: false` and
   the caller must change nothing" — I confirmed this wording directly in
   the file). Done when: if the reconciliation pass cannot get a
   trustworthy read on a project (missing data, LLM call failure, process
   crash mid-run), it does nothing and leaves prior state untouched rather
   than guessing — no detour gets a wrong disposition and no false
   pace-alarm fires because of a transient failure. This should be a named
   test case, not an implicit hope.
10. **DERIVED-DUAL-VIEW compliance** (per the brief's own flag, and per
    `PROJECT-CONTEXT.md` 9.1, now on its 4th+ citation in this project's
    history): if any value layer 6 computes (pace status, detour
    disposition, decision-queue entry) ends up rendered in more than one
    place, it must come from one shared computation/component, not
    hand-copied logic, enforced by a cross-consumer test per this
    project's own established acceptance criterion for this exact pattern.
11. **9.2 row-id-as-chronology-proxy compliance**: any query the
    reconciliation pass runs over `events` or other bulk-inserted tables to
    determine "recent" sessions/detours must sort by `created_at`
    explicitly (id as tiebreak only), matching this project's own fix
    history (3 prior live instances in adjacent focus-inference code, per
    PROJECT-CONTEXT.md). This should be a concrete code-review checklist
    item at the PR stage, not left to memory.

## 4. Priority & impact

- **Who is blocked:** Sara, directly and currently — this isn't a
  speculative future need, the problem statement is present-tense ("when
  running 12-20 concurrent sessions... it becomes very difficult"). She is
  both the sole user and the one bearing the cost of the current workaround
  (manual session-by-session rotation, described as "exhausting").
- **Visibility:** High to the one person who matters here. This isn't a UI
  surface visible to many users where "high visibility" means broad
  exposure — it's high-stakes because it directly replaces a workflow Sara
  currently does by hand, multiple times, across every active project.
  If layer 6 is unreliable or noisy, she will simply fall back to manual
  rotation and the feature has failed regardless of code quality.
- **Urgency rationale:** Real but not fire-drill urgent. Sara has been
  operating without this layer up to now (the workaround, while exhausting,
  is evidently sustainable enough that this reached intake via a
  considered design conversation rather than an emergency ask). Combined
  with pm.md's own explicit flag that this is "substantial enough to
  warrant a short plan before broad edits" (schema changes + a new
  scheduled-agent component), I'd frame priority as: important and
  deliberately paced, not rush-shipped. A half-built, noisy reconciliation
  pass that erodes trust (crying wolf, or worse, silently mis-dispositioning
  a detour) is worse than the status quo — get the hybrid-escalation split
  and the fail-safe behavior right before optimizing for speed of delivery.
- **Impact if under-scoped:** If layer 6 is built without the fail-safe
  and DERIVED-DUAL-VIEW/row-id-proxy disciplines this project has already
  had to relearn multiple times (per PROJECT-CONTEXT.md's own citation
  history), the most likely failure mode is not "it doesn't work" but "it
  works most of the time and is wrong in a way Sara doesn't notice until
  much later" — which is strictly worse than the current manual process,
  because manual rotation at least fails visibly (she knows she hasn't
  checked a project) rather than silently (a wrong disposition sitting
  unnoticed in the plan).

## 5. Stakeholder questions (need Sara's sign-off before/while building)

Since Sara is both requester and sole stakeholder, these aren't
"who external needs to approve this" — they're places where a build
decision would either lock in something she hasn't explicitly weighed in
on yet, or where only she can judge "does this actually solve my problem"
once something exists to try.

1. **Confirm the hybrid-escalation split stays exactly as decided** (rules
   decide whether to look, LLM decides what a detour is) through
   implementation — this is already stated as confirmed in pm.md, but
   given it's the single highest-leverage design constraint in the whole
   request, worth an explicit "yes, still holds" before the architect
   finalizes layer 6's control flow, since an architecture review might
   surface a tempting shortcut (e.g., "let the LLM just decide everything
   in one call") that would quietter-violate this without anyone noticing
   until later.
2. **The four genuinely-open questions from pm.md need an actual decision
   recorded somewhere durable**, not just carried forward as assumptions
   through the technical plan: detour entity representation, reconciliation
   output/escalation format, target-date field shape/authorship, and
   process shape (`/loop` vs. cron agent) for the pass. The brief's
   proposed defaults are reasonable, but per this project's own convention
   (see the `focus-calendar-board`/`decisions.md` pattern used in prior
   intakes), these should land as explicit DECIDED entries once the
   architect commits to them — not silently inferred from "the brief didn't
   object." Recommend the PM stage produce a `decisions.md` for this intake
   the same way `focus-calendar-board` did.
3. **What does "not noisy" mean in practice, concretely enough to test?**
   Acceptance criterion 8 above (signal not noise) is the actual point of
   this whole request, but it's inherently a taste/trust judgment only
   Sara can make by actually using the reconciliation pass against her
   real fleet for some period. Recommend the PM plan build in an explicit
   "trial period against live projects, Sara reviews the decision-queue
   output before this is called done" step, rather than treating a passing
   test suite as sufficient sign-off for this specific criterion.
4. **Memory sync obligation** — pm.md explicitly says to keep
   `portfolio-reconciliation-vision` and `holistic-focus-history` in sync
   "if either changes materially." Once layers 4-6 are built, both memory
   entries will be materially stale (they currently describe 4-6 as
   missing/undesigned). Confirm this update happens as part of this
   effort's own close-out (likely via `/librarian`), not deferred
   indefinitely — flagging now so it isn't lost between the design-notes
   file and the eventual delivery record.
5. **Scope-boundary confirmation for layer 7**: the brief and pm.md both
   treat layer 7 (portfolio rollup UI) as explicitly out of scope/deferred.
   Worth a one-line explicit confirmation from Sara at kickoff that no
   partial layer-7 UI work (e.g., "just add a decision-queue badge since
   we're already touching this area") creeps in opportunistically during
   build — the same kind of quiet scope-widening this project's own
   retroactive intake (`2026-07-31-focus-untracked-commits`) had to
   document after the fact for a different feature.

## Summary judgment

In scope, and a direct, well-evidenced response to a real, current pain
Sara described in her own words — not speculative scope growth. The
request builds on already-shipped precedent in this exact codebase
(fixed-rule liveness checks, LLM-driven focus summaries) rather than
inventing a new capability class from nothing. The one place this needs
active protection during build is the confirmed hybrid-escalation split
(rules decide whether, LLM decides what) — treat any deviation from it as
non-compliant, not a valid alternative. The one place "done" can't be
fully verified by tests alone is acceptance criterion 8 (signal vs. noise)
— that needs an explicit live-trial checkpoint with Sara before this is
called complete, since she is simultaneously the stakeholder who defines
"done" and the only person positioned to judge it.
