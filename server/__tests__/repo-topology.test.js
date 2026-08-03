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
  findSiblingReposOnDisk,
  findNestedReposOnDisk,
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

// Minimal fake of the { stmts } shape buildProjectRepoTopology reads from -
// just the two statements it calls, not the real server/db.js.
function makeDbModule(projectPaths, ignoredRepos = []) {
  return {
    stmts: {
      listProjectPaths: { all: () => projectPaths },
      listIgnoredRepos: { all: () => ignoredRepos },
    },
  };
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
    assert.equal(found[0].source, "context");
  });

  it("returns an empty array when PROJECT-CONTEXT.md is absent", () => {
    const repo = makeRepo(tmpDir, "no-context-repo");
    assert.deepEqual(findDetectedSiblings(repo, [repo]), []);
  });
});

describe("findSiblingReposOnDisk", () => {
  it("finds a git repo sitting next to the given repo, without any PROJECT-CONTEXT.md", async () => {
    const parent = path.join(tmpDir, "disk-siblings-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeRepo(parent, "disk-main");
    const sibling = makeRepo(parent, "disk-sibling");
    const notARepo = path.join(parent, "disk-not-a-repo");
    fs.mkdirSync(notARepo, { recursive: true });
    const alreadyMapped = makeRepo(parent, "disk-already-mapped");

    const found = await findSiblingReposOnDisk(main, [main, alreadyMapped]);

    assert.equal(found.length, 1);
    assert.equal(found[0].name, "disk-sibling");
    assert.equal(found[0].path, sibling);
    assert.equal(found[0].sourceRepoCwd, main);
    assert.equal(found[0].source, "disk-sibling");
  });

  it("returns an empty array when the parent directory doesn't exist", async () => {
    const found = await findSiblingReposOnDisk(path.join(tmpDir, "does-not-exist", "repo"), []);
    assert.deepEqual(found, []);
  });
});

describe("findNestedReposOnDisk", () => {
  it("finds a git repo nested inside a subfolder, skipping excluded dirs and already-mapped ones", async () => {
    const main = makeRepo(tmpDir, "nested-main");
    fs.mkdirSync(path.join(main, "node_modules", "some-pkg"), { recursive: true });
    execFileSync(
      "git",
      ["-c", "init.defaultBranch=master", "init", path.join(main, "node_modules", "some-pkg")],
      { stdio: "ignore", env: ISOLATED_GIT_ENV }
    );
    fs.mkdirSync(path.join(main, "packages"), { recursive: true });
    const nested = makeRepo(path.join(main, "packages"), "nested-child");
    const alreadyMappedNested = makeRepo(path.join(main, "packages"), "already-mapped-nested");

    const found = await findNestedReposOnDisk(main, [main, alreadyMappedNested]);

    assert.equal(found.length, 1);
    assert.equal(found[0].name, "nested-child");
    assert.equal(found[0].path, nested);
    assert.equal(found[0].sourceRepoCwd, main);
    assert.equal(found[0].source, "disk-nested");
  });

  it("does not descend into a nested repo it already found", async () => {
    const main = makeRepo(tmpDir, "nested-stop-main");
    const nested = makeRepo(path.join(main, "sub"), "nested-repo");
    fs.mkdirSync(path.join(nested, "deeper"), { recursive: true });
    execFileSync("git", ["-c", "init.defaultBranch=master", "init", path.join(nested, "deeper")], {
      stdio: "ignore",
      env: ISOLATED_GIT_ENV,
    });

    const found = await findNestedReposOnDisk(main, [main]);

    assert.equal(found.length, 1);
    assert.equal(found[0].path, nested);
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
    const dbModule = makeDbModule([
      { id: 1, project_id: "proj-1", cwd: main, terminal_default: 1 },
      { id: 2, project_id: "proj-1", cwd: plainFolder, terminal_default: 0 },
    ]);

    const topology = await buildProjectRepoTopology(dbModule, project);

    assert.equal(topology.repos.length, 1);
    assert.equal(topology.repos[0].cwd, main);
    assert.equal(topology.repos[0].worktrees.length, 1);
    assert.equal(topology.repos[0].worktrees[0].dirty, false);
    assert.equal(topology.repos[0].terminalDefault, true);

    assert.equal(topology.nonRepoFolders.length, 1);
    assert.equal(topology.nonRepoFolders[0].cwd, plainFolder);
    assert.equal(topology.nonRepoFolders[0].terminalDefault, false);

    assert.equal(topology.detectedSiblings.length, 1);
    assert.equal(topology.detectedSiblings[0].path, sibling);
    // Named in PROJECT-CONTEXT.md AND sitting in the same parent dir - the
    // PROJECT-CONTEXT.md source should win the dedup, not the disk scan.
    assert.equal(topology.detectedSiblings[0].source, "context");
  });

  it("also surfaces disk-only siblings and nested repos with their own source tags when sibling_scan_enabled is on", async () => {
    const parent = path.join(tmpDir, "build-topology-disk-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeRepo(parent, "disk-build-main");
    const diskOnlySibling = makeRepo(parent, "disk-build-sibling");
    const nestedRepo = makeRepo(path.join(main, "packages"), "disk-build-nested");

    // The disk-sibling scan is opt-in (default off) - explicitly enable it
    // for this project to exercise that source.
    const project = { id: "proj-2", sibling_scan_enabled: 1 };
    const dbModule = makeDbModule([{ id: 1, project_id: "proj-2", cwd: main }]);

    const topology = await buildProjectRepoTopology(dbModule, project);
    const bySource = Object.fromEntries(topology.detectedSiblings.map((s) => [s.source, s]));

    assert.equal(topology.detectedSiblings.length, 2);
    assert.equal(bySource["disk-sibling"].path, diskOnlySibling);
    assert.equal(bySource["disk-nested"].path, nestedRepo);
  });

  it("skips the disk-sibling scan by default (sibling_scan_enabled off), leaving context and nested sources intact", async () => {
    const parent = path.join(tmpDir, "build-topology-scan-off-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeRepo(parent, "scan-off-main");
    makeRepo(parent, "scan-off-disk-sibling"); // never suggested with the flag off
    const nestedRepo = makeRepo(path.join(main, "packages"), "scan-off-nested");

    // No `sibling_scan_enabled` on the project row at all - mirrors a real
    // row read from SQLite before the project ever opts in.
    const project = { id: "proj-scan-off" };
    const dbModule = makeDbModule([{ id: 1, project_id: "proj-scan-off", cwd: main }]);

    const topology = await buildProjectRepoTopology(dbModule, project);
    const sources = topology.detectedSiblings.map((s) => s.source);

    assert.equal(topology.detectedSiblings.length, 1);
    assert.deepEqual(sources, ["disk-nested"]);
    assert.equal(topology.detectedSiblings[0].path, nestedRepo);

    // Same folder layout, flag explicitly on - the disk sibling now appears.
    const projectEnabled = { id: "proj-scan-off", sibling_scan_enabled: 1 };
    const topologyEnabled = await buildProjectRepoTopology(dbModule, projectEnabled);
    const sourcesEnabled = topologyEnabled.detectedSiblings.map((s) => s.source).sort();

    assert.deepEqual(sourcesEnabled, ["disk-nested", "disk-sibling"]);
  });

  it("still scans a mapped folder that isn't itself a git repo for repos nested inside it", async () => {
    const parent = path.join(tmpDir, "build-topology-nonrepo-parent");
    const workspace = path.join(parent, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    // Nested two levels deep - children of children, not just direct children.
    const childOfChild = makeRepo(path.join(workspace, "clients", "acme"), "acme-site");

    const project = { id: "proj-3" };
    const dbModule = makeDbModule([{ id: 1, project_id: "proj-3", cwd: workspace }]);

    const topology = await buildProjectRepoTopology(dbModule, project);

    assert.equal(topology.repos.length, 0);
    assert.equal(topology.nonRepoFolders.length, 1);
    assert.equal(topology.nonRepoFolders[0].cwd, workspace);

    assert.equal(topology.detectedSiblings.length, 1);
    assert.equal(topology.detectedSiblings[0].path, childOfChild);
    assert.equal(topology.detectedSiblings[0].source, "disk-nested");
    assert.equal(topology.detectedSiblings[0].sourceRepoCwd, workspace);
  });

  it("excludes a mapped repo's own worktrees from suggestions, even when one lives inside another mapped folder", async () => {
    const parent = path.join(tmpDir, "worktree-exclusion-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeRepo(parent, "wt-exclusion-main");
    git(main, ["branch", "effort"]);
    // A workspace folder is also mapped to the project, and the linked
    // worktree happens to live inside it - a "physically different
    // location" for the exact same repo, not a new one.
    const workspace = path.join(parent, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const worktreePath = path.join(workspace, "main-linked-worktree");
    git(main, ["worktree", "add", worktreePath, "effort"]);

    const project = { id: "proj-wt" };
    const dbModule = makeDbModule([
      { id: 1, project_id: "proj-wt", cwd: main },
      { id: 2, project_id: "proj-wt", cwd: workspace },
    ]);

    const topology = await buildProjectRepoTopology(dbModule, project);

    assert.equal(topology.repos.length, 1);
    assert.equal(topology.repos[0].worktrees.length, 2);
    assert.ok(topology.repos[0].worktrees.some((w) => w.path === worktreePath));

    // The linked worktree must never appear as a suggestion, even though the
    // workspace folder it physically lives inside gets scanned for nested
    // repos.
    assert.equal(
      topology.detectedSiblings.some((s) => s.path === worktreePath),
      false
    );
  });

  it("filters ignored suggestions out of detectedSiblings and returns them as ignoredRepos", async () => {
    const parent = path.join(tmpDir, "ignore-list-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeRepo(parent, "ignore-main");
    const sibling = makeRepo(parent, "ignore-sibling");

    const project = { id: "proj-ignore" };
    const ignoredRow = {
      id: 99,
      project_id: "proj-ignore",
      path: sibling,
      name: "ignore-sibling",
      source: "disk-sibling",
      ignored_at: "2026-01-01T00:00:00.000Z",
    };
    const dbModule = makeDbModule([{ id: 1, project_id: "proj-ignore", cwd: main }], [ignoredRow]);

    const topology = await buildProjectRepoTopology(dbModule, project);

    assert.equal(topology.detectedSiblings.length, 0);
    assert.equal(topology.ignoredRepos.length, 1);
    assert.equal(topology.ignoredRepos[0].id, 99);
    assert.equal(topology.ignoredRepos[0].path, sibling);
    assert.equal(topology.ignoredRepos[0].name, "ignore-sibling");
    assert.equal(topology.ignoredRepos[0].source, "disk-sibling");
    assert.equal(topology.ignoredRepos[0].ignoredAt, "2026-01-01T00:00:00.000Z");
  });
});
