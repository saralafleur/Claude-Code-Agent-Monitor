/**
 * server/lib/detours.js
 *
 * Owns every read/write of detour_dispositions except the write-audit
 * columns, which plan-writeback.js's applyDisposition owns exclusively
 * (DEC-14). A detour is an OBSERVATION (the classifier's inferred guess in
 * focus_inferences, or a declared bug/feature push in events) that gains a
 * durable, resolvable DECISION here — separate tables, separate lifecycles,
 * on purpose: focus_inferences is re-derived every re-inference of a
 * session (one row per session_id), so a detour's identity would not
 * survive that without this table.
 *
 * DISPOSITIONS is the one place the four-value enum is spelled — the route,
 * reconciliation.js, plan-writeback.js, and the tests all import it from
 * here, so the JS check and the SQL CHECK constraint cannot drift
 * (PROJECT-CONTEXT.md §9.1 DERIVED-DUAL-VIEW).
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const DISPOSITIONS = ["fold_in", "new_item", "deliberate", "discard"];

/**
 * Resolve a cwd's project_id via project_paths, the same lookup
 * reconciliation.js's listReconcileTargets uses — a best-effort audit-trail
 * stamp, never a join key (no FK). Swallows any error so a missing/broken
 * lookup can never turn into a lost detour record.
 */
function lookupProjectId(dbModule, cwd) {
  try {
    const pp = dbModule.stmts.getProjectPathByCwd?.get(cwd);
    return pp ? pp.project_id : null;
  } catch {
    return null;
  }
}

/**
 * Record a `pending` detour the instant the classifier sees it (called from
 * focus-inference.js's inferSession, immediately after the session's own
 * upsertFocusInference call). Never throws — a disposition-record failure
 * must never lose the inference itself. Never writes a file — recording an
 * observation is not deciding one.
 */
function recordInferredDetour(dbModule, row, result) {
  try {
    const { stmts } = dbModule;
    stmts.upsertDetourDisposition.run(
      row.cwd,
      lookupProjectId(dbModule, row.cwd),
      row.id,
      "inferred",
      String(row.id),
      new Date().toISOString(),
      result.label || null,
      result.item_id || null
    );
  } catch {
    /* fail-safe: never lose the inference this is derived from */
  }
}

/**
 * Backfill declared detours (push/bug/feature) from the events table for one
 * cwd, since a given point in time. §9.2: workflow-ingest.js bulk-inserts
 * events after the fact, so `id` order is not chronological — always sort by
 * created_at (id tiebreak).
 */
function backfillDeclaredDetours(dbModule, cwd, sinceIso) {
  const { db, stmts } = dbModule;
  const since = sinceIso || "1970-01-01T00:00:00.000Z";
  const projectId = lookupProjectId(dbModule, cwd);
  const rows = db
    .prepare(
      `SELECT e.id, e.session_id, e.data, e.created_at FROM events e
       JOIN sessions s ON s.id = e.session_id
       WHERE s.cwd = ? AND e.event_type = 'Focus' AND e.created_at >= ?
       ORDER BY e.created_at ASC, e.id ASC`
    )
    .all(cwd, since);

  for (const event of rows) {
    let data;
    try {
      data = event.data ? JSON.parse(event.data) : null;
    } catch {
      continue;
    }
    if (!data || !["push", "bug", "feature"].includes(data.verb)) continue;
    const label = data.title
      ? `${data.title}${data.description ? `: ${data.description}` : ""}`
      : data.description || null;
    try {
      stmts.upsertDetourDisposition.run(
        cwd,
        projectId,
        event.session_id,
        "declared",
        String(event.id),
        event.created_at,
        label,
        null
      );
    } catch {
      /* per-row fail-safe */
    }
  }
}

/**
 * Record a verdict on a pending (or previously-decided, non-terminal)
 * disposition — a row already decided to fold_in/new_item is terminal and
 * rejected (see below). Never writes the file and never stamps resolved_at
 * for fold_in/new_item — that's applyDisposition's job, only on a
 * successful write. deliberate/discard stamp resolved_at directly (nothing
 * to write).
 */
function resolveDisposition(dbModule, id, opts = {}) {
  const { stmts } = dbModule;
  const {
    disposition,
    decided_by: decidedBy = null,
    confidence = null,
    reason = null,
    proposed_text: proposedText = null,
    proposed_acceptance: proposedAcceptance = null,
    proposed_detail: proposedDetail = null,
    proposed_parent_item_id: proposedParentItemId = null,
    note = null,
  } = opts;

  if (!DISPOSITIONS.includes(disposition)) {
    return { error: `invalid disposition: ${disposition}`, code: "INVALID_DISPOSITION" };
  }

  // fold_in/new_item are terminal once decided. In the normal DEC-13 flow
  // the synchronous write (applyDisposition) runs immediately after this
  // call succeeds — see routes/detours.js and reconciliation.js — so a
  // later re-resolve of the same row either orphans the plan_items row that
  // write already created, or races a write still in flight, for the
  // ORIGINAL disposition. Reject in place (mirrors the ALREADY_MAPPED
  // idiom in routes/projects.js) rather than silently applying a second,
  // inconsistent verdict; deliberate/discard have nothing written and stay
  // freely re-resolvable, and a still-`pending` row is obviously fine too.
  const current = stmts.getDetourDisposition.get(id);
  if (current && (current.disposition === "fold_in" || current.disposition === "new_item")) {
    return {
      error: `disposition ${id} is already resolved to ${current.disposition} and cannot be changed`,
      code: "ALREADY_RESOLVED",
    };
  }

  stmts.resolveDetourDisposition.run(
    disposition,
    decidedBy,
    confidence,
    reason,
    note,
    proposedText,
    proposedAcceptance,
    proposedDetail,
    proposedParentItemId,
    id
  );

  if (disposition === "deliberate" || disposition === "discard") {
    stmts.markDetourWriteResult.run(
      "none",
      new Date().toISOString(),
      null,
      null,
      null,
      null,
      null,
      null,
      new Date().toISOString(),
      id
    );
  }

  return stmts.getDetourDisposition.get(id);
}

module.exports = {
  DISPOSITIONS,
  recordInferredDetour,
  backfillDeclaredDetours,
  resolveDisposition,
};
