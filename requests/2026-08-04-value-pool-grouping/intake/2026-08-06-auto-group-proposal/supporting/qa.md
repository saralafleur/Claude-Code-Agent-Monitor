/**
 * QA note — this is a documentation artifact (intake supporting doc), not a
 * source file under `.claude/skills/file-headers/` scope. No file header
 * required.
 */

# QA — Value Pool Slice 3 (Auto-group proposal engine)

**Role scope for this pass:** `intake-qa`, **FORCED ON** by defect-catalog
match (PROJECT-CONTEXT.md §9.3-family density 9/9/4 across the three prior
Value Pool builds on this exact file family — the densest recurring-defect
zone on record for this project). Per the run-plan
(`requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/run-plan.md`
§2.4), this document is a **MANDATORY guardrail checklist the build must
carry**, not a full test plan. The `team-qa` stage still runs on its own,
later, on the real diff — unlike Slice 2, QA is not deferred this time, so
this checklist is an input to that stage, not a substitute for it.

Test stack: `node --test server/__tests__/*.test.js` (`npm run test:server`),
single-spec: `node --test server/__tests__/<file>.test.js`. Client:
`cd client && npm test` (`npm run test:client`), includes
`client/src/pages/__tests__/screens.snapshot.test.tsx`.

---

## 1. §9.8 OVERLOADED-ABSENCE — new wire states this slice manufactures

Slice 3 mints at least three new discriminated-state surfaces. Each MUST be a
named, server-authored value — never a derived absence, never a client-side
heuristic reconstructed from "the key is missing."

### 1a. Grouping-run status (per project, per run)
At minimum four distinguishable outcomes, matching the shape
`ALTITUDE_STATES`/`DEMAND_STATES`/`ETA_STATES` already established in this
codebase (`server/lib/value-summary.js`, `server/lib/value-coverage.js`):

- `not-attempted` — no grouping run has ever executed for this project.
- `in-progress` — mechanical pre-grouping and/or the sonnet refinement call
  is currently running.
- `completed-zero-groups` — the run finished; every candidate unit was
  filtered out of every pre-group, or the LLM refinement legitimately
  returned no groups. **This is not the same value as `not-attempted`** —
  collapsing the two is the exact shape §9.8's live instance #1
  (`enrichPoolAltitudes`) shipped and had to be cured for.
- `failed` — the refinement call errored, timed out, or produced unparsable
  output. Must be distinguishable from `completed-zero-groups`: a user who
  sees "zero groups" needs to know whether that's a real finding or a
  degraded run worth retrying.

