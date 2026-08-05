# Change Brief — value-summary-tick

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-08-04
- **Scope source:** intake-handoff (team-intake, auto-pilot mode)
- **Intake link:** `intake/2026-08-04-value-summary-tick/technical-plan.md`
  (+ `pm-plan.md`, `decisions.md` — DEC-1..DEC-16, WATCH-1..WATCH-6,
  OPEN-1..OPEN-4)

**Build status: NOT YET STARTED.** `effort/2026-08-04-value-summary-tick`
(`b155f83`) is byte-identical to `master`'s HEAD — verified via
`git diff --name-only master effort/2026-08-04-value-summary-tick` (empty).
Neither `server/lib/value-summary-tick.js` nor
`server/__tests__/value-summary-tick.test.js` exists on disk. Everything
below is the **intended** change per the technical plan, cross-checked
against the live tree where possible (see "Grounding checks" at the end) —
not a diff of work already done. This brief is normalizing a build plan, not
a shipped change.

The prior, already-built feature this extends — the three-altitude Value
Pool (`server/lib/value-summary.js`, `value_unit_summaries` table,
`POST /api/project-plans/altitudes`, `PlanLedgerPanel.tsx`'s three-level
rows) — is confirmed committed on `master` at `b155f83`
("feat(client,server): three-altitude Value Pool + info modal on Plan
Ledger").

## Change summary
Today's `enrichPoolAltitudes` synthesizes at most 40 uncached PROJECT/
STAKEHOLDER altitude units per `POST /api/project-plans/altitudes` call and
represents every kind of miss (not-yet-attempted, LLM-off, spawn/parse
failure) as one indistinguishable absence — so a 182-unit pool needs ~3
manual reloads and a backlog looks identical to a failure. The plan adds a
bounded background tick (`server/lib/value-summary-tick.js`) that sweeps
tracked projects in least-recently-swept rotation to drain the overflow
unattended, makes the per-unit state explicit on the wire (`queued` vs.
`unavailable`, per `enrichPoolAltitudes`'s new `{ altitudes, states }`
return shape), and lands a `value_summary_generation_log` audit table so
sweep behavior is provable, not asserted. The existing ≤40 synchronous
fast path on the route is explicitly preserved unchanged (DEC-3).

## Changed files (by layer)
*(All entries below are planned, per `technical-plan.md` §3 — none exist on
the branch yet.)*

**Schema / data (server)**
- `server/db.js` — new `CREATE TABLE IF NOT EXISTS value_summary_sweep_state`
  and `value_summary_generation_log` (+3 indexes), additive only (no
  `ALTER`); three new prepared statements: `listValueSweepTargets`,
  `upsertValueSweepState`, `insertValueSummaryGeneration`.

**Synthesis composer + request path (server)**
- `server/lib/value-summary.js` — `enrichPoolAltitudes` return shape changes
  from `altitudes` to `{ altitudes, states }` (DEC-10); new export
  `ALTITUDE_STATES`; the stale "overflow is rare" comment (confirmed present
  at lines 36-38 today, still citing the false premise) rewritten against
  the measured 182-unit pool; stays the **sole** lexical
  `upsertValueUnitSummary.run(` call site even though it now has two
  legitimate invokers (route + tick).
- `server/routes/project-plans.js` — import at line 23
  (`const valueSummary = require("../lib/value-summary");`, confirmed
  live-code state) becomes a destructured `enrichPoolAltitudes` import;
  route handler destructures `{ altitudes, states }` and responds
  `res.json({ altitudes, states })`. Confirmed by grep: `valueSummary.` has
  exactly **one** call site in the file today (line 153), so the
  destructure is safe. No other route behavior changes.

**Background tick (server, net-new)**
- `server/lib/value-summary-tick.js` — **NEW.** Exports
  `startValueSummaryTick`, `runValueSummaryTickOnce`, `listSweepTargets`,
  two test seams, and cadence/cap defaults. Mirrors the eleven existing
  `startBackgroundServices()` ticks' shape (boot delay + `unref`'d interval
  + overlap flag + env-gated mode), verified against
  `focus-inference.js`/`reconciliation.js`'s real `DASHBOARD_FOCUS_INFER_MS`
  / `DASHBOARD_RECONCILE_MS` / `MAX_TARGETS_PER_TICK` /
  `MAX_DETOURS_PER_TICK` precedents (all confirmed present in the live
  tree).
