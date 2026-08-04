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
const { enrichPoolAltitudes, buildPrompt, parseOutput } = require("../lib/value-summary");
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
  it("returns an empty map for an empty batch without touching the LLM path", async () => {
    __injectSpawnForTest(() => {
      throw new Error("no LLM call expected for an empty batch");
    });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, []), { altitudes: {}, states: {} });
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
    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
    const u1 = unit({ unitKey: "trunk_commit::mode-off::/repo", value_ref: "mode-off" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u1]), {
      altitudes: {},
      states: { [u1.unitKey]: "unavailable" },
    });

    delete process.env.DASHBOARD_FOCUS_INFER_MODE;
    __injectSpawnForTest(fakeSpawn({ exitCode: 1 })); // probe fails -> unavailable
    const u2 = unit({ unitKey: "trunk_commit::probe-fail::/repo", value_ref: "probe-fail" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u2]), {
      altitudes: {},
      states: { [u2.unitKey]: "unavailable" },
    });

    __injectSpawnForTest(fakeSpawn({ stdout: "not json" }));
    const u3 = unit({ unitKey: "trunk_commit::garbage::/repo", value_ref: "garbage" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u3]), {
      altitudes: {},
      states: { [u3.unitKey]: "unavailable" },
    });
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
