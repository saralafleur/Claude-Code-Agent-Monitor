# Engineer Findings — Value Pool Slice 3: Auto-group proposal engine

**Intake:** `2026-08-06-auto-group-proposal` · **Stage:** intake-engineer
**Scope per director-of-engineering's dispatch:** SF-4 extraction (primary
mandate), `value_groups` schema, the two-stage grouping module(s) +
`CONSUMERS` registration, WATCH-6 guard-widening disposition, route surface
gating, file-header compliance. All claims below are grounded in direct
reads of the current repo (`master`, 2026-08-06) — file/line references were
re-verified while writing this, not carried from memory.

---

## 1. SF-4 extraction — the primary mandate

### 1.1 The live divergence, confirmed by direct read

`server/routes/project-plans.js` has two independent hand-written copies of
the same 4-step probe-coverage composition:

**`POST /coverage-request`** (lines 299-336):
```js
const nowIso = new Date().toISOString();
dbModule.stmts.requestValueCoverage.run(projectId, nowIso);
runCoverageDrain(dbModule, projectId, { broadcast }).catch(() => {});
const { units } = await valueLedger.assembleValuePool(dbModule, { id: projectId });
const { counts } = await enrichPoolAltitudes(dbModule, units, { probe: true });
const snapshot = coverageSnapshot(dbModule, {
  projectId, counts, requestedAt: nowIso,
  draining: isDrainingProject(projectId),
  computedAt: new Date().toISOString(),
});
```

**`GET /coverage`** (lines 344-367):
```js
const { units } = await valueLedger.assembleValuePool(dbModule, { id: projectId });
const { counts } = await enrichPoolAltitudes(dbModule, units, { probe: true });
const state = dbModule.stmts.getValueSweepState.get(projectId);
const snapshot = coverageSnapshot(dbModule, {
  projectId, counts, requestedAt: state ? state.coverage_requested_at : null,
  draining: isDrainingProject(projectId),
  computedAt: new Date().toISOString(),
});
```

The 4 steps — `assembleValuePool` → `enrichPoolAltitudes({probe:true})` →
sweep-state read (POST skips this; GET does it) → `coverageSnapshot` — are
identical in 3 of 4 places and diverge only on how `requestedAt` is sourced.
**That divergence is not a bug to erase** — it's load-bearing and each side
has its own inline comment explaining why (POST: comment at line 320-327
explains re-reading `getValueSweepState` here would race the fire-and-forget
drain it just kicked, per build-reviewer findings SF-2/SF-3; GET: it has no
fresher value to hand in, so it must read the row). The extraction must
preserve this, not force identical behavior.

I confirmed there is **no existing route↔route parity test** — I grepped
`server/__tests__/*.test.js` for `coverage-request`/`buildProbeCoverage`/
route-parity language and found only `value-coverage-parity.test.js` (G2),
which is route↔**tick** parity (`GET /coverage` vs. the WS broadcast from
`value-summary-tick.js`), not route↔route. This matches
PROJECT-CONTEXT.md's own diagnosis (line 380-383): "the parity guard compares
the route against the tick, so route↔route has no home."

### 1.2 Extraction design

**New function `buildProbeCoverage(dbModule, projectId, opts = {})`** in a
**new file `server/lib/value-coverage-probe.js`** (not inside
`value-coverage.js`). Rationale for the separate file, not folding into
`value-coverage.js`:

- `value-coverage.js`'s own header (lines 12-18) states an explicit
  architectural invariant: *"this module contains NO pool-membership SQL and
  NO membership query of its own... `coverageSnapshot`... fed SOLELY by the
  composer's own `counts`... never bypassed."* `buildProbeCoverage` must call
  `assembleValuePool` (pool membership) directly — adding that to
  `value-coverage.js` would contradict its own documented contract and is
  exactly the kind of change that invites a future reader to assume
  `coverageSnapshot` itself is DEC-16-compliant only by accident.
- `value-summary-tick.js` already imports all three pieces
  (`assembleValuePool`, `enrichPoolAltitudes`, `coverageSnapshot`) for its
  own **non-probe** composition (real generation, not classify-only) — but
  it is a background-tick-specific module; overloading it with a
  request/response-path helper conflates two different call patterns (tick
  loop vs. one-shot route handler / Slice-3 gate check).

Proposed body (mirrors the two current call sites exactly, parameterizing
only the one thing that legitimately differs):

