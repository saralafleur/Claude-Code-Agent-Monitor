/**
 * server/lib/decision-queue-enqueue.js
 *
 * The single anti-duplicate enqueue guard for `decision_queue` rows (S1 /
 * §9.1 DERIVED-DUAL-VIEW). Both `reconciliation.js` (pace_alert/
 * detour_volume/detour_disposition rows) and `plan-writeback.js`
 * (writeback_conflict/writeback_failed rows) used to hand-roll their own
 * "find an open row for this (kind, ref_id, item_id), insert only if none
 * exists" sequence — two copies of the same guard, and the copy inside
 * plan-writeback.js probed with a literal `null` item_id while its own
 * insert stored `row.item_id`, so a disposition carrying a real item_id
 * never matched its own prior insert and a duplicate `writeback_failed`/
 * `writeback_conflict` row landed on every retry. One function, imported by
 * both call sites, so the probe and the insert can never drift apart again.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

/**
 * Insert a `decision_queue` row for `kind`/`refId`/`itemId` unless one is
 * already open (`status = 'pending'`) — a still-unfixed condition must not
 * re-queue every tick/retry. Returns the existing open row when the guard
 * fires, or `null` after a fresh insert.
 */
function enqueueIfNotOpen(
  dbModule,
  { cwd, projectId, kind, refId, itemId, message, payload, inputDigest }
) {
  const { stmts } = dbModule;
  if (!stmts.insertDecisionQueueItem) return null;
  const normalizedRefId = refId ?? null;
  const normalizedItemId = itemId ?? null;
  const existing = stmts.findOpenQueueItem
    ? stmts.findOpenQueueItem.get(cwd, kind, normalizedRefId, normalizedItemId)
    : null;
  if (existing) return existing;
  stmts.insertDecisionQueueItem.run(
    cwd,
    projectId || null,
    kind,
    normalizedRefId,
    normalizedItemId,
    message,
    payload ? JSON.stringify(payload) : null,
    inputDigest ?? null
  );
  return null;
}

module.exports = { enqueueIfNotOpen };
