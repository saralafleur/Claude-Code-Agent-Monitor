# Architect Assessment — Slice 2: coverage-on-demand + progress UX + model tiering

**Intake:** `2026-08-05-coverage-on-demand` · **Mode:** fast (decisive picks, options logged)
**Author:** intake-architect · **Date:** 2026-08-05
**Verified against:** the main checkout working tree at `c6f8154` + its staged
23-file diff, `PROJECT-CONTEXT.md` §9 catalog, Slice 1's `technical-plan.md`
(the *planned* Slice 1 shape — see §0, it exists in no tree yet).

---

## 0. Environment finding first (corrects DEPENDENCY-F1's stated premise)

Verified live, 2026-08-05:

- `git merge-base --is-ancestor 55fe900 HEAD` → **NOT an ancestor**. Local
  `master` (`c6f8154`) does not contain the merged value-summary-tick effort.
- The ~2,000-line, 23-file staged diff on the main checkout **is the
  value-summary-tick build itself** (`server/lib/value-summary-tick.js` is an
  **A**dd in `git status`; the diff contains no `unitFacts`, no
  `ALTITUDE_FRESHNESS`, no `input_stage` — Slice 1's signature symbols).
- No `effort/2026-08-04-altitude-invalidation` branch or worktree exists
  (`git branch -a`, `git worktree list`, `ls ~/CODE-LOCAL/SARA/efforts/`).

So DEPENDENCY-F1's sentence "Slice 1's build sits uncommitted on the main
checkout" is **misattributed**: the uncommitted diff is the *prior* (tick)
effort, and **Slice 1 has not been built anywhere I can find**. Slice 2's
build is therefore gated on **two** landings, not one: (1) the staged tick
diff reaching `master`, then (2) Slice 1 being built and landed per its
technical plan. Every line-level citation below is against the tick substrate
(the staged tree) plus Slice 1's *planned* shapes (`counts` on the composer
return, `ALTITUDE_FRESHNESS`, request-path logging DEC-4).

**This needs a decisions.md row, not prose** — recommend updating
DEPENDENCY-F1 with the corrected evidence rather than adding a sibling row.

---

## 1. Affected subsystems & boundaries

| Boundary | Owner today | Slice 2 change |
|---|---|---|
| Sweep rotation + overlap guard | `server/lib/value-summary-tick.js` (module-scope `running`, `listSweepTargets`, per-project fail-safe) | Priority selection + in-module drain loop (§3) |
| Sweep bookkeeping schema | `server/db.js:1839-1843` (`value_summary_sweep_state`: `project_id PK, last_swept_at, pending_after_sweep`) | +`coverage_requested_at TEXT` (nullable) — §9.5 three-part landing |
| Generation audit log | `server/db.js:1845-1862` (`duration_ms`, `model`, `created_at`, per-project index already exist) | Read-only for ETA; **no CHECK change** (§5, R6) |
| Altitude composer | `server/lib/value-summary.js` `enrichPoolAltitudes` (sole writer; Slice 1 adds `counts` to its return, DEC-14) | New probe/no-spawn option; `counts` is the coverage snapshot's only input |
| Pool membership | `server/lib/value-ledger.js` `assembleValuePool` + `CONSUMERS` (DEC-16) | Denominator M comes only from here, via the composer |
| Broadcast contract | `server/index.js:466-467` → tick's `broadcast("value_altitudes_updated", …)` (`project_id`, `unit_keys`, `pending`; zero subscribers — `types.ts:2746` documents this) | Additive payload widening (§4) |
| HTTP surface | `server/routes/project-plans.js` (`POST /altitudes` at 141-174) | +`POST /coverage-request`, +`GET /coverage` |
| Client panel | `client/src/components/PlanLedgerPanel.tsx` (mount-time fetch only; `requestedAltitudesRef` once-ever set at 519) | Coverage header, gated auto-group control, **first-ever** `eventBus.subscribe` |
| Model knob | `value-summary.js:63-70` `summaryModel()` cascade | +grouping-stage knob in the same cascade shape (§6) |

---

## 2. Current design (and how it does/doesn't follow the catalog)

