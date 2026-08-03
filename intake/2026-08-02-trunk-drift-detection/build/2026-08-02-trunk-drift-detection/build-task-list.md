# Build Task List — trunk-drift-detection Phase 1a

**Prepared by:** Build Planner  
**Date:** 2026-08-02  
**Scope:** Phase 1a only (Steps 1–7, per build-brief gate on WATCH-5)  
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor`

---

## Summary

**25 tasks**, sequenced **red-first where red is achievable**, dependency-ordered:
- **Red-first proof tasks:** decisions.md amendment (non-test gate), git-refs extraction proof, detector and route fixtures before implementation, logging assertions before carve-out code, client assertions before card build, snapshot diff review before regeneration.
- **MANDATORY durable-cure tasks:** §9.7 `assertSingleHome` helper (G2) deriving scope from `Object.keys(require("../lib/git-refs"))`, DEC-5's three-part git-native predicate proven red by mutation (RP-1, RP-2) including worktree-flow case (G4), per-repo failure isolation in route fan-out (G5), `skipped` never renders as "clean" client guard with `not.toBe` assertion (case 3), decisions.md scope amendment recording exits 4 and 5 (G3).
- **Single path, not a menu.** No parallelization — 25 sequential steps, each independently checkable, each explicitly done-checked.
- **Blocking:** None within Phase 1a. Phase 1b is gated on DEC-7 (WATCH-5, out of scope).

---

## Task sequencing by layer

### Non-test gate (Task 1 — prerequisite for tasks 11, 12)

**Task 1 — Amendment to `decisions.md` to authorize DEC-4 scope widening** [MANDATORY]

**Files:** `decisions.md` (existing DEC-4 row at line 181–237)

**What changes:** Append an amendment note to DEC-4's "Decision" section (after line 234) recording:
- Widened scope: both `parseDispositionOutput` (terminal catch + zero-verdict path) **and** `classifyFlaggedDetours` (exits 4 and 5: `!available` and `stdout == null`)
- Both changes are logging-only, zero behaviour change to verdict production
- WATCH-5 trial note: the instrument now distinguishes CLI-unavailable vs. CLI-answered-nothing

**Layer/component:** Governance (decision log)

**Type:** Non-test, prerequisite amendment

**Done-check:**
```bash
grep -A 2 "DEC-4 scope widening" \
  /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-trunk-drift-detection/decisions.md
# Must output: an amendment note naming exits 4 and 5
```

Rationale: Test-plan step 1 and build-brief §"Durable-cure obligations" both require this amendment before any code writes to `reconciliation.js` outside its currently-authorized carve-out.

---

### Git-derivation layer (Tasks 2–6)

**Task 2 — Extract `server/lib/git-refs.js` and rewire `update-check.js`**

**Files touched:**
- `server/lib/git-refs.js` (new)
- `server/lib/update-check.js` (modified: delete `REMOTE_PRIORITY`, `listRemotes`, `pickCanonicalRemote`; import from `./git-refs`; keep private `execGit` and `resolveCompareRefForRemote` byte-for-byte)

**What changes:**
- Create `server/lib/git-refs.js` with:
  - `execGit(repoPath, args, opts = {})` — timeout 10_000 ms default, maxBuffer 2 MB, trimmed stdout
  - `listRemotes(repoPath)` — verbatim from `update-check.js`
  - `pickCanonicalRemote(repoPath)` — verbatim, uses `REMOTE_PRIORITY = ["upstream", "origin"]`
  - `resolveDefaultBranch(repoPath, opts = {})` — new; order: remote HEAD → remote ref → local ref → sole local branch → null; never guesses
  - `module.exports = { execGit, listRemotes, pickCanonicalRemote, resolveDefaultBranch, REMOTE_PRIORITY }`
  - Add file header comment with `@author Son Nguyen <hoangson091104@gmail.com>`
- Delete from `update-check.js`: its `REMOTE_PRIORITY`, `listRemotes`, `pickCanonicalRemote`, and the module-level `execGit` definition that produces them
- Import in `update-check.js`: `const { listRemotes, pickCanonicalRemote, REMOTE_PRIORITY } = require("./git-refs");`
- **LEAVE IN `update-check.js` UNCHANGED:** its own private `execGit` (120 s fetch timeout default) and its `resolveCompareRefForRemote` function

**Layer/component:** Git-derivation, shared service

**Type:** Behavior-preserving refactor (prerequisite for detector)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
git diff --stat server/__tests__/update-check.test.js
# Must be empty (zero edits to that spec file)
node --test server/__tests__/update-check.test.js
# Must be green
```

Rationale: Extraction must be lossless before trunk-drift.js imports from it. Update-check.test.js green with zero edits is the proof.

---

**Task 3 — Create `server/__tests__/git-refs.test.js` — single-home structural guard (red)**

**Files touched:**
- `server/__tests__/git-refs.test.js` (new)
- `server/__tests__/helpers/single-home.js` (new, test helper)

**What changes:**
- Create `server/__tests__/helpers/single-home.js`:
  - Export `assertSingleHome(sharedModulePath, consumers)` function
  - `consumers` shape: `{ [consumerRelPath]: { shared?: string[], private?: string[], absent?: string[] } }`
  - Validates: (1) `Object.keys(require(sharedModulePath))` equals `shared ∪ private ∪ absent` exactly (scope derived, never hand-typed); (2) each `shared` name matches the consumer's destructure regex; (3) each `private` name has a local declaration and does NOT match the destructure; (4) each `absent` name matches neither
  - Failures name the export with no disposition

