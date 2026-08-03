/**
 * @file Single home for cwd canonicalization used by the portfolio-layer plan
 * lifecycle + value ledger (CWD-IDENTITY-FANOUT). `canonicalizeCwd` resolves
 * macOS case-variant / symlink aliases to their on-disk realpath (falling
 * back to the input on ENOENT, so a since-deleted cwd never throws);
 * `repoRootFor` folds a worktree cwd into its parent repo's working root via
 * `git rev-parse --git-common-dir` (never the worktree's own `--show-toplevel`
 * alone), so an effort-worktree checkout of a repo is treated as the same
 * repo, not a brand-new one; `dirIdentity` exposes the `{dev, ino}` inode pair
 * for same-directory detection; `groupCwdsByIdentity` folds a list of cwds
 * into canonical groups so "N rows, one directory" (e.g. `/SARA/DND` vs
 * `/SARA/dnd`) is a reportable condition. No other module in this feature may
 * call `fs.realpathSync`, `git rev-parse --show-toplevel`, or
 * `git rev-parse --git-common-dir` on a plan/pool cwd — every such
 * canonicalization routes through here (technical-plan.md §3.2, DEC-15).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const { execGit } = require("./git-refs");
const { isGitRepo } = require("./repo-topology");

/**
 * Resolve a cwd to its on-disk realpath (folds macOS case-variants and
 * symlink aliases to the same canonical string). Falls back to the input
 * unchanged when the path does not exist (ENOENT) or realpath otherwise
 * fails — a since-deleted or not-yet-created cwd must never throw here.
 * @param {string} cwd
 * @returns {string}
 */
function canonicalizeCwd(cwd) {
  if (!cwd || typeof cwd !== "string") return cwd;
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/**
 * Resolve the parent repo's working root for `cwd`, folding a worktree
 * checkout into the main repo it belongs to. Returns `null` (the documented
 * sentinel) when `cwd` is not a git repo at all, or when git itself fails.
 * @param {string} cwd
 * @returns {Promise<string|null>}
 */
async function repoRootFor(cwd) {
  if (!cwd || !isGitRepo(cwd)) return null;
  try {
    // `--git-common-dir` is shared by every worktree of one repo and lives
    // inside the MAIN repo's own `.git` directory — resolving its parent
    // gives the repo root regardless of which worktree `cwd` actually is.
    const commonDir = await execGit(cwd, ["rev-parse", "--git-common-dir"]);
    const resolvedCommon = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
    if (path.basename(resolvedCommon) === ".git") {
      return canonicalizeCwd(path.dirname(resolvedCommon));
    }
    // Bare-repo or unusual layout: fall back to this checkout's own toplevel.
    const toplevel = await execGit(cwd, ["rev-parse", "--show-toplevel"]);
    return canonicalizeCwd(toplevel);
  } catch {
    return null;
  }
}

/**
 * `{dev, ino}` identity pair for a directory — the same-directory test that
 * survives a rename/case-fold a string comparison alone cannot.
 * @param {string} cwd
 * @returns {{dev: number, ino: number}}
 */
function dirIdentity(cwd) {
  const stat = fs.statSync(cwd);
  return { dev: stat.dev, ino: stat.ino };
}

/**
 * Group a list of cwds by their canonical form. Each group carries the
 * canonical path and every original cwd string that resolved to it — a
 * group with more than one member is exactly the CWD-IDENTITY-FANOUT shape
 * ("N rows, one directory") the pool's `identityWarnings` surface.
 * @param {string[]} cwds
 * @returns {{canonical: string, members: string[]}[]}
 */
function groupCwdsByIdentity(cwds) {
  const groups = new Map();
  for (const cwd of cwds || []) {
    const canonical = canonicalizeCwd(cwd);
    if (!groups.has(canonical)) groups.set(canonical, { canonical, members: [] });
    groups.get(canonical).members.push(cwd);
  }
  return [...groups.values()];
}

module.exports = {
  canonicalizeCwd,
  repoRootFor,
  dirIdentity,
  groupCwdsByIdentity,
};
