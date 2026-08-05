# Architect Assessment — Slice 1: Mutability-aware altitude caching + invalidation

**Intake:** `2026-08-04-altitude-invalidation`
**Date:** 2026-08-04
**Substrate note (verified):** local checkout is at `d830a44`; the tick substrate
is merged at `55fe900` on `origin/master` (fast-forwardable, not diverged).
Every citation below to `value-summary.js`, `value-summary-tick.js`,
`project-plans.js`, `single-writer-guard.test.js`, and the db.js value-table
regions was read via `git show origin/master:<path>` — line numbers are against
the **merged** files, not the local tree. `focus-summary.js` and
`db-migration.test.js` citations are against the local tree (unchanged by
`55fe900` for the cited regions). The local working tree also has live
modifications to ~10 unrelated files — consistent with this repo's known
concurrent-session risk; the effort branch must be cut from `55fe900`+ after
checking for live sessions (brief §9.E).

---

## 1. Affected subsystems & boundaries

| Layer | File | Role in this slice |
|---|---|---|
| Synthesis/cache | `server/lib/value-summary.js` | The one true home of digest compute, digest gating, and the cache write (`enrichPoolAltitudes` is the single lexical writer of `value_unit_summaries` — guard-enforced). All new state semantics originate here. |
| Background sweep | `server/lib/value-summary-tick.js` | Second *invoker* only. Picks up stale regeneration for free through the shared read path; its log write gains the new stale counters. |
| Request fast lane | `server/routes/project-plans.js` `POST /altitudes` (merged lines 141–174) | Third surface: passes client-held units (incl. client-supplied `stage`/`label`) into the same composer. Also the natural home of the new mark-seen endpoint. |
| Schema | `server/db.js` | `value_unit_summaries` (lines 820–833: PK `unit_key`, no digest — its own comment asserts "generated once, served forever" and must be rewritten), `value_summary_generation_log` (lines 1822–1835: `source` CHECK includes an unused `'request'` per DEC-14; `outcome` CHECK `('ok','skipped','error')`; no reason column), `focus_summaries` precedent (line 678). |
| Pool taxonomy | `server/lib/value-ledger.js` | Owns `VALUE_SOURCES` and unit shape; the mutable/immutable source classification belongs beside it (single home). Not otherwise touched — `assembleValuePool` stays the sole composer (DEC-16). |
| UI | `client/src/components/PlanLedgerPanel.tsx` | `Altitude` type + `AltitudeText` (merged lines 308–355) render the states; gains the stale badge and the "updated — stage changed" until-seen marker. |
| Structural guards | `server/__tests__/single-writer-guard.test.js`, `server/__tests__/db-migration.test.js` (`UPGRADE_CASES`) | Both must be extended deliberately (see §4). |

## 2. Current design (verified by direct read of the merged code)

- **Cache contract:** `readCached` (value-summary.js:84–94) is a pure
  key-lookup; any row is a hit forever. The schema comment (db.js:820–825)
  documents this as deliberate: "a unit's ground fact … is immutable once
  seen … generated once, served forever." That premise is now false for
  `intake_initiative`/`detour` units — `buildPrompt` (value-summary.js:99)
  feeds `u.label || u.value_ref` **and** `u.stage` into the prompt, and both
  mutate for those sources. This is the defect the request names (the Resume
  `2026-08-03-job-pipeline-tracker` cached text).
- **State contract (DEC-10/11):** `enrichPoolAltitudes` returns
  `{altitudes, states}` — a strict partition ("never both, never neither"),
  `ALTITUDE_STATES = ["queued","unavailable"]` exported as the only registry
  (value-summary.js:47). The route pre-seeds `states` for invalid submissions
  so nothing drops into neither map.
- **Client fallback (verified, PlanLedgerPanel.tsx:321–355):** the `Altitude`
  union is `{project, stakeholder} | "queued" | "unavailable" | undefined`.
  `AltitudeText` renders any *unrecognized string* as the "unavailable" copy,
  and renders any *object* by reading `altitude[field]`. Two consequences that
  shape this design: (a) extra fields added to a resolved altitude object are
  silently ignored by an old client — graceful; (b) moving a text-bearing unit
  into the `states` map would make an old client replace previously-visible
  text with the "unavailable" placeholder — a live-tab regression. The
  forward-compat fallback covers unknown *state strings* gracefully, but it
  does **not** make "put stale units in `states`" safe, because the cost there
  is lost text, not a wrong placeholder.
