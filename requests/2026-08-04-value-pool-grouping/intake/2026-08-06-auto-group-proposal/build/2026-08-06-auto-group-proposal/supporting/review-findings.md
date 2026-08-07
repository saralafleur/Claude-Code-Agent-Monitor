# Build Review Findings — Value Pool Slice 3 (auto-group-proposal)

**Date:** 2026-08-06
**Reviewer:** `build-reviewer` (Step 6, adversarial diff review)
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor`
**Branch:** `effort/2026-08-06-auto-group-proposal` (uncommitted working tree over `d384249`)
**Diff reviewed:** `git diff HEAD` + 8 untracked files — 25 tracked files changed, 1751 insertions.

**Verdict: FIX BLOCKERS FIRST.** 16 blockers, 13 should-fix, 8 nits.

The suite is green (1865 server / 830 client, independently re-run). Every
finding below is invisible to that suite by construction. Four are live
product defects reproduced with probes against the shipped code; twelve are
`[M]`-marked MANDATORY guards that cannot fail.

---

## BLOCKERS

### BL-1 — Clicking "Auto-group" crashes the panel (`TypeError`)

`server/routes/project-plans.js:405-435` — all three success paths of
`POST /groups/propose` (`already_running`, `reused_unchanged`, `started`)
return `groups:` as raw `listValueGroupsForRun` rows, with **no `members`
key and no `member_availability_counts`**. Only `GET /groups`
(`:466-482`) enriches them.

`client/src/components/PlanLedgerPanel.tsx:869` does
`if (res.groups) setGroupsList(res.groups)` unconditionally, and the render
at `:1333`/`:1336` reads `group.members.length` and `group.members.map(...)`
with no guard:

```tsx
{t("planLedger.groups.membersLabel")}: {group.members.length}
```

→ `Cannot read properties of undefined (reading 'length')` on the very next
render, taking the whole Plan Ledger panel down. No client test clicks the
auto-group button (C-2 only inspects `disabled`), so nothing catches it.

**Fix:** either enrich the propose responses through the same
`resolveMemberAvailability` composition `GET /groups` uses (extract it — see
BL-14), or drop `groups` from the propose response entirely and let the
client re-`GET`. Add a C-case that clicks the button and asserts the list
renders.

---

### BL-2 — `rollupGroups` results are positionally mis-assigned; merged groups duplicate and one group's identity + members are destroyed

`server/lib/value-groups.js:727-753`. `rollupGroups` returns a **re-ordered,
shorter** array (merged entries first in `parsed.merges` order, then
unconsumed leaves), but `runGroupingPassAsync` maps it back positionally:

```js
refinedIdx.forEach((idx, i) => {
  orderedOutcomes[idx] = { ...orderedOutcomes[idx], content: rolled[i] || refinedLeaf[i] };
});
```

Reproduced against the shipped module (3 refined leaves A/B/C,
`{"merges":[[1,2]]}`):

```
rolled = [ {A, members:[k1,k2]}, {C, members:[k3]} ]
cluster 0 -> A ["k1","k2"]   (correct merge)
cluster 1 -> C ["k3"]        (B's row now carries C's name/summary/members)
cluster 2 -> C ["k3"]        (C persisted a second time)
```

So a rollup merge **destroys** one proposal, **duplicates** another, and
mis-attributes member unitKeys. `insertValueGroupMember`'s
`ON CONFLICT … DO NOTHING` (`server/db.js`) silently hides the resulting
duplicate member rows.

Knock-on: `persistPassResults:619`
`notSelected += cluster.memberUnitKeys.length - persistedMembers.length`
goes **negative** for the merged cluster (1 − 2 = −1), corrupting
`ungrouped_not_selected` and AC-3's accounting identity.

Completely untested — see BL-16 (E-4.1…E-4.4 seeds 3 units and never runs a
rollup).

**Fix:** have `rollupGroups` return an explicit mapping
(`{ content, absorbedClusterIds }` or `leafIndex -> mergedGroupId`);
persist each merged group **once**; give absorbed clusters a terminal
disposition rather than another group row; derive `notSelected` from the set
difference of unit keys, never per-cluster subtraction.

---

### BL-3 — Two new server test files write to the real dashboard DB

`server/__tests__/value-groups-mechanical.test.js` and
`server/__tests__/value-groups-refinement.test.js` contain **zero**
occurrences of `DASHBOARD_DB_PATH` (`grep -c` = 0 for both). Verified:

```
$ env -u DASHBOARD_DB_PATH node -e "console.log(require('./server/db.js').db.name)"
/Users/sara/.claude/agent-dashboard/dashboard.db
```

`value-groups-refinement.test.js` writes real rows
(`insertValueGroupRun.run("test-run-r2", …)`, `insertValueGroup(...)`,
raw `INSERT INTO value_groups`, `INSERT INTO value_group_runs … 'boot-crashed-e5'`)
and at `:365` calls `reconcileInterruptedGroupRuns(db)`, whose statement is
**unscoped by project**:

```sql
UPDATE value_group_runs SET state='failed', error_reason='interrupted_restart', completed_at=?
WHERE state = 'in_progress'
```

i.e. running `npm run test:server` flips any genuinely in-flight grouping run
in the user's production DB to `failed`. The three Slice-3 tables already
exist in that file today (rows currently 0), confirming the module has been
loaded against it unisolated.

**Root cause is in product code:** `server/lib/value-groups.js:510`
`const defaultDbModule = require("../db");` at module scope — the only module
in this family that does. `value-ledger.js`, `value-summary.js` and
`focus-summary.js` all take `dbModule` by DI, and this module's own comment
at `:504-509` claims the singleton "is never used by them."

This is the same class the round-1 fix round was reported to have cleaned
up (§9.4 FIX-ROUND-REGRESSION: the class was cured in the files the verifier
looked at, not in the two it didn't).

**Fix:** delete `defaultDbModule` and the test-only `insertValueGroup(runId, …)`
convenience export; export `insertValueGroupRow(dbModule, …)` instead and
have R-2/R-3 pass `{ db, stmts }` (R-5 already does). Set
`process.env.DASHBOARD_DB_PATH` before the first `require` in both files.

---

### BL-4 — Test-only seam in production code; `runGroupingPass` returns a Promise **or** a plain object depending on `opts`

`server/lib/value-groups.js:649-800`. `opts.failBatch` / `opts.failFirstBatch`
route to a synchronous `runGroupingPassSync` that also **fabricates a cluster
when none exists** (`:660-663`), documented as *"never reachable via any real
route — this is a test-only seam."*

That is §9.3's named form *"a fixture in a state no real call site can
produce."* R-5 `[M]` (failed-batch disclosure — `risk.md` §4.3's headline
guard) and R-6 exercise **only** this seam, so neither proves anything about
the production `refineBatch` failure path. The polymorphic sync/async return
is independently a footgun for any future caller.

**Fix:** delete the seam. Stub `refineBatch` / `runClaudePromptJson` via the
module-namespace patch technique P-6/P-7 already use, and make
`runGroupingPass` unconditionally `async`.

---

### BL-5 — An LLM outage permanently poisons the digest cache (§9.8 OVERLOADED-ABSENCE)

Reproduced against the shipped code with `DASHBOARD_FOCUS_INFER_MODE=heuristic`
(equivalently: Claude CLI absent):

```
clusters [{"s":"time","n":3}]
RUN state= completed  group_count= 1  digest set= true
GROUPS [{"id":1,"rs":"failed","name":null}]
```

`llmAvailable()` → false → `refineBatch` → `null` for every batch →
`persistPassResults:623` writes `state = 'completed'` (keyed **only** on
`clusters.length`, never on how many refined) with `input_digest` set and N
groups at `refinement_state='failed'`, `name=null`.

The route (`project-plans.js:414-427`) then digest-matches that run forever —
it only excludes `state === 'failed'`, and this run is `'completed'` — so
every subsequent click returns `reused_unchanged`. **The user can never
retry**, and the UI shows unnamed "Refinement failed" cards permanently.

Second §9.8 face, same code: `refineBatch` collapses *LLM off*, *spawn
failure*, *unparsable output*, and *no `groups` array* into one `null`, and
`value_groups` carries **no `error_reason` column at all** — so the failure
chip cannot say why. §9.8's acceptance criterion ("a consumer must never be
asked to reconstruct *why* something is absent from *what* is absent") is
unmet on both axes, in the slice that introduced `completed_zero_groups`
specifically to honour it.

**Fix:** (a) do not persist `input_digest` when zero clusters refined, or
land the run in a distinct terminal state; (b) add a per-group failure
discriminator so "unavailable" ≠ "unusable output"; (c) never reuse a run
whose `group_count > 0` but refined count is 0.

---

### BL-6 — S-2 `[M]` CHECK-vs-registry parity never reads a registry, and its own comment admits it

`server/__tests__/db-migration.test.js` (S-2). The whole test is four
`assert.ok(sql.includes("CHECK(state IN"))`-style substring checks. It never
imports `value-groups.js`; not one of `GROUP_RUN_ROW_STATES`,
`GROUP_REFINEMENT_STATES`, `GROUP_REVIEW_STATES`, `VALUE_SOURCES` appears in
the file. Its own body says:

```js
// When registries exist, we'll verify: CHECK values == GROUP_RUN_ROW_STATES
// That's where the real parity check will happen (in the code review)
```

That is verbatim §9.3's *"a 'verified elsewhere' comment standing in for an
assertion."* The plan's own red-first procedure ("add a 5th value to
`GROUP_REFINEMENT_STATES` **without** widening the CHECK → S-2 names the
mismatch") **passes green today**.

**Fix:** parse the literal list out of each `CHECK(<col> IN (...))` in
`sqlite_master.sql` and `deepEqual` the sorted result against the four
imported registries.

---

### BL-7 — R-7 `[M]` partition biconditional is a tautology over its own INSERT

`server/__tests__/value-groups-refinement.test.js:135-172`. The test inserts
rows itself with `state === "refined" ? "Test Name" : null` and then asserts
exactly that relation back. **No product code is exercised.** Deleting
`insertValueGroupRow`'s entire `isRefined ? … : null` logic
(`value-groups.js:515-523`) cannot make R-7 fail.

This is the executable form of "the client must never infer state from
NULL-ness" — the guard the plan called out as load-bearing.

**Fix:** produce the four states through the product writer
(`runGroupingPass` / `insertValueGroupRow`) and assert the biconditional on
what the writer emitted.

---

### BL-8 — R-9 `[M]` (§9.1's 2nd exposure, PM-4) is missing both mandated halves

`server/__tests__/value-groups-refinement.test.js:191-215`.

1. **No anchored exempt-set assertion.** PROJECT-CONTEXT §9.1's own
   2026-08-06 note says this guard *"gets the anchored **exactly**-this-exempt-set
   form or it is decoration."* There is no
   `deepEqual(Object.keys(GROUPING_UNCOMPARED_FIELD_GUARANTORS), [])`, so the
   exempt set can grow silently and R-9 still passes. Note also that because
   `computeGroupingDigest` whole-object-stringifies (`stableStringify`), the
   key-walk **cannot fail for any key** — the anchored empty-set assertion is
   the only load-bearing thing R-9 could carry, and it is the one omitted.
2. **The mandated structural scan does not exist.** Task 5 required *"a
   structural scan that `buildGroupingPrompt` reads **only** `groupingFacts`
   fields (never raw unit)"*. `grep -rn "buildGroupingPrompt" server/__tests__/`
   returns only two incidental mentions inside `single-writer-guard.test.js`'s
   export lists. This is the direct successor to `value-summary.js`'s A2 scan
   that occurrence 7 proved necessary, and it was not built.

---

### BL-9 — The client never renders `member_availability_counts`; it re-derives the count. C-1 `[M]` cannot catch it.

`client/src/components/PlanLedgerPanel.tsx:1333`:

```tsx
{t("planLedger.groups.membersLabel")}: {group.members.length}
```

`member_availability_counts` is typed (`types.ts`), fetched, and **never
read anywhere in the client**. That is exactly the §9.1 re-derivation AC-1
and C-1 exist to prevent — and the component's own comment 40 lines above
says *"no client-side member count."*

C-1 `[M]` cannot detect it, because all three of its count assertions are
vacuous (`PlanLedgerPanel.groups.test.tsx:149-156`):

```tsx
const availableText = screen.queryByText(/available.*2/i);   // null when absent
expect(availableText).toBeDefined();                          // expect(null).toBeDefined() PASSES
```

`queryBy*` returns `null` on miss and `expect(null).toBeDefined()` passes.
Same shape at C-5:311. C-1's remaining check
(`querySelectorAll("[data-availability-state]").length >= 3`) counts the
4 member chips, so it also passes with all three states rendered identically.

**Fix:** render the server's three counts verbatim; switch the assertions to
`getByText` / `expect(x).not.toBeNull()`; assert the three states render
distinguishably (distinct text or distinct class), not merely that an
attribute exists.

---

### BL-10 — C-8 `[R]` (the N2 fail-open locale guard) asserts nothing about locale keys

`client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx:402-428`.
It builds a `requiredKeys` array, loops over it, and the loop body is:

```tsx
for (const keyPath of requiredKeys) {
  expect(localeFile).toBeDefined();   // keyPath is never used
}
```

Its own comment: *"This test belongs in the i18n spec location (not here…)
For now, a smoke test."* The plan's red-proof ("delete one `ko` key → C-8
fails naming that key and locale") passes green.

Compounding it:
- **No test anywhere anchors the six client registries.** The only anchor is
  a `console.warn` at `PlanLedgerPanel.tsx:73-81`, which can never turn a
  test red — a guard that is structurally incapable of failing.
- `client/src/lib/types.ts:2863` tells the reader *"See registries.ts for the
  anchored exemption-set assertions guarding these against silent drift"* —
  **`client/src/lib/registries.ts` does not exist.** (§9.1's standing check:
  a comment asserting a guard exists is a checkable claim.)

**Fix:** walk all six registries × four locales, resolve each `planLedger.*`
key path, and assert presence; add the six anchored `deepEqual`s in a real
test; create `registries.ts` or delete the reference.

---

### BL-11 — C-4 computes the only assertion that could catch a missing key, and never asserts it

`PlanLedgerPanel.groups.test.tsx:281`:

```tsx
const hasPlanLedgerKey = /planLedger\.[a-zA-Z]/i.test(bodyText); // should NOT match…
expect(hasProjectDetailKey).toBe(false);                          // …but only THIS is asserted
```

Every Slice-3 key lives at path `planLedger.*` **inside** the `projectDetail`
namespace, so an unresolved key renders as `planLedger.groups.foo` — which
`/projectDetail\./` (the only regex asserted) cannot match. C-4 is
structurally incapable of detecting the class it names. `hasPlanLedgerKey`
is dead code.

---

### BL-12 — PO §5's "no second control" fence was inverted; the shared identifier is now duplicated, and C-2 cannot see it

`PlanLedgerPanel.tsx:1268` gives the new button
`className="prioritize-now-button text-[11px] …"`.

`prioritize-now-button` is a **`data-test` hook** everywhere else in the
client (`PlanLedgerPanel.tsx:1248`, `PlanLedgerPanel.test.tsx` ×6,
`ProjectDetail.test.tsx:925`) and is **not a CSS class in any stylesheet**.
It was put into `className` solely so
`b.classList.contains("prioritize-now-button")` in C-2 resolves.

Net result:
- there are now **two** controls carrying the identifier the fence said must
  stay unique (snapshot: `data-test="prioritize-now-button"` at `:6987`,
  `class="prioritize-now-button …"` at `:6994`);
- the task list's own done-check `grep -c "prioritize-now-button"
  client/src/components/PlanLedgerPanel.tsx # exactly 1` returns **3**;
