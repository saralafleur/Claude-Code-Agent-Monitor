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
 * Caching differs from `focus_summaries`: a value unit's cache key
 * (`unitKey`) is stable forever, but its PROMPT INPUT SET is not always
 * immutable — `MUTABLE_VALUE_SOURCES` (`intake_initiative`/`detour`/
 * `merge_commit`, `value-ledger.js`) units carry a `stage` (and sometimes a
 * `label`) that can change after the text was cached. `unitFacts(unit)` is
 * the SINGLE normalizer of a unit's prompt input set: `buildPrompt` renders
 * from it exclusively (a structural scan, single-writer-guard.test.js's
 * DEC-15 case, fails if `buildPrompt` ever reads a unit field outside
 * `unitFacts()`), so a field can never be ADDED to the prompt without also
 * being added to `unitFacts`' own return shape. `compareUnitInputs` compares
 * every `unitFacts` field field-wise on every read for a mutable source
 * EXCEPT the one named, guarantor-backed exception in
 * `UNCOMPARED_FIELD_GUARANTORS` (`value_source` — its own structural
 * invariant, not a comparator gap: see that registry's comment). A stale hit
 * is treated as an
 * ordinary cache miss (`readCached`) and flows through the existing
 * dedupe → LLM gate → cap slice → batch spawn → partition machinery
 * untouched; what could not be refreshed this round is served with its OLD
 * text plus a named `freshness`, never blanked. Sources outside
 * `MUTABLE_VALUE_SOURCES` (`trunk_commit` chief among them) keep the
 * original generate-once-served-forever behavior exactly.
 *
 * Every not-yet-cached unit in one batch is synthesized in a SINGLE spawn
 * (never one call per unit), the same batching discipline the
 * reconciliation tick already uses for detour classification.
 *
 * Deliberately does NOT call `assembleValuePool` itself — callers (the
 * `/altitudes` route AND `server/lib/value-summary-tick.js`'s background
 * overflow sweep) pass the exact units their own pool fetch already
 * resolved, so this module never re-derives or duplicates pool assembly
 * (value-ledger.js's DEC-16 tripwire stays intact). Two production invokers,
 * ONE lexical writer of the stakeholder-altitude cache table's SYNTHESIS
 * columns: that write call appears exactly once, right here inside
 * {@link enrichPoolAltitudes} (single-writer-guard.test.js enforces this
 * structurally, red-proven by injection — §9.1 DERIVED-DUAL-VIEW). This is
 * narrower than "ONE lexical writer of the table" now that the
 * `/altitudes/seen` route handler's own acknowledge statement (W-3 guard;
 * see db.js's `stmts` — the export name intentionally not repeated here so
 * this file itself never becomes a second textual hit for that guard's own
 * single-home scan) is a second, deliberately separate production writer of
 * exactly one column (`seen_at`, acknowledgement) — never the synthesis
 * columns.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { runClaudePromptJson, probeClaudeCli } = require("./focus-inference");
const { MUTABLE_VALUE_SOURCES } = require("./value-ledger");

/** The only two per-unit states a caller may see in {@link enrichPoolAltitudes}'s
 *  `states` map (DEC-11) — never hand-typed at any consumer; import this
 *  export instead. `queued`: a cache miss beyond this round's cap, not yet
 *  attempted, picked up by a later pass. `unavailable`: a cache miss that WAS
 *  in scope this round and still produced no text (LLM off, probe failure,
 *  spawn failure, or unparsable output). */
const ALTITUDE_STATES = ["queued", "unavailable"];

/** The freshness markers a resolved `altitudes[key]` entry may carry
 *  (DEC-13) — never hand-typed at any consumer; import this export instead
 *  (the client keeps its own hand-maintained copy, §9.7 accepted exception,
 *  a CJS server module cannot be imported across the Vite/Node boundary).
 *  `updated_unseen`: this round replaced a mutable unit's stale text with
 *  freshly synthesized text the user has not yet explicitly acknowledged
 *  (via the `/altitudes/seen` route). `stale_refresh_queued` /
 *  `stale_refresh_unavailable`: a mutable unit's cached text went stale but
 *  could not be refreshed THIS round (over cap / LLM unavailable) — its OLD
 *  text is still served (never blanked), re-homed out of `states` and into
 *  `altitudes` with this marker (DEC-11 BY DESIGN: the wire shows it
 *  resolved while `counts` still logs it as a miss). */
const ALTITUDE_FRESHNESS = ["stale_refresh_queued", "stale_refresh_unavailable", "updated_unseen"];

/** Bounds prompt size, not coverage — the largest measured real pool is 182
 *  units (parent effort DEC-12, 2026-08-03), so overflow is the normal case,
 *  not a rare edge. Units beyond this cap are reported explicitly as
 *  `queued` in {@link enrichPoolAltitudes}'s `states` map (never silently
 *  dropped), then drained across later calls by
 *  `server/lib/value-summary-tick.js`'s background sweep. */
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
 *  `llm` and the `claude` CLI must probe as runnable. Never throws/rejects
 *  (this file's own header contract, "never blocks the pool itself") — an
 *  unexpected probe failure degrades to unavailable, the same outcome a
 *  clean probe failure already produces, rather than propagating out of
 *  {@link enrichPoolAltitudes} and hanging its caller (the `/altitudes`
 *  route has no catch of its own around this call). */
async function llmAvailable() {
  const mode = (process.env.DASHBOARD_FOCUS_INFER_MODE || "llm").toLowerCase();
  if (mode !== "llm") return false;
  try {
    return await probeClaudeCli();
  } catch {
    return false;
  }
}

/**
 * The complete prompt input set for one unit — the ONLY place a unit's
 * fields are read for synthesis. {@link buildPrompt} renders from this
 * exclusively, {@link enrichPoolAltitudes} stores it (`input_stage`/
 * `input_label`), and {@link compareUnitInputs} compares it, so the
 * prompt's input set and the compared input set are the same object by
 * construction — a structural scan (single-writer-guard.test.js's DEC-15
 * case) fails if `buildPrompt` ever reads a unit field outside this
 * function. This means adding a field to the prompt is physically
 * impossible without adding it to `unitFacts`' own return shape — it does
 * NOT by itself mean every returned field is compared; see
 * {@link UNCOMPARED_FIELD_GUARANTORS} (BL-6) for the one enumerated
 * exception and why it is safe. `label` mirrors the fallback
 * {@link buildPrompt} always used (`label || value_ref || "(untitled)"`);
 * `stage` normalizes an absent key (e.g. a detour unit, which never carries
 * one) to `null`, never `undefined` — `undefined` is not a value SQLite can
 * bind or compare against a stored snapshot.
 * @param {{value_source: string, label?: string|null, value_ref?: string, stage?: string|null}} unit
 * @returns {{value_source: string|null, label: string, stage: string|null}}
 */
function unitFacts(unit) {
  return {
    value_source: unit.value_source ?? null,
    label: unit.label || unit.value_ref || "(untitled)",
    stage: unit.stage ?? null,
  };
}

/**
 * Fields returned by {@link unitFacts} that {@link compareUnitInputs}
 * deliberately does NOT compare, each with its own named guarantor — an
 * ENUMERATED exception, never a silent omission (§9.7's own rule; this
 * registry exists because build-reviewer's BL-6 found the prior state, a
 * bare unasserted claim of "every prompt field is compared," to be false as
 * shipped). `value-summary.test.js`'s BL-6 coverage test walks
 * `Object.keys(unitFacts(fixture))` and asserts every key OTHER than the
 * ones listed here makes {@link compareUnitInputs} detect a mutation — so a
 * future field added to `unitFacts` without either a comparator branch or an
 * entry here fails that test loudly, instead of silently reproducing this
 * exact gap.
 *
 * `value_source`: not stored as a snapshot column, not compared — and does
 * not need to be. {@link readCached} looks up the cached row by
 * `unit.unitKey`, and `unitKey` is `` `${value_source}::${ref}::${cwd}` ``
 * (`value-ledger.js`'s `unitKey()` — `value_source` is literally the key's
 * first segment). A unit whose `value_source` actually changed would
 * therefore produce a DIFFERENT `unit_key`, i.e. a lookup against a
 * different (or absent) row entirely — never a same-row mismatch
 * `compareUnitInputs` would need to catch. The invariant this exception
 * rests on is itself asserted directly (not just narrated) by
 * `value-summary.test.js`'s BL-6 companion test.
 */
const UNCOMPARED_FIELD_GUARANTORS = {
  value_source:
    "unit_key embeds value_source (value-ledger.js's unitKey()) — a changed value_source is a different unit_key, hence a different cached row, never a same-row mismatch",
};

/**
 * Field-wise comparison of a cached row's stored input snapshot against a
 * unit's CURRENT {@link unitFacts}. Returns the reason the snapshot no
 * longer matches (`"stage_changed"` takes precedence over
 * `"label_changed"`, per the engineer's approved copy — "updated — stage
 * changed"), or `null` if the snapshot still matches. A row predating this
 * migration reads both `input_stage`/`input_label` as NULL — `input_label`
 * is the legacy discriminator (`unitFacts()` never produces a NULL label),
 * so such a row always falls out via `label_changed` unless its `stage`
 * alone already differs (precedence still applies, DEC-12). Compares every
 * {@link unitFacts} field EXCEPT the ones enumerated in
 * {@link UNCOMPARED_FIELD_GUARANTORS} (today: `value_source` alone) — see
 * that registry's comment for why omitting it is safe, not an oversight.
 * @param {{input_stage: string|null, input_label: string|null}} row
 * @param {object} unit
 * @returns {"stage_changed"|"label_changed"|null}
 */
function compareUnitInputs(row, unit) {
  const facts = unitFacts(unit);
  if ((row.input_stage ?? null) !== facts.stage) return "stage_changed";
  if ((row.input_label ?? null) !== facts.label) return "label_changed";
  return null;
}

/**
 * Reads a cached row for one unit and decides whether it still serves.
 * Immutable sources (outside {@link MUTABLE_VALUE_SOURCES}) never gate on
 * the snapshot — the original generate-once-served-forever contract, exact.
 * A mutable source's row is compared field-wise; a mismatch makes this an
 * ordinary cache miss (`cached: null`) carrying the reason, so the existing
 * dedupe → LLM gate → cap slice → batch spawn machinery regenerates it
 * untouched, with zero structural change to that pipeline.
 * @param {object} dbModule
 * @param {object} unit
 * @returns {{cached: object|null, staleReason: "stage_changed"|"label_changed"|null}}
 */
function readCached(dbModule, unit) {
  const row = dbModule.stmts.getValueUnitSummary.get(unit.unitKey);
  if (!row) return { cached: null, staleReason: null };
  if (!MUTABLE_VALUE_SOURCES.includes(unit.value_source)) {
    return { cached: row, staleReason: null }; // immutable — never gated
  }
  const reason = compareUnitInputs(row, unit);
  if (reason) return { cached: null, staleReason: reason };
  return { cached: row, staleReason: null };
}

/**
 * Builds the batch synthesis prompt: every unit as a numbered ground-fact
 * line, then the ask for a project phrase + stakeholder sentence per unit.
 * Units are shown together (not one prompt per unit) so the model can use
 * sibling units as relational context for the PROJECT altitude. Reads a
 * unit's fields exclusively through {@link unitFacts} (DEC-15 structural
 * scan) — never `u.label`/`u.value_source`/`u.stage` directly.
 */
function buildPrompt(units) {
  let i = 0;
  const lines = units.map((u) => {
    i += 1;
    const facts = unitFacts(u);
    const stageBit = facts.stage ? `, stage=${facts.stage}` : "";
    return `${i}. [${facts.value_source}] ${facts.label}${stageBit}`;
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
 * Moves any stale unit that did NOT resolve this round (still sitting in
 * `states` as `"queued"`/`"unavailable"`) out of `states` and into
 * `altitudes` with its OLD cached text plus a named `freshness` — the
 * architect's re-homing rule (R3): a unit whose cache went stale is never
 * blanked on the wire just because this round couldn't refresh it.
 * `freshness` reflects WHY it didn't resolve this round
 * (`stale_refresh_queued` for over-cap, `stale_refresh_unavailable` for
 * attempted-but-failed) — the ORIGINAL stale reason
 * (`stage_changed`/`label_changed`) rides along as `update_reason` for
 * parity with a resolved `updated_unseen` entry. `counts` is never touched
 * here (DEC-11 BY DESIGN): the miss was already counted when `states` was
 * first populated, so the wire and the log deliberately disagree — the wire
 * shows "served," the log shows "miss." Mutates `altitudes`/`states` in
 * place.
 */
function reHomeStaleUnits(altitudes, states, staleReasons, staleRows) {
  for (const [unitKey, reason] of staleReasons) {
    const stateReason = states[unitKey];
    if (stateReason === undefined) continue; // resolved this round — nothing to re-home
    const row = staleRows.get(unitKey);
    if (!row) continue; // shouldn't happen, but never let a missing row crash the request
    delete states[unitKey];
    altitudes[unitKey] = {
      project: row.project_level,
      stakeholder: row.stakeholder_level,
      model: row.model,
      generated_at: row.created_at,
      cached: true,
      freshness: stateReason === "queued" ? "stale_refresh_queued" : "stale_refresh_unavailable",
      update_reason: reason,
      regenerated_at: row.regenerated_at ?? null,
    };
  }
}

/**
 * Resolves PROJECT/STAKEHOLDER altitudes for a batch of units. Cache hits
 * resolve with zero LLM calls; every miss batches into ONE spawn (capped at
 * {@link MAX_UNITS_PER_PROMPT} — units beyond the cap are simply left
 * unenriched this round rather than growing the prompt unboundedly, and will
 * resolve on a later call once earlier units are cached).
 *
 * Per-unit outcome is a strict three-way partition (DEC-11): every unit
 * submitted lands in `altitudes` (resolved) or `states` (unresolved, with a
 * `queued`/`unavailable` reason) — never both, never neither — EXCEPT a
 * stale mutable unit that could not be refreshed this round, which is
 * deliberately re-homed from `states` into `altitudes` with its old text
 * (see {@link reHomeStaleUnits}; DEC-11 BY DESIGN).
 *
 * `counts` is a single computed-once partition object, read verbatim by
 * every caller (the route, `value-summary-tick.js`) — neither caller
 * re-derives any of its terms (DEC-14, §9.8). Its four counted terms
 * (`cache_hits`/`generated`/`queued`/`unavailable`) are an unconditional
 * strict partition of `pool_size`; `stale_regenerated` is a fifth, OVERLAP
 * counter (how many of `generated` were a stale replacement, not a
 * genuinely new unit) — never part of the four-term identity.
 *
 * @param {object} dbModule
 * @param {Array<{unitKey: string, value_source: string, value_ref?: string, label?: string|null, stage?: string|null}>} units
 * @param {{droppedCount?: number}} [opts] - A-3: units the caller already
 *   dropped before calling (e.g. no usable key) but still wants counted —
 *   folded into `pool_size`/`unavailable` so the caller never re-derives a
 *   partition term of its own (the route logs `counts` verbatim).
 * @returns {Promise<{
 *   altitudes: Record<string, object>,
 *   states: Record<string, "queued"|"unavailable">,
 *   counts: {pool_size: number, cache_hits: number, generated: number, queued: number, unavailable: number, stale_regenerated: number}
 * }>}
 *   `altitudes` is keyed by unitKey; a resolved entry may additionally carry
 *   `freshness`/`update_reason`/`regenerated_at` (present only when
 *   applicable — see {@link ALTITUDE_FRESHNESS}). `states` carries an entry
 *   ONLY for units with no text this round and not re-homed (see above).
 */
async function enrichPoolAltitudes(dbModule, units, opts = {}) {
  const { droppedCount = 0 } = opts;
  const altitudes = {};
  const states = {};
  // BL-1: `counts` must ride out of EVERY return path, including this early
  // one — callers (project-plans.js's route, value-summary-tick.js) access
  // `enriched.counts.*` unconditionally. Computed first so an empty (or
  // all-dropped, droppedCount === units.length) batch still returns the full
  // three-key shape rather than crashing its caller with a TypeError.
  const counts = {
    pool_size: droppedCount,
    cache_hits: 0,
    generated: 0,
    queued: 0,
    unavailable: droppedCount,
    stale_regenerated: 0,
  };
  if (!units || units.length === 0) return { altitudes, states, counts };

  // BL-2: dedupe by unitKey ONCE, up front, before any counting starts. A
  // caller-supplied duplicate key is an anticipated input (POST /altitudes
  // never dedupes before calling this composer) — every term below
  // (cache_hits/generated/queued/unavailable) AND `pool_size` itself must be
  // derived from the SAME list, or the four-term identity breaks the moment
  // two entries share a unitKey (pool_size counted the raw list, every other
  // term counted a differently-deduped list). First occurrence wins; a later
  // duplicate is simply folded away — not a route-level rejection, so it
  // does not touch `droppedCount`/`opts.droppedCount`, which is reserved for
  // units the CALLER already couldn't use at all.
  const dedupedUnits = [...new Map(units.map((u) => [u.unitKey, u])).values()];
  counts.pool_size = dedupedUnits.length + droppedCount;

  const misses = [];
  const staleReasons = new Map(); // unitKey -> "stage_changed" | "label_changed"
  const staleRows = new Map(); // unitKey -> the row that just went stale
  for (const unit of dedupedUnits) {
    const { cached, staleReason } = readCached(dbModule, unit);
    if (cached) {
      const entry = {
        project: cached.project_level,
        stakeholder: cached.stakeholder_level,
        model: cached.model,
        generated_at: cached.created_at,
        cached: true,
      };
      // The freshness marker is a function of "has this generation been
      // seen," not "did THIS read just trigger a regeneration" — a cache
      // hit on a row whose last regeneration is still unacknowledged
      // (`regenerated_at` set, `seen_at` still NULL) must keep surfacing
      // the marker on every subsequent read until `/altitudes/seen` clears
      // it, or the marker silently vanishes on the very next page load
      // (the technical plan's own stated objective: "...until the user
      // acknowledges it").
      if (cached.regenerated_at && !cached.seen_at) {
        entry.freshness = "updated_unseen";
        entry.update_reason = cached.regen_reason;
        entry.regenerated_at = cached.regenerated_at;
      }
      altitudes[unit.unitKey] = entry;
      counts.cache_hits += 1;
    } else {
      misses.push(unit);
      if (staleReason) {
        staleReasons.set(unit.unitKey, staleReason);
        const row = dbModule.stmts.getValueUnitSummary.get(unit.unitKey);
        if (row) staleRows.set(unit.unitKey, row);
      }
    }
  }

  if (misses.length === 0) return { altitudes, states, counts };

  // `misses` was built from `dedupedUnits` above (BL-2), so it already has
  // no duplicate unitKeys — the alias below just keeps the rest of this
  // function's naming (and the cap-slice comment's original rationale — a
  // caller-supplied duplicate straddling the MAX_UNITS_PER_PROMPT boundary
  // must not land in BOTH `altitudes` (in-cap, via the LLM batch) and
  // `states` (overflow, "queued"), violating DEC-11's "never both") intact
  // without re-deriving anything a second time.
  const dedupedMisses = misses;

  if (!(await llmAvailable())) {
    // Nothing was attempted — every miss (in-cap or not) is unavailable,
    // never queued (DEC-11: "outage," not "backlog").
    for (const unit of dedupedMisses) {
      states[unit.unitKey] = "unavailable";
      counts.unavailable += 1;
    }
    reHomeStaleUnits(altitudes, states, staleReasons, staleRows);
    return { altitudes, states, counts };
  }

  const batch = dedupedMisses.slice(0, MAX_UNITS_PER_PROMPT);
  const overflow = dedupedMisses.slice(MAX_UNITS_PER_PROMPT);
  for (const unit of overflow) {
    states[unit.unitKey] = "queued";
    counts.queued += 1;
  }

  const model = summaryModel();
  const stdout = await runClaudePromptJson(buildPrompt(batch), { model });
  if (stdout == null) {
    for (const unit of batch) {
      states[unit.unitKey] = "unavailable";
      counts.unavailable += 1;
    }
    reHomeStaleUnits(altitudes, states, staleReasons, staleRows);
    return { altitudes, states, counts };
  }
  const parsed = parseOutput(stdout, batch.length);
  if (!parsed) {
    for (const unit of batch) {
      states[unit.unitKey] = "unavailable";
      counts.unavailable += 1;
    }
    reHomeStaleUnits(altitudes, states, staleReasons, staleRows);
    return { altitudes, states, counts };
  }

  const nowIso = new Date().toISOString();
  for (const [idx, { project, stakeholder }] of parsed) {
    const unit = batch[idx - 1];
    const facts = unitFacts(unit);
    const staleReason = staleReasons.get(unit.unitKey) || null;
    const regeneratedAt = staleReason ? nowIso : null; // NULL on first generation (DEC-12)
    const regenReason = staleReason || "initial";
    dbModule.stmts.upsertValueUnitSummary.run(
      unit.unitKey,
      project,
      stakeholder,
      model,
      facts.stage,
      facts.label,
      regeneratedAt,
      regenReason,
      null // seen_at — the ON CONFLICT branch hardcodes NULL regardless (G3)
    );
    const entry = {
      project,
      stakeholder,
      model,
      generated_at: nowIso,
      cached: false,
      // Always present (never omitted) so a caller can echo it straight
      // back to /altitudes/seen's compare-and-set without special-casing
      // "the key was missing" vs "the key was null" — a JSON round-trip
      // drops an `undefined` property entirely, which would otherwise turn
      // a legitimate first-generation acknowledge into a 400 (SEEN-4/A-5).
      regenerated_at: regeneratedAt,
    };
    if (staleReason) {
      entry.freshness = "updated_unseen";
      entry.update_reason = staleReason;
      counts.stale_regenerated += 1;
    }
    altitudes[unit.unitKey] = entry;
    counts.generated += 1;
  }
  // Any in-cap unit the model didn't return an entry for (omitted/garbled
  // index) was attempted but produced nothing — unavailable, not queued.
  for (const unit of batch) {
    if (!altitudes[unit.unitKey]) {
      states[unit.unitKey] = "unavailable";
      counts.unavailable += 1;
    }
  }
  reHomeStaleUnits(altitudes, states, staleReasons, staleRows);
  return { altitudes, states, counts };
}

module.exports = {
  enrichPoolAltitudes,
  buildPrompt,
  parseOutput,
  summaryModel,
  MAX_UNITS_PER_PROMPT,
  ALTITUDE_STATES,
  ALTITUDE_FRESHNESS,
  unitFacts,
  compareUnitInputs,
  UNCOMPARED_FIELD_GUARANTORS,
};
