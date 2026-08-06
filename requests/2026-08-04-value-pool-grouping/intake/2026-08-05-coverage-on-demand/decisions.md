# Decision Log — 2026-08-05-coverage-on-demand (Value Pool Slice 2)

**Parent request:** `requests/2026-08-04-value-pool-grouping/request.md` (four-slice
vision; this folder is **Slice 2 only** — coverage-on-demand + progress UX +
model tiering).
**Run mode:** **fast** (implies auto-pilot + direct). PREFERENCE gates are taken
by the team and logged `DECIDED-AUTO`; Sara may reverse any of them without
reopening the work. QA is deferred by design — see DEC-F2.

Conventions inherited from the sibling intake
`intake/2026-08-04-altitude-invalidation/decisions.md`: **DECIDED-AUTO** =
taken by the team, reversible by Sara without reopening; **PENDING (Sara)** =
carries a recommendation, does not stop work unless the row says it does;
**WATCH** = carried-forward risk with an owner and a promotion trigger;
**DEPENDENCY** = hard sequencing gate. Numbering is folder-local.

**Id namespacing (added 2026-08-05 by intake-tech-lead):** folder-local WATCH
rows are prefixed `WATCH-S2-` so they cannot be confused with the *inherited*
prior-effort rows (WATCH-5 git cost, WATCH-6 single-writer widening, WATCH-7
two-writer race, WATCH-8 re-derive-never-decrement) or with Slice 1's
`WATCH-A..G`, all of which are cited here by their original ids.

---

## Orchestrator rows (opened 2026-08-05 at run start)

### DEC-F1 — Scope: this run intakes Slice 2 only — DECIDED-AUTO

**Where we're coming from:** Sara invoked `/team-intake fast` on "the
value-pool-grouping request" (2026-08-05). The request file defines four
slices and mandates *"Slices ship independently, in order, each through the
full pipeline on its own effort branch."* Slice 1 (altitude-invalidation) was
intaken 2026-08-04 and is mid-build (uncommitted working-tree diff on the main
checkout as of this run). Slices 3 and 4 are gated on Slice 2's coverage
mechanism.

**Options:** (a) intake Slice 2 only, next in the mandated order; (b) intake
all remaining slices 2–4 in one pass, contradicting the request's own
sequencing rule; (c) stop and ask.

**Decision:** (a) — the request itself decides the order; nothing to ask.
Slices 3–4 get their own intake runs after Slice 2 lands.

### DEC-F2 — Fast mode: QA stage deferred — DECIDED-AUTO

Fast mode's standing trade-off, logged per the skill: after this intake, the
auto-decision is **proceed straight to `team-build fast`**, skipping the
`team-qa` stage. The build must carry a **`FAST — QA debt`** stamp so a later
`team-status` pass recommends the follow-up `team-qa` run. Trade-off named:
Slice 2 touches the sweep loop, `value_summary_sweep_state`, and the first
client WebSocket subscriber — regression guards for those surfaces arrive
late, not never.

**Scope of the debt (added 2026-08-05, intake-tech-lead):** the stamp must name
`supporting/qa.md`'s DEFERRED list verbatim — full E2E of the coverage-request
flow, `screens.snapshot.test.tsx` baselines for the header/"prioritize now"
control, drain-loop load/perf (WATCH-5 git cost, WATCH-7 race frequency under
continuous drain), WS subscriber lifecycle edge cases (reconnect, stale-tab
merge) beyond the G2 parity assertion, calibration output quality judgment, and
locale copy review beyond mechanical key-completeness. `supporting/qa.md`'s
**G1–G6 are NOT deferred** — they are this build's minimum done-bar
(`technical-plan.md` §6/§8).

### DEPENDENCY-F1 — Slice 1 must land before Slice 2 builds — **CORRECTED 2026-08-05**

**Original claim (now known wrong):** Slice 2's staleness/coverage semantics
assume Slice 1's input-snapshot columns and regeneration path exist, and the
~2,000-line uncommitted working-tree diff on the main checkout at run start
*was* Slice 1's build.

