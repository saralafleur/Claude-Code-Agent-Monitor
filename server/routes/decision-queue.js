/**
 * @file Express router for the layer-6 reconciliation decision queue: list
 * queue items, and act on one (resolve / dismiss / retry a stuck write-back).
 * `retry_write` re-invokes plan-writeback.applyDisposition without
 * forwarding the stale expected_hash from the original failed attempt, so
 * applyDisposition re-derives its own baseline (the plan's last-ingested
 * content_hash) for this call — and, on its own internal CONFLICT retry,
 * re-baselines a SECOND time against a fresh read of the file taken at the
 * top of that retry, never reusing either of the earlier baselines (see
 * plan-writeback.js's applyDisposition).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const dbModule = require("../db");
const { stmts } = dbModule;
const { broadcast } = require("../websocket");
const { applyDisposition } = require("../lib/plan-writeback");

const router = Router();

function serialize(row) {
  let payload = null;
  try {
    payload = row.payload ? JSON.parse(row.payload) : null;
  } catch {
    payload = null;
  }
  return { ...row, payload };
}

// GET /api/decision-queue?status=&kind=&cwd=&project_id=&limit= - list queue items.
router.get("/", (req, res) => {
  const { status, kind, cwd, project_id: projectId, limit } = req.query;
  let rows = stmts.listDecisionQueue.all();
  if (status) rows = rows.filter((r) => r.status === status);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (cwd) rows = rows.filter((r) => r.cwd === cwd);
  // project_id is stamped directly onto each row at write time (see
  // reconciliation.js's listReconcileTargets / plan-writeback.js's
  // enqueueWritebackFailureRow) — filter on the column itself, no join
  // needed (unlike /api/detours, which resolves project_id -> cwd via
  // project_paths because detour_dispositions rows are looked up by cwd).
  if (projectId) rows = rows.filter((r) => r.project_id === projectId);
  const cap = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : rows.length;
  res.json({ queue: rows.slice(0, cap).map(serialize) });
});

const ACTIONS = new Set(["resolve", "dismiss", "retry_write"]);

// POST /api/decision-queue/:id/resolve { action } - act on a queue item.
router.post("/:id/resolve", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "invalid id" } });
  }
  const row = stmts.getDecisionQueueItem.get(id);
  if (!row) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "no such queue item" } });
  }

  const { action } = req.body || {};
  if (!ACTIONS.has(action)) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: `action must be one of ${[...ACTIONS].join(", ")}` },
    });
  }

  if (action === "retry_write") {
    if (row.kind !== "writeback_conflict" && row.kind !== "writeback_failed") {
      return res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "retry_write only applies to writeback_conflict/writeback_failed",
        },
      });
    }
    // Fresh optimistic check every retry — never a stale hash from the
    // failed attempt.
    const result = applyDisposition(dbModule, row.ref_id, { broadcast });
    if (result && result.write_status === "written") {
      stmts.resolveDecisionQueueItem.run("resolved", id);
    }
    broadcast("decision_queue_updated", serialize(stmts.getDecisionQueueItem.get(id)));
    return res.json({
      write_status: result ? result.write_status : null,
      resolved_item_id: result ? result.resolved_item_id : null,
      queue: serialize(stmts.getDecisionQueueItem.get(id)),
    });
  }

  const status = action === "dismiss" ? "dismissed" : "resolved";
  stmts.resolveDecisionQueueItem.run(status, id);

  // A detour_disposition queue row also resolves its linked detour row, in
  // one place, so the two tables can never disagree.
  if (row.kind === "detour_disposition" && row.ref_id) {
    try {
      require("../lib/detours").resolveDisposition(dbModule, row.ref_id, {
        disposition: action === "dismiss" ? "discard" : "deliberate",
        decided_by: "human",
      });
    } catch {
      /* best effort — the queue row itself is still resolved */
    }
  }

  const updated = serialize(stmts.getDecisionQueueItem.get(id));
  broadcast("decision_queue_updated", updated);
  res.json({ queue: updated });
});

module.exports = router;
