# QA / Test Plan — Value Pool altitude background tick

Intake: `intake/2026-08-04-value-summary-tick/`
Surfaces: `server/lib/value-summary.js`, `server/routes/project-plans.js`
(`GET /pool`, `POST /altitudes`), `client/src/components/PlanLedgerPanel.tsx`,
plus proposed net-new: `server/lib/value-summary-tick.js`, a
`value_altitudes_updated` WS message, and (if in scope — see §3d) an
observability table + Settings routes/UI mirroring Focus Summaries.

**No code for this build exists yet.** This document specifies the tests the
build must land with, grounded in what already exists on this surface today
(13 green `value-summary.test.js` tests, 11 green `PlanLedgerPanel.test.tsx`
tests including the 3 just-added altitude tests) and in this repo's own
established tick/observability/WS precedents. Section 6 flags where this
build's own PROJECT-CONTEXT.md pre-flags (§9.1 DERIVED-DUAL-VIEW,
§9.7 HAND-SCOPED STRUCTURAL SCAN) become checkable test obligations, and
Section 7 flags one place this build would have to establish a *new* test
pattern because no existing tick in this codebase is actually tested for it.

Stack confirmed from `package.json` / `client/package.json`: server tests run
on Node's built-in `node:test` (`npm run test:server` /
`node --test server/__tests__/<file>.test.js` for a single spec); client
tests run on Vitest + Testing Library (`npm run test:client` /
`cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx`
for a single spec).

---

## 1. How we verify done

**Automated (must all be green before calling this done):**
1. `npm run test:server` — full server suite, including the new
   `value-summary-tick.test.js` (or equivalent) and the extended
   `value-summary.test.js` / `chronology-ordering.test.js`.
2. `npm run test:client` — full client suite, including the extended
   `PlanLedgerPanel.test.tsx` and the per-screen render snapshots
   (`client/src/pages/__tests__/screens.snapshot.test.tsx`) — regenerate
   baselines with `cd client && npx vitest run -u` only if the Value Pool
   section's rendered copy intentionally changes (e.g. "Generating…" →
   "Queued" — see §3b), and review the diff before accepting it, per this
   repo's CLAUDE.md testing policy.
3. `bash .claude/skills/file-headers/scripts/check-headers.sh` — every new
   file (`value-summary-tick.js`, any new route/UI files) carries the
   mandatory header.
4. `grep -rn "assert.ok(true" server/__tests__/` and
   `grep -rn "|| true" server/__tests__/` both return 0 (§9.3 sweep) for any
   new guard test this build adds (see §6).

**Manual (required by this repo's CLAUDE.md — "start the dev server and use
the feature in a browser before reporting complete" — see §5 for the
tick-specific version of this, since a background interval isn't a
click-and-see feature):**
1. Confirm the `<40`-unit case still resolves altitudes within one page
   visit (or documents the accepted UX regression — see §3b) — this is the
   fast path most projects hit and must not silently degrade.
2. Seed or find a real project with >40 pool units, watch coverage
   increase across tick cycles without a manual page reload, per §5.
3. Confirm Settings → Value Summaries (if built this round — §3d) renders
   real hit/miss/backlog numbers, not zeros, against the same seeded project.

---

## 2. Regression coverage — what exists today and its current pass status

Ran both directly as part of this QA pass:

- `server/__tests__/value-summary.test.js` — **13 tests, all passing**
  (verified: `node --test server/__tests__/value-summary.test.js` → `pass 19`
  combined with `chronology-ordering.test.js` in the same run, 0 failures).
  Covers `parseOutput`, `buildPrompt`, `enrichPoolAltitudes` caching/batching/
  model-override/unavailability, and the `POST /altitudes` route contract.
  Uses `focus-inference.js`'s `__injectSpawnForTest` seam — no real `claude`
  CLI ever spawned. **This file needs no new tests for the read-only
  transition itself if `enrichPoolAltitudes` keeps its current signature and
  the tick becomes its only caller** — but every one of its current cases
  implicitly assumes something calls it synchronously on the request path;
  once the route stops calling it, this file's own header comment ("Tests …
  the `POST /api/project-plans/altitudes` route contract") goes stale and
  must be rewritten to describe the route's new read-only contract (see §3b).

