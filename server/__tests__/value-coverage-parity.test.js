/**
 * @file G2 — the single most load-bearing test in Value Pool Slice 2
 * (technical-plan.md §5/§6): proves the HTTP route (`GET /coverage`) and the
 * WS broadcast (`value_altitudes_updated`'s `coverage` field) carry the
 * IDENTICAL `coverageSnapshot` object for one seeded DB state. This guards
 * against a rogue RE-DERIVATION of the coverage/ETA arithmetic (§9.1's
 * twice-proven weak spot: a rogue-reader scan does not catch a rogue
 * re-derivation) — not merely a rogue read of `value-coverage.js`'s
 * exports. No client-side arithmetic anywhere in this test.
 *
 * Seeds via the `detour_dispositions` tier of `assembleValuePool` (no live
 * git repo needed — deterministic, hermetic) with the LLM forced off
 * (`DASHBOARD_FOCUS_INFER_MODE=heuristic`), so both paths' own
 * `enrichPoolAltitudes` calls converge on the same aggregate `pending`
 * (queued+unavailable) without any spawn mocking, and neither path's own
 * generation-log write (the tick's) ever qualifies for the ETA average
 * (`generated > 0` — LLM-off always yields `generated = 0`), so call order
 * between the two paths cannot skew the comparison.
 *
 * The single G2 case runs TWO real ticks with a real coverage-request stamp
 * in between, forcing a genuine passive->requested demand TRANSITION on the
 * second tick (DEC-6's own headline broadcast case: `generated === 0` but a
 * transition still forces a broadcast). This makes the tick's OWN broadcast
 * unconditionally happen — there is no `if (broadcastPayload)` fallback
 * branch that builds a comparison object from a hand-fed/hardcoded
 * `pool_size` inside this test; the assertion fails outright if the tick
 * does not broadcast a real payload, so this test cannot pass by comparing
 * a server output against itself.
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
  `dashboard-coverage-parity-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"; // LLM off — deterministic, hermetic

const { createApp, startServer } = require("../index");
const dbModule = require("../db");
const { db, stmts } = dbModule;
const { runValueSummaryTickOnce, __resetTickStateForTest } = require("../lib/value-summary-tick");

let server;
let BASE;

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    http
      .get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        });
      })
      .on("error", reject);
  });
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  delete process.env.DASHBOARD_FOCUS_INFER_MODE;
  server?.close();
  try {
    db.close();
  } catch {
    /* already closed */
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
});

