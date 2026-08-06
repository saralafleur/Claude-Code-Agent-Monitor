# Risk & Regression Analysis — Value Pool Slice 3: Auto-group proposal engine

**Analyst:** `qa-risk-analyst` · **Date:** 2026-08-06
**Status of change:** NOT YET BUILT — this is a pre-build risk pass against
`technical-plan.md`, `decisions.md`, and `pm-plan.md` in this same intake
folder. All three evaluator-correction rulings (three-table schema, SF-4
MANDATORY with T7 going red, no route↔route parity guard, read-time-only
drift safety) are treated as **settled**, not re-litigated here.

**Grounding:** `PROJECT-CONTEXT.md` §9 (read in full, §9.1–§9.8 plus all four
un-catalogued candidates), cited by id throughout.

---

## 1. Blast radius

Beyond the literal new/edited files (`server/lib/value-groups.js`,
`server/lib/value-coverage-probe.js`, 3 new tables, 4 new routes,
`PlanLedgerPanel.tsx`), this change has real dependency reach into:

- **`server/lib/value-ledger.js`'s `CONSUMERS` array (lines 70–74)** — a
  shared registry already read by 3 other consumers; Slice 3 is the 4th.
  Anything that reads this registry for scope (a future audit, a future
  §9.7 scan) inherits whatever Slice 3 writes here.
- **`server/__tests__/single-writer-guard.test.js`'s two `assertSingleHome`
  consumer maps** (`../lib/value-ledger` at line 467, `../lib/value-summary`
  at line 413) — shared, hand-typed-on-one-axis registries touched by every
  slice in this family. Slice 2 already went stale on exactly this axis
  (SF-5, below).
