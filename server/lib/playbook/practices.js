/**
 * @file The Coach's Playbook catalog — the built-in set of practices the
 * Coach engine (./engine.js) evaluates on a tick. Vocabulary: a Playbook
 * holds Practices; when a practice's `detect()` fires for a scope, the
 * engine records an Observation (see library knowledge
 * `product/coach/coach-playbook-vocabulary.md` for the full agreed
 * terminology this module implements).
 *
 * The `fields` schema and the pure `detect()` contract are generic on
 * purpose, so a new practice is a new catalog entry, not new plumbing —
 * `session-token-ceiling` (session scope) and `account-weekly-balance`
 * (global scope) each prove that out.
 *
 * `detect(ctx, config)` is a pure function — no I/O, no db access — so it's
 * unit-testable in isolation from the engine's scheduling/persistence
 * concerns, same separation `evaluateRules` keeps in `../reconciliation.js`.
 * It returns `null` when the practice doesn't fire, or `{ values }` (the raw
 * numbers/labels a client-side i18n template interpolates — this app has no
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
  {
    id: "account-weekly-balance",
    category: "account-management",
    scope: "global",
    kind: "info",
    defaultSeverity: "info",
    fields: [{ key: "gapThresholdPct", type: "number", default: 25, min: 1 }],
    /**
     * ctx: { accounts: Array<{ id: string, label: string, weeklyUsedPct: number|null }> }
     * — every enabled account's latest known weekly-quota-used percentage.
     * Fires when at least two accounts still have headroom (weeklyUsedPct <
     * 100) and the spread between the lowest- and highest-used of those
     * accounts is at least `gapThresholdPct` points — the recommendation is
     * always to rotate active work onto the lowest-used one, so a session
     * window running out on the heavily-used account still has a fallback
     * with weekly quota left.
     */
    detect(ctx, config) {
      const eligible = (ctx.accounts || []).filter(
        (a) => typeof a.weeklyUsedPct === "number" && a.weeklyUsedPct < 100
      );
      if (eligible.length < 2) return null;

      const low = eligible.reduce((a, b) => (b.weeklyUsedPct < a.weeklyUsedPct ? b : a));
      const high = eligible.reduce((a, b) => (b.weeklyUsedPct > a.weeklyUsedPct ? b : a));
      const gapPct = high.weeklyUsedPct - low.weeklyUsedPct;
      if (gapPct < config.gapThresholdPct) return null;

      return {
        values: {
          gapPct: Math.round(gapPct),
          gapThresholdPct: config.gapThresholdPct,
          lowAccountId: low.id,
          lowLabel: low.label,
          lowPct: Math.round(low.weeklyUsedPct),
          highAccountId: high.id,
          highLabel: high.label,
          highPct: Math.round(high.weeklyUsedPct),
        },
      };
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
