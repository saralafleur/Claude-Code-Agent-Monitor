# Engineer verification — precedent-reuse claims

FAST-mode, narrowed mandate: verify the request brief's cited "reuse this
existing precedent" claims against the actual code, with exact citations.
Not an exhaustive change set (deferred to build). All line numbers below
were read directly from the files in this repo at HEAD
(`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`), not from the
brief's paraphrase.

---

## Claim 1 — `runClaudePromptJson` in `server/lib/focus-inference.js`

**CONFIRMED**, with corrected line numbers.

- Function: `server/lib/focus-inference.js:310` — `function runClaudePromptJson(prompt, opts = {})`.
- Spawn call: `server/lib/focus-inference.js:322-338`:
  ```
  spawnImpl("claude", ["-p", prompt, "--output-format", "json", "--model", model,
    "--settings", JSON.stringify({ disableAllHooks: true }), "--disallowed-tools", "*"],
    { env: cleanEnv(), cwd: os.tmpdir(), stdio: ["ignore", "pipe", "pipe"] })
  ```
  This matches the brief's cited CLI shape exactly (`-p <prompt> --output-format json
  --model <model> --settings '{"disableAllHooks":true}' --disallowed-tools "*"`).
- Env sanitizing: `cleanEnv()` at `server/lib/focus-inference.js:97-102` — copies
  `process.env`, strips `CLAUDECODE` and `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`.
- Kill-timer: `server/lib/focus-inference.js:345-361` — `setTimeout` sends `SIGTERM`,
  schedules a `SIGKILL` hard-kill 5s later, `.unref()`'d, resolves `null` on fire.
- Never throws / resolves `null` on failure: spawn-construction `try/catch` returns
  `null` (line 339-341), `child.on("error", ...)` resolves `null` (line 362), non-zero
  exit resolves `null` (line 363-366) — no path rejects or throws.
- Model/timeout resolution: `opts.timeoutMs ?? DASHBOARD_FOCUS_INFER_TIMEOUT_MS ?? 30000`
  and `opts.model ?? DASHBOARD_FOCUS_INFER_MODEL ?? "haiku"` (lines 311-313).
- Exported at `server/lib/focus-inference.js:604` (`module.exports.runClaudePromptJson`).

No correction needed beyond pinning exact line numbers; the brief's paraphrase is accurate.

---

## Claim 2 — `server/lib/value-summary.js` template functions

**CONFIRMED**, with one feasibility caveat about batching.

- `buildPrompt(units)` — `server/lib/value-summary.js:262-283`. Renders every unit as a
  numbered `[value_source] label, stage=...` line via `unitFacts()` (the single field
  reader, line 170-176), asks the model for a `project` phrase and `stakeholder` sentence
  per unit, and requests strict JSON: `{"units":[{"index":N,"project":"...","stakeholder":"..."}]}`.
- `parseOutput(stdout, count)` — `server/lib/value-summary.js:292-317`. Parses the
  `claude -p --output-format json` envelope, unwraps a possible fenced-code block,
  parses the inner JSON, validates each entry's `index` is in `[1, count]`, drops
  entries missing `project`/`stakeholder`, returns a `Map<index, {project, stakeholder}>`
  or `null` on garbage/empty output — never throws.
- `enrichPoolAltitudes(dbModule, units, opts)` — `server/lib/value-summary.js:398-585`.
  The orchestrator: dedupes by key, reads cache (`readCached`), for cache misses checks
  `llmAvailable()`, batches up to `MAX_UNITS_PER_PROMPT` (40, line 95) misses into **one**
  `runClaudePromptJson` call (line 517), parses with `parseOutput`, and writes results via
  `dbModule.stmts.upsertValueUnitSummary` (line 543). Returns a strict three-way partition
  (`altitudes` / `states` / `counts`) documented at lines 356-397.
- `summaryModel(stage)` — `server/lib/value-summary.js:122-131`. Resolves a per-stage env
  override, then a fallback chain (`DASHBOARD_VALUE_SUMMARY_MODEL` →
  `DASHBOARD_FOCUS_SUMMARY_MODEL` → `DASHBOARD_FOCUS_INFER_MODEL` → `"haiku"`).
  `stage` defaults to `"unit"`; `SUMMARY_STAGES = ["unit", "grouping"]` (line 107) is a
  closed registry — a new `"session"` stage is NOT in it and would need to be added here
  before any session-summary code could call `summaryModel("session")` legitimately (a
  shared-registry-before-downstream-code dependency, see Dependencies below).

**Batching-degrades-to-one caveat (does not invalidate reuse, but is a real shape
mismatch worth flagging for build):** `buildPrompt`/`parseOutput`/`enrichPoolAltitudes`
are explicitly designed and documented (file header, lines 41-43) around "every
not-yet-cached unit in one batch is synthesized in a SINGLE spawn (never one call per
unit)" — the whole point is amortizing one LLM call across many pool units, with
sibling-unit context feeding the `project` altitude (line 273: "read them together, since
some relate to each other"). A session-summary generator operates on exactly one unit (one
session) per invocation — there is no batch, no sibling-relation signal to exploit, and
no cap/overflow/`queued` state to manage (`MAX_UNITS_PER_PROMPT`, the `states` map, and
`reHomeStaleUnits`'s stale-mutable-unit re-homing logic all become dead weight for a
single-item caller). It technically degrades cleanly (a 1-element `units` array works
through the whole pipeline without crashing), but a straight clone of this file's shape
would carry unused batching/staleness machinery. The clean, minimal precedent for a
single-unit synthesis call is actually `focus-inference.js`'s `llmSummarize`/
`buildSummaryPrompt`/`parseSummaryOutput` trio (lines 383-437) — a single-unit,
single-spawn "one plain sentence" pattern already in the same file `runClaudePromptJson`
lives in. Worth naming as an alternate/simpler template during architecture, not just
`value-summary.js`.

---

## Claim 3 — `server/lib/value-summary-tick.js` scheduler + broadcast

**CONFIRMED.**

- Boot-delay + `.unref()`'d interval: `startValueSummaryTick(broadcast)` at
  `server/lib/value-summary-tick.js:602-619`. `BOOT_DELAY_MS = 30_000` (line 68),
  `setTimeout(..., BOOT_DELAY_MS)` with `.unref()` (lines 610-613), then
  `setInterval(..., tickMs)` with `.unref()` (lines 615-618). Disable via
  `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off` or a non-positive
  `DASHBOARD_VALUE_SUMMARY_TICK_MS`.
- Overlap guard: module-scope `let running = false` (line 91), checked/set at the top of
  both `runValueSummaryTickOnce` (line 403-404) and `runCoverageDrain` (line 502-503),
  released in a `finally`. Shared between the two functions (documented as deliberate,
  lines 91-95, "makes the two-writer race... structurally impossible").
- Broadcast: exact call is `broadcast("value_altitudes_updated", payload)` at
  `server/lib/value-summary-tick.js:378`, inside `buildAndMaybeBroadcastCoverage`
  (lines 343-386), gated by `shouldBroadcastCoverage` (lines 200-207: fires when
  `generated > 0` or a `demand`/`complete` transition occurred).
- Wiring to `server/websocket.js`: `broadcast` is destructured from
  `require("./websocket")` in `server/index.js:401` and passed into
  `startValueSummaryTick(broadcast)` at `server/index.js:466-467`. `server/websocket.js`
  defines `function broadcast(type, data)` at line 62 and exports it at line 109
  (`module.exports = { initWebSocket, broadcast, getConnectionCount, closeWebSocket }`).
  So the full chain is: `server/websocket.js:62` (`broadcast`) → `server/index.js:401-402`
  → `server/index.js:466-467` (`startValueSummaryTick(broadcast)`) →
  `value-summary-tick.js:378` (`broadcast("value_altitudes_updated", payload)`).
- Client subscribes to the exact same event name: `client/src/components/PlanLedgerPanel.tsx:865`
  (`if (msg.type !== "value_altitudes_updated") return;`), and the payload type is
  documented in `client/src/lib/types.ts:2831` (`ValueAltitudesUpdatedPayload`) and listed
  in the WS message-type union at `client/src/lib/types.ts:3111`.

No correction needed. A background-sweep session-summary equivalent would need its own
new event name (e.g. `session_summary_updated`) added to the same closed union in
`client/src/lib/types.ts` before a client listener could legitimately subscribe to it —
same "registry before downstream code" ordering as Claim 2's `SUMMARY_STAGES`.

---

## Claim 4 — `PlanLedgerPanel.tsx`'s `AltitudeText` three-state UI

**CONFIRMED**, exact lines match the brief's cited range.

- `AltitudeText` — `client/src/components/PlanLedgerPanel.tsx:433-458`. Three states,
  each returning a distinct muted `<span>`:
  - `altitude === undefined` → `"generating"` placeholder (line 442-446,
    `t("planLedger.pool.altitudes.generating")`).
  - `altitude === "queued"` → `"queued"` placeholder (line 447-449).
  - `typeof altitude === "string"` (i.e. `"unavailable"` or any other unrecognized
    string) → `"unavailable"` fallback (line 450-456).
  - Otherwise (a resolved object) → renders `altitude[field]` (line 457).
- The component's own doc comment (lines 426-432) states the intent explicitly: "a muted
  'generating…'/'queued'/'unavailable' placeholder — never blank, so the row's three-line
  shape never jumps as altitudes resolve." This is the exact three-state (not
  boolean/undefined) contract §9.8 OVERLOADED-ABSENCE in `PROJECT-CONTEXT.md` requires,
  and the brief's citation is accurate.
- WS-driven flip (not polling): the parent panel listens for `value_altitudes_updated` at
  `client/src/components/PlanLedgerPanel.tsx:865` and refetches only the named
  `unit_keys`' altitude text (per the WATCH-S2-B test name in
  `client/src/components/__tests__/PlanLedgerPanel.test.tsx:1209`), which is what
  ultimately changes the `altitude` prop `AltitudeText` renders — `AltitudeText` itself is
  a pure render function with no WS subscription of its own; the subscription lives one
  level up, in the panel that owns the fetch.

No correction needed. One note for build: a session-summary equivalent would need its own
new component (not a literal reuse of `AltitudeText`, which is typed specifically to the
`Altitude` union in `client/src/lib/types.ts` for value-pool units) but can copy this exact
three-state pattern faithfully.

---

## Claim 5 — `server/db.js` `sessions` table + `value_unit_summaries` template + migration mechanism

**CONFIRMED**, with corrected line numbers and an important schema-mechanism finding.

- `sessions` table: `server/db.js:139-148`.
  ```
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','error','abandoned')),
    cwd TEXT, model TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime(...)), ended_at TEXT, metadata TEXT
  );
  ```
  Confirms the brief's claim: no column here holds a cached summary — `metadata` is a
  free-form TEXT blob (used elsewhere for other purposes, not this). `id` is `TEXT`, not
  numeric — relevant to the route-path claim below.
- `value_unit_summaries` table: `server/db.js:835-856` (brief said "~835-860"; body ends at
  856, close enough — confirmed accurate).
  ```
  CREATE TABLE IF NOT EXISTS value_unit_summaries (
    unit_key TEXT PRIMARY KEY, project_level TEXT NOT NULL, stakeholder_level TEXT NOT NULL,
    model TEXT, created_at TEXT NOT NULL DEFAULT (strftime(...)),
    input_stage TEXT, input_label TEXT, regenerated_at TEXT, regen_reason TEXT, seen_at TEXT
  );
  ```
  A reasonable template shape for a new `session_summaries` table: swap `unit_key` for
  `session_id TEXT PRIMARY KEY` (or `session_id TEXT UNIQUE` if row-id access is ever
  wanted), keep `model`/`created_at`, and either keep `input_*`/`regenerated_at`/
  `regen_reason` for a future staleness/regenerate story (brief's open question #3) or
  drop them if the brief's "only summarize once ended/stable" simplifying assumption ships
  as stated — no `seen_at` need, since there's no "unseen regeneration" concept proposed
  for this feature.
- **Migration/schema-versioning mechanism — no separate migration framework exists.**
  The entire schema (all `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
  blocks) lives in one large `db.exec(...)` template literal starting at
  `server/db.js:138`, executed unconditionally on every process boot (Express server, MCP
  server, Electron app, VS Code extension all load this same file). Adding a brand-new
  table is simply adding another `CREATE TABLE IF NOT EXISTS` block to that same schema
  script — idempotent by construction, no numbered/versioned migration file to author.
  Two separate helper functions exist for *altering* existing tables, neither of which a
  new table needs: `addColumnsIfMissing({table, columns})` (`server/db.js:1752-1776`,
  additive ALTER-per-missing-column, probed via `PRAGMA table_info`) and
  `rebuildTableAtomically(...)` (referenced around `server/db.js:1710-1733`, used for
  destructive/CHECK-constraint schema changes on existing tables, e.g.
  `coach_observations` at line 1778). Neither is required for a net-new
  `session_summaries` table — a plain `CREATE TABLE IF NOT EXISTS` after the existing
  `sessions`/`value_unit_summaries` blocks is the correct and sufficient pattern, matching
  every other net-new table in this file.