**Correction:** the intake-architect and intake-engineer **independently**
verified live against the actual repo that this premise was factually wrong.
The uncommitted diff is the **prior effort, `value-summary-tick`**
(16 of 23 files byte-identical to origin's already-merged commit `55fe900`),
not Slice 1. Local `master` is 6 commits ahead / 2 behind `origin/master`.
**Slice 1 (`altitude-invalidation`) has zero build code anywhere** — no
`input_digest`, no `ALTITUDE_FRESHNESS`, no `counts` return in
`assembleValuePool` — only its intake docs exist
(`intake/2026-08-04-altitude-invalidation/`).

**Corrected dependency chain, in order:**
1. Reconcile the git divergence on the main checkout (drop the staged
   duplicate of the already-merged `value-summary-tick` diff, merge/rebase
   onto `origin/master`) — **concurrent-session risk applies**: 3 live
   `claude` sessions plus a Vite dev server are running from this repo's cwd
   right now (engineer verified live); check `ps`/`lsof` before any git
   operation that touches the working tree, per this project's standing
   concurrent-session guidance.
2. Build Slice 1 for real (technical-plan.md already exists at
   `intake/2026-08-04-altitude-invalidation/`; it has not been executed).
3. Only then branch Slice 2's build from a tree containing Slice 1.

Owner: whoever dispatches `team-build` for this folder — **do not dispatch a
Slice 2 build directly; dispatch Slice 1's build first.**

**Step 1 (reconciliation) — DONE, 2026-08-05.** Verified per-file that the
staged diff was byte-identical to `55fe900` for every tick-feature file
(10/10 checked); the divergence in `db.js`/`api.ts`/`types.ts`/four doc files
was independently confirmed to be 100% attributable to local's own
already-committed Playbook feature (`21ab284`), unrelated to the tick
feature. Confirmed with Sara before touching the shared main checkout (3 live
Claude sessions attached to this cwd at the time). Executed: `git stash` the
staged duplicate (reversible) → `git merge origin/master` (one conflict, in
`client/src/lib/types.ts` — two independent, non-overlapping additions to the
same JSDoc list and union-type tail; resolved by combining both, no data
lost) → merge commit `c8eecf3`, pre-commit hook ran the full test:server +
test:client suite, **all 61 test files / 805 tests passed** → confirmed the
stash was now a full no-op against the merged tree (`git stash apply`
produced zero changes) → dropped it. Local `master` is now 0 behind
`origin/master` (was 2), 7 ahead (was 6, +1 merge commit). **Step 2 (build
Slice 1 for real) is next — not yet done.**

---

## Synthesis rows (opened 2026-08-05 by `intake-tech-lead`, transcribed from
`pm-plan.md` PM-1..PM-6, `supporting/architect.md` §9 and
`supporting/engineer.md` §3 — per the PM's own requirement that these exist as
rows **before the first line of build code**, and per the standing rule that a
knowingly-declined scope boundary must be a tracked row, never prose)

### DEC-1 — "Described" = fresh-or-immutable (open point C / PM-1 / architect §5) — DECIDED-AUTO

A stale-but-cached mutable unit counts as **NOT described**, for both the
header's N and the drain's target. Rationale is architectural, not
preferential: under Slice 1's design a stale hit is literally a *miss inside
the composer*, so this is what the single home already computes; ruling the
other way forces coverage to be derived from a second classification that
disagrees with the composer's own (§9.1 manufactured by a semantics decision).

**Two consequences that must stay written down** (this is DEC-11's wire/log
divergence shape one layer up; an undocumented version *will* be "fixed" into
the wrong agreement by a later reader):
1. The header can read **"180 of 182 described" while all 182 units display
   text**. **Described ≠ displayed, by design.**
2. Copy discipline: header and any future gate tooltip say **"described"** (a
   current-state claim), never "generated" (a historical one).

### DEC-2 — No disabled Auto-group button in Slice 2; `coverageSnapshot.complete` ships instead (open point D / PM-2) — DECIDED-AUTO

