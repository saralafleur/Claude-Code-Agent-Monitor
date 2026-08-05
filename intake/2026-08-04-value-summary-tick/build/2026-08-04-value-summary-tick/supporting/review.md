# Adversarial Code Review — 2026-08-04-value-summary-tick

Reviewer pass over the full diff since `b155f830c79698349952d2c88ea9f60bedaaf66d`,
read in the effort worktree
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor`.

Diff surface reviewed: 20 modified tracked files + 2 untracked new files
(`server/lib/value-summary-tick.js`, `server/__tests__/value-summary-tick.test.js`
— note these do **not** appear in `git diff --stat`; they must be reviewed via
`git status`). Checked against `PROJECT-CONTEXT.md` §9.1, §9.2, §9.3, §9.5,
§9.6, §9.7, §9.8, plus `decisions.md` DEC-10/11/14/15/16 and `qa/test-plan.md`
Cases 8–11.

**Verdict: 2 blockers, 6 should-fix, 4 nits.** Both blockers are named
defect-catalog entries (§9.3 and §9.8), and both survived two verifier passes.

---

## BLOCKERS

### B1 — `server/__tests__/value-summary-tick.test.js:548-554`: the MANDATORY AC-1 flow proof (Case 10) is an empty-body `it()` that ships green — §9.3 VACUOUS-GUARD

```js
describe("value-summary-tick: flow proof (AC-1, drain & read-back)", () => {
  it("tick generates, then POST /altitudes reads back all units with correct split", async () => {
    // (This test requires HTTP setup, similar to value-summary.test.js)
    // For now, just structure the assertion.
    // Full test would: seed tick, then call route and verify states in response
  });
});
```

This is the exact sub-shape `PROJECT-CONTEXT.md` §9.3 records verbatim on
2026-08-03: *"the O-8 … cure landed as two empty-body `it()` cases — two green
ticks guarding nothing, in the build whose DoD was built around not doing
that."* It is one of the 17 passing cases both verifier passes counted
(`node --test server/__tests__/value-summary-tick.test.js` → `# pass 17`), and
it is why the "17/17 green" number overstates coverage by one mandated case.

It is not optional decoration:
- `qa/test-plan.md:334-337` names **Case 10** as one of the two flow proofs
  taken "verbatim" from `e2e-tests.md` Spec 2;
- `qa/test-plan.md:513` gives it a red-first procedure ("Case 10 fails if the
  tick's re-slice ignores what is already cached — tick 2 re-reports
  `generated: 40`");
- `qa/test-plan.md:740-742` traces **AC-1** to it: *"Case 10 (read-back through
  `POST /altitudes` with the LLM off proves persistence, not a lucky
  re-synthesis)"*.

Nothing else in the suite covers that property. The tick suite's
`"database preserves all 45 units after 2 ticks"` proves rows land in
`value_unit_summaries`, but not that the **route** (the other invoker) reads
the tick's writes back as `altitudes` with an empty `states` — i.e. the
cross-invoker read-back that is AC-1's actual claim. `value-summary.test.js`
Case A/B drive the route, but only against caches the route itself populated.

**Why the sweeps missed it:** the body contains the word *"assertion"* inside a
comment, so a naive `grep -c assert` on the body reads as non-vacuous. (Verified:
a brace-balanced scan flagging bodies with no `/assert/` match reports this case
as OK for that reason.) The `assert.ok(true` / `|| true` greps do not see it
either. Worth carrying forward as a sweep-technique note.

**Fix:** implement Case 10 as specified — seed via `runValueSummaryTickOnce`
with a 45-unit assembler and a 40-unit spawn, then `POST /api/project-plans/altitudes`
with **`DASHBOARD_FOCUS_INFER_MODE=heuristic`** (the LLM off, so a pass can only
come from persistence) and assert `altitudes` has the 40 tick-generated keys and
`states` has the remaining 5 as `unavailable`. Then run the plan's own red-first
mutation (make tick 2 ignore the cache) and record the red. If it genuinely
cannot be built this round, it must be **deleted** and recorded as a dated
`decisions.md` row — §9.4's "a finding ends in exactly one of two states" — never
left as a green tick.

### B2 — `server/lib/value-summary-tick.js:115-134`: an errored sweep writes `pending_after_sweep = 0`, which is indistinguishable from "fully drained" — §9.8 OVERLOADED-ABSENCE, reintroduced inside this build's own cure

```js
      } catch {
        // Per-project fail-safe: one bad project cannot stop the sweep.
        outcome = "error";
      } finally {
        ...
        dbModule.stmts.upsertValueSweepState.run(projectId, nowIso, queued + unavailable);
```