```js
// server/lib/value-coverage-probe.js
const valueLedger = require("./value-ledger");
const { enrichPoolAltitudes } = require("./value-summary");
const { coverageSnapshot } = require("./value-coverage");
const { isDrainingProject } = require("./value-summary-tick");

async function buildProbeCoverage(dbModule, projectId, opts = {}) {
  const { units } = await valueLedger.assembleValuePool(dbModule, { id: projectId });
  const { counts } = await enrichPoolAltitudes(dbModule, units, { probe: true });

  let requestedAt;
  if (Object.prototype.hasOwnProperty.call(opts, "requestedAt")) {
    requestedAt = opts.requestedAt; // caller has a fresher value (POST /coverage-request)
  } else {
    const state = dbModule.stmts.getValueSweepState.get(projectId);
    requestedAt = state ? state.coverage_requested_at : null;
  }

  return coverageSnapshot(dbModule, {
    projectId,
    counts,
    requestedAt,
    draining: isDrainingProject(projectId),
    computedAt: new Date().toISOString(),
  });
}

module.exports = { buildProbeCoverage };
```

Call sites become:
- `POST /coverage-request`: `await buildProbeCoverage(dbModule, projectId, { requestedAt: nowIso })`
- `GET /coverage`: `await buildProbeCoverage(dbModule, projectId)`
- **Slice 3's new consumer** (gating check in `value-groups.js` or its route,
  see §4): `await buildProbeCoverage(dbModule, projectId)` — reads
  `.complete` off the result. This is the "third consumer" that makes the
  extraction pay for itself immediately rather than being pre-emptive.

### 1.3 Replacing the guard, not duplicating it

PROJECT-CONTEXT.md's own instruction (line 388-390): *"Recommended now...
a structural guard asserting both handler bodies compose `coverageSnapshot`
from an identical sorted key set... Extract `buildProbeCoverage` when Slice
3's consumer lands, and replace the guard then — do not keep both."* I
verified no such structural guard currently exists in
`single-writer-guard.test.js` or elsewhere (grepped for "sorted key set" /
"buildProbeCoverage" — no hits), so there is nothing to delete; the build
should add the **replacement** form directly:

- A single-call-site guard, same shape as the existing
  `insertValueSummaryGeneration`/`requestValueCoverage` cases in
  `server/__tests__/single-writer-guard.test.js` (lines 275-283, 346-385):
  assert `buildProbeCoverage` appears in `db.js`? No — assert it is
  **defined only** in `value-coverage-probe.js` and its **call sites** are
  exactly `project-plans.js` (×2, one per route body, each exactly once) and
  the new Slice-3 module. This directly regression-proofs "no third hand-copy
  ever appears again," which is the actual risk SF-4 names.
- This subsumes the previously-recommended "identical sorted key set" guard
  structurally (both routes now call the same function, so their `counts`
  composition literally cannot diverge) — no separate parity assertion is
  needed once both routes are call sites of one function, which is why
  PROJECT-CONTEXT.md says "replace... do not keep both."

---

## 2. `value_groups` schema

### 2.1 Precedent check — join table vs. JSON array for membership

Direct read of `server/db.js:794-819` (`value_claims`) is the closest
existing precedent for "a set of value-pool units associated with something
else": it is a **plain relational row-per-unit table**, not a JSON blob —
`(project_id, plan_id, item_id, value_source, value_ref, source_cwd, ...)`
with a `UNIQUE INDEX idx_value_claims_unit_item` and two lookup indexes
(`idx_value_claims_plan`, `idx_value_claims_unit`). There is no precedent
anywhere in `server/db.js` for storing a queryable set of unit references as
a JSON array column — the one JSON-blob column in this schema family,
`decision_queue.payload TEXT` (line 872), holds an **opaque diagnostic
payload** nothing else ever queries into, which is a materially different
use case than "which units belong to this group" (Slice 3's own acceptance
signals require listing/filtering members, checking "did the LLM refinement
resolve any members," etc. — a JSON column makes every one of those a
full-table deserialize-and-scan).

**Recommendation: a join table, `value_group_members`, following the
`value_claims` shape** — not a JSON array column. This also directly serves
§9.8 (below): a group with zero rows in `value_group_members` is
structurally distinguishable from a group whose refinement never ran, via
the group's own status column, not by parsing an empty/absent JSON array.