The passive path is exactly what Slice 2 must preserve: `PlanLedgerPanel`
fetches the pool, POSTs the full unit list to `/altitudes` (view-triggered
fast path, ≤40-unit batch), and `value-summary-tick.js` sweeps
`MAX_PROJECTS_PER_TICK=3` projects per 10-minute tick, least-recently-swept
first. Progress today is only `pending_after_sweep` — a single number that
§9.8's own promotion note (Trap C) already flags as unable to distinguish
"draining" from "treading water," and it reaches no client: the
`value_altitudes_updated` broadcast has **zero subscribers by design**
(prior-effort DEC-8/OPEN-3; `types.ts:2755` says so verbatim).

Catalog posture of this surface: it is §9.8 OVERLOADED-ABSENCE's **live
instance #1** and the record-holder for §9.3 events (eight in the prior
effort). The single-source-of-truth pattern this project has named for
exactly Slice 2's shape is **§9.1 DERIVED-DUAL-VIEW** — a derived value with
two delivery paths whose "failure lands when consumer #2 appears." Coverage
and ETA arrive with consumer #2 (WS) *on day one*. The current code complies
with §9.1 via DEC-14's precedent: `counts` computed once inside the composer,
read by both loggers. Slice 2 must extend that precedent, not bypass it.

---

## 3. Open point A — the drain mechanism (ruling)

### Options

- **(i) Priority selection only.** Flagged project sorts first in
  `listValueSweepTargets`; still one ≤40 batch per 10-min tick. 182 units ≈
  5 ticks ≈ **50 minutes even prioritized**. Cheap, but fails the requester's
  own words ("drain continuously to 100%"). Rejected.
- **(ii) In-tick batch loop.** Flagged project's tick slot loops
  composer-batches back-to-back until pending re-derives to 0. Continuous,
  but first progress waits up to 10 min for the next tick — the "prioritize
  now" click would visibly do nothing. Rejected as sole mechanism.
- **(iii) Out-of-cadence drain on request + (ii) as resume.** The
  coverage-request POST immediately invokes a drain loop through the **same
  runner module and same overlap guard**; if the drain is interrupted
  (error, restart, overlap), the flag persists and the next scheduled tick
  re-enters drain-first via (ii)'s ordering. **Recommended.**

### Recommended design (concrete)

1. **Flag = timestamp, not boolean.** `value_summary_sweep_state` gains
   `coverage_requested_at TEXT` (nullable). NULL = passive — one meaning
   (§9.8). A timestamp orders multiple flagged projects (oldest request
   drains first) and lets the UI say when the request was made. Ships as
   CREATE-body + PRAGMA-`table_info`-guarded ALTER + `UPGRADE_CASES` entry,
   no `GRANDFATHERED` rows (§9.5, Slice 1 DEC-5 precedent at
   `db.js:1017-1026`-idiom).
2. **One runner, one guard.** `runCoverageDrain(dbModule, projectId, opts)`
   lives **in `value-summary-tick.js`**, sharing the module-scope `running`
   overlap guard with `runValueSummaryTickOnce`. This is the WATCH-7 answer:
   the two-writer race between drain and tick is made structurally
   impossible — whichever holds `running` runs; the other returns
   `{skipped:"overlap"}`. The passive tick fires again in ≤10 min, so a
   drain-caused skip costs at most one rotation slot. The drain must **not**
   be a new module: a second module would need a second guard or an exported
   mutex, both of which are new §9.1/§9.7 surfaces.
3. **Drain loop shape.** Per iteration: `assembleValuePool` → 
   `enrichPoolAltitudes` (one ≤40 batch, unchanged cap) → write sweep state
   with re-derived `pending = queued + unavailable` → log one generation row
   → broadcast (§4). Loop while `pending > 0` **re-derived from that
   iteration's own full-pool counts** — never a decremented local counter
   (WATCH-8 / QA-DEC-2; pool growth mid-drain must extend the drain, and
   this shape gets that for free because each iteration re-assembles the
   pool). Yes, that is one git walk per batch (WATCH-5): ~5 walks for a
   182-unit pool, bounded and honest — accepted cost, note it in the plan.