- C-2's "exactly one" assertion de-dupes by `className` among buttons whose
  accessible name matches `/auto-group|propose/i` — which excludes the
  existing "Prioritize now" button — so it can never detect the duplication.

**Fix:** drop the fake class; select the new button by its own
`data-test="auto-group-button"`; make C-2 assert
`document.querySelectorAll('[data-test="prioritize-now-button"]').length === 1`
plus the new button's own presence.

---

### BL-13 — `POST /groups/propose` awaits the entire LLM pipeline inside the request

`server/routes/project-plans.js:429-433`:

```js
const { run, groups } = await runGroupingPass(dbModule, projectId, units, factsByKey, { digest });
res.status(202).json({ outcome: "started", run, groups, gate: "ready", coverage });
```

Every sonnet call (N batches + one rollup) happens inside one HTTP request.
Slice 2's sibling deliberately fire-and-forgets
(`runCoverageDrain(dbModule, projectId, { broadcast }).catch(() => {})`, `:323`).
Consequences:

- On a real pool this holds the connection for minutes; any proxy/browser
  timeout leaves an `in_progress` row that **only a server restart clears**
  (`reconcileInterruptedGroupRuns` is boot-only, and there is no group-level
  WS broadcast — WATCH-S3-E).
- `202 started` is returned for a run that is already terminal, so the
  documented `in_progress` → poll → `completed` lifecycle never occurs in
  production.
