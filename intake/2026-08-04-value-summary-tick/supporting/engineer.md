# Engineer notes — value-summary tick (2026-08-04)

Scope: Sara's sketched direction (background tick + read-only endpoint + WS
push + observability layer), evaluated against the code as it exists today.
Nothing below is a recommendation to build all four pieces at once — see
Dependencies & order and the brief's non-blocking Q3 (parity-UI sequencing).

## 1. Exact change set

### Layer A — the tick itself (net-new)

- **New file `server/lib/value-summary-tick.js`.** Owns: candidate-project
  selection, per-project batching against `enrichPoolAltitudes`, the
  overlap-guard/interval wiring, and the `broadcast()` call. Mirrors
  `server/lib/focus-inference.js`'s `startFocusInference` (lines 554–591) —
  same `running` boolean guard, same boot-timer + `setInterval` pair, both
  `.unref()`'d, same `_MODE=off` / `_MS=0` disable convention. Also worth
  modeling `server/index.js`'s `startRemoteSourceSync` (lines 523–557),
  which is closer in shape (multi-target sweep with a cheap gate before
  doing real work) than `startFocusInference` (single-session loop).
- **`server/lib/value-summary.js` — reused, not restructured.**
  `enrichPoolAltitudes(dbModule, units)` (lines 153–189) already accepts an
  arbitrary unit batch and is stateless w.r.t. caller identity — the tick
  can call it exactly as `/altitudes` does today, no signature change
  needed. `MAX_UNITS_PER_PROMPT = 40` (line 39) does **not** need to change
  shape: the module's own contract is "misses beyond the cap are left
  unenriched this round … will resolve on a later call once earlier units
  are cached" (lines 141–143, 170) — that sentence was written anticipating
  exactly a tick-driven caller. A tick that calls `enrichPoolAltitudes` once
  per project per tick will self-heal a >40-unit project over consecutive
  ticks with zero code change to this file. What *would* need a decision
  (not code) is a new "batch-size-per-tick" N distinct from the per-prompt
  cap — see brief's non-blocking item — but that's a tick-loop concern
  (how many *projects* per tick, and whether a >40-unit project gets more
  than one `enrichPoolAltitudes` call in the same tick), not a
  `value-summary.js` concern.
- **`server/lib/value-ledger.js`'s `assembleValuePool`** (lines 126–…) is
  the pool composer the tick must call to get each project's units before
  handing them to `enrichPoolAltitudes` — confirmed no other legal path to
  pool membership exists (module header states this explicitly, and
  `CONSUMERS` at line 57 is the DEC-16 tripwire list the tick would need to
  join). **Cost finding (see Gotchas below): this call does live git work,
  not a cache read.**
- **`server/index.js`** — one new `try { startValueSummaryTick(broadcast); } catch { … }`
  block inside `startBackgroundServices()` (currently lines 343–511),
  alongside the other `try/catch`-wrapped tick registrations (e.g. lines
  453–458 for reconciliation, 462–467 for the Coach engine). Same
  boilerplate: `console.warn` on failure, never let one tick's init crash
  the others.

### Layer B — making the interactive endpoint read-only

- **`server/routes/project-plans.js`'s `POST /altitudes`** (lines 126–155).
  Today it always calls `enrichPoolAltitudes` (line 153), i.e. it is the
  one and only write path into `value_unit_summaries` right now (via
  `dbModule.stmts.upsertValueUnitSummary`, called inside
  `enrichPoolAltitudes` at value-summary.js line 179). Going read-only means
  this route would call a **new** read-only helper (e.g.
  `valueSummary.readCachedAltitudes(dbModule, units)` — essentially
  `enrichPoolAltitudes`'s existing `readCached` loop at lines 157–165,
  factored out and exported) instead of `enrichPoolAltitudes`. This is a
  small, mechanical extraction: `readCached` (lines 65–75) is already a
  private, side-effect-free function — exporting it (or a thin wrapper) is
  the whole change on this file. The response shape (`{ altitudes }`) is
  unchanged, so `PlanLedgerPanel.tsx`'s existing `.then((res) => ...)`
  consumer needs no shape change, only new trigger wiring (Layer C).
- Everything else in this route file is untouched — `/pool`, `/health`,
  claims, etc. are orthogonal to this change.

### Layer C — client: read-only fetch + WS-driven re-render

