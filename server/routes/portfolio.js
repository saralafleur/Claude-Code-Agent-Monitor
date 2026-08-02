/**
 * @file Express router for the layer-7 portfolio summary: one read-only
 * rollup endpoint combining objective/milestone completion and live pace
 * status per project (server/lib/portfolio.js), for the Project Manager
 * page. Open decision-queue counts and the recently-resolved log are left
 * to the existing GET /api/decision-queue endpoint - the client composes
 * both rather than this route re-deriving decision-queue state a second
 * time (§9.1 DERIVED-DUAL-VIEW).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const dbModule = require("../db");
const { buildPortfolioSummary } = require("../lib/portfolio");

const router = Router();

// GET /api/portfolio/summary - per-project milestone completion + live pace
// status (behind items), computed fresh on every request via pace.js -
// never cached, never derived from decision_queue's historical rows (those
// are dismissible event-log entries, not a live status view).
router.get("/summary", (_req, res) => {
  res.json(buildPortfolioSummary(dbModule));
});

module.exports = router;
