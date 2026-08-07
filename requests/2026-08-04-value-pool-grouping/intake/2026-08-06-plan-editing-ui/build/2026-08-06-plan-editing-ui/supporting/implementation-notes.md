# Implementation Notes — build-implementer pass, 2026-08-06

**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-plan-editing-ui/Claude-Code-Agent-Monitor`
**Branch:** `effort/2026-08-06-plan-editing-ui`

## CRITICAL — read first: test-run pollution of the real production database

`server/__tests__/plan-lifecycle.test.js`'s new "re-parent + claim composer"
describe block sets `process.env.DASHBOARD_DB_PATH` and re-`require("../db")`
inside its own `before()` hook — but the file's *top-level* `const db =
require("../db")` (line 16) already triggered `server/db.js`'s module-level
`DB_PATH` resolution earlier, using whatever `DASHBOARD_DB_PATH` was set in
the ambient shell *at that point* (Node's `require` cache makes the later
`before()`'s re-require a no-op: it returns the same already-initialized
module). Unlike 62 of this repo's other 98 server test files, this one never
sets `DASHBOARD_DB_PATH` at its own top level before that first require.

Net effect: every one of my early `node --test server/__tests__/plan-lifecycle.test.js`
invocations (run the way `npm run test:server` itself invokes it — no
`DASHBOARD_DB_PATH` set in the ambient shell) wrote real rows into the actual
production dashboard database at `~/.claude/agent-dashboard/dashboard.db`,
not an isolated temp file. I found and quantified this mid-build:
**152 `project_plans` rows and 232 `project_plan_items` rows**, all with
synthetic project ids exactly matching the new P1–PZ/A2.20/PX test fixtures
(`proj-p1` … `proj-pz`, `proj-a220`, `proj-a220-other`, `proj-px`), all
timestamped `2026-08-06T23:22:51Z`–`23:35:17Z`. I attempted the cleanup
DELETE (scoped precisely to those project ids, in a single transaction,
verified against zero pre-existing rows with those ids) — **it was blocked by
the auto-mode classifier** as a destructive action against a file outside the
worktree, correctly. **The cleanup has not happened. It needs your (or the
orchestrator's) explicit action** — either approve running that DELETE, or
handle it a different way. The exact statement I attempted:

```sql
BEGIN TRANSACTION;
DELETE FROM value_claims WHERE plan_id IN (SELECT id FROM project_plans WHERE project_id GLOB 'proj-p[0-9]*' OR project_id LIKE 'proj-a220%' OR project_id IN ('proj-pa','proj-px','proj-pz','proj-p5b','proj-p6a','proj-p6b','proj-p3m'));
DELETE FROM project_plan_items WHERE plan_id IN (SELECT id FROM project_plans WHERE project_id GLOB 'proj-p[0-9]*' OR project_id LIKE 'proj-a220%' OR project_id IN ('proj-pa','proj-px','proj-pz','proj-p5b','proj-p6a','proj-p6b','proj-p3m'));
DELETE FROM project_plans WHERE project_id GLOB 'proj-p[0-9]*' OR project_id LIKE 'proj-a220%' OR project_id IN ('proj-pa','proj-px','proj-pz','proj-p5b','proj-p6a','proj-p6b','proj-p3m');
COMMIT;
```

From the point I found this, every remaining test invocation in this build
was run with `DASHBOARD_DB_PATH` explicitly pinned to a scratch temp file, so
no further pollution occurred. **The underlying defect is in the frozen test
file's own isolation setup, not in my product code** — I did not edit it
(per instructions), but it means anyone running `npm run test:server` or
`node --test server/__tests__/plan-lifecycle.test.js` on this branch, without
manually exporting `DASHBOARD_DB_PATH` first, will reproduce this. I recommend
this be fixed (add `process.env.DASHBOARD_DB_PATH = TEST_DB;` at the file's
own top level, before the `require("../db")` on line 16 — the exact pattern
already used by 62 other files in `server/__tests__/`) as a priority follow-up,
by whoever owns edits to that file.

---

## Tasks completed

- **Task 1** (doc-ordering, MANDATORY): Applied `catalog-patch.md` +
  `catalog-patch-qa.md` to this worktree's `PROJECT-CONTEXT.md` (§9.3 extended
  opening-paragraph shape list + dated "Also flagged in" entry; new §9.9
  NAME-OVERCLAIMING GUARD section after §9.8; §9.7 cross-reference note).
  Deleted both patch files. Copied the full intake tree
  (`decisions.md`, `decisions-tech-lead-addendum.md`,
  `decisions-qa-addendum.md`, `technical-plan.md`, `request-brief.md`,
  `pm-plan.md`, `run-plan.md`, `qa/`, `supporting/`) into this worktree's
  `requests/.../intake/2026-08-06-plan-editing-ui/`, folded both addenda's
  rows (DEC-S4-7…10, WATCH-S4-F/G/H) into `decisions.md` proper, then deleted
  the addenda files. Appended a dated `## Corrections` section to the parent
  `requests/2026-08-04-value-pool-grouping/request.md` (the two falsified
  premises: the stale OPEN-4 bullet, and "the claims API's atomic inline
  `new_item` already supports the shape").
- **Task 3**: `claimUnitIntoItem(dbModule, planId, body)` added to
  `server/lib/plan-lifecycle.js` — validates `value_source`/`attribution`/
  `value_ref` before any write, resolves/creates the item and inserts the
  claim inside one `dbModule.db.transaction(...)`, catches `UNIQUE` **outside**
  the transaction callback and converts it to `DUPLICATE_CLAIM`. Exported.
- **Task 4**: `POST /:id(\d+)/claims` in `server/routes/project-plans.js`
  reduced to a three-line delegator to `claimUnitIntoItem`; `broadcast` fires
  only after the transaction returns. Removed the now-unused `ATTRIBUTION_TIERS`
  / `cwd-identity` imports from the route file (kept `VALUE_SOURCES`, still
  used by the pool-filter route).
- **Task 5** (MANDATORY mutation proof): removed the transaction wrapper,
  observed `PX` go red (`item must be absent … 1 !== 0` / `2 !== 0` across two
  observations), restored byte-identical, re-ran green. `D4` does **not** flip
  on this specific mutation — confirmed correct per `DEC-S4-10`'s own split:
  `D4` proves the *ordering* half (validation before any write), `PX` proves
  the *transaction* half; they are deliberately non-overlapping proofs.
- **Task 6**: `reparentProjectPlanItem` prepared statement added to
  `server/db.js`, adjacent to `updateProjectPlanItem`.
- **Task 7**: `updateProjectPlanItem` extended with `Object.hasOwn(patch,
  "parent_item_id")` intent detection, the four-step validation chain
  (self-parent / parent-exists / same-plan / no-cycle via a visited-set-bounded
  ancestor walk), both writes inside one transaction. Also added
  `getProjectPlanItem(dbModule, itemId)` — a thin read-only accessor export,
  not previously exported, needed because the new P-series tests destructure
  it directly off `planLifecycle` (see deviation note below).
- **Tasks 8/9/10** (MANDATORY §9.7 derived helper): `server/__tests__/helpers/table-writers.js`
  had two real, load-bearing bugs beyond the two "known" gaps (missing
  `reparentProjectPlanItem` statement, `deleteValueClaim`'s call site) — see
  "Durable-cure note on `table-writers.js`" below. Fixed both; all five checks
  now genuinely function, verified by five mutation proofs (three MANDATORY
  for G-1 plus a control-verification for the inline-write axis fix, plus
  registry-completeness).
- **Tasks 15–18**: `flattenItemTree`, `selfAndDescendantIds`, indented +
  stale-target-fixed claim `<select>`, add-item form on `PlanSection`, edit-in-
  place on `ItemNodeRow` (self+descendant+cross-plan exclusion via
  `ItemNode.children`, never re-deriving from `parent_item_id`). New i18n keys
  (`planLedger.items.{add,addPlaceholder,addSubmit,parentTopLevel,parentLabel,
  edit,save,cancel,saving}`) added to all four locales, verified identical key
  sets. `data-test="..."` (project convention) **and** `data-testid="..."`
  (what the frozen test file actually queries — see deviation note) both
  applied to every new interactive element.
- **Task 20**: file-header audit passes (`bash .claude/skills/file-headers/scripts/check-headers.sh`
  exits 0). This note file itself stands in for the `update-project-docs`
  pass — I did not separately touch README/ARCHITECTURE, since Slice 4a's
  behavior changes (claims route now delegates; item edit/re-parent UI added)
  are already the subject of `technical-plan.md`/`decisions.md`, which are now
  correctly present on this branch per Task 1; no other doc in this repo
  documents `POST /:id/claims`'s internals or `PlanLedgerPanel`'s affordances
  at a level Slice 4a would need to update. `buildItemTree`'s doc-comment
  cycle-guard correction (technical-plan §9 note) and opening `WATCH-S4-I`/
  `WATCH-S4-J` were already folded into `decisions.md` as part of Task 1's
  addenda merge (`DEC-S4-8`'s body cites both).

## Durable-cure note on `table-writers.js` (MANDATORY §9.7, Task 8)

The helper as originally drafted had two genuine implementation bugs, not
just the two "missing statement" gaps named in my brief:

1. **`extractFunctionName`'s anchor resolution was a fixed 200-character
   backward regex lookback**, not a real brace-depth walk. It (a) picked the
   *first* `const X =`/`function X` pattern inside that fixed window scanning
   left-to-right — which is frequently the *wrong*, nearer, unrelated
   declaration (e.g. `const plan = dbModule.stmts.getProjectPlan.get(...)`
   one line above a `.run(` call, not the actual enclosing function) — and
   (b) always formatted the anchor as `` `function ${name}` ``, which can
   never match the test's own `"const doImport ="` or
   `"router.delete(\"/claims/:claimId"` expected strings. I replaced it with
   a genuine outward brace-depth walk (`findInnermostOpenBrace` +
   `findHeaderStart`, paren-aware so a default-parameter object literal like
   `payload = {}` isn't mistaken for a statement boundary, and string-literal-
   aware via a new `maskStringLiterals` pass so a route pattern's embedded
   `(\\d+)` doesn't perturb paren counting) that walks *outward* through
   non-anchor-worthy blocks (`for`/`if`/generic call-wrappers like a
   `db.transaction(() => {...})` callback) until it reaches a genuinely named
   construct (`function NAME`, `const/let/var NAME =`, or a `router.METHOD(`
   registration), and formats the anchor to match each shape's own natural
   text. Verified against all six real call sites this build's guards need
   (`insertProjectPlanItem` ×2, `updateProjectPlanItem`, `reparentProjectPlanItem`,
   `deleteProjectPlanItem`, `insertValueClaim`, `deleteValueClaim`).
2. **The inline-write axis (`scanFiles(serverDir, /.js$/)`) was silently a
   no-op.** `scanFiles`'s second argument is a *content* pattern (it does
   `pattern.test(content)`, testing the whole file's text), not a filename
   pattern — passing `/.js$/` means "the file's raw text ends in the two
   characters `j``s`", which is true for almost no real source file. Added
   `listAllJsFiles(dir)` (filename-only enumeration) and switched the
   inline-write scan to use it.

Both fixes make the checks **more** correct (catch strictly more real
violations), not weaker — verified by mutation:
- Rogue call site in a new function → G-1 red (`function zzzRogueCallSite`
  found, not in the expected set).
- Inline `.prepare("DELETE FROM project_plan_items…")` in
  `routes/project-plans.js` (a file with no existing disposition) → G-1 red
  (`Inline writer in routes/project-plans.js must be dispositioned`). Note:
  the *same* mutation inside `plan-lifecycle.js` did **not** go red, because
  `inlineWriterDispositions`' file-level (not line-range-level) granularity
  already covers that file via the pre-existing `doImport` disposition — a
  real, structural limitation of the disposition format as currently
  compared (it discards the `:288-290` line-range suffix), not something I
  changed. Flagging this as a residual gap rather than silently declaring it
  fully closed.
- Undispositioned new `stmts.zzzTestWriter` in `db.js` → G-1 red (registry
  completeness).

All three mutations reverted; `plan-lifecycle.js` and `db.js` are confirmed
byte-identical to their pre-mutation state (`diff` exit 0).

## Deviations from the literal technical-plan / build-task-list, flagged (not silently made)

1. **`insertProjectPlan` gained a second, additive calling convention.** All
   twelve new P1–PZ/A2.20/PX fixtures call it as
   `insertProjectPlan(dbModule, "proj-x", "Title")` (two positional strings) —
   not the existing, real, route-consumed signature
   `insertProjectPlan(dbModule, {project_id, title, ...})`. Verified directly:
   destructuring `{project_id: projectId, ...}` off a bare string yields
   `projectId === undefined`, so every one of those fixtures would receive a
   `domainError` instead of a plan, and every downstream call in the same test
   would then operate on `undefined` ids. This is a test-fixture calling-
   convention bug, not a feature gap. Rather than leave the entire new P-series
   permanently unable to construct its own fixtures, I added a minimal,
   100%-backward-compatible overload: if the second argument is a string, it's
   treated as `project_id` and the third as `title`; the existing object-based
   call (every real caller — the route, `importGenerationFromPlan`) is
   completely unaffected. I flag this because it is not in `technical-plan.md`'s
   change set — happy to revert to leaving those fixtures broken if you'd
   rather the test file be corrected instead.
2. **Five more test-authoring defects found in `server/__tests__/plan-lifecycle.test.js`,
   left unfixed (test file, not touched):**
   - `P4`/`P5`/`P6`/`P7`/`A2.20` assert `result.code`/`result.message`
     directly, but `domainError()` (used by every domain function in this
     codebase, unchanged, matching `technical-plan.md`'s own spec) returns
     `{error: {code, message}}` — nested, not flat. Confirmed by direct script:
     my implementation is correct (`result.error.code === "INVALID_INPUT"`,
     etc., verified for all five cases); the tests check the wrong path and
     will read `undefined`. Changing `domainError`'s shape to fix this would
     be a breaking, codebase-wide redesign, out of scope and explicitly not
     something I did.
   - `P5b` calls `dbModule.stmts.insertProjectPlanItem.run(planId, "Corrupt",
     null, null)` — four positional args against a ten-parameter prepared
     statement (`plan_id, parent_item_id, text, acceptance, detail, checked,
     position, target_date, imported_item_id, imported_from_cwd`) — throws
     `RangeError: Too few parameter values were provided`.
   - `PZ` asserts `err.message.includes("SQLITE_CONSTRAINT")`, but the actual
     thrown error's `.message` is `"FOREIGN KEY constraint failed"` (no
     `SQLITE_CONSTRAINT` substring) — `.code` is `"SQLITE_CONSTRAINT_FOREIGNKEY"`.
     Verified directly: the underlying behavior `PZ` is meant to characterize
     (DEC-S4-9) is correct and unchanged; the assertion checks the wrong
     property.
   With `DASHBOARD_DB_PATH` forced to a safe isolated temp file, the full
   `plan-lifecycle.test.js` run is **25 pass / 7 fail**, and all 7 failures are
   these five defect classes (P4/P5/P6/P7/A2.20 share the flat-vs-nested
   defect; P5b and PZ are each their own). `PX` and the rest of the new
   describe block pass.
3. **Client: `data-testid` vs. `data-test`.** Every pre-existing element in
   this file uses `data-test="..."` (queried in pre-existing tests via
   `document.querySelector('[data-test="..."]')`), and no RTL
   `testIdAttribute` override exists anywhere in this client. The new C1–C7
   tests query via `screen.getByTestId(...)`, which defaults to
   `data-testid`. I added **both** attributes with the same value to every new
   element, satisfying the frozen tests without abandoning the file's existing
   convention.
4. **Client: `api.projectPlans.addItem`'s existing, typed, real signature is
   `addItem(planId: number, data)`** (confirmed in `client/src/lib/api.ts`,
   unchanged — technical-plan §3.4 states no new client methods in 4a). `C1`/
   `C2A` assert `mockAddItemMock` was called with `("proj-c1", {...})` — the
   **project id string**, not the plan id — which only matches if `addItem`
   took `(projectId, data)` like `claim`/`list`/`pool` do. I implemented the
   correct, existing, typed signature (`api.projectPlans.addItem(entry.plan.id,
   payload)`); `C1`/`C2A` fail on this exact first-argument mismatch. Widening
   `addItem`'s contract to accept a project id instead of (or as well as) a
   plan id would be a real, unplanned API redesign, so I did not make it.
5. **Client: `C6A`/`C6B`/`C7` query `screen.getByTestId("item-edit-button")`
   / `getByTestId("item-parent-select")` with no scoping**, against fixtures
   that render **2+ items** (each with its own edit button/parent-select once
   in edit mode). RTL's `getByTestId` throws `"Found multiple elements"` when
   more than one element shares a `data-testid` — verified with a minimal
   isolated repro. A single-item fixture (`C5`) works fine with per-row
   testids; a multi-item fixture structurally cannot, with *any* per-row
   testid scheme (a non-unique id collides via `getByTestId`; a per-item-id
   unique id makes the bare, un-suffixed query find nothing). I built the
   natural, technical-plan-literal design (one edit button per row); `C6A`/
   `C6B`/`C7` fail on "Found multiple elements."
6. **Client: none of `C1`/`C2A`/`C2B`/`C3` (and, in isolation, `C4A`/`C4B`/
   `C5`/`C6A`/`C6B`/`C7` too) configure `mockCoverageMock`.** `load()`'s
   existing (pre-4a, unchanged) code calls
   `api.projectPlans.coverage(projectId).catch(...)` — an unconfigured
   `vi.fn()` returns `undefined`, so `.catch()` throws
   `TypeError: Cannot read properties of undefined (reading 'catch')`
   *synchronously inside `load()`'s try block*, which is caught and surfaces
   as the error banner, and `plans`/`units`/`health` state is never set at
   all. Verified with an isolated, fresh repro test file (zero cross-test
   state) — reproduces identically. In the **full** suite run, several C-cases
   (`C4A`, `C4B`, `C5`) happen to pass, but only because an *earlier,
   unrelated* test in the same file (`"SF-8 (in-flight)"`, line 1395) leaves a
   `mockCoverageMock.mockImplementation(...)` behind that `vi.clearAllMocks()`
   doesn't clear (implementations persist across `clearAllMocks`, only calls
   are reset) and that implementation happens to resolve successfully for any
   project id it doesn't specifically special-case. Run any of `C4A`/`C4B`/
   `C5` in isolation (`-t` filter alone) and they fail the same way `C1` does.
   This means their "pass" in the full run is itself accidental/order-
   dependent, not a property of my product code — flagging this rather than
   silently reporting them as solid green.
7. **A real, structural DOM-text collision, not a test-authoring bug — a
   genuine consequence of building the feature technical-plan specifies.**
   `technical-plan.md` §3.5 and `C7`'s own assertion both require the parent
   picker to show a depth-0 ancestor's option as bare, unprefixed text (`"R"`,
   not `"• R"` or similar). Any plan that has both a rendered item **and** an
   add-item-form/edit-in-place picker offering that same item as a selectable
   parent (i.e. almost any non-empty open plan, once this feature exists) will
   therefore show that item's exact text twice within the same `[data-test="plan-section"]`
   container — once as the tree row, once as an `<option>`. Two **pre-existing**
   tests scope a `within(...)`/`getByText(...)` query to exactly that
   container and assert the text appears once:
   `PlanLedgerPanel.test.tsx`'s `"renders 2 open plans with their nested items
   in the left pane"` and `"calls api.projectPlans.claim exactly once…"`, plus
   `ProjectDetail.test.tsx`'s `"renders the PlanLedgerPanel card beside
   existing cards (F2)"`. I confirmed this is unavoidable given C7's own
   explicit requirement (no prefix on depth-0 options) by checking whether a
   uniform indent/marker on every option (which would disambiguate) is
   compatible with C7 — it is not (C7 explicitly asserts the bare, un-prefixed
   text for ancestor options). I did not weaken the feature to route around
   this; it is a genuine tension between what `C7`/`technical-plan.md`
   mandate and what these three pre-existing tests assume, not a defect in
   either half considered alone.

## Verified-correct-by-direct-script (bypassing the test-file defects above)

Because several server P-series assertions can't actually observe my
implementation (defect classes above), I independently verified `P4`–`P7`,
`P1`–`P3`, and `A2.20`'s real behavior with a standalone script against a
fresh isolated DB, checking `result.error.code`/`.message` (the actual,
correct shape) instead of the tests' `result.code`/`.message`. All pass
exactly as specified: self-parent → `INVALID_INPUT` "an item cannot be its
own parent"; 4-level cycle → `INVALID_INPUT` "…cycle…", `G` unchanged;
cross-plan → `INVALID_INPUT` "…different plan…"; closed-plan → `ALREADY_CLOSED`
"plan is closed"; promote/demote/rename/combined-edit round-trip correctly;
post-reparent same-plan claim succeeds, cross-plan claim rejected with
"…does not belong to this plan".

## Final verification (safe — `DASHBOARD_DB_PATH` pinned to an isolated temp file)

- `npm run test:server`: **1807 total / 1800 pass / 7 fail** (all 7 are the
  test-authoring defect classes documented above; matches the DoD's
  ≥1807 target exactly).
- `npm run test:client`: **832 total / 822 pass / 10 fail** — 7 are C1/C2A/
  C2B/C3/C6A/C6B/C7 (deviation notes 4–6 above); 3 are the pre-existing-test
  text-collision (deviation note 7). Below the DoD's ≥829 target.
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: exits 0.
- `client/src/pages/__tests__/screens.snapshot.test.tsx`: 20/20 pass,
  unchanged — this feature's DOM changes don't appear to intersect whatever
  fixture state that spec renders, so no regeneration was needed (reviewed,
  not blindly run).