- Create `server/__tests__/git-refs.test.js` with two sections:
  - **§1 Single-home structural guard (G1 + G2):**
    - Call `assertSingleHome("../lib/git-refs", { "../lib/update-check": { shared: ["listRemotes", "pickCanonicalRemote", "REMOTE_PRIORITY"], private: ["execGit"], absent: ["resolveDefaultBranch"] }, "../lib/trunk-drift": { shared: ["execGit", "resolveDefaultBranch"], absent: ["listRemotes", "pickCanonicalRemote", "REMOTE_PRIORITY"] } })`
    - Assert `update-check.js` does NOT import `execGit` from git-refs (its private copy stays local)
    - Assert `update-check.js:139`'s git fetch call site carries explicit `timeout: 120_000` (never assert on the default)
    - Assert no Phase-1a caller enables `allowFetch: true`
  - **§2 `resolveDefaultBranch` direct cases (6 cases, real fixtures):** remote_head with nonstandard name; remote_ref fallback; candidates override; sole_local_branch; never throws; ambiguous local+remote returns null
  - **§3 Behavior preservation:** recorded command `node --test server/__tests__/update-check.test.js` green unmodified

**Layer/component:** Git-derivation, test helper and unit

**Type:** Test (red-first for structural guard)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
node --test server/__tests__/git-refs.test.js 2>&1 | grep -E "^(✔|✖|error|Cannot find module)" | head -5
# Red: "Cannot find module '../lib/git-refs'" (Task 2 not done yet)
```

Rationale: Tests written red-first, before implementation. Fixtures are simplest single-home examples that prove scope derivation works.

---

**Task 4 — Create `server/__tests__/trunk-drift.test.js` fixture harness with all 17 cases (red)**

**Files touched:**
- `server/__tests__/trunk-drift.test.js` (new)

**What changes:**
- Create fixture helpers: `makeBareRemote`, `makeWorkingRepo`, `setRemoteHead`, `commitOn`, `mergeNoFF`, `fastForwardMerge`, `makeWorktreeBranch` (with self-check: assert `git worktree list --porcelain` shows 2), `makeCorruptRepo` (with self-checks: assert `git log` throws AND `isGitRepo()` returns true)
- Create all 17 test cases from test-plan §6.1 and additions:
  - 1a/1b/1c: trunk named `main`/`master`/nonstandard with remote HEAD
  - 2/2b/2c: no remote, sole local branch, local ref candidates, ambiguous branches
  - 3: clean trunk (no-ff merged feature, still exists) → `commits.length === 0` [RED-PROOF RP-1 will delete `--first-parent`/`--no-merges`]
  - 3b: fast-forward-merged, branch still exists → `commits.length === 0` [RED-PROOF RP-2 will delete `--not --exclude --branches`]
  - 3c: **worktree flow (G4)** — worktree branch ff-merged into trunk, worktree still live → `commits.length === 0` [RP-2 covers this]
  - 3d: `--no-ff` merge then branch deleted → `commits.length === 0`
  - 4: dirty-but-uncommitted trunk → `commits.length === 0`
  - 5: 30 commits over 60 days, lookback 7 days → only windowed commits returned
  - 5b: 300 commits in window, `maxCommits: 200` → `commits.length === 200`, `truncated: true`
  - 6: 3 genuine direct-to-trunk commits → all 3 returned, correct `range`, subjects/diffstat present
  - 6b: same with 2 of 3 in `seenShas` → only unseen returned (idempotency)
  - 7: commits with out-of-order `GIT_COMMITTER_DATE` → returned in **git DAG order, not date order** (§9.2 assertion)
  - 8a-8d + 8e: not a repo / empty repo / detached HEAD / bare repo / corrupt repo → each returns appropriate `{ skipped: "…" }`, no throw
- Structural checks: no classification vocabulary (fold_in/new_item/deliberate/discard), no SQLite requires
- Add file header

**Layer/component:** Git-derivation, test fixtures

**Type:** Test (red-first, fixture definition)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
node --test server/__tests__/trunk-drift.test.js 2>&1 | grep "Cannot find module"
# Red: "Cannot find module '../lib/trunk-drift'"
# (Implementation not done yet; fixture harness written first)
```

Rationale: Fixtures and cases written before implementation, so implementation can immediately pass them. This is red-first discipline — the test harness defines the contract.

---

**Task 5 — Implement `server/lib/trunk-drift.js` detector** [MANDATORY per DEC-5]

**Files touched:**
- `server/lib/trunk-drift.js` (new)

**What changes:**
- Create detector with guard order: `isGitRepo(repoPath)` → `resolveDefaultBranch(repoPath)` → `git rev-parse --verify --quiet refs/heads/<branch>` for headSha
- One git log call carrying all predicates:
  ```
  git log --first-parent --no-merges
          --since=<sinceIso> --max-count=<maxCommits + 1>
          --date=iso-strict --shortstat
          --format=%x1e%H%x1f%an%x1f%ae%x1f%cI%x1f%s
          refs/heads/<branch>
          --not --exclude=refs/heads/<branch> --branches
  ```
  (DEC-5 clauses 1/2/3: first-parent, no-merges, not-reachable-from-other-branches)
- Parse records on `\x1e`, fields on `\x1f`; extract `filesChanged`/`insertions`/`deletions` from `--shortstat` line
- Truncate subject to `MAX_SUBJECT_CHARS` (160)
- Filter commits by `opts.seenShas` (idempotency, no DB call)
- Slice if `commitCount > maxCommits`, set `truncated: true`
- Return shape:
  ```js
  {
    skipped: null,
    repoPath, defaultBranch, defaultBranchVia,
    headSha, lookbackDays, since,
    commits: [{ sha, shortSha, authorName, authorEmail, committedAt, subject, filesChanged, insertions, deletions }],
    commitCount, truncated,
    range: { firstSha, lastSha } | null
  }
  // or on error/skip:
  { skipped: "not_a_repo" | "no_default_branch" | "no_commits" | "git_error", repoPath }
  ```