- **`client/src/components/PlanLedgerPanel.tsx`.** The altitude effect at
  lines 528–558 (`requestedAltitudesRef` + `altitudes` state) still works
  as the *initial* fetch (a fresh page load should show whatever's already
  cached), but its fetch target now returns a *partial* map deterministically
  (no LLM spawn on this path), and a unit missing from the response should
  render "Generating…" (already the existing fallback: see the render
  function above line 332, `t("planLedger.pool.altitudes.generating")`) —
  today that string is shown transiently until the request resolves; under
  read-only it can stay shown indefinitely until a tick fills it in, which
  is exactly the UX regression flagged in the brief's non-blocking item #2.
  New code needed: a **second `useEffect`** (there is currently zero
  `eventBus` import in this file — confirmed by grep, so this is genuinely
  new wiring, not extending an existing subscription) that calls
  `eventBus.subscribe` for the new `value_altitudes_updated` message type,
  filters by `projectId`/unit keys in the payload, and merges into the
  `altitudes` state map (same `setAltitudes((prev) => ({...prev, ...}))`
  shape already used at lines 538–545). Cleanup via the returned
  unsubscribe function, matching every other page's pattern (e.g.
  `client/src/pages/CoachPage.tsx:50`, `client/src/pages/Dashboard.tsx:1082`).
- **`client/src/lib/eventBus.ts`** itself needs **no code change** — `publish`/
  `subscribe` are already generic over `WSMessage`, and adding a new `type`
  is purely additive at the type level (see next bullet). This file is
  correctly designed for this addition; nothing to do here beyond the
  type union edit below.