No correction to the brief's substance; only the migration-mechanism answer needed
confirming from scratch (it wasn't in the brief) — now confirmed: **no hook required,
just add the `CREATE TABLE IF NOT EXISTS` block.**

---

## Claim 6 — New route placement

**CONFIRMED (sibling patterns), route path is a proposal, not yet verified against a spec.**

- `server/routes/sessions.js` existing session-detail-adjacent routes (mounted at
  `/api/sessions` — `server/index.js:105`, `app.use("/api/sessions", sessionsRouter)`):
  - `GET /:id` — `server/routes/sessions.js:336` — full session detail (session + agents +
    events + workflows).
  - `GET /:id/stats` — line 371.
  - `GET /:id/transcript` — line 916 — reads the session's JSONL transcript file
    (`getTranscriptPath`/`findTranscriptPath`/`getSnapshotTranscriptPath`, lines 942-947),
    paginated by `limit`/`after`/`before`/`offset` query params. **Important for
    feasibility**: this route confirms the brief's "no persisted transcript text
    server-side" claim — transcript content lives only in on-disk JSONL files (live
    `~/.claude/projects` copy or the dashboard's own snapshot fallback), read on demand,
    never stored as a DB blob. A session-summary generator's prompt-building step would
    need to reuse this same file-resolution/read logic (or call the route internally) to
    get transcript text, which is a materially different data-gathering step than
    `value-summary.js`'s (which reads already-structured DB rows via `assembleValuePool`).
    This is real, not-yet-scoped work the brief's "reuse the synthesis-layer pattern"
    framing doesn't cover — flag for architecture.
  - Session `id` is `TEXT` (confirmed above), so the route pattern is bare `/:id`, not
    `/:id(\\d+)` — matches what's already there.
- `server/routes/project-plans.js`'s sibling template, `POST /api/project-plans/altitudes`
  — `server/routes/project-plans.js:149-218` (mounted at `/api/project-plans`,
  `server/index.js:135`). On-demand synchronous synthesis: validates body, calls
  `enrichPoolAltitudes`, writes an audit-log row in a guarded `try/catch` (so a logging
  failure never sinks an already-succeeded response), returns `{altitudes, states, counts}`.
  This is a reasonable on-demand template for the trigger model the brief's non-blocking
  question #2 recommends (view-triggered, not a background sweep).

**Concrete proposed new route (not yet in the codebase — my own proposal, following the
sibling shapes above):** `POST /api/sessions/:id/summary` — on-demand, mirrors
`POST /altitudes`'s synchronous-call shape (call the new synthesis function, write a cache
row, return the result), living alongside the existing `GET /:id/transcript` in
`server/routes/sessions.js`. A `GET /:id/summary` (cache-read-only, no generation) is also
plausible if the client wants to probe for a cached result before triggering generation,
mirroring `GET /coverage`'s read-only counterpart to `POST /coverage-request` in
project-plans.js (lines 344 vs. 299) — worth deciding explicitly at architecture time
rather than defaulting silently, since it changes whether the client does a single
POST-that-may-return-cached-or-generate call or a GET-then-conditionally-POST pattern.