- Exports: `detectTrunkDrift`, `trunkDriftLookbackDaysFromEnv`, `MAX_TRUNK_DRIFT_COMMITS`, `DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS`
- Every git failure → `{ skipped: "git_error" }`, never throw
- Add file header

**Layer/component:** Git-derivation, detection

**Type:** Implementation

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
node --test server/__tests__/trunk-drift.test.js 2>&1 | grep "✔\|✖" | head -20
# Must pass all 17 cases (✔ next to each case)
```

Rationale: Detector is the core feature. All 17 test cases in Task 4 must pass, proving DEC-5's predicate is correctly implemented.

---

**Task 6 — Red-proof RP-1 and RP-2: DEC-5's three-part predicate** [MANDATORY]

**What changes:** None to code; this is a mutation-testing verification step.

**Type:** Verification (red-proof, recorded in commit message)

**Procedure:**
1. **RP-1:** Edit `server/lib/trunk-drift.js` line ~370 (the git log argv): **delete** `--first-parent` and `--no-merges` from the command string
   - Run `node --test server/__tests__/trunk-drift.test.js --test-name-pattern="case.*3"`
   - **Must fail:** case 3 (clean trunk, feature branch merged with `--no-ff`) produces `commits.length > 0` instead of 0
   - Restore the deleted flags to full source text (byte-identical)
   - Verify case 3 passes again
2. **RP-2:** Edit `server/lib/trunk-drift.js`: **delete only** the `--not --exclude=refs/heads/<branch> --branches` tail, leaving `--first-parent --no-merges` intact
   - Run `node --test server/__tests__/trunk-drift.test.js --test-name-pattern="case.*(3b|3c)"`
   - **Must fail:** both case 3b (fast-forward-merged, branch exists) and case 3c (worktree ff-merged, worktree exists) produce `commits.length > 0` instead of 0
   - Restore to byte-identical source
   - Verify both cases pass again

**Done-check:**
```bash
# After restoration:
node --test server/__tests__/trunk-drift.test.js --test-name-pattern="case.*(3|3b|3c)" 2>&1 | grep "✔"
# All three must show ✔
```

**Record in commit message:** Both RP-1 and RP-2 observations, exact failure names, proving the three clauses are load-bearing.

Rationale: DEC-5's predicate guards against false positives. This is the single most load-bearing pair in Phase 1a per test-plan. Must be proven red, never passable by removing the guard.

---

### API layer (Tasks 7–8)

**Task 7 — Create `server/__tests__/projects.test.js` test cases R1–R6 (red)** [MANDATORY per G5]

**Files touched:**
- `server/__tests__/projects.test.js` (modified: append new `describe("GET /:id/trunk-drift")` block)

**What changes:**
- Append new `describe` block after `describe("GET /:id/repos")` (line ~867)
- Write six test cases (R1–R6) using existing `FS_FIXTURE_ROOT`, `ISOLATED_GIT_ENV`, `makeFixtureRepo`:
  - **R1:** 404 unknown project → status 404, error code "NOT_FOUND"
  - **R2:** project with no mapped folders → 200, `body.repos === []`
  - **R3:** mapped non-repo folder filtered out → 200, `body.repos.length === 1`, no "nonRepoFolders" key
  - **R4:** populated `drift` for fixture repo with direct-to-trunk commit → route calls real `detectTrunkDrift`, commit sha/subject read back via `git log` in test
  - **R5 (G5):** **three-repo mixed state with injected failure** [MANDATORY] → healthy repo with direct commit, empty repo (no commits), corrupted repo (object store deleted); assert healthy repo's `drift` fully populated and NOT degraded while corrupt repo's `drift.skipped === "git_error"`; `body.repos.length === 3`
  - **R6:** `GET /:id/repos` response shape unchanged → must be green **before and after** new route lands (behavior preservation)
- Use `makeCorruptRepo` fixture from trunk-drift.test.js

**Layer/component:** API, route contract

**Type:** Test (red-first)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
node --test --test-name-pattern="GET /:id/trunk-drift" server/__tests__/projects.test.js 2>&1 | head -20
# Red: route does not exist yet ("Cannot GET /api/projects/.../trunk-drift")
# R6 must be green before and after
```

Rationale: Test the contract before the route exists. R5's per-repo failure isolation is the gap the test-plan flags. R6 guards against sibling route shape widening.

---

**Task 8 — Implement `GET /api/projects/:id/trunk-drift` route**

**Files touched:**
- `server/routes/projects.js` (modified: add new route handler)

**What changes:**
- Add new route handler at line ~381 (beside `GET /:id/repos`):
  ```js
  router.get("/:id/trunk-drift", async (req, res) => {
    try {
      const project = projects.get(req.params.id);
      if (!project) return res.status(404).json({ error: { code: "NOT_FOUND" } });
      
      const repos = [];
      for (const path of stmts.listProjectPaths.all(project.id)) {
        try {
          if (!isGitRepo(path.cwd)) continue;
          const drift = await detectTrunkDrift(path.cwd);
          repos.push({ cwd: path.cwd, pathId: path.id, drift });
        } catch (e) {
          // Per-repo failure isolation (G5) — never throw, log and continue
          repos.push({ cwd: path.cwd, pathId: path.id, drift: { skipped: "git_error", repoPath: path.cwd } });
        }
      }
      res.json({ repos });
    } catch (e) {
      res.status(500).json({ error: { code: "INTERNAL" } });
    }
  });
  ```
