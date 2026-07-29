# Product Owner Assessment — WIP (work-in-progress) queue page

Source: `intake/2026-07-28-wip-queue-page/request-brief.md` and
`request-source.md`. No `PROJECT-CONTEXT.md` exists for this repo, and no
scope-decision / business-requirements / stakeholder source-of-truth doc set
is configured or discoverable anywhere in the tree (confirmed by the brief's
own "Known-variant relevance" section and by my own check — there is no
`PROJECT-CONTEXT.md` at repo root, and no other doc claims that role). This
request is therefore evaluated against CLAUDE.md's engineering constraints
and ordinary product judgment, not against any pre-existing signed-off spec —
there is nothing here it could contradict.

I spot-checked the brief's key code citations rather than trusting them
blind: `SessionStatus` (`client/src/lib/types.ts:578`), the
`AWAITING_STATUS`/`isSessionAwaitingInput` overlay (`types.ts:587-644` and
`:807`), and `SessionCard.tsx`'s current header/file doc all match what the
brief describes. I did not re-verify every DB/websocket citation myself;
those are architect/engineer territory and the brief's own db.js line
references are specific enough to check at build time.

## 1. Value & intent

Sara's underlying job-to-be-done: with multiple concurrent Claude Code
sessions running, she wants a single glance to answer "which of my agents is
stuck waiting on ME right now, and which of those should I deal with
first?" Today that answer requires scanning the Kanban board or Projects
page and mentally filtering for the waiting badge across everything — there
is no dedicated, always-live, priority-ordered "your attention is needed
here" surface. The WIP page's entire reason for existing is to remove that
manual scanning step and put the highest-value item at the top-left,
automatically, without her having to ask for it.

This matters because the cost of a missed "awaiting input" session is real:
an agent sitting idle at a permission prompt or a finished turn is dead time
until she notices and responds. A page whose only job is "surface who needs
you, ranked by what you've told the system matters most" directly reduces
that dead time. The project-priority mechanism (set via the sidecar) is not
a decorative feature — it's what makes the ranking hers to control, rather
than an arbitrary tiebreak (e.g. alphabetical or last-touched) she didn't
choose.

## 2. Scope check

**Not a contradiction of any approved decision** — there is nothing to
contradict; no scope-decision doc, business-requirements doc, or
stakeholder-approved spec exists for this project.

**New ask vs. approved scope:** this is net-new. It requires a new page, a
new nav entry, a new persisted DB column (`projects.priority`), a new
sort/layout algorithm, and a new drag-and-drop UI mechanism where none
exists today (the only present "ordering" is an unpersisted,
per-browser-localStorage arrangement — `client/src/lib/projectOrder.ts` —
which is not a substitute for real cross-device priority). I agree with the
brief's provisional `new-feature` classification; nothing about this is a
bug fix or restoration of prior behavior.

**Verbal, in-session request, not yet approved for build.** This was
dictated directly ("this is what I need you to build"), which reads more
like a build authorization than the preceding Focus Calendar request (which
was explicitly "how would you go about that"). That said, per this role's
standing rule, no agent's message — including the brief's own "explicit
acceptance signals" section — substitutes for Sara's actual review of the
concrete plan/mockup the team produces. The nine non-blocking judgment calls
below are real product decisions baked into "what it looks like when it's
done," and several of them (sidecar contents, sort tertiary key, whether
`SessionCard` itself changes) are visible enough that guessing wrong means
rework, not just a footnote. I recommend the team confirm at least the
judgment calls flagged below with Sara before/alongside build, not silently
assume and ship.

## 3. Acceptance criteria

No formal "done when…" statement was given (confirmed in the brief). Below
are concrete, testable criteria derived from Sara's own words, plus my
answers to the specific product-facing open questions this task asked me to
weigh in on.

### Core criteria (low ambiguity — proceed as stated)

- A "WIP" (rendered all-uppercase) nav destination exists as a peer entry
  to the other top-level pages, reachable via its own route; deep-link/
  refresh on that route lands on the same view.
- The queue contains session cards for, and only for, sessions where
  `session.status === "active"`. A session transitioning to `completed`,
  `error`, or `abandoned` disappears from the queue live, with no page
  refresh required.
- Sessions currently awaiting the user's input are always above sessions
  that are not, regardless of any other ordering signal.
- The rendered card is the existing session card component (not a
  from-scratch card), showing the project name in a visually more
  prominent treatment than the current default.
