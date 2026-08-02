/**
 * @file Tests for server/lib/repo-topology.js against real throwaway git
 * repos and worktrees in a tmp dir — not mocked child_process — matching
 * this project's established real-git-fixture test pattern (see
 * update-check.test.js).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  isGitRepo,
  listGitWorktrees,
  checkWorktreeDirty,
  findDetectedSiblings,
  buildProjectRepoTopology,
} = require("../lib/repo-topology");

// See update-check.test.js for why this stripping is required: ambient
// GIT_DIR/GIT_WORK_TREE from hooks would otherwise redirect these fixture
// git calls at the real repo this suite runs inside.
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

function makeRepo(parent, name) {
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

let tmpDir;

before(() => {
  // realpathSync: on macOS os.tmpdir() resolves through a /tmp -> /private/tmp
  // symlink; `git worktree list` reports the resolved path, so comparing
  // against an unresolved fixture path would spuriously fail.
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "repotopo-")));
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("isGitRepo", () => {
  it("true for a real git repo, false for a plain folder", () => {
    const repo = makeRepo(tmpDir, "isgit-repo");
    const plain = path.join(tmpDir, "isgit-plain");
    fs.mkdirSync(plain, { recursive: true });

    assert.equal(isGitRepo(repo), true);
    assert.equal(isGitRepo(plain), false);
  });
});

describe("listGitWorktrees", () => {
  it("lists the main worktree plus an added linked worktree", () => {
    const repo = makeRepo(tmpDir, "wt-repo");
    git(repo, ["branch", "feature"]);
    const linkedPath = path.join(tmpDir, "wt-repo-linked");
    git(repo, ["worktree", "add", linkedPath, "feature"]);

    return listGitWorktrees(repo).then((worktrees) => {
      assert.equal(worktrees.length, 2);
      const main = worktrees.find((w) => w.path === repo);
      const linked = worktrees.find((w) => w.path === linkedPath);
      assert.ok(main, "expected the main worktree entry");
      assert.ok(linked, "expected the linked worktree entry");
      assert.equal(main.branch, "refs/heads/master");
      assert.equal(linked.branch, "refs/heads/feature");
      assert.ok(main.head);
      assert.equal(main.detached, false);
    });
  });
});

describe("checkWorktreeDirty", () => {
  it("false for a clean worktree, true after an untracked-ignoring modification, null for a missing path", async () => {
    const repo = makeRepo(tmpDir, "dirty-repo");
    assert.equal(await checkWorktreeDirty(repo), false);

    fs.writeFileSync(path.join(repo, "README.md"), "changed\n");
    assert.equal(await checkWorktreeDirty(repo), true);

    assert.equal(await checkWorktreeDirty(path.join(tmpDir, "does-not-exist")), null);
  });
});

describe("findDetectedSiblings", () => {
  it("finds a bolded sibling repo not already mapped, skips non-repos and already-mapped ones", () => {
    const parent = path.join(tmpDir, "siblings-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeRepo(parent, "main-repo");
    const sibling = makeRepo(parent, "sibling-repo");
    const notARepo = path.join(parent, "not-a-repo");
    fs.mkdirSync(notARepo, { recursive: true });
    const alreadyMapped = makeRepo(parent, "already-mapped-repo");

    fs.writeFileSync(
      path.join(main, "PROJECT-CONTEXT.md"),
      [
        "# Project Context",
        "",
        "## Repo topology",
        "",
        "- **main-repo** (this repo) — the entry point.",
        "- **sibling-repo** — a related service.",
        "- **not-a-repo** — not actually a git repo.",
        "- **already-mapped-repo** — already mapped to the project.",
        "- **missing-repo** — does not exist on disk.",
        "",
        "## Some other section",
        "",
        "- **should-not-be-picked-up** — outside the repo topology section.",
        "",
      ].join("\n")
    );

    const found = findDetectedSiblings(main, [main, alreadyMapped]);

    assert.equal(found.length, 1);
    assert.equal(found[0].name, "sibling-repo");
    assert.equal(found[0].path, sibling);
    assert.equal(found[0].sourceRepoCwd, main);
  });

  it("returns an empty array when PROJECT-CONTEXT.md is absent", () => {
    const repo = makeRepo(tmpDir, "no-context-repo");
    assert.deepEqual(findDetectedSiblings(repo, [repo]), []);
  });
});

describe("buildProjectRepoTopology", () => {
  it("separates repos from non-repo folders and surfaces detected siblings", async () => {
    const parent = path.join(tmpDir, "build-topology-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeRepo(parent, "build-main");
    const sibling = makeRepo(parent, "build-sibling");
    const plainFolder = path.join(parent, "build-plain-folder");
    fs.mkdirSync(plainFolder, { recursive: true });

    fs.writeFileSync(
      path.join(main, "PROJECT-CONTEXT.md"),
      ["## Repo topology", "", "- **build-sibling** — a related repo.", ""].join("\n")
    );

    const project = { id: "proj-1" };
    const dbModule = {
      stmts: {
        listProjectPaths: {
          all: () => [
            { id: 1, project_id: "proj-1", cwd: main },
            { id: 2, project_id: "proj-1", cwd: plainFolder },
          ],
        },
      },
    };

    const topology = await buildProjectRepoTopology(dbModule, project);

    assert.equal(topology.repos.length, 1);
    assert.equal(topology.repos[0].cwd, main);
    assert.equal(topology.repos[0].worktrees.length, 1);
    assert.equal(topology.repos[0].worktrees[0].dirty, false);

    assert.equal(topology.nonRepoFolders.length, 1);
    assert.equal(topology.nonRepoFolders[0].cwd, plainFolder);

    assert.equal(topology.detectedSiblings.length, 1);
    assert.equal(topology.detectedSiblings[0].path, sibling);
  });
});