- Import at top: `const { detectTrunkDrift } = require("../lib/trunk-drift");`
- Do NOT widen `/:id/repos` response shape

**Layer/component:** API, route

**Type:** Implementation

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
node --test --test-name-pattern="GET /:id/trunk-drift" server/__tests__/projects.test.js 2>&1 | grep "✔\|✖"
# All six cases (R1–R6) must show ✔
# Verify: node --test --test-name-pattern="GET /:id/repos" server/__tests__/projects.test.js 2>&1 | grep "✔"
# Existing /:id/repos tests must still pass (R6 proof)
```

Rationale: Route implementation. Task 7's R5 proves per-repo failure isolation works; R6 proves sibling route unchanged.

---

### Client layer (Tasks 9–14)

**Task 9 — Create test cases 1–4 and i18n block in client tests (red)** [MANDATORY per client guard]

**Files touched:**
- `client/src/pages/__tests__/ProjectDetail.test.tsx` (modified: add 4 test cases and mock)
- `client/src/i18n/__tests__/i18n.test.ts` (modified: add registry-derived block)

**What changes:**

*ProjectDetail.test.tsx:*
- Add to existing `vi.mock("../../lib/api")` factory under `api.projects`: `trunkDriftMock = vi.fn(() => Promise.resolve({ repos: [] }))`
- Add to `beforeEach`: set `trunkDriftMock` default return to `{ repos: [] }` so all 15 existing tests pass unmodified
- Write four new test cases:
  - **Case 1 (contract):** `trunkDriftMock` returns populated card; assert title, "Direct-to-trunk work" visible; commit sha `abc1234` visible; subject, author, date, diffstat present; **no** classification/action surface (grep fails on fold_in/deliberate/discard/dismiss buttons)
  - **Case 2:** `skipped: "no_default_branch"` renders explicit unknown state; "clean" (case-insensitive) does NOT appear in card region
  - **Case 3 (G8 — load-bearing guard):** two-repo render with one `{ skipped: null, commits: [], commitCount: 0 }` (empty clean state) and one `{ skipped: "no_default_branch" }` (unknown); assert `expect(unknownText).not.toBe(cleanText)` — different rendering for different states [RED-PROOF: both rendering identically fails this]
  - **Case 4:** mock rejects with `Error("network")` → page still renders project name and existing Repos card (independent degradation)
- Add `data-testid="trunk-drift-card"` to the card component (see Task 11)

*i18n.test.ts:*
- Add new registry-derived block over `LOCALES = ["en", "ko", "vi", "zh"]` × card keys (`title`, `description`, `defaultBranch`, `lookbackWindow`, `commitCount`, `empty`, `unknown`)
- Assert each key in each locale resolves to a non-empty, non-key-echoing string
- Assert `t("projectDetail:trunkDrift.empty") !== t("projectDetail:trunkDrift.unknown")` in `en` (client echo of never-guess-clean)

**Layer/component:** Frontend, component contract

**Type:** Test (red-first)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx 2>&1 | grep "FAIL\|PASS"
# Red: case 1 fails at first assertion (no trunkDrift api method yet)
# Red: i18n test fails on missing locale keys (only en filled, ko/vi/zh still raw keys)
```

Rationale: Assertions written before implementation. Case 3's `not.toBe` is the load-bearing guard that proves two states render distinctly.

---

**Task 10 — Implement `client/src/lib/types.ts` — add trunk-drift types**

**Files touched:**
- `client/src/lib/types.ts` (modified)

**What changes:**
- Add new types beside `ProjectRepoTopology`:
  ```ts
  export interface TrunkDriftCommit {
    sha: string;
    shortSha: string;
    authorName: string;
    authorEmail: string;
    committedAt: string;
    subject: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
  }

  export interface TrunkDriftResult {
    skipped: null | "not_a_repo" | "no_default_branch" | "no_commits" | "git_error";
    repoPath?: string;
    defaultBranch?: string;
    defaultBranchVia?: string;
    headSha?: string;
    lookbackDays?: number;
    since?: string;
    commits?: TrunkDriftCommit[];
    commitCount?: number;
    truncated?: boolean;
    range?: { firstSha: string; lastSha: string } | null;
  }

  export interface ProjectTrunkDriftResponse {
    repos: Array<{
      cwd: string;
      pathId: string;
      drift: TrunkDriftResult;
    }>;
  }
  ```

**Layer/component:** Frontend, types

**Type:** Implementation (prerequisite for api.ts)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
cd client && npx tsc --noEmit 2>&1 | grep -c "error"
# Must be 0 (types compile)
```

Rationale: Type definitions before the API method uses them.

---

**Task 11 — Implement `client/src/lib/api.ts` — add `projects.trunkDrift` method**

**Files touched:**
- `client/src/lib/api.ts` (modified)

**What changes:**
- Add to `projects` object (beside `repos`, line ~2420):
  ```ts
  /**
   * Fetch trunk-drift detection results for a project's mapped repos.
   * Read-only; updated on-demand per page load.
   */
  trunkDrift: (id: string) => request<ProjectTrunkDriftResponse>(`/projects/${encodeURIComponent(id)}/trunk-drift`),
  ```
- Import types: `TrunkDriftCommit, TrunkDriftResult, ProjectTrunkDriftResponse` (from types.ts)

**Layer/component:** Frontend, API client

**Type:** Implementation

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
cd client && npx tsc --noEmit 2>&1 | grep "trunkDrift" | wc -l
# Must be 0 (no errors on new method)
```

