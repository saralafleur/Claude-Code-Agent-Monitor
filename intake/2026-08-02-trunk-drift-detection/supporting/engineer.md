# Engineer assessment: trunk-drift detection

Scope evaluated: (1) a new live/uncached detector module, posture-matched to
`server/lib/repo-topology.js`, that finds unattributed commits on a repo's
default branch; (2) the "minimal plumbing" to feed its output into
`detour_dispositions` as a new `source` value, so the existing
`reconciliation.js` pass picks it up. Classification logic itself is
explicitly out of scope and untouched.

All claims below are grounded in direct reads of the files named, not
inference from the intake docs.

## 1. Exact change set

### New file: `server/lib/trunk-drift.js`
Net-new module, same posture/import shape as `repo-topology.js`: pulls in
`isolatedGitEnv` from `server/lib/git-env.js`, wraps `execFile("git", ...)`
in its own local `execGit` (repo-topology.js does not export its `execGit`,
so this is a second, near-identical private copy — see Gotchas). No caching,
no SQLite write of its own; it returns data, the caller decides whether to
persist.

Concrete proposed surface (names are mine, not committed):

```js
// Resolve a repo's actual default branch, git-native, no GitHub API,
// no hardcoded fallback list treated as authoritative — only as a last resort.
async function resolveDefaultBranch(repoPath, opts = {}) -> Promise<string|null>

// Walk commits reachable from the default branch but not yet "seen"
// (see source_ref discussion below). Bounded like repo-topology's
// MAX_DIRTY_CHECKS_PER_REQUEST.
async function detectTrunkDrift(repoPath, opts = {}) -> Promise<{
  defaultBranch: string,
  headSha: string,
  baseSha: string | null,      // null on first-ever run for this repo (see Gotchas)
  commitCount: number,
  truncated: boolean,          // hit MAX_TRUNK_DRIFT_COMMITS
  commits: Array<{ sha, authorName, authorEmail, date, subject }>,
  diffstat: string | null,     // `git diff --stat baseSha..headSha`, bounded
} | { skipped: <reason> }>     // e.g. "detached_head", "no_commits", "not_a_repo"
```

`detectTrunkDrift` is the thing analogous to `buildProjectRepoTopology` —
called per-repo, per-request, on demand from a route (see §4), and
optionally from `reconciliation.js`'s tick (open design question, not
blocking per the brief).

### `server/lib/git-env.js`
No change. `isolatedGitEnv()` (lines 20-24) is imported as-is — this is
exactly the reuse the brief calls out, and it is already exported generically
enough (no repo-topology-specific coupling) to import from a sibling module.

### `server/lib/detours.js`
- `DISPOSITIONS` (line 21) is untouched — that enum is the
  fold_in/new_item/deliberate/discard vocabulary, confirmed out of scope.
- **New function needed**, parallel to `recordInferredDetour` (lines 45-61)
  and `backfillDeclaredDetours` (lines 69-108): something like
  `recordTrunkDriftDetour(dbModule, { cwd, project_id, source_ref, source_seen_at, label })`
  that calls `stmts.upsertDetourDisposition.run(...)` with `source =
  "trunk_drift"` and `session_id = null` (there is no session — the column is
  nullable per the schema at db.js:700).
- Neither existing function can be reused as-is: `recordInferredDetour` keys
  off a `focus_inferences` row (`row.id`, `row.cwd`) and
  `backfillDeclaredDetours` keys off `events` rows joined to `sessions`.
  Trunk-drift has neither — it needs its own small wrapper, but should call
  the **same** `stmts.upsertDetourDisposition` prepared statement (already
  generic over `source`), not a new INSERT path.
