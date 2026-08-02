/**
 * Reconciliation pass (layer 6).
 *
 * A per-cwd tick that uses DETERMINISTIC RULES ONLY to decide *whether* to
 * escalate (pace breach, detour volume, stale pending detours), then — only
 * for what the rules flagged — one batched hermetic `claude -p` call to
 * decide *what a detour is* (fold_in / new_item / deliberate / discard).
 * The hybrid split is structural: {@link evaluateRules} contains ZERO LLM
 * calls and completely determines the escalation set; only what it returns
 * may reach {@link classifyFlaggedDetours}. This is enforced by a test that
 * stubs the spawn seam to throw.
 *
 * Zero spawns on a tick where the rules flag nothing. One batched prompt per
 * cwd, never one per detour. Reuses the SAME hermetic spawn contract
 * focus-inference.js already owns (hooks disabled, all tools disallowed,
 * cwd = tmpdir, kill timer) via `runClaudePromptJson` — this module never
 * opens a second `claude -p` invocation path.
 *
 * For fold_in/new_item verdicts, calls plan-writeback.applyDisposition
 * in-process — the unattended DEC-13 trigger point. Neither this module nor
 * routes/detours.js composes its own write sequence (DEC-14).
 *
 * Env knobs:
 *   DASHBOARD_RECONCILE_MODE          on (default) | off
 *   DASHBOARD_RECONCILE_MS            tick interval, default 14400000 (4h)
 *   DASHBOARD_PACE_GRACE_DAYS         R1 grace period, default 1
 *   DASHBOARD_RECONCILE_LOOKBACK_DAYS R2 lookback window, default 7
 *   DASHBOARD_DETOUR_VOLUME_MIN_SESSIONS  R2 minimum sample size, default 5
 *   DASHBOARD_DETOUR_VOLUME_THRESHOLD     R2 ratio threshold, default 0.4
 *   DASHBOARD_DETOUR_PENDING_DAYS     R3 staleness threshold, default 2
 *   DASHBOARD_DETOUR_CONFIDENCE_MIN   LLM verdict confidence floor, default 0.6
 *   MAX_TARGETS_PER_TICK              cwds per tick, default 10
 *   MAX_DETOURS_PER_TICK              detours classified per cwd, default 10
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const pace = require("./pace");
const { DISPOSITIONS } = require("./detours");

const DEFAULT_TICK_MS = 14_400_000;
const BOOT_DELAY_MS = 60_000;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_VOLUME_MIN_SESSIONS = 5;
const DEFAULT_VOLUME_THRESHOLD = 0.4;
const DEFAULT_PENDING_DAYS = 2;
const DEFAULT_CONFIDENCE_MIN = 0.6;
const DEFAULT_MAX_TARGETS = 10;
const DEFAULT_MAX_DETOURS = 10;

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

// The test seam both reconciliation.test.js and reconciliation-full-tick.js
// use. There is only ONE hermetic claude -p invocation path in this repo
// (focus-inference.js's runClaudePromptJson) — this forwards to its own
// injection point rather than opening a second one.
function __injectSpawnForTest(fn) {
  require("./focus-inference").__injectSpawnForTest(fn);
}

/**
 * cwds worth reconciling this tick: cwds that have a plan, skipping any
 * whose plans.missing_at is set and any with zero plan items (WATCH-2 — a
 * dead or archived plan must never fire a false pace alarm, and must never
 * reach the LLM step at all, so a fold_in/new_item verdict for it is
 * structurally impossible rather than caught downstream).
 */
function listReconcileTargets(dbModule, limit = DEFAULT_MAX_TARGETS) {
  const { db } = dbModule;
  const rows = db
    .prepare(
      `SELECT p.cwd FROM plans p
       WHERE p.missing_at IS NULL
       AND EXISTS (SELECT 1 FROM plan_items i WHERE i.cwd = p.cwd)
       ORDER BY p.updated_at DESC LIMIT ?`
    )
    .all(limit);
  return rows.map((r) => {
    let projectId = null;
    try {
      const pp = dbModule.stmts.getProjectPathByCwd?.get(r.cwd);
      projectId = pp ? pp.project_id : null;
    } catch {
      projectId = null;
    }
    return { cwd: r.cwd, project_id: projectId };
  });
}

