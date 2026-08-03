# Technical Plan — Trunk-drift detection

Slug: `2026-08-02-trunk-drift-detection` · Tech-lead pass: 2026-08-02
Request type (PM, final): **new-feature** — with the
`detour_dispositions.source` CHECK-widening rebuild carved out as **accepted
debt coming due (WATCH-4, `intake/2026-08-01-build-project-manager/decisions.md`),
our cost, not new scope.**

Inputs reconciled: `request-brief.md`, `pm-plan.md`,
`supporting/architect.md`, `supporting/engineer.md`, `supporting/qa.md`,
`PROJECT-CONTEXT.md` §9.1/§9.2/§9.5/§9.6, plus direct reads of
`server/lib/repo-topology.js`, `server/lib/detours.js`,
`server/lib/reconciliation.js`, `server/lib/update-check.js`,
`server/db.js` (schema + `agents` rebuild), `server/routes/projects.js`,
`server/__tests__/agents-legacy-rebuild.test.js`,
`server/__tests__/db-migration.test.js`, and
`intake/2026-08-02-practice-kind-override/build/.../build-task-list.md`
(in flight).

Decisions this plan is written against live in **`decisions.md`** (same
folder): **DEC-1** (phase split), **DEC-2** (`source_ref` identity),
**DEC-3** (`rebuildTableAtomically`), **DEC-4** (prompt budget), **DEC-5**
(detection predicate), **WATCH-1…WATCH-8**.

---

## 1. Objective

Give the dashboard a first-class, live-computed signal for **work that landed
directly on a repo's trunk/default branch** — the failure mode that has
produced at least three un-recorded capability drops on this repo alone and is
currently found only when a human happens to run a manual sweep. We add one new
git-derivation module (`server/lib/trunk-drift.js`) with the same
recompute-per-request, never-cached posture as `server/lib/repo-topology.js`,
surface its output read-only on the Project Detail page, and then — behind a
gate — widen `detour_dispositions.source` to accept a third value
(`'trunk_drift'`) so each direct-to-trunk commit becomes a `pending` detour
that the **already-built, source-agnostic** `reconciliation.js` disposition
pass picks up with no changes to its rule logic. End state: a repo with
un-attributed trunk commits shows them on Project Detail immediately (Phase
1a), and, once the DEC-7 live-trial gate closes, feeds them into the existing
pending-detour badge and LLM qualification lifecycle (Phase 1b). No
classification logic is added anywhere; no disposition vocabulary changes; no
layer-7 UI.

---

## 2. Recommended approach

### 2.1 The shape, in one paragraph

A new module `server/lib/trunk-drift.js` resolves the repo's default branch via
a **shared helper extracted from `update-check.js`** (new
`server/lib/git-refs.js`, fetch-optional, remote-optional), then does **one
bounded `git log` walk** of that branch's first-parent line inside a lookback
window, returning a structured range object and per-commit metadata. It writes
nothing and reads no SQLite. A thin adapter in `server/lib/detours.js`
(`backfillTrunkDriftDetours`, parallel to the existing
`backfillDeclaredDetours`) explodes that result into **one
`upsertDetourDisposition` call per commit SHA**, with the label produced by a
newly-extracted, size-capped, shared-home composer. Schema work — the CHECK
widening — is done through a new generic `rebuildTableAtomically` helper, whose
first call site this is.

### 2.2 Phase split — **adopted** (DEC-1)

The PM's §6.1 1a/1b split is adopted unchanged. Concretely:

