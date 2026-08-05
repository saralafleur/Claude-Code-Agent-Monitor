# Technical Plan — Value Pool altitude cache: mutability-aware caching + invalidation (Slice 1)

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/`
**Parent request:** `requests/2026-08-04-value-pool-grouping/request.md` (four-slice
vision; **Slice 1 only** — slices 2–4 are context, not scope).
**Date:** 2026-08-04
**Classification (PM, DEC-1):** `missed-requirement`, with a `new-feature`
carve-out for the seen-state round-trip.
**Inputs read in full:** `request-brief.md`, `pm-plan.md`,
`supporting/architect.md`, `supporting/engineer.md`, `supporting/qa.md`,
`intake/2026-08-04-value-summary-tick/decisions.md` (prior effort),
`PROJECT-CONTEXT.md` §9 catalog, `server/db.js` migration idioms,
`server/__tests__/db-migration.test.js` `UPGRADE_CASES`.
**Tracked decisions:** `./decisions.md` (DEC-1..DEC-15, WATCH-A..WATCH-G,
OPEN-1..OPEN-4, DEPENDENCY-1..3). **Every scope boundary this plan declines is a
row there, not a sentence here.**

**Line-number substrate:** every server-side citation below is against
**`origin/master` @ `55fe900`**, as verified by the architect, engineer and QA
passes. The local checkout (`d830a44`) is two commits behind **and 44 paths
dirty** — do not resolve these line numbers against it. `focus-summary.js`,
`db-migration.test.js` and the `db.js` migration-idiom citations
(`db.js:1004-1009`, `db.js:1017-1026`) are unchanged between the two and were
re-verified directly in this pass.

---

## 1. Objective

The Value Pool caches two plain-language sentences per unit of delivered work,
keyed on the unit's key and served forever — a contract `server/db.js:821-825`
states outright (*"a unit's ground fact … is immutable once seen, so there is
nothing to invalidate: generated once, served forever"*). That contract is false
for every unit whose **stage** moves: `buildPrompt` (`value-summary.js:99-105`)
renders `value_source`, `label || value_ref` **and** `u.stage`, and
`assembleValuePool` (`value-ledger.js:207-223`) stamps `stage: initiative.stage`
onto `intake_initiative` *and* `merge_commit` units. The live proof is on record:
the Resume project's `2026-08-03-job-pipeline-tracker` initiative is cached as
*"The job pipeline tracker is built and being tested"* and will keep saying that
after the tracker ships.

We will store, on each cached summary row, the **raw input snapshot** the text
was generated from (`input_stage`, `input_label`), compare it field-wise on every
read for mutable sources, treat any difference as a cache miss for that one unit
so the existing batch/cap/partition machinery regenerates it untouched, serve the
old text with a **named freshness** rather than blanking it while a refresh is
pending, show an *"updated — stage changed"* marker until the user acknowledges
it (server-side `seen_at`), record the invalidation count in
`value_summary_generation_log` from **both** invokers, and rewrite the false
schema comment. `trunk_commit` units keep today's generate-once behavior exactly.

**And — the one thing never traded away —** `buildPrompt` will consume a shared
`unitFacts()` extraction and never the raw unit, so the prompt's input set and
the compared input set are *the same object*, with a structural scan that fails
if `buildPrompt` reads any unit field outside it. That is what stops the *third*
instance on this surface: today's stale sentence is the symptom; a future prompt
field added without a matching comparison field is the disease.

---

## 2. Recommended approach

**Architect Option A + A1, as re-shaped by the engineer's corrections and the
PM's rulings.** One shared `unitFacts()` extraction; gating inside `readCached`;
a stale hit becomes an ordinary miss; freshness rides as extra fields on
**resolved** entries; "seen" is server-side and explicitly acknowledged;
request-path logging lands now.

### The design in one paragraph

`unitFacts(unit)` is the single normalizer of the prompt's input set. `buildPrompt`
renders from it; `value_unit_summaries.input_stage` / `.input_label` store it;
`compareUnitInputs(row, unit)` compares it field-wise and returns the reason
(`stage_changed` > `label_changed`, else `null`). `readCached(dbModule, unit)`
consults the comparator for `MUTABLE_VALUE_SOURCES` only and returns
`{ cached: null, staleReason }` when the snapshot differs — so a stale hit is
literally a miss and flows through the existing dedupe → LLM gate → cap slice →
batch spawn → partition bookkeeping with **zero structural change**. Regeneration
writes through the **one existing** `upsertValueUnitSummary.run(` call site, so
that guard's call-site count stays 1 and no guard is widened for regeneration
itself. What could not be refreshed this round is put back into `altitudes` with
its **old text** and a named `freshness`, never into `states`.

### What was overridden, and why

1. **Overrode the architect's `input_digest` design → raw fields, no digest**
   (DEC-2). A sha1 over `(stage, label)` cannot say *which* field moved, and the
   approved copy is *"updated — stage changed"* (engineer **G2**). It also
   converts §9.1 from *guarded* to *inapplicable*: with raw fields there is no
   formula for a second site to re-derive, only `a !== b`. The `focus_summaries`
   precedent transfers in **shape** (one shared extraction feeding both the
   prompt and the comparison — `focus-summary.js:106-107`'s own comment is the
   in-repo statement of the cure), not in representation.
2. **Overrode the architect's try/`SELECT … LIMIT 1`/catch ALTER idiom → PRAGMA
   `table_info`** (DEC-5). The architect's exemption argument ("`value_unit_summaries`
   is not a §9.2-scanned table") fails on a verifiable fact:
   `chronology-ordering.test.js` derives `filesToScan` from `server/lib/*` +
   `server/routes/*` **plus `server/db.js`**, with
   `FILE_DISPOSITIONS["server/db.js"] = "scanned"` — the scan reads db.js's SQL
   literals, not their target table. Copy `db.js:1017-1026`
   (`detour_dispositions.project_id`), not `db.js:1004-1009`
   (`plan_items.target_date`).
3. **Overrode the request's own scope fence on `merge_commit`** (DEC-6). Its
   stated reason ("content-addressed") is true of the SHA and false of the prompt
   input set — the same unexamined premise this intake exists to correct.
   `MUTABLE_VALUE_SOURCES = ["intake_initiative","detour","merge_commit"]`.
   One-string veto path recorded in DEC-6.
4. **Overrode the architect's `invalidation_reasons TEXT` JSON column on the log**
   → dropped (DEC-12). The engineer's split is better and resolves the grain
   mismatch honestly: **count in the log, reason on the row**. A JSON map would be
   a second home for a reason `value_unit_summaries.regen_reason` already owns.
5. **Overrode the engineer's `ALTER … NOT NULL DEFAULT 0` for `stale_regenerated`**
   → nullable, **no DEFAULT** (DEC-3). `DEFAULT 0` stamps every historical row
   with a false *measured* zero; NULL means "predates measurement", which is a
   different fact.
6. **Reshaped the architect's freshness wire shape** into one `freshness` field
   over one `ALTITUDE_FRESHNESS` registry (DEC-13). The architect's registry
   named three strings that its own wire shape (`refresh:`/`updated:`) never
   carried — a registry that does not describe the wire is a §9.1 dual-view on
   day one.
7. **Added `counts` to `enrichPoolAltitudes`'s return** (DEC-14). DEC-4 creates a
   *second* logger; letting the tick and the route each derive the four-term
   partition from the return shape is the re-derivation class that produced §9.3
   event #1 of the prior effort. The composer computes them once.
8. **Rejected the architect's Option B outright** (new `ALTITUDE_STATES` strings)
   on verified `AltitudeText` behavior: any unrecognized state string renders as
   the "unavailable" copy, so a live tab across the upgrade would *lose text it
   was already displaying*. `ALTITUDE_STATES` gains nothing this slice (DEC-3).

### Fixed while we are in here (PO AC-7, non-optional)

`server/db.js:821-825`'s schema comment and `server/lib/value-summary.js`'s
file-header "generated once, served forever" paragraph (lines ~32-38, which also
carries the "ONE lexical writer" claim) are both rewritten **in the same diff**.
Per the PM's §4 countermeasure and PROJECT-CONTEXT §9.8's invariant corollary,
the replacement comment must **enumerate the input set and name the function that
computes it** — a comment forced to say `{value_source, label||value_ref, stage}`
could not have concluded "immutable."

---

## 3. Change set

Paths are repo-relative to the **effort worktree**
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor`
(see Step 1 — **never** the main checkout).

### Schema / data (server)

| File | Change |
|---|---|
| `server/db.js` | **(a)** Rewrite the `value_unit_summaries` schema comment (821-825) — the false "generated once, served forever" paragraph — enumerating the input set and naming `unitFacts()`. **(b)** `value_unit_summaries` CREATE body (826-832) gains `input_stage TEXT`, `input_label TEXT`, `regenerated_at TEXT`, `regen_reason TEXT`, `seen_at TEXT` (all nullable). **(c)** `value_summary_generation_log` CREATE body (1822-1835) gains `stale_regenerated INTEGER` (nullable, **no DEFAULT**), with a comment stating it is an **overlap counter, not a fifth partition term** (WATCH-A). **(d)** Two PRAGMA-`table_info`-guarded ALTER blocks, on the `db.js:1017-1026` precedent. **(e)** `upsertValueUnitSummary` (3193-3201) widens its column/param list and its `DO UPDATE SET` — including `seen_at = NULL` (engineer **G3**). **(f)** New statement `markValueUnitSummariesSeen`. **(g)** `insertValueSummaryGeneration` (3234-3238) gains the `stale_regenerated` column/param. `getValueUnitSummary` (3192) is `SELECT *` — **no change needed**. |

### Synthesis composer (server) — the §9.1/§9.8-critical surface

| File | Change |
|---|---|
| `server/lib/value-ledger.js` | New export `MUTABLE_VALUE_SOURCES = ["intake_initiative","detour","merge_commit"]`, beside `VALUE_SOURCES` (source taxonomy, not synthesis logic — DEC-6). No other change; `assembleValuePool` stays the sole pool composer (prior effort DEC-16 / `CONSUMERS` untouched). |
| `server/lib/value-summary.js` | New `unitFacts(unit)`; new `compareUnitInputs(row, unit)`; `buildPrompt` (99-105) refactored to consume `unitFacts` **only**; `readCached` (~81-94) takes the unit and gates on the comparator; `enrichPoolAltitudes` returns `{ altitudes, states, counts }` with freshness fields on resolved entries; new export `ALTITUDE_FRESHNESS`; `ALTITUDE_STATES` (47) **unchanged**; the write site (230) passes the new params; file-header rewritten (see §2 "Fixed while we are in here"). |

### Background sweep (server)

| File | Change |
|---|---|
| `server/lib/value-summary-tick.js` | The counting loop (112-124) is replaced by reading `counts` off the composer's return (DEC-14); the `insertValueSummaryGeneration.run(` call (158-169) passes `counts.stale_regenerated`. **No** scheduler, rotation, overlap-guard or `pending_after_sweep` change (prior effort WATCH-8 / T-C untouched). Optional and additive: the `value_altitudes_updated` broadcast payload (170-176) may carry `stale_unit_keys`. |

### Request fast lane (server)

| File | Change |
|---|---|
| `server/routes/project-plans.js` | `POST /altitudes` (141-174): unchanged sanitization (163-170) and unchanged composer call; the response now carries the freshness fields automatically, **plus** a new `insertValueSummaryGeneration` write with `source='request'` and `pool_size` = the submitted batch size (DEC-4). **New endpoint** `POST /api/project-plans/altitudes/seen` `{project_id, unit_keys: string[]}` → `markValueUnitSummariesSeen` → `{updated: n}`. |

### Structural guards & tests (server)

| File | Change |
|---|---|
| `server/__tests__/single-writer-guard.test.js` | **(1)** `insertValueSummaryGeneration`'s expected file set widened to include `server/routes/project-plans.js` — **deliberately red first** (DEC-4, prior effort WATCH-6; the existing test's own comment at 259-265 names this moment). **(2)** New single-call-site guard for `markValueUnitSummariesSeen` (architect R8). **(3)** New `buildPrompt` structural scan (DEC-15). **(4)** New comparator-single-home scan (no file other than `value-summary.js` reads `input_stage`/`input_label`). **(5)** `assertSingleHome`'s `absent` lists updated for `MUTABLE_VALUE_SOURCES` and `ALTITUDE_FRESHNESS`. **(6)** The existing exactly-one `upsertValueUnitSummary.run(` assertion (235) stays at **1** and is not touched. |
| `server/__tests__/value-summary.test.js` | A1 (comparator stability/sensitivity), D1–D6 lifecycle tests incl. the named `resumeJobPipelineTracker` fixture, the DEC-7 cross-path parity case, the widened wire-partition (Case 5) assertions with stale units in the fixture, and the combination cases (stale × over-cap, stale × LLM-down). |
| `server/__tests__/value-summary-tick.test.js` | L1–L3 (four-term partition exact under staleness with `cache_hits` counting only snapshot-valid hits; `stale_regenerated` recorded and bounded; sweep drains staleness through the shared read path). |
| `server/__tests__/db-migration.test.js` | Two new `UPGRADE_CASES` entries (M1 `value_unit_summaries`, M2 `value_summary_generation_log`), on the `detour_dispositions.project_id` precedent at lines 130-160. **No new `GRANDFATHERED` entries.** |
| `server/__tests__/chronology-ordering.test.js` | Expected to need **no change** — the PRAGMA idiom introduces no `SELECT … LIMIT` literal. Verify, do not assume. |

### Client

| File | Change |
|---|---|
| `client/src/lib/types.ts` | Altitude entry type gains `freshness?`, `update_reason?`, `regenerated_at?`; request/response types for the seen endpoint. |
| `client/src/lib/api.ts` | `projectPlans.altitudes` (~2683-2716) response type widened (the entry object arm, **not** the `Record<string,"queued"\|"unavailable">` states arm — that is unchanged); new `api.projectPlans.markAltitudesSeen(projectId, unitKeys)`. |
| `client/src/components/PlanLedgerPanel.tsx` | `Altitude` union's object arm (321) gains the three fields; `AltitudeText` (331-355) **text rendering unchanged**; `PoolUnitRow` (357-430) renders the marker + per-unit "×"; a panel-level "dismiss all updated markers" control; the load/effect block (542-588) unchanged except for wiring the acknowledge call. The hand-typed state list at 558 is **unchanged** (DEC-3 adds no `ALTITUDE_STATES` values). |
| `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` | New keys under the existing `planLedger.pool.altitudes.*` namespace: `updatedStageChanged`, `updatedLabelChanged`, `staleRefreshQueued`, `staleRefreshUnavailable`, `dismiss`, `dismissAll` — **all four locales** (`i18n.test.ts` E1.1 derives the parity check from `en` and fails loudly on a gap). |
| `client/src/components/__tests__/PlanLedgerPanel.test.tsx` | C1–C3. |
| `client/src/pages/__tests__/screens.snapshot.test.tsx` | Baselines regenerated **after reviewing the diff** (`cd client && npx vitest run -u`), never blind-updated. |

### Docs & catalog

| File | Change |
|---|---|
| `PROJECT-CONTEXT.md` | The two notes from `pm-plan.md` §6 DEC-10, **verbatim**, appended to §9.8 and §9.1, both explicitly marked *count unchanged / not an occurrence*. **On the effort branch only.** |
| `docs/API.md`, `docs/DATABASE.md`, `server/README.md`, `ARCHITECTURE.md` | New endpoint, widened response, six new columns, the corrected cache contract — via the `update-project-docs` skill. |
| `./decisions.md` | Created at Step 1.5, updated at Steps 4/12/15 (WATCH-B's measured burst size, DEC-4's red-proof record, OPEN-3's answer if Sara gives one). |

---

## 4. Implementation steps

Each step is independently checkable. **Do not reorder 2 → 8**: the schema must
exist before the composer can stamp it, the composer's return shape must exist
before the tick and route read it, and the server contract must exist before the
client types it. Guards are written **with** each layer, never batched at the end
(DEPENDENCY-3).

### Step 1 — Environment gate (BLOCKING, DEPENDENCY-1). Nothing else starts until this is done.

Per `pm-plan.md` §5 and this repo's `concurrent-session-risk` memory (multiple
sessions share this cwd; it **has** caused real work loss):

1. **Before any git operation**, check for live sessions:
   ```bash
   ps -eo pid,etime,command | grep -i claude | grep -v grep
   lsof ~/.claude/agent-dashboard/dashboard.db
   ```
   Expect to find them: a `concurrently` dev server (pid ~79758, ~19h uptime) and
   a live `claude` CLI (pid ~88709). If another session is mid-write, stop and
   coordinate.
2. **Do not** fast-forward, stash, checkout, reset or clean the main checkout.
   Its **44 modified paths** are someone else's in-flight work and include
   `server/db.js`, `client/src/lib/api.ts`, `client/src/lib/types.ts` — three
   files this slice must edit.
3. ```bash
   git fetch origin
   git worktree add /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor \
     -b effort/2026-08-04-altitude-invalidation 55fe900
   cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor
   npm run setup
   ```
   `55fe900` (or later) only — `value-summary-tick.js` and the two log/sweep
   tables **do not exist** at the local `d830a44`.
4. **Back up the live DB before the effort branch is booted or tested even once.**
   This slice ships DDL, `DB_PATH` resolves to the user-global shared
   `~/.claude/agent-dashboard/dashboard.db`, a dev server is holding it, and
   `db.js` runs migrations at `require()` time. The columns are additive/nullable
   so a code-level back-out leaves a working database — the backup is for the
   crash-mid-run case, not the rollback case.
5. **Every** test invocation sets `DASHBOARD_DB_PATH` to a temp path, scoped to
   the block that `require`s `../db`. A per-file grep is a **proven-invalid**
   sweep for this (§9.3, 2026-08-03). This is the still-uncatalogued
   **TEST-AGAINST-LIVE-DB** candidate and a schema-shipping slice is exactly its
   promotion trigger.

**Proves:** `git status --porcelain` in the main checkout is byte-identical
before and after; `git log -1` in the worktree is `55fe900`+; a baseline
`npm run test:server && npm run test:client` is green **in the worktree** before
any edit (QA recorded 77/77 server across the four specs, db-migration 22/22,
PlanLedgerPanel 14/14 at this substrate).

### Step 1.5 — Artifacts on the branch (DEPENDENCY-2)

Copy the whole `requests/2026-08-04-value-pool-grouping/` tree (this plan,
`decisions.md`, `pm-plan.md`, `request-brief.md`, `supporting/`) into the
worktree and commit it **before the first line of build code**. The parent
effort's cycle-breaker, retained.

**Proves:** `decisions.md` with DEC-1..DEC-15, WATCH-A..WATCH-G, OPEN-1..OPEN-4
exists on `effort/2026-08-04-altitude-invalidation`.

### Step 2 — `server/db.js`: schema, migrations, statements

1. **Rewrite the comment at 821-825.** It currently reads *"Keyed on the unit's
   own unitKey, NOT a content digest like focus_summaries — a unit's ground fact
   … is immutable once seen, so there is nothing to invalidate: generated once,
   served forever."* Replace with a statement that **enumerates the input set and
   names its computing function**, e.g.: the cached text is generated from the
   prompt input snapshot `{value_source, label || value_ref, stage}` computed by
   `unitFacts()` in `server/lib/value-summary.js`; `input_stage`/`input_label`
   record that snapshot; for `MUTABLE_VALUE_SOURCES` a field-wise difference is a
   cache miss for that one unit; `trunk_commit` is exempt because its only
   prompt-feeding field is sha-derived.
2. **`value_unit_summaries` CREATE body (826-832)** gains, all nullable:
   `input_stage TEXT`, `input_label TEXT`, `regenerated_at TEXT`,
   `regen_reason TEXT`, `seen_at TEXT`. Document at the columns (DEC-12):
   - `input_label IS NULL` is the **legacy discriminator** — `unitFacts()`
     guarantees a non-empty label fact (`"(untitled)"` fallback), so it has
     exactly one meaning. `input_stage IS NULL` does **not** — a `detour` unit
     legitimately has no stage.
   - `regen_reason` is stamped on **every** write (`'initial'` first time); NULL
     therefore also means legacy-only. No CHECK — future reasons stay additive.
   - `regenerated_at` is the **marker discriminator**: NULL on a first
     generation, set only when previous text was replaced.
3. **`value_summary_generation_log` CREATE body (1822-1835)** gains
   `stale_regenerated INTEGER` — **nullable, no DEFAULT**, with a comment stating
   both facts explicitly: NULL = predates measurement (≠ measured zero), and it
   is an **overlap counter, not a fifth partition term**; the identity
   `cache_hits + generated + queued + unavailable === pool_size` is unconditional
   (engineer **G7**, WATCH-A). `source`'s CHECK `('tick','request')` and
   `outcome`'s CHECK `('ok','skipped','error')` are **untouched** — no §9.6
   rebuild.
4. **Two guarded ALTER blocks**, PRAGMA form only (DEC-5), copying
   `db.js:1017-1026`:
   ```js
   const valueUnitSummaryColumns = db.prepare("PRAGMA table_info(value_unit_summaries)").all();
   if (!valueUnitSummaryColumns.some((col) => col.name === "input_label")) {
     db.exec(`
       ALTER TABLE value_unit_summaries ADD COLUMN input_stage TEXT;
       ALTER TABLE value_unit_summaries ADD COLUMN input_label TEXT;
       ALTER TABLE value_unit_summaries ADD COLUMN regenerated_at TEXT;
       ALTER TABLE value_unit_summaries ADD COLUMN regen_reason TEXT;
       ALTER TABLE value_unit_summaries ADD COLUMN seen_at TEXT;
     `);
   }
   const valueGenLogColumns = db.prepare("PRAGMA table_info(value_summary_generation_log)").all();
   if (!valueGenLogColumns.some((col) => col.name === "stale_regenerated")) {
     db.prepare("ALTER TABLE value_summary_generation_log ADD COLUMN stale_regenerated INTEGER").run();
   }
   ```
   Probe on `input_label` (the group's discriminator) so the five-column block is
   all-or-nothing. **No** try/`SELECT … LIMIT 1`/catch anywhere.
5. **Statements** (3190-3238): widen `upsertValueUnitSummary` (3193-3201) to
   carry the five new columns and set them in `DO UPDATE SET`, **including
   `seen_at = NULL`** (engineer **G3** — a second regeneration must not render as
   already-seen, and the reset must live in the one writer, never as a caller's
   second UPDATE). Add `markValueUnitSummariesSeen`:
   `UPDATE value_unit_summaries SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE unit_key = ?`.
   Add `stale_regenerated` to `insertValueSummaryGeneration` (3234-3238).
   `getValueUnitSummary` (3192) needs no change (`SELECT *`).

**Proves:** `DASHBOARD_DB_PATH=<tmp> node --test server/__tests__/db-migration.test.js`
— the meta-test now **demands** upgrade cases for the two ALTERs (Step 3 writes
them); the rest of `npm run test:server` stays green because nothing reads the
columns yet; a fresh DB and a copied pre-slice DB both open cleanly.

### Step 3 — `UPGRADE_CASES` (`server/__tests__/db-migration.test.js`)

Two entries on the `detour_dispositions.project_id` precedent (lines 130-160:
`table` / `column` / `legacySql` seeding the pre-column shape / `seed` /
`assertLegacyRow` NULL read / `assertWritable`):

- **M1 — `value_unit_summaries.input_label`.** `legacySql` = the pre-slice CREATE
  body verbatim (`unit_key, project_level, stakeholder_level, model, created_at`).
  Seed **one mutable row** (an `intake_initiative::` row — use the
  `resumeJobPipelineTracker` shape) **and one `trunk_commit::` row**. Assert:
  columns exist after `require`, legacy rows read NULL, writable, second
  `require` is a no-op. Then the **behavioral leg**: the legacy mutable row is
  served **stale** and the legacy commit row **fresh** (this is DEC-9 codified,
  and it feeds fixture D5).
- **M2 — `value_summary_generation_log.stale_regenerated`.** Same shape. Assert
  the legacy row reads **NULL, not 0** — that is the DEC-3 distinction, and a
  `DEFAULT 0` implementation makes this assertion red.

**No new `GRANDFATHERED` entries.** The meta-test forcing these cases is by
design.

**Red proofs:** M1/M2 self-red-prove the ALTER's *existence* via the meta-test.
For the behavioral leg, revert the stale-on-legacy check in `readCached` → M1's
behavioral assertion must go red. **Confirm the fixture actually reaches the
comparison** by tracing the early-return chain before trusting the red — a
fixture the code short-circuits before the guarded branch makes the mandated
red-first procedure itself pass vacuously (PLAN-LEVEL VACUOUS FIXTURE, §9.3
2026-08-03).

### Step 4 — `server/lib/value-ledger.js`: the mutability registry

Export `MUTABLE_VALUE_SOURCES = ["intake_initiative", "detour", "merge_commit"]`
beside `VALUE_SOURCES`, with a comment naming DEC-6's reasoning (a `merge_commit`
unit's SHA is immutable but `value-ledger.js:216-223` stamps a mutable
`stage: initiative.stage` on it, and `buildPrompt` feeds stage into the prompt).
Update `assertSingleHome`'s `absent` lists in `single-writer-guard.test.js` in
the **same commit** — that tripwire going red is it working.

**Membership is keyed on `value_source`, never on "does this unit have a stage"**
(engineer **G1**). `trunk_commit` carries `label` only (`value-ledger.js:245`).

**Proves:** `npm run test:server` green; the export-disposition scan lists the new
export deliberately.

### Step 5 — `server/lib/value-summary.js`, part 1: `unitFacts` + `buildPrompt` (the durable cure)

```js
/** The complete prompt input set for one unit. The ONLY place a unit's fields
 *  are read for synthesis: buildPrompt renders from this, the cache stores it,
 *  and compareUnitInputs compares it — so the prompt's input set and the
 *  compared input set are the same object by construction. Adding a field to
 *  the prompt is physically impossible without adding it to the comparison. */
function unitFacts(unit) {
  return {
    value_source: unit.value_source ?? null,
    label: unit.label || unit.value_ref || "(untitled)",
    stage: unit.stage ?? null,
  };
}
```

Then refactor `buildPrompt` (99-105) so its per-unit rendering reads **only**
`unitFacts(u)`. Binding details:

- **Store the resolved value the prompt renders, not the raw column** (DEC-2).
  `input_label` = `facts.label`. Storing raw `label` makes a unit whose label goes
  `null → value_ref` fallback compare as changed when the prompt did not change —
  §9.1's drift in miniature, on day one.
- **Normalize `undefined → null` here and nowhere else.** `detour` units carry no
  `stage` key at all (`value-ledger.js:259-266`); one home for the normalization
  is what makes route-vs-tick parity **structural** rather than watched (DEC-7).
- `value_source` is part of the facts because the prompt renders it, but it is
  **not** a compared column: it is the first segment of `unit_key`
  (`intake_initiative::<ref>::<cwd>`), so it cannot drift within a row. Say this
  at the comparator, or someone will add a third column for it.

**Proves (A2 / DEC-15 — the one thing never traded away):** the structural scan
in `single-writer-guard.test.js` extracts `buildPrompt`'s lexical body, strips
**both** `//` and `/** */` comments (engineer **G6**: the existing scanner strips
only `//`, and that bit the parent build), and asserts no `u.<field>` /
`unit.<field>` property access remains. `unitFacts(u)` passes the whole unit and
is therefore permitted — that is the point. The scan asserts its own scope is
non-empty and contains the sentinel `facts.` (§9.3 corollary (a)).
**Red proof:** add `u.value_ref` into `buildPrompt` → scan red; remove; confirm
the file is byte-identical and the scan green.