---

## Overall feasibility note

All four cited files/functions/line-ranges exist and are shaped essentially as the brief
described — the "reuse this precedent" bet holds up on direct read, not just on the
brief's paraphrase. The one place reuse is less than a straight copy-paste:

1. **Batching mismatch (Claim 2):** `value-summary.js`'s core value is amortizing many
   units into one LLM call; a session summary is a single-unit operation, so the batching/
   cap/overflow machinery in `enrichPoolAltitudes` is overhead, not benefit. The simpler,
   more literal precedent for a single-unit synthesis call already lives in the same
   `focus-inference.js` file as `runClaudePromptJson` itself:
   `llmSummarize`/`buildSummaryPrompt`/`parseSummaryOutput` (lines 383-437) — worth
   surfacing to architecture as the closer-fit template.
2. **Transcript-read step is net-new work (Claim 6):** there is no existing "get this
   session's full transcript text as a string" helper reused wholesale by
   `GET /:id/transcript` — that route streams/paginates the JSONL file. A summary
   generator needs a bounded, single-shot digest of a session's transcript (analogous to
   `focus-inference.js`'s `buildActivityDigest`, lines 118-166, which already digests a
   session's `events` table rows into prompts/files/commands) — likely closer in shape to
   `buildActivityDigest` + a transcript-specific extension than to anything in
   `value-summary.js`.
3. **Two closed registries need entries added before downstream code can compile/behave
   correctly** (ordering dependency for build): `SUMMARY_STAGES` in
   `value-summary.js:107` (if a "session" stage is added to `summaryModel`) and the WS
   message-type union in `client/src/lib/types.ts:3111` (for any new broadcast event name).
   Neither blocks starting the work, but both must land before the code that references
   them, per this repo's stated §9.1/registry-before-consumer convention.

T-shirt sizing and full build-order sequencing were explicitly out of scope for this FAST
pass — deferred to build per the run-plan.
