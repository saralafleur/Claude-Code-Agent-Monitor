/**
 * @file Express router for the global Usage-page color thresholds — a
 * single global, server-shared config (this app has no user accounts, so
 * there is exactly one setting for every connected client/computer)
 * controlling where the green/yellow/orange/red bands fall for every
 * percentage-driven color on the Usage page. Four independent scopes:
 * `session`/`weekly` (raw %-used, the original two, 0-100 scale) plus
 * `sessionRate`/`weeklyRate` (the Consumption Rate card's pace-ratio — a
 * RAW multiplier of sustainable pace, e.g. `1.5` for "1.5x sustainable
 * pace," not a percentage), since a burn-rate pace ratio and a raw %-used
 * don't belong on the same ramp or the same numeric scale:
 *
 *   GET /api/color-thresholds — current
 *     { session: {...}, weekly: {...}, sessionRate: {...}, weeklyRate: {...} }
 *     (each `{yellowAt,orangeAt,redAt}`)
 *   PUT /api/color-thresholds — patch any subset of the four scopes, and
 *     within a scope any subset of its three fields; broadcasts the
 *     resulting full state over the WebSocket (`color_thresholds_updated`)
 *     so every other connected client picks up the change live, without a
 *     reload.
 *
 * Persisted in the singleton `color_thresholds` row (server/db.js). Wire
 * shape is camelCase; DB columns are snake_case — same convention
 * server/routes/monitors.js uses.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const { stmts } = require("../db");
const { broadcast } = require("../websocket");

const router = Router();

const MIN_VALUE = 0;
const MAX_VALUE = 1000;
const SCOPES = ["session", "weekly", "sessionRate", "weeklyRate"];
// Maps a wire scope name to its DB column prefix — sessionRate/weeklyRate
// use a `_rate_` infix (session_rate_yellow_at) rather than `session` +
// "Rate" concatenating directly, since the DB columns were added as their
// own explicit prefix (see server/db.js's migration).
const SCOPE_COLUMN_PREFIX = {
  session: "session",
  weekly: "weekly",
  sessionRate: "session_rate",
  weeklyRate: "weekly_rate",
};
const FIELDS = ["yellowAt", "orangeAt", "redAt"];

class ValidationError extends Error {}

/** Validates one threshold field is a finite number in [MIN_VALUE, MAX_VALUE]. */
function validateValue(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${name} must be a finite number`);
  }
  if (value < MIN_VALUE || value > MAX_VALUE) {
    throw new ValidationError(`${name} must be between ${MIN_VALUE} and ${MAX_VALUE}`);
  }
  return value;
}

function serialize(row) {
  const result = {};
  for (const scope of SCOPES) {
    const prefix = SCOPE_COLUMN_PREFIX[scope];
    result[scope] = {
      yellowAt: row[`${prefix}_yellow_at`],
      orangeAt: row[`${prefix}_orange_at`],
      redAt: row[`${prefix}_red_at`],
    };
  }
  return result;
}

// Validates a patch to one scope (any subset of yellowAt/orangeAt/redAt),
// merges it onto that scope's current values, and checks the merged result
// stays in strictly increasing order - a green→yellow→orange→red ramp with
// a non-increasing boundary would render nonsensically (a "later" color
// band that never actually applies, or applies before an earlier one).
function validateScopePatch(scopeName, patch, current) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new ValidationError(`${scopeName} must be an object`);
  }
  const merged = { ...current };
  for (const field of FIELDS) {
    if (patch[field] !== undefined) {
      merged[field] = validateValue(`${scopeName}.${field}`, patch[field]);
    }
  }
  if (!(merged.yellowAt < merged.orangeAt && merged.orangeAt < merged.redAt)) {
    throw new ValidationError(
      `${scopeName} thresholds must be strictly increasing: yellowAt < orangeAt < redAt`
    );
  }
  return merged;
}

// GET / — current global thresholds for all four scopes.
router.get("/", (_req, res) => {
  res.json(serialize(stmts.getColorThresholds.get()));
});

// PUT / — patch any subset of { session, weekly, sessionRate, weeklyRate };
// within a scope, any subset of { yellowAt, orangeAt, redAt }.
router.put("/", (req, res) => {
  const body = req.body || {};
  const current = serialize(stmts.getColorThresholds.get());
  const merged = {};
  try {
    for (const scope of SCOPES) {
      if (body[scope] !== undefined) {
        merged[scope] = validateScopePatch(scope, body[scope], current[scope]);
      }
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: { code: "INVALID_THRESHOLDS", message: err.message } });
    }
    throw err;
  }
  // updateColorThresholds's positional params follow this same
  // scope-then-field order (see server/db.js) — one COALESCE triplet per
  // scope, in SCOPES order, so an unpatched scope's three params are all
  // null and its existing values pass through untouched.
  const args = SCOPES.flatMap((scope) =>
    FIELDS.map((field) => (merged[scope] ? merged[scope][field] : null))
  );
  stmts.updateColorThresholds.run(...args);
  const result = serialize(stmts.getColorThresholds.get());
  broadcast("color_thresholds_updated", result);
  res.json(result);
});

module.exports = router;
