# QA Assessment — value-summary-tick

> Authored by `qa-strategist` (team-qa), 2026-08-04, auto-pilot. **This is the
> document to read first.** It judges the **test plan as designed** (build status:
> NOT STARTED — `effort/2026-08-04-value-summary-tick` is byte-identical to
> `master`), not the pre-build tree, which is trivially uncovered because nothing
> exists yet.

## Change summary

The Value Pool today synthesizes at most 40 altitude descriptions per
`POST /api/project-plans/altitudes` call and represents *every* kind of miss —
not-yet-attempted, over-cap, LLM-off, spawn failure, unparsable output — as the
same indistinguishable absence. On a real 182-unit pool that means ~3 manual page
reloads, and a backlog is visually identical to an outage. This change adds a
bounded background tick (`server/lib/value-summary-tick.js`, the 12th entry in
`startBackgroundServices()`) that sweeps tracked projects in least-recently-swept
rotation to drain the overflow unattended; makes the per-unit state explicit on
the wire (`enrichPoolAltitudes` returns `{ altitudes, states }` with `states`
values `queued` | `unavailable`, DEC-10/DEC-11); and lands a
`value_summary_generation_log` audit table so sweep behavior is provable rather
than asserted. The existing ≤40 synchronous fast path is explicitly preserved
(DEC-3). Two new tables, both `CREATE TABLE IF NOT EXISTS`, no `ALTER`, no
rebuild.

## Coverage verdict

**GAPPED**

Not BLIND, and I want to be explicit about why, because this project's catalog is
scrupulous about not crying wolf. The plan is genuinely strong on the things that
have burned this project before:

- It **consumes** `assertSingleHome` and `chronology-ordering.test.js`'s derived
  `filesToScan` rather than hand-rolling a second scope-derivation helper — §9.7's
  own standing instruction, and the failure mode that recurred three times in
  three days on this repo.
