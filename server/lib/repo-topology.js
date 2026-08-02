/**
 * @file Derives a project's repo/worktree topology on demand for the Project
 * Detail page: which of a project's mapped folders (`project_paths`) are
 * actual git repos, what worktrees each one has (live `git worktree list`),
 * and which sibling repos a repo's own PROJECT-CONTEXT.md names that aren't
 * mapped to the project yet (surfaced as suggestions only — never added
 * automatically). Nothing here is persisted; every call recomputes live,
 * matching this project's precedent for cheap filesystem/git derivations
 * (see server/lib/update-check.js) rather than caching computed output in
 * SQLite.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { isolatedGitEnv } = require("./git-env");

// Hard ceiling on `git status` dirty-checks per request (one extra git
// subprocess each) so a project with an unusually large number of worktrees
// can't turn one page load into dozens of blocking git calls.
const MAX_DIRTY_CHECKS_PER_REQUEST = 25;

function execGit(cwd, args, opts = {}) {
  const timeout = opts.timeout ?? 10_000;
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout, maxBuffer: 2_000_000, encoding: "utf8", env: isolatedGitEnv() },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout));
      }
    );
  });
}

function isGitRepo(dirPath) {
  try {
    return fs.existsSync(path.join(dirPath, ".git"));
  } catch {
    return false;
  }
}

// Parses `git worktree list --porcelain` output into one entry per
// blank-line-separated block. Field lines are order-independent per git's
// own porcelain format, so this reads each block line-by-line rather than
// assuming a fixed line order.
function parseWorktreePorcelain(output) {
  const blocks = output
    .split(/\r?\n\r?\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const entry = {
        path: null,
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
      };
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length).trim();
        else if (line.startsWith("HEAD ")) entry.head = line.slice("HEAD ".length).trim();
        else if (line.startsWith("branch ")) entry.branch = line.slice("branch ".length).trim();
        else if (line === "bare") entry.bare = true;
        else if (line === "detached") entry.detached = true;
        else if (line.startsWith("locked")) entry.locked = true;
        else if (line.startsWith("prunable")) entry.prunable = true;
      }
      return entry;
    })
    .filter((entry) => entry.path);
}

async function listGitWorktrees(repoPath, opts = {}) {
  const out = await execGit(repoPath, ["worktree", "list", "--porcelain"], opts);
  return parseWorktreePorcelain(out);
}

// Returns true/false, or null when dirtiness genuinely couldn't be
// determined (missing worktree dir, timeout, git error) — callers must
// render that as "unknown", never fall back to a false "clean".
async function checkWorktreeDirty(worktreePath, opts = {}) {
  try {
    const out = await execGit(
      worktreePath,
      ["status", "--porcelain", "--ignore-submodules", "-uno"],
      { timeout: opts.timeout ?? 5_000 }
    );
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

// Best-effort: PROJECT-CONTEXT.md has no formal schema today (see the
// `worktree` skill), so this looks for a "## Repo topology" heading (any
// level, case-insensitive) and pulls bold-faced repo names out of its bullet
// list, matching this repo's own PROJECT-CONTEXT.md format
// (`- **Name** — description`). Stops collecting once a heading of the same
// or shallower level ends the section.
function extractRepoTopologyNames(markdown) {
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  let sectionLevel = null;
  const names = [];

  for (const line of lines) {
    const heading = line.match(/^(#+)\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      if (inSection && level <= sectionLevel) inSection = false;
      if (heading[2].trim().toLowerCase() === "repo topology") {
        inSection = true;
        sectionLevel = level;
      }
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*-\s+\*\*([^*]+)\*\*/);
    if (bullet) names.push(bullet[1].trim());
  }

  return names;
}

function findDetectedSiblings(repoPath, mappedCwds) {
  const contextPath = path.join(repoPath, "PROJECT-CONTEXT.md");
  if (!fs.existsSync(contextPath)) return [];

  let content;
  try {
    content = fs.readFileSync(contextPath, "utf8");
  } catch {
    return [];
  }

  const resolvedRepoPath = path.resolve(repoPath);
  const mappedSet = new Set(mappedCwds.map((c) => path.resolve(c)));
  const parentDir = path.dirname(repoPath);
  const seen = new Set();
  const siblings = [];

  for (const name of extractRepoTopologyNames(content)) {
    const candidatePath = path.resolve(parentDir, name);
    if (candidatePath === resolvedRepoPath) continue;
    if (mappedSet.has(candidatePath)) continue;
    if (seen.has(candidatePath)) continue;
    if (!fs.existsSync(candidatePath) || !isGitRepo(candidatePath)) continue;
    seen.add(candidatePath);
    siblings.push({ name, path: candidatePath, sourceRepoCwd: repoPath });
  }

  return siblings;
}

/**
 * Builds the full repo/worktree topology for a project: which mapped
 * folders are repos (with their live worktrees), which aren't, and which
 * sibling repos were detected but aren't mapped yet.
 * @param {object} dbModule - the server/db module ({ stmts }).
 * @param {{ id: string }} project
 */
async function buildProjectRepoTopology(dbModule, project) {
  const paths = dbModule.stmts.listProjectPaths.all(project.id);
  const mappedCwds = paths.map((p) => p.cwd);

  const repos = [];
  const nonRepoFolders = [];
  const detectedSiblingsByPath = new Map();
  let dirtyChecksRemaining = MAX_DIRTY_CHECKS_PER_REQUEST;

  for (const p of paths) {
    if (!isGitRepo(p.cwd)) {
      nonRepoFolders.push({ cwd: p.cwd, pathId: p.id });
      continue;
    }

    let worktrees = [];
    try {
      worktrees = await listGitWorktrees(p.cwd);
    } catch {
      worktrees = [];
    }

    for (const wt of worktrees) {
      if (dirtyChecksRemaining <= 0) {
        wt.dirty = null;
        continue;
      }
      dirtyChecksRemaining -= 1;
      wt.dirty = await checkWorktreeDirty(wt.path);
    }

    repos.push({ cwd: p.cwd, pathId: p.id, worktrees });

    for (const sibling of findDetectedSiblings(p.cwd, mappedCwds)) {
      if (!detectedSiblingsByPath.has(sibling.path)) {
        detectedSiblingsByPath.set(sibling.path, sibling);
      }
    }
  }

  return {
    repos,
    nonRepoFolders,
    detectedSiblings: [...detectedSiblingsByPath.values()],
  };
}

module.exports = {
  isGitRepo,
  listGitWorktrees,
  checkWorktreeDirty,
  findDetectedSiblings,
  buildProjectRepoTopology,
  parseWorktreePorcelain,
  extractRepoTopologyNames,
};
