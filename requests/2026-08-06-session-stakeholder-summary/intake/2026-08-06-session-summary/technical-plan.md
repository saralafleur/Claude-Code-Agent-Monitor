# Technical Plan — AI-generated stakeholder summary card for session transcripts

**Mode:** FAST · **Date:** 2026-08-06 · **Repo:** `Claude-Code-Agent-Monitor`
**Class:** `new-feature` (PM upheld triage's provisional call)
**Authoritative inputs:** `pm-plan.md`, `decisions.md` (source of truth on any
conflict), `supporting/architect.md`, `supporting/engineer.md`,
`supporting/qa.md`, `supporting/product-owner.md`.

> **Start gate (DEC-7, DECIDED — ON HOLD):** this plan is buildable and
> correct as written. Sara decided (2026-08-06) to **wait for Slice 3
> (`value-pool-grouping`) to merge** before Step 1 starts — it has an
> unlanded build editing `server/lib/value-summary.js`, the same file Step 1
> edits. **Do not dispatch `team-build` on this plan until Slice 3 has
> merged to the default branch.** DEC-7 gates *when* the build starts, not
> *what* it contains — no rework needed once unblocked. See §7.
>
> **DEC-1 (model tier), DEC-6 (UI surface), and DEC-8 (ended-only scope) are
> all DECIDED** — Sara confirmed each of this plan's defaults (sonnet,
> `SessionDetail.tsx`, ended-sessions-only) at the Step 6 report-back gate.
> No plan changes required; see `decisions.md`.

---

## 1. Objective

Add a stakeholder-register "what we did / what's next" summary card to the
Conversation tab of `SessionDetail.tsx`, rendered directly above
`ConversationView`. Opening a session with no fresh cached summary shows a
distinguishable "preparing" state, generation runs server-side off the request
path via the existing `runClaudePromptJson` CLI spawn, and the card flips to
the finished text over the existing WebSocket broadcast — no reload, no
polling. The summary is cached in a new `session_summaries` table and is
invalidated when the session's inputs change (notably reactivation), so a
resumed session never serves a superseded "what's next." End state: one new
server synthesis module, one new table, two new routes, one new WS event, one
canonical client hook, one card component, and the tests that make the state
contract and the invalidation invariant provable.

---

## 2. Recommended approach

**Chosen design:** on-demand generation only (DEC-2), fire-and-forget from the
route with a WebSocket completion push and server-side in-flight de-dup
(DEC-4), a four-state discriminated wire contract
(`resolved`/`generating`/`queued`/`unavailable`, `reason` mandatory on
`unavailable`), snapshot-compare invalidation keyed on the session's end state
and last event (DEC-3), and a canonical client hook extracted on day one
(DEC-5). Model tier is **sonnet**, pinned in code and overridable by env
(DEC-1).

**Where this plan overrides a supporting finding — stated explicitly:**

| Overridden | Original | This plan | Why |
|---|---|---|---|
| `architect.md` §4.3 | haiku, "confirmed" | **sonnet**, via a new stage default | DEC-1. Sara pinned sonnet for both sibling stages 24h earlier (`c233a36`). `summaryModel()`'s hardcoded `"haiku"` fallback means a new unpinned stage silently opts out of that decision. Not re-litigated here. |
| `architect.md` §6 | do **not** extract a hook; document the cut line in prose | **extract `useSessionSummary.ts` now** | DEC-5. §9.1's own 2026-08-05 lesson: "a pre-flag is not a guard." A prose cut line is the exact remedy that has already failed on this entry. |
| `engineer.md` Claim 2 (adopted, not overridden) | `value-summary.js`'s `buildPrompt`/`parseOutput`/`enrichPoolAltitudes` is batching-oriented; the single-unit trio in `focus-inference.js:383-437` is a closer template | **Prompt/parse/spawn shape copies `focus-inference.js`'s `buildSummaryPrompt`/`parseSummaryOutput`/`llmSummarize` trio.** The stage/model registry still extends `value-summary.js` per DEC-1. | Correct on both counts: take the single-unit call shape from the closer precedent, take the shared registry from the file that owns it. Do **not** clone `MAX_UNITS_PER_PROMPT`, the `states` map, or `reHomeStaleUnits`. |
| `architect.md` §5.3 ("a broadcast is only ever terminal **by construction**") | asserted in prose | **asserted by a test**, and the comment says "must be" not "by construction" | PM-3 + §9.1's standing check: grep new headers for "never"/"always"/"by construction" — each is a test nobody wrote yet. |
| `architect.md` §5.1 (delivery gap, added by PM) | WS-only completion | **subscribe-before-POST ordering _and_ one bounded re-read** | PM §4: if generation completes between the POST returning `generating` and the client subscribing, the terminal event reaches nobody and the card says "preparing…" forever. This is Slice 2's SF-6 one layer out. |

**Deliberate departures from the nearest precedent, each documented in the
code that makes them** (so a future reader does not "fix" them back):
- Route is **async fire-and-forget**, unlike synchronous
  `POST /api/project-plans/altitudes` (`server/routes/project-plans.js:149-218`)
  — document in the route's own header (DEC-4).
- Stale/reactivated sessions report `unavailable`, **not** stale-but-served,
  unlike `value-summary.js`'s `reHomeStaleUnits` — document in
  `session-summary.js`'s header, citing **WATCH-2**.

---

