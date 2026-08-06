# Review Findings — build/2026-08-05-altitude-invalidation (Step 6, build-reviewer)

**Verdict: ISSUES FOUND — 6 blockers, 11 should-fix, 7 nits.**

Diff reviewed: `git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor diff c8eecf374cde7fcc3118f5abeeb4aded49caf600`
(23 files, +3942/−106), **plus** two untracked new test files invisible to that diff
(`server/__tests__/value-summary-interrupted-boot.test.js`, `server/__tests__/value-summary-legacy-boot.test.js`).

Read in full first: `decisions.md` (DEC-B1..B5), `supporting/green-evidence.md`,
`supporting/red-evidence.md`, `build-task-list.md`, `PROJECT-CONTEXT.md` §9.1/§9.3/§9.5/§9.6/§9.7/§9.8,
`decisions-qa-addendum.md` (DEC-17..DEC-26).

Every blocker below was **reproduced by direct execution**, not inferred from reading.
None of them re-litigates DEC-B1/B3/B4/B5 — DEC-B4's cache-hit marker fix (D6b) is
genuine and correct; I verified it independently.

---

## BLOCKERS

### BL-1 — `enrichPoolAltitudes`'s empty-batch early return omits `counts`; `POST /altitudes` crashes the server process (§9.3-family partial fix, and the test suite pins the defect)

**Where:** `server/lib/value-summary.js`, `enrichPoolAltitudes`:

```js
if (!units || units.length === 0) return { altitudes, states };   // no counts
```

`counts` is constructed *after* this line. Every other return path was widened to
`{altitudes, states, counts}`; this one was not — one boundary fixed, its sibling missed.

**Reproduced (route, real Express app, `server/index.js` `createApp` + `startServer`):**

| request | before this build | now |
|---|---|---|
| `{project_id:"p1", units:[]}` | 200 `{altitudes:{},states:{}}` | **no response ever** + `TypeError: Cannot read properties of undefined (reading 'pool_size')` |
| `{project_id:"p1", units:[{unit_key:"k1", value_source:"nope"}]}` | 200, `states.k1="unavailable"` (documented S3 behavior) | **no response ever** + same TypeError |
| `{project_id:"p1", units:[{value_source:"trunk_commit"}]}` (key-less) | 200 `{altitudes:{},states:{}}` | **no response ever** + same TypeError |

Express 4.22 does not catch async handler rejections. With no `unhandledRejection`
handler registered (the dashboard registers none), Node 22's default `--unhandled-rejections=throw`
**exits the process**. I confirmed both outcomes: with a handler installed the request
hangs to client timeout; without one the node process dies on the first such request.

**Reproduced (tick):** a project whose pool assembles to zero units now throws inside the
per-project try, so it logs `outcome='error'` and takes the `upsertValueSweepStateKeepPending`
branch — **every sweep, forever**:

```
value summary sweep failed for project tick-empty-…: Cannot read properties of undefined (reading 'pool_size')
log row: {"source":"tick","outcome":"error","pool_size":0,...,"stale_regenerated":null}
```

That silently corrupts the AC-2 audit trail and freezes `pending_after_sweep` for those projects.

**Why green hid it — the test suite encodes the bug:**
- `server/__tests__/value-summary.test.js:199`
  `assert.deepEqual(await enrichPoolAltitudes(dbModule, []), { altitudes: {}, states: {} });`
  actively asserts `counts` is **absent**.
- `server/__tests__/value-summary.test.js:270` comment: *"Every **non-empty** call also carries `counts` (DEC-14)"* — the carve-out was written to fit the defect rather than fixing the composer.
- The only route test that posts `units: []` (line 503) omits `project_id`, so it 400s before reaching the composer. `{project_id, units: []}` is untested.

**Fix:** construct `counts` before the early return and return it there too. Rewrite the
line-199 assertion to the full three-key shape. Add route coverage for `{project_id, units: []}`
and for an all-dropped batch (`droppedCount === units.length`), and a tick test for an empty pool
asserting `outcome='ok'`.

---

### BL-2 — The four-term partition identity, this slice's "unconditional" invariant, breaks on duplicate submitted unit keys

**Where:** `server/lib/value-summary.js`, `enrichPoolAltitudes`.
`counts.pool_size = units.length + droppedCount` is computed over the **raw** list;
every counted term is accumulated over `dedupedMisses` (post-dedupe).

