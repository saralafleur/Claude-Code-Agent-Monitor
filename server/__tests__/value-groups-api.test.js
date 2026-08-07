/**
 * @file Tests for value groups API routes and end-to-end scenarios
 * TT-a…TT-i, TT-read: §9.8 truth table (ONE 9-row decision matrix + spawn counts)
 * N-1…N-4: Negative proof — proposals never actions
 * E-1…E-6, RT-1…RT-3: End-to-end lifecycle and round-trip tests
 *
 * Boots a real Express app on a temp SQLite DB, makes real HTTP requests to
 * the real routes. BL-13: `POST /groups/propose` no longer awaits the LLM
 * pipeline inside the request — it fires `runGroupingPass` and returns
 * immediately, so every test that needs the pass to have actually finished
 * (to poll a terminal `run.state`, check persisted groups, or count spawns)
 * uses `proposeAndSettle`/`waitForRunTerminal` below, which polls the real
 * DB row rather than assuming the HTTP response implies completion.
 *
 * BL-16: `DASHBOARD_FOCUS_INFER_MODE=heuristic` is still the file-wide
 * DEFAULT (LLM off, deterministic) for the rows/cases that don't care about
 * the refined path — but `withLlmMode` genuinely flips it to `"llm"` and
 * stubs `focusInference.probeClaudeCli`/`runClaudePromptJson` THROUGH THE
 * MODULE NAMESPACE (BO-5 technique, same as P-6/P-7 and R-5/R-6) for every
 * case that needs to prove something about the `refined` path — this is
 * what closes the gap that let BL-2 (rollupGroups positional corruption)
 * ship with a fully green suite.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `value-groups-api-test-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"; // LLM off by default, deterministic

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");
const { unitKey } = require("../lib/value-ledger");
const { MAX_UNITS_PER_GROUPING_PROMPT } = require("../lib/value-groups");
const focusInference = require("../lib/focus-inference");

let server;
let BASE;

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

// ── BL-16: the module-namespace LLM stub, installed ONCE for the whole
// file's lifetime. `focusInference.probeClaudeCli` always resolves `true`
// (harmless: `llmAvailable()` only calls it when
// `DASHBOARD_FOCUS_INFER_MODE === "llm"`, so this never fires under the
// file's default heuristic posture). `focusInference.runClaudePromptJson`
// counts every call and delegates to the currently-active `promptStubImpl`
// closure, swapped in/out per-case by `withLlmMode` below. ──
let spawnCallCount = 0;
let promptStubImpl = async () => null;
const originalProbeClaudeCli = focusInference.probeClaudeCli;
const originalRunClaudePromptJson = focusInference.runClaudePromptJson;

/**
 * Runs `fn` with `DASHBOARD_FOCUS_INFER_MODE=llm` and `promptStubImpl`
 * swapped to `stub` — the module-namespace patch technique (BO-5, P-6/P-7,
 * R-5/R-6) — genuinely exercising `runGroupingPass`'s real LLM-call path.
 * Always restores both in `finally`.
 */
async function withLlmMode(stub, fn) {
  const originalMode = process.env.DASHBOARD_FOCUS_INFER_MODE;
  const originalStub = promptStubImpl;
  process.env.DASHBOARD_FOCUS_INFER_MODE = "llm";
  promptStubImpl = stub;
  try {
    return await fn();
  } finally {
    if (originalMode === undefined) delete process.env.DASHBOARD_FOCUS_INFER_MODE;
    else process.env.DASHBOARD_FOCUS_INFER_MODE = originalMode;
    promptStubImpl = originalStub;
  }
}

/** Polls the REAL db row (never assumes the HTTP response implies
 *  completion — BL-13's fire-and-forget route means it never does) until
 *  `state !== "in_progress"`, or throws after `timeoutMs`. */
