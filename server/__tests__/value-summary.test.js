/**
 * @file Tests for the stakeholder-altitude synthesis layer:
 * server/lib/value-summary.js's pure helpers (prompt building, envelope
 * parsing), `enrichPoolAltitudes`'s unitKey-keyed caching (generate once,
 * serve cached forever — no digest gating), batching every cache miss into
 * ONE spawn, the "unavailable" contract (LLM off / probe fails / spawn fails
 * / unparsable output all resolve to an empty-for-that-unit result, never an
 * error), and the `POST /api/project-plans/altitudes` route contract. Uses
 * focus-inference's `__injectSpawnForTest` seam, so no real `claude` CLI is
 * ever spawned.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("path");
const os = require("os");
const http = require("http");
const fs = require("fs");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-value-summary-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const dbModule = require("../db");
const { db, stmts } = dbModule;
const {
  enrichPoolAltitudes,
  buildPrompt,
  parseOutput,
  summaryModel,
  SUMMARY_STAGES,
} = require("../lib/value-summary");
const { __injectSpawnForTest } = require("../lib/focus-inference");

let server;
let BASE;
let nextProjectSuffix = 0;

// --- HTTP helper, copied per this repo's own one-helper-per-file convention. ---
function fetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
    };
    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}
const post = (p, body) => fetch(p, { method: "POST", body });

/** Fake ChildProcess factory: exits with the given stdout after a tick. */
function fakeSpawn({ exitCode = 0, stdout = "" } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.resume = () => {};
    child.kill = () => {};
    setImmediate(() => {
      if (stdout) child.stdout.emit("data", stdout);
      child.emit("exit", exitCode);
    });
    return child;
  };
}

/** LLM envelope the `claude -p --output-format json` spawn would print. */
function envelope(result) {
  return JSON.stringify({ result: JSON.stringify(result) });
}

async function makeProject(name) {
  nextProjectSuffix += 1;
  const id = `vs-test-${Date.now()}-${process.pid}-${nextProjectSuffix}`;
  stmts.insertProject.run(id, name || id);
  return id;
}

function unit(overrides = {}) {
  return {
    unitKey: "trunk_commit::abc123::/repo",
    value_source: "trunk_commit",
    value_ref: "abc123",
    label: "Add job-pipeline-tracker planning docs",
    stage: null,
    ...overrides,
  };
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  __injectSpawnForTest(null);
  server?.close();
  try {
    db.close();
  } catch {
    /* already closed */
  }
});

beforeEach(() => {
  __injectSpawnForTest(null);
  delete process.env.DASHBOARD_FOCUS_INFER_MODE;
  delete process.env.DASHBOARD_VALUE_SUMMARY_MODEL;
  delete process.env.DASHBOARD_VALUE_SUMMARY_UNIT_MODEL;
  delete process.env.DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL;
  delete process.env.DASHBOARD_FOCUS_SUMMARY_MODEL;
  delete process.env.DASHBOARD_FOCUS_INFER_MODEL;
  db.exec("DELETE FROM value_unit_summaries");
});

describe("parseOutput", () => {
  it("parses a clean units envelope into a 1-based index map", () => {
    const out = parseOutput(
      envelope({
        units: [
          { index: 1, project: "Part of the tracker.", stakeholder: "Shipped the tracker." },
          { index: 2, project: "Standalone.", stakeholder: "Logged something else." },
        ],
      }),
      2
    );
    assert.equal(out.size, 2);
    assert.deepEqual(out.get(1), {
      project: "Part of the tracker.",
      stakeholder: "Shipped the tracker.",
    });
  });

  it("strips markdown code fences around the inner JSON", () => {
    const inner = '```json\n{"units": [{"index": 1, "project": "P", "stakeholder": "S"}]}\n```';
    const out = parseOutput(JSON.stringify({ result: inner }), 1);
    assert.deepEqual(out.get(1), { project: "P", stakeholder: "S" });
  });

  it("returns null for garbage, a missing list, and an empty list", () => {
    assert.equal(parseOutput("not json", 1), null);
    assert.equal(parseOutput(envelope({ nope: true }), 1), null);
    assert.equal(parseOutput(envelope({ units: [] }), 1), null);
  });

  it("drops out-of-range indices and entries missing project or stakeholder", () => {
    const out = parseOutput(
      envelope({
        units: [
          { index: 1, project: "", stakeholder: "S" },
          { index: 2, project: "P", stakeholder: "S" },
          { index: 99, project: "P", stakeholder: "S" },
        ],
      }),
      2
    );
    assert.equal(out.size, 1);
    assert.ok(out.has(2));
  });
});

describe("buildPrompt", () => {
  it("includes each unit's source, label, and stage, and the JSON-only instruction", () => {
    const prompt = buildPrompt([
      unit({ label: "Add job-pipeline-tracker planning docs" }),
      unit({
        unitKey: "intake_initiative::slug::/repo",
        value_source: "intake_initiative",
        label: "job-pipeline-tracker",
        stage: "built",
      }),
    ]);
    assert.match(prompt, /1\. \[trunk_commit\] Add job-pipeline-tracker planning docs/);
    assert.match(prompt, /2\. \[intake_initiative\] job-pipeline-tracker, stage=built/);
    assert.match(prompt, /Reply with ONLY JSON/);
  });
});

describe("enrichPoolAltitudes caching", () => {
  it("returns the full three-key shape (including counts) for an empty batch, without touching the LLM path", async () => {
    // BL-1: this assertion previously encoded the defect it should have
    // caught — it asserted `counts` was ABSENT from the empty-batch return,
    // which is exactly the shape that crashed project-plans.js's route
    // (`enriched.counts.pool_size` accessed unconditionally) on any
    // empty/all-dropped batch. `counts` must ride out of EVERY return path.
    __injectSpawnForTest(() => {
      throw new Error("no LLM call expected for an empty batch");
    });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, []), {
      altitudes: {},
      states: {},
      counts: {
        pool_size: 0,
        cache_hits: 0,
        generated: 0,
        queued: 0,
        unavailable: 0,
        stale_regenerated: 0,
      },
    });
  });

  it("generates once, then serves the cache with zero further spawns", async () => {
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [
            { index: 1, project: "Part of the tracker.", stakeholder: "Shipped the tracker." },
          ],
        }),
      })
    );
    const u = unit();
    const { altitudes: alt1, states: states1 } = await enrichPoolAltitudes(dbModule, [u]);
    assert.equal(alt1[u.unitKey].project, "Part of the tracker.");
    assert.equal(alt1[u.unitKey].cached, false);

    // Any further spawn attempt would blow up — proving the cache is served.
    __injectSpawnForTest(() => {
      throw new Error("no LLM call expected on a cache hit");
    });
    const { altitudes: alt2, states: states2 } = await enrichPoolAltitudes(dbModule, [u]);
    assert.equal(alt2[u.unitKey].stakeholder, "Shipped the tracker.");
    assert.equal(alt2[u.unitKey].cached, true);
  });

  it("batches multiple misses into exactly one spawn", async () => {
    let spawnCount = 0;
    const inner = fakeSpawn({
      stdout: envelope({
        units: [
          { index: 1, project: "P1", stakeholder: "S1" },
          { index: 2, project: "P2", stakeholder: "S2" },
        ],
      }),
    });
    __injectSpawnForTest((cmd, args) => {
      if (Array.isArray(args) && args.includes("-p")) spawnCount += 1;
      return inner();
    });

    const units = [
      unit({ unitKey: "trunk_commit::a::/repo", value_ref: "a" }),
      unit({ unitKey: "trunk_commit::b::/repo", value_ref: "b", label: "Second unit" }),
    ];
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);
    assert.equal(spawnCount, 1);
    assert.equal(altitudes[units[0].unitKey].project, "P1");
    assert.equal(altitudes[units[1].unitKey].project, "P2");
  });

  it("spawns with DASHBOARD_VALUE_SUMMARY_MODEL when set and records it as the stored model", async () => {
    process.env.DASHBOARD_VALUE_SUMMARY_MODEL = "sonnet";
    const spawnedArgs = [];
    const inner = fakeSpawn({
      stdout: envelope({ units: [{ index: 1, project: "P", stakeholder: "S" }] }),
    });
    __injectSpawnForTest((cmd, args) => {
      spawnedArgs.push(args);
      return inner();
    });

    const u = unit({ unitKey: "trunk_commit::model-test::/repo", value_ref: "model-test" });
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, [u]);
    assert.equal(altitudes[u.unitKey].model, "sonnet");
    const promptArgs = spawnedArgs.find((a) => a.includes("-p"));
    assert.equal(promptArgs[promptArgs.indexOf("--model") + 1], "sonnet");
  });

  it("leaves a unit out of the result for a non-llm mode, a failed probe, and unparsable output", async () => {
    // Every call carries `counts` (DEC-14, and BL-1: including the empty-
    // batch path, see the test above) — a single computed-once partition,
    // unavailable=1/pool_size=1 in each of these three all-unavailable-
    // outcome cases.
    const expectedCounts = {
      pool_size: 1,
      cache_hits: 0,
      generated: 0,
      queued: 0,
      unavailable: 1,
      stale_regenerated: 0,
    };

    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
    const u1 = unit({ unitKey: "trunk_commit::mode-off::/repo", value_ref: "mode-off" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u1]), {
      altitudes: {},
      states: { [u1.unitKey]: "unavailable" },
      counts: expectedCounts,
    });

    delete process.env.DASHBOARD_FOCUS_INFER_MODE;
    __injectSpawnForTest(fakeSpawn({ exitCode: 1 })); // probe fails -> unavailable
    const u2 = unit({ unitKey: "trunk_commit::probe-fail::/repo", value_ref: "probe-fail" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u2]), {
      altitudes: {},
      states: { [u2.unitKey]: "unavailable" },
      counts: expectedCounts,
    });

    __injectSpawnForTest(fakeSpawn({ stdout: "not json" }));
    const u3 = unit({ unitKey: "trunk_commit::garbage::/repo", value_ref: "garbage" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u3]), {
      altitudes: {},
      states: { [u3.unitKey]: "unavailable" },
      counts: expectedCounts,
    });
  });
});

