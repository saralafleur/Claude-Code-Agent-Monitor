# Unit / Parity Test Design — trunk-drift-detection (Phase 1a)

> Scope: Phase 1a only, per `qa/change-brief.md`'s boundary. No test below
> touches `db-rebuild.js`, the `detour_dispositions.source` CHECK widening,
> `recordTrunkDriftDetour`/`backfillTrunkDriftDetours`, `SOURCES`, `capLabel`,
> `formatTrunkDriftLabel`, `reconcileCwd`'s periodic-invocation step, or
> `buildDispositionPrompt`'s reorder — that is Phase 1b, gated on WATCH-5, and
> none of it exists yet.

Stack (from `PROJECT-CONTEXT.md` / `technical-plan.md` §6): Node's built-in
`node:test` + `node:assert/strict` for server tests, real throwaway git repos
via `execFileSync` with an isolated git env (never mocked `child_process`),
real SQLite for anything DB-backed (not applicable here — Phase 1a writes
nothing); Vitest + React Testing Library for client tests.

## How to run

```bash
# One spec at a time (fast iteration)
node --test server/__tests__/trunk-drift.test.js
node --test server/__tests__/git-refs.test.js
node --test server/__tests__/update-check.test.js      # must stay green, ZERO edits
node --test server/__tests__/reconciliation.test.js     # must stay green except the new appended describe block
node --test server/__tests__/projects.test.js
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx
cd client && npx vitest run src/i18n/__tests__/i18n.test.ts

# Full suites (Definition of Done gate)
npm run test:server
npm run test:client
bash .claude/skills/file-headers/scripts/check-headers.sh
```

Per-screen snapshot: `client/src/pages/__tests__/screens.snapshot.test.tsx`
**will** change once the new card lands. Eyeball the diff, confirm it is only
the new "Direct-to-trunk work" card, then regenerate with
`cd client && npx vitest run -u`. Never blind-update (CLAUDE.md).

---

## 1. `server/__tests__/trunk-drift.test.js` (NEW)

Mirror `server/__tests__/repo-topology.test.js` exactly: real `git init`
fixtures under `fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "trunkdrift-")))`,
the same `GIT_ENV_OVERRIDE_KEYS` stripping
(`GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY`/
`GIT_ALTERNATE_OBJECT_DIRECTORIES`), no mocked `child_process`, **no `db`
module required at all** — `detectTrunkDrift` takes `seenShas` as a plain
`Set` argument, never reads SQLite.

```js
const { detectTrunkDrift, trunkDriftLookbackDaysFromEnv,
        MAX_TRUNK_DRIFT_COMMITS, DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS } =
  require("../lib/trunk-drift");
```

