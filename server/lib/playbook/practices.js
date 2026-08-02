/**
 * @file The Coach's Playbook catalog — the built-in set of practices the
 * Coach engine (./engine.js) evaluates on a tick. Vocabulary: a Playbook
 * holds Practices; when a practice's `detect()` fires for a scope, the
 * engine records an Observation (see library knowledge
 * `product/coach/coach-playbook-vocabulary.md` for the full agreed
 * terminology this module implements).
 *
 * v1 ships exactly one practice, `session-token-ceiling` — everything else
 * here (the `fields` schema, the pure `detect()` contract) is generic on
 * purpose so a second practice is a new catalog entry, not new plumbing.
 *
 * `detect(ctx, config)` is a pure function — no I/O, no db access — so it's
 * unit-testable in isolation from the engine's scheduling/persistence
 * concerns, same separation `evaluateRules` keeps in `../reconciliation.js`.
 * It returns `null` when the practice doesn't fire, or `{ values }` (the raw
 * numbers a client-side i18n template interpolates — this app has no
 * server-side i18n, so no display strings live here) when it does.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const PRACTICES = [
  {
    id: "session-token-ceiling",
    category: "context-management",
    scope: "session",
    kind: "risk",
    defaultSeverity: "warning",
    fields: [{ key: "thresholdTokens", type: "number", default: 100_000_000, min: 1_000_000 }],
    /** ctx: { totalTokens: number } — the session's summed token_usage. */
    detect(ctx, config) {
      if (!(ctx.totalTokens >= config.thresholdTokens)) return null;
      return { values: { totalTokens: ctx.totalTokens, thresholdTokens: config.thresholdTokens } };
    },
  },
];

const PRACTICES_BY_ID = new Map(PRACTICES.map((p) => [p.id, p]));

/** Merges a practice's own default field values into one `{ key: value }` config object. */
function defaultConfigFor(practice) {
  const config = {};
  for (const field of practice.fields) config[field.key] = field.default;
  return config;
}

/**
 * Resolves a practice's effective `{ enabled, config }` from its (possibly
 * absent) `playbook_practice_config` row — the single source of truth for
 * "defaults + stored overrides" both the engine (deciding whether to
 * evaluate a practice) and the route (serving `GET /api/playbook/practices`)
 * read through, so the two can never silently disagree about what's
 * actually configured.
 * @param {{enabled: number, config: string} | undefined} row
 * @param {typeof PRACTICES[number]} practice
 */
function resolvePracticeConfig(row, practice) {
  const config = defaultConfigFor(practice);
  if (!row) return { enabled: true, config };
  let stored = {};
  try {
    stored = JSON.parse(row.config) || {};
  } catch {
    stored = {};
  }
  for (const field of practice.fields) {
    const value = stored[field.key];
    if (typeof value === "number" && Number.isFinite(value) && value >= field.min) {
      config[field.key] = value;
    }
  }
  return { enabled: !!row.enabled, config };
}

module.exports = { PRACTICES, PRACTICES_BY_ID, defaultConfigFor, resolvePracticeConfig };
