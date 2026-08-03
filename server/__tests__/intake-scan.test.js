/**
 * @file Tests for server/lib/intake-scan.js against real tmp-dir folder
 * trees mirroring the delivery-team pipeline's intake/<slug>/ artifact
 * layout, for every stage combination, plus real throwaway git repos for the
 * live-worktree and git-detected-merge cross-referencing (not mocked
 * child_process — matching this project's established real-git-fixture test
 * pattern, see repo-topology.test.js). Also covers findIntakeDirs's
 * depth-capped walk for intake/ directories nested below a mapped folder's
 * own root.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  deriveIntakeStage,
  scanIntakeForCwd,
  scanProjectIntake,
  findIntakeDirs,
  INTAKE_SCAN_MAX_DEPTH,
} = require("../lib/intake-scan");

// See repo-topology.test.js / update-check.test.js for why this stripping is
// required: ambient GIT_DIR/GIT_WORK_TREE from hooks would otherwise
// redirect these fixture git calls at the real repo this suite runs inside.
const GIT_ENV_OVERRIDE_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];
const ISOLATED_GIT_ENV = { ...process.env };
for (const key of GIT_ENV_OVERRIDE_KEYS) delete ISOLATED_GIT_ENV[key];

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: ISOLATED_GIT_ENV,
  }).trim();
}

function makeRepo(parent, name) {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["-c", "init.defaultBranch=master", "init", repo], {
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]);
  return repo;
}

let tmpDir;

before(() => {
  // realpathSync: on macOS os.tmpdir() resolves through a /tmp -> /private/tmp
  // symlink; `git worktree list` reports the resolved path, so comparing
  // against an unresolved fixture path would spuriously fail.
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "intakescan-")));
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
  it("returns [] when there is no intake/ directory", async () => {
    const cwd = path.join(tmpDir, "no-intake-cwd");
    fs.mkdirSync(cwd, { recursive: true });
    assert.deepEqual(await scanIntakeForCwd(cwd), []);
  });

  it("infers each slug's stage from its real artifact layout, on a non-git folder", async () => {
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

    const initiatives = await scanIntakeForCwd(cwd);
    const bySlug = Object.fromEntries(initiatives.map((i) => [i.slug, i]));

    assert.equal(initiatives.length, 5);
    assert.equal(bySlug["2026-01-01-requested-only"].stage, "requested");
    assert.equal(bySlug["2026-01-02-planned"].stage, "planned");
    assert.equal(bySlug["2026-01-03-qa"].stage, "qa");
    assert.equal(bySlug[builtSlug].stage, "built");
    assert.equal(bySlug[releasedSlug].stage, "released");
    assert.equal(bySlug[releasedSlug].artifacts.merged, true);

    // Non-git folder: no worktree/merge cross-referencing is possible or
    // attempted, and that must not crash or misreport.
    for (const initiative of initiatives) {
      assert.equal(initiative.worktree, null);
      assert.equal(initiative.mergeCommit, null);
    }
    assert.equal(bySlug[releasedSlug].mergeRecorded, true);
    assert.equal(bySlug[builtSlug].mergeRecorded, false);
  });

  it("attaches the live effort worktree for a slug that has one", async () => {
    const cwd = makeRepo(tmpDir, "repo-with-live-worktree");
    const slug = "2026-02-01-in-progress";
    writeFile(path.join(cwd, "intake", slug, "request-brief.md"));
    writeFile(path.join(cwd, "intake", slug, "technical-plan.md"));
    writeFile(path.join(cwd, "intake", slug, "qa", "qa-assessment.md"));

    const worktreePath = path.join(tmpDir, "efforts", slug, "repo-with-live-worktree");
    git(cwd, ["worktree", "add", worktreePath, "-b", `effort/${slug}`, "master"]);

    const initiatives = await scanIntakeForCwd(cwd);
    const initiative = initiatives.find((i) => i.slug === slug);

    assert.equal(initiative.stage, "qa");
    assert.ok(initiative.worktree);
    assert.equal(initiative.worktree.branch, `effort/${slug}`);
    assert.equal(initiative.worktree.path, worktreePath);
    assert.equal(initiative.mergeCommit, null);
  });

  it("has no live worktree for a slug whose build hasn't been triaged yet", async () => {
    const cwd = makeRepo(tmpDir, "repo-requested-only");
    const slug = "2026-02-02-not-started";
    writeFile(path.join(cwd, "intake", slug, "request-brief.md"));

    const initiatives = await scanIntakeForCwd(cwd);
    const initiative = initiatives.find((i) => i.slug === slug);

    assert.equal(initiative.worktree, null);
  });

  it("detects a merge via git log even when merge.json was never written", async () => {
    const cwd = makeRepo(tmpDir, "repo-merged-without-merge-json");
    const slug = "2026-02-03-merged-no-doc";
    writeFile(path.join(cwd, "intake", slug, "request-brief.md"));
    writeFile(path.join(cwd, "intake", slug, "technical-plan.md"));
    writeFile(path.join(cwd, "intake", slug, "qa", "qa-assessment.md"));
    writeFile(path.join(cwd, "intake", slug, "build", slug, "build-report.md"));
    git(cwd, ["add", "."]);
    git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "intake docs"]);

    const worktreePath = path.join(tmpDir, "efforts", slug, "repo-merged-without-merge-json");
    git(cwd, ["worktree", "add", worktreePath, "-b", `effort/${slug}`, "master"]);
    fs.writeFileSync(path.join(worktreePath, "CHANGED.md"), "change\n");
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "the change"]);

    git(cwd, ["merge", "--no-ff", `effort/${slug}`, "-m", `Merge effort/${slug}: did the thing`]);
    git(cwd, ["worktree", "remove", worktreePath, "--force"]);
    git(cwd, ["branch", "-D", `effort/${slug}`]);

    const initiatives = await scanIntakeForCwd(cwd);
    const initiative = initiatives.find((i) => i.slug === slug);

    // No merge.json was ever written for this slug.
    assert.equal(initiative.mergeRecorded, false);
    assert.ok(initiative.mergeCommit);
    assert.equal(initiative.artifacts.merged, true);
    assert.equal(initiative.stage, "released");
    // The branch is gone (deleted post-merge), so there is no live worktree.
    assert.equal(initiative.worktree, null);
  });
});

describe("findIntakeDirs (depth-capped intake/ discovery)", () => {
  it("finds intake/ nested under a subfolder, not just at the mapped cwd's own root", async () => {
    // Mirrors a real layout: intake/ lives under an app/ subfolder rather
    // than the mapped folder's own root.
    const cwd = path.join(tmpDir, "nested-one-level-cwd");
    writeFile(path.join(cwd, "app", "intake", "2026-03-01-nested", "request-brief.md"));

    assert.deepEqual(findIntakeDirs(cwd), [path.join(cwd, "app", "intake")]);

    const initiatives = await scanIntakeForCwd(cwd);
    assert.equal(initiatives.length, 1);
    assert.equal(initiatives[0].slug, "2026-03-01-nested");
    assert.equal(initiatives[0].stage, "requested");
  });

  it(`finds intake/ up to ${INTAKE_SCAN_MAX_DEPTH} levels deep but not beyond`, () => {
    // At the cap: two intermediate folders between cwd and intake/.
    const atCapCwd = path.join(tmpDir, "nested-at-cap-cwd");
    writeFile(path.join(atCapCwd, "a", "b", "intake", "slug", "request-brief.md"));
    assert.deepEqual(findIntakeDirs(atCapCwd), [path.join(atCapCwd, "a", "b", "intake")]);

    // One level past the cap: three intermediate folders - must not be found.
    const pastCapCwd = path.join(tmpDir, "nested-past-cap-cwd");
    writeFile(path.join(pastCapCwd, "a", "b", "c", "intake", "slug", "request-brief.md"));
    assert.deepEqual(findIntakeDirs(pastCapCwd), []);
  });

  it("skips well-known dependency/build directories while walking, same as repo-topology.js", async () => {
    const cwd = path.join(tmpDir, "excluded-dir-cwd");
    writeFile(path.join(cwd, "node_modules", "some-pkg", "intake", "slug", "request-brief.md"));
    // A real intake/ elsewhere under the same cwd must still be found -
    // exclusion only skips that one branch, not the whole walk.
    writeFile(path.join(cwd, "app", "intake", "2026-03-02-real", "request-brief.md"));

    assert.deepEqual(findIntakeDirs(cwd), [path.join(cwd, "app", "intake")]);

    const initiatives = await scanIntakeForCwd(cwd);
    assert.equal(initiatives.length, 1);
    assert.equal(initiatives[0].slug, "2026-03-02-real");
  });

  it("stops descending once an intake/ dir is found, never reporting an intake-within-intake", () => {
    const cwd = path.join(tmpDir, "double-intake-cwd");
    writeFile(path.join(cwd, "intake", "outer-slug", "intake", "inner-slug", "request-brief.md"));

    assert.deepEqual(findIntakeDirs(cwd), [path.join(cwd, "intake")]);
  });
});

describe("scanProjectIntake", () => {
  it("aggregates initiatives across every mapped folder", async () => {
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

    const report = await scanProjectIntake(dbModule, { id: "proj-1" });
    const bySlug = Object.fromEntries(report.initiatives.map((i) => [i.slug, i]));

    assert.equal(report.initiatives.length, 2);
    assert.equal(bySlug["item-a"].stage, "requested");
    assert.equal(bySlug["item-a"].sourceCwd, cwdA);
    assert.equal(bySlug["item-b"].stage, "planned");
    assert.equal(bySlug["item-b"].sourceCwd, cwdB);
  });
});
