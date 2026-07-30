/**
 * @file FocusPage.tsx
 * @description Standalone, first-class page (route `/focus`, sidebar label
 * "Focus") answering "what did we actually do" as a stakeholder-readable
 * report — not a card squeezed into the Calendar page's swimlane view. Same
 * project/session/time-window controls as `FocusCalendarBoard.tsx` (project
 * chips via `ProjectScopeFilters`, a global session `<select>`, and
 * `TimePeriodPicker`), but the body is stat tiles (same numbers/formula as
 * `FocusReportBody`) plus the new `FocusActivityCard` — a simple list of
 * "this happened" rows (one per plan item / detour-bug-feature / unclassified
 * bucket), each with a label and, for classifier-inferred entries, the
 * one-sentence reason — instead of a calendar grid. Deliberately does not
 * render `FocusCalendarView`/the List-Calendar toggle at all.
 *
 * Reuses `api.focusReport` (`GET /api/focus-report`) exactly as
 * `FocusCalendarBoard` does — that endpoint already clips every session's
 * segments to the requested `from`/`to` server-side (see its own file
 * header), so this page never needs `windowedTotals.ts`'s client-side
 * clipping: `report.totals`/`report.wall_clock_ms`/`report.concurrency_ratio`
 * already ARE the selected window's numbers.
 *
 * The on-item/off-plan split mirrors `FocusReportBody`'s exact formula
 * (`totals.by_kind.item.active_ms / totals.active_ms`) — keep the two in
 * sync if that formula ever changes, so the same window/scope reads the same
 * percentage whether viewed here or on the Calendar page.
 *
 * `showProjectLabel` (passed to `FocusActivityCard`) is true only in "all
 * projects" scope (`projectId === undefined && !unassignedOnly`) — a
 * single-project view never prefixes its rows with a project name.
 *
 * Above the activity list sits an LLM-synthesized "Summary" block
 * (`api.focusReportSummary` → `GET /api/focus-report/summary`):
 * stakeholder-readable bullets for the SAME `from`/`to` window and scope as
 * the report fetch, GROUPED BY PROJECT (`summary.groups`, largest
 * wall-clock share first — the server partitions an all-projects window per
 * project). Group headers (project name, or the shared "Unassigned" label
 * for unmapped folders) render only in all-projects scope
 * (`showProjectLabel`) — a single-project view shows its one group's
 * bullets headerless, exactly like before grouping existed. Fetched independently and non-blocking (its own effect,
 * its own loading state) so a slow/unavailable synthesis never delays the
 * stat tiles or activity rows; a `null` summary (LLM path off, empty
 * window, failure) simply hides the block — never an error state. The
 * footer note names the model that wrote the bullets (`summary.model`,
 * via the `aiNoteWithModel` i18n key; plain `aiNote` when unknown) plus
 * either how long generation took (`generatedIn`, from the client-measured
 * elapsed fetch time) or `servedFromCache` for a cache hit. While loading,
 * a once-a-second elapsed clock (`formatMs`) and a duration-expectation
 * note (`loadingNote` — first view summarizes each day once, repeat views
 * are instant) keep a cold multi-week generation reading as progress
 * rather than a hang. The
 * summary always describes the full fetched window, NOT the hour-window
 * zoom's sub-window — it's a per-window synthesis cached server-side, not
 * a re-generatable per-zoom view (the `windowScopedNote` line already tells
 * the reader when the tiles/list below are narrower).
 *
 * The summary block LEADS with a live "currently active" status
 * (`resolveActiveFocuses`) — rendered first, above the historical AI bullets,
 * so what's happening right now never gets buried under what already
 * happened. One entry per still-open report session (`ended_at === null`)
 * that has a declared focus in the shared `focusStore` (`useFocusMap`, the
 * same WebSocket-kept-current data `SessionCard`'s breadcrumb reads), naming
 * what it's working on (item text, or the top detour's title/description) on
 * its own line, then a dash-indented sub-line below reading "— Active
 * <duration> · updated <time>" with both time values colored (`text-accent`)
 * so they stand out from the surrounding text — the duration ticks off
 * THAT specific item/detour's own anchor (`SessionFocus.since`/the top
 * detour's `pushed_at`, every 30s), and the timestamp is when the focus
 * itself last changed (`SessionFocus.updated_at`) — deliberately NOT derived
 * from the AI summary's own bullets, so it's never stale just because the
 * LLM synthesis is cached or slow. A session with no declared focus is
 * skipped (mirrors `SessionCard` — no invented status), and zero
 * active-with-focus sessions renders `noActiveWork` instead of nothing, so
 * the block always answers "are we working on something right now" once
 * it's showing at all. Renders (and keeps the whole block visible) even when
 * the AI summary itself is `null`/unavailable, since this section needs no
 * LLM. A bottom border separates it from the historical bullets/loading
 * state that follow, when either is present.
 *
 * Also offers the same intraday "hour-window zoom" as the Calendar page
 * (`useHourWindowZoom`/`HourWindowZoomBar`, extracted out of
 * `FocusCalendarView.tsx` so both pages share the identical control) —
 * duration presets (4h/8h/12h/24h), a start-time stepper/typed input, a
 * "Live" toggle, and quick-start presets. Anchored to `selectedDate`, the
 * same `timeWindow.mode === "day" ? timeWindow.date : timeWindow.start`
 * derivation `FocusCalendarBoard.tsx` already uses — so a custom multi-day
 * range's zoom narrows within the range's own *start* day, matching the
 * Board's existing behavior rather than inventing new semantics here. When
 * zoomed, BOTH the stat tiles (`computeWindowedTotals`, same substitution
 * `FocusReportBody` already does) AND the activity list below
 * (`groupFocusActivity`'s optional `window` param) are scoped together —
 * never just one, which would silently disagree with the other.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Focus as FocusIcon, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { DAY_MS, startOfDay } from "../lib/calendarWindow";
import { formatMs, formatModelName, formatTime } from "../lib/format";
import { groupFocusActivity } from "../lib/focusActivity";
import { computeWindowedTotals } from "../lib/windowedTotals";
import { useFocusMap } from "../lib/focusStore";
import { focusKind, FOCUS_KIND_CONFIG } from "../lib/types";
import type {
  FocusReport,
  FocusReportSegment,
  FocusSegmentKind,
  FocusWindowSummary,
  Project,
  Session,
} from "../lib/types";
import { ProjectScopeFilters } from "../components/ProjectScopeFilters";
import { StatTile } from "../components/StatTile";
import { ConcurrencyStatTile } from "../components/ConcurrencyStatTile";
import { FocusActivityCard } from "../components/FocusActivityCard";
import { FOCUS_KIND_ICONS } from "../components/PlanModal";
import { TimePeriodPicker } from "../components/TimePeriodPicker";
import type { TimePeriodValue } from "../components/TimePeriodPicker";
import { HourWindowZoomBar } from "../components/HourWindowZoomBar";
import { useHourWindowZoom } from "../hooks/useHourWindowZoom";

/** Derives the `[from, to)` ISO-8601 instant bounds `api.focusReport` always
 *  requires from the page's own `TimePeriodValue` — identical to
 *  `FocusCalendarBoard.tsx`'s own `windowBounds`, duplicated rather than
 *  imported since it's a few lines of pure `startOfDay`/`DAY_MS` math, not a
 *  meaningfully shared abstraction. */
