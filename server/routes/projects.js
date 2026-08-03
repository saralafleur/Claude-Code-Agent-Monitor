/**
 * @file Express router for Projects: a user-named grouping of one or more
 * session working directories (cwd). Sessions carry no project_id column -
 * membership is derived by joining sessions.cwd against project_paths.cwd, so
 * this is a thin label layer over the existing session/cwd data rather than a
 * new session relationship. Exposes CRUD for projects plus add/remove folder
 * mapping endpoints, and returns aggregated session counts per project (and
 * for cwds not yet mapped to any project) so the client can render a live
 * "active projects" view without a separate stats round-trip. A project can
 * also be pinned (PATCH `pinned`), which floats it to the top of `listProjects`
 * ahead of the regular alphabetical order, and has a per-project sibling-repo
 * disk-scan toggle (PATCH `siblingScanEnabled`, default off) that gates the
 * noisy on-disk sibling scan in `/repos` topology — see server/lib/repo-topology.js.
 * Each mapped folder also carries its own `terminalDefault` flag (PATCH
 * `/:id/paths/:pathId`) controlling whether it's offered as a choice in the
 * "open a new Claude terminal" pickers — only a project's FIRST mapped
 * folder (at creation via `cwds`, or the first added afterward via POST
 * `/:id/paths`) defaults to on; every folder mapped alongside or after it
 * defaults to off, re-enabled explicitly via the same PATCH. Also exposes an "open terminal in
 * one of this project's folders" action (macOS only, see
 * server/lib/terminal-focus.js) for the Kanban board's project picker, plus a
 * per-worktree "continue" action (`/:id/continue-worktree`, also macOS only)
 * for the Project Detail page's Repos card — opens a specific worktree with
 * a fresh `claude` instance seeded with an injected resume-nudge prompt
 * (never `-c`/`--continue`, which would silently resume whatever prior
 * conversation happened in that directory — see terminal-focus.js's
 * openTerminalForCwd doc comment) so re-orientation always comes from the
 * prompt telling it to run git itself, not from inherited conversation
 * memory. Two read-only Project Detail page endpoints are
 * computed live on every call (no persistence): `/repos` (git repo/worktree
 * topology, see server/lib/repo-topology.js) and `/intake` (team-intake
 * initiative status, see server/lib/intake-scan.js).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const dbModule = require("../db");
const { stmts, db } = dbModule;
const { buildProjectFocusReport } = require("../lib/focus-report");
const { buildProjectRepoTopology } = require("../lib/repo-topology");
const { scanProjectIntake } = require("../lib/intake-scan");
// Required as a module object (not destructured) so tests can swap
// `terminalFocus.openTerminalForCwd` and this route picks the stub up at
// call time — same idiom routes/sessions.js uses for its own terminal-focus
// calls.
const terminalFocus = require("../lib/terminal-focus");

const router = Router();

/**
 * Grouped per-cwd session stats in one query, so listing N projects costs one
 * extra query total instead of N. Keyed by cwd for O(1) lookup while building
 * each project's (and the unassigned bucket's) aggregate.
 */
function cwdSessionStats() {
  const rows = db
    .prepare(
      `SELECT cwd,
              COUNT(*) AS session_count,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
              MAX(updated_at) AS last_activity
       FROM sessions
       WHERE cwd IS NOT NULL AND cwd != ''
       GROUP BY cwd`
    )
    .all();
  return new Map(rows.map((r) => [r.cwd, r]));
}

// SQLite has no boolean type — `pinned`/`sibling_scan_enabled` come back as
// 0/1 from every prepared statement. Normalize them to real booleans at the
// response boundary so the client never has to special-case the wire format.
function serializeProject(project) {
  return {
    ...project,
    pinned: !!project.pinned,
    siblingScanEnabled: !!project.sibling_scan_enabled,
  };
}

// Same normalization for a Project's `paths` array — every route that
// returns `paths` (as opposed to the recomputed repo topology, which does
// its own via server/lib/repo-topology.js) funnels through this so
// `terminalDefault` is always a real boolean and internal columns
// (`project_id`, `created_at`) never leak onto the wire.
function serializePaths(paths) {
  return paths.map((p) => ({ id: p.id, cwd: p.cwd, terminalDefault: !!p.terminal_default }));
}

function aggregate(cwds, statsByCwd) {
  let session_count = 0;
  let active_count = 0;
  let last_activity = null;
  for (const cwd of cwds) {
    const s = statsByCwd.get(cwd);
    if (!s) continue;
    session_count += s.session_count;
    active_count += s.active_count;
    if (s.last_activity && (!last_activity || s.last_activity > last_activity)) {
      last_activity = s.last_activity;
    }
  }
  return { session_count, active_count, last_activity };
}