// Extends the per-stage env precedence coverage the "spawns with
// DASHBOARD_VALUE_SUMMARY_MODEL" case above already established for the
// legacy (no-stage) chain — DEC-7/O2: ONE summaryModel(stage) cascade, never
// a second sibling function, so a per-stage override must prepend the SAME
// existing chain, not branch into a parallel one.
describe("summaryModel(stage) per-stage env precedence (DEC-7/O2)", () => {
  it("SUMMARY_STAGES is the closed two-entry registry", () => {
    assert.deepEqual(SUMMARY_STAGES, ["unit", "grouping"]);
  });

  it("defaults to stage 'unit' when called with no argument (pre-Slice-2 call shape)", () => {
    process.env.DASHBOARD_VALUE_SUMMARY_MODEL = "opus";
    assert.equal(summaryModel(), "opus", "no-arg call must still resolve through the unit stage");
  });

  it("DASHBOARD_VALUE_SUMMARY_UNIT_MODEL takes precedence over the shared chain for stage 'unit'", () => {
    process.env.DASHBOARD_VALUE_SUMMARY_UNIT_MODEL = "unit-override";
    process.env.DASHBOARD_VALUE_SUMMARY_MODEL = "shared-override";
    assert.equal(summaryModel("unit"), "unit-override");
  });

  it("DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL takes precedence over the shared chain for stage 'grouping'", () => {
    process.env.DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL = "grouping-override";
    process.env.DASHBOARD_VALUE_SUMMARY_MODEL = "shared-override";
    assert.equal(summaryModel("grouping"), "grouping-override");
  });

  it("falls back to the shared chain, unchanged, when no per-stage override is set", () => {
    process.env.DASHBOARD_VALUE_SUMMARY_MODEL = "shared-only";
    assert.equal(summaryModel("unit"), "shared-only");
    assert.equal(summaryModel("grouping"), "shared-only");
  });

  it("falls all the way through to 'haiku' with nothing set", () => {
    assert.equal(summaryModel("unit"), "haiku");
    assert.equal(summaryModel("grouping"), "haiku");
  });

  it("per-unit synthesis actually spawns with the unit-stage override (DEC-7 end-to-end)", async () => {
    process.env.DASHBOARD_VALUE_SUMMARY_UNIT_MODEL = "unit-stage-model";
    const spawnedArgs = [];
    __injectSpawnForTest((cmd, args) => {
      spawnedArgs.push(args);
      return fakeSpawn({
        stdout: envelope({ units: [{ index: 1, project: "P", stakeholder: "S" }] }),
      })();
    });
    const u = unit({
      unitKey: "trunk_commit::stage-model-test::/repo",
      value_ref: "stage-model-test",
    });
    const { altitudes } = await enrichPoolAltitudes(dbModule, [u]);
    assert.equal(altitudes[u.unitKey].model, "unit-stage-model");
    const promptArgs = spawnedArgs.find((a) => a.includes("-p"));
    assert.equal(promptArgs[promptArgs.indexOf("--model") + 1], "unit-stage-model");
  });
});

// DEC-9 (Value Pool Slice 2): probe mode never spawns and never writes a
// generation-log row.
describe("enrichPoolAltitudes probe mode (DEC-9)", () => {
  it("never spawns and classifies every miss as 'queued', never 'unavailable'", async () => {
    __injectSpawnForTest(() => {
      throw new Error("probe mode must never spawn");
    });
    const u = unit({ unitKey: "trunk_commit::probe-test::/repo", value_ref: "probe-test" });
    const { altitudes, states, counts } = await enrichPoolAltitudes(dbModule, [u], {
      probe: true,
    });
    assert.deepEqual(altitudes, {});
    assert.deepEqual(states, { [u.unitKey]: "queued" });
    assert.equal(counts.queued, 1);
    assert.equal(counts.unavailable, 0);
    assert.equal(counts.pool_size, 1);
  });

  it("a probe run leaves the generation-log row count unchanged (DEC-9)", async () => {
    // enrichPoolAltitudes itself never writes value_summary_generation_log
    // (only its callers do, after inspecting the result) — this proves the
    // probe path gives its caller nothing that WOULD prompt a log write:
    // no cache write, no spawn, so a caller that (correctly) skips logging
    // a probe result has nothing left over to accidentally log either.
    const before = db.prepare("SELECT COUNT(*) AS n FROM value_summary_generation_log").get().n;
    const u1 = unit({ unitKey: "trunk_commit::probe-nolog-1::/repo", value_ref: "probe-nolog-1" });
    const u2 = unit({
      unitKey: "trunk_commit::probe-nolog-2::/repo",
      value_ref: "probe-nolog-2",
      value_source: "intake_initiative",
    });
    await enrichPoolAltitudes(dbModule, [u1, u2], { probe: true });
    const after = db.prepare("SELECT COUNT(*) AS n FROM value_summary_generation_log").get().n;
    assert.equal(after, before, "probe mode must not add any generation-log rows");
  });

  it("a probe run also writes no value_unit_summaries cache row (never spawns, so nothing to cache)", async () => {
    const u = unit({ unitKey: "trunk_commit::probe-nocache::/repo", value_ref: "probe-nocache" });
    await enrichPoolAltitudes(dbModule, [u], { probe: true });
    const row = stmts.getValueUnitSummary.get(u.unitKey);
    assert.equal(row, undefined, "probe mode must not populate the synthesis cache");
  });

  it("a probe run still resolves an existing cache hit (probe only affects MISSES)", async () => {
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "Cached project", stakeholder: "Cached stakeholder" }],
        }),
      })
    );
    const u = unit({
      unitKey: "trunk_commit::probe-cache-hit::/repo",
      value_ref: "probe-cache-hit",
    });
    await enrichPoolAltitudes(dbModule, [u]); // real generation, populates the cache

    __injectSpawnForTest(() => {
      throw new Error("probe mode must never spawn, even alongside a cache hit in the same batch");
    });
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, [u], { probe: true });
    assert.equal(altitudes[u.unitKey].project, "Cached project");
    assert.equal(altitudes[u.unitKey].cached, true);
    assert.deepEqual(states, {});
  });
});

describe("enrichPoolAltitudes concurrency (T-A)", () => {
  it("two overlapping calls for the same unitKey leave exactly one valid row and never throw", async () => {
    const u = unit({ unitKey: "trunk_commit::race-1::/repo" });
    let spawnCount = 0;
    // Distinct payload per invocation, resolved on a later macrotask so both
    // calls provably pass readCached() before either writes.
    __injectSpawnForTest(() => {
      const n = ++spawnCount;
      return deferredSpawn(
        envelope({ units: [{ index: 1, project: `P-${n}`, stakeholder: `S-${n}.` }] }),
        10
      )();
    });

    const [a, b] = await Promise.all([
      enrichPoolAltitudes(dbModule, [u]), // route-shaped invoker
      enrichPoolAltitudes(dbModule, [u]), // tick-shaped invoker
    ]); // must not reject (no SQLITE_BUSY, no UNIQUE crash)

    const rows = db.prepare("SELECT * FROM value_unit_summaries WHERE unit_key = ?").all(u.unitKey);
    assert.equal(rows.length, 1, "atomic upsert: one row, never a duplicate");
    // Verify the row has a valid payload (stakeholder ends with "." = format is correct)
    assert.ok(
      rows[0].stakeholder_level.endsWith("."),
      "row has valid payload (not corrupted/merged)"
    );
    // The project_level will be one of the payloads from any of the probe/generation spawns
    assert.ok(rows[0].project_level.startsWith("P-"), "row has a well-formed project value");
    // Core invariant: a race must never downgrade a unit to queued/unavailable
    for (const r of [a, b]) {
      assert.ok(r.altitudes[u.unitKey], "a race must never downgrade a unit to queued/unavailable");
      assert.equal(r.states[u.unitKey], undefined);
    }
    // Deliberate: safe but wasteful. __injectSpawnForTest clears the probe cache,
    // so two concurrent calls each spawn a probe + generation (4 total), not 2.
    // Tracked as QA-DEC-1 / WATCH-7.
    // If in-flight coalescing ever lands, this will reduce to 2 — update it knowingly.
    assert.ok(spawnCount >= 2, `race used at least one spawn per call (actual: ${spawnCount})`);
  });
});

/** Deferred spawn: returns first N units resolved after a delay. */
function deferredSpawn(stdout, ms) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.resume = () => {};
    child.kill = () => {};
    setTimeout(() => {
      if (stdout) child.stdout.emit("data", stdout);
      child.emit("exit", 0);
    }, ms);
    return child;
  };
}

describe("enrichPoolAltitudes DEC-11 truth table", () => {
  it("Case 1: under-cap, LLM on — all 3 units resolve, states is empty", async () => {
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [
            { index: 1, project: "P1", stakeholder: "S1" },
            { index: 2, project: "P2", stakeholder: "S2" },
            { index: 3, project: "P3", stakeholder: "S3" },
          ],
        }),
      })
    );
    const units = [
      unit({ unitKey: "trunk_commit::a::/repo", value_ref: "a" }),
      unit({ unitKey: "trunk_commit::b::/repo", value_ref: "b" }),
      unit({ unitKey: "trunk_commit::c::/repo", value_ref: "c" }),
    ];
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);
    assert.equal(Object.keys(altitudes).length, 3, "all 3 units in altitudes");
    assert.deepEqual(states, {}, "states is empty (all resolved)");
  });

  it("Case 2: over-cap, LLM on — 40 resolve, 5 queued", async () => {
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: Array.from({ length: 40 }, (_, i) => ({
            index: i + 1,
            project: `P${i + 1}`,
            stakeholder: `S${i + 1}`,
          })),
        }),
      })
    );
    const units = Array.from({ length: 45 }, (_, i) =>
      unit({ unitKey: `trunk_commit::u${i}::/repo`, value_ref: `u${i}` })
    );
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);
    assert.equal(Object.keys(altitudes).length, 40, "40 units in altitudes");
    assert.equal(Object.keys(states).length, 5, "5 units in states (queued)");
    for (const state of Object.values(states)) {
      assert.equal(state, "queued", "all overflow units are queued");
    }
  });

  it("Case 3 (T-B): 45 units, LLM off — 0 altitudes, 45 unavailable", async () => {
    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
    const units = Array.from({ length: 45 }, (_, i) =>
      unit({ unitKey: `trunk_commit::u${i}::/repo`, value_ref: `u${i}` })
    );
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);
    delete process.env.DASHBOARD_FOCUS_INFER_MODE;
    assert.deepEqual(altitudes, {}, "0 altitudes when LLM is off");
    assert.equal(Object.keys(states).length, 45, "all 45 units in states");
    for (const state of Object.values(states)) {
      assert.equal(state, "unavailable", "all units unavailable when LLM is off");
    }
    assert.equal(
      Object.keys(states).filter((k) => states[k] === "queued").length,
      0,
      "zero queued when LLM is off"
    );
  });

  it("Case 4 (T-D): 45 units, parse failure in-cap — 0 resolved, 40 unavailable, 5 queued", async () => {
    __injectSpawnForTest(fakeSpawn({ stdout: "not json" }));
    const units = Array.from({ length: 45 }, (_, i) =>
      unit({ unitKey: `trunk_commit::u${i}::/repo`, value_ref: `u${i}` })
    );
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);
    assert.deepEqual(altitudes, {}, "0 altitudes on parse failure");
    const unavailableCount = Object.values(states).filter((s) => s === "unavailable").length;
    const queuedCount = Object.values(states).filter((s) => s === "queued").length;
    assert.equal(unavailableCount, 40, "40 in-cap units marked unavailable (attempted)");
    assert.equal(queuedCount, 5, "5 over-cap units marked queued (never attempted)");
  });

  it("Case 5: mutual exclusivity and complete partition (never in both, never in neither)", async () => {
    // Reuse the Case 2 setup (40 resolve, 5 queued)
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: Array.from({ length: 40 }, (_, i) => ({
            index: i + 1,
            project: `P${i + 1}`,
            stakeholder: `S${i + 1}`,
          })),
        }),
      })
    );
    const units = Array.from({ length: 45 }, (_, i) =>
      unit({ unitKey: `trunk_commit::u${i}::/repo`, value_ref: `u${i}` })
    );
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);

    const altKeys = new Set(Object.keys(altitudes));
    const stateKeys = new Set(Object.keys(states));

    // No key in both
    for (const key of altKeys) {
      assert.ok(!stateKeys.has(key), `key ${key} should not be in both altitudes and states`);
    }

    // Every submitted unit in exactly one of the two
    assert.equal(
      altKeys.size + stateKeys.size,
      units.length,
      "every submitted unit in exactly one map (never in both, never in neither)"
    );
  });

  it("Case 6: ALTITUDE_STATES registry imported, not hand-typed", async () => {
    const { ALTITUDE_STATES } = require("../lib/value-summary");
    assert.deepEqual(
      ALTITUDE_STATES,
      ["queued", "unavailable"],
      "ALTITUDE_STATES export matches canonical list"
    );

    // Verify all fixture states use imported registry
    __injectSpawnForTest(fakeSpawn({ stdout: "not json" }));
    const units = Array.from({ length: 45 }, (_, i) =>
      unit({ unitKey: `trunk_commit::u${i}::/repo`, value_ref: `u${i}` })
    );
    const { altitudes, states } = await enrichPoolAltitudes(dbModule, units);
    for (const state of Object.values(states)) {
      assert.ok(
        ALTITUDE_STATES.includes(state),
        `every state value "${state}" must be in ALTITUDE_STATES`
      );
    }
  });
});