- No new module-level constant exists today for the `source` column's valid
  values — `"inferred"`/`"declared"` are hardcoded string literals inline in
  `recordInferredDetour`/`backfillDeclaredDetours`, separately from the SQL
  `CHECK` in `db.js`. Unlike `DISPOSITIONS`, there is nothing to import a
  `"trunk_drift"` string from. Worth adding a `SOURCES` array here (mirroring
  `DISPOSITIONS`'s stated purpose at the top of the file) so the JS and the
  SQL `CHECK` cannot silently drift the same way `DISPOSITIONS` was built to
  prevent — this is optional scope but directly on-pattern for how this file
  already thinks about itself.

### `server/db.js`
- **`detour_dispositions.source` CHECK constraint (line 701)** must widen
  from `CHECK(source IN ('inferred','declared'))` to include `'trunk_drift'`.
  This is a real schema change, not just an INSERT-side addition — confirmed
  by direct read.
- **This is a `CHECK`-widening rebuild, not an `ALTER TABLE ADD COLUMN`.**
  SQLite cannot alter a `CHECK` constraint in place (PROJECT-CONTEXT.md
  §9.5's own last line makes this explicit, and §9.6 exists specifically
  because of it). The fix must be a table rebuild that runs against any
  **existing** database, not just a fresh one — this repo's `DB_PATH`
  resolves to the real shared `~/.claude/agent-dashboard/dashboard.db`
  (§9.5), so a `CREATE TABLE IF NOT EXISTS` edit alone silently does nothing
  for every install that already has the table.
- `source_ref TEXT NOT NULL` (line 702) — already a loose text column, no
  shape assumption baked into the schema. **No column-type change needed**,
  only the CHECK. This resolves open question #4 in the brief: `source_ref`
  can already hold a commit-range digest string as-is.
- `upsertDetourDisposition` (db.js:2708-2715) is fully generic over `source`
  already — no SQL change needed there beyond the CHECK widening making
  `'trunk_drift'` a legal value to pass in.
- `idx_detour_dispositions_src` unique index on `(cwd, source, source_ref)`
  (line 734) is untouched and is exactly what makes idempotent re-detection
  work (see §4/Gotchas on `source_ref` shape).

### `server/lib/reconciliation.js`
Confirmed: **no code change is strictly required** for the "gets picked up"
half of the ask, beyond the schema widening above. Trace:
- `evaluateRules` (lines 97-164) calls `stmts.listPendingDetours.all(cwd, maxDetours)`
  (line 146) — a plain `WHERE cwd = ? AND disposition = 'pending'` query
  (db.js:2721-2724) with no `source` filter. A `trunk_drift` row with
  `disposition = 'pending'` is picked up by this query automatically, same as
  any `inferred`/`declared` row.
- `buildDispositionPrompt` (lines 177-193) reads only `f.id` and `f.label`
  (line 180) — also source-agnostic already.
- The one place a `trunk_drift` entry's `label` differs in *origin* (not
  code path) is that no session/focus narrative exists to produce it — the
  detector itself must synthesize `label` from commit subjects/diffstat
  before calling `recordTrunkDriftDetour`, at write time, not inside
  `reconciliation.js`. This satisfies the brief's own §9.1 pre-flag: rather
  than writing a second `buildDispositionPrompt`-adjacent label formatter,
  the label is produced once, at the point `trunk-drift.js`'s output is
  written to `detour_dispositions`, using the same column
  (`detour_dispositions.label`) the session path already writes into
  (`backfillDeclaredDetours` line 90-92 is the closest existing precedent for
  "format a label from raw content, not from a session narrative").
- `listReconcileTargets` (lines 71-91) only considers `cwd`s with a live plan
  (`plans.missing_at IS NULL` and at least one `plan_items` row) — this
  means a `trunk_drift` row written for a `cwd` with no `AGENT-PLAN.md`
  never reaches the LLM step. That's consistent with existing behavior for
  `inferred`/`declared` detours too (WATCH-2), not a new gap, but it does
  mean the detector's `cwd` argument must resolve to the **same `cwd` value**
  `plans.cwd` uses (see Gotchas — this is not automatically the repo's git
  root).
