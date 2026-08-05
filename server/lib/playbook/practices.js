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
 * (global scope) each prove that out. A field's `type` is `"number"`
 * (validated against its own `min`, the original and still most common
 * shape) or `"boolean"` (validated as a plain true/false, no `min`) —
 * `session-token-ceiling`'s `autoResolveOnSessionEnd` is the first of the
 * latter. Both flow through the exact same `detect(ctx, config)` config
 * object and the exact same resolver merge below; a boolean field is not
 * special plumbing, just a second value shape the existing plumbing accepts.
 *
 * `detect(ctx, config)` is a pure function — no I/O, no db access — so it's
 * unit-testable in isolation from the engine's scheduling/persistence
 * concerns, same separation `evaluateRules` keeps in `../reconciliation.js`.
 * It returns `null` when the practice doesn't fire, or `{ values }` (the raw
 * numbers/labels a client-side i18n template interpolates — this app has no
 * server-side i18n, so no display strings live here) when it does.
 *
 * `autoResolveOnSessionEnd` isn't read by any `detect()` — it's consumed
 * directly by the engine's auto-resolve sweep (`./engine.js`'s
 * `autoResolveStaleObservations`), which decides whether a session-scoped
 * practice's open Observations are ELIGIBLE to auto-close once their
 * session ends, independent of whether the practice's own condition still
 * holds (a session that's dead can't be compacted/cleared regardless). It
 * does not control WHEN — that's `playbook_settings.auto_resolve_after_ms`,
 * deliberately NOT a per-practice field: a single global window (how long
 * to wait after a session ends before actually resolving its Observations;
 * `0` disables the sweep entirely, not "resolve instantly") that applies to
 * every opted-in practice uniformly, so shipping a new practice never
 * requires touching it (see server/routes/playbook.js's GET/PUT /settings).
 * A still-active session's Observation is never auto-resolved by time
 * alone — the window only ever counts from session end, never from
 * detection.
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
    fields: [
      { key: "thresholdTokens", type: "number", default: 100_000_000, min: 1_000_000 },
      { key: "autoResolveOnSessionEnd", type: "boolean", default: true },
    ],
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
    // No editable fields of its own — this practice deliberately shares its
    // one trigger threshold, `rotationSwitchPct` on `ctx`, with the Usage
    // page's Rotation Plan card (`color_thresholds.rotation_switch_pct`)
    // instead of carrying an independent field (the old `gapThresholdPct`),
    // so the Coach's nudge and the Rotation Plan's own recommendation can
    // never disagree about when it's time to switch. See
    // `server/lib/playbook/engine.js`'s `evaluateGlobal`/ctx-building for
    // where `rotationSwitchPct` and each account's `isActive` come from.
    fields: [],
    /**
     * ctx: { accounts: Array<{ id, label, weeklyUsedPct: number|null,
     * isActive: boolean }>, rotationSwitchPct: number } — every enabled
     * account's latest known weekly-quota-used percentage plus whether it's
     * the one actually being used right now (inferred the same way
     * `server/lib/account-activity.js` does for the Usage page), and the
     * shared switch threshold. Fires only when the ACTIVE account itself
     * has crossed `rotationSwitchPct` AND at least one other enabled
     * account still has headroom under that same threshold to rotate onto
     * — deliberately NOT a raw gap between the highest- and lowest-used
     * accounts (that was the old, since-replaced logic): a wide gap between
     * two barely-used accounts is not actionable, and an active account
     * over threshold with no eligible fallback has nothing useful to
     * recommend either. The recommended target is whichever eligible
     * account has the most headroom (lowest weeklyUsedPct) — the same
     * "most runway if it became active" preference
     * `computeRotationPlan`/`pickNext()` in client/src/pages/Usage.tsx uses,
     * simplified to a single best pick since this is a one-shot nudge, not
     * a multi-day schedule.
     */
    detect(ctx, config) {
      const switchPct = ctx.rotationSwitchPct;
      if (typeof switchPct !== "number") return null;

      const accounts = (ctx.accounts || []).filter((a) => typeof a.weeklyUsedPct === "number");
      const active = accounts.find((a) => a.isActive);
      if (!active || active.weeklyUsedPct < switchPct) return null;

      const candidates = accounts.filter((a) => a.id !== active.id && a.weeklyUsedPct < switchPct);
      if (candidates.length === 0) return null;
      const low = candidates.reduce((a, b) => (b.weeklyUsedPct < a.weeklyUsedPct ? b : a));

      return {
        values: {
          activeAccountId: active.id,
          activeLabel: active.label,
          activePct: Math.round(active.weeklyUsedPct),
          lowAccountId: low.id,
          lowLabel: low.label,
          lowPct: Math.round(low.weeklyUsedPct),
          rotationSwitchPct: switchPct,
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
    if (field.type === "boolean") {
      if (typeof value === "boolean") config[field.key] = value;
    } else if (typeof value === "number" && Number.isFinite(value) && value >= field.min) {
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