// GET /api/projects - every project with its mapped folders and aggregated
// session stats, plus an "unassigned" bucket for cwds with sessions that
// aren't mapped to any project yet.
router.get("/", (_req, res) => {
  const projects = stmts.listProjects.all();
  const allPaths = stmts.listAllProjectPaths.all();

  const pathsByProject = new Map();
  const mappedCwds = new Set();
  for (const p of allPaths) {
    mappedCwds.add(p.cwd);
    if (!pathsByProject.has(p.project_id)) pathsByProject.set(p.project_id, []);
    pathsByProject
      .get(p.project_id)
      .push({ id: p.id, cwd: p.cwd, terminalDefault: !!p.terminal_default });
  }

  const statsByCwd = cwdSessionStats();

  const result = projects.map((project) => {
    const paths = pathsByProject.get(project.id) || [];
    return {
      ...serializeProject(project),
      paths,
      ...aggregate(
        paths.map((p) => p.cwd),
        statsByCwd
      ),
    };
  });

  const unassignedCwds = [...statsByCwd.keys()].filter((cwd) => !mappedCwds.has(cwd));
  const unassigned = {
    cwds: unassignedCwds,
    ...aggregate(unassignedCwds, statsByCwd),
  };

  res.json({ projects: result, unassigned });
});

// POST /api/projects - create a project, optionally attaching folders it
// already covers (each must be unmapped; a folder belongs to one project).
router.post("/", (req, res) => {
  const { name, cwds } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "name is required" } });
  }

  let cwdList = [];
  if (cwds !== undefined) {
    if (!Array.isArray(cwds) || cwds.some((c) => typeof c !== "string" || !c.trim())) {
      return res.status(400).json({
        error: { code: "INVALID_INPUT", message: "cwds must be an array of non-empty strings" },
      });
    }
    cwdList = [...new Set(cwds.map((c) => c.trim()))];
  }

  for (const cwd of cwdList) {
    if (stmts.getProjectPathByCwd.get(cwd)) {
      return res.status(409).json({
        error: { code: "ALREADY_MAPPED", message: `"${cwd}" already belongs to another project` },
      });
    }
  }

  const id = uuidv4();
  db.transaction(() => {
    stmts.insertProject.run(id, name.trim());
    // Only the first folder attached at creation time defaults to being
    // offered in the open-terminal picker (terminal_default's own column
    // default) - every folder alongside it starts excluded, so a
    // multi-folder project isn't created with every folder flooding the
    // picker before the user has chosen which ones they actually want
    // there. Re-enable any of them via PATCH /:id/paths/:pathId.
    cwdList.forEach((cwd, index) => {
      const info = stmts.insertProjectPath.run(id, cwd);
      if (index > 0) {
        stmts.setProjectPathTerminalDefault.run(0, info.lastInsertRowid, id);
      }
    });
  })();

  const project = stmts.getProject.get(id);
  const paths = serializePaths(stmts.listProjectPaths.all(id));
  res.status(201).json({ project: { ...serializeProject(project), paths } });
});

// PATCH /api/projects/:id - rename a project, toggle its pinned state, and/or
// toggle its sibling-repo disk-scan setting. At least one of `name`/`pinned`/
// `siblingScanEnabled` must be present; any of them can be sent alone.
router.patch("/:id", (req, res) => {
  const existing = stmts.getProject.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const { name, pinned, siblingScanEnabled } = req.body || {};
  if (name === undefined && pinned === undefined && siblingScanEnabled === undefined) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "name, pinned, or siblingScanEnabled is required" },
    });
  }
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res
        .status(400)
        .json({ error: { code: "INVALID_INPUT", message: "name must be a non-empty string" } });
    }
    stmts.renameProject.run(name.trim(), req.params.id);
  }
  if (pinned !== undefined) {
    if (typeof pinned !== "boolean") {
      return res
        .status(400)
        .json({ error: { code: "INVALID_INPUT", message: "pinned must be a boolean" } });
    }
    stmts.setProjectPinned.run(pinned ? 1 : 0, req.params.id);
  }
  if (siblingScanEnabled !== undefined) {
    if (typeof siblingScanEnabled !== "boolean") {
      return res.status(400).json({
        error: { code: "INVALID_INPUT", message: "siblingScanEnabled must be a boolean" },
      });
    }
    stmts.setProjectSiblingScanEnabled.run(siblingScanEnabled ? 1 : 0, req.params.id);
  }
  const project = stmts.getProject.get(req.params.id);
  const paths = serializePaths(stmts.listProjectPaths.all(req.params.id));
  res.json({ project: { ...serializeProject(project), paths } });
});

