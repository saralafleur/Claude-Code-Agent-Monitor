# Test Plan — value-summary-tick

> Authored by `qa-lead` (team-qa), 2026-08-04, auto-pilot. Synthesizes
> `qa/supporting/coverage.md` + `risk.md` + `unit-tests.md` + `e2e-tests.md`
> under the verdict in `qa/qa-assessment.md` (**GAPPED**). This is the buildable
> deliverable: exactly what to add, in what order, with what assertion. It
> **supersedes** the supporting documents wherever they disagree — three
> corrections are called out explicitly below (§0). Plan only; a separate step
> writes the tests.
>
> **Build status: NOT STARTED.** `effort/2026-08-04-value-summary-tick` is
> byte-identical to `master`. Every test below is red-first against unbuilt code.

---

## 0. Corrections this plan makes to the supporting documents (read first)

These are not editorial. Building the supporting docs verbatim ships two defects
and three silently-uncovered risks.

**C1 — The audit-log partition formula was wrong in `unit-tests.md`, in two
different ways.** The one true form, used **everywhere** in this plan and
required in every shipped assertion:

```js
assert.equal(
  row.cache_hits + row.generated + row.queued + row.unavailable,
  row.pool_size,
  "cache_hits/generated/queued/unavailable must partition pool_size exactly — no unit dropped or double-counted"
);
```

- `unit-tests.md` §7d's `generated + queued + unavailable === pool_size` is
  **arithmetically false** whenever `cache_hits > 0` — which is the steady state
  of this feature, and is false on that document's *own* Case 4 tick 2
  (`5 + 0 + 0 ≠ 45`). **Deleted.**
- `unit-tests.md` §7b's weaker `generated + queued + unavailable <= pool_size` is
  **not an invariant** — it cannot catch a dropped unit, which is the only thing
  this assertion exists to catch. **Deleted.**
- `e2e-tests.md` Case 2's four-term form is correct and is the form adopted.

Grounding: `technical-plan.md` step 5 defines `pool_size = units.length`,
`cacheHits` = `altitudes` entries with `cached === true`, `generated` =
`altitudes` entries with `cached === false`, and `queued`/`unavailable` = counts
from `states`. So the four-term partition is *literally* DEC-11's "every unit in
exactly one of resolved/`queued`/`unavailable` — never zero, never two",
re-expressed in the log. A `<=` variant blesses the "never zero" failure it
exists to detect. **If this assertion goes red during the build, the tick's
accounting is wrong — do not relax the operator.** (Per §9.3's PLAN-LEVEL
VACUOUS FIXTURE sub-pattern: a guard that goes red for a legitimate reason on day
one is the one that gets weakened instead of fixed.)

**C2 — `unit-tests.md` §6b's client fixture arithmetic was inconsistent** ("40
resolved" while enumerating `units[0..38]`, which is 39). Resolved here to
**39 resolved + 1 `unavailable` + 5 `queued` = 45**, with exact rendered counts
stated in §3.

**C3 — Trap C's instrument fixture from the assessment does not discriminate at
45→48 units, and is corrected to 85→88.** The assessment sketched tick 1 = 45
units → `pending_after_sweep` 5, tick 2 = 48 units → `pending_after_sweep` 3.
That arithmetic does not hold under the real cap: on tick 2 there are 40 cache
hits and only 8 misses, the 40-unit cap does not bind, all 8 get generated, and
`pending_after_sweep` is **0** — under a correct implementation *and* under a
decrementing one *and* under a stale-`pool_size` one alike. The case would be
vacuous. The fixture is enlarged so the cap binds on **both** ticks (85 → 88
units), which makes the correct answer (`8`) differ from every wrong answer
(`5`). Full arithmetic in §3, Backend/T-C.

---

## Objective

We are adding first-ever coverage for a background sweep tick and for a
discriminated per-unit wire state that replaces an overloaded absence. End state:
five invariants that are unguarded today become mechanically guarded — (1) every
unit passed to `enrichPoolAltitudes` lands in **exactly one** of
resolved/`queued`/`unavailable`, at the composer, at the HTTP wire, and in the
audit log's four-term partition; (2) an LLM outage never renders as a backlog,
including for over-cap units; (3) `upsertValueUnitSummary.run(` stays a **single
lexical call site** inside `enrichPoolAltitudes` even though the composer gains a
second production invoker, red-proven by injection; (4) the tick's
scheduling/overlap/rotation/failure-isolation closure is exercised at all — the
first test of that shape anywhere in this repo; (5) `pending_after_sweep`, the
only signal that could ever reveal starvation, is proven to be **re-derived from
the live pool each sweep**, not decremented and not stale. Plus a
single-source-of-truth chain from the server's `ALTITUDE_STATES` registry through
the wire to the four i18n locales.

---

## Coverage gap being closed

Each row is an UNGUARDED surface from `qa-assessment.md` "Current coverage",
tied to this project's defect-catalog id where one applies.

