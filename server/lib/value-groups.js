/**
 * @file Value Pool Slice 3 — the auto-group proposal engine (technical-plan.md
 * §5). Two-stage pipeline over a project's unclaimed value pool: a free,
 * deterministic, LLM-free mechanical pre-grouping pass ({@link
 * mechanicalPreGroup}) over initiative-slug references, local-calendar-day
 * time adjacency, and a shared-surface (label/path substring) proxy —
 * deliberately OVER-generating candidate clusters, a unit may land in more
 * than one — followed by one sonnet call per batch ({@link refineBatch})
 * that disambiguates raw clusters into named proposals: a name, a
 * stakeholder-level summary sentence, member unitKeys, and a rationale.
 * {@link runGroupingPass} is the SOLE writer of `value_group_runs` /
 * `value_groups` / `value_group_members` (single-writer-guard.test.js G-8).
 *
 * Architectural posture is `value-summary.js`'s, verbatim: this module NEVER
 * calls `assembleValuePool` itself (O-8) — route handlers resolve the pool
 * and the units' cached altitude text and pass them in. Registered in
 * `value-ledger.js`'s `CONSUMERS` as a derived-values reader (it reads only
 * `unitKey` — never `assembleValuePool` — see G-5's `assertSingleHome`
 * disposition, the executable proof).
 *
 * A member's `unitKey` is ALWAYS produced by `unitKey(...)` —
 * never string-concatenated by hand (§9.1 rogue re-derivation, technical-
 * plan.md §4 obligation 2).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const crypto = require("crypto");
const { unitKey } = require("./value-ledger");
const { unitFacts, summaryModel } = require("./value-summary");
const { localDayLabel } = require("./focus-summary");
// Called via the MODULE NAMESPACE object (never destructured) — same
// technique BO-5 established for `value-coverage-probe.js`'s
// `valueCoverage.coverageSnapshot`. This is what lets a test intercept the
// real LLM boundary by reassigning `require("./focus-inference").X` after
// require, rather than needing a second test-only code path in this module
// (BL-4: the deleted `runGroupingPassSync` test seam was exactly that).
const focusInference = require("./focus-inference");

// ── §3 Vocabulary — discriminated, server-authored, exported registries ──

/** value_group_runs.state's CHECK — the persisted set (technical-plan.md §3.1). */
const GROUP_RUN_ROW_STATES = ["in_progress", "completed", "completed_zero_groups", "failed"];
/** The full wire set — 'not_attempted' is the ABSENCE of a run row, never
 *  written (S-1 assertion: `GROUP_RUN_STATES.filter(s =>
 *  !GROUP_RUN_ROW_STATES.includes(s))` must equal exactly `["not_attempted"]`). */
const GROUP_RUN_STATES = ["not_attempted", ...GROUP_RUN_ROW_STATES];

/** value_groups.refinement_state — the batch-disclosure axis (§3.2). */
const GROUP_REFINEMENT_STATES = ["pending", "refined", "zero_members", "failed"];

/** value_groups.review_status — 'claimed' reserved/unreachable in Slice 3 (§3.3). */
const GROUP_REVIEW_STATES = ["proposed", "approved", "dismissed", "claimed"];

/** Per-member availability — derived at READ time only, never persisted (§3.4). */
const GROUP_MEMBER_AVAILABILITY = ["already_claimed", "available", "no_longer_in_pool"];

/** POST /groups/propose's response-level outcome (§3.5) — not a run state. */
const GROUP_PROPOSE_OUTCOMES = [
  "started",
  "reused_unchanged",
  "already_running",
  "blocked_coverage_incomplete",
];

/** Gate state, kept OUT of GROUP_RUN_STATES (§3.6, QA §1c). */
const GROUP_GATE_STATES = ["ready", "blocked_coverage_incomplete"];

/** Every pool unit that ends up in no proposal is counted under exactly one
 *  of these (AC-3, §3.7). 'no_shared_signal': mechanicalPreGroup never found
 *  a partner for it. 'not_selected_by_refinement': it started in a
 *  mechanical cluster but the LLM (or a zero_members resolution) dropped it. */
const UNGROUPED_REASONS = ["no_shared_signal", "not_selected_by_refinement"];

/** Bounds prompt size for the grouping stage, sized against the same
 *  measured distribution `MAX_UNITS_PER_PROMPT` (value-summary.js, 40) was
 *  sized against — the largest measured real pool is 182 units (parent
 *  effort DEC-12, 2026-08-03). A pool beyond this cap is never dropped
 *  (technical-plan.md §5.3 "decompose"): it is packed into multiple batches,
 *  one additional rollup call merges duplicates across batch boundaries. */
const MAX_UNITS_PER_GROUPING_PROMPT = 40;

// ── Stage 1 — mechanical pre-grouping (pure, deterministic, zero LLM, zero DB) ──

/** Minimum candidate-text length before it is eligible to drive a slug
 *  match — guards against a one/two-character label producing noise
 *  matches across unrelated commits. */
const MIN_SLUG_CANDIDATE_LENGTH = 4;

function resolveUnitKey(unit) {
  if (unit.unitKey) return unit.unitKey;
  return unitKey(unit.value_source, unit.value_ref, unit.source_cwd);
}