- **`server/lib/value-summary.js`'s exported `unitFacts(unit)`** —
  `groupingFacts()` is explicitly built "on top of" it (technical-plan §5.4).
  Any change to `unitFacts`'s shape now has two downstream comparators
  (`compareUnitInputs` for altitudes, `computeGroupingDigest` for groups)
  that must both track it — a fresh instance of the exact "prompt grows a
  field the comparator doesn't cover" shape that already shipped once
  (§9.1's 2026-08-05 BUILT note).
- **`server/lib/focus-summary.js`'s `localDayLabel`** and **`focus-inference.js`'s
  `runClaudePromptJson`** — both explicitly reused rather than
  reimplemented; correct per the plan, but it means a change to either
  function's contract now has a 3rd/2nd caller respectively that must be
  regression-tested, not just the caller that motivated the original change.
- **`server/__tests__/chronology-ordering.test.js`'s derived `filesToScan`**
  and **`server/__tests__/db-migration.test.js`'s registry-completeness
  meta-test** — both must pick up the two new lib files / confirm zero new
  migration entries; these are shared gates every future file in `server/lib`
  and `server/routes` passes through.
- **`server/__tests__/value-coverage-parity.test.js` (G2, route↔tick)** —
  must keep passing **unmodified** through the SF-4 extraction. It is not
  edited by this slice, but it is a canary: if the extraction subtly changes
  what `coverageSnapshot(...)` is called with, this is the test most likely
  to catch it — or, if its own assertions are looser than believed, to stay
  green over a real drift.
- **`openapi.yaml` / `server/__tests__/openapi-contract.test.js`** — 4 new
  routes need documenting. This scan's mount↔path completeness is **derived
  from `app.use("/api/…")` mounts**, not from individual routes — see §4
  below for why this specific shape is a known blind spot on this exact
  parent request (CONTRACT-SPEC-DRIFT candidate).
- **`client/src/pages/ProjectDetail.tsx:1292`** — mounts `PlanLedgerPanel`
  **unkeyed**. Every new piece of entity-scoped state this slice adds to
  that panel (group list, run state, in-flight propose request) inherits
  whatever reset discipline is already there, or does not.
- **`value_claims` and its writers (`insertValueClaim`, `deleteValueClaim`,
  `server/db.js:3360,3375`)** — not touched by this slice's code, but are
  the enumeration target for the mandatory "proposals never actions"
  structural scan (§11.4.1 of the technical plan). If that enumeration ever
  drifts from the real write surface (a future claim-writer added
  elsewhere), the scan's blast radius silently shrinks with it.
- **Four locale files** (`en`/`ko`/`vi`/`zh` `projectDetail.json`) and the
  whole i18n test harness, plus **`client/src/pages/__tests__/screens.snapshot.test.tsx`**
  — six new state registries land here; a partial locale update is exactly
  the shape §9.7's N2 finding already proved this project ships when a
  registry's miss branch fails open.

---

## 2. Invariants that must hold (mapped to `PROJECT-CONTEXT.md` §9)

| Invariant | Catalog id | Applies here as |
|---|---|---|
| Every genuinely distinguishable outcome gets its own wire value; never zero buckets, never two | **§9.8 OVERLOADED-ABSENCE** | Run state (5 values), refinement state (4 values), member availability (3 values) — three separate axes, three separate partition obligations |
| A derived value is computed exactly once, server-side; no consumer re-derives it | **§9.1 DERIVED-DUAL-VIEW** | `buildProbeCoverage` (3 call sites, 1 definition); `resolveMemberAvailability`/rollup counts (server-computed, client renders verbatim); `computeGroupingDigest`'s input set == `buildGroupingPrompt`'s input set by construction |
| Any query walking a bulk-insertable/chronological table sorts by `created_at` with `id` as tiebreak, before any `LIMIT` | **§9.2 row-id-as-chronology-proxy** | `listValueGroupRunsForProject`, `listValueGroupsForRun` — the schema's indexes already model this correctly (`(project_id, started_at, id)`, `(run_id, created_at, id)`); the SQL itself must actually `ORDER BY` that way, not just have the index available |
| A guard is not done until observed red against a real mutation, re-performed by someone other than its author | **§9.3 VACUOUS-GUARD** | Mechanical guard, persistence guard, digest guard, negative-proof (all 4 sub-checks), SF-4 call-site guard — every one of these is explicitly named MANDATORY in the technical plan |
| A structural scan's scope is derived from the real surface, not hand-typed, and its miss branch fails closed | **§9.7 HAND-SCOPED STRUCTURAL SCAN** | `CONSUMERS`, both `assertSingleHome` consumer maps, the SF-4 call-site scan, all six new registries' locale mirrors |
| A `CREATE TABLE` change ships with a guarded `ALTER TABLE`+`UPGRADE_CASES`, or is a genuinely new table needing neither | **§9.5 FRESH-DB-BLIND SCHEMA CHANGE** | Confirmed inapplicable — all three tables are brand-new, zero `ALTER`. Correctly excluded from DoD |
| A CHECK-widening rebuild is atomic, never a hand-rolled rename/copy/drop | **§9.6 NON-ATOMIC REBUILD** | Not triggered *this* slice (reserving `claimed` avoids a CHECK-widen now) but the reservation is explicitly what defers this risk to Slice 4 — see §3 below |
| A fix round gets its own adversarial review, not a rerun of the suite that was already green | **§9.4 FIX-ROUND-REGRESSION** | Applies to any post-review fix cycle on this build; the plan already rules `build-reviewer`/`intake-qa` non-trimmable (PM-6.1) citing exactly this history |
| A component's entity-scoped state resets when its identity prop changes | **MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH** (candidate, fired once — SF-8) | `PlanLedgerPanel`'s new group/run state, mounted unkeyed at `ProjectDetail.tsx:1292` |
| An effect that flips a ref in cleanup re-arms it in setup; RTL renders under `<StrictMode>` at least once | **STRICTMODE-BLIND CLIENT SUITE** (candidate, fired once — BL-2, same component) | Any new polling/loading effect this slice adds to `PlanLedgerPanel` |
| A canonical hand-maintained contract artifact (OpenAPI) is scanned for completeness derived from the real route surface | **CONTRACT-SPEC-DRIFT** (candidate, not yet promoted) | 4 new routes under an *already-documented* mount (`/api/project-plans`) — see §4 |

---

## 3. Recurring-issue mapping — this is a place we've bled before

This is **not** a fresh surface. It is the 5th consecutive effort in 3 days
on the `value-ledger`/`value-summary`/`value-coverage` file family, with
**9, 9, and 4 §9.3-family events** across the three prior builds — the
densest recurring-defect zone this project has on record
(`pm-plan.md` §3b, confirmed against the catalog directly). Three items are
worth calling out loudly rather than in passing:

1. **§9.1 SF-4 (occurrence 7, "OPEN, ruled MANDATORY for Slice 3")** — this
   is not new-code risk, it is **regression-of-a-fix risk**. The catalog's
   own 2026-08-06 note says the deferral trigger has fired and names this
   slice literally. If the extraction lands with T7 "adjusted until it
   passes" instead of deleted-and-replaced (the §9.4-named temptation the
   Slice-2 implementer was explicitly praised for refusing), or if the
   replacement guard is unanchored, this is the **8th** occurrence of §9.1
   on a project that has already watched a parity guard degrade to
   `deepEqual(f(X), f(X))` once this exact week (Slice 2's
   `value-coverage-parity.test.js`).
