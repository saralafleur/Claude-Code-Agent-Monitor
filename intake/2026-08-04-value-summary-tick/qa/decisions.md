# Decision Log — value-summary-tick (QA pass)

> Every clarifying / blocking question the QA team raised on this change, the
> context behind it, the options offered, and the choice made. Readable on its own.
> Newest decisions at the bottom.
>
> Status values: **PENDING** (asked, awaiting answer) · **DECIDED** ·
> **DECIDED-AUTO** (decided by the team itself under `auto-pilot`, on its own
> best recommendation, without asking) · **PARKED** (deferred to stakeholder /
> later) · **SUPERSEDED** (a later decision overrode this one — link it).
>
> Numbering is folder-local: `QA-DEC-n` in this file. Where a decision produces a
> tracked risk row that must outlive the QA pass, it is **mirrored** into
> `intake/2026-08-04-value-summary-tick/decisions.md` as `WATCH-7` / `WATCH-8`
> (that file's numbering runs `DEC-1..16`, `WATCH-1..6`, `OPEN-1..4` — 7 and 8
> are the next free ids).
>
> All four entries below were decided under **auto-pilot** by `qa-lead` on
> 2026-08-04, on `qa-assessment.md`'s own recommendations. None was asked of Sara.

---

## QA-DEC-1 — Trap T-A (two-writer race): concurrency test, or a WATCH row?
- **Item / area:** cross-invoker concurrency on `upsertValueUnitSummary`
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-04 · **Decided:** 2026-08-04 · **Decided by:** auto-pilot (`qa-lead`)
- **Recurring-issue link:** `PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW (write-sequence form)

### The question
`risk.md` §4 Trap A: after this build, `enrichPoolAltitudes` has two production
invokers (the route's fast path and the tick) that can sweep the same project in
the same window. Both independently see the same `unitKey` as a miss, both spawn
`claude -p`, and the second write overwrites the first. `technical-plan.md` §7
discloses this, but its "Tracked as" column is literally `—` — the only row in
that table with no id. Do we add the ~20-line concurrency test `risk.md`
specifies, or decline it and take a dated `WATCH-7`?

### Where we're coming from (history, as of when)
The SQL was read directly (`server/db.js:3148-3156`): the upsert *is* atomic
(`ON CONFLICT(unit_key) DO UPDATE SET ...`, executed synchronously by
better-sqlite3), so there is no UNIQUE crash and no corrupted row. The race is
real at the *decision* layer — `readCached` → async spawn → `.run(...)` is not
atomic as a whole. Impact is a wasted LLM call plus non-deterministic prose, not
data loss. None of the 8 planned tick cases and none of the DEC-11 truth-table
cases exercises concurrent same-unit generation; the closest (tick Case 6) is
failure isolation across *different* projects.

This is the third consecutive cycle on this project where a trap named in
`risk.md` was adopted by neither test architect **and** its own stated fallback
(a `decisions.md` row) also did not happen — 2026-08-01
(`build-project-manager`, guarded-query list), 2026-08-02
(`plan-lifecycle-value-ledger`, trap T2 `unitKey` cross-seam agreement), and now
2026-08-04. See `qa-assessment.md` "Have we shipped this class of gap before?".

### Options presented
- **A) Concurrency test** — ~20 lines in `value-summary.test.js`. Converts "the SQL looks atomic" from a reading into an execution. Expected to pass on the first run; its value is the standing guard, not a discovery.
- **B) `WATCH-7` only** — zero test cost, but a third consecutive undelivered promise, and the claim stays a reading of the SQL.
- **C) In-flight coalescing (dedupe by `unitKey`)** — actually removes the duplicate spawn. Real product work, not in this build's scope, and it would need its own test anyway.

### Decision
**Chosen:** A **plus** a scoped B — the test lands now; the residual *wastefulness*
(2 spawns, last-write-wins prose) is deliberately blessed and tracked.
**Note from decision-maker:** —
**Rationale / implications:** The test is `server/__tests__/value-summary.test.js`
:: `describe("enrichPoolAltitudes concurrency (T-A)")` ::
`"two overlapping calls for the same unitKey leave exactly one valid row and
never throw"` — asserts no rejection, exactly one row, and that the surviving
`project_level` is one of the two whole payloads verbatim (never a merged hybrid,
never null), and that neither call downgrades the unit to `queued`/`unavailable`.
It also asserts `spawnCount === 2`, which pins the "safe but wasteful"
characterization exactly: if in-flight coalescing (option C) ever lands, that
assertion goes red and forces this decision to be revisited knowingly rather
than drifting. **Mirror into the intake decision log as `WATCH-7`**, owner:
whoever reads OPEN-4's fleet measurement; trigger: any `SQLITE_BUSY` in the log,
or a user-reported inconsistent altitude description. `technical-plan.md` §7's
risk-table row must be updated from `—` to `WATCH-7`.