- `server/__tests__/chronology-ordering.test.js` — **passing**, and its
  `FILE_DISPOSITIONS` map is now genuinely **derived** from
  `server/lib/*.js` + `server/routes/*.js` + `server/db.js` (confirmed by
  reading the file: `derivedFiles.filter(...)` walks the real directories,
  and any file absent from `FILE_DISPOSITIONS` fails the suite on scope
  alone — the §9.7 durable cure is already built here, not just aspirational).
  **Any new `server/lib/value-summary-tick.js` and any new
  `server/routes/*.js` file this build adds must get an explicit entry**
  (`"scanned"`, or a dated grandfather reason) or `npm run test:server` fails
  immediately, independent of whether the new file's SQL is correct.

- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` — **11 tests,
  all passing** (verified directly). The 3 newest (2026-08-04 same-day
  altitude tests):
  - `"shows a generating placeholder for Project/Stakeholder before
    altitudes resolve, then the resolved text"` — asserts `/Generating/i`
    while the mocked `api.projectPlans.altitudes` Promise is pending, then
    the resolved copy after it settles.
  - `"shows an unavailable placeholder when a unit is missing from the
    altitudes response"` — asserts `/Not available/i` × 2 (Project +
    Stakeholder rows).
  - `"requests altitudes exactly once for a stable unit set (no re-request
    on an unrelated re-render)"` — asserts `mockAltitudesMock` is called
    exactly once across a `rerender()`.

  **These three tests' premises directly depend on the read-only endpoint
  decision (§3b) and must be revisited, not just left green:** the first
  asserts "Generating…" renders while a *fetch* is pending — under a
  read-only endpoint, the fetch resolves near-instantly (it's a plain read,
  no spawn), so "Generating…" as currently written would almost never
  render in production even though the test still passes on a
  deliberately-stalled mock Promise. That is the vacuous-guard shape
  (§9.3): a green test whose premise no longer matches how the code behaves.

## 3. New/updated tests required

### 3a. The tick itself (`value-summary-tick.js` or wherever it lands)

Mirror the shape of `focus-inference.js`'s `startFocusInference` / `tick` and
`reconciliation.js`'s `startReconciliation` / `tick` (boot-delay
`setTimeout`, steady-state `setInterval`, private `running` overlap flag,
`unref()`'d timers, env-gated mode/interval). **Important finding: neither
sibling's actual scheduling closure (`tick`, `running`, the `setInterval`
call) is unit-tested anywhere in this repo today** — `focus-inference.test.js`
and `reconciliation-full-tick.test.js` only exercise the exported
batch-selector (`listCandidates`/`listReconcileTargets`) and per-item worker
(`inferSession`/`reconcileCwd`) directly, never through the real timer. If
this build's acceptance criterion is "overlap prevention," "per-tick batch
bound," and "interval firing" as explicit, provable behaviors (the intake
brief asks for exactly these), **this needs new test infrastructure this
repo doesn't have a copy-pasteable precedent for**, not just a copy of an
existing sibling spec:

- Export a directly-callable tick function separate from the
  `setInterval`-wiring convenience wrapper — e.g.
  `runValueSummaryTickOnce(dbModule, { broadcast })` alongside
  `startValueSummaryTick()` (which just wires the timer around it). This
  mirrors this repo's own `enrichPoolAltitudes`/`reconcileCwd` pattern of
  "testable core, thin scheduling shell," extended one layer further than
  the two existing tick files went.
- **Overlap prevention**: call `runValueSummaryTickOnce` twice without
  awaiting the first; assert the second call is a no-op (returns
  immediately / does not spawn a second LLM call) while the first is still
  in flight, using `__injectSpawnForTest` with a manually-resolved Promise
  to hold the first call open. Prove it by mutation (§9.3): temporarily
  remove the `running` guard, observe the test fail (two spawns), restore.
- **Per-tick batch bound**: seed more pending units across one or more
  projects than the new per-tick cap (`N`, TBD by design per the brief's
  open question) and assert exactly `N` get processed in one
  `runValueSummaryTickOnce` call, the rest remain pending for the next tick.
- **Sweep-scope correctness**: once the design resolves the brief's open
  question #1 (every project vs. open-plan-only vs. recently-viewed), add a
  case proving projects outside the chosen scope are never touched by the
  tick (e.g. a project with pool units but no open plan, if that's the
  chosen boundary, gets zero LLM calls across a tick).