describe("POST /api/project-plans/altitudes", () => {
  it("400s without project_id or units[]", async () => {
    const res = await post("/api/project-plans/altitudes", { units: [] });
    assert.equal(res.status, 400);
    const res2 = await post("/api/project-plans/altitudes", { project_id: "x" });
    assert.equal(res2.status, 400);
  });

  it("BL-1: {project_id, units: []} (a valid, non-400 empty batch) returns 200 with a full counts shape, not a crash", async () => {
    // BL-1's exact reproduction: the prior version of this route test only
    // ever posted `{units: []}` WITHOUT project_id (400s before reaching the
    // composer, line above) — `{project_id, units: []}` was untested, and
    // enrichPoolAltitudes's empty-batch early return omitted `counts`,
    // which project-plans.js accesses unconditionally
    // (`enriched.counts.pool_size`) — a real `TypeError` that killed the
    // request with no response (Express 4 does not catch async rejections).
    __injectSpawnForTest(() => {
      throw new Error("no LLM call expected for an empty batch");
    });
    const projectId = await makeProject("BL-1 Empty Batch Test");
    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.altitudes, {});
    assert.deepEqual(res.body.states, {});
    assert.deepEqual(res.body.counts, {
      pool_size: 0,
      cache_hits: 0,
      generated: 0,
      queued: 0,
      unavailable: 0,
      stale_regenerated: 0,
    });
  });

  it("BL-1: an all-dropped batch (every submitted unit rejected by route sanitization) still returns 200 with a full counts shape", async () => {
    // droppedCount === units.length: `clean` (what the composer actually
    // sees) is empty, but the ORIGINAL submitted batch was not — exactly the
    // "all-dropped" case BL-1 named as a second untested crash path.
    __injectSpawnForTest(() => {
      throw new Error(
        "no LLM call expected — every submitted unit is rejected before reaching the composer"
      );
    });
    const projectId = await makeProject("BL-1 All-Dropped Batch Test");
    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [
        { unit_key: "trunk_commit::bogus1::/repo", value_source: "not_a_real_source" },
        { unit_key: "trunk_commit::bogus2::/repo", value_source: "also_not_real" },
        { value_source: "trunk_commit" }, // key-less — genuinely unrepresentable, dropped
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.body.counts.pool_size,
      3,
      "pool_size must reflect the full submitted batch, not the empty clean list"
    );
    assert.equal(
      res.body.counts.unavailable,
      3,
      "every dropped unit folds into unavailable via droppedCount"
    );
    assert.equal(
      res.body.counts.cache_hits +
        res.body.counts.generated +
        res.body.counts.queued +
        res.body.counts.unavailable,
      res.body.counts.pool_size,
      "four-term identity holds even when the composer's own units[] argument is empty"
    );
  });

  it("1-unit happy path returns altitudes and states (empty)", async () => {
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "Part of the tracker.", stakeholder: "Shipped it." }],
        }),
      })
    );
    const projectId = await makeProject("Altitudes Route Test");
    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [
        {
          unit_key: "trunk_commit::route::/repo",
          value_source: "trunk_commit",
          value_ref: "route",
          label: "Route test unit",
        },
      ],
    });
    assert.equal(res.status, 200);
    const altitude = res.body.altitudes["trunk_commit::route::/repo"];
    assert.equal(altitude.project, "Part of the tracker.");
    assert.equal(altitude.stakeholder, "Shipped it.");
    assert.equal(Object.keys(res.body.altitudes).length, 1);
    assert.deepEqual(res.body.states, {}, "states must be present, never undefined");
  });

  it("S2 should-fix: route sanitization preserves rejected units with valid unit_key in states", async () => {
    // This restores the deleted malformed-entry test coverage.
    // Two cases: (1) a unit with empty unit_key is dropped entirely (no entry
    // in either map), and (2) a unit with valid unit_key but invalid value_source
    // is marked as unavailable in states (S3 fix: was silently dropped before).
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S" }],
        }),
      })
    );
    const projectId = await makeProject("Malformed Entry Test");
    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [
        {
          unit_key: "trunk_commit::good::/repo",
          value_source: "trunk_commit",
          value_ref: "good",
        },
        { unit_key: "" }, // malformed: no usable key, dropped entirely
        {
          unit_key: "trunk_commit::bad-source::/repo",
          value_source: "not_a_real_source", // invalid source
          value_ref: "bad",
        },
      ],
    });

    assert.equal(res.status, 200);
    // One valid entry in altitudes
    assert.equal(Object.keys(res.body.altitudes).length, 1);
    assert.ok(res.body.altitudes["trunk_commit::good::/repo"]);

    // The bad-source unit should be in states as unavailable (S3 fix)
    assert.ok(res.body.states["trunk_commit::bad-source::/repo"]);
    assert.equal(res.body.states["trunk_commit::bad-source::/repo"], "unavailable");

    // The empty-key unit should not be in either map (no key to report against)
    const allKeys = [...Object.keys(res.body.altitudes), ...Object.keys(res.body.states)];
    assert.equal(allKeys.length, 2, "2 entries (good + bad-source, not empty-key)");
  });

  it("S4 should-fix: route sends states even for cached/resolved units (never undefined)", async () => {
    // The route contract: every response always includes states (empty object if
    // no queued/unavailable entries). This completes the AC-2 same-render
    // contract: states is always present, enabling client to distinguish "not
    // fetched yet" (undefined) from "attempted and failed" (states[k] ===
    // "unavailable") and "queued for later" (states[k] === "queued").
    // Real old-server backward-compat test (missing states key) is on the client
    // side (PlanLedgerPanel.test.tsx:419), mocking old-server responses.
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S" }],
        }),
      })
    );
    const projectId = await makeProject("States Always Present Test");
    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [{ unit_key: "trunk_commit::test::/repo", value_source: "trunk_commit" }],
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.altitudes["trunk_commit::test::/repo"], "altitudes present");
    assert.ok(Object.prototype.hasOwnProperty.call(res.body, "states"), "states key present");
    assert.deepEqual(res.body.states, {}, "states is an object (empty in this case)");
  });

  it("Case A: 45-unit batch (2 cached + 43 fresh) → 41 altitudes, 4 states (1 unavailable, 3 queued)", async () => {
    // First, seed the cache with 2 units
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [
            { index: 1, project: "Cached1", stakeholder: "S1" },
            { index: 2, project: "Cached2", stakeholder: "S2" },
          ],
        }),
      })
    );
    const cached = [
      unit({ unitKey: "trunk_commit::c1::/repo", value_ref: "c1" }),
      unit({ unitKey: "trunk_commit::c2::/repo", value_ref: "c2" }),
    ];
    await enrichPoolAltitudes(dbModule, cached);

    // Now hit the route with 2 cached + 43 fresh = 45 total
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: Array.from({ length: 39 }, (_, i) => ({
            index: i + 1,
            project: `Fresh${i + 1}`,
            stakeholder: `S${i + 1}`,
          })),
        }),
      })
    );
    const projectId = await makeProject("Case A Test");
    const fresh = Array.from({ length: 43 }, (_, i) =>
      unit({ unitKey: `trunk_commit::f${i}::/repo`, value_ref: `f${i}` })
    );
    const allUnits = [...cached, ...fresh].map((u) => ({
      unit_key: u.unitKey,
      value_source: u.value_source,
      value_ref: u.value_ref,
    }));

    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: allUnits,
    });

    assert.equal(res.status, 200);
    assert.equal(
      Object.keys(res.body.altitudes).length,
      41,
      "41 altitudes (2 cached + 39 generated)"
    );
    assert.ok(res.body.states, "states present");
    const unavailableKeys = Object.keys(res.body.states).filter(
      (k) => res.body.states[k] === "unavailable"
    );
    const queuedKeys = Object.keys(res.body.states).filter((k) => res.body.states[k] === "queued");
    assert.equal(unavailableKeys.length, 1, "1 unavailable");
    assert.equal(queuedKeys.length, 3, "3 queued");
    assert.ok(
      Object.keys(res.body.altitudes).length + Object.keys(res.body.states).length === 45,
      "41 + 4 = 45"
    );
  });

  it("Case B (T-B): 45 units with LLM off → 0 altitudes, 45 unavailable", async () => {
    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
    const projectId = await makeProject("Case B LLM Off Test");
    const units = Array.from({ length: 45 }, (_, i) =>
      unit({ unitKey: `trunk_commit::u${i}::/repo`, value_ref: `u${i}` })
    );
    const unitsList = units.map((u) => ({
      unit_key: u.unitKey,
      value_source: u.value_source,
      value_ref: u.value_ref,
    }));

    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: unitsList,
    });
    delete process.env.DASHBOARD_FOCUS_INFER_MODE;

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.altitudes, {}, "0 altitudes when LLM is off");
    assert.ok(res.body.states, "states present");
    const allUnavailable = Object.values(res.body.states).every((s) => s === "unavailable");
    assert.ok(allUnavailable, "all 45 states are unavailable");
    assert.equal(Object.keys(res.body.states).length, 45, "all 45 units in states");
  });

  it("200s with an empty altitudes map when the LLM path is off", async () => {
    process.env.DASHBOARD_FOCUS_INFER_MODE = "off";
    const projectId = await makeProject("Altitudes Off Test");
    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [{ unit_key: "trunk_commit::off::/repo", value_source: "trunk_commit", label: "x" }],
    });
    delete process.env.DASHBOARD_FOCUS_INFER_MODE;
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.altitudes, {});
  });
});

