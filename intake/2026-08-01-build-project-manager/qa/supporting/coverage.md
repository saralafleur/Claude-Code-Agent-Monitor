# Coverage Map — build-project-manager (layers 4–6)

> Authored by `qa-coverage-cartographer`. Maps *existing* test coverage over
> the surfaces named in `qa/change-brief.md`, before any new test is
> proposed. Nothing in this build exists yet (confirmed again below) — every
> verdict here describes coverage of the surfaces the new code will sit on
> top of / hook into, not coverage of the new code itself (which cannot
> exist yet).

## 0. Test stack (discovered)

This repo has **no separate integration or e2e layer** — everything server-side
is one Node-native suite:

- **Server suite** — `node --test server/__tests__/*.test.js` (`npm run
  test:server`). Files are flat under `server/__tests__/`, one file per
  module/route-group, `describe`/`it` via `node:test` + `node:assert/strict`.
  No tag/bucket convention (no smoke/regression split) — every file runs
  every time; ~250 suites / ~1087 tests total, each spinning up its own
  isolated `DASHBOARD_DB_PATH` tmp SQLite file (`before`/`after` pattern) so
  suites don't share state.
- **Client suite** — `vitest run` (`npm run test:client`), including
  per-screen render snapshots. **Not relevant here** — the brief and the
  technical plan both confirm zero client changes ship in this effort
  (WATCH-3); not run for this pass.
- **MCP** — `npm run mcp:typecheck` / `mcp:build`. Not touched by this
  change; not run.

No `PROJECT-CONTEXT.md` override of this — the stack above is exactly what's
documented there (repo topology only; no bespoke test-stack section).

## 1. Existing coverage by surface

### `server/lib/plan-ingest.js` (parse + ingest)
- `server/__tests__/plan-ingest.test.js` (443 lines, 21 tests) — thorough:
  `parsePlanMarkdown` (checkbox variants, `id:`/`acceptance:`/`detail:`
  lines, sub-item nesting, `attachDisplayNumbers`), `ingestPlanForCwd`
  end-to-end (new file, unchanged-hash short-circuit, `declared_done_*`
  survival across re-ingest, missing-file `missing_at` stamping/clearing,
  oversized-file guard, reorder identity by `item_id` not number, fallback
  ids, sub-item CRUD across re-ingest).
- `server/__tests__/plans-api.test.js` (routes layer) exercises
  `ingestPlanForCwd` indirectly via `POST /api/plans/refresh` and reads back
  through `GET /api/plans*`.
- **Verdict: GUARDED for existing behavior.** The plan's own change here is
  "exports only, no behavior change" (new `module.exports` entries for
  `ID_LINE_RE`/`ACCEPTANCE_LINE_RE`/`DETAIL_LINE_RE`/the five caps, plus a
  header-comment correction) — there is nothing to regression-test in the
  parse/ingest logic itself, and the existing suite would immediately catch
  any accidental behavior drift from touching this file. **The new exports
  themselves are UNGUARDED** (no test imports them directly yet — expected,
  since `plan-writeback.js` doesn't exist; the architects should add an
  export-surface assertion, e.g. `assert.equal(typeof
  planIngest.ID_LINE_RE, "object")`, so a future refactor can't silently drop
  one plan-writeback.js depends on).

### `server/db.js` — `plan_items` schema (current + `target_date` column)
- No dedicated `db.test.js` exists in this repo — schema is exercised only
  through consumers. `plan_items`' current shape (`item_id`,
  `item_number`, `parent_item_id`, `declared_done_at`,
  `declared_done_session`, the `UNIQUE(cwd, item_number)` index tolerating
  multiple NULLs) is **GUARDED** via `plan-ingest.test.js` and
  `plans-api.test.js` as above.
- `target_date` (new column), `setPlanItemTargetDate` (new statement), and
  the sibling `try/SELECT/catch/ALTER` migration block are **UNGUARDED** —
  confirmed absent (`grep -rn "target_date" server/ client/src/` → zero
  product hits, matching the brief). No existing test exercises the
  fresh-install-vs-upgrade migration idiom this file uses elsewhere (e.g.
  the `workflow_run_id`/`intro_until` precedents) at all — this project has
  **no test that opens an old-shape DB file and asserts the `ALTER` path
  fires**, for any column. That's a pre-existing gap, not new to this
  change, but it means Layer 5 introduces the first column whose "both
  halves agree" invariant has zero direct-test precedent to imitate; the
  architects will need to invent that shape themselves (fixture: pre-seed a
  DB file with the column absent, re-open through `require("../db")`, assert
  it now exists and reads NULL).
