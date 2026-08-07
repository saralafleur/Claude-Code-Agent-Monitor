# Product Owner — Session stakeholder summary card

**Mode:** FAST, narrowed mandate per run-plan.md — acceptance criteria +
scope confirmation + sign-off needs. Exhaustive value/prioritization framing
intentionally skipped.

## 1. Value & intent (brief)

Sara wants a fast, non-technical answer to "what happened in this session
and what's next" without reading a raw transcript. Audience is explicitly
**not** the engineer who ran the session — it's someone (Sara herself, or a
stakeholder she shows this to) who needs the gist, not the mechanism. This
only matters if the summary is genuinely readable by someone with no
context on the tool internals; an engineering-flavored recap would fail the
actual intent even if it technically "summarizes."

## 2. Scope check

**Source-of-truth check performed:** This repo has no separate
business-requirements/scope-decision doc distinct from the per-request
`request.md`/`request-brief.md` intake trail and the standing defect
catalog in `PROJECT-CONTEXT.md`. Per-intake `decisions.md` files exist
elsewhere in `requests/` (e.g.
`requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/decisions.md`)
but those are downstream build-time decision logs, not an upstream approved
spec this request could contradict. I searched `PROJECT-CONTEXT.md` and
existing `decisions.md` files for any prior mention of session/stakeholder
summaries — none found. **Conclusion: this is a clean new-feature ask, not
in tension with any prior approved decision.**

**Surface/location assumption — CONFIRMED, not just accepted as default.**
I independently verified the codebase claim rather than trusting the brief's
paraphrase:
- `client/src/pages/SessionDetail.tsx` exists and mounts
  `ConversationView` at line 1292 inside what the file's own comments
  describe as the Conversation tab.
- `client/src/components/conversation/ConversationView.tsx` exists.
- A recursive, case-insensitive search of `client/src` for `PersonCard` or
  `AssigneeCard` returns **zero matches** — no per-person/assignee grouping
  surface exists anywhere in this codebase today.

Given that, "the individual person's card > Sessions > expand a session" has
no literal referent in this app. The only path that matches "expand a
session and see its content" is
`AgentCard.tsx`/`SessionCard.tsx` → `SessionDetail.tsx` → Conversation tab →
`ConversationView.tsx`. **I agree this is the right default reading** —
"person's card" is almost certainly Sara's shorthand for "the card that
represents this session/agent," said loosely rather than naming a distinct
UI concept — and I agree the summary card should mount in
`SessionDetail.tsx` above `ConversationView`.

**However, this is still a content/product-framing decision, not a purely
technical one, and I'm not able to fully close it without Sara.** The
specific risk: if what Sara actually pictures is a rollup that shows
*multiple* sessions' summaries in one place (closer to "here's what this
person/agent has been doing across their sessions" than "here's what
happened in this one open session"), then mounting a single-session card in
`SessionDetail.tsx` satisfies the literal words of the request but misses
the intent. Nothing in the request or request.md rules this out — it's an
absence of evidence, not evidence of absence. **Recommendation: proceed
with the `SessionDetail.tsx`-above-`ConversationView` placement as build
scope (cheap to build, matches the literal click-path, matches the explicit
"above the transcript" instruction which only makes sense for a single
open session), but flag to Sara at the next check-in, in one sentence, that
this is what "person's card" was read as** — so a wrong read surfaces before
more is built on top of it, not after.

## 3. Acceptance criteria ("done when...")

These are the concrete, testable criteria this request lacked. All must
hold for the request to be considered done:

1. **Trigger & placement.** Opening any session in `SessionDetail.tsx`'s
   Conversation tab that has no cached summary immediately shows a summary
   card positioned above the rendered `ConversationView` transcript — not
   below, not in a separate tab, not requiring a click to reveal.
2. **No stale/blank flash.** A session that *does* already have a cached
   summary shows that summary immediately on open — never a generating
   flash before falling back to cached content, and never a blank/absent
   card.
3. **Three-state contract, not a boolean.** The card renders exactly one of
   three distinguishable states at any moment — generating,
   queued-behind-other-work, or unavailable — never a bare
   loading/undefined flag that collapses these. This is a hard requirement
   per `PROJECT-CONTEXT.md` §9.8 (OVERLOADED-ABSENCE), not a nice-to-have:
   a user must be able to tell "still working on it" from "this failed and
   won't retry" from "waiting behind other work" just from the card.
