# Decision Log — 2026-08-04-altitude-invalidation (Value Pool Slice 1)

**Parent request:** `requests/2026-08-04-value-pool-grouping/request.md` (four-slice
vision; this folder is **Slice 1 only**).
**Run mode:** auto-pilot. PREFERENCE gates are taken by the team and logged
`DECIDED-AUTO`; Sara may reverse any of them without reopening the build.

Conventions (inherited from `intake/2026-08-04-value-summary-tick/decisions.md`,
itself inherited from `intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md`):
**DECIDED-AUTO** = taken by the team, reversible by Sara without reopening the
build; **PENDING (Sara)** = carries a recommendation, does not stop the build
unless the row says it does; **WATCH** = a carried-forward risk with an owner and
a promotion trigger; **DEPENDENCY** = a hard sequencing gate.

Numbering is **folder-local**. `DEC-1..DEC-10` and `WATCH-A..WATCH-E` were opened
by the PM in `pm-plan.md` §6 and are transcribed here in intent so that *this*
file is the single tracked artifact for the build. `DEC-11` onward and `WATCH-F`
onward were opened by the tech lead while writing `technical-plan.md`.
`OPEN-1..OPEN-3` are this folder's open items (two of them carried forward from
the prior effort under new local numbers — the cross-reference is stated in each
row so nothing is lost in renumbering).

**Cross-effort references** below (`DEC-10`/`DEC-11`/`DEC-12`/`DEC-14`/`DEC-16`,
`WATCH-2`/`WATCH-6`/`WATCH-7`/`WATCH-8`, `OPEN-2`/`OPEN-3`/`OPEN-4`) are always
qualified as **"prior effort"** and point at
`intake/2026-08-04-value-summary-tick/decisions.md`. Unqualified ids are local.

---

## PM rows (opened 2026-08-04, `pm-plan.md` §6)

| Id | Subject | Status |
|---|---|---|
| **DEC-1** | Classification: `missed-requirement`, with a `new-feature` carve-out (the seen-state round-trip) | DECIDED-AUTO (PM) |
| **DEC-2** | Storage shape: raw `input_stage` / `input_label`, **no digest column**, field-wise comparison in one shared function | DECIDED-AUTO (PM) — adopts the engineer's correction over the architect's digest design |
| **DEC-3** | Freshness rides as **extra fields on resolved `altitudes` entries**; `ALTITUDE_STATES` gains nothing | DECIDED-AUTO (PM) — architect Option A ratified, Option B rejected on verified `AltitudeText` evidence |
| **DEC-4** | Fork (a) / prior-effort WATCH-6: **request-path generation logging lands now**, with the guard widened deliberately in the same commit | DECIDED-AUTO (PM) — architect A1 |
| **DEC-5** | §9.5 idiom: **PRAGMA `table_info`**, not the try/`SELECT … LIMIT 1`/catch probe | DECIDED-AUTO (PM) — engineer's correction; the brief and the architect both cited the deprecated form |
| **DEC-6** | Fork (b): **`merge_commit` is included as mutable** in Slice 1 | DECIDED-AUTO (PM) — deliberately overrides the request's scope fence; one-string veto path |
| **DEC-7** | Fork (c): the stale-client route race splits into a **required cross-path parity test** + **WATCH-C** | DECIDED-AUTO (PM) |
| **DEC-8** | "Seen" fires on **explicit acknowledgement**, never auto-on-render | DECIDED-AUTO (PM) |
| **DEC-9** | Pre-snapshot rows: **stale-on-first-check, no backfill** | DECIDED-AUTO (PM) — PO AC-3, architect + engineer concur |
| **DEC-10** | The two `PROJECT-CONTEXT.md` catalog notes are applied **on the effort branch**, not on the dirty main checkout | DECIDED-AUTO (PM) — text is verbatim in `pm-plan.md` §6 DEC-10 |

### DEC-1 — Classification

