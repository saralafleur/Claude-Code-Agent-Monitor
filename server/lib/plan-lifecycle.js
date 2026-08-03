/**
 * @file Plan/item CRUD and the plan lifecycle state machine for the
 * portfolio-layer `project_plans` / `project_plan_items` tables
 * (technical-plan.md §3.2, DEC-3/DEC-P5/DEC-P6). Owns two things no other
 * module may do:
 *  (1) `closePlan` — the single closure composer. One transaction, one row
 *      update (`status='open'` guarded in the WHERE clause so a second close
 *      is a detectable zero-row no-op, never a silent overwrite), broadcasts
 *      `project_plan_updated` + `value_claim_updated`. Nothing else in this
 *      feature ever writes `project_plans.status`, `closed_at`, or
 *      `closure_note`, and closed-ness is never copied onto a claim row.
 *  (2) `importGenerationFromPlan` — the DEC-P2 inversion. Reads the
 *      already-ingested `plans`/`plan_items` rows (via `plan-ingest.js`'s own
 *      stored output — this module never parses markdown itself) and copies
 *      them as generation 1. Idempotency is keyed on
 *      `(project_id, imported_content_hash)` — never on `cwd`
 *      (CWD-IDENTITY-FANOUT: two case-variant cwds are one physical file with
 *      one content_hash, so a cwd-keyed import would mint two generation-1s).
 * There is no path back from closed to open, and no delete path for a closed
 * plan or for any claim of a closed plan — those verbs simply do not exist
 * in this module.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const cwdIdentity = require("./cwd-identity");

const VALID_ORIGINS = ["manual", "import", "retroactive_bundle"];

/** Uniform domain-error shape every function below returns instead of
 *  throwing for an expected/validated failure — routes translate `code` to
 *  an HTTP status (400/404/409). */
function domainError(code, message) {
  return { error: { code, message } };
}

function isDomainError(result) {
  return Boolean(result && result.error);
}

/**
 * Derive a plan's 1-indexed generation ordinal by walking `succeeds_plan_id`
 * backward. Never stored — PRAGMA table_info(project_plans) has no
 * ordinal/generation column by design (A2.2); this is the only place the
 * number is computed.
 * @param {object} dbModule
 * @param {object} plan
 * @returns {number|null}
 */
function generationOrdinal(dbModule, plan) {
  if (!plan) return null;
  let ordinal = 1;
  let current = plan;
  const seen = new Set([current.id]);
  while (current.succeeds_plan_id != null) {
    const prev = dbModule.stmts.getProjectPlan.get(current.succeeds_plan_id);
    if (!prev || seen.has(prev.id)) break; // cycle guard — should never happen
    seen.add(prev.id);
    ordinal += 1;
    current = prev;
  }
  return ordinal;
}

/**
 * Create a new open plan (manual create, or a retroactive_bundle). Project
 * existence is the caller's (route's) responsibility — a 404 on an unknown
 * project is a route-shape concern, not a lib validation concern.
 */
function insertProjectPlan(
  dbModule,
  { project_id: projectId, title, succeeds_plan_id: succeedsPlanId, origin } = {}
) {
  if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
    return domainError("INVALID_INPUT", "project_id is required");
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return domainError("INVALID_INPUT", "title is required");
  }
  // Validated here, not left to the FK constraint: project_plans.succeeds_plan_id
  // REFERENCES project_plans(id) with foreign_keys=ON, so an unvalidated bogus
  // id would otherwise throw a raw SQLITE_CONSTRAINT_FOREIGNKEY out of this
  // function and surface as an unstructured 500 at the route (never a raw
  // 500 is a standing project rule).
  if (succeedsPlanId != null) {
    if (!Number.isInteger(succeedsPlanId)) {
      return domainError("INVALID_INPUT", "succeeds_plan_id must be an integer");
    }
    if (!dbModule.stmts.getProjectPlan.get(succeedsPlanId)) {
      return domainError("NOT_FOUND", "succeeds_plan_id does not reference an existing plan");
    }
  }
  const finalOrigin = origin && VALID_ORIGINS.includes(origin) ? origin : "manual";
  const info = dbModule.stmts.insertProjectPlan.run(
    projectId,
    title.trim(),
    "open",
    Number.isInteger(succeedsPlanId) ? succeedsPlanId : null,
    finalOrigin,
    null,
    null
  );
  return dbModule.stmts.getProjectPlan.get(info.lastInsertRowid);
}

