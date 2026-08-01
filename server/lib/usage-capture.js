/**
 * @file usage-capture.js
 * @description Drives a real `claude` CLI session inside a detached tmux
 * pane to capture the `/status` and `/usage` TUI panels as plain text, then
 * best-effort parses both into the `usage_captures` row shape (see
 * server/db.js). This is the same technique as the repo-root
 * `capture-claude-usage.sh` ad hoc script, reimplemented in Node so the
 * dashboard's "Usage" page can trigger a capture on demand and persist the
 * result instead of leaving it as a throwaway text file.
 *
 * Parsing is deliberately defensive: `/status` and `/usage` are TUI panels
 * that can reformat between CLI versions, so every structured field is
 * best-effort and `raw_status_text`/`raw_usage_text` are always stored
 * regardless of parse success. `status` on the returned row is:
 *   - "ok"      — capture succeeded and the key fields parsed
 *   - "partial" — capture succeeded but some/all structured fields didn't
 *                 match (raw text is still there for the user to read)
 *   - "error"   — the capture itself failed (missing tmux/claude, timeout,
 *                 spawn error); no panel text was ever captured
 *
 * Only one capture may run at a time (guarded in-process) since it drives a
 * single tmux session and there's nothing to gain from overlapping runs.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { execFile } = require("node:child_process");
const usageCapturesDb = require("./usage-captures-db");

// Mirrors capture-claude-usage.sh's own timing: claude needs a few seconds to
// boot before it accepts input, and each TUI panel needs a moment to render
// after the slash command is sent.
const BOOT_WAIT_MS = 5000;
const STATUS_RENDER_WAIT_MS = 2500;
const USAGE_RENDER_WAIT_MS = 4000;
const EXIT_SETTLE_MS = 500;

let capturing = false;

function isCapturing() {
  return capturing;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", timeout: 10000, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function which(bin) {
  return new Promise((resolve) => {
    execFile(process.platform === "win32" ? "where" : "which", [bin], (err, stdout) => {
      resolve(!err && Boolean((stdout || "").trim()));
    });
  });
}

function toNumber(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parses "1.2k" / "3.4m" / "12,345" style token counts into a plain integer. */
function parseTokenCount(raw) {
  if (raw == null) return null;
  const m = String(raw)
    .trim()
    .match(/^([\d.,]+)\s*([km])?$/i);
  if (!m) return toNumber(raw);
  const base = toNumber(m[1]);
  if (base == null) return null;
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") return Math.round(base * 1000);
  if (suffix === "m") return Math.round(base * 1000000);
  return Math.round(base);
}

/** Parses "1h 2m 3s" / "45m 10s" / "12s" style durations into total seconds. */
function parseDurationToSeconds(raw) {
  if (!raw) return null;
  const str = String(raw);
  let total = 0;
  let matched = false;
  const h = str.match(/(\d+(?:\.\d+)?)\s*h/i);
  const m = str.match(/(\d+(?:\.\d+)?)\s*m(?!s)/i);
  const s = str.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (h) {
    total += parseFloat(h[1]) * 3600;
    matched = true;
  }
  if (m) {
    total += parseFloat(m[1]) * 60;
    matched = true;
  }
  if (s) {
    total += parseFloat(s[1]);
    matched = true;
  }
  return matched ? total : toNumber(str);
}

/** First capture-group match of `labelRegex` across `lines`, trimmed. */
function findLineValue(lines, labelRegex) {
  for (const line of lines) {
    const m = line.match(labelRegex);
    if (m) return m[1].trim();
  }
  return null;
}

function parseStatusPane(text) {
  const out = {
    accountEmail: null,
    accountOrg: null,
    loginMethod: null,
    cliVersion: null,
    model: null,
  };
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  out.accountEmail = findLineValue(lines, /email[:\s]+([^\s]+@[^\s]+)/i);
  out.accountOrg = findLineValue(lines, /organi[sz]ation[:\s]+(.+)/i);
  out.loginMethod = findLineValue(lines, /login method[:\s]+(.+)/i);
  out.model = findLineValue(lines, /\bmodel[:\s]+(.+)/i);
  out.cliVersion =
    findLineValue(lines, /claude code\)?\D*v?(\d+\.\d+\.\d+)/i) ||
    findLineValue(lines, /\bversion[:\s]+v?(\d+\.\d+\.\d+)/i);
  return out;
}

