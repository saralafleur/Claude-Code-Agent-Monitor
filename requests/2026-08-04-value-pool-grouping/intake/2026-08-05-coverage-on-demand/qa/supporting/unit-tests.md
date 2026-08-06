# Unit / Parity Test Design — coverage-on-demand (Value Pool Slice 2)

**Author:** qa-unit-architect · **Date:** 2026-08-05
**Scope:** close the deferred gaps named in `change-brief.md` and
`build/2026-08-05-coverage-on-demand/supporting/review-findings.md` —
SF-4, SF-6, SF-7, SF-8, SF-9, N1, N2, plus the named `screens.snapshot.test.tsx`
QA debt item. This is a **design doc** — exact spec files, exact `it()` titles,
exact assertions. No product or test code is written here.

**Grounding confirmed against the actual merged code at `4c2e931`** (not the
review's snapshot at review time): SF-1, SF-2, SF-3, SF-5 are verified FIXED
in the current tree (`server/lib/value-summary-tick.js:294`, `:173-195`;
`server/routes/project-plans.js:307-335`, `:344-367`; `single-writer-guard.test.js`).
SF-4, SF-6, SF-7, SF-8, SF-9, N1, N2 are verified STILL LIVE in the current
tree — each test below is designed against the code as it actually stands
today, not against the review's now-stale description.

---

## 1. SF-4 — the two probe-snapshot composition sites in `routes/project-plans.js`

**Live defect class (not yet unified — confirmed via `decisions.md` row
"SF-4": *"Not a live defect... extracting `buildProbeCoverage` is a refactor
better done with Slice 3's own consumer in hand"*).** Both
`POST /coverage-request` (`:308-335`) and `GET /coverage` (`:344-367`) still
independently call `valueLedger.assembleValuePool` →
`enrichPoolAltitudes(dbModule, units, { probe: true })` →
`coverageSnapshot(dbModule, {...})`. SF-2/SF-3 already fixed the one concrete
divergence the reviewer caught (`requestedAt`/`draining`); this design closes
the class, not just that one instance, with a guard that fails on the *next*
divergence rather than waiting for a third consumer to notice.

A live HTTP race between the two routes (POST kicks a fire-and-forget drain
whose completion timing is not deterministic — this is exactly the SF-2 bug
shape) makes an end-to-end "call POST then GET and diff the JSON" test
inherently flaky for anything but a trivially-empty pool, and a trivially-empty
pool can't distinguish the two composition sites' arguments (everything
computes to `0`/`true` regardless of which route built it). The right test is
**structural**, mirroring this project's own existing structural-scan
precedent (`value-coverage.test.js`'s "no pool-membership SQL" source-scan
case, `single-writer-guard.test.js`'s `assertSingleHome`) — it reads the
actual route source and asserts the two handler bodies compose from literally
identical building blocks.

**Spec file:** `server/__tests__/project-plans-api.test.js`, extend the
existing `describe("Group T: coverage-on-demand routes ...")` block (T1–T6
already live there) with:

- **`it("T7 (SF-4): the POST /coverage-request and GET /coverage handlers compose their coverageSnapshot call from identical building blocks")`**
  - Read `server/routes/project-plans.js` source with `fs.readFileSync`.
  - Isolate each handler's body: the POST body is the source between
    `router.post("/coverage-request"` and the next `router.get("/coverage"`;
    the GET body is the source between `router.get("/coverage"` and the next
    top-level `router.` call (or EOF-of-relevant-section marker — use the
    next `router.post("/import"` boundary, which is the file's next route).
  - Assert **both** bodies contain the literal substring
    `"await valueLedger.assembleValuePool(dbModule, { id: projectId });"`
    (pool assembly step — DEC-16, the sole composer).
  - Assert **both** bodies contain the literal substring
    `"await enrichPoolAltitudes(dbModule, units, { probe: true });"`
    (probe-mode composer call — DEC-9, no spawn, no log row).
  - Assert **both** bodies contain the literal substring
    `"draining: isDrainingProject(projectId),"` (SF-3's real drain-state
    accessor — this is the exact line that was hardcoded `draining: false`
    in one or both routes before the SF-3 fix; asserting it in both closes
    the door on a future regression reintroducing the hardcode in just one).
  - Assert **both** bodies contain a `coverageSnapshot(dbModule, {` call whose
    argument object, when its keys are extracted via a regex on the object
    literal (`/(\w+):/g` inside the matched `{...}` block, ignoring the outer
    `dbModule` argument), is the **exact same sorted key set**:
    `["computedAt", "counts", "draining", "projectId", "requestedAt"]`. Assert
    this with `assert.deepEqual(postKeys, getKeys)` — a divergence in field
    *count* (e.g. a future route adding a field the other doesn't) is exactly
    the SF-4 shape and must fail loudly here, not silently ship as a third
    inconsistent copy.
  - Do **not** assert the two `requestedAt` argument *expressions* are
    identical text — they are deliberately different (`nowIso` vs.
    `state ? state.coverage_requested_at : null`), which is the correct,
    already-reviewed SF-2 fix, not a defect. The test's job is composition
    *shape* parity, not textual identity.

**Fixture/test data:** none beyond the repo's own `project-plans.js` source
file (read at test time, no DB seed needed for this case — it is a source-scan
guard, matching this file's existing `no pool-membership SQL` precedent's
style rather than Group T's usual live-HTTP style).

**Red-first proof:** revert either route's `draining: isDrainingProject(projectId),`
line back to a hardcoded `draining: false,` (the exact SF-3 regression shape)
— the "both bodies contain the literal substring" assertion goes red. Separately,
add a 6th key (e.g. `demand: "requested",`) to only one route's
`coverageSnapshot(...)` call — the key-set `deepEqual` goes red. Both mutations
are the literal shape SF-4 warns about ("the next consumer acquires a third
copy" starts here, with a second copy already drifting once); this test is the
first time either mutation would be caught mechanically rather than by a human
review pass.

**Traceability note:** this closes SF-4 with a guard rather than a refactor,
consistent with `decisions.md`'s disposition (fix deferred to Slice 3's own
consumer arrival); if/when `buildProbeCoverage` is eventually extracted per
the reviewer's suggested fix, this test's "identical building blocks" shape
becomes trivially true by construction and should be **replaced**, not kept,
by a single call-site-count assertion (`assert.equal` on how many times
`buildProbeCoverage` is invoked across the file, ≥2) — leaving both is
redundant, not additive.

---

## 2. SF-6 — `shouldBroadcastCoverage`'s dropped first-observation terminal transition

**Live defect, confirmed at `server/lib/value-summary-tick.js:190-195`:**
`shouldBroadcastCoverage` still treats an absent `lastBroadcastState` entry as
"no transition" (`transitioned = !!prior && ...` — `prior` is `undefined` on
first observation, so `transitioned` is always `false` regardless of what
`demand`/`complete` actually are). Combined with `generated > 0` as the only
other trigger, a project whose **first** observed sweep in this process's
lifetime is already `complete: true` with `generated === 0` (post-restart
drain-first resume, or a pool completed by `POST /altitudes` between ticks —
the exact scenario named in the header comment at `:111-118`, itself
overclaiming "can only ever SUPPRESS... never fabricate") never broadcasts,
and an open tab never learns coverage finished.

**Spec file:** `server/__tests__/value-summary-tick.test.js` — new `describe`
block, placed near the existing
`describe("Broadcast widening (DEC-6): terminal iteration with generated===0 still emits on a demand/complete transition", ...)` block (`:1335`) since it is
the direct sibling case that block's own scope explicitly did not cover.

- **`describe("SF-6: shouldBroadcastCoverage on a project's FIRST observation in a process lifetime")`**
  - **`it("a project whose first-ever observed sweep is already complete (generated===0) still broadcasts the terminal snapshot")`**
    - Call `__resetTickStateForTest()` first (simulates "no prior broadcast
      recorded for any project" — a fresh process / post-restart state, the
      exact precondition the bug requires).
    - Seed a project (`makeSweptProject`, matching the file's existing helper
      convention) whose pool is already fully described **before the first
      tick runs in this test** — e.g. via `__injectPoolAssemblerForTest`
      returning a pool where every unit already has a cached
      `value_unit_summaries` row (so `enrichPoolAltitudes` reports
      `generated: 0`, `cache_hits: poolSize`, `queued: 0`, `unavailable: 0`
      on the very first sweep — mirrors the pattern already used in the
      "terminal iteration via cache-hit" test at `:1338-1385`, but applied to
      a project's *first* sweep instead of its *second*).
    - Call `runValueSummaryTickOnce(dbModule, { broadcast: capture })` exactly
      once (a single passive sweep, not a drain — this is deliberately the
      simpler passive-rotation path, since SF-6's bug is not drain-specific).
    - Assert the sweep result itself: `result` (or the per-project outcome)
      reports `generated === 0` and the project's snapshot `complete === true`
      — confirms the fixture actually reproduces "already complete, nothing
      generated this sweep."
    - Assert `broadcasts.length === 1` — **this is the assertion that fails
      today.** Current code: `shouldBroadcastCoverage(pid, 0, "passive", true)`
      with `lastBroadcastState` empty computes `transitioned = false` and
      `generated > 0` is `false`, so the function returns `false` and no
      broadcast fires; `broadcasts.length` is `0`.
    - If a broadcast is captured, additionally assert its `coverage.complete
      === true` and `coverage.demand === "passive"` (the payload shape, once
      the broadcast does fire).
  - **`it("a project's first-ever observed sweep that is NOT complete does not spuriously broadcast (no false-positive from the fix)")`**
    - Same `__resetTickStateForTest()` precondition, but seed a pool where
      units are genuinely unresolved (`generated: 0`, `unavailable > 0`,
      `complete: false`).
    - Assert `broadcasts.length === 0` — guards against an overcorrection
      (e.g. "always broadcast on first observation regardless of `complete`")
      that would reintroduce noisy broadcasts on every cold-start passive
      sweep, not just the terminal one SF-6 is about.

**Fixture/test data:** reuse `makeSweptProject`, `makeUnits`,
`__injectPoolAssemblerForTest`, `__injectSpawnForTest` / cache-seeding helpers
already present in this file (see the `:1338-1385` case for the exact
cache-hit seeding idiom via `stmts.upsertValueUnitSummary.run(...)`).

**Red-first proof:** this test is **expected to fail against the code as
merged today** (`4c2e931`) — that failure *is* the reproduction of SF-6, not
a test-authoring bug. It is expected to pass once SF-6's named fix ships
(`server/lib/value-summary-tick.js:190-195` — treat an absent prior as a
transition when `complete === true`, per the reviewer's suggested fix, or
broadcast unconditionally on an absent prior). Record the failure as the
red-proof; do not "fix the test" to pass against unfixed product code — that
would recreate exactly the vacuous-guard shape (§9.3) this build's own BL-1
already paid for once on this same file. The second case (no false-positive)
should pass both before and after the fix and exists to bound the fix's
correctness, not to detect the defect.

---

## 3. SF-7 — `coverage-smoke.test.js`'s existence-only cases under AC-titled describes

**Live defect, confirmed verbatim at the current file contents** (all four
named existence-only cases and both near-vacuous cases from the review are
still present unchanged: `:25-44`, `:36-44`, `:48-67` — module-existence
check — `:93-112` `demand !== undefined`, `:114-136` conditional
`if (eta.state === "estimating")`).

Per the change-brief's explicit instruction, first verify the mitigating
claim ("the real AC-2/AC-3 proofs live elsewhere") **before** designing
replacement assertions, so the fix is "delete + point at the real coverage,"
not "delete + re-derive coverage that already exists" (that would itself be
a needless-duplication smell this project's catalog would flag).

**Verified true** — the real behavioral proofs already exist and are traceable:

| Vacuous case in `coverage-smoke.test.js` | Real proof already covering it |
|---|---|
| `assert.ok(stmts.requestValueCoverage)` (`:25-34`) | `project-plans-api.test.js` T3 (`:848-871`) — actually calls `POST /coverage-request`, asserts the flag stamps and is idempotent |
| `assert.ok(stmts.clearValueCoverageRequest)` (`:36-44`) | `value-summary-tick.test.js`'s TTL-expiry `describe("runCoverageDrain: TTL expiry (DEC-8)")` (`:1193+`) and the drain exit-condition matrix (`:1046+`) — actually exercises the clear path on completion |
| `coverageSnapshot`/`estimateEta` computes correctly (`:64-91`) | `value-coverage.test.js`'s `describe("coverageSnapshot arithmetic (§9.1 single home)")` (`:74+`) — the same arithmetic, asserted with real varied inputs, not one fixed fixture |
| `demand !== undefined` + membership check (`:93-112`) | `value-coverage.test.js`'s `describe("coverageSnapshot demand states (G1b — three distinguishable buckets)")` (`:142+`) — asserts each of the three states individually, plus the never-zero direction |
| conditional `if (eta.state === "estimating")` (`:114-136`) | `value-coverage.test.js`'s `describe("estimateEta state branches (G1a)")` (`:200+`) — unconditional, separate cases per state |
| WS payload `coverage?: CoverageSnapshot` field (`:140-173`) | `value-coverage-parity.test.js`'s G2 case (`:137-219`, post-BL-1 fix) — asserts the field is actually populated on a real broadcast, not just declared in the type |
| `listRecentValueGenerationDurations` exists (`:175-184`) | `value-coverage.test.js`'s `estimateEta` `"measured"`/`"fleet-wide fallback"`/`"K=5 sample"` cases (`:220-262`) — exercises the statement's actual query behavior |

**Spec file:** `server/__tests__/coverage-smoke.test.js` — **replace in place**
(same file, same `describe`/`it` structure kept so the file's own purpose —
"the fast-mode smoke suite" — stays legible), per DEC-F2's own name for this
file:

- Replace `it("requestValueCoverage statement should exist in db module", ...)`
  and `it("clearValueCoverageRequest statement should exist in db module", ...)`
  with a **single** `it("AC-2's mechanism (flag → rotation jump → drain) is proven behaviorally elsewhere; this suite only smoke-checks the wire is connected", ...)` that does ONE real behavioral thing fast-mode can afford: call
  `stmts.requestValueCoverage.run(...)` against the smoke suite's own throwaway
  DB, then `stmts.getValueSweepState.get(...)`, and assert
  `coverage_requested_at` round-trips to the exact value written (a real
  round-trip, not an existence check) — with a comment naming
  `project-plans-api.test.js` T3 as the actual mechanism proof, so a reader
  who wants the full behavior knows where to look (closes the "misleading DoD
  tick" danger the review named, without re-deriving 850 lines of drain-exit
  coverage in a file whose whole point is being fast).
- Replace `it("coverageSnapshot should include demand field (closed registry)", ...)`
  (`:93-112`) with a comment-only pointer to
  `value-coverage.test.js`'s G1b describe block — **delete the case**, it
  adds nothing the real spec doesn't already assert more precisely (three
  separate cases vs. one membership check).
- Replace the conditional ETA case (`:114-136`) with an unconditional
  assertion matching its own title's promise: seed a fixture where
  `pending > 0` and zero qualifying rows exist (same setup already in the
  test), then assert **unconditionally** (no `if`)
  `assert.equal(eta.state, "estimating")` and
  `assert.equal(eta.ms_remaining, undefined)` — this is the minimum needed to
  keep the case non-vacuous while staying in the fast-smoke spirit (one fixed
  fixture, no matrix); point to `value-coverage.test.js`'s
  `"cold start: pending > 0 but zero qualifying rows anywhere"` case (`:210`)
  as the fuller proof.
- Keep the `ValueAltitudesUpdatedPayload` interface-body regex case (`:140-173`)
  as-is — it is **not** vacuous (already isolates the interface body and
  regex-matches the field declaration, not a bare substring scan); no change
  needed.
- Replace `it("listRecentValueGenerationDurations statement should exist for ETA computation", ...)` (`:175-184`) with a pointer comment to
  `value-coverage.test.js`'s `estimateEta` describe block; delete the
  existence-only case.

**Red-first note:** these are replacements of vacuous assertions with either
(a) one real round-trip assertion (would fail if `requestValueCoverage`'s SQL
regressed to a no-op — currently *would not* fail, since the old case only
checked the statement object was truthy) or (b) deletions in favor of an
already-red-proven spec elsewhere. There is no new product-code gap being
closed here — the goal is removing a **false-positive coverage signal**
(§9.3's stated danger: "the next change reads the checkmark and stops
looking"), so the red-first bar is: each surviving case in this file must be
observed to go red under a real mutation of the thing it names (e.g. flip
`requestValueCoverage`'s SQL to a `SELECT 1` no-op and confirm the new
round-trip case catches it, where the old existence check would not).

---

## 4. SF-8 — client `coverage` state not reset on `projectId` change

**Live defect, confirmed:** `PlanLedgerPanel.tsx:646-713` — no
`useEffect(() => setCoverage(null), [projectId])`, and `mergeCoverage`
(`:71-78`) compares only `computed_at`, never `project_id`.
`ProjectDetail.tsx:1292` still renders `<PlanLedgerPanel projectId={id} />`
unkeyed.

**Spec file:** `client/src/components/__tests__/PlanLedgerPanel.test.tsx` —
new case inside the existing
`describe("PlanLedgerPanel: Value Pool Slice 2 coverage header (DEC-1, DEC-5, R4)")` block, immediately after the existing R4 out-of-order case (`:1131-1207`),
since it is the project-scoped sibling of that exact merge rule.

- **`it("SF-8: switching projectId does not leak the previous project's coverage snapshot under the new project's pool")`**
  - Mock `mockListMock`/`mockPoolMock`/`mockHealthMock`/`mockCoverageMock`
    with `mockImplementation` keyed on the `projectId` argument each is
    called with (all four API calls receive `projectId` as their first arg
    per `api.ts`), returning:
    - `"proj-A"`: 1 plan, `makeUnit()`, coverage
      `makeCoverage({ described: 10, pool_size: 10, pending: 0, complete: true, computed_at: "2026-06-10T12:00:00.000Z" })`
      (a **newer** `computed_at` than project B's, deliberately, since that
      is the exact condition that makes the monotonic merge permanently
      reject B's snapshot).
    - `"proj-B"`: 1 different plan, a different unit, coverage
      `makeCoverage({ described: 3, pool_size: 20, pending: 17, complete: false, computed_at: "2026-06-01T09:00:00.000Z" })`
      (an **older** `computed_at`, project B's own honest value).
  - `const { rerender } = render(<PlanLedgerPanel projectId="proj-A" />)`.
  - `await waitFor(...)` until the header shows `"10 of 10 described"`.
  - `rerender(<PlanLedgerPanel projectId="proj-B" />)` — the unkeyed-render
    scenario SF-8 names (React reuses the same component instance and its
    state, exactly as `ProjectDetail.tsx:1292`'s real unkeyed render does).
  - `await waitFor(...)` and assert the header text contains
    `"3 of 20 described"` — **project B's real numbers.**
  - Also assert the header text does **not** contain `"10 of 10 described"`
    (project A's stale numbers must not survive the switch).
  - Also assert `document.querySelector('[data-test="coverage-header"]')`
    does not read `pool_size: 10` anywhere in its rendered text (belt-and-
    braces on the same claim, phrased as "no trace of the old project's pool
    size").

**Fixture/test data:** extends the existing `makeCoverage()`/`makeUnit()`/
`makePlan()` factories already in this file; no new fixtures needed, only two
distinguishable projects' worth of return values via `mockImplementation`.

**Red-first proof:** this test **fails against the code as merged today** —
because project A's `computed_at` ("2026-06-10T12:00:00.000Z") is later than
project B's ("2026-06-01T09:00:00.000Z"), `mergeCoverage`'s
`next.computed_at > prev.computed_at` check rejects B's snapshot outright, and
the header keeps rendering `"10 of 10 described"` under project B's mount.
This is the literal, live, reproducible-today defect SF-8 names, not a
hypothetical. It is expected to pass once SF-8 ships either fix named in the
review: `setCoverage(null)` in a `useEffect(..., [projectId])`, or a
`project_id`-aware `mergeCoverage` that always accepts a `next` whose
`project_id` differs from the currently-held snapshot's.

---

## 5. SF-9 — a failing `GET /coverage` blanks the entire Plan Ledger panel

**Live defect, confirmed:** `PlanLedgerPanel.tsx:696-708` — `coverageRes` is
still joined into the same `Promise.all([...])` as `plansRes`/`poolRes`/
`healthRes`; any rejection of `api.projectPlans.coverage(projectId)` throws
out of the `try`, and the `catch` sets `error` without ever calling
`setPlans`/`setUnits`/`setHealth` — so a `GET /coverage` failure leaves the
whole panel showing only the error banner, with no plan list and no pool.

**Spec file:** `client/src/components/__tests__/PlanLedgerPanel.test.tsx` —
new case in the same
`describe("PlanLedgerPanel: Value Pool Slice 2 coverage header (DEC-1, DEC-5, R4)")` block.

- **`it("SF-9: a failing GET /coverage degrades gracefully — plans and pool still render, not blanked behind an error banner")`**
  - `mockListMock.mockResolvedValue({ plans: [plan] })` with one real plan
    (e.g. `makePlan()` with `title: "Phase 1: Intake"`).
  - `mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] })`
    with a real unit.
  - `mockHealthMock.mockResolvedValue(makeHealth())`.
  - `mockCoverageMock.mockRejectedValue(new Error("coverage endpoint 500"))`
    — the one leg fails, the other three succeed.
  - `render(<PlanLedgerPanel projectId="proj-1" />)`.
  - Assert (`await waitFor`) that `screen.getByText("Phase 1: Intake")` **is**
    in the document — the plan list rendered despite the coverage failure.
  - Assert the pool unit's row/marker is present (same assertion idiom the
    existing pool-rendering cases in this file already use).
  - Assert `document.querySelector('[data-test="coverage-header"]')` is
    **absent** (progressive-enhancement degradation: no header, since there is
    no coverage snapshot to render — this is the acceptable, honest failure
    mode, not a fabricated one).
  - Assert there is **no** full-panel error banner covering the plan/pool
    content — i.e. either no `error` state element rendered at all, or (if
    the eventual fix chooses to still surface a small, non-blocking notice)
    that the plan/pool content is present *alongside* it, not replaced by it.
    Phrase the concrete assertion as: `screen.queryByText(/coverage endpoint 500/)`
    is not blocking — `screen.getByText("Phase 1: Intake")` must independently
    also be present in the same render.

**Fixture/test data:** existing `makePlan`, `makeUnit`, `makeHealth`
factories; no new fixtures.

**Red-first proof:** this test **fails against the code as merged today** —
`mockCoverageMock.mockRejectedValue(...)` causes the panel's `Promise.all` to
reject as a whole, `setPlans`/`setUnits`/`setHealth` are never called, and
`screen.getByText("Phase 1: Intake")` times out / is never found (the panel
instead shows `error.message` in the red banner and nothing else). It is
expected to pass once SF-9's named fix ships:
`api.projectPlans.coverage(projectId).catch(() => ({ coverage: null }))`
isolating that one leg from the shared `Promise.all`.

---

## 6. N1 — `estimateEta`'s batch-size-blind averaging (decision, not a live gap)

**Disposition:** `decisions.md` DEC-3 / `WATCH-S2-C` already accepts this as
a known ETA-skew risk with a named promotion trigger ("ETA observed
materially wrong"). Per this pass's own remit ("decide whether any needs its
own regression test now rather than at its trigger point") — **N1 does not
need a live-behavior-changing test**, but it does need a **characterization
test** so a future, unreviewed change to `estimateEta`'s weighting is a
visible diff against a named baseline, not a silent behavior change nobody
notices until WATCH-S2-C's trigger fires in production.

**Spec file:** `server/__tests__/value-coverage.test.js` — new case in the
existing `describe("estimateEta state branches (G1a)")` block, immediately
after `"uses at most ETA_SAMPLE_SIZE (K=5) most-recent rows"` (`:250-262`).

- **`it("N1 (WATCH-S2-C, characterization — not a bug fix): per_batch_ms is a simple mean of duration_ms, ignoring each row's own generated count")`**
  - `seedGenerationRow(projectId, { durationMs: 6000, generated: 2, daysAgo: 0 })`
    (a small, 2-unit batch that took 6s).
  - `seedGenerationRow(projectId, { durationMs: 6000, generated: 40, daysAgo: 1 })`
    (a full, 40-unit batch that also took 6s — a very different per-unit cost,
    deliberately chosen so a batch-size-aware implementation would compute a
    materially different `per_batch_ms` than a size-blind mean).
  - `const eta = estimateEta(dbModule, { projectId, pending: 40 })`.
  - `assert.equal(eta.per_batch_ms, 6000)` — documents today's actual
    (size-blind) arithmetic explicitly, with a comment citing this exact
    case name and WATCH-S2-C, so the next person to touch this function sees
    a named, dated baseline instead of rediscovering the gap from scratch.
  - Comment (not an assertion): "If this test ever needs to change because
    `estimateEta` starts normalizing by `generated`, that is WATCH-S2-C's
    trigger firing — update `decisions.md` in the same commit, don't just
    fix this number."

**Fixture/test data:** the existing `seedGenerationRow(projectId, {durationMs, generated, daysAgo})` helper already supports a `generated` override
(`:47-64` of the current file) — no new fixture machinery needed.

**Red-first note:** this is a **characterization test, not a defect-proving
one** — it is green today and stays green until someone changes
`estimateEta`'s weighting. Its "red" event is deliberately in the future: it
should go red the day someone edits the averaging logic, forcing that person
to touch `decisions.md`'s WATCH-S2-C row in the same diff rather than
silently changing ETA behavior. Do not treat a red run of this specific test
as a bug — treat it as the trigger.

---

## 7. N2 — the i18n `STATE_TO_LOCALE_KEY` exemption set is not closed

**Live defect, confirmed:** `value-coverage.test.js:283-326` — the
`STATE_TO_LOCALE_KEY.demand`/`.eta` maps hand-list only the states that DO
have a locale key, and any `DEMAND_STATES`/`ETA_STATES` member not present as
a key in the map hits `if (!key) continue;` silently. A 4th registry member
(Slice 3 growth, per WATCH-S2-F's stated trigger) ships with no locale key and
no test failure.

**Spec file:** `server/__tests__/value-coverage.test.js` — extend the
existing `describe("i18n registry → locale (WATCH-S2-F, G6): ...")` block
(`:276-338`) with one new case, placed before the per-locale loop so it fails
fast and independent of locale files:

- **`it("N2: the STATE_TO_LOCALE_KEY exemption set (registry members with NO locale key) is exactly the reviewed closed set, not silently permissive")`**
  - Compute `const exemptDemand = DEMAND_STATES.filter((s) => !STATE_TO_LOCALE_KEY.demand[s]);`
    and assert `assert.deepEqual(exemptDemand, ["passive"])` — the ONE
    reviewed, commented exemption (`"passive" has no dedicated copy"` per the
    existing code comment at `:285-286`).
  - Compute `const exemptEta = ETA_STATES.filter((s) => !STATE_TO_LOCALE_KEY.eta[s]);`
    and assert `assert.deepEqual(exemptEta, ["none"])` — the ONE reviewed,
    commented exemption (`:293`).
  - This is the review's own suggested fix verbatim ("assert the exempt set
    is exactly `["passive"]` / `["none"]`") — if `DEMAND_STATES` or
    `ETA_STATES` grows a 4th member and nobody updates
    `STATE_TO_LOCALE_KEY`, `exemptDemand`/`exemptEta` grows past its expected
    single element and this assertion fails **before** the per-locale loop
    below it ever gets a chance to silently `continue` past the new member.

**Fixture/test data:** none — reads the already-imported `DEMAND_STATES`,
`ETA_STATES`, and the test file's own `STATE_TO_LOCALE_KEY` constant.

**Red-first proof:** add a 4th value to `DEMAND_STATES` in `value-coverage.js`
(e.g. `"stalled"`) without adding a corresponding `STATE_TO_LOCALE_KEY.demand`
entry or a locale key anywhere — today's suite (all four per-locale cases,
which `continue` past unmapped members) stays fully green, silently
demonstrating the exact gap N2 names. With this new case added,
`exemptDemand` becomes `["passive", "stalled"]`, `deepEqual(["passive"])`
fails, and the suite goes red on the registry growth itself, at the point of
growth, not at a later locale-drift discovery.

---

## 8. `screens.snapshot.test.tsx` — no baseline for the coverage header / "prioritize now" control

**Confirmed absent, per both the change brief and direct inspection:** the
"Project detail" case (`screens.snapshot.test.tsx:679-687`) renders
`ProjectDetail` at `/projects/proj-1` against the file's shared,
deterministically-empty `projects.list: r({ projects: [] })` fixture, so the
page renders its **not-found** state and `PlanLedgerPanel` never mounts at
all for this snapshot — there is no coverage header or "prioritize now"
control anywhere in the current baseline `.snap` file. (The file's own
comment at `:676-678` says the populated/happy path is intentionally left to
`ProjectDetail.test.tsx` instead — but `ProjectDetail.test.tsx` also never
exercises a non-empty, in-progress `coverage` snapshot: its `beforeEach`
default fixture is `pool_size: 0` / `complete: true`, so the header's `{coverage && coverage.pool_size > 0 && (...)}` gate never opens there either.)
This is a genuine, still-open gap, not a stale claim.

**Spec file 1 (assertion-based, primary):**
`client/src/pages/__tests__/ProjectDetail.test.tsx` — new case, placed after
`"renders the PlanLedgerPanel card beside existing cards (F2)"` (`:794+`),
reusing that case's plan/pool fixture pattern:

- **`it("renders the coverage header and 'prioritize now' control when the pool is in-progress")`**
  - Override `projectPlansCoverageMock.mockResolvedValue({ coverage: { project_id: "proj-1", described: 4, pool_size: 10, pending: 6, complete: false, demand: "passive", requested_at: null, eta: { state: "estimating" }, computed_at: "2026-06-10T13:00:00.000Z" } })`
    (in-progress, cold-start ETA, passive demand — the state that makes the
    "prioritize now" button visible per `PlanLedgerPanel.tsx`'s
    `{!coverage.complete && coverage.demand === "passive" && (...)}` gate).
  - `projectPlansPoolMock.mockResolvedValue({ units: [<one real unit>], identityWarnings: [] })`
    (needed so `pool_size > 0` — the header's own render gate).
  - `renderPage()`.
  - Assert (`await waitFor`) `document.querySelector('[data-test="coverage-header"]')`
    is present and its text contains `"4 of 10 described"` and the
    `estimating` copy (matching the exact string used in
    `PlanLedgerPanel.test.tsx`'s own cold-start case, so the two specs assert
    the same real i18n copy rather than diverging phrasings).
  - Assert `document.querySelector('[data-test="prioritize-now-button"]')` is
    present.
  - This case gives `screens.snapshot.test.tsx`'s eventual baseline update a
    **behavioral anchor** independent of the opaque snapshot diff — if the
    snapshot's rendered coverage-header markup ever changes, this assertion
    (not just eyeballing a diff) proves whether the change preserved the
    described-N-of-M/estimating/button semantics.

**Spec file 2 (the named baseline itself):**
`client/src/pages/__tests__/screens.snapshot.test.tsx` — add:

- Import `import { api } from "../../lib/api";` at the top (alongside the
  existing page imports) so this one case can override the shared mock's
  return values for a single run without disturbing every other screen's
  deterministic-empty fixture.
- New case in the `describe("screen snapshots", ...)` block, immediately
  after the existing `it("Project detail", ...)` case:
  - **`it("Project detail (coverage in progress)", async () => { ... })`**
    - Before rendering, call
      `vi.mocked(api.projects.list).mockResolvedValueOnce({ projects: [{ id: "proj-1", name: "Agent Monitor", ... }], unassigned: {...} })`
      (a real, matching project so `ProjectDetail` does NOT hit its
      not-found branch — reuse the minimal shape the shared `Project` type
      requires).
    - `vi.mocked(api.projectPlans.pool).mockResolvedValueOnce({ units: [<one unit>], identityWarnings: [] })`.
    - `vi.mocked(api.projectPlans.coverage).mockResolvedValueOnce({ coverage: {...same in-progress shape as spec 1 above...} })`.
    - `await snapshot(<Routes><Route path="/projects/:id" element={<ProjectDetail />} /></Routes>, "/projects/proj-1")`.
    - This produces a **new, additive** `.snap` entry (`Project detail (coverage in progress) 1`) — it does not touch the existing "Project detail" entry, so no existing baseline changes as a side effect of adding this coverage-specific one.

**How to regenerate/review the baseline (per `technical-plan.md` §6 and
CLAUDE.md's testing policy — never blind):**
```
cd client && npx vitest run -u -t "Project detail (coverage in progress)"
```
then **read the generated diff/entry in
`client/src/pages/__tests__/__snapshots__/screens.snapshot.test.tsx.snap`**
and confirm it shows the coverage header text and the "prioritize now" button
markup before committing it — do not run a blanket `-u` across the whole
snapshot file for this change (that would silently accept unrelated drift in
the other 20 screens).

**Red-first note:** spec 1 (`ProjectDetail.test.tsx`) is a genuine new
behavioral assertion — it should already **pass** against current code (the
header/button logic itself works; only the snapshot baseline was missing),
so its "red" proof is a mutation, not a pre-existing bug: temporarily change
`PlanLedgerPanel.tsx`'s render gate from `coverage.pool_size > 0` to
`coverage.pool_size > 100` (or delete the "prioritize now" button's JSX) and
confirm this new case goes red — proving it actually pins the header/button,
not just that the page mounts. Spec 2 (the snapshot case) is new baseline
infrastructure, not a red/green behavioral proof by itself; its purpose is
making a future *unreviewed* markup regression visible as a diff, and its own
correctness is validated by spec 1's explicit assertions running against the
same fixture shape.

---

## 9. Test data / fixtures summary (reuse, no new fixture files)

- **Server:** `server/__tests__/project-plans-api.test.js`'s `makeProject`,
  `fetch`/`post` helpers; `value-summary-tick.test.js`'s `makeSweptProject`,
  `makeUnits`, `__injectPoolAssemblerForTest`, `__injectSpawnForTest`,
  `stmts.upsertValueUnitSummary` cache-seed idiom;
  `value-coverage.test.js`'s `freshProjectId`, `seedGenerationRow`, `counts()`.
  No new fixture files needed — every new case above is built entirely from
  helpers this project's suites already export/define.
- **Client:** `PlanLedgerPanel.test.tsx`'s `makePlan`, `makeItem`, `makeUnit`,
  `makeHealth`, `makeCoverage` factories; `ProjectDetail.test.tsx`'s
  `mockProject`/`mockRepoTopology`/`mockIntakeReport` fixtures and its
  `projectPlansCoverageMock`/`projectPlansRequestCoverageMock` mocks (already
  wired in `beforeEach`, just needs per-case `.mockResolvedValue` overrides).

## 10. How to run

- Server: `npm run test:server` (runs `node --test server/__tests__/*.test.js`).
  To run a single new spec while iterating:
  `node --test server/__tests__/project-plans-api.test.js`,
  `node --test server/__tests__/value-summary-tick.test.js`,
  `node --test server/__tests__/coverage-smoke.test.js`,
  `node --test server/__tests__/value-coverage.test.js`.
- Client: `npm run test:client` (Vitest). To run a single new spec:
  `cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx`,
  `cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx`,
  `cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx`.
- Snapshot baseline regeneration (deliberate, reviewed, per CLAUDE.md):
  `cd client && npx vitest run -u -t "Project detail (coverage in progress)"`.
- Sweep discipline before declaring any of the above done (per
  `technical-plan.md` §6): re-run
  `grep -rn "assert.ok(true" server/__tests__/` (still returns 1 today —
  `value-summary-interrupted-boot.test.js:133`, SF-10.2, already dispositioned
  as a separate pre-existing row, not reopened by this pass) and
  `grep -rn "|| true" server/__tests__/` (must stay 0) after adding the above.

## 11. Explicit non-goals of this pass

- **SF-10.2** (the inherited `assert.ok(true, ...)` at
  `value-summary-interrupted-boot.test.js:133`) already has a dated
  disposition row in `decisions.md` ("Fix it in the next build that touches
  boot") — this pass does not re-open it; it is out of this slice's own
  change set per that row's own reasoning, and touching
  `value-summary-interrupted-boot.test.js` here would be scope creep against
  a file this slice never changed.
- **N3** (the parity test's self-scanning second case) already has a named,
  low-priority fix shape in the review and no live consequence — not
  redesigned here; SF-4's new structural test (§1 above) is the real version
  of what N3 wished it were, applied to product code instead of the test's
  own source.
- **AC-6 / SF-11** (calibration) is explicitly a MANDATORY task-list /
  `decisions.md` disposition item, not a unit-test gap — no test can prove a
  calibration run happened; out of this architect's remit.
