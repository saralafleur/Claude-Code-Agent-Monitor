# QA Decision Log — coverage-on-demand QA-fix (Value Pool Slice 2 QA debt closure)

**Build:** `2026-08-05-coverage-on-demand-qa-fix`
**Source:** `qa/test-plan.md` §"Implementation steps" step 10 and the
durable-cure decision section; required Definition-of-Done deliverable, not
optional documentation (test-plan §"Definition of Done", hygiene block).
**All rows below dated 2026-08-05.**

Conventions inherited from the sibling intake's decision logs: each row
states the risk, why it is not fixed in this change set, and the trigger (or
consequence) that reopens it. Rows are grouped per the test-plan's own four
required categories.

---

## 1. Trap 7 — wire `pending` sourcing (risk disclosure row)

| Field | Value |
|---|---|
| Id | Trap 7 |
| Date | 2026-08-05 |
| Risk | Internal `pending` computation in `value-summary-tick.js`'s `sweepOneProject` (the `pending_after_sweep` bookkeeping column) could silently start feeding the wire again — the file's own header comment disclaims this ("never `described`, never `complete`, never `demand`, never an ETA... that internal value is NOT what either wire carries"), but no test asserts it. |
| Gap | No test asserts the wire's `pending` (HTTP response / WS broadcast payload) is *sourced from* `coverageSnapshot`'s own computation, as opposed to merely happening to be numerically equal to it today. |
| Trigger | Any future edit to the WS broadcast payload assembly in `value-summary-tick.js`. Re-verify both `coverage` and `pending` round-trip from `coverageSnapshot`, not from the sweep's own bookkeeping field, through the broadcast. |

---

## 2. STRICTMODE-BLIND residual scope (risk disclosure row)

| Field | Value |
|---|---|
| Id | STRICTMODE-BLIND residual |
| Date | 2026-08-05 |
| Risk | BL-2 (prior Slice 2 build) fixed one effect's StrictMode double-invoke hazard (`mountedRef`'s re-arm-on-every-setup fix). The WS-subscriber effect and the coverage-fetch `load()` effect in `PlanLedgerPanel.tsx` are unexamined for the same class of hazard. |
| Why it matters now | SF-8's fix (`useEffect(() => setCoverage(null), [projectId])`) and SF-9's fix (per-leg `.catch` in `load()`) both live in exactly those effect bodies — a StrictMode double-invoke of either effect is untested territory this build did not open. |
| Decision | **Declined for this build** — not a gate. Extending StrictMode coverage to these effects is deferred to its own slice with its own triage budget (see item 3d below for the durable-cure framing). |
| Trigger | Decision to wrap the shared RTL render helper in `<StrictMode>` (Slice 3 or later). |

---

## 3. Four deferred durable cures (architectural decisions, with triggers)

### 3a. Entity-scoped state isolation (MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH durable cure)

| Field | Value |
|---|---|
| Date | 2026-08-05 |
| Risk | `PlanLedgerPanel`'s `coverage` state is now reset on `projectId` change (SF-8 fix), but the fix protects `coverage` only — the *next* entity-scoped state field this component (or any component taking an entity-id prop) gains will inherit the same leak unless it gets its own explicit reset. |
| Gap | No structural guard (hook, lint rule, or standing test convention enforcement) prevents the next field from being added without a reset. |
| Consequence | The next state field added to `PlanLedgerPanel` (or a similar entity-id-prop component) will silently leak across an entity switch, exactly as `coverage` did before SF-8. |
| Interim mitigation (adopted now, cheap) | Standing test convention, recorded here as the source of truth until a structural guard exists: **"any component test file for a component taking an entity-id prop must include one 'switch the id, assert the state followed' case."** |
| Trigger | The next component (or the next state field on `PlanLedgerPanel`) that takes an entity-id prop and holds entity-scoped state. |
| Recommended extract | `useEntityScopedState(projectId, initial)` hook + a lint rule that flags a bare `useState` alongside an entity-id prop with no matching reset effect. |

### 3b. Per-leg failure-disposition refactor (SF-9 per-leg enhancement pattern)

