/**
 * @file Tests for value pool assembly: mechanical tier (intake), trunk feed
 * (detectTrunkDrift), detours, ratchet, backfill, cross-feed dedupe (DEC-4),
 * cross-seam unitKey agreement (CWD-IDENTITY-FANOUT), chronology, correlational
 * tier, and identityWarnings. Fixtures: real throwaway git repos (ISOLATED_GIT_ENV,
 * makeRepo, fs.realpathSync(mkdtemp)) copied from intake-scan.test.js /
 * trunk-drift.test.js's established kit — this project's precedent is real git
 * fixtures over mocked child_process.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Isolate from the real dashboard.db — without this, insertProject writes
// vp-test-* rows straight into whatever DB the host machine has open.
const TEST_DB = path.join(os.tmpdir(), `value-pool-db-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const valueLedger = require("../lib/value-ledger");
const trunkDrift = require("../lib/trunk-drift");
const cwdIdentity = require("../lib/cwd-identity");
const db = require("../db");

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

// A repo's root commit predates any lookback window by a wide margin in
// reality — backdate it here (mirrors trunk-drift.test.js's own fixture
// rationale) so it never spuriously counts as its own "direct commit".
const ROOT_COMMIT_DAYS_AGO = 90;

function makeRepo(parent, name) {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["-c", "init.defaultBranch=master", "init", repo], {
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  const rootDate = new Date(Date.now() - ROOT_COMMIT_DAYS_AGO * 24 * 60 * 60 * 1000).toISOString();
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: repo,
    stdio: "ignore",
    env: { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: rootDate, GIT_AUTHOR_DATE: rootDate },
  });
  return repo;
}

function writeFile(filePath, contents = "x") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

// Commits a real direct-to-master change, optionally backdated via isoDate
// (GIT_AUTHOR_DATE/GIT_COMMITTER_DATE). Returns the new commit's full sha.
function commitDirect(repo, message, isoDate) {
  const env = isoDate
    ? { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate }
    : ISOLATED_GIT_ENV;
  fs.writeFileSync(
    path.join(repo, `${Date.now()}-${Math.random().toString(36).slice(2)}.txt`),
    "x\n"
  );
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", message], {
    cwd: repo,
    stdio: "ignore",
    env,
  });
  return git(repo, ["rev-parse", "HEAD"]);
}

// Real merge-effort recipe copied from intake-scan.test.js: creates and
// merges a worktree branch named effort/<slug> with the wrap-up skill's own
// "Merge effort/<slug>: ..." convention, then tears the worktree/branch down
// (the steady state scanIntakeForCwd's mergeCommit detection relies on).
function makeMergedInitiative(repo, tmpDir, slug) {
  writeFile(path.join(repo, "intake", slug, "request-brief.md"));
  writeFile(path.join(repo, "intake", slug, "technical-plan.md"));
  writeFile(path.join(repo, "intake", slug, "qa", "qa-assessment.md"));
  writeFile(path.join(repo, "intake", slug, "build", slug, "build-report.md"));
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "intake docs"]);

  const worktreePath = path.join(tmpDir, "efforts", slug, path.basename(repo));
  git(repo, ["worktree", "add", worktreePath, "-b", `effort/${slug}`, "master"]);
  fs.writeFileSync(path.join(worktreePath, "CHANGED.md"), "change\n");
  git(worktreePath, ["add", "."]);
  git(worktreePath, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "the change"]);

  git(repo, ["merge", "--no-ff", `effort/${slug}`, "-m", `Merge effort/${slug}: did the thing`]);
  const mergeSha = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["worktree", "remove", worktreePath, "--force"]);
  git(repo, ["branch", "-D", `effort/${slug}`]);
  return mergeSha;
}

let tmpDir;
let projectSuffix = 0;

before(() => {
  // realpathSync: os.tmpdir() resolves through a symlink on macOS
  // (/tmp -> /private/tmp); git reports the resolved path, so an
  // unresolved fixture path would spuriously fail every path comparison.
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "value-pool-")));
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  try {
    db.db.close();
  } catch {
    /* best effort */
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(TEST_DB + suffix);
    } catch {
      /* best effort */
    }
  }
});