### 2.2 Proposed schema

```sql
CREATE TABLE IF NOT EXISTS value_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  name TEXT,                    -- NULL until refinement names it (see §9.8 below)
  summary_sentence TEXT,        -- NULL until refinement produces it
  rationale TEXT,               -- NULL until refinement produces it
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN
    ('proposed','reviewed','claimed','dismissed')),
  -- Full vocabulary up front per WATCH-4/DEC-15's own lesson (§9.6): a CHECK
  -- is rebuild-to-widen, so state every status this feature's acceptance
  -- signals name (proposed -> reviewed -> claimed-or-dismissed) now rather
  -- than adding a 5th value later via a table rebuild.
  pregroup_signal TEXT NOT NULL,  -- 'slug_reference' | 'time_adjacency' | 'shared_surface' | 'mixed'
  refinement_state TEXT NOT NULL DEFAULT 'pending' CHECK(refinement_state IN
    ('pending','refined','zero_members','failed')),
  -- §9.8 OVERLOADED-ABSENCE: refinement_state is the discriminated-state
  -- column this entry's acceptance criterion demands. 'pending' = mechanical
  -- pre-group exists, sonnet call not yet attempted; 'refined' = sonnet call
  -- succeeded and produced >=1 member; 'zero_members' = sonnet call
  -- succeeded but every candidate was filtered out (a NAMED, non-silent
  -- outcome — never collapsed into an empty value_group_members join);
  -- 'failed' = the sonnet call errored/timed out. name/summary_sentence/
  -- rationale stay NULL for 'pending'/'zero_members'/'failed' — the client
  -- must read refinement_state, never infer state from NULL-ness of those
  -- text fields (that inference IS the trap this entry warns against).
  run_id TEXT NOT NULL,         -- groups this run's proposals (one grouping
                                 -- pass over a project = one run_id, UUID or
                                 -- timestamp+random)
  parent_group_id INTEGER REFERENCES value_groups(id),
  -- Hierarchical rollup (architect's call on exact shape, per run-plan §2.1
  -- item (b)) — a rollup-level group's members are child value_groups rows,
  -- not raw units; parent_group_id is NULL for a top-level/leaf group.
  model TEXT,                   -- the sonnet model string actually used
                                 -- (summaryModel("grouping")'s resolved value)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  refined_at TEXT,               -- NULL until refinement_state leaves 'pending'
  reviewed_at TEXT,
  reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_value_groups_project_run
  ON value_groups(project_id, run_id);
CREATE INDEX IF NOT EXISTS idx_value_groups_status
  ON value_groups(project_id, status);

CREATE TABLE IF NOT EXISTS value_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES value_groups(id),
  value_source TEXT NOT NULL CHECK(value_source IN
    ('trunk_commit','merge_commit','intake_initiative','detour','focus_segment')),
  -- Mirrors value_claims's CHECK verbatim (DEC-3's own precedent, §9.1 rule
  -- 2) — validate against valueLedger.VALUE_SOURCES, never a typed literal.
  value_ref TEXT NOT NULL,
  source_cwd TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_value_group_members_unit_group
  ON value_group_members(group_id, value_source, value_ref, source_cwd);
CREATE INDEX IF NOT EXISTS idx_value_group_members_group
  ON value_group_members(group_id);
```

### 2.3 §9.5/§9.6 migration mechanics — confirmed inapplicable at introduction

Per PROJECT-CONTEXT §9.5/§9.6 (`server/db.js:1092-1231`, confirmed by direct
read) and the request-brief's own correct framing:

