# Technical Plan — Value Pool Slice 2: coverage-on-demand + progress UX + model tiering

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/`
**Classification (PM, final):** **`new-feature`** — with one scheduled-debt carve-out
(the OPEN-3 WebSocket subscriber is pre-priced debt coming due, not new scope).
**Run mode:** **fast** — `team-qa` deferred by DEC-F2; this build carries the
**`FAST — QA debt`** stamp.
**Author:** intake-tech-lead · **Date:** 2026-08-05
**Synthesised from:** `request-brief.md` (both inline corrections), `decisions.md`,
`pm-plan.md`, `supporting/architect.md`, `supporting/engineer.md`, `supporting/qa.md`,
`requests/2026-08-04-value-pool-grouping/request.md` §"Slice 2".

---

## 0. HARD PRECONDITION — this plan does not build yet

**Do not cut a Slice 2 effort branch. Do not write a line of Slice 2 code until both
of the following are true.** This is a gate, not a footnote: `DEPENDENCY-F1` was
originally written on a factually wrong premise, and it was corrected only because the
intake-architect and intake-engineer each checked live git instead of reading the row.

**P1 — The git divergence on the main checkout is reconciled.**
Local `master` (`c6f8154`) is **6 ahead / 2 behind** `origin/master`. The
~2,000-line, 23-file **staged** diff on the main checkout is **the prior
`value-summary-tick` effort**, already merged upstream as `55fe900` (16 of 23 files
byte-identical) — *not* Slice 1. Committing it creates duplicate-content history.
Required order: **run `ps` / `lsof` first** (three interactive `claude` sessions,
PIDs 264 / 40299 / 86750, plus a Vite dev server + esbuild from `client/`, PIDs
79851 / 79853, were live at intake — this repo has lost real work to exactly this),
then safety-branch, drop the staged duplicate, merge `origin/master` so the tick
content arrives through its real merge commit. **Treat this as its own task with its
own attention, not as a preamble.**

**P2 — Slice 1 (`intake/2026-08-04-altitude-invalidation/`) is built and landed.**
Slice 1 has **zero build code anywhere** — no `input_digest` on
`value_unit_summaries`, no `ALTITUDE_FRESHNESS`, and `enrichPoolAltitudes` still
returns `{altitudes, states}` with **no `counts` key**. Its `technical-plan.md`
exists and has never been executed. Slice 2 cannot go first, in one sentence: this
slice's coverage number is defined as **fresh-or-immutable** (DEC-1), a concept that
exists only inside Slice 1's input-snapshot comparator, and its only numeric input is
Slice 1's **DEC-14 `counts`** return shape — so building Slice 2 first means inventing
a second, temporary definition of "described" that Slice 1 then contradicts. That is
§9.1 DERIVED-DUAL-VIEW landing by construction, inside the slice whose design exists
to prevent it.

**Consequence for whoever dispatches build:** dispatch **Slice 1's** build first.
When Slice 2's build is finally dispatched, **re-verify every `[S1-dep]` shape against
Slice 1's actual landed code** — this plan cites Slice 1's *planned* shapes.

**Line numbers in this plan are from the staged tick substrate at intake time and
will shift once P1 and P2 land. Re-locate every anchor by grep, never by line
number** (§9.6's own stale-pointer lesson: a stale pointer in the one document whose
instruction is "copy *this* site" is itself a hazard).

**Process rule adopted alongside this plan (PM-5 / §4 of `pm-plan.md`): do not intake
Slice 3 until Slice 2's build has landed.**

---

## 1. Objective

Give the altitude-generation sweep a second, explicit demand level and make its
progress honest and live. A **coverage request** stamps
`value_summary_sweep_state.coverage_requested_at` for one project, jumps it to the
head of the rotation, and drains it in bounded back-to-back ≤40-unit composer batches
until a freshly re-derived count reads zero. One server-side module computes a single
`coverageSnapshot` object — `described` / `pool_size` / `pending` / `complete` /
`demand` / `eta` / `computed_at` — which is carried **verbatim** by a new HTTP GET and
by an additively-widened `value_altitudes_updated` WebSocket payload; `PlanLedgerPanel`
gains its first-ever `eventBus` subscription, renders "N of M described · ~X min
remaining" (or the named `estimating` state), and offers **"prioritize now"** as the
coverage request's entry point. Separately, `summaryModel()` becomes stage-aware so
per-unit compression and (Slice 3's) grouping synthesis can run on different model
tiers, with the default pinned only after a one-time haiku-vs-sonnet calibration on a
real 40-unit batch. End state: passive behavior byte-identical for unflagged projects,
one requested project drainable to 100% while the UI tells the truth about where it is,
and no number on either wire computed anywhere but the one server-side home.

---

## 2. Recommended approach

The Architect's design is adopted essentially whole. Two places where this plan
**overrides** an input, both recorded as decision rows:

| # | Override | Why |
|---|---|---|
| **O1** | **The single home is the architect's `server/lib/value-coverage.js` (`coverageSnapshot` + `estimateEta`, fed only by the composer's `counts`) — NOT the engineer's §1.3 `computeCoverage(dbModule, units)` inside `value-summary.js`.** | The engineer's signature re-walks the units through the cache/freshness read, i.e. it re-implements the composer's own classification of "described". That is the rogue *re-derivation* (not a rogue read) that §9.1's history says is what actually ships. The engineer's db.js statement `listRecentValueGenerationDurations` is adopted **unchanged**. → **DEC-5** |
| **O2** | **Model tiering is one `summaryModel(stage = "unit")` cascade + exported `SUMMARY_STAGES` — NOT the architect's separate `groupingModel()` sibling.** | Two functions means the fallback tail (`DASHBOARD_VALUE_SUMMARY_MODEL → DASHBOARD_FOCUS_SUMMARY_MODEL → DASHBOARD_FOCUS_INFER_MODEL → "haiku"`) is written twice, one call frame apart — §9.1's own three-times-recorded failure shape. The architect's binding constraints are kept verbatim: no stage-keyed model map, one fallback chain, JSDoc naming Slice 3 as the `grouping` stage's only consumer. → **DEC-7** |

The engineer's environment correction is adopted in full and is load-bearing for the
change set: **`server/index.js` needs ZERO code changes.** The run-plan mispointed the
WS work there; `index.js:466-467` only threads `broadcast` into the tick. The payload
is composed at `server/lib/value-summary-tick.js:170-176`, which is where the widening
actually lands. Do not open `server/index.js`.

**The design, in one paragraph.** Add nullable `coverage_requested_at TEXT` to
`value_summary_sweep_state` via the §9.5 three-part landing. Implement
`runCoverageDrain()` **inside `value-summary-tick.js`**, sharing the existing
module-scope `running` overlap guard (this makes the inherited WATCH-7 two-writer race
structurally impossible instead of re-litigated). `POST /coverage-request` writes the
flag and kicks the runner fire-and-forget; the passive tick resumes drain-first via one
new leading `ORDER BY` term. Each drain iteration re-assembles the pool and re-derives
`pending` from that iteration's own full-pool counts — never a decremented counter
(WATCH-8) — so pool growth mid-drain extends the drain for free. Coverage and ETA are
computed in exactly one new module fed solely by the composer's DEC-14 `counts`;
`GET /coverage` produces the same object through a new composer **probe** mode
(classify only, never spawn, **no log row** — DEC-9), and the WS payload carries the
identical object. The client renders; it never computes.

**Settled open points, carried as decisions, not options:**

| Point | Ruling | Row |
|---|---|---|
| **A** — drain mechanism | Out-of-cadence kick on request + drain-first resume by the passive tick. One runner module, one shared `running` guard. Not a new module. | DEC-4 |
| **C** — denominator | "described" = **fresh-or-immutable**. Stale mutable unit = NOT described. **Described ≠ displayed**; copy says "described", never "generated". | DEC-1 |
| **D** — auto-group gate | **No disabled button in Slice 2.** Ship the coverage header + "prioritize now" only. `coverageSnapshot.complete` (server-authored) ships so Slice 3 gates on one server field. Acceptance signal 4 becomes an inherited Slice 3 AC. | DEC-2 |
| **F** — WS payload | Widen `value_altitudes_updated` additively with `coverage`. **No new message type.** Broadcast condition widens: `generated > 0` **OR** `demand`/`complete` changed. | DEC-6 |
| **H** — OPEN-4 | **CLOSED as superseded-in-part.** `MAX_PROJECTS_PER_TICK` stays at 3, cadence unchanged, no `MAX_DRAIN_*` family, **the drain must not read `MAX_PROJECTS_PER_TICK` at all**. | DEC-3 |
| **G1 starvation** (engineer) | 24h TTL on `coverage_requested_at`, cleared-with-log, project reverts to passive. Flag **kept** on a no-progress exit (transient errors must resume). | DEC-8 |
| **B** — ETA inputs | Last K=5 log rows with `outcome='ok' AND generated > 0 AND duration_ms IS NOT NULL`, per-project first with fleet-wide fallback; zero rows anywhere → `{state:"estimating"}`. | §4.3 below |

---

## 3. Change set (ordered, grouped by layer)

`[S1-dep]` = depends on a Slice 1 shape that is planned but not yet built; re-verify
against Slice 1's landed code.

### 3.1 Schema + statements — `server/db.js`

1. **`value_summary_sweep_state` CREATE TABLE body** (~`db.js:1839-1843`) gains
   `coverage_requested_at TEXT` (nullable). Update the schema comment block above it
   (~`db.js:1823-1835`) to name the new column and its NULL-means-passive semantics.
2. **Guarded ALTER** using the **PRAGMA `table_info` idiom** — copy `db.js:1023`
   (`detourDispositionsColumns`) or `db.js:1466/1484/1503` (`color_thresholds`, whose
   comment at `db.js:1495` cites §9.5). **Do NOT** use the deprecated
   try/`SELECT … LIMIT 1`/catch probe (it manufactures an un-ordered `LIMIT` the §9.2
   scan then has to grandfather).
3. **`listValueSweepTargets`** (~`db.js:3264-3271`) — SELECT the new column and widen
   the ORDER BY to the engineer's live-probed form:
   `ORDER BY (s.coverage_requested_at IS NULL) ASC, s.coverage_requested_at ASC,
   (s.last_swept_at IS NOT NULL) ASC, s.last_swept_at ASC, p.id ASC LIMIT ?`.
   Add a TTL cutoff parameter (DEC-8) so requests older than the cutoff sort as
   passive. Passive ordering for unflagged projects must stay byte-identical.
4. **New `requestValueCoverage`** — `INSERT … ON CONFLICT(project_id) DO UPDATE SET
   coverage_requested_at = excluded.coverage_requested_at`.
5. **New `clearValueCoverageRequest`** — `UPDATE … SET coverage_requested_at = NULL
   WHERE project_id = ?`.
6. **New `listRecentValueGenerationDurations`** (the ETA's only input) —
   `SELECT duration_ms, generated FROM value_summary_generation_log WHERE outcome='ok'
   AND generated > 0 AND duration_ms IS NOT NULL ORDER BY created_at DESC, id DESC
   LIMIT ?`, plus the per-project variant (the `(project_id, created_at)` index at
   ~`db.js:1861-1862` already serves it). **Sort before LIMIT, `id` as tiebreak** —
   §9.2, enforced by the existing scan over `db.js`.
7. **No change** to `upsertValueSweepState` / `upsertValueSweepStateKeepPending`
   (~`db.js:3272-3288`): their `DO UPDATE SET` arms list only
   `last_swept_at`/`pending_after_sweep`, so the flag survives a sweep upsert —
   **proven live** by the engineer's probe A, not assumed. Do not "helpfully" add the
   column to those arms.
8. **No CHECK changes anywhere.** `value_summary_generation_log.source` stays
   `CHECK(source IN ('tick','request'))` — see WATCH-S2-A.

### 3.2 Single home — new `server/lib/value-coverage.js` (DEC-5)

Exports exactly two functions:

- `coverageSnapshot(dbModule, { projectId, counts, requestedAt, draining, computedAt })`
  → the one object both wires carry:
  `{ project_id, described, pool_size, pending, complete, demand, requested_at, eta,
  computed_at }` where `described = counts.pool_size - counts.queued -
  counts.unavailable`, `pending = counts.queued + counts.unavailable`,
  `complete = pending === 0`, and `demand ∈ {"passive","requested","draining"}`
  (server-authored, closed registry, exported). **The arithmetic exists nowhere
  else.** `[S1-dep: counts]`
- `estimateEta(dbModule, { projectId, pending })` →
  `{ state: "measured", ms_remaining, per_batch_ms, batches_remaining }`
  | `{ state: "estimating" }` (cold start) | `{ state: "none" }` (complete).
  `ms_remaining = avg(duration_ms) × ceil(pending / MAX_UNITS_PER_PROMPT)`.
  Reads only `listRecentValueGenerationDurations` (K=5, per-project then fleet-wide
  fallback). **No pool SQL, no membership SQL in this module** (DEC-16).

File is born inside `chronology-ordering.test.js`'s derived `filesToScan` scope, so it
**will fail the suite until given a `FILE_DISPOSITIONS` entry** — that is §9.7 working;
add the `"scanned"` entry in the same commit.

### 3.3 Composer probe mode — `server/lib/value-summary.js`

- `enrichPoolAltitudes(dbModule, units, { probe: true })` — one early exit before the
  spawn: classify only, route every miss to `queued`, reuse the existing cap/gate
  machinery, return the same `counts` shape. **Writes no generation-log row** (DEC-9).
- `summaryModel(stage = "unit")` + exported `SUMMARY_STAGES = ["unit","grouping"]`
  (DEC-7 / O2). Per-stage env var prepended to the **one** existing chain at
  `value-summary.js:63-70`; call site at ~`:216` becomes `summaryModel("unit")`.
  JSDoc must state that `"grouping"` has no consumer until Slice 3.
- Every new export trips `assertSingleHome`'s disposition map in
  `single-writer-guard.test.js:267-289` — update dispositions in the same commit.

### 3.4 Tick + drain — `server/lib/value-summary-tick.js`

All inside `runValueSummaryTickOnce` (~`lines 79-191`); the scheduler
(`startValueSummaryTick`, ~197-214) is untouched.

- **`runCoverageDrain(dbModule, projectId, opts)`** in this module, sharing the
  module-scope `running` guard (~`:49,81`). Overlapping callers get
  `{skipped:"overlap"}` (DEC-4 / WATCH-7).
- **Per iteration:** `assembleValuePool` → `enrichPoolAltitudes(dbModule, units)` with
  the **full unit list** (engineer G3 — passing only remaining misses breaks the
  unconditional four-term partition `cache_hits + generated + queued + unavailable ===
  pool_size` on every iteration ≥ 2) → `upsertValueSweepState` with **re-derived**
  `pending = queued + unavailable` → one `insertValueSummaryGeneration` row,
  `source='tick'` → build a `coverageSnapshot` → broadcast per DEC-6.
- **Loop condition:** `pending > 0` re-derived from *that iteration's own* full-pool
  counts. Never a local decremented counter (WATCH-8 / QA-DEC-2).
- **Exit conditions, all named:** (a) `queued === 0 && unavailable === 0` → clear the
  flag **in the same write** as the final sweep-state upsert, broadcast the terminal
  snapshot; (b) `outcome=error` → stop, **keep the flag**, resume next tick; (c)
  no-progress (`generated === 0` while `pending > 0`) → stop, keep the flag; (d) hard
  iteration cap `MAX_DRAIN_BATCHES_PER_RUN = 25`, whose declaring comment **must cite
  the measured 182-unit pool** it was sized against (§9.8 bounds rule). The cap is a
  safety bound, **not** an env knob (DEC-3.3).
- **TTL sweep (DEC-8):** a `coverage_requested_at` older than
  `COVERAGE_REQUEST_TTL_MS = 24h` is cleared with one loud log line before selection;
  cutoff computed in JS and passed as an ISO parameter.
- **The drain must not read `MAX_PROJECTS_PER_TICK`** (DEC-3.3). Grep for it in the
  drain path before declaring done.
- **Broadcast widening** at ~`:170-176`: `{ project_id, unit_keys, pending, coverage }`,
  condition `generated > 0 || demand-or-complete changed since last broadcast for this
  project` (DEC-6).

### 3.5 Routes — `server/routes/project-plans.js`

Both land in the literal-segment block before the `/:id(\d+)` routes, and the header
comment's segment list (~lines 12-14) must be updated.

- **`POST /api/project-plans/coverage-request`** `{project_id}` → `requestValueCoverage`
  → fire-and-forget `runValueSummaryTickOnce(dbModule, { broadcast }).catch(() => {})`
  (safe: the overlap guard turns a double-run into `{skipped:"overlap"}`) → respond
  `202` with a probe-built snapshot (`demand: "requested"` or `"draining"`).
- **`GET /api/project-plans/coverage?project_id=`** → `assembleValuePool` (sole
  composer, DEC-16 — the denominator M comes from here and nowhere else) →
  `enrichPoolAltitudes(..., {probe:true})` → `coverageSnapshot` → JSON. **Byte-same
  shape as the WS payload's `coverage` key.**
- **`POST /altitudes` is deliberately NOT a coverage producer.** Its `counts` cover the
  *submitted* batch, which is partial on every delta fetch; a coverage object derived
  from it would lie with full-pool authority.
- **Writer guards:** Slice 2 adds **no** new caller of `upsertValueUnitSummary` /
  `insertValueSummaryGeneration` outside already-guarded files. **Do not re-widen
  `single-writer-guard.test.js`'s writer file sets** — build on Slice 1 DEC-4's already
  widened state. Give the new `requestValueCoverage` statement its own single-call-site
  guard, same shape as Slice 1's `markValueUnitSummariesSeen` guard.

### 3.6 Client

- **`client/src/lib/types.ts`** — widen `ValueAltitudesUpdatedPayload` (~`:2987`, type
  registered at `:3017`; the "no subscriber" doc at `:2746-2765` must be updated —
  it stops being true in this slice) with the optional `coverage` field, the
  `demand` union and the discriminated `eta` union. Carry the canonical-source doc
  comment per the `TrunkDriftResult["skipped"]` precedent (WATCH-S2-F).
- **`client/src/lib/api.ts`** — `projectPlans.coverage(projectId)` and
  `projectPlans.requestCoverage(projectId)`; the coverage type declared **once**.
- **`client/src/components/PlanLedgerPanel.tsx`** —
  (a) coverage header rendering `described`/`pool_size` and the ETA, with `estimating`
  as its own copy string; (b) **"prioritize now"** button → `requestCoverage`;
  (c) the panel's **first** `eventBus` subscription: `useEffect` + `eventBus.subscribe`,
  filter `msg.type === "value_altitudes_updated" && msg.data.project_id === projectId`,
  merge, unsubscribe on cleanup. **The handler must not throw** — `eventBus` publish is
  synchronous and a throwing subscriber aborts remaining handlers; wrap in try/catch per
  the `colorThresholds.ts:105` / `focusStore.ts` precedent.
  (d) **Merge rule: accept a snapshot only if its `computed_at` is newer than the one
  held** (architect R4 — otherwise the HTTP/WS race makes progress visibly regress,
  which is "decrement" wearing a race's clothes).
  (e) The subscriber **never refetches coverage** on a WS message — the message *is*
  the coverage. It refetches altitude *texts* only, only for the message's `unit_keys`,
  which requires relaxing `requestedAltitudesRef`'s once-ever semantics for exactly
  those keys (~`:519`, WATCH-S2-B).
  (f) **NO disabled Auto-group button** (DEC-2). No percent, no remaining count, no ETA
  arithmetic anywhere in this file.
- **Four locale files** `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` —
  new `planLedger.pool.coverage.*` keys (header, `estimating`, "prioritize now",
  requested/draining copy) in **all four, same commit**.

### 3.7 Calibration (artifact, not product code)

One real 40-unit batch through `buildPrompt` + `runClaudePromptJson` twice
(`{model:"haiku"}`, `{model:"sonnet"}`) from a **scratchpad** script — not committed.
Attach both outputs + the recommendation to DEC-10, then pin the per-stage defaults in
`summaryModel`. Must complete **before** the defaults are pinned (acceptance signal 6).

### 3.8 Docs (mandatory per CLAUDE.md, `update-project-docs`)

`docs/DATABASE.md` (new column), `docs/API.md` (two new endpoints), `ARCHITECTURE.md`
(demand levels + the panel's first WS subscription), `server/README.md` (new env vars
`DASHBOARD_VALUE_SUMMARY_UNIT_MODEL` / `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL`).

### 3.9 Explicitly untouched

`server/index.js` (**zero changes** — engineer's correction of the run-plan),
`startValueSummaryTick`, `MAX_UNITS_PER_PROMPT`, `MAX_PROJECTS_PER_TICK`, the tick
cadence, `value_summary_generation_log`'s CHECK, the `{altitudes, states}` partition
(DEC-10/DEC-11 preserved byte-for-byte — coverage rides beside it, not inside it).

---

## 4. Implementation steps (sequenced; each independently checkable)

> Steps 1–2 are the precondition and belong to other efforts. Steps 3 onward are this
> slice's build, in dependency order.

1. **Reconcile git** (§0 P1). Check: `git merge-base --is-ancestor 55fe900 HEAD`
   succeeds; `git status` clean; `ps`/`lsof` check recorded.
2. **Build and land Slice 1** (§0 P2). Check: `enrichPoolAltitudes` returns `counts`;
   `ALTITUDE_FRESHNESS` exists; `single-writer-guard.test.js` shows DEC-4's widened
   state.
3. **Transcribe rows**: confirm `decisions.md` DEC-1..DEC-11, WATCH-S2-A..F and
   OPEN-S2-1 are present (they are, as of 2026-08-05) and re-read them against Slice
   1's landed code; correct any `[S1-dep]` drift **before** writing code.
4. **Schema commit** (§3.1 items 1-2 + the `UPGRADE_CASES` entry). Check:
   `node --test server/__tests__/db-migration.test.js` green; legacy-shape seed
   migrates, legacy row reads NULL, column writable, second run a no-op; **no new
   `GRANDFATHERED` entries**.
5. **Statements commit** (§3.1 items 3-6). Check: `chronology-ordering.test.js` green;
   red-proof the ETA query by temporarily flipping it to `ORDER BY id` and observing the
   scan fail, then restore byte-identical.
6. **`value-coverage.js` + its `FILE_DISPOSITIONS` entry** (§3.2) — **before** any
   consumer exists (§9.1's ordering rule: one home exists before consumer #2). Check:
   unit tests for `coverageSnapshot` arithmetic and all three `eta.state` branches.
7. **Composer probe mode + `summaryModel(stage)`** (§3.3), with the `assertSingleHome`
   disposition updates in the same commit. Check: a probe run leaves the generation-log
   row count unchanged (DEC-9); per-stage env precedence table extends
   `value-summary.test.js:251-252` rather than replacing it.
8. **Tick drain** (§3.4). Check: the exit-condition matrix (100% reached / outage /
   no-progress / pool grows mid-drain / iteration cap / TTL expiry), flag persistence
   across a plain sweep upsert, flag cleared only at true 100%, per-iteration log rows
   each satisfying the four-term partition, overlap guard returns `{skipped:"overlap"}`.
9. **Broadcast widening** (§3.4 last bullet). Check: the transition-only broadcast case
   — a terminal iteration with `generated === 0` still emits, red-proven by narrowing
   the condition back to `generated > 0` and watching the test fail.
10. **Routes** (§3.5). Check: GET returns the snapshot; POST returns 202 and is
    idempotent under a running drain; `POST /altitudes` response shape unchanged.
11. **Cross-consumer parity test** (§5 / §6 G2) — a **named file/case**, written here
    rather than left to the client step.
12. **Client wire types + api.ts + locales** (§3.6, first three bullets) — all four
    locales in this commit.
13. **`PlanLedgerPanel` header + "prioritize now" + subscriber** (§3.6 c–f). Check:
    cold-start renders the `estimating` copy (not a minutes string, not `0`);
    out-of-order snapshot delivery does not regress the header; no arithmetic in the
    component.
14. **Calibration + pin defaults** (§3.7 / DEC-10). Check: artifact attached to DEC-10
    before the default string changes.
15. **Docs** (§3.8) + `PROJECT-CONTEXT.md` planning note on the effort branch (DEC-11).
16. **Full verification + `FAST — QA debt` stamp** (§6/§8).

---

## 5. Single-source-of-truth guardrail (MANDATORY — this project's §9.1 convention)

This project's canonical-registry convention applies to this change on **four**
surfaces. Every one of them routes through the single home; **no path may be
hand-edited on its own.**

1. **The coverage/ETA computation.** `server/lib/value-coverage.js` is the only place
   `described`, `pending`, `complete` or an ETA is computed. The HTTP route and the WS
   broadcast **carry the same object**; the client renders fields and never re-derives.
   §9.1's twice-proven lesson is that what ships is a rogue *re-derivation*, not a rogue
   read — so the guard must be able to fail on a **second computation**, not only on a
   second read of its inputs. Enforced by the cross-consumer parity test (§6 G2), which
   is the single most load-bearing test in this slice and therefore **has a filename**:
   `server/__tests__/value-coverage-parity.test.js` (precedents:
   `ledger-metrics-parity.test.js`, `reconciliation-full-tick.test.js` Scenario C).
   This project's own evidence is that a per-shape spec only gets written when it is
   given a name.
2. **Pool membership.** `assembleValuePool` remains the sole composer (DEC-16). The
   denominator M comes from it via the composer's `counts` — **no pool-membership SQL
   in the tick, the route, or `value-coverage.js`.** `CONSUMERS` widens in the same
   commit if a consumer is added; DEC-15's sole-composer structural test must stay
   green.
3. **The model cascade.** One `summaryModel(stage)` with the fallback tail written
   once, plus the exported `SUMMARY_STAGES` registry (DEC-7). No second cascade, no
   stage-keyed model map.
4. **The wire state registries.** `demand` and `eta.state` are server-authored, closed,
   **exported** registries (the `ALTITUDE_STATES` precedent). Their hand-typed client
   copies (`types.ts`, `PlanLedgerPanel.tsx`) plus all four locale files land in the
   **same commit** as the server change, each carrying a doc comment naming the
   canonical server export (the `TrunkDriftResult["skipped"]` precedent, §9.7's
   accepted exception). This is the catalog's most common drift site; both inherited
   WATCH-E/WATCH-F triggers fire on any growth (WATCH-S2-F).

Corollary from §9.1's 2026-08-01 lesson, which this surface has now paid for three
times: **scan for copies of the helpers too, not just of the function.** When the cure
is "one function computes X", look for a second computation of X one call frame away —
in `value-coverage.js`'s own file, in the tick, and in `PlanLedgerPanel.tsx`'s render.

---

## 6. Testing & verification

**Fast mode defers the `team-qa` stage (DEC-F2). `supporting/qa.md`'s G1–G6 are
therefore NOT deferred — they are this build's minimum done-bar, and build-time
red-proof discipline is the *only* gate.**

Every check below is subject to the **§9.3 standing rule**: a guard is not done until
it has been observed **red against a real mutation of the thing it names**, then
restored byte-identical and re-run green — with the red **recorded per-test** in the
build report. **No DoD row may be ticked on an agent's self-report** (§9.3's
AGENT-SELF-REPORTED-RED sub-pattern: this exact surface produced eight §9.3-family
events in one prior pipeline, including a vacuous *repair* of a vacuous guard).

| Check | What it asserts | Home |
|---|---|---|
| **G1a** ETA cold-start | Zero qualifying log rows → `eta.state === "estimating"`, **no fabricated number**; client renders a distinct string that is neither a minutes string nor `0` | `value-coverage` spec + `PlanLedgerPanel.test.tsx` |
| **G1b** demand states | One project driven request → first drain batch → 100% yields **three distinguishable** serialized `demand` values, each in exactly one bucket; prove the **never-zero** direction explicitly | `value-summary-tick.test.js` |
| **G1c** re-derive, never decrement | Pool grown mid-drain moves both N and M to live values; an errored sweep leaves prior counts intact (`upsertValueSweepStateKeepPending` precedent — the error path must be *structurally* unable to touch the count, per the prior build's B2 blocker) | `value-summary-tick.test.js` (extend the existing T-C pin) |
| **G2** HTTP↔WS parity | Route response `coverage` **deep-equals** broadcast `coverage` for one seeded DB state; ETA has one server home; no client-side arithmetic | **`server/__tests__/value-coverage-parity.test.js`** (named deliverable) |
| **G3** §9.5 landing | `UPGRADE_CASES` legacy-shape entry: column exists, legacy row NULL, writable, second run no-op; guarded ALTER via PRAGMA idiom; **no new `GRANDFATHERED`** | `db-migration.test.js` |
| **G4** §9.2 ordering | Every new generation-log read sorts `created_at DESC, id DESC` **before** `LIMIT`; new lib file has a `"scanned"` disposition | `chronology-ordering.test.js` (red-proof: flip to `ORDER BY id`) |
| **G5** §9.3 + WATCH-6 | Each guard recorded red-then-green; `grep -rn "assert.ok(true" server/__tests__/` and `grep -rn "\|\| true" server/__tests__/` both return 0; `single-writer-guard.test.js` **not** re-widened (no new writer), `assertSingleHome` dispositions updated for every new export | build report + `single-writer-guard.test.js` |
| **G6** client registries | Every new wire value has its client copy and its key in all four locales, mechanically enforced (`i18n.test.ts` E1.1 pattern) | `i18n.test.ts` |

**Additional cases this plan requires beyond G1–G6:**
- Overlap: drain in flight → `runValueSummaryTickOnce` returns `{skipped:"overlap"}` (R1).
- Probe writes no log row (DEC-9 / R7).
- Broadcast-on-transition (DEC-6): terminal iteration with `generated === 0` still emits.
- TTL expiry (DEC-8): a 25-hour-old flag is cleared with a log line and the project
  sorts passive.
- Client out-of-order snapshot delivery does not regress the header (R4).
- Per-stage model precedence table (DEC-7), extending `value-summary.test.js:251-252`.

**Sweep discipline before declaring done** (text sweeps are known-insufficient here):
also grep new specs for `typeof `, `Array.isArray`, bare `assert.ok(` with no compared
value, and empty `=> {}` bodies. **Trace each guard's fixture against the product
code's early-return chain** — a fixture is part of the assertion (§9.3's PLAN-LEVEL
VACUOUS FIXTURE). If a mutation this plan names would be invisible under the fixture
the plan implies, that is a **plan defect** — report it as one and fix the fixture.

**Runners:** `npm run test:server`, `npm run test:client`,
`bash .claude/skills/file-headers/scripts/check-headers.sh` (exit 0). Client snapshot
baselines change (`screens.snapshot.test.tsx`): regenerate **deliberately** with a
reviewed diff (`cd client && npx vitest run -u`), never blindly.

---

## 7. Risks & rollback

**Every scope boundary this plan knowingly declines is backed by a tracked row in
`requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/decisions.md`
(written 2026-08-05 as part of this plan), not by prose here.** The Architect's §9
"exclusions that must become tracked rows" list and the Engineer's §3 gotchas are
carried forward in full below — none of them is allowed to terminate in a sentence.

| Risk | Disposition | Tracked row |
|---|---|---|
| Building before the tree is right | Hard precondition §0; do not dispatch Slice 2 build first | **DEPENDENCY-F1** (corrected) |
| Drain↔tick two-writer race | Structurally removed: one module, one `running` guard | **DEC-4** (closes inherited WATCH-7) |
| Rotation starvation by a permanently-failing requested project | 24h TTL + cleared-with-log; flag kept on no-progress exit | **DEC-8** |
| Passive rotation slowed while a drain runs | Bounded by the iteration cap; watched | **WATCH-S2-D** (trigger: passive stalled >2 consecutive ticks with a drain active) |
| Client re-derivation of coverage/ETA | Single home + named parity test; the guard must catch re-*computation* | **DEC-5** + §5 |
| Progress regression via HTTP/WS race | `computed_at` monotonic merge rule, tested with out-of-order delivery | **DEC-5** (`computed_at` is in the snapshot contract) |
| New absence states collapsing (§9.8) | `demand` + `eta.state` closed server-authored registries; cold start named; drain-stalled = flag kept + `demand:"requested"`, never silence | **DEC-1, DEC-2, DEC-6** |
| No drain-vs-passive discrimination in the audit log | Knowing exclusion; a third `source` enum value would be a §9.6 rebuild | **WATCH-S2-A** |
| `requestedAltitudesRef` fetch-once semantics | Bypass for WS `unit_keys`; watched | **WATCH-S2-B** |
| ETA skew from mixed models after tiering | Accepted v1 | **WATCH-S2-C** (trigger: ETA observed materially wrong) |
| WATCH-5 git cost × drain batches + mount probes | Accepted, bounded, named | **WATCH-S2-E** |
| Client registry drift at the CJS/Vite boundary | Same-commit rule + canonical-source doc comment | **WATCH-S2-F** |
| Disabled auto-group button declined | Scope narrowed vs. the brief; AC-4 restated as an inherited Slice 3 AC | **DEC-2** |
| `MAX_PROJECTS_PER_TICK` left at 3 | OPEN-4 closed as superseded-in-part; no second tuning mechanism | **DEC-3** |
| Full `team-qa` not run | Fast mode; **`FAST — QA debt`** stamp required, naming `supporting/qa.md`'s DEFERRED list | **DEC-F2** |
| `PROJECT-CONTEXT.md` note not applied now | Deferred to the effort branch to avoid the git reconciliation sweeping it | **DEC-11** |
| Validation project choice | Non-blocking | **OPEN-S2-1** (PENDING Sara) |

**Rollback.** Every layer is independently reversible and the schema change is
additive-and-nullable by design, so a code-level revert leaves a working database
(§9.5's own guidance — `DB_PATH` is the user-global shared file, so the column reaches
the real dashboard the moment any worktree boots).
- **Client only:** revert `PlanLedgerPanel.tsx` + `api.ts` + `types.ts` + locales →
  panel returns to mount-time fetch; the widened WS payload becomes an unread field
  again (its original, documented state).
- **Routes/tick:** revert `project-plans.js` + `value-summary-tick.js` → the passive
  rotation is byte-identical to Slice 1's landed behavior; `coverage_requested_at` rows
  become inert data.
- **Schema:** leave the column. Dropping it requires a rebuild (§9.6) for no benefit —
  a nullable unread column is the cheapest possible back-out state.
- **Model tiering:** reversible **by env var alone**, no code change (DEC-10).

---

## 8. Definition of Done

Sequencing and rows
- [ ] §0 P1 git reconciliation complete, **after** a recorded `ps`/`lsof` check; no
      Slice 2 branch cut before it.
- [ ] §0 P2 **Slice 1 built and landed**; every `[S1-dep]` shape re-verified against its
      actual code.
- [ ] `decisions.md` DEC-1..DEC-11 / WATCH-S2-A..F / OPEN-S2-1 present and re-read
      against Slice 1's landed code **before the first line of build code**.

Product
- [ ] Passive path behavior-preserving for unflagged projects: view-triggered fast path
      + slow rotation, **never eager-backfill** (AC-1).
- [ ] Coverage request flags the project, jumps the rotation, drains to 100% (AC-2).
- [ ] Header renders "N of M described · ~X min remaining" from measured durations;
      cold start renders the named `estimating` state — **a rendered `~0 min` is a
      requirement violation, not a rounding choice** (AC-3).
- [ ] `coverageSnapshot.complete` is server-authored and on the wire; **no disabled
      Auto-group button ships**; AC-4 recorded verbatim as an inherited Slice 3
      acceptance criterion in the Slice 3 intake folder when it is opened (AC-4 as
      amended by DEC-2).
- [ ] The OPEN-3 WebSocket subscriber is wired and coverage updates **in place** in an
      open tab (AC-5).
- [ ] Calibration run on one real 40-unit batch **before** the per-stage defaults are
      pinned; artifact attached to DEC-10; per-stage env knob exists (AC-6).

Guardrails (minimum done-bar — `supporting/qa.md`)
- [ ] G1a / G1b / G1c / G2 / G3 / G4 / G5 / G6 each satisfied **and each observed red
      against a real mutation, red recorded per-test, restored byte-identical**.
- [ ] `server/__tests__/value-coverage-parity.test.js` exists as a named file and
      deep-equals route `coverage` against broadcast `coverage`.
- [ ] `grep -rn "assert.ok(true" server/__tests__/` and `grep -rn "|| true"
      server/__tests__/` return 0; new specs also swept for `typeof `,
      `Array.isArray`, bare `assert.ok(`, empty `=> {}` bodies.
- [ ] No pool-membership SQL outside `assembleValuePool`; `CONSUMERS`/DEC-15 green.
- [ ] Drain path does **not** read `MAX_PROJECTS_PER_TICK`; no `MAX_DRAIN_*` env var
      exists; `MAX_DRAIN_BATCHES_PER_RUN`'s comment cites the measured 182-unit pool.
- [ ] `server/index.js` diff is **empty**.

Hygiene
- [ ] Docs updated (§3.8) per the `update-project-docs` skill; DEC-11's planning note
      applied on the effort branch under "Planning notes for `team-intake` /
      `team-qa`", not in the numbered catalog.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] `npm run test:server` and `npm run test:client` green; snapshot baselines
      regenerated only with a reviewed diff.
- [ ] Build carries the **`FAST — QA debt`** stamp naming `supporting/qa.md`'s DEFERRED
      list, so a later `team-status` pass recommends the follow-up `team-qa` run
      (DEC-F2).
