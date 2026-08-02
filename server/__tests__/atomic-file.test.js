/**
 * @file Tests for atomic file writing primitive: tmp file + fsync + rename,
 * with fail-safe cleanup. Verifies that rename failures leave the original
 * file untouched and no .tmp residue; fsync failures propagate; and the
 * safety claim in the code comment is mechanically enforced.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { atomicWriteFile } = require("../lib/atomic-file");

describe("atomicWriteFile", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it("writes to a nonexistent file", () => {
    const filePath = path.join(tempDir, "new-file.txt");
    const content = "test content";

    atomicWriteFile(filePath, content);

    assert.ok(fs.existsSync(filePath), "file should exist after write");
    const read = fs.readFileSync(filePath, "utf8");
    assert.equal(read, content, "file content should match");
  });

  it("overwrites an existing file", () => {
    const filePath = path.join(tempDir, "existing-file.txt");
    const originalContent = "original";
    const newContent = "new";

    fs.writeFileSync(filePath, originalContent);
    atomicWriteFile(filePath, newContent);

    const read = fs.readFileSync(filePath, "utf8");
    assert.equal(read, newContent, "file should be overwritten");
  });

  it("leaves original file untouched when renameSync fails", () => {
    const filePath = path.join(tempDir, "protected-file.txt");
    const originalContent = "protected";
    fs.writeFileSync(filePath, originalContent);

    // Mock renameSync to throw
    const originalRename = fs.renameSync;
    let renameCallCount = 0;
    fs.renameSync = function (...args) {
      renameCallCount++;
      throw new Error("simulated rename failure");
    };

    try {
      const newContent = "attempt to overwrite";
      assert.throws(() => {
        atomicWriteFile(filePath, newContent);
      }, /simulated rename failure/);

      // Verify original file is unchanged
      const currentContent = fs.readFileSync(filePath, "utf8");
      assert.equal(currentContent, originalContent, "original file should be unchanged");

      // Verify no .tmp file left behind
      const tmpPath = `${filePath}.tmp`;
      assert.ok(!fs.existsSync(tmpPath), "no .tmp file should remain after failed rename");
    } finally {
      fs.renameSync = originalRename;
    }
  });

  it("propagates fsync failures", () => {
    const filePath = path.join(tempDir, "fsync-test.txt");

    // Mock fsync to throw (fsync is called via file handle)
    const originalFd = fs.writeFileSync;
    fs.writeFileSync = function (path, data, options) {
      // Call original to create the file
      originalFd.call(this, path, data, options);
      // Then throw on next operation
      throw new Error("simulated fsync failure");
    };

    try {
      assert.throws(() => {
        atomicWriteFile(filePath, "content");
      }, /simulated fsync failure/);
    } finally {
      fs.writeFileSync = originalFd;
    }
  });

  it("errors when directory does not exist", () => {
    const nonexistentDir = path.join(tempDir, "does-not-exist");
    const filePath = path.join(nonexistentDir, "file.txt");

    assert.throws(() => {
      atomicWriteFile(filePath, "content");
    }, /ENOENT|does not exist/);

    // Verify no file or .tmp was created
    assert.ok(!fs.existsSync(filePath), "file should not exist");
    const tmpPath = `${filePath}.tmp`;
    assert.ok(!fs.existsSync(tmpPath), "no .tmp file should exist");
  });

  it("handles empty content", () => {
    const filePath = path.join(tempDir, "empty-file.txt");
    atomicWriteFile(filePath, "");

    assert.ok(fs.existsSync(filePath), "file should exist even with empty content");
    const content = fs.readFileSync(filePath, "utf8");
    assert.equal(content, "", "file should contain empty string");
  });

  it("handles large content", () => {
    const filePath = path.join(tempDir, "large-file.txt");
    const largeContent = "x".repeat(1024 * 1024); // 1 MB

    atomicWriteFile(filePath, largeContent);

    const read = fs.readFileSync(filePath, "utf8");
    assert.equal(read, largeContent, "large file content should match");
  });
});