| | Phase 1a (unblocked, build now) | Phase 1b (gated) |
|---|---|---|
| New modules | `server/lib/git-refs.js`, `server/lib/trunk-drift.js` | `server/lib/db-rebuild.js` |
| Schema | **none** | `detour_dispositions.source` CHECK widen (atomic rebuild) |
| DB writes | **none** | `recordTrunkDriftDetour` / `backfillTrunkDriftDetours` |
| Reconciliation | log-only fix (DEC-4 carve-out) | prompt budget/ordering hardening + periodic-tick invocation |
| Surface | `GET /api/projects/:id/trunk-drift` + read-only Project Detail card | existing pending-detour badge (zero new UI) |
| Trigger | on-demand per page view | on-demand **and** periodic (PM open decision #6, staged) |
| Gate | — | **WATCH-5**: DEC-7's live trial must close first |

### 2.3 Where I overrode an evaluator — stated explicitly

1. **Engineer §5, `source_ref` = trunk HEAD sha → OVERRIDDEN.** Adopting the
   architect's **one row per commit, `source_ref` = that commit's SHA**. Full
   reasoning in **DEC-2**; the short version is that HEAD-sha rows are
   *supersets of each other*, so two `pending` rows describing overlapping
   commit sets can both reach `buildDispositionPrompt` in one batch and, under
   DEC-13's unattended auto-write, write the same work into `AGENT-PLAN.md`
   twice. The engineer's underlying point — **never a `start..end` range
   string** — is fully adopted.
2. **Architect §3 Option C, "extract the ref-resolution core of
   `update-check.js`" → ADOPTED WITH A NARROWING.** The engineer is right
   (§2.2) that `resolveCompareRefForRemote` is fork-workflow-specific
   (prefers `upstream`, tries `master` before `main`, assumes a remote exists)
   and is not directly reusable for a dashboard population where many mapped
   repos are `git init`-only with no remote. So we share the **primitives**
   (`execGit`, `listRemotes`, `pickCanonicalRemote`) and add a **new,
   remote-optional `resolveDefaultBranch`** beside them, leaving
   `resolveCompareRefForRemote` in `update-check.js` byte-for-byte unchanged.
   That is "one home for default-branch knowledge" without changing any
   existing behaviour.
3. **Engineer §6 step 3, "last resort: `git symbolic-ref --short HEAD`" →
   REJECTED.** A feature-branch worktree checked out at detection time would be
   misidentified as trunk — the single worst failure mode for a
   false-positive-sensitive detector. Replaced with a **sole-local-branch**
   rule (if the repo has exactly one local branch, that is trunk, whatever it
   is named), which covers the QA-mandated nonstandard-trunk-name case without
   the misidentification risk. Everything else returns
   `{ skipped: "no_default_branch" }` rather than guessing —
   `checkWorktreeDirty`'s `null`-on-uncertainty contract.
4. **`request-brief.md` assumption #2, "the detector does not need to attempt
   attribution at all" → NARROWED.** Taken literally it fails QA §3a case 3,
   the load-bearing false-positive guard. Resolved by **DEC-5**: a purely
   **git-native** predicate (first-parent, non-merge, not reachable from
   another local branch) that makes no dashboard-side attribution judgement and
   reads no dashboard table. Accepted residual: **WATCH-1**.
5. **Architect §5's §9.1 reading → the PM's call (§4.3) upheld.** §9.1
   DERIVED-DUAL-VIEW does **not** apply (three composers are not three
   derivations of one true value; `buildDispositionPrompt` reads
   `f.label || ""` as an opaque string). The architect's *residual* concern —
   discoverability and a shared size/trust contract — is treated as a plain
   code-organisation requirement and is built (§5.5).

### 2.4 `rebuildTableAtomically`: build it here, now (DEC-3)

PM §6.3 asked for the helper with these two rebuilds as its first call sites,
noting "whichever build starts first." **`practice-kind-override`'s build has
already started** — its `build-task-list.md` Task 1 hand-rolls the
`coach_observations` rebuild and its Task 4 is a *structural scan keyed to that
file's literal source text*, with red-first evidence already being recorded.
Retrofitting it mid-flight would invalidate that evidence for no safety gain.
So: **the helper is built here, `detour_dispositions` is call site #1, and
`coach_observations` is pre-seeded into the `REBUILD_CASES` grandfather list
with a dated reason** so neither effort breaks the other on merge. Its
conversion is tracked by **WATCH-6**, not left to chance.

### 2.5 Prompt-budget hardening: in scope (DEC-4)

In scope, as PM §6.3.3 mandated — **not** deferred as a separate item. The
`.slice(0, 8_000)` bug is latent today only because every input is capped
upstream; **this change ships the first unbounded input**, so landing
`trunk_drift` labels without the cap converts a latent bug into a live one in
the same commit. Three fixes, Phase 1b, except the
`parseDispositionOutput` **logging** fix which is pulled forward into Phase 1a
because DEC-7's live trial runs this week and is materially harder to run
against a pipeline whose main failure mode is silent.

---

## 3. Change set

Grouped by layer. Paths are repo-relative to
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/`.

Every new `.js`/`.ts`/`.tsx` file below **must** open with the file-header
comment and the exact line `@author Son Nguyen <hoangson091104@gmail.com>`
(`.claude/rules/file-headers.md`); `bash .claude/skills/file-headers/scripts/check-headers.sh`
must exit 0.

### 3.1 Git-derivation layer — Phase 1a

**NEW `server/lib/git-refs.js`** — one home for "which git ref is this repo's
trunk," shared by `update-check.js` and `trunk-drift.js`.

```js
// timeout default 10_000, maxBuffer 2_000_000, env: isolatedGitEnv(), stdout trimmed
async function execGit(repoPath, args, opts = {}) : Promise<string>
async function listRemotes(repoPath) : Promise<string[]>
async function pickCanonicalRemote(repoPath) : Promise<string | null>   // REMOTE_PRIORITY = ["upstream","origin"], else remotes[0]
async function resolveDefaultBranch(repoPath, opts = {}) : Promise<{ branch: string|null, via: Via|null }>
// opts: { allowFetch = false, timeout = 10_000, candidates = ["main","master"] }
// Via = "remote_head" | "remote_ref" | "local_ref" | "sole_local_branch"
module.exports = { execGit, listRemotes, pickCanonicalRemote, resolveDefaultBranch, REMOTE_PRIORITY };
```

`resolveDefaultBranch` order (stop at first hit; **never** a GitHub API call,
and **no fetch** unless `allowFetch === true`, which no caller in this plan
passes):

1. `remote = await pickCanonicalRemote()`; if a remote exists →
   `git symbolic-ref --short refs/remotes/<remote>/HEAD`, strip the
   `<remote>/` prefix → `via: "remote_head"`.
2. If a remote exists but has no symbolic-ref → for each `candidates` entry,
   `git rev-parse --verify --quiet <remote>/<c>` → `via: "remote_ref"`.
3. Local, remote-independent → for each `candidates` entry,
   `git show-ref --verify --quiet refs/heads/<c>` → `via: "local_ref"`.
4. `git for-each-ref --format=%(refname:short) refs/heads/` → **exactly one**
   branch → that branch → `via: "sole_local_branch"`.
5. Otherwise `{ branch: null, via: null }`.

**MODIFIED `server/lib/update-check.js`** — delete its private
`REMOTE_PRIORITY`, `listRemotes`, `pickCanonicalRemote`; import them from
`./git-refs`. Keep its own `execGit` (its 120 s default is for `git fetch`) and
keep `resolveCompareRefForRemote` **unchanged**. `module.exports` stays
`{ getUpdatesStatus, DEFAULT_ROOT }` — verified: nothing external imports the
removed functions.

**NEW `server/lib/trunk-drift.js`** — the detector. Imports
`{ execGit, resolveDefaultBranch }` from `./git-refs` and `{ isGitRepo }` from
`./repo-topology` (already exported). **No third private `execGit` copy is
created** (engineer §1); the two existing private copies in
`repo-topology.js` / `update-check.js` are left alone per the
minimal-reversible-diff rule.

```js
const MAX_TRUNK_DRIFT_COMMITS = 200;            // hard per-request ceiling, sibling of MAX_DIRTY_CHECKS_PER_REQUEST
const DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS = 7;    // env: DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS
const MAX_SUBJECT_CHARS = 160;

function trunkDriftLookbackDaysFromEnv() : number
async function detectTrunkDrift(repoPath, opts = {}) : Promise<TrunkDriftResult>
// opts: { lookbackDays, maxCommits, now, seenShas = new Set(), timeout }
module.exports = { detectTrunkDrift, trunkDriftLookbackDaysFromEnv,
                   MAX_TRUNK_DRIFT_COMMITS, DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS };
```

Return shape:

```js
// drift computed (whether or not any commits were found)
{
  skipped: null,
  repoPath, defaultBranch, defaultBranchVia,
  headSha, lookbackDays, since,            // since = ISO cutoff actually used
  commits: [{ sha, shortSha, authorName, authorEmail, committedAt, subject,
              filesChanged, insertions, deletions }],   // git DAG order (newest first)
  commitCount, truncated,                   // truncated === hit maxCommits
  range: { firstSha, lastSha } | null,      // oldest/newest in `commits`
}
// or, never guessing:
{ skipped: "not_a_repo" | "no_default_branch" | "no_commits" | "git_error", repoPath }
```

### 3.2 API layer — Phase 1a

**MODIFIED `server/routes/projects.js`** — add **one new route**, placed
beside `GET /:id/repos` (line ~381). Do **not** widen `/:id/repos`'s response
shape (`.claude/rules/backend-node.md`: preserve response shapes) — trunk-drift
is a slower `git log` call and belongs on its own lazily-fetched endpoint.

```js
// GET /api/projects/:id/trunk-drift
// -> { repos: [ { cwd, pathId, drift: TrunkDriftResult } ] }
router.get("/:id/trunk-drift", async (req, res) => { ... });
```

Iterates `stmts.listProjectPaths.all(project.id)`, skips non-repos via
`isGitRepo`, calls `detectTrunkDrift(p.cwd)` for each, returns per-mapped-path
results. **Phase 1a passes no `seenShas`** (nothing is persisted yet) and is
**not** gated on a plan existing (WATCH-2).

### 3.3 Ordering axes — stated once, normatively (§9.2)

The tech plan is required to say which ordering governs what. Two axes, never
to be conflated:

- **Commit sequencing is git's own DAG order.** The `--first-parent` walk's
  natural order is authoritative. `trunk-drift.js` must not re-sort by any
  timestamp, and must not treat `committedAt` as a sort key — a rebased or
  clock-skewed commit is still exactly where git puts it.
- **Any dashboard-table query sorts by `created_at`, `id` as tiebreak.** The
  only dashboard query this feature adds is `listTrunkDriftRefs`
  (§3.4), a `WHERE cwd = ? AND source = 'trunk_drift'` set-membership read with
  **no `LIMIT`, no window, no ordering at all** — so §9.2 does not bind it
  (architect §4, PM §4.3 upheld). If a future round adds an attribution join
  against `events`/`focus_inferences`, §9.2 binds that join and it needs its own
  WATCH row at that time (WATCH-1).

### 3.4 Data layer — Phase 1b

**NEW `server/lib/db-rebuild.js`** — the §9.6 durable cure (DEC-3).

```js
/**
 * One home for "rebuild a SQLite table atomically", so atomicity stops being
 * re-decided by hand per site. Models server/db.js's `agents` rebuild
 * (server/db.js:1560-1600) — the only correct one of the six that predate it.
 */
function rebuildTableAtomically(db, {
  table,        // "detour_dispositions"
  createSql,    // full `CREATE TABLE <table>_new (...)` text
  copySelect,   // `INSERT INTO <table>_new (<cols>) SELECT <cols> FROM <table>`
  indexes = [], // CREATE INDEX statements, executed AFTER the transaction commits
  log = console.error,
}) : { rebuilt: boolean, skipped: null | "orphan_detected" | "error" }
module.exports = { rebuildTableAtomically };
```

Contract, enforced in this one place (each clause is a §9.6 "how to comply"
bullet):

- **Orphan belt.** Query `sqlite_master` for `<table>_old` / `<table>_new`
  before touching anything. If found → `log()` loudly, return
  `{ rebuilt: false, skipped: "orphan_detected" }`. **Never throw** — `db.js`
  runs at `require()` time and a throw bricks boot for server, MCP, desktop and
  the VS Code extension against the one shared `DB_PATH`.
- **`db.pragma("foreign_keys = OFF")` outside and before `BEGIN`.** SQLite
  ignores the pragma inside a transaction.
- **One `db.exec` containing the whole DDL**, create-new → copy → drop-old →
  rename, bracketed by `BEGIN;` … `COMMIT;`. On rollback the original table is
  still there under its own name.
- **Never throw on failure.** Wrap in try/catch; best-effort
  `db.exec("ROLLBACK")`, `log()`, return `{ rebuilt: false, skipped: "error" }`.
- **`db.pragma("foreign_keys = ON")` in `finally`.**
- Indexes are created **after** COMMIT, `IF NOT EXISTS`.

**MODIFIED `server/db.js`** — three edits:

1. `CREATE TABLE IF NOT EXISTS detour_dispositions` body, **line 701**:
   `source TEXT NOT NULL CHECK(source IN ('inferred','declared','trunk_drift'))`.
   (Fresh installs. This alone is §9.5's textbook no-op for existing DBs — edit
   2 is what makes it real.)
2. A guarded rebuild block immediately after that `CREATE TABLE` / index group
   (before the prepared statements are compiled), calling
   `rebuildTableAtomically`. Gate: read
   `SELECT sql FROM sqlite_master WHERE type='table' AND name='detour_dispositions'`
   and run **only if** that text does **not** contain `'trunk_drift'`. The
   orphan check lives inside the helper. `createSql` must be the **full current
   28-column shape** copied verbatim from the `CREATE TABLE` body above with
   the widened CHECK — every column, both other CHECKs, all defaults.
   `copySelect` names all 28 columns **explicitly** (never `SELECT *` — the
   `agents-legacy-rebuild.test.js` regression exists precisely because a
   rebuild's column list drifted from the table). `indexes` re-creates all
   three: `idx_detour_dispositions_src` (UNIQUE, `(cwd, source, source_ref)`),
   `idx_detour_dispositions_cwd_created`, `idx_detour_dispositions_resolved_item`.
3. New prepared statement beside the other `detour_dispositions` ones
   (~line 2708):
   ```js
   listTrunkDriftRefs: db.prepare(
     "SELECT source_ref FROM detour_dispositions WHERE cwd = ? AND source = 'trunk_drift'"
   ),
   ```

`upsertDetourDisposition` (db.js:2708-2715) and `listPendingDetours`
(db.js:2721-2724) need **no change** — both are already generic over `source`
(confirmed by direct read).

### 3.5 Detour-write layer — Phase 1b

**MODIFIED `server/lib/detours.js`.** Additions, all exported (this module's
header already declares it owns every read/write of `detour_dispositions`
except the write-audit columns):

```js
const SOURCES = ["inferred", "declared", "trunk_drift"];   // engineer gotcha #2 — mirrors DISPOSITIONS' stated purpose
const MAX_DETOUR_LABEL_CHARS = 400;                        // DEC-4; derived from PM's live budget math

function capLabel(text) : string | null                    // trim, strip control chars, collapse newlines -> " ", slice(0, MAX_DETOUR_LABEL_CHARS)
function formatInferredLabel(result) : string | null       // thin today: capLabel(result.label)
function formatDeclaredLabel(data) : string | null         // the title/description composer currently INLINE at lines 90-92, extracted verbatim + capLabel
function formatTrunkDriftLabel(commit) : string            // `${shortSha} ${subject} (+${insertions}/-${deletions} in ${filesChanged} files)` -> capLabel
function listSeenTrunkDriftShas(dbModule, cwd) : Set<string>
function recordTrunkDriftDetour(dbModule, cwd, commit, opts = {}) : void
function backfillTrunkDriftDetours(dbModule, cwd, driftResult) : { written: number }
```

- `recordInferredDetour` and `backfillDeclaredDetours` are **rewired to call
  `formatInferredLabel` / `formatDeclaredLabel`** — the cap must apply at
  *every* composer's return, not just the new one (DEC-4; the architect's §5
  "generalise, don't special-case" requirement). This is the only behavioural
  change to those two functions.
- `recordTrunkDriftDetour` calls the **same** `stmts.upsertDetourDisposition`
  prepared statement — no new INSERT path — with
  `(cwd, lookupProjectId(dbModule, cwd), /* session_id */ null, "trunk_drift",
  commit.sha, commit.committedAt, formatTrunkDriftLabel(commit), null)`.
  `session_id` is nullable with no FK (db.js:700, comment at 690 says so
  explicitly). Wrapped in try/catch per-row, matching
  `backfillDeclaredDetours`'s fail-safe posture.
- `backfillTrunkDriftDetours(dbModule, cwd, driftResult)` returns early on
  `driftResult.skipped`, then calls `recordTrunkDriftDetour` once per commit.
  **`cwd` is the caller's `plans.cwd`-shaped path, never a git root** (§4.4).

### 3.6 Reconciliation layer

**MODIFIED `server/lib/reconciliation.js`.**

*Phase 1a (log-only, DEC-4 carve-out):*
- `parseDispositionOutput`'s terminal `catch` gains
  `log("[reconciliation] disposition output unparseable — 0 verdicts this tick", err?.message)`.
- After a successful parse, if `out.size === 0 && flagged.length > 0`, log that
  too. Zero behavioural change to any verdict.

*Phase 1b:*
- `buildDispositionPrompt`: **move the `Reply with ONLY JSON: {...}` line to
  immediately after the preamble**, above `PLAN ITEMS:` / `DETOURS:`. Budget
  the two lists per-section (`itemList` and `detourList` each get their own
  cap) instead of relying on whole-prompt truncation. Keep the final
  `.slice(0, 8_000)` as a backstop, but log when it actually bites. Confirmed
  by grep: **no existing test asserts on this prompt's text**, so this is a
  safe reorder.
- **Periodic invocation** (PM open decision #6, 1b half): inside `reconcileCwd`,
  *after* the `no_plan` / `no_items` early returns and *before*
  `evaluateRules`, call
  `detectTrunkDrift(cwd, { seenShas: listSeenTrunkDriftShas(dbModule, cwd) })`
  then `backfillTrunkDriftDetours(dbModule, cwd, drift)`. This is an **additive
  step**, not a modification of `evaluateRules` — the detector is git-only, so
  `evaluateRules`'s pure / zero-LLM contract is preserved (engineer §1).
  Guard the whole step in try/catch: a git failure must never abort a tick.
- **No change** to `listReconcileTargets`, `evaluateRules`,
  `classifyFlaggedDetours`, `enqueueIfNotOpen`, or anything in
  `plan-writeback.js`. `listPendingDetours` has no `source` filter, so pickup is
  automatic (engineer §1, verified).

### 3.7 Client layer — Phase 1a only

**MODIFIED:**
- `client/src/lib/types.ts` — add `TrunkDriftCommit`, `TrunkDriftResult`,
  `ProjectTrunkDriftResponse`, beside `ProjectRepoTopology`.
- `client/src/lib/api.ts` — add
  `trunkDrift: (id: string) => request<ProjectTrunkDriftResponse>(\`/projects/${encodeURIComponent(id)}/trunk-drift\`)`
  to the `projects` API object, beside `repos` (line ~2420), with the same
  doc-comment style.
- `client/src/pages/ProjectDetail.tsx` — one read-only card ("Direct-to-trunk
  work"), per mapped repo: default branch name, commit count, lookback window,
  and the commit list (short SHA · subject · author · relative date · `+I/-D`).
  Renders `skipped` reasons as an explicit "unknown" state, never as "clean"
  (`checkWorktreeDirty`'s contract). **No badge, no verdict, no action button.**
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — new keys for the
  card. All four locales in the same change (`.claude/rules/docs-markdown.md`).

**Phase 1b needs zero client work** — verified by the engineer (§1): the
pending-detour badge in `ProjectManager.tsx` (lines 65-66, 73-74, 621, 634)
renders off `decision_queue.kind === "detour_disposition"`, which
`reconciliation.js` enqueues source-agnostically. This is exactly Sara's
"reuse the existing badge, don't invent a new one."

### 3.8 Docs — both phases

Per CLAUDE.md, the `update-project-docs` skill runs at the end of each phase's
change-set (behaviour, schema, config and route surfaces all change):
`docs/API.md` (new route), `docs/DATABASE.md` (`source` enum + the rebuild),
`ARCHITECTURE.md` (the new derivation module and its posture),
`server/README.md` (the `DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS` env knob).

---

## 4. Implementation steps

Sequenced; each step is independently checkable. **Red-first discipline is
mandatory on every guard test (§9.3 VACUOUS-GUARD): write the test, observe it
fail for the stated reason, then implement, then observe it pass. Record the
red observation in the commit message.**

### Phase 1a — detector, read-only (no schema change, no DB write)

**Step 1 — extract `server/lib/git-refs.js`.**
Create the module with `execGit`, `listRemotes`, `pickCanonicalRemote`,
`REMOTE_PRIORITY` moved verbatim from `update-check.js`, plus the new
`resolveDefaultBranch` (§3.1). Update `update-check.js` to import them and
delete its local copies; leave `execGit` and `resolveCompareRefForRemote` in
place. **Check:** `node --test server/__tests__/update-check.test.js` green
with **zero edits to that file** — this is the proof the refactor is
behaviour-preserving.

**Step 2 — `trunk-drift.test.js` fixture harness (red).**
Create `server/__tests__/trunk-drift.test.js` following
`server/__tests__/repo-topology.test.js` exactly: real throwaway repos under
`fs.realpathSync(os.tmpdir())` built with `execFileSync`, git env stripped of
`GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY`/
`GIT_ALTERNATE_OBJECT_DIRECTORIES` on every fixture call, **no mocked
`child_process`, no db module at all**. Write the §6.1 cases. **Check:** the
whole file fails on `Cannot find module '../lib/trunk-drift'`.

**Step 3 — implement `detectTrunkDrift`.**
Guard order: `isGitRepo` → `resolveDefaultBranch` → `git rev-parse --verify
--quiet refs/heads/<branch>` for `headSha`. Then **one** `git log` call
carrying everything:

```
git log --first-parent --no-merges
        --since=<sinceIso> --max-count=<maxCommits + 1>
        --date=iso-strict --shortstat
        --format=%x1e%H%x1f%an%x1f%ae%x1f%cI%x1f%s
        refs/heads/<branch>
        --not --exclude=refs/heads/<branch> --branches
```

Records split on `\x1e`, fields on `\x1f`; the `--shortstat` line trails each
record and is parsed for `filesChanged`/`insertions`/`deletions` (absent ⇒ 0).
Truncate the subject to `MAX_SUBJECT_CHARS`. If the walk returned more than
`maxCommits`, slice and set `truncated: true`. Filter out
`opts.seenShas`. Every git failure ⇒ `{ skipped: "git_error" }`, never a throw
and never a false "clean". **Check:** Step 2's cases pass.
**Verify the `--exclude`/`--branches` argument ordering against the real
fixtures** — it is order-sensitive and is the mechanism behind DEC-5 clause 3.

**Step 4 — `GET /api/projects/:id/trunk-drift`.**
Add the route (§3.2) and a case in `server/__tests__/projects.test.js`:
404 on unknown project, `{ repos: [] }` on a project with no repo paths, and a
populated `drift` for a fixture repo with a direct-to-trunk commit.

**Step 5 — client card.**
`types.ts` → `api.ts` → `ProjectDetail.tsx` → four locale files, in that order.
**Check:** `npm run test:client`. The per-screen snapshot
(`client/src/pages/__tests__/screens.snapshot.test.tsx`) **will** change —
review the diff by eye, confirm it is only the new card, then regenerate with
`cd client && npx vitest run -u`. Never blind-update (CLAUDE.md).

**Step 6 — `parseDispositionOutput` logging (DEC-4 carve-out).**
Two log lines in `reconciliation.js` (§3.6). **Check:**
`node --test server/__tests__/reconciliation.test.js` green **unmodified**.

**Step 7 — docs + headers.** `update-project-docs`;
`bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0;
`npm run test:server` and `npm run test:client` both green.

### 🚦 GATE between phases — do not cross without both

1. **DEC-7's live trial is closed** (WATCH-5): the 2 pending `decision_queue`
   entries read, `detour_dispositions` id 19's `write_status='failed'`
   diagnosed, the block that landed in `/Users/sara/CODE-LOCAL/SARA/emails`'s
   `AGENT-PLAN.md` reviewed, verdict "signal or noise" recorded.
2. **DEC-3 confirmed** (build the helper here) — recorded; re-confirm only if
   `practice-kind-override` merged in a way that changes the picture.

### Phase 1b — schema, plumbing, pickup

**Step 8 — `rebuildTableAtomically` + its own tests (red first).**
Create `server/lib/db-rebuild.js` (§3.4). Create
`server/__tests__/db-rebuild.test.js` **first**, as a pure unit test against a
throwaway `better-sqlite3` file: (a) happy path rebuilds and preserves rows;
(b) a deliberately-failing `copySelect` (select a non-existent column) →
returns `{ rebuilt: false, skipped: "error" }`, **does not throw**, original
table intact with every row, **no `_new`/`_old` orphan in `sqlite_master`** —
this is the §9.6 interruption proof, and it is a real behavioural proof of
rollback, not a structural read; (c) a pre-seeded `<table>_new` orphan →
`{ rebuilt: false, skipped: "orphan_detected" }`, logs, does not throw, table
untouched. **Red proof for (b):** temporarily drop the `BEGIN;`/`COMMIT;` from
the exec string and observe (b) fail with an orphaned `_new` table; restore.

**Step 9 — the `detour_dispositions.source` CHECK widening.**
Edit `db.js` (§3.4 edits 1 + 2). `createSql` and `copySelect` must be checked
column-by-column against the live `CREATE TABLE` body — all 28 columns, both
other CHECK constraints, all defaults. **Check:** boot `db.js` against a copy
of the real `~/.claude/agent-dashboard/dashboard.db`; every one of the 24
existing rows survives byte-identical; second boot is a no-op.

**Step 10 — migration tests.**
(a) New `UPGRADE_CASES`-adjacent `describe` block in
`server/__tests__/db-migration.test.js` per QA §3c: seed a pre-migration DB
with the **legacy** `CHECK(source IN ('inferred','declared'))` plus one real
`inferred` row and one real `declared` row; migrate; assert both rows survive
byte-identical, `source='trunk_drift'` now inserts, **`source='bogus'` still
fails the CHECK** (widened, not dropped), and `idx_detour_dispositions_src`
survives as UNIQUE on `(cwd, source, source_ref)` via `PRAGMA index_list` +
`PRAGMA index_info`.
(b) New `server/__tests__/detour-dispositions-source-rebuild.test.js` — a
structural scan asserting the rebuild's DDL lives in **one** `db.exec` with
`BEGIN;`…`COMMIT;` and that `PRAGMA foreign_keys` is **not** inside that
string, plus an orphan-guard boot test (seed a leftover
`detour_dispositions_new`, `require("../db")`, assert no throw and the real
table untouched).
(c) **Red proof (§9.3):** stub the rebuild block to a no-op and confirm (a)'s
`trunk_drift` insert fails loudly with `SQLITE_CONSTRAINT`; restore.

**Step 11 — `REBUILD_CASES` registry meta-test.**
In `db-migration.test.js`, beside the existing `ALTER TABLE … ADD COLUMN`
meta-test (~line 1164), add a `REBUILD_CASES` array and a scan of `db.js` for
`CREATE TABLE (\w+)_new` and `ALTER TABLE (\w+) RENAME TO \1_old`. Every
discovered table must be either **registered** (`{ table, legacyCaseFile,
interruptionCaseFile }`) or **grandfathered with a dated reason** — same shape
as `chronology-ordering.test.js`'s `GRANDFATHERED_QUERIES`. Seed exactly the
table in **WATCH-6**: `plan_items` ×2, `token_usage` ×2, `webhook_targets`,
`agents`, `coach_observations` grandfathered; `detour_dispositions`
registered. **Red proof:** delete `detour_dispositions` from `REBUILD_CASES`
and confirm the meta-test fails naming §9.6; restore.

**Step 12 — label composers + `SOURCES` + `MAX_DETOUR_LABEL_CHARS`.**
Extract `formatInferredLabel` / `formatDeclaredLabel` (the latter verbatim from
today's inline lines 90-92), add `capLabel`, `formatTrunkDriftLabel`,
`SOURCES`, and rewire the two existing writers (§3.5). Add to
`server/__tests__/detour-disposition.test.js`: a `SOURCES` meta-test mirroring
the existing `DISPOSITIONS` one (assert `SOURCES` exactly matches the CHECK
text parsed out of `sqlite_master`), and a cap test asserting **every** composer
returns ≤ `MAX_DETOUR_LABEL_CHARS`, control-char-free, newline-free.

**Step 13 — `recordTrunkDriftDetour` / `backfillTrunkDriftDetours` / `listTrunkDriftRefs`.**
Implement §3.5 + the `listTrunkDriftRefs` prepared statement. Tests per §6.2,
against real SQLite via `DASHBOARD_DB_PATH` (the
`reconciliation-full-tick.test.js` pattern), **not** a `stmts` fake.

**Step 14 — prompt-budget hardening.**
`buildDispositionPrompt` reorder + per-section budgeting + backstop logging
(§3.6). New test: a batch of 10 detours each at the full 400-char cap, plus the
largest realistic `PLAN ITEMS` block, and assert the `Reply with ONLY JSON`
instruction is **present in the returned string**. **Red proof:** run the same
assertion against the current tail-instruction ordering with oversized labels
and watch it fail.

**Step 15 — periodic invocation in `reconcileCwd`.**
Insert the detect→backfill step (§3.6). **Check:**
`reconciliation.test.js` and `reconciliation-full-tick.test.js` pass with
**zero edits to their existing `inferred`/`declared` assertions**, plus the new
source-agnostic-pickup case from §6.3.

**Step 16 — manual verification (§6.4), docs, full suite.**

---

## 5. Single-source-of-truth guardrail

This project's convention is **`PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW**:
one fact, one computing function, imported by every consumer — the shape
`detours.js`'s own header cites for `DISPOSITIONS` ("the JS check and the SQL
CHECK constraint cannot drift"), and `reconciliation.js` cites for
`pace.paceStatus`. Five canonical surfaces this change touches, each of which
**must route through the single home, never be hand-edited per path**:

1. **The `source` enum.** Today `"inferred"` / `"declared"` are bare string
   literals hardcoded separately in `detours.js` and in `db.js`'s CHECK, with
   nothing forcing agreement (engineer gotcha #2). Adding `"trunk_drift"` as a
   third bare string in two more places reproduces exactly the drift
   `DISPOSITIONS` was built to prevent. **Required:** `SOURCES` is exported
   from `detours.js` and is the only place the vocabulary is spelled in JS,
   with a meta-test parsing the CHECK text out of `sqlite_master` and asserting
   set equality (§4 Step 12). This mirrors the existing `DISPOSITIONS`
   meta-test at `detour-disposition.test.js:26`.
2. **Default-branch resolution.** One implementation,
   `git-refs.resolveDefaultBranch`. `trunk-drift.js` must not contain its own
   `main`/`master` guessing, and `update-check.js` must not keep a second copy
   of `listRemotes`/`pickCanonicalRemote` (§3.1). Two "what is trunk"
   implementations is the shape the catalog keeps re-flagging — and here the
   first one already exists and is already tested.
3. **Detour label production.** Three composers, one home
   (`detours.js`), one shared cap applied where **every** composer returns
   (`capLabel`). §9.1 does **not** apply in its strict form (PM §4.3: three
   sources need not produce interchangeable values), but the *discoverability
   and shared size/trust contract* absolutely does — today's declared-label
   composer is already an undiscoverable inline one-off, and a third hand-rolled
   composer inside a brand-new module is how a fourth and fifth accumulate.
   **A trunk-drift label composer written inside `trunk-drift.js` fails this
   plan.**
4. **Table rebuilds.** One implementation, `db-rebuild.rebuildTableAtomically`
   (DEC-3). A new rebuild site that hand-rolls its own `BEGIN`/`COMMIT` fails
   the `REBUILD_CASES` meta-test. The grandfather list is the escape hatch and
   it is dated, reasoned and tracked (WATCH-6) — not a way around the rule.
5. **i18n strings.** The four locale files
   (`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`) are edited in
   the **same change**, never one path at a time.

---

## 6. Testing & verification

QA's plan (`supporting/qa.md`) is folded in wholesale. Stack: Node's built-in
`node:test`, real SQLite, real `git` subprocesses against throwaway temp repos —
**never** mocked `child_process`. Full suite: `npm run test:server`; one spec:
`node --test server/__tests__/<file>.test.js`; client: `npm run test:client`.

### 6.1 NEW `server/__tests__/trunk-drift.test.js` (Phase 1a)

`repo-topology.test.js`-shaped: real `git init` fixtures, isolated git env,
`fs.realpathSync` on tmp paths, **no db module**. Required cases (QA §3a):

| # | Case | Assertion |
|---|---|---|
| 1a | trunk named `main`, bare `origin` with `HEAD -> refs/heads/main` | resolves `main`, `via: "remote_head"` |
| 1b | trunk named `master`, same setup | resolves `master`, `via: "remote_head"` |
| 1c | trunk named **`trunk`** (nonstandard), same setup | resolves `trunk` — proves no hardcoded `main`/`master` guess |
| 2 | **no `origin` at all**, single local branch named `trunk` | resolves `trunk`, `via: "sole_local_branch"`; does not throw, does not silently return no-drift |
| 2b | no remote, local `main` **and** a feature branch | resolves `main`, `via: "local_ref"` |
| 2c | no remote, branches `feat-a` + `feat-b`, neither `main`/`master` | `{ skipped: "no_default_branch" }` — never guesses |
| 3 | **clean trunk / no drift — the load-bearing false-positive guard.** Non-empty history: commits made on a feature branch, merged with `--no-ff` | `commits: []`. **Red proof (§9.3): drop `--first-parent`/`--no-merges` and watch this case fail** |
| 3b | same, but the feature branch still exists and was **fast-forwarded** in | `commits: []` (DEC-5 clause 3, the `--not --branches` mechanism) |
| 4 | dirty-but-uncommitted trunk, no new commits | `commits: []` — proves no conflation with `checkWorktreeDirty` |
| 5 | **first run**, repo with 30 direct-to-trunk commits spanning 60 days, `lookbackDays: 7` | only commits inside the window; explicitly asserts the **bounded-lookback** choice (PM open decision #5), not an accidental full-history walk |
| 5b | 300 direct-to-trunk commits inside the window, `maxCommits: 200` | `commits.length === 200`, `truncated === true` |
| 6 | **genuine positive**: 3 commits typed directly on trunk | all 3 returned, correct `range.firstSha`/`lastSha`, subjects + `filesChanged`/`insertions`/`deletions` present — Sara's "enough content to describe what happened" bar |
| 6b | same, with `seenShas` containing 2 of the 3 | only the unseen commit returned (idempotency filter) |
| 7 | commits authored with out-of-order `GIT_COMMITTER_DATE` | returned in **git's DAG order**, not date order — §9.2's two-axes distinction, asserted directly |
| 8 | not a repo / empty repo / detached HEAD worktree / bare repo | `{ skipped: … }` with the right reason; **never a throw, never a false "clean"** |

### 6.2 UPDATED `server/__tests__/detour-disposition.test.js` (Phase 1b)

- `SOURCES` meta-test (§5 item 1) — mirrors the existing `DISPOSITIONS` one.
- Every composer's output ≤ `MAX_DETOUR_LABEL_CHARS`, control-char-free,
  newline-free (DEC-4, WATCH-4).
- `recordTrunkDriftDetour` writes one row with `source='trunk_drift'`,
  `source_ref=<sha>`, `session_id=null`.
- **Idempotency (QA §3b.2):** run detector → backfill → detector → backfill
  over unchanged trunk state; assert row count stays at N, and that
  `disposition`/`decided_by`/write-audit columns on a previously-resolved row
  are **untouched** by the second upsert (only `label`/`item_id`/
  `source_seen_at` refresh, per `ON CONFLICT`).
- **`cwd` correctness (engineer gotcha #3, WATCH-2):** a repo whose git root
  differs from `plans.cwd` writes rows keyed to `plans.cwd`.

### 6.3 Reconciliation pickup — source-agnostic, proven (Phase 1b)

- **The unmodified-pass proof QA requires:** `reconciliation.test.js` and
  `reconciliation-full-tick.test.js` must pass with **zero changes to their
  existing `inferred`/`declared` assertions**. Nuance, stated so it is not
  discovered at build time: Step 14 changes `buildDispositionPrompt`'s text.
  Grep confirms **no existing test asserts on that text**, so the requirement
  holds literally today; if that ever stops being true, the *pickup and verdict*
  assertions are what must not move.
- **New case in `reconciliation.test.js`:** seed one `source='trunk_drift'`
  pending row and assert `evaluateRules` flags it under exactly the same
  conditions an `inferred` row is flagged — proving `listPendingDetours`'s
  lack of a `source` filter is a real property, not an assumption.
- **New case in `reconciliation-full-tick.test.js`:** a `trunk_drift` pending
  row reaches `decision_queue` as `kind='detour_disposition'` — the end-to-end
  proof that the existing badge lights up with **zero client changes**.

### 6.4 Migration + rebuild (Phase 1b)

`server/__tests__/db-rebuild.test.js` (Step 8), the `db-migration.test.js`
CHECK-widen case (Step 10a), `detour-dispositions-source-rebuild.test.js`
(Step 10b), the `REBUILD_CASES` meta-test (Step 11) — each with the red proof
named in its step.

### 6.5 Manual verification (one pass, before merge — QA §1)

1. Back up the real `~/.claude/agent-dashboard/dashboard.db` **before booting
   Phase 1b** (§9.6's own instruction).
2. On a scratch worktree of this repo, hand-commit a small no-op change
   directly to `master` — reproduces the shape of the
   `2026-07-31-focus-untracked-commits` incident.
3. Load Project Detail; confirm (a) the commit is detected, (b) the output
   carries commit messages + diffstat, (c) **no** `fold_in`/`new_item`/
   `deliberate`/`discard` appears anywhere in the detector's output.
4. The reverse: land a change through the declared-focus flow
   (`ccam focus set`, worktree branch, `--no-ff` merge) and confirm it is
   **not** flagged. This is the core false-positive check and cannot be fully
   proven by unit tests since it depends on real `ccam` behaviour end to end.
5. Boot twice against a **copy** of the real DB; second boot is a clean no-op;
   all 24 existing `detour_dispositions` rows readable and byte-identical.
6. `git reset` / delete the scratch commit and branch afterwards — otherwise
   the verification pass itself becomes a phantom trunk-drift incident in this
   repo's history.

### 6.6 Commands

```bash
npm run test:server
npm run test:client
node --test server/__tests__/trunk-drift.test.js
node --test server/__tests__/db-rebuild.test.js
node --test server/__tests__/db-migration.test.js
node --test server/__tests__/detour-dispositions-source-rebuild.test.js
cd client && npx vitest run -u          # ONLY after eyeballing the snapshot diff
bash .claude/skills/file-headers/scripts/check-headers.sh
```

---

## 7. Risks & rollback

### 7.1 Top risks, in order

| # | Risk | Watch | Mitigation / rollback |
|---|---|---|---|
| 1 | **Non-atomic rebuild silently loses all 24 `detour_dispositions` rows** on an interrupted first boot after upgrade — indistinguishable from success (§9.6) | orphaned `detour_dispositions_old`/`_new` in `sqlite_master` | `rebuildTableAtomically` (single txn, orphan belt, never throws) + the Step 8(b) behavioural rollback proof + a real DB backup before the manual pass. Rollback: restore the backup; the code change is revertible independently since the widened CHECK is a superset |
| 2 | **False positives destroy the badge's meaning** — the stated product risk | case 3/3b in §6.1, and the manual §6.5.4 pass | DEC-5's git-native predicate; the red-proof requirement on case 3. Residual: WATCH-1 |
| 3 | **One oversized label silently voids a whole tick's verdicts** for unrelated detours | the new Step 14 logs | DEC-4's three fixes. Promotion trigger: WATCH-3 |
| 4 | **A second, higher-volume source amplifies an unreviewed auto-write pipeline** (1-for-2 on real unattended writes) | `decision_queue`'s `writeback_failed` entries | WATCH-5 — Phase 1b does not start until DEC-7 closes |
| 5 | Commit subjects are the first uncontrolled external text reaching an LLM prompt that drives file writes | — | WATCH-4's four mitigations |
| 6 | `git log` on a pathological repo turns one page load into unbounded work | `truncated: true` | `MAX_TRUNK_DRIFT_COMMITS`, `DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS`, `--shortstat` not `-p`, `maxBuffer` 2 MB, one git call |
| 7 | The `git-refs.js` extraction changes `update-check.js` behaviour | — | Step 1's check: `update-check.test.js` green **unmodified** |
| 8 | Merge collision with `practice-kind-override` over `REBUILD_CASES` | — | DEC-3 / WATCH-6: `coach_observations` pre-seeded as grandfathered so neither effort breaks the other |

### 7.2 Rollback

- **Phase 1a is fully revertible by `git revert`** — three new files, one new
  route, one client card, two log lines. No schema, no writes, no state.
- **Phase 1b's code is revertible; its schema change is not "un-widened"** —
  and does not need to be. The widened CHECK is a strict superset, so reverting
  the JS leaves a working database that simply never writes `'trunk_drift'`
  again. Any rows already written stay `pending` and inert. **Do not** attempt a
  narrowing rebuild to roll back; that would fail on the existing rows.
- If drift rows prove noisy in practice, the cheapest kill switch is to remove
  the Step 15 call in `reconcileCwd` — the detector and the read-only Phase 1a
  surface keep working.

### 7.3 Scope boundaries this plan knowingly declines — each backed by a tracked row

Per this plan's own standard, nothing below exists as prose alone:

| Declined / accepted | Tracked as |
|---|---|
| Rebuild-strategy choice (generic helper vs. hand-roll) — the architect's explicit "must not be decided silently in the tech plan" | **DEC-3** |
| `source_ref` identity choice, overriding the engineer | **DEC-2** |
| No dashboard-side attribution join; git-native predicate only | **DEC-5** |
| FF-merged-then-deleted branches will be flagged (accepted false positive) | **WATCH-1** |
| Trunk drift on planless cwds never reaches the LLM | **WATCH-2** |
| No 7th catalog entry for the shared-budget bug; promotion trigger instead | **WATCH-3** |
| Commit text is uncontrolled input to an LLM prompt driving file writes | **WATCH-4** |
| Phase 1b gated on an unresolved DEC-7 | **WATCH-5** |
| Five non-atomic rebuild sites + `coach_observations` grandfathered, not retrofitted | **WATCH-6** |
| Classification vocabulary, `plan-writeback.js`, layer-7 rollup UI all untouched | **WATCH-7** |
| This build is detection-after-the-fact; the prevention half remains unadopted | **WATCH-8** |

`PROJECT-CONTEXT.md` §9.6 already carries the PM's dated design-time pre-flag
for this request (count unchanged — it converts to an occurrence only if a
non-atomic rebuild actually ships) and the SHARED-BUDGET-STARVATION promotion
trigger. No catalog edit is required by this plan beyond what the PM pass
already made.

### 7.4 Explicitly OUT of scope

- The classification / disposition logic itself —
  `fold_in`/`new_item`/`deliberate`/`discard`, `plan-writeback.js`,
  `decision_queue`'s shape. Confirmed reusable as-is (WATCH-7).
- The **layer-7 portfolio rollup UI** — still deliberately deferred per the
  `portfolio-reconciliation-vision` memory (WATCH-7).
- Any attribution heuristic joining `events`/`focus_inferences`
  (`request-brief.md` assumption #2; DEC-5, WATCH-1).
- Retrofitting the five existing non-atomic rebuilds, and converting
  `coach_observations` to the helper (WATCH-6).
- Adopting the un-intake'd-capability routing rule (`practice-kind-override`
  DEC-5) — recommended, not built here (WATCH-8).
- Any new badge or new decision-queue kind. The existing pending-detour badge
  is reused with zero client changes in 1b, which is the ask.
- A `DASHBOARD_TRUNK_DRIFT_CLASSIFY` flag — only built if Sara overrides DEC-1
  in favour of the PM's "ship 1a+1b together, LLM pickup off by default"
  alternative.

### 7.5 Effort

**M overall** (PM's and the engineer's estimate, confirmed).

| Phase | Work | Est. |
|---|---|---|
| 1a | `git-refs.js` extraction (0.25 d) · `trunk-drift.js` (0.5 d) · route (0.25 d) · client card + 4 locales + snapshot (0.5 d) · `trunk-drift.test.js` ~14 cases (0.75 d) · logging + docs (0.25 d) | **~2.5 d** |
| 1b | `db-rebuild.js` + its tests (0.75 d) · CHECK rebuild in `db.js` (0.5 d) · migration + interruption + `REBUILD_CASES` tests (0.75 d) · composers/cap/`SOURCES` (0.5 d) · adapter + tests (0.5 d) · prompt hardening (0.25 d) · tick wiring + tests (0.25 d) · manual pass + docs (0.5 d) | **~4 d** |

The detector — the actual ask — is the small half. The migration and its
interruption test are the effort drivers, exactly as both the architect and the
engineer independently found.

---

## 8. Definition of Done

**Phase 1a**

- [ ] `npm run test:server` and `npm run test:client` green;
      `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] `server/__tests__/update-check.test.js` passes **with zero edits** after
      the `git-refs.js` extraction.
- [ ] `server/__tests__/trunk-drift.test.js` covers every §6.1 case: default
      branch across `main`/`master`/**nonstandard**, with and without a remote;
      the no-default-branch skip; clean-trunk/no-drift **and** the FF-branch
      variant; dirty-but-uncommitted; first-run bounded lookback; truncation;
      genuine positive; `seenShas` filtering; the git-DAG-vs-`created_at`
      ordering distinction; and every `skipped` reason.
- [ ] Case 3 (clean trunk / no drift) is **proven red** by removing
      `--first-parent`/`--no-merges`, with the observation recorded in the
      commit message (§9.3 — this guard is load-bearing and must not be vacuous).
- [ ] `GET /api/projects/:id/trunk-drift` returns per-mapped-repo results, with
      a `projects.test.js` case; `/:id/repos`'s response shape is **unchanged**.
- [ ] Project Detail renders the read-only card; `skipped` renders as "unknown",
      never as "clean"; all four locale files updated in the same change;
      snapshot diff eyeballed before regeneration.
- [ ] `server/lib/trunk-drift.js` writes nothing, reads no SQLite, caches
      nothing, and contains **no** occurrence of `fold_in`, `new_item`,
      `deliberate`, or `discard` (grep-checkable).
- [ ] Docs updated (`docs/API.md`, `ARCHITECTURE.md`, `server/README.md`).

**Gate**

- [ ] DEC-7's live trial closed and its verdict recorded (WATCH-5).

**Phase 1b**

- [ ] Real `dashboard.db` backed up before the first boot of this build.
- [ ] `rebuildTableAtomically` exists in `server/lib/db-rebuild.js`; the
      `detour_dispositions` rebuild is its call site; **no hand-rolled
      `BEGIN`/`COMMIT` DDL** was added anywhere in `db.js`.
- [ ] The interruption test proves rollback **behaviourally** (failing
      `copySelect` → no throw, all rows intact, no `_old`/`_new` orphan), proven
      red by removing the transaction wrapper.
- [ ] Orphan detection **logs loudly and skips — never throws**.
- [ ] `db-migration.test.js` case proves: pre-existing `inferred`/`declared`
      rows survive byte-identical, `'trunk_drift'` inserts succeed, `'bogus'`
      still fails the CHECK, `idx_detour_dispositions_src` survives as UNIQUE —
      proven red by no-op'ing the rebuild.
- [ ] `REBUILD_CASES` registry meta-test in place, with the WATCH-6 grandfather
      list seeded exactly as specified, proven red by de-registering
      `detour_dispositions`.
- [ ] `SOURCES` is exported from `detours.js` and meta-tested against the SQL
      CHECK; `"trunk_drift"` appears as a bare literal in **at most** those two
      places.
- [ ] Exactly **one** label-producing function per source, all three living in
      `detours.js`, all three returning through the shared `capLabel` —
      no trunk-drift label composer inside `trunk-drift.js`.
- [ ] Every composer's output ≤ `MAX_DETOUR_LABEL_CHARS`, newline-free,
      control-char-free.
- [ ] `buildDispositionPrompt` emits the JSON reply instruction **above** the
      lists; a full 10×400-char batch still contains it; the whole-prompt
      backstop logs when it bites; `parseDispositionOutput` logs on both the
      `catch` and the zero-verdicts-for-a-non-empty-batch path.
- [ ] Idempotency proven: detector→backfill twice over unchanged trunk state
      leaves row count unchanged and does not disturb `disposition` /
      `decided_by` / write-audit columns.
- [ ] `detour_dispositions.cwd` equals `plans.cwd`, proven by a test where the
      git root differs.
- [ ] A `trunk_drift` pending row flows through the **unmodified**
      `listPendingDetours` → `evaluateRules` → `buildDispositionPrompt` →
      `decision_queue` path; `reconciliation.test.js` and
      `reconciliation-full-tick.test.js` pass with **zero changes to their
      existing `inferred`/`declared` assertions**.
- [ ] **Zero client changes** in this phase — the existing pending-detour badge
      renders `trunk_drift`-derived queue entries as-is.
- [ ] Manual pass §6.5 completed, including the declared-focus-flow negative
      check and the double-boot against a copy of the real DB, with scratch
      artifacts cleaned up.
- [ ] No classification/disposition logic, no `plan-writeback.js` change, no
      layer-7 UI (WATCH-7).
- [ ] `decisions.md` rows DEC-1…DEC-5 and WATCH-1…WATCH-8 still accurate;
      anything the build discovered that changed them is amended there, not
      only in a commit message.
