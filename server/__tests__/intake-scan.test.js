/**
 * @file Tests for server/lib/intake-scan.js against real tmp-dir folder
 * trees mirroring the delivery-team pipeline's intake/<slug>/ artifact
 * layout, for every stage combination.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { deriveIntakeStage, scanIntakeForCwd, scanProjectIntake } = require("../lib/intake-scan");

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "intakescan-"));
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeFile(filePath, contents = "x") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

describe("deriveIntakeStage", () => {
  it("floors at requested with no artifacts", () => {
    assert.equal(
      deriveIntakeStage({
        requestBrief: false,
        technicalPlan: false,
        qaAssessment: false,
        buildReport: false,
        merged: false,
      }),
      "requested"
    );
  });

  it("picks the highest satisfied stage regardless of lower flags", () => {
    assert.equal(
      deriveIntakeStage({
        requestBrief: true,
        technicalPlan: true,
        qaAssessment: true,
        buildReport: false,
        merged: false,
      }),
      "qa"
    );
    assert.equal(
      deriveIntakeStage({
        requestBrief: true,
        technicalPlan: true,
        qaAssessment: true,
        buildReport: true,
        merged: false,
      }),
      "built"
    );
    assert.equal(
      deriveIntakeStage({
        requestBrief: true,
        technicalPlan: true,
        qaAssessment: true,
        buildReport: true,
        merged: true,
      }),
      "released"
    );
  });
});

describe("scanIntakeForCwd", () => {
  it("returns [] when there is no intake/ directory", () => {
    const cwd = path.join(tmpDir, "no-intake-cwd");
    fs.mkdirSync(cwd, { recursive: true });
    assert.deepEqual(scanIntakeForCwd(cwd), []);
  });

  it("infers each slug's stage from its real artifact layout", () => {
    const cwd = path.join(tmpDir, "real-layout-cwd");

    // requested-only
    writeFile(path.join(cwd, "intake", "2026-01-01-requested-only", "request-brief.md"));

    // planned
    writeFile(path.join(cwd, "intake", "2026-01-02-planned", "request-brief.md"));
    writeFile(path.join(cwd, "intake", "2026-01-02-planned", "technical-plan.md"));

    // qa (via qa/test-plan.md, not qa-assessment.md)
    writeFile(path.join(cwd, "intake", "2026-01-03-qa", "request-brief.md"));
    writeFile(path.join(cwd, "intake", "2026-01-03-qa", "technical-plan.md"));
    writeFile(path.join(cwd, "intake", "2026-01-03-qa", "qa", "test-plan.md"));

    // built - build-report.md nested under build/<build-slug>/, slug differs
    // from the intake slug on purpose (real repos do this).
    const builtSlug = "2026-01-04-built";
    writeFile(path.join(cwd, "intake", builtSlug, "request-brief.md"));
    writeFile(path.join(cwd, "intake", builtSlug, "technical-plan.md"));
    writeFile(path.join(cwd, "intake", builtSlug, "qa", "qa-assessment.md"));
    writeFile(
      path.join(cwd, "intake", builtSlug, "build", "some-other-build-slug", "build-report.md")
    );

    // released
    const releasedSlug = "2026-01-05-released";
    writeFile(path.join(cwd, "intake", releasedSlug, "request-brief.md"));
    writeFile(path.join(cwd, "intake", releasedSlug, "technical-plan.md"));
    writeFile(path.join(cwd, "intake", releasedSlug, "qa", "qa-assessment.md"));
    writeFile(path.join(cwd, "intake", releasedSlug, "build", releasedSlug, "build-report.md"));
    writeFile(path.join(cwd, "intake", releasedSlug, "merge.json"), "{}");

    // hidden folder must be ignored
    writeFile(path.join(cwd, "intake", ".status-scratch", "notes.md"));

    const initiatives = scanIntakeForCwd(cwd);
    const bySlug = Object.fromEntries(initiatives.map((i) => [i.slug, i]));

    assert.equal(initiatives.length, 5);
    assert.equal(bySlug["2026-01-01-requested-only"].stage, "requested");
    assert.equal(bySlug["2026-01-02-planned"].stage, "planned");
    assert.equal(bySlug["2026-01-03-qa"].stage, "qa");
    assert.equal(bySlug[builtSlug].stage, "built");
    assert.equal(bySlug[releasedSlug].stage, "released");
    assert.equal(bySlug[releasedSlug].artifacts.merged, true);
  });
});

describe("scanProjectIntake", () => {
  it("aggregates initiatives across every mapped folder", () => {
    const cwdA = path.join(tmpDir, "agg-cwd-a");
    const cwdB = path.join(tmpDir, "agg-cwd-b");
    writeFile(path.join(cwdA, "intake", "item-a", "request-brief.md"));
    writeFile(path.join(cwdB, "intake", "item-b", "request-brief.md"));
    writeFile(path.join(cwdB, "intake", "item-b", "technical-plan.md"));

    const dbModule = {
      stmts: {
        listProjectPaths: {
          all: () => [
            { id: 1, project_id: "proj-1", cwd: cwdA },
            { id: 2, project_id: "proj-1", cwd: cwdB },
          ],
        },
      },
    };

    const report = scanProjectIntake(dbModule, { id: "proj-1" });
    const bySlug = Object.fromEntries(report.initiatives.map((i) => [i.slug, i]));

    assert.equal(report.initiatives.length, 2);
    assert.equal(bySlug["item-a"].stage, "requested");
    assert.equal(bySlug["item-a"].sourceCwd, cwdA);
    assert.equal(bySlug["item-b"].stage, "planned");
    assert.equal(bySlug["item-b"].sourceCwd, cwdB);
  });
});
