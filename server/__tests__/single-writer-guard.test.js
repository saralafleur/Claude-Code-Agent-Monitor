/**
 * @file Structural guard: verifies that the plan-writeback write path is
 * single-composer and single-call-site via source-code scanning. A future
 * third write-composer or a second appendPlanItem call site must fail this
 * test, not ship silently. This is the executable mitigation for WATCH-11
 * and DEC-14 (single write path form).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { assertSingleHome } = require("./helpers/single-home");

// Recursively scan a directory for .js files, skipping node_modules, dist, tests
function scanFiles(dir, pattern) {
  const results = [];
  const excludeDirs = ["node_modules", "dist", "__tests__", "test"];

  function walk(current) {
    const entries = fs.readdirSync(current);
    for (const entry of entries) {
      if (excludeDirs.includes(entry)) continue;
      const fullPath = path.join(current, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && entry.endsWith(".js")) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (pattern.test(content)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results.sort();
}

describe("Single-writer structural guard (§9.1 DERIVED-DUAL-VIEW)", () => {
  const serverDir = path.resolve(__dirname, "..");

  it("upsertPlanItem has exactly one call site — plan-ingest.js", () => {
    const upsertCallPattern = /upsertPlanItem/;
    const files = scanFiles(serverDir, upsertCallPattern);

    // Should appear in db.js (definition) and plan-ingest.js (caller)
    assert.ok(
      files.some((f) => f.includes("db.js")),
      "upsertPlanItem should be defined in db.js"
    );
    assert.ok(
      files.some((f) => f.includes("plan-ingest.js")),
      "upsertPlanItem should be called in plan-ingest.js"
    );

    // Verify only these two files (in production code)
    const prodFiles = files.filter((f) => !f.includes("__tests__") && !f.includes(".test.js"));
    const fileNames = prodFiles.map((f) => path.basename(f));
    assert.ok(fileNames.includes("db.js"), "db.js should contain upsertPlanItem");
    assert.ok(fileNames.includes("plan-ingest.js"), "plan-ingest.js should contain upsertPlanItem");

    // Should not appear in other production files
    const other = fileNames.filter((f) => f !== "db.js" && f !== "plan-ingest.js");
    assert.equal(
      other.length,
      0,
      `upsertPlanItem should only appear in db.js and plan-ingest.js, not in: ${other.join(", ")}`
    );
  });

  it("no direct INSERT INTO plan_items outside db.js", () => {
    const insertPattern = /INSERT\s+INTO\s+plan_items/i;
    const files = scanFiles(serverDir, insertPattern);

    // Filter to production code only
    const prodFiles = files.filter((f) => !f.includes("__tests__") && !f.includes(".test.js"));

    assert.deepEqual(
      prodFiles.map((f) => path.basename(f)),
      ["db.js"],
      "INSERT INTO plan_items should only appear in db.js"
    );
  });

  it("appendPlanItem / appendSubItem exist only inside plan-writeback.js", () => {
    const appendPattern = /\b(appendPlanItem|appendSubItem)\b/;
    const files = scanFiles(serverDir, appendPattern);

    // Filter to production code only
    const prodFiles = files.filter((f) => !f.includes("__tests__") && !f.includes(".test.js"));

    const expectedFiles = ["plan-writeback.js"];
    const actualFiles = prodFiles.map((f) => path.basename(f));
    assert.ok(
      actualFiles.every((f) => expectedFiles.includes(f) || f === "plan-writeback.js"),
      `appendPlanItem/appendSubItem should only appear in plan-writeback.js, found in: ${actualFiles.join(", ")}`
    );

    // If plan-writeback.js exists, it should be the only file
    if (actualFiles.length > 0) {
      assert.deepEqual(
        actualFiles,
        expectedFiles,
        "appendPlanItem/appendSubItem should exist only in plan-writeback.js"
      );
    }
  });

  it("each write primitive has exactly one call site, and it is inside applyDisposition", () => {
    const planWritebackPath = path.resolve(serverDir, "lib/plan-writeback.js");

    if (!fs.existsSync(planWritebackPath)) {
      // Skip if plan-writeback.js doesn't exist yet (red-first scenario)
      return;
    }

    let content = fs.readFileSync(planWritebackPath, "utf8");

    // Strip both block comments (/* ... */) and single-line comments (//)
    content = content.replace(/\/\*[\s\S]*?\*\//g, ""); // Remove /* */ blocks
    content = content
      .split("\n")
      .map((line) => {
        const commentIdx = line.indexOf("//");
        return commentIdx >= 0 ? line.substring(0, commentIdx) : line;
      })
      .join("\n");

    // Extract the applyDisposition function body
    const applyDispMatch = content.match(/function\s+applyDisposition\s*\([^)]*\)\s*\{/);
    assert.ok(applyDispMatch, "applyDisposition function should be defined in plan-writeback.js");

    // Find the opening brace of applyDisposition
    const applyDispStartIdx = applyDispMatch.index + applyDispMatch[0].length - 1;
    let braceDepth = 1;
    let applyDispEndIdx = applyDispStartIdx + 1;

    // Scan forward to find the matching closing brace
    while (braceDepth > 0 && applyDispEndIdx < content.length) {
      if (content[applyDispEndIdx] === "{") braceDepth++;
      else if (content[applyDispEndIdx] === "}") braceDepth--;
      applyDispEndIdx++;
    }

    const applyDispBody = content.substring(applyDispStartIdx, applyDispEndIdx);

    // Count appendPlanItem( calls (excluding function declaration)
    const appendPlanItemCalls = (content.match(/\bappendPlanItem\s*\(/g) || []).length;
    const appendPlanItemDecl = (content.match(/function\s+appendPlanItem/g) || []).length;

    // Actual call sites should be appendPlanItemCalls - appendPlanItemDecl
    const actualAppendCalls = appendPlanItemCalls - appendPlanItemDecl;

    // Count appendSubItem( calls
    const appendSubItemCalls = (content.match(/\bappendSubItem\s*\(/g) || []).length;
    const appendSubItemDecl = (content.match(/function\s+appendSubItem/g) || []).length;

    const actualSubCalls = appendSubItemCalls - appendSubItemDecl;

    // Both should have exactly 1 call site
    assert.equal(
      actualAppendCalls,
      1,
      `appendPlanItem should have exactly 1 call site (found ${actualAppendCalls}). ` +
        `Do not add a file here. Route the write through plan-writeback.applyDisposition() — see DEC-14 and WATCH-11.`
    );
    assert.equal(
      actualSubCalls,
      1,
      `appendSubItem should have exactly 1 call site (found ${actualSubCalls}). ` +
        `Do not add a file here. Route the write through plan-writeback.applyDisposition() — see DEC-14 and WATCH-11.`
    );

    // Verify both call sites are lexically nested inside applyDisposition's function body
    const appendPlanItemCallsInBody = (applyDispBody.match(/\bappendPlanItem\s*\(/g) || []).length;
    const appendSubItemCallsInBody = (applyDispBody.match(/\bappendSubItem\s*\(/g) || []).length;

    assert.equal(
      appendPlanItemCallsInBody,
      1,
      `appendPlanItem call should be nested inside applyDisposition function body (found ${appendPlanItemCallsInBody}). ` +
        `Do not add a file here. Route the write through plan-writeback.applyDisposition() — see DEC-14 and WATCH-11.`
    );
    assert.equal(
      appendSubItemCallsInBody,
      1,
      `appendSubItem call should be nested inside applyDisposition function body (found ${appendSubItemCallsInBody}). ` +
        `Do not add a file here. Route the write through plan-writeback.applyDisposition() — see DEC-14 and WATCH-11.`
    );
  });

  it("__testonly is never referenced by production code", () => {
    const testonlyPattern = /__testonly/;
    const files = scanFiles(serverDir, testonlyPattern);

    // Filter to production code only (exclude test files and plan-writeback.js itself)
    const prodFiles = files.filter(
      (f) => !f.includes("__tests__") && !f.includes(".test.js") && !f.includes("plan-writeback.js")
    );

    assert.equal(
      prodFiles.length,
      0,
      `__testonly should only be referenced in tests and plan-writeback.js, found in: ${prodFiles.map((f) => path.basename(f)).join(", ")}`
    );
  });

  // §9.1 DERIVED-DUAL-VIEW (write-sequence form) — value-summary-tick.js is
  // the SECOND production invoker of enrichPoolAltitudes (route + tick), so
  // this is the exact "consumer #2 appears" moment the catalog names. The
  // cure is DEC-10 (extend the return shape, not a second entry point) plus
  // these mechanical, red-proven-by-injection guards.

  it("upsertValueUnitSummary appears only in db.js and value-summary.js", () => {
    const files = scanFiles(serverDir, /upsertValueUnitSummary/);
    const basenames = files.map((f) => path.basename(f)).filter((f) => !f.endsWith(".test.js"));
    assert.deepEqual(basenames.sort(), ["db.js", "value-summary.js"]);
  });

  it("upsertValueUnitSummary.run( has exactly one lexical call site, inside enrichPoolAltitudes", () => {
    const source = fs.readFileSync(path.join(serverDir, "lib/value-summary.js"), "utf8");
    // Strip comments
    const stripped = source
      .split("\n")
      .map((line) => {
        const idx = line.indexOf("//");
        return idx === -1 ? line : line.substring(0, idx);
      })
      .join("\n");

    const callMatches = Array.from(stripped.matchAll(/upsertValueUnitSummary\.run\s*\(/g));
    assert.equal(callMatches.length, 1, "totalCalls === 1 required");

    // Verify it's inside enrichPoolAltitudes body
    const enrichStart = stripped.indexOf("function enrichPoolAltitudes");
    assert.ok(enrichStart !== -1, "enrichPoolAltitudes not found");
    const braceDepth =
      [...stripped.substring(0, enrichStart).matchAll(/{/g)].length -
      [...stripped.substring(0, enrichStart).matchAll(/}/g)].length;
    // Parse from enrichStart to find the closing brace of the function
    let depth = braceDepth;
    let i = enrichStart;
    while (i < stripped.length && depth > braceDepth - 1) {
      if (stripped[i] === "{") depth++;
      else if (stripped[i] === "}") depth--;
      i++;
    }
    const enrichEnd = i;
    const inBodyCall = callMatches[0].index > enrichStart && callMatches[0].index < enrichEnd;
    assert.ok(
      inBodyCall,
      "upsertValueUnitSummary.run( must be lexically inside enrichPoolAltitudes body (§9.1 DERIVED-DUAL-VIEW: one composer, one writer, two invokers)"
    );
  });

  it("insertValueSummaryGeneration has exactly one production call site (tick)", () => {
    const files = scanFiles(serverDir, /insertValueSummaryGeneration/);
    const basenames = files.map((f) => path.basename(f)).filter((f) => !f.endsWith(".test.js"));
    assert.deepEqual(basenames.sort(), ["db.js", "value-summary-tick.js"]);
    // Note: WATCH-6 will deliberately widen this in the fast-follow when
    // request-path logging lands.
  });

  it("value-summary.js's exports have an explicit disposition at every consumer", () => {
    assertSingleHome("../lib/value-summary", {
      "../routes/project-plans": {
        shared: ["enrichPoolAltitudes"],
        absent: [
          "buildPrompt",
          "parseOutput",
          "summaryModel",
          "MAX_UNITS_PER_PROMPT",
          "ALTITUDE_STATES",
        ],
      },
      "../lib/value-summary-tick": {
        shared: ["enrichPoolAltitudes"],
        absent: [
          "buildPrompt",
          "parseOutput",
          "summaryModel",
          "MAX_UNITS_PER_PROMPT",
          "ALTITUDE_STATES",
        ],
      },
    });
  });

  it("value-ledger.js's exports have an explicit disposition at the tick", () => {
    assertSingleHome("../lib/value-ledger", {
      "../lib/value-summary-tick": {
        shared: ["assembleValuePool"],
        absent: [
          "VALUE_SOURCES",
          "ATTRIBUTION_TIERS",
          "BACKFILL_LOOKBACK_DAYS",
          "CONSUMERS",
          "unitKey",
          "rowToUnit",
          "computePlanHealth",
          "summarizeDeliveredValue",
        ],
      },
    });
  });
});
