# QA / Test Plan — Slice 1: mutability-aware altitude-cache invalidation

**Intake:** `2026-08-04-altitude-invalidation`
**Author:** QA / Test Architect pass, 2026-08-04
**Substrate:** all code/tests referenced live on `origin/master` @ `55fe900`
(local tree is one commit behind at `d830a44` — triage finding E). Every
"currently passes" claim below was verified against a clean `git archive
origin/master` snapshot, NOT the local working tree. The effort branch must be
cut from `55fe900` or later; re-run the baseline suite there before building.

---

## 1. How we verify done

### Automated (must all be green at merge)

```bash
npm run test:server          # includes every new/updated spec below
npm run test:client          # includes PlanLedgerPanel marker tests + screen snapshots
```

Single-spec loops during build (note the env var — see the §9.3 catalog's
TEST-AGAINST-LIVE-DB candidate: `server/db.js` runs migrations at `require()`
time against the real `~/.claude/agent-dashboard/dashboard.db` if
`DASHBOARD_DB_PATH` is unset; this slice ships a schema change, so an unset
var means migrating Sara's live DB from a test run):

```bash
DASHBOARD_DB_PATH=/tmp/qa-slice1.db node --test server/__tests__/value-summary.test.js
DASHBOARD_DB_PATH=/tmp/qa-slice1.db node --test server/__tests__/value-summary-tick.test.js
DASHBOARD_DB_PATH=/tmp/qa-slice1.db node --test server/__tests__/db-migration.test.js
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
```

Mapping to the request's acceptance signals (request-brief §8):

| Signal | Proven by |
|---|---|
| 1. commit units unchanged: generate-once-serve-forever | new "immutable units never regenerate" lifecycle test (D1 below) + every existing `trunk_commit::` test staying green untouched |
| 2. digest mismatch → that one unit regenerates | lifecycle tests D3/D4 + the Resume named fixture D5 |
| 3. visible "updated — stage changed" marker until seen | PlanLedgerPanel marker tests (C1–C3) + server state test D6 |
| 4. invalidation logged with a reason | generation-log tests L1/L2 + migration test M2 |
| 5. user always told when something changed | manual walkthrough (below) + C1–C3 |

### Manual (per CLAUDE.md verification policy — required, in a real browser)

The Resume-project walkthrough, end to end, against a dev server
(`npm run dev`), opened in real Google Chrome:

1. Seed (or use the live) Resume project whose pool contains the
   `2026-08-03-job-pipeline-tracker` intake initiative; confirm the stale
   cached stakeholder text "The job pipeline tracker is built and being
   tested" renders in PlanLedgerPanel.
2. Change the initiative's stage (the real prompt-feeding field, changed the
   way production changes it — not a direct DB poke).
3. Wait for/trigger the next sweep or reopen the panel → the unit's text
   regenerates and the "updated — stage changed" marker is visible.
4. Acknowledge ("seen") the unit → marker clears; reload the page → marker
   stays cleared (if open question B lands server-side) or the chosen
   client-local behavior is observed and matches the documented decision.
5. Confirm a `value_summary_generation_log` row exists recording the
   invalidation with its reason.