Fixture helpers to add (parallel to `repo-topology.test.js`'s `makeRepo`):
- `makeBareRemote(parent, name)` — bare repo, `-c init.defaultBranch=<name>`
  where the caller controls the branch name (needed for case 1a/1b/1c to use
  `main`/`master`/`trunk` respectively).
- `makeWorkingRepo(parent, dir, originUrl, branch)` — init, one commit, `remote
  add origin`, `push -u origin <branch>`.
- `setRemoteHead(repo, remote, branch)` — runs `git remote set-head <remote>
  <branch>` (this works against a local file-path bare remote via `ls-remote
  --symref`, no network needed) so `refs/remotes/origin/HEAD` is actually
  populated — **required** for every `via: "remote_head"` case; without it
  every "with origin" case silently degrades to `via: "remote_ref"` and the
  test would pass for the wrong reason.
- `commitOn(repo, message, opts)` — `git commit --allow-empty -m <message>`
  with optional `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` env override (needed
  for case 7).
- `mergeNoFF(repo, branch)` / `fastForwardMerge(repo, branch)` — the two merge
  shapes DEC-5 must tell apart.

### Cases (technical-plan.md §6.1, verbatim numbering)

| # | Setup | Exact assertion | Fails-before / red-first |
|---|---|---|---|
| 1a | bare `origin`, default branch `main`, `remote set-head origin main` run | `detectTrunkDrift(work)` → `result.defaultBranch === "main"`, `result.defaultBranchVia === "remote_head"` | Before `resolveDefaultBranch` exists, this throws `Cannot find module`; once stubbed to always guess `"main"`/`"master"`, this still passes — **not** load-bearing alone, pair with 1c |
| 1b | same, default branch `master` | `defaultBranch === "master"`, `via === "remote_head"` | same as 1a |
| 1c | same, default branch **`trunk`** (nonstandard) | `defaultBranch === "trunk"`, `via === "remote_head"` | **This is the one that actually proves no hardcoded `main`/`master` guess.** A naive `candidates.includes(branch) ? branch : null` implementation fails this case while passing 1a/1b — must fail red first if you stub resolution to `candidates[0]` |
| 2 | no `origin` at all, single local branch named `trunk` | `defaultBranch === "trunk"`, `via === "sole_local_branch"`; `result.skipped === null` | Proves the engineer's rejected `symbolic-ref --short HEAD` alternative isn't secretly what's running — assert this by *also* checking out a **different** worktree/detached state isn't required here since there's only one branch, but do assert `headSha` is non-null so "did not throw, did not silently no-op" is provable, not just "didn't crash" |
| 2b | no remote, local `main` + a feature branch | `defaultBranch === "main"`, `via === "local_ref"` | If the sole-local-branch step ran first (wrong order), this would still pass by accident — pin `via` explicitly, not just `defaultBranch`, to catch that |
| 2c | no remote, branches `feat-a` + `feat-b`, neither `main`/`master` | `result.skipped === "no_default_branch"`, `result.commits === undefined` (never a guessed branch name anywhere on the object) | If resolution ever falls back to `feat-a` (alphabetical guess), this fails — that's the point |
| **3** | non-empty history: commits on a feature branch, `--no-ff` merged into trunk | `result.commits.length === 0`, `result.skipped === null` (drift *was* computed, it just found nothing — not the same as `skipped`) | **Red-first mandatory (DEC-5, §9.3 VACUOUS-GUARD).** Temporarily delete `--first-parent` and `--no-merges` from the `git log` argv, rerun, observe `commits.length > 0` (the merge commit and/or the feature-branch commits leak through), **record that observation in the commit message**, then restore. A green suite that never demonstrated this failure mode is the exact vacuous-guard this project's §9.3 exists to catch |
| 3b | same, feature branch **still exists** and was **fast-forwarded** in (no merge commit) | `result.commits.length === 0` | This is DEC-5 clause 3's own mechanism (`--not --exclude=refs/heads/<branch> --branches`). Prove it's load-bearing separately from case 3: temporarily drop **only** the `--not --exclude=... --branches` tail (leave `--first-parent --no-merges` intact) and rerun — the FF commits now leak through since they're on the first-parent line and aren't merges. This is the argument-ordering risk the plan itself flags as "order-sensitive… verify against the real fixtures" |
| 4 | dirty-but-uncommitted trunk (uncommitted edit to a tracked file), no new commits | `result.commits.length === 0` | Must not conflate with `checkWorktreeDirty`. Add a companion assertion: `await checkWorktreeDirty(repo)` (imported from `repo-topology.js`) returns `true` for the *same* repo state, proving the two functions answer genuinely different questions rather than one silently delegating to the other |
| 5 | 30 direct-to-trunk commits spanning 60 days (`GIT_COMMITTER_DATE` backdated), `detectTrunkDrift(repo, { lookbackDays: 7 })` | only commits with `committedAt` inside the last 7 days are returned; `result.commits.length` equals the count actually seeded inside the window (assert the exact number, not just `< 30`) | If the walk silently ignores `--since` (e.g. a caller passes `lookbackDays` but the arg never reaches the git invocation), this returns 30, not the windowed count — a `< 30` assertion would still pass by accident on an unrelated bug; assert the **exact** expected count |
| 5b | 300 direct-to-trunk commits inside the window, `{ maxCommits: 200 }` | `result.commits.length === 200`, `result.truncated === true` | If truncation silently drops the flag but still slices, this still "looks right" to a loose assertion — assert both fields together |
| 6 | 3 commits typed directly on trunk, realistic subjects + files | all 3 returned; `result.range.firstSha`/`result.range.lastSha` match the oldest/newest of the 3 by git DAG position (not by array index alone — assert against the actual `git rev-parse` shas of the fixture commits); each commit object has non-null `subject`, and `filesChanged`/`insertions`/`deletions` matching the real diffstat of that commit (compute expected via `git show --shortstat` on the fixture and assert equality, not just "> 0") | A stub that fabricates `{ filesChanged: 1, insertions: 1, deletions: 0 }` for every commit passes a "> 0" assertion but fails an exact-diffstat assertion |
| 6b | same 3 commits, `seenShas` = a `Set` containing 2 of the 3 real shas | `result.commits.length === 1`, and its `sha` is the one NOT in `seenShas` | Assert by real sha, not by count alone — a bug that filters the wrong entry (off-by-one) still returns length 1 and a loose test misses it |
| 7 | 3 commits authored with **out-of-order** `GIT_COMMITTER_DATE` (e.g. commit 1 dated latest, commit 3 dated earliest, committed in that literal order) | `result.commits` order equals git's own `--first-parent` walk order (newest-parent-first, i.e. reverse commit order), **not** sorted by `committedAt` | Sort the same array by `committedAt` separately in the test and assert it is **NOT** equal to `result.commits`' order — a positive "this is NOT date-sorted" assertion is what actually pins §9.2's two-axes rule; asserting only "some commits are order X" doesn't catch an accidental `.sort((a,b) => a.committedAt - b.committedAt)` that happens to coincide with DAG order in a less adversarial fixture |
| 8a | not a repo (`fs.mkdirSync`, no `git init`) | `{ skipped: "not_a_repo", repoPath }`, no throw | wrap the call in the test itself with no try/catch — an uncaught throw fails the test at the framework level, which is the correct proof of "never a throw" |
| 8b | empty repo (`git init`, zero commits) | `{ skipped: "no_commits", repoPath }` (or `"no_default_branch"` if there is no branch yet with zero commits — pin whichever the implementation actually produces and assert it's one of that fixed set, never a bare empty `commits: []` posing as computed) | |
| 8c | detached HEAD worktree | resolves normally if a default branch still exists (detached HEAD is a property of the *current* worktree, not of what `refs/heads/<branch>` points to) — assert `result.skipped === null` and correct `defaultBranch`, proving the detector doesn't mistake "the caller's checkout is detached" for "no default branch" | |
| 8d | bare repo (`git init --bare`) | `{ skipped: "not_a_repo", repoPath }` or a distinct explicit reason — never a throw, never `commits: []` | `isGitRepo` (imported from `repo-topology.js`) is the actual gate here — assert this test fails loudly (not silently returns `[]`) if `isGitRepo` is ever swapped for a check that doesn't distinguish bare from non-repo |

### Structural / registry-completeness check (co-located in this file)

- **No classification vocabulary** (Definition of Done, grep-checkable): read
  `fs.readFileSync(require.resolve("../lib/trunk-drift"), "utf8")` and assert
  it does not match `/\bfold_in\b|\bnew_item\b|\bdeliberate\b|\bdiscard\b/`.
  This is the automated form of the DoD bullet — put it in this file, not
  left as a manual `grep` step, so a future edit that reintroduces the
  vocabulary fails CI, not just a human's memory of the rule.
- **No SQLite / no cache** (posture parity with `repo-topology.js`): assert
  the module source contains no `require("../db")` / `require("./db")` and no
  `require("better-sqlite3")`.

---

## 2. `server/__tests__/git-refs.test.js` (NEW)

Purpose split from file 1: `trunk-drift.test.js` proves the **detector**
surfaces `resolveDefaultBranch`'s result correctly end-to-end; this file
unit-tests `resolveDefaultBranch`/`pickCanonicalRemote`/`listRemotes` **in
isolation**, and — the part item 2 of the brief specifically asked for —
proves `update-check.js`'s existing behavior is unchanged after the
extraction (DEC-5/§5 item 2, this project's "one home" convention).

```js
const { execGit, listRemotes, pickCanonicalRemote, resolveDefaultBranch,
        REMOTE_PRIORITY } = require("../lib/git-refs");
```

### 2.1 Single-home structural meta-test (the actual regression guard)

`update-check.js` keeps its own `module.exports = { getUpdatesStatus,
DEFAULT_ROOT }` — it does **not** export `listRemotes`/`pickCanonicalRemote`
for a test to grab and compare by reference. So the "not a re-copy" proof has
to be a structural scan of the source text, matching this project's own
established convention (`§9.1`-style meta-tests, `chronology-ordering.test.js`'s
`GRANDFATHERED_QUERIES`, `detour-dispositions-source-rebuild.test.js`'s
DDL-shape scan):

```js
const src = fs.readFileSync(require.resolve("../lib/update-check"), "utf8");
```

- `assert.match(src, /require\(["']\.\/git-refs["']\)/)` — imports from the
  shared module.
- `assert.doesNotMatch(src, /^\s*(async\s+)?function\s+listRemotes\s*\(/m)` —
  no private re-declaration.
- `assert.doesNotMatch(src, /^\s*(async\s+)?function\s+pickCanonicalRemote\s*\(/m)`
- `assert.doesNotMatch(src, /const\s+REMOTE_PRIORITY\s*=/)`
- `assert.match(src, /\{[^}]*\blistRemotes\b[^}]*\}\s*=\s*require\(["']\.\/git-refs["']\)/s)`
  and the same for `pickCanonicalRemote` — proves the destructure actually
  pulls both names in, not just importing the module and never using it.

**Red-first proof for this block specifically:** before Step 1 of the build
(the extraction), this file doesn't exist and `update-check.js` still has its
own private copies — running this scan against **today's**
`update-check.js` (checked out before the build) must fail on the "no private
re-declaration" assertions. That is the observable proof the extraction, not
just its presence, is what the test is pinned to.

### 2.2 `update-check.js` behavior-preservation (the hard DoD requirement)

Not new test *cases* — the requirement is that
**`server/__tests__/update-check.test.js` passes with zero edits to that
file.** State this explicitly as a required, separately-run command (not
folded into `git-refs.test.js`'s own assertions, since the whole point is
that file must not need to change):

```bash
node --test server/__tests__/update-check.test.js
```

Every one of that file's five existing `describe` blocks (`local on canonical
default branch`, `local on a feature branch`, `fork layout`, `detached HEAD`,
`no remotes configured`) must still pass unmodified — these already exercise
`pickCanonicalRemote`'s `REMOTE_PRIORITY` behavior (fork case) and
`listRemotes`'s empty-result path (no-remotes case), so their continuing to
pass **is** the regression proof for those two functions; §2.1's scan is the
proof for *how* they're wired, not a duplicate of *what* they compute.

### 2.3 New direct unit cases for `resolveDefaultBranch` (net-new function, deserves its own coverage independent of the detector)

| Case | Setup | Assertion |
|---|---|---|
| remote_head, nonstandard name | remote with `HEAD` symref set to `develop` | `{ branch: "develop", via: "remote_head" }` — proves step 1 doesn't special-case `main`/`master` either |
| remote_ref fallback | remote exists, symref **not** set (no `remote set-head` call), remote has `master` | `{ branch: "master", via: "remote_ref" }` — proves step 1 failing gracefully falls through, not throws |
| remote_ref honors custom `candidates` | remote exists, no symref, remote branch named `trunk` only | `resolveDefaultBranch(repo, { candidates: ["trunk"] })` → `{ branch: "trunk", via: "remote_ref" }`; the same call **without** the `candidates` override → `{ branch: null, via: null }` (proves the option is actually threaded through, not decorative) |
| sole_local_branch reached even with an unrelated remote present | remote exists with branches that don't match any candidate, local repo has exactly one branch `release` | `{ branch: "release", via: "sole_local_branch" }` — proves a present-but-irrelevant remote doesn't short-circuit into `no_default_branch` before step 4 runs |
| no-default-branch, remote and local both ambiguous | remote has `feat-x`/`feat-y` only, local has `feat-x`/`feat-y` only (2 local branches, neither a candidate) | `{ branch: null, via: null }`, never a throw, never `feat-x` by alphabetical accident |
| never fetches by default (structural) | — | read `trunk-drift.js` **and** `server/routes/projects.js` source text; assert neither contains `allowFetch:\s*true` / `allowFetch: true` anywhere — the plan's own words are "no fetch unless `allowFetch === true`, which no Phase 1a caller passes"; make that machine-checked, not trusted prose |

**Fails-before-passes-after for each 2.3 case:** run each against a
deliberately-wrong stub (e.g. `resolveDefaultBranch` hardcoded to always try
`main` then `master` with no `candidates` param honored, and no step-4
fallback) — every "nonstandard name" and "candidates override" row above
fails on that stub while the "remote_head, `main`/`master`" happy-path rows
would still pass, which is exactly why 1c/2.3's nonstandard cases — not the
standard-name ones — are the ones actually pinning the behavior.

---

## 3. `server/__tests__/reconciliation.test.js` additions (DEC-4 carve-out)

**Append-only** — a new `describe` block added after the file's existing
ones (after `classifyFlaggedDetours`, currently the last block). Zero edits
to any existing `describe`/`it`. Verify with:

```bash
node --test server/__tests__/reconciliation.test.js server/__tests__/reconciliation-full-tick.test.js
```
— both files must pass with their pre-existing assertions completely
untouched; this **is** the DoD's "zero behavioral change to any verdict"
proof.

```js
const { parseDispositionOutput } = require("../lib/reconciliation");
```

`node:test`'s built-in `t.mock.method` is used to spy on console output
rather than injecting a fake logger, since `parseDispositionOutput` has no
`log` parameter in its current signature and the plan's own wording (`log(...)`)
doesn't commit to `console.error` vs `console.warn`. **Design note for the
implementer:** spy on both and assert on the combined call count first; once
the actual call site is written, tighten the spy to whichever single method
it uses and delete the other spy — a test that still passes with two loose
spies after implementation is a smell worth cleaning up, not a permanent
shape.

```js
describe("parseDispositionOutput — DEC-4 logging carve-out (Phase 1a)", () => {
  it("logs on the terminal catch (unparseable stdout), still returns an empty Map", (t) => {
    const errSpy = t.mock.method(console, "error", () => {});
    const warnSpy = t.mock.method(console, "warn", () => {});
    const flagged = [{ id: 1, label: "x" }];

    const result = parseDispositionOutput("not json at all", flagged);

    assert.equal(result.size, 0); // UNCHANGED from pre-fix behavior
    const calls = [...errSpy.mock.calls, ...warnSpy.mock.calls];
    assert.equal(calls.length, 1, "expected exactly one log call on the catch path");
    const loggedText = calls[0].arguments.join(" ");
    assert.match(loggedText, /disposition/i);
    assert.match(loggedText, /unparseable|parse/i);
  });

  it("logs when a successful parse yields zero verdicts for a non-empty flagged batch, still returns the same empty Map", (t) => {
    const errSpy = t.mock.method(console, "error", () => {});
    const warnSpy = t.mock.method(console, "warn", () => {});
    const flagged = [{ id: 1, label: "x" }];
    // Valid JSON envelope, but the only verdict's id (999) isn't in `flagged`.
    const stdout = JSON.stringify({
      result: JSON.stringify({ verdicts: [{ id: 999, disposition: "discard" }] }),
    });

    const result = parseDispositionOutput(stdout, flagged);

    assert.equal(result.size, 0); // UNCHANGED
    const calls = [...errSpy.mock.calls, ...warnSpy.mock.calls];
    assert.equal(calls.length, 1);
    const loggedText = calls[0].arguments.join(" ");
    assert.match(loggedText, /0 verdicts|zero verdicts/i);
  });

  it("does NOT log on the happy path (non-empty valid verdict batch) — the fix must not add noise to a healthy tick", (t) => {
    const errSpy = t.mock.method(console, "error", () => {});
    const warnSpy = t.mock.method(console, "warn", () => {});
    const flagged = [{ id: 1, label: "x" }];
    const stdout = JSON.stringify({
      result: JSON.stringify({
        verdicts: [{ id: 1, disposition: "discard", confidence: 0.9, reason: "noise" }],
      }),
    });

    const result = parseDispositionOutput(stdout, flagged);

    assert.equal(result.size, 1); // UNCHANGED shape/content
    assert.equal(result.get(1).disposition, "discard");
    assert.equal(errSpy.mock.calls.length, 0);
    assert.equal(warnSpy.mock.calls.length, 0);
  });
});
```

**Red-first proof (per §9.3 discipline, even though this fix is
logging-only):** run all three cases against **today's** `reconciliation.js`
(before the two `log()` lines land). The first two `assert.equal(calls.length, 1)`
assertions fail (`0 !== 1`) while the `result.size` assertions in the same
two tests still pass — proving these specific assertions, not the whole test,
are what the carve-out adds. The third case passes unmodified both before and
after, which is itself the "zero behavioral change" proof for the happy path.

---

## 4. `server/__tests__/projects.test.js` additions

New `describe("GET /:id/trunk-drift", ...)` block, added directly after the
existing `describe("GET /:id/repos", ...)` block (same file, same
`makeFixtureRepo`/`FS_FIXTURE_ROOT`/`fetch`/`post` helpers already defined at
the top of the file — no new harness needed).

```js
describe("GET /:id/trunk-drift", () => {
  it("404 for a project that doesn't exist", async () => {
    const res = await fetch("/api/projects/does-not-exist/trunk-drift");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("{ repos: [] } for a project with no mapped folders", async () => {
    const created = await post("/api/projects", { name: "Trunk Drift Empty" });
    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.repos, []);
  });

  it("skips a mapped non-repo folder — it does not appear in `repos` at all, and does not error", async () => {
    const repo = makeFixtureRepo("trunk-drift-route-repo");
    const plainFolder = path.join(FS_FIXTURE_ROOT, "trunk-drift-route-plain");
    fs.mkdirSync(plainFolder, { recursive: true });
    const created = await post("/api/projects", {
      name: "Trunk Drift Skip Non-Repo",
      cwds: [repo, plainFolder],
    });

    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    assert.equal(res.body.repos.length, 1);
    assert.equal(res.body.repos[0].cwd, repo);
  });

  it("populated drift for a fixture repo with a direct-to-trunk commit", async () => {
    const repo = makeFixtureRepo("trunk-drift-route-positive");
    // makeFixtureRepo already leaves one commit (the "init" commit) directly
    // on the sole local branch with no other branch present; add a second,
    // unambiguous direct-to-trunk commit so the fixture isn't relying only
    // on the incidental init commit.
    fs.writeFileSync(path.join(repo, "README.md"), "changed directly on trunk\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-am", "direct trunk change"], {
      cwd: repo, stdio: "ignore", env: ISOLATED_GIT_ENV,
    });

    const created = await post("/api/projects", {
      name: "Trunk Drift Positive",
      cwds: [repo],
    });
    const pathId = created.body.project.paths[0].id;

    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    assert.equal(res.body.repos.length, 1);
    assert.equal(res.body.repos[0].cwd, repo);
    assert.equal(res.body.repos[0].pathId, pathId);
    assert.equal(res.body.repos[0].drift.skipped, null);
    assert.equal(res.body.repos[0].drift.defaultBranch, "master");
    assert.equal(res.body.repos[0].drift.commits.length, 2);
    assert.ok(
      res.body.repos[0].drift.commits.some((c) => c.subject === "direct trunk change")
    );
  });

  it("computes drift independently per mapped repo — a merged (clean) repo and a direct-commit repo don't contaminate each other", async () => {
    const cleanRepo = makeFixtureRepo("trunk-drift-route-clean");
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: cleanRepo, stdio: "ignore", env: ISOLATED_GIT_ENV });
    fs.writeFileSync(path.join(cleanRepo, "f.txt"), "x\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: cleanRepo, stdio: "ignore", env: ISOLATED_GIT_ENV });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "feature work"], { cwd: cleanRepo, stdio: "ignore", env: ISOLATED_GIT_ENV });
    execFileSync("git", ["checkout", "master"], { cwd: cleanRepo, stdio: "ignore", env: ISOLATED_GIT_ENV });
    execFileSync("git", ["merge", "--no-ff", "feature", "-m", "merge feature"], { cwd: cleanRepo, stdio: "ignore", env: ISOLATED_GIT_ENV });

    const directRepo = makeFixtureRepo("trunk-drift-route-direct");
    fs.writeFileSync(path.join(directRepo, "README.md"), "direct\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-am", "direct"], { cwd: directRepo, stdio: "ignore", env: ISOLATED_GIT_ENV });

    const created = await post("/api/projects", {
      name: "Trunk Drift Multi Repo",
      cwds: [cleanRepo, directRepo],
    });

    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    const byRepo = Object.fromEntries(res.body.repos.map((r) => [r.cwd, r.drift]));
    assert.equal(byRepo[cleanRepo].commits.length, 0);
    assert.equal(byRepo[directRepo].commits.length, 2);
  });

  it("does not widen /:id/repos's existing response shape (API response-shape stability, .claude/rules/backend-node.md)", async () => {
    const repo = makeFixtureRepo("trunk-drift-shape-guard");
    const created = await post("/api/projects", { name: "Shape Guard", cwds: [repo] });
    const res = await fetch(`/api/projects/${created.body.project.id}/repos`);
    assert.deepEqual(
      Object.keys(res.body).sort(),
      ["detectedSiblings", "ignoredRepos", "nonRepoFolders", "project_id", "repos"].sort()
    );
  });
});
```

**Fails-before/red-first note:** every case in this block fails today with
`Cannot GET /api/projects/.../trunk-drift` (the route doesn't exist) — that
is the expected red state before Step 4 of the build. The last case (shape
guard) is the one that must **already pass today**, unmodified — it exists to
catch a future accidental widening of `/:id/repos`, not to gate the new
route's own build.

---

## 5. `client/src/pages/__tests__/ProjectDetail.test.tsx` additions

Add `trunkDriftMock = vi.fn()` alongside the existing mocks (`reposMock`,
`intakeMock`, etc.), wire it into the `vi.mock("../../lib/api", ...)` factory
as `trunkDrift: (...args: unknown[]) => trunkDriftMock(...args)` under
`api.projects`, and give it a default `mockResolvedValue` in `beforeEach`
mirroring `reposMock`'s pattern — an empty/no-op default
(`{ repos: [] }`) so existing tests that don't care about this card keep
passing unmodified.

```ts
const mockTrunkDrift: ProjectTrunkDriftResponse = {
  repos: [
    {
      cwd: "/repo/agent-monitor",
      pathId: 1,
      drift: {
        skipped: null,
        repoPath: "/repo/agent-monitor",
        defaultBranch: "master",
        defaultBranchVia: "sole_local_branch",
        headSha: "deadbeef",
        lookbackDays: 7,
        since: "2026-07-26T00:00:00.000Z",
        commits: [
          {
            sha: "abc1234567890",
            shortSha: "abc1234",
            authorName: "Ada Lovelace",
            authorEmail: "ada@example.com",
            committedAt: "2026-08-01T09:00:00.000Z",
            subject: "quick trunk fix",
            filesChanged: 2,
            insertions: 5,
            deletions: 1,
          },
        ],
        commitCount: 1,
        truncated: false,
        range: { firstSha: "abc1234567890", lastSha: "abc1234567890" },
      },
    },
  ],
};
```

### Cases

1. **Renders the populated card's full content contract.**
   `trunkDriftMock.mockResolvedValue(mockTrunkDrift)`; render; assert:
   - `trunkDriftMock` was called with `"proj-1"` (mirrors `reposMock`'s
     existing assertion convention).
   - the card title text renders (the actual i18n string, e.g.
     `screen.findByText(/direct-to-trunk work/i)` — case-insensitive since the
     exact copy isn't final; tighten to the literal `en/projectDetail.json`
     string once written).
   - `screen.getByText("abc1234")` (short SHA), `screen.getByText(/quick trunk fix/)`,
     `screen.getByText(/Ada Lovelace/)`, and diffstat text matching
     `/\+5.*-1|\+5\/-1/` for insertions/deletions — asserting the **rendered
     content**, not a snapshot, so a regression in any one field fails this
     specific assertion rather than a generic snapshot diff.
   - default branch (`"master"`) and the lookback window (`7`, in whatever
     unit the copy uses — days) both appear somewhere in the card.
   - **No classification/action surface:** `screen.queryByText(/fold_in|new_item|deliberate|discard/i)`
     is `null`, and there is no button inside this card's DOM subtree beyond
     whatever generic collapse/expand control the page already uses elsewhere
     — assert specifically that no button's accessible name matches
     `/dismiss|resolve|fold|discard|classify/i` inside the card region (found
     via `within(screen.getByTestId("trunk-drift-card"))` or equivalent — add
     that `data-testid` to the new card if the component doesn't already
     expose a stable selector). This operationalizes "No badge, no verdict,
     no action button" as a real, failing-if-violated test rather than prose.

2. **`skipped` renders as an explicit "unknown" state, never "clean" —
   the load-bearing false-clean guard, client side.**
   `trunkDriftMock.mockResolvedValue({ repos: [{ cwd: "/repo/x", pathId: 2,
   drift: { skipped: "no_default_branch", repoPath: "/repo/x" } }] })`. Assert
   the same localized string the existing worktree-dirty "Unknown" state uses
   (`t("repos.unknown")`, rendered today at `ProjectDetail.tsx`'s `dirty ===
   null` branch — reuse that exact key/string if the new card is meant to
   share it, or assert the new key's resolved value directly) appears for
   this repo's entry, **and** assert the word "clean" (case-insensitive) does
   **not** appear anywhere in that repo's card region.

3. **Distinguishes a genuinely clean trunk from a skipped/unknown one — pairs
   with case 2, and is the assertion that actually catches a conflation bug.**
   Extend the same render to include a *second* repo entry in the same
   response: `{ cwd: "/repo/y", pathId: 3, drift: { skipped: null, commits: [],
   commitCount: 0, defaultBranch: "master", ... } }`. Assert:
   - the `/repo/y` entry renders a distinct "no direct-to-trunk commits
     found" (or equivalent empty-state) string, **not** the same "unknown"
     string used for `/repo/x` in case 2.
   - the two strings rendered for `/repo/x` and `/repo/y` are not
     string-equal — a component that maps both `skipped !== null` and
     `commits.length === 0` to the same rendered text passes case 2 and case
     3 individually only if each is checked against the *other's* forbidden
     string, so assert both directions explicitly:
     `expect(unknownText).not.toBe(cleanText)`.

4. **`trunkDriftMock` rejection / slow load doesn't crash the page and the
   existing repo-topology card still renders** (websocket-delay-safe pattern
   per `.claude/rules/frontend-react.md`): `trunkDriftMock.mockRejectedValue(new
   Error("network"))`; render; assert the page still renders the project name
   and the existing Repos card content (`reposMock`'s fixture data), proving
   the new card's fetch is not on the same failure path as the rest of the
   page — i.e. it degrades independently.

**Red-first note:** all of cases 1–3 fail today at the very first assertion
(`trunkDriftMock` doesn't exist as a call, or the card title text is never
found) since neither `api.ts`'s `trunkDrift` method nor the card exist yet.
Case 3 is the one to watch during implementation review: it is easy to make
pass *for the wrong reason* (e.g. by having both states literally render
`t("repos.unknown")`, which would make case 2 pass and case 3's
`not.toBe` catch it) — treat case 3's `not.toBe` assertion as the actual
guard, not case 2 in isolation.

---

## 6. `client/src/i18n/__tests__/i18n.test.ts` addition — locale-completeness meta-test

This file already carries the project's established pattern for exactly this
kind of check (see its `report.{wallClockLabel,activeLabel}` and
`nav.focusCalendar` blocks, both driven by a single `LOCALES = ["en", "ko",
"vi", "zh"]` array). Add a new `describe` block in the same file, same shape,
for the new `projectDetail:trunkDrift.*` keys — this is the registry-derived
meta-test the change brief's "Locale variants" risk explicitly calls for, so
a locale missing the new keys cannot ship green:

```ts
describe("projectDetail:trunkDrift completeness (registry-derived, all locales) — trunk-drift-detection Phase 1a", () => {
  // Pin this list to the exact keys ProjectDetail.tsx's new card actually
  // renders via t("trunkDrift.<key>") — keep it in sync with the component,
  // not aspirational.
  const KEYS = [
    "title",
    "description",
    "defaultBranch",
    "lookbackWindow",
    "commitCount",
    "empty",       // skipped === null && commits.length === 0
    "unknown",     // skipped !== null
  ] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves a non-empty, non-key-echoing string for "trunkDrift.${key}" in locale "${locale}"`, async () => {
        await i18n.changeLanguage(locale);
        const value = i18n.t(`projectDetail:trunkDrift.${key}`);
        expect(value).not.toBe(`trunkDrift.${key}`);
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      });
    }
  }

  it("en's `empty` and `unknown` strings are distinct (client-side proof of the never-guess-clean invariant, mirrors ProjectDetail.test.tsx case 3)", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("projectDetail:trunkDrift.empty")).not.toBe(
      i18n.t("projectDetail:trunkDrift.unknown")
    );
  });
});
```

**Red-first note:** with only `en`/`projectDetail.json` edited (the most
likely accidental shape — one locale forgotten), the `ko`/`vi`/`zh` iterations
of this loop fail on i18next's missing-key fallback (which returns the
literal dotted key path, e.g. `"trunkDrift.title"`, caught by the
`not.toBe` assertion) — that is precisely the failure mode this meta-test
exists to catch instead of a human eyeballing four JSON files.

---

## Summary of what's deliberately NOT tested here (Phase 1b, out of scope)

Per the change brief's scope boundary: no test above touches
`detour_dispositions.source`, `rebuildTableAtomically`, `SOURCES`,
`capLabel`/`formatTrunkDriftLabel`, `listSeenTrunkDriftShas`,
`recordTrunkDriftDetour`/`backfillTrunkDriftDetours`, the `reconcileCwd`
periodic-invocation step, or `buildDispositionPrompt`'s reorder/budgeting.
Those all land with their own test design once WATCH-5's gate closes.