## 3. Change set

### 3.1 Shared registries — MUST land before any code that references them
The engineer identified two **closed registries** with a registry-before-consumer
ordering dependency:

| File:line | Registry | Edit |
|---|---|---|
| `server/lib/value-summary.js:107` | `SUMMARY_STAGES = ["unit", "grouping"]` | → `["unit", "grouping", "session"]`; extend the JSDoc block at `:100-107` to describe the `"session"` stage (and keep the §9.3 dead-export exemption wording intact for `"grouping"`) |
| `server/lib/value-summary.js:109-131` | `summaryModel(stage)` JSDoc + cascade | add `STAGE_DEFAULT_MODEL`; widen `@param` to `"unit"\|"grouping"\|"session"`; name `DASHBOARD_VALUE_SUMMARY_SESSION_MODEL` |
| `client/src/lib/types.ts:3111` | WS `type` union (ends `\| "value_claim_updated";`) | add `\| "session_summary_updated"` |
| `client/src/lib/types.ts:~2831` | payload interfaces (next to `ValueAltitudesUpdatedPayload`) | add `SessionSummaryUpdatedPayload` |
| `client/src/lib/types.ts:3115+` | WS `data:` union | add `\| SessionSummaryUpdatedPayload` |
| `.env.example:126-138` | model-tier docs block | add `DASHBOARD_VALUE_SUMMARY_SESSION_MODEL=sonnet` alongside the `_UNIT_`/`_GROUPING_` entries |

### 3.2 Server — data layer
- **`server/db.js`** — new `CREATE TABLE IF NOT EXISTS session_summaries` block
  inside the single boot-time `db.exec(...)` schema literal (starts `:138`),
  placed immediately after the `value_unit_summaries` block (`:835-856`).
  **No migration file and no `addColumnsIfMissing` call is needed** — the
  engineer confirmed there is no migration framework; every net-new table is a
  plain idempotent `CREATE TABLE IF NOT EXISTS`.
- **`server/db.js:~3386-3409`** — new prepared statements next to
  `getValueUnitSummary`/`upsertValueUnitSummary`, with the same
  "read/written by `server/lib/session-summary.js` only" comment convention:
  `getSessionSummary`, `upsertSessionSummary`, `deleteSessionSummary`,
  `getSessionLastEvent`.

### 3.3 Server — synthesis + transport
- **`server/lib/session-summary.js`** — NEW. The whole synthesis layer.
- **`server/routes/sessions.js`** — two new routes next to
  `GET /:id/transcript` (`:916`). `broadcast` is already imported at
  `server/routes/sessions.js:12`; inject it into the composer the way
  `applyFocusCommand(dbModule, broadcast, ...)` already does at `:550`.

### 3.4 Client
- **`client/src/lib/api.ts`** — two entries in the existing `sessions:` group
  (`:651`).
- **`client/src/hooks/useSessionSummary.ts`** — NEW, **canonical** (DEC-5).
- **`client/src/components/SessionSummaryCard.tsx`** — NEW, pure renderer.
- **`client/src/pages/SessionDetail.tsx`** — mount the card inside the
  `visitedTabs.has("conversation")` block at `:1290-1294`, above
  `<ConversationView>`; namespace is `useTranslation("sessions")` (`:163`).
- **`client/src/i18n/locales/{en,zh,vi,ko}/sessions.json`** — new
  `sessionSummary.*` key block. All four locales; en is authoritative.

### 3.5 Tests
- `server/__tests__/session-summary.test.js` — NEW
- `server/__tests__/single-writer-guard.test.js` — EXTEND (do not hand-roll a
  second structural scanner, §9.7)
- `server/__tests__/db-migration.test.js` — EXTEND
- `client/src/components/__tests__/SessionSummaryCard.test.tsx` — NEW
- `client/src/hooks/__tests__/useSessionSummary.test.tsx` — NEW

---

## 4. Implementation steps

Sequenced by dependency. Each step is independently checkable.

### Step 1 — Registries first (blocks everything else)

**1a. `server/lib/value-summary.js`**
```js
const SUMMARY_STAGES = ["unit", "grouping", "session"];

/** Per-stage calibrated defaults. Sits BETWEEN the per-stage env override and
 *  the shared fallback chain, deliberately: a stage whose tier was chosen
 *  against real output must not be silently downgraded by a blanket
 *  DASHBOARD_VALUE_SUMMARY_MODEL set for a different stage. "session" is
 *  sonnet per DEC-1 (2026-08-06) — Sara pinned sonnet for "unit"/"grouping"
 *  in c233a36 after a real 40-unit side-by-side; a new stage inheriting the
 *  literal "haiku" tail would silently reintroduce the tier she declined.
 *  Stages absent from this map keep today's exact behavior. */
const STAGE_DEFAULT_MODEL = { session: "sonnet" };

function summaryModel(stage = "unit") {
  const stageEnvName = `DASHBOARD_VALUE_SUMMARY_${stage.toUpperCase()}_MODEL`;
  return (
    process.env[stageEnvName] ||
    STAGE_DEFAULT_MODEL[stage] ||
    process.env.DASHBOARD_VALUE_SUMMARY_MODEL ||
    process.env.DASHBOARD_FOCUS_SUMMARY_MODEL ||
    process.env.DASHBOARD_FOCUS_INFER_MODEL ||
    "haiku"
  );
}
```
`"unit"` and `"grouping"` resolve **byte-identically to today** (they are not
in the map). Add a test in the existing `server/__tests__/value-summary.test.js`
asserting exactly that, plus `summaryModel("session") === "sonnet"` with no env
set and `=== "opus"` with `DASHBOARD_VALUE_SUMMARY_SESSION_MODEL=opus`.