/**
 * Deterministic, ZERO LLM calls, pure enough to unit test. Returns
 * { paceBreaches, detourVolume, flaggedDetours }.
 */
function evaluateRules(dbModule, target, opts = {}) {
  const cwd = typeof target === "string" ? target : target.cwd;
  const now = opts.now || new Date();
  // Single source for the env-configured default (§9.1 DERIVED-DUAL-VIEW) —
  // the portfolio summary route (layer 7) reads the same helper so a pace
  // breach here and a "behind" row there can never disagree on the grace
  // period.
  const graceDays = Number.isFinite(opts.graceDays) ? opts.graceDays : pace.paceGraceDaysFromEnv();
  const lookbackDays = numEnv("DASHBOARD_RECONCILE_LOOKBACK_DAYS", DEFAULT_LOOKBACK_DAYS);
  const minSessions = numEnv("DASHBOARD_DETOUR_VOLUME_MIN_SESSIONS", DEFAULT_VOLUME_MIN_SESSIONS);
  const volumeThreshold = numEnv("DASHBOARD_DETOUR_VOLUME_THRESHOLD", DEFAULT_VOLUME_THRESHOLD);
  const pendingDays = numEnv("DASHBOARD_DETOUR_PENDING_DAYS", DEFAULT_PENDING_DAYS);
  const maxDetours = numEnv("MAX_DETOURS_PER_TICK", DEFAULT_MAX_DETOURS);

  const { db, stmts } = dbModule;

  // R1 — pace breach. pace.js is the ONLY place "is this item behind" is
  // computed (§9.1 DERIVED-DUAL-VIEW) — this rule calls it, never
  // re-derives the comparison.
  const items = (stmts.listPlanItems.all(cwd) || []).filter((i) => i.item_number != null);
  const paceBreaches = [];
  for (const item of items) {
    const status = pace.paceStatus(item, { now, graceDays });
    if (status.status === "behind") {
      paceBreaches.push({ item, ...status });
    }
  }

  // R2 — detour volume ratio over the created_at-ordered lookback window
  // (§9.2: sort by created_at, never id, before any LIMIT/window cutoff).
  const sinceIso = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();
  const classified = db
    .prepare(
      `SELECT kind FROM focus_inferences WHERE cwd = ? AND inferred_at >= ?
       ORDER BY inferred_at ASC, session_id ASC`
    )
    .all(cwd, sinceIso);
  const totalClassified = classified.length;
  const detourCount = classified.filter((r) => r.kind === "detour").length;
  const ratio = totalClassified > 0 ? detourCount / totalClassified : 0;
  const detourVolumeTripped = totalClassified >= minSessions && ratio >= volumeThreshold;

  // R3 — which pending detours reach the LLM this tick. A fresh detour in a
  // healthy project is not flagged, so a quiet project spawns nothing —
  // UNLESS the cwd itself already needs a look (R1/R2 tripped), in which
  // case its pending detours are reviewed in the same batched pass rather
  // than waiting out DASHBOARD_DETOUR_PENDING_DAYS independently.
  const cwdEscalated = paceBreaches.length > 0 || detourVolumeTripped;
  const pendingCutoff = new Date(now.getTime() - pendingDays * 86_400_000).toISOString();
  const pending = stmts.listPendingDetours.all(cwd, maxDetours) || [];
  const stale = stmts.listStaleResolvedDetours.all(cwd, maxDetours) || [];

  const flaggedDetours = [];
  for (const row of pending) {
    if (cwdEscalated || row.created_at <= pendingCutoff) {
      flaggedDetours.push(row);
    }
  }
  for (const row of stale) {
    if (!flaggedDetours.find((f) => f.id === row.id)) flaggedDetours.push(row);
  }

  return {
    paceBreaches,
    detourVolume: { tripped: detourVolumeTripped, ratio, totalClassified, detourCount },
    flaggedDetours: flaggedDetours.slice(0, maxDetours),
  };
}

/** sha1 over the sorted [id, source_seen_at, label] triples — digest gate
 *  mirroring focus-summary.js's computeInputDigest. */
function computeFlaggedDigest(flagged) {
  const crypto = require("crypto");
  const parts = flagged.map((f) => `${f.id}:${f.source_seen_at || ""}:${f.label || ""}`).sort();
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
}

