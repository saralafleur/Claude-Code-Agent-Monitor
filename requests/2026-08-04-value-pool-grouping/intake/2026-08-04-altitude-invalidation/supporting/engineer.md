# Engineer assessment — Slice 1: mutability-aware altitude cache + invalidation

**Intake:** `2026-08-04-altitude-invalidation`
**Author:** Engineer (code-level investigation pass)
**Date:** 2026-08-04

## Version note (read first — triage finding E confirmed)

Local `master` (`d830a44`) is **2 commits behind** `origin/master` (`55fe900`,
the value-summary-tick merge). Every file this slice touches on the server
side (`server/db.js`, `server/lib/value-summary.js`,
`server/lib/value-summary-tick.js`, `server/lib/value-ledger.js`,
`server/routes/project-plans.js`, all four named test files, plus
`PlanLedgerPanel.tsx`/`api.ts`/`types.ts`) **differs between local HEAD and
`origin/master`** (verified via `git diff --name-only HEAD origin/master`).

**Every line number in this document refers to the `origin/master` (`55fe900`)
version of the file**, read via `git show origin/master:<path>`, except where
explicitly marked "(local)". Two local files are current and safe to cite
directly: `server/lib/focus-summary.js` and
`server/__tests__/db-migration.test.js` (neither is in the merge diff).

**Additional live hazard found during this pass:** the working tree is dirty
with *uncommitted* modifications to `server/db.js`, `server/routes/playbook.js`,
`client/src/lib/types.ts`, etc. — the shape of an in-flight concurrent session
(this repo's known concurrent-session risk, per project memory). The effort
branch must be cut from `55fe900` in a way that does not disturb that tree
(fresh worktree recommended), after checking `ps`/`lsof`.

---

## 1. Exact change set

### 1a. `server/db.js`

All four sub-changes verified against the origin/master file:

1. **Rewrite the schema comment at lines 821–825** — it currently asserts
   "Keyed on the unit's own unitKey, NOT a content digest like
   focus_summaries — … there is nothing to invalidate: generated once, served
   forever." That sentence becomes false for `intake_initiative`/`detour`
   units and must be rewritten (it is the canonical statement of the old
   contract; leaving it is a documentation lie at the exact point of change).

2. **`value_unit_summaries` CREATE body (lines 826–832)** gains new columns,
   AND the same columns ship as guarded ALTERs (§9.5 — the CREATE-body-only
   form is the catalogued defect). Proposed additive, all nullable:
   - `input_digest TEXT` — NULL on immutable units and on legacy rows.
   - `input_stage TEXT`, `input_label TEXT` — **see gotcha G2**: an opaque
     hash alone cannot produce the requested "updated — *stage changed*"
     wording; you need the raw prompt-feeding fields (they are two short
     strings, not the multi-KB blobs `focus_summaries` hashes) either instead
     of or alongside the digest. Storing raw + comparing raw is arguably the
     honest form here; a digest column then becomes optional. Architect call,
     but the schema must be decided before anything downstream.
   - `regenerated_at TEXT`, `regen_reason TEXT` (e.g. `stage_changed`,
     `label_changed`, `initial` — no CHECK, so future reasons are additive),
     `seen_at TEXT` (server-side seen state, DEC-10 lean — see 1d).

3. **Guarded-ALTER idiom — correction to the brief.** The brief asks me to
   cite "the exact §9.5 guarded-ALTER idiom this repo uses repeatedly —
   try/SELECT-probe/catch-ALTER". That idiom exists (origin/master
   `db.js:995–999`, `plan_items.target_date`:
   `try { db.prepare("SELECT target_date FROM plan_items LIMIT 1").get(); } catch { ALTER … }`)
   **but it is the deprecated form.** The catalog's §9.5 how-to-comply and
   `db.js`'s own newer precedent explicitly supersede it: use **PRAGMA
   table_info** (origin/master `db.js:1023–1026`,
   `detour_dispositions.project_id`), whose in-code comment (1017–1022) states
   the reason — the try/SELECT-LIMIT-1 probe adds an un-ordered `LIMIT` query
   that `chronology-ordering.test.js`'s derived-scope SQL scan then has to
   grandfather. Use the PRAGMA form for all new columns on both tables.