**Overturns the brief's stated assumption D.** Slice 2 ships only the coverage
header + "prioritize now". A scaffolded button would render identically for
"disabled because coverage is incomplete" and "disabled because the feature
does not exist yet" — §9.8 OVERLOADED-ABSENCE manufactured at the UX layer by
the slice whose standing trap that is. It is also the cheaper direction (four
locale files + a client registry copy at the WATCH-E/F drift site + a snapshot
baseline, for a control Slice 3 rewrites).

**Binding conditions (without these this degenerates into nothing — §9.4):**
- `coverageSnapshot` MUST carry a server-authored `complete` boolean, so
  Slice 3's gate is a pure read of one server field, never a client-side
  re-derivation of `described === pool_size`. **Non-negotiable.**
- Acceptance signal 4 is restated verbatim as an **inherited Slice 3
  acceptance criterion**: *"the group action is visibly disabled until
  coverage is 100%, showing the ETA and a 'prioritize now' action."* To be
  copied into the Slice 3 intake folder when it is opened.
- Sara-reversible cheaply and additively (one component, four locale keys, one
  snapshot regeneration).

### DEC-3 — OPEN-4 / `MAX_PROJECTS_PER_TICK` CLOSED as superseded-in-part (open point H / PM-3) — DECIDED-AUTO

Closes the prior effort's **OPEN-4** and Slice 1's carried **OPEN-3** (asked
three times, answered zero times). Four parts:
1. Priority drain is the product answer for on-demand coverage.
2. `MAX_PROJECTS_PER_TICK` keeps its shipped default of **3** and the
   10-minute cadence. Post-Slice-2 the 250-minute worst case describes
   *passive backfill nobody is waiting on* — a spec, not a defect. Document,
   do not tune.
3. **No second tuning mechanism.** No `MAX_DRAIN_*` env-var family. The
   drain's iteration cap is a *safety bound* — a constant whose declaring
   comment cites the measured 182-unit pool (§9.8 bounds rule). **The drain
   path must not read `MAX_PROJECTS_PER_TICK` at all**; that knob governs
   passive rotation width only. This is a build obligation, because the
   obvious wrong "reconciliation" is to couple the two.
4. Operator note (not a decision, not blocking): in the window between Slice 1
   and Slice 2 landing, `MAX_PROJECTS_PER_TICK=8` in Sara's `.env` is the last
   legitimate temporary use of the knob.

### DEC-4 — Drain mechanism: out-of-cadence kick + drain-first resume, one runner, one guard (open point A / architect §3) — DECIDED-AUTO

Option (iii). `runCoverageDrain()` lives **inside
`server/lib/value-summary-tick.js`** and shares the existing module-scope
`running` overlap guard with `runValueSummaryTickOnce`. `POST /coverage-request`
kicks it fire-and-forget; if it is interrupted (error, overlap, restart,
iteration cap) the flag persists and the next scheduled tick re-enters
drain-first via one new leading `ORDER BY` term. **Not a new module:** a second
module needs a second guard or an exported mutex, both new §9.1/§9.7 surfaces.
This makes the inherited **WATCH-7** two-writer race structurally impossible
rather than re-litigating it.

### DEC-5 — Single home for coverage + ETA: `server/lib/value-coverage.js`, fed only by the composer's `counts` (open point F / §9.1 / architect §4) — DECIDED-AUTO

`coverageSnapshot()` and `estimateEta()` live in one new module; the object it
returns is carried **verbatim** by the HTTP route and by the WS payload. Its
only numeric input is Slice 1's DEC-14 `counts` from `enrichPoolAltitudes` —
DEC-14 extended one hop, not bypassed. The client renders fields and **never**
computes a percent, a remaining count, or an ETA.

**Overrides `supporting/engineer.md` §1.3**, which proposed
`computeCoverage(dbModule, units)` inside `value-summary.js`, re-walking the
units through the cache/freshness read. That signature re-implements the
composer's own classification of "described" — the second derivation §9.1's
twice-proven lesson says is what actually ships. The engineer's *db.js
statement* (`listRecentValueGenerationDurations`) is adopted unchanged;
only the placement/signature of the computation is overridden.

