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
    assert.deepEqual(await enrichPoolAltitudes(dbModule, []), {});
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
    const first = await enrichPoolAltitudes(dbModule, [u]);
    assert.equal(first[u.unitKey].project, "Part of the tracker.");
    assert.equal(first[u.unitKey].cached, false);

    // Any further spawn attempt would blow up — proving the cache is served.
    __injectSpawnForTest(() => {
      throw new Error("no LLM call expected on a cache hit");
    });
    const second = await enrichPoolAltitudes(dbModule, [u]);
    assert.equal(second[u.unitKey].stakeholder, "Shipped the tracker.");
    assert.equal(second[u.unitKey].cached, true);
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
    const result = await enrichPoolAltitudes(dbModule, units);
    assert.equal(spawnCount, 1);
    assert.equal(result[units[0].unitKey].project, "P1");
    assert.equal(result[units[1].unitKey].project, "P2");
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
    const result = await enrichPoolAltitudes(dbModule, [u]);
    assert.equal(result[u.unitKey].model, "sonnet");
    const promptArgs = spawnedArgs.find((a) => a.includes("-p"));
    assert.equal(promptArgs[promptArgs.indexOf("--model") + 1], "sonnet");
  });

  it("leaves a unit out of the result for a non-llm mode, a failed probe, and unparsable output", async () => {
    process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic";
    const u1 = unit({ unitKey: "trunk_commit::mode-off::/repo", value_ref: "mode-off" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u1]), {});

    delete process.env.DASHBOARD_FOCUS_INFER_MODE;
    __injectSpawnForTest(fakeSpawn({ exitCode: 1 })); // probe fails -> unavailable
    const u2 = unit({ unitKey: "trunk_commit::probe-fail::/repo", value_ref: "probe-fail" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u2]), {});

    __injectSpawnForTest(fakeSpawn({ stdout: "not json" }));
    const u3 = unit({ unitKey: "trunk_commit::garbage::/repo", value_ref: "garbage" });
    assert.deepEqual(await enrichPoolAltitudes(dbModule, [u3]), {});
  });
});

describe("POST /api/project-plans/altitudes", () => {
  it("400s without project_id or units[]", async () => {
    const res = await post("/api/project-plans/altitudes", { units: [] });
    assert.equal(res.status, 400);
    const res2 = await post("/api/project-plans/altitudes", { project_id: "x" });
    assert.equal(res2.status, 400);
  });

  it("returns altitudes for a valid batch and silently drops malformed entries", async () => {
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
        { unit_key: "" }, // malformed: dropped
        { unit_key: "bad::source", value_source: "not_a_real_source" }, // malformed: dropped
      ],
    });
    assert.equal(res.status, 200);
    const altitude = res.body.altitudes["trunk_commit::route::/repo"];
    assert.equal(altitude.project, "Part of the tracker.");
    assert.equal(altitude.stakeholder, "Shipped it.");
    assert.equal(Object.keys(res.body.altitudes).length, 1);
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
