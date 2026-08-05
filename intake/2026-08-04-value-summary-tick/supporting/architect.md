# Architect Assessment — Value Summary Tick

**Intake:** `intake/2026-08-04-value-summary-tick/`
**Scope of this pass:** system/design evaluation of Sara's sketched direction
(background tick + read-only endpoint + WebSocket push + observability
layer) for `server/lib/value-summary.js`'s PROJECT/STAKEHOLDER altitude
synthesis. No code changed by this pass.

## 1. Affected subsystems & boundaries

- **`server/lib/value-summary.js`** — the synthesis layer itself
  (`enrichPoolAltitudes`, `MAX_UNITS_PER_PROMPT = 40`, `value_unit_summaries`
  cache table). Owns: batching discipline, the `runClaudePromptJson` spawn
  contract (shared with `focus-inference.js`), cache read/write.
- **`server/lib/value-ledger.js`** — pool assembly (`assembleValuePool`).
  Owns: what units exist at all. Declares itself (file header, DEC-16) the
  **sole composer**; `CONSUMERS` is a hardcoded, test-enforced allowlist of
  who may call it directly (see §3/§4 below — this is a real mechanical gate,
  not prose).
- **`server/routes/project-plans.js`** — `GET /pool` (calls
  `assembleValuePool`), `POST /altitudes` (calls `enrichPoolAltitudes` on a
  client-supplied unit batch, currently on the request path, currently the
  *only* writer of `value_unit_summaries`).
- **`server/index.js`** — `startBackgroundServices()`, the single wiring
  point for every tick in this app (focus inference, focus audit,
  reconciliation, playbook engine, account capture, workflow/plan poll,
  session sync, remote sync). A new tick belongs here, following the
  established `try { require(...); start...(broadcast) } catch (err) {
  console.warn(...) }` per-service isolation pattern — one service failing
  to start must never take another down.
- **`server/db.js`** — schema owner. `value_unit_summaries` (existing) and
  any new `value_summary_generation_log`-style table land here as
  `CREATE TABLE IF NOT EXISTS` + indexes, following the
  `focus_summary_access_log` precedent (lines ~1779-1795).
- **`server/websocket.js`** — `broadcast(type, data)` is a flat, unfiltered
  fan-out to every connected client (no project/room scoping server-side —
  clients filter by `project_id` in the payload themselves). A new
  `value_altitudes_updated` type is additive here; no structural change
  needed.
