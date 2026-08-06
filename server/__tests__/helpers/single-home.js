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

// Directories this D2 durable-cure helper scans for real importers — every
// production location a module could plausibly be required from. server/
// index.js is included as a single explicit file (not a directory) because
// it is the boot-hook consumer (reconcileInterruptedGroupRuns) and lives one
// level above server/lib and server/routes — missing it is exactly §9.7's
// under-registration failure mode (a build that registers value-groups.js's
// route consumer but forgets its boot-hook consumer).
function defaultScanTargets(repoRoot) {
  return [
    path.join(repoRoot, "server", "lib"),
    path.join(repoRoot, "server", "routes"),
    path.join(repoRoot, "bin"),
    path.join(repoRoot, "server", "index.js"),
  ];
}

function collectJsFiles(target, excludeDirs) {
  const files = [];
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!stat) return files;
  if (stat.isFile()) {
    if (target.endsWith(".js")) files.push(target);
    return files;
  }
  for (const entry of fs.readdirSync(target)) {
    if (excludeDirs.has(entry)) continue;
    const full = path.join(target, entry);
    const entryStat = fs.statSync(full);
    if (entryStat.isDirectory()) {
      files.push(...collectJsFiles(full, excludeDirs));
    } else if (entryStat.isFile() && entry.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * D2 durable-cure helper (§9.7 HAND-SCOPED STRUCTURAL SCAN): generalizes the
 * derived, fail-closed importer scan mandated for value-coverage-probe.js to
 * every registration point. Scans server/lib, server/routes, bin/, and
 * server/index.js for the module's OWN import specifier at each candidate
 * file (never a hand-typed guess — computed per-file, same as
 * {@link assertSingleHome}), then FAILS CLOSED (throws) on any real importer
 * absent from `expectedDispositions` — never a silent `continue`. This is
 * the cure for the 7-occurrence hand-registration class this project has
 * recorded: a registry that is correct the day it is written but silently
 * stops being checked the day a new file starts importing the module.
 *
 * Intentionally does NOT require the reverse (every key in
 * `expectedDispositions` must be a real importer) — some registered
 * consumers (e.g. bin/ccam.js's cmdLedger) reach a module's derived values
 * over HTTP, not a literal require() edge, and are still legitimate,
 * documented consumers (value-ledger.js's own CONSUMERS registry) that this
 * require()-graph scan cannot and should not police.
 *
 * @param {string} sharedModulePath - require path to the shared module,
 *        relative to server/__tests__/ (or options.callerDir)
 * @param {Object.<string, object>} expectedDispositions - keyed by require
 *        path (relative to the same base), one entry per reviewed consumer.
 *        Values are unused by this helper (export-level disposition is
 *        {@link assertSingleHome}'s job) — presence of the key is the
 *        registration.
 * @param {{callerDir?: string, extraScanFiles?: string[]}} [options]
 * @returns {string[]} the derived (real) importer file list
 */
function assertConsumerScopeDerived(sharedModulePath, expectedDispositions, options = {}) {
  const callerDir = options.callerDir || DEFAULT_CALLER_DIR;
  const sharedModuleFullPath = require.resolve(path.resolve(callerDir, sharedModulePath));
  const repoRoot = path.resolve(callerDir, "..", "..");
  const excludeDirs = new Set(["node_modules", "dist", "__tests__", "test"]);

  const scanTargets = [...defaultScanTargets(repoRoot), ...(options.extraScanFiles || [])];
  const candidateFiles = new Set();
  for (const target of scanTargets) {
    for (const f of collectJsFiles(target, excludeDirs)) candidateFiles.add(f);
  }
  candidateFiles.delete(sharedModuleFullPath);

  const realImporters = [];
  for (const file of candidateFiles) {
    const src = fs.readFileSync(file, "utf8");
    const specifier = computeRelativeImportSpecifier(file, sharedModuleFullPath);
    const importRegex = new RegExp(`require\\(["']${escapeRegExp(specifier)}["']\\)`);
    if (importRegex.test(src)) realImporters.push(file);
  }
  realImporters.sort();

  const expectedFullPaths = new Set(
    Object.keys(expectedDispositions).map((p) => require.resolve(path.resolve(callerDir, p)))
  );

  for (const importer of realImporters) {
    // FAIL CLOSED — never `continue`. An undisposed real importer is
    // exactly §9.7's under-registration failure mode.
    if (!expectedFullPaths.has(importer)) {
      throw new Error(
        `assertConsumerScopeDerived: ${path.relative(repoRoot, importer)} imports ` +
          `${path.basename(sharedModuleFullPath)} but has no entry in expectedDispositions — ` +
          `every real importer must be a reviewed, deliberate registration (§9.7)`
      );
    }
  }

  return realImporters;
}

module.exports = { assertSingleHome, assertConsumerScopeDerived };
