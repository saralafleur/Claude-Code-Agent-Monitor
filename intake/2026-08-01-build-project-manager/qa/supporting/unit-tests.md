# Unit / Parity Test Design — build-project-manager (Layers 4-6)

Author: `qa-unit-architect` · 2026-08-01
Inputs: `intake/2026-08-01-build-project-manager/qa/change-brief.md`,
`technical-plan.md` (incl. its 2026-08-01 Layer 4 revision), and the
team-intake `supporting/qa.md` (incl. its Layer 4 REVISION section). This
document does not re-derive those — it turns their guidance into exact
spec files, exact `it()` names, and exact assertions an implementer can
write from without cross-referencing `decisions.md` DEC numbers to know
what to assert. Where I depart from or sharpen the prior guidance, I say so
inline.

Stack (confirmed from existing specs, no test-stack section in
`PROJECT-CONTEXT.md`): server = `node:test` + `node:assert/strict`, one spec
file per lib/route under `server/__tests__/`, each spec sets
`process.env.DASHBOARD_DB_PATH` to a fresh temp file **before** `require("../db")`,
tears down the DB + WAL/SHM files and any temp work dirs in `after()`. LLM
seams are stubbed via `__injectSpawnForTest` (never a real `claude` spawn).
Every new `.js` file needs the file header
(`@author Son Nguyen <hoangson091104@gmail.com>`).

---

## 1. Layer 5 — `server/lib/pace.js` (pure functions)

**Spec file (new):** `server/__tests__/pace-tracking.test.js`
No DB/HTTP needed for the pure-function block — plain `paceStatus`/`isComplete`/
`localDayString` calls against POJO plan-item fixtures. (The route-contract
half of this file, below, does need the DB+HTTP scaffold — same file, later
`describe` block, following `plans-api.test.js`'s `createApp()`/`startServer()`
pattern.)

