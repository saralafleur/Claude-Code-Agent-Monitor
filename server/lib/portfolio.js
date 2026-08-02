/**
 * Portfolio summary (layer 7 read model).
 *
 * Aggregates layers 1-6 per project into the shape the layer-7 rollup UI
 * renders: objective/milestone completion and live pace status. Every
 * completion/pace judgment is delegated to pace.js (isComplete/paceStatus)
 * rather than re-derived here (PROJECT-CONTEXT.md §9.1 DERIVED-DUAL-VIEW) -
 * this module only aggregates and buckets what pace.js already decided, per
 * that file's own header ("any eventual layer-7 UI must call these
 * functions rather than re-deriving the comparison").
 *
 * Pace is computed ONLY over items with a numeric item_number, mirroring
 * reconciliation.js's evaluateRules() R1 filter exactly - a sub-item
 * (fold_in'd under a parent, no independent number) was never meant to
 * carry its own target date, and this endpoint's "behind" list must never
 * show a pace breach the real scheduler would not itself have flagged.
 * Milestone completion, by contrast, counts every item (top-level and
 * sub-item alike) since finishing a sub-item is still real progress.
 *
 * The "unassigned" bucket (sessions whose cwd isn't mapped to a project) has
 * no objectives to track and is out of scope here, matching WATCH-3's
 * project-level scoping of layer 7.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const pace = require("./pace");

function buildProjectPortfolio(dbModule, project, opts = {}) {
  const { stmts } = dbModule;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const graceDays = Number.isFinite(opts.graceDays) ? opts.graceDays : pace.paceGraceDaysFromEnv();

  const cwds = stmts.listProjectPaths.all(project.id).map((p) => p.cwd);

  let done = 0;
  let total = 0;
  const counts = { no_target: 0, on_track: 0, behind: 0, done: 0 };
  const behind = [];

  for (const cwd of cwds) {
    const items = stmts.listPlanItems.all(cwd) || [];
    for (const item of items) {
      total += 1;
      if (pace.isComplete(item).complete) done += 1;

      // Pace only applies to numbered items - mirrors reconciliation.js's
      // evaluateRules() filter exactly, so this list never shows more (or
      // fewer) breaches than the real scheduler would flag.
      if (item.item_number == null) continue;
      const status = pace.paceStatus(item, { now, graceDays });
      counts[status.status] += 1;
      if (status.status === "behind") {
        behind.push({
          cwd,
          item_id: item.item_id,
          item_number: item.item_number,
          text: item.text,
          target_date: status.target_date,
          days_overdue: status.days_overdue,
        });
      }
    }
  }

  behind.sort((a, b) => b.days_overdue - a.days_overdue);

  return {
    project_id: project.id,
    milestones: { done, total },
    pace: { counts, behind },
  };
}

function buildPortfolioSummary(dbModule, opts = {}) {
  const { stmts } = dbModule;
  const projects = stmts.listProjects.all();
  return { projects: projects.map((project) => buildProjectPortfolio(dbModule, project, opts)) };
}

module.exports = { buildProjectPortfolio, buildPortfolioSummary };