- **Interval/env wiring**: assert `DASHBOARD_VALUE_SUMMARY_TICK_MS<=0` (or
  whatever the env var is named) disables the tick entirely — mirrors the
  existing `DASHBOARD_FOCUS_INFER_MS` / `DASHBOARD_RECONCILE_MS` contract
  and should reuse the same disable convention rather than invent a new one.
- **DEC-16 preservation, stated as an explicit assertion, not just intent**:
  the tick must call `value-ledger.js`'s `assembleValuePool` to discover
  pool membership (or receive pre-assembled units from a caller that does),
  never re-derive membership itself. Assert this structurally — e.g. a
  targeted grep/AST check that `value-summary-tick.js` imports
  `assembleValuePool` from `value-ledger.js` and does not hand-roll its own
  pool query — mirroring the discipline `value-summary.js`'s own header
  comment already documents for the interactive path.

### 3b. The read-only endpoint change

This is the highest-risk single change for the PlanLedgerPanel suite (§2).
Required new/updated tests, **contingent on the PM/design resolving the
brief's open question #2** (full read-only vs. hybrid first-≤40-still-
synthesizes):

- **Regression-proving `POST /altitudes` (or its replacement route) no
  longer spawns anything**: extend `value-summary.test.js` (or a new spec)
  with `__injectSpawnForTest(() => { throw new Error("no spawn expected"); })`
  set *before* the request, then hit the route with units that would have
  been cache misses under the old contract — assert the route still 200s
  (reads whatever the tick has already cached, or an empty map) and the
  injected throw never fires. This is the direct proof of "read-only."
- Update or replace the existing `"returns altitudes for a valid batch and
  silently drops malformed entries"` test — its current premise (a mocked
  spawn producing fresh altitudes) is incompatible with a read-only
  contract; rewrite it to seed `value_unit_summaries` directly (bypassing
  `enrichPoolAltitudes`) and assert the route reads the seeded row, with a
  spawn-throws guard proving it never calls the LLM path itself.