/** Stable hash of `signal + sorted memberUnitKeys` — byte-identical across
 *  calls regardless of input order (M-6/M-7). */
function computeClusterId(signal, memberUnitKeys) {
  const sorted = [...memberUnitKeys].sort();
  return crypto
    .createHash("sha1")
    .update(`${signal}::${sorted.join("|")}`)
    .digest("hex")
    .slice(0, 16);
}

function slugCandidatesForInitiative(unit) {
  const candidates = new Set();
  if (unit.value_ref) candidates.add(String(unit.value_ref));
  if (unit.label) candidates.add(String(unit.label));
  return [...candidates].filter((c) => c && c.length >= MIN_SLUG_CANDIDATE_LENGTH);
}

function commitTextFor(unit) {
  return String(unit.subject || unit.label || unit.value_ref || "");
}

function commitMatchesSlug(commitUnit, slugCandidates) {
  const text = commitTextFor(commitUnit).toLowerCase();
  if (!text) return false;
  return slugCandidates.some((slug) => {
    const s = slug.toLowerCase();
    return text.includes(s) || text.includes(`effort/${s}`);
  });
}

/** `label.split(":")` prefix, lowercased/trimmed — the v1 conservative
 *  shared-surface proxy (technical-plan.md §5.1, WATCH-S3-B: NOT commit-diff
 *  file-path analysis — the pool's unit objects carry no file paths). */
function surfaceKeyFor(unit) {
  const label = unit.label;
  if (!label || typeof label !== "string" || !label.includes(":")) return null;
  const prefix = label.split(":")[0].trim().toLowerCase();
  return prefix.length >= 2 ? prefix : null;
}

/**
 * @param {object[]} units - pool units (each carrying value_source/value_ref
 *   and, ideally, an already-resolved `unitKey`; falls back to
 *   `valueLedger.unitKey` when absent).
 * @returns {{clusters: object[], ungrouped: object[], signalAudit: object}}
 */
function mechanicalPreGroup(units) {
  const list = units || [];
  const keyed = list.map((u) => ({ unit: u, key: resolveUnitKey(u) }));

  const clusters = [];

  // ── slug signal — one cluster per intake_initiative with >=1 matching commit
  const initiatives = keyed.filter((k) => k.unit.value_source === "intake_initiative");
  const commits = keyed.filter((k) => k.unit.value_source !== "intake_initiative");
  let slugClusterCount = 0;
  for (const initiative of initiatives) {
    const candidates = slugCandidatesForInitiative(initiative.unit);
    if (candidates.length === 0) continue;
    const memberKeys = new Set([initiative.key]);
    for (const commit of commits) {
      if (commitMatchesSlug(commit.unit, candidates)) memberKeys.add(commit.key);
    }
    if (memberKeys.size < 2) continue; // no partner found — not a real cluster
    const memberUnitKeys = [...memberKeys];
    clusters.push({
      clusterId: computeClusterId("slug", memberUnitKeys),
      signal: "slug",
      memberUnitKeys,
      anchor: initiative.key,
    });
    slugClusterCount += 1;
  }

  // ── time signal — one cluster per local calendar day with >=2 members
  let unitsWithoutTimestamp = 0;
  const byDay = new Map();
  for (const { unit, key } of keyed) {
    if (!unit.seen_at) {
      unitsWithoutTimestamp += 1;
      continue;
    }
    const ms = new Date(unit.seen_at).getTime();
    if (!Number.isFinite(ms)) {
      unitsWithoutTimestamp += 1;
      continue;
    }
    const day = localDayLabel(ms);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(key);
  }
  let timeClusterCount = 0;
  for (const [day, dayKeys] of byDay) {
    if (dayKeys.length < 2) continue;
    const memberUnitKeys = [...new Set(dayKeys)];
    clusters.push({
      clusterId: computeClusterId("time", memberUnitKeys),
      signal: "time",
      memberUnitKeys,
      anchor: day,
    });
    timeClusterCount += 1;
  }

  // ── surface signal — one cluster per shared label prefix with >=2 members
  const bySurface = new Map();
  for (const { unit, key } of keyed) {
    const surfaceKey = surfaceKeyFor(unit);
    if (!surfaceKey) continue;
    if (!bySurface.has(surfaceKey)) bySurface.set(surfaceKey, []);
    bySurface.get(surfaceKey).push(key);
  }
  let surfaceClusterCount = 0;
  for (const [surfaceKey, surfaceKeys] of bySurface) {
    if (surfaceKeys.length < 2) continue;
    const memberUnitKeys = [...new Set(surfaceKeys)];
    clusters.push({
      clusterId: computeClusterId("surface", memberUnitKeys),
      signal: "surface",
      memberUnitKeys,
      anchor: surfaceKey,
    });
    surfaceClusterCount += 1;
  }

  // ── completeness — every input unit lands in >=1 cluster OR ungrouped
  const clusteredKeys = new Set(clusters.flatMap((c) => c.memberUnitKeys));
  const ungrouped = keyed
    .filter((k) => !clusteredKeys.has(k.key))
    .map((k) => ({ unitKey: k.key, reason: "no_shared_signal" }));

  return {
    clusters,
    ungrouped,
    signalAudit: {
      slug: { initiative_count: initiatives.length, cluster_count: slugClusterCount },
      time: { units_without_timestamp: unitsWithoutTimestamp, cluster_count: timeClusterCount },
      surface: { cluster_count: surfaceClusterCount },
    },
  };
}

