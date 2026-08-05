# E2E / API-Contract Test Design — value-summary-tick

> Authored by `qa-e2e-architect` (team-qa), 2026-08-04. Pre-build: every spec
> below is a red-first deliverable against unbuilt code (per the change
> brief's "NOT YET STARTED" status). This layer proves the wired-up
> HTTP+background-job+DB contract; exhaustive permutation coverage (the
> composer's parse-failure matrix, the tick's overlap/rotation/broadcast
> unit-level mechanics, the structural single-writer guards) stays in the
> unit layer per `technical-plan.md` §6/step 9/step 10.

## This project's "e2e" convention (discovered, not invented)

No Cypress/Playwright exists in this repo. "API-level" here means exactly
what `server/__tests__/project-plans-api.test.js` and
`server/__tests__/value-summary.test.js` already do:

- Boot the **real** app in-process: `createApp()` + `startServer(app, 0)`
  against a throwaway SQLite DB. `process.env.DASHBOARD_DB_PATH` is set to a
  unique tmp path **before** `require("../index")` (module-load-time DB
  binding — must happen first).
- A raw `http.request` `fetch(urlPath, options)` helper (copy it verbatim
  per this repo's own one-helper-per-file convention — both precedent files
  duplicate it rather than sharing it).
- Real DB reads/writes throughout — `stmts.*` used directly for fixture
  setup and for assertions the HTTP surface doesn't expose (e.g. reading
  `value_summary_generation_log` rows directly).
- The **only** thing ever faked is the `claude -p` spawn, via
  `focus-inference.js`'s `__injectSpawnForTest` seam (already reused by
  `value-summary.test.js`) — never a real `claude` CLI process.
- One legitimate **second** seam this build introduces:
  `value-summary-tick.js`'s own `__injectPoolAssemblerForTest`, named
  explicitly in the technical plan (step 5, DEC-15) so the tick's own tests
  don't need a real git repo to prove sweep/drain/log behavior — pool
  assembly's own real-git permutations are `value-ledger.test.js`/
  `value-pool.test.js`'s job, not this layer's. Using it here is the
  documented convention, not a shortcut.
- **Tags/buckets:** none — `node:test` has no tag convention in this repo;
  the spec file *is* the bucket. Everything runs under `npm run test:server`
  (`node --test server/__tests__/*.test.js`). Each spec owns a unique temp
  DB (`Date.now()-pid` suffix) so specs are parallel-safe across files;
  cases *within* a file run in declaration order (`describe`/`it` blocks),
  which the designs below rely on where a later case reads what an earlier
  case wrote.
- **No base-URL/environment prerequisite.** Specs self-host on port 0 —
  nothing needs the real dashboard or the integration stack running. The
  only thing to boot first is nothing.

Given the discovered scheme, this change needs no new bucket or serial
group — it extends the existing **API/contract bucket**
(`value-summary.test.js`) and adds one new same-shaped spec
(`value-summary-tick.test.js`) for the background-job surface, which has no
existing home.

---

## Flows to cover

