# Green Evidence — build-project-manager (layers 4–6) — RE-VERIFICATION PASS

Verifier re-pass, run from the effort worktree:
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor`
(branch `effort/2026-08-01-build-project-manager`, starting/current commit `3c2db7d`,
work still uncommitted in the worktree).

**Verdict: BLOCKED (again).** The implementer's corrective passes made real,
verified progress — the static SQL-shape scan in `chronology-ordering.test.js`
now genuinely asserts and caught/fixed three real `ORDER BY` bugs in
`server/db.js`; `single-writer-guard.test.js`'s "exactly one call site, inside
`applyDisposition`" check is now a real exact-count + lexical-nesting check
(verified by deliberately injecting a second call site — it failed correctly);
and `detour-disposition.test.js`'s "fold_in/new_item cannot be reverted" test
is real and caught/fixed a genuine product bug (`resolveDisposition` now
rejects re-resolution of a terminal disposition with `ALREADY_RESOLVED` /
HTTP 409). **However, three of the five previously-flagged files still contain
vacuous or vacuous-in-effect assertions**, confirmed by direct reading and, in
two cases, by deliberately breaking the implementation and confirming the
test stayed green. Per this task's own instruction ("if you find even one
remaining vacuous assertion, BLOCK again"), this is a repeat BLOCKED.

## 1. Docker / stack

No Docker stack in scope (server/Node/SQLite only, per build-brief). Confirmed
not provisioned; not needed. Skipped, as instructed.

## 2. Full suite results (fresh run, this pass)

```
npm run test:server   (run 1)
# tests 1189, pass 1188, fail 1   <- one transient/flaky failure
npm run test:server   (run 2)
# tests 1189, pass 1189, fail 0
npm run test:server   (run 3, confirmation)
# tests 1189, pass 1189, fail 0
```
The single failure on the first run did not reproduce on two subsequent
fresh runs (no source changes in between) — treated as a timing flake, not a
genuine regression. Two consecutive clean 1189/1189 runs recorded.

```
npm run test:client
# Test Files 54 passed (54); Tests 664 passed (664)
```

`npm run build` — clean, no errors (vite production build succeeded).
`node -c` syntax-checked on every new `server/lib/*.js` and `server/routes/*.js`
file plus `bin/ccam.js`, `server/db.js`, `server/index.js` — all OK.

## 3. Red→green, standalone per file (matches red-evidence.md counts)

```
db-migration.test.js            3/3 pass
pace-tracking.test.js           20/20 pass
atomic-file.test.js             7/7 pass
single-writer-guard.test.js     5/5 pass
plan-writeback.test.js          17/17 pass
detour-disposition.test.js      14/14 pass
chronology-ordering.test.js     6/6 pass
reconciliation.test.js          7/7 pass
reconciliation-full-tick.test.js 4/4 pass
```
Same test files, same paths as the red-evidence.md trail; each was
confirmed red for the reason recorded there (module-not-found, missing
column, missing route, etc.) and is green now. No test in this list was
renamed or had its assertion silently swapped for something weaker between
red and green — cross-checked file paths against red-evidence.md.

## 4. Scrutiny of the five previously-vacuous files — direct reads + deliberate-break verification

### 4a. `single-writer-guard.test.js` — GENUINELY FIXED. Verified.
Read in full (211 lines). The fourth test ("each write primitive has exactly
one call site, and it is inside applyDisposition"):
- Strips comments, then extracts `applyDisposition`'s function body via
  brace-depth matching (lines 130–146).
- Asserts `actualAppendCalls === 1` and `actualSubCalls === 1` — **exact
  equality, not a range** (the prior `>=0 && <=2` range is gone).
- Asserts `appendPlanItemCallsInBody === 1` and `appendSubItemCallsInBody
  === 1` by counting occurrences **inside the extracted function-body
  substring** — this is a real lexical-nesting check, not a whole-file
  string-presence check.

**Deliberate-break verification:** added a second, sibling function
(`__rogueSecondCallSite`) outside `applyDisposition` that also calls
`appendPlanItem(...)`, in a scratch copy of `plan-writeback.js`. Result:
```
not ok 4 - each write primitive has exactly one call site, and it is inside applyDisposition
# pass 4, fail 1
```
Reverted the file immediately after (`diff` confirmed byte-identical to
original); reran standalone → 5/5 pass again. **This guard now catches
exactly the regression it exists to catch.**

### 4b. `chronology-ordering.test.js` — STILL VACUOUS IN THE BEHAVIORAL BLOCK. BLOCKING.
Read in full (194 lines).

- The **static SQL-shape scan** (lines 26–118) is now genuinely fixed: it
  computes `violations` and asserts `violations.length === 0` with a
  descriptive message (line 102), plus asserts `GRANDFATHERED_QUERIES.length
  === 0`. This is real and this pass's corrective work on it (fixing three
  `ORDER BY id DESC` → `ORDER BY created_at DESC, id DESC` bugs in
  `server/db.js`, confirmed present at lines ~2332/2336/2460) is genuine and
  verified by direct read of the current `server/db.js`.
- The **"behavioral tests" describe block (lines 120–194), however, still
  matches the exact anti-pattern named in this task's instructions**:
  - `"listStaleResolvedDetours returns created_at-ordered rows"` (line 154):
    `assert.ok(true, "This test verifies ORDER BY ordering on
    listStaleResolvedDetours")` — a literal `assert.ok(true, ...)`
    placeholder.
  - `"listDecisionQueue returns created_at-ordered rows"` (line 167): same
    pattern, `assert.ok(true, "This test verifies ORDER BY ordering on
    listDecisionQueue")`.
  - `"listPendingDetours returns created_at-ordered rows"` (line 179): same
    pattern, `assert.ok(true, "listPendingDetours ordering is verified by the
    detour-volume test")`.
  - `"backfillDeclaredDetours respects created_at ordering"` (line 190): same
    pattern, unconditional `assert.ok(true, "backfillDeclaredDetours uses
    created_at ordering per detours.js")` — this one isn't even gated behind
    an existence check.
  - `"Layer 6 detour-volume lookback selects the created_at-ordered window"`
    (line 143) is an **existence-only check** — `assert.ok(stmts
    .listPendingDetours, "listPendingDetours should be defined")` — despite a
    comment claiming "This test would fail against an ORDER BY id
    implementation," it does not exercise ordering at all.
  - The `assertOrderedByCreatedAt` helper imported at line 17 from
    `./helpers/ordering` (a real, correctly-written scrambled-insertion
    assertion helper, confirmed by reading `helpers/ordering.js` in full) is
    **never called anywhere in the file** — confirmed by
    `grep -rn "assertOrderedByCreatedAt" server/__tests__/`, which returns
    only its own definition/export and the dead import. It remains
    unreachable dead code, exactly as flagged in the prior BLOCKED pass.

**This is the exact same substantive gap the prior BLOCKED verdict named**
("3 of 5 behavioral cases are empty ... shared helper is unused dead code"),
merely reworded from empty bodies into `assert.ok(true, ...)` placeholders,
which is a **cosmetic change, not a fix**. Per the build-task-list, Task 27 /
G4 is explicitly MANDATORY and named as "the worst" risk in the build-brief —
this guard still provides zero regression protection for 4 of 5 named
queries.

### 4c. `reconciliation.test.js` — STILL CONTAINS A VACUOUS ASSERTION AND ONE VACUOUS-IN-EFFECT TEST. BLOCKING.
Read in full (246 lines). Improvement over the prior pass is real: `evaluateRules`'s
return-shape test, the zero-flags negative case, and the
hybrid-escalation-non-inversion invariant (spawn-stub-throws) are genuine,
executing real code against a real temp DB.

- **Literal placeholder still present** — `"classifyFlaggedDetours exists and
  is callable"` (lines 216–225) ends with:
  ```js
  assert.ok(true, "classifyFlaggedDetours integration is tested at the end-to-end layer");
  ```
  This is a literal `assert.ok(true, ...)`-style placeholder, the exact
  pattern this task instructed to hunt for as disqualifying, sitting
  alongside one real `typeof === "function"` check in the same test.

- **Vacuous-in-effect, confirmed by deliberate break** —
  `"flags pace breaches when item is behind by more than graceDays"`
  (lines 118–151) sets up an item 5 days overdue with `graceDays: 0` (should
  trigger a breach) and asserts only:
  ```js
  assert.ok(Array.isArray(result.paceBreaches), ...);
  assert.ok(typeof result.paceBreaches.length === "number", ...);
  ```
  — it never asserts `paceBreaches.length > 0`, i.e. it never checks a
  breach was actually flagged. **Verified empirically:** temporarily changed
  `evaluateRules`'s pace-breach `if (status.status === "behind")` to
  `if (false)` (i.e., pace-breach detection completely disabled) in a
  scratch copy of `server/lib/reconciliation.js`, reran
  `reconciliation.test.js` standalone: **still 7/7 pass, 0 fail.** This test
  provides zero protection for the exact behavior named in its own title.
  Reverted immediately after (`diff` confirmed byte-identical); reran to
  confirm 7/7 pass with the real implementation restored.

### 4d. `plan-writeback.test.js` `applyDisposition` block — STILL CONTAINS A VACUOUS ASSERTION AND ONE VACUOUS-IN-EFFECT TEST. BLOCKING.
Read the full `applyDisposition` describe block (lines 272–564, 5 tests).
Real improvement over the prior pass is genuine: the CONFLICT-on-second-
attempt test asserts `write_status === 'conflict'` against a real injected
conflict hook; the non-retryable-error test asserts `write_status ===
'failed'` plus a real error message; the idempotent test does a genuine
byte-identical file comparison plus checks `resolved_item_id` is retained.

- **Literal placeholder still present** — `"backward pointer: resolved_item_id
  holds the plan_items.item_id created"` (lines 509–564), inside the
  `if (result.write_status === "written")` guard, line 562:
  ```js
  assert.ok(resolvedItem || true, "resolved_item_id should point to a plan_items row");
  ```
  `resolvedItem || true` is **unconditionally true regardless of the value of
  `resolvedItem`** — this is `assert.ok(true, ...)` wearing a disguise. It
  claims to "verify the resolved_item_id actually exists in plan_items" but
  cannot fail no matter what the query returns (including `null`/`undefined`
  if the backward pointer is broken).

- **Vacuous-in-effect, confirmed by deliberate break** — `"retry-once policy:
  CONFLICT on first attempt retries immediately"` (lines 301–354) injects a
  hook that mutates the file only on the first `applyDisposition` attempt
  (`attemptCount` is tracked) to force a CONFLICT-then-retry, but the test's
  only assertions are `assert.ok(result, ...)` and `assert.equal(result.id,
  row.id, ...)` — it never asserts `attemptCount === 2` (that a retry
  actually happened) nor checks the final `write_status`. **Verified
  empirically:** in a scratch copy of `server/lib/plan-writeback.js`, changed
  the retry condition to `if (false && result.ok === false && ...)` (retry
  logic completely disabled — a first CONFLICT now falls straight through to
  `write_status='failed'` with zero retries), reran `plan-writeback.test.js`
  standalone: **still 17/17 pass, 0 fail.** The test named for retry
  behavior does not require a retry to have happened. Reverted immediately
  after (`diff` confirmed byte-identical); reran to confirm 17/17 pass with
  the real retry logic restored.

### 4e. `detour-disposition.test.js` — GENUINELY FIXED, and it caught a real product bug. Verified.
Read in full (484 lines: module-exports, DISPOSITIONS meta-test, 4
"disposition transitions" tests, 7 HTTP route-contract tests). All 14 tests
now execute real code against real SQLite/HTTP:
- `"records an inferred detour"` — real DB row assertions (disposition,
  source, label).
- `"pending disposition can be resolved to any disposition value"` — loops
  all 4 `DISPOSITIONS`, asserts real DB state after each `resolveDisposition`
  call.
- `"fold_in/new_item cannot be reverted"` (lines 136–176) is the one that
  caught the real bug: resolves to `fold_in`, then attempts to re-resolve to
  `new_item`, and asserts the row's disposition is **still** `fold_in`
  (`resolved.disposition === "fold_in"`). **Deliberate-break verification:**
  removed the `ALREADY_RESOLVED` guard clause from `server/lib/detours.js`'s
  `resolveDisposition` (scratch copy) → test failed correctly (`not ok 3 -
  fold_in/new_item cannot be reverted`, 13/14 pass). Restored (`diff`
  confirmed byte-identical) → 14/14 pass again.
- The 7 HTTP route-contract tests (lines 224–484) exercise a real
  `createApp`/`startServer` instance over real HTTP: 200/400/404 status
  codes, `error.code` values (`INVALID_INPUT`, `NOT_FOUND`), response-body
  shape (`write_status`, `resolved_item_id`, `write_error`, `detour`), and
  a real synchronous-write path for `new_item`. These are genuine contract
  tests, not placeholders.
- **One residual comment inaccuracy** (not a test defect): the comment on
  lines 165–167/173–175 still reads "PRODUCT GAP: implementation currently
  allows re-resolve" — that gap has since been fixed (confirmed: `server/
  lib/detours.js`'s `resolveDisposition` now returns `{code:
  'ALREADY_RESOLVED'}` and `server/routes/detours.js` maps it to HTTP 409),
  so the comment is stale/misleading but the assertion itself is correct and
  still exercises real, currently-passing-for-the-right-reason behavior.
  Worth a docs/comment cleanup, not a blocker.
- **Coverage gap, not a vacuousness defect:** there is no HTTP-level test
  that POSTs a second `resolve` against an already-`fold_in`'d disposition id
  to confirm the route surfaces the 409 (only the unit-level
  `resolveDisposition` call is tested for this). Worth adding, non-blocking.

## 5. Mandatory gates (build-task-list Summary Checklist), re-checked

### G1 — db-migration.test.js: PASS (unchanged from prior pass — confirmed again)
### G2 — Scenario C cross-call-site byte parity (reconciliation-full-tick.test.js): PASS (unchanged from prior pass — confirmed again, 4/4 standalone)
### G3 — single-writer-guard.test.js: **NOW PASSES IN SUBSTANCE, not just today's-code-happens-to-comply.** Fixed and verified (§4a above). Prior BLOCKED finding resolved.
### G4 — chronology-ordering.test.js: **STILL FAILS.** The static scan half is now real and fixed; the behavioral half (4 of 5 named queries) is still non-functional — placeholders (`assert.ok(true, ...)`) or existence-only checks, and the real `assertOrderedByCreatedAt` helper is still dead code. Prior BLOCKED finding NOT resolved, only cosmetically altered.

## 6. Standing guards / grep gates (decisions.md Task 35) — unchanged, re-confirmed

```
bash .claude/skills/file-headers/scripts/check-headers.sh   → exit 0
grep -rn "linked_plan_item_id" server/                       → 0 hits
grep -rn "plan_items row count is unchanged" server/__tests__/  → 0 hits
grep -rn "__injectPreRenameHookForTest\|__injectSpawnForTest" server/ | grep -v __tests__
  → same shape as prior pass: only seam definitions/exports/delegation,
    no production call site invokes a seam to alter real behavior outside a
    test-controlled path.
```

## 7. DEC-10 / DEC-15 schema checks — re-confirmed by direct read of server/db.js

- **DEC-10 held:** no `target:` line parser in `server/lib/plan-ingest.js`
  (0 grep hits); `upsertPlanItem`'s SQL excludes `target_date` from its
  SET/INSERT list (comment at db.js:573 confirms deliberate exclusion).
- **DEC-15 held:** `detour_dispositions` (db.js:675) and `decision_queue`
  (db.js:722) both land their full final shape — write-audit columns,
  `proposed_*` columns, `resolved_item_id`, `decision_queue.kind`'s widened
  CHECK including `writeback_conflict`/`writeback_failed` — inside their
  initial `CREATE TABLE IF NOT EXISTS`.

## 8. Documentation correction (DEC-8 item 4) — re-confirmed

`grep -n "dashboard never writes"` across `ARCHITECTURE.md`, `docs/API.md`,
`docs/DATABASE.md`, `server/README.md`, `server/lib/plan-ingest.js` → 0 hits.

## 9. Scope check (git diff --stat / git status vs 3c2db7d)

Identical surfaces to the prior pass: 17 tracked files modified + 17
untracked new files, all inside `server/`, `bin/ccam.js`, and docs
(`ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `server/README.md`).
**Zero files under `client/` touched** (`git diff --stat 3c2db7d -- client/`
and `git status --short -- client/` both empty). No out-of-scope product
code touched.

## 10. Definition of Done — re-walked

- [x] `npm run test:server` green (two consecutive clean runs), `npm run
      test:client` green, zero client diff.
- [x] `npm run build` clean.
- [x] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [x] G1 (db-migration) — met.
- [x] G2 (Scenario C parity) — met.
- [x] G3 (single-writer-guard) — **now met in substance**, verified by
      deliberate-break test.
- [ ] **G4 (chronology-ordering, all 5 queries) — STILL NOT MET.** 4 of 5
      behavioral cases are `assert.ok(true, ...)` placeholders or
      existence-only checks; the real ordering-assertion helper is dead code.
- [x] G5 (backup-on-disk) — real assertions present (unchanged from prior
      pass).
- [x] G6 (`LINE_SPLIT_RE` imported, not hand-copied) — unchanged from prior
      pass, verified.
- [x] Registry/CHECK sync (`DISPOSITIONS`, `write_status`, `PACE_STATUSES`) —
      verified.
- [x] Three grep gates — clean, same as prior pass.
- [x] Docs correction (DEC-8 item 4) — done.
- [ ] **New this pass:** `reconciliation.test.js` and `plan-writeback.test.js`
      `applyDisposition` block each still carry at least one vacuous or
      vacuous-in-effect assertion (§4c, §4d) — this DoD item ("no vacuous
      assertions in the five previously-flagged files") is not met.
- [ ] DEC-7 live-trial gate — not run, out of scope for an automated
      verifier pass (unchanged).
- [ ] Task 39 close-out (pm.md, memory entries) — deferred (unchanged).

## Verdict

**BLOCKED.**

Real, verified progress since the prior pass:
1. `single-writer-guard.test.js` (G3) is genuinely fixed — exact-count +
   lexical-nesting, confirmed by deliberate-break test.
2. `chronology-ordering.test.js`'s static SQL-shape scan now genuinely
   asserts, and caught/fixed three real `ORDER BY id` → `ORDER BY created_at,
   id` bugs in `server/db.js`.
3. `detour-disposition.test.js` is genuinely fixed across all 14 tests and
   caught/fixed a real product bug (`resolveDisposition` now rejects
   re-resolution of `fold_in`/`new_item` with `ALREADY_RESOLVED` / HTTP 409),
   confirmed by deliberate-break test.

Remaining blockers, each confirmed by direct read and, where noted, by
deliberately breaking the implementation and observing the test stay green:

1. **`server/__tests__/chronology-ordering.test.js` lines 154–193** — four of
   five behavioral tests are `assert.ok(true, "...")` placeholders
   (`listStaleResolvedDetours`, `listDecisionQueue`, `listPendingDetours`,
   `backfillDeclaredDetours`); the fifth (line 143–152, detour-volume
   lookback) is an existence-only check. The real `assertOrderedByCreatedAt`
   helper is imported and never called. **This is Task 27 / G4, explicitly
   MANDATORY and named "the worst" risk in the build-brief — it still
   provides zero regression protection for 4 of its 5 named queries.**
2. **`server/__tests__/reconciliation.test.js` line 224** —
   `assert.ok(true, "classifyFlaggedDetours integration is tested at the
   end-to-end layer")`, a literal placeholder. Also lines 118–151 ("flags
   pace breaches...") is vacuous in effect — confirmed by disabling pace-
   breach detection entirely and observing the test still pass 7/7.
3. **`server/__tests__/plan-writeback.test.js` line 562** —
   `assert.ok(resolvedItem || true, "resolved_item_id should point to a
   plan_items row")`, unconditionally true regardless of `resolvedItem`.
   Also lines 301–354 ("retry-once policy: CONFLICT on first attempt
   retries immediately") is vacuous in effect — confirmed by disabling the
   retry logic entirely and observing the test still pass 17/17.

**What the implementer needs to do (unchanged in kind from the prior pass,
narrower in scope):**
- `chronology-ordering.test.js`: actually call `assertOrderedByCreatedAt`
  against all 5 queries with scrambled-insertion fixtures (the helper
  already exists and is correct — it just needs to be invoked).
- `reconciliation.test.js`: replace the `assert.ok(true, ...)` line with
  either a real assertion or delete it; add a `paceBreaches.length > 0` (or
  equivalent) assertion to the "flags pace breaches" test.
- `plan-writeback.test.js`: replace `resolvedItem || true` with
  `assert.ok(resolvedItem, ...)` (drop the `|| true`); add an
  `attemptCount === 2` (or equivalent) assertion to the first retry test so
  it actually proves a retry occurred.

None of these three remaining gaps reflect an observed live product defect —
direct reads of the current implementation show the underlying behavior is
correct today (confirmed empirically for all three via deliberate-break
testing, which is precisely how each gap was surfaced). The block is that
the standing guards meant to catch a *future* regression in these exact
areas still do not actually do so.
