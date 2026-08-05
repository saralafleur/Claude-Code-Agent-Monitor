# Unit / Parity Test Design — 2026-08-04-altitude-invalidation (Slice 1)

> Authored by the Unit/Parity Test Architect pass. Designs the fast,
> deterministic layer for the technical plan's ~25 named cases (A1–A3, D1–D6,
> L1–L3, M1/M2, C1–C3, DEC-7 parity, R3, widened Case 5/6, guards). The
> implementer writes these from this document without re-deriving anything.
> All line anchors are against `origin/master` @ `55fe900` (read via
> `git show origin/master:<path>` — never the dirty local tree).
>
> **§9.3 discipline is the frame for every test here.** This exact surface
> produced eight vacuity events in the sibling build. The ONLY accepted red
> proof technique: **apply the named product mutation (or revert the product
> change), run the actual shipped spec file, watch the named assertion go
> red, revert, confirm byte-identical (`git diff --stat` empty), rerun
> green.** No self-reported reds. Every test below names its mutation
> per-test.

Frameworks (per CLAUDE.md / discovered from build config):
- **Server:** `node:test` + `node:assert/strict`, seams
  `__injectSpawnForTest` (focus-inference) and `__injectPoolAssemblerForTest`
  (value-summary-tick). Every spec block that `require`s `../db` sets
  `DASHBOARD_DB_PATH` to a temp path **in that block** (TEST-AGAINST-LIVE-DB;
  a per-file grep is a proven-invalid sweep).
- **Client:** vitest + @testing-library/react, `vi.mock("../../lib/api")`,
  real `en` locale strings asserted (existing convention: "Queued" /
  "Not available" literals).

---

## 1. `server/__tests__/single-writer-guard.test.js` — structural guards

### 1.1 A2 — the `buildPrompt` structural scan (MANDATORY, DEC-15 — the durable cure)

New `it` inside the existing `describe("Single-writer structural guard (§9.1 DERIVED-DUAL-VIEW)")`:

**`it("buildPrompt reads no unit field outside unitFacts(u) — DEC-15 structural scan")`**

**Scan mechanics — spelled out exactly (the existing scanner at ~226-232
strips only `//`; that bit the parent build — G6):**

1. Read `server/lib/value-summary.js` raw.
2. **Strip block comments first**: `source.replace(/\/\*[\s\S]*?\*\//g, "")`
   (covers `/** */` JSDoc — the parent-build bite). Then strip `//` line
   comments with the file's existing per-line `indexOf("//")` approach.
   Order matters: block-strip before line-strip so a `//` inside a JSDoc
   cannot truncate a code line.
3. **Extract `buildPrompt`'s lexical body** with the same brace-walker the
   file already uses for `applyDisposition` / `enrichPoolAltitudes` (match
   `function\s+buildPrompt\s*\(`, walk depth to the closing brace).
4. **Do NOT strip template-literal interiors.** `buildPrompt`'s per-unit line
   is built inside template literals; `${u.stage}` inside a template is a
   property access and MUST stay visible to the scan. (The static prompt copy
   contains no `u.` / `unit.` sequences — the `\b` word boundary below keeps
   words like "menu." from matching since their `u` is preceded by a word
   character.)
5. **Assertions on the stripped body** (each is its own `assert` with a
   message naming the evasion class):
   - **(a) scope non-empty + positive sentinel** (§9.3 corollary a):
     `assert.ok(body.length > 200)` and `assert.match(body, /\bfacts\./)` —
     proves the extraction grabbed the real body and stripping did not nuke
     code. If `buildPrompt` is renamed, the extraction assert (`assert.ok`
     on the regex match) goes red — the scan cannot silently match nothing.
   - **(b) no dot access:** zero matches of `/\b(u|unit)\s*\.\s*[A-Za-z_$]/g`.
   - **(c) no bracket access:** zero matches of `/\b(u|unit)\s*\[/g`.
   - **(d) no destructuring assignment:** zero matches of
     `/\{[^}]*\}\s*=\s*(u|unit)\b/g` (catches `const { stage } = u`).
   - **(e) no destructured callback params:** zero matches of `/\(\s*\{/g`
     inside the body (catches `.map(({ stage, label }, i) => …)`). If a
     legitimate object-literal argument ever appears in `buildPrompt`, the
     correct response is to restructure the code, not relax the scan.
   - **(f) no aliasing:** zero matches of
     `/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(u|unit)\s*[;,)\n]/g`
     (catches `const v = u; v.stage` — (b) alone cannot chase the alias, so
     the alias-creating assignment itself is banned).
   - **(g) the permitted form is present:** `assert.match(body, /unitFacts\s*\(\s*(u|unit)\s*\)/)`
     — passing the whole unit to `unitFacts` is the one allowed read.

**Mutation set — one per evasion class, each run against the shipped spec
(record the red output per mutation in the build report):**