- `detour_dispositions` and `decision_queue` (new tables) — **UNGUARDED**,
  confirmed absent by the same grep. No registry/consistency angle applies
  to schema-existence itself; see §3 below for the disposition-vocabulary
  registry check.

### `server/lib/focus-inference.js` (`inferSession`, the detour hook point)
- `server/__tests__/focus-inference.test.js` (670 lines) is the single
  largest and most rigorous suite touched by this brief:
  `buildActivityDigest` (including two dedicated §9.2 chronology-proxy
  regression tests — "orders prompts by created_at, not by id/insertion
  order" and "selects the chronologically-correct subset before LIMIT, not
  an id-ordered subset (trap-defeating LIMIT case)"), `heuristicClassify`,
  `parseLlmOutput`, `buildSummaryPrompt`/`parseSummaryOutput`,
  `listCandidates` (five scenarios), and `inferSession` end-to-end (six
  scenarios: heuristic match, LLM fallback + detour verdict, unclassified,
  plan-less-cwd summary path, LLM-unavailable degrade, heuristic-mode
  never-spawns-planless). Plus a `focus-report inference fallback` block
  asserting rendered segments for silent/detour/unclassified sessions.
- **Verdict: GUARDED for everything that exists today**, including exactly
  the §9.2 pattern this brief calls out as re-touched. **The planned new
  hook — the `try { require("./detours").recordInferredDetour(...) } catch
  {}` block after `upsertFocusInference.run(...)` when `result.kind ===
  "detour"` — is UNGUARDED** (doesn't exist yet; `detours.js` doesn't
  exist). Because this suite already asserts a `"detour"`-kind verdict is
  produced and stored (the "falls through to the LLM and stores its detour
  verdict" test, line ~461), the natural extension point is obvious: that
  same test (or a sibling) should assert `recordInferredDetour` fires
  exactly once, `focus_inferences` remains the sole writer, and a thrown
  `recordInferredDetour` doesn't lose the inference row (fail-safe
  contract). None of that exists today.

### `server/lib/focus-summary.js`
- `server/__tests__/focus-summary.test.js` (527 lines) — not itself a
  surface the technical plan edits, but named in the brief as the **test
  template** the plan's Override 3 (DEC-11) mandates for the reconciliation
  pass's LLM half (injected-spawn seam discipline, digest-gated caching,
  hierarchical/multi-day rollup pattern). Fully **GUARDED** as it stands
  today: `parseWindowSummaryOutput`, `computeInputDigest`,
  `buildWindowSummaryPrompt`, cache-hit/regenerate-on-change, recency-biased
  session capping, multi-day rollup with per-day degrade-to-raw-facts. This
  is template coverage, not surface coverage — cited here because the
  brief explicitly names it as grounding for how `reconciliation.js`'s tests
  should be shaped.

### `server/lib/session-liveness.js`
- `server/__tests__/session-liveness.test.js` (442 lines, 31 tests) —
  thoroughly **GUARDED** as the synchronous `ps`/`lsof`-probe watchdog it
  actually is (process matching, probe availability/disable flags,
  container detection, the full reap/spare decision matrix, self-heal on
  next hook event, end-to-end `watchdogCheck`).
- **Verdict for this brief's purposes: not the right template, and the
  brief/technical-plan both already say so (Override 3 / DEC-11).** This
  file stays the citation for the *fail-safe-per-stage contract* only
  (independent no-op per stage). Flagging explicitly so the test architects
  don't mistake this suite's depth for "the reconciliation scheduler is
  already tested" — it tests a completely different mechanism (a
  synchronous probe, not a scheduled interval tick).

### `server/lib/cc-mutate.js` (`atomicWriteFile` extraction source)
- **No dedicated `cc-mutate.test.js` exists** — confirmed by grep (zero
  matches for `cc-mutate|atomicWriteFile` across `server/__tests__/*.test.js`
  outside indirect exercise). The technical plan's own step 11 says the same
  thing explicitly: "the primitive itself has no direct test coverage
  today."