4. **Termination, bounded.** Exit conditions, each named: (a) `pending === 0`
   → clear `coverage_requested_at` (set NULL) **in the same write** as the
   final sweep-state upsert, broadcast the terminal snapshot; (b) composer
   iteration returns `outcome=error` → **stop the loop, keep the flag** —
   next scheduled tick resumes drain-first; never hot-loop a failing
   project; (c) a hard iteration cap (e.g. `MAX_DRAIN_BATCHES_PER_RUN = 25`,
   comment citing the measured 182-unit pool per §9.8's "bounds cite their
   distribution" corollary) → keep the flag, resume next tick. A batch that
   generates 0 while pending > 0 (LLM went down mid-drain: everything lands
   `unavailable`) also stops the loop with the flag kept — looping on it
   would spin without progress.
5. **Passive tick becomes drain-aware, minimally.** `listValueSweepTargets`
   ORDER BY gains one leading term: `coverage_requested_at IS NOT NULL`
   projects first (oldest request first), then the existing
   never-swept/oldest ordering — sort keys remain real timestamps (§9.2).
   When the tick's loop hits a flagged project it runs the drain loop for it
   instead of a single batch, then continues its remaining passive slots.
   Passive projects still get `MAX_PROJECTS_PER_TICK − (flagged swept)`
   slots per tick; starvation of the passive fleet is bounded by the drain's
   iteration cap, and the drain is expected to be rare and short (~5
   batches). No change to `MAX_PROJECTS_PER_TICK` semantics — the coverage
   request is per-project priority, not a second global tuning mechanism
   (open point H stays reconcilable exactly as the brief's stated
   assumption; PM owns the row).
6. **New writers.** The drain adds `insertValueSummaryGeneration` /
   `upsertValueSweepState` call sites **within the already-guarded tick
   file**; if the guard counts lexical call sites, widen deliberately in the
   same commit, red-proven by injection (WATCH-6). The coverage-request
   route writes only `coverage_requested_at` — give the new statement
   (`requestValueCoverage`) its own single-call-site guard, same shape as
   Slice 1's `markValueUnitSummariesSeen` guard.

---

## 4. Open point F + §9.1 single-home — coverage/ETA computation and the WS payload (ruling)

### The single home

**One new module, `server/lib/value-coverage.js`, exporting exactly two
functions; every consumer — HTTP and WS — carries its output verbatim.**

- `coverageSnapshot(dbModule, { projectId, counts, requestedAt, computedAt })`
  → the one object both wires carry:

  ```
  {
    project_id,
    described,        // counts.pool_size - counts.queued - counts.unavailable
    pool_size,        // counts.pool_size (assembleValuePool via composer — DEC-16; no pool SQL here)
    pending,          // counts.queued + counts.unavailable
    complete,         // pending === 0
    demand,           // "passive" | "requested" | "draining"  (server-authored, §9.8)
    requested_at,     // ISO or null
    eta,              // { state: "measured", ms_remaining, per_batch_ms, batches_remaining }
                      // | { state: "estimating" }   (cold start — named, never 0, never a guess)
                      // | { state: "none" }         (complete)
    computed_at       // server clock; the client's only merge key
  }
  ```

  The arithmetic exists **nowhere else** — not in the route, not in the tick,
  and above all not in the client. §9.1's twice-proven lesson is that a
  rogue *re-derivation* (not a rogue read) is what ships; the client rule is
  therefore: `PlanLedgerPanel` renders `described`/`pool_size`/`eta` fields
  and **never computes a percent, a remaining count, or an ETA from
  `unit_keys` or unit lists**. This is the exact "consumer #2 exists at
  introduction" moment §9.1's history names — DEC-14's `counts` precedent
  extended one hop, with `coverageSnapshot` as its sole reader.

- `estimateEta(dbModule, projectId, batchesRemaining)` — reads the last K
  (recommend 5) `value_summary_generation_log` rows with `outcome='ok' AND
  generated > 0` (rows that actually spawned; cache-only rows measure
  nothing), `ORDER BY created_at DESC, id DESC` **before** `LIMIT` (§9.2 —
  and note the new file is born inside the derived `filesToScan` scope of
  `chronology-ordering.test.js`, so it will fail the scan until given a
  `FILE_DISPOSITIONS` entry: that is §9.7 working, not an obstacle).
  Per-project rows first; **fleet-wide fallback** if the project has none —
  still real measurements, still "never a guess"; zero rows anywhere →
  `{ state: "estimating" }`. `ms_remaining = avg(duration_ms) ×
  ceil(pending / MAX_UNITS_PER_PROMPT)`.

### Where snapshots are produced (all three call the one builder)

1. **Tick/drain, per iteration** — real full-pool `counts` from the composer.
2. **`GET /api/project-plans/coverage?project_id=`** (mount-time header) —
   runs `assembleValuePool` + `enrichPoolAltitudes` in a new **probe** mode
   (`{ probe: true }`: classify only, route every miss to `queued`, never
   spawn). This keeps classification single-homed in the composer — the
   alternative (route-side SQL counting cached rows) would be a second
   implementation of "described," i.e. §9.1 by construction, and would also
   bypass Slice 1's stale-is-a-miss comparator. Probe mode is one
   early-exit in the composer before the spawn, reusing the existing
   cap/gate machinery; it must not write a generation-log row (nothing was
   generated; logging probes would pollute the ETA's own input).
   Cost: one git walk per panel mount (WATCH-5) — bounded, and thereafter
   the panel lives on WS.
3. **`POST /api/project-plans/coverage-request`** — writes
   `coverage_requested_at`, kicks the drain (fire-and-forget through the
   shared runner), responds `202` with a probe snapshot
   (`demand: "requested"` or `"draining"`).

Deliberately **not** a producer: `POST /altitudes`. Its `counts` cover the
*submitted* batch, which is only coincidentally the full pool on mount and
is partial on every delta fetch — a coverage object derived from it would
lie with full-pool authority. Keeping it out is the cheap way to make the
partial-basis bug unrepresentable.

### WS payload (ruling: widen `value_altitudes_updated`, no new type)

Additive widening, at the cheapest moment it will ever be (zero
subscribers — `types.ts:2746-2765` documents that state explicitly):

```
{ project_id, unit_keys, pending,        // existing three fields, unchanged
  coverage: <coverageSnapshot verbatim> }
```

- **No new message type.** CLAUDE.md's WS rule is "keep message types stable
  and backward-compatible"; an additive field on an unsubscribed message is
  the most backward-compatible change possible. A second message type would
  give the client two sources to reconcile — §9.1 again.
- **Broadcast condition must widen.** Today the tick broadcasts only when
  `generated > 0` (`value-summary-tick.js:170`). A drain's terminal
  iteration can generate 0 (everything already cached after pool shrink) and
  the *transition* to `complete`/flag-cleared must still reach the client,
  or the auto-group gate never enables without a remount. Rule: broadcast
  when `generated > 0` **or** the snapshot's `demand`/`complete` changed
  from the previously broadcast snapshot for that project.
- **The documented dual-consumer traps, cited:**
  - **§9.1 DERIVED-DUAL-VIEW** — HTTP GET and WS carry the *same computed
    object*; the client renders, never re-derives. One cross-consumer
    parity test: route response `coverage` deep-equals the broadcast
    `coverage` for the same seeded DB state (the run-plan's QA checklist
    already demands this).
  - **WATCH-E / WATCH-F (Slice 1)** — `demand` and `eta.state` are new wire
    string registries crossing the CJS/Vite boundary; the hand-typed copies
    in `types.ts` / `PlanLedgerPanel.tsx` are the catalog's most common
    drift site and both WATCH triggers fire on "any growth." Same-commit
    rule, doc comment naming the canonical server export (the
    `TRUNK_DRIFT_ROUTE_SKIP_REASONS` precedent, §9.7 "accepted exception").
  - **§9.8 OVERLOADED-ABSENCE** — the client must never reconstruct state
    from silence: "no WS message yet" is not "passive," and ETA cold-start
    is `{state:"estimating"}` rendered as its own copy, never `~0 min`.
    Every snapshot field is server-authored.
  - **WATCH-8 shape, surfacing client-side (the HTTP/WS race):** panel
    mounts → GET coverage in flight; a drain broadcast lands first; the GET
    resolves with an older snapshot. Merge rule: **accept a snapshot only if
    its `computed_at` is newer than the one held** — otherwise progress
    visibly regresses, which is "decrement" wearing a race's clothes. This
    single rule also resolves the over-fetch question: the subscriber never
    refetches coverage on a WS message (the message *is* the coverage); it
    refetches only altitude *texts*, and only for the message's `unit_keys`
    (bounded delta through the existing `POST /altitudes`), which requires
    relaxing `requestedAltitudesRef`'s once-ever semantics for exactly those
    keys — flag that ref interaction as a WATCH row (it was designed for a
    fetch-once world and Slice 2 ends that world).
  - **`eventBus` mechanics** (`client/src/lib/eventBus.ts` header): publish
    is synchronous and a throwing subscriber **aborts remaining handlers**
    for that message — the panel's handler must not throw (filter by
    `project_id`, merge, nothing else). OPEN-3's ~20-line `useEffect` +
    unsubscribe-on-cleanup shape stands.

---

## 5. Open point C — coverage denominator (ruling)

**Ruled: "described" = fresh-or-immutable. A stale mutable unit counts as
NOT described, for both the header's N and the drain's target.**

The decisive argument is architectural, not preferential: Slice 1's design
makes a stale hit *literally a miss inside the composer* (`readCached`
returns `{cached:null, staleReason}`; the counts partition counts it into
`generated`/`queued`/`unavailable`, DEC-11). Since `coverageSnapshot` derives
exclusively from the composer's `counts` (§4), stale-as-not-described is what
the single home already computes. Ruling the other way ("cached-at-all
counts") would force coverage to be derived from a **second** classification
that disagrees with the composer's own — a §9.1 dual-view manufactured by a
semantics decision. It is also the product-correct answer: coverage exists to
gate Slice 3's grouping, and grouping must not synthesize over text known to
describe a previous stage (the request's own Resume example).

Two consequences to name in the plan (DEC-11's wire/log-divergence shape
recurring — needs its own decisions.md row so a later reader doesn't "fix"
it):

1. The header can read "180 of 182 described" while all 182 rows *display*
   text — the 2 stale units are on the wire with old text +
   `stale_refresh_*` freshness (Slice 1 R3). Described ≠ displayed, by
   design. The header copy and the gate tooltip should say "described"
   (current), never "generated" (ever).
2. `pending_after_sweep` already equals `queued + unavailable` post-Slice-1,
   i.e. it already counts stale units — the denominator ruling keeps
   coverage and `pending_after_sweep` consistent with no extra code.

---

## 6. Model tiering (seam only — Slice 3 not reopened)

Keep `summaryModel()` (`value-summary.js:63-70`) as the per-unit-compression
knob, unchanged. Add one sibling, same cascade shape, in the same file:
`groupingModel()` → `DASHBOARD_VALUE_GROUPING_MODEL ||
DASHBOARD_VALUE_SUMMARY_MODEL || …same tail…` with the calibration's
recommended default as the final fallback. Slice 2 ships the export and the
env knob; **its only consumer arrives in Slice 3** — say so in its JSDoc so
§9.3's "exported and never called" sweep doesn't flag it blind. Do not fork
the cascade or introduce a model-selection map keyed by stage: two functions,
one fallback chain each, is the smallest shape that can't drift. The
calibration run is an artifact-producing task (engineer owns mechanics); its
one architectural output is that default string plus a decisions row. One
WATCH to log: after tiering, `duration_ms` rows mix models, which skews the
ETA average — acceptable v1 (fleet of real measurements), promote to
model-filtered averaging only if the ETA is observed materially wrong.

---

## 7. Architectural risks

| # | Risk | Mitigation / disposition |
|---|---|---|
| R1 | **Two-writer race drain↔tick (WATCH-7).** | Structurally removed: one module, one shared `running` guard (§3.2). Test: drain in-flight → `runValueSummaryTickOnce` returns `{skipped:"overlap"}`, red-proven. |
| R2 | **Passive-fleet starvation by a hot drain.** | Iteration cap per drain run + drain occupies one rotation slot, remaining slots still swept (§3.4/3.5). The worst case is bounded and resumes, never spins. |
| R3 | **Client re-derivation of coverage/ETA (§9.1).** | Single home (§4); cross-consumer parity test HTTP↔WS; client renders only. The guard must catch *re-computation*, not just re-reads (§9.1's 2026-08-03 lesson). |
| R4 | **Progress regression via HTTP/WS race.** | `computed_at` monotonic merge rule, client-side, tested with an out-of-order delivery fixture (WATCH-8's shape at the client). |
| R5 | **New absence states collapsing (§9.8).** | `demand` + `eta.state` are closed, server-authored registries; cold-start is a named state; drain-stalled = flag kept + `demand:"requested"` on the next snapshot (never silence). Every snapshot field derivable from persisted rows so a restart mid-drain re-derives honestly. |
| R6 | **Scope creep into a §9.6 rebuild.** | No `source='drain'` enum: drain rows log as `'tick'` (they run in the tick runner; the CHECK at `db.js:1848` stays untouched). Losing drain-vs-passive discrimination in the log is a **knowing exclusion → needs a decisions.md PENDING/WATCH row**, revisit only if operational need appears. |
| R7 | **Probe mode polluting the ETA input.** | Probe writes no generation-log row (§4.2); assert in a test (a probe run leaves the log row-count unchanged). |
| R8 | **`requestedAltitudesRef` fetch-once semantics vs live updates.** | WATCH row + targeted change: WS `unit_keys` clear/bypass the ref for exactly those keys (§4). |
| R9 | **DEPENDENCY-F1 as restated in §0.** | Build branches from a tree containing *landed tick + landed Slice 1*; neither exists in `master` today. Concurrent-session `ps`/`lsof` check before any git op (standing repo risk, real prior work loss). |
| R10 | **WATCH-5 git cost ×N drain batches.** | Accepted, bounded (~5 walks per 182-unit drain, one per mount-time probe); named in the plan so it isn't rediscovered as a surprise. |

---

## 8. Recommended approach (one paragraph)

Add nullable `coverage_requested_at` to `value_summary_sweep_state` (§9.5
three-part landing); implement the drain as `runCoverageDrain` inside
`value-summary-tick.js` sharing the existing overlap guard — kicked
immediately by `POST /coverage-request`, resumed drain-first by the passive
tick via one new leading ORDER BY term, looping bounded ≤40-unit composer
batches with pending re-derived from each iteration's own full-pool counts,
flag cleared only when a fresh derivation reads zero. Coverage and ETA are
computed in exactly one new module (`server/lib/value-coverage.js`) fed
solely by the composer's DEC-14 `counts` (denominator from
`assembleValuePool` via the composer, per DEC-16; "described" =
fresh-or-immutable, stale counts as pending); the identical snapshot object
is carried by `GET /coverage` (composer probe mode, no spawn, no log row)
and by an additively-widened `value_altitudes_updated` payload, with the
client merging by `computed_at` and never re-deriving a number. Model
tiering is `groupingModel()` beside `summaryModel()`, same cascade, consumer
named as Slice 3.

## 9. Exclusions that must become tracked rows (not prose)

1. **DEPENDENCY-F1 correction** (§0): the uncommitted main-checkout diff is
   the tick effort, not Slice 1; Slice 1 is unbuilt. Update the row.
2. **Denominator ruling** (§5): described = fresh-or-immutable; described ≠
   displayed — DEC row, DEC-11's shape.
3. **No `source='drain'` log discrimination** (R6) — PENDING/WATCH row.
4. **`requestedAltitudesRef` semantics change** (R8) — WATCH row.
5. **ETA model-mix after tiering** (§6) — WATCH row with promotion trigger
   ("ETA observed materially wrong").
6. **Drain broadcast-on-transition rule** (§4): if the builder narrows it
   back to `generated > 0` only, the complete-transition is silent — pin
   with a test, and note it in the DEC row for the WS widening.