Rationale: API method signature before component calls it.

---

**Task 12 — Implement `client/src/pages/ProjectDetail.tsx` — add trunk-drift card** [MANDATORY per G8]

**Files touched:**
- `client/src/pages/ProjectDetail.tsx` (modified)

**What changes:**
- After the existing Repos card section, add new read-only "Direct-to-trunk work" card for each mapped repo:
  - Card header: repo `cwd`, default branch name, lookback window ("past 7 days"), commit count
  - Commit list: short SHA, subject, author name, relative date, `+insertions/-deletions in N files`
  - `skipped` reasons render as explicit "unknown" state (e.g., "Unknown trunk branch")
  - Never render `skipped` as "clean" — the two states must be visually distinct
  - Add `data-testid="trunk-drift-card"` to card root
  - **No badge, no verdict button, no classification vocabulary** (grep-checkable per DoD)
- Call `api.projects.trunkDrift(projectId)` on mount
- Handle network error: page renders project name and existing cards, trunk-drift card absent

**Layer/component:** Frontend, page component

**Type:** Implementation

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx 2>&1 | grep -E "✔|✖" | grep -E "case.*[1-4]|trunkDrift"
# Cases 1–4 must all show ✔
# i18n block must show ✔ for all LOCALES × KEYS
```

Rationale: Component implementation. Task 9's cases 1–4 must all pass, proving card renders correctly and states are distinct.

---

**Task 13 — Fill `client/src/i18n/locales/en/projectDetail.json` — trunk-drift keys**

**Files touched:**
- `client/src/i18n/locales/en/projectDetail.json` (modified)

**What changes:**
- Add new object under `projectDetail.trunkDrift` with keys:
  ```json
  {
    "title": "Direct-to-trunk work",
    "description": "Commits made directly on the default branch",
    "defaultBranch": "Default branch",
    "lookbackWindow": "past 7 days",
    "commitCount": "commits",
    "empty": "No direct-to-trunk commits found",
    "unknown": "Unable to determine trunk branch"
  }
  ```

**Layer/component:** Frontend, i18n English

**Type:** Implementation (English baseline)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
jq '.projectDetail.trunkDrift' client/src/i18n/locales/en/projectDetail.json
# Must output the object above with 7 keys
```

Rationale: English baseline before translated locales. Test already expects these exact keys.

---

**Task 14 — Fill `client/src/i18n/locales/{ko,vi,zh}/projectDetail.json` — trunk-drift keys**

**Files touched:**
- `client/src/i18n/locales/ko/projectDetail.json` (modified)
- `client/src/i18n/locales/vi/projectDetail.json` (modified)
- `client/src/i18n/locales/zh/projectDetail.json` (modified)

**What changes:**
- Add translated `projectDetail.trunkDrift` object to each locale with the same 7 keys: `title`, `description`, `defaultBranch`, `lookbackWindow`, `commitCount`, `empty`, `unknown`
- **All four locale files updated in the same commit** (per `.claude/rules/docs-markdown.md`)

**Layer/component:** Frontend, i18n (Korean, Vietnamese, Mandarin)

**Type:** Implementation (translated locales)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
for loc in ko vi zh; do
  keys=$(jq '.projectDetail.trunkDrift | keys | length' client/src/i18n/locales/$loc/projectDetail.json)
  echo "$loc: $keys keys"
done
# Must output: ko: 7 keys, vi: 7 keys, zh: 7 keys
# Then run:
cd client && npx vitest run src/i18n/__tests__/i18n.test.ts 2>&1 | grep "✔\|✖"
# Must show ✔ for all LOCALES × KEYS
```

Rationale: Translations complete the i18n coverage. Test-plan requires all four locales in same change.

---

**Task 15 — Review snapshot diff and regenerate `client/src/pages/__tests__/screens.snapshot.test.tsx`**

**Files touched:**
- `client/src/pages/__tests__/screens.snapshot.test.tsx` (modified: snapshot baseline regenerated, source unchanged)

**What changes:**
- Run `cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx` and **view the diff** (do not blind-update)
- Confirm diff includes only the new "Direct-to-trunk work" card in Project Detail render
- Run `cd client && npx vitest run -u` to regenerate baseline

**Layer/component:** Frontend, snapshot

**Type:** Verification (visual diff review before regeneration)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx 2>&1 | grep -E "snapshot.*pass|snapshot.*fail"
# After regeneration: must show "snapshot pass"
```

Rationale: CLAUDE.md prohibits blind snapshot updates. Diff must be eyeballed for intentional-only changes.

---

### Reconciliation layer (Tasks 16–18)

**Task 16 — Create `server/__tests__/reconciliation.test.js` test cases Block A + B (red)** [MANDATORY per G3, G6]

**Files touched:**
- `server/__tests__/reconciliation.test.js` (modified: append two new `describe` blocks)

**What changes:**
- Append Block A after existing `describe("classifyFlaggedDetours")` (line 470):
  - **Block A — `parseDispositionOutput` logging (G6):**
    - Case A1: terminal catch (unparseable JSON) → spy logs exactly once with error message, `result.size === 0` unchanged
    - Case A2: successful parse but zero verdicts for non-empty batch → spy logs exactly once with "zero verdicts" message, `result.size === 0` unchanged
    - Case A3: happy path → spy logs **zero** times, returns normal `size 1` result with `disposition: "discard"`
  - **Block B — DEC-4 widened scope, exits 4 + 5 (G3):**
    - **B1 — exit 4, CLI unavailable:** stub spawn to exit 1 on all calls → `result.size === 0` (unchanged), log count === 1, log text matches `/claude cli|unavailable|not available/i`
    - **B2 — exit 5, CLI answered nothing (the dominant mode):** stub dispatch: `--version` → exit 0 (probe available); other calls → exit 1 with no stdout → `runClaudePromptJson` resolves null → `result.size === 0` (unchanged), log count === 1, log text matches `/no output|returned nothing|null/i`, and `assert.notEqual(logTextB1, logTextB2)` — the two failures must be distinguishable in log [RED-PROOF: both producing identical log fails this assertion]
    - **B3 — exits 1–3 stay silent:** empty flagged array → `result.size === 0`, log count === 0 (no noise on healthy quiet tick)
