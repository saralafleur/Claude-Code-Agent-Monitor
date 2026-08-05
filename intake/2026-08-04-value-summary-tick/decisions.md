# Decision Log — 2026-08-04-value-summary-tick

Run mode: **auto-pilot** (`/team-intake auto`). PREFERENCE gates are decided
automatically as `DECIDED-AUTO` with the team's best recommendation; QUALITY
gates and required-input gates still stop.

Conventions (inherited from `intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md`):
**DECIDED-AUTO** = taken by the team, Sara may reverse without reopening the build;
**PENDING (Sara)** = carries a recommendation, does not stop the build unless the
row says it does; **WATCH** = a carried-forward risk with an owner and a trigger;
**DEPENDENCY** = a hard sequencing gate.

Numbering is folder-local. `DEC-1..DEC-9`, `WATCH-1..WATCH-3`, `OPEN-1..OPEN-2`
were opened by the PM in `pm-plan.md` §6–§7 and are transcribed here verbatim in
intent so this file is the single tracked artifact for the build. `DEC-10`
onward were opened by the tech lead while writing `technical-plan.md`.

---

## PM rows (opened 2026-08-04, `pm-plan.md` §6–§7)

| Id | Subject | Status |
|---|---|---|
| **DEC-1** | Classification: `missed-requirement` + `new-feature` carve-out (Settings routes/UI) | DECIDED-AUTO (PM) |
| **DEC-2** | Sweep scope: all `project_paths`-tracked projects eligible; bounded least-recently-swept rotation; new `value_summary_sweep_state` table lands with the tick (Layer A), not with the deferred Settings layer | DECIDED-AUTO (PM) — overrides the product-owner's sweep-all on the engineer's verified git-cost evidence (`value-ledger.js:148/152/231`) |
| **DEC-3** | Hybrid (architect Option B): `POST /api/project-plans/altitudes` keeps its ≤40 same-visit fast path; the tick covers overflow only | DECIDED-AUTO (PM) |
| **DEC-4** | Observability split: v1 = per-unit state signal + tick + WS type + **audit table & its writes**; fast-follow = Settings routes + Settings UI section | DECIDED-AUTO (PM) |
| **DEC-5** | Cadence/cap defaults (`DASHBOARD_VALUE_SUMMARY_TICK_MS=600000`, `BOOT_DELAY_MS=30000`, `MAX_PROJECTS_PER_TICK=3`, 1 `enrichPoolAltitudes` call per project per sweep, `MAX_UNITS_PER_PROMPT` unchanged at 40, `DASHBOARD_VALUE_SUMMARY_TICK_MODE=off`); the technical plan publishes the coverage-latency formula and validates it at build time | DECIDED-AUTO (PM) — formula published in `technical-plan.md` §7; measurement obligation tracked as OPEN-4 |
| **DEC-6** | Single-writer guard consumes `server/__tests__/helpers/single-home.js`'s `assertSingleHome`; no second hand-rolled scope-derivation helper; red-proven by injecting a rogue call site | DECIDED-AUTO (PM) — implemented per `technical-plan.md` §4 step 9 |
| **DEC-7** | The tick joins `value-ledger.js`'s `CONSUMERS` **and** `ledger-metrics-parity.test.js` C2.4's expected array in the **same** change | DECIDED-AUTO (PM) |
| **DEC-8** | `WSMessage` union gains `value_altitudes_updated` **plus** the two pre-existing missing types (`project_plan_updated`, `value_claim_updated`) — **type-level only, no subscribers** | DECIDED-AUTO (PM) |
| **DEC-9** | `server/lib/value-summary-tick.js` gets an explicit `FILE_DISPOSITIONS` entry in `chronology-ordering.test.js`, after confirming the derivation surfaces it automatically first | DECIDED-AUTO (PM) |
| **WATCH-1** | Durable cure for the hand-maintained `WSMessage` union (server-broadcast-type ↔ client-union parity scan) — own item, not this request's cost | WATCH |
| **WATCH-2** | Settings "clear data" route (`server/routes/settings.js:172-189`) omits `value_unit_summaries` **and** `value_claims` — pre-existing. See DEC-12 for this build's disposition | WATCH |
| **WATCH-3** | Candidate pattern **OVERLOADED-ABSENCE** (recorded in `PROJECT-CONTEXT.md`'s candidate section), with the promotion trigger in `pm-plan.md` §4 | WATCH |
| **OPEN-1** | Commit or branch the ~991-line uncommitted altitude layer before build starts | **DECIDED** — resolved via DEC-13 (committed `b155f83` on `master`, then branched); confirmed clean by `build-triage` 2026-08-04 |
| **OPEN-2** | Confirm the validation project for AC-1 (recommend: Coaching Assistant, 182 units per DEC-12 of the parent effort) | PENDING (Sara) — non-blocking |

---

## Build-phase rows (appended by the tech lead, 2026-08-04)

### DEC-10 — `enrichPoolAltitudes` returns `{ altitudes, states }`; the per-unit state is server-authored

- **Status:** DECIDED-AUTO (2026-08-04)
- **Question:** AC-2 requires *queued* and *unavailable* to be visibly distinct.
  Where is that distinction computed?
- **Where we're coming from:** today the wire carries only `{ altitudes }`, and
  absence means five different things (`value-summary.js:148-151` — the
  OVERLOADED-ABSENCE instance in WATCH-3). Only `enrichPoolAltitudes` knows
  which misses were *attempted this round* (inside the ≤40 slice) and which were
  *never reached* (beyond it). The client cannot derive that without re-deriving
  the cap — which would be a second home for the same rule.
- **Options:** A) add a sibling exported helper returning states, keeping
  `enrichPoolAltitudes`'s current return shape; B) change
  `enrichPoolAltitudes`'s return to `{ altitudes, states }` and update its
  callers; C) let the client infer "queued" from list position vs. a cap it
  hard-codes.
