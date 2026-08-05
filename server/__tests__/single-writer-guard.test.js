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

// Shared comment stripper (DEC-24 / test-plan.md §Layer 1 `A2`): block
// comments first, THEN `//` line comments — that order, so a `//` sequence
// living inside a `/** */` JSDoc block can never truncate a code line before
// the block-comment strip has a chance to remove it (the exact bug the
// parent build was bitten by: a JSDoc containing the literal function
// name). Used by both the W-1 single-call-site guard and the A2 structural
// scan below, per DEC-24's explicit instruction not to keep two inline
// copies of this logic.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.substring(0, idx);
    })
    .join("\n");
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
    // Strip comments (W-1: shared stripComments — this file's own header
    // rewrite and a JSDoc containing the literal `upsertValueUnitSummary.run(`
    // counts as a call site to a `//`-only stripper; block comments must go
    // first).
    const stripped = stripComments(source);

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

  it("insertValueSummaryGeneration has exactly two production call sites (tick + request)", () => {
    // WATCH-6: widened here, the fast-follow this test's own prior comment
    // named — request-path logging (POST /altitudes, source='request') now
    // lands beside the tick's (source='tick'), both writing through the
    // same statement, never a hand-rolled second insert.
    const files = scanFiles(serverDir, /insertValueSummaryGeneration/);
    const basenames = files.map((f) => path.basename(f)).filter((f) => !f.endsWith(".test.js"));
    assert.deepEqual(basenames.sort(), ["db.js", "project-plans.js", "value-summary-tick.js"]);
  });

  it("markValueUnitSummariesSeen appears only in db.js and project-plans.js, with one lexical call site in the seen handler (W-3)", () => {
    // W-3: New guard for the /altitudes/seen endpoint's second production writer
    const files = scanFiles(serverDir, /markValueUnitSummariesSeen/);
    const basenames = files.map((f) => path.basename(f)).filter((f) => !f.endsWith(".test.js"));
    assert.deepEqual(
      basenames.sort(),
      ["db.js", "project-plans.js"].sort(),
      "markValueUnitSummariesSeen should exist only in db.js (statement) and project-plans.js (route handler)"
    );

    // Verify exactly one lexical call site in routes/project-plans.js
    const routesPath = path.resolve(serverDir, "routes/project-plans.js");
    if (fs.existsSync(routesPath)) {
      let content = fs.readFileSync(routesPath, "utf8");

      // Strip comments
      content = content.replace(/\/\*[\s\S]*?\*\//g, "");
      content = content
        .split("\n")
        .map((line) => {
          const commentIdx = line.indexOf("//");
          return commentIdx >= 0 ? line.substring(0, commentIdx) : line;
        })
        .join("\n");

      // Find the /altitudes/seen handler
      const seenRouteMatch = content.match(/router\.post\(\s*["']\/altitudes\/seen["']/);
      assert.ok(seenRouteMatch, "/altitudes/seen route should be defined");

      // Find the opening brace of the handler
      const handlerStart = seenRouteMatch.index + seenRouteMatch[0].length;
      let braceDepth = 0;
      let handlerEnd = handlerStart;
      let foundBrace = false;

      for (let i = handlerStart; i < content.length; i++) {
        if (content[i] === "{") {
          if (!foundBrace) foundBrace = true;
          braceDepth++;
        } else if (content[i] === "}") {
          braceDepth--;
          if (braceDepth === 0 && foundBrace) {
            handlerEnd = i + 1;
            break;
          }
        }
      }

      const handlerBody = content.substring(handlerStart, handlerEnd);

      // Count markValueUnitSummariesSeen.run( calls in the handler
      const callCount = (handlerBody.match(/markValueUnitSummariesSeen\s*\.\s*run\s*\(/g) || [])
        .length;
      assert.equal(
        callCount,
        1,
        "markValueUnitSummariesSeen.run( should appear exactly once in the /altitudes/seen handler body"
      );
    }
  });

  it("value-summary.js's exports have an explicit disposition at every consumer", () => {
    // (5) Route and tick consume only enrichPoolAltitudes's return —
    // unitFacts/compareUnitInputs/ALTITUDE_FRESHNESS are new exports this
    // build adds (DEC-15 durable cure); registered "absent" here per
    // technical-plan.md's own file-change table for this test.
    assertSingleHome("../lib/value-summary", {
      "../routes/project-plans": {
        shared: ["enrichPoolAltitudes"],
        absent: [
          "buildPrompt",
          "parseOutput",
          "summaryModel",
          "MAX_UNITS_PER_PROMPT",
          "ALTITUDE_STATES",
          "unitFacts",
          "compareUnitInputs",
          "ALTITUDE_FRESHNESS",
          "UNCOMPARED_FIELD_GUARANTORS",
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
          "unitFacts",
          "compareUnitInputs",
          "ALTITUDE_FRESHNESS",
          "UNCOMPARED_FIELD_GUARANTORS",
        ],
      },
    });
  });

  it("value-ledger.js's exports have an explicit disposition at the tick", () => {
    // MUTABLE_VALUE_SOURCES is a new export this build adds (DEC-6 source
    // taxonomy) — registered "absent" here per technical-plan.md's file-
    // change table; the tick never imports it (it only consumes
    // assembleValuePool's units, same as before).
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
          "MUTABLE_VALUE_SOURCES",
        ],
      },
    });
  });

  it("buildPrompt reads no unit field outside unitFacts(u) — DEC-15 structural scan (A2, DEC-24 strong form)", () => {
    // DEC-24 (QA-DEC-8) is unambiguous: the WEAK form (dot-access-only,
    // scoped to the .map callback body alone) is explicitly forbidden — "No
    // veto path. This is the slice's one never-traded-away item; the weak
    // form ships the cure evadable." Nine assertions below, two identifiers
    // DERIVED from source (never hand-typed — §9.7 evasion #7), over two
    // scopes: `body` (buildPrompt's WHOLE lexical function body — catches an
    // evasion placed anywhere in the function, not merely inside the .map
    // callback; this is the exact gap build-reviewer's BL-5 found: a sneak
    // read like `units[0].stage` sitting just outside the callback was
    // invisible to a callback-scoped-only scan) and `CB` (the callback body
    // alone, for the two assertions — (g)/(h) — that must prove the ONE
    // permitted mention of the per-unit identifier is specifically the
    // unitFacts(...) argument).
    //
    // Evasion #8 disposition (DEC-24, mandatory to state here): a helper
    // defined elsewhere in this file that reads `u.stage` in ITS OWN body is
    // structurally out of a lexical body scan's reach by construction — that
    // is this scan's documented boundary, not a hole in it. Its backstops
    // are the comparator single-home scan below (A2-HOME), the DEC-7
    // cross-path parity cases (P1/P2, value-summary.test.js), and INV-10's
    // steady-state assertion (L3 tick 3, value-summary-tick.test.js). Do NOT
    // widen this scan to chase that class — widen those instead.
    const source = fs.readFileSync(path.join(__dirname, "../lib/value-summary.js"), "utf8");
    const stripped = stripComments(source);

    // Step 2: brace-walk buildPrompt's lexical body, starting at the
    // function's OPENING BRACE (not the `function buildPrompt(units)`
    // keyword/signature) — the same convention step 4 below uses for CB, so
    // the array parameter's own declaration-site occurrence in the
    // signature is excluded from `body` for the same reason PARAM's own
    // declaration in `(u, i) =>` is excluded from CB (see (h)'s comment).
    // Template-literal interiors are deliberately NOT stripped (only
    // comments were) — a `${u.stage}` inside a template literal is a real
    // property access and must stay visible to every assertion below.
    const buildPromptMatch = stripped.match(/function\s+buildPrompt\s*\([^)]*\)\s*\{/);
    assert.ok(buildPromptMatch, "buildPrompt function should be defined");
    const funcStartIdx = buildPromptMatch.index + buildPromptMatch[0].length - 1;
    let braceDepth = 1;
    let funcEndIdx = funcStartIdx + 1;
    while (funcEndIdx < stripped.length && braceDepth > 0) {
      if (stripped[funcEndIdx] === "{") braceDepth++;
      else if (stripped[funcEndIdx] === "}") braceDepth--;
      funcEndIdx++;
    }
    const body = stripped.substring(funcStartIdx, funcEndIdx);

    // Step 3: derive both identifiers from source, never hand-type them.
    // ARR = buildPrompt's own parameter, from its signature.
    const sigMatch = stripped.match(/function\s+buildPrompt\s*\(([^)]*)\)/);
    assert.ok(
      sigMatch,
      "buildPrompt signature not found — a restructured buildPrompt must turn this scan red"
    );
    const ARR = sigMatch[1].trim();
    assert.ok(
      ARR && /^[A-Za-z_$][\w$]*$/.test(ARR),
      "buildPrompt's array parameter must be a single plain identifier"
    );

    // PARAM = the first parameter of the units-mapping callback. A
    // destructured callback (`.map(({ ... }`) defeats source-derivation of a
    // single identifier outright — fail immediately, never silently pass.
    const destructuredMapMatch = body.match(/\.map\s*\(\s*\(\s*\{/);
    assert.equal(
      destructuredMapMatch,
      null,
      "buildPrompt's map callback is destructured — DEC-24 requires PARAM to be derived as a single plain identifier; a destructured callback must fail this scan (M-A2-3), not silently pass it"
    );
    const mapParamMatch = body.match(/\.map\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*[,)]/);
    assert.ok(
      mapParamMatch,
      "map callback parameter not found — a restructured buildPrompt must turn this scan red"
    );
    const PARAM = mapParamMatch[1];

    // Step 4: brace/arrow-walk the callback body (CB) from its `=>`.
    const callbackHeaderMatch = body.match(
      new RegExp(
        `\\.map\\s*\\(\\s*\\(?\\s*${PARAM}\\s*(?:,\\s*[A-Za-z_$][\\w$]*\\s*)?\\)?\\s*=>\\s*\\{`
      )
    );
    assert.ok(callbackHeaderMatch, "map callback should have a block body (=> { ... })");
    const cbStartIdx = callbackHeaderMatch.index + callbackHeaderMatch[0].length - 1;
    braceDepth = 1;
    let cbEndIdx = cbStartIdx + 1;
    while (cbEndIdx < body.length && braceDepth > 0) {
      if (body[cbEndIdx] === "{") braceDepth++;
      else if (body[cbEndIdx] === "}") braceDepth--;
      cbEndIdx++;
    }
    const CB = body.substring(cbStartIdx, cbEndIdx);

    // Step 5: the nine assertions.

    // (a) scope non-empty + positive sentinel — proves `body` was actually
    // captured, not silently empty from a parsing failure that would make
    // every zero-match assertion below pass vacuously.
    assert.ok(
      body.length > 200,
      "(a) buildPrompt's body scope must be non-empty (parsing failure?)"
    );
    assert.match(body, /\bfacts\./, "(a) positive sentinel: body must reference facts. somewhere");

    // (b) no dot access of PARAM anywhere in the WHOLE function body (not
    // merely inside CB — this is the widened scope BL-5 required).
    const dotAccessPattern = new RegExp(`\\b${PARAM}\\s*\\.\\s*[A-Za-z_$]`, "g");
    assert.equal(
      (body.match(dotAccessPattern) || []).length,
      0,
      `(b) buildPrompt must not read ${PARAM}.<field> anywhere in its body (M-A2-1, M-A2-2, M-A2-8)`
    );

    // (c) no bracket access of PARAM.
    const bracketAccessPattern = new RegExp(`\\b${PARAM}\\s*\\[`, "g");
    assert.equal(
      (body.match(bracketAccessPattern) || []).length,
      0,
      `(c) buildPrompt must not read ${PARAM}[...] anywhere in its body (M-A2-6)`
    );

    // (d) no destructuring assignment off PARAM.
    const destructureAssignPattern = new RegExp(`\\{[^}]*\\}\\s*=\\s*${PARAM}\\b`, "g");
    assert.equal(
      (body.match(destructureAssignPattern) || []).length,
      0,
      `(d) buildPrompt must not destructure ${PARAM} via {...} = ${PARAM} (M-A2-4)`
    );

    // (e) no destructured callback params (belt for the same class step 3
    // already fails hard on — kept as its own named assertion per DEC-24).
    assert.equal(
      (body.match(/\(\s*\{/g) || []).length,
      0,
      "(e) buildPrompt must not use a destructured callback parameter (M-A2-3)"
    );

    // (f) no aliasing of PARAM to a new local binding.
    const aliasPattern = new RegExp(
      `(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*${PARAM}\\s*[;,)\\n]`,
      "g"
    );
    assert.equal(
      (body.match(aliasPattern) || []).length,
      0,
      `(f) buildPrompt must not alias ${PARAM} to a new local binding (M-A2-5)`
    );

    // (g) the permitted form is present, specifically inside CB.
    assert.match(
      CB,
      new RegExp(`unitFacts\\s*\\(\\s*${PARAM}\\s*\\)`),
      `(g) buildPrompt's callback must call unitFacts(${PARAM})`
    );

    // (h) STRONG FORM — exactly one mention of PARAM within CB (its
    // argument to unitFacts(...), proven by (g) above). Deliberately scoped
    // to CB ALONE, not the whole function body: PARAM's own binding
    // occurrence in `(u, i) =>` lives outside CB by this walker's own
    // definition (step 4) and must NEVER be counted here. Do not "fix" this
    // to count 2 — that would silently re-widen the assertion back to the
    // weak form.
    const paramMentionsInCB = (CB.match(new RegExp(`\\b${PARAM}\\b`, "g")) || []).length;
    assert.equal(
      paramMentionsInCB,
      1,
      `(h) ${PARAM} must appear exactly once inside the callback body (the unitFacts(${PARAM}) argument), found ${paramMentionsInCB} (M-A2-1, M-A2-2, M-A2-4, M-A2-5, M-A2-6, M-A2-8)`
    );

    // (i) NEW — evasion class #9 (units[0].stage), found while reconciling
    // the two QA documents: indexing buildPrompt's ARRAY parameter directly
    // matches none of the PARAM-scoped regexes above (in "units[", `\bu\b`
    // is followed by `n`, not `.` or `[`). The array parameter itself must
    // therefore be read ONLY once, by its own `.map(` call — never touched
    // a second time anywhere else in the function.
    //
    // buildPrompt's own returned prompt text legitimately contains the
    // plain English word "units" several times in ordinary quoted-string
    // prose (and the JSON reply-format instruction's literal key
    // `"units"`) — none of those is a property access on the array
    // parameter, so they must not count against this assertion. Strip
    // ordinary quoted STRING-LITERAL CONTENT (single/double quotes only —
    // backtick template literals are left untouched, since a
    // `${units...}` interior would be real code) before counting.
    const bodyForArrCheck = body
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const arrMentions = Array.from(bodyForArrCheck.matchAll(new RegExp(`\\b${ARR}\\b`, "g")));
    assert.equal(
      arrMentions.length,
      1,
      `(i) ${ARR} (the array parameter) must appear exactly once in buildPrompt's code (prose string content excluded), found ${arrMentions.length} — a second mention (e.g. ${ARR}[0].stage) reads a unit field by indexing the array directly, bypassing unitFacts() (M-A2-7)`
    );
    const arrMentionEnd = arrMentions[0].index + arrMentions[0][0].length;
    assert.equal(
      bodyForArrCheck.slice(arrMentionEnd, arrMentionEnd + ".map(".length),
      ".map(",
      `(i) the sole ${ARR} mention must be immediately followed by .map(`
    );
  });

  it("input_stage and input_label appear only in db.js and value-summary.js (A2-HOME)", () => {
    // This test ensures input_stage/input_label snapshot fields are only read in value-summary.js
    const files = scanFiles(path.resolve(__dirname, ".."), /input_stage|input_label/);
    const basenames = files.map((f) => path.basename(f)).filter((f) => !f.endsWith(".test.js"));

    assert.deepEqual(
      basenames.sort(),
      ["db.js", "value-summary.js"].sort(),
      "input_stage/input_label should only appear in db.js (schema/statements) and value-summary.js (comparator)"
    );
  });
});