| # | Product mutation in `value-summary.js` | Assertion that must go red |
|---|---|---|
| M-A2-1 | add `const extra = u.value_ref;` in the map callback (the plan's canonical injection) | (b) |
| M-A2-2 | add `${u.stage}` inside an **existing template literal** in the body | (b) — proves template interiors are scanned, not stripped |
| M-A2-3 | change the map callback to `.map(({ stage }, i) =>` and use `stage` | (e) |
| M-A2-4 | add `const { label } = u;` as a statement | (d) |
| M-A2-5 | add `const v = u;` then `v.stage` | (f) — note (b) alone stays green here; that is why (f) exists |
| M-A2-6 | add `u["stage"]` | (c) |

**Green-proof (over-breadth control, equally required):** add a JSDoc block
inside/above `buildPrompt` containing the literal text `u.value_ref reads`
and a `// u.stage` line comment → the scan must **stay green** (comments
stripped in both styles). If it goes red the stripper is wrong. Then remove,
byte-identical check.

**Red-first note:** at `55fe900`, `buildPrompt` (value-summary.js:99-105)
reads `u.stage`, `u.label || u.value_ref`, `u.value_source` directly — this
test written against the unmodified substrate is red on assertions (b) and
(g) **before Step 5's refactor and green after**, so it also serves as its
own before/after proof. Write it first, watch it fail on the real disease.

### 1.2 A2 companion — comparator single-home scan

**`it("input_stage/input_label are read only by db.js and value-summary.js")`**
— `scanFiles(serverDir, /input_stage|input_label/)`, filter `.test.js`,
`assert.deepEqual(basenames.sort(), ["db.js", "value-summary.js"])`.
db.js = DDL + statements; value-summary.js = the comparator. Nothing else —
not the tick, not the route.
**Red proof:** add `row.input_stage` to a line in `value-summary-tick.js` →
red; revert.

### 1.3 The two single-writer guards — OPPOSITE expectations, sequenced

**Guard W-1 (existing, ~235): `upsertValueUnitSummary.run(` stays at exactly 1, inside `enrichPoolAltitudes`. UNCHANGED expectation — do not widen, ever.**
Regeneration flows through the one existing writer; if this goes red during
the build, the design was violated (fix the product, never the guard).
- **Scanner upgrade in the same diff:** this guard's stripper (~226-232)
  strips only `//`. The slice rewrites value-summary.js's file header; a JSDoc
  containing the literal `upsertValueUnitSummary.run(` would count as a call
  site (bit the parent build). Upgrade this guard to the same
  strip-both-comment-styles helper as §1.1 (extract a shared local
  `stripComments(source)` in the spec file). Expectation unchanged.
- **Re-red-proof (required — `readCached` changes around this guard, so the
  existing red proof is stale):** inject a rogue
  `dbModule.stmts.upsertValueUnitSummary.run(…)` into the new `readCached`
  body (the plausible bug: "stamp the snapshot on read") → count assertion
  red (`2 !== 1`); revert, byte-identical, green. Also verify the
  inside-`enrichPoolAltitudes` leg still locates the call after the Step 6/7
  refactor moves code.

**Guard W-2 (existing, ~259-265): `insertValueSummaryGeneration` file set — DELIBERATE red → widen. Sequence exactly:**
1. **Before** Step 9 touches the route: run the unmodified guard → green with
   `["db.js", "value-summary-tick.js"]`.
2. Implement request-path logging in `server/routes/project-plans.js`. Run
   the **unmodified** guard → **observe the red**
   (`deepEqual` fails: actual `["db.js", "project-plans.js", "value-summary-tick.js"]`).
   Record the actual assertion output in the build report. This is
   prior-effort WATCH-6's pre-announced moment — a designed red, not a defect.
3. **In the same commit**, widen the expected set to **exactly**
   `["db.js", "project-plans.js", "value-summary-tick.js"]` (sorted
   basenames, still `assert.deepEqual` — never a `.includes`/superset form).
   Replace the "WATCH-6 will deliberately widen" comment with a DEC-4 note.
4. **Post-widen red proof** (the widened guard needs its own fresh red —
   VACUOUS-REPAIR rule): inject a rogue
   `insertValueSummaryGeneration.run(…)` into `server/lib/workflow-ingest.js`
   → red (proves exact-set, not at-least). Revert.

**Guard W-3 (new): `markValueUnitSummariesSeen` — a genuine second production writer to `value_unit_summaries`.**
**`it("markValueUnitSummariesSeen appears only in db.js and project-plans.js, with one lexical call site in the seen handler")`**
- File scan: `assert.deepEqual(basenames.sort(), ["db.js", "project-plans.js"])`.
- Lexical count: exactly one `markValueUnitSummariesSeen.run(` call site in
  `routes/project-plans.js` (comment-stripped), and it is inside the
  `/altitudes/seen` handler body (brace-walk from the
  `router.post("/altitudes/seen"` match). Looping per key inside one
  transaction is still one lexical site.
- **Red proofs (both):** (i) inject a rogue
  `dbModule.stmts.markValueUnitSummariesSeen.run(unit.unitKey)` into
  `enrichPoolAltitudes` after the upsert (the realistic bug: auto-mark-seen
  on regeneration, which would defeat DEC-8 *and* the whole marker) → file
  scan red; (ii) add a second `.run(` in the route → count red.
- Same diff: value-summary.js header's "ONE lexical writer" claim narrowed
  to "one writer of the synthesis columns" (checked by eyeball in review,
  not by test).

**Guard W-4: `assertSingleHome` absent lists** — add explicit dispositions
for the new exports: `MUTABLE_VALUE_SOURCES` (shared: value-summary.js from
value-ledger; absent at the tick and route), `ALTITUDE_FRESHNESS`,
`unitFacts`, `compareUnitInputs` (absent at both consumers — the route and
tick consume only `enrichPoolAltitudes`'s return). The tripwire going red
when Step 4 adds the export **is it working** — update in the same commit.
**Red proof:** temporarily import `ALTITUDE_FRESHNESS` into
`value-summary-tick.js` → red.

---

## 2. `server/__tests__/value-summary.test.js` — comparator, lifecycle, wire shape

New describe blocks in the existing spec (reuse the file's `unit()`,
`fakeSpawn`, `envelope`, `deferredSpawn`, HTTP `post` helpers and the
existing `beforeEach` DB wipe — extend the wipe with
`DELETE FROM value_summary_generation_log` since the route now writes it).
Fixture convention: mutable units are
`unit({ unitKey: "intake_initiative::<slug>::/repo", value_source: "intake_initiative", label: "<slug>", stage: "built" })`.

### 2.1 `describe("unitFacts / compareUnitInputs (A1)")` — pure truth table

Requires `unitFacts` and `compareUnitInputs` exported (add both to
module.exports; W-4 disposes them at consumers).

**`unitFacts` cases:**
- U1: `{label: "x", value_ref: "r", stage: "built"}` → `{value_source, label: "x", stage: "built"}`.
- U2: label null, value_ref "abc123" → `label === "abc123"` (fallback).
- U3: label null, value_ref "" → `label === "(untitled)"`.
- U4: **no `stage` key at all** (detour shape, value-ledger.js:257-266) →
  `stage === null`; and `assert.deepEqual(unitFacts(noKey), unitFacts({...same, stage: null}))`
  — undefined→null normalized here and nowhere else.

**`compareUnitInputs(row, unit)` truth table — one `it` per row or a
table-driven loop with per-row messages:**

| # | row.input_stage | row.input_label | unit stage | unit label (resolved) | expect |
|---|---|---|---|---|---|
| T1 | "built" | "tracker" | "built" | "tracker" | `null` (stable) |
| T2 | "built" | "tracker" | "shipped" | "tracker" | `"stage_changed"` |
| T3 | "built" | "tracker" | "built" | "tracker-v2" | `"label_changed"` |
| T4 | "built" | "tracker" | "shipped" | "tracker-v2" | `"stage_changed"` (precedence: stage > label) |
| T5 | NULL | "tracker" | "built" | "tracker" | `"stage_changed"` (NULL→value) |
| T6 | "built" | "tracker" | *(no stage key)* | "tracker" | `"stage_changed"` (value→NULL) |
| T7 | NULL | "tracker" | *(no stage key — detour)* | "tracker" | `null` — **a detour whose stage is legitimately NULL is FRESH** (DEC-12: `input_stage IS NULL` has two meanings; `input_label IS NULL` has one) |
| T8 | NULL | NULL *(legacy row)* | *(no stage key)* | "tracker" | `"label_changed"` — legacy falls out stale via the label leg **with no special case in the code** |
| T9 | NULL | NULL *(legacy row)* | "built" | "tracker" | `"stage_changed"` (legacy + stage present: precedence gives stage) |
| T10 | "" | "tracker" | *(stage null)* | "tracker" | `"stage_changed"` — `""` and `null` are distinct values; normalization happens in `unitFacts`, never in the comparator |
| T11 | NULL | "abc123" | *(no stage)* | label null, value_ref "abc123" | `null` — the row stores the **resolved** label (DEC-2); a `null → value_ref-fallback` label is NOT a change |

**Red proofs (A1):** (i) make `compareUnitInputs` skip the label leg → T3/T8
red while T2 green — pins both fields separately; (ii) swap precedence →
T4 red; (iii) at the **write** site store raw `unit.label` instead of
`facts.label` → T11's behavioral twin in D2 red (see A3). T7's red proof:
treat `input_stage IS NULL` as the legacy discriminator (the wrong
DEC-12 reading) → T7 red — this is the assertion that makes a legacy row
distinguishable from a legitimately-NULL-stage detour.

### 2.2 `describe("enrichPoolAltitudes input-snapshot gating (D1–D6)")`

Seeding convention: **cached rows are seeded through the production write
path** (call `enrichPoolAltitudes` with a `fakeSpawn` envelope) so
`input_stage`/`input_label`/`regen_reason='initial'` are stamped by the one
real writer. Only D5/D5b legacy rows are raw-SQL inserts (that IS the
historical artifact being modeled). After seeding, always install the
throwing spawn stub (`__injectSpawnForTest(() => { throw new Error("no LLM
call expected") })`) for cache-hit legs — the suite's existing instrument.

- **D1 — immutable never regenerates (two legs).**
  (a) trunk_commit unit seeded via production path; re-call with `label`
  mutated → served `cached: true`, zero spawns, **and the wire entry has no
  `freshness` key at all** (`assert.ok(!("freshness" in entry))` — absent,
  not null: old-client compat, DEC-3).
  (b) NULL-snapshot leg: `UPDATE value_unit_summaries SET input_stage=NULL,
  input_label=NULL WHERE unit_key=?` on the trunk row; re-call → still
  `cached: true`. *Red proof:* drop the
  `MUTABLE_VALUE_SOURCES.includes(unit.value_source)` gate in `readCached`
  (compare every source) → leg (b) red (NULL label ≠ resolved label →
  spurious regeneration → the throwing stub fires).
- **D2 — mutable + unchanged → cache hit, zero spawns.** intake_initiative
  unit, stage "built"; seed; identical second call → `cached: true`,
  throwing stub proves zero spawns; row's `regen_reason` still `'initial'`,
  `regenerated_at` still NULL. *Red proof = A3 (the write/check divergence,
  verbatim from the plan):* make the write path stamp `facts.stage + "x"` as
  `input_stage` → every unit permanently stale → D2's throwing stub fires →
  red. **If D2 stays green under A3, D2 is vacuous — fix D2, then fresh
  red proof.**
- **D3 — stage change regenerates exactly that unit.** Fixture: 3 mutable
  cached + 1 trunk cached. Change one mutable unit's `stage`
  "built"→"shipped". Spawn spy captures the prompt (the existing
  "batches multiple misses into exactly one spawn" pattern). Assert:
  exactly 1 spawn; captured prompt **contains the stale unit's label and
  does NOT contain any of the other three labels**; other three entries
  `cached: true`; DB row: `input_stage='shipped'`,
  `regen_reason='stage_changed'`, `regenerated_at` NOT NULL, `seen_at` NULL.
  *Red proof:* `if (false)` the mismatch branch in `readCached` → zero
  spawns → red.
- **D4 — label change, same shape.** `regen_reason='label_changed'`.
  *Red proof:* comparator compares stage only → **D4 red while D3 stays
  green** (run both, record both outcomes — the pair is the proof).
- **D5 — `resumeJobPipelineTracker` legacy fixture (named in the spec).**
  Raw insert:
  `INSERT INTO value_unit_summaries (unit_key, project_level, stakeholder_level, model) VALUES ('intake_initiative::2026-08-03-job-pipeline-tracker::/repo', 'Job pipeline tracker build', 'The job pipeline tracker is built and being tested', 'haiku')`
  (snapshot columns left NULL — the legacy shape). Call with the unit's
  *current* facts (`stage: "built"`, `label: "2026-08-03-job-pipeline-tracker"`).
  Assert: 1 spawn, text replaced, `input_stage='built'`,
  `input_label` stamped, reason `'stage_changed'` (NULL vs "built" on the
  stage leg). **The point:** it regenerates **even though** the current
  facts are exactly what a backfill would have stamped. *Red proof (the
  executable record of DEC-9):* implement backfill (stamp NULL rows with
  current facts at migration, or `if (row.input_label == null) return
  {cached: row, staleReason: null}` in `readCached`) → D5 red. **Anti-vacuous
  fixture guard inside the test:** before the call, assert the row exists
  with `input_label === null` AND
  `assert.ok(MUTABLE_VALUE_SOURCES.includes(u.value_source))` — proves the
  fixture reaches the comparison rather than short-circuiting (PLAN-LEVEL
  VACUOUS FIXTURE, §9.3 2026-08-03).
- **D5b — detour-with-NULL-stage is NOT legacy (DEC-12's NULL matrix,
  behavioral twin of T7).** Detour unit (no `stage` key) seeded via
  production path → row has `input_stage NULL`, `input_label` non-NULL.
  Identical second call → `cached: true`, zero spawns. *Red proof:* same
  mutation as T7's (legacy-discriminate on `input_stage`) → D5b red — a
  detour would regenerate on **every** read: the silent-unbounded-spend bug.
- **D6 — marker lifecycle (three legs, red-proven in both directions).**
  (a) After a D3-style regeneration, the wire entry carries
  `freshness: "updated_unseen"`, `update_reason: "stage_changed"`,
  `regenerated_at` set.
  (b) Acknowledge (POST `/altitudes/seen`, §2.5) → next composer call: no
  `freshness` on that entry.
  (c) A **first** generation (never cached) carries **no** freshness
  (`regenerated_at` NULL is the discriminator).
  *Red proofs:* skip stamping `regenerated_at` on regeneration → (a) red;
  stamp it on every generation → (c) red. Both runs recorded.

### 2.3 `describe("DEC-7 cross-path parity")` — route unit vs tick unit

- **P1 (structural):** `assert.deepEqual` of `unitFacts()` over the three
  shapes of the same underlying unit: (i) the assembler shape (detour, **no
  stage key**, `label: null`, `value_ref: "r"`), (ii) the route-sanitized
  shape (`stage: null, label: null` — project-plans.js:163-170's exact
  coercions), (iii) an explicit-null shape. All three identical.
- **P2 (behavioral, end-to-end through the real route):** seed the cache by
  calling `enrichPoolAltitudes` directly with the assembler-shaped unit
  (tick path). Then `post("/api/project-plans/altitudes", …)` with the JSON
  a client sends for the same unit (`stage` omitted). Assert `cached: true`
  in the response and zero spawns (throwing stub). A normalization
  difference (`""` vs `null` vs missing) makes this regenerate → red. This
  is the test that catches the stale↔fresh oscillation (engineer G8) that
  burns LLM spend on every alternation.
  *Red proof:* change the route's coercion to
  `typeof u.stage === "string" ? u.stage : ""` → P2 red.

### 2.4 `describe("wire shape: freshness, R3, partition (Case 5/6 widened), counts")`

- **R3 invariant:** fixture: 1 stale-cached mutable unit placed **beyond the
  cap** (40 uncached units first, the stale unit last → sliced into
  overflow). Assert the stale unit is in `altitudes` with its **old text**
  and `freshness: "stale_refresh_queued"`, and **absent from `states`**.
  "A unit with a cached row is ALWAYS in `altitudes`, whatever its
  freshness." *Red proof:* drop the re-homing step → unit lands in `states`
  as `"queued"` → red. (That one-line regression is exactly what would blank
  an old client's visible text.)
- **Case 5 widened (partition exact with stale units in the fixture):**
  45 submitted = 10 fresh-cached + 5 stale-cached + 30 uncached, LLM on,
  spawn resolves the full in-cap batch. Assert: `altKeys ∩ stateKeys = ∅`;
  `altKeys.size + stateKeys.size === 45`; every unit that has a cached row
  is in `altitudes`. *Red proof:* resurrect the historical S6 bug — add a
  reconciling loop that marks a stale dup `unavailable` without clearing
  `queued` → red.
- **Case 6 extended:** `ALTITUDE_FRESHNESS` imported from
  `../lib/value-summary`, `assert.deepEqual(ALTITUDE_FRESHNESS,
  ["stale_refresh_queued", "stale_refresh_unavailable", "updated_unseen"])`;
  every `freshness` value appearing in any fixture response is asserted
  `ALTITUDE_FRESHNESS.includes(f)` via the import, never a hand-typed list.
  `ALTITUDE_STATES` still exactly `["queued", "unavailable"]` (DEC-3 — gains
  nothing).
- **Combination cases (one test each — a suite with one test per branch
  passes while the ordering bug ships):**
  (i) stale × over-cap → old text + `stale_refresh_queued` (same fixture as
  R3, asserted alongside the counts);
  (ii) stale × LLM-down (`DASHBOARD_FOCUS_INFER_MODE=heuristic`) → old text +
  `stale_refresh_unavailable`, and `counts.unavailable` includes it.
- **`counts` shape (DEC-14 + WATCH-A structural pin):**
  `assert.deepEqual(Object.keys(counts).sort(), ["cache_hits", "generated",
  "pool_size", "queued", "stale_regenerated", "unavailable"])` — a fifth
  partition term cannot be added silently; and the identity
  `cache_hits + generated + queued + unavailable === pool_size` asserted
  **without** `stale_regenerated` in the sum.
- **DEC-11 anti-"fix" test (the log and wire disagree BY DESIGN — one
  fixture, both assertions, pinned AS CORRECT):**
  `it("a stale-served unit is in altitudes on the wire AND a miss in counts — DEC-11, do not 'fix' either direction")`.
  Fixture: 1 stale-cached unit, LLM OFF. Assert **in the same test**:
  `res.altitudes[k].stakeholder === <old text>` (wire: served, R3) AND
  `counts.cache_hits === 0` AND `counts.unavailable === 1` (log: a miss).
  Comment in the test body verbatim: *"the wire serves this unit's old text
  while the log counts it a miss — this disagreement is DEC-11, by design;
  counting it a cache_hit overshoots pool_size (L1), dropping it from
  altitudes blanks an old client (R3). Any test asserting log/wire agreement
  on stale units is asserting a bug."* *Red proofs (both one-liners):*
  count stale-served into `cache_hits` → the `cache_hits === 0` leg red;
  drop it from `altitudes` → the wire leg red.

### 2.5 `describe("POST /api/project-plans/altitudes/seen")` + acknowledge semantics

- **SEEN-1 happy path:** seed a regenerated row (D6(a) state). POST
  `{project_id, unit_keys: [k]}` → 200 `{updated: 1}`; DB `seen_at` non-NULL;
  next composer call: no `freshness` on the entry.
- **SEEN-2 idempotent:** second identical POST → 200 `{updated: 1}`, no
  error (unconditional SET by construction); still no freshness.
- **SEEN-3 validation:** missing `project_id` / missing `unit_keys` /
  non-array / empty array / non-string member / over-bound length (pin the
  bound the implementation chooses, e.g. 500) → 400 with structured
  `{error: {code: "INVALID_INPUT", …}}` per backend-node rules.
- **SEEN-4 — regeneration re-arms the marker (the pinned stamp-race
  semantics, per plan G3):** acknowledge (seen_at set) → mutate the unit's
  stage → composer call regenerates → assert `seen_at IS NULL` again and
  the wire shows `updated_unseen` again. **The reset lives inside
  `upsertValueUnitSummary`'s `DO UPDATE SET seen_at = NULL` — the one
  writer — never a caller's second UPDATE** (that second UPDATE would trip
  guard W-1). *Red proof:* remove `seen_at = NULL` from the `DO UPDATE SET`
  → SEEN-4 red (a second change would render as already-seen). This is the
  test the risk analyst's stamp-race evaluation coordinates with: the
  design's answer is "seen_at cleared on regeneration so a new change
  re-shows the marker," and SEEN-4 pins exactly that.
- **SEEN-5 — acknowledge survives non-regenerating reads:** after
  acknowledge, a plain cache-hit composer call does **not** clear `seen_at`
  (guards against clearing on read); direct `getValueUnitSummary` SELECT
  confirms round-trip persistence. *Red proof:* clear `seen_at` in
  `readCached` → red.
- **Route logging (DEC-4):** extend the existing route describes — after any
  `POST /altitudes`, exactly one new `value_summary_generation_log` row with
  `source='request'`, `pool_size === units.length` (submitted batch size),
  four terms from `counts`, `stale_regenerated` populated (0 when none, not
  NULL — NULL is reserved for pre-measurement rows, DEC-3). *Red proof:*
  covered by guard W-2's sequence; behaviorally, revert the route write →
  this assertion red.

### 2.6 i18n registry test (extend the existing `describe("i18n registry → locale")`)

Extend the existing en-locale test: for every member of `ALTITUDE_FRESHNESS`
and every `update_reason` (`stage_changed`, `label_changed`), the mapped key
exists under `planLedger.pool.altitudes.*` in `en/projectDetail.json`
(mapping: `stale_refresh_queued → staleRefreshQueued`,
`stale_refresh_unavailable → staleRefreshUnavailable`,
`stage_changed → updatedStageChanged`, `label_changed → updatedLabelChanged`,
plus `dismiss`, `dismissAll`). The snake→camel map is written **once** in
this test and must match the client component's map (C-registry below).
Four-locale parity rides on the existing `i18n.test.ts` E1.1 derive-from-`en`
mechanism — no new per-locale test needed. **Red proof:** delete
`updatedStageChanged` from `en/projectDetail.json` → this test red (and E1.1
red for the other locales if only they lag).

---

## 3. `server/__tests__/value-summary-tick.test.js` — L1–L3

Reuse `__injectPoolAssemblerForTest`, `makeSweptProject`, `lastLogRow`,
`sweepState` helpers. Seed cached rows through a direct
`enrichPoolAltitudes` call (production writer), then inject a pool assembler
returning the (partially mutated) unit set.

- **L1 — four-term identity exact under staleness, `cache_hits === 10` not
  15.** Pool of 45: 10 fresh-cached, 5 stale-cached (seed all 15, then the
  injected assembler returns the 5 with a changed `stage`), 30 uncached; LLM
  on; spawn resolves all 35 in-cap misses. Assert log row:
  `pool_size 45, cache_hits 10, generated 35, queued 0, unavailable 0` and
  `cache_hits + generated + queued + unavailable === pool_size`. Sizing is
  deliberate: the wrong implementation (stale counted as hit AND generated)
  reads `10+35=45` vs `15+35=50` — numerically distinguishable.
  *Red proof:* in the composer's `counts`, count snapshot-stale served
  rows into `cache_hits` as well → sum 50 ≠ 45 → red.
- **L2 — overlap counter bounded.** Same fixture:
  `stale_regenerated === 5` on the log row, and
  `stale_regenerated <= generated + queued + unavailable` asserted as a
  general invariant. Also assert the tick passes it through (row value not
  NULL — NULL is legacy-only). *No separate mutation — L1's mutation also
  perturbs this; record both.*
- **L3 — sweep drains staleness through the shared read path.** Tick 1:
  all-cached-fresh pool → zero broadcasts (existing broadcast-discipline
  test extended, not duplicated), log `generated 0`. Swap the injected
  assembler for one returning the same pool with **one** unit's stage
  changed. Tick 2: exactly one broadcast, `unit_keys` = that one key, log
  row `cache_hits = pool-1, generated = 1, stale_regenerated = 1`; and
  `pending_after_sweep === 0` (stale ≠ pending — T-C instrument holds with
  stale units in the pool). *Red proof:* remove the comparator gate in
  `readCached` (stale detection off) → L3 red. **Vacuity cross-check:** the
  same mutation must also turn D3 red; if L3 went red while D3 stayed green
  (or vice versa), one path is not going through the shared read path —
  investigate before repairing anything.
- **Tick counting sourced from `counts` (DEC-14):** assert the tick's log
  row equals the composer's `counts` field-for-field for the L1 fixture
  (no hand-rolled loop remainder). *Red proof:* re-introduce a local
  counting loop in the tick that diverges by one (e.g. skip `queued`) →
  red on the identity.

---

## 4. `server/__tests__/db-migration.test.js` — M1/M2

Follow the file's two-part convention: entries in `UPGRADE_CASES` (the
meta-test needs each `table.column` pair present once) **plus** a
hand-written `describe` per migration (the `detour_dispositions.project_id`
precedent at ~130-160 / describe at ~710). For M1's five columns sharing one
ALTER block, use the `color_thresholds` spread-IIFE precedent (~353) — one
`legacySql`/`seed` shared across the five `table.column` entries.
**No new `GRANDFATHERED` entries** (the array's own comment forbids it).

- **M1 — `value_unit_summaries` five columns.**
  `legacySql` = the pre-slice CREATE body **verbatim** (db.js:826-832:
  `unit_key TEXT PRIMARY KEY, project_level TEXT NOT NULL, stakeholder_level
  TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL DEFAULT (…)`).
  `seed`: the `resumeJobPipelineTracker` row (mutable) + one
  `trunk_commit::legacy::/repo` row.
  `describe("Migration: value_unit_summaries input-snapshot columns")`:
  - it 1: after `require("../db")` with `DASHBOARD_DB_PATH` pointed at the
    temp legacy DB, `PRAGMA table_info(value_unit_summaries)` contains all
    five columns; both legacy rows read `NULL` for all five
    (`assert.equal(row.input_stage, null)` etc.).
  - it 2: idempotent — second `require` (cache-busted) no-ops; column count
    unchanged.
  - it 3: writable — widened `upsertValueUnitSummary` upserts onto the
    legacy key stamping the snapshot; `markValueUnitSummariesSeen` sets
    `seen_at` on a legacy row.
  - **it 4 (behavioral leg — DEC-9 codified):** through the migrated module,
    with a spawn stub: the legacy **mutable** row regenerates (stale); the
    legacy **trunk** row serves `cached: true` (fresh). **Early-return-chain
    trace inside the test** (PLAN-LEVEL VACUOUS FIXTURE guard): before
    calling, assert `getValueUnitSummary.get(mutableKey)` returns the row
    with `input_label === null`, and
    `MUTABLE_VALUE_SOURCES.includes("intake_initiative")` — so the fixture
    provably reaches the comparison. *Red proof:* revert the stale-on-legacy
    behavior in `readCached` → it 4 red. Implementing **backfill instead of
    lazy invalidation** also turns it 4 red (same proof as D5 — record both
    runs, they are the two halves of DEC-9's executable record).
- **M2 — `value_summary_generation_log.stale_regenerated`.**
  `legacySql` = pre-slice CREATE verbatim (db.js:1822-1835, including both
  CHECKs — untouched, so no §9.6 REBUILD_CASES; if the build ever widens a
  CHECK here, flag back to QA: the risk class changes). `seed`: one legacy
  log row (`source 'tick'`, `outcome 'ok'`, four terms summing to
  pool_size).
  - it 1: column exists; **legacy row reads `NULL`, and explicitly not 0**:
    `assert.strictEqual(row.stale_regenerated, null, "NULL = predates
    measurement — a DEFAULT 0 would stamp a false measured zero (DEC-3)")`.
    This assertion **is** the red proof against the engineer's original
    `NOT NULL DEFAULT 0` design — implementing that makes it red by itself.
  - it 2: idempotent.
  - it 3: writable — widened `insertValueSummaryGeneration` (11 params)
    inserts a row with `stale_regenerated = 3`; the legacy row still NULL.
- **PRAGMA idiom check:** the guarded ALTERs must probe via
  `PRAGMA table_info` on `input_label` (all-or-nothing for the five-column
  block) — never try/`SELECT … LIMIT 1`/catch (DEC-5: that idiom feeds
  `chronology-ordering.test.js`'s static scan a probe query). Verified by
  running `chronology-ordering.test.js` unmodified and green — **verify, do
  not assume** (a red there means the wrong idiom was used).

---

## 5. `client/src/components/__tests__/PlanLedgerPanel.test.tsx` — C1–C3

Extend the existing file (mock factories `makeUnit`/`makePlan`, mocked
`api.projectPlans`, real en strings). Add `markAltitudesSeen` to the api
mock: `markAltitudesSeen: (...args) => mockMarkSeenMock(...args)`.

- **C1 — marker renders distinct from every other state in the SAME render
  (extends the T-D combined-render pattern, §9.8).** Fixture: 5 units in one
  response — (a) resolved fresh (no freshness fields), (b) resolved with
  `freshness: "updated_unseen"`, `update_reason: "stage_changed"`,
  `regenerated_at` set, (c) resolved with `update_reason: "label_changed"`,
  (d) `states` queued, (e) `states` unavailable. Assert: the
  stage-changed marker copy (en value of
  `planLedger.pool.altitudes.updatedStageChanged`) renders exactly once; the
  label-changed copy exactly once; **units (b)/(c) ALSO render their
  regenerated text** (marker rides alongside, never replaces); "Queued" and
  "Not available" counts unchanged from today's conventions; the existing
  no-raw-key-leak assertion (`/planLedger\.[a-zA-Z]/` absent from
  `document.body.textContent`) covers the marker — i18n key, never
  hardcoded English in the component. *Red proof:* disable the marker branch
  in `PoolUnitRow` → C1 red.
- **C1b — stale freshness never blanks old text.** Entry with old text +
  `freshness: "stale_refresh_queued"` renders the **text** (not the Queued
  placeholder) plus the `staleRefreshQueued` hint copy; same for
  `stale_refresh_unavailable`. *Red proof:* route stale-freshness entries
  into the placeholder branch → red.
- **C2 — explicit acknowledge, exactly once, no refetch, never
  auto-on-render (DEC-8).** Three legs:
  (a) after render with an `updated_unseen` unit,
  `expect(mockMarkSeenMock).toHaveBeenCalledTimes(0)` — **rendering alone
  never acknowledges**;
  (b) click the per-unit "×" → `toHaveBeenCalledTimes(1)` with
  `("proj-1", [unit.id])`; marker disappears; `mockAltitudesMock` still
  `calledTimes(1)` (no refetch);
  (c) "dismiss all" with two unseen units → **one** call with both keys
  batched.
  *Red proofs:* double-fire the handler → (b)'s exactly-once red;
  acknowledge in the load effect → (a) red.
- **C3 — compat + degradation + registry honesty.**
  (a) **Old-server response** (entries with no freshness fields, and the
  no-`states`-key response the existing "missing from the altitudes
  response" test uses) → renders exactly today's output: no marker, no
  warn, resolved text as-is. This is the assertion that an un-upgraded
  server never changes a new client's render.
  (b) **Unknown freshness value** `"bogus_freshness"` → text still renders,
  no marker, exactly one `console.warn` naming the value and the unit id
  (mirror the T-E shape).
  (c) **T-E stays honest:** the existing out-of-registry `states: "bogus"`
  test stays green **and its fixture stays bogus** — assert in this spec
  that `"bogus"` is in neither the states list nor the freshness list the
  component recognizes (the chosen names don't collide with the fixture).
  *Red proof:* (b) — remove the unknown-freshness guard so bogus renders a
  marker or blanks text → red.
- **C-registry — the hand-typed registries move together (WATCH-E/F).**
  One `it` asserting: the component's hand-typed states list
  (`PlanLedgerPanel.tsx:558`) is still exactly `["queued", "unavailable"]`
  (DEC-3: gained nothing), and the component's freshness→i18n-key map covers
  exactly `["stale_refresh_queued", "stale_refresh_unavailable",
  "updated_unseen"]` — the client-side pin of the fourth hand-copied
  registry. (The server-side pin is Case 6; the locale pin is §2.6 + E1.1.
  A true cross-runtime import is §9.7's accepted CJS/Vite exception — these
  three pins are the compensating meta-tests, one per copy.)
- **Snapshots** (`client/src/pages/__tests__/screens.snapshot.test.tsx`):
  the marker is an intentional Project Detail change — review the diff,
  then `cd client && npx vitest run -u`. Never blind-update (CLAUDE.md
  policy). The diff must show ONLY marker/dismiss additions.

---

## 6. Test data / fixtures (consolidated)

- **`resumeJobPipelineTracker`** (D5, M1, manual walkthrough): unit_key
  `intake_initiative::2026-08-03-job-pipeline-tracker::/repo`, stakeholder
  text "The job pipeline tracker is built and being tested", snapshot
  columns NULL, current stage `"built"`.
- **Mixed-mutability pool**: existing `unit()` helper with
  `value_source`/`stage` overrides; mutable = `intake_initiative`/`detour`/
  `merge_commit` (DEC-6: merge_commit IS mutable — include one merge_commit
  leg in D3's fixture rotation so the DEC-6 override is behaviorally
  pinned, not just registry-pinned); immutable = `trunk_commit` only.
- **L1 sizing**: 45 = 10 fresh + 5 stale + 30 uncached, cap 40 — chosen so
  correct (45) and broken (50) sums differ numerically.
- **Seeding rule**: production write path for every cached row except the
  deliberately-legacy raw inserts (D5, M1/M2 seeds). Stage changes via
  fixture mutation are legitimate at composer level; sweep-level claims
  (L3) change stage via the injected pool assembler's returned units (the
  production shape the tick actually consumes).
- **Env**: `DASHBOARD_DB_PATH` per spec block (already set at top of each
  server spec — keep the pattern for any new spec file);
  `DASHBOARD_FOCUS_INFER_MODE=heuristic` for LLM-down legs; throwing spawn
  stub for zero-spawn assertions.

## 7. How to run

```bash
# in the effort worktree only — never the main checkout
DASHBOARD_DB_PATH=/tmp/slice1.db node --test server/__tests__/value-summary.test.js
DASHBOARD_DB_PATH=/tmp/slice1.db node --test server/__tests__/value-summary-tick.test.js
DASHBOARD_DB_PATH=/tmp/slice1.db node --test server/__tests__/db-migration.test.js
DASHBOARD_DB_PATH=/tmp/slice1.db node --test server/__tests__/single-writer-guard.test.js
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx

npm run test:server
npm run test:client
bash .claude/skills/file-headers/scripts/check-headers.sh
```

Must stay green untouched: `focus-summary.test.js` (the digest-gating
precedent), the prior effort's AC-1/AC-2/T-A/T-C/B2, and
`chronology-ordering.test.js` (verified after the PRAGMA blocks land).

## 8. Red-first summary (per test, §9.3)

| Test | Red before / green after |
|---|---|
| A2 scan | red against `55fe900`'s `buildPrompt` (reads `u.stage`/`u.label` today) → green after Step 5; plus mutations M-A2-1..6 each red, comment green-proof stays green |
| A1 truth table (T1–T11) | new function — red via label-blind / precedence-swap / input_stage-as-legacy mutations |
| D1 | red when the mutable-source gate is dropped |
| D2 | red under A3's write/check divergence (this is the vacuity check for D2 itself) |
| D3/D4 | D3 red under `if (false)` mismatch branch; D4 red while D3 green under stage-only comparison |
| D5/D5b | D5 red under backfill-on-migrate; D5b red under input_stage-as-legacy-discriminator |
| D6 | red both directions (skip marker / stamp always) |
| DEC-7 P2 | red when route coerces missing stage to `""` |
| R3 | red when re-homing dropped (unit falls into `states`) |
| Case 5 widened | red under the resurrected S6 dup bug |
| DEC-11 anti-fix | red under either one-line "fix" (hit-counting or altitude-dropping) |
| SEEN-4 | red when `seen_at = NULL` removed from the one writer's `DO UPDATE SET` |
| L1 | red when stale served counted into `cache_hits` (sum 50 ≠ 45) |
| L3 | red when comparator gate removed; must co-red with D3 (shared-path proof) |
| M1 it 4 | red under revert-stale-on-legacy AND under backfill |
| M2 it 1 | red under `NOT NULL DEFAULT 0` |
| W-1 | red under rogue upsert in `readCached` (fresh re-proof post-refactor) |
| W-2 | designed red when route logging lands (record output), then widened; fresh red via rogue call in a third file |
| W-3 | red under auto-mark-seen injection in the composer |
| C1/C1b | red with marker branch disabled / stale routed to placeholder |
| C2 | red on double-fire; DEC-8 leg red under acknowledge-on-render |
| C3 | red when unknown-freshness guard removed |
