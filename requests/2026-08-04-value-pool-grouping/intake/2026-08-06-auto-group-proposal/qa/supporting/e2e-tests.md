# E2E / API-contract test design — Value Pool Slice 3 (auto-group-proposal)

> Authored by `qa-e2e-architect`. Change under evaluation is **NOT YET
> BUILT** — this is a forward, test-first design, grounded in
> `qa/change-brief.md`, `technical-plan.md` §3/§4/§5/§6/§7/§8/§11/§12, and
> `pm-plan.md` PM-1/PM-2/PM-4/PM-6. This is the thin, wired-up-flow layer
> over the unit layer (`value-groups-mechanical.test.js`,
> `value-groups-refinement.test.js`, `value-coverage-probe.test.js`, and the
> component-level cases in `PlanLedgerPanel.groups.test.tsx`) — it proves the
> flow really works end to end over real HTTP against a real DB, not every
> permutation of clustering/refinement logic.

## 0. What this project's "E2E" is (grounding, reused verbatim from the two prior Slices' own QA passes)

No Playwright/Cypress/browser-automation harness exists in this repo. This
project's "E2E" is: **boot the real Express app (`createApp`/`startServer`
from `server/index.js`) against a real throwaway SQLite file, drive it over
real HTTP.** Precedent files doing exactly this on this file family:
`project-plans-api.test.js`, `value-coverage-parity.test.js`,
`value-summary-interrupted-boot.test.js`. Slice 3 introduces **no WS
component** to this layer — confirmed live: `technical-plan.md` names
**WATCH-S3-E** explicitly ("No group-level WS broadcast in v1 — the panel
refetches on the existing `value_altitudes_updated` message and on its own
`propose` response"), so unlike Slice 2's coverage-request-e2e spec, no
`ws` client is needed here; every group-surface assertion is plain
request/response.

**Bucket/tag convention finding (unchanged from Slices 1/2):** no
smoke/regression tag system, no serial-vs-parallel bucket split exists on
this project. `npm run test:server` (`node --test server/__tests__/*.test.js`,
one file = one isolated child process, sequential within a file) and
`npm run test:client` (`vitest run`) run unconditionally in CI. The de-facto
bucket is **one named spec file per behavioral shape**, with a MANDATORY
named-file convention for the single most load-bearing cross-layer proof
(precedent: `value-coverage-parity.test.js`, `ledger-metrics-parity.test.js`,
Slice 2's own `coverage-request-e2e.test.js`). This design follows that
convention.

**Fixture technique reused, not reinvented:** seeding a non-empty Value Pool
without a live git repo, via `stmts.upsertDetourDisposition.run(...)`
(`value-coverage-parity.test.js`'s `seedProjectWithDetourPool`) — the detour
tier reads `detour_dispositions` directly, no git walk required — combined
with `stmts.upsertValueUnitSummary.run(...)` to pre-cache every unit's
altitude text so `coverageSnapshot.complete === true` **without** running a
real tick or spawning anything for altitude generation. This is the cheapest
honest way to reach "100% coverage" as a precondition, and it is already
proven live on this exact file family.

---

## 1. Flows to cover

1. **The full proposal flow, gate-to-render, in one continuous seeded state**
   (AC-1/AC-2/AC-4/AC-6/AC-7's server half): a project sits below 100%
   coverage → `POST /groups/propose` is rejected `409
   blocked_coverage_incomplete` carrying the full `coverageSnapshot` → the
   pool is brought to 100% (pre-cache every unit) → `POST /groups/propose`
   now returns `202 started` → `GET /groups` (polled) shows the run
   transition `in_progress` → `completed`, with named clusters persisted as
   `refined` groups carrying all four fields (name, summary_sentence,
   rationale, members) with **zero real spawn** (a stubbed `runClaudePromptJson`
   spawn via the existing `__injectSpawnForTest`/`fakeSpawn` idiom).
2. **Human review is pure bookkeeping** (AC-5, and §11.4's negative proof
   made behavioral): approve one proposed group, dismiss another → `GET
   /groups` reflects `review_status`/`reviewed_at` changed on exactly those
   two rows, nothing else → `value_claims` row count is byte-identical
   before and after the entire flow (propose → refine → approve → dismiss)
   → no plan/plan-item row was touched.
3. **Digest reuse skips the LLM entirely on an unchanged pool** (AC bearing
   on PM-4/DEC-S3-6): call `POST /groups/propose` twice against the same
   unchanged pool → second call returns `200 reused_unchanged` with the
   first run's groups, and the injected spawn's call counter is unchanged
   between the two calls (never incremented a second time).
4. **Hierarchical decomposition actually decomposes** (AC-3): seed a pool
   that genuinely exceeds `MAX_UNITS_PER_GROUPING_PROMPT` (per the plan's own
   §5.3, sized off the same 40-unit measured budget as
   `MAX_UNITS_PER_PROMPT`) → `POST /groups/propose` → completed run has
   `batch_count > 1`, one rollup spawn call beyond the per-batch calls, no
   cluster ever split across two batches, and `ungrouped_no_signal` /
   `ungrouped_not_selected` counts on the run row are surfaced through `GET
   /groups`'s `run` object — not silently dropped.
5. **Crash-recovery at boot** (`reconcileInterruptedGroupRuns`, PM's
   DEC-S3-13, §5.6): a `value_group_runs` row is left `in_progress` (crafted
   directly in the DB, simulating a process death mid-run, *before* the app
   is booted) → the app boots → the interrupted row is flipped to `failed` /
   `error_reason='interrupted_restart'` at boot, not on first request → `GET
   /groups` shows the run as `failed` (a real, distinguishable state), never
   a permanent "running" spinner → a fresh `POST /groups/propose` against the
   same project is **not** blocked by the dead row and starts a genuinely new
   run.
6. **Read-time drift**: propose a group with several members → **before**
   any human review action, an out-of-band claim is written for one member
   (a different actor claiming the same unit, exactly the race PM-1 names) →
   `GET /groups` (a fresh read, no cache) shows that one member's
   `availability: "already_claimed"` while untouched members remain
   `available`, and a member whose underlying pool unit is separately removed
   from the live pool (e.g. its `detour_dispositions` row deleted, modeling
   "reattributed / discarded") shows `no_longer_in_pool` — proving the
   precedence rule (claim beats live-pool-presence) end to end over a real
   `GET`, and proving the **partition** property: every member row lands in
   exactly one bucket, and `member_availability_counts` sums to the member
   row count. Approving that group afterward is still pure bookkeeping (ties
   back to flow 2) — the drifted member is not silently dropped from the
   response nor blocks the approve action.

**Explicitly not re-covered here** (unit/component layer's job, listed so
nobody re-derives it by hand into this document):
- Mechanical pre-grouping's own clustering correctness (slug/time/surface
  signal fixtures, determinism across two calls, disabling one heuristic) —
  `value-groups-mechanical.test.js`.
- `parseGroupingOutput`'s strict-whitelist behavior against a malformed/
  adversarial model response (`status: "claimed"` discarded) as an isolated
  unit case, and the `UNCOMPARED_FIELD_GUARANTORS` digest-key-walk coverage
  test — `value-groups-refinement.test.js` (the negative-proof *structural
  scan* half of §11.4 also lives there, not here; this document only covers
  the negative proof's **behavioral** half, per flow 2, because that half is
  inherently an over-the-wire flow claim).
- `buildProbeCoverage`'s single-call-site guard and its own extraction
  correctness — `value-coverage-probe.test.js` / `single-writer-guard.test.js`.
  This document's flow 1 exercises `buildProbeCoverage` only as a black box
  (the gate either opens or it doesn't); it does not re-prove the extraction
  itself, and does not add a fourth route↔route parity assertion (§6.2's
  explicit prohibition).
- The four-locale key parity for the six new registries — `i18n.test.ts`.
- `PlanLedgerPanel`'s entity-switch reset, `<StrictMode>` render, and
  disabled-button-affordance detail — `PlanLedgerPanel.groups.test.tsx`'s own
  component-level cases (§11.6). This document only asserts, once, that a
  real `GET /groups` response containing an `already_claimed` member renders
  without an unresolved i18n key or raw enum leaking to the DOM — the
  contract-level version of that claim, not the exhaustive component matrix.

---

## 2. Spec files

### 2a. `server/__tests__/value-groups-api.test.js` (NEW — already named in the change-brief's file list)

Covers flows 1-4 and 6. This is this slice's analogue of
`project-plans-api.test.js`'s coverage-routes `describe` block and Slice 2's
`coverage-request-e2e.test.js`: real app, real DB, real HTTP, one seeded
project reused across a small number of sequential scenario steps rather
than a matrix.

**Bucket:** `server/__tests__/*.test.js`, run by `npm run test:server`. Own
child process (module-scope guards in `value-groups.js` — the interrupted-run
guard, PM-4's digest cache — cannot leak into any other spec file). Tests
inside the file stay **sequential** (default `node --test` behavior, no
`{ concurrency: true }`) wherever a scenario shares one seeded project across
steps (flows 1-3, which is the propose→review lifecycle in order); flows 4
and 6 get their **own** seeded projects/`describe` blocks so they don't
depend on flow 1-3's ordering, following `project-plans-api.test.js`'s own
"each group's own `before()` creates the fixtures that group needs" idiom.

**Setup, reusing existing precedent verbatim:**
- `TEST_DB` temp file + `DASHBOARD_DB_PATH`, `createApp`/`startServer` from
  `../index`, `fetch`/`post` HTTP helpers — copy `project-plans-api.test.js`'s
  top-of-file pattern (lines 1-63) and `makeProject`.
- `seedProjectWithDetourPool`-style helper (copy
  `value-coverage-parity.test.js`'s helper, lines 90-128) to seed a pool
  without a live git repo, extended with an `n` parameter so flow 4 can seed
  more than 40 units.
- **Reach 100% coverage cheaply:** after seeding N detour units, call
  `stmts.upsertValueUnitSummary.run(...)` for every one of them (loop) so
  `described === pool_size` and `coverageSnapshot.complete === true` without
  a live tick or any altitude-generation spawn — the grouping flow's own
  spawn (stubbed) is the only spawn this file needs.
- `__injectSpawnForTest` from `../lib/focus-inference`, the same import
  `value-summary-tick.test.js`/`value-summary-interrupted-boot.test.js`
  already use, with a `fakeSpawn`/`spawnResolvingFirst`-shaped helper
  returning deterministic grouping JSON (`{name, summary, rationale,
  memberUnitKeys}[]`) matching `parseGroupingOutput`'s expected shape. A
  spawn-call counter (`let spawnCalls = 0` inside the fake factory) backs
  flow 3's "no second spawn" assertion and flow 4's "one rollup call beyond
  the per-batch calls" assertion.
- `after()` resets `__injectSpawnForTest(null)`, closes `server`/`db`, and
  removes the temp DB (`-wal`/`-shm` too) — copy
  `value-coverage-parity.test.js`'s `after()` verbatim.

**Scenario steps (flows 1-3, one seeded project, sequential):**
1. Seed a project with e.g. 6 detour units, **leave one uncached** (so
   `coverage.complete === false`). `POST /groups/propose` → **409**, body
   `{ outcome: "blocked_coverage_incomplete", gate:
   "blocked_coverage_incomplete", coverage: {...} }` — assert `coverage`
   carries the full snapshot shape (`pool_size`, `described`, `pending`,
   `eta`, `complete: false`), not a bespoke error-only shape (AC-6/AC-7's
   "reuse the existing coverage/ETA shape" made concrete over the wire).
2. Cache the last unit (`upsertValueUnitSummary`) → coverage now complete.
   `POST /groups/propose` → **202**, `outcome: "started"`.
3. Immediately `POST /groups/propose` again (same project, still
   `in_progress` if the fake spawn resolves asynchronously via
   `setImmediate`, matching the existing `fakeSpawn` idiom) → **200**,
   `outcome: "already_running"`, same `run.id` as step 2 — no second spawn
   (assert the counter unchanged from step 2's spawn count).
4. Poll `GET /groups?project_id=<id>` until `run.state === "completed"`
   (short interval, generous timeout, fail loudly on timeout — same pattern
   as Slice 2's `coverage-request-e2e.test.js` step 4). Assert:
   - `run.state` is exactly `"completed"` (never `"completed_zero_groups"`
     for this fixture — the stub always returns ≥1 group).
   - Every returned group has `refinement_state === "refined"` and all four
     fields (`name`, `summary_sentence`, `rationale`, non-empty `members`)
     non-NULL — a group missing any field fails this assertion, per the
     plan's own "a proposal missing any field is a defect, not done."
   - Each group's `members[]` carries `{ unitKey, availability }`, and every
     member's `availability === "available"` at this point (nothing claimed
     yet).
   - `member_availability_counts` per group sums to that group's member
     count.
5. **Approve** one group (`POST /groups/:id/approve`) and **dismiss** another
   (`POST /groups/:id/dismiss`). Re-`GET /groups` and assert: the approved
   row has `review_status === "approved"` and a non-null `reviewed_at`; the
   dismissed row has `review_status === "dismissed"` and a non-null
   `reviewed_at`; every other group's `review_status` is still `"proposed"`
   with `reviewed_at === null`. Assert response bodies of both POSTs contain
   **only** the changed review fields (no member list mutation, no
   `name`/`rationale` rewrite).
6. **`value_claims` count invariant** (behavioral half of §11.4, made
   end-to-end): read `db.prepare("SELECT COUNT(*) c FROM value_claims").get().c`
   before step 1 and again after step 5; assert byte-identical. Also assert
   `db.prepare("SELECT COUNT(*) c FROM project_plans").get().c` and
   `project_plan_items` counts are unchanged across the whole flow — approve/
   dismiss touched no plan or plan-item row.
7. **Digest reuse (flow 3):** with the pool unchanged since step 2, call
   `POST /groups/propose` a third time (after the run from step 2 has
   reached `completed`) → **200**, `outcome: "reused_unchanged"`, returning
   the same run's groups; assert the spawn counter is **still** unchanged
   from step 2 (the fake spawn function itself was never invoked again).

**Scenario steps (flow 4, oversized pool, own `describe` block/project):**
1. Seed a project with **45 detour units** (mirrors
   `value-summary-tick.test.js`'s own 40+40+5-forcing `makeUnits(85, …)`
   choice, scaled to just past a single-prompt budget), all pre-cached.
2. Inject a spawn that returns a valid grouping response for every batch call
   plus a valid rollup response for the one rollup call (distinguish by
   counting calls or by a marker in the prompt, matching the plan's own
   "one rollup call over leaf `(name, summary, member_count)`" shape).
3. `POST /groups/propose` → poll `GET /groups` to `completed`.
4. Assert `run.batch_count > 1`; assert the spawn was called
   `batch_count + 1` times (each batch, plus exactly one rollup); assert no
   single persisted group's member list is a strict subset of what a single
   mechanical cluster contained (i.e., no cluster was split — this is checked
   against the same fixture's known cluster membership, not inferred);
   assert `run.ungrouped_no_signal` / `run.ungrouped_not_selected` are
   present as integers (not `null`/absent) and their sum plus every group's
   member count equals the seeded pool size (the AC-3 accounting identity).

**Scenario steps (flow 6, read-time drift, own `describe` block/project):**
1. Seed a project with 4 detour units, all pre-cached; propose and poll to
   `completed` with a stub that groups all 4 into one proposal.
2. Directly `stmts.insertValueClaim.run(projectId, null, null, "detour",
   <ref of member B>, cwd, "drift test", null, null, "manual", "someone-else")`
   — an out-of-band claim on one member, written **after** the group was
   persisted and **before** any `GET /groups` read, modeling PM-1's named
   race exactly (claim lands between proposal and review).
3. Delete the `detour_dispositions` row backing a different member (member
   C), modeling "reattributed/discarded — no longer in the live pool."
4. `GET /groups?project_id=<id>` → assert: member A (untouched) is
   `"available"`; member B is `"already_claimed"`; member C is
   `"no_longer_in_pool"`; member D (untouched) is `"available"`. Assert the
   group's `member_availability_counts` reads `{available: 2,
   already_claimed: 1, no_longer_in_pool: 1}` and sums to 4 (the partition
   property — every member lands in exactly one bucket, never zero, never
   two).
5. **Approve is unaffected by drift:** `POST /groups/:id/approve` on this
   group still returns 200 and flips `review_status` — approving a group with
   a drifted member is not blocked and does not silently drop the drifted
   member from the persisted `value_group_members` rows (re-`GET /groups`
   afterward and assert the same 4-member, same-availability shape persists).
   This is the concrete proof that approve stays pure bookkeeping (flow 2)
   **even in the presence of drift**, which is the scenario PM-1's ruling
   exists to cover — AC-5 "approving a reasonable candidate" would be a false
   claim if drift silently changed what got approved.

### 2b. `server/__tests__/value-groups-interrupted-boot.test.js` (NEW — beyond the change-brief's initial file list, same shape-precedent as `value-summary-interrupted-boot.test.js`)

Covers flow 5. **Not folded into 2a**, for the same structural reason
`value-summary-interrupted-boot.test.js` is its own file rather than a
`describe` block inside `project-plans-api.test.js`: the crashed-run state
must exist in the DB **before** `require("../index")` triggers the boot
hook that calls `reconcileInterruptedGroupRuns`. `value-groups-api.test.js`
boots its app once in a shared top-level `before()` for many scenarios: it
cannot also be the file that crafts pre-boot state for one specific test
without contaminating every other scenario's boot. `qa.md`'s own Regression
Coverage section names this exact file (by name) as the shape this
obligation should mirror.

**Bucket:** `server/__tests__/*.test.js`, `npm run test:server`, own child
process (required, since it sets `DASHBOARD_DB_PATH` and pre-seeds the DB at
module-load time, before any other file's app is running).

**Setup:**
1. Set `DASHBOARD_DB_PATH` to a fresh temp file, same as
   `value-summary-interrupted-boot.test.js`'s top-of-file pattern.
2. **Before requiring `../index`**, open the DB directly with
   `better-sqlite3`, run the same `CREATE TABLE IF NOT EXISTS
   value_group_runs`/`value_groups`/`value_group_members` DDL the plan's §4
   specifies (or require `../db` once just to get schema created, then
   re-close it — whichever is less brittle; if `../db`'s own `require` is
   used to create schema, it must be `delete require.cache`-cleared before
   `../index` is required for real, mirroring the legacy-boot file's own
   cache-busting technique at line 157-161), then insert **one
   `value_group_runs` row with `state = 'in_progress'`, `completed_at =
   NULL`**, directly via SQL — this is the "process died mid-run" state, not
   reachable through any route.
3. `require("../index")`, `createApp()`, `startServer()` — this is the boot
   that must invoke `reconcileInterruptedGroupRuns(dbModule)` beside the
   existing tick start (`server/index.js:465-470`).

**Scenario steps:**
1. **Immediately after boot** (no request needed), read the crafted run row
   back from the DB directly: assert `state === "failed"` and
   `error_reason === "interrupted_restart"` and `completed_at` is now
   non-null — the reconciliation ran at **boot**, not lazily on first
   request. This is the load-bearing assertion the whole spec exists for; a
   version of this test that only checks the state via `GET /groups` after
   some other request would leave "does it happen at boot, or only
   incidentally by the time we first ask" unproven.
2. `GET /groups?project_id=<the crafted project>` → assert `run.state ===
   "failed"` is what the client actually receives (not a stuck spinner state,
   not silently omitted) and the response includes **no** groups (this run
   never produced any, consistent with `failed`).
3. **Not starved by the dead row:** `POST /groups/propose` for the same
   project (with its pool now made coverage-complete and a stub spawn
   injected) → assert **202 `started`**, a genuinely new `run.id` distinct
   from the crafted interrupted one, and that it can reach `completed` via
   the normal poll — proving the interrupted row does not permanently block
   or get mistaken for `in_progress`/`already_running` on this project.
4. **Second boot is inert:** cache-bust and re-require `../db`/`../index`
   (mirroring `value-summary-interrupted-boot.test.js`'s own "second boot is
   a no-op" case) and assert `reconcileInterruptedGroupRuns` does not flip
   the now-`completed` run from step 3 to `failed` — it only ever touches
   rows genuinely still `in_progress` at the moment it runs.

### 2c. `client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx` (NEW — already named in the change-brief's file list; ONE contract-level case added here, rest is the unit/component layer's)

This document adds exactly **one** case to this file, at the seam between
the API contract and the render — the rest of this file's coverage
(entity-switch reset, `<StrictMode>`, disabled-button affordance, per-state
copy) is the component/unit-test architect's job (§11.6), not re-derived
here.

**New case:** mock `client/src/lib/api.ts`'s `projectPlans.groups` to return
a **literal fixture** shaped exactly like flow 6's real server response (one
group, 4 members, availabilities `available`/`already_claimed`/
`no_longer_in_pool`/`available`) → render `<PlanLedgerPanel>` → assert:
- The `already_claimed` member renders a visibly distinct marker (not the
  same chip/text as `available`) — reuse the existing `/planLedger\.[a-zA-Z]/`
  raw-i18n-key DOM sweep pattern (`PlanLedgerPanel.test.tsx` line ~613/873)
  so an unresolved key never reaches the rendered surface.
- The `no_longer_in_pool` member is visibly distinct from both other states
  (three states, three distinguishable renderings — never two collapsed to
  one visual treatment, the client-side mirror of the partition property).
- No client-side count is computed from the member list — the rendered
  per-group tally matches the fixture's own server-supplied
  `member_availability_counts` verbatim, never `members.filter(...).length`
  recomputed in the component (§9.1 rogue-re-derivation, applied to this
  file per PM-1's own framing).

---

## 3. Tag

No smoke/regression tag system exists on this project (§0). Both new server
files run as part of the unconditional `npm run test:server` CI step; the
one new client case runs inside the existing `npm run test:client` step.
**Serial requirement:** `value-groups-api.test.js`'s three `describe` blocks
must each keep their own tests in default sequential order (propose → poll →
review, in that order, within a block) — do not opt any case into
`{ concurrency: true }`. `value-groups-interrupted-boot.test.js` is
inherently single-scenario/sequential, matching its precedent file.

---

## 4. Assertions (concrete, reused where a helper/fixture already exists)

- Gate correctness is asserted against the literal HTTP status/outcome
  (`409`/`blocked_coverage_incomplete`, `202`/`started`, `200`/
  `already_running`, `200`/`reused_unchanged`) — never inferred from
  response shape alone.
- Every `refined` group has all four required fields non-NULL; a partial
  group fails the test, per the plan's own "missing a field is a defect."
- Bookkeeping-only proof: `value_claims`/`project_plans`/
  `project_plan_items` row counts are read via direct `db.prepare(...)`
  count queries before and after the full flow and asserted
  byte-identical — not inferred from the response body looking clean.
- Variant/partition isolation: every member of every group lands in exactly
  one of `available`/`already_claimed`/`no_longer_in_pool`, and
  `member_availability_counts` sums to the member row count — asserted
  explicitly, every time groups are read in this document's scenarios, not
  just once.
- A regenerated/reread value matches what was persisted: flow 1 step 4/5's
  poll-then-re-GET pattern, and flow 6 step 5's re-GET after approve, are
  exactly this — what a fresh `GET /groups` returns must match what the
  prior mutation just committed.
- No unresolved i18n key or raw enum value (`"already_claimed"` used as a
  literal, un-translated DOM string) reaches the rendered client surface —
  §2c's DOM sweep.
- Crash-recovery is asserted at **boot time**, directly against the DB row,
  before any HTTP call is made — not indirectly inferred from a later
  route's behavior (§2b step 1's specific ordering).
- Reuse existing fixtures/helpers rather than reinventing:
  `seedProjectWithDetourPool` (extended), `makeProject`, `fetch`/`post`
  helpers (`project-plans-api.test.js`), `__injectSpawnForTest`/
  `spawnResolvingFirst`-shaped fakes (`value-summary-tick.test.js`), the
  cache-busting `require`-clearing technique
  (`value-summary-interrupted-boot.test.js`), the `/planLedger\.[a-zA-Z]/`
  DOM sweep (`PlanLedgerPanel.test.tsx`).

---

## 5. How to run a single spec

No base URL / external environment prerequisite — every spec boots its own
throwaway SQLite file and an ephemeral in-process HTTP server on port 0
(OS-assigned), exactly like every other spec in `server/__tests__/`. No
live integration stack, Docker, or shared seeded dashboard DB is required.
No real `claude`/sonnet CLI call is ever made — every spawn is stubbed via
`__injectSpawnForTest`.

```bash
# Full proposal → review flow, digest reuse, oversized/rollup, read-time drift
node --test server/__tests__/value-groups-api.test.js

# Crash-recovery at boot
node --test server/__tests__/value-groups-interrupted-boot.test.js

# Client contract-level render case, whole file (once the rest of the file
# exists from the component/unit layer)
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.groups.test.tsx

# Just the new contract-level case, while iterating:
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.groups.test.tsx -t "member_availability_counts"
```

Full-suite equivalents (`npm run test:server`, `npm run test:client`) pick
these up automatically via the existing glob — no config change needed.

---

## 6. Cost note — minimum set, and what stays at the unit layer

E2E here means "boot a real server + real DB," materially more expensive
per-assertion than the unit-layer specs this slice already commits to
(`value-groups-mechanical.test.js`'s clustering-signal matrix,
`value-groups-refinement.test.js`'s whitelist/digest-key-walk cases,
`value-coverage-probe.test.js`'s extraction correctness). This design adds
**two new server files** (one ~4-scenario-block flow file, one single-scenario
boot file) and **one new client case** — deliberately not a matrix, following
the project's own "minimum honest form" convention (PM-4's own words for
this exact slice).

**Intentionally NOT re-covered here, because it is already proven cheaper at
the unit layer and duplicating it here would only slow CI for no new
information:**
- Mechanical clustering correctness per signal (slug/time/surface), and its
  determinism-across-two-calls proof — `value-groups-mechanical.test.js`'s
  job; this document's oversized-pool flow (4) only needs "some clusters
  exist," not that they are the *correct* clusters for a hand-picked fixture.
- `parseGroupingOutput`'s full adversarial-input matrix (extra fields,
  invented membership, malformed JSON) — one whitelist case per malformed
  shape belongs in `value-groups-refinement.test.js`; this document's flow 1
  uses a well-formed stub throughout, because the wire-shape acceptance
  (four fields present) is the thing worth proving over real HTTP, and the
  parser's *rejection* behavior is a pure-function claim that doesn't need a
  live server to prove.
- The `UNCOMPARED_FIELD_GUARANTORS` digest coverage test (walk every
  `groupingFacts` key, mutate, assert digest changes) — a pure-function
  unit test, `value-groups-refinement.test.js`'s job; this document's flow 3
  only proves the **behavioral consequence** (no second spawn on an
  unchanged pool) once, which is the flow-level claim worth an HTTP round
  trip.
- `buildProbeCoverage`'s single-call-site structural guard and its own
  red-proof (inject a fourth hand-copy, watch it fail) —
  `single-writer-guard.test.js`'s job; this document treats the gate as a
  black box (either 409s or doesn't).
- The §9.8 four-wire-state truth table's *exhaustive* branch enumeration
  (`not_attempted` reachable with zero rows, `completed_zero_groups`
  reachable when refinement legitimately returns none) — those are cheaper
  to prove directly against `runGroupingPass`/route handlers with hand-picked
  fixtures than by threading every branch through this document's already-
  sequential HTTP flow; this document proves `completed`, `failed`
  (crash-recovery), and the 409 gate, which are the three states an actual
  browser session is most likely to hit in order, and leaves the remaining
  combination-table cells (named explicitly in `technical-plan.md` §11.1,
  e.g. "incomplete coverage + prior failed run + re-request") to
  `value-groups-api.test.js`'s sibling unit-style route tests, not this
  document's flow-proof cases.
- The four-locale key parity for the six new registries — `i18n.test.ts`.
- `PlanLedgerPanel.groups.test.tsx`'s entity-switch reset,
  `<StrictMode>`-render, and disabled-affordance-detail cases (§11.6) —
  component-level, not a contract claim; this document adds exactly one
  contract-seam case (§2c) and leaves the rest there.
- A real haiku/sonnet LLM call anywhere in this document's specs — every
  spawn is injected, matching every existing spec on this file family.
- `screens.snapshot.test.tsx` baselines for the new group UI — reviewed and
  regenerated deliberately as part of the client change set, not this
  document's job.
