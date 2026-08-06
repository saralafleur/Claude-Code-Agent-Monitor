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