// DELETE /api/projects/:id - delete a project. Its folder mappings cascade
// away (ON DELETE CASCADE); the underlying sessions are untouched and simply
// fall back into the unassigned bucket.
router.delete("/:id", (req, res) => {
  const existing = stmts.getProject.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  stmts.deleteProject.run(req.params.id);
  res.json({ ok: true });
});

// POST /api/projects/:id/paths - map an additional folder onto this project.
router.post("/:id/paths", (req, res) => {
  const existing = stmts.getProject.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const { cwd } = req.body || {};
  if (!cwd || typeof cwd !== "string" || !cwd.trim()) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "cwd is required" } });
  }
  const trimmed = cwd.trim();
  const mapping = stmts.getProjectPathByCwd.get(trimmed);
  if (mapping) {
    const message =
      mapping.project_id === req.params.id
        ? `"${trimmed}" is already part of this project`
        : `"${trimmed}" already belongs to another project`;
    return res.status(409).json({ error: { code: "ALREADY_MAPPED", message } });
  }
  // Same first-folder-only default as project creation above: this folder
  // only starts offered in the open-terminal picker if the project didn't
  // already have any mapped folders.
  const hadExistingPaths = stmts.listProjectPaths.all(req.params.id).length > 0;
  const info = stmts.insertProjectPath.run(req.params.id, trimmed);
  if (hadExistingPaths) {
    stmts.setProjectPathTerminalDefault.run(0, info.lastInsertRowid, req.params.id);
  }
  const project = stmts.getProject.get(req.params.id);
  const paths = serializePaths(stmts.listProjectPaths.all(req.params.id));
  res.status(201).json({ project: { ...serializeProject(project), paths } });
});

// DELETE /api/projects/:id/paths/:pathId - unmap a folder from this project
// (the folder itself, and its sessions, are untouched - it just becomes
// unassigned again).
router.delete("/:id/paths/:pathId", (req, res) => {
  const existing = stmts.getProject.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const pathId = parseInt(req.params.pathId, 10);
  if (!Number.isInteger(pathId)) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "pathId must be an integer" } });
  }
  const info = stmts.deleteProjectPath.run(pathId, req.params.id);
  if (info.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Folder mapping not found" } });
  }
  const project = stmts.getProject.get(req.params.id);
  const paths = serializePaths(stmts.listProjectPaths.all(req.params.id));
  res.json({ project: { ...serializeProject(project), paths } });
});

// PATCH /api/projects/:id/paths/:pathId - toggle whether a mapped folder is
// offered as a folder choice in the "open a new Claude terminal" pickers
// (OpenTerminalModal's folder step for a project mapped to more than one
// folder) - the Project Detail page's Repos card exposes this as a
// per-folder toggle. Only a project's first mapped folder defaults to on
// (see POST / and POST /:id/paths above); this route is how every other
// folder gets re-enabled, or the first one gets excluded. Returns the
// freshly recomputed repo topology (same shape as GET /:id/repos) so the
// client can render the result without a second round trip, matching the
// ignore/unignore routes' convention.
router.patch("/:id/paths/:pathId", async (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const pathId = parseInt(req.params.pathId, 10);
  if (!Number.isInteger(pathId)) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "pathId must be an integer" } });
  }
  const { terminalDefault } = req.body || {};
  if (typeof terminalDefault !== "boolean") {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "terminalDefault must be a boolean" },
    });
  }
  const info = stmts.setProjectPathTerminalDefault.run(
    terminalDefault ? 1 : 0,
    pathId,
    req.params.id
  );
  if (info.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Folder mapping not found" } });
  }
  const topology = await buildProjectRepoTopology(dbModule, project);
  res.json({ project_id: project.id, ...topology });
});

// GET /api/projects/:id/focus-report - focus-time breakdown for every
// session under this project's mapped folders: per-session segments (item /
// detour / feature / bug, each with wall-clock + idle-grace-discounted
// active time), a per-item rollup bucketing detours under the item that was
// current when they started, and project-wide totals by kind. Sessions that
// never declared a focus fall back to the background classifier's verdict
// (segments flagged inferred: true). See server/lib/focus-report.js for the
// segment-replay + grace-window math and the inference fallback.
router.get("/:id/focus-report", (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const paths = stmts.listProjectPaths.all(project.id);
  const cwds = paths.map((p) => p.cwd);
  const sessions =
    cwds.length === 0
      ? []
      : db
          .prepare(
            "SELECT id, name, cwd, started_at, ended_at FROM sessions WHERE cwd IN (SELECT value FROM json_each(?)) ORDER BY started_at ASC"
          )
          .all(JSON.stringify(cwds));
  const report = buildProjectFocusReport(dbModule, sessions);
  res.json({ project_id: project.id, ...report });
});