**Reproduced** (`DASHBOARD_FOCUS_INFER_MODE=off`, two identical uncached units):

```
counts: {"pool_size":2,"cache_hits":0,"generated":0,"queued":0,"unavailable":1,"stale_regenerated":0}
four-term sum: 1   pool_size: 2   IDENTITY HOLDS: false
```

This writes a corrupt `value_summary_generation_log` row through `POST /altitudes` (which never
dedupes before calling the composer). Duplicates are an **explicitly anticipated** input — the
dedupe's own comment says *"a caller-supplied duplicate straddling the MAX_UNITS_PER_PROMPT
boundary…"*. Neither `COUNTS-SHAPE`, `COUNTS-DROPPED`, `ROUTE-SEAM-1` nor `DEC-11-ANTIFIX`
submits a duplicate.

**Trap:** DEC-23 (QA-DEC-7) justified `opts.droppedCount` precisely so the four terms sum
*"by construction rather than by arithmetic care."* As built it is still arithmetic care —
over a **different list** than the one the terms are counted from.

**Fix:** dedupe by `unitKey` once at the top of `enrichPoolAltitudes` and derive
`pool_size` from the deduped list (+ `droppedCount`); or fold the deduped-away count into a
term explicitly. Then extend `COUNTS-SHAPE`/`ROUTE-SEAM-1` with a duplicate-key fixture.

---

### BL-3 — §9.3 VACUOUS-GUARD: all nine new `UPGRADE_CASES` entries are dead code, never executed

**Where:** `server/__tests__/db-migration.test.js`.

The `UPGRADE_CASES` harness only ever exercises **`UPGRADE_CASES[0]`** (`plan_items.target_date`)
— see lines 870, 909–913. Every other entry's `legacySql` / `seed` / `assertLegacyRow` /
`assertWritable` is never called; only `uc.table` / `uc.column` are read, by the registry
meta-scans. This build added **nine** such entries (five `value_unit_summaries` columns,
`stale_regenerated`, `outcome`, `model`, `duration_ms`) whose entire stated purpose
(build-task-list §5.1/§5.2, §7.1) was to prove M1/M2 migrate correctly.

**Proof the bodies never run:** the M2 `assertWritable` calls

```js
stmts.insertValueSummaryGeneration.run("project-2", "request", 15, 8, 4, 2, 1, 3);
```

— 8 arguments into an 11-placeholder statement, with `15` landing in the CHECK-constrained
`outcome` slot. If it ever executed it would throw `RangeError: Too few parameter values were
provided` (the exact failure green-evidence diagnosed as defect #3 elsewhere). The suite is green.

**What that leaves uncovered:** the executed tests
`"M1: five-column ALTER converges on fresh database"` and `"M2: stale_regenerated column
exists…"` only assert the columns exist on a **fresh** DB — which `CREATE TABLE` guarantees
whether or not `addColumnsIfMissing` ever runs. Both are vacuous with respect to their own
names. Only `M1-INT` genuinely exercises the migration path. **`value_summary_generation_log`'s
four new/backfilled columns have zero executed legacy-migration coverage.**

**Fix:** make the harness iterate `UPGRADE_CASES` (or at minimum add real
seed-legacy-DB → boot → assert tests for M1 and M2 in the dedicated `describe`s), and fix the
M2 `assertWritable` arity while doing it. Add build-task-list §5.1's missing `it 4`
(the DEC-9 behavioral leg with its anti-vacuous precondition).

---

### BL-4 — §9.3 VACUOUS-GUARD: `MIG-HELPER-1` asserts nothing; `MIG-HELPER-2/3/4` were never written

**Where:** `server/__tests__/db-migration.test.js`, `describe("addColumnsIfMissing helper contract (MIG-HELPER)")`.

The single `it` creates a scratch table and closes the DB. **Zero assertions.** It does not test
the non-existent-table case its own title names. Its comment is the tell:
*"For this test, we verify the behavior through the end result (if the function exists and works,
the migration succeeds; if not, this test fails)"* — it cannot fail.

build-task-list §5.3 required four helper-contract tests: (1) non-existent table → `false`,
no throw; (2) failed ALTER caught, logged, `false` returned, **no throw**, other columns converge
from partial state; (3) idempotent, returns `false` on second call; (4) partial state adds exactly
the missing columns. **None exist.**

