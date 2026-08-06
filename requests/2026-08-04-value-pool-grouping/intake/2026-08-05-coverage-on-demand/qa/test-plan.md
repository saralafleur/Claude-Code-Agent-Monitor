# Test Plan — coverage-on-demand (Value Pool Slice 2)

> Authored by `qa-lead`, synthesizing `supporting/coverage.md` + `supporting/risk.md`
> + `supporting/unit-tests.md` + `supporting/e2e-tests.md` under
> `qa-assessment.md`'s **BLIND (scoped)** verdict. This is the buildable QA
> deliverable: exactly which specs to add/modify, exactly which assertions, in
> dependency order, with the red-first proof for each. A `team-build` implementer
> should be able to execute this without re-reading the investigation.
>
> **Commit under plan:** `4c2e931`, already merged to local `master` (ancestor of
> `HEAD`, not yet on `origin/master`). **Gate:** the P0 block below must land
> before pushing to `origin` and before Slice 3 starts.

---

## Objective

Close the three live, reproducible-today defects that the current 1784/1784 +
817/817 green suite cannot see (SF-8 cross-project coverage leak, SF-9
progressive-enhancement fetch blanking the whole Plan Ledger panel, SF-6 dropped
terminal `complete` broadcast on a project's first observation in a process
lifetime), each with a test that is **RED against merged `master` today** and
green only after the named fix. Then, in the same change set, add three cheap
structural guards that stop the *next* instance rather than this one (N2's
exact-exemption registry assertion, SF-4's route↔route composition-parity scan,
and SF-9's per-leg failure-isolation assertion written as a reusable helper), and
remove one false-confidence signal (SF-7's existence-only cases under
acceptance-criterion titles). End state: "a component's coverage state belongs to
the project it is mounted for," "a progressive-enhancement fetch cannot veto core
panel content," "a terminal `complete` transition always reaches the wire, prior
state or not," "the two probe-composition sites stay in lockstep," and "a new
`demand`/`eta.state` registry member cannot ship without a locale key" are all
mechanically asserted invariants instead of prose in a `decisions.md` row.

---

## Coverage gap being closed

| Gap | Layer | Catalog id | Assertion that will now pin it |
|---|---|---|---|
| **SF-8** — panel `coverage` state not reset on `projectId` change; `mergeCoverage` (`PlanLedgerPanel.tsx:71`) compares only `computed_at`, never `project_id`; `ProjectDetail.tsx:1292` renders the panel unkeyed | client | **MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH** (candidate, registered this pass) | Rerender the same mounted instance with a new `projectId` and an *older* snapshot; header must show the new project's counts and no trace of the old project's `pool_size` |
| **SF-9** — `api.projectPlans.coverage()` shares one `Promise.all` and one `catch` with `list`/`pool`/`health` (`PlanLedgerPanel.tsx:696-708`) | client | no-veto / partial-failure-isolation invariant (general) | Reject only the coverage leg; plan title and pool unit must still render, no full-panel error banner replacing them |
| **SF-6** — `shouldBroadcastCoverage`'s `const transitioned = !!prior && (…)` (`value-summary-tick.js:190-195`) makes a first observation structurally incapable of being a transition | server | **§9.8 OVERLOADED-ABSENCE**, OPEN (this is the very next build on the surface that promoted it) | After `__resetTickStateForTest()`, a project whose first observed sweep is already `complete` with `generated === 0` must broadcast exactly once — plus the negative case bounding the fix |
| **SF-4** — the 4-step probe composition (assemble → probe → sweep-state read → `coverageSnapshot`) written twice, once per route handler, already diverged once on `requestedAt` | server | **§9.1 DERIVED-DUAL-VIEW**, OPEN (7 occurrences) | Source scan: both handler bodies contain the same three literal composition steps and pass an **identical sorted key set** to `coverageSnapshot(dbModule, {…})` |
| **N2** — `STATE_TO_LOCALE_KEY` silently `continue`s past any unmapped `DEMAND_STATES`/`ETA_STATES` member | server (test layer) | **§9.7 HAND-SCOPED STRUCTURAL SCAN**, OPEN (7 occurrences) | `assert.deepEqual(exemptDemand, ["passive"])` / `assert.deepEqual(exemptEta, ["none"])` — registry growth breaks the test at the point of growth |
| **SF-7** — four existence-only cases + one near-vacuous + one conditional assertion under "AC-2: Coverage Request Mechanism"-style titles in `coverage-smoke.test.js` | server (test layer) | **§9.3 VACUOUS-GUARD**, OPEN | Each surviving case in that file must go red under a real mutation of the thing its title names; the rest become pointer comments at the real proofs |
| **screens-snapshot blind spot** — the suite's shared API mock omits `coverage`/`requestCoverage` entirely, and the "Project detail" case never mounts `PlanLedgerPanel` (short-circuits to "Project not found") | client | (structural; a live in-suite demonstration of SF-9) | A real project fixture so the panel actually mounts, `coverage`/`requestCoverage` added to the shared mock, and a behavioral anchor in `ProjectDetail.test.tsx` before any `.snap` entry is blessed |

**Explicitly NOT reopened here** (each already dispositioned, do not re-litigate):
SF-1/SF-2/SF-3/SF-5 (verified **fixed** in the shipped tree), **SF-10.2**
(pre-existing Slice-1-inherited `assert.ok(true, …)` at
`value-summary-interrupted-boot.test.js:133` — out of this slice's change set),
**N1** (accepted under WATCH-S2-C; one optional characterization test only),
**AC-6** (a scheduling gate, not a testable gap — no test can prove a calibration
ran).

---

## Reconciliation of the two architects (read this before writing anything)

Three places where the unit and e2e designs overlapped or disagreed. These are
decided; implement the decision, not the source document.

1. **`draining` over HTTP — the e2e design's premise is stale. Do NOT write it.**
   `supporting/e2e-tests.md` §2a step 5 instructs asserting that *"every polled
   `GET /coverage` response has `draining` absent/false"*, citing SF-3 as unfixed.
   **SF-3 is fixed** — `isDrainingProject` is real (`value-summary-tick.js:579`,
   exported at `:629`) and threaded into both route handlers
   (`routes/project-plans.js:332,363`), confirmed by the cartographer, the unit
   architect, and the risk analyst independently. Writing that assertion would
   **pin the wrong behavior** and would be a fresh §9.3 event. Decision: drop it.
   The real residual (cartographer's PARTIAL) is that no test ever observes
   `demand === "draining"` on an HTTP response during a genuine in-flight drain —
   and that is a **timing-sensitive** thing to poll for in an e2e flow. It is
   therefore pushed **down** to the integration layer as P3 item 12 (T8), where a
   controllable, unresolved spawn promise makes it deterministic. The e2e spec
   asserts only the tolerant, non-flaky form: *at least one* WS frame mid-flow has
   `demand !== "passive"`.

2. **Permutation coverage stays at the unit/tick layer; e2e is one flow, once.**
   The drain's six exit conditions, the coverage/ETA arithmetic branch table, the
   four-locale key parity, and the general route↔broadcast parity claim are all
   already proven cheaper and more precisely at the unit layer and are **not**
   re-derived in `coverage-request-e2e.test.js`. That file gets exactly one
   seeded scenario (request → rotation jump → 3-batch drain → 100% → real WS
   frame → HTTP/WS agreement → starvation bound), sequential, no matrix.

3. **The client "lifecycle edges" block is trimmed, and one case is absorbed.**
   The e2e design's *"multiple tabs, different projects (isolation)"* case asserts
   the same invariant as P0 item 1 (SF-8) at a different mount shape (two mounts
   vs. one rerendered mount). Keep both — they are one line apart and the
   two-mount form is the only one that proves the `project_id` message filter
   holds under two live subscribers — but the **rerender** form is the mandatory
   one, because it is the shape `ProjectDetail.tsx:1292` actually produces. The
   remaining lifecycle-edge cases (reconnect, fetch-after-WS stale merge,
   two-tabs-same-project, WATCH-S2-B negative) are real but are **P3**, not
   mandatory: none of them is red today.

---

## Test change set

Priority tiers, used throughout: **P0 MANDATORY** (live defect, RED today, gates
the push to `origin` and Slice 3) · **P1 durable cure** (rides this same change
set; strategist's items 4–6) · **P2 hygiene / false-confidence removal** ·
**P3 nice-to-have / named-debt closure**.

This project has **two test layers, no third** (confirmed by the cartographer):
`node --test server/__tests__/*.test.js` (unit + integration in one bucket, no
folder split, no tag/bucket convention) and `vitest run` for the client. There is
**no browser E2E harness** — the highest-fidelity "E2E" shape available is a real
`createApp`/`startServer` + real SQLite + real `ws` client inside a server spec,
which is what item 11 does.

### Backend (`server/__tests__/`, run by `npm run test:server`)

- **`server/__tests__/value-summary-tick.test.js`** — **UPDATE**, **P0 MANDATORY**.
  New `describe("SF-6: shouldBroadcastCoverage on a project's FIRST observation in a process lifetime")`, placed adjacent to the existing
  `describe("Broadcast widening (DEC-6): …")` block (~`:1335`), which is the
  direct sibling this case's scope explicitly did not cover.
  - `it("a project whose first-ever observed sweep is already complete (generated===0) still broadcasts the terminal snapshot")`
    - Call `__resetTickStateForTest()` first (this **is** the precondition — an
      empty `lastBroadcastState`, i.e. a fresh process / post-restart state).
    - Seed via `makeSweptProject` + `__injectPoolAssemblerForTest` a project whose
      pool is **already fully described before the first tick in this test** —
      every unit has a cached `value_unit_summaries` row (the
      `stmts.upsertValueUnitSummary.run(...)` cache-seed idiom already used at
      `:1338-1385`), so the first sweep reports `generated: 0`,
      `cache_hits: poolSize`, `queued: 0`, `unavailable: 0`.
    - Call `runValueSummaryTickOnce(dbModule, { broadcast: capture })` **once**
      (passive rotation path — SF-6 is not drain-specific; the simpler path is
      the honest reproduction).
    - Assert the fixture really reproduces the precondition: the sweep result
      reports `generated === 0` **and** the project's snapshot `complete === true`.
    - Assert `broadcasts.length === 1` ← **this is the assertion that is red today.**
    - Assert the captured payload's `coverage.complete === true` and
      `coverage.demand === "passive"`.
  - `it("a project's first-ever observed sweep that is NOT complete does not spuriously broadcast (no false-positive from the fix)")`
    - Same `__resetTickStateForTest()` precondition; seed a pool with genuinely
      unresolved units (`generated: 0`, `unavailable > 0`, `complete: false`).
    - Assert `broadcasts.length === 0`. Green before **and** after the fix — this
      case exists to bound the fix against the obvious overcorrection ("always
      broadcast on first observation"), which would make every cold-start passive
      sweep noisy.

- **`server/__tests__/value-coverage.test.js`** — **UPDATE**, **P1 durable cure**.
  Extend `describe("i18n registry → locale (WATCH-S2-F, G6): …")` (`:276-338`) with
  one case placed **before** the per-locale loop so it fails fast:
  - `it("N2: the STATE_TO_LOCALE_KEY exemption set (registry members with NO locale key) is exactly the reviewed closed set, not silently permissive")`
    - `const exemptDemand = DEMAND_STATES.filter((s) => !STATE_TO_LOCALE_KEY.demand[s]);`
      → `assert.deepEqual(exemptDemand, ["passive"])`.
    - `const exemptEta = ETA_STATES.filter((s) => !STATE_TO_LOCALE_KEY.eta[s]);`
      → `assert.deepEqual(exemptEta, ["none"])`.

- **`server/__tests__/project-plans-api.test.js`** — **UPDATE**, **P1 durable cure**.
  Extend `describe("Group T: coverage-on-demand routes …")` (`:826`) with:
  - `it("T7 (SF-4): the POST /coverage-request and GET /coverage handlers compose their coverageSnapshot call from identical building blocks")`
    - `fs.readFileSync` `server/routes/project-plans.js`; isolate the POST body
      (from `router.post("/coverage-request"` to the next `router.get("/coverage"`)
      and the GET body (from `router.get("/coverage"` to the next top-level
      `router.` call — use `router.post("/import"` as the boundary).
    - Both bodies contain the literal
      `await valueLedger.assembleValuePool(dbModule, { id: projectId });` (DEC-16,
      sole composer).
    - Both bodies contain the literal
      `await enrichPoolAltitudes(dbModule, units, { probe: true });` (DEC-9, no
      spawn, no generation-log row).
    - Both bodies contain the literal `draining: isDrainingProject(projectId),`
      (regression-proofs the SF-3 fix in both routes at once).
    - Extract each body's `coverageSnapshot(dbModule, { … })` argument-object key
      set by regex (`/(\w+):/g` inside the matched `{…}`, excluding the outer
      `dbModule` arg), sort both, and
      `assert.deepEqual(postKeys, getKeys)` — additionally
      `assert.deepEqual(postKeys, ["computedAt","counts","draining","projectId","requestedAt"])`
      so a *matched pair of drifts* still fails.
    - **Do NOT** assert the two `requestedAt` argument *expressions* are textually
      identical — they are deliberately different (`nowIso` vs.
      `state ? state.coverage_requested_at : null`); that difference **is** the
      already-reviewed SF-2 fix. This test asserts composition *shape* parity only.

- **`server/__tests__/coverage-smoke.test.js`** — **UPDATE (replace in place)**,
  **P2 hygiene**. Keep the file's identity as the fast-mode smoke suite; keep its
  `describe` titles legible. The mitigation claim ("the real AC-2/AC-3 proofs live
  elsewhere") was independently verified by the unit architect **and it holds** —
  so this is deletion-plus-pointers, not re-derivation:
  - Replace the two statement-existence cases (`:25-34`, `:36-44`) with **one** real
    round-trip: `stmts.requestValueCoverage.run(...)` against the suite's throwaway
    DB, then `stmts.getValueSweepState.get(...)`, asserting `coverage_requested_at`
    round-trips to the exact value written. Comment names
    `project-plans-api.test.js` T3 as the actual mechanism proof.
  - **Delete** `it("coverageSnapshot should include demand field (closed registry)")`
    (`:93-112`); leave a comment pointing at `value-coverage.test.js`'s G1b block.
  - Replace the conditional ETA case (`:114-136`) with the **unconditional** form its
    own title promises: same fixture (`pending > 0`, zero qualifying rows), then
    `assert.equal(eta.state, "estimating")` and
    `assert.equal(eta.ms_remaining, undefined)` — no `if`.
  - **Keep unchanged** the `ValueAltitudesUpdatedPayload` interface-body regex case
    (`:140-173`) — it already isolates the interface body and matches the field
    declaration; it is not vacuous.
  - **Delete** `it("listRecentValueGenerationDurations statement should exist …")`
    (`:175-184`); pointer comment to `value-coverage.test.js`'s `estimateEta` block.

- **`server/__tests__/coverage-request-e2e.test.js`** — **NEW**, **P3 (closes named
  debt A.1)**. One sequential scenario, one seeded flow. `before`/`after` copied
  from `value-coverage-parity.test.js:39-90` (temp `TEST_DB` +
  `DASHBOARD_DB_PATH`, `createApp`/`startServer`, port 0). Deterministic generation
  via `__injectSpawnForTest` / `__injectPoolAssemblerForTest` / `spawnResolvingFirst`
  from `value-summary-tick.test.js` — **do not** set
  `DASHBOARD_FOCUS_INFER_MODE=heuristic` (heuristic never generates, so a drain
  could never converge past `no_progress`). Seed project A with **85 units**
  (`makeUnits(85, …)`, > `MAX_UNITS_PER_PROMPT=40`, forcing 3 batches) and a second
  never-swept passive project B (`lastSweptAt: null`). Open **one real `ws` client**
  to `ws://127.0.0.1:${port}/ws` in `before` (the first spec in this repo to do so)
  and collect every parsed `value_altitudes_updated` frame for project A.
  - Baseline `GET /coverage?project_id=A` → `demand: "passive"`, `complete: false`.
  - `POST /coverage-request {project_id: A}` → `202`, body `coverage.demand !== "passive"`.
  - Immediately read `listSweepTargets(dbModule, …)` → project A sorts **first**,
    ahead of B (rotation jump asserted against the real ordering helper, not
    inferred from timing).
  - Poll `GET /coverage?project_id=A` every 25 ms up to 2 s until `complete === true`;
    **fail loudly on timeout**, never hang.
  - Collected frames non-empty; the **last** frame's `data.coverage`:
    `complete === true`, `pending === 0`, `described === pool_size === 85`,
    `demand === "passive"` (flag clears at true 100%, DEC-8/DEC-4). Assert **at
    least one** intermediate frame has `demand !== "passive"`. (Per reconciliation
    §1: no assertion about `draining` on HTTP responses here.)
  - Deep-equal the last frame's `coverage` against the final poll's `coverage`,
    stripping `computed_at` (reuse `value-coverage-parity.test.js:186`'s `strip()`).
  - **Starvation bound (WATCH-S2-D):** immediately after the poll observes
    `complete: true`, call `runValueSummaryTickOnce(dbModule, {})` for project B and
    assert `result.swept >= 1` (**not** `{skipped: "overlap"}`). Comment that this
    is a **structural proxy** for the wall-clock "two consecutive ticks" bound —
    what it proves is that the shared `running` guard is released the moment the
    drain's single execution ends.
  - Keep every `it()` in default sequential execution — **never** `{ concurrency: true }`.

- **`server/__tests__/project-plans-api.test.js`** — **UPDATE**, **P3 (closes the
  cartographer's PARTIAL on the route-level `draining` branch)**.
  - `it("T8: GET /coverage reports demand 'draining' while a real multi-batch drain is in flight")`
    — inject a spawn whose promise is held open by a manually-resolved deferred, kick
    `runCoverageDrain` (or `POST /coverage-request`), `GET /coverage` while it is
    provably still running (`isDrainingProject(projectId) === true`), assert
    `coverage.demand === "draining"`, then release the deferred and let the drain
    finish. Deterministic by construction — **no polling, no timers.**

### Frontend (`client/src/**/__tests__/`, run by `npm run test:client`)

- **`client/src/components/__tests__/PlanLedgerPanel.test.tsx`** — **UPDATE**,
  **P0 MANDATORY (two cases)**. Both go inside the existing
  `describe("PlanLedgerPanel: Value Pool Slice 2 coverage header (DEC-1, DEC-5, R4)")`
  block, immediately after the R4 out-of-order case (`:1131-1207`).
  - `it("SF-8: switching projectId does not leak the previous project's coverage snapshot under the new project's pool")`
    - Give `mockListMock`/`mockPoolMock`/`mockHealthMock`/`mockCoverageMock` a
      `mockImplementation` keyed on the `projectId` first argument:
      - `"proj-A"` → 1 plan, `makeUnit()`, `makeCoverage({ described: 10, pool_size: 10, pending: 0, complete: true, computed_at: "2026-06-10T12:00:00.000Z" })`
        (**newer** `computed_at` — this is precisely what makes the monotonic merge
        permanently reject B).
      - `"proj-B"` → a different plan/unit, `makeCoverage({ described: 3, pool_size: 20, pending: 17, complete: false, computed_at: "2026-06-01T09:00:00.000Z" })`
        (**older** `computed_at` — B's own honest value).
    - `const { rerender } = render(<PlanLedgerPanel projectId="proj-A" />)`;
      `await waitFor` until the header reads `"10 of 10 described"`.
    - `rerender(<PlanLedgerPanel projectId="proj-B" />)` — same component instance,
      same state, exactly what `ProjectDetail.tsx:1292`'s unkeyed render produces.
    - `await waitFor` → header text contains `"3 of 20 described"`.
    - Header text does **not** contain `"10 of 10 described"`.
    - `document.querySelector('[data-test="coverage-header"]')`'s text contains no
      trace of `pool_size: 10` (belt-and-braces on the same claim).
  - `it("SF-9: a failing GET /coverage degrades gracefully — plans and pool still render, not blanked behind an error banner")`
    - `mockListMock.mockResolvedValue({ plans: [makePlan({ title: "Phase 1: Intake" })] })`,
      `mockPoolMock.mockResolvedValue({ units: [makeUnit()], identityWarnings: [] })`,
      `mockHealthMock.mockResolvedValue(makeHealth())`,
      `mockCoverageMock.mockRejectedValue(new Error("coverage endpoint 500"))`.
    - `await waitFor` → `screen.getByText("Phase 1: Intake")` is in the document.
    - The pool unit renders (`[data-test="pool-unit"]` present — same idiom the
      existing pool cases use).
    - `document.querySelector('[data-test="coverage-header"]')` is **absent** — the
      honest degradation (no snapshot ⇒ no header), never a fabricated one.
    - No full-panel error banner *replacing* content: `screen.getByText("Phase 1: Intake")`
      and `[data-test="pool-unit"]` must both be present **in the same render**,
      regardless of whether a small non-blocking notice is also shown.
    - **Write the "core panel content survived" half as an exported/local reusable
      helper** in this file — e.g. `expectPanelCoreIntact(screen)` asserting plan
      title + pool unit + no content-replacing banner. This is the assertion half of
      the SF-9 durable cure (P1) and the template for every future leg added to that
      `Promise.all`.

- **`client/src/components/__tests__/PlanLedgerPanel.test.tsx`** — **UPDATE**,
  **P3 (closes named debt A.1's UI half + A.4)**. Two new `describe` blocks, using
  the **real** `eventBus` singleton (import style already used at `:1132`/`:1210`);
  only `../lib/api` is mocked.
  - `describe("PlanLedgerPanel: coverage lifecycle, one continuous mount (QA debt A.1)")`
    — mount once cold-start (`pool_size: 5, described: 0, demand: "passive", eta: {state:"none"}`),
    assert the `estimating` copy; `eventBus.publish` a `requested`/`estimating` frame
    → header updates; publish a `draining`/`measured` frame with a real
    `ms_remaining` → the minutes string renders; publish a final
    `complete: true, demand: "passive"` frame → `"N of N described"` renders and the
    "prioritize now" button is gone. **Load-bearing assertion no existing case
    makes:** `mockListMock`/`mockPoolMock`/`mockHealthMock`/`mockCoverageMock` were
    each called **exactly once** across the whole sequence, and
    `[data-test="coverage-header"]` never disappeared — i.e. every update came from
    the WS handler, never a refetch or remount. Also sweep the rendered header for
    unresolved i18n keys (`/planLedger\.[a-zA-Z]/`) **after each publish**, not just
    at the end (extends the existing sweep at `:613`/`:873`).
  - `describe("PlanLedgerPanel: WS subscriber lifecycle edges (debt A.4, WATCH-S2-B)")`
    - **Reconnect:** mount, take one update, `eventBus.setConnected(false)` then
      `(true)`, publish another update → it still renders, and the header equals the
      **last** message's value exactly (a duplicated subscription would show a
      doubled/stale composite or throw). Do **not** assert missed messages are
      replayed — `eventBus` explicitly does not buffer, and the panel never calls
      `eventBus.onConnection`; that gap is disclosed product behavior.
    - **Stale-tab merge (fetch-after-WS race):** make `mockCoverageMock` return a
      manually-resolved promise; publish a newer-`computed_at` WS frame *first*, then
      resolve the fetch with older values → the WS values win. This exercises
      `mergeCoverage` from the **initial-fetch** call site (`PlanLedgerPanel.tsx:705`),
      which R4 (WS→WS only) never reaches. Use a manual deferred, **not** `setTimeout`.
    - **Two tabs, same project:** two `render()`s of `projectId="proj-1"` into separate
      containers; one publish → both trees update.
    - **Two tabs, different projects:** one `proj-1` mount, one `proj-2` mount; publish
      for `proj-1` → the `proj-2` instance's header is unchanged.
    - **WATCH-S2-B negative half:** two units A and B fetched once; publish
      `unit_keys: ["A"]` → `mockAltitudesMock` is called again and its argument set
      contains A's id but **not** B's (the assertion the existing case at `:1209`
      does not make).

- **`client/src/pages/__tests__/ProjectDetail.test.tsx`** — **UPDATE**, **P2 hygiene
  (behavioral anchor; must land BEFORE any snapshot baseline)**.
  - `it("renders the coverage header and 'prioritize now' control when the pool is in-progress")`,
    placed after `"renders the PlanLedgerPanel card beside existing cards (F2)"` (`:794+`).
    Override `projectPlansCoverageMock.mockResolvedValue({ coverage: { project_id: "proj-1", described: 4, pool_size: 10, pending: 6, complete: false, demand: "passive", requested_at: null, eta: { state: "estimating" }, computed_at: "2026-06-10T13:00:00.000Z" } })`
    and `projectPlansPoolMock.mockResolvedValue({ units: [<one real unit>], identityWarnings: [] })`
    (needed for the header's own `coverage.pool_size > 0` render gate). Assert
    `[data-test="coverage-header"]` is present and contains `"4 of 10 described"`
    plus the `estimating` copy (**use the exact same i18n string the
    `PlanLedgerPanel.test.tsx` cold-start case asserts** — do not invent a second
    phrasing), and `[data-test="prioritize-now-button"]` is present.

- **`client/src/pages/__tests__/screens.snapshot.test.tsx`** — **UPDATE**, **P2
  hygiene**. Two changes, in this order:
  1. **Fix the shared mock first:** add `coverage` and `requestCoverage` to the
     shared `vi.mock("../../lib/api", …)` `api.projectPlans` object. It currently
     lists only `list`/`pool`/`health`/`claim`/`close`, so any page that mounts the
     panel would throw `TypeError: … is not a function` straight into SF-9's shared
     `catch`. This is the convention the cartographer documented: **any new API
     method a page calls must be added to this shared mock.**
  2. Add one **additive** case after the existing `it("Project detail", …)`:
     `it("Project detail (coverage in progress)")` — `mockResolvedValueOnce` a real
     matching project on `api.projects.list` (so `ProjectDetail` does *not* take its
     not-found branch), one pool unit, and the same in-progress coverage shape as the
     `ProjectDetail.test.tsx` case above; then `await snapshot(...)` at
     `/projects/proj-1`. This creates a **new** `.snap` entry
     (`Project detail (coverage in progress) 1`) and does **not** touch the existing
     "Project detail" entry.

### Fixtures / test data

**None new — reuse existing, in every case.**
- Server: `project-plans-api.test.js`'s `makeProject`/`fetch`/`post` helpers;
  `value-summary-tick.test.js`'s `makeSweptProject`, `makeUnits`,
  `__injectPoolAssemblerForTest`, `__injectSpawnForTest`, `spawnResolvingFirst`, and
  the `stmts.upsertValueUnitSummary.run(...)` cache-seed idiom (`:1338-1385`);
  `value-coverage.test.js`'s `freshProjectId`, `seedGenerationRow`, `counts()`;
  `value-coverage-parity.test.js`'s `before`/`after` server-boot block (`:39-90`) and
  `strip()` (`:186`).
- Client: `PlanLedgerPanel.test.tsx`'s `makePlan`/`makeItem`/`makeUnit`/`makeHealth`/
  `makeCoverage` factories and its existing `mock*Mock` handles;
  `ProjectDetail.test.tsx`'s `mockProject`/`renderPage` and its already-wired
  `projectPlansCoverageMock`/`projectPlansRequestCoverageMock`.

---

## Implementation steps

Strictly ordered. Steps 1–4 are the gate; do not start step 5 until step 4 is
green. Each new test must be **observed red before the fix and green after** —
record the actual failure output; do not infer it.

### P0 — MANDATORY (the three live defects)

1. **SF-9 first (cheapest, one-line fix, and it unblocks the client suite's other
   work).** Write `it("SF-9: a failing GET /coverage degrades gracefully …")` in
   `PlanLedgerPanel.test.tsx`, including the `expectPanelCoreIntact` helper.
   - **RED before:** the rejected coverage leg rejects the whole `Promise.all`;
     `setPlans`/`setUnits`/`setHealth` are never called;
     `screen.getByText("Phase 1: Intake")` never resolves and the panel shows only
     `error.message` in the banner.
   - **Fix:** in `PlanLedgerPanel.tsx:696-701`, isolate that one leg —
     `api.projectPlans.coverage(projectId).catch(() => ({ coverage: null }))`.
     Change nothing else in `load()`; `list`/`pool`/`health` stay blocking (they are
     core content, not enhancement).
   - **GREEN after:** plan + pool render; `[data-test="coverage-header"]` absent.

2. **SF-8 second (Critical, most user-visible).** Write
   `it("SF-8: switching projectId does not leak …")`.
   - **RED before:** project A's `computed_at` (`2026-06-10`) is later than B's
     (`2026-06-01`), so `mergeCoverage`'s `next.computed_at > prev.computed_at` check
     rejects B's snapshot outright and the header keeps rendering
     `"10 of 10 described"` under project B's mount.
   - **Fix:** add an explicit reset in `PlanLedgerPanel.tsx`:
     `useEffect(() => { setCoverage(null); }, [projectId]);`
     **Prefer this over keying the panel in `ProjectDetail.tsx`** — keying throws
     away the fetch cache and, more importantly, does not stop the *next* state field
     this component gains from inheriting the same bug. A `project_id`-aware
     `mergeCoverage` (always accept a `next` whose `project_id` differs from the held
     snapshot) is an acceptable alternative or belt-and-braces addition; do **both**
     only if the second is free.
   - **Scope note (do not widen):** `altitudes` and `requestedAltitudesRef` are also
     instance-shared across a project switch, but they are keyed by unit id and are
     re-fetched for the new project's units, so they do not produce a *visible*
     cross-project value. Leave them alone in this change set and record the question
     as a line in the QA decision log (step 10) rather than expanding the diff.
   - **GREEN after:** header reads `"3 of 20 described"`, no trace of A.

3. **SF-6 third (server).** Write both cases of
   `describe("SF-6: shouldBroadcastCoverage on a project's FIRST observation …")`.
   - **RED before:** with `lastBroadcastState` empty,
     `shouldBroadcastCoverage(pid, 0, "passive", true)` computes
     `transitioned = !!undefined && (…) === false` and `generated > 0` is false, so it
     returns `false`; `broadcasts.length` is `0`, not `1`.
   - **Fix (`server/lib/value-summary-tick.js:190-195`):** treat an absent prior as a
     transition **when `complete === true`** — i.e.
     `const transitioned = prior ? (prior.demand !== demand || prior.complete !== complete) : complete === true;`
     Do **not** broadcast unconditionally on an absent prior (that fails case 2 and
     makes every cold-start passive sweep noisy).
   - **Also mandatory in the same step — correct the two false comments.** The
     module-scope comment at `:111-118` ("it can only ever SUPPRESS one redundant
     early broadcast, never fabricate a false one") and the JSDoc at `:180-183` ("A
     project with no prior recorded broadcast is treated as 'unchanged' (never
     fabricates a transition out of nothing)") are both checkable claims that become
     false with this fix and were already misleading before it. Rewrite them to state
     the real rule: *a first observation broadcasts iff the pool is already complete;
     otherwise `generated > 0` alone governs it.* (§9.1's standing check: when a
     cure's header says "cannot," find the loop that proves it or downgrade the
     comment.)
   - **GREEN after:** case 1 → exactly one broadcast with `coverage.complete === true`;
     case 2 → zero broadcasts.
   - **Regression watch:** run the full `npm run test:server` immediately after this
     fix. If any pre-existing broadcast-count assertion flips, adjudicate it
     individually — the correct expectation is *one* broadcast per
     newly-observed-complete project per process, and no repeats on subsequent ticks
     (the map is written on every call). **Do not** relax a pre-existing assertion to
     make the suite pass without recording why.

4. **Run both full suites.** `npm run test:server` and `npm run test:client` must be
   green, at or above the 1784 / 817 baseline plus the new cases. This is the gate:
   once green, the change is safe to push to `origin`.

### P1 — durable cure (rides the same change set; strategist items 4–6)

5. **N2 exact-exemption** — add the case to `value-coverage.test.js`.
   **Red-first proof (do this, don't skip it):** temporarily add a 4th member to
   `DEMAND_STATES` in `server/lib/value-coverage.js` (e.g. `"stalled"`) with no
   `STATE_TO_LOCALE_KEY` entry and no locale key anywhere. Confirm the **existing**
   four per-locale cases stay green (that is N2, demonstrated) and the **new** case
   goes red (`["passive","stalled"]` ≠ `["passive"]`). Revert the registry edit.
6. **SF-4 composition-parity guard** — add T7 to `project-plans-api.test.js`.
   **Red-first proof:** (a) revert one route's `draining: isDrainingProject(projectId),`
   to a hardcoded `draining: false,` → the literal-substring assertion goes red;
   (b) add a 6th key (e.g. `demand: "requested",`) to only one route's
   `coverageSnapshot(...)` argument → the key-set `deepEqual` goes red. Revert both.
7. **SF-9 helper generalization** — confirm `expectPanelCoreIntact` from step 1 is
   written so a future leg added to the same `Promise.all` can reuse it verbatim
   (takes no coverage-specific argument; asserts core content presence only).

### P2 — hygiene / false-confidence removal

8. **SF-7 smoke-suite replacement** in `coverage-smoke.test.js`, exactly as specified
   above. **Red-first bar for this item is a mutation, not a pre-existing bug:** flip
   `requestValueCoverage`'s SQL to a no-op (`SELECT 1`) and confirm the **new**
   round-trip case catches it where the old existence check did not. Revert.
9. **screens-snapshot debt, in this order — mock, then anchor, then baseline.**
   (a) Add `coverage`/`requestCoverage` to `screens.snapshot.test.tsx`'s shared API
   mock. (b) Add the `ProjectDetail.test.tsx` behavioral anchor case; prove it pins
   what it claims by temporarily changing `PlanLedgerPanel.tsx`'s render gate from
   `coverage.pool_size > 0` to `> 100` (or deleting the "prioritize now" JSX) and
   confirming it goes red; revert. (c) Only then add the additive snapshot case and
   generate its baseline with
   `cd client && npx vitest run -u -t "Project detail (coverage in progress)"`, then
   **read the generated `.snap` entry** and confirm it contains the coverage-header
   text and the "prioritize now" markup before committing. **Never** a blanket
   `npx vitest run -u` — that silently accepts drift across the other ~20 screens.
   A baseline over a "Project not found" empty state is worse than no baseline; the
   mount fix (a) is what makes the baseline mean anything.
10. **Write the QA decision-log rows** in
    `requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/qa/decisions.md`
    (create it, or append to this intake's existing QA addendum), dated 2026-08-05.
    Three rows are required because the risk analyst flagged them as untracked
    anywhere, plus one from step 2:
    - **Trap 7** — the tick's disclaimed-but-still-present internal `pending`
      computation could silently start feeding the wire again; nothing asserts the
      wire's `pending` is *sourced from* `coverageSnapshot` rather than merely equal
      to it. Promotion trigger: *"any future edit to the WS broadcast payload
      assembly in `value-summary-tick.js`."*
    - **STRICTMODE-BLIND residual** — BL-2 fixed one effect; the WS-subscriber effect
      and the coverage-fetch effect are unexamined for the same class, and SF-8/SF-9
      live in exactly those bodies. Record either the extension or the declination.
    - **The two deferred durable cures** (see next section) with their triggers.
    - **SF-8 scope note** — `altitudes`/`requestedAltitudesRef` deliberately not reset.

### P3 — nice-to-have / named-debt closure (do only if the P0–P2 set is green and time allows)

11. **`server/__tests__/coverage-request-e2e.test.js`** (debt A.1) — as specified.
    Red-first: this is a *new-flow* proof, not a defect reproduction; prove it bites
    by temporarily removing the `coverage_requested_at` leading term from
    `listValueSweepTargets`'s `ORDER BY` and confirming the rotation-jump assertion
    goes red. Revert.
12. **T8 route-level `draining`** in `project-plans-api.test.js` — closes the
    cartographer's PARTIAL. Deterministic deferred-spawn design only; if it cannot be
    made deterministic in under ~30 minutes, **skip it and record the reason** rather
    than shipping a polled, timing-dependent case.
13. **Client WS lifecycle-edge `describe` blocks** (debt A.1's UI half + A.4) — as
    specified. Each of these should pass on first write; if one goes red, stop — you
    have found a new defect, and it needs its own decision row before you "fix the
    test."
14. **N1 characterization** in `value-coverage.test.js`'s
    `describe("estimateEta state branches (G1a)")`, after the K=5 case (`:250-262`):
    seed `{durationMs: 6000, generated: 2, daysAgo: 0}` and
    `{durationMs: 6000, generated: 40, daysAgo: 1}`, `estimateEta(dbModule, {projectId, pending: 40})`,
    `assert.equal(eta.per_batch_ms, 6000)`. **Green today by design** — its red event
    is deliberately in the future. Comment: *"if this test needs to change because
    `estimateEta` starts normalizing by `generated`, that is WATCH-S2-C's trigger
    firing — update `decisions.md` in the same commit, don't just fix the number."*
    A red run of this specific case is a trigger, not a bug.

---

## Single-source-of-truth guardrail

This project has three canonical registries/single-homes driving multiple rendered
outputs, and **every new assertion below must read from the artifact, never from a
hand-copy**:

- **`coverageSnapshot`/`estimateEta` (`server/lib/value-coverage.js`) is the only
  place `described`/`pool_size`/`pending`/`complete`/`demand`/`eta` is computed.**
  No test added here may recompute any of those values client-side or test-side and
  compare its own arithmetic — that is exactly the BL-1 shape (`if (artifact) {…}
  else {self-computed fallback}`) this build already paid for once.
  `PlanLedgerPanel` renders the server's numbers verbatim; the client tests assert
  **rendered text against the fixture snapshot**, never a derived total.
  `coverage-request-e2e.test.js` step 6 deep-equals the real WS frame against the
  real HTTP response (minus `computed_at`) — it does not assemble an expected object.
- **`DEMAND_STATES` / `ETA_STATES` are closed, exported, server-authored registries.**
  N2's assertion (step 5) is what makes them behave like one: the locale-key map must
  cover the **derived** registry minus a **named, dated exemption set**, and growth
  must break the test at the point of growth. Do not "fix" a future failure by adding
  the new member to `STATE_TO_LOCALE_KEY` silently — add the locale key in all four
  files, then update the exemption assertion, in the same commit.
- **`assembleValuePool` is the sole pool composer (DEC-16), and both route handlers
  must compose from it identically.** T7 (step 6) asserts exactly that, structurally.
  If a future refactor extracts `buildProbeCoverage`, T7's "identical building
  blocks" shape becomes trivially true by construction and should be **replaced**
  (not kept alongside) by a call-site-count assertion on `buildProbeCoverage` — noted
  in the test's own comment.
- **Four locale files move together.** Any new `planLedger.pool.coverage.*` key goes
  into all four `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` in the same
  commit; `i18n.test.ts`'s E1.1 whole-namespace scan is the mechanical enforcement.
  This plan adds no new locale keys — but the lifecycle-edge test's per-publish
  `/planLedger\.[a-zA-Z]/` DOM sweep exists so an unresolved key can never render.

---

## Durable-cure decision

**Take three structural cures now; defer four, each with a dated row and a named
trigger. This is the strategist's recommendation, adopted.**

**Adopted now (P1, rides this change set — all three are one-liners in files
already being opened):**
1. **N2's exact-exemption assertion** — closes §9.7's shape at the locale layer
   **before** Slice 3 grows either registry, rather than at the moment it bites.
2. **SF-4's composition-parity structural guard (T7)** — fails on the *next*
   divergence instead of waiting for Slice 3's third copy. This is the "name the
   file/spec and it gets written" cure this project has already proven twice
   (`ledger-metrics-parity.test.js`, `value-coverage-parity.test.js`), applied to the
   route↔route seam that fits none of the three existing files and is therefore
   nobody's — which is precisely why it has no guard today.
3. **SF-9's reusable `expectPanelCoreIntact` helper** — the assertion half of
   per-leg failure isolation. Nearly free, and it is the gap with the clearest
   "next field repeats this" trajectory.

**Deferred, with consequence and trigger (each needs a row per step 10):**
- **`useEntityScopedState(projectId, initial)` hook / lint-or-structural guard for
  the SF-8 class.** *Consequence of deferring:* SF-8's point fix protects `coverage`
  only; the next state field `PlanLedgerPanel` (or any entity-id-prop component)
  gains inherits the same leak, and no test in this repo mounts a component, changes
  its entity prop, and asserts the state followed. *Cheapest interim step, do it
  now regardless:* record the **standing test convention** — "any component test file
  for a component taking an entity-id prop must include one 'switch the id, assert the
  state followed' case" — alongside the shared-mock rule, so it is a documented
  convention rather than one clever test. *Trigger:* the next component that takes an
  entity-id prop and holds entity-scoped state.
- **Per-leg failure-disposition refactor of the panel's multi-fetch** (each leg
  carrying `required` vs `enhancement`). *Consequence:* a future field can still be
  joined into the blocking set by accident; only the reusable assertion, not the
  structure, prevents it. *Trigger:* the next fetch added to `PlanLedgerPanel`'s
  `load()`.
- **Deriving `assertSingleHome`'s consumer axis from the artifact** (grep
  `server/lib` + `server/routes` for the module's import specifier; fail on any
  importer with no disposition, exactly as `FILE_DISPOSITIONS` already does).
  *Consequence:* §9.7's cure stays half-built for a third consecutive build; a fourth
  consumer (Slice 3, `ccam`, MCP) is invisible to the guard by construction. *Trigger:*
  Slice 3's first new consumer of `value-summary.js` or `value-coverage.js`.
- **Wrapping the shared RTL render helper in `<StrictMode>`** (STRICTMODE-BLIND's
  cheapest cure). *Consequence:* the double-invoke class stays structurally invisible
  across the client suite. *Explicitly not a gate for this change* — expect a
  first-run red set, and a parity check that goes red for legitimate reasons on day
  one gets weakened rather than fixed. Do it as its own deliberate slice with triage
  budget.

**Not deferred, not adopted — genuinely no action:** N1 (accepted under WATCH-S2-C;
the optional characterization test in step 14 is free insurance, not a cure) and
SF-10.2 (pre-existing, dispositioned, out of this change set — do not reopen it,
and note the plan's literal `grep "assert.ok(true" server/__tests__/` gate will
still return exactly **1** because of it; that is expected, not a failure).

---

## How to run

`PROJECT-CONTEXT.md` names no bespoke test commands; these are `CLAUDE.md`'s and the
`package.json` scripts, confirmed by the cartographer's baseline run.

| Layer | Command | Baseline at `4c2e931` |
|---|---|---|
| Server (unit + integration, one bucket) | `npm run test:server` | 1784 / 1784, 443 suites, ~58 s |
| Client (component + i18n + screen snapshots) | `npm run test:client` | 817 / 817, 61 files, ~7 s |
| Client typecheck | `cd client && npx tsc --noEmit` | clean (not re-run this QA pass) |
| File-header audit | `bash .claude/skills/file-headers/scripts/check-headers.sh` | must exit 0 |

Single-spec iteration:

```bash
# Server
node --test server/__tests__/value-summary-tick.test.js
node --test server/__tests__/value-coverage.test.js
node --test server/__tests__/project-plans-api.test.js
node --test server/__tests__/coverage-smoke.test.js
node --test server/__tests__/coverage-request-e2e.test.js      # P3, new file

# Client
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx
cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx

# Client, just the new blocks, while iterating
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "SF-8"
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "SF-9"
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "coverage lifecycle"
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "WS subscriber lifecycle edges"

# Snapshot baseline — SCOPED, reviewed, never a blanket -u
cd client && npx vitest run -u -t "Project detail (coverage in progress)"
```

Sweep discipline before declaring done (per `technical-plan.md` §6):

```bash
grep -rn "assert.ok(true" server/__tests__/   # expect exactly 1 (SF-10.2, pre-existing)
grep -rn "|| true" server/__tests__/          # expect 0
```

No external stack, Docker, base URL, or seeded shared DB is required — every server
spec boots its own throwaway SQLite file and an ephemeral HTTP+WS server on port 0.

---

## Definition of Done

A build-verifier can check every line below mechanically.

**Gate (P0 — required before pushing to `origin` and before Slice 3):**
- [ ] `PlanLedgerPanel.test.tsx` contains `it("SF-9: a failing GET /coverage degrades gracefully …")`, and the transcript records it **RED** against unfixed `PlanLedgerPanel.tsx` and **GREEN** after the `.catch(() => ({ coverage: null }))` isolation.
- [ ] `PlanLedgerPanel.test.tsx` contains `it("SF-8: switching projectId does not leak …")`, recorded **RED** before and **GREEN** after `useEffect(() => setCoverage(null), [projectId])`.
- [ ] `value-summary-tick.test.js` contains both SF-6 cases; case 1 recorded **RED** before and **GREEN** after the `shouldBroadcastCoverage` fix; case 2 **GREEN both before and after** (it bounds the fix).
- [ ] `server/lib/value-summary-tick.js`'s comments at `:111-118` and `:180-183` no longer claim the function "can only ever SUPPRESS, never fabricate" / "never fabricates a transition out of nothing" — they state the real first-observation rule.
- [ ] `npm run test:server` green, **≥ 1786** passing (1784 baseline + 2 SF-6 cases), 0 failed/skipped.
- [ ] `npm run test:client` green, **≥ 819** passing (817 baseline + 2 P0 cases), 0 failed.
- [ ] No pre-existing assertion was weakened or deleted to make the suites pass. Any pre-existing broadcast-count assertion that changed has a one-line written justification.

**Durable cure (P1):**
- [ ] `value-coverage.test.js` contains the N2 exact-exemption case with `assert.deepEqual(exemptDemand, ["passive"])` and `assert.deepEqual(exemptEta, ["none"])`; its mutation red-proof (a 4th `DEMAND_STATES` member) was observed and reverted.
- [ ] `project-plans-api.test.js` contains T7 with both the three literal-substring assertions and the `coverageSnapshot` key-set `deepEqual`; both mutation red-proofs (`draining: false` hardcode; 6th key in one route) were observed and reverted.
- [ ] The SF-9 assertion is factored as a reusable helper taking no coverage-specific argument.

**Hygiene (P2):**
- [ ] `coverage-smoke.test.js` contains **zero** `assert.ok(<statementObject>)`-style existence-only cases; the deleted cases are replaced by pointer comments naming the real proofs; the new `requestValueCoverage` round-trip case was observed red under a `SELECT 1` no-op mutation.
- [ ] `screens.snapshot.test.tsx`'s shared `api.projectPlans` mock includes `coverage` **and** `requestCoverage`.
- [ ] `ProjectDetail.test.tsx` contains the in-progress coverage-header case, observed red under a `pool_size > 100` render-gate mutation (reverted).
- [ ] The new `.snap` entry `Project detail (coverage in progress) 1` exists, was generated with a **scoped** `-u -t` run, was read before committing, and contains the coverage-header text and the "prioritize now" markup. The pre-existing "Project detail" entry is byte-unchanged.
- [ ] `requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/qa/decisions.md` contains dated rows for: trap 7 (wire `pending` sourcing), the STRICTMODE-BLIND residual scope, the four deferred durable cures with their triggers, and the SF-8 `altitudes`/`requestedAltitudesRef` scope note.

**Single-source-of-truth / registry sync:**
- [ ] No new test recomputes `described`/`pending`/`complete`/`demand`/`eta` test-side and compares it to the server's value — every assertion compares rendered/transported values against the fixture or against the other delivery path.
- [ ] No `if (artifact) { … } else { self-computed fallback }` shape exists in any test added or edited by this change set (§9.3 "the guard is the vacuity" — grep for it before declaring done).
- [ ] `grep -rn "assert.ok(true" server/__tests__/` returns exactly **1** (SF-10.2, pre-existing, out of scope); `grep -rn "|| true" server/__tests__/` returns **0**.
- [ ] No locale key was added or removed (this change set adds none); if that changes, all four `{en,ko,vi,zh}/projectDetail.json` moved in the same commit.

**Project policy:**
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0 (any new `.js`/`.tsx` file — i.e. `coverage-request-e2e.test.js` — carries the header with the exact `@author Son Nguyen <hoangson091104@gmail.com>` line).
- [ ] `cd client && npx tsc --noEmit` clean.
- [ ] Docs updated if any behavior changed: the SF-6 broadcast-trigger rule is a **wire-behavior change** — check `docs/API.md` / `ARCHITECTURE.md` / `server/README.md` for any statement of the old `generated > 0`-or-transition rule and update it in the same change set (`update-project-docs`).
- [ ] **AC-6 remains unmet and is untouched by this plan** — it is a scheduling gate on Slice 3 (DEC-2), not a test gap. Confirm no one "closed" it by adding a test; no test can prove a calibration ran.

**P3 (optional — mark each done or explicitly skipped with a reason):**
- [ ] `coverage-request-e2e.test.js` added, rotation-jump assertion mutation-proven, poll fails loudly on timeout, no `{ concurrency: true }`, and **no assertion that `draining` is always false on HTTP** (that premise is stale — see reconciliation §1).
- [ ] T8 (route-level `draining` under a real in-flight drain), deterministic-deferred design only.
- [ ] The two client WS lifecycle-edge `describe` blocks.
- [ ] N1 characterization case with its WATCH-S2-C trigger comment.
