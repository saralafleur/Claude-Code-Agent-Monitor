/**
 * @file Tests for server/lib/trunk-drift.js — detector for work that landed
 * directly on a repo's default branch. Real git fixtures (no mocked child_process),
 * no SQLite, no DB module. 17 cases from the test plan plus 3c/3d/8e additions.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { detectTrunkDrift } = require("../lib/trunk-drift");

// Isolated git environment (no ambient GIT_DIR/GIT_WORK_TREE from hooks)
const GIT_ENV_OVERRIDE_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];
const ISOLATED_GIT_ENV = { ...process.env };
for (const key of GIT_ENV_OVERRIDE_KEYS) delete ISOLATED_GIT_ENV[key];

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: ISOLATED_GIT_ENV,
  }).trim();
}

function makeBareRemote(parent, name) {
  const remote = path.join(parent, name);
  fs.mkdirSync(remote, { recursive: true });
  execFileSync("git", ["init", "--bare", remote], {
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  return remote;
}

// A real repo's root commit predates any test's lookback window by a wide
// margin — it's not something that "just happened." If the fixture's root
// "init" commit is left dated at the current wall-clock time (git's default
// when no committer-date override is given), it falls INSIDE the detector's
// default 7-day lookback window and, whenever no other local branch also
// contains it (so DEC-5's "not reachable from any other branch" clause
// doesn't already exclude it), shows up as a spurious extra "direct commit"
// alongside whatever the test actually seeded. Backdating it here — older
// than case 5's own 60-day span, so it also stays the chronologically
// oldest commit in that history (see case 5's own date-direction fix) —
// keeps every case's commit count meaning what the case says it means.
const ROOT_COMMIT_DAYS_AGO = 90;

function makeWorkingRepo(parent, name) {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["-c", "init.defaultBranch=master", "init", repo], {
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  const rootDate = new Date(Date.now() - ROOT_COMMIT_DAYS_AGO * 24 * 60 * 60 * 1000).toISOString();
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: repo,
    stdio: "ignore",
    env: { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: rootDate, GIT_AUTHOR_DATE: rootDate },
  });
  return repo;
}

function setRemoteHead(repo, remoteName, branchName) {
  git(repo, [
    "symbolic-ref",
    `refs/remotes/${remoteName}/HEAD`,
    `refs/remotes/${remoteName}/${branchName}`,
  ]);
}

function commitOn(cwd, branchName, message, env = {}) {
  const finalEnv = { ...ISOLATED_GIT_ENV, ...env };
  git(cwd, ["checkout", "-q", branchName]);
  fs.writeFileSync(path.join(cwd, `${Date.now()}.txt`), "content\n");
  git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", message], {
    cwd,
    stdio: "ignore",
    env: finalEnv,
  });
}

function mergeNoFF(cwd, sourceBranch, message) {
  git(cwd, ["merge", "--no-ff", "-m", message, sourceBranch]);
}

function fastForwardMerge(cwd, sourceBranch) {
  git(cwd, ["merge", "--ff-only", sourceBranch]);
}

function makeWorktreeBranch(repo, branchName, linkedPath) {
  git(repo, ["worktree", "add", "-b", branchName, linkedPath]);
  // Fixture self-check: assert git worktree list shows 2 worktrees. Each
  // worktree is its own blank-line-separated BLOCK of several lines
  // (`worktree <path>`, `HEAD <sha>`, `branch <ref>`, ...) in
  // `--porcelain` output, not one line — counting raw non-blank LINES
  // over-counts (a two-worktree repo emits 6 non-blank lines: 3 fields per
  // block). Count only the `worktree ` header lines, one per block.
  const worktreeCount = git(repo, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;
  assert.equal(worktreeCount, 2, `expected 2 worktrees, got ${worktreeCount}`);
  return linkedPath;
}

function makeCorruptRepo(parent, name) {
  const repo = makeWorkingRepo(parent, name);
  // Delete the contents of .git/objects but keep the directory
  const objectsDir = path.join(repo, ".git", "objects");
  for (const item of fs.readdirSync(objectsDir)) {
    const itemPath = path.join(objectsDir, item);
    if (fs.lstatSync(itemPath).isDirectory()) {
      fs.rmSync(itemPath, { recursive: true });
    } else {
      fs.unlinkSync(itemPath);
    }
  }
  // Fixture self-checks
  assert.throws(() => git(repo, ["log", "-1"]), "makeCorruptRepo: git log should throw");
  // isGitRepo should still return true (repo discovery still works)
  const { isGitRepo } = require("../lib/repo-topology");
  assert.equal(isGitRepo(repo), true, "makeCorruptRepo: isGitRepo should still return true");
  return repo;
}

let tmpDir;

before(() => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "trunkdrift-")));
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("detectTrunkDrift", () => {
  it("1a: trunk named 'main' with remote_head via", async () => {
    const bare = makeBareRemote(tmpDir, "1a-origin");
    const repo = makeWorkingRepo(tmpDir, "1a-repo");
    git(repo, ["branch", "-m", "master", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "main"]);
    setRemoteHead(repo, "origin", "main");

    commitOn(repo, "main", "direct to main");
    const result = await detectTrunkDrift(repo);

    assert.equal(result.skipped, null);
    assert.equal(result.defaultBranch, "main");
    assert.equal(result.defaultBranchVia, "remote_head");
    assert.equal(result.commits.length, 1);
    assert.equal(result.commits[0].subject, "direct to main");
  });

  it("1b: trunk named 'master' with remote_head via", async () => {
    const bare = makeBareRemote(tmpDir, "1b-origin");
    const repo = makeWorkingRepo(tmpDir, "1b-repo");
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "master"]);
    setRemoteHead(repo, "origin", "master");

    commitOn(repo, "master", "direct to master");
    const result = await detectTrunkDrift(repo);

    assert.equal(result.skipped, null);
    assert.equal(result.defaultBranch, "master");
    assert.equal(result.defaultBranchVia, "remote_head");
    assert.equal(result.commits.length, 1);
  });

  it("1c: trunk named 'trunk' (nonstandard) with remote_head via", async () => {
    const bare = makeBareRemote(tmpDir, "1c-origin");
    const repo = makeWorkingRepo(tmpDir, "1c-repo");
    git(repo, ["branch", "-m", "master", "trunk"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "trunk"]);
    setRemoteHead(repo, "origin", "trunk");

    commitOn(repo, "trunk", "direct to trunk");
    const result = await detectTrunkDrift(repo);

    assert.equal(result.skipped, null);
    assert.equal(result.defaultBranch, "trunk");
    assert.equal(result.defaultBranchVia, "remote_head");
  });

  it("2: no remote at all, single local branch — sole_local_branch via", async () => {
    const repo = makeWorkingRepo(tmpDir, "2-repo");
    git(repo, ["branch", "-m", "master", "trunk"]);

    commitOn(repo, "trunk", "direct commit");
    const result = await detectTrunkDrift(repo);

    assert.equal(result.skipped, null);
    assert.equal(result.defaultBranch, "trunk");
    assert.equal(result.defaultBranchVia, "sole_local_branch");
    assert.equal(result.commits.length, 1);
  });

  it("2b: no remote, local 'main' and feature branch — resolves to main", async () => {
    const repo = makeWorkingRepo(tmpDir, "2b-repo");
    git(repo, ["branch", "-m", "master", "main"]);
    git(repo, ["branch", "feature"]);

    commitOn(repo, "main", "direct to main");
    const result = await detectTrunkDrift(repo);

    assert.equal(result.defaultBranch, "main");
    assert.equal(result.commits.length, 1);
  });

  it("2c: no remote, ambiguous branches — returns skipped no_default_branch", async () => {
    const repo = makeWorkingRepo(tmpDir, "2c-repo");
    git(repo, ["branch", "-m", "master", "feat-a"]);
    git(repo, ["branch", "feat-b"]);

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, "no_default_branch");
  });

  it("3: clean trunk (no-ff merged feature, branch still exists) — no direct commits", async () => {
    const repo = makeWorkingRepo(tmpDir, "3-repo");
    git(repo, ["branch", "feature"]);

    commitOn(repo, "feature", "work on feature");
    git(repo, ["checkout", "-q", "master"]);

    mergeNoFF(repo, "feature", "merge feature");

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, null);
    assert.equal(result.commits.length, 0, "clean trunk should have 0 direct commits");
  });

  it("3b: feature ff-merged, branch still exists — now correctly flagged (WATCH-1 risk widened, see decisions.md)", async () => {
    // Was "0 direct commits" under the old "--not --exclude=<trunk>
    // --branches" clause. That clause is gone (see the file header + the
    // 2026-08-03-trunk-drift-open-branch-blindness decision log): it's
    // provably impossible to distinguish, from git topology alone, "a
    // ff-merged branch whose ref hasn't been deleted yet" from "a brand-new,
    // not-yet-started sibling branch at the same tip" (case 6c) — both have
    // zero commits ahead of trunk. Protecting the former necessarily blinds
    // trunk's own unrelated history whenever the latter merely exists, which
    // this project's actual concurrent-effort workflow triggers constantly.
    // WATCH-1 already accepted this exposure for the POST-deletion case;
    // this widens it to apply whenever a ff-merged branch exists at all —
    // deliberate, not a regression. This project's own convention never
    // fast-forwards (always --no-ff + branch delete on cleanup), so the
    // scenario this case exercises is not expected to occur in practice.
    const repo = makeWorkingRepo(tmpDir, "3b-repo");
    git(repo, ["branch", "feature"]);

    commitOn(repo, "feature", "work on feature");
    git(repo, ["checkout", "-q", "master"]);

    fastForwardMerge(repo, "feature");

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, null);
    assert.equal(
      result.commits.length,
      1,
      "ff-merged-but-undeleted branches are indistinguishable from direct commits (accepted, see 3b's comment)"
    );
  });

  it("3c: worktree flow — feature ff-merged, worktree still linked — now correctly flagged (same widening as 3b)", async () => {
    const repo = makeWorkingRepo(tmpDir, "3c-repo");
    git(repo, ["branch", "feature"]);

    commitOn(repo, "feature", "work on feature");

    const worktreePath = path.join(tmpDir, "3c-worktree");
    makeWorktreeBranch(repo, "feature-wt", worktreePath);

    git(repo, ["checkout", "-q", "master"]);
    fastForwardMerge(repo, "feature");

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, null);
    assert.equal(
      result.commits.length,
      1,
      "ff-merged worktree feature is likewise no longer distinguishable from a direct commit (see 3b)"
    );
  });

  it("3d: --no-ff merge then branch deleted — no direct commits", async () => {
    const repo = makeWorkingRepo(tmpDir, "3d-repo");
    git(repo, ["branch", "feature"]);

    commitOn(repo, "feature", "work on feature");
    git(repo, ["checkout", "-q", "master"]);

    mergeNoFF(repo, "feature", "merge feature");
    git(repo, ["branch", "-D", "feature"]);

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, null);
    assert.equal(result.commits.length, 0);
  });

  it("4: dirty-but-uncommitted trunk, no new commits — no direct commits", async () => {
    const repo = makeWorkingRepo(tmpDir, "4-repo");
    fs.writeFileSync(path.join(repo, "README.md"), "dirty\n");

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, null);
    assert.equal(result.commits.length, 0);
  });

  it("5: 30 commits over 60 days, lookback 7 days — only windowed commits returned", async () => {
    const repo = makeWorkingRepo(tmpDir, "5-repo");
    const now = new Date();

    // Add 30 commits, spacing them across 60 days. `git log --since` assumes
    // chronological traversal: walking parent-first from HEAD, it stops as
    // soon as it sees a commit older than the threshold. That only holds if
    // committer dates increase monotonically as the DAG advances toward
    // HEAD — so commit i=0 (made first, so the OLDEST DAG position, i.e.
    // furthest from HEAD) must get the OLDEST date, and commit i=29 (made
    // last, HEAD) must get the date closest to `now`. Assigning it the other
    // way around (oldest DAG position getting the newest date) makes HEAD's
    // own commit look 58 days old, so `--since=7 days ago` stops the walk
    // before it ever reaches a commit inside the window.
    for (let i = 0; i < 30; i++) {
      const dayOffset = Math.floor(((30 - 1 - i) * 60) / 30);
      const commitDate = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      const isoDate = commitDate.toISOString();

      fs.writeFileSync(path.join(repo, `commit-${i}.txt`), `commit ${i}\n`);
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], {
        cwd: repo,
        stdio: "ignore",
        env: { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate },
      });
      execFileSync(
        "git",
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", `commit ${i}`],
        {
          cwd: repo,
          stdio: "ignore",
          env: { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate },
        }
      );
    }

    const result = await detectTrunkDrift(repo, { lookbackDays: 7 });
    assert.ok(result.commits.length < 30, "should have fewer than 30 commits in 7-day window");
    assert.ok(result.commits.length > 0, "should have at least some commits in 7-day window");
  });

  it("5b: 300 commits in window, maxCommits 200 — truncated at 200", async () => {
    const repo = makeWorkingRepo(tmpDir, "5b-repo");

    // Add 300 commits
    for (let i = 0; i < 300; i++) {
      fs.writeFileSync(path.join(repo, `commit-${i}.txt`), `commit ${i}\n`);
      git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
      git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", `commit ${i}`]);
    }

    const result = await detectTrunkDrift(repo, { maxCommits: 200 });
    assert.equal(result.commits.length, 200);
    assert.equal(result.truncated, true);
  });

  it("5c: 5 real commits, maxCommits 3, seenShas filters 2 out of the truncated window — truncated stays true (S1 regression guard)", async () => {
    const repo = makeWorkingRepo(tmpDir, "5c-repo");

    const shas = [];
    for (let i = 0; i < 5; i++) {
      commitOn(repo, "master", `commit ${i}`);
      shas.push(git(repo, ["rev-parse", "HEAD"]));
    }
    // shas[4] is newest (HEAD); shas[0] is oldest.

    // With maxCommits: 3, the raw walk fetches maxCommits + 1 = 4 records:
    // shas[4], shas[3], shas[2], shas[1] (newest first). Pre-populating
    // seenShas with the 2 newest of those removes 2 of the 4 raw records,
    // leaving only 2 commits post-filter — below maxCommits. If `truncated`
    // were (incorrectly) computed AFTER the seenShas filter instead of
    // before it, this would make truncated wrongly read false even though
    // the underlying git walk genuinely hit the maxCount ceiling.
    const seenShas = new Set([shas[4], shas[3]]);
    const result = await detectTrunkDrift(repo, { maxCommits: 3, seenShas });

    assert.equal(result.truncated, true);
    assert.equal(result.commits.length, 2);
  });

  it("6: genuine positive — 3 direct-to-trunk commits, all returned with full metadata", async () => {
    const repo = makeWorkingRepo(tmpDir, "6-repo");

    commitOn(repo, "master", "first direct commit");
    commitOn(repo, "master", "second direct commit");
    commitOn(repo, "master", "third direct commit");

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, null);
    assert.equal(result.commits.length, 3);
    assert.ok(result.range.firstSha, "should have range.firstSha");
    assert.ok(result.range.lastSha, "should have range.lastSha");

    for (const commit of result.commits) {
      assert.ok(commit.sha);
      assert.ok(commit.shortSha);
      assert.ok(commit.authorName);
      assert.ok(commit.authorEmail);
      assert.ok(commit.committedAt);
      assert.ok(commit.subject);
      assert.ok(typeof commit.filesChanged === "number");
      assert.ok(typeof commit.insertions === "number");
      assert.ok(typeof commit.deletions === "number");
    }
  });

  it("6b: same with seenShas filter — only unseen commit returned", async () => {
    const repo = makeWorkingRepo(tmpDir, "6b-repo");

    commitOn(repo, "master", "commit 1");
    const sha1 = git(repo, ["rev-parse", "HEAD"]);

    commitOn(repo, "master", "commit 2");
    const sha2 = git(repo, ["rev-parse", "HEAD"]);

    commitOn(repo, "master", "commit 3");
    const sha3 = git(repo, ["rev-parse", "HEAD"]);

    const seenShas = new Set([sha1, sha2]);
    const result = await detectTrunkDrift(repo, { seenShas });

    assert.equal(result.commits.length, 1);
    assert.equal(result.commits[0].sha, sha3);
  });

  it("6c: an unrelated sibling branch at trunk's tip (zero divergence) must not blind trunk's own, older direct-to-trunk commits", async () => {
    // Reproduces a real incident found via the plan-lifecycle-value-ledger
    // effort's slice-4 checkpoint against Coaching Assistant: a second,
    // concurrently-open effort branch existed at trunk's exact tip (freshly
    // created, zero commits of its own yet). Because the OLD detector
    // excluded everything reachable from ANY other local branch, its mere
    // existence hid trunk's entire real direct-commit history, not just
    // anything related to that branch. This case seeds real, older
    // direct-to-trunk commits FIRST, then creates a sibling branch at the
    // current tip with no commits of its own, and asserts those older
    // commits still show up.
    const repo = makeWorkingRepo(tmpDir, "6c-repo");

    commitOn(repo, "master", "real direct commit, predates the sibling branch");
    const realSha = git(repo, ["rev-parse", "HEAD"]);

    // A sibling branch created off trunk's current tip, with NO commits of
    // its own — the exact shape of "someone just ran `git worktree add` for
    // a brand-new, not-yet-started effort".
    git(repo, ["branch", "effort/unrelated-in-progress-work"]);

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, null);
    assert.equal(
      result.commits.length,
      1,
      "an unstarted sibling branch must not hide trunk's own pre-existing direct commit"
    );
    assert.equal(result.commits[0].sha, realSha);
  });

  it("7: out-of-order GIT_COMMITTER_DATE — returned in git DAG order, not date order", async () => {
    const repo = makeWorkingRepo(tmpDir, "7-repo");

    // Commit 1 with "future" date
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // +1 day
    fs.writeFileSync(path.join(repo, "commit-1.txt"), "1\n");
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "future commit"],
      {
        cwd: repo,
        stdio: "ignore",
        env: { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: futureDate, GIT_AUTHOR_DATE: futureDate },
      }
    );

    // Commit 2 with "past" date (but chronologically after commit 1 in DAG)
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // -1 day
    fs.writeFileSync(path.join(repo, "commit-2.txt"), "2\n");
    git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "past commit"],
      {
        cwd: repo,
        stdio: "ignore",
        env: { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: pastDate, GIT_AUTHOR_DATE: pastDate },
      }
    );

    const result = await detectTrunkDrift(repo);
    assert.equal(result.commits.length, 2);
    // Should be in DAG order (newest first), not date order
    assert.equal(result.commits[0].subject, "past commit");
    assert.equal(result.commits[1].subject, "future commit");
  });

  it("8a: not a repo — returns skipped not_a_repo", async () => {
    const notARepo = path.join(tmpDir, "8a-not-a-repo");
    fs.mkdirSync(notARepo, { recursive: true });

    const result = await detectTrunkDrift(notARepo);
    assert.equal(result.skipped, "not_a_repo");
    assert.ok(result.repoPath);
  });

  it("8b: empty repo (git init only) — returns skipped no_commits", async () => {
    const empty = path.join(tmpDir, "8b-empty");
    fs.mkdirSync(empty, { recursive: true });
    execFileSync("git", ["init", empty], {
      stdio: "ignore",
      env: ISOLATED_GIT_ENV,
    });

    const result = await detectTrunkDrift(empty);
    assert.equal(result.skipped, "no_commits");
  });

  it("8c: detached HEAD — resolves normally when a default branch still exists (skipped: null)", async () => {
    // Detached HEAD is a property of the *current worktree's* checkout, not
    // of what refs/heads/<branch> points to — the "master" branch ref is
    // untouched by `git checkout <sha>`. resolveDefaultBranch must not
    // mistake "the caller's checkout is detached" for "no default branch";
    // per qa/supporting/unit-tests.md's own case 8c row, the detector
    // should resolve `master` normally here.
    const repo = makeWorkingRepo(tmpDir, "8c-repo");
    const sha = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["checkout", "-q", sha]);

    const result = await detectTrunkDrift(repo);
    assert.equal(result.skipped, null);
    assert.equal(result.defaultBranch, "master");
  });

  it("8d: bare repo — returns skipped", async () => {
    const bare = makeBareRemote(tmpDir, "8d-bare");

    const result = await detectTrunkDrift(bare);
    assert.ok(result.skipped);
  });

  it("8e: corrupted repo (objects deleted) — returns skipped git_error, never throws", async () => {
    const corrupt = makeCorruptRepo(tmpDir, "8e-corrupt");

    const result = await detectTrunkDrift(corrupt);
    assert.equal(result.skipped, "git_error");
    assert.ok(result.repoPath);
  });
});

describe("Structural checks", () => {
  it("no classification vocabulary (fold_in, new_item, deliberate, discard)", () => {
    const src = fs.readFileSync(require.resolve("../lib/trunk-drift"), "utf8");
    assert.doesNotMatch(src, /\bfold_in\b|\bnew_item\b|\bdeliberate\b|\bdiscard\b/);
  });

  it("no SQLite requires", () => {
    const src = fs.readFileSync(require.resolve("../lib/trunk-drift"), "utf8");
    assert.doesNotMatch(
      src,
      /require\s*\(\s*["']\.\.?\/db["']\s*\)|require\s*\(\s*["']better-sqlite3["']/
    );
  });
});