`missed-requirement`, with a `new-feature` carve-out for the seen-state
round-trip (`seen_at`, `markValueUnitSummariesSeen` + its new single-call-site
guard, `POST /api/project-plans/altitudes/seen`, the client marker/acknowledge
interaction, four locales). Triage's provisional `new-feature` is overturned:
`server/db.js:821-825` (origin/master `55fe900`) asserts *"a unit's ground fact …
is immutable once seen, so there is nothing to invalidate: generated once, served
forever"* while `buildPrompt` (`value-summary.js:99-105`) renders `u.stage`, and
`assembleValuePool` (`value-ledger.js:207-223`) stamps `stage: initiative.stage`.
The claim was falsifiable from code thirty lines away on the day it was written —
the requirement was incomplete, not the code broken. Consistent with the sibling
intake `2026-08-04-value-summary-tick`, classified `missed-requirement` on the
identical test (an unevidenced *bound* rather than an unevidenced *invariant*).

**Cost framing:** input-snapshot gating + regeneration + doc/comment corrections
+ their tests = **our cost**. The seen-state round-trip = **new scope, already
approved**, and the first thing to cut if the slice runs long (if cut, it needs
its own PENDING row here — do not cut it into prose). Request-path logging =
**debt coming due**, pre-paid by the prior effort's DEC-14.

### DEC-2 — Storage shape: raw prompt-feeding fields; NO digest column

`value_unit_summaries` gains **`input_stage TEXT`** and **`input_label TEXT`**
(nullable). There is **no `input_digest` column** and **no belt-and-braces
"both"** design — two representations of one truth is §9.1 by construction.
Comparison is field-wise, in one shared function.

1. A sha1 cannot produce the approved wording *"updated — stage changed"*; a hash
   over `(stage, label)` destroys which field moved (engineer G2).
2. The fields **are** the digest — `focus_summaries` hashes a multi-KB segment
   tree; here the input is two short strings. The precedent transfers in **shape**
   (one shared extraction feeding both prompt and comparison), not representation.
3. It makes §9.1 **inapplicable** rather than guarded: with raw fields there is no
   formula for a second site to re-derive, only `a !== b`.
4. §9.5-identical in cost; no CHECK touched, so no §9.6 rebuild.
5. The reason comes for free from the same comparator that gated the read.

**Binding implementation details:**
- Store the **resolved** value the prompt renders (`u.label || u.value_ref ||
  "(untitled)"`), never the raw `label` column.
- Normalize `undefined → null` **inside `unitFacts()`** (`detour` units carry no
  `stage` key at all — `value-ledger.js:259-266`).
- Reason precedence: `stage_changed` > `label_changed` > `initial`. No CHECK on
  the column, so future reasons stay additive.
- Naming across the whole surface is **"input snapshot"**, never "digest" —
  columns, reason vocabulary, the rewritten `db.js` comment, docs.
- QA re-target: A1 becomes comparator stability/sensitivity; A2's structural scan
  targets the comparator **and** `buildPrompt`; **A3's mutation applies
  verbatim** (mutate the stored stage at the write path; D2's zero-spawn
  assertion must catch it); D3/D4 now also pin the two reason strings.

### DEC-3 — Freshness as extra fields on resolved entries; `ALTITUDE_STATES` unchanged

Architect Option B (new `states` strings) is **rejected on verified evidence**:
`AltitudeText` (`PlanLedgerPanel.tsx:321-355`) renders any unrecognized string as
the "unavailable" copy, so a live tab across the upgrade would **lose text it was
already displaying** — the one regression the prior effort's DEC-11 fallback
exists to prevent. Freshness is a second, server-authored, named dimension on the
**resolved** entry, with its own exported registry. The prior effort's DEC-11
partition stays byte-for-byte intact.

**Invariant pinned in tests (architect R3):** *a unit with a cached row is ALWAYS
present in `altitudes`, whatever its freshness.*

**§9.8 enumeration for this slice** — every new distinguishable outcome, named,
no silent absences: `stale_refresh_queued`, `stale_refresh_unavailable`,
`updated_unseen`, `input_label = NULL` (**exactly one meaning: legacy
pre-snapshot row**), `stale_regenerated = NULL` in the log (**predates
measurement** — hence nullable, **no DEFAULT**; `ADD COLUMN … DEFAULT 0` would
stamp history with a false measured zero).

### DEC-4 — Request-path generation logging lands NOW (prior effort's WATCH-6)