| Field | Value |
|---|---|
| Date | 2026-08-05 |
| Risk | SF-9's fix adds a per-leg `.catch(() => ({ coverage: null }))` to the `coverage` fetch only, inside `load()`'s `Promise.all`. The reusable `expectPanelCoreIntact` helper (assertion-side durable cure) exists, but the *production* structure remains flat — nothing prevents a future field from being joined into the blocking set by accident. |
| Gap | No `required` vs. `enhancement` classification exists in `load()`'s own structure; only convention (a code-review habit) currently keeps the next fetch isolated. |
| Consequence | The next fetch added to `PlanLedgerPanel.load()`'s `Promise.all` can be added without its own `.catch`, quietly reintroducing SF-9's shape for that new field. |
| Trigger | The next field/fetch added to `PlanLedgerPanel.load()`. |
| Recommended structure | Extract each leg's `required`/`enhancement` classification explicitly (e.g. an array of `{ fetch, isRequired }` entries reduced into the blocking vs. isolated groups), so a reviewer sees the classification instead of having to infer it from the presence/absence of a `.catch`. |

### 3c. Deriving `assertSingleHome`'s consumer axis from the artifact (§9.7 hand-scoped structural scan durable cure)

| Field | Value |
|---|---|
| Date | 2026-08-05 |
| Risk | T7's structural composition-parity guard (route↔route seam) was added this build, but its own scope (which two route handlers to compare) is still hand-typed into the test, the same shape §9.1's history already shows going invisible-then-found-in-review for other consumer axes. |
| Gap | No mechanism greps `server/lib` + `server/routes` for the module's actual import specifier and fails on any importer with no disposition (the way `FILE_DISPOSITIONS` already does for a different axis in this project). |
| Consequence | Slice 3's third consumer of `value-summary.js`/`value-coverage.js` (e.g. `ccam`, MCP) will be invisible to this guard by construction — it will not fail, it will simply never be checked. |
| Trigger | Slice 3's first new consumer of `value-summary.js` or `value-coverage.js`. |
| Recommended | Derive the consumer axis from a grep of the import specifier across `server/lib` + `server/routes`, and fail the test on any importer with no explicit disposition entry, mirroring `FILE_DISPOSITIONS`'s existing pattern. |

### 3d. Wrapping the shared RTL render helper in `<StrictMode>` (STRICTMODE-BLIND durable cure)

