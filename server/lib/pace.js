/**
 * Pace tracking derivation (layer 5).
 *
 * The single shared computation for "is this plan item on schedule." Pure
 * functions only — no DB, no I/O, `now` injectable for deterministic tests.
 * Every other layer (layer 6's R1 rule, the plans route, future `ccam`
 * output, and any eventual layer-7 UI) must call these functions rather than
 * re-deriving the comparison (PROJECT-CONTEXT.md §9.1 DERIVED-DUAL-VIEW).
 *
 * Completion signal (DEC-5): an item counts as complete when EITHER
 * `checked` (the human-owned checkbox mirrored from AGENT-PLAN.md) OR
 * `declared_done_at` (the agent's own claim via "ccam focus done N") is set.
 * `checked` takes precedence when both are set.
 *
 * target_date format (DEC-6): date-only `YYYY-MM-DD`, interpreted as a local
 * calendar day — not a UTC instant. An item whose target_date equals today
 * is on_track (grace runs through the end of the target day); behind starts
 * the next local day. An unparseable/invalid stored value degrades to
 * no_target, never to behind.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

// The complete, canonical set of pace statuses this module can report.
// Any new status value must be added here first — the registry-completeness
// meta-test in pace-tracking.test.js iterates this array and fails if a
// value goes unexercised or if paceStatus() ever returns something absent
// from it.
const PACE_STATUSES = ["no_target", "on_track", "behind", "done"];

// Default grace period (days past target_date still counted on_track) when
// DASHBOARD_PACE_GRACE_DAYS isn't set. Every caller of paceStatus() that
// wants the env-configured grace period (reconciliation.js's R1 rule, the
// layer-7 portfolio summary route) reads it through this one function
// instead of re-parsing the env var itself (§9.1 DERIVED-DUAL-VIEW) — a
// second hardcoded default here and there is exactly how two callers drift.
const DEFAULT_PACE_GRACE_DAYS = 1;

function paceGraceDaysFromEnv() {
  const v = Number(process.env.DASHBOARD_PACE_GRACE_DAYS);
  return Number.isFinite(v) ? v : DEFAULT_PACE_GRACE_DAYS;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// YYYY-MM-DD in local time (en-CA formatting gives ISO order directly).
function localDayString(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-CA");
}

// Is a stored target_date string a real, parseable calendar date in the
// expected format? Rejects malformed strings (wrong separators, non-dates)
// without ever throwing.
function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  // Guard against JS Date's rollover behavior (e.g. 2026-02-30 -> 2026-03-02):
  // re-render and compare back to the input.
  return localDayString(d) === value;
}

// complete: bool, signal: "checked" | "declared" | null (which signal fired,
// precedence: checked first).
function isComplete(item) {
  if (item && item.checked === 1) {
    return { complete: true, signal: "checked" };
  }
  if (item && item.declared_done_at) {
    return { complete: true, signal: "declared" };
  }
  return { complete: false, signal: null };
}

// Number of local calendar days between two YYYY-MM-DD strings (a - b, both
// already validated as real dates).
function daysBetween(aStr, bStr) {
  const a = new Date(`${aStr}T00:00:00`);
  const b = new Date(`${bStr}T00:00:00`);
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

// paceStatus(item, { now, graceDays }) -> { status, target_date, days_overdue, completed_signal }
function paceStatus(item, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const graceDays = Number.isFinite(opts.graceDays) ? opts.graceDays : 0;

  const targetDate = item && item.target_date != null ? item.target_date : null;
  const completion = isComplete(item);

  // 1. Completed items are never behind, however late (QA's rule, DEC-5).
  if (completion.complete) {
    return {
      status: "done",
      target_date: targetDate,
      days_overdue: 0,
      completed_signal: completion.signal,
    };
  }

  // 2. No target_date, or a value that isn't a real YYYY-MM-DD date, must
  //    never manufacture an alarm.
  if (!isValidDateString(targetDate)) {
    return {
      status: "no_target",
      target_date: targetDate,
      days_overdue: 0,
      completed_signal: null,
    };
  }

  const today = localDayString(now);
  const overdue = daysBetween(today, targetDate); // positive = late

  // 3/4. Boundary pinned per DEC-6: target_date === today is on_track;
  // behind starts the next local day. graceDays extends the on_track window.
  if (overdue > graceDays) {
    return {
      status: "behind",
      target_date: targetDate,
      days_overdue: overdue,
      completed_signal: null,
    };
  }

  return {
    status: "on_track",
    target_date: targetDate,
    days_overdue: Math.max(overdue, 0),
    completed_signal: null,
  };
}

module.exports = {
  PACE_STATUSES,
  localDayString,
  isComplete,
  paceStatus,
  paceGraceDaysFromEnv,
};