- **Indirect coverage only**, via `server/__tests__/cc-config.test.js`
  (825 lines) exercising the `/api/cc-config` routes that call
  `writeArtifact`/`deleteArtifact` (which call the local `atomicWriteFile`
  internally): specifically "write is atomic: tmp file is gone after
  success" (line ~627), plus every PUT/DELETE test that asserts a backup
  landed and content round-trips. This is the regression guard the plan's
  step 11 names by name (`node --test
  server/__tests__/cc-config.test.js` immediately after the extraction,
  before touching anything else).
- **Verdict: PARTIAL.** `cc-config.test.js` would catch a *behavioral*
  regression in the write-then-rename sequence (tmp file leaking, content
  corruption, backup missing) because it exercises the call sites, but it
  never asserts anything about `atomicWriteFile` as a unit — no direct test
  of its failure paths (tmp-unlink-on-every-failure-path, `fsync` best-effort
  swallow, `EEXIST` on the `"wx"` flag if a stale tmp file exists). The
  planned `server/__tests__/atomic-file.test.js` is genuinely new coverage,
  not a duplicate.

### `server/routes/plans.js`
- `server/__tests__/plans-api.test.js` (273 lines) — **GUARDED** for
  every route that exists today: `/refresh` (ingest + validation + 404),
  `GET /api/plans`, `GET /api/plans/for-cwd`, `GET
  /api/plans/project/:id` rollup, the full `session focus` verb surface
  (`set`/idempotency/`pop`/`EMPTY_STACK`/`bug`/`feature` detour-tagging),
  bulk-hydrate `GET /api/focus`, per-session `GET /:id/focus`, and the
  TodoWrite-derived todos endpoint.
- **`POST /api/plans/items/target` (new route) — UNGUARDED**, does not
  exist. Note for the test architects: this file's existing validation
  style (structured `400 { error }`, `404` via `getPlanItem` miss) is
  already demonstrated in the `refresh validation` test — a direct template
  to extend, not a fresh pattern to invent.

### `server/index.js` scheduler wiring (`startBackgroundServices`)
- **No test imports or exercises `startFocusInference`, `startFocusAudit`,
  `startUpdateScheduler`, or `startBackgroundServices` itself** — confirmed
  by grep across `server/__tests__/`. What's actually tested is the
  *per-tick body* each scheduler calls (`inferSession` in
  `focus-inference.test.js`, `auditSession` in `focus-audit.test.js`), never
  the `setInterval`-wiring function that calls them on a timer inside its own
  `try/catch`.
- **Verdict: UNGUARDED for the wiring layer itself**, and this is a
  pre-existing gap this project has apparently accepted for
  `startFocusAudit`/`startFocusInference` already — not something Layer 6
  is introducing new risk into, but also not something Layer 6 should
  assume is "the same shape, therefore already proven." `startReconciliation`
  will start from the same zero baseline its two precedents did. Recommend
  the same scope precedent be kept for `startReconciliation`: test
  `reconcileCwd`/`evaluateRules`/`classifyFlaggedDetours` directly (unit
  level, per Override 3/DEC-11's citation of `focus-audit.test.js`'s
  shape), and treat the bare `setInterval` registration as an accepted,
  by-inspection-only gap consistent with its two siblings — but say so
  explicitly in the new test file's header comment so it reads as a
  decision, not an oversight.

## 2. Coverage verdict summary

