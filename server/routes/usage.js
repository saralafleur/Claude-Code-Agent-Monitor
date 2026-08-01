/**
 * @file usage.js
 * @description HTTP routes for the dashboard's Usage page. Reads past
 * `/status` + `/usage` captures (see server/lib/usage-capture.js and the
 * `usage_captures` table in server/db.js) and can trigger a new capture on
 * demand.
 *
 * Security model: same loopback-Origin guard as `/api/run` — this route
 * spawns a real `claude` process via tmux, so it must not be drive-by
 * triggerable from an arbitrary webpage (see server/lib/origin-guard.js).
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const { sameOriginGuard } = require("../lib/origin-guard");
const usageCapture = require("../lib/usage-capture");
const usageCapturesDb = require("../lib/usage-captures-db");

const router = Router();

router.use(sameOriginGuard);

/**
 * Capture history, most recent first. `?limit=<n>` caps results (default 50,
 * max 500). Also reports whether a capture is currently in flight so the UI
 * can disable the "Capture now" button instead of racing a 409.
 */
router.get("/", (req, res) => {
  const limit = Number.parseInt(String(req.query.limit || "50"), 10);
  const items = usageCapturesDb.listCaptures({ limit: Number.isFinite(limit) ? limit : 50 });
  res.json({ items, capturing: usageCapture.isCapturing() });
});

/** A single capture, including its full raw pane text. */
router.get("/:id", (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: { code: "EBADID", message: "id must be a number" } });
  }
  const row = usageCapturesDb.getCapture(id);
  if (!row) {
    return res.status(404).json({ error: { code: "ENOTFOUND", message: "capture not found" } });
  }
  return res.json(row);
});

/**
 * Trigger a new capture. Blocks the request for the duration of the tmux
 * round-trip (roughly 10-15s) since a single-user local dashboard has no
 * benefit from a separate polling handle for something this short and
 * bounded — the client just awaits the fetch and shows a loading state.
 * Rejects with 409 if a capture is already running.
 */
router.post("/capture", async (req, res) => {
  const body = req.body || {};
  const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : undefined;
  try {
    const row = await usageCapture.runCapture({ cwd });
    return res.status(201).json(row);
  } catch (err) {
    if (err.code === "ECAPTURING") {
      return res.status(409).json({ error: { code: err.code, message: err.message } });
    }
    return res.status(500).json({ error: { code: "EINTERNAL", message: err.message } });
  }
});

module.exports = router;
