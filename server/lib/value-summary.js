/**
 * @file Stakeholder-altitude synthesis for one project's value pool — the
 * layer above `value-ledger.js`'s raw pool assembly. Every unit
 * `assembleValuePool` computes already carries the GROUND fact
 * (`value_source`/`value_ref`/`label`, read straight from git/intake, no
 * interpretation). This module adds two more altitudes on request:
 *  - PROJECT — a short phrase naming what the unit is part of, or how it
 *    relates to its sibling units in the same batch.
 *  - STAKEHOLDER — one plain, jargon-free sentence a non-technical reader
 *    could act on.
 *
 * Mirrors `focus-summary.js`'s synthesis-layer pattern deliberately (Sara's
 * 2026-08-04 request: reuse the same leveling mechanism Focus already uses
 * for window summaries, one altitude higher): the same hermetic
 * `runClaudePromptJson` spawn contract from `focus-inference.js`, the same
 * env-driven model selection, the same "null on any unavailability" contract
 * — never throws, never blocks the pool itself.
 *
 * Caching differs from `focus_summaries`: a value unit's ground fact is
 * immutable once seen (a commit's subject line, an intake slug, never
 * change), so `value_unit_summaries` is keyed on the unit's own `unitKey`
 * with no digest gating — generated once, served forever. Every
 * not-yet-cached unit in one batch is synthesized in a SINGLE spawn (never
 * one call per unit), the same batching discipline the reconciliation tick
 * already uses for detour classification.
 *
 * Deliberately does NOT call `assembleValuePool` itself — callers (the
 * `/altitudes` route) pass the exact units their own `/pool` fetch already
 * resolved, so this module never re-derives or duplicates pool assembly
 * (value-ledger.js's DEC-16 tripwire stays intact).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { runClaudePromptJson, probeClaudeCli } = require("./focus-inference");

/** Matches focus-summary's session-cap rationale: bounded prompt size, most
 *  recent items win when a batch runs over. Pool batches are small in
 *  practice, so overflow is expected to be rare. */
const MAX_UNITS_PER_PROMPT = 40;
/** Runaway-output guard only — generous enough that a legitimate ~20-word
 *  stakeholder sentence is never chopped mid-word. */
const MAX_TEXT_LENGTH = 240;

/** The model this synthesis spawns: a dedicated override, falling back to
 *  the shared Focus-summary model, then the shared inference model, then
 *  `haiku` — same cascade shape as `focus-summary.js`'s `summaryModel()`. */
function summaryModel() {
  return (
    process.env.DASHBOARD_VALUE_SUMMARY_MODEL ||
    process.env.DASHBOARD_FOCUS_SUMMARY_MODEL ||
    process.env.DASHBOARD_FOCUS_INFER_MODEL ||
    "haiku"
  );
}

/** LLM availability gate shared with focus-summary.js: the mode must be
 *  `llm` and the `claude` CLI must probe as runnable. */
async function llmAvailable() {
  const mode = (process.env.DASHBOARD_FOCUS_INFER_MODE || "llm").toLowerCase();
  if (mode !== "llm") return false;
  return probeClaudeCli();
}

/** Reads a cached altitude pair for one unitKey, or null. */
function readCached(dbModule, unitKey) {
  const row = dbModule.stmts.getValueUnitSummary.get(unitKey);
  if (!row) return null;
  return {
    project: row.project_level,
    stakeholder: row.stakeholder_level,
    model: row.model,
    generated_at: row.created_at,
    cached: true,
  };
}

/**
 * Builds the batch synthesis prompt: every unit as a numbered ground-fact
 * line, then the ask for a project phrase + stakeholder sentence per unit.
 * Units are shown together (not one prompt per unit) so the model can use
 * sibling units as relational context for the PROJECT altitude.
 */
