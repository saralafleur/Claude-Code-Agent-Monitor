/**
 * @file Usage.tsx
 * @description Shows Claude rate-limit/usage standing for the currently
 * logged-in CLI session (the legacy/global view, driving
 * server/lib/usage-capture.js over tmux) plus, in the collapsible Accounts
 * panel below the status cards, any number of separately named Claude
 * accounts side by side - each
 * account's session/weekly rate-limit bars are always visible in its row
 * (reading its own CLAUDE_CONFIG_DIR's CLI-stored OAuth credential and
 * fetching usage directly via server/lib/claude-cli-credentials.js +
 * server/lib/usage-fetch-oauth.js, no browser cookie or password ever
 * collected), so all accounts' standing is visible at a glance without
 * selecting one. Expanding a row lazily fetches that account's own capture
 * history (timestamps + percentages only - the OAuth path has no
 * cost/token/model detail, unlike the legacy tmux path below).
 *
 * Wire-up:
 *   - GET /api/usage - legacy capture history (newest first) + whether a
 *     legacy capture is currently in flight.
 *   - GET /api/usage/:id - one capture's full detail (incl. raw pane text).
 *   - POST /api/usage/capture - legacy path: launches `claude` in tmux,
 *     drives /status and /usage, persists the parsed row. Takes ~10-15s.
 *   - GET/POST/DELETE /api/accounts, POST /api/accounts/:id/capture -
 *     manage named accounts and trigger a per-account capture.
 *   - POST /api/accounts/:id/login-terminal - clicking a row's "Needs
 *     login" badge opens a Terminal.app window already running
 *     `CLAUDE_CONFIG_DIR=<dir> claude`, so the user can walk through that
 *     profile's login and close the window when done (macOS only).
 *   - GET /api/usage?accountId= - one account's own capture history, used
 *     by its row's expand-in-place section.
 *
 * Also renders `AccountActivityCard`, a quick per-account gauge of whether
 * you're actively using it (or how long since you last did), driven by each
 * account's own `is_active`/`last_used_at` fields from GET /api/accounts -
 * inferred server-side from real movement in that account's own session/
 * weekly rate-limit percentage between captures (server/lib/account-
 * activity.js), not from anything tied to its CLAUDE_CONFIG_DIR. And
 * `ConsumptionRateCard`, which predicts per account when its session and
 * weekly quotas will run out at their current pace and whether that happens
 * before or after the window resets, driven by each account's own
 * `*_burn_rate_pct_per_hour`/`*_predicted_exhaustion_at` fields from GET
 * /api/accounts (server/lib/consumption-rate.js's %/hour trend fit). And
 * `RotationPlanCard`, which chains that same per-account weekly burn-rate
 * data into an actionable rotation - which account to be on right now, and
 * the projected instant to hand off to the next one - out to a multi-day
 * horizon (`computeRotationPlan`), entirely client-side over already-fetched
 * account data.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Gauge,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  User,
  Building2,
  Cpu,
  CircleDollarSign,
  Users,
  Plus,
  Trash2,
  KeyRound,
  ArrowRightLeft,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  UsageCapture,
  UsageCaptureSummary,
  UsageCaptureStatus,
  Account,
  AccountStatus,
} from "../lib/api";
import type { ColorThresholds, ColorThresholdsConfig } from "../lib/types";
import {
  formatDateTimeFull,
  timeAgo,
  formatModelName,
  formatMs,
  formatMsLong,
} from "../lib/format";
import {
  useColorThresholds,
  colorThresholdsStore,
  DEFAULT_COLOR_THRESHOLDS_CONFIG,
} from "../lib/colorThresholds";

function formatCost(cost: number | null): string {
  if (cost == null || !Number.isFinite(cost)) return "—";
  if (cost <= 0) return "$0";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(3)}`;
}

/** `23.4%/hr` - the Consumption Rate card's session-scope burn rate. */
function formatRatePerHour(ratePerHour: number): string {
  return `${ratePerHour.toFixed(1)}%/hr`;
}

/** `3.8%/day` - the weekly scope's burn rate. `ratePerHour` (the fitted
 *  trend's actual unit) reads as a near-zero, unreadable number over a
 *  7-day window, so this is the same trend re-expressed per day instead. */
function formatRatePerDay(ratePerHour: number): string {
  return `${(ratePerHour * 24).toFixed(1)}%/day`;
}

function formatTokenCount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export type ColorBand = "green" | "yellow" | "orange" | "red";