Fixture helper (put at top of file, mirrors this repo's per-file
throwaway-helper convention, e.g. `focus-summary.test.js`'s `seg()`):
```js
function item(overrides = {}) {
  return { checked: 0, declared_done_at: null, target_date: null, ...overrides };
}
```

### `describe("isComplete")`
| Test | Assertion |
|---|---|
| `"complete via checked=1, signal 'checked'"` | `isComplete(item({checked:1})).complete === true`, `.signal === "checked"` |
| `"complete via declared_done_at, signal 'declared'"` | `isComplete(item({declared_done_at:"2026-01-01T00:00:00Z"})).complete === true`, `.signal === "declared"` |
| `"both set — signal reports one deterministically (pin 'checked' wins)"` | `isComplete(item({checked:1, declared_done_at:"…"})).signal === "checked"` — **pin this explicitly**; the plan states "checked OR declared_done_at" but never states precedence when both are set, so an unpinned implementation could flip which wins on a refactor with no test noticing. |
| `"open item — not complete, signal null"` | `isComplete(item()).complete === false`, `.signal === null` |

### `describe("paceStatus — no_target")`
| Test | Assertion |
|---|---|
| `"no target_date at all → no_target, not on_track"` | `paceStatus(item()).status === "no_target"` |
| `"malformed string 'friday' → no_target, never behind"` | `paceStatus(item({target_date:"friday"})).status === "no_target"` |
| `"impossible calendar date '2026-13-45' → no_target, never behind"` | same — this is the exact "must never manufacture an alarm" guard from the brief; assert `status !== "behind"` explicitly in addition to `=== "no_target"`, so a future regex-only validator (accepts the shape, not a real date) can't sneak past |
| `"right shape, wrong length ('2026-1-5') → no_target"` | regex is anchored (`/^\d{4}-\d{2}-\d{2}$/`), zero-padding required |

### `describe("paceStatus — on_track / behind, boundary pinned (DEC-6)")`
| Test | Assertion |
|---|---|
| `"target in the future → on_track"` | `paceStatus(item({target_date:"2099-01-01"}), {now: NOW}).status === "on_track"` |
| `"target === today (local day) → on_track, not behind"` | `paceStatus(item({target_date: localDayString(NOW)}), {now: NOW}).status === "on_track"` — this is the boundary pin; name it exactly `"target_date equal to today is on_track, not behind"` so a future contributor flipping the comparison operator (`>` vs `>=`) is caught by name, not just by a generic pass/fail |
| `"target === yesterday (next local day) → behind, with days_overdue"` | `.status === "behind"`, `.days_overdue === 1` |
| `"target N days in the past → days_overdue === N"` | table-driven over `N = 1, 5, 30` |
| `"graceDays honored — explicit value"` | `paceStatus(item({target_date: yesterday}), {now: NOW, graceDays: 1}).status === "on_track"` (1 day overdue, 1 day grace → not yet behind); `graceDays: 0` on the same fixture → `"behind"` |
| `"graceDays default is 0 when unset"` | omit `graceDays` entirely on a 1-day-overdue item → `"behind"` (mirrors `focus-report.test.js`'s idle-grace default-vs-explicit shape) |

### `describe("paceStatus — completed items are exempt")`
| Test | Assertion |
|---|---|
| `"checked=1 with a long-past target_date → done, never behind"` | `paceStatus(item({checked:1, target_date:"2020-01-01"}), {now: NOW}).status === "done"`, and explicitly `assert.notEqual(status, "behind")` — this is the rule QA and the tech plan both call out ("a completed item is never behind, however late") |
| `"declared_done_at with a long-past target_date → done"` | same, via the other completion signal |
| `"done status carries completed_signal through"` | `.completed_signal === "checked"` / `"declared"` matching which fired |

### `describe("localDayString")`
| Test | Assertion |
|---|---|
| `"formats YYYY-MM-DD in local time, not UTC"` | construct a `Date` at e.g. 23:30 local on a day boundary and assert the returned string matches the **local** calendar day, not the UTC day — this is the one place a timezone bug would hide silently (`en-CA` formatting per the plan) |

**Red-first note:** every case above fails before `pace.js` exists at all
(module not found) and, once it exists, the boundary/no_target/completed-exempt
cases fail specifically against an implementation that (a) treats `target_date
=== today` as `behind`, (b) coerces a malformed date to `on_track`, or (c)
lets a completed item report `behind` — i.e. they pin the three off-by-one/
false-alarm failure modes the brief calls out by name, not just "the function
returns something."

### Registry-completeness note
`paceStatus`'s status enum (`no_target | on_track | behind | done`) is not
currently planned to be an exported list — recommend `pace.js` export
`PACE_STATUSES = ["no_target","on_track","behind","done"]` alongside the
function, and add one meta-test:
```js
it("every PACE_STATUSES value is exercised by at least one case above", () => {
  const seen = new Set(allAssertedStatuses); // collect from the table-driven cases
  for (const s of PACE_STATUSES) assert.ok(seen.has(s), `no test covers status "${s}"`);
});
```
so a future 5th status can't ship without a corresponding case.

### Round-trip / boundary surface: `target_date` survives re-ingest
Not a `pace.js` test — belongs in `plan-ingest.test.js` per the tech plan's
own instruction ("extend that spec, don't fork it"):

**Extend `server/__tests__/plan-ingest.test.js`**, sibling to the existing
`"preserves declared_done_* across re-ingest and deletes removed numbers"`
test (currently at line ~235):
- New `it("preserves target_date across re-ingest, untouched by upsertPlanItem")`:
  1. Ingest a plan, then `stmts.setPlanItemTargetDate.run("2026-06-01", workDir, 1)`.
  2. Re-write the file with item 1's **text** changed (forces a real re-ingest,
     not a hash short-circuit) and re-run `ingestPlanForCwd`.
  3. Assert `target_date === "2026-06-01"` survives, exactly mirroring the
     existing `declared_done_at` assertion in the same block.
  - **Red-first:** fails today (before Layer 5 ships, the column doesn't
    exist) and would also fail against the Override-1-violating design the
    tech plan explicitly forbids (a `target:` line parsed by
    `upsertPlanItem`'s `ON CONFLICT … SET` clause) — that implementation
    would reset `target_date` to whatever (or nothing) the file says on
    every reformat, which this exact test catches by asserting the value
    survives a re-ingest that changes unrelated file content.

### Route contract: `POST /api/plans/items/target`
**Extend `server/__tests__/plans-api.test.js`** (new `describe("POST /api/plans/items/target")` block, following the file's existing `fetch`/`post` helpers and `workDir`/`SESSION_ID` fixtures):
| Test | Assertion |
|---|---|
| `"sets a valid target_date and broadcasts plan_updated"` | `200`; re-`GET /api/plans/for-cwd` shows the new `target_date` on the item (round-trip through the read path) |
| `"clears with target_date: null"` | `200`; subsequent GET shows `null` |
| `"400 on malformed date ('2026-13-45', 'friday', '2026-1-5')"` | table-driven, one `it()` or one table with 3 rows; `res.body.error` is a structured object, not a bare string |
| `"404 for an unknown item_number"` | valid cwd, nonexistent `item_number` |
| `"400 without cwd / without a positive-integer item_number"` | matches `.claude/rules/backend-node.md`'s "validate input thoroughly, structured errors" |

**Red-first:** fails before the route exists (404/`ECONNREFUSED`-shaped
failures from the test harness); once implemented, the malformed-date cases
specifically catch a route that reuses `plan-ingest.js`'s looser shape-only
regex instead of validating a real calendar date (the same "friday"/
"2026-13-45" trap `pace.js`'s own tests pin).

---

## 2. `server/lib/atomic-file.js` — baseline coverage (currently zero anywhere)

**Spec file (new):** `server/__tests__/atomic-file.test.js`. This is
explicitly called out in the brief and the QA doc as zero-coverage code
being promoted to shared, doubly-relied-on infrastructure — write it
**before** `plan-writeback.js`'s tests depend on it, so a broken primitive
fails here first, not inside a much larger write-back test.

```js
const { atomicWriteFile } = require("../lib/atomic-file");
```

| Test | Assertion |
|---|---|
| `"writes content exactly, leaving no stray .tmp file"` | `fs.readFileSync(target, "utf8") === content`; `fs.readdirSync(dir)` contains no `.tmp`-suffixed entry after a successful call |
| `"creates the parent directory if missing"` | target under a not-yet-created subdir; call succeeds and file exists (mirrors `cc-mutate.js`'s `fs.mkdirSync(dir, {recursive:true})` behavior) |
| `"overwrite: original file untouched until the atomic rename, new content wins after"` | write v1, then start a write of v2 but stub `fs.renameSync` (via `node:test`'s `t.mock.method(fs, "renameSync", () => { throw new Error("boom"); })`) to throw — assert (a) the call throws/propagates, (b) `fs.readFileSync(target)` still holds **v1** unchanged, (c) no `.tmp` file remains in the dir |
| `"failure mid-write (uncreatable target dir) leaves nothing behind"` | point `filePath` at a path whose parent cannot be created (e.g. under a file, not a dir, used as the parent segment) — assert it throws and no `.tmp` sibling is left in whatever dir did exist |
| `"two sequential writes to the same path never collide on the tmp filename"` | the tmp name embeds `process.pid` + `Date.now()` per the existing implementation; write twice in a row and assert both succeed with the final content matching the second write (regression against a hypothetical fixed-name tmp file two racing writes could stomp on) |

**Regression gate to run in the same commit:** `node --test server/__tests__/cc-config.test.js` must still pass unchanged immediately after the extraction (per the technical plan's step 11) — this is not a new test, it's the existing spec re-run in isolation before touching anything else.

**Red-first note:** every case here is new-file-doesn't-exist-yet red before
extraction. Once extracted, the `renameSync`-throws case is the one that
actually pins the safety claim currently only living in a code comment
(`cc-mutate.js:214-217` — "tmp is unlinked on any failure path"): an
implementation that unlinks `.tmp` but also (bug) truncates/touches the real
target before renaming would pass a naive "no exception" check but fail this
test's "original file untouched" assertion.

---

## 3. Layer 4 — `server/lib/plan-writeback.js`

**Spec file (new):** `server/__tests__/plan-writeback.test.js`. Own temp DB
(`DASHBOARD_DB_PATH`), own `fs.mkdtempSync` work dir, reuse
`plan-ingest.test.js`'s `writePlan()` helper pattern verbatim (do not
hand-roll a second file-writing helper — this is explicitly called out in
both `qa.md` and the technical plan as a drift risk).

```js
const {
  sanitizeLlmPlanText,
  appendPlanItem,
  appendSubItem,
  applyDisposition,
  __injectPreRenameHookForTest,
} = require("../lib/plan-writeback");
const { ingestPlanForCwd, PLAN_FILENAME, ID_LINE_RE, ACCEPTANCE_LINE_RE, DETAIL_LINE_RE,
  MAX_TEXT_LEN, MAX_ACCEPTANCE_LEN, MAX_DETAIL_LEN, MAX_ITEMS, MAX_FILE_BYTES } = require("../lib/plan-ingest");
```

### 3a. `describe("appendPlanItem / appendSubItem — happy path, real write survives re-ingest")`

| Test | Assertion |
|---|---|
| `"a new_item write appears as a new plan_items row after write-back + re-ingest"` | seed a plan, call `appendPlanItem(dbModule, {cwd, text:"New work", acceptance:"a", detail:"d"})`, then the **real** (unstubbed) `ingestPlanForCwd(dbModule, cwd)`; assert a **new** `plan_items` row exists with `item_id === result.itemId`, `parent_item_id === null`, `text === "New work"`. Name it exactly this — per the tech plan, this is the deliberate inverse of the now-superseded "must not create a row" assertion, and the name should make that self-evident to a future reader without a `decisions.md` lookup. |
| `"a fold_in write appears as a new sub-item, parented and display-numbered correctly"` | `appendSubItem(dbModule, {cwd, parentItemId: parent.item_id, text:"Sub work"})`, real re-ingest; assert new row's `parent_item_id === parent.item_id`; then `stmts.listPlanItems.all(cwd)` through `attachDisplayNumbers` shows the correct `N.M` — do not re-assert `attachDisplayNumbers`'s own logic (covered in `plan-ingest.test.js`), just confirm write-back's output feeds it |
| `"re-running ingestPlanForCwd a second time with no further change short-circuits (no row churn)"` | call `ingestPlanForCwd` again immediately after; `res.changed === false` — proves `plan-writeback`'s own ingest call updated `plans.content_hash` so the *next independent* trigger (poll tick, SessionStart) harmlessly no-ops |
| `"an unrelated pre-existing item elsewhere in the file is byte-identical apart from the appended block"` | snapshot the file, extract the pre-existing item's line range before/after, assert those lines are unchanged (append doesn't reflow) |
| `"NO_PLAN_FILE when the plan file is missing — never synthesizes one"` | call against a cwd with no `AGENT-PLAN.md` at all; assert `{ok:false, code:'NO_PLAN_FILE'}` and (critically) `fs.existsSync` still returns false afterward — WATCH-7's "never author a plan from scratch" guard |

### 3b. `describe("optimistic-lock conflict — no data loss")`

Do **not** attempt real filesystem races. Use `__injectPreRenameHookForTest(fn)`
— fires deterministically between the initial read/hash and the
immediate-pre-rename re-check; body is just `fs.writeFileSync(planPath, humanEdited)`.

| Test | Assertion |
|---|---|
| `"human edit lands in the injected window → CONFLICT, not a silent success or generic throw"` | `__injectPreRenameHookForTest(() => fs.writeFileSync(planPath, humanEdited))`; `result.ok === false`, `result.code === 'CONFLICT'` |
| `"the human's edit is preserved byte-for-byte, with no dashboard content appended over or around it"` | after the CONFLICT, `fs.readFileSync(planPath, "utf8") === humanEdited` exactly |
| `"caller-side state is NOT advanced on CONFLICT"` | model a stand-in disposition object with a `resolved` flag that only flips on a non-CONFLICT return from a thin wrapper; assert it's still `false`/unresolved after the CONFLICT |
| `"cheap pre-filter conflict — stale expectedHash caught before any read-modify-write"` | pass an `expectedHash` that already differs from the current file hash (no injected hook needed at all); assert `CONFLICT` and that the hook (if also installed, throwing) was **never invoked** — proves the cheap check runs first |
| `"same-cwd mutex serializes two concurrent appendPlanItem calls — both succeed, distinct rows, never see each other as CONFLICT"` | fire two `appendPlanItem(dbModule, {cwd, text:"A"})` / `{cwd, text:"B"})` calls back-to-back with no `await` between the two call expressions, `await Promise.all([...])`; assert both resolve `ok:true` with two distinct minted `itemId`s and, after a real ingest, two new rows exist |
| `"mutex key identity — a trailing-slash cwd variant is a known hazard, not silently handled"` | call once with `cwd` and once with `cwd + "/"`; assert `applyDisposition`/the write path use the **exact byte-identical string** it was given (no internal `path.resolve`/normalize) — i.e. this is a documentation-by-test of the hazard, not a fix: assert the two calls do **not** serialize against each other (proving the string, not a normalized path, is the map key) |

**Red-first note (3a+3b):** before `plan-writeback.js` exists, all of these
fail on module-not-found. Once a naive/incomplete implementation exists,
each case pins a *specific* known failure mode named in the plan: a
write-back that calls `upsertPlanItem` directly (fails 3a's "real re-ingest
produces the row" test differently than intended — the row would appear via
DB write, not via file+ingest, which is why the test must open the file
after the call and confirm the block is there **before** the ingest step
runs, not only check the DB); a write-back with no optimistic lock at all
(fails every case in 3b because nothing ever returns `CONFLICT`); a
write-back with only the cheap pre-check but no immediate-pre-rename re-hash
(passes the cheap-pre-filter case but fails the injected-hook case, catching
exactly the "TOCTOU window" the plan calls WATCH-9's *residual* risk vs. the
one it insists must be closed).

### 3c. `describe("sanitizeLlmPlanText — adversarial LLM-influenced input")`

Pure unit tests, no file I/O, no DB. **Assert the parse-back through
`parsePlanMarkdown`, not the raw sanitized string** — this is the single
most important instruction in both source documents and must not be
weakened by an implementer testing only the string transform.

Table-driven, one row per case, `{ name, field, input, assertParsedBack }`:

| Case name | Input | Assertion (via composing a full block with this field, then `parsePlanMarkdown` on it) |
|---|---|---|
| `"forged id: continuation line in text"` | `"Some text\n      id: deadbeef"` | composed+parsed block has exactly the sanitizer-minted `id`, never `"deadbeef"`; item count unchanged (no phantom item) |
| `"forged acceptance: continuation line"` | `"Ship it\n      acceptance: fake accepted"` | parsed item's `acceptance` is the field the caller actually set, not the injected one |
| `"forged detail: continuation line"` | `"Note\n      detail: fake detail"` | same, for `detail` |
| `"bare injected item line, no field keyword"` | `"Ship it\n- [ ] 99. injected fake item"` | `parsePlanMarkdown` on the composed output produces **no** item numbered 99 anywhere |
| `"oversized text truncated before composition"` | `"x".repeat(MAX_TEXT_LEN + 500)` | `sanitizeLlmPlanText(input, MAX_TEXT_LEN).length <= MAX_TEXT_LEN` **before** composition — assert on the sanitizer's direct return value here (this one case is about the cap contract, not parse-back); also assert the caps are the **imported** `plan-ingest.js` constants (compare `MAX_TEXT_LEN` used by the test against the imported one — a hand-copied literal that drifts is a real risk the plan explicitly flags) |
| `"oversized acceptance / detail truncated"` | same shape, using `MAX_ACCEPTANCE_LEN` / `MAX_DETAIL_LEN` | same |
| `"combined worst case: newline + fake id: + oversized, all at once"` | concat all three | all three guards hold simultaneously — assert length cap **and** parse-back item-count/id unchanged |
| `"joinery: sanitized text ending mid-word adjacent to an acceptance field starting 'id:'"` | `text: "Some text ending abrup"`, `acceptance: "id: deadbeef looks like a field"` | compose the **full block** (not each field alone) and parse it back — assert no phantom `id` value bleeds across the field boundary; this is the specific gotcha the engineer's sketch is called out as not yet verified against |
| `"negative control — clean ordinary string, no newlines/keywords, under all caps"` | `"Add rate limiting to the export endpoint"` | `sanitizeLlmPlanText(input, MAX_TEXT_LEN) === input` byte-for-byte — proves the sanitizer isn't overly aggressive |
| `"non-string input never throws, returns empty"` | `null`, `undefined`, `42`, `{}` | `sanitizeLlmPlanText(x, MAX_TEXT_LEN) === ""` for each, no throw |

**Red-first note:** a sanitizer that merely `.replace(/\n/g, " ")`s without
stripping a leading field-prefix would pass the "bare injected item line"
case (no keyword to catch) but **fail** the forged-`id:`/`acceptance:`/
`detail:` cases specifically, because the collapsed single-line string would
still literally contain `"id: deadbeef"` as prose that, depending on how
`plan-writeback.js` composes the block, could still align with
`ID_LINE_RE`'s indentation-based continuation match if placed on its own
composed line — this is exactly why the assertion must be the **parse-back**,
which fails first and loudest against that half-implementation.

### 3d. `describe("MAX_ITEMS / byte-cap pre-flight")`

| Test | Assertion |
|---|---|
| `"rejects an append at MAX_ITEMS with CAPS_EXCEEDED, writing nothing"` | seed a plan file with `MAX_ITEMS` items already; `appendPlanItem` returns `{ok:false, code:'CAPS_EXCEEDED'}`; `fs.readFileSync` after the call is **byte-identical** to before (no partial/silent write) |
| `"rejects an append that would push the file past MAX_FILE_BYTES"` | seed a file at `MAX_FILE_BYTES` minus a few bytes; same assertion shape |

**Red-first:** the "byte-identical after rejection" assertion is the load-bearing
one — an implementation that composes the block, checks the cap, and returns
an error *after* already writing would pass a shallower "returns an error
code" test but fail this one, which is exactly the "write that succeeded and
then invisibly didn't (or did)" bug the plan names.

### 3e. `describe("applyDisposition — retry-once-then-escalate policy")`

Stub `appendPlanItem`/`appendSubItem` here (this block tests orchestration,
not file mechanics — file mechanics are 3a-3d). Use `node:test`'s built-in
`t.mock.fn()` or a small manual counter/stub, following this repo's existing
stub-by-injected-function style (no new mocking library).

| Test | Assertion |
|---|---|
| `"two consecutive CONFLICTs → exactly one retry, write_status='conflict', one writeback_conflict queue row"` | stub returns `{ok:false, code:'CONFLICT'}` twice; assert the stub was called **exactly 2 times** (1 original + 1 retry, not 3); `detour_dispositions.write_status === 'conflict'`; `decision_queue` has one row `kind='writeback_conflict'` with `payload` containing the attempted markdown + current hash |
| `"CONFLICT then success → one retry, write_status='written', resolved_item_id set, no queue row"` | stub sequence `[CONFLICT, {ok:true, itemId:'x'}]`; assert exactly 2 calls, `write_status==='written'`, `decision_queue` count unchanged (0 new rows) |
| `"CAPS_EXCEEDED / NO_PLAN_FILE / IO_ERROR → zero retries, write_status='failed', one writeback_failed row"` | table-driven over the 3 codes; assert the stub called **exactly once** each time (deliberately asymmetric from CONFLICT — assert this explicitly by name, e.g. `"CAPS_EXCEEDED is not retried (asymmetric from CONFLICT)"`) |
| `"deliberate / discard never call the write path at all"` | stub throws if called; dispositions with `disposition IN ('deliberate','discard')` resolve without invoking it |
| `"idempotent: re-invoking applyDisposition on an already-written row calls the write path zero additional times"` | first call succeeds; second call on the same `dispositionId` — stub throws if called again; assert it returns the **same** `resolved_item_id` as before, no throw |
| `"retry_write after a conflict re-derives the hash from disk, never reusing the stale expectedHash"` | capture the `expectedHash` argument passed to the stub on each call; assert the retry's `expectedHash` differs from (or is freshly derived, not equal to) the first attempt's stale value — this is the one behavior with **no existing sibling test in this repo** per the plan; write it as its own explicit case rather than folding it into the CONFLICT-then-success case above, since a lazy implementation could pass "eventually succeeds" while still reusing a stale hash on the retry itself |

**Red-first note:** the two-CONFLICTs case is the one most likely to be
implemented wrong in a way a shallower test would miss — an
off-by-one retry-loop bug (`while (attempts < 2)` instead of "one original +
one retry") would produce 3 or 1 total attempts instead of 2; asserting the
**exact** call count (not "at least" or "eventually resolved") is what makes
this red against that bug and green after.

### 3f. `describe("traceability — plan_items row back to its detour_dispositions row")`

The real round trip, since the two identifiers become known at different
times:

| Test | Assertion |
|---|---|
| `"forward: given only detour_dispositions.id, one query recovers which item it wrote, which classification, and when"` | (1) `appendPlanItem`, capture minted `item_id`; (2) real `ingestPlanForCwd`; (3) seed a `detour_dispositions` row and drive it through `applyDisposition` (or directly set `resolved_item_id`/`write_completed_at` via `markDetourWriteResult` if testing this in isolation from the disposition module); (4) `SELECT disposition, decided_by, reason, session_id, write_completed_at, resolved_item_id FROM detour_dispositions WHERE id = ?` joined to `plan_items ON item_id = resolved_item_id`; assert every field DEC-13's phrasing requires ("which detour, which classification, when") is present in that one query's result |
| `"reverse: SELECT * FROM detour_dispositions WHERE resolved_item_id = ? recovers the decision from a plan_items row"` | starting from the `plan_items` row's `item_id`, the reverse query returns exactly the disposition row from the previous test |
| `"negative case: a CONFLICT-ended disposition has resolved_item_id IS NULL and write_status='conflict', resolved_at IS NULL — distinguishable from a successful write by query alone"` | no log-reading — assert this purely via SQL |

**Red-first:** fails before the write-audit columns exist at all (schema
error); once the schema exists, an implementation using the superseded
`linked_plan_item_id` spelling storing the integer PK (QA's original,
now-overridden spelling per DEC-14) would fail the "reverse" query above,
which is written against `resolved_item_id` holding the **stable `item_id`
string**, not the integer PK — this is the exact drift DEC-14 exists to
prevent, and the test's column name is the enforcement mechanism.

---

## 4. `detour_dispositions` schema + `server/lib/detours.js` CRUD

**Spec file (new):** `server/__tests__/detour-disposition.test.js`. Focus
here is disposition *logic*; **stub `plan-writeback.js`** (its real
integration is covered in section 3 above — do not re-test file mechanics
twice, per both source docs' explicit instruction).

```js
const { recordInferredDetour, backfillDeclaredDetours, resolveDisposition, DISPOSITIONS } = require("../lib/detours");
```

### 4a. Registry-completeness meta-test (mandatory, per this doc's brief)
```js
describe("DISPOSITIONS registry completeness", () => {
  it("every DISPOSITIONS value has a dedicated resolveDisposition + applyDisposition test case below", () => {
    // Maintain a `coveredDispositions` Set populated by each disposition-specific
    // it() below (push into it inside each test body, or derive from the
    // table-driven fixture array's own keys). Assert it exactly equals
    // new Set(DISPOSITIONS) - a 5th value added to the enum without a
    // corresponding table row fails this test immediately, before any
    // behavioral assertion even runs.
    assert.deepEqual([...coveredDispositions].sort(), [...DISPOSITIONS].sort());
  });
  it("SQL CHECK(disposition IN (...)) matches the JS DISPOSITIONS array exactly", () => {
    // Introspect via `db.prepare("SELECT sql FROM sqlite_master WHERE name='detour_dispositions'").get().sql`
    // and regex out the CHECK(...) list; assert it matches DISPOSITIONS (order-independent).
    // This is the one guard against the JS enum and the SQL CHECK drifting
    // independently — both source docs name this drift explicitly (§5(a)).
  });
});
```

### 4b. `describe("resolveDisposition — enum guard")`
| Test | Assertion |
|---|---|
| `"accepts exactly the four DISPOSITIONS values"` | table-driven over `DISPOSITIONS`, each resolves without throwing |
| `"rejects a fifth invented value with a structured error, not a silent accept"` | `resolveDisposition(dbModule, id, {disposition:"ignore_forever", ...})` throws/returns a structured error; the row's `disposition` column is **not** updated to the invalid value |

### 4c. `describe("fold_in / new_item — caller-side write-status transitions")`
(DEC-12's assertions are gone; this section replaces them per both source
docs' explicit direction.)
| Test | Assertion |
|---|---|
| `"disposing fold_in drives exactly one call into plan-writeback.applyDisposition"` | stub `applyDisposition`; assert called once with the correct `dispositionId` |
| `"on success, write_status='written', resolved_item_id set, resolved_at stamped"` | stub returns success shape |
| `"on CONFLICT, write_status='conflict', resolved_item_id IS NULL, resolved_at IS NULL — obviously retryable, not silently dropped"` | stub returns `{ok:false, code:'CONFLICT'}` |

### 4d. `describe("deliberate / discard — no write, still queryable (audit trail preserved)")`
| Test | Assertion |
|---|---|
| `"resolves without any write-path call"` | stub `applyDisposition` throws if called; resolving `discard`/`deliberate` never invokes it |
| `"discard is a resolution, not a delete — the row is queryable after resolution"` | `getDetourDisposition(id)` still returns the row with `disposition==='discard'`, `resolved_at` set — mirrors this project's `declared_done_at` never-destructively-delete convention already present in `plan_items`' own schema comments |

### 4e. `describe("durability across re-inference (the architect's top risk)")`
| Test | Assertion |
|---|---|
| `"a resolved+written disposition survives re-inference of its session unchanged"` | create an inferred detour via `recordInferredDetour`, resolve it to a written state (stub the write), then re-run `inferSession` for the same session so `upsertDetourDisposition` fires again on conflict; assert `disposition`, `decided_by`, `resolved_at`, `write_status`, `resolved_item_id` are **all unchanged**; `source_seen_at` **has** advanced (the observation field is allowed to refresh); **no second write-path call happened** (stub call count still 1) |
| `"a stale-resolved row is re-surfaced for review but never re-applies the write"` | advance `source_seen_at` past `resolved_at`; assert `listStaleResolvedDetours` returns the row; then simulate "review" (whatever re-surfacing does) and assert the write path is still never invoked a second time for a row already `write_status='written'` |

### 4f. `describe("idempotency")`
| Test | Assertion |
|---|---|
| `"recording the same detour twice (same cwd/source/source_ref) yields exactly one row"` | the `(cwd, source, source_ref)` UNIQUE index enforces this — call `recordInferredDetour` twice with identical `row`/`result`, assert `listDetourDispositions` count is 1 |
| `"resolving an already-resolved disposition neither duplicates a row nor triggers a second write"` | resolve once (stub called once), resolve again — stub call count still 1 |

### 4g. `describe("§9.2 ordering — created_at, never id, before LIMIT")`
Reuse the exact scrambled-insertion technique from
`focus-report.test.js`'s out-of-order test (`"never lets active_ms exceed
wall_ms … when events land out of chronological order"`, ~line 370):
| Test | Assertion |
|---|---|
| `"backfillDeclaredDetours processes events in created_at order even when id-insertion order differs"` | bulk-insert `events` rows with `created_at` values that are NOT monotonic with `id` (insert row with the *later* timestamp first, giving it the *lower* id); assert the resulting `detour_dispositions` rows (or whatever ordered output `backfillDeclaredDetours` returns/produces) reflect `created_at` order |
| `"listPendingDetours sorts by created_at ASC, id ASC before LIMIT — a low-id/late-timestamp row doesn't get evicted by LIMIT ahead of a genuinely earlier one"` | seed 3+ rows scrambled the same way with a `LIMIT` smaller than the count; assert the returned set matches the `created_at`-ordered top-N, not the `id`-ordered one |

**Red-first for 4g specifically:** with the naive `ORDER BY id` (or no
explicit tiebreak) that this project's own catalog (§9.2) has already had to
fix three times in sibling code, this test fails deterministically because
the fixture is constructed so `id` order and `created_at` order **disagree**
by design — a passing implementation must have the explicit `ORDER BY
created_at …, id …` the plan requires.

### 4h. Extend `server/__tests__/focus-inference.test.js` (do not fork a parallel spec)
New cases inside the existing `describe("inferSession")` block:
| Test | Assertion |
|---|---|
| `"a session classified kind='detour' also produces exactly one pending detour_dispositions row"` | after `inferSession` with a stubbed LLM verdict of `kind:'detour'`, `listDetourDispositions` for that cwd has exactly one new row, `disposition==='pending'` |
| `"a session classified item/unclassified produces no detour_dispositions row"` | negative control |
| `"a thrown error inside recordInferredDetour still leaves the focus_inferences row written (per-stage fail-safe)"` | monkeypatch/stub `detours.recordInferredDetour` to throw; assert `inferSession` still completes and `focus_inferences` has the row — proves the `try{}catch{}` wrapper in `inferSession` is real, not decorative |
| `"classification never writes AGENT-PLAN.md — file is byte-identical before/after an inferSession call that produces a detour"` | snapshot the plan file's bytes before, run `inferSession` producing a `kind:'detour'` verdict, assert bytes unchanged after — this is the single most important negative assertion in Layer 4: the classifier must be structurally incapable of reaching `applyDisposition` |

**Red-first (4h):** the byte-identical-file assertion is the one that would
catch a regression where a future refactor accidentally wires
`recordInferredDetour` (or something it calls) into the write path — it
fails loudly (file changed) rather than silently passing on "well, some
detour got recorded."

### 4i. Route tests (extend `server/__tests__/detour-disposition.test.js` or a small `describe` block for `server/routes/detours.js`)
| Test | Assertion |
|---|---|
| `"GET /api/detours filters by cwd/project_id/status"` | seed rows across 2 cwds/statuses, assert filtered results |
| `"POST /api/detours/:id/resolve happy path returns write_status and resolved_item_id in the body"` | `fold_in` with a stubbed successful write; response body carries both fields |
| `"400 on a bogus disposition value"` | `disposition: "nope"` → `400`, structured error |
| `"a CONFLICT outcome is surfaced as a 200-with-conflict-body (or documented non-500 status), never a bare 500"` | stub write path to `CONFLICT`; assert the response is not a generic server error — a human resolving by hand needs to see "this needs a retry," not a stack trace |

---

## 5. Layer 6 — `server/lib/reconciliation.js`

**Spec file (new):** `server/__tests__/reconciliation.test.js`. Four
`describe` blocks so the rules/LLM boundary is enforced by the file's own
shape (per DEC-11: template `focus-audit.test.js` for the rule/scheduler
halves, `focus-summary.test.js` for the LLM half — **not**
`session-liveness.test.js`, which tests a synchronous probe, not a scheduled
loop).

```js
const { evaluateRules, classifyFlaggedDetours, buildDispositionPrompt,
  parseDispositionOutput, computeFlaggedDigest, listReconcileTargets,
  reconcileCwd, startReconciliation } = require("../lib/reconciliation");
const { __injectSpawnForTest } = require("../lib/focus-inference"); // shared spawn seam
```

### 5a. `describe("escalation rules — deterministic, ZERO LLM calls")`

This is the change brief's single named non-inversion invariant
(Hybrid-escalation non-inversion). Every test in this block must install:
```js
__injectSpawnForTest(() => { throw new Error("no LLM call expected — rules must never spawn"); });
```
**before** calling `evaluateRules`, so a stray call fails the test
immediately rather than being silently absorbed.

| Test | Assertion |
|---|---|
| `"R1 pace breach: item behind beyond DASHBOARD_PACE_GRACE_DAYS flags; item within threshold does not"` | two plan items, one `paceStatus === 'behind'` past grace, one not; `evaluateRules(...).paceBreaches` contains the first item's `item_id`, not the second's — **and assert `evaluateRules` calls `pace.paceStatus` (spy/stub it to confirm it's invoked), never re-derives the date comparison inline** — this is §9.1's computation-duplication risk stated as a test, not just a comment |
| `"R1 boundary: exactly at the grace-day cutoff is not yet flagged; one day past is"` | table-driven boundary pin, same pattern as `pace.js`'s own boundary test — do not just trust `pace.js`'s test to cover this; `evaluateRules`'s own threshold comparison (`days_overdue > DASHBOARD_PACE_GRACE_DAYS`) is a second place an off-by-one could hide |
| `"R2 detour-volume: ratio ≥ threshold AND total sessions ≥ min flags; either condition alone does not"` | 4 sub-cases: (ratio high, sessions below min) → no flag; (ratio low, sessions above min) → no flag; (both above) → flag; (both below) → no flag — table-driven, all 4 combinations explicit since "AND" bugs (accidentally coded as OR) are exactly the kind of silent inversion this guards |
| `"a cwd with no escalation-worthy condition produces an empty flagged set and zero LLM calls"` | assert `evaluateRules(...)` returns `{paceBreaches:[], detourVolume:false, flaggedDetours:[]}` (or equivalent empty shape) and the spawn-throws stub was never triggered (test would already have failed via the throw if it had been) |
| `"WATCH-2: a cwd with plans.missing_at set is skipped — no pace_alert, and never reaches the LLM step"` | seed a plan with `missing_at` set and a stale-but-otherwise-breaching item; assert `listReconcileTargets` excludes it entirely (not just that rules return empty for it) |
| `"WATCH-2: a cwd with zero plan items is skipped the same way"` | second, separate case — **the plan explicitly warns the easy bug is fixing only the pace branch and forgetting the write-back branch**, so also assert directly: a zero-item cwd's detours (if any exist) never appear in `classifyFlaggedDetours`'s input — i.e. test both the pace-alert exclusion and the write-back-reachability exclusion as two distinct assertions, not one |

**Red-first note:** the spawn-throws-on-call stub is what makes this whole
block red against the confirmed non-compliance condition named in the
brief — an implementation where `evaluateRules` (even accidentally, via a
shared helper) calls into the LLM path fails immediately and loudly, rather
than a subtler test that only checks the *final* escalation decision (which
could still be "correct" by coincidence even with an errant LLM call mixed
in).

### 5b. `describe("LLM judgment pass — classification only, never escalation")`

Copy `fakeSpawn`/`fakeSpawnSequence`/`envelope` helpers verbatim from
`focus-summary.test.js` (per this repo's stated one-helper-per-file
convention). No real `claude` CLI is ever spawned.

| Test | Assertion |
|---|---|
| `"classifyFlaggedDetours is only ever called with what evaluateRules flagged"` | integration-style: run a full `reconcileCwd` tick with a mixed fixture (some breaching, some not); assert the LLM prompt built by `buildDispositionPrompt` only references the flagged detours' ids, never an unflagged one — this is the "only ever called with what (b) returned" contract as a positive assertion, not just an absence check |
| `"one case per disposition value the stub returns (fold_in / new_item / deliberate / discard) — decision-queue/disposition row carries that exact verdict unmodified"` | table-driven over `DISPOSITIONS` — **reuse the same registry-completeness pattern as section 4a**: assert `[...covered].sort() === [...DISPOSITIONS].sort()` |
| `"the auto-write boundary: a stubbed high-confidence fold_in calls plan-writeback.applyDisposition exactly once; on success, no decision_queue row is created"` | stub `applyDisposition` (not the real write path — that's section 3's job) to return success; assert called once, `decision_queue` row count for this cwd is 0 after |
| `"a stubbed {ok:false, code:'CONFLICT'} from applyDisposition (already retried internally) produces a writeback_conflict queue row, not a silent drop"` | (note: retry-once-then-escalate itself is `applyDisposition`'s own responsibility, tested in section 3e — this test only confirms `reconciliation.js` correctly surfaces whatever `applyDisposition` returns, it does not re-test the retry count) |
| `"quiet resolution: a stubbed high-confidence discard/deliberate resolves the disposition, creates no queue row, and never calls the write path"` | stub `applyDisposition` to throw if called |
| `"malformed LLM output degrades to needs_review, never a guessed verdict, never a write"` | 5 sub-cases table-driven: unparseable JSON, missing `disposition` field, an invented 5th value, an id not present in the flagged set, confidence below `DASHBOARD_DETOUR_CONFIDENCE_MIN` — each leaves the disposition `pending`, enqueues a row with `payload.needs_review === true`, and the write-path stub is never called (throws if invoked) — mirror `parseWindowSummaryOutput`'s existing "returns null on garbage" defensive shape from `focus-summary.test.js` |
| `"digest gating: an unchanged flagged set on a second tick spawns nothing; changing a detour's source_seen_at/label changes the digest and allows exactly one further spawn"` | `computeFlaggedDigest` stability/change assertions, same shape as `computeInputDigest`'s test in `focus-summary.test.js` |
| `"zero flagged detours → classifyFlaggedDetours is skipped entirely, zero spawns"` | assert via the throw-on-call stub |
| `"DASHBOARD_RECONCILE_MODE=off or DASHBOARD_FOCUS_INFER_MODE=off → LLM half never spawns (rules half still runs)"` | two separate cases proving DEC-9's asymmetric kill-switch composition: `RECONCILE_MODE=off` stops the whole tick (assert `reconcileCwd` no-ops entirely, e.g. `listReconcileTargets`/`evaluateRules` also not called — or however `reconcileCwd`'s early-return is structured); `FOCUS_INFER_MODE=off` alone still runs rules (pace/detour-volume queue rows for genuine breaches still appear) but zero spawns |

**Red-first note:** the "only ever called with what evaluateRules flagged"
test is the other half of the hybrid non-inversion invariant — an
implementation that (bug) passes *all* pending detours to the LLM instead of
just the rule-flagged subset would pass every "one case per disposition"
test (since those only check the verdict-to-row mapping) but fail this one,
because the assertion is specifically about the **input set**, not the
output.

### 5c. `describe("decision queue output")`
| Test | Assertion |
|---|---|
| `"queue contains only rules-escalated / write-back-escalated items — never a classified-but-not-escalated detour"` | a low-confidence-classified detour that never got flagged by rules must never appear in `decision_queue` at all |
| `"a resolved/dismissed item does not resurface on the next tick (findOpenQueueItem guard)"` | run `reconcileCwd` twice over an unfixed condition; assert only one queue row exists, not one-per-tick |
| `"resolving a detour_disposition queue row also resolves the linked detour_dispositions row, in one transaction"` | via the route or a direct call; assert both rows flip together — and (regression) that a simulated mid-transaction failure leaves **neither** flipped (use a stubbed statement that throws after the first write, if the transaction wrapper is testable that way) |
| `"retry_write on a writeback_conflict row re-invokes applyDisposition with a fresh hash and flips both rows on success"` | stub `applyDisposition`'s second call to succeed; assert both the queue row and the disposition row update together |

### 5d. `describe("scheduling / fail-safe")`
Trigger `reconcileCwd` directly (never a real timer) — same seam
`livenessReap`/`auditSession` already provide.
| Test | Assertion |
|---|---|
| `"LLM unavailable (probeClaudeCli false) → prior decision_queue/detour_dispositions state untouched, tick completes without crashing"` | mirrors `session-liveness.js`'s `available:false → change nothing` |
| `"a DB error mid-write leaves state untouched, not partially written"` | stub a persistence statement to throw partway through a multi-row tick; assert earlier state for *other* cwds in the same tick is unaffected (per-cwd `try/catch`, per step 23's design) |
| `"a write-back throw inside the LLM branch doesn't crash the scheduler or leave a half-written decision_queue/detour_dispositions pair"` | stub `applyDisposition` to throw a raw (non-structured) error; assert the tick catches it per-disposition, not per-tick, and other dispositions in the same batch still process |

**Red-first note (5c/5d):** the "resolved item does not resurface" test is
red against the most likely real bug in this layer — an implementation
missing the `findOpenQueueItem` anti-duplicate guard would re-queue the same
still-breaching condition every tick, and this test (running `reconcileCwd`
twice) catches that on the second call, where a single-tick test would not.

---

## 6. Round-trip / boundary surfaces (cross-cutting)

| Surface | Round-trip test | Where |
|---|---|---|
| `plan_items.target_date` | Set via `setPlanItemTargetDate` → survives a real re-ingest that changes unrelated file content → read back via `GET /api/plans`/`listPlanItems` | §1 (`plan-ingest.test.js` extension + `plans-api.test.js` extension) |
| `AGENT-PLAN.md` write → `plan_items` row | `appendPlanItem`/`appendSubItem` write bytes → real `ingestPlanForCwd` → row readable by `(cwd, item_id)`, indistinguishable from a human-typed item | §3a |
| `detour_dispositions` → `plan_items` (forward) and back (reverse) | one query each direction via `resolved_item_id` | §3f |
| `detour_dispositions.write_status` / `decision_queue` consistency | a partial-failure simulation must never leave the two tables disagreeing (one shows written, the other shows a stale open conflict row, etc.) | §5c/5d |
| No-unresolved-token boundary (LLM-influenced text → stakeholder file) | produced: `sanitizeLlmPlanText`'s own output caps/strips at the point the LLM's proposed text is captured (§3c, "oversized"/"forged" cases operate on the value **as it leaves the sanitizer**); consumed: the **parse-back** through `parsePlanMarkdown` at the point the file is next read (§3c's core instruction — assert on parse-back, not the string) — both ends of this boundary are covered, per this document's mandate not to assert only at production time |
| `write_status` CHECK enum vs. `markDetourWriteResult`'s possible values | recommend a small meta-test asserting `markDetourWriteResult` is never called with a value outside `('none','pending','written','failed','conflict')` — e.g. wrap the prepared statement in test scaffolding that inspects the bound parameter, or simply assert the SQL `CHECK` string (via `sqlite_master`, same technique as §4a) lists exactly those five values | new, recommend folding into §3e or a small schema-only test in `plan-writeback.test.js` |

---

## 7. Test data / fixtures

- **Plan file fixtures:** reuse `plan-ingest.test.js`'s `writePlan()` /
  `fs.mkdtempSync` pattern verbatim in every new spec that touches
  `AGENT-PLAN.md` bytes (`plan-writeback.test.js`). Do not hand-roll a
  second file-writing helper — flagged explicitly in both source docs as a
  drift risk.
- **Pace fixtures:** the `item(overrides)` POJO helper in §1 — no DB needed
  for the pure-function block.
- **LLM stub fixtures:** copy `fakeSpawn()` / `fakeSpawnSequence()` /
  `envelope()` from `focus-summary.test.js` verbatim into
  `reconciliation.test.js` (per-file copy convention already established by
  this repo, see that file's own comment on `fetch()`).
- **Conflict-window fixture:** the injected hook itself *is* the fixture —
  `__injectPreRenameHookForTest(() => fs.writeFileSync(planPath, humanEdited))`.
  No timers, sleeps, or worker threads anywhere in this suite.
- **Adversarial sanitizer fixtures:** the table in §3c —
  `{ name, field, input, mustNotAppearAsParsedField }` — table-driven, one
  `it()` per row.
- **`detour_dispositions` seed rows:** direct `INSERT`/`stmts` calls (same
  technique `plan-ingest.test.js` uses to seed `declared_done_at` directly),
  so `plan-writeback.test.js`'s traceability tests and
  `detour-disposition.test.js` remain independently runnable regardless of
  build order (Layer 5 → 4 → 6 per DEC-3).
- **Out-of-order `events`/`focus_inferences` fixtures:** reuse the exact
  scrambled-insertion technique from `focus-report.test.js`'s
  `"never lets active_ms exceed wall_ms … when events land out of
  chronological order"` test (~line 370) for every new §9.2-guarded query.
- **Threshold env vars:** each of `DASHBOARD_PACE_GRACE_DAYS`,
  `DASHBOARD_RECONCILE_LOOKBACK_DAYS`,
  `DASHBOARD_DETOUR_VOLUME_MIN_SESSIONS`, `DASHBOARD_DETOUR_VOLUME_THRESHOLD`,
  `DASHBOARD_DETOUR_PENDING_DAYS`, `DASHBOARD_DETOUR_CONFIDENCE_MIN`,
  `MAX_DETOURS_PER_TICK`, `MAX_TARGETS_PER_TICK` needs one explicit-set-value
  test and one default-when-unset test, mirroring
  `focus-report.test.js`'s idle-grace-window suite shape (`beforeEach` should
  `delete process.env.X` for each, matching `focus-summary.test.js`'s
  existing `beforeEach` pattern).

---

## 8. How to run

- Backend, full suite (must be green before/after every layer, per
  `CLAUDE.md`): `npm run test:server`
- A single new spec in isolation while iterating:
  `node --test server/__tests__/pace-tracking.test.js`
  `node --test server/__tests__/atomic-file.test.js`
  `node --test server/__tests__/plan-writeback.test.js`
  `node --test server/__tests__/detour-disposition.test.js`
  `node --test server/__tests__/reconciliation.test.js`
- Immediately after the `atomic-file.js` extraction, in isolation, before
  anything else: `node --test server/__tests__/cc-config.test.js`
- Client (must stay untouched/green — no client edits in this effort):
  `npm run test:client`
- File-header audit (six-plus new `.js` files need the header):
  `bash .claude/skills/file-headers/scripts/check-headers.sh`
- MCP typecheck/build: **not required** — WATCH-6, no MCP surface this
  round.
- Grep gates worth running once at the end (cheap, catch stale-assertion
  regressions the tests above can't by themselves):
  - `grep -rn "linked_plan_item_id" server/` → must return zero hits (DEC-14
    spelling; the correct column is `resolved_item_id`).
  - `grep -rn "plan_items row count is unchanged" server/__tests__/` → must
    return zero hits tied to `fold_in`/`new_item` (DEC-12 residue).
  - `grep -rln "__injectSpawnForTest\|__injectPreRenameHookForTest" server/__tests__/reconciliation.test.js server/__tests__/plan-writeback.test.js` →
    both files must appear (proves the seams are actually used, not just
    imported).

---

## 9. Red-first summary (what proves these tests are guards, not decoration)

Every spec above is unwritable against today's tree (the modules it imports
don't exist), so the "before" state is a hard red (module-not-found) across
the board — that's necessary but not sufficient. The assertions were chosen
so that, once a plausible-but-wrong implementation exists, they still fail
for the *specific* reason named in the brief/plan rather than merely
"the function throws":

1. **§1 pace.js:** an implementation that treats `target_date === today` as
   `behind`, or lets a completed item report `behind`, fails the two
   boundary/exempt tests specifically — not a generic assertion mismatch.
2. **§2 atomic-file.js:** an implementation that unlinks the tmp file but
   still corrupts the original on a failed rename fails the
   "original file untouched" assertion specifically, distinct from the
   generic "does it throw" check.
3. **§3 plan-writeback.js:** a write-back that calls `upsertPlanItem`
   directly instead of writing bytes + re-ingesting fails 3a's "file
   contains the block before the ingest step runs" ordering; a missing
   optimistic lock fails every case in 3b because `CONFLICT` never occurs; a
   sanitizer that only string-transforms fails the parse-back assertions in
   3c even when the raw string looks clean; an off-by-one retry loop fails
   3e's exact-call-count assertions.
4. **§4 detour_dispositions:** a disposition module that clobbers a decision
   on re-inference fails 4e; an enum drift between JS and SQL fails 4a's
   meta-test before any behavioral test even runs; a classifier that
   secretly reaches the write path fails 4h's byte-identical-file assertion.
5. **§5 reconciliation.js:** an LLM call from inside `evaluateRules` fails
   immediately via the throw-on-call stub in 5a; passing the LLM more than
   the rule-flagged set fails 5b's input-set assertion even if every
   individual verdict-mapping test still passes; a missing
   `findOpenQueueItem` guard fails 5c's two-tick re-run test specifically.

This is the concrete list DEC-7's live-trial gate (a green suite is not
sufficient sign-off) is meant to sit on top of — these tests are the fast,
deterministic floor; the live trial in `technical-plan.md` §8 is the ceiling
that still requires Sara's own review of real `AGENT-PLAN.md` content before
this is called done.