- `server/lib/value-ledger.js` — `CONSUMERS` (confirmed today:
  `["server/routes/project-plans.js", "bin/ccam.js (cmdLedger)"]`) gains the
  tick (DEC-7).
- `server/index.js` — one `try/catch`-wrapped registration inside
  `startBackgroundServices()`.

**Client (type-level + placeholder states only)**
- `client/src/lib/types.ts` — `WSMessage.type`/`data` unions gain
  `value_altitudes_updated` (new, tick-authored) **plus** two pre-existing
  broadcast types the union is currently missing entirely:
  `project_plan_updated` (confirmed 6 live broadcast call sites in
  `project-plans.js`: lines 173/197/222/244/252/262) and
  `value_claim_updated` (confirmed 2 live call sites: 360/379). **Type
  entries only — no subscriber added anywhere** (DEC-8, OPEN-3).
- `client/src/lib/api.ts` — `altitudes` response type gains
  `states?: Record<string, "queued" | "unavailable">`.
- `client/src/components/PlanLedgerPanel.tsx` — `Altitude` type gains
  `"queued"`; `AltitudeText` gains the `queued` branch; the altitude effect
  maps server `states` instead of collapsing every miss to `null`.
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — new key
  `planLedger.pool.altitudes.queued` in all four locales.

**Tests (planned, none written yet)**
- `server/__tests__/value-summary.test.js` — 6 call sites re-destructured;
  new DEC-11 truth-table cases.
- `server/__tests__/value-summary-tick.test.js` — **NEW**, 8 required cases
  (overlap guard, per-tick bound, rotation order, overflow drain, broadcast
  discipline, failure isolation, env wiring, DEC-16 structural check).
- `server/__tests__/single-writer-guard.test.js` — new `it()` blocks reusing
  the existing `scanFiles`/`assertSingleHome` machinery (confirmed both
  exist today) for `upsertValueUnitSummary` and
  `insertValueSummaryGeneration`.
- `server/__tests__/ledger-metrics-parity.test.js` — C2.4's expected array
  gains the tick file (confirmed the file exists today).
