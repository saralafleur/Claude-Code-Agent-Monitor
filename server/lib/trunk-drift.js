/**
 * @file Detects work that landed directly on a repo's trunk/default branch —
 * bypassing the tracked worktree/focus flow — with the same
 * recompute-per-request, never-cached posture as repo-topology.js. Resolves
 * the trunk branch via the shared `git-refs.resolveDefaultBranch`, then runs
 * one bounded, git-native `--first-parent --no-merges` walk (DEC-5's
 * original false-positive guard, from the 2026-08-02-trunk-drift-detection
 * effort: commits on trunk's first-parent line, not merges — a `--no-ff`
 * merge's own commits live entirely on the merge commit's *second* parent
 * line, so `--first-parent` already excludes them regardless of whether the
 * feature branch ref still exists).
 *
 * Deliberately does NOT additionally exclude "commits reachable from any
 * other local branch" (the original clause 3 / `--not --exclude=<trunk>
 * --branches`). That clause was removed by the
 * 2026-08-03-trunk-drift-open-branch-blindness effort: it's provably
 * impossible, from git topology alone, to distinguish "a fast-forward-merged
 * branch whose ref hasn't been deleted yet" (WATCH-1's original, accepted
 * false-positive risk) from "a brand-new, not-yet-started sibling branch
 * sitting at trunk's exact tip" — both have zero commits ahead of trunk. Any
 * exclusion narrow enough to protect the former necessarily also blinds
 * trunk's own *unrelated, older* direct-commit history the moment the latter
 * merely exists — which, given how many concurrent effort worktrees this
 * kind of project normally has open, is not a rare edge case but a frequent
 * and severe one (see that effort's decisions.md for the live incident that
 * surfaced it). This project's own convention is always `--no-ff` + delete
 * the branch on cleanup, so the ff-merge scenario clause 3 protected is not
 * expected to occur in practice; eliminating the far more common blind spot
 * was judged the better trade.
 *
 * Reads no SQLite, writes nothing, caches nothing. Every git failure
 * resolves to `{ skipped: "git_error" }` — this module never throws and
 * never reports a false "clean".
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { execGit, resolveDefaultBranch } = require("./git-refs");
const { isGitRepo } = require("./repo-topology");

// Hard ceiling on commits returned per request — sibling of
// repo-topology.js's MAX_DIRTY_CHECKS_PER_REQUEST, sized to bound one page
// load's `git log` walk regardless of how much direct-to-trunk history a
// repo has accumulated.
const MAX_TRUNK_DRIFT_COMMITS = 200;
const DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS = 7;
const MAX_SUBJECT_CHARS = 160;

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

// Canonical detector-level skip-reason vocabulary — every non-null value
// `detectTrunkDrift` itself can ever return in `skipped`. The route layer
// (server/routes/projects.js) builds its own combined vocabulary on top of
// this list (adding its own route-level "budget_exceeded" reason) rather
// than hand-typing a parallel copy, and the server test suite imports that
// combined list rather than hand-typing a third copy (R5-vocab).
const TRUNK_DRIFT_SKIP_REASONS = ["not_a_repo", "no_default_branch", "no_commits", "git_error"];

function trunkDriftLookbackDaysFromEnv() {
  const v = Number(process.env.DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS;
}

function truncateSubject(subject) {
  if (subject.length <= MAX_SUBJECT_CHARS) return subject;
  return subject.slice(0, MAX_SUBJECT_CHARS - 1) + "…";
}

// Parses one `--shortstat` trailer line, e.g.
// " 2 files changed, 5 insertions(+), 1 deletion(-)" into counts. Any of the
// three clauses may be absent (e.g. a pure rename with no insertions) —
// missing ⇒ 0.
function parseShortstat(line) {
  const filesMatch = line.match(/(\d+) files? changed/);
  const insMatch = line.match(/(\d+) insertions?\(\+\)/);
  const delMatch = line.match(/(\d+) deletions?\(-\)/);
  return {
    filesChanged: filesMatch ? Number(filesMatch[1]) : 0,
    insertions: insMatch ? Number(insMatch[1]) : 0,
    deletions: delMatch ? Number(delMatch[1]) : 0,
  };
}

// Splits the raw `git log` output (one \x1e-prefixed record per commit,
// \x1f-separated fields, an optional trailing --shortstat line) into
// structured commit objects.
function parseLogOutput(raw) {
  const records = raw.split(RECORD_SEP).filter((r) => r.trim().length > 0);
  const commits = [];
  for (const record of records) {
    const lines = record.split("\n");
    const headerLine = lines[0];
    const fields = headerLine.split(FIELD_SEP);
    const [sha, authorName, authorEmail, committedAt, subject] = fields;
    if (!sha) continue;
    const statLine = lines.slice(1).find((l) => /files? changed/.test(l)) || "";
    const { filesChanged, insertions, deletions } = parseShortstat(statLine);
    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      authorName: authorName || "",
      authorEmail: authorEmail || "",
      committedAt: committedAt || "",
      subject: truncateSubject(subject || ""),
      filesChanged,
      insertions,
      deletions,
    });
  }
  return commits;
}

/**
 * Detect commits that landed directly on `repoPath`'s trunk/default branch
 * within the lookback window. Never throws; every failure or ambiguity
 * resolves to a `skipped` reason.
 * @param {string} repoPath
 * @param {{ lookbackDays?: number, maxCommits?: number, now?: Date, seenShas?: Set<string>, timeout?: number }} [opts]
 * @returns {Promise<object>} see module header for the two return shapes.
 */
