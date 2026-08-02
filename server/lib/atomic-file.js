/**
 * server/lib/atomic-file.js
 *
 * Atomic write primitive: tmp file + fsync + rename, with fail-safe cleanup.
 * Extracted from server/lib/cc-mutate.js (which now imports it) so it can
 * serve as dual-consumer infrastructure for layer 4's plan write-back
 * (server/lib/plan-writeback.js) without a second, drifting copy of the same
 * "write safely to a human-owned file" logic. Callers are responsible for
 * ensuring the parent directory exists — this primitive does not create one,
 * so a genuinely missing directory surfaces as a real ENOENT rather than
 * being silently papered over.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");

/**
 * Atomic write: tmp file → fsync (best-effort) → rename. Tmp is unlinked on
 * any failure path, including a missing parent directory. Caller is
 * responsible for ensuring the parent dir exists.
 */
function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    // Exclusive create+write in one call: a stray leftover tmp from a prior
    // crash never gets silently overwritten mid-write, and a missing parent
    // directory throws its natural ENOENT here rather than being masked.
    fs.writeFileSync(tmp, content, { flag: "wx" });
    try {
      const fd = fs.openSync(tmp, "r+");
      try {
        fs.fsyncSync(fd);
      } catch {
        // fsync may fail on some filesystems / tmpfs — non-fatal
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Best-effort fsync open; if it fails, still proceed to rename.
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

module.exports = {
  atomicWriteFile,
};