- `server/__tests__/chronology-ordering.test.js` — `FILE_DISPOSITIONS` gains
  an entry for the tick file, required to be observed **red before green**
  (confirmed the file exists today).
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` — new >40-unit
  overflow test asserting `queued` and `unavailable` render distinguishably
  in the same render (AC-2).

**Docs**
- `ARCHITECTURE.md` (+ whatever `update-project-docs` resolves) — new tick
  in the background-services list, two new tables, three new env vars,
  `states` field on the route.

**Not touched (explicit, by decision)**
- `server/routes/settings.js` — deliberately not touched in v1 (DEC-12); the
  "clear data" route's pre-existing omission of `value_unit_summaries`/
  `value_claims` is deferred to a fast-follow that closes all four missing
  tables atomically.

## Surfaces / features touched
- **`POST /api/project-plans/altitudes`** — response shape gains `states`
  (additive); synchronous behavior unchanged.
- **Value Pool altitude synthesis** (`server/lib/value-summary.js`'s
  `enrichPoolAltitudes`) — return-shape change, now invoked from two
  production call sites (route + new tick).
- **New background service**: the value-summary tick, the 12th entry in
  `startBackgroundServices()`.
- **Plan Ledger panel** (`PlanLedgerPanel.tsx`) — altitude cell rendering
  gains a third non-resolved state (`queued`, alongside existing
  `undefined`/generating and `unavailable`).
- **WebSocket wire contract** (`client/src/lib/types.ts`'s `WSMessage`) —
  registry gains 3 entries, 2 of which fix a **pre-existing** drift (server
  already broadcasts `project_plan_updated`/`value_claim_updated`; the
  client union never had them). No behavior change — no subscriber is
  added.
- **i18n** — `projectDetail.json` in all 4 locales.
- **DB schema** — two new additive tables + 3 prepared statements.

## Variant relevance
This project's closest analog to "must stay identical across variants" is
the **i18n locale set** and, more load-bearingly for this change, the
**two-invoker/one-writer duality** the hybrid design deliberately
introduces:

- **i18n (4 locales):** the new `queued` key must exist in `en`/`ko`/`vi`/
  `zh` with parity enforced by `i18n.test.ts`'s E1.1 whole-namespace derived
  check (not hand-typed) — flagged explicitly in the plan (step 13, §9.7
  occurrence 6's own cure).
- **Two invokers, one composer/one writer:** the route's synchronous ≤40
  path and the tick's background sweep both call `enrichPoolAltitudes`, and
  both must observe **the same** truth table (DEC-11) and write through
  **the same single lexical call site**
  (`upsertValueUnitSummary.run(` inside `enrichPoolAltitudes`, confirmed
  today to be the file's only production writer). This is this build's
  actual "two paths that render the same thing must stay identical"
  invariant, and it's the plan's most heavily instrumented risk (see next
  section).

## Test-invariants at risk
- **[ ] Single-writer / two-invoker consistency — DEC-3/DEC-6/DEC-16.** The
  hybrid design creates two production callers of `enrichPoolAltitudes`
  (route, tick) but must preserve exactly one write path to
  `value_unit_summaries`. The plan's guard (extending
  `single-writer-guard.test.js`) must assert (a) exactly one lexical
  `upsertValueUnitSummary.run(` call site, lexically inside
  `enrichPoolAltitudes`; (b) exactly one lexical
  `insertValueSummaryGeneration` call site (the tick); (c) both are
  **red-proven by injection** (add a rogue second call site, observe
  failure, remove, confirm green) — not merely asserted to exist. This is
  the single highest-value test in the whole change; a QA plan that treats
  it as "covered because a guard file exists" would be exactly this
  project's §9.3 VACUOUS-GUARD failure mode, and §9.7 HAND-SCOPED
  STRUCTURAL SCAN if the guard's scope (which files/exports it scans) is
  hand-typed rather than derived. The technical plan already specifies
  reusing the existing derived `scanFiles`/`assertSingleHome` machinery
  rather than hand-rolling a new one — verify this was actually followed,
  not just claimed.
- **[ ] Pool-membership single-composer rule — DEC-16.** `assembleValuePool`
  (`value-ledger.js`) must remain the sole pool composer; the tick must not
  re-derive membership via its own SQL. Enforced two ways per the plan: (1)
  `CONSUMERS` + `ledger-metrics-parity.test.js` C2.4 both name the tick in
  the same change, with C2.4 required to be **observed red first** (DEC-7);
  (2) a structural test asserting the tick's source contains no
  `FROM project_paths`/`FROM detour_dispositions`/`detectTrunkDrift`
  reference of its own. Both are checkable directly against the shipped
  diff.
- **[ ] Chronology/derivation-scan liveness — DEC-9, §9.7.** The new
  `value-summary-tick.js` must first cause
  `chronology-ordering.test.js` to fail with "no disposition in
  FILE_DISPOSITIONS" — proving the derivation actually scans new files —
  **before** the disposition entry is added. If the file is added and the
  scan is simply green with no observed prior-red step, that is this
  project's own named failure mode (a derivation that "has regressed" per
  the plan's own step 8 language) and should be treated as a build defect,
  not a formality.
- **[ ] Overloaded-absence / discriminated-state correctness — DEC-10/11
  (WATCH-3 candidate pattern OVERLOADED-ABSENCE).** Every unit passed to
  `enrichPoolAltitudes` must land in exactly one of: resolved (in
  `altitudes`), `queued`, or `unavailable` — never zero, never two. The
  truth table's edge case worth explicit test attention: when the LLM path
  is unavailable, **every** miss (including over-cap ones) must be
  `unavailable`, not `queued` — the plan is explicit that "outage" and
  "backlog" must never be conflated.
- **[ ] Fast-path non-regression — DEC-3.** The existing ≤40 synchronous
  behavior of `POST /api/project-plans/altitudes` must be provably
  unchanged (same cap, same synchronous resolution), with `states` as a
  pure additive field. A small (<40-unit) project must still resolve fully
  in one visit.
- **[ ] Overlap / failure isolation — tick-specific.** The tick's `running`
  guard (concurrent-call safety) and its per-project `try/catch` (one
  failing project must not starve or block the rotation, and must still
  advance `last_swept_at` in a `finally`) are both named as
  mutation-provable requirements in the plan (remove the guard → observe
  two spawns; make one project throw → confirm the other still sweeps and
  the failing one's rotation still advances).
- **[ ] Schema-change class — §9.5/§9.6, correctly N/A here.** Both new
  tables are `CREATE TABLE IF NOT EXISTS` only, no `ALTER`, no rebuild — the
  plan explicitly claims this makes §9.5 (fresh-DB-blind schema change) and
  §9.6 (non-atomic rebuild) inapplicable rather than complied-with. Worth a
  direct confirmation at build time that no `ALTER TABLE` sneaks in.
- **[ ] Chronology-ordering §9.2 (row-id-as-chronology-proxy) — one claim
  worth verifying, not blocking.** The plan's `listValueSweepTargets` query
  orders by `last_swept_at ASC` (a real timestamp), and the plan asserts
  `project_paths`/`projects` are outside `chronology-ordering.test.js`'s
  `bulkInsertTables` scan scope so the query doesn't need a
  `GRANDFATHERED_QUERIES` entry. This is a factual claim about the existing
  scan's scope that QA should verify directly against
  `chronology-ordering.test.js`'s actual `bulkInsertTables` list at build
  time, rather than take on faith — cheap to check, and this project's own
  §9.7 catalog entry exists specifically because scan-scope claims have been
  wrong before.

## Stated intent / acceptance
Three acceptance criteria, from Sara's own words via the PM plan:
- **AC-1 (scalable):** opening Project Detail for an arbitrarily large pool
  requires zero page reloads to *eventually* reach full coverage; per-visit
  work stays bounded at ≤40. **Partially met, by design** — see OPEN-3
  below (no in-place live update in v1; coverage appears on next mount, not
  on the open page).
- **AC-2 (observable):** every unresolved unit renders as one of two
  visibly distinct states (`queued` vs. `unavailable`), never one ambiguous
  placeholder; the audit log shows real per-tick hit/miss/backlog counts.
- **AC-3 (right long-term fix):** `assembleValuePool` stays the sole pool
  composer; `upsertValueUnitSummary.run(` stays a single lexical call site
  with a red-proven guard; the read/write split is a recorded decision.

Validation target for AC-1: Coaching Assistant project, 182 units (real,
measured 2026-08-03 per the parent effort's DEC-12) — not a synthetic
fixture (OPEN-2, non-blocking, PM-recommended and not contradicted anywhere
in the trail).

## Open questions

**Blocking (cannot plan tests):**
- None. The technical plan is unusually complete for test-planning purposes:
  every file change names exact anchors (I spot-checked several — line 23's
  import, the route's single `valueSummary.` call site, `CONSUMERS`'
  current contents, all 8 `project_plan_updated`/`value_claim_updated`
  broadcast call sites, the `focus_summary_access_log` schema precedent, and
  the `DASHBOARD_FOCUS_INFER_MS`/`DASHBOARD_RECONCILE_MS`/
  `MAX_TARGETS_PER_TICK`/`MAX_DETOURS_PER_TICK` env-var precedents — all
  confirmed accurate against the live tree). It specifies an explicit state
  truth table (DEC-11), 8 named tick test cases with exact assertions, exact
  mutation-proof procedures for every structural guard, and a DoD checklist
  that maps every acceptance criterion to specific test evidence. There is
  enough here to write a concrete test plan without further clarification.

**Non-blocking (proceeding on assumption):**
- **Nothing built yet — a build precondition exists.** Step 1 of the
  technical plan requires committing the ~991-line uncommitted altitude
  layer to `master` and confirming `git status --porcelain` is clean before
  this build's own commits begin (OPEN-1/DEC-13). → Assumption: this QA
  brief documents the *plan to be tested once built*; the actual test run
  cannot start until the branch has real commits on it, and the coverage
  team should re-confirm `git diff <base-sha>` on `effort/2026-08-04-value-summary-tick`
  is non-empty and scoped only to this work before treating any test
  result as meaningful.
- Repo currently has other uncommitted changes on `master`
  (`AGENT-PLAN.md`, `PROJECT-CONTEXT.md` modified; several `intake/`
  files untracked) that are the team-intake process's own artifacts, not
  part of this technical plan's file list. → Assumption: unrelated to this
  build, no action needed from QA, but worth a `ps`/`lsof` check per the
  `concurrent-session-risk` memory note before anyone runs the step-1 commit.
- **OPEN-3** (no client subscriber in v1 — the tick's
  `value_altitudes_updated` broadcast reaches nobody; AC-1's "zero reloads"
  is met in the "unattended backfill" sense, not the "page updates in
  place" sense) is a **known, already-decided non-blocking carryover**, not
  a gap in the plan — flagging per the plan's own instruction that it must
  be read before sign-off, not re-litigating it.
- **OPEN-4** (coverage-latency formula must be measured against the real
  fleet size at build time, defaults retuned via env var if it exceeds
  ~2h) is likewise a **known non-blocking carryover** — a build-time
  measurement obligation, not an open design question.

## Verdict
**READY**
