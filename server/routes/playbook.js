/**
 * @file Express router for the Coach's Playbook — the catalog of practices
 * and their user-editable config:
 *
 *   GET /api/playbook/practices — every catalog practice merged with its
 *     stored config (or catalog defaults if never touched):
 *     { id, category, scope, kind, defaultSeverity, fields, enabled, config }
 *   PUT /api/playbook/practices/:id/config — patch { enabled?, config? };
 *     validates `config` keys against that practice's own `fields` schema,
 *     persists, and broadcasts the merged practice over the WebSocket
 *     (`playbook_practice_config_updated`) so every other connected client
 *     picks up the change live, without a reload — same pattern as
 *     server/routes/color-thresholds.js.
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
const { PRACTICES, PRACTICES_BY_ID, resolvePracticeConfig } = require("../lib/playbook/practices");

const router = Router();

class ValidationError extends Error {}

function serializePractice(practice) {
  const row = stmts.getPlaybookPracticeConfig.get(practice.id);
  const { enabled, config } = resolvePracticeConfig(row, practice);
  return {
    id: practice.id,
    category: practice.category,
    scope: practice.scope,
    kind: practice.kind,
    defaultSeverity: practice.defaultSeverity,
    fields: practice.fields,
    enabled,
    config,
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
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: { code: "INVALID_CONFIG", message: err.message } });
    }
    throw err;
  }

  stmts.upsertPlaybookPracticeConfig.run(practice.id, enabled ? 1 : 0, JSON.stringify(config));
  const result = serializePractice(practice);
  broadcast("playbook_practice_config_updated", result);
  res.json(result);
});

module.exports = router;
