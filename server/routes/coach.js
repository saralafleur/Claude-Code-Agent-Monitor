/**
 * @file Express router for the Coach's Feed — Observations the Playbook
 * engine (server/lib/playbook/engine.js) has recorded:
 *
 *   GET /api/coach/observations?status= — most recent first; `status`
 *     optionally narrows to one of open/acknowledged/dismissed/resolved.
 *   POST /api/coach/observations/:id/respond — body { response }, one of
 *     acknowledged/dismissed/resolved; records the user's Response and
 *     broadcasts the updated row (`coach_observation_updated`) so every
 *     other connected client's Feed reflects it live.
 *
 * `coach_observation_created` (a brand-new Observation) is broadcast by the
 * engine itself on the tick that produces it, not from this router - this
 * router only ever broadcasts state a human explicitly changed.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const { stmts } = require("../db");
const { broadcast } = require("../websocket");

const router = Router();

const RESPONSES = ["acknowledged", "dismissed", "resolved"];
const DEFAULT_LIMIT = 100;

// GET /observations?status= — most recent first.
router.get("/observations", (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !["open", ...RESPONSES].includes(status)) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_STATUS", message: "unknown status filter" } });
  }
  const rows = status
    ? stmts.listCoachObservationsByStatus.all(status, DEFAULT_LIMIT)
    : stmts.listCoachObservations.all(DEFAULT_LIMIT);
  res.json({ observations: rows });
});

// POST /observations/:id/respond — body { response }.
router.post("/observations/:id/respond", (req, res) => {
  const id = Number(req.params.id);
  const { response } = req.body || {};
  if (!RESPONSES.includes(response)) {
    return res.status(400).json({
      error: {
        code: "INVALID_RESPONSE",
        message: `response must be one of: ${RESPONSES.join(", ")}`,
      },
    });
  }
  const existing = stmts.getCoachObservation.get(id);
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "no such observation" } });
  }
  stmts.updateCoachObservationStatus.run(response, id);
  const result = stmts.getCoachObservation.get(id);
  broadcast("coach_observation_updated", result);
  res.json(result);
});

module.exports = router;