function windowBounds(tw: TimePeriodValue): { from: string; to: string } {
  if (tw.mode === "day") {
    const start = startOfDay(tw.date);
    return { from: start.toISOString(), to: new Date(start.getTime() + DAY_MS).toISOString() };
  }
  const start = startOfDay(tw.start);
  const end = startOfDay(tw.end);
  return { from: start.toISOString(), to: new Date(end.getTime() + DAY_MS).toISOString() };
}

/** "Claude Sonnet" / "Claude Sonnet 5" from a raw model alias/id — the
 *  display form both summary-block notes use. `formatModelName` title-cases
 *  ("sonnet" → "Sonnet", "claude-sonnet-5" → "Claude Sonnet 5"); the Claude
 *  prefix is added only when not already present, so an alias never renders
 *  as a bare "Sonnet" and a full id never doubles up as "Claude Claude …". */
function claudeModelLabel(model: string | null): string | null {
  const formatted = formatModelName(model);
  if (!formatted) return null;
  return formatted.startsWith("Claude") ? formatted : `Claude ${formatted}`;
}

/** The ISO timestamp of the last {@link FocusReportSegment} chunk that
 *  carried real hook activity (`chunks[i].active`, the same 10-minute-
 *  granularity signal the idle stripes elsewhere in this app are drawn
 *  from) — i.e. the most recent moment this segment can honestly claim
 *  something actually happened, as distinct from merely "the segment is
 *  still technically open." Falls back to the segment's own `start` when it
 *  carries no chunks (older/fixture data) or none are active — the segment
 *  has opened but nothing's been confirmed inside it yet. */