4. **Live update, no reload.** When generation completes, the card updates
   from the generating state to the final summary text without a page
   reload or manual refresh — consistent with Sara's own framing
   ("preparing... then show the result").
5. **Register test — the actual acceptance bar for content quality.** The
   generated text must read as something a non-technical stakeholder could
   understand with zero codebase context: no file names, function names,
   commit/PR references, stack traces, tool names, or internal jargon.
   Concretely: "what did we do" and "what's next," in plain language, in
   roughly the register of a status update you'd give a non-engineer
   manager — not a changelog. This should be spot-checked against at least
   one real, already-ended session's transcript before this is considered
   done, not just accepted on the prompt's stated intent.
6. **Reuse constraint is enforced, not just intended.** The summary is
   produced via the existing `runClaudePromptJson` CLI-spawn mechanism
   (`server/lib/focus-inference.js`) — no second LLM-invocation path, no
   `@anthropic-ai/sdk` or hosted-API dependency introduced anywhere in this
   change. This is directly checkable in the diff.
7. **Persistence.** The summary is cached (new table/column, per the
   confirmed data-model gap) such that re-opening the same unchanged
   session does not re-trigger generation — reinforces criterion 2.
8. **Cross-consumer guard (forward-looking, cheap to state now).** If this
   summary is ever rendered anywhere besides `SessionDetail.tsx` (e.g. a
   future Board-card badge), the fetch/format logic must be shared via an
   extracted hook/component starting from that second consumer's
   introduction — not hand-copied. Not testable today since there is only
   one consumer, but recording it here so it's an explicit "done when"
   for whoever builds the second surface, per `PROJECT-CONTEXT.md` §9.1
   (DERIVED-DUAL-VIEW), a defect class this project has hit 7+ times.

Criteria 1, 2, 4, 6, and 7 are directly, mechanically testable. Criterion 3
is testable via the wire contract (exactly one of three named states, never
zero, never two — per §9.8's own acceptance-criterion language). Criterion
5 is the one genuinely qualitative bar and needs a human read against a
real transcript, not just a green test.

## 4. Priority & impact (brief, per fast-mode scope)

Sara is both requester and sole current user of this surface — she's
blocked from getting a quick read on session status without reading full
transcripts today. No other stakeholder is waiting on this. Not
urgent/blocking in the sense of breaking anything, but it's a real
day-to-day friction reduction she asked for directly and unprompted, which
in this project's pattern usually means she wants it soon rather than
someday.

## 5. Stakeholder questions (need Sara's confirmation)

1. **Surface read — flag, don't block.** Confirm with Sara (can be
   lightweight, e.g. a one-line check-in) that "person's card > Sessions >
   expand a session" means "open a session from its card on the
   Board/Projects view," i.e. the `SessionDetail.tsx` flow — and not a
   rollup across multiple sessions for one person/agent that doesn't exist
   yet. Per the run-plan, this does not need to block evaluation/build
   from starting, but it should be confirmed before this is called done,
   since the fix (if the read is wrong) is a placement change, not a
   rewrite.
2. **Trigger model sign-off.** On-demand-per-open generation (cheapest,
   matches her literal phrasing) vs. a background sweep that pre-generates
   for ended sessions (better perceived latency, more like Value Pool) —
   the source doc recommends on-demand-only for this pass with background
   sweep as a possible fast-follow. This is an architecture decision, but
   Sara should know the fast-follow option exists so scope isn't
   quietly narrowed without her buy-in.
3. **When does a summary get generated at all?** Confirm the proposed
   simplifying rule — only summarize once a session has ended/gone
   stable — matches her expectation, versus wanting a summary available
   for in-progress sessions too (which would need a different
   staleness/invalidation story).
4. No content/copy sign-off is needed in the sense this project's other
   requests sometimes require (there is no pre-approved wording this must
   match exactly) — the "acceptance criterion is exact wording match"
   pattern from content-change requests does not apply here since the
   summary text is generated per-session, not fixed copy.
