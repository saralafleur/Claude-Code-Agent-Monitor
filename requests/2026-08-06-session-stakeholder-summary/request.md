# Request: AI-generated stakeholder summary card for session transcripts

**From:** Sara (verbal, 2026-08-06)
**Precedent:** same shape as `effort/2026-08-04-value-summary-tick` (merged) — a
per-item cached LLM synthesis, backgrounded, pushed over WebSocket, with a
"generating" placeholder client-side. That effort is the closest sibling
implementation and should be mined for pattern reuse, not reinvented.

## Sara's request, in her own framing

For each session where we have a transcript, run a prompt against it asking
"what did we do and what is next" and have it return a brief, high-level
**stakeholder summary** (not an engineering-detail summary — something a
non-technical stakeholder could read). Each time a session is opened and it
does not already have that summary, show a card **above the transcript**
that first indicates it's preparing the summary, then shows the result once
generated. Reuse the existing "build prompt" mechanism already used elsewhere
in this app to run a prompt like this — don't build a new one from scratch.

## Terminology note (resolve during triage)

Sara described this as living on "the individual person's card > Sessions >
expand a session." A same-session investigation of `client/src` found:
- No `PersonCard`/`AssigneeCard`/developer-grouping concept exists anywhere
  in this codebase today.
- The actual click path today is: `AgentCard.tsx` / `SessionCard.tsx` (used
  on `KanbanBoard.tsx`'s Board and on `Projects.tsx`'s per-project expandable
  session grid) → navigates to `client/src/pages/SessionDetail.tsx` →
  "Conversation" tab renders the transcript via
  `client/src/components/conversation/ConversationView.tsx`.
- Triage should confirm with Sara whether "person's card" is loose framing
  for this existing session-open flow (most likely), or whether she wants a
  new per-person/assignee grouping surface introduced first as a prerequisite
  (out of scope for this request unless she confirms it's actually wanted).
  Default assumption for planning: it's the existing flow, and the summary
  card slots into `SessionDetail.tsx` directly above the mounted
  `ConversationView` in the Conversation tab.

## Precedent mechanism to reuse (found in-session, do not re-derive)

- **`server/lib/focus-inference.js`**: `runClaudePromptJson(prompt, opts)` —
  the one hermetic "shell out to the local `claude` CLI" contract already
  used by every synthesis feature in this repo (`-p <prompt> --output-format
  json --model <model> --settings '{"disableAllHooks":true}' --disallowed-tools
  "*"`, sanitized env, kill-timer, never throws, returns `null` on failure).
  No `@anthropic-ai/sdk` dependency exists or should be introduced — stay on
  this CLI-spawn contract.
- **`server/lib/value-summary.js`** is the directly analogous synthesis
  layer to model a "session summary" layer on: per-unit cache table
  (`value_unit_summaries`), `buildPrompt()`, `parseOutput()` (JSON envelope
  parse, `MAX_TEXT_LENGTH` truncation), and an orchestrator
  (`enrichPoolAltitudes`) that checks cache, gates on `llmAvailable()`,
  upserts, and returns a partition of ready vs. `"queued"` vs.
  `"unavailable"` states.
- **`server/lib/value-summary-tick.js`** is the background-drain scheduler
  shape (boot-delay + `.unref()`'d interval, overlap guard — same shape as
  `focus-inference.js`/`reconciliation.js`) that later broadcasts
  `broadcast("value_altitudes_updated", payload)` over the WebSocket
  (`server/websocket.js`). A session-summary equivalent would emit its own
  event name on completion.
- **Client "generating" placeholder pattern**: `client/src/components/PlanLedgerPanel.tsx`'s
  `AltitudeText` (~lines 433–458) — renders a "generating" i18n string when
  the value is `undefined`, a "queued" string, or an "unavailable" string,
  and flips to the real text on receipt of the WS event rather than polling.
  The new session-summary card should follow this same three-state contract
  (generating / queued-behind-other-work / unavailable) rather than a bare
  boolean loading flag, per this project's §9.8 OVERLOADED-ABSENCE standing
  trap — a session with no summary yet must be a distinguishable state, not
  silently blank.

## Data model gap (confirmed, no existing column/table)

`server/db.js`'s `sessions` table (`id, name, status, cwd, model, started_at,
ended_at, metadata`) has no summary column, and no transcript text is
persisted server-side (transcripts are read live from on-disk JSONL, cached
via `server/lib/transcript-cache.js`). A new cache table is needed, shaped
like `value_unit_summaries` (lines ~835–860 of `db.js`): session id (FK),
summary text, model used, generated-at, and a staleness/invalidation story —
triage/architect should decide whether sessions need digest-based
invalidation (sessions are normally append-only once ended, so this may be
simpler than the value-pool's mutable-unit case: "only summarize once a
session has ended / gone stable" is a plausible simplifying constraint worth
proposing back to Sara) or a manual "regenerate" affordance instead.

## Trigger model (needs a decision during evaluation, not assumed)

Two candidate approaches, evaluate both and recommend one:
1. **View-triggered, on-demand**: opening a session with no cached summary
   kicks off generation for just that session (sync request kicks off a job,
   client shows "preparing," WS or poll delivers the result) — cheapest,
   matches "each time we pull in a session" framing literally.
2. **Background sweep**: a tick (mirroring `value-summary-tick.js`) proactively
   summarizes ended sessions without a cached summary, so most opens already
   have it ready — better perceived latency, more like the Value Pool's
   passive-coverage model.
Sara's phrasing ("each time we pull in a session and it does not have that
quick analysis... it will say... preparing... then show the result") reads as
(1), on-demand per-open, but a background sweep isn't precluded and may be
worth proposing as a fast-follow. Recommend on-demand-only for this request's
scope unless evaluation finds a strong reason to bundle both now.

## Constraints / carry-forwards

- Reuse `runClaudePromptJson` — do not introduce a second LLM-invocation
  path or a hosted API SDK dependency.
- Follow the existing model-tiering convention (env-driven model pick, see
  `summaryModel(stage)` in `value-summary.js`) rather than hardcoding a
  model string. A stakeholder-summary task is closer to per-unit compression
  than cross-unit judgment, so haiku is the working-hypothesis default,
  confirm during evaluation.
- §9.1 DERIVED-DUAL-VIEW: if this summary is ever rendered in more than one
  place (e.g. also surfaced as a Board card badge later), the fetch/format
  logic must be a shared hook/component from day one of its second consumer,
  not hand-copied — flagged pre-emptively since this project has hit this
  defect class five times.
- Keep the summary genuinely "high-level stakeholder" register — explicitly
  not an engineering changelog. The prompt design should say so directly
  (contrast with `value-summary.js`'s existing stakeholder-altitude prompt
  framing, which already does this for a different surface and is a good
  reference for tone).