- **Precedent to mirror (focus-summary.js):** `summaryFacts()` (line 109) is
  a single shared extraction feeding **both** the prompt and
  `computeInputDigest()` (line 130) — the in-file comment says exactly why:
  "so the digest can never drift from what the prompt actually contains."
  `readCachedSummary` (line 271) gates with
  `if (!cached || cached.input_digest !== digest) return null;` — a mismatch
  is simply a miss. This is the §9.1 cure in its strongest form and transfers
  directly. **What differs:** focus digests a whole window's segment tree
  (large, per-cache-key); here the digest input is tiny and per-unit
  (source + label/ref + stage), and — new here — the stale unit still has
  *servable old text*, which focus never preserves (a focus mismatch just
  regenerates inline every read). The serve-stale-while-refreshing dimension
  is the genuinely new design surface of this slice.
- **PROJECT-CONTEXT alignment:** §9.8's live instance #1 *is* this surface;
  §9.1's cure is the shared-extraction pattern above; §9.5's guarded-ALTER
  idiom has a directly citable precedent at db.js:995–1000
  (`plan_items.target_date`): `try { db.prepare("SELECT <col> FROM <t> LIMIT 1").get(); } catch { db.prepare("ALTER TABLE <t> ADD COLUMN <col> <type>").run(); }`
  — plus the PRAGMA-based variant (db.js:1024–1028) reserved for tables the
  §9.2 chronology scan watches (`value_unit_summaries` is not one; the
  try/SELECT idiom applies). New columns must land in **both** the
  `CREATE TABLE` body and the guarded ALTER, with an `UPGRADE_CASES` entry
  (`server/__tests__/db-migration.test.js:56`).

## 3. Options

### Option A (recommended) — digest in the shared read path; serve-stale-with-named-freshness; server-side seen

- **Digest:** add `unitFacts(unit)` to `value-summary.js` — one extraction
  returning exactly what `buildPrompt` renders per unit (`value_source`,
  `label || value_ref`, `stage`) — and `computeUnitDigest(unit)` = sha1 of
  its JSON. Refactor `buildPrompt` to consume `unitFacts` so prompt and digest
  cannot drift (the focus-summary cure, verbatim in shape).
- **Where checked:** inside `readCached`, for mutable sources only. Both
  invokers (route + tick) get invalidation for free; a stale unit is a miss;
  the regeneration write stays inside the single existing
  `upsertValueUnitSummary.run(...)` call site — **the regeneration itself
  widens no writer guard** (triage assumption D confirmed).
- **Where stamped:** the same single write call, now also writing
  `input_digest` (computed for **all** sources, consulted only for mutable
  ones — so `NULL` has exactly one meaning: "legacy pre-digest row", never
  also "immutable unit"; avoids an overloaded-NULL §9.8 smell).
- **Mutability classification:** one exported constant, e.g.
  `MUTABLE_VALUE_SOURCES = ["intake_initiative","detour"]`, homed in
  `value-ledger.js` next to `VALUE_SOURCES` (it is source taxonomy, not
  synthesis logic). Note: `assertSingleHome`'s explicit `absent` lists in
  `single-writer-guard.test.js` (merged lines 267–300) must be updated
  deliberately for any new export — that is the tripwire working.
- **Wire shape:** keep DEC-11's partition intact. `ALTITUDE_STATES` stays
  `["queued","unavailable"]` for text-less units. Freshness is a **second,
  named, server-authored dimension on the resolved entry**, with its own
  exported registry in value-summary.js (e.g.
  `ALTITUDE_FRESHNESS = ["stale_refresh_queued","stale_refresh_unavailable","updated_unseen"]`):
  - stale + regenerated this round → resolved entry, `cached:false`, plus
    `updated: {reason, at}` (until seen);
  - stale + over cap → resolved entry serving the **old** text, plus
    `refresh: "queued"`;
  - stale + LLM down/failed → old text plus `refresh: "unavailable"`;
  - no row at all → exactly today's `states` behavior, byte-for-byte;
  - immutable sources → today's behavior, byte-for-byte.
  Old clients degrade to "shows the text without the badge" — i.e. exactly
  today's rendering, never worse (the DEC-11 client-fallback promise holds).
- **Pre-digest rows (open question A) — confirm stale-on-first-check,
  architecturally, not just pragmatically:** the digest's semantic is "the
  inputs this cached text was generated from." A backfill from *current*
  stage/label fabricates that provenance — it asserts the text was generated
  from inputs it was not, which is precisely the false record the motivating
  Resume example exposes. Stale-on-first-check is the only semantics-honest
  option. Cost: a one-time regeneration wave across mutable units only,
  already bounded by the existing caps (40/prompt, 3 projects/tick) and
  self-draining through the rotation; commit-keyed units (the bulk of the
  182-unit measured pool) are untouched.
