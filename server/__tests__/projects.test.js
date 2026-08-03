/**
 * @file Tests for the Projects router: CRUD validation, folder (cwd) mapping
 * uniqueness, aggregated session-count/active-count/last-activity stats per
 * project, the unassigned-cwd bucket for sessions not yet mapped to any
 * project, and the POST /:id/open-terminal action's single-folder-vs-picker
 * branching plus its typed-code → HTTP-status mapping (the actual AppleScript
 * call is stubbed via `terminalFocus.openTerminalForCwd` — see
 * server/__tests__/terminal-focus.test.js for that function's own unit
 * coverage).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const { execFileSync } = require("child_process");

const TEST_DB = path.join(os.tmpdir(), `dashboard-projects-test-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");
const terminalFocus = require("../lib/terminal-focus");

const realOpenTerminalForCwd = terminalFocus.openTerminalForCwd;

let server;
let BASE;

function fetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...options.headers },
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
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function post(urlPath, body) {
  return fetch(urlPath, { method: "POST", body });
}

function patch(urlPath, body) {
  return fetch(urlPath, { method: "PATCH", body });
}

function del(urlPath) {
  return fetch(urlPath, { method: "DELETE" });
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  const addr = server.address();
  BASE = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server?.close();
  try {
    db.close();
  } catch {
    /* already closed */
  }
});

beforeEach(() => {
  terminalFocus.openTerminalForCwd = realOpenTerminalForCwd;
});

// GET /:id/repos and GET /:id/intake do real filesystem/git work (unlike
// the rest of this file's `/tmp/fake-path` strings), so they need an actual
// tmp dir with real repos in it.
const FS_FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "projects-route-fixtures-"));
const ISOLATED_GIT_ENV = { ...process.env };
for (const key of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
]) {
  delete ISOLATED_GIT_ENV[key];
}

// `parent` defaults to the shared FS_FIXTURE_ROOT, but tests whose scan
// results depend on exactly which OTHER repos sit in the same parent
// directory (e.g. the disk-sibling scan) must pass their own dedicated
// parent - otherwise every fixture repo any other test in this file ever
// created under FS_FIXTURE_ROOT is a sibling too, since it accumulates
// across the whole file's test run.
function makeFixtureRepo(name, parent = FS_FIXTURE_ROOT) {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["-c", "init.defaultBranch=master", "init", repo], {
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], {
    cwd: repo,
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: repo,
    stdio: "ignore",
    env: ISOLATED_GIT_ENV,
  });
  return repo;
}