- Use `reconciliation.__injectSpawnForTest` seam; restore with `null` in `finally`
- Use combined `console.error` + `console.warn` spy (exact method TBD when code is written)

**Layer/component:** Reconciliation, logging

**Type:** Test (red-first)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
node --test --test-name-pattern="parseDispositionOutput|classifyFlaggedDetours" \
  server/__tests__/reconciliation.test.js 2>&1 | grep "✔\|✖" | grep -E "Block [AB]|A[1-3]|B[1-3]"
# Red: all assertions fail on log.length comparison (no log calls yet in source)
```

Rationale: Tests written red-first, before logging code is added. Assertions define expected behavior.

---

**Task 17 — Add logging to `server/lib/reconciliation.js` (`parseDispositionOutput` + `classifyFlaggedDetours`)**

**Files touched:**
- `server/lib/reconciliation.js` (modified: two functions, logging-only, zero control-flow change)

**What changes:**

*`parseDispositionOutput` (line ~228):*
- Terminal `catch` block (line ~237): add `log("[reconciliation] disposition output unparseable — 0 verdicts this tick", err?.message)`
- After successful parse (line ~240), add: `if (out.size === 0 && flagged.length > 0) log("[reconciliation] parsed 0 verdicts for non-empty flagged batch, length:", flagged.length)`

*`classifyFlaggedDetours` (line ~248–263):*
- At exit 4 (`if (!available)`, line 255): add `log("[reconciliation] Claude CLI not available — cannot classify")`
- At exit 5 (`if (stdout == null)`, line 261): add `log("[reconciliation] Claude CLI returned no output — cannot classify")`

**Layer/component:** Reconciliation, logging

**Type:** Implementation (logging-only, behavior-neutral)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
node --test --test-name-pattern="parseDispositionOutput|classifyFlaggedDetours" \
  server/__tests__/reconciliation.test.js 2>&1 | grep "✔" | wc -l
# Must show ✔ for all of Block A + B (all six cases green)
# Verify pre-existing tests:
node --test server/__tests__/reconciliation.test.js server/__tests__/reconciliation-full-tick.test.js 2>&1 | tail -3
# Must pass all pre-existing describe/it blocks unmodified
```

Rationale: Logging added per Task 16's test contract. DEC-4's log-only carve-out, narrowly scoped to the four lines Task 16 specifies.

---

### Single-home structural guard — MANDATORY durable cure (Task 18)

**Task 18 — Write and verify `assertSingleHome` red-proof (RP-6)** [MANDATORY per §9.7]

**What changes:** Mutation verification step (no code change).

**Type:** Verification (red-proof RP-6, recorded in commit message)

**Procedure:**
1. Edit `server/lib/git-refs.js`: add a 5th export, e.g., `stubExport: () => null` (or any dummy export)
2. Run `node --test server/__tests__/git-refs.test.js --test-name-pattern="every git-refs.js export"`
3. **Must fail:** `assertSingleHome` fails with message naming the new export (`"git-refs.js exports 'stubExport' but ../lib/trunk-drift gives it no disposition"`)
4. **Restore** the 5th export, delete from source (byte-identical)
5. Re-run; must pass

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
node --test server/__tests__/git-refs.test.js --test-name-pattern="single-home" 2>&1 | grep "✔"
# After restoration, must show ✔
```

**Record in commit message:** RP-6 mutation and observed failure.

Rationale: The scan's scope is derived from `Object.keys`, never hand-typed. RP-6 proves it catches any missing disposition. This is §9.7's load-bearing requirement — the scan must fail loudly on any overlooked export.

---

### Docs and final checks (Tasks 19–25)

**Task 19 — Update `docs/API.md` with new route**

**Files touched:**
- `docs/API.md` (modified)

**What changes:**
- Add new section documenting `GET /api/projects/:id/trunk-drift`:
  ```markdown
  ### GET /api/projects/:id/trunk-drift
  Fetch trunk-drift detection results for a project's mapped repos.
  Response: `{ repos: [{ cwd, pathId, drift: TrunkDriftResult }] }`
  Read-only; updated on-demand per page load.
  ```

**Layer/component:** Documentation

**Type:** Documentation

**Done-check:**
```bash
grep -A 3 "GET /api/projects/:id/trunk-drift" \
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor/docs/API.md
# Must output the route section
```

Rationale: API route is new; docs updated per CLAUDE.md.

---

**Task 20 — Update `ARCHITECTURE.md` with git-derivation module and posture**

**Files touched:**
- `ARCHITECTURE.md` (modified)

**What changes:**
- Add section on `server/lib/trunk-drift.js` and its recompute-per-request, never-cached posture (matching `repo-topology.js`)
- Clarify the shared `git-refs.js` extraction and its exports
- Note Phase 1a scope: read-only card, no schema change, no `detour_dispositions` write

**Layer/component:** Documentation, architecture

**Type:** Documentation

**Done-check:**
```bash
grep -A 5 "trunk-drift" \
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor/ARCHITECTURE.md
# Must output architecture description
```

Rationale: Architecture docs updated per CLAUDE.md.

---

**Task 21 — Update `server/README.md` with env knob**

**Files touched:**
- `server/README.md` (modified)

**What changes:**
- Add documentation for new env variable `DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS` (default 7)

**Layer/component:** Documentation, server config

**Type:** Documentation

**Done-check:**
```bash
grep "DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS" \
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor/server/README.md
# Must output the knob documentation
```

Rationale: New env knob documented per CLAUDE.md.

---

**Task 22 — Update `docs/DATABASE.md` with Phase 1b schema deferral note**

**Files touched:**
- `docs/DATABASE.md` (modified)

**What changes:**
- Add note clarifying Phase 1a is read-only (no schema change, no `detour_dispositions` writes) and that the `source` CHECK widening is Phase 1b, deferred pending WATCH-5 gate

**Layer/component:** Documentation, database

**Type:** Documentation

**Done-check:**
```bash
grep -A 2 "Phase 1b\|trunk-drift.*Phase 1a\|source.*deferred" \
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor/docs/DATABASE.md
# Must output the deferral note
```

Rationale: Database schema docs clarify scope boundary per CLAUDE.md.

---

**Task 23 — Verify file headers on all new files**

**Files touched:**
- `server/lib/git-refs.js` (verify)
- `server/lib/trunk-drift.js` (verify)
- `server/__tests__/helpers/single-home.js` (verify)
- `server/__tests__/git-refs.test.js` (verify)
- `server/__tests__/trunk-drift.test.js` (verify)

**What changes:** None; this is a verification step.

**Type:** Verification (header audit)

**Procedure:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
bash .claude/skills/file-headers/scripts/check-headers.sh
# Must exit 0 (all new .js/.ts/.tsx files have the required header)
```