---

## QA-DEC-2 — Trap T-C (starvation): growth test now, or WATCH only?
- **Item / area:** `pending_after_sweep` as the starvation instrument vs. starvation as a behavior
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-04 · **Decided:** 2026-08-04 · **Decided by:** auto-pilot (`qa-lead`)
- **Recurring-issue link:** `PROJECT-CONTEXT.md` §9.8 OVERLOADED-ABSENCE (this build's own defect class, reintroduced at the observability layer)

### The question
`risk.md` §4 Trap C: OPEN-4's convergence formula
(`ceil(P/MAX_PROJECTS_PER_TICK) × cadence × ceil(U/40)`) has no growth term, and
`assembleValuePool` re-derives the pool from live git/trunk state every sweep, so
an active project can mint new `unitKey`s faster than its rotation slot drains
40. No planned case models a pool that changes size between ticks. Test it,
or take a WATCH row?

### Where we're coming from (history, as of when)
`qa-assessment.md` split this correctly and I am adopting the split verbatim:
whether a real project outruns the sweep is a **tuning** question answerable only
against a real fleet (that is OPEN-4/WATCH-5 territory, and "write a test for
starvation" would be the wrong ask). What *is* testable now is the **instrument**:
`pending_after_sweep` is the only signal that could ever reveal starvation, and
no planned case exercises it against a pool that changed size. If it ships as a
decrementing counter, or is derived from a `pool_size` captured before assembly,
it reads as converging while the reality is treading water — one number
collapsing two distinguishable trajectories, which is *this build's own defect
class* (§9.8, promoted 2026-08-04) reintroduced one layer up.

`technical-plan.md` step 5 is unambiguous that the correct implementation
re-derives: `pool_size = units.length` from the live assembler call, and
`upsertValueSweepState.run(project_id, nowIso, queued + unavailable)`. The test
pins that, so a later refactor cannot quietly convert it to a counter.

### Options presented
- **A) Instrument test now, behavior as a WATCH** (`qa-assessment.md`'s recommendation) — ~15-20 lines reusing the tick fixture factory, parameterized to a larger count.
- **B) Full growth-rate/starvation simulation** — many ticks, synthetic arrival rate. Expensive, and it would only prove things about the fixture's arrival rate, not the fleet's.
- **C) `WATCH-8` only, no test** — cheapest; leaves the instrument itself unproven, which is the part that is cheap and decidable now.

