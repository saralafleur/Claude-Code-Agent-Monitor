/**
 * @file Tests for chronology ordering: verifies that all queries with LIMIT
 * over bulk-inserted tables sort by created_at before the LIMIT, not by id.
 * A chronology bug here changes escalation decisions silently. Includes both
 * behavioral tests (fixtures with scrambled insertion) and a static SQL-shape
 * scan of the codebase. This is the executable mitigation for §9.2 and gap #4.
 *
 * B6 fix (2026-08-01): the five behavioral cases now actually route through
 * `assertOrderedByCreatedAt` (it used to be imported and never called); the
 * case labeled "Layer 6 detour-volume lookback" now exercises the REAL R2
 * lookback query (`evaluateRules(...).detourVolume`, filtered on
 * `focus_inferences.inferred_at`) instead of duplicating the
 * `listPendingDetours` case; and `backfillDeclaredDetours` is now asserted by
 * the id-ordered INSERTION sequence of the rows it creates, not by a
 * self-sorting re-query (which was tautological — deleting the function's own
 * `ORDER BY` could never fail that assertion).
 *
 * Static-scan fix (verifier caveat 4(a), 2026-08-01): the SQL-literal
 * extraction regex used to stop at the first embedded quote inside a
 * backtick-delimited template literal, so `listPendingDetours`,
 * `findOpenQueueItemByDigest`, and `listFocusEvents` (each of which embeds a
 * single-quoted value like `disposition = 'pending'`) were silently never
 * scanned at all. The corrected, literal-first extraction below (recommended
 * by the adversarial review) surfaces those three (all already compliant) plus
 * two legitimate top-N aggregates (`toolUsageCounts`/`sessionToolUsageCounts`
 * — count-ranked leaderboards, not chronological windows, entered in
 * GRANDFATHERED_QUERIES) and one real pre-existing violation
 * (`latestTodoWriteEvent`, fixed alongside this test in server/db.js).
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Import the helper for order testing
const { assertOrderedByCreatedAt } = require("./helpers/ordering");

// GRANDFATHERED_QUERIES: the ONLY queries permitted to have a LIMIT over a
// bulk-inserted table without a leading `created_at` sort, because they are
// count-ranked top-N aggregates (a "most-used tool" leaderboard is
// legitimately NOT a chronological window) rather than a "most recent N"
// window. Any new entry here must go through the same review this pair did —
// do not widen this list to make a real violation go away.
const GRANDFATHERED_QUERIES = [
  {
    file: "server/db.js",
    sql: `
    SELECT tool_name, COUNT(*) as count
    FROM events
    WHERE tool_name IS NOT NULL
    GROUP BY tool_name
    ORDER BY count DESC
    LIMIT 20
  `,
    reason: "toolUsageCounts — top-N tool-usage leaderboard, ranked by count, not recency.",
    dated: "2026-08-01",
  },
  {
    file: "server/db.js",
    sql: `
    SELECT tool_name, COUNT(*) as count
    FROM events
    WHERE session_id = ? AND tool_name IS NOT NULL
    GROUP BY tool_name
    ORDER BY count DESC
    LIMIT 15
  `,
    reason: "sessionToolUsageCounts — same rationale as toolUsageCounts, scoped to one session.",
    dated: "2026-08-01",
  },
];

// §9.7 HAND-SCOPED STRUCTURAL SCAN durable cure (T3.14, DEC-9): the scan's
// scope is DERIVED from the real artifact set — every direct `*.js` child of
// `server/lib/` and `server/routes/` — plus `server/db.js` (outside both
// glob roots, always included). Every derived file MUST carry an explicit
// disposition below: `"scanned"` (the SQL-shape scan below runs against it,
// with GRANDFATHERED_QUERIES as the only per-query exception list) or
// `{status: "grandfathered", dated, reason}` (excluded from the scan
// entirely, with a dated, reviewed reason — never a silent skip). Adding a
// 6th `server/lib/*.js` (or `server/routes/*.js`) file with no entry here
// breaks the scan on SCOPE, not on SQL shape, until someone dispositions it.
//
// DEC-9's bounded fallback, invoked here: deriving the scope surfaced six
// pre-existing files this build did not introduce and does not own fixing.
// Five are verified-fine false positives against this scanner's specific
// technique (count-ranked leaderboards it already grandfathers two of via
// GRANDFATHERED_QUERIES, an existence/dedup check, and a nested-subquery
// table-name false match). The sixth, `server/lib/focus-report.js`, is a
// genuine, PRE-EXISTING §9.2-shaped risk this scan was never previously wide
// enough to see — recorded honestly as deferred, not waved through as fine.
// See intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md, the DEC-9
// bounded-fallback row appended 2026-08-02.
const FILE_DISPOSITIONS = {
  "server/db.js": "scanned",
  "server/lib/account-activity.js": "scanned",
  "server/lib/account-capture-scheduler.js": "scanned",
  "server/lib/account-capture.js": "scanned",
  "server/lib/alerts.js": "scanned",
  "server/lib/archive.js": "scanned",
  "server/lib/atomic-file.js": "scanned",
  "server/lib/cc-discovery.js": "scanned",
  "server/lib/cc-mutate.js": "scanned",
  "server/lib/cc-watcher.js": "scanned",
  "server/lib/claude-cli-credentials.js": "scanned",
  "server/lib/claude-home.js": "scanned",
  "server/lib/consumption-rate.js": "scanned",
  "server/lib/cwd-identity.js": "scanned",
  "server/lib/dashboard-runs.js": "scanned",
  "server/lib/data-transfer.js": "scanned",
  "server/lib/decision-queue-enqueue.js": "scanned",
  "server/lib/detours.js": "scanned",
  "server/lib/focus-audit.js": "scanned",
  "server/lib/focus-commands.js": "scanned",
  "server/lib/focus-summary.js": "scanned",
  "server/lib/git-env.js": "scanned",
  "server/lib/git-refs.js": "scanned",
  "server/lib/intake-scan.js": "scanned",
  "server/lib/origin-guard.js": "scanned",
  "server/lib/pace.js": "scanned",
  "server/lib/plan-ingest.js": "scanned",
  "server/lib/plan-lifecycle.js": "scanned",
  "server/lib/plan-writeback.js": "scanned",
  "server/lib/portfolio.js": "scanned",
  "server/lib/pricing-constants.js": "scanned",
  "server/lib/push.js": "scanned",
  "server/lib/reconciliation.js": "scanned",
  "server/lib/redoc.js": "scanned",
  "server/lib/remote-sync.js": "scanned",
  "server/lib/repo-topology.js": "scanned",
  "server/lib/run-spawner.js": "scanned",
  "server/lib/security.js": "scanned",
  "server/lib/server-info.js": "scanned",
  "server/lib/session-liveness.js": "scanned",
  "server/lib/source-filter.js": "scanned",
  "server/lib/stream-json-parser.js": "scanned",
  "server/lib/terminal-focus.js": "scanned",
  "server/lib/token-usage.js": "scanned",
  "server/lib/transcript-cache.js": "scanned",
  "server/lib/trunk-drift.js": "scanned",
  "server/lib/update-check.js": "scanned",
  "server/lib/usage-capture.js": "scanned",
  "server/lib/usage-captures-db.js": "scanned",
  "server/lib/usage-fetch-oauth.js": "scanned",
  "server/lib/value-coverage.js": "scanned",
  "server/lib/value-coverage-probe.js": "scanned",
  "server/lib/value-groups.js": "scanned",
  "server/lib/value-ledger.js": "scanned",
  "server/lib/value-summary.js": "scanned",
  "server/lib/value-summary-tick.js": "scanned",
  "server/lib/webhook-providers.js": "scanned",
  "server/lib/webhooks.js": "scanned",
  "server/lib/workflow-ingest.js": "scanned",
  "server/routes/accounts.js": "scanned",
  "server/routes/agents.js": "scanned",
  "server/routes/alerts.js": "scanned",
  "server/routes/analytics.js": "scanned",
  "server/routes/cc-config.js": "scanned",
  "server/routes/coach.js": "scanned",
  "server/routes/color-thresholds.js": "scanned",
  "server/routes/decision-queue.js": "scanned",
  "server/routes/detours.js": "scanned",
  "server/routes/events.js": "scanned",
  "server/routes/focus-report.js": "scanned",
  "server/routes/import.js": "scanned",
  "server/routes/metrics.js": "scanned",
  "server/routes/monitors.js": "scanned",
  "server/routes/plans.js": "scanned",
  "server/routes/playbook.js": "scanned",
  "server/routes/portfolio.js": "scanned",
  "server/routes/pricing.js": "scanned",
  "server/routes/project-plans.js": "scanned",
  "server/routes/projects.js": "scanned",
  "server/routes/push.js": "scanned",
  "server/routes/remote-sources.js": "scanned",
  "server/routes/run.js": "scanned",
  "server/routes/sessions.js": "scanned",
  "server/routes/settings.js": "scanned",
  "server/routes/stats.js": "scanned",
  "server/routes/updates.js": "scanned",
  "server/routes/usage.js": "scanned",
  "server/routes/webhooks.js": "scanned",
  "server/lib/focus-inference.js": {
    status: "grandfathered",
    dated: "2026-08-02",
    reason:
      "listCandidates() LIMITs over `sessions` ordered by `s.updated_at DESC`, not by row id — the scanner's substring table-name match is fooled by nested `events`/`focus_inferences` correlated subqueries (NOT EXISTS/EXISTS guards) that never themselves carry the LIMIT. Verified-fine false positive of this scan's own technique.",
  },
  "server/lib/focus-report.js": {
    status: "grandfathered",
    dated: "2026-08-02",
    reason:
      "GENUINE, PRE-EXISTING risk, NOT introduced by this build and out of this effort's change set: resolveSessionStart()'s `SELECT created_at FROM events WHERE session_id = ? ORDER BY id ASC LIMIT 1` fallback is not chronology-corrected — contrast the same file's sibling query a few lines below, which fetches ALL of a session's events id-ordered and then explicitly re-sorts them numerically by created_at before use, with its own comment naming exactly this failure mode (bulk-ingested Workflow-tool events landing at whatever row id was next). Recorded as a tracked defect candidate, not waved through as fine — see the DEC-9 bounded-fallback decisions.md row for the remainder-tracking obligation.",
  },
  "server/lib/scoped-stats.js": {
    status: "grandfathered",
    dated: "2026-08-02",
    reason:
      "toolUsageCounts() is the exact same top-N tool-usage leaderboard shape as db.js's two already-reviewed GRANDFATHERED_QUERIES entries (GROUP BY tool_name ORDER BY count DESC LIMIT 20) — count-ranked, not a recency window.",
  },
  "server/routes/hooks.js": {
    status: "grandfathered",
    dated: "2026-08-02",
    reason:
      "Both flagged queries are `SELECT 1 FROM events WHERE ... LIMIT 1` existence/dedup checks (APIError and TurnDuration ingestion), not a 'most recent N' window — any matching row satisfies an existence check, so row order is immaterial.",
  },
  "server/routes/workflows.js": {
    status: "grandfathered",
    dated: "2026-08-02",
    reason:
      "All three flagged queries (tool-to-tool transition counts, tool-usage counts, error-summary counts) are GROUP BY ... ORDER BY count DESC top-N leaderboards — the same count-ranked shape as db.js's two reviewed GRANDFATHERED_QUERIES entries, not recency windows.",
  },
};

describe("chronology-ordering: static SQL-shape scan", () => {
  it("every LIMITed query over a bulk-inserted table orders by created_at before LIMIT", () => {
    // Scope is DERIVED from the real artifact set, never hand-typed (§9.7).
    const libDir = path.resolve(__dirname, "..", "lib");
    const routesDir = path.resolve(__dirname, "..", "routes");
    const derivedFiles = [
      "server/db.js",
      ...fs
        .readdirSync(libDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".js"))
        .map((e) => `server/lib/${e.name}`),
      ...fs
        .readdirSync(routesDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".js"))
        .map((e) => `server/routes/${e.name}`),
    ];

    // Every derived file must have an explicit disposition, and vice versa —
    // this is the assertion that makes a 6th undispositioned lib/route file
    // break the scan on scope, and that a stale disposition entry (file
    // renamed/removed) gets caught too.
    const dispositioned = new Set(Object.keys(FILE_DISPOSITIONS));
    const derived = new Set(derivedFiles);
    for (const filePath of derivedFiles) {
      assert.ok(
        dispositioned.has(filePath),
        `${filePath} has no disposition in FILE_DISPOSITIONS — every server/lib/*.js and server/routes/*.js file (plus server/db.js) must be explicitly "scanned" or dated-grandfathered with a reason (§9.7).`
      );
    }
    for (const filePath of dispositioned) {
      assert.ok(
        derived.has(filePath),
        `FILE_DISPOSITIONS names ${filePath}, which no longer exists under server/lib/*.js, server/routes/*.js, or server/db.js — remove its stale entry.`
      );
    }

    // The four new portfolio-layer files (§9.7 same-commit registration)
    // must all be scanned, not grandfathered.
    for (const filePath of [
      "server/lib/value-ledger.js",
      "server/lib/cwd-identity.js",
      "server/lib/plan-lifecycle.js",
      "server/routes/project-plans.js",
    ]) {
      assert.equal(
        FILE_DISPOSITIONS[filePath],
        "scanned",
        `${filePath} must be registered as "scanned", not grandfathered`
      );
    }

    const filesToScan = derivedFiles.filter((f) => FILE_DISPOSITIONS[f] === "scanned");

    const bulkInsertTables = [
      "events",
      "focus_inferences",
      "detour_dispositions",
      "decision_queue",
    ];
    const violations = [];

    // Literal-first extraction (verifier caveat 4(a)'s recommended shape):
    // find each backtick/double/single-quoted string literal FIRST, then
    // test the extracted body for `^\s*SELECT` + `\bLIMIT\b`. The single-
    // and double-quoted alternatives deliberately EXCLUDE `\n` from their
    // character class, so an unmatched apostrophe inside a `//` comment can
    // only ever pair with another apostrophe on the SAME line — it can never
    // swallow a real multi-line SQL literal elsewhere in the file.
    const literalPattern = /`([^`]*)`|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;

    for (const filePath of filesToScan) {
      const fullPath = path.resolve(__dirname, "..", "..", filePath);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, "utf8");

      literalPattern.lastIndex = 0;
      let match;
      while ((match = literalPattern.exec(content)) !== null) {
        const sql = match[1] ?? match[2] ?? match[3];
        if (!sql) continue;
        if (!/^\s*SELECT\b/i.test(sql) || !/\bLIMIT\b/i.test(sql)) continue;

        // Check if it involves one of the bulk-insert tables
        let hasTableRef = false;
        for (const table of bulkInsertTables) {
          if (new RegExp(`\\b${table}\\b`, "i").test(sql)) {
            hasTableRef = true;
            break;
          }
        }

        if (!hasTableRef) continue;

        // Check if ORDER BY created_at comes before LIMIT
        const upperSql = sql.toUpperCase();
        const orderByIndex = upperSql.indexOf("ORDER BY");
        const limitIndex = upperSql.indexOf("LIMIT");

        let violation = null;

        if (orderByIndex === -1) {
          violation = { file: filePath, sql, issue: "Missing ORDER BY before LIMIT" };
        } else if (limitIndex === -1) {
          // No LIMIT found, skip (shouldn't happen given the test above)
          continue;
        } else if (orderByIndex > limitIndex) {
          violation = { file: filePath, sql, issue: "ORDER BY comes after LIMIT" };
        } else {
          // Check if ORDER BY includes created_at
          const betweenOrderAndLimit = sql.substring(orderByIndex, limitIndex);
          if (!new RegExp("created_at", "i").test(betweenOrderAndLimit)) {
            violation = { file: filePath, sql, issue: "ORDER BY does not include created_at" };
          }
        }

        if (violation) {
          // Check if this is a grandfathered violation
          const isGrandfathered = GRANDFATHERED_QUERIES.some(
            (gq) =>
              gq.file === violation.file &&
              gq.sql.substring(0, 40) === violation.sql.substring(0, 40)
          );
          if (!isGrandfathered) {
            violations.push({ ...violation, sql: violation.sql.trim().substring(0, 60) });
          }
        }
      }
    }

    // Assert no (non-grandfathered) violations found
    assert.equal(
      violations.length,
      0,
      violations.length > 0
        ? "Chronology violations found:\n" +
            violations.map((v) => `  ${v.file}: ${v.issue} — ${v.sql}`).join("\n")
        : ""
    );

    // The grandfathered list itself must not silently grow beyond the two
    // reviewed, dated top-N aggregate exceptions.
    assert.equal(
      GRANDFATHERED_QUERIES.length,
      2,
      `GRANDFATHERED_QUERIES must stay at exactly its 2 reviewed, dated entries; found ${GRANDFATHERED_QUERIES.length}. ` +
        `Do not widen this list without the same review those two got. Instead, fix the underlying query.`
    );
  });
});

describe("chronology-ordering: behavioral tests", () => {
  let tempDir;
  let dbModule;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chronology-test-"));
    const testDbPath = path.join(tempDir, "test.db");
    process.env.DASHBOARD_DB_PATH = testDbPath;

    // Clear any cached db module
    delete require.cache[require.resolve("../db")];
    dbModule = require("../db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    delete process.env.DASHBOARD_DB_PATH;
  });

  it("Layer 6 detour-volume lookback (evaluateRules().detourVolume) is computed from the created_at-filtered window, independent of session-id vs inferred_at order", () => {
    // The R2 rule's own query (reconciliation.js) has no LIMIT — it is a
    // WHERE-filtered window (`inferred_at >= sinceIso`), not a top-N select,
    // so there is no "wrong subset" a LIMIT could pick. This test instead
    // proves the filter+ratio computation is correct when session ids
    // (the natural insertion/tiebreak order) do NOT correlate with
    // inferred_at — exactly the workflow-ingest.js bulk-insert-after-the-fact
    // shape §9.2 warns about — closing the coverage gap the catalog flagged
    // (this case previously duplicated listPendingDetours instead).
    const { evaluateRules } = require("../lib/reconciliation");
    const testCwd = "/test/detour-volume-real-lookback";
    const { stmts, db } = dbModule;

    stmts.upsertPlan.run(testCwd, "Test Plan", path.join(testCwd, "AGENT-PLAN.md"), null, 0);

    const now = new Date();
    const withinDays = (n) => new Date(now.getTime() - n * 86_400_000);

    // session ids ascending (sess-1..sess-5) DELIBERATELY do not correlate
    // with inferred_at: the newest-inferred row is sess-1 (id-ascending
    // first), and two rows sit OUTSIDE the 7-day lookback despite having
    // "later" ids than an in-window row.
    const fixtures = [
      { id: "sess-1", daysAgo: 1, kind: "detour" }, // in-window
      { id: "sess-2", daysAgo: 10, kind: "detour" }, // OUTSIDE window
      { id: "sess-3", daysAgo: 2, kind: "item" }, // in-window
      { id: "sess-4", daysAgo: 8, kind: "item" }, // OUTSIDE window
      { id: "sess-5", daysAgo: 3, kind: "detour" }, // in-window
    ];

    for (const f of fixtures) {
      stmts.insertSession.run(f.id, `Session ${f.id}`, "completed", testCwd, "claude-3", null);
      stmts.upsertFocusInference.run(
        f.id,
        testCwd,
        f.kind,
        f.kind === "item" ? "item1" : null,
        f.kind === "detour" ? `Detour from ${f.id}` : null,
        0.9,
        "heuristic",
        null
      );
      db.prepare("UPDATE focus_inferences SET inferred_at = ? WHERE session_id = ?").run(
        withinDays(f.daysAgo).toISOString(),
        f.id
      );
    }

    const result = evaluateRules(dbModule, testCwd, {
      now,
      graceDays: 1,
      lookbackDays: 7,
    });

    // In-window: sess-1 (detour), sess-3 (item), sess-5 (detour) = 3 total,
    // 2 detours. A query that used `id`/insertion order instead of
    // `inferred_at` for its window filter (or accidentally included the
    // out-of-window rows) would report totalClassified=5 / detourCount=3
    // instead — this pins the CORRECT, chronology-respecting answer.
    assert.equal(
      result.detourVolume.totalClassified,
      3,
      "only the 3 in-lookback-window sessions should count"
    );
    assert.equal(result.detourVolume.detourCount, 2, "2 of the 3 in-window sessions are detours");
    assert.ok(
      Math.abs(result.detourVolume.ratio - 2 / 3) < 1e-9,
      `ratio should be 2/3, got ${result.detourVolume.ratio}`
    );
  });

  it("listPendingDetours returns created_at-ordered rows, not id-ordered rows", () => {
    const testCwd = "/test/pending-cwd";
    const { stmts, db } = dbModule;

    const refs = ["ref-pend-1", "ref-pend-2", "ref-pend-3"];
    const now = new Date();
    // Scrambled: insertion order (and therefore id order) is 1,2,3, but the
    // created_at we set afterward is newest,middle,oldest — the opposite.
    const times = [
      new Date(now.getTime() + 60_000),
      new Date(now.getTime() + 30_000),
      new Date(now.getTime() - 30_000),
    ];

    assertOrderedByCreatedAt({
      seed: () => {
        for (const ref of refs) {
          stmts.upsertDetourDisposition.run(
            testCwd,
            null,
            null,
            "inferred",
            ref,
            null,
            `Pending ${ref}`,
            null
          );
        }
        refs.forEach((ref, i) => {
          db.prepare("UPDATE detour_dispositions SET created_at = ? WHERE source_ref = ?").run(
            times[i].toISOString(),
            ref
          );
        });
      },
      run: () => stmts.listPendingDetours.all(testCwd, 3).map((r) => r.source_ref),
      expected: ["ref-pend-3", "ref-pend-2", "ref-pend-1"],
      limit: 3,
    });
  });

  it("listStaleResolvedDetours returns created_at-ordered rows, not id-ordered rows", () => {
    const testCwd = "/test/stale-cwd";
    const { stmts, db } = dbModule;

    const refs = ["ref-stale-1", "ref-stale-2", "ref-stale-3"];
    const now = new Date();
    const times = [
      new Date(now.getTime() + 60_000),
      new Date(now.getTime() + 30_000),
      new Date(now.getTime() - 30_000),
    ];
    const seenTime = new Date(now.getTime() + 120_000);

    assertOrderedByCreatedAt({
      seed: () => {
        for (const ref of refs) {
          stmts.upsertDetourDisposition.run(
            testCwd,
            null,
            null,
            "inferred",
            ref,
            null,
            `Stale ${ref}`,
            null
          );
        }
        refs.forEach((ref, i) => {
          db.prepare("UPDATE detour_dispositions SET created_at = ? WHERE source_ref = ?").run(
            times[i].toISOString(),
            ref
          );
          db.prepare(
            "UPDATE detour_dispositions SET resolved_at = ?, source_seen_at = ?, disposition = 'fold_in' WHERE source_ref = ?"
          ).run(times[i].toISOString(), seenTime.toISOString(), ref);
        });
      },
      run: () => stmts.listStaleResolvedDetours.all(testCwd, 3).map((r) => r.source_ref),
      expected: ["ref-stale-3", "ref-stale-2", "ref-stale-1"],
      limit: 3,
    });
  });

  it("listDecisionQueue returns created_at-ordered rows, not id-ordered rows", () => {
    const testCwd = "/test/queue-cwd";
    const { stmts, db } = dbModule;

    const now = new Date();
    const times = [
      new Date(now.getTime() + 60_000),
      new Date(now.getTime() + 30_000),
      new Date(now.getTime() - 30_000),
    ];

    assertOrderedByCreatedAt({
      seed: () => {
        times.forEach((t, i) => {
          db.prepare(
            `INSERT INTO decision_queue (cwd, kind, message, created_at) VALUES (?, ?, ?, ?)`
          ).run(testCwd, "pace_alert", `Queue item ${i + 1}`, t.toISOString());
        });
      },
      // Exercise the REAL prepared statement, not a hand-rolled duplicate.
      run: () =>
        stmts.listDecisionQueue
          .all()
          .filter((r) => r.cwd === testCwd)
          .map((r) => r.message),
      // listDecisionQueue sorts DESC (newest first): item 1 (+60s) first,
      // item 3 (-30s) last.
      expected: ["Queue item 1", "Queue item 2", "Queue item 3"],
      limit: null,
    });
  });

  it("listRecentValueGenerationDurations returns created_at-ordered rows, not id-ordered rows (Value Pool Slice 2, DEC-5 ETA input)", () => {
    // G4 / §9.2: the ETA's SOLE input must sort `created_at DESC, id DESC`
    // BEFORE `LIMIT` — never `id DESC` alone, since a bulk-imported or
    // clock-skewed row's insertion order does not always track its real
    // recency. Scrambled deliberately: insertion order (ids) is 1,2,3, but
    // the created_at we set afterward is oldest,newest,middle — the query
    // must return newest-first by created_at, not by id.
    const { stmts, db } = dbModule;
    const now = new Date();
    const rows = [
      { project: "eta-proj-A", daysAgo: 5, durationMs: 1000, generated: 10 }, // oldest
      { project: "eta-proj-A", daysAgo: 1, durationMs: 3000, generated: 30 }, // newest
      { project: "eta-proj-A", daysAgo: 3, durationMs: 2000, generated: 20 }, // middle
    ];

    assertOrderedByCreatedAt({
      seed: () => {
        for (const r of rows) {
          stmts.insertValueSummaryGeneration.run(
            r.project,
            "tick",
            "ok",
            r.generated + 5,
            5,
            r.generated,
            0,
            0,
            "haiku",
            r.durationMs,
            0
          );
        }
        // Overwrite created_at to the scrambled-vs-id-insertion times above.
        const stampedRows = db
          .prepare(
            "SELECT id, duration_ms FROM value_summary_generation_log WHERE project_id = ? ORDER BY id ASC"
          )
          .all("eta-proj-A");
        stampedRows.forEach((row, i) => {
          const daysAgo = rows.find((r) => r.durationMs === row.duration_ms).daysAgo;
          db.prepare("UPDATE value_summary_generation_log SET created_at = ? WHERE id = ?").run(
            new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
            row.id
          );
        });
      },
      run: () =>
        stmts.listRecentValueGenerationDurationsForProject
          .all("eta-proj-A", 3)
          .map((r) => r.duration_ms),
      // Newest (1 day ago, duration 3000) first, oldest (5 days ago, 1000) last.
      expected: [3000, 2000, 1000],
      limit: 3,
    });
  });

  it("backfillDeclaredDetours processes events in created_at order, NOT id-insertion order (asserted by the id-order of the rows it creates, not a self-sorting re-query)", () => {
    // The old version of this test re-queried its own output with
    // `ORDER BY created_at ASC` and then asserted THAT was created_at-ordered
    // — tautological; deleting backfillDeclaredDetours' own ORDER BY could
    // never fail it. This version instead reads the disposition rows back by
    // THEIR OWN id-insertion sequence (ORDER BY id ASC) and asserts that
    // sequence matches chronological (created_at) event order — which fails
    // if the underlying SELECT in detours.js ever regresses to `ORDER BY id`.
    const testCwd = "/test/declared-cwd";
    const { stmts, db } = dbModule;

    const sessionId = "test-session-" + Date.now();
    stmts.insertSession.run(sessionId, "Test Session", "active", testCwd, "claude-3", null);

    const now = new Date();
    const time1 = new Date(now.getTime() + 60_000); // newest
    const time2 = new Date(now.getTime() + 30_000); // middle
    const time3 = new Date(now.getTime() - 30_000); // oldest

    // Insert events with id order (1,2,3) DELIBERATELY opposite created_at
    // order: the FIRST-inserted event (lowest id) has the NEWEST created_at,
    // the LAST-inserted event (highest id) has the OLDEST created_at —
    // exactly the workflow-ingest.js bulk-insert-after-the-fact shape.
    const event1Data = JSON.stringify({ verb: "feature", title: "Newest" });
    const event2Data = JSON.stringify({ verb: "bug", title: "Middle" });
    const event3Data = JSON.stringify({ verb: "push", title: "Oldest" });

    db.prepare(
      "INSERT INTO events (session_id, event_type, data, created_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, "Focus", event1Data, time1.toISOString()); // lowest id, newest created_at
    db.prepare(
      "INSERT INTO events (session_id, event_type, data, created_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, "Focus", event2Data, time2.toISOString());
    db.prepare(
      "INSERT INTO events (session_id, event_type, data, created_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, "Focus", event3Data, time3.toISOString()); // highest id, oldest created_at

    const detours = require("../lib/detours");
    detours.backfillDeclaredDetours(dbModule, testCwd, time3.toISOString());

    // Read by the dispositions' OWN insertion order (id ASC) — this is the
    // sequence backfillDeclaredDetours actually called upsertDetourDisposition
    // in. If the underlying SELECT used `ORDER BY id ASC` instead of
    // `ORDER BY created_at ASC`, it would process event1 (newest) FIRST and
    // event3 (oldest) LAST, producing an id-insertion sequence of
    // Newest, Middle, Oldest — the reverse of the correct sequence.
    const dispositions = db
      .prepare(
        "SELECT * FROM detour_dispositions WHERE cwd = ? AND source = 'declared' ORDER BY id ASC"
      )
      .all(testCwd);

    assert.equal(dispositions.length, 3, "should create one disposition per declared-detour event");
    assert.equal(
      dispositions[0].label,
      "Oldest",
      "the chronologically FIRST event must be upserted FIRST (lowest new id)"
    );
    assert.equal(
      dispositions[1].label,
      "Middle",
      "the chronologically SECOND event must be upserted SECOND"
    );
    assert.equal(
      dispositions[2].label,
      "Newest",
      "the chronologically LAST event must be upserted LAST (highest new id)"
    );
  });
});