### Step 6 — `server/lib/value-summary.js`, part 2: the comparator + gated `readCached`

```js
/** The one comparison. Returns null when the cached text's input snapshot still
 *  matches the unit, otherwise the reason it does not. Precedence: stage over
 *  label (DEC-2). Legacy rows (input_label IS NULL) fall out as changed with no
 *  special case — DEC-9 implemented as an absence of code. */
function compareUnitInputs(row, unit) {
  const facts = unitFacts(unit);
  if ((row.input_stage ?? null) !== facts.stage) return "stage_changed";
  if ((row.input_label ?? null) !== facts.label) return "label_changed";
  return null;
}
```

`readCached(dbModule, unit)` (was `readCached(dbModule, unitKey)`, ~81-94)
returns `{ cached, staleReason }`:

| Case | Return |
|---|---|
| no row | `{cached: null, staleReason: null}` → a first generation; reason at write = `"initial"`, `regenerated_at` stays NULL |
| immutable `value_source`, any row (incl. NULL snapshot) | `{cached: row, staleReason: null}` — **today's behavior byte-for-byte** |
| mutable, `compareUnitInputs → null` | `{cached: row, staleReason: null}` |
| mutable, `compareUnitInputs → reason` | `{cached: null, staleReason: reason}` — **a stale hit is literally a miss** |