function buildPrompt(units) {
  const lines = units.map((u, i) => {
    const stageBit = u.stage ? `, stage=${u.stage}` : "";
    const what = u.label || u.value_ref || "(untitled)";
    return `${i + 1}. [${u.value_source}] ${what}${stageBit}`;
  });
  return [
    "You are translating raw engineering delivery records into two altitudes of plain language, for a portfolio dashboard.",
    "Each numbered line below is one unclaimed unit of delivered work from the same project — read them together, since some relate to each other.",
    "UNITS:",
    ...lines,
    "For EACH unit, write:",
    '- "project": a short phrase (under 15 words) naming what it is part of, or how it relates to the other units above — a teammate scanning the backlog should recognize it. If it stands alone, say so plainly.',
    '- "stakeholder": one plain sentence (under 20 words, no jargon, no file paths, no commit-speak) a non-technical reader could act on.',
    "Do not invent facts that are not implied by the line itself or its relation to the other units.",
    'Reply with ONLY JSON: {"units": [{"index": <1-based index>, "project": "...", "stakeholder": "..."}, ...]}',
  ]
    .join("\n")
    .slice(0, 12_000);
}

/**
 * Parse the `claude -p --output-format json` envelope into a
 * `1-based index -> {project, stakeholder}` map. Returns null on garbage
 * output or an empty/missing list; entries with a missing project or
 * stakeholder string, or an out-of-range index, are dropped rather than
 * failing the whole batch — a partial batch still enriches what it can.
 */
function parseOutput(stdout, count) {
  try {
    const envelope = JSON.parse(stdout);
    let text = typeof envelope.result === "string" ? envelope.result : stdout;
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const verdict = JSON.parse(text);
    if (!Array.isArray(verdict.units)) return null;
    const byIndex = new Map();
    for (const u of verdict.units) {
      const idx = Number(u.index);
      if (!Number.isInteger(idx) || idx < 1 || idx > count) continue;
      const project =
        typeof u.project === "string" ? u.project.trim().slice(0, MAX_TEXT_LENGTH) : "";
      const stakeholder =
        typeof u.stakeholder === "string" ? u.stakeholder.trim().slice(0, MAX_TEXT_LENGTH) : "";
      if (!project || !stakeholder) continue;
      byIndex.set(idx, { project, stakeholder });
    }
    return byIndex.size > 0 ? byIndex : null;
  } catch {
    return null;
  }
}

/**
 * Resolves PROJECT/STAKEHOLDER altitudes for a batch of units. Cache hits
 * resolve with zero LLM calls; every miss batches into ONE spawn (capped at
 * {@link MAX_UNITS_PER_PROMPT} — units beyond the cap are simply left
 * unenriched this round rather than growing the prompt unboundedly, and will
 * resolve on a later call once earlier units are cached).
 *
 * @param {object} dbModule
 * @param {Array<{unitKey: string, value_source: string, value_ref?: string, label?: string|null, stage?: string|null}>} units
 * @returns {Promise<Record<string, {project: string, stakeholder: string, model: string|null, generated_at: string, cached: boolean}>>}
 *   Map keyed by unitKey. A unit absent from the result means no altitude
 *   could be produced this round (LLM off/unavailable, spawn failure, or
 *   unparsable output) — never an error, mirroring focus-summary.js's
 *   "unavailable" contract.
 */
async function enrichPoolAltitudes(dbModule, units) {
  const result = {};
  if (!units || units.length === 0) return result;

  const misses = [];
  for (const unit of units) {
    const cached = readCached(dbModule, unit.unitKey);
    if (cached) {
      result[unit.unitKey] = cached;
    } else {
      misses.push(unit);
    }
  }

  if (misses.length === 0) return result;
  if (!(await llmAvailable())) return result;

  const batch = misses.slice(0, MAX_UNITS_PER_PROMPT);
  const model = summaryModel();
  const stdout = await runClaudePromptJson(buildPrompt(batch), { model });
  if (stdout == null) return result;
  const parsed = parseOutput(stdout, batch.length);
  if (!parsed) return result;

  for (const [idx, { project, stakeholder }] of parsed) {
    const unit = batch[idx - 1];
    dbModule.stmts.upsertValueUnitSummary.run(unit.unitKey, project, stakeholder, model);
    result[unit.unitKey] = {
      project,
      stakeholder,
      model,
      generated_at: new Date().toISOString(),
      cached: false,
    };
  }
  return result;
}

module.exports = {
  enrichPoolAltitudes,
  buildPrompt,
  parseOutput,
  summaryModel,
  MAX_UNITS_PER_PROMPT,
};