- **Decision:** **B.** C is a §9.1 DERIVED-DUAL-VIEW by construction and is
  rejected outright. A leaves two exported entry points for one composition and
  is exactly the "divergent invocation discipline" the architect warns about in
  §4. B is a single composer with a single truth; the churn is six call sites in
  `value-summary.test.js` and one in the route, all one-line destructures. The
  HTTP response gains `states` **alongside** the existing `altitudes` key — an
  additive response-shape change, per `.claude/rules/backend-node.md`.

### DEC-11 — The state truth table

- **Status:** DECIDED-AUTO (2026-08-04)
- **Decision:** for each unit passed to `enrichPoolAltitudes`, exactly one of:
  - **resolved** — present in `altitudes` (cache hit, or synthesized this call).
    Never also present in `states`.
  - **`queued`** — a cache miss that was *not attempted this round*: it fell
    beyond `MAX_UNITS_PER_PROMPT`'s slice while the LLM path was available.
    Meaning on the wire: "known, will be picked up by a later pass."
  - **`unavailable`** — a cache miss that *was* in scope for this round and
    still produced no text: LLM mode off, `probeClaudeCli()` failed, spawn
    returned null, output unparsable, or the model omitted/garbled that index.
    When the LLM path is unavailable, **every** miss is `unavailable`, including
    over-cap ones — nothing was attempted, and the honest operator signal is
    "outage," not "backlog." This matches QA §5 step 3's manual check
    (`DASHBOARD_FOCUS_INFER_MODE=off` must render the *unavailable* copy).
- **Client fallback:** if `states` is missing or carries an unrecognized value
  (older server, live tab across an upgrade), the client renders the existing
  *unavailable* copy — today's exact behavior, so the change can never make a
  live tab worse.

### DEC-12 — `server/routes/settings.js` is not touched in v1; all four tables are added to "clear data" together in the fast-follow

- **Status:** DECIDED-AUTO (2026-08-04) — refines WATCH-2
- **Where we're coming from:** the cleanup route (lines 172-189) deletes
  `focus_summary_access_log` but has never deleted `value_unit_summaries` or
  `value_claims`. This build adds two more tables.
- **Options:** A) add only the two new tables to the cleanup route now; B) add
  all four now; C) touch the route in neither direction now, and close all four
  together with the fast-follow.
- **Decision:** **C.** A is precisely the trap the engineer named — "the two
  omissions look identical from inside a diff review and only one would be
  'new'." B expands v1 into a pre-existing-defect fix with its own test surface
  (deleting `value_claims` is a destructive-action change and
  `CLAUDE.md` forbids weakening safety controls around those casually). C keeps
  v1's diff honest and leaves exactly one atomic follow-up. WATCH-2 is upgraded
  to a **blocking precondition of the fast-follow**: the fast-follow may not add
  `value_summary_generation_log` to the cleanup route unless it adds all four in
  the same change.

### DEC-13 — OPEN-1 disposition: commit the altitude layer on `master`, then branch this build

- **Status:** DECIDED-AUTO (2026-08-04) — **reverses the PM's recommendation of a
  separate branch**; Sara may reverse this back