- **`client/src/components/PlanLedgerPanel.tsx`** — `altitudes` state,
  the `requestedAltitudesRef`-gated fetch effect (lines ~528-558), and
  (net-new) a WS-message handler wired through the existing `eventBus`
  pattern (`client/src/hooks/useWebSocket.ts` → `client/src/lib/eventBus.ts`
  → `App.tsx`'s `eventBus.publish(msg)`).
- **Settings surface (net-new)** — would mirror
  `server/routes/settings.js`'s `GET /cache/timeline` / `GET /cache/day`
  and the client's `CacheSection.tsx` (Settings → Focus Summaries).

## 2. Current design

Today, `POST /api/project-plans/altitudes` is synchronous and
request-path-triggered: the client's `/pool` fetch resolves the ground
units, then a separate effect calls `/altitudes` with whatever units it
hasn't yet requested this page-life. Server-side, `enrichPoolAltitudes`
reads the cache, batches every uncached miss into **one** `claude -p` spawn
capped at `MAX_UNITS_PER_PROMPT = 40`, and writes hits back to
`value_unit_summaries` (keyed by immutable `unitKey`, no digest gating —
"generated once, served forever," unlike `focus_summaries`' digest-gated
cache). Anything past the 40-cap, or any spawn/LLM-unavailability failure,
comes back simply absent from the response — the client shows "Generating…"
indefinitely, indistinguishable from "will never resolve this session."

This module explicitly declines to call `assembleValuePool` itself — its own
header states callers must pass the exact units their own `/pool` fetch
already resolved, "so this module never re-derives or duplicates pool
assembly (value-ledger.js's DEC-16 tripwire stays intact)." That's the
established pattern this project uses for exactly this kind of surface: **one
composer (`assembleValuePool`), one small, test-enforced allowlist of direct
callers** (`value-ledger.js`'s own `CONSUMERS` export: currently
`["server/routes/project-plans.js", "bin/ccam.js (cmdLedger)"]`, asserted
verbatim by `server/__tests__/ledger-metrics-parity.test.js` test **C2.4**,
which does an exact `deepEqual` against that literal array). A third direct
caller isn't just "worth a design note" — it is a **currently red test** the
moment it's written, by design, so it can never land silently. This is a
stronger and more concrete instance of the DEC-16 tripwire than the intake
brief's "worth stating as an acceptance criterion" framing suggests: it's a
mechanical gate already in the repo, not something that needs to be built.

`focus-inference.js`'s `startFocusInference()` is the direct architectural
precedent for "background tick synthesizing via `claude -p`, wired through
`startBackgroundServices()`": boot-delay timer + steady-state
`setInterval`, both `unref()`'d (never blocks process exit/shutdown), an
in-tick `running` boolean overlap guard (skip this tick if the previous one
hasn't finished — no queueing, no concurrent ticks), env-var cadence
(`DASHBOARD_FOCUS_INFER_MS`, `<=0` disables), env-var mode
(`DASHBOARD_FOCUS_INFER_MODE=off` disables entirely), a bounded per-tick
candidate limit (`MAX_SESSIONS_PER_TICK = 5`), and a shared, hermetic,
never-throwing spawn contract (`runClaudePromptJson`, already reused
verbatim by `value-summary.js`). `reconciliation.js` is the closer precedent
for *multi-target-per-tick* scoping specifically:
`listReconcileTargets(dbModule, limit)` selects `ORDER BY p.updated_at DESC
LIMIT ?` (recency-bounded, not "every project/plan that ever existed"), and
exposes both the per-sweep target count (`MAX_TARGETS_PER_TICK`, default 10)
and a per-target work cap (`MAX_DETOURS_PER_TICK`, default 10) as separate
env-tunable numbers — precisely the two-dimensional "N per tick" shape this
request's own open question #1/trailing note needs.

`focus_summary_access_log` (`server/db.js` ~1779) is the observability
precedent: a flat append-only log table (`cache_key`, `level`, `outcome`
hit/miss, scope columns, `accessed_at`), two read routes
(`/cache/timeline` for a raw hit/miss stream over an exact instant range,
`/cache/day` for one day's summary + drill-down rows, both capped —
`MAX_TIMELINE_ROWS = 20000`, 500-row day cap — with a `truncated` flag
rather than silently dropping), and an explicit client-owns-timezone-bucketing
design note (day bucketing happens in `CacheSection.tsx`, not server-side,
because only the browser knows the viewer's local midnight).

SQLite concurrency posture (`server/db.js`): `journal_mode = WAL` +
`busy_timeout = 5000` are already set globally. This is the standing answer
to "can a tick and an interactive request write concurrently without
corrupting/blocking" — WAL allows concurrent readers with one writer, and
`busy_timeout` makes a second writer retry for up to 5s rather than
immediately erroring `SQLITE_BUSY`. This is existing infrastructure, not
something this request needs to add.

## 3. Options

**Option A — Full read-only endpoint + pure background tick (Sara's sketch).**
`POST /altitudes` becomes a cache-only read (drop the `enrichPoolAltitudes`
call, keep the cache lookup). A new `value-summary-tick.js`, wired into
`startBackgroundServices()`, is the sole writer of `value_unit_summaries`,
mirroring `startFocusInference()`'s shape exactly. New WS message
`value_altitudes_updated` pushes updates as they land.
- *Pro:* Cleanest single-writer story — the DERIVED-DUAL-VIEW /DEC-16-style
  discipline this project has been burned by (see §9.1's five recorded
  touches) is trivially satisfied: exactly one write path, structurally,
  not just by convention.
- *Con:* Regresses the common case. A project with <40 units today gets
  same-visit synthesis; under Option A it always waits for the next tick
  (minutes, by cadence). This is the brief's own flagged open question #2 —
  a real, not hypothetical, UX cost for the *majority* of projects (most
  won't be at the 100+-unit scale motivating this request at all).

**Option B — Hybrid: request path keeps the existing ≤40 fast path, tick
sweeps the overflow.** `POST /altitudes` stays as it is today (synchronous,
bounded by `MAX_UNITS_PER_PROMPT`, writes cache) for whatever a single
`/pool` fetch's miss-list contains up to the existing cap; the new tick's
job is specifically to sweep the *remainder* — units still uncached after
several batches, i.e. genuinely large pools — across projects, on a slow
cadence, in the background.
- *Pro:* Preserves today's working behavior for the common case (this is
  CLAUDE.md's own "preserve existing behavior unless explicitly asked to
  change it" default, and the brief's own framing: "the 40-unit cap and
  lack of progress indicator work exactly as built" below scale). Solves
  exactly the problem in scope (100+-unit projects) without touching the
  path that already works.
- *Con:* Two writers of `value_unit_summaries` now exist by design, not by
  accident — this is the exact DERIVED-DUAL-VIEW shape §9.1 warns about
  ("a value computed once... consumed/written by multiple independent
  surfaces"), *unless* both call sites are provably calling the same single
  composer function with the same cache-write contract (which they can: both
  would call `enrichPoolAltitudes` — the request route already does, and the
  tick would too). The risk isn't divergent *logic* (there's only one
  `enrichPoolAltitudes`), it's divergent *invocation discipline* — e.g., if a
  future edit changes what "who's allowed to write this table" means and
  only one call site gets updated. This needs the same structural guard shape
  as `single-writer-guard.test.js`, scoped explicitly to
  "callers of `dbModule.stmts.upsertValueUnitSummary`" (see §9.1's own
  2026-08-04-adjacent note in PROJECT-CONTEXT.md about scoping such guards to
  the module's real export list, not hand-typed names — §9.7's lesson).

**Option C — Tick-only writer, but the tick's *first* sweep for a
newly-touched project runs near-immediately (short boot-style delay), not
on the full steady-state cadence.** Structurally identical to Option A
(single writer, fully read-only endpoint) but addresses the UX regression
differently: instead of giving the request path a synthesis fast-path, give
the *tick* a fast reaction to "this project's pool just changed" — e.g. a
project-touched signal (analogous to `focus-inference.js`'s `BOOT_DELAY_MS`
backfill-soon-after-start pattern, but per-project-touch rather than
per-process-boot) that queues that project for the *next* tick regardless of
the steady cadence, or a short secondary "fast lane" interval for
recently-active projects only.
- *Pro:* Keeps the true single-writer structural guarantee of Option A (no
  second call site to guard against, ever) while narrowing (not eliminating)
  the staleness window for the common case.
- *Con:* More net-new machinery than either A or B (needs a
  "recently touched" signal that doesn't exist today — this is exactly the
  brief's own open question #1's parenthetical: "requires tracking 'recently
  viewed,' which doesn't exist today for this surface"). Still not zero-wait
  for a brand-new unit the way today's behavior is.

## 4. Architectural risks

- **DEC-16 tripwire is a live, exact-match test today, not just a comment.**
  `server/__tests__/ledger-metrics-parity.test.js` test **C2.4** asserts
  `valueLedger.CONSUMERS` equals exactly
  `["bin/ccam.js (cmdLedger)", "server/routes/project-plans.js"]`. If the new
  tick calls `assembleValuePool` directly (any option — the tick needs to
  know which projects/units exist to sweep), this test goes red the moment
  the tick is written, by design. The fix is mechanical (add the tick module
  to `CONSUMERS` and to the test's expected array) but it must be done in the
  *same* change, not discovered after — and it is a legitimate, deliberate
  addition (the tick reads `assembleValuePool` directly; it does not
  re-derive pool membership), so this is compliant, not a violation, as long
  as it's done explicitly.
- **Single-writer risk for `value_unit_summaries` under Option B is real but
  bounded.** Both call sites (request route, tick) would call the same
  `enrichPoolAltitudes`, so there's no risk of divergent *synthesis logic* —
  only of a future edit updating one call site's contract and not the
  other's (§9.1's own recorded pattern: "the pattern still recurred one
  layer over... the copy was the wrong one"). Recommend a structural guard
  in the shape of `single-writer-guard.test.js`, scoped tightly per §9.7's
  own lesson ("HAND-SCOPED STRUCTURAL SCAN... blind to the rest of the
  surface... green scan + incomplete scope reads as enforced") — derive the
  guard's scope from `dbModule.stmts.upsertValueUnitSummary`'s real call
  sites via a lexical/AST scan, not a hand-typed file list.
- **SQLite write contention is real but not novel — existing WAL +
  busy_timeout infra already covers the base case.** `journal_mode = WAL`
  and `busy_timeout = 5000` are already global settings; a tick's batched
  `upsertValueUnitSummary` calls and an interactive request's writes will
  serialize via SQLite's single-writer WAL semantics with up to 5s of
  automatic retry, not hard-fail. The residual risk is *latency*, not
  correctness: if a tick sweeps many projects and holds write activity for
  an extended stretch (e.g., wrapping a large batch in one transaction), an
  interactive request landing mid-sweep could stack up to 5s of wait before
  either succeeding or hitting `SQLITE_BUSY`. Mitigate by keeping each
  tick's DB write per-unit (as `enrichPoolAltitudes` already does — one
  `upsertValueUnitSummary.run(...)` per resolved unit, not one giant
  transaction) and by capping per-tick project count the way
  `reconciliation.js` already caps `MAX_TARGETS_PER_TICK`.
- **Spawn-cost/timeout risk of a single `claude -p` synthesizing many units
  is already partially bounded by `MAX_UNITS_PER_PROMPT = 40`, but a
  cross-project tick multiplies spawn *frequency*, not per-spawn size.**
  Every project's overflow batch is still capped at 40 units per spawn
  (`enrichPoolAltitudes` internally slices `misses.slice(0,
  MAX_UNITS_PER_PROMPT)`), so no single spawn grows unboundedly under any
  option — the risk is a sweep-scope choice (open question #1) that
  triggers one `claude -p` spawn *per project* every tick, which at N
  projects × 1 spawn each could exceed `DASHBOARD_FOCUS_INFER_TIMEOUT_MS`-scale
  budgets in aggregate wall time if run serially, or spike concurrent
  process count if run in parallel. `reconciliation.js`'s own
  `MAX_TARGETS_PER_TICK` (projects-per-tick cap, separate from
  detours-per-project cap) is the direct precedent for bounding this
  two-dimensionally, and should be mirrored here as a `MAX_PROJECTS_PER_TICK`
  (or equivalent) distinct from `MAX_UNITS_PER_PROMPT`.
- **Tick sweep scope (open question #1) is a genuine, unresolved design
  fork with real cost/staleness trade-offs — this needs an explicit
  decision, not a default.** Recommend, architecturally: recency-bounded
  (`ORDER BY <last-touched> DESC LIMIT N`, matching `reconciliation.js`'s
  `listReconcileTargets` shape) over "every project with pool units ever."
  The project-owns-a-`updated_at`-style column question (does `projects` or
  `project_plans` carry a usable recency signal already, e.g. last plan
  activity) needs a build-phase check — not investigated in this pass, flag
  for the Engineer.
- **This scope boundary is not yet tracked anywhere durable.** Per this
  role's own instructions: the tick-sweep-scope decision (open question #1),
  the read-only-vs-hybrid decision (open question #2 / Options A vs. B vs.
  C above), and the observability-layer sequencing decision (open question
  #3) are all real, consequential forks that this pass is *disclosing* but
  not *resolving* — none of them has a `decisions.md` PENDING/WATCH row yet.
  If the PM/design phase doesn't immediately create one, these become
  exactly the kind of "disclosed-but-untracked exclusion" this project's own
  process exists to prevent — functionally identical to nobody having found
  them, once enough time passes. This needs to be flagged explicitly in the
  returned summary, not left as prose here.
- **Migration/data concern:** none for schema — `value_unit_summaries`
  already exists and needs no shape change under any option; a new
  `value_summary_generation_log`-style table is a fresh `CREATE TABLE IF NOT
  EXISTS`, no ALTER/rebuild (confirmed, matching the brief's own §9.5/§9.6
  inapplicability call).
- **Security/trust boundary:** unchanged. The tick reuses
  `runClaudePromptJson`'s existing hermetic spawn contract (hooks disabled,
  tools disallowed, cwd=tmpdir, `CLAUDECODE` stripped) — no new trust
  surface, same posture as every other LLM-spawning tick in this codebase.

## 5. Recommended approach

**Option B (hybrid: preserve the existing ≤40 request-path fast lane,
add the tick for overflow-only sweeping) over Option A**, with the
single-writer risk it introduces closed by a structural guard (not just
convention) before it ships:

1. Keep `POST /altitudes` exactly as it is today for the common case — this
   is the "preserve existing behavior unless explicitly asked to change it"
   default from CLAUDE.md, and it is explicitly *working* per the brief's
   own framing ("the 40-unit cap... works exactly as built" below scale).
   Removing it to satisfy "scalable" would regress the majority of projects
   to fix the minority.
2. Add `value-summary-tick.js`, wired into `startBackgroundServices()`,
   mirroring `startFocusInference()`'s shape (boot delay + `unref`'d
   interval + overlap guard + env-disableable mode/cadence) and
   `reconciliation.js`'s two-dimensional per-tick caps (projects-per-tick,
   distinct from `MAX_UNITS_PER_PROMPT`). Its job is specifically to sweep
   the overflow the request path's 40-cap leaves behind, recency-scoped per
   `reconciliation.js`'s `listReconcileTargets` precedent.
3. The tick becomes a new, deliberate, reviewed entry in
   `value-ledger.js`'s `CONSUMERS` array (and the corresponding update to
   `ledger-metrics-parity.test.js` C2.4) in the *same* change that adds it —
   this is the DEC-16 tripwire working as designed, not a blocker.
4. Add a structural single-writer guard scoped to
   `dbModule.stmts.upsertValueUnitSummary`'s real call sites (not a
   hand-typed file list, per §9.7) so the two legitimate writers (route,
   tick) stay provably calling the same `enrichPoolAltitudes` composer, and
   any future third writer is caught red, not discovered in review.
5. WebSocket push (`value_altitudes_updated`, carrying `{ project_id,
   unit_key, project, stakeholder }` or a small batch of same) and the
   observability layer (new access-log table + Settings routes/UI, mirroring
   `focus_summary_access_log`/`CacheSection.tsx`) are both additive and
   low-risk regardless of A/B/C — but per open question #3, they are large
   enough surface area (new table, two routes, one UI section) to sequence
   as a fast-follow without blocking the coverage fix, *if* the PM explicitly
   decides that and records it — not by default.

Do not adopt Option A (full read-only + pure tick) as the default without an
explicit, informed sign-off from Sara that the same-visit-synthesis
regression for <40-unit projects (the common case) is acceptable — it is a
real trade the brief itself flags, not a hypothetical.
