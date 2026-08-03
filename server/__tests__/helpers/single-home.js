/**
 * @file Durable-cure helper for §9.7 HAND-SCOPED STRUCTURAL SCAN: validates
 * that every export from a shared module has an explicit disposition (shared,
 * private, or absent) at each consumer, and that scope is derived from the
 * artifact, never hand-typed. Prevents exports from drifting between
 * consumers unnoticed.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");

// Fixed absolute anchor: every current and expected caller of this helper
// passes sharedModulePath/consumers paths relative to server/__tests__/ (the
// directory test files live in — one level up from this helpers/ dir), NOT
// relative to this file's own location. Resolving require paths against this
// file's own __dirname (server/__tests__/helpers/) silently resolves one
// directory too deep and was the first of the two shipped bugs. Callers that
// live somewhere other than server/__tests__/ directly can override this via
// the optional third `options.callerDir` argument.
const DEFAULT_CALLER_DIR = path.join(__dirname, "..");

/**
 * Escapes a string for safe embedding inside a RegExp.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Computes the relative import specifier a file at `fromFile` would use to
 * `require(...)` the module at `toFile` — e.g. two siblings in server/lib/
 * resolve to "./git-refs", never the caller-test-file's own relative path to
 * the shared module. Each consumer must be checked against ITS OWN actual
 * import string, not the test file's.
 *
 * @param {string} fromFile - absolute path of the requiring file
 * @param {string} toFile - absolute path of the required module
 * @returns {string}
 */
function computeRelativeImportSpecifier(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile);
  rel = rel.split(path.sep).join("/");
  rel = rel.replace(/\.js$/, "");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

/**
 * Validates that every export from sharedModulePath has an explicit
 * disposition at each consumer.
 *
 * @param {string} sharedModulePath - require path to the shared module,
 *        relative to server/__tests__/ (or to options.callerDir if given)
 * @param {Object.<string, {shared?: string[], private?: string[], absent?: string[]}>} consumers
 *        keyed by require path (relative to the same base as sharedModulePath),
 *        each mapping to { shared, private, absent } arrays
 * @param {{callerDir?: string}} [options]
 */
function assertSingleHome(sharedModulePath, consumers, options = {}) {
  const callerDir = options.callerDir || DEFAULT_CALLER_DIR;

  // Derive scope from the artifact: Object.keys(require(...))
  const sharedModuleFullPath = require.resolve(path.resolve(callerDir, sharedModulePath));
  const exports = Object.keys(require(sharedModuleFullPath));

  for (const [consumerPath, dispositions] of Object.entries(consumers)) {
    const consumerFullPath = require.resolve(path.resolve(callerDir, consumerPath));
    const consumerSrc = fs.readFileSync(consumerFullPath, "utf8");

    // This consumer's OWN import string for the shared module (e.g.
    // "./git-refs" for a sibling in server/lib/), never the test file's own
    // relative path to it — that was the second shipped bug.
    const importSpecifier = computeRelativeImportSpecifier(consumerFullPath, sharedModuleFullPath);
    const escapedSpecifier = escapeRegExp(importSpecifier);

    const { shared = [], private: privateNames = [], absent = [] } = dispositions;
    const allDispositions = new Set([...shared, ...privateNames, ...absent]);

    // Check 1: every export must have a disposition
    for (const exportName of exports) {
      assert.ok(
        allDispositions.has(exportName),
        `${path.basename(sharedModuleFullPath)} exports '${exportName}' but ${consumerPath} gives it no disposition`
      );
    }

    // Check 2: shared names must appear in destructure
    for (const name of shared) {
      const destructureRegex = new RegExp(
        `\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*require\\(["']${escapedSpecifier}["']\\)`,
        "s"
      );
      assert.match(
        consumerSrc,
        destructureRegex,
        `${consumerPath} must import '${name}' from ${importSpecifier} (resolved from ${sharedModulePath})`
      );
    }

    // Check 3: private names must NOT appear in destructure, but must be locally declared
    for (const name of privateNames) {
      const destructureRegex = new RegExp(
        `\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*require\\(["']${escapedSpecifier}["']\\)`
      );
      assert.doesNotMatch(
        consumerSrc,
        destructureRegex,
        `${consumerPath} must NOT import '${name}' from ${importSpecifier} (keep private copy local)`
      );

      const localDeclareRegex = new RegExp(
        `(async\\s+)?function\\s+${name}\\s*\\(|(const|let|var)\\s+${name}\\s*=`,
        "m"
      );
      assert.match(
        consumerSrc,
        localDeclareRegex,
        `${consumerPath} must declare its own local '${name}'`
      );
    }

    // Check 4: absent names must match neither destructure nor local declaration
    for (const name of absent) {
      const destructureRegex = new RegExp(
        `\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*require\\(["']${escapedSpecifier}["']\\)`
      );
      assert.doesNotMatch(
        consumerSrc,
        destructureRegex,
        `${consumerPath} must not import '${name}' from ${importSpecifier}`
      );

      const localDeclareRegex = new RegExp(
        `(async\\s+)?function\\s+${name}\\s*\\(|(const|let|var)\\s+${name}\\s*=`,
        "m"
      );
      assert.doesNotMatch(
        consumerSrc,
        localDeclareRegex,
        `${consumerPath} must not have local '${name}'`
      );
    }
  }
}

module.exports = { assertSingleHome };