- **"Seen" (open question B) — server-side.** DEC-10's principle (states are
  server-authored, never client-reconstructed) plus the vision sentence ("the
  user is always told when something they saw before has changed" — which a
  per-browser localStorage reset silently violates) both point server-side.
  Columns on `value_unit_summaries`: `updated_at TEXT`, `update_reason TEXT`
  (nullable, no CHECK), `seen_at TEXT`. Regeneration-on-mismatch sets
  `updated_at`/`update_reason` and nulls `seen_at`; a new
  `POST /api/project-plans/altitudes/seen {unit_keys}` marks seen. **This is
  a genuinely new second writer statement on the table** (e.g.
  `markValueUnitSummarySeen`) — it does not trip the existing
  `upsertValueUnitSummary` guard (different statement), so it needs its **own**
  single-call-site guard, red-proven per §9.3, added in the same change.
  The marker copy ("updated — stage changed") derives from `update_reason` —
  server-authored, i18n-keyed client-side.
- **Generation-log reason (open question C) — additive nullable columns, no
  CHECK change, no §9.6 rebuild:** `stale_regenerated INTEGER` (per-run
  count; **nullable, no DEFAULT** — `ADD COLUMN ... DEFAULT 0` would stamp
  historical rows with a false "measured zero"; NULL = predates measurement,
  a deliberate §9.8 micro-decision) and `invalidation_reasons TEXT` (nullable
  JSON map `unit_key → reason` for the run). This satisfies acceptance
  signal 4's letter at the log's existing per-run grain; the *durable*
  per-unit record lives on the summary row itself (`update_reason`,
  `updated_at`), which the UI needs anyway. `outcome`'s CHECK is untouched.
