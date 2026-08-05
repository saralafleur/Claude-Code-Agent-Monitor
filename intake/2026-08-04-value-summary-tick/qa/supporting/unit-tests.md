Assertions and cases are written to be usable directly by the implementer.
Where the technical plan (`intake/2026-08-04-value-summary-tick/technical-plan.md`,
steps 3/4/6/8/9/10/13/14) already names an exact case or procedure, this
document does not re-derive it — it locates it precisely and states the exact
assertion text, fixture, and red-first proof.

## 0. Grounding (this project's actual conventions, verified against the live tree)

- **Server**: `node:test` + `node:assert/strict`. No mocking library — fakes
  are hand-rolled (`fakeSpawn`, `envelope()` in
  `server/__tests__/value-summary.test.js`) and injected through the seam
  `__injectSpawnForTest` exported by `server/lib/focus-inference.js`. The new
  tick needs its own seam, `__injectPoolAssemblerForTest`, exported by
  `server/lib/value-summary-tick.js` per the technical plan.
- **Client**: Vitest + Testing Library. `client/src/components/__tests__/PlanLedgerPanel.test.tsx`
  mocks `api.ts`'s `projectPlans.altitudes` via `vi.fn()`
  (`mockAltitudesMock`) and resolves/rejects it per test.
- **Structural guards**: `server/__tests__/single-writer-guard.test.js`'s
  `scanFiles(dir, pattern)` walker (regex-scans `.js` files, excludes
  `node_modules`/`dist`/`__tests__`/`test`) and
  `server/__tests__/helpers/single-home.js`'s `assertSingleHome(sharedModulePath, consumers, options?)`
  (derives a shared module's export set via `Object.keys(require(...))`, and
  requires every consumer to give each export an explicit `shared`/`private`/`absent`
  disposition, checked against **that consumer's own** computed relative
  `require(...)` specifier).
- **§9.3 VACUOUS-GUARD discipline** (this project's own term, named in the
  change brief and technical plan §6): a guard is not "covered" until it has
  been observed to fail under the exact mutation it exists to catch. Every
  guard test below states that mutation.
- **§9.7 HAND-SCOPED STRUCTURAL SCAN**: guard scope must be derived from the
  artifact (`Object.keys(require(...))`, `fs.readdirSync(...)`), never a
  hand-typed list. All new guard code below reuses existing derivation, per
  the technical plan's explicit instruction not to write a second
  scope-derivation helper.

---

## 1. `server/__tests__/value-summary-tick.test.js` (NEW)

Header comment per `.claude/rules/file-headers.md` before any code. Mirrors
`value-summary.test.js`'s harness: real in-process `createApp()`/`startServer()`
is **not** required here (the tick calls `runValueSummaryTickOnce(dbModule, ...)`
directly, no HTTP layer) — use `../db` directly against an isolated
`DASHBOARD_DB_PATH`, exactly as `value-summary.test.js` does at file top.
Reuse `makeProject()` and `unit()` from `value-summary.test.js` (either
import if exported, or copy verbatim per that file's existing pattern — this
repo does not currently export test helpers cross-file, so copying is the
established convention; do not introduce a new shared test-helpers module for
this alone).

Additional fixture helper needed (does not exist yet, add locally):

```js
async function makeSweptProject(name, { lastSweptAt = null } = {}) {
  const id = await makeProject(name);
  stmts.insertProjectPath.run(id, `/tmp/${id}`); // listValueSweepTargets requires a project_paths row
  if (lastSweptAt) stmts.upsertValueSweepState.run(id, lastSweptAt, 0);
  return id;
}
```

Import surface:
```js
const {
  runValueSummaryTickOnce,
  listSweepTargets,
  startValueSummaryTick,
  __injectPoolAssemblerForTest,
  __resetTickStateForTest,
} = require("../lib/value-summary-tick");
const { __injectSpawnForTest } = require("../lib/focus-inference");
```

`beforeEach`: `__injectSpawnForTest(null)`, `__injectPoolAssemblerForTest(null)`,
`__resetTickStateForTest()`, `delete process.env.MAX_PROJECTS_PER_TICK`,
`delete process.env.DASHBOARD_VALUE_SUMMARY_TICK_MS`,
`delete process.env.DASHBOARD_VALUE_SUMMARY_TICK_MODE`,
`delete process.env.DASHBOARD_FOCUS_INFER_MODE`,
`db.exec("DELETE FROM value_unit_summaries")`,
`db.exec("DELETE FROM value_summary_sweep_state")`,
`db.exec("DELETE FROM value_summary_generation_log")`.

### Case 1 — Overlap guard (`it("a concurrent tick call is skipped while one is in flight")`)

**Setup:** one swept-eligible project. Inject a `poolAssembler` via
`__injectPoolAssemblerForTest` that returns a manually-controlled `Promise`
(resolve deferred to a captured `resolve` function), so the first
`runValueSummaryTickOnce(...)` call is provably still in flight.

