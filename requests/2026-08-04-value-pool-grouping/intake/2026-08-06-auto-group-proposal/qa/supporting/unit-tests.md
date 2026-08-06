# Unit / Parity Test Design — Value Pool Slice 3 (Auto-group proposal engine)

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/`
**Role:** `qa-unit-architect` (forward mode — nothing built yet; this drives
test-first implementation).
**Grounded against (read live, 2026-08-06):** `technical-plan.md`,
`pm-plan.md`, `decisions.md`, `qa/change-brief.md`, plus the actual repo
conventions this build must match: `server/__tests__/single-writer-guard.test.js`,
`server/__tests__/project-plans-api.test.js` (T3/T4/T6/T7),
`server/__tests__/chronology-ordering.test.js`, `server/__tests__/db-migration.test.js`,
`server/__tests__/ledger-metrics-parity.test.js`, `server/__tests__/value-summary.test.js`
(`UNCOMPARED_FIELD_GUARANTORS` shape), `server/__tests__/helpers/single-home.js`,
`server/lib/value-ledger.js`, `server/lib/value-summary.js`,
`client/src/components/__tests__/PlanLedgerPanel.test.tsx` (SF-8 entity-switch
and BL-2 StrictMode precedents at lines 1304/1391/1034).

This document names exact spec files and exact test-case descriptions/
assertions for the implementer to write test-first. It does not write product
or test code.

---

## 0. Files touched by this test-design pass

New:
- `server/__tests__/value-groups-mechanical.test.js`
- `server/__tests__/value-groups-refinement.test.js`
- `server/__tests__/value-groups-api.test.js`
- `server/__tests__/value-coverage-probe.test.js`
- `client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx`

Edited (all mandatory in the **same commit** as the code they guard — this is
the exact §9.7 failure mode this file family has hit 7 times):
- `server/__tests__/project-plans-api.test.js` — delete T7 in full.
- `server/__tests__/single-writer-guard.test.js` — new `buildProbeCoverage`
  guard, new writer guards for the 3 new tables, `assertSingleHome`
  additions on 4 axes.
- `server/__tests__/chronology-ordering.test.js` — `filesToScan` picks up
  `value-groups.js` / `value-coverage-probe.js` automatically (it is
  `readdirSync`-derived) but `FILE_DISPOSITIONS` must gain explicit entries
  for both new files or the derived-scope fail-closed check itself fails.
- `server/__tests__/db-migration.test.js` — confirm-only assertions (no new
  `UPGRADE_CASES`/`REBUILD_CASES` rows) plus the `value_source` CHECK ==
  `VALUE_SOURCES` registry-parity test.
- **`server/__tests__/ledger-metrics-parity.test.js` — a gap the technical
  plan's own change-set table does not list.** `CONSUMERS` growing a 4th
  entry (`O-8`/`DEC-S3-10`) makes test **C2.4** (line 282, `assert.deepEqual`
  against the literal 3-entry sorted array) go red by construction the moment
  `server/lib/value-ledger.js:70-74` gains the new string. This is exactly
  the "declaring the registry is not evidence, and a registration edited
  without also updating the anchor it must satisfy is nobody's file" failure
  mode §9.7 already has 7 recorded instances of. **Flag this to the build
  step explicitly** — it is not in `technical-plan.md`'s "Edited — tests"
  table (§9) and would otherwise ship red or get "fixed" ad hoc without a
  named test-case description.

---

## 1. Mechanical pre-grouping — `mechanicalPreGroup` (AC-1)

**Spec file:** `server/__tests__/value-groups-mechanical.test.js`
**Closes:** AC-1; §9.3 VACUOUS-GUARD (fixture-anchored membership, not
existence-only); WATCH-S3-B/C's own declaring-comment obligations get their
proof here.

Fixture pool (reuse the real unit shape verified live at
`value-ledger.js:219-262` — `intake_initiative`/`merge_commit`/`trunk_commit`
units with `unitKey`, `value_source`, `value_ref`, `label`, `seen_at`), built
once in a `makePoolUnit(overrides)` helper at the top of the file, mirroring
`makeUnit()` conventions already used in `PlanLedgerPanel.test.tsx` and
`value-summary.test.js`.

Test cases:

1. **`slug signal clusters an initiative and a commit that references its slug, and excludes an unrelated commit`** — fixture: one `intake_initiative` unit with `value_ref="2026-08-06-auto-group-proposal"`, one `trunk_commit` unit whose `label` contains `effort/2026-08-06-auto-group-proposal`, one unrelated `trunk_commit` unit. Assert: exactly one cluster with `signal: "slug"` whose `memberUnitKeys` (sorted) equals `[initiativeUnitKey, matchingCommitUnitKey].sort()` — **not** `Array.isArray(clusters)` or `clusters.length > 0`. The unrelated commit's key must **not** appear in that cluster's `memberUnitKeys`.
2. **`time-adjacency clusters units sharing a local calendar day via localDayLabel, and separates units on different local days`** — fixture: two units with `seen_at` timestamps producing the same `localDayLabel()` (imported and asserted against directly, not hand-recomputed — reuse `focus-summary.js`'s export per the plan's own "no second duration constant" instruction) and one unit one day apart. Assert the same-day pair's keys are exactly the `signal: "time"` cluster's membership; the day-apart unit is **absent** from that cluster.
3. **`units with no seen_at (intake_initiative, merge_commit) are ineligible for the time signal and are counted, never silently skipped`** — fixture with an `intake_initiative` unit (no `seen_at`). Assert it does not appear in any `signal: "time"` cluster, and `signalAudit.time.units_without_timestamp` equals the exact count of timestamp-less units in the fixture (not merely `> 0`).
4. **`shared-surface signal clusters commits on a label/path substring proxy (WATCH-S3-B v1 scope), not commit-diff analysis`** — two `trunk_commit` units whose labels share a distinctive path/token substring, one unrelated commit. Assert exact membership as in case 1.
5. **`over-generation is by design: a unit eligible for two signals appears in both clusters, never deduped away`** — one unit crafted to satisfy both the slug and time signals. Assert its `unitKey` is present in both the returned `signal:"slug"` cluster's `memberUnitKeys` **and** the `signal:"time"` cluster's `memberUnitKeys`.
6. **`deterministic: running mechanicalPreGroup twice on the same pool (including a shuffled input order) produces identical clusterIds and membership`** — call twice, second call with the units array reordered. `assert.deepEqual` on the full sorted-by-`clusterId` output of both calls (AC-1's "same pool, same clusters").
7. **`clusterId is a stable hash of signal + sorted memberUnitKeys, not insertion order`** — same fixture as case 6, assert the `clusterId` string itself is byte-identical across the two calls (not just membership).
8. **`mechanicalPreGroup takes no dbModule and performs zero awaits — the spec above needs no spawn/db mock`** — assert the function's own arity/signature accepts only `(units)` (no second argument consumed for db or process access); no `vi.mock`/spawn stub is present anywhere in this spec file (documented as a file-level invariant, checked by a reviewer, not a runtime assertion — note this explicitly in the spec's top comment so a future edit that quietly adds a `dbModule` param is a visible diff).
9. **`a unit matching no signal is reported in ungrouped with reason "no_shared_signal", never dropped from the output entirely`** — fixture with one fully isolated unit (no slug/time/surface match to anything else). Assert: (a) it appears in `ungrouped` with `reason: "no_shared_signal"`; (b) **every** unit key from the input pool appears in at least one cluster's `memberUnitKeys` **or** in `ungrouped` — a completeness/no-silent-drop assertion over the whole fixture, not per-branch.

**Red-first note:** cases 1–5 and 9 are red-proven, per the technical plan's
own implementation step 4, by **disabling one heuristic branch** (e.g.
temporarily short-circuiting the slug matcher to return no matches) and
confirming the *specific named* expected cluster/membership goes missing —
not that "an assertion fails somewhere." Before the change exists at all,
every case in this file fails because `mechanicalPreGroup` does not exist;
after the fix, case 1–5/9 fail if the matching heuristic is missing or wrong,
and pass only when membership is byte-correct — this is what makes the guard
non-vacuous (§9.3).

---

## 2. SF-4 extraction — `buildProbeCoverage` + T7 replacement (AC-6, DEC-S3-2..4)

### 2a. New composition behavior

**Spec file:** `server/__tests__/value-coverage-probe.test.js`
**Closes:** SF-4 (the §9.1 DERIVED-DUAL-VIEW cure applied to a defect that
already shipped); AC-6.

Test cases:

1. **`buildProbeCoverage composes assembleValuePool + enrichPoolAltitudes(probe:true) + coverageSnapshot and returns the full reviewed contract`** — seed a project with a small mixed-source pool, call `buildProbeCoverage(dbModule, projectId)`. Assert `Object.keys(result).sort()` equals the literal reviewed set already anchored by T6: `["complete","computed_at","demand","described","eta","pending","pool_size","project_id","requested_at"]`. Reuse T6's own anchor array — do not invent a second one (§9.1 rule 2).
2. **`opts.requestedAt, when provided, is used verbatim and never re-read from getValueSweepState`** — call with `{ requestedAt: "2026-08-06T00:00:00.000Z" }` against a project whose `getValueSweepState` row has a *different* `coverage_requested_at`. Assert `result.requested_at === "2026-08-06T00:00:00.000Z"` — proves the POST-path divergence is preserved on purpose (DEC-S3-2's "do not erase the fixed bug" instruction), not accidentally erased by the extraction.
3. **`opts.requestedAt, when omitted, falls back to dbModule.stmts.getValueSweepState.get(projectId).coverage_requested_at`** — call with no `opts`; assert `result.requested_at` equals the seeded sweep-state row's value exactly (GET-path behavior).
4. **`no sweep-state row exists yet: requestedAt resolves to null, never undefined and never a thrown error`** — a project with zero prior coverage requests. Assert `result.requested_at === null` strictly (`===`, not `== null`) — an OVERLOADED-ABSENCE guard: `undefined` (silently coerced by JSON) and `null` are not interchangeable on the wire.
5. **`counts come from enrichPoolAltitudes(..., {probe:true}) exactly — no re-derivation inside buildProbeCoverage`** — seed a pool with a known mix of described/pending/demand units; assert `result.pool_size`/`result.described`/`result.pending` equal a value independently computed from `enrichPoolAltitudes`'s own return in the same test (anchored against a literal fixture-derived number, not merely "matches whatever the function returns" — that would be `deepEqual(f(x), f(x))` vacuity, PARITY-WITHOUT-ANCHOR, exactly what this file family must not repeat per the change-brief's own flag).
6. **`draining reflects isDrainingProject(projectId)`** — one project mid-drain, one not; assert `result.draining` matches for each.

### 2b. T7 deletion and its replacement guard

**Spec files:**
- `server/__tests__/project-plans-api.test.js` — **delete the entire `"T7 (SF-4): ..."` test** (currently the whole block starting at line 905 through its final `assert.deepEqual` at ~998). Do **not** edit it to reference the new file — delete and replace, per DEC-S3-3/WATCH-S3-D, in the same commit as the extraction. **Keep T3, T4, and T6 untouched** — none of them source-scan the handler bodies, so none of them are affected by the extraction, and T6 (`"T6 (G2 smoke): GET /coverage's response shape matches the coverageSnapshot contract exactly"`, lines 886–902) is the test that already carries the anchored response-key-set value forward; it needs no edit.

  **Cross-document note for the implementer:** `qa/change-brief.md`'s own
  changed-files table says "the anchored response-key-set assertion at lines
  988-998 survives unmodified," which literally names lines *inside* T7
  itself (its internal `deepEqual(postKeys, getKeys)` / `deepEqual(postKeys,
  ["computedAt","counts","draining","projectId","requestedAt"])` pair, built
  by regex-scanning `postBody`/`getBody` — i.e. the **route handlers'
  literal source text**). That specific mechanism cannot survive: after
  extraction, the handler bodies no longer contain
  `const snapshot = coverageSnapshot(dbModule, {...})` at all (it moves into
  `value-coverage-probe.js`), so `extractCoverageSnapshotKeys(postBody)`
  degenerates to `[]` and every one of T7's assertions — including its final
  anchor — goes red. `technical-plan.md` §6.1 is the more precise and later
  document here: it names T6 (lines 890–902, the HTTP-response-body
  assertion, unaffected by the extraction) as the survivor, and states T7 is
  replaced by a **new** guard living in `single-writer-guard.test.js` (2b
  below) that reuses the **same literal anchor array** — `["computedAt",
  "counts", "draining", "projectId", "requestedAt"]` — but checks it against
  `buildProbeCoverage`'s actual composed output rather than by regexing
  route-handler source text. **Follow `technical-plan.md`; flag this
  discrepancy in code review so it isn't silently "resolved" by leaving a
  half-broken T7 in place.**

- `server/__tests__/single-writer-guard.test.js` — new test cases, same
  section, same shape as the existing `requestValueCoverage` guard (lines
  346–385) and the `assertSingleHome` calls that follow it:

  1. **`buildProbeCoverage is defined exactly once, in server/lib/value-coverage-probe.js`** — `scanFiles(serverDir, /buildProbeCoverage/)`, assert the basenames (excluding `.test.js`) are exactly `["value-coverage-probe.js", "project-plans.js"]` (definition + the one file importing/calling it — `db.js` is not expected to appear, unlike `requestValueCoverage`, since `buildProbeCoverage` is not itself a prepared statement).
  2. **`buildProbeCoverage's call-site set is exactly three, one lexical call per handler body`** — brace-walk (reuse `stripComments` + the existing brace-depth walker helper already in this file) the `POST /coverage-request`, `GET /coverage`, and `POST /groups/propose` handler bodies in `project-plans.js`; assert `buildProbeCoverage(` appears **exactly once** inside each of the three bodies, and that the **total** count across the whole file is exactly 3 (guards against a 4th call site hiding outside any of the three named handlers).
  3. **`buildProbeCoverage's importer scope is derived (not hand-typed) and fails closed on any undisposed importer`** — `grep`-equivalent scan (via `scanFiles`) of `server/lib`, `server/routes`, `bin/` for `require(...value-coverage-probe...)`; assert every matched file has an explicit entry in a small in-test disposition map (`{ "value-coverage-probe.js": "definition", "project-plans.js": "three call sites" }`); assert the test itself throws/fails (not `continue`s silently) if a file appears in the derived scan with no disposition — mirrors `chronology-ordering.test.js`'s `FILE_DISPOSITIONS` fail-closed shape exactly (§9.7's "a derived scope whose miss branch `continue`s is a hand-typed scan in derived clothing").
  4. **`assertSingleHome("../lib/value-coverage-probe", { "../routes/project-plans": { shared: ["buildProbeCoverage"], absent: [] } })`** — every export of the new module gets an explicit disposition at its one real consumer.
  5. **Do NOT add** a `deepEqual(postCoverageResult, getCoverageResult)` route↔route parity assertion anywhere in this file or `project-plans-api.test.js` — call this out as a negative instruction in the spec's own top-of-block comment (DEC-S3-4), citing that both sides now call one function and such a comparison would be `deepEqual(f(X), f(X))`, the exact vacuity `value-coverage-parity.test.js` shipped in Slice 2.
  6. **`server/__tests__/value-coverage-parity.test.js` (G2, route↔tick) passes unmodified** — no assertion needed here beyond "do not touch this file"; call it out explicitly in the DoD checklist (§15's own item) so nobody "fixes" it sympathetically during the extraction.

**Red-first note:** case 2 is red-proven by **performing** the plan's own
prescribed injection — add a fourth hand-copy of the 4-step composition
(`assembleValuePool` + `enrichPoolAltitudes(..., {probe:true})` +
`coverageSnapshot(...)`) inline into a route handler that should be calling
`buildProbeCoverage` instead, confirm case 2's call-site-count assertion
fails, then revert byte-identical. Per §9.3 AGENT-SELF-REPORTED-RED, this
must be **performed and independently re-run by someone other than its
author**, not merely narrated as done in a summary.

---

## 3. Three-table schema + guarded-migration mechanics (§9.5/§9.6, DEC-S3-1/11)

**Spec file:** `server/__tests__/db-migration.test.js` (new `describe` block,
sibling to the existing `Migration: value_unit_summaries input-snapshot
columns` and `Table-rebuild registry meta-test` blocks).

Because all three tables are plain `CREATE TABLE IF NOT EXISTS` with zero
`ALTER TABLE`, the two **existing derived meta-tests already in this file**
(the `ALTER TABLE … ADD COLUMN` scanner at line 1741 and the
`RENAME TO`/`_new` rebuild scanner at line 1701) will simply continue to pass
with no new `UPGRADE_CASES`/`REBUILD_CASES` rows — that is the correct
outcome, but "the existing test doesn't fail" is not itself a designed
assertion pinning this slice's schema shape. Add:

1. **`value_group_runs / value_groups / value_group_members exist after boot, with exactly the columns and indices technical-plan.md §4 specifies`** — open a fresh (or freshly-migrated) DB, `PRAGMA table_info(value_group_runs)` etc., assert the column name **and** type list matches the schema literally (catches an accidental column drop/rename at the point of introduction, not just at a later ALTER).
2. **`value_group_runs.state / value_groups.refinement_state / value_groups.review_status / value_group_members.value_source CHECK lists match the registries/constants they are meant to mirror`** — read the CHECK constraint text via `sqlite_master.sql` (or the equivalent existing helper this file already uses for CHECK introspection elsewhere) for each of the four columns; assert (a) `value_group_runs.state`'s CHECK list equals `GROUP_RUN_ROW_STATES` (the 4-value persisted set, not the 5-value wire set — `not_attempted` must **not** appear in the CHECK, since a row with that state can never legally exist); (b) `value_groups.refinement_state`'s CHECK equals `GROUP_REFINEMENT_STATES`; (c) `value_groups.review_status`'s CHECK equals `GROUP_REVIEW_STATES` (including the reserved `'claimed'`); (d) `value_group_members.value_source`'s CHECK equals `valueLedger.VALUE_SOURCES` **exactly** — this is the schema-level obligation §4 names explicitly ("validate against the registry, never a typed literal," reusing `value_claims`'s own precedent). Each of these four is its own registry-derived assertion, not a hand-typed literal array re-copied from the schema — read the registry, not the SQL string, as the expected side.
3. **`this slice adds no UPGRADE_CASES or REBUILD_CASES entry — asserted, not merely unbroken`** — after the schema lands, assert `["value_group_runs","value_groups","value_group_members"].every(t => !REBUILD_CASES[t])` and that none of `UPGRADE_CASES` has `table` equal to any of the three new table names. This is a slice-specific pin: if a later change widens the `review_status` CHECK (e.g. Slice 4 activating `claimed`) via a hand-rolled `ALTER`/rename instead of `rebuildTableAtomically` + a `REBUILD_CASES` entry, the *existing* derived meta-tests already catch it generically — this assertion exists so Slice 3's own DoD line ("§9.6 — new tables need none") has a literal, re-runnable check rather than resting on "nothing failed."
4. **`value_groups carries no project_id, no parent_group_id, no reviewed_by columns; value_group_members carries no availability column`** (DEC-S3-1/11) — `PRAGMA table_info` column-name list assertion, the direct executable form of the DoD's "dropped columns" line — this is the one place a reviewer re-adding one of these "for convenience" gets caught mechanically instead of by memory.

**Red-first note:** case 2's four CHECK-vs-registry assertions are the ones
most likely to silently drift later (someone adds a wire value to
`GROUP_REFINEMENT_STATES` without widening the CHECK, or vice versa); they
are red-proven by locally adding a 5th value to one registry (not the CHECK)
and confirming the specific named assertion — not a generic "schema test
failed" — points at the mismatched pair.

---

## 4. §9.8 named wire states + the mandated combination test

Three orthogonal axes, tested at three different layers of the stack because
they become observable at different points: run state at the route/response
layer, refinement state at the persistence layer, review state at the
route+negative-proof layer (§6 below), member availability at the pure-
function layer.

### 4a. Run state — `GROUP_RUN_STATES` / `GROUP_RUN_ROW_STATES`

**Spec file:** `server/__tests__/value-groups-api.test.js` (route-level;
`in_progress` in particular is only observable while a spawn is pending, so
this needs the same deferred-promise stub pattern already used for
`runClaudePromptJson` elsewhere in this codebase, and mirrors the deferred-
promise shape `PlanLedgerPanel.test.tsx`'s SF-8 in-flight test uses
client-side).

Also add, once, in `server/lib/value-groups.js`'s own small registry test
(can live at the top of `value-groups-mechanical.test.js` since it needs no
DB/spawn):

- **`GROUP_RUN_STATES minus GROUP_RUN_ROW_STATES is exactly ["not_attempted"] — the anchored exemption-set assertion (PM-5c shape)`** — `assert.deepEqual(GROUP_RUN_STATES.filter(s => !GROUP_RUN_ROW_STATES.includes(s)), ["not_attempted"])`. Red-proven by locally adding a 6th value to `GROUP_RUN_STATES` without adding it to `GROUP_RUN_ROW_STATES` (or vice versa) and confirming the assertion breaks at the point of growth.

Route-level, per-state, **independently reachable and independently
asserted** (declaring the registry is not evidence — technical-plan §11.1):

1. **`not_attempted: GET /groups for a project with no run row ever created returns run.state === "not_attempted"`** — no group rows, `groups: []`, and the response still carries `gate`/`coverage` per §3.6's "kept OUT of the run enum" rule.
2. **`in_progress: GET /groups called while the batch's spawn is still pending reflects run.state === "in_progress" with zero visible group rows`** — stub `runClaudePromptJson` with a controllable never-yet-resolved promise; `POST /groups/propose` (asserts `202`/`outcome: "started"`), then `GET /groups` **before** resolving the stub; assert `run.state === "in_progress"`.
3. **`completed: after the batch resolves with >=1 group, GET /groups reflects run.state === "completed" and group_count matches the persisted row count exactly`** — resolve the stub from case 2, `GET /groups` again, assert state transition and `group_count === groups.length` (anchored, not just `> 0`).
4. **`completed_zero_groups: a pool with no clusterable units still writes a run row with state "completed_zero_groups" — never the same value as not_attempted`** — fixture pool where every unit is isolated (mirrors mechanical-stage case 9). Assert `run.state === "completed_zero_groups"` **and**, in the same test, that a **direct row-count query** against `value_group_runs` for this project returns exactly 1 row — the literal proof that this state is *not* the same as "no row exists" (case 1's own byte-identical-`SELECT`-result risk named in `pm-plan.md` PM-3).
5. **`failed: a batch whose spawn throws/times out before producing any group row yields run.state === "failed" with a non-null error_reason`** — stub `runClaudePromptJson` to reject; assert `run.state === "failed"` and `run.error_reason` is a non-empty string naming the failure.

6. **MANDATORY combination test — `incomplete coverage AND a prior failed run AND a re-request together respond blocked_coverage_incomplete, never resurrecting failed and never silently re-attempting`** — modeled as **one** test driving a small truth table (DEC-11 shape, per technical-plan §11.1's explicit instruction not to write four isolated branches), e.g.:

   | # | prior run state | coverage.complete | expected `outcome` | expected HTTP | spawn called? |
   |---|---|---|---|---|---|
   | a | none | `true` | `started` | 202 | yes |
   | b | none | `false` | `blocked_coverage_incomplete` | 409 | no |
   | c | `failed` | `true` | `started` (fresh attempt, not a reuse of the failed run) | 202 | yes |
   | **d** | `failed` | `false` | **`blocked_coverage_incomplete`** | **409** | **no** |
   | e | `completed` (digest match) | `true` | `reused_unchanged` | 200 | no |
   | f | `in_progress` | `true` | `already_running` | 200 | no |

   Row **d** is the one PM-3/§9.8 name as mandatory. For each row: assert the
   response `outcome` and status code, and — the assertion that actually
   proves the gate is non-negotiable and not merely "checked first by
   convention" — assert the spawn stub's call count is exactly `0` for rows
   b/d/e/f and exactly `1` for rows a/c. Row d additionally asserts
   `GET /groups`'s `run.state` for that project is still `"failed"` (the
   *historical* run truthfully did fail) while the **`gate`** field and the
   409 body's `outcome` are `"blocked_coverage_incomplete"` — two different,
   both-true facts that must never collapse into one field (§3.6's own rule).

**Second-combination candidate for cross-check against `qa-risk-analyst`'s
parallel pass:** this document also flags, but does not itself mandate as a
second full combination test, the row **`already_running` + `coverage` flips
to incomplete mid-flight** (a drain completes and coverage regresses between
`propose` and a concurrent `GET /groups` poll) — `already_running`'s
response is defined as "no gate re-check" (§3.5), so a coverage regression
during an in-flight run should **not** retroactively 409 the poll. If
`qa-risk-analyst` independently flags this path, add it as row **g** to the
same table; if not, this is recorded here as a considered-and-deferred
candidate, not a silent gap.

### 4b. Per-group refinement state — `GROUP_REFINEMENT_STATES`

**Spec file:** `server/__tests__/value-groups-refinement.test.js`

- **`the anchored exemption-set assertion for GROUP_REFINEMENT_STATES`** — `assert.deepEqual(GROUP_REFINEMENT_STATES, ["pending","refined","zero_members","failed"])` (exact list, exact order not required but exact membership is — use `.slice().sort()` on both sides per this file family's existing convention).
- **`pending: a persisted mechanical cluster before refinement is attempted has refinement_state === "pending" and name/summary_sentence/rationale are all NULL`** — insert via the mechanical-only path (no spawn call yet), read the row back, assert all three text fields are `null` (not `""`, not `undefined` — `===  null` strictly).
- **`refined: a successful stubbed sonnet call yields refinement_state === "refined" with all four fields (name, summary_sentence/summary, rationale, memberUnitKeys) matching the stub fixture content field-by-field`** — stub `runClaudePromptJson` to return a fixed JSON payload; assert the persisted row's `name`/`summary_sentence`/`rationale` equal the stub's literal strings exactly (not merely non-null — AC-2's own bar: "a proposal missing any field is a defect, not done").
- **`zero_members: refinement succeeds but resolves no members (all proposed memberUnitKeys were outside the input cluster set) → refinement_state === "zero_members", name/summary/rationale still NULL`** — stub returns a group whose every `memberUnitKeys` entry is a key not present in the cluster (the model "invented" membership); assert those keys are dropped (not silently accepted) and the row lands as `zero_members`, not `refined` with an empty member list.
- **`failed: a batch whose spawn errors/times out persists its raw mechanical cluster as refinement_state === "failed" with the same signal + member set the mechanical stage produced, and no LLM text`** — stub rejects; assert the group row exists (never silently dropped — "disclose," not "vanish"), `refinement_state === "failed"`, `name`/`summary_sentence`/`rationale` all `null`, and `memberUnitKeys` (via `value_group_members`) equal the mechanical cluster's own membership byte-for-byte.
- **`a batch's own failure does not fail the whole run: other batches that succeeded still leave the run "completed"`** — two-batch fixture, one stubbed to fail, one to succeed; assert `run.state === "completed"` (not `"failed"` — run-level `failed` is reserved for a pass producing **no** group rows at all, per §3.1/§5.3).
- **`partition assertion across all four refinement_state values: name/summary_sentence/rationale are non-NULL if and only if refinement_state === "refined"`** — seed one row per state (reusing the fixtures above), one query, one loop: assert the biconditional for every row. This is the direct executable form of "the client must never infer state from NULL-ness" — proving the inverse can't happen either (a `refined` row with a NULL field, or a non-`refined` row with a populated field) is what makes the rule enforceable server-side rather than just documented client-side.

### 4c. Per-group review state — `GROUP_REVIEW_STATES`

Covered primarily in §6 (negative proof) for the `claimed`-unreachable half;
basic route mechanics belong in `value-groups-api.test.js`:

- **`POST /groups/:id/approve sets review_status = "approved" and reviewed_at to a fresh timestamp, and changes nothing else on the row (name/summary/rationale/members byte-identical before/after)`**
- **`POST /groups/:id/dismiss sets review_status = "dismissed" and reviewed_at, same non-mutation guarantee`**
- **`there is no generic POST /groups/:id/review route that accepts a body-supplied status`** — request `POST /groups/:id/review` with any body; assert `404` (route does not exist) — the structural closure DEC-S3-9 exists for.

### 4d. Per-member availability — `GROUP_MEMBER_AVAILABILITY` (derived, read-time)

**Spec file:** `server/__tests__/value-groups-refinement.test.js` (pure
function, no DB) — the technical plan's own implementation step 7 keeps this
separate from the route wiring.

- **`the anchored exemption-set assertion for GROUP_MEMBER_AVAILABILITY`** — `assert.deepEqual(GROUP_MEMBER_AVAILABILITY, ["already_claimed","available","no_longer_in_pool"])`.
- **`precedence: a member present in BOTH claims and the live pool resolves to already_claimed, never available`** — fixture member whose `unitKey` is in both `liveUnits` and `claims`; assert `available: "already_claimed"` (claims win, per §3.4's fixed precedence).
- **`a member present in the live pool and not claimed resolves to available`**
- **`a member absent from both claims and the live pool resolves to no_longer_in_pool`**
- **`partition assertion: every member row lands in exactly one bucket, and countsByGroupId's three counts sum to the group's own member row count`** — a mixed fixture spanning multiple groups and all three buckets; for each group assert `available + already_claimed + no_longer_in_pool === memberRows.length` for that group, and that no `unitKey` is double-counted across buckets (build a `Set` of counted keys per group and assert its size equals the member row count).

**Route-level integration, `value-groups-api.test.js`:**
- **`GET /groups's members[].availability is exactly resolveMemberAvailability's computed value for a seeded claims+pool fixture — server-computed, never left for the client to infer`** — anchored against the same literal fixture used in the pure-function test above (§9.1 anchoring, not a route↔function `deepEqual` that would degenerate to `deepEqual(f(x), f(x))`; anchor both sides against the literal expected bucket assignment).

---

## 5. §9.7 `CONSUMERS` / `assertSingleHome` registration (DEC-S3-10, O-8)

**Spec file:** `server/__tests__/single-writer-guard.test.js` (edit existing
blocks) + `server/__tests__/ledger-metrics-parity.test.js` (edit, per the §0
gap flagged above).

1. **`server/__tests__/ledger-metrics-parity.test.js`, test `C2.4`** — update the literal expected array to the 4-entry set: `["bin/ccam.js (cmdLedger)", "server/routes/project-plans.js", "server/lib/value-summary-tick.js", "server/lib/value-groups.js (derived-values reader: pre-grouping + member availability)"]` (exact string per `technical-plan.md`'s own change-set table, §9). This is the anchored registry test that this slice's own `CONSUMERS` edit makes go red if not updated in the same commit — name it explicitly so it is not "discovered" as an unplanned failure during the build.
2. **`assertSingleHome("../lib/value-ledger", {...})` (existing block, ~line 462) gains a `"../lib/value-groups"` consumer entry** — `shared: ["unitKey"]` (the one function `value-groups.js` actually calls, per §4's "the wire `unitKey` is produced by `valueLedger.unitKey(...)`, never string-concatenated" rule), `absent: ["assembleValuePool", "VALUE_SOURCES", "ATTRIBUTION_TIERS", "BACKFILL_LOOKBACK_DAYS", "CONSUMERS", "rowToUnit", "computePlanHealth", "summarizeDeliveredValue", "MUTABLE_VALUE_SOURCES"]` — the `absent: ["assembleValuePool", ...]` entry is the executable proof of DEC-S3-10's "never calls `assembleValuePool` itself" half; a build that adds that call would fail this disposition, not just the prose rule.
3. **`assertSingleHome("../lib/value-summary", {...})` (existing block, ~line 413) gains a `"../lib/value-groups"` consumer entry** — `shared: ["unitFacts", "summaryModel"]` (`groupingFacts` extends `unitFacts` per §5.4; `summaryModel("grouping")` is called from the refinement stage), `absent: ["buildPrompt", "parseOutput", "SUMMARY_STAGES", "MAX_UNITS_PER_PROMPT", "ALTITUDE_STATES", "compareUnitInputs", "ALTITUDE_FRESHNESS", "UNCOMPARED_FIELD_GUARANTORS", "enrichPoolAltitudes"]`.
4. **New `assertSingleHome("../lib/value-groups", {...})`** — one entry for `"../routes/project-plans"` (`shared:` every route-facing export — the 10 functions + 7 registries + `MAX_UNITS_PER_GROUPING_PROMPT` + `GROUPING_UNCOMPARED_FIELD_GUARANTORS` named in `technical-plan.md` §9's change table), and a **second** entry for `"../index"` (the boot hook) with `shared: ["reconcileInterruptedGroupRuns"], absent:` everything else — `value-groups.js` has two real consumers, not one, and both need an explicit disposition (missing the boot-hook consumer entirely is exactly the under-registration failure §9.7 already has 7 instances of).
5. **New `assertSingleHome("../lib/value-coverage-probe", {...})`** — already specified in §2b.4 above; listed here again only as the cross-reference this section's own completeness check should verify against.

**Red-first note:** all five are anchored exact-set assertions
(`assertSingleHome` internally does deep-equal-style disposition checking,
not existence-only). Red-proven by locally adding a stray new export to
`value-groups.js` (or a stray new `require("../lib/value-groups")` in an
undisposed file) and confirming the specific disposition assertion — not a
generic "guard failed" — names the missing entry.

---

## 6. "Proposals never actions" — negative proof (all four, red-proven)

**Spec file:** `server/__tests__/value-groups-api.test.js` (this is the file
`technical-plan.md` §9 names for "routes, gate, drift, negative proof" —
keep all four sub-proofs together here, not scattered, since they are one
acceptance property).

1. **Structural scan — zero call sites of the real plan-claim writers.** Enumerate the write surface from the actual code, not memory: `dbModule.stmts.insertValueClaim` (`server/db.js:3360`) and `dbModule.stmts.deleteValueClaim` (`server/db.js:3375`). Scan `server/lib/value-groups.js` **and** the four new route handler bodies in `server/routes/project-plans.js` (brace-walked the same way as §2b's call-site scan) for the literal substrings `insertValueClaim` / `deleteValueClaim`. Assert **zero** matches in either surface.
2. **Behavioral — `value_claims` row count is unchanged by a full grouping pass.** Seed a project with an existing `value_claims` row (so the count is provably nonzero, not "started and stayed at zero by coincidence"). Run the full pipeline end-to-end against a seeded DB: `mechanicalPreGroup` → stubbed `refineBatch` → `runGroupingPass` persisting groups+members. Query `SELECT COUNT(*) FROM value_claims` before and after; assert **equal**. Also assert the run produced `group_count > 0` in the same test, so "nothing happened at all" can't pass this vacuously.
3. **Reserved-but-unreachable — zero code paths set `review_status = 'claimed'`.** Structural scan of `value-groups.js` and the route handlers for any assignment of the literal string `'claimed'`/`"claimed"` to `review_status` (distinct from the schema's own CHECK-constraint declaration in `db.js`, which legitimately contains the string and must be excluded from this scan by file scope, not by pattern — scope the scan to `server/lib/value-groups.js` + the group route handlers only). Assert zero matches.
4. **Adversarial LLM response — strict field whitelist.** Feed `parseGroupingOutput` a fixture payload containing the four legitimate fields **plus** `status: "claimed"` (and, in a second case, `review_status: "approved"`). Assert the parsed/persisted group's `review_status` is `"proposed"` regardless — the extra field is discarded, never read. Then persist via `runGroupingPass` with this exact malicious stub and assert the **actual DB row** (not just the parsed intermediate object) has `review_status === "proposed"` — closing the gap between "the parser ignored it" and "nothing downstream re-reads the discarded field from the raw stdout a second time."

**Red-first note (all four, per §11.4's own instruction):** each is
red-proven by **injecting** the thing it forbids — a call to
`insertValueClaim` inside `value-groups.js`, a code path assigning
`review_status = 'claimed'`, and a `parseGroupingOutput` that reads `status`
off the raw payload instead of whitelisting — confirming the specific test
fails, then reverting. Performed and independently re-run, not reported
(§9.3 AGENT-SELF-REPORTED-RED) — "an unproven negative assertion is exactly
as vacuous as a positive one" (technical-plan §11.4.5, verbatim).

---

## 7. `reconcileInterruptedGroupRuns`-at-boot (technical-plan's own #2 risk)

**Spec file:** `server/__tests__/value-groups-refinement.test.js` (new
`describe("reconcileInterruptedGroupRuns")` block — orchestration-adjacent,
same file as `runGroupingPass`).

1. **`a surviving in_progress run row is flipped to failed with error_reason = 'interrupted_restart' and a non-null completed_at`** — seed `value_group_runs` directly with `state: 'in_progress'`, no `completed_at`. Call `reconcileInterruptedGroupRuns(dbModule)`. Re-read the row; assert `state === "failed"`, `error_reason === "interrupted_restart"`, `completed_at` is now non-null.
2. **`rows already in a terminal state (completed / completed_zero_groups / failed) are left byte-identical`** — seed one row per terminal state (including a `failed` row with a *different* `error_reason`, e.g. `'llm_error'`, to prove the function doesn't overwrite an existing, more specific failure reason). Call the function; assert all three rows are unchanged field-by-field.
3. **`multiple in_progress rows across multiple projects are all reconciled in a single call`** — seed 3 `in_progress` rows for 2 different `project_id`s; call once; assert all 3 flip.
4. **Boot-wiring structural check — `server/index.js` actually calls `reconcileInterruptedGroupRuns(dbModule)` at boot, in the same try/catch posture as the existing tick start.** Read `server/index.js`'s source text (do **not** `require("../index")` — no test in this codebase boots the server directly, confirmed live; this project's convention for boot-hook wiring is a source-text scan). Assert the source contains `reconcileInterruptedGroupRuns(` positioned inside a `try { ... } catch (err) { console.warn(...) }` block, in the same region as (adjacent to, not necessarily immediately following) the existing `startValueSummaryTick(broadcast)` call at `server/index.js:465-470` — mirroring that block's own `try/catch` + `console.warn` shape so a crash inside reconciliation can't take the whole boot down (fail-safe hook behavior, per this repo's own `CLAUDE.md` "Hooks: keep fail-safe and non-blocking behavior" rule, applied to this boot hook by the same convention).

**Red-first note:** case 1 is the one technical-plan.md names as the #2
build risk ("without it, a crashed run renders 'running' forever: an
overloaded-absence with a spinner on it") — before the function exists, this
whole describe block fails to even load (function undefined); after a naive
implementation that only updates `state` but forgets `error_reason` or
`completed_at`, case 1 still fails on the specific missing field, proving the
assertion is field-level, not existence-level. Case 4 is red-proven by
temporarily removing the call from `server/index.js` in a local diff and
confirming the scan fails — then restoring.

---

## 8. Round-trip / persistence-boundary coverage

Every field on all three new tables crosses two boundaries this slice must
prove survives: DB write → `GET /groups` read, and the one supported update
(approve/dismiss) → re-read.

**Spec file:** `server/__tests__/value-groups-api.test.js`

1. **`Create → Get: every persisted field on a run+group+members row-set survives through GET /groups verbatim`** — run a full pipeline against a stubbed refinement fixture with distinct, greppable values for every field (`name`, `summary_sentence`, `rationale`, `pregroup_signal`, `refinement_state`, `review_status`, `created_at`, `refined_at`); `GET /groups`; assert every one of those fields on the response matches the fixture's own values exactly, field-by-field (not a subset/spot-check).
2. **`Update → Get: approve/dismiss change only review_status + reviewed_at; every other field from case 1 is byte-identical after the update`** — capture the full case-1 response, `POST /groups/:id/approve`, re-`GET /groups`, `assert.deepEqual` on every field **except** `review_status`/`reviewed_at`, plus the two explicit equality checks on those two fields' new values.
3. **No-unresolved-token boundary check, both ends (this project's closest existing convention for the "unresolved placeholder" risk class is i18n-key leakage — see `PlanLedgerPanel.test.tsx`'s existing `"does not leak raw projectDetail.* i18n keys into the DOM"` test at line 382, and its client-side counterpart is designed in §9 below):**
   - **Production end — `parseGroupingOutput` never persists prompt scaffolding as if it were model output.** Feed a stub whose raw text is the **prompt itself** echoed back verbatim (the failure mode where a model "answers" by repeating its input) instead of the expected JSON; assert `parseGroupingOutput` returns `null` (the documented failure sentinel) rather than persisting a group whose `name`/`summary_sentence` contain literal prompt-scaffolding text like `"CLUSTER 1 (signal="`.
   - **Consumption end — `GET /groups`'s rendered `name`/`summary_sentence`/`rationale` never contain the literal prompt-fact-line prefixes** (`"CLUSTER "`, `"[trunk_commit]"`, etc.) for any `refinement_state === "refined"` row in the case-1 fixture — a direct assertion that the response text is genuinely the model's composed sentence, not a leaked fragment of `buildGroupingPrompt`'s own numbered-fact-line format.

---

## 9. Client — `PlanLedgerPanel.groups.test.tsx` (new file)

**Spec file:** `client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx`
**Pattern:** mirror `PlanLedgerPanel.test.tsx`'s existing `vi.mock("../../lib/api", ...)` shape exactly, adding `groups`, `proposeGroups`, `approveGroup`, `dismissGroup` mock functions beside the existing `mockCoverageMock`/`mockRequestCoverageMock`.

1. **`renders server-computed run state, group list (name/summary/rationale/members with availability chips), and ungrouped-unit count verbatim — no client-side member count or coverage-of-members math anywhere`** (§9.1 rogue-re-derivation guard, client half) — mock a `GET /groups`-shaped response with deliberately mismatched-looking numbers (e.g. `member_availability_counts` that don't equal what a naive `members.length` count would produce, to prove the component renders the server's counts and not its own recomputation); assert the rendered counts match the mocked server value, not `members.length`.
2. **`Auto-group button is disabled while !coverage.complete, and its disabled affordance references the existing coverage header ETA — no second control, no duplicate handler`** (AC-7) — assert exactly one element with the existing `prioritize-now-button` test id/selector exists in the DOM (query for it, assert `document.querySelectorAll(...).length === 1`), and that the Auto-group button's `disabled` attribute tracks `coverage.complete` across a mock update from `false` → `true`.
3. **`Approve / Dismiss call approveGroup/dismissGroup exactly once with the group id, and render no "Approve & claim" copy, no claim-target picker, no plan-item create/edit affordance anywhere in the diff`** (PO §7/§8 fence) — assert absence of specific forbidden strings/elements in the rendered DOM as a named, explicit check (not merely "the happy path works").
4. **`does not leak raw projectDetail.* i18n keys into the DOM for any of the 6 new state registries`** — same shape as the existing test at line 382; render with a group in each of the four `refinement_state` values and each of the three `review_status`+gate states reachable client-side, assert no rendered text matches `/^projectDetail\./`.
5. **`PM-5a MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH: switching projectId resets the group list, run state, and any in-flight propose request — the old project's groups are gone`** — mirror `PlanLedgerPanel.test.tsx`'s existing `"SF-8: switching projectId does not leak..."` test (line 1304) exactly in shape: `mockGroupsMock.mockImplementation(projectId => ...)` keyed per-project with visibly distinct group names, initial render on `proj-A`, `rerender` with `proj-B`, assert `proj-A`'s group name is gone and `proj-B`'s is present.
6. **`PM-5a (in-flight case): a groups response for a project no longer mounted must not land after switching away mid-request`** — mirror the existing `"SF-8 (in-flight): ..."` test (line 1391) exactly in shape: deferred/controllable promise for `proj-A`'s `groups()` call, switch to `proj-B` before resolving, resolve `proj-A`'s promise **after** the switch, assert `proj-A`'s stale group data never renders under `proj-B`.
7. **`PM-5b STRICTMODE-BLIND CLIENT SUITE: at least one new effect/ref for this feature renders correctly under <StrictMode>`** — mirror the existing `"BL-2 regression: under React 18 StrictMode's setup->cleanup->setup double-invoke..."` test (line 1034) exactly in shape (wrap in `<StrictMode>`), asserting the group list/run-state text actually renders (not blank) after StrictMode's double-invoke — this is the exact failure class (`useRef(true)` + cleanup-only `useEffect`) that shipped invisibly behind an 817/817 green suite in Slice 2 (BL-2).

**Locale-mirror registry test (can live in this file or a small dedicated
`client/src/i18n/__tests__/` spec, whichever this project's existing i18n
test convention uses — check for a precedent file before creating a new
location):**

8. **`every one of the 6 new client-side registry mirrors carries the anchored exemption-set assertion, and all 4 locale files (en/ko/vi/zh) define every key each registry needs`** — for each mirror constant, `assert.deepEqual(mirror, [<reviewed list>])` (the exact N2 two-line shape); then, for each of the four `projectDetail.json` locale files, assert every wire value in every one of the 6 registries has a corresponding translation key present in **that specific file** (not just `en`) — a missing `ko`/`vi`/`zh` key for a 4th registry is exactly the "N2, still OPEN" stale-fact class the PM's plan corrects elsewhere in this intake.

**Red-first note:** case 5/6 are red-proven the same way SF-8 itself was
found — a naive implementation that keys the group-list state off a `useRef`
without a `[projectId]`-scoped reset `useEffect` passes every "does it
render groups" test and only fails 5/6, exactly mirroring "the quiescent-only
fixture is how the Slice 2 fix looked complete while the in-flight leak
stayed live" (PM-5a, verbatim).

---

## Test data / fixtures

- **Pool fixtures:** reuse the existing `makeUnit()`-style factory convention
  from `value-summary.test.js` / `PlanLedgerPanel.test.tsx`; add a
  `makePoolUnit(overrides)` helper local to the new `value-groups-*` server
  spec files rather than hand-writing unit literals per test (existing
  `intake_initiative`/`merge_commit`/`trunk_commit` shapes at
  `value-ledger.js:219-262` are the source of truth for field names).
- **Refinement stub fixture:** one canonical "successful" JSON payload (four
  fields, 2-3 members) reused across §4b's `refined` case, §6's negative-proof
  cases (as the base the malicious extra fields get added to), and §8's
  round-trip case — one fixture object, imported/constructed once, not
  hand-copied four times (the same §9.1 discipline this whole slice exists to
  enforce, applied to the test suite itself).
- **Claims fixture:** reuse whatever `value_claims` seeding helper
  `project-plans-api.test.js` / `ledger-metrics-parity.test.js` already use
  for claim rows, for §4d/§6.2's claims-aware fixtures.

## How to run

- Full server suite: `npm run test:server`
- Single new spec, individually re-runnable (required by DoD §15):
  `node --test server/__tests__/value-groups-mechanical.test.js`
  `node --test server/__tests__/value-groups-refinement.test.js`
  `node --test server/__tests__/value-groups-api.test.js`
  `node --test server/__tests__/value-coverage-probe.test.js`
  `node --test server/__tests__/single-writer-guard.test.js`
  `node --test server/__tests__/project-plans-api.test.js`
  `node --test server/__tests__/chronology-ordering.test.js`
  `node --test server/__tests__/db-migration.test.js`
  `node --test server/__tests__/ledger-metrics-parity.test.js`
  `node --test server/__tests__/value-coverage-parity.test.js` (must stay green, unmodified)
- Full client suite: `npm run test:client`
- Single new client spec: `cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.groups.test.tsx`
- Snapshot review (only if `PlanLedgerPanel`'s rendered shape actually
  changes): `cd client && npx vitest run -u` — review the diff first, per
  `CLAUDE.md`'s explicit "never blindly update snapshots" rule.
- Header audit (every new file in this change set): `bash .claude/skills/file-headers/scripts/check-headers.sh`

## Sweep before declaring any guard done (technical-plan §11.2, apply to every new/edited spec above)

`grep -rn "assert.ok(true" server/__tests__/` and `grep -rn "|| true"
server/__tests__/` must both return 0 for the new/edited files; additionally
grep the new specs for `typeof `, bare `Array.isArray(`, `assert.ok(` with no
compared value, and empty `=> {}` bodies — none of the sweeps above catch
those four shapes, and this file family's own record (three consecutive
builds where `build-reviewer` caught blockers a correctly-executed verifier
pass had already certified green) is the reason `intake-qa`/`build-reviewer`
are non-trimmable here (PM-6.1).
