# QA Guardrail Checklist — Slice 2 (coverage-on-demand) — MINIMAL, FAST MODE

**Intake:** `2026-08-05-coverage-on-demand` · **Author:** intake-qa (forced on
over fast mode's default skip — run-plan §4)
**Scope ruling:** this is **not** a test plan. DEC-F2 defers the `team-qa`
stage (`FAST — QA debt` stamp), which makes this document the only place the
build's catalog obligations are written down before code lands. It lists only
the guardrail checks that stop a *named, recurring* defect-catalog pattern
from reappearing on the exact surfaces Slice 2 edits. Everything else is
stamped DEFERRED at the bottom.

**How to run:** `npm run test:server` (node --test, so a single spec is
`node --test server/__tests__/<name>.test.js`); client checks via
`npm run test:client`. Every check below is subject to §9.3's standing rule:
**observed red against a real mutation, red recorded, before it counts.**

---

## G1 — §9.8 OVERLOADED-ABSENCE (this surface is the catalog's live instance #1)

Slice 2 manufactures at least three brand-new "absent from a map" states.
Each must be a **named, server-authored, discriminated wire value** — never
reconstructed client-side from what is missing.

### G1a — ETA cold-start (the slice's headline new absence)

- **Trap:** a project whose relevant `value_summary_generation_log` slice has
  **zero measured-duration rows yet** (fresh install, or first-ever coverage
  request before any batch has completed). The ETA formula then has no input.
  Rendering `~0 min`, `NaN`, or any guessed number violates the request's own
  acceptance signal #3 ("never a guess") and is exactly §9.8's collapse:
  "no data yet" served as if it were "zero minutes remaining."
- **Guardrail assertion (server):** with an empty/insufficient generation
  log, the coverage object carries a discriminated ETA state (e.g.
  `eta: { state: "estimating" }` vs. `eta: { state: "measured",
  remaining_ms }` — exact names are the builder's, but the discriminant is
  not optional) and **no numeric field is fabricated**. One test seeds zero
  log rows, requests coverage, and asserts the named cold-start value —
  home: the spec that owns the new coverage computation (extend
  `server/__tests__/value-summary-tick.test.js` or the new coverage spec).
- **Guardrail assertion (client):** `client/src/components/__tests__/PlanLedgerPanel.test.tsx`
  renders the cold-start state as its own distinct string (an "estimating…"
  copy key, present in all four locales) — asserts the rendered output is
  **not** a minutes string and **not** `0`.

### G1b — the new sweep-demand states are three states, not one flag read

- **Trap:** *coverage-requested-but-not-yet-swept*, *draining*, and
  *passively-rotating* collapse into "flag set / flag unset" on the wire, so
  the UI cannot tell "your request is queued" from "your request is being
  worked" — the same backlog-vs-outage collapse that spawned this whole
  request line.
- **Guardrail assertion:** the wire payload carries a named demand state per
  project; one test drives a project through request → first drain batch →
  100% and asserts three distinguishable serialized values, each landing in
  **exactly one** bucket — prove the **never-zero** direction explicitly
  (§9.8's acceptance criterion verbatim: it is the direction a naive
  "no key in both maps" check misses; both prior-build blockers B2/S3 were
  never-zero failures at the route/sweep-state seams, not the composer).

### G1c — "N of M" re-derived live, never decremented (WATCH-8 / prior QA-DEC-2)

- **Trap:** the coverage header's "N of M" is exactly the
  `pending_after_sweep` shape. A drain loop that decrements a counter reads
  as converging while a growing pool treads water; an errored sweep must
  never overwrite the last good count with an initializer (prior build's B2:
  `pending_after_sweep = 0` written on the error path).
- **Guardrail assertion:** extend the existing pin —
  `server/__tests__/value-summary-tick.test.js` :: *"pending_after_sweep is
  re-derived from the live pool each sweep, not decremented"* (T-C) — to the
  coverage counts: grow the pool mid-drain and assert N and M both move to
  the live values. Add the error-path case: a sweep whose
  `assembleValuePool` throws leaves the previous counts intact
  (`upsertValueSweepStateKeepPending` precedent — the error path must be
  *structurally* unable to touch the count).

## G2 — §9.1 DERIVED-DUAL-VIEW (consumer #2 exists on day one)

- **Trap:** coverage + ETA is a derived value with **two delivery paths at
  introduction** — the HTTP response (mount) and the `value_altitudes_updated`
  WS payload (live update). This entry's history says the failure lands
  exactly when consumer #2 appears; here consumer #2 ships in the same
  commit. Two hand-written derivations (or an ETA formula re-implemented
  client-side from raw log rows) is the defect.
- **Guardrail assertion (the one required check):** a **cross-consumer parity
  test** — run one request-driven sweep, capture the broadcast
  `value_altitudes_updated` payload and the coverage route's response for
  the same project, and assert the coverage/ETA object is **deep-equal /
  same computed object** (byte-parity shape precedent:
  `server/__tests__/ledger-metrics-parity.test.js` and
  `reconciliation-full-tick.test.js` Scenario C). One server-side function
  with one home (extend Slice 1's DEC-14 `counts`-computed-once precedent
  inside `enrichPoolAltitudes`/`value-summary.js`), invoked by both paths.
  The client renders server-provided fields only — no ETA arithmetic in
  `PlanLedgerPanel.tsx`.
- One-line DEC-16 corollary: if the denominator M needs pool membership, it
  comes from `assembleValuePool` via the `CONSUMERS` registry — no
  pool-membership SQL in the tick, route, or a new helper (the existing
  DEC-15 sole-composer structural test must stay green and its registry
  widen in the same commit if a consumer is added).

## G3 — §9.5 FRESH-DB-BLIND SCHEMA CHANGE

- **Trap:** the coverage-request flag column on `value_summary_sweep_state`
  lands only in the `CREATE TABLE IF NOT EXISTS` body; every throwaway test
  DB passes; every existing `~/.claude/agent-dashboard/dashboard.db` keeps
  the old shape forever.
- **Guardrail assertion:** the three-part landing, same commit:
  (a) `CREATE TABLE` body, (b) `PRAGMA table_info`-guarded
  `ALTER TABLE … ADD COLUMN` (not the try/SELECT probe idiom — it creates a
  §9.2-grandfather headache), (c) an **`UPGRADE_CASES` entry in
  `server/__tests__/db-migration.test.js`** that seeds the **legacy** shape
  (`project_id, last_swept_at, pending_after_sweep` only), migrates, and
  asserts: column exists, legacy row reads NULL/default, column writable,
  second migration run is a no-op. **No new `GRANDFATHERED` entries**
  (Slice 1 DEC-5 ruling). Same treatment for any other new column this
  slice adds. No CHECK changes → no §9.6 rebuild; keep it that way.

## G4 — §9.2 row-id-as-chronology-proxy

- **Trap:** the ETA reads "recent" rows from `value_summary_generation_log`;
  an `ORDER BY id … LIMIT n` query selects the **wrong subset** once anything
  bulk-inserts out of id order — and the sort must precede the `LIMIT`.
- **Guardrail assertion:** every new generation-log read uses
  `ORDER BY created_at …, id …` (id as tiebreak) before any `LIMIT`.
  Enforcement is the existing static scan
  `server/__tests__/chronology-ordering.test.js` — it scans `server/db.js`,
  `server/lib/*`, `server/routes/*` via a per-file registry, so: keep the
  ETA query in `server/db.js` prepared statements (or a registered lib
  file), and if this slice creates a **new** lib/route file, add its
  `"scanned"` registry entry (the registry-completeness meta-test will
  demand it). Red-proof per §9.3: temporarily flip the new query to
  `ORDER BY id` and observe the scan fail before calling this covered.

## G5 — §9.3 VACUOUS-GUARD + WATCH-6 single-writer widening

- **Trap (§9.3):** this surface holds the project record (eight §9.3-family
  events in the prior effort; five vacuous guards in one earlier build —
  it is the *default output shape* of guard-writing here). With team-qa
  deferred, build-time red-proof is the **only** gate.
- **Guardrail (standing rule, applies to every check in this file):** each
  new guard is observed **red against a real product-code mutation** (disable
  the branch, inject the rogue call site, revert the fix), the red recorded
  in the build's decisions/verification notes, then restored green. Cheap
  sweep before done: `grep -rn "assert.ok(true" server/__tests__/` and
  `grep -rn "|| true" server/__tests__/` both return 0.
- **Trap (WATCH-6):** "drain continuously" and/or the coverage POST add a new
  caller of `upsertValueUnitSummary` / `insertValueSummaryGeneration`.
- **Guardrail assertion:** widen
  `server/__tests__/single-writer-guard.test.js`'s expected file set /
  call-site counts **deliberately, in the same commit** as the new caller,
  red-proven by injecting a rogue call site — and widen from **Slice 1's
  already-widened state** (DEC-4 landed request-path logging and widened it
  once), not from `55fe900`. If no new caller appears, the existing
  exactly-one assertions must stay untouched and green.

## G6 — WATCH-E / WATCH-F hand-typed client registries (CJS/Vite boundary)

- **Trap:** any new wire state value this slice mints (demand states G1b,
  ETA discriminant G1a, any freshness growth) must land in the hand-typed
  client copies — `PlanLedgerPanel.tsx` union/registry, `api.ts` response
  types, and the four locale files (en/ko/vi/zh). Both WATCH rows' triggers
  fire on **any growth**; this is the catalog's most common drift site.
- **Guardrail assertion:** every new server-side state registry is exported
  (the `ALTITUDE_STATES` precedent), the server-side registry-derived scope
  check covers it, and `client/src/i18n/__tests__/i18n.test.ts` (E1.1
  pattern) propagates its key set to all four locales — so a value added
  server-side without client copy/copy-key goes red mechanically. All copies
  land in one commit.

---

## DEFERRED — `FAST — QA debt` (follow-up `team-qa` run, per DEC-F2)

Everything not listed above is explicitly deferred, including:

- Full E2E coverage of the coverage-request flow (POST → prioritized drain →
  WS-driven live header update in a real client).
- UI snapshot tests / `screens.snapshot.test.tsx` baselines for the header,
  disabled gate, and "prioritize now" control.
- Load/perf testing of the drain loop (WATCH-5 per-sweep git cost,
  WATCH-7 two-writer race frequency under continuous drain).
- WebSocket subscriber lifecycle edge cases (reconnect, stale-tab merge)
  beyond the G2 parity assertion.
- Quality judgment of the haiku-vs-sonnet calibration output (open point G —
  artifact + DECIDED-AUTO row at build; no automated test).
- Locale copy review beyond mechanical key-completeness.

## Definition of Done (build-time sign-off for this slice)

- [ ] G1a cold-start ETA: named state asserted server-side + distinct client render; no fabricated number anywhere.
- [ ] G1b demand states: three named wire values, exactly-one-bucket, never-zero direction proven explicitly.
- [ ] G1c counts re-derived live each round (pool-growth case + error-path keep-pending case), never decremented.
- [ ] G2 route/WS parity test deep-equals the same computed coverage/ETA object; ETA formula has one server-side home; no client-side re-derivation.
- [ ] G3 `UPGRADE_CASES` legacy-shape entry for every new column; guarded ALTER; no new `GRANDFATHERED` rows.
- [ ] G4 chronology scan covers every new generation-log read (registry entries for any new file); red-proven once.
- [ ] G5 every guard above recorded red-then-green; vacuous-guard greps return 0; `single-writer-guard.test.js` widened same-commit iff a new writer exists.
- [ ] G6 all client registry copies + four locales land in the same commit as any new wire value; mechanical i18n check extended.
- [ ] `npm run test:server` and `npm run test:client` green; build carries the `FAST — QA debt` stamp naming the deferred list above.
