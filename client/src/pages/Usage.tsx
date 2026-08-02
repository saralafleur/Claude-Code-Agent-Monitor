/**
 * @file Usage.tsx
 * @description Shows Claude rate-limit/usage standing for the currently
 * logged-in CLI session (the legacy/global view, driving
 * server/lib/usage-capture.js over tmux) plus, in the Accounts panel above
 * it, any number of separately named Claude accounts side by side - each
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
 * own "orange" band it takes over the right half - so a fresh-looking
 * session marker still visibly tints toward the weekly window's own
 * urgency color instead of reading as uniformly fine when the weekly
 * window is the thing about to run out.
 */
function sessionMarkerRightColor(
  pct: number,
  weeklyPct: number | null,
  sessionThresholds: ColorThresholds,
  weeklyThresholds: ColorThresholds
): string {
  if (weeklyPct != null && weeklyPct >= weeklyThresholds.orangeAt) {
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
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-200">{t("accounts.title")}</h2>
        </div>
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

      {adding && (
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

      {error && <p className="px-4 py-3 text-xs text-red-400">{error}</p>}
      {loginError && <p className="px-4 py-3 text-xs text-red-400">{loginError}</p>}

      {!loading && !error && accounts.length === 0 ? (
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
      )}
    </div>
  );
}

// Weekly windows reset at most ~7 days out, so a fixed 14-day grid is almost
// always mostly dead space. Size the grid to the data instead: at least a
// week (so it never looks cramped even when every account resets tomorrow),
// and RESET_CALENDAR_BUFFER_DAYS past whichever account resets furthest out
// (so the last bar doesn't end flush against the grid's right edge) - capped
// defensively in case a bad/stale reset timestamp would otherwise blow the
// grid out.
const RESET_CALENDAR_MIN_DAYS = 7;
const RESET_CALENDAR_MAX_DAYS = 14;
const RESET_CALENDAR_BUFFER_DAYS = 2;
const RESET_CALENDAR_DAY_PX = 44;
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

  const furthestResetDays = Math.max(0, ...rows.map((r) => r.spanDays ?? 0));
  const dayCount = Math.min(
    RESET_CALENDAR_MAX_DAYS,
    Math.max(RESET_CALENDAR_MIN_DAYS, furthestResetDays + RESET_CALENDAR_BUFFER_DAYS)
  );

  const days = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });
  const trackWidth = dayCount * RESET_CALENDAR_DAY_PX;

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-gray-200">{t("accounts.calendar.title")}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{t("accounts.calendar.subtitle")}</p>
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${RESET_CALENDAR_LABEL_PX + trackWidth}px` }}>
          <div className="flex">
            <div style={{ width: RESET_CALENDAR_LABEL_PX }} className="flex-shrink-0" />
            {days.map((d, i) => (
              <div
                key={i}
                style={{ width: RESET_CALENDAR_DAY_PX }}
                className={`flex-shrink-0 text-center text-[10px] font-mono ${
                  i === 0 ? "text-accent font-semibold" : "text-gray-500"
                }`}
              >
                <div>{d.toLocaleDateString(undefined, { weekday: "narrow" })}</div>
                <div>{d.getDate()}</div>
              </div>
            ))}
          </div>
          {rows.map(({ account, pct, spanDays, resetWhen, countdown }) => {
            const visibleDays = spanDays != null ? Math.min(spanDays, dayCount) : 0;

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
                  <div className="relative h-9" style={{ width: trackWidth }}>
                    <div className="absolute inset-0 flex">
                      {days.map((_, i) => (
                        <div
                          key={i}
                          style={{ width: RESET_CALENDAR_DAY_PX }}
                          className="flex-shrink-0 border-l border-border/40 h-full"
                        />
                      ))}
                    </div>
                    {pct != null && spanDays != null && (
                      <div
                        className={`absolute top-0.5 h-8 rounded ${weeklyPctColor(pct, thresholds)}`}
                        style={{ left: 0, width: `${visibleDays * RESET_CALENDAR_DAY_PX - 2}px` }}
                        title={resetWhen ? t("resets", { when: resetWhen }) : undefined}
                      />
                    )}
                    {countdown && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-1">
                        <span className="text-base sm:text-lg font-bold text-gray-100 bg-surface-1/80 rounded px-2 py-0.5 leading-tight whitespace-nowrap">
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
 * twice by {@link ColorThresholdsCard} - session listed first, then weekly,
 * since they're independent settings rather than one shared ramp.
 */
function ColorThresholdsScopeFields({
  scopeLabel,
  value,
  onChange,
}: {
  scopeLabel: string;
  value: ColorThresholds;
  onChange: (field: keyof ColorThresholds, next: number) => void;
}) {
  const { t } = useTranslation("usage");
  const fields: Array<{ field: keyof ColorThresholds; dot: string; label: string }> = [
    { field: "yellowAt", dot: "bg-yellow-500", label: t("accounts.colorThresholds.yellowLabel") },
    { field: "orangeAt", dot: "bg-orange-500", label: t("accounts.colorThresholds.orangeLabel") },
    { field: "redAt", dot: "bg-red-500", label: t("accounts.colorThresholds.redLabel") },
  ];
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2">
        {scopeLabel}
      </h3>
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
        <div className="bg-red-500" style={{ flex: Math.max(0, 100 - value.redAt) }} />
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

/**
 * Global settings card for the green/yellow/orange/red bands every
 * percentage-driven color on this page (`colorBand` and its callers above)
 * reads from - editable here, persisted server-side via
 * client/src/lib/colorThresholds.ts, and shared live across every connected
 * client. Two independent scopes, session then weekly (they're separate
 * quotas, not one shared ramp - see `ColorThresholdsConfig`). Edits are
 * staged in local `draft` state so a mid-edit keystroke doesn't trigger a
 * save on every render; only "Save" (once both scopes are valid) actually
 * persists.
 */
function ColorThresholdsCard() {
  const { t } = useTranslation("usage");
  const thresholds = useColorThresholds();
  const [draft, setDraft] = useState<ColorThresholdsConfig>(thresholds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A live push (another tab, another computer) should win over an untouched
  // draft - but not clobber an edit in progress, so only resync while the
  // draft still matches what was last saved/loaded.
  const [lastSynced, setLastSynced] = useState<ColorThresholdsConfig>(thresholds);
  useEffect(() => {
    setDraft((d) => (d === lastSynced ? thresholds : d));
    setLastSynced(thresholds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thresholds]);

  const isValid = scopeIsValid(draft.session) && scopeIsValid(draft.weekly);
  const isDirty =
    !scopesEqual(draft.session, thresholds.session) ||
    !scopesEqual(draft.weekly, thresholds.weekly);

  const handleScopeChange =
    (scope: "session" | "weekly") => (field: keyof ColorThresholds, next: number) => {
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
      <h2 className="text-sm font-semibold text-gray-200">{t("accounts.colorThresholds.title")}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{t("accounts.colorThresholds.subtitle")}</p>

      <div className="space-y-4">
        <ColorThresholdsScopeFields
          scopeLabel={t("accounts.colorThresholds.scope.session")}
          value={draft.session}
          onChange={handleScopeChange("session")}
        />
        <ColorThresholdsScopeFields
          scopeLabel={t("accounts.colorThresholds.scope.weekly")}
          value={draft.weekly}
          onChange={handleScopeChange("weekly")}
        />
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
      <AccountsPanel
        accounts={accounts}
        loading={accountsLoading}
        error={accountsError}
        onChanged={fetchAccounts}
      />

      {accounts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">
          <SessionResetTimeline accounts={accounts} />
          <AccountsResetCalendar accounts={accounts} />
        </div>
      )}

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