6. Confirm a neighboring `trunk_commit` unit's text did NOT change and no
   spawn was burned on it (check the log row's `cache_hits`).

Also manual: boot the dev server once against a **copy of a pre-slice DB**
(any DB created at `55fe900`) and confirm clean startup, no SQLITE_ERROR, and
that pre-existing mutable-unit rows regenerate lazily rather than en masse
crashing the tick (open question A's stale-on-first-check burst — observe its
real size once, note it in the build report).

---

## 2. Regression coverage (discovered by grep, pass status verified)

All verified **green on 2026-08-04** against the `55fe900` snapshot
(`node --test`: 77/77 across the four server specs; vitest 14/14; db-migration
22/22):

| Spec (path at `origin/master`) | What it pins that this slice can break |
|---|---|
| `server/__tests__/value-summary.test.js` (~30 tests) | `enrichPoolAltitudes` cache semantics ("generates once, then serves the cache with zero further spawns"), single-spawn batching, DEC-11 truth table Cases 1–6 incl. Case 5's exactly-one-bucket partition and Case 6's registry-import scan, T-A concurrency (one valid row, never throws), route S2/S4 fixes |
| `server/__tests__/value-summary-tick.test.js` (17+ tests) | overlap guard, rotation, 45-unit overflow drain (AC-1), broadcast discipline ("all-cached sweep sends zero broadcasts" — digest gating changes what "all-cached" means), T-C `pending_after_sweep` re-derivation instrument, B2 errored-sweep preservation, AC-2 four-term log partition |
| `server/__tests__/single-writer-guard.test.js` | `upsertValueUnitSummary` in exactly {db.js, value-summary.js}; exactly one lexical `.run(` call site inside `enrichPoolAltitudes`; `insertValueSummaryGeneration` exactly one production call site (tick); export-disposition scans |
| `server/__tests__/db-migration.test.js` | `UPGRADE_CASES` pattern + the meta-test ("every ALTER TABLE … ADD COLUMN in db.js has an upgrade case or is grandfathered") — this slice's ALTERs will be **forced** by this meta-test; that is by design, do not grandfather |
| `server/__tests__/focus-summary.test.js` | the digest-gating precedent this slice mirrors: "generates once, then serves the cache while the input digest is unchanged" / "regenerates when the underlying report data changes" — must stay green untouched (proves the shared pattern wasn't disturbed) |
| `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (14 tests) | generating/resolved placeholders, queued-vs-unavailable distinct render, single altitude request per stable unit set, T-E out-of-registry-warn (this is the test that fires if new states ship without client registry + i18n updates) |
| `client/src/pages/__tests__/screens.snapshot.test.tsx` | per-screen render snapshots — the marker changes PlanLedgerPanel's render; review the diff deliberately, regenerate with `npx vitest run -u` only after eyeballing (never blindly) |

Expected **deliberate** reds during build (WATCH-6/WATCH-7, request-brief §5):
if the request path starts logging invalidations, the single-writer-guard's
"`insertValueSummaryGeneration` has exactly one production call site" test goes
red **by design** — widen the guard's expected call-site set in the same
commit, with its own red proof, and record it in `decisions.md`. Same for any
new `upsertValueUnitSummary` call site (there should be none: invalidation
should flow through the existing single writer inside `enrichPoolAltitudes`).

---

## 3. New / updated tests required

### A. Digest correctness + §9.1 single-home guard

The digest must have **one** computing function (say
`computeUnitInputDigest(unit)` in `server/lib/value-summary.js`), used by the
write path, the read/check path, and the sweep — mirroring
`focus-summary.js`'s own comment ("kept as a single shared extraction so the
digest can never drift from what the prompt actually contains"). §9.1's
twice-proven lesson: a rogue-*reader* scan does not catch a rogue
*re-derivation* of the formula. So two guards, different mechanisms:

- **A1** (`value-summary.test.js`): `computeUnitInputDigest` is stable for
  unchanged `{stage, label}`, changes when either changes, and is
  order/format-canonical (shape of `focus-summary.test.js`'s
  `computeInputDigest` block).
  *Red proof:* make the digest include a timestamp → A1 red (stability leg);
  make it ignore `label` → A1 red (sensitivity leg).
- **A2** (`single-writer-guard.test.js`, new block): structural scan — no
  file other than `value-summary.js` computes a digest over unit fields
  (e.g. no second `createHash(` over `stage`/`label` in
  `value-summary-tick.js` or `routes/project-plans.js`); consume
  `assertSingleHome` rather than re-deriving scope (§9.7). Assert the scan's
  own scope is non-empty (§9.3 corollary a).
  *Red proof:* inject a rogue inline re-derivation (a literal
  `crypto.createHash("sha1").update(unit.stage + …)` in the tick) → A2 red;
  remove, confirm byte-identical, green.
- **A3 — the behavioral divergence proof A2 cannot give** (this is the
  request's named mutation): **break the shared function so write and check
  paths diverge** — e.g. have the write path store
  `computeUnitInputDigest(unit) + "x"`. Which test goes red? **D2 below**
  (unchanged mutable unit must serve from cache with zero spawns) — a
  write/check divergence makes every unit permanently stale, so D2's
  zero-spawn assertion fails. Record that observation; if D2 stays green
  under this mutation, D2 is vacuous, not the mutation wrong.

### B. Digest lifecycle (`value-summary.test.js`, new describe
"enrichPoolAltitudes digest gating" — mirror the focus-summary test shape
**per unit**)

Each test below names its own mutation proof inline, per §9.3's standing rule
("specify the red-proof procedure per test, not as a blanket sentence"), and
per the VACUOUS-REPAIR warning: **if any of these needs repairing after its
red proof fails, the repaired test needs a fresh red proof of its own** — the
prior effort's S6 repair was itself vacuous, and the only technique that
reliably worked all eight times was *revert the product change and run the
actual shipped spec file, watching it go red*.

- **D1 — immutable units NEVER regenerate.** Cache a `trunk_commit::` unit;
  then churn every stage/label-shaped thing in the DB that could plausibly
  feed a digest (and pass the unit back with a mutated `label` field, which a
  re-assembled pool could legitimately do for display reasons); re-call
  `enrichPoolAltitudes` → served from cache, **zero spawns** (assert via the
  spawn spy count, the suite's existing instrument). Also: an immutable unit
  whose row has `input_digest = NULL` (pre-migration row) is **not** stale.
  *Red proof:* apply digest gating to all sources (drop the
  mutable-source guard in the check path) → D1 red on the NULL-digest leg.
- **D2 — mutable unit, unchanged stage+label: cache hit, zero spawns.**
  `intake_initiative::` unit cached with correct digest; second call with
  identical fields → same text back, spawn count unchanged.
  *Red proof:* mutation A3 (write/check divergence) → red. This is the
  test that makes the shared-function rule behaviorally enforced.
- **D3 — stage change regenerates exactly that unit.** Batch of 3 mutable
  cached units + 1 immutable cached; change one unit's `stage`; call →
  exactly **one** spawn, its prompt containing only the stale unit (assert on
  the captured prompt, as the existing "batches multiple misses into exactly
  one spawn" test does); the other three still served from cache; DB row for
  the stale unit now carries the new digest and new text.
  *Red proof:* `if (false)` the digest-mismatch branch in the cache read →
  D3 red (stale unit served from cache, zero spawns).
- **D4 — label change: same shape as D3**, changing `label` instead.
  *Red proof:* compute the digest from `stage` only → D4 red while D3 stays
  green — this pair pins that **both** prompt-feeding fields are in the
  digest, separately.
- **D5 — pre-digest NULL row reads as stale (the motivating example, as a
  NAMED fixture).** Fixture name in the spec: `resumeJobPipelineTracker` —
  unit_key `intake_initiative::2026-08-03-job-pipeline-tracker::<cwd>`,
  cached row text "The job pipeline tracker is built and being tested",
  `input_digest = NULL` (seeded through the legacy schema path, see M1).
  Call with the unit's *current* stage → regenerates, text replaced, digest
  stamped. This test is also the executable record of why open question A's
  backfill alternative is wrong: assert the regeneration happened **even
  though** current stage/label would hash to a "fresh" digest.
  *Red proof:* implement backfill-on-migrate (stamp NULL rows with the
  current digest) → D5 red. That is the exact defeat the brief warns about.
- **D6 — regenerated unit carries the updated-marker state until
  acknowledged.** After D3's regeneration, the unit's wire state is the new
  named state (e.g. `updated`) in the `states` map / on the wire; after the
  acknowledge write path runs, the state clears; a *fresh* generation (never
  cached before) does NOT carry the marker.
  *Red proof:* skip writing the marker on regeneration → D6 red; make every
  generation carry it → the fresh-generation leg red. Both directions.

### C. Client marker tests (`PlanLedgerPanel.test.tsx`)

- **C1** — a unit whose state is `updated` renders the "updated — stage
  changed" marker (i18n key, not hardcoded English) alongside the regenerated
  text — distinct from generating/queued/unavailable renders in the *same*
  render (extend the existing T-D-style combined-render test rather than a
  lone branch test, per §9.8's "test the combination").
- **C2** — acknowledging (click/seen interaction) calls the mark-seen API
  exactly once and the marker disappears without a full refetch.
- **C3** — the existing T-E out-of-registry-warn test **stays green and its
  fixture stays out-of-registry**: pick the new state names, then verify T-E's
  bogus value is still bogus. Conversely `updated` must be **in** the client
  registry — otherwise C1 itself would trip T-E's warning path.
- **i18n:** the server-side registry-derived scope check + `i18n.test.ts`
  E1.1 propagate the new state keys to all four locales mechanically —
  confirm the new keys flow through that existing mechanism instead of
  hand-adding (§9.7). No empty-body `it()`s (the O-8 shape).
- *Red proofs:* C1 — render with the marker branch disabled in the component
  → red. C2 — double-fire the handler → the "exactly once" assertion red.

### D. §9.5 migration tests (`db-migration.test.js` — `UPGRADE_CASES`)

The meta-test ("every `ALTER TABLE … ADD COLUMN` in db.js has an upgrade case
or is grandfathered") will force these; write them properly, on the precedent
of the `detour_dispositions.project_id` block ("creates project_id column on
legacy detour_dispositions via ALTER TABLE" + "migration is idempotent"):

- **M1 — `value_unit_summaries.input_digest`.** Seed the **legacy** table
  shape (`unit_key, project_level, stakeholder_level, model, created_at` —
  copy the pre-slice CREATE body into the case, as every existing
  `UPGRADE_CASES` entry does) with at least one mutable-unit row and one
  `trunk_commit::` row; `require` db.js; assert: column exists (`PRAGMA
  table_info`-guarded ALTER, not the try/catch probe idiom — §9.5 how-to),
  legacy rows read `NULL`, column writable, second `require` a no-op. Then
  the behavioral leg: **the legacy mutable row is served as stale and the
  legacy commit row is served as fresh** (this is the "verify old rows behave
  correctly" precedent leg, and it feeds fixture D5).
- **M2 — the generation-log reason surface** (open question C's stated
  assumption: additive nullable column(s), e.g. `invalidation_reason` or a
  `stale_regenerated` count — **no** `outcome` CHECK widening, which would
  drag in §9.6's atomic-rebuild machinery). Same UPGRADE_CASES shape: legacy
  log table, migrate, column exists, legacy rows NULL, writable, idempotent.
  If the design *does* end up widening the CHECK, this becomes a
  `REBUILD_CASES` entry with the legacy+interruption pair instead — flag it
  back to QA because the risk class changes.
- Also update the now-false schema comment at `db.js` (the "NOT a content
  digest like focus_summaries … generated once, served forever" paragraph) —
  the brief calls this out; a stale comment there is a doc defect QA will
  check for.
- *Red proofs:* M1/M2 are self-red-proving via the meta-test only for the
  ALTER's *existence*; for the behavioral leg, revert the stale-on-NULL check
  → M1's behavioral assertion must go red. Confirm the fixture actually
  reaches the digest check (trace the early-return chain — PLAN-LEVEL
  VACUOUS FIXTURE, §9.3 2026-08-03: a fixture the code short-circuits before
  the guarded branch makes the mandated red-first procedure itself pass
  vacuously).

### E. §9.8 — new states, and how the partition test widens

New distinguishable conditions this slice introduces (request-brief §5 names
the first two):

1. **stale-but-not-yet-regenerated** — a cached-but-digest-mismatched unit.
   On the read path it behaves as a miss; if it lands beyond the cap or the
   LLM is down, its *old text* still exists. Decision required (evaluation
   phase): does the wire serve the stale text (with a state flagging it) or
   the queued/unavailable placeholder? Either way the condition must be a
   **named** state on the wire, not inferrable-from-absence — a unit must
   never render fresh-looking stale text silently.
2. **regenerated-but-not-yet-seen** (`updated`) — until acknowledged.

Required widenings, each at a named spec:

- **`ALTITUDE_STATES`** registry gains the new value(s); DEC-11 **Case 6**
  (registry imported, not hand-typed) auto-covers them only if consumers keep
  importing — verify no consumer hand-types the new strings.
- **Case 5 ("never in both, never in neither") widens:** the partition
  universe is now `altitudes ∪ states(queued|unavailable|updated|…)`; assert
  `altKeys.size + stateKeys.size === submitted.length` still, **and** decide
  whether `updated` units appear in *both* maps (text + marker state) — if
  so, Case 5's disjointness assertion must be rewritten to "disjoint except
  the `updated` overlay," explicitly, or the marker must travel on a separate
  field so the partition stays clean. Do not let this be decided implicitly
  by whatever the code happens to do.
- **Every layer that can add or drop an item extends the exactly-one-bucket
  assertion** (§9.8 build lesson: the two never-zero failures landed at the
  route and the sweep-state table, seams the composer partition test cannot
  see): the route S2 sanitization test and the tick's AC-1/flow tests each
  re-assert the widened partition with stale units in the fixture.
- **Combination case** (the truth-table discipline): a unit that is *both*
  digest-stale *and* over-cap → `queued` (stale regen deferred, old text
  status defined); stale *and* LLM down → `unavailable` (and what text
  shows?). One test each — a suite with one test per branch passes while the
  ordering bug ships.
- *Red proofs:* Case 5 widened — inject a reconciling loop that adds
  `unavailable` without clearing `queued` for a stale dup (the historical S6
  bug, resurrected deliberately) → red. Route leg — drop stale units in
  sanitization → the route partition test red.

### F. Generation-log accounting (`value-summary-tick.test.js`)

Decision to pin (and the assertion that pins it): **a digest-stale
regeneration is a cache MISS** — it lands in exactly one of
`generated` / `queued` / `unavailable` for that run, and `cache_hits` counts
**only digest-valid hits**. The invalidation-reason surface is *metadata* on
the existing terms (per-run count `stale_regenerated` and/or per-unit reason)
— it must NOT become a fifth partition term.

- **L1 — partition stays exact under staleness.** Fixture: pool of 45 with
  10 cached-fresh, 5 cached-stale, 30 uncached; LLM on; cap 40. Assert the
  existing four-term identity `cache_hits + generated + queued + unavailable
  === pool_size` **with `cache_hits = 10` exactly** (not 15 — the five stale
  ones must not double-count as both hit and generated). Sized so every
  wrong implementation reads differently from the right one (QA-DEC-2's
  fixture-sizing lesson: at the wrong sizes, correct and broken
  implementations read the same number).
- **L2 — reason recorded, bounded by the partition.** Same fixture: assert
  `stale_regenerated === 5` (or 5 per-unit reason rows), and
  `stale_regenerated <= generated + queued + unavailable` — i.e. the reason
  surface never exceeds the misses it explains. If per-unit reasons ship,
  assert the granularity join: each reason row's unit was actually stale.
- **L3 — sweep drains staleness** (extends AC-1's two-tick drain): tick 1
  all cached-fresh → zero broadcasts (existing test unchanged); mutate one
  unit's stage; tick 2 → exactly that unit regenerates, one broadcast, log
  row shows `cache_hits = pool-1, generated = 1, stale_regenerated = 1`.
  Also confirm the T-C re-derivation instrument still holds with stale units
  in the pool (stale ≠ pending double-count).
- *Red proofs:* L1 — count stale hits into `cache_hits` as well as
  `generated` (the natural off-by-one implementation) → the partition sum
  overshoots `pool_size` → red on day one for a real reason (this is the
  exact three-term-form trap the prior QA pass shipped and corrected —
  §9.3 event 1). L3 — disable stale detection in the sweep path only →
  red (this also proves the sweep goes through the shared read path rather
  than its own, guarding open question D's resolution).

### G. Seen-state write path (shape depends on open question B)

If server-side (`seen_at` column / mark-seen route — the DEC-10
server-authored-state lean): it is a new schema surface (→ its own
UPGRADE_CASES entry, same M1 shape) and a new write path (→ single-writer
disposition: who may clear `updated`?). Test: mark-seen persists across a
fresh `require` of db.js; double-acknowledge is idempotent. If client-local:
document the reset-per-browser behavior in the component header and test the
localStorage (or equivalent) round-trip. Either way D6 pins the server/wire
semantics.

---

## 4. Test data / fixtures

- **`resumeJobPipelineTracker`** (the named motivating fixture, used by D5,
  M1, and the manual walkthrough): unit_key
  `intake_initiative::2026-08-03-job-pipeline-tracker::<cwd>`, cached
  stakeholder text "The job pipeline tracker is built and being tested",
  `input_digest = NULL`, live stage ahead of the cached text.
- **Mixed-mutability pool**: N `trunk_commit::`/`merge_commit::` + M
  `intake_initiative::`/`detour::` units, built with the suite's existing
  `unit()`/`makeUnits()` helpers extended with `stage` — sized per L1 so
  correct/broken implementations diverge numerically, and per the prior
  effort's convention (45 across the 40-cap for overflow interaction).
- **Legacy DB shapes** for M1/M2: copy the pre-slice CREATE bodies verbatim
  into the `UPGRADE_CASES` entries (the file's convention).
- **Env/config**: `DASHBOARD_DB_PATH` always set to a temp path in every
  spec block that `require`s db.js (scoped to the block — a per-file grep
  is a proven-invalid sweep for this); spawn spy via the suite's existing
  `__injectSpawnForTest`; pool via `__injectPoolAssemblerForTest`;
  `DASHBOARD_FOCUS_INFER_MODE=off` for the LLM-down legs.
- Stage changes exercised through the **production mutation path** where the
  test's claim is end-to-end (sweep tests), and via direct fixture mutation
  only in composer-level unit tests — a stage change no production code path
  can produce is a §9.3 unreachable-fixture.

---

## 5. Definition of Done checklist

Per the §9.3 standing rule: **no row below gets ticked on an agent's
self-report** — every "red-proven" claim is unverified until the injection is
re-run by a second pass or the guard's body is read directly; a repair of any
red-proof failure needs its own fresh red proof (VACUOUS-REPAIR); and plan
multiple independent verification passes — in the prior effort on this exact
surface, every pass found something the previous pass's self-report missed.

- [ ] D1–D6 digest-lifecycle tests exist, each observed red under its named
      mutation and restored byte-identical (red outputs recorded in the
      build report, per test — not a blanket sentence).
- [ ] A1–A3: one shared `computeUnitInputDigest`, structural scan (non-empty
      scope) + behavioral divergence proof (A3's mutation shown *caught by
      D2 specifically*).
- [ ] M1/M2 `UPGRADE_CASES` entries: legacy shape seeded, column added via
      `PRAGMA table_info`-guarded ALTER, legacy rows NULL, writable,
      idempotent, **and** the behavioral leg (legacy mutable row stale,
      legacy commit row fresh); db-migration meta-test green with **no new
      GRANDFATHERED entries**; obsolete "generated once, served forever"
      schema comment rewritten.
- [ ] §9.8: new state(s) in `ALTITUDE_STATES`; Case 5 partition widened with
      the both-maps question answered explicitly; combination cases
      (stale×over-cap, stale×LLM-down) tested; route + sweep seams
      re-assert the partition; client registry + all four locales carry the
      new keys mechanically; T-E still red for out-of-registry values.
- [ ] L1–L3: four-term partition exact with `cache_hits` counting only
      digest-valid hits; reason surface recorded and bounded; sweep drains
      staleness through the shared read path.
- [ ] WATCH-6/WATCH-7: single-writer guards widened **deliberately** (dated
      `decisions.md` row + red proof) for any new
      `insertValueSummaryGeneration` call site; zero new
      `upsertValueUnitSummary` writers.
- [ ] Existing suite fully green at `55fe900`-descendant:
      `npm run test:server`, `npm run test:client` (screen-snapshot diffs
      reviewed, not blindly regenerated), plus the focus-summary digest
      precedent tests untouched.
- [ ] Sweeps at zero: `grep -rn "assert.ok(true" server/__tests__/`,
      `grep -rn "|| true" server/__tests__/`; plus the ungreppable checks —
      no zero-assertion bodies, no fixtures that don't construct what their
      comments claim (programmatically count them), no empty `it()`s in the
      client i18n specs.
- [ ] Manual Resume walkthrough completed in real Chrome (steps in §1),
      including the pre-slice-DB boot check; regeneration-burst size
      observed and recorded (open question A).
- [ ] File headers on every touched source file
      (`bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0);
      docs updated for the schema/behavior change per the
      `update-project-docs` skill.

### Recorded as NOT run in this QA pass
- No tests were executed on the *local working tree* substrate (`d830a44`) —
  it predates the tick build; all baseline runs used a clean `origin/master`
  snapshot extracted to the session scratchpad (results: value-summary +
  value-summary-tick + single-writer-guard + focus-summary 77/77 pass;
  db-migration 22/22 pass; PlanLedgerPanel 14/14 pass).
- `npm run mcp:typecheck` / full client suite: not run — no MCP or
  broader-client surface is touched by this QA pass itself; required at
  build if `client/src/lib/api.ts` types change for the new state(s).