// ── Stage 2 — LLM refinement (one sonnet call per batch) ──

/**
 * The complete grouping-facts input set for one unit — built ON TOP OF
 * `value-summary.js`'s `unitFacts(unit)` (§5.4), extended with `unitKey`,
 * `seen_at` (the time signal's own input), and the cached altitude text
 * (never re-synthesized here — read via the caller's own
 * `getValueUnitSummary` lookup and passed in as `cachedAltitude`).
 * @param {object} unit
 * @param {{project?: string|null, stakeholder?: string|null}|string|null} [cachedAltitude]
 * @returns {{unitKey: string, value_source: string|null, label: string, stage: string|null, seen_at: string|null, project_level: string|null, stakeholder_level: string|null}}
 */
function groupingFacts(unit, cachedAltitude) {
  const facts = unitFacts(unit);
  let projectLevel = null;
  let stakeholderLevel = null;
  if (cachedAltitude && typeof cachedAltitude === "object") {
    projectLevel = cachedAltitude.project ?? null;
    stakeholderLevel = cachedAltitude.stakeholder ?? null;
  } else if (typeof cachedAltitude === "string" && cachedAltitude) {
    // A caller that has only a single formatted altitude string (e.g. a
    // test fixture, or a caller that already merged project+stakeholder
    // text) — both altitudes carry the same text rather than silently
    // dropping one.
    projectLevel = cachedAltitude;
    stakeholderLevel = cachedAltitude;
  }
  return {
    unitKey: resolveUnitKey(unit),
    value_source: facts.value_source,
    label: facts.label,
    stage: facts.stage,
    seen_at: unit.seen_at ?? null,
    project_level: projectLevel,
    stakeholder_level: stakeholderLevel,
  };
}

/**
 * Fields returned by {@link groupingFacts} that {@link computeGroupingDigest}
 * deliberately does NOT compare, each with its own named guarantor —
 * ENUMERATED, never a silent omission (§9.7). Empty by construction:
 * {@link computeGroupingDigest} hashes the WHOLE `groupingFacts` object
 * verbatim (never a hand-picked subset of its fields), so every key
 * necessarily participates in the digest and none needs an exemption. This
 * is the safer of the two shapes value-summary.js's own
 * `UNCOMPARED_FIELD_GUARANTORS` precedent offers (that one has exactly one
 * exemption because its comparator is field-by-field, not whole-object) —
 * kept as its own registry (not literally `{}` inline) so a future field
 * that DOES need an exemption has a place to land with a reason, the same
 * shape R-9's key-walk test enforces.
 */
const GROUPING_UNCOMPARED_FIELD_GUARANTORS = {};

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Stable, byte-identical-across-runs digest over the sorted `groupingFacts`
 * list and the sorted cluster membership — Slice 1's cache-key shape reused
 * verbatim (§9.1 rogue re-derivation), never a second digest formula.
 * @param {object[]} unitsFacts - groupingFacts(...) output, one per unit
 * @param {{clusterId: string, memberUnitKeys: string[]}[]} clusters
 * @returns {string}
 */
function computeGroupingDigest(unitsFacts, clusters) {
  const sortedFacts = [...(unitsFacts || [])].map((f) => stableStringify(f)).sort();
  const sortedClusters = [...(clusters || [])]
    .map((c) =>
      stableStringify({
        clusterId: c.clusterId,
        memberUnitKeys: [...(c.memberUnitKeys || [])].sort(),
      })
    )
    .sort();
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ facts: sortedFacts, clusters: sortedClusters }))
    .digest("hex");
}

/**
 * Numbered, structured prompt for one batch of clusters — mirrors
 * `value-summary.js`'s `buildPrompt` idiom. Reads unit fields EXCLUSIVELY
 * through `factsByKey` (never a raw unit object) — §5.4's structural
 * constraint, the same discipline `single-writer-guard.test.js` already
 * enforces on `buildPrompt`.
 * @param {{clusterId: string, signal: string, memberUnitKeys: string[]}[]} clusters
 * @param {Record<string, object>} factsByKey - unitKey -> groupingFacts(...)
 */