**Done-check:**
```bash
bash .claude/skills/file-headers/scripts/check-headers.sh && echo "Headers OK" || echo "Headers FAILED"
# Must output "Headers OK"
```

Rationale: Every new source file must have the file-header comment with `@author Son Nguyen <hoangson091104@gmail.com>` per `.claude/rules/file-headers.md`.

---

**Task 24 — Full server test suite**

**Files touched:** None; verification only.

**What changes:** None.

**Type:** Verification (full suite green)

**Procedure:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
npm run test:server
```

**Done-check:**
```bash
npm run test:server 2>&1 | tail -5
# Must show: "pass" and "0 fail"
# Baseline: ≥1370 passing (same or more than before)
```

Rationale: All server tests must pass, including pre-existing tests (behavior preservation) and new tests (coverage).

---

**Task 25 — Full client test suite**

**Files touched:** None; verification only.

**What changes:** None.

**Type:** Verification (full suite green)

**Procedure:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
npm run test:client
```

**Done-check:**
```bash
npm run test:client 2>&1 | tail -5
# Must show: "pass" and "0 fail"
# Baseline: ≥718 passing (same or more than before)
```

Rationale: All client tests must pass, including pre-existing tests (behavior preservation) and new tests (coverage).

---

## Dependency notes

- **Task 1 (decisions.md) is a prerequisite** for Tasks 11 and 12 to be authorized scope. Without Task 1's amendment, reconciliation.js edits in Task 17 are outside the current carve-out.
- **Task 2 (git-refs.js extraction) is a prerequisite** for Tasks 5 (detector implementation) and 3 (git-refs.test.js).
- **Task 3 (git-refs.test.js), Task 4 (trunk-drift fixture harness), and Task 7 (projects.test.js cases)** must be written and red-verified before their implementation tasks (5, 8 respectively).
- **Task 6 (RP-1 and RP-2 red-proofs) follows Task 5** and must be recorded in the commit message before proceeding to Task 7.
- **Tasks 10–14 (client types, api, component, locales) must be sequenced strictly in order.** Task 9's tests depend on all of them existing.
- **Task 15 (snapshot regeneration)** follows Task 12 (component implementation). Snapshot diff must be eyeballed before `-u` regeneration.
- **Task 16 (reconciliation test cases)** is red-first; Task 17 (logging code) follows.
- **Task 18 (RP-6 red-proof)** follows Task 3 (single-home helper) and must be recorded in commit message.
- **Tasks 19–23 (docs and headers)** can follow Task 17 (reconciliation logging), in any order within that group.
- **Tasks 24–25 (full suites)** are final gates, run after all other tasks complete.

**No parallelization.** This build uses one sequential implementer. Each task is independently checkable; the next task is not started until the previous one's done-check passes.

---

## Sequencing summary

| Phase | Tasks | Purpose |
|---|---|---|
| Gate (Task 1) | decisions.md amendment | Authorize DEC-4 widening before reconciliation.js edits |
| Git-derivation (Tasks 2–6) | extract git-refs.js, create/pass trunk-drift tests, implement detector, prove DEC-5 predicate | Core detector infrastructure, red-first discipline |
| API (Tasks 7–8) | projects.test.js cases, implement route | Route contract and implementation, per-repo isolation proven |
| Frontend (Tasks 9–15) | client tests (red), types, api method, card component, locales, snapshot review | Read-only card and i18n, snapshot diff reviewed |
| Reconciliation (Tasks 16–18) | reconciliation tests (red), add logging, verify single-home structural guard | DEC-4 carve-out and §9.7 durable cure |
| Docs & verification (Tasks 19–25) | update docs, verify headers, run full suites | Documentation and final gates |

---

## MANDATORY durable-cure summary

