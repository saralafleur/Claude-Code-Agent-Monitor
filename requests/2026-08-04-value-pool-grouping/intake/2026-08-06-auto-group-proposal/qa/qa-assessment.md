# QA Assessment — auto-group-proposal (Value Pool Slice 3)

> Authored by `qa-strategist`. **This is the document to read first.** It
> answers: is the planned coverage adequate, where are the gaps, have we
> shipped this *class* of gap before, and how do we stop it.
>
> **Forward mode.** Nothing in Slice 3 is built. The subject under review is
> the **plan of record** (`technical-plan.md` + `decisions.md` + `pm-plan.md`)
> and the **planned coverage** (`supporting/unit-tests.md`, `e2e-tests.md`)
> — judged by the same standard shipped code gets: *would a green suite,
> fully executed as designed, be green over something broken?*
>
> **Date:** 2026-08-06 · **Baseline:** server 1787/1787, client 822/822, both GREEN

---

## Change summary

Slice 3 adds a two-stage, **proposal-only** grouping engine over a project's
Value Pool: a free, deterministic mechanical pre-grouping pass (slug /
time-adjacency / shared-surface signals) feeding one sonnet call per batch that
turns raw clusters into named proposals (name, stakeholder sentence, member
`unitKey`s, rationale), persisted to three new tables and rendered in
`PlanLedgerPanel` for human **approve** / **dismiss** review. Nothing is ever
auto-claimed. In the same change set it discharges SF-4 — the scheduled debt
from Slice 2 — by extracting `buildProbeCoverage` into a new module so the
grouping gate becomes its *third call site* rather than a fourth hand-copy,
deliberately turning the existing T7 guard red and replacing it in the same
commit.

This is the **5th consecutive effort in 3 days** on the
`value-ledger`/`value-summary`/`value-coverage` file family — the densest
recurring-defect zone this project has on record (9, 9 and 4 §9.3-family events
across the three prior builds).

---

## Coverage verdict

**GAPPED**