async function detectTrunkDrift(repoPath, opts = {}) {
  // Explicit, never implicit: every git call below states its own timeout —
  // opts.timeout when the caller supplies one, else 10_000ms — rather than
  // omitting the option and silently inheriting git-refs.js's own default.
  const timeout = opts.timeout ?? 10_000;
  const lookbackDays = Number.isFinite(opts.lookbackDays)
    ? opts.lookbackDays
    : trunkDriftLookbackDaysFromEnv();
  const maxCommits = Number.isFinite(opts.maxCommits) ? opts.maxCommits : MAX_TRUNK_DRIFT_COMMITS;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const seenShas = opts.seenShas instanceof Set ? opts.seenShas : new Set();

  if (!isGitRepo(repoPath)) {
    return { skipped: "not_a_repo", repoPath };
  }

  // Distinguish "genuinely no commits at all yet" (fresh `git init`, unborn
  // HEAD) from "has commits but the default branch is ambiguous" — both
  // otherwise look the same to resolveDefaultBranch (no resolvable local
  // ref), but they are different, explicit skip reasons.
  let hasCommits = true;
  try {
    await execGit(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD"], { timeout });
    // timeout: 10_000 default (opts.timeout overrides) — explicit on every git call.
  } catch {
    hasCommits = false;
  }
  if (!hasCommits) {
    return { skipped: "no_commits", repoPath };
  }

  const { branch, via } = await resolveDefaultBranch(repoPath, { timeout });
  if (!branch) {
    return { skipped: "no_default_branch", repoPath };
  }

  let headSha;
  try {
    headSha = await execGit(
      repoPath,
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      {
        timeout,
      }
    );
    // timeout: 10_000 default (opts.timeout overrides) — explicit on every git call.
  } catch {
    return { skipped: "git_error", repoPath };
  }

  const sinceIso = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();

  let raw;
  try {
    raw = await execGit(
      repoPath,
      [
        "log",
        "--first-parent",
        "--no-merges",
        `--since=${sinceIso}`,
        `--max-count=${maxCommits + 1}`,
        "--date=iso-strict",
        "--shortstat",
        `--format=${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%cI${FIELD_SEP}%s`,
        `refs/heads/${branch}`,
        // No `--not --exclude=<branch> --branches` here (removed by
        // 2026-08-03-trunk-drift-open-branch-blindness) — see the file
        // header for why: it's topologically impossible to tell "a
        // ff-merged branch not yet deleted" apart from "an unrelated,
        // not-yet-started sibling branch," and the latter is common enough
        // in this project's workflow that the old clause blinded trunk's
        // own unrelated history far more often than it protected anything.
      ],
      { timeout }
    );
    // timeout: 10_000 default (opts.timeout overrides) — explicit on every git call.
  } catch {
    return { skipped: "git_error", repoPath };
  }

  let commits = parseLogOutput(raw);

  // Truncation is a property of the raw walk hitting the `--max-count`
  // ceiling (`maxCommits + 1` records back), computed BEFORE the seenShas
  // idempotency filter below — filtering only ever removes entries, so
  // computing `truncated` after it could silently report `false` for a
  // walk that was genuinely capped (S1).
  const truncated = commits.length > maxCommits;

  if (seenShas.size > 0) {
    commits = commits.filter((c) => !seenShas.has(c.sha));
  }

  if (commits.length > maxCommits) {
    commits = commits.slice(0, maxCommits);
  }

  const range =
    commits.length > 0
      ? { firstSha: commits[commits.length - 1].sha, lastSha: commits[0].sha }
      : null;

  return {
    skipped: null,
    repoPath,
    defaultBranch: branch,
    defaultBranchVia: via,
    headSha,
    lookbackDays,
    since: sinceIso,
    commits,
    commitCount: commits.length,
    truncated,
    range,
  };
}

module.exports = {
  detectTrunkDrift,
  trunkDriftLookbackDaysFromEnv,
  MAX_TRUNK_DRIFT_COMMITS,
  DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS,
  TRUNK_DRIFT_SKIP_REASONS,
};