/** Compose the LLM prompt: asks ONLY which disposition each flagged detour
 *  is, never whether to escalate (the hybrid-escalation-non-inversion
 *  invariant). */
function buildDispositionPrompt(flagged, opts = {}) {
  const items = opts.items || [];
  const itemList = items.map((i) => `  ${i.item_number}. ${i.text}`).join("\n");
  const detourList = flagged.map((f) => `  id=${f.id} label="${f.label || ""}"`).join("\n");
  return [
    "You are triaging unplanned work ('detours') found in a coding project's activity against its tracked plan items.",
    "For EACH detour below, decide exactly one of: fold_in (nest it under an existing plan item as a sub-item), new_item (it deserves its own top-level plan item), deliberate (an intentional detour worth a plain record but not new plan content), discard (noise, not worth recording).",
    items.length ? "PLAN ITEMS:" : null,
    itemList || null,
    "DETOURS:",
    detourList,
    'Reply with ONLY JSON: {"verdicts": [{"id": <detour id>, "disposition": "fold_in"|"new_item"|"deliberate"|"discard", "confidence": <0-1>, "reason": "<why>", "proposed_text": "<new item text, fold_in/new_item only>", "proposed_acceptance": "<optional>", "proposed_detail": "<optional>", "proposed_parent_item_id": "<existing item_id, fold_in only>"}]}',
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8_000);
}

/** Same defensive posture as parseWindowSummaryOutput: unparseable JSON, a
 *  missing field, an unknown disposition, or an id not in `flagged` yields
 *  no verdict for that entry. Never guess a disposition from garbage. */
function parseDispositionOutput(stdout, flagged) {
  try {
    const envelope = JSON.parse(stdout);
    let text = typeof envelope.result === "string" ? envelope.result : stdout;
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const parsed = JSON.parse(text);
    const flaggedIds = new Set(flagged.map((f) => f.id));
    const out = new Map();

    const applyVerdict = (v, fallbackId) => {
      if (!v || typeof v !== "object") return;
      const id = typeof v.id === "number" ? v.id : fallbackId;
      if (id == null || !flaggedIds.has(id)) return;
      if (!DISPOSITIONS.includes(v.disposition)) return;
      out.set(id, {
        disposition: v.disposition,
        confidence: typeof v.confidence === "number" ? v.confidence : 0,
        reason: typeof v.reason === "string" ? v.reason : null,
        proposed_text: typeof v.proposed_text === "string" ? v.proposed_text : null,
        proposed_acceptance:
          typeof v.proposed_acceptance === "string" ? v.proposed_acceptance : null,
        proposed_detail: typeof v.proposed_detail === "string" ? v.proposed_detail : null,
        proposed_parent_item_id:
          typeof v.proposed_parent_item_id === "string" ? v.proposed_parent_item_id : null,
      });
    };

    if (Array.isArray(parsed.verdicts)) {
      // The general batched shape: one verdict object per flagged id.
      for (const v of parsed.verdicts) applyVerdict(v, null);
    } else if (parsed && typeof parsed.disposition === "string") {
      // A single flat verdict with no `id` — unambiguous only when exactly
      // one detour was in this batch, so no id disambiguation was needed.
      applyVerdict(parsed, flagged.length === 1 ? flagged[0].id : null);
    }
    return out;
  } catch {
    return new Map();
  }
}

/**
 * LLM half — only ever called with what evaluateRules flagged. Skips
 * entirely (no-op, not an error) if flagged is empty, if
 * DASHBOARD_RECONCILE_MODE is off, if DASHBOARD_FOCUS_INFER_MODE is off
 * (DEC-9), or if the CLI isn't available.
 */
async function classifyFlaggedDetours(dbModule, target, flagged, opts = {}) {
  if (!flagged || flagged.length === 0) return new Map();
  if ((process.env.DASHBOARD_RECONCILE_MODE || "on").toLowerCase() === "off") return new Map();
  if ((process.env.DASHBOARD_FOCUS_INFER_MODE || "llm").toLowerCase() === "off") return new Map();

  const focusInference = require("./focus-inference");
  const available = await focusInference.probeClaudeCli();
  if (!available) return new Map();

  const cwd = typeof target === "string" ? target : target.cwd;
  const items = (dbModule.stmts.listPlanItems.all(cwd) || []).filter((i) => i.item_number != null);
  const prompt = buildDispositionPrompt(flagged, { items });
  const stdout = await focusInference.runClaudePromptJson(prompt, opts);
  if (stdout == null) return new Map();
  return parseDispositionOutput(stdout, flagged);
}