### DEC-6 — WS: additive `coverage` field on `value_altitudes_updated`, and the broadcast condition widens too (architect §4 / PM-6) — DECIDED-AUTO

No new message type (CLAUDE.md's WS stability rule; a second type would give
the client two sources to reconcile — §9.1 again). Payload becomes
`{ project_id, unit_keys, pending, coverage }`. **The broadcast condition must
widen from `generated > 0` to `generated > 0` OR a change in
`demand`/`complete` since the last broadcast for that project** — otherwise the
terminal "now complete" transition is silent and Slice 3's gate never enables
without a remount. Pin with a test; if a builder narrows it back, that is the
defect.

### DEC-7 — Model tiering: one `summaryModel(stage)` cascade + exported `SUMMARY_STAGES` (open point G seam) — DECIDED-AUTO

`summaryModel(stage = "unit")` prepends exactly one per-stage env var
(`DASHBOARD_VALUE_SUMMARY_UNIT_MODEL` / `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL`)
to **today's existing chain, written once**. `SUMMARY_STAGES = ["unit",
"grouping"]` is exported as the registry.

**Overrides `supporting/architect.md` §6**, which proposed a separate
`groupingModel()` sibling function. Two functions means the fallback tail
(`DASHBOARD_VALUE_SUMMARY_MODEL → DASHBOARD_FOCUS_SUMMARY_MODEL →
DASHBOARD_FOCUS_INFER_MODEL → "haiku"`) is written twice — §9.1's rogue
*re-derivation* form, one call frame away, which this catalog has now recorded
three times. The architect's binding constraints are kept: no stage-keyed
model map, one fallback chain, and a JSDoc line naming Slice 3 as the
`grouping` stage's only consumer so a §9.3 "exported and never called" sweep
does not read it as dead.

### DEC-8 — Coverage-request expiry: 24h TTL, cleared-with-log; flag kept on no-progress exit (engineer G1 / PM-6 "DECISION NEEDED at build") — DECIDED-AUTO

**The PM explicitly refused to leave this to the implementer; ruled here.** A
flagged project that can never reach 100% (broken repo root, every unit
`unavailable`) would otherwise sort first forever, burn one of three rotation
slots indefinitely and spawn LLM calls every tick.

Policy: `COVERAGE_REQUEST_TTL_MS = 24h`. The tick's target selection treats a
`coverage_requested_at` older than the TTL as **passive** and clears it with a
single loud log line; the project reverts to `demand: "passive"` and the user
may re-request. **Do NOT clear on a single `outcome='error'` sweep** — transient
errors must resume, which is exactly the behavior DEC-4's flag-persistence
buys. The cutoff is computed in JS and passed as an ISO parameter (testable;
no `datetime('now')` inside the statement).

### DEC-9 — Probe mode writes no `value_summary_generation_log` row (architect §4.2 / R7 / PM-6) — DECIDED-AUTO

`GET /coverage` runs the composer in probe mode (classify only, route every
miss to `queued`, never spawn). Nothing was generated, and logging probes would
pollute the ETA's own input. Asserted by test: a probe run leaves the log
row-count unchanged.

### DEC-10 — Calibration runs before the per-stage defaults are pinned (open point G / acceptance signal 6) — DECIDED-AUTO, **RESOLVED 2026-08-06**

One real 40-unit batch through `buildPrompt` + `runClaudePromptJson` twice
(`haiku`, `sonnet`) from a throwaway scratchpad script — **not committed
product code**. Durable outputs: the side-by-side artifact attached to this row
at build time, plus the chosen per-stage defaults in DEC-7. Cost is explicitly
not the driver (~$0.001/unit); quality-per-tier is. Sara reversible by env var
alone, no code change.

**Ran 2026-08-06, real batch, this repo's own live Value Pool (102 real units,
40 used, project id `c9ff0e07-7184-4523-8b70-d85a2cddaa75`).** Both models
returned valid, fully-parsed JSON for all 40 units (sonnet 94.5s first try;
haiku failed at a 120s timeout on its first attempt, succeeded in 102.8s on a
retry — a reliability data point in its own right). Sonnet showed real
relational reasoning the prompt explicitly asks for and haiku did not:
correctly cross-referencing paired units ("paired with its merge (unit 4)" /
"(unit 3)") and using the "stands alone" framing for unrelated units; haiku
produced topically correct but relationally flat output with no cross-unit
awareness anywhere in the 40-unit sample. Sara's call: **sonnet for both
stages.** Pinned via `DASHBOARD_VALUE_SUMMARY_UNIT_MODEL=sonnet` and
`DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL=sonnet` in `.env` (documented in
`.env.example`) — no product code changed, per the reversibility promise
above. **AC-6 is now met.**

### DEC-11 — `PROJECT-CONTEXT.md` planning note is applied on the effort branch, not now (PM-5) — DECIDED-AUTO

The note ("intake throughput can outrun build throughput, and the working tree
pays for it") is written verbatim in `pm-plan.md` §PM-5 and lands under
**"Planning notes for `team-intake` / `team-qa`"** — *not* in the numbered
defect catalog (it is a process pattern, not a defect class). Deferred to the
effort branch because `PROJECT-CONTEXT.md` is tracked and clean inside a 6/2
diverged checkout with a large staged diff, and editing it now risks it being
swept into the git reconciliation.

---

## WATCH rows (folder-local, Slice 2)

### WATCH-S2-A — No `source='drain'` in the generation log (architect R6 / engineer G2)

`value_summary_generation_log.source CHECK(source IN ('tick','request'))`. A
third value is a §9.6 full-table rebuild. Drain iterations log as `'tick'`;
they stay identifiable by project + tick window (multiple rows, one window).
**Knowing exclusion**, not an oversight. **Promotion trigger:** a real
operational need to distinguish drain rows from passive-rotation rows in the
audit trail.

### WATCH-S2-B — `requestedAltitudesRef` fetch-once semantics end here (architect R8)

`PlanLedgerPanel`'s `requestedAltitudesRef` was designed for a world without
live updates; Slice 2 ends that world. WS `unit_keys` must bypass/clear the ref
for exactly those keys. **Promotion trigger:** a live-updated unit observed
rendering stale text because the ref suppressed its refetch.

### WATCH-S2-C — ETA average mixes models after tiering (architect §6)

Once per-stage tiering lands, `duration_ms` rows from different models are
averaged together and skew the estimate. Acceptable v1 (still real
measurements, still "never a guess"). **Promotion trigger:** the ETA observed
materially wrong → move to model-filtered averaging.

### WATCH-S2-D — A running drain occupies one passive rotation slot (PM-3 part 4)

Bounded by the drain's iteration cap; expected ~5 batches for a 182-unit pool.
**Promotion trigger:** passive rotation observed stalled for more than two
consecutive ticks while a drain is active.

### WATCH-S2-E — WATCH-5 git cost multiplied by drain batches + mount probes (architect R10)

Each drain iteration re-assembles the pool (one git walk) — ~5 per 182-unit
drain — and each panel mount runs one probe walk. Accepted and named so it is
not rediscovered as a surprise. **Promotion trigger:** panel-mount latency or
tick duration regression observed on a real fleet.

### WATCH-S2-F — New wire registries at the CJS/Vite boundary (WATCH-E/WATCH-F inherited, triggers already firing)

`demand` (`passive`/`requested`/`draining`) and `eta.state`
(`measured`/`estimating`/`none`) are new hand-typed client copies in
`types.ts` / `PlanLedgerPanel.tsx` — the catalog's most common drift site. Both
inherited WATCH triggers fire on "any growth". Same-commit rule + a doc comment
naming the canonical server export (the `TrunkDriftResult["skipped"]`
precedent, §9.7's accepted exception). **Promotion trigger:** any Slice 3
growth of either registry.

---

## Carried OPEN rows

### OPEN-S2-1 — Validation project choice (carried from the parent effort's OPEN-2) — PENDING (Sara)

Which real project is used to validate the coverage flow end to end. Does not
block; recorded so it does not silently close.
