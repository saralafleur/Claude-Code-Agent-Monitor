/**
 * @file Express router for detour dispositions (layer 4): listing durable
 * detour records and resolving them by hand. For fold_in/new_item, the
 * resolve endpoint calls plan-writeback.applyDisposition synchronously
 * within the request — DEC-13's second auto-write trigger point. Neither
 * this route nor server/lib/reconciliation.js composes its own write
 * sequence; both call applyDisposition (DEC-14).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const dbModule = require("../db");
const { stmts } = dbModule;
const { broadcast } = require("../websocket");
const { DISPOSITIONS, resolveDisposition } = require("../lib/detours");
const { applyDisposition } = require("../lib/plan-writeback");

const router = Router();

const STATUS_FILTERS = new Set(["pending", "resolved", "conflict", "failed"]);

function matchesStatus(row, status) {
  if (!status) return true;
  if (status === "pending") return row.disposition === "pending";
  if (status === "conflict") return row.write_status === "conflict";
  if (status === "failed") return row.write_status === "failed";
  if (status === "resolved")
    return (
      row.disposition !== "pending" &&
      row.write_status !== "conflict" &&
      row.write_status !== "failed"
    );
  return true;
}

// GET /api/detours?cwd=&project_id=&status=&limit= - list dispositions.
router.get("/", (req, res) => {
  const { cwd, project_id: projectId, status, limit } = req.query;
  if (status && !STATUS_FILTERS.has(status)) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: `status must be one of ${[...STATUS_FILTERS].join(", ")}`,
      },
    });
  }

  let cwds = null;
  if (projectId) {
    cwds = stmts.listProjectPaths.all(projectId).map((p) => p.cwd);
  } else if (cwd) {
    cwds = [cwd];
  }

  const cap = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 100;
  let rows;
  if (cwds) {
    rows = cwds.flatMap((c) => stmts.listDetourDispositions.all(c, cap));
  } else {
    rows = dbModule.db
      .prepare("SELECT * FROM detour_dispositions ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(cap);
  }

  res.json({ detours: rows.filter((r) => matchesStatus(r, status)) });
});

// POST /api/detours/:id/resolve - resolve a disposition by hand.
router.post("/:id/resolve", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "invalid id" } });
  }
  const existing = stmts.getDetourDisposition.get(id);
  if (!existing) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "no such disposition" } });
  }

  const {
    disposition,
    note,
    proposed_text: proposedText,
    proposed_acceptance: proposedAcceptance,
    proposed_detail: proposedDetail,
    proposed_parent_item_id: proposedParentItemId,
    expected_hash: expectedHash,
  } = req.body || {};

  if (!disposition || !DISPOSITIONS.includes(disposition)) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: `disposition must be one of ${DISPOSITIONS.join(", ")}`,
      },
    });
  }

  const resolveResult = resolveDisposition(dbModule, id, {
    disposition,
    decided_by: "human",
    note,
    proposed_text: proposedText,
    proposed_acceptance: proposedAcceptance,
    proposed_detail: proposedDetail,
    proposed_parent_item_id: proposedParentItemId,
  });

  // fold_in/new_item are terminal (see detours.js's resolveDisposition) —
  // surface the rejection instead of silently proceeding to applyDisposition
  // against whatever the row's original, unchanged disposition still is.
  if (resolveResult && resolveResult.code === "ALREADY_RESOLVED") {
    return res
      .status(409)
      .json({ error: { code: resolveResult.code, message: resolveResult.error } });
  }

  let row = stmts.getDetourDisposition.get(id);
  if (disposition === "fold_in" || disposition === "new_item") {
    row = applyDisposition(dbModule, id, { broadcast, expectedHash });
  }

  broadcast("detour_disposition", row);

  res.json({
    write_status: row.write_status,
    resolved_item_id: row.resolved_item_id,
    write_error: row.write_error,
    detour: row,
  });
});

module.exports = router;
