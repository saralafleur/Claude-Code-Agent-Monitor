/**
 * @file Derives team-intake initiative status for the Project Detail page by
 * scanning each project folder's `intake/<slug>/` directories for the
 * delivery-team pipeline's known artifact files (request-brief.md,
 * technical-plan.md, qa/qa-assessment.md, build/*\/build-report.md,
 * merge.json) and inferring a stage from which of them exist — no markdown
 * content parsing. Purely a file-presence heuristic: it does not know
 * whether an item is stalled or blocked, only which pipeline stage last
 * produced output. Computed live on every request, same precedent as
 * server/lib/repo-topology.js — nothing here is persisted.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");

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

function scanIntakeForCwd(cwd) {
  const intakeDir = path.join(cwd, "intake");
  let entries;
  try {
    entries = fs.readdirSync(intakeDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const slugPath = path.join(intakeDir, entry.name);
      const artifacts = computeArtifactFlags(slugPath);
      return {
        sourceCwd: cwd,
        slug: entry.name,
        path: slugPath,
        stage: deriveIntakeStage(artifacts),
        artifacts,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * @param {object} dbModule - the server/db module ({ stmts }).
 * @param {{ id: string }} project
 */
function scanProjectIntake(dbModule, project) {
  const paths = dbModule.stmts.listProjectPaths.all(project.id);
  const initiatives = paths.flatMap((p) => scanIntakeForCwd(p.cwd));
  return { initiatives };
}

module.exports = {
  ARTIFACT_CHECKS,
  deriveIntakeStage,
  scanIntakeForCwd,
  scanProjectIntake,
};
