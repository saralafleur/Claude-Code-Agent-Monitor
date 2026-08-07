/**
 * @file Plan/item CRUD and the plan lifecycle state machine for the
 * portfolio-layer `project_plans` / `project_plan_items` / `value_claims`
 * tables (technical-plan.md §3.2, DEC-3/DEC-P5/DEC-P6). Owns three things no
 * other module may do:
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
 *  (3) `claimUnitIntoItem` (Slice 4a, DEC-S4-2) — the SOLE writer of
 *      `value_claims` (single-writer-guard.test.js G-2). Resolves or
 *      atomically creates the target item, validates the unit fields FIRST
 *      (before any write), and inserts the claim, all inside ONE
 *      `dbModule.db.transaction(...)` — so a later validation failure or a
 *      `UNIQUE` collision can never leave a committed orphan plan item
 *      behind. `POST /:id/claims` is a thin delegator to this function.
 * `updateProjectPlanItem`'s re-parent branch (Slice 4a, DEC-S4-7) is the
 * SOLE writer that may move `parent_item_id` after insert time
 * (single-writer-guard.test.js G-1) — `reparentProjectPlanItem` in
 * `server/db.js` is a dedicated statement (COALESCE cannot express "set to
 * NULL"), guarded by a same-plan + cycle check.
 * There is no path back from closed to open, and no delete path for a closed
 * plan or for any claim of a closed plan — those verbs simply do not exist
 * in this module.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const cwdIdentity = require("./cwd-identity");
// value-ledger.js requires this module (for generationOrdinal), so
// VALUE_SOURCES/ATTRIBUTION_TIERS are require()'d lazily inside
// claimUnitIntoItem below rather than at module top level — importing
// value-ledger.js here would create a require cycle where each module could
// observe the other's exports as still-empty depending on load order.

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
function insertProjectPlan(dbModule, optsOrProjectId, maybeTitle) {
  // Additive, backward-compatible calling convention: every existing caller
  // (the route, importGenerationFromPlan's own composer) passes an options
  // object and is completely unaffected. server/__tests__/plan-lifecycle.test.js's
  // new re-parent/composer fixtures (P1-P7, P3-mirror, PA, P5b, PX, A2.20, PZ)
  // call this with two positional strings instead — accepting that shape here,
  // rather than editing the test file, is the durable fix for that mismatch.
  const opts =
    typeof optsOrProjectId === "string"
      ? { project_id: optsOrProjectId, title: maybeTitle }
      : optsOrProjectId || {};
  const { project_id: projectId, title, succeeds_plan_id: succeedsPlanId, origin } = opts;
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

/** Read-only accessor — thin wrapper the composers above already use
 *  internally, exported so callers (and tests) never have to reach past this
 *  module into `dbModule.stmts` directly for a single item row. */
function getProjectPlanItem(dbModule, itemId) {
  return dbModule.stmts.getProjectPlanItem.get(itemId);
}

/**
 * How far the ancestor walk below may travel before giving up. Bounded by
 * the plan's own item count (P5b) rather than an unconditional constant, so
 * a legitimately deep (but acyclic) tree is never mistaken for a cycle; a
 * pre-existing corrupt self-referencing row still terminates quickly because
 * the walk also stops the moment it revisits an id (see `walkForCycle`).
 */
function planItemCount(dbModule, planId) {
  const row = dbModule.db
    .prepare("SELECT COUNT(*) AS n FROM project_plan_items WHERE plan_id = ?")
    .get(planId);
  return row ? row.n : 0;
}

/**
 * Walk `parent_item_id` upward from `startId`, returning true if `targetId`
 * is reached. Bounded by `maxSteps` (the plan's item count) AND by a
 * visited-set, so a pre-existing corrupt self-referencing row (P5b) cannot
 * hang the request even though it is not itself the cycle being validated.
 */
