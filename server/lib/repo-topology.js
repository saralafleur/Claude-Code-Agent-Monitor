/**
 * @file Derives a project's repo/worktree topology on demand for the Project
 * Detail page: which of a project's mapped folders (`project_paths`) are
 * actual git repos, what worktrees each one has (live `git worktree list`),
 * and which related repos aren't mapped to the project yet (surfaced as
 * suggestions only — never added automatically). Detection combines three
 * sources, each tagging its finds with a `source` so the UI can show how a
 * suggestion was found: (1) a repo's own PROJECT-CONTEXT.md "Repo topology"
 * bullet list (`source: "context"`), (2) a bounded scan of the repo's own
 * parent directory for other git repos sitting next to it on disk
 * (`source: "disk-sibling"`), and (3) a bounded, depth-capped walk of a
 * mapped folder's own subfolders for nested git repos such as submodules,
 * vendored checkouts, or unrelated checkouts sitting inside a plain
 * "workspace" folder (`source: "disk-nested"`) — this one stops descending
 * as soon as it finds a nested repo, so it never double-reports
 * repos-within-repos, and it's the one source that also runs against a
 * mapped folder that ISN'T itself a git repo (source (1) and (2) only make
 * sense relative to an actual repo). Every one of a mapped repo's OWN
 * worktrees (which can live at an arbitrary, "physically different" path —
 * that's the whole point of `git worktree add`) is excluded from all three
 * sources, so a worktree of a repo you've already added is never mistaken
 * for a brand-new repo to suggest. Suggestions the project has explicitly
 * dismissed (`project_ignored_repos`, written via the ignore/unignore routes
 * in server/routes/projects.js) are filtered out of every call until
 * un-ignored. Every mapped folder returned in `repos`/`nonRepoFolders` also
 * carries its own `terminalDefault` flag (`project_paths.terminal_default`,
 * default on) — whether this folder is offered as a choice in the "open a
 * new Claude terminal" pickers (OpenTerminalModal's folder step), toggled
 * per-folder via PATCH `/:id/paths/:pathId` in server/routes/projects.js.
 * Source (2), the parent-directory disk-sibling scan, only runs
 * when the project has opted in via its `sibling_scan_enabled` column
 * (default off, toggled via PATCH `siblingScanEnabled` in
 * server/routes/projects.js) — in a flat workspace folder holding many
 * unrelated repos it otherwise suggests every one of them regardless of
 * relatedness. Sources (1) and (3) are unaffected and always run. Nothing
 * else here is persisted; every call recomputes live, matching this
 * project's precedent for cheap filesystem/git derivations (see
 * server/lib/update-check.js) rather than caching computed output in
 * SQLite.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { isolatedGitEnv } = require("./git-env");

// Hard ceiling on `git status` dirty-checks per request (one extra git
// subprocess each) so a project with an unusually large number of worktrees
// can't turn one page load into dozens of blocking git calls.
const MAX_DIRTY_CHECKS_PER_REQUEST = 25;

// Directory names never worth descending into during the disk-based sibling
// or nested-repo scans: dependency/build/cache output that's either huge
// (node_modules), never itself a separate repo worth suggesting, or already
// handled as the ".git" case itself.
const DISK_SCAN_EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "out",
  "target",
  "vendor",
  "bower_components",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".turbo",
  ".parcel-cache",
]);

// Bounds for the disk-based scans, mirroring MAX_DIRTY_CHECKS_PER_REQUEST's
// role: these are heuristic, best-effort scans over a live filesystem, not
// a guaranteed-complete index, so a pathologically large or deep tree must
// degrade to "found what we found so far" rather than block the request.
const MAX_SIBLING_SCAN_ENTRIES = 200;
const MAX_NESTED_SCAN_DIRS_PER_REPO = 2000;
const NESTED_SCAN_MAX_DEPTH = 4;

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
    siblings.push({ name, path: candidatePath, sourceRepoCwd: repoPath, source: "context" });
  }

  return siblings;
}

// Live disk scan: lists the repo's own parent directory (one level, not
// recursive) and flags any other entry that's itself a git repo — catches
// repos that plausibly belong together (same parent folder) but were never
// written down in PROJECT-CONTEXT.md. Bounded by MAX_SIBLING_SCAN_ENTRIES so
// a parent directory with hundreds of unrelated entries can't turn one
// request into hundreds of `.git` existence checks.
async function findSiblingReposOnDisk(repoPath, mappedCwds) {
  const resolvedRepoPath = path.resolve(repoPath);
  const parentDir = path.dirname(resolvedRepoPath);
  const mappedSet = new Set(mappedCwds.map((c) => path.resolve(c)));

  let entries;
  try {
    entries = await fsp.readdir(parentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const siblings = [];
  for (const entry of entries.slice(0, MAX_SIBLING_SCAN_ENTRIES)) {
    if (!entry.isDirectory()) continue;
    const candidatePath = path.resolve(parentDir, entry.name);
    if (candidatePath === resolvedRepoPath) continue;
    if (mappedSet.has(candidatePath)) continue;
    if (!isGitRepo(candidatePath)) continue;
    siblings.push({
      name: entry.name,
      path: candidatePath,
      sourceRepoCwd: repoPath,
      source: "disk-sibling",
    });
  }

  return siblings;
}

// Live disk scan: walks the given folder's OWN subfolders (not its parent)
// looking for nested git repos — submodules, vendored checkouts, or a plain
// non-repo "workspace" folder's unrelated child checkouts, or any other repo
// living inside this folder's tree that isn't one of `git worktree list`'s
// own entries. `folderPath` need not be a git repo itself — this is the one
// detection source that also runs against a mapped folder that ISN'T a repo
// (see buildProjectRepoTopology), since "does this folder contain repos" is
// a question that makes sense either way. Depth-capped (NESTED_SCAN_MAX_DEPTH)
// and entry-capped (MAX_NESTED_SCAN_DIRS_PER_REPO) for the same reason as the
// sibling scan; stops descending the moment it finds a nested repo so it
// never reports a repo-within-a-repo-within-a-repo, and skips well-known
// dependency/build/cache directories that are never themselves a separate
// project worth suggesting.
async function findNestedReposOnDisk(folderPath, mappedCwds) {
  const resolvedFolderPath = path.resolve(folderPath);
  const mappedSet = new Set(mappedCwds.map((c) => path.resolve(c)));
  const nested = [];
  let dirsScanned = 0;

  async function walk(dir, depth) {
    if (depth > NESTED_SCAN_MAX_DEPTH || dirsScanned >= MAX_NESTED_SCAN_DIRS_PER_REPO) return;

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (dirsScanned >= MAX_NESTED_SCAN_DIRS_PER_REPO) return;
      if (!entry.isDirectory()) continue;
      if (DISK_SCAN_EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      dirsScanned += 1;

      const childPath = path.resolve(dir, entry.name);
      if (isGitRepo(childPath)) {
        if (childPath !== resolvedFolderPath && !mappedSet.has(childPath)) {
          nested.push({
            name: entry.name,
            path: childPath,
            sourceRepoCwd: folderPath,
            source: "disk-nested",
          });
        }
        continue;
      }
      await walk(childPath, depth + 1);
    }
  }

  await walk(resolvedFolderPath, 1);
  return nested;
}

/**
 * Builds the full repo/worktree topology for a project: which mapped
 * folders are repos (with their live worktrees), which aren't, and which
 * related repos were detected but aren't mapped yet — including git repos
 * nested inside a mapped folder that isn't itself a repo (e.g. a plain
 * "workspace" directory holding several unrelated checkouts) — minus
 * whatever the project has explicitly ignored (`project_ignored_repos`).
 *
 * Runs in two passes. Pass 1 classifies each mapped folder as a repo or not
 * and, for repos, lists their live worktrees. Pass 2 runs the detection
 * sources using an exclusion set that includes not just the mapped cwds but
 * every worktree path gathered in pass 1 — a linked git worktree IS the same
 * repo, just checked out at a second, often "physically different" location
 * on disk, and without this a worktree belonging to an already-mapped repo
 * could otherwise wander into another mapped folder's sibling/nested scan
 * and get wrongly suggested as if it were a brand-new, unrelated repo.
 * `findSiblingReposOnDisk` (source 2, the parent-directory scan) only runs
 * when the project has opted in via `sibling_scan_enabled` (default off) —
 * in a flat workspace folder holding many unrelated repos it otherwise
 * suggests every one of them. `findDetectedSiblings` (PROJECT-CONTEXT.md-
 * declared) and `findNestedReposOnDisk` (children nested inside a mapped
 * folder) are unaffected and always run.
 * @param {object} dbModule - the server/db module ({ stmts }).
 * @param {{ id: string, sibling_scan_enabled?: number }} project
 */