| Field | Value |
|---|---|
| Date | 2026-08-05 |
| Risk | The client effect double-invoke class (StrictMode's setup→cleanup→setup) stays structurally invisible across the whole client suite, not just `PlanLedgerPanel`. SF-8 and SF-9 both live in effect bodies that are unexamined for this class (see item 2 above). |
| Expectation if adopted | A first-run red set on day one is expected and correct, not a regression — legitimate render-parity issues surfaced by the wrap must be re-fixed, not weakened to make the wrap "pass." |
| Decision | **Explicitly not a gate for this build.** Deferred as its own deliberate slice with its own triage budget — this build's P0-P2 scope does not include it. |
| Trigger | The decision to wrap the shared RTL mock/render helper in `<StrictMode>`. |

---

## 4. SF-8 altitudes scope note (documentation, not an action row)

| Field | Value |
|---|---|
| Date | 2026-08-05 |
| Note | `altitudes` and `requestedAltitudesRef` in `PlanLedgerPanel.tsx` are also instance-shared state across a `projectId` switch (same unkeyed-remount shape SF-8 fixed for `coverage`), but they are keyed by unit id and are re-fetched for the new project's own units on every pool change — so they do not produce a *visible* cross-project value the way `coverage`'s monotonic merge did. |
| Decision | Not fixed in this build; deliberately left alone per test-plan step 2's scope note ("do not widen"), recorded here for completeness rather than expanding the SF-8 diff. |
| Action | No action. Revisit only if the re-fetch semantics change (e.g. altitudes stop being re-fetched per-unit on every pool change, or start being cached across a `projectId` switch). |

---

## 5. P3 disposition (§9.4 FIX-ROUND-REGRESSION — every deferred item must be dated and reasoned, not silently dropped)

P3 was explicitly time-boxed and optional per the build task list and
test-plan. Given the volume and severity of P0/P1/P2 findings surfaced during
this build (see §6 below — two independently-verified test-authoring gaps
requiring orchestrator disposition), P3 was not attempted in this pass.

| Item | Date | Reason skipped |
|---|---|---|
| `coverage-request-e2e.test.js` (Task 20, debt A.1) | 2026-08-05 | Time constraint — P0/P1/P2 (including two blocking test-authoring findings requiring investigation and write-up, see §6) consumed the available budget. Not attempted; no red-first proof was run. |
| T8 route-level `draining` under real in-flight drain (Task 21) | 2026-08-05 | Time constraint, same as above. Not attempted. |
| PlanLedgerPanel WS lifecycle-edge `describe` blocks (Task 22) | 2026-08-05 | Time constraint, same as above. Not attempted. |
| N1 characterization test (Task 23, WATCH-S2-C) | 2026-08-05 | Time constraint, same as above. Not attempted. Not a live defect — accepted under WATCH-S2-C per test-plan; this row exists only to satisfy the disposition obligation, not because anything is broken. |

---

## 6. Findings surfaced during QA pass (dated resolution table)

### 6.1 B2 — T7 (SF-4) anchoring key-set assertion gap (RESOLVED)

| Finding | T7's matched-pair-drift guard was proven incomplete: only the parity check (`assert.deepEqual(postKeys, getKeys)`) shipped; the required anchoring assertion (`assert.deepEqual(postKeys, ["computedAt", "counts", "draining", "projectId", "requestedAt"])`) was absent, allowing identical mutations to both routes to pass silently. |
| Status | **FIXED** — 2026-08-06 |
| Fix | Added the mandated anchoring assertion after the parity check in `server/__tests__/project-plans-api.test.js` (T7 test case). Verified with matched-pair mutation: both mutations (add 6th key to both routes; delete `requestedAt` from both routes) now correctly fail the guard. |
| Verified | Both mutations applied and confirmed red, then reverted to byte-identical baseline. |

### 6.2 S2 — Empty-pool broadcast on first observation (PINNED)

| Finding | SF-6's fix widens the broadcast rule: an empty pool (where `complete = pending === 0` is trivially true) now broadcasts on first observation. This was reachable, untested, and undocumented. |
| Status | **DOCUMENTED AND PINNED** — 2026-08-06 |
| Action | Added explicit test case `"S2: an empty-pool project emits a terminal broadcast on its first observation"` in `server/__tests__/value-summary-tick.test.js` to pin this behavior as intentional rather than accidental. |
| Note | No product-code change needed; behavior is as-designed. The test documents this as a deliberate side effect of the fix (complete === true trivially for zero-unit pools). |

### 6.3 S3 — Demand transition without complete change (PINNED)

| Finding | The `prior.demand !== demand` arm of `shouldBroadcastCoverage` was unguarded — no test case exercised a demand transition (e.g. passive → requested) when `complete` did not change. |
| Status | **DOCUMENTED AND PINNED** — 2026-08-06 |
| Action | Added explicit test case `"S3: a demand transition (without complete change) still broadcasts even when generated===0"` in `server/__tests__/value-summary-tick.test.js` (Broadcast widening describe block). Test exercises passive → requested demand transition with no change in complete, verifying broadcast fires due to demand change alone. |
| Verified | With test in place, deleting the `prior.demand !== demand` arm from `shouldBroadcastCoverage` causes this test to fail. Arm restored, test passes. |

### 6.4 SF-6 case 2 fixture bug (RESOLVED — this row was stale; corrected 2026-08-06 by `build-lead`)

| Finding (as originally written) | SF-6 case 2 (`"a project's first-ever observed sweep that is NOT complete does not spuriously broadcast"`) was reported to have a fixture setup issue: it used `spawnResolvingFirst(1)`, which resolves synchronously within `enrichPoolAltitudes`, so the pool finished *complete* by the time the sweep returned — meaning the case could never produce a real queued/unavailable unit. |
| Status | **RESOLVED — no longer true of the shipped test.** The `DEFERRED` status previously recorded here was stale: it was copy-forwarded from the first loop-back and never revised after `build-test-author`'s fix landed. |
| Where resolved | `server/__tests__/value-summary-tick.test.js` (SF-6 case 2, `:1521-1563`). The case no longer calls `spawnResolvingFirst` or `__injectSpawnForTest` at all — it uses `process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"` (the exact alternative the original row recommended), and its own precondition assertion (`assert.ok(hasIncomplete, "precondition: pool is NOT complete…")`, `:1554`) is genuinely exercised and passing. |
| Verified | `build-verifier` round 1 re-ran the precondition assertion directly and confirmed it now passes on a real incomplete pool (`verification-evidence.md` §2); `build-verifier` round 2 re-read the shipped test and flagged this row as the only stale claim in the file (`verification-evidence-round2.md` §"qa/decisions.md — internal consistency check"). No code or test-coverage gap exists; this was documentation staleness only. |

### 6.5 `tsc --noEmit` TypeScript clean gate (VERIFIED CLEAN)

| Finding | Earlier pass reported `error TS6133: 'coverageHeader' is declared but its value is never read` in `PlanLedgerPanel.test.tsx:1265`. |
| Status | **CLEAN** — no errors |
| Verification | Re-ran `cd client && npx tsc --noEmit` — no errors found. Helper is functional as-is. |

### 6.6 B1's in-flight cross-project race — FIXED AND GUARDED (resolved 2026-08-06 by `test-author`)

| Finding | `build-reviewer` B1 proved SF-8's original fix (`useEffect(() => setCoverage(null), [projectId])`) cured only the *already-landed* case and left the *in-flight* case live: switch A→B while A's `load()` is outstanding, A resolves late with a newer `computed_at`, and the monotonic merge hands the header to A permanently. |
| Product fix | **APPLIED** — `client/src/components/PlanLedgerPanel.tsx` now captures `const requestedProjectId = projectId` at the top of `load()` and `handlePrioritizeNow`, and drops every superseded response against `currentProjectIdRef.current` (`:704-705`, `:737`, `:743`, `:899`, `:902`, `:906`), covering all four `load()` legs (plans/pool/health/coverage) plus the prioritize-now path. |
| Standing test | **ADDED** — `PlanLedgerPanel.test.tsx` now includes `"SF-8 (in-flight): a response for a project no longer mounted must not land — guards against race when project A's fetch is still in flight when switching to project B"` (line ~1391). Test uses manually-controlled deferred promises for all four legs of project A's load, switches to project B before A resolves, waits for B's content, then resolves A's promises with newer `computed_at` timestamps. Asserts that B's honest, older data remains rendered — A's stale-but-newer response is dropped by the `currentProjectIdRef` guard. RED-proven by temporarily disabling the guard (both branches went red with the expected leak message), GREEN-confirmed with guard restored. Full suite: 61 test files / 822 tests all pass; `tsc --noEmit` clean. |
| Consequence if weakened | Deleting or weakening the `currentProjectIdRef` guard reintroduces a permanent, user-visible cross-project data leak (A's coverage header, plan titles, units and health rendered under B, unrecoverable for the life of the mount). The standing test now catches this regression. |
| Status | **RESOLVED** — 2026-08-06. The live defect is closed, independently mutation-proven three times (reviewer probe, verifier round-2 probe, test-author red-proof), and now guarded by a permanent standing regression test. |

### 6.7 `mergeCoverage` remains entity-blind (accepted, with trigger; opened 2026-08-06 by `build-lead`)

| Finding | `build-reviewer` B1 offered two complementary cures; only the request-generation guard (6.6) shipped. `mergeCoverage` (`PlanLedgerPanel.tsx:71-78`) still compares `computed_at` only and never checks `next.project_id`, even though `CoverageSnapshot.project_id` is a required field. |
| Why accepted | All three call sites (`:741` `load()`, `:870` eventBus, `:900` `handlePrioritizeNow`) are now individually guarded — `load()`/`handlePrioritizeNow` by `currentProjectIdRef`, the eventBus subscriber by its own pre-existing `data.project_id !== projectId` check. The function is not reachable today with a foreign snapshot. |
| Consequence | The safety lives in three separate call-site guards rather than in the merge itself. A fourth call site added without its own guard silently reopens SF-8. |
| Trigger | Any new `mergeCoverage(...)` call site, or any refactor that moves coverage ingestion out of `load()`. At that point, push the check down into `mergeCoverage(prev, next, projectId)` (reject when `next.project_id !== projectId`) so it cannot be forgotten. |

---

**End of QA Decision Log.**