// S1 / §9.1 DERIVED-DUAL-VIEW: the anti-duplicate enqueue guard is shared
// with plan-writeback.js (writeback_conflict/writeback_failed rows) so the
// find-then-insert sequence can't drift into two different, inconsistent
// copies again. `inputDigest`, when supplied, is the computeFlaggedDigest()
// value of the batch that produced this row — the cost-control digest gate
// above reads it back on a later tick to decide whether the same unresolved
// batch needs another spawn.
const { enqueueIfNotOpen } = require("./decision-queue-enqueue");

/**
 * One tick for one cwd. Skips dead/planless cwds before the LLM step
 * (WATCH-2 + DEC-13 composition). Zero spawns, zero writes when the rules
 * flag nothing.
 */
async function reconcileCwd(dbModule, target, opts = {}) {
  const cwd = typeof target === "string" ? target : target.cwd;
  const projectId = typeof target === "string" ? null : target.project_id;
  const { stmts } = dbModule;

  const plan = stmts.getPlanByCwd.get(cwd);
  if (!plan || plan.missing_at) return { skipped: "no_plan" };
  const itemCount = stmts.listPlanItems.all(cwd).length;
  if (itemCount === 0) return { skipped: "no_items" };

  const rules = evaluateRules(dbModule, target, opts);

  // R1/R2 -> pace_alert / detour_volume queue rows (technical-plan.md §4
  // step 23(d)) — unconditional on what R3/the LLM step below does. B1/B2:
  // a pace breach is ALSO what sets cwdEscalated inside evaluateRules,
  // which flags every pending detour for the same cwd — so this must run
  // BEFORE the "nothing flagged" early return and the digest-gate return
  // below, or the most common real shape (a project that is both behind AND
  // has a pending detour) silently drops its pace_alert/detour_volume row
  // every single tick.
  for (const breach of rules.paceBreaches) {
    try {
      enqueueIfNotOpen(dbModule, {
        cwd,
        projectId,
        kind: "pace_alert",
        refId: null,
        itemId: breach.item.item_id,
        message: `Item ${breach.item.item_number} is ${breach.days_overdue} day(s) past its target date.`,
        payload: { item_number: breach.item.item_number, days_overdue: breach.days_overdue },
      });
    } catch {
      /* per-breach fail-safe: one bad pace_alert enqueue must not stop the
       * rest of this cwd's tick (the other breaches, detour_volume, or the
       * LLM classification step below). */
    }
  }
  if (rules.detourVolume.tripped) {
    try {
      enqueueIfNotOpen(dbModule, {
        cwd,
        projectId,
        kind: "detour_volume",
        refId: null,
        itemId: null,
        message: `Detour volume is high: ${rules.detourVolume.detourCount}/${rules.detourVolume.totalClassified} classified sessions were detours in the lookback window.`,
        payload: {
          ratio: rules.detourVolume.ratio,
          totalClassified: rules.detourVolume.totalClassified,
          detourCount: rules.detourVolume.detourCount,
        },
      });
    } catch {
      /* fail-safe: a bad detour_volume enqueue must not stop the LLM
       * classification step below for this cwd. */
    }
  }

  if (rules.flaggedDetours.length === 0) {
    // Cost control: nothing for the LLM to look at this tick.
    return { rules, verdicts: null };
  }

  // Cost-control digest gate (technical-plan.md §4 step 23(c)): sha1 over the
  // sorted [id, source_seen_at, label] triples of what evaluateRules just
  // flagged. If an open decision_queue row for this cwd already carries this
  // exact digest, the same unresolved batch was already sent to the LLM on a
  // prior tick and is still awaiting human review — do not spawn again.
  const flaggedDigest = computeFlaggedDigest(rules.flaggedDetours);
  const alreadyQueued = stmts.findOpenQueueItemByDigest
    ? stmts.findOpenQueueItemByDigest.get(cwd, "detour_disposition", flaggedDigest)
    : null;
  if (alreadyQueued) {
    return { rules, verdicts: null, digestGated: true };
  }

  const verdicts = await classifyFlaggedDetours(dbModule, target, rules.flaggedDetours, opts);
  const confidenceMin = numEnv("DASHBOARD_DETOUR_CONFIDENCE_MIN", DEFAULT_CONFIDENCE_MIN);

  for (const detour of rules.flaggedDetours) {
    const verdict = verdicts.get(detour.id);
    try {
      if (!verdict || verdict.confidence < confidenceMin) {
        enqueueIfNotOpen(dbModule, {
          cwd,
          projectId,
          kind: "detour_disposition",
          refId: detour.id,
          itemId: detour.item_id,
          message: `A detour needs a human look: ${detour.label || "(unlabeled)"}`,
          payload: { needs_review: true, verdict: verdict || null },
          inputDigest: flaggedDigest,
        });
        continue;
      }

      if (verdict.disposition === "deliberate" || verdict.disposition === "discard") {
        require("./detours").resolveDisposition(dbModule, detour.id, {
          disposition: verdict.disposition,
          decided_by: "llm",
          confidence: verdict.confidence,
          reason: verdict.reason,
        });
        continue;
      }

      // fold_in / new_item — DEC-13 trigger point #1: the unattended write.
      // S9: this detour can be a `listStaleResolvedDetours` row that was
      // ALREADY resolved to fold_in/new_item on a prior tick (terminal —
      // see detours.js's resolveDisposition). resolveDisposition rejects a
      // re-resolve of a terminal row with { code: 'ALREADY_RESOLVED' } and
      // leaves the row's stored proposed_text/etc. UNCHANGED — this fresh
      // verdict's proposed content is never persisted. applyDisposition
      // does not take a verdict argument; it re-reads row.proposed_text
      // from the DB by id, so calling it anyway here would silently write
      // the OLD proposal (or retry a stale 'conflict' write with it)
      // instead of dropping/logging the fresh one. Check the return value
      // the same way routes/detours.js does and skip the write on rejection.
      const resolveResult = require("./detours").resolveDisposition(dbModule, detour.id, {
        disposition: verdict.disposition,
        decided_by: "llm",
        confidence: verdict.confidence,
        reason: verdict.reason,
        proposed_text: verdict.proposed_text,
        proposed_acceptance: verdict.proposed_acceptance,
        proposed_detail: verdict.proposed_detail,
        proposed_parent_item_id: verdict.proposed_parent_item_id,
      });
      if (resolveResult && resolveResult.code === "ALREADY_RESOLVED") {
        continue;
      }
      require("./plan-writeback").applyDisposition(dbModule, detour.id, {
        broadcast: opts.broadcast,
      });
    } catch {
      /* per-detour fail-safe: one bad verdict must not stop the tick */
    }
  }

  return { rules, verdicts };
}