**Assertions:**
- Call `runValueSummaryTickOnce(dbModule, {})` (don't await); immediately call
  it a second time and await that second call.
- `assert.deepEqual(secondResult, { skipped: "overlap" })`.
- The injected `poolAssembler` was invoked **exactly once** (a counter closed
  over inside the injected function) — proves the second call never reached
  the per-project sweep loop, not just that it returned early.
- Resolve the deferred promise, `await` the first call, assert it completed
  normally (`swept === 1`).

**Red-first / mutation-proof (§9.3, required before sign-off):** temporarily
delete the `if (running) return { skipped: "overlap" };` guard (or the
`running = true` assignment) from `value-summary-tick.js`. Re-run this test —
it must fail (`poolAssembler` called twice, `secondResult` not
`{ skipped: "overlap" }`). Restore the guard, confirm green again. This is
the exact mutation the technical plan step 10 case 1 names ("remove the
`running` guard, see two spawns, restore").

### Case 2 — Per-tick project bound (`it("sweeps at most MAX_PROJECTS_PER_TICK projects per call")`)

**Setup:** seed 5 eligible projects (`makeSweptProject` x5, all
`lastSweptAt: null`). `process.env.MAX_PROJECTS_PER_TICK = "2"`. Inject a
`poolAssembler` returning `{ units: [] }` for every project (cheapest
possible sweep — no LLM path exercised here).

**Assertions:**
- `const result = await runValueSummaryTickOnce(dbModule, {});`
- `assert.equal(result.swept, 2)`.
- `db.prepare("SELECT COUNT(*) c FROM value_summary_sweep_state").get().c === 2`.
- `db.prepare("SELECT COUNT(*) c FROM value_summary_generation_log").get().c === 2`.

**Red-first:** before `value-summary-tick.js` exists / before the `.slice(0, maxProjects)`
(or equivalent `LIMIT` bound) is applied, this fails because either the
module doesn't exist or all 5 rows get swept/logged. Passes once the bound is
enforced.

### Case 3 — Least-recently-swept rotation (`it("sweeps in least-recently-swept order and is starvation-free")`)

**Setup:** 3 projects:
- `pNever = await makeSweptProject("never")` — no sweep-state row.
- `pOld = await makeSweptProject("old", { lastSweptAt: "2020-01-01T00:00:00.000Z" })`.
- `pRecent = await makeSweptProject("recent", { lastSweptAt: new Date().toISOString() })`.

**Assertions (ordering):**
- `const targets = listSweepTargets(dbModule, 3);`
  `assert.deepEqual(targets.map((t) => t.project_id), [pNever, pOld, pRecent]);`
  — never-swept sorts first, then oldest timestamp, then most recent last.

**Assertions (starvation-free, across ticks):**
- `process.env.MAX_PROJECTS_PER_TICK = "1"`; inject `poolAssembler` returning
  `{ units: [] }`.
- Call `runValueSummaryTickOnce` three times in sequence (each preceded by
  `__resetTickStateForTest()` is not needed since each call completes before
  the next starts — `await` each one). Collect the swept `project_id` from
  each call's `result.projects[0].project_id`.
- `assert.deepEqual(sweptOrder, [pNever, pOld, pRecent])` — the third call
  must not revisit `pNever` before `pRecent` has been swept once. This is the
  literal DEC-2 starvation-free property.

**Red-first:** an `ORDER BY p.id ASC` (row-id-as-chronology-proxy, this
project's own named §9.2 failure mode) or an `ORDER BY s.last_swept_at DESC`
mistake would both make this test fail on the ordering assertion — that is
the point of asserting the exact array, not just "3 distinct projects were
swept."

### Case 4 — Overflow drain (`it("drains a 45-unit overflow project across two ticks")`)

This is the direct regression fixture for "182 units, 3 reloads" (technical
plan step 10 case 4) and the pool-size half of AC-1.

**Setup:** one project (`makeSweptProject`). Inject `poolAssembler` to return
`{ units: <45 unit() fixtures with distinct unitKeys> }` on every call (same
45 both ticks — this is what proves the SECOND tick is really re-attempting
the previously-`queued` 5, not fabricating new ones). Inject a spawn via
`__injectSpawnForTest` returning a valid envelope resolving every requested
index (`fakeSpawn`/`envelope` from `value-summary.test.js`'s pattern).
`MAX_PROJECTS_PER_TICK` left at its default (only 1 project exists, so the
cap doesn't interfere).

**Assertions after tick 1:**
- `result.projects[0].generated === 40`, `.queued === 5`, `.unavailable === 0`.
- `db.prepare("SELECT pending_after_sweep FROM value_summary_sweep_state WHERE project_id=?").get(pid).pending_after_sweep === 5`.
- The generation-log row for this sweep: `pool_size=45, cache_hits=0, generated=40, queued=5, unavailable=0, outcome='ok', source='tick'`.

**Assertions after tick 2 (same 45 units, same project):**
- `result.projects[0].generated === 5`, `.queued === 0`, `.unavailable === 0`
  (the remaining 5 are now the only cache misses; the first 40 hit
  `value_unit_summaries`'s cache via `enrichPoolAltitudes`'s existing unitKey
  caching, so they contribute to `cache_hits`, not `generated`, on tick 2).
- `pending_after_sweep === 0` after tick 2.
- `db.prepare("SELECT COUNT(*) c FROM value_unit_summaries").get().c === 45`
  — all 45 rows exist by the end of tick 2 (the actual "finishes the pool
  unattended" claim, checked at the DB, not just the return value).

**Red-first:** before `enrichPoolAltitudes`'s `{ altitudes, states }` split
exists, or before the tick calls it per-project, this fails outright
(function doesn't exist / wrong return shape). Once built, a bug that
re-slices `misses.slice(0, MAX_UNITS_PER_PROMPT)` incorrectly (e.g. always
slicing from index 0 instead of respecting what's already cached) would make
tick 2 re-report `generated: 40` instead of `5` — this test catches that.

### Case 5 — Broadcast discipline (`it("broadcasts once per non-zero sweep, never on an all-cached or LLM-off sweep")`)

**Setup A (generates something):** one project, one uncached unit, a working
spawn. `const events = []; const broadcast = (type, payload) => events.push({ type, payload });`

**Assertions A:**
- `await runValueSummaryTickOnce(dbModule, { broadcast });`
- `assert.equal(events.length, 1);`
- `assert.equal(events[0].type, "value_altitudes_updated");`
- `assert.deepEqual(Object.keys(events[0].payload).sort(), ["pending", "project_id", "unit_keys"]);`
- `assert.equal(events[0].payload.project_id, pid);`
- `assert.ok(Array.isArray(events[0].payload.unit_keys) && events[0].payload.unit_keys.length === 1);`

**Setup B (zero generation — everything already cached):** same project,
re-run `runValueSummaryTickOnce` a second time with the same `broadcast`
spy reset to `[]` — the unit from setup A is now cached.

**Assertions B:** `assert.equal(events.length, 0)` — no broadcast on a
zero-generation sweep, per the technical plan's explicit
`if (generated > 0 && broadcast) broadcast(...)` requirement.

**Setup C (zero generation — LLM off):** a fresh project with one uncached
unit, `process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"`.

**Assertions C:** `assert.equal(events.length, 0)` again — reuses the same
spy-reset pattern; this is also a DEC-11 cross-check (LLM-off misses are
`unavailable`, never `generated`).

**Red-first:** a broadcast placed outside the `generated > 0` guard (e.g.
unconditionally per swept project) fails Setup B/C; a broadcast with the
wrong payload shape (e.g. missing `pending`) fails the key-set assertion.

### Case 6 — Failure isolation (`it("one project's failure does not starve or block the rest of the rotation")`)

**Setup:** two projects, `pBad` and `pGood`. Inject `poolAssembler` as
`(dbModule, project) => project.id === pBad ? Promise.reject(new Error("boom")) : Promise.resolve({ units: [] })`.
`MAX_PROJECTS_PER_TICK` left high enough to sweep both in one tick (or
`= "2"` explicitly).

**Assertions:**
- `runValueSummaryTickOnce` does not throw / does not reject.
- A `value_summary_generation_log` row exists for `pBad` with
  `outcome = 'error'`.
- A `value_summary_sweep_state` row exists for `pBad` with a fresh
  `last_swept_at` (i.e. **not** null, and equal to/after the tick's start
  time) — proving `upsertValueSweepState` ran in the `finally`, not skipped
  by the thrown error.
- `pGood` was still swept in the same tick call: its `generation_log` row has
  `outcome = 'ok'`.

**Red-first:** move the `upsertValueSweepState.run(...)` call out of the
`finally` and into the try-body's normal-completion path only — this test
fails on the `last_swept_at` assertion for `pBad` (it stays null, or the row
is absent), proving the mutation the technical plan's Risks table names
("A pathological project stalls the rotation") is actually caught.

### Case 7 — Env wiring (`it("DASHBOARD_VALUE_SUMMARY_TICK_MS=0 and MODE=off both register no timers")`)

**Setup:** spy `setInterval`/`setTimeout` (wrap and count calls, or use
`node:test`'s `mock.method` on `global`) before calling `startValueSummaryTick(() => {})`.

**Assertions (two sub-cases, each isolated):**
- `process.env.DASHBOARD_VALUE_SUMMARY_TICK_MODE = "off";` → after calling
  `startValueSummaryTick`, assert the `setInterval`/`setTimeout` spies were
  **not** called.
- (reset mode) `process.env.DASHBOARD_VALUE_SUMMARY_TICK_MS = "0";` → same
  assertion.
- A third, non-disabled control case (no env override) asserts
  `setTimeout` **was** called once (the boot-delay timer) — this is the
  guard against a vacuously-true "no timer" assertion that would also pass
  if `startValueSummaryTick` were simply broken and never registered
  anything at all.

**Red-first:** before the `mode === "off"` / `TICK_MS <= 0` early returns
exist, both disabled sub-cases fail (a timer gets registered anyway).

### Case 8 — DEC-16 structural check (`it("does not re-derive pool membership; imports assembleValuePool as its sole composer")`)

**Setup:** `const src = fs.readFileSync(require.resolve("../lib/value-summary-tick"), "utf8");`
(comment-stripped the same way `single-writer-guard.test.js`'s
`applyDisposition` test strips comments, to avoid a false pass/fail from a
reference inside a comment).

**Assertions:**
- `assert.match(src, /\{[^}]*\bassembleValuePool\b[^}]*\}\s*=\s*require\(["']\.\/value-ledger["']\)/s)`.
- `assert.doesNotMatch(src, /FROM\s+project_paths/i)`.
- `assert.doesNotMatch(src, /FROM\s+detour_dispositions/i)`.
- `assert.doesNotMatch(src, /detectTrunkDrift/)`.
- `assert.doesNotMatch(src, /upsertValueUnitSummary/)` (the tick must never
  hold its own reference to the single writer — it only ever reaches it
  transitively through `enrichPoolAltitudes`).

**Red-first:** this test is meaningless as a structural scan until a rogue
implementation actually adds one of these strings — mutation-prove it once
by temporarily adding a throwaway `// FROM project_paths` non-comment-stripped
line (or a real dead `db.prepare("SELECT ... FROM project_paths")` call) to
`value-summary-tick.js`, confirm this test fails, then remove it.

---

## 2. `server/__tests__/value-summary.test.js` (extend)

### 2a. Mechanical updates to the 6 existing call sites (not new cases, must not regress)

Every existing `enrichPoolAltitudes(...)` call in this file currently reads
the return value directly as the altitudes map (e.g.
`first[u.unitKey].project`). Once `enrichPoolAltitudes` returns
`{ altitudes, states }`, each of the following lines needs a destructure —
listed so the implementer doesn't have to re-grep:
- "returns an empty map for an empty batch..." — `assert.deepEqual(await enrichPoolAltitudes(dbModule, []), { altitudes: {}, states: {} })` (not `{}` — the shape itself changed, and this is the exact place a lazy `assert.deepEqual(..., {})` would now silently under-check).
- "generates once, then serves the cache..." — `const { altitudes: first } = await enrichPoolAltitudes(...)`, same for `second`.
- "batches multiple misses into exactly one spawn" — destructure `{ altitudes: result }`.
- "spawns with DASHBOARD_VALUE_SUMMARY_MODEL..." — destructure `{ altitudes: result }`.
- "leaves a unit out of the result for a non-llm mode..." — this test's three
  `assert.deepEqual(await enrichPoolAltitudes(...), {})` calls all need to
  become `{ altitudes: {}, states: { [u.unitKey]: "unavailable" } }` per
  DEC-11 (a miss is no longer silently absent from both maps — it must now
  appear in `states`). **This is itself a real assertion upgrade, not just
  mechanical churn** — it directly encodes DEC-11's "never zero, never two"
  rule for the three miss reasons this test already exercises (mode off,
  probe fail, unparsable output).

### 2b. New DEC-11 truth-table cases

`it("a batch under the cap resolves fully into altitudes, with an empty states map")`
— 3 units, working spawn resolving all 3: `assert.deepEqual(result.states, {})`,
`Object.keys(result.altitudes).length === 3`.

`it("a 45-unit batch with the LLM available resolves 40 into altitudes and reports the remaining 5 as queued, never unavailable")`
— spawn resolves whatever indices are requested (envelope with 40 entries).
`assert.equal(Object.keys(result.altitudes).length, 40)`.
`assert.equal(Object.values(result.states).filter((s) => s === "queued").length, 5)`.
`assert.equal(Object.values(result.states).filter((s) => s === "unavailable").length, 0)`.

`it("a 45-unit batch with the LLM off reports all 45 as unavailable, including the over-cap ones — never queued (DEC-11 outage-vs-backlog)")`
— `process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"`, 45 units, no spawn
injected (assert none is attempted — reuse the "throw if called" pattern
from the existing empty-batch test).
`assert.deepEqual(result.altitudes, {})`.
`assert.equal(Object.keys(result.states).length, 45)`.
`assert.ok(Object.values(result.states).every((s) => s === "unavailable"))`.
This is the single highest-value DEC-11 case named explicitly in the change
brief's "Test-invariants at risk" section — it is the one truth-table edge
that a naive implementation (e.g. "cap the miss list first, then check LLM
availability per-slice") would get backwards.

`it("a parse failure marks only the attempted (in-cap) slice unavailable; anything past the cap stays queued, untouched by the failure")`
— 45 units, spawn returns unparsable stdout (`fakeSpawn({ stdout: "not json" })`).
`assert.equal(Object.keys(result.altitudes).length, 0)`.
`assert.equal(Object.values(result.states).filter((s) => s === "unavailable").length, 40)`.
`assert.equal(Object.values(result.states).filter((s) => s === "queued").length, 5)`.

`it("no unitKey ever appears in both altitudes and states, across every case above")`
— a small assertion helper run at the end of each of the four cases above
(or as one final combinatorial case reusing their fixtures):
```js
const altKeys = new Set(Object.keys(result.altitudes));
const stateKeys = new Set(Object.keys(result.states));
for (const k of altKeys) assert.ok(!stateKeys.has(k), `${k} in both altitudes and states`);
```
This is the mutual-exclusivity invariant named in the change brief
("Overloaded-absence / discriminated-state correctness — never zero, never
two").

`it("ALTITUDE_STATES is exactly ['queued','unavailable'] — the registry every truth-table branch above must stay inside")`
— `assert.deepEqual(require("../lib/value-summary").ALTITUDE_STATES, ["queued", "unavailable"])`,
plus, for every case above, `assert.ok(Object.values(result.states).every((s) => ALTITUDE_STATES.includes(s)))`.
This is the registry-completeness meta-check: if a third state value is ever
introduced, this line fails immediately rather than the truth-table tests
silently accepting an unrecognized string.

### 2c. Route-level fast-path non-regression (technical plan step 4, DEC-3/AC-1)

`it("POST /altitudes with 45 units still resolves the first 40 inline and returns queued for the rest")`
— same 45-unit fixture as 2b's LLM-available case, posted through the real
route. `res.status === 200`. `Object.keys(res.body.altitudes).length === 40`.
`res.body.states` has exactly 5 entries, all `"queued"`. This is the literal
codification of AC-1's "per-visit work stays bounded at ≤40" plus DEC-3's
"no read-only cutover, ≤40 cap unchanged."

`it("POST /altitudes response always includes a states key, even for a fully-resolved small batch")`
— reuse the existing "returns altitudes for a valid batch" fixture (1 unit,
fully resolved): `assert.deepEqual(res.body.states, {})` — additive-field
contract check (existing 2xx behavior unchanged, new field always present,
never `undefined`, so client code that does `res.states?.[id]` never throws
on an old-shaped absence vs. a genuinely-empty map).

---

## 3. `server/__tests__/single-writer-guard.test.js` (extend, DEC-6)

Add inside the existing `describe("Single-writer structural guard (§9.1 DERIVED-DUAL-VIEW)", ...)` block — do not create a new file or a new scope-derivation helper (per the technical plan's explicit instruction and this project's own §9.7 catalog entry against exactly that failure mode).

### 3a. `it("upsertValueUnitSummary appears only in db.js and value-summary.js")`
```js
const files = scanFiles(serverDir, /upsertValueUnitSummary/);
const prodFiles = files.filter((f) => !f.includes("__tests__") && !f.includes(".test.js"));
const fileNames = prodFiles.map((f) => path.basename(f)).sort();
assert.deepEqual(fileNames, ["db.js", "value-summary.js"]);
```
**Red-first:** add a throwaway second reference to `upsertValueUnitSummary`
in `server/routes/project-plans.js` (even just a comment referencing the
identifier is enough to prove the regex fires — but for the real mutation
proof use a live reference, see 3f below). Restore.

### 3b. `it("upsertValueUnitSummary.run( has exactly one lexical call site, inside enrichPoolAltitudes")`
Reuse the comment-stripping + brace-matching technique from this file's
existing `applyDisposition` test (lines 119–147) but targeted at
`server/lib/value-summary.js` and the `enrichPoolAltitudes` function:
```js
const content = stripComments(fs.readFileSync(valueSummaryPath, "utf8")); // extract the existing strip logic into a small local helper if not already
const fnMatch = content.match(/function\s+enrichPoolAltitudes\s*\([^)]*\)\s*\{/);
assert.ok(fnMatch, "enrichPoolAltitudes should be defined in value-summary.js");
// ... same brace-walk as applyDisposition to get fnBody ...
const totalCalls = (content.match(/\bupsertValueUnitSummary\.run\s*\(/g) || []).length;
assert.equal(totalCalls, 1, "upsertValueUnitSummary.run( must have exactly one lexical call site — DEC-3/DEC-6: two legitimate invokers (route, tick), one writer.");
const callsInBody = (fnBody.match(/\bupsertValueUnitSummary\.run\s*\(/g) || []).length;
assert.equal(callsInBody, 1, "the single call site must be lexically inside enrichPoolAltitudes — DEC-3/DEC-6.");
```
**Red-first (§9.3, non-negotiable per the technical plan):** temporarily add
a second `dbModule.stmts.upsertValueUnitSummary.run(...)` line inside the
`POST /api/project-plans/altitudes` handler in
`server/routes/project-plans.js`. Run this test file — it must fail on the
`totalCalls === 1` assertion with the DEC-3/DEC-6 message. Remove the line,
confirm green. **This is explicitly the single highest-value test in the
whole change** per the change brief's own words — do not skip the injection
step.

### 3c. `it("insertValueSummaryGeneration has exactly one production call site")`
```js
const files = scanFiles(serverDir, /insertValueSummaryGeneration/);
const prodFiles = files.filter((f) => !f.includes("__tests__") && !f.includes(".test.js"));
assert.deepEqual(prodFiles.map((f) => path.basename(f)).sort(), ["db.js", "value-summary-tick.js"]);
```
**Red-first:** temporarily add a second
`dbModule.stmts.insertValueSummaryGeneration.run(...)` call inside the
`POST /altitudes` route handler. Confirm this test fails
(`["db.js", "project-plans.js", "value-summary-tick.js"]` ≠ expected two).
Remove, confirm green. Note in a code comment that WATCH-6 will
**deliberately** widen this expected array in the fast-follow that adds
request-path logging — so this guard going red at that point is expected and
must be a reviewed widening, not silently patched around.

### 3d. `it("value-summary.js's exports have an explicit disposition at every consumer")`
```js
assertSingleHome("../lib/value-summary", {
  "../routes/project-plans": {
    shared: ["enrichPoolAltitudes"],
    absent: ["buildPrompt", "parseOutput", "summaryModel", "MAX_UNITS_PER_PROMPT", "ALTITUDE_STATES"],
  },
  "../lib/value-summary-tick": {
    shared: ["enrichPoolAltitudes"],
    absent: ["buildPrompt", "parseOutput", "summaryModel", "MAX_UNITS_PER_PROMPT", "ALTITUDE_STATES"],
  },
});
```
(Confirm the exact export list of `value-summary.js` at build time via
`Object.keys(require("../lib/value-summary"))` — `assertSingleHome` derives
it itself, so this call fails loudly if a new export appears with no
disposition, which is the point.)
**Red-first:** this test cannot pass before `value-summary-tick.js` exists
(the `require.resolve` on the consumer path throws) — that failure mode
itself is an acceptable "red before green" for a net-new file, per the same
logic as the chronology-ordering case in §5 below. Once both files exist,
mutation-prove it once by having the tick import a second export (e.g.
`buildPrompt`) and confirming the `absent` check fails; then revert.

### 3e. `it("value-ledger.js's exports have an explicit disposition at the tick")`
```js
assertSingleHome("../lib/value-ledger", {
  "../lib/value-summary-tick": {
    shared: ["assembleValuePool"],
    absent: ["CONSUMERS", "unitKey", "rowToUnit", "computePlanHealth", "summarizeDeliveredValue", /* ...every other real export, confirmed via Object.keys at build time */],
  },
});
```
This is the structural half of DEC-16 (§3a of the change brief): the tick
imports the composer and declares it holds none of the others (no
`computePlanHealth`, no `CONSUMERS` mutation from inside the tick file, etc.).
**Red-first:** same "file doesn't exist yet" red as 3d; mutation-prove once
by having the tick additionally destructure `computePlanHealth` and
confirming the `absent` check fails, then revert.

### 3f. Consolidated red-proof note for this whole section
Per the technical plan step 9.6 and the change brief's explicit call-out:
run 3b and 3c's injection/removal cycle for real, in this order, in the same
sitting: (1) run the file green with no mutation, (2) inject, (3) run and
capture the failure output, (4) remove the injection, (5) run green again.
A guard "covered because a guard file exists" without this cycle observed is
this project's own named §9.3 VACUOUS-GUARD failure mode.

---

## 4. `server/__tests__/ledger-metrics-parity.test.js` — C2.4 (DEC-7)

**Change:** in the existing `it("C2.4: consumer registry marker — CONSUMERS names exactly the route and the CLI (DEC-16)", ...)`, update the expected array:

```js
assert.deepEqual(
  valueLedger.CONSUMERS.slice().sort(),
  ["bin/ccam.js (cmdLedger)", "server/lib/value-summary-tick.js", "server/routes/project-plans.js"].sort(),
  "a fourth consumer (MCP tools, an AGENT-PLAN.md export, a reconcile page — DEC-16) " +
    "must be a deliberate, reviewed addition to this list, never silent"
);
```

**Required sequencing (must actually be observed, not asserted from memory):**
1. Run `node --test server/__tests__/ledger-metrics-parity.test.js` **before**
   touching `value-ledger.js`'s `CONSUMERS` array. C2.4 must fail — the test
   file's expected array (3 entries) will not match the live `CONSUMERS`
   (still 2 entries) once the test edit above lands first, or vice versa;
   whichever edit lands first, run the suite once with only one side changed
   and confirm C2.4 is red. Capture the failure output as build evidence.
2. Add `"server/lib/value-summary-tick.js"` to `value-ledger.js`'s
   `CONSUMERS` (line 57).
3. Re-run — C2.4 must now be green.

**Red-first note:** this is the one case in this document where "red before
the fix, green after" is mandated by the technical plan itself (step 6, DEC-7)
as a build-order requirement, not merely a testing nicety — landing both
edits in the same commit without observing the intermediate red is explicitly
called a build defect in the change brief ("a QA plan that treats it as
covered because a guard file exists").

---

## 5. `server/__tests__/chronology-ordering.test.js` — `FILE_DISPOSITIONS` (DEC-9)

**Change:** add one entry to the existing `FILE_DISPOSITIONS` object (alphabetically among the `server/lib/*.js: "scanned"` entries, next to `value-ledger.js`/`value-summary.js`):
```js
"server/lib/value-summary-tick.js": "scanned",
```

**Required sequencing:**
1. Create `server/lib/value-summary-tick.js` (even a minimal stub is enough
   to trigger the scan — the derivation lists every `.js` file under
   `server/lib/`, not just ones with content).
2. Run `node --test server/__tests__/chronology-ordering.test.js` **before**
   adding the `FILE_DISPOSITIONS` entry above. It must fail with the message
   `server/lib/value-summary-tick.js has no disposition in FILE_DISPOSITIONS`.
   If it does *not* fail, `derivedFiles`'s `fs.readdirSync(libDir, ...)` scan
   has regressed — stop and fix that before continuing (this outranks the
   feature itself, per QA §6 as cited in the technical plan).
3. Add the entry, re-run to green.

**Scan-scope claim, independently verified for this document (not taken on
faith, per the change brief's own instruction):** confirmed directly against
the live `chronology-ordering.test.js` —
`bulkInsertTables = ["events", "focus_inferences", "detour_dispositions", "decision_queue"]`
(line 268). `project_paths` and `projects` are **not** in this list, so
`listValueSweepTargets`'s `LIMIT ?` query (which only joins `project_paths`/
`projects`/`value_summary_sweep_state`) is correctly outside this scan's
enforcement scope — no `GRANDFATHERED_QUERIES` entry is needed, as the
technical plan claims. No test change is needed to prove this beyond the
`"scanned"` disposition itself; the static scan (lines 285+) will run its
literal-extraction pass over the new file automatically once dispositioned,
and it is the `bulkInsertTables` list, not a per-file exemption, that
determines whether `listValueSweepTargets`'s SQL is flagged.

---

## 6. `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (extend, DEC-10/DEC-11)

### 6a. Update the 3 existing altitude tests (must still pass under the hybrid shape)

- `"shows a generating placeholder for Project/Stakeholder before altitudes resolve, then the resolved text"`
  (line 370): no assertion changes required — `resolveAltitudes({ altitudes: {...} })`
  still resolves a truthy altitude for the one unit, so the new `states`
  branch in the effect is never reached. Add one line confirming the
  contract explicitly: `expect(screen.queryByText(/Queued/i)).toBeNull();`
  (this unit was never queued/unavailable — it resolved).

- `"shows an unavailable placeholder when a unit is missing from the altitudes response"`
  (line 411): **keep the mock exactly as-is** — `mockAltitudesMock.mockResolvedValue({ altitudes: {} })`,
  i.e. **no `states` key at all** in the mocked response. This is now a
  deliberate backward-compatibility case, not just an omission: it proves
  DEC-11's client fallback (`res.states?.[u.id] === "queued" ? "queued" : "unavailable"`)
  renders exactly today's copy when talking to a server that predates
  `states` (an old server, or a live tab mid-upgrade). Add a comment in the
  test naming this explicitly, and keep the existing assertion
  (`getAllByText(/Not available/i).length === 2`) unchanged — this test's
  value is now precisely that it did **not** need to change.

- `"requests altitudes exactly once for a stable unit set..."` (line 428):
  no assertion changes needed; unaffected by the state shape.

### 6b. New test — AC-2 same-render distinguishability (technical plan step 14, the DoD's explicit checklist item)

`it("renders Queued and Not available as distinguishable states in the same render (AC-2)")`

**Setup:** 45 units in the pool fixture (`makeUnit()` x45 with distinct
`id`s — reuse whatever multi-unit fixture pattern the pool-mock setup in
this file already uses for single units, generalized to a loop).
`mockAltitudesMock.mockResolvedValue({ altitudes: <40 resolved: units[0..38] plus one deliberately-failed in-cap unit units[39] excluded>, states: { [units[39].id]: "unavailable", [units[40].id]: "queued", ..., [units[44].id]: "queued" } })`
— i.e. 39 resolved, 1 in-cap failure (`unavailable`), 5 over-cap (`queued`).

**Assertions:**
- `expect(screen.getAllByText(/Queued/i).length).toBeGreaterThan(0);`
- `expect(screen.getAllByText(/Not available/i).length).toBeGreaterThan(0);`
- Both assertions must pass **in the same `render()`/`waitFor()` block** —
  no unmount/remount between them (that is the literal "same render" AC-2
  requires, guarding against a lazy two-separate-tests implementation that
  would miss a bug where the two states clobber each other in one pass).
- At least one resolved unit's actual text (e.g. `units[0]`'s mocked
  `project`/`stakeholder` strings) is present, proving resolved rows aren't
  accidentally swallowed by the new branch.
- `expect(screen.getAllByText(/Queued/i).length).toBe(10);` (5 queued units ×
  2 rows each — Project + Stakeholder) — precise count, not just "some",
  matching this file's existing convention of asserting exact row counts
  (e.g. the existing `/Not available/i).length).toBe(2)` assertion).

### 6c. New test — DEC-11 LLM-off edge case (client side of the "outage vs. backlog" invariant)

`it("when the server reports every miss as unavailable (LLM off), nothing renders as Queued — even over-cap misses")`

**Setup:** same 45-unit pool. `mockAltitudesMock.mockResolvedValue({ altitudes: {}, states: Object.fromEntries(units.map((u) => [u.id, "unavailable"])) })`
— all 45 marked `unavailable`, **zero** `queued` entries, mirroring exactly
what `enrichPoolAltitudes` produces when `llmAvailable()` is false (§2b's
server-side truth-table case).

**Assertions:**
- `expect(screen.getAllByText(/Not available/i).length).toBe(90);` (45 units × 2 rows).
- `expect(screen.queryAllByText(/Queued/i).length).toBe(0);` — this is the
  load-bearing assertion: it proves the client renders exactly what the
  server's `states` map says, and does **not** locally reinterpret "unit
  beyond position 40" as queued on its own. A client bug that inferred
  "queued" from array position instead of trusting `res.states[u.id]`
  verbatim would pass 6b (which has real queued entries) but fail this test.

---

## 7. Round-trip / boundary surfaces

### 7a. `states` map — server compose → HTTP JSON → client parse boundary

Already covered mechanically by §2c's route tests (server-side: response
shape) and §6b/6c (client-side: the wire value is trusted verbatim, not
re-derived). The boundary-specific assertion worth calling out explicitly:
in §2c's `"POST /altitudes with 45 units..."` test, assert
`Object.values(res.body.states)` contains **only** the two literal strings
`"queued"` and `"unavailable"` — `assert.ok(Object.values(res.body.states).every((s) => ["queued","unavailable"].includes(s)))`
— i.e. the discriminated-state contract survives `res.json()` serialization
unchanged, not widened or coerced (e.g. never `null`, never `true`/`false`,
never the object `{project,stakeholder}` shape leaking into `states` for a
key also present in `altitudes`).

### 7b. `value_summary_generation_log` — write-then-read (no API route reads this table in v1, so verify directly against the DB, per DEC-4/DEC-14)

Folded into §1's Case 4 and Case 6, but stated here as the general
round-trip requirement any new case touching this table must satisfy:
after any `insertValueSummaryGeneration.run(...)` call, a direct
`db.prepare("SELECT * FROM value_summary_generation_log WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(project_id)`
must show every column populated consistently with what the tick observed:
`source === "tick"`, `outcome` in `["ok","error"]`, and
`generated + queued + unavailable` accounting that is internally consistent
with `pool_size` (`generated + queued + unavailable <= pool_size`, with
`cache_hits` making up the remainder) — this is this table's version of a
"no field silently dropped between write and read" check, since there is no
paired `getValueSummaryGeneration` statement to round-trip through yet.

### 7c. `value_summary_sweep_state` — Create→Get and Update→Get (the literal write/read cycle DEC-2's rotation depends on)

Also folded into §1 Case 3 (ordering) and Case 4 (overflow drain), stated
here as its own explicit round-trip requirement: seed a project with no
sweep-state row (**Create** case — first-ever sweep), run one tick, assert
`listValueSweepTargets`/a direct `SELECT` shows a new row with a non-null
`last_swept_at` and the correct `pending_after_sweep`. Then run a second
tick on the same project (**Update** case), and assert the row's
`last_swept_at` **strictly increases** (not merely "is present") and
`pending_after_sweep` reflects the new count — proving the
`ON CONFLICT(project_id) DO UPDATE SET ...` clause actually updates in place
rather than silently no-opping on the primary-key conflict (a plausible
regression if the `DO UPDATE SET` clause were ever typo'd into
`DO NOTHING`).

### 7d. "No-unresolved-token" analogue for this feature: mutual-exclusivity + full-accounting invariant

This feature has no templated string to leave unresolved, but it has the
structurally equivalent risk named directly in the change brief: **every
unit must land in exactly one of resolved/`queued`/`unavailable` — never
zero, never two.** This must be asserted at both ends per the brief's
framing ("at both the point it's produced and the point it's finally
consumed"):
- **Produced** (composer): §2b's `"no unitKey ever appears in both altitudes
  and states"` case, run against every truth-table branch.
- **Consumed** (tick's own accounting, the point where a discrepancy would
  otherwise silently corrupt the audit log AC-2 depends on): in §1 Case 4/6,
  add the assertion `assert.equal(generated + queued + unavailable, pool_size)`
  (modulo cache hits, which are pre-resolved and excluded from all three
  buckets by definition) directly on the values the tick writes to
  `value_summary_generation_log` — i.e. the log itself must never show a
  sweep where the three buckets under-count or over-count the swept pool.

---

## 8. Registry / enum completeness

- **`ALTITUDE_STATES` (server, canonical)** — pinned by §2b's dedicated test
  (`assert.deepEqual(ALTITUDE_STATES, ["queued", "unavailable"])`), and every
  truth-table case additionally asserts its produced state values are drawn
  from that export, not hand-typed strings disconnected from the registry.
  If a third state is ever added to `ALTITUDE_STATES` without an
  accompanying truth-table case, the "every value is in `ALTITUDE_STATES`"
  assertion still passes (it's a subset check) — so this is **not** by
  itself a completeness tripwire for a *new* state. Recommend also adding
  `assert.equal(Object.values(result.states).length > 0 ? new Set(Object.values(result.states)).size <= ALTITUDE_STATES.length : true)`-style
  coverage is unnecessary complexity for 2 states; with only two members,
  the four explicit truth-table cases in §2b already exercise both by
  construction. Re-evaluate this if `ALTITUDE_STATES` ever grows past 2.

- **Cross-runtime hand-typed gap (flagged, not fixed here):** the client's
  `Altitude` type (`PlanLedgerPanel.tsx`) hardcodes the literals `"queued"`
  and `"unavailable"` independently of the server's `ALTITUDE_STATES` export
  — there is no shared registry a client-side test can derive from (same
  cross-runtime-registry shape as the `WSMessage` gap below). This is the
  same class of risk as §9.7's `types.ts` "hand-maintained wire registry"
  observation and is out of scope for this build's QA design (no WATCH item
  currently owns it explicitly the way WATCH-1 owns `WSMessage`) — noting it
  here as a gap, not inventing a durable-scan fix.

- **`CONSUMERS` / `FILE_DISPOSITIONS` registries** — covered structurally in
  §4 and §5 above; both require the red-before-green sequencing already
  specified by the technical plan.

---

## 9. Test data / fixtures

- **Reused as-is:** `makeProject(name)`, `unit(overrides)`, `fakeSpawn({exitCode, stdout})`,
  `envelope(result)` from `value-summary.test.js` — copy into
  `value-summary-tick.test.js` per this repo's established one-file-owns-its-helpers
  convention (no shared test-helpers module exists for these; do not
  introduce one for this build alone).
- **New, local to `value-summary-tick.test.js`:** `makeSweptProject(name, {lastSweptAt})`
  (§1 preamble) — wraps `makeProject` + `stmts.insertProjectPath.run` (a
  `value_summary_sweep_state`-eligible project requires a `project_paths`
  row per `listValueSweepTargets`'s `JOIN`) + optional
  `stmts.upsertValueSweepState.run` seed.
- **New, local to `PlanLedgerPanel.test.tsx`:** a 45-unit variant of whatever
  `makeUnit()`/pool-fixture helper already exists in that file, generalized
  to accept a count and return an array of units with distinct `id`s — check
  the file for an existing multi-unit builder before adding a new one (the
  file currently only exercises single-unit fixtures in the altitude tests
  per the read-through above; a small loop over `makeUnit({id: ...})` with
  overridden ids is sufficient, no new fixture file needed).
- **Real vs. synthetic scale:** per OPEN-2 (non-blocking), the 45-unit
  fixture size used throughout this design is deliberately chosen to exceed
  `MAX_UNITS_PER_PROMPT` (40) by a small, human-checkable margin (5) while
  staying far below the real measured 182-unit Coaching Assistant pool that
  step 16's manual pass validates against — unit tests intentionally use the
  smallest fixture that still exercises the boundary, not the real number.

---

## 10. How to run

Per `CLAUDE.md`'s testing policy and this project's own commands:

```bash
# Fast loop while building the tick (technical plan §6):
node --test server/__tests__/value-summary-tick.test.js

# Full server suite (must be green before finishing, per CLAUDE.md):
npm run test:server

# Individually, for the red-then-green sequencing steps 4/5 require:
node --test server/__tests__/ledger-metrics-parity.test.js
node --test server/__tests__/chronology-ordering.test.js
node --test server/__tests__/single-writer-guard.test.js
node --test server/__tests__/value-summary.test.js

# Client suite (includes PlanLedgerPanel.test.tsx and i18n.test.ts's E1.1 —
# both catch the new fixture/queued-key work above):
npm run test:client

# Only after reading a snapshot diff and confirming it's intentional
# (screens.snapshot.test.tsx may show a diff once a Value Pool row renders
# a `queued` state — read it, don't blind-regenerate):
cd client && npx vitest run -u

# File-header audit (new files: value-summary-tick.js, value-summary-tick.test.js):
bash .claude/skills/file-headers/scripts/check-headers.sh

# §9.3 vacuous-guard sweep — must return nothing for the new/edited files:
grep -rn "assert.ok(true" server/__tests__/
grep -rn "|| true" server/__tests__/

# Type-only client verification (WSMessage union change, DEC-8):
cd client && npx tsc --noEmit
```

`npm run mcp:typecheck` / `npm run mcp:build` are **not required** — no
`mcp/` surface changes in this build; state this explicitly at sign-off
rather than silently skipping it, per the technical plan's own DoD line.

---

## 11. Known gap — not invented a fix for here

**`client/src/lib/types.ts`'s `WSMessage` union has no exhaustiveness/parity
test against server broadcast types.** Searched
`client/src/**/__tests__/**` for any test asserting `WSMessage`'s `type`
union stays in sync with the server's actual `broadcast(...)` call sites
(`grep -rln "WSMessage"` across client tests returns
`SessionCard.focus.test.tsx`, `Tabby/brain.test.ts`, `Tabby.test.tsx`,
`focusStore.test.ts`, `eventBus.test.ts`, `ProjectManager.test.tsx` — none of
which assert set-parity against the server's broadcast call sites; they
consume specific known message shapes only). This build adds 3 entries by
hand (1 new + 2 pre-existing-drift fixes, DEC-8) but does not add the
durable derived scan that would catch a 4th broadcast type drifting in the
future — that is **WATCH-1**, explicitly out of scope for this build per
DEC-8's "type-level only" framing. Not inventing a fix here; flagging per
this task's own instruction to note the gap rather than paper over it.