With gating in the shared read path, the request path regenerates stale units
whether or not it logs. If it does not log, a view-triggered invalidation
produces **no audit row anywhere** (the tick later sees a cache hit), and the
log's silence would mean two different things — §9.8's shape at the
observability layer, introduced by the change written to cure §9.8. Acceptance
signal 4 would be only tick-complete while reading as complete.

Conditions, all binding:
- Widen `single-writer-guard.test.js`'s `insertValueSummaryGeneration` file set
  **in the same commit**, red-proven by injection (§9.3).
- The route honors the four-term partition using its submitted-batch size as
  `pool_size`.
- Per engineer **G7**, `stale_regenerated` is an **overlap counter, not a fifth
  partition term** — documented at the column (see WATCH-A).

### DEC-5 — §9.5 idiom: PRAGMA `table_info`

The brief asked for the try/`SELECT … LIMIT 1`/catch idiom and the architect
concluded it "applies" because `value_unit_summaries` is not a §9.2-scanned
table. **Both are wrong**: `chronology-ordering.test.js` derives `filesToScan`
from `server/lib/*` + `server/routes/*` **plus `server/db.js`**, with
`FILE_DISPOSITIONS["server/db.js"] = "scanned"` — the scan looks at db.js's SQL
literals, not at which table they hit. §9.5's how-to-comply is unconditional.

Copy the `detour_dispositions.project_id` precedent (`db.js:1017-1026`, whose own
comment states the reason), **not** `plan_items.target_date` (`db.js:1004-1009`).
New columns land in **both** the `CREATE TABLE` body **and** the guarded ALTER,
with `UPGRADE_CASES` entries. **No new `GRANDFATHERED` entries** — the
db-migration meta-test forcing these cases is by design.

### DEC-6 — `merge_commit` included as mutable (overrides the request's scope fence)

Verified: `value-ledger.js:216-223` stamps `stage: initiative.stage` on
`merge_commit` units and `buildPrompt` feeds stage into the prompt. The request's
fence ("content-addressed → correct as-is") rests on **the same unexamined
premise this intake exists to correct** — the SHA is immutable, the *prompt input
set* is not. Shipping a fix for a defect class while leaving a live member of
that class in place, disclosed in advance, is verbatim the shape §9.7 and §9.8
both cite as their own argument for themselves.

**Ruling:** `MUTABLE_VALUE_SOURCES = ["intake_initiative", "detour",
"merge_commit"]`, homed in `value-ledger.js` beside `VALUE_SOURCES` (source
taxonomy, not synthesis logic), with `assertSingleHome`'s `absent` lists in
`single-writer-guard.test.js` updated deliberately. `trunk_commit` stays exempt —
it carries `label` only, sha-derived.

Knock-ons: PO **AC-1 is restated** as "`trunk_commit` units unchanged" (not
"`trunk_commit`/`merge_commit`"); QA's **D1 immutable canary targets
`trunk_commit`**, which the existing fixture already defaults to
(`value-summary.test.js:97-106`) — **zero test churn**. Cost: ~$0.001 extra per
initiative stage transition, and the marker appears on both the initiative and
its merge-commit unit — redundant but honest. Exemption keys on `value_source`,
**never** on "does this unit have a stage" (engineer G1).

**Veto path (Sara):** drop `"merge_commit"` from the array and take the
architect's R7 WATCH row instead. One-line reversal, no redesign.

### DEC-7 — The stale-client route race splits in two

- **Deterministic half — REQUIRED TEST.** If the route and the tick normalize
  `stage`/`label` differently (`""` vs `null`, dropped key), the same unit
  oscillates stale↔fresh between paths and regenerates on *every* alternation —
  silent, unbounded LLM spend no existing test can see (engineer G8). Cure:
  `unitFacts()` is the sole normalizer for **both** paths (structural), **plus**
  an explicit cross-path parity case asserting the route's reconstructed unit and
  the tick's `assembleValuePool` unit produce identical facts.
- **Genuinely racy half — WATCH-C.** Same posture as the prior effort's WATCH-7.
  DEC-4 is what makes this WATCH's trigger observable at all.

### DEC-8 — "Seen" fires on explicit acknowledgement