This matters more than a normal missing test: `addColumnsIfMissing`'s "NEVER throws" property is
the entire reason A-1 was MANDATORY (per DEC-25, a throw out of `require()` bricks Express, MCP,
the Electron app and the VS Code extension simultaneously against the one shared user-global DB).
That property is currently **unasserted anywhere**.

**Fix:** write MIG-HELPER-1..4 as specified, each red-proven (e.g. remove the try/catch → #2 red;
remove the per-column filter → #3 red).

---

### BL-5 — The A2 structural scan ships the weak form DEC-24 explicitly forbade; evasion class #9 passes green

**Where:** `server/__tests__/single-writer-guard.test.js`,
`it("buildPrompt reads no unit field outside unitFacts(u) — DEC-15 structural scan (A2)")`.

DEC-24 (QA-DEC-8) is unambiguous: nine assertions, eight individually-observed red mutations,
and *"**No veto path.** This is the slice's one never-traded-away item; the weak form ships the
cure evadable."*

**Shipped:** three assertions, all scoped to the `.map` **callback body** only:
(b) no `u.<field>` dot access, (g) `unitFacts(u)` present, (h) `u` mentioned exactly once.
The rest of `buildPrompt`'s body (`funcBody` outside the callback) is never scanned.

**The dropped assertion left its fingerprint:**

```js
const arrayParam = buildPromptSig ? buildPromptSig[1].trim() : "units";   // never used again
```

`arrayParam` is extracted and then **never asserted on**. That is exactly DEC-24's assertion (i)
— *"the array parameter is mentioned exactly once, immediately followed by `.map(`"* — the
designated closure for evasion class **#9 (`units[0].stage`)**, mutation `M-A2-7`, which DEC-24
records as *"found while reconciling the two QA documents… It matches **none** of the designed
regexes."*

**Verified:** I re-ran the shipped scan logic verbatim against a mutated copy of
`server/lib/value-summary.js` containing, inside `buildPrompt`:

```js
const sneak = units[0].stage ? 1 : 0;
```

Result: **PASS** — identical verdict to the unmutated file. Any aliasing or field read placed
outside the map callback is likewise invisible.

**Also missing:** DEC-24's mandated evasion-#8 disposition, which it says *"**must** be written
into the scan's own comment, or it becomes §9.1's 'one call frame away' recurrence with a green
tick over it."* The scan's comment instead reads *"This test will be RED at this stage (no
unitFacts exists)"* — stale authoring scaffolding, now false, sitting where the required
disposition should be.

**Fix:** add DEC-24's assertion (i) (use `arrayParam`: exactly one mention, immediately followed
by `.map(`), extend the dot-access/mention checks to the whole `funcBody`, add the bracket-access
and destructuring assertions, and write the evasion-#8 disposition into the comment. Record a red
proof per assertion.

---

### BL-6 — The §9.1 durable cure's central claim is false as built: `unitFacts` has three fields, `compareUnitInputs` compares two, and nothing guards the gap

**Where:** `server/lib/value-summary.js`.

```js
function unitFacts(unit) {
  return { value_source: …, label: …, stage: … };     // 3 fields
}
function compareUnitInputs(row, unit) {
  if ((row.input_stage ?? null) !== facts.stage) return "stage_changed";
  if ((row.input_label ?? null) !== facts.label) return "label_changed";
  return null;                                         // value_source never compared
}
```

`buildPrompt` renders `value_source` into the prompt (`` `${i}. [${facts.value_source}] …` ``),
there is no `input_value_source` column, and no snapshot of it is stored. Yet both the file
header and `unitFacts`'s own JSDoc assert:

> *"adding a field to the prompt is physically impossible without adding it to the comparison"*

That is **false today** — `value_source` is the live counterexample. It happens to be harmless
only because `unit_key` embeds `value_source`, i.e. a *different* invariant that nothing in this
build asserts and no comment connects to the claim.

The A2 scan guards `buildPrompt → unitFacts`. Nothing guards `unitFacts → compareUnitInputs`.
This is precisely the residual risk the PROJECT-CONTEXT §9.1 pre-flag **this build itself added**
names: *"a **prompt** that grows a field the **comparator** doesn't cover."* The cure was built for
one direction and documented as if it closed both.

