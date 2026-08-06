# Change Brief — coverage-on-demand (Value Pool Slice 2)

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-08-05
- **Scope source:** intake-handoff (`technical-plan.md` "Change set" §3, cross-checked
  against `build-report.md`'s "Files changed" and the actual merged diff), confirmed
  against `git diff b38b4a151fe3e3bcd47c7858684f0b8121b53d57..4c2e931` on `master`.
  `4c2e931` is confirmed an ancestor of current `HEAD` (already merged/landed on
  `master`, not yet on `origin/master` per the build report's "Shipped commit" —
  QA is evaluating the local `master` state).
- **Intake link:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/`
  (`technical-plan.md`, `decisions.md`, `build/2026-08-05-coverage-on-demand/build-report.md`,
  `.../decisions.md`, `.../supporting/verification-evidence.md`, `.../supporting/review-findings.md`)

## Change summary
Value Pool Slice 2 gives the background altitude-generation sweep a second,
explicit "coverage request" demand level: a project can be flagged, jumped to
the head of the sweep rotation, and drained in bounded batches to 100%
described-coverage, with progress computed in exactly one new server module
(`value-coverage.js`) and carried verbatim by both a new HTTP GET route and a
widened WebSocket broadcast; `PlanLedgerPanel` gains its first-ever live
WS subscription to render that progress and offer a "prioritize now" action.
Separately, the summarization model cascade becomes stage-aware
(`unit`/`grouping`) as plumbing for Slice 3, with **no calibration run and no
default re-pinned** (AC-6 unmet).

## Changed files (by layer)

**Backend — schema/statements (`server/db.js`, 103 lines)**
- `value_summary_sweep_state` gains nullable `coverage_requested_at TEXT` via
  the guarded `PRAGMA table_info` idiom (not the deprecated probe).
- New statements: `requestValueCoverage` (upsert), `clearValueCoverageRequest`,
  `listRecentValueGenerationDurations` (+ per-project variant, `created_at
  DESC, id DESC` before `LIMIT`).
- `listValueSweepTargets` ORDER BY widened with a new leading
  `coverage_requested_at`-priority term + TTL cutoff parameter; passive
  ordering for unflagged projects must stay byte-identical.
- `upsertValueSweepState` / `upsertValueSweepStateKeepPending` **unchanged**
  (flag must survive a plain sweep upsert).

**Backend — new single-home module (`server/lib/value-coverage.js`, new, 166 lines)**
- `coverageSnapshot()` — the one place `described`/`pool_size`/`pending`/
  `complete`/`demand` is computed, fed only by the composer's `counts`.
- `estimateEta()` — `measured`/`estimating`/`none` states from the last K=5
  duration log rows, per-project-then-fleet-wide.

**Backend — composer (`server/lib/value-summary.js`, 64 lines)**
- `enrichPoolAltitudes(..., {probe:true})` — classify-only mode, no spawn, no
  generation-log row (DEC-9).
- `summaryModel(stage = "unit")` + exported `SUMMARY_STAGES` — one cascade,
  one fallback tail, per-stage env override.

**Backend — tick/drain (`server/lib/value-summary-tick.js`, 605 lines, the largest single diff)**
- New `runCoverageDrain()` sharing the existing module-scope `running`
  overlap guard with `runValueSummaryTickOnce`.
- Re-derives `pending` from each iteration's own full-pool `counts` (never a
  decremented counter); six named, mutually-exclusive exit conditions
  (100% / error / no-progress / iteration cap `MAX_DRAIN_BATCHES_PER_RUN=25` /
  TTL expiry); TTL sweep clears stale `coverage_requested_at` with a log line.
- `value_altitudes_updated` broadcast payload widened to
  `{project_id, unit_keys, pending, coverage}`; broadcast condition widens
  from `generated > 0` to also fire on a `demand`/`complete` transition.

**Backend — routes (`server/routes/project-plans.js`, 91 lines)**
- New `POST /api/project-plans/coverage-request` (flags + fire-and-forget
  drain kick, 202 with a probe-built snapshot).
- New `GET /api/project-plans/coverage` (probe-mode snapshot, byte-same shape
  as the WS payload's `coverage` key).
- `POST /altitudes` deliberately left as a non-coverage-producer (partial-batch
  counts would lie with full-pool authority).

**Frontend — wire contract (`client/src/lib/types.ts`, 92 lines; `client/src/lib/api.ts`, 32 lines)**
- `ValueAltitudesUpdatedPayload` widened with optional `coverage`, a `demand`
  union, a discriminated `eta` union; new `projectPlans.coverage()` /
  `.requestCoverage()` API calls.

**Frontend — first-ever WS subscriber (`client/src/components/PlanLedgerPanel.tsx`, 301 lines)**
- Coverage header ("N of M described · ~X min remaining" / `estimating`),
  "prioritize now" button, the panel's first `eventBus.subscribe` (filtered on
  `project_id`, try/catch-wrapped, unsubscribe on cleanup), monotonic
  `computed_at` merge so an HTTP/WS race can't visibly regress progress.

**Frontend — locales (4 files, 8 lines each)**
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — new
  `planLedger.pool.coverage.*` keys, all four in the same commit.

**Tests changed in this set** (all net-new or extended, not "changed" in the
sense of altering existing assertions on unrelated behavior):
- New: `server/__tests__/value-coverage.test.js` (362 ln), `value-coverage-parity.test.js`
  (232 ln — the named MANDATORY §9.1 deliverable, went through one loop-back
  repair), `coverage-smoke.test.js` (186 ln — the fast-mode acceptance-criterion
  smoke suite), `client/.../PlanLedgerPanel.test.tsx` (376 ln, new file).
- Extended: `chronology-ordering.test.js` (+57), `db-migration.test.js` (+139),
  `project-plans-api.test.js` (+85), `single-writer-guard.test.js` (+79),
  `value-summary-tick.test.js` (+399), `value-summary.test.js` (+137),
  `client/.../ProjectDetail.test.tsx` (+30).
- **Not touched:** `client/src/pages/__tests__/screens.snapshot.test.tsx` — no
  baseline update for the new coverage header / "prioritize now" control
  (named QA debt item 2, below).

**Config / other**
- `docs/API.md`, `docs/DATABASE.md`, `server/README.md`, `ARCHITECTURE.md` —
  updated per `update-project-docs`, confirmed accurate against code by the
  build's own adversarial reviewer.
- `PROJECT-CONTEXT.md` (+184 ln) — catalog updates only (this build's own §9.1/
  §9.3/§9.7 notes and the new STRICTMODE-BLIND CLIENT SUITE candidate), not
  product code.
- `server/index.js` — **zero lines changed**, independently verified
  (`git diff b38b4a1 -- server/index.js` empty). Confirmed in this pass:
  matches.

**Diff-vs-plan agreement:** the actual `git diff --stat b38b4a1..4c2e931`
matches technical-plan §3's named change set file-for-file, plus the four new
test files it names and the `PROJECT-CONTEXT.md` catalog update from DEC-11.
No undisclosed files, no scope creep — this was independently confirmed by
the build's own adversarial reviewer and is re-confirmed here. One deviation,
reviewed and upheld by both the build's verifier and reviewer: the route
calls `runCoverageDrain()` where technical-plan §3.5's literal snippet named
`runValueSummaryTickOnce` — a plan self-contradiction (the literal form would
have left `runCoverageDrain` with no caller and would have violated DEC-3.3),
correctly resolved in the shipped code, not a QA-relevant ambiguity.

## Surfaces / features touched
- **Value Pool background sweep / tick loop** (`value-summary-tick.js`) — new
  priority drain path alongside the existing passive rotation.
- **Coverage computation** (`value-coverage.js`, new) — single home for
  `coverageSnapshot`/`estimateEta`.
- **Schema** (`value_summary_sweep_state.coverage_requested_at`, new nullable
  column + guarded ALTER).
- **HTTP API** — two new endpoints: `POST /api/project-plans/coverage-request`,
  `GET /api/project-plans/coverage`.
- **WebSocket contract** — `value_altitudes_updated` payload additively
  widened; broadcast-trigger condition widened.
- **Client — Plan Ledger panel** (`PlanLedgerPanel.tsx`) — coverage header,
  "prioritize now" control, first-ever live WS subscriber on this component.
- **Locale/i18n** — 4 locale files, `planLedger.pool.coverage.*` namespace.
- **Model-tiering cascade** (`summaryModel(stage)`) — plumbing only, no
  behavior change (both stages still resolve to `haiku`).

## Variant relevance
Two "must stay identical across paths" surfaces are directly in scope, and
both are this project's #1 recurring bug class (§9.1 DERIVED-DUAL-VIEW):

1. **HTTP route vs. WS broadcast — the same `coverageSnapshot` object over two
   delivery paths.** This is exactly the shape §9.1 warns about, and it
   **already fired once inside this build**: the named parity guard
   (`value-coverage-parity.test.js`) was itself found to be a vacuous guard
   (BL-1, fixed with a red-proven repair — see Test-invariants below). Two
   residual live gaps in the same family were knowingly deferred: **SF-1**
   (the tick still separately computes `pending` and puts it on the wire
   alongside `coverage.pending` — two computations of one contract field, one
   field apart, currently agreeing only by accident) and **SF-4** (the
   probe-snapshot composition — assemble → probe → sweep-state read →
   `coverageSnapshot` — is written twice, once per route handler, and the two
   copies have *already diverged* on their `requestedAt` argument).
2. **Four-locale key parity** (`en`/`ko`/`vi`/`zh` × `planLedger.pool.coverage.*`).
   Mechanically enforced by `i18n.test.ts`'s whole-namespace scan and
   mutation-proven in this build (deleting a `ko` key was observed red). One
   named residual gap: **N2** — `value-coverage.test.js`'s own hand-typed
   `STATE_TO_LOCALE_KEY` silently `continue`s on any *new* unmapped registry
   member, so a future 4th `demand`/`eta.state` value could ship with no
   locale key and no test failure. `WATCH-S2-F`'s promotion trigger ("any
   Slice 3 registry growth") fires on exactly this.

## Test-invariants at risk

- [x] **Cross-path consistency (§9.1 DERIVED-DUAL-VIEW)** — coverage/ETA
  single-home is the load-bearing design of this whole slice. **Status: the
  MANDATORY named guard (`value-coverage-parity.test.js`) was itself found
  vacuous mid-build (BL-1) and repaired with a route-and-tick-side red proof**
  — fixed in shipped code, but two smaller instances of the same shape were
  knowingly left open: **SF-1** (dual `pending` computation on one wire
  message) and **SF-4** (duplicated probe-snapshot composition across two
  route handlers, already diverged on one argument). A QA pass on this
  surface should independently re-run the BL-1 red proof (mutate the *tick*
  side, not just the route side — the catalog's own stated lesson from this
  build) and decide whether SF-1/SF-4 need their own guard now rather than at
  the "Slice 3 acquires a third copy" trigger point.
- [x] **Wire-state registry closure (§9.8 OVERLOADED-ABSENCE)** — `demand`
  (`passive`/`requested`/`draining`) and `eta.state`
  (`measured`/`estimating`/`none`) are closed, server-authored, exported
  registries. **Status: two real gaps confirmed by the build's own reviewer
  and left unfixed** — **SF-3**, `demand: "draining"` is unreachable from
  either HTTP route (both hardcode `draining: false`), so a tab that mounts
  mid-drain shows the wrong state until the next broadcast; **SF-6**,
  `shouldBroadcastCoverage` drops a terminal `complete` transition on a
  project's *first* observation in a process lifetime (post-restart
  drain-first resume, or a pool completed by `POST /altitudes` between
  ticks) — an open tab can permanently miss "coverage finished." Both are
  directly testable state-machine gaps, not speculative.
- [x] **Round-trip / staleness integrity on the client** — `PlanLedgerPanel`'s
  monotonic `computed_at` merge (R4) is itself correct and mutation-proven,
  but **SF-8**: the panel is rendered unkeyed on `projectId`, so its
  `coverage` state is not reset on a project switch — if the old project's
  `computed_at` happens to be newer, the merge *permanently* rejects the new
  project's snapshot and the header shows project A's counts under project
  B's pool. This is a cross-variant (cross-project) leak enabled by the very
  merge rule that was built to prevent staleness.
- [x] **No unresolved-boundary-token / silent-failure leak** — **SF-9**: a
  failing `GET /coverage` is joined into the panel's existing `Promise.all`,
  so any 4xx/5xx blanks the *entire* Plan Ledger panel (plans + units + health)
  behind an error banner — a progressive-enhancement header field currently
  has veto power over unrelated, previously-working panel content.
- [x] **§9.3 VACUOUS-GUARD — SF-7, directly named in the build's own review.**
  `coverage-smoke.test.js` — the fast-mode acceptance-criterion suite closing
  AC-2/AC-3/AC-5 — carries four existence-only cases
  (`assert.ok(stmts.requestValueCoverage)` etc.) under describe titles
  promising the *mechanism* ("Coverage Request Mechanism"), plus a
  near-vacuous `assert.ok(snapshot.demand !== undefined)` and a conditional
  assertion (`if (eta.state === "estimating") {...}`, vacuous for any other
  state). **Mitigating fact, independently worth confirming, not assuming:**
  the build claims the real AC-2/AC-3 behavioral proofs live elsewhere
  (`value-summary-tick.test.js`'s exit-condition matrix, `project-plans-api.test.js`
  Group T, `value-coverage.test.js`) — this is the one item the orchestrator's
  brief flagged as directly QA-relevant, and it should not be taken on faith.
- [x] **React 18 StrictMode blind spot (new candidate pattern, not yet in the
  catalog)** — BL-2 (a real dead-rendering regression from an un-re-armed
  `mountedRef`) was invisible to the entire client suite because RTL renders
  without `<StrictMode>`, and was caught only by the adversarial reviewer, by
  reading, not by any test — until one targeted regression test was added
  post-hoc. The *class* of double-invoke bugs remains structurally invisible
  elsewhere in `PlanLedgerPanel.tsx` and in any other component this slice
  touches. Worth a scoped look at whether the one new StrictMode test is
  sufficient coverage for the component's other effects (the WS subscriber
  effect, the coverage-fetch effect), not just the one that broke.
- [x] **§9.2 row-id-as-chronology-proxy** — both new duration-log reads sort
  `created_at DESC, id DESC` before `LIMIT`, mutation-proven
  (`ORDER BY id` flip observed red). No open gap on this axis for the new
  code; **SF-10.2** is a pre-existing, Slice-1-inherited `assert.ok(true, ...)`
  in `value-summary-interrupted-boot.test.js:133`, out of this slice's own
  change set but still keeping the plan's own literal G5 sweep gate
  (`grep "assert.ok(true"` returns 0) unmet by exactly one inherited line.

## Stated intent / acceptance
From `technical-plan.md` §8 Definition of Done (AC-1..AC-6):
- AC-1: passive path behavior-preserving for unflagged projects (view-triggered
  fast path + slow rotation, never eager-backfill).
- AC-2: coverage request flags the project, jumps the rotation, drains to 100%.
- AC-3: header renders "N of M described · ~X min remaining"; cold start
  renders the named `estimating` state; **"a rendered `~0 min` is a
  requirement violation, not a rounding choice."**
- AC-4: `coverageSnapshot.complete` is server-authored and on the wire; no
  disabled Auto-group button ships (descoped to Slice 3 by DEC-2).
- AC-5: the WS subscriber is wired and coverage updates in place in an open tab.
- **AC-6: calibration runs before per-stage defaults are pinned — UNMET.**
  Confirmed independently by both the build's verifier and reviewer: the
  scratchpad haiku-vs-sonnet calibration never ran; no artifact attached to
  DEC-10; the fallback tail is unchanged and both stages still resolve to
  `"haiku"`. This is plumbing-only, not misbehavior (no default was
  re-pinned), but it is an explicitly *unmet* acceptance criterion, not a
  quality judgment call.

## Known, already-named gaps carried forward (this QA pass's explicit scope —
not to be rediscovered as new findings)

**A. `FAST — QA debt` (DEC-F2 / build-report stamp) — full test-plan coverage
was deferred at intake and never authored:**
1. Full E2E of the coverage-request flow (request → rotation jump → drain →
   100% → UI reflects it).
2. `screens.snapshot.test.tsx` baselines for the new header / "prioritize now"
   control — **confirmed absent** in the actual diff.
3. Drain-loop load/perf under WATCH-5 (git-walk cost × drain iterations) and
   WATCH-7 (two-writer race) — race is now structurally guarded by design
   (one runner, one guard, DEC-4), but *frequency under sustained real load*
   was never measured.
4. WS subscriber lifecycle edges beyond the G2 parity assertion — reconnect,
   stale-tab merge, multiple tabs on the same project.
5. Calibration output quality judgment — moot until AC-6 actually runs (see
   above; currently not a judgment gap but a "never happened" gap).
6. Locale copy review beyond mechanical key-completeness (translation
   quality/tone, not key presence).

**B. AC-6 unmet** (see Stated intent above) — carried as a named gate: per
`decisions.md` DEC-2, this must close before Slice 3 (Slice 3's grouping
synthesis is designed to run on a different tier; shipping it against an
unpinned cascade would silently run grouping on `haiku`).

**C. Should-fix items deferred with reasoning in the build's own
`decisions.md` DEC-3** (each already has a disposition; this QA pass's job is
to decide whether any needs its own regression test now rather than at its
named trigger point):
- **SF-4** — duplicated probe-snapshot composition, already diverged on one
  argument (§9.1 composition-layer risk; "highest-value single follow-up" per
  the build's own residual-risk list).
- **SF-6** — terminal `complete` broadcast droppable on first post-restart
  observation (narrows, but does not close, the exact failure DEC-6 exists to
  prevent).
- **SF-7** — the fast-mode smoke suite's four existence-only cases under
  acceptance-criterion titles (§9.3 shape, knowingly shipped; **the item this
  orchestrator's brief calls out as directly QA-relevant** — verify the claim
  that real behavioral proof lives elsewhere before trusting the smoke suite
  as coverage evidence).
- **SF-8** — client `coverage` state not reset on `projectId` change (cross-
  project state leak via the unkeyed panel).
- **SF-9** — a failing `GET /coverage` blanks the whole Plan Ledger panel.
- **SF-10.2** — pre-existing (Slice-1-inherited) vacuous `assert.ok(true, …)`,
  keeps the plan's literal §9.3 sweep gate unmet by one line not introduced by
  this slice.
- **N1** — `estimateEta` selects `generated` and never uses it (batch-size-
  blind ETA weighting); accepted under WATCH-S2-C.
- **N2** — the i18n registry scan (`STATE_TO_LOCALE_KEY`) silently skips
  unmapped members instead of failing; tied to WATCH-S2-F's "any Slice 3
  registry growth" trigger.

## Open questions

**Blocking (cannot plan tests):**
- None. The change set, its intended behavior, and its own already-disclosed
  gaps are all independently confirmed against the actual merged diff. Nothing
  here is ambiguous enough to block test planning.

**Non-blocking (proceeding on assumption):**
- Which real project validates the coverage flow end-to-end (`OPEN-S2-1`,
  intake `decisions.md`, PENDING Sara, explicitly non-blocking) → assumption:
  QA test design should use a seeded/fixture project rather than wait on this,
  per the row's own "does not block" note; a real-project E2E validation
  (debt item A.1 above) is a separate, later concern from unit/integration
  test planning.
- Whether SF-4/SF-6/SF-8/SF-9 warrant fixes-plus-tests in *this* QA pass vs.
  remaining WATCH-style deferred items with their own promotion triggers →
  assumption: that disposition call belongs to the coverage-planning stage
  that consumes this brief, not to intake; flagging all four as live,
  reproducible-today risks (not speculative) so that stage can decide with
  full information.

## Verdict
**READY**