Auto-on-render means the marker is consumed by the **panel mounting**, so a unit
regenerated while a second device sits on the page — real since LAN hosting
shipped (`23cabdc`), which is the very argument the PO used to put "seen"
server-side — is marked "seen" by a person who never read it. "Seen" would then
mean two things (rendered vs. read): §9.8's shape reproduced at the
acknowledgement layer, inside the slice whose purpose is *"tell the user when
something they saw before has changed."*

Per-unit acknowledge (a "×" on the marker) plus the PO-blessed one-click "dismiss
all updated markers". `seen_at` is reset **inside the single
`upsertValueUnitSummary` writer's `DO UPDATE SET`** (engineer G3), never as a
second UPDATE from a caller.

### DEC-9 — Pre-snapshot rows: stale-on-first-check, no backfill

Backfilling from *current* stage/label would fabricate provenance — asserting a
text was generated from inputs it was not — and would stamp the motivating Resume
row **fresh**, defeating the request's own example. QA's **D5 red proof**
("implement backfill → D5 red") is the executable record of this ruling and must
be written that way. Burst is bounded by existing caps (40/prompt, 3
projects/tick) and self-drains; observe and record its real size once (engineer
G10, and see WATCH-B).

### DEC-10 — Catalog updates are a build-phase task on the effort branch

`PROJECT-CONTEXT.md` is tracked and currently **clean** inside a 44-file dirty
checkout; editing it in the main checkout risks it being swept into a concurrent
session's commit. The two notes are written verbatim in `pm-plan.md` §6 DEC-10
(§9.8 invariant corollary; §9.1 inapplicability note) and are applied **on the
effort branch**, both explicitly marked *count unchanged / not an occurrence*.
This is a DoD line, not a nice-to-have.

---

## Tech-lead rows (appended 2026-08-04 while writing `technical-plan.md`)

### DEC-11 — The log partition counts *work*; the wire partition counts *renderability*. They deliberately disagree for stale-served units.

- **Status:** DECIDED-AUTO (2026-08-04)
- **Question:** DEC-3 puts a stale unit that could not be refreshed this round
  into `altitudes` (serving its old text) with `freshness =
  stale_refresh_queued|stale_refresh_unavailable`. QA **L1** simultaneously
  requires `cache_hits` to count **only input-valid hits** and the four-term
  identity `cache_hits + generated + queued + unavailable === pool_size` to stay
  exact. Both cannot be satisfied by one number unless we say which partition a
  stale-served unit belongs to on each side.
