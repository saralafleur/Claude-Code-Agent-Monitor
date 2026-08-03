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
const { TRUNK_DRIFT_ROUTE_SKIP_REASONS } = require("../routes/projects");

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

// Backdated well outside trunk-drift's default 7-day lookback window — a
// real repo's root commit predates any lookback window by a wide margin, so
// a fixture root commit left at "now" (git's default with no committer-date
// override) would spuriously show up as its own extra "direct commit"
// alongside whatever a trunk-drift test case seeds on top of it. See
// server/__tests__/trunk-drift.test.js's own makeWorkingRepo for the fuller
// explanation.
const ROOT_COMMIT_DAYS_AGO = 30;

function makeFixtureRepo(name) {
  const repo = path.join(FS_FIXTURE_ROOT, name);
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
  const rootDate = new Date(Date.now() - ROOT_COMMIT_DAYS_AGO * 24 * 60 * 60 * 1000).toISOString();
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: repo,
    stdio: "ignore",
    env: { ...ISOLATED_GIT_ENV, GIT_COMMITTER_DATE: rootDate, GIT_AUTHOR_DATE: rootDate },
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
    const res = await post(`/api/projects/${created.body.project.id}/open-terminal`, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("400 INVALID_INPUT when the requested cwd isn't one of the project's own folders", async () => {
    const created = await post("/api/projects", {
      name: "Multi Folder Project B",
      cwds: ["/tmp/multi-b-1", "/tmp/multi-b-2"],
    });
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

describe("GET /:id/trunk-drift", () => {
  it("R1: 404 unknown project", async () => {
    const res = await fetch("/api/projects/does-not-exist/trunk-drift");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("R2: project with no mapped folders returns empty repos", async () => {
    const created = await post("/api/projects", { name: "TrunkDrift Empty Project" });
    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.repos, []);
  });

  it("R3: mapped non-repo folder is filtered out", async () => {
    const repo = makeFixtureRepo("trunk-drift-real-repo");
    const plainFolder = path.join(FS_FIXTURE_ROOT, "trunk-drift-plain-folder");
    fs.mkdirSync(plainFolder, { recursive: true });

    const created = await post("/api/projects", {
      name: "TrunkDrift Filter Project",
      cwds: [repo, plainFolder],
    });

    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    assert.equal(res.body.repos.length, 1);
    assert.equal(res.body.repos[0].cwd, repo);
    assert.equal("nonRepoFolders" in res.body, false);
  });

  it("R4: populated drift for a fixture repo with one direct commit", async () => {
    const repo = makeFixtureRepo("trunk-drift-direct-commit");
    // Add a direct commit to the repo
    const env = { ...ISOLATED_GIT_ENV };
    const testFile = path.join(repo, "test-trunk-drift.txt");
    fs.writeFileSync(testFile, "direct commit\n");
    execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=Test", "add", "."], {
      cwd: repo,
      stdio: "ignore",
      env,
    });
    execFileSync(
      "git",
      [
        "-c",
        "user.email=test@test",
        "-c",
        "user.name=Test",
        "commit",
        "-m",
        "trunk drift test commit",
      ],
      {
        cwd: repo,
        stdio: "ignore",
        env,
      }
    );
    const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
      env,
    }).trim();
    const shortSha = commitSha.substring(0, 7);

    const created = await post("/api/projects", {
      name: "TrunkDrift Direct Project",
      cwds: [repo],
    });

    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    assert.equal(res.body.repos.length, 1);
    assert.ok(res.body.repos[0].drift);
    assert.equal(res.body.repos[0].drift.skipped, null);
    assert.equal(res.body.repos[0].drift.defaultBranch, "master");
    assert.equal(res.body.repos[0].drift.commits.length, 1);
    assert.equal(res.body.repos[0].drift.commits[0].sha, commitSha);
    assert.equal(res.body.repos[0].drift.commits[0].shortSha, shortSha);
    assert.ok(res.body.repos[0].drift.commits[0].subject.includes("trunk drift"));
  });

  it("R5: mixed-state aggregation — healthy repo, empty repo, corrupted repo in one response (G5)", async () => {
    const healthyRepo = makeFixtureRepo("trunk-drift-r5-healthy");
    const emptyRepo = path.join(FS_FIXTURE_ROOT, "trunk-drift-r5-empty");
    fs.mkdirSync(emptyRepo, { recursive: true });
    execFileSync("git", ["init", emptyRepo], {
      stdio: "ignore",
      env: ISOLATED_GIT_ENV,
    });

    // Add a direct commit to healthy repo
    const env = { ...ISOLATED_GIT_ENV };
    const testFile = path.join(healthyRepo, "test.txt");
    fs.writeFileSync(testFile, "drift\n");
    execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=Test", "add", "."], {
      cwd: healthyRepo,
      stdio: "ignore",
      env,
    });
    execFileSync(
      "git",
      ["-c", "user.email=test@test", "-c", "user.name=Test", "commit", "-m", "direct commit"],
      {
        cwd: healthyRepo,
        stdio: "ignore",
        env,
      }
    );

    // Create corrupt repo by deleting objects
    const corruptRepo = makeFixtureRepo("trunk-drift-r5-corrupt");
    const objectsDir = path.join(corruptRepo, ".git", "objects");
    for (const item of fs.readdirSync(objectsDir)) {
      const itemPath = path.join(objectsDir, item);
      if (fs.lstatSync(itemPath).isDirectory()) {
        fs.rmSync(itemPath, { recursive: true });
      } else {
        fs.unlinkSync(itemPath);
      }
    }

    const created = await post("/api/projects", {
      name: "TrunkDrift Mixed Project",
      cwds: [healthyRepo, emptyRepo, corruptRepo],
    });

    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    assert.equal(res.body.repos.length, 3);

    const healthy = res.body.repos.find((r) => r.cwd === healthyRepo);
    const empty = res.body.repos.find((r) => r.cwd === emptyRepo);
    const corrupt = res.body.repos.find((r) => r.cwd === corruptRepo);

    assert.equal(healthy.drift.skipped, null);
    assert.equal(
      healthy.drift.commits.length,
      1,
      "healthy repo should have 1 direct commit, not degraded"
    );

    assert.equal(empty.drift.skipped, "no_commits");

    assert.equal(corrupt.drift.skipped, "git_error", "corrupt repo should have git_error");

    // All skipped values should be valid — derived from the route's own
    // exported TRUNK_DRIFT_ROUTE_SKIP_REASONS (R5-vocab), not a fourth
    // hand-typed copy that can silently fall out of sync (e.g. missing
    // "budget_exceeded" when the request-budget cap was added).
    for (const repo of res.body.repos) {
      assert.ok(
        repo.drift.skipped === null || TRUNK_DRIFT_ROUTE_SKIP_REASONS.includes(repo.drift.skipped),
        `invalid skipped value: ${repo.drift.skipped}`
      );
    }
  });

  it("R5b (S7): 26 mapped repos — exactly 25 get a real detection, the rest are budget_exceeded, none dropped", async () => {
    const REPO_COUNT = 26;
    const repos = [];
    for (let i = 0; i < REPO_COUNT; i++) {
      repos.push(makeFixtureRepo(`trunk-drift-budget-${i}`));
    }

    const created = await post("/api/projects", {
      name: "TrunkDrift Budget Project",
      cwds: repos,
    });

    const res = await fetch(`/api/projects/${created.body.project.id}/trunk-drift`);
    assert.equal(res.status, 200);
    // Nothing silently dropped: every mapped repo still appears in `repos`.
    assert.equal(res.body.repos.length, REPO_COUNT);

    const budgetExceeded = res.body.repos.filter((r) => r.drift.skipped === "budget_exceeded");
    const real = res.body.repos.filter((r) => r.drift.skipped !== "budget_exceeded");

    assert.equal(
      real.length,
      25,
      "exactly MAX_TRUNK_DRIFT_CHECKS_PER_REQUEST repos should get a real detection"
    );
    assert.equal(
      budgetExceeded.length,
      REPO_COUNT - 25,
      "the rest should be marked budget_exceeded"
    );
    for (const r of budgetExceeded) {
      assert.equal(r.drift.repoPath, r.cwd);
    }
  });

  it("R6: GET /:id/repos response shape unchanged", async () => {
    const repo = makeFixtureRepo("trunk-drift-r6-repos");
    const created = await post("/api/projects", {
      name: "TrunkDrift Repos Compat",
      cwds: [repo],
    });

    const res = await fetch(`/api/projects/${created.body.project.id}/repos`);
    assert.equal(res.status, 200);
    // Real response shape (server/lib/repo-topology.js's buildProjectRepoTopology
    // return value, spread under project_id in the route handler) — no
    // "ignoredRepos" key exists anywhere in product code.
    const expectedKeys = ["detectedSiblings", "nonRepoFolders", "project_id", "repos"].sort();
    const actualKeys = Object.keys(res.body).sort();
    assert.deepEqual(actualKeys, expectedKeys);
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
