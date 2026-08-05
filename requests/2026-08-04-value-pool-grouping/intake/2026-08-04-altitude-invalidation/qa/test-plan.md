# Test Plan — 2026-08-04-altitude-invalidation (Value Pool Slice 1)

> Authored by `qa-lead`, 2026-08-04, synthesizing `supporting/coverage.md`,
> `supporting/risk.md`, `supporting/unit-tests.md`, `supporting/e2e-tests.md` and
> the strategist's **BLIND** verdict in `qa-assessment.md`. This is the buildable
> deliverable: the assessment says *whether* coverage is adequate; this says
> *exactly what to build* to make it so.
>
> **Run mode: auto-pilot.** Every open call the strategist and risk analyst left
> undecided is decided here and logged `DECIDED-AUTO` in `./decisions.md`
> (`QA-DEC-1..QA-DEC-11`), mirrored into the intake `decisions.md` as
> `DEC-17..DEC-26` where the ruling must outlive this QA pass.
>
> **Substrate:** `origin/master` @ `55fe900`. The change is **planned, not built** —
> every path below lands on the effort worktree
> `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor`.
> Never the main checkout (45-entry dirty tree, concurrent session).
>
> **This plan amends `technical-plan.md` by reference.** Where they disagree, this
> plan wins, and each disagreement is a numbered amendment in §A below with a
> `decisions.md` row behind it. Three of those amendments are the strategist's
> gating items and are **MANDATORY** — the BLIND verdict does not clear without
> all three.

---

## Objective

Close the gap between a designed test surface that is broad and a designed test
surface that can *fail on the defects the plan itself specifies*. We add ~85 cases
across six discovered layers so that, at the end: the six-column migration is
**convergent under interruption and unable to throw out of `require()`**, proven by
a seeded mid-crash fixture at both the module and the whole-app-boot grain (§9.5's
cure carrying §9.6's physics — today no planned test can see either failure
ordering); the four-term partition identity
`cache_hits + generated + queued + unavailable === pool_size` holds **at the route
seam on malformed input**, because the partition gets exactly one owner instead of
two derivations (§9.8 instance #1's own carried lesson); and `buildPrompt`'s input
set is pinned by a scan strong enough that all **nine** known evasion classes are
individually red-proven, with the one structurally-unreachable class dispositioned
in the scan's own comment (§9.1, the slice's never-traded-away cure). Alongside
those three, we pin the mutability lifecycle end to end (comparator truth table,
D1–D6, marker arm/clear/re-arm with a compare-and-set stamp, steady-state
anti-oscillation at tick 3), and we terminate **all 13 trap legs** from `risk.md` —
zero may end as prose, which is the failure this project has now recorded four
times.

**End state — invariants guarded that are not guarded today:** INV-1 (single
reader of unit fields), INV-2/INV-4 (exactly-one-bucket and the four-term identity
*at every seam that adds or drops a unit*), INV-5 (additive migration convergent
and non-throwing), INV-6 (`seen_at` round-trip, and a stamp can no longer land on
a generation the user never saw), INV-7 (old text never blanked; no freshness
value routes a resolved entry into a string state), INV-8 (no raw i18n key ever
reaches the user, including for a reason string this client has never heard of),
INV-10 (steady state — a unit that regenerates comes to rest).

---

## Coverage gap being closed

Every row is UNGUARDED or MIS-COVERED today, per `coverage.md` §3 and the
assessment's reconciliation table.