/** Rename an open plan. Closed plans reject every write (A2.7). */
function updatePlanTitle(dbModule, planId, title) {
  const plan = dbModule.stmts.getProjectPlan.get(planId);
  if (!plan) return domainError("NOT_FOUND", "no such plan");
  if (plan.status !== "open") return domainError("ALREADY_CLOSED", "plan is closed");
  if (!title || typeof title !== "string" || !title.trim()) {
    return domainError("INVALID_INPUT", "title is required");
  }
  dbModule.stmts.updateProjectPlanTitle.run(title.trim(), planId);
  return dbModule.stmts.getProjectPlan.get(planId);
}

function insertProjectPlanItem(dbModule, planId, payload = {}) {
  const plan = dbModule.stmts.getProjectPlan.get(planId);
  if (!plan) return domainError("NOT_FOUND", "no such plan");
  if (plan.status !== "open") return domainError("ALREADY_CLOSED", "plan is closed");

  const {
    parent_item_id: parentItemId,
    text,
    acceptance,
    detail,
    checked,
    position,
    target_date: targetDate,
    imported_item_id: importedItemId,
    imported_from_cwd: importedFromCwd,
  } = payload;

  if (!text || typeof text !== "string" || !text.trim()) {
    return domainError("INVALID_INPUT", "text is required");
  }
  if (parentItemId != null && !dbModule.stmts.getProjectPlanItem.get(parentItemId)) {
    return domainError("INVALID_INPUT", "parent_item_id does not exist");
  }

  const info = dbModule.stmts.insertProjectPlanItem.run(
    planId,
    parentItemId ?? null,
    text.trim(),
    acceptance ?? null,
    detail ?? null,
    checked ? 1 : 0,
    Number.isInteger(position) ? position : 0,
    targetDate ?? null,
    importedItemId ?? null,
    importedFromCwd ?? null
  );
  return dbModule.stmts.getProjectPlanItem.get(info.lastInsertRowid);
}

function updateProjectPlanItem(dbModule, itemId, patch = {}) {
  const item = dbModule.stmts.getProjectPlanItem.get(itemId);
  if (!item) return domainError("NOT_FOUND", "no such item");
  const plan = dbModule.stmts.getProjectPlan.get(item.plan_id);
  if (!plan || plan.status !== "open") return domainError("ALREADY_CLOSED", "plan is closed");

  const { text, acceptance, detail, checked, position } = patch;
  dbModule.stmts.updateProjectPlanItem.run(
    text != null ? text : null,
    acceptance !== undefined ? acceptance : null,
    detail !== undefined ? detail : null,
    checked === undefined || checked === null ? null : checked ? 1 : 0,
    Number.isInteger(position) ? position : null,
    itemId
  );
  return dbModule.stmts.getProjectPlanItem.get(itemId);
}

function deleteProjectPlanItem(dbModule, itemId) {
  const item = dbModule.stmts.getProjectPlanItem.get(itemId);
  if (!item) return domainError("NOT_FOUND", "no such item");
  const plan = dbModule.stmts.getProjectPlan.get(item.plan_id);
  if (!plan || plan.status !== "open") return domainError("ALREADY_CLOSED", "plan is closed");
  dbModule.stmts.deleteProjectPlanItem.run(itemId);
  return { ok: true };
}

/**
 * The single closure composer (DEC-P6: value closes only through a plan).
 * One transaction, one row updated — `status='open'` in the statement's own
 * WHERE clause makes a race (two concurrent closes) a detectable zero-row
 * no-op rather than a silent double-write. `broadcast`, when given, fires
 * both additive WS types this feature owns.
 * @param {object} dbModule
 * @param {number} planId
 * @param {{closure_note?: string, now?: Date, broadcast?: Function}} [opts]
 */
function closePlan(dbModule, planId, opts = {}) {
  const { closure_note: closureNote = null, broadcast } = opts;
  const plan = dbModule.stmts.getProjectPlan.get(planId);
  if (!plan) return domainError("NOT_FOUND", "no such plan");
  if (plan.status !== "open") return domainError("ALREADY_CLOSED", "plan is already closed");

  const closedAt = opts.now instanceof Date ? opts.now.toISOString() : new Date().toISOString();

  const result = dbModule.db.transaction(() => {
    const info = dbModule.stmts.closeProjectPlan.run(closedAt, closureNote, planId);
    if (info.changes === 0) return null; // lost a race to another close
    return dbModule.stmts.getProjectPlan.get(planId);
  })();

  if (!result) return domainError("ALREADY_CLOSED", "plan is already closed");

  if (typeof broadcast === "function") {
    broadcast("project_plan_updated", { plan: result });
    broadcast("value_claim_updated", { plan_id: planId, closed: true });
  }
  return result;
}