function buildGroupingPrompt(clusters, factsByKey) {
  const lines = [];
  clusters.forEach((cluster, idx) => {
    lines.push(
      `CLUSTER ${idx + 1} (signal=${cluster.signal}, anchor=${cluster.anchor ?? cluster.clusterId}):`
    );
    for (const key of cluster.memberUnitKeys) {
      const f = factsByKey[key];
      if (!f) continue;
      const stageBit = f.stage ? `, stage=${f.stage}` : "";
      const altitudeBit = f.stakeholder_level || f.project_level || "";
      lines.push(`  - [${f.value_source}] ${f.label}${stageBit} — ${altitudeBit}`);
    }
  });
  return [
    "You are naming and summarizing clusters of related delivered engineering work for a portfolio dashboard.",
    "Each CLUSTER below is a candidate group of related units of work — read its members together.",
    ...lines,
    "For EACH numbered cluster, write:",
    '- "name": a short name for the group (under 8 words).',
    '- "summary_sentence": one plain sentence (under 20 words, no jargon, no file paths, no commit-speak) a non-technical reader could act on.',
    '- "rationale": one short phrase explaining why these units belong together.',
    '- "memberUnitKeys": the exact unitKeys (copied verbatim from the list above) that truly belong in this group — you may drop a member that does not actually belong, never invent one.',
    "Do not invent facts that are not implied by the lines above.",
    'Reply with ONLY JSON: {"groups": [{"clusterIndex": <1-based CLUSTER number>, "name": "...", "summary_sentence": "...", "rationale": "...", "memberUnitKeys": ["..."]}, ...]}',
  ].join("\n");
}

/**
 * Strict whitelist parse of ONE group's worth of model output — only
 * `name`/`summary_sentence`/`rationale`/`memberUnitKeys` are ever read; any
 * other field (including `status`/`review_status`/`claimed`) is discarded
 * (§5.2, N-3/N-4). Member keys outside `cluster.memberUnitKeys` are dropped,
 * never invented. Returns `null` for malformed JSON, an echoed/garbled
 * payload, or a missing required field (`name`/`summary_sentence`).
 * @param {string} stdout - either a raw JSON object for one group, or a
 *   `claude -p --output-format json` envelope (`{result: "..."}`) wrapping one.
 * @param {{memberUnitKeys: string[]}} cluster
 * @returns {{name: string, summary_sentence: string, rationale: string, memberUnitKeys: string[]}|null}
 */
function parseGroupingOutput(stdout, cluster) {
  let obj;
  try {
    const envelope = JSON.parse(stdout);
    if (envelope && typeof envelope.result === "string") {
      const text = envelope.result
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      obj = JSON.parse(text);
    } else {
      obj = envelope;
    }
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;

  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const summarySentence =
    typeof obj.summary_sentence === "string" ? obj.summary_sentence.trim() : "";
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";
  if (!name || !summarySentence) return null; // missing required field(s)

  const clusterMembers = new Set((cluster && cluster.memberUnitKeys) || []);
  const rawMembers = Array.isArray(obj.memberUnitKeys) ? obj.memberUnitKeys : [];
  const memberUnitKeys = rawMembers.filter((k) => clusterMembers.has(k));

  // STRICT WHITELIST return — exactly these four fields, never `status`/
  // `review_status`/`claimed`/anything else the model echoed.
  return { name, summary_sentence: summarySentence, rationale, memberUnitKeys };
}

/** Shared LLM-availability gate (mirrors value-summary.js's own private
 *  `llmAvailable`, not exported there — this is this module's own copy, same
 *  contract, never throws). Calls `focusInference.probeClaudeCli()` through
 *  the module namespace (BO-5 technique) so a test can stub it. */
async function llmAvailable() {
  const mode = (process.env.DASHBOARD_FOCUS_INFER_MODE || "llm").toLowerCase();
  if (mode !== "llm") return false;
  try {
    return await focusInference.probeClaudeCli();
  } catch {
    return false;
  }
}

/**
 * One sonnet call over a whole batch of clusters. Returns `null` when the
 * LLM is unavailable or the whole batch's output is unusable (the caller
 * discloses every cluster in the batch as `refinement_state='failed'`), or
 * an array with one entry per cluster (each either a parsed group object or
 * `null` for that one cluster specifically — a partial-batch result).
 * @param {object[]} clusters
 * @param {Record<string, object>} factsByKey
 * @param {{model?: string}} [opts]
 * @returns {Promise<(object|null)[]|null>}
 */
async function refineBatch(clusters, factsByKey, opts = {}) {
  if (!(await llmAvailable())) return null;
  const model = opts.model || summaryModel("grouping");
  const prompt = buildGroupingPrompt(clusters, factsByKey);
  const stdout = await focusInference.runClaudePromptJson(prompt, { model });
  if (stdout == null) return null;

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return null;
  }
  let text = typeof envelope.result === "string" ? envelope.result : stdout;
  text = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let parsedEnvelope;
  try {
    parsedEnvelope = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsedEnvelope || !Array.isArray(parsedEnvelope.groups)) return null;

  return clusters.map((cluster, idx) => {
    const match = parsedEnvelope.groups.find((g) => Number(g.clusterIndex) === idx + 1);
    if (!match) return null;
    return parseGroupingOutput(JSON.stringify(match), cluster);
  });
}

