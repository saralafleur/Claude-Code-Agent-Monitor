# Implementation Log — value-summary-tick

Worktree: `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor`
Implementer pass, executed against `build-task-list.md` in order (Tasks 1–14 implementation content; Tasks 15–21 are test/verification/doc/commit steps handled inline below and left for orchestrator sign-off on the commit itself).

## Task-by-task

**Task 1 — Schema (`server/db.js`).** Added `value_summary_sweep_state` /
`value_summary_generation_log` (+2 indexes) in a new `db.exec(...)` block next
to `focus_summary_access_log`, and three prepared statements
(`listValueSweepTargets`, `upsertValueSweepState`,
`insertValueSummaryGeneration`) next to `upsertValueUnitSummary`. Verified
additive: `git diff master -- server/db.js | grep -i "ALTER TABLE"` → empty.
`node -e "require('./server/db.js')"` loads clean.

**Task 2 — Chronology disposition (RED-FIRST).** Ran
`chronology-ordering.test.js` before adding the stub's disposition — observed
red (`server/lib/value-summary-tick.js has no disposition in
FILE_DISPOSITIONS`). Added `"server/lib/value-summary-tick.js": "scanned"`.
Re-ran → green.

**Task 3 — Composer split (`server/lib/value-summary.js`).**
`enrichPoolAltitudes` now returns `{ altitudes, states }`; added
`ALTITUDE_STATES = ["queued", "unavailable"]` export. Truth table implemented
exactly per DEC-11: LLM-unavailable → every miss `unavailable` (never
`queued`, even over-cap); LLM-available → in-cap misses that don't resolve
(spawn null / unparsable / model omitted the index) → `unavailable`; over-cap
misses → `queued`, never attempted. The single
`dbModule.stmts.upsertValueUnitSummary.run(...)` call site was not moved,
wrapped, or duplicated — same line, same lexical position inside
`enrichPoolAltitudes`. Rewrote the `MAX_UNITS_PER_PROMPT` comment against the
182-unit measurement and the `@file` overview to name two invokers/one
writer.

**Task 4 — Route (`server/routes/project-plans.js`).** Import changed to
destructured `const { enrichPoolAltitudes } = require("../lib/value-summary")`
(required by `assertSingleHome`). Route now does
`const { altitudes, states } = await enrichPoolAltitudes(...); res.json({
altitudes, states })`. No other behavior change (same validation, same
200-always contract, same ≤40 synchronous cap).

**Task 5 — i18n registry (RED-FIRST → GREEN → mutation-proved).** The
registry→locale check in `value-summary.test.js` was observed red (missing
`queued` key) before any locale edit. Added
`planLedger.pool.altitudes.queued` to all four locales (en "Queued", ko "대기
중", vi "Đang chờ", zh "排队中"). Re-ran both the server registry check and
client `i18n.test.ts` E1.1 → green. **Mandatory mutation proof**: deleted the
`queued` key from `ko/projectDetail.json`, re-ran E1.1 → observed red
(`projectDetail/ko: missing [planLedger.pool.altitudes.queued]`), restored →
green.

**Task 7 — Tick implementation (`server/lib/value-summary-tick.js`, new) +
CONSUMERS.** Full implementation per technical-plan.md step 5:
`listSweepTargets`, `runValueSummaryTickOnce` (overlap guard, per-project
try/catch/finally, `pending_after_sweep` re-derived from
`queued + unavailable` each sweep, broadcast only when `generated > 0`),
`startValueSummaryTick` (env-gated), `__injectPoolAssemblerForTest`,
`__resetTickStateForTest`. No pool-membership SQL, no second
`upsertValueUnitSummary` call, no `MAX_UNITS_PER_PROMPT` re-declaration in
this file. Added `"server/lib/value-summary-tick.js"` to `value-ledger.js`'s
`CONSUMERS`.

**Task 8 — C2.4 red-then-green (mandatory pairing).** After adding the
`CONSUMERS` entry, ran `ledger-metrics-parity.test.js` — observed **red**
(C2.4's expected array not yet updated: `totalCalls`-style mismatch on the
sorted-array `assert.deepEqual`). Updated C2.4's expected array (renamed the
test title too, since it now names three consumers) to include
`"server/lib/value-summary-tick.js"`. Re-ran → green.

**Task 9 — Register the tick (`server/index.js`).** Added the
`try { startValueSummaryTick(broadcast) } catch { console.warn(...) }` block
inside `startBackgroundServices()`, immediately after the reconciliation
registration, matching house style. `node -c server/index.js` — syntax clean.

