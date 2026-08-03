/**
 * @file Tests for server/lib/git-refs.js — the shared git-derivation module
 * extracted from update-check.js, serving both update-check and trunk-drift.
 * Single-home structural guard (§9.7), direct resolveDefaultBranch cases,
 * and behavior-preservation proof for update-check.js refactor.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { assertSingleHome } = require("./helpers/single-home");
const { resolveDefaultBranch } = require("../lib/git-refs");
const { isGitRepo } = require("../lib/repo-topology");

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

function makeWorkingRepo(parent, name) {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["-c", "init.defaultBranch=master", "init", repo], {
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]);
  return repo;
}

function setRemoteHead(repo, remoteName, branchName) {
  // git symbolic-ref refs/remotes/<remote>/HEAD refs/remotes/<remote>/<branch>
  git(repo, [
    "symbolic-ref",
    `refs/remotes/${remoteName}/HEAD`,
    `refs/remotes/${remoteName}/${branchName}`,
  ]);
}

let tmpDir;

before(() => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gitrefs-")));
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("§1 Single-home structural guard (G1 + G2)", () => {
  it("every git-refs.js export has an explicit disposition at every consumer (§9.7)", () => {
    assertSingleHome("../lib/git-refs", {
      "../lib/update-check": {
        shared: ["listRemotes", "pickCanonicalRemote", "REMOTE_PRIORITY"],
        private: ["execGit"],
        absent: ["resolveDefaultBranch"],
      },
      "../lib/trunk-drift": {
        shared: ["execGit", "resolveDefaultBranch"],
        absent: ["listRemotes", "pickCanonicalRemote", "REMOTE_PRIORITY"],
      },
    });
  });

  it("update-check.js does NOT import the shared execGit — its private 120s-default copy stays local", () => {
    const updateCheckSrc = fs.readFileSync(require.resolve("../lib/update-check"), "utf8");
    assert.doesNotMatch(
      updateCheckSrc,
      /\{[^}]*\bexecGit\b[^}]*\}\s*=\s*require\(["']\.\s*\/git-refs["']\)/s
    );
  });

  it("update-check.js's git fetch call site keeps its explicit 120_000 timeout (the value production actually reads)", () => {
    const updateCheckSrc = fs.readFileSync(require.resolve("../lib/update-check"), "utf8");
    assert.match(updateCheckSrc, /"fetch"[\s\S]{0,160}timeout:\s*120_000/);
  });

  it("trunk-drift.js performs no fetch-shaped git operation and never calls execGit with an implicit timeout", () => {
    const trunkDriftSrc = fs.readFileSync(require.resolve("../lib/trunk-drift"), "utf8");
    assert.doesNotMatch(trunkDriftSrc, /["']fetch["']/);
    assert.doesNotMatch(trunkDriftSrc, /allowFetch\s*:\s*true/);

    // Every execGit( call must carry an explicit `timeout` (either
    // `timeout: <value>` or the `{ timeout }` shorthand actually used in
    // this source). Each call's argument list is bounded to its OWN
    // matching closing paren — not "to end of file" — so a later call's
    // (or a trailing comment's) unrelated "timeout" text can't vacuously
    // satisfy an earlier call that's missing one.
    let searchFrom = 0;
    let callCount = 0;
    for (;;) {
      const openIdx = trunkDriftSrc.indexOf("execGit(", searchFrom);
      if (openIdx === -1) break;
      const argsStart = openIdx + "execGit(".length;
      let depth = 1;
      let i = argsStart;
      while (i < trunkDriftSrc.length && depth > 0) {
        if (trunkDriftSrc[i] === "(") depth++;
        else if (trunkDriftSrc[i] === ")") depth--;
        i++;
      }
      const segment = trunkDriftSrc.slice(argsStart, i - 1);
      assert.match(
        segment,
        /\btimeout\b/,
        `execGit call must have an explicit timeout: ${segment.substring(0, 120)}`
      );
      callCount++;
      searchFrom = i;
    }
    assert.ok(callCount > 0, "expected at least one execGit( call in trunk-drift.js to check");
  });

  it("no Phase-1a caller enables fetch", () => {
    const trunkDriftSrc = fs.readFileSync(require.resolve("../lib/trunk-drift"), "utf8");
    const projectsSrc = fs.readFileSync(require.resolve("../routes/projects"), "utf8");

    assert.doesNotMatch(trunkDriftSrc, /allowFetch\s*:\s*true/);
    assert.doesNotMatch(projectsSrc, /allowFetch\s*:\s*true/);
  });
});

describe("§2 resolveDefaultBranch direct cases", () => {
  it("trunk named 'main', bare 'origin' with HEAD -> refs/heads/main (remote_head via)", () => {
    const bare = makeBareRemote(tmpDir, "origin-main");
    const repo = makeWorkingRepo(tmpDir, "resolve-1a");
    git(repo, ["branch", "-m", "master", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "main"]);

    setRemoteHead(repo, "origin", "main");

    return resolveDefaultBranch(repo).then((result) => {
      assert.equal(result.branch, "main");
      assert.equal(result.via, "remote_head");
    });
  });

  it("trunk named 'master', same setup (remote_head via)", () => {
    const bare = makeBareRemote(tmpDir, "origin-master");
    const repo = makeWorkingRepo(tmpDir, "resolve-1b");
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "master"]);

    setRemoteHead(repo, "origin", "master");

    return resolveDefaultBranch(repo).then((result) => {
      assert.equal(result.branch, "master");
      assert.equal(result.via, "remote_head");
    });
  });

  it("trunk named 'trunk' (nonstandard), same setup — proves no hardcoded main/master guess", () => {
    const bare = makeBareRemote(tmpDir, "origin-trunk");
    const repo = makeWorkingRepo(tmpDir, "resolve-1c");
    git(repo, ["branch", "-m", "master", "trunk"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "trunk"]);

    setRemoteHead(repo, "origin", "trunk");

    return resolveDefaultBranch(repo).then((result) => {
      assert.equal(result.branch, "trunk");
      assert.equal(result.via, "remote_head");
    });
  });

  it("no remote at all, single local branch named 'trunk' — sole_local_branch via", () => {
    const repo = makeWorkingRepo(tmpDir, "resolve-2");
    git(repo, ["branch", "-m", "master", "trunk"]);

    return resolveDefaultBranch(repo).then((result) => {
      assert.equal(result.branch, "trunk");
      assert.equal(result.via, "sole_local_branch");
    });
  });

  it("no remote, local 'main' and a feature branch — resolves to 'main' via local_ref", () => {
    const repo = makeWorkingRepo(tmpDir, "resolve-2b");
    git(repo, ["branch", "-m", "master", "main"]);
    git(repo, ["branch", "feature"]);

    return resolveDefaultBranch(repo).then((result) => {
      assert.equal(result.branch, "main");
      assert.equal(result.via, "local_ref");
    });
  });

  it("no remote, branches 'feat-a' + 'feat-b', neither main/master — returns null (never guesses)", () => {
    const repo = makeWorkingRepo(tmpDir, "resolve-2c");
    git(repo, ["branch", "-m", "master", "feat-a"]);
    git(repo, ["branch", "feat-b"]);

    return resolveDefaultBranch(repo).then((result) => {
      assert.equal(result.branch, null);
      assert.equal(result.via, null);
    });
  });
});

describe("§3 Behavior preservation", () => {
  it("update-check.test.js passes unmodified (git diff --stat HEAD empty)", () => {
    // Real check, not a bare "always-true" placeholder assertion (§9.3
    // VACUOUS-GUARD bans that pattern): diff the actual spec file against
    // the starting commit (this worktree's HEAD, since nothing has been
    // committed on this branch yet) and assert it is byte-for-byte
    // unedited. `node --test server/__tests__/update-check.test.js` staying
    // green is verified separately, as its own spec run.
    //
    // IMPORTANT: this must compare against HEAD, not the bare (no-ref)
    // form of `git diff --stat`, which compares the worktree against the
    // INDEX. Once this file is `git add`-ed (e.g. at this build's own
    // eventual commit), a ref-less diff would go permanently green
    // regardless of any future edit to update-check.test.js.
    const repoRoot = path.resolve(__dirname, "..", "..");
    const diffStat = execFileSync(
      "git",
      ["diff", "--stat", "HEAD", "--", "server/__tests__/update-check.test.js"],
      { cwd: repoRoot, encoding: "utf8" }
    ).trim();
    assert.equal(
      diffStat,
      "",
      `server/__tests__/update-check.test.js must be unedited by the git-refs.js extraction; git diff --stat: ${diffStat}`
    );
  });
});
