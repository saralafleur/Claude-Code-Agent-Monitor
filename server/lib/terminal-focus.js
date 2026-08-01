/**
 * @file Resolves a session's OS process id to a live `claude` CLI process and,
 * on macOS, jumps the user to the exact Terminal.app tab it's running in —
 * selecting the tab, fronting the window, and flashing its background a few
 * times so the tab is visually unmistakable rather than just silently
 * focus-stolen. Also opens a brand-new Terminal.app window and starts a
 * fresh `claude` instance there — in a session's working directory (for
 * starting a second session against the same project without hunting down
 * the existing tab), or in any arbitrary folder (for the Projects "open
 * terminal in folder" picker, which has no session in the picture at all).
 * Fail-safe by design, same posture as session-liveness.js:
 * every unresolvable step (no pid recorded, pid no longer alive, no tty, no
 * cwd recorded, not on macOS, Terminal automation not yet authorized)
 * returns a typed `{ok: false, code, message}` result instead of throwing,
 * so the caller can surface a clear reason rather than a raw error.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { isClaudeCommand } = require("./session-liveness");

const APPLESCRIPT_PATH = path.join(__dirname, "scripts", "focus-terminal-tab.applescript");
const OPEN_APPLESCRIPT_PATH = path.join(__dirname, "scripts", "open-terminal-session.applescript");
const PS_TIMEOUT_MS = 5_000;
const OSASCRIPT_TIMEOUT_MS = 5_000;
// Longer than OSASCRIPT_TIMEOUT_MS: open-terminal-session.applescript can
// itself wait out a cold Terminal.app launch (up to 1s) plus a slow shell
// startup before submitting `claude` (up to 4s) as race guards - see that
// script's header comment. This timeout just needs to outlast both plus
// normal automation overhead.
const OPEN_TERMINAL_TIMEOUT_MS = 8_000;

/**
 * Snapshot of every live process as `{pid: {ppid, args}}`, or null if `ps`
 * isn't available / didn't answer (never throws).
 */