Export as a named `GROUP_RUN_STATES` (or equivalent) constant, mirroring
`ALTITUDE_STATES`'s export/forward/render pattern (`server/lib/value-summary.js`
→ `POST /api/project-plans/altitudes` → `PlanLedgerPanel`). Any bound placed
on this run (e.g. a timeout, a max pre-group count) must, per §9.8's
corollary, cite in its declaring comment the measured real distribution it
was sized against — the live pool is ~102 units today (per request-brief.md's
verification #5), 182 recorded historically (DEC-12); a bound comment that
cannot name a number should not ship.

### 1b. Per-group state (a single group's own lifecycle)
Distinct from the run status above — a `value_groups` row needs its own
discriminated state, at minimum: `proposed` (LLM-produced, unreviewed) →
`reviewed`/`dismissed`/`claimed` (human-approved into a plan item, or
rejected). A group with **no members resolved** (every member `unitKey`
turned out to be unclaimed/invalid at review time) must be a named state on
the row, not a row silently absent from whatever list the review UI reads —
this is the literal instance §9.8 was named against in the request brief.

### 1c. Grouping-blocked-on-coverage
"Grouping requested but blocked because altitude coverage isn't 100% yet"
must be a distinct, named response/state from both `not-attempted` and
`failed`. It is a **gate rejection**, not a run outcome — do not fold it into
the run-status enum in 1a; give it its own explicit signal (e.g. a 409/422
with a `reason: "coverage-incomplete"` body, or a `blocked` value alongside
`coverageSnapshot.complete` so the client can render "resume once coverage
finishes" rather than a generic error).

**Required assertion (build-time obligation, not optional):** a single test
exercises the **combination**, not four isolated branches — per §9.8's own
"test the combination, not the two branches separately" instruction (the
outage-vs-backlog conflation in the `value-summary-tick` build only
reproduced when a unit was *both* over-cap *and* the LLM path was down). Here
the combination to prove is: a project with incomplete coverage AND a prior
`failed` run AND a request to re-run — the response must show `blocked`
(coverage gate), not resurrect the stale `failed` state or silently attempt
the run anyway. Model this test as a DEC-11-style truth table (see
`intake/2026-08-04-value-summary-tick/decisions.md` DEC-11) covering all
state × gate combinations, not one test per state.

---

## 2. §9.1 DERIVED-DUAL-VIEW — single-home requirement for grouping data

If a group's summary sentence, member set, or any per-group coverage/rollup
figure is read by more than one path — an HTTP route AND, per the request
brief's own framing, `ccam`/MCP/a second client render surface — it must be
computed **once**, server-side, and every other reader must consume that
single function's output, never re-derive it. Precedent to reuse directly:
`server/lib/value-ledger.js`'s `CONSUMERS` registry pattern and
`server/__tests__/single-writer-guard.test.js`'s `assertSingleHome` helper
(`server/__tests__/helpers/single-home.js`).

**PARITY-WITHOUT-ANCHOR — the guard this slice must not repeat.** Per the
brief's own instruction and §9.3's 2026-08-05 note (`value-coverage-parity.test.js`
shipped as "the guard IS the vacuity": its `else` branch self-computed the
"broadcast" side by calling `coverageSnapshot()` from inside the test itself,
so "parity" degenerated to `f(X) deepEquals f(X)`), **a guard that compares
two derived views of group data to *each other* is not sufficient.** It must
be anchored against a concrete, independently-known expected shape — e.g.:

- Seed a known DB state (fixed pre-group inputs, a stubbed/fixture LLM
  response with a known set of group names + member `unitKey`s).
- Assert the route response's group list equals **that literal fixture**,
  field-by-field.
- Assert the second consumer's (CLI/MCP/second UI surface, whichever exists)
  output equals the **same literal fixture**, not "equals the route's
  response" alone. Two `deepEqual`s against the anchor, not one `deepEqual`
  between the two sides — mutating either production code path independently
  must be able to turn one assertion red without the other, which a
  mutual-agreement-only guard cannot do.

If the review/approval UI extension of `PlanLedgerPanel` and any second
render surface both show a group's summary sentence, this is the exact
"rogue re-derivation" sub-form §9.1 flags repeatedly (2026-08-02, 2026-08-03
practice-kind-override notes): a rogue-*reader* scan (grepping for raw
`value_groups.summary` reads) will not catch a second site that
re-implements the *rollup formula* (e.g. re-computing "how many members
resolved" client-side instead of reading a server-computed count). The guard
must be able to catch a re-derivation, not just a re-read.

---

## 3. §9.3 VACUOUS-GUARD — what a REAL guard looks like here

Two riskiest new surfaces named by the request, each needs a guard that can
actually go red under a real mutation:

### 3a. Mechanical pre-grouping heuristic (pre-LLM stage)
This stage is explicitly "free, deterministic, auditable" — which means it
is the one part of this engine that is fully unit-testable without an LLM
call, and there is no excuse for a vacuous guard here. Required: a fixture
with a **known correct grouping output** for a given input (a fixed set of
commits with initiative-slug references, a fixed set of time-adjacency
clusters, a fixed set of shared-surface overlaps) and an assertion on the
**actual computed pre-group membership**, not on "a non-empty array was
returned" or `Array.isArray(result)`. Red-prove by mutation: break one
heuristic (e.g. disable the slug-match branch, or `if (false)` the
time-adjacency window check) and confirm the specific pre-group the mutation
should have produced is now missing/wrong — restore, confirm byte-identical,
re-run green. Record the observation per §9.3's standing rule (a red proof
that is only reported and not independently re-run does not count — see
AGENT-SELF-REPORTED-RED, §9.3 2026-08-03 note).

### 3b. `value_groups` persisted proposal data
A guard that only checks the table/row/columns exist
(`assert.ok(stmts.insertValueGroup)`) is the exact existence-only shape §9.3
names as vacuous by default. Required instead: seed a real LLM-refinement
output (or a stubbed model response with a known shape), persist it, then
assert the **persisted row content** — member `unitKey`s, name, rationale,
summary sentence — matches the input exactly, and that re-reading the row
after a partial/failed run does not silently promote it to `proposed`
(guards §9.8's "exactly one bucket" requirement at the persistence layer,
not just at the computation layer — this is where the `value-summary-tick`
build's #1 finding lived: a never-zero failure one layer *above* the states
being discriminated). Red-prove by mutating the write path (e.g. drop the
`rationale` field before insert) and confirming the read-back assertion
catches it.

**Sweep before declaring any guard done (mandatory, cheap):**
`grep -rn "assert.ok(true" server/__tests__/` and
`grep -rn "|| true" server/__tests__/` must both return 0 for any new/edited
spec touching this surface. Also grep new spec files for `typeof `,
`Array.isArray`, bare `assert.ok(` with no compared value, and empty `=> {}`
bodies — the two sweeps above do not catch any of these four (§9.3's
2026-08-03 note).

**Adversarial review pass — budget it, do not skip it.** Per the brief's own
instruction and the 9/9/4 density on this file family: schedule an
adversarial review pass independent of the build/verify passes, as both of
the two prior Value Pool builds did. Both prior builds' final blockers were
found by the reviewer *after* a correctly-executed verifier mutation pass had
already certified the same guard green (§9.3 2026-08-05 note: "the reviewer
caught two blockers the verifier's own correct mutation pass had certified
green"). Do not trim the reviewer under any speed mode on this surface.

---

## 4. §9.7 registry / CONSUMERS hygiene

- **`assembleValuePool` CONSUMERS registry** (`server/lib/value-ledger.js`,
  line 70) currently lists three consumers (`server/routes/project-plans.js`,
  `bin/ccam.js (cmdLedger)`, `server/lib/value-summary-tick.js`). The new
  grouping engine (`server/lib/value-groups.js` or equivalent) becomes a
  **fourth** consumer — add it to `CONSUMERS` in the same commit that adds
  the `require`, never as a follow-up.
- **`single-writer-guard.test.js`'s `assertSingleHome` consumer maps** must
  be updated for every module this slice touches, on **both** axes §9.7
  flags as historically hand-typed and stale-prone: the export axis (any new
  export `value-groups.js` adds) and the consumer axis (every new importer).
  Precedent occurrence to avoid repeating: SF-5 (2026-08-05) — a build added
  a real third consumer of `value-summary.js` in the same commit that edited
  that module's `assertSingleHome` map, and still didn't register itself.
  Being inside the map while editing it is not sufficient; enumerate
  importers by grep (`grep -rn "require(.*value-groups" server/lib
  server/routes bin/`), not by memory.
- **New `value_groups` single-writer guard (WATCH-6 pattern).** If the
  grouping engine is confirmed (per the architect's ruling, open question #6)
  to write *only* to `value_groups` and never to `value_unit_summaries`, the
  existing `value_unit_summaries` single-writer guard does not need
  widening — but `value_groups` itself is a **new table with its own
  single-writer surface** and needs its own `assertSingleHome`-style guard
  from day one (mirroring the existing `upsertValueUnitSummary` two-call-site
  guard), not a guard added retroactively once a second writer appears. If
  the architect instead rules that grouping *does* need to write back to
  `value_unit_summaries`, the existing guard's consumer map must widen in the
  **same change**, per WATCH-6 — never silently gain a second call site
  (§9.1's write-sequence form, the exact shape the 2026-08-01
  `build-project-manager` build was burned by).
- **SF-4 (if extraction lands in this slice).** If `buildProbeCoverage` is
  extracted per the technical plan's disposition, add a route↔route parity
  guard replacing the two independent hand-copies in
  `server/routes/project-plans.js` (`POST /coverage-request`, `GET
  /coverage`) — anchor it the same way as §2 above (against a known fixture,
  not just route-vs-route mutual agreement), since this is precisely the
  shape that produced the vacuous `value-coverage-parity.test.js` the first
  time. If extraction is explicitly deferred instead, this checklist does not
  block on it, but the deferral must be a dated `decisions.md` row, not a
  silent skip (§9.4).

---

## 5. Acceptance verification — "groups are proposals, never actions"

The concrete, checkable negative-proof shape: **assert that no code path in
the grouping module (or any route it exposes) writes to whatever table/API
represents a claimed plan item.** This cannot be proven by reading the happy
path (a green "approve a group" test does not prove a *different*,
un-reviewed code path can't also claim). Required shape:

1. **A structural scan**, in the `chronology-ordering.test.js` /
   `single-writer-guard.test.js` style, asserting `server/lib/value-groups.js`
   (and any new grouping route file) contains **zero** call sites of
   whatever writer(s) currently create a claimed plan item / detour
   disposition claim (grep the real writer function name(s) — e.g. any
   `applyDisposition`/plan-claim-insert equivalent — do not hand-guess the
   name; enumerate from the real write surface the way `assertSingleHome`
   enumerates real exports).
2. **A behavioral negative test**: run a full grouping pass end-to-end
   (mechanical pre-group → stubbed LLM refinement → persist to
   `value_groups`) against a seeded DB, then assert the plan-claims table (or
   equivalent) row count is **unchanged** before/after — not merely that the
   response body looks like a proposal. This is the check that would catch a
   route that both persists the proposal *and* accidentally auto-claims,
   which the structural scan alone cannot see if the write is buried in a
   shared helper the scan doesn't know to flag.
3. **Red-prove both.** For (1), inject a rogue call to the plan-claim writer
   inside `value-groups.js` and confirm the structural scan fails, then
   revert. For (2), have the grouping engine's persistence step also insert a
   claim row (temporarily) and confirm the row-count assertion fails, then
   revert. Per §9.3, an unproven negative assertion is exactly as vacuous as
   a positive one — "we didn't find a write" is not evidence unless the test
   is shown capable of finding one.
4. Extend this same negative-proof pattern to the **approve** action itself
   once it exists: approving a group should produce a single, explicit,
   auditable write (whatever the technical plan names as the "claim" action)
   — and the *proposal* creation step (mechanical pre-group + LLM refinement)
   must remain provably incapable of reaching that write path on its own,
   even under a malformed/adversarial LLM response (e.g. an LLM output that
   somehow includes a `status: "claimed"` field must not be trusted verbatim
   — the persistence layer should whitelist/ignore any LLM-supplied
   lifecycle field and set `proposed` unconditionally on insert).

---

## Regression coverage — what already exists on this surface

Existing specs directly adjacent (all currently green on `master`, confirmed
by directory listing, `server/__tests__/`):

- `value-ledger.test.js`, `ledger-metrics-parity.test.js` — `assembleValuePool`
  / `CONSUMERS` composer behavior. Extend, don't fork, when `value-groups.js`
  becomes a fourth consumer.
- `value-summary.test.js`, `value-summary-tick.test.js`,
  `value-summary-legacy-boot.test.js`, `value-summary-interrupted-boot.test.js`
  — the per-unit synthesis / `ALTITUDE_STATES` precedent this slice's
  `GROUP_RUN_STATES` should mirror the shape of, and the `summaryModel(stage)`
  cascade Slice 3 consumes (`"grouping"` stage, already built, DEC-10-closed —
  do not re-test model selection itself).
- `value-coverage.test.js`, `value-coverage-parity.test.js` — the
  `coverageSnapshot.complete` gate Slice 3 reads; `value-coverage-parity.test.js`
  is the one this slice's own guard-writing must not repeat the shape of
  (§3 above).
- `single-writer-guard.test.js` — the `assertSingleHome` consumer maps this
  slice must extend (§4 above).
- No existing spec file covers `value_groups`, grouping routes, or any
  grouping engine — this is genuinely new coverage, not a gap in existing
  coverage (confirmed: `grep -rn "value_groups\|value-groups" server/__tests__/`
  returns nothing today).

---

## Definition of Done — build-time guardrail checklist

- [ ] `GROUP_RUN_STATES` (or equivalent name) exported with exactly the four
      states in §1a; `not-attempted` vs. `completed-zero-groups` vs. `failed`
      each independently reachable and independently tested (not just
      declared).
- [ ] Per-group lifecycle state (§1b) present on every `value_groups` row;
      zero-member-resolved is a named state, not a missing row.
- [ ] Coverage-blocked response (§1c) is a distinct signal from both
      `not-attempted` and `failed`; combination test (blocked + prior-failed +
      re-request) exists and passes.
- [ ] Any new bound (timeout, max pre-groups, max prompt size) cites a
      measured number in its declaring comment (§9.8 corollary).
- [ ] Single-home cross-consumer parity guard for group data exists, is
      anchored to a literal fixture (not mutual route-vs-route agreement
      only), and is red-proven from **both** sides independently (§2).
- [ ] Mechanical pre-grouping guard asserts actual computed membership
      against a known fixture and is red-proven by disabling one heuristic
      (§3a).
- [ ] `value_groups` persistence guard asserts actual row content (not
      existence) and is red-proven by mutating the write path (§3b).
- [ ] `assert.ok(true` / `|| true` sweep across all new/edited specs = 0.
- [ ] Adversarial review pass scheduled independent of build/verify, before
      merge.
- [ ] `CONSUMERS` (`value-ledger.js`) includes the grouping engine;
      `assertSingleHome` maps updated on both export and consumer axes for
      every touched module.
- [ ] WATCH-6 ruling recorded: `value_groups` gets its own single-writer
      guard from day one; `value_unit_summaries` guard widens only if the
      architect confirms a real write-back need, and if so, in the same
      change.
- [ ] SF-4 disposition (extract `buildProbeCoverage` now, with an anchored
      parity guard, vs. dated `decisions.md` deferral) is explicit, not
      silent.
- [ ] Negative proof exists (structural scan + behavioral row-count check,
      both red-proven) that grouping proposal creation cannot write a
      claimed plan item, including under an adversarial/malformed LLM
      response.
- [ ] `npm run test:server` green; new spec file(s) individually re-runnable
      via `node --test server/__tests__/<file>.test.js`.
