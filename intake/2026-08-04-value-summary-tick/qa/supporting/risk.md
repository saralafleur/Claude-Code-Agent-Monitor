# Risk & Regression Analysis — value-summary-tick

Grounded against: `PROJECT-CONTEXT.md`'s recurring defect-class catalog
(§9.1–§9.7 + candidate patterns OVERLOADED-ABSENCE, SHARED-BUDGET-STARVATION,
CWD-IDENTITY-FANOUT, CONTRACT-SPEC-DRIFT), the live tree
(`server/lib/value-summary.js`, `server/lib/value-ledger.js`,
`server/lib/focus-inference.js`, `server/db.js`,
`server/__tests__/chronology-ordering.test.js`,
`server/__tests__/helpers/single-home.js`), and this intake's own
`technical-plan.md` / `decisions.md` (DEC-1..16, WATCH-1..6, OPEN-1..4).
**Build status: not started** — everything below evaluates the *plan*, not a
shipped diff (per `qa/change-brief.md`).

---

## 1. Blast radius

Beyond the four files that "obviously" change, this build's actual dependency
surface is wide because `enrichPoolAltitudes` and `assembleValuePool` are each
shared, load-bearing composers:

- **`server/lib/value-summary.js`'s `enrichPoolAltitudes`** — today has one
  production caller (`routes/project-plans.js`); after this build it has two
  (route + `value-summary-tick.js`). Its return-shape change (`altitudes` →
  `{ altitudes, states }`) ripples into every test call site in
  `value-summary.test.js` (6 sites, per the plan) and into
  `client/src/lib/api.ts`'s response type and `PlanLedgerPanel.tsx`'s
  rendering — a genuine cross-language contract (server `states` values
  `"queued"`/`"unavailable"` must match the client's `Altitude` union
  literally, string-for-string).
- **`server/lib/value-ledger.js`'s `assembleValuePool`/`CONSUMERS`** — the
  tick becomes the third named consumer (route, `ccam cmdLedger`, tick). Any
  future change to `assembleValuePool`'s unit shape (`unitKey`,
  `value_source`, `cached`, etc.) now has three call sites to keep in sync,
  enforced today only by `ledger-metrics-parity.test.js` C2.4 and the DEC-16
  structural scan — not by TypeScript, since `value-ledger.js` is CJS.
- **`server/db.js`'s `stmts` table** — three new prepared statements
  (`listValueSweepTargets`, `upsertValueSweepState`,
  `insertValueSummaryGeneration`) join a single shared module every other
  route/lib/tick also reaches through. A typo in a column name here breaks at
  `require("../db")` time — i.e. it can brick **every** process that opens
  the shared DB (server, MCP, desktop, VS Code extension), not just this
  feature, per this project's own §9.6 "the caller is `require()`" lesson.
- **`server/index.js`'s `startBackgroundServices()`** — becomes home to a
  12th tick. The existing eleven (`focus-inference.js`,
  `reconciliation.js`, etc.) are the precedent this tick's shape is copied
  from; a mistake in the copy (missing `.unref()`, a synchronous throw
  instead of a `try/catch`-wrapped `require`) affects boot reliability for
  the whole server, not just Value Pool.
- **`client/src/lib/types.ts`'s `WSMessage` union** — already a
  hand-maintained cross-runtime registry (flagged WATCH-1). This build adds
  three entries at once, two of which (`project_plan_updated`,
  `value_claim_updated`) are **pre-existing drift being backfilled**, not new
  behavior — anyone diffing "what changed" needs to know two of the three
  entries are catch-up, not net-new, or a reviewer double-charges the
  scope.
- **`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`** — the
  `queued` key must land in all four locales; `i18n.test.ts`'s E1.1 derives
  the obligation from `en`, so this is enforced (not hand-typed), per §9.7
  occurrence 6's own cure.
- **`server/__tests__/single-writer-guard.test.js`,
  `chronology-ordering.test.js`, `ledger-metrics-parity.test.js`** — three
  separate structural registries all get a new entry in the same change.
  Each is this project's mandated cure for §9.1/§9.2/§9.7 respectively; if
  any one is skipped, the corresponding invariant silently stops being
  enforced project-wide, not just for this file.

## 2. Invariants that must hold (mapped to the defect-catalog)

This project has a configured, actively-used defect-class catalog
(`PROJECT-CONTEXT.md` §9.1–§9.7 + four candidate patterns). Direct matches:

- **§9.1 DERIVED-DUAL-VIEW / write-sequence form** — the `states`
  classification (resolved / `queued` / `unavailable`) is computed once
  inside `enrichPoolAltitudes` and consumed by two invokers (route, tick)
  and, downstream, by `PlanLedgerPanel.tsx`'s three-branch renderer. DEC-10
  correctly rejected the client-inference option (C) specifically to avoid
  this. **Invariant:** every unit lands in exactly one of resolved/`queued`/
  `unavailable`, and both invokers observe the *same* truth table for the
  *same* inputs (DEC-11) — this is explicitly this build's own instance of
  §9.1's "two paths that render the same thing must agree" criterion, and
  the technical plan already names it as such (§ "Variant relevance").
- **§9.3 VACUOUS-GUARD** — every structural guard this plan mandates
  (single-writer count, `assertSingleHome` dispositions, the overlap flag,
  the chronology scan) must be shown red-before-green by injection, not
  merely present. This project has shipped guards that "passed" while
  testing nothing at least eight documented times (§9.3's own log). The
  build's DoD checklist already requires red-proofs for each — QA's job is
  to verify the red observation actually happened, not take "it's in the
  plan" as evidence (§9.3's 2026-08-03 AGENT-SELF-REPORTED-RED sub-pattern:
  a reported red-proof is unverified until re-run or read).
- **§9.6 NON-ATOMIC REBUILD** — correctly pre-empted: both new tables are
  additive `CREATE TABLE IF NOT EXISTS`, no `ALTER`, no rebuild, and DEC-14
  pays for a `source` enum value (`'request'`) up front specifically so the
  fast-follow's later widening doesn't force a CHECK-widening rebuild. This
  makes §9.5/§9.6 **inapplicable rather than complied-with** — the stronger
  outcome the catalog's own 2026-08-02 lesson recommends. **Verify at build
  time that this holds**: no `ALTER TABLE` sneaks into `server/db.js`'s diff
  for either table.
- **§9.7 HAND-SCOPED STRUCTURAL SCAN** — `chronology-ordering.test.js`'s
  `filesToScan` is (confirmed by direct read, `server/__tests__/
  chronology-ordering.test.js:266`) already **derived** from
  `server/db.js` + `readdirSync("server/lib")` + `readdirSync("server/routes")`,
  not hand-typed — the new tick file will be swept into scope automatically
  and *must* first render the suite red via a missing `FILE_DISPOSITIONS`
  entry (DEC-9/step 8). Likewise `single-writer-guard.test.js` is directed
  to reuse `scanFiles`/`assertSingleHome` (confirmed present at
  `server/__tests__/helpers/single-home.js:63`, deriving scope from
  `Object.keys(require(sharedModulePath))`) rather than hand-rolling a new
  scope-derivation helper — DEC-6 names this explicitly. **This is the
  correct shape and should be verified as built, not re-litigated.**