/**
 * When `batch_count > 1`, one additional sonnet call over the leaf groups'
 * `(name, summary, member_count)` merges duplicates across batch
 * boundaries; member unitKeys carry forward BY REFERENCE (O-6: no
 * intermediate rows persist, no `parent_group_id`).
 *
 * BL-2 fix: returns an array the SAME LENGTH AND SAME ORDER as `leafGroups`
 * — one mapping entry per input index — rather than a re-ordered, shorter
 * array. The caller can therefore zip the result back onto its own
 * `refinedIdx` positionally without any risk of misattribution. Each entry
 * is either `{ content, absorbedInto: null }` (this leaf survives, possibly
 * with its `memberUnitKeys` widened by a merge) or `{ content: null,
 * absorbedInto: <0-based index into leafGroups> }` (this leaf was merged
 * INTO another entry and must never become its own persisted group row —
 * a terminal disposition, not a second copy). Falls back to the identity
 * mapping (no merge) whenever the LLM is unavailable or its output is
 * unusable — a conservative, safe default (never drops or duplicates a leaf
 * group because rollup failed).
 * @param {object[]} leafGroups - each `{name, summary_sentence, memberUnitKeys}`
 * @param {{model?: string}} [opts]
 * @returns {Promise<{content: object|null, absorbedInto: number|null}[]>}
 */