/** Bullet lines following a section heading, up to the next blank line or heading. */
function extractSection(lines, headingRegex) {
  const idx = lines.findIndex((l) => headingRegex.test(l));
  if (idx < 0) return null;
  const items = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;
    if (/^[A-Z][A-Za-z ]{2,30}:?$/.test(line.trim())) break;
    items.push(line.trim());
  }
  return items.length > 0 ? JSON.stringify(items) : null;
}

/** First "<pct>%" (and its nearby "resets ..." line) at/after `startIdx`. */
function pctFromSection(lines, startIdx) {
  if (startIdx < 0) return { pct: null, reset: null };
  for (let i = startIdx; i < Math.min(lines.length, startIdx + 15); i++) {
    const pm = lines[i].match(/(\d{1,3})%/);
    if (pm) {
      let reset = null;
      for (let j = i; j < Math.min(lines.length, i + 4); j++) {
        const rm = lines[j].match(/resets?[:\s]+(.+)/i);
        if (rm) {
          reset = rm[1].trim();
          break;
        }
      }
      return { pct: toNumber(pm[1]), reset };
    }
  }
  return { pct: null, reset: null };
}

function parseUsagePane(text) {
  const out = {
    sessionCostUsd: null,
    sessionDurationApiS: null,
    sessionDurationWallS: null,
    linesAdded: null,
    linesRemoved: null,
    sessionInputTokens: null,
    sessionOutputTokens: null,
    sessionCacheReadTokens: null,
    sessionCacheWriteTokens: null,
    sessionWindowPct: null,
    sessionWindowResetRaw: null,
    weekWindowPct: null,
    weekResetRaw: null,
    weekPctByModelJson: null,
    contributingFactorsJson: null,
    skillsJson: null,
    subagentsJson: null,
  };
  if (!text) return out;
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const costRaw = findLineValue(lines, /cost[:\s]+\$([\d.]+)/i);
  out.sessionCostUsd = costRaw != null ? toNumber(costRaw) : null;

  const apiDurRaw = findLineValue(lines, /api duration[:\s]+(.+)/i);
  out.sessionDurationApiS = apiDurRaw ? parseDurationToSeconds(apiDurRaw) : null;

  const wallDurRaw =
    findLineValue(lines, /wall duration[:\s]+(.+)/i) ||
    findLineValue(lines, /wall.?clock[^:]*[:\s]+(.+)/i);
  out.sessionDurationWallS = wallDurRaw ? parseDurationToSeconds(wallDurRaw) : null;

  const linesLine = lines.find(
    (l) => /lines? (added|changed)/i.test(l) || /\+[\d,]+.*-[\d,]+/.test(l)
  );
  if (linesLine) {
    const addM = linesLine.match(/\+([\d,]+)/);
    const remM = linesLine.match(/-([\d,]+)/);
    out.linesAdded = addM ? toNumber(addM[1]) : null;
    out.linesRemoved = remM ? toNumber(remM[1]) : null;
  }

  const inputRaw = findLineValue(lines, /input tokens?[:\s]+([\d.,]+\s*[km]?)/i);
  out.sessionInputTokens = inputRaw ? parseTokenCount(inputRaw) : null;
  const outputRaw = findLineValue(lines, /output tokens?[:\s]+([\d.,]+\s*[km]?)/i);
  out.sessionOutputTokens = outputRaw ? parseTokenCount(outputRaw) : null;
  const cacheReadRaw = findLineValue(lines, /cache read[^:]*[:\s]+([\d.,]+\s*[km]?)/i);
  out.sessionCacheReadTokens = cacheReadRaw ? parseTokenCount(cacheReadRaw) : null;
  const cacheWriteRaw = findLineValue(
    lines,
    /cache (?:creation|write)[^:]*[:\s]+([\d.,]+\s*[km]?)/i
  );
  out.sessionCacheWriteTokens = cacheWriteRaw ? parseTokenCount(cacheWriteRaw) : null;

  // Session (5h) rate-limit window renders as a "<pct>%" figure under its own
  // heading, with a nearby "resets ..." line.
  const sessionSectionIdx = lines.findIndex((l) =>
    /current session|session limit|5.?hour/i.test(l)
  );
  const sessionPct = pctFromSection(lines, sessionSectionIdx);
  out.sessionWindowPct = sessionPct.pct;
  out.sessionWindowResetRaw = sessionPct.reset;

  // The weekly window renders as one or more "Current week (<label>)"
  // headings, each followed within a few lines by its own "<pct>% used" bar
  // (and, on the first one, a "resets ..." line). "all models" is the
  // aggregate figure — the weekly counterpart to session_window_pct — and
  // any other label (e.g. "Fable") is a per-model breakdown entry.
  const weekHeadingRe = /^current week\s*\(([^)]+)\)/i;
  const weekByModel = {};
  for (let i = 0; i < lines.length; i++) {
    const headingM = lines[i].match(weekHeadingRe);
    if (!headingM) continue;
    const { pct, reset } = pctFromSection(lines, i);
    if (reset && out.weekResetRaw == null) out.weekResetRaw = reset;
    const label = headingM[1].trim();
    if (/^all models$/i.test(label)) {
      out.weekWindowPct = pct;
    } else if (pct != null) {
      weekByModel[label] = pct;
    }
  }
  if (Object.keys(weekByModel).length > 0) out.weekPctByModelJson = JSON.stringify(weekByModel);

  out.contributingFactorsJson = extractSection(lines, /contributing factors?/i);
  out.skillsJson = extractSection(lines, /^skills?\b/i);
  out.subagentsJson = extractSection(lines, /sub-?agents?/i);

  return out;
}