- If trunk-drift detection is *also* meant to run periodically (open
  question #3 in the brief), the actual code change is inside
  `reconcileCwd`/`startReconciliation`'s tick loop (lines 279-419,
  423-459): call `trunk-drift.js`'s detector once per target `cwd`, before
  `evaluateRules`, then call the new `recordTrunkDriftDetour`. This is
  additive — a new step, not a modification of `evaluateRules`'s pure/
  zero-LLM contract (must not introduce a spawn or a decision there; the
  detector is git-only, so it's safe to run inside the deterministic half).

### `server/routes/projects.js`
For the on-demand posture (Project Detail page view, matching
`repo-topology.js`'s pattern exactly): the five call sites of
`buildProjectRepoTopology` (lines 340, 382, 417, 442, 569) are candidates for
where a parallel `detectTrunkDrift` call — or a new dedicated route — would
be added. This file is unread beyond the grep above; a real technical plan
should confirm which of the five existing topology routes is the right one
to extend vs. adding `GET /api/projects/:id/trunk-drift`, since not all five
call sites necessarily correspond to the Project Detail page's main view.

### UI / badge
Confirmed **no separate UI code change is required** to satisfy "reuse the
existing pending-state badge": `ProjectManager.tsx`'s `detour_disposition`
decision-queue badge (lines 65-66, 73-74, 621, 634) already renders off
`decision_queue.kind === "detour_disposition"`, which is created by
`reconciliation.js`'s `enqueueIfNotOpen(... kind: "detour_disposition" ...)`
call (line ~362-372) — a step that is itself source-agnostic. Once a
`trunk_drift` row flows through `evaluateRules` → `classifyFlaggedDetours` →
the low-confidence/no-verdict branch, it produces a `decision_queue` row
exactly like any session-derived detour, and the existing badge renders it
with no changes. (There is no separate "N pending detours" badge on
`ProjectDetail.tsx` today — grepped, not present — so the brief's "badge"
almost certainly refers to this `ProjectManager.tsx` one.)

## 2. Feasibility

Not quite as simple as "just another `source` value," for two concrete
reasons found by reading the code, not assumed from the brief:

1. **The CHECK constraint is real, and this project has an unusually sharp,
   very recent, very specific defect class about exactly this move**
   (§9.6, flagged 2026-08-02 in `intake/2026-08-02-practice-kind-override/`,
   same day as this request). Five of six existing table rebuilds in
   `server/db.js` are **not** atomic (`plan_items` x2 at lines ~776 and
   ~843, `token_usage` at ~1084/~1674, `webhook_targets` at ~1524). Only
   `agents` (lines 1561-1601) does it right: `PRAGMA foreign_keys = OFF`
   outside `BEGIN`, then `BEGIN; CREATE agents_new; INSERT ... SELECT; DROP
   TABLE agents; ALTER TABLE agents_new RENAME TO agents; COMMIT;`. The
   `detour_dispositions` rebuild for this request **must** copy the `agents`
   pattern, not the more common non-atomic one already sitting in the same
   file as precedent-shaped bait.
2. **Default-branch resolution has no existing general-purpose helper to
   call as-is.** `server/lib/update-check.js` has the closest prior art
   (`listRemotes`, `pickCanonicalRemote`, `resolveCompareRefForRemote`,
   lines 36-76) but it is fork-workflow-specific (prefers an `upstream`
   remote over `origin`, tries `${remote}/master` / `${remote}/main` by
   existence check *before* falling back to `symbolic-ref
   refs/remotes/<remote>/HEAD`) and — critically — assumes a remote exists
   at all. Many of this dashboard's own mapped repos are local-only
   (`repo-topology.test.js`'s own fixtures at lines 48-59 `git init` with no
   `remote add` at all). A general trunk-drift detector needs a
   remote-optional resolution order: local `HEAD`/branch-existence checks
   first (`git show-ref --verify refs/heads/main`,
   `refs/heads/master`), `origin/HEAD` symbolic-ref as a secondary signal
   when a remote exists, no GitHub API. This is new logic, informed by but
   not directly reusable from `update-check.js`.

No variant branches in the sense of modes/tiers exist for this feature (no
per-project-type toggle to fan out across) — but there IS a real "different
repo shape" fan-out: bare repos, detached-HEAD worktrees, repos with the
default branch checked out in a *non-primary* worktree (`git worktree add`
puts `main` somewhere other than the mapped `project_paths.cwd`), and repos
with zero commits. Each is a distinct code path the detector must handle
explicitly (see Gotchas), the same way `checkWorktreeDirty` in
`repo-topology.js` treats an unreadable state as `null` rather than
guessing.

## 3. Effort estimate

**M** (not S, not L).

Reasoning:
- The git-derivation logic itself (`resolveDefaultBranch`,
  `detectTrunkDrift`, diff/log formatting, bounding) is a genuinely new
  ~150-250 line module, but it's mechanically similar work to
  `repo-topology.js` (execFile wrapping, porcelain-ish parsing, bounded
  loops) — a team that just built that file has direct precedent to mirror.
  On its own this would be S.
- The atomic table-rebuild migration (§1/§2 above) is the effort driver: it
  requires (a) the rebuild itself following the `agents` pattern exactly,
  (b) a `db-migration.test.js` `UPGRADE_CASES` entry per the §9.5 acceptance
  criterion (seed legacy shape, migrate, assert), and (c) per §9.6's
  acceptance criterion, an **interruption test** (modeled on
  `agents-legacy-rebuild.test.js`) proving a crash mid-rebuild rolls back
  cleanly rather than orphaning `detour_dispositions_old`. That third piece
  in particular is real, non-trivial test-writing, not boilerplate.
- The `recordTrunkDriftDetour` wiring into `detours.js`/`db.js` is small
  (S), but determining the correct `cwd`/`source_ref`/`label` semantics
  (see §4/Gotchas) is a design decision with real edge cases, not a
  mechanical port.
- Route wiring (§1, `routes/projects.js`) is small once the module exists.
- No client/UI work needed (§1), which keeps this out of L territory.

## 4. Dependencies & order

1. **Schema first.** The `detour_dispositions.source` CHECK widening in
   `server/db.js` (atomic rebuild + `UPGRADE_CASES` entry + interruption
   test) must land before anything calls `upsertDetourDisposition` with
   `source = "trunk_drift"` — that INSERT would otherwise fail its own CHECK
   constraint (SQLite enforces `CHECK` on every write, not just at table
   creation). This is a hard ordering dependency, not a style preference.
2. **Detector module** (`server/lib/trunk-drift.js`) — independent of (1),
   can be built/tested in parallel since it only touches git, never the DB.
3. **`detours.js`'s `recordTrunkDriftDetour`** depends on both (1) (the
   `source` value must be legal) and (2) (needs the detector's output shape
   to know what to pass as `source_ref`/`label`/`source_seen_at`).
4. **Route/periodic-tick wiring** depends on (3).
5. **`reconciliation.js` itself needs no code change** for the core "gets
   picked up" behavior (see §1) — it is a consumer of whatever lands in
   `detour_dispositions`, already source-agnostic. It only changes if the
   team decides trunk-drift detection should also run inside the periodic
   tick (open question #3), which is an *additive* step inserted before
   `evaluateRules`, not a modification of existing rule logic.

## 5. `source_ref` recommendation

Given the unique index `(cwd, source, source_ref)` (db.js:734) is what makes
re-detection idempotent (the brief's own open question #5), `source_ref`
should be **the default branch's HEAD sha at detection time**, not a
`sha_start..sha_end` range string. Reasoning:
- `upsertDetourDisposition`'s `ON CONFLICT` clause (db.js:2711-2714) only
  refreshes `label`/`item_id`/`source_seen_at` on a repeat write — it never
  changes `source_ref` itself once a row exists for a given
  `(cwd, source, source_ref)` triple. If `source_ref` were a **range**
  string that grows every time a new commit lands on trunk
  (`baseSha..newHeadSha`), every additional commit would produce a brand
  new `source_ref`, hence a brand new row — meaning the "same" ongoing body
  of unattributed trunk work would fragment into N pending detours instead
  of one that keeps refreshing. That directly breaks the idempotency
  property the brief's own assumption #5 wants.
- Using **HEAD sha only** means: as long as the same head is still
  unattributed, repeated detection hits the same `source_ref` and just
  refreshes `label`/`source_seen_at` (correct — no duplicate row). The
  moment a new commit lands on trunk, HEAD sha changes, a **new** pending
  row is created for the *new* head — which is also correct: it's a new,
  larger body of unattributed work that deserves fresh review, and the old
  row (if not yet resolved) stays as its own historical pending entry rather
  than silently disappearing.
- `baseSha` (the last point genuinely "seen" — see next paragraph) still
  needs to be captured, but as `label`/payload content (what commits/diff
  the entry describes), not as part of the identity key.

**What "base" means — first-run / no-prior-reconciliation-point case**
(explicitly asked about): there is no `focus_inferences.id`-equivalent
anchor for trunk work, so "unattributed since when" has no natural starting
point on a repo the dashboard has never looked at before. Options, in order
of how well they fit this project's existing conventions:
- Use the **most recent prior `trunk_drift` row's stored HEAD sha** for that
  `cwd` (i.e., `SELECT source_ref FROM detour_dispositions WHERE cwd = ? AND
  source = 'trunk_drift' ORDER BY created_at DESC, id DESC LIMIT 1` — the
  same `created_at`-then-`id` ordering §9.2 already mandates everywhere
  else in this codebase) as `baseSha` for the next run's diff range. This is
  the natural "since we last looked" semantics and requires no new table.
- **First-ever run for a `cwd`** has no such row. Do not walk full repo
  history back to the initial commit as a default (a repo with years of
  history would produce a diff so large it defeats the "enough content to
  describe what happened" goal, and would misrepresent old, already-shipped
  work as a fresh detour). A reasonable, bounded default: cap to the last N
  commits (mirroring `MAX_DIRTY_CHECKS_PER_REQUEST`'s bounding philosophy in
  `repo-topology.js`) or a time window (e.g. commits in the last 30 days),
  whichever the technical plan picks — but this needs to be an explicit,
  documented decision, not an accidental "walk everything" default.

## 6. How the detector determines the default branch (not hardcoded)

Concrete proposed order, git-native only, no GitHub API (per the brief's own
non-blocking assumption #1 and CLAUDE.md's local-first mission):
1. `git symbolic-ref --short refs/remotes/origin/HEAD` — authoritative when
   the repo was cloned normally or `git remote set-head origin --auto` has
   been run. Requires an `origin` remote to exist; many of this dashboard's
   mapped repos won't have one (confirmed via `repo-topology.test.js`'s own
   fixtures, which `git init` with no remote at all).
2. Fallback when no remote/no symbolic-ref: check local branch existence in
   priority order — `git show-ref --verify --quiet refs/heads/main`, then
   `refs/heads/master` — first hit wins. This is the local-only case that
   `update-check.js`'s remote-first logic doesn't cover but that this
   dashboard's actual repo population needs.
3. Last resort: `git symbolic-ref --short HEAD` (the currently checked-out
   branch of whichever worktree is being inspected) — only meaningful if
   that worktree's branch has no better signal above; should probably be
   treated as a lower-confidence "assume this checked-out branch is trunk"
   rather than blindly trusted, since a feature-branch worktree checked out
   at the time of detection would otherwise be misidentified as the default.
4. If none of the above resolve, `detectTrunkDrift` returns `{ skipped:
   "no_default_branch_resolved" }` rather than guessing — mirrors
   `checkWorktreeDirty`'s `null`-on-uncertainty contract in
   `repo-topology.js` (line 149-151: "callers must render that as unknown,
   never fall back to a false clean").

This is genuinely new logic — `update-check.js`'s `resolveCompareRefForRemote`
is the closest analog but is remote-first and fork-aware in ways that don't
transfer directly; it's a useful reference implementation to read, not a
function to import.

## 7. Gotchas

1. **§9.6 non-atomic rebuild is the single biggest risk on this request.**
   Five of six existing precedents in the same file do it wrong; only one
   (`agents`, db.js:1561-1601) does it right. A build that copies the
   `plan_items`/`webhook_targets`/`token_usage` pattern instead of `agents`
   ships a migration that silently loses every existing `detour_dispositions`
   row on an interrupted first boot after upgrade — indistinguishable from
   success (per §9.6's own description). Must be proven with an
   interruption test, not just a clean-completion test.
2. **`source` values have no shared constant today** (unlike `DISPOSITIONS`)
   — `"inferred"`/`"declared"` are hardcoded separately in `detours.js` and
   in the `db.js` CHECK. Adding `"trunk_drift"` as a third bare string in
   two places, by hand, with nothing forcing them to agree, reproduces
   exactly the drift-prone pattern `DISPOSITIONS` was built to avoid
   (detours.js's own header comment says so explicitly). Worth a small
   `SOURCES` export even though it's not strictly required to ship the
   feature.
3. **`cwd` must match `plans.cwd`, not just "the repo's git root."**
   `listReconcileTargets` only reconciles `cwd`s with a live plan
   (`plans.missing_at IS NULL`, has `plan_items`). `plans.cwd` is whatever
   folder `AGENT-PLAN.md` lives in — one specific `project_paths.cwd`/
   worktree path, not necessarily the same path `git worktree list` reports
   as checked out on the default branch. If the detector computes drift
   against the default branch but writes `detour_dispositions.cwd` as some
   other worktree path (e.g. the repo's bare/primary git dir, or wherever
   the detector happened to run `git` from), the row either never reaches
   `evaluateRules` for the right `cwd`, or pollutes an unrelated `cwd`'s
   pending-detour list.
4. **Bare repos / detached-HEAD worktrees.** `repo-topology.js`'s
   `parseWorktreePorcelain` (lines 113-142) already models `bare` and
   `detached` as explicit fields it has to handle — the new detector
   inspecting the same repos must treat these the same way: a bare
   repo has no working tree to `git status`/diff against in the normal
   sense but its refs/commits are still walkable; a detached-HEAD worktree
   has no `symbolic-ref --short HEAD` result at all (this is exactly why
   `update-check.js`'s `getCurrentBranch`, lines 78-87, wraps that call in
   try/catch returning `null` "detached HEAD" — same failure mode applies
   here).
5. **Repos with no `origin` remote configured** (very likely common in this
   dashboard's own population, per the repo-topology test fixtures) — the
   detector cannot assume `origin/HEAD` exists; must fall back to local
   branch presence (see §6). A build that only implements the
   `update-check.js`-style remote-first path will silently under-detect on
   exactly the kind of purely-local repos this dashboard is built to watch.
6. **First-run / no-prior-detection-point case** (see §5) — walking full
   history to the root commit on a first run is a real trap: large diffstat,
   wrong "detour" framing for old already-shipped work, and a real
   performance/`maxBuffer` risk (`execGit`'s `maxBuffer: 2_000_000` in both
   `repo-topology.js` and `update-check.js` — a full-history `git log -p`
   on an old repo can exceed that and throw).
7. **Ahead-count / diff-size bounding.** No existing module walks commit
   history at all today (confirmed: `repo-topology.js` only does
   `worktree list` + `status --porcelain`, never `log`/`diff`). The new
   detector needs its own bound, analogous to
   `MAX_DIRTY_CHECKS_PER_REQUEST`/`MAX_SIBLING_SCAN_ENTRIES` in
   `repo-topology.js` — e.g. a `MAX_TRUNK_DRIFT_COMMITS` cap on `git log`
   (`--max-count`) and a size cap or `--stat`-only (not full `-p` patches)
   for the diff content, with a `truncated: true` flag surfaced in the
   output so a repo with thousands of commits ahead can't turn one request
   into an unbounded git subprocess or a multi-megabyte label field.
8. **§9.2 ordering, stated precisely for this feature (per the brief's own
   flag):** commit range membership is governed by **git's own DAG/committer
   order** (`git log`'s natural order / `--topo-order`), which is a
   completely different axis from `created_at` ordering used everywhere
   else in this codebase for dashboard-table rows. Any code that
   cross-references detected commits against `events`/`focus_inferences` to
   ask "was this ever attributed" must still sort those DB-side queries by
   `created_at` (id tiebreak) per §9.2/`assertOrderedByCreatedAt` — but must
   not conflate that with "commit order," which git determines independently
   and which this detector should not re-derive itself.
9. **`session_id` is `TEXT` and nullable** on `detour_dispositions`
   (db.js:700) — confirmed safe to pass `null` for a `trunk_drift` row (no
   FK on it either, comment at line 690 says so explicitly: "audit trail
   must outlive session cleanup").

## 8. Verification hooks

Existing tests that cover the surfaces this change touches, and would catch
a regression:

- **`server/__tests__/db-migration.test.js`** — the `UPGRADE_CASES` array
  (line 56) and its meta-test (~line 1189-1196) that fails any `ALTER TABLE`
  found in `db.js` without a matching upgrade-path test. The existing
  `detour_dispositions.project_id` case (`UPGRADE_CASES[1]`, described
  around lines 131-221 and tested at 632-745) is the direct precedent to
  extend/mirror for the new `source` CHECK rebuild — but note that case is
  an `ALTER TABLE ADD COLUMN`, not a rebuild, so it does NOT by itself prove
  the new CHECK-widening rebuild is safe; a **new** case is required, tested
  against the `agents` rebuild's own test file's pattern below.
- **`server/__tests__/agents-legacy-rebuild.test.js`** — the interruption-
  test precedent (`describe("legacy agents_new rebuild ...")`, line 91). Per
  PROJECT-CONTEXT.md §9.6's acceptance criterion, the new
  `detour_dispositions` rebuild needs an equivalent test proving a crash
  mid-rebuild doesn't orphan data — this file is the template to copy, not
  just a passive reference.
- **`server/__tests__/detour-disposition.test.js`** — `describe("detours
  module")` (line 15), `describe("DISPOSITIONS meta-test")` (line 26, note:
  covers the disposition enum, not the source enum — would need an
  equivalent for `SOURCES` if that constant is added), `describe("disposition
  transitions")` (line 55), `describe("POST /api/detours/:id/resolve
  route")` (line 233). These exercise `upsertDetourDisposition`/
  `resolveDisposition` and would catch a broken CHECK constraint or a broken
  `recordTrunkDriftDetour` insert immediately (an INSERT violating the CHECK
  throws `SQLITE_CONSTRAINT` at write time).
- **`server/__tests__/reconciliation.test.js`** — `describe("evaluateRules")`
  (line 53) exercises `listPendingDetours`/`listStaleResolvedDetours`
  consumption directly; since that query is source-agnostic, a test seeding
  a `trunk_drift`-sourced pending row and asserting it gets flagged the same
  as an `inferred` one is the right regression guard that the "gets picked
  up automatically" claim in §1 actually holds.
- **`server/__tests__/reconciliation-full-tick.test.js`** — end-to-end tick
  coverage (`describe("reconciliation-full-tick")`, line 128); the closest
  existing test to a real integration check of "a pending detour reaches
  `decision_queue`."
- **`server/__tests__/repo-topology.test.js`** — not a direct test of the
  new module, but the pattern to copy for `trunk-drift.js`'s own test file:
  real throwaway git repos in a tmp dir via `execFileSync`, no mocked
  `child_process` (see file header, lines 1-7, and the `makeRepo` helper at
  lines 48-59) — this project's established convention for git-derivation
  tests, and the right place to construct fixtures for detached-HEAD,
  no-remote, and bare-repo cases named in the Gotchas above.
- No existing test currently exercises commit-history walking (`git log`/
  `git diff`) anywhere in this codebase — confirmed by the fact
  `repo-topology.js` never calls either. The new module's tests are 100%
  net-new, not an extension of coverage that already brushes this surface.
