/**
 * @file The single home (§9.1 DERIVED-DUAL-VIEW, DEC-5) for every derived
 * value this feature computes: pool assembly, plan health metrics, and the
 * AC-6 whole-life delivered-value summary. No route, no CLI command, and no
 * future consumer (MCP tools, an AGENT-PLAN.md export — DEC-16) may
 * recompute or partially recompute any of `unclaimedPoolSize`,
 * `lastClosureAt`/`daysSinceLastClosure`, the pool itself, or the whole-life
 * summary outside this module.
 *
 * Pool assembly order (technical-plan.md §4 step 12):
 *   1. mechanical tier from `scanIntakeForCwd` (intake_initiative + merge_commit)
 *   2. trunk feed via the live `detectTrunkDrift(repoRoot, {seenShas})` call
 *      (DEC-4 — never a second, hand-rolled trunk walker)
 *   3. detours from `detour_dispositions`, excluding disposition='discard'
 *   4. correlational tier: focus-session bracketing of unattributed trunk
 *      commits (suggestions only, never auto-claimed)
 *   5. subtract every unit already claimed, dedupe the remainder by unitKey
 *
 * DEC-4 cross-feed dedupe: a value unit's identity is
 * `('trunk_commit', <sha>)` regardless of which feed produced it. A
 * `detour_dispositions` row with `source='trunk_drift'` (trunk-drift Phase
 * 1b, not yet shipped — the CHECK constraint still excludes it, see A6.7)
 * maps to the SAME unit as the live feed via `rowToUnit`, so the day Phase 1b
 * starts persisting rows, its units collapse into the live feed's instead of
 * doubling the health metric.
 *
 * All per-cwd feeds resolve through `server/lib/cwd-identity.js` — this
 * module never calls `fs.realpathSync` or `git rev-parse` directly.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const cwdIdentity = require("./cwd-identity");
const { isGitRepo } = require("./repo-topology");
const { detectTrunkDrift } = require("./trunk-drift");
const { scanIntakeForCwd } = require("./intake-scan");
const { generationOrdinal } = require("./plan-lifecycle");

// Mirrors the value_claims CHECK constraints verbatim (DEC-3) — routes and
// the CLI validate against these exports, never against typed string
// literals (§9.1 rule 2). focus_segment is reserved for a v2 correlational
// unit kind and is never emitted by assembleValuePool in v1 (A5.11).
const VALUE_SOURCES = [
  "trunk_commit",
  "merge_commit",
  "intake_initiative",
  "detour",
  "focus_segment",
];
const ATTRIBUTION_TIERS = ["mechanical", "correlational", "judgment"];

// DEC-16 tripwire: every known reader of this module's derived values, so a
// new one (MCP tools, an AGENT-PLAN.md export, a dedicated reconcile page)
// is a reviewed, deliberate addition — never a silent third consumer
// re-deriving these numbers on its own. Grow this list ONLY when the new
// consumer reads computePlanHealth/assembleValuePool/summarizeDeliveredValue
// directly, never re-implements a piece of them.
const CONSUMERS = [
  "server/routes/project-plans.js",
  "bin/ccam.js (cmdLedger)",
  "server/lib/value-summary-tick.js",
];

// DEC-6: bounded default lookback (trunk-drift's own env-tunable window) plus
// an explicit backfill request for a deep walk — no persisted per-project
// baseline table in v1. 10 years is "effectively unbounded" for any repo this
// feature will realistically see, without literally passing `undefined` (git
// `--since` with no bound at all is a different, riskier code path).
const BACKFILL_LOOKBACK_DAYS = 3650;

/**
 * Deterministic identity for one value unit. DEC-4: a `('trunk_commit', sha)`
 * pair collapses to one unit regardless of which feed produced it, as long
 * as both feeds resolve to the same canonical `cwd` — which they always do
 * for one physical repo (this module canonicalizes every cwd before calling
 * this).
 * @param {string} source - one of VALUE_SOURCES
 * @param {string} ref
 * @param {string} [cwd]
 * @returns {string}
 */
function unitKey(source, ref, cwd) {
  return `${source}::${ref}::${cwd || ""}`;
}

/**
 * DEC-4(b) diagnostic mapper: what unit a `detour_dispositions` row becomes.
 * A `source='trunk_drift'` row (Phase 1b, not shippable until the CHECK
 * widens — A6.7) maps to the SAME unit identity the live `detectTrunkDrift`
 * feed produces for that sha; every other row maps to a `detour` unit keyed
 * by the disposition's own id.
 * @param {{source: string, source_ref: string, id: number}} row
 * @returns {{value_source: string, value_ref: string}}
 */
function rowToUnit(row) {
  if (row.source === "trunk_drift") {
    return { value_source: "trunk_commit", value_ref: row.source_ref };
  }
  return { value_source: "detour", value_ref: String(row.id) };
}