- **Candidate pattern OVERLOADED-ABSENCE** — named by the PM *during this
  very intake* (`PROJECT-CONTEXT.md`, 2026-08-04), with
  `enrichPoolAltitudes` as its own cited live-evidence instance #1. This
  build is the direct cure. **Invariant:** the fix must not just move the
  ambiguity threshold (raising the cap would "fix" nothing per the
  catalog's own text) — it must genuinely discriminate not-yet-attempted
  from attempted-and-failed. DEC-11's truth table does this correctly on
  paper; QA must pin the LLM-off edge case explicitly (every miss →
  `unavailable`, never `queued`, when the LLM path is down) since that's
  the exact discrimination this pattern exists to test.
- **Candidate pattern CWD-IDENTITY-FANOUT** — not directly touched (the tick
  sweeps by `project_id`, already canonicalized upstream by
  `cwd-identity.js` per that pattern's cure), but worth naming: if
  `listValueSweepTargets`' `JOIN (SELECT DISTINCT project_id FROM
  project_paths)` ever sees the same physical project under two
  `project_id`s (the pattern's own still-open cross-project fan-out case,
  tracked as DEC-13 in the parent intake and confirmedly still live in
  Sara's DB), the tick will sweep — and pay LLM cost for — both, and a
  user could see two altitude sets for what they think is one project. Not
  this build's bug to fix, but its rotation query inherits the exposure.

## 3. Recurring-issue mapping — is this a known-bled surface?

Yes, directly, on three fronts documented in the catalog itself:

- **This *is* the OVERLOADED-ABSENCE candidate pattern's home surface**,
  recorded by the PM during this same intake as live evidence instance #1,
  quoting `enrichPoolAltitudes`'s own JSDoc admitting five distinguishable
  outcomes collapse into one absent value. That candidate is explicitly
  **not yet promoted** — promotion trigger (b) is "one of the two instances
  is shown to have misled a real diagnosis," which is arguably *already
  true* (this whole intake exists because the 182-unit backlog looked
  indistinguishable from a failure). Whoever signs this build off should
  consider whether shipping the cure is itself the trigger to formally
  promote the pattern, or at minimum note in `decisions.md` that this
  build is that pattern's cure landing.
- **§9.1's "consumers announced before the code exists" pre-flag form**
  applies here structurally the same way it did to
  `intake/2026-08-02-plan-lifecycle-value-ledger/`: this build creates a
  *second* production invoker of `enrichPoolAltitudes` on day one, i.e. the
  dangerous "consumer #2 appears" moment §9.1's history says is when this
  pattern actually bites. DEC-10's decision to extend the return shape
  (Option B) rather than add a parallel entry point is the correct
  countermeasure and should be graded as such.
- **§9.7's own instruction "consume the helper, don't re-derive"** is live
  here: DEC-6 explicitly reuses `assertSingleHome` from
  `server/__tests__/helpers/single-home.js`. A build that instead hand-rolls
  a second scope-derivation helper would be this catalog's "scan for copies
  of its own helpers, not just of it" lesson recurring a third time (it
  already recurred once on 2026-08-01 and once on 2026-08-02 per the
  catalog's build-outcome notes). **This is a build-time thing to verify,
  not a design gap** — the plan states the correct intent.
- Nothing here touches a catalog entry currently marked
  OPEN/REGRESSED — the closest is OVERLOADED-ABSENCE (WATCH, not yet
  promoted) and the general §9.3/§9.7 "guard-writing default output shape"
  standing rule, which applies to *every* build on this project, including
  this one, not specifically because of a prior regression on this exact
  surface.

## 4. The "ships green but broken" traps

### Trap A — the two-writer race is real but not unsafe, and nothing pins the *degraded-but-not-crashed* outcome
Investigated directly against `server/db.js:3148-3156`:

```sql
INSERT INTO value_unit_summaries (unit_key, project_level, stakeholder_level, model)
VALUES (?, ?, ?, ?)
ON CONFLICT(unit_key) DO UPDATE SET
  project_level = excluded.project_level,
  stakeholder_level = excluded.stakeholder_level,
  model = excluded.model,
  created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
```

This is a genuine atomic upsert (better-sqlite3 executes it synchronously as
one statement), so **no UNIQUE-constraint crash and no corrupted row** — the
technical plan's risk-table claim ("worst case is a duplicated spawn, not
corruption") is correct as far as it goes. But the race is real at the
*decision* layer, not the write layer: `readCached` → (async `claude -p`
spawn, real wall-clock gap) → `.run(...)` is not atomic as a whole. If the
route's fast path and the tick both sweep the *same project* in that window
(plausible: the tick's default cadence is 10 min, and a user can open the
panel at any moment, including mid-tick), both will independently see the
same `unitKey` as a miss, both spawn a `claude -p` call, and **the second
write silently overwrites the first with whatever the model returned that
time** — since the synthesis is non-deterministic LLM prose, the two writes
are not guaranteed byte-identical. Concretely: wasted spawn cost (2x LLM
calls for the same unit) plus a last-write-wins outcome the user has no way
to observe or reproduce. This is disclosed in `technical-plan.md` §7's risk
table but the row's **"Tracked as" column is `—`** — unlike every other row
in that table, it has no DEC/WATCH/OPEN id in `decisions.md`. **No test in
the 8 required tick cases (step 10) or the DEC-11 truth-table cases exercises
concurrent same-unit generation from both invokers** — the closest is case 6
(failure isolation across *different* projects in one tick), which does not
touch this. A plan that ships without either (a) a decisions.md WATCH row
for this exact race, or (b) a concurrency test proving the upsert is at
least idempotent-in-effect (same final row regardless of interleaving order,
even if the specific text can differ), lets this ship as an undocumented,
untested behavior — exactly the "disclosed in prose only" gap this task's
own instructions flag as needing a tracked artifact.

**Required assertion:** a test that starts two overlapping
`enrichPoolAltitudes` calls for the same `unitKey` (route-shaped and
tick-shaped) against a shared DB, asserts no exception, and asserts the row
ends in a valid (if last-write-wins) state — proving the "not corruption"
claim by execution, not by reading the SQL.

### Trap B — DEC-11's LLM-off edge case is the one most likely to regress silently
The truth table is explicit that when the LLM path is unavailable, **every**
miss — including ones beyond `MAX_UNITS_PER_PROMPT` that would otherwise be
`queued` — must render `unavailable`, never `queued`. This is a branch
condition (`llmAvailable()` gates the whole classification, not just the
in-cap slice) that is easy to implement as "cap first, then gate," which
would silently label an outage as a backlog. A test that only checks the
LLM-on overflow case and a *separate* test that only checks the LLM-off
in-cap case would both pass while this exact conflation ships — the
overflow + LLM-off *combination* is the one case that actually
discriminates the two implementations. **Required assertion:** a >40-unit
batch with the LLM off yields **zero** `queued` entries and **all** misses
as `unavailable` — must be its own explicit test case, not inferred from
two separate ones.

### Trap C — OPEN-4's convergence math has no growth-rate term
The published formula (`ceil(P/MAX_PROJECTS_PER_TICK) × cadence ×
ceil(U/40)`) treats `U` (largest uncached pool) as static. In production,
`assembleValuePool` re-derives the pool from live git/trunk state and
`detour_dispositions` on every sweep — new commits, new intake entries, and
new declared detours all mint new `unitKey`s continuously for an active
project. Because `value_unit_summaries` caches are permanent once written
("generated once, served forever" per the module header), a project's
*existing* backlog does monotonically shrink — but the *pool itself* is not
static, so a sufficiently active project can have new misses arrive faster
than its `ceil(P/3)`-tick turn drains 40 of them. The plan's own case 4
("Overflow drain") only proves convergence for a **fixed** 45-unit set
across two ticks — it does not model a project whose unit count grows
between sweep N and sweep N+1. That is a real, plausible-in-production
starvation shape (a highly active repo, or one whose `detectTrunkDrift`
keeps surfacing new commits) that the current 8 required tick cases do not
cover, and `pending_after_sweep` alone cannot distinguish "draining toward
zero" from "treading water" without a second data point over real time.
**This matches exactly what OPEN-4 already discloses as non-blocking** —
the gap is that the *test suite*, not just the measurement, only proves the
no-new-arrivals case. Not blocking for v1 sign-off (the log gives an
operator the raw material to notice this manually), but it should not be
mistaken for "coverage is proven to converge" — it proves "coverage
converges assuming the pool stops growing," which is a materially weaker
claim than AC-1's "eventually reach full coverage."

### Trap D — `states` and `altitudes` silently drifting on a partial-parse batch
`parseOutput` drops entries with a missing project/stakeholder string or an
out-of-range index (line ~124-131 of `value-summary.js`) rather than failing
the whole batch. DEC-11's truth table says a dropped-by-`parseOutput` index
should land as `unavailable`. **The actual code path that would need to
implement this correctly is new** — today, dropped entries simply never
appear in `result`, and the caller (`route`, pre-this-build) treats absence
uniformly. Post-build, the composer must positively enumerate "which
in-cap misses did *not* get a parsed entry back" and classify them
`unavailable`, distinct from the entries that were never attempted
(`queued`). A one-line-off implementation (e.g., only classifying entries
that got a JSON error, not entries silently dropped by the per-item
project/stakeholder validation) would under-report `unavailable` and
over-report resolved (silently missing from *both* maps) — the DEC-11 "never
zero, never two" invariant fails in the "zero" direction, which is *also*
covered on paper by DoD's "no unitKey ever appears in both maps" line but
that line doesn't catch "appears in neither." **Required assertion:** a
batch where `parseOutput` returns a valid map missing one requested index
(simulating the model omitting/garbling one unit) — assert that unit is
`unavailable`, not silently absent from both `altitudes` and `states`.

### Trap E — the client fallback branch masking a real server regression
`AltitudeText`'s "anything else non-object → existing `unavailable` key"
fallback (step 14.2) is deliberately forward-compatible (an old server or a
live tab across an upgrade should degrade gracefully) — but the same
fallback also means a **server bug that omits `states` entirely, or sends
an unrecognized string**, renders identically to a correctly-functioning
old server. A test suite that only exercises "old server" semantics (no
`states` key present) would pass even if a new-server regression shipped a
malformed `states` value for a genuinely resolved unit. **Required
assertion:** distinguish, in the client test suite, "no `states` key at
all" (expected old-server shape) from "a `states` entry with a value outside
`ALTITUDE_STATES`" (a real new-server bug) — the latter should probably be
flagged (console warning, or a client-side assertion in dev) rather than
silently rendered as ordinary `unavailable`, or at minimum QA should
confirm the plan is treating both identically *on purpose*.

## 5. Severity & priority

| # | Trap | User-visible? | Data-loss? | Severity | Priority |
|---|---|---|---|---|---|
| A | Two-writer race, last-write-wins on concurrent same-unit generation | Yes (silently different summary text depending on timing) | No (upsert is atomic, no corruption) | Medium — wasted spawn cost + non-deterministic content, not crash-worthy | **P1** — needs a decisions.md row at minimum; a concurrency test is the stronger fix |
| B | LLM-off + overflow conflated as `queued` instead of `unavailable` | Yes — directly misrepresents an outage as "will resolve later," the exact ambiguity AC-2 exists to remove | No | High — defeats the feature's own stated purpose (OVERLOADED-ABSENCE cure) | **P0** — must be its own explicit test case |
| C | Convergence math assumes no pool growth | Indirect (a very active project's Value Pool never fully fills) | No | Medium — AC-1's literal promise ("eventually reach full coverage") can be false for a subset of projects, silently | **P1** — should at minimum be a named WATCH row; a growth-rate test is a stretch goal |
| D | Partial-parse drop lands in neither `altitudes` nor `states` | Yes — a unit that should show *something* shows nothing, the exact bug class this build exists to fix, reintroduced at the edge | No | High — regresses the feature's own core guarantee ("never zero, never two") | **P0** |
| E | Client can't distinguish "old server" from "new-server bug" in `states` | Only in a regression scenario, but then silent | No | Low-Medium — masks future bugs rather than causing one now | **P2** — worth a decision either way, not blocking |

Worst-first ordering for the test plan: **B and D first** (both directly
regress this build's own acceptance criterion under realistic inputs and
would ship green under a naive happy-path suite), then **A and C** (real but
lower-severity/lower-probability), then **E** (hygiene).

## 6. Disclosed-and-declined coverage — trip-wire

Two items above are risks this round is likely to *knowingly* leave
partially or fully unguarded, and per this task's own instructions each
needs a tracked artifact, not just a paragraph in this file:

- **Trap A (two-writer race)** is already disclosed in
  `technical-plan.md` §7's risk table, but that row's "Tracked as" column is
  literally `—` — it is the **only** row in that table with no DEC/WATCH/OPEN
  id. If the build proceeds without adding a concurrency test, this needs a
  new `WATCH-7` row in `decisions.md` (owner, trigger — e.g. "promote if
  `SQLITE_BUSY` or a user-reported inconsistent altitude description
  appears in the log") before sign-off, not just this file's prose.
- **Trap C (convergence-without-growth)** is adjacent to OPEN-4 but is not
  the same claim: OPEN-4 tracks *measuring* the static-pool formula against
  the real fleet; it does not track the *growing-pool* starvation case at
  all. If the team declines to add a growth-rate test this round (reasonable
  for v1), that decision should be recorded explicitly — either as a
  clause added to OPEN-4 or a new WATCH row — so "we knew and chose not to
  test it yet" is checkable later instead of rediscovered.

Both B and D (the two P0s) should get real tests this round per their
"Required assertion" text above; they are not being recommended as
declined-coverage items.

---

**Files read for this analysis:** `PROJECT-CONTEXT.md` (full),
`intake/2026-08-04-value-summary-tick/qa/change-brief.md`,
`intake/2026-08-04-value-summary-tick/technical-plan.md`,
`intake/2026-08-04-value-summary-tick/decisions.md`,
`server/lib/value-summary.js`, `server/lib/value-ledger.js` (CONSUMERS/
`assembleValuePool` exports), `server/lib/focus-inference.js`
(`__injectSpawnForTest` precedent), `server/db.js`
(`value_unit_summaries` schema + `upsertValueUnitSummary` statement),
`server/__tests__/chronology-ordering.test.js` (`bulkInsertTables`,
`filesToScan` derivation), `server/__tests__/helpers/single-home.js`
(`assertSingleHome` scope derivation), `server/__tests__/
ledger-metrics-parity.test.js` (C2.4).