**Fix:** a coverage test that walks `Object.keys(unitFacts(fixture))` and asserts that mutating
each key makes `compareUnitInputs` return non-null — with an explicit, named registry entry
excepting `value_source` and citing `unit_key` as its guarantor (an enumerated exception, §9.7's
own rule, not a silent one). Then correct the two comments to state what is actually enforced.

---

## SHOULD-FIX

**SF-1 — "Dismiss all" was never built; DEC-21's accepted-risk mitigation is missing and its pin was dropped.**
`dismissAll` exists in all four locales (`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`)
and is referenced **nowhere** in `client/src/`. `PlanLedgerPanel.tsx` has only the per-unit "×".
build-task-list §19.3 required a panel-level *"dismiss all updated markers"* batching keys.
DEC-21 (QA-DEC-5) accepted the first-upgrade marker flood (~182 legacy mutable rows each arming a
`label_changed` marker) **on the condition** that *"the mitigation is **tested, not assumed** —
`C2(c)` asserts 60 unseen units are batched into **one** `markAltitudesSeen` call carrying exactly
the unseen key set."* The rewritten C2 has legs (a) and (b) only; there is no (c). Net effect:
Sara's first post-upgrade panel view needs ~182 individual clicks, and the accepted risk has no
mitigation. The i18n parity test can't see this (it checks en→locale parity, not key usage).

**SF-2 — The dismiss "×" renders on markers it cannot dismiss, and mis-stamps `seen_at`.**
`ValueUnitRow` shows the dismiss control for *any* `markerKey`, including `stale_refresh_queued`/
`stale_refresh_unavailable` (test `C1b` asserts this). But `reHomeStaleUnits` recomputes those
markers from staleness on every read and never consults `seen_at`, so the marker returns on the
next load while the client optimistically clears it — a visible lie. Meanwhile the POST carries the
row's *old* `regenerated_at`, so the CAS matches and stamps `seen_at` for an **earlier, separate,
still-unacknowledged** generation. Sequence that loses a marker: regenerate at t1 (unseen) → unit
goes stale, LLM down → re-homed `stale_refresh_unavailable` → user dismisses → `seen_at` stamped
for t1 → user reverts the stage → cache hit with `regenerated_at=t1 && seen_at` set → **no marker**,
though the t1 update was never acknowledged. That is the T-D class DEC-17's CAS exists to prevent.
Fix: don't render dismiss for `stale_refresh_*`, or give those markers their own no-op affordance.

**SF-3 — §9.7: `ALTER-BLOCK-SCAN` over-claims relative to its name; the registry was pruned to match the regex's blind spot.**
The pruning itself is honest — I verified `agents.workflow_run_id`, `model_pricing.fast_input_per_mtok`
and `context_snapshots.input_tokens` really are separate `db.prepare(…).run()` calls, not `db.exec`
template blocks, so the scan never saw them. But the scan's title is *"no multi-column ALTER block
bypasses addColumnsIfMissing"*, and the dominant form of that hazard in `db.js` is invisible to it:
N sequential `db.prepare("ALTER …").run()` behind **one** probe inside a `catch` —
`server/db.js:1029-1032` (agents: 2 ALTERs, one probe on `workflow_run_id`) and
`server/db.js:2059-2071` (context_snapshots: 3 ALTERs, one probe on `input_tokens`). Those are
*exactly* the T-E defect `addColumnsIfMissing` was built to cure (die between ALTER 1 and 2 → the
probe succeeds forever → remaining columns permanently missing, silently). Either widen the scan
to that form and grandfather those two with dated reasons, or rename the guard and say in its
comment what it cannot see.
(Sub-note: the scan's `if (firstColMatch)` silently skips any matched block it can't parse a first
`ADD COLUMN` from. Today that only skips the legitimate `DROP COLUMN` block — benign — but a silent
skip inside an exact-match guard should log/assert rather than drop.)