| # | Unguarded / mis-covered surface | Catalog id | The assertion that now pins it |
|---|---|---|---|
| 1 | Multi-column additive migration under **interruption** (`db.exec` of 5 ALTERs, one probe, no transaction, no catch) | **§9.5 FRESH-DB-BLIND** carrying **§9.6 NON-ATOMIC REBUILD** physics | `M1-INT` (module grain) + `B4` (whole-app-boot grain): seed legacy table **plus `input_stage` only**, boot, assert **no throw**, all five columns present, second run a no-op |
| 2 | Every additive migration block in `db.js` deciding atomicity by hand (5 already shipped) | **§9.5** (how-to-comply gap) / **§9.6** durable-cure shape | `ALTER-BLOCK-SCAN`: no multi-statement `ALTER … ADD COLUMN` `db.exec` block outside `addColumnsIfMissing`, exact-set grandfathering of the 5 pre-existing sites with dated reasons |
| 3 | Registry-completeness of the six new columns once they stop being raw `ALTER` literals | **§9.2** (registry-derived read as block-derived) / **§9.7** | `HELPER-CASE-SCAN`: every `table.column` pair passed to `addColumnsIfMissing` in `db.js` must have its own `UPGRADE_CASES` entry — **six**, not two |
| 4 | Four-term identity at the **route seam** when sanitization drops a unit (planned test asserted the *defect*) | **§9.8 OVERLOADED-ABSENCE** (instance #1, its own cure) + **§9.3 PLAN-LEVEL VACUOUS FIXTURE** | `ROUTE-SEAM-1`: N good + 1 bogus `value_source` + 1 key-less → one log row, `pool_size === units.length`, four terms sum exactly, every **keyed** unit bucketed once on the wire |
| 5 | Which fields `buildPrompt` may read | **§9.1 DERIVED-DUAL-VIEW** + **§9.7 HAND-SCOPED SCAN** | `A2` strong scan: 9 assertions, per-unit identifier **derived from the map callback**, exactly one mention in the callback body, 7 mutations red individually + a comment green-proof |
| 6 | Mutability / invalidation behavior (no test anywhere mutates a unit's stage or label between reads; every cache fixture in both server specs is the immutable `trunk_commit` arm) | — (net-new) | `A1` T1–T11 + `U1–U4`, `D1`–`D6`, `D5b`, `L1`–`L3` |
| 7 | Cross-path normalization (route-reconstructed unit vs assembler unit) | **§9.1** | `P1` structural + `P2` behavioral through the real route; `E7` convergence two-step |
| 8 | A unit that never comes to rest (fake-legacy NULL label ⇒ regenerate forever; silent unbounded spend) | **INV-10**, §9.1-adjacent | `L3` **tick 3**: unchanged inputs ⇒ `cache_hits = pool_size, generated = 0, stale_regenerated = 0` |
| 9 | `POST /altitudes/seen` (endpoint does not exist) + the acknowledge round-trip | — (net-new) + **INV-6** | `SEEN-1..7`, `E3`, `E4`, `E5` |
| 10 | A `/seen` stamp landing on a generation the user never saw | **INV-6** (T-D) | `SEEN-6` compare-and-set, deterministic, no timing; plus the `IS ?` NULL leg |
| 11 | The log/wire partitions disagreeing **by design**, guarded in two different files | **DEC-11** / §9.3 fixer-hazard | `DEC-11-ANTIFIX`: both partitions asserted from **one** fixture in **one** `it()`, titled BY DESIGN |
| 12 | Marker/acknowledge UI, and an `update_reason` this client has never heard of | **INV-8** no-leak | `C1`, `C1b`, `C2`, `C3(a–d)`, `C-registry` |
| 13 | `ALTITUDE_FRESHNESS` — born as a **fourth** hand-copied registry | **§9.7** accepted exception (WATCH-F) | three compensating pins: `Case 6` (server import), `§2.6` registry→locale, `C-registry` (client map) |
| 14 | Tests silently migrating the live user-global DB | **TEST-AGAINST-LIVE-DB** (candidate, 3rd decline) | `DB_PATH` positive assertion in every touched/new server spec — a *positive* control, never the proven-invalid per-file grep |

---

## A. Amendments to `technical-plan.md` (this plan is the amending document)

The three MANDATORY items gate the build. Nothing downstream of them may be
ticked until they are in.

### A-1 (MANDATORY, T-E) — Step 2.4 is replaced by the `addColumnsIfMissing` helper

`technical-plan.md:300-316` (one `db.exec` of five sequential `ALTER`s behind a
single probe on `input_label`, no transaction, no `try/catch`) is **withdrawn**.
Replace with a shared helper in `server/db.js`, sited next to and mirroring
`rebuildTableAtomically` (`db.js:1640`, the §9.6 durable cure this repo already
built and trusts):

```js
/**
 * Adds any missing columns to `table`. Probes PER COLUMN (so any partial state
 * from an interrupted earlier run converges on the next boot) and applies only
 * the missing ones inside ONE transaction. NEVER throws: db.js runs at
 * require() time, so a throw here bricks the Express server, MCP server,
 * Electron app and VS Code extension simultaneously against the one shared
 * user-global DB (§9.6 B3 — "atomicity is necessary and not sufficient; the
 * migration must also be unable to throw, because the caller is require()").
 *
 * @param {{ table: string, columns: Record<string,string> }} opts
 * @returns {boolean} true if at least one column was added
 */
function addColumnsIfMissing({ table, columns }) { … }
```

Binding requirements — each one is separately asserted (see `MIG-HELPER-1..4`):

1. **Per-column probe.** Read `PRAGMA table_info(table)` once, build a `Set` of
   existing names, apply only the absent ones. Convergent under *any*
   interleaving; a single probe on any one column is not.
2. **If the table does not exist, return `false`** (no columns, nothing to do) —
   the same guard shape as `rebuildTableAtomically`'s `if (!meta) return false`.
3. **One transaction.** Emit the missing ALTERs as a single
   `db.exec("BEGIN; ALTER …; ALTER …; COMMIT;")`, matching the file's existing
   transactional precedent (`db.exec` with an explicit `BEGIN`/`COMMIT`, not
   `db.transaction()` — the repo has a `compat-sqlite` fallback and the existing
   cure uses the `exec` form).
4. **Catch → roll back → log → continue.** On any error: `if (db.inTransaction)`
   best-effort `ROLLBACK`, `console.error` naming the table and leaving the
   pre-migration schema in place, `return false`. Never rethrow.
5. **This slice is its first call site**, for both blocks:
   `addColumnsIfMissing({ table: "value_unit_summaries", columns: { input_stage: "TEXT", input_label: "TEXT", regenerated_at: "TEXT", regen_reason: "TEXT", seen_at: "TEXT" } })` and
   `addColumnsIfMissing({ table: "value_summary_generation_log", columns: { stale_regenerated: "INTEGER" } })`.
6. **The five pre-existing hand-rolled blocks are grandfathered with dated
   reasons, never retrofitted in this change** — the exact precedent
   `REBUILD_CASES` set on 2026-08-02/03 (`db-migration.test.js:1330-1368`). At
   `55fe900` they are: `agents.workflow_run_id`+`workflow_phase` (~1003-1008 —
   ALTERs inside a `catch`, so a throw on the second escapes),
   `model_pricing.fast_*` (~1059-1067), `color_thresholds` rate columns (six,
   ~1466-1476), `color_thresholds`' legacy split (six, ~1503-1515),
   `context_snapshots.input_tokens`/`cache_read_tokens`/`cache_write_tokens`
   (~1959-1971). Re-anchor the line numbers on the worktree; the scan discovers
   the blocks from source text, so the registry keys are `table.firstColumn`
   strings, never line numbers.

> **The interaction nobody has flagged yet, and it is load-bearing.** The
> migration meta-test (`db-migration.test.js:1414-1451`) derives its obligation by
> regex-scanning `db.js` for `/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/g` and
> **skips templated columns** (`if (column.includes("$")) continue`). Routing this
> slice's DDL through a helper that builds `ALTER TABLE ${table} ADD COLUMN
> ${name} ${type}` therefore makes all six columns **invisible to that scan** — the
> six `UPGRADE_CASES` entries stop being mechanically forced the moment we adopt
> the durable cure, and every future helper call site inherits the hole. A2-1
> without A-2 below would trade a Critical defect for a silent §9.7. The two
> amendments ship together or neither ships.

### A-2 (MANDATORY, companion to A-1) — the migration meta-test grows two scans

In `server/__tests__/db-migration.test.js`, alongside the existing
`describe("Migration meta-test")` (leave it untouched — it still guards the five
grandfathered raw blocks and everything historical):

- **`HELPER-CASE-SCAN`** — `it("every column added via addColumnsIfMissing has its own UPGRADE_CASES entry")`.
  Read `db.js`; find every `addColumnsIfMissing(` call site; brace-walk its object
  literal; extract `table: "…"` and every `name: "TYPE"` key inside `columns: {…}`;
  build `table.column` pairs. Assert (a) at least one call site found and at least
  six pairs (§9.3 corollary (a) — a scan that matches nothing cannot pass
  vacuously); (b) every pair is in `UPGRADE_CASES.map(uc => \`${uc.table}.${uc.column}\`)`,
  with the failure message **"do not add to `GRANDFATHERED`"**.
- **`ALTER-BLOCK-SCAN`** — `it("no multi-column ALTER block bypasses addColumnsIfMissing (§9.5 how-to-comply, 2026-08-04)")`.
  Find every `db.exec(` template literal in `db.js` containing **two or more**
  `ALTER TABLE … ADD COLUMN` statements. Each must be registered in a new
  `GRANDFATHERED_ALTER_BLOCKS` map keyed `table.firstColumn`, each entry carrying a
  dated `reason`. Assert with `assert.deepEqual(foundKeys.sort(), Object.keys(GRANDFATHERED_ALTER_BLOCKS).sort())`
  — an **exact set**, never a superset: an orphan registry entry is as much a
  failure as an unregistered block (the W-2 lesson). Registry seeded with exactly
  the five sites in A-1.6 and a comment forbidding growth: *"a new multi-column
  ALTER block must go through `addColumnsIfMissing`; do not add a row here to make
  this pass."*

**Six `UPGRADE_CASES` entries, not two.** Five for
`value_unit_summaries.{input_stage,input_label,regenerated_at,regen_reason,seen_at}`
sharing one `legacySql`/`seed` via the `color_thresholds` spread-IIFE precedent
(`db-migration.test.js` ~353), plus M2 for
`value_summary_generation_log.stale_regenerated`. **No new `GRANDFATHERED`
entries** — the array's own comment forbids it.

### A-3 (MANDATORY, T-F) — DEC-4's log arithmetic, fixed by removing the second derivation

`technical-plan.md` Step 9.2 and `unit-tests.md` §2.5's route-logging bullet are
both **defective as written** and must not be carried forward: the composer is
called with `clean` (the sanitized subset), so `counts` sums to `clean.length`,
while `pool_size` is `units.length` — the first malformed or old-client request
breaks the identity the whole slice treats as inviolable, and the *planned test
asserts that broken identity*.

The strategist's P0-2 fixes the arithmetic at the route. We go one step further
and take the strategist's own **DC-2** instead, because it costs one optional
parameter and removes the class rather than the instance (QA-DEC-7):

- `enrichPoolAltitudes(dbModule, units, opts)` accepts `opts.droppedCount`
  (default `0`) — the number of submitted units the caller could not hand over.
- The composer folds it in **inside the one place counts are computed**:
  `counts.pool_size = units.length + droppedCount` and
  `counts.unavailable = <composer unavailable> + droppedCount`. Same meaning as
  the S3 wire fix: route-dropped = attempted-and-unusable.
- `server/routes/project-plans.js` passes `droppedCount: units.length - clean.length`
  at the single composer call site (this covers **both** rejection classes: a bogus
  `value_source` diverted to the route-level `states` map, and a key-less unit
  dropped entirely) and then logs `counts` **verbatim** — `pool_size` included. The
  route never computes a partition term.
- The tick passes nothing; `droppedCount` defaults to `0`; every existing tick
  number is unchanged.
- **Wire shape is untouched.** `altitudes`/`states` are exactly as designed; only
  `counts` (server-internal) changes.

Net effect: `pool_size` is still the submitted batch size (malformed traffic stays
visible in the log, which is the useful property), the four terms still sum to it
**by construction rather than by arithmetic care**, and DEC-14's "computed once by
the composer for both loggers" becomes true at the route too.

### A-4 (MANDATORY, T-B/DEC-15) — the strong scan form is plan-of-record

DEC-15's *body* ("no `u.<field>` / `unit.<field>` property access") and
`technical-plan.md` Step 5 / §6 A2 are **superseded** by DEC-15's own *title*: the
scan permits **exactly one mention** of the per-unit identifier, as the argument of
`unitFacts(...)`. The weak form is evaded by bracket access, destructuring,
aliasing, spread-copy (which even satisfies the planned `facts.` sentinel),
parameter renaming, and — a class this reconciliation adds — indexing the array
parameter directly (`units[0].stage`, which matches **none** of `unit-tests.md`
§1.1's regexes because `\b(u|unit)` is not followed by `.` or `[` in the string
`units[`). Full mechanics in the Test change set, §Guards / `A2`.

### A-5 (T-D) — the `/seen` stamp becomes a compare-and-set

`technical-plan.md` Step 2.5's unconditional
`UPDATE … SET seen_at = … WHERE unit_key = ?` is replaced by
`UPDATE value_unit_summaries SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE unit_key = ? AND regenerated_at IS ?`
(`IS ?` so the first-generation `NULL` leg matches; `= ?` would silently stamp
nothing). Endpoint payload becomes
`{ project_id: string, units: [{ unit_key: string, regenerated_at: string|null }] }`
→ `{ updated: n }`, where `n` is the summed `.changes` and therefore honestly
reports a stamp that missed. Ripple, enumerated so nothing is discovered late:
`server/routes/project-plans.js` (validation + statement call),
`client/src/lib/types.ts`, `client/src/lib/api.ts`
(`markAltitudesSeen(projectId, units)`),
`client/src/components/PlanLedgerPanel.tsx` (per-unit "×" and dismiss-all both
already hold `regenerated_at` on the entry), and the `SEEN-*` / `E3` / `E5` / `C2`
cases below, which are written against the new shape. Still idempotent; still one
statement; still one lexical call site (guard W-3 unaffected). Rationale and the
alternative in `decisions.md` QA-DEC-1.

### A-6 (T-C leg 3) — a seventh i18n key

`C3(d)` requires a generic fallback marker key. `planLedger.pool.altitudes.updatedGeneric`
is added in **all four** locales (en/ko/vi/zh), taking the plan's key count from 6
to 7, and the client's `update_reason → key` map gains a `default` arm. OPEN-4's
copy list grows by one string (en: *"updated"*). See QA-DEC-10.

### A-7 — corrections the build must carry as bookkeeping

- **Baseline is 78, not 77.** The four core server specs at `55fe900` are
  `value-summary` **25**, `value-summary-tick` **21**, `single-writer-guard` **10**,
  `db-migration` **22** = **78**. Also green: `focus-summary` 21, `chronology-ordering`
  6, `PlanLedgerPanel` 14, `screens.snapshot` 19, `i18n` 76. Record the **per-file**
  numbers in the build report; a wrong baseline is how a genuinely-red spec later
  reads as "expected".
- The component `technical-plan.md` calls `PoolUnitRow` is **`ValueUnitRow`** in
  source. Use the real name in anchors.
- `openapi-contract.test.js` will stay green over the missing `/altitudes/seen`
  fragment because its scan is **mount-level** and `/api/project-plans` is already
  mounted and documented. That is a finding, not a pass — see QA-DEC-3 and the
  catalog note.

---

## Test change set

Layers as this project actually has them (discovered from `package.json` and
`coverage.md` §Test layers — there is no Cypress/Playwright tier; "e2e" here is
real HTTP against a real `createApp()`/`startServer(app, 0)` on a temp SQLite DB
with only the `claude -p` spawn faked, and the process-grain bucket is
"one spec file = one process = one boot").

**Layer reconciliation (what I moved between the two architects' documents, and
why).** Permutation coverage stays at the unit/composer layer, which is ~10×
cheaper and already sized to be non-vacuous; e2e keeps the minimum flow proof of
each wired seam exactly once.
- **Moved DOWN to unit:** the acknowledge *validation* matrix. `e2e-tests.md`'s
  `E5` shrinks to one status-code smoke assertion; the full 8-way malformed-input
  matrix lives in `SEEN-3` at the composer/route-unit layer.
- **Moved DOWN to unit:** freshness rendering permutations. `C1b` loops
  **the `ALTITUDE_FRESHNESS` registry** rather than three hand-typed cases; e2e
  asserts only that `freshness`/`update_reason` reach the wire (`E2`).
- **Kept UP at e2e (deliberate duplication, one seam each):** `E2` echoes `D3`
  because the route's sanitization loop is a real seam `D3` never crosses (that
  seam is the whole reason DEC-7 exists); `B4` echoes `M1-INT` because only the
  full `require("../index")` graph proves the §9.6-B3 claim that the migration
  cannot throw out of `require()` for *every* process, not just for `../db`.
- **Added at e2e:** `E7` (T-H convergence two-step) — the only route→tick→quiesce
  path, and the only place WATCH-C's "converges" claim becomes verified rather
  than asserted.
- **Corrected, not carried:** `unit-tests.md` §2.5's route-logging assertion
  (asserted the defect — see A-3) and its `SEEN-*` payload shape (see A-5).

### Layer 1 — Structural guards · `server/__tests__/single-writer-guard.test.js` (modify)

- **`A2` — the `buildPrompt` structural scan (MANDATORY, DEC-15 strong form).**
  New `it("buildPrompt reads no unit field outside unitFacts(u) — DEC-15 structural scan")`
  inside the existing `describe("Single-writer structural guard (§9.1 DERIVED-DUAL-VIEW)")`.
  Mechanics, exactly:
  1. Read `server/lib/value-summary.js` raw. **Strip block comments first**
     (`/\/\*[\s\S]*?\*\//g`), then `//` line comments with the file's existing
     per-line `indexOf("//")` approach — that order, so a `//` inside a JSDoc
     cannot truncate a code line. Extract this as a shared local
     `stripComments(source)` and **use it for guard W-1 too** (see below).
  2. Brace-walk `buildPrompt`'s lexical body from `/function\s+buildPrompt\s*\(/`
     (the walker the file already uses for `applyDisposition` /
     `enrichPoolAltitudes`). **Do NOT strip template-literal interiors** —
     `${u.stage}` inside a template is a property access and must stay visible.
  3. **Derive both identifiers from source, never hand-type them (§9.7,
     evasion #7).** `ARR` = `buildPrompt`'s own parameter, from the signature
     match. `PARAM` = the first parameter of the units-mapping callback, from the
     first `/\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*[,)]/` inside the body. If the
     callback parameter is destructured (`.map(({`), fail immediately with the
     destructuring message. If either derivation finds nothing, fail — a
     restructured `buildPrompt` must turn this scan red, never silently pass.
  4. Brace/arrow-walk the callback body (`CB`) from that `=>`.
  5. Assertions (each its own `assert` with a message naming its evasion class):
     - **(a) scope non-empty + positive sentinel:** `body.length > 200` and
       `/\bfacts\./.test(body)`.
     - **(b) no dot access:** zero matches of `new RegExp("\\b" + PARAM + "\\s*\\.\\s*[A-Za-z_$]", "g")` in `body`.
     - **(c) no bracket access:** zero matches of `\bPARAM\s*\[`.
     - **(d) no destructuring assignment:** zero matches of `/\{[^}]*\}\s*=\s*PARAM\b/g`.
     - **(e) no destructured callback params:** zero matches of `/\(\s*\{/g` in `body`.
     - **(f) no aliasing:** zero matches of `/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*PARAM\s*[;,)\n]/g`.
     - **(g) the permitted form is present:** `new RegExp("unitFacts\\s*\\(\\s*" + PARAM + "\\s*\\)").test(CB)`.
     - **(h) STRONG FORM — exactly one mention:** the count of
       `new RegExp("\\b" + PARAM + "\\b", "g")` **within `CB`** is exactly **1**, and
       (g) proves that one mention is the `unitFacts(...)` argument. *(Count within
       the callback body, not the whole function body — the parameter's binding
       occurrence in `(u, i) =>` lives outside `CB` and must not be counted; state
       this in the test's comment so nobody "fixes" it to 2.)*
     - **(i) NEW — the array parameter is not read either:** the count of
       `\bARR\b` in `body` is exactly **1** and it is immediately followed by
       `.map(`. This closes evasion class #9 (`units[0].stage`), which none of the
       eight classes in `risk.md` covers and which every regex in `unit-tests.md`
       §1.1 lets through.
  6. **Evasion #8's disposition goes in the scan's own comment, verbatim in
     substance:** *"A helper defined elsewhere in this file that reads `u.stage`
     in its own body is out of a lexical body scan's reach by construction. Its
     backstops are the comparator-single-home scan below, the DEC-7 cross-path
     parity case (P1/P2), and INV-10's steady-state assertion (L3 tick 3). Do not
     widen this scan to chase it — widen those."*
  **Mutations, each observed red individually, red output recorded per mutation:**
  | # | Product mutation in `value-summary.js` | Assertion that must go red |
  |---|---|---|
  | M-A2-1 | `const extra = u.value_ref;` in the map callback (the plan's canonical injection) | (b), (h) |
  | M-A2-2 | `${u.stage}` inside an **existing template literal** in the body | (b), (h) — proves template interiors are scanned |
  | M-A2-3 | callback becomes `.map(({ stage }, i) =>` and uses `stage` | (e) + the destructured-derivation failure in step 3 |
  | M-A2-4 | `const { label } = u;` as a statement | (d), (h) |
  | M-A2-5 | `const v = u;` then `v.stage` | (f), (h) — note (b) alone stays green here; that is why (f)/(h) exist |
  | M-A2-6 | `u["stage"]` | (c), (h) |
  | M-A2-7 | `const first = units[0].stage;` | **(i)** — and (b)/(c)/(h) all stay green, which is the point |
  | M-A2-8 | rename the callback param `u` → `entry` and read `entry.stage` | (b)/(h) via the **derived** identifier — hand-typed `u`/`unit` would stay green |
  **Green-proof (over-breadth control, equally required):** add a JSDoc block above
  `buildPrompt` containing the literal `u.value_ref reads` plus a `// u.stage` line
  comment → the scan must **stay green**. Remove; `git diff --stat` empty.
  **Red-first:** written against unmodified `55fe900`, `buildPrompt` reads
  `u.stage`, `u.label || u.value_ref`, `u.value_source` directly (`value-summary.js:84-88`),
  so (b)/(g)/(h) are red **before** Step 5's refactor and green after. Write it first.

- **`A2-HOME` — comparator single-home scan (new `it`).**
  `scanFiles(serverDir, /input_stage|input_label/)`, filter `.test.js`,
  `assert.deepEqual(basenames.sort(), ["db.js", "value-summary.js"])`.
  **Red proof:** add `row.input_stage` to a line in `value-summary-tick.js` → red; revert.

- **`W-1` — `upsertValueUnitSummary.run(` stays at exactly 1. Expectation
  UNCHANGED — if it goes red the design was violated; fix the product, never
  widen.** Two obligations in the same diff: (i) upgrade its stripper (~226-232,
  `//` only today) to the shared `stripComments` — this slice rewrites
  `value-summary.js`'s header and a JSDoc containing the literal
  `upsertValueUnitSummary.run(` counts as a call site (**this bit the parent
  build**); (ii) a **fresh** red proof, because `readCached` changes around it:
  inject a rogue `dbModule.stmts.upsertValueUnitSummary.run(…)` into the new
  `readCached` body (the plausible bug: "stamp the snapshot on read") → `2 !== 1`
  red; revert; verify the inside-`enrichPoolAltitudes` leg still locates the call
  after the Step 6/7 refactor moves code.

- **`W-2` — `insertValueSummaryGeneration` file set. DELIBERATE red → widen.
  Sequence exactly, and do not confuse it with W-1:**
  1. **Before** the route is touched: run unmodified → green,
     `["db.js", "value-summary-tick.js"]`.
  2. Implement request-path logging. Run the **unmodified** guard → **observe and
     record the red** (`actual: ["db.js", "project-plans.js", "value-summary-tick.js"]`).
     This is prior-effort WATCH-6's pre-announced moment, not a defect.
  3. **Same commit:** widen to **exactly** that sorted set, still `assert.deepEqual`
     — never `.includes`/superset. Replace the "WATCH-6 will deliberately widen"
     comment (259-265) with a DEC-4 note.
  4. **Post-widen fresh red proof (VACUOUS-REPAIR rule):** inject a rogue
     `insertValueSummaryGeneration.run(…)` into `server/lib/workflow-ingest.js` →
     red (proves exact-set, not at-least). Revert.

- **`W-3` — `markValueUnitSummariesSeen` (new guard; a genuine second production
  writer to `value_unit_summaries`).**
  `it("markValueUnitSummariesSeen appears only in db.js and project-plans.js, with one lexical call site in the seen handler")`.
  File scan `assert.deepEqual(basenames.sort(), ["db.js", "project-plans.js"])`;
  lexical count of `markValueUnitSummariesSeen.run(` in `routes/project-plans.js`
  === 1, located inside the `/altitudes/seen` handler body (brace-walk from
  `router.post("/altitudes/seen"`). Looping per key inside one transaction is
  still one lexical site. **Red proofs, both:** (i) inject
  `dbModule.stmts.markValueUnitSummariesSeen.run(…)` into `enrichPoolAltitudes`
  after the upsert (the realistic bug: auto-mark-seen on regeneration, which would
  defeat DEC-8 *and* the marker) → file-scan red; (ii) add a second `.run(` in the
  route → count red. Same diff: narrow `value-summary.js`'s header "ONE lexical
  writer of the cache table" claim to "one writer of the **synthesis columns**".

- **`W-4` — `assertSingleHome` `absent` lists** updated for `MUTABLE_VALUE_SOURCES`,
  `ALTITUDE_FRESHNESS`, `unitFacts`, `compareUnitInputs` (the latter two exported
  for A1; absent at both consumers — route and tick consume only
  `enrichPoolAltitudes`'s return). The tripwire going red when Step 4 adds the
  export **is it working** — update in the same commit. **Red proof:** temporarily
  import `ALTITUDE_FRESHNESS` into `value-summary-tick.js` → red.

### Layer 2 — Migration & meta · `server/__tests__/db-migration.test.js` (modify)

- **`HELPER-CASE-SCAN`** and **`ALTER-BLOCK-SCAN`** — full mechanics in A-2.
  Red proofs: (i) delete one of the six `UPGRADE_CASES` entries →
  `HELPER-CASE-SCAN` red naming the missing `table.column`; (ii) revert Step 2.4 to
  the plan's original raw five-ALTER `db.exec` block → `ALTER-BLOCK-SCAN` red
  **and** `HELPER-CASE-SCAN` red on scope (fewer than six pairs found) — record
  both, they are the executable record of A-1; (iii) add a sixth
  `GRANDFATHERED_ALTER_BLOCKS` row with no matching block → exact-set red.
- **Six `UPGRADE_CASES` entries** (five sharing one `legacySql`/`seed` via the
  `color_thresholds` spread-IIFE precedent, plus M2). `legacySql` for M1 = the
  pre-slice CREATE body **verbatim** (`db.js:826-832`); for M2 = `db.js:1822-1835`
  verbatim including both CHECKs (untouched → no `REBUILD_CASES` entry; if the
  build ever widens a CHECK here, flag back to QA — the risk class changes).
- **`describe("Migration: value_unit_summaries input-snapshot columns")`**
  - `it 1` — after `require("../db")` against the temp legacy DB, `PRAGMA
    table_info` contains all five columns; both seeded legacy rows read `null` for
    each (`assert.equal(row.input_stage, null)` etc.).
  - `it 2` — idempotent: second (cache-busted) `require` no-ops; column count
    unchanged.
  - `it 3` — writable: the widened `upsertValueUnitSummary` upserts onto the legacy
    key stamping the snapshot; `markValueUnitSummariesSeen` sets `seen_at` on a
    legacy row.
  - **`it 4` — behavioral leg (DEC-9 codified).** Through the migrated module with
    a spawn stub: the legacy **mutable** row regenerates (stale), the legacy
    **`trunk_commit`** row serves `cached: true`. **Anti-vacuous fixture guard
    inside the test:** before calling, assert `getValueUnitSummary.get(mutableKey)`
    returns a row with `input_label === null` **and**
    `MUTABLE_VALUE_SOURCES.includes("intake_initiative")` — the fixture provably
    reaches the comparison rather than short-circuiting (PLAN-LEVEL VACUOUS
    FIXTURE). **Red proofs (both recorded):** revert the stale-on-legacy behavior
    in `readCached` → red; implement backfill-on-migrate → red.
  - **`it 5` = `M1-INT` — THE INTERRUPTION LEG (kills T-E's blind spot).**
    Seed the legacy `value_unit_summaries` shape **plus `input_stage` only** — the
    exact mid-crash state a death between statements 1 and 2 leaves behind — then
    `require("../db")` and assert: **(a) no throw**
    (`assert.doesNotThrow(() => require("../db"))` around the cache-busted
    require); (b) all five columns present afterwards; (c) the pre-existing
    `input_stage` column's data survived (seed a row with a non-null
    `input_stage`, assert it is still there — proves convergence, not
    drop-and-recreate); (d) a second cache-busted require is a no-op.
    **This one fixture kills both failure orderings** — the plan's probe-on-second
    -column ordering (which would throw `duplicate column name` out of `require()`)
    and the probe-on-first-column ordering (which would skip the block forever,
    leaving four columns permanently missing). **Red proofs, both recorded:**
    (i) restore the plan's original single-probe-on-`input_label` block →
    leg (a) red with `duplicate column name`; (ii) change the probe to
    `input_stage` (first column) → leg (b) red, four columns missing.
- **`describe("Migration: value_summary_generation_log.stale_regenerated")` (M2)**
  - `it 1` — column exists; the legacy row reads **NULL and explicitly not 0**:
    `assert.strictEqual(row.stale_regenerated, null, "NULL = predates measurement — a DEFAULT 0 would stamp a false measured zero (DEC-3)")`.
    This assertion **is** the red proof against the engineer's original
    `NOT NULL DEFAULT 0` design.
  - `it 2` — idempotent. `it 3` — writable: the widened
    `insertValueSummaryGeneration` (11 params) inserts `stale_regenerated = 3`;
    the legacy row is still NULL.
- **`MIG-HELPER-1..4` — `addColumnsIfMissing`'s own contract**, in the same file:
  (1) adding to a **non-existent** table returns `false` and does not throw;
  (2) a column whose `ALTER` fails (e.g. a deliberately malformed type passed in a
  local fixture DB) is caught, logged, `false` returned, **no throw**, and the
  other columns are left in a state the next call converges from;
  (3) calling twice is a no-op returning `false` the second time;
  (4) a partial state (one of three present) results in exactly the two missing
  ones being added.
  **Red proof for (2):** remove the `try/catch` → the test throws instead of
  returning → red.
- **PRAGMA-idiom check:** the helper probes via `PRAGMA table_info`, never
  try/`SELECT … LIMIT 1`/catch (DEC-5 — that idiom feeds
  `chronology-ordering.test.js`'s static scan a probe query). **Verify by running
  `chronology-ordering.test.js` unmodified and green — verify, do not assume.**

### Layer 3 — Composer, comparator, wire & route · `server/__tests__/value-summary.test.js` (modify)

Reuse the file's `unit()`, `fakeSpawn`, `envelope()`, `deferredSpawn`, `post()` and
`makeProject()` helpers; extend the `beforeEach` wipe with
`DELETE FROM value_summary_generation_log` (the route now writes it). Mutable
fixture convention:
`unit({ unitKey: "intake_initiative::<slug>::/repo", value_source: "intake_initiative", label: "<slug>", stage: "built" })`.
**Seeding rule:** cached rows are seeded **through the production write path**
(call `enrichPoolAltitudes` with a `fakeSpawn` envelope) so the snapshot columns
are stamped by the one real writer; only the deliberately-legacy rows (D5, M1/M2
seeds) are raw-SQL inserts. For cache-hit legs install the throwing spawn stub
(`__injectSpawnForTest(() => { throw new Error("no LLM call expected") })`).

**`describe("unitFacts / compareUnitInputs (A1)")`**
- `U1` `{label:"x", value_ref:"r", stage:"built"}` → `{value_source, label:"x", stage:"built"}`.
- `U2` label null, value_ref `"abc123"` → `label === "abc123"`.
- `U3` label null, value_ref `""` → `label === "(untitled)"`.
- `U4` **no `stage` key at all** (the detour shape, `value-ledger.js:257-266`) →
  `stage === null`, and `assert.deepEqual(unitFacts(noKey), unitFacts({...same, stage: null}))`
  — `undefined → null` normalized here and nowhere else.
- **Comparator truth table — all 11 rows, table-driven with per-row messages:**

| # | `row.input_stage` | `row.input_label` | unit stage | unit label (resolved) | expect |
|---|---|---|---|---|---|
| T1 | "built" | "tracker" | "built" | "tracker" | `null` (stable) |
| T2 | "built" | "tracker" | "shipped" | "tracker" | `"stage_changed"` |
| T3 | "built" | "tracker" | "built" | "tracker-v2" | `"label_changed"` |
| T4 | "built" | "tracker" | "shipped" | "tracker-v2" | `"stage_changed"` (precedence stage > label) |
| T5 | NULL | "tracker" | "built" | "tracker" | `"stage_changed"` (NULL→value) |
| T6 | "built" | "tracker" | *(no stage key)* | "tracker" | `"stage_changed"` (value→NULL) |
| T7 | NULL | "tracker" | *(no stage key — detour)* | "tracker" | `null` — **a detour with a legitimately NULL stage is FRESH** (DEC-12: `input_stage IS NULL` has three meanings, `input_label IS NULL` has one) |
| T8 | NULL | NULL *(legacy)* | *(no stage key)* | "tracker" | `"label_changed"` — legacy falls out stale via the label leg **with no special case in the code** |
| T9 | NULL | NULL *(legacy)* | "built" | "tracker" | `"stage_changed"` (legacy + stage present: precedence gives stage) |
| T10 | "" | "tracker" | *(stage null)* | "tracker" | `"stage_changed"` — `""` and `null` are distinct; normalization lives in `unitFacts`, never in the comparator |
| T11 | NULL | "abc123" | *(no stage)* | label null, value_ref "abc123" | `null` — the row stores the **resolved** label (DEC-2); `null → value_ref` fallback is not a change |

  **Red proofs:** (i) comparator skips the label leg → T3/T8 red while T2 green
  (pins both fields separately); (ii) swap precedence → T4 red; (iii) **DEC-12
  NULL-matrix discriminator:** treat `input_stage IS NULL` as the legacy
  discriminator (the wrong DEC-12 reading) → **T7 red** — this is the assertion
  that makes a legacy row distinguishable from a legitimately-NULL-stage detour;
  (iv) at the **write** site store raw `unit.label` instead of `facts.label` →
  T11's behavioral twin (D2) red.

**`describe("enrichPoolAltitudes input-snapshot gating (D1–D6)")`**
- **`D1`** (a) `trunk_commit` seeded via the production path, re-called with `label`
  mutated → `cached: true`, zero spawns, **and the wire entry has no `freshness`
  key at all** (`assert.ok(!("freshness" in entry))` — absent, not null: old-client
  compat, DEC-3). (b) NULL-snapshot leg: `UPDATE … SET input_stage=NULL,
  input_label=NULL` on the trunk row → still `cached: true`.
  *Red proof:* drop the `MUTABLE_VALUE_SOURCES.includes(...)` gate in `readCached`
  → leg (b) red (the throwing stub fires).
- **`D2`** mutable + unchanged → `cached: true`, zero spawns; row's `regen_reason`
  still `'initial'`, `regenerated_at` still NULL.
  *Red proof = A3:* make the write path stamp `facts.stage + "x"` → D2 red.
  **If D2 stays green under A3, D2 is vacuous — fix D2, then take a fresh red proof.**
- **`D3`** 3 mutable cached + 1 trunk cached; change one mutable unit's stage
  built→shipped. Exactly 1 spawn; captured prompt **contains the stale unit's label
  and none of the other three**; other three `cached: true`; DB row
  `input_stage='shipped'`, `input_label` **NOT NULL**, `regen_reason='stage_changed'`
  (**NOT NULL**), `regenerated_at` NOT NULL, `seen_at` NULL. Include one
  **`merge_commit`** unit in the fixture rotation so DEC-6's override is
  behaviorally pinned, not just registry-pinned.
  *Red proof:* `if (false)` the mismatch branch in `readCached` → zero spawns → red.
- **`D4`** label change, same shape, `regen_reason='label_changed'`.
  *Red proof:* comparator compares stage only → **D4 red while D3 stays green** —
  run both, record both outcomes; the pair is the proof.
- **`D5`** the named `resumeJobPipelineTracker` legacy fixture (raw insert, snapshot
  columns NULL), called with the unit's *current* facts (`stage:"built"`,
  `label:"2026-08-03-job-pipeline-tracker"`) → 1 spawn, text replaced,
  `input_stage='built'`, `input_label` stamped, reason `'stage_changed'`. **The
  point:** it regenerates **even though** the current facts are exactly what a
  backfill would have stamped. **Anti-vacuous fixture guard inside the test** (as
  in M1 `it 4`). *Red proof:* implement backfill (at migration, or
  `if (row.input_label == null) return {cached: row, staleReason: null}`) → D5 red.
- **`D5b`** detour-with-NULL-stage is **not** legacy (behavioral twin of T7):
  detour unit seeded via the production path → row has `input_stage` NULL,
  `input_label` non-NULL; identical second call → `cached: true`, zero spawns.
  *Red proof:* the T7 mutation → D5b red (a detour would regenerate on **every**
  read — the silent-unbounded-spend bug).
- **`D6`** marker lifecycle: (a) after a D3-style regeneration the wire entry
  carries `freshness:"updated_unseen"`, `update_reason:"stage_changed"`,
  `regenerated_at` set; (b) after acknowledge, the next composer call has no
  `freshness` on that entry; (c) a **first** generation carries **no** freshness
  (`regenerated_at` NULL is the discriminator).
  *Red proofs (both recorded):* skip stamping `regenerated_at` on regeneration →
  (a) red; stamp it on every generation → (c) red.

**`describe("DEC-7 cross-path parity")`**
- **`P1`** structural: `assert.deepEqual` of `unitFacts()` over three shapes of the
  same unit — assembler (detour, no stage key, `label: null`, `value_ref:"r"`),
  route-sanitized (`stage: null, label: null` — `project-plans.js:163-170`'s exact
  coercions), explicit-null. All three identical.
- **`P2`** behavioral through the real route: seed by calling `enrichPoolAltitudes`
  directly with the assembler-shaped unit, then `post("/api/project-plans/altitudes", …)`
  with the JSON a client sends for the same unit (`stage` omitted) → `cached: true`,
  zero spawns. *Red proof:* route coerces missing stage to `""` → P2 red.

**`describe("wire shape: freshness, R3, partition, counts")`**
- **`R3`** 40 uncached units first + 1 stale-cached mutable unit last (sliced into
  overflow): the stale unit is in `altitudes` with its **old text** and
  `freshness:"stale_refresh_queued"`, and **absent from `states`**. *Red proof:*
  drop the re-homing step → it lands in `states` as `"queued"` → red (that one-line
  regression is exactly what blanks an old client's visible text).
- **`Case 5` (widened)** 45 submitted = 10 fresh-cached + 5 stale-cached + 30
  uncached, LLM on: `altKeys ∩ stateKeys = ∅`; `altKeys.size + stateKeys.size === 45`;
  every unit with a cached row is in `altitudes`. *Red proof:* resurrect the S6 bug
  (mark a stale dup `unavailable` without clearing `queued`) → red.
- **`Case 6` (extended)** `ALTITUDE_FRESHNESS` **imported** from `../lib/value-summary`;
  `assert.deepEqual(ALTITUDE_FRESHNESS, ["stale_refresh_queued","stale_refresh_unavailable","updated_unseen"])`;
  every `freshness` value in any fixture response asserted via
  `ALTITUDE_FRESHNESS.includes(f)`, never a hand-typed list; `ALTITUDE_STATES`
  still exactly `["queued","unavailable"]` (DEC-3 — gains nothing).
- **Combination cases, one `it` each** (a suite with one test per branch passes
  while the ordering bug ships): (i) stale × over-cap → old text +
  `stale_refresh_queued`; (ii) stale × LLM-down (`DASHBOARD_FOCUS_INFER_MODE=heuristic`)
  → old text + `stale_refresh_unavailable`, and `counts.unavailable` includes it.
- **`COUNTS-SHAPE` (DEC-14 + WATCH-A structural pin)**
  `assert.deepEqual(Object.keys(counts).sort(), ["cache_hits","generated","pool_size","queued","stale_regenerated","unavailable"])`
  — a fifth partition term cannot be added silently — plus the identity
  `cache_hits + generated + queued + unavailable === pool_size` asserted **without**
  `stale_regenerated` in the sum.
- **`COUNTS-DROPPED` (A-3 / DC-2, new)** call `enrichPoolAltitudes(db, units, { droppedCount: 2 })`
  → `counts.pool_size === units.length + 2`, `counts.unavailable === <composer unavailable> + 2`,
  identity still exact. *Red proof:* ignore `droppedCount` in the composer → red.
- **`DEC-11-ANTIFIX` — the anti-"fix" pin, one fixture, both partitions, one `it()`.**
  `it("a stale-served unit is in altitudes on the wire AND a miss in counts — DEC-11, BY DESIGN, do not 'fix' either direction")`.
  Fixture: 1 stale-cached unit, LLM OFF. **In the same test:**
  `res.altitudes[k].stakeholder === <old text>` (wire: served, R3) **AND**
  `counts.cache_hits === 0` **AND** `counts.unavailable === 1` (log: a miss) **AND**
  the four-term identity. Comment in the body, verbatim: *"the wire serves this
  unit's old text while the log counts it a miss — this disagreement is DEC-11, by
  design; counting it a cache_hit overshoots pool_size (L1), dropping it from
  altitudes blanks an old client (R3). Any test asserting log/wire agreement on
  stale units is asserting a bug."* *Red proofs (both one-liners, both recorded):*
  count stale-served into `cache_hits` → the `cache_hits === 0` leg red; drop it
  from `altitudes` → the wire leg red. Because both partitions come from one
  return value, either regression turns **exactly this one test** red even for a
  fixer who runs only the file they touched.

**`describe("POST /api/project-plans/altitudes/seen")` — payload per A-5**
- **`SEEN-1`** happy path: seed a regenerated row (D6(a) state); POST
  `{project_id, units:[{unit_key, regenerated_at: <t2>}]}` → 200 `{updated: 1}`;
  `seen_at` non-NULL; next composer call → no `freshness` on that entry.
- **`SEEN-2`** idempotent: identical second POST → 200 `{updated: 1}`, no error,
  still no freshness.
- **`SEEN-3`** validation matrix (moved down from e2e), one `it` with sub-asserts →
  400 + structured `{error:{code:"INVALID_INPUT", …}}` per `.claude/rules/backend-node.md`
  for: missing `project_id`; `project_id` non-string/empty; missing `units`;
  `units` non-array; empty array; member not an object; member missing `unit_key`;
  member `unit_key` non-string; member `regenerated_at` neither string nor null;
  over-bound length (pin the bound the implementation chooses, e.g. 500).
- **`SEEN-4`** — **stamp-race semantics, the re-arm direction (plan G3).**
  Acknowledge (seen_at set) → mutate the unit's stage → composer regenerates →
  `seen_at IS NULL` again and the wire shows `updated_unseen` again. **The reset
  lives inside `upsertValueUnitSummary`'s `DO UPDATE SET seen_at = NULL` — the one
  writer — never a caller's second UPDATE** (which would trip W-1). *Red proof:*
  remove `seen_at = NULL` from the `DO UPDATE SET` → SEEN-4 red (a second change
  would render as already-seen).
- **`SEEN-5`** acknowledge survives non-regenerating reads: after acknowledge, a
  plain cache-hit composer call does **not** clear `seen_at`; a direct
  `getValueUnitSummary` SELECT confirms round-trip persistence. *Red proof:* clear
  `seen_at` in `readCached` → red.
- **`SEEN-6` — the inversion (T-D), deterministic, no timing.** Seed a row
  regenerated at `t1`. Run the production upsert to simulate the tick regenerating
  it to `t2` (`regenerated_at = t2`, `seen_at = NULL`). Then POST `/seen` with the
  **stale** `regenerated_at: t1` → `{updated: 0}`, `seen_at IS NULL` still, and the
  next composer read **still shows `updated_unseen`**. Then POST with `t2` →
  `{updated: 1}`, marker clears. **Plus the NULL leg:** a first-generation row
  (`regenerated_at IS NULL`) acknowledged with `regenerated_at: null` →
  `{updated: 1}`. *Red proofs (both recorded):* (i) drop `AND regenerated_at IS ?`
  from the statement → the stale-stamp leg red (marker silently lost — the slice's
  headline promise falsified); (ii) change `IS ?` to `= ?` → the NULL leg red
  (`{updated: 0}`, marker never dismissible on a first generation).
- **`SEEN-7` — `project_id` is advisory (T-K), BY DESIGN.**
  `it("/seen scopes by unit_key only — project_id is advisory (QA-DEC-4), BY DESIGN")`:
  a POST whose `project_id` names a different (valid, existing) project still
  stamps the key, and the route still 400s when `project_id` is absent or
  non-string. Comment: *"unit_key embeds the cwd, so cross-project collision is
  not reachable in practice; the contract is documented as advisory in docs/API.md.
  Do not half-fix this into a silent no-op — that would make dismissal fail
  invisibly. If real scoping is ever wanted, change the documented contract first."*

**Route logging (`ROUTE-SEAM-1`, kills T-F) — corrected, replacing `unit-tests.md` §2.5's bullet**
`it("POST /altitudes writes exactly one request-source log row whose four terms sum to the SUBMITTED batch size, even when sanitization drops units (T-F, §9.8)")`.
POST **N good units + 1 with a bogus `value_source` + 1 with no `unit_key`**.
Assert: exactly **one** new `value_summary_generation_log` row; `source='request'`;
`pool_size === units.length` (= N+2) **and** `=== counts.pool_size`;
`cache_hits + generated + queued + unavailable === pool_size` **exactly**;
`unavailable >= 2` (the two rejected units folded in);
`stale_regenerated` populated as a measured integer (`0` when none — **not NULL**;
NULL is reserved for pre-measurement rows, DEC-3); and on the wire, the union of
`altitudes` keys and `states` keys is exactly the set of **keyed** submitted units
(N+1), each appearing exactly once (the key-less unit has no key to appear under).
*Red proof:* log `counts` without the `droppedCount` fold (i.e. restore the plan's
`pool_size = units.length` with unadjusted terms) → the identity assertion red,
`N+1 !== N+2`. **Do not weaken this assertion if it goes red on day one — that
weakening is §9.3's event #1, on this same identity, one effort later.**

**e2e flow cases hosted in this file** (this file already owns the altitudes route
contract — extend it, do not fork a parallel route spec). Wrap the injected spawn
in a local `let spawnCount = 0`. One 3-unit batch reused across E1–E4:
`intake_initiative` A (stage `in_progress`), `intake_initiative` B, `trunk_commit` C.
- **`E1`** seed + cache hit: identical re-POST → 200, all 3 in `altitudes`, **zero
  spawns**, newest log row `source='request'`, `pool_size=3`, `cache_hits=3`,
  `generated=0`, `queued=0`, `unavailable=0`, `stale_regenerated=0` (a *measured*
  zero), identity exact.
- **`E2`** stage change regenerates exactly one: unit A now `"shipped"` → **exactly
  1 spawn**; A carries new text + `freshness:"updated_unseen"` +
  `update_reason:"stage_changed"` + `regenerated_at`; **B and C entries
  `deepEqual` their E1 entries** (this single assertion is the old-client shield)
  and `!("freshness" in entryB)`; log row `pool_size=3, cache_hits=2, generated=1,
  stale_regenerated=1`, identity exact. **Do not assert log/wire agreement for
  stale units — DEC-11.**
- **`E3`** acknowledge round-trip: `/seen` with `[{unit_key: A, regenerated_at}]` →
  `{updated:1}`; re-POST the batch → A has **no `freshness` key**, text unchanged,
  zero spawns; double-acknowledge → still 200.
- **`E4`** acknowledge-then-regenerate: change A's stage again → the marker
  **re-appears** with a fresh `regenerated_at` (G3's reset observed from outside).
- **`E5`** validation smoke: `/seen` 400s on a missing `project_id` and on an empty
  `units` array, with a structured error body. (The full matrix is `SEEN-3`.)
- **`E6`** tick→route handoff: import `runValueSummaryTickOnce` +
  `__injectPoolAssemblerForTest`; create a project **with** `stmts.insertProjectPath`
  (the tick only sweeps projects that have a `project_paths` row — the file's other
  `makeProject()` projects have none, which is the serial-safety argument for
  cohabiting with the tick; **state that in a comment**). Seed a mutable unit via
  the route at stage X; inject an assembler returning it at stage Y; run the tick.
  Assert newest log row `source='tick'`, `generated=1`, `stale_regenerated=1`; then
  POST `/altitudes` at stage Y → **zero spawns**, the tick's new text,
  `freshness:"updated_unseen"` on the route read. Reset the spawn seam
  (`__injectSpawnForTest(null)`) at the end.
- **`E7` — convergence two-step (T-H, closes WATCH-C's deterministic half).**
  Seed a cached row with snapshot B → POST `/altitudes` with stage **A** (the
  stale-tab shape, deterministically) → assert regeneration stamped A + a
  `source='request'` log row → run the tick with the pool at stage **B** → assert
  regeneration stamped B, marker present → **run the tick again with the pool
  unchanged at B → `generated = 0`, `cache_hits = pool_size`, zero broadcasts**
  (INV-10). *Red proof:* make the route's coercion asymmetric with the assembler's
  (`stage ?? ""`) → the two paths ping-pong and the third step's `generated = 0`
  goes red. This is the case that turns WATCH-C's "converges" from asserted into
  verified.

### Layer 4 — Background sweep · `server/__tests__/value-summary-tick.test.js` (modify)

Reuse `__injectPoolAssemblerForTest`, `makeSweptProject`, `lastLogRow`,
`sweepState`. Seed cached rows through a direct `enrichPoolAltitudes` call
(production writer), then inject an assembler returning the (partially mutated) set.

- **`L1`** pool of 45 = 10 fresh-cached + 5 stale-cached + 30 uncached, LLM on,
  spawn resolves all 35 in-cap misses. Log row: `pool_size 45, cache_hits 10,
  generated 35, queued 0, unavailable 0`, and the four-term sum === `pool_size`.
  The sizing is deliberate: the wrong implementation (stale counted as hit **and**
  generated) reads `15+35=50` vs the correct `10+35=45` — numerically
  distinguishable. *Red proof:* count snapshot-stale served rows into `cache_hits`
  → sum 50 ≠ 45 → red.
- **`L2`** overlap counter bounded: `stale_regenerated === 5`, and
  `stale_regenerated <= generated + queued + unavailable` asserted as a general
  invariant; the tick passes it through (row value not NULL — NULL is legacy-only).
  L1's mutation also perturbs this — record both outcomes.
- **`L3`** drains through the **shared** read path, **three ticks**:
  - tick 1, all-cached-fresh pool → zero broadcasts (extend the existing
    broadcast-discipline test, don't duplicate it), log `generated 0`;
  - swap the assembler for one returning the same pool with **one** unit's stage
    changed; tick 2 → exactly one broadcast, `unit_keys` = that one key, log row
    `cache_hits = pool-1, generated = 1, stale_regenerated = 1`, and
    `pending_after_sweep === 0` (stale ≠ pending);
  - **tick 3, inputs unchanged → `cache_hits = pool_size, generated = 0,
    stale_regenerated = 0`, zero broadcasts (INV-10, the loop detector).** One
    cheap case that closes **three** risks at the seam where they present
    identically: T-G's fake-legacy infinite regeneration, residual DEC-7
    normalization drift, and any comparator asymmetry — all of which otherwise
    show up only as silent, unbounded LLM spend.
  *Red proofs:* (i) remove the comparator gate in `readCached` → L3 red **and the
  same mutation must also turn D3 red** — the **co-red proof**; if L3 goes red
  while D3 stays green (or vice versa) one path is not going through the shared
  read path: **investigate before repairing anything**; (ii) make the write path
  store raw `unit.label` (so a resolved-fallback label writes NULL) → **tick 3**
  red with `generated = 1` forever (T-G caught in the act).
- **`L4` — tick counting sourced from `counts` (DEC-14):** the tick's log row
  equals the composer's `counts` field-for-field for the L1 fixture (no hand-rolled
  loop remainder). *Red proof:* re-introduce a local counting loop in the tick that
  diverges by one (skip `queued`) → identity red.

### Layer 5 — Process-grain boot bucket (new files)

Both files: `DASHBOARD_DB_PATH` set to a unique temp path (`Date.now()`-`pid`
pattern) **before any `require` of server code**; build the legacy tables with raw
`better-sqlite3` (same try/`compat-sqlite` resolution `db-migration.test.js` uses)
from the **pre-slice CREATE bodies verbatim** at `55fe900` (`db.js:826-832`,
`1822-1835`); close the handle; then `require("../index")` →
`createApp()`/`startServer(app, 0)`. Both need the file-overview header + the exact
`@author Son Nguyen <hoangson091104@gmail.com>` line
(`bash .claude/skills/file-headers/scripts/check-headers.sh` must stay 0).
**Both must also assert `require("../db").DB_PATH === tmpPath`** as the first
assertion — the positive control described in §Single-source-of-truth below.

**`server/__tests__/value-summary-legacy-boot.test.js` (new)** — seed the
`resumeJobPipelineTracker` row (`intake_initiative::2026-08-03-job-pipeline-tracker::<cwd>`,
text *"The job pipeline tracker is built and being tested"*), one `trunk_commit::`
row, one legacy log row.
- **`B1`** clean boot + columns present: no throw; `PRAGMA table_info` shows the
  five new `value_unit_summaries` columns and `stale_regenerated`; the legacy rows
  read **NULL** in every new column (log row NULL, **not 0** — DEC-3 at the boot
  surface).
- **`B2`** legacy mutable row is stale over HTTP: POST `/altitudes` with the resume
  unit at its **current** stage/label (values that would compare "fresh" if anyone
  had implemented backfill-on-migrate) → **one spawn**, new text replaces the
  seeded sentence, `freshness:"updated_unseen"`, request log row `generated=1`,
  `stale_regenerated=1`. DEC-9 proven at the API.
- **`B3`** legacy `trunk_commit` row is fresh: same POST → served cached, zero
  additional spawns, **no `freshness` key** (PO AC-1 as restated by DEC-6).

**`server/__tests__/value-summary-interrupted-boot.test.js` (new)** — the
whole-app-graph half of T-E, deliberately duplicating `M1-INT` one layer up
because §9.6's acceptance criterion is about `require()`'s blast radius, and
`db-migration.test.js`'s require-cache surgery covers `../db` alone.
- **`B4`** seed the legacy `value_unit_summaries` **plus an `input_stage` column
  only** (and one row with a non-null `input_stage`), then boot the real app:
  `startServer` resolves (no throw escaping `require("../index")`); all five columns
  present; the pre-existing `input_stage` data survived; a `POST /altitudes`
  against the booted app returns 200. *Red proof:* restore the plan's original
  single-probe five-ALTER `db.exec` block → the boot throws `duplicate column name`
  and this file cannot even reach its first assertion. **Record that output — it
  is the executable record of why A-1 exists.**

### Layer 6 — Client · vitest

**`client/src/components/__tests__/PlanLedgerPanel.test.tsx` (modify)** — extend the
existing file (`makeUnit`/`makePlan` factories, `vi.mock("../../lib/api")`, real
`en` strings). Add `markAltitudesSeen: (...args) => mockMarkSeenMock(...args)` to
the api mock.
- **`C1`** marker distinct from every other state **in the same render** (§9.8's
  combined-render mandate). One response with 5 units: (a) resolved fresh (no
  freshness fields), (b) resolved `updated_unseen` + `stage_changed` +
  `regenerated_at`, (c) resolved `updated_unseen` + `label_changed`, (d) `states`
  queued, (e) `states` unavailable. Assert: the stage-changed copy renders exactly
  once; the label-changed copy exactly once; **(b)/(c) ALSO render their
  regenerated text** (the marker rides alongside, never replaces); "Queued"/"Not
  available" counts unchanged from today's conventions; the existing
  no-raw-key-leak assertion (`/planLedger\.[a-zA-Z]/` absent from
  `document.body.textContent`) now also covers the marker. *Red proof:* disable the
  marker branch in `ValueUnitRow` → C1 red.
- **`C1b`** stale freshness never blanks old text — **loop `ALTITUDE_FRESHNESS`,
  do not hand-type three cases (§9.7)**: for each member, an entry with old text +
  that freshness renders the **text** (not the Queued/Not-available placeholder)
  plus its hint copy, in the same render as a `queued` and an `unavailable` unit.
  *Red proof:* route stale-freshness entries into the placeholder branch → red
  (this is the tempting implementation — mapping `stale_refresh_unavailable` to the
  altitude string `"unavailable"` — and `AltitudeText` renders the placeholder for
  **any** string altitude, verified).
- **`C2`** explicit acknowledge, exactly once, no refetch, never auto-on-render
  (DEC-8). (a) after render with an `updated_unseen` unit,
  `expect(mockMarkSeenMock).toHaveBeenCalledTimes(0)` — **rendering alone never
  acknowledges**; (b) click the per-unit "×" → called once with
  `("proj-1", [{unit_key, regenerated_at}])` (per A-5), marker disappears,
  `mockAltitudesMock` still `calledTimes(1)` (no refetch); (c) **"dismiss all" at
  burst scale (T-J's mitigation, tested not assumed):** 60 unseen units + 5 seen +
  5 fresh → **one** call whose payload is exactly the 60 unseen
  `{unit_key, regenerated_at}` pairs. *Red proofs:* double-fire the handler →
  (b)'s exactly-once red; acknowledge in the load effect → (a) red; dismiss-all
  looping one call per unit → (c) red.
- **`C3`** compat + degradation + registry honesty.
  (a) **Old-server response** (entries with no freshness fields; plus the
  no-`states`-key response the existing "missing from the altitudes response" test
  uses) → renders exactly today's output: no marker, no warn, resolved text as-is.
  (b) **Unknown freshness value** `"bogus_freshness"` → text still renders, no
  marker, no placeholder, exactly one `console.warn` naming the value and the unit
  id.
  (c) **The existing out-of-registry `states: "bogus"` test stays green and its
  fixture stays bogus** — assert in this spec that `"bogus"` is in neither the
  states list nor the freshness list the component recognizes.
  (d) **NEW — unknown `update_reason` → generic copy, never the raw key (T-C leg 3,
  INV-8).** An entry with `freshness:"updated_unseen"` and
  `update_reason:"something_changed"` renders the `updatedGeneric` copy (A-6), and
  `document.body.textContent` matches **no** `/planLedger\.[a-zA-Z]/`.
  *Red proof:* implement the map as naive `t(mapReason(reason))` with no `default`
  arm → the literal `planLedger.pool.altitudes.updatedSomethingChanged` renders →
  (d) red. `regen_reason` deliberately has no CHECK ("future reasons stay
  additive"), so this is a *when*, not an *if*.
- **`C-registry`** the hand-typed registries move together (WATCH-E/F): the
  component's hand-typed state list (`PlanLedgerPanel.tsx:558`) is still exactly
  `["queued","unavailable"]` (DEC-3: gained nothing), and the component's
  freshness→i18n-key map covers exactly
  `["stale_refresh_queued","stale_refresh_unavailable","updated_unseen"]`, and the
  reason→key map has a `default` arm. This is the client-side pin of the fourth
  hand-copied registry.

**`client/src/pages/__tests__/screens.snapshot.test.tsx` (regenerate, never blind)**
— the marker is an intentional Project Detail change: review the diff, confirm it
shows **only** marker/dismiss additions, then `cd client && npx vitest run -u`.

**`client/src/i18n/__tests__/i18n.test.ts` (no edit)** — E1.1 derives ko/vi/zh
parity from `en` mechanically; adding the **seven** keys to `en` is what arms it.

**Server-side registry→locale test** (extend the existing
`describe("i18n registry → locale")` in `value-summary.test.js`): for every member
of `ALTITUDE_FRESHNESS` and every `update_reason` (`stage_changed`,
`label_changed`) **plus the generic fallback**, the mapped key exists under
`planLedger.pool.altitudes.*` in `en/projectDetail.json`
(`stale_refresh_queued → staleRefreshQueued`,
`stale_refresh_unavailable → staleRefreshUnavailable`,
`stage_changed → updatedStageChanged`, `label_changed → updatedLabelChanged`,
plus `updatedGeneric`, `dismiss`, `dismissAll`). The snake→camel map is written
**once** here and must match the component's map (pinned by `C-registry`).
*Red proof:* delete `updatedStageChanged` from `en/projectDetail.json` → red (and
`i18n.test.ts` E1.1 red for the other locales if only they lag).

### Fixtures / test data (consolidated)

- **`resumeJobPipelineTracker`** (D5, M1 `it 4`, B2, manual walkthrough): unit_key
  `intake_initiative::2026-08-03-job-pipeline-tracker::<cwd>`, stakeholder text
  *"The job pipeline tracker is built and being tested"*, snapshot columns NULL,
  current stage `"built"`.
- **Mixed-mutability pool:** existing `unit()` helper with `value_source`/`stage`
  overrides. Mutable = `intake_initiative` / `detour` / `merge_commit` (include one
  `merge_commit` leg in D3's rotation — DEC-6 behaviorally pinned, not just
  registry-pinned); immutable = `trunk_commit` only.
- **L1 sizing:** 45 = 10 fresh + 5 stale + 30 uncached, cap 40 — chosen so correct
  (45) and broken (50) sums differ numerically.
- **Mid-crash migration fixture** (`M1-INT`, `B4`): legacy CREATE body **plus
  `input_stage TEXT` only**, with one row carrying a non-null `input_stage`.
- **Malformed request fixture** (`ROUTE-SEAM-1`): N good + 1 bogus `value_source` +
  1 key-less.
- **Seeding rule:** the production write path for every cached row except the
  deliberately-legacy raw inserts. Sweep-level claims (L3, E7) change stage via the
  injected pool assembler's returned units — the production shape the tick consumes.
- **Env:** `DASHBOARD_DB_PATH` per spec block that `require`s `../db`;
  `DASHBOARD_FOCUS_INFER_MODE=heuristic` for LLM-down legs; throwing spawn stub for
  zero-spawn assertions.

---

## Implementation steps

Dependency-ordered; each independently checkable; each new test states what makes
it fail before the fix and pass after. **Never batch guards at the end**
(DEPENDENCY-3). Steps map onto `technical-plan.md` §4 step numbers where they
exist.

1. **Environment gate (BLOCKING, DEPENDENCY-1).** `ps -eo pid,etime,command | grep -i claude`
   and `lsof ~/.claude/agent-dashboard/dashboard.db` **before any git operation**;
   fresh worktree from `55fe900`; `npm run setup`; back up the live DB; main
   checkout's dirty paths byte-identical afterwards. Record the **per-file**
   baseline (78 = 25/21/10/22, plus focus-summary 21, chronology 6, PlanLedgerPanel
   14, snapshots 19, i18n 76), **not** the plan's blanket 77.
   *Checkable:* `git log -1` in the worktree; baseline suite green before any edit.
2. **Step 1.5** — copy the request tree onto the branch and commit, including this
   `qa/` folder and `qa/decisions.md`, **before the first line of build code**.
3. **`A2` scan first, red against the untouched substrate.** Write the scan with
   all nine assertions and both derived identifiers. *Red before:* `buildPrompt` at
   `value-summary.js:84-88` reads `u.stage` / `u.label || u.value_ref` /
   `u.value_source`, so (b), (g) and (h) fail. *Green after:* Step 8 below. Do not
   proceed past this step with the scan unwritten — it is the never-traded-away item.
4. **`addColumnsIfMissing` (A-1)** in `db.js` + `MIG-HELPER-1..4`.
   *Red before:* the helper does not exist — the tests fail to resolve it;
   after writing the helper, remove its `try/catch` → `MIG-HELPER-2` throws instead
   of returning `false` → red; restore → green.
5. **Schema (Step 2 a/b/c/e/f/g)** — comment rewrite (must **enumerate the input
   set and name `unitFacts()`**), both CREATE bodies, the two `addColumnsIfMissing`
   call sites, the widened `upsertValueUnitSummary` (incl. `seen_at = NULL` in
   `DO UPDATE SET`), `markValueUnitSummariesSeen` **with the `AND regenerated_at IS ?`
   predicate (A-5)**, `insertValueSummaryGeneration`'s 11th param.
6. **`HELPER-CASE-SCAN` + `ALTER-BLOCK-SCAN` + six `UPGRADE_CASES` entries (A-2).**
   *Red before:* write the scans **before** adding the six entries → `HELPER-CASE-SCAN`
   red naming every unregistered `table.column`; add the entries → green. Then
   temporarily restore the plan's original raw five-ALTER block → `ALTER-BLOCK-SCAN`
   red **and** `HELPER-CASE-SCAN` red on scope; revert; byte-identical; green.
7. **`M1` it 1-4, `M1-INT` (it 5), `M2` it 1-3.** *Red before / green after* per the
   two red proofs on `M1-INT` (single-probe-on-`input_label` → `duplicate column
   name` out of `require()`; probe-on-`input_stage` → four columns missing) and
   `M2 it 1` (`NOT NULL DEFAULT 0` → the NULL assertion red). Trace the early-return
   chain in `it 4` before trusting its red.
8. **Step 4 + Step 5** — `MUTABLE_VALUE_SOURCES` export; `unitFacts()`;
   `buildPrompt` refactored to read it only. *Green after:* step 3's `A2` scan.
   Then run **all eight `A2` mutations individually**, recording each red output,
   plus the comment green-proof, each reverted byte-identical (`git diff --stat`
   empty). Update `W-4`'s `absent` lists in the same commit.
9. **Step 6** — `compareUnitInputs` + gated `readCached`; write `A1` (U1–U4,
   T1–T11) and `D1`–`D5b` alongside. *Red before:* each named mutation
   (label-blind → T3/T8; precedence swap → T4; `input_stage`-as-legacy → T7 **and**
   D5b; drop the mutable gate → D1(b); A3's write/check divergence → D2;
   `if (false)` the mismatch branch → D3; stage-only compare → D4 **while D3 stays
   green**; backfill-on-migrate → D5 **and** M1 it 4).
10. **Step 7** — freshness on resolved entries, the R3 re-homing rule, `counts`
    **including the `droppedCount` fold (A-3)**. Write `R3`, `Case 5`, `Case 6`,
    both combination cases, `COUNTS-SHAPE`, `COUNTS-DROPPED`, `DEC-11-ANTIFIX`, `D6`.
    *Red before:* drop re-homing → R3; S6 dup bug → Case 5; ignore `droppedCount` →
    `COUNTS-DROPPED`; count stale-served as `cache_hits` → `DEC-11-ANTIFIX` leg (b);
    drop stale from `altitudes` → `DEC-11-ANTIFIX` leg (a); skip/always-stamp
    `regenerated_at` → D6(a)/D6(c).
11. **Step 8** — tick reads `counts`. Write `L1`, `L2`, `L3` (three ticks), `L4`.
    *Red before:* stale-into-`cache_hits` → L1 (50 ≠ 45); comparator gate removed →
    L3 **co-red with D3** (if only one goes red, stop and investigate); raw
    `unit.label` at the write site → L3 tick 3; divergent local counting loop → L4.
    Existing 21 tick tests must stay green **genuinely** — if AC-1/AC-2/T-C/S6 go
    red, fix the composer, never the tests.
12. **Step 9** — `POST /altitudes/seen` (CAS statement + validation) and
    request-path logging that writes `counts` verbatim. Write `SEEN-1..7` and
    `ROUTE-SEAM-1`. **Run `W-2` unmodified first and record the red**, then widen in
    the same commit, then take `W-2`'s post-widen fresh red proof. Write `W-3` with
    both its red proofs. Confirm **`W-1` is still exactly 1** — if it is red, the
    design was violated; fix the product.
    *Red before:* unadjusted `counts` with submitted `pool_size` → `ROUTE-SEAM-1`;
    drop `AND regenerated_at IS ?` → `SEEN-6` stale-stamp leg; `IS ?`→`= ?` →
    `SEEN-6` NULL leg; remove `seen_at = NULL` from `DO UPDATE SET` → `SEEN-4`;
    clear `seen_at` in `readCached` → `SEEN-5`.
13. **Step 10** — `P1` + `P2`. *Red before:* route coerces missing `stage` to `""`.
14. **e2e flows** — `E1`–`E7` in `value-summary.test.js`. *Red before:* `E7`'s
    asymmetric-coercion mutation makes step 3's `generated = 0` red; `E2`'s sibling
    `deepEqual` goes red if freshness churns onto unchanged units.
15. **New boot files** — `value-summary-legacy-boot.test.js` (`B1`–`B3`) and
    `value-summary-interrupted-boot.test.js` (`B4`), each asserting
    `require("../db").DB_PATH === tmpPath` first. *Red before:* `B4` cannot boot at
    all under the plan's original migration block — record that output.
16. **Step 11 — client**, in order: `types.ts` → `api.ts`
    (`markAltitudesSeen(projectId, units)`, per A-5) → `PlanLedgerPanel.tsx`
    (`ValueUnitRow` marker + per-unit "×" + panel-level dismiss-all;
    **explicit acknowledgement only**) → i18n **seven** keys in all four locales.
    Write `C1`, `C1b`, `C2(a-c)`, `C3(a-d)`, `C-registry`. *Red before:* each named
    mutation, especially C3(d)'s no-`default`-arm map.
17. **Snapshots** — review the Project Detail diff (marker/dismiss additions only),
    then `cd client && npx vitest run -u`. Never blind-update.
18. **`decisions.md` on the branch** — the QA rows (`QA-DEC-1..11`) mirrored as the
    intake file's `DEC-17..DEC-26`, plus WATCH-C's amendment, plus WATCH-B's
    measured burst size and DEC-4's red-proof record filled in at Step 12 of the
    plan. **Zero trap-table rows may remain prose-only.**
19. **Docs & catalog** — `update-project-docs` for `docs/API.md` (the `/seen`
    contract **with the A-5 payload and the advisory `project_id` note**),
    `docs/DATABASE.md`, `server/README.md`, `ARCHITECTURE.md`; the catalog notes
    from `qa-assessment.md` §"Catalog notes" applied **verbatim, on-branch**
    (§9.5, §9.8, §9.1, and the optional CONTRACT-SPEC-DRIFT one-liner, which is
    **not** optional given QA-DEC-3's decline);
    `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
20. **Full verification + manual walkthrough** (§How to run, §Definition of Done).

---

## Single-source-of-truth guardrail

This project has canonical registries that drive multiple rendered outputs, and
this slice adds two more. **Tests assert the rendered paths agree with the
registry; no test may bless a hand-edited path that bypasses it.**

1. **`UPGRADE_CASES` ← `db.js`'s actual DDL.** The migration meta-test derives its
   obligation **per `table.column`**, not per ALTER block — that is exactly the
   misreading that would have shipped the meta-test red on four columns. With A-1's
   helper the raw-ALTER regex stops seeing this slice's DDL, so `HELPER-CASE-SCAN`
   re-derives the obligation from the **helper call sites' own object literals**.
   Six pairs in the source ⇒ six entries in the registry, mechanically. Never
   satisfy either scan by adding a `GRANDFATHERED` row — both scans' failure
   messages say so, and `ALTER-BLOCK-SCAN`'s registry is an **exact set** so an
   orphan row fails too.
2. **`ALTITUDE_STATES` / `ALTITUDE_FRESHNESS` ← `server/lib/value-summary.js`.**
   `Case 6` imports the registry and `deepEqual`s it; every `freshness` value in
   any fixture is validated through the **import**, never a hand-typed list; `C1b`
   **loops the registry** rather than enumerating three cases. The four client
   hand-copies (`Altitude` union arm, `api.ts` response type, the `:558` state
   list, the i18n key set) are §9.7's *accepted* CJS/Vite exception (WATCH-E/F) and
   carry three compensating pins — `Case 6` (server), the registry→locale test
   (locale), `C-registry` (client). If a fifth copy appears anywhere, that is a
   WATCH-F promotion, not a new pin.
3. **i18n keys ← `en`.** `i18n.test.ts` E1.1 derives ko/vi/zh parity from `en`
   mechanically; the server-side registry→locale test derives the required key set
   from `ALTITUDE_FRESHNESS` + the reason vocabulary. Nobody hand-lists keys twice.
4. **`MUTABLE_VALUE_SOURCES` ← `server/lib/value-ledger.js`**, one home, imported
   (never re-listed), with `assertSingleHome` dispositions at both consumers.
5. **The prompt's input set ← `unitFacts()`.** `A2` is the guardrail: the *only*
   way to get a unit field into the prompt is to add it to `unitFacts`, where the
   comparator sees it too. Adding a field to `buildPrompt` directly must be
   physically impossible to ship green.
6. **`DASHBOARD_DB_PATH` — a positive control, not a grep.** Every server spec this
   plan touches or creates asserts `require("../db").DB_PATH === <its temp path>`
   (`db.js:118`/`3214` — `DB_PATH` is exported). A per-file grep is a
   proven-invalid sweep (§9.3, 2026-08-03); an in-process equality assertion is not.

---

## Durable-cure decision

**Adding the structural cures now — all three, plus the two point-level cures.
This is not a "point tests only" build.**

| Cure | Call | Why |
|---|---|---|
| **DC-1 `addColumnsIfMissing` + `ALTER-BLOCK-SCAN` + `HELPER-CASE-SCAN`** | **BUILD NOW** (A-1/A-2, QA-DEC-9) | This is §9.6's own winning move (`rebuildTableAtomically` + `REBUILD_CASES` grandfathering) applied to the additive-migration population. This slice would otherwise be the **6th** hand-rolled non-atomic multi-column block, and it is the largest in the file. Deferring means the plan's Step 2.4 physics ship, and the point fix ("probe per column here") leaves the next author to remember — §9.6's history says instances 2 and 3 are exactly how the non-atomic population came to exist. Cost ≈ one afternoon; it retires a latent hazard on **five already-shipped sites** at the same time. |
| **DC-2 one owner for the request-path partition** | **BUILD NOW, in its cheap form** (A-3, QA-DEC-7) | The strategist's P0-2 (fold at the route) fixes the arithmetic; folding **inside the composer** via `droppedCount` costs one optional parameter and removes the second derivation entirely, which is the class. Inapplicability over compliance (§9.6's 2026-08-02 lesson, proven twice). |
| **A2 strong structural scan** | **BUILD NOW — never traded away** (A-4, QA-DEC-8) | Nine assertions, two derived identifiers, eight mutations each observed red, comment green-proof, evasion #8 dispositioned in the scan's own comment. A build that ships this without observed reds **is the cure regressing**. |
| **`/seen` compare-and-set** | **BUILD NOW** (A-5, QA-DEC-1) | One predicate + one deterministic test; the alternative silently falsifies the slice's headline promise, which OPEN-1 has already reduced once. Two reductions of one promise, one of them undisclosed, is not acceptable. |
| **`updatedGeneric` fallback key** | **BUILD NOW** (A-6, QA-DEC-10) | `regen_reason` has no CHECK by design, so a raw-key leak is a *when*, not an *if*, and the change brief lists "no unresolved-boundary-token leak" as an invariant. |
| **DC-3 the trap-id reconciliation as a required artifact** | **DONE HERE; belongs in the `team-qa` skill** | §T below is the artifact. It has now been independently re-derived five times; the build's only obligation is that **zero rows end as prose**. |
| **TEST-AGAINST-LIVE-DB class-level cure** (a runner-level failure when `DASHBOARD_DB_PATH` is unset) | **DEFER — 3rd decline, recorded** (QA-DEC-6) | A process-start env check is structurally wrong here: specs legitimately set the variable *inside* the block before requiring `../db`, which is precisely why the per-file grep is invalid. The correct cure is a refusal inside `db.js` when running under test, which is a product change to the boot path in a slice already carrying DDL, a new writer and a guard widening. **Consequence of deferring, stated:** any future spec that requires `../db` without setting the path still migrates Sara's live DB, and nothing fails loudly. Compensating control adopted now: the `DB_PATH` positive assertion (guardrail 6). Promotion triggers unchanged. |
| **OpenAPI fragment for `/altitudes/seen`** | **DECLINE — recorded** (QA-DEC-3) | **Consequence, stated:** `openapi.yaml` — the artifact the repo declares the source of truth for request/response contracts — will omit the new endpoint and the widened altitude entry schema, and `openapi-contract.test.js` will **stay green over the omission** because its scan is mount-level and `/api/project-plans` is already mounted. That scope limit is written into the catalog as part of this build (§9.7's shape inside CONTRACT-SPEC-DRIFT's own cure). If a second artifact drifts, or a consumer is built against the stale spec, the candidate promotes. |

---

## T. Trap-coverage reconciliation (the trip-wire — all 13 legs, zero prose)

Per `risk.md` §7's own rule, adopted from the sibling run's QA-DEC-4: **every id
ends as a named spec file + case id, or a dated `decisions.md` row, or both.
Prose-only is a failure of this pass.** The strategist found 4 covered / 1
mis-covered / 1 partial / **7 prose-only / 0 rows**. After this plan:

| Id | Sev | Terminates in (spec file + case id) | `decisions.md` row | State |
|---|---|---|---|---|
| **T-A** | High | `value-summary.test.js` → `DEC-11-ANTIFIX` (both partitions, one fixture, one `it()`, titled BY DESIGN) + `L1` | — | **CLOSED (test)** |
| **T-B** #1–7, #9 | High (meta) | `single-writer-guard.test.js` → `A2` assertions (a)–(i), mutations M-A2-1..8 + comment green-proof | QA-DEC-8 (strong form adopted; weak form rejected; new evasion class #9) | **CLOSED (test + row)** |
| **T-B #8** | — | out of a lexical scan's reach by construction; backstops `A2-HOME`, `P1`/`P2`, `L3` tick 3 | QA-DEC-8 (disposition written **into the scan's own comment**, per §9.1's "one call frame away" lesson) | **CLOSED (row + comment)** |
| **T-C leg 1** (freshness routed through the state path) | Med-high | `PlanLedgerPanel.test.tsx` → `C1`, `C1b` (**registry-looped**, all three members) | — | **CLOSED (test)** |
| **T-C leg 2** (unknown freshness) | Med-high | `PlanLedgerPanel.test.tsx` → `C3(b)` | — | **CLOSED (test)** |
| **T-C leg 3** (unknown `update_reason` → raw i18n key leaks) | Med-high | `PlanLedgerPanel.test.tsx` → **`C3(d)`** + the extended registry→locale test | QA-DEC-10 (7th key `updatedGeneric`, 4 locales; OPEN-4 copy list grows) | **CLOSED (test + row)** |
| **T-D** (blind `/seen` stamp marks the new generation seen) | Med | `value-summary.test.js` → **`SEEN-6`** (both legs, deterministic, no timing) | QA-DEC-1 (CAS adopted; payload ripple enumerated) | **CLOSED (test + row)** |
| **T-E** (non-atomic 5-column ALTER) | **Critical** | `db-migration.test.js` → **`M1-INT`**, `MIG-HELPER-1..4`, `ALTER-BLOCK-SCAN`, `HELPER-CASE-SCAN`; `value-summary-interrupted-boot.test.js` → **`B4`** | QA-DEC-9 (DC-1 now; 5 sites grandfathered with dated reasons) | **CLOSED (product amendment + tests + row)** |
| **T-F** (route log breaks the four-term identity) | High | `value-summary.test.js` → **`ROUTE-SEAM-1`** + `COUNTS-DROPPED`; `unit-tests.md` §2.5's defective assertion **corrected here, not carried** | QA-DEC-7 (DC-2 form: composer owns the fold) | **CLOSED (product amendment + tests + row)** |
| **T-G** (fake-legacy NULL label ⇒ regenerates forever) | Med | `value-summary-tick.test.js` → **`L3` tick 3** (+ its raw-`unit.label` red proof); D3's `input_label`/`regen_reason` NOT-NULL legs | — | **CLOSED (test)** |
| **T-H** (WATCH-C convergence claim unverified) | Med-low | `value-summary.test.js` → **`E7`** (route → tick → quiesce) | QA-DEC-2 (WATCH-C amended: convergence **verified**; only the timing half remains watched) | **CLOSED (test + row)** |
| **T-I** (`/altitudes/seen` absent from OpenAPI) | Low-med | — (deliberately no test; the built contract guard is mount-level and cannot see it) | QA-DEC-3 (decline recorded + the mount-level blind-spot note added to the catalog) | **CLOSED (row + catalog note)** |
| **T-J** (first-upgrade marker flood, ~182 markers) | Low | `PlanLedgerPanel.test.tsx` → **`C2(c)`** dismiss-all at burst scale (60 unseen → one call) | QA-DEC-5 (accepted as one-time noise; no suppression — it would weaken D5/D6 symmetry; one sentence into OPEN-4) | **CLOSED (row + test of the mitigation)** |
| **T-K** (`/seen` ignores `project_id`) | Low | `value-summary.test.js` → **`SEEN-7`** (advisory, BY DESIGN, titled so nobody half-fixes it) | QA-DEC-4 (advisory; documented in `docs/API.md`) | **CLOSED (test + row)** |
| *(non-trap)* TEST-AGAINST-LIVE-DB | — | `DB_PATH` positive assertion in every touched/new server spec | QA-DEC-6 (3rd decline recorded) | **CLOSED (row + control)** |

**13 of 13 trap legs terminated. 0 prose-only. 11 dated `decisions.md` rows.**

---

## How to run

From `CLAUDE.md` (no `PROJECT-CONTEXT.md` stack section is configured; commands
verified against `package.json`). **Every command below runs in the effort
worktree — never the main checkout.**

```bash
# Per-spec, server (env prefix is defense-in-depth; each spec also sets
# DASHBOARD_DB_PATH in the block that requires ../db, and now asserts DB_PATH)
DASHBOARD_DB_PATH=/tmp/slice1-vs.db    node --test server/__tests__/value-summary.test.js
DASHBOARD_DB_PATH=/tmp/slice1-tick.db  node --test server/__tests__/value-summary-tick.test.js
DASHBOARD_DB_PATH=/tmp/slice1-mig.db   node --test server/__tests__/db-migration.test.js
DASHBOARD_DB_PATH=/tmp/slice1-guard.db node --test server/__tests__/single-writer-guard.test.js
DASHBOARD_DB_PATH=/tmp/slice1-boot.db  node --test server/__tests__/value-summary-legacy-boot.test.js
DASHBOARD_DB_PATH=/tmp/slice1-int.db   node --test server/__tests__/value-summary-interrupted-boot.test.js
DASHBOARD_DB_PATH=/tmp/slice1-chron.db node --test server/__tests__/chronology-ordering.test.js   # must stay 6/6

# Per-spec, client
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
cd client && npx vitest run src/i18n/__tests__/i18n.test.ts
cd client && npx vitest run -u          # snapshots — ONLY after reviewing the diff

# Full gates
npm run test:server
npm run test:client
bash .claude/skills/file-headers/scripts/check-headers.sh

# Manual (required by CLAUDE.md, real Google Chrome)
npm run dev && open -a "Google Chrome" <project-detail-url>
```

Must stay green untouched: `focus-summary.test.js` (21/21 — the digest-gating
precedent), `chronology-ordering.test.js` (6/6 — verify **after** the migration
lands; a red there means the wrong probe idiom was used),
`openapi-contract.test.js`, the prior effort's AC-1/AC-2/T-A/T-C/B2 tick cases,
`value-ledger.test.js`, `i18n.test.ts` (76/76 + the new keys).

---

## Definition of Done

**No row below is ticked on an agent's self-report** (§9.3 AGENT-SELF-REPORTED-RED).
Every "red-proven" claim is unverified until the injection is re-run by a second
pass or the guard's body is read directly. A repair of any failed red proof needs
its own fresh red proof (VACUOUS-REPAIR). **The only technique that reliably
worked across the prior effort's eight §9.3 events: revert the product change, run
the actual shipped spec file, watch the named assertion go red, revert, confirm
`git diff --stat` is empty, rerun green.** Use that one.

**Gating (the BLIND verdict does not clear without all three)**
- [ ] **A-1** — Step 2.4 replaced by `addColumnsIfMissing` (per-column probe, one
      transaction, catch-log-continue, cannot throw out of `require()`); this slice
      is its first call site; the five pre-existing blocks grandfathered with dated
      reasons and the scan **not** weakened.
- [ ] **A-1/A-2** — `M1-INT` and `B4` both exist and were each observed red under
      **both** failure orderings (single-probe-on-`input_label` → `duplicate column
      name` escaping `require()`; probe-on-`input_stage` → four columns silently
      missing). Both red outputs pasted into the build report.
- [ ] **A-2** — **six** `UPGRADE_CASES` entries; `HELPER-CASE-SCAN` and
      `ALTER-BLOCK-SCAN` green with **no new `GRANDFATHERED` rows** and an exact-set
      block registry.
- [ ] **A-3** — the route logs `counts` verbatim; the composer owns `droppedCount`;
      `ROUTE-SEAM-1` green with the four-term identity exact on a batch containing a
      bogus `value_source` **and** a key-less unit; `unit-tests.md` §2.5's
      `pool_size === units.length` with unadjusted `counts` was **not** carried
      forward anywhere in the shipped specs (grep the diff to confirm).
- [ ] **A-4** — `A2` ships with all nine assertions, both identifiers **derived
      from source**, all **eight** mutations observed red individually (each output
      recorded), the comment green-proof observed green, and evasion #8's
      disposition written into the scan's own comment.

**Trip-wire (the sibling run's line, and this project's 4th attempt at it)**
- [ ] **Zero rows in §T end as prose.** Every one of the 13 trap legs is either a
      named spec file + case id or a dated `decisions.md` row (11 of them are rows).
- [ ] `qa/decisions.md` `QA-DEC-1..11` exist on the effort branch and are mirrored
      into the intake `decisions.md` as `DEC-17..DEC-26` + the WATCH-C amendment.
- [ ] Any scope declined **during** the build that is not already covered by
      `OPEN-1..4` / `WATCH-A..G` / `QA-DEC-1..11` gets its own row **before** the
      build closes.

**Red proofs, per test (not as a blanket sentence)**
- [ ] Every case in the Test change set carrying a named mutation was observed RED
      before and GREEN after, **individually**, with the actual assertion output
      recorded in the build report — including the pairwise proofs that must move
      together: `D3`/`D4` (stage-only compare → D4 red **while D3 green**),
      `L3`/`D3` (comparator gate removed → **both** red; if only one, stop and
      investigate the shared read path before repairing anything), `T7`/`D5b`,
      `D5`/`M1 it 4`, `DEC-11-ANTIFIX` (red in **both** directions),
      `SEEN-6` (red on **both** the CAS predicate and the `IS ?` NULL leg),
      `D6` (red in **both** directions).
- [ ] `W-2`'s deliberate red was **observed and its output recorded** before the
      widening, the widening is an exact `deepEqual` set, and the widened guard has
      its own **fresh** post-widen red proof.
- [ ] `W-1` is still exactly **1** and its stripper now strips `/** */`; its red
      proof was re-taken **after** the Step 6/7 refactor moved code.
- [ ] `W-3` red-proven in both directions; `W-4`'s tripwire fired on the new
      exports and was updated in the same commit.

**Behavior, schema, client**
- [ ] `A1` U1–U4 + T1–T11 all present, table-driven with per-row messages.
- [ ] `D1`–`D6`, `D5b`, `P1`, `P2`, `R3`, `Case 5`, `Case 6`, both combination
      cases, `COUNTS-SHAPE`, `COUNTS-DROPPED`, `DEC-11-ANTIFIX` green.
- [ ] `SEEN-1..7` green; the `/seen` statement carries `AND regenerated_at IS ?`;
      `seen_at = NULL` lives **only** inside `upsertValueUnitSummary`'s
      `DO UPDATE SET`, never as a caller's second UPDATE.
- [ ] `L1`–`L4` green; **`L3` runs three ticks** and tick 3 asserts
      `cache_hits = pool_size, generated = 0, stale_regenerated = 0`.
- [ ] `E1`–`E7` green; `E2`'s sibling `deepEqual` (old-client shield) green; `E7`'s
      third step quiesces.
- [ ] `B1`–`B4` green; every new spec file carries the file header + the exact
      `@author` line.
- [ ] The **four-term** identity is asserted in its corrected form everywhere it
      appears (composer, tick, route, e2e) — four terms, `stale_regenerated` as an
      overlap counter and **never** a fifth term (WATCH-A). Grep the diff for any
      five-term sum.
- [ ] `ALTITUDE_STATES` gained nothing; `MUTABLE_VALUE_SOURCES` includes
      `merge_commit` and is behaviorally pinned by D3's rotation; `trunk_commit`
      behavior byte-for-byte unchanged (`D1`, `B3`).
- [ ] `C1`, `C1b`, `C2(a-c)`, `C3(a-d)`, `C-registry` green and red-proven; marker
      copy from i18n keys only; acknowledgement **explicit**, never auto-on-render;
      **seven** keys in all four locales; `i18n.test.ts` green.
- [ ] Snapshot diffs **reviewed** (marker/dismiss additions only) and then
      regenerated — never blindly.

**Suite, docs, catalog**
- [ ] `npm run test:server` and `npm run test:client` fully green in the worktree;
      per-file counts recorded against the **corrected** baseline
      (78 = 25/21/10/22, plus 21/6/14/19/76).
- [ ] `chronology-ordering.test.js` still 6/6 with no new grandfathering (verified,
      not assumed); `openapi-contract.test.js` green **and its mount-level scope
      limit recorded** rather than read as coverage.
- [ ] Vacuity sweeps at zero: `grep -rn "assert.ok(true" server/__tests__/`,
      `grep -rn "|| true" server/__tests__/`, no zero-assertion bodies, no fixtures
      that don't construct what their comments claim (count them programmatically).
- [ ] `db.js:821-825` and `value-summary.js`'s header rewritten **in the same
      diff**; the replacement comment **enumerates the input set and names
      `unitFacts()`**; the "ONE lexical writer" claim narrowed to the synthesis
      columns.
- [ ] `update-project-docs` run for `docs/API.md` (incl. the A-5 payload and the
      advisory `project_id`), `docs/DATABASE.md`, `server/README.md`,
      `ARCHITECTURE.md`; `check-headers.sh` exits 0.
- [ ] The **catalog notes from `qa-assessment.md` are applied verbatim, on the
      effort branch, at the build's catalog step** — §9.5 (multi-column
      how-to-comply + the durable cure), §9.8 (the route-seam re-derivation), §9.1
      (4th planning-document occurrence), and the CONTRACT-SPEC-DRIFT scope-limit
      line (now required, since QA-DEC-3 declines the fragment). **Do not fork the
      catalog; do not edit the dirty main checkout.**
- [ ] **Manual Resume walkthrough completed in real Google Chrome**: stale text
      renders → stage changed **through the production mutation path** (not a DB
      poke) → text regenerates with the *"updated — stage changed"* marker →
      acknowledge clears it → reload keeps it cleared → a
      `value_summary_generation_log` row records the invalidation → a neighbouring
      `trunk_commit` unit's text did **not** change and burned no spawn → a separate
      boot against a **copy of a pre-slice DB** starts clean with no `SQLITE_ERROR`.
      **The real regeneration-burst size observed and written into WATCH-B.**