after(() => {
  try {
    fs.rmSync(FS_FIXTURE_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("Project CRUD", () => {
  it("rejects a project without a name", async () => {
    const res = await post("/api/projects", {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("rejects a non-array cwds field", async () => {
    const res = await post("/api/projects", { name: "Bad", cwds: "/not-an-array" });
    assert.equal(res.status, 400);
  });

  it("creates, lists, renames, and deletes a project", async () => {
    const created = await post("/api/projects", { name: "  Dashboard  " });
    assert.equal(created.status, 201);
    const project = created.body.project;
    assert.ok(project.id);
    assert.equal(project.name, "Dashboard"); // trimmed
    assert.deepEqual(project.paths, []);

    const list = await fetch("/api/projects");
    assert.equal(list.status, 200);
    assert.ok(list.body.projects.some((p) => p.id === project.id));

    const renamed = await patch(`/api/projects/${project.id}`, { name: "Renamed" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.project.name, "Renamed");

    const badRename = await patch(`/api/projects/${project.id}`, { name: "" });
    assert.equal(badRename.status, 400);

    const deleted = await del(`/api/projects/${project.id}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);

    const listAfter = await fetch("/api/projects");
    assert.ok(!listAfter.body.projects.some((p) => p.id === project.id));
  });

  it("404s on rename/delete of an unknown project", async () => {
    const renamed = await patch("/api/projects/does-not-exist", { name: "x" });
    assert.equal(renamed.status, 404);
    const deleted = await del("/api/projects/does-not-exist");
    assert.equal(deleted.status, 404);
  });

  it("rejects a PATCH with neither name nor pinned", async () => {
    const project = (await post("/api/projects", { name: "Empty Patch" })).body.project;
    const res = await patch(`/api/projects/${project.id}`, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("rejects a non-boolean pinned value", async () => {
    const project = (await post("/api/projects", { name: "Bad Pin" })).body.project;
    const res = await patch(`/api/projects/${project.id}`, { pinned: "yes" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });
});

describe("Pinning", () => {
  it("defaults to unpinned, and pins/unpins via PATCH", async () => {
    const created = await post("/api/projects", { name: "Pin Me" });
    assert.equal(created.body.project.pinned, false);

    const pinned = await patch(`/api/projects/${created.body.project.id}`, { pinned: true });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.body.project.pinned, true);

    const unpinned = await patch(`/api/projects/${created.body.project.id}`, { pinned: false });
    assert.equal(unpinned.status, 200);
    assert.equal(unpinned.body.project.pinned, false);
  });

  it("lists pinned projects first, ahead of alphabetical order", async () => {
    const zebra = (await post("/api/projects", { name: "Zebra Project" })).body.project;
    await post("/api/projects", { name: "Apple Project" });
    await patch(`/api/projects/${zebra.id}`, { pinned: true });

    const list = await fetch("/api/projects");
    const names = list.body.projects.map((p) => p.name);
    assert.equal(names[0], "Zebra Project"); // pinned, despite sorting after "Apple" alphabetically
  });

  it("PATCH can rename and pin in the same request", async () => {
    const project = (await post("/api/projects", { name: "Combo" })).body.project;
    const res = await patch(`/api/projects/${project.id}`, { name: "Combo Renamed", pinned: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.name, "Combo Renamed");
    assert.equal(res.body.project.pinned, true);
  });

  it("creates a project pre-attached to folders", async () => {
    const created = await post("/api/projects", {
      name: "Multi-folder",
      cwds: ["/tmp/proj-a", "/tmp/proj-b", "/tmp/proj-a"], // dup collapses
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.project.paths.length, 2);
    const cwds = created.body.project.paths.map((p) => p.cwd).sort();
    assert.deepEqual(cwds, ["/tmp/proj-a", "/tmp/proj-b"]);
  });
});

describe("Sibling repo scan toggle", () => {
  it("defaults to disabled, and toggles via PATCH", async () => {
    const created = await post("/api/projects", { name: "Scan Me" });
    assert.equal(created.body.project.siblingScanEnabled, false);

    const enabled = await patch(`/api/projects/${created.body.project.id}`, {
      siblingScanEnabled: true,
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.project.siblingScanEnabled, true);

    const disabled = await patch(`/api/projects/${created.body.project.id}`, {
      siblingScanEnabled: false,
    });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.project.siblingScanEnabled, false);
  });

  it("rejects a non-boolean siblingScanEnabled value", async () => {
    const project = (await post("/api/projects", { name: "Bad Scan Flag" })).body.project;
    const res = await patch(`/api/projects/${project.id}`, { siblingScanEnabled: "yes" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("toggling siblingScanEnabled alone does not disturb name or pinned", async () => {
    const project = (await post("/api/projects", { name: "Untouched" })).body.project;
    await patch(`/api/projects/${project.id}`, { pinned: true });

    const res = await patch(`/api/projects/${project.id}`, { siblingScanEnabled: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.name, "Untouched");
    assert.equal(res.body.project.pinned, true);
    assert.equal(res.body.project.siblingScanEnabled, true);
  });

  it("PATCH can rename, pin, and toggle the sibling scan in the same request", async () => {
    const project = (await post("/api/projects", { name: "Combo Scan" })).body.project;
    const res = await patch(`/api/projects/${project.id}`, {
      name: "Combo Scan Renamed",
      pinned: true,
      siblingScanEnabled: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.name, "Combo Scan Renamed");
    assert.equal(res.body.project.pinned, true);
    assert.equal(res.body.project.siblingScanEnabled, true);
  });
});

describe("Folder (cwd) mapping", () => {
  it("a folder can only belong to one project", async () => {
    const a = await post("/api/projects", { name: "A", cwds: ["/tmp/shared"] });
    assert.equal(a.status, 201);

    const b = await post("/api/projects", { name: "B", cwds: ["/tmp/shared"] });
    assert.equal(b.status, 409);
    assert.equal(b.body.error.code, "ALREADY_MAPPED");
    assert.equal(a.body.project.paths.length, 1); // A's mapping is untouched
  });

  it("adds and removes a folder mapping", async () => {
    const project = (await post("/api/projects", { name: "Foldered" })).body.project;

    const added = await post(`/api/projects/${project.id}/paths`, { cwd: "/tmp/foldered-a" });
    assert.equal(added.status, 201);
    assert.equal(added.body.project.paths.length, 1);
    const pathId = added.body.project.paths[0].id;

    const dupe = await post(`/api/projects/${project.id}/paths`, { cwd: "/tmp/foldered-a" });
    assert.equal(dupe.status, 409);
    assert.match(dupe.body.error.message, /already part of this project/);

    const removed = await del(`/api/projects/${project.id}/paths/${pathId}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.project.paths.length, 0);

    const removeAgain = await del(`/api/projects/${project.id}/paths/${pathId}`);
    assert.equal(removeAgain.status, 404);
  });

  it("rejects adding a folder without a cwd", async () => {
    const project = (await post("/api/projects", { name: "NoCwd" })).body.project;
    const res = await post(`/api/projects/${project.id}/paths`, {});
    assert.equal(res.status, 400);
  });

  it("a newly-mapped folder defaults to terminalDefault: true in the project list", async () => {
    const project = (
      await post("/api/projects", { name: "Terminal Default", cwds: ["/tmp/terminal-default-a"] })
    ).body.project;

    const list = await fetch("/api/projects");
    const found = list.body.projects.find((p) => p.id === project.id);
    assert.equal(found.paths.length, 1);
    assert.equal(found.paths[0].terminalDefault, true);
  });

  it("creating a project with several cwds at once only defaults the first to terminalDefault: true", async () => {
    const project = (
      await post("/api/projects", {
        name: "Multi Create Default",
        cwds: ["/tmp/multi-create-1", "/tmp/multi-create-2", "/tmp/multi-create-3"],
      })
    ).body.project;

    assert.equal(project.paths.length, 3);
    const byCwd = Object.fromEntries(project.paths.map((p) => [p.cwd, p.terminalDefault]));
    assert.equal(byCwd["/tmp/multi-create-1"], true);
    assert.equal(byCwd["/tmp/multi-create-2"], false);
    assert.equal(byCwd["/tmp/multi-create-3"], false);
  });

  it("adding folders one at a time: only the very first ever mapped folder defaults to terminalDefault: true", async () => {
    const project = (await post("/api/projects", { name: "Sequential Adds" })).body.project;

    const first = await post(`/api/projects/${project.id}/paths`, { cwd: "/tmp/sequential-1" });
    assert.equal(
      first.body.project.paths.find((p) => p.cwd === "/tmp/sequential-1").terminalDefault,
      true
    );

    const second = await post(`/api/projects/${project.id}/paths`, { cwd: "/tmp/sequential-2" });
    const secondPaths = second.body.project.paths;
    assert.equal(secondPaths.find((p) => p.cwd === "/tmp/sequential-1").terminalDefault, true);
    assert.equal(secondPaths.find((p) => p.cwd === "/tmp/sequential-2").terminalDefault, false);

    const third = await post(`/api/projects/${project.id}/paths`, { cwd: "/tmp/sequential-3" });
    assert.equal(
      third.body.project.paths.find((p) => p.cwd === "/tmp/sequential-3").terminalDefault,
      false
    );
  });
});

describe("PATCH /:id/paths/:pathId (terminalDefault)", () => {
  it("toggles terminalDefault off then on, reflected in the recomputed topology and the project list", async () => {
    const project = (
      await post("/api/projects", { name: "Toggle Terminal", cwds: ["/tmp/toggle-terminal-a"] })
    ).body.project;
    const pathId = project.paths[0].id;

    const off = await patch(`/api/projects/${project.id}/paths/${pathId}`, {
      terminalDefault: false,
    });
    assert.equal(off.status, 200);
    assert.equal(off.body.project_id, project.id);
    const offFolder = [...off.body.repos, ...off.body.nonRepoFolders].find(
      (f) => f.pathId === pathId
    );
    assert.equal(offFolder.terminalDefault, false);

    const listAfterOff = await fetch("/api/projects");
    const foundOff = listAfterOff.body.projects.find((p) => p.id === project.id);
    assert.equal(foundOff.paths[0].terminalDefault, false);

    const on = await patch(`/api/projects/${project.id}/paths/${pathId}`, {
      terminalDefault: true,
    });
    assert.equal(on.status, 200);
    const onFolder = [...on.body.repos, ...on.body.nonRepoFolders].find((f) => f.pathId === pathId);
    assert.equal(onFolder.terminalDefault, true);
  });

  it("404 for a project that doesn't exist", async () => {
    const res = await patch("/api/projects/does-not-exist/paths/1", { terminalDefault: false });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("404 when pathId doesn't belong to the project", async () => {
    const project = (await post("/api/projects", { name: "Wrong Path Owner" })).body.project;
    const res = await patch(`/api/projects/${project.id}/paths/999999`, {
      terminalDefault: false,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("400 INVALID_INPUT when pathId isn't an integer", async () => {
    const project = (await post("/api/projects", { name: "Bad Path Id" })).body.project;
    const res = await patch(`/api/projects/${project.id}/paths/not-a-number`, {
      terminalDefault: false,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("400 INVALID_INPUT when terminalDefault isn't a boolean", async () => {
    const project = (
      await post("/api/projects", { name: "Bad Terminal Default", cwds: ["/tmp/bad-td"] })
    ).body.project;
    const res = await patch(`/api/projects/${project.id}/paths/${project.paths[0].id}`, {
      terminalDefault: "nope",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });
});

describe("Aggregated session stats", () => {
  it("sums session/active counts and tracks last_activity across a project's folders, and buckets unmapped cwds as unassigned", async () => {
    const project = (
      await post("/api/projects", { name: "Stats Project", cwds: ["/tmp/stats-a", "/tmp/stats-b"] })
    ).body.project;

    stmts.insertSession.run("stats-1", "s1", "active", "/tmp/stats-a", "claude-opus-4-8", null);
    stmts.insertSession.run("stats-2", "s2", "completed", "/tmp/stats-a", "claude-opus-4-8", null);
    stmts.insertSession.run("stats-3", "s3", "active", "/tmp/stats-b", "claude-opus-4-8", null);
    stmts.insertSession.run(
      "stats-unassigned",
      "s4",
      "active",
      "/tmp/stats-unmapped",
      "claude-opus-4-8",
      null
    );

    const list = await fetch("/api/projects");
    assert.equal(list.status, 200);
    const found = list.body.projects.find((p) => p.id === project.id);
    assert.ok(found);
    assert.equal(found.session_count, 3);
    assert.equal(found.active_count, 2);
    assert.ok(found.last_activity);

    assert.ok(list.body.unassigned.cwds.includes("/tmp/stats-unmapped"));
    assert.ok(!list.body.unassigned.cwds.includes("/tmp/stats-a"));
    assert.ok(!list.body.unassigned.cwds.includes("/tmp/stats-b"));
  });
});

describe("GET /:id/focus-report", () => {
  const CWD = "/tmp/focus-report-route-test";
  const insertFocusEventRaw = db.prepare(
    "INSERT INTO events (session_id, agent_id, event_type, tool_name, summary, data, created_at) VALUES (?, NULL, 'Focus', NULL, ?, ?, ?)"
  );
  function t(minutesFromStart) {
    return new Date(Date.UTC(2026, 0, 1) + minutesFromStart * 60_000).toISOString();
  }
  function focus(sessionId, minute, data) {
    insertFocusEventRaw.run(sessionId, "focus test", JSON.stringify(data), t(minute));
  }

  it("404s for an unknown project", async () => {
    const res = await fetch("/api/projects/does-not-exist/focus-report");
    assert.equal(res.status, 404);
  });

  it("returns well-shaped empty totals for a project with no mapped folders", async () => {
    const created = await post("/api/projects", { name: "No folders" });
    const res = await fetch(`/api/projects/${created.body.project.id}/focus-report`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.sessions, []);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.totals.wall_ms, 0);
    assert.ok(res.body.totals.by_kind.item);
    assert.ok(typeof res.body.idle_grace_seconds === "number");
  });

  it("scopes the report to only the clicked project's sessions, and rolls a bug detour up under its item", async () => {
    process.env.DASHBOARD_FOCUS_IDLE_GRACE_SECONDS = "0"; // isolate from idle discounting
    stmts.upsertPlan.run(CWD, "Report route test plan", `${CWD}/AGENT-PLAN.md`, "hash", 1);
    stmts.upsertPlanItem.run(CWD, "item-4", 4, null, "Shared Backend", null, null, 0, 0);

    const created = await post("/api/projects", { name: "Report Route Test", cwds: [CWD] });
    const projectId = created.body.project.id;

    stmts.insertSession.run("report-route-1", "In project", "active", CWD, "claude-opus-4-8", null);
    stmts.insertSession.run(
      "report-route-2",
      "Outside project",
      "active",
      "/tmp/focus-report-route-OTHER",
      "claude-opus-4-8",
      null
    );

    focus("report-route-1", 0, {
      verb: "set",
      item_number: 4,
      item_text_snapshot: "Shared Backend",
    });
    focus("report-route-1", 20, {
      verb: "bug",
      kind: "bug",
      title: "npm conflict",
      description: "npm conflict",
    });
    focus("report-route-1", 35, { verb: "pop", description: "npm conflict" });
    // Closes the segment deterministically instead of leaving it open to
    // "now" (the session's real `ended_at` is NULL - still "active" - so an
    // unclosed segment would otherwise span from minute 35 to whenever this
    // test happens to run, making the assertions below flaky).
    focus("report-route-1", 35, {
      verb: "done",
      item_number: 4,
      item_text_snapshot: "Shared Backend",
    });
    // Never declared any focus for report-route-2 - it must not appear.

    const res = await fetch(`/api/projects/${projectId}/focus-report`);
    assert.equal(res.status, 200);
    assert.equal(res.body.project_id, projectId);
    assert.equal(res.body.sessions.length, 1);
    assert.equal(res.body.sessions[0].session_id, "report-route-1");

    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].item_number, 4);
    assert.equal(res.body.items[0].text, "Shared Backend");
    assert.equal(res.body.items[0].totals.by_kind.bug.wall_ms, 15 * 60_000);

    assert.equal(res.body.totals.by_kind.bug.wall_ms, 15 * 60_000);
    assert.equal(res.body.totals.by_kind.item.wall_ms, 20 * 60_000);
  });
});

describe("POST /:id/open-terminal", () => {
  it("404 for a project that doesn't exist", async () => {
    const res = await post("/api/projects/does-not-exist/open-terminal", {});
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("409 NO_FOLDERS for a project with no mapped folders", async () => {
    const created = await post("/api/projects", { name: "No Folders Yet" });
    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "NO_FOLDERS");
  });

  it("opens the single mapped folder directly, no cwd required in the body", async () => {
    const created = await post("/api/projects", {
      name: "Single Folder Project",
      cwds: ["/tmp/single-folder-project"],
    });
    let seen;
    terminalFocus.openTerminalForCwd = (cwd) => {
      seen = cwd;
      return { ok: true };
    };
    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(seen, "/tmp/single-folder-project");
  });

  it("400 INVALID_INPUT when a multi-folder project's open request omits cwd", async () => {
    const created = await post("/api/projects", {
      name: "Multi Folder Project A",
      cwds: ["/tmp/multi-a-1", "/tmp/multi-a-2"],
    });
    // Only the first folder defaults to terminalDefault: true on creation -
    // re-enable the second so this test exercises the "which one?" 400, not
    // the single-eligible-folder short-circuit.
    await patch(
      `/api/projects/${created.body.project.id}/paths/${created.body.project.paths[1].id}`,
      {
        terminalDefault: true,
      }
    );
    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("400 INVALID_INPUT when the requested cwd isn't one of the project's own folders", async () => {
    const created = await post("/api/projects", {
      name: "Multi Folder Project B",
      cwds: ["/tmp/multi-b-1", "/tmp/multi-b-2"],
    });
    await patch(
      `/api/projects/${created.body.project.id}/paths/${created.body.project.paths[1].id}`,
      {
        terminalDefault: true,
      }
    );
    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {
      cwd: "/tmp/not-a-mapped-folder",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("opens the requested folder when it's one of a multi-folder project's own paths", async () => {
    const created = await post("/api/projects", {
      name: "Multi Folder Project C",
      cwds: ["/tmp/multi-c-1", "/tmp/multi-c-2"],
    });
    await patch(
      `/api/projects/${created.body.project.id}/paths/${created.body.project.paths[1].id}`,
      {
        terminalDefault: true,
      }
    );
    let seen;
    terminalFocus.openTerminalForCwd = (cwd) => {
      seen = cwd;
      return { ok: true };
    };
    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {
      cwd: "/tmp/multi-c-2",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(seen, "/tmp/multi-c-2");
  });

  it("409 NO_FOLDERS when a project's only mapped folder has terminalDefault off", async () => {
    const created = await post("/api/projects", {
      name: "Excluded Single Folder",
      cwds: ["/tmp/excluded-single"],
    });
    const pathId = created.body.project.paths[0].id;
    await patch(`/api/projects/${created.body.project.id}/paths/${pathId}`, {
      terminalDefault: false,
    });

    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "NO_FOLDERS");
  });

  it("400 INVALID_INPUT when the requested cwd's folder has terminalDefault off, even with other eligible folders left", async () => {
    const created = await post("/api/projects", {
      name: "Multi Folder Excluded",
      cwds: ["/tmp/multi-excl-1", "/tmp/multi-excl-2", "/tmp/multi-excl-3"],
    });
    // Only /tmp/multi-excl-1 (the first) defaults to eligible - explicitly
    // re-enable the third too, so /tmp/multi-excl-1 and /tmp/multi-excl-3
    // remain eligible and this stays a real picker choice (not the
    // single-eligible-folder short-circuit); /tmp/multi-excl-2 stays
    // excluded on its own default.
    const excl3PathId = created.body.project.paths.find((p) => p.cwd === "/tmp/multi-excl-3").id;
    await patch(`/api/projects/${created.body.project.id}/paths/${excl3PathId}`, {
      terminalDefault: true,
    });

    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {
      cwd: "/tmp/multi-excl-2",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("opens the one remaining eligible folder directly once the other is excluded", async () => {
    const created = await post("/api/projects", {
      name: "Multi Folder Down To One",
      cwds: ["/tmp/multi-down-1", "/tmp/multi-down-2"],
    });
    const excludedPathId = created.body.project.paths.find((p) => p.cwd === "/tmp/multi-down-2").id;
    await patch(`/api/projects/${created.body.project.id}/paths/${excludedPathId}`, {
      terminalDefault: false,
    });

    let seen;
    terminalFocus.openTerminalForCwd = (cwd) => {
      seen = cwd;
      return { ok: true };
    };
    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {});
    assert.equal(res.status, 200);
    assert.equal(seen, "/tmp/multi-down-1");
  });

  it("maps each typed failure code to its documented HTTP status", async () => {
    const created = await post("/api/projects", {
      name: "Status Mapping Project",
      cwds: ["/tmp/status-mapping-project"],
    });
    const cases = [
      ["UNSUPPORTED_PLATFORM", 501],
      ["NO_CWD", 409],
      ["AUTOMATION_ERROR", 500],
    ];
    for (const [code, status] of cases) {
      terminalFocus.openTerminalForCwd = () => ({ ok: false, code, message: `msg:${code}` });
      const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {});
      assert.equal(res.status, status, `${code} should map to ${status}`);
      assert.equal(res.body.error.code, code);
    }
  });
});

describe("POST /:id/continue-worktree", () => {
  it("404 for a project that doesn't exist", async () => {
    const res = await post("/api/projects/does-not-exist/continue-worktree", {
      path: "/tmp/whatever",
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("400 INVALID_INPUT when path is missing", async () => {
    const created = await post("/api/projects", { name: "Continue No Path" });
    const res = await post(`/api/projects/${created.body.project.id}/continue-worktree`, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("400 INVALID_INPUT when path isn't a live worktree of any of the project's mapped repos", async () => {
    const repo = makeFixtureRepo("continue-worktree-not-a-worktree");
    const created = await post("/api/projects", {
      name: "Continue Bad Path",
      cwds: [repo],
    });
    const res = await post(`/api/projects/${created.body.project.id}/continue-worktree`, {
      path: "/tmp/not-a-real-worktree",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("opens the worktree with a fresh session (never -c) and a resume prompt built from its branch/dirty state", async () => {
    const repo = makeFixtureRepo("continue-worktree-clean-repo");
    const created = await post("/api/projects", {
      name: "Continue Clean Repo",
      cwds: [repo],
    });
    // `path` must be the worktree path exactly as `/repos` reports it (git
    // may canonicalize it, e.g. resolving a macOS /var -> /private/var
    // symlink) - not the raw `repo` fixture string - since that's what the
    // real client always sends (it only ever has a worktree's own `.path`
    // from a prior `/repos` response, never an independently-typed path).
    const repos = await fetch(`/api/projects/${created.body.project.id}/repos`);
    const worktreePath = repos.body.repos[0].worktrees[0].path;

    let seenCwd, seenName, seenPrompt;
    terminalFocus.openTerminalForCwd = (cwd, name, prompt) => {
      seenCwd = cwd;
      seenName = name;
      seenPrompt = prompt;
      return { ok: true };
    };

    const res = await post(`/api/projects/${created.body.project.id}/continue-worktree`, {
      path: worktreePath,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(seenCwd, worktreePath);
    assert.equal(seenName, undefined);
    assert.match(seenPrompt, /branch `master`/);
    assert.match(seenPrompt, /currently clean/);
    assert.match(seenPrompt, /git status/);
    // Never silently resumes a prior conversation for this directory - see
    // openTerminalForCwd's doc comment for why that's considered unsafe.
    assert.doesNotMatch(seenPrompt, /-c\b/);
    assert.doesNotMatch(seenPrompt, /--continue/);
  });

  it("names the branch in the prompt from a real worktree add, and forwards an optional name", async () => {
    const repo = makeFixtureRepo("continue-worktree-with-worktree");
    const addedWorktreePath = path.join(FS_FIXTURE_ROOT, "continue-worktree-linked");
    execFileSync("git", ["worktree", "add", "-b", "feature/resume-me", addedWorktreePath], {
      cwd: repo,
      stdio: "ignore",
      env: ISOLATED_GIT_ENV,
    });
    // checkWorktreeDirty runs `git status` with `-uno` (untracked files
    // excluded), so a dirty worktree here needs a modified TRACKED file, not
    // just a new untracked one.
    fs.appendFileSync(path.join(addedWorktreePath, "README.md"), "uncommitted change\n");

    const created = await post("/api/projects", {
      name: "Continue Linked Worktree",
      cwds: [repo],
    });
    const repos = await fetch(`/api/projects/${created.body.project.id}/repos`);
    const worktreePath = repos.body.repos[0].worktrees.find(
      (w) => w.branch === "refs/heads/feature/resume-me"
    ).path;

    let seenCwd, seenName, seenPrompt;
    terminalFocus.openTerminalForCwd = (cwd, name, prompt) => {
      seenCwd = cwd;
      seenName = name;
      seenPrompt = prompt;
      return { ok: true };
    };

    const res = await post(`/api/projects/${created.body.project.id}/continue-worktree`, {
      path: worktreePath,
      name: "resume-effort",
    });
    assert.equal(res.status, 200);
    assert.equal(seenCwd, worktreePath);
    assert.equal(seenName, "resume-effort");
    assert.match(seenPrompt, /branch `feature\/resume-me`/);
    assert.match(seenPrompt, /uncommitted changes/);
  });

  it("maps each typed failure code to its documented HTTP status", async () => {
    const repo = makeFixtureRepo("continue-worktree-status-mapping");
    const created = await post("/api/projects", {
      name: "Continue Status Mapping",
      cwds: [repo],
    });
    const repos = await fetch(`/api/projects/${created.body.project.id}/repos`);
    const worktreePath = repos.body.repos[0].worktrees[0].path;
    const cases = [
      ["UNSUPPORTED_PLATFORM", 501],
      ["NO_CWD", 409],
      ["AUTOMATION_ERROR", 500],
    ];
    for (const [code, status] of cases) {
      terminalFocus.openTerminalForCwd = () => ({ ok: false, code, message: `msg:${code}` });
      const res = await post(`/api/projects/${created.body.project.id}/continue-worktree`, {
        path: worktreePath,
      });
      assert.equal(res.status, status, `${code} should map to ${status}`);
      assert.equal(res.body.error.code, code);
    }
  });
});

describe("GET /:id/repos", () => {
  it("404 for a project that doesn't exist", async () => {
    const res = await fetch("/api/projects/does-not-exist/repos");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("empty repos/nonRepoFolders/detectedSiblings for a project with no mapped folders", async () => {
    const created = await post("/api/projects", { name: "Repos Empty Project" });
    const res = await fetch(`/api/projects/${created.body.project.id}/repos`);
    assert.equal(res.status, 200);
    assert.equal(res.body.project_id, created.body.project.id);
    assert.deepEqual(res.body.repos, []);
    assert.deepEqual(res.body.nonRepoFolders, []);
    assert.deepEqual(res.body.detectedSiblings, []);
  });

  it("splits a real git repo from a non-git mapped folder and lists the repo's worktree", async () => {
    const repo = makeFixtureRepo("repos-route-real-repo");
    const plainFolder = path.join(FS_FIXTURE_ROOT, "repos-route-plain-folder");
    fs.mkdirSync(plainFolder, { recursive: true });

    const created = await post("/api/projects", {
      name: "Repos Route Project",
      cwds: [repo, plainFolder],
    });

    const res = await fetch(`/api/projects/${created.body.project.id}/repos`);
    assert.equal(res.status, 200);
    assert.equal(res.body.repos.length, 1);
    assert.equal(res.body.repos[0].cwd, repo);
    assert.equal(res.body.repos[0].worktrees.length, 1);
    assert.equal(res.body.repos[0].worktrees[0].dirty, false);
    assert.equal(res.body.nonRepoFolders.length, 1);
    assert.equal(res.body.nonRepoFolders[0].cwd, plainFolder);
  });
});

describe("POST/DELETE /:id/ignored-repos", () => {
  it("404 for a project that doesn't exist", async () => {
    const posted = await post("/api/projects/does-not-exist/ignored-repos", {
      path: "/tmp/x",
      name: "x",
      source: "disk-sibling",
    });
    assert.equal(posted.status, 404);
    const deleted = await del("/api/projects/does-not-exist/ignored-repos/1");
    assert.equal(deleted.status, 404);
  });

  it("400 INVALID_INPUT for a missing path, missing name, or invalid source", async () => {
    const project = (await post("/api/projects", { name: "Ignore Validation" })).body.project;

    const noPath = await post(`/api/projects/${project.id}/ignored-repos`, {
      name: "x",
      source: "disk-sibling",
    });
    assert.equal(noPath.status, 400);

    const noName = await post(`/api/projects/${project.id}/ignored-repos`, {
      path: "/tmp/x",
      source: "disk-sibling",
    });
    assert.equal(noName.status, 400);

    const badSource = await post(`/api/projects/${project.id}/ignored-repos`, {
      path: "/tmp/x",
      name: "x",
      source: "not-a-real-source",
    });
    assert.equal(badSource.status, 400);
  });

  it("ignoring a suggestion removes it from detectedSiblings; un-ignoring brings it back", async () => {
    const parent = path.join(FS_FIXTURE_ROOT, "ignore-route-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeFixtureRepo("ignore-route-main", parent);
    const sibling = makeFixtureRepo("ignore-route-sibling", parent);

    const created = await post("/api/projects", {
      name: "Ignore Route Project",
      cwds: [main],
    });
    const projectId = created.body.project.id;
    // The disk-sibling scan is opt-in (default off) - enable it so `sibling`
    // actually surfaces as a suggestion to ignore/un-ignore.
    await patch(`/api/projects/${projectId}`, { siblingScanEnabled: true });

    const before = await fetch(`/api/projects/${projectId}/repos`);
    assert.equal(before.body.detectedSiblings.length, 1);
    assert.equal(before.body.detectedSiblings[0].path, sibling);
    assert.deepEqual(before.body.ignoredRepos, []);

    const ignored = await post(`/api/projects/${projectId}/ignored-repos`, {
      path: sibling,
      name: "ignore-route-sibling",
      source: before.body.detectedSiblings[0].source,
    });
    assert.equal(ignored.status, 201);
    assert.deepEqual(ignored.body.detectedSiblings, []);
    assert.equal(ignored.body.ignoredRepos.length, 1);
    assert.equal(ignored.body.ignoredRepos[0].path, sibling);
    const ignoredId = ignored.body.ignoredRepos[0].id;

    // A fresh GET (not just the POST's own response) confirms it's actually
    // persisted, not just reflected in the one response.
    const afterIgnore = await fetch(`/api/projects/${projectId}/repos`);
    assert.deepEqual(afterIgnore.body.detectedSiblings, []);
    assert.equal(afterIgnore.body.ignoredRepos.length, 1);

    const unignored = await del(`/api/projects/${projectId}/ignored-repos/${ignoredId}`);
    assert.equal(unignored.status, 200);
    assert.equal(unignored.body.detectedSiblings.length, 1);
    assert.equal(unignored.body.detectedSiblings[0].path, sibling);
    assert.deepEqual(unignored.body.ignoredRepos, []);
  });

  it("404s un-ignoring an id that doesn't exist (or belongs to another project)", async () => {
    const project = (await post("/api/projects", { name: "Ignore 404" })).body.project;
    const res = await del(`/api/projects/${project.id}/ignored-repos/999999`);
    assert.equal(res.status, 404);
  });

  it("re-ignoring the same path is idempotent (updates the row instead of erroring)", async () => {
    const parent = path.join(FS_FIXTURE_ROOT, "ignore-route-idempotent-parent");
    fs.mkdirSync(parent, { recursive: true });
    const main = makeFixtureRepo("ignore-route-idempotent-main", parent);
    const sibling = makeFixtureRepo("ignore-route-idempotent-sibling", parent);
    const created = await post("/api/projects", {
      name: "Ignore Idempotent Project",
      cwds: [main],
    });
    const projectId = created.body.project.id;
    // The disk-sibling scan is opt-in (default off) - enable it so `sibling`
    // actually surfaces as a suggestion to ignore.
    await patch(`/api/projects/${projectId}`, { siblingScanEnabled: true });
    const before = await fetch(`/api/projects/${projectId}/repos`);
    const source = before.body.detectedSiblings[0].source;

    const first = await post(`/api/projects/${projectId}/ignored-repos`, {
      path: sibling,
      name: "ignore-route-idempotent-sibling",
      source,
    });
    assert.equal(first.status, 201);

    const second = await post(`/api/projects/${projectId}/ignored-repos`, {
      path: sibling,
      name: "ignore-route-idempotent-sibling",
      source,
    });
    assert.equal(second.status, 201);
    assert.equal(second.body.ignoredRepos.length, 1); // not two rows
  });
});

describe("GET /:id/intake", () => {
  it("404 for a project that doesn't exist", async () => {
    const res = await fetch("/api/projects/does-not-exist/intake");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("empty initiatives for a project with no mapped folders", async () => {
    const created = await post("/api/projects", { name: "Intake Empty Project" });
    const res = await fetch(`/api/projects/${created.body.project.id}/intake`);
    assert.equal(res.status, 200);
    assert.equal(res.body.project_id, created.body.project.id);
    assert.deepEqual(res.body.initiatives, []);
  });

  it("infers stage from real intake/<slug>/ artifact files under a mapped folder", async () => {
    const cwd = path.join(FS_FIXTURE_ROOT, "intake-route-cwd");
    fs.mkdirSync(path.join(cwd, "intake", "route-item", "qa"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "intake", "route-item", "request-brief.md"), "x");
    fs.writeFileSync(path.join(cwd, "intake", "route-item", "technical-plan.md"), "x");
    fs.writeFileSync(path.join(cwd, "intake", "route-item", "qa", "qa-assessment.md"), "x");

    const created = await post("/api/projects", { name: "Intake Route Project", cwds: [cwd] });
    const res = await fetch(`/api/projects/${created.body.project.id}/intake`);
    assert.equal(res.status, 200);
    assert.equal(res.body.initiatives.length, 1);
    assert.equal(res.body.initiatives[0].slug, "route-item");
    assert.equal(res.body.initiatives[0].stage, "qa");
    assert.equal(res.body.initiatives[0].sourceCwd, cwd);
  });
});
