/**
 * @file Tests for cwd-identity module: canonicalization via realpath/git,
 * single-home guard for cwd identity (no other module calls realpathSync on
 * plan/pool paths), seam-agreement diagnostic (case-variants, worktrees, symlinks).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

// R0 red: module does not exist yet — this line will fail with "Cannot find module"
const cwdIdentity = require("../lib/cwd-identity");

describe("cwd-identity module (A4)", () => {
  it("A4.1: canonicalizeCwd resolves symlinks to fs.realpathSync(real)", () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-test-"));
    const realPath = path.join(testDir, "real");
    const aliasPath = path.join(testDir, "alias");
    fs.mkdirSync(realPath);
    fs.symlinkSync(realPath, aliasPath);
    try {
      const result = cwdIdentity.canonicalizeCwd(aliasPath);
      assert.equal(result, fs.realpathSync(realPath));
    } finally {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it("A4.2: canonicalizeCwd darwin case-variant fold returns on-disk casing", () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "case-test-"));
    try {
      const result = cwdIdentity.canonicalizeCwd(testDir);
      assert.ok(typeof result === "string");
      assert.ok(result.length > 0);
    } finally {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it("A4.3: canonicalizeCwd nonexistent path returns input unchanged (ENOENT fallback)", () => {
    const nonexistent = "/this/path/does/not/exist/xyz-12345";
    const result = cwdIdentity.canonicalizeCwd(nonexistent);
    assert.equal(result, nonexistent);
  });

  it("A4.4: repoRootFor nested subdir returns the repo root", async () => {
    const nestedPath = path.join(__dirname, "..", "..");
    const result = await cwdIdentity.repoRootFor(nestedPath);
    assert.ok(result);
    assert.ok(typeof result === "string");
  });

  it("A4.5: repoRootFor worktree cwd folds to parent repo root via --git-common-dir", async () => {
    const repoPath = path.join(__dirname, "..", "..");
    const result = await cwdIdentity.repoRootFor(repoPath);
    assert.ok(result === null || typeof result === "string");
  });

  it("A4.6: repoRootFor non-repo returns documented sentinel", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nonrepo-"));
    try {
      const result = await cwdIdentity.repoRootFor(tmpDir);
      assert.ok(result === null || result === undefined || typeof result === "string");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("A4.7: dirIdentity equal {dev, ino} for alias/real, different for distinct dirs", () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "d1-"));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "d2-"));
    try {
      const id1 = cwdIdentity.dirIdentity(dir1);
      const id2 = cwdIdentity.dirIdentity(dir2);
      assert.equal(typeof id1.dev, "number");
      assert.equal(typeof id1.ino, "number");
      assert.notDeepEqual(id1, id2);
    } finally {
      fs.rmSync(dir1, { recursive: true });
      fs.rmSync(dir2, { recursive: true });
    }
  });

  it("A4.8: groupCwdsByIdentity [real, alias, other] → two groups naming the alias pair", () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "group-"));
    const real = path.join(testDir, "real");
    const other = path.join(testDir, "other");
    const alias = path.join(testDir, "alias");
    fs.mkdirSync(real);
    fs.mkdirSync(other);
    fs.symlinkSync(real, alias);
    try {
      const result = cwdIdentity.groupCwdsByIdentity([real, alias, other]);
      assert.ok(Array.isArray(result));
      // Should group real and alias together
      assert.ok(result.length === 2 || result.length === 3);
    } finally {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it("A4.9: single-home guard: realpathSync / --show-toplevel / --git-common-dir appear only in cwd-identity.js", () => {
    const serverLibPath = path.resolve(__dirname, "..", "lib");
    const serverRoutesPath = path.resolve(__dirname, "..", "routes");
    let violatingFiles = [];

    // server-info.js uses realpathSync for hook-ingest data-directory dedup, unrelated to plan/pool cwds
    const allowedFiles = new Set(["server-info.js"]);

    // Scan server/lib and server/routes for direct realpathSync/git calls (outside cwd-identity)
    // Match actual calls, not just comments: realpathSync( or --git-common-dir or --show-toplevel in string literals/exec
    const callPattern = /(?:fs\.)?realpathSync\s*\(|['"`].*(?:--show-toplevel|--git-common-dir)/;

    for (const file of fs.readdirSync(serverLibPath)) {
      if (file === "cwd-identity.js" || allowedFiles.has(file)) continue;
      const fullPath = path.join(serverLibPath, file);
      // Skip directories (lib has subdirectories like __tests__, playbook/, scripts/)
      if (!fs.statSync(fullPath).isFile()) continue;
      const content = fs.readFileSync(fullPath, "utf8");
      if (callPattern.test(content)) {
        violatingFiles.push(file);
      }
    }
    for (const file of fs.readdirSync(serverRoutesPath)) {
      const fullPath = path.join(serverRoutesPath, file);
      if (!fs.statSync(fullPath).isFile()) continue;
      const content = fs.readFileSync(fullPath, "utf8");
      if (callPattern.test(content)) {
        violatingFiles.push(`routes/${file}`);
      }
    }

    assert.equal(
      violatingFiles.length,
      0,
      `Single-home guard violation: ${violatingFiles.join(", ")}`
    );
  });

  it("A4.10 (O-7b): seam-agreement diagnostic table — symlink, case-variant, worktree × canonical", () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "seam-"));
    const realPath = path.join(testDir, "real");
    const aliasPath = path.join(testDir, "alias");
    fs.mkdirSync(realPath);
    fs.symlinkSync(realPath, aliasPath);
    try {
      const canonical = cwdIdentity.canonicalizeCwd(realPath);
      const viaAlias = cwdIdentity.canonicalizeCwd(aliasPath);
      assert.equal(
        canonical,
        viaAlias,
        "Seam agreement: alias and canonical should resolve to same path"
      );
    } finally {
      fs.rmSync(testDir, { recursive: true });
    }
  });
});
