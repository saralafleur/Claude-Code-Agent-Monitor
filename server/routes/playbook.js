/**
 * @file Express router for the Coach's Playbook — the catalog of practices
 * and their user-editable config:
 *
 *   GET /api/playbook/practices — every catalog practice merged with its
 *     stored config (or catalog defaults if never touched):
 *     { id, category, scope, kind, defaultSeverity, fields, enabled, config,
 *       kindOverride, severityOverride, resolvedKind, resolvedSeverity }.
 *     `kind`/`defaultSeverity` are the catalog built-ins (unchanged meaning);
 *     `kindOverride`/`severityOverride` are the stored per-practice override
 *     (null = unset); `resolvedKind`/`resolvedSeverity` are the effective
 *     values the engine would stamp onto a new Observation right now — all
 *     computed by the single resolver, `resolvePracticeConfig()`
 *     (server/lib/playbook/practices.js).
 *   PUT /api/playbook/practices/:id/config — patch
 *     { enabled?, config?, kindOverride?, severityOverride? }; validates
 *     `config` keys against that practice's own `fields` schema and the two
 *     override keys against the pinned `KIND_VALUES`/`SEVERITY_VALUES`
 *     enums, persists, and broadcasts the merged practice over the WebSocket
 *     (`playbook_practice_config_updated`) so every other connected client
 *     picks up the change live, without a reload — same pattern as
 *     server/routes/color-thresholds.js. Every field is independently
 *     optional and partial-patch (an omitted key leaves it unchanged; an
 *     explicit `null` on an override key clears it back to the catalog
 *     default) — see `validateOverridePatch()`/the `PUT` handler below.
 *
 * Practice config is server-shared (this app has no user accounts, so one
 * setting applies to every connected computer), persisted per-practice in
 * `playbook_practice_config` (server/db.js). See server/lib/playbook/ for
 * the catalog + evaluation engine, and library knowledge
 * `product/coach/coach-playbook-vocabulary.md` for the vocabulary.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const { stmts } = require("../db");
const { broadcast } = require("../websocket");
const {
  PRACTICES,
  PRACTICES_BY_ID,
  resolvePracticeConfig,
  KIND_VALUES,
  SEVERITY_VALUES,
  coerceEnum,
} = require("../lib/playbook/practices");

const router = Router();

class ValidationError extends Error {}

// serializePractice() reads kind/defaultSeverity from the resolver's
// catalogKind/catalogSeverity (never off `practice` directly) so this route
// stays on the single resolver path enforced by
// server/__tests__/playbook-resolver-guard.test.js. `kindOverride` /
// `severityOverride` are the raw stored values (null = unset);
// `resolvedKind` / `resolvedSeverity` are what the engine would stamp onto a
// new Observation right now.
function serializePractice(practice) {
  const row = stmts.getPlaybookPracticeConfig.get(practice.id);
  const r = resolvePracticeConfig(row, practice);
  return {
    id: practice.id,
    category: practice.category,
    scope: practice.scope,
    kind: r.catalogKind,
    defaultSeverity: r.catalogSeverity,
    fields: practice.fields,
    enabled: r.enabled,
    config: r.config,
    kindOverride: r.kindOverride,
    severityOverride: r.severityOverride,
    resolvedKind: r.kind,
    resolvedSeverity: r.severity,
  };
}

// Validates a config patch against the practice's own field schema - only
// known keys, only finite numbers at or above that field's minimum. Unknown
// keys are rejected outright rather than silently dropped, so a typo'd
// field name surfaces immediately instead of quietly doing nothing.
function validateConfigPatch(practice, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new ValidationError("config must be an object");
  }
  const fieldsByKey = new Map(practice.fields.map((f) => [f.key, f]));
  for (const key of Object.keys(patch)) {
    const field = fieldsByKey.get(key);
    if (!field) {
      throw new ValidationError(`unknown config field "${key}" for practice "${practice.id}"`);
    }
    const value = patch[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ValidationError(`${key} must be a finite number`);
    }
    if (value < field.min) {
      throw new ValidationError(`${key} must be at least ${field.min}`);
    }
  }
}

// Validates a top-level kindOverride/severityOverride patch. Same shared
// KIND_VALUES/SEVERITY_VALUES/coerceEnum vocabulary the resolver reads (Step
// 1 / practices.js) — one vocabulary, two dispositions: the resolver coerces
// an invalid *stored* value to the catalog default without throwing (it runs
// outside the engine's per-session/per-global try/catch, so a throw there
// would kill the whole tick); this route, by contrast, must be loud, because
// a rejected PUT is recoverable and a silently-dropped one is not.
function validateOverridePatch(body) {
  for (const [key, allowed] of [
    ["kindOverride", KIND_VALUES],
    ["severityOverride", SEVERITY_VALUES],
  ]) {
    if (!(key in body)) continue; // omitted -> unchanged
    const value = body[key];
    if (value === null) continue; // explicit clear -> back to catalog default
    if (coerceEnum(value, allowed) === null) {
      throw new ValidationError(`${key} must be null or one of: ${allowed.join(", ")}`);
    }
  }
}

// GET / — every catalog practice merged with its current config.
router.get("/practices", (_req, res) => {
  res.json({ practices: PRACTICES.map(serializePractice) });
});

// PUT /:id/config — patch { enabled?, config? } for one practice.
router.put("/practices/:id/config", (req, res) => {
  const practice = PRACTICES_BY_ID.get(req.params.id);
  if (!practice) {
    return res
      .status(404)
      .json({ error: { code: "UNKNOWN_PRACTICE", message: "no such practice" } });
  }
  const body = req.body || {};
  const row = stmts.getPlaybookPracticeConfig.get(practice.id);
  const current = resolvePracticeConfig(row, practice);

  const enabled = body.enabled === undefined ? current.enabled : Boolean(body.enabled);
  const config = { ...current.config };
  try {
    if (body.config !== undefined) {
      validateConfigPatch(practice, body.config);
      Object.assign(config, body.config);
    }
    validateOverridePatch(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: { code: "INVALID_CONFIG", message: err.message } });
    }
    throw err;
  }

  // `in` (not `=== undefined`) so an explicit `null` reads as "clear" rather
  // than "omitted" — an omitted key must leave the stored override
  // untouched, which is what makes a numeric-only save never silently eat an
  // existing override (Architect risk #4).
  const kindOverride = "kindOverride" in body ? body.kindOverride : current.kindOverride;
  const severityOverride =
    "severityOverride" in body ? body.severityOverride : current.severityOverride;

  const stored = { ...config };
  if (kindOverride !== null) stored.kindOverride = kindOverride;
  if (severityOverride !== null) stored.severityOverride = severityOverride;

  stmts.upsertPlaybookPracticeConfig.run(practice.id, enabled ? 1 : 0, JSON.stringify(stored));
  const result = serializePractice(practice);
  broadcast("playbook_practice_config_updated", result);
  res.json(result);
});

module.exports = router;