**SF-4 — Scope creep + fresh/migrated schema divergence in the second `addColumnsIfMissing` call.**
`server/db.js` adds `outcome`, `model`, `duration_ms` to `value_summary_generation_log` alongside
`stale_regenerated`. Neither the technical plan nor build-task-list §6.3 mentions them (the code
comment acknowledges this). More substantively, `outcome: "TEXT NOT NULL DEFAULT 'ok'"` added via
ALTER carries **no CHECK**, while the fresh `CREATE TABLE` body has
`CHECK(outcome IN ('ok','skipped','error'))`. A migrated DB will accept `outcome='bogus'`; a fresh
one won't. Same for legacy `source` (no CHECK on the pre-slice shape). That is a §9.5-adjacent
fresh-vs-migrated divergence introduced without a note. Either split this into its own change with
a rebuild, or document the divergence in `docs/DATABASE.md` and open a WATCH row.

**SF-5 — `db.stmts = stmts;` is production code bent to accommodate defective tests.**
`server/db.js` (just above `module.exports`). I grepped `server/lib/**` and `server/routes/**`:
**no production code reads `db.stmts`.** It exists only so test files that pass the raw
better-sqlite3 handle where a `dbModule` is expected (e.g. `value-summary.test.js:893, 901, 924,
931, 953`) keep working. It permanently blurs the `db` vs `dbModule` distinction the single-home
discipline rests on, and it is a half-measure: such a caller still explodes on the seen route's
`dbModule.db.transaction(...)`. Fix the tests to pass `dbModule`; delete the alias.