- It makes §9.5/§9.6 **inapplicable rather than complied-with** (additive tables
  only, plus DEC-14 pre-paying the `source='request'` enum value so the fast-follow
  can't force a CHECK-widening rebuild) — the catalog's own stated preferred
  outcome from 2026-08-02.
- It carries a written mutation/red-proof procedure for every structural guard
  (§9.3's standing rule), including the correct red-*before*-green sequencing for
  `CONSUMERS`/C2.4 and `FILE_DISPOSITIONS`.
- The two **P0** traps the risk analyst found — Trap B (LLM-off + overflow must be
  `unavailable`, never `queued`) and Trap D (a partially-parsed response must not
  drop a unit into neither map) — are each covered in **three** independent places
  (server composer truth table, HTTP route contract, client render).

It is not ADEQUATE either, and the reason is not any single missing test — it is
**where** the misses cluster. Of the five traps this pass's own risk analyst
named, **three (A, C, E) appear in no test document at all**, and for two of them
(A, C) `risk.md` §6 explicitly said "if you decline the test, this needs a tracked
`decisions.md` artifact" — and **that artifact does not exist either**. So the
declination was disclosed to a document nobody gates on. Plus one plan-level
arithmetic defect (below) that a faithful implementer will build and then
"fix" by weakening.

## Current coverage

Baseline actually run by the cartographer against the live tree:

| Layer | Command | Result |
|---|---|---|
| Server unit + integration (one flat layer) | `npm run test:server` | **GREEN — 1583/1583**, 386 suites, 0 fail/skip, 43.7s |
| Client, targeted | `npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx` | **GREEN — 11/11** |

(Note: `e2e-tests.md`'s regression-gate section says "144+ existing cases" — that
is stale copy, not a second measurement. The real number is 1583. Harmless, but
don't let it become the number anyone quotes at sign-off.)

Per-surface, what guards this today:

- **`enrichPoolAltitudes`** — **GUARDED** for its *current* shape:
  `value-summary.test.js`'s 5-case `enrichPoolAltitudes caching` block has real
  assertions (deepEqual on concrete objects, spawn counters), covering caching,
  single-spawn batching, model plumbing, and the collapsed "miss → absent"
  contract. All 5 **will hard-break** on DEC-10's return-shape change. That is
  mechanical, expected, and correctly enumerated line-by-line in `coverage.md` §4
  — it is not a coverage gap and must not be counted as one.
- **`POST /api/project-plans/altitudes`** — **PARTIAL.** 3 route cases guard
  validation, happy path, and LLM-off-→-empty-map. Nothing today posts more than
  one unit, so the >40 overflow interaction — AC-1's whole subject — is unguarded.
- **`CONSUMERS` registry** — **GUARDED and a real tripwire.** C2.4's
  `assert.deepEqual` on a hardcoded 2-element array will genuinely go red the
  moment `value-ledger.js` gains the tick. Verified by reading the assertion, not
  the title.
- **`FILE_DISPOSITIONS` derivation** — **GUARDED for live scope.** The scan is
  derived (`readdirSync` over `server/lib` + `server/routes` + `db.js`), so it
  will pick up the new tick file automatically. `value-ledger.js` and
  `value-summary.js` are already dispositioned `"scanned"`.
- **i18n four-locale parity** — **GUARDED, and I re-verified the body directly**
  (`coverage.md` correctly flagged this as unverified and owed). `i18n.test.ts`
  E1.1 (line 238) is real and non-vacuous: `NAMESPACES` is derived from the
  filesystem (line 45), it walks all namespaces × 4 locales with a plural-aware
  `normalizedKeySet`, and asserts `expect(mismatches).toEqual([])`. The two
  empty-body `it()` cases §9.3 recorded on 2026-08-03 **have been built** — they
  are not still empty. The new `planLedger.pool.altitudes.queued` key is therefore
  mechanically enforced across `en`/`ko`/`vi`/`zh`; no extra i18n test is needed.
  (Confirmed the `en` namespace currently holds only `generating` and
  `unavailable` under that path.)
- **Single-writer invariant on `upsertValueUnitSummary.run(`** — **UNGUARDED,
  zero coverage today.** `single-writer-guard.test.js`'s 5 cases are all scoped to
  `plan-writeback.js`. Confirmed live: `upsertValueUnitSummary` appears in exactly
  two production files (`db.js:3148`, `value-summary.js:179`) and
  `enrichPoolAltitudes` has exactly one production caller
  (`routes/project-plans.js:153`) — so the invariant *holds today* and nothing
  proves it. This build adds the second caller, which is precisely when §9.1's own
  history says the pattern bites.
- **The tick's scheduling/overlap-guard closure** — **UNGUARDED, and with no
  precedent anywhere in this repo.** Confirmed: neither `focus-inference.js` nor
  `reconciliation.js` has ever had its `setInterval`/overlap closure exercised
  (`reconciliation.test.js`'s own header says so by deliberate decision). The
  planned Case 1 would be the **first** test of this shape in the project — there
  is no sibling spec to copy assertions from, only the tick-*body* precedent.
- **`api.ts`'s `altitudes()` wrapper** — **UNGUARDED**, pre-existing and
  project-wide (`api.ts` has no unit-test layer for any route wrapper;
  `PlanLedgerPanel.test.tsx` mocks the whole module). Adding
  `states?: Record<string, "queued" | "unavailable">` is a compile-time-only
  change with zero runtime coverage before or after. Not this build's debt.

## Gaps & test-debt diagnosis

### The plan-level defect that must be fixed before anyone writes code

`unit-tests.md` §7d specifies the audit-log accounting assertion as:

```js
assert.equal(generated + queued + unavailable, pool_size)
```

with a parenthetical "(modulo cache hits, which are pre-resolved and excluded from
all three buckets by definition)". **That equation is arithmetically false whenever
`cache_hits > 0`, which is the normal steady state of this feature.** It fails on
the plan's *own* Case 4 tick 2, where 40 units are cache hits and 5 are generated:
`5 + 0 + 0 ≠ 45`. `e2e-tests.md` Case 2 states the correct four-term form —
`cache_hits + generated + queued + unavailable === pool_size` (2+40+3+0 = 45) — and
`unit-tests.md` §7b states a third, weaker variant (`<= pool_size`). Three
documents, three different partition rules, one of them wrong.

This matters more than a typo because of what this project has already recorded:
§9.3's **PLAN-LEVEL VACUOUS FIXTURE** sub-pattern (2026-08-03) — *"the plan can
hand you a vacuous guard with a red-first procedure attached that also can't fail,
and a faithful implementer will build it twice."* Here the plan hands the
implementer an assertion that will go red for a *legitimate* reason on first run,
and §9.3's whole history says a guard that goes red for a legitimate reason on day
one **gets weakened, not fixed**. The likely outcome is the partition check
degrading to `<=`, which cannot catch a dropped unit — the exact invariant it
exists to protect. (Related, smaller: §6b's client fixture prose says "40
resolved" while enumerating `units[0..38]`, which is 39. Resolve the arithmetic
before writing, not after.)

### The three named traps that landed in nobody's file

| Trap | Severity (risk.md) | In `unit-tests.md`? | In `e2e-tests.md`? | `decisions.md` row? |
|---|---|---|---|---|
| A — two-writer race, same unit, route + tick | P1 | No | No | **No** — `technical-plan.md` §7's row is the only one in that table whose "Tracked as" is literally `—` |
| B — LLM-off + overflow → `unavailable` | **P0** | Yes (§2b) | Yes (Case B) | DEC-11 |
| C — convergence math has no growth term | P1 | No | No | **No** — OPEN-4 tracks *measuring the static formula*, a different claim |
| D — partial parse drops a unit into neither map | **P0** | Yes (§2b) | Yes (Case A, index 40 omitted) | DEC-11 |
| E — client can't distinguish old-server from malformed `states` | P2 | No | No | No |

Both P0s are well covered — genuinely, at three layers each, with the
discriminating *combination* case (over-cap **and** LLM-off in one batch) written
as its own explicit test rather than inferred from two separate ones. That is the
right call and it defeats the "gate first vs. cap first" ordering bug the analyst
was worried about.

The problem is the other three. Note especially that `risk.md` §6 is titled
**"Disclosed-and-declined coverage — trip-wire"** and says, for A and C, that if
the test is declined the risk "needs a tracked artifact, not just a paragraph in
this file." Neither the test nor the tracked artifact exists. The trip-wire fired
into a document that nothing gates on.

### The systemic reason

**Obligations that don't fit cleanly inside one module's spec file have no owner,
so they are written down and then dropped.** Trap A is a *cross-invoker
concurrency* case — it belongs to neither `value-summary.test.js` (which owns one
composer) nor `value-summary-tick.test.js` (which owns one tick). Trap C is a
*multi-tick, changing-input* case — the unit architect's Case 4 owns "one tick,
fixed pool" and the e2e architect's Case 1 owns "two ticks, fixed pool"; nobody
owns "two ticks, moving pool." Trap E is a *cross-runtime contract* case with no
home on either side of the Vite/Node boundary.

This is the **same root cause this catalog already named for product code**, now
reproduced one layer up in the QA pipeline itself. §9.1's 2026-08-01 QA note:
*"test scope is per-module, not per-shape — the one-spec-file-per-module convention
gives a cross-consumer test no home, so it is nobody's file and does not get
written."* The planning documents inherit the same shape: `risk.md` enumerates
obligations in prose, `unit-tests.md` and `e2e-tests.md` each claim what fits their
layer, and whatever fits neither falls between them. Nothing mechanically compares
the set of named risks against the set of covered risks.

### Have we shipped this class of gap before?

**Yes — this is the 3rd on record**, and the second time in three days with the
identical shape.

1. **2026-08-01, `intake/2026-08-01-build-project-manager/`** (§9.2 QA-pass note,
   status: entry OPEN/live, cure built 2026-08-01): *"the guarded-query list is
   enumerated by hand in prose and re-typed by hand into a test table, so a query
   named in one document and not the other ships unguarded."* The plan covered 2 of
   the 5 queries QA had enumerated. Same mechanism: prose in one doc, table in
   another, no reconciliation.
2. **2026-08-02, `intake/2026-08-02-plan-lifecycle-value-ledger/`** (§9.1 QA-pass
   note, status: OPEN, count 6, cure partially built): the exact wording is worth
   quoting because it is this pass verbatim — *"cross-seam `unitKey` agreement
   (named in `risk.md` trap T2, **adopted by neither test architect**, and **its own
   stated fallback of 'then it becomes a WATCH row' also didn't happen**)."* Two
   further sibling obligations stayed homeless in the same plan.
3. **2026-08-04, this intake** — Trap A and Trap C: named in `risk.md`, adopted by
   neither test architect, and the stated fallback (a `decisions.md` WATCH row)
   also didn't happen. Three for three.

That note also records the countermeasure that **worked**: *"T6
`ledger-metrics-parity.test.js` is the first time this entry's 'per-shape, not
per-module' spec has been given a filename and a slice. That is the right
countermeasure and it works: name the file, and the spec gets written. It was
applied once; three sibling obligations of the same shape stayed homeless in the
same plan."* The fix is known and cheap. It has just never been made mandatory.

### Catalog surfaces this change lands on

- **OVERLOADED-ABSENCE** (candidate → **promoted to §9.8 by this pass**, see
  below) — this build *is* its cure for instance #1. Correctly implemented as a
  discriminated state on the wire, not a raised cap (the candidate's own text says
  raising the bound "moves the threshold and preserves the ambiguity").
- **§9.1 DERIVED-DUAL-VIEW**, write-sequence form (OPEN, 6 touches) — the "consumer
  #2 appears" moment. DEC-10's choice to extend the return shape rather than add a
  parallel entry point is the right countermeasure. Count unchanged — nothing built.
- **§9.3 VACUOUS-GUARD** (OPEN, standing rule) — plan complies on paper; the
  PLAN-LEVEL VACUOUS FIXTURE sub-pattern is live in §7d (above).
- **§9.7 HAND-SCOPED STRUCTURAL SCAN** (OPEN, 6 occurrences) — plan complies:
  consumes `assertSingleHome`, consumes the derived `filesToScan`. Verify at build,
  don't re-litigate.
- **§9.5 / §9.6** — correctly **inapplicable**, not merely complied-with. Confirm at
  build that no `ALTER TABLE` sneaks in.

## Recommendation

### Must-add-now — these gate the build, worst-first

1. **Fix the partition equation before writing any test code.** Delete
   `unit-tests.md` §7d's three-term form; adopt `e2e-tests.md` Case 2's
   `cache_hits + generated + queued + unavailable === pool_size` everywhere
   (§7b's `<=` variant too). One line, and it prevents a legitimately-red guard
   being weakened into uselessness on day one. Fix §6b's 39-vs-40 fixture prose in
   the same pass.

2. **Add the Trap C *instrument* test** — one case, ~15 lines, reusing Case 4's
   fixtures. This is my one substantive addition to the plan, and I want to be
   precise about *what* it buys, because "test for starvation" would be the wrong
   ask: whether a very active project outruns the sweep is a **tuning** question
   that can only be answered against a real fleet, and that is legitimately
   OPEN-4/WATCH-5 territory. What must be tested now is the **instrument**:
   `pending_after_sweep` is the only signal that could ever reveal starvation, and
   **no planned case ever exercises it against a pool that changed size.** If it is
   ever implemented as a decrementing counter, or from a `pool_size` captured
   before assembly, it will read as converging while the reality is treading water
   — which is *this build's own defect class* (one number collapsing two
   distinguishable trajectories) reintroduced at the observability layer.

   ```
   it("pending_after_sweep is re-derived from the live pool each sweep, not decremented")
     tick 1: assembler returns 45 units  -> pending_after_sweep === 5
     tick 2: assembler returns 48 units (3 new arrivals, same project)
             -> generation_log.pool_size === 48
             -> pending_after_sweep === 3   // 8 misses - 5 drained, recomputed
                                            // NOT 0 (decremented) and NOT 8 (stale)
   ```
   With this in place, Trap C's *behavioral* half becomes an honest WATCH: we will
   have proven the operator can see treading water in the log, which is exactly
   what OPEN-4's manual measurement needs to be meaningful.

3. **Trap A — pick one, in writing.** Either the concurrency test `risk.md`
   specifies (two overlapping `enrichPoolAltitudes` calls for the same `unitKey`
   against one DB: assert no throw, assert the row ends valid and single) **or** a
   dated `WATCH-7`. I recommend the test: it is ~20 lines, and it converts the only
   row in `technical-plan.md` §7's risk table with no tracking id into a proven
   claim. The SQL was read directly and the upsert *is* atomic, so the test will
   pass on the first try — its value is that the claim stops being a reading of the
   SQL and becomes an execution. If declined, the WATCH row is not optional; it is
   the thing that was promised and not delivered twice already.

4. **Trap E / cross-runtime state registry — cheapest honest close.** The client's
   `Altitude` union hard-codes `"queued"`/`"unavailable"` independently of the
   server's `ALTITUDE_STATES` export, and a CJS server module can't be imported
   across the Vite/Node boundary. This project has a **documented convention for
   exactly this** (§9.7, "Known remaining hand-typed member"): carry a doc comment
   naming the canonical source rather than weakening or inventing a scan — the
   precedent is `TrunkDriftResult["skipped"]`. Do that, and add one client case
   asserting an out-of-registry `states` value is not silently rendered as ordinary
   `unavailable`. If even that is too much this round, it needs a WATCH row naming
   it — right now nothing owns it the way WATCH-1 owns `WSMessage`.

**Is this safe to ship once those are in? Yes.** Items 1 and 2 are genuine gates
(one is a defect in the plan, one is a missing instrument for this build's own
acceptance criterion). Items 3 and 4 are satisfied by *either* a test *or* a dated
row — what is not acceptable is a third consecutive cycle where they are satisfied
by neither. Everything else in this plan is well above this project's bar.

### The durable cure — kills the class, not the instance

Adding four tests does not stop the next plan from dropping the next three traps.
The gap is that **nothing mechanically compares "risks named" against "risks
covered."** Make that comparison structural, using the countermeasure this project
already proved works (name the file, and the spec gets written):

> **Every trap in `risk.md` gets a stable id (T-A…T-E). Every test document cites
> the trap ids its cases cover. The strategist diffs the two sets before the QA
> pass closes, and every uncovered id must terminate in exactly one of two states:
> a named file + case id, or a dated `decisions.md` WATCH/OPEN row. "Disclosed in
> §6" is not a state.**

This is the same shape as every durable cure in this catalog — a
registry-completeness check whose scope is *derived* from the real artifact
(`risk.md`'s trap list) rather than hand-typed — applied for the first time to the
QA pipeline itself rather than to product code. It is also the direct analogue of
§9.4's acceptance criterion ("every finding from a review round must end in one of
exactly two states — fixed with a test, or recorded in `decisions.md` with an id;
*'should-fix' is a triage label, not a disposition*"), which was written for fix
rounds and evidently needs to apply to risk analyses too. Cost: one reconciliation
table at the top of this document, every run.

## Open decisions for the user

- [ ] **Trap C:** accept the growth *instrument* test as a must-add-now
      (recommended — ~15 lines, reuses existing fixtures), with the starvation
      *behavior* staying a WATCH? Or decline the test and take a `WATCH-8` row
      alone?
- [ ] **Trap A:** the ~20-line concurrency test (recommended), or `WATCH-7` with a
      trigger ("promote on any `SQLITE_BUSY`, or a user-reported inconsistent
      altitude description")? Something must land — this is the only row in
      `technical-plan.md` §7's risk table with no id.
- [ ] **Trap E + the cross-runtime `ALTITUDE_STATES` gap:** doc comment (§9.7's own
      convention) + one client test, or a WATCH row? Cheapest is the doc comment.
- [ ] **Durable cure:** adopt the trap-id ↔ coverage reconciliation as a standing
      step for every future `team-qa` run, or keep it as a one-off for this build?
- [ ] **Already actioned, reversible:** I promoted **OVERLOADED-ABSENCE** from
      candidate to a numbered catalog entry (**§9.8**) in `PROJECT-CONTEXT.md`. Its
      written trigger was met on both clauses, not on the weak "QA is the second
      person to read it" argument — see the memory note below. Say the word and it
      goes back to candidate.

---

*Memory updated:* `~/.claude/skills/team-qa/memory/qa-run-log.md` ✅ ·
`PROJECT-CONTEXT.md` — OVERLOADED-ABSENCE **promoted to §9.8** (dated 2026-08-04),
and a dated QA-pass note appended to **§9.1** recording the homeless-obligation
recurrence (occurrence count unchanged at 6 — nothing is built yet).
