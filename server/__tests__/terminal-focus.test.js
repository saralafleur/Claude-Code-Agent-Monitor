/**
 * @file Tests for jump-to-terminal and open-new-terminal: resolving a
 * hook-reported pid hint to the real `claude` CLI process
 * (server/lib/terminal-focus.js's resolveSessionPid, walking an intermediate
 * shell wrapper when present), the pre-action liveness re-check
 * (isPidLiveClaude), the full focusTerminalForSession and
 * openTerminalForSession branching (platform/source/pid-or-cwd/
 * liveness/tty/AppleScript-result → typed result), the hook-ingestion wiring
 * that persists a resolved pid on SessionStart (server/routes/hooks.js's
 * ensureSession), and the POST /api/sessions/:id/focus-terminal and
 * POST /api/sessions/:id/open-terminal routes' typed-code → HTTP-status
 * mapping. `listProcesses`/`resolveTty`/`runFocusScript`/
 * `runOpenTerminalScript` are swapped on the module object for deterministic
 * fixtures instead of depending on this test run's own real OS process tree
 * — same idiom session-liveness.test.js uses for `liveness.probeLiveCwds`.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const STAMP = `terminal-focus-${Date.now()}-${process.pid}`;
const TMP = path.join(os.tmpdir(), STAMP);
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.CLAUDE_HOME = path.join(TMP, "home");
process.env.DASHBOARD_DATA_DIR = path.join(TMP, "data");
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const { db } = require("../db");
const terminalFocus = require("../lib/terminal-focus");

const real = {
  listProcesses: terminalFocus.listProcesses,
  isPidLiveClaude: terminalFocus.isPidLiveClaude,
  resolveTty: terminalFocus.resolveTty,
  runFocusScript: terminalFocus.runFocusScript,
  focusTerminalForSession: terminalFocus.focusTerminalForSession,
  runOpenTerminalScript: terminalFocus.runOpenTerminalScript,
  openTerminalForSession: terminalFocus.openTerminalForSession,
  openLoginTerminalForConfigDir: terminalFocus.openLoginTerminalForConfigDir,
};
function restoreTerminalFocus() {
  Object.assign(terminalFocus, real);
}

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(b || "{}");
          } catch {
            parsed = b;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let server;
let BASE;

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  restoreTerminalFocus();
  if (server) server.close();
  if (db) db.close();
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  restoreTerminalFocus();
});

describe("resolveSessionPid — hint-to-real-claude-process walk", () => {
  it("resolves a hint that is already the claude process", () => {
    terminalFocus.listProcesses = () =>
      new Map([["500", { ppid: "1", args: "/usr/local/bin/claude --resume abc" }]]);
    assert.equal(terminalFocus.resolveSessionPid(500), 500);
  });

  it("climbs through an intermediate shell wrapper to find claude", () => {
    terminalFocus.listProcesses = () =>
      new Map([
        ["600", { ppid: "550", args: "/bin/sh -c" }],
        ["550", { ppid: "1", args: "node /opt/homebrew/bin/claude" }],
      ]);
    assert.equal(terminalFocus.resolveSessionPid(600), 550);
  });

  it("gives up after MAX_ANCESTOR_HOPS and returns null", () => {
    // A long non-claude chain, no match within the walk's bound.
    terminalFocus.listProcesses = () =>
      new Map([
        ["10", { ppid: "9", args: "sh" }],
        ["9", { ppid: "8", args: "sh" }],
        ["8", { ppid: "7", args: "sh" }],
        ["7", { ppid: "6", args: "sh" }],
        ["6", { ppid: "1", args: "launchd" }],
      ]);
    assert.equal(terminalFocus.resolveSessionPid(10), null);
  });

  it("returns null when ps is unavailable", () => {
    terminalFocus.listProcesses = () => null;
    assert.equal(terminalFocus.resolveSessionPid(1234), null);
  });

  it("rejects a non-positive-integer hint without consulting ps", () => {
    let called = false;
    terminalFocus.listProcesses = () => {
      called = true;
      return new Map();
    };
    assert.equal(terminalFocus.resolveSessionPid(-5), null);
    assert.equal(terminalFocus.resolveSessionPid(0), null);
    assert.equal(terminalFocus.resolveSessionPid(1.5), null);
    assert.equal(called, false);
  });
});

describe("isPidLiveClaude — pre-action liveness re-check", () => {
  it("true only when the pid is alive AND still a claude process", () => {
    terminalFocus.listProcesses = () =>
      new Map([
        ["700", { ppid: "1", args: "claude" }],
        ["701", { ppid: "1", args: "node /some/other/tool" }],
      ]);
    assert.equal(terminalFocus.isPidLiveClaude(700), true);
    assert.equal(terminalFocus.isPidLiveClaude(701), false);
    assert.equal(terminalFocus.isPidLiveClaude(999), false); // not in the map at all
  });
});

describe("focusTerminalForSession — full branching", () => {
  beforeEach(() => {
    // Reset to a "happy path" baseline before each case tweaks one variable.
    terminalFocus.isPidLiveClaude = () => true;
    terminalFocus.resolveTty = () => "/dev/ttys099";
    terminalFocus.runFocusScript = () => "found";
  });

  it("succeeds when every step resolves", () => {
    assert.deepEqual(terminalFocus.focusTerminalForSession({ pid: 42, source: "local" }), {
      ok: true,
    });
  });

  it("treats an unset/undefined source as local (default)", () => {
    assert.deepEqual(terminalFocus.focusTerminalForSession({ pid: 42 }), { ok: true });
  });

  it("NOT_LOCAL for a session collected from another machine", () => {
    const r = terminalFocus.focusTerminalForSession({ pid: 42, source: "laptop-2" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOT_LOCAL");
  });

  it("NO_PID when no process was ever recorded", () => {
    for (const pid of [null, undefined, 0, -1, 1.5]) {
      const r = terminalFocus.focusTerminalForSession({ pid, source: "local" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "NO_PID");
    }
  });

  it("PROCESS_GONE when the pid is no longer a live claude process", () => {
    terminalFocus.isPidLiveClaude = () => false;
    const r = terminalFocus.focusTerminalForSession({ pid: 42, source: "local" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "PROCESS_GONE");
  });

  it("PROCESS_GONE when the pid has no resolvable tty", () => {
    terminalFocus.resolveTty = () => null;
    const r = terminalFocus.focusTerminalForSession({ pid: 42, source: "local" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "PROCESS_GONE");
  });

  it("TERMINAL_NOT_FOUND when no Terminal.app tab matches", () => {
    terminalFocus.runFocusScript = () => "not-found";
    const r = terminalFocus.focusTerminalForSession({ pid: 42, source: "local" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TERMINAL_NOT_FOUND");
  });

  it("AUTOMATION_ERROR when the AppleScript invocation throws", () => {
    terminalFocus.runFocusScript = () => {
      const err = new Error("execution error");
      err.stderr = "osascript: Not authorized to send Apple events to Terminal.";
      throw err;
    };
    const r = terminalFocus.focusTerminalForSession({ pid: 42, source: "local" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "AUTOMATION_ERROR");
    assert.match(r.message, /not authorized/i);
  });
});

describe("shellQuote — safe splicing into a shell command string", () => {
  it("wraps a plain path in single quotes", () => {
    assert.equal(terminalFocus.shellQuote("/Users/dev/project"), "'/Users/dev/project'");
  });

  it("escapes an embedded single quote", () => {
    assert.equal(terminalFocus.shellQuote("/tmp/it's a dir"), "'/tmp/it'\\''s a dir'");
  });
});

describe("openTerminalForSession — full branching", () => {
  beforeEach(() => {
    terminalFocus.runOpenTerminalScript = () => "";
  });

  it("succeeds when every step resolves", () => {
    assert.deepEqual(
      terminalFocus.openTerminalForSession({ cwd: "/repo/agent-monitor", source: "local" }),
      { ok: true }
    );
  });

  it("treats an unset/undefined source as local (default)", () => {
    assert.deepEqual(terminalFocus.openTerminalForSession({ cwd: "/repo/agent-monitor" }), {
      ok: true,
    });
  });

  it("NOT_LOCAL for a session collected from another machine", () => {
    const r = terminalFocus.openTerminalForSession({
      cwd: "/repo/agent-monitor",
      source: "laptop-2",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOT_LOCAL");
  });

  it("NO_CWD when no working directory was ever recorded", () => {
    for (const cwd of [null, undefined, ""]) {
      const r = terminalFocus.openTerminalForSession({ cwd, source: "local" });
      assert.equal(r.ok, false);
      assert.equal(r.code, "NO_CWD");
    }
  });

  it("passes the `cd <quoted cwd>` and `claude` commands to the AppleScript runner as two separate commands", () => {
    let seenCd, seenClaude;
    terminalFocus.runOpenTerminalScript = (cdCommand, claudeCommand) => {
      seenCd = cdCommand;
      seenClaude = claudeCommand;
      return "";
    };
    terminalFocus.openTerminalForSession({ cwd: "/repo/agent-monitor", source: "local" });
    assert.equal(seenCd, "cd '/repo/agent-monitor'");
    assert.equal(seenClaude, "claude");
  });

  it("AUTOMATION_ERROR when the AppleScript invocation throws", () => {
    terminalFocus.runOpenTerminalScript = () => {
      const err = new Error("execution error");
      err.stderr = "osascript: Not authorized to send Apple events to Terminal.";
      throw err;
    };
    const r = terminalFocus.openTerminalForSession({
      cwd: "/repo/agent-monitor",
      source: "local",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "AUTOMATION_ERROR");
    assert.match(r.message, /not authorized/i);
  });

  it("UNSUPPORTED_PLATFORM off-macOS", () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const r = terminalFocus.openTerminalForSession({
        cwd: "/repo/agent-monitor",
        source: "local",
      });
      assert.equal(r.ok, false);
      assert.equal(r.code, "UNSUPPORTED_PLATFORM");
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });
});

describe("openLoginTerminalForConfigDir — full branching", () => {
  beforeEach(() => {
    terminalFocus.runOpenTerminalScript = () => "";
  });

  it("succeeds and builds a `cd <home>` + CLAUDE_CONFIG_DIR-prefixed claude command", () => {
    let seenCd, seenClaude;
    terminalFocus.runOpenTerminalScript = (cdCommand, claudeCommand) => {
      seenCd = cdCommand;
      seenClaude = claudeCommand;
      return "";
    };
    const r = terminalFocus.openLoginTerminalForConfigDir("/Users/dev/.claude-accounts/primary");
    assert.deepEqual(r, { ok: true });
    assert.equal(seenCd, `cd '${os.homedir()}'`);
    assert.equal(seenClaude, "CLAUDE_CONFIG_DIR='/Users/dev/.claude-accounts/primary' claude");
  });

  it("shell-quotes a config dir with an embedded single quote", () => {
    let seenClaude;
    terminalFocus.runOpenTerminalScript = (_cd, claudeCommand) => {
      seenClaude = claudeCommand;
      return "";
    };
    terminalFocus.openLoginTerminalForConfigDir("/tmp/it's a dir");
    assert.equal(seenClaude, "CLAUDE_CONFIG_DIR='/tmp/it'\\''s a dir' claude");
  });

  it("NO_CONFIG_DIR when no config dir is provided", () => {
    for (const configDir of [null, undefined, ""]) {
      const r = terminalFocus.openLoginTerminalForConfigDir(configDir);
      assert.equal(r.ok, false);
      assert.equal(r.code, "NO_CONFIG_DIR");
    }
  });

  it("AUTOMATION_ERROR when the AppleScript invocation throws", () => {
    terminalFocus.runOpenTerminalScript = () => {
      const err = new Error("execution error");
      err.stderr = "osascript: Not authorized to send Apple events to Terminal.";
      throw err;
    };
    const r = terminalFocus.openLoginTerminalForConfigDir("/Users/dev/.claude-accounts/primary");
    assert.equal(r.ok, false);
    assert.equal(r.code, "AUTOMATION_ERROR");
    assert.match(r.message, /not authorized/i);
  });

  it("UNSUPPORTED_PLATFORM off-macOS", () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const r = terminalFocus.openLoginTerminalForConfigDir("/Users/dev/.claude-accounts/primary");
      assert.equal(r.ok, false);
      assert.equal(r.code, "UNSUPPORTED_PLATFORM");
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });
});

describe("openTerminalForCwd — prompt argument (never -c/--continue)", () => {
  beforeEach(() => {
    terminalFocus.runOpenTerminalScript = () => "";
  });

  it("builds a bare `claude` command when name/prompt are both omitted", () => {
    let seenClaude;
    terminalFocus.runOpenTerminalScript = (_cd, claudeCommand) => {
      seenClaude = claudeCommand;
      return "";
    };
    terminalFocus.openTerminalForCwd("/repo/agent-monitor");
    assert.equal(seenClaude, "claude");
  });

  it("appends the shell-quoted prompt as the trailing positional argument", () => {
    let seenClaude;
    terminalFocus.runOpenTerminalScript = (_cd, claudeCommand) => {
      seenClaude = claudeCommand;
      return "";
    };
    terminalFocus.openTerminalForCwd("/repo/agent-monitor", undefined, "Resume work here.");
    assert.equal(seenClaude, "claude 'Resume work here.'");
  });

  it("combines -n <name> and the prompt in one command, and never appends -c", () => {
    let seenClaude;
    terminalFocus.runOpenTerminalScript = (_cd, claudeCommand) => {
      seenClaude = claudeCommand;
      return "";
    };
    terminalFocus.openTerminalForCwd("/repo/agent-monitor", "my effort", "Resume work here.");
    assert.equal(seenClaude, "claude -n 'my effort' 'Resume work here.'");
    assert.doesNotMatch(seenClaude, /-c\b/);
    assert.doesNotMatch(seenClaude, /--continue/);
  });

  it("shell-quotes a prompt with an embedded single quote", () => {
    let seenClaude;
    terminalFocus.runOpenTerminalScript = (_cd, claudeCommand) => {
      seenClaude = claudeCommand;
      return "";
    };
    terminalFocus.openTerminalForCwd("/repo/agent-monitor", undefined, "it's uncommitted");
    assert.equal(seenClaude, "claude 'it'\\''s uncommitted'");
  });
});

describe("hook ingestion — pid resolved and persisted on SessionStart", () => {
  it("resolves the hint's real claude pid and stores it, first-seen-wins", async () => {
    terminalFocus.listProcesses = () =>
      new Map([["9001", { ppid: "1", args: "/usr/local/bin/claude" }]]);

    const sid = `pid-test-${Date.now()}`;
    let res = await req("POST", "/api/hooks/event", {
      hook_type: "SessionStart",
      data: { session_id: sid, cwd: "/tmp/proj", pid: 9001 },
    });
    assert.equal(res.status, 200);

    res = await req("GET", `/api/sessions/${sid}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.session.pid, 9001);

    // Second hook with a different pid hint must NOT overwrite the first.
    terminalFocus.listProcesses = () =>
      new Map([["9002", { ppid: "1", args: "/usr/local/bin/claude" }]]);
    res = await req("POST", "/api/hooks/event", {
      hook_type: "Stop",
      data: { session_id: sid, pid: 9002 },
    });
    assert.equal(res.status, 200);
    res = await req("GET", `/api/sessions/${sid}`);
    assert.equal(res.body.session.pid, 9001);
  });

  it("leaves pid null when the hint never resolves to a claude process", async () => {
    terminalFocus.listProcesses = () => new Map([["9003", { ppid: "1", args: "sh -c whatever" }]]);

    const sid = `pid-unresolved-${Date.now()}`;
    const res = await req("POST", "/api/hooks/event", {
      hook_type: "SessionStart",
      data: { session_id: sid, cwd: "/tmp/proj2", pid: 9003 },
    });
    assert.equal(res.status, 200);

    const get = await req("GET", `/api/sessions/${sid}`);
    assert.equal(get.body.session.pid, null);
  });
});

describe("POST /api/sessions/:id/focus-terminal — typed code to HTTP status", () => {
  let sid;

  before(async () => {
    terminalFocus.listProcesses = () =>
      new Map([["9100", { ppid: "1", args: "/usr/local/bin/claude" }]]);
    sid = `focus-terminal-route-${Date.now()}`;
    const res = await req("POST", "/api/hooks/event", {
      hook_type: "SessionStart",
      data: { session_id: sid, cwd: "/tmp/proj3", pid: 9100 },
    });
    assert.equal(res.status, 200);
  });

  it("404 for a session that doesn't exist", async () => {
    const res = await req("POST", "/api/sessions/does-not-exist/focus-terminal");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("maps each typed failure code to its documented HTTP status", async () => {
    const cases = [
      ["UNSUPPORTED_PLATFORM", 501],
      ["NOT_LOCAL", 409],
      ["NO_PID", 409],
      ["PROCESS_GONE", 410],
      ["TERMINAL_NOT_FOUND", 404],
      ["AUTOMATION_ERROR", 500],
    ];
    for (const [code, status] of cases) {
      terminalFocus.focusTerminalForSession = () => ({ ok: false, code, message: `msg:${code}` });
      const res = await req("POST", `/api/sessions/${sid}/focus-terminal`);
      assert.equal(res.status, status, `${code} should map to ${status}`);
      assert.equal(res.body.error.code, code);
    }
  });

  it("200 { ok: true } on success", async () => {
    terminalFocus.focusTerminalForSession = () => ({ ok: true });
    const res = await req("POST", `/api/sessions/${sid}/focus-terminal`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});

describe("POST /api/sessions/:id/open-terminal — typed code to HTTP status", () => {
  let sid;

  before(async () => {
    sid = `open-terminal-route-${Date.now()}`;
    const res = await req("POST", "/api/hooks/event", {
      hook_type: "SessionStart",
      data: { session_id: sid, cwd: "/tmp/proj4" },
    });
    assert.equal(res.status, 200);
  });

  it("404 for a session that doesn't exist", async () => {
    const res = await req("POST", "/api/sessions/does-not-exist/open-terminal");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("maps each typed failure code to its documented HTTP status", async () => {
    const cases = [
      ["UNSUPPORTED_PLATFORM", 501],
      ["NOT_LOCAL", 409],
      ["NO_CWD", 409],
      ["AUTOMATION_ERROR", 500],
    ];
    for (const [code, status] of cases) {
      terminalFocus.openTerminalForSession = () => ({ ok: false, code, message: `msg:${code}` });
      const res = await req("POST", `/api/sessions/${sid}/open-terminal`);
      assert.equal(res.status, status, `${code} should map to ${status}`);
      assert.equal(res.body.error.code, code);
    }
  });

  it("200 { ok: true } on success", async () => {
    terminalFocus.openTerminalForSession = () => ({ ok: true });
    const res = await req("POST", `/api/sessions/${sid}/open-terminal`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});
