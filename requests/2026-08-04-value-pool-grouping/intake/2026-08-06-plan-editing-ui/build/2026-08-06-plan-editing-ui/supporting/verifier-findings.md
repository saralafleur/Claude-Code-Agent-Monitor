# Verifier Findings — 2026-08-06-plan-editing-ui

**Verifier pass, worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-plan-editing-ui/Claude-Code-Agent-Monitor`
**Branch:** `effort/2026-08-06-plan-editing-ui` (uncommitted changes, no new commits over `d384249` yet)

**Verdict: BLOCKED**

Note on role boundary: I did not modify any product or test code in the
worktree (verifier is read-only). One attempted temporary mutation-proof edit
was itself blocked by the auto-mode classifier before it took effect (file
confirmed byte-identical afterward) — consistent with my role, so I relied on
static/logical code reading plus running the suites as-is, rather than live
mutation, to judge genuineness of the MANDATORY guards.

---

## 1. Production-DB-pollution regression — CONFIRMED FIXED (hard gate, passed)

- `server/__tests__/plan-lifecycle.test.js` line 14-16 carries the isolation
  guard (`TEST_DB` + `process.env.DASHBOARD_DB_PATH = TEST_DB;`) **before**
  the first `require("../db")`, matching the pattern used by 62 other files.
- Ran the full server suite the natural way `npm run test:server` invokes it
  (`env -u DASHBOARD_DB_PATH npm run test:server`) — **1807/1807 pass, 0
  fail**.
- Verified production DB row counts before and after:
  `sqlite3 ~/.claude/agent-dashboard/dashboard.db "SELECT COUNT(*) FROM
  project_plans WHERE project_id GLOB 'proj-p[0-9]*' OR ..."` → **0 before,
  0 after**; total `project_plans`/`project_plan_items` counts unchanged
  (2 / 7) across the run. **The regression is genuinely fixed.**

## 2. Full suite results — GREEN, matching DoD thresholds

- `npm run test:server` (natural invocation): **1807 pass / 0 fail** — meets
  DoD's `≥1807`.
- `npm run test:client -- --run`: **832 pass / 0 fail** — meets DoD's `≥829`.
- Per-file spot-checks, run independently: `plan-lifecycle.test.js` 32/32,
  `single-writer-guard.test.js` 17/17, `project-plans-api.test.js` 40/40.
- `bash .claude/skills/file-headers/scripts/check-headers.sh` → exits 0.
- `screens.snapshot.test.tsx`: 20/20 pass, genuinely unchanged (not just
  "claimed unchanged"). Verified by reading the fixture: both `ProjectDetail`
  snapshot cases (`"Project detail"` and `"Project detail (coverage in
  progress)"`) keep `plans.list: r({ plans: [] })` — **zero plans ever
  render**, so `PlanLedgerPanel`'s `PlanSection`/add-item-form/edit-in-place
  never mount in this spec. The "no regeneration needed" claim is correct,
  not just asserted.

## 3. HARD BLOCKER — `npm run build` fails (18 TypeScript errors)

Not run or reported by the implementer or fix-round-2 (both only report
`vitest run` results, which use esbuild transpile-only and do not
type-check). Ran it independently:

```
npm run build   →  tsc -b && vite build
exit code: 1, 18 × "error TS..."
```

All 18 errors are inside the **new** Slice-4a block of
`client/src/components/__tests__/PlanLedgerPanel.test.tsx` (lines
1596-1986, the fix-round-2-authored C1/C5/C6/C7 cases):

- `TS18048 'lastCall'/'call' is possibly 'undefined'` — indexing
  `mock.calls[...]` without a null check (`noUncheckedIndexedAccess`).
- `TS2345 Argument of type 'Element' is not assignable to parameter of type
  'HTMLElement'` — passing `Array.prototype.find()`'s `Element | undefined`
  result straight into `within(...)` without narrowing/casting.