function lastActiveTimestamp(segment: FocusReportSegment): string {
  const chunks = segment.chunks ?? [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk?.active) return chunk.end;
  }
  return segment.start;
}

/** One still-running session's live "what are we working on right now" line
 *  for the summary block's leading status — see {@link resolveActiveFocuses}. */
interface ActiveFocusStatus {
  sessionId: string;
  /** Resolved project name, only set when `showProjectLabel` (all-projects
   *  scope) — mirrors `FocusActivityCard`'s own project-prefix gating. */
  projectLabel: string | undefined;
  /** Which {@link FOCUS_KIND_CONFIG}/{@link FOCUS_KIND_ICONS} chip to render
   *  ahead of `what` — from the live declared focus when one resolved, else
   *  the report's own latest segment's kind (including the `"none"`
   *  sentinel), so detour/off-plan work a session hasn't (yet) run `ccam
   *  focus` for still reads as a distinct, badged kind rather than plain
   *  text indistinguishable from a declared item. */
  kind: FocusSegmentKind;
  /** Human-readable "what": the item text, or the top detour's title/
   *  description, prefixed with "Item N: " for a declared item; falls back
   *  to the report segment's own label (or `noFocusWhat` for `"none"`) when
   *  there's no live declaration. */
  what: string;
  /** ISO timestamp this stretch of work STARTED: the live declaration's own
   *  anchor (top detour's `pushed_at`, else the item's `since`) when
   *  declared, else the report's latest segment `start` for an undeclared
   *  session — the same "deepest current segment" anchor `SessionCard`'s own
   *  breadcrumb uses, or its report-only equivalent. Wall-clock elapsed
   *  (rendered live, ticking off `nowMs`) is computed from this. */
  startedAt: string;
  /** The report's own latest segment `active_ms` — real, idle-grace-
   *  discounted agent time within that segment, AS OF THE LAST REPORT FETCH
   *  (unlike the wall-clock figure, this does not tick live between
   *  fetches — there's no honest way to extrapolate it forward without
   *  assuming continued activity, which is exactly the assumption this
   *  redesign exists to avoid making silently). */
  activeMs: number;
  /** ISO timestamp of the most recent CONFIRMED real activity — see
   *  {@link lastActiveTimestamp} — as distinct from `startedAt` (when this
   *  stretch began) or "now" (which would wrongly imply the segment being
   *  technically still open means something is still happening). */
  lastActivityAt: string;
}

/**
 * Cross-references the report's still-open sessions (`ended_at === null` —
 * already scoped to the current project/session filters and time window by
 * the server) against the live `focusStore` map to find, for each one, what
 * it's currently declared to be working on. A session with no live
 * declaration (or a bare note with neither item nor detour) does NOT get
 * skipped — it falls back to the report's own latest segment for that
 * session, which the server guarantees always exists (a background-
 * classifier verdict when one's available, otherwise the `"none"` sentinel
 * spanning the whole still-open session — see `FocusReportSessionEntry`'s own
 * file header). This is what keeps a session genuinely doing detour/off-plan
 * work visible here even before it's declared or been classified, rather
 * than reading identically to a session that's actually idle.
 *
 * Every entry's wall-clock/active-time/started/last-activity facts come from
 * that same latest report segment regardless of whether a live declaration
 * resolved (only `what`/`kind` prefer the live declaration when one exists) —
 * a live `ccam focus` record only carries a "since"/`updated_at`, not a
 * measured active/idle split or a real per-chunk activity trail, so mixing
 * sources for the numbers would silently disagree with the report between
 * fetches. An empty result means no session in the report is currently open
 * at all.
 */