- No test exercises a real concurrent second POST: TT-f / TT-g / E-1.3 all
  seed `in_progress` with a direct `UPDATE` (see BL-15).

**Fix:** write the run row `in_progress`, kick the pass fire-and-forget with
`.catch()`, return `202` immediately, and let `GET /groups` poll — the shape
the design, the states, and the client's `runState` labels were all written
for.

---

### BL-14 — G-2 cannot detect the thing SF-4 exists to prevent; N-1 and N-3 are hand-scoped (§9.7)

**G-2** (`single-writer-guard.test.js:790-819`) counts
`buildProbeCoverage(` occurrences in the routes file and asserts `=== 4`.
Its own red-proof is *"inject a fourth hand-copy of the 4-step composition
inline into a handler."* An inline hand-copy calls
`assembleValuePool` / `enrichPoolAltitudes` / `coverageSnapshot` — **not**
`buildProbeCoverage` — so the count stays at 4 and G-2 stays green. The
mandated brace-walked "exactly once in each handler body" form is gone, and
with it T7-C1 and T7-C2 have no working successor: **nothing anywhere
asserts the composition's own lines don't reappear inline in the routes
file.** That is the SF-4 defect the whole extraction was built to close,
now unguarded.
*Fix:* additionally assert the routes file contains **zero**
`enrichPoolAltitudes(` and **zero** `coverageSnapshot(` occurrences, and
brace-walk per handler.

