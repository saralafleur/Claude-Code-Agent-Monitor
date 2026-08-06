# Test Plan — auto-group-proposal (Value Pool Slice 3)

> Authored by `qa-lead`, synthesizing `supporting/coverage.md`,
> `supporting/risk.md`, `supporting/unit-tests.md`, `supporting/e2e-tests.md`
> and the strategist's verdict in `qa-assessment.md` (**GAPPED**, four binding
> rulings R1–R4). This is the buildable deliverable: exactly what tests to add
> or modify, in dependency order, with the assertions written out. It does not
> write test or product code.
>
> **Forward mode.** Nothing in Slice 3 is built. Baseline to diff against:
> server **1787/1787**, client **822/822**, both GREEN (2026-08-06).
>
> **Priority legend** — `[M]` MANDATORY (gates the build; a build without it is
> not done), `[R]` REQUIRED (plan-of-record obligation with a named catalog
> exposure), `[D]` DURABLE CURE (kills the class, not the instance),
> `[N]` NICE-TO-HAVE (real value, explicitly not a gate).

---

## Objective

Slice 3 adds a proposal-only grouping engine (mechanical pre-grouping → one
sonnet call per batch → three new tables → `PlanLedgerPanel` review) over a
surface that is **100% unguarded today** — 0 hits for `value_group*` /
`value-groups` anywhere in `server/`, `client/`, or `server/__tests__/` — and
in the same change set discharges SF-4 by extracting `buildProbeCoverage`,
which deliberately deletes the only route↔route composition guard this project
has (`T7`). This plan builds **5 new spec files, 1 additional e2e boot spec,
and 7 edited specs**, so that at the end: (1) every one of the three new
orthogonal state axes (5 run states × 4 refinement states × 3 availability
states) is a partition proven by assertion rather than by registry
declaration, including the **branch-ordering seams** between them; (2) the
acceptance property the whole feature exists under — *proposals are never
actions* — is pinned by four independent, red-proven sub-checks; (3) the five
distinct claims T7 makes each have a **named successor** before T7 is deleted,
so the SF-3 `draining` fix and the load-bearing SF-2/SF-3 `requestedAt`
divergence stay regression-proofed across the extraction; and (4) the four
hand-typed registries this slice must extend (`CONSUMERS`, both
`assertSingleHome` consumer maps, `ledger-metrics-parity.test.js`'s C2.4) are
brought under a single **derived, fail-closed** consumer-scope guard instead of
being hand-edited a fourth consecutive time.

---

## Coverage gap being closed

| # | UNGUARDED surface today | Catalog id | What now pins it |
|---|---|---|---|
| G1 | The five-key `coverageSnapshot` argument set (`computedAt/counts/draining/projectId/requestedAt`) after T7's deletion — **currently has no successor in any plan document** | **§9.1 DERIVED-DUAL-VIEW** (occ. 7, regression-of-a-fix) | `value-coverage-probe.test.js` **P-7** — behavioral spy on the `coverageSnapshot` invocation inside `buildProbeCoverage`, `deepEqual` on the received argument keys against the same literal array T7 anchored (§ "R2 anchor successor" below) |
| G2 | `buildProbeCoverage`'s single-home / call-site scope (module does not exist) | §9.1 | `single-writer-guard.test.js` **G-1/G-2/G-3** — definition-site set, exactly-3-call-site brace-walk, derived fail-closed importer scan |
| G3 | `CONSUMERS`' own completeness — nothing greps real importers against the array | **§9.7 HAND-SCOPED STRUCTURAL SCAN** (7 occ., most recent SF-5 one slice ago) | `assertConsumerScopeDerived` (**D2**, new helper) + `ledger-metrics-parity.test.js` **C2.4** updated to the 4-entry anchor |
| G4 | `assertSingleHome` consumer axis for `../lib/value-groups` on **both** maps | §9.7 | `single-writer-guard.test.js` **G-4/G-5/G-6** |
| G5 | All 5 run states / 4 refinement states / 3 availability states, and the **seams between** them | **§9.8 OVERLOADED-ABSENCE** (promoted on this file family 2026-08-04, recurred next build) | `value-groups-api.test.js` **TT-a…TT-i + TT-read** (one truth table, one test) + `value-groups-refinement.test.js` **R-7** partition biconditional + **D-4** availability partition |
| G6 | "Proposals never actions" — no structural or behavioral proof exists | not catalogued; the feature's single acceptance property | `value-groups-api.test.js` **N-1…N-4**, all four red-proven by injection |
| G7 | `approve` under drift — no freshness check, named in no `decisions.md` row | §9.8 / PM-1 race | `value-groups-api.test.js` **E-6.5** drift-invariant (R4's must-add-now half) + `WATCH-S3-F` for the deferred behavior change |
| G8 | Mechanical pre-grouping correctness, incl. **intentional over-generation** | **§9.3 VACUOUS-GUARD** (9/9/4 events on the 3 prior builds of this family) | `value-groups-mechanical.test.js` **M-1…M-9**, red-proven by disabling one heuristic |
| G9 | `groupingFacts` → `computeGroupingDigest` field parity (`unitFacts` now has **two** downstream comparators) | §9.1, 2nd axis — structural re-run of occ. 7 | `value-groups-refinement.test.js` **R-9** `GROUPING_UNCOMPARED_FIELD_GUARANTORS` key-walk |
| G10 | Crashed run rendering a permanent spinner | §9.8 | `value-groups-refinement.test.js` **R-10…R-13** + `value-groups-interrupted-boot.test.js` **E-5** |
| G11 | Client re-derivation of server-computed rollups; entity-switch leak; StrictMode blindness | §9.1 client half; MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH (SF-8); STRICTMODE-BLIND (BL-2) | `PlanLedgerPanel.groups.test.tsx` **C-1…C-7** |
| G12 | Four-locale key mirroring for 6 new registries | §9.7 / N2 class | **C-8** locale-mirror registry test |

Explicitly **not** in scope (confirmed inapplicable, not skipped): §9.5
FRESH-DB-BLIND and §9.6 NON-ATOMIC REBUILD — all three tables are plain
`CREATE TABLE IF NOT EXISTS`, zero `ALTER`, zero `UPGRADE_CASES`/
`REBUILD_CASES`. **S-3** asserts that inapplicability rather than resting on
"nothing failed."

---

## R2 anchor successor — the single most important item in this plan

`qa-assessment.md` R2 rules, verified byte-for-byte against
`server/__tests__/project-plans-api.test.js:905-999`, that **T7 is deleted in
full — zero lines survive**, because its entire mechanism is regex-scanning the
route-handler source text, which the extraction empties. `change-brief.md`'s
claim that "the anchored response-key-set assertion at lines 988-998 survives
unmodified" is **factually wrong** and is corrected as build obligation
**BO-1**. T6 (`:886-903`) is *not* T7's anchor: T6 anchors the **HTTP response
body**'s nine `snake_case` keys; T7 anchors the **`coverageSnapshot` call's
argument set**'s five `camelCase` keys. Different closed sets.

T7 makes **five distinct claims**. Every one gets a named successor, and the
DoD line is *"every row has a named successor, each observed red"* — never
*"T7 deleted."* This table is `D1`'s first instance and is copied verbatim into
`technical-plan.md` §6.1 as **BO-2**.

| id | T7's claim | Named successor | Priority |
|---|---|---|---|
| **T7-C1** | Both handlers call `assembleValuePool(dbModule, { id: projectId })` | `single-writer-guard.test.js` **G-2** (exactly-3-call-site brace-walk of `buildProbeCoverage(`) + `value-coverage-probe.test.js` **P-1** (composed output key set) | `[M]` |
| **T7-C2** | Both call `enrichPoolAltitudes(..., { probe: true })` | **G-2** + `value-coverage-probe.test.js` **P-5** (counts come from the composer, anchored to a literal fixture-derived number) | `[M]` |
| **T7-C3** | Both pass `draining: isDrainingProject(projectId)` — **the SF-3 fix** | `value-coverage-probe.test.js` **P-6** — the only thing regression-proofing SF-3 after deletion. Must not be dropped or merged into another case. | `[M]` |
| **T7-C4** | `postKeys === getKeys` (route↔route parity) | **Deliberately NOT replaced** (DEC-S3-4: one function now, so this degenerates to `deepEqual(f(X), f(X))` — the exact PARITY-WITHOUT-ANCHOR vacuity Slice 2 shipped). Recorded as an intentional non-replacement, not an oversight. A build that adds it back fails review. | `[M]` (as a *negative* instruction) |
| **T7-C5** | `postKeys === ["computedAt","counts","draining","projectId","requestedAt"]` — **the anchor** | **`value-coverage-probe.test.js` P-7 + P-8**, specified in full below. Previously orphaned. | `[M]` |

### P-7 — the T7-C5 successor, specified concretely

**File:** `server/__tests__/value-coverage-probe.test.js`
**Test name (stable, greppable — use this string verbatim):**
`"T7-C5 successor: buildProbeCoverage invokes coverageSnapshot with exactly the five-key argument set (SF-2/SF-3 anchor, inherited from the deleted T7)"`

**Mechanism — behavioral spy, not a source scan.** Before requiring
`../lib/value-coverage-probe`, `require("../lib/value-coverage")` and replace
its exported `coverageSnapshot` with a recording wrapper that captures
`Object.keys(argsObject)` and delegates to the real implementation. Call
`buildProbeCoverage(dbModule, projectId)` against a seeded project, restore the
original export in a `finally`/`after`, then:

```
assert.deepEqual(
  capturedArgKeys.slice().sort(),
  ["computedAt", "counts", "draining", "projectId", "requestedAt"].slice().sort(),
  "SF-2/SF-3 anchor: coverageSnapshot's argument set is closed. A new key here " +
  "(or a dropped `draining`) is the regression the deleted T7 existed to catch."
);
```

Assert **exactly once**, and assert the recording wrapper was invoked exactly
once per `buildProbeCoverage` call (so a build that stops calling
`coverageSnapshot` at all fails loudly instead of trivially passing with an
empty capture — this is the failure shape T7 itself would have degenerated into
after extraction).

**Build obligation BO-5 (this test's precondition):**
`server/lib/value-coverage-probe.js` MUST call the function through the module
namespace object — `valueCoverage.coverageSnapshot(dbModule, {...})` — not via
a destructured binding captured at require time, or the spy cannot observe it.
This is a one-line style constraint on the new module and is cheaper than the
alternative (relocating T7's regex scan to the new file, which would preserve
the anchor but also preserve its brittleness). Record it in the new module's
header comment so a later "tidy the imports" edit does not silently disarm the
anchor.

**P-8 `[R]` — `computedAt` freshness**, which no existing or planned case
covers: assert `computedAt` passed to `coverageSnapshot` is a fresh ISO
timestamp generated at call time (>= a timestamp captured immediately before
the call, and **not** equal to the seeded `coverage_requested_at`), pinning
that `computedAt` and `requestedAt` are two genuinely different facts. This is
the same both-facts-true rule that TT-i and TT-read enforce on the route layer.

**Red-first proof for P-7:** locally delete `draining:` from the
`coverageSnapshot(...)` call in `value-coverage-probe.js` → P-7 fails naming
the missing key (and **P-6** fails behaviorally) → restore byte-identical →
green. Separately, add a sixth key locally → P-7 fails → revert. Both
performed and **independently re-run by someone other than the author**
(§9.3 AGENT-SELF-REPORTED-RED).

---

## Test change set

Layers discovered in this project (not assumed): (a) backend pure-function /
module specs, (b) backend cross-cutting *structural registry* specs that live
in shared files, (c) backend route+DB specs booting the real Express app
against a real throwaway SQLite over real HTTP — **this project's "E2E"; there
is no Playwright/Cypress harness and no smoke/regression tag system**, (d)
client component specs (Vitest + RTL), (e) client screen snapshots.

### (a) Backend — pure-function / module specs

**`server/__tests__/value-groups-mechanical.test.js` — NEW**

| id | Pri | Assertion |
|---|---|---|
| M-1 | `[R]` | slug signal: exactly one `signal:"slug"` cluster whose sorted `memberUnitKeys` **equals** `[initiativeKey, matchingCommitKey].sort()`; the unrelated commit's key is **absent**. Never `Array.isArray` / `length > 0`. |
| M-2 | `[R]` | time signal: same-`localDayLabel()` pair is exactly the `signal:"time"` cluster's membership (import `localDayLabel` from `focus-summary.js`, never hand-recompute); the day-apart unit is absent. |
| M-3 | `[R]` | units with no `seen_at` are ineligible for the time signal **and counted**: `signalAudit.time.units_without_timestamp` equals the exact fixture count, not `> 0`. |
| M-4 | `[R]` | shared-surface signal (label/path substring proxy, WATCH-S3-B v1 scope): exact membership as M-1. |
| M-5 | **`[M]`** | **over-generation is by design**: a unit satisfying both slug and time appears in **both** clusters' `memberUnitKeys`, never deduped. `risk.md` ranks this the guard most likely to ship vacuous — a test author who treats overlap as a bug will loosen or narrow it until the guard is dead. |
| M-6 | `[R]` | determinism: two calls, second with a shuffled input array, `deepEqual` on the full sorted-by-`clusterId` output. |
| M-7 | `[R]` | `clusterId` is byte-identical across M-6's two calls (stable hash of signal + sorted members, not insertion order). |
| M-8 | `[N]` | file-level invariant, stated in the spec's top comment: `mechanicalPreGroup(units)` takes no `dbModule` and this spec contains **zero** spawn/db mocks. Reviewer-checked, not a runtime assertion — its value is making a future `dbModule` param a visible diff. |
| M-9 | `[R]` | completeness / no silent drop: an isolated unit lands in `ungrouped` with `reason:"no_shared_signal"`, **and** every input key appears in at least one cluster **or** in `ungrouped` (whole-fixture assertion, not per-branch). |
| M-10 | `[R]` | anchored exemption-set: `deepEqual(GROUP_RUN_STATES.filter(s => !GROUP_RUN_ROW_STATES.includes(s)), ["not_attempted"])`. Lives here (needs no DB/spawn). PM-5c shape. |

**`server/__tests__/value-coverage-probe.test.js` — NEW**

| id | Pri | Assertion |
|---|---|---|
| P-1 | `[M]` | `Object.keys(result).sort()` equals T6's own anchor array `["complete","computed_at","demand","described","eta","pending","pool_size","project_id","requested_at"]` — **reuse T6's array, do not author a second copy** (§9.1 rule 2). |
| P-2 | `[M]` | `opts.requestedAt`, when provided, is used **verbatim** and never re-read from `getValueSweepState` — seed a *different* `coverage_requested_at` and assert the passed value wins. This is the SF-2/SF-3 divergence DEC-S3-2 says must not be "helpfully" normalized away by the extraction. |
| P-3 | `[R]` | `opts.requestedAt` omitted → falls back to the sweep-state row's `coverage_requested_at` exactly (GET-path behavior). |
| P-4 | `[R]` | no sweep-state row → `result.requested_at === null` **strictly** (`===`, not `== null`) — `undefined` and `null` are not interchangeable on the wire. |
| P-5 | `[M]` | counts come from `enrichPoolAltitudes(..., {probe:true})` with **no re-derivation inside** `buildProbeCoverage` — anchored to a literal fixture-derived number, never `deepEqual(f(x), f(x))`. |
| P-6 | `[M]` | `result.draining` matches `isDrainingProject(projectId)` for one draining and one non-draining project. **T7-C3's sole successor.** |
| P-7 | `[M]` | **The T7-C5 anchor successor** — see the dedicated section above. |
| P-8 | `[R]` | `computedAt` freshness, and `computedAt !== requestedAt`. |

**`server/__tests__/value-groups-refinement.test.js` — NEW**

| id | Pri | Assertion |
|---|---|---|
| R-1 | `[R]` | anchored exemption-set: `GROUP_REFINEMENT_STATES` sorted-equals `["failed","pending","refined","zero_members"]`. |
| R-2 | `[R]` | `pending`: a persisted mechanical cluster pre-refinement has `refinement_state === "pending"` and `name`/`summary_sentence`/`rationale` **strictly `null`** (not `""`, not `undefined`). |
| R-3 | `[R]` | `refined`: a stubbed sonnet payload persists with all four fields matching the stub's literal strings **field-by-field** (AC-2's bar: a proposal missing any field is a defect). |
| R-4 | `[R]` | `zero_members`: a stub whose every `memberUnitKeys` entry is outside the cluster set → keys dropped, row lands `zero_members`, **not** `refined` with an empty member list. |
| R-5 | **`[M]`** | `failed`-batch **disclosure**: stub rejects → the group row still exists (disclose, not vanish), `refinement_state === "failed"`, all three text fields `null`, and `value_group_members` equals the mechanical cluster's membership byte-for-byte. `risk.md` §4.3 ranks a guard that checks only "the response looks like a proposal" as the one that would pass while a partial write promotes a group to `refined` it never earned. |
| R-6 | `[R]` | a single batch's failure does not fail the run: two-batch fixture, one failing → `run.state === "completed"`, not `"failed"` (run-level `failed` is reserved for a pass producing **no** group rows). |
| R-7 | **`[M]`** | **partition biconditional across all four refinement states**: seed one row per state, one query, one loop — `name`/`summary_sentence`/`rationale` are non-NULL **if and only if** `refinement_state === "refined"`. This is the executable form of "the client must never infer state from NULL-ness," and proving the inverse is what makes it server-enforced. |
| R-8 | `[R]` | `parseGroupingOutput` returns the documented `null` sentinel (never a persisted group) for: malformed JSON; the prompt echoed back verbatim; a payload missing a required field. **The `status:"claimed"` adversarial case does NOT live here — see N-4.** |
| R-9 | **`[M]`** | `GROUPING_UNCOMPARED_FIELD_GUARANTORS` key-walk: walk **every** key of `groupingFacts(unit)`, mutate it, assert `computeGroupingDigest` changes — or the key is listed in the guarantors registry with a stated reason. Plus a structural scan that `buildGroupingPrompt` reads **only** `groupingFacts` output. This is the exact defect that shipped 2026-08-05 on `unitFacts`→`compareUnitInputs` behind a JSDoc calling it "physically impossible"; `unitFacts` now has **two** comparators. `risk.md`: this is the assertion most likely to be quietly narrowed. |
| R-10 | `[R]` | `reconcileInterruptedGroupRuns`: a surviving `in_progress` row → `state === "failed"`, `error_reason === "interrupted_restart"`, `completed_at` non-null. |
| R-11 | `[R]` | terminal rows (`completed` / `completed_zero_groups` / `failed` **with a different `error_reason` such as `llm_error`**) are left byte-identical — proves it does not overwrite a more specific existing failure reason. |
| R-12 | `[R]` | 3 `in_progress` rows across 2 projects all flip in one call. |
| R-13 | `[R]` | boot-wiring source scan: `server/index.js` contains `reconcileInterruptedGroupRuns(` inside a `try { … } catch (err) { console.warn(…) }` block in the same region as `startValueSummaryTick(broadcast)` (`:465-470`). Source-text scan, **not** `require("../index")` — no spec in this codebase boots the server that way. |
| D-1…D-4 | `[R]` / D-4 **`[M]`** | `resolveMemberAvailability` (pure): anchored exemption-set `["already_claimed","available","no_longer_in_pool"]`; precedence — a member in **both** claims and the live pool is `already_claimed`, never `available`; in-pool-unclaimed → `available`; in neither → `no_longer_in_pool`. **D-4 `[M]`: partition** — across a mixed multi-group fixture, each group's three counts sum to its member-row count **and** a `Set` of counted keys has size equal to the member-row count (no key double-counted). |

### (b) Backend — cross-cutting structural registry specs (shared files, edited in place)

**`server/__tests__/single-writer-guard.test.js` — EDIT**

| id | Pri | Assertion |
|---|---|---|
| G-1 | `[M]` | `buildProbeCoverage` is defined exactly once: `scanFiles(serverDir, /buildProbeCoverage/)` basenames (excluding `*.test.js`) equal exactly `["project-plans.js","value-coverage-probe.js"]`. |
| G-2 | `[M]` | **Call-site set is exactly three**: brace-walk (reuse the existing `stripComments` + brace-depth walker in this file) the `POST /coverage-request`, `GET /coverage`, and `POST /groups/propose` handler bodies; `buildProbeCoverage(` appears **exactly once in each**, and the whole-file total is **exactly 3** (catches a 4th call site hiding outside all three). Successor to T7-C1/C2. |
| G-3 | `[D]` | Derived, fail-closed importer scope for `value-coverage-probe.js` — see **D2** below; this case becomes the first caller of `assertConsumerScopeDerived`. |
| G-4 | `[M]` | `assertSingleHome("../lib/value-coverage-probe", { "../routes/project-plans": { shared: ["buildProbeCoverage"], absent: [] } })`. |
| G-5 | `[M]` | `assertSingleHome("../lib/value-ledger", …)` (existing block ~`:462`) gains `"../lib/value-groups": { shared: ["unitKey"], absent: ["assembleValuePool","VALUE_SOURCES","ATTRIBUTION_TIERS","BACKFILL_LOOKBACK_DAYS","CONSUMERS","rowToUnit","computePlanHealth","summarizeDeliveredValue","MUTABLE_VALUE_SOURCES"] }`. The `absent: ["assembleValuePool", …]` entry is the **executable** proof of DEC-S3-10's "never calls `assembleValuePool` itself." |
| G-6 | `[M]` | `assertSingleHome("../lib/value-summary", …)` (existing block ~`:413`) gains `"../lib/value-groups": { shared: ["unitFacts","summaryModel"], absent: ["buildPrompt","parseOutput","SUMMARY_STAGES","MAX_UNITS_PER_PROMPT","ALTITUDE_STATES","compareUnitInputs","ALTITUDE_FRESHNESS","UNCOMPARED_FIELD_GUARANTORS","enrichPoolAltitudes"] }`. |
| G-7 | `[M]` | New `assertSingleHome("../lib/value-groups", …)` with **two** consumer entries: `"../routes/project-plans"` (shared: every route-facing export per `technical-plan.md` §9) **and** `"../index"` (`shared: ["reconcileInterruptedGroupRuns"]`, absent: everything else). Missing the boot-hook consumer is exactly the under-registration §9.7 has 7 instances of. |
| G-8 | `[R]` | New writer guards for `insertValueGroup*` / `updateValueGroupRunState` / member inserts, matching the existing `requestValueCoverage` guard's shape (`:346-385`). |
| G-9 | `[M]` | **Negative instruction, recorded in a top-of-block comment:** do NOT add any `deepEqual(postCoverageResult, getCoverageResult)` route↔route parity assertion here or in `project-plans-api.test.js` (DEC-S3-4 / T7-C4). Both sides now call one function; such a comparison is `deepEqual(f(X), f(X))` — the exact vacuity `value-coverage-parity.test.js` shipped in Slice 2. |

**`server/__tests__/project-plans-api.test.js` — EDIT**

- `[M]` **Delete the entire `it("T7 (SF-4): …")` block, lines 905–999 inclusive.
  Zero lines survive.** Do not adapt it, do not preserve `:988-998`, do not
  leave a partially-scanning T7 standing — that is precisely how "adjusted
  until it passes" (§9.4's named temptation) happens.
- `[M]` **T3, T4 and T6 are untouched.** None source-scans a handler body;
  none is affected by the extraction. T6 (`:886-903`) continues to anchor the
  nine-key **response body** — it is *not* T7's anchor and must not be edited
  to pretend it is.

**`server/__tests__/ledger-metrics-parity.test.js` — EDIT (R3: absent from `technical-plan.md` §9's change-set table; carried here AND flagged back)**

- `[M]` **C2.4** (`:282`) — update the `deepEqual` literal to the 4-entry set.
  The test sorts both sides with `.slice().sort()`, so ordering is free;
  membership is not:

```
[
  "server/routes/project-plans.js",
  "bin/ccam.js (cmdLedger)",
  "server/lib/value-summary-tick.js",
  "server/lib/value-groups.js (derived-values reader: pre-grouping + member availability)",
]
```

- `[M]` Update C2.4's **test title** — it currently reads *"CONSUMERS names
  exactly the route, the CLI, and the tick (DEC-16)"*, which becomes false —
  and its **failure message**, which currently says a fourth consumer "must be
  a deliberate, reviewed addition," to name the widened growth rule from BO-3.
- Without this edit C2.4 **goes red by construction** the moment
  `value-ledger.js:70-74` gains the 4th string. A red test discovered mid-build
  with no planned case description is the exact condition under which a guard
  gets "fixed" ad hoc — it is how T7 itself shipped at 1-of-2 assertions in
  Slice 2.

**`server/__tests__/chronology-ordering.test.js` — EDIT**

- `[R]` `filesToScan` is `readdirSync`-derived and picks the two new lib files
  up automatically, but `FILE_DISPOSITIONS` **must** gain explicit entries for
  `value-groups.js` and `value-coverage-probe.js` or the fail-closed check at
  `:243` throws. Verified live: this registry already fails closed on both the
  missing-entry (`:243`) and stale-entry (`:249`) branches — it is the working
  shape and needs no repair, only two entries.

**`server/__tests__/db-migration.test.js` — EDIT (new `describe`, sibling to the existing rebuild meta-test)**

| id | Pri | Assertion |
|---|---|---|
| S-1 | `[R]` | The three tables exist after boot with **exactly** the columns and types `technical-plan.md` §4 specifies (`PRAGMA table_info` name **and** type list). Catches a dropped/renamed column at introduction, not only at a later ALTER. |
| S-2 | `[M]` | **CHECK-vs-registry parity, four columns, registry read as the expected side** (never a hand-typed literal re-copied from the SQL): `value_group_runs.state` CHECK == `GROUP_RUN_ROW_STATES` (the **4**-value persisted set — `not_attempted` must NOT appear, since such a row can never legally exist); `value_groups.refinement_state` == `GROUP_REFINEMENT_STATES`; `value_groups.review_status` == `GROUP_REVIEW_STATES` (including the reserved `claimed`); `value_group_members.value_source` == `valueLedger.VALUE_SOURCES`. |
| S-3 | `[R]` | The §9.5/§9.6 inapplicability is **asserted, not merely unbroken**: none of the three tables appears in `REBUILD_CASES`, and no `UPGRADE_CASES` entry names any of them. |
| S-4 | `[R]` | Dropped-column pin (DEC-S3-1/11): `value_groups` has no `project_id`, no `parent_group_id`, no `reviewed_by`; `value_group_members` has no availability column. This is where a reviewer re-adding one "for convenience" is caught mechanically instead of by memory. |

### (c) Backend — route + real-app specs (this project's E2E layer)

**`server/__tests__/value-groups-api.test.js` — NEW.** Real app
(`createApp`/`startServer` from `../index`), real throwaway SQLite
(`DASHBOARD_DB_PATH`), real HTTP on port 0, every spawn injected via
`__injectSpawnForTest`. Reuse `project-plans-api.test.js`'s top-of-file
harness (`:1-63`, `makeProject`, `fetch`/`post` helpers),
`value-coverage-parity.test.js`'s `seedProjectWithDetourPool` (`:90-128`,
extended with an `n` parameter) plus a `upsertValueUnitSummary` loop to reach
`coverage.complete === true` with no tick and no altitude spawn. `after()`
resets `__injectSpawnForTest(null)` and removes the temp DB incl. `-wal`/`-shm`.
**Four independent `describe` blocks**, each with its own seeded project;
tests stay in default sequential order inside a block (**no
`{ concurrency: true }` anywhere in this file**).

**Block 1 — `describe("§9.8 propose truth table")` `[M]` — the reconciled
9-row table, ONE test, ONE table (§11.1: "not four isolated branches").**
Per row assert **three** things: response `outcome`, HTTP status, and the
**exact spawn-stub call count**. The spawn count is the assertion that proves
the gate is non-negotiable rather than merely "checked first by convention."

| # | Prior run state | `coverage.complete` | Expected `outcome` | HTTP | Spawn | Source |
|---|---|---|---|---|---|---|
| TT-a | none | true | `started` | 202 | 1 | unit-tests |
| TT-b | none | false | `blocked_coverage_incomplete` | 409 | 0 | unit-tests |
| TT-c | `failed` | true | `started` (**fresh**, not a reuse of the failed run) | 202 | 1 | unit-tests = risk §4.1 complement |
| **TT-d** | `failed` | false | `blocked_coverage_incomplete` | 409 | 0 | **plan-mandated (PM-3/§11.1)** |
| TT-e | `completed` + digest match | true | `reused_unchanged` | 200 | 0 | unit-tests |
| TT-f | `in_progress` | true | `already_running` | 200 | 0 | unit-tests |
| **TT-g** | `in_progress` **AND digest matches** | true | `already_running` | 200 | 0 | **risk §4.1 — ordering proof: step 3 beats step 4; a matching digest against a *currently running* run must never spawn a second pass** |
| **TT-h** | `completed_zero_groups` + digest match | true | `reused_unchanged` | 200 | 0 | **risk §4.1 — the row that fell out of risk.md's own §6 list. Exercises the `OR` branch of the reuse condition; `completed_zero_groups` is the state most likely to be conflated with "not attempted," which is the entire reason §9.8 exists** |
| **TT-i** | `in_progress` | false | `blocked_coverage_incomplete` | 409 | 0 | **new this pass — pins gate-vs-`in_progress` ordering (§7: gate at step 2, `in_progress` at step 3)** |

- **TT-d additionally** asserts `GET /groups` still reports
  `run.state === "failed"` (the historical run truthfully did fail) while the
  409 body's `outcome` and the `gate` field read
  `blocked_coverage_incomplete` — two both-true facts in two fields.
- **TT-i additionally** asserts, in the same test, that `GET /groups` for that
  project still reports `run.state === "in_progress"`. Both facts are true and
  **must not collapse into one field**; whichever way the build presents it,
  the ordering becomes a pinned decision rather than an accident.
- **TT-read `[M]` — one read-side case, same file, deliberately NOT a row in
  the table** (this is `unit-tests.md`'s candidate row, **relocated**; see
  "Layer reconciliations" below): *`GET /groups` during an `in_progress` run
  whose coverage has regressed returns `run.state === "in_progress"` **and** a
  `gate` field of `blocked_coverage_incomplete`* — two both-true facts in two
  fields, never one. TT-d's dual assertion is its sibling on the write path.

**Block 2 — `describe("negative proof — proposals never actions")` `[M]`,
all four sub-checks, kept together (they are one acceptance property).**

| id | Assertion |
|---|---|
| N-1 | **Structural scan**, write surface enumerated from the **real** code, not memory: `dbModule.stmts.insertValueClaim` (`server/db.js:3360`) and `deleteValueClaim` (`:3375`). Scan `server/lib/value-groups.js` **and** the four new route-handler bodies (brace-walked as in G-2) for the literal substrings — assert **zero** matches in either surface. |
| N-2 | **Behavioral**: seed a project with an existing `value_claims` row (so the count is provably nonzero, not zero-by-coincidence); run the full pipeline (`mechanicalPreGroup` → stubbed `refineBatch` → `runGroupingPass`); `SELECT COUNT(*) FROM value_claims` before and after — **equal**. Also assert the run produced `group_count > 0` in the same test so "nothing happened at all" cannot pass this vacuously. |
| N-3 | **Reserved-but-unreachable**: zero code paths assign `'claimed'`/`"claimed"` to `review_status`. Scope the scan by **file** (`value-groups.js` + the four group handlers) — `db.js`'s CHECK declaration legitimately contains the string and is excluded by scope, never by weakening the pattern. |
| N-4 | **Adversarial LLM response, strict whitelist**: feed `parseGroupingOutput` the four legitimate fields **plus** `status: "claimed"` (second case: `review_status: "approved"`); assert the parsed group's `review_status` is `"proposed"`. Then persist via `runGroupingPass` with the same malicious stub and assert the **actual DB row** reads `review_status === "proposed"` — closing the gap between "the parser ignored it" and "nothing downstream re-reads the discarded field from raw stdout a second time." |

**Red-first for N-1…N-4 (§11.4.5, verbatim: "an unproven negative assertion is
exactly as vacuous as a positive one"):** each is proven by **injecting** the
thing it forbids — a real `insertValueClaim` call inside `value-groups.js`; a
path assigning `review_status = 'claimed'`; a `parseGroupingOutput` that reads
`status` off the raw payload instead of whitelisting — confirming the
**specific named** test fails, then reverting byte-identical. Performed and
independently re-run, never narrated.

**Block 3 — `describe("propose → refine → review lifecycle")` — flows 1/2/3,
one seeded project, sequential.**

| id | Pri | Assertion |
|---|---|---|
| E-1.1 | `[R]` | 6 detour units, **one left uncached** → `POST /groups/propose` → **409** with `{ outcome, gate }` both `blocked_coverage_incomplete` and a `coverage` object carrying the **full snapshot shape** (`pool_size`, `described`, `pending`, `eta`, `complete:false`) — not a bespoke error-only shape (AC-6/AC-7 over the wire). |
| E-1.2 | `[R]` | cache the last unit → `POST /groups/propose` → **202**, `outcome: "started"`. |
| E-1.3 | `[R]` | immediate second `POST` while the fake spawn is still pending → **200**, `already_running`, **same `run.id`**, spawn counter unchanged. |
| E-1.4 | `[M]` | poll `GET /groups` to `run.state === "completed"` (fail loudly on timeout): every group is `refined` with all four fields non-NULL; every `members[]` entry is `{unitKey, availability}` with `availability === "available"`; `member_availability_counts` sums to the member count. |
| E-2.1 | `[R]` | approve one group, dismiss another → re-`GET`: exactly those two rows changed `review_status`+`reviewed_at`; **every other group is still `proposed` with `reviewed_at === null`**; both POST response bodies contain only the changed review fields (no member-list mutation, no `name`/`rationale` rewrite). |
| E-2.2 | `[R]` | **bookkeeping-only, end-to-end**: `value_claims`, `project_plans` and `project_plan_items` row counts read via direct `db.prepare(...)` before E-1.1 and after E-2.1 are byte-identical. (Distinct from N-2: N-2 covers the grouping *pass*; this covers the *approve/dismiss* mutations across a real HTTP lifecycle.) |
| E-3 | `[R]` | digest reuse: a third `POST` against the unchanged pool after `completed` → **200 `reused_unchanged`**, returning the first run's groups, spawn counter **still** unchanged from E-1.2. |
| E-4 | `[N]` | `POST /groups/:id/review` with any body → **404** (no generic body-supplied-status route exists — the structural closure DEC-S3-9 exists for). |
| RT-1 | `[R]` | **Round-trip**: run with a stub whose every field carries a distinct greppable value; `GET /groups` returns every one of `name`/`summary_sentence`/`rationale`/`pregroup_signal`/`refinement_state`/`review_status`/`created_at`/`refined_at` **field-by-field**, not a spot-check. |
| RT-2 | `[R]` | **Update → Get**: capture RT-1's full response, approve, re-`GET`, `deepEqual` on every field **except** `review_status`/`reviewed_at`, plus two explicit equality checks on those. |
| RT-3 | `[R]` | **No prompt-scaffolding leak, consumption end**: for every `refined` row, `name`/`summary_sentence`/`rationale` contain none of the literal fact-line prefixes `"CLUSTER "`, `"[trunk_commit]"` — the response text is the model's composed sentence, not a leaked fragment of `buildGroupingPrompt`'s own format. (The production end lives at R-8.) |

**Block 4 — `describe("hierarchical decomposition")` — flow 4, own project.**

| id | Pri | Assertion |
|---|---|---|
| E-4.1 | `[R]` | seed **45** pre-cached detour units (just past a single-prompt budget, mirroring `value-summary-tick.test.js`'s own sizing choice); inject a spawn returning a valid per-batch response plus one valid rollup response. |
| E-4.2 | `[R]` | after `completed`: `run.batch_count > 1`; the spawn was called **exactly `batch_count + 1`** times (each batch, plus exactly one rollup). This is `focus-summary.js`'s **decompose** half, which the prior copy (`value-summary.js`'s `MAX_UNITS_PER_PROMPT`) dropped. |
| E-4.3 | `[R]` | **no cluster was split across batches** — checked against the fixture's own known cluster membership, never inferred. |
| E-4.4 | `[R]` | **AC-3 accounting identity**: `run.ungrouped_no_signal` and `run.ungrouped_not_selected` are present as integers (not `null`, not absent), and their sum plus every group's member count equals the seeded pool size. This is the **disclose** half. |

**Block 5 — `describe("read-time drift")` — flow 6, own project. Carries R4's must-add-now invariant.**

| id | Pri | Assertion |
|---|---|---|
| E-6.1 | `[R]` | 4 pre-cached units, propose+poll to `completed` with a stub grouping all 4 into one proposal. |
| E-6.2 | `[R]` | **Drift #1, before the read**: out-of-band `insertValueClaim` on member **B**; delete the `detour_dispositions` row backing member **C**. |
| E-6.3 | `[R]` | `GET /groups` → A `available`, B `already_claimed`, C `no_longer_in_pool`, D `available`; `member_availability_counts` reads `{available:2, already_claimed:1, no_longer_in_pool:1}` and **sums to 4** (partition: exactly one bucket, never zero, never two). Proves claim-beats-live-pool precedence end to end. |
| **E-6.4** | **`[M]`** | **Drift #2, injected AFTER the `GET` and BEFORE the approve** — an out-of-band claim on member **D**. This is R4's ruling made concrete: `e2e-tests.md` flow 6 already builds this fixture, it just introduced the drift too early. Injecting a *second* drift after the read is one extra insert and preserves E-6.3's read-side proof rather than replacing it. |
| **E-6.5** | **`[M]`** | **Approve under drift is still pure bookkeeping**: `POST /groups/:id/approve` returns 200, does not error, flips `review_status`, and **does not silently drop the drifted member** — the immediately following `GET /groups` still returns **4** `value_group_members` rows with the partition intact and D now `already_claimed`. This is the assertion that makes "approve is pure bookkeeping" true *under drift*, the only condition where it could stop being true. AC-5 ("Sara has looked at this and it's a reasonable candidate") would be a false claim if drift silently changed what got approved. |

**`server/__tests__/value-groups-interrupted-boot.test.js` — NEW** (own file,
own child process — the crashed-run row must exist **before**
`require("../index")` triggers the boot hook; `value-groups-api.test.js` boots
once in a shared `before()` and cannot also craft pre-boot state without
contaminating every other scenario. Same structural reason
`value-summary-interrupted-boot.test.js` is its own file.)

| id | Pri | Assertion |
|---|---|---|
| E-5.1 | `[M]` | **Immediately after boot, no request made**, read the crafted `in_progress` row directly from the DB: `state === "failed"`, `error_reason === "interrupted_restart"`, `completed_at` non-null. Asserting this via a later `GET` instead would leave "does it happen **at boot**, or only incidentally by the time we first ask" unproven — that ordering is the whole point of the spec. |
| E-5.2 | `[R]` | `GET /groups` → `run.state === "failed"` reaches the client (never a stuck spinner, never silently omitted) with no groups. |
| E-5.3 | `[R]` | **Not starved by the dead row**: `POST /groups/propose` for the same project → **202 `started`** with a `run.id` distinct from the crafted one, reaching `completed` normally. |
| E-5.4 | `[N]` | Second boot is inert (cache-bust and re-require, mirroring the precedent file): the now-`completed` run is **not** flipped to `failed`. |

### (d) Client — component specs

**`client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx` — NEW.**
Mirror `PlanLedgerPanel.test.tsx`'s `vi.mock("../../lib/api", …)` shape,
adding `groups`/`proposeGroups`/`approveGroup`/`dismissGroup` beside the
existing `mockCoverageMock`/`mockRequestCoverageMock`.

| id | Pri | Assertion |
|---|---|---|
| C-1 | `[M]` | **No client-side re-derivation** (§9.1 rogue-re-derivation, client half) — merged from `unit-tests.md` §9.1 and `e2e-tests.md` §2c into **one** case: mock a `GET /groups`-shaped literal fixture (one group, 4 members, availabilities `available`/`already_claimed`/`no_longer_in_pool`/`available`) whose `member_availability_counts` deliberately would **not** match a naive `members.filter(...).length`; assert the rendered tally equals the **server's** numbers; assert all three availability states render **visibly distinct** treatments (three states, three renderings — never two collapsed into one, the client mirror of the partition property). |
| C-2 | `[R]` | AC-7: the Auto-group action is `disabled` while `!coverage.complete` and enables across a mock update `false → true`; **exactly one** element matching the existing `prioritize-now-button` selector exists in the DOM (`querySelectorAll(...).length === 1`) — no second control, no duplicate handler. |
| C-3 | `[R]` | Approve/Dismiss call `approveGroup`/`dismissGroup` **exactly once** with the group id; the rendered DOM contains **no** "Approve & claim" copy, no claim-target picker, no plan-item create/edit affordance (PO §7/§8 fence) — an explicit named absence check, not "the happy path works." |
| C-4 | `[R]` | No raw i18n key leaks: render a group in each of the 4 `refinement_state` values and each client-reachable `review_status`/gate state; assert no rendered text matches `/^projectDetail\./` (and reuse the existing `/planLedger\.[a-zA-Z]/` DOM sweep). |
| C-5 | `[R]` | **PM-5a entity-switch reset (SF-8 shape)**: `mockGroupsMock` keyed per project with visibly distinct names; render `proj-A`, `rerender` `proj-B`; assert A's group name is gone and B's is present. |
| C-6 | `[R]` | **PM-5a in-flight**: deferred promise for `proj-A`'s `groups()`, switch to `proj-B` before resolving, resolve **after** the switch; assert A's stale data never renders under B. This is the half that stayed live after Slice 2's SF-8 "fix" looked complete. |
| C-7 | `[R]` | **PM-5b StrictMode (BL-2 shape)**: at least one new effect/ref renders correctly wrapped in `<StrictMode>` — group list / run-state text actually renders (not blank) after the setup→cleanup→setup double-invoke. This exact class shipped invisibly behind an 817/817 green suite in Slice 2. |
| C-8 | `[R]` | **Locale mirror registry test** (place it in whichever location this project's existing i18n spec convention uses — check for a precedent file before creating a new one): each of the 6 client mirrors carries its anchored exemption-set `deepEqual` against the reviewed list, **and** every wire value in every registry has a translation key present in **each** of `en`/`ko`/`vi`/`zh` `projectDetail.json` — not just `en`. A missing `ko`/`vi`/`zh` key is the N2 fail-open class. |

**`client/src/pages/__tests__/screens.snapshot.test.tsx` — EDIT**

- `[R]` Review the diff, regenerate deliberately with
  `cd client && npx vitest run -u`. **Never blind-update** (repo `CLAUDE.md`).

### Fixtures / test data

Reuse, do not reinvent:

- `makePoolUnit(overrides)` helper local to the `value-groups-*` server specs,
  following `makeUnit()` in `value-summary.test.js` / `PlanLedgerPanel.test.tsx`;
  field names come from the real unit shapes at `value-ledger.js:219-262`.
- `seedProjectWithDetourPool` from `value-coverage-parity.test.js:90-128`,
  extended with an `n` parameter for the 45-unit block; plus an
  `upsertValueUnitSummary` loop to reach `complete === true` with **zero**
  altitude spawns.
- **One** canonical "successful refinement" JSON payload object, constructed
  once and imported by R-3, N-4 (as the base the malicious fields are added
  to) and RT-1 — not hand-copied four times. The same §9.1 discipline this
  slice exists to enforce, applied to the suite itself.
- `__injectSpawnForTest` from `../lib/focus-inference` with a
  `let spawnCalls = 0` counter inside the fake factory — this counter is what
  backs every spawn-count assertion in the truth table, E-1.3, E-3 and E-4.2.
- Claims seeding: whatever helper `project-plans-api.test.js` /
  `ledger-metrics-parity.test.js` already use.

### Layer reconciliations (the two architects did not reconcile; these are my calls)

1. **§9.8 permutations pushed DOWN, flow proof kept minimal.** All nine truth-
   table rows + TT-read run as route-level cases with hand-seeded fixtures in
   Block 1, **not** threaded through the sequential HTTP lifecycle in Block 3.
   `e2e-tests.md` §6 independently reached the same conclusion; this ratifies
   it. Block 3 proves only the three states a real browser session hits in
   order (`409` gate → `completed` → review) — the minimum flow proof.
2. **`unit-tests.md`'s candidate row was RELOCATED, not adopted as written.**
   Its "`already_running` + coverage regresses mid-flight" case reasons about a
   concurrent **`GET /groups` poll** but proposed itself as a row in the
   **`POST /groups/propose`** table. Per §7's handler ordering (gate at step 2),
   a `POST` with regressed coverage 409s whether or not a run is live — as
   literally written the row would assert the opposite of the plan. It is split:
   the write-path half becomes **TT-i**, the read-path half becomes **TT-read**.
3. **The negative proof stays whole, in `value-groups-api.test.js`.**
   `e2e-tests.md` §1 wanted sub-checks 1/3/4 moved to
   `value-groups-refinement.test.js`, keeping only the behavioral half here.
   **Overridden**: the four sub-checks are *one* acceptance property, and the
   DoD line ("all four, red-proven") is only mechanically checkable if they are
   in one greppable `describe`. Sub-checks N-1/N-3 are file scans that need no
   HTTP; N-4 needs `runGroupingPass` + a DB row, which this file already has.
4. **`parseGroupingOutput`'s adversarial matrix is split by purpose, not by
   convenience.** The `status:"claimed"` / `review_status:"approved"` cases live
   **once**, at N-4 (they are the acceptance property). Malformed JSON, echoed
   prompt, and invented membership stay at R-8/R-4 in the unit layer, where
   they are cheaper and need no server.
5. **The client contract-seam case was MERGED, not duplicated.**
   `e2e-tests.md` §2c's one case and `unit-tests.md` §9's case 1 assert
   overlapping things; they collapse into **C-1**, which keeps every distinct
   claim (server-verbatim counts, three distinguishable renderings, no raw
   enum/i18n key) at one seam instead of two near-identical tests.
6. **`risk.md`'s "complement case" needed no new row** — it is already
   `unit-tests.md`'s row **c**, with the spawn-count assertion that proves it.
   Recorded so it is not added twice by two readers.

---

## Implementation steps

Ordered so that every step is independently checkable and no step leaves a
window with **no guard at all** over a surface. Steps 2 and 3 are the highest-
risk moment in the whole slice.

1. **Schema + prepared statements** (`server/db.js` §4) → write **S-1…S-4** in
   `db-migration.test.js` first.
   *Red-first:* before the `CREATE TABLE` blocks land, S-1 fails because the
   tables do not exist; S-2 fails because there is no CHECK to read. After:
   green. Then locally add a 5th value to `GROUP_REFINEMENT_STATES` **without**
   widening the CHECK → **S-2 specifically** (not a generic "schema test
   failed") names the mismatched pair → revert.
   *Check:* boot against a copy of a real DB; three tables present;
   `node --test server/__tests__/db-migration.test.js` green with **no** new
   `UPGRADE_CASES`/`REBUILD_CASES` rows.

2. **SF-4 extraction + T7's deletion + T7's five successors — ONE COMMIT, DO
   NOT SPLIT.** Create `server/lib/value-coverage-probe.js` (calling
   `coverageSnapshot` through the module namespace per **BO-5**), rewrite both
   coverage handlers to call it, **delete T7 lines 905–999 in full**, and land
   **P-1…P-8** and **G-1/G-2/G-4/G-9** in the same commit.
   *Why one commit:* T7's deletion and the replacement guard's creation are two
   edits to the same suite. In the wrong order there is a window with **no
   guard** over this composition, in which a suite run is green for the wrong
   reason.
   *Red-first (T7-C1/C2):* inject a **fourth** hand-copy of the 4-step
   composition inline into a handler that should call `buildProbeCoverage` →
   **G-2**'s exactly-3 count fails → revert byte-identical.
   *Red-first (T7-C3/C5):* delete `draining:` from the `coverageSnapshot(...)`
   call in the new module → **P-6** fails behaviorally and **P-7** fails naming
   the missing key → restore. Add a sixth key → P-7 fails → revert.
   *Check:* `node --test server/__tests__/project-plans-api.test.js` green with
   T3/T4/T6 **untouched**; `value-coverage-parity.test.js` green **unmodified**
   (do not "sympathetically fix" it — it is the canary).

3. **Registries + all four §9.7 registrations, in the same commit as the new
   `require`.** Create `server/lib/value-groups.js` carrying **only** its 6
   registries, `UNGROUPED_REASONS`, `MAX_UNITS_PER_GROUPING_PROMPT`, and
   **declared stub exports for every function it will eventually export**, so
   the `assertSingleHome` disposition maps are written **once**, now, and later
   steps only fill bodies. Then: `CONSUMERS` 4th entry + **BO-3** comment
   widening; **C2.4** updated (literal, title, failure message); **G-5/G-6/G-7**;
   `FILE_DISPOSITIONS` entries for both new lib files; **M-10** and **R-1**
   anchored exemption-set assertions; **D-1**'s.
   *Red-first:* add a 6th value to `GROUP_RUN_STATES` without adding it to
   `GROUP_RUN_ROW_STATES` → M-10 breaks **at the point of growth** → revert.
   Add a stray export to `value-groups.js`, or a stray
   `require("../lib/value-groups")` in an undisposed file → the **specific**
   disposition assertion names the missing entry, not a generic failure →
   revert.
   *Check:* `node --test server/__tests__/single-writer-guard.test.js`,
   `ledger-metrics-parity.test.js`, `chronology-ordering.test.js` all green.
   **SF-5's lesson: "the diff touches this file" is not evidence the
   registration is complete.**

4. **`assertConsumerScopeDerived` — the durable cure (D2).** Generalize the
   derived, fail-closed importer scan already mandated for
   `value-coverage-probe.js` (**G-3**) into one helper in
   `server/__tests__/helpers/single-home.js`, and point all four registrations
   at it. See "Durable-cure decision."
   *Red-first:* add a `require("../lib/value-groups")` to an undisposed file in
   `server/lib` → the helper **throws** (does not `continue`) naming the
   undisposed importer → revert.

5. **Mechanical stage** (`mechanicalPreGroup`, `groupingFacts`) + **M-1…M-9**.
   Zero spawn mocking, zero `dbModule`.
   *Red-first:* short-circuit the slug matcher to return no matches → **M-1's
   specific named cluster/membership** goes missing (not "an assertion failed
   somewhere") → restore byte-identical → green. Repeat per heuristic for
   M-2/M-4. **M-5** is proven by making the clusterer dedupe: the shared unit
   disappears from one of the two clusters and M-5 fails — this is the guard
   `risk.md` ranks most likely to ship vacuous.

6. **Digest + cache** (`computeGroupingDigest`,
   `GROUPING_UNCOMPARED_FIELD_GUARANTORS`) + **R-9**.
   *Red-first:* add a field to `groupingFacts` and do **not** list it in the
   guarantors registry → R-9's key-walk fails on that exact key → either
   include it in the digest or register it with a stated reason.

7. **Refinement + rollup + orchestration** (`buildGroupingPrompt`,
   `parseGroupingOutput`, `refineBatch`, `rollupGroups`, `runGroupingPass`,
   `reconcileInterruptedGroupRuns`) + **R-2…R-8**, **R-10…R-13**.
   *Red-first:* drop one field before insert → **R-3** fails field-by-field.
   Make a failed batch drop its group row instead of persisting it → **R-5**
   fails (disclose, not vanish). Populate `name` on a `failed` row → **R-7**'s
   biconditional fails from the other direction. Remove the
   `reconcileInterruptedGroupRuns(` call from `server/index.js` → **R-13**
   fails → restore.

8. **Drift resolution** (`resolveMemberAvailability`) + **D-1…D-4**.
   *Red-first:* flip the precedence so live-pool presence beats claims →
   **D-2** fails naming `already_claimed`. Double-count a key across buckets →
   **D-4**'s `Set`-size assertion fails while the sum assertion alone would
   still pass — which is why both halves exist.

9. **Routes + the gate + the negative proof** — 4 handlers, then
   **Block 1 (TT-a…TT-i + TT-read)**, **Block 2 (N-1…N-4)**, **Block 3**,
   **Block 4**, **Block 5** in `value-groups-api.test.js`, then
   `value-groups-interrupted-boot.test.js` (**E-5.1…E-5.4**).
   *Red-first (truth table):* reorder the handler to check `in_progress`
   **before** the gate → **TT-i** fails (409 expected, `already_running`
   returned) while every single-branch test stays green — this is the precise
   demonstration that the seams, not the branches, are what the table buys.
   Then let a matching digest short-circuit ahead of the `in_progress` check →
   **TT-g** fails on the spawn count → revert.
   *Red-first (negative proof):* the four injections listed under Block 2.
   *Red-first (E-6.5):* make approve prune drifted members from
   `value_group_members` → E-6.5 fails on the member count → revert.

10. **Boot hook** in `server/index.js:465-470`, same try/catch + `console.warn`
    posture as the tick start (fail-safe, non-blocking, per repo `CLAUDE.md`).
    Covered by **R-13** (source scan) and **E-5.1** (behavioral, at boot).

11. **Client**: `api.ts` methods → the 6 registry mirrors + all four locale
    files **in the same commit** → panel UI → **C-1…C-8** → snapshot review.
    *Red-first (C-5/C-6):* implement the group list keyed off a `useRef`
    without a `[projectId]`-scoped reset effect — every "does it render
    groups" test passes and **only C-5/C-6 fail**, exactly mirroring how the
    Slice 2 fix looked complete while the in-flight leak stayed live.
    *Red-first (C-7):* the `useRef(true)` + cleanup-only `useEffect` shape
    renders blank under `<StrictMode>` and green outside it.
    *Red-first (C-8):* delete one `ko` key → C-8 fails naming that key and
    that locale.

12. **Docs + audits**: `update-project-docs` (README / ARCHITECTURE / SETUP
    where the 4 endpoints, 3 tables and env surface appear),
    `PROJECT-CONTEXT.md` SF-4 build-outcome note, and the four build
    obligations below. Header audit must exit 0.

### Build-time obligations (flag-backs — these are NOT silently absorbed)

| id | Obligation | Source |
|---|---|---|
| **BO-1** | **Correct `qa/change-brief.md`'s changed-files table in place**: the row claiming "the anchored response-key-set assertion at lines 988-998 survives unmodified" is factually wrong. T7 is deleted in full. Leaving it uncorrected invites a build-time reader to preserve `:988-998` and leave a half-broken T7 standing. | R2 |
| **BO-2** | **Add the five-claim successor table (above) to `technical-plan.md` §6.1**, and change the DoD line from *"T7 deleted"* to *"every T7 claim has a named successor and each was observed red."* | R2 / D1 |
| **BO-3** | **Widen `CONSUMERS`' declaring-comment growth rule** at `value-ledger.js:64-69`, in the **same commit** as the 4th entry. The comment currently states: *"Grow this list ONLY when the new consumer reads `computePlanHealth`/`assembleValuePool`/`summarizeDeliveredValue` directly, never re-implements a piece of them."* `DEC-S3-10` rules that `value-groups.js` **never calls `assembleValuePool`** (it calls `unitKey` and nothing else), so by the registry's own stated rule the new entry does not qualify. Widen to admit derived-*value* readers (e.g. *"…or reads this module's derived values — e.g. `unitKey` — without re-implementing them"*) and update C2.4's failure message to match. **The one thing not on the table is shipping the entry with a comment that forbids it.** This project has now recorded three consecutive builds where an unevidenced invariant claim in a header comment marked the precise spot the invariant fails. | R3 |
| **BO-4** | **Correct `technical-plan.md` §9's "Edited — tests" table to include `server/__tests__/ledger-metrics-parity.test.js`.** One-line addendum, not a re-plan. §9 is the artifact `build-implementer` works from and the DoD checks against; leaving it absent means the build's own file list is knowingly wrong. | R3 |
| **BO-5** | `value-coverage-probe.js` calls `coverageSnapshot` through the module namespace object, documented in the module header, so **P-7** can observe it. | This plan |
| **BO-6** | **Open `WATCH-S3-F` in `decisions.md`** — *"`POST /groups/:id/approve` performs no freshness check; its response does not carry a recomputed `member_availability_counts`/`members` snapshot."* `Fires-on:` Slice 4's claim build, or an observed approve-against-stale-render in practice. `Lands-in:` `server/routes/project-plans.js`'s approve handler + `value-groups-api.test.js`. **Distinct from `WATCH-S3-A`** (which scopes to Slice 4's *claim* route and does not mention approve at all), naming the approve route explicitly. The behavior change itself is **not built this round** — it is a wire-contract change beyond AC-5's scope and belongs with `decisions.md`'s other cheap-to-reverse vetoes. E-6.4/E-6.5 cover the correctness half for free. | R4 |
| **BO-7** | `[N]` If the team declines an OpenAPI fragment for the 4 new routes (as Slice 1 did for `/altitudes/seen` via DEC-19/QA-DEC-3), record that as a row — the mount↔path scan is derived from `app.use("/api/…")` mounts and is structurally blind to new routes under an already-documented mount. Documentation-drift risk only, on a candidate pattern not yet promoted. Do not let it survive only as prose. | risk §6.3 |

---

## Single-source-of-truth guardrail

This project **does** have canonical registries driving multiple rendered
outputs, and every one of them is in this slice's blast radius. The rule for
every test below is the same: **read the registry as the expected side; never
hand-copy the rendered path and never bless a hand-edited output that bypassed
the registry.**

| Canonical source | Rendered/derived paths that must agree | Pinned by |
|---|---|---|
| `valueLedger.VALUE_SOURCES` | `value_group_members.value_source` CHECK list in `db.js` | **S-2(d)** — reads `VALUE_SOURCES`, not the SQL string. A hand-typed CHECK that happens to match today is exactly the drift this catches tomorrow. |
| `GROUP_RUN_ROW_STATES` / `GROUP_REFINEMENT_STATES` / `GROUP_REVIEW_STATES` | the three CHECK lists in `db.js` | **S-2(a)(b)(c)** |
| `GROUP_RUN_STATES` (5 wire values) vs `GROUP_RUN_ROW_STATES` (4 persisted) | the exemption between them | **M-10** — anchored exemption set is exactly `["not_attempted"]`, so a row with that state can never legally exist |
| All 6 server registries | the 6 client mirrors **and** all four `projectDetail.json` locale files | **C-8** — mirrors `deepEqual` the reviewed list; every wire value has a key in **each** of `en`/`ko`/`vi`/`zh`. A locale file edited by hand without the registry, or a registry grown without the locales, fails. |
| `CONSUMERS` (`value-ledger.js:70-74`) | `ledger-metrics-parity.test.js` C2.4's anchor **and** the real importer set | **C2.4** (value anchor) + **D2's `assertConsumerScopeDerived`** (completeness, derived from real `require` sites) — today nothing greps importers against this array at all |
| The real claim-write surface (`insertValueClaim`/`deleteValueClaim`) | the negative proof's scan scope | **N-1** — enumerated from the real functions, never hand-guessed. Note the standing limit: the scan cannot see a raw `db.exec("INSERT INTO value_claims …")` nor a *future* claim writer; that limit is disclosed here rather than assumed away. |
| `groupingFacts` | `buildGroupingPrompt`'s input set **and** `computeGroupingDigest`'s input set — the *same object by construction* | **R-9** key-walk + the structural scan that `buildGroupingPrompt` reads only `groupingFacts` output |
| `buildProbeCoverage` (once it exists) | all three call sites | **G-2** (exactly 3) + **G-3/D2** (derived, fail-closed importer scope) |
| `readdirSync`-derived `filesToScan` | `FILE_DISPOSITIONS` | already fail-closed live (`chronology-ordering.test.js:243`/`:249`) — two entries added, nothing to repair |

---

## Durable-cure decision

**D1 — "a deleted guard is replaced claim-by-claim, not test-by-test": ADOPT
NOW.** The five-claim successor table above *is* D1's first instance, and
**BO-2** puts it in `technical-plan.md` §6.1 where the implementer and the DoD
both read it. This project's recurring failure is not "a test was deleted
carelessly" — it is that **a test is one unit and its claims are many**, so
delete-and-replace silently drops the claims nobody enumerated. That is the
same mechanism that shipped T7 itself at 1-of-2 mandated assertions in Slice 2.
Cost: one table. It directly closes the highest-severity gap in this slice.

**D2 — the derived consumer-scope guard: BUILD IT NOW, at bounded scope.**
Ruling: create `assertConsumerScopeDerived(modulePath)` in
`server/__tests__/helpers/single-home.js` — enumerate the module's real
importers by scanning `server/lib`, `server/routes` and `bin/` for the module's
own import specifier, and **fail (throw, never `continue`)** on any importer
absent from the disposition map. Point **all four** registrations at it:
`value-coverage-probe`, `value-groups`, `value-ledger`, `value-summary`; and
have `CONSUMERS`' own completeness checked the same way.

*Why now, and why this is not scope inflation:* the plan **already mandates
exactly this shape for one module** (`unit-tests.md` §2b.3 / `technical-plan.md`
§6.2). Making it a parameterized helper and calling it four times is marginal
work over what is already committed. Both constituent patterns are already
proven **in this tree**: `chronology-ordering.test.js:243`'s fail-closed miss
branch and `value-coverage.test.js:297`'s anchored exemption-set. This is
copying two working local patterns, not inventing one. And Slice 3 is the
build with the strongest forcing function this class will ever get — it must
register one new consumer in **four** hand-typed places at once.

*Consequence of deferring (this remains Sara's call, per `qa-assessment.md`'s
open decisions):* the point tests (**C2.4**, **G-4…G-7**) still land and this
slice is still safe to ship. What you accept is a **5th hand-registration in
Slice 4**, on a class with **7 recorded occurrences**, whose cure the catalog
has recommended since occurrence 6 and whose most recent instance (SF-5, one
slice ago, on this exact pair of files) was caught only by the reviewer — in a
commit where the author was *inside* the map and still did not see its
membership was stale. §9.7's own note: *"the cure recommended at occurrence 6
remains half-built, and this is what the unbuilt half costs."* If deferred,
that deferral needs its own tracked row; it does not get to survive as prose.

**Not adopted this round, deliberately:** claim-time transactional
re-validation (correctly Slice 4's, `WATCH-S3-A`); the fresh-snapshot-on-
approve **response** change (`WATCH-S3-F` / **BO-6** — a wire-contract change
beyond AC-5's scope); a structural invariant guarding the `value_claims`
"no `closed_at`" derive-don't-copy precedent (real but narrow, affects the
precedent's durability rather than Slice 3's correctness); an OpenAPI
completeness scan derived from individual routes rather than mounts
(**BO-7**).

---

## How to run

From `PROJECT-CONTEXT.md` / repo `CLAUDE.md` (no separate e2e runner exists —
the route+DB specs run inside the server suite):

```bash
# Full backend suite (the diff target: 1787/1787 pre-Slice-3)
npm run test:server

# Full client suite (the diff target: 822/822 pre-Slice-3)
npm run test:client

# Individual server specs, each independently re-runnable (DoD §15)
node --test server/__tests__/value-groups-mechanical.test.js
node --test server/__tests__/value-groups-refinement.test.js
node --test server/__tests__/value-groups-api.test.js
node --test server/__tests__/value-groups-interrupted-boot.test.js
node --test server/__tests__/value-coverage-probe.test.js
node --test server/__tests__/single-writer-guard.test.js
node --test server/__tests__/project-plans-api.test.js
node --test server/__tests__/chronology-ordering.test.js
node --test server/__tests__/db-migration.test.js
node --test server/__tests__/ledger-metrics-parity.test.js
node --test server/__tests__/value-coverage-parity.test.js   # must stay GREEN, UNMODIFIED

# Individual client spec
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.groups.test.tsx

# Snapshot review — only if PlanLedgerPanel's rendered shape actually changed.
# Review the diff first; never blind-update (repo CLAUDE.md).
cd client && npx vitest run -u

# File-header audit — must exit 0; re-run after each new file lands
bash .claude/skills/file-headers/scripts/check-headers.sh
```

**Vacuity sweep before declaring any guard done** (§11.2, run over every
new/edited spec above):

```bash
grep -rn "assert.ok(true" server/__tests__/     # must return 0 for new/edited files
grep -rn "|| true" server/__tests__/            # must return 0 for new/edited files
```

Then additionally grep the new specs by hand for `typeof `, bare
`Array.isArray(`, `assert.ok(` with no compared value, and empty `=> {}`
bodies — **none of the two greps above catch those four shapes**, and this
file family has three consecutive builds where `build-reviewer` caught blockers
a correctly-executed verifier pass had already certified green. `intake-qa`
and `build-reviewer` are **non-trimmable** here (PM-6.1) — empirically earned,
not procedural.

---

## Definition of Done

Mechanically checkable. A build-verifier should be able to tick every box
without re-deriving the investigation.

**Suites**
- [ ] `npm run test:server` green at **>= 1787** tests, 0 fail / 0 skip / 0 todo.
- [ ] `npm run test:client` green at **>= 822** tests, 0 fail.
- [ ] `node --test server/__tests__/value-coverage-parity.test.js` green and the
      file is **byte-identical** to `master` (`git diff --exit-code` on it).
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] The only expected red at any point was T7, and only inside step 2's own
      commit. **Any other red anywhere in either suite is a real regression.**

**T7 / SF-4 (R2)**
- [ ] `grep -n "T7 (SF-4)" server/__tests__/project-plans-api.test.js` returns
      **0 hits** — deleted in full, zero surviving lines.
- [ ] T3, T4 and T6 are byte-identical to `master`.
- [ ] All five rows of the successor table have a named, existing test:
      **T7-C1→G-2/P-1, T7-C2→G-2/P-5, T7-C3→P-6, T7-C4→intentionally
      unreplaced (recorded), T7-C5→P-7** — and each was observed **red** by the
      injection named in step 2, **independently re-run**.
- [ ] `grep -n "T7-C5 successor" server/__tests__/value-coverage-probe.test.js`
      returns exactly 1 hit, and that test `deepEqual`s the argument keys
      against `["computedAt","counts","draining","projectId","requestedAt"]`.
- [ ] `grep -c "buildProbeCoverage(" server/routes/project-plans.js` == **3**.
- [ ] **No** route↔route `deepEqual` parity assertion was added anywhere
      (T7-C4 / DEC-S3-4).

**§9.8 (R1)**
- [ ] `value-groups-api.test.js` contains **one** test driving a **9-row** truth
      table (TT-a…TT-i), each row asserting `outcome` + HTTP status + **exact
      spawn call count**, plus the separate **TT-read** read-side case.
- [ ] Rows **g**, **h**, **i** and TT-read are present by name.
- [ ] The ordering red-proof was performed: reordering gate-vs-`in_progress`
      fails **TT-i** while every single-branch test stays green.
- [ ] **R-7**'s biconditional and **D-4**'s partition (sum **and** `Set` size)
      both exist and were red-proven.

**§9.7 / registries (R3)**
- [ ] `value-ledger.js`'s `CONSUMERS` has **4** entries; C2.4's literal, title
      and failure message all updated; `node --test
      server/__tests__/ledger-metrics-parity.test.js` green.
- [ ] `CONSUMERS`' declaring comment (`:64-69`) growth rule widened in the
      **same commit** as the entry (**BO-3**) — the registry does not
      contradict itself.
- [ ] Both existing `assertSingleHome` consumer maps name `../lib/value-groups`;
      `value-groups`'s own map has **two** consumers (`../routes/project-plans`
      **and** `../index`); `value-coverage-probe`'s map exists.
- [ ] `FILE_DISPOSITIONS` has entries for both new lib files.
- [ ] **D2:** `assertConsumerScopeDerived` exists and all four registrations
      call it — **or** the deferral is recorded as a tracked row.
- [ ] All four registrations landed in the **same commit** as the new
      `require` — verified by reading the commit, not by "the diff touches the
      file."

**Negative proof (G6)**
- [ ] All four sub-checks **N-1…N-4** exist in one `describe` in
      `value-groups-api.test.js`, and each was observed red against a **real
      injection** of the thing it forbids, **independently re-run** (§9.3
      AGENT-SELF-REPORTED-RED — narrated is not performed).

**Approve under drift (R4)**
- [ ] **E-6.4/E-6.5** exist: drift injected **after** the `GET` and **before**
      the approve; approve returns 200, does not error, does not drop the
      drifted member; the following `GET` still returns 4 member rows with the
      partition intact.
- [ ] **`WATCH-S3-F`** is open in `decisions.md` with `Fires-on:`/`Lands-in:`,
      distinct from `WATCH-S3-A` and naming the approve route explicitly.

**Flag-backs**
- [ ] **BO-1** `change-brief.md`'s T7 row corrected in place.
- [ ] **BO-2** successor table added to `technical-plan.md` §6.1 and the DoD
      line reworded.
- [ ] **BO-4** `technical-plan.md` §9's "Edited — tests" table includes
      `ledger-metrics-parity.test.js`.
- [ ] **BO-5** documented in `value-coverage-probe.js`'s header.
- [ ] **BO-7** recorded or discharged.

**Vacuity**
- [ ] Both `grep` sweeps return 0 for new/edited files, and the four
      grep-invisible shapes (`typeof `, bare `Array.isArray(`, valueless
      `assert.ok(`, empty `=> {}`) were checked by hand.
- [ ] Every red-proof in steps 1–11 was **performed and independently
      re-run by someone other than its author** — not reported as done.

**Docs**
- [ ] `update-project-docs` applied (README / ARCHITECTURE / SETUP for the 4
      endpoints, 3 tables, env surface); `PROJECT-CONTEXT.md` SF-4
      build-outcome note written.
- [ ] Snapshot baselines regenerated **deliberately** after reviewing the diff,
      never blind-updated.
