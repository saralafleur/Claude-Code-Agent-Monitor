/**
 * @file CacheSection.tsx
 * @description Settings → Focus Summaries: live size/hit-rate/cached-data
 * stat tiles for the server's focus-window-summary cache (`focus_summaries`,
 * the cache behind the Focus page's "What happened in this window" block —
 * see server/lib/focus-summary.js), a day-bucketed hit/miss timeline
 * (stacked bars or a volume heatmap), and a filterable single-day
 * drill-down of individual cache resolutions.
 *
 * Backs `GET /api/settings/info`'s `focus_summary_cache` (passed in as
 * `stats`, already polled by Settings.tsx) plus the
 * `GET /api/settings/cache/timeline` and `GET /api/settings/cache/day`
 * routes via {@link api.settings}. Timeline days are UTC calendar days,
 * matching every other timestamp this app stores.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Gauge, Layers, ListTree } from "lucide-react";
import { api } from "../lib/api";
import { fmt, formatModelName, formatTime, getCurrentLocale } from "../lib/format";
import { Skeleton } from "./Skeleton";
import type {
  FocusSummaryCacheStats,
  FocusSummaryDayResponse,
  FocusSummaryTimelineDay,
} from "../lib/types";

interface Props {
  stats: FocusSummaryCacheStats | null;
}

/** `dateStr` is a UTC calendar day (`YYYY-MM-DD`) — format it pinned to UTC
 *  so the label always matches the bucket, regardless of viewer timezone. */