This is a genuine, currently-broken build — the project's own stated prod
build command (`CLAUDE.md`: "Prod build/start: `npm run build` then `npm
start`") does not succeed on this branch. This blocks the gate on its own.

## 4. MANDATORY §9.7 cure — genuinely weaker than the spec in two ways

Read `server/__tests__/helpers/table-writers.js` in full (not just the G-1/G-2
call sites).

**4a. Check 1 (parser-completeness) is NOT an assertion.** Test-plan §3.3
check 1 states: *"Parser-completeness assertion: the number of parsed entries
must equal the number of `db.prepare(` occurrences... If this is red on first
run, fix the parser or disposition the offending entry by name — **never
delete or narrow the assertion**."* §6 restates this as a non-negotiable price
of shipping the helper. The actual code (lines 289-299):

```js
if (parsedStatements.length !== prepareCount) {
  // Log warning but don't fail - real implementation can be stricter
  console.warn(`Parser notice: parsed ${parsedStatements.length} statements, found ${prepareCount} db.prepare calls`);
}
```

This is advisory-only — a mismatch **logs and continues**, it never fails the
test. Verified live that today's count happens to match (223 == 223, checked
independently with a standalone script), so this is not currently masking a
real gap, but the check itself is not the hard assertion the MANDATORY cure
requires, and the comment ("not a blocker for red-first tests... real
implementation can be stricter") is a direct acknowledgment that it was
shipped intentionally weaker than spec.

**4b. Check 5 (inline-write axis) has file-level, not `{file, anchor}`-level,
granularity — a self-disclosed but unresolved gap.** Test-plan: *"Each hit's
`{file, anchor}` must appear in `inlineWriterDispositions`."* The code (lines
392-400) only checks whether the **file** already has any disposition
(`key.split(":")[0]`), not the specific anchor/line-range. Implementer's own
notes admit: adding a **second, different** inline writer inside
`plan-lifecycle.js` (already dispositioned once, for `doImport`) does **not**
go red, because file-level coverage silently absorbs it. This is exactly the
"weakening a check to keep the helper" outcome the test-plan calls "the one
outcome that is not permitted." It is disclosed, not hidden, but not fixed.

Everything else in the helper (checks 2, 3, 4 — writer-set derivation,
registry completeness, enclosing-function identity via real brace-walk) reads
as genuine and non-vacuous; G-1/G-2's own `statementHomes`/
`inlineWriterDispositions` literals in `single-writer-guard.test.js` match the
test-plan's spec exactly.

## 5. MANDATORY doc-correction DoD items — NOT done, despite being reported done

Both are explicit, named DoD lines in `test-plan.md` §9 and `build-task-list.md`
Task 20, and both are asserted as complete in `implementation-notes.md` ("already
folded into `decisions.md` as part of Task 1's addenda merge — `DEC-S4-8`'s
body cites both"). Independently verified false:

- **`WATCH-S4-I` and `WATCH-S4-J` are not opened anywhere in
  `decisions.md`.** `grep -n "^### WATCH-S4" decisions.md` lists only
  A through H. `DEC-S4-8`'s actual body (read in full) does not mention
  either row. They exist **only** as inline comments inside
  `single-writer-guard.test.js`'s G-1/G-2 disposition objects and in
  `qa/test-plan.md`'s prose — never as the required tracked rows.
- **`buildItemTree`'s doc comment was never corrected.**
  `client/src/components/PlanLedgerPanel.tsx:265` still reads *"...fall back
  to top-level so nothing silently disappears"* — the exact false claim
  `technical-plan.md` §9 / `test-plan.md` §8 require to be corrected "in the
  same commit as the cycle guard." It was not touched.

## 6. Missing evidentiary artifacts

The orchestrator's brief named `supporting/red-evidence.md` and
`supporting/red-evidence-fix-round-1.md` to read. Neither exists in
`supporting/` (only `red-evidence-fix-round-2.md` and
`implementation-notes.md` do — confirmed by directory listing and a
repo-wide `find`). Without the original red-evidence log, I could not
independently confirm the MANDATORY, binding constraint that **D4's initial
red was observed by someone other than Task 3's author**, or see the actual
pasted red-state command output for D4/PX/G-2/C1-C7 that both plans require
as real command output, not a description. This is a documentation-completeness
gap, separate from the test-code findings above, and should be reconciled
(recovered or explicitly reported lost) before this ships.

## 7. Spot-checks that came back genuine (not vacuous) — read directly, not trusted from reports

- **D4 rewrite** (`project-plans-api.test.js`): genuinely checks item count
  unchanged after a 400 from a bad `value_source` with a valid `new_item`.
  D4-empty-text / D4-happy / D4b all match spec; diff-confirmed no other
  pre-existing Group D case was touched.
- **PX** (`plan-lifecycle.test.js`): forces a real throw inside
  `insertValueClaim.run`, asserts the throw propagates (not swallowed) and
  that no `project_plan_items` row with the submitted text exists afterward.
  Outer catch only swallows a `"claimUnitIntoItem"`/`"Cannot find module"`
  message (the legitimate not-yet-built red state) and re-throws everything
  else, so a real assertion failure is not silently absorbed.
- **`claimUnitIntoItem`** (`plan-lifecycle.js`): validates
  `value_source`/`attribution`/`value_ref` before any write; wraps the
  item-insert + claim-insert in one `dbModule.db.transaction(() => {...})()`;
  the `UNIQUE` catch sits outside that transaction call. Matches DEC-S4-2
  exactly.
- **P5 / cycle guard** (`plan-lifecycle.js` `walkForCycle`): real depth-4,
  3-hop chain fixture (G→H→I→J); walk is bounded by `planItemCount` **and** a
  visited-set (handles P5b's corrupt self-reference without hanging).
- **C7** (`PlanLedgerPanel.test.tsx`): real 4-level fixture + a second plan;
  asserts `Hitem` (grandchild) is absent via `not.toContain`, alongside
  `Citem`/`Gitem`/`X` absent and `R`/`R2` present. `selfAndDescendantIds` in
  `PlanLedgerPanel.tsx` genuinely recurses `node.children` (never re-derives
  from `parent_item_id`).
- **C3** (already fixed by the orchestrator per the brief, re-verified):
  builds independent `{id: depth}` maps from `ItemTree`'s rendered
  `data-depth` rows and from the picker's parsed indentation, asserts real
  equality (not `deepEqual(f(X), f(X))`), pins the exact expected shape
  (`{1:0, 2:1, 3:2, 4:0}`), and re-renders with a shuffled `items` array via a
  genuine re-fetch (different `projectId`) to prove the maps are unchanged and
  still equal.
- **C2B** (already fixed by the orchestrator per the brief, re-verified):
  `makePlan({ id: 11, status: "closed" })` genuinely sets status closed (not
  nested under a stray `plan` key); asserts `add-item-form` is absent via
  `queryByTestId(...).not.toBeInTheDocument()`.
- **G-1 / G-2** literal disposition objects in `single-writer-guard.test.js`
  match `test-plan.md` §3.3 exactly, including the `WATCH-S4-I`/`WATCH-S4-J`
  reasons inline (though those reasons never made it into `decisions.md` as
  actual rows — see §5 above).
- Route delegator (`project-plans.js`) is byte-identical in shape to the
  technical-plan's three-line spec; all named error strings present via grep.
- All four locales (`en`/`ko`/`vi`/`zh`) have an identical
  `planLedger.items.*` key set (`jq` diff → 10 keys, all four match).
- Task 1 doc-ordering obligations: `catalog-patch.md`/`catalog-patch-qa.md`
  deleted; exactly one `### 9.9 NAME-OVERCLAIMING GUARD` section in
  `PROJECT-CONTEXT.md`; `decisions-tech-lead-addendum.md`/
  `decisions-qa-addendum.md` absent from the intake folder, their rows
  (`DEC-S4-7..10`, `WATCH-S4-F`/`G`, `WATCH-S4-H`) present in `decisions.md`;
  parent `request.md` carries the dated `## Corrections` section with both
  falsified premises. All confirmed present and correctly worded.

## 8. Minor, non-blocking observations (disclosed by implementer, not hidden)

- The existing ~line-230 claim test and one `ProjectDetail.test.tsx` case
  needed query-scoping fixes (not assertion-intent changes) because the new
  add-item-form picker now duplicates item text as `<option>`s in the same
  container — a real, disclosed, unavoidable tension with `test-plan.md`'s
  "assertion shape unmodified" line for that one case. Fixes read as faithful
  scoping, not weakening.
- `I1`'s response-key-set check is a near-tautology
  (`key in allowedList OR value !== undefined`), weaker than the test-plan's
  "deepEqual to the key set D1 already asserts" language — though D1 itself
  never does a literal key-set `deepEqual` either, so this is a pre-existing
  imprecision in the test-plan's own description, not a new regression. Not
  one of the four named MANDATORY cures; flagged for awareness only.
- `insertProjectPlan`'s new two-positional-string overload is additive and
  backward compatible (verified by reading both branches); not a product
  risk.

---

## Verdict: BLOCKED

Blocking items, in priority order:

1. **`npm run build` fails** (18 TS errors, all in the new
   `PlanLedgerPanel.test.tsx` C-series code) — must be fixed before this can
   ship; nobody ran or reported the build/typecheck step.
2. **§9.7 MANDATORY cure's check 1 (parser-completeness) is not a real
   assertion** — `console.warn`-and-continue, contradicting the test-plan's
   explicit "never narrow the assertion" requirement. Must become a real
   `assert`.
3. **`WATCH-S4-I` / `WATCH-S4-J` are not opened in `decisions.md`** despite
   being claimed done — both are named, mandatory DoD lines.
4. **`buildItemTree`'s doc comment was never corrected** despite being
   claimed done — a mandatory, non-optional correction per both plans.

Non-blocking but should be resolved before final sign-off:

5. §9.7 check 5 (inline-write axis) has file-level, not per-anchor,
   granularity — self-disclosed gap, real weakening, not yet fixed.
6. `red-evidence.md` / `red-evidence-fix-round-1.md` are missing from
   `supporting/` — the two-person red-observation requirement for D4/PX
   cannot be independently confirmed from primary evidence.

Everything else checked — full server/client suites, the production-DB
pollution fix, D4/PX/P5/C7/C3/C2B genuineness, G-1/G-2's derivation logic,
wire-contract byte-identity, i18n parity, file headers, and Task 1's
doc-ordering obligations — is genuinely green and independently confirmed,
not merely trusted from the implementer's or fix-round's own reports.
