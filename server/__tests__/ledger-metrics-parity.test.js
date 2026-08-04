/**
 * @file Tests for §9.1 per-shape parity: the API route and the `ccam ledger`
 * CLI must render the IDENTICAL derived values from server/lib/value-ledger.js
 * — no hand-rolled re-arithmetic on either side. One seeded DB (an open plan,
 * a closed generation with a claim, a small live pool), a real in-process
 * server, and a real spawned `ccam ledger` child process (the same
 * async-spawn harness ccam-cli.test.js uses) — this is the actual T6 guard
 * DEC-5/§9.1 exist for, not a typeof stub.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const { execFileSync } = require("child_process");

const STAMP = `ledger-parity-${Date.now()}-${process.pid}`;
const TMP = path.join(os.tmpdir(), STAMP);
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.CLAUDE_HOME = path.join(TMP, "home");
process.env.DASHBOARD_DATA_DIR = path.join(TMP, "data");
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const dbModule = require("../db");
const { db, stmts } = dbModule;
const valueLedger = require("../lib/value-ledger");
const cwdIdentity = require("../lib/cwd-identity");

const CLI = path.resolve(__dirname, "..", "..", "bin", "ccam.js");

const GIT_ENV_OVERRIDE_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];
const ISOLATED_GIT_ENV = { ...process.env };
for (const key of GIT_ENV_OVERRIDE_KEYS) delete ISOLATED_GIT_ENV[key];

let server;
let PORT;
let projectId;
let tmpDir;

function ccam(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, DASHBOARD_PORT: String(PORT) },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const killer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code, out, err });
    });
  });
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

// Extracts the value printed after a kvLine label (bin/ccam.js's
// `  <label>  <value>` format), stripping ANSI color codes first. A loose
// `out.includes(String(n))` check is too weak here — a single digit like
// "0" coincidentally appears almost anywhere in colored terminal output, so
// a mutated CLI value can pass a substring check by accident.
function extractKvValue(out, label) {
  const clean = out.replace(ANSI_RE, "");
  const re = new RegExp(`^\\s*${label}\\s+(.+)$`, "m");
  const match = clean.match(re);
  return match ? match[1].trim() : null;
}

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port: PORT, path: urlPath }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: ISOLATED_GIT_ENV,
  }).trim();
}

before(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const app = createApp();
  server = await startServer(app, 0);
  PORT = server.address().port;

  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-parity-repo-")));
  execFileSync("git", ["-c", "init.defaultBranch=master", "init", tmpDir], {
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  fs.writeFileSync(path.join(tmpDir, "README.md"), "x\n");
  git(tmpDir, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  const rootDate = new Date(Date.now() - 90 * 86400000).toISOString();
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: tmpDir,
    stdio: "ignore",
    env: { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: rootDate, GIT_AUTHOR_DATE: rootDate },
  });
  fs.writeFileSync(path.join(tmpDir, "direct.txt"), "x\n");
  git(tmpDir, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  git(tmpDir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "direct to master"]);

  projectId = `ledger-parity-project-${Date.now()}`;
  stmts.insertProject.run(projectId, "Ledger Parity Project");
  stmts.insertProjectPath.run(projectId, tmpDir);

  // A closed generation with one claim — exercises both health's
  // lastClosureAt/daysSinceLastClosure AND history's claims-with-no-closed-at
  // shape, so both the health and history parity cases have real data.
  const planInfo = stmts.insertProjectPlan.run(
    projectId,
    "Closed Gen",
    "open",
    null,
    "manual",
    null,
    null
  );
  const planId = planInfo.lastInsertRowid;
  const itemInfo = db
    .prepare("INSERT INTO project_plan_items (plan_id, text, position) VALUES (?, ?, 0)")
    .run(planId, "Parity item");
  stmts.insertValueClaim.run(
    projectId,
    planId,
    itemInfo.lastInsertRowid,
    "detour",
    "parity-detour-1",
    cwdIdentity.canonicalizeCwd(tmpDir),
    null,
    null,
    null,
    "judgment",
    "human"
  );
  db.prepare("UPDATE project_plans SET status='closed', closed_at=? WHERE id=?").run(
    new Date().toISOString(),
    planId
  );

  // A second, still-open plan so openPlanCount is non-zero too.
  stmts.insertProjectPlan.run(projectId, "Open Gen", "open", null, "manual", null, null);
});

after(() => {
  server?.close();
  try {
    db.close();
  } catch {
    /* already closed */
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${process.env.DASHBOARD_DB_PATH}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("ledger metrics parity (C2 / T6)", () => {
  it("C2.1: API vs CLI, identical values for every health metric", async () => {
    const apiHealth = await apiGet(
      `/api/project-plans/health?project_id=${encodeURIComponent(projectId)}`
    );
    const { code, out } = await ccam("ledger", "health", "--project", projectId);
    assert.equal(code, 0);

    assert.equal(
      extractKvValue(out, "Unclaimed pool"),
      String(apiHealth.unclaimedPoolSize),
      "unclaimedPoolSize must match verbatim"
    );
    assert.equal(
      extractKvValue(out, "Open plans"),
      String(apiHealth.openPlanCount),
      "openPlanCount must match verbatim"
    );
    assert.equal(
      extractKvValue(out, "Days since"),
      String(apiHealth.daysSinceLastClosure),
      "daysSinceLastClosure must match verbatim — a CLI that hand-rolls this from lastClosureAt would drift the moment its own date-math disagrees with computePlanHealth's"
    );
  });

  it("C2.2: null-shape parity — a project with no closures renders the null shape identically", async () => {
    const emptyProjectId = `ledger-parity-empty-${Date.now()}`;
    stmts.insertProject.run(emptyProjectId, "Empty Project");

    const apiHealth = await apiGet(
      `/api/project-plans/health?project_id=${encodeURIComponent(emptyProjectId)}`
    );
    assert.equal(apiHealth.lastClosureAt, null);
    assert.equal(apiHealth.daysSinceLastClosure, null);

    const { code, out } = await ccam("ledger", "health", "--project", emptyProjectId);
    assert.equal(code, 0);
    assert.ok(
      /never/i.test(out),
      "CLI must render the null lastClosureAt as its documented 'never' label"
    );
    assert.ok(
      /n\/a/i.test(out),
      "CLI must render the null daysSinceLastClosure as its documented 'n/a' label"
    );
    assert.ok(!out.includes("NaN"));
    assert.ok(!out.includes("Invalid Date"));
  });

  it("C2.3: pool/history parity — CLI unit/generation counts match the API's exactly", async () => {
    const apiPool = await apiGet(
      `/api/project-plans/pool?project_id=${encodeURIComponent(projectId)}`
    );
    const poolRun = await ccam("ledger", "pool", "--project", projectId);
    assert.equal(poolRun.code, 0);
    if (apiPool.units.length === 0) {
      assert.ok(/empty/i.test(poolRun.out));
    } else {
      // Every unit's label/ref must appear once in the CLI table output.
      for (const unit of apiPool.units) {
        const needle = (unit.label || unit.value_ref || "").slice(0, 50);
        assert.ok(poolRun.out.includes(needle), `CLI pool output must include unit "${needle}"`);
      }
    }

    const apiHistory = await apiGet(
      `/api/project-plans/history?project_id=${encodeURIComponent(projectId)}`
    );
    const historyRun = await ccam("ledger", "history", "--project", projectId);
    assert.equal(historyRun.code, 0);
    assert.equal(apiHistory.generations.length, 1, "fixture setup: exactly one closed generation");
    assert.ok(
      historyRun.out.includes(`Generation ${apiHistory.generations[0].ordinal}`),
      "CLI history must render the API's own generation ordinal, not a re-derived one"
    );
    assert.ok(
      historyRun.out.includes(String(apiHistory.generations[0].claims.length)),
      "CLI history must render the API's own claim count"
    );
  });

  it("C2.4: consumer registry marker — CONSUMERS names exactly the route, the CLI, and the tick (DEC-16)", () => {
    assert.ok(Array.isArray(valueLedger.CONSUMERS));
    assert.deepEqual(
      valueLedger.CONSUMERS.slice().sort(),
      [
        "bin/ccam.js (cmdLedger)",
        "server/routes/project-plans.js",
        "server/lib/value-summary-tick.js",
      ].sort(),
      "a fourth consumer (MCP tools, an AGENT-PLAN.md export, a reconcile page — DEC-16) " +
        "must be a deliberate, reviewed addition to this list, never silent"
    );
  });
});
