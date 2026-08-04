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

/** The only `kind` values `coach_observations.kind`'s CHECK accepts, and the
 *  only values a kind override may take. Single source for the DB CHECK
 *  text, the route validator, the TS union in client/src/lib/types.ts, and
 *  the client's kindLabel i18n keys. */
const KIND_VALUES = ["risk", "info", "good"];

/** The only `severity` values, pinned by this build (see intake
 *  2026-08-02-practice-kind-override, DEC-1). Ordered low -> high. Mirrors
 *  exactly the two values the catalog has ever written, so
 *  coach_observations' new CHECK can never reject pre-existing data. */
const SEVERITY_VALUES = ["info", "warning"];

/** Membership check shared by the resolver (which coerces an invalid stored
 *  value to null) and the route validator (which rejects an invalid incoming
 *  value with 400). Deliberately different dispositions, one shared
 *  vocabulary — see the resolver/route call sites below for why. */
function coerceEnum(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

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
 * The sole source of truth for "practice defaults + stored overrides" — both
 * the engine (deciding whether/how to evaluate a practice, and what
 * kind/severity to freeze onto a fired Observation) and the route (serving
 * `GET /api/playbook/practices` and validating the config `PUT`) read
 * through this function, so the two can never silently disagree about what's
 * actually configured. This is also the ONLY place in the codebase allowed
 * to read `practice.kind` / `practice.defaultSeverity` raw — see
 * `server/__tests__/playbook-resolver-guard.test.js`.
 *
 * Returns `{ enabled, config, kindOverride, severityOverride, catalogKind,
 * catalogSeverity, kind, severity }`. The `*Override` fields are the raw
 * *stored* values (`null` = unset, or an out-of-enum value coerced to
 * `null`); `catalogKind`/`catalogSeverity` are the practice's built-in
 * defaults; `kind`/`severity` are the *effective* values — the ones the
 * engine will stamp onto a new Observation right now.
 * @param {{enabled: number, config: string} | undefined} row
 * @param {typeof PRACTICES[number]} practice
 */
function resolvePracticeConfig(row, practice) {
  const config = defaultConfigFor(practice);
  const base = {
    config,
    catalogKind: practice.kind,
    catalogSeverity: practice.defaultSeverity,
  };
  if (!row) {
    return {
      ...base,
      enabled: true,
      kindOverride: null,
      severityOverride: null,
      kind: practice.kind,
      severity: practice.defaultSeverity,
    };
  }
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

  const kindOverride = coerceEnum(stored.kindOverride, KIND_VALUES);
  const severityOverride = coerceEnum(stored.severityOverride, SEVERITY_VALUES);
  return {
    ...base,
    enabled: !!row.enabled,
    kindOverride,
    severityOverride,
    kind: kindOverride ?? practice.kind,
    severity: severityOverride ?? practice.defaultSeverity,
  };
}

module.exports = {
  PRACTICES,
  PRACTICES_BY_ID,
  defaultConfigFor,
  resolvePracticeConfig,
  KIND_VALUES,
  SEVERITY_VALUES,
  coerceEnum,
};