// GET /api/projects/:id/repos - which of this project's mapped folders are
// git repos, their live worktrees (git worktree list), and any related repos
// not yet mapped to the project - detected via PROJECT-CONTEXT.md, a live
// sibling-directory scan, and a bounded nested-subfolder scan (suggestions
// only - see server/lib/repo-topology.js for how each is found; the client
// must call POST /:id/paths to actually add one).
router.get("/:id/repos", async (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const topology = await buildProjectRepoTopology(dbModule, project);
  res.json({ project_id: project.id, ...topology });
});

const VALID_DETECTED_SIBLING_SOURCES = new Set(["context", "disk-sibling", "disk-nested"]);

// POST /api/projects/:id/ignored-repos - dismiss a detected-but-not-yet-mapped
// repo suggestion from the Repos card (the "Ignore" action) so it drops out
// of GET /:id/repos's detectedSiblings on every future scan until explicitly
// un-ignored via the DELETE route below. Idempotent: ignoring an
// already-ignored path just refreshes its stored name/source (see
// stmts.insertIgnoredRepo's ON CONFLICT clause). Returns the freshly
// recomputed topology (same shape as GET /:id/repos) so the client can
// render the result without a second round trip.
router.post("/:id/ignored-repos", async (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const { path: repoPath, name, source } = req.body || {};
  if (!repoPath || typeof repoPath !== "string" || !repoPath.trim()) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "path is required" } });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "name is required" } });
  }
  if (!VALID_DETECTED_SIBLING_SOURCES.has(source)) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: `source must be one of: ${[...VALID_DETECTED_SIBLING_SOURCES].join(", ")}`,
      },
    });
  }
  stmts.insertIgnoredRepo.run(req.params.id, repoPath.trim(), name.trim(), source);
  const topology = await buildProjectRepoTopology(dbModule, project);
  res.status(201).json({ project_id: project.id, ...topology });
});

// DELETE /api/projects/:id/ignored-repos/:ignoredId - un-ignore a
// previously-dismissed suggestion (numeric row id, same
// identify-by-row-id-not-raw-value convention as DELETE /:id/paths/:pathId)
// so it can surface again on the project's next scan.
router.delete("/:id/ignored-repos/:ignoredId", async (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const ignoredId = parseInt(req.params.ignoredId, 10);
  if (!Number.isInteger(ignoredId)) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "ignoredId must be an integer" } });
  }
  const info = stmts.deleteIgnoredRepo.run(ignoredId, req.params.id);
  if (info.changes === 0) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Ignored repo not found" } });
  }
  const topology = await buildProjectRepoTopology(dbModule, project);
  res.json({ project_id: project.id, ...topology });
});

// GET /api/projects/:id/intake - team-intake initiatives found under this
// project's mapped folders' intake/<slug>/ directories, with a stage
// inferred from which known delivery-team artifact files exist (see
// server/lib/intake-scan.js), plus each initiative's live effort worktree
// (if one still exists) and a git-detected merge commit when merge.json was
// never written for an initiative that was actually merged.
router.get("/:id/intake", async (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const report = await scanProjectIntake(dbModule, project);
  res.json({ project_id: project.id, ...report });
});

// Maps server/lib/terminal-focus.js's typed failure codes to HTTP status —
// same idiom routes/sessions.js's TERMINAL_FOCUS_STATUS/OPEN_TERMINAL_STATUS
// use for the session-scoped counterparts of this action.
const OPEN_TERMINAL_STATUS = {
  UNSUPPORTED_PLATFORM: 501,
  NO_CWD: 409,
  AUTOMATION_ERROR: 500,
};

/**
 * POST /:id/open-terminal — opens a brand-new Terminal.app window in one of
 * this project's mapped folders and starts a fresh `claude` instance in it
 * (macOS only). Only folders with `terminalDefault` on are eligible — same
 * set the client's picker offers, enforced here too so this endpoint can't
 * be used to bypass a folder a user has explicitly excluded. A project with
 * exactly one eligible folder opens it directly; more than one requires
 * `cwd` in the body naming which of its own eligible `paths` to use — the
 * client's picker only shows the folder step when there's an actual choice
 * to make. Body may also carry an optional `name` (effort/session name),
 * passed through as `claude -n <name>` so the fresh session starts already
 * titled.
 */