async function waitForRunTerminal(runId, timeoutMs = 5000) {
  if (!runId) return null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = stmts.getValueGroupRun.get(runId);
    if (row && row.state !== "in_progress") return row;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Timed out waiting for run ${runId} to leave in_progress`);
}

/** POST propose, then — ONLY if THIS request genuinely started a fresh run
 *  (`outcome === "started"`) — wait for it to reach a terminal state before
 *  returning. `already_running`/`reused_unchanged` return an EXISTING run
 *  that this request did not kick off (in `already_running`'s case, in
 *  several tests a deliberately-stuck fixture row with nothing actually
 *  processing it) — waiting on those would hang forever. */
async function proposeAndSettle(projectId) {
  const res = await post(`/api/project-plans/${projectId}/groups/propose`, {});
  if (res.body && res.body.outcome === "started" && res.body.run && res.body.run.id) {
    await waitForRunTerminal(res.body.run.id);
  }
  return res;
}

/** Computes the real `unitKey`s for a project's default 3-unit
 *  `seedProjectWithCoverage` fixture (or any `refs` override) — several
 *  tests need to hand a REAL `memberUnitKeys` list to a stubbed LLM
 *  response so `parseGroupingOutput`'s strict whitelist (only keys that
 *  are actually in `cluster.memberUnitKeys` survive) doesn't filter every
 *  member out to an empty list, landing the group `zero_members` instead
 *  of the `refined` state the test actually wants to exercise. */
function defaultUnitKeysFor(suffix, refs = ["det-001", "det-002", "det-003"]) {
  const cwd = `/tmp/vg-test-cwd-${suffix}`;
  return refs.map((ref) => {
    const row = db
      .prepare("SELECT id FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
      .get(cwd, ref);
    return unitKey("detour", String(row.id), cwd);
  });
}

async function seedProjectWithCoverage(
  suffix,
  complete = true,
  refs = ["det-001", "det-002", "det-003"]
) {
  const projectId = `vg-test-${suffix}-${Date.now()}-${process.pid}`;
  const cwd = `/tmp/vg-test-cwd-${suffix}`;

  stmts.insertProject.run(projectId, `Value Groups Test ${suffix}`);
  stmts.insertProjectPath.run(projectId, cwd);

  // Seed THREE (same-day) detour units into the pool via
  // detour_dispositions (no live git repo needed — the detour tier reads
  // detour_dispositions directly), mirroring
  // value-coverage-parity.test.js's seedProjectWithDetourPool. Three, not
  // one, so a complete=true pool also has enough same-day members for
  // mechanicalPreGroup's time-signal clustering to actually form a group —
  // several E-2.x/RT-x cases need a real persisted group to approve, not
  // merely a `complete` coverage flag. `refs` is overridable (default 3)
  // so E-6.4/E-6.5's 4-member (A/B/C/D) drift fixture and TT-h's
  // single-unit (no cluster forms) fixture can reuse this same helper
  // instead of duplicating the seeding logic.
  for (const ref of refs) {
    stmts.upsertDetourDisposition.run(
      cwd,
      projectId,
      null,
      "inferred",
      ref,
      null,
      `Detour ${ref}`,
      null
    );
  }

  if (complete) {
    // rowToUnit() maps a detour row to value_source="detour",
    // value_ref=String(row.id) — NOT source_ref — so each unit key must be
    // built from its real autoincrement id, read back here rather than
    // guessed.
    for (const ref of refs) {
      const row = db
        .prepare("SELECT id FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
        .get(cwd, ref);
      const uk = `detour::${row.id}::${cwd}`;
      stmts.upsertValueUnitSummary.run(
        uk,
        `${ref} project text`,
        `${ref} stakeholder text`,
        "haiku",
        null,
        `Detour ${ref}`,
        null,
        "initial",
        null
      );
    }
  }

  return projectId;
}

/**
 * BL-16 fixture for E-4.1…E-4.4 (hierarchical decomposition): 45 detour
 * units split across THREE distinct days (21/21/3) so mechanicalPreGroup's
 * time signal forms three genuine clusters, and `packBatches` genuinely
 * splits them across TWO batches (21+21 > MAX_UNITS_PER_GROUPING_PROMPT=40,
 * so day 1 becomes its own batch; day2+day3 (21+3=24) share the second) —
 * a real 45+-unit pool, never the default 3-unit fixture BL-16 named as the
 * reason this class of test never actually ran.
 */
async function seedLargePoolAcrossDays(suffix, dayRefLists) {
  const projectId = `vg-test-${suffix}-${Date.now()}-${process.pid}`;
  const cwd = `/tmp/vg-test-cwd-${suffix}`;
  stmts.insertProject.run(projectId, `Value Groups Large Test ${suffix}`);
  stmts.insertProjectPath.run(projectId, cwd);

  const dayKeys = {}; // dayIndex -> [unitKey,...]
  dayRefLists.forEach((refs, dayIdx) => {
    const seenAt = `2026-08-${String(6 + dayIdx).padStart(2, "0")}T09:00:00.000Z`;
    dayKeys[dayIdx] = [];
    for (const ref of refs) {
      stmts.upsertDetourDisposition.run(
        cwd,
        projectId,
        null,
        "inferred",
        ref,
        seenAt,
        `Detour ${ref}`,
        null
      );
    }
    for (const ref of refs) {
      const row = db
        .prepare("SELECT id FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
        .get(cwd, ref);
      const uk = unitKey("detour", String(row.id), cwd);
      dayKeys[dayIdx].push(uk);
      stmts.upsertValueUnitSummary.run(
        uk,
        `${ref} project text`,
        `${ref} stakeholder text`,
        "haiku",
        null,
        `Detour ${ref}`,
        null,
        "initial",
        null
      );
    }
  });

  return { projectId, cwd, dayKeys };
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
  focusInference.probeClaudeCli = async () => true;
  focusInference.runClaudePromptJson = async (prompt, opts) => {
    spawnCallCount += 1;
    return promptStubImpl(prompt, opts);
  };
});

after(() => {
  delete process.env.DASHBOARD_FOCUS_INFER_MODE;
  focusInference.probeClaudeCli = originalProbeClaudeCli;
  focusInference.runClaudePromptJson = originalRunClaudePromptJson;
  server?.close();
  try {
    db.close();
  } catch {
    /* ignore */
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("Value Groups API routes — §9.8 Truth Table & Negative Proof", () => {
  describe("TT-a…TT-i, TT-read: §9.8 truth table", () => {
    it("TT [M]: ONE 9-row decision table — outcome, HTTP status, and EXACT spawn count per row", async () => {
      // BL-15 fix: this was NINE independent it()s with zero spawn
      // assertions, and TT-d/TT-h/TT-i never constructed their own real
      // prior state (byte-equivalent to TT-b in all three cases). Now: one
      // table, one loop, one assertion block per row — every row's
      // `setup()` constructs its OWN real prior state (no faked DB rows
      // beyond the coverage-regression technique TT-read itself already
      // established), and every row's spawn count is measured via the real
      // `focusInference.runClaudePromptJson` call counter.
      const rows = [
        {
          id: "TT-a",
          note: "baseline: no prior run, coverage complete",
          async setup() {
            return await seedProjectWithCoverage("tt-a", true);
          },
          llmAction: true,
          expectedOutcome: "started",
          expectedStatus: 202,
          expectedSpawnDelta: 1,
        },
        {
          id: "TT-b",
          note: "gate rejects: no prior run, coverage incomplete",
          async setup() {
            return await seedProjectWithCoverage("tt-b", false);
          },
          expectedOutcome: "blocked_coverage_incomplete",
          expectedStatus: 409,
          expectedSpawnDelta: 0,
        },
        {
          id: "TT-c",
          note: "risk §4.1: don't resurrect a failed run — fresh retry, not reuse",
          async setup() {
            const projectId = await seedProjectWithCoverage("tt-c", true);
            // A REAL prior 'failed' run, via genuine product behavior: an
            // all-heuristic (LLM-off) pass against a pool that DOES
            // cluster (3 same-day detour units) lands 'failed' by BL-5's
            // own fix (zero clusters ever got refined) — not a manual UPDATE.
            const first = await proposeAndSettle(projectId);
            assert.equal(
              first.body.outcome,
              "started",
              "TT-c precondition: first propose must genuinely start"
            );
            const priorRun = stmts.getLatestValueGroupRun.get(projectId);
            assert.equal(
              priorRun.state,
              "failed",
              "TT-c precondition: prior run must be a REAL failed run (BL-5 poisoning path)"
            );
            return projectId;
          },
          llmAction: true,
          expectedOutcome: "started",
          expectedStatus: 202,
          expectedSpawnDelta: 1,
        },
        {
          id: "TT-d",
          note: "plan-mandated: gate + a real failed-run history both true in two fields",
          async setup() {
            const projectId = await seedProjectWithCoverage("tt-d", true);
            const first = await proposeAndSettle(projectId);
            assert.equal(first.body.outcome, "started");
            const priorRun = stmts.getLatestValueGroupRun.get(projectId);
            assert.equal(
              priorRun.state,
              "failed",
              "TT-d precondition: prior run must be a REAL failed run"
            );
            // Regress coverage for real (a genuine uncached unit), the same
            // technique TT-read already established — never fake the gate.
            const [{ cwd }] = stmts.listProjectPaths.all(projectId);
            stmts.upsertDetourDisposition.run(
              cwd,
              projectId,
              null,
              "inferred",
              "tt-d-uncached",
              null,
              "Uncached detour",
              null
            );
            return projectId;
          },
          expectedOutcome: "blocked_coverage_incomplete",
          expectedStatus: 409,
          expectedSpawnDelta: 0,
        },
        {
          id: "TT-e",
          note: "cache hit: prior genuinely completed run + digest match",
          async setup() {
            const projectId = await seedProjectWithCoverage("tt-e", true);
            // BL-5 consequence: an all-heuristic pass over a clustering
            // pool never lands 'completed' (it's poisoned to 'failed') —
            // so a genuinely reusable prior run requires a genuinely
            // successful refinement, not the default heuristic posture.
            const memberUnitKeys = defaultUnitKeysFor("tt-e");
            await withLlmMode(
              async () =>
                JSON.stringify({
                  groups: [
                    {
                      clusterIndex: 1,
                      name: "TT-e Group",
                      summary_sentence: "A real refined summary.",
                      rationale: "Same day.",
                      memberUnitKeys,
                    },
                  ],
                }),
              () => proposeAndSettle(projectId)
            );
            const priorRun = stmts.getLatestValueGroupRun.get(projectId);
            assert.equal(
              priorRun.state,
              "completed",
              "TT-e precondition: prior run must be genuinely completed"
            );
            assert.ok(
              priorRun.input_digest,
              "TT-e precondition: prior run must carry a real input_digest"
            );
            return projectId;
          },
          expectedOutcome: "reused_unchanged",
          expectedStatus: 200,
          expectedSpawnDelta: 0,
        },
        {
          id: "TT-f",
          note: "existing in_progress run — no second spawn",
          async setup() {
            const projectId = await seedProjectWithCoverage("tt-f", true);
            // A real Promise.all race here is non-deterministic by
            // construction, and would also race the async background pass
            // itself post-BL-13 — deterministically seed in_progress via a
            // direct UPDATE instead (accepted per this row's own review
            // disposition: "likely still works — seeding in_progress
            // directly still tests the same dedup branch").
            await proposeAndSettle(projectId);
            const priorRun = stmts.getLatestValueGroupRun.get(projectId);
            db.prepare(
              "UPDATE value_group_runs SET state = 'in_progress', completed_at = NULL WHERE id = ?"
            ).run(priorRun.id);
            return projectId;
          },
          expectedOutcome: "already_running",
          expectedStatus: 200,
          expectedSpawnDelta: 0,
        },
        {
          id: "TT-g",
          note: "risk: in_progress beats a matching digest — not retriggered",
          async setup() {
            const projectId = await seedProjectWithCoverage("tt-g", true);
            await proposeAndSettle(projectId);
            const priorRun = stmts.getLatestValueGroupRun.get(projectId);
            db.prepare(
              "UPDATE value_group_runs SET state = 'in_progress', completed_at = NULL WHERE id = ?"
            ).run(priorRun.id);
            return projectId;
          },
          expectedOutcome: "already_running",
          expectedStatus: 200,
          expectedSpawnDelta: 0,
        },
        {
          id: "TT-h",
          note: "risk: the row that fell out of §6 — a REAL completed_zero_groups prior run + digest match",
          async setup() {
            // A single-unit pool: every mechanicalPreGroup signal requires
            // >=2 members, so this NEVER clusters — a genuinely distinct
            // fixture shape from the default 3-same-day-detour fixture
            // (which always clusters), producing a real
            // 'completed_zero_groups' run, not the always-clusters default.
            const projectId = await seedProjectWithCoverage("tt-h", true, ["tt-h-solo"]);
            const first = await proposeAndSettle(projectId);
            assert.equal(first.body.outcome, "started");
            const priorRun = stmts.getLatestValueGroupRun.get(projectId);
            assert.equal(
              priorRun.state,
              "completed_zero_groups",
              "TT-h precondition: prior run must be a REAL completed_zero_groups run"
            );
            assert.ok(
              priorRun.input_digest,
              "TT-h precondition: a zero-cluster run still persists a reusable digest (never poisoned — clusters.length===0)"
            );
            return projectId;
          },
          expectedOutcome: "reused_unchanged",
          expectedStatus: 200,
          expectedSpawnDelta: 0,
        },
        {
          id: "TT-i",
          note: "new: gate beats in_progress ordering, proven against a REAL in-flight run",
          async setup() {
            const projectId = await seedProjectWithCoverage("tt-i", true);
            // Construct a REAL in_progress run (not a manual UPDATE): flip
            // to llm mode with an artificially delayed stub so the
            // background pass is GENUINELY still running when we check —
            // a real concurrency window, not a faked row.
            await withLlmMode(
              async () => {
                await new Promise((r) => setTimeout(r, 300));
                return null;
              },
              async () => {
                const res = await post(`/api/project-plans/${projectId}/groups/propose`, {});
                assert.equal(
                  res.body.outcome,
                  "started",
                  "TT-i precondition: first propose must genuinely start"
                );
                const runRow = stmts.getValueGroupRun.get(res.body.run.id);
                assert.equal(
                  runRow.state,
                  "in_progress",
                  "TT-i precondition: run must be GENUINELY in_progress at this instant"
                );
              }
            );
            // Regress coverage for real WHILE that run is still executing
            // in the background (the 300ms delay is still pending).
            const [{ cwd }] = stmts.listProjectPaths.all(projectId);
            stmts.upsertDetourDisposition.run(
              cwd,
              projectId,
              null,
              "inferred",
              "tt-i-uncached",
              null,
              "Uncached detour",
              null
            );
            return projectId;
          },
          expectedOutcome: "blocked_coverage_incomplete",
          expectedStatus: 409,
          expectedSpawnDelta: 0,
        },
      ];

      for (const row of rows) {
        const projectId = await row.setup();
        const spawnBefore = spawnCallCount;

        const runAction = () => proposeAndSettle(projectId);
        const res = row.llmAction
          ? await withLlmMode(async () => null, runAction)
          : await runAction();

        const spawnDelta = spawnCallCount - spawnBefore;

        assert.equal(res.status, row.expectedStatus, `${row.id} (${row.note}): HTTP status`);
        assert.equal(res.body.outcome, row.expectedOutcome, `${row.id} (${row.note}): outcome`);
        assert.equal(
          spawnDelta,
          row.expectedSpawnDelta,
          `${row.id} (${row.note}): exact spawn call count`
        );
      }
    });
  });

  describe("TT-read: GET /groups returns both run.state AND gate state on mid-flight regression", () => {
    it("TT-read [M]: GET returns run.state=in_progress AND gate=blocked_coverage_incomplete when coverage regresses mid-flight", async () => {
      const projectId = await seedProjectWithCoverage("tt-read", true);

      // BL-13 consequence: post-fix, `in_progress` genuinely lingers until
      // the background pass finishes — construct a REAL in-flight window
      // with the same delayed-stub technique TT-i uses, so the GET below
      // observes a genuinely still-running pass, not a race that usually
      // loses.
      await withLlmMode(
        async () => {
          await new Promise((r) => setTimeout(r, 300));
          return null;
        },
        async () => {
          const startRes = await post(`/api/project-plans/${projectId}/groups/propose`, {});
          assert.equal(startRes.body.outcome, "started");
          const runRow = stmts.getValueGroupRun.get(startRes.body.run.id);
          assert.equal(
            runRow.state,
            "in_progress",
            "precondition: run must genuinely still be in_progress"
          );

          // Regress coverage for real (a genuine uncached pool unit) before polling.
          const [{ cwd }] = stmts.listProjectPaths.all(projectId);
          stmts.upsertDetourDisposition.run(
            cwd,
            projectId,
            null,
            "inferred",
            "det-regress",
            null,
            "Regression detour",
            null
          );

          const res = await fetch(`/api/project-plans/${projectId}/groups?project_id=${projectId}`);
          assert.equal(res.status, 200, "Should return 200");
          assert.ok(res.body.run, "Response should include the run object");
          // BL-15 fix: BOTH facts, not just one — the old version asserted
          // only `gate`, leaving the run.state half of the mandated
          // "two-both-true-facts" assertion unproven (the run was, in
          // fact, already 'completed' under the pre-fix synchronous route).
          assert.equal(
            res.body.run.state,
            "in_progress",
            "run.state must genuinely still be in_progress"
          );
          assert.equal(
            res.body.gate,
            "blocked_coverage_incomplete",
            "gate should reflect the regressed coverage"
          );
        }
      );
    });
  });

  describe("N-1…N-4: Negative proof — proposals never actions", () => {
    function extractHandlerBody(content, routeRegex) {
      const match = content.match(routeRegex);
      assert.ok(match, `route handler matching ${routeRegex} must exist in project-plans.js`);
      const braceStart = content.indexOf("{", match.index + match[0].length);
      assert.ok(braceStart !== -1, "handler body opening brace should be found");
      let depth = 0;
      for (let i = braceStart; i < content.length; i++) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") {
          depth--;
          if (depth === 0) return content.slice(braceStart, i + 1);
        }
      }
      throw new Error("unbalanced braces walking handler body");
    }

    const GROUP_HANDLER_ROUTES = {
      "POST /groups/propose": /router\.post\(\s*"\/:projectId\/groups\/propose"\s*,/,
      "GET /groups": /router\.get\(\s*"\/:projectId\/groups"\s*,/,
      "POST /groups/:id/approve":
        /router\.post\(\s*"\/:projectId\/groups\/:groupId\([^)]*\)\/approve"\s*,/,
      "POST /groups/:id/dismiss":
        /router\.post\(\s*"\/:projectId\/groups\/:groupId\([^)]*\)\/dismiss"\s*,/,
    };

    it("N-1 [M]: Structural scan — no insertValueClaim/deleteValueClaim in value-groups.js or the four group route handlers (brace-walked)", () => {
      // BL-14/BL-17 fix: this scanned value-groups.js ONLY (the task list
      // mandated "value-groups.js + four route handlers, brace-walked as in
      // G-2") and had a vacuous unconditional-pass escape hatch when the
      // file didn't exist — both removed. value-groups.js always exists by this
      // point in the build; asserting that directly (not silently passing)
      // is what makes a real future regression (the file's removal, or a
      // real insertValueClaim call landing inside it) genuinely fail loud.
      const groupsFile = path.join(__dirname, "..", "lib", "value-groups.js");
      assert.ok(fs.existsSync(groupsFile), "value-groups.js must exist");
      const groupsSource = fs.readFileSync(groupsFile, "utf8");
      const groupsClaimCalls = (groupsSource.match(/insertValueClaim|deleteValueClaim/g) || [])
        .length;
      assert.equal(
        groupsClaimCalls,
        0,
        "value-groups.js must never call insertValueClaim or deleteValueClaim"
      );

      const routesFile = path.join(__dirname, "..", "routes", "project-plans.js");
      const routesSource = fs.readFileSync(routesFile, "utf8");
      for (const [label, re] of Object.entries(GROUP_HANDLER_ROUTES)) {
        const body = extractHandlerBody(routesSource, re);
        const calls = (body.match(/insertValueClaim|deleteValueClaim/g) || []).length;
        assert.equal(
          calls,
          0,
          `${label} handler must never call insertValueClaim or deleteValueClaim`
        );
      }
    });

    it("N-2 [M]: Behavioral — a full propose+poll pass doesn't mutate value_claims rows (pre/post count identical)", async () => {
      const projectId = await seedProjectWithCoverage("n2", true);
      const beforeCount = db.prepare("SELECT COUNT(*) as cnt FROM value_claims").get()?.cnt || 0;

      await proposeAndSettle(projectId);
      const groupsRes = await fetch(
        `/api/project-plans/${projectId}/groups?project_id=${projectId}`
      );
      assert.ok(
        (groupsRes.body.groups || []).length > 0,
        "a real group must have been produced so 'nothing happened' can't pass vacuously"
      );

      const afterCount = db.prepare("SELECT COUNT(*) as cnt FROM value_claims").get()?.cnt || 0;
      assert.equal(
        beforeCount,
        afterCount,
        "value_claims must not be mutated by a real grouping proposal pass"
      );
    });

    it("N-3 [M]: Reserved-but-unreachable — no code path passes/assigns review_status='claimed'", () => {
      // BL-14 fix: the old regex `/review_status\s*=\s*['"]claimed['"]/`
      // only matches an ASSIGNMENT form no production code in this
      // codebase uses — the real write path is
      // `dbModule.stmts.setValueGroupReviewStatus.run("claimed", ...)`, a
      // literal passed as an ARGUMENT, which the old scan was blind to.
      const groupsFile = path.join(__dirname, "..", "lib", "value-groups.js");
      const routesFile = path.join(__dirname, "..", "routes", "project-plans.js");
      const groupsSource = fs.readFileSync(groupsFile, "utf8");
      const routesSource = fs.readFileSync(routesFile, "utf8");

      const claimedArgPattern = /setValueGroupReviewStatus\.run\(\s*["']claimed["']/;
      const claimedAssignPattern = /review_status\s*=\s*['"]claimed['"]/;

      assert.ok(
        !claimedArgPattern.test(groupsSource) && !claimedAssignPattern.test(groupsSource),
        "value-groups.js must never pass or assign review_status='claimed'"
      );

      for (const [label, re] of Object.entries(GROUP_HANDLER_ROUTES)) {
        const body = extractHandlerBody(routesSource, re);
        assert.ok(
          !claimedArgPattern.test(body) && !claimedAssignPattern.test(body),
          `${label} handler must never pass or assign review_status='claimed'`
        );
      }
    });

    it("N-4 [M]: Adversarial LLM response — parseGroupingOutput filters reserved fields, never lets them reach persistence", async () => {
      const projectId = await seedProjectWithCoverage("n4", true);

      // A genuinely refined response, but with the adversarial extra
      // fields the parser must discard: `status`/`review_status` set to a
      // reserved value.
      const memberUnitKeys = defaultUnitKeysFor("n4");
      const res = await withLlmMode(
        async () =>
          JSON.stringify({
            groups: [
              {
                clusterIndex: 1,
                name: "N-4 Adversarial Group",
                summary_sentence: "A real refined summary.",
                rationale: "Same day.",
                memberUnitKeys,
                status: "claimed",
                review_status: "approved",
              },
            ],
          }),
        () => proposeAndSettle(projectId)
      );
      assert.notEqual(res.status, 500, "Adversarial/edge-case input must not crash the route");

      const groupsRes = await fetch(
        `/api/project-plans/${projectId}/groups?project_id=${projectId}`
      );
      assert.ok((groupsRes.body.groups || []).length > 0, "a real group must have persisted");
      for (const group of groupsRes.body.groups || []) {
        assert.notEqual(
          group.review_status,
          "claimed",
          "review_status must never arrive pre-claimed from refinement"
        );
        assert.equal(
          group.review_status,
          "proposed",
          "a freshly-proposed group's review_status must be 'proposed', never the adversarial payload's value"
        );
      }
    });
  });

  describe("E-1…E-3: Basic lifecycle (propose, poll, approve)", () => {
    it("E-1.1 [R]: Uncached unit → POST propose → 409 blocked_coverage_incomplete", async () => {
      const projectId = await seedProjectWithCoverage("e1.1", false);
      const res = await post(`/api/project-plans/${projectId}/groups/propose`, {});
      assert.equal(res.status, 409, "Should return 409 when coverage incomplete");
    });

    it("E-1.2 [R]: Cache unit → POST propose → 202 started", async () => {
      const projectId = await seedProjectWithCoverage("e1.2", true);
      const res = await post(`/api/project-plans/${projectId}/groups/propose`, {});
      assert.equal(res.status, 202, "Should start proposal with complete coverage");
    });

    it("E-1.3 [R]: Spawn pending → second POST → 200 already_running", async () => {
      const projectId = await seedProjectWithCoverage("e1.3", true);
      // Deterministic seeding (see TT-f's comment for why a Promise.all
      // race is unsuitable here) rather than racing two real POSTs.
      await proposeAndSettle(projectId);
      const priorRun = stmts.getLatestValueGroupRun.get(projectId);
      db.prepare(
        "UPDATE value_group_runs SET state = 'in_progress', completed_at = NULL WHERE id = ?"
      ).run(priorRun.id);
      const spawnBefore = spawnCallCount;
      const res = await post(`/api/project-plans/${projectId}/groups/propose`, {});
      assert.equal(res.status, 200, "Duplicate request should return existing run");
      assert.equal(res.body.outcome, "already_running", "Should indicate run is already executing");
      assert.equal(
        spawnCallCount,
        spawnBefore,
        "spawn counter must be unchanged by a duplicate request"
      );
    });

    it("E-1.4 [M]: Poll to completion → all groups refined with fields non-NULL", async () => {
      // BL-16 fix: previously ran entirely under file-wide heuristic mode,
      // so `group.refinement_state` could never be 'refined' and this
      // loop's body never executed (`continue` on every iteration). Now
      // genuinely refines via `withLlmMode`.
      const projectId = await seedProjectWithCoverage("e1.4", true);
      const memberUnitKeys = defaultUnitKeysFor("e1.4");
      const res = await withLlmMode(
        async () =>
          JSON.stringify({
            groups: [
              {
                clusterIndex: 1,
                name: "E1.4 Group",
                summary_sentence: "A real refined summary.",
                rationale: "Same day.",
                memberUnitKeys,
              },
            ],
          }),
        () => proposeAndSettle(projectId)
      );
      assert.equal(res.body.outcome, "started");
      const groupsRes = await fetch(
        `/api/project-plans/${projectId}/groups?project_id=${projectId}`
      );

      assert.ok(groupsRes.body.groups, "Response should include groups");
      const refinedGroups = (groupsRes.body.groups || []).filter(
        (g) => g.refinement_state === "refined"
      );
      assert.ok(
        refinedGroups.length > 0,
        "at least one group must genuinely be refined — otherwise this loop proves nothing"
      );
      for (const group of refinedGroups) {
        assert.ok(group.name !== null, "name should be non-null when refined");
        assert.ok(
          group.summary_sentence !== null,
          "summary_sentence should be non-null when refined"
        );
        assert.ok(group.rationale !== null, "rationale should be non-null when refined");
        assert.ok(Array.isArray(group.members), "members should be an array");
        for (const member of group.members) {
          assert.equal(
            member.availability,
            "available",
            "every member of a freshly-refined, never-drifted group should be 'available'"
          );
        }
        const counts = group.member_availability_counts || {};
        const total =
          (counts.available || 0) + (counts.already_claimed || 0) + (counts.no_longer_in_pool || 0);
        assert.equal(
          total,
          group.members.length,
          "member_availability_counts should sum to the member count"
        );
      }
    });

    it("E-2.1 [R]: Approve/Dismiss → review_status + reviewed_at updated", async () => {
      const projectId = await seedProjectWithCoverage("e2.1", true);
      await proposeAndSettle(projectId);
      const groupsRes = await fetch(
        `/api/project-plans/${projectId}/groups?project_id=${projectId}`
      );
      const groupId = groupsRes.body.groups?.[0]?.id;
      assert.ok(groupId, "A group should exist to approve");

      const approveRes = await post(
        `/api/project-plans/${projectId}/groups/${groupId}/approve`,
        {}
      );
      assert.equal(approveRes.body.review_status, "approved", "review_status should be approved");
      assert.ok(approveRes.body.reviewed_at, "reviewed_at should be set");
    });

    it("E-2.2 [R]: No mutation of value_claims, project_plans, project_plan_items", async () => {
      const projectId = await seedProjectWithCoverage("e2.2", true);

      const beforeClaims = db.prepare("SELECT COUNT(*) as cnt FROM value_claims").get()?.cnt || 0;
      const beforePlans = db.prepare("SELECT COUNT(*) as cnt FROM project_plans").get()?.cnt || 0;
      const beforeItems =
        db.prepare("SELECT COUNT(*) as cnt FROM project_plan_items").get()?.cnt || 0;

      await proposeAndSettle(projectId);

      const afterClaims = db.prepare("SELECT COUNT(*) as cnt FROM value_claims").get()?.cnt || 0;
      const afterPlans = db.prepare("SELECT COUNT(*) as cnt FROM project_plans").get()?.cnt || 0;
      const afterItems =
        db.prepare("SELECT COUNT(*) as cnt FROM project_plan_items").get()?.cnt || 0;

      assert.equal(beforeClaims, afterClaims, "value_claims should not be mutated");
      assert.equal(beforePlans, afterPlans, "project_plans should not be mutated");
      assert.equal(beforeItems, afterItems, "project_plan_items should not be mutated");
    });

    it("E-3 [R]: Unchanged pool → POST again → 200 reused_unchanged, same run.id, spawn=0", async () => {
      const projectId = await seedProjectWithCoverage("e3", true);
      // BL-5: a genuinely reusable prior run requires a real refinement
      // (an all-heuristic pass on a clustering pool lands 'failed', never
      // 'completed' — see TT-e).
      const e3MemberUnitKeys = defaultUnitKeysFor("e3");
      const res1 = await withLlmMode(
        async () =>
          JSON.stringify({
            groups: [
              {
                clusterIndex: 1,
                name: "E3 Group",
                summary_sentence: "Real summary.",
                rationale: "Same day.",
                memberUnitKeys: e3MemberUnitKeys,
              },
            ],
          }),
        () => proposeAndSettle(projectId)
      );
      assert.equal(res1.body.outcome, "started");
      const spawnBefore = spawnCallCount;
      const res2 = await proposeAndSettle(projectId);

      assert.equal(res2.body.outcome, "reused_unchanged", "Unchanged pool should be cached");
      assert.equal(res2.body.run.id, res1.body.run.id, "Should reuse same run ID");
      assert.equal(spawnCallCount, spawnBefore, "no spawn should occur on a cache hit");
    });

    it("E-4 [N]: POST /groups/:id/review with body → 404 (no generic route)", async () => {
      const res = await post(`/api/project-plans/test-proj/groups/123/review`, {
        status: "approved",
      });
      assert.equal(res.status, 404, "Generic /review route should not exist (DEC-S3-9)");
    });
  });

  describe("E-4.1…E-6, RT-1…RT-3: Advanced scenarios", () => {
    it("RT-1 [R]: Round-trip — distinct values in stub response match GET exactly, field-by-field", async () => {
      const projectId = await seedProjectWithCoverage("rt1", true);
      const memberUnitKeys = defaultUnitKeysFor("rt1");
      const res = await withLlmMode(
        async () =>
          JSON.stringify({
            groups: [
              {
                clusterIndex: 1,
                name: "RT1 Distinct Name",
                summary_sentence: "RT1 distinct summary sentence.",
                rationale: "RT1 distinct rationale.",
                memberUnitKeys,
              },
            ],
          }),
        () => proposeAndSettle(projectId)
      );
      assert.equal(res.body.outcome, "started");
      const getRes = await fetch(`/api/project-plans/${projectId}/groups?project_id=${projectId}`);
      // BL-13: the propose response's own `run` is a snapshot taken
      // immediately after the row is inserted (`in_progress` — the pass
      // hasn't run yet at that instant, by design), so it is never
      // byte-identical to the LATER, now-terminal `GET` snapshot
      // `proposeAndSettle` waited for — same row (same id), different
      // point in time. Assert identity, not full-object equality.
      assert.equal(
        getRes.body.run.id,
        res.body.run.id,
        "GET should return the SAME run (same id) the propose response started"
      );
      assert.notEqual(
        getRes.body.run.state,
        "in_progress",
        "by the time GET is polled, the run must have reached a terminal state"
      );

      const refined = (getRes.body.groups || []).find((g) => g.refinement_state === "refined");
      assert.ok(refined, "a refined group must exist");
      assert.equal(refined.name, "RT1 Distinct Name");
      assert.equal(refined.summary_sentence, "RT1 distinct summary sentence.");
      assert.equal(refined.rationale, "RT1 distinct rationale.");
    });

    it("RT-2 [R]: Update → Get: approve then GET, verify review_status/reviewed_at changed only", async () => {
      const projectId = await seedProjectWithCoverage("rt2", true);
      await proposeAndSettle(projectId);
      const getRes = await fetch(`/api/project-plans/${projectId}/groups?project_id=${projectId}`);
      const groupId = getRes.body.groups?.[0]?.id;
      assert.ok(groupId, "A group should exist to approve");

      await post(`/api/project-plans/${projectId}/groups/${groupId}/approve`, {});
      const afterRes = await fetch(
        `/api/project-plans/${projectId}/groups?project_id=${projectId}`
      );
      const group = afterRes.body.groups?.find((g) => g.id === groupId);

      assert.equal(group.review_status, "approved", "review_status should change");
      assert.ok(group.reviewed_at, "reviewed_at should be set");
    });

    it("RT-3 [R]: No prompt-scaffolding leak in refined rows (no CLUSTER/[trunk_commit] in text)", async () => {
      // BL-16 fix: genuinely refined rows this time — the old version ran
      // entirely under heuristic mode, so `refinement_state !== "refined"`
      // on every group and the loop's `continue` never ran its body.
      const projectId = await seedProjectWithCoverage("rt3", true);
      const memberUnitKeys = defaultUnitKeysFor("rt3");
      const res = await withLlmMode(
        async () =>
          JSON.stringify({
            groups: [
              {
                clusterIndex: 1,
                name: "RT3 Clean Name",
                summary_sentence: "A clean summary with no scaffolding.",
                rationale: "A clean rationale.",
                memberUnitKeys,
              },
            ],
          }),
        () => proposeAndSettle(projectId)
      );
      assert.equal(res.body.outcome, "started");
      const getRes = await fetch(`/api/project-plans/${projectId}/groups?project_id=${projectId}`);

      const refinedGroups = (getRes.body.groups || []).filter(
        (g) => g.refinement_state === "refined"
      );
      assert.ok(refinedGroups.length > 0, "at least one group must genuinely be refined");
      for (const group of refinedGroups) {
        assert.ok(
          !group.name?.includes("CLUSTER") && !group.name?.includes("[trunk_commit]"),
          "name should not contain prompt scaffolding"
        );
        assert.ok(
          !group.summary_sentence?.includes("CLUSTER") && !group.rationale?.includes("CLUSTER"),
          "summary/rationale should not contain prompt scaffolding"
        );
      }
    });

    it("E-4.1…E-4.4 [R]: Hierarchical decomposition — 45 units across 3 days, 2 batches, a genuine rollup merge", async () => {
      // BL-16 fix: previously seeded the DEFAULT 3-unit fixture and
      // asserted only that `run` exists and `batch_count !== undefined` —
      // this is exactly the gap that let BL-2 (rollupGroups positional
      // mis-assignment) ship with a fully green suite. Now: a real 45-unit,
      // 3-day pool (21/21/3), forcing packBatches into TWO real batches
      // (21 + 21 > MAX_UNITS_PER_GROUPING_PROMPT=40, so day 1 is its own
      // batch; day2+day3 share the second), and a rollup stub that
      // genuinely MERGES two of the three leaf groups — closing the gap.
      assert.ok(
        MAX_UNITS_PER_GROUPING_PROMPT === 40,
        "fixture sizing assumes the documented 40-unit budget"
      );
      const day1Refs = Array.from({ length: 21 }, (_, i) => `e4-d1-${i}`);
      const day2Refs = Array.from({ length: 21 }, (_, i) => `e4-d2-${i}`);
      const day3Refs = Array.from({ length: 3 }, (_, i) => `e4-d3-${i}`);
      const { localDayLabel } = require("../lib/focus-summary");
      const { projectId, dayKeys } = await seedLargePoolAcrossDays("e4", [
        day1Refs,
        day2Refs,
        day3Refs,
      ]);
      const dayAnchors = [
        localDayLabel(new Date("2026-08-06T09:00:00.000Z").getTime()),
        localDayLabel(new Date("2026-08-07T09:00:00.000Z").getTime()),
        localDayLabel(new Date("2026-08-08T09:00:00.000Z").getTime()),
      ];
      const dayNames = ["Day1 Group", "Day2 Group", "Day3 Group"];

      // The stub is deliberately ORDER-INDEPENDENT — it never assumes which
      // day's cluster lands in which batch, or in which position: which
      // cluster(s) `pool assembly`/`mechanicalPreGroup` puts into which
      // batch is an implementation detail this test must not pin. Instead
      // it reads each real prompt's own `CLUSTER <n> (signal=time,
      // anchor=<realDayLabel>)` lines to discover, per call, which day(s)
      // are being asked about and at which cluster index.
      let batchCallIdx = 0;
      const res = await withLlmMode(
        async (prompt) => {
          batchCallIdx += 1;
          if (prompt.includes("Merge any two entries")) {
            // The rollup prompt lists `${i+1}. ${name} — ...` per leaf
            // group — merge "Day1 Group" and "Day2 Group" by NAME
            // (whatever list position they actually land at), leaving
            // "Day3 Group" distinct.
            const idxOf = (name) => {
              const m = prompt.match(new RegExp(`(\\d+)\\. ${name} —`));
              assert.ok(m, `rollup prompt should list "${name}"`);
              return Number(m[1]);
            };
            return JSON.stringify({ merges: [[idxOf("Day1 Group"), idxOf("Day2 Group")]] });
          }
          const groups = [];
          dayAnchors.forEach((anchor, dayIdx) => {
            const m = prompt.match(
              new RegExp(`CLUSTER (\\d+) \\(signal=time, anchor=${anchor}\\)`)
            );
            if (m) {
              groups.push({
                clusterIndex: Number(m[1]),
                name: dayNames[dayIdx],
                summary_sentence: `Day ${dayIdx + 1} work.`,
                rationale: "Same day.",
                memberUnitKeys: dayKeys[dayIdx],
              });
            }
          });
          assert.ok(
            groups.length > 0,
            "every non-rollup call should be asking about at least one known day cluster"
          );
          return JSON.stringify({ groups });
        },
        () => proposeAndSettle(projectId)
      );
      assert.equal(res.body.outcome, "started", "Should create run for large pool");
      const run = stmts.getValueGroupRun.get(res.body.run.id);

      // E-4.2: batch_count > 1, spawn called exactly batch_count + 1 times
      // (each batch plus one rollup).
      assert.ok(run.batch_count > 1, "Should track batch_count > 1 for a genuinely batched pool");
      assert.equal(
        batchCallIdx,
        run.batch_count + 1,
        "spawn must be called exactly batch_count + 1 times (batches + one rollup)"
      );

      const groupsRes = await fetch(
        `/api/project-plans/${projectId}/groups?project_id=${projectId}`
      );
      const groups = groupsRes.body.groups || [];

      // E-4.3: no cluster split across batches, checked against the
      // fixture's known membership — and the rollup's merge is REAL: day1
      // and day2's groups are merged into ONE persisted row (not two, and
      // not zero — BL-2's exact failure mode), day3 stays its own row.
      assert.equal(
        groups.length,
        2,
        "the rollup must have merged day1+day2 into ONE row, leaving day3 distinct — never 3 (no merge) or 1 (over-merge/corruption)"
      );
      const mergedGroup = groups.find(
        (g) => (g.members || []).length === dayKeys[0].length + dayKeys[1].length
      );
      assert.ok(mergedGroup, "one group must carry the exact union of day1+day2 members");
      const day1And2Keys = new Set([...dayKeys[0], ...dayKeys[1]]);
      const mergedMemberKeys = new Set(mergedGroup.members.map((m) => m.unitKey));
      assert.deepEqual(
        [...mergedMemberKeys].sort(),
        [...day1And2Keys].sort(),
        "the merged group's members must be exactly the union of day1+day2 — no misattribution, no duplication (BL-2)"
      );

      const day3Group = groups.find((g) => g.id !== mergedGroup.id);
      assert.ok(day3Group, "day3's group must survive as its own row");
      assert.deepEqual(
        day3Group.members.map((m) => m.unitKey).sort(),
        [...dayKeys[2]].sort(),
        "day3's group must carry exactly its own members, untouched by the merge"
      );

      // E-4.4: AC-3 accounting identity.
      assert.equal(
        run.ungrouped_no_signal,
        0,
        "every unit belongs to a day-cluster (>=2 members each) — nothing should be ungrouped for lack of signal"
      );
      const totalMembers = groups.reduce((sum, g) => sum + (g.members || []).length, 0);
      assert.equal(
        run.ungrouped_no_signal + run.ungrouped_not_selected + totalMembers,
        45,
        "AC-3 identity: ungrouped_no_signal + ungrouped_not_selected + Σ member_count must equal pool_size"
      );
    });

    it("E-6 [M]: Read-time drift — member availability changes during lifecycle (partition invariant)", async () => {
      const projectId = await seedProjectWithCoverage("e6", true);
      await proposeAndSettle(projectId);
      const getRes = await fetch(`/api/project-plans/${projectId}/groups?project_id=${projectId}`);

      for (const group of getRes.body.groups || []) {
        const counts = group.member_availability_counts || {};
        const totalCount =
          (counts.available || 0) + (counts.already_claimed || 0) + (counts.no_longer_in_pool || 0);
        const memberCount = group.members?.length || 0;
        assert.equal(totalCount, memberCount, "Availability counts should partition member list");
      }
    });

    it("E-6.4/E-6.5 [M]: Drift #2 injected AFTER the GET (before approve) — approve is pure bookkeeping even under drift", async () => {
      // 4-unit A/B/C/D fixture (seedProjectWithCoverage's `refs` override),
      // matching test-plan.md E-6.1's shape, so the "member D" referenced
      // in E-6.4/E-6.5 is a real, distinct unit rather than a coincidence
      // of the default 3-unit fixture.
      const suffix = "e6-45";
      const refs = ["det-e6-a", "det-e6-b", "det-e6-c", "det-e6-d"];
      const cwd = `/tmp/vg-test-cwd-${suffix}`;
      const projectId = await seedProjectWithCoverage(suffix, true, refs);

      await proposeAndSettle(projectId);

      const dRow = db
        .prepare("SELECT id FROM detour_dispositions WHERE cwd = ? AND source_ref = ?")
        .get(cwd, "det-e6-d");
      const memberDKey = { value_source: "detour", value_ref: String(dRow.id) };

      const getRes1 = await fetch(`/api/project-plans/${projectId}/groups?project_id=${projectId}`);
      const group = (getRes1.body.groups || [])[0];
      assert.ok(group, "a group should exist to carry the 4-member A/B/C/D fixture");
      assert.equal(
        group.members?.length,
        4,
        "all 4 seeded units should be members before any drift"
      );
      const memberDBefore = group.members.find(
        (m) => m.value_source === memberDKey.value_source && m.value_ref === memberDKey.value_ref
      );
      assert.ok(memberDBefore, "member D should be present in the group");
      assert.equal(
        memberDBefore.availability,
        "available",
        "member D should read as available before the second (post-read) drift"
      );

      // ── E-6.4: Drift #2, injected AFTER the GET above and BEFORE
      // approve — an out-of-band claim on member D, which was still
      // `available` after the first GET. Models a claim landing in the
      // gap between the user viewing the proposal and clicking approve. ──
      const planInfo = stmts.insertProjectPlan.run(
        projectId,
        "E-6.4 drift plan",
        "open",
        null,
        "manual",
        null,
        null
      );
      const planId = planInfo.lastInsertRowid;
      const itemInfo = db
        .prepare("INSERT INTO project_plan_items (plan_id, text, position) VALUES (?, ?, 0)")
        .run(planId, "E-6.4 drift item");
      stmts.insertValueClaim.run(
        projectId,
        planId,
        itemInfo.lastInsertRowid,
        memberDKey.value_source,
        memberDKey.value_ref,
        cwd,
        null,
        null,
        null,
        "judgment",
        "human"
      );

      const getRes2 = await fetch(`/api/project-plans/${projectId}/groups?project_id=${projectId}`);
      const groupAfterDrift = (getRes2.body.groups || []).find((g) => g.id === group.id);
      const memberDAfterDrift = groupAfterDrift.members.find(
        (m) => m.value_source === memberDKey.value_source && m.value_ref === memberDKey.value_ref
      );
      assert.equal(
        memberDAfterDrift.availability,
        "already_claimed",
        "E-6.4: the second, post-read drift claim on D must be reflected as already_claimed"
      );

      // ── E-6.5: approve under drift is still pure bookkeeping — 200, no
      // error, review_status flips, and the drifted member D is NOT
      // silently dropped from value_group_members. ──
      const approveRes = await post(
        `/api/project-plans/${projectId}/groups/${group.id}/approve`,
        {}
      );
      assert.equal(
        approveRes.status,
        200,
        "E-6.5: approve under drift should return 200, not error"
      );
      assert.equal(
        approveRes.body.review_status,
        "approved",
        "E-6.5: approve under drift should still flip review_status to approved"
      );

      const getRes3 = await fetch(`/api/project-plans/${projectId}/groups?project_id=${projectId}`);
      const groupAfterApprove = (getRes3.body.groups || []).find((g) => g.id === group.id);
      assert.equal(
        groupAfterApprove.members?.length,
        4,
        "E-6.5: approve must not silently drop the drifted member — all 4 members must still be present"
      );
      const memberDAfterApprove = groupAfterApprove.members.find(
        (m) => m.value_source === memberDKey.value_source && m.value_ref === memberDKey.value_ref
      );
      assert.equal(
        memberDAfterApprove.availability,
        "already_claimed",
        "E-6.5: D's availability should still reflect the drift after approve (bookkeeping only, no pruning)"
      );
      const counts = groupAfterApprove.member_availability_counts || {};
      const totalCount =
        (counts.available || 0) + (counts.already_claimed || 0) + (counts.no_longer_in_pool || 0);
      assert.equal(
        totalCount,
        groupAfterApprove.members.length,
        "E-6.5: the partition invariant should still hold post-approve"
      );
    });
  });
});
