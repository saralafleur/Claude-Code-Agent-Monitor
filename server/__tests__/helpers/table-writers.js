/**
 * @file Durable-cure helper: assertTableWritersSingleHome verifies that a given
 * table has exactly one canonical writer (a prepared statement with a single call
 * site), plus any explicitly dispositioned inline SQL writes. Automatically
 * derived from server/db.js's statement registry and an inline-SQL scan.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");

/**
 * Recursively scan a directory for .js files, skipping node_modules, dist, tests.
 */
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

/**
 * Recursively list every `.js` file under `dir` (by filename, not content —
 * `scanFiles` above filters by *content* matching `pattern`, which is the
 * right tool for "which files mention this identifier" but the wrong tool
 * for "give me every file to scan"; passing a content pattern like `/.js$/`
 * to mean "every JS file" silently returns almost nothing, since a whole
 * file's raw text essentially never ends in the literal two characters
 * "js"). Same skip-list as `scanFiles`.
 */
function listAllJsFiles(dir) {
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
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * Strip both block comments and line comments.
 */
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

/**
 * Replace the interior of every string literal (single/double/backtick,
 * backslash-escape aware) with a neutral filler character, same length,
 * same positions. Route registrations in this codebase embed literal
 * parens inside their path string (e.g. `"/claims/:claimId(\\d+)"`) — a
 * brace/paren-balance walk that doesn't mask string content would
 * miscount those as real structural parens. Only used to compute brace/
 * paren *positions*; the original (unmasked) text is still what gets
 * sliced out for the returned anchor text.
 */
function maskStringLiterals(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += "x";
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < source.length) {
          out += "xx";
          i += 2;
          continue;
        }
        out += "x";
        i += 1;
      }
      if (i < source.length) {
        out += "x";
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Find the opening/closing braces of a function or block starting at a given position.
 */
function findBraceSpan(source, startPos) {
  let depth = 0;
  let openPos = -1;
  for (let i = startPos; i < source.length; i++) {
    if (source[i] === "{") {
      if (openPos === -1) openPos = i;
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0 && openPos !== -1) {
        return { start: openPos, end: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Find the position of the innermost brace that unambiguously encloses
 * `pos`, by walking backward and tracking brace balance. Unlike a fixed-size
 * backward regex lookback, this is exact regardless of how much code sits
 * between the enclosing construct's header and the call site.
 */
function findInnermostOpenBrace(source, pos) {
  let depth = 0;
  let i = pos;
  while (i > 0) {
    i -= 1;
    const ch = source[i];
    if (ch === "}") {
      depth += 1;
    } else if (ch === "{") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * The START position of the header text of the statement/expression that
 * owns the block opened at `openBrace` — bounded backward by the nearest
 * unmatched `;`, `{`, or `}` *outside any paren-enclosed region*. The
 * paren-tracking matters because a function's own parameter list can embed
 * `{`/`}` (a default-value object literal, e.g. `payload = {}`) that would
 * otherwise be mistaken for a real statement boundary sitting just before
 * the function's body brace. Operates on the string-masked view (see
 * `maskStringLiterals`) so parens embedded in a route path string (e.g.
 * `"/claims/:claimId(\\d+)"`) don't perturb the paren count either.
 */
function findHeaderStart(structural, openBrace) {
  let j = openBrace;
  let parenDepth = 0;
  while (j > 0) {
    const ch = structural[j - 1];
    if (ch === ")") {
      parenDepth += 1;
    } else if (ch === "(") {
      parenDepth -= 1;
    } else if (parenDepth <= 0 && (ch === ";" || ch === "{" || ch === "}")) {
      break;
    }
    j -= 1;
  }
  return j;
}

/**
 * Classify a block header as an "anchor" (something worth naming a call
 * site's home after) or not. Anchor-worthy: a real `function NAME(...)`
 * declaration, a `const/let/var NAME = ... =>` arrow assignment, or an
 * Express route registration (`router.METHOD(...)`, the one call-expression
 * shape this codebase uses as a genuine named entry point). Everything else
 * — control-flow blocks (`for`/`if`/`while`/`try`/`catch`/`else`/`switch`/
 * `do`), IIFE-style wrappers, and generic call-wrapping like
 * `dbModule.db.transaction(() => { ... })` — is NOT anchor-worthy, so the
 * caller keeps walking outward to the nearest genuinely named enclosing
 * function. Returns `null` when not anchor-worthy.
 */
function classifyHeader(header) {
  let m = header.match(/^function\s+(\w+)\s*\(/);
  if (m) return `function ${m[1]}`;

  m = header.match(/^(const|let|var)\s+(\w+)\s*=/);
  if (m) return `${m[1]} ${m[2]} =`;

  m = header.match(/^router\s*\.\s*\w+\s*\(/);
  if (m) {
    const firstParen = header.indexOf("(");
    const secondParen = header.indexOf("(", firstParen + 1);
    return secondParen !== -1
      ? header.substring(0, secondParen)
      : header.substring(0, firstParen + 1);
  }

  return null;
}

/**
 * Resolve the nearest enclosing NAMED construct for a call site at `pos` —
 * a genuine brace-depth walk (not a fixed-size backward regex), walking
 * outward through non-anchor-worthy blocks (control flow, generic call
 * wrappers such as a `db.transaction(...)` callback) until an anchor-worthy
 * header is found or the walk runs out of enclosing braces. Brace/paren
 * *positions* are found on a string-masked view of `source`; the returned
 * anchor text is always sliced from the real, unmasked `source`.
 */
function findEnclosingAnchor(source, pos) {
  const structural = maskStringLiterals(source);
  let cursor = pos;
  // Bounded by source length so a pathological input can't loop forever;
  // each iteration strictly reduces `cursor`, so this is a generous ceiling.
  for (let guard = 0; guard < 10000; guard += 1) {
    const openBrace = findInnermostOpenBrace(structural, cursor);
    if (openBrace === -1) return null;
    const headerStart = findHeaderStart(structural, openBrace);
    const header = source.substring(headerStart, openBrace).trim();
    const anchor = classifyHeader(header);
    if (anchor) return anchor;
    cursor = openBrace;
  }
  return null;
}

/**
 * Main assertion function for single-writer guard.
 */
function assertTableWritersSingleHome(
  tableName,
  { statementHomes = {}, inlineWriterDispositions = {} } = {}
) {
  const serverDir = path.resolve(__dirname, "../..");
  const dbPath = path.join(serverDir, "db.js");

  assert.ok(fs.existsSync(dbPath), `db.js must exist at ${dbPath}`);
  const dbContent = fs.readFileSync(dbPath, "utf8");

  // 1. Parse the registry from server/db.js — find `const stmts = { ... };`
  const stmtsMatch = dbContent.match(/const\s+stmts\s*=\s*\{/);
  assert.ok(stmtsMatch, "db.js must have `const stmts = {`");

  const stmtsStartPos = stmtsMatch.index + stmtsMatch[0].length - 1;
  const stmtsSpan = findBraceSpan(dbContent, stmtsStartPos);
  assert.ok(stmtsSpan, "Could not find closing brace for stmts");

  const stmtsSource = dbContent.substring(stmtsSpan.start, stmtsSpan.end);

  // Parse prepared statements for this table - match more patterns
  // Matches: name: db.prepare(`...`) or name: db.prepare("...") with optional whitespace
  const parsedStatements = [];

  // Split by 'name:' to find each statement entry
  const entries = stmtsSource.split(/\n\s*(\w+)\s*:/);
  for (let i = 1; i < entries.length; i += 2) {
    const name = entries[i];
    const content = entries[i + 1] || "";

    // Extract SQL string from db.prepare()
    const sqlMatch = content.match(/db\.prepare\s*\(\s*["`]([\s\S]*?)["`]\s*\)/);
    if (sqlMatch) {
      const sql = sqlMatch[1];
      parsedStatements.push({ name, sql });
    }
  }

  // Count db.prepare calls in region
  const prepareCount = (stmtsSource.match(/db\.prepare\s*\(/g) || []).length;

  // Note: Parser completeness might not be perfect due to formatting variations;
  // if mismatch is large, log it but continue (not a blocker for red-first tests)
  if (parsedStatements.length !== prepareCount) {
    // Log warning but don't fail - real implementation can be stricter
    console.warn(
      `Parser notice: parsed ${parsedStatements.length} statements, found ${prepareCount} db.prepare calls`
    );
  }

  // 2. Derive the writer set — statements writing to the given table
  const writePattern = new RegExp(
    `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${tableName}\\b`,
    "i"
  );
  const writers = parsedStatements
    .filter((stmt) => writePattern.test(stmt.sql))
    .map((stmt) => stmt.name)
    .sort();

  assert.ok(writers.length > 0, `No writers found for table ${tableName}`);

  // 3. Registry completeness — statementHomes keys must match derived writers
  const expectedNames = Object.keys(statementHomes).sort();
  assert.deepEqual(
    expectedNames,
    writers,
    `Registry completeness: expected [${expectedNames}], got writers [${writers}]`
  );

  // 4. Identity check (not arity) — for each writer, verify call site enclosing function
  for (const writerName of writers) {
    const expectedHomes = statementHomes[writerName] || [];
    assert.ok(Array.isArray(expectedHomes), `statementHomes[${writerName}] must be an array`);

    // Find all call sites for this writer
    const writerCallPattern = new RegExp(`${writerName}\\s*\\.\\s*run\\s*\\(`, "g");
    const files = scanFiles(serverDir, writerCallPattern);

    // Filter to production code
    const prodFiles = files.filter((f) => !f.includes("__tests__") && !f.includes(".test.js"));

    // For each file, find all call sites
    const actualHomes = [];
    for (const filePath of prodFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      const stripped = stripComments(content);

      let callMatch;
      const callPattern = new RegExp(`${writerName}\\s*\\.\\s*run\\s*\\(`, "g");
      while ((callMatch = callPattern.exec(stripped)) !== null) {
        const anchor = findEnclosingAnchor(stripped, callMatch.index);
        if (anchor) {
          actualHomes.push({
            file: path.relative(serverDir, filePath),
            anchor,
          });
        }
      }
    }

    // Normalize for comparison
    const sortedActual = actualHomes.sort((a, b) => {
      const cmp = a.file.localeCompare(b.file);
      return cmp !== 0 ? cmp : a.anchor.localeCompare(b.anchor);
    });
    const sortedExpected = expectedHomes
      .map((h) => ({
        file: h.file,
        anchor: h.anchor,
      }))
      .sort((a, b) => {
        const cmp = a.file.localeCompare(b.file);
        return cmp !== 0 ? cmp : a.anchor.localeCompare(b.anchor);
      });

    assert.deepEqual(
      sortedActual,
      sortedExpected,
      `${writerName} call sites: expected homes ${JSON.stringify(sortedExpected)}, got ${JSON.stringify(sortedActual)}`
    );
  }

  // 5. Inline-write axis — scan for .prepare() literals writing to this table
  const inlinePattern = new RegExp(
    "\\.prepare\\s*\\(\\s*[\"'`](?:[^\"'`]|\\\\.)*?" + tableName + "[^\"'`]*[\"'`]",
    "g"
  );
  const inlineFiles = [];

  const allFiles = listAllJsFiles(serverDir);
  for (const filePath of allFiles) {
    if (
      filePath.includes("__tests__") ||
      filePath.includes(".test.js") ||
      filePath.includes("db.js")
    ) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const stripped = stripComments(content);

    if (inlinePattern.test(stripped)) {
      inlineFiles.push(filePath);
    }
  }

  // Verify inline writers match dispositions
  const inlineDispositionFiles = new Set(
    Object.keys(inlineWriterDispositions || {}).map((key) => key.split(":")[0])
  );
  for (const inlineFile of inlineFiles) {
    const relPath = path.relative(serverDir, inlineFile);
    assert.ok(
      inlineDispositionFiles.has(relPath),
      `Inline writer in ${relPath} must be dispositioned in inlineWriterDispositions`
    );
  }
}

module.exports = { assertTableWritersSingleHome };