| Surface | Verdict | Basis |
|---|---|---|
| `plan-ingest.js` existing parse/ingest behavior | GUARDED | `plan-ingest.test.js`, `plans-api.test.js` |
| `plan-ingest.js` new `module.exports` entries (Layer 4 step 12) | UNGUARDED | don't exist yet; no export-surface assertion exists even for the current export list |
| `plan_items` current schema/columns | GUARDED | via ingest/route tests above |
| `plan_items.target_date` + migration + `setPlanItemTargetDate` | UNGUARDED | column/statement absent; no ALTER-migration test precedent exists in this repo at all |
| `detour_dispositions` table | UNGUARDED | table absent |
| `decision_queue` table | UNGUARDED | table absent |
| `focus-inference.js` existing `inferSession`/classify/digest logic | GUARDED | `focus-inference.test.js` (670 lines, incl. 2 §9.2 regression tests) |
| `focus-inference.js` planned `recordInferredDetour` hook | UNGUARDED | `detours.js` doesn't exist; hook not wired |
| `focus-summary.js` (template only, not directly touched) | GUARDED | `focus-summary.test.js` |
| `session-liveness.js` (fail-safe-contract citation only, not directly touched) | GUARDED | `session-liveness.test.js`; wrong shape as a test *template* per DEC-11 |
| `cc-mutate.js`'s current `atomicWriteFile` (pre-extraction) | PARTIAL | only indirectly via `cc-config.test.js`'s route-level assertions; no unit test of the primitive itself |
| `server/lib/atomic-file.js` (post-extraction) | UNGUARDED | doesn't exist yet |
| `server/routes/plans.js` existing routes | GUARDED | `plans-api.test.js` |
| `POST /api/plans/items/target` (new) | UNGUARDED | route doesn't exist |
| `server/routes/detours.js`, `server/routes/decision-queue.js` (new) | UNGUARDED | files don't exist |
| `server/index.js` scheduler mounts (`/api/detours`, `/api/decision-queue`) | UNGUARDED | mounts don't exist |
| `startFocusInference`/`startFocusAudit` wiring (precedent for `startReconciliation`) | UNGUARDED (pre-existing gap) | no test calls the `setInterval`-registration functions themselves, only their tick bodies |
| `server/lib/plan-writeback.js`, `detours.js`, `reconciliation.js`, `pace.js` (all new) | UNGUARDED | none exist |

## 3. Registry/consistency gap check

`PROJECT-CONTEXT.md` names two recurring defect-class patterns; both are
flagged in the brief as touched, and both have a live design-time pre-flag
already in `PROJECT-CONTEXT.md` (2026-08-01, this intake) rather than a
counted occurrence:

