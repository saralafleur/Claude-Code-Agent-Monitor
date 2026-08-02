/**
 * @file Tests for GET /api/portfolio/summary (layer 7 read model,
 * server/lib/portfolio.js): per-project milestone completion + live pace
 * status. Cross-checks every pace number this endpoint returns against
 * pace.js's own paceStatus() directly (§9.1 DERIVED-DUAL-VIEW guard) rather
 * than trusting the route's own arithmetic, and proves a sub-item (no
 * item_number) counts toward milestones but never toward pace — mirroring
 * reconciliation.js's R1 filter exactly.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-portfolio-summary-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");
const pace = require("../lib/pace");

let server;
let BASE;
let cwdA;
let cwdB;
let projectAId;
let projectBId;

function fetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

const post = (p, body) => fetch(p, { method: "POST", body });

function daysAgo(n) {
  return pace.localDayString(new Date(Date.now() - n * 86_400_000));
}

before(async () => {
  cwdA = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-a-"));
  cwdB = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-b-"));

  fs.writeFileSync(
    path.join(cwdA, "AGENT-PLAN.md"),
    [
      "# Project A plan",
      "- [x] 1. Already done",
      "- [ ] 2. Overdue by a lot",
      "- [ ] 3. Overdue by a little",
      "- [ ] 4. No target set yet",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(cwdB, "AGENT-PLAN.md"),
    ["# Project B plan", "- [ ] 1. On track for today", ""].join("\n")
  );

  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;

  const createA = await post("/api/projects", { name: "Portfolio Test A", cwds: [cwdA] });
  projectAId = createA.body.project.id;
  const createB = await post("/api/projects", { name: "Portfolio Test B", cwds: [cwdB] });
  projectBId = createB.body.project.id;

  await post("/api/plans/refresh", { cwd: cwdA });
  await post("/api/plans/refresh", { cwd: cwdB });

  // Item 2: badly overdue. Item 3: overdue by one day. Item 4: left untouched
  // (no_target). Item 1 is already checked in the source markdown - done
  // must win regardless of any target date it might also carry.
  await post("/api/plans/items/target", { cwd: cwdA, item_number: 2, target_date: daysAgo(5) });
  await post("/api/plans/items/target", { cwd: cwdA, item_number: 3, target_date: daysAgo(2) });
  await post("/api/plans/items/target", { cwd: cwdB, item_number: 1, target_date: daysAgo(0) });

  // A sub-item (fold_in shape: no item_number, has parent_item_id) inserted
  // directly - this endpoint must count it toward milestones but never
  // toward pace, same as reconciliation.js's own R1 filter.
  stmts.upsertPlanItem.run(cwdA, "sub-item-1", null, "1", "A nested sub-item", null, null, 0, 99);
});

after(() => {
  server?.close();
  try {
    db.close();
  } catch {
    /* already closed */
  }
  for (const dir of [cwdA, cwdB]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("GET /api/portfolio/summary", () => {
  it("returns one entry per real project, keyed by project_id", async () => {
    const res = await fetch("/api/portfolio/summary");
    assert.equal(res.status, 200);
    const ids = res.body.projects.map((p) => p.project_id).sort();
    assert.deepEqual(ids, [projectAId, projectBId].sort());
  });

  it("milestones count every item including the numberless sub-item, with 'done' via pace.isComplete", async () => {
    const res = await fetch("/api/portfolio/summary");
    const a = res.body.projects.find((p) => p.project_id === projectAId);
    // 4 numbered items + 1 sub-item = 5 total; only item 1 is checked.
    assert.deepEqual(a.milestones, { done: 1, total: 5 });
  });

  it("buckets pace counts and never counts the numberless sub-item toward pace", async () => {
    const res = await fetch("/api/portfolio/summary");
    const a = res.body.projects.find((p) => p.project_id === projectAId);
    // item 1 -> done, item 2 -> behind, item 3 -> behind, item 4 -> no_target.
    // Sub-item is excluded entirely (item_number is null).
    assert.deepEqual(a.pace.counts, { no_target: 1, on_track: 0, behind: 2, done: 1 });
  });

  it("lists only the truly-behind items, sorted worst-overdue first, matching pace.js exactly", async () => {
    const res = await fetch("/api/portfolio/summary");
    const a = res.body.projects.find((p) => p.project_id === projectAId);

    assert.equal(a.pace.behind.length, 2);
    assert.equal(a.pace.behind[0].item_number, 2);
    assert.equal(a.pace.behind[1].item_number, 3);

    // Cross-check against pace.js directly for each behind row - this
    // endpoint must never re-derive the day-math independently of the
    // single source of truth every other layer already calls.
    const items = stmts.listPlanItems.all(cwdA);
    for (const row of a.pace.behind) {
      const item = items.find((i) => i.item_number === row.item_number);
      const expected = pace.paceStatus(item, { graceDays: pace.paceGraceDaysFromEnv() });
      assert.equal(expected.status, "behind");
      assert.equal(row.days_overdue, expected.days_overdue);
      assert.equal(row.target_date, expected.target_date);
      assert.equal(row.cwd, cwdA);
    }
  });

  it("treats a today-dated target as on_track, not behind (DEC-6 boundary)", async () => {
    const res = await fetch("/api/portfolio/summary");
    const b = res.body.projects.find((p) => p.project_id === projectBId);
    assert.deepEqual(b.pace.counts, { no_target: 0, on_track: 1, behind: 0, done: 0 });
    assert.deepEqual(b.pace.behind, []);
  });

  it("a project with no mapped folders (no plan at all) returns zeroed rollups, not an error", async () => {
    const created = await post("/api/projects", { name: "Portfolio Test Empty" });
    const res = await fetch("/api/portfolio/summary");
    const empty = res.body.projects.find((p) => p.project_id === created.body.project.id);
    assert.ok(empty, "empty project should still appear in the rollup");
    assert.deepEqual(empty.milestones, { done: 0, total: 0 });
    assert.deepEqual(empty.pace.counts, { no_target: 0, on_track: 0, behind: 0, done: 0 });
    assert.deepEqual(empty.pace.behind, []);
  });
});