### Decision
**Chosen:** A.
**Note from decision-maker:** —
**Rationale / implications:** The case is
`server/__tests__/value-summary-tick.test.js` ::
`"pending_after_sweep is re-derived from the live pool each sweep, not
decremented"`. **The assessment's suggested 45→48-unit fixture was corrected to
85→88 during reconciliation** — at 45→48 the 40-unit cap does not bind on tick 2
(40 cache hits, 8 misses, all generated), so `pending_after_sweep` reads `0`
under a correct implementation *and* under both wrong ones, i.e. the case would
have been vacuous (§9.3's PLAN-LEVEL VACUOUS FIXTURE sub-pattern, the same
sub-pattern the assessment itself flagged in `unit-tests.md` §7d). At 85→88 the
cap binds on both ticks: correct = `8`, decremented = `5`, stale-`pool_size` =
`5`. The mutation proof (temporarily implement the decrement form, observe red,
restore) is mandatory. The *behavioral* half is declined and **mirrored into the
intake decision log as `WATCH-8`**, explicitly linked to OPEN-4 (which tracks
measuring the *static* formula — a different claim), owner: whoever reads OPEN-4's
measurement; trigger: a project whose `pending_after_sweep` does not trend
downward across consecutive log rows. Consequence of deferring: AC-1's literal
promise ("eventually reach full coverage") can be false for a very active subset
of projects — but the operator can now see it in the log, which is what makes
OPEN-4's manual measurement meaningful.

---

## QA-DEC-3 — Trap T-E: cross-runtime `ALTITUDE_STATES` gap — doc comment, test, or WATCH?
- **Item / area:** client cannot distinguish an old-server absent `states` from a new-server malformed `states`
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-04 · **Decided:** 2026-08-04 · **Decided by:** auto-pilot (`qa-lead`)
- **Recurring-issue link:** `PROJECT-CONTEXT.md` §9.7 HAND-SCOPED STRUCTURAL SCAN ("known remaining hand-typed member" convention)

### The question
`risk.md` §4 Trap E: `AltitudeText`'s "anything else → `unavailable`" fallback is
deliberately forward-compatible, so an old server (no `states` key) and a
new-server bug (a `states` value outside `ALTITUDE_STATES`) render **identically**.
The client's `Altitude` union also hard-codes `"queued"`/`"unavailable"`
independently of the server's export, and a CJS server module cannot be imported
across the Vite/Node boundary. Doc comment, doc comment + test, or a WATCH row?

### Where we're coming from (history, as of when)
`unit-tests.md` §8 flagged this and explicitly declined to invent a fix (correct —
inventing a brittle source-text scan would itself be §9.7's failure mode).
`e2e-tests.md` did not touch it. No WATCH row owns it the way WATCH-1 owns
`WSMessage`. Meanwhile `PlanLedgerPanel.test.tsx`'s line-411 test is about to
become a *deliberate* old-server compatibility case — which means the suite would
be asserting the ambiguous behavior on purpose while nothing distinguishes the
bug case. This project has a documented convention for exactly this shape (§9.7,
precedent `TrunkDriftResult["skipped"]`): carry a doc comment naming the
canonical source rather than weakening or inventing a scan.

### Options presented
- **A) Doc comment only** — cheapest honest close; leaves the two cases rendering identically with nothing to tell them apart at runtime.
- **B) Doc comment + one client test + a dev `console.warn`** — makes an out-of-registry value visible instead of silent; ~5 lines of product code, ~10 of test.
- **C) `WATCH-9` row only** — a fourth tracked-but-unbuilt item on a build that already has three.

### Decision
**Chosen:** B.
**Note from decision-maker:** —
**Rationale / implications:** Three parts. (1) A doc comment above
`PlanLedgerPanel.tsx`'s `Altitude` union naming `server/lib/value-summary.js`'s
`ALTITUDE_STATES` as canonical and this as a known hand-typed member (§9.7's own
convention — do **not** invent a scan, do **not** weaken the union to `string`).
(2) A small additive product change: when `res.states?.[u.id]` is present but
outside the known set, `console.warn` once naming the unit id and the value, then
fall through to the existing `unavailable` render — user-visible behavior is
unchanged, so this cannot regress the old-server path. (3) Two paired client
assertions: the existing absent-`states` test gains
`expect(warnSpy).not.toHaveBeenCalled()`, and a new case
`"an out-of-registry states value warns and does not masquerade as an old-server
absence"` asserts the warn fires exactly once. Together they are the thing that
distinguishes the two cases, which is precisely what Trap E asked for.
**Additionally**, the chain is closed *mechanically* on the server side by a new
registry-derived check (`server/__tests__/value-summary.test.js`: every
`ALTITUDE_STATES` member must have a `planLedger.pool.altitudes.<state>` key in
`en/projectDetail.json`, scope derived from the export), which `i18n.test.ts`
E1.1 then propagates to `ko`/`vi`/`zh`. No WATCH row is needed — T-E resolves as
"covered by test" in the trap table. This is a small scope addition beyond
`technical-plan.md` step 14; it is dev-facing only and reversible.