On the error path every counter is still at its initializer, so the tick writes
`pending_after_sweep = 0` and **overwrites** whatever the last good sweep
recorded. A project whose `assembleValuePool` throws every cycle (deleted or
moved repo root, a git lock, a `detectTrunkDrift` failure) therefore reports
`pending_after_sweep = 0` — the most optimistic possible value — forever. There
is no `outcome` column on `value_summary_sweep_state`, so nothing in that table
distinguishes "drained to zero" from "never got off the ground."

That is precisely §9.8's acceptance criterion inverted: *"any single number
reported as progress must be re-derived from the live input each round … or it
silently becomes another collapsed absence."* It is also WATCH-8's own instrument
failing in the one direction WATCH-8 exists to prevent — and the T-C test
(`value-summary-tick.test.js:498`) only exercises the happy path, so it cannot
see it. `PROJECT-CONTEXT.md` §9.7's standing observation applies: *"the failure
survives even in the build that builds the cure."*

Two related consequences of the same `finally`:

1. **The documented four-term partition is violated on a mixed failure.**
   `poolSize` is assigned at line 100 (`poolSize = units.length`) *before*
   `enrichPoolAltitudes` runs. If assembly succeeds and enrichment throws, the
   log row is `pool_size = 182, cache_hits = generated = queued = unavailable = 0`
   — breaking the invariant `server/db.js`'s own schema comment states
   unconditionally ("The four counted columns are a strict partition of
   `pool_size` … never a `<=` or three-term form"). The failure-isolation test
   only covers assembly-throws (where `poolSize` is still 0), so the mixed case
   is untested and the partition guard passes vacuously (`0 === 0`).
2. **The error is discarded entirely** — bare `catch {}` with no binding, no
   `console.warn`. Every sibling fail-safe in this repo logs
   (`server/index.js:459`, `:468`). An operator reading `outcome='error'` with
   eight zeroed columns has no way to tell a git failure from a DB failure. This
   is §9.6's SHARED-BUDGET-STARVATION instruction ("make the silent `catch` log
   loudly") and §9.8's discrimination requirement, on a brand-new surface.

**Fix (all three, small):**
- `catch (err) { outcome = "error"; console.warn(\`value summary sweep failed for ${projectId}:\`, err.message); }`
- On `outcome === "error"`, do **not** clobber `pending_after_sweep` — advance
  `last_swept_at` only (a second prepared statement, or read the prior row and
  re-write its value). Add a tick test: a project with a prior
  `pending_after_sweep = 45` that then errors must **not** read 0.
- Zero `poolSize` when `outcome === "error"` (or add the error-row exception to
  `db.js`'s schema comment and to the partition assertions), and add the
  mixed-failure case: assembler succeeds, `enrichPoolAltitudes` throws.

---

## SHOULD-FIX

### S1 — `server/lib/value-summary-tick.js:118-142`: the `finally`'s DB writes are unguarded, so the file header's anti-starvation guarantee is false

The header claims: *"one project's assembly or synthesis failure never stops the
rest of the sweep, and that project's rotation still advances (its
`last_swept_at` is written in a `finally`), so a single pathological project can
never starve every project behind it."*

A `finally` block cannot be caught by its own `catch`. If
`insertValueSummaryGeneration.run(...)` throws — `SQLITE_BUSY` is the realistic
one, on a `DB_PATH` shared by the Express server, MCP server, desktop app and VS
Code extension, and it is literally WATCH-7's own promotion trigger ("any
`SQLITE_BUSY` in the generation log") — then:
1. `upsertValueSweepState` never runs, so `last_swept_at` stays NULL;
2. the throw escapes the `for` loop and `runValueSummaryTickOnce` rejects
   (swallowed by `.catch(() => {})` at lines 166/171);
3. the project remains "never swept," which
   `listValueSweepTargets`'s `ORDER BY (s.last_swept_at IS NOT NULL) ASC` sorts
   **first** — permanently. It plus the two behind it consume every tick slot,
   and the rest of the fleet starves. Exactly the invariant the header asserts.

Same exposure for `broadcast(...)` at line 136, which is also inside the `finally`.

**Fix:** wrap the whole `finally` body in its own `try { … } catch (err) { console.warn(…) }`,
and write `upsertValueSweepState` **before** `insertValueSummaryGeneration` so
rotation advance is the write that cannot be starved by the audit write. (§9.6's
2026-08-03 B3 lesson generalizes here: *"atomicity is necessary and not sufficient
— it must also be unable to throw."*)

### S2 — `server/__tests__/value-summary.test.js:470-490`: the route's malformed-entry coverage was silently deleted

The pre-existing case `"returns altitudes for a valid batch and silently drops
malformed entries"` was renamed to `"1-unit happy path returns altitudes and
states (empty)"` and its two load-bearing fixtures removed:

```diff
-        { unit_key: "" }, // malformed: dropped
-        { unit_key: "bad::source", value_source: "not_a_real_source" }, // malformed: dropped
```

`server/routes/project-plans.js:145-155` still contains that sanitizing loop; it
now has **zero** test coverage anywhere. The surviving assertion
(`Object.keys(res.body.altitudes).length === 1`) used to prove the two bad
entries were dropped; it now proves nothing about dropping. Nothing in the
technical plan or test plan asked for this deletion, and the rename disguises it
in the diff. Restore both fixtures and keep the assertion (see S3 for what to
assert about them).

### S3 — `server/routes/project-plans.js:144-157` + `client/src/lib/api.ts:2687-2697`: a route-dropped unit lands in **neither** map, contradicting the contract this build just wrote

`api.ts`'s new JSDoc promises: *"A unit lands in exactly one of two places
(DEC-11), never both, never neither."* That is true of `enrichPoolAltitudes`, but
**not of the route**: units failing `typeof u.unit_key !== "string"` or
`!VALUE_SOURCES.includes(u.value_source)` are dropped from `clean` before the
composer ever sees them, so their keys appear in neither `altitudes` nor
`states`. On the client that unit stays `undefined`, and because
`requestedAltitudesRef` (`PlanLedgerPanel.tsx:519`, `:543-545`) marks it as
already-requested, it renders **"Generating…" forever** with no retry — a third
undiscriminated absence, one layer above the two this build exists to
discriminate.

Not reachable through the shipped client (units come straight from `/pool`), but
it is the documented contract that is wrong, and the test that would have
exercised the path was deleted in the same diff (S2).

**Fix:** either mark dropped keys `"unavailable"` in `states` (preferred — it
makes the api.ts sentence true and gives the client a terminal render), or soften
the api.ts/route JSDoc to scope the guarantee to *accepted* units. Then restore
S2's fixtures and assert which of the two happened.

### S4 — `server/__tests__/value-summary.test.js:499-517`: `"old-server backward-compat (missing states key)"` tests nothing of the sort

The body drives the normal 1-unit route path and asserts `status === 200` plus
`altitudes` present. Its own comments admit it: *"(This is a forward-compat test
for the client, not a route test.)"* and *"Note: we verify that states is present
in the 1-unit case above."* That is §9.3's named subtle form — *"a 'verified
elsewhere' comment standing in for an assertion"* — under a title that reads as
covering DEC-11's client-fallback clause.

The real coverage does exist, on the client
(`PlanLedgerPanel.test.tsx:419` mocks `{ altitudes: {} }` with no `states` key
and asserts the "Not available" render), so nothing is unguarded — but this case
is a duplicate happy-path assertion wearing a misleading name, which is exactly
what makes the next reader stop looking. Delete it, or rename it to what it does.

### S5 — `server/README.md` was not updated: three new env knobs and a new background service are missing from the canonical reference

`ARCHITECTURE.md`, `docs/API.md` and `docs/DATABASE.md` were all updated well.
`server/README.md` was not, and it is the file that carries:
- the `# Background services` env block (lines ~1666-1690) enumerating every
  `DASHBOARD_*` knob — `DASHBOARD_VALUE_SUMMARY_TICK_MODE`,
  `DASHBOARD_VALUE_SUMMARY_TICK_MS` and `MAX_PROJECTS_PER_TICK` are all absent,
  while the neighbouring `DASHBOARD_VALUE_SUMMARY_MODEL` line is present;
- the per-service prose sections (`startFocusInference`, `startFocusAudit`,
  `startPlanPoll`, `startRemoteSourceSync` each get a paragraph) — the new
  `startValueSummaryTick` has none;
- line 700's `value-summary.js` paragraph, which still describes the pre-DEC-10
  request-only contract with no mention of `states` or of the sweep.

`CLAUDE.md`'s non-negotiable docs rule and `.claude/rules/docs-markdown.md`
("update all affected docs together") both bind here.

### S6 — `server/lib/value-summary.js:205-236`: a duplicate `unitKey` spanning the cap boundary lands in **both** maps

If the caller submits the same `unitKey` twice with >40 misses and the duplicate
straddles the slice, line 207 writes `states[key] = "queued"` for the overflow
copy and line 224 writes `altitudes[key]` for the in-batch copy. The reconciling
loop at 234-236 only *adds* `unavailable`; it never clears a stale `queued`. Net
result: one key present in both maps — the "never two" half of §9.8's acceptance
criterion, which Case 5 (`"never in both, never in neither"`) cannot catch
because its fixture has unique keys.

Also wasteful independently of correctness: a duplicated key consumes two of the
40 prompt slots.

Not reachable from the tick (`assembleValuePool` dedupes via `emittedKeys`,
`value-ledger.js:188`), but the route accepts caller-supplied arrays and does not
dedupe.

**Fix:** dedupe `misses` by `unitKey` once, right after the cache-partition loop
(`const misses = [...new Map(rawMisses.map(u => [u.unitKey, u])).values()]`). One
line, fixes both the double-bucket and the wasted slots. Add a Case 5b with a
duplicated key across the boundary.

---

## NITS

### N1 — `server/lib/value-summary-tick.js:81`: `numEnv` lets a typo disable or unbound the sweep

`Number("")` is `0` → `LIMIT 0` → the tick silently sweeps nothing forever.
`MAX_PROJECTS_PER_TICK=-1` → SQLite treats a negative `LIMIT` as **no limit**, so
one tick sweeps the entire fleet — a git walk plus an LLM spawn per project,
which is precisely what DEC-2/DEC-5 bounded. Clamp:
`Math.max(1, Math.floor(numEnv(...)))`. (The un-namespaced env name itself is
house precedent — `reconciliation.js:451` uses `MAX_TARGETS_PER_TICK` the same
way — so only the clamping is new.)

### N2 — `server/__tests__/value-summary-tick.test.js:112-114`: dead empty `before()` hook

```js
before(() => {
  // Setup database (schema should be created by db module)
});
```
Delete it; it is the same visual shape as B1 and adds nothing.

### N3 — `server/lib/value-summary-tick.js:96`: `let generatedKeys = []` is never reassigned — `const`.

### N4 — `server/lib/value-summary-tick.js:157`: `startValueSummaryTick` has no double-start guard and returns no handle, so the interval cannot be cleared. Consistent with `startReconciliation`, so not a regression — noted only because the tick's per-cycle cost (git walk + LLM spawn × N projects) is higher than any existing scheduler's, and a second `startBackgroundServices()` call would double it silently.

---

## Verified clean (checked, no finding)

- **§9.1 DERIVED-DUAL-VIEW, single lexical writer.** `upsertValueUnitSummary.run(`
  appears exactly once in the whole `server/` tree outside `db.js`, at
  `value-summary.js:223`, inside `enrichPoolAltitudes`. I checked for the paths a
  static scan would miss: no error/retry branch writes, no
  `dbModule.stmts["upsertValueUnitSummary"]` bracket form, no
  `const s = stmts.upsertValueUnitSummary` aliasing, no second write in the tick
  (which reads `altitudes`/`states` only). `insertValueSummaryGeneration` likewise
  has exactly one production call site. The two `assertSingleHome` blocks derive
  scope from real exports per §9.7/DEC-6 — no hand-typed second helper.
- **§9.8, "exactly one bucket" across every path of `enrichPoolAltitudes`.** Walked
  all seven exits (empty input; zero misses; LLM unavailable; `stdout == null`;
  `parsed` falsy; parsed with omitted indices; full success). Every miss is
  accounted for in each. `runClaudePromptJson` and `probeClaudeCli` both resolve
  and never reject (`focus-inference.js:314`, `:69`), and `parseOutput` range-checks
  `idx` against `count` (`:140`), so `batch[idx - 1]` can never be `undefined` — the
  obvious crash path is genuinely closed. The only hole found is S6's duplicate-key
  case.
- **DEC-11 truth table, exact.** The `llmAvailable()` gate at line 198 runs
  **before** the `slice`/overflow marking at 205-207, so an outage marks every
  miss `unavailable` including over-cap ones — the "easy to get backwards" clause
  is right. Case 3 and Case B pin it at both the composer and route layers, and
  Case A pins the genuinely dangerous combination (over-cap **and** a partial
  in-cap failure in the same call).
- **DEC-15 seam.** `let poolAssembler = assembleValuePool` at module load is the
  production default; `__injectPoolAssemblerForTest(null)` restores it; no
  production file anywhere references the injector (grepped `server/`, `bin/`,
  `mcp/src`). Correctly wired.
- **§9.2.** `listValueSweepTargets` orders on a real timestamp with `p.id` as a
  pure tiebreak, before the `LIMIT`; `value-summary-tick.js` is registered in
  `FILE_DISPOSITIONS`. Traced the rotation across 5 ticks × 15 projects with a
  shared per-tick `nowIso` — no starvation from the ordering itself (the only
  starvation path is S1's).
- **§9.5 / §9.6.** Two brand-new `CREATE TABLE IF NOT EXISTS` tables, zero
  `ALTER TABLE`, zero rebuilds — both entries are **inapplicable**, not merely
  complied with, which is the stronger outcome §9.6's 2026-08-02 note asks for.
  DEC-14's unused `'request'` enum value is present and its rationale is in the
  schema comment.
- **i18n.** All four locales carry `planLedger.pool.altitudes.queued`, and the
  whole-namespace parity test (`i18n.test.ts` E1.1) makes an en-only addition
  impossible, so the server-side `ALTITUDE_STATES`→en check being en-only is not
  a gap.
- **Scope creep.** No file outside the task list's change set was touched. The
  only unrequested change found is S2's test deletion.
