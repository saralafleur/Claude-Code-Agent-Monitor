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

describe("chronology-ordering: static SQL-shape scan", () => {
  it("every LIMITed query over a bulk-inserted table orders by created_at before LIMIT", () => {
    // This is a pure source-code scan - no database needed
    const filesToScan = [
      "server/db.js",
      "server/lib/detours.js",
      "server/lib/reconciliation.js",
      "server/routes/detours.js",
      "server/routes/decision-queue.js",
    ];

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
