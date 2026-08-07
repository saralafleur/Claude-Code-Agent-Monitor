# Architecture: AI-generated stakeholder summary card for session transcripts

FAST-mode run. This document makes the four binding decisions the brief
explicitly refused to let anyone assume silently (trigger model, staleness,
model tier, wire contract), plus the sync-vs-async spawn question and the
DERIVED-DUAL-VIEW extraction boundary. Each decision states the recommendation
first, then the reasoning and the live code it's grounded in.

---

## 1. Affected subsystems & boundaries

- **New synthesis layer** — `server/lib/session-summary.js` (new file),
  structured like `server/lib/value-summary.js`: `buildPrompt()`,
  `parseOutput()`, an orchestrator (`generateSessionSummary`), and a
  `summaryModel()` call (reused, not re-derived — see §4).
- **New cache table** — `session_summaries` in `server/db.js`, modeled on
  `value_unit_summaries` (`server/db.js:835-856`).
- **New route** — `POST /api/sessions/:id/summary` in
  `server/routes/sessions.js`, modeled on `POST /api/project-plans/altitudes`
  (`server/routes/project-plans.js:149-218`).
- **Reused spawn mechanism** — `runClaudePromptJson` /
  `probeClaudeCli` from `server/lib/focus-inference.js:65-95,310-369`. No new
  LLM-invocation path.