function seedProjectWithDetourPool(suffix) {
  const projectId = `coverage-parity-${suffix}-${Date.now()}-${process.pid}`;
  const cwd = `/tmp/coverage-parity-cwd-${suffix}`;
  stmts.insertProject.run(projectId, `Coverage Parity ${suffix}`);
  stmts.insertProjectPath.run(projectId, cwd);

  // Three detour units — no live git repo needed (the detour tier reads
  // detour_dispositions directly). One is pre-cached (a cache hit); the
  // other two are misses that BOTH paths' own enrichPoolAltitudes call must
  // agree are "not described" (LLM off → unavailable either way).
  const refs = ["parity-ref-1", "parity-ref-2", "parity-ref-3"];
  for (const ref of refs) {
    stmts.upsertDetourDisposition.run(
      cwd,
      projectId,
      null,
      "inferred",
      ref,
      null,
      `Parity detour ${ref}`,
      null
    );
  }
  // rowToUnit() maps a detour row to value_source="detour",
  // value_ref=String(row.id) — NOT source_ref — so the pool's unitKey for
  // the first row must be built from its real autoincrement id, read back
  // here rather than guessed.
  const firstRow = db
    .prepare("SELECT id FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
    .get(cwd, refs[0]);
  const cachedUnitKey = `detour::${firstRow.id}::${cwd}`;
  stmts.upsertValueUnitSummary.run(
    cachedUnitKey,
    "Parity project text",
    "Parity stakeholder text",
    "haiku",
    null,
    `Parity detour ${refs[0]}`,
    null,
    "initial",
    null
  );
  return { projectId, cwd, refs };
}

describe("G2: HTTP route vs WS broadcast coverage parity (§9.1 DERIVED-DUAL-VIEW, named deliverable)", () => {
  it("GET /coverage's coverage object deep-equals a REAL tick broadcast's coverage object across a genuine demand transition", async () => {
    const { projectId } = seedProjectWithDetourPool("main");

    // 1st tick: passive, never-requested, no prior broadcast recorded for
    // this project — shouldBroadcastCoverage legitimately suppresses this
    // cycle (generated === 0, no transition possible against an absent
    // prior). This call's only job is to seed lastBroadcastState with the
    // "passive" baseline so the 2nd tick below has something to transition
    // FROM.
    __resetTickStateForTest();
    const firstTick = await runValueSummaryTickOnce(dbModule, {});
    assert.ok(firstTick.swept >= 1, "the first tick must have swept this project");

    // Stamp a REAL coverage request between the two ticks — this is what
    // forces a genuine demand transition (passive -> requested) on the next
    // tick, independent of `generated` staying 0 (LLM off). This is also
    // DEC-6's own headline case: a demand transition with zero units
    // generated this iteration must still broadcast.
    stmts.requestValueCoverage.run(projectId, new Date().toISOString());

    // 2nd tick: the demand transition MUST force a broadcast even though
    // generated stays 0. No fallback branch exists below — if the widened
    // DEC-6 broadcast condition (or the tick's own coverage computation) is
    // ever swapped for a rogue re-derivation, this assertion goes red.
    let broadcastPayload = null;
    const tickResult = await runValueSummaryTickOnce(dbModule, {
      broadcast: (type, payload) => {
        if (type === "value_altitudes_updated" && payload.project_id === projectId) {
          broadcastPayload = payload;
        }
      },
    });
    assert.ok(tickResult.swept >= 1, "the second tick must have swept this project");
    assert.ok(
      broadcastPayload,
      "the tick must have broadcast on the passive->requested transition — G2 compares the REAL payload, never a self-built fallback"
    );
    const tickCoverage = broadcastPayload.coverage;

    // Path 1: the HTTP route (probe mode — classify only, no log row),
    // fetched AFTER the request is stamped so both sides' requested_at is
    // non-null for the deep-equal below.
    const routeRes = await httpGet(`/api/project-plans/coverage?project_id=${projectId}`);
    assert.equal(routeRes.status, 200);
    const routeCoverage = routeRes.body.coverage;

    // Deep-equal every field EXCEPT computed_at (each call stamps its own
    // wall-clock timestamp — that is expected and NOT a parity violation).
    const strip = ({ computed_at, ...rest }) => rest;
    assert.deepEqual(
      strip(routeCoverage),
      strip(tickCoverage),
      "route and tick coverage objects must be identical except computed_at — any divergence is a rogue re-derivation (§9.1)"
    );
    assert.ok(routeCoverage.computed_at, "route computed_at must be a real timestamp");
    assert.ok(tickCoverage.computed_at, "tick computed_at must be a real timestamp");

    // Specific field-level pins (belt-and-braces, not just the blanket deepEqual):
    assert.equal(routeCoverage.pool_size, 3);
    assert.equal(
      routeCoverage.described,
      1,
      "1 of 3 units is described (the pre-existing cache hit)"
    );
    assert.equal(routeCoverage.pending, 2);
    assert.equal(routeCoverage.complete, false);
    assert.equal(
      routeCoverage.demand,
      "requested",
      "a live coverage request must read back as requested on both wires"
    );
    assert.ok(
      routeCoverage.requested_at,
      "requested_at must be non-null after stamping the request"
    );
    assert.equal(
      routeCoverage.eta.state,
      "estimating",
      "LLM off means zero qualifying log rows anywhere"
    );
  });

  it("no client-side arithmetic: this test file itself never computes described/pending/complete", () => {
    const source = fs.readFileSync(__filename, "utf8");
    // Sentinel: the ONLY arithmetic-looking subtraction/addition allowed in
    // this file is inside the doc comment / assertion labels, never a real
    // `poolSize - queued - unavailable`-shaped expression building a value
    // this test then asserts against its own computation.
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
      /pool_size\s*-\s*(queued|counts\.queued)/,
      "this parity test must never re-derive 'described' itself — it only compares two SERVER outputs"
    );
  });
});
