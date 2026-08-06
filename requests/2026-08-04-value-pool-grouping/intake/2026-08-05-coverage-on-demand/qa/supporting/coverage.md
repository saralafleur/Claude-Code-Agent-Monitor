# Coverage Map — Value Pool Slice 2 (`coverage-on-demand`, merged `4c2e931`)

> Authored by `qa-coverage-cartographer`. Read-only investigation against the
> shipped code on local `master` (confirmed: `4c2e931` is an ancestor of
> `HEAD`, working tree clean of code changes). Maps *what exists today*, not
> what the build intended. Cross-checked every surface against the actual test
> files, not against the build report's self-description.

## 0. Test stack discovered (this project has two layers, no third)

- **Server (unit + integration combined, one runner):** `node --test
  server/__tests__/*.test.js` (`npm run test:server`). This repo does not
  separate "unit" from "integration" into different directories or npm
  scripts — DB-statement tests, module-arithmetic tests, and full
  `createApp()`/HTTP-`fetch` route tests all live side by side in
  `server/__tests__/` and run in one bucket. No tags/buckets convention
  (no smoke/regression/serial split) beyond the informal `*-smoke.test.js`
  filename idiom used once for this slice.
- **Client (component/unit):** `vitest run` via `npm run test:client`, tests
  colocated in `__tests__/` folders next to the component
  (`client/src/components/__tests__/*.test.tsx`), plus
  `client/src/i18n/__tests__/i18n.test.ts` for locale-registry parity and
  `client/src/pages/__tests__/screens.snapshot.test.tsx` for one
  render-snapshot per routed page.
- **No E2E layer exists in this repo** (no Playwright/Cypress config, no
  `e2e/` directory, no script in `package.json`). The change brief's debt
  item A.1 ("full E2E of the coverage-request flow") is therefore not a
  deferred-but-plannable layer — it would be new tooling, not a missing test
  file.
- **MCP layer** (`npm run mcp:typecheck` / `mcp:build`) is untouched by this
  slice (no `mcp/` files in the diff) — not run for this pass.

Naming convention for new tests in this file family: one `describe()` block
named after the behavior/catalog-id, `it()` titles that name the specific
case letter (e.g. `(a) complete`, `T3`, `G1a`) — architects should follow
this, not invent a new suffix.

---

## 1–2. Coverage by surface, with verdict

### `server/lib/value-summary-tick.js` — `runCoverageDrain()` (the drain loop)
**Verdict: GUARDED.** The most heavily tested surface in this slice.
- `server/__tests__/value-summary-tick.test.js`:
  - `describe("runCoverageDrain: overlap guard SHARED with runValueSummaryTickOnce (DEC-4, WATCH-7)")` — both directions of the shared `running` guard (lines 1005–1044).
  - `describe("runCoverageDrain: exit conditions (G1c, all named and mutually exclusive)")` (lines 1046–1191) — all six named exits individually proven: `(a) complete`, `(b) error` (flag kept), `(c) no_progress` (flag kept), `(d) iteration_cap` (25-iteration cap, flag kept), `(e) not_requested` (no-op), `(f) pool growth mid-drain` (re-derived `pending`, WATCH-8).
  - `describe("runCoverageDrain: TTL expiry (DEC-8)")` (1193–1293) — expired-flag immediate exit, live-flag normal drain, plus the two `listValueSweepTargets` ordering cases (expired sorts passive, live sorts first) and the passive-ordering-byte-identical regression case.
  - `describe("runCoverageDrain: MAX_PROJECTS_PER_TICK is never read by the drain path (DEC-3.3)")` (1295–1334) — a real source-body scan plus a behavioral case (tiny `MAX_PROJECTS_PER_TICK` does not bound the drain).
  - `describe("Broadcast widening (DEC-6): terminal iteration with generated===0 still emits...")` (1335+) — the transition-forces-broadcast rule.