async function rollupGroups(leafGroups, opts = {}) {
  const identityMapping = (groups) =>
    (groups || []).map((content) => ({ content, absorbedInto: null }));
  if (!leafGroups || leafGroups.length <= 1) return identityMapping(leafGroups);
  if (!(await llmAvailable())) return identityMapping(leafGroups);
  const model = opts.model || summaryModel("grouping");
  const prompt = [
    "The following are candidate groups from separate batches of the same portfolio's delivered work.",
    "Merge any two entries that describe the SAME real group (same underlying work), keeping the clearer name/summary. Leave distinct groups unmerged.",
    ...leafGroups.map(
      (g, i) =>
        `${i + 1}. ${g.name} — ${g.summary_sentence} (${(g.memberUnitKeys || []).length} members)`
    ),
    'Reply with ONLY JSON: {"merges": [[<1-based indices that are the same group>], ...]} — omit indices that stay distinct.',
  ].join("\n");
  let stdout;
  try {
    stdout = await focusInference.runClaudePromptJson(prompt, { model });
  } catch {
    return identityMapping(leafGroups);
  }
  if (stdout == null) return identityMapping(leafGroups);
  let parsed;
  try {
    const envelope = JSON.parse(stdout);
    const text =
      typeof envelope.result === "string"
        ? envelope.result
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/```\s*$/, "")
            .trim()
        : stdout;
    parsed = JSON.parse(text);
  } catch {
    return identityMapping(leafGroups);
  }
  if (!parsed || !Array.isArray(parsed.merges)) return identityMapping(leafGroups);

  const mapping = identityMapping(leafGroups);
  const consumed = new Set();
  for (const group of parsed.merges) {
    const indices = Array.isArray(group)
      ? group.map(Number).filter((n) => n >= 1 && n <= leafGroups.length)
      : [];
    if (indices.length < 2) continue;
    const [first, ...rest] = indices;
    if (consumed.has(first) || rest.some((i) => consumed.has(i))) continue;
    const base = leafGroups[first - 1];
    const memberUnitKeys = [
      ...new Set([
        ...(base.memberUnitKeys || []),
        ...rest.flatMap((i) => leafGroups[i - 1].memberUnitKeys || []),
      ]),
    ];
    // The base (first-named) index KEEPS its own row, widened to the union
    // of members; every other index in this merge group is ABSORBED — it
    // gets no group row of its own (persistPassResults skips it entirely).
    mapping[first - 1] = { content: { ...base, memberUnitKeys }, absorbedInto: null };
    rest.forEach((i) => {
      mapping[i - 1] = { content: null, absorbedInto: first - 1 };
      consumed.add(i);
    });
    consumed.add(first);
  }
  return mapping;
}

// ── Orchestration — runGroupingPass is the SOLE writer of the three tables ──
// BL-3: no module-scope `require("../db")` default connection anywhere in
// this file (the ONE thing this module must never do — every other
// `value-*.js` library takes its `dbModule` by explicit DI). Every writer
// below takes `dbModule` as its own first argument; there is no
// convenience/no-dbModule-argument wrapper for tests to reach for instead.

/**
 * Persists ONE `value_groups` row. The SOLE writer of `name`/
 * `summary_sentence`/`rationale`/`refinement_state`/`refined_at` (§3.2's
 * partition — these three text fields are non-NULL if and only if
 * `refinementState === 'refined'`).
 * @param {object} dbModule - `{db, stmts}` (or the raw `db` connection,
 *   which itself also carries `.stmts` in this codebase) — explicit DI,
 *   never a module-level default.
 * @param {string} runId
 * @param {string} pregroupSignal - one of 'slug'|'time'|'surface'|'mixed'
 * @param {{name?: string, summary_sentence?: string, rationale?: string}} content
 * @param {string} [refinementState] - defaults to 'pending'
 * @returns {number} the new value_groups.id
 */
function insertValueGroupRow(
  dbModule,
  runId,
  pregroupSignal,
  content,
  refinementState = "pending"
) {
  const isRefined = refinementState === "refined";
  const refinedAt = isRefined ? new Date().toISOString() : null;
  const info = dbModule.stmts.insertValueGroup.run(
    runId,
    isRefined ? (content && content.name) || null : null,
    isRefined ? (content && content.summary_sentence) || null : null,
    isRefined ? (content && content.rationale) || null : null,
    pregroupSignal,
    refinementState,
    refinedAt
  );
  return info.lastInsertRowid;
}

function insertMembersFor(dbModule, groupId, memberUnitKeys, unitsByKey) {
  for (const key of memberUnitKeys) {
    const unit = unitsByKey.get(key);
    if (!unit) continue; // a key the model invented outside the pool — never persisted
    dbModule.stmts.insertValueGroupMember.run(
      groupId,
      unit.value_source,
      String(unit.value_ref),
      unit.source_cwd || ""
    );
  }
}

function buildUnitsByKey(units) {
  const map = new Map();
  for (const unit of units || []) map.set(resolveUnitKey(unit), unit);
  return map;
}

/** Packs clusters into batches of <= MAX_UNITS_PER_GROUPING_PROMPT total
 *  members. A single cluster's members are NEVER split across batches — an
 *  oversized cluster becomes its own (oversized) batch instead
 *  (technical-plan.md §5.3 "decompose"). */
function packBatches(clusters) {
  const batches = [];
  let current = [];
  let currentSize = 0;
  let oversizedBatchCount = 0;
  for (const cluster of clusters) {
    const size = cluster.memberUnitKeys.length;
    if (size > MAX_UNITS_PER_GROUPING_PROMPT) {
      if (current.length > 0) {
        batches.push(current);
        current = [];
        currentSize = 0;
      }
      batches.push([cluster]);
      oversizedBatchCount += 1;
      continue;
    }
    if (currentSize + size > MAX_UNITS_PER_GROUPING_PROMPT && current.length > 0) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(cluster);
    currentSize += size;
  }
  if (current.length > 0) batches.push(current);
  return { batches, oversizedBatchCount };
}

function newRunId(projectId) {
  return `${projectId}::${new Date().toISOString()}::${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Shared persistence core for one grouping pass — takes the ALREADY-DECIDED
 * per-cluster outcome and writes the run row, every group row, and every
 * member row.
 *
 * BL-2 fix (`absorbed` outcomes): a cluster whose outcome is `{ state:
 * "absorbed" }` was merged into another cluster's group during rollup — it
 * gets NO group row and NO member rows of its own (its members are already
 * included, by reference, in the group it was absorbed into). Persisting a
 * second row for it would duplicate the proposal; skipping its members
 * without this branch would double-subtract them from `notSelected` below.
 *
 * BL-2 / should-fix #6 fix (`notSelected`): computed as a SET DIFFERENCE
 * over unit keys — every pool unit that is neither `no_shared_signal`
 * (mechanicalPreGroup never clustered it) nor a member of at least one
 * PERSISTED group — never per-cluster subtraction. Per-cluster subtraction
 * is wrong the moment `mechanicalPreGroup`'s deliberate over-generation
 * (M-5) puts one unit in two clusters: summing `cluster.length -
 * persisted.length` independently per cluster can go negative for a merged
 * cluster (a real, reproduced defect) and double-counts a unit that is a
 * member of two clusters that both persist it.
 */
function persistPassResults(dbModule, runId, clusters, outcomes, unitsByKey, pre, opts = {}) {
  let groupCount = 0;
  const selectedKeys = new Set();
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const outcome = outcomes[i]; // { state: 'refined'|'zero_members'|'failed'|'absorbed', content? }
    if (outcome.state === "absorbed") continue; // terminal disposition, no row of its own
    const groupId = insertValueGroupRow(
      dbModule,
      runId,
      cluster.signal,
      outcome.content,
      outcome.state
    );
    groupCount += 1;
    const persistedMembers =
      outcome.state === "refined" || outcome.state === "zero_members"
        ? outcome.content.memberUnitKeys
        : cluster.memberUnitKeys;
    insertMembersFor(dbModule, groupId, persistedMembers, unitsByKey);
    for (const key of persistedMembers) selectedKeys.add(key);
  }

  const noSignalKeys = new Set((pre.ungrouped || []).map((u) => u.unitKey));
  let notSelected = 0;
  for (const key of unitsByKey.keys()) {
    if (noSignalKeys.has(key) || selectedKeys.has(key)) continue;
    notSelected += 1;
  }

  const state = opts.forcedState || (clusters.length === 0 ? "completed_zero_groups" : "completed");
  dbModule.stmts.updateValueGroupRunState.run(
    state,
    opts.digest ?? null, // COALESCE preserves the existing value when null
    clusters.length > 0 ? Math.max(1, opts.batchCount || 0) : 0,
    opts.oversizedBatchCount || 0,
    groupCount,
    pre.ungrouped.length,
    notSelected,
    opts.forcedErrorReason || null,
    new Date().toISOString(),
    runId
  );

  const run = dbModule.stmts.getValueGroupRun.get(runId);
  const groups = dbModule.stmts.listValueGroupsForRun.all(runId);
  return { run, groups };
}

/**
 * The SOLE writer of `value_group_runs` / `value_groups` /
 * `value_group_members` (single-writer-guard.test.js G-8). Writes the run
 * row `in_progress` SYNCHRONOUSLY, before any `await` — the route handler
 * relies on this (BL-13: it fires this call WITHOUT awaiting it, matching
 * `runCoverageDrain`'s own established fire-and-forget precedent in this
 * same file family, then re-reads the row this synchronous prefix already
 * wrote for its own response). Any throw lands `state='failed'` with
 * `error_reason`.
 *
 * BL-5 fix (permanent digest-cache poisoning): if NO batch actually
 * produced usable output (every batch came back `failed` — the LLM was
 * unavailable, or every batch's output was unusable) while clusters DID
 * exist, this run is landed as `state='failed'` (never `completed`) and its
 * `input_digest` is left unpersisted (`null`, via `COALESCE`) — so the
 * route's own `state === 'completed' || 'completed_zero_groups'` reuse
 * check can never match it (mirroring how a `failed` run is already never
 * reused, TT-c) and the very next propose click genuinely retries instead
 * of being stuck on `reused_unchanged` forever. `error_reason` also
 * discriminates *why*: `'llm_unavailable'` when the whole pass never had an
 * LLM to call, `'llm_output_unusable'` when it was available but every
 * batch's output was unusable — the two faces §9.8 OVERLOADED-ABSENCE names
 * (BL-5) collapsed into one otherwise.
 * @param {object} dbModule
 * @param {string} projectId
 * @param {object[]} units - live pool units, each already carrying `unitKey`
 * @param {Record<string, object>} factsByKey - unitKey -> groupingFacts(...);
 *   entries are computed on the fly for any unit missing one.
 * @param {{model?: string, digest?: string}} [opts]
 * @returns {Promise<{run: object, groups: object[]}>}
 */
async function runGroupingPass(dbModule, projectId, units, factsByKey, opts = {}) {
  const runId = newRunId(projectId);
  const model = opts.model || summaryModel("grouping");
  dbModule.stmts.insertValueGroupRun.run(runId, projectId, model, new Date().toISOString());

  try {
    const pre = mechanicalPreGroup(units);
    const clusters = pre.clusters;
    const unitsByKey = buildUnitsByKey(units);
    const facts = factsByKey || {};

    const { batches, oversizedBatchCount } = packBatches(clusters);
    const leafGroupsByCluster = new Map(); // clusterId -> outcome

    for (const batch of batches) {
      const batchFacts = {};
      for (const cluster of batch) {
        for (const key of cluster.memberUnitKeys) {
          batchFacts[key] = facts[key] || groupingFacts(unitsByKey.get(key) || {}, null);
        }
      }
      // BL-5(b): distinguish "never had an LLM to call" from "called it,
      // got unusable output" BEFORE calling refineBatch — refineBatch's own
      // `null` return collapses both, so the discriminator has to be
      // decided at this outer layer, once per batch.
      const wasAvailable = await llmAvailable();
      let results;
      if (!wasAvailable) {
        results = null;
      } else {
        try {
          results = await refineBatch(batch, batchFacts, { model });
        } catch {
          results = null;
        }
      }
      const failureReason = wasAvailable ? "llm_output_unusable" : "llm_unavailable";
      batch.forEach((cluster, idx) => {
        const parsed = results ? results[idx] : null;
        if (!parsed) {
          leafGroupsByCluster.set(cluster.clusterId, { cluster, state: "failed", failureReason });
        } else if (parsed.memberUnitKeys.length === 0) {
          leafGroupsByCluster.set(cluster.clusterId, {
            cluster,
            state: "zero_members",
            content: parsed,
          });
        } else {
          leafGroupsByCluster.set(cluster.clusterId, {
            cluster,
            state: "refined",
            content: parsed,
          });
        }
      });
    }

    // Rollup (§5.3): only meaningful across REFINED leaf groups when more
    // than one batch ran. Merged groups replace their originals BY
    // REFERENCE — member unitKeys carry forward untouched. `rollupGroups`
    // returns a same-length, same-order mapping (BL-2) — zipped back onto
    // `orderedOutcomes` positionally via `refinedIdx`, never re-ordered.
    const orderedOutcomes = clusters.map((c) => leafGroupsByCluster.get(c.clusterId));
    if (batches.length > 1) {
      const refinedIdx = [];
      const refinedLeaf = [];
      orderedOutcomes.forEach((o, idx) => {
        if (o.state === "refined") {
          refinedIdx.push(idx);
          refinedLeaf.push(o.content);
        }
      });
      if (refinedLeaf.length > 1) {
        let mapping;
        try {
          mapping = await rollupGroups(refinedLeaf, { model });
        } catch {
          mapping = refinedLeaf.map((content) => ({ content, absorbedInto: null }));
        }
        // Only apply the rollup when it produced a well-formed, same-length
        // mapping — never let a malformed rollup response corrupt what
        // refineBatch already produced correctly.
        if (Array.isArray(mapping) && mapping.length === refinedLeaf.length) {
          refinedIdx.forEach((idx, i) => {
            const entry = mapping[i];
            if (entry && entry.absorbedInto !== null) {
              orderedOutcomes[idx] = { ...orderedOutcomes[idx], state: "absorbed", content: null };
            } else if (entry && entry.content) {
              orderedOutcomes[idx] = { ...orderedOutcomes[idx], content: entry.content };
            }
          });
        }
      }
    }

    const usableCount = orderedOutcomes.filter(
      (o) => o.state === "refined" || o.state === "zero_members"
    ).length;
    const poisoned = usableCount === 0 && clusters.length > 0;

    // The digest MUST be computed over the SAME facts set the route's own
    // cache-hit check uses (opts.digest, when the caller already computed
    // one) — never re-derived from a different/partial slice here, or a
    // digest match at the route would never agree with what got persisted
    // (§9.1 rogue re-derivation). BL-5: never persisted when `poisoned`.
    const digest = poisoned
      ? null
      : (opts.digest ?? computeGroupingDigest(Object.values(facts), clusters));

    let forcedState;
    let forcedErrorReason = null;
    if (poisoned) {
      const reasons = new Set(
        orderedOutcomes
          .filter((o) => o.state === "failed")
          .map((o) => o.failureReason || "llm_output_unusable")
      );
      forcedState = "failed";
      forcedErrorReason = reasons.size === 1 ? [...reasons][0] : "llm_output_unusable";
    }

    const { run, groups } = persistPassResults(
      dbModule,
      runId,
      clusters,
      orderedOutcomes,
      unitsByKey,
      pre,
      {
        digest,
        batchCount: batches.length,
        oversizedBatchCount,
        forcedState,
        forcedErrorReason,
      }
    );
    return { run, groups };
  } catch (err) {
    dbModule.stmts.updateValueGroupRunState.run(
      "failed",
      null,
      0,
      0,
      0,
      0,
      0,
      String((err && err.message) || err),
      new Date().toISOString(),
      runId
    );
    return { run: dbModule.stmts.getValueGroupRun.get(runId), groups: [] };
  }
}

/**
 * An `in_progress` row cannot outlive the process honestly — flips every
 * surviving `in_progress` row (across every project, in one call) to
 * `failed` / `error_reason='interrupted_restart'`, called once at boot
 * (server/index.js, same try/catch posture as `startValueSummaryTick`).
 * Never overwrites an already-terminal row (`completed` /
 * `completed_zero_groups` / `failed` with some other reason) — the
 * UPDATE's own `WHERE state = 'in_progress'` makes this true by
 * construction, not by a second read-then-write check.
 * @param {object} dbModule
 * @returns {number} rows flipped
 */
function reconcileInterruptedGroupRuns(dbModule) {
  const nowIso = new Date().toISOString();
  const info = dbModule.stmts.markInterruptedValueGroupRuns.run(nowIso);
  return info.changes;
}

// ── §5.5 Read-time drift safety (pure, no DB, no persistence) ──

/**
 * Precedence: `already_claimed` (wins) > `available` (live pool) >
 * `no_longer_in_pool` (elsewhere). Partition: every member lands in exactly
 * one bucket. Matches on `(value_source, value_ref)` only — the same pair
 * `value_claims`'s own unique index keys on alongside `source_cwd` — cwd is
 * intentionally not part of the match key here since a group member's
 * identity for availability purposes is its ground unit, not which mapped
 * cwd produced it.
 * @param {object[]} memberRows - value_group_members rows
 * @param {object[]} liveUnits - assembleValuePool's current units
 * @param {object[]} claims - listClaimsForProject's current rows
 * @returns {{byGroupId: Record<number, object[]>, countsByGroupId: Record<number, object>}}
 */
function resolveMemberAvailability(memberRows, liveUnits, claims) {
  const memberKey = (row) => `${row.value_source}::${row.value_ref}`;
  const claimedKeys = new Set((claims || []).map(memberKey));
  const liveKeys = new Set((liveUnits || []).map(memberKey));

  const byGroupId = {};
  const countsByGroupId = {};
  for (const row of memberRows || []) {
    const key = memberKey(row);
    let availability;
    if (claimedKeys.has(key)) availability = "already_claimed";
    else if (liveKeys.has(key)) availability = "available";
    else availability = "no_longer_in_pool";

    if (!byGroupId[row.group_id]) byGroupId[row.group_id] = [];
    byGroupId[row.group_id].push({
      unitKey: unitKey(row.value_source, row.value_ref, row.source_cwd || ""),
      value_source: row.value_source,
      value_ref: row.value_ref,
      availability,
    });

    if (!countsByGroupId[row.group_id]) {
      countsByGroupId[row.group_id] = { already_claimed: 0, available: 0, no_longer_in_pool: 0 };
    }
    countsByGroupId[row.group_id][availability] += 1;
  }
  return { byGroupId, countsByGroupId };
}

module.exports = {
  // §3 registries
  GROUP_RUN_ROW_STATES,
  GROUP_RUN_STATES,
  GROUP_REFINEMENT_STATES,
  GROUP_REVIEW_STATES,
  GROUP_MEMBER_AVAILABILITY,
  GROUP_PROPOSE_OUTCOMES,
  GROUP_GATE_STATES,
  UNGROUPED_REASONS,
  MAX_UNITS_PER_GROUPING_PROMPT,
  // Stage 1
  mechanicalPreGroup,
  // Stage 2
  groupingFacts,
  GROUPING_UNCOMPARED_FIELD_GUARANTORS,
  computeGroupingDigest,
  buildGroupingPrompt,
  parseGroupingOutput,
  refineBatch,
  rollupGroups,
  // Orchestration
  insertValueGroupRow,
  runGroupingPass,
  reconcileInterruptedGroupRuns,
  // §5.5
  resolveMemberAvailability,
};