**Not BLIND, and that is worth saying plainly.** Every one of the five catalog
classes this change lands on has a *named, red-proof-carrying* planned guard;
the plan reads `PROJECT-CONTEXT.md` §9 correctly and applies
inapplicability-over-compliance to §9.5/§9.6 (three genuinely new tables, zero
`ALTER`, so those entries do not fire at all). Two of this project's most
reliable failure shapes are now defended by mechanisms that are *already live
and fail-closed* in the tree — verified by direct read, not by plan prose:
`chronology-ordering.test.js`'s `FILE_DISPOSITIONS` throws on an
undispositioned file (`:243`), and §9.7's N2 cure landed at
`value-coverage.test.js:297`. The precedent Slice 3 copies its hierarchical
batching from (`focus-summary.js`'s day→window rollup) was checked and is
genuinely trustworthy: both the *decompose* and *disclose* halves are
fixture-anchored and content-asserted, which is exactly what the prior copy
(`value-summary.js`'s `MAX_UNITS_PER_PROMPT`) dropped.

**Not ADEQUATE.** Four defects in the plan of record, each verified against
live code this pass, would each let something ship broken behind a green suite:

1. **T7's anchor has no designated successor.** T7 is deleted in full (ruling
   R2 below) and the assertion the plan names as its survivor — T6 — carries a
   *different closed set*. The one guard §9.4's PARITY-WITHOUT-ANCHOR detector
   forced into existence one week ago is being deleted with nothing named to
   carry its content forward. This is regression-of-a-fix on §9.1, the file
   family's #1 class, currently at occurrence 7.
2. **`ledger-metrics-parity.test.js` C2.4 goes red by construction** and is
   absent from `technical-plan.md` §9's own change-set table — *and* the
   `CONSUMERS` declaring comment's own stated growth rule forbids the very
   entry `DEC-S3-10` mandates (both verified live, ruling R3).
3. **The §9.8 truth table still misses both branch-ordering seams** that
   §9.8's own worked example ("cap first, then gate") predicts — and one of the
   three rows `risk.md` named in its §4.1 silently fell out of its own §6
   tracked-artifact list, which is this project's recorded meta-failure
   recurring *inside this QA pass* (ruling R1).
4. **`approve` performs no freshness check** and is named in no `decisions.md`
   row at all (ruling R4).

None of these is fatal. All four are cheap now and expensive after the build
reads as "done."

---

## Current coverage

**Baseline actually run by the cartographer, 2026-08-06, pre-Slice-3:**

| Suite | Result |
|---|---|
| `npm run test:server` | **1787 / 1787 pass**, 444 suites, 0 fail / 0 skip / 0 todo, ~59s |
| `npm run test:client` | **822 / 822 pass**, 61 files, ~6.6s |

Both suites run in full (not targeted), because Slice 3 touches cross-cutting
registries (`CONSUMERS`, both `assertSingleHome` maps, `FILE_DISPOSITIONS`,
`db-migration.test.js`'s registry meta-test) whose blast radius is not confined
to one spec file. **This is the diff target.** When SF-4 lands, T7 is
*expected* to go red as a designed, same-commit replacement (WATCH-S3-D) — that
is not a regression. Any other red anywhere in either suite is.

**What guards these surfaces today:**

| Surface | Verdict | Evidence |
|---|---|---|
| SF-4 composition (the extraction target) | **GUARDED, by a test designed to go red on extraction** | T7 (`project-plans-api.test.js:905`) string-matches the composition *inline in each handler body*; it is the only route↔route guard that exists |
| `CONSUMERS` registry completeness | **UNGUARDED as a list** / **anchored as a value** | nothing greps real importers against the array; but `ledger-metrics-parity.test.js:281` (C2.4) does `deepEqual` it against a literal 3-entry set |
| `assertSingleHome` consumer maps (value-ledger `:462`, value-summary `:400`) | **GUARDED for today's consumer set; structurally weak on the axis Slice 3 must extend** | both maps are real and content-anchored on the *export* axis; the *consumer* axis is hand-typed and went stale one slice ago (SF-5) |
| `chronology-ordering.js` `FILE_DISPOSITIONS` | **GUARDED, fail-closed** | derived from `readdirSync`, throws on an undispositioned file (`:243`) and on a stale entry (`:249`) — the working shape |
| `summaryModel("grouping")` / `SUMMARY_STAGES` | **PARTIAL** | cascade tested in isolation (3 real cases); zero coverage of a real invoker, because none exists pre-Slice-3 |
| `focus-summary.js` day→window rollup (the precedent being copied) | **GUARDED, non-vacuous** | both decompose and disclose halves fixture-anchored on real prompt content and real persisted rows |
| `value_claims` "no `closed_at`" derive-don't-copy precedent | **GUARDED for behavior / UNGUARDED as a structural invariant** | claim create/dedupe exercised; nothing fails if a future edit re-adds a copied status column |
| All of Slice 3's own surfaces | **UNGUARDED (net-new)** | 0 hits for `value_group*`/`value-groups` across `server/`, `client/`, `server/__tests__/` — expected, and the reason this slice exists |

**Planned coverage is substantial and mostly well-shaped.** 5 new spec files +
6 edited, ~60 named cases, red-proof procedures attached to every structural
guard, an e2e layer that boots the real Express app against real SQLite over
real HTTP with every spawn injected, and a correctly-reasoned decision that no
WS layer is needed this slice (WATCH-S3-E). The four gaps below are what stands
between that and ADEQUATE.

---

## Reconciliation rulings

The two evaluators extended the plan's mandated coverage independently and did
not reconcile with each other. These four rulings are binding for the test plan.

### R1 — The final §9.8 combination-test row set

`technical-plan.md` §11.1 mandates **one** combination row. `unit-tests.md` §4a
designed **six** (a–f). `risk.md` §4.1 named **three** more. `unit-tests.md`
proposed **one** candidate and explicitly deferred to this pass. Reconciled:

**One of `risk.md`'s three rows is already covered.** Its "complement case"
(complete coverage + prior `failed` + re-request → *fresh* attempt, not a stuck
`failed`) is `unit-tests.md`'s **row c**, already designed with the spawn-count
assertion that proves it. No action — but note this is exactly why
reconciliation is needed: two documents independently specified the same row
and neither knew.

**One of `risk.md`'s three rows fell out of `risk.md`'s own §6 list.** §4.1
named the `completed_zero_groups` reuse branch; §6.2's disclosed-and-declined
list carries only the other two. That is this project's recorded meta-failure
("named in `risk.md`, adopted by neither architect, and its own stated fallback
of 'then it becomes a WATCH row' also didn't happen" — §9.1's 2026-08-02 note,
re-observed 2026-08-04) **recurring inside the QA pass whose job was to prevent
it.** Adopted below rather than dropped.

**`unit-tests.md`'s candidate row conflates two routes.** Its "`already_running`
+ coverage regresses mid-flight" case reasons about a concurrent **`GET
/groups` poll**, but proposes it as a row in the **`POST /groups/propose`**
truth table. Per `technical-plan.md` §7's own handler ordering (gate at step 2,
`in_progress` at step 3), a `POST` with regressed coverage returns **409**
whether or not a run is live — so as literally written the candidate row would
assert the opposite of the plan. Adopted, but **relocated and split**.

**FINAL MANDATED SET — nine rows in the `POST /groups/propose` truth table**
(one test, one table, per §11.1's "not four isolated branches"), each asserting
response `outcome` + HTTP status + **exact spawn-stub call count**:

| # | Prior run state | `coverage.complete` | Expected `outcome` | HTTP | Spawn | Source |
|---|---|---|---|---|---|---|
| a | none | true | `started` | 202 | 1 | unit-tests |
| b | none | false | `blocked_coverage_incomplete` | 409 | 0 | unit-tests |
| c | `failed` | true | `started` (fresh, not reused) | 202 | 1 | unit-tests = risk §4.1 complement |
| **d** | `failed` | false | `blocked_coverage_incomplete` | 409 | 0 | **plan-mandated** |
| e | `completed` + digest match | true | `reused_unchanged` | 200 | 0 | unit-tests |
| f | `in_progress` | true | `already_running` | 200 | 0 | unit-tests |
| **g** | `in_progress` **AND digest matches** | true | `already_running` | 200 | 0 | **risk §4.1 — ordering proof** |
| **h** | `completed_zero_groups` + digest match | true | `reused_unchanged` | 200 | 0 | **risk §4.1 — the row that fell out of its own §6** |
| **i** | `in_progress` | false | `blocked_coverage_incomplete` | 409 | 0 | **new this pass — pins the gate-vs-`in_progress` ordering** |

Row **g** is the direct test of step-3-before-step-4: a matching digest against
a *currently running* run must never spawn a second pass. Nothing in the DoD
asked for it; each branch individually working is precisely the shape §9.8's
own worked example says a per-branch suite misses.

Row **h** exercises the `OR` branch of the reuse condition. `completed_zero_groups`
is the state most likely to be conflated with "not attempted" — which is the
entire reason §9.8 exists — so leaving the reuse path seeded only with a
`completed` fixture leaves the more dangerous half untested.

Row **i** is new here and is the ordering row the candidate was reaching for.
Per §7 the gate wins, so a `POST` during a live run with regressed coverage
409s — and the 409 body says `blocked_coverage_incomplete` while a run *is*
genuinely in flight. **Both facts are true and they must not collapse into
one.** Row i asserts the 409 *and* that `GET /groups` for that project still
reports `run.state === "in_progress"` in the same test. Whichever way the build
resolves the presentation, the ordering becomes a pinned decision rather than
an accident.

**Plus one read-side case, in the same file, not in the table** (this is the
relocated candidate): *`GET /groups` during an `in_progress` run whose coverage
has regressed returns `run.state === "in_progress"` and a `gate` field of
`blocked_coverage_incomplete` — two both-true facts in two fields, never one.*
Row d's own dual assertion is its sibling; this is the same rule on the read
path.

### R2 — T7: fully deleted. No part survives. `change-brief.md` is wrong.

**Verified byte-for-byte against live code this pass** —
`server/__tests__/project-plans-api.test.js:905-999`:

- T7's *entire* mechanism is regex-scanning the **route-handler source text**.
  `extractCoverageSnapshotKeys(handlerBody)` matches
  `/const snapshot = coverageSnapshot\(dbModule, \{([^]*?)\}\);/` **inside the
  handler body**. After extraction that statement lives in
  `value-coverage-probe.js`, so the match returns `[]`, and
  `assert.ok(postKeys.length > 0, ...)` at `:985` fails *before* the anchor is
  ever reached.
- Therefore the anchored `deepEqual(postKeys, [...])` at `:994-998` — which
  `change-brief.md` says "survives unmodified" — **cannot survive.** It is
  inside T7 and depends entirely on T7's source-scanning mechanism.

**RULING: T7 is deleted in full. Zero lines survive. `technical-plan.md` §6.1
is correct and is the document of record; `change-brief.md`'s changed-files
table is factually wrong on this point and should be corrected in place** so a
build-time reader does not try to preserve lines 988-998 and leave a
half-broken T7 standing — which is precisely how "adjusted until it passes"
(§9.4's named temptation) happens.

**And a finding neither evaluator caught, which is the real cost of the
discrepancy: T6 is not T7's anchor.** Both `technical-plan.md` §6.1 and
`unit-tests.md` §2b name T6 as the surviving anchor. Verified live, they assert
**different closed sets**:

- **T6** (`:886-903`) anchors the **HTTP response body**: nine `snake_case`
  keys — `complete, computed_at, demand, described, eta, pending, pool_size,
  project_id, requested_at`.
- **T7** (`:994-998`) anchors the **`coverageSnapshot` call's argument set**:
  five `camelCase` keys — `computedAt, counts, draining, projectId,
  requestedAt`.

T6 has never asserted anything about the second set and is unaffected by the
extraction. So the claim "the anchored half survives" is true of a *different*
anchor. The five-key argument-set anchor is the one that regression-proofs the
SF-3 `draining` fix and the load-bearing SF-2/SF-3 `requestedAt` divergence —
and it currently has **no named successor anywhere in the plan**. This is
`must-add-now #1` below.

### R3 — `ledger-metrics-parity.test.js` C2.4: flag it back **and** carry it. Both.

`unit-tests.md`'s find is **confirmed live**:
`server/__tests__/ledger-metrics-parity.test.js:281` — `it("C2.4: consumer
registry marker — CONSUMERS names exactly the route, the CLI, and the tick
(DEC-16)")` — does `assert.deepEqual` against a literal 3-entry sorted array.
`server/lib/value-ledger.js:70-74` holds exactly those 3 entries.
`DEC-S3-10`/O-8 adds a 4th. **C2.4 goes red by construction**, and the file is
absent from `technical-plan.md` §9's "Edited — tests" table.

**RULING: both, not either/or.**

1. **The test plan carries the case directly**, with the exact expected 4-entry
   array, so intake does not need to re-run. Correct.
2. **AND it is flagged back as a named correction to `technical-plan.md` §9's
   change-set table** — a one-line addendum, not a re-plan. This half is not
   optional. §9 is the artifact `build-implementer` works from and the DoD
   checks against; leaving it absent means the build's own file list is
   knowingly wrong, and *a red test discovered mid-build with no planned
   case description is the exact condition under which "adjusted until it
   passes" happens*. That is not hypothetical here — it is how T7's own anchor
   came to ship at 1-of-2 assertions in Slice 2 (§9.4's PARITY-WITHOUT-ANCHOR
   note).

**And a second finding, new this pass, that changes what the fix must be.**
`CONSUMERS`' own declaring comment (`value-ledger.js:64-69`) states the growth
rule: *"Grow this list ONLY when the new consumer reads
`computePlanHealth`/`assembleValuePool`/`summarizeDeliveredValue` directly,
never re-implements a piece of them."* But `DEC-S3-10` rules that
`value-groups.js` **never calls `assembleValuePool`** — the route handlers pass
`units` in — and `unit-tests.md` §5.2 correctly puts `assembleValuePool` in its
`absent:` list. `value-groups.js` calls `unitKey` and nothing else.

**By the registry's own stated rule, `value-groups.js` does not qualify for
`CONSUMERS`.** `DEC-S3-10` rules it in anyway ("over-registering costs one
string") — a defensible call, but it makes the registry's membership falsify
the registry's own comment. This is exactly the tell §9.1's standing check
names, and this project has now recorded **three consecutive builds** in which
an unevidenced invariant claim in a header comment marked the precise spot the
invariant fails. **Required: the declaring comment's growth rule is widened in
the same commit as the entry** (to something like "…or reads this module's
derived *values* — e.g. `unitKey` — without re-implementing them"), and C2.4's
own failure message is updated to match. One string plus one comment, or the
registry ships self-contradicting.

### R4 — `approve` freshness: split. Test now, behavior change is Sara's call.

`risk.md`'s find is real and genuinely new: `POST /groups/:id/approve` is a
pure `review_status` + `reviewed_at` update; it never calls
`resolveMemberAvailability` and never re-reads the live pool. The read-time
drift check exists **only** at `GET /groups` render time. Load the panel, leave
the tab open, let a member get claimed elsewhere — **Approve succeeds silently
against a stale render.** `WATCH-S3-A` covers Slice 4's *claim* route
specifically and does not mention Slice 3's *approve* route at all, so this is
currently undisposed. Confirmed: no `decisions.md` row names it.

**RULING — split into the invariant (must-add now, free) and the behavior
change (WATCH row, Sara's call):**

- **Must-add now, this round.** The *invariant* test: a group whose member
  transitions to `already_claimed` / `no_longer_in_pool` **between the `GET`
  and the `approve`** can still be approved, does not error, does not silently
  drop the drifted member from `value_group_members`, and the immediately
  following `GET /groups` reflects the drift with the partition property
  intact. This is nearly free: `e2e-tests.md` flow 6 already builds this exact
  fixture — it just introduces the drift *before* the read. **Move the drift to
  between the read and the approve** and the case is written. This is the
  assertion that makes "approve is pure bookkeeping" true *under drift*, which
  is the only condition where it could stop being true.
- **WATCH row, deferred to Sara.** Making `approve`'s **response** carry a
  freshly-recomputed `member_availability_counts` / `members` snapshot is a
  *wire-contract change* on a route whose contract AC-5 deliberately scopes to
  bookkeeping. It is cheap (the read-time computation exists; it needs a second
  call site) but it is a scope addition beyond the 2026-08-04 approval and
  belongs with `decisions.md`'s other cheap-to-reverse vetoes. **Open
  `WATCH-S3-F`** — `Fires-on:` Slice 4's claim build, or an observed
  approve-against-stale-render in practice; `Lands-in:`
  `server/routes/project-plans.js`'s approve handler + `value-groups-api.test.js`.
  Distinct from `WATCH-S3-A`, naming the approve route explicitly.

This honors `risk.md` §6's own trip-wire: it demanded a tracked row if the
fresh-snapshot test were declined, and *"disclosed in prose is not a terminal
state"* is this project's own rule.

---

## Gaps & test-debt diagnosis

### The four must-add-now gaps

**1. (Highest) T7's argument-set anchor has no successor — regression-of-a-fix.**
Per R2, the five-key `coverageSnapshot` argument anchor
(`computedAt/counts/draining/projectId/requestedAt`) dies with T7 and is
carried by nothing. This anchor exists *because* §9.4's PARITY-WITHOUT-ANCHOR
detector caught it missing one week ago; deleting it unreplaced would make
Slice 3 the **8th** occurrence of §9.1 rather than the cure for the 7th.
`unit-tests.md` §2b intends to preserve it but names the wrong target — it says
the replacement guard reuses that literal array "against `buildProbeCoverage`'s
actual composed output," which is a category error: those five are
`coverageSnapshot`'s **inputs**, not `buildProbeCoverage`'s **output** keys
(the output is T6's nine `snake_case` keys, correctly anchored in
`unit-tests.md` §2a case 1).

**2. `ledger-metrics-parity.test.js` C2.4 + the self-contradicting `CONSUMERS`
comment.** Per R3.

**3. The §9.8 branch-ordering seams** (rows g, h, i + the read-side case). Per R1.

**4. `approve` under drift.** Per R4.

### The systemic reason these gaps exist

This project's own four-times-recorded diagnosis, and it is exactly right here:
**test scope is per-module, not per-shape.** Per-module specs exist for the
module, for the routes, for route↔broadcast — and the one *shape* nobody named
is the one with no guard. Every gap above is a **shape that spans a boundary**:

- T7's anchor is a shape (route↔route composition), and shapes get **orphaned
  at delete-and-replace boundaries**. Nothing in this project's process asks
  "what distinct *claims* did the deleted test make, and who carries each one?"
  — only "was the test deleted." A test is deleted as one unit; the claims
  inside it are five.
- C2.4 is a **registry whose anchor lives in a different file from the
  registry**, so the registration edit and the anchor edit are two files that
  no single obligation owns jointly. Identical to SF-5's shape one slice ago,
  where the author was *inside* the map and still did not see its membership
  was stale — a hand-typed registry does not prompt you to add yourself to it.
- The §9.8 ordering rows are **seams between branches**, and a suite organized
  one-test-per-branch is structurally incapable of containing them.
- `approve`'s freshness gap is a **seam between two routes** (`GET` renders,
  `POST` acts), disposed by a WATCH row scoped to a *third* route in a *future*
  slice.

And one level up, this pass surfaced the meta-instance: **`risk.md` named three
rows in §4.1 and carried two into its own §6 tracked list.** The document whose
explicit job was to prevent "named by the risk analyst, adopted by neither
architect, WATCH-row fallback also didn't happen" dropped one of its own rows
between its own two sections. The systemic reason is the same one: a claim that
must appear in two places belongs to nobody unless something mechanically
checks that it did.

**Have we shipped this class of gap before? Yes — every gap above lands on a
numbered catalog entry, and four of the five are on entries that are OPEN on
this exact file family.**

| Catalog id | Status | How this change touches it |
|---|---|---|
| **§9.1 DERIVED-DUAL-VIEW** (occurrence 7) | **OPEN — SF-4 ruled MANDATORY for Slice 3, 2026-08-06** | **Exposure 1, regression-of-a-fix:** SF-4's extraction is the cure for occurrence 7, and gap 1 above (orphaned anchor) is how the cure becomes occurrence 8. The two hand-copies already diverged once on `requestedAt`, confirmed still standing at `project-plans.js:319` / `:352`. |
| **§9.1 DERIVED-DUAL-VIEW** (same entry, 2nd axis) | **OPEN** | **Exposure 2, and it is genuinely new:** `groupingFacts` extends `unitFacts`, so `unitFacts` now has **two** downstream comparators (`compareUnitInputs` for altitudes, `computeGroupingDigest` for groups). This is a structural re-run of occurrence 7's *exact* defect — which shipped 2026-08-05 with a JSDoc asserting the divergence was "physically impossible" and was harmless only by accident. The `UNCOMPARED_FIELD_GUARANTORS` key-walk test is mandated (PM-4) and is the right shape; it is also the assertion most likely to be quietly narrowed. |
| **§9.3 VACUOUS-GUARD** | **OPEN — 9 / 9 / 4 events on the three prior builds of this file family** | Every structural guard this slice adds. `risk.md` ranks the **mechanical pre-grouping guard** as most likely to ship vacuous, and the reasoning is sound: zero spawn mocking makes it look "easy," and it **over-generates by design** — a test author unaware of that will either loosen the assertion until it accepts anything or narrow the fixture until overlap never occurs. Both silently disable the guard. `unit-tests.md` §1 case 5 (a unit appears in *both* clusters, never deduped) is the specific case that closes it. |
| **§9.7 HAND-SCOPED STRUCTURAL SCAN** | **OPEN, 7 occurrences — most recent SF-5 on this exact file family, one slice ago** | `CONSUMERS` + **both** `assertSingleHome` consumer maps + C2.4 must all gain `value-groups.js` in the same commit as the new `require`. SF-5 was this *exact* axis on these *exact* files. The catalog's own note: *"the cure recommended at occurrence 6 remains half-built, and this is what the unbuilt half costs."* Good news, verified: N2 is **CLOSED** (`value-coverage.test.js:297`) and `FILE_DISPOSITIONS` fails closed (`:243`). |
| **§9.8 OVERLOADED-ABSENCE** | **OPEN — promoted 2026-08-04 on this file family; recurred in the very next build (SF-6)** | Three orthogonal axes at once (5 run states / 4 refinement states / 3 availability states), plus the two branch-ordering seams of R1. §9.8's own cure is *"test the combination, not the two branches separately"* and its own worked example is a "cap first, then gate" ordering bug — the shape rows g/h/i exist for. |

**Count discipline:** nothing is built, so **no occurrence count is
incremented**. These are design-time exposures, recorded per this catalog's own
"NOT an occurrence, count unchanged" convention.

---

## Recommendation

### Must-add-now — these gate the build (worst first)

**M1. Transfer T7's claims one by one, in a named table, before deleting it.**
T7 makes five distinct claims. Write the successor for each into
`technical-plan.md` §6.1 as a table, and make the DoD line *"every row has a
named successor and each was observed red"* rather than *"T7 deleted."*

| T7 claim | Successor |
|---|---|
| Both handlers call `assembleValuePool(dbModule, {id: projectId})` | `buildProbeCoverage` call-site-set guard (exactly 3 sites, derived scope, fail-closed) |
| Both call `enrichPoolAltitudes(..., {probe:true})` | same guard + `value-coverage-probe.test.js` §2a case 5 (counts come from the composer, anchored to a literal fixture) |
| Both pass `draining: isDrainingProject(projectId)` (the SF-3 fix) | `value-coverage-probe.test.js` §2a case 6 — **this is the only thing regression-proofing SF-3 after deletion; it is currently one case and must not be dropped** |
| `postKeys === getKeys` (route↔route parity) | **Deliberately not replaced** (DEC-S3-4 — one function, so `deepEqual(f(X),f(X))`). Record as intentional, not as an oversight. |
| `postKeys === ["computedAt","counts","draining","projectId","requestedAt"]` (the anchor) | **CURRENTLY ORPHANED — must be assigned.** Recommended: one assertion in `value-coverage-probe.test.js` that `buildProbeCoverage`'s internal `coverageSnapshot` invocation receives exactly that five-key set (spy/stub the `coverageSnapshot` import and `deepEqual` the received argument keys). This preserves the anchor's actual content at the one place it now lives. Add a `computedAt` freshness case, which no current case covers. |

**M2. Add rows g, h, i to the §9.8 truth table + the read-side `GET /groups`
case** (R1). Same fixture machinery as the mandated row — cheap now, expensive
once the guard exists and reads as done.

**M3. Correct `technical-plan.md` §9's change-set table to include
`ledger-metrics-parity.test.js`, and widen `CONSUMERS`' declaring-comment
growth rule in the same commit as the 4th entry** (R3). Also correct
`change-brief.md`'s T7 row (R2) so nobody preserves lines 988-998.

**M4. Move `e2e-tests.md` flow 6's drift injection to *between* the `GET` and
the `approve`, and open `WATCH-S3-F`** (R4).

**M5. Hold the line on the three §9.3 red-proofs `risk.md` ranked** — mechanical
pre-grouping (over-generation case 5 is the load-bearing one), the negative
proof's structural scan, and the persistence guard's **`failed`-batch
disclosure path** specifically (a guard that checks "the response looks like a
proposal" without separately asserting the stored row's `name`/`summary_sentence`/
`rationale` are NULL and `refinement_state='failed'` would pass while a partial
write promotes a group to `refined` it never earned). **Performed and
independently re-run, not narrated** — this file family has three consecutive
builds where `build-reviewer` caught blockers a correctly-executed verifier pass
had already certified green. `intake-qa` and `build-reviewer` are non-trimmable
here (PM-6.1); that is empirically earned, not procedural.

### The durable cures — these kill the class, not the instance

**D1 (cheap, adopt this slice): a deleted guard is replaced claim-by-claim, not
test-by-test.** M1's table *is* D1's first instance; the durable part is making
it a standing rule in `PROJECT-CONTEXT.md`. This project's recurring failure is
not "a test was deleted carelessly" — it is that **a test is one unit and its
claims are many**, so a delete-and-replace silently drops the claims nobody
enumerated. This is the same mechanism that shipped T7 itself at 1-of-2
mandated assertions in Slice 2. One table per deletion. Nearly free, and it
directly closes the highest-severity gap in this slice.

**D2 (the real cure, and the catalog has been asking for it since occurrence
6): build the derived-consumer-scope guard once, generically.** §9.7's own
diagnosis is that `assertSingleHome` has one derived axis (exports) and one
hand-typed axis (consumers), so it *reads* as derived and is trusted as such.
The recommended cure — enumerate the consumer list from a grep of `server/lib`
+ `server/routes` + `bin/` for the module's own import specifier, and fail on
any importer missing from the map — **remains half-built after 7 occurrences**,
and SF-5 (one slice ago) is what the unbuilt half costs.

Slice 3 is the 4th consecutive build on this family and the 3rd to hand-edit
these maps. It is also the build with the strongest possible forcing function:
it must register a new consumer in **four** hand-typed places
(`CONSUMERS`, two `assertSingleHome` maps, C2.4). Build
`assertConsumerScopeDerived(modulePath)` once, point all four at it, and the
class is closed — including for `CONSUMERS`, whose own completeness has never
been guarded by anything. The shape is already proven in this tree twice:
`FILE_DISPOSITIONS`' fail-closed miss branch (`chronology-ordering.test.js:243`)
and the anchored exemption-set assertion (`value-coverage.test.js:297`). This
is copying two working local patterns, not inventing one.

### Is it safe to ship?

**Yes, once M1–M5 land** — and the sequencing matters more than usual. The
highest-risk moment in this slice is not the steady state, it is the
**transition**: T7's deletion and the new guard's creation are two edits to the
same suite in the same commit, and if they land in the wrong order there is a
window with **no guard at all** over this composition, in which a suite run is
green for the wrong reason. `technical-plan.md` §10 step 2 sequences
extraction + guard + red-proof together, which is correct; the risk is entirely
a test-author splitting it into two commits under time pressure. **Do not split
step 2.**

---

## Open decisions for the user

- [ ] **D2 — build the derived-consumer-scope guard now, or hand-edit four
      registries a 4th time?** Recommended: build it. It is ~40 lines, both
      constituent patterns already exist in this tree, and Slice 3 is the build
      that must touch all four registries anyway. Declining is legitimate —
      but it means accepting a 5th hand-registration in Slice 4, on a class with
      7 recorded occurrences and a cure the catalog has recommended since #6.
- [ ] **`WATCH-S3-F` (R4) — accept as a WATCH row, or pull the fresh-snapshot-on-
      approve behavior into this slice?** Recommended: WATCH row. It is a wire-
      contract change beyond AC-5's scope, and M4's invariant test covers the
      correctness half for free. But it is *your* call whether "approve" should
      tell you the membership shifted under you — `decisions.md` PENDING item 4
      is already asking you a related question about what "approve" means.
- [ ] **`DEC-S3-10` vs. `CONSUMERS`' own growth rule (R3).** Keep the
      over-registration and widen the comment (recommended — one string, one
      comment), or honor the comment as written and leave `value-groups.js`
      out? The one thing not on the table is shipping the entry with a comment
      that forbids it.
- [ ] **`OPEN-S2-1` (carried) — which real project validates the end-to-end
      flow?** Still open, still non-blocking, recorded so it does not silently
      close.
- [ ] The six `decisions.md` PENDING vetoes are unchanged by this pass. If you
      veto any, the affected test obligations above need a one-line update, not
      a re-plan.

---

*Memory updated:* `qa-run-log.md` ✅ · `PROJECT-CONTEXT.md` §9.1 / §9.7 / §9.8 —
dated design-time QA-pass notes added, **no occurrence counts incremented**
(nothing is built).
