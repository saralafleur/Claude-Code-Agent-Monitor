# Request Brief: AI-generated stakeholder summary card for session transcripts

## Raw ask (verbatim)

> For each session where we have a transcript, run a prompt against it asking
> "what did we do and what is next" and have it return a brief, high-level
> **stakeholder summary** (not an engineering-detail summary — something a
> non-technical stakeholder could read). Each time a session is opened and it
> does not already have that summary, show a card **above the transcript**
> that first indicates it's preparing the summary, then shows the result once
> generated. Reuse the existing "build prompt" mechanism already used
> elsewhere in this app to run a prompt like this — don't build a new one
> from scratch.

Location framing, verbatim: "the individual person's card > Sessions >
expand a session."

## Restated ask

When a user opens a session that doesn't yet have a cached AI-generated
summary, show a card above the transcript that shows a "generating" state
and then displays a short, non-technical "what we did / what's next"
summary — reusing the repo's existing `runClaudePromptJson` CLI-spawn
mechanism (same shape as the already-merged Value Pool `value-summary`
feature) rather than building a new LLM-invocation path.

## Requester / source

Sara, verbal, 2026-08-06. Captured into
`requests/2026-08-06-session-stakeholder-summary/request.md`, which already
includes an in-session investigation (by whoever filed the request) of the
codebase to pre-resolve terminology and identify precedent/reuse targets.
Note: this source document is materially more pre-digested than a typical
raw request — it already names exact files, line ranges, and a recommended
default for the one ambiguity it flagged. Intake is treating it as the
primary evidence but is not re-verifying every cited line/file itself
(that is evaluation/architecture's job).

## Surface / area touched

Session detail view — specifically `client/src/pages/SessionDetail.tsx`'s
"Conversation" tab, above the mounted `ConversationView`
(`client/src/components/conversation/ConversationView.tsx`). Server side:
a new synthesis layer modeled on `server/lib/value-summary.js` +
`server/lib/value-summary-tick.js`, reusing `runClaudePromptJson` from
`server/lib/focus-inference.js`, plus a new cache table in `server/db.js`
(no existing `sessions` column holds this).

## Known-variant relevance

This repo's `PROJECT-CONTEXT.md` names several recurring defect classes
(confirmed present, §9.1 through at least §9.8+). Two are directly named
by the request itself and are load-bearing for how this should be
evaluated/built, not just background:

- **§9.1 DERIVED-DUAL-VIEW** (confirmed section, 7+ occurrences to date):
  a derived/summary value computed once and consumed by more than one
  client surface must share its fetch/format logic via an extracted
  hook/component from the *second* consumer's introduction, not
  hand-copied. The request pre-flags this explicitly: if the session
  summary is ever also rendered as a Board-card badge or similar, this
  applies from that second consumer's day one.
- **§9.8 OVERLOADED-ASENCE** (confirmed present at line 1645 in
  `PROJECT-CONTEXT.md`, title: "distinguishable outcomes collapsed into one
  absent value"): the request explicitly requires a three-state contract
  (generating / queued-behind-other-work / unavailable) rather than a bare
  boolean/undefined loading flag, citing this pattern by name and pointing
  to `PlanLedgerPanel.tsx`'s `AltitudeText` as the precedent shape to
  follow.

Both are already incorporated into the request as constraints, not left as
open questions — flagging here so evaluation/architecture treat them as
binding, not optional nice-to-haves.

## Provisional request type

`new-feature` (PROVISIONAL — PM makes the final call). This is net-new
functionality (a new synthesis layer, new cache table, new UI card); it is
explicitly modeled on a recent sibling feature (`effort/2026-08-04-value-summary-tick`)
but is not a fix to that feature or a missed requirement of it.

## Attachments / evidence

No screenshots or example transcripts attached. The request document itself
functions as the evidence bundle: it cites specific files/line ranges as
precedent (`server/lib/focus-inference.js`, `server/lib/value-summary.js`,
`server/lib/value-summary-tick.js`, `client/src/components/PlanLedgerPanel.tsx`
~lines 433–458, `server/db.js` `sessions` table columns and
`value_unit_summaries` shape ~lines 835–860) and states a confirmed data-model
gap (no summary column, no persisted transcript text server-side).

## Explicit acceptance signals

None stated as formal "done when" criteria. The closest is behavioral,
from Sara's own framing: "each time we pull in a session and it does not
have that quick analysis... it will say... preparing... then show the
result" — i.e., done when opening a session with no cached summary reliably
shows a generating state and then the synthesized result without a page
reload or manual refresh.

## Open questions

### BLOCKING

None. The one genuine ambiguity in the source material (see below) ships
with a stated default and an explicit note that it's a reasonable working
assumption for evaluation to proceed on, not a decision that blocks
scoping/architecture work from starting.

### Non-blocking (proceed with stated assumption)

1. **"Person's card" vs. actual click path.** Sara's verbal framing ("the
   individual person's card > Sessions > expand a session") does not match
   any existing concept in the codebase — no `PersonCard`/assignee-grouping
   surface exists today. The actual path is
   `AgentCard.tsx`/`SessionCard.tsx` (on `KanbanBoard.tsx` / `Projects.tsx`)
   → `SessionDetail.tsx` → Conversation tab → `ConversationView.tsx`.
   **Assumption for this brief and downstream evaluation:** "person's card"
   is loose/informal framing for this existing session-open flow, and the
   summary card slots into `SessionDetail.tsx` directly above the mounted
   `ConversationView` in the Conversation tab. This is *not* a request for a
   new per-person/assignee grouping surface as a prerequisite. If that
   reading is wrong, the correct-scope confirmation should happen with Sara
   before implementation, not before evaluation — the assumption is
   specific and cheap to invalidate later, and blocking triage on it would
   stall investigation of a request whose engineering shape (synthesis
   layer + cache + card) is unaffected either way.

2. **Trigger model — on-demand vs. background sweep.** Two candidate
   designs are laid out in the source doc (view-triggered on-demand
   generation vs. a `value-summary-tick.js`-style background sweep over
   ended sessions). The source recommends on-demand-only for this request's
   scope, reading Sara's phrasing as (1), with background sweep as a
   possible fast-follow. Flagging as a decision for evaluation/architecture
   to make explicitly (not assume silently), per the source document's own
   framing — not a blocker to starting evaluation.

3. **Staleness / invalidation story for the cached summary.** No column
   exists today; the source proposes "only summarize once a session has
   ended / gone stable" as a simplifying constraint versus a
   digest-based invalidation scheme, and floats a manual "regenerate"
   affordance as an alternative. Needs a decision during
   evaluation/architecture, not a hard blocker.

4. **Model tier.** `haiku` is proposed as the working-hypothesis default
   (per the existing `summaryModel(stage)` tiering convention in
   `value-summary.js`), explicitly flagged as "confirm during evaluation."
   Non-blocking.

## Constraints / carry-forwards (from source, binding unless evaluation
## finds cause to revisit)

- Reuse `runClaudePromptJson` (`server/lib/focus-inference.js`) — no second
  LLM-invocation path, no `@anthropic-ai/sdk` or hosted-API dependency.
- Model the synthesis layer on `server/lib/value-summary.js` (cache table +
  `buildPrompt()` + `parseOutput()` + orchestrator pattern) and, if a
  background component is built, `server/lib/value-summary-tick.js`'s
  scheduler shape.
- Client "generating" placeholder pattern should follow
  `PlanLedgerPanel.tsx`'s `AltitudeText`, flipping to real text on a
  WebSocket event rather than polling.
- Summary register must be genuinely "high-level stakeholder," explicitly
  not an engineering changelog — the prompt design itself should state this
  constraint, contrasted with `value-summary.js`'s existing
  stakeholder-altitude prompt framing as a tone reference.