function resolveActiveFocuses(
  report: FocusReport,
  focusMap: ReturnType<typeof useFocusMap>,
  showProjectLabel: boolean,
  projectLabelForCwd: (cwd: string | null) => string | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): ActiveFocusStatus[] {
  const out: ActiveFocusStatus[] = [];
  for (const session of report.sessions) {
    if (session.ended_at !== null) continue;
    const projectLabel = showProjectLabel ? projectLabelForCwd(session.cwd) : undefined;
    const lastSegment = session.segments[session.segments.length - 1];
    if (!lastSegment) continue; // defensive only - the report always provides one
    const activeMs = lastSegment.active_ms;
    const lastActivityAt = lastActiveTimestamp(lastSegment);

    const focus = focusMap.get(session.session_id);
    const liveKind = focusKind(focus);
    if (focus && liveKind) {
      const topDetour = focus.detour_stack[focus.detour_stack.length - 1];
      const itemPrefix =
        liveKind === "item" && focus.item_number != null
          ? `${t("focus.itemLabel", { number: focus.item_number })}: `
          : "";
      const body =
        liveKind === "item"
          ? (focus.item_text ?? t("focus.unknownItem"))
          : (topDetour?.title ?? topDetour?.description ?? "");
      out.push({
        sessionId: session.session_id,
        projectLabel,
        kind: liveKind,
        what: `${itemPrefix}${body}`,
        startedAt: topDetour?.pushed_at ?? focus.since ?? focus.updated_at,
        activeMs,
        lastActivityAt,
      });
      continue;
    }

    // No live declaration - fall back to the report's own latest segment
    // (never absent, per FocusReportSessionEntry's guarantee) so this
    // session is never silently omitted just because it hasn't called
    // `ccam focus` yet.
    const itemPrefix =
      lastSegment.kind === "item" && lastSegment.item_number != null
        ? `${t("focus.itemLabel", { number: lastSegment.item_number })}: `
        : "";
    const body =
      lastSegment.kind === "none"
        ? t("report.summaryBlock.noFocusWhat")
        : (lastSegment.label ?? t("focus.unknownItem"));
    out.push({
      sessionId: session.session_id,
      projectLabel,
      kind: lastSegment.kind,
      what: `${itemPrefix}${body}`,
      startedAt: lastSegment.start,
      activeMs,
      lastActivityAt,
    });
  }
  return out;
}