- **§9.1 DERIVED-DUAL-VIEW** — this project's registry-consistency analogue
  here is DEC-14's "one write path, one composer, one set of column names"
  rule: `pace.js` must be the only pace computation, `detours.js` the only
  disposition vocabulary (`DISPOSITIONS` enum), and `plan-writeback.js`'s
  `applyDisposition()` the only place that composes "sanitize → dispatch →
  audit → retry → escalate." **Currently there is nothing to check against
  a registry because none of these single-source-of-truth modules exist
  yet** — this is a forward-looking gap, not a live defect. The concrete,
  checkable acceptance criterion this repo's own convention would demand
  (per `PROJECT-CONTEXT.md`'s §9.1 "How to comply" and its own cited
  precedent, `FocusReportModal.test.tsx`'s
  `[standing template]`/`[extension]` test-naming convention) is: **when
  Layer 6 wires its second call site for `applyDisposition`
  (`reconciliation.js`), the test suite must contain a cross-call-site test
  that both `routes/detours.js`'s human-resolve path and
  `reconciliation.js`'s unattended path produce byte-identical writes for
  the same disposition inputs** — not two independently-written "looks
  right" tests. This does not exist yet (nothing to test), but it is the
  single check the test architects should not skip once Layer 4 (b) ships
  and Layer 6 becomes the second caller, per this catalog's own stated
  failure mode ("the failure lands the moment a second consumer appears,
  not at introduction").
- **§9.2 row-id-as-chronology-proxy** — every new query the brief names
  (`listPendingDetours`, `listStaleResolvedDetours`,
  `backfillDeclaredDetours`, `listDecisionQueue`, Layer 6's detour-volume
  lookback) must sort `ORDER BY created_at …, id …` before `LIMIT`. This
  repo already has a live, checkable **test pattern** for exactly this
  defect class — `focus-inference.test.js`'s two dedicated tests ("orders
  prompts by created_at, not by id/insertion order" and "selects the
  chronologically-correct subset before LIMIT, not an id-ordered subset
  (trap-defeating LIMIT case)", lines ~210 and ~231). **None of the five new
  queries above have an equivalent test yet** — they don't exist. Calling
  this out explicitly per the brief's instruction: an entry/query here with
  no such test is UNGUARDED even once the suite is green, because a
  same-timestamp-different-id ordering bug would pass every functional test
  and only surface against `workflow-ingest.js`'s bulk-inserted rows in
  production — exactly the mechanism this catalog entry documents from its
  three prior real occurrences (`6e9a443`, `b3a2cc9`, the
  `focus-inference.js` `buildActivityDigest()` fix). The
  `focus-inference.test.js` pair above is the concrete template to clone
  for each of the five new queries.

## 4. Current baseline (run)

Ran two passes, both from a clean `git status`-confirmed working tree with
this effort's files still absent (only unrelated pre-existing uncommitted
work: `pm.md`, the accounts/usage-oauth/terminal-focus files, and the
in-flight `Sidebar.tsx` change — none touch this brief's surfaces):

1. **Targeted run** — the seven files most relevant to this brief:
   ```
   node --test server/__tests__/plan-ingest.test.js server/__tests__/plans-api.test.js \
     server/__tests__/focus-inference.test.js server/__tests__/session-liveness.test.js \
     server/__tests__/focus-audit.test.js server/__tests__/focus-summary.test.js \
     server/__tests__/cc-config.test.js
   ```
   Result: **178/178 pass, 0 fail** (31 suites).

2. **Full server baseline** — `npm run test:server`:
   Result: **1087/1087 pass, 0 fail** (250 suites, ~37s). This matches the
   change brief's own stated baseline exactly (also 1087/1087), confirming
   nothing has drifted between the QA-triage pass and this coverage pass.

Client suite (`npm run test:client`) was **not run** — out of scope per
confirmed zero client changes in this effort (WATCH-3), and running it would
not inform coverage of any surface this brief names.

## 5. Conventions for new tests (so architects place them consistently)

- **Location:** flat files under `server/__tests__/`, one per module/route
  group, matching the plan's own naming: `pace-tracking.test.js`,
  `plan-writeback.test.js`, `atomic-file.test.js` (or folded into
  `plan-writeback.test.js` — plan leaves this open), `detour-disposition.test.js`,
  `reconciliation.test.js`, plus **extensions** (not new files) to
  `plan-ingest.test.js`, `plans-api.test.js`, and `focus-inference.test.js`.
- **Harness pattern** (uniform across every existing file read for this
  report): `require("node:test")`'s `describe`/`it`/`before`/`after`
  (+ `beforeEach` where state resets per test), `node:assert/strict`, a
  per-suite tmp SQLite file via `process.env.DASHBOARD_DB_PATH` set *before*
  `require("../db")`, then `require("../<module>")`.
- **Deterministic seams over timing:** every LLM/spawn-touching module in
  this repo exports a `__inject*ForTest` hook (`__injectSpawnForTest` in
  `focus-audit.js`/`focus-inference.js`/`focus-summary.js`). The plan's
  `plan-writeback.js` already follows this with
  `__injectPreRenameHookForTest` — consistent, no new pattern needed.
  `reconciliation.js`'s LLM half should reuse the same `__injectSpawnForTest`
  shape rather than inventing a new one.
- **Route tests:** build the Express app via whatever this repo's existing
  route-test files use to mount it (see `plans-api.test.js`'s / `cc-config.test.js`'s
  top-of-file setup) and drive with `supertest`-style calls; assert
  structured `{ error }` bodies and status codes exactly as the existing
  validation tests do (`plans-api.test.js`'s "refresh validation: 400
  without cwd, 404 for unknown cwd" is the closest template for the new
  `/api/detours` and `/api/decision-queue` validation).
- **§9.2 ordering tests:** clone `focus-inference.test.js`'s two
  chronology-proxy tests (by name and shape) for each of the five new
  queries named in §3 above, rather than writing a single generic "sorts
  correctly" test — the existing tests' value is specifically the
  trap-defeating LIMIT case, which is easy to omit if reinvented from
  scratch.

## Files read for this report

- `intake/2026-08-01-build-project-manager/qa/change-brief.md`
- `intake/2026-08-01-build-project-manager/technical-plan.md`
- `PROJECT-CONTEXT.md`
- `package.json` (root), `client/package.json`
- `server/__tests__/plan-ingest.test.js`
- `server/__tests__/plans-api.test.js`
- `server/__tests__/focus-inference.test.js`
- `server/__tests__/session-liveness.test.js`
- `server/__tests__/focus-audit.test.js`
- `server/__tests__/focus-summary.test.js`
- `server/__tests__/cc-config.test.js`
- `server/lib/cc-mutate.js`
- `server/lib/plan-ingest.js`
- `server/index.js` (scheduler wiring block)