- **`client/src/lib/types.ts`'s `WSMessage.type` union (~line 2921) and its
  paired `data` union (~line 2947) MUST be extended** with
  `"value_altitudes_updated"` and a new payload interface (e.g.
  `ValueAltitudesUpdatedPayload { project_id: string; altitudes: Record<string, {project:string; stakeholder:string}> }`).
  This is a **hand-maintained** union per its own doc comment ("must only
  ever grow — never rename or repurpose"); TypeScript will not catch a
  missed entry here because `eventBus.publish`/`subscribe` accept `WSMessage`
  generically — a component narrowing on `msg.type === "value_altitudes_updated"`
  without the union entry just fails to narrow silently or requires an `as`
  cast, it does not fail to compile the subscribe call itself. **This is the
  single most important "must stay in sync" surface in this whole change** —
  see Gotchas.

### Layer D — server → client wire: new broadcast type

- **`server/websocket.js`'s `broadcast(type, data)`** (line 62) needs **no
  code change** — it is a generic `(type, data)` pair-through with no
  registry of valid `type` strings server-side. The tick just calls
  `broadcast("value_altitudes_updated", { project_id, altitudes })` from
  wherever `enrichPoolAltitudes` resolves inside the new tick file. This is
  genuinely as simple as it looks on the server side.

### Layer E — observability (largest, most optional piece — brief's Q3)

- **New table** (mirroring `focus_summary_access_log`, `server/db.js` lines
  1779–1794): something like `value_summary_generation_log` — one row per
  tick's attempt at one unit or one project-batch (hit/miss/spawned/error),
  `created_at`-ordered per §9.2. Added the same way
  `focus_summary_access_log` was: a new `CREATE TABLE IF NOT EXISTS` +
  indexes inside a `db.exec(...)` block in `server/db.js` (no formal
  migration runner in this project — confirmed: every schema addition here
  is an in-place `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`,
  see the `value_unit_summaries` table itself at lines 826–832 for the most
  recent precedent).
- **New write call site**: inside the new tick file (Layer A), not inside
  `value-summary.js` — mirrors how `focus_summary_access_log` writes live in
  `focus-summary.js`'s own read/write decision points, not in a shared
  helper. `dbModule.stmts` would need two new prepared statements
  (`insertValueSummaryLog` or similar), added to `server/db.js` next to
  `getFocusSummary`/`upsertFocusSummary`/`upsertFocusSummary` block around
  line 2965–2985.
- **New routes**: `GET /api/settings/cache/value-timeline` and
  `GET /api/settings/cache/value-day` (or reuse `/cache/timeline` +
  `/cache/day` with a `?kind=value` discriminator — worth a design decision,
  since duplicating `server/routes/settings.js` lines 191–227 and 266–…
  nearly verbatim for a second cache table is the kind of copy Sara's own
  DERIVED-DUAL-VIEW concern would flag if done carelessly; a shared
  parameterized helper is the safer shape here, not a hard requirement of
  this brief but worth flagging to design).
- **New Settings UI section**, mirroring `client/src/components/CacheSection.tsx`
  (626 lines) — this is the single biggest line-count item in the whole
  request if built as a full parallel section rather than a parameterized
  reuse of `CacheSection.tsx` itself.
- **Settings "clear cache" gap already exists and would need extending**:
  `server/routes/settings.js`'s cleanup route (lines 172–189) deletes
  `focus_summary_access_log` (line 186) but **does not currently delete
  `value_unit_summaries` or `value_claims`** at all — confirmed by grep,
  zero hits for either table in that file. This is a pre-existing gap
  outside this ticket's direct scope, but if a `value_summary_generation_log`
  table is added, it is very easy to add the log table without also adding
  it to this cleanup route (the sibling `focus_summary_access_log` line is
  a single line, easy to forget its new twin).

## 2. Feasibility

- **Not as simple as it looks**, for two independent reasons:
  1. The interactive-endpoint-to-read-only migration (Layer B) is
     mechanically trivial (~10 lines) but **behaviorally is the UX
     regression the brief itself already flags** (non-blocking item #2):
     a brand-new unit today gets same-visit synthesis below the 40-cap;
     under pure read-only it always waits for the next tick. This is a
     product trade, not an engineering blocker, but it means "read-only"
     cannot be scoped as a drop-in swap without a design answer on the
     hybrid-vs-pure-read-only fork the brief names.
  2. The tick's cost profile is **not** "cache read + occasional LLM spawn"
     — `assembleValuePool` (Layer A's dependency) does live git work
     (`git log` via `trunk-drift.js`, `git rev-parse`-equivalent repo-root
     resolution via `cwd-identity.js`, `isGitRepo` checks) on **every**
     call, cache or no cache on the LLM side. A tick that sweeps N projects
     every tick pays N full pool-assembly costs regardless of how many
     units are already `value_unit_summaries`-cached — the caching in
     `value-summary.js` only saves LLM spawns, not git scans. This directly
     feeds the brief's open Q1 (sweep scope) — "every project with any pool
     units ever" is the expensive-by-construction answer; "projects with an
     open plan" is cheaper but still one git-scan per project per tick.
- **No variant branches inside `enrichPoolAltitudes`/`buildPrompt`/`parseOutput`
  themselves** — these are already source-agnostic (they operate on the
  generic unit shape regardless of `value_source` being `trunk_commit` /
  `merge_commit` / `intake_initiative` / `detour`), so there is no per-source
  special-casing the tick needs to replicate. The variant surface that does
  matter is at the **project** level (does the tick treat a project with no
  git repo, or no open plan, differently — see `identityWarnings` handling
  in `assembleValuePool`, lines 134–169), which is a scope decision, not a
  code-branching cost.

## 3. Effort estimate

| Piece | Size | Why |
|---|---|---|
| Layer A (tick file + registration) | **M** | New file, but the pattern is a near-verbatim mirror of `focus-inference.js`'s tick + `assembleValuePool`/`enrichPoolAltitudes` reuse (no new algorithm). Complexity is in getting the overlap-guard + per-project batching + cost-aware sweep-scope right, not in new logic. |
| Layer B (read-only endpoint) | **S** | Extracting `readCached`'s loop into an exported read-only helper and swapping the route's call. |
| Layer C (client fetch + WS re-render) | **M** | Genuinely new `useEffect`/subscription wiring in a file that has none today, plus the "Generating…" indefinite-wait UX needs a design answer (spinner vs. static text vs. timestamp) rather than being a pure mechanical port. |
| Layer D (WS type) | **S** | Server-side broadcast call is trivial; the real cost is Layer C's type-union edit + verifying no other type-narrowing switch needs a new case. |
| Layer E (observability: table + 2 routes + Settings UI section) | **L** | 626-line `CacheSection.tsx` precedent alone signals this; a full parallel build (rather than parameterizing the existing component/routes) is the largest single piece of the whole request, as the brief itself already flags in Q3. |
| **Whole request, all layers** | **L** | Layer E dominates; A–D alone would be **M**. |

## 4. Dependencies & order

1. **DB schema first** (Layer E's `value_summary_generation_log`, if in
   scope) — must exist before the tick can log to it, same "shared registry
   before downstream code" rule this project applies elsewhere (e.g.
   `VALUE_SOURCES`/`ATTRIBUTION_TIERS` existing before routes validate
   against them).
2. **Tick (Layer A) before read-only cutover (Layer B)** — flipping
   `/altitudes` to read-only before the tick exists (and is verified to
   actually populate the cache) would strand every uncached unit
   permanently in "Generating…" with nothing to ever resolve it. This
   ordering constraint is not optional.
3. **WS type union (Layer C's `types.ts` edit) before the client
   subscription effect** — same "single source, two writers" shape as
   §9.1: the union must land before any component narrows on the new
   `type` string, otherwise the narrowing either doesn't compile cleanly
   or silently widens to `never`/`any` depending on how it's written.
4. **Layer D (server broadcast call) can land any time after Layer A**,
   since `broadcast()` itself needs no change — but it's pointless to ship
   before Layer C's subscriber exists (a broadcast nobody listens to is a
   silent no-op, easy to "ship" and believe it works).
5. **Layer E's Settings UI/routes have no hard dependency on A–D** and can
   genuinely be sequenced as a fast-follow, per the brief's own framing —
   this is the one layer where "ship now vs. later" is a real, low-risk
   option, unlike 1–4 which have real ordering constraints.

## 5. Gotchas

- **The `WSMessage` union in `client/src/lib/types.ts` is already out of
  sync with the server today**, on this exact feature's neighboring
  routes: `server/routes/project-plans.js` broadcasts `"project_plan_updated"`
  (lines 173, 197, 222, 244, 252, 262) and `"value_claim_updated"` (lines
  360, 379) — **neither string appears anywhere in the `WSMessage.type`
  union** (confirmed by grep against `types.ts`; the union only has the
  unrelated `"plan_updated"`, the legacy cwd-keyed mirror's event, not the
  portfolio-layer `project_plan_updated`). This is a live, pre-existing
  instance of exactly the "must stay in sync" defect class the request
  itself is worried about (§9.1 DERIVED-DUAL-VIEW), sitting right next to
  where this change lands — worth fixing incidentally while touching this
  union for `value_altitudes_updated`, or at minimum flagging so the new
  entry doesn't get added while the two existing gaps are left to rot
  further.
- **`PlanLedgerPanel.tsx` does not currently listen to *any* WebSocket
  message** — confirmed zero `eventBus` import in the file. Today it
  refreshes only by calling `load()` itself after its own claim/close
  actions (lines 560–573, `handleClaim`). This means Layer C is not "add
  one more case to an existing switch," it is wiring live-update behavior
  into a panel that has never had it, for *any* of its data (plans, pool,
  health) — worth confirming whether the WS message should re-fetch just
  altitudes (cheapest, matches this ticket's scope) or trigger a full
  `load()` (broader, but would also silently start reacting to
  `project_plan_updated`/`value_claim_updated` broadcasts from OTHER
  clients editing the same project concurrently, which the panel has never
  had to handle before — a scope question, not just an implementation
  detail).
- **Second-write-path risk during the read-only migration transition**
  (the brief's own §9.1 flag): once Layer B ships, `POST /altitudes` must
  call **only** the new read-only helper — if the migration is done as an
  "if tick-mode enabled, read-only; else, old behavior" branch (a plausible
  incremental-rollout shape), that branch is a second write path that a
  structural single-writer-guard test (mirroring
  `server/__tests__/single-writer-guard.test.js`) would need to explicitly
  catch. Per the brief's own citation of §9.7, any such guard should be
  scoped narrowly to `upsertValueUnitSummary`'s call sites specifically
  (today: exactly one, inside `enrichPoolAltitudes` at value-summary.js
  line 179) — not a broad hand-written file list that silently misses a
  future third caller.
- **In-flight-request-vs-tick race on the same cache row**: `upsertValueUnitSummary`
  (`server/db.js` ~line 3148) is a plain `INSERT ... ON CONFLICT` (need to
  confirm exact upsert clause, but the table's `unit_key TEXT PRIMARY KEY`
  shape means a second write for the same key is idempotent — same
  project/stakeholder text would just overwrite itself since both writers
  derive from the same immutable ground fact and the same model). Real risk
  is not data corruption but a wasted duplicate LLM spawn if the read-only
  cutover isn't complete (interactive endpoint still enriching some units
  the tick is concurrently enriching) — another reason Layer B must fully
  land, not partially, before declaring the single-writer invariant true.
- **Cost, not correctness, is the sharpest edge**: as noted in Feasibility,
  `assembleValuePool`'s git-scan cost is paid per project per tick
  regardless of `value_unit_summaries` cache hit rate. A naive "sweep every
  project with any pool unit ever" (brief's Q1, worst-case option) turns
  every tick interval into O(project count) `git log` walks — this is the
  concrete cost concern the parent flagged, and it's real, confirmed by
  reading `assembleValuePool`'s body (calls `isGitRepo`, `repoRootFor`, and
  (deeper in the function, past what's excerpted above) `detectTrunkDrift`,
  which runs `git log`).
- **`value_unit_summaries` and `value_claims` are absent from the Settings
  "clear data" cleanup route** (`server/routes/settings.js` lines 172–189)
  — a pre-existing gap, not introduced by this ticket, but if Layer E adds
  `value_summary_generation_log` it would be easy to add only the *new*
  log table to that cleanup route (mirroring `focus_summary_access_log`'s
  line 186) while leaving `value_unit_summaries` still absent — the two
  omissions look identical from inside a diff review and only one would be
  "new" to this change.

## 6. Verification hooks

- **`server/__tests__/value-summary.test.js`** — covers `parseOutput`,
  `buildPrompt`, and `enrichPoolAltitudes` caching/batching (describe
  blocks at lines 130, 176, 193) via `focus-inference.js`'s
  `__injectSpawnForTest` seam (imported at line 31, used at 114/124 for
  reset). A new tick's own tests should reuse this exact seam — the tick
  calls the same `runClaudePromptJson` spawn path transitively through
  `enrichPoolAltitudes`, so `__injectSpawnForTest` is the only way to test
  it hermetically (no real `claude` CLI), same as this file's own header
  comment states (line 9).
- **`server/__tests__/focus-summary.test.js`** — the closest existing
  precedent for testing a cache+access-log pair (`focus_summaries` +
  `focus_summary_access_log`); if Layer E's `value_summary_generation_log`
  is built, its tests should mirror this file's hit/miss/day-bucket
  assertions rather than being invented from scratch.
- **`server/__tests__/focus-inference.test.js`** — notably has **no**
  `describe("startFocusInference", ...)` block; only the pure functions
  (`buildActivityDigest`, `heuristicClassify`, `parseLlmOutput`,
  `listCandidates`, `inferSession`) are tested, not the tick-loop wiring
  itself (interval registration, overlap guard, env-var disable). This
  means there is **no existing precedent test to lean on** for the
  interval/overlap-guard behavior specifically — a new
  `value-summary-tick.test.js` would need to write that coverage from
  scratch (e.g. asserting a second `tick()` call while one is in-flight is
  a no-op, and that `DASHBOARD_VALUE_SUMMARY_TICK_MS=0`/`_MODE=off`
  disables registration), rather than copying an existing test.
- **`server/__tests__/single-writer-guard.test.js`** — the structural
  pattern (source-scanning for a symbol's call sites, e.g. lines 44–71's
  `upsertPlanItem` check) is exactly what the brief asks to mirror for
  `upsertValueUnitSummary`, scoped to it and nothing else per §9.7.
- **`server/__tests__/project-plans-api.test.js`** — confirmed the actual
  route test file (not `project-plans.test.js`). It does not currently
  assert on `POST /altitudes` at all (no `altitudes` hits in a grep of the
  file) — Layer B's route-level test coverage would be net-new here, not an
  update to an existing case.
- **`client/src/components/__tests__/PlanLedgerPanel.test.tsx`** — already
  has direct, load-bearing coverage of the exact UX this change touches:
  `"shows a generating placeholder for Project/Stakeholder before altitudes
  resolve, then the resolved text"` (line 370) and `"shows an unavailable
  placeholder when a unit is missing from the altitudes response"` (line
  411), both driving `api.projectPlans.altitudes` through a mock (line 40).
  These are the tests that would catch a mistake in Layers B/C most
  directly — the first would need updating once "generating" can persist
  indefinitely under read-only mode rather than always resolving within the
  same test tick, and a new WS-reactivity case (mirroring how other pages'
  `eventBus.subscribe` tests inject a message) would need to be added for
  the new subscription effect. No existing case in this file exercises
  `eventBus` at all today (confirmed no `eventBus` hits in the file), so
  that coverage is net-new, not an extension of an existing case.