2. **§9.7 (7 occurrences, most recent two — SF-5 and N2 — on this exact file
   family, one slice ago).** SF-5 was `assertSingleHome`'s **consumer axis**
   going stale (a 3rd consumer added, the map still listing 2) in the same
   commit the author was editing that same map — caught only by the
   reviewer. N2 was a hand-typed locale-key mapping whose miss branch
   `continue`s past an unhandled value, discovered in the **same** change
   set. Slice 3 requires **exactly this kind of registration** on **both**
   `assertSingleHome` maps plus `CONSUMERS`, for a 4th consumer. This is the
   surface's most reliable failure mode, one slice old, and it is required
   again here.
3. **§9.8 — the parent request's own named standing trap, and Slice 3 is
   literally its live instance #1's own surface.** The 2026-08-04
   promotion event happened on this exact file family; the "combination,
   not isolated branches" cure it prescribes is directly cited in the
   technical plan (§11.1). Getting the combination test *shape* right here
   matters more than on almost any other surface in this codebase, because
   this project has already shipped the "cap-first-then-gate ordering bug"
   this failure mode predicts, twice, on siblings of this exact code.

None of these three are marked RESOLVED against Slice 3 yet — they are the
project's own prediction of how this build will fail if the guardrails are
traded for speed, and the technical plan reads and cites the catalog
correctly. The risk is not that the plan is wrong; it is that a plan is not
a guard (§9.1's own words: "prose in the catalog does not enforce; only an
assertion enforces").

---

## 4. The "ships green but broken" traps (each is a required new assertion)

### 4.1 §9.8 — the mandated combination test is necessary but not sufficient

The technical plan requires **one** truth-table combination: *incomplete
coverage + a prior `failed` run + a re-request → `blocked_coverage_incomplete`,
never a resurrected `failed`, never a silent re-attempt* (§11.1, DoD line).
That is the right combination to catch a "gate checked, then state
resurrected" ordering bug. It is not the only ordering bug this design can
have, and the plan's own route-handler ordering (§7: gate check → `in_progress`
check → digest-match check → spawn) creates at least two more branch-order
seams that a single-branch-per-state suite will not exercise:

- **The complement case**: coverage **complete** + a prior `failed` run +
  re-request. The correct behavior is a fresh attempt (a `failed` run is
  never reused per DEC-S3-6/PM-4), but nothing in the mandated combination
  proves the *fresh-attempt* path is reached rather than some inherited
  "stuck failed" short-circuit. A suite with "gate blocks correctly" and
  "digest reuse works" as separate, isolated tests can pass while this
  specific transition (failed → re-attempted, not failed → stuck) is never
  exercised.