const BAND_BG_CLASS: Record<ColorBand, string> = {
  green: "bg-emerald-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};
const BAND_TEXT_CLASS: Record<ColorBand, string> = {
  green: "text-emerald-400",
  yellow: "text-yellow-400",
  orange: "text-orange-400",
  red: "text-red-400",
};
/** Soft pill tint per band - same `bg-{color}-500/10 border-{color}-500/30
 *  text-{color}-400` idiom `StatusBadge`/`AccountStatusBadge` already use,
 *  paired with the `.badge` class (index.css) for the Consumption Rate
 *  card's verdict pills, so a graded ("safe" can render yellow/orange, see
 *  `ConsumptionRateScopeRow`) status still reads as one consistent pill
 *  family with the rest of the page instead of a one-off. */
const BAND_BADGE_CLASS: Record<ColorBand, string> = {
  green: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  yellow: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
  orange: "bg-orange-500/10 border-orange-500/30 text-orange-400",
  red: "bg-red-500/10 border-red-500/30 text-red-400",
};

/**
 * The single source of truth for "what color does this percentage render
 * as" across the whole Usage page - every bar, marker, and callout below
 * goes through this instead of hand-rolling its own band cutoffs, so the
 * user-configurable thresholds (see the "Color thresholds" card and
 * client/src/lib/colorThresholds.ts) apply everywhere at once. Green below
 * `yellowAt`; yellow/orange/red take over at their own threshold.
 */
function colorBand(pct: number, thresholds: ColorThresholds): ColorBand {
  if (pct >= thresholds.redAt) return "red";
  if (pct >= thresholds.orangeAt) return "orange";
  if (pct >= thresholds.yellowAt) return "yellow";
  return "green";
}

function pctBarColor(pct: number, thresholds: ColorThresholds): string {
  return BAND_BG_CLASS[colorBand(pct, thresholds)];
}

/** Same band as `pctBarColor`, `null`-safe (renders as neutral gray when
 *  there's no data yet, e.g. a not-yet-captured account). */
function weeklyPctColor(pct: number | null, thresholds: ColorThresholds): string {
  if (pct == null) return "bg-surface-3";
  return BAND_BG_CLASS[colorBand(pct, thresholds)];
}

/** Text-color counterpart of `weeklyPctColor`, same bands. */
function pctTextColor(pct: number | null, thresholds: ColorThresholds): string {
  if (pct == null) return "text-gray-400";
  return BAND_TEXT_CLASS[colorBand(pct, thresholds)];
}

/**
 * The Consumption Rate card's per-scope verdict, derived from an account's
 * burn-rate prediction (server/lib/consumption-rate.js) plus that window's
 * own reset time. `"no-data"` when there's no trend to fit yet, `"safe"`
 * when the trend is flat/falling or would only cross 100% after the window
 * has already reset (so the reset resolves it first), and `"at-risk"` with
 * a countdown `runwayMs` to the predicted exhaustion instant, plus
 * `shortfallMs` - how much EARLIER than the reset that exhaustion is
 * predicted to land (`resetMs - exhaustionMs`), i.e. if the window resets
 * in 6 days but the trend predicts running out in 4, `shortfallMs` is the
 * 2-day gap. Unlike `runwayMs`, this doesn't shrink as `now` ticks forward
 * - both ends of the gap (predicted exhaustion, reset) are fixed instants -
 * so it stays constant until the underlying trend itself changes. The
 * "at-risk" row's color comes from `computePaceRatio` (times-faster-than-
 * sustainable), not from this state - see `ConsumptionRateScopeRow`.
 */
type ConsumptionRiskState =
  | { kind: "no-data" }
  | { kind: "safe" }
  | { kind: "at-risk"; runwayMs: number; shortfallMs: number };

function computeConsumptionRisk(
  ratePerHour: number | null,
  predictedExhaustionAt: string | null,
  resetRaw: string | null,
  now: number
): ConsumptionRiskState {
  if (ratePerHour == null) return { kind: "no-data" };
  if (ratePerHour <= 0 || !predictedExhaustionAt || !resetRaw) return { kind: "safe" };
  const resetMs = new Date(resetRaw).getTime();
  const exhaustionMs = new Date(predictedExhaustionAt).getTime();
  if (Number.isNaN(resetMs) || Number.isNaN(exhaustionMs) || exhaustionMs >= resetMs) {
    return { kind: "safe" };
  }
  const runwayMs = Math.max(0, exhaustionMs - now);
  const shortfallMs = resetMs - exhaustionMs;
  return { kind: "at-risk", runwayMs, shortfallMs };
}

/**
 * How many times faster (or slower) the current burn rate is than the
 * SUSTAINABLE pace - the rate that would land exactly at 100% right when
 * this window resets, `(100 - currentPct) / hoursUntilReset`. A raw "%/hr"
 * number alone can't say whether that's fast or slow (23%/hr is nothing 10
 * minutes into a fresh 5h window, alarming with 10 minutes left) - this
 * ratio normalizes for exactly that, which is the "is this normal or way
 * too much" signal a flat rate can't give on its own. `null` when there
 * isn't enough to compute it (no rate yet, missing percentage/reset, or
 * the window is past its own reset instant); `0` for a flat/falling rate,
 * since that's strictly slower than any positive sustainable pace;
 * `null` (rather than `Infinity`) once already at 100%, since a ratio
 * against zero remaining percentage isn't a meaningful multiple.
 *
 * `* 100` is what `ConsumptionRateScopeRow` feeds into `colorBand` against
 * the `sessionRate`/`weeklyRate` thresholds - 1.6x sustainable pace reads as
 * 160%, so it starts crossing into the yellow/orange/red bands past 100
 * rather than only ever coloring within 0-100 like a plain percentage.
 */
function computePaceRatio(
  ratePerHour: number | null,
  currentPct: number | null,
  resetRaw: string | null,
  now: number
): number | null {
  if (ratePerHour == null || currentPct == null || !resetRaw) return null;
  if (ratePerHour <= 0) return 0;
  const resetMs = new Date(resetRaw).getTime();
  if (Number.isNaN(resetMs)) return null;
  const hoursUntilReset = (resetMs - now) / 3_600_000;
  if (hoursUntilReset <= 0) return null;
  const remainingPct = Math.max(0, 100 - currentPct);
  if (remainingPct <= 0) return null;
  const sustainableRate = remainingPct / hoursUntilReset;
  if (sustainableRate <= 0) return null;
  return ratePerHour / sustainableRate;
}

/**
 * The assumed pace for whichever account the rotation plan currently has
 * "in the chair" - the fastest positive weekly `%/hour` rate observed across
 * ANY account, i.e. whichever one is actually being driven right now. An
 * idle account's own observed rate is close to zero and says nothing about
 * what it would do under real use, so a single shared proxy stands in for
 * "if this became the active account" instead of trusting each account's own
 * (mostly idle) history. `null` when no account has any positive weekly rate
 * yet, i.e. there isn't enough data to project anything.
 */
function activeBurnRateProxy(accounts: Account[]): number | null {
  let max: number | null = null;
  for (const account of accounts) {
    const rate = account.week_burn_rate_pct_per_hour;
    if (rate != null && rate > 0 && (max == null || rate > max)) max = rate;
  }
  return max;
}

interface RotationPlanSegment {
  accountId: string;
  label: string;
  startAt: number;
  endAt: number;
  /** `"exhausted"` - this account is projected to hit 100% of its weekly
   *  window here, before its own reset, so the plan hands off to the next
   *  account. `"horizon"` - this account is sustainable (its trend would
   *  reset before crossing 100%, or there's no rate data at all) and the
   *  segment simply ends at the projection horizon. */
  reason: "exhausted" | "horizon";
}

/**
 * Projects which account to be on, and until when, over the coming
 * `horizonMs` - a greedy simulation, not a guarantee. At each step it picks
 * whichever not-yet-capped account has the most weekly runway if it became
 * the active one (using `activeBurnRateProxy` as the assumed active pace),
 * runs it until it would either cross 100% or the horizon ends, then
 * advances every account's simulated state - the active one climbs at the
 * proxy pace, every other account drifts at its own (idle) observed rate,
 * and any account whose weekly reset falls inside the elapsed window snaps
 * back to 0% with its next reset pushed out another 7 days - before picking
 * the next segment. Starts from whichever account `is_active` reports,
 * falling back to the best-runway pick when that account is already capped
 * or unset. Returns `[]` when no account is usable (enabled + `status:
 * "ok"` + has weekly data) or none has a positive weekly rate yet to build a
 * proxy pace from.
 */
function computeRotationPlan(
  accounts: Account[],
  now: number,
  horizonMs: number = 9 * 24 * 3_600_000
): RotationPlanSegment[] {
  const usable = accounts.filter(
    (account) =>
      account.enabled &&
      account.status === "ok" &&
      account.latest_week_window_pct != null &&
      account.latest_week_reset_raw != null
  );
  if (usable.length === 0) return [];

  const pace = activeBurnRateProxy(usable);
  if (pace == null) return [];

  const state = usable.map((account) => ({
    id: account.id,
    label: account.label,
    pct: account.latest_week_window_pct as number,
    resetAt: new Date(account.latest_week_reset_raw as string).getTime(),
    idleRatePerHour: account.week_burn_rate_pct_per_hour ?? 0,
  }));
  if (state.some((s) => Number.isNaN(s.resetAt))) return [];

  const pickNext = () => {
    let best: (typeof state)[number] | null = null;
    let bestRunway = -Infinity;
    for (const s of state) {
      if (s.pct >= 100) continue;
      const runway = (100 - s.pct) / pace;
      if (runway > bestRunway) {
        bestRunway = runway;
        best = s;
      }
    }
    return best;
  };

  const activeAccount = accounts.find((account) => account.is_active);
  const activeFromFlag = activeAccount && state.find((s) => s.id === activeAccount.id);
  let active = activeFromFlag && activeFromFlag.pct < 100 ? activeFromFlag : pickNext();

  const segments: RotationPlanSegment[] = [];
  const horizonEnd = now + horizonMs;
  const maxSegments = state.length * 4;
  let t = now;

  while (active && t < horizonEnd && segments.length < maxSegments) {
    const remaining = 100 - active.pct;
    const exhaustAt = t + (remaining / pace) * 3_600_000;
    const willExhaustFirst = exhaustAt <= active.resetAt && exhaustAt < horizonEnd;
    const endAt = willExhaustFirst ? exhaustAt : horizonEnd;

    segments.push({
      accountId: active.id,
      label: active.label,
      startAt: t,
      endAt,
      reason: willExhaustFirst ? "exhausted" : "horizon",
    });

    const elapsedMs = endAt - t;
    for (const s of state) {
      s.pct =
        s.id === active.id
          ? willExhaustFirst
            ? 100
            : s.pct + (pace * elapsedMs) / 3_600_000
          : Math.min(100, Math.max(0, s.pct + (s.idleRatePerHour * elapsedMs) / 3_600_000));
      while (s.resetAt <= endAt) {
        s.pct = 0;
        s.resetAt += 7 * 24 * 3_600_000;
      }
    }

    t = endAt;
    if (!willExhaustFirst) break;
    active = pickNext();
  }

  return segments;
}

/**
 * Color for the session marker in the session timeline: normally just
 * `pctBarColor(pct, sessionThresholds)`, but forced red once the SAME
 * account's weekly window is fully exhausted (at or past the WEEKLY scope's
 * own `redAt`) - a fresh session window doesn't actually let any work
 * through if the weekly cap is the one blocking it, so the session
 * indicator shouldn't read as "fine" in that case.
 */
function sessionMarkerColor(
  pct: number,
  weeklyPct: number | null,
  sessionThresholds: ColorThresholds,
  weeklyThresholds: ColorThresholds
): string {
  if (weeklyPct != null && weeklyPct >= weeklyThresholds.redAt) return BAND_BG_CLASS.red;
  return pctBarColor(pct, sessionThresholds);
}

/**
 * Color for the right half of the session marker line: same as the left
 * half in the common case, but once the weekly window is at least in its
 * own "yellow" band it takes over the right half - so a fresh-looking
 * session marker still visibly tints toward the weekly window's own
 * urgency color (yellow, then orange, then red as the weekly window
 * climbs further) instead of reading as uniformly fine when the weekly
 * window is the thing about to run out.
 */
function sessionMarkerRightColor(
  pct: number,
  weeklyPct: number | null,
  sessionThresholds: ColorThresholds,
  weeklyThresholds: ColorThresholds
): string {
  if (weeklyPct != null && weeklyPct >= weeklyThresholds.yellowAt) {
    return weeklyPctColor(weeklyPct, weeklyThresholds);
  }
  return sessionMarkerColor(pct, weeklyPct, sessionThresholds, weeklyThresholds);
}

function StatusBadge({ status }: { status: UsageCaptureStatus }) {
  const { t } = useTranslation("usage");
  if (status === "ok") {
    return (
      <span className="badge bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
        <CheckCircle2 className="w-3 h-3" /> {t("status.ok")}
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="badge bg-amber-500/10 border-amber-500/30 text-amber-400">
        <AlertTriangle className="w-3 h-3" /> {t("status.partial")}
      </span>
    );
  }
  return (
    <span className="badge bg-red-500/10 border-red-500/30 text-red-400">
      <XCircle className="w-3 h-3" /> {t("status.error")}
    </span>
  );
}

function AccountStatusBadge({ status, onLogin }: { status: AccountStatus; onLogin?: () => void }) {
  const { t } = useTranslation("usage");
  if (status === "ok") {
    return (
      <span className="badge bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
        <CheckCircle2 className="w-3 h-3" /> {t("accounts.status.ok")}
      </span>
    );
  }
  if (status === "needs_login") {
    // Rendered as a clickable span (not a nested <button>: this badge lives
    // inside the row's expand button, and buttons can't nest) - clicking it
    // opens a terminal already running `CLAUDE_CONFIG_DIR=<dir> claude` so
    // the user can walk through the login instead of copy/pasting the
    // command; stopPropagation keeps the click from also toggling the row.
    return (
      <span
        role={onLogin ? "button" : undefined}
        title={onLogin ? t("accounts.status.needsLoginHint") : undefined}
        onClick={
          onLogin
            ? (e) => {
                e.stopPropagation();
                onLogin();
              }
            : undefined
        }
        className={`badge bg-amber-500/10 border-amber-500/30 text-amber-400 ${
          onLogin ? "cursor-pointer hover:bg-amber-500/25" : ""
        }`}
      >
        <KeyRound className="w-3 h-3" /> {t("accounts.status.needsLogin")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="badge bg-red-500/10 border-red-500/30 text-red-400">
        <XCircle className="w-3 h-3" /> {t("accounts.status.error")}
      </span>
    );
  }
  return (
    <span className="badge bg-surface-2 border-border text-gray-400">
      {t("accounts.status.idle")}
    </span>
  );
}

/** One past capture in an account's expanded history - percentages only,
 *  since the OAuth capture path has no cost/token/model detail to show. */
function AccountHistoryItemRow({ item }: { item: UsageCaptureSummary }) {
  return (
    <div className="flex items-center gap-3 py-1 text-xs">
      <span className="text-gray-400 font-mono w-28 flex-shrink-0">
        {timeAgo(item.captured_at)}
      </span>
      <StatusBadge status={item.status} />
      <span className="ml-auto text-gray-400 font-mono">
        {item.session_window_pct != null ? `${item.session_window_pct}%` : "—"} /{" "}
        {item.week_window_pct != null ? `${item.week_window_pct}%` : "—"}
      </span>
    </div>
  );
}

function AccountRow({
  account,
  captureBusy,
  confirmingRemove,
  refreshTick,
  onCapture,
  onRemoveClick,
  onLogin,
}: {
  account: Account;
  captureBusy: boolean;
  confirmingRemove: boolean;
  refreshTick: number;
  onCapture: (id: string) => void;
  onRemoveClick: (id: string) => void;
  onLogin: (id: string) => void;
}) {
  const { t } = useTranslation("usage");
  const [expanded, setExpanded] = useState(false);
  const [historyItems, setHistoryItems] = useState<UsageCaptureSummary[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    api.usage
      .list(50, account.id)
      .then((res) => {
        if (!cancelled) setHistoryItems(res.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setHistoryError(err instanceof Error ? err.message : t("accounts.loadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // refreshTick bumps after every capture so an expanded row re-fetches.
  }, [expanded, refreshTick, account.id, t]);

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-100 font-medium truncate">{account.label}</span>
              <AccountStatusBadge status={account.status} onLogin={() => onLogin(account.id)} />
            </div>
            <p className="text-[11px] text-gray-500 truncate mt-0.5">
              <span className="font-mono">{account.config_dir}</span>
              {account.last_capture_at && (
                <span> · {t("accounts.captured", { when: timeAgo(account.last_capture_at) })}</span>
              )}
            </p>
            {account.last_error && (
              <p className="text-[11px] text-amber-400 mt-0.5 truncate">{account.last_error}</p>
            )}
          </div>
        </button>
        <button
          type="button"
          onClick={() => onCapture(account.id)}
          disabled={captureBusy}
          title={t("captureNow")}
          className="btn-ghost disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${captureBusy ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => onRemoveClick(account.id)}
          title={t("accounts.remove")}
          className={`btn-ghost ${confirmingRemove ? "text-red-400" : ""}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          {confirmingRemove && <span className="text-[11px]">{t("accounts.removeConfirm")}</span>}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pl-9 border-t border-border pt-2">
          {historyLoading ? (
            <p className="text-xs text-gray-500">{t("common:loading")}</p>
          ) : historyError ? (
            <p className="text-xs text-red-400">{historyError}</p>
          ) : !historyItems || historyItems.length === 0 ? (
            <p className="text-xs text-gray-500">{t("accounts.emptyHistory")}</p>
          ) : (
            <div className="space-y-1">
              {historyItems.map((item) => (
                <AccountHistoryItemRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AccountsPanel({
  accounts,
  loading,
  error,
  onChanged,
}: {
  accounts: Account[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation("usage");
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newConfigDir, setNewConfigDir] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // A set (not a single id) since "refresh all" puts every account's row
  // into a busy state at once, alongside the existing single-row capture.
  const [captureBusyIds, setCaptureBusyIds] = useState<Set<string>>(new Set());
  const [refreshAllBusy, setRefreshAllBusy] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  // Only failures need surfacing here - a successful login-terminal launch
  // is self-evident (a Terminal window just opened over the dashboard).
  const [loginError, setLoginError] = useState<string | null>(null);
  // Bumped after every capture so an expanded account row's own history
  // re-fetches, independent of the parent's `onChanged` (accounts list refresh).
  const [refreshTick, setRefreshTick] = useState(0);
  // Collapsed by default - the list itself is secondary to the reset/activity
  // cards below it, and most sessions only need to glance at account status.
  const [collapsed, setCollapsed] = useState(true);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim() || !newConfigDir.trim()) return;
    setAddBusy(true);
    setAddError(null);
    try {
      await api.accounts.add(newLabel.trim(), newConfigDir.trim());
      setNewLabel("");
      setNewConfigDir("");
      setAdding(false);
      onChanged();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t("accounts.addFailed"));
    } finally {
      setAddBusy(false);
    }
  };

  const handleCapture = async (id: string) => {
    setCaptureBusyIds((prev) => new Set(prev).add(id));
    try {
      await api.accounts.capture(id);
    } catch {
      /* the row's status/last_error, refreshed via onChanged below, already
         surfaces the failure - nothing further to show here */
    } finally {
      setCaptureBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setRefreshTick((n) => n + 1);
      onChanged();
    }
  };

  const handleRefreshAll = async () => {
    setRefreshAllBusy(true);
    setCaptureBusyIds(new Set(accounts.map((a) => a.id)));
    try {
      // allSettled, not all - one account failing (e.g. needs_login) must
      // not stop the others from refreshing.
      await Promise.allSettled(accounts.map((a) => api.accounts.capture(a.id)));
    } finally {
      setCaptureBusyIds(new Set());
      setRefreshAllBusy(false);
      setRefreshTick((n) => n + 1);
      onChanged();
    }
  };

  const handleLogin = async (id: string) => {
    setLoginError(null);
    try {
      await api.accounts.loginTerminal(id);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : t("accounts.loadFailed"));
    }
  };

  const handleRemoveClick = (id: string) => {
    if (confirmRemoveId === id) {
      setConfirmRemoveId(null);
      api.accounts.remove(id).then(() => onChanged());
      return;
    }
    setConfirmRemoveId(id);
    setTimeout(() => setConfirmRemoveId((cur) => (cur === id ? null : cur)), 3000);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title={collapsed ? t("accounts.expand") : t("accounts.collapse")}
          className="flex items-center gap-2 min-w-0 text-left"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
          )}
          <Users className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-200">{t("accounts.title")}</h2>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={refreshAllBusy || accounts.length === 0}
            title={t("accounts.refreshAll")}
            className="btn-ghost text-xs disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshAllBusy ? "animate-spin" : ""}`} />
            {refreshAllBusy ? t("accounts.refreshingAll") : t("accounts.refreshAll")}
          </button>
          <button type="button" onClick={() => setAdding((a) => !a)} className="btn-ghost text-xs">
            <Plus className="w-3.5 h-3.5" /> {t("accounts.addAccount")}
          </button>
        </div>
      </div>

      {!collapsed && adding && (
        <form onSubmit={handleAdd} className="px-4 py-3 border-b border-border space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("accounts.addLabelPlaceholder")}
              className="input"
            />
            <input
              type="text"
              value={newConfigDir}
              onChange={(e) => setNewConfigDir(e.target.value)}
              placeholder={t("accounts.configDirPlaceholder")}
              className="input font-mono"
            />
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={addBusy}
              className="btn-primary text-xs disabled:opacity-60"
            >
              {addBusy ? t("accounts.adding") : t("accounts.addSubmit")}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="btn-ghost text-xs">
              {t("accounts.addCancel")}
            </button>
          </div>
        </form>
      )}

      {!collapsed && error && <p className="px-4 py-3 text-xs text-red-400">{error}</p>}
      {!collapsed && loginError && <p className="px-4 py-3 text-xs text-red-400">{loginError}</p>}

      {!collapsed &&
        (!loading && !error && accounts.length === 0 ? (
          <p className="px-4 py-6 text-xs text-gray-500 text-center">{t("accounts.empty")}</p>
        ) : (
          accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              captureBusy={captureBusyIds.has(account.id)}
              confirmingRemove={confirmRemoveId === account.id}
              refreshTick={refreshTick}
              onCapture={handleCapture}
              onRemoveClick={handleRemoveClick}
              onLogin={handleLogin}
            />
          ))
        ))}
    </div>
  );
}

// Weekly windows reset at most ~7 days out, so a fixed 14-day grid is almost
// always mostly dead space. Size the grid to the data instead: at least a
// week (so it never looks cramped even when every account resets tomorrow),
// and RESET_CALENDAR_BUFFER_DAYS past whichever account resets furthest out
// (so the last bar doesn't end flush against the grid's right edge) - capped
// defensively in case a bad/stale reset timestamp would otherwise blow the
// grid out. Day columns are uncapped 1fr (no per-column minimum) so
// dayCount columns always divide up whatever width the card actually has -
// this card only gets 1fr of the row's 2fr/1fr split (see the grid split in
// Usage()), and a per-column pixel floor previously made wide dayCounts
// (7-10+ days) overflow that narrower share, silently falling back to
// horizontal scroll with no visible scrollbar cue - the buffer days would
// exist in the DOM but never actually be seen without scrolling.
const RESET_CALENDAR_MIN_DAYS = 7;
const RESET_CALENDAR_MAX_DAYS = 14;
const RESET_CALENDAR_BUFFER_DAYS = 2;
const RESET_CALENDAR_LABEL_PX = 140;

/** Midnight-to-midnight day difference, ignoring time-of-day, so "resets
 *  tomorrow at 3am" still reads as 1 day away rather than 0.something. */
function daysUntil(from: Date, to: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

/**
 * One row per account, showing only the weekly (7-day) rate-limit window -
 * the session (5-hour) window is too short to render meaningfully on a
 * day-granularity grid. Each account's bar spans from today through its
 * next reset date, colored by the same green/amber/red thresholds as
 * `PctBar` (`pctBarColor`), so at a glance you can see how many days until
 * each account resets and whether it's currently in good shape. This is
 * purely forward-looking from the latest known capture - it does not
 * reconstruct past usage history. The visible day count is derived from the
 * accounts' own reset dates (see RESET_CALENDAR_MIN/MAX/BUFFER above), not a
 * fixed span.
 */
function AccountsResetCalendar({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation("usage");
  const { weekly: thresholds } = useColorThresholds();
  if (accounts.length === 0) return null;

  const today = new Date();

  const rows = accounts.map((account) => {
    const pct = account.latest_week_window_pct;
    const resetDate = account.latest_week_reset_raw
      ? new Date(account.latest_week_reset_raw)
      : null;
    const validReset = resetDate && !Number.isNaN(resetDate.getTime());
    const spanDays = pct != null && validReset ? Math.max(1, daysUntil(today, resetDate!)) : null;
    // Includes the exact reset time (not just the date) - a day cell alone
    // can't show that, and it's the difference between "resets in 10
    // minutes" and "resets in 23 hours" on the same day.
    const resetWhen =
      pct != null && validReset
        ? resetDate!.toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : null;
    // The large centered countdown ("2d 5h 30m") - day/hour/minute, since
    // weekly resets are usually days out and a hint of hours/minutes still
    // matters once it's close.
    const countdown =
      pct != null && validReset ? formatMsLong(resetDate!.getTime() - today.getTime()) : null;
    return { account, pct, spanDays, resetWhen, countdown };
  });

  // Sum of each account's own remaining share (100% - its used pct), across
  // every account with data - e.g. two accounts at 80% used and one at 50%
  // used remaining is 20 + 20 + 50 = 90%. Not itself capped at 100%: with
  // more than one account it's a combined figure, not a single window's %.
  const totalRemainingPct = rows.some((r) => r.pct != null)
    ? rows.reduce((sum, r) => sum + (r.pct != null ? 100 - r.pct : 0), 0)
    : null;

  const furthestResetDays = Math.max(0, ...rows.map((r) => r.spanDays ?? 0));
  // +1: furthestResetDays is a day *index* (0 = today), so the column that
  // actually shows that reset date is index furthestResetDays - reaching
  // RESET_CALENDAR_BUFFER_DAYS *past* it requires that many extra columns
  // beyond the reset column itself, hence the trailing +1.
  const dayCount = Math.min(
    RESET_CALENDAR_MAX_DAYS,
    Math.max(RESET_CALENDAR_MIN_DAYS, furthestResetDays + RESET_CALENDAR_BUFFER_DAYS + 1)
  );

  const days = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });
  const dayGridColumns = `repeat(${dayCount}, minmax(0, 1fr))`;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">{t("accounts.calendar.title")}</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">{t("accounts.calendar.subtitle")}</p>
        </div>
        {totalRemainingPct != null && (
          <span
            className="text-sm font-mono font-semibold text-gray-200 flex-shrink-0"
            title={t("accounts.calendar.totalRemainingHint")}
          >
            {t("accounts.calendar.totalRemaining", { pct: totalRemainingPct })}
          </span>
        )}
      </div>
      <div>
        <div className="flex">
          <div style={{ width: RESET_CALENDAR_LABEL_PX }} className="flex-shrink-0" />
          <div className="flex-1 min-w-0 grid" style={{ gridTemplateColumns: dayGridColumns }}>
            {days.map((d, i) => (
              <div
                key={i}
                className={`text-center text-[10px] font-mono ${
                  i === 0 ? "text-accent font-semibold" : "text-gray-500"
                }`}
              >
                <div>{d.toLocaleDateString(undefined, { weekday: "narrow" })}</div>
                <div>{d.getDate()}</div>
              </div>
            ))}
          </div>
        </div>
        {rows.map(({ account, pct, spanDays, resetWhen, countdown }) => {
          // +1: spanDays counts whole days from today *to* the reset date
          // (e.g. 7 for "resets a week from today"), but column 0 is today,
          // so filling spanDays columns lands one column short of the reset
          // date's own column - the bar would stop the day *before* reset
          // instead of reaching it. +1 fills through the reset day itself.
          const visibleDays = spanDays != null ? Math.min(spanDays + 1, dayCount) : 0;

          return (
            <div key={account.id} className="border-t border-border first:border-t-0 py-1.5">
              <div className="flex items-center h-9">
                <div
                  style={{ width: RESET_CALENDAR_LABEL_PX }}
                  className="flex-shrink-0 pr-2 flex items-center justify-between gap-1"
                >
                  <span className="text-xs text-gray-300 truncate">{account.label}</span>
                  {pct != null && (
                    <span
                      className={`text-[11px] font-mono flex-shrink-0 ${pctTextColor(pct, thresholds)}`}
                    >
                      {pct}%
                    </span>
                  )}
                </div>
                <div
                  className="relative flex-1 min-w-0 h-9 grid"
                  style={{ gridTemplateColumns: dayGridColumns }}
                >
                  {days.map((_, i) => (
                    <div key={i} className="border-l border-border/40 h-full" />
                  ))}
                  {pct != null && spanDays != null && (
                    <div
                      className={`absolute top-0.5 left-0 h-8 rounded ${weeklyPctColor(pct, thresholds)}`}
                      style={{ width: `calc(${(visibleDays / dayCount) * 100}% - 2px)` }}
                      title={resetWhen ? t("resets", { when: resetWhen }) : undefined}
                    />
                  )}
                  {countdown && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-1">
                      <span className="text-base font-bold text-gray-100 bg-surface-1/80 rounded px-2 py-0.5 leading-none whitespace-nowrap">
                        {countdown}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {resetWhen && (
                <p
                  style={{ paddingLeft: RESET_CALENDAR_LABEL_PX }}
                  className="text-[11px] text-gray-500 mt-0.5"
                >
                  {t("resets", { when: resetWhen })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One row per account, showing whether it's actively being used right now
 * (its own session/weekly rate-limit percentage rose within the last 15 min
 * - see `is_active`/`last_used_at`, server/lib/account-activity.js) or, if
 * not, how long ago it was last used. A quick "which of my accounts am I
 * actually working in" gauge, independent of both this dashboard's own
 * capture history (which only reflects manual Refresh clicks, not real
 * usage) and this account's own CLAUDE_CONFIG_DIR (real work is often done
 * through whichever profile is logged into the default `~/.claude` instead).
 */
function AccountActivityCard({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation("usage");
  if (accounts.length === 0) return null;

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-gray-200">{t("accounts.activity.title")}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{t("accounts.activity.subtitle")}</p>
      <div className="space-y-2">
        {accounts.map((account) => (
          <div key={account.id} className="flex items-center gap-2 text-xs">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                account.is_active ? "bg-emerald-500" : "bg-gray-600"
              }`}
            />
            <span className="text-gray-200 truncate flex-1 min-w-0">{account.label}</span>
            {account.is_active ? (
              <span className="badge bg-emerald-500/10 border-emerald-500/30 text-emerald-400 flex-shrink-0">
                {t("accounts.activity.active")}
              </span>
            ) : account.last_used_at ? (
              <span className="text-gray-500 flex items-center gap-1.5 flex-shrink-0">
                {t("accounts.activity.lastUsedLabel")}
                <span className="font-mono font-bold text-gray-100 bg-surface-1/80 rounded px-2 py-0.5 leading-none">
                  {timeAgo(account.last_used_at)}
                </span>
              </span>
            ) : (
              <span className="text-gray-500 flex-shrink-0">{t("accounts.activity.never")}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One scope's (session or weekly) verdict row within {@link
 * ConsumptionRateCard} - "not enough data yet" (plain muted text), "on
 * track" or a countdown to the predicted exhaustion instant, both rendered
 * as a `.badge` pill (same soft-tint idiom `StatusBadge`/`AccountStatusBadge`
 * already use elsewhere on this page) so the verdict reads as one scannable
 * unit instead of loose colored text. Both pill variants are graded through
 * `colorBand` against the SAME raw pace-ratio number (`computePaceRatio` -
 * how many times faster the current burn is than the sustainable pace, e.g.
 * `1.6` for "1.6x") shown in the stats line underneath, rather than a
 * separate percentage, so the color always matches the number the user is
 * actually reading - an on-track account creeping up past 1x sustainable
 * pace can show a yellow/orange pill before it ever flips into "at risk."
 * When at risk, a "Short by" tag beside the pill spells out the actual gap
 * - `risk.shortfallMs`, the difference between the reset instant and the
 * predicted exhaustion instant - since "runs out in 4 days" alone doesn't
 * say whether that's uncomfortably close to a 4.5-day reset or nowhere near
 * a 10-day one. The stats line names its own basis - `observedSpanMs`
 * (server/lib/consumption-rate.js) - as its own `whitespace-nowrap` segment
 * (not string-concatenated into the rate text) so it wraps as a whole unit
 * on narrow viewports instead of splitting mid-duration.
 *
 * Renders as a Fragment (two top-level children: the scope label, then the
 * rest) rather than a wrapping `<div>` so the caller can lay both scope
 * rows out as direct children of one shared CSS grid - the label column
 * then auto-sizes to whichever of "Session"/"Weekly" (or their localized
 * equivalents) is wider, keeping both rows aligned without a hardcoded,
 * locale-unsafe pixel width.
 */
function ConsumptionRateScopeRow({
  label,
  ratePerHour,
  currentPct,
  predictedExhaustionAt,
  resetRaw,
  observedSpanMs,
  thresholds,
  now,
  formatCountdown,
  formatRate,
}: {
  label: string;
  ratePerHour: number | null;
  currentPct: number | null;
  predictedExhaustionAt: string | null;
  resetRaw: string | null;
  observedSpanMs: number | null;
  thresholds: ColorThresholds;
  now: number;
  formatCountdown: (ms: number) => string;
  formatRate: (ratePerHour: number) => string;
}) {
  const { t } = useTranslation("usage");
  const risk = computeConsumptionRisk(ratePerHour, predictedExhaustionAt, resetRaw, now);
  const paceRatio =
    ratePerHour != null ? computePaceRatio(ratePerHour, currentPct, resetRaw, now) : null;
  // `paceRatio` is null when there isn't enough to compute a sustainable
  // pace to compare against (see `computePaceRatio`) - falls back to the
  // safest read for an "on track" row (nothing suggests risk) and the
  // worst read for an "at-risk" row (paceRatio is null there only when
  // already at/over 100% of the window).
  const band = (fallback: ColorBand): ColorBand =>
    paceRatio != null ? colorBand(paceRatio, thresholds) : fallback;

  return (
    <>
      <span className="whitespace-nowrap pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {risk.kind === "no-data" ? (
            <span className="text-xs text-gray-500">
              {t("accounts.consumptionRate.notEnoughData")}
            </span>
          ) : risk.kind === "safe" ? (
            <span className={`badge ${BAND_BADGE_CLASS[band("green")]}`}>
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              {t("accounts.consumptionRate.onTrack")}
            </span>
          ) : (
            <span className={`badge ${BAND_BADGE_CLASS[band("red")]}`}>
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              {t("accounts.consumptionRate.runsOutIn")}
              <span className="font-mono font-bold text-gray-50">
                {formatCountdown(risk.runwayMs)}
              </span>
            </span>
          )}
          {risk.kind === "at-risk" && (
            <span className="whitespace-nowrap text-[11px] text-gray-500">
              {t("accounts.consumptionRate.shortBy")}{" "}
              <span className="font-mono font-semibold text-gray-300">
                {formatCountdown(risk.shortfallMs)}
              </span>
            </span>
          )}
        </div>
        {ratePerHour != null && (
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mt-1 text-[11px] font-mono text-gray-500">
            <span className="whitespace-nowrap">
              {ratePerHour <= 0
                ? // Clamp to 0 for display: a flat/falling fit is often a
                  // tiny negative float (regression noise), which would
                  // otherwise render as a confusing "-0.0%/hr".
                  t("accounts.consumptionRate.rateFlat", { rate: formatRate(0) })
                : paceRatio != null
                  ? t("accounts.consumptionRate.ratePace", {
                      rate: formatRate(ratePerHour),
                      pace: paceRatio.toFixed(1),
                    })
                  : formatRate(ratePerHour)}
            </span>
            {observedSpanMs != null && (
              <span className="whitespace-nowrap text-gray-600">
                ·{" "}
                {t("accounts.consumptionRate.observedOver", {
                  span: formatCountdown(observedSpanMs),
                })}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Predicts, per account, when its session and weekly quotas will run out if
 * current usage keeps climbing at its recent pace (the %/hour trend
 * server/lib/consumption-rate.js fits over that account's own recent
 * captures), and whether that predicted exhaustion actually lands before
 * the window's own reset - a rising trend that resets first is "on track"
 * regardless of how steep it looks. Colored by the `sessionRate`/
 * `weeklyRate` threshold scopes (see `computeConsumptionRisk`), which are
 * independent of the raw %-used bands the rest of this page uses: a slow
 * climb toward 100% reads very differently depending on how much window
 * time is actually left, which a raw percentage alone can't capture.
 */
/**
 * Identity colors for the Rotation Plan calendar's timeline segments -
 * deliberately distinct from the red/orange/yellow/emerald risk-band colors
 * used everywhere else on this page, since a segment's fill answers "which
 * account", not "how risky" (that's the separate exhausted/sustainable dot
 * on each segment). Cycles if there are more accounts than colors.
 */
const ACCOUNT_TIMELINE_COLORS = ["#6366f1", "#2dd4bf", "#f59e0b", "#ec4899", "#38bdf8", "#a78bfa"];

/** `ACCOUNT_TIMELINE_COLORS[i % length]`, non-null since the modulo always
 *  lands in bounds - just satisfies `noUncheckedIndexedAccess`. */
function accountTimelineColor(index: number): string {
  return ACCOUNT_TIMELINE_COLORS[index % ACCOUNT_TIMELINE_COLORS.length] as string;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * One entry per midnight-to-midnight day from `startMs`'s own day through
 * `endMs`'s own day (inclusive) - a plan ending mid-afternoon still gets a
 * full trailing column instead of a sliver, the same whole-days rounding
 * `AccountsResetCalendar`'s `dayCount` uses.
 */
function rotationCalendarDays(startMs: number, endMs: number): Date[] {
  const days: Date[] = [];
  for (let ms = startOfDay(startMs); ms <= startOfDay(endMs); ms += 24 * 3_600_000) {
    days.push(new Date(ms));
  }
  return days;
}

/**
 * Turns the Consumption Rate card's same per-account weekly burn-rate data
 * into an actionable rotation: which account to be on right now, and the
 * projected instant to hand off to the next one, chained across every
 * enabled account (`computeRotationPlan`). Rendered two ways from the same
 * segments - a day-strip calendar (so a Tuesday-night hand-off and a
 * Friday-morning one read as different positions in the week, not just
 * matching timestamps) plus the ordered list below it for the exact
 * instants. The calendar also plots each account's own weekly reset as a
 * small tick even when that account isn't the active one - `computeRotationPlan`
 * deliberately doesn't switch just because a reset happened, only when the
 * current account is actually forced to, and the tick is what makes that
 * "reset passed, didn't switch" behavior visible.
 */
function RotationPlanCard({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation("usage");
  if (accounts.length === 0) return null;

  const now = Date.now();
  const plan = computeRotationPlan(accounts, now);

  const accountColor = new Map<string, string>(
    accounts.map((account, i) => [account.id, accountTimelineColor(i)])
  );

  const firstSegment = plan.length > 0 ? plan[0] : null;
  const lastSegment = plan.length > 0 ? plan[plan.length - 1] : null;
  const horizonStart = firstSegment ? startOfDay(firstSegment.startAt) : null;
  const horizonEnd = lastSegment ? startOfDay(lastSegment.endAt) + 24 * 3_600_000 : null;
  const days =
    firstSegment && lastSegment
      ? rotationCalendarDays(firstSegment.startAt, lastSegment.endAt)
      : [];
  const dayGridColumns = `repeat(${days.length}, minmax(0, 1fr))`;

  const pctOf = (ms: number) =>
    horizonStart != null && horizonEnd != null
      ? ((ms - horizonStart) / (horizonEnd - horizonStart)) * 100
      : 0;

  const resetTicks =
    horizonStart != null && horizonEnd != null
      ? accounts
          .map((account) => ({
            id: account.id,
            label: account.label,
            ms: account.latest_week_reset_raw
              ? new Date(account.latest_week_reset_raw).getTime()
              : NaN,
          }))
          .filter(
            (tick) => !Number.isNaN(tick.ms) && tick.ms > horizonStart && tick.ms < horizonEnd
          )
      : [];

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
        <ArrowRightLeft className="w-4 h-4 text-accent" />
        {t("accounts.rotationPlan.title")}
      </h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{t("accounts.rotationPlan.subtitle")}</p>
      {plan.length === 0 ? (
        <p className="text-xs text-gray-500">{t("accounts.rotationPlan.notEnoughData")}</p>
      ) : (
        <>
          <div className="rounded-lg border border-border/60 bg-surface-1 px-3 pt-3 pb-2 overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid" style={{ gridTemplateColumns: dayGridColumns }}>
                {days.map((d, i) => (
                  <div
                    key={i}
                    className={`text-[10px] font-mono border-l border-border/40 pl-1 ${
                      i === 0 ? "text-accent font-semibold" : "text-gray-500"
                    }`}
                  >
                    <div>{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div>{d.getDate()}</div>
                  </div>
                ))}
              </div>
              <div className="relative h-10 mt-1.5">
                <div
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: dayGridColumns }}
                >
                  {days.map((_, i) => (
                    <div key={i} className="border-l border-border/40 h-full" />
                  ))}
                </div>
                <div className="absolute inset-0 flex rounded-md overflow-hidden bg-surface-3">
                  {plan.map((segment) => (
                    <div
                      key={`${segment.accountId}-${segment.startAt}`}
                      className="relative h-full flex items-center px-2 text-[11px] font-semibold truncate border-r border-surface-0/40 last:border-r-0"
                      style={{
                        width: `${pctOf(segment.endAt) - pctOf(segment.startAt)}%`,
                        backgroundColor: accountColor.get(segment.accountId),
                        color: "#06060a",
                      }}
                      title={`${segment.label}: ${formatDateTimeFull(
                        new Date(segment.startAt).toISOString()
                      )} → ${formatDateTimeFull(new Date(segment.endAt).toISOString())}`}
                    >
                      <span className="truncate">{segment.label}</span>
                      <span
                        className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ring-2 ring-surface-0/50 ${
                          segment.reason === "exhausted" ? "bg-orange-400" : "bg-emerald-400"
                        }`}
                      />
                    </div>
                  ))}
                </div>
                <div
                  className="absolute -top-1 -bottom-4 border-l border-dashed border-gray-100 z-10"
                  style={{ left: `${pctOf(now)}%` }}
                >
                  <span className="absolute -top-0.5 left-1 text-[9px] font-bold uppercase tracking-wider text-gray-100 whitespace-nowrap">
                    {t("accounts.rotationPlan.now")}
                  </span>
                </div>
              </div>
              {resetTicks.length > 0 && (
                <div className="relative h-4 mt-3">
                  {resetTicks.map((tick) => (
                    <div
                      key={tick.id}
                      className="absolute top-0 flex flex-col items-center gap-0.5 -translate-x-1/2"
                      style={{ left: `${pctOf(tick.ms)}%` }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: accountColor.get(tick.id) }}
                      />
                      <span className="text-[9px] text-gray-500 truncate max-w-[90px]">
                        {t("accounts.rotationPlan.resets", { label: tick.label })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 mb-1 text-[11px] text-gray-500">
            {accounts.map((account) => (
              <span key={account.id} className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: accountColor.get(account.id) }}
                />
                {account.label}
              </span>
            ))}
            <span className="text-gray-700">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
              {t("accounts.rotationPlan.switchNext")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              {t("accounts.rotationPlan.sustainable")}
            </span>
          </div>
        </>
      )}
      {plan.length > 0 && (
        <ol className="space-y-2">
          {plan.map((segment, i) => (
            <li
              key={`${segment.accountId}-${segment.startAt}`}
              className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface-2/40 p-3 text-xs"
            >
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-[10px] text-gray-400">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-gray-300 font-medium truncate">{segment.label}</p>
                <p className="text-gray-500 mt-0.5">
                  {i === 0
                    ? t("accounts.rotationPlan.now")
                    : t("accounts.rotationPlan.from", {
                        when: formatDateTimeFull(new Date(segment.startAt).toISOString()),
                      })}
                  {" → "}
                  {segment.reason === "exhausted"
                    ? t("accounts.rotationPlan.untilExhausted", {
                        when: formatDateTimeFull(new Date(segment.endAt).toISOString()),
                      })
                    : t("accounts.rotationPlan.untilHorizon", {
                        when: formatDateTimeFull(new Date(segment.endAt).toISOString()),
                      })}
                </p>
              </div>
              {segment.reason === "exhausted" ? (
                <span className={`badge ${BAND_BADGE_CLASS.orange} flex-shrink-0`}>
                  <AlertTriangle className="w-3 h-3" />
                  {t("accounts.rotationPlan.switchNext")}
                </span>
              ) : (
                <span className={`badge ${BAND_BADGE_CLASS.green} flex-shrink-0`}>
                  <CheckCircle2 className="w-3 h-3" />
                  {t("accounts.rotationPlan.sustainable")}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ConsumptionRateCard({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation("usage");
  const { sessionRate: sessionRateThresholds, weeklyRate: weeklyRateThresholds } =
    useColorThresholds();
  if (accounts.length === 0) return null;

  const now = Date.now();

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-gray-200">{t("accounts.consumptionRate.title")}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{t("accounts.consumptionRate.subtitle")}</p>
      <div className="space-y-2">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="rounded-lg border border-border/60 bg-surface-2/40 p-3 text-xs"
          >
            <p className="text-gray-300 font-medium truncate mb-2">{account.label}</p>
            {/* Both scope rows are direct children of this grid (each row
                renders a Fragment - see ConsumptionRateScopeRow) so the
                label column auto-sizes to the wider of the two, keeping
                "Session"/"Weekly" aligned without a hardcoded width. */}
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-start">
              <ConsumptionRateScopeRow
                label={t("accounts.consumptionRate.session")}
                ratePerHour={account.session_burn_rate_pct_per_hour}
                currentPct={account.latest_session_window_pct}
                predictedExhaustionAt={account.session_predicted_exhaustion_at}
                resetRaw={account.latest_session_window_reset_raw}
                observedSpanMs={account.session_burn_rate_observed_span_ms}
                thresholds={sessionRateThresholds}
                now={now}
                formatCountdown={formatMs}
                formatRate={formatRatePerHour}
              />
              <ConsumptionRateScopeRow
                label={t("accounts.consumptionRate.weekly")}
                ratePerHour={account.week_burn_rate_pct_per_hour}
                currentPct={account.latest_week_window_pct}
                predictedExhaustionAt={account.week_predicted_exhaustion_at}
                resetRaw={account.latest_week_reset_raw}
                observedSpanMs={account.week_burn_rate_observed_span_ms}
                thresholds={weeklyRateThresholds}
                now={now}
                formatCountdown={formatMsLong}
                formatRate={formatRatePerDay}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The session window resets at most ~5h out, so unlike the weekly calendar
// a fixed rolling 24h-from-now axis always comfortably covers the next
// reset regardless of time of day - no dynamic sizing needed here.
const SESSION_TIMELINE_HOURS = 24;
const SESSION_TIMELINE_TICK_HOURS = 3;
const SESSION_TIMELINE_HEIGHT_PX = 320;
const SESSION_TIMELINE_HOUR_PX = SESSION_TIMELINE_HEIGHT_PX / SESSION_TIMELINE_HOURS;
const SESSION_TIMELINE_AXIS_PX = 44;
// A floor, not a fixed width: this card gets the wider share of the row
// (see the grid split in Usage()), so lanes normally grow past this to fill
// it - the minimum just guarantees a full account label never truncates
// even if the viewport is narrow enough to shrink the grid column.
const SESSION_TIMELINE_LANE_MIN_PX = 112;

/**
 * A vertical 24-hours-from-now axis with one lane per account, each showing
 * a horizontal marker at the time of day that account's session (5-hour)
 * window resets - colored by the same green/amber/red thresholds as
 * `pctBarColor`. Where the weekly calendar answers "how many days until
 * reset" (a question a raw date can't answer well), this answers "what
 * time of day does it reset" - a question a percentage or day-grid can't
 * answer at all, since 5 hours is a fraction of a single day cell.
 */
function SessionResetTimeline({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation("usage");
  const { session: sessionThresholds, weekly: weeklyThresholds } = useColorThresholds();
  if (accounts.length === 0) return null;

  const now = new Date();
  const rows = accounts.map((account) => {
    const pct = account.latest_session_window_pct;
    const resetDate = account.latest_session_window_reset_raw
      ? new Date(account.latest_session_window_reset_raw)
      : null;
    const validReset = resetDate && !Number.isNaN(resetDate.getTime());
    const hoursUntil = validReset
      ? Math.min(
          SESSION_TIMELINE_HOURS,
          Math.max(0, (resetDate!.getTime() - now.getTime()) / 3_600_000)
        )
      : null;
    const resetWhen =
      pct != null && validReset
        ? resetDate!.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : null;
    // The large centered countdown ("3h 24m") - hour/minute only, since the
    // session window resets within at most ~5h.
    const countdown =
      pct != null && validReset ? formatMs(resetDate!.getTime() - now.getTime()) : null;

    // The weekly countdown bar: fills from "now" (top) down to the weekly
    // reset instant, then stops - it does NOT span the full visible window
    // when that reset falls inside it. Weekly resets are usually days out
    // (well past this 24h axis), so most of the time this just renders as a
    // full-height bar; clamped to the axis length either way.
    const weeklyResetDate = account.latest_week_reset_raw
      ? new Date(account.latest_week_reset_raw)
      : null;
    const validWeeklyReset = weeklyResetDate && !Number.isNaN(weeklyResetDate.getTime());
    const hasWeeklyData = account.latest_week_window_pct != null && validWeeklyReset;
    const weeklyHoursUntil = hasWeeklyData
      ? Math.min(
          SESSION_TIMELINE_HOURS,
          Math.max(0, (weeklyResetDate!.getTime() - now.getTime()) / 3_600_000)
        )
      : SESSION_TIMELINE_HOURS;
    // Only a real weekly reset falling inside the visible window gets a
    // caption - the common case (reset days away) just renders a plain
    // full-height bar with no "resets at X" claim, since that's not true.
    const weeklyResetWhen =
      hasWeeklyData && weeklyHoursUntil < SESSION_TIMELINE_HOURS
        ? weeklyResetDate!.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : null;
    // Full day/hour/minute countdown to the weekly reset, for the
    // "capped by weekly" callout - the session-lane axis only covers the
    // next 24h, but the weekly reset itself is usually days out, so this
    // needs its own duration rather than anything the axis already shows.
    const weeklyCountdown = hasWeeklyData
      ? formatMsLong(weeklyResetDate!.getTime() - now.getTime())
      : null;

    // True when the weekly window, not this session window, is the real
    // ceiling on how much can still be used - the session looks fresh
    // (well under half used) while the weekly window is nearly tapped out,
    // so a viewer glancing only at the session bar would be misled into
    // thinking there's plenty of room left this session.
    const weeklyPct = account.latest_week_window_pct;
    const cappedByWeekly =
      weeklyPct != null &&
      weeklyPct >= weeklyThresholds.orangeAt &&
      pct != null &&
      pct < sessionThresholds.yellowAt;

    return {
      account,
      pct,
      hoursUntil,
      resetWhen,
      countdown,
      weeklyPct,
      weeklyHoursUntil,
      weeklyResetWhen,
      weeklyCountdown,
      cappedByWeekly,
    };
  });

  const tickCount = Math.floor(SESSION_TIMELINE_HOURS / SESSION_TIMELINE_TICK_HOURS) + 1;
  const ticks = Array.from({ length: tickCount }, (_, i) => i * SESSION_TIMELINE_TICK_HOURS);

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-gray-200">{t("accounts.sessionTimeline.title")}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{t("accounts.sessionTimeline.subtitle")}</p>
      <div className="flex">
        <div
          style={{ width: SESSION_TIMELINE_AXIS_PX, height: SESSION_TIMELINE_HEIGHT_PX }}
          className="relative flex-shrink-0"
        >
          {ticks.map((h) => (
            <div
              key={h}
              className="absolute right-2 -translate-y-1/2 text-[10px] font-mono text-gray-500 whitespace-nowrap"
              style={{ top: h * SESSION_TIMELINE_HOUR_PX }}
            >
              {new Date(now.getTime() + h * 3_600_000).toLocaleTimeString(undefined, {
                hour: "numeric",
              })}
            </div>
          ))}
        </div>
        <div className="flex-1 flex gap-3 min-w-0">
          {rows.map(
            ({
              account,
              pct,
              hoursUntil,
              resetWhen,
              countdown,
              weeklyPct,
              weeklyHoursUntil,
              weeklyResetWhen,
              weeklyCountdown,
              cappedByWeekly,
            }) => (
              <div
                key={account.id}
                style={{ minWidth: SESSION_TIMELINE_LANE_MIN_PX }}
                className="flex-1 flex flex-col items-center"
              >
                <span className="text-xs text-gray-300 truncate max-w-full mb-1">
                  {account.label}
                </span>
                <div
                  className="flex items-stretch gap-1 w-full"
                  style={{ height: SESSION_TIMELINE_HEIGHT_PX }}
                >
                  <div
                    className="relative rounded bg-surface-2 border border-border"
                    style={{ flex: "9 1 0%" }}
                  >
                    {ticks.map((h) => (
                      <div
                        key={h}
                        className="absolute left-0 right-0 border-t border-border/40"
                        style={{ top: h * SESSION_TIMELINE_HOUR_PX }}
                      />
                    ))}
                    {pct != null && hoursUntil != null && (
                      <div
                        className="absolute left-1 right-1 h-1 rounded overflow-hidden flex"
                        style={{ top: `${hoursUntil * SESSION_TIMELINE_HOUR_PX - 2}px` }}
                        title={resetWhen ? t("resets", { when: resetWhen }) : undefined}
                      >
                        <div
                          className={`flex-1 ${sessionMarkerColor(pct, weeklyPct, sessionThresholds, weeklyThresholds)}`}
                        />
                        <div
                          className={`flex-1 ${sessionMarkerRightColor(pct, weeklyPct, sessionThresholds, weeklyThresholds)}`}
                        />
                      </div>
                    )}
                    {countdown && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-1">
                        <span className="text-base sm:text-lg font-bold text-gray-100 bg-surface-1/80 rounded px-2 py-0.5 leading-tight text-center">
                          {countdown}
                        </span>
                      </div>
                    )}
                  </div>
                  <div
                    className={`self-start rounded ${weeklyPctColor(weeklyPct, weeklyThresholds)}`}
                    style={{
                      flex: "1 1 0%",
                      height: `${weeklyHoursUntil * SESSION_TIMELINE_HOUR_PX}px`,
                    }}
                    title={weeklyResetWhen ? t("resets", { when: weeklyResetWhen }) : undefined}
                  />
                </div>
                {resetWhen && (
                  <p className="text-[11px] text-gray-500 mt-1 text-center">
                    {pct}% · {resetWhen}
                  </p>
                )}
                {cappedByWeekly && (
                  <p
                    className={`text-[10px] font-semibold mt-0.5 text-center ${pctTextColor(weeklyPct, weeklyThresholds)}`}
                  >
                    {t("accounts.sessionTimeline.cappedByWeekly", {
                      pct: Math.max(0, 100 - (weeklyPct ?? 100)),
                    })}
                  </p>
                )}
                {cappedByWeekly && weeklyCountdown && (
                  <p className="text-[10px] text-gray-500 text-center">
                    {t("accounts.sessionTimeline.weeklyResetsIn", { when: weeklyCountdown })}
                  </p>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function scopeIsValid(s: ColorThresholds): boolean {
  return s.yellowAt < s.orangeAt && s.orangeAt < s.redAt;
}

function scopesEqual(a: ColorThresholds, b: ColorThresholds): boolean {
  return a.yellowAt === b.yellowAt && a.orangeAt === b.orangeAt && a.redAt === b.redAt;
}

/**
 * One scope's (session or weekly) three inputs + live preview strip, used
 * four times by {@link ColorThresholdsCard} - session/weekly (raw %-used,
 * `previewMax` 100) first, then their Consumption Rate `*Rate` counterparts
 * (a raw pace-ratio multiplier, not a percentage - `previewMax` scales to
 * the configured `redAt` instead of a fixed 100, and `step`/`description`
 * reflect the decimal, sub-100 range those two are actually measured in -
 * see `DEFAULT_RATE_COLOR_THRESHOLDS`).
 */
function ColorThresholdsScopeFields({
  scopeLabel,
  description,
  value,
  onChange,
  step = 1,
  previewMax = 100,
}: {
  scopeLabel: string;
  description?: string;
  value: ColorThresholds;
  onChange: (field: keyof ColorThresholds, next: number) => void;
  step?: number;
  previewMax?: number;
}) {
  const { t } = useTranslation("usage");
  const fields: Array<{ field: keyof ColorThresholds; dot: string; label: string }> = [
    { field: "yellowAt", dot: "bg-yellow-500", label: t("accounts.colorThresholds.yellowLabel") },
    { field: "orangeAt", dot: "bg-orange-500", label: t("accounts.colorThresholds.orangeLabel") },
    { field: "redAt", dot: "bg-red-500", label: t("accounts.colorThresholds.redLabel") },
  ];
  // Fixed 100 only makes sense as the "full scale" for the raw %-used
  // scopes; the rate scopes' redAt is itself only ~1.5 by default, so the
  // last segment scales off whichever of `previewMax` or `redAt` is larger
  // instead of going almost entirely red.
  const scaleMax = Math.max(previewMax, value.redAt);
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2">
        {scopeLabel}
      </h3>
      {description && <p className="text-[11px] text-gray-500 mb-2">{description}</p>}
      <div className="h-2 rounded-full overflow-hidden flex border border-border mb-3">
        <div className="bg-emerald-500" style={{ flex: Math.max(0, value.yellowAt) }} />
        <div
          className="bg-yellow-500"
          style={{ flex: Math.max(0, value.orangeAt - value.yellowAt) }}
        />
        <div
          className="bg-orange-500"
          style={{ flex: Math.max(0, value.redAt - value.orangeAt) }}
        />
        <div className="bg-red-500" style={{ flex: Math.max(0, scaleMax - value.redAt) }} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {fields.map(({ field, dot, label }) => (
          <label key={field} className="text-xs text-gray-400">
            <span className="flex items-center gap-1.5 mb-1">
              <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
              {label}
            </span>
            <input
              type="number"
              min={0}
              max={1000}
              step={step}
              value={value[field]}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) onChange(field, next);
              }}
              className="input w-full"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** The four {@link ColorThresholdsConfig} keys, in display order - session
 *  and weekly (raw %-used) first, then their Consumption Rate (runway-risk)
 *  counterparts. */
const COLOR_THRESHOLD_SCOPES = ["session", "weekly", "sessionRate", "weeklyRate"] as const;
type ColorThresholdScope = (typeof COLOR_THRESHOLD_SCOPES)[number];

/**
 * Global settings card for the green/yellow/orange/red bands every
 * percentage-driven color on this page (`colorBand` and its callers above)
 * reads from - editable here, persisted server-side via
 * client/src/lib/colorThresholds.ts, and shared live across every connected
 * client. Four independent scopes (see `COLOR_THRESHOLD_SCOPES` -
 * they're separate quantities, not one shared ramp - see
 * `ColorThresholdsConfig`). Edits are staged in local `draft` state so a
 * mid-edit keystroke doesn't trigger a save on every render; only "Save"
 * (once every scope is valid) actually persists. Collapsed by default (same
 * chevron-toggle idiom as `RawTextSection`/`HistoryRow` below) - a
 * rarely-touched config card, so it shouldn't compete for space with the
 * account data every visit actually comes here to read.
 */
function ColorThresholdsCard() {
  const { t } = useTranslation("usage");
  const thresholds = useColorThresholds();
  const [draft, setDraft] = useState<ColorThresholdsConfig>(thresholds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  // A live push (another tab, another computer) should win over an untouched
  // draft - but not clobber an edit in progress, so only resync while the
  // draft still matches what was last saved/loaded.
  const [lastSynced, setLastSynced] = useState<ColorThresholdsConfig>(thresholds);
  useEffect(() => {
    setDraft((d) => (d === lastSynced ? thresholds : d));
    setLastSynced(thresholds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thresholds]);

  const isValid = COLOR_THRESHOLD_SCOPES.every((scope) => scopeIsValid(draft[scope]));
  const isDirty = COLOR_THRESHOLD_SCOPES.some(
    (scope) => !scopesEqual(draft[scope], thresholds[scope])
  );

  const handleScopeChange =
    (scope: ColorThresholdScope) => (field: keyof ColorThresholds, next: number) => {
      setDraft((d) => ({ ...d, [scope]: { ...d[scope], [field]: next } }));
      setError(null);
    };

  const handleSave = async () => {
    if (!isValid) {
      setError(t("accounts.colorThresholds.validationError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await colorThresholdsStore.save(draft);
      setDraft(result);
      setLastSynced(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("accounts.colorThresholds.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setDraft(DEFAULT_COLOR_THRESHOLDS_CONFIG);
    setError(null);
  };

  return (
    <div className="card p-4">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 w-full text-left"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        )}
        <h2 className="text-sm font-semibold text-gray-200">
          {t("accounts.colorThresholds.title")}
        </h2>
      </button>

      {!collapsed && (
        <>
          <p className="text-xs text-gray-500 mt-0.5 mb-3 ml-[1.375rem]">
            {t("accounts.colorThresholds.subtitle")}
          </p>

          <div className="space-y-4">
            {COLOR_THRESHOLD_SCOPES.map((scope) => {
              const isRateScope = scope === "sessionRate" || scope === "weeklyRate";
              return (
                <ColorThresholdsScopeFields
                  key={scope}
                  scopeLabel={t(`accounts.colorThresholds.scope.${scope}`)}
                  description={
                    isRateScope ? t("accounts.colorThresholds.rateScopeDescription") : undefined
                  }
                  value={draft[scope]}
                  onChange={handleScopeChange(scope)}
                  step={isRateScope ? 0.1 : 1}
                  previewMax={isRateScope ? 2 : 100}
                />
              );
            })}
          </div>

          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isValid || !isDirty}
              className="btn-primary text-xs disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? t("accounts.colorThresholds.saving") : t("accounts.colorThresholds.save")}
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={saving}
              className="btn-ghost text-xs disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {t("accounts.colorThresholds.resetDefaults")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PctBar({
  label,
  pct,
  resetRaw,
  scope,
}: {
  label: string;
  pct: number | null;
  resetRaw: string | null;
  /** Which color-threshold scope this bar's percentage belongs to. */
  scope: "session" | "weekly";
}) {
  const { t } = useTranslation("usage");
  const thresholds = useColorThresholds()[scope];
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-400 font-medium">{label}</span>
        <span className="text-gray-300 font-mono">{pct != null ? `${pct}%` : t("noData")}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            pct != null ? pctBarColor(pct, thresholds) : "bg-surface-3"
          }`}
          style={{ width: `${pct != null ? Math.min(100, Math.max(2, pct)) : 0}%` }}
        />
      </div>
      {resetRaw && (
        <p className="text-[11px] text-gray-500 mt-1">{t("resets", { when: resetRaw })}</p>
      )}
    </div>
  );
}

function LatestCaptureCard({ detail }: { detail: UsageCapture }) {
  const { t } = useTranslation("usage");
  let weekByModel: Record<string, number> | null = null;
  if (detail.week_pct_by_model_json) {
    try {
      weekByModel = JSON.parse(detail.week_pct_by_model_json);
    } catch {
      weekByModel = null;
    }
  }

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">{t("latest.title")}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{formatDateTimeFull(detail.captured_at)}</p>
        </div>
        <StatusBadge status={detail.status} />
      </div>

      {detail.error_message && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{detail.error_message}</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <User className="w-3 h-3" /> {t("latest.account")}
          </div>
          <p className="mt-1 text-sm text-gray-100 truncate">
            {detail.account_email || t("noData")}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <Building2 className="w-3 h-3" /> {t("latest.org")}
          </div>
          <p className="mt-1 text-sm text-gray-100 truncate">{detail.account_org || t("noData")}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <Cpu className="w-3 h-3" /> {t("latest.model")}
          </div>
          <p className="mt-1 text-sm text-gray-100 truncate">
            {formatModelName(detail.model) || detail.model || t("noData")}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <CircleDollarSign className="w-3 h-3" /> {t("latest.sessionCost")}
          </div>
          <p className="mt-1 text-sm text-gray-100 font-mono">
            {formatCost(detail.session_cost_usd)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PctBar
          label={t("latest.sessionWindow")}
          pct={detail.session_window_pct}
          resetRaw={detail.session_window_reset_raw}
          scope="session"
        />
        {weekByModel && Object.keys(weekByModel).length > 0 ? (
          <div>
            <p className="text-xs text-gray-400 font-medium mb-1">{t("latest.weeklyByModel")}</p>
            <div className="space-y-2">
              <PctBar
                label={t("latest.allModels")}
                pct={detail.week_window_pct}
                resetRaw={detail.week_reset_raw}
                scope="weekly"
              />
              {Object.entries(weekByModel).map(([model, pct]) => (
                <PctBar
                  key={model}
                  label={model}
                  pct={pct}
                  resetRaw={detail.week_reset_raw}
                  scope="weekly"
                />
              ))}
            </div>
          </div>
        ) : (
          <PctBar
            label={t("latest.weekly")}
            pct={detail.week_window_pct}
            resetRaw={detail.week_reset_raw}
            scope="weekly"
          />
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <p className="text-gray-500">{t("latest.inputTokens")}</p>
          <p className="text-gray-200 font-mono mt-0.5">
            {formatTokenCount(detail.session_input_tokens)}
          </p>
        </div>
        <div>
          <p className="text-gray-500">{t("latest.outputTokens")}</p>
          <p className="text-gray-200 font-mono mt-0.5">
            {formatTokenCount(detail.session_output_tokens)}
          </p>
        </div>
        <div>
          <p className="text-gray-500">{t("latest.cacheRead")}</p>
          <p className="text-gray-200 font-mono mt-0.5">
            {formatTokenCount(detail.session_cache_read_tokens)}
          </p>
        </div>
        <div>
          <p className="text-gray-500">{t("latest.cacheWrite")}</p>
          <p className="text-gray-200 font-mono mt-0.5">
            {formatTokenCount(detail.session_cache_write_tokens)}
          </p>
        </div>
      </div>

      {(detail.raw_status_text || detail.raw_usage_text) && <RawTextSection detail={detail} />}
    </div>
  );
}

function RawTextSection({ detail }: { detail: UsageCapture }) {
  const { t } = useTranslation("usage");
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {t("latest.showRaw")}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {detail.raw_status_text && (
            <pre className="text-[11px] font-mono text-gray-300 bg-surface-1 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {detail.raw_status_text}
            </pre>
          )}
          {detail.raw_usage_text && (
            <pre className="text-[11px] font-mono text-gray-300 bg-surface-1 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {detail.raw_usage_text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ item }: { item: UsageCaptureSummary }) {
  const { t } = useTranslation("usage");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<UsageCapture | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setLoadingDetail(true);
      try {
        const full = await api.usage.get(item.id);
        setDetail(full);
      } catch {
        /* row still shows its summary fields even if the detail fetch fails */
      } finally {
        setLoadingDetail(false);
      }
    }
  }, [open, detail, item.id]);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-3 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        )}
        <span className="text-xs text-gray-400 font-mono w-32 flex-shrink-0">
          {timeAgo(item.captured_at)}
        </span>
        <StatusBadge status={item.status} />
        <span className="text-xs text-gray-300 truncate flex-1">
          {formatModelName(item.model) || item.model || t("noData")}
        </span>
        <span className="text-xs text-gray-400 font-mono">{formatCost(item.session_cost_usd)}</span>
        <span className="text-xs text-gray-400 font-mono w-14 text-right">
          {item.session_window_pct != null ? `${item.session_window_pct}%` : "—"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {loadingDetail ? (
            <p className="text-xs text-gray-500">{t("common:loading")}</p>
          ) : detail ? (
            <LatestCaptureCard detail={detail} />
          ) : (
            <p className="text-xs text-gray-500">{formatDateTimeFull(item.captured_at)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Decision (2026-08-01): the legacy tmux/TUI single-account capture path
// (server/lib/usage-capture.js, `/api/usage/capture`) is being KEPT as-is on
// the backend - it's still the only source of per-session cost/token/
// duration/lines-changed detail, which the newer Accounts OAuth path
// structurally can't provide (Anthropic's rate-limit headers only carry
// session%/weekly%/reset times). Its UI below is hidden for now since the
// Accounts panel + reset calendars above already cover "which account needs
// attention," which used to be this section's job. Revisit later: either
// restore this UI (e.g. relabeled as terminal-session diagnostics) or
// remove it outright once it's clear whether it's still worth keeping.
const SHOW_LEGACY_CAPTURE_UI = false;

export function Usage() {
  const { t } = useTranslation("usage");
  const [items, setItems] = useState<UsageCaptureSummary[]>([]);
  const [latest, setLatest] = useState<UsageCapture | null>(null);
  const [serverCapturing, setServerCapturing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.accounts.list();
      setAccounts(res.accounts);
      setAccountsError(null);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : t("accounts.loadFailed"));
    } finally {
      setAccountsLoading(false);
    }
  }, [t]);

  const fetchList = useCallback(async () => {
    setError(null);
    try {
      const res = await api.usage.list(50);
      setItems(res.items);
      setServerCapturing(res.capturing);
      const firstItem = res.items[0];
      if (firstItem) {
        const full = await api.usage.get(firstItem.id);
        setLatest(full);
      } else {
        setLatest(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (SHOW_LEGACY_CAPTURE_UI) fetchList();
  }, [fetchList]);

  const handleCapture = async () => {
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      await api.usage.capture();
      await fetchList();
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : t("captureFailed"));
    } finally {
      setCaptureBusy(false);
    }
  };

  const captureDisabled = captureBusy || serverCapturing;

  return (
    <div className="space-y-6">
      {accounts.length > 0 && (
        <>
          <RotationPlanCard accounts={accounts} />
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">
            <div className="space-y-4">
              <SessionResetTimeline accounts={accounts} />
              <AccountsResetCalendar accounts={accounts} />
            </div>
            <div className="space-y-4">
              <AccountActivityCard accounts={accounts} />
              <ConsumptionRateCard accounts={accounts} />
            </div>
          </div>
        </>
      )}

      <AccountsPanel
        accounts={accounts}
        loading={accountsLoading}
        error={accountsError}
        onChanged={fetchAccounts}
      />

      {accounts.length > 0 && <ColorThresholdsCard />}

      {SHOW_LEGACY_CAPTURE_UI && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Gauge className="w-5 h-5 text-accent" /> {t("title")}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">{t("subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={handleCapture}
              disabled={captureDisabled}
              className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${captureDisabled ? "animate-spin" : ""}`} />
              {captureDisabled ? t("capturing") : t("captureNow")}
            </button>
          </div>

          {captureError && (
            <div className="card flex items-start gap-2 px-4 py-3 border-red-500/30 bg-red-500/5">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{captureError}</p>
            </div>
          )}

          {loading ? (
            <div className="space-y-6">
              <div className="card h-64 animate-pulse bg-surface-2" />
              <div className="card h-40 animate-pulse bg-surface-2" />
            </div>
          ) : error ? (
            <div className="card flex flex-col items-center justify-center py-16 gap-4">
              <AlertCircle className="w-10 h-10 text-red-400" />
              <p className="text-red-400 text-sm">{error}</p>
              <button onClick={() => fetchList()} className="btn-primary text-sm">
                {t("common:retry")}
              </button>
            </div>
          ) : !latest ? (
            <div className="card flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
              <Gauge className="w-10 h-10 text-gray-600" />
              <p className="text-sm text-gray-400">{t("empty.title")}</p>
              <p className="text-xs text-gray-500 max-w-md">{t("empty.hint")}</p>
            </div>
          ) : (
            <>
              <LatestCaptureCard detail={latest} />

              <div className="card">
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-sm font-semibold text-gray-200">{t("history.title")}</h2>
                </div>
                {items.length <= 1 ? (
                  <p className="px-4 py-6 text-xs text-gray-500 text-center">
                    {t("history.empty")}
                  </p>
                ) : (
                  items.slice(1).map((item) => <HistoryRow key={item.id} item={item} />)
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