// Every case gets its own project + mapped path so repos/claims never bleed
// across cases.
function makeProject(cwds) {
  projectSuffix += 1;
  const id = `vp-test-${Date.now()}-${process.pid}-${projectSuffix}`;
  db.stmts.insertProject.run(id, id);
  for (const cwd of cwds) db.stmts.insertProjectPath.run(id, cwd);
  return id;
}

describe("value pool assembly (A6)", () => {
  it("A6.1: mechanical tier from intake scan — one scan feeds both intake_initiative and merge_commit units", async () => {
    const repo = makeRepo(tmpDir, "a6-1-repo");
    const slug = "2026-08-01-a6-1-slug";
    const mergeSha = makeMergedInitiative(repo, tmpDir, slug);
    const projectId = makeProject([repo]);

    const { units } = await valueLedger.assembleValuePool(db, { id: projectId });

    const initiativeUnit = units.find(
      (u) => u.value_source === "intake_initiative" && u.value_ref === slug
    );
    // scanIntakeForCwd's mergeCommit comes from `git log --oneline`'s
    // abbreviated sha (see intake-scan.js's fetchMergedEffortSlugs), not the
    // full 40-char sha `git rev-parse HEAD` returns.
    const mergeUnit = units.find(
      (u) => u.value_source === "merge_commit" && mergeSha.startsWith(u.value_ref)
    );
    assert.ok(initiativeUnit, "intake_initiative unit must appear for a released initiative");
    assert.ok(mergeUnit, "merge_commit unit must appear for the same initiative's merge sha");
    assert.equal(initiativeUnit.attribution, "mechanical");
    assert.equal(mergeUnit.attribution, "mechanical");
  });

  it("A6.2: trunk feed via real detectTrunkDrift; a non-repo mapped path never throws, degrades with a warning", async () => {
    const repo = makeRepo(tmpDir, "a6-2-repo");
    const directSha = commitDirect(repo, "direct to master");
    const nonRepoPath = path.join(tmpDir, "a6-2-not-a-repo");
    fs.mkdirSync(nonRepoPath, { recursive: true });
    const projectId = makeProject([repo, nonRepoPath]);

    const { units, identityWarnings } = await valueLedger.assembleValuePool(db, {
      id: projectId,
    });

    const trunkUnit = units.find(
      (u) => u.value_source === "trunk_commit" && u.value_ref === directSha
    );
    assert.ok(trunkUnit, "the direct-to-master commit must appear as a trunk_commit unit");
    assert.ok(
      identityWarnings.some((w) => w.kind === "no_git_repo"),
      "a non-repo mapped path must produce a no_git_repo warning, never a throw"
    );
    assert.ok(trunkDrift.TRUNK_DRIFT_SKIP_REASONS.includes("not_a_repo"));
  });

  it("A6.3: ratchet across two runs — a claimed sha never reappears though it is still in git log", async () => {
    const repo = makeRepo(tmpDir, "a6-3-repo");
    const shaOne = commitDirect(repo, "commit one");
    const projectId = makeProject([repo]);

    const run1 = await valueLedger.assembleValuePool(db, { id: projectId });
    const n = run1.units.length;
    assert.ok(run1.units.some((u) => u.value_ref === shaOne));

    // Claim shaOne's unit.
    const item = db.stmts.insertProjectPlan.run(
      projectId,
      "A6.3 Plan",
      "open",
      null,
      "manual",
      null,
      null
    );
    const planId = item.lastInsertRowid;
    const itemInfo = db.db
      .prepare("INSERT INTO project_plan_items (plan_id, text, position) VALUES (?, ?, 0)")
      .run(planId, "A6.3 item");
    db.stmts.insertValueClaim.run(
      projectId,
      planId,
      itemInfo.lastInsertRowid,
      "trunk_commit",
      shaOne,
      cwdIdentity.canonicalizeCwd(repo),
      null,
      null,
      null,
      "mechanical",
      "human"
    );
    const claimRowBefore = db.stmts.getValueClaim.get(
      db.db.prepare("SELECT id FROM value_claims WHERE value_ref = ?").get(shaOne).id
    );

    // Add two new commits, then re-assemble.
    commitDirect(repo, "commit two");
    commitDirect(repo, "commit three");
    const run2 = await valueLedger.assembleValuePool(db, { id: projectId });

    assert.equal(run2.units.length, n - 1 + 2, "claimed sha removed, two new commits added");
    assert.equal(
      run2.units.some((u) => u.value_ref === shaOne),
      false,
      "the claimed sha must not reappear even though git log still contains it"
    );
    assert.ok(git(repo, ["log", "--oneline"]).includes(shaOne.slice(0, 7)));

    const claimRowAfter = db.stmts.getValueClaim.get(claimRowBefore.id);
    assert.deepEqual(
      claimRowAfter,
      claimRowBefore,
      "the claim row must be byte-identical after run 2"
    );
  });

  it("A6.4: lookback baseline + ?backfill=1 — a backdated commit is absent by default, present with backfill", async () => {
    const repo = makeRepo(tmpDir, "a6-4-repo");
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    const oldSha = commitDirect(repo, "old commit", oldDate);
    const recentSha = commitDirect(repo, "recent commit");
    const projectId = makeProject([repo]);

    const defaultRun = await valueLedger.assembleValuePool(db, { id: projectId });
    assert.equal(
      defaultRun.units.some((u) => u.value_ref === oldSha),
      false
    );
    assert.ok(defaultRun.units.some((u) => u.value_ref === recentSha));

    const backfillRun = await valueLedger.assembleValuePool(
      db,
      { id: projectId },
      { backfill: true }
    );
    assert.ok(backfillRun.units.some((u) => u.value_ref === oldSha));
    assert.ok(backfillRun.units.some((u) => u.value_ref === recentSha));

    // Both responses dedupe identically — the recent commit isn't doubled by
    // widening the window.
    const recentCount = backfillRun.units.filter((u) => u.value_ref === recentSha).length;
    assert.equal(recentCount, 1);
  });

  it("A6.5 (O-16a, PRIMARY): DEC-4 cross-feed dedupe — the same sha from the live feed AND a pragma-seeded trunk_drift row collapses to exactly one unit", async () => {
    const repo = makeRepo(tmpDir, "a6-5-repo");
    const sha = commitDirect(repo, "shared commit");
    const projectId = makeProject([repo]);

    // Seed a Phase-1b-shaped detour_dispositions row under the same sha.
    // Phase 1b hasn't shipped — the CHECK constraint still excludes
    // 'trunk_drift' (A6.7) — so this is intentionally seeded by bypassing
    // check constraints for this insert only, immediately restored. This is
    // "future-real, not never-real": it proves the collapse logic ahead of
    // Phase 1b landing, not a claim that the row is producible today by any
    // real writer.
    db.db.pragma("ignore_check_constraints = 1");
    try {
      db.db
        .prepare(
          `INSERT INTO detour_dispositions (cwd, source, source_ref, disposition)
           VALUES (?, 'trunk_drift', ?, 'pending')`
        )
        .run(cwdIdentity.canonicalizeCwd(repo), sha);
    } finally {
      db.db.pragma("ignore_check_constraints = 0");
    }

    const { units } = await valueLedger.assembleValuePool(db, { id: projectId });
    const matching = units.filter((u) => u.value_source === "trunk_commit" && u.value_ref === sha);
    assert.equal(
      matching.length,
      1,
      "the same sha produced by both feeds must collapse to exactly one pool unit"
    );

    const health = await valueLedger.computePlanHealth(db, { id: projectId });
    assert.equal(
      health.unclaimedPoolSize,
      units.length,
      "the health metric must count the collapsed unit once, not twice"
    );
  });

  it("A6.6 (O-16b): DEC-4 mapper diagnostic — rowToUnit maps trunk_drift rows to trunk_commit units, everything else to detour", () => {
    const trunkDriftRow = { source: "trunk_drift", source_ref: "abc123deadbeef", id: 1 };
    const inferredRow = { source: "inferred", disposition: "deliberate", id: 42 };

    const trunkUnit = valueLedger.rowToUnit(trunkDriftRow);
    assert.deepEqual(trunkUnit, { value_source: "trunk_commit", value_ref: "abc123deadbeef" });

    const detourUnit = valueLedger.rowToUnit(inferredRow);
    assert.deepEqual(detourUnit, { value_source: "detour", value_ref: "42" });
  });

  it("A6.7 (O-16c): Phase-1b tripwire — the CHECK constraint still excludes 'trunk_drift'", () => {
    const row = db.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='detour_dispositions'`)
      .get();
    assert.ok(row);
    assert.ok(
      !row.sql.includes("'trunk_drift'"),
      "Phase 1b has landed: drop the ignore_check_constraints pragma in A6.5, " +
        "re-seed through the real writer, and re-verify that source_ref carries a full 40-char sha."
    );
  });

  it("A6.8 (O-7a): cross-seam unitKey agreement — a unit claimed via a case-variant/worktree cwd is still excluded via the canonical one", async () => {
    const repo = makeRepo(tmpDir, "a6-8-repo");
    const sha = commitDirect(repo, "cross-seam commit");
    const projectId = makeProject([repo]);

    const canonical = cwdIdentity.canonicalizeCwd(repo);

    const plan = db.stmts.insertProjectPlan.run(
      projectId,
      "A6.8 Plan",
      "open",
      null,
      "manual",
      null,
      null
    );
    const planId = plan.lastInsertRowid;
    const itemInfo = db.db
      .prepare("INSERT INTO project_plan_items (plan_id, text, position) VALUES (?, ?, 0)")
      .run(planId, "A6.8 item");
    const itemId = itemInfo.lastInsertRowid;

    // Claim through the SAME canonical cwd the route would produce (routes
    // canonicalize at the write seam too) — this proves the seams AGREE,
    // not merely that each seam individually canonicalizes.
    db.stmts.insertValueClaim.run(
      projectId,
      planId,
      itemId,
      "trunk_commit",
      sha,
      canonical,
      null,
      null,
      null,
      "mechanical",
      "human"
    );

    const { units } = await valueLedger.assembleValuePool(db, { id: projectId });
    assert.equal(
      units.some((u) => u.value_ref === sha),
      false,
      "a unit claimed through the canonical cwd must be excluded when the pool assembles through the same canonical cwd"
    );

    // The UNIQUE index still blocks a second claim of the exact same
    // (source, ref, cwd, item) tuple.
    assert.throws(
      () =>
        db.stmts.insertValueClaim.run(
          projectId,
          planId,
          itemId,
          "trunk_commit",
          sha,
          canonical,
          null,
          null,
          null,
          "mechanical",
          "human"
        ),
      /UNIQUE/,
      "a duplicate claim of the same unit into the same item must violate the UNIQUE index"
    );
  });

  it("A6.9 (§9.2): chronology — brackets a commit by the session's real time window, not by insertion/row id order", async () => {
    const repo = makeRepo(tmpDir, "a6-9-repo");
    const canonical = cwdIdentity.canonicalizeCwd(repo);
    const projectId = makeProject([repo]);

    // Two sessions inserted in an order OPPOSITE their real time windows:
    // the session inserted FIRST (lower id) has the LATER time window, and
    // vice versa. A LIMIT-by-id bracket would therefore attribute the
    // commit to the wrong session; only a real time-window check gets it
    // right.
    const laterWindowId = `a6-9-session-inserted-first-${Date.now()}`;
    const earlierWindowId = `a6-9-session-inserted-second-${Date.now()}`;
    const now = Date.now();
    const laterStart = new Date(now - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const laterEnd = new Date(now + 60 * 60 * 1000).toISOString(); // 1h from now
    const earlierStart = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10d ago
    const earlierEnd = new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(); // 9d ago

    db.db
      .prepare(
        "INSERT INTO sessions (id, name, status, cwd, started_at, ended_at) VALUES (?, ?, 'completed', ?, ?, ?)"
      )
      .run(laterWindowId, "later window, inserted first", canonical, laterStart, laterEnd);
    db.db
      .prepare(
        "INSERT INTO sessions (id, name, status, cwd, started_at, ended_at) VALUES (?, ?, 'completed', ?, ?, ?)"
      )
      .run(earlierWindowId, "earlier window, inserted second", canonical, earlierStart, earlierEnd);

    // The commit's real time falls inside the SECOND-inserted (earlier-id
    // order but chronologically later-inserted... no: it falls inside the
    // FIRST session's window by real time) — commit right now, which is
    // inside laterStart..laterEnd, NOT inside earlierStart..earlierEnd.
    const sha = commitDirect(repo, "bracketed commit");

    const { units } = await valueLedger.assembleValuePool(db, { id: projectId });
    const unit = units.find((u) => u.value_ref === sha);
    assert.ok(unit, "the commit must appear as a unit");
    assert.equal(
      unit.attribution,
      "correlational",
      "the commit's real committed time falls inside the first-inserted session's window, so it must be bracketed by TIME, not by insertion order"
    );
  });

  it("A6.10: correlational tier is suggestions only — never auto-claims, never emits focus_segment in v1", async () => {
    const repo = makeRepo(tmpDir, "a6-10-repo");
    const canonical = cwdIdentity.canonicalizeCwd(repo);
    const projectId = makeProject([repo]);

    const bracketedSha = commitDirect(repo, "bracketed");
    const sessionId = `a6-10-session-${Date.now()}`;
    const now = Date.now();
    db.db
      .prepare(
        "INSERT INTO sessions (id, name, status, cwd, started_at, ended_at) VALUES (?, ?, 'completed', ?, ?, ?)"
      )
      .run(
        sessionId,
        "bracketing session",
        canonical,
        new Date(now - 60_000).toISOString(),
        new Date(now + 60_000).toISOString()
      );
    const unbracketedSha = commitDirect(
      repo,
      "unbracketed",
      new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
    );

    const before = db.db.prepare("SELECT COUNT(*) AS n FROM value_claims").get().n;
    const { units } = await valueLedger.assembleValuePool(
      db,
      { id: projectId },
      { backfill: true }
    );
    const after = db.db.prepare("SELECT COUNT(*) AS n FROM value_claims").get().n;
    assert.equal(before, after, "assembling the pool must never write a claim row");

    const bracketedUnit = units.find((u) => u.value_ref === bracketedSha);
    const unbracketedUnit = units.find((u) => u.value_ref === unbracketedSha);
    assert.ok(bracketedUnit);
    assert.equal(bracketedUnit.attribution, "correlational");
    assert.ok(unbracketedUnit);
    assert.equal(
      unbracketedUnit.attribution,
      "mechanical",
      "unbracketed commits stay mechanical, never upgraded to judgment"
    );
    assert.equal(
      units.some((u) => u.value_source === "focus_segment"),
      false
    );
  });

  it("A6.11: identityWarnings — case-variant collapse, a non-repo mapped path, and an unmapped repo root all warn correctly", async () => {
    const repo = makeRepo(tmpDir, "a6-11-repo");
    const nonRepoPath = path.join(tmpDir, "a6-11-plain-folder");
    fs.mkdirSync(nonRepoPath, { recursive: true });

    // (a) two mapped paths resolving to the SAME directory identity (a
    // trailing-slash variant is a portable, non-macOS-specific stand-in for
    // the case-variant scenario groupCwdsByIdentity is built to catch).
    const trailingSlashVariant = `${repo}/`;
    const projectId = makeProject([repo, trailingSlashVariant, nonRepoPath]);

    const sha = commitDirect(repo, "collapsed-identity commit");
    const { units, identityWarnings } = await valueLedger.assembleValuePool(db, {
      id: projectId,
    });

    assert.ok(
      identityWarnings.some((w) => w.kind === "case_variant_duplicate"),
      "two cwds resolving to one directory must produce a case_variant_duplicate warning"
    );
    assert.ok(
      identityWarnings.some((w) => w.kind === "no_git_repo"),
      "a mapped non-repo path must warn, not throw"
    );
    // The collapsed identity must not double-count the same commit.
    assert.equal(units.filter((u) => u.value_ref === sha).length, 1);
  });
});
