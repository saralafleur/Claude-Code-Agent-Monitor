/**
 * @file SF-4 extraction (technical-plan.md §6): the single composition of a
 * probe-mode `coverageSnapshot` — the 4-step sequence (assemble the pool,
 * probe altitude coverage, resolve `requestedAt`, resolve `draining`) that
 * `POST /coverage-request` and `GET /coverage` each hand-duplicated before
 * this extraction, and that Slice 3's `POST /groups/propose` gate is this
 * function's third — never a fourth hand-copied — call site
 * (single-writer-guard.test.js G-1/G-2/G-4, red-proven by injecting a
 * fourth copy).
 *
 * Not folded into `value-coverage.js`, whose own header states it contains
 * "NO pool-membership SQL and NO membership query of its own" —
 * `buildProbeCoverage` calls `assembleValuePool` directly and would
 * contradict that contract.
 *
 * BO-5 (CRITICAL): `coverageSnapshot` is called through the `valueCoverage`
 * module namespace object (`valueCoverage.coverageSnapshot(...)`), never
 * destructured at the top of this file — this is what lets
 * `value-coverage-probe.test.js`'s P-7 behavioral spy intercept the call by
 * monkey-patching the module's own export before this module resolves it.
 *
 * The `requestedAt` divergence between POST and GET is load-bearing
 * (SF-2/SF-3), not a bug to erase: POST cannot re-read
 * `getValueSweepState` without racing the fire-and-forget drain it just
 * kicked, so it passes its own freshly-written timestamp via
 * `opts.requestedAt`; GET has no fresher value of its own and reads sweep
 * state. This function PARAMETERIZES that difference — a guard that forced
 * the two routes to behave identically here would re-introduce a fixed bug
 * (do not add a route↔route parity assertion; see
 * single-writer-guard.test.js's G-9 comment, DEC-S3-4).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const valueLedger = require("./value-ledger");
const { enrichPoolAltitudes } = require("./value-summary");
const valueCoverage = require("./value-coverage");
const { isDrainingProject } = require("./value-summary-tick");

/**
 * @param {object} dbModule
 * @param {string} projectId
 * @param {{requestedAt?: string|null}} [opts] - when `requestedAt` is an
 *   own-property of `opts` (even if `null`), it is used VERBATIM and never
 *   re-read from sweep state (P-2). Omitted entirely → falls back to
 *   `getValueSweepState`'s `coverage_requested_at` (P-3), or `null` (never
 *   `undefined`, P-4) when no sweep-state row exists at all.
 * @returns {Promise<object>} the same nine-key `coverageSnapshot` shape T6
 *   anchors (`server/__tests__/project-plans-api.test.js`'s response-key-set
 *   test).
 */
async function buildProbeCoverage(dbModule, projectId, opts = {}) {
  const { units } = await valueLedger.assembleValuePool(dbModule, { id: projectId });
  const { counts } = await enrichPoolAltitudes(dbModule, units, { probe: true });

  let requestedAt;
  if (Object.prototype.hasOwnProperty.call(opts, "requestedAt")) {
    requestedAt = opts.requestedAt; // caller has a fresher value (POST) — never re-derived
  } else {
    const state = dbModule.stmts.getValueSweepState.get(projectId);
    requestedAt = state ? state.coverage_requested_at : null;
  }

  return valueCoverage.coverageSnapshot(dbModule, {
    projectId,
    counts,
    requestedAt,
    draining: isDrainingProject(projectId),
    computedAt: new Date().toISOString(),
  });
}

module.exports = { buildProbeCoverage };