The four-cell truth table (mutable/immutable × NULL/mismatch) is written as
explicit test cases (engineer **G1**). The failure mode to guard against by name
is someone "optimizing" with `if (!row.input_label) return row` — that stamps the
motivating Resume row fresh forever.

`enrichPoolAltitudes` keeps the stale row alongside the miss (a
`staleRows: Map<unitKey, row>` and a `staleReasons: Map<unitKey, reason>` built
in the same classification loop) and then flows **untouched** through the
existing dedupe (203) → LLM-availability gate (205) → cap slice (212-214) →
batch spawn (217) → partition bookkeeping (241-243).

**The reason is computed once, at read time, and carried to the write** — never
re-derived at the write site (§9.1's twice-proven rogue-re-derivation lesson).

**Proves:** D1 (immutable never regenerates, incl. the NULL-snapshot leg — red
proof: drop the mutable-source guard → D1 red on that leg); D2 (mutable
unchanged → cache hit, zero spawns — red proof: A3's write/check divergence,
i.e. have the write path stamp a mutated stage → D2 red); D3 (stage change
regenerates **exactly** that unit, one spawn, prompt contains only it — red
proof: `if (false)` the mismatch branch → D3 red); D4 (label change, same shape —
red proof: compare `stage` only → D4 red **while D3 stays green**, which is what
pins both fields *separately*); D5 (`resumeJobPipelineTracker`: legacy NULL row
regenerates **even though** current stage/label would compare "fresh" — red
proof: implement backfill-on-migrate → D5 red, which is the executable record of
DEC-9); A1 (comparator stability/sensitivity: unchanged → `null`, stage-only →
`"stage_changed"`, label-only → `"label_changed"`).

### Step 7 — `server/lib/value-summary.js`, part 3: the wire shape

1. **Freshness on resolved entries** (DEC-3/DEC-13). Export:
   ```js
   const ALTITUDE_FRESHNESS = ["stale_refresh_queued", "stale_refresh_unavailable", "updated_unseen"];
   ```
   A resolved `altitudes` entry may carry `freshness` (one member of that
   registry), `update_reason` and `regenerated_at`. **Absent `freshness` = fresh
   and acknowledged, or an immutable unit = today's exact rendering.**
   `ALTITUDE_STATES` (47) gains **nothing**.
2. **The re-homing rule (architect R3 — the invariant to pin):** after the states
   map is computed, any unit that had a `staleRow` and did **not** resolve this
   round is moved **out of `states` and into `altitudes`** carrying its **old**
   text plus `freshness = "stale_refresh_queued"` (was `queued`) or
   `"stale_refresh_unavailable"` (was `unavailable`). A unit with a cached row is
   **ALWAYS** present in `altitudes`, whatever its freshness. A regenerated stale
   unit lands in `altitudes` with `freshness = "updated_unseen"`. A unit with no
   row at all behaves exactly as today.
3. **`counts`** (DEC-14). Return `{ altitudes, states, counts }` where
   `counts = { pool_size, cache_hits, generated, queued, unavailable, stale_regenerated }`.
   **`cache_hits` counts only snapshot-valid hits.** A stale unit is a miss in the
   log partition regardless of what the wire does with its old text — the two
   partitions disagree **by design**, and DEC-11 is the tracked record of that.
   Put the same sentence in a comment here.

**Proves:** the wire-side exactly-one-bucket assertion (prior effort's Case 5)
extended with stale units in the fixture — `altKeys.size + stateKeys.size ===
submitted.length`, disjoint, and **every stale-with-text unit in `altitudes`**;
Case 6 (registry imported, never hand-typed) extended to `ALTITUDE_FRESHNESS`;
the combination cases stale × over-cap → served old text + `stale_refresh_queued`
and stale × LLM-down → served old text + `stale_refresh_unavailable` (one test
each — a suite with one test per branch passes while the ordering bug ships);
D6 (regenerated unit carries the marker until acknowledged; a **fresh** generation
does not — red-proven in **both** directions: skip the marker on regeneration →
D6 red; stamp it on every generation → the fresh-generation leg red).
Red proof for the re-homing rule: drop step 2 → the R3 invariant assertion goes
red **and** the old-client regression it prevents becomes reproducible.

### Step 8 — `server/lib/value-summary-tick.js`

Replace the counting loop (112-124) with a read of `counts`; pass
`counts.stale_regenerated` into the `insertValueSummaryGeneration.run(` call
(158-169). Nothing else: no scheduler, rotation, overlap-guard, or
`pending_after_sweep` change (prior effort WATCH-8 / T-C must stay green
untouched — that instrument is what would ever reveal a project outrunning the
sweep).

**Proves:** L1 (pool of 45: 10 cached-fresh, 5 cached-stale, 30 uncached, LLM on,
cap 40 → four-term identity exact **with `cache_hits === 10`, not 15** — sized so
a wrong implementation reads a different number, per the prior effort's
fixture-sizing lesson. Red proof: count stale hits into `cache_hits` **as well
as** `generated` → the sum overshoots `pool_size` → red); L2
(`stale_regenerated === 5` and `stale_regenerated <= generated + queued +
unavailable` — the overlap counter never exceeds the misses it explains);
L3 (tick 1 all-cached-fresh → zero broadcasts, existing test unchanged; mutate
one unit's stage; tick 2 → exactly that unit regenerates, one broadcast, log row
`cache_hits = pool-1, generated = 1, stale_regenerated = 1`. Red proof: disable
stale detection in the sweep path **only** → L3 red, which also proves the sweep
goes through the shared read path rather than its own).

### Step 9 — `server/routes/project-plans.js`: seen endpoint + request-path logging

1. **`POST /api/project-plans/altitudes/seen`** `{project_id, unit_keys:
   string[]}` → validate (array, non-empty, string members, bounded length) →
   `markValueUnitSummariesSeen` per key inside one transaction → `{updated: n}`.
   Structured errors per `.claude/rules/backend-node.md`. Double-acknowledge is
   idempotent by construction (it is an unconditional `SET`).
2. **Request-path generation logging** (DEC-4): after the composer call, write
   one `insertValueSummaryGeneration` row with `source='request'`,
   `pool_size = units.length` (the submitted batch size), the four terms from
   `counts`, and `counts.stale_regenerated`.
3. **`POST /altitudes` (141-174) itself is otherwise unchanged** — the same
   sanitization (163-170), the same composer call. Freshness fields ride out on
   the response automatically.

**Guard work, in the same commit, each red-proven (engineer G6, QA pre-declared
these):**
- `insertValueSummaryGeneration`'s expected file set widens to include
  `server/routes/project-plans.js`. **Watch it go red first**, then widen —
  the existing test's own comment (259-265) says it will be "deliberately
  widened … when request-path logging lands". This is prior-effort WATCH-6's
  designed procedure, not a defect.
- **New** single-call-site guard for `markValueUnitSummariesSeen` (architect R8):
  it is a genuinely new **second production writer** to `value_unit_summaries`,
  which the existing `upsertValueUnitSummary` guard does not cover. Red-prove by
  injecting a rogue second call site. Narrow the `value-summary.js` header's
  "ONE lexical writer of the cache table" claim (lines ~32-35) to "one writer of
  the **synthesis columns**" in the same diff — leaving it is a documentation lie
  at the exact point of change.
- The existing exactly-one `upsertValueUnitSummary.run(` assertion (235) stays at
  **1**. Regeneration widens **no** writer guard. If it goes red, the design was
  violated — do not widen it.
- Note the scanner strips only `//` comments (224-232), **not** `/** */` blocks:
  a JSDoc containing the literal `upsertValueUnitSummary.run(` counts as a call
  site. This bit the parent build.

### Step 10 — DEC-7's cross-path parity test (required, not a watch)

An explicit case asserting that the unit the **route** reconstructs from client
JSON (`project-plans.js:163-170`) and the unit the **tick** gets from
`assembleValuePool` produce **identical `unitFacts()`** for the same underlying
initiative — including the `""` vs `null` vs missing-key cases. Without it, a
normalization difference makes the same unit oscillate stale↔fresh between paths
and regenerate on **every alternation**: silent, unbounded LLM spend that no
existing test can see (engineer **G8**).

Verified as feasible with no new plumbing: `api.projectPlans.altitudes`
(`api.ts` ~2683-2716) already posts `label`/`stage`, the route already sanitizes
and forwards them, and the tick passes raw `assembleValuePool` units
(`value-summary-tick.js:109-111`).

**Red proof:** make the route coerce a missing `stage` to `""` instead of leaving
it undefined → parity test red.

### Step 11 — Client: types → api → panel → i18n

In that order (each layer's compile depends on the previous):

1. `types.ts` — entry fields + seen request/response types.
2. `api.ts` — widen the altitude entry type (**not** the states `Record`, which
   is unchanged); add `markAltitudesSeen`.
3. `PlanLedgerPanel.tsx` — `Altitude`'s object arm (321) gains `freshness?`,
   `update_reason?`, `regenerated_at?`; `AltitudeText`'s **text rendering is
   untouched**; `PoolUnitRow` (357-430) renders the marker (i18n key chosen from
   `update_reason`, never hardcoded English) with a per-unit "×"; a panel-level
   "dismiss all updated markers" control batches the keys into one
   `markAltitudesSeen` call. **Explicit acknowledgement only — never
   auto-on-render** (DEC-8: auto-on-render lets a second device on the LAN
   consume a marker Sara never read, which makes "seen" mean two things inside
   the slice built to stop exactly that).
4. i18n — the six keys in **all four** locales.

**The three hand-typed client registries must move together** (engineer **G5**):
`PlanLedgerPanel.tsx:558`'s `!["queued","unavailable"].includes(state)`, the
`Altitude` union at 321, and `api.ts`'s `Record<string,"queued"|"unavailable">`
(~2715). This slice adds **no** `ALTITUDE_STATES` values (DEC-3), so all three
keep their current state lists — **verify** that rather than assuming it, since
`ALTITUDE_FRESHNESS` now adds a fourth hand-copy of a *different* registry
(WATCH-F).

**Proves:** C1 (a unit with `freshness: "updated_unseen"` renders the marker via
its i18n key alongside the regenerated text, **distinct from
generating/queued/unavailable in the same render** — extend the existing
T-D-style combined-render test, per §9.8's "test the combination"; red proof:
disable the marker branch → red); C2 (acknowledging calls `markAltitudesSeen`
**exactly once** and the marker disappears without a full refetch; red proof:
double-fire the handler → the exactly-once assertion red); C3 (the existing T-E
out-of-registry-warn test **stays green with its fixture still out-of-registry**
— pick the names, then re-verify the bogus value is still bogus).

### Step 12 — Docs, catalog, headers

1. `PROJECT-CONTEXT.md`: append the two `pm-plan.md` §6 DEC-10 notes **verbatim**
   (§9.8's invariant corollary; §9.1's inapplicability note), both marked *count
   unchanged / not an occurrence*. **On the effort branch** — never on the dirty
   main checkout, which is precisely the hazard Step 1 exists to avoid.
2. Run the `update-project-docs` skill for `docs/API.md`, `docs/DATABASE.md`,
   `server/README.md`, `ARCHITECTURE.md` — all four describe the generate-once
   contract today.
3. `bash .claude/skills/file-headers/scripts/check-headers.sh` must exit 0; every
   touched `.js/.ts/.tsx` keeps its overview + the exact
   `@author Son Nguyen <hoangson091104@gmail.com>` line, and any file whose
   purpose changed gets its overview updated.
4. Fill WATCH-B's measured burst size and DEC-4's red-proof record into
   `decisions.md`.

### Step 13 — Full verification (see §6)

---

## 5. Single-source-of-truth guardrail

This project's convention is `PROJECT-CONTEXT.md` §9's defect-class catalog. Two
entries bind this change structurally, and this plan routes through them rather
than hand-editing one path:

**§9.1 DERIVED-DUAL-VIEW — made *inapplicable*, not merely guarded.** There is
**exactly one** function that reads a unit's fields for synthesis:
`unitFacts(unit)` in `server/lib/value-summary.js`. `buildPrompt` renders from
it, `upsertValueUnitSummary` stores it, `compareUnitInputs` compares it. There is
**no digest formula** for a second site to re-derive (DEC-2) — a rogue second
site would have to re-implement `a !== b`, which is not a divergence risk. The
invalidation reason is produced by the **same** comparator call that gated the
read and is carried to the write; it is never recomputed. The counts written to
the generation log are produced **once** by the composer and read by both loggers
(DEC-14), because DEC-4 creates a second logger and a second derivation of the
four-term partition is the arithmetic-identity class that produced §9.3 event #1
of the prior effort. Inapplicability over compliance is this catalog's own stated
preference (§9.6's 2026-08-02 lesson, since proven twice).

**The belt, because §9.1's twice-proven lesson points the *other* way here.** A
rogue-*reader* scan does not catch a rogue *re-derivation* — and the direction
this entry has never named is a **prompt** that grows a field the **comparator**
doesn't cover. So the structural scan (DEC-15, Step 5) asserts `buildPrompt`'s
body contains **no** `u.<field>` access outside `unitFacts(u)`. **This is
mandatory and is the one item never traded away under schedule pressure.**
Everything else in this slice fixes today's stale sentence; this is what stops
the third instance.

**§9.8 OVERLOADED-ABSENCE — this surface *is* the entry's live instance #1.**
Every new distinguishable outcome is named and server-authored, never a silent
absence or a client-side heuristic: `stale_refresh_queued`,
`stale_refresh_unavailable`, `updated_unseen` (all members of the exported
`ALTITUDE_FRESHNESS` registry); `input_label IS NULL` = legacy pre-snapshot row,
**exactly one meaning**, because `unitFacts()` guarantees a non-empty label fact
on every new write; `stale_regenerated IS NULL` = predates measurement, distinct
from a measured zero. **Count stays unchanged** — re-encountering a known
instance is explicitly not an occurrence per the entry's own rule; the notes
added in Step 12 are a design-time pre-flag.

**Also routed, not hand-edited:** `MUTABLE_VALUE_SOURCES` has **one home**
(`value-ledger.js`, beside `VALUE_SOURCES`) and is imported, never re-listed;
`ALTITUDE_FRESHNESS` has one server home and is imported by the server-side
registry-scan test; the i18n key set derives from `en` mechanically. The four
client-side hand-copies that cannot import a CJS registry across the Vite
boundary are §9.7's **accepted** exception and are tracked as WATCH-E/WATCH-F
with a "must move in the same commit" rule — not silently tolerated.

---

## 6. Testing & verification

QA's plan, re-targeted per DEC-2 (it was written around `computeUnitInputDigest`;
A1 becomes comparator stability/sensitivity, A2's scan targets the comparator and
`buildPrompt`, **A3's mutation applies verbatim**, D3/D4 now also pin the two
reason strings).

### Commands

```bash
# in the effort worktree, always with DASHBOARD_DB_PATH set
DASHBOARD_DB_PATH=/tmp/slice1.db node --test server/__tests__/value-summary.test.js
DASHBOARD_DB_PATH=/tmp/slice1.db node --test server/__tests__/value-summary-tick.test.js
DASHBOARD_DB_PATH=/tmp/slice1.db node --test server/__tests__/db-migration.test.js
DASHBOARD_DB_PATH=/tmp/slice1.db node --test server/__tests__/single-writer-guard.test.js
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx

npm run test:server
npm run test:client
bash .claude/skills/file-headers/scripts/check-headers.sh
```

`DASHBOARD_DB_PATH` is set **in every spec block that `require`s `../db`**, not
per-file — `server/db.js` runs migrations at `require()` time against the real
`~/.claude/agent-dashboard/dashboard.db` when it is unset, and this slice ships
DDL. A per-file grep is a **proven-invalid** sweep for this (§9.3, 2026-08-03).

### Tests to add or update

| Id | Spec | What it pins | Named red proof |
|---|---|---|---|
| **A1** | `value-summary.test.js` | comparator stability/sensitivity: unchanged → `null`; stage-only → `"stage_changed"`; label-only → `"label_changed"` | make it ignore `label` → sensitivity leg red |
| **A2** | `single-writer-guard.test.js` | `buildPrompt` reads no `u.<field>` outside `unitFacts`; no file outside `value-summary.js` reads `input_stage`/`input_label`; scan scope non-empty + sentinel present | inject `u.value_ref` into `buildPrompt` → red; remove; byte-identical + green |
| **A3** | (mutation, not a test) | write/check divergence | have the write path stamp a mutated stage → **D2 must go red**. If D2 stays green, D2 is vacuous — not the mutation wrong |
| **D1** | `value-summary.test.js` | immutable (`trunk_commit`) units **never** regenerate, incl. the NULL-snapshot leg. Existing fixture already defaults to `trunk_commit` (97-106) → **zero churn** | drop the mutable-source guard → D1 red on the NULL leg |
| **D2** | " | mutable + unchanged → cache hit, zero spawns | A3 |
| **D3** | " | stage change regenerates **exactly** that unit: one spawn, prompt contains only it, other three still cached, row carries new snapshot + `regen_reason='stage_changed'` | `if (false)` the mismatch branch → red |
| **D4** | " | label change, same shape, `regen_reason='label_changed'` | compare `stage` only → **D4 red while D3 stays green** |
| **D5** | " | `resumeJobPipelineTracker` (unit_key `intake_initiative::2026-08-03-job-pipeline-tracker::<cwd>`, text *"The job pipeline tracker is built and being tested"*, `input_label = NULL` seeded through the legacy schema path) regenerates **even though** current stage/label would compare fresh | implement backfill-on-migrate → D5 red (the executable record of DEC-9) |
| **D6** | " | regenerated unit carries `updated_unseen` until acknowledged; acknowledge clears it; a **fresh** generation does not carry it | both directions: skip the marker on regeneration → red; stamp on every generation → fresh-generation leg red |
| **DEC-7 parity** | " | route-reconstructed unit and tick unit produce identical `unitFacts()` | route coerces missing `stage` to `""` → red |
| **R3 invariant** | " | a unit with a cached row is **always** in `altitudes`, whatever its freshness | drop the re-homing rule → red |
| **Case 5 (widened)** | " | wire partition exact with stale units in the fixture: `altKeys.size + stateKeys.size === submitted.length`, disjoint | add `unavailable` without clearing `queued` for a stale dup (the historical S6 bug, resurrected) → red |
| **Case 6 (extended)** | " | `ALTITUDE_FRESHNESS` imported, never hand-typed | — |
| **Combination** | " | stale × over-cap → old text + `stale_refresh_queued`; stale × LLM-down → old text + `stale_refresh_unavailable` | one test each |
| **L1** | `value-summary-tick.test.js` | 45-unit fixture (10 fresh / 5 stale / 30 uncached, cap 40): four-term identity exact **with `cache_hits === 10`, not 15** | count stale hits into `cache_hits` as well as `generated` → sum overshoots `pool_size` → red |
| **L2** | " | `stale_regenerated === 5`; `stale_regenerated <= generated + queued + unavailable` | — |
| **L3** | " | sweep drains staleness through the **shared** read path; tick 2 log row `cache_hits = pool-1, generated = 1, stale_regenerated = 1` | disable stale detection in the sweep path only → red |
| **M1/M2** | `db-migration.test.js` | legacy shape seeded, PRAGMA-guarded ALTER, legacy rows NULL (**M2: NULL, not 0**), writable, idempotent, **plus** the behavioral leg (legacy mutable stale, legacy commit fresh) | revert the stale-on-legacy check → M1 behavioral leg red; **trace the early-return chain first** so the fixture actually reaches the comparison |
| **Guards** | `single-writer-guard.test.js` | `insertValueSummaryGeneration` widened to include the route (**red first, deliberately**); new `markValueUnitSummariesSeen` guard; `upsertValueUnitSummary.run(` stays at exactly **1** | inject a rogue call site for each |
| **C1–C3** | `PlanLedgerPanel.test.tsx` | marker renders via i18n key distinct from queued/unavailable **in the same render**; acknowledge calls the API exactly once; T-E stays green with an out-of-registry fixture | disable the marker branch → C1 red; double-fire → C2 red |
| **Snapshots** | `screens.snapshot.test.tsx` | Project Detail screen — the marker is an **intentional** UI change | review the diff, then `cd client && npx vitest run -u`; **never** blind-update |

### Must stay green, untouched

`focus-summary.test.js` (the digest-gating precedent this slice mirrors in shape
— proves the shared pattern was not disturbed); the prior effort's AC-1 drain
pair, AC-2 audit-log flow, T-A concurrency, T-C `pending_after_sweep`
re-derivation, and B2 errored-sweep preservation; `chronology-ordering.test.js`
(the PRAGMA idiom should keep it quiet **by construction** — verify).

### Manual (required by CLAUDE.md, in real Google Chrome)

1. `npm run dev` in the worktree; open the Resume project's PlanLedgerPanel in
   real Chrome (`open -a "Google Chrome" <url>`); confirm the stale cached text
   renders.
2. Change the initiative's stage **through the production mutation path**, not a
   direct DB poke.
3. Next sweep or panel reopen → the text regenerates and the *"updated — stage
   changed"* marker is visible.
4. Acknowledge → marker clears; reload → **stays** cleared (server-side `seen_at`).
5. Confirm a `value_summary_generation_log` row records the invalidation, from
   whichever path did the work (both now log — DEC-4).
6. Confirm a neighbouring `trunk_commit` unit's text did **not** change and no
   spawn was burned on it (check `cache_hits`).
7. Separately: boot once against a **copy of a pre-slice DB** (any DB created at
   `55fe900`) — clean startup, no `SQLITE_ERROR`, legacy mutable rows regenerate
   lazily rather than crashing the tick. **Record the real burst size** into
   WATCH-B.

### Verification discipline (non-negotiable)

The prior effort on this exact surface produced **eight** §9.3-family events,
including a **vacuous repair of a vacuous guard**. Therefore: every guard
red-proven against a real mutation; **the red recorded per test, not as a blanket
sentence**; **no DoD row ticked on an agent's self-report**; the only technique
that reliably worked all eight times is *revert the product change and run the
actual shipped spec file, watching it go red* — use that one; and if any red
proof fails and the test is repaired, **the repaired test needs a fresh red proof
of its own**. Plan multiple independent verification passes — in that build,
every pass found something the previous pass had mis-claimed.

---

## 7. Risks & rollback

### Watch during the build

| Risk | Watch for | Tracked as |
|---|---|---|
| The comparator and the prompt drift as the prompt grows | A2's scan going red for a *legitimate* reason (someone needed a new field) — the correct response is to add it to `unitFacts`, never to relax the scan | DEC-15 |
| A stale-served unit gets counted as a `cache_hit`, or dropped out of `altitudes` | L1's sum overshooting `pool_size`; the R3 invariant assertion | **DEC-11** |
| `stale_regenerated` "fixed" into a fifth partition term | any proposed change to the four-term identity | **WATCH-A** |
| One-time regeneration burst across legacy mutable rows | first sweep after upgrade; record the real size | **WATCH-B** (and OPEN-3 sets how fast it drains) |
| A stale tab regenerates from old inputs and stamps them; the next tick re-invalidates and converges | text flip-flop, anomalous duplicate-generation counts — **observable only because of DEC-4** | **WATCH-C** |
| `buildPrompt`'s `.slice(0, 12_000)` truncates the reply-format instruction (it is in the tail); this slice increases traffic through it | a parse failure in the generation log | **WATCH-D** |
| The client's hand-typed registries drift (three for states, now a fourth for freshness) | any change to either registry not landing in all copies in one commit | **WATCH-E**, **WATCH-F** |
| Settings "clear data" still omits the value tables | unchanged by this slice; the fast-follow owns it, bound by the all-four-tables precondition | **WATCH-G** (prior effort DEC-12/WATCH-2) |
| A tick-driven regeneration does not reach an open tab until it remounts | the marker appearing late for tick-driven (not view-driven) invalidations | **OPEN-1** |

### Scope this plan knowingly declines — each backed by a tracked row, not this paragraph

Per the architect's own closing note that a *"disclosed-but-untracked exclusion
… is functionally identical to nobody having found them"*, and the PM's §4
observation that this repo has done exactly that three times:

- **Live in-place marker delivery** (no WebSocket subscriber) → **OPEN-1**. This
  is the one that most directly trims the request's own headline promise, so it
  is stated in full there rather than here.
- **The architect's R7** (`merge_commit` left un-gated) is **not** declined — it
  was **absorbed** by DEC-6, which is why R7 has no WATCH row: the risk was
  removed, not disclosed. If Sara takes DEC-6's one-string veto, that WATCH row
  **must** be created in the same reversal.
- **The architect's Option C sidecar** (`value_summary_invalidations` at the
  event's natural grain) → not built; noted in DEC-12 as the cleaner audit home
  if acceptance signal 4's "lands in `value_summary_generation_log`" is ever
  relaxed.
- **`invalidation_reasons` JSON on the log** → dropped; DEC-12 records why (count
  in the log, reason on the row).
- **Slices 2–4** → the parent `request.md`'s committed follow-on sequence, each
  its own future intake on its own effort branch.
- **Prior effort's OPEN-2 / OPEN-4** → carried as **OPEN-2 / OPEN-3** here so
  renumbering cannot silently close them.
- **The TEST-AGAINST-LIVE-DB candidate pattern** (`DASHBOARD_DB_PATH` unset →
  a test run migrates Sara's live DB) is still uncatalogued. This slice is its
  stated **promotion trigger** (schema-shipping). Promoting it is not in this
  slice's scope; if the build declines to promote it, that decline gets its own
  `decisions.md` row before the build closes.

### Rollback

- **Code:** `git revert` the effort branch's commits, or simply do not merge —
  all work is on `effort/2026-08-04-altitude-invalidation` in a separate
  worktree, and the main checkout is never touched (Step 1).
- **Schema:** the six new columns are **additive and nullable**, so a code-level
  back-out leaves a fully working database (§9.5's own guidance). Reverted code
  ignores the columns; the pre-slice `SELECT *` and upsert both still work. **No
  down-migration is needed and none should be written** — a DROP COLUMN path on a
  shared user-global DB is a larger risk than the columns it removes.
- **Data:** `seen_at` / `regenerated_at` / `regen_reason` are metadata; the cached
  text itself is never deleted, only replaced by a regeneration — and a
  regeneration is exactly what the old code would have produced on a cache miss.
- **The one irreversible thing is spend:** regenerations already performed cost
  ~$0.001 each and cannot be un-spent. At the known 182-unit pool scale the whole
  legacy burst is ~20¢. This should not enter the decision.
- **The DB backup from Step 1.4** covers the crash-mid-migration case, not the
  rollback case.

---

## 8. Definition of Done

**No row below is ticked on an agent's self-report.** Every "red-proven" claim is
unverified until the injection is re-run by a second pass or the guard's body is
read directly; a repair of any failed red proof needs its own fresh red proof
(VACUOUS-REPAIR).

**Environment & artifacts**
- [ ] `ps`/`lsof` concurrent-session check run **before** any git operation; the
      main checkout's 44 dirty paths byte-identical afterwards.
- [ ] Effort branch cut in a **fresh worktree** from `55fe900`+; live DB backed
      up before the branch was booted or tested once; baseline suite green in the
      worktree before the first edit.
- [ ] `decisions.md` on the effort branch with DEC-1..DEC-15, WATCH-A..WATCH-G,
      OPEN-1..OPEN-4 — **before the first line of build code**.
- [ ] Every test invocation set `DASHBOARD_DB_PATH`, scoped to the block that
      `require`s `../db` (not verified by a per-file grep).

**The durable cure (MANDATORY — never traded away)**
- [ ] `buildPrompt` consumes `unitFacts()` **only**; the structural scan proves no
      `u.<field>` read outside it, **red-proven by injecting one**, scope asserted
      non-empty with a positive sentinel.
- [ ] One shared `unitFacts` + `compareUnitInputs`; the reason is computed at read
      time and carried to the write, never re-derived; `counts` computed once by
      the composer and read by both loggers.

**Behavior**
- [ ] D1–D6 exist, each **observed red under its own named mutation** and restored
      byte-identical; red outputs recorded in the build report **per test**.
- [ ] A1–A3: A3's write/check divergence shown caught by **D2 specifically**.
- [ ] DEC-7 cross-path parity case green and red-proven.
- [ ] R3 invariant pinned: a unit with a cached row is always in `altitudes`.
- [ ] Wire partition (Case 5) widened with stale units in the fixture; Case 6
      extended to `ALTITUDE_FRESHNESS`; combination cases (stale × over-cap,
      stale × LLM-down) each tested; the route and sweep seams re-assert the
      partition.
- [ ] L1–L3: four-term identity exact with `cache_hits` counting **only**
      snapshot-valid hits; `stale_regenerated` recorded and bounded; sweep drains
      staleness through the shared read path.
- [ ] `ALTITUDE_STATES` gained nothing; `MUTABLE_VALUE_SOURCES` includes
      `merge_commit`; `trunk_commit` behavior byte-for-byte unchanged.

**Schema**
- [ ] M1/M2 `UPGRADE_CASES` entries: legacy shape seeded, column added via a
      **PRAGMA `table_info`**-guarded ALTER, legacy rows NULL (**M2: NULL, not
      0**), writable, idempotent, **plus** the behavioral leg. Meta-test green
      with **no new `GRANDFATHERED` entries**.
- [ ] `chronology-ordering.test.js` needed no new grandfathering (verified, not
      assumed).

**Guards**
- [ ] `insertValueSummaryGeneration`'s guard widened **deliberately, in the same
      commit**, observed red first (prior-effort WATCH-6's designed procedure).
- [ ] New single-call-site guard for `markValueUnitSummariesSeen`, red-proven.
- [ ] `upsertValueUnitSummary.run(` call-site count still exactly **1**.
- [ ] `assertSingleHome` `absent` lists updated for both new exports.

**Client**
- [ ] C1–C3 green and red-proven; marker text comes from i18n keys, never
      hardcoded English; acknowledgement is **explicit**, never auto-on-render.
- [ ] All four locales carry the six new keys; `i18n.test.ts` E1.1 green; no
      empty-body `it()`s.
- [ ] Screen-snapshot diffs **reviewed** and then regenerated — never blindly.

**Docs & catalog**
- [ ] `db.js:821-825` and `value-summary.js`'s file header both rewritten **in the
      same diff** (PO AC-7); the replacement comment **enumerates the input set
      and names `unitFacts()`**; the header's "ONE lexical writer" claim narrowed
      to the synthesis columns.
- [ ] The two `PROJECT-CONTEXT.md` catalog notes from `pm-plan.md` §6 DEC-10
      applied **on the effort branch**, verbatim, both marked *count unchanged*.
- [ ] `update-project-docs` run for `docs/API.md`, `docs/DATABASE.md`,
      `server/README.md`, `ARCHITECTURE.md`.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.

**Final**
- [ ] `npm run test:server` and `npm run test:client` fully green in the worktree.
- [ ] Sweeps at zero: `grep -rn "assert.ok(true" server/__tests__/`,
      `grep -rn "|| true" server/__tests__/`, plus the ungreppable checks — no
      zero-assertion bodies, no fixtures that don't construct what their comments
      claim (count them programmatically).
- [ ] Manual Resume walkthrough completed in **real Google Chrome**, including
      the pre-slice-DB boot check; regeneration-burst size observed and written
      into WATCH-B.
- [ ] Any scope declined during the build that is not already OPEN-1..OPEN-4 or
      WATCH-A..WATCH-G has its own row added **before** the build closes.