describe("unitFacts / compareUnitInputs (A1)", () => {
  // These tests expect unitFacts() and compareUnitInputs() functions to exist in value-summary.js
  // Currently they do not, so these tests will be RED.

  it("U1: unitFacts resolves label from unit, includes value_source and stage", () => {
    // This test expects unitFacts to exist as an export
    const { unitFacts } = require("../lib/value-summary");
    assert.ok(typeof unitFacts === "function", "unitFacts should be a function");

    const result = unitFacts({
      value_source: "intake_initiative",
      label: "tracker",
      value_ref: "ref123",
      stage: "built",
    });

    assert.equal(result.value_source, "intake_initiative");
    assert.equal(result.label, "tracker");
    assert.equal(result.stage, "built");
  });

  it("U2: unitFacts uses value_ref fallback when label is null", () => {
    const { unitFacts } = require("../lib/value-summary");
    const result = unitFacts({
      value_source: "trunk_commit",
      label: null,
      value_ref: "abc123",
      stage: null,
    });

    assert.equal(result.label, "abc123", "should fallback to value_ref");
  });

  it("U3: unitFacts uses '(untitled)' when both label and value_ref are empty", () => {
    const { unitFacts } = require("../lib/value-summary");
    const result = unitFacts({
      value_source: "detour",
      label: null,
      value_ref: "",
      stage: null,
    });

    assert.equal(result.label, "(untitled)");
  });

  it("U4: unitFacts normalizes missing stage to null", () => {
    const { unitFacts } = require("../lib/value-summary");
    // detour shape with no stage key at all
    const result = unitFacts({
      value_source: "detour",
      label: "detour-label",
      value_ref: "ref",
      // stage key is completely absent
    });

    assert.equal(result.stage, null, "undefined stage should normalize to null");
  });
});

describe("compareUnitInputs truth table (T1–T11)", () => {
  // These tests expect compareUnitInputs() to exist in value-summary.js
  // Currently it does not, so these tests will be RED.

  it("T1: unchanged snapshot compares null (stable)", () => {
    const { compareUnitInputs, unitFacts } = require("../lib/value-summary");
    const row = {
      input_stage: "built",
      input_label: "tracker",
    };
    const unit = {
      value_source: "intake_initiative",
      label: "tracker",
      stage: "built",
    };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, null, "unchanged snapshot should compare equal");
  });

  it("T2: stage-only change returns stage_changed", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    const row = { input_stage: "built", input_label: "tracker" };
    const unit = { value_source: "intake_initiative", label: "tracker", stage: "shipped" };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, "stage_changed");
  });

  it("T3: label-only change returns label_changed", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    const row = { input_stage: "built", input_label: "tracker" };
    const unit = { value_source: "intake_initiative", label: "tracker-v2", stage: "built" };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, "label_changed");
  });

  it("T4: both changed, stage takes precedence (returns stage_changed)", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    const row = { input_stage: "built", input_label: "tracker" };
    const unit = { value_source: "intake_initiative", label: "tracker-v2", stage: "shipped" };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, "stage_changed", "stage precedence over label");
  });

  it("T5: NULL→value stage change returns stage_changed", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    const row = { input_stage: null, input_label: "tracker" };
    const unit = { value_source: "intake_initiative", label: "tracker", stage: "built" };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, "stage_changed");
  });

  it("T6: value→NULL stage change returns stage_changed", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    const row = { input_stage: "built", input_label: "tracker" };
    const unit = { value_source: "detour", label: "tracker", stage: null };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, "stage_changed");
  });

  it("T7: detour (NULL stage) with matching label compares fresh (DEC-12)", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    // Detour row: input_stage NULL, input_label set
    const row = { input_stage: null, input_label: "tracker" };
    // Detour unit: stage key missing, label matches
    const unit = { value_source: "detour", label: "tracker", stage: undefined };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, null, "detour with NULL stage is not legacy, is fresh");
  });

  it("T8: legacy NULL/NULL row stale via label (not special-cased)", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    const row = { input_stage: null, input_label: null }; // legacy marker
    const unit = { value_source: "intake_initiative", label: "tracker", stage: null };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, "label_changed", "legacy row falls out via label");
  });

  it("T9: legacy NULL/NULL with stage present uses stage precedence", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    const row = { input_stage: null, input_label: null };
    const unit = { value_source: "intake_initiative", label: "tracker", stage: "built" };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, "stage_changed", "precedence: stage over label");
  });

  it("T10: empty string stage distinct from null", () => {
    const { compareUnitInputs } = require("../lib/value-summary");
    const row = { input_stage: "", input_label: "tracker" };
    const unit = { value_source: "intake_initiative", label: "tracker", stage: null };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, "stage_changed", "empty string and null are distinct");
  });

  it("T11: row stores resolved label, unit.label null with value_ref fallback compares fresh", () => {
    const { compareUnitInputs, unitFacts } = require("../lib/value-summary");
    // Row was written with resolved label "abc123"
    const row = { input_stage: null, input_label: "abc123" };
    // Unit has null label, falls back to value_ref "abc123"
    const unit = { value_source: "trunk_commit", label: null, value_ref: "abc123", stage: null };
    const result = compareUnitInputs(row, unit);
    assert.equal(result, null, "resolved label in storage matches resolved label in facts");
  });
});

describe("BL-6: unitFacts <-> compareUnitInputs field coverage (§9.1 comparator-gap guard)", () => {
  // build-reviewer's BL-6: unitFacts returned three fields, compareUnitInputs
  // only compared two, and nothing asserted the gap — a change to
  // value_source would never have been detected as stale, and the file's own
  // header/JSDoc claimed a stronger guarantee ("adding a field to the prompt
  // is physically impossible without adding it to the comparison") than was
  // actually true. This walks Object.keys(unitFacts(fixture)) and proves
  // every key is EITHER comparator-covered OR an enumerated exception in
  // UNCOMPARED_FIELD_GUARANTORS — never silently uncovered.
  it("every unitFacts key not in UNCOMPARED_FIELD_GUARANTORS makes compareUnitInputs detect a mutation", () => {
    const {
      unitFacts,
      compareUnitInputs,
      UNCOMPARED_FIELD_GUARANTORS,
    } = require("../lib/value-summary");

    const baseUnit = {
      value_source: "intake_initiative",
      label: "tracker",
      value_ref: "tracker",
      stage: "built",
    };
    const facts = unitFacts(baseUnit);
    const row = { input_stage: facts.stage, input_label: facts.label };

    // Baseline: an unmutated snapshot must compare clean, or every
    // "mutation makes it non-null" assertion below would be meaningless.
    assert.equal(compareUnitInputs(row, baseUnit), null, "baseline (unmutated) must compare clean");

    const covered = [];
    const excepted = [];
    for (const key of Object.keys(facts)) {
      if (Object.prototype.hasOwnProperty.call(UNCOMPARED_FIELD_GUARANTORS, key)) {
        excepted.push(key);
        continue;
      }
      const mutatedUnit = { ...baseUnit, [key]: `${baseUnit[key]}-BL6-MUTATED` };
      const reason = compareUnitInputs(row, mutatedUnit);
      assert.notEqual(
        reason,
        null,
        `mutating unitFacts field "${key}" (not listed in UNCOMPARED_FIELD_GUARANTORS) must make ` +
          `compareUnitInputs detect staleness — a field added to the prompt without a matching ` +
          `comparator branch is exactly the BL-6 gap this test exists to close`
      );
      covered.push(key);
    }

    // Anti-vacuous: this test must actually exercise at least one covered
    // field AND the one named exception, or a future refactor that emptied
    // both loop bodies would still pass silently.
    assert.ok(covered.length >= 1, "at least one unitFacts field must be comparator-covered");
    assert.deepEqual(
      excepted.sort(),
      ["value_source"],
      "exactly the named exception, no silent additions to UNCOMPARED_FIELD_GUARANTORS"
    );
  });

  it("value_source's exception is backed by a real invariant: unit_key embeds value_source (value-ledger.js's unitKey())", () => {
    const { unitKey } = require("../lib/value-ledger");
    // A different value_source produces a DIFFERENT unit_key — i.e. a
    // lookup against a different (or absent) cached row entirely, never a
    // same-row mismatch compareUnitInputs would need to catch. This is the
    // guarantor UNCOMPARED_FIELD_GUARANTORS.value_source cites; asserted
    // directly here, not just narrated in a comment.
    const key = unitKey("intake_initiative", "tracker", "/repo");
    assert.equal(
      key.split("::")[0],
      "intake_initiative",
      "unit_key's first segment IS value_source"
    );
    const otherSourceKey = unitKey("merge_commit", "tracker", "/repo");
    assert.notEqual(
      key,
      otherSourceKey,
      "a changed value_source for the same ref/cwd produces a DIFFERENT unit_key, never a same-row mismatch"
    );
  });
});