/** Whether an ISO commit timestamp falls inside a session's [started_at,
 *  ended_at) window (an active session with no ended_at yet is open-ended). */
function sessionBrackets(session, committedAtIso) {
  const committedAt = new Date(committedAtIso).getTime();
  if (!Number.isFinite(committedAt)) return false;
  const startedAt = new Date(session.started_at).getTime();
  if (!Number.isFinite(startedAt) || committedAt < startedAt) return false;
  if (!session.ended_at) return true;
  const endedAt = new Date(session.ended_at).getTime();
  return Number.isFinite(endedAt) ? committedAt <= endedAt : true;
}

/** No LIMIT here on purpose — one project's session set for one cwd is
 *  small and bounded (same rationale decision_queue's own no-LIMIT reads
 *  use), so this never has to participate in the §9.2 chronology-ordering
 *  scan at all. */
function sessionsForCwd(dbModule, cwd) {
  return dbModule.db.prepare("SELECT started_at, ended_at FROM sessions WHERE cwd = ?").all(cwd);
}

/**
 * Assemble the live, derived value pool for one project: every claimable
 * unit not yet claimed. Never persisted — recomputed on every call, same
 * posture as repo-topology.js / intake-scan.js.
 * @param {object} dbModule
 * @param {{id: string}} project
 * @param {{lookbackDays?: number, backfill?: boolean, now?: Date}} [opts]
 * @returns {Promise<{units: object[], identityWarnings: object[]}>}
 */
async function assembleValuePool(dbModule, project, opts = {}) {
  const backfill = Boolean(opts.backfill);
  const lookbackDays = backfill
    ? BACKFILL_LOOKBACK_DAYS
    : Number.isFinite(opts.lookbackDays)
      ? opts.lookbackDays
      : undefined;

  const identityWarnings = [];

  const paths = dbModule.stmts.listProjectPaths.all(project.id);
  const cwdGroups = cwdIdentity.groupCwdsByIdentity(paths.map((p) => p.cwd));
  for (const group of cwdGroups) {
    if (group.members.length > 1) {
      identityWarnings.push({ kind: "case_variant_duplicate", cwds: group.members });
    }
  }
  const canonicalCwds = [...new Set(cwdGroups.map((g) => g.canonical))];

  const repoRootByCwd = new Map();
  const repoRoots = new Set();
  for (const cwd of canonicalCwds) {
    if (!isGitRepo(cwd)) {
      identityWarnings.push({ kind: "no_git_repo", cwds: [cwd] });
      continue;
    }
    const root = (await cwdIdentity.repoRootFor(cwd)) || cwd;
    repoRootByCwd.set(cwd, root);
    repoRoots.add(root);
  }

  // (c) a repo root this project's mapping folds to, but which no
  // project_paths row anywhere maps directly — v1 read-side-only detection,
  // never rewrites project_paths (DEC-15).
  const allMappedCanonical = new Set(
    dbModule.db
      .prepare("SELECT cwd FROM project_paths")
      .all()
      .map((r) => cwdIdentity.canonicalizeCwd(r.cwd))
  );
  for (const [cwd, root] of repoRootByCwd) {
    if (root !== cwd && !allMappedCanonical.has(root)) {
      identityWarnings.push({ kind: "repo_root_unmapped", cwds: [root] });
    }
  }

  // Claimed units are excluded from the pool regardless of which feed would
  // otherwise re-produce them (the ratchet, DEC-7: a unit is out of the pool
  // at its FIRST claim).
  const claims = dbModule.stmts.listClaimsForProject.all(project.id);
  const claimedKeys = new Set(
    claims.map((c) => unitKey(c.value_source, c.value_ref, c.source_cwd))
  );
  const claimedShas = new Set(
    claims.filter((c) => c.value_source === "trunk_commit").map((c) => c.value_ref)
  );

  const units = [];
  const emittedKeys = new Set();

  function pushUnit(unit) {
    const key = unitKey(unit.value_source, unit.value_ref, unit.source_cwd);
    if (emittedKeys.has(key)) return; // DEC-4: second feed producing the same unit collapses here
    if (claimedKeys.has(key)) return; // already claimed — the ratchet
    emittedKeys.add(key);
    units.push({ ...unit, unitKey: key });
  }

  // 1. Mechanical tier: intake initiatives + their merge commits.
  for (const cwd of canonicalCwds) {
    let initiatives = [];
    try {
      initiatives = await scanIntakeForCwd(cwd);
    } catch {
      initiatives = [];
    }
    for (const initiative of initiatives) {
      pushUnit({
        value_source: "intake_initiative",
        value_ref: initiative.slug,
        source_cwd: cwd,
        attribution: "mechanical",
        label: initiative.slug,
        stage: initiative.stage,
      });
      if (initiative.mergeCommit) {
        pushUnit({
          value_source: "merge_commit",
          value_ref: initiative.mergeCommit,
          source_cwd: cwd,
          attribution: "mechanical",
          label: `Merge effort/${initiative.slug}`,
          stage: initiative.stage,
        });
      }
    }
  }

  // 2. Trunk feed — live detectTrunkDrift, seeded with every already-claimed
  // sha (the cross-request ratchet) plus every sha this same assembly has
  // already seen (the within-request DEC-4 dedupe for repos reachable via
  // more than one mapped cwd).
  const seenShas = new Set(claimedShas);
  const trunkCommitsByRoot = new Map();
  for (const root of repoRoots) {
    const result = await detectTrunkDrift(root, { seenShas, lookbackDays, now: opts.now });
    if (result.skipped) continue;
    trunkCommitsByRoot.set(root, result.commits);
    for (const commit of result.commits) {
      seenShas.add(commit.sha);
      pushUnit({
        value_source: "trunk_commit",
        value_ref: commit.sha,
        source_cwd: root,
        attribution: "mechanical",
        label: commit.subject,
        seen_at: commit.committedAt,
      });
    }
  }

  // 3. Detours (excluding discard). A source='trunk_drift' row collapses
  // into the live trunk feed's unit via rowToUnit (DEC-4c tripwire: A6.7).
  for (const cwd of canonicalCwds) {
    const rows = dbModule.stmts.listDetourDispositions.all(cwd, 1000);
    for (const row of rows) {
      if (row.disposition === "discard") continue;
      const mapped = rowToUnit(row);
      const attribution = mapped.value_source === "trunk_commit" ? "mechanical" : "judgment";
      pushUnit({
        value_source: mapped.value_source,
        value_ref: mapped.value_ref,
        source_cwd: cwd,
        attribution,
        label: row.label || null,
        seen_at: row.source_seen_at || row.created_at,
      });
    }
  }

  // 4. Correlational tier: bracket unattributed trunk commits against this
  // cwd's session windows by TIME (§9.2 — never by insertion id). Suggestion
  // only: upgrades the unit's attribution in place, never auto-claims.
  for (const [root, commits] of trunkCommitsByRoot) {
    const sessions = sessionsForCwd(dbModule, root);
    if (!sessions.length) continue;
    for (const commit of commits) {
      const key = unitKey("trunk_commit", commit.sha, root);
      const unit = units.find((u) => u.unitKey === key);
      if (!unit) continue;
      if (sessions.some((s) => sessionBrackets(s, commit.committedAt))) {
        unit.attribution = "correlational";
      }
    }
  }

  return { units, identityWarnings };
}