**SF-6 — The route's log write and seen-transaction have no `try/catch`; the tick's does.**
`server/routes/project-plans.js`: `insertValueSummaryGeneration.run(...)` runs unguarded *after*
the LLM work and cache writes have already completed, and `ackTxn()` in `/altitudes/seen` is
likewise unguarded. `value-summary-tick.js` deliberately wraps its equivalent write ("Per-project
fail-safe"). Under Express 4 an async throw here means no response + unhandled rejection +
process exit — the same mechanism as BL-1. An audit-log failure must not sink a request that
already succeeded.

**SF-7 — `L4` is still vacuous (DEC-B1 explicitly deferred this judgement to this step).**
`server/__tests__/value-summary-tick.test.js`, `it("L4: tick counts sourced from composer counts (DEC-14)")`:
`assert.ok(logRow.cache_hits >= 0)` ×4 plus the four-term identity. Both held under the
**pre-Slice-1** tick's hand-rolled counting loop, so L4 cannot distinguish a correct fix from a
no-op — exactly what DEC-B1 asked me to re-check once Step 8 landed. It also uses default
`trunk_commit` units, so `stale_regenerated` is never exercised. A non-vacuous version stubs the
composer to return a `counts` object deliberately inconsistent with its own `altitudes`/`states`
and asserts the log row carries the composer's numbers.
`L2`'s second assertion (`stale_regenerated <= generated + queued + unavailable` → `5 <= 40`) is
trivially true and should be dropped or tightened.

**SF-8 — DEC-19's CONTRACT-SPEC-DRIFT catalog note was not applied.**
DEC-19 (QA-DEC-3) states the scope-limit note is *"**required**, applied verbatim on the effort
branch at the catalog step"* — not optional. The `PROJECT-CONTEXT.md` diff contains only the two
DEC-10 notes (§9.1 and §9.8) that DEC-B4 already caught being skipped. The CONTRACT-SPEC-DRIFT
candidate section (~line 1306) is untouched. Source text: `qa/qa-assessment.md` §"Catalog notes".

**SF-9 — Duplicated query: `readCached` fetches the row, discards it, and the caller immediately re-fetches.**
`server/lib/value-summary.js`: on a stale hit `readCached` returns `{cached: null, staleReason}`,
throwing away the `row` it just read; `enrichPoolAltitudes` then calls
`dbModule.stmts.getValueUnitSummary.get(unit.unitKey)` again to populate `staleRows`. Return the
row from `readCached` (e.g. `{cached, staleReason, row}`) and drop the second query.

**SF-10 — Nothing is committed, and two new test files are untracked.**
`git log c8eecf3..HEAD` is empty; all 23 modified files are unstaged, and
`server/__tests__/value-summary-interrupted-boot.test.js` +
`server/__tests__/value-summary-legacy-boot.test.js` are `??` — they contain the B1–B4 suites
green-evidence relies on, yet are invisible to `git diff` and would be lost by any
`git checkout`/`stash`/`clean`. `supporting/red-evidence.md` is also stray at the worktree root
(build artifacts belong under the request tree). build-task-list §3 required an artifacts commit
*"before the first line of build code."* Given this repo's recorded concurrent-session risk, commit
before anything else.

**SF-11 — The request path always logs `model: null`.**
`server/routes/project-plans.js` passes `null` for `model` even when the call generated text with a
real model; the tick logs the actual model. `counts` doesn't carry it. Either return the model from
the composer or document why the request path's rows are model-blind.

---

## NITS

- **N-1** `value-summary-tick.test.js`, L1: shipped assertion message
  `"no overflow (45 total fits in 40 cap... wait, math)"`, immediately followed by a comment that
  contradicts it (`// Actually, 40 cap, pool 45, so 40 resolve, 5 queue`). The assertion
  (`queued === 0`) is correct — 10 are cache hits, so only 35 miss — but the prose will lead a
  future reader to "fix" a correct assertion.
- **N-2** `docs/API.md`: `/altitudes/seen` described as *"clearing `seen_at`"*; it **sets** it.
- **N-3** `PROJECT-CONTEXT.md` §9.1 pre-flag ends with a stray unmatched `"`.
- **N-4** Two inline copies of the comment stripper (W-3 handler scan, A2 scan) instead of the
  shared `stripComments(source)` build-task-list §9.1 specified.
- **N-5** `buildPrompt`'s `let i = 0; units.map((u) => { i += 1; … })` replaces the natural
  `map((u, i) => …)` purely to satisfy the scanner; harmless, but it is code contorted to fit a
  guard and deserves a one-line comment saying so.
- **N-6** `regenerated_at` uses `new Date().toISOString()` (millisecond resolution). Two
  regenerations within the same millisecond let a stale acknowledge pass the CAS. DEC-B2 records
  that ms collisions do occur in this suite.
- **N-7** `client/src/lib/api.ts` / `types.ts` never declare the new `counts` field on the
  `/altitudes` response, though `docs/API.md` and `server/README.md` document it as part of the
  contract.

---

## What I checked and found clean

- **DEC-B4/B5's cache-hit marker fix is real and correctly scoped.** `D6b` is a genuine
  three-read sequence on a mutable source, not vacuous; the `cached.regenerated_at && !cached.seen_at`
  branch is right, keeps `cached: true` (so `counts.cache_hits` stays correct), and the marker is
  correctly a function of acknowledgement rather than of "this read regenerated."
- **`counts` is genuinely computed once and read verbatim by both loggers.** The tick's remaining
  `!entry.cached` loop only builds `generatedKeys`/`model`; re-homed stale entries carry
  `cached: true`, so `generatedKeys.length === counts.generated` — no divergence. (§9.8/DEC-14 met.)
- **A-5 compare-and-set is correct**: `regenerated_at IS ?` (not `=`) so the first-generation NULL
  leg matches; `seen_at = NULL` is hardcoded in the upsert's `ON CONFLICT` branch, so regeneration
  re-arms; `updated` honestly reports rejected stamps. No path stamps `seen_at` for a generation
  the row doesn't currently hold — except via SF-2's stale-marker dismiss button.
- **`addColumnsIfMissing` is atomic and convergent** as claimed: per-column `PRAGMA table_info`
  probes, one `BEGIN`/`COMMIT`, rollback-and-log on failure, never throws out of `require()`.
  `HELPER-CASE-SCAN`'s regexes do correctly match both call sites and all nine `table.column`
  pairs — no column evades **registration** (the failure is that registration proves nothing,
  BL-3). `M1-INT` genuinely proves convergence from a mid-crash partial state.
- **`GRANDFATHERED_ALTER_BLOCKS`'s pruning is factually accurate** (verified against `db.js`) —
  the concern is the scan's reach, not dishonest bookkeeping (SF-3).
- **`W-2`/`W-3`/`A2-HOME`/`assertSingleHome` widenings are correct and exact**, not weakened.
- **Docs are substantive and accurate**: `docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`,
  `server/README.md` all describe the shipped behavior (including the marker's
  "surfaces on every read until acknowledged" semantics). Header audit exits 0.
- **Client rewritten marker tests (C1/C1b/C2/C3) are structural, not vacuous** — per-row scoped
  `within(row).getByRole("button", …)`, negative assertions on the no-freshness row, and C3's
  freshness warn isolated by message content from the pre-existing states warn.
- **No scope creep outside the task list's file set**, except `addColumnsIfMissing`'s three extra
  columns (SF-4) and `db.stmts` (SF-5).
