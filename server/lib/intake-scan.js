/**
 * @file Derives team-intake initiative status for the Project Detail page by
 * scanning each project folder's `intake/<slug>/` directories for the
 * delivery-team pipeline's known artifact files (request-brief.md,
 * technical-plan.md, qa/qa-assessment.md, build/*\/build-report.md,
 * merge.json) and inferring a stage from which of them exist — no markdown
 * content parsing. A mapped folder's `intake/` directory isn't always at its
 * own root — some projects nest their app code (and `intake/`) a few levels
 * down (e.g. `<cwd>/app/intake`) — so `findIntakeDirs` walks each mapped
 * folder's subdirectories up to INTAKE_SCAN_MAX_DEPTH levels deep looking for
 * `intake/` directories, stopping descent the moment one is found in a given
 * branch (an intake dir's own contents are work-item slug folders, never
 * another intake dir worth walking into), skipping the same
 * dependency/build/cache directory names repo-topology.js's disk-nested-repo
 * scan already excludes, and capped at INTAKE_SCAN_MAX_DIRS_PER_CWD so a
 * pathologically large tree degrades to "found what we found so far" rather
 * than block the request — same bounding rationale as
 * MAX_NESTED_SCAN_DIRS_PER_REPO in repo-topology.js. Also cross-references
 * each slug against the repo's live `git worktree list` (matching the
 * `effort/<slug>` branch-naming convention every build-triage/wrap-up pass
 * uses) so the caller knows which worktree, if any, an initiative is
 * currently checked out in, and falls back to a `git log --grep` scan for a
 * "Merge effort/<slug>: ..." commit (the wrap-up skill's own merge-commit
 * convention) so an initiative that was actually merged doesn't keep reading
 * as "Built" just because merge.json — a manually-authored doc, not
 * something this scan writes — was never created for it. Purely a
 * file-presence + git heuristic: it does not know whether an item is stalled
 * or blocked, only which pipeline stage last produced output (or what git
 * itself shows). Computed live on every request, same precedent as
 * server/lib/repo-topology.js — nothing here is persisted.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { isolatedGitEnv } = require("./git-env");
const { isGitRepo, listGitWorktrees, DISK_SCAN_EXCLUDED_DIR_NAMES } = require("./repo-topology");

// Bounds for the intake-directory walk below each mapped cwd, mirroring
// repo-topology.js's NESTED_SCAN_MAX_DEPTH/MAX_NESTED_SCAN_DIRS_PER_REPO:
// heuristic, best-effort, must degrade gracefully rather than block on a
// pathologically large or deep tree.
const INTAKE_SCAN_MAX_DEPTH = 3;
const INTAKE_SCAN_MAX_DIRS_PER_CWD = 2000;

// Finds every `intake/` directory reachable from `cwd` within
// INTAKE_SCAN_MAX_DEPTH levels of subdirectories, entry-capped at
// INTAKE_SCAN_MAX_DIRS_PER_CWD. Stops descending into a directory as soon as
// it's identified as an `intake/` dir itself.
function findIntakeDirs(cwd) {
  const found = [];
  let dirsScanned = 0;

  function walk(dir, depth) {
    if (depth > INTAKE_SCAN_MAX_DEPTH || dirsScanned >= INTAKE_SCAN_MAX_DIRS_PER_CWD) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (dirsScanned >= INTAKE_SCAN_MAX_DIRS_PER_CWD) return;
      if (!entry.isDirectory()) continue;
      if (DISK_SCAN_EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      dirsScanned += 1;

      const childPath = path.join(dir, entry.name);
      if (entry.name === "intake") {
        found.push(childPath);
        continue;
      }
      walk(childPath, depth + 1);
    }
  }

  walk(cwd, 1);
  return found;
}

function fileExists(slugPath, relFile) {
  try {
    return fs.existsSync(path.join(slugPath, relFile));
  } catch {
    return false;
  }
}

// build-report.md lives under build/<build-slug>/, and the build slug isn't
// guaranteed to match the intake slug, so this checks any immediate
// subdirectory of build/ rather than a fixed path.
function hasBuildReport(slugPath) {
  const buildDir = path.join(slugPath, "build");
  let entries;
  try {
    entries = fs.readdirSync(buildDir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    (entry) => entry.isDirectory() && fileExists(path.join(buildDir, entry.name), "build-report.md")
  );
}

// Single source of truth for both computeArtifactFlags and
// deriveIntakeStage, ordered lowest to highest stage, so the stage list and
// the flag-check logic can never drift apart into two hand-copied forms.
const ARTIFACT_CHECKS = [
  { stage: "requested", flag: "requestBrief", check: (p) => fileExists(p, "request-brief.md") },
  { stage: "planned", flag: "technicalPlan", check: (p) => fileExists(p, "technical-plan.md") },
  {
    stage: "qa",
    flag: "qaAssessment",
    check: (p) => fileExists(p, "qa/qa-assessment.md") || fileExists(p, "qa/test-plan.md"),
  },
  { stage: "built", flag: "buildReport", check: hasBuildReport },
  { stage: "released", flag: "merged", check: (p) => fileExists(p, "merge.json") },
];

function computeArtifactFlags(slugPath) {
  const flags = {};
  for (const entry of ARTIFACT_CHECKS) flags[entry.flag] = entry.check(slugPath);
  return flags;
}

// Picks the highest satisfied stage. Any slug folder that exists at all
// floors out at "requested", even with no recognized artifacts yet.
function deriveIntakeStage(artifactFlags) {
  for (let i = ARTIFACT_CHECKS.length - 1; i >= 0; i -= 1) {
    const entry = ARTIFACT_CHECKS[i];
    if (artifactFlags[entry.flag]) return entry.stage;
  }
  return "requested";
}

// One git log per cwd finds every "Merge effort/<slug>: ..." commit (the
// wrap-up skill's merge-commit convention) in a single subprocess call,
// rather than one `git log --grep` per slug - cheap regardless of how many
// intake initiatives a repo has. Returns slug -> short commit hash.
function fetchMergedEffortSlugs(cwd) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["log", "--oneline", "-i", "--grep=^Merge effort/"],
      { cwd, timeout: 10_000, maxBuffer: 2_000_000, encoding: "utf8", env: isolatedGitEnv() },
      (err, stdout) => {
        if (err) return resolve(new Map());
        const found = new Map();
        for (const line of String(stdout).split(/\r?\n/)) {
          const m = line.match(/^(\S+)\s+Merge effort\/(\S+):/i);
          if (m) found.set(m[2], m[1]);
        }
        resolve(found);
      }
    );
  });
}

function findLiveWorktree(worktrees, slug) {
  const wanted = `refs/heads/effort/${slug}`;
  const match = worktrees.find((w) => w.branch === wanted);
  return match ? { path: match.path, branch: `effort/${slug}` } : null;
}

async function scanIntakeForCwd(cwd) {
  const intakeDirs = findIntakeDirs(cwd);
  if (intakeDirs.length === 0) return [];

  const repoIsGit = isGitRepo(cwd);
  const [worktrees, mergedSlugs] = repoIsGit
    ? await Promise.all([listGitWorktrees(cwd).catch(() => []), fetchMergedEffortSlugs(cwd)])
    : [[], new Map()];

  const initiatives = [];
  for (const intakeDir of intakeDirs) {
    let entries;
    try {
      entries = fs.readdirSync(intakeDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const slugs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const slug of slugs) {
      const slugPath = path.join(intakeDir, slug);
      const artifacts = computeArtifactFlags(slugPath);
      const mergeRecorded = artifacts.merged;
      const mergeCommit = mergedSlugs.get(slug) || null;
      if (mergeCommit) artifacts.merged = true;

      initiatives.push({
        sourceCwd: cwd,
        slug,
        path: slugPath,
        stage: deriveIntakeStage(artifacts),
        artifacts,
        mergeRecorded,
        mergeCommit,
        worktree: findLiveWorktree(worktrees, slug),
      });
    }
  }
  return initiatives;
}

/**
 * @param {object} dbModule - the server/db module ({ stmts }).
 * @param {{ id: string }} project
 */
async function scanProjectIntake(dbModule, project) {
  const paths = dbModule.stmts.listProjectPaths.all(project.id);
  const lists = await Promise.all(paths.map((p) => scanIntakeForCwd(p.cwd)));
  return { initiatives: lists.flat() };
}

module.exports = {
  ARTIFACT_CHECKS,
  INTAKE_SCAN_MAX_DEPTH,
  findIntakeDirs,
  deriveIntakeStage,
  scanIntakeForCwd,
  scanProjectIntake,
};
