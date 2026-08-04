/**
 * @file Structural guard against rogue raw-field reads (T4).
 * Enforces that practice.kind and practice.defaultSeverity are only read raw
 * inside the single resolver (practices.js), preventing the "constant becomes
 * variable" trap when overrides are introduced (§9.1 DERIVED-DUAL-VIEW,
 * §9.3 VACUOUS-GUARD).
 *
 * The guard scans source files for raw reads of these fields and asserts that
 * only the expected locations contain them. If this test fails:
 * - engine.js or serializePractice() is reading practice.kind directly
 *   instead of from resolvePracticeConfig()
 * - PlaybookPage.tsx is hardcoding practice.kind in a preview card instead of
 *   reading the resolved draft value
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function scanFiles(dir, pattern, extensions = [".js"]) {
  const results = [];
  const walk = (p) => {
    const entries = fs.readdirSync(p, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (["node_modules", "dist", "__tests__"].includes(entry.name)) continue;
      const fullPath = path.join(p, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (pattern.test(content)) {
          results.push(entry.name);
        }
      }
    }
  };
  walk(dir);
  return [...new Set(results)]; // unique basenames
}

describe("Single-resolver structural guard (§9.1 DERIVED-DUAL-VIEW, this practice's effective kind/severity)", () => {
  it("practice.kind / practice.defaultSeverity are read raw only inside server/lib/playbook/practices.js", () => {
    const pattern = /practice\.kind\b|practice\.defaultSeverity\b/;
    const dirs = [path.join(__dirname, "..", "lib"), path.join(__dirname, "..", "routes")];
    const files = [];
    for (const dir of dirs) {
      files.push(...scanFiles(dir, pattern));
    }
    assert.deepEqual(
      files.sort(),
      ["practices.js"],
      "raw practice.kind/practice.defaultSeverity reads must only appear in practices.js. Check: did you add a resolver call or is the resolver not being used?"
    );
  });

  it("engine.js contains zero raw practice.kind / practice.defaultSeverity reads — both evaluateSession() and evaluateGlobal() must read the resolved value (§9.4)", () => {
    const enginePath = path.join(__dirname, "..", "lib", "playbook", "engine.js");
    const content = fs.readFileSync(enginePath, "utf8");
    const pattern = /practice\.kind\b|practice\.defaultSeverity\b/;
    const matches = content.match(pattern);
    assert.equal(
      matches ? matches.length : 0,
      0,
      "engine.js must read resolved kind/severity from destructured parameters, not raw practice.kind/practice.defaultSeverity. Both evaluateSession() and evaluateGlobal() must be fixed together (§9.4)."
    );
  });

  it("client/src reads practice.kind / practice.defaultSeverity nowhere but types.ts's interface declaration", () => {
    const pattern = /practice\.kind\b|practice\.defaultSeverity\b/;
    const files = scanFiles(path.join(__dirname, "..", "..", "client", "src"), pattern, [
      ".ts",
      ".tsx",
    ]);
    assert.deepEqual(
      files.sort(),
      ["types.ts"],
      "raw practice.kind/practice.defaultSeverity reads in client/src must only appear in types.ts (interface declaration). Check: did a preview card hardcode the catalog value again instead of reading the resolved draft value?"
    );
  });
});