**1b. `client/src/lib/types.ts`** — add the union member at `:3111`, the payload
interface next to `ValueAltitudesUpdatedPayload` (`:~2831`), and the payload to
the `data:` union:
```ts
/** Terminal-only completion push for a session stakeholder summary.
 *  Broadcast by server/lib/session-summary.js when generation reaches
 *  `resolved` or `unavailable` — must never carry `generating`/`queued`
 *  (asserted by session-summary.test.js, not claimed "by construction"). */
export interface SessionSummaryUpdatedPayload {
  session_id: string;
  state: "resolved" | "unavailable";
  summary?: { what_we_did: string; whats_next: string };
  model?: string;
  generated_at?: string;
  reason?: string;
}
```

**1c. `.env.example`** — document `DASHBOARD_VALUE_SUMMARY_SESSION_MODEL=sonnet`
in the block at `:126-138`, noting it is the code default, not required.

**Checkable:** `npm run test:server`, `cd client && npx tsc --noEmit`.

### Step 2 — Schema + statements

`server/db.js`, after `value_unit_summaries` (`:856`):
```sql
-- Session stakeholder-summary cache. One row per session, written ONLY by
-- server/lib/session-summary.js's generateSessionSummary (single-writer-guard).
-- Two snapshot columns, not one: input_ended_at catches reactivation
-- (server/db.js:2306 reactivateSession, live at routes/hooks.js:397/1063/1400
-- -- a session's ended_at is NOT permanently stable), and
-- input_last_event_at/_id catch a session that gained work without its
-- ended_at changing. The second pair is what lets DEC-8 (summarize
-- in-progress sessions?) stay a config toggle instead of a redesign.
-- Any mismatch is an ORDINARY CACHE MISS -- this table deliberately does NOT
-- follow value-summary.js's serve-stale-text rule (WATCH-2).
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  what_we_did TEXT NOT NULL,
  whats_next TEXT NOT NULL,
  model TEXT,
  input_ended_at TEXT,
  input_last_event_at TEXT,
  input_last_event_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

Statements at `:~3409`:
```js
// Session stakeholder-summary cache (see the session_summaries schema comment)
// - read/written by server/lib/session-summary.js only.
getSessionSummary: db.prepare("SELECT * FROM session_summaries WHERE session_id = ?"),
deleteSessionSummary: db.prepare("DELETE FROM session_summaries WHERE session_id = ?"),
// Chronology by (created_at, id) -- never id alone (§9.2 row-id-as-chronology-proxy).
getSessionLastEvent: db.prepare(
  "SELECT created_at, id FROM events WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"
),
// The ONE lexical caller is generateSessionSummary (single-writer-guard.test.js).
upsertSessionSummary: db.prepare(
  `INSERT INTO session_summaries
     (session_id, what_we_did, whats_next, model, input_ended_at, input_last_event_at, input_last_event_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(session_id) DO UPDATE SET
     what_we_did = excluded.what_we_did,
     whats_next = excluded.whats_next,
     model = excluded.model,
     input_ended_at = excluded.input_ended_at,
     input_last_event_at = excluded.input_last_event_at,
     input_last_event_id = excluded.input_last_event_id,
     created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
),
```

**Checkable:** `node --test server/__tests__/db-migration.test.js` after Step 6c.

### Step 3 — `server/lib/session-summary.js` (new)

Header comment must state: the four-state contract and why; the WATCH-2
divergence from `reHomeStaleUnits`; that the prompt/parse/spawn shape follows
`focus-inference.js:383-437`, not `value-summary.js`'s batching path; and
**no "never"/"always"/"by construction" claims that lack a test** (§9.1
standing check).

**Exports**
```js
module.exports = {
  SESSION_SUMMARY_STATES,      // ["resolved","generating","queued","unavailable"]
  SESSION_SUMMARY_REASONS,     // ["session_active","not_found","no_activity","llm_off","spawn_failed","unparsable"]
  buildSessionSummaryPrompt,
  parseSessionSummaryOutput,
  readCachedSessionSummary,
  getOrGenerateSessionSummary, // the ONE composer
  peekSessionSummary,          // cache-read-only, never generates (GET route + client bounded re-read)
  __resetSessionSummaryRuntime, // TEST-ONLY: clears in-flight map/queue/semaphore.
                                // JSDoc'd as such so a §9.3 "exported and never
                                // called in prod" sweep does not flag it.
};
```

**Constants**
```js
/** DEC-8 (PENDING) toggle, deliberately ONE constant. true = ended sessions
 *  only (Option A, today's default). Flipping to false enables in-progress
 *  summaries; the input snapshot already covers their invalidation via
 *  input_last_event_at/_id, so no other code changes. */
const REQUIRE_ENDED_SESSION = true;

/** Reasoned guess, NOT a measurement -- see WATCH-5. Set low so `queued` is
 *  actually reachable in ordinary multi-tab use rather than a decorative
 *  branch. There is no observed distribution for this feature yet. */
const MAX_CONCURRENT_SESSION_SUMMARIES = 2;

/** Runaway-output guard, mirroring value-summary.js's MAX_TEXT_LENGTH. */
const MAX_SUMMARY_TEXT_LENGTH = 480;
```

**Prompt** — `buildSessionSummaryPrompt(digest, session)`, shaped like
`focus-inference.js:383` (`.filter(Boolean).join("\n").slice(0, 6_000)`).
Register constraints go **in the prompt**, per the brief's binding
carry-forward and PO AC-5:
- explicitly "for a non-technical stakeholder — the register of a status
  update to a non-engineer manager, not a changelog";
- explicitly forbid file names, function names, commit/PR refs, tool names,
  stack traces, and internal jargon;
- two fields, ≤2 plain sentences each;
- `Reply with ONLY JSON: {"what_we_did":"...","whats_next":"..."}`.

**Digest** — reuse `buildActivityDigest(dbModule, sessionId)`
(`server/lib/focus-inference.js:118-166`), already exported and already
ordered `created_at ASC, id ASC`. **Do not hand-roll a second events query** —
that reintroduces §9.2 in a brand-new call site. If the digest is empty, the
session gets `{state:"unavailable", reason:"no_activity"}` — never a spawn.
(Transcript JSONL files are *not* read: `GET /:id/transcript` streams/paginates
them and there is no whole-transcript-as-string helper. The `events`-table
digest is the bounded, already-proven input; a transcript-text upgrade is a
later, separate decision.)

**Parse** — `parseSessionSummaryOutput(stdout)`, shaped like
`focus-inference.js:406`: unwrap the `--output-format json` envelope, strip a
fenced code block, `JSON.parse`, require both fields non-empty, truncate each
to `MAX_SUMMARY_TEXT_LENGTH`, return `null` on anything else. Never throws.

**Cache read** — `readCachedSessionSummary(dbModule, sessionId)` returns
`{ row, fresh }`. `fresh` is a field-wise snapshot compare (the shape of
`value-summary.js:224-229` `compareUnitInputs`, not its code): `input_ended_at`
vs live `sessions.ended_at`, and `input_last_event_at`/`input_last_event_id`
vs `getSessionLastEvent`. Null-vs-null is a match on each field independently.
Any mismatch → ordinary cache miss.

**Composer** — `getOrGenerateSessionSummary(dbModule, broadcast, sessionId)`,
**synchronous-returning** (no LLM `await` on this path):
1. session missing → `{state:"unavailable", reason:"not_found"}`
2. fresh cache row → `{state:"resolved", summary, model, generated_at, cached:true}`
   (`cached` is for observability only — the renderer treats cached and fresh
   identically, same lesson as `value-summary.js`'s own `cached` field)
3. `REQUIRE_ENDED_SESSION && session.status === "active"` →
   `{state:"unavailable", reason:"session_active"}`
4. `inFlight.has(sessionId)` → `{state:"generating"}` (no second spawn — this
   is the server-side cure for the StrictMode double-invoke, `main.tsx:98`)
5. `activeCount >= MAX_CONCURRENT_SESSION_SUMMARIES` → enqueue, `{state:"queued"}`
6. otherwise start generation, `{state:"generating"}`

**Generator** — `generateSessionSummary(...)`, internal, async. The **only**
lexical call site of `dbModule.stmts.upsertSessionSummary.run(`. Snapshot the
inputs **before** the spawn, write them with the result. Checks
`llmAvailable()` (import from `value-summary.js`, do not re-derive) → on false,
terminal `unavailable`/`llm_off`. Spawn via
`runClaudePromptJson(prompt, { model: summaryModel("session") })` — `null`
resolve → `spawn_failed`; parse `null` → `unparsable`. Always releases the
semaphore slot and drains the FIFO in a `finally`. Always emits exactly one
terminal broadcast:
```js
broadcast("session_summary_updated", { session_id, state, summary?, model?, generated_at?, reason? });
```
Guard the broadcast so a **terminal state is the only thing that can be sent**
— and prove it with a test (Step 6a), rather than asserting it in a comment.

### Step 4 — Routes (`server/routes/sessions.js`, next to `GET /:id/transcript` at `:916`)

```
POST /api/sessions/:id/summary   -> read-or-trigger. Always 200. Never throws.
GET  /api/sessions/:id/summary   -> cache-read-only (peekSessionSummary).
                                    NEVER triggers generation.
```
Response body (both routes):
```jsonc
{
  "state": "resolved" | "generating" | "queued" | "unavailable",
  "summary": { "what_we_did": "...", "whats_next": "..." }, // state=resolved only
  "model": "sonnet", "generated_at": "...", "cached": true,
  "reason": "session_active" | "not_found" | "no_activity"
          | "llm_off" | "spawn_failed" | "unparsable"
  // MANDATORY whenever state === "unavailable". An unavailable with no
  // reason is itself a §9.8 violation and the client surfaces it as
  // unexpected, not as a plain unavailable.
}
```
The POST handler's header comment must record the DEC-4 divergence:
*"Deliberately fire-and-forget, unlike the synchronous
`POST /api/project-plans/altitudes` (`project-plans.js:149-218`) this
otherwise mirrors. Reason: `/altitudes` amortizes one spawn across up to 40
units and mostly hits cache; a session summary is 1:1 with opening one
un-summarized session, so a synchronous handler would hold an HTTP connection
open for a worst-case 30s spawn per open tab. Do not 'fix' this back to
synchronous — see DEC-4."*
`GET` exists specifically so the client's bounded re-read (Step 5) can
re-check without any chance of spawning a second generation.
Audit-log write, if added, goes in a guarded `try/catch` so a logging failure
never sinks an already-succeeded response (`project-plans.js:149-218` pattern).

**`client/src/lib/api.ts`**, inside the `sessions:` group (`:651`):
```ts
summary: (id: string) =>
  request<SessionSummaryResponse>(`/sessions/${encodeURIComponent(id)}/summary`, { method: "POST" }),
summaryCached: (id: string) =>
  request<SessionSummaryResponse>(`/sessions/${encodeURIComponent(id)}/summary`),
```

### Step 5 — Client

**5a. `client/src/hooks/useSessionSummary.ts` (NEW — canonical, DEC-5).**
Header comment, `client/src/lib/windowedTotals.ts`-shaped, must:
- name this as **the single canonical computation** of "this session's
  stakeholder summary and its status";
- instruct any future consumer — **naming the pre-flagged Board-card badge
  explicitly**, and the per-person rollup from DEC-6 — to **import** this hook
  rather than re-derive it, even as a "quick first pass";
- state that if a future consumer genuinely cannot use it, that code must
  state its divergence bound the way `windowedTotals.ts` bounds its re-slice;
- cite **WATCH-4** (cross-consumer parity test MANDATORY at consumer #2);
- contain **no** "never"/"impossible"/"always" claim it cannot prove.

Also exports the hand-mirrored registry (§9.7 accepted exception — a CJS
server module cannot cross the Vite/Node boundary; same reason
`ALTITUDE_STATES` is mirrored):
```ts
export const SESSION_SUMMARY_STATES = ["resolved", "generating", "queued", "unavailable"] as const;
```

Signature: `useSessionSummary(sessionId: string, opts: { enabled: boolean })`
→ `{ state, summary, reason, unrecognizedState, refetch }`.

Three internals, and **only** these:
1. `requestedRef: useRef<Set<string>>` — idempotency, the exact convention
   `PlanLedgerPanel.tsx:666`'s `requestedAltitudesRef` already uses.
2. **One** `useEffect` that, in this order inside a single effect body:
   (a) calls `eventBus.subscribe(...)` — filtering
   `msg.type === "session_summary_updated" && data.session_id === sessionId`,
   whole body wrapped in `try/catch` because eventBus delivery is synchronous
   and a throwing subscriber aborts later handlers
   (`PlanLedgerPanel.tsx:861-888` precedent);
   **then** (b) issues `api.sessions.summary(id)`, guarded by `requestedRef`.
   **The ordering is the fix** — subscribing before the POST is what closes
   the PM-§4 delivery race (SF-6 one layer out). It returns `unsubscribe`.
3. A **bounded re-read**: on entering `generating`/`queued`, one
   `setTimeout(…, 4000)` that calls `api.sessions.summaryCached(id)` once and
   adopts a terminal result. Cleared on terminal state or unmount. Belt and
   braces with (2) — either alone would resolve the race; both together mean a
   dropped socket frame is also survivable.

Nothing else in `SessionDetail.tsx` reads or writes this state.

**5b. `client/src/components/SessionSummaryCard.tsx` (NEW).** Pure renderer
over `{state, summary, reason, unrecognizedState, sessionId}`. Never blank,
never throws — the house rule stays. **Trap E cure (explicit, this is the
load-bearing bit):**
```tsx
if (!SESSION_SUMMARY_STATES.includes(state as never)) {
  console.warn(`[SessionSummaryCard] unrecognized summary state "${state}" for session ${sessionId}`);
  return <span data-testid="session-summary-unexpected" …>{t("sessionSummary.unexpected")}</span>;
}
```
An out-of-registry value must render through a **different branch, different
`data-testid`, and different copy** from a legitimate `unavailable`. Trap E's
actual defect was that nothing distinguished the two, not that a fallback
rendered at all. Same treatment for `state === "unavailable"` with a missing
or out-of-registry `reason`. Summary text renders as **plain text only** —
never as HTML/markdown (this is the first LLM output in the repo rendered as
prominent stakeholder prose; `AltitudeText`'s plain-string rendering is the
precedent).

**5c. `client/src/pages/SessionDetail.tsx:1290-1294`:**
```tsx
{visitedTabs.has("conversation") && (
  <div hidden={activeTab !== "conversation"}>
    <SessionSummaryCard sessionId={session.id} {...summary} />
    <ConversationView sessionId={session.id} initialTranscriptId={pendingTranscriptId} />
  </div>
)}
```
with `const summary = useSessionSummary(session.id, { enabled: visitedTabs.has("conversation") });`
near the other hooks. Card is **above** the transcript, in the same tab, no
click to reveal (PO AC-1).

**5d. i18n** — `sessionSummary.{title,whatWeDid,whatsNext,generating,queued,unavailable,unexpected}`
plus `sessionSummary.reason.{session_active,not_found,no_activity,llm_off,spawn_failed,unparsable}`
in all four `sessions.json` locales.

### Step 6 — Tests

**6a. `server/__tests__/session-summary.test.js` (NEW)**
- `describe("getOrGenerateSessionSummary truth table")` — **combination**
  testing, DEC-11-shaped (precedent:
  `server/__tests__/value-summary.test.js`'s
  `describe("enrichPoolAltitudes DEC-11 truth table")`), over
  {no cache / stale cache / fresh cache} × {LLM available / LLM off} ×
  {under cap / at cap}. **Must include the specific combination PM-3 named:
  cache-miss × LLM-down × at-cap** — the case where `queued` and `unavailable`
  are most likely to collapse into each other. Plus one explicit
  "mutual exclusivity and complete partition" case: every input lands in
  exactly one of the four states, never zero and never two.
- `"every unavailable result carries a reason in SESSION_SUMMARY_REASONS"` —
  asserted across every unavailable-producing case in the table.
- **DEC-3 positive control (the load-bearing new invariant):**
  `"a reactivated session's cached summary is a cache MISS, not stale-served"`
  — seed a resolved row with `input_ended_at = T`, run
  `stmts.reactivateSession.run(id)` (`server/db.js:2306`), assert the next
  read is **not** `resolved` and does **not** return the old text.
- Second positive control (makes DEC-8 Option B safe with no redesign):
  `"a session that gained an event since generation is a cache MISS"` — seed,
  insert an `events` row, assert miss.
- `"two concurrent requests for one session spawn exactly one claude -p"` —
  counting stub for `runClaudePromptJson`; the server-side StrictMode cure.
- `"a broadcast only ever carries a terminal state"` — capture every
  `broadcast` call across the whole truth table; assert
  `state ∈ {resolved, unavailable}` and that exactly one fires per generation.
  This test is what replaces `architect.md` §5.3's "by construction" claim.
- **WATCH-6 (binding on style):** do **not** use
  `assert.notStrictEqual(tsA, tsB)` to prove a timestamp advanced — that
  assertion shape is intermittently red on `master` today
  (`value-summary-tick.test.js`, PM carve-out C-1). Use an injected clock or
  an explicitly distinct seeded value.

**6b. `server/__tests__/single-writer-guard.test.js` (EXTEND, do not fork —
§9.7).** Two cases mirroring `:236-271`:
- `"upsertSessionSummary appears only in db.js and session-summary.js"`
- `"upsertSessionSummary.run( has exactly one lexical call site, inside generateSessionSummary"`

**6c. `server/__tests__/db-migration.test.js` (EXTEND).** `session_summaries`
is created on a fresh DB; re-opening is idempotent; the FK cascade removes the
row when its session is deleted.

**6d. `client/src/components/__tests__/SessionSummaryCard.test.tsx` (NEW).**
Structural twin of `PlanLedgerPanel.test.tsx`'s
`"an out-of-registry states value warns and does not masquerade as an
old-server absence (T-E)"` (confirmed green today):
- `"an out-of-registry summary state warns and does not masquerade as an old-server absence (T-E)"`
  — `{state:"bogus"}` fixture: (a) renders a safe fallback, does not throw;
  (b) `console.warn` fires **exactly once**, naming both `"bogus"` and the
  session id; (c) the render signature is **distinguishable** from…
- …the sibling `"no state field at all (old server)"` fixture — same safe
  visual family, **different** testid, **no** warn.
- Each of the four registry states renders distinguishably; `unavailable`
  without a `reason` routes to the unexpected branch, not the plain
  unavailable copy.

**6e. `client/src/hooks/__tests__/useSessionSummary.test.tsx` (NEW).**
- **`"resolves even when the terminal broadcast fires before the subscription would normally exist"`**
  — emit `session_summary_updated` at the earliest possible point relative to
  the POST resolving; assert the hook reaches `resolved`. **This is the test
  Slice 2's SF-6 never had** (every prior suite seeded the subscription
  first); it is what proves the delivery layer, not just the state shape.
- `"the bounded re-read recovers a terminal state that never arrived over the socket"`
  — suppress the broadcast entirely, advance fake timers past 4s, assert
  `resolved` via the GET.
- `"renders under StrictMode and fires exactly one POST"` — the repo's own
  recommended cheapest fix for STRICTMODE-BLIND (`main.tsx:98`).
- A file-header comment recording that **no cross-consumer parity test is
  written this round** (vacuous with one consumer) and pointing at **WATCH-4**.

**Commands**
```
npm run test:server
node --test server/__tests__/session-summary.test.js
cd client && npx vitest run src/components/__tests__/SessionSummaryCard.test.tsx
cd client && npx vitest run src/hooks/__tests__/useSessionSummary.test.tsx
cd client && npx tsc --noEmit
```

### Step 7 — AC-5 register check (human, not a test)

Run the card against **at least one real, already-ended session** and read the
output as a non-technical stakeholder would: no file names, function names,
commit/PR refs, tool names, stack traces, or internal jargon. Per PM-1, run
this spot-check **side-by-side haiku vs sonnet on the same session** and file
the result as this stage's calibration record under DEC-1. If haiku is
indistinguishable here, that is evidence worth recording — it does not
retroactively reopen DEC-1 without Sara.

---

## 5. Single-source-of-truth guardrail

This project's defect catalog (`PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW,
**7 confirmed occurrences**, the highest count in the repo) is the binding
convention here, and this change touches that surface in three places. All
three route through the canonical path; none is hand-edited:

1. **Model selection.** `summaryModel()` in `server/lib/value-summary.js` is
   the ONE cascade. `session-summary.js` **imports and calls** it with
   `summaryModel("session")`. **Do not write a `sessionSummaryModel()`
   sibling** — `value-summary.js:109-118`'s own dated DEC-7/O2 ruling forbids
   exactly that ("not a second `groupingModel()` sibling function, which would
   duplicate this exact chain one call frame away, §9.1's twice-proven rogue
   re-derivation shape"). The `"session"` stage goes into the existing
   `SUMMARY_STAGES` registry at `:107`, the same way `"grouping"` did.
2. **Cache writes.** `dbModule.stmts.upsertSessionSummary.run(` has **exactly
   one lexical call site**, inside `generateSessionSummary`. Enforced
   structurally by extending `single-writer-guard.test.js` (Step 6b) — not by
   a new scanner (§9.7: extend the existing structural scan, don't hand-roll a
   second).
3. **Client fetch/format.** `client/src/hooks/useSessionSummary.ts` is the
   canonical computation of "this session's summary and its status," extracted
   on day one per DEC-5 even though `SessionDetail.tsx` is the only consumer
   today. Its `windowedTotals.ts`-shaped header names it canonical and
   instructs the pre-flagged Board-card badge (and DEC-6's possible per-person
   rollup) to **import, never re-derive**. **WATCH-4** is the dated tripwire:
   the day consumer #2 is scheduled, a cross-consumer parity test is MANDATORY
   before it merges.

Also carried forward: reuse `buildActivityDigest`
(`focus-inference.js:118-166`) rather than writing a second `events` query —
a hand-rolled query would reintroduce §9.2 (row-id-as-chronology-proxy, four
prior recurrences) in a brand-new call site. And reuse `runClaudePromptJson`
(`focus-inference.js:310`) — **no second LLM-invocation path, no
`@anthropic-ai/sdk`, no hosted-API dependency** (PO AC-6, directly checkable
in the diff).

---

## 6. Testing & verification

Covered in Step 6 above. The five things this build must *prove*, not assert:

| Claim | Proven by |
|---|---|
| Four states, mutually exclusive, complete partition; `reason` always present on `unavailable` | 6a truth table + partition case |
| A reactivated session never serves a stale summary (DEC-3) | 6a positive control (seed → reactivate → assert miss) |
| A broadcast is only ever terminal | 6a broadcast-capture test (replaces the "by construction" comment) |
| An out-of-registry state is distinguishable from an old-server absence (Trap E) | 6d, structural twin of the green `PlanLedgerPanel.test.tsx` T-E test |
| A terminal event that beats the subscription still reaches the user (SF-6 one layer out) | 6e broadcast-before-subscribe test + bounded-re-read test |

Pre-existing green precedent suites this build must not break:
`server/__tests__/value-summary.test.js`, `value-summary-tick.test.js` (see
WATCH-6 — it is intermittently red on `master` today, **before** this change;
do not attribute a `notStrictEqual`-timestamp failure there to this build),
`single-writer-guard.test.js`, `PlanLedgerPanel.test.tsx`.

---

## 7. Risks & rollback

**Every declined scope boundary below is backed by a tracked row in
`decisions.md`, not by this prose.** Rows were written as part of producing
this plan (WATCH-1 … WATCH-6, appended 2026-08-06), carrying forward the five
deferrals `architect.md` §7 flagged as disclosed-but-untracked plus QA's §9.1
tripwire and PM's C-1 carve-out.

| Risk | Watch for | Tracked as |
|---|---|---|
| Terminal WS event lost between POST and subscription → card says "preparing…" forever | Any report of a stuck generating card | Closed in-build (Step 5a ordering + bounded re-read, tested 6e) |
| Reactivated session serves superseded "what's next" | The DEC-3 positive control going red | Closed in-build (6a); divergence from serve-stale = **WATCH-2** |
| Background sweep never revisited; repeat opens stay slow | Perceived latency on second open | **WATCH-1** |
| No manual regenerate when output is simply poor | Sara reporting bad wording with unchanged inputs | **WATCH-3** |
| §9.1 recurs when the Board-card badge lands and hand-copies the fetch | Consumer #2 being scheduled | **WATCH-4** |
| `MAX_CONCURRENT_SESSION_SUMMARIES = 2` is a guess; `queued` may be noise or the cap may throttle real use | `queued` appearing as friction | **WATCH-5** |
| Copying `master`'s flaky `notStrictEqual`-on-timestamp assertion into the new suite | New suite going intermittently red | **WATCH-6** |
| Merge/divergence against Slice 3 on `server/lib/value-summary.js` | Step 1 conflicting | **DEC-7 — DECIDED: on hold until Slice 3 merges** |
| Ended-only vs in-progress scope | — | **DEC-8 — DECIDED: ended-only (`REQUIRE_ENDED_SESSION = true`)** |
| "Person's card" may mean a per-person rollup, not this flow | — | **DEC-6 — DECIDED: this flow (`SessionDetail.tsx`) confirmed** |
| Model tier reverses the architect's recommendation | — | **DEC-1 — DECIDED: sonnet confirmed** |

**All four are now DECIDED (Sara, 2026-08-06):**
- **DEC-7 (sequencing):** wait for Slice 3. This plan needs no rework once
  unblocked — DEC-7 only gated *when* Step 1 runs, not what it contains.
  **`team-build` should not be dispatched on this plan until
  `requests/2026-08-04-value-pool-grouping` Slice 3 has merged to the
  default branch.**
- **DEC-8 (in-progress sessions):** ended-only confirmed (Option A). DEC-3's
  snapshot design already supports in-progress summaries if this is ever
  revisited (the second snapshot pair, `input_last_event_at`/
  `input_last_event_id`, Step 2, is what makes that safe) — flipping
  `REQUIRE_ENDED_SESSION` later is a one-line edit, not a redesign.
- **DEC-6 (UI surface):** confirmed — `SessionDetail.tsx` above
  `ConversationView`, no new per-person surface in scope.
- **DEC-1 (model tier):** sonnet confirmed, consistent with Sara's sibling
  Value Pool decision.

**Rollback.** Cleanly reversible in layers, no data loss and no destructive
migration:
1. **UI only:** remove `<SessionSummaryCard>` from
   `SessionDetail.tsx:1290-1294`. Feature is invisible; server untouched.
2. **Generation only:** set `DASHBOARD_FOCUS_INFER_MODE` to anything but
   `llm` — `llmAvailable()` returns false and every uncached session reports
   `unavailable`/`llm_off`. No spawns, cached summaries still served.
3. **Full revert:** revert the commit. `session_summaries` is a net-new table
   with a `CREATE TABLE IF NOT EXISTS` and no `ALTER`/rebuild — leaving it
   behind is harmless; dropping it is a one-liner. No other table's shape
   changed. `SUMMARY_STAGES`/`STAGE_DEFAULT_MODEL` are additive; `"unit"` and
   `"grouping"` resolve byte-identically to today either way (asserted in
   Step 1a).

---

## 8. Definition of Done

**Function**
- [ ] Opening a session in the Conversation tab with no fresh cached summary
      shows the card **above** `ConversationView`, in that tab, with no click
      to reveal (PO AC-1).
- [ ] A session with a fresh cached summary shows it immediately — no
      generating flash, no blank card (PO AC-2).
- [ ] The card flips from generating to final text **without a page reload or
      manual refresh** (PO AC-4).
- [ ] Re-opening an unchanged session does not re-trigger generation (PO AC-7).

**Contract (§9.8 OVERLOADED-ABSENCE)**
- [ ] `SESSION_SUMMARY_STATES` is a closed, named, exported registry
      (4 states), hand-mirrored on the client with the §9.7 exception noted.
- [ ] `reason` is present on **every** `unavailable`, drawn from
      `SESSION_SUMMARY_REASONS`.
- [ ] An out-of-registry state renders a safe non-blank fallback **and** emits
      exactly one `console.warn` naming the value and session id, with a
      render signature distinguishable from the old-server no-field case —
      proven by the T-E twin test (6d).
- [ ] The composer is tested on **combinations** (cache × LLM × cap),
      including cache-miss × LLM-down × at-cap, plus an explicit
      never-zero/never-two partition case (6a).
- [ ] Broadcasts are proven terminal-only by a test; no header comment claims
      "by construction"/"never"/"always" without a test behind it (§9.1
      standing check — grep the diff's new headers before merging).

**Single source of truth (§9.1)**
- [ ] `summaryModel("session")` is used; **no** second cascade function exists.
- [ ] `SUMMARY_STAGES` and the WS type union both gained their entry **before**
      any code referencing them.
- [ ] `upsertSessionSummary.run(` has exactly one lexical call site, enforced
      by the extended `single-writer-guard.test.js` (6b).
- [ ] `useSessionSummary.ts` exists, is the only fetch/format path, and carries
      the `windowedTotals.ts`-shaped canonical header naming the Board-card
      badge and citing WATCH-4.
- [ ] No cross-consumer parity test this round — recorded as intentional in
      6e's header and in WATCH-4, not left as an implicit gap.
- [ ] `buildActivityDigest` reused; no second `events` query written (§9.2).

**Invalidation (DEC-3)**
- [ ] Reactivation positive control passes: seed → `reactivateSession` →
      next read is a cache **miss**, old text is not served.
- [ ] New-event positive control passes.

**Reuse + quality**
- [ ] Diff contains no new LLM-invocation path, no `@anthropic-ai/sdk`, no
      hosted-API dependency (PO AC-6).
- [ ] `DASHBOARD_VALUE_SUMMARY_SESSION_MODEL` documented in `.env.example`;
      `summaryModel("session")` defaults to `sonnet` with no env set;
      `"unit"`/`"grouping"` unchanged (asserted).
- [ ] AC-5 register spot-check done on a real ended session, haiku vs sonnet
      side-by-side, result filed under DEC-1.
- [ ] All four `sessions.json` locales carry the `sessionSummary.*` keys.
- [ ] New tests do not use `notStrictEqual` on ISO timestamps (WATCH-6).
- [ ] `npm run test:server` and `cd client && vitest run` are green, with
      `value-summary-tick.test.js`'s pre-existing intermittent failure noted
      as pre-existing (WATCH-6), not attributed to this change.

**Before build starts (not this plan's to close)**
- [x] DEC-7 answered by Sara — wait for Slice 3 to merge. **`team-build`
      stays on hold on this plan until that merge lands** — this is the one
      remaining gate.
- [x] DEC-1 confirmed by Sara (sonnet).
- [x] DEC-6 confirmed by Sara ("person's card" = this flow).
- [x] DEC-8 answered by Sara — `REQUIRE_ENDED_SESSION = true` (ended-only).