- **`already_running` vs. digest-match priority**: the plan places the
  `in_progress` check (step 3) before the digest-match check (step 4) —
  correct, because a matching digest against a run that is *currently*
  running should never spawn a second one. Nothing in the DoD asks for a
  test that specifically proves this **ordering**, only that each branch
  individually works. This is exactly the shape ("cap first, then gate" —
  §9.8's own worked example) that a suite with one test per branch misses.
- **Digest match against `completed_zero_groups` specifically** — the spec
  allows reuse against either `completed` or `completed_zero_groups`, but a
  test suite that only seeds a `completed` fixture for the reuse case would
  leave the zero-groups branch of that `OR` untested, and zero-groups is
  the state most likely to be conflated with "not attempted" per §9.8's
  entire reason for existing.

**Recommendation:** extend the mandated truth table by these three rows
before build, not after. This is cheap now (it is the same fixture
machinery as the mandated case) and expensive to retrofit once the guard
exists and reads as "done."

### 4.2 §9.1 — the SF-4 extraction itself, mid-transition, not just post-transition

The transition moment is the highest-risk moment, not the steady state.
Concretely:

- T7 deletion and the new call-site guard's creation are two edits to the
  same suite in the same commit. If they land in the wrong order during
  implementation (guard added but not yet exercising real call sites; T7
  deleted before the guard exists), there is a window where **no guard**
  covers this composition at all, and a suite run in that window is green
  for the wrong reason. The build-order in technical-plan §10 step 2
  correctly sequences extraction+guard+red-proof together — the risk is a
  test-author splitting that into two commits under time pressure.
- The `requestedAt` divergence is explicitly load-bearing and must **not**
  be erased by the extraction (SF-2/SF-3 rationale). A guard that
  "helpfully" normalizes this difference away (treating it as a bug to fix
  rather than a parameter to preserve) would silently reintroduce the race
  those two prior fixes closed. Worth one explicit assertion that
  `POST /coverage-request`'s `requestedAt` and `GET /coverage`'s
  `requestedAt` are **allowed to differ** — a negative test, easy to skip
  because it looks like it's testing nothing.
- **Group-rollup re-derivation**: the plan is explicit that
  `member_availability_counts` is server-computed and the client renders it
  verbatim (§8, §11.3). The trap is not the initial build — it is the
  *next* touch, e.g. a future sort/filter feature on the proposal list that
  needs "how many available" client-side and recomputes it from the
  `members` array rather than reading `member_availability_counts`. Nothing
  in this slice's own diff can catch a defect that hasn't been written yet,
  but the anchored-fixture parity guard requested by §11.3 should assert
  against a **literal count**, not merely `deepEqual` the response against
  itself — otherwise it inherits the exact PARITY-WITHOUT-ANCHOR shape
  §9.4 already named on this file family (T7's own history).

### 4.3 §9.3 — which of the three named guards is most likely to ship vacuous

Ranked by likelihood, given this file family's own history:

1. **Most likely: the mechanical pre-grouping guard.** This is the guard
   with **zero spawn mocking** (technical-plan §5.1) — it is pure,
   deterministic, and therefore looks "easy" to test, which is precisely
   the condition under which this project's guards have most often
   degenerated into `Array.isArray(clusters)` or "a non-empty array was
   returned" rather than fixture-anchored exact membership. The mechanical
   pass **over-generates by design** (a unit may legitimately appear in
   more than one cluster) — a test author unfamiliar with that design
   choice is likely to write an assertion that treats overlap as a bug and
   either loosens the assertion until it accepts anything, or narrows the
   fixture until overlap never occurs, both of which quietly disable the
   guard's ability to catch a broken heuristic. The technical plan's own
   required red-proof ("disable one heuristic branch; the specific expected
   cluster goes missing") is the correct test, but it is also the easiest
   one to skip, because the happy-path assertion *looks* complete without
   it.
2. **Second most likely: the negative-proof's structural scan (proposals
   never actions, sub-check 1).** The plan is explicit that the write-surface
   enumeration must come from the real functions (`insertValueClaim`,
   `deleteValueClaim`), not be hand-guessed — this is a direct citation of
   this file family's own SF-5/N2 lesson, so the plan is already defending
   against it in prose. The risk is specifically in scope: a scan that
   enumerates the *known* claim-writer function names will not see a raw
   `db.exec("INSERT INTO value_claims ...")` string if anyone ever writes
   one, and will not see a *future* claim-writer added after this scan
   ships, because — per §9.7's own diagnosis — a registration that lands
   "as a follow-up" is the failure, not a delay. The mandated red-proof
   (inject a rogue claim write, watch it fail) only proves the scan works
   against **today's** surface.
3. **Also worth watching: the persistence guard, specifically on the
   `failed`-batch-disclosure path.** The happy path (a batch refines
   successfully) is where test-authoring attention naturally goes; the
   architect's own "disclose" behavior — a failed batch still persists its
   raw mechanical cluster with `refinement_state='failed'` and no LLM text —
   is a less-obvious code path to remember to assert row content against.
   A persistence guard that checks "the response shape looks like a
   proposal" without separately asserting the **stored row's** `name`/
   `summary_sentence`/`rationale` are NULL and `refinement_state='failed'`
   for this specific path would pass while silently allowing a partial
   write to promote a group to `refined` state it never earned — exactly
   the failure mode §11.2 explicitly warns against ("a partial/failed run
   does not silently promote a group to `refined`").

### 4.4 §9.7 — CONSUMERS / assertSingleHome, the file family's most common failure

Flagged by name in the technical plan, and worth repeating here because it
is this file family's single most reliable failure shape (6+ prior
instances across the catalog, 2 in the immediately preceding slice alone):
`CONSUMERS` (value-ledger.js:70–74) and **both** `assertSingleHome`
consumer maps (value-ledger.js at line 467, value-summary.js at line 413)
must gain `value-groups.js` in the **same commit** the new `require` lands.
SF-5's own lesson — "the author was inside the map and still did not see
that the map's own membership was stale" — means "the diff touches this
file" is not evidence the registration is complete; only an assertion that
**derives** the consumer list from a grep of `server/lib`+`server/routes`+`bin/`
importers, and fails on any importer missing from the map, closes this.
The technical plan asks for exactly that derived-and-fail-closed shape
(§6.2, §11.5) — the risk is entirely in whether the build executes it as
specified rather than reverting to the map-editing-by-hand pattern that has
now failed twice on this exact pair of files.

### 4.5 The genuinely new risk — proposal/live-pool drift, and what survives even the ruled-in read-time design

PM-1 rules this in as a v1 mitigation (read-time-only availability,
`available`/`already_claimed`/`no_longer_in_pool`, computed on `GET /groups`,
never persisted) and explicitly defers **claim-time re-validation** to Slice
4 as WATCH-S3-A. That deferral is well-reasoned (Slice 3 has no claim action
to re-validate against) and is correctly tracked with a `Fires-on`/`Lands-in`
row. What is **not** fully closed by that design, even granting it entirely:

- **`approve` performs zero freshness check of its own.** Per technical-plan
  §7, `POST /groups/:id/approve` is a pure `review_status`+`reviewed_at`
  update via `setValueGroupReviewStatus` — it does not call
  `resolveMemberAvailability` and does not re-read the live pool. The
  read-time check exists **only** at `GET /groups` render time. If Sara
  loads the panel, leaves the tab open, and a member is claimed elsewhere
  (by a concurrent `ccam`/CLI action, or simply by time passing before she
  clicks), **Approve succeeds silently against a stale render** — no error,
  no re-fetch, no signal that the displayed membership might no longer be
  true. Because approve is explicitly bookkeeping-only (AC-5) this is not a
  data-corruption risk today, but it **is** a false-confidence risk that
  compounds: AC-5's own definition of "approve" is "Sara has looked at this
  and it's a reasonable candidate to act on later" — the PM's own PM-1
  reasoning (point 3) already names this exact failure mode as the reason
  drift-detection was pulled *into* scope rather than deferred entirely.
  Building the read-time check at `GET /groups` and stopping there answers
  "what does Sara see," but not "is what Sara acted on still true at the
  moment she acted." That gap is structural, not accidental — WATCH-S3-A's
  stated scope is Slice 4's *claim* route specifically, and does not
  mention Slice 3's own *approve* route at all.
- **Concretely, the recommended test for this round** (cheap, does not
  require building claim-time re-validation): assert that approving a group
  whose member(s) have, between the `GET /groups` render and the
  `POST /groups/:id/approve` call, transitioned to `already_claimed` or
  `no_longer_in_pool` (i) does not error, (ii) results in a well-defined
  `approved` row, and (iii) the response includes a **fresh**
  `member_availability_counts`/`members` snapshot (recomputed at approve
  time, not echoed from the request) so the client can at minimum render
  "you approved a group with N members no longer available" rather than
  silently displaying stale data as if it were still current. This is
  cheap because the read-time computation already exists and only needs a
  second call site; it does not require building claim-time transactional
  re-validation (that stays Slice 4's, correctly).
- **A second, smaller race worth naming**: `GET /groups` itself joins
  `value_group_members` (a single read), the live `assembleValuePool()`
  output (a second, independent read), and `listClaimsForProject` (a third).
  These are three separate reads within one request with no shared
  transaction/snapshot isolation. On a single-user local dashboard the
  practical likelihood of an interleaving that produces an internally
  inconsistent partition (e.g., a unit counted `available` in one read and
  simultaneously claimed via a concurrent request) is low, but the
  **partition assertion** (§3.4: every member lands in exactly one bucket,
  never zero, never two) should be tested against a fixture that
  deliberately captures pool/claims state mid-mutation, not only against a
  quiescent, fully-settled fixture — the exact "fixture's own
  synchronization narrows what a mutation can distinguish" lesson §9.4
  recorded from Slice 2's SF-8 fix.

---

## 5. Severity & priority

**Must-guard-before-build (cannot ship this slice without these, ranked):**

1. **"Proposals never actions" negative proof, all four sub-checks,
   red-proven.** A wrong single-unit suggestion is a small error; a wrong
   *group* auto-claim would misattribute several units' delivered value at
   once (PO's own framing). This is the highest-consequence failure mode in
   the entire slice and the plan already treats it as such.
2. **§9.8 run/batch/member state partitioning**, including the extended
   truth table from §4.1 above (not just the one mandated combination). A
   crashed run rendering a permanent spinner, or a `failed` batch silently
   read as `zero_members`, are exactly the class of defect this project has
   already shipped and diagnosed as user-misleading, twice, on siblings of
   this code.
3. **SF-4 T7 delete-and-replace, done in the correct order, with the
   red-proof performed and independently re-run** (§4.2). This is a
   regression-of-a-fix, on the file family's #1 recurring defect class, with
   a written trigger that has already fired once.
4. **§9.7 registration on both `assertSingleHome` axes + `CONSUMERS`, derived
   scope, fail-closed.** Proven exact same failure one slice ago; cheap to
   get right, expensive (found only by reviewer, twice) to get wrong.
5. **Digest/prompt field parity (`UNCOMPARED_FIELD_GUARANTORS` shape,
   `groupingFacts`→`computeGroupingDigest`)** — this exact defect shipped
   once already on this file family's `unitFacts`→`compareUnitInputs` pair,
   harmless only by accident. `groupingFacts` extending `unitFacts` inherits
   the same shape of risk one layer further out.

**Acceptable-with-a-test-this-round (real risk, correctly bounded by design,
needs one assertion but not new architecture):**

6. Mechanical pre-grouping guard and persistence guard vacuity risk (§4.3) —
   named and mitigated by the plan's required red-proofs; the risk is
   execution discipline, not missing design.
7. Approve-against-stale-render (§4.5) — bounded because approve is
   bookkeeping-only; needs the one cheap test named above, does not need
   claim-time transactional re-validation this round (that is correctly
   Slice 4's).
8. MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH and STRICTMODE-BLIND client tests —
   both explicitly required by the plan (§8, PM-5a/b) with concrete test
   shapes named; low implementation risk if followed as written.

**Lower priority / cosmetic-if-missed:**

9. CONTRACT-SPEC-DRIFT scope limit — the openapi mount↔path scan is blind to
   new routes under an already-documented mount (this exact shape already
   occurred once, on `POST /api/project-plans/altitudes/seen` in
   `altitude-invalidation`, and was declined there via DEC-19/QA-DEC-3). Not
   a runtime risk; a documentation-drift risk on a candidate pattern not yet
   promoted.

---

## 6. Disclosed-and-declined coverage — items needing a tracked artifact

Per this pass's own trip-wire obligation: the following are risks this round
may knowingly leave unguarded, and each needs a `decisions.md`
PENDING/WATCH row (with `Fires-on:`/`Lands-in:`, per this intake's own
established convention) rather than surviving only as a paragraph in this
file:

1. **Approve-against-stale-render (§4.5).** Not currently named anywhere in
   `decisions.md` — WATCH-S3-A covers Slice 4's *claim* route specifically
   and does not mention Slice 3's own *approve* route. If the team decides
   not to add the cheap fresh-snapshot-on-approve-response test this round,
   that decision needs its own WATCH row (suggested: **WATCH-S3-F**),
   distinct from WATCH-S3-A, naming the approve route explicitly as
   `Lands-in:`.
2. **The two extra §9.8 truth-table rows (§4.1)** — the complement case
   (complete coverage + prior failed + re-request → fresh attempt) and the
   `already_running`-vs-digest-match ordering test. If the build proceeds
   with only the one mandated combination, that is a disclosed gap and
   needs a row, not silent omission — this project's own catalog notes that
   "adopted by neither test architect, and its own stated fallback of 'then
   it becomes a WATCH row' also didn't happen" is a recorded failure mode on
   this exact family (§9.1's 2026-08-02 note); do not let this be the next
   instance of it.
3. **CONTRACT-SPEC-DRIFT scope limit for the 4 new group routes** — if the
   team declines an OpenAPI fragment for these routes (as Slice 1 did for
   `/altitudes/seen` via DEC-19/QA-DEC-3), that decision should be recorded
   the same way, not merely left implicit because the scan happens to stay
   green over the gap.
