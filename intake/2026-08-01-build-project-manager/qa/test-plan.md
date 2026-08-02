# Test Plan — build-project-manager (layers 4–6)

> Authored by `qa-lead`, 2026-08-01, synthesizing `change-brief.md` +
> `supporting/coverage.md` + `supporting/risk.md` + `supporting/unit-tests.md` +
> `supporting/e2e-tests.md` + `qa-assessment.md` (verdict: **GAPPED**, five
> must-adds). This is the QA deliverable: exactly what tests to add/modify, in
> what order, with what assertions. It does not re-derive the investigation —
> read `qa-assessment.md` for *whether* coverage is adequate; read this for
> *what to build* to make it so.
>
> **Framing:** nothing is built yet. Baseline is clean and green
> (`npm run test:server` → 1087 pass / 0 fail, 250 suites). Every spec named
> below is red-by-construction today (module-not-found), so "red-first" here
> means something sharper than that: each assertion is stated with the
> *specific plausible-but-wrong implementation* it fails against.
>
> **One path, not a menu.** Where the unit and e2e architects disagreed or
> left a check homeless, this document makes the call and says so inline.

---

## Objective

Add the server-side test coverage that makes Layers 4–6 safe to ship: pin the
three new derived computations (`pace.js`, `detours.js`'s `DISPOSITIONS`,
`plan-writeback.applyDisposition`) to exactly one implementation each, prove
the unattended `AGENT-PLAN.md` write path cannot corrupt, forge, or lose a
human's bytes, and — the part that does not exist today at all — make three
structural invariants **mechanically enforced** rather than review-enforced:
(1) `plan_items` has exactly one writer and `applyDisposition` exactly one
write-composer, enforced by an executable meta-test instead of a manual grep;
(2) every "recent N" query over a bulk-inserted table sorts by `created_at`
before `LIMIT`, enforced by a static SQL-shape scan plus behavioural
out-of-order fixtures on all five new queries; (3) the `ALTER TABLE` upgrade
path actually executes in a test — for the first time in this repo's history,
where 35 `ALTER TABLE` statements have shipped with zero test executions
between them. End state: the human-resolve route and the reconciliation tick
are proven to emit **byte-identical** plan-file content for identical inputs
(§9.1's own acceptance criterion, made executable for the first time), the
timestamped backup that the entire §7 rollback story depends on is proven to
land on disk, and a future third write-composer or a future unordered lookback
query fails a test instead of shipping silently.

---

## Coverage gap being closed

Each row is an UNGUARDED surface from `qa-assessment.md` / `coverage.md` §2,
tied to this project's defect-catalog id where one applies.

| # | UNGUARDED surface | Catalog id | Assertion that now pins it |
|---|---|---|---|
| G1 | `plan_items.target_date` **`ALTER` upgrade path** — and, transitively, all 35 `ALTER TABLE` statements in `server/db.js`, none of which has ever been executed by a test | *(new class — proposed §9.3, not added unilaterally; see Durable-cure decision)* | `db-migration.test.js` builds a **pre-existing old-shape DB file on disk**, re-opens it through a cache-busted `require("../db")`, and asserts the column now exists, reads `NULL` on legacy rows, and `stmts.setPlanItemTargetDate` runs against a legacy row without throwing. Plus a registry meta-test: every `ALTER TABLE … ADD COLUMN` in `db.js` must have an upgrade case or be in a frozen grandfather list. |
| G2 | The **write-sequence** form of DERIVED-DUAL-VIEW: nothing asserts the human-resolve route and the reconciliation tick produce the same bytes; the human-resolve route never does a real write in *any* planned test (unit §4c stubs it, e2e §4.2 stubs it, e2e §4.5 exercises only the reconciliation path) | **§9.1 DERIVED-DUAL-VIEW** (5th cycle; first change with the entry live and enforceable) | `reconciliation-full-tick.test.js` drives identical disposition inputs through the **real, unstubbed** `POST /api/detours/:id/resolve` write path in fixture cwd A and through the **real** `reconcileCwd` path in fixture cwd B, then asserts `AGENT-PLAN.md` bytes are identical modulo the minted `id:` value. |
| G3 | No structural guard against a **future** second `plan_items` writer / third write-composer. Today's mitigation is a manual grep at ship time; `unit-tests.md` §8's three grep gates do not include it | **§9.1 DERIVED-DUAL-VIEW** (write-path form) · `decisions.md` **WATCH-11** | `single-writer-guard.test.js` walks `server/**/*.js` (excluding `__tests__/`) and asserts: `upsertPlanItem` appears only in `db.js` + `plan-ingest.js`; `INSERT INTO plan_items` appears only in `db.js`; `appendPlanItem`/`appendSubItem` appear only in `plan-writeback.js`, exactly one call site each, both inside `applyDisposition`. |
| G4 | §9.2 ordering covered for 2 of 5 new queries. Missing: `listStaleResolvedDetours`, `listDecisionQueue`, and — worst — **Layer 6's detour-volume-ratio lookback**, where a chronology bug silently flags the *wrong sessions* while the suite stays green | **§9.2 row-id-as-chronology-proxy** (4th discovery site if missed) | `chronology-ordering.test.js`: a shared `assertOrderedByCreatedAt(seedFn, queryFn)` helper applied to all five queries (detour-volume lookback **first**), plus a **static SQL-shape scan** asserting every SQL literal in `server/` that selects from `events`/`focus_inferences`/`detour_dispositions`/`decision_queue` with a `LIMIT` has `ORDER BY created_at` *before* that `LIMIT`. |
| G5 | The timestamped backup under `<cwd>/.claude/agent-plan-backups/` — the whole of `technical-plan.md` §7's rollback story and `decisions.md` **WATCH-8** — has **zero** automated proof (zero occurrences of "backup" across both architect documents) | *(no catalog id — project invariant)* | `plan-writeback.test.js`: after a successful append, `fs.readdirSync(<cwd>/.claude/agent-plan-backups/)` is non-empty, the newest entry's content equals the **pre-write** file bytes, and its filename matches the timestamp pattern. Negative control: a `CAPS_EXCEEDED` rejection creates **no** backup. |
| G6 | `sanitizeLlmPlanText`'s newline definition is hand-rolled, not sourced from `plan-ingest.js`'s `/\r?\n/` — a future parser change silently un-covers the sanitizer | **§9.1** (line-boundary form) · **WATCH-11** second half | `plan-ingest.js` exports `LINE_SPLIT_RE`; `plan-writeback.js` imports it; `plan-writeback.test.js` parametrizes its boundary cases **off the exported constant**, not a copied literal. |
| G7 | `server/lib/atomic-file.js` — zero direct coverage today (`cc-mutate.js`'s primitive is exercised only indirectly through `cc-config.test.js`), promoted to dual-consumer shared infrastructure in the same change that extracts it | *(no catalog id)* | `atomic-file.test.js` unit-tests the primitive's failure paths, especially "failed `renameSync` leaves the original file untouched and no `.tmp` residue." |
| G8 | Everything net-new: `pace.js`, `detours.js`, `plan-writeback.js`, `reconciliation.js`, `detour_dispositions`, `decision_queue`, three routes, two CLI commands | *(no catalog id)* | The five new spec files + three extensions below, per `unit-tests.md` and `e2e-tests.md` as reconciled here. |

**Explicitly inherited, not closed:** `startReconciliation`'s bare
`setInterval` registration stays untested, consistent with its two siblings
`startFocusAudit`/`startFocusInference`. This is a **decision**, and
`reconciliation.test.js`'s file header must say so in words (see DoD).

---

## Test change set

This project has **one** server test layer — `node --test
server/__tests__/*.test.js`, flat files, `node:test` + `node:assert/strict`,
each file isolating itself with its own `process.env.DASHBOARD_DB_PATH` set
**before** `require("../db")` and its own `fs.mkdtempSync` work dir. There is
no e2e framework, no tag/bucket mechanism, and none is to be invented. The
groupings below are by *role within that one layer*, which is the real
structure here. Client and MCP layers are untouched this round (WATCH-3,
WATCH-6).

### A. Schema & migration (new role for this repo)

- **`server/__tests__/db-migration.test.js` — ADD (new file).** Generic
  upgrade-path harness. Must not `require("../index")`; it busts the `../db`
  require cache and must restore `DASHBOARD_DB_PATH` in `after()`.
  - Structure: an `UPGRADE_CASES` array, one entry per additive column this
    suite proves, each `{ table, column, legacySql, seed(db), assertLegacyRow(db), assertWritable(stmts) }`.
  - **Case 1 — `plan_items.target_date`:**
    1. Create a temp DB with `better-sqlite3` directly. Create a `plans` row
       and a `plan_items` table using **today's `CREATE TABLE` shape minus
       `target_date`** — i.e. it **must** include `item_id` and
       `parent_item_id` so the two table-rebuild migrations at
       `server/db.js:667` and `:734` are no-ops and the only migration under
       test is the new `try/SELECT/catch/ALTER` block. Insert one legacy
       `plan_items` row. Close the handle.
    2. Point `DASHBOARD_DB_PATH` at that file, `delete
       require.cache[require.resolve("../db")]`, `require("../db")`.
    3. Assert `PRAGMA table_info(plan_items)` now includes `target_date`.
    4. Assert the **pre-existing** row reads `target_date === null` (not `""`,
       not a throw).
    5. Assert `stmts.setPlanItemTargetDate.run("2026-06-01", cwd, 1)` succeeds
       against that legacy row and reads back — this is the exact runtime
       failure a fresh-DB-only test cannot see.
    6. Re-`require` a second time: idempotent, no throw, still exactly one
       `target_date` column.
  - **Meta-test — `"every ALTER TABLE … ADD COLUMN in db.js has an upgrade
    case or is grandfathered"`:** read `server/db.js` as text, regex
    `/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/g`, and assert every captured
    `table.column` is either in `UPGRADE_CASES` or in a **frozen**
    `GRANDFATHERED` set snapshotted from today's tree. Failure message must
    read: *"New column migration `<t>.<c>` has no upgrade-path test. Add an
    `UPGRADE_CASES` entry — do not add to `GRANDFATHERED`."* Note in a comment
    that `db.js:866`'s templated `ADD COLUMN ${col}` is a known dynamic site
    already covered by the grandfather set.
  - *Red-first:* fails today because `target_date` does not exist (step 3);
    after Layer 5, fails against a migration block that is missing, typo'd, or
    wrapped so the `catch` never fires — every one of which a fresh-DB test
    passes. The meta-test fails the moment a future column is added without a
    case.

### B. Server lib unit specs

- **`server/__tests__/pace-tracking.test.js` — ADD (new file).** Implement
  `unit-tests.md` §1 as written: `isComplete` (4 cases incl. the pinned
  `checked` precedence), `paceStatus — no_target` (4 cases, each also
  asserting `status !== "behind"`), `on_track/behind` boundary block (6 cases,
  including the DEC-6 pin named verbatim `"target_date equal to today is
  on_track, not behind"` and the `graceDays` explicit/default pair),
  `completed items are exempt` (3 cases), `localDayString` local-vs-UTC
  boundary. Add the `PACE_STATUSES` registry-completeness meta-test from
  §1's "Registry-completeness note" — `pace.js` must export the array.
  - *Red-first:* fails against an implementation that treats
    `target_date === today` as `behind`, coerces a malformed date to
    `on_track`, or lets a completed item report `behind`.

- **`server/__tests__/atomic-file.test.js` — ADD (new file).** Implement
  `unit-tests.md` §2 as written (5 cases). Write this **before**
  `plan-writeback.test.js` so a broken primitive fails here, not inside a
  larger write-back test.
  - *Red-first:* the `t.mock.method(fs, "renameSync", …)`-throws case pins the
    safety claim that today lives only in a code comment
    (`cc-mutate.js:214-217`); an implementation that unlinks `.tmp` but
    truncates the target before renaming passes a naive "does it throw" check
    and fails this one.

- **`server/__tests__/plan-writeback.test.js` — ADD (new file).** Implement
  `unit-tests.md` §3a–§3f in full, with these four **changes**:
  - **(i) Import surface changes** — see the Durable-cure decision below.
    `plan-writeback.js` exports `sanitizeLlmPlanText`, `applyDisposition`,
    `__injectPreRenameHookForTest`, and `__testonly = { appendPlanItem,
    appendSubItem }`. §3a–§3d call the primitives through `__testonly`; §3e
    keeps calling `applyDisposition` with `__testonly` stubbed. No production
    file may reference `__testonly` (enforced by group E).
  - **(ii) NEW — backup-landed block (`qa-assessment.md` must-add #5, G5),**
    `describe("backup lands on disk — WATCH-8's automated half")`:
    | Test | Assertion |
    |---|---|
    | `"a successful append leaves exactly one timestamped backup whose content equals the pre-write file"` | capture `before = fs.readFileSync(planPath)`; append; `const entries = fs.readdirSync(path.join(cwd, ".claude", "agent-plan-backups"))` is length ≥ 1; newest entry's content `=== before` byte-for-byte; its filename matches `/\d{4}-\d{2}-\d{2}T[\d\-.]+/` (a sortable timestamp, not a bare counter) |
    | `"a CAPS_EXCEEDED rejection creates no backup"` | negative control — the backups dir is absent or unchanged after a rejected append (proves backups are taken on the write path, not on every call) |
    - *Red-first:* fails against an implementation that writes atomically but
      never snapshots — which is exactly today's design risk, since the backup
      is a side effect with no return value, so nothing else in the assertion
      surface points at it.
  - **(iii) §3c parametrized off the exported line-split constant (G6,
    WATCH-11 second half).** Add `LINE_SPLIT_RE` to `plan-ingest.js`'s
    `module.exports`; `plan-writeback.js` imports it instead of hand-rolling
    `\r`/`\n` collapsing. Add one case:
    `"every boundary plan-ingest's LINE_SPLIT_RE recognizes is neutralized by
    the sanitizer"` — build the adversarial inputs by joining with the
    delimiters the **imported** regex matches, never with a copied literal.
  - **(iv) Keep §3c's core instruction intact:** every sanitizer assertion is
    on the **parse-back through `parsePlanMarkdown`** of a fully composed
    block, not on the sanitized string — except the explicit cap cases, which
    assert on the sanitizer's direct return value and compare against the
    **imported** `MAX_*` constants, never re-typed literals.

- **`server/__tests__/detour-disposition.test.js` — ADD (new file).**
  Implement `unit-tests.md` §4a–§4f and §4i as written (registry-completeness
  meta-test for `DISPOSITIONS` incl. the `sqlite_master` `CHECK(...)`
  introspection; enum guard; write-status transitions with
  `applyDisposition` stubbed; deliberate/discard no-write; durability across
  re-inference; idempotency; route contract). **§4g moves out of this file**
  — see group E.

- **`server/__tests__/reconciliation.test.js` — ADD (new file).** Implement
  `unit-tests.md` §5a–§5d as written, with two **changes**:
  - **(i) §5a R2 gains a scrambled-insertion case.** `unit-tests.md` §5a's R2
    block is a ratio/session-count truth table with no out-of-order insertion
    anywhere. Add one case, `"R2 detour-volume ratio is computed over the
    created_at-ordered lookback window, not the id-ordered one"`, using the
    shared helper from group E. This is `qa-assessment.md` gap #4's worst
    instance — a chronology bug here changes an escalation *decision*.
  - **(ii) File header must state the accepted gap** in words:
    `startReconciliation`'s `setInterval` registration is untested by
    deliberate decision, consistent with `startFocusAudit`/
    `startFocusInference`; the tick body (`reconcileCwd`) is what these tests
    drive.
  - Keep §5a's `__injectSpawnForTest(() => { throw … })` installed in **every**
    rules test — that throw-on-call stub is what makes the
    hybrid-escalation-non-inversion invariant loud instead of subtle.

### C. Route & CLI contract (extensions to existing specs — do not fork)

- **`server/__tests__/plan-ingest.test.js` — UPDATE.** Add
  `it("preserves target_date across re-ingest, untouched by upsertPlanItem")`
  as a sibling of the existing `declared_done_*` survival test (~line 235),
  per `unit-tests.md` §1. Also add one export-surface assertion:
  `plan-ingest.js` exports `ID_LINE_RE`, `ACCEPTANCE_LINE_RE`,
  `DETAIL_LINE_RE`, `LINE_SPLIT_RE`, and the five `MAX_*` caps — so a future
  refactor cannot silently drop one `plan-writeback.js` depends on
  (`coverage.md` §1's flagged gap).
  - *Red-first:* the re-ingest test fails against the DEC-10-violating design
    where a `target:` line is parsed into `upsertPlanItem`'s
    `ON CONFLICT … SET` clause — that implementation resets `target_date` on
    every reformat, which this test catches by changing unrelated file content
    and asserting the value survives.

- **`server/__tests__/plans-api.test.js` — UPDATE.** Add
  `describe("POST /api/plans/items/target")` per `unit-tests.md` §1 and
  `e2e-tests.md` §4.1: happy path + `GET /api/plans/for-cwd` round trip;
  `target_date: null` clears to `null` (not `""`); table-driven `400` on
  `"2026-13-45"` / `"friday"` / `"2026-1-5"`; `404` unknown `item_number`;
  `400` missing cwd / non-positive-integer `item_number`; broadcasts the
  **existing** `plan_updated` type — assert no new message type was invented.

- **`server/__tests__/focus-inference.test.js` — UPDATE.** Add
  `unit-tests.md` §4h's four cases inside the existing `describe("inferSession")`.
  The load-bearing one is `"classification never writes AGENT-PLAN.md — file
  is byte-identical before/after an inferSession call that produces a
  detour"`; it is the structural proof that the classifier cannot reach
  `applyDisposition`.

- **`server/__tests__/ccam-cli.test.js` — UPDATE.** Add `e2e-tests.md` §4.4's
  two blocks (`focus target`, `decisions`) next to their existing siblings —
  **one CLI spec file only**, do not fork the `ccam(...)`/`ccamEnv(...)` spawn
  helpers. One addition beyond §4.4: assert the help/`commands`/REPL surface
  is **derived from `bin/ccam.js`'s `COMMAND_GROUPS`/`SUBCOMMANDS` registries**
  — i.e. iterate the registry and assert each entry appears in `ccam help`
  output, rather than extending a hand-typed word list. `risk.md` §1 names
  this triple-registration point as a §9.1-shaped trap at the CLI metadata
  layer; a registry-derived assertion catches a command registered in one of
  the three places and not the others.

### D. Full-chain pipeline

- **`server/__tests__/reconciliation-full-tick.test.js` — ADD (new file).**
  Implement `e2e-tests.md` §4.5 Scenario A (happy path, including the
  second-tick digest/dedupe assertions) and Scenario B (conflict/escalation,
  human's bytes intact byte-for-byte, `writeback_conflict` queue row, parked
  until an explicit human retry) exactly as written — only the outermost
  `claude -p` spawn seam is stubbed; `evaluateRules`,
  `classifyFlaggedDetours`, `applyDisposition`, `atomicWriteFile` and
  `ingestPlanForCwd` all run for real against a real `AGENT-PLAN.md` in a real
  `fs.mkdtempSync` cwd.
  - **NEW — Scenario C: cross-call-site byte parity (`qa-assessment.md`
    must-add #2, G2).** `describe("§9.1 cross-call-site: the human-resolve
    route and the reconciliation tick write identical bytes")`:
    1. Build **two** identical fixture cwds A and B (same plan file bytes,
       same ingested rows, same seeded `detour_dispositions` row content).
    2. Drive cwd A through `POST /api/detours/:id/resolve` with
       `disposition: "fold_in"` and the **real, unstubbed** write path — this
       is the first and only test in the whole suite where the human-resolve
       route performs a real write.
    3. Drive cwd B through `reconcileCwd` with the spawn stub returning the
       **same** verdict payload (same `proposed_text`,
       `proposed_acceptance`, `proposed_parent_item_id`).
    4. Normalize both files identically — replace the minted id value
       (`/\bid: [0-9a-f]{8}\b/g` → `id: <ID>`) and any absolute cwd path — then
       `assert.equal(normalizedA, normalizedB)`.
    5. Also assert both `detour_dispositions` rows land in the same state:
       `write_status === 'written'`, `resolved_item_id` non-null,
       `resolved_at` stamped.
    - *Red-first:* fails the instant either call site hand-composes any part
      of the "sanitize → dispatch → audit → retry → escalate" sequence instead
      of delegating to `applyDisposition` — different indentation, a different
      field order, a missing `acceptance:` line, a different truncation point,
      anything. A per-module test with the other side stubbed cannot fail for
      that reason, which is precisely why this check has no natural home and
      has to be assigned one.

### E. Structural / meta guards (new role for this repo)

- **`server/__tests__/single-writer-guard.test.js` — ADD (new file).** Pure
  source-scan, no DB, no HTTP. Walk `server/**/*.js` recursively, skipping
  `node_modules/`, `dist/`, and `server/__tests__/`. This is **WATCH-11's
  claimed mitigation, made executable** (`qa-assessment.md` must-add #3, G3).
  | Test | Assertion |
  |---|---|
  | `"upsertPlanItem has exactly one call site — plan-ingest.js"` | the set of scanned files containing `upsertPlanItem` equals exactly `{server/db.js, server/lib/plan-ingest.js}` (`db.js` defines the prepared statement, `plan-ingest.js` is the sole caller) |
  | `"no direct INSERT INTO plan_items outside db.js"` | the set of files whose source matches `/INSERT\s+INTO\s+plan_items/i` equals exactly `{server/db.js}` |
  | `"appendPlanItem / appendSubItem exist only inside plan-writeback.js"` | for each name, the set of files containing it equals exactly `{server/lib/plan-writeback.js}` |
  | `"each write primitive has exactly one call site, and it is inside applyDisposition"` | within `plan-writeback.js`'s source, `appendPlanItem(` / `appendSubItem(` each occur exactly once as a call expression (excluding the `function` declaration and the `__testonly` export object), and both occurrences fall inside `applyDisposition`'s body |
  | `"__testonly is never referenced by production code"` | no scanned file other than `plan-writeback.js` itself contains `__testonly` |
  - Every failure message must instruct the reader *not* to widen the
    allowlist: *"Do not add a file here. Route the write through
    `plan-writeback.applyDisposition()` — see DEC-14 and WATCH-11."*
  - *Red-first:* today the file is red because `plan-writeback.js` does not
    exist. After the build it is green, and it goes red again the moment any
    future bulk-resolve endpoint, MCP tool, or debug route hand-rolls a write
    — which is the failure this project has hit four times and which no other
    test in the suite can see.

- **`server/__tests__/chronology-ordering.test.js` — ADD (new file)** +
  **`server/__tests__/helpers/ordering.js` — ADD (new helper module).** The
  helper directory is safe: `test:server`'s glob is
  `server/__tests__/*.test.js`, so a `helpers/` subdirectory is never
  collected as a test file. This closes G4 (`qa-assessment.md` must-add #4).
  - **Helper API:** `assertOrderedByCreatedAt({ seed, run, expected, limit })`
    — `seed(db)` bulk-inserts rows whose `created_at` order **disagrees with**
    `id` order by construction (the later timestamp gets the lower id, cloning
    `focus-report.test.js`'s scrambled-insertion technique at ~line 370);
    `run()` executes the query under test with a `LIMIT` smaller than the row
    count; the assertion is that the returned set equals the
    `created_at`-ordered top-N, **not** the `id`-ordered one. Exporting this
    as a helper is `risk.md` trap #3's required mitigation — it lowers the
    cost of adding the regression test below the cost of skipping it.
  - **Behavioural cases, in this order (worst first):**
    1. `"Layer 6 detour-volume lookback selects the created_at-ordered window"`
       — **highest priority**; a bug here changes an escalation decision.
    2. `"listStaleResolvedDetours"` · 3. `"listDecisionQueue"` ·
    4. `"listPendingDetours"` · 5. `"backfillDeclaredDetours"`.
       (4 and 5 were already designed in `unit-tests.md` §4g — **move them
       here** so all five live behind one helper and one file, rather than two
       in `detour-disposition.test.js` and three nowhere.)
  - **Static SQL-shape scan — `"every LIMITed query over a bulk-inserted
    table orders by created_at before the LIMIT"`:** scan `server/db.js`,
    `server/lib/detours.js`, `server/lib/reconciliation.js`, and
    `server/routes/*.js` for SQL string literals that both select
    `FROM (events|focus_inferences|detour_dispositions|decision_queue)` and
    contain `LIMIT`; for each, assert `ORDER BY created_at` appears at a lower
    index than `LIMIT` in the same literal. Snapshot any pre-existing
    violations into a **frozen** `GRANDFATHERED_QUERIES` set with a comment
    dated today; assert the set does not grow. This is the ratchet that makes
    the durable cure real: a future R4 rule copy-pasting `ORDER BY id … LIMIT`
    fails a test without anyone remembering to write one.
  - *Red-first:* every behavioural case is deterministic-red against the naive
    `ORDER BY id` this catalog entry has already had to fix three times, since
    the fixture is built so the two orderings disagree.

### Fixtures / test data

Reuse, do not invent. Per `unit-tests.md` §7 and `coverage.md` §5:

- **Plan files:** reuse `plan-ingest.test.js`'s `writePlan()` /
  `fs.mkdtempSync(os.tmpdir())` pattern verbatim in every spec that touches
  `AGENT-PLAN.md` bytes. Do **not** hand-roll a second file-writing helper —
  named in both architect documents as a drift risk.
- **Pace fixtures:** the `item(overrides)` POJO helper (`unit-tests.md` §1).
- **LLM stubs:** copy `fakeSpawn()`/`fakeSpawnSequence()`/`envelope()` from
  `focus-summary.test.js` into `reconciliation.test.js` and
  `reconciliation-full-tick.test.js` (this repo's per-file copy convention).
  A real `claude` binary is never spawned.
- **Conflict window:** `__injectPreRenameHookForTest(() =>
  fs.writeFileSync(planPath, humanEdited))` **is** the fixture. No timers, no
  sleeps, no worker threads, no real filesystem races anywhere in this suite.
- **Out-of-order rows:** the scrambled-insertion technique, now behind
  `helpers/ordering.js` rather than copy-pasted per query.
- **Legacy DB shape:** built inline in `db-migration.test.js` (see A) — the
  only fixture in this plan that is a *file on disk representing a prior
  release*, and the reason G1 closes at all.
- **Env knobs:** each of the ten new `DASHBOARD_*`/`MAX_*` knobs gets one
  explicit-value test and one default-when-unset test, with `beforeEach`
  deleting the var — mirroring `focus-summary.test.js`'s existing pattern.

### Layer reconciliation — what I moved, and why

The unit and e2e architects each produced a good plan for their own layer; the
seams between them are where the gaps were. Four explicit calls:

1. **The human-resolve path's real write moves UP to the full-chain layer.**
   `unit-tests.md` §4c and `e2e-tests.md` §4.2 both stub it, so no test
   anywhere exercised it. It is now Scenario C in
   `reconciliation-full-tick.test.js`. Rationale: §9.1's acceptance criterion
   is explicitly cross-consumer ("not eyeballing two UIs"); a per-module test
   with the other consumer stubbed is structurally incapable of failing for
   the reason that matters. `detour-disposition.test.js` **keeps** its stub
   for the validation/permutation sweep — that split is correct.
2. **All chronology permutation coverage moves DOWN and sideways into one
   file.** `unit-tests.md` §4g's two cases leave
   `detour-disposition.test.js` and join the other three in
   `chronology-ordering.test.js`. Rationale: the systemic cause named in
   `qa-assessment.md` gap #4 is that the guarded-query list is enumerated by
   hand in prose and re-typed by hand into a test table; one file plus one
   helper plus a static scan is what stops that, and it is not achievable
   while the cases are scattered per-module.
3. **R2's ordering case is added at the unit layer, not the e2e layer.**
   Exhaustive permutation coverage belongs down; `e2e-tests.md` §6's hand-off
   boundary is respected — the full-tick spec still fixes one
   clearly-past-threshold case per rule and stays fast and legible.
4. **Nothing from `e2e-tests.md` §6's "deliberately left to the unit layer"
   list is duplicated up.** The sanitizer table, the retry/idempotency matrix,
   every threshold boundary, every kill-switch permutation, and
   `atomic-file.js`'s failure paths all stay unit-only. The full-chain layer
   proves the wiring, exactly twice (clean write, conflicted write) plus once
   for parity.

---

## Implementation steps

Sequenced in dependency order and aligned to the build's own Layer 5 → 4 → 6
ordering (DEC-3). Each step is independently checkable; each new test states
what makes it fail before and pass after.

1. **Baseline.** Run `npm run test:server`; confirm 1087/1087 on a clean tree.
   Record the number — every later step compares against it.
2. **Freeze the two grandfather sets.** Before writing any product code, run
   the two scans by hand (or as a throwaway script) and snapshot: (a) every
   `ALTER TABLE … ADD COLUMN` pair currently in `server/db.js` → `GRANDFATHERED`
   in `db-migration.test.js`; (b) every currently-violating `LIMIT`ed SQL
   literal over the four bulk-inserted tables → `GRANDFATHERED_QUERIES` in
   `chronology-ordering.test.js`. Both sets carry a dated comment and are
   never to be widened. *Checkable:* both sets are literal arrays in the spec
   files, with counts stated in the comment.
3. **Write `db-migration.test.js` (group A) — the `target_date` case only.**
   *Red before:* step 3's `PRAGMA table_info` assertion fails — the column
   does not exist. *Green after:* Layer 5's `try/SELECT/catch/ALTER` block
   lands in `server/db.js`. **Do not skip observing the red** — the entire
   point of this test is that a fresh-DB test would already be green here.
4. **Land Layer 5's schema half:** `target_date` in the `CREATE TABLE` +
   the sibling migration block + `setPlanItemTargetDate`. Re-run step 3's
   spec: green. Re-run `npm run test:server`: still 1087 + the new cases.
5. **Write `pace-tracking.test.js` (pure-function block) → land
   `server/lib/pace.js` incl. the exported `PACE_STATUSES`.** *Red before:*
   module-not-found, then the boundary/no_target/completed-exempt cases fail
   specifically against a `>` vs `>=` flip, a shape-only date validator, or a
   completed item reporting `behind`.
6. **Extend `plan-ingest.test.js`** with the `target_date`-survives-re-ingest
   case **and** the export-surface assertion (add `ID_LINE_RE`,
   `ACCEPTANCE_LINE_RE`, `DETAIL_LINE_RE`, `LINE_SPLIT_RE`, the five `MAX_*`
   to `plan-ingest.js`'s `module.exports` in this same step; this is an
   exports-only change, no behavior change). *Red before:* the exports do not
   exist and the column is not preserved. *Green after:* both.
7. **Extend `plans-api.test.js` → land `POST /api/plans/items/target`** and
   its OpenAPI entry. *Red before:* route 404s. Layer 5 complete.
8. **Write `atomic-file.test.js` → extract `server/lib/atomic-file.js`** from
   `cc-mutate.js:218-247` verbatim and re-point `cc-mutate.js` at it. *Red
   before:* module-not-found; the failed-`renameSync` case then fails against
   any implementation that touches the target before the rename. **Immediately
   after the extraction, before touching anything else, run `node --test
   server/__tests__/cc-config.test.js` in isolation** — it must pass unchanged
   (technical-plan step 11's named regression gate).
9. **Write `single-writer-guard.test.js` (group E) NOW, before
   `plan-writeback.js` exists.** *Red before:* the `appendPlanItem`/
   `appendSubItem` assertions fail on "expected exactly
   `{plan-writeback.js}`, got `{}`" — which is the correct red for a file
   that has not been written. *Green after:* `plan-writeback.js` lands with
   both primitives module-private behind `__testonly` and exactly one call
   site each inside `applyDisposition`. Writing this before the module is
   what makes the constraint shape the implementation rather than describe it
   afterwards.
10. **Write `plan-writeback.test.js` §3c (sanitizer) → land
    `sanitizeLlmPlanText`,** importing `LINE_SPLIT_RE` and the `MAX_*` caps
    from `plan-ingest.js`. *Red before:* module-not-found; then a sanitizer
    that only collapses newlines without stripping a leading field prefix
    fails the forged-`id:`/`acceptance:`/`detail:` **parse-back** assertions
    while passing a naive string check.
11. **Write `plan-writeback.test.js` §3a/§3b/§3d + the new backup block →
    land `appendPlanItem`/`appendSubItem`, the optimistic lock, the per-cwd
    mutex, the caps pre-flight, and the backup snapshot.** *Red before:* no
    module; then — a write-back that calls `upsertPlanItem` directly fails
    §3a's "the file contains the block **before** the ingest step runs"
    ordering; a missing optimistic lock fails every §3b case because
    `CONFLICT` never occurs; a cap check that runs after composing-and-writing
    fails §3d's byte-identical-after-rejection assertion; a write with no
    snapshot fails the new backup case.
12. **Land the `detour_dispositions` + `decision_queue` tables** (full final
    shape in the initial `CREATE TABLE`, per DEC-15/WATCH-4) **and write
    `plan-writeback.test.js` §3e/§3f → land `applyDisposition`.** *Red
    before:* the retry tests fail on exact call counts against an
    off-by-one loop (3 or 1 attempts instead of exactly 2); §3f's reverse
    query fails against the superseded `linked_plan_item_id` spelling holding
    an integer PK instead of `resolved_item_id` holding the stable `item_id`
    string.
13. **Write `detour-disposition.test.js` (§4a–§4f, §4i) → land
    `server/lib/detours.js` and `server/routes/detours.js`,** mount
    `/api/detours` in `server/index.js`. *Red before:* §4a's meta-test fails
    before any behavioural test runs if the JS `DISPOSITIONS` array and the
    SQL `CHECK(...)` list disagree.
14. **Extend `focus-inference.test.js` (§4h) → land the guarded `try/catch`
    hook** after `upsertFocusInference.run(...)`. *Red before:* the
    byte-identical-plan-file assertion is the guard; the fail-safe case fails
    against a hook that is not actually wrapped.
15. **Write `chronology-ordering.test.js` + `helpers/ordering.js` (group E),
    detour-volume lookback case first,** covering all five queries plus the
    static SQL-shape scan. Write the detour-volume case **before**
    `reconciliation.js`'s R2 exists, so the query is written against a red
    test. *Red before:* deterministic red against `ORDER BY id`, because the
    fixtures are built so the two orderings disagree.
16. **Write `reconciliation.test.js` (§5a–§5d, incl. the R2 scrambled case and
    the file-header decision note) → land `server/lib/reconciliation.js`,
    `server/routes/decision-queue.js`,** mount the route and start the
    scheduler inside its own `try/catch` in `startBackgroundServices()`. *Red
    before:* the throw-on-call spawn stub makes any LLM call from inside
    `evaluateRules` fail immediately; the "only ever called with what
    `evaluateRules` flagged" case fails an implementation that passes *all*
    pending detours to the LLM even though every verdict-mapping test still
    passes; the two-tick re-run case fails a missing `findOpenQueueItem`
    guard.
17. **Extend `ccam-cli.test.js`** with the two new command blocks and the
    registry-derived help assertion → land `focus target` and `decisions` in
    all three registration points (`COMMAND_GROUPS`, `SUBCOMMANDS`, help).
    *Red before:* a command registered in one place but not the others fails
    the registry-derived assertion, not just the happy-path spawn.
18. **Write `reconciliation-full-tick.test.js` Scenarios A and B.** *Red
    before:* nothing is wired end to end; after, Scenario B's
    "human's bytes intact byte-for-byte" is the single highest-stakes
    assertion in the suite.
19. **Write Scenario C — cross-call-site byte parity (G2).** Do this **last**
    among the tests, because it requires both call sites real. *Red before:*
    fails against any divergence in composed output between the route path and
    the tick path. *Green after:* both delegate to `applyDisposition`.
20. **Full-suite gate + audits.** `npm run test:server` green (baseline 1087 +
    all new cases, 0 failures); `bash
    .claude/skills/file-headers/scripts/check-headers.sh` exits 0 (eight-plus
    new `.js` files, each needing the `@author Son Nguyen
    <hoangson091104@gmail.com>` header); `npm run test:client` green and
    untouched.
21. **Run the three stale-assertion grep gates** from `unit-tests.md` §8 once
    at the end: `grep -rn "linked_plan_item_id" server/` → zero hits;
    `grep -rn "plan_items row count is unchanged" server/__tests__/` → zero
    hits tied to `fold_in`/`new_item` (DEC-12 residue); and both injection
    seams actually referenced in their specs. These stay manual — they are
    one-time cleanup checks, not invariants, and the invariants that *do*
    need permanence are now in group E instead.
22. **Docs + `decisions.md` close-out.** Correct `plan-ingest.js`'s header
    claim that "the dashboard never writes it" and every downstream repetition
    in `ARCHITECTURE.md` / `docs/API.md` / `docs/DATABASE.md` /
    `server/README.md` (DEC-8 item 4). Flip **WATCH-11** from
    "test-plan mitigation applied" to a concrete citation of
    `server/__tests__/single-writer-guard.test.js` and the `LINE_SPLIT_RE`
    coupling, now that both exist. Add a line to WATCH-8 pointing at the new
    backup assertion.
23. **DEC-7 live-trial gate — not automatable, not optional.** A green suite
    is explicitly *not* sign-off. Sara reviews real decision-queue output and
    the actual unattended text written into her real `AGENT-PLAN.md` files
    against her real fleet, and confirms backups are landing under
    `<cwd>/.claude/agent-plan-backups/`. Precedent: `18196dc` ("Remove the WIP
    queue feature," reverted two days after shipping).

---

## Single-source-of-truth guardrail

This project has several canonical sources that drive multiple rendered
outputs, and this plan asserts the rendered paths agree with each — never
blesses a hand-edited path that bypasses one:

- **`AGENT-PLAN.md` → `plan_items`.** `ingestPlanForCwd` is the *only* writer,
  including for the dashboard's own content. Tests assert the round trip
  (file bytes → real re-ingest → row indistinguishable from a human-typed
  item, §3a), and `single-writer-guard.test.js` makes the "only" mechanical:
  `upsertPlanItem` has exactly one call site, `INSERT INTO plan_items` exists
  only in `db.js`. **No test may assert a `plan_items` row into existence
  directly as a shortcut for a write-back outcome** — that would bless the
  bypass this whole design exists to prevent. (Direct seeding of
  `detour_dispositions` rows is fine and expected; that table has no
  single-writer invariant.)
- **`applyDisposition` as the sole write-composer.** Scenario C asserts the
  two rendered outputs (route path, tick path) are byte-identical, which is
  §9.1's own stated acceptance criterion; the meta-test asserts no third
  composer can exist.
- **`DISPOSITIONS` (JS) ↔ `CHECK(disposition IN (...))` (SQL).** §4a's
  `sqlite_master` introspection asserts the two agree exactly, order-
  independent — the JS array is the registry, the SQL is a rendered path.
  Same shape for `write_status`'s five-value `CHECK`.
- **`PACE_STATUSES`.** Every enum value must be exercised by a case; a 5th
  status cannot ship uncovered.
- **`plan-ingest.js`'s regexes and `MAX_*` caps.** `plan-writeback.js` imports
  them; the sanitizer tests compare against the **imported** constants, never
  re-typed literals — so a cap change in the parser cannot silently
  de-synchronize the writer.
- **`bin/ccam.js`'s `COMMAND_GROUPS`/`SUBCOMMANDS`.** The CLI help assertion
  iterates the registry rather than a hand-typed word list.
- **`server/db.js`'s `ALTER TABLE` statements.** The migration meta-test
  treats the db.js source itself as the registry and asserts every entry has
  an upgrade case or is explicitly grandfathered.
- **The §9.2 guarded-query set.** The static SQL-shape scan derives the guard
  from the source rather than from a prose list re-typed into a test table —
  the direct cure for `qa-assessment.md` gap #4's stated systemic cause.

---

## Durable-cure decision

**Call: take the structural cure now, in full.** Four of the five must-adds
*are* the structural cure rather than point tests, and all four are cheap:
the generic migration harness (G1), the single-writer meta-test (G3), the
shared ordering helper + static SQL scan (G4), and the `LINE_SPLIT_RE`
coupling (G6). They are steps 3, 9, 15 and 10 above, and none of them requires
redesigning anything the tech lead has planned.

**On `appendPlanItem`/`appendSubItem`: keep them out of the public API, but
expose them to tests through a `__testonly` namespace — and enforce that with
the meta-test.** I agree with `risk.md` and the strategist that a future third
caller must have no low-level function to reach for, and I disagree only about
the mechanism. Reasoning:

- A plain non-export is strictly stronger *only* if nothing else enforces the
  boundary. We are shipping `single-writer-guard.test.js` in the same change,
  which fails on any reference to these names — or to `__testonly` — from any
  non-test file under `server/`. With that meta-test present, `__testonly` and
  a hard non-export are **equally enforced** against product code.
- The cost of a hard non-export is real and lands on the highest-stakes tests
  in the plan. `unit-tests.md` §3a–§3d exercise *file mechanics*:
  `NO_PLAN_FILE` never synthesizing a plan, byte-identical-after-
  `CAPS_EXCEEDED` rejection, the same-cwd mutex serializing two concurrent
  appends, the trailing-slash mutex-key hazard, the pre-rename hook window.
  Routing all of those through `applyDisposition` forces every case to seed a
  `detour_dispositions` row and reason about audit-column side effects, which
  makes the file-mechanics assertions noisier and, in the mutex cases,
  genuinely harder to express. Weakening the coverage of the write primitive
  to protect against a misuse that a meta-test already catches is a bad trade.
- `__testonly` also carries the intent in the name at the call site, which a
  reviewer sees before a test runs — and it matches this repo's established
  `__injectSpawnForTest` / `__injectPreRenameHookForTest` seam convention, so
  it needs no new idiom.

**Consequence if the meta-test is ever deleted or weakened:** `__testonly`
degrades to a naming convention and this decision becomes wrong. So the
meta-test is not optional garnish — it is the half of this decision that does
the work, and step 9 deliberately writes it *before* `plan-writeback.js`
exists so the constraint shapes the module rather than being retrofitted.

**WATCH-11 is now accurate as written — no rewording needed.** Its two claimed
mitigations both land here, verbatim: (a) "a registry-style meta-test …
asserting there is exactly one call site of `plan-writeback`'s internal write
primitive in `server/`" → `server/__tests__/single-writer-guard.test.js`,
group E, step 9; (b) "a sanitizer test that asserts against `plan-ingest.js`'s
exported regex constants directly rather than a hand-copied pattern" →
`plan-writeback.test.js` §3c change (iii), step 10, with `LINE_SPLIT_RE` added
to `plan-ingest.js`'s exports in step 6. Step 22 updates the row to cite the
actual file paths instead of the phrase "applied in `test-plan.md`", so the
claim points at code rather than at a document. **If any of steps 6, 9, or 10
is dropped, WATCH-11 must be reopened as "PENDING, mitigation not yet
designed" in the same commit** — do not let a WATCH row stay closed against a
test that was cut.

**Deferred deliberately, with the consequence stated:**

- **`PROJECT-CONTEXT.md` §9.3 for migration/upgrade-path blindness — not added
  here.** The catalog's own criterion is "rediscovered more than once" and
  this class has zero observed live occurrences. The *mechanical* cure ships
  regardless (step 3's meta-test), so the class is now guarded whether or not
  it earns a catalog entry. This stays Sara's one-word call; the consequence
  of never adding it is only that future readers lose the narrative, not the
  guard.
- **`startReconciliation`'s `setInterval` wiring stays untested,** consistent
  with `startFocusAudit`/`startFocusInference`. Consequence: a
  registration-only bug (wrong interval, service never started) ships
  undetected by tests, exactly as it would for its two siblings. Accepted —
  but it must be written down in `reconciliation.test.js`'s header so it reads
  as a decision, not an oversight (step 16, DoD).
- **`risk.md` trap #4's standalone cross-table consistency check**
  (`decision_queue.status='resolved'` ⇒ its linked `detour_dispositions` row
  is not `pending`) is covered inline by `unit-tests.md` §5c's transaction
  tests for today's single-row paths, but not as a standalone invariant a
  future *bulk* path would trip. Consequence: a later "dismiss all pace
  alerts" action could diverge the two tables silently. Accepted this round;
  the natural home is a sixth entry in `chronology-ordering.test.js`'s
  structural sibling if a bulk path is ever added.

---

## How to run

`PROJECT-CONTEXT.md` configures no bespoke test stack; these are the project's
real commands, from `CLAUDE.md` and `package.json`.

```bash
# Full server suite — the required gate before and after every layer
npm run test:server

# One spec while iterating (node's built-in runner, no framework)
node --test server/__tests__/db-migration.test.js
node --test server/__tests__/pace-tracking.test.js
node --test server/__tests__/atomic-file.test.js
node --test server/__tests__/plan-writeback.test.js
node --test server/__tests__/detour-disposition.test.js
node --test server/__tests__/reconciliation.test.js
node --test server/__tests__/reconciliation-full-tick.test.js
node --test server/__tests__/single-writer-guard.test.js
node --test server/__tests__/chronology-ordering.test.js

# Narrow to one describe block while iterating
node --test --test-name-pattern="cross-call-site" \
  server/__tests__/reconciliation-full-tick.test.js

# Named regression gate — immediately after the atomic-file.js extraction,
# in isolation, before touching anything else (technical-plan step 11)
node --test server/__tests__/cc-config.test.js

# Client — must stay green and untouched (zero client changes, WATCH-3)
npm run test:client

# File-header audit — eight-plus new .js files need the @author header
bash .claude/skills/file-headers/scripts/check-headers.sh

# MCP — not required this round (WATCH-6, no MCP surface)
```

---

## Definition of Done

- [ ] Each new test observed **RED before** the corresponding product code and
      **GREEN after** — recorded per step, not assumed. Steps 3, 9, 15 and 19
      in particular must be observed red first; each of them is a test whose
      whole value is that a naive equivalent would already be green.
- [ ] `npm run test:server` green: **1087 baseline + all new cases, 0
      failures**, and no previously-passing test was modified to make a new
      one pass.
- [ ] `node --test server/__tests__/cc-config.test.js` passed **unchanged**
      in isolation immediately after the `atomic-file.js` extraction.
- [ ] `npm run test:client` green; `git status` shows **zero** client file
      changes attributable to this effort (WATCH-3).
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] **G1** — `db-migration.test.js` executes a real `ALTER` against a
      pre-existing on-disk DB (not a fresh `CREATE TABLE`), asserts the legacy
      row reads `NULL`, and asserts `setPlanItemTargetDate` runs against it.
      Its `GRANDFATHERED` set is frozen with a dated comment and was not
      widened.
- [ ] **G2** — Scenario C passes: the human-resolve route and the
      reconciliation tick produce byte-identical `AGENT-PLAN.md` content modulo
      the minted `id:`. The human-resolve route now performs a **real,
      unstubbed** write in at least one test.
- [ ] **G3** — `single-writer-guard.test.js` passes with its allowlists at
      their intended values: `upsertPlanItem` ∈ {`db.js`, `plan-ingest.js`};
      `INSERT INTO plan_items` ∈ {`db.js`}; `appendPlanItem`/`appendSubItem`/
      `__testonly` ∈ {`plan-writeback.js`}; exactly one call site each, inside
      `applyDisposition`. No allowlist was widened to make it pass.
- [ ] **G4** — all five §9.2 queries have an out-of-order-insertion test
      behind the shared `assertOrderedByCreatedAt` helper, detour-volume
      lookback included; the static SQL-shape scan passes and its
      `GRANDFATHERED_QUERIES` set did not grow.
- [ ] **G5** — the backup assertion passes: a successful append leaves a
      timestamped backup whose content equals the pre-write file; a rejected
      append leaves none.
- [ ] **G6** — `plan-ingest.js` exports `LINE_SPLIT_RE`; `plan-writeback.js`
      imports it; no sanitizer test contains a hand-copied newline or cap
      literal.
- [ ] **Registry / source-of-truth in sync:** `DISPOSITIONS` ≡ the SQL
      `CHECK`; `write_status`'s five values ≡ its `CHECK`; `PACE_STATUSES`
      fully exercised; `focus target`/`decisions` present in all three
      `bin/ccam.js` registration points and asserted registry-derived; every
      new route present in `server/openapi-extra/misc.js`.
- [ ] `reconciliation.test.js`'s file header states the accepted, inherited
      `setInterval`-wiring gap in words.
- [ ] The three stale-assertion grep gates return zero hits
      (`linked_plan_item_id`; DEC-12 "row count unchanged" residue; both
      injection seams referenced).
- [ ] `plan-ingest.js`'s "the dashboard never writes it" header claim and every
      downstream repetition in `ARCHITECTURE.md`, `docs/API.md`,
      `docs/DATABASE.md`, `server/README.md` are corrected (DEC-8 item 4).
- [ ] `decisions.md` **WATCH-11** updated to cite
      `server/__tests__/single-writer-guard.test.js` and the `LINE_SPLIT_RE`
      coupling by path — **or**, if any of steps 6/9/10 was cut, reopened as
      "PENDING, mitigation not yet designed" in the same commit. WATCH-8 gains
      a pointer to the new backup assertion.
- [ ] **DEC-7 live-trial gate satisfied** — Sara has reviewed real
      decision-queue output and the actual unattended text written into her
      real `AGENT-PLAN.md` files, and confirmed backups are landing on disk. A
      green suite is explicitly not sign-off for this change.