- **Reused digest builder** — `buildActivityDigest(dbModule, sessionId)`
  (`server/lib/focus-inference.js:118-166`), already exported. It already
  queries `events` with the correct `ORDER BY created_at ASC, id ASC`
  chronology (§9.2's fix). **Do not hand-roll a second events query for this
  feature** — that would reintroduce §9.2 (row-id-as-chronology-proxy) in a
  brand-new call site, the exact shape that entry has already recurred
  through four times in this repo.
- **Client surface** — `client/src/pages/SessionDetail.tsx`, the
  `visitedTabs.has("conversation")` block (`SessionDetail.tsx:1290-1294`),
  directly above the mounted `<ConversationView>`. A new
  `SessionSummaryCard` component, plus fetch/state logic that stays inline in
  `SessionDetail.tsx` for now (see §6 — extraction is deferred, not skipped).
- **WS transport** — `server/websocket.js`'s existing `broadcast(type, data)`
  (fire-to-all-clients, client filters), and the client's `eventBus`
  (`client/src/lib/eventBus.ts`, already wired to `useWebSocket` and already
  used this exact way by `PlanLedgerPanel.tsx:860-884`).

## 2. Current design (the precedent this build must follow — and where it must deliberately diverge)

`value-summary.js` + `value-summary-tick.js` is the one real precedent for
"cache an LLM synthesis of house data, serve it with a discriminated wire
state, never block the pool it enriches." Three things about how it actually
works matter here, because a literal copy would carry over a shape that does
not fit this surface:

1. **`POST /api/project-plans/altitudes` is synchronous today** — the route
   `await`s `enrichPoolAltitudes` directly, which itself `await`s
   `runClaudePromptJson` (up to `DASHBOARD_FOCUS_INFER_TIMEOUT_MS`, default
   30s) before responding. This works there because one call is **amortized
   across up to 40 units in a single spawn**, and the result is cached
   forever (or until a mutable unit's inputs change) — most page loads are
   cache hits. See §5 for why this doesn't transfer to session summaries.
2. **The WebSocket channel in the existing pattern is not used to complete
   the requester's own call.** `value_altitudes_updated` fires from the
   *background tick* (`value-summary-tick.js:378`) to tell **other** open
   tabs about work they didn't ask for. The requester's own POST resolves
   synchronously. The brief's carry-forward instruction ("flip to real text
   on a WS event") describes `AltitudeText`'s *rendering* contract
   correctly, but if read as "the existing precedent already completes
   on-demand requests over WS," that's not what's built. §5 designs the
   session-summary route to actually do that, which is a deliberate
   departure from precedent, named as such.
3. **§9.8 OVERLOADED-ABSENCE is a *confirmed, built, and once-regressed*
   pattern on this exact surface**, not a hypothetical. `enrichPoolAltitudes`
   originally collapsed five states into one absence; the cure
   (`ALTITUDE_STATES = ["queued","unavailable"]`, PROJECT-CONTEXT.md
   §9.8) shipped, and the client-side cure (`AltitudeText`,
   `PlanLedgerPanel.tsx:433-458`) itself introduced **Trap E**: an
   out-of-registry `freshness`/`states` value (old server that predates the
   field, or a malformed value from a future/buggy server) renders through
   the *same generic fallback* as a legitimate "unavailable" — so a real
   server regression is invisible to anyone looking at the UI. That is a
   named, catalogued defect in the file the brief tells us to model on, not
   a passed test. §5 names the concrete cure for this build.

This project's domain context (PROJECT-CONTEXT.md) also names §9.1
DERIVED-DUAL-VIEW: a derived value consumed by more than one surface must
share fetch/format logic via extraction from the *second* consumer's
introduction, not hand-copied. Addressed in §6.

## 3. Options considered

**Option A — literal copy of `/altitudes`'s synchronous shape.** Route
`await`s the LLM spawn in the request handler, returns final text or an
error in one round trip. Rejected — see §5 for the concrete reasons (spawn
multiplicity, StrictMode double-invoke risk already catalogued in this repo,
and the fact that a real "queued" state requires cross-request coordination
this shape doesn't have a place for).

**Option B — fire-and-forget generation + WS completion push, single shared
composer, in-flight de-dup by session id.** Recommended. Detailed in §5.
Strengthens single-source-of-truth: exactly one function
(`generateSessionSummary`) writes the cache row, exactly one place
(`session-summary.js`) owns the prompt/parse pair, matching this repo's own
stated general preference ("prefer the option that preserves a single source
of truth over one that duplicates logic") and its specific defect history —
this project has independently rediscovered the "two writers of the same
derived value" shape seven-plus times (§9.1) and the "N call sites must
remember to invalidate/dedupe" shape at least twice more (WATCH-7 two-writer
race in `value-summary-tick.js`; the un-deduped `/altitudes` POST itself,
noted in §5.3). A design that lets two concurrent requests for the same
session each independently spawn a `claude -p` process is exactly that shape
recurring a third time, and this build is cheap to make immune to it from
day one.

**Option C — background sweep (tick) as the only trigger, no on-demand
path.** Rejected for this scope; see §4.1. Would also fail the stated
acceptance signal directly (Sara: "each time we pull in a session... it will
say preparing... then show the result" — a click-triggered UX, not an
eventually-consistent background one).

## 4. The four decisions

### 4.1 Trigger model — **on-demand only, confirmed** (not overridden)

**Recommendation:** view-triggered generation only. No background sweep in
this build.

**Reasoning:**
- Matches Sara's own framing literally — "each time we pull in a session...
  it will say preparing... then show the result" describes a click-then-wait
  interaction, not an eventually-populated background job.
- This repo's own precedent for *when* a background sweep gets added is
  informative: `value-summary-tick.js` was **not** built alongside
  `value-summary.js`'s first request-path version — it followed once real
  usage (a signed-off 182-unit live pool, DEC-12) showed the request path's
  cap was routinely exceeded. Building the tick now, before any session has
  ever been opened under this feature, would be sizing a scheduler against
  zero measured distribution — the same category of mistake §9.8's own
  "any bound must cite the real distribution it was sized against" rule
  exists to prevent, one level up (a *scheduler's existence*, not just a
  bound inside one).
- A background sweep is a **real fast-follow candidate, not a maybe** — the
  brief itself pre-flags it. That means it must not stay disclosed-only in
  this prose. **This needs a `decisions.md` PENDING/WATCH row** (or
  equivalent) naming: "background summary sweep deferred; revisit once
  real session-open volume against un-summarized ended sessions is
  measured." Leaving it as a sentence here is functionally an
  undiscovered gap once this document stops being read.

### 4.2 Staleness / invalidation — **gate on ended + snapshot-compare, not a one-time boolean**

**Recommendation:** generate only for sessions that are not currently
`active` (i.e., have most recently ended — see below for the exact
predicate), and invalidate the cache by comparing a stored input snapshot
against the session's live `ended_at`, the same shape `value-summary.js`
uses for `MUTABLE_VALUE_SOURCES` — **not** a simpler "generate once,
never touch again" rule.

**This is a real finding, not a hypothetical simplification.** The brief's
proposed simplifying assumption — "sessions are normally append-only once
ended, so a simpler ended/stable gate needs no digest-based invalidation" —
is **false as verified against this codebase**. Sessions can be
**reactivated**: `server/db.js:2306-2308` defines
`reactivateSession: "UPDATE sessions SET status = 'active', ended_at = NULL, ... WHERE id = ?"`,
and it is called from three live sites in `server/routes/hooks.js`
(`:397`, `:1063`, `:1400`) whenever a new hook event arrives for a session
previously marked ended/quiet. `focus-inference.js`'s own header comment
independently confirms this is a designed, expected case ("re-classified
when they gain activity after their last inference — so an
abandoned-then-resumed session converges instead of freezing its first
verdict"). A cached "what we did / what's next" summary generated at the
first ending would silently describe stale, incomplete work the moment a
session resumes and then ends again — a stakeholder reading "what's next"
would be reading about work already done and superseded.

**Concrete design:**
- `session_summaries` stores `input_ended_at` (the `sessions.ended_at`
  value the summary was generated from), mirroring `value_unit_summaries`'
  `input_stage`/`input_label` snapshot columns and `compareUnitInputs`'s
  field-wise comparison (`value-summary.js:224-229`).
- On every read: if `session.ended_at` is `NULL` (active — including
  reactivated) or differs from the cached `input_ended_at`, treat the row as
  an ordinary cache miss, not resolved text. This is the exact "stale
  snapshot -> ordinary miss -> regenerate through the same pipeline"
  contract `readCached` already implements for mutable value-pool sources —
  reuse the *shape*, not the code (different table, different key).
- **One deliberate, named divergence from `value-summary.js`'s own "never
  blank, serve old text with a freshness marker" rule
  (`reHomeStaleUnits`):** for a stale/reactivated session, this design does
  **not** re-serve the old summary text with a freshness badge while the
  session is active again. It reports `unavailable` (`reason:
  "session_active"`) until the session ends again and a fresh summary is
  generated. Rationale: Value Pool's units are list rows where blanking one
  is visually jarring across many rows; this is a single-item card whose
  entire content is "what's next" — continuing to show an outdated "what's
  next" while new, unaccounted-for work is actively happening is more
  actively misleading than a plain "not available right now," not just
  stale. (This mirrors this catalog's own "Inverse-application warning" style
  — the general rule is right, but applying it here by rote would reproduce
  the wrong failure mode for this surface.) **This needs its own
  `decisions.md` PENDING/WATCH row** if a future round wants the richer
  stale-but-served behavior — flagging as a known, deliberate simplification,
  not an oversight.
- **Manual "regenerate" affordance:** not built in this round. The
  invalidate-on-reactivation mechanism above covers the actual
  data-integrity risk (missed real work); a manual regenerate button is a
  separate UX nicety for "the LLM output is just wrong/oddly worded" with no
  underlying data change. Defer — **needs a `decisions.md` WATCH row**, not
  silent scope-narrowing.

### 4.3 Model tier — **haiku, confirmed — reuse `summaryModel()`, do not write a second cascade**

**Recommendation:** confirmed haiku default, via a new `"session"` stage
added to `value-summary.js`'s existing `summaryModel(stage)` — **import and
call it**, do not write a sibling `sessionSummaryModel()` function in the new
module.

**Reasoning:** this is a per-session compression task (digest -> two short
sentences), the same shape as `summaryModel("unit")`'s per-unit synthesis,
not a cross-session judgment call that would argue for a stronger model.
More load-bearing: `value-summary.js` already has an explicit, dated
architectural ruling against exactly the mistake of writing a second cascade
function. Its own doc comment (`value-summary.js:109-118`, DEC-7/O2) reads:

> "ONE fallback cascade, written once — not a second `groupingModel()`
> sibling function, which would duplicate this exact chain one call frame
> away, §9.1's twice-proven rogue-re-derivation shape."

`SUMMARY_STAGES` already anticipates a not-yet-built second stage
(`"grouping"`) being added to the *same* registry rather than getting its
own function — extend it the same way: `SUMMARY_STAGES = ["unit",
"grouping", "session"]`, `summaryModel("session")` picks up
`DASHBOARD_VALUE_SUMMARY_SESSION_MODEL` first, then falls through the
existing shared chain to `"haiku"`. `session-summary.js` imports
`summaryModel` from `value-summary.js`; it does not re-derive the cascade.

## 5. Sync-vs-async spawn, and the concrete wire contract

### 5.1 Is calling `runClaudePromptJson` synchronously from the HTTP handler safe?

**Recommendation: no — fire-and-forget generation, WS push on completion,
in-flight de-dup by session id.** This is a deliberate departure from
`/altitudes`'s literal shape (see §2), for reasons specific to this surface:

1. **Cost is not amortized here.** `/altitudes` spawns once per up-to-40-unit
   batch and caches forever; most loads are cache hits. A session summary is
   1:1 with opening a *specific, previously un-summarized* session — a user
   tabbing through several just-ended sessions in one sitting can trigger
   several concurrent ~30s-worst-case spawns, each tying up its own open HTTP
   request/connection for the duration.
2. **This repo has a confirmed, catalogued defect class that makes a
   synchronous mount-triggered generation request actively dangerous in
   dev:** PROJECT-CONTEXT.md's STRICTMODE-BLIND CLIENT SUITE entry
   documents that `client/src/main.tsx:98` wraps the app in `<StrictMode>`,
   so `npm run dev` double-invokes every effect setup once. A naive
   "on mount, if no cached summary, POST to generate" effect will fire
   twice on first mount in dev, and — without de-dup — spawn two `claude -p`
   processes for the same session on every single first view. The de-dup
   infrastructure this requires (§5.2) only makes sense in an
   already-async, already-queueable design; retrofitting it onto a
   synchronous await-in-handler shape doesn't have a natural home for a
   second request to "join."
3. It's also what makes the "queued" wire state (§5.3, mandated by the
   brief) *real* rather than decorative — see below.

### 5.2 Concurrency & de-dup design

- Module-scope `Map<sessionId, Promise>` for **same-session de-dup**: a
  second request for a session already generating joins the in-flight
  promise (or, since the response has already gone out for the first
  request, simply returns `{state: "generating"}` again without spawning a
  second process). This is the direct server-side fix for the StrictMode
  double-invoke risk in 5.1(2).
- Module-scope counting semaphore, `MAX_CONCURRENT_SESSION_SUMMARIES = 2`
  (deliberately small, **cited reason, not a guessed number** — per §9.8's
  own bounds rule: sized this low specifically so the `queued` state is
  actually reachable and exercised by casual multi-tab use today, since
  there is no measured real distribution yet to size against, unlike
  `MAX_UNITS_PER_PROMPT`'s 182-unit measurement). Requests beyond the cap
  are pushed to a small in-memory FIFO and respond `{state: "queued"}`
  immediately; the next slot to free dequeues and starts generation.
- Client-side mirrors this with a `requestedSummaryRef` (`Set<sessionId>` or
  a single ref since one card exists per mounted `SessionDetail`),
  the exact idempotency convention `PlanLedgerPanel.tsx`'s
  `requestedAltitudesRef` already uses for this identical class of problem
  (`PlanLedgerPanel.tsx:666`) — belt-and-braces with the server-side dedup,
  not a substitute for it.

### 5.3 Request/response + async completion shape

`POST /api/sessions/:id/summary` (side-effecting trigger+read, mirrors
`POST /api/project-plans/altitudes`'s convention — a `GET` would be the
RESTfully "pure" choice but this repo's own precedent for
"read-that-may-trigger-generation" is a `POST`). Always 200; never throws to
the caller, matching the house-standard never-throws contract §9.8 exists to
guard.

```
POST /api/sessions/:id/summary
->
{
  "state": "resolved" | "generating" | "queued" | "unavailable",
  "summary"?: { "what_we_did": string, "whats_next": string },
  "model"?: string,
  "generated_at"?: string,
  "cached"?: boolean,
  "reason"?: "session_active" | "llm_off" | "spawn_failed" | "unparsable"
             // present only when state === "unavailable"; NEVER absent
             // when state is "unavailable" — an absent reason on an
             // unavailable state is itself a §9.8 violation.
}
```

- `resolved`: cache hit, or (rare) generation somehow completed within the
  same tick as the request — served synchronously. `cached` distinguishes
  the two for observability, never for rendering (rendering treats both
  identically — same lesson as `value-summary.js`'s own `cached` field).
- `generating`: kicked off this call (or already in flight from a de-duped
  concurrent call). No LLM `await` in this response path — the handler
  returns as soon as the in-flight promise/semaphore slot is acquired.
- `queued`: at the concurrency cap; enqueued, not yet started.
- `unavailable`: session still active (`reason: "session_active"`), or a
  terminal attempt failed (`llm_off` / `spawn_failed` / `unparsable`) — this
  round's ended-session generation was attempted and produced nothing, same
  three-way discrimination `enrichPoolAltitudes` already makes internally
  (never conflating "not attempted" with "attempted and failed").

**Completion push (`generating`/`queued` -> terminal), via the existing
`broadcast()`:**

```
broadcast("session_summary_updated", {
  session_id, state: "resolved" | "unavailable",
  summary?, model?, generated_at?, reason?
})
```

A broadcast is only ever a **terminal** transition (`resolved` or
`unavailable`) — never `generating`/`queued` — by construction, matching
`value-summary-tick.js`'s own `shouldBroadcastCoverage` discipline of firing
only on real state transitions, not intermediate bookkeeping.

Client: on a `generating`/`queued` response, subscribe via the existing
`eventBus` (already wired app-wide to `useWebSocket`), filter
`msg.type === "session_summary_updated" && data.session_id === session.id`,
flip local state on receipt. This is the concrete mechanism the brief's
carry-forward instruction ("flip to real text on a WS event, not polling")
actually requires building — `/altitudes` does not build this for its own
requester today (§2), so this is new machinery modeled on
`value_altitudes_updated`'s *shape*, not a literal reuse of an existing path.

### 5.4 Avoiding Trap E in the client renderer

Trap E (PROJECT-CONTEXT.md §9.8) is `AltitudeText` rendering an
out-of-registry `states`/`freshness` value through the exact same generic
fallback as a legitimate resolved-unavailable outcome — so a real server
regression (old server predating a field, or a malformed value) is
invisible to anyone looking at the UI. Concrete cure for this build's
renderer:

- Export `SESSION_SUMMARY_STATES = ["resolved", "generating", "queued",
  "unavailable"]` from the server module (mirrors `ALTITUDE_STATES`),
  hand-mirrored on the client per this repo's accepted §9.7 exception
  (`ALTITUDE_STATES`'s own comment: "a CJS server module cannot be imported
  across the Vite/Node boundary").
- The client component checks `state` against that registry explicitly. A
  value **outside** the registry (predates-the-field old server, or a
  malformed/future value) must **not** silently render through the same
  branch as a legitimate `unavailable` — log a `console.warn` naming the
  unexpected value, and render a visually distinguishable "unexpected
  server response" fallback (still non-blank, still non-crashing) rather
  than reusing the `unavailable` copy verbatim. This is the one concrete
  difference from copying `AltitudeText` uncritically: Trap E's actual
  defect was that *nothing* distinguished the two cases, not that the
  fallback rendered at all.

## 6. §9.1 DERIVED-DUAL-VIEW — extraction boundary (deferred, not skipped)

**Recommendation: do not extract a `useSessionSummary` hook now.** There is
exactly one consumer (`SessionDetail.tsx`). Building a hook/component for a
single call site is the over-engineering direction the brief itself warns
against, and unlike the `intake/2026-08-01-build-project-manager/` layers
4-6 pre-flag (where a second consumer — a layer-7 rollup UI — was **already
named and scheduled** in the same plan), the "Board card badge" mention here
is speculative, not scheduled. §9.1's own trigger language distinguishes
these: "consumers announced before the code exists" (2026-08-02 note) is
what forces day-one extraction; a hypothetical future consumer does not.

**But the extraction boundary must be explicit, not just "wherever seems
convenient later":**
- The fetch-trigger/state/WS-subscribe logic for the summary card must live
  in **one self-contained block** in `SessionDetail.tsx` — not interleaved
  with the session-metadata fetch effect or any other existing effect in
  that file. Concretely: one `useEffect` that triggers the POST when the
  conversation tab is first visited and no cached/in-flight state exists
  (guarded by `requestedSummaryRef`, §5.2), one `useEffect` that subscribes
  to `session_summary_updated`, and one local `useState` for
  `{state, summary, reason}` — nothing else reads or writes that state.
- **The cut line, named now for whoever adds consumer #2:** the moment a
  second consumer (Board card badge or otherwise) is actually scheduled,
  extract that self-contained block verbatim into
  `client/src/hooks/useSessionSummary.ts` (fetch + state + WS-subscribe,
  returning `{state, summary, reason, refetch}`) **before** writing the
  second consumer's code, per this repo's own standing rule ("each
  computation must be written as a single shared function on day one,
  before any second consumer exists" — DERIVED-DUAL-VIEW's design-time
  pre-flag, 2026-08-01). Do not let the second consumer hand-copy the fetch
  logic even once, even as a "quick" first pass — this repo's own history
  (§9.1's 2026-08-01 and 2026-08-02 build-outcome notes) shows the
  duplicate that ships is consistently the one written by whoever already
  had the logic in their head, in the first file's own code.
- This deferred-extraction decision, being a named and foreseeable future
  trigger, also **needs a `decisions.md` PENDING/WATCH row**: "extract
  `useSessionSummary` at the moment a second consumer is scheduled — do not
  let it get hand-copied first."

## 7. Architectural risks

- **Spawn multiplicity / resource exhaustion from casual multi-tab
  browsing** — mitigated by §5.2's concurrency cap + de-dup, but the cap
  (2) is a guess, not a measurement; revisit once real usage exists (same
  WATCH-row obligation as §4.1's background-sweep deferral — they're the
  same underlying unknown, "how many sessions does Sara actually open at
  once").
- **StrictMode double-invoke** (confirmed, catalogued, live defect class in
  this exact repo) is a direct risk to any naive "on mount, fetch/generate"
  effect. §5.1(2)/§5.2 name the concrete mitigation; the build's QA pass
  should specifically render the summary card under `<StrictMode>` (per
  this repo's own STRICTMODE-BLIND entry's recommended cheapest fix) and
  assert exactly one `POST` fires, not two.
- **Reactivation invalidation is the load-bearing new invariant this build
  introduces** (§4.2) — it is a genuinely new claim ("a session's
  `ended_at` is not permanently stable"), verified live against
  `server/db.js:2306-2308` and three real call sites, not assumed. Any
  future comment in this new module claiming a session's ended state
  "cannot change" should be treated as this repo's own recurring
  tell (PROJECT-CONTEXT.md's standing check: "grep new/changed headers for
  'never', 'can only', 'impossible', 'always' — each is a test someone has
  not written yet") — the invalidation-on-reactivation path needs its own
  positive-control test (seed a resolved summary, reactivate the session,
  assert the next read is a cache miss, not stale-served).
- **Trust boundary**: the digest fed into the prompt (`buildActivityDigest`)
  already flows into an LLM prompt for `focus-inference.js`'s classifier —
  this is not a new data-flow boundary. What *is* new is that this
  feature's LLM **output** is the first in this repo rendered prominently as
  stakeholder-facing prose (not a badge/classification label) — apply the
  same truncation discipline `value-summary.js` uses (`MAX_TEXT_LENGTH`-style
  cap) and render as plain text only, never interpreted as HTML/markdown,
  matching `AltitudeText`'s existing plain-string rendering.
- **`session_summaries` foreign key**: `session_id TEXT PRIMARY KEY
  REFERENCES sessions(id) ON DELETE CASCADE` — mirrors the `sessions` table's
  existing cascade convention (see `agents`/`events` FKs at
  `server/db.js:163-164,176-177`), so a deleted session's cached summary
  never orphans.

## 8. Recommended approach (summary)

1. On-demand only, confirmed (§4.1). Background sweep is a real, named
   fast-follow — needs a `decisions.md` row, not just this sentence.
2. Gate generation on "not currently active," invalidate via an
   `input_ended_at` snapshot compare (§4.2) — the "generate once, session is
   append-only" simplification is **factually wrong** for this codebase
   (sessions reactivate) and must not ship as designed in the brief's
   proposed default.
3. `haiku`, via `summaryModel("session")` extending `value-summary.js`'s
   existing cascade — do not write a second cascade function (§4.3).
4. Fire-and-forget generation + WS completion push + in-flight de-dup, a
   deliberate departure from `/altitudes`'s literal synchronous shape,
   justified by this surface's different cost/frequency profile and this
   repo's own confirmed StrictMode double-invoke risk (§5).
5. Four-state wire contract (`resolved`/`generating`/`queued`/`unavailable`
   with a mandatory `reason` sub-field on `unavailable`), with an explicit,
   named cure for Trap E in the client renderer (§5.4) — not a copy-paste of
   `AltitudeText`.
6. No hook extraction yet; the extraction boundary and its trigger condition
   are named explicitly for whenever consumer #2 is actually scheduled
   (§6) — also needs a `decisions.md` row so it isn't silently skipped when
   that day comes.