4. **`value_summary_generation_log` (lines 1822–1835): reason field.**
   Confirmed: `source` CHECK `('tick','request')` at 1825 and `outcome` CHECK
   `('ok','skipped','error')` at 1826 are **untouched** by an additive column,
   so **no §9.6 rebuild is needed** — `ALTER TABLE … ADD COLUMN
   stale_regenerated INTEGER NOT NULL DEFAULT 0` is legal SQLite (constant
   default) and CHECK-free. The log is per-*run*; a per-unit reason lives on
   `value_unit_summaries.regen_reason` (change 2), which resolves the
   granularity mismatch the brief's open question C names: **count in the
   log, reason on the row**.

5. **Prepared statements (lines 3190–3238):**
   - `getValueUnitSummary` (3192) is `SELECT *` — returns the new columns
     with zero change.
   - `upsertValueUnitSummary` (3193–3201) widens from 4 to ~6–7 params and
     its `DO UPDATE SET` must also set `input_digest`/`input_stage`/
     `input_label`/`regen_reason`/`regenerated_at` **and reset
     `seen_at = NULL`** (gotcha G3). Its single lexical `.run(` call site
     (value-summary.js:230) updates in place — the guard's call-site *count*
     stays 1, so `single-writer-guard.test.js:217–257` stays green as-is; only
     new writer statements (next bullet) need deliberate widening.
   - **New:** `markValueUnitSummariesSeen` —
     `UPDATE value_unit_summaries SET seen_at = strftime(...) WHERE unit_key = ?`
     (run in a loop or `IN` expansion from the route). This is a **second
     production writer to the cache table**, which falsifies value-summary.js's
     header claim ("ONE lexical writer of the stakeholder-altitude cache
     table", lines 32–35) — the claim must be narrowed to "one writer of the
     *synthesis columns*" and a new guard added (WATCH-6 pattern: widen
     deliberately, in the same change, with a §9.3 red proof).
   - `insertValueSummaryGeneration` (3234–3238) gains the
     `stale_regenerated` column/param.

### 1b. `server/lib/value-summary.js` (origin/master, 255 lines)

