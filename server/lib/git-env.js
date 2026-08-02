/**
 * @file Shared env-isolation helper for every server-side `git` child process
 * invocation. git commit/rebase hooks run with GIT_DIR/GIT_WORK_TREE/
 * GIT_INDEX_FILE set in the environment; those leak into any child `git`
 * process (even ones given an explicit cwd/-C) and silently redirect it at
 * the calling repo instead of the intended target. Strip them so the target
 * path is always authoritative. Used by update-check.js (upstream comparison)
 * and repo-topology.js (worktree listing, sibling-repo discovery).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const GIT_ENV_OVERRIDE_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

function isolatedGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_OVERRIDE_KEYS) delete env[key];
  return env;
}

module.exports = { GIT_ENV_OVERRIDE_KEYS, isolatedGitEnv };
