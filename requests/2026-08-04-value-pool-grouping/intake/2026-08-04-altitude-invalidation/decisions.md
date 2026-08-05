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

### Amendment to WATCH-C (2026-08-04, `team-qa` pass — see DEC-18 / QA-DEC-2)

> **WATCH-C's convergence claim is now verified, not merely asserted.** The row's
> text asserted a *deterministic* property nothing tested — "the next tick's fresh
> `assembleValuePool` re-invalidates and **converges**". `E7` pins it end to end
> (route regenerates from stale client inputs → the tick re-invalidates from fresh
> assembler inputs → **a third tick on unchanged inputs quiesces at
> `generated = 0`**, INV-10). **What remains watched is only the timing half** — a
> stale tab's POST interleaving with an in-flight tick, which is genuinely
> untestable cheaply and which DEC-4's request-path log row makes observable in
> production. Trigger unchanged: observed text flip-flop, or anomalous
> duplicate-generation counts in the log.

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
- **Two copy consequences the QA pass surfaced.** (1) On the **first** post-upgrade
  view, DEC-9's legacy burst arms an "updated — label changed" marker on **every**
  legacy mutable unit (~182 at the measured pool size, draining ~1h40m–4h10m per
  OPEN-3) for texts that mostly did not meaningfully change; this is accepted as
  one-time noise with "dismiss all" as the mitigation (DEC-21), and the mitigation
  is tested at burst scale rather than assumed — **NOTE (build-time, 2026-08-05,
  see this build's decisions.md DEC-B7 / SF-1): "dismiss all" was NOT built in
  this build; DEC-21's accepted-risk condition is currently unmet as shipped.**
  (2) A **seventh** string is now in scope — `updatedGeneric` (en: *"updated"*),
  the fallback rendered when a future server sends a `regen_reason` this client
  has no key for (DEC-26). Both are content changes if Sara wants different
  wording, and both reflect back into `requests/2026-08-04-value-pool-grouping/request.md`.

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

### DEC-17 — `/altitudes/seen` uses a compare-and-set stamp (QA-DEC-1, amends Step 2.5)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead, auto-pilot) — reversible by
  Sara without reopening the build
- **Decision:** `markValueUnitSummariesSeen` becomes
  `UPDATE value_unit_summaries SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE unit_key = ? AND regenerated_at IS ?`
  (`IS ?` so the first-generation NULL leg matches; `= ?` would silently stamp
  nothing). The endpoint payload becomes
  `{ project_id: string, units: [{ unit_key: string, regenerated_at: string|null }] }`
  → `{ updated: n }`, where `n` is the summed `.changes` and therefore honestly
  reports a stamp that missed.
- **Why:** `risk.md` **T-D**. The planned unconditional stamp loses a marker in a
  real same-process interleaving (user views G1 → the tick regenerates to G2,
  arming a new marker → the user's in-flight `/seen` POST lands and clears it), so
  G2's "updated" state is **never shown** — a silent failure of the slice's
  headline promise, which `OPEN-1` has already reduced once knowingly. `SEEN-4`
  pins the *other* direction (regeneration re-arms via `seen_at = NULL` inside the
  one writer's `DO UPDATE SET`) and is kept; the two halves must not be conflated.
- **Ripple (all planned, none built yet):** `server/routes/project-plans.js`
  (validation + statement), `client/src/lib/types.ts`, `client/src/lib/api.ts`
  (`markAltitudesSeen(projectId, units)`), `client/src/components/PlanLedgerPanel.tsx`
  (both the per-unit "×" and dismiss-all already hold `regenerated_at`), and the
  `SEEN-*` / `E3` / `E5` / `C2` cases. Still idempotent, still one statement, still
  one lexical call site (guard **W-3** unaffected).
- **Pinned by:** `SEEN-6` (deterministic, no timing), red-proven twice — drop the
  predicate → the stale stamp silently eats the marker; `IS ?` → `= ?` → a
  first-generation marker becomes undismissible.
- **Veto path (Sara):** delete the predicate and the `regenerated_at` field, delete
  `SEEN-6`, and open a WATCH row naming the un-shown-marker race.

### DEC-18 — The deterministic half of WATCH-C's convergence claim is tested (QA-DEC-2)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** add `E7` — seed a cached row at snapshot B → `POST /altitudes` at
  stage A (the stale-tab shape, deterministically) → assert regeneration stamped A
  plus a `source='request'` log row → run the tick with the pool at stage B →
  assert regeneration stamped B with the marker present → **run the tick again,
  inputs unchanged → `generated = 0`, `cache_hits = pool_size`, zero broadcasts**
  (INV-10).
- **Why:** `risk.md` **T-H**. `WATCH-C`'s own text asserts a *deterministic*
  property nothing tested ("the next tick's fresh `assembleValuePool` re-invalidates
  and **converges**"). If the two paths normalize asymmetrically they ping-pong the
  same unit forever — silent, unbounded LLM spend with a green suite throughout.
  `E6` covers tick→route only.
- **Red proof:** make the route's coercion asymmetric with the assembler's
  (`stage ?? ""`) → `E7`'s third step goes red.
- **See also:** the `WATCH-C` amendment below.

### DEC-19 — The `openapi-extra` fragment for `/altitudes/seen` is declined this slice (QA-DEC-3)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** no OpenAPI fragment and no `npm run openapi:yaml` in this slice's
  docs step. `docs/API.md` documents the endpoint (with DEC-17's payload and
  DEC-20's advisory `project_id`) instead.
- **Consequence, stated plainly:** `openapi.yaml` — the artifact this repo declares
  the source of truth for request/response contracts — will omit the new endpoint
  **and** the widened altitude entry schema, and `openapi-contract.test.js` will
  **stay green over the omission**, because its scan derives scope from
  `app.use("/api/…")` **mounts** and `/api/project-plans` is already mounted and
  documented. A brand-new route *under an existing mount* is structurally invisible
  to it — §9.7's shape inside CONTRACT-SPEC-DRIFT's own cure.
- **Therefore binding on this build:** the CONTRACT-SPEC-DRIFT scope-limit note in
  `qa/qa-assessment.md` §"Catalog notes" (written there as *optional, if the build
  declines*) is **required**, applied verbatim on the effort branch at the catalog
  step. The candidate's count stays unchanged — this is a pre-flag, not an
  occurrence (neither promotion trigger is met).
- **Veto path (Sara):** one fragment + one `npm run openapi:yaml` run; the catalog
  line stays useful either way.

### DEC-20 — `project_id` on `/altitudes/seen` is advisory (QA-DEC-4)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** `project_id` is validated for **shape** (non-empty string; 400
  otherwise) and used for nothing at the statement layer, which scopes by
  `unit_key` alone. Documented as advisory in `docs/API.md`.
- **Why:** `risk.md` **T-K**. `unit_key` embeds the cwd
  (`intake_initiative::<ref>::<cwd>`), so cross-project collision is not reachable
  in practice on a local-first single-user dashboard; real enforcement would mean
  resolving the project path and validating every key's trailing segment.
- **Pinned by:** `SEEN-7`, titled **BY DESIGN** and carrying the reason in its body
  — the hazard here is not the missing scope, it is a later half-fix that makes
  dismissal fail **invisibly** for legitimate keys. If real scoping is ever wanted,
  the documented contract changes first.

### DEC-21 — The first-upgrade marker flood is accepted as one-time noise (QA-DEC-5)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** no suppression. DEC-9's legacy burst arms a marker on every legacy
  mutable row (~182-unit pool, draining ~1h40m–4h10m per `OPEN-3`), so Sara's first
  post-upgrade panel view is a wall of "updated — label changed" markers for texts
  that mostly did not meaningfully change. "Dismiss all" is the mitigation.
- **Why not suppress:** the alternative (suppress when the *previous* snapshot was
  legacy-NULL) makes the marker mean two things and adds a branch to the one
  writer — §9.8's shape inside the writer this slice is keeping single-purpose —
  and it weakens D5/D6's symmetry.
- **What the accept requires:** the mitigation is **tested, not assumed** —
  `C2(c)` asserts 60 unseen units are batched into **one** `markAltitudesSeen` call
  carrying exactly the unseen key set.
- **Also:** one sentence added to `OPEN-4` so Sara meets this in writing before she
  meets it on screen.

### DEC-22 — TEST-AGAINST-LIVE-DB: third decline, recorded, with a compensating control (QA-DEC-6)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead) — the decline
  `technical-plan.md` §7 already binds; this is that row
- **Decision:** the class-level cure is **not** promoted in this slice. A
  runner-level "fail if `DASHBOARD_DB_PATH` is unset" check is *structurally wrong
  here*: specs legitimately set the variable **inside** the block before requiring
  `../db`, which is exactly why a per-file grep is a proven-invalid sweep; a
  process-start check would fail correct specs. The right cure is a refusal inside
  `db.js` when running under test — a product change to the boot path, which does
  not belong in a slice already carrying DDL, a new writer, a guard widening and
  three P0 amendments. It deserves its own small intake.
- **Compensating control adopted now:** `db.js` exports `DB_PATH` (`db.js:118`,
  `module.exports` at `3214`), so **every server spec this build touches or creates
  asserts `require("../db").DB_PATH === <its temp path>`** — a positive, in-process
  control a grep can never be.
- **Consequence of deferring:** a future spec that requires `../db` without setting
  the path still migrates Sara's live user-global DB, and nothing fails loudly.
  Promotion triggers unchanged: (a) a second test file found doing it, or (b) it
  actually fires. This is the **third** recorded decline; the catalog already
  records the first two.

### DEC-23 — DEC-4's log arithmetic: the request-path partition gets ONE owner (QA-DEC-7, amends DEC-4)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead) — **amends DEC-4**, which
  otherwise stands
- **The defect being fixed (verified at `origin/master:server/routes/project-plans.js:148-171`):**
  the composer is called with `clean` — the sanitized subset — so `counts` sums to
  `clean.length`, while DEC-4 logs `pool_size = units.length`. A unit with an
  unrecognised `value_source` is diverted to a **route-level** `states` map the
  composer never sees, and a key-less unit is dropped entirely, so the **first
  malformed or old-client request breaks the four-term identity** the whole slice
  treats as inviolable. This is §9.8's own build-phase prediction ("the two failures
  landed at the route and the table — the seams the composer's partition test
  cannot see") arriving at the route seam one effort later, downstream of the very
  sanitizing loop that was S3's fix.
- **Decision:** rather than fixing the arithmetic at the route, remove the second
  derivation. `enrichPoolAltitudes(dbModule, units, opts)` accepts
  `opts.droppedCount` (default `0`) and folds it **inside the one place counts are
  computed**: `counts.pool_size = units.length + droppedCount` and
  `counts.unavailable = <composer unavailable> + droppedCount` (route-dropped =
  attempted-and-unusable, mirroring the S3 wire fix). The route passes
  `droppedCount: units.length - clean.length` at its single composer call site and
  logs `counts` **verbatim**, `pool_size` included; it never computes a partition
  term. The tick passes nothing, so every existing tick number is unchanged. The
  wire (`altitudes`/`states`) is untouched.
- **Effect:** `pool_size` is still the submitted batch size (malformed traffic stays
  visible in the log), the four terms still sum to it **by construction rather than
  by arithmetic care**, and DEC-14's "computed once by the composer for both
  loggers" becomes true at the route too. Inapplicability over compliance.
- **Pinned by:** `ROUTE-SEAM-1` (N good + 1 bogus `value_source` + 1 key-less → one
  log row, `pool_size === units.length === counts.pool_size`, four terms sum
  exactly, every **keyed** unit bucketed once on the wire) and `COUNTS-DROPPED`.
- **Carried warning:** `qa/supporting/unit-tests.md` §2.5's route-logging assertion
  (`pool_size === units.length` with unadjusted `counts`) **asserts the defect** — a
  plan-level vacuous fixture, §9.3's sub-pattern. It is corrected in `test-plan.md`
  and must not be carried forward; grep the shipped diff before closing. And per
  §9.3's event #1 one effort ago on this same identity: **if this guard goes red on
  day one, fix the product, never weaken the guard.**

### DEC-24 — DEC-15 resolves to its TITLE: the strong scan form is plan-of-record (QA-DEC-8, amends DEC-15)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead) — **amends DEC-15**'s body
  and `technical-plan.md` Step 5 / §6 A2
- **The contradiction:** DEC-15's *title* says the scan "permits exactly one mention
  of the unit: `unitFacts(u)`"; its *body* specifies only "no `u.<field>` /
  `unit.<field>` property access". A faithful implementer builds the body's version,
  which is evaded by bracket access, destructuring, aliasing, spread-copy (which
  even satisfies the planned `facts.` sentinel) and parameter renaming — five of the
  seven evasions in `risk.md`'s table.
- **Decision — the title wins, in its strongest form.** The scan: strips **both**
  comment styles (block first, then line); extracts `buildPrompt`'s lexical body;
  **derives both identifiers from source, never hand-typed** (§9.7, evasion #7) —
  the per-unit identifier from the units `.map(` callback's first parameter, the
  array identifier from `buildPrompt`'s signature; and asserts nine things,
  including **exactly one mention of the per-unit identifier inside the callback
  body**, that mention being the argument of `unitFacts(...)`. Eight mutations, each
  observed red **individually**, plus a comment green-proof as the over-breadth
  control. Full mechanics in `qa/test-plan.md` §Layer 1 → `A2`.
- **New evasion class found while reconciling the two QA documents (#9):**
  `units[0].stage` — indexing `buildPrompt`'s **array** parameter directly. It
  matches **none** of the designed regexes (in the string `units[`, `\b(u|unit)` is
  followed by `s`, not by `.` or `[`). Closed by assertion (i): the array parameter
  is mentioned exactly once, immediately followed by `.map(`. Mutation `M-A2-7`.
- **Evasion #8** (a helper one frame away in the same file reading `u.stage`) is
  structurally out of a lexical body scan's reach. Its disposition — naming the
  comparator-single-home scan, the DEC-7 parity cases and INV-10's steady state as
  the backstops — **must be written into the scan's own comment**, or it becomes
  §9.1's "one call frame away" recurrence with a green tick over it.
- **No veto path.** This is the slice's one never-traded-away item; the weak form
  ships the cure evadable.

### DEC-25 — Step 2.4 is replaced by `addColumnsIfMissing`, and the migration meta-test learns to see it (QA-DEC-9)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead) — **replaces
  `technical-plan.md` Step 2.4**; `DEC-5` stands (the PRAGMA idiom is still the
  right probe)
- **The defect being fixed (`risk.md` T-E, Critical):** Step 2.4 is one `db.exec` of
  five sequential `ALTER`s behind a **single** probe on `input_label` — the *second*
  column added — with no transaction and no try/catch. `db.exec` on a
  multi-statement string is sequential, not atomic. A death between statements 1 and
  2 (SQLITE_BUSY against the live WAL DB a long-running dev server holds, OOM,
  `kill -9`, a Ctrl-C on a slow first boot) leaves `input_stage` present and
  `input_label` absent; the probe then says "missing", the block re-runs, and
  `ADD COLUMN input_stage` throws `duplicate column name` **out of `require()`** —
  bricking Express, MCP, the desktop app and the VS Code extension simultaneously
  against the one shared user-global DB (§9.6's B3 blast radius, reached with no
  rebuild anywhere). Probing the *first* column instead only swaps it for the silent
  failure: block skipped forever, four columns permanently missing. **Neither planned
  test can see either outcome** — M1's clean-run legs pass under both orderings and
  e2e B1 boots on a *complete* legacy DB.
- **Decision:** build the durable cure now — `addColumnsIfMissing({ table, columns })`
  in `server/db.js`, mirroring `rebuildTableAtomically` (`db.js:1640`): probes
  `PRAGMA table_info` **per column** (convergent under any interleaving), applies
  only the missing ones inside **one** `BEGIN…COMMIT`, and **catches, rolls back,
  logs and continues** so it can never throw out of `require()` (§9.6's "atomicity
  is necessary and not sufficient — the caller is `require()`"). This slice is its
  **first call site**, for both blocks (six columns, two tables — the largest such
  block in the file). The **five** pre-existing hand-rolled blocks at `55fe900`
  (`agents.workflow_run_id`+`workflow_phase` ~1003-1008 — ALTERs inside a `catch`,
  so a throw on the second escapes; `model_pricing.fast_*` ~1059-1067;
  `color_thresholds` rate columns, six, ~1466-1476; `color_thresholds`' legacy
  split, six, ~1503-1515; `context_snapshots.input_tokens`/`cache_read_tokens`/
  `cache_write_tokens` ~1959-1971) are **grandfathered with dated reasons rather
  than the scan weakened** — the exact `REBUILD_CASES` precedent.
- **The interaction that makes the meta-test extension non-optional:**
  `db-migration.test.js:1414-1451` derives its obligation by regex-scanning `db.js`
  for `ALTER TABLE (\w+) ADD COLUMN (\w+)` and **skips templated columns**. Routing
  the DDL through a helper that builds `ALTER TABLE ${table} ADD COLUMN ${name}
  ${type}` makes all six columns **invisible to that scan** — the six
  `UPGRADE_CASES` entries would stop being mechanically forced the moment the cure
  lands, and every future helper call site would inherit the hole. So the cure ships
  with two new scans: **`HELPER-CASE-SCAN`** (every `table.column` passed to the
  helper needs its own `UPGRADE_CASES` entry — **six**, not two, per
  `db-migration.test.js:1414-1451`'s per-column derivation) and
  **`ALTER-BLOCK-SCAN`** (no multi-statement ALTER block outside the helper; the
  five pre-existing sites in an **exact-set** grandfather registry with dated
  reasons — an orphan entry fails too).
- **Proof is an INTERRUPTION case at two grains**, not the clean-run idempotence
  case every existing migration test writes: `M1-INT` (module grain — seed legacy
  **plus `input_stage` only**, `require`, assert no throw / all five present /
  pre-existing data survived / second run a no-op) and `B4` (whole-app boot grain,
  new spec `server/__tests__/value-summary-interrupted-boot.test.js`, because §9.6's
  claim is about `require()`'s blast radius across the **whole module graph**). Each
  red-proven under **both** failure orderings, both outputs recorded.
- **Veto path (Sara):** the point fix (probe per column at this site only, plus
  catch-log-continue) clears T-E for this slice — but the five shipped sites stay
  latent and the next author has to remember, which is how §9.6's non-atomic
  population came to exist. Do not take it silently.

### DEC-26 — A seventh i18n key: `updatedGeneric` (QA-DEC-10)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** the client's `update_reason → i18n key` map gains a `default` arm
  pointing at a new key `planLedger.pool.altitudes.updatedGeneric` (en: *"updated"*),
  added in **all four** locales. The slice's key count moves **6 → 7**.
- **Why:** `risk.md` **T-C leg 3** — the one leg neither test architect claimed.
  `regen_reason` deliberately has **no CHECK** (DEC-12: "future reasons stay
  additive"), so a future server will send a reason today's client has no key for,
  and a naive `t(mapReason(reason))` renders the literal
  `planLedger.pool.altitudes.updatedSomethingChanged` to the user — an unresolved
  boundary token at the UI, against the change brief's own named invariant.
- **Pinned by:** `C3(d)` (generic copy renders; `document.body.textContent` matches
  no `/planLedger\.[a-zA-Z]/`), `C-registry` (the `default` arm exists), and the
  extended server-side registry→locale test. `i18n.test.ts` E1.1 derives ko/vi/zh
  parity from `en` mechanically.
- **Knock-on:** `OPEN-4`'s copy list grows by one string — Sara's approval of the
  marker wording now covers a fallback too.</new_string>