/** Start the scheduler loop: boot-delay tick, then a slow steady-state
 *  interval. Mirrors focus-audit.js's startFocusAudit almost verbatim. */
function startReconciliation(broadcast) {
  const mode = (process.env.DASHBOARD_RECONCILE_MODE || "on").toLowerCase();
  if (mode === "off") return;
  const tickMs = numEnv("DASHBOARD_RECONCILE_MS", DEFAULT_TICK_MS);
  if (!Number.isFinite(tickMs) || tickMs <= 0) return;

  const dbModule = require("../db");
  const maxTargets = numEnv("MAX_TARGETS_PER_TICK", DEFAULT_MAX_TARGETS);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const targets = listReconcileTargets(dbModule, maxTargets);
      for (const target of targets) {
        try {
          await reconcileCwd(dbModule, target, { broadcast });
        } catch {
          /* per-cwd fail-safe: one bad project cannot stop the tick */
        }
      }
    } finally {
      running = false;
    }
  };

  const boot = setTimeout(() => {
    tick().catch(() => {});
  }, BOOT_DELAY_MS);
  if (boot.unref) boot.unref();

  const timer = setInterval(() => {
    tick().catch(() => {});
  }, tickMs);
  if (timer.unref) timer.unref();
}

module.exports = {
  startReconciliation,
  reconcileCwd,
  listReconcileTargets,
  evaluateRules,
  classifyFlaggedDetours,
  buildDispositionPrompt,
  parseDispositionOutput,
  computeFlaggedDigest,
  __injectSpawnForTest,
};