| # | UNGUARDED surface today | Catalog id | Assertion that now pins it |
|---|---|---|---|
| G1 | `POST /api/project-plans/altitudes` with **>40 units** — nothing today posts more than one unit, so AC-1's whole subject is untested | **§9.8 OVERLOADED-ABSENCE** (this build is its cure for instance #1) | Route returns 40 resolved + `states` for the remainder; every submitted key in exactly one of `altitudes`/`states` (`inAlt !== inState`) |
| G2 | The DEC-11 truth table — `queued` vs `unavailable` split; today's 5 composer tests only ever see the collapsed "absent" outcome | **§9.8**, **§9.1** (write-sequence form) | 4 truth-table cases + mutual-exclusivity + "appears in neither" check at the composer |
| G3 | LLM-off **combined with** over-cap (T-B) | §9.8 | 45-unit batch, LLM off → **zero** `queued`, all 45 `unavailable`, at composer, route, and client |
| G4 | Single-writer invariant on `upsertValueUnitSummary.run(` — zero coverage today (`single-writer-guard.test.js`'s 5 cases are all `plan-writeback.js`) | **§9.1 DERIVED-DUAL-VIEW** (OPEN, 6 touches) | Exactly one lexical `upsertValueUnitSummary.run(`, lexically inside `enrichPoolAltitudes`; red-proven by injecting a rogue call site in the route |
| G5 | The tick's scheduling/overlap closure — **no precedent in this repo**; both existing ticks document their closure as untested by decision | §9.3 (guard must be mutation-proven) | Overlap guard, per-tick bound, LRS rotation order, broadcast discipline, failure isolation, env wiring — 7 cases, each with a named mutation |
| G6 | `pending_after_sweep` against a pool that **changes size** between ticks (T-C instrument) | §9.8, one layer up (one number collapsing two trajectories) | `pool_size` 85→88 and `pending_after_sweep` 45→**8**; a decremented or stale implementation reads 5 |
| G7 | Cross-invoker concurrency on the same `unitKey` (T-A) — the only row in `technical-plan.md` §7's risk table with no tracking id | §9.1 | Two overlapping composer calls → no throw, exactly one row, value is one of the two payloads verbatim |
| G8 | `ALTITUDE_STATES` → i18n key chain; the client `Altitude` union hard-codes the literals independently of the server registry (T-E) | **§9.7 HAND-SCOPED STRUCTURAL SCAN** (known-hand-typed-member convention) | Every member of `ALTITUDE_STATES` has a `planLedger.pool.altitudes.<state>` key in `en` (derived from the export, not hand-typed); E1.1 propagates to ko/vi/zh |
| G9 | Client rendering of a **third** state, and of an out-of-registry state | §9.8 | `Queued` and `Not available` distinguishable in the **same render**; an out-of-registry value warns instead of masquerading as an old-server absence |
| G10 | `FILE_DISPOSITIONS` / `CONSUMERS` liveness for the new file | **§9.7**, **§9.2** | Both observed RED before the production entry lands (DEC-7/DEC-9) |

Explicitly **not** in scope, and not counted as gaps: `client/src/lib/api.ts`'s
route wrappers (no unit-test layer exists for any wrapper, pre-existing and
project-wide), and `WSMessage` union parity (WATCH-1, consciously unguarded).
The 5 mechanical breakages in `value-summary.test.js`'s `enrichPoolAltitudes
caching` block are expected churn from DEC-10, not coverage debt.

---

## Trap-coverage reconciliation (mandatory — zero unresolved rows)

Stable ids assigned to `risk.md` §4's traps. **No trap may be silently absent.**
Every id terminates in exactly one of: a named file + case, or a dated
`qa/decisions.md` row. "Disclosed in `risk.md` §6" is not a state.

| Id | Trap (`risk.md` §4) | Sev | Disposition |
|---|---|---|---|
| **T-A** | Two-writer race, same `unitKey`, route + tick — last-write-wins, duplicate spawn | P1 | **Covered by test:** `server/__tests__/value-summary.test.js` :: `describe("enrichPoolAltitudes concurrency (T-A)")` :: `"two overlapping calls for the same unitKey leave exactly one valid row and never throw"`. Residual *wastefulness* (2 spawns) deliberately blessed → `qa/decisions.md` **QA-DEC-1**, escalates to **WATCH-7** in `intake/.../decisions.md`. |
| **T-B** | LLM-off + overflow conflated as `queued` | **P0** | **Covered by test**, 3 layers: `value-summary.test.js` §2b case 3 (composer); `value-summary.test.js` route Case B (wire); `PlanLedgerPanel.test.tsx` §6c (render). |
| **T-C** | Convergence math has no growth term / starvation | P1 | **Split.** *Instrument* **covered by test:** `server/__tests__/value-summary-tick.test.js` :: `"pending_after_sweep is re-derived from the live pool each sweep, not decremented"`. *Behavior* (tuning against a real fleet) **declined:** `qa/decisions.md` **QA-DEC-2**, escalates to **WATCH-8**, linked to OPEN-4. |
| **T-D** | Partial parse drops a unit into neither map | **P0** | **Covered by test**, 3 layers: `value-summary.test.js` §2b case 4 + the "never in both, never in neither" case; `value-summary.test.js` route Case A (index 40 omitted); `PlanLedgerPanel.test.tsx` §6b. |
| **T-E** | Client can't distinguish old-server absent `states` from a new-server malformed `states` | P2 | **Covered by test:** `client/src/components/__tests__/PlanLedgerPanel.test.tsx` :: `"an out-of-registry states value warns and does not masquerade as an old-server absence"`, plus the §9.7 canonical-source doc comment. Decision recorded at **QA-DEC-3**. |

**Rule adopted for this plan** (and recommended as a standing team-qa step —
QA-DEC-4): the QA pass does not close until this table exists and every id
resolves. This is the direct countermeasure for the gap class the strategist
found — a trap named in `risk.md`, adopted by neither test architect, whose own
stated fallback (a `decisions.md` row) also never happened. Three for three on
this project (2026-08-01, 2026-08-02, 2026-08-04).

---

## Test change set

Layers **discovered** from `package.json` + directory layout (there is no
Playwright/Cypress layer and no separate integration bucket in this repo):

- **L1 — Server behavioral/integration**, `node:test` + `node:assert/strict`, one
  spec per module; a spec may boot the real app in-process on port 0 against a
  throwaway SQLite DB. Run by `npm run test:server`.
- **L2 — Server structural guards**, same command and directory, distinguished
  only by shape (source scans, registry equality). `single-writer-guard.test.js`,
  `chronology-ordering.test.js`, `ledger-metrics-parity.test.js`.
- **L3 — Client component**, Vitest + Testing Library, spec next to the component.
  Run by `npm run test:client`.
- **L4 — Cross-registry / i18n**, `i18n.test.ts` (client) plus one new
  server-side registry→locale check.
- **MCP** — not applicable; no `mcp/` surface changes.

### Layer reconciliation — what I moved, and why

1. **Exhaustive DEC-11 permutations stay at L1-composer; the wire keeps one
   combined flow proof each per LLM mode.** `value-summary.test.js`'s §2b owns
   the 4-branch truth table and the mutual-exclusivity sweep. The route layer
   keeps exactly two cases (`e2e-tests.md` Case A and Case B) because they are
   the only place the *serialized* contract is observable, and Case B is the
   discriminating outage-vs-backlog combination. I did **not** duplicate the
   parse-failure matrix at the route.
2. **The "states values come from the registry" check moved from a hand-typed
   literal to the imported export.** `unit-tests.md` §7a wrote
   `["queued","unavailable"].includes(s)` — a hand-typed copy of a registry that
   sits one `require` away (§9.7's own failure mode). It now reads
   `ALTITUDE_STATES.includes(s)`, with one `deepEqual` pinning the registry
   itself so it cannot be silently widened.
3. **T-A moved *down* from "cross-invoker e2e" to L1-composer.** The honest shape
   is two overlapping `enrichPoolAltitudes` calls — which is exactly what the
   route and the tick each do — not two overlapping ticks (the overlap guard
   makes that unreachable by construction). Homing it in `value-summary.test.js`
   under a named `describe` is the "name the file and the spec gets written"
   countermeasure this project has already proven works.
4. **T-C's instrument moved *down* to L1-tick, not the wire.** It needs only the
   assembler seam and two DB reads; an HTTP round-trip would add nothing.
5. **`e2e-tests.md` Spec 2 stays at exactly two cases** (drain + read-back;
   audit log). That is the minimum flow proof. Everything else the e2e document
   correctly declined stays declined.

### L1 — Server behavioral (`npm run test:server`)

**`server/__tests__/value-summary.test.js` — UPDATE**

- **Re-destructure 6 existing call sites** for `{ altitudes, states }`
  (enumerated line-by-line in `unit-tests.md` §2a — follow it verbatim). Two are
  genuine assertion upgrades, not churn:
  - empty batch → `assert.deepEqual(await enrichPoolAltitudes(dbModule, []), { altitudes: {}, states: {} })` (**not** `{}` — a lazy `{}` would silently under-check).
  - `"leaves a unit out of the result for a non-llm mode, a failed probe, and unparsable output"` → each of its three `deepEqual(..., {})` becomes `{ altitudes: {}, states: { [u.unitKey]: "unavailable" } }`.
- **ADD, `describe("enrichPoolAltitudes DEC-11 truth table")`** — 4 cases +
  2 invariant cases, per `unit-tests.md` §2b:
  1. under-cap, LLM on → `Object.keys(altitudes).length === 3`, `deepEqual(states, {})`.
  2. 45 units, LLM on → 40 in `altitudes`; 5 `queued`; **0** `unavailable`.
  3. **(T-B)** 45 units, `DASHBOARD_FOCUS_INFER_MODE=heuristic`, no spawn injected (assert none attempted) → `deepEqual(altitudes, {})`, `Object.keys(states).length === 45`, `every(s => s === "unavailable")`.
  4. **(T-D)** 45 units, spawn returns unparsable stdout → 0 resolved, **40** `unavailable`, **5** `queued` (the over-cap 5 are untouched by the in-cap failure).
  5. **(T-D, "never zero, never two")** for every fixture above: no key in both maps, **and** `altKeys.size + stateKeys.size === submitted.length` — the "appears in neither" half, which `unit-tests.md`'s both-maps check alone does not catch.
  6. `assert.deepEqual(ALTITUDE_STATES, ["queued", "unavailable"])`, and for every case above `Object.values(states).every(s => ALTITUDE_STATES.includes(s))` — imported, never hand-typed.
- **ADD, `describe("enrichPoolAltitudes concurrency (T-A)")`** — 1 case, ~20 lines:
  ```js
  it("two overlapping calls for the same unitKey leave exactly one valid row and never throw", async () => {
    const u = unit({ unitKey: "trunk_commit::race-1::/repo" });
    let spawnCount = 0;
    // Distinct payload per invocation, resolved on a later macrotask so both
    // calls provably pass readCached() before either writes.
    __injectSpawnForTest(() => {
      const n = ++spawnCount;
      return deferredSpawn(envelope({ units: [{ index: 1, project: `P-${n}`, stakeholder: `S-${n}.` }] }), 10);
    });

    const [a, b] = await Promise.all([
      enrichPoolAltitudes(dbModule, [u]),   // route-shaped invoker
      enrichPoolAltitudes(dbModule, [u]),   // tick-shaped invoker
    ]);                                     // must not reject (no SQLITE_BUSY, no UNIQUE crash)

    const rows = db.prepare("SELECT * FROM value_unit_summaries WHERE unit_key = ?").all(u.unitKey);
    assert.equal(rows.length, 1, "atomic upsert: one row, never a duplicate");
    assert.ok(["P-1", "P-2"].includes(rows[0].project_level),
      "last write wins with a whole payload — never a merged/garbled hybrid, never null");
    assert.ok(rows[0].stakeholder_level.endsWith("."));
    for (const r of [a, b]) {
      assert.ok(r.altitudes[u.unitKey], "a race must never downgrade a unit to queued/unavailable");
      assert.equal(r.states[u.unitKey], undefined);
    }
    // Deliberate: the race is safe-but-wasteful. Tracked as QA-DEC-1 / WATCH-7.
    // If in-flight coalescing ever lands, this becomes 1 — update it knowingly.
    assert.equal(spawnCount, 2);
  });
  ```
  `deferredSpawn(stdout, ms)` is a small local helper next to `fakeSpawn` (same
  file, same one-file-owns-its-helpers convention). If `fakeSpawn` already
  accepts a delay, use it instead of adding a second helper.
- **ADD, inside the existing `describe("POST /api/project-plans/altitudes")`** —
  `e2e-tests.md` Case A and Case B verbatim (they are correct as written), plus
  `unit-tests.md` §2c's two fast-path cases. Arithmetic confirmed: Case A
  submits 2 cached + 43 fresh = 45; `altitudes` = 41 (2 cached + 39 generated),
  `states` = 4 (1 `unavailable` at the deliberately-omitted index 40, 3 `queued`);
  41 + 4 = 45. In Case A, replace the hand-typed
  `["queued","unavailable"].includes(s)` with `ALTITUDE_STATES.includes(s)`.
  Also add `assert.deepEqual(res.body.states, {})` on the existing 1-unit happy
  path — `states` must always be present, never `undefined`.

**`server/__tests__/value-summary-tick.test.js` — NEW**

Harness per `unit-tests.md` §1 preamble (own `DASHBOARD_DB_PATH` set before
`require("../index")`; `makeSweptProject` helper; the listed `beforeEach`
resets). File header per `.claude/rules/file-headers.md` **before any code**.

- **Case 1 — overlap guard.** Deferred `poolAssembler`; second call returns
  `{ skipped: "overlap" }` and the assembler counter stays at **1**.
  *Mutation:* delete `if (running) return ...` → two assembler calls.
- **Case 2 — per-tick bound.** 5 eligible projects, `MAX_PROJECTS_PER_TICK=2` →
  `result.swept === 2`, 2 sweep-state rows, 2 log rows.
- **Case 3 — least-recently-swept rotation + starvation-free.**
  `deepEqual(targets.map(t => t.project_id), [pNever, pOld, pRecent])`, then 3
  sequential single-project ticks sweep in that exact order.
  *Mutation:* `ORDER BY p.id ASC` (§9.2) or `DESC` both fail the exact array.
- **Case 4 — overflow drain, 45 units across 2 ticks.** Per `unit-tests.md` §1
  Case 4, **with the partition assertion corrected to the four-term form**:
  - tick 1 log row: `pool_size 45, cache_hits 0, generated 40, queued 5, unavailable 0`; `0+40+5+0 === 45`; `pending_after_sweep === 5`.
  - tick 2 log row: `pool_size 45, cache_hits 40, generated 5, queued 0, unavailable 0`; `40+5+0+0 === 45`; `pending_after_sweep === 0`.
  - `SELECT COUNT(*) FROM value_unit_summaries === 45`.
  - (The deleted three-term form fails tick 2 at `5 ≠ 45`. That is precisely the legitimately-red guard that would have been weakened to `<=`.)
- **Case 5 — broadcast discipline.** Exactly one `value_altitudes_updated` on a
  generating sweep, payload keys `["pending","project_id","unit_keys"]`; **zero**
  on an all-cached sweep; **zero** on an LLM-off sweep.
- **Case 6 — failure isolation.** `pBad` rejects → no throw; `pBad` log row
  `outcome='error'`; `pBad` sweep-state `last_swept_at` non-null and advanced;
  `pGood` still swept `outcome='ok'` in the same call.
  *Mutation:* move `upsertValueSweepState.run` out of the `finally`.
- **Case 7 — env wiring.** `..._TICK_MODE=off` → no timers; `..._TICK_MS=0` → no
  timers; **plus the non-disabled control case** asserting `setTimeout` *was*
  called once (without it, the two negative assertions pass vacuously).
- **Case 8 — DEC-16 structural scan.** Comment-stripped source of
  `value-summary-tick.js`: matches the `{ assembleValuePool } = require("./value-ledger")`
  destructure; does **not** match `FROM project_paths`, `FROM detour_dispositions`,
  `detectTrunkDrift`, `upsertValueUnitSummary`.
  *Mutation:* add a real dead `db.prepare("SELECT ... FROM project_paths")`, observe red, remove.
- **Case 9 — T-C INSTRUMENT (must-add-now, new in this plan).**
  ```js
  it("pending_after_sweep is re-derived from the live pool each sweep, not decremented", async () => {
    const pid = await makeSweptProject("growing pool");
    const base = makeUnits(85);                 // same factory as Case 4, count parameterized
    __injectPoolAssemblerForTest(async () => ({ units: pool, identityWarnings: [] }));

    let pool = base;                            // tick 1: cap binds (85 units, 85 misses)
    __injectSpawnForTest(spawnResolvingFirst(40));
    await runValueSummaryTickOnce(dbModule, {});
    const log1 = lastLogRow(pid);
    assert.equal(log1.pool_size, 85);
    assert.equal(log1.cache_hits, 0);
    assert.equal(log1.generated, 40);
    assert.equal(log1.queued, 45);
    assert.equal(log1.unavailable, 0);
    assert.equal(log1.cache_hits + log1.generated + log1.queued + log1.unavailable, log1.pool_size);
    assert.equal(sweepState(pid).pending_after_sweep, 45);

    pool = base.concat(makeUnits(3, { prefix: "arrival" }));   // 3 new units arrive between ticks
    __injectSpawnForTest(spawnResolvingFirst(40));
    await runValueSummaryTickOnce(dbModule, {});
    const log2 = lastLogRow(pid);
    assert.equal(log2.pool_size, 88, "pool_size must be re-read from the live pool, not cached from tick 1");
    assert.equal(log2.cache_hits, 40);
    assert.equal(log2.generated, 40);
    assert.equal(log2.queued, 8);
    assert.equal(log2.unavailable, 0);
    assert.equal(log2.cache_hits + log2.generated + log2.queued + log2.unavailable, log2.pool_size);
    assert.equal(
      sweepState(pid).pending_after_sweep, 8,
      "8 = 88 - (40 cached + 40 generated), recomputed. A decremented counter reads 5; " +
      "a pending derived from a stale pool_size of 85 also reads 5. Neither is 8."
    );
    assert.equal(
      sweepState(pid).pending_after_sweep,
      log2.queued + log2.unavailable,
      "pending_after_sweep is exactly the not-resolved-this-sweep set (technical-plan step 5)"
    );
  });
  ```
  **Why 85/88 and not 45/48:** at 45→48 the 40-unit cap does not bind on tick 2
  (40 cache hits, 8 misses, all generated), so `pending_after_sweep` is `0` under
  a correct implementation *and* under both wrong ones — the case would prove
  nothing. At 85→88 the cap binds on both ticks and the correct answer (8)
  differs from every wrong answer (5). Fixtures are plain objects with a faked
  spawn; the size costs nothing.
  **What this buys, precisely:** not "starvation is impossible" — that is a
  fleet-tuning question (QA-DEC-2 / WATCH-8 / OPEN-4). It buys that the *only
  instrument that could ever reveal* starvation cannot read as converged while
  the reality is treading water. Without it, this build's own defect class (one
  number collapsing two distinguishable trajectories) is reintroduced at the
  observability layer.
- **Case 10 + 11 — the two flow proofs from `e2e-tests.md` Spec 2**, verbatim:
  drain-then-read-back-through-`POST /altitudes` (AC-1), and the audit-log row
  (AC-2) with the four-term partition. Case 11's `cache_hits 2 + generated 40 +
  queued 3 + unavailable 0 === pool_size 45` is already correct as written.

### L2 — Server structural guards (`npm run test:server`)

**`server/__tests__/single-writer-guard.test.js` — UPDATE** (new `it()` blocks
**inside** the existing `describe`; do **not** create a new file or a second
scope-derivation helper — DEC-6, §9.7):

- `"upsertValueUnitSummary appears only in db.js and value-summary.js"` — `scanFiles` + `deepEqual` on basenames.
- `"upsertValueUnitSummary.run( has exactly one lexical call site, inside enrichPoolAltitudes"` — total count `=== 1` **and** in-body count `=== 1`, via the existing comment-strip + brace-walk technique. **This is the single highest-value test in the change.**
- `"insertValueSummaryGeneration has exactly one production call site"` — `["db.js", "value-summary-tick.js"]`, with a code comment noting WATCH-6 will deliberately widen this in the fast-follow (a reviewed widening, never a silent patch).
- `assertSingleHome("../lib/value-summary", {...})` and `assertSingleHome("../lib/value-ledger", {...})` with the tick as a consumer, export lists derived at build time via `Object.keys(require(...))`.

**`server/__tests__/ledger-metrics-parity.test.js` — UPDATE.** C2.4's expected
array gains `"server/lib/value-summary-tick.js"`. Red-then-green sequencing is a
**build-order requirement** (DEC-7), not a nicety.

**`server/__tests__/chronology-ordering.test.js` — UPDATE.** Add
`"server/lib/value-summary-tick.js": "scanned"` to `FILE_DISPOSITIONS`, **after**
observing the literal failure `server/lib/value-summary-tick.js has no
disposition in FILE_DISPOSITIONS`. If it does not fail, the `readdirSync`
derivation has regressed — **stop and fix that first; it outranks the feature.**
No `GRANDFATHERED_QUERIES` entry is needed: `bulkInsertTables` is
`["events","focus_inferences","detour_dispositions","decision_queue"]`, and
`listValueSweepTargets` touches none of them (verified; re-confirm at build).

### L3 — Client component (`npm run test:client`)

**`client/src/components/__tests__/PlanLedgerPanel.test.tsx` — UPDATE**

- Existing 3 altitude tests: **do not rewrite.** Keep the line-411 test's mock as
  `{ altitudes: {} }` with **no `states` key** — it is now a deliberate
  old-server backward-compatibility case. Add a comment saying so, and add
  `expect(warnSpy).not.toHaveBeenCalled()` (see T-E below). Add
  `expect(screen.queryByText(/Queued/i)).toBeNull()` to the line-370 test.
- **NEW — AC-2 same-render distinguishability (T-D).** 45-unit fixture;
  `altitudes` = `units[0..38]` (**39** resolved), `states` =
  `{ [units[39].id]: "unavailable", [units[40..44].id]: "queued" }` (**6**
  entries). 39 + 6 = 45 (correcting `unit-tests.md` §6b's "40 resolved" prose).
  Assertions, all inside **one** `render()`/`waitFor()` — no unmount between them:
  - `expect(screen.getAllByText(/Queued/i).length).toBe(10)` (5 units × 2 rows).
  - `expect(screen.getAllByText(/Not available/i).length).toBe(2)` (1 unit × 2 rows).
  - at least one resolved unit's mocked text is present.
- **NEW — LLM-off, client side (T-B).** All 45 `unavailable`:
  `getAllByText(/Not available/i).length === 90`, `queryAllByText(/Queued/i).length === 0`.
  Load-bearing: a client that inferred "queued" from array position instead of
  trusting `res.states[u.id]` passes the previous test and fails this one.
- **NEW — T-E, out-of-registry state.**
  ```js
  it("an out-of-registry states value warns and does not masquerade as an old-server absence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockAltitudesMock.mockResolvedValue({ altitudes: {}, states: { [u.id]: "bogus" } });
    // render + waitFor ...
    expect(screen.getAllByText(/Not available/i).length).toBe(2);   // render is unchanged — safe degradation
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toContain("bogus");
    expect(warn.mock.calls[0].join(" ")).toContain(u.id);
  });
  ```
  Paired with `expect(warnSpy).not.toHaveBeenCalled()` on the absent-`states`
  test — together they are what distinguishes "old server" (expected, silent)
  from "new-server bug" (visible). Requires a **small additive product change**
  in `PlanLedgerPanel.tsx`'s altitude effect: when `res.states?.[u.id]` is
  present and outside the known set, `console.warn` once naming the unit id and
  the value, then fall through to the existing `unavailable` branch. Gate it
  with `import.meta.env.DEV` if that reads `true` under this project's vitest
  config; if it does not, drop the gate rather than weakening the test.

### L4 — Cross-registry / i18n

**`server/__tests__/value-summary.test.js` — ADD one registry→locale case**
(this is the single-source-of-truth guardrail, see below):

```js
it("every ALTITUDE_STATES member has a planLedger.pool.altitudes key in the en locale", () => {
  const en = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../../client/src/i18n/locales/en/projectDetail.json"), "utf8"));
  const bucket = en.planLedger.pool.altitudes;
  for (const state of ALTITUDE_STATES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(bucket, state),
      `ALTITUDE_STATES member "${state}" has no planLedger.pool.altitudes.${state} copy in en/projectDetail.json`
    );
  }
});
```

Scope is **derived from the registry export**, not hand-typed (§9.7). It is red
today (`en` holds only `generating` and `unavailable`) and green once the
`queued` key lands. `i18n.test.ts` E1.1 — re-verified live as real and
non-vacuous, deriving `NAMESPACES` from the filesystem and asserting
`expect(mismatches).toEqual([])` across all 4 locales — then propagates the
obligation to `ko`/`vi`/`zh` mechanically. **No new i18n test is needed.**

**`client/src/components/PlanLedgerPanel.tsx` — doc comment** above the
`Altitude` union naming `server/lib/value-summary.js`'s `ALTITUDE_STATES` as the
canonical source and this as a known remaining hand-typed member (§9.7's own
documented convention; precedent `TrunkDriftResult["skipped"]`). A CJS server
module cannot be imported across the Vite/Node boundary — do **not** invent a
scan, and do **not** weaken the union to `string`.

### Fixtures / test data

- **Reuse as-is:** `makeProject`, `unit`, `fakeSpawn`, `envelope` from
  `value-summary.test.js`; copy into the tick spec per this repo's
  one-file-owns-its-helpers convention. **Do not** introduce a shared
  test-helpers module for this build alone.
- **New, local to `value-summary-tick.test.js`:** `makeSweptProject(name, {lastSweptAt})`;
  `makeUnits(n, {prefix})` (parameterized count — used at 45, 85 and 88);
  `spawnResolvingFirst(n)`; `lastLogRow(pid)`; `sweepState(pid)`.
- **New, local to `value-summary.test.js`:** `deferredSpawn(stdout, ms)` for T-A.
- **New, local to `PlanLedgerPanel.test.tsx`:** a count-parameterized loop over
  the existing `makeUnit({id})` builder. Check for an existing multi-unit builder
  first; the file currently only exercises single-unit altitude fixtures.
- **No real 182-unit fixture.** 45 is the smallest size that crosses the 40 cap;
  85/88 is the smallest that makes the cap bind twice. The real Coaching
  Assistant pool is `technical-plan.md` step 16's **manual** pass (OPEN-2).

---

## Implementation steps

Dependency-ordered; each is independently checkable. **Every guard must be
observed red by mutation, not by reading** (§9.3). A *reported* red-proof is
unverified until someone other than the implementer re-runs or reads the guard
body (§9.3's AGENT-SELF-REPORTED-RED sub-pattern, 2026-08-03).

1. **Precondition.** Confirm `git diff --name-only master effort/2026-08-04-value-summary-tick`
   is non-empty and scoped to this work (it is empty today — nothing is built).
   Run the step-1 commit of OPEN-1/DEC-13 first, and do a `ps`/`lsof` check for
   concurrent Claude sessions in this cwd before any git operation.
   *Checkable:* `git status --porcelain` clean at start.
2. **Schema + statements** (`server/db.js`). Two `CREATE TABLE IF NOT EXISTS` +
   3 indexes + 3 prepared statements. **Grep the diff for `ALTER TABLE` — there
   must be none** (this is what keeps §9.5/§9.6 *inapplicable* rather than
   merely complied-with). *Red→green:* `npm run test:server` stays green (1583
   passing); a fresh DB and an existing DB both open.
3. **Create `server/lib/value-summary-tick.js` as a stub**, then run
   `node --test server/__tests__/chronology-ordering.test.js`. **It must fail**
   with `server/lib/value-summary-tick.js has no disposition in FILE_DISPOSITIONS`.
   Capture that output. Add the `"scanned"` entry → green. *If it does not fail,
   the derivation has regressed — fix that before continuing.*
4. **Composer** (`server/lib/value-summary.js`): `{ altitudes, states }`,
   `ALTITUDE_STATES` export, rewrite the stale "overflow is rare" comment
   (lines 36-38). Re-destructure the 6 existing test call sites. *Red-first:* the
   6 updated call sites and all of §2b fail before the split lands (wrong shape /
   no export) and pass after.
5. **DEC-11 truth-table cases** (L1 §2b, 6 cases incl. T-B and T-D). *Red-first:*
   case 3 fails on any "cap first, then gate" implementation (over-cap misses
   come back `queued` during an outage); case 4 fails if `parseOutput`-dropped
   indices are left out of both maps; case 5's `altKeys.size + stateKeys.size ===
   submitted.length` fails in the "appears in neither" direction.
6. **Registry→locale guard** (L4). *Red-first:* fails now (no `queued` key in
   `en`). Add `planLedger.pool.altitudes.queued` to **all four** locales → green;
   `npm run test:client`'s E1.1 proves ko/vi/zh parity. Then mutation-prove:
   delete the `ko` key, observe E1.1 red, restore.
7. **T-A concurrency case** (L1). *Red-first:* fails before the composer split
   exists. Its standing value is executional: the "atomic upsert, no corruption"
   claim in `technical-plan.md` §7 stops being a reading of the SQL. Expect it to
   pass on the first run once step 4 lands — that is the point.
8. **Route** (`server/routes/project-plans.js`): destructured import, respond
   `{ altitudes, states }`. Add route Cases A and B + the two fast-path cases.
   *Red-first:* all four fail before the route forwards `states`
   (`res.body.states` is `undefined`).
9. **Tick body** (`server/lib/value-summary-tick.js`) + `value-summary-tick.test.js`
   Cases 1-8. *Red-first per case:* the exact mutations listed in the change set
   (remove `running`; remove the `.slice(0, max)` bound; `ORDER BY p.id`; move
   `upsertValueSweepState` out of `finally`; unconditional broadcast; drop the
   `mode==="off"` early return; add dead `FROM project_paths` SQL). Run each
   mutation, capture the failure, restore, confirm green.
10. **T-C instrument, Case 9.** *Red-first:* a `pending_after_sweep` implemented
    as a decrementing counter, or derived from a `pool_size` captured before
    assembly, reads `5`; the test demands `8`. Prove it by *temporarily*
    implementing the decrement form, observing red, then restoring the
    re-derivation. This mutation is mandatory — an instrument test that has never
    been shown to distinguish the two implementations is a §9.3 vacuous guard.
11. **Flow proofs, Cases 10-11** (drain + read-back; audit log). *Red-first:*
    Case 10 fails if the tick's re-slice ignores what is already cached (tick 2
    re-reports `generated: 40`); Case 11 fails on any mis-partition.
    **The partition assertion is the four-term form. Do not relax it to `<=`.**
12. **`CONSUMERS` / C2.4** (DEC-7). Land **one side only**, run
    `node --test server/__tests__/ledger-metrics-parity.test.js`, **observe C2.4
    red**, capture the output, then land the other side → green. Landing both in
    one commit without the intermediate red is a build defect, not a formality.
13. **Single-writer guards** (L2). Add the 5 blocks. Then, in one sitting:
    (a) run green, (b) inject a rogue `dbModule.stmts.upsertValueUnitSummary.run(...)`
    inside the `POST /altitudes` handler, (c) run and **capture** the failure on
    `totalCalls === 1`, (d) remove, (e) run green. Repeat for
    `insertValueSummaryGeneration`. Then mutation-prove both `assertSingleHome`
    calls (have the tick import `buildPrompt` / `computePlanHealth`; observe the
    `absent` check fail; revert).
14. **Register the tick** (`server/index.js`, `try/catch` inside
    `startBackgroundServices()`), then tick Case 7 (env wiring) including the
    non-disabled control sub-case. *Checkable:* `npm run dev` boots clean, and
    boots equally clean with `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off`.
15. **Client types** (`types.ts` +3 union entries, `api.ts` `states?`), the §9.7
    doc comment, `PlanLedgerPanel.tsx`'s `queued` branch, the `states` mapping,
    and the out-of-registry `console.warn`. *Checkable:*
    `cd client && npx tsc --noEmit`.
16. **Client tests** (L3): the 3 updated + 3 new cases. *Red-first:* the AC-2
    case fails before the `queued` branch renders (`getAllByText(/Queued/i)`
    throws); the T-E case fails before the warn exists.
17. **Fill in the trap-coverage table** with the real `file :: case-name` for
    every covered id, and confirm QA-DEC-1/2/3 exist in `qa/decisions.md` with
    WATCH-7 / WATCH-8 mirrored into `intake/.../decisions.md`. **Zero unresolved
    rows.**
18. **Full verification** (§ How to run), then `update-project-docs`
    (`ARCHITECTURE.md`: 12th background tick, 2 tables, 3 env vars, `states` on
    the route).

---

## Single-source-of-truth guardrail

This project has a canonical registry driving multiple rendered outputs, and the
tests must assert the rendered paths **agree with the registry** — never bless a
hand-edited path that bypasses it.

**The chain:** `server/lib/value-summary.js`'s `ALTITUDE_STATES` → the composer's
`states` values → the HTTP JSON `states` values → `client/.../en/projectDetail.json`'s
`planLedger.pool.altitudes.*` keys → `ko`/`vi`/`zh` → `PlanLedgerPanel.tsx`'s
`Altitude` union and `AltitudeText` branches.

Enforced as:

1. `assert.deepEqual(ALTITUDE_STATES, ["queued","unavailable"])` — the registry
   cannot be silently widened.
2. Every produced/serialized `states` value is checked with
   `ALTITUDE_STATES.includes(s)` — **the imported export, not a hand-typed
   literal array**. This is the correction to `unit-tests.md` §7a; copying a
   registry one `require` away into a test literal is §9.7's exact failure mode.
3. The **derived** registry→locale check (L4): the loop's scope is
   `ALTITUDE_STATES` itself, so adding a third state makes the i18n obligation
   fail immediately rather than shipping an untranslated placeholder. This is the
   completeness tripwire that `unit-tests.md` §8 correctly identified as missing
   from a pure subset check.
4. `i18n.test.ts` E1.1 (existing, re-verified non-vacuous) carries `en` → 3
   locales with a filesystem-derived namespace list.

**The one link that cannot be mechanically closed** is the Vite/Node boundary:
`PlanLedgerPanel.tsx`'s `Altitude` union hard-codes the literals, and a CJS
server module cannot be imported into the client bundle. Per §9.7's documented
convention for exactly this situation, carry a **doc comment naming the canonical
source** (precedent: `TrunkDriftResult["skipped"]`) rather than inventing a
brittle source-text scan or weakening the union. The T-E test is what makes an
out-of-registry value visible at runtime instead of silent.

Registries whose *entries* must be reviewed additions, not silent ones —
`value-ledger.js`'s `CONSUMERS` (C2.4) and `chronology-ordering.test.js`'s
`FILE_DISPOSITIONS` — are both extended with the red-before-green sequencing in
steps 3 and 12. Note in a comment that WATCH-6 will deliberately widen the
`insertValueSummaryGeneration` expected array in the fast-follow.

---

## Durable-cure decision

**Structural cures adopted now (3):**

1. **The registry-derived i18n completeness check** (L4) — scope derived from
   `ALTITUDE_STATES`, so a future third state cannot ship without copy. ~8 lines.
2. **The T-C instrument test** — proves `pending_after_sweep` is re-derived, not
   decremented. This is the "no-leak" analogue for this feature's observability
   layer, and it is a genuine gate: without it, the only signal that could reveal
   starvation can read "converged" while treading water, which reintroduces this
   build's own defect class one layer up.
3. **The trap-id ↔ coverage reconciliation table** at the top of this document —
   every `risk.md` trap gets a stable id, and every id terminates in a named
   file+case or a dated `decisions.md` row. This is the cure for the *class*
   (three consecutive cycles of a named trap landing in nobody's file, with its
   own stated fallback also never happening), applied for the first time to the
   QA pipeline itself rather than to product code. **Adopted for this plan**
   (QA-DEC-4). Making it a standing step for every future `team-qa` run requires
   editing the `team-qa` skill templates under `~/.claude/` — that is a
   configuration change I am not making on an agent instruction; it is flagged
   for Sara in QA-DEC-4 with the exact one-line addition.

**Structural cures explicitly deferred (2), each with a dated row:**

- **In-flight coalescing / dedupe for the two-writer race (T-A).** We prove
  safe-but-wasteful by execution and accept the waste. Consequence of deferring:
  a user opening Project Detail mid-tick can pay 2 LLM calls for one unit and get
  last-write-wins prose. Not corruption; not observable as an error. → **QA-DEC-1
  / WATCH-7**, trigger: any `SQLITE_BUSY` in the log, or a user-reported
  inconsistent altitude description.
- **Starvation *behavior* under a growing pool (T-C).** Whether an active project
  outruns its rotation slot is a tuning question answerable only against a real
  fleet. Consequence of deferring: AC-1's literal promise ("eventually reach full
  coverage") can be false for a very active subset of projects. We now have the
  instrument to see it in the log, which is exactly what makes OPEN-4's manual
  measurement meaningful. → **QA-DEC-2 / WATCH-8**, linked to OPEN-4.

**Not attempted, correctly:** the `WSMessage` server-broadcast ↔ client-union
parity scan (WATCH-1) and an `api.ts` wrapper test layer. Both pre-date and
outlive this build.

---

## How to run

Commands from `CLAUDE.md`'s "Commands you should know" / "Testing and
verification policy" (no `PROJECT-CONTEXT.md` test-stack section exists; the rest
is discovered from `package.json`).

```bash
# --- Fast loops, per layer ---
node --test server/__tests__/value-summary-tick.test.js      # L1 tick (new)
node --test server/__tests__/value-summary.test.js           # L1 composer + route + T-A + L4
node --test server/__tests__/single-writer-guard.test.js     # L2
node --test server/__tests__/ledger-metrics-parity.test.js   # L2 (C2.4 red-then-green)
node --test server/__tests__/chronology-ordering.test.js     # L2 (FILE_DISPOSITIONS red-then-green)
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx   # L3
cd client && npx vitest run src/i18n/__tests__/i18n.test.ts                      # L4 (path: confirm at build)