- **`PlanLedgerPanel.test.tsx`'s three altitude tests need a decision, not
  a silent pass-through**:
  - If full read-only ships: the "Generating…" test's premise is gone —
    replace with copy reflecting "queued, not yet processed by the
    background tick" (exact string TBD by design/i18n, but it must not
    still say "Generating" if nothing is actively generating on this
    request). Add a new test asserting the placeholder does NOT flip to
    resolved text on its own without a WS push or a refetch (proving the
    component doesn't silently poll and reinvent the old behavior).
  - If hybrid ships (first ≤40 still synthesize inline): the existing
    "Generating…" test stays valid essentially as-is; add a **new** test
    for the >40 overflow case specifically, asserting overflow units show
    the new "queued" copy while in-cap units still show "Generating…" —
    i.e. both placeholder states must be distinguishable in the same
    render, not conflated.
  - The "exactly-once-request dedup" test's assertion
    (`mockAltitudesMock).toHaveBeenCalledWith("proj-1", [unit])`) stays
    valid under a read-only endpoint (same params, same one-shot-per-mount
    contract) — no change needed there beyond re-verifying green.

### 3c. The new WebSocket message (`value_altitudes_updated` or similar)

**Finding worth surfacing to the build, not just noting here**: this
project already broadcasts `project_plan_updated` and `value_claim_updated`
from `server/routes/project-plans.js` (confirmed: `broadcast(...)` calls
exist at lines 173/197/222/244/252/360/379), but **no client code anywhere
under `client/src/` currently subscribes to either message type** — and
`ProjectDetail.tsx` (the page hosting `PlanLedgerPanel`) has zero
`useWebSocket`/eventBus wiring today. So this build isn't "add a message
type to an existing subscribe path" — it's genuinely new plumbing on both
ends. Tests needed:

- **Server broadcast test**: after `runValueSummaryTickOnce` resolves at
  least one previously-uncached unit, assert `broadcast` was called with
  `("value_altitudes_updated", { project_id, unit_keys: [...] })` (exact
  payload shape TBD by design) — inject a spy `broadcast` fn the way
  `reconciliation-full-tick.test.js` already does for its own broadcasts.
  Assert it is NOT called when a tick resolves zero units (LLM unavailable,
  nothing pending) — a silent no-op tick must not spam a broadcast.
- **Client subscribe test**: new test in `PlanLedgerPanel.test.tsx` (or
  `ProjectDetail.test.tsx` if the subscription lives at the page level)
  mirroring `SessionCard.focus.test.tsx`'s pattern — render the component,
  then call `eventBus.publish({ type: "value_altitudes_updated", data: {...},
  timestamp: ... } as WSMessage)` directly (no real socket needed, per this
  repo's existing precedent), and assert the panel re-fetches/re-renders
  the newly-resolved altitude text without a page reload. This is the test
  that actually proves the "live update" half of the acceptance bar — a
  broadcast with nobody listening (today's state for the two existing
  message types) is not "observable," it's inert.
- Add a case where the WS message names a **different** `project_id` than
  the one currently open — assert the panel does NOT re-fetch (scoping
  regression guard, same shape as the existing `PlanLedgerPanel` per-project
  isolation the rest of the suite already assumes).

### 3d. Observability layer (audit table + Settings routes/UI) — contingent

Per the brief's open question #3, PM must decide whether this ships in the
same build. **If it ships:**

- New server test file mirroring `settings-cache-route.test.js`'s exact
  shape (that file is the direct template: access-log insert on
  hit/miss, `GET /cache/timeline`, `GET /cache/day`, `GET /settings/info`
  stats, retention/purge hooks) — same route names under a
  `value-summaries`-scoped path (or reuse `/cache/*` with a `surface=`
  discriminator, TBD by design), driven against the new audit table.
- `chronology-ordering.test.js` `FILE_DISPOSITIONS`: the new audit-table
  queries in `server/db.js`/the new lib file must sort by `created_at`
  before any `LIMIT` (this build's own PROJECT-CONTEXT.md §9.2 flag) — add
  the file(s) to `FILE_DISPOSITIONS` as `"scanned"` and let the existing
  static scan hold it to the same bar as `focus_summary_access_log`'s own
  queries, rather than writing a bespoke ordering test by hand.
- Settings UI: a new component test (mirroring whatever
  `client/src/components/__tests__/` file exists for the Focus Summaries
  Settings section — locate via `grep -rl "cache/timeline" client/src` at
  build time) asserting the new section renders real numbers, not zeros,
  from a seeded backend.

**If deferred:** state that explicitly in the build's own DoD (§7) as a
named, dated follow-up — not a silent omission — since Sara's own
acceptance framing ("observable") is only partially met by §3a-§3c alone.

## 4. Test data / fixtures

- **Server**: reuse `value-summary.test.js`'s existing `makeProject()` /
  `unit()` helpers. For batch-bound and overlap tests, generate ≥50
  synthetic units across 1-3 fake project ids (`trunk_commit::sha-N::/repo`
  style `unitKey`s, matching the real pool's identity shape) so a single
  tick run cannot cover all of them in the currently-shipped 40-unit
  spawn cap plus whatever new per-tick cap is chosen — this is the direct
  regression fixture for the "100+ units, 3 reloads" complaint in the
  intake brief.
- Keep using `__injectSpawnForTest` for every LLM-touching test — never a
  real `claude` CLI invocation, consistent with every existing spec on this
  surface.
- **Client**: reuse `PlanLedgerPanel.test.tsx`'s `makeUnit()`/`makePlan()`/
  `makeHealth()` helpers; add a >40-unit pool fixture (an array of 45+
  `makeUnit()` calls) specifically for the overflow-placeholder test in §3b.
- For the manual verification pass (§5), a real or seeded project with
  40-100+ ground-fact units is required — per the intake brief, no such
  project id was supplied by Sara; use `scripts/seed.js` (or whatever this
  repo's seed script is named — confirm at build time) to synthesize one if
  no real project of that size exists, rather than inventing ad hoc DB rows
  by hand.

## 5. Manual verification — what "use it in a browser" means for a tick

A background tick cannot be manually verified by clicking a button and
watching one response. The equivalent manual pass for this feature:

1. Set a short cadence via env for the manual check only (e.g.
   `DASHBOARD_VALUE_SUMMARY_TICK_MS=15000`, never the real default) and
   `MAX_UNITS_PER_PROMPT`/new per-tick cap left at whatever the build
   ships, so multiple tick cycles are observable in a few minutes rather
   than requiring the real default interval's full wait.
2. Seed or open a project with 40+ ground-fact pool units (see §4).
3. `npm run dev`, open the Project Detail page for that project in a real
   browser, and watch the Value Pool section across at least 2-3 tick
   cycles (not just one) — confirming:
   - Units beyond the old 40-cap eventually resolve, without a manual page
     reload, over successive cycles (proves the >40 coverage gap is fixed).
   - The live WS push (§3c) visibly updates rows in place as each tick
     resolves a fresh batch, not just "correct after a reload."
   - "Still generating/queued" and "unavailable" render as visibly distinct
     states — confirm by also toggling `DASHBOARD_FOCUS_INFER_MODE=off`
     for a subset check and observing the "unavailable" copy instead.
4. Check server logs / the new observability Settings section (if built)
   during this window and confirm tick-start/tick-end and hit/miss counts
   are visible there — this is the literal manual proof of "observable."
5. Revert the env override before considering the manual pass complete;
   confirm the default cadence value is what actually ships (do not leave
   a fast test cadence as the shipped default).
6. Re-run the ≤40-unit case (a small project) once more and confirm it
   still resolves within a reasonably fast window per §3b's chosen design
   (full read-only vs. hybrid) — this is the regression check for the
   brief's open question #2, and must be checked by eye in the browser,
   not just asserted in a mocked unit test, since it's a real UX latency
   trade-off Sara flagged explicitly.

## 6. PROJECT-CONTEXT.md obligations this build must turn into tests

- **§9.1 DERIVED-DUAL-VIEW / single-writer guard**: the brief itself
  requests this — once the interactive endpoint goes read-only, only the
  tick may write `value_unit_summaries`. Build a guard mirroring
  `single-writer-guard.test.js`, scoped explicitly to
  `value-summary-tick.js` (and nothing else, per the brief's own §9.7
  citation) — prove it red by injecting a second
  `upsertValueUnitSummary.run(...)` call site (e.g. a rogue fallback branch
  in the route) and confirming the guard fails, then remove the injection.
  A vacuous version of this guard (existence-only, no injection proof) does
  not satisfy §9.3.
- **§9.7 HAND-SCOPED STRUCTURAL SCAN**: don't hand-type the new tick file
  into `chronology-ordering.test.js`'s `FILE_DISPOSITIONS` and stop there —
  confirm the *derivation* (`derivedFiles` walking `server/lib/*.js`) picks
  the new file up automatically before you add its disposition entry; if it
  doesn't appear in the failure message when un-dispositioned, the
  derivation itself has regressed and that's a higher-priority bug than
  this feature.
- **§9.2 row-id-as-chronology-proxy**: any new query in the tick or its
  audit log that orders by "most recent N pending units" or similar must
  sort by `created_at` (id tiebreak) before `LIMIT`, per this project's
  established convention — covered by extending `chronology-ordering.test.js`
  rather than writing a bespoke ordering test by hand (§3d).

## 7. Definition of Done checklist

- [ ] `npm run test:server` green, including new/updated
      `value-summary.test.js`, a new tick spec (batch-bound + overlap +
      interval-disable, proven by mutation per §9.3), and
      `chronology-ordering.test.js` with the new file(s) dispositioned.
- [ ] `npm run test:client` green, including `PlanLedgerPanel.test.tsx`'s
      three altitude tests updated to match the shipped design (full
      read-only vs. hybrid — §3b), not left passing against a stale premise.
- [ ] New `POST /altitudes` (or replacement) route test proves zero LLM
      spawns via an injected throw — the direct regression proof of
      "read-only."
- [ ] New WS message has both a server-side broadcast test AND a
      client-side `eventBus.publish` subscribe test — a broadcast with no
      listener (today's state for `project_plan_updated`/
      `value_claim_updated`) does not count as "live update" shipped.
- [ ] Single-writer guard for `value_unit_summaries`, scoped to the tick
      only, proven red by injection (§6).
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] `grep -rn "assert.ok(true" server/__tests__/` and
      `grep -rn "|| true" server/__tests__/` both return 0 for any new file.
- [ ] Manual browser pass completed per §5 (multi-cycle observation, not a
      single click), with the fast test cadence reverted before sign-off.
- [ ] PM has explicitly decided (not defaulted) all three brief open
      questions — sweep scope, read-only-vs-hybrid, observability-in-this-
      build-or-deferred — and this document's §3a/§3b/§3d reflect the
      actual decision, not the placeholder options listed here.
- [ ] If observability (§3d) is deferred, that is recorded as a named,
      dated follow-up, not a silent gap against Sara's "observable"
      acceptance criterion.