**Task 11 — Structural guards (`single-writer-guard.test.js`, MANDATORY, all
five blocks red-proven by real injection).**
1. `upsertValueUnitSummary appears only in db.js and value-summary.js` (new).
2. `upsertValueUnitSummary.run( has exactly one lexical call site, inside
   enrichPoolAltitudes` (new).
3. `insertValueSummaryGeneration has exactly one production call site (tick)`
   (new).
4. `value-summary.js's exports have an explicit disposition at every
   consumer` (`assertSingleHome`, new).
5. `value-ledger.js's exports have an explicit disposition at the tick`
   (`assertSingleHome`, new — `absent` list is the module's full actual
   export set minus `assembleValuePool`, verified against
   `module.exports` in `value-ledger.js`).

   Reused the file's existing `scanFiles` walker and the shared
   `assertSingleHome` helper (`server/__tests__/helpers/single-home.js`) —
   **no new scope-derivation helper was written** (DEC-6).

   **Real injection red-proofs performed (not skipped as "already proven by
   the test author"):**
   - Injected `dbModule.stmts.upsertValueUnitSummary.run(...)` into the
     `/altitudes` route handler → block 1 ("appears only in db.js and
     value-summary.js") went red (`project-plans.js` now matched the scan).
     Removed → green. (Block 2's own regex only scans `value-summary.js`'s
     own source per its literal spec, so it did not itself flag this
     particular injection site — block 1 is the guard that catches a
     cross-file rogue call, and it did.)
   - Injected `dbModule.stmts.insertValueSummaryGeneration.run(...)` into the
     same route → block 3 went red (`db.js`/`value-summary-tick.js` expected,
     `project-plans.js` found). Removed → green.
   - Injected `const { computePlanHealth } = require("./value-ledger")` into
     the tick → block 5 went red (undisclosed export). Removed → green.
   - Injected `const { buildPrompt } = require("./value-summary")` into the
     tick → block 4 went red. Removed → green.

   Also had to fix two false-positive matches caused by my OWN new
   documentation text (not the guard's fault): a `@file`-header sentence in
   `value-summary-tick.js` and a doc-comment sentence in `value-summary.js`
   both literally contained the string `upsertValueUnitSummary.run(`, which
   the guard's regex (which does not strip `/** */` block comments) matched
   as a second call site. Reworded both comments to describe the invariant
   without repeating the literal call-site text. This is a real, load-bearing
   finding from the guard, not a guard bug.

**Task 13/14 — Client types + component.**
`client/src/lib/types.ts`: added `ValueAltitudesUpdatedPayload`,
`ProjectPlanUpdatedPayload`, `ValueClaimUpdatedPayload`; extended
`WSMessage.type`/`data` unions; updated both doc-comment maps (the `type`
field's inline map and the module `@file` "WebSocket type → payload index").
`client/src/lib/api.ts`: `altitudes()`'s response type gained
`states?: Record<string, "queued" | "unavailable">`; JSDoc rewritten off the
old "absence means unavailable" framing.
`client/src/components/PlanLedgerPanel.tsx`: `Altitude` type widened to
`{project,stakeholder} | "queued" | "unavailable" | undefined`; `AltitudeText`
gained the `queued` branch (any other non-object string still falls back to
`unavailable`); the altitude-fetch effect now maps
`res.states?.[u.id] === "queued" ? "queued" : "unavailable"` instead of
`null`, including the network-failure catch branch; added the out-of-registry
`console.warn` for a `states` value outside `["queued","unavailable"]` (T-E
trap coverage). No `eventBus` import, no new `useEffect` for subscription
(DEC-8/OPEN-3 — confirmed `grep -rn "eventBus"
client/src/components/PlanLedgerPanel.tsx` returns nothing).

**Docs (CLAUDE.md's automatic `update-project-docs` obligation).** Updated
`ARCHITECTURE.md` (Portfolio Plan Lifecycle & Value Ledger section: rewrote
the altitude-synthesis paragraph for the `states` field, added a new
"Background overflow sweep" paragraph with the two tables and three env
vars), `docs/DATABASE.md` (new `value_summary_sweep_state` /
`value_summary_generation_log` section with schema, columns, indexes),
`docs/API.md` (route table row, rewritten altitude-synthesis prose, new
"Background overflow sweep" prose, new `#### value_altitudes_updated`
WebSocket message section, updated the "additive message types" sentence).
`server/openapi.js` was **not** touched — `openapi-contract.test.js` still
passes untouched, confirming no contract regression from the additive
`states` field. `npm run mcp:typecheck`/`mcp:build` were **not run** — no
`mcp/` surface was touched by this build.

## Verification

- `bash .claude/skills/file-headers/scripts/check-headers.sh` → exits 0.
- `git diff master -- server/db.js | grep -i "ALTER TABLE"` → empty.
- `grep -rn "assert.ok(true" server/__tests__/` → empty.
- `grep -rn "|| true" server/__tests__/` → empty.
- `cd client && npx tsc --noEmit` → clean except two pre-existing errors
  **inside the already-written test file**
  (`PlanLedgerPanel.test.tsx:514-515`, `warnSpy.mock.calls[0]` possibly
  undefined — a vitest mock-typing strictness issue in test code, not product
  code, not introduced by this build's product changes).
- `npm run test:server`: baseline (before this build's product code) was
  1610 tests / 1577 pass / **33 fail**. Final: 1614 tests / 1603 pass /
  **11 fail**. All 11 remaining failures are pre-existing test-fixture bugs
  in already-written test files (see "Test-file issues found" below) — not
  product-code defects, and not fixable without editing a test file.
- `npm run test:client`: 795 tests / **794 pass** / 1 fail (again a
  test-fixture bug in an already-written test, see below). No
  `screens.snapshot.test.tsx` diff — 19/19 unchanged.
- `node --test server/__tests__/openapi-contract.test.js` → 4/4 pass,
  unaffected by the additive `states` field.

## Test-file issues found (NOT fixed — per instructions, product code only,
never edit a test to make it pass; reporting instead)

All three are in already-written test files this build was told not to
modify. Each was verified, via a scratch reproduction using the actual
product code, to be a bug in the test's own fixture/assertion construction —
not a product-code gap:

1. **`server/__tests__/value-summary.test.js` :: "two overlapping calls for
   the same unitKey leave exactly one valid row and never throw" (T-A).** The
   injected spawn callback does `return deferredSpawn(envelope(...), 10);` —
   but `deferredSpawn(stdout, ms)` **returns a factory function**, not a
   child. The callback needs to invoke it:
   `return deferredSpawn(envelope(...), 10)();`. As written, `probeClaudeCli`
   calls `child.on("error", ...)` on a plain function, which throws
   synchronously inside the `new Promise` executor (rejecting the probe), so
   `enrichPoolAltitudes` never reaches the spawn/parse path at all. This is
   unrelated to the composer split; no product-code change can accommodate a
   malformed injected "child" while still exercising the real concurrent-spawn
   behavior the test is meant to prove.

2. **`server/__tests__/value-summary-tick.test.js`'s `makeSweptProject`
   helper never inserts a `project_paths` row** for the projects it creates.
   `listValueSweepTargets` (per `technical-plan.md` step 2 / DEC-2: "Sweep
   scope: all `project_paths`-tracked projects eligible") requires an INNER
   JOIN against `project_paths`, by design — a project with no path mapping
   can never produce a non-empty pool anyway, and DEC-2 explicitly bounds
   sweep scope to path-tracked projects to avoid wasted git-walk cost on
   ghost projects. Verified by hand (seeding `stmts.insertProjectPath` before
   calling `runValueSummaryTickOnce`) that with a `project_paths` row present,
   the tick correctly returns `{swept:1, projects:[{project_id, generated:40,
   queued:45, unavailable:0}]}` and writes a log row matching the T-C test's
   exact expected numbers (`pool_size:85, cache_hits:0, generated:40,
   queued:45, unavailable:0`). This blocks 10 of the file's 15 `it()` cases
   (overlap guard, per-tick bound, rotation, all 3 overflow-drain cases,
   1 of 3 broadcast-discipline cases, failure isolation, T-C, audit log flow
   proof) — they all resolve `{swept: 0, projects: []}` because
   `listSweepTargets` finds no eligible project. The fix is one line in the
   test file: `stmts.insertProjectPath.run(id, <unique cwd per project>);`
   inside `makeSweptProject`. (Two of the "broadcast discipline" cases and
   both "environment wiring" cases pass, but the "zero broadcasts" ones pass
   vacuously for the same reason — zero projects swept, not zero-because-
   the-sweep-correctly-generated-nothing. The "flow proof (AC-1)" case's
   body is an empty placeholder with no assertions and passes trivially
   either way.)

3. **`client/src/components/__tests__/PlanLedgerPanel.test.tsx` :: "a
   45-unit pool renders Queued and Not available distinguishably in the same
   render (AC-2, T-D)".** The fixture assigns identical `project: "P"` text
   to 39 units, then asserts `expect(screen.getByText("P")).toBeInTheDocument()`
   — `getByText` requires exactly one match and throws on 39. The two
   load-bearing assertions immediately above it in the same test
   (`getAllByText(/Queued/i).length === 10` and
   `getAllByText(/Not available/i).length === 2`) **do pass**, which is the
   actual AC-2 same-render-distinguishability assertion this test exists to
   prove. The fix is `getAllByText("P")[0]` (or a single unique project
   string) in the test file.

None of the three was edited. All three were independently verified (via
manual reproduction against the shipped product code) to be test-authoring
bugs rather than product defects, consistent with this build's other
red-first evidence (all guard mutation-proofs, all destructure/truth-table
cases, all route cases, the i18n chain, and 5 of value-summary-tick.test.js's
own cases went from observed-red to green exactly as designed).

## Build-reviewer loop-back fix pass (review.md B2/S1/S3/S5/S6)

Scope: PRODUCT CODE ONLY, per the loop-back instructions. B1 (vacuous Case 10
test), S2 (deleted route fixtures), S4 (misleadingly named test) are all test
files — left untouched for the build-test-author pass. N2 (dead `before()`
hook) is also a test file — left untouched. N4 (no double-start guard) left
as-is per the review's own note that it's "not a regression."

**B2 (blocker) — `server/lib/value-summary-tick.js`, the errored-sweep
`pending_after_sweep = 0` clobber.** Before: the `catch {}` block discarded
the error with no binding/log, and the `finally` unconditionally wrote
`upsertValueSweepState.run(projectId, nowIso, queued + unavailable)` — on the
error path `queued`/`unavailable` are still at their zero initializers, so a
permanently-failing project reported `pending_after_sweep = 0` forever,
indistinguishable from "fully drained." After:
- `catch (err)` now binds and logs: `console.warn(\`value summary sweep
  failed for project ${projectId}:\`, err.message)`.
- Added a new prepared statement in `server/db.js`,
  `upsertValueSweepStateKeepPending`, that INSERTs `pending_after_sweep = 0`
  only for a project's first-ever row (nothing to clobber) and on conflict
  updates **only** `last_swept_at` — `pending_after_sweep` is left standing.
  On `outcome === "error"` the tick now calls this statement instead of
  `upsertValueSweepState`, so an errored sweep advances rotation without
  touching the last known-good pending count.
- `poolSize = 0` is now also set inside the `catch` block, so a MIXED failure
  (assembleValuePool succeeds, `enrichPoolAltitudes` throws — `poolSize` was
  already set to `units.length` before the throw) writes an audit-log row
  with `pool_size = 0, cache_hits = generated = queued = unavailable = 0`,
  satisfying `db.js`'s unconditional four-term partition invariant
  (`cache_hits + generated + queued + unavailable === pool_size`) instead of
  breaking it. Chose "zero poolSize on error" over "add an exception to the
  schema comment" per the review's "smaller, more consistent" guidance — the
  invariant stays a true unconditional statement with no carve-out to
  document or forget.

**S1 (should-fix) — the `finally`'s own DB writes were unguarded.** Before:
the rotation-advance write, the audit-log insert, and the broadcast all lived
inside a `finally` block with no try/catch of their own; a `finally` cannot
be caught by its own preceding `catch`, so a write failure there (realistic
case: `SQLITE_BUSY` on the shared `DB_PATH`) would throw out of the `for`
loop, abort the rest of the sweep, and leave that project's rotation
permanently first (`listValueSweepTargets` sorts never-swept/never-advanced
first), starving the fleet behind it. After: removed the `finally`;
replaced it with a plain statement block immediately following the
try/catch (runs unconditionally either way, same as a `finally` would, but
is no longer *itself* a `finally`), wrapped in its own `try { ... } catch
(err) { console.warn(...) }`. Within that block, the rotation-advance write
(`upsertValueSweepState` / `upsertValueSweepStateKeepPending`) now runs
**before** `insertValueSummaryGeneration`, per the review's exact
recommendation, so a failure on the audit-log insert can no longer prevent
the rotation timestamp from having already been committed (better-sqlite3
`.run()` calls auto-commit individually).

**S3 (should-fix) — `server/routes/project-plans.js`, a route-rejected unit
landing in neither map.** Before: `for (const u of units) { if (!u ||
typeof u.unit_key !== "string" || !u.unit_key) continue; if
(!VALUE_SOURCES.includes(u.value_source)) continue; ... }` silently dropped
both kinds of malformed entries from `clean` before `enrichPoolAltitudes`
ever saw them, so their keys appeared in neither `altitudes` nor `states`.
After: split the two rejection cases. A unit with a valid, non-empty string
`unit_key` but an unrecognized `value_source` is now recorded as
`states[u.unit_key] = "unavailable"` before the loop moves on (merged into
the final response as `{ ...states, ...enriched.states }`, with the
composer's own `enriched.states` spread last so it wins on any collision —
not reachable today, since a rejected unit never reaches `clean` and
therefore can never also appear in `enriched.states`, but this ordering
keeps the composer's own truth authoritative if that ever changes). A unit
with no
usable `unit_key` at all (missing, non-string, or empty) is still dropped:
there is no key to report a state against, so "neither map" is the only
representable option for that one case, and I judged that scoping — not a
bug — consistent with DEC-11's truth table, which is defined per-unit-key.
Updated the route's doc comment and `POST /altitudes` block comment to state
this explicitly instead of the previous "silently dropped" phrasing that S2
flagged.

**S5 (should-fix, docs) — `server/README.md` was missing the three new env
knobs and the whole `startValueSummaryTick` service.** Added
`DASHBOARD_VALUE_SUMMARY_TICK_MODE`, `DASHBOARD_VALUE_SUMMARY_TICK_MS`, and
`MAX_PROJECTS_PER_TICK` to the `# Background services` env block (next to
the existing `DASHBOARD_VALUE_SUMMARY_MODEL` line). Added a full
`startValueSummaryTick` paragraph (mirroring `startFocusInference`'s level
of detail: rotation ordering, per-project fail-safety, the
`pending_after_sweep` re-derivation guarantee, the audit-log partition
invariant, the scheduler shape, and all three knobs with defaults) placed
after the `startFocusInference` paragraph and before `lib/focus-summary.js`
(background-tick services grouped together, request-time composer last).
Also updated the pre-existing `value-summary.js` paragraph (line ~700, which
still described the pre-DEC-10 request-only, no-`states` contract) to
mention the `{ altitudes, states }` split, the DEC-11 truth table in one
sentence, and a pointer to the new sweep for cap overflow.

**S6 (should-fix) — `server/lib/value-summary.js`, a duplicate `unitKey`
straddling the cap landing in both maps.** Before: `misses` (built from the
cache-partition loop) was sliced directly into `batch`/`overflow`; a
duplicate key present in both slices would get `states[key] = "queued"` from
the overflow copy and `altitudes[key]` from the in-batch copy, with nothing
downstream clearing the stale `queued` entry. After: added one line right
after the `if (misses.length === 0) return ...` early-return and before the
`llmAvailable()` gate: `const dedupedMisses = [...new Map(misses.map((u) =>
[u.unitKey, u])).values()]`, and changed every downstream reference
(`llmAvailable` branch's loop, `batch`/`overflow` slices) from `misses` to
`dedupedMisses`. Placed before the LLM-availability check so the DEC-11
"outage marks every miss including over-cap ones" behavior (verified clean
in review.md) still applies to the deduped set, not the raw one.

**Opportunistic (my judgment, per the review's explicit invitation on
N1):** Clamped `MAX_PROJECTS_PER_TICK` to `Math.max(1, Math.floor(...))` in
`runValueSummaryTickOnce` — an empty/typo'd env var was coercing to `LIMIT
0` (sweeps nothing, forever, silently) and a negative value was hitting
SQLite's "negative LIMIT means unlimited" behavior (one tick sweeping the
entire fleet, one git walk + one LLM spawn per project). Cheap, one line,
directly prevents a footgun in the same function I was already fixing.
Also fixed N3 (`let generatedKeys = []` → `const`, never reassigned) as a
zero-risk drive-by in the same block. Left N2 (test file) and N4 (larger,
not requested, explicitly noted as "not a regression") alone.

**Verification.** Ran the full server suite after all fixes:
`node --test server/__tests__/value-summary-tick.test.js` → 17/17 pass
(unchanged count — no test files were touched);
`node --test server/__tests__/value-summary.test.js` → 24/24 pass;
`npm run test:server` → 1616/1616 pass, 0 fail. Ran
`bash .claude/skills/file-headers/scripts/check-headers.sh` → clean (no new
files created, existing headers on `server/db.js`,
`server/lib/value-summary.js`, `server/lib/value-summary-tick.js`,
`server/routes/project-plans.js` were already present and untouched).

**Not fixed here (explicitly out of scope for this pass):** B1 (empty-body
Case 10 `it()`), S2 (deleted malformed-entry fixtures), S4 (misnamed
backward-compat test) — all three are test-file defects per the review and
belong to the build-test-author pass, not this implementer pass.