function formatDayLabel(dateStr: string, locale: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const MAX_BAR_PX = 84;

export function CacheSection({ stats }: Props) {
  const { t } = useTranslation("settings");
  const locale = getCurrentLocale();

  const [timeline, setTimeline] = useState<FocusSummaryTimelineDay[] | null>(null);
  const [view, setView] = useState<"outcome" | "volume">("outcome");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [day, setDay] = useState<FocusSummaryDayResponse | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "hit" | "miss">("all");
  const [levelFilter, setLevelFilter] = useState<"all" | "window" | "day">("all");
  const [modelFilter, setModelFilter] = useState("all");

  const loadTimeline = useCallback(() => {
    api.settings
      .cacheTimeline(30)
      .then((res) => {
        setTimeline(res.days);
        setSelectedDate((prev) => prev ?? res.days[res.days.length - 1]?.date ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTimeline();
    const interval = setInterval(loadTimeline, 20000);
    return () => clearInterval(interval);
  }, [loadTimeline]);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setDayLoading(true);
    api.settings
      .cacheDay(selectedDate, {
        outcome: outcomeFilter === "all" ? undefined : outcomeFilter,
        model: modelFilter === "all" ? undefined : modelFilter,
        level: levelFilter === "all" ? undefined : levelFilter,
      })
      .then((res) => {
        if (!cancelled) setDay(res);
      })
      .catch(() => {
        if (!cancelled) setDay(null);
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, outcomeFilter, levelFilter, modelFilter]);

  const selectDay = (dateStr: string) => {
    setSelectedDate(dateStr);
    setModelFilter("all"); // a model picked for one day may not exist on another
  };

  const todayDate = timeline?.[timeline.length - 1]?.date ?? null;
  const todayTotal = timeline?.[timeline.length - 1]?.total ?? null;
  const yesterdayTotal =
    timeline && timeline.length >= 2 ? (timeline[timeline.length - 2]?.total ?? null) : null;

  const maxTotal = useMemo(
    () => Math.max(1, ...(timeline?.map((d) => d.total) ?? [1])),
    [timeline]
  );

  return (
    <div className="space-y-4">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 space-y-2">
          <p className="stat-label flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <Database className="w-3 h-3" />
            {t("cache.cachedSummaries")}
          </p>
          {stats ? (
            <>
              <p className="text-2xl font-semibold text-gray-100 tabular-nums">{fmt(stats.size)}</p>
              <p className="text-[11px] text-gray-500">{t("cache.cachedSummariesSub")}</p>
            </>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </div>

        <div className="card p-4 space-y-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <Gauge className="w-3 h-3" />
            {t("cache.hitRate")}
          </p>
          {stats ? (
            <>
              <p className="text-2xl font-semibold text-gray-100 tabular-nums">
                {stats.hitRate}
                <span className="text-[13px] font-medium text-gray-500 ml-0.5">%</span>
              </p>
              <p className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                {fmt(stats.hits)} {t("cache.hits")}
                <span className="text-gray-700">·</span>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                {fmt(stats.misses)} {t("cache.misses")}
              </p>
            </>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </div>

        <div className="card p-4 space-y-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <Layers className="w-3 h-3" />
            {t("cache.entriesToday")}
          </p>
          {todayTotal !== null ? (
            <>
              <p className="text-2xl font-semibold text-gray-100 tabular-nums">{fmt(todayTotal)}</p>
              <p className="text-[11px] text-gray-500">
                {yesterdayTotal !== null
                  ? t("cache.vsYesterday", {
                      delta: todayTotal - yesterdayTotal >= 0 ? "▲" : "▼",
                      count: Math.abs(todayTotal - yesterdayTotal),
                      yesterday: yesterdayTotal,
                    })
                  : t("cache.noYesterdayData")}
              </p>
            </>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </div>

        <div className="card p-4 space-y-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <ListTree className="w-3 h-3" />
            {t("cache.totalBullets")}
          </p>
          {stats ? (
            <>
              <p className="text-2xl font-semibold text-gray-100 tabular-nums">
                {fmt(stats.totalBullets)}
              </p>
              <p className="text-[11px] text-gray-500">{t("cache.totalBulletsSub")}</p>
            </>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="text-xs font-semibold text-gray-300">
              {t("cache.timelineTitle", { days: timeline?.length ?? 30 })}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">{t("cache.timelineSub")}</p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {view === "outcome" && (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span className="w-2 h-2 rounded-[3px] bg-emerald-400" />
                  {t("cache.legendHits")}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span className="w-2 h-2 rounded-[3px] bg-amber-400" />
                  {t("cache.legendMisses")}
                </span>
              </div>
            )}
            <div className="inline-flex p-0.5 gap-0.5 bg-surface-4 rounded-lg">
              <button
                type="button"
                onClick={() => setView("outcome")}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  view === "outcome" ? "bg-surface-2 text-gray-100" : "text-gray-400"
                }`}
              >
                {t("cache.viewByOutcome")}
              </button>
              <button
                type="button"
                onClick={() => setView("volume")}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  view === "volume" ? "bg-surface-2 text-gray-100" : "text-gray-400"
                }`}
              >
                {t("cache.viewByVolume")}
              </button>
            </div>
          </div>
        </div>

        {timeline ? (
          <div className="overflow-x-auto">
            <div
              className="flex items-end gap-1 pb-5"
              style={{ height: MAX_BAR_PX + 20, minWidth: timeline.length * 14 }}
            >
              {timeline.map((d, i) => {
                const isSelected = d.date === selectedDate;
                const isToday = d.date === todayDate;
                return (
                  <div
                    key={d.date}
                    className="relative flex-1 h-full flex flex-col justify-end items-stretch cursor-pointer group min-w-[8px]"
                    onMouseEnter={() => setHoverIndex(i)}
                    onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
                    onClick={() => selectDay(d.date)}
                  >
                    {hoverIndex === i && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 whitespace-nowrap rounded-lg border border-border-light bg-[#0a0a12] px-2.5 py-2 text-[11px] text-gray-300 shadow-2xl pointer-events-none">
                        <p className="font-semibold text-gray-100 mb-1">
                          {formatDayLabel(d.date, locale)}
                          {isToday ? ` · ${t("cache.today")}` : ""}
                        </p>
                        <p>{t("cache.tooltipEntries", { count: d.total })}</p>
                        <p className="flex items-center gap-1.5 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {d.hits} {t("cache.hits")}
                        </p>
                        <p className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          {d.misses} {t("cache.misses")}
                        </p>
                      </div>
                    )}

                    <div
                      className={`absolute -inset-x-0.5 rounded-md border transition-colors ${
                        isSelected
                          ? "border-accent bg-accent/[0.06]"
                          : "border-transparent group-hover:border-border-light"
                      }`}
                      style={{ top: -3, bottom: -18 }}
                    />

                    {view === "outcome" ? (
                      <>
                        {d.misses > 0 && (
                          <div
                            className="bg-amber-400 rounded-t-[3px] mb-[2px]"
                            style={{
                              height: Math.max(2, Math.round((d.misses / maxTotal) * MAX_BAR_PX)),
                            }}
                          />
                        )}
                        <div
                          className={
                            d.misses > 0 ? "bg-emerald-400" : "bg-emerald-400 rounded-t-[3px]"
                          }
                          style={{
                            height: Math.max(
                              d.total > 0 ? 2 : 1,
                              Math.round((d.hits / maxTotal) * MAX_BAR_PX)
                            ),
                          }}
                        />
                        <div className="h-[2px] rounded-full bg-surface-4" />
                      </>
                    ) : (
                      <div
                        className="rounded-[4px] mx-auto"
                        style={{
                          width: 12,
                          height: 12,
                          background:
                            d.total === 0
                              ? "var(--seq-0, #1a1a28)"
                              : `color-mix(in oklab, #17171f ${Math.max(
                                  0,
                                  100 - Math.round((d.total / maxTotal) * 100)
                                )}%, #6366f1 ${Math.round((d.total / maxTotal) * 100)}%)`,
                        }}
                      />
                    )}

                    {(isToday || i === 0) && (
                      <span
                        className={`absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px] whitespace-nowrap ${
                          isSelected ? "text-accent-hover font-semibold" : "text-gray-600"
                        }`}
                      >
                        {isToday ? t("cache.today") : formatDayLabel(d.date, locale).split(",")[0]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </div>

      {/* Drill-down */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="text-sm font-semibold text-gray-100">
            {selectedDate
              ? selectedDate === todayDate
                ? t("cache.today")
                : formatDayLabel(selectedDate, locale)
              : "—"}
          </p>
          {day && (
            <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
              <span>
                <b className="text-gray-300 font-semibold">{day.total}</b>{" "}
                {t("cache.columnOutcome").toLowerCase()}
              </span>
              <span>
                <b className="text-gray-300 font-semibold">{day.hits}</b> {t("cache.hits")}
              </span>
              <span>
                <b className="text-gray-300 font-semibold">{day.misses}</b> {t("cache.misses")}
              </span>
              {day.total > 0 && (
                <span>
                  <b className="text-gray-300 font-semibold">
                    {((day.hits / day.total) * 100).toFixed(1)}%
                  </b>{" "}
                  {t("cache.hitRate").toLowerCase()}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="inline-flex p-0.5 gap-0.5 bg-surface-4 rounded-lg">
            {(["all", "hit", "miss"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setOutcomeFilter(key)}
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  outcomeFilter === key ? "bg-surface-2 text-gray-100" : "text-gray-400"
                }`}
              >
                {key !== "all" && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${key === "hit" ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                )}
                {key === "all"
                  ? t("cache.filterAll")
                  : key === "hit"
                    ? t("cache.filterHits")
                    : t("cache.filterMisses")}
              </button>
            ))}
          </div>
          <div className="inline-flex p-0.5 gap-0.5 bg-surface-4 rounded-lg">
            {(["all", "window", "day"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setLevelFilter(key)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  levelFilter === key ? "bg-surface-2 text-gray-100" : "text-gray-400"
                }`}
              >
                {key === "all"
                  ? t("cache.filterAllLevels")
                  : key === "window"
                    ? t("cache.filterWindowLevel")
                    : t("cache.filterDayLevel")}
              </button>
            ))}
          </div>
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="text-[11px] text-gray-300 bg-surface-4 border border-border rounded-lg px-2.5 py-1.5"
          >
            <option value="all">{t("cache.allModels")}</option>
            {(day?.models ?? []).map((m) => (
              <option key={m} value={m}>
                {formatModelName(m) ?? m}
              </option>
            ))}
          </select>
          <div className="flex-1" />
          {day && (
            <span className="text-[11px] text-gray-500">
              {t("cache.resultCount", { shown: day.entries.length, total: day.total })}
            </span>
          )}
        </div>

        {day?.truncated && (
          <p className="text-[11px] text-amber-400/90 bg-amber-500/5 border border-amber-500/20 rounded-md px-2.5 py-1.5 mb-3">
            {t("cache.truncatedNote", { total: day.total })}
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr className="bg-surface-3 border-b border-border">
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {t("cache.columnScope")}
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {t("cache.columnLevel")}
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {t("cache.columnModel")}
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {t("cache.columnOutcome")}
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {t("cache.columnBullets")}
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {t("cache.columnAccessed")}
                </th>
              </tr>
            </thead>
            <tbody>
              {dayLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : !day || day.total === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-7 text-center text-xs text-gray-600">
                    {t("cache.noActivityDay")}
                  </td>
                </tr>
              ) : day.entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-7 text-center text-xs text-gray-600">
                    {t("cache.noMatchFilters")}
                  </td>
                </tr>
              ) : (
                day.entries.map((entry, i) => (
                  <tr
                    key={`${entry.cache_key}-${entry.accessed_at}-${i}`}
                    className="border-b border-border last:border-0 hover:bg-surface-3 transition-colors"
                  >
                    <td
                      className="px-3 py-2 text-xs text-gray-300 truncate max-w-[220px]"
                      title={entry.cache_key}
                    >
                      {entry.scope_label}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400 capitalize">{entry.level}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {formatModelName(entry.model) ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[10.5px] font-medium px-2 py-0.5 rounded-full border ${
                          entry.outcome === "hit"
                            ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                            : "bg-amber-500/10 border-amber-500/25 text-amber-400"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {entry.outcome === "hit" ? t("cache.filterHits") : t("cache.filterMisses")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400 text-right tabular-nums">
                      {entry.bullet_count ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400 tabular-nums">
                      {formatTime(entry.accessed_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-gray-600 mt-3">{t("cache.utcNote")}</p>
      </div>
    </div>
  );
}
