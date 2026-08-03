/**
 * @file One home for "which git ref is this repo's trunk," shared by
 * update-check.js (upstream/canonical-remote comparison, fork-aware) and
 * trunk-drift.js (the direct-to-trunk detector). `execGit`, `listRemotes`,
 * `pickCanonicalRemote`, and `REMOTE_PRIORITY` are moved here verbatim from
 * update-check.js (whose own private `execGit` — 120s fetch default — stays
 * local and unchanged, since it serves a different call shape). The new
 * `resolveDefaultBranch` is remote-optional, never fetches, and never
 * guesses: it walks remote HEAD -> remote ref candidates -> local ref
 * candidates -> the sole local branch, in that order, and returns
 * `{ branch: null, via: null }` rather than falling back to `main`/`master`
 * or the current checkout's `HEAD` (a feature-branch worktree must never be
 * mistaken for trunk).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { execFile } = require("child_process");
const { isolatedGitEnv } = require("./git-env");

// Standard convention for fork workflows: "upstream" points at the canonical
// repo, "origin" points at the user's fork. Prefer upstream when both exist.
// Verbatim from update-check.js.
const REMOTE_PRIORITY = ["upstream", "origin"];

/** Verbatim from update-check.js (10s default timeout — this module's own
 *  calls, unlike update-check.js's private `execGit`, never fetch). */
function execGit(cwd, args, opts = {}) {
  const timeout = opts.timeout ?? 10_000;
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout, maxBuffer: 2_000_000, encoding: "utf8", env: isolatedGitEnv() },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout).trim());
      }
    );
  });
}

/** Verbatim from update-check.js. */
async function listRemotes(gitRoot) {
  try {
    const out = await execGit(gitRoot, ["remote"], { timeout: 10_000 });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Verbatim from update-check.js. */
async function pickCanonicalRemote(gitRoot) {
  const remotes = await listRemotes(gitRoot);
  for (const candidate of REMOTE_PRIORITY) {
    if (remotes.includes(candidate)) return candidate;
  }
  return remotes[0] || null;
}

// "origin/main" -> "main"; "origin/feature/foo" -> "feature/foo".
function stripRemotePrefix(ref) {
  const idx = ref.indexOf("/");
  return idx === -1 ? ref : ref.slice(idx + 1);
}

/**
 * Resolve a repo's default/trunk branch without ever guessing. Order (first
 * hit wins), never a fetch:
 *   1. remote HEAD symref (`refs/remotes/<remote>/HEAD`) -> via "remote_head"
 *   2. remote ref candidates (`<remote>/<candidate>`) -> via "remote_ref"
 *   3. local ref candidates (`refs/heads/<candidate>`) -> via "local_ref"
 *   4. exactly one local branch exists -> via "sole_local_branch"
 *   5. otherwise `{ branch: null, via: null }` — never a `main`/`master`
 *      guess, never the current checkout's `HEAD` (a detached/feature-branch
 *      worktree must not be mistaken for trunk).
 * @param {string} repoPath
 * @param {{ timeout?: number, candidates?: string[] }} [opts]
 * @returns {Promise<{ branch: string|null, via: string|null }>}
 */
async function resolveDefaultBranch(repoPath, opts = {}) {
  const timeout = opts.timeout ?? 10_000;
  const candidates = opts.candidates ?? ["main", "master"];

  const remote = await pickCanonicalRemote(repoPath);

  if (remote) {
    try {
      const sym = await execGit(
        repoPath,
        ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`],
        { timeout }
      );
      const branch = stripRemotePrefix(sym);
      if (branch) return { branch, via: "remote_head" };
    } catch {
      // no remote HEAD symref set — fall through
    }

    for (const candidate of candidates) {
      try {
        await execGit(repoPath, ["rev-parse", "--verify", "--quiet", `${remote}/${candidate}`], {
          timeout,
        });
        return { branch: candidate, via: "remote_ref" };
      } catch {
        // try next candidate
      }
    }
  }

  for (const candidate of candidates) {
    try {
      await execGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], {
        timeout,
      });
      return { branch: candidate, via: "local_ref" };
    } catch {
      // try next candidate
    }
  }

  try {
    const out = await execGit(
      repoPath,
      ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
      { timeout }
    );
    const branches = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (branches.length === 1) {
      return { branch: branches[0], via: "sole_local_branch" };
    }
  } catch {
    // fall through to the never-guess return below
  }

  return { branch: null, via: null };
}

module.exports = {
  execGit,
  listRemotes,
  pickCanonicalRemote,
  resolveDefaultBranch,
  REMOTE_PRIORITY,
};