- **Which paths log (the WATCH-6 fork):** two sub-options, both
  architecturally sound — this is the one true PM scope call in this slice:
  - **A1 (recommended):** the request path starts writing its own log row
    with `source='request'` — the enum DEC-14 pre-paid exactly so this would
    be additive, not a rebuild. WATCH-6's guard
    (`insertValueSummaryGeneration` only in db.js + value-summary-tick.js,
    merged test lines 260–265, whose own comment says "WATCH-6 will
    deliberately widen this") is widened to include `project-plans.js` in the
    same change. The route can honor the four-term partition invariant
    (`cache_hits + generated + queued + unavailable === pool_size`) using its
    submitted-batch size as `pool_size`. Without A1, request-path
    invalidations never land in the log and acceptance signal 4 is only
    tick-complete.
  - **A2:** tick-only logging; request-path invalidations recorded only on
    the unit row. Cheaper, but the gap **must** get a `decisions.md`
    PENDING/WATCH row, not prose.

### Option B — new state strings in the `states` map ("stale-regenerating", "updated-unseen" as ALTITUDE_STATES entries)

Reads as the "extend the registry" instruction taken literally: a stale unit
leaves `altitudes` and appears in `states` with a new string. **Rejected.**
(a) It withholds servable old text — the UI shows a placeholder where
yesterday it showed a sentence, strictly worse UX during the refresh window;
(b) verified old-client behavior turns every new state string into the
"unavailable" copy, so a live tab across the upgrade *loses* text it was
already displaying — the one regression DEC-11's fallback was designed to
make impossible; (c) "updated-unseen" cannot live in `states` at all without
breaking the partition, since the unit is resolved. The registry principle
(named, server-authored, single exported home) is preserved in Option A via
the second registry; the one-dimensional map is the wrong carrier, not the
principle.

### Option C — sidecar per-unit invalidation table + client-local "seen"

`value_summary_invalidations(unit_key, reason, old_digest, new_digest, source,
created_at)` at the event's natural grain; `seen` in localStorage. Honest
about grain (the run-log is per-run; invalidation is per-unit) and needs no
ALTER on the CHECK-bearing log table. **Not recommended as a whole:**
client-local seen resets per browser and contradicts DEC-10's server-authored
lean and the vision sentence; the sidecar table fails acceptance signal 4's
letter ("lands in `value_summary_generation_log`"). Its per-unit-audit idea
survives in Option A as columns on the unit row. If the PM later relaxes
signal 4, the sidecar is the cleaner audit home — worth one line in
`decisions.md`, not a build now.

## 4. Architectural risks

| # | Risk | Severity | Containment |
|---|---|---|---|
| R1 | **§9.1 digest drift** — a second site re-deriving the digest formula (write vs check, or prompt vs digest) rots silently; the catalog records this shape landing twice before | HIGH | Single `unitFacts` feeding both `buildPrompt` and `computeUnitDigest`; both live only in value-summary.js; structural test forbids a second hash-over-unit-fields site; red-prove per §9.3 |
| R2 | **§9.5 fresh-DB/legacy-DB divergence** — new columns only in CREATE body (legacy DBs crash) or only in ALTER (fresh DBs drift) | HIGH | Columns in both places + `UPGRADE_CASES` entries (db-migration.test.js:56); idiom precedent db.js:995–1000; try/SELECT form is fine (`value_unit_summaries` is not a §9.2-scanned table) |
| R3 | **Old-client live-tab regression** — any design that moves text-bearing units into `states` blanks previously-visible text (verified AltitudeText behavior) | MEDIUM (fully avoided by Option A) | Invariant to pin in tests: a unit with a cached row is ALWAYS present in `altitudes`, whatever its freshness |
| R4 | **Stale-client route writes** — `POST /altitudes` trusts client-supplied `stage`/`label` (merged route lines 166–170); a stale tab can regenerate from old inputs and stamp the old digest; the next tick (fresh `assembleValuePool`) re-invalidates and converges, but text can briefly flip backwards and spawns are wasted | MEDIUM | Accept-and-watch (same posture as WATCH-7); document convergence-via-tick; trigger to promote: observed text flip-flop or spawn-count anomaly in the log |
| R5 | **Rollout regeneration burst** — every legacy mutable-unit row reads stale on first check | MEDIUM | Bounded by existing caps (40/prompt, 3 projects/tick, 10 min interval); commit units exempt; size against real fleet composition before shipping defaults |
| R6 | **WATCH-7 race frequency changes** — stale units re-open the blessed two-writer race for previously-cached keys on every stage transition | LOW | Upsert verified atomic; frequency is per-stage-change, rare per unit; note on the existing WATCH-7 row |
| R7 | **`merge_commit` stage-staleness exemption** — verified: value-ledger.js (merged lines 217–222) stamps `stage: initiative.stage` on `merge_commit` units, and `buildPrompt` feeds stage into the prompt; the request declares these immutable, so their stage-bearing cached sentences can also go stale. Honoring the request's scope fence leaves this un-gated | LOW severity, but MUST NOT remain prose only | `decisions.md` PENDING/WATCH row this round (see below) |
| R8 | **New writer without a guard** — mark-seen is a second writer statement on `value_unit_summaries`; the existing guard does not cover it, so it can silently sprout call sites | MEDIUM | New single-call-site guard + §9.3 red proof in the same change |
| R9 | **Doc drift** — db.js:820–825 schema comment and value-summary.js's file-header "generated once, served forever" paragraph both assert the pre-slice contract | LOW | Rewrite both in the same diff; `update-project-docs` skill for ARCHITECTURE.md; client snapshot baselines reviewed, not blind-updated |

**§9.8 enumeration — every new absence/state this slice introduces, named:**
1. `stale_refresh_queued` — text present, digest mismatch, refresh not yet attempted (over cap).
2. `stale_refresh_unavailable` — text present, digest mismatch, refresh attempted/impossible and failed.
3. `updated_unseen` — regenerated, `seen_at` NULL with `updated_at` set; cleared by mark-seen.
4. `input_digest = NULL` — exactly one meaning: legacy pre-digest row (stamped on all new writes, consulted only for mutable sources); on mutable sources it is *defined* as stale, never a silent branch.
5. `stale_regenerated = NULL` in the log — predates measurement, distinct from 0 = measured none (hence nullable, no DEFAULT).
6. (Only if A2 chosen) request-path invalidations absent from the log — a disclosed gap requiring its own WATCH row.

## 5. Recommended approach

**Option A, with A1 (request-path logging) preferred and A2 acceptable if the
PM fences scope — either way the fork is decided in `decisions.md`, not left
implicit.** It is the only option that simultaneously: mirrors the
focus-summary digest cure at full strength (one shared extraction, §9.1),
keeps `enrichPoolAltitudes` the single composer and single cache writer with
zero widening for regeneration itself, preserves DEC-11's partition and the
verified old-client fallback (no live-tab regression), satisfies §9.8 with
named server-authored states for every new distinguishable outcome, and lands
all schema work as §9.5 guarded-ALTERs with no CHECK change and therefore no
§9.6 rebuild.

**Required tracked rows (not prose) coming out of this assessment:**
- **WATCH (new):** R7 — `merge_commit` units carry a mutable `stage` in their
  prompt input but are exempt from digest gating by the request's own scope
  fence; trigger to promote: any observed stale merge-commit sentence.
- **WATCH (new):** R4 — stale-client route regeneration converges via tick;
  trigger: text flip-flop or anomalous duplicate-generation counts.
- **If A2:** PENDING row for request-path invalidation logging (the WATCH-6
  widening moment deferred, again).
- **Note on existing DEC-12/WATCH-2:** unchanged by this slice — the cleanup
  route is still untouched, and the all-four-tables precondition still binds
  the fast-follow that touches it.