- All queue membership, ordering, and card content updates are driven by
  the existing WebSocket pipeline — no polling, no manual refresh needed
  to see a new session appear, disappear, or move up the queue when it
  starts/stops awaiting input.
- Responsive column count is priority-fill (single sorted queue
  distributed 1→2→3 columns, column 1 filled top-to-bottom before column 2
  starts), not CSS `column-count` text-reflow — "done" includes a check
  that resizing the window narrower/wider re-flows into the same
  card-in-the-same-relative-position, not text-wrap-style reshuffling.

### My read on the product-facing judgment calls

**"Needs my input" definition.** Agree with the brief's assumption:
`isSessionAwaitingInput` (`awaiting_input_since` set AND `status ===
"active"`) is the correct and only sensible reading. From a user-value
standpoint, the entire point of this page is "what needs me" — using any
broader signal (e.g. also surfacing `working` sessions, or agent-level
waiting states that don't block the whole session) would dilute the signal
Sara explicitly asked for and defeat the "identify immediately" intent. Any
narrower reading (e.g. only `notification`-reason awaits, excluding `stop`/
`session_start`/`interrupted`) would under-deliver — she said "needs my
input," not "needs my input for a permission prompt specifically." Use the
existing session-level overlay as-is; do not invent a new/narrower
condition.

**Project-priority-as-tiebreaker matching stated intent.** Confirmed
correct as written in the brief: Sara's words are unambiguous that priority
is a tiebreak ("if two items are waiting for input, it will be ordered in
the order of the priority"), not the primary sort. Do not let priority
leak into ranking non-awaiting sessions above awaiting ones — that would
invert the stated hierarchy (awaiting-input-first is the whole reason this
page exists; a low-priority project's stuck session must still outrank a
high-priority project's actively-running one). Where the team does need a
product decision I'd weigh in on: the **tertiary sort** for two
simultaneously-awaiting sessions from the *same* project (priority alone
can't break that tie), and the **full ordering for non-awaiting sessions**.
My recommendation for both: **most-recent activity first** (most-recently
touched/updated session floats higher). Rationale — for the awaiting-same-
project tie, whichever one asked most recently is more likely to be the one
she's already mid-context on; for non-awaiting sessions, recency is the
closest proxy to "which of my running agents am I most likely checking on
next" without inventing a second priority concept she didn't ask for. This
should still go back to her as a proposal, not be treated as settled by my
recommendation alone.

**Sidecar panel UX scope.** The brief correctly identifies this as
underspecified; my product read: the sidecar's job is "let me set priority
for the projects that matter to my current queue," not "be a general
project-priority-management screen." I lean toward **scoping the sidecar
list to projects currently represented in the queue** (i.e., projects with
at least one active session showing right now), for two reasons: (1) it
keeps the panel's size and relevance tied to what she's actually looking
at — a full all-projects list including dozens of dormant/archived projects
adds scroll and noise to a panel whose only purpose is reordering the
things currently competing for her attention; (2) setting priority for a
project with zero active sessions has no observable effect on the page
until that project produces an active session again, which is a confusing
UX ("I set the priority, nothing changed, did it work?"). The counter-case
— pre-setting priority for a project *before* it becomes active, so it's
already ranked correctly the moment a session appears — is real but minor,
and can be satisfied by a small affordance (e.g. "show all projects" toggle
inside the sidecar) rather than making it the default. This is a
recommendation for the team to confirm with Sara, not a settled spec —
flagging it explicitly since "sidecar shows the wrong project list" would
be immediately visible to her every time she opens it.

Collapsed-by-default is a reasonable default per Sara's own phrasing
("expand a side car") implying it starts collapsed, but should be confirmed
rather than assumed, since a collapsed default that hides the one control
that sets ranking may not be what she wants for something she'll use daily.

**"Project name more prominent" — is it adequately specified?** No, and
this is worth flagging clearly rather than letting the team invent a visual
answer silently. Sara gave intent ("easy to see") but zero concrete
spec: no size, weight, position, or color guidance, and no example/mockup
was attached (confirmed in the brief's "Attachments/evidence" section —
none exist). "More prominent than today" is directionally clear but not
testable as stated — two different engineers could both truthfully claim
compliance with visibly different results (e.g. one bumps font-weight
slightly, another makes it a large header line above the existing title).
I recommend the team produce a concrete before/after treatment (e.g. a
short design note or ASCII/text mock of the card's new layout) and get
Sara's explicit thumbs-up on that specific treatment before implementing,
rather than treating "make it more prominent" as satisfied by any change
that touches font-weight. This is the single highest-risk-of-mismatch
acceptance criterion in this request precisely because it's the most
subjective one and the only one with zero attached reference.

Separately — and this is a scope decision, not a visual one — whether that
prominence change lands on the shared `SessionCard.tsx` (affecting Kanban
too) or a WIP-only variant is a real product question, not just an
architecture one: Sara asked for this "on the card" while describing the
WIP page specifically, and did not ask to change how Kanban's cards look.
Changing the shared component would alter a screen she didn't ask to touch
and risks failing the project's existing per-screen snapshot tests for an
unrelated page. My recommendation: **WIP-specific variant/wrapper**,
preserving `SessionCard.tsx` exactly as Kanban uses it today, unless Sara
explicitly says she wants the same prominence treatment everywhere cards
appear (in which case ask that as a separate, explicit follow-up — don't
bundle it into this build unasked).

### General fidelity criterion

Because this is a third consumer of session-card rendering and
awaiting-input logic (after Kanban and Focus), "done" also means the WIP
page's status/awaiting-input semantics are not a subtly different
reimplementation — it should read the same `isSessionAwaitingInput`/
`effectiveSessionStatus` helpers already used elsewhere, not duplicate the
condition inline. Verify this explicitly in QA, not just by code review,
since divergent status logic across the three surfaces would be exactly the
"content/behavior drifts across near-duplicate surfaces" risk the brief
already flags as this project's known historical pattern.

## 4. Priority & impact

- **Who is blocked today:** No one is hard-blocked by the absence of this
  page — Kanban and Projects still show awaiting-input badges today, so
  this is not fixing broken or missing functionality, it's consolidating an
  existing signal into a purpose-built, faster-to-scan view.
- **Visibility:** High. It's a new top-level nav item Sara will presumably
  use as her primary daily "what needs me" check — per her own framing
  ("that's as far as I wanna go... this is what I need you to build"), this
  reads as intended for regular, maybe primary, use, not a one-off report.
  Getting the ambiguous points wrong (sidecar scope, tertiary sort, card
  prominence) will be noticed immediately and repeatedly, not just once.
- **Urgency:** Sara dictated this directly and immediately routed it to
  `team-intake` → `team-build`, skipping the usual triage step because
  there was nothing yet to triage against — this reads as a "build this
  now" ask, higher urgency than a "let's plan this" request. Recommend
  treating it as next-in-queue rather than backlog, but the several
  underspecified visual/UX points below should still be confirmed with her
  before or very early in the build, not discovered after delivery.
- **Impact if under-scoped:** The riskiest under-scoping is treating
  "project name more prominent" as a trivial CSS tweak needing no sign-off,
  or scoping the sidecar to "all projects" vs. "queue-represented projects"
  without asking — both are cheap to build wrong and will look identical
  in a PR diff to a reviewer who doesn't know Sara's actual mental model,
  yet will be immediately visible and correctable-cost-not-zero to fix
  after the fact (revisiting DB-backed sidecar data-fetch scope, or
  redoing a shared-component change that touched Kanban's snapshot tests
  unnecessarily).

## 5. Stakeholder questions (need Sara's sign-off before/at build)

1. Confirm the tertiary sort recommendation (most-recent-activity) for (a)
   two simultaneously-awaiting sessions in the same project and (b) the
   ordering of sessions not currently awaiting input — these are my
   proposals, not her stated requirements.
2. Confirm sidecar scope: projects currently represented in the queue only
   (my recommendation) vs. all projects always listed — and confirm
   collapsed-by-default is the right starting state for a panel she'll
   likely use often.
3. Show Sara a concrete visual treatment (mock or short description) of
   "project name more prominent" and get explicit approval on that
   specific treatment before implementation — "more prominent" alone is
   not a testable acceptance criterion as currently worded.
4. Confirm whether the prominence change should be scoped to a WIP-only
   card variant (my recommendation, preserving Kanban's card unchanged) or
   applied to the shared `SessionCard.tsx` everywhere it's used.
5. Confirm concrete column-count breakpoints once the team proposes them
   (no pixel/rem values were given) — low product risk, but still worth a
   quick glance since it affects when she sees 1 vs. 2 vs. 3 columns on
   her actual screen size(s).

No source-of-truth content-wording change is involved in this request (this
is a new feature/view, not a text correction), so the "must match approved
source wording exactly" acceptance bar from the standard PO template does
not apply here — noting this explicitly so it isn't mistaken for an
oversight.