1. **Fresh multi-state batch through the route, LLM on.** A single
   `POST /api/project-plans/altitudes` call with a batch that mixes
   already-cached units, fresh in-cap misses, and misses beyond the 40-cap
   → confirm cached units resolve with no spawn, in-cap misses resolve via
   one spawn (except a deliberately-unparsable one), over-cap misses come
   back `queued`, and every submitted unit key lands in **exactly one** of
   `altitudes` / `states` — never both, never neither (the OVERLOADED-ABSENCE
   invariant the change brief names as this build's DEC-10/11 risk).
2. **The same shaped batch, LLM off.** Confirm **every** miss — in-cap and
   over-cap alike — comes back `unavailable`, never `queued`. This is the
   DEC-11 branch the change brief calls out as "easy to get backwards":
   outage must never look like backlog.
3. **A large pool drained by the tick, unattended, then read back through
   the same route the UI uses.** Seed one project with an uncached pool
   larger than the 40-unit cap, run `runValueSummaryTickOnce` directly (it's
   a background job, not a route — there is no HTTP way to trigger it), then
   confirm via direct `value_unit_summaries` reads *and* a follow-up
   `POST /altitudes` call with the identical batch that the previously
   `queued` units are now served from cache. Run the tick a second time and
   confirm the remainder drains to zero. This is the one test that actually
   proves AC-1 ("scalable") end-to-end, not just the tick's scheduling
   closure in isolation.
4. **Observability.** After a tick sweep, confirm `value_summary_generation_log`
   carries one row with `source='tick'`, the real `pool_size`, and hit/
   generated/queued/unavailable counts that both match what was actually
   resolved and sum to `pool_size` — the literal evidence AC-2's "observable"
   claim and this build's own DoD line need.

---

## Spec 1: extend `server/__tests__/value-summary.test.js`

This file already owns the `POST /api/project-plans/altitudes` route
contract (`describe("POST /api/project-plans/altitudes", ...)`, currently 3
cases ending at line ~321). Add to that same `describe` block — this is
route-contract surface, not a new bucket. Reuse the file's existing
`makeProject()`, `unit()`, `envelope()`, `fakeSpawn()` helpers and its
`beforeEach` (`__injectSpawnForTest(null)`; deletes
`DASHBOARD_FOCUS_INFER_MODE`/`DASHBOARD_VALUE_SUMMARY_MODEL`; clears
`value_unit_summaries`).

### New case A — mixed cached/in-cap-miss/over-cap-miss batch, LLM on

```js
it("returns states for a mixed cached/fresh/over-cap batch, and never double-counts a unit across altitudes and states (DEC-10/11)", async () => {
  const projectId = await makeProject("Altitudes DEC-11 mixed");

  // Pre-warm 2 cache hits directly (bypasses the LLM path entirely).
  stmts.upsertValueUnitSummary.run("trunk_commit::cached-1::/repo", "Cached phrase 1", "Cached sentence 1.", "haiku");
  stmts.upsertValueUnitSummary.run("trunk_commit::cached-2::/repo", "Cached phrase 2", "Cached sentence 2.", "haiku");

  // 43 fresh misses: 40 attempted (cap), 3 over-cap. Deliberately drop one
  // attempted index (say index 40) from the envelope so it resolves
  // unavailable, not because it's over-cap, but because parseOutput drops it.
  const freshUnits = Array.from({ length: 43 }, (_, i) =>
    unit({ unitKey: `trunk_commit::fresh-${i}::/repo`, value_ref: `fresh-${i}` })
  );
  __injectSpawnForTest(
    fakeSpawn({
      stdout: envelope({
        units: freshUnits.slice(0, 39).map((_, i) => ({
          index: i + 1,
          project: `Project phrase ${i}`,
          stakeholder: `Stakeholder sentence ${i}.`,
        })),
        // index 40 (freshUnits[39]) intentionally omitted -> unavailable.
      }),
    })
  );

  const batch = [
    { unit_key: "trunk_commit::cached-1::/repo", value_source: "trunk_commit", value_ref: "cached-1" },
    { unit_key: "trunk_commit::cached-2::/repo", value_source: "trunk_commit", value_ref: "cached-2" },
    ...freshUnits.map((u) => ({ unit_key: u.unitKey, value_source: u.value_source, value_ref: u.value_ref, label: u.label })),
  ];
  const res = await post("/api/project-plans/altitudes", { project_id: projectId, units: batch });

  assert.equal(res.status, 200);
  assert.equal(Object.keys(res.body.altitudes).length, 41); // 2 cached + 39 generated
  assert.equal(Object.keys(res.body.states).length, 4);     // 1 unavailable + 3 queued

  const overCapKeys = freshUnits.slice(40).map((u) => u.unitKey); // last 3
  for (const k of overCapKeys) assert.equal(res.body.states[k], "queued");
  assert.equal(res.body.states["trunk_commit::fresh-39::/repo"], "unavailable");

  // OVERLOADED-ABSENCE invariant: every submitted key in exactly one map.
  const allKeys = batch.map((u) => u.unit_key);
  const altKeys = new Set(Object.keys(res.body.altitudes));
  const stateKeys = new Set(Object.keys(res.body.states));
  for (const k of allKeys) {
    const inAlt = altKeys.has(k), inState = stateKeys.has(k);
    assert.ok(inAlt !== inState, `${k} must be in exactly one of altitudes/states, got alt=${inAlt} state=${inState}`);
  }
});
```

### New case B — same shaped batch, LLM off

```js
it("LLM off collapses EVERY miss — in-cap and over-cap alike — to unavailable, never queued (DEC-11 outage != backlog)", async () => {
  process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"; // == LLM path unavailable
  const projectId = await makeProject("Altitudes DEC-11 LLM-off");
  stmts.upsertValueUnitSummary.run("trunk_commit::off-cached::/repo", "P", "S.", "haiku");

  const freshUnits = Array.from({ length: 43 }, (_, i) =>
    unit({ unitKey: `trunk_commit::off-fresh-${i}::/repo`, value_ref: `off-fresh-${i}` })
  );
  const batch = [
    { unit_key: "trunk_commit::off-cached::/repo", value_source: "trunk_commit", value_ref: "off-cached" },
    ...freshUnits.map((u) => ({ unit_key: u.unitKey, value_source: u.value_source, value_ref: u.value_ref, label: u.label })),
  ];
  const res = await post("/api/project-plans/altitudes", { project_id: projectId, units: batch });

  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.altitudes), ["trunk_commit::off-cached::/repo"]);
  assert.equal(Object.keys(res.body.states).length, 43);
  assert.ok(
    Object.values(res.body.states).every((s) => s === "unavailable"),
    "with the LLM path unavailable, EVERY miss — including the 3 that are also over-cap — must read unavailable, none queued"
  );
});
```

Both cases belong in this file (not the new tick spec) because they exercise
the route's own contract, independent of the tick — this is exactly the
"fast-path non-regression" surface the change brief flags (DEC-3).

---

## Spec 2: `server/__tests__/value-summary-tick.test.js` (NEW)

This is the integration-level half of the technical plan's step 10 (which
also specifies 6 more unit-shaped cases — overlap guard, per-tick bound,
rotation order, broadcast discipline, failure isolation, env wiring,
DEC-16 structural scan — those stay in this same file but are the unit
architect's coverage, not designed here). The two cases below are the
end-to-end proof this document is responsible for: the pool actually gets
drained, and the log actually proves it.

Boot the real app exactly like `value-summary.test.js` (own temp DB, set
`DASHBOARD_DB_PATH` before requiring `../index`). File header per
`.claude/rules/file-headers.md` before any code (`@author Son Nguyen
<hoangson091104@gmail.com>`).

```js
const { createApp, startServer } = require("../index");
const dbModule = require("../db");
const { db, stmts } = dbModule;
const {
  runValueSummaryTickOnce,
  __injectPoolAssemblerForTest,
  __resetTickStateForTest,
} = require("../lib/value-summary-tick");
const { __injectSpawnForTest } = require("../lib/focus-inference");
```

### Case 1 — overflow drain proven end-to-end, then read back through the route (AC-1)

```js
it("drains a >40-unit pool across two ticks; previously-queued units resolve in value_unit_summaries and read back cached through POST /altitudes (AC-1)", async () => {
  const projectId = await makeProject("Tick drain e2e");
  stmts.insertProjectPath.run(projectId, `/tmp/value-summary-tick-fixture-${projectId}`);

  const units = Array.from({ length: 45 }, (_, i) =>
    unit({ unitKey: `trunk_commit::drain-${i}::/repo`, value_ref: `drain-${i}` })
  );
  __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));

  // --- Tick 1: resolves the first 40, leaves 5 queued. ---
  __injectSpawnForTest(
    fakeSpawn({
      stdout: envelope({
        units: units.slice(0, 40).map((_, i) => ({
          index: i + 1,
          project: `Project phrase ${i}`,
          stakeholder: `Stakeholder sentence ${i}.`,
        })),
      }),
    })
  );
  const tick1 = await runValueSummaryTickOnce(dbModule, {});
  const swept1 = tick1.projects.find((p) => p.project_id === projectId);
  assert.equal(swept1.generated, 40);
  assert.equal(swept1.queued, 5);
  assert.equal(swept1.unavailable, 0);

  // Direct DB proof — the actual acceptance criterion, not the closure's
  // return value: the first 40 unitKeys are real rows in value_unit_summaries,
  // the last 5 are not yet.
  for (const u of units.slice(0, 40)) {
    assert.ok(stmts.getValueUnitSummary.get(u.unitKey), `${u.unitKey} must be persisted after tick 1`);
  }
  for (const u of units.slice(40)) {
    assert.equal(stmts.getValueUnitSummary.get(u.unitKey), undefined, `${u.unitKey} must NOT be resolved yet`);
  }

  // GET-equivalent read-back through the exact contract the UI uses — LLM
  // off so this call cannot itself resolve anything; proves persistence,
  // not a lucky second synthesis.
  process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
  const batch = units.map((u) => ({ unit_key: u.unitKey, value_source: u.value_source, value_ref: u.value_ref, label: u.label }));
  const readback1 = await post("/api/project-plans/altitudes", { project_id: projectId, units: batch });
  assert.equal(Object.keys(readback1.body.altitudes).length, 40);
  assert.ok(Object.values(readback1.body.altitudes).every((a) => a.cached === true));
  assert.equal(Object.keys(readback1.body.states).length, 5);
  delete process.env.DASHBOARD_FOCUS_INFER_MODE;

  // --- Tick 2: drains the remaining 5. ---
  __injectSpawnForTest(
    fakeSpawn({
      stdout: envelope({
        units: units.slice(40).map((_, i) => ({
          index: i + 1,
          project: `Project phrase ${40 + i}`,
          stakeholder: `Stakeholder sentence ${40 + i}.`,
        })),
      }),
    })
  );
  const tick2 = await runValueSummaryTickOnce(dbModule, {});
  const swept2 = tick2.projects.find((p) => p.project_id === projectId);
  assert.equal(swept2.generated, 5);
  assert.equal(swept2.queued, 0);

  for (const u of units) {
    assert.ok(stmts.getValueUnitSummary.get(u.unitKey), `${u.unitKey} must be persisted after tick 2`);
  }

  const sweepState = db.prepare("SELECT * FROM value_summary_sweep_state WHERE project_id = ?").get(projectId);
  assert.equal(sweepState.pending_after_sweep, 0, "the whole 45-unit pool is drained — nothing left pending");

  process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
  const readback2 = await post("/api/project-plans/altitudes", { project_id: projectId, units: batch });
  assert.equal(Object.keys(readback2.body.altitudes).length, 45);
  assert.deepEqual(readback2.body.states, {});
  delete process.env.DASHBOARD_FOCUS_INFER_MODE;
});
```

### Case 2 — audit log proves the sweep, not just asserts the table exists (AC-2)

```js
it("writes one value_summary_generation_log row per swept project per tick, with source='tick' and real hit/generated/queued/unavailable counts (AC-2 observability)", async () => {
  const projectId = await makeProject("Tick log e2e");
  stmts.insertProjectPath.run(projectId, `/tmp/value-summary-tick-log-${projectId}`);

  const units = Array.from({ length: 45 }, (_, i) =>
    unit({ unitKey: `trunk_commit::logtest-${i}::/repo`, value_ref: `logtest-${i}` })
  );
  // 2 pre-cached so cache_hits is provably nonzero and distinct from generated.
  stmts.upsertValueUnitSummary.run(units[0].unitKey, "P0", "S0.", "haiku");
  stmts.upsertValueUnitSummary.run(units[1].unitKey, "P1", "S1.", "haiku");
  __injectPoolAssemblerForTest(async () => ({ units, identityWarnings: [] }));

  const misses = units.slice(2); // 43 misses; cap 40 -> 3 over-cap -> queued
  __injectSpawnForTest(
    fakeSpawn({
      stdout: envelope({
        units: misses.slice(0, 40).map((_, i) => ({
          index: i + 1,
          project: `P${i}`,
          stakeholder: `S${i}.`,
        })),
      }),
    })
  );
  await runValueSummaryTickOnce(dbModule, {});

  const rows = db
    .prepare("SELECT * FROM value_summary_generation_log WHERE project_id = ?")
    .all(projectId);
  assert.equal(rows.length, 1, "exactly one log row for this one project on this one tick");
  const row = rows[0];
  assert.equal(row.source, "tick");
  assert.equal(row.outcome, "ok");
  assert.equal(row.pool_size, 45);
  assert.equal(row.cache_hits, 2);
  assert.equal(row.generated, 40);
  assert.equal(row.queued, 3);
  assert.equal(row.unavailable, 0);
  assert.equal(
    row.cache_hits + row.generated + row.queued + row.unavailable,
    row.pool_size,
    "hit/generated/queued/unavailable must partition pool_size exactly — no unit double-counted or dropped"
  );
  assert.ok(row.created_at, "created_at must be stamped");
  assert.ok(Number.isFinite(row.duration_ms) && row.duration_ms >= 0);
});
```

Both cases call `__resetTickStateForTest()` / `__injectPoolAssemblerForTest(null)`
/ `__injectSpawnForTest(null)` in `afterEach` to avoid cross-test bleed, and
`db.exec("DELETE FROM value_unit_summaries")` /
`DELETE FROM value_summary_generation_log` / `DELETE FROM value_summary_sweep_state`
between cases — same isolation discipline `value-summary.test.js`'s
`beforeEach` already uses for `value_unit_summaries`.

**Deliberately not designed here** (unit layer's job, per `technical-plan.md`
step 10): the overlap guard's mutation proof, the per-tick project bound,
least-recently-swept rotation order, broadcast discipline (spy-called-once /
never-on-zero-generation), the failure-isolation case (one project throws,
`last_swept_at` still advances in `finally`), env-var wiring
(`DASHBOARD_VALUE_SUMMARY_TICK_MODE=off`, `..._MS=0`), and the DEC-16
structural source-scan. Those are single-project, single-mechanism unit
cases that don't need a real booted app or an HTTP round-trip — this spec
file holds both layers, but only the two cases above are this document's
responsibility.

---

## Single-spec run commands

```bash
# Route-contract DEC-11 truth table (extended existing spec)
node --test server/__tests__/value-summary.test.js

# Tick drain + audit-log integration proof (new spec)
node --test server/__tests__/value-summary-tick.test.js

# Cross-consumer parity guard this build also touches (C2.4, DEC-7)
node --test server/__tests__/ledger-metrics-parity.test.js

# Single-writer / DEC-16 structural guards this build extends
node --test server/__tests__/single-writer-guard.test.js

# Derivation-scan liveness this build must observe red-then-green
node --test server/__tests__/chronology-ordering.test.js
```

No stack prerequisite for any of the above — each spec self-hosts on port 0
against its own temp DB, exactly like the two precedent files. Nothing here
needs the real dashboard, the real DB, or a running integration stack.

---

## Full-suite regression gate (final, before sign-off)

Per `CLAUDE.md`'s own testing policy, all of the following must be green as
the last step, in this order:

```bash
# 1. Backend — includes both specs above plus every existing server test
#    (144+ existing cases must stay green with zero behavior edits).
npm run test:server

# 2. Frontend — includes the new >40-unit overflow/AC-2 case in
#    PlanLedgerPanel.test.tsx and the i18n E1.1 four-locale parity check.
npm run test:client

# 2a. Scoped re-run while iterating on the client half only:
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx

# 3. File-header compliance on the two new/changed source files
#    (value-summary-tick.js, value-summary-tick.test.js) and every other
#    touched file.
bash .claude/skills/file-headers/scripts/check-headers.sh

# 4. §9.3 vacuous-guard sweep — must return nothing for the new files.
grep -rn "assert.ok(true" server/__tests__/
grep -rn "|| true" server/__tests__/
```

**OpenAPI contract note:** `server/openapi.js` does not currently document
`POST /api/project-plans/altitudes`'s response shape at all (confirmed —
no `altitudes`/`states` reference in that file), so this build does not
need an OpenAPI schema update and `openapi-contract.test.js`'s D2.4
yaml-freshness check (already part of `npm run test:server`'s glob) stays
green with zero action. **If** the docs pass (`update-project-docs`, step
17) or a reviewer decides to add `/altitudes` to the OpenAPI surface as
part of this change, that edit requires `npm run openapi:yaml` re-run and
the regenerated `openapi.yaml` committed — D2.4 will fail loudly on a stale
file if that step is skipped. State explicitly in the build report whether
`openapi.js` was touched; if not, this note is fully satisfied by doing
nothing.

`npm run mcp:typecheck` is **not required** — no MCP surface changes in
this build (confirmed against the change set); state that explicitly at
sign-off per `CLAUDE.md`'s verification policy, rather than silently
skipping it.

---

## Cost note — minimum set, and what this layer deliberately skips

Two extended cases in an existing spec, plus one new spec with two cases
(45-unit fixtures, two ticks, one HTTP round-trip each) — that is the
minimum that proves: the wire contract never conflates outage with backlog
in either LLM-mode branch, the tick actually drains an overflow pool across
real DB writes (not just its own return value), the drained units are
readable through the same contract the UI calls, and the audit log carries
real per-sweep counts, not just a schema. Deliberately **not** covered at
this layer (unit layer owns them):

- The composer's parse-failure/probe-failure/spawn-failure matrix beyond the
  one deliberately-dropped index used above — `value-summary.test.js`'s
  existing `enrichPoolAltitudes caching` describe block already owns this
  exhaustively.
- The tick's own scheduling mechanics: overlap-guard mutation proof,
  per-tick project bound, least-recently-swept rotation order and its
  starvation-free property across 3+ ticks, broadcast call-once/never-on-zero
  discipline, per-project failure isolation with `finally`-advanced
  `last_swept_at`, and env-var wiring (`_MODE=off`, `_MS=0`) — all single-
  mechanism unit cases per `technical-plan.md` step 10, cases 1/2/3/5/6/7.
- The DEC-16 structural scans (no hand-rolled pool SQL in the tick, single
  lexical `upsertValueUnitSummary.run(`/`insertValueSummaryGeneration`
  call sites, red-proven by injection) — `single-writer-guard.test.js`,
  static source analysis, not an HTTP-level concern.
- Real git-repo pool assembly (cross-feed dedupe, ratchet, cwd
  canonicalization) — `value-ledger.test.js`/`value-pool.test.js` own real
  `ISOLATED_GIT_ENV` fixtures; this layer fakes the assembler by design
  (DEC-15 seam) so the tick spec stays fast and deterministic.
- Client rendering of `queued` vs `unavailable` in the same render —
  `PlanLedgerPanel.test.tsx`'s new AC-2 case, not this layer (this doc's
  Case 1 proves the server round-trip the client component consumes; the
  client test proves the render).
- The real 182-unit Coaching Assistant validation — that is `technical-plan.md`
  step 16's manual browser pass (a real fleet, real cadence, multi-cycle
  observation), explicitly not reproducible as a deterministic automated
  spec; this document's 45-unit two-tick fixture is the automated proxy for
  the same shape at a size CI can run in milliseconds.