function walkForCycle(dbModule, startId, targetId, maxSteps) {
  let current = startId;
  const visited = new Set();
  let steps = 0;
  while (current != null && steps <= maxSteps) {
    if (current === targetId) return true;
    if (visited.has(current)) return false; // pre-existing corrupt cycle unrelated to targetId
    visited.add(current);
    const row = dbModule.stmts.getProjectPlanItem.get(current);
    if (!row) return false;
    current = row.parent_item_id;
    steps += 1;
  }
  return false;
}

/**
 * Extend the existing five-field partial update (text/acceptance/detail/
 * checked/position, unchanged behavior) with an explicit-intent placement
 * change (Slice 4a, DEC-S4-7). `Object.hasOwn` — not `!= null` — detects
 * intent, because `parent_item_id: null` is the meaningful "promote to
 * top-level" value and an absent key must leave every existing caller
 * byte-identical. `reparentProjectPlanItem` is a dedicated statement (not a
 * widened COALESCE) because COALESCE cannot express "set this column to
 * NULL". Both the field update and the re-parent share one transaction, so a
 * rejected placement change cannot leave a partially applied text edit (PA).
 */
function updateProjectPlanItem(dbModule, itemId, patch = {}) {
  const item = dbModule.stmts.getProjectPlanItem.get(itemId);
  if (!item) return domainError("NOT_FOUND", "no such item");
  const plan = dbModule.stmts.getProjectPlan.get(item.plan_id);
  if (!plan || plan.status !== "open") return domainError("ALREADY_CLOSED", "plan is closed");

  const hasPlacementIntent = Object.hasOwn(patch, "parent_item_id");
  let parentItemId = null;
  if (hasPlacementIntent) {
    parentItemId = patch.parent_item_id;
    if (parentItemId != null) {
      if (parentItemId === itemId) {
        return domainError("INVALID_INPUT", "an item cannot be its own parent");
      }
      const parent = dbModule.stmts.getProjectPlanItem.get(parentItemId);
      if (!parent) {
        return domainError("INVALID_INPUT", "parent_item_id does not exist");
      }
      if (parent.plan_id !== item.plan_id) {
        return domainError("INVALID_INPUT", "parent_item_id belongs to a different plan");
      }
      const maxSteps = planItemCount(dbModule, item.plan_id);
      if (walkForCycle(dbModule, parentItemId, itemId, maxSteps)) {
        return domainError("INVALID_INPUT", "parent_item_id would create a cycle");
      }
    }
  }

  const { text, acceptance, detail, checked, position } = patch;

  dbModule.db.transaction(() => {
    dbModule.stmts.updateProjectPlanItem.run(
      text != null ? text : null,
      acceptance !== undefined ? acceptance : null,
      detail !== undefined ? detail : null,
      checked === undefined || checked === null ? null : checked ? 1 : 0,
      Number.isInteger(position) ? position : null,
      itemId
    );
    if (hasPlacementIntent) {
      dbModule.stmts.reparentProjectPlanItem.run(parentItemId ?? null, itemId);
    }
  })();

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
 * The SOLE writer of `value_claims` (single-writer-guard.test.js G-2).
 * Resolves or atomically creates the target item, validates the unit's
 * claim fields, and inserts the claim — all inside ONE transaction, so no
 * failure path can leave a committed orphan plan item behind (DEC-S4-2).
 *
 * Ordering is load-bearing (DEC-S4-2): `value_source` / `attribution` /
 * `value_ref` are validated FIRST, before any write — this is what makes a
 * bad claim payload fail before `new_item` is ever inserted. Reordering
 * alone is not sufficient, though: the `UNIQUE (value_source, value_ref,
 * source_cwd, item_id)` collision can only be discovered at insert time,
 * after the item already exists — so the whole sequence also runs inside
 * `dbModule.db.transaction(...)`, and the `UNIQUE` catch sits OUTSIDE that
 * transaction callback (never inside it — catching inside would let the
 * item insert commit before the claim's failure is even observed).
 *
 * @param {object} dbModule
 * @param {number} planId
 * @param {object} body  item_id | new_item, plus the unit's claim fields
 * @returns {object} the created claim row, or a domainError
 */
function claimUnitIntoItem(dbModule, planId, body = {}) {
  const plan = dbModule.stmts.getProjectPlan.get(planId);
  if (!plan) return domainError("NOT_FOUND", "no such plan");
  if (plan.status !== "open") return domainError("ALREADY_CLOSED", "plan is closed");

  // Lazy require — see the module-header note on the value-ledger.js require
  // cycle.
  const { VALUE_SOURCES, ATTRIBUTION_TIERS } = require("./value-ledger");

  const itemIdRaw = body.item_id != null ? Number(body.item_id) : null;
  if (itemIdRaw == null && !body.new_item) {
    return domainError("INVALID_INPUT", "item_id or new_item is required");
  }
  if (itemIdRaw != null) {
    const existingItem = dbModule.stmts.getProjectPlanItem.get(itemIdRaw);
    if (!existingItem || existingItem.plan_id !== planId) {
      return domainError("INVALID_INPUT", "item_id does not belong to this plan");
    }
  }

  const {
    value_source: valueSource,
    value_ref: valueRef,
    source_cwd: sourceCwd,
    label_snapshot: labelSnapshot,
    seen_at_snapshot: seenAtSnapshot,
    stage_snapshot: stageSnapshot,
    attribution,
    claimed_by: claimedBy,
  } = body;

  // Validate FIRST — before any write (DEC-S4-2).
  if (!VALUE_SOURCES.includes(valueSource)) {
    return domainError("INVALID_INPUT", `value_source must be one of ${VALUE_SOURCES.join(", ")}`);
  }
  if (!ATTRIBUTION_TIERS.includes(attribution)) {
    return domainError(
      "INVALID_INPUT",
      `attribution must be one of ${ATTRIBUTION_TIERS.join(", ")}`
    );
  }
  if (!valueRef) {
    return domainError("INVALID_INPUT", "value_ref is required");
  }

  // Canonicalize source_cwd at THIS write seam — the only other seam that
  // touches a cwd for this feature is pool assembly, both routed through
  // cwd-identity.js (CWD-IDENTITY-FANOUT).
  const canonicalCwd = sourceCwd ? cwdIdentity.canonicalizeCwd(sourceCwd) : "";

  let claim;
  try {
    claim = dbModule.db.transaction(() => {
      let itemId = itemIdRaw;
      if (itemId == null) {
        const inserted = insertProjectPlanItem(dbModule, planId, body.new_item);
        if (isDomainError(inserted)) {
          // Thrown, not returned: this happens inside the transaction
          // callback, so better-sqlite3 rolls back anything the callback
          // has already written. The catch below is for the UNIQUE
          // collision only — this is a distinct, always-rolled-back path.
          throw Object.assign(new Error(inserted.error.message), { domainError: inserted });
        }
        itemId = inserted.id;
      }

      const info = dbModule.stmts.insertValueClaim.run(
        plan.project_id,
        planId,
        itemId,
        valueSource,
        String(valueRef),
        canonicalCwd,
        labelSnapshot ?? null,
        seenAtSnapshot ?? null,
        stageSnapshot ?? null,
        attribution,
        claimedBy === "llm" ? "llm" : "human"
      );
      return dbModule.stmts.getValueClaim.get(info.lastInsertRowid);
    })();
  } catch (e) {
    if (e && e.domainError) return e.domainError;
    if (String(e && e.message).includes("UNIQUE")) {
      return domainError("DUPLICATE_CLAIM", "this unit is already claimed into this item");
    }
    throw e;
  }

  return claim;
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
  getProjectPlanItem,
  updateProjectPlanItem,
  deleteProjectPlanItem,
  claimUnitIntoItem,
  closePlan,
  importGenerationFromPlan,
};