- **Decision:** they are two different partitions over the same units and both
  stay total and disjoint:
  - **Wire** (`enrichPoolAltitudes`'s return): every unit is in **exactly one**
    of `altitudes` / `states`. A stale unit with old text is in `altitudes`
    (prior effort's DEC-11 preserved byte-for-byte; architect R3's invariant).
  - **Log** (`value_summary_generation_log`): every unit is in **exactly one** of
    `cache_hits` / `generated` / `queued` / `unavailable`. A stale unit is a
    **miss**: refreshed → `generated`; deferred past the cap → `queued`; LLM
    down/failed → `unavailable`. It is **never** a `cache_hit`.
- **Why this is a decision and not an accident:** the two partitions disagreeing
  is exactly the kind of thing a later reader "fixes" into agreement, in either
  direction — either by counting stale-served units as `cache_hits` (QA L1's
  named red proof: the sum overshoots `pool_size`) or by dropping them out of
  `altitudes` (architect R3: an old client blanks previously-visible text). Both
  regressions are one line each. The comment at the column and the two named
  tests are the record.
- **Enforced by:** L1 (`cache_hits = 10` exactly on a 10-fresh/5-stale/30-uncached
  fixture), and the wire-side exactly-one-bucket assertion extended with stale
  units in the fixture.

### DEC-12 — Column vocabulary, and which column is the legacy discriminator

- **Status:** DECIDED-AUTO (2026-08-04)
- **Decision:** `value_unit_summaries` gains exactly five nullable columns:
  `input_stage TEXT`, `input_label TEXT`, `regenerated_at TEXT`,
  `regen_reason TEXT`, `seen_at TEXT`. `value_summary_generation_log` gains
  exactly one: `stale_regenerated INTEGER` (nullable, **no DEFAULT**, per DEC-3).
  The architect's `invalidation_reasons TEXT` JSON map is **dropped** — the
  engineer's split resolves the grain mismatch better: **count in the log, reason
  on the row**, and a JSON map would be a second home for a reason the row
  already owns (§9.1).
- **The legacy discriminator is `input_label IS NULL`, not `input_stage IS
  NULL`.** `input_stage` is legitimately NULL on a stamped `detour` row (no
  `stage` key at all — `value-ledger.js:259-266`), so it is an overloaded NULL by
  nature. `unitFacts()` guarantees the label fact is a non-empty string (falls
  back to `"(untitled)"`), so `input_label IS NULL` has **exactly one meaning:
  written before this slice**. Same property for `regen_reason`, which is stamped
  on **every** write (`'initial'` on a first generation) and is therefore NULL
  only on legacy rows.
- **`regenerated_at` is the marker discriminator, not `regen_reason`.** It is
  NULL on a first generation and set only when a *previous* text was replaced.
  The wire marker condition is `regenerated_at IS NOT NULL AND seen_at IS NULL`
  — which is exactly QA **D6**'s "a fresh generation does NOT carry the marker"
  leg, expressed in the schema rather than in a branch.
- **Consequence for the comparator:** no special-casing is needed for legacy
  rows. `input_label = NULL` versus a non-null fact differs field-wise, so a
  legacy mutable row falls out as stale from the ordinary comparison — DEC-9
  implemented as an absence of code rather than as a branch.

### DEC-13 — One `freshness` field with one exported registry (`ALTITUDE_FRESHNESS`)

- **Status:** DECIDED-AUTO (2026-08-04) — reconciles the architect's registry
  names with the field shape the same section proposed
- **Where we're coming from:** the architect's Option A named the registry
  `["stale_refresh_queued","stale_refresh_unavailable","updated_unseen"]` but
  described the wire as two *different* fields (`refresh: "queued"` and
  `updated: {reason, at}`) whose values do not appear in that registry. That is a
  registry that does not describe the wire — a §9.1 dual-view on day one.
- **Decision:** a resolved `altitudes` entry carries **one** optional named
  dimension, `freshness`, whose value is a member of the exported
  `ALTITUDE_FRESHNESS` registry, plus two plain data fields (`update_reason`,
  `regenerated_at`) that the copy needs. `freshness` absent = fresh and
  acknowledged, or an immutable unit = **today's exact rendering**.
- `ALTITUDE_STATES` still gains nothing (DEC-3). `ALTITUDE_FRESHNESS` is a
  **second** registry, exported from `value-summary.js` beside it, and is
  imported (never hand-typed) by the server-side registry-scan test — see
  WATCH-F for the client-side copy.

### DEC-14 — `enrichPoolAltitudes` returns its own `counts`; tick and route never re-derive them

- **Status:** DECIDED-AUTO (2026-08-04)
- **Where we're coming from:** the tick derives the four log terms in its own
  counting loop (`value-summary-tick.js:112-124`). DEC-4 adds a **second** logger
  (the route). Two call sites each deriving the same four-term partition from the
  same return shape is a §9.1 re-derivation — the exact shape the catalog records
  landing twice, and the arithmetic-identity class that produced §9.3 event #1 of
  the prior effort.
- **Decision:** `enrichPoolAltitudes` returns `{ altitudes, states, counts }`,
  where `counts = { pool_size, cache_hits, generated, queued, unavailable,
  stale_regenerated }` is computed **once**, by the only function that knows.
  The tick's counting loop is replaced by reading `counts`; the route passes the
  same object through. Additive third key, so the prior effort's DEC-10/DEC-11
  destructures stay valid.
- **Not touched:** `pending_after_sweep` stays re-derived live from the pool
  (prior effort's WATCH-8 / T-C). `counts` covers only the four log terms plus
  the overlap counter.

### DEC-15 — The `buildPrompt` structural scan permits exactly one mention of the unit: `unitFacts(u)`

- **Status:** DECIDED-AUTO (2026-08-04)
- **Decision:** the scan (QA A2, PM's "one thing never traded away") extracts
  `buildPrompt`'s lexical body from `server/lib/value-summary.js`, strips **both**
  `//` and `/** */` comments (engineer **G6**: the existing scanner strips only
  `//`, and that bit the parent build), and asserts the body contains **no**
  `u.<field>` / `unit.<field>` property access. Passing the whole unit to
  `unitFacts(u)` is not a property access, so the rule is satisfiable — that is
  the point: the only way to get a unit field into the prompt is to add it to
  `unitFacts`, where the comparator will see it too.
- Per §9.3 corollary (a) the scan asserts its own scope is non-empty and contains
  a positive sentinel (`facts.`), so an extraction that silently matches zero
  characters cannot pass vacuously.

---

## WATCH rows

| Id | Risk | Owner | Trigger to promote |
|---|---|---|---|
| **WATCH-A** | `stale_regenerated` is an **overlap counter, not a partition term** (engineer G7). The four-term identity `cache_hits + generated + queued + unavailable === pool_size` has no fifth member; the next test author may "fix" it into a wrong five-term form. See also DEC-11 (the log/wire partitions disagree by design). | this build's implementer, then whoever next touches the log | any proposed change to the partition identity |
| **WATCH-B** | One-time regeneration burst across legacy mutable rows on first check (DEC-9, engineer G10). Bounded by 40/prompt × 3 projects/tick and self-draining; size it once and record it here. | build report | real size exceeds one batch per project, or a sweep visibly stalls |
| **WATCH-C** | **Stale-client route-write convergence race** (architect R4, DEC-7's racy half): `POST /altitudes` trusts client-supplied `stage`/`label` (`project-plans.js:163-170`), so a stale tab can regenerate from old inputs and stamp old inputs; the next tick's fresh `assembleValuePool` re-invalidates and converges, but text can briefly flip backwards and spawns are wasted. Extends the prior effort's WATCH-7 (blessed safe-but-wasteful) to *previously-cached* keys. | whoever reads the generation log | observed text flip-flop, or anomalous duplicate-generation counts — **now visible in the log thanks to DEC-4** |
| **WATCH-D** | `buildPrompt`'s whole-prompt `.slice(0, 12_000)` truncates the **reply-format instruction first** (it lives in the tail) — the uncatalogued SHARED-BUDGET-STARVATION shape. Pre-existing and unchanged by this slice, but this slice increases traffic through it. | next value-summary intake | a parse failure in the generation log, or any unbounded field entering the prompt |
| **WATCH-E** | The client hand-types the altitude state registry in **three** places (`PlanLedgerPanel.tsx:558`, the `Altitude` union at 321, `api.ts`'s `Record<…>` ~2715) — §9.7's accepted CJS/Vite exception. This slice adds **no** `ALTITUDE_STATES` values (DEC-3), so all three stay as they are. | next slice that grows `ALTITUDE_STATES` | any growth of `ALTITUDE_STATES` |
| **WATCH-F** | **DEC-13's `ALTITUDE_FRESHNESS` becomes a fourth hand-copied registry** at the same CJS/Vite boundary: the server export, the `Altitude` object arm's `freshness?:` union in `PlanLedgerPanel.tsx`, the response type in `api.ts`, and the i18n key set. This slice ships all four in the same commit with a server-side registry-import scan, but the client copies remain hand-typed — the catalog's most common must-stay-in-sync defect, now with one more instance. | whoever grows `ALTITUDE_FRESHNESS` | any new freshness value, or a fifth copy appearing anywhere |
| **WATCH-G** | Prior effort's **WATCH-2 / DEC-12** — Settings "clear data" (`server/routes/settings.js:172-189`) omits `value_unit_summaries` and `value_claims`, and now also the two tables this slice widens. **Unchanged by this slice**; the fast-follow still owns it, and is still bound by the all-four-tables precondition. Carried here so renumbering does not lose it. | the Settings fast-follow | unchanged — a user reporting that "clear data" left value text behind |

---

## Open items

### OPEN-1 — A tick-driven regeneration does not reach an open tab until it remounts (carried: prior effort's OPEN-3)

- **Status:** PENDING (Sara) — non-blocking, but it is a **knowing reduction of
  this slice's own headline promise** and must be read before sign-off
- **What is being declined:** `PlanLedgerPanel` still subscribes to no WebSocket
  message for any of its data (prior effort DEC-8/OPEN-3: the tick broadcasts
  `value_altitudes_updated` to nobody). This slice adds the marker but not the
  subscriber. A unit regenerated by the **tick** while a tab sits open therefore
  shows its "updated — stage changed" marker only on the next mount/refetch of
  the panel. A unit regenerated by the **request path** (the user's own page
  view) shows the marker immediately, because that response carries it.
- **Consequence, stated plainly:** the request's vision sentence — *"the UX must
  always tell the user … when something they saw before has changed"* — is met on
  next view, not in place. Acceptance signal 3 ("a visible marker until seen") is
  met; acceptance signal 5's "always" is met with a mount-latency caveat.
- **Why accept it:** adding the subscription is net-new live-update behavior for
  a panel that has none, it is the prior effort's already-tracked fast-follow
  (~20 lines: one `useEffect` + `eventBus.subscribe`, a `project_id` filter, a
  merge into `setAltitudes`), and folding it in here would put a second
  behavioral change into a slice that already carries a schema change, a new
  writer, and a guard widening.
- **Recommendation:** approve the same fast-follow immediately after this lands;
  it now has two reasons to exist instead of one.

### OPEN-2 — Validation project for the parent effort (carried: prior effort's OPEN-2)

- **Status:** PENDING (Sara) — non-blocking
- Does not block this slice: the walkthrough is fixed on the Resume example by
  the request itself (`2026-08-03-job-pipeline-tracker`). Recorded here so it
  does not silently close during renumbering.

### OPEN-3 — `MAX_PROJECTS_PER_TICK` in Sara's real `.env` (carried: prior effort's OPEN-4)

- **Status:** PENDING (Sara) — non-blocking, but **it directly sets how long this
  slice's one-time regeneration burst takes to drain** (WATCH-B)
- Measured at the prior build: `P = 15`, `U = 182` → `ceil(15/3) × 10min ×
  ceil(182/40) = 250 min (~4h10m)` at the shipped defaults, versus `100 min
  (~1h40m)` with `MAX_PROJECTS_PER_TICK=8`. No code change either way — both are
  env vars. Worth answering before this ships.

### OPEN-4 — Marker copy is taken as approved

- **Status:** PENDING (Sara) — non-blocking
- *"updated — stage changed"* / *"updated — label changed"* are taken as Sara's
  approved wording (request text). Any change is a **content change** and gets
  reflected back into `requests/2026-08-04-value-pool-grouping/request.md`, not
  just shipped in the component.

---

## Dependencies

| Id | Gate |
|---|---|
| **DEPENDENCY-1** | **Environment (BLOCKING).** No build code before `pm-plan.md` §5's branch-cut procedure completes: `ps`/`lsof` check for concurrent sessions → fresh worktree from `origin/master` `55fe900`+ → `npm run setup` → live DB backed up → the main checkout's 44 dirty paths untouched. See `technical-plan.md` §4 Step 1. |
| **DEPENDENCY-2** | This file exists **on the effort branch** with DEC-1..DEC-15, WATCH-A..WATCH-G, OPEN-1..OPEN-4 before the first line of build code (the parent effort's cycle-breaker, retained). |
| **DEPENDENCY-3** | `server/db.js` (columns + PRAGMA-guarded ALTERs + `UPGRADE_CASES`) lands before `value-summary.js`; `value-summary.js`'s return shape lands before the tick and the route; the server contract lands before the client. Guards are written **with** each layer, never batched at the end. |

### DEC-16 — Intake complete; proceed to team-qa

- **Status:** DECIDED-AUTO (2026-08-04, auto-pilot, per team-intake's Step 6
  default)
- Intake produced pm-plan.md (missed-requirement, 2nd on this module in two
  days, same comment-nobody-can-fail-on mechanism) and technical-plan.md
  (13 steps, 21 files, the unitFacts() structural cure MANDATORY).
  Proceeding to team-qa on the technical plan, then team-build, on a fresh
  worktree cut from origin/master (55fe900+) per the step-1 environment
  gate.