---

## QA-DEC-4 — Durable cure: trap-id ↔ coverage reconciliation, one-off or standing?
- **Item / area:** the QA pipeline's own gap class — a named risk that lands in nobody's test file
- **Status:** DECIDED-AUTO (partial — the standing-process half needs Sara)
- **Raised:** 2026-08-04 · **Decided:** 2026-08-04 · **Decided by:** auto-pilot (`qa-lead`)
- **Recurring-issue link:** `PROJECT-CONTEXT.md` §9.1 (QA-pass note, 2026-08-02) and §9.4's "every finding ends in exactly one of two states" acceptance criterion

### The question
Nothing mechanically compares "risks named in `risk.md`" against "risks covered
by a test document." Three cycles in a row, a named trap was adopted by neither
architect and its stated `decisions.md` fallback also never happened. Adopt the
trap-id ↔ coverage reconciliation table as a standing step for every future
`team-qa` run, or keep it as a one-off for this build?

### Where we're coming from (history, as of when)
`qa-assessment.md` diagnosed the systemic cause: obligations that don't fit
cleanly inside one module's spec file have no owner, so they are written down and
then dropped — the same root cause §9.1 already named for product code
("test scope is per-module, not per-shape"), reproduced one layer up in the QA
pipeline itself. It also recorded the countermeasure that **worked** on
2026-08-02: *"T6 `ledger-metrics-parity.test.js` is the first time this entry's
'per-shape, not per-module' spec has been given a filename and a slice. That is
the right countermeasure and it works: name the file, and the spec gets written.
It was applied once; three sibling obligations of the same shape stayed homeless
in the same plan."* The fix is known and cheap; it has just never been mandatory.
§9.4's acceptance criterion already says this for fix rounds — *"'should-fix' is
a triage label, not a disposition"* — and evidently needs to apply to risk
analyses too.

### Options presented
- **A) One-off for this build** — the table exists here, the next plan drops the next three traps.
- **B) Standing step, enforced by the `team-qa` skill templates** — `risk.md` assigns stable trap ids; each test document cites the ids it covers; `test-plan.md` must carry a reconciliation table with zero unresolved rows before the QA pass closes.
- **C) A mechanical checker script** — parses `risk.md`'s trap ids and diffs them against `test-plan.md`. Strongest, but new tooling nobody asked for.

### Decision
**Chosen:** B, adopted in full **for this plan**; the template change is flagged
for Sara rather than made unilaterally.
**Note from decision-maker:** —
**Rationale / implications:** `test-plan.md` now carries a mandatory
"Trap-coverage reconciliation" table with stable ids T-A…T-E, each terminating in
either `covered by test: <file> :: <case>` or `declined, see decisions.md:
<row id>`, and "the trap-coverage table has zero unresolved rows" is a Definition
of Done line. That closes the loop for this build. Making it standing requires
one line in `~/.claude/skills/team-qa/templates/test-plan.md` (a mandatory
"Trap-coverage reconciliation" section) and one in the `risk.md` template
("assign each trap a stable id `T-<letter>`") — **those are configuration files
under `~/.claude/` and I have not edited them**; an agent instruction is not
authority to change Sara's tooling config. Sara: if you want this standing, that
is the exact two-line change. Option C is not recommended yet — the table is the
cheap 80%, and a parser can follow if the table alone proves insufficient.