router.post("/:id/open-terminal", (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }
  const paths = stmts.listProjectPaths.all(project.id).filter((p) => p.terminal_default);
  if (paths.length === 0) {
    return res.status(409).json({
      error: { code: "NO_FOLDERS", message: "This project has no mapped folders." },
    });
  }

  let cwd;
  if (paths.length === 1) {
    cwd = paths[0].cwd;
  } else {
    const requested = req.body?.cwd;
    if (!requested || typeof requested !== "string" || !paths.some((p) => p.cwd === requested)) {
      return res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "cwd must be one of this project's mapped folders",
        },
      });
    }
    cwd = requested;
  }

  const rawName = req.body?.name;
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : undefined;
  const result = terminalFocus.openTerminalForCwd(cwd, name);
  if (result.ok) return res.json({ ok: true });
  const status = OPEN_TERMINAL_STATUS[result.code] || 500;
  res.status(status).json({ error: { code: result.code, message: result.message } });
});

// Builds the resume-nudge sent as claude's initial message when the Project
// Detail page's per-worktree "Continue" button is clicked. This is the ONLY
// context the fresh session gets - deliberately never paired with `-c`/
// `--continue` (see openTerminalForCwd's doc comment for why silently
// resuming a prior conversation for this directory is unsafe: it can drag in
// stale context, a different task than what's actually in progress, or a
// permission/tool state from a session the user never inspected) - so it
// names the worktree's branch/dirty state up front and always routes
// re-orientation through git commands the new session runs itself, never
// through inherited conversation memory.
function buildContinueWorktreePrompt(worktree) {
  const branchLabel = worktree.detached
    ? "a detached HEAD"
    : `branch \`${(worktree.branch || "").replace(/^refs\/heads\//, "")}\``;
  const dirtyLine =
    worktree.dirty === true
      ? " It currently has uncommitted changes."
      : worktree.dirty === false
        ? " It's currently clean (no uncommitted changes)."
        : "";
  return (
    `This is a fresh session in a worktree (${branchLabel}) that may already have work in progress.${dirtyLine} ` +
    "You have no memory of any earlier session here, so reconstruct the current state yourself: run " +
    "`git status`, `git log --oneline -10`, and (if there are uncommitted changes) `git diff` to see " +
    "what's been done and what's still outstanding. Then continue from there — finish any cleanup, " +
    "address anything uncommitted, and pick up whatever task looks underway."
  );
}

/**
 * POST /:id/continue-worktree — opens a brand-new Terminal.app window in one
 * specific worktree of one of this project's mapped repos and resumes work
 * there (macOS only): a fresh `claude` instance seeded with an injected
 * prompt (`buildContinueWorktreePrompt` above) that names the worktree's
 * branch/dirty state and has it re-orient itself via `git status`/`git log`/
 * `git diff` before picking work back up. Deliberately does NOT pass `-c`/
 * `--continue` to resume any prior conversation for this directory - see
 * `terminalFocus.openTerminalForCwd`'s doc comment for why that's unsafe
 * (stale context, a different task than what's actually in progress, or an
 * inherited permission/tool state the user never reviewed) - every session
 * this opens starts clean and re-derives context from the repo itself, never
 * from conversation memory. Unlike POST /:id/open-terminal (restricted to a
 * project's `terminalDefault`-eligible mapped folders), `path` here is any
 * worktree belonging to any of this project's mapped repos — this is the
 * Project Detail page's per-worktree action, not the folder-level "open a
 * terminal for this project" picker. The topology is recomputed live
 * (nothing here is persisted, matching every other Project Detail read) so
 * `path` can be validated against a real worktree and its branch/dirty state
 * used to build the prompt, rather than trusting an arbitrary
 * client-supplied directory.
 */
router.post("/:id/continue-worktree", async (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
  }

  const requestedPath = req.body?.path;
  if (!requestedPath || typeof requestedPath !== "string") {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "path is required" } });
  }

  const topology = await buildProjectRepoTopology(dbModule, project);
  const worktree = topology.repos
    .flatMap((repo) => repo.worktrees)
    .find((w) => w.path === requestedPath);
  if (!worktree) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "path is not a known worktree of this project's mapped repos",
      },
    });
  }

  const rawName = req.body?.name;
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : undefined;
  const result = terminalFocus.openTerminalForCwd(
    worktree.path,
    name,
    buildContinueWorktreePrompt(worktree)
  );
  if (result.ok) return res.json({ ok: true });
  const status = OPEN_TERMINAL_STATUS[result.code] || 500;
  res.status(status).json({ error: { code: result.code, message: result.message } });
});

module.exports = router;