function listProcesses() {
  let psOut;
  try {
    psOut = execFileSync("ps", ["-Ao", "pid=,ppid=,args="], {
      encoding: "utf8",
      timeout: PS_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  const byPid = new Map();
  for (const line of psOut.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) byPid.set(m[1], { ppid: m[2], args: m[3] });
  }
  return byPid;
}

// Hops to climb from a hook's pid hint before giving up — one hop covers the
// common "hint is already the claude process" case, a second or third covers
// an intermediate `sh -c` wrapper some shells insert. Bounded so a bad/cyclic
// hint can't loop.
const MAX_ANCESTOR_HOPS = 4;

/**
 * Resolves a hook-reported pid hint (see scripts/hook-handler.js's
 * `process.ppid`) to the real `claude` CLI process, walking up the parent
 * chain when the hint itself is an intermediate shell wrapper rather than
 * `claude` directly. Returns the resolved pid, or null when nothing in the
 * walk matches (older/foreign hint, process already gone, non-darwin/linux
 * host, `ps` unavailable) — callers persist null exactly like any other
 * "unknown" field.
 * @param {number} hintPid
 * @returns {number|null}
 */
function resolveSessionPid(hintPid) {
  if (!Number.isInteger(hintPid) || hintPid <= 0) return null;
  if (process.platform === "win32") return null;
  // Routed through `exports` (not the local function reference) so tests can
  // swap `terminalFocus.listProcesses` for a deterministic fixture instead of
  // depending on this test run's own real OS process tree — same idiom
  // session-liveness.js uses for `liveness.probeLiveCwds`.
  const byPid = exports.listProcesses();
  if (!byPid) return null;

  let pid = String(hintPid);
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS && byPid.has(pid); hop++) {
    const proc = byPid.get(pid);
    if (isClaudeCommand(proc.args)) return Number(pid);
    if (proc.ppid === "0" || proc.ppid === "1" || proc.ppid === pid) break;
    pid = proc.ppid;
  }
  return null;
}

/** True when `pid` is still alive and is still a `claude` process — the
 *  liveness re-check done right before acting on a stored pid, since it may
 *  have died (or been reused by an unrelated process) since it was resolved. */
function isPidLiveClaude(pid) {
  const byPid = exports.listProcesses();
  if (!byPid) return false;
  const proc = byPid.get(String(pid));
  return !!proc && isClaudeCommand(proc.args);
}

/** Resolves `pid`'s controlling terminal device path, or null if it has none
 *  (headless/daemonized) or `ps` can't answer. */
function resolveTty(pid) {
  try {
    const out = execFileSync("ps", ["-o", "tty=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: PS_TIMEOUT_MS,
    }).trim();
    if (!out || out === "??" || out === "?") return null;
    return out.startsWith("/dev/") ? out : `/dev/${out}`;
  } catch {
    return null;
  }
}

/** Runs the bundled AppleScript against `tty`; returns its trimmed stdout
 *  ("found"/"not-found"). Throws on automation failure (commonly a not-yet-
 *  granted macOS Automation permission) — callers catch and translate. */
function runFocusScript(tty) {
  return execFileSync("osascript", [APPLESCRIPT_PATH, tty], {
    encoding: "utf8",
    timeout: OSASCRIPT_TIMEOUT_MS,
  }).trim();
}

/**
 * Attempts to jump the user to the Terminal.app tab running `session`.
 * @param {{pid?: number|null, source?: string|null}} session
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
function focusTerminalForSession(session) {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      code: "UNSUPPORTED_PLATFORM",
      message: "Jump-to-terminal is only supported on macOS (Terminal.app).",
    };
  }
  if (session.source && session.source !== "local") {
    return {
      ok: false,
      code: "NOT_LOCAL",
      message: "This session was collected from another machine, not this one.",
    };
  }
  const pid = session.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      ok: false,
      code: "NO_PID",
      message: "No process was recorded for this session (it may predate this feature).",
    };
  }
  if (!exports.isPidLiveClaude(pid)) {
    return {
      ok: false,
      code: "PROCESS_GONE",
      message: "The claude process for this session is no longer running.",
    };
  }
  const tty = exports.resolveTty(pid);
  if (!tty) {
    return {
      ok: false,
      code: "PROCESS_GONE",
      message: "Could not determine the terminal device for this session's process.",
    };
  }

  let result;
  try {
    result = exports.runFocusScript(tty);
  } catch (err) {
    const detail = err && err.stderr ? String(err.stderr).trim() : err.message;
    return {
      ok: false,
      code: "AUTOMATION_ERROR",
      message: `Terminal automation failed (${detail}). If this is the first attempt, grant Terminal automation access in System Settings > Privacy & Security > Automation.`,
    };
  }

  if (result === "found") return { ok: true };
  return {
    ok: false,
    code: "TERMINAL_NOT_FOUND",
    message: "Couldn't find a Terminal.app tab for this session's process.",
  };
}

/** Single-quotes `s` for safe splicing into a shell command string (closes
 *  the quote, emits an escaped literal quote, reopens it) — the standard
 *  `'\''` idiom for embedding arbitrary text, including embedded quotes, in
 *  a POSIX shell single-quoted argument. */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Runs the bundled AppleScript with `cdCommand` and `claudeCommand` as two
 *  separate argv elements (never interpolated into the script source);
 *  Terminal.app runs `cdCommand` in a fresh window, then submits
 *  `claudeCommand` into that same tab as a distinct, second command —
 *  rather than one chained `cd ... && claude` line. Throws on automation
 *  failure (commonly a not-yet-granted macOS Automation permission) —
 *  callers catch and translate. */
function runOpenTerminalScript(cdCommand, claudeCommand) {
  return execFileSync("osascript", [OPEN_APPLESCRIPT_PATH, cdCommand, claudeCommand], {
    encoding: "utf8",
    timeout: OPEN_TERMINAL_TIMEOUT_MS,
  });
}

/**
 * Opens a brand-new Terminal.app window in `cwd` and starts a fresh `claude`
 * instance in it. The lower-level primitive shared by `openTerminalForSession`
 * (session-scoped: adds the NOT_LOCAL check and session-flavored NO_CWD
 * message below) and the Projects "open terminal in folder" picker
 * (project-scoped: a project's mapped folder has no notion of a Remote Data
 * Source session at all, so it calls this directly with an already-validated
 * cwd from the project's own `paths`).
 * @param {string|null|undefined} cwd
 * @param {string|null|undefined} name Optional effort/session name. When
 *   given, passed as `claude -n <name>` so the fresh session starts already
 *   titled - the same custom-title channel as `/rename` and the picker's
 *   Ctrl+R (see server/routes/sessions.js's TRANSCRIPT_RENDER_TYPES comment).
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
function openTerminalForCwd(cwd, name) {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      code: "UNSUPPORTED_PLATFORM",
      message: "Opening a new terminal is only supported on macOS (Terminal.app).",
    };
  }
  if (!cwd) {
    return {
      ok: false,
      code: "NO_CWD",
      message: "No working directory was provided.",
    };
  }

  const nameFlag = name ? ` -n ${exports.shellQuote(name)}` : "";
  const cdCommand = `cd ${exports.shellQuote(cwd)}`;
  const claudeCommand = `claude${nameFlag}`;
  try {
    exports.runOpenTerminalScript(cdCommand, claudeCommand);
  } catch (err) {
    const detail = err && err.stderr ? String(err.stderr).trim() : err.message;
    return {
      ok: false,
      code: "AUTOMATION_ERROR",
      message: `Terminal automation failed (${detail}). If this is the first attempt, grant Terminal automation access in System Settings > Privacy & Security > Automation.`,
    };
  }
  return { ok: true };
}

/**
 * Opens a brand-new Terminal.app window in `session`'s working directory and
 * starts a fresh `claude` instance in it — the counterpart to
 * `focusTerminalForSession` for starting a second session against the same
 * project rather than jumping to the existing one. Unlike
 * `focusTerminalForSession`, this doesn't require the session's original
 * process to still be alive (or to have ever resolved a pid at all) — only
 * its recorded working directory.
 * @param {{cwd?: string|null, source?: string|null}} session
 * @param {string|null|undefined} name Optional effort/session name, forwarded
 *   to `openTerminalForCwd` - see its doc comment.
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
function openTerminalForSession(session, name) {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      code: "UNSUPPORTED_PLATFORM",
      message: "Opening a new terminal is only supported on macOS (Terminal.app).",
    };
  }
  if (session.source && session.source !== "local") {
    return {
      ok: false,
      code: "NOT_LOCAL",
      message: "This session was collected from another machine, not this one.",
    };
  }
  if (!session.cwd) {
    return {
      ok: false,
      code: "NO_CWD",
      message: "No working directory was recorded for this session.",
    };
  }
  return exports.openTerminalForCwd(session.cwd, name);
}

// Assigned onto the existing `exports` object (never `module.exports = {...}`,
// which would swap in a fresh object and break the `exports.xxx()` internal
// call sites above) so a test can do
// `require("./terminal-focus").listProcesses = fakeFn` and have that fake
// actually take effect inside resolveSessionPid/isPidLiveClaude/
// focusTerminalForSession — the same swap-the-module-object idiom
// session-liveness.js's callers already use for `liveness.probeLiveCwds`.
exports.listProcesses = listProcesses;
exports.resolveSessionPid = resolveSessionPid;
exports.isPidLiveClaude = isPidLiveClaude;
exports.resolveTty = resolveTty;
exports.runFocusScript = runFocusScript;
exports.focusTerminalForSession = focusTerminalForSession;
exports.shellQuote = shellQuote;
exports.runOpenTerminalScript = runOpenTerminalScript;
exports.openTerminalForCwd = openTerminalForCwd;
exports.openTerminalForSession = openTerminalForSession;