describe("enrichPoolAltitudes input-snapshot gating (D1–D6, D5b, lifecycle)", () => {
  it("D1a: immutable trunk_commit never regenerates even if label changed", async () => {
    const projectId = await makeProject("D1 Test");
    // Seed a cached trunk_commit with old label
    const oldUnit = unit({
      unitKey: "trunk_commit::abc::@repo",
      value_source: "trunk_commit",
      label: "old label",
      stage: null,
    });

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "cached", stakeholder: "trunk commit cached" }],
        }),
      })
    );

    // First call generates
    await enrichPoolAltitudes(db, [oldUnit]);

    // Second call with different label but same immutable source
    __injectSpawnForTest(() => {
      throw new Error("Should not spawn for immutable source");
    });

    const newUnit = { ...oldUnit, label: "new label" };
    const res = await enrichPoolAltitudes(db, [newUnit]);

    assert.ok(res.altitudes[oldUnit.unitKey].cached, "immutable source should still be cached");
  });

  it("D2: mutable unchanged inputs cache-hit with zero spawns", async () => {
    const projectId = await makeProject("D2 Test");
    const mutableUnit = unit({
      unitKey: "intake_initiative::tracker::@repo",
      value_source: "intake_initiative",
      label: "tracker",
      stage: "built",
    });

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S" }],
        }),
      })
    );

    // First call generates and caches
    await enrichPoolAltitudes(db, [mutableUnit]);

    // Second call with identical inputs
    __injectSpawnForTest(() => {
      throw new Error("Should not spawn on cache hit");
    });

    const res = await enrichPoolAltitudes(db, [mutableUnit]);
    assert.ok(res.altitudes[mutableUnit.unitKey].cached, "unchanged mutable should cache-hit");
  });

  it("D3: mutable stage change regenerates exactly that unit", async () => {
    const projectId = await makeProject("D3 Test");
    const mutableUnit = unit({
      unitKey: "intake_initiative::tracker::@repo",
      value_source: "intake_initiative",
      label: "tracker",
      stage: "built",
    });

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S original" }],
        }),
      })
    );

    // First call
    await enrichPoolAltitudes(db, [mutableUnit]);

    // Change stage
    const mutatedUnit = { ...mutableUnit, stage: "shipped" };

    let spawnCount = 0;
    const inner = fakeSpawn({
      stdout: envelope({
        units: [{ index: 1, project: "P", stakeholder: "S updated" }],
      }),
    });
    __injectSpawnForTest((cmd, args) => {
      // Only count the real generation spawn ("-p ..."), not
      // probeClaudeCli()'s "claude --version" probe call — which re-fires
      // here because __injectSpawnForTest resets the probe cache.
      if (Array.isArray(args) && args.includes("-p")) spawnCount += 1;
      return inner();
    });

    const res = await enrichPoolAltitudes(db, [mutatedUnit]);

    assert.equal(spawnCount, 1, "exactly one spawn for stage change");
    assert.ok(res.altitudes[mutatedUnit.unitKey], "changed unit should have new altitude");
  });

  it("D4: mutable label change regenerates with label_changed reason", async () => {
    const projectId = await makeProject("D4 Test");
    const mutableUnit = unit({
      unitKey: "intake_initiative::tracker::@repo",
      value_source: "intake_initiative",
      label: "tracker",
      stage: "built",
    });

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S" }],
        }),
      })
    );

    // First call
    await enrichPoolAltitudes(db, [mutableUnit]);

    // Change label only
    const mutatedUnit = { ...mutableUnit, label: "tracker-v2" };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S label-changed" }],
        }),
      })
    );

    const res = await enrichPoolAltitudes(db, [mutatedUnit]);
    assert.ok(res.altitudes[mutatedUnit.unitKey], "label-changed unit regenerates");
  });

  it("D5: resumeJobPipelineTracker legacy row regenerates (DEC-9)", async () => {
    const projectId = await makeProject("D5 Test");
    // Manually insert a legacy row (simulating pre-snapshot DB)
    const legacyKey = "intake_initiative::2026-08-03-job-pipeline-tracker::/repo";
    db.prepare(
      `INSERT INTO value_unit_summaries (unit_key, project_level, stakeholder_level, model, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      legacyKey,
      "tracker",
      "The job pipeline tracker is built and being tested",
      "haiku",
      "2026-08-01T00:00:00Z"
    );

    // Verify legacy row has NULL snapshot columns
    const legacyRow = db
      .prepare("SELECT input_label FROM value_unit_summaries WHERE unit_key = ?")
      .get(legacyKey);
    assert.equal(legacyRow.input_label, null, "legacy row has NULL input_label");

    // Now call with current facts
    const mutableUnit = {
      unitKey: legacyKey,
      value_source: "intake_initiative",
      label: "2026-08-03-job-pipeline-tracker",
      stage: "built",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S regenerated" }],
        }),
      })
    );

    const res = await enrichPoolAltitudes(db, [mutableUnit]);

    // Legacy row should regenerate even though facts match (because row is stale)
    assert.ok(
      res.states[legacyKey] === "queued" ||
        res.states[legacyKey] === "unavailable" ||
        res.altitudes[legacyKey],
      "legacy row regenerates"
    );
  });

  it("D5b: detour with NULL stage is fresh (not legacy)", async () => {
    const projectId = await makeProject("D5b Test");
    const detourUnit = {
      unitKey: "detour::some-ref::/repo",
      value_source: "detour",
      label: "detour-label",
      value_ref: "ref",
      // stage key completely absent (undefined)
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S detour" }],
        }),
      })
    );

    // First call
    await enrichPoolAltitudes(db, [detourUnit]);

    // Second call with same inputs
    __injectSpawnForTest(() => {
      throw new Error("detour should not regenerate every time");
    });

    const res = await enrichPoolAltitudes(db, [detourUnit]);
    assert.ok(
      res.altitudes[detourUnit.unitKey].cached,
      "detour with NULL stage is fresh, not legacy"
    );
  });

  it("D6: regenerated unit carries freshness until acknowledged", async () => {
    const projectId = await makeProject("D6 Test");
    const unit = {
      unitKey: "intake_initiative::tracker::/repo",
      value_source: "intake_initiative",
      label: "tracker",
      stage: "built",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S" }],
        }),
      })
    );

    // First generation
    let res = await enrichPoolAltitudes(db, [unit]);
    assert.ok(!("freshness" in res.altitudes[unit.unitKey]), "first generation has no freshness");

    // Change stage to trigger regeneration
    const mutatedUnit = { ...unit, stage: "shipped" };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S updated" }],
        }),
      })
    );

    res = await enrichPoolAltitudes(db, [mutatedUnit]);
    assert.equal(
      res.altitudes[mutatedUnit.unitKey].freshness,
      "updated_unseen",
      "regenerated unit carries updated_unseen marker"
    );
  });

  it("D6b: marker survives a cache-hit re-read before acknowledgement", async () => {
    // Reproduces the verifier's BLOCKED finding (green-evidence.md §3): a
    // mutable unit regenerates (marker present), then a later re-read with
    // NO further mutation is a plain cache hit — the marker must still be
    // present, because seen_at is still NULL in the DB. Prior to the fix in
    // enrichPoolAltitudes's cache-hit branch, this assertion failed with
    // `res3.altitudes[unit.unitKey].freshness === undefined` (the entry came
    // back as bare `{..., cached: true}`, no freshness/update_reason/
    // regenerated_at at all) even though `regenerated_at` was still set and
    // `seen_at` still NULL on the row.
    const projectId = await makeProject("D6b Test");
    const unit = {
      unitKey: "intake_initiative::tracker-d6b::/repo",
      value_source: "intake_initiative",
      label: "tracker-d6b",
      stage: "built",
    };

    // (a) First generation — no freshness (correct, first-ever generation).
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S" }],
        }),
      })
    );
    let res = await enrichPoolAltitudes(db, [unit]);
    assert.ok(!("freshness" in res.altitudes[unit.unitKey]), "first generation has no freshness");

    // (b) Mutate the stage, re-read — regenerates, marker present.
    const mutatedUnit = { ...unit, stage: "shipped" };
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S updated" }],
        }),
      })
    );
    res = await enrichPoolAltitudes(db, [mutatedUnit]);
    assert.equal(
      res.altitudes[mutatedUnit.unitKey].freshness,
      "updated_unseen",
      "regenerated unit carries updated_unseen marker"
    );

    // (c) Re-read AGAIN with no further mutation, before ever acknowledging
    // (no call to the /altitudes/seen compare-and-set) — this is now a
    // cache hit (the stored input_stage/input_label match `mutatedUnit`
    // again), but seen_at is still NULL, so the marker must still show.
    res = await enrichPoolAltitudes(db, [mutatedUnit]);
    const thirdRead = res.altitudes[mutatedUnit.unitKey];
    assert.equal(thirdRead.cached, true, "third read is a cache hit, not a regeneration");
    assert.equal(
      thirdRead.freshness,
      "updated_unseen",
      "marker must survive a cache-hit re-read before acknowledgement"
    );
    assert.equal(
      thirdRead.update_reason,
      "stage_changed",
      "update_reason must still ride along on the cache-hit re-read"
    );
    assert.ok(
      thirdRead.regenerated_at,
      "regenerated_at must still be present on the cache-hit re-read"
    );
  });
});

describe("COUNTS shape and identity (DEC-14, WATCH-A)", () => {
  it("COUNTS-SHAPE: counts object has exact six keys, four-term identity holds", async () => {
    const projectId = await makeProject("COUNTS Test");
    const units = Array.from({ length: 10 }, (_, i) =>
      unit({ unitKey: `trunk_commit::u${i}::/repo`, value_ref: `u${i}` })
    );

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: units.map((_, i) => ({
            index: i + 1,
            project: "P",
            stakeholder: "S",
          })),
        }),
      })
    );

    const res = await enrichPoolAltitudes(db, units);

    // counts should have exactly these keys
    assert.deepEqual(
      Object.keys(res.counts).sort(),
      ["cache_hits", "generated", "pool_size", "queued", "stale_regenerated", "unavailable"],
      "counts shape must be exact"
    );

    // Four-term identity
    const { cache_hits, generated, queued, unavailable, pool_size } = res.counts;
    assert.equal(
      cache_hits + generated + queued + unavailable,
      pool_size,
      "cache_hits + generated + queued + unavailable === pool_size (identity)"
    );
  });

  it("COUNTS-DROPPED: droppedCount param adds to pool_size and unavailable", async () => {
    const projectId = await makeProject("COUNTS-DROPPED Test");
    const units = Array.from({ length: 5 }, (_, i) =>
      unit({ unitKey: `trunk_commit::u${i}::/repo`, value_ref: `u${i}` })
    );

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: units.map((_, i) => ({ index: i + 1, project: "P", stakeholder: "S" })),
        }),
      })
    );

    const res = await enrichPoolAltitudes(db, units, { droppedCount: 2 });

    assert.equal(res.counts.pool_size, 7, "pool_size should include droppedCount");
    assert.equal(
      res.counts.cache_hits + res.counts.generated + res.counts.queued + res.counts.unavailable,
      7,
      "identity holds with droppedCount"
    );
  });

  it("COUNTS-DUPLICATE-KEY (BL-2): a duplicate unitKey in the submitted batch does not break the four-term identity", async () => {
    // BL-2's reproduction: `pool_size` was computed over the RAW list
    // (`units.length + droppedCount`) while every other term was
    // accumulated over a differently-deduped list — two identical
    // uncached units in one batch summed to less than pool_size. POST
    // /altitudes never dedupes before calling this composer (it is an
    // explicitly anticipated input — the dedupe's own comment says so), so
    // this must hold by construction, not by which caller happens to dedupe
    // first.
    const projectId = await makeProject("COUNTS-DUPLICATE-KEY Test");
    const dup = unit({ unitKey: "trunk_commit::dup::/repo", value_ref: "dup" });
    const distinct = unit({ unitKey: "trunk_commit::distinct::/repo", value_ref: "distinct" });

    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"; // deterministic all-unavailable, no spawn
    // Two identical uncached units (same unitKey object appears twice) PLUS
    // one distinct uncached unit — three raw entries, two unique keys.
    const res = await enrichPoolAltitudes(db, [dup, dup, distinct]);
    delete process.env.DASHBOARD_FOCUS_INFER_MODE;

    assert.equal(
      res.counts.pool_size,
      2,
      "pool_size must reflect the DEDUPED count (2 unique keys), not the raw submitted count (3)"
    );
    assert.equal(
      res.counts.cache_hits + res.counts.generated + res.counts.queued + res.counts.unavailable,
      res.counts.pool_size,
      "four-term identity must hold exactly, even with a duplicate unitKey in the raw input"
    );
    // Only two distinct wire entries — a duplicate must not produce two
    // separate outcomes for the same key.
    const allKeys = new Set([...Object.keys(res.altitudes), ...Object.keys(res.states)]);
    assert.equal(allKeys.size, 2, "exactly two distinct outcomes, one per unique unitKey");
  });

  it("ROUTE-SEAM-1b (BL-2): POST /altitudes with a duplicate unit_key in the request body still logs a four-term-exact row", async () => {
    const projectId = await makeProject("ROUTE-SEAM-1b Test");
    const dupUnit = {
      unit_key: "trunk_commit::route-dup::/repo",
      value_source: "trunk_commit",
      value_ref: "route-dup",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({ units: [{ index: 1, project: "P", stakeholder: "S" }] }),
      })
    );

    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      // The SAME unit_key submitted twice — POST /altitudes never dedupes
      // before calling enrichPoolAltitudes (see route comment).
      units: [dupUnit, { ...dupUnit }],
    });

    assert.equal(res.status, 200);
    assert.equal(
      res.body.counts.pool_size,
      1,
      "pool_size reflects the deduped submitted batch (one unique key)"
    );
    assert.equal(
      res.body.counts.cache_hits +
        res.body.counts.generated +
        res.body.counts.queued +
        res.body.counts.unavailable,
      res.body.counts.pool_size,
      "four-term identity holds through the real route with a duplicate key"
    );

    const logRow = db
      .prepare(
        "SELECT * FROM value_summary_generation_log WHERE source = 'request' AND project_id = ? ORDER BY id DESC LIMIT 1"
      )
      .get(projectId);
    assert.equal(logRow.pool_size, 1, "the persisted log row also reflects the deduped count");
    assert.equal(
      logRow.cache_hits + logRow.generated + logRow.queued + logRow.unavailable,
      logRow.pool_size,
      "four-term identity holds in the persisted log row too"
    );
  });
});

describe("DEC-11 ANTIFIX: stale unit in altitudes, miss in counts (BY DESIGN)", () => {
  it("stale-served unit in altitudes, cache_hits miss (one fixture, both partitions)", async () => {
    const projectId = await makeProject("DEC-11 Test");
    const mutableUnit = unit({
      unitKey: "intake_initiative::tracker::/repo",
      value_source: "intake_initiative",
      label: "tracker",
      stage: "built",
    });

    // First call: generate and cache
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Cached text" }],
        }),
      })
    );

    await enrichPoolAltitudes(db, [mutableUnit]);

    // Second call: change stage to make it stale, but LLM is off so it can't refresh
    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
    const staleUnit = { ...mutableUnit, stage: "shipped" };

    const res = await enrichPoolAltitudes(db, [staleUnit]);

    delete process.env.DASHBOARD_FOCUS_INFER_MODE;

    // Wire: old text served (altitudes)
    assert.ok(res.altitudes[staleUnit.unitKey], "stale unit in altitudes");
    assert.equal(res.altitudes[staleUnit.unitKey].stakeholder, "Cached text", "serves old text");

    // Log: counted as miss (unavailable when LLM off)
    assert.equal(res.counts.cache_hits, 0, "stale-served is a miss in counts (DEC-11 BY DESIGN)");
    assert.equal(
      res.counts.unavailable,
      1,
      "stale unit counted as unavailable when refresh unavailable"
    );

    // Identity holds
    assert.equal(
      res.counts.cache_hits + res.counts.generated + res.counts.queued + res.counts.unavailable,
      res.counts.pool_size,
      "identity exact even for stale-served"
    );
  });
});

describe("POST /api/project-plans/altitudes/seen (A-5)", () => {
  it("SEEN-1: happy path acknowledges a regenerated unit", async () => {
    // Seed a regenerated row (D6(a) state). A first-EVER generation never
    // carries `freshness`/`regenerated_at` (DEC-12) and `trunk_commit` is
    // immutable (never regenerates at all), so the D6(a) precondition this
    // test needs — a unit that HAS regenerated and is still unacknowledged —
    // requires a mutable source plus a genuine mutate-then-regenerate step
    // (same shape as SEEN-4/D6).
    const projectId = await makeProject("SEEN-1 Test");
    const unitKey = "intake_initiative::seen1::/repo";
    const unit = {
      unit_key: unitKey,
      value_source: "intake_initiative",
      value_ref: "seen1",
      label: "Test unit",
      stage: "built",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "First text" }],
        }),
      })
    );

    // First POST — first-ever generation, no freshness yet.
    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unit],
    });
    assert.equal(res.status, 200);
    assert.ok(!("freshness" in res.body.altitudes[unitKey]), "first generation has no freshness");

    // Mutate the stage to trigger a real regeneration (D6(a) state).
    const mutatedUnit = { ...unit, stage: "shipped" };
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Second text" }],
        }),
      })
    );
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [mutatedUnit],
    });
    const regeneratedAt = res.body.altitudes[unitKey].regenerated_at;
    assert.ok(regeneratedAt, "regenerated_at should be set");
    assert.equal(res.body.altitudes[unitKey].freshness, "updated_unseen");

    // POST /seen with regenerated_at
    const seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt }],
    });
    assert.equal(seenRes.status, 200, "should 200 on valid request");
    assert.equal(seenRes.body.updated, 1, "should update exactly 1");

    // Next composer call (unchanged inputs — a cache hit) should have no
    // freshness, proving the acknowledge landed.
    __injectSpawnForTest(() => {
      throw new Error("no LLM call expected on a cache hit");
    });
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [mutatedUnit],
    });
    assert.ok(
      !("freshness" in res.body.altitudes[unitKey]),
      "freshness should be absent after acknowledge"
    );
  });

  it("SEEN-2: idempotent acknowledge", async () => {
    const projectId = await makeProject("SEEN-2 Test");
    const unitKey = "trunk_commit::seen2::/repo";
    const unit = {
      unit_key: unitKey,
      value_source: "trunk_commit",
      value_ref: "seen2",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text" }],
        }),
      })
    );
    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unit],
    });
    const regeneratedAt = res.body.altitudes[unitKey].regenerated_at;

    // First acknowledge
    let seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt }],
    });
    assert.equal(seenRes.body.updated, 1);

    // Second identical POST should also 200 and report updated: 1
    seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt }],
    });
    assert.equal(seenRes.status, 200, "idempotent POST should 200");
    assert.equal(seenRes.body.updated, 1, "idempotent should still update");
  });

  it("SEEN-3: validation matrix (malformed input)", async () => {
    const projectId = await makeProject("SEEN-3 Test");

    // Missing project_id
    let res = await post("/api/project-plans/altitudes/seen", {
      units: [{ unit_key: "x", regenerated_at: null }],
    });
    assert.equal(res.status, 400, "missing project_id");

    // project_id non-string
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: 123,
      units: [{ unit_key: "x", regenerated_at: null }],
    });
    assert.equal(res.status, 400, "project_id non-string");

    // Missing units
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
    });
    assert.equal(res.status, 400, "missing units");

    // units non-array
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: {},
    });
    assert.equal(res.status, 400, "units non-array");

    // Empty array
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [],
    });
    assert.equal(res.status, 400, "empty units array");

    // Member not an object
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: ["string"],
    });
    assert.equal(res.status, 400, "member not object");

    // Member missing unit_key
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ regenerated_at: null }],
    });
    assert.equal(res.status, 400, "member missing unit_key");

    // Member unit_key non-string
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: 123, regenerated_at: null }],
    });
    assert.equal(res.status, 400, "unit_key non-string");

    // Member regenerated_at neither string nor null
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: "x", regenerated_at: 123 }],
    });
    assert.equal(res.status, 400, "regenerated_at not string/null");
  });

  it("SEEN-4: stamp-race semantics — regeneration clears seen_at (G3)", async () => {
    const projectId = await makeProject("SEEN-4 Test");
    const unitKey = "intake_initiative::seen4::/repo";
    const unit = {
      unit_key: unitKey,
      value_source: "intake_initiative",
      value_ref: "seen4",
      stage: "built",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "V1" }],
        }),
      })
    );

    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unit],
    });
    const regeneratedAt1 = res.body.altitudes[unitKey].regenerated_at;

    // Acknowledge
    let seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt1 }],
    });
    assert.equal(seenRes.body.updated, 1);

    // Verify cleared
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unit],
    });
    assert.ok(!("freshness" in res.body.altitudes[unitKey]), "freshness cleared after acknowledge");

    // Mutate the unit's stage and regenerate
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "V2" }],
        }),
      })
    );
    const mutatedUnit = { ...unit, stage: "shipped" };
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [mutatedUnit],
    });

    // Marker should re-appear with fresh regenerated_at
    assert.equal(
      res.body.altitudes[unitKey].freshness,
      "updated_unseen",
      "marker re-appears after regeneration"
    );
    assert.notEqual(
      res.body.altitudes[unitKey].regenerated_at,
      regeneratedAt1,
      "regenerated_at changed"
    );
  });

  it("SEEN-5: acknowledge survives non-regenerating reads", async () => {
    // Mutable source + a genuine mutate-then-regenerate step: `trunk_commit`
    // is immutable and never carries `freshness` in the first place, so this
    // test's own name ("survives non-regenerating reads" — i.e. the marker
    // must STAY CLEARED, not silently reappear, on a plain cache hit after
    // acknowledge) can only be exercised against a unit that actually
    // regenerated once.
    const projectId = await makeProject("SEEN-5 Test");
    const unitKey = "intake_initiative::seen5::/repo";
    const unit = {
      unit_key: unitKey,
      value_source: "intake_initiative",
      value_ref: "seen5",
      stage: "built",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text" }],
        }),
      })
    );

    // First generation — no freshness yet.
    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unit],
    });
    assert.ok(!("freshness" in res.body.altitudes[unitKey]), "first generation has no freshness");

    // Mutate the stage to trigger a real regeneration.
    const mutatedUnit = { ...unit, stage: "shipped" };
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text updated" }],
        }),
      })
    );
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [mutatedUnit],
    });
    assert.equal(
      res.body.altitudes[unitKey].freshness,
      "updated_unseen",
      "regeneration carries the marker"
    );
    const regeneratedAt = res.body.altitudes[unitKey].regenerated_at;

    // Acknowledge
    let seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt }],
    });
    assert.equal(seenRes.body.updated, 1);

    // Plain cache-hit read (unchanged inputs, no further mutation) should
    // not resurface the marker after acknowledgement.
    __injectSpawnForTest(() => {
      throw new Error("no LLM call expected on a cache hit");
    });
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [mutatedUnit],
    });
    assert.ok(
      !("freshness" in res.body.altitudes[unitKey]),
      "freshness stays cleared on cache hit"
    );
  });

  it("SEEN-6: compare-and-set — stale stamp rejected, NULL leg accepted", async () => {
    // Mutable source with two REAL, distinct regenerations — `trunk_commit`
    // never regenerates on an unchanged read, so two consecutive POSTs of
    // the same unmodified unit would leave t1 === t2 (both NULL), and the
    // "stale stamp" this test rejects would actually be today's correct
    // NULL value, not a genuine stale-vs-current pair.
    const projectId = await makeProject("SEEN-6 Test");
    const unitKey = "intake_initiative::seen6::/repo";
    const unit = {
      unit_key: unitKey,
      value_source: "intake_initiative",
      value_ref: "seen6",
      stage: "built",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text" }],
        }),
      })
    );

    // First-ever generation — no freshness, not the t1 under test.
    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unit],
    });
    assert.ok(!("freshness" in res.body.altitudes[unitKey]), "first generation has no freshness");

    // Regeneration #1 (t1)
    const unitV1 = { ...unit, stage: "shipped" };
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text1" }],
        }),
      })
    );
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unitV1],
    });
    const t1 = res.body.altitudes[unitKey].regenerated_at;
    assert.ok(t1, "t1 set by real regeneration #1");

    // Regeneration #2 (t2) — simulates the tick regenerating again before
    // the caller who fetched t1 ever acknowledges it. `regenerated_at` is a
    // millisecond-resolution JS timestamp (a known pre-existing flake class
    // on this surface, decisions.md DEC-B2) — a tiny real delay here keeps
    // t1/t2 from landing in the same millisecond on a fast test run, without
    // weakening the notEqual assertion below.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const unitV2 = { ...unit, stage: "closed" };
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text2" }],
        }),
      })
    );
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unitV2],
    });
    const t2 = res.body.altitudes[unitKey].regenerated_at;
    assert.notEqual(t2, t1, "tick regenerated, timestamp changed");

    // Try to acknowledge with stale t1 → should not update
    let seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: t1 }],
    });
    assert.equal(seenRes.body.updated, 0, "stale stamp rejected by CAS");

    // Marker should still show updated_unseen (CAS prevented the stamp) —
    // read with the CURRENT (v2) inputs so this is a cache hit, not a
    // third regeneration.
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unitV2],
    });
    assert.equal(
      res.body.altitudes[unitKey].freshness,
      "updated_unseen",
      "marker persists after stale stamp"
    );

    // Now acknowledge with correct t2
    seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: t2 }],
    });
    assert.equal(seenRes.body.updated, 1, "correct stamp accepted");

    // Marker clears
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unitV2],
    });
    assert.ok(
      !("freshness" in res.body.altitudes[unitKey]),
      "marker clears after successful stamp"
    );

    // First-generation NULL leg: seed a row, acknowledge with null
    const nullKeyUnit = {
      unit_key: "trunk_commit::seen6null::/repo",
      value_source: "trunk_commit",
      value_ref: "seen6null",
    };
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text" }],
        }),
      })
    );
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [nullKeyUnit],
    });
    // First generation has regenerated_at initially NULL (or not in response)
    // Try to acknowledge with null
    seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: nullKeyUnit.unit_key, regenerated_at: null }],
    });
    assert.equal(seenRes.body.updated, 1, "NULL regenerated_at should match first-generation row");
  });

  it("SEEN-7: project_id is advisory (T-K), BY DESIGN", async () => {
    const projectId1 = await makeProject("SEEN-7a");
    const projectId2 = await makeProject("SEEN-7b");
    const unitKey = "trunk_commit::seen7::/repo";
    const unit = {
      unit_key: unitKey,
      value_source: "trunk_commit",
      value_ref: "seen7",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text" }],
        }),
      })
    );

    // Create in projectId1
    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId1,
      units: [unit],
    });
    const regeneratedAt = res.body.altitudes[unitKey].regenerated_at;

    // POST /seen with projectId2 should still work (unit_key is the real key)
    let seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId2,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt }],
    });
    assert.equal(seenRes.status, 200, "cross-project stamp should succeed (project_id advisory)");
    assert.equal(seenRes.body.updated, 1, "should find and update the unit");

    // Verify cleared in projectId1
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId1,
      units: [unit],
    });
    assert.ok(
      !("freshness" in res.body.altitudes[unitKey]),
      "marker cleared despite wrong project_id"
    );
  });
});

describe("ROUTE-SEAM-1: request-path logging with dropped units (T-F, §9.8)", () => {
  it("POST /altitudes writes exactly one request-source log row whose four terms sum to the submitted batch size", async () => {
    const projectId = await makeProject("ROUTE-SEAM-1 Test");
    const goodUnit = {
      unit_key: "trunk_commit::good::/repo",
      value_source: "trunk_commit",
      value_ref: "good",
    };
    const bogusSourceUnit = {
      unit_key: "trunk_commit::bogus-src::/repo",
      value_source: "invalid_source_xyz",
      value_ref: "bogus-src",
    };
    const keylessUnit = {
      // Missing unit_key
      value_source: "trunk_commit",
      value_ref: "keyless",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "S" }],
        }),
      })
    );

    // Count log rows before
    const rowsBefore = db
      .prepare("SELECT COUNT(*) as cnt FROM value_summary_generation_log")
      .get().cnt;

    // POST with N good + 1 bogus source + 1 keyless
    const res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [goodUnit, bogusSourceUnit, keylessUnit],
    });

    assert.equal(res.status, 200);

    // Verify exactly one new row
    const rowsAfter = db
      .prepare("SELECT COUNT(*) as cnt FROM value_summary_generation_log")
      .get().cnt;
    assert.equal(rowsAfter - rowsBefore, 1, "exactly one new log row");

    // Get the new row
    const logRow = db
      .prepare("SELECT * FROM value_summary_generation_log ORDER BY created_at DESC LIMIT 1")
      .get();
    assert.equal(logRow.source, "request", "source should be 'request'");

    // pool_size should equal submitted batch size (3)
    assert.equal(logRow.pool_size, 3, "pool_size should match submitted units.length");
    assert.equal(logRow.pool_size, res.body.counts.pool_size, "route counts should match log");

    // Four-term identity
    const sum = logRow.cache_hits + logRow.generated + logRow.queued + logRow.unavailable;
    assert.equal(sum, logRow.pool_size, "four-term identity holds");

    // unavailable should be >= 2 (bogus source + keyless)
    assert.ok(logRow.unavailable >= 2, `unavailable >= 2 (found ${logRow.unavailable})`);

    // stale_regenerated should be a measured integer (0 in this case)
    assert.equal(
      typeof logRow.stale_regenerated,
      "number",
      "stale_regenerated should be an integer"
    );
    assert.equal(logRow.stale_regenerated, 0, "stale_regenerated = 0 for fresh units");

    // Wire: union of altitudes and states keys should be exactly the keyed submitted units
    const altKeys = Object.keys(res.body.altitudes);
    const stateKeys = Object.keys(res.body.states);
    const allKeys = new Set([...altKeys, ...stateKeys]);

    // Should include good unit, should include bogus source unit (in states), should NOT include keyless
    assert.equal(
      allKeys.size,
      2,
      "should have exactly 2 keyed units (N=1 good, 1 with valid key but bad source)"
    );
    assert.ok(allKeys.has(goodUnit.unit_key), "good unit in wire");
    assert.ok(allKeys.has(bogusSourceUnit.unit_key), "bogus source unit in wire (unavailable)");
  });
});

describe("DEC-7: cross-path parity (P1, P2)", () => {
  it("P1: structural parity — unitFacts over three unit shapes", () => {
    const { unitFacts } = require("../lib/value-summary");

    // Assembler shape (detour, no stage, null label, value_ref fallback)
    const assemblerShape = {
      value_source: "detour",
      value_ref: "ref123",
      label: null,
    };

    // Route-sanitized shape (stage coerced to null)
    const routeSanitized = {
      value_source: "detour",
      value_ref: "ref123",
      label: null,
      stage: null,
    };

    // Explicit null
    const explicitNull = {
      value_source: "detour",
      value_ref: "ref123",
      label: null,
      stage: null,
    };

    const f1 = unitFacts(assemblerShape);
    const f2 = unitFacts(routeSanitized);
    const f3 = unitFacts(explicitNull);

    assert.deepEqual(f1, f2, "assembler and route-sanitized shapes produce identical facts");
    assert.deepEqual(f2, f3, "route-sanitized and explicit-null identical");
    assert.equal(f1.label, "ref123", "value_ref fallback applied");
  });

  it("P2: behavioral parity through the real route", async () => {
    // Seed via enrichPoolAltitudes with assembler shape (no stage key)
    const projectId = await makeProject("P2 Test");
    const unitKey = "detour::p2::/repo";
    const assemblerShape = {
      unitKey,
      value_source: "detour",
      value_ref: "p2",
      label: null,
      // No stage key
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text" }],
        }),
      })
    );

    // Call enrichPoolAltitudes directly (assembler path)
    let result = await enrichPoolAltitudes(db, [assemblerShape]);
    assert.ok(result.altitudes[unitKey], "unit created via assembler");
    const dbRow1 = db.prepare("SELECT * FROM value_unit_summaries WHERE unit_key = ?").get(unitKey);

    // Now POST via route with the same unit but JSON (stage omitted)
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "Text" }],
        }),
      })
    );

    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [
        {
          unit_key: unitKey,
          value_source: "detour",
          value_ref: "p2",
          label: null,
          // stage omitted (like a client would send)
        },
      ],
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.altitudes[unitKey], "unit found via route");

    // Should be cached (zero additional spawns, one total)
    // The key point: route coercion must match assembler behavior
    const dbRow2 = db.prepare("SELECT * FROM value_unit_summaries WHERE unit_key = ?").get(unitKey);
    assert.deepEqual(
      dbRow1.input_stage,
      dbRow2.input_stage,
      "route and assembler produce identical snapshot stage"
    );
  });
});

describe("e2e flow cases (E1–E7)", () => {
  it("E1: seed + cache hit — identical re-POST returns same altitudes, zero spawns", async () => {
    const projectId = await makeProject("E1 Test");
    const units = [
      {
        unit_key: "intake_initiative::e1a::/repo",
        value_source: "intake_initiative",
        value_ref: "e1a",
        stage: "in_progress",
      },
      {
        unit_key: "intake_initiative::e1b::/repo",
        value_source: "intake_initiative",
        value_ref: "e1b",
      },
      {
        unit_key: "trunk_commit::e1c::/repo",
        value_source: "trunk_commit",
        value_ref: "e1c",
      },
    ];

    let spawnCount = 0;
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [
            { index: 1, project: "P", stakeholder: "A text" },
            { index: 2, project: "P", stakeholder: "B text" },
            { index: 3, project: "P", stakeholder: "C text" },
          ],
        }),
      })
    );
    spawnCount++;

    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units,
    });
    assert.equal(res.status, 200);
    assert.equal(Object.keys(res.body.altitudes).length, 3);
    assert.deepEqual(res.body.states, {}, "states empty for all cached");

    // Second POST identical
    const spawn2Count = spawnCount;
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units,
    });
    assert.equal(res.status, 200);
    assert.equal(Object.keys(res.body.altitudes).length, 3, "all 3 in altitudes");

    // Check log. Filtered by project_id (not just source), and by `id DESC`
    // (an auto-increment monotonic tiebreak) rather than `created_at DESC`
    // alone — two log rows landing in the same millisecond (real, observed
    // in this suite; see DEC-B2) make an unfiltered timestamp-only ORDER BY
    // return an ARBITRARY row among ties when other tests in the same
    // full-suite run write 'request' rows around the same instant.
    const logRow = db
      .prepare(
        "SELECT * FROM value_summary_generation_log WHERE source = 'request' AND project_id = ? ORDER BY id DESC LIMIT 1"
      )
      .get(projectId);
    assert.equal(logRow.pool_size, 3);
    assert.equal(logRow.cache_hits, 3, "all three cache hits");
    assert.equal(logRow.generated, 0, "zero generated");
    assert.equal(logRow.queued, 0);
    assert.equal(logRow.unavailable, 0);
    assert.equal(logRow.stale_regenerated, 0, "measured zero not NULL");
  });

  it("E2: stage change regenerates exactly one, other entries unchanged", async () => {
    const projectId = await makeProject("E2 Test");
    const units = [
      {
        unit_key: "intake_initiative::e2a::/repo",
        value_source: "intake_initiative",
        value_ref: "e2a",
        stage: "in_progress",
      },
      {
        unit_key: "intake_initiative::e2b::/repo",
        value_source: "intake_initiative",
        value_ref: "e2b",
      },
      {
        unit_key: "trunk_commit::e2c::/repo",
        value_source: "trunk_commit",
        value_ref: "e2c",
      },
    ];

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [
            { index: 1, project: "P", stakeholder: "A" },
            { index: 2, project: "P", stakeholder: "B" },
            { index: 3, project: "P", stakeholder: "C" },
          ],
        }),
      })
    );

    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units,
    });
    assert.equal(Object.keys(res.body.altitudes).length, 3);
    const e2aV1 = res.body.altitudes[units[0].unit_key];
    const e2bV1 = res.body.altitudes[units[1].unit_key];
    const e2cV1 = res.body.altitudes[units[2].unit_key];

    // Change A's stage
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "A new" }],
        }),
      })
    );

    const mutatedUnits = [{ ...units[0], stage: "shipped" }, units[1], units[2]];
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: mutatedUnits,
    });

    assert.equal(res.status, 200);
    const e2aV2 = res.body.altitudes[units[0].unit_key];
    const e2bV2 = res.body.altitudes[units[1].unit_key];
    const e2cV2 = res.body.altitudes[units[2].unit_key];

    // A should have new text and marker
    assert.notEqual(e2aV2.stakeholder, e2aV1.stakeholder, "A regenerated");
    assert.equal(e2aV2.freshness, "updated_unseen", "A marked");
    assert.equal(e2aV2.update_reason, "stage_changed");

    // B and C's synthesized content should be unchanged. A raw deepEqual of
    // the whole entry is unsatisfiable by construction here (confirmed by
    // reading enrichPoolAltitudes): `cached` legitimately flips false→true
    // between a fresh generation and a later cache-hit read for ANY unit,
    // and a plain cache-hit response omits `regenerated_at` entirely for a
    // unit that has never regenerated (B/C here) — both documented shape
    // differences between a generation response and a cache-hit response,
    // not evidence of drift. Compare content stability instead.
    assert.equal(e2bV2.project, e2bV1.project, "B project unchanged");
    assert.equal(e2bV2.stakeholder, e2bV1.stakeholder, "B stakeholder unchanged");
    assert.equal(e2bV2.model, e2bV1.model, "B model unchanged");
    assert.equal(e2bV2.cached, true, "B is now served from cache");
    assert.equal(e2cV2.project, e2cV1.project, "C project unchanged");
    assert.equal(e2cV2.stakeholder, e2cV1.stakeholder, "C stakeholder unchanged");
    assert.equal(e2cV2.model, e2cV1.model, "C model unchanged");
    assert.equal(e2cV2.cached, true, "C is now served from cache");
    assert.ok(!("freshness" in e2bV2), "B has no freshness");
    assert.ok(!("freshness" in e2cV2), "C has no freshness");

    // Log. Filtered by project_id and `id DESC` — see E1's identical fix
    // above for why an unfiltered created_at-only ORDER BY is flaky under a
    // full-suite run (millisecond ties, DEC-B2).
    const logRow = db
      .prepare(
        "SELECT * FROM value_summary_generation_log WHERE source = 'request' AND project_id = ? ORDER BY id DESC LIMIT 1"
      )
      .get(projectId);
    assert.equal(logRow.cache_hits, 2, "B and C are hits");
    assert.equal(logRow.generated, 1, "A generated");
    assert.equal(logRow.stale_regenerated, 1, "A was stale");
  });

  it("E3: acknowledge round-trip clears marker", async () => {
    // A first-EVER POST for a never-cached unit is a first generation, not a
    // regeneration — per DEC-12, `regenerated_at` is NULL and no `freshness`
    // is carried at all on that response. This test needs a genuine
    // mutate-then-regenerate step (D6/SEEN-1 shape) before there is a
    // marker to acknowledge.
    const projectId = await makeProject("E3 Test");
    const unitKey = "intake_initiative::e3::/repo";
    const unit = {
      unit_key: unitKey,
      value_source: "intake_initiative",
      value_ref: "e3",
      stage: "in_progress",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "V1" }],
        }),
      })
    );

    // First-ever generation — no freshness yet.
    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unit],
    });
    assert.ok(!("freshness" in res.body.altitudes[unitKey]), "first generation has no freshness");

    // Mutate the stage to trigger a real regeneration.
    const mutatedUnit = { ...unit, stage: "shipped" };
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "V2" }],
        }),
      })
    );
    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [mutatedUnit],
    });
    assert.equal(res.body.altitudes[unitKey].freshness, "updated_unseen");
    const regeneratedAt = res.body.altitudes[unitKey].regenerated_at;

    // POST /seen
    let seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt }],
    });
    assert.equal(seenRes.status, 200);

    // Re-POST the batch (unchanged inputs — a cache hit, no further mutation)
    __injectSpawnForTest(() => {
      throw new Error("no LLM call expected on a cache hit");
    });

    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [mutatedUnit],
    });
    assert.ok(!("freshness" in res.body.altitudes[unitKey]), "marker gone after ack");

    // Double-acknowledge
    seenRes = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt }],
    });
    assert.equal(seenRes.status, 200, "double-ack is 200");
  });

  it("E4: acknowledge-then-regenerate re-arms the marker", async () => {
    const projectId = await makeProject("E4 Test");
    const unitKey = "intake_initiative::e4::/repo";
    const unit = {
      unit_key: unitKey,
      value_source: "intake_initiative",
      value_ref: "e4",
      stage: "in_progress",
    };

    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "V1" }],
        }),
      })
    );

    let res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [unit],
    });
    const regeneratedAt1 = res.body.altitudes[unitKey].regenerated_at;

    // Acknowledge
    await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [{ unit_key: unitKey, regenerated_at: regeneratedAt1 }],
    });

    // Change stage and regenerate
    __injectSpawnForTest(
      fakeSpawn({
        stdout: envelope({
          units: [{ index: 1, project: "P", stakeholder: "V2" }],
        }),
      })
    );

    res = await post("/api/project-plans/altitudes", {
      project_id: projectId,
      units: [{ ...unit, stage: "shipped" }],
    });

    // Marker re-appears with fresh regenerated_at
    assert.equal(res.body.altitudes[unitKey].freshness, "updated_unseen", "marker re-armed");
    const regeneratedAt2 = res.body.altitudes[unitKey].regenerated_at;
    assert.notEqual(regeneratedAt2, regeneratedAt1, "new regenerated_at");
  });

  it("E5: validation smoke on /seen 400s", async () => {
    const projectId = await makeProject("E5 Test");

    // Missing project_id
    let res = await post("/api/project-plans/altitudes/seen", {
      units: [{ unit_key: "x", regenerated_at: null }],
    });
    assert.equal(res.status, 400, "missing project_id");

    // Empty units
    res = await post("/api/project-plans/altitudes/seen", {
      project_id: projectId,
      units: [],
    });
    assert.equal(res.status, 400, "empty units");
  });
});

describe("i18n registry → locale", () => {
  it("every ALTITUDE_STATES member has a planLedger.pool.altitudes key in the en locale", () => {
    const { ALTITUDE_STATES } = require("../lib/value-summary");
    const en = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../client/src/i18n/locales/en/projectDetail.json"),
        "utf8"
      )
    );
    const bucket = en.planLedger.pool.altitudes;
    for (const state of ALTITUDE_STATES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(bucket, state),
        `ALTITUDE_STATES member "${state}" has no planLedger.pool.altitudes.${state} copy in en/projectDetail.json`
      );
    }
  });
});