/** The "what did we actually do" Focus report page — see file header. */
export function FocusPage() {
  const { t } = useTranslation("plan");

  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  // Independent filters, same shape/semantics as FocusCalendarBoard.
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimePeriodValue>(() => ({
    mode: "day",
    date: startOfDay(new Date()),
  }));

  const [report, setReport] = useState<FocusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Independent, non-blocking summary fetch - see file header.
  const [summary, setSummary] = useState<FocusWindowSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  // Live elapsed clock for the summary fetch: ticks once a second while
  // loading (a cold multi-week window legitimately takes a minute-plus, so
  // the wait needs to read as progress, not a hang), then freezes at the
  // exact total so the finished block can say how long generation took.
  const [summaryElapsedMs, setSummaryElapsedMs] = useState(0);
  // The model the next generation would use - fetched once so the loading
  // state can already say "using Claude X" before any summary arrives.
  const [configuredModel, setConfiguredModel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .focusReportSummaryConfig()
      .then((res) => {
        if (!cancelled) setConfiguredModel(res.model);
      })
      .catch(() => {
        /* purely cosmetic - the plain loading string covers the gap */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.projects.list().then((res) => {
      if (!cancelled) setProjects(res.projects);
    });
    api.sessions.list({ limit: 10000 }).then((res) => {
      if (!cancelled) setSessions(res.sessions);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cwdToProjectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      for (const path of project.paths) {
        map.set(path.cwd, project.name);
      }
    }
    return map;
  }, [projects]);

  const projectLabelForCwd = useCallback(
    (cwd: string | null) => (cwd ? cwdToProjectName.get(cwd) : undefined),
    [cwdToProjectName]
  );

  const cwdToProjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      for (const path of project.paths) {
        map.set(path.cwd, project.id);
      }
    }
    return map;
  }, [projects]);

  const activeProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of report?.sessions ?? []) {
      const id = session.cwd ? cwdToProjectId.get(session.cwd) : undefined;
      if (id) ids.add(id);
    }
    return ids;
  }, [report, cwdToProjectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const { from, to } = windowBounds(timeWindow);
    api
      .focusReport({
        projectId: unassignedOnly ? undefined : projectId,
        sessionId,
        unassigned: unassignedOnly,
        from,
        to,
      })
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, sessionId, unassignedOnly, timeWindow]);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setSummaryLoading(true);
    setSummaryElapsedMs(0);
    const startedAt = Date.now();
    const ticker = window.setInterval(() => {
      setSummaryElapsedMs(Date.now() - startedAt);
    }, 1000);
    const { from, to } = windowBounds(timeWindow);
    api
      .focusReportSummary({
        projectId: unassignedOnly ? undefined : projectId,
        sessionId,
        unassigned: unassignedOnly,
        from,
        to,
      })
      .then((res) => {
        if (!cancelled) setSummary(res.summary);
      })
      .catch(() => {
        if (!cancelled) setSummary(null); // unavailable, never an error state
      })
      .finally(() => {
        window.clearInterval(ticker);
        if (!cancelled) {
          setSummaryElapsedMs(Date.now() - startedAt); // freeze at the exact total
          setSummaryLoading(false);
        }
      });
    return () => {
      cancelled = true;
      window.clearInterval(ticker);
    };
  }, [projectId, sessionId, unassignedOnly, timeWindow]);

  const showProjectLabel = projectId === undefined && !unassignedOnly;

  // Same intraday hour-window zoom as the Calendar page - anchored to the
  // custom range's own START day, matching FocusCalendarBoard.tsx's existing
  // `selectedDate` derivation exactly (not new semantics invented here).
  // Defaults to 24h (unzoomed/full period) rather than the Calendar's own 4h
  // default - this page previously always showed the whole selected
  // day/range, so the zoom here is a purely additive, opt-in narrowing
  // rather than a silent change to what loads by default.
  const selectedDate = timeWindow.mode === "day" ? timeWindow.date : timeWindow.start;
  const zoom = useHourWindowZoom(selectedDate, { defaultHourWindow: 24 });
  const visibleWindow = zoom.zoomable
    ? { startMs: zoom.windowStartMs, endMs: zoom.windowEndMs }
    : null;

  return (
    <div className="-mx-5 lg:-mx-6 px-[25px] space-y-5">
      <div className="flex items-center gap-2">
        <FocusIcon className="w-5 h-5 text-accent flex-shrink-0" />
        <h1 className="text-lg font-semibold text-gray-100">{t("report.activityBoard.title")}</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <ProjectScopeFilters
          projects={projects}
          sessions={sessions}
          activeProjectIds={activeProjectIds}
          projectId={projectId}
          sessionId={sessionId}
          unassignedOnly={unassignedOnly}
          projectsExpanded={projectsExpanded}
          onProjectsExpandedChange={setProjectsExpanded}
          onSelectProject={(id) => {
            setProjectId(id);
            setUnassignedOnly(false);
          }}
          onSelectUnassigned={() => {
            setProjectId(undefined);
            setUnassignedOnly(true);
          }}
          onSessionChange={setSessionId}
        />

        <TimePeriodPicker value={timeWindow} onChange={setTimeWindow} />
      </div>

      <HourWindowZoomBar {...zoom} />

      <div className="card p-5 space-y-6">
        {loading && (
          <p className="text-xs text-gray-500 italic py-6 text-center">{t("report.loading")}</p>
        )}
        {!loading && failed && (
          <p className="text-xs text-rose-400 py-6 text-center">{t("report.error")}</p>
        )}
        {!loading && !failed && report && report.sessions.length === 0 && (
          <p className="text-xs text-gray-500 italic py-6 text-center">{t("report.empty")}</p>
        )}
        {!loading && !failed && report && report.sessions.length > 0 && (
          <FocusPageBody
            report={report}
            projectLabelForCwd={projectLabelForCwd}
            showProjectLabel={showProjectLabel}
            visibleWindow={visibleWindow}
            summary={summary}
            summaryLoading={summaryLoading}
            summaryElapsedMs={summaryElapsedMs}
            configuredModel={configuredModel}
          />
        )}
      </div>
    </div>
  );
}

/** Stat tiles plus the activity card, both scoped to `visibleWindow` when the
 *  hour-window zoom is active (`null` reads `report`'s own already-fetched
 *  totals unchanged, same as before this existed) - mirrors
 *  `FocusReportBody`'s own established `computeWindowedTotals` substitution
 *  pattern exactly, so the same window/scope reads the same numbers whether
 *  viewed here or on the Calendar page. Split out of `FocusPage` only to keep
 *  that component's own data-fetching/filter-state focused. */
