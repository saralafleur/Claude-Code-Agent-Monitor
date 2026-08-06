/**
 * @file Express router for the portfolio-layer plan lifecycle + value ledger
 * (technical-plan.md §3.3): `project_plans` / `project_plan_items` /
 * `value_claims`, deliberately a SEPARATE namespace from `/api/plans` (the
 * legacy cwd-keyed AGENT-PLAN.md mirror in server/routes/plans.js) — the two
 * plan surfaces never blend in one response (R1). Route logic here is
 * intentionally thin: plan/item CRUD and closure delegate to
 * server/lib/plan-lifecycle.js, every derived number (pool, health, the
 * whole-life summary) delegates to server/lib/value-ledger.js, and every cwd
 * this router touches is canonicalized through server/lib/cwd-identity.js
 * before it is written to `value_claims.source_cwd` or handed to pool
 * assembly. `:id(\d+)` / `:itemId(\d+)` / `:claimId(\d+)` digit constraints
 * keep the literal `pool`/`health`/`history`/`import`/`items`/`claims`/
 * `coverage`/`coverage-request` segments unambiguous.
 *
 * Value Pool Slice 2 (coverage-on-demand) adds `POST /coverage-request` and
 * `GET /coverage` — both route through `server/lib/value-coverage.js`'s
 * single-home `coverageSnapshot` (DEC-5, §9.1); the denominator M comes from
 * `assembleValuePool` (DEC-16 sole composer), never a hand-rolled query
 * here.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const dbModule = require("../db");
const { broadcast } = require("../websocket");
const planLifecycle = require("../lib/plan-lifecycle");
const valueLedger = require("../lib/value-ledger");
const { enrichPoolAltitudes } = require("../lib/value-summary");
const { coverageSnapshot } = require("../lib/value-coverage");
const { runCoverageDrain, isDrainingProject } = require("../lib/value-summary-tick");
const cwdIdentity = require("../lib/cwd-identity");

const { VALUE_SOURCES, ATTRIBUTION_TIERS } = valueLedger;

const router = Router();

// Maps a plan-lifecycle domain-error code to its HTTP status. Every route
// below that calls into plan-lifecycle.js funnels its result through this,
// so the code<->status mapping lives in exactly one place.
const ERROR_STATUS = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  ALREADY_CLOSED: 409,
  DUPLICATE_CLAIM: 409,
};

function respondDomainError(res, result) {
  const status = ERROR_STATUS[result.error.code] || 400;
  return res.status(status).json({ error: result.error });
}

function planWithItemsAndClaims(plan) {
  const items = dbModule.stmts.listProjectPlanItems.all(plan.id);
  const claimsByItem = new Map();
  for (const claim of dbModule.stmts.listClaimsForPlan.all(plan.id)) {
    if (!claimsByItem.has(claim.item_id)) claimsByItem.set(claim.item_id, []);
    claimsByItem.get(claim.item_id).push(claim);
  }
  return {
    // The generation ordinal is DERIVED (plan-lifecycle.js's single home for
    // it) and exposed here so no consumer (CLI, future UI) ever recomputes
    // it by walking succeeds_plan_id itself (§9.1).
    plan: { ...plan, ordinal: planLifecycle.generationOrdinal(dbModule, plan) },
    items: items.map((item) => ({ ...item, claims: claimsByItem.get(item.id) || [] })),
  };
}

// ── Plan CRUD ────────────────────────────────────────────────────────────

// GET /api/project-plans?project_id=&status= - every plan (open+closed) for
// a project, nested items with per-item claims.
router.get("/", (req, res) => {
  const projectId = req.query.project_id;
  if (!projectId) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id is required" } });
  }
  let plans = dbModule.stmts.listProjectPlans.all(projectId);
  if (req.query.status) plans = plans.filter((p) => p.status === req.query.status);
  res.json({ plans: plans.map(planWithItemsAndClaims) });
});

// GET /api/project-plans/pool?project_id=&lookbackDays=&backfill=1 -
// assembled live value pool + identityWarnings. No project row required to
// exist (S1, project_plans/claims outlive a deleted project row by design)
// — only project_id itself is required.
router.get("/pool", async (req, res) => {
  const projectId = req.query.project_id;
  if (!projectId) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id is required" } });
  }
  const backfill = req.query.backfill === "1" || req.query.backfill === "true";
  const lookbackDays =
    req.query.lookbackDays !== undefined ? Number(req.query.lookbackDays) : undefined;
  const { units, identityWarnings } = await valueLedger.assembleValuePool(
    dbModule,
    { id: projectId },
    { backfill, lookbackDays }
  );
  res.json({ units, identityWarnings });
});

// GET /api/project-plans/health?project_id= - computePlanHealth's exact
// shape, verbatim (T6 parity target). Same audit-outlives-project stance as
// /pool.
router.get("/health", async (req, res) => {
  const projectId = req.query.project_id;
  if (!projectId) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id is required" } });
  }
  const health = await valueLedger.computePlanHealth(dbModule, { id: projectId });
  res.json(health);
});

// GET /api/project-plans/history?project_id= - AC-6 whole-life summary:
// closed generations + their claims, no closed_at on any claim (join-derived
// only). Same audit-outlives-project stance as /pool and /health.
router.get("/history", (req, res) => {
  const projectId = req.query.project_id;
  if (!projectId) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id is required" } });
  }
  res.json(valueLedger.summarizeDeliveredValue(dbModule, { id: projectId }));
});

// POST /api/project-plans/altitudes {project_id, units:[{unit_key, value_source,
// value_ref?, label?, stage?}]} - stakeholder-altitude synthesis for a
// client-held batch of pool units (server/lib/value-summary.js, the layer
// above /pool). Never recomputes the pool itself — callers pass the exact
// units their own /pool fetch already resolved (DEC-16: pool assembly stays
// value-ledger.js's alone). Always 200, even when the LLM path is
// off/unavailable — affected units simply come back in `states` (`queued` or
// `unavailable`, DEC-11), never as an error. A submitted unit with a valid
// unit_key but an unrecognized value_source is itself reported `unavailable`
// in `states` rather than silently dropped from both maps (S3) — every unit
// with an identifiable key lands in exactly one of the two, same as
// enrichPoolAltitudes's own contract. This is the same-visit fast path only,
// still capped at MAX_UNITS_PER_PROMPT (40) inline; overflow beyond that cap
// is drained unattended by `server/lib/value-summary-tick.js` — this route's
// behavior is otherwise unchanged by that tick's existence.
router.post("/altitudes", async (req, res) => {
  const { project_id: projectId, units } = req.body || {};
  if (!projectId || !Array.isArray(units)) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id and units[] are required" } });
  }
  const clean = [];
  // Units this loop itself rejects still need to land in exactly one of the
  // two response maps (DEC-11 / the "never both, never neither" contract
  // api.ts documents) — pre-seed `states` here for anything with an
  // identifiable key that fails validation, so it is not silently dropped
  // into neither map (S3). A missing/blank/non-string unit_key has no key to
  // report a state against at all, so it is the one case that is genuinely
  // unrepresentable and stays dropped.
  const states = {};
  for (const u of units) {
    if (!u || typeof u.unit_key !== "string" || !u.unit_key) continue;
    if (!VALUE_SOURCES.includes(u.value_source)) {
      states[u.unit_key] = "unavailable";
      continue;
    }
    clean.push({
      unitKey: u.unit_key,
      value_source: u.value_source,
      value_ref: u.value_ref != null ? String(u.value_ref) : "",
      label: typeof u.label === "string" ? u.label : null,
      stage: typeof u.stage === "string" ? u.stage : null,
    });
  }
  const startedAt = Date.now();
  // A-3: every submitted unit this loop itself rejected (bad value_source,
  // unrepresentable keyless) still belongs in the submitted batch's
  // pool_size/unavailable — the composer folds it in via opts.droppedCount
  // rather than this route re-deriving any partition term of its own (T-F).
  const droppedCount = units.length - clean.length;
  const enriched = await enrichPoolAltitudes(dbModule, clean, { droppedCount });
  // The route never computes a partition term itself — it logs `counts`
  // verbatim, the same object the wire response below also carries.
  // SF-6: guarded — this is an AUDIT-LOG write, running AFTER the LLM work
  // and cache writes above have already succeeded. Under Express 4, an
  // unguarded synchronous throw here (e.g. SQLITE_BUSY against the shared
  // DB) means no response is ever sent and an unhandled rejection can exit
  // the process — the exact BL-1 failure mechanism, for a write whose
  // failure should never sink a request that already succeeded (mirrors
  // value-summary-tick.js's own "per-project fail-safe" wrap around its
  // equivalent write).
  try {
    dbModule.stmts.insertValueSummaryGeneration.run(
      projectId,
      "request",
      "ok",
      enriched.counts.pool_size,
      enriched.counts.cache_hits,
      enriched.counts.generated,
      enriched.counts.queued,
      enriched.counts.unavailable,
      null,
      Date.now() - startedAt,
      enriched.counts.stale_regenerated
    );
  } catch (err) {
    console.warn(`/altitudes audit-log write failed for project ${projectId}:`, err.message);
  }
  res.json({
    altitudes: enriched.altitudes,
    states: { ...states, ...enriched.states },
    counts: enriched.counts,
  });
});

// POST /api/project-plans/altitudes/seen {project_id, units:[{unit_key,
// regenerated_at}]} - explicit acknowledgement of a regenerated (mutable,
// `freshness: "updated_unseen"`) unit's stakeholder-altitude cache entry
// (A-5). `project_id` is validated but otherwise advisory (T-K, SEEN-7,
// BY DESIGN) — `unit_key` already embeds the cwd, so cross-project
// collision is not a real risk, and requiring the caller's own project_id to
// match would only make a legitimate acknowledge fail on a stale client-side
// project selection. Compare-and-set (`markValueUnitSummariesSeen`, the ONE
// lexical call site below, W-3 guard): stamps `seen_at` only if the row's
// CURRENT `regenerated_at` still matches what the caller last saw — a stale
// stamp (the tick regenerated the unit again since the caller fetched it)
// is silently rejected (`updated: 0`), never acknowledging a generation the
// user never actually saw (T-D).
router.post("/altitudes/seen", async (req, res) => {
  const { project_id: projectId, units } = req.body || {};
  if (!projectId || typeof projectId !== "string") {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id (string) is required" } });
  }
  if (!Array.isArray(units) || units.length === 0 || units.length > 500) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "units[] is required (1-500 entries)" },
    });
  }
  for (const u of units) {
    if (!u || typeof u !== "object" || Array.isArray(u)) {
      return res
        .status(400)
        .json({ error: { code: "INVALID_INPUT", message: "each unit must be an object" } });
    }
    if (typeof u.unit_key !== "string" || !u.unit_key) {
      return res.status(400).json({
        error: { code: "INVALID_INPUT", message: "each unit requires a unit_key string" },
      });
    }
    if (u.regenerated_at !== null && typeof u.regenerated_at !== "string") {
      return res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "each unit's regenerated_at must be a string or null",
        },
      });
    }
  }

  let updated = 0;
  // SF-6: guarded. Unlike the audit-log write in POST /altitudes above,
  // this transaction IS the acknowledgement itself, so a failure here
  // must not silently report success — but it must also never throw
  // unguarded out of an async Express handler (the same BL-1 failure
  // mechanism: no response ever sent, possible process exit).
  try {
    const ackTxn = dbModule.db.transaction(() => {
      for (const { unit_key: unitKey, regenerated_at: regeneratedAt } of units) {
        const result = dbModule.stmts.markValueUnitSummariesSeen.run(unitKey, regeneratedAt);
        updated += result.changes;
      }
    });
    ackTxn();
  } catch (err) {
    console.warn(`/altitudes/seen acknowledge failed for project ${projectId}:`, err.message);
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "failed to record acknowledgement" },
    });
  }

  res.json({ updated });
});

// POST /api/project-plans/coverage-request {project_id} - Value Pool Slice 2
// (DEC-4): stamps `coverage_requested_at`, jumping the project to the head
// of the sweep rotation, then kicks `runCoverageDrain` fire-and-forget (the
// bounded back-to-back drain loop DEC-4 designed this feature around — safe
// to call redundantly: the module-scope overlap guard `runCoverageDrain`
// shares with `runValueSummaryTickOnce` turns a second concurrent call, from
// either function, into `{skipped: "overlap"}`). Responds 202 immediately
// with a probe-built snapshot — this route never blocks on the drain
// finishing.
router.post("/coverage-request", async (req, res) => {
  const { project_id: projectId } = req.body || {};
  if (!projectId || typeof projectId !== "string") {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id is required" } });
  }
  const nowIso = new Date().toISOString();
  dbModule.stmts.requestValueCoverage.run(projectId, nowIso);

  // Fire-and-forget (SF-6 discipline): never awaited, never lets a drain
  // failure fail this request. The overlap guard makes a redundant
  // "prioritize now" click while a drain is already running harmless.
  // `runCoverageDrain` sets its own module-scope `drainingProjectId`
  // synchronously (before its first `await`), so `isDrainingProject` below
  // already reflects reality by the time this handler composes its response
  // (build-reviewer SF-3).
  runCoverageDrain(dbModule, projectId, { broadcast }).catch(() => {});

  const { units } = await valueLedger.assembleValuePool(dbModule, { id: projectId });
  const { counts } = await enrichPoolAltitudes(dbModule, units, { probe: true });
  // `requestValueCoverage` above is an unconditional upsert
  // (`coverage_requested_at = excluded.coverage_requested_at`), so `nowIso`
  // IS the value now on the row — re-reading it back via
  // `getValueSweepState` here raced the fire-and-forget drain kicked above
  // (which can clear the flag on its own first iteration before this read
  // runs) and could answer `demand: "passive"` for a request this same
  // handler just accepted (build-reviewer SF-2). Pass the value this
  // handler itself just wrote instead.
  const snapshot = coverageSnapshot(dbModule, {
    projectId,
    counts,
    requestedAt: nowIso,
    draining: isDrainingProject(projectId),
    computedAt: new Date().toISOString(),
  });
  res.status(202).json({ coverage: snapshot });
});

// GET /api/project-plans/coverage?project_id= - Value Pool Slice 2: the same
// `coverageSnapshot` object the WS `value_altitudes_updated` broadcast
// carries (G2 parity, byte-same shape). `assembleValuePool` is the sole
// composer (DEC-16) — the denominator M comes from here and nowhere else.
// Runs the composer in PROBE mode (classify only, never spawn, no
// generation-log row — DEC-9): this is a read, not a generation attempt.
router.get("/coverage", async (req, res) => {
  const projectId = req.query.project_id;
  if (!projectId) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id is required" } });
  }
  const { units } = await valueLedger.assembleValuePool(dbModule, { id: projectId });
  const { counts } = await enrichPoolAltitudes(dbModule, units, { probe: true });
  const state = dbModule.stmts.getValueSweepState.get(projectId);
  const snapshot = coverageSnapshot(dbModule, {
    projectId,
    counts,
    requestedAt: state ? state.coverage_requested_at : null,
    // Real drain-state accessor (build-reviewer SF-3) — was hardcoded
    // `false`, which meant this route could never report `demand:
    // "draining"` even while a `runCoverageDrain` iteration was actively in
    // flight for this exact project, disagreeing with a concurrent WS
    // broadcast for the same instant.
    draining: isDrainingProject(projectId),
    computedAt: new Date().toISOString(),
  });
  res.json({ coverage: snapshot });
});

// POST /api/project-plans/import {project_id, cwd} - DEC-P2 generation-1
// import. 404 on an unknown project (S1: create/import are the ONLY verbs
// that require the project row to exist).
router.post("/import", async (req, res) => {
  const { project_id: projectId, cwd } = req.body || {};
  if (!projectId || !cwd) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id and cwd are required" } });
  }
  const project = dbModule.stmts.getProject.get(projectId);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "project not found" } });
  }
  const result = await planLifecycle.importGenerationFromPlan(dbModule, { projectId, cwd });
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  if (result.created) broadcast("project_plan_updated", { plan: result.plan });
  res.status(200).json({ plan: result.plan, items: result.items, created: result.created });
});

// POST /api/project-plans {project_id, title, succeeds_plan_id?, origin?} -
// create (incl. a retroactive_bundle). 201 (QDEC-16 S3, sibling precedent).
router.post("/", (req, res) => {
  const { project_id: projectId, title, succeeds_plan_id: succeedsPlanId, origin } = req.body || {};
  if (!projectId || !title) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "project_id and title are required" } });
  }
  const project = dbModule.stmts.getProject.get(projectId);
  if (!project) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "project not found" } });
  }
  const result = planLifecycle.insertProjectPlan(dbModule, {
    project_id: projectId,
    title,
    succeeds_plan_id: succeedsPlanId,
    origin,
  });
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  broadcast("project_plan_updated", { plan: result });
  res.status(201).json({ plan: result });
});

// GET /api/project-plans/:id - read one plan with its items+claims.
router.get("/:id(\\d+)", (req, res) => {
  const plan = dbModule.stmts.getProjectPlan.get(Number(req.params.id));
  if (!plan) return res.status(404).json({ error: { code: "NOT_FOUND", message: "no such plan" } });
  res.json(planWithItemsAndClaims(plan));
});

// PATCH /api/project-plans/:id - rename an open plan. `status` can never be
// set here — closing has exactly one door (POST /:id/close, DEC-P6).
router.patch("/:id(\\d+)", (req, res) => {
  const { title, status } = req.body || {};
  if (status !== undefined) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "status cannot be set via PATCH — use POST /:id/close",
      },
    });
  }
  const result = planLifecycle.updatePlanTitle(dbModule, Number(req.params.id), title);
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  broadcast("project_plan_updated", { plan: result });
  res.json({ plan: result });
});

// POST /api/project-plans/:id/close {closure_note} - the only door to
// closed. Delegates entirely to plan-lifecycle.js's single closure composer.
router.post("/:id(\\d+)/close", (req, res) => {
  const { closure_note: closureNote } = req.body || {};
  const result = planLifecycle.closePlan(dbModule, Number(req.params.id), {
    closure_note: closureNote,
    broadcast,
  });
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  res.json({ plan: result });
});

// ── Item CRUD (open plans only) ─────────────────────────────────────────

router.post("/:id(\\d+)/items", (req, res) => {
  const planId = Number(req.params.id);
  const result = planLifecycle.insertProjectPlanItem(dbModule, planId, req.body || {});
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  broadcast("project_plan_updated", { plan: dbModule.stmts.getProjectPlan.get(planId) });
  res.status(201).json({ item: result });
});

router.patch("/items/:itemId(\\d+)", (req, res) => {
  const itemId = Number(req.params.itemId);
  const result = planLifecycle.updateProjectPlanItem(dbModule, itemId, req.body || {});
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  broadcast("project_plan_updated", { plan: dbModule.stmts.getProjectPlan.get(result.plan_id) });
  res.json({ item: result });
});

router.delete("/items/:itemId(\\d+)", (req, res) => {
  const itemId = Number(req.params.itemId);
  const item = dbModule.stmts.getProjectPlanItem.get(itemId);
  const result = planLifecycle.deleteProjectPlanItem(dbModule, itemId);
  if (planLifecycle.isDomainError(result)) return respondDomainError(res, result);
  if (item)
    broadcast("project_plan_updated", { plan: dbModule.stmts.getProjectPlan.get(item.plan_id) });
  res.json({ ok: true });
});

// ── Claims (DEC-7 cardinality, DEC-P4 snapshot ceiling) ─────────────────

// POST /api/project-plans/:id/claims - claim a unit into an existing item or
// an inline {new_item:{...}} created atomically in the same request.
router.post("/:id(\\d+)/claims", (req, res) => {
  const planId = Number(req.params.id);
  const plan = dbModule.stmts.getProjectPlan.get(planId);
  if (!plan) return res.status(404).json({ error: { code: "NOT_FOUND", message: "no such plan" } });
  if (plan.status !== "open") {
    return res.status(409).json({ error: { code: "ALREADY_CLOSED", message: "plan is closed" } });
  }

  const body = req.body || {};
  let itemId = body.item_id != null ? Number(body.item_id) : null;
  if (itemId != null) {
    const item = dbModule.stmts.getProjectPlanItem.get(itemId);
    if (!item || item.plan_id !== planId) {
      return res.status(400).json({
        error: { code: "INVALID_INPUT", message: "item_id does not belong to this plan" },
      });
    }
  } else if (body.new_item) {
    const inserted = planLifecycle.insertProjectPlanItem(dbModule, planId, body.new_item);
    if (planLifecycle.isDomainError(inserted)) return respondDomainError(res, inserted);
    itemId = inserted.id;
  } else {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "item_id or new_item is required" } });
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

  if (!VALUE_SOURCES.includes(valueSource)) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: `value_source must be one of ${VALUE_SOURCES.join(", ")}`,
      },
    });
  }
  if (!ATTRIBUTION_TIERS.includes(attribution)) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: `attribution must be one of ${ATTRIBUTION_TIERS.join(", ")}`,
      },
    });
  }
  if (!valueRef) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: "value_ref is required" } });
  }

  // Canonicalize source_cwd at THIS write seam — the only other seam that
  // touches a cwd for this feature is pool assembly, both routed through
  // cwd-identity.js (CWD-IDENTITY-FANOUT).
  const canonicalCwd = sourceCwd ? cwdIdentity.canonicalizeCwd(sourceCwd) : "";

  let claim;
  try {
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
    claim = dbModule.stmts.getValueClaim.get(info.lastInsertRowid);
  } catch (e) {
    if (String(e && e.message).includes("UNIQUE")) {
      return res.status(409).json({
        error: { code: "DUPLICATE_CLAIM", message: "this unit is already claimed into this item" },
      });
    }
    throw e;
  }

  broadcast("value_claim_updated", { claim });
  res.status(201).json({ claim });
});

// DELETE /api/project-plans/claims/:claimId - explicit human unclaim.
// Rejected once the owning plan is closed (claims of a closed plan are
// immutable, DEC-P6).
router.delete("/claims/:claimId(\\d+)", (req, res) => {
  const claimId = Number(req.params.claimId);
  const claim = dbModule.stmts.getValueClaim.get(claimId);
  if (!claim)
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "no such claim" } });
  const plan = dbModule.stmts.getProjectPlan.get(claim.plan_id);
  if (plan && plan.status !== "open") {
    return res.status(409).json({
      error: { code: "ALREADY_CLOSED", message: "plan is closed — claims are immutable" },
    });
  }
  dbModule.stmts.deleteValueClaim.run(claimId);
  broadcast("value_claim_updated", { claim_id: claimId, deleted: true });
  res.json({ ok: true });
});

module.exports = router;