# --- Full gates, in this order, before sign-off ---
npm run test:server        # baseline to beat: 1583/1583 green, 386 suites (measured 2026-08-04)
npm run test:client
cd client && npx tsc --noEmit          # WSMessage/api.ts type-only changes
bash .claude/skills/file-headers/scripts/check-headers.sh    # must exit 0 (2 new files)

# --- §9.3 vacuous-guard sweep: must return nothing for the new/edited files ---
grep -rn "assert.ok(true" server/__tests__/
grep -rn "|| true" server/__tests__/

# --- Snapshots: only after reading the diff and confirming it is intentional ---
cd client && npx vitest run -u         # never blind-regenerate (CLAUDE.md)

# --- Schema-class confirmation (§9.5/§9.6 must stay INAPPLICABLE) ---
git diff master -- server/db.js | grep -i "ALTER TABLE"     # must return nothing
```

`npm run mcp:typecheck` / `npm run mcp:build` are **not required** — no `mcp/`
surface changes. **State that explicitly at sign-off** rather than silently
skipping it (CLAUDE.md verification policy).

`server/openapi.js` does not document this route's response shape today, so no
OpenAPI update is needed and `openapi-contract.test.js` D2.4 stays green with
zero action. If anyone adds `/altitudes` to the OpenAPI surface, re-run
`npm run openapi:yaml` and commit the regenerated `openapi.yaml`, or D2.4 fails
on staleness. State in the build report whether `openapi.js` was touched.

Note: `e2e-tests.md`'s "144+ existing cases" is stale copy, not a second
measurement. **The real baseline is 1583** — do not let the smaller number be
quoted at sign-off.

---

## Definition of Done

**Trap coverage & plan integrity**
- [ ] The trap-coverage table has **zero unresolved rows** — every id T-A…T-E
      terminates in a named `file :: case` or a dated `qa/decisions.md` row, and
      the table's file/case names have been updated to the ones actually shipped.
- [ ] The audit-log partition assertion is the **corrected four-term form**
      (`cache_hits + generated + queued + unavailable === pool_size`) at **every**
      occurrence in shipped tests — verified by
      `grep -rn "queued + .*unavailable" server/__tests__/`; **no `<=` variant and
      no three-term variant anywhere.**
- [ ] `qa/decisions.md` contains QA-DEC-1…QA-DEC-4; WATCH-7 and WATCH-8 are
      mirrored into `intake/2026-08-04-value-summary-tick/decisions.md`, and
      `technical-plan.md` §7's two-writer-race row no longer has `—` in its
      "Tracked as" column.

**Red-before-green evidence (§9.3 — captured output, not a claim)**
- [ ] `chronology-ordering.test.js` observed red with the literal
      `...has no disposition in FILE_DISPOSITIONS` message before the entry landed.
- [ ] C2.4 observed red with one side of the `CONSUMERS` change landed, green after.
- [ ] `upsertValueUnitSummary.run(` guard observed red under an injected rogue
      call site in `routes/project-plans.js`; injection removed; green after.
- [ ] `insertValueSummaryGeneration` guard observed red under an injected rogue
      call site; removed; green after.
- [ ] Overlap guard observed red with `if (running)` removed (assembler called twice).
- [ ] T-C instrument observed red under a decrementing `pending_after_sweep`
      (reads 5, demands 8); re-derivation restored; green after.
- [ ] Both `assertSingleHome` calls observed red under a rogue extra import.
- [ ] Case 8's structural scan observed red under real dead `FROM project_paths` SQL.
- [ ] E1.1 observed red with the `ko` `queued` key deleted; restored; green.
- [ ] Every red observation was **re-run or read by someone other than the
      implementer** (§9.3 AGENT-SELF-REPORTED-RED, 2026-08-03).

**Suites**
- [ ] `npm run test:server` green, count **≥ 1583 + the new cases**, 0 fail, 0 skipped.
- [ ] `npm run test:client` green, including `i18n.test.ts` E1.1 and
      `PlanLedgerPanel.test.tsx` (11 existing + 3 new).
- [ ] `cd client && npx tsc --noEmit` clean.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0 —
      `value-summary-tick.js` and `value-summary-tick.test.js` both carry the
      overview + `@author Son Nguyen <hoangson091104@gmail.com>` line.
- [ ] Vacuous-guard grep returns nothing for the new/edited files.
- [ ] Any `screens.snapshot.test.tsx` diff was **read and justified**, not blind-regenerated.

**Registry / source-of-truth in sync**
- [ ] `ALTITUDE_STATES` → `en` locale keys → all 4 locales, proven by the derived
      L4 check + E1.1 (not by inspection).
- [ ] `value-ledger.js`'s `CONSUMERS` and C2.4's expected array both name
      `server/lib/value-summary-tick.js`.
- [ ] `FILE_DISPOSITIONS` carries `"server/lib/value-summary-tick.js": "scanned"`.
- [ ] `PlanLedgerPanel.tsx`'s `Altitude` union carries the §9.7 canonical-source
      doc comment naming `server/lib/value-summary.js`'s `ALTITUDE_STATES`.
- [ ] `git diff master -- server/db.js | grep -i "ALTER TABLE"` returns nothing —
      §9.5/§9.6 remain **inapplicable**, not merely complied-with.

**Acceptance criteria traced to evidence**
- [ ] **AC-1** — tick Case 4 (45 units drained across 2 ticks, 45 rows in
      `value_unit_summaries`) + Case 10 (read-back through `POST /altitudes` with
      the LLM off proves persistence, not a lucky re-synthesis).
- [ ] **AC-2** — Case 11's four-term log partition + `PlanLedgerPanel` AC-2
      same-render case (10 `Queued`, 2 `Not available`, one render).
- [ ] **AC-3** — the single-writer guard suite, C2.4, and Case 8's DEC-16 scan,
      each with its red-proof captured.
- [ ] `npm run mcp:typecheck` / `mcp:build` **explicitly stated as not run and
      why** in the build report.
- [ ] OPEN-3 (no client subscriber in v1) re-read and re-affirmed at sign-off, per
      the technical plan's own instruction.
