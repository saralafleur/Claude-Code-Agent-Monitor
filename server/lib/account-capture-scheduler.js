/**
 * @file account-capture-scheduler.js
 * @description Automatic background capture for every enabled named
 * account (server/routes/accounts.js), on a tick — scheduler shape mirrors
 * `playbook/engine.js`'s almost verbatim (boot delay, `setInterval`, a
 * `running` re-entrancy guard, `unref()`'d timers, an env-var kill switch).
 *
 * Exists because the Usage page's "Activity" card infers whether an account
 * is actively being used from movement in its own session/weekly rate-limit
 * percentage between captures (see `computeLastUsedAt` in
 * server/routes/accounts.js) rather than from anything CLAUDE_CONFIG_DIR-
 * local — a real account is very often "used" through whichever profile is
 * logged into the *default* `~/.claude` dir, not through the named
 * CLAUDE_CONFIG_DIR these accounts point at (those exist purely so this
 * dashboard can read each one's own OAuth credential to poll its usage %).
 * Percentage movement is a real, config-dir-independent usage signal, but
 * only if there's something recent to diff against — hence this scheduler,
 * so the percentages refresh on their own instead of only on a manual click.
 *
 * Captures accounts sequentially, not in parallel: each reads a live OS
 * credential and calls Anthropic's API, and this app has no latency
 * requirement that would justify the added complexity of concurrency here.
 * A per-account try/catch means one account's failure (e.g. `needs_login`)
 * never stops the rest of the tick.
 *
 * Env knobs:
 *   DASHBOARD_ACCOUNT_CAPTURE_MODE  on (default) | off
 *   DASHBOARD_ACCOUNT_CAPTURE_MS    tick interval, default 300000 (5m)
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const DEFAULT_TICK_MS = 300_000;
const BOOT_DELAY_MS = 30_000;

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** One tick: every enabled account gets a fresh capture attempt. */
async function tick() {
  const { stmts } = require("../db");
  const { captureAccount } = require("./account-capture");
  const accounts = stmts.listAccounts.all().filter((a) => a.enabled);
  for (const account of accounts) {
    try {
      await captureAccount(account);
    } catch {
      /* per-account fail-safe: one bad account must not stop the tick */
    }
  }
}

/** Start the scheduler loop: boot-delay tick, then a slow steady-state interval. */
function startAccountCaptureScheduler() {
  const mode = (process.env.DASHBOARD_ACCOUNT_CAPTURE_MODE || "on").toLowerCase();
  if (mode === "off") return;
  const tickMs = numEnv("DASHBOARD_ACCOUNT_CAPTURE_MS", DEFAULT_TICK_MS);
  if (!Number.isFinite(tickMs) || tickMs <= 0) return;

  let running = false;
  const runTick = () => {
    if (running) return;
    running = true;
    tick()
      .catch(() => {
        /* a bad tick must not take down the scheduler */
      })
      .finally(() => {
        running = false;
      });
  };

  const boot = setTimeout(runTick, BOOT_DELAY_MS);
  if (boot.unref) boot.unref();

  const timer = setInterval(runTick, tickMs);
  if (timer.unref) timer.unref();
}

module.exports = { startAccountCaptureScheduler, tick };