| Requirement | Catalog ID | Enforced by |
|---|---|---|
| `assertSingleHome` helper, scope derived from `Object.keys(require("../lib/git-refs"))` | §9.7 HAND-SCOPED STRUCTURAL SCAN | Task 18 RP-6 red-proof; scan must fail naming any missing disposition |
| DEC-5 clauses 1+2+3 proven red by mutation (RP-1, RP-2); worktree flow included (G4) | §9.3 VACUOUS-GUARD (DEC-5 specific) | Task 6 RP-1/RP-2 recorded in commit message; cases 3/3b/3c all pass |
| Per-repo failure isolation: one repo's git error cannot suppress another's result | no catalog id (test-plan risk §7) | Task 7 case R5; mixed-state response returned 200 with healthy repo fully populated |
| `skipped` never renders as "clean," server-side or client-side | §9.1 (context) + §9.2 (ordering) | Task 9 case 3 with `not.toBe` assertion; distinct empty vs. unknown states |
| DEC-4 widening: exits 4 and 5 distinguishable in log | DEC-4 (logged widening) | Task 16 B1/B2; `assert.notEqual(logB1, logB2)` |
| decisions.md amendment recording widened scope + WATCH-5 trial note | DEC-4 scope authority | Task 1; prerequisite for Tasks 11–17 authorization |

---

## Red-proof ledger (recorded in commit messages as they are run)

| RP # | Step | Mutation | Expected failure | Task |
|---|---|---|---|---|
| RP-1 | trunk-drift.js argv | Delete `--first-parent` and `--no-merges` | Case 3 produces commits instead of [] | Task 6 |
| RP-2 | trunk-drift.js argv | Delete `--not --exclude --branches` tail | Cases 3b and 3c produce commits instead of [] | Task 6 |
| RP-3 | update-check.js destructure | Add `execGit` to `require("./git-refs")` | G1 `doesNotMatch` assertion fails | Task 5 (after impl) |
| RP-4 | update-check.js fetch call | Delete `{ timeout: 120_000 }` | G1 fetch-call-site assertion fails | Task 5 (after impl) |
| RP-5 | trunk-drift.js execution | Add `execGit(…, ["fetch", …])` with no timeout | Implicit-timeout loop fails | Task 5 (after impl) |
| RP-6 | git-refs.js exports | Add 5th export with no disposition | `assertSingleHome` fails naming it | Task 18 |
| RP-7 | reconciliation.js (pre-fix) | No log calls | Block A cases 1–2, Block B cases B1–B2 fail on `calls.length` | Task 16 (red verification) |
| RP-8 | i18n.test.ts (incomplete locales) | Only `en` filled, `ko`/`vi`/`zh` missing | Registry-derived block iterations fail on raw dotted keys | Task 9 (red verification) |
| RP-9 | makeCorruptRepo fixture | (self-check) | Assert `git log` throws AND `isGitRepo` returns true | Task 4 fixture |
| RP-10 | makeWorktreeBranch fixture | (self-check) | Assert `git worktree list --porcelain` shows 2 | Task 4 fixture |

---

## Behavior-preservation gates (must pass before and after, unedited)

- `node --test server/__tests__/update-check.test.js` — green with `git diff --stat` on that file empty (Task 2)
- `GET /:id/repos` response key set unchanged (Task 8, case R6)
- `reconciliation.test.js` and `reconciliation-full-tick.test.js` pre-existing `describe`/`it` blocks unedited and green (Task 17)

---

## Open questions / blockers for this build

**Blocking:** None.

**Non-blocking (context, no action required):**

1. **Phase 1b is out of scope per WATCH-5** — DEC-7 live trial must close first. Any Phase 1b work discovered during implementation (schema, `db-rebuild.js`, `detours.js` write adapter, periodic-tick wiring, `buildDispositionPrompt` reorder) is flagged back, not built.
2. **Two other effort worktrees active on this repo** — `2026-08-02-practice-kind-override` (different surfaces, mostly non-overlapping) and an unnamed in-flight effort visible in git status at session start. Merge strategy at cleanup time is left to Sara.
3. **Main checkout carries unrelated dirty state** — `client/src/lib/api.ts`, `client/src/lib/types.ts`, `client/src/pages/ProjectDetail.tsx`, and the four `projectDetail.json` locales are dirty in the main checkout with unrelated work. Both this effort's worktree and the main checkout will diverge on those files; merge will require a real merge, not fast-rebase.

---

## Back-out command

```bash
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor \
  reset --hard 5bed29aca2d7a587d75a0d8b427cf76a0d128e7d
```

---

## Definition of Done (Phase 1a)

Phase 1a is complete when:

- [ ] All 25 tasks above are marked complete with their done-checks passing
- [ ] `npm run test:server` green (≥1370 passing, 0 fail)
- [ ] `npm run test:client` green (≥718 passing, 0 fail)
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0
- [ ] All red-proofs (RP-1 through RP-10) recorded in commit messages as observed → restored → re-run green
- [ ] All MANDATORY durable-cure items verified (§9.7 structural scan, DEC-5 predicate, route isolation, client guard, DEC-4 logging, decisions.md amendment)
- [ ] Behavior-preservation gates all pass (update-check.test.js unedited and green, /:id/repos unchanged, reconciliation tests unedited and green)
- [ ] Docs updated (`docs/API.md`, `ARCHITECTURE.md`, `server/README.md`, `docs/DATABASE.md`)
- [ ] No new occurrence of `fold_in`, `new_item`, `deliberate`, `discard` in `server/lib/trunk-drift.js`
- [ ] No new SQLite requires in `server/lib/trunk-drift.js` or `server/__tests__/trunk-drift.test.js`
- [ ] Snapshot diff eyeballed (only new card) before regeneration

**BLOCKING:** None. Ready to build.
