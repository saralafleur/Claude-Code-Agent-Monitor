# Decisions — Value Pool Slice 3: Auto-group proposal engine

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/`
**Opened:** 2026-08-06 by `intake-tech-lead` (Wave 3), alongside `technical-plan.md`.
Ids are folder-local: `DEC-S3-*` for rulings, `WATCH-S3-*` for carried risks
(matching Slice 2's `WATCH-S2-*` convention). Every WATCH row states
**`Fires-on:`** (the concrete event) and **`Lands-in:`** (the file that will
change), per PM-6.2.

Binding inputs consumed as **closed** — do not re-litigate: **DEC-10**
(sonnet both stages, calibration done), **DEC-3** (`MAX_PROJECTS_PER_TICK`
default 3 is a spec; OPEN-4 is closed), **DEC-2** (coverage-gate UI inherited
here as AC-7), **DEC-16** (`assembleValuePool` sole composer), **WATCH-6**
(`value_unit_summaries` single-writer guards widen only deliberately).

---

## Rulings (RESOLVED at plan time)

| Id | Ruling | Grounds |
|---|---|---|
| **DEC-S3-1** | **Three tables** (`value_group_runs` / `value_groups` / `value_group_members`), not the engineer's two-table shape. | Two tables cannot represent run-level state: zero-clusters is byte-identical to never-attempted, and `in_progress` has no home. PM-3. |
| **DEC-S3-2** | **SF-4 extraction is MANDATORY in this slice**; `buildProbeCoverage` lives in a new `server/lib/value-coverage-probe.js` with exactly three call sites. | Trigger names this slice, has fired; deferring ships the third hand-copy into handlers that already diverged once. PM-2. |
| **DEC-S3-3** | **T7 (`server/__tests__/project-plans-api.test.js:905`) is deleted and replaced in the same commit** as the extraction. It WILL go red; it is never "adjusted until it passes." | T7 asserts each handler body literally contains the assemble/enrich calls; extraction moves them. See WATCH-S3-D. |
| **DEC-S3-4** | **No post-extraction route↔route parity guard.** Replacement is a single-call-site / structural-scan guard with derived, fail-closed scope, plus the surviving anchored response-key-set assertions. | Both routes calling one function makes `deepEqual(A,B)` → `deepEqual(f(X),f(X))` — the exact vacuity logged from Slice 2's `value-coverage-parity.test.js`. Catalog: "replace the guard then — do not keep both." |
| **DEC-S3-5** | **Proposal/live-pool drift v1 ships now**, read-time only: `GROUP_MEMBER_AVAILABILITY` = `available` / `already_claimed` / `no_longer_in_pool`, computed on `GET /groups` from live pool + claims, **never persisted** (no `still_available` column). Precedence: claims → live pool → otherwise. | PM-1. Derive-don't-copy makes staleness structurally impossible and needs zero new schema. |
| **DEC-S3-6** | **Cost-control cache ships v1, minimally**: `input_digest` on the run row, built from `groupingFacts` which extends `value-summary.js`'s existing exported `unitFacts`. **No second digest formula.** `reused_unchanged` on digest match against the latest completed run; a `failed` run is never reused. | PM-4; §9.1 rogue-re-derivation. Mandatory `UNCOMPARED_FIELD_GUARANTORS`-shaped key-walking coverage test with an anchored exemption set. |
| **DEC-S3-7** | **One vocabulary, three orthogonal axes plus two response signals**: run state (`GROUP_RUN_STATES`, wire, 5 values / `GROUP_RUN_ROW_STATES`, persisted, 4) · per-group refinement (`GROUP_REFINEMENT_STATES`) · per-group review (`GROUP_REVIEW_STATES`: `proposed`/`approved`/`dismissed`/`claimed`-reserved-unreachable) · propose outcome (`GROUP_PROPOSE_OUTCOMES`) · gate (`GROUP_GATE_STATES`). `approved`, never `reviewed`. | PM-3 + PM's vocabulary correction. Two lifecycles in one column is §9.8 in miniature; a schema value disagreeing with the button label is a future §9.1 translation layer. |
| **DEC-S3-8** | **`claimed` is reserved in the CHECK at introduction and is unreachable in Slice 3**, proven by a structural scan asserting zero code paths set it (red-proven by injecting one) — not by prose. | PM-3; PO §7 left it open both ways, PM closed it toward reservation (a CHECK is rebuild-to-widen, WATCH-4). |
| **DEC-S3-9** | **Approve and dismiss are two named routes** (`POST /groups/:id/approve`, `POST /groups/:id/dismiss`), not one `/review {status}` route. | A body-supplied status is a hole through which `claimed` reaches the DB; two verbs close it structurally and match the UI copy. |
| **DEC-S3-10** | **`value-groups.js` never calls `assembleValuePool`** (route handlers pass `units` in, mirroring `value-summary.js`'s posture) **and is still registered in `CONSUMERS`** as a derived-values reader, same commit. | Reconciles architect §5 with engineer §3.2. Under-registering is §9.7's recorded failure mode; over-registering costs one string. |
| **DEC-S3-11** | **Dropped from the engineer's schema:** `parent_group_id` (only post-rollup final groups persist; the rollup merges by reference) and `reviewed_by` (no identity source in a single-user local tool). | §9.6 prefer inapplicability; a column no writer can truthfully fill is an absence wearing a value's clothes. |
| **DEC-S3-12** | **Routes live in `server/routes/project-plans.js`**, not a sibling route file. | It already mounts `/pool`, `/altitudes`, `/coverage` for the same panel and is already a registered consumer. |
| **DEC-S3-13** | **Interrupted runs are reconciled at boot** (`reconcileInterruptedGroupRuns`, called beside the tick start in `server/index.js:465-470`): surviving `in_progress` rows become `failed` / `error_reason='interrupted_restart'`. | An `in_progress` row cannot outlive the process honestly; without this a crashed run renders a permanent spinner — an overloaded absence. |
| **DEC-S3-14** | **Spawn path pinned**: `runClaudePromptJson(prompt, { model })` from `server/lib/focus-inference.js` — the same import `value-summary.js:64` already uses. No second spawn idiom. | Closes the engineer's explicitly-flagged untraced item. |

---

## WATCH rows (carried risk / deliberately declined scope)

### WATCH-S3-A — claim-time member re-validation
Display-time truth (DEC-S3-5) does not make a *claim* safe: a member can
leave the pool between render and click. Slice 4's batch claim must
re-validate inside its own transaction and fail loudly on a conflict.
**Fires-on:** Slice 4's batch-claim build.
**Lands-in:** Slice 4's claim route + its transaction test.
*Opened by PM-1; Sara does not need to re-decide this.*

### WATCH-S3-B — shared-surface heuristic narrowed for v1
v1 matches on label/path substrings from commit subjects, **not** commit-diff
file-path analysis; the pool's unit objects carry no file paths and adding
them is real per-unit cost at 200-unit scale.
**Fires-on:** an observed real miss (two units on one surface failing to
cluster), or `trunk-drift.js` commit objects gaining cheap file paths.
**Lands-in:** `server/lib/value-groups.js`'s `mechanicalPreGroup` + its spec.
*Carried forward verbatim from the architect's own Return summary (§3b/§4).*

### WATCH-S3-C — time-adjacency width is measured, not guessed
The declaring comment must cite the measured distribution from the live pool
(~102 units today, 182 recorded, DEC-12). A bound comment that cannot name a
number does not ship.
**Fires-on:** build time (blocking for that constant).
**Lands-in:** the constant's own declaring comment in `server/lib/value-groups.js`.

### WATCH-S3-D — T7 must be deleted, not adjusted
**Fires-on:** the SF-4 extraction commit.
**Lands-in:** `server/__tests__/project-plans-api.test.js:905` (removal) +
the new call-site-set guard in `server/__tests__/single-writer-guard.test.js`.

### WATCH-S3-E — no group-level WebSocket broadcast in v1
The panel learns about run completion from its own propose response and from
the existing `value_altitudes_updated` message; no new WS message type ships
(WS message types stay stable and backward-compatible by project rule, and a
second broadcast for the same pane is a §9.1-shaped duplication until there is
a reader that needs it).
**Fires-on:** a run whose completion the UI demonstrably misses in practice
(a long run finishing while the panel sits idle).
**Lands-in:** `server/lib/value-groups.js` (emit) + `PlanLedgerPanel.tsx`'s WS
handler.

### WATCH-S3-F — approve performs no freshness check on its response (BO-6)
`POST /groups/:id/approve` (and `/dismiss`) does no freshness check and its
response does not carry a recomputed `member_availability_counts`/`members`
snapshot — it returns only `{ review_status, reviewed_at }`, the pure-
bookkeeping shape AC-5 requires. A client that wants the freshest drift-aware
member list after approving re-fetches `GET /groups` (which the panel already
does via its own state update path). Building a response-carried snapshot is
a wire-contract change beyond AC-5's stated scope this round.
**Fires-on:** Slice 4's claim build, or an observed approve-against-stale-
render in practice.
**Lands-in:** `server/routes/project-plans.js`'s approve/dismiss handlers +
`server/__tests__/value-groups-api.test.js`.
**Distinct from WATCH-S3-A** (claim-time re-validation, Slice 4's claim
route) — this one is about the approve *response's own freshness*, not about
claim-time conflict resolution. `E-6.4`/`E-6.5` (read-time drift, approve
under drift is pure bookkeeping) cover this slice's correctness bar.

### OPEN-S2-1 (carried, still open)
Which real project validates the end-to-end flow. Non-blocking; recorded here
so it does not silently close.

---

## PENDING — cheap-to-reverse vetoes for Sara (none blocking; build proceeds)

1. **DEC-S3-5** adds read-time per-member re-validation — a small scope
   increase over the 2026-08-04 approval. Veto if you would rather ship
   faster and accept a possibly-stale member list until Slice 4.
2. **DEC-S3-8** reserves `claimed` in the enum now. Cheap to reverse before
   build, expensive after.
3. **DEC-S3-6** adds a column and a wire state. Veto if you would rather
   every Auto-group click always re-run for freshness.
4. **PO §6.2** — "approve" means *reviewed, reasonable candidate to act on
   later*, and claims nothing. If your model was "approve commits it to the
   plan," that is a request to loosen the never-auto-claims principle and
   needs its own explicit decision.
5. **PO §5** — the coverage gate reuses the single existing
   `prioritize-now-button` rather than adding a group-specific one. Flag if
   you pictured a distinct group-level ETA sentence.
6. **AC-3's disclosure affordance** — what "N units not yet grouped" looks
   like is left to design; the bar is only that it exists and is truthful.

---

## BO-7 (build-time, docs-drift-only) — OpenAPI documentation for the 4 new routes

`server/openapi.js` / `server/openapi-extra/*.js` do not carry entries for
`POST /groups/propose`, `GET /groups`, `POST /groups/:id/approve`, or
`POST /groups/:id/dismiss` as of this build. Recorded per Slice 1's own
precedent (`/altitudes/seen` was similarly declined at the time) rather than
left as an undocumented gap discovered later. Documentation-drift risk only
— no behavior depends on this. **Fires-on:** the next slice that touches
`server/routes/project-plans.js`'s group routes, or an operator noticing the
OpenAPI spec is incomplete for this surface. **Lands-in:**
`server/openapi-extra/project-plans.js` (or a new file matching this
router's existing convention).

## BO-8 (2026-08-06, build-time, docs-drift-only) — route shape is `:projectId` path param, not `{project_id}` body param

`technical-plan.md` §7 specifies `POST /api/project-plans/groups/propose
{project_id}` (a body param) for all four new routes. As shipped, all four
use a `:projectId` path param instead —
`POST /api/project-plans/:projectId/groups/propose`,
`GET /api/project-plans/:projectId/groups`,
`POST /api/project-plans/:projectId/groups/:groupId/approve`,
`POST /api/project-plans/:projectId/groups/:groupId/dismiss` — matching this
router's own existing path-param convention (`:id(\d+)` on the plan routes
below them) rather than introducing a second identifier-passing idiom.
Client (`client/src/lib/api.ts`) and server agree with each other, so this
is not a functional bug — README.md's new "Project Plans — Value Pool
Groups" API reference section documents the shipped shape. `technical-plan.md`
§7 itself was not corrected; treat its literal route text as superseded by
this note and by the shipped `server/routes/project-plans.js` source.
**Fires-on:** the next slice that reads §7 literally instead of the shipped
routes. **Lands-in:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/technical-plan.md`
§7 (if corrected later) + `README.md`'s API reference section (already
updated).

---

## DEC-S3-FIX3 — Disposition for the build-reviewer's unapplied should-fix items and nits (fix round 3)
- **Item / area:** `build/2026-08-06-auto-group-proposal/supporting/review-findings.md` SHOULD-FIX 1–13, NITS 1–8
- **Status:** DECIDED-AUTO (deferred, each with a named consequence)
- **Raised:** 2026-08-06 (`build-reviewer`) · **Decided:** 2026-08-06 · **Decided by:** `build-implementer` (fix round 3), following this project's own established precedent (`requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/build/2026-08-05-coverage-on-demand/decisions.md` DEC-3)
- **Recurring-issue link:** `PROJECT-CONTEXT.md` §9.4 — *"should-fix is a triage label, not a disposition."*

### The question
Fix round 3 closed all 17 BLOCKERS with real product-code + test fixes. The
same review also returned 13 should-fix items and 8 nits. Fixing all of them
in the same pass risked introducing new bugs on top of an already-large fix
(17 blockers touching `server/lib/value-groups.js`,
`server/routes/project-plans.js`, and `client/src/components/PlanLedgerPanel.tsx`).
§9.4 says each must end as *fixed with a test* or *a dated decisions row*.
This is that row. One exception was fixed alongside its blocker (noted
below) because it shared BL-2's exact root cause.

### Decision — deferred, per item, with consequence

| Id | Item | Why deferred | Consequence if left |
|---|---|---|---|
| **SF-1** | `GET /groups` assembles the value pool twice (`buildProbeCoverage` internally, then again for `liveUnits`) — two independent snapshots in one response, double the cost | Not a live defect (both snapshots are internally consistent within one request); a real fix threads units out of `buildProbeCoverage` or hoists the call, and wants its own perf-focused pass, not bundled into a 17-blocker fix round | Doubled `assembleValuePool` cost on every `GET /groups` poll; at real pool scale this is the kind of cost the SF-4 extraction (Task 2) was built to avoid elsewhere in this same file |
| **SF-2** | Approve/dismiss never verify the group belongs to `:projectId` — `POST /api/project-plans/<any-project>/groups/<id>/approve` mutates any group in the DB | Narrow blast radius (pure bookkeeping only, per AC-5/PO §7-8 fence — no claim, no plan-item mutation reachable this way); the fix is a straightforward join-and-404 but needs its own red-proof (cross-project group id) not yet authored | A malformed/malicious client-side project id lets one project's UI silently approve/dismiss another project's proposal — an authorization gap, not a data-corruption one |
| **SF-3** | `api.ts`'s `request()` throws on any non-2xx, so the code comment's claim that a `blocked_coverage_incomplete` (409) response "still carries a full run/gate/coverage snapshot the panel reuses as-is" never actually happens — the body is discarded and a raw error banner shows instead | AC-6/AC-7's ETA-reuse behavior needs a real client-side fetch-error-body-parsing change (`request()`'s throw-on-non-2xx contract is shared by every other call site in this file — changing it is not scoped to Slice 3) | The panel's 409 UI degrades to a generic error banner instead of reusing the coverage/ETA snapshot the server already computed and sent — a missed progressive-enhancement opportunity, not a crash |
| **SF-4** | Client `GET /groups` failure (network error, 500, etc.) leaves `groupsRun === null`, rendering identically to "no groups yet" — "endpoint down," "never attempted," and "completed with zero groups" collapse into one view at the client, undoing the server-side `not_attempted`/`completed_zero_groups` distinction in the last mile | The silent catch itself is correct SF-9 posture (a failing progressive-enhancement leg must never blank the whole panel); adding a distinct load-error state is a real UI addition (new copy, new i18n keys in 4 locales) that wants its own test, not a rider on this fix round | A user sees an empty "no groups yet" state indistinguishable from a transient fetch failure — a support/debugging annoyance, not data loss |
| **SF-5** | `handleApproveGroup`/`handleDismissGroup` lack the `currentProjectIdRef` in-flight guard every other async handler in this file carries (`handleProposeGroups`, `load`, `loadGroups`) | Narrow window (approve/dismiss are fast, single-group calls, not the multi-second `load`/propose calls the guard was built for); adding it is a 2-line mechanical fix but wants its own C-6-style stale-response test, not assumed correct without one | A user who approves a group then immediately switches projects could see a stale optimistic patch land under the new project's group list — the same class SF-8/PM-5a already guard `groupsList`'s bulk state against, just not this one write path |
| **SF-7 (parseGroupingOutput/rationale)** | `parseGroupingOutput` treats `rationale` as optional (only `name`+`summary_sentence` are required) while `insertValueGroupRow`'s R-7 biconditional demands all three non-NULL when `refinement_state='refined'` — a model response omitting `rationale` would produce a `refined` row with `rationale=null`, silently breaking R-7's own invariant in production | This is a genuine latent gap, but closing it means a product-code behavior decision (make `rationale` required too, defaulting to a placeholder, or widening the biconditional) that belongs with the next real-model calibration pass (mirrors DEC-2/DEC-10's own "measure before pinning" precedent), not an ad hoc tightening under a blocker-fix round | If a real model omits `rationale`, R-7's biconditional (executable proof that "the client must never infer state from NULL-ness") is quietly false for that one row in production, even though every test of it currently passes |
| **SF-8** | `value-coverage-probe.test.js`'s P-2/P-3/P-5 are weaker than the technical plan mandated — P-3 asserts a tautology (`null \|\| typeof === "string"`) without seeding a sweep-state row, P-5's own comment calls itself "a smoke check," P-2 never seeds a *differing* `coverage_requested_at` so "the passed value wins" rests on `null` vs. the literal | Out of this round's scope — these are Slice 2 (`coverage-on-demand`) test file gaps, not Slice 3 auto-group-proposal blockers; touching them risks destabilizing an already-shipped, independently-reviewed slice's test suite for a fix round scoped to Slice 3 | These three guards stay weaker than their own mandate; a real regression in `buildProbeCoverage`'s `requestedAt`/count-sourcing behavior could ship undetected by these three specifically (other, stronger guards on the same surface — P-6/P-7/P-1 — still catch the load-bearing claims) |
| **SF-9** | C-7 (StrictMode) is synchronous against async mocks — nothing is awaited, so it only proves a statically-rendered `<div role="region">` exists with `textContent.length > 10`, both true of the empty state; the "renders correctly after setup→cleanup→setup" claim under real async data is unproven | A real fix needs an `await waitFor(...)` inside the StrictMode render assertion plus a mock that resolves real group data — a small change, but one that touches this same fix round's already-large client test file again; deferred to keep this round's client diff reviewable | A future StrictMode double-invoke regression in the ASYNC data-loading path (the actual BL-2-shaped risk C-7 exists to catch) could ship undetected — C-7 currently only proves the synchronous/empty-state shape is StrictMode-safe |
| **SF-10** | `E-5` in `value-groups-refinement.test.js` is titled "Boot-hook reconciliation … ensuring it's called at boot" but only calls `reconcileInterruptedGroupRuns` directly — a duplicate of R-10 with a title that overstates it (the real boot-wiring proof is the separate `value-groups-interrupted-boot.test.js` file) | Cosmetic (a misleading test title, not a missing guard — the real boot-hook proof already exists elsewhere and is green); a rename is a one-line fix but touches a file already extensively edited this round for BL-3/BL-4/BL-7/BL-8/BL-17 | A future reader of `E-5`'s title could mistakenly believe boot-wiring is unproven anywhere in this file and duplicate work re-proving what `value-groups-interrupted-boot.test.js` already covers |
| **SF-11** | The four new `/groups` endpoints are absent from the OpenAPI spec (`server/openapi.js`/`server/openapi-extra/*.js`) | Already recorded as **BO-7** (above, in this same decisions.md, opened at the original build) — this is the review re-surfacing the same gap, not a new one; no second row needed beyond this cross-reference | Same as BO-7: documentation-drift risk only, no behavior depends on it |
| **SF-12** | `defaultScanTargets` in `server/__tests__/helpers/single-home.js` hard-codes a directory list (`server/lib`, `server/routes`, `bin`, `server/index.js`) inside the §9.7 durable-cure helper itself — `mcp/src`, `scripts/`, `desktop/` are unscanned, a hand list inside the very helper built to cure hand lists | The helper is otherwise correct and genuinely fail-closed (throws, never `continue`) for everything it DOES scan; widening its scan targets is a scope decision (does an MCP-side or scripts-side consumer of these modules even exist today?) that wants its own audit, not a guess under this fix round | A future consumer of `value-groups.js`/`value-coverage-probe.js`/etc. added under `mcp/src`, `scripts/`, or `desktop/` would go completely unregistered and undetected by `assertConsumerScopeDerived` — the exact §9.7 failure mode this helper exists to close, just one layer further out |
| **SF-13** | `value-groups.js`'s `groupingFacts` string-`cachedAltitude` branch (copies one string into both `project_level` and `stakeholder_level`) exists solely for a test fixture shape — the only production caller (`resolveGroupingFactsByKey` in the routes file) always passes an object, never a bare string | Same family as the already-fixed BL-3/BL-4 (test-shaped paths in product code), but lower severity — this branch is inert in production (never reached) rather than actively dangerous (unlike the deleted `runGroupingPassSync` seam, which fabricated a cluster). Removing it means updating the R-9 fixture that currently exercises it, one more edit in an already-large diff | A future reader could mistake this branch for a real production code path (a caller that only has one merged altitude string) rather than recognizing it as test-fixture accommodation — a small, contained instance of the same class BL-3/BL-4 closed at higher severity |
| **N-nit-1 (M-6)** | M-6 (mechanical pre-grouping determinism) compares only sorted `clusterId`s across the two shuffled-input calls, not the mandated full sorted-output `deepEqual` on membership | `clusterId` is itself a hash of `signal + sorted memberUnitKeys` (see `computeClusterId`), so two calls producing the same `clusterId` set already implies the same membership per cluster — the gap is real but narrower than it first appears | A hypothetical hash-collision-shaped bug (same `clusterId`, different real membership) would not be caught by M-6 specifically, though `M-1`/`M-2`/`M-4`/`M-9`'s own membership assertions on their own fixtures would likely still catch a real regression |
| **N-nit-2 (M-8)** | M-8 is `typeof === "function"` plus a `mechanicalPreGroup.toString()` substring scan — `.toString()` returns only the function BODY, so the module-level `require("../db")` singleton class (BL-3) is structurally invisible to it | M-8 was never the guard meant to catch BL-3 (nothing in the mechanical-pregrouping test file's own scope claims that); BL-3's real fix is the module-scope singleton's removal itself, verified directly by this round's DB-isolation re-run (confirmed zero rows written to production `dashboard.db`) | If a future edit reintroduces a module-scope `require("../db")` OUTSIDE `mechanicalPreGroup`'s own function body (elsewhere in `value-groups.js`), M-8 still cannot see it — same gap, unrelated to this round's BL-3 fix |
| **N-nit-3 (R-13)** | R-13's regex `/try\s*\{[\s\S]*?reconcileInterruptedGroupRuns\([\s\S]*?\}\s*catch/` is lazily quantified across the WHOLE file — any `try {` before and any `} catch` after satisfies it | A tighter, brace-walked version is a mechanical improvement but touches yet another already-large-diff file for a guard whose real proof already exists in the separate `value-groups-interrupted-boot.test.js` (a genuine behavioral boot test, not a source-text regex) | R-13 alone could pass even if `reconcileInterruptedGroupRuns(...)` were moved outside its intended try/catch — but the behavioral boot test would still catch a REAL regression in the reconciliation behavior itself |
| **N-nit-4** | `PlanLedgerPanel.groups.test.tsx` imports `rerender` from `@testing-library/react` (no such named export — always `undefined`) and `fireEvent`/`within` (imported, unused) | Cosmetic import hygiene; harmless (the bad import silently resolves to `undefined` and is never called — C-5/C-6 correctly use `rerender` returned from their own `render()` calls instead) | None functionally; a linter pass would flag the unused/incorrect imports at some point regardless |
| **N-nit-5** | `planLedger.proposeOutcome.*` and `planLedger.gateState.ready` exist (and are complete) in all four locales but nothing in the component actually renders them (`proposeOutcome` is only passed to `warnIfOutOfRegistry`) | Dead keys are lower-severity than missing ones; whether to add the rendering affordance (e.g. a toast/banner naming the propose outcome) is a UX decision, not a defect this build round should make unilaterally | Two locale-key families ship unused; harmless bytes, but a future i18n audit could flag them as orphaned without this note explaining why |
| **N-nit-6** | `db.js`'s `listValueGroupMembersForRun` orders by `m.id ASC` on a table with no `created_at` column — a row-id-as-order query (§9.2's named pattern) with no `GRANDFATHERED_QUERIES`-style note | Benign today (member rows are inserted in a stable, deterministic order within one `persistPassResults` call, so id-order and insertion-order coincide); adding the note is a one-line schema-comment fix that wants to happen alongside the next real schema touch to this table | If a future migration ever needs to reorder or backfill `value_group_members` rows, `id ASC` silently stops matching insertion order with no comment warning the next implementer this query relies on it |
| **N-nit-7** | `GROUPING_UNCOMPARED_FIELD_GUARANTORS`'s docblock claims every key "necessarily participates in the digest" — true as written, but §9.1's 2026-08-05 lesson says a physical-impossibility claim like this must be backed by the loop that proves it, not just asserted in prose | **Closed by BL-8's fix** (this same round) — R-9's key-walk loop plus the new anchored `deepEqual(Object.keys(GROUPING_UNCOMPARED_FIELD_GUARANTORS), [])` assertion IS that loop now; recorded here only because the nit named the docblock comment specifically, and the comment text itself was not additionally reworded in this pass | None — the executable proof this nit asked for now exists (R-9 in `value-groups-refinement.test.js`) |
| **N-nit-8** | `UNGROUPED_REASONS`'s `"not_selected_by_refinement"` value is exported and counted numerically (`ungrouped_not_selected`) but never actually used as a `reason` STRING value on any per-unit object — `mechanicalPreGroup` always emits `"no_shared_signal"` for its own `ungrouped` entries | This is accurate: `ungrouped_not_selected` is a pure COUNT on the run row (§3.7, AC-3), never a per-unit `{unitKey, reason}` object the way `mechanicalPreGroup`'s `ungrouped` array is — the registry value names the CATEGORY the count represents, not a literal string ever attached to a unit object. No product-code gap; a naming-clarity note only | None — this is working as designed; recorded so a future reader does not "fix" a non-defect by trying to attach the literal string somewhere |

**Exception folded into a blocker fix, not deferred:** the review's should-fix
item about `notSelected` being computed via per-cluster arithmetic over an
over-generating pre-grouper (wrong whenever a unit is multi-clustered) shared
BL-2's exact root cause (`rollupGroups`'s positional corruption) and was
fixed in the SAME change as BL-2 — `persistPassResults` now derives
`notSelected` from a set difference over unit keys (never per-cluster
subtraction), described in `server/lib/value-groups.js`'s own updated
docblock on `persistPassResults`.

**Note from decision-maker:** these are dispositions, not dismissals, mirroring
DEC-3's own posture on the prior slice. Every row above should be carried into
this round's `build-report.md`/handoff so the person who reviews or merges
this fix round sees them without re-opening the original review findings.

---

## DEC-S3-FIX3-VERIFY — BL-5's per-group failure discriminator: narrowed, not fully closed
- **Item / area:** `server/lib/value-groups.js` (`persistPassResults`,
  `insertValueGroupRow`), `server/db.js` (`value_groups` schema)
- **Status:** DECIDED-AUTO (deferred, with a named consequence, same posture
  as `DEC-S3-FIX3`)
- **Raised:** 2026-08-06 (`build-verifier`, re-verification pass on fix round
  3) · **Decided:** 2026-08-06 · **Decided by:** `build-verifier`'s
  recommendation, applied directly by the orchestrating session (no further
  agent round — the fix is a documentation-only disposition, not a code
  change)
- **Recurring-issue link:** `PROJECT-CONTEXT.md` §9.8 OVERLOADED-ABSENCE —
  the same entry BL-5 itself was attributed to.

### The question
BL-5's original defect had two faces: (1) a genuinely-failed grouping pass
(LLM off, clusters exist, nothing refines) landing in a `completed` state
whose `input_digest` gets matched forever on retry — permanent cache
poisoning, no way to retry; and (2) `refineBatch` collapsing *LLM
unavailable*, *spawn failure*, *unparsable output*, and *no `groups` array*
into one opaque `null`, with no per-group discriminator to say which.

Fix round 3 closed (1) fully: a run with clusters but zero refined now lands
in the existing `'failed'` state (`error_reason` set to
`"llm_unavailable"`/`"llm_output_unusable"`) instead of `'completed'`, so it
is never digest-matched into `reused_unchanged` again — proven by a real
`TT-c`-style test in `value-groups-api.test.js`, independently confirmed by
`build-verifier`'s re-verification pass.

(2) was not built: `value_groups` (`server/db.js:1985-2002`) still has no
error-reason-shaped column, and `persistPassResults` passes no discriminator
to `insertValueGroupRow` for an individual failed group inside an otherwise-
successful run. The implementer's own report disclosed this narrowing
explicitly (adapting to a run-level discriminator instead, since the
3-table schema is pinned against `ALTER`/`REBUILD_CASES` outside this
round's authorized scope) — this row is that disclosure formalized as a
decisions-log entry, per §9.4 ("should-fix is a triage label, not a
disposition" — the same rule applies to a knowingly-narrowed blocker fix).

### Options presented
- **A) Accept the run-level discriminator as adequate for now**, defer the
  per-group discriminator to a schema-touching follow-up.
- **B) Reopen fix round 3** to add a `value_groups.error_reason` column now.

### Decision
**Chosen:** A — the dominant real-world case (BL-5's own reproduction) is a
whole pass failing uniformly (LLM off entirely, or a spawn failure that hits
every batch), which the run-level discriminator already names correctly and
exactly. A genuinely mixed pass (some groups refine, others fail for
different individual reasons within the same run) is a real but narrower
gap, and a schema change (`ALTER TABLE value_groups ADD COLUMN
error_reason`) is a strictly bigger, more deliberate change than this fix
round's authorized scope (which was explicitly pinned to the existing
3-table shape by DEC-S3-1 / S-3 / S-4's own anchoring).
**Rationale / implications:** Per-group failure reasons are UI-visible only
as an undifferentiated "Refinement failed" chip either way today (no
consumer currently reads a per-group reason), so this gap has no live UI
consequence yet. **Named gate: close this before any UI surfaces
per-group failure reasons individually** (e.g. a future "why did this one
fail?" affordance) — at that point a `value_groups.error_reason` column
(or equivalent) becomes load-bearing, not cosmetic.

**Consequence if left:** a mixed-outcome run (some groups refined, others
failed for genuinely different reasons — LLM timeout on one batch,
unparsable JSON on another) reports all failed groups identically today;
a future debugging session could not distinguish them from the persisted
row alone without re-reading server logs from that run's timeframe.

---

**Additional item found by the same verification pass, fixed directly (not
deferred):** `client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx`
C-5 (~line 394) carried one residual vacuous assertion
(`expect(screen.queryByText(...)).toBeDefined()` — trivially true on `null`,
the exact anti-pattern BL-9's own fix replaced everywhere else in this file)
that survived fix round 3. Corrected to `getByText(...)` /
`expect(x).not.toBeNull()` in the same sitting this row was added, per
BL-9's already-established fix pattern — no new decision needed, this is a
mechanical application of an already-decided fix, not a new ruling.