- **Gap inside this surface:** SF-1 (the tick's own `pending: queued + unavailable` field vs. `coverage.pending`) was fixed in code (payload now sets `pending: snapshot.pending`, `value-summary-tick.js:363`), but there is **no regression test asserting `payload.pending === payload.coverage.pending`** at the wire level — the only assertion on that field is `assert.ok(typeof broadcasts[0].payload.pending === "number")` (`value-summary-tick.test.js:322`), which would not catch a future re-divergence. **PARTIAL** on this one sub-point.

### `server/lib/value-coverage.js` (single home: `coverageSnapshot` / `estimateEta`)
**Verdict: GUARDED.**
- `server/__tests__/value-coverage.test.js` (362 ln) — real arithmetic unit tests: `described`/`pending`/`complete` formulas, all three `demand` states (including "never-zero" direction), all three `eta.state` branches (measured/estimating/none, cold-start, per-project-vs-fleet-fallback preference, K=5 cap), a structural "no pool-membership SQL" scan (DEC-16), and its own i18n registry→locale scan (see §Registry below).
- Cross-path arithmetic agreement is additionally proven by `value-coverage-parity.test.js` (see routes/WS section below).
- **N1 (nit, not fixed):** `estimateEta` selects `generated` from `listRecentValueGenerationDurations` and never uses it — `per_batch_ms` weighs a 3-unit batch the same as a 40-unit batch. No test catches this because no test asserts batch-size-weighted ETA. Accepted under `WATCH-S2-C`; not a coverage gap in the sense of "would a regression escape a green suite" — it's an accepted design nit, not a silent divergence.

### Schema — `value_summary_sweep_state.coverage_requested_at`
**Verdict: GUARDED.**
- `server/__tests__/db-migration.test.js`:
  - `describe("Migration: value_summary_sweep_state.coverage_requested_at (Value Pool Slice 2, DEC-8)")` (line 2193) — the `UPGRADE_CASES` entry, guarded-ALTER path, legacy row reads `NULL`, column writable via `requestValueCoverage`, idempotent second `require()` (no duplicate column).
  - An earlier, separate case at line ~861 also exercises writable + clearable via `requestValueCoverage`/`clearValueCoverageRequest` on a legacy-migrated row.
- `server/__tests__/single-writer-guard.test.js:346-383` — `requestValueCoverage` appears in exactly `db.js` (statement) + `project-plans.js` (one lexical call site).
- `server/__tests__/chronology-ordering.test.js` (extended) — both new duration-log reads (`listRecentValueGenerationDurations` + per-project variant) sort `created_at DESC, id DESC` before `LIMIT`.

### HTTP routes — `POST /api/project-plans/coverage-request`, `GET /api/project-plans/coverage`
**Verdict: GUARDED for the documented contract shape and basic request/response cycle; PARTIAL on the `demand: "draining"` branch specifically.**
- `server/__tests__/project-plans-api.test.js` — `describe("Group T: coverage-on-demand routes ...")` (line 826):
  - T1: `GET /coverage` on a never-requested project → passive/complete/empty-pool snapshot, full field check.
  - T2/T4: both routes require `project_id`, 400 on missing.
  - T3: `POST /coverage-request` stamps the flag, 202, `demand !== "passive"`, idempotent under a redundant call, flag eventually clears on an empty-pool drain.
  - T5: `POST /altitudes` response shape unchanged (no `coverage` leak — DEC-9's negative-space guarantee).
  - T6 (G2 smoke): `GET /coverage`'s response key set matches the contract exactly.
- **The one open gap, more precise than the change brief states:** `isDrainingProject()` **is wired into both routes today** (`server/routes/project-plans.js:332,363`; `server/lib/value-summary-tick.js:568-580`) — this is `SF-3` from the review, and the build report's own DoD section says it was **applied**, contradicting the change brief's "SF-3 ... left unfixed" line (change-brief.md, Test-invariants §, §9.8 row). **The code shows the fix is real.** What is *not* tested is the `"draining"` value actually appearing on an HTTP response for a real multi-batch drain: T3 only asserts `["requested", "draining"].includes(...)` (permissive, not distinguishing) against an **empty-pool** project, where the drain converges before or without a real intermediate "mid-drain" HTTP observation. No test seeds a multi-batch pool, calls `POST /coverage-request`, and asserts the 202 (or a concurrent `GET /coverage`) reads `demand === "draining"` specifically. **Verdict for this sub-point: PARTIAL** — the mechanism is real and unit-level-adjacent (`value-coverage.test.js` proves `coverageSnapshot({draining:true})` produces `"draining"` in isolation), but the route-level wiring under a genuine in-flight drain has no integration assertion.
- **SF-2** (route composing its own `requestedAt` instead of re-reading a raced value) is fixed in code (`project-plans.js:317`, uses `nowIso` directly) and implicitly exercised by T3's idempotency case, though there's no dedicated regression test that would fail if the re-read bug were reintroduced.
- **SF-4** (the same 4-step probe composition duplicated verbatim at `project-plans.js:318-319` and `:351-352`, with `requestedAt` already differing between the two call sites) remains **UNGUARDED** — confirmed still present in shipped code, no shared `buildProbeCoverage` helper exists, and no test asserts the two routes' composition stays in sync (only the parity test, which exercises the GET route against the *tick's* broadcast, not against the POST route's own probe composition).

### WebSocket contract — `value_altitudes_updated` widened payload / broadcast-trigger condition
**Verdict: GUARDED for cross-path arithmetic parity and the transition-broadcast rule; UNGUARDED for the first-observation drop (SF-6).**
- `server/__tests__/value-coverage-parity.test.js` (G2, the named MANDATORY deliverable) — **confirmed genuinely repaired post-BL-1.** Read the shipped file directly: it now forces a **real** `passive → requested` transition across two real `runValueSummaryTickOnce` calls, captures the **actual broadcast payload** via a real `broadcast` callback, and deep-equals it against the real `GET /coverage` route response (field-by-field, `computed_at` excluded by design). There is no more self-built fallback branch — the `if (broadcastPayload)` unreachable-branch defect the reviewer found (BL-1) is gone; the test would fail outright if the tick never broadcasts. This is a real, load-bearing guard now, not the vacuous one BL-1 described.
- `server/__tests__/value-summary-tick.test.js` `describe("Broadcast widening (DEC-6): ...")` — terminal iteration with `generated === 0` still emits, on a real demand/complete transition.
- **SF-6 is real and unguarded.** `shouldBroadcastCoverage` (`value-summary-tick.js:190-195`) still treats an *absent* prior (first observation for a project in this process's lifetime) as "no transition," so a terminal `complete` transition observed for the first time (post-restart drain resume, or a pool completed via `POST /altitudes` between ticks) is silently dropped from the wire — confirmed unchanged in the shipped code, matching the build's own disclosed disposition (DEC-3, deferred). No test in `value-summary-tick.test.js` exercises "first observation is already complete" — every broadcast-widening test seeds `lastBroadcastState` via a prior tick first. **This is a real, reproducible-today UNGUARDED gap**, not speculative.

### `client/src/components/PlanLedgerPanel.tsx` — WS subscriber
**Verdict: GUARDED for the subscriber's own contract (subscribe/filter/merge/unsubscribe/StrictMode); PARTIAL/UNGUARDED for the two client-side robustness gaps named in the brief (SF-8, SF-9).**
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx`, `describe("PlanLedgerPanel: Value Pool Slice 2 coverage header (DEC-1, DEC-5, R4)")` (line 910+):
  - cold-start `estimating` copy (never a minutes string, never `0`).
  - `measured` ETA renders server-provided minutes verbatim (no client arithmetic).
  - complete+passive pool hides the "prioritize now" button.
  - "prioritize now" → `api.projectPlans.requestCoverage`, reflects returned `demand`.
  - **BL-2 regression test** — renders inside `<StrictMode>`, asserts altitude text still renders and "prioritize now" doesn't stay disabled (this is the one targeted fix for the class-level StrictMode blind spot named in the brief; the *class* remains otherwise unguarded across the panel's other effects, as both the brief and build report note).
  - **R4** — out-of-order (stale `computed_at`) WS delivery does not regress the header.
  - **WATCH-S2-B** — a `value_altitudes_updated` message refetches only the named `unit_keys`' altitude text, never re-fetches coverage.
- **SF-8 (unkeyed panel / no reset on `projectId` change) — UNGUARDED, confirmed live.** `client/src/pages/ProjectDetail.tsx:1292` still renders `<PlanLedgerPanel projectId={id} />` with no `key`; `PlanLedgerPanel.tsx` has no `useEffect` that clears `coverage` state on a `projectId` change and `mergeCoverage` (`:71`) does not check `project_id`. No test in `PlanLedgerPanel.test.tsx` or `ProjectDetail.test.tsx` mounts the panel, switches `projectId`, and asserts the coverage header updates to the new project — the cross-project leak the brief describes is real and untested.
- **SF-9 (a failing `GET /coverage` blanks the whole panel) — UNGUARDED, confirmed live and independently reproduced this pass.** `PlanLedgerPanel.tsx:696-701` still joins `api.projectPlans.coverage(projectId)` into the same `Promise.all` as `list`/`pool`/`health`, inside one `try { … } catch (err) { setError(...) }` — any rejection (network, 4xx/5xx, or even a missing mock method) blanks `plans`/`units`/`health` together. **Confirmed empirically in this pass, not just by reading the diff:** `client/src/pages/__tests__/screens.snapshot.test.tsx`'s API mock (`vi.mock("../../lib/api", ...)`, lines ~229-...) fully replaces `api.projectPlans` and lists only `list`/`pool`/`health`/`claim`/`close` — **`coverage` and `requestCoverage` are absent from the mock entirely.** If that snapshot test's `"Project detail"` case ever mounted `PlanLedgerPanel` for a real project, `api.projectPlans.coverage(projectId)` would throw `TypeError: ... is not a function`, land in the `catch`, and blank the panel — a live demonstration of SF-9 sitting in the suite today. It doesn't currently *fail* the snapshot only because the mocked project id (`proj-1`) doesn't exist in the mocked project list, so `ProjectDetail` short-circuits to a "Project not found" empty state **before** `PlanLedgerPanel` ever mounts (verified against the actual stored snapshot — it renders only the not-found empty state, no Plan Ledger content at all). See the locale/screens-snapshot note below — this is a stronger finding than "stale baseline": **the panel is never mounted by this suite at all**, coverage header included.

### Locale files (`en`/`ko`/`vi`/`zh` × `planLedger.pool.coverage.*`)
**Verdict: GUARDED for key-parity; UNGUARDED for the one named registry-growth gap (N2).**
- `client/src/i18n/__tests__/i18n.test.ts`, `describe("whole-namespace key-set parity (O-8 / E1 — portfolio layer i18n)")`, `it("E1.1: all namespaces × 4 locales have identical key sets ...")` — a generic, registry-derived scan across every namespace (including `projectDetail`, where the new `planLedger.pool.coverage.*` keys live), mutation-proven per the build report (a deleted `ko` key was observed red).
- `server/__tests__/value-coverage.test.js`, `describe("i18n registry → locale (WATCH-S2-F, G6): ...")` (line 276) — asserts every `DEMAND_STATES`/`ETA_STATES` member has a mapped locale key in all four locales, via a hand-typed `STATE_TO_LOCALE_KEY` map.
- **N2 — confirmed live, UNGUARDED.** That same `STATE_TO_LOCALE_KEY` map (in the test file, not product code) silently `continue`s on any unmapped registry member instead of failing — so a hypothetical Slice-3-added 4th `demand`/`eta.state` value would ship with **no locale key and no test failure** from this specific guard (the generic E1.1 whole-namespace scan would still catch a locale *drifting from itself*, but nothing here asserts the registry and the locale-key map stay in lockstep as the registry grows). `WATCH-S2-F`'s stated promotion trigger ("any Slice 3 registry growth") fires exactly here — worth closing before Slice 3 touches either registry.

### `summaryModel(stage)` cascade
**Verdict: GUARDED for the plumbing that shipped; the acceptance criterion itself (AC-6, calibrated defaults) is out of test scope because it never happened — this is not a coverage gap, it's an unrun task.**
- `server/__tests__/value-summary.test.js` (extended, +137 ln, precedence table starting ~line 251) — default/unit/grouping/shared/all-unset env-var precedence, one fallback tail, a real end-to-end spawn-args assertion showing the resolved model reaching the spawn call.
- No test (and no test *could* meaningfully exist yet) asserts a calibrated haiku-vs-sonnet default, because DEC-10's calibration run never happened — confirmed still true in the shipped `summaryModel` fallback tail (`"haiku"` unconditionally). This is AC-6/DEC-2, tracked as a plan gate, not a QA-discoverable test gap.

---

## 3. Registry/consistency gap check (this project's §9.1 DERIVED-DUAL-VIEW convention)

Four canonical single-homes are named by technical-plan.md §5 for this slice. Status of each entry's test coverage:

| Canonical source | Consumers | Per-entry test coverage | Verdict |
|---|---|---|---|
| `coverageSnapshot`/`estimateEta` (`value-coverage.js`) — the only place `described`/`pending`/`complete`/`demand`/`eta` is computed | HTTP `GET /coverage`, HTTP `POST /coverage-request` 202 body, WS `coverage` field | `value-coverage-parity.test.js` deep-equals route vs. **real** broadcast (post-BL-1 repair, verified genuine); route↔route consistency (the two probe-composition call sites, SF-4) has **no** cross-check | **GUARDED** (route↔broadcast) / **UNGUARDED** (route↔route, SF-4) |
| `demand` registry (`passive`/`requested`/`draining`) | `value-coverage.js` (unit), both routes, WS broadcast, client `PlanLedgerPanel.tsx`, 4 locales | Unit: `value-coverage.test.js` (all 3 buckets + never-zero direction). Route: T3 only permissively checks membership, not the `"draining"` value specifically under a real in-flight drain. Locale: mapped via `STATE_TO_LOCALE_KEY`, silently skips unmapped future members (N2). | **PARTIAL** — real at the unit layer, thin at the HTTP-integration layer for the `"draining"` branch, structurally blind to future registry growth at the locale layer |
| `eta.state` registry (`measured`/`estimating`/`none`) | same fan-out as `demand` | Unit: all 3 branches proven (`value-coverage.test.js`). Client: cold-start + measured both proven (`PlanLedgerPanel.test.tsx`). Locale: same N2 caveat. | **GUARDED**, with the same N2 locale-growth caveat as `demand` |
| Pool membership (`assembleValuePool`, DEC-16 sole composer) | tick, both routes, `value-coverage.js` (indirectly, via `counts`) | `value-summary-tick.test.js` DEC-16 structural scan (no hand-rolled pool SQL); `single-writer-guard.test.js` `assertSingleHome` dispositions. **SF-5** (a real `value-coverage.js → value-summary.js` consumer edge missing from the hand-typed consumer map) was found and fixed per the build report — confirmed the disposition entry now exists in `single-writer-guard.test.js`. | **GUARDED** |

**Bottom line on this project's own §9.1 convention:** the MANDATORY named deliverable (`value-coverage-parity.test.js`) is confirmed genuinely fixed as of this pass — this is worth stating plainly since it was vacuous as recently as this same build's Round 2. The residual registry gap that *is* still live and precisely locatable is **N2** (locale-key map silently skips unmapped future registry members) and the **route↔route** duplication (**SF-4**, no test, code still duplicated).

---

## 4. Current baseline (actually run, this pass)

```
npm run test:server
```
**Result: 1784 / 1784 tests passing, 443 suites, 0 failed, 0 cancelled, 0 skipped.** (`node --test server/__tests__/*.test.js`, ~58s.) This includes all of `coverage-smoke.test.js`, `value-coverage.test.js`, `value-coverage-parity.test.js`, `value-summary-tick.test.js`, `project-plans-api.test.js`, `single-writer-guard.test.js`, `chronology-ordering.test.js`, `db-migration.test.js`.

```
npm run test:client
```
**Result: 817 / 817 tests passing, 61 files, 0 failed.** (`vitest run`, ~7s.) Includes `PlanLedgerPanel.test.tsx` (BL-2 StrictMode case included), `i18n.test.ts`, `screens.snapshot.test.tsx`.

Both numbers match the build report's own independently re-verified counts exactly — **no drift between what the build reported and what this pass observed**, and no regression since merge. `git status` shows the working tree free of any code changes (only pre-existing untracked intake docs), so this baseline reflects the actual shipped `4c2e931` state, not a modified tree.

**Not run this pass:** `npx tsc --noEmit` (client typecheck) and the file-headers audit — both were independently confirmed clean by the build's own verification pass and neither is a coverage-mapping concern; re-running them wasn't necessary to answer "what guards this and is it green," but flagging that this pass did not re-verify typecheck/header-audit itself.

**One known pre-existing flake, not reproduced this pass:** the build report records a timestamp-collision `notStrictEqual` in `value-summary-tick.test.js`, reproduced 4/8 runs on the untouched Slice-1 worktree, unrelated to this slice's changes. It did not fire in this pass's single run (1784/1784 green); worth knowing it's a rerun-away flake, not a hard regression, if it appears in CI later.

---

## 5. Conventions in play (for whoever plans new tests here)

- **Server:** one flat `server/__tests__/*.test.js` directory, `node --test`, no unit/integration split by folder — a new HTTP-route test belongs in the existing per-feature file (`project-plans-api.test.js` for these two routes, following the `describe("Group T: ...")` / `it("T#: ...")` numbering already used) or a new `*.test.js` file if the surface is large enough to warrant its own file (as `value-coverage.test.js` and `value-coverage-parity.test.js` were, both named explicitly in technical-plan.md §5 because "a per-shape spec only gets written when it is given a name").
- **Structural/registry guards:** `single-writer-guard.test.js` (hand-typed `assertSingleHome` consumer/export dispositions — must be updated in the same commit as any new export or new consumer, per SF-5's lesson) and `chronology-ordering.test.js` (`FILE_DISPOSITIONS`, `"scanned"` entries for any file reading `ORDER BY ... LIMIT`).
- **Client:** colocated `__tests__/` folders next to the component (`client/src/components/__tests__/ComponentName.test.tsx`), RTL + vitest. `screens.snapshot.test.tsx` is a single shared file with one `it()` per routed page and one shared API mock object at the top — **any new API method a page/component calls must be added to that shared mock**, or the mocked call throws and gets silently absorbed by whatever `try/catch` wraps it (exactly what happened here with `coverage`/`requestCoverage`, currently masked only because the "Project detail" fixture project doesn't exist in the mocked project list).
- **i18n:** new locale keys go in all four `client/src/i18n/locales/{en,ko,vi,zh}/*.json` files in the same commit; the generic `i18n.test.ts` E1.1 scan catches drift automatically once keys exist anywhere — no per-feature locale test is required unless (as `value-coverage.test.js` did) a closed server-authored registry needs its own registry→locale-key completeness check, in which case use an *exact-set* assertion on the exempt/unmapped list (N2's suggested fix) rather than a silent `continue`.
- **Named-deliverable convention:** when a plan calls out a MANDATORY cross-consumer guard, this project gives it its own filename (`value-coverage-parity.test.js`, precedent: `ledger-metrics-parity.test.js`) rather than folding it into an existing file — follow that precedent for any new SF-4/SF-8/SF-9-closing regression test.