- **Where we're coming from:** OPEN-1. ~991 insertions across 27 files, plus two
  untracked files (`server/lib/value-summary.js`,
  `server/__tests__/value-summary.test.js`), sitting on `master`.
- **Options:** A) commit on `master`, then cut `effort/2026-08-04-value-summary-tick`
  from it; B) move the work onto its own branch first (PM's recommendation),
  then branch this build from that.
- **Decision:** **A.** The parent effort's earlier slices (`f1799e9`, `ff42f4f`)
  are already on `master`, so this change is the completion of work whose home is
  `master` — re-homing it now means a reset/cherry-pick dance on a repo where the
  `concurrent-session-risk` memory note records real work loss from exactly that
  class of operation, and that risk is larger than the benefit of a tidier
  branch. Both options satisfy the actual requirement (a valid ref-anchored diff
  base for §9.3's guard corollary, and an unentangled diff for §9.4's fix-round
  review). Preconditions on the commit are in `technical-plan.md` §4 step 1 and
  are not optional.

### DEC-14 — The audit log carries a `source` column from day one

- **Status:** DECIDED-AUTO (2026-08-04)
- **Decision:** `value_summary_generation_log` ships with
  `source TEXT NOT NULL CHECK(source IN ('tick','request'))`, even though v1
  writes only `'tick'` rows (DEC-4 keeps the request path unchanged, and adding
  a log write to it would be a second writer to reason about in the same build).
  Rationale: SQLite cannot widen a CHECK in place — the fast-follow adding
  request-path rows would otherwise need a table rebuild, which is §9.6
  NON-ATOMIC REBUILD territory. Paying one unused enum value now makes the
  follow-up additive. Documented in the schema comment as deliberate.

### DEC-15 — The tick exposes a pool-assembler test seam, and a structural assertion keeps DEC-16 honest

- **Status:** DECIDED-AUTO (2026-08-04)
- **Where we're coming from:** `assembleValuePool` does live git work on every
  call (`value-ledger.js:148/152/231`), so a hermetic tick test cannot call it
  for real. This repo's established answer to the same problem is a named
  production seam (`focus-inference.js`'s `__injectSpawnForTest`, already reused
  by `value-summary.test.js`).
- **Decision:** `value-summary-tick.js` exports `__injectPoolAssemblerForTest(fn)`
  whose production default is `require("./value-ledger").assembleValuePool`,
  **plus** a structural test (QA §3a) asserting the tick imports
  `assembleValuePool` from `./value-ledger` and contains no pool-membership SQL
  of its own. The seam is testability; the structural assertion is what keeps
  DEC-16 from being weakened by it.

### OPEN-3 — v1 ships the broadcast with no client subscriber, so AC-1's *in-place* live update is not met this round

- **Status:** PENDING (Sara) — non-blocking, but it is a knowing reduction of an
  acceptance criterion and must be read before sign-off
- **What is being declined:** DEC-8 (and the orchestrator's explicit
  instruction) scope the client change to **type-level only** —
  `PlanLedgerPanel.tsx` gains no `eventBus` subscription in this build. The tick
  therefore broadcasts `value_altitudes_updated` to nobody.
- **Consequence, stated plainly:** AC-1 as the PM wrote it ("requires **zero
  page reloads** to eventually reach full altitude coverage") is met in the sense
  that matters most — the user no longer has to reload three times to *drive*
  generation; the tick drives it unattended, and on the next mount of the panel
  every tick-resolved unit is already in `value_unit_summaries` and renders
  immediately. It is **not** met in the literal sense that a page left open
  updates in place. QA's own DoD line ("a broadcast with no listener does not
  count as 'live update' shipped") is knowingly unsatisfied for this round.
- **Why accept it anyway:** the engineer and QA both confirmed `PlanLedgerPanel`
  has never subscribed to any WS message for *any* of its data; adding the
  subscription is net-new live-update behavior for a panel that has none, and
  the PM's constraint keeps this build's behavior change to one thing.
- **Recommendation:** approve the fast-follow immediately after v1 lands. The
  server payload is deliberately shaped so the follow-up is a pure client
  addition (~20 lines: one `useEffect` + `eventBus.subscribe`, a `project_id`
  filter, a merge into `setAltitudes`) plus the two tests QA §3c specifies.
- **Carried from:** the architect's §4 closing risk ("disclosed-but-untracked
  exclusion … functionally identical to nobody having found them") — this row
  exists so that disclosure is an artifact, not a sentence.

### OPEN-4 — Coverage-latency must be measured against the real fleet before sign-off

- **Status:** PENDING (build-time measurement; Sara confirms the tuned values)
- **What:** DEC-5 requires the worst-case coverage-latency formula to be
  validated, not just published. Formula (`technical-plan.md` §7):
  `ceil(P / MAX_PROJECTS_PER_TICK) × DASHBOARD_VALUE_SUMMARY_TICK_MS × ceil(U / MAX_UNITS_PER_PROMPT)`
  where `P` = tracked projects with a `project_paths` mapping and `U` = the
  largest uncached pool.
  At the DEC-5 defaults and the known `U = 182`, this is
  `ceil(P/3) × 10min × 5`, i.e. **50 minutes for P ≤ 3 and 3h20m for P = 12**.
- **Obligation:** the implementer records the real `P` (count of distinct
  `project_id` in `project_paths`) and the real largest `U`, computes the number,
  and writes both into this row. If the result exceeds ~2h, retune
  `MAX_PROJECTS_PER_TICK` up and/or `DASHBOARD_VALUE_SUMMARY_TICK_MS` down —
  both are env vars, no code change — and record the shipped defaults here.
- **Measured at build (2026-08-04):** `P = 15` (distinct `project_id` in the
  live dashboard's `project_paths` table), `U = 182` (Coaching Assistant,
  confirmed 2026-08-03 per the parent effort's own DEC-12). At the **shipped
  code defaults** (`MAX_PROJECTS_PER_TICK=3`, `DASHBOARD_VALUE_SUMMARY_TICK_MS=600000`):
  `ceil(15/3) × 10min × ceil(182/40) = 5 × 10 × 5 = 250 min (~4h10m)` —
  **exceeds the ~2h bar.**
  **Recommendation for Sara's own `.env`** (no code change — both are already
  env-configurable, per `value-summary-tick.js`'s `numEnv(...)` reads):
  set `MAX_PROJECTS_PER_TICK=8`, leaving `DASHBOARD_VALUE_SUMMARY_TICK_MS` at
  its 10-minute default → `ceil(15/8) × 10min × 5 = 2 × 10 × 5 = 100 min
  (~1h40m)`, under the bar with the smaller of the two levers moved. Shipped
  **source defaults are left at DEC-5's original values** (3 / 600000) — this
  is an operator-tunable default, not a hardcoded ceiling, consistent with
  every other `DASHBOARD_*_MODE`/`_MS` knob in this codebase. Sara: confirm
  whether to set `MAX_PROJECTS_PER_TICK=8` in your real `.env`, or accept the
  ~4h worst case at the shipped default.

### WATCH-4 — `value_summary_generation_log` has no retention/purge in v1

- **Status:** WATCH — owner: fast-follow (Settings → Value Summaries)
- One row per project per sweep. At DEC-5 defaults that is
  `3 × 6/hour × 24 ≈ 432 rows/day` (~158k/year, a few MB) — bounded and small,
  but unbounded in principle. `focus_summary_access_log` has its own retention
  hooks in the Settings surface; this table gets the same treatment when that
  surface is built.
- **Trigger to promote:** the log exceeding ~1M rows, or any user-visible
  slowdown attributable to it.

### WATCH-5 — the tick pays `assembleValuePool`'s git cost for every swept project, with no cheap pre-gate

- **Status:** WATCH — owner: whoever reads OPEN-4's measurement
- DEC-2's own note ("bound first, then optimize") deliberately defers the
  `startRemoteSourceSync`-style cheap gate (skip the git walk when a project's
  plans/commits are unchanged since `last_swept_at`). v1 bounds cost with
  `MAX_PROJECTS_PER_TICK` instead.
- **Trigger:** the v1 audit log showing per-sweep durations that make the DEC-5
  cadence uncomfortable, or `P` growing past the point where OPEN-4's formula
  can be tuned into range with the two env vars alone.

### DEC-17 — team-qa complete (GAPPED → reconciled); proceed to team-build

- **Status:** DECIDED-AUTO (2026-08-04, auto-pilot, per team-qa's Step 5 default)
- team-qa's `qa-strategist` returned **GAPPED** on the test plan as originally
  drafted (an arithmetic bug in the audit-log partition formula repeated
  across two supporting documents, plus three of five named risk traps with
  no covering test and no `decisions.md` row). `qa-lead` reconciled all of it
  into `qa/test-plan.md`: the corrected 4-term partition
  (`cache_hits + generated + queued + unavailable === pool_size`) everywhere
  it appears, a mandatory trap-coverage table (T-A..T-E) with zero unresolved
  rows, and QA-DEC-1..4 (mirrored above as WATCH-7/WATCH-8).
- Per auto-pilot's default, proceeding to **team-build** next on
  `technical-plan.md` + `qa/test-plan.md`, on branch
  `effort/2026-08-04-value-summary-tick`.

### DEC-18 — team-build complete (BLOCKED → GREEN-WITH-CAVEATS after 3 verify
passes + 1 adversarial review); shipped to the effort branch

- **Status:** DECIDED-AUTO (2026-08-04, auto-pilot, per team-build's Step 8
  SHIP gate)
- Full account in `build/2026-08-04-value-summary-tick/build-report.md`.
  Headline: every one of 3 verifier passes + 1 adversarial review found
  something the prior pass's self-report had missed or mis-claimed,
  including the orchestrator's own first attempt at repairing the reviewer's
  S6 finding — the repaired test still didn't construct a genuine duplicate
  key, caught only by actually running the specified mutation proof. §9.3
  VACUOUS-GUARD recurred **8 times** within this one build's own pipeline;
  §9.8 OVERLOADED-ABSENCE (this build's own origin pattern) was reintroduced
  **3 times at 3 different layers** by the very cure meant to close it, all
  caught and fixed.
- Final: `npm run test:server` 1621/1621, `npm run test:client` 795/795,
  `tsc --noEmit` clean, `check-headers.sh` exit 0.
- Committed `0fdd276` on `effort/2026-08-04-value-summary-tick`, pushed to
  `origin/effort/2026-08-04-value-summary-tick`. **Not merged to `master`.**
- Two items remain genuinely open, not auto-decidable: **OPEN-4** (worst-case
  latency 4h10m at shipped defaults vs. the ~2h bar — recommend
  `MAX_PROJECTS_PER_TICK=8` in Sara's own `.env`, no code change) and
  **Task 18** (manual browser validation of the panel filling in over real
  tick cycles — never performed; every property is test-covered but nobody
  has watched it happen).

### WATCH-7 — two-writer race on `value_unit_summaries` is safe-but-wasteful, not corrupting (mirrored from `qa/decisions.md` QA-DEC-1)

- **Status:** WATCH — owner: whoever reads OPEN-4's fleet measurement
- The route's fast path and the tick can independently see the same `unitKey`
  as a miss in the same window, both spawn `claude -p`, and the second write
  wins (`ON CONFLICT(unit_key) DO UPDATE`, verified atomic at
  `server/db.js:3148-3156` — no crash, no corrupted row). Cost is a duplicated
  spawn and non-deterministic prose, not data loss. Pinned by
  `qa/test-plan.md`'s T-A test (`value-summary.test.js` ::
  "two overlapping calls for the same unitKey leave exactly one valid row and
  never throw"), which also asserts `spawnCount === 2` — the "safe but
  wasteful" characterization, deliberately blessed rather than fixed this
  round (in-flight coalescing was considered and declined as out of scope).
- **Trigger to promote:** any `SQLITE_BUSY` in the generation log, or a
  user-reported inconsistent altitude description for the same unit.

### WATCH-8 — `pending_after_sweep` must be re-derived live, never decremented (mirrored from `qa/decisions.md` QA-DEC-2)

- **Status:** WATCH — owner: whoever reads OPEN-4's measurement
- OPEN-4's coverage-latency formula assumes a static pool; `assembleValuePool`
  re-derives the pool from live git/trunk state every sweep, so an active
  project can mint new units faster than its rotation slot drains. Whether a
  *real* project actually outruns the sweep is a tuning question for OPEN-4's
  fleet measurement — but the *instrument* that would ever reveal it
  (`pending_after_sweep`) is pinned now by `qa/test-plan.md`'s T-C test
  (`value-summary-tick.test.js` :: "pending_after_sweep is re-derived from the
  live pool each sweep, not decremented"), so a later refactor can't silently
  turn it into a decrementing counter or a stale-`pool_size` read that reads
  as converging while the reality is treading water.
- **Trigger to promote:** a project whose `pending_after_sweep` does not trend
  downward across consecutive log rows.

### WATCH-6 — the log's single-writer guard will go red when the fast-follow adds request-path logging

- **Status:** WATCH — owner: the fast-follow's implementer
- `technical-plan.md` §4 step 9 asserts `insertValueSummaryGeneration` has
  exactly one production call site (the tick). DEC-14's `source='request'` value
  exists precisely so a second call site can be added later — when it is, that
  assertion must be widened **deliberately, in the same change**, exactly the way
  DEC-7 widens `CONSUMERS`. This is the tripwire working, not a defect.