**N-1** (`value-groups-api.test.js:283-299`) scans `value-groups.js` **only**.
The task list mandated *"`value-groups.js` + four route handlers
(brace-walked as in G-2)"*.

**N-3** (`:316-332`) matches `/review_status\s*=\s*['"]claimed['"]/`. The
actual write path in this codebase is
`dbModule.stmts.setValueGroupReviewStatus.run("claimed", …)` — a route
passing the literal as an **argument** matches nothing. The scan is blind to
its own product's write shape; the plan's red-proof injects an assignment
form that no production code uses.

---

### BL-15 — The §9.8 truth table shipped as nine independent `it()`s with no spawn counts, and four rows never construct their own prior state

`server/__tests__/value-groups-api.test.js:150-251`. Mandated: *"ONE test,
ONE 9-row table (not 9 isolated branches) — per row assert: outcome, HTTP
status, **exact spawn call count**."* Built: nine separate `it()`s, **zero**
spawn assertions anywhere, no `__injectSpawnForTest`.

Row by row:

| Row | Claim | As built |
|---|---|---|
| **TT-d** `[M]` | prior run `failed` + coverage false | **never creates a prior run** — byte-equivalent to TT-b |
| **TT-h** `[M]` | prior run `completed_zero_groups` + digest match | 3 same-day detours always yield one time cluster, so the run is `completed` (probe-verified) — byte-equivalent to TT-e. The "row that fell out of §6" is untested |
| **TT-i** `[M]` | prior `in_progress` + coverage false → **gate beats `in_progress`** | **never creates an `in_progress` run** — byte-equivalent to TT-b. The ordering claim, which is this row's entire purpose, is unproven |
| **TT-read** `[M]` | `run.state === "in_progress"` **AND** `gate === blocked` — "two both-true facts in two fields" | asserts only `res.body.run` is truthy and the gate; the run is in fact `completed`. Half the mandated assertion dropped |
| TT-f / TT-g / E-1.3 | concurrent-request behaviour | seeded by direct `UPDATE … SET state='in_progress'`; no concurrency is exercised (see BL-13) |