- `value_groups`/`value_group_members` are **brand-new tables** — confirmed
  by `grep -n "value_groups" server/db.js` returning nothing (re-verified
  live, matches request-brief's own verification item #4). §9.6's "prefer
  inapplicability over compliance" applies literally: a plain
  `CREATE TABLE IF NOT EXISTS` inside the existing `db.exec(...)` schema
  block needs **zero** `ALTER TABLE`, **zero** `UPGRADE_CASES` entry in
  `server/__tests__/db-migration.test.js`, and **zero** `PRAGMA table_info`
  guard — an old DB simply doesn't have the table yet, `CREATE TABLE IF NOT
  EXISTS` creates it once, and every subsequent boot is a no-op by
  construction. This is exactly the class §9.5's acceptance criterion
  ("does an old DB get the column") does not apply to — there is no column
  being added to an existing table, there's a new table.
- **The status/refinement_state CHECK enums are the one thing that will
  eventually need §9.6's rebuild path**, per the request-brief's own
  flagging (open question #3) and this being the exact CHECK-widening shape
  WATCH-4/§9.6 describes. Because the full vocabulary is stated up front
  (§2.2 above lists every status this build's acceptance signals name), no
  rebuild is needed **at introduction** — but the build's own `decisions.md`
  should record, verbatim, the WATCH-4 lesson: *if a later fix-round needs a
  5th status value, it goes through `rebuildTableAtomically({ table,
  createSql, copySelect, indexes })`* (`server/db.js:1664`, confirmed live,
  the helper `coach_observations` already uses per §9.6's build-outcome
  note) **and** gets a `REBUILD_CASES` entry in `db-migration.test.js` — never a
  hand-rolled rename/create/copy/drop sequence outside a single transaction.

---

## 3. Two-stage grouping module(s)

### 3.1 File layout

- **`server/lib/value-groups.js`** (new) — owns both stages, following
  `value-summary.js`'s file-per-synthesis-layer convention (one file per
  synthesis concern, exporting `enrichPoolAltitudes`-equivalent entry
  points). Two internal functions:
  - `mechanicalPreGroup(units)` — pure, deterministic, no LLM, no `await`.
    Takes `assembleValuePool`'s `units` array (already resolved via
    `buildProbeCoverage`'s own `assembleValuePool` call, or a fresh one —
    see §3.2 on avoiding a second hand-rolled composer call) and returns
    pre-group candidate clusters keyed by the three named signal types
    (slug reference / time adjacency / shared surface). This is the
    "independently auditable and testable without an LLM" half the
    architect is asked to rule on (run-plan §2.1(a)) — engineer's job here
    is only to confirm it is its own top-level exported function, never
    inlined into the LLM-calling function, so it has its own unit tests
    with zero spawn mocking (parallels `value-summary.js`'s `unitFacts`/
    `compareUnitInputs` being separately exported and separately tested from
    `enrichPoolAltitudes`).
  - `refineGroupsWithLLM(dbModule, preGroups, unitTextByKey)` — the sonnet
    call. Reuses `summaryModel("grouping")` and `SUMMARY_STAGES` verbatim
    from `server/lib/value-summary.js` (confirmed already exported at
    `value-summary.js:591-593`, and `"grouping"` is already a member of
    `SUMMARY_STAGES` — `value-summary.js:107`'s own JSDoc explicitly
    reserves it for "Slice 3's cross-unit grouping synthesis... NO consumer
    yet"). **This is not new model-tiering work** — confirmed live in
    `.env.example:137-138`: `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL` is
    already documented as a knob, and `summaryModel("grouping")`'s fallback
    cascade already exists (`value-summary.js:122-131`). Slice 3 is simply
    `summaryModel`'s **first real caller** with `stage="grouping"`.
  - The LLM spawn mechanism itself should reuse `value-summary.js`'s
    existing hermetic spawn path (whatever `enrichPoolAltitudes` calls
    internally to invoke `claude -p`) rather than `focus-summary.js`'s
    `runClaudePromptJson` — value-summary.js's own header states it
    "Reuses focus-inference.js's hermetic spawn contract" already, so the
    grouping call should go through the **same** already-adopted spawn path
    value-summary.js uses, not introduce a second import of
    `focus-inference.js`'s `runClaudePromptJson` directly. (Needs a direct
    read of value-summary.js's spawn call — not fully traced in this pass;
    flagged for the technical plan to pin the exact function name.)

- **Hierarchical rollup** — `value-groups.js` should expose a third function,
  e.g. `runGroupingPass(dbModule, projectId)`, that decides direct-vs-
  hierarchical the same way `focus-summary.js:70`'s
  `DIRECT_WINDOW_MAX_DAYS` gate does (`generateWindowSummary`,
  `focus-summary.js:540`, confirmed live) — a named constant analogous to
  `DIRECT_WINDOW_MAX_DAYS`/`MAX_UNITS_PER_PROMPT`, and a rollup shot that
  consumes prior groups' `summary_sentence`s the way
  `buildWindowSummaryRollupPrompt` (`focus-summary.js:185`) consumes
  per-day bullets. This is architecture-altitude (run-plan assigns the exact
  rollup shape to the architect) — engineer's note is only that the
  **module boundary** (mechanical / refine / rollup-orchestrate as three
  separate exported functions, not one monolith) is what keeps each half
  independently testable, mirroring `value-summary.js`'s own internal
  separation of `unitFacts`/`buildPrompt`/`parseOutput`/`enrichPoolAltitudes`.

### 3.2 `assembleValuePool` / `CONSUMERS` — extend, never re-derive

`server/lib/value-ledger.js:70-74`, confirmed by direct read:

```js
const CONSUMERS = [
  "server/routes/project-plans.js",
  "bin/ccam.js (cmdLedger)",
  "server/lib/value-summary-tick.js",
];
```

The comment immediately above (lines 64-69) is explicit: *"a new one (MCP
tools, an AGENT-PLAN.md export, a dedicated reconcile page) is a reviewed,
deliberate addition... Grow this list ONLY when the new consumer reads
`computePlanHealth`/`assembleValuePool`/`summarizeDeliveredValue` directly,
never re-implements a piece of them."*

`value-groups.js` becomes the **fourth** entry:

```js
const CONSUMERS = [
  "server/routes/project-plans.js",
  "bin/ccam.js (cmdLedger)",
  "server/lib/value-summary-tick.js",
  "server/lib/value-groups.js",
];
```

This is a one-line addition at `value-ledger.js:70-74`, done in the same
commit that adds `value-groups.js`'s own `assembleValuePool` call — **not**
a follow-up. Two call sites of `assembleValuePool` inside the Slice-3 path
need reconciling, not duplicating:
1. `buildProbeCoverage`'s own call (§1.2) — used for the **gate check**
   (coverage `.complete`), probe mode.
2. `value-groups.js`'s own call — needed to get the **actual unit facts**
   (not just altitude counts) to feed the mechanical pre-group + the
   refinement prompt.

These are two different call *purposes* (probe-classify vs. full-unit-facts
read) so **both legitimately call `assembleValuePool` directly** — that's
fine and expected (assembleValuePool is "never persisted — recomputed on
every call", `value-ledger.js:136`, so a second call is the intended usage
pattern, not a duplication smell). What must not happen is a hand-rolled
pool query anywhere in `value-groups.js` that bypasses the composer — grep
for raw `SELECT` against `value_claims`/`detour_dispositions`/etc. inside
`value-groups.js` at review time.

Also register `value-groups.js` as a consumer disposition in the
`assertSingleHome` calls in `single-writer-guard.test.js` (lines 462-483,
`value-ledger.js`'s exports check) — currently only lists
`../lib/value-summary-tick`. Per §9.7's own lesson (this is precisely the
"HAND-SCOPED STRUCTURAL SCAN" failure mode the catalog names — a
hand-typed consumer map that doesn't grow when a new consumer lands), this
test's consumer map **must** gain a `"../lib/value-groups"` entry in the
same commit, or the scan silently stays blind to the new consumer exactly
as §9.7's occurrence 4 describes.

---

## 4. WATCH-6 single-writer guard — does it widen, or does `value_groups` get its own?

**Verified: `value_groups` gets its OWN new guard set (WATCH-6 *pattern*,
not a widening of the existing WATCH-6 guard).** Confirmed by direct read of
`server/__tests__/single-writer-guard.test.js:275-283`: the actual
WATCH-6-labeled test is titled *"`insertValueSummaryGeneration` has exactly
two production call sites (tick + request)"* — its comment explicitly reads
*"WATCH-6: widened here... request-path logging... now lands beside the
tick's... both writing through the same statement."* That guard, and the
adjacent `upsertValueUnitSummary`/`markValueUnitSummariesSeen` guards
(lines 236-344), are scoped **specifically to `value_unit_summaries` and
`value_summary_generation_log` writes**.

Slice 3's LLM refinement call **reads** units' already-generated
`project_level`/`stakeholder_level` text (`value_unit_summaries`, via
whatever accessor `value-groups.js` uses — likely a straight
`getValueUnitSummary` read, already single-callsite-guarded at
`db.js:3386`/`single-writer-guard.test.js:236-240`) but **writes only to
`value_groups`/`value_group_members`** — new tables, new statements, new
writer. This confirms request-brief open question #6 / run-plan item (d):
the grouping engine does not write to `value_unit_summaries`, so **the
existing WATCH-6 guard set does not widen**.

Instead, `value_groups`/`value_group_members` need their own single-writer
guards, same shape, new test cases in `single-writer-guard.test.js`:
- `upsertValueGroup`/`insertValueGroupMember` (or equivalent statement
  names) appear only in `db.js` (definition) and `value-groups.js` (caller)
  — same pattern as the `upsertValueUnitSummary` guard at lines 236-240.
- The write call is lexically nested inside a single named orchestrating
  function (e.g. `runGroupingPass` or the refinement function itself) — same
  brace-walk pattern as lines 242-273's `enrichPoolAltitudes` nesting check.
- The new route handler that triggers a grouping run (§5) is the **only**
  production call site of that orchestrating function — same shape as the
  `/coverage-request` handler check at lines 346-385.

If, during build, the architect's ruling on open question #6 changes (i.e.
refinement turns out to need a write-back to `value_unit_summaries` — e.g.
to mark units as "grouped"), that write must go through the **existing**
`upsertValueUnitSummary`/`markValueUnitSummariesSeen` call sites (i.e.
widen the WATCH-6 guard's expected-file list to include `value-groups.js`),
never a third, independent write path to that table. This is a real, not
hypothetical, risk given `value_unit_summaries.seen_at`'s existing
"acknowledge" pattern (`markValueUnitSummariesSeen`,
`project-plans.js`'s `/altitudes/seen` handler) — if the client needs an
analogous "seen this group" gesture for a *unit* once it's grouped, don't
build a second acknowledge path; extend the existing one and widen its
guard test's `basenames` assertion, deliberately, in the same commit.

---

## 5. Route surface

New endpoints on `server/routes/project-plans.js` (or a sibling route file
— given the file's own header already documents "coverage/coverage-request
segments," a sibling `server/routes/value-groups.js` mounted under the same
`/api/project-plans` prefix, or a fresh `/api/value-groups` prefix, is
plausible either way; PM/architect call, not decided here). Concretely:

- **`POST /api/project-plans/groups/propose`** `{project_id}` — triggers a
  grouping run. **Must gate on `coverageSnapshot.complete`** before doing
  any work:
  ```js
  const coverage = await buildProbeCoverage(dbModule, projectId);
  if (!coverage.complete) {
    return res.status(409).json({
      error: { code: "COVERAGE_INCOMPLETE", message: "..." },
      coverage, // let the client render the existing ETA/progress UI, not a bare 409
    });
  }
  ```
  This is the exact `coverageSnapshot.complete` field confirmed live at
  `server/lib/value-coverage.js:134`/`152` (`complete = pending === 0`),
  and it is the same object shape `PlanLedgerPanel.tsx` already renders for
  the coverage header — returning it on the 409 lets the client reuse its
  existing coverage-progress rendering rather than inventing a second error
  shape. This route is the **third consumer** that makes the SF-4
  extraction (§1) non-optional rather than a nice-to-have — without it,
  this handler is a third hand-copy of the composition by construction.
- **`GET /api/project-plans/groups?project_id=`** — lists proposals (all
  `value_groups` rows for the project, most recent `run_id` by default,
  `created_at DESC, id DESC` per §9.2's ordering convention — confirmed this
  project's established idiom at `PROJECT-CONTEXT.md:415`, "ORDER BY
  created_at ASC/DESC, id ASC/DESC").
- **`POST /api/project-plans/groups/:id/review`** `{status}` — the
  approve/dismiss action (product-owner's scope for exact affordances, but
  the write is a `status` transition on the existing `value_groups` row,
  never a delete/recreate).

All three are new production call sites and each needs a single-writer
guard entry per §4.

---

## 6. Feasibility, effort, gotchas

### Feasibility
Not "as simple as it looks." Three real coupling points beyond the schema:
1. The mechanical pre-group stage needs read access to trunk-commit
   metadata (initiative-slug references) that today lives inside
   `detectTrunkDrift`'s output and `intake-scan.js`'s slug/branch
   convention (`effort/<slug>`, "Merge effort/<slug>: ..." — confirmed at
   `intake-scan.js:19-24,139-165`) — the pre-group function needs those same
   facts without a second git-walking implementation. `assembleValuePool`'s
   `units` array is the DEC-16-compliant source for this (each unit already
   carries its `value_source`/`value_ref`/whatever label metadata the pool
   composer attaches) — confirm in the technical plan exactly which unit
   fields already carry a resolved slug vs. which require a second read of
   `intake-scan.js`'s output.
2. Hierarchical rollup reuses `focus-summary.js`'s shape "by analogy" only —
   it is not a shared function, so this is new code, not new config over old
   code, and it inherits §9.8's own case study (`value-summary.js` copied
   `focus-summary.js`'s cap and dropped the decompose+disclose halves) as a
   named, live risk on the exact same file family.
3. `value_group_members` foreign-keys into whatever `unitKey` identity
   `assembleValuePool` produces — if a unit's underlying source row changes
   shape between the grouping run and a later render (e.g. a claimed unit
   disappears from the live pool), the member row is now dangling. This is
   a new instance of the class §9.8 already names ("stale-but-not-yet-
   regenerated unit... never a silent absence") — the render path must
   resolve each member against the *live* pool/claims state and mark a
   vanished member distinctly, never silently shrink the group.

### Effort
**L.** Reasoning: two new tables + a join table, a genuinely new synthesis
module with two/three internal stages, a route surface (3 endpoints), a
CONSUMERS registration, at least 4-6 new single-writer-guard test cases, the
SF-4 extraction (touches 2 existing route handlers + removes/replaces
nothing but adds a new shared module + its own tests), and a client
review/approval surface. This is comparable in shape to the Slice 2 build
(coverage-on-demand), which the run-plan itself calls "largest and
least-specified of the four slices" — and Slice 2 alone produced 4 QA-count
events against this file family.

### Dependencies & order
1. Schema first (`value_groups`, `value_group_members` in `db.js`) — nothing
   downstream compiles/tests against real rows without it.
2. `CONSUMERS` registration in `value-ledger.js` — before `value-groups.js`
   is written, so the registry addition and its first real consumer land in
   the same commit (never registry-then-consumer-later, never the reverse).
3. SF-4 extraction (`value-coverage-probe.js` + both route call sites
   updated) — before the new `/groups/propose` route is written, so that
   route's gate check is `buildProbeCoverage`'s **third** call site from
   day one, not a fourth hand-copy that gets "cleaned up later."
4. `value-groups.js` (mechanical stage, independently testable without an
   LLM) — before the refinement stage, so the deterministic half has its own
   green tests before any spawn-mocking is needed.
5. Refinement stage (sonnet call via `summaryModel("grouping")`) — depends
   on (4)'s output shape being stable.
6. Route surface — depends on (3) and (5).
7. Single-writer guards — added alongside each new writer in the same
   commit that introduces it (not batched at the end).
8. Client review/approval UI — depends on the route surface's real response
   shapes, not a mocked contract (per this project's own repeated §9.1/§9.3
   lesson: build against the real shape, not a hand-typed stub).

### Gotchas (this project's own catalog, cited directly)
- **§9.1 rogue re-derivation**: the group's `summary_sentence` and member
  rollup must be computed once server-side. If a client-side "member count"
  or "coverage-of-members" figure is ever rendered, it must come from the
  same `value_groups`/`value_group_members` read, never a second client
  computation — this exact sub-form ("a second copy of the
  grouping-membership or rollup formula") is named explicitly in the
  request-brief's Known-variant-relevance section.
- **§9.6 NON-ATOMIC REBUILD**: not a risk at introduction (new tables, no
  rebuild — §2.3), but a live trap for the *first* fix-round that widens the
  `status`/`refinement_state` CHECK. Do not hand-roll that rebuild; call
  `rebuildTableAtomically` (`server/db.js:1664`).
- **§9.7 HAND-SCOPED STRUCTURAL SCAN**: both the `CONSUMERS` array
  (`value-ledger.js:70-74`) and the `assertSingleHome` consumer maps in
  `single-writer-guard.test.js` (lines 387-483) are hand-typed lists that
  will not automatically notice `value-groups.js` — each needs an explicit,
  same-commit addition, not a "it'll get picked up" assumption.
- **§9.2 chronology-ordering**: `server/__tests__/chronology-ordering.test.js`
  hand-types its `filesToScan` list (confirmed pattern at
  `PROJECT-CONTEXT.md:1332-1347`, "the value-ledger build adds a new
  `server/lib/value-pool.js`... born outside the scan's scope"). Any
  time-ordered query `value-groups.js` writes (e.g. "most recent run_id",
  "groups created since X") must sort by `created_at` (id tiebreak) **and**
  the new file must be added to that scan's file list in the same commit,
  or it ships unguarded while the suite stays green.
- **§9.8** (this surface's own named standing trap): the `refinement_state`
  discriminated-state design in §2.2 is the concrete answer requested — the
  build must not collapse `pending`/`zero_members`/`failed` into
  `name IS NULL` heuristics anywhere (server or client).
- **File-header compliance**: every new file (`value-groups.js`,
  `value-coverage-probe.js`, any new route file, any new client
  component/hook) needs the exact header format used at
  `value-coverage.js:1-27` (file overview + `@author Son Nguyen
  <hoangson091104@gmail.com>`), verified before merge with
  `bash .claude/skills/file-headers/scripts/check-headers.sh` (currently
  passing clean on `master` — re-run after every new file lands, not just
  at the end).

### Verification hooks (existing tests that would catch a mistake)
- `server/__tests__/single-writer-guard.test.js` — the file to extend for
  every new write path (§4) and every new `CONSUMERS`/`assertSingleHome`
  registration (§3.2). This is the test that would catch a silent third
  hand-copy of `buildProbeCoverage` or an unregistered `value-groups.js`
  consumer.
- `server/__tests__/value-coverage-parity.test.js` (G2) — must keep passing
  unmodified after the SF-4 extraction; it is route↔tick parity and neither
  side of that comparison changes shape, only its internal composition
  moves into `buildProbeCoverage`. A new **route↔route** case (or the
  single-call-site guard proposed in §1.3) is the net-new coverage this
  slice adds.
- `server/__tests__/value-ledger.test.js` — closure/single-writer guard
  precedent to model `value_groups`' own "closure is the single writer"
  test on, per its own header comment (line 4, "and closure single-writer
  guard").
- `server/__tests__/db-migration.test.js` — the `GRANDFATHERED`/
  `UPGRADE_CASES`/`REBUILD_CASES` registries; `value_groups` needs **no**
  new entry now (§2.3), but the meta-test's registry-completeness scan is
  exactly what will fail loudly if a future fix-round tries to widen the
  `status` CHECK via a hand-rolled `ALTER TABLE` instead of
  `rebuildTableAtomically`.
- `server/__tests__/value-coverage.test.js` / `coverage-smoke.test.js` —
  exercise `coverageSnapshot`/`estimateEta` directly; unaffected by the
  extraction (their imports of `../lib/value-coverage` are unchanged) but
  worth running to confirm `buildProbeCoverage`'s pass-through of
  `coverageSnapshot`'s contract stays byte-identical.
- No existing test file covers grouping — `value-groups.test.js` (or split
  `value-groups-mechanical.test.js` / `value-groups-refinement.test.js`,
  mirroring `value-summary.test.js`'s own split from
  `value-summary-tick.test.js`) is net-new and is QA's/tech-lead's to
  specify in the technical plan, not pre-existing coverage.

---

## Summary of new/edited files

**New:**
- `server/lib/value-coverage-probe.js` — `buildProbeCoverage` (SF-4 extraction)
- `server/lib/value-groups.js` — mechanical pre-group + LLM refinement + rollup orchestration
- `server/routes/value-groups.js` (or additions to `project-plans.js`) — route surface
- Client: new panel or `PlanLedgerPanel.tsx` extension (product-owner/architect to specify exact component)
- New test files: `server/__tests__/value-groups*.test.js`

**Edited:**
- `server/db.js` — `CREATE TABLE IF NOT EXISTS value_groups`, `value_group_members`, new prepared statements
- `server/routes/project-plans.js` — both coverage handlers call `buildProbeCoverage` instead of inlining the 4 steps
- `server/lib/value-ledger.js:70-74` — `CONSUMERS` array gains `"server/lib/value-groups.js"`
- `server/__tests__/single-writer-guard.test.js` — new guard cases (§4) + `assertSingleHome` consumer-map additions (§3.2) + SF-4 single-call-site guard (§1.3)
- `server/__tests__/chronology-ordering.test.js` — add `value-groups.js` to `filesToScan` if it issues any time-ordered query
- `PROJECT-CONTEXT.md` — SF-4 entry updated from "Open" to a build-outcome note once extracted (per this project's own doc-sync convention, `update-project-docs` skill)