function FocusPageBody({
  report,
  projectLabelForCwd,
  showProjectLabel,
  visibleWindow,
  summary,
  summaryLoading,
  summaryElapsedMs,
  configuredModel,
}: {
  report: FocusReport;
  projectLabelForCwd: (cwd: string | null) => string | undefined;
  showProjectLabel: boolean;
  visibleWindow: { startMs: number; endMs: number } | null;
  summary: FocusWindowSummary | null;
  summaryLoading: boolean;
  summaryElapsedMs: number;
  configuredModel: string | null;
}) {
  const { t } = useTranslation("plan");

  const windowed = visibleWindow
    ? computeWindowedTotals(report, visibleWindow.startMs, visibleWindow.endMs)
    : null;
  const totals = windowed?.totals ?? report.totals;
  const wallClockMs = windowed?.wallClockMs ?? report.wall_clock_ms;
  const concurrencyRatio = windowed ? windowed.concurrencyRatio : report.concurrency_ratio;
  // Optional on FocusReport (older/cached responses may lack it) - the sub
  // line simply doesn't render when there's nothing to show.
  const activeConcurrencyRatio = windowed
    ? windowed.activeConcurrencyRatio
    : (report.active_concurrency_ratio ?? null);
  const activeWallClockMs = windowed
    ? windowed.activeWallClockMs
    : (report.active_wall_clock_ms ?? null);
  const windowHours = visibleWindow
    ? Math.round((visibleWindow.endMs - visibleWindow.startMs) / 3_600_000)
    : null;

  const onItemPct =
    totals.active_ms > 0 ? Math.round((totals.by_kind.item.active_ms / totals.active_ms) * 100) : 0;
  const graceLabel =
    report.idle_grace_seconds > 0
      ? formatMs(report.idle_grace_seconds * 1000)
      : t("report.graceDisabled");

  const entries = useMemo(
    () => groupFocusActivity(report, projectLabelForCwd, visibleWindow ?? undefined),
    [report, projectLabelForCwd, visibleWindow]
  );

  // Live "what's actively being worked on right now" status rendered as the
  // summary block's LEADING line(s), ahead of the (possibly cached) AI
  // summary bullets below it. Sourced from the shared focusStore (the same
  // live, WebSocket-kept-current data SessionCard's breadcrumb reads), not
  // the report's own segments, so it's never stale just because a report
  // window hasn't been refetched.
  const focusMap = useFocusMap();
  // Tick every 30s so the "active for Nm" duration stays current without a
  // full report refetch - same cadence SessionOverview's own duration tile
  // uses for the same reason.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const activeFocuses = useMemo(
    () => resolveActiveFocuses(report, focusMap, showProjectLabel, projectLabelForCwd, t),
    [report, focusMap, showProjectLabel, projectLabelForCwd, t]
  );

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-border rounded-lg overflow-hidden border border-border">
        <StatTile
          label={t("report.activeTime")}
          value={formatMs(totals.active_ms)}
          sub={t("report.ofWallClock", { total: formatMs(wallClockMs) })}
        />
        <ConcurrencyStatTile
          concurrencyRatio={concurrencyRatio}
          activeConcurrencyRatio={activeConcurrencyRatio}
          wallClockMs={wallClockMs}
          activeWallClockMs={activeWallClockMs}
        />
        <StatTile
          label={t("report.onItem")}
          value={`${onItemPct}%`}
          valueClassName="text-green-400"
        />
        <StatTile label={t("report.offPlan")} value={`${Math.max(0, 100 - onItemPct)}%`} />
        <StatTile
          label={t("report.idleExcluded")}
          value={formatMs(totals.idle_ms)}
          sub={t("report.idleExcludedSub")}
        />
      </div>
      {report.idle_grace_seconds >= 0 && (
        <p className="text-[11px] text-gray-600 -mt-3">
          {t("report.graceNote", { grace: graceLabel })}
        </p>
      )}
      {windowHours != null && (
        <p className="text-[11px] text-gray-600 -mt-3">
          {t("report.windowScopedNote", { hours: windowHours })}
        </p>
      )}

      {(summaryLoading || summary || activeFocuses.length > 0) && (
        <div data-testid="focus-window-summary" className="border border-border rounded-lg p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold text-gray-200 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-accent flex-shrink-0" aria-hidden="true" />
            {t("report.summaryBlock.title")}
          </h2>
          {!summaryLoading && (activeFocuses.length > 0 || summary) && (
            <div
              data-testid="focus-summary-active"
              className={`space-y-2.5 text-xs text-gray-300 ${
                summary || summaryLoading ? "mb-3 pb-3 border-b border-border/60" : ""
              }`}
            >
              {activeFocuses.length > 0 ? (
                activeFocuses.map((a) => {
                  const cfg = FOCUS_KIND_CONFIG[a.kind];
                  const KindIcon = FOCUS_KIND_ICONS[a.kind];
                  return (
                    <div key={a.sessionId} className="max-w-[72ch]">
                      <p className="flex items-start gap-1.5 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 flex-shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${cfg.bg} ${cfg.color}`}
                        >
                          <KindIcon className="w-3 h-3" aria-hidden="true" />
                          {t(cfg.labelKey)}
                        </span>
                        <span>
                          {t(
                            a.projectLabel
                              ? "report.summaryBlock.activeNowScoped"
                              : "report.summaryBlock.activeNow",
                            { project: a.projectLabel, what: a.what }
                          )}
                        </span>
                      </p>
                      <p className="pl-4 mt-0.5 text-[11px] text-gray-500">
                        {"— "}
                        {t("report.wallClockLabel")}{" "}
                        <span className="font-mono font-semibold text-accent">
                          {formatMs(Math.max(0, nowMs - Date.parse(a.startedAt)))}
                        </span>
                        {" · "}
                        {t("report.activeLabel")}{" "}
                        <span className="font-mono font-semibold text-accent">
                          {formatMs(a.activeMs)}
                        </span>
                      </p>
                      <p className="pl-4 mt-0.5 text-[11px] text-gray-500">
                        {t("report.summaryBlock.startedLabel")}{" "}
                        <span className="font-mono font-semibold text-accent">
                          {formatTime(a.startedAt)}
                        </span>
                        {" · "}
                        {t("report.summaryBlock.lastActivityLabel")}{" "}
                        <span className="font-mono font-semibold text-accent">
                          {formatTime(a.lastActivityAt)}
                        </span>
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="max-w-[72ch]">{t("report.summaryBlock.noActiveWork")}</p>
              )}
            </div>
          )}
          {summaryLoading &&
            (() => {
              const label = claudeModelLabel(configuredModel);
              return (
                <>
                  <p className="text-xs text-gray-500 italic">
                    {label
                      ? t("report.summaryBlock.loadingWithModel", { model: label })
                      : t("report.summaryBlock.loading")}
                    <span className="ml-2 font-mono not-italic text-gray-400">
                      {formatMs(summaryElapsedMs)}
                    </span>
                  </p>
                  <p className="text-[10px] text-gray-600 mt-1.5 max-w-[62ch]">
                    {t("report.summaryBlock.loadingNote")}
                  </p>
                </>
              );
            })()}
          {!summaryLoading && summary && (
            <>
              <div className="space-y-3">
                {summary.groups.map((group) => (
                  <div key={group.project_id ?? "unassigned"}>
                    {showProjectLabel && (
                      <h3
                        data-testid="focus-summary-group-label"
                        className="text-[11px] font-semibold text-gray-400 mb-1"
                      >
                        {group.project_name ?? t("projects:unassigned")}
                      </h3>
                    )}
                    <ul className="space-y-1.5 list-disc pl-4 text-xs text-gray-300">
                      {group.bullets.map((bullet, i) => (
                        <li key={i} className="max-w-[72ch]">
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-600 mt-2">
                {claudeModelLabel(summary.groups[0]?.model ?? null)
                  ? t("report.summaryBlock.aiNoteWithModel", {
                      model: claudeModelLabel(summary.groups[0]?.model ?? null),
                    })
                  : t("report.summaryBlock.aiNote")}
                {" · "}
                {summary.groups.every((group) => group.cached)
                  ? t("report.summaryBlock.servedFromCache")
                  : t("report.summaryBlock.generatedIn", {
                      duration: formatMs(summaryElapsedMs),
                    })}
              </p>
            </>
          )}
        </div>
      )}

      <FocusActivityCard entries={entries} showProjectLabel={showProjectLabel} />
    </>
  );
}