/**
 * Health metrics for one project — the T6 parity target shape. Every
 * consumer (route, `ccam ledger health`) reads these values verbatim.
 * @param {object} dbModule
 * @param {{id: string}} project
 * @param {object} [opts] - forwarded to assembleValuePool
 */
async function computePlanHealth(dbModule, project, opts = {}) {
  const plans = dbModule.stmts.listProjectPlans.all(project.id);
  const openPlanCount = plans.filter((p) => p.status === "open").length;
  const lastClosure = dbModule.stmts.lastClosureForProject.get(project.id);
  const { units } = await assembleValuePool(dbModule, project, opts);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const daysSinceLastClosure = lastClosure
    ? Math.floor((now.getTime() - new Date(lastClosure.closed_at).getTime()) / 86_400_000)
    : null;

  return {
    unclaimedPoolSize: units.length,
    lastClosureAt: lastClosure ? lastClosure.closed_at : null,
    daysSinceLastClosure,
    openPlanCount,
  };
}

/**
 * AC-6, the whole-life answer: "what value did this project deliver?"
 * answered from closed generations and their claims alone — no archaeology.
 * @param {object} dbModule
 * @param {{id: string}} project
 */
function summarizeDeliveredValue(dbModule, project) {
  const closedPlans = dbModule.stmts.listProjectPlans
    .all(project.id)
    .filter((p) => p.status === "closed");

  const generations = closedPlans.map((plan) => ({
    plan,
    ordinal: generationOrdinal(dbModule, plan),
    items: dbModule.stmts.listProjectPlanItems.all(plan.id),
    claims: dbModule.stmts.listClaimsForPlan.all(plan.id),
  }));

  generations.sort((a, b) => String(a.plan.closed_at).localeCompare(String(b.plan.closed_at)));

  return { generations };
}

module.exports = {
  VALUE_SOURCES,
  ATTRIBUTION_TIERS,
  BACKFILL_LOOKBACK_DAYS,
  CONSUMERS,
  unitKey,
  rowToUnit,
  assembleValuePool,
  computePlanHealth,
  summarizeDeliveredValue,
};