---

### BL-16 — The entire route suite runs with the LLM off, so every `refined`-path assertion is skipped by its own `continue`

`server/__tests__/value-groups-api.test.js:27` sets
`process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"`, so no group can ever
reach `refinement_state === "refined"` (probe-verified, BL-5). Therefore:

- **E-1.4 `[M]`** (AC-2's bar — *"every group `refined` with all fields
  non-NULL"*): `if (group.refinement_state !== "refined") continue;` — the
  loop body **never executes**.
- **RT-3**: same `continue` — never executes.
- **RT-1** (*"distinct values in stub response match GET exactly"*): there is
  no stub and no per-field group comparison; the sole assertion is
  `deepEqual(getRes.body.run, res.body.run)`.
- **N-4 `[M]`** (*"adversarial LLM response, strict whitelist"*): **no
  adversarial payload is ever constructed.** It posts normally and asserts no
  group is `claimed` — which nothing in the system can set. The mandated
  `parseGroupingOutput({… status:"claimed"})` → assert `"proposed"` →
  persist via `runGroupingPass` → assert the **DB row** reads `"proposed"`
  is absent.
- **E-4.1…E-4.4 `[R]`** (*"Hierarchical decomposition (45+ units, batching +
  rollup)"*): seeds the **default 3-unit** fixture and asserts only that
  `run` exists and `batch_count !== undefined`. No 45 units, no
  `batch_count > 1`, no `spawn === batch_count + 1`, no no-cluster-split
  check, no AC-3 accounting identity. **This is why BL-2 shipped.**

**Fix:** stub `runClaudePromptJson` by patching the `focus-inference` module
namespace (the technique P-6/P-7 already use) so the `refined` path is
genuinely exercised, then restore the dropped assertions.

---

### BL-17 — §9.3's mandatory sweep fails: three new `assert.ok(true` in the diff

The standing rule requires `grep -rn "assert.ok(true" server/__tests__/` to
return 0. This build adds three:

- `server/__tests__/single-writer-guard.test.js:796` — `"Routes file not created yet - expected RED"`
- `server/__tests__/value-groups-refinement.test.js:319` — D-3, whose entire body is `assert.ok(true, "D-3 is covered by D-4")`
- `server/__tests__/value-groups-api.test.js:287` — N-1's `if (!fs.existsSync(groupsFile)) { assert.ok(true, …); return; }` escape hatch

(The fourth hit, `value-summary-interrupted-boot.test.js:133`, is
pre-existing.)

---

## SHOULD-FIX

1. **`GET /groups` assembles the pool twice.** `buildProbeCoverage`
   (`:459`) calls `assembleValuePool`, then `:466` calls it again for
   `liveUnits` — two independent snapshots of the same pool in one response,
   at double the cost. Thread the units out of `buildProbeCoverage` (or hoist
   the call).
2. **approve/dismiss never check the group belongs to `:projectId`**
   (`project-plans.js:485-508`). `POST /api/project-plans/<any-project>/groups/<id>/approve`
   mutates any group in the DB. Join through `value_group_runs.project_id`
   and 404 on mismatch.
3. **The 409 handling comment is false as built.** `api.ts:569-575`'s
   `request()` throws on any non-2xx, so `handleProposeGroups`'s claim
   (*"A `blocked_coverage_incomplete` response still carries a full
   `run`/`gate`/`coverage` snapshot the panel reuses as-is"*) never happens —
   the body is discarded and a raw error banner is shown. AC-6/AC-7's ETA
   reuse is unimplemented and untested.
4. **§9.8 at the client:** a failed `GET /groups` leaves `groupsRun === null`,
   rendering identically to "no groups yet". "Endpoint down", "never
   attempted", and "completed with zero groups" collapse into one view —
   undoing the server-side `not_attempted` design in the last mile. Add a
   distinct load-error state. (The silent `catch` itself is correct SF-9
   posture; the missing discriminator is not.)
5. **`handleApproveGroup` / `handleDismissGroup` lack the
   `currentProjectIdRef` in-flight guard** every other handler in the file
   carries.
6. **`notSelected` is per-cluster arithmetic over an over-generating
   pre-grouper.** `mechanicalPreGroup` deliberately puts a unit in several
   clusters (M-5 asserts this), so AC-3's identity
   (`ungrouped_no_signal + ungrouped_not_selected + Σ member_count == pool_size`)
   is arithmetically wrong whenever any unit is multi-clustered —
   independently of BL-2. Derive from set differences over unit keys.
7. **`parseGroupingOutput` makes `rationale` optional** (`:371-374` requires
   only `name` + `summary_sentence`) while `insertValueGroupRow` writes
   `(content.rationale) || null` and R-7's biconditional demands all three
   non-NULL when `refined`. A model that omits `rationale` produces a
   `refined` row with `rationale = null` — the biconditional breaks in
   production and R-7 (BL-7) cannot see it.
8. **P-2/P-3/P-5 in `value-coverage-probe.test.js` are weaker than mandated.**
   P-3 `[R]` asserts `result.requested_at === null || typeof … === "string"` —
   a tautology — and never seeds a sweep-state row, so the fallback it names
   is unproven. P-5 `[M]`'s own comment says *"This is a smoke check that the
   field exists"* against a mandate of *"anchor to a literal fixture-derived
   number."* P-2 `[M]` never seeds a **differing** `coverage_requested_at`,
   so its "the passed value wins" claim rests on `null` vs. the literal.
9. **C-7 (StrictMode) is synchronous against async mocks.** Nothing is
   awaited, so it asserts only that a statically-rendered
   `<div role="region">` exists and `textContent.length > 10` — both true of
   the empty state. The "renders correctly after setup→cleanup→setup" claim
   is unproven.
10. **`E-5` in `value-groups-refinement.test.js:360`** is titled *"Boot-hook
    reconciliation … ensuring it's called at boot"* but only calls the
    function directly — a duplicate of R-10 with a title that overstates it.
    (The real boot proof is the separate `value-groups-interrupted-boot.test.js`.)
11. **The four new endpoints are absent from the OpenAPI spec.**
    `server/openapi-extra/project-plans.js` documents `/pool` and `/health`;
    Task 10 mandated documenting the four `/groups` routes. (Slice 2's
    `/coverage` is also still undocumented — the CONTRACT-SPEC-DRIFT
    candidate class compounding.)
12. **`defaultScanTargets` hard-codes a directory list inside the §9.7
    cure** (`helpers/single-home.js`): `server/lib`, `server/routes`, `bin`,
    `server/index.js`. `mcp/src`, `scripts/`, `desktop/` are unscanned. The
    helper is otherwise correct and genuinely fail-closed — but its scope is
    a hand list, which is the pattern it exists to cure. At minimum, state
    the bound in the JSDoc.
13. **`value-groups.js:241-248`'s string-`cachedAltitude` branch** copies one
    string into both `project_level` and `stakeholder_level`. The only
    production caller (`resolveGroupingFactsByKey`) always passes an object;
    this branch exists solely for R-9's fixture — another test-shaped path in
    product code (same family as BL-3/BL-4).

---

## NITS

- **M-6** compares only sorted `clusterId`s, not the mandated full
  sorted-output `deepEqual` on membership.
- **M-8** is `typeof === "function"` plus a `mechanicalPreGroup.toString()`
  substring scan. `.toString()` returns the function body only, so the
  module-level `require("../db")` it is nominally guarding against (BL-3) is
  invisible to it by construction.
- **R-13**'s regex
  `/try\s*\{[\s\S]*?reconcileInterruptedGroupRuns\([\s\S]*?\}\s*catch/` is
  lazily quantified across the whole file — any `try {` before and any
  `} catch` after satisfies it.
- `PlanLedgerPanel.groups.test.tsx:10` imports `rerender` from
  `@testing-library/react`, which exports no such name (`fireEvent` and
  `within` are also imported and unused).
- `planLedger.proposeOutcome.*` and `planLedger.gateState.ready` exist in all
  four locales but nothing renders them (`proposeOutcome` is only passed to
  `warnIfOutOfRegistry`). Dead keys, or a missing affordance.
- `db.js`'s `listValueGroupMembersForRun` orders by `m.id ASC` on a table
  with no `created_at` — benign today, but it is a row-id-as-order query
  (§9.2) with no `GRANDFATHERED_QUERIES`-style note.
- `value-groups.js`'s `GROUPING_UNCOMPARED_FIELD_GUARANTORS` docblock claims
  every key "necessarily participates in the digest." True as written, but
  it is a physical-impossibility claim of exactly the shape §9.1's 2026-08-05
  lesson says must be backed by the loop that proves it — see BL-8.
- `UNGROUPED_REASONS`'s `"not_selected_by_refinement"` is exported and
  counted numerically but never used as a `reason` value on any object;
  `mechanicalPreGroup` always emits `"no_shared_signal"`.

---

## What was checked and is clean

- **Scope:** no unexplained edits. All 25 tracked + 8 untracked paths map to
  Tasks 1-10; README / ARCHITECTURE / PROJECT-CONTEXT updates are Task 10
  deliverables.
- **File headers:** `bash .claude/skills/file-headers/scripts/check-headers.sh`
  exits 0.
- **Schema (§9.5/§9.6):** three plain `CREATE TABLE IF NOT EXISTS`, no
  `ALTER`, no `REBUILD_CASES`/`UPGRADE_CASES` entry — correct and correctly
  asserted by S-3/S-4.
- **Negative proof, behaviourally:** grouping genuinely never writes
  `value_claims` (confirmed by read and by E-2.2's before/after counts). The
  *guards* over it are under-scoped (BL-14), but the product code is right.
- **P-6 and P-7** are now genuine behavioural spies against the real
  `valueCoverage` namespace object — the round-2 repair held and is real by
  direct read.
- **`assertConsumerScopeDerived` (D2, §9.7)** is real, derived, and
  fail-closed (throws, never `continue`), and is wired to all four
  registration axes (G-3, G-D2 ×2, G-D2b). This is the strongest thing in the
  diff.
- **`CONSUMERS`** widened to 4 entries with the declaring-comment growth rule
  widened in the same hunk (BO-3) — correctly done.
- **G-7 / G-8** single-home and writer-statement guards are real and
  correctly enumerate both the route and the boot-hook consumer.
- **T7 deletion:** `project-plans-api.test.js` lost 108 lines; `grep "T7 (SF-4)"`
  returns 0; `value-coverage-parity.test.js` is untouched (canary intact).
- **`localDayLabel` reuse** rather than a second day-bucketing constant —
  correct §9.1 posture, and the export was added rather than the formula
  copied.
- **`MAX_UNITS_PER_GROUPING_PROMPT`** cites the measured 182-unit
  distribution in its own declaring comment, per §9.8's corollary.
- **i18n:** all keys the component renders resolve in all four locales
  (including the `_one`/`_other` plural forms for `ungroupedUnitCount`).
  The *guard* over that is vacuous (BL-10/BL-11); the keys themselves are
  complete today.

---

## Catalog-entry attribution

| Finding | Catalog id |
|---|---|
| BL-2, BL-9 | **§9.1 DERIVED-DUAL-VIEW** (occurrence 8 candidate — a re-derivation shipped in the consumer, exactly the "consumer #2 appears" moment) |
| BL-4, BL-6, BL-7, BL-8, BL-10, BL-11, BL-15, BL-16, BL-17 | **§9.3 VACUOUS-GUARD** — 9 events in one diff, 12 counting the should-fix items. Beats the 2026-08-05 record of nine. Every one is `[M]` or plan-mandated |
| BL-3 | **§9.4 FIX-ROUND-REGRESSION** — the DB-isolation class was reported cured in round 1; two files still carry it |
| BL-5 | **§9.8 OVERLOADED-ABSENCE** — two faces, in the slice that introduced `completed_zero_groups` to honour this entry |
| BL-14 | **§9.7 HAND-SCOPED STRUCTURAL SCAN** — G-2/N-1/N-3 each enumerate their own blind spot |
| SF-11 | CONTRACT-SPEC-DRIFT (candidate) |

**Note for the catalog:** §9.3's own 2026-08-05 finding — *"being warned
about this entry does not reduce its incidence"* — reproduces again here, and
the count that matters is per-*gate*: the verifier caught P-7 and cleared the
rest; every finding above survived that pass.
