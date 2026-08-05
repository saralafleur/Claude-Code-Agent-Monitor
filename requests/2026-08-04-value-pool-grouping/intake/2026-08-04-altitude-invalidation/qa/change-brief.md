# Change Brief — 2026-08-04-altitude-invalidation (Value Pool Slice 1)

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-08-04
- **Scope source:** intake-handoff — **planned, not yet built** (same situation as
  the sibling `2026-08-04-value-summary-tick` QA run). No effort branch or
  worktree exists (`git worktree list` and `git branch -a` verified 2026-08-04);
  the intended change is `technical-plan.md`'s 13-step change set (~21 files),
  to be built on a fresh worktree cut from **`origin/master` @ `55fe900`**.
- **Intake link:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/technical-plan.md`
  (+ `pm-plan.md`, `decisions.md` DEC-1..DEC-16 / WATCH-A..G / OPEN-1..4 /
  DEPENDENCY-1..3, `request-brief.md`, `supporting/{architect,engineer,qa,product-owner}.md`)

## Substrate verification (environment facts, checked — not assumed)

- `origin/master` = `55fe900` (merge of `effort/2026-08-04-value-summary-tick`).
  **Local `master` = `d830a44`, 2 commits behind, with a 45-entry dirty working
  tree from a concurrent session.** All substrate reads below were done via
  `git show origin/master:<path>`, never the local tree. The plan's Step 1
  environment gate (fresh worktree, never touch the main checkout, back up the
  live DB, `DASHBOARD_DB_PATH` on every test invocation) is itself part of the
  change set (DEPENDENCY-1).
- **Line-anchor spot-check against `55fe900`: all pass.** Verified directly:
  - `server/db.js:821-825` — the false *"immutable once seen … generated once,
    served forever"* comment is exactly there; CREATE body 826-832; log CREATE
    1822-1835 (four count terms + `source IN ('tick','request')` CHECK);
    PRAGMA-`table_info` precedent (`detour_dispositions.project_id`) at
    1017-1027; try/SELECT idiom to avoid at 1004-1009;
    `getValueUnitSummary`/`upsertValueUnitSummary` at 3192-3201;
    `insertValueSummaryGeneration` at 3234-3238 (10 params, no
    `stale_regenerated`).
  - `server/lib/value-summary.js` — header's "ONE lexical writer of the
    stakeholder-altitude cache table" claim at ~32-35; `ALTITUDE_STATES` at 47;
    `readCached(dbModule, unitKey)` at ~80-91; `buildPrompt` at 99-105 reading
    `u.stage`, `u.label || u.value_ref`, `u.value_source` directly (the disease
    this slice cures); `.slice(0, 12_000)` at 117 (WATCH-D); the sole
    `upsertValueUnitSummary.run(` at ~230 inside `enrichPoolAltitudes`.
  - `server/lib/value-ledger.js` — `stage: initiative.stage` stamped on both
    `intake_initiative` and `merge_commit` units at ~207-224 (DEC-6's factual
    basis); `trunk_commit` label-only at ~245; `detour` units carry **no `stage`
    key at all** at ~257-266 (the `undefined → null` normalization case).
  - `server/lib/value-summary-tick.js` — hand-rolled four-term counting loop at
    ~108-124 (to be replaced by composer `counts`, DEC-14);
    `insertValueSummaryGeneration.run("tick", …)` at ~158-169; broadcast at
    170-176.
  - `server/routes/project-plans.js` — `POST /altitudes` at 141-174; the
    sanitization loop coercing `label`/`stage` (`typeof … === "string" ? … :
    null`) at ~157-170; **no** generation-log write on this path today.
  - `server/__tests__/single-writer-guard.test.js` — exactly-one
    `upsertValueUnitSummary.run(` assertion at ~235; the scanner strips only
    `//` comments (~226-232 — the plan's G6 warning is accurate);
    `insertValueSummaryGeneration` expected set is `["db.js",
    "value-summary-tick.js"]` with the comment *"WATCH-6 will deliberately
    widen this … when request-path logging lands"* at ~259-265 — so the
    **deliberate red** on this guard is a designed, pre-announced moment, not a
    defect.
  - `server/__tests__/db-migration.test.js` — the `detour_dispositions.project_id`
    `UPGRADE_CASES` precedent at ~130-160.
  - Client: `PlanLedgerPanel.tsx` `Altitude` union at 321, `AltitudeText` at
    ~331-355, `PoolUnitRow` at ~357, hand-typed
    `!["queued","unavailable"].includes(state)` at 558; `api.ts` altitudes at
    ~2683-2716 with the states `Record<string,"queued"|"unavailable">` arm at
    ~2715.
- Minor internal inconsistency, cosmetic only: the plan's header says
  "DEC-1..DEC-15" while `decisions.md` also carries **DEC-16**
  (intake-complete/proceed row, appended after). No scope effect.

## Change summary

Make the Value Pool's per-unit altitude cache mutability-aware: store the prompt
input snapshot (`input_stage`, `input_label`) on each cached summary row, compare
it field-wise on every read for `MUTABLE_VALUE_SOURCES`
(`intake_initiative`, `detour`, `merge_commit` — DEC-6 deliberately overrides the
request's `merge_commit` fence), and treat a mismatch as an ordinary cache miss so
the existing batch/cap/partition machinery regenerates exactly that unit.
Stale-but-unrefreshed units keep serving their old text with a named `freshness`;
regenerated units carry an "updated — stage changed" marker until the user
explicitly acknowledges it (server-side `seen_at` via a new
`POST /api/project-plans/altitudes/seen` endpoint); the request path starts
writing generation-log rows (`source='request'`); and the false "generated once,
served forever" schema comment plus four docs are rewritten. The durable cure —
`buildPrompt` consumes a shared `unitFacts()` and nothing else, enforced by a
structural scan — is the one item the plan marks as never traded away.

## Changed files (by layer) — intended change set, per technical-plan.md §3

**Schema / data (server)**
- `server/db.js` — rewrite the 821-825 comment (must enumerate the input set and
  name `unitFacts()`); `value_unit_summaries` gains 5 nullable columns
  (`input_stage`, `input_label`, `regenerated_at`, `regen_reason`, `seen_at`);
  `value_summary_generation_log` gains `stale_regenerated INTEGER` (nullable,
  **no DEFAULT** — DEC-3: NULL = predates measurement, not a measured zero); two
  **PRAGMA `table_info`-guarded** ALTER blocks (DEC-5, probe on `input_label` so
  the 5-column block is all-or-nothing); `upsertValueUnitSummary` widened incl.
  `seen_at = NULL` in `DO UPDATE SET` (G3 — regeneration resets "seen" inside
  the one writer); new `markValueUnitSummariesSeen` statement;
  `insertValueSummaryGeneration` gains the `stale_regenerated` param. No CHECK
  touched → no §9.6 rebuild.

**Synthesis composer (server) — the §9.1/§9.8-critical surface**
- `server/lib/value-ledger.js` — new export `MUTABLE_VALUE_SOURCES` beside
  `VALUE_SOURCES`; nothing else changes.
- `server/lib/value-summary.js` — new `unitFacts(unit)` (sole normalizer:
  resolved label with `"(untitled)"` fallback, `undefined → null` stage);
  `buildPrompt` refactored to read **only** `unitFacts(u)`; new
  `compareUnitInputs(row, unit)` (precedence `stage_changed` > `label_changed`,
  legacy `input_label IS NULL` rows fall out stale with no special case —
  DEC-9/DEC-12); `readCached` takes the unit and returns
  `{cached, staleReason}` — a stale hit is literally a miss;
  `enrichPoolAltitudes` returns `{altitudes, states, counts}` (DEC-14) with
  freshness fields on resolved entries and the R3 re-homing rule (a unit with a
  cached row is ALWAYS in `altitudes`, never in `states`); new export
  `ALTITUDE_FRESHNESS = ["stale_refresh_queued","stale_refresh_unavailable","updated_unseen"]`
  (DEC-13); `ALTITUDE_STATES` unchanged; file header rewritten ("ONE lexical
  writer" claim narrowed to the synthesis columns).

**Background sweep (server)**
- `server/lib/value-summary-tick.js` — counting loop replaced by reading
  `counts`; passes `counts.stale_regenerated` to the log write. No scheduler /
  rotation / overlap-guard / `pending_after_sweep` change.

**Request fast lane (server)**
- `server/routes/project-plans.js` — `POST /altitudes` otherwise unchanged, but
  now writes a generation-log row with `source='request'`,
  `pool_size` = submitted batch size (DEC-4); **new endpoint**
  `POST /api/project-plans/altitudes/seen` `{project_id, unit_keys[]}` →
  `{updated: n}` (idempotent unconditional SET).

**Structural guards & tests (server)**
- `server/__tests__/single-writer-guard.test.js` — (1)
  `insertValueSummaryGeneration` file set widened to include the route,
  **deliberately red first** (the existing test's own 259-265 comment names
  this moment); (2) new single-call-site guard for `markValueUnitSummariesSeen`
  (a genuine second production writer to `value_unit_summaries`); (3) the
  MANDATORY `buildPrompt` structural scan (DEC-15: no `u.<field>`/`unit.<field>`
  access, strips `//` **and** `/** */`, scope non-empty + `facts.` sentinel);
  (4) comparator-single-home scan (only `value-summary.js` reads
  `input_stage`/`input_label`); (5) `assertSingleHome` `absent` lists updated;
  (6) the exactly-one `upsertValueUnitSummary.run(` assertion **stays at 1**.
- `server/__tests__/value-summary.test.js` — A1, D1–D6 (incl. the named
  `resumeJobPipelineTracker` legacy fixture), DEC-7 cross-path parity, widened
  wire-partition Case 5 + Case 6, combination cases (stale × over-cap,
  stale × LLM-down).
- `server/__tests__/value-summary-tick.test.js` — L1–L3 (four-term identity
  exact with `cache_hits` counting only snapshot-valid hits;
  `stale_regenerated` bounded; sweep drains via the shared read path).
- `server/__tests__/db-migration.test.js` — M1/M2 `UPGRADE_CASES` (M2 asserts
  legacy reads **NULL, not 0**), plus M1's behavioral leg (legacy mutable row
  stale, legacy `trunk_commit` row fresh). No new `GRANDFATHERED` entries.
- `server/__tests__/chronology-ordering.test.js` — expected no change (PRAGMA
  idiom adds no `SELECT … LIMIT` literal); verify, not assume.

**Client**
- `client/src/lib/types.ts` — entry gains `freshness?`, `update_reason?`,
  `regenerated_at?`; seen request/response types.
- `client/src/lib/api.ts` — altitude entry type widened (states `Record` arm
  unchanged); new `markAltitudesSeen`.
- `client/src/components/PlanLedgerPanel.tsx` — `Altitude` object arm gains the
  three fields; `AltitudeText` text rendering untouched; `PoolUnitRow` renders
  the marker + per-unit "×"; panel-level "dismiss all"; acknowledgement is
  **explicit only, never auto-on-render** (DEC-8); the hand-typed state list at
  558 unchanged.
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — 6 new keys under
  `planLedger.pool.altitudes.*`, all four locales.

**Tests changed in this set (client)**
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` — C1–C3.
- `client/src/pages/__tests__/screens.snapshot.test.tsx` — baselines
  regenerated only after reviewing the diff (intentional marker UI change).

**Docs & catalog**
- `PROJECT-CONTEXT.md` — two §9.8/§9.1 notes from `pm-plan.md` §6 DEC-10,
  verbatim, marked *count unchanged*, **on the effort branch only** (the main
  checkout is dirty with a concurrent session's work).
- `docs/API.md`, `docs/DATABASE.md`, `server/README.md`, `ARCHITECTURE.md` —
  all four currently document the generate-once contract; `update-project-docs`
  skill.
- `decisions.md` — created on-branch at Step 1.5 before any build code
  (DEPENDENCY-2), updated at Steps 4/12/15.

## Surfaces / features touched

- **Value Pool altitude synthesis** (`server/lib/value-summary.js`): `unitFacts()`
  extraction, `compareUnitInputs`, gated `readCached`, the wire shape
  (`altitudes`/`states`/`counts` + `freshness`).
- **Value pool taxonomy** (`server/lib/value-ledger.js`): `MUTABLE_VALUE_SOURCES`
  only; `assembleValuePool` untouched.
- **Background sweep** (`server/lib/value-summary-tick.js`): count sourcing +
  `stale_regenerated` logging; scheduler untouched.
- **Project-plans API** (`server/routes/project-plans.js`): `POST /altitudes`
  gains request-path logging; new `POST /altitudes/seen` endpoint.
- **SQLite schema** (`server/db.js`): 6 new nullable columns on 2 tables via
  guarded ALTERs against the **shared user-global** `dashboard.db` (migrations
  run at `require()` time — live-DB backup is a plan gate).
- **PlanLedgerPanel** (client): updated-marker render + acknowledge round-trip;
  4 locales.

## Variant relevance

Yes — this change is *centrally about* the project's #1 recurring class
(§9.1 DERIVED-DUAL-VIEW: one value, multiple render/compute paths):

- **Two production invokers of `enrichPoolAltitudes`** (route + tick) must see
  identical staleness for the same unit. The route reconstructs units from
  client JSON; the tick gets raw `assembleValuePool` units. `unitFacts()` as the
  sole normalizer + the DEC-7 cross-path parity test is the cure; the failure
  mode (a `""` vs `null` vs missing-key difference) is a unit oscillating
  stale↔fresh between paths, regenerating on **every alternation** — silent,
  unbounded LLM spend (engineer G8).
- **Four locales** must all carry the 6 new i18n keys (`i18n.test.ts` E1.1
  derives parity from `en`).
- **Client hand-copied registries** (§9.7's accepted CJS/Vite exception): three
  existing hand-copies of `ALTITUDE_STATES` stay unchanged (DEC-3), and
  `ALTITUDE_FRESHNESS` arrives as a **fourth hand-copied registry** (server
  export, `Altitude` union arm, `api.ts` response type, i18n key set) — WATCH-F,
  "must move in the same commit."
- **Old-client compatibility variant:** an un-upgraded tab must never blank text
  it was already displaying — hence freshness rides on resolved entries and
  `ALTITUDE_STATES` gains nothing (DEC-3, R3 re-homing rule).

## Test-invariants at risk

- [ ] **Cross-path consistency — §9.1 DERIVED-DUAL-VIEW** (6 touches on record;
  the twice-proven lesson is "a rogue-reader scan does not catch a rogue
  re-derivation"). Plan's posture: make §9.1 *inapplicable* (raw fields, no
  digest formula; reason computed once at read and carried to the write;
  `counts` computed once by the composer for both loggers). **The MANDATORY
  durable cure is the A2/DEC-15 `buildPrompt` structural scan** — no
  `u.<field>` access outside `unitFacts(u)`, comments stripped in both styles,
  scope-non-empty + sentinel, red-proven by injecting `u.value_ref`. This is the
  plan's one never-traded-away item; a build that ships without it observed red
  is the cure regressing.
- [ ] **Single-writer guards — §9.1 write-sequence form.** Two guards, two
  *opposite* expected behaviors: (a) `upsertValueUnitSummary.run(` **stays at
  exactly 1** — regeneration widens no writer guard; if it goes red the design
  was violated, do not widen; (b) `insertValueSummaryGeneration`'s file-set
  guard **goes red deliberately** when request-path logging lands and is widened
  in the same commit — prior-effort WATCH-6's pre-announced procedure (the
  shipped test's own 259-265 comment). A test author must not confuse the two.
  Plus a **new** guard for `markValueUnitSummariesSeen`, a genuine second
  production writer to the cache table, red-proven by rogue injection; the file
  header's "ONE lexical writer" claim is narrowed in the same diff.
- [ ] **Partition exactness — §9.8 OVERLOADED-ABSENCE + prior-effort DEC-11.**
  The four-term log identity `cache_hits + generated + queued + unavailable ===
  pool_size` stays **exact and four-term**; `stale_regenerated` rides as an
  **overlap counter, never a fifth term** (WATCH-A — the named risk is a test
  author "fixing" it into a five-term form). §9.8's exactly-one-state widening:
  every new distinguishable outcome is named (`ALTITUDE_FRESHNESS` × 3;
  `input_label IS NULL` = legacy, exactly one meaning; `stale_regenerated IS
  NULL` = predates measurement ≠ 0; `regenerated_at` = marker discriminator).
- [ ] **DEC-11: the log and wire partitions disagree BY DESIGN — a subtle trap
  for the test author.** For a stale-served unit: the **wire** puts it in
  `altitudes` with its old text (never `states`; R3 invariant — old clients must
  not blank visible text); the **log** counts it a **miss** (`generated`/
  `queued`/`unavailable`), never a `cache_hit`. **"Fixing" the disagreement in
  either direction regresses the design**: counting stale-served as `cache_hits`
  overshoots `pool_size` (L1's red proof); dropping stale units from `altitudes`
  blanks an old client's text (R3's red proof). Both regressions are one line
  each. Any test asserting log/wire agreement on stale units is asserting a bug.
- [ ] **Round-trip integrity — §9.5 FRESH-DB-BLIND + §9.2.** Six additive
  nullable columns must reach *existing* DBs via the PRAGMA-guarded ALTERs
  (DEC-5 — not the try/SELECT-LIMIT-1 idiom, which would feed §9.2's static
  scan a probe query); M1/M2 `UPGRADE_CASES` with legacy-NULL (M2: NULL, not 0)
  + idempotence + the behavioral leg. `seen_at` survives the full round-trip
  (acknowledge → reload → still seen) and is reset to NULL by the one writer on
  regeneration. No CHECK is touched, so §9.6 does not engage.
- [ ] **Vacuity discipline — §9.3 (this exact surface produced EIGHT §9.3-family
  events in the prior effort, incl. a vacuous repair of a vacuous guard).**
  Every named red proof in the plan's §6 table is per-test; M1's behavioral leg
  must trace the early-return chain (PLAN-LEVEL VACUOUS FIXTURE); no DoD row
  ticked on an agent's self-report; a repaired test needs a fresh red proof.
  The only technique that reliably worked: revert the product change and run
  the actual shipped spec file.
- [ ] **No unresolved-boundary-token leak** — marker copy comes from i18n keys
  chosen by `update_reason`, never hardcoded English; all four locales; C3
  keeps the out-of-registry warn path honest.
- [ ] **TEST-AGAINST-LIVE-DB (uncatalogued candidate, promotion trigger = this
  slice).** DDL ships; `db.js` migrates at `require()` time against the real
  `~/.claude/agent-dashboard/dashboard.db` when `DASHBOARD_DB_PATH` is unset.
  Every spec block that `require`s `../db` sets it (per-file grep is a
  proven-invalid sweep). If the build declines to promote the pattern, that
  decline needs its own `decisions.md` row.

## Stated intent / acceptance

Requester's signals (request-brief §8): (1) `trunk_commit`/`merge_commit`
unchanged; (2) stage/label mismatch regenerates exactly that unit (the Resume
`2026-08-03-job-pipeline-tracker` text updates); (3) visible "updated — stage
changed" marker until seen; (4) invalidation lands in the generation log with a
reason; (5) vision-level: the user is always told when something they saw has
changed.

**Plan-vs-request divergences, both tracked, neither silent:**
- Signal 1 is **deliberately overridden** by DEC-6: `merge_commit` IS mutable
  (it carries `stage: initiative.stage` — verified at `value-ledger.js:216-223`);
  PO AC-1 is restated as "`trunk_commit` unchanged" only. One-string veto path
  recorded.
- Signal 5 is met **on next view, not in place** — no WebSocket subscriber ships
  (OPEN-1, PENDING Sara, a knowing reduction of the headline promise; the tick's
  broadcast still goes to nobody).
- The request's "digest" vocabulary is replaced throughout by "input snapshot"
  (DEC-2 overrode the architect's `input_digest` design; QA's pre-existing plan
  was written around `computeUnitInputDigest` and is re-targeted per plan §6:
  A1 → comparator stability/sensitivity, A3's mutation applies verbatim).

## Open questions

**Blocking (cannot plan tests):**
- None.

**Non-blocking (proceeding on assumption):**
- Plan header says DEC-1..DEC-15; decisions.md carries DEC-16 (intake-complete
  row, appended after the plan was written) → assumption: numbering note only,
  no scope change.
- `readCached` cited at "~81-94"; at `55fe900` it sits at ~80-91 → assumption:
  tilde-approximate anchors are fine; all load-bearing anchors verified exact.
- OPEN-2/3/4 (validation project; `MAX_PROJECTS_PER_TICK` in Sara's real `.env`,
  which sets the WATCH-B legacy-burst drain time: ~4h10m at defaults vs ~1h40m
  at 8; marker copy taken as approved) → all PENDING (Sara), none block test
  planning.
- The change is unbuilt, so "tests changed in this set" are *planned* test
  changes; coverage evaluation grades the plan's named test/red-proof
  obligations, and the build must be graded again against the actual diff
  (§9.3's AGENT-SELF-REPORTED-RED).

## Verdict

**READY** — the intended change is pinned to a verified substrate (`55fe900`),
every load-bearing line anchor spot-checks true, the plan/decisions/request
triangle is coherent, and the two places the plan disagrees with the request
(DEC-6, OPEN-1) are tracked rulings with veto paths, not ambiguities.