/**
 * Runs one capture: spawns `claude` in a detached tmux session in `cwd`,
 * drives `/status` then `/usage`, captures both panes, tears the session
 * down, parses what it can, and persists the result. Always resolves with
 * the persisted row (even on failure — the row just carries status:"error");
 * only throws for a precondition it refuses to attempt (concurrent capture).
 */
async function runCapture({ cwd } = {}) {
  if (capturing) {
    const err = new Error("a usage capture is already in progress");
    err.code = "ECAPTURING";
    throw err;
  }
  capturing = true;
  try {
    const workDir = cwd || process.cwd();
    const session = `ccam_usage_${process.pid}_${Date.now()}`;
    let rawStatusText = "";
    let rawUsageText = "";
    let errorMessage = null;

    const [hasTmux, hasClaude] = await Promise.all([which("tmux"), which("claude")]);
    if (!hasTmux || !hasClaude) {
      return usageCapturesDb.recordCapture({
        cwd: workDir,
        status: "error",
        errorMessage: !hasTmux ? "tmux not found on PATH" : "claude not found on PATH",
      });
    }

    try {
      await execFileP(
        "tmux",
        ["new-session", "-d", "-s", session, "-x", "220", "-y", "50", "claude"],
        { cwd: workDir }
      );
      await sleep(BOOT_WAIT_MS);

      await execFileP("tmux", ["send-keys", "-t", session, "/status", "Enter"]);
      await sleep(STATUS_RENDER_WAIT_MS);
      const statusCapture = await execFileP("tmux", ["capture-pane", "-t", session, "-p"]);
      rawStatusText = statusCapture.stdout || "";

      await execFileP("tmux", ["send-keys", "-t", session, "Escape"]);
      await sleep(300);
      await execFileP("tmux", ["send-keys", "-t", session, "/usage", "Enter"]);
      await sleep(USAGE_RENDER_WAIT_MS);
      const usageCapture = await execFileP("tmux", ["capture-pane", "-t", session, "-p"]);
      rawUsageText = usageCapture.stdout || "";

      await execFileP("tmux", ["send-keys", "-t", session, "Escape"]).catch(() => {});
      await sleep(EXIT_SETTLE_MS);
      await execFileP("tmux", ["send-keys", "-t", session, "C-c"]).catch(() => {});
    } catch (err) {
      errorMessage = err.message;
    } finally {
      await execFileP("tmux", ["kill-session", "-t", session]).catch(() => {});
    }

    const parsedStatus = parseStatusPane(rawStatusText);
    const parsedUsage = parseUsagePane(rawUsageText);

    let status;
    if (!rawStatusText && !rawUsageText) {
      status = "error";
    } else if (errorMessage || !rawStatusText || !rawUsageText || !parsedStatus.model) {
      status = "partial";
    } else {
      status = "ok";
    }

    return usageCapturesDb.recordCapture({
      cwd: workDir,
      status,
      errorMessage,
      ...parsedStatus,
      ...parsedUsage,
      rawStatusText,
      rawUsageText,
    });
  } finally {
    capturing = false;
  }
}

module.exports = {
  runCapture,
  isCapturing,
  // Exported for unit testing the parsers directly against fixture text.
  __parseStatusPane: parseStatusPane,
  __parseUsagePane: parseUsagePane,
  __parseDurationToSeconds: parseDurationToSeconds,
  __parseTokenCount: parseTokenCount,
};
