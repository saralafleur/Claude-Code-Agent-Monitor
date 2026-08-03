# QA / Test Architecture: Trunk-drift detection

Scope reminder (carried forward from `request-brief.md`, do not re-litigate):
**(1)** build a live, uncached detector answering "is there unattributed work
on trunk, and what commits/diff make it up," **(2)** wire it into
`detour_dispositions` as a new `source` value with a `label`-producing path,
**stop there**. No classification/disposition-vocabulary changes, no
`plan-writeback.js` rework, no layer-7 UI. This document assumes that scope
and tests to it — a plan that does more than that is scope creep this QA
pass should flag back, not silently validate.

Test stack (from `package.json` / `CLAUDE.md`): server tests run on Node's
built-in `node:test` runner, real SQLite (no ORM/mocks), real `git`
subprocesses via `execFile`/`execFileSync` against throwaway temp repos —
**not** mocked child_process. Run the whole suite with `npm run test:server`;
run one spec directly with `node --test server/__tests__/<file>.test.js`.

## 1. How we verify done

**Automated (must pass before this ships):**
1. `npm run test:server` — full server suite green, including the file-header
   audit (`bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0)
   since the new detector module and any new/renamed test files need the
   `@author Son Nguyen <hoangson091104@gmail.com>` header.
2. The new detector spec (name TBD by the technical plan, e.g.
   `server/__tests__/trunk-drift.test.js`) green in isolation:
   `node --test server/__tests__/trunk-drift.test.js`.
3. `reconciliation-full-tick.test.js` and `reconciliation.test.js` stay green
   unmodified in their existing (session-derived, `source='inferred'` /
   `'declared'`) assertions — see §3 "Regression risk" below for exactly what
   must not move.
4. `db-migration.test.js` stays green, plus a new case proving the
   `detour_dispositions.source` CHECK constraint accepts `'trunk_drift'` after
   migration and that a pre-migration DB with existing `inferred`/`declared`
   rows survives the rebuild with those rows intact (see §3, schema note).

**Manual (one pass against this repo itself, before merge):**
1. On a scratch branch/worktree of this repo, hand-commit a small no-op
   change directly to `master` (bypassing any worktree/focus-set flow) —
   this reproduces the exact shape of the `2026-07-31-focus-untracked-commits`
   incident (seven commits landed on `master` with no `team-intake` folder
   and no declared focus behind them). That incident is historical
   precedent for *why* this detector matters, not a literal replay fixture —
   its commits are long since merged and already reconciled, so it cannot be
   re-run as a test; the manual step is to reproduce its *shape* fresh.
2. Load the Project Detail page (or invoke the detector's entry point
   directly, however the technical plan exposes it) and confirm: (a) the
   hand-committed range is detected, (b) the output shape matches Sara's
   stated minimum bar — "the commit range and enough content (diff/commit
   messages) to describe what happened" — and (c) no classification/verdict
   (`fold_in`/`new_item`/`deliberate`/`discard`) appears anywhere in the
   detector's own output, only in the pre-existing pending-state badge once
   `reconciliation.js` later processes it.
3. Confirm the reverse on the same worktree: commit through the dashboard's
   own declared-focus flow (`ccam focus set` / push a worktree branch, land
   it through the existing flow this repo's own contributors use) and
   confirm the detector does **not** also flag that work as trunk drift —
   this is the core false-positive check and cannot be fully proven by unit
   tests alone since it depends on real `ccam` CLI behavior end to end.
4. Clean up the scratch commit/branch afterward (`git reset`/branch delete)
   so it doesn't itself become a phantom "untracked trunk work" incident in
   this repo's own history — ironic failure mode worth guarding against
   explicitly during manual verification.

## 2. Regression coverage

**Existing test to use as the structural pattern:**
`server/__tests__/repo-topology.test.js` — this is explicitly named in the
request brief as the posture to match, and it is the project's live
precedent for testing "compute live git state per request, don't cache it."
Key conventions to carry over into the new detector's spec, verified by
reading the file directly:
- Real throwaway git repos in `os.tmpdir()`, created via `execFileSync` in a
  `makeRepo(parent, name)` helper — not mocked `child_process`.
- `git` env is stripped of `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/
  `GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES` before every
  fixture git call — required so hook-set ambient git env doesn't redirect
  fixture git calls at the real repo the suite runs inside. The detector's
  own git calls will need the same `isolatedGitEnv()` helper (`server/lib/
  git-env.js`, already imported by `repo-topology.js`) — confirm the
  technical plan reuses it rather than reimplementing.
- `fs.realpathSync` on the tmp dir (macOS `/tmp` -> `/private/tmp` symlink)
  before comparing paths, since `git` itself reports resolved paths.
- A minimal fake `{ stmts: {...} }` db module, not the real `server/db.js`,
  for functions that only need specific prepared statements — the detector's
  own unit-level tests (default-branch resolution, commit-range walk) likely
  need no db module at all, and should be structured to not require one if
  they're pure git-derivation. The db-writing "plumbing" half (recording a
  `trunk_drift` detour) is where a real `dbModule` / real SQLite is needed —
  follow `reconciliation-full-tick.test.js`'s or `detour-disposition.test.js`'s
  pattern for that half instead (real SQLite via `DASHBOARD_DB_PATH` pointed
  at a tmp file, not `repo-topology.test.js`'s db fake).

**Do these currently pass?** Yes — `repo-topology.test.js` and
`reconciliation.test.js`/`reconciliation-full-tick.test.js`/
`detour-disposition.test.js` all currently pass on `master` (not modified by
this request's scope; confirmed via `git status` showing none of them as
locally modified). They do **not** currently cover trunk-drift detection at
all — `repo-topology.js` has no commit-history walk and no
`defaultBranch`/`isDefaultBranch` concept (confirmed by grep during intake,
per the request brief), and nothing in `reconciliation.js`/`detours.js`
reads or writes `source='trunk_drift'` today (the CHECK constraint at
`server/db.js:701` only permits `'inferred'`/`'declared'` — see §3). This is
net-new coverage, not a gap in existing coverage.

## 3. New/updated tests required

### 3a. Detector module — new spec, `repo-topology.test.js`-shaped

Assuming the technical plan lands the detector as e.g.
`server/lib/trunk-drift.js` with a spec `server/__tests__/trunk-drift.test.js`
(name pending the actual plan), the following cases are required — these are
the specific gaps named in the delegation brief, plus the false-positive
cases that are the actual risk on this surface:

1. **Default-branch resolution across differently-named trunks.** Create
   fixture repos with `init.defaultBranch=main`, `=master`, and a
   nonstandard name (e.g. `trunk`), each with an `origin` remote pointed at
   a second bare repo whose `HEAD` is set via
   `git symbolic-ref HEAD refs/heads/<name>`. Assert the detector resolves
   the correct branch in all three cases via `origin/HEAD`, not a hardcoded
   `main`/`master` guess (per the brief's own stated assumption #1).
2. **No-upstream-remote case.** A fixture repo with no `origin` remote at
   all (a purely local repo, `git remote` returns nothing) — assert the
   detector falls back to a `main`/`master`-presence heuristic (or whatever
   the plan's stated fallback is) rather than throwing or silently returning
   "no drift" by accident. This is a real local-first scenario, not an edge
   case — many of this repo's own dev worktrees may have no remote.
3. **Clean trunk / no drift case.** A fixture repo with commits made only
   through the "declared" path (i.e., commits carrying whatever marker the
   detector treats as "already seen" — see assumption #2, a corresponding
   `detour_dispositions`/`focus_inferences` row) — assert the detector
   returns an empty/no-drift result. This is the single most important test
   in the whole suite for the stated risk ("a noisy detector... would
   undermine the whole 'Unknown work' badge concept") — it must be present
   and it must exercise a *non-empty* commit history that the detector
   correctly recognizes as fully attributed, not just an empty repo.
4. **Dirty-but-uncommitted trunk case.** A fixture repo on its default
   branch with an uncommitted working-tree modification (`git status
   --porcelain` non-empty) but no new commits beyond what's already
   attributed — assert the detector does NOT flag anything, since "detection"
   per the brief's own scope is about the commit range, not working-tree
   dirtiness (that's `checkWorktreeDirty`'s job, already covered, a
   different signal). This directly guards against the detector accidentally
   conflating `repo-topology.js`'s existing dirty-check with its own new
   commit-history walk — an easy copy-paste hazard given how close the two
   live in the same file/posture.
5. **First-run / no-prior-marker case.** A fixture repo with commits on
   trunk and **no** prior `detour_dispositions`/`focus_inferences` row at
   all (simulating the very first time the detector runs against a repo that
   predates this feature) — assert the detector's behavior is explicit and
   intentional here, not accidental: either (a) it flags the entire existing
   trunk history as drift (likely wrong — would flood every pre-existing
   repo with noise on first run) or (b) it establishes a baseline/watermark
   on first run and only flags commits after that point going forward. The
   technical plan must state which, and this test must assert whichever was
   chosen — this is exactly the kind of ambiguity that turns into a
   real-world false-positive storm if left implicit (every already-onboarded
   project would light up with "unknown work" the day this ships).
6. **The genuine positive case.** A fixture repo with commits made directly
   on trunk with no attribution marker at all — assert the detector returns
   the correct commit range (start/end SHA or whatever shape `source_ref`
   takes) and that the returned content includes commit messages/diff
   sufficient to match Sara's stated minimum bar.
7. **Ordering axis, explicitly asserted separately (per PROJECT-CONTEXT.md
   §9.2).** If the detector or its "already attributed" check joins against
   `events`/`focus_inferences`/`detour_dispositions` to determine whether a
   commit range has been seen, that join must sort by `created_at` (id
   tiebreak), never by `id` alone — write a case seeding an out-of-order-id
   fixture (a bulk-inserted, workflow-ingest-shaped row landing at a later
   `id` than its `created_at` would suggest) and assert the detector still
   correctly recognizes it as "already attributed." Separately, assert commit
   ordering itself uses git's own DAG/committer-date, not dashboard
   `created_at` — a test that seeds commits with out-of-order system-clock
   commit dates (via `GIT_COMMITTER_DATE`) should still return them in git's
   own topological order, since git's order and the dashboard's `created_at`
   order are stated as two different axes that must not get silently
   conflated (per the request brief's own §9.2 pre-flag).

### 3b. Plumbing into `detour_dispositions` — real-SQLite spec

Whether this lands in the same spec file or a second one
(`detour-disposition.test.js`-adjacent), needs:
1. A `trunk_drift` detour, once recorded, is queryable via the same
   `listPendingDetours`/`listStaleResolvedDetours` paths `evaluateRules`
   already uses — i.e., no source filter accidentally excludes it. Confirm
   by inserting one real `source='trunk_drift'` row and asserting it appears
   in `reconciliation.evaluateRules`'s `flaggedDetours` output under the same
   conditions an `inferred`/`declared` row would.
2. Idempotency: recomputing the detector twice over the same unchanged trunk
   state must not create a second `detour_dispositions` row — exercised via
   the real `(cwd, source, source_ref)` unique index and the existing
   `upsertDetourDisposition` `ON CONFLICT` upsert path (per assumption #5 in
   the brief), with a fixture that runs the detector -> record -> detector
   -> record sequence twice and asserts row count stays at 1.
3. `label` production for a `trunk_drift` detour, tested against the §9.1
   DERIVED-DUAL-VIEW risk the brief itself pre-flags: assert there is exactly
   **one** function that turns "detour + its source" into `.label` text,
   and that it's the one `buildDispositionPrompt` consumes for every source
   uniformly — not a second hand-written trunk-drift-specific label
   formatter living in the detector module. If the technical plan does add
   a `trunk_drift`-specific label composer (likely, since the label content
   differs meaningfully — diff/commit messages vs. session narrative), it
   must be a single exported function called from exactly one write site
   (`detours.js`'s equivalent of `recordInferredDetour`, alongside a new
   `recordTrunkDriftDetour`), the same "extract, single writer" shape as
   `recordInferredDetour`/`backfillDeclaredDetours` already establish for the
   other two sources — not inlined ad hoc at the call site. A grep-based
   guard (`assert.ok` on a single call-site count, following
   `single-writer-guard.test.js`'s pattern) is worth adding if the technical
   plan agrees this is the right shape.

### 3c. Schema migration — CHECK constraint, confirmed blocking

Directly confirmed by reading `server/db.js:701`:
```
source TEXT NOT NULL CHECK(source IN ('inferred','declared')),
```
This is a hard blocker the request brief flagged as "needs confirmation, not
assumed" (§9.5/§9.6) — now confirmed: **adding `'trunk_drift'` requires a
schema change, not just a new string value.** SQLite cannot `ALTER TABLE`
a `CHECK` constraint in place (the same reason this table's own header
comment gives for landing `write_status`'s CHECK in the original `CREATE
TABLE` rather than adding it later — "SQLite cannot add a CHECK via ALTER
TABLE ADD COLUMN at all, so shipping the base shape first would cost a full
rebuild"). This needs the same atomic-rebuild migration shape
`db-migration.test.js` already exercises for this exact table (see its
`project_id` ALTER-TABLE case, `db-migration.test.js:699`) generalized to a
full-table rebuild (new table with the widened CHECK, copy rows, drop old,
rename — the standard SQLite CHECK-widen pattern), not a simple
`ALTER TABLE ADD COLUMN`.

Required test (new case in `db-migration.test.js`, following its established
before/after-migration harness):
1. Seed a pre-migration DB (old schema, `CHECK(source IN
   ('inferred','declared'))`) with at least one real `inferred` row and one
   real `declared` row.
2. Run the migration path (opening `server/db.js` against that DB file,
   same as every other case in that spec).
3. Assert: (a) both pre-existing rows survive with all columns byte-identical
   except whatever the migration is expected to touch, (b) a fresh insert
   with `source='trunk_drift'` now succeeds, (c) `source='bogus'` still
   fails the CHECK (constraint was widened, not dropped), (d) the unique
   index `idx_detour_dispositions_src` on `(cwd, source, source_ref)`
   survives the rebuild intact — confirm via `PRAGMA index_list`.
4. Per §9.3 VACUOUS-GUARD, prove this test is a real guard by reverting the
   migration (or stubbing it to no-op) and confirming step 3b fails loudly
   (CHECK constraint violation) before restoring — don't just read the code
   and assume the rebuild path is correct.

## 4. Test data / fixtures

- **Git fixtures:** throwaway repos under `os.tmpdir()` (realpath-resolved),
  built via the same `makeRepo`/`git` helper shape as
  `repo-topology.test.js`, with the isolated git-env stripping applied to
  every fixture git call. Needed repo shapes: (a) trunk named `main`, `master`,
  and a nonstandard name, each with/without an `origin` remote; (b) a trunk
  with a mix of "attributed" commits (paired with a fixture
  `detour_dispositions`/`focus_inferences` row) and "unattributed" commits
  (no corresponding row); (c) a trunk with only working-tree dirtiness and no
  new commits; (d) a trunk with commits made with an explicit
  `GIT_COMMITTER_DATE` out of insertion order, to exercise the git-DAG-vs-
  `created_at` ordering distinction from §9.2.
- **DB fixtures:** a real SQLite file via `DASHBOARD_DB_PATH` pointed at a
  tmp path (the `reconciliation-full-tick.test.js` pattern), seeded with
  `plans`/`plan_items` rows only where a case needs `reconcileCwd`'s
  plan-existence gate satisfied (WATCH-2 — a cwd with no plan/plan items is
  skipped entirely, so drift-detection-into-reconciliation tests need a
  minimal real plan fixture to not be silently no-op'd).
- **Migration fixture:** a raw pre-migration `.db` file (or a script that
  builds one against the *old* `CREATE TABLE` text) with real `inferred`/
  `declared` rows, per §3c.

## 5. Definition of Done checklist

- [ ] `npm run test:server` green, including file-header audit.
- [ ] New detector spec covers: default-branch resolution (3+ trunk names,
      with/without `origin`), clean-trunk/no-drift, dirty-but-uncommitted,
      first-run/no-prior-marker (explicit chosen behavior, not accidental),
      the genuine-positive detection case, and the `created_at`-vs-git-DAG
      ordering distinction (§9.2).
- [ ] At least one test proves the detector does **not** flag work that went
      through the declared focus/session flow — this is the load-bearing
      false-positive guard for the whole "Unknown work" badge concept and
      must not be missing or vacuous (§9.3: prove it fails when the
      "already attributed" check is disabled/stubbed).
- [ ] `detour_dispositions.source` CHECK-constraint migration lands with its
      own `db-migration.test.js` case, proven by reversion (§9.3), preserving
      pre-existing `inferred`/`declared` rows byte-identical.
- [ ] `trunk_drift` detours flow through the **existing**
      `listPendingDetours`/`evaluateRules`/`buildDispositionPrompt` path
      unmodified in their session-derived behavior — `reconciliation.test.js`
      and `reconciliation-full-tick.test.js` pass with zero changes to their
      existing `inferred`/`declared` assertions.
- [ ] Exactly one `label`-producing path per source, no second hand-rolled
      trunk-drift label formatter living outside the single-writer shape
      (§9.1 DERIVED-DUAL-VIEW guard).
- [ ] Idempotency proven: recomputing the detector over unchanged trunk state
      does not duplicate `detour_dispositions` rows.
- [ ] Manual verification pass completed against this repo (scratch
      commit-to-trunk reproduction of the `2026-07-31-focus-untracked-commits`
      shape, plus the reverse declared-focus-flow negative check), and the
      scratch artifacts cleaned up afterward.
- [ ] No classification/disposition logic (`fold_in`/`new_item`/
      `deliberate`/`discard`), no `plan-writeback.js` change, no layer-7 UI
      — confirmed out of scope, per the request brief's own carried-forward
      boundary.
