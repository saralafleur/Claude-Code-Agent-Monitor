/**
 * @file Usage.tsx
 * @description Shows the current Claude account's rate-limit/usage standing
 * by capturing the `claude` CLI's own `/status` and `/usage` TUI panels
 * (server/lib/usage-capture.js drives this over tmux) and persisting the
 * parsed result. Displays the most recent capture prominently (account info,
 * model, session cost/tokens, session-window and weekly rate-limit
 * percentages) plus a history list of past captures, and lets the user
 * trigger a fresh capture on demand.
 *
 * Wire-up:
 *   - GET /api/usage - capture history (newest first) + whether a capture
 *     is currently in flight.
 *   - GET /api/usage/:id - one capture's full detail (incl. raw pane text).
 *   - POST /api/usage/capture - launches `claude` in tmux, drives /status and
 *     /usage, and persists the parsed row. Takes ~10-15s; the button shows a
 *     loading state for the duration of the request.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { api } from "../lib/api";
import type { UsageCapture, UsageCaptureSummary, UsageCaptureStatus } from "../lib/api";
import { formatDateTimeFull, timeAgo, formatModelName } from "../lib/format";

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

function pctBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
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

function PctBar({
  label,
  pct,
  resetRaw,
}: {
  label: string;
  pct: number | null;
  resetRaw: string | null;
}) {
  const { t } = useTranslation("usage");
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-400 font-medium">{label}</span>
        <span className="text-gray-300 font-mono">{pct != null ? `${pct}%` : t("noData")}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            pct != null ? pctBarColor(pct) : "bg-surface-3"
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
        />
        {weekByModel && Object.keys(weekByModel).length > 0 ? (
          <div>
            <p className="text-xs text-gray-400 font-medium mb-1">{t("latest.weeklyByModel")}</p>
            <div className="space-y-2">
              <PctBar
                label={t("latest.allModels")}
                pct={detail.week_window_pct}
                resetRaw={detail.week_reset_raw}
              />
              {Object.entries(weekByModel).map(([model, pct]) => (
                <PctBar key={model} label={model} pct={pct} resetRaw={detail.week_reset_raw} />
              ))}
            </div>
          </div>
        ) : (
          <PctBar
            label={t("latest.weekly")}
            pct={detail.week_window_pct}
            resetRaw={detail.week_reset_raw}
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

export function Usage() {
  const { t } = useTranslation("usage");
  const [items, setItems] = useState<UsageCaptureSummary[]>([]);
  const [latest, setLatest] = useState<UsageCapture | null>(null);
  const [serverCapturing, setServerCapturing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

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
    fetchList();
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
          <button onClick={fetchList} className="btn-primary text-sm">
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
              <p className="px-4 py-6 text-xs text-gray-500 text-center">{t("history.empty")}</p>
            ) : (
              items.slice(1).map((item) => <HistoryRow key={item.id} item={item} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}