async function buildProjectRepoTopology(dbModule, project) {
  const siblingScanEnabled = !!project.sibling_scan_enabled;
  const paths = dbModule.stmts.listProjectPaths.all(project.id);
  const mappedCwds = paths.map((p) => p.cwd);
  const ignoredRows = dbModule.stmts.listIgnoredRepos.all(project.id);
  const ignoredPaths = new Set(ignoredRows.map((r) => path.resolve(r.path)));

  const repos = [];
  const nonRepoFolders = [];
  let dirtyChecksRemaining = MAX_DIRTY_CHECKS_PER_REQUEST;

  // Pass 1: classify + gather every mapped repo's live worktrees up front.
  for (const p of paths) {
    if (!isGitRepo(p.cwd)) {
      nonRepoFolders.push({ cwd: p.cwd, pathId: p.id, terminalDefault: !!p.terminal_default });
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

    repos.push({ cwd: p.cwd, pathId: p.id, worktrees, terminalDefault: !!p.terminal_default });
  }

  const excludedPaths = [...mappedCwds, ...repos.flatMap((r) => r.worktrees.map((w) => w.path))];

  // Pass 2: run detection now that every already-known repo/worktree path is
  // known, so none of them can be mistaken for a new suggestion.
  const detectedSiblingsByPath = new Map();

  for (const p of paths) {
    if (!isGitRepo(p.cwd)) {
      // Not a repo itself, but a mapped folder can still be a plain
      // container — a "workspace" directory holding several unrelated
      // checkouts, for example — that has real git repos nested somewhere
      // inside it. Scan for those the same bounded, depth-capped way as a
      // repo's own subfolders; skip the context/disk-sibling sources since
      // those are specifically about repos related to ANOTHER repo, which
      // doesn't apply when this folder isn't one.
      for (const nested of await findNestedReposOnDisk(p.cwd, excludedPaths)) {
        if (!detectedSiblingsByPath.has(nested.path)) {
          detectedSiblingsByPath.set(nested.path, nested);
        }
      }
      continue;
    }

    // Merge all three detection sources — first writer wins per path (the
    // PROJECT-CONTEXT.md-named source, since it carries a human-chosen
    // rationale/name over a raw directory-listing guess), deduped by
    // resolved path since the same repo can plausibly be found more than
    // one way (e.g. named in PROJECT-CONTEXT.md AND sitting as a sibling).
    const found = [
      ...findDetectedSiblings(p.cwd, excludedPaths),
      ...(siblingScanEnabled ? await findSiblingReposOnDisk(p.cwd, excludedPaths) : []),
      ...(await findNestedReposOnDisk(p.cwd, excludedPaths)),
    ];
    for (const sibling of found) {
      if (!detectedSiblingsByPath.has(sibling.path)) {
        detectedSiblingsByPath.set(sibling.path, sibling);
      }
    }
  }

  const detectedSiblings = [...detectedSiblingsByPath.values()].filter(
    (s) => !ignoredPaths.has(path.resolve(s.path))
  );

  return {
    repos,
    nonRepoFolders,
    detectedSiblings,
    ignoredRepos: ignoredRows.map((r) => ({
      id: r.id,
      path: r.path,
      name: r.name,
      source: r.source,
      ignoredAt: r.ignored_at,
    })),
  };
}

module.exports = {
  isGitRepo,
  listGitWorktrees,
  checkWorktreeDirty,
  findDetectedSiblings,
  findSiblingReposOnDisk,
  findNestedReposOnDisk,
  buildProjectRepoTopology,
  parseWorktreePorcelain,
  extractRepoTopologyNames,
  DISK_SCAN_EXCLUDED_DIR_NAMES,
};