/**
 * DEC-P2 import: generation 1 from the already-ingested legacy
 * `plans`/`plan_items` mirror. Idempotency key is
 * `(project_id, imported_content_hash)` — never `cwd`.
 * @param {object} dbModule
 * @param {{projectId: string, cwd: string}} args
 */
async function importGenerationFromPlan(dbModule, { projectId, cwd } = {}) {
  if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
    return domainError("INVALID_INPUT", "project_id is required");
  }
  if (!cwd || typeof cwd !== "string" || !cwd.trim()) {
    return domainError("INVALID_INPUT", "cwd is required");
  }

  const legacyPlan = dbModule.stmts.getPlanByCwd.get(cwd);
  if (!legacyPlan) return domainError("NOT_FOUND", "no AGENT-PLAN.md ingested for that cwd");

  const contentHash = legacyPlan.content_hash;
  if (!contentHash)
    return domainError("NOT_FOUND", "plan has not been ingested yet (no content hash)");

  // content_hash idempotency: (project_id, imported_content_hash) is the
  // ONLY idempotency key a re-import checks — never cwd.
  const existing = dbModule.stmts.findProjectPlanByImportHash.get(projectId, contentHash);
  if (existing) {
    return {
      plan: existing,
      items: dbModule.stmts.listProjectPlanItems.all(existing.id),
      created: false,
    };
  }

  const canonicalCwd = cwdIdentity.canonicalizeCwd(cwd);
  const legacyItems = dbModule.stmts.listPlanItems.all(cwd);

  const doImport = () => {
    const info = dbModule.stmts.insertProjectPlan.run(
      projectId,
      legacyPlan.title || "AGENT-PLAN.md",
      "open",
      null,
      "import",
      canonicalCwd,
      contentHash
    );
    const planId = info.lastInsertRowid;

    // Two passes: insert every item with parent_item_id null first (legacy
    // parent_item_id is a TEXT item_id, not yet a known integer id), then
    // resolve nesting once every legacy item_id -> new integer id is known.
    const idMap = new Map();
    for (const legacyItem of legacyItems) {
      const itemInfo = dbModule.stmts.insertProjectPlanItem.run(
        planId,
        null,
        legacyItem.text,
        legacyItem.acceptance ?? null,
        legacyItem.detail ?? null,
        legacyItem.checked ? 1 : 0,
        legacyItem.position ?? 0,
        legacyItem.target_date ?? null,
        legacyItem.item_id,
        canonicalCwd
      );
      idMap.set(legacyItem.item_id, itemInfo.lastInsertRowid);
    }
    for (const legacyItem of legacyItems) {
      if (!legacyItem.parent_item_id) continue;
      const parentNewId = idMap.get(legacyItem.parent_item_id);
      const ownNewId = idMap.get(legacyItem.item_id);
      if (parentNewId == null || ownNewId == null) continue;
      dbModule.db
        .prepare("UPDATE project_plan_items SET parent_item_id = ? WHERE id = ?")
        .run(parentNewId, ownNewId);
    }
    return dbModule.stmts.getProjectPlan.get(planId);
  };

  let inserted;
  try {
    inserted = dbModule.db.transaction(doImport)();
  } catch (e) {
    // Concurrent-import race: another request's insert already won the
    // UNIQUE (project_id, imported_content_hash) index — fall back to the
    // same idempotent no-op every caller expects.
    if (String(e && e.message).includes("UNIQUE")) {
      const winner = dbModule.stmts.findProjectPlanByImportHash.get(projectId, contentHash);
      if (winner) {
        return {
          plan: winner,
          items: dbModule.stmts.listProjectPlanItems.all(winner.id),
          created: false,
        };
      }
    }
    throw e;
  }

  return {
    plan: inserted,
    items: dbModule.stmts.listProjectPlanItems.all(inserted.id),
    created: true,
  };
}

module.exports = {
  domainError,
  isDomainError,
  generationOrdinal,
  insertProjectPlan,
  updatePlanTitle,
  insertProjectPlanItem,
  updateProjectPlanItem,
  deleteProjectPlanItem,
  closePlan,
  importGenerationFromPlan,
};