- **New shared function `computeUnitInputDigest(unit)`** (or, if raw-field
  comparison wins, `unitInputsChanged(row, unit)` returning
  `null | "stage_changed" | "label_changed"`) plus an exported
  `MUTABLE_VALUE_SOURCES = ["intake_initiative", "detour"]` registry. One
  home, imported by write path and check path alike — §9.1's obligation. The
  in-repo statement of the cure is `focus-summary.js:106–107` ("kept as a
  single shared extraction so the digest can never drift from what the prompt
  actually contains"); its digest precedent is `computeInputDigest`
  (focus-summary.js:127–134, sha1-hex) gated in `readCachedSummary`
  (focus-summary.js:271–273: `if (!cached || cached.input_digest !== digest)
  return null;`) — both local-file citations, file unchanged since the merge.
- **`readCached` (lines 81–91)**: signature changes from
  `readCached(dbModule, unitKey)` to `readCached(dbModule, unit)` (it needs
  `value_source`, `stage`, `label`). For a `MUTABLE_VALUE_SOURCES` unit whose
  stored inputs mismatch (including `NULL` stored inputs — legacy rows), it
  returns `null`. **A stale hit then literally becomes a miss**: it falls into
  the `misses` array in `enrichPoolAltitudes` (lines 187–194) and flows through
  the existing dedupe (203) → LLM-availability gate (205) → cap slice
  (212–214) → batch spawn (217) → partition bookkeeping (241–243) **entirely
  untouched**. This is the core of the slice and it is genuinely small
  (~15–25 lines in this file), *if* the stale-over-cap UX question (gotcha G4)
  is resolved as "plain miss".
- **Cached-hit return shape** (81–91) gains `updated`/`regen_reason`/
  `regenerated_at`/`seen` fields read off the row, and the write branch
  (228–238) sets them for fresh generations — this is how the client gets its
  until-seen marker with server-authored state (DEC-10).
- **Write site (line 230)**: passes the new params; the reason is computed by
  the same shared comparator that gated the read (never a second derivation —
  §9.1's twice-proven "rogue re-derivation" lesson).
- **`ALTITUDE_STATES` (line 47)**: in the plain-miss design, a stale in-cap
  unit regenerates the same round (lands in `altitudes`, `cached:false`,
  marker fields set) and a stale over-cap unit is `queued` — so
  `ALTITUDE_STATES` **can** gain nothing, with the two new §9.8 states
  (`stale-pending` via a flag on a served-stale entry, or `regenerated-unseen`
  via `updated`+`seen:false`) living as named fields on `altitudes` entries
  rather than `states` values. If the architect instead wants stale text
  *withheld*, `ALTITUDE_STATES` gains `"stale"` (or `"stale_queued"`), and the
  DEC-11 "never both, never neither" partition still holds. Either way the
  choice must be explicit — see gotchas G4/G5.

### 1c. `server/lib/value-summary-tick.js`

**Near-zero, but not zero.** The shared read path gives the tick stale
detection for free (a stale unit is a miss; the sweep regenerates it and
counts it inside `generated`). The only required edits:
- the counting loop (lines 112–124) additionally counts stale-regenerated
  units off the extended return shape;
- the `insertValueSummaryGeneration.run(` call (158–169) passes the new
  `stale_regenerated` value.
No scheduler, rotation, overlap-guard, or broadcast changes. (Optionally the
`value_altitudes_updated` broadcast payload at 170–176 could carry
`stale_unit_keys` — additive, backward-compatible per the WebSocket rule.)

### 1d. What feeds the digest — verified, no new plumbing needed

`assembleValuePool` (origin/master `server/lib/value-ledger.js`) already puts
the prompt-feeding fields on every unit object:
- `intake_initiative`: `label: initiative.slug`, `stage: initiative.stage`
  (lines 207–214);
- `detour`: `label: row.label || null`, **no `stage` key at all**
  (lines 259–266) — the comparator must normalize `undefined → null`;
- `merge_commit` *also* carries `stage` (line 222) but is exempt (immutable
  key), and `trunk_commit` carries `label` only (245). Exemption must key on
  `value_source`, not on "does the unit have a stage".

The route (`server/routes/project-plans.js:141–173`) already sanitizes and
forwards `label`/`stage` (lines 163–169), and the tick passes raw
`assembleValuePool` units (value-summary-tick.js:109–111). **No new data
plumbing anywhere.** One caveat: the *client-initiated* route path receives
units from `api.ts`, which maps the client `ValueUnit` — confirmed
`api.projectPlans.altitudes` (api.ts ~2683–2716) posts `label`/`stage` through
today, so the request path's digest inputs equal the tick's (worth one parity
assertion, since a request-path unit with a dropped `stage` would
digest-differently from the tick's and cause flip-flop regeneration).

### 1e. Route: `server/routes/project-plans.js`

- `POST /altitudes` (141–173): no logic change; response entries carry the new
  marker fields automatically.
- **New endpoint** `POST /api/project-plans/altitudes/seen`
  `{project_id, unit_keys: string[]}` → `markValueUnitSummariesSeen`, returns
  `{updated: n}`. Small, but it is the new-writer surface (see 1a bullet 5 and
  gotcha G6).
- **Request-path logging decision (open question D, engineer's read):** with
  digest gating in the shared read path, the request path regenerates stale
  units whether we like it or not; if it never logs, a stale unit regenerated
  by a page view produces **no audit row anywhere** (the tick later sees a
  cache hit), so acceptance signal 4 is only reliably met if the route also
  writes a generation-log row when it regenerates. `source='request'` was
  pre-paid for exactly this (DEC-14; schema comment at db.js:1808–1811), and
  the guard at `single-writer-guard.test.js:259–265` carries a comment saying
  it will be "deliberately widened … when request-path logging lands." I
  recommend doing it in this slice; it is ~10 route lines plus the deliberate
  guard widening.

### 1f. Client

- **`client/src/lib/types.ts`**: the altitude entry type (declared inline in
  `api.ts` ~2705–2715) and/or `ValueUnit` docs gain
  `updated_at?/update_reason?/seen?`; new request/response types for the seen
  endpoint.
- **`client/src/lib/api.ts`**: widen the `altitudes` response type; add
  `api.projectPlans.markAltitudesSeen(projectId, unitKeys)`.
- **`client/src/components/PlanLedgerPanel.tsx`**: the local `Altitude` union
  (line 321) becomes an object carrying the marker; `AltitudeText` (331–355)
  or `PoolUnitRow` (357–430) renders the "updated — stage changed" badge;
  the load/effect block (542–588) or a per-badge dismiss fires
  `markAltitudesSeen`. **When "seen" fires is an open UX micro-decision**
  (auto-on-render vs. explicit dismiss); auto-on-render is the cheapest and
  matches "until seen" literally, but fires on every viewer — fine for a
  single-user local dashboard.
- **i18n**: new keys in `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`
  (the existing altitude placeholder keys live there — all four locales, and
  the i18n completeness tests derive key sets from `en`, so a missing locale
  key fails loudly).

### 1g. Docs (update-project-docs skill, mandatory per CLAUDE.md)

`docs/API.md` (new endpoint + widened response), `docs/DATABASE.md` (new
columns on both tables), `server/README.md`, `ARCHITECTURE.md` — all four were
touched by the parent effort and describe the generate-once contract.

---

## 2. Feasibility

**The core is as simple as it looks; the periphery is where the work is.**
The digest gate itself reuses the miss machinery with zero structural change
(verified by reading the actual miss path, 1b above). What is *not* trivial:

- The "stage changed" **wording** requirement forces the raw-fields-vs-hash
  schema decision (gotcha G2) before anything else can be built.
- The **seen** round-trip is a genuinely new small feature (schema + statement
  + endpoint + client call + guard widening), not a flag.
- Variant branches that each need explicit handling: 4 `value_source` kinds
  (2 gated, 2 exempt), `stage` present/absent/undefined-vs-null, legacy NULL
  rows on mutable vs immutable units, and the two invokers (route + tick) ×
  the logging decision.
- No hidden coupling found beyond the documented single-writer guards: the
  cache table is read/written nowhere else
  (`single-writer-guard.test.js:217–221` enforces db.js + value-summary.js
  only, re-verified by grep), and MCP/ccam have no altitude surface.

## 3. Effort estimate

**Overall: M.** Per piece:

| Piece | Size | Reasoning |
|---|---|---|
| `db.js` schema + statements + migration | S | Pure precedent-following (PRAGMA-guarded ALTERs, UPGRADE_CASES) |
| `value-summary.js` digest gate + return shape | S–M | ~40–60 lines, but it is the §9.1/§9.8-critical surface |
| `value-summary-tick.js` | S | ~10 lines (count + log param) |
| Route: seen endpoint + request logging | S | ~40 lines incl. validation |
| Client (types, api, panel, i18n ×4) | M | Marker UX + seen round-trip + snapshot churn |
| Tests + guard widenings + red proofs | M | The largest single chunk — see §6; this project's history says the guards are where builds fail |

## 4. Dependencies & order

1. **`db.js` first** — columns, guarded ALTERs, widened/new statements, plus
   the two `UPGRADE_CASES` entries in the same commit (downstream code cannot
   run against an un-migrated dev DB; §9.5's whole point, and `DB_PATH` is the
   user-global shared file, so keep everything additive/nullable).
2. `value-summary.js` — shared comparator + `MUTABLE_VALUE_SOURCES`, gated
   `readCached`, widened upsert call, extended return shape.
3. `value-summary-tick.js` — count + log param (depends on 2's return shape).
4. Route — seen endpoint; request-path generation logging + deliberate
   `single-writer-guard` widening in the same commit.
5. Client — types → api → panel → i18n → snapshot regeneration.
6. Guards/tests are written *with* each layer, red-proven per §9.3's standing
   rule (not batched at the end).

## 5. Gotchas

- **G1 — NULL must read stale, not fresh (triage stance A).** The natural
  implementation (`row.input_digest !== computeUnitInputDigest(unit)`) gets
  this right because `NULL !== <hash>`; the failure mode to guard against is
  someone "optimizing" with `if (!row.input_digest) return cached` (skip
  gating on legacy rows) — that stamps the motivating Resume-example row
  fresh forever. Conversely, immutable units must be exempted by
  `value_source`, **not** by "digest is NULL", or every legacy commit unit
  regenerates too. Write the four-cell truth table (mutable/immutable ×
  NULL/mismatch) as explicit test cases.
- **G2 — a hash cannot say "stage changed".** The requested marker text names
  *which* field changed; sha1(stage+label) destroys that. Store the raw
  fields (or two per-field digests). This is a schema-shaping decision that
  must precede the db.js commit.
- **G3 — reset `seen_at` inside the regeneration upsert.** If the upsert's
  `DO UPDATE SET` doesn't null `seen_at`, a unit regenerated a second time
  renders as already-seen. And the reset must happen in the *one* writer
  (`upsertValueUnitSummary`), never as a second UPDATE from the caller.
- **G4 — §9.8 OVERLOADED-ABSENCE, the named trap for this exact surface.**
  A stale unit that misses the cap must not render as the silent-absence
  failure mode. Today's route/tick would report it `queued` — but the client
  *had* text for it last visit; a bare "queued" placeholder where text used to
  be *is* the silent-absence smell in new clothes. Decide explicitly:
  serve-stale-with-flag (my lean: `altitudes` entry + `stale: true`, keeps
  DEC-11 partition intact since the unit is in exactly one map) or a new
  `states` value. Either is defensible; undecided-by-default is the defect.
- **G5 — the client hand-types the state registry.** `PlanLedgerPanel.tsx:558`
  checks `!["queued", "unavailable"].includes(state)` — a hand-typed sibling
  of `ALTITUDE_STATES` (CJS/Vite boundary, same accepted exception as
  `TrunkDriftResult["skipped"]`, §9.7). If `ALTITUDE_STATES` grows, this list,
  the `Altitude` union (line 321), and `api.ts`'s
  `Record<string, "queued" | "unavailable">` (~2715) must all move in the same
  commit — three hand-copies of one registry, the catalog's most common
  must-stay-in-sync defect.
- **G6 — deliberate guard widenings, each with a §9.3 red proof.** Three
  guards go red by design: `insertValueSummaryGeneration` file list
  (single-writer-guard.test.js:259–265) if the route logs;
  the value-summary.js header's "ONE lexical writer" claim once
  `markValueUnitSummariesSeen` exists (needs its own new guard);
  and any change that adds a second `upsertValueUnitSummary.run(` call site
  fails the count-1 assertion at line 235. Also: that scan strips only `//`
  comments (224–232), **not** `/** */` blocks — a JSDoc containing the literal
  `upsertValueUnitSummary.run(` counts as a call site (this bit the parent
  build; catalog §9.3 2026-08-04 note).
- **G7 — the four-term partition is unconditional.** `db.js:1812–1814` and
  the tick tests pin `cache_hits + generated + queued + unavailable ===
  pool_size` with no fifth term. Stale regenerations are a *subset of
  `generated`* (and stale-served-flagged units, if that design wins, a subset
  of `cache_hits`); `stale_regenerated` is an overlap counter, not a partition
  member. Document that at the column, or the next test author "fixes" the
  partition into a five-term form that is wrong (this exact class of
  arithmetic-identity error is §9.3 event #1 from the parent effort's QA).
- **G8 — request/tick digest parity.** The route rebuilds units from client
  JSON (project-plans.js:163–169), the tick from `assembleValuePool` directly.
  If either path normalizes `stage`/`label` differently (`"" `vs `null`,
  dropped key), the same unit oscillates stale↔fresh between paths and
  regenerates on every alternation — a silent LLM-cost bug the suite won't
  see without an explicit cross-path parity case. This also changes WATCH-7's
  blessed two-writer race profile: stale units are now re-writable on both
  paths concurrently (last-write-wins on a single-row upsert — safe, but
  wasteful, and worth a stated decision row).
- **G9 — environment.** Fast-forward/worktree from `55fe900` before any edit;
  do not touch the dirty working tree (concurrent session); every new/edited
  source file needs the repo's file header
  (`bash .claude/skills/file-headers/scripts/check-headers.sh`).
- **G10 — one-time regeneration burst (open question A's cost).** Legacy
  mutable rows all read stale on first check. Bounded to
  intake/detour units only and to 40/request + 3 projects/tick, so it
  self-drains; but the first sweep after upgrade will burn one LLM batch per
  project with mutable units. Worth stating in the build report, not worth
  engineering around.

## 6. Verification hooks (existing specs that would catch a mistake)

All confirmed present in the origin/master tree by reading the actual files:

- `server/__tests__/value-summary.test.js` —
  "generates once, then serves the cache with zero further spawns" (line 202;
  fixture defaults to `value_source: "trunk_commit"`, lines 97–106) is the
  **immutable-path regression canary**: it goes red if digest gating
  accidentally invalidates commit units. The DEC-11 truth table (Cases 1–6,
  lines 351–484) catches any partition breakage from the new states/fields;
  Case 6 catches hand-typed state strings. New digest cases (G1 truth table,
  single-unit-regenerates, G8 parity) are added here.
- `server/__tests__/value-summary-tick.test.js` — the AC-1 drain pair
  (lines 230–295: 45 units across 2 ticks with exact
  `pending_after_sweep` numbers) and the AC-2 audit-log flow proof (753+)
  catch wrong stale counting or a broken partition; the T-C 85→88 case (498+)
  guards the re-derivation rule the stale flow now also exercises.
- `server/__tests__/single-writer-guard.test.js` (lines 217–289) — all three
  widenings of G6 land here, each red-proven by injection.
- `server/__tests__/db-migration.test.js` — the **§9.5 precedent to copy** is
  the `detour_dispositions.project_id` `UPGRADE_CASES` entry (local lines
  130–160: `table`/`column`/`legacySql` seeding the pre-column shape/
  `assertLegacyRow` NULL read/`assertWritable`); two new entries
  (`value_unit_summaries.input_digest` et al.,
  `value_summary_generation_log.stale_regenerated`), and the legacy-row
  assertion doubles as the codified G1 stance (legacy NULL ⇒ stale for
  mutable).
- `server/__tests__/chronology-ordering.test.js` — derived file scope
  auto-covers any new SQL; using the PRAGMA idiom keeps it quiet by
  construction.
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` — the
  queued/unavailable distinguishability cases (lines 451–495) and the T-E
  out-of-registry warning case (497+) are exactly where
  "stale must not render as silent absence" gets its named assertions; new
  cases: marker renders until seen, `markAltitudesSeen` called once, marker
  gone after seen.
- `client/src/pages/__tests__/screens.snapshot.test.tsx` — PlanLedgerPanel is
  inside the Project Detail screen snapshot (line 531, local); the marker is
  an intentional UI change ⇒ review the diff and regenerate with
  `cd client && npx vitest run -u`, never blind-update (CLAUDE.md policy).
- Runners: `npm run test:server`, `npm run test:client`.
