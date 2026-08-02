/**
 * @file ProjectManager.tsx
 * @description Layer-7 portfolio rollup page (route `/project-manager`,
 * sidebar "Project Manager"): one page answering "what's going on across
 * every project I'm tracking" — milestone/pace progress per project
 * (`server/lib/portfolio.js`, `GET /api/portfolio/summary`), the layer-6
 * reconciliation decision queue awaiting a human call (`GET
 * /api/decision-queue`), a cross-project pace-watch rail of behind items, and
 * a recently-resolved log (the same queue rows, filtered to non-pending).
 *
 * Composes three independent fetches (`api.projects.list`,
 * `api.portfolio.summary`, `api.decisionQueue.list`) rather than one combined
 * endpoint, mirroring `Projects.tsx`'s own `Promise.all(...)` pattern — each
 * already has its own single-responsibility owner server-side. This page
 * only renders what those endpoints computed; it never re-derives pace or
 * completion itself (PROJECT-CONTEXT.md §9.1 DERIVED-DUAL-VIEW).
 *
 * Clicking a project's row in the rollup table navigates to its full
 * {@link ProjectDetail} page (`/projects/:id`) — the same destination as the
 * "open detail" icon on that project's row in `Projects.tsx`.
 *
 * A `detour_disposition` queue row resolves through `api.detours.resolve`
 * (fold_in/new_item/deliberate/discard — the full layer-4 lifecycle;
 * fold_in/new_item synchronously write into the cwd's `AGENT-PLAN.md`).
 * Every other kind resolves through `api.decisionQueue.resolve`
 * (resolve/dismiss/retry_write). Both re-fetch on success rather than
 * optimistically patching local state, so a concurrent reconciliation tick
 * can never be silently clobbered by a stale client-side merge.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Milestone,
  AlertTriangle,
  GitBranch,
  CornerDownRight,
  RefreshCw,
  Target,
  Inbox,
  Check,
  X,
  Flag,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { EmptyState } from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import { timeAgo } from "../lib/format";
import type {
  DecisionQueueItem,
  DecisionQueueKind,
  DetourDispositionValue,
  PortfolioProjectSummary,
  Project,
  WSMessage,
} from "../lib/types";

const KIND_ICON: Record<DecisionQueueKind, LucideIcon> = {
  pace_alert: AlertTriangle,
  detour_volume: GitBranch,
  detour_disposition: CornerDownRight,
  writeback_conflict: RefreshCw,
  writeback_failed: RefreshCw,
};

const KIND_BADGE_CLASS: Record<DecisionQueueKind, string> = {
  pace_alert: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  detour_volume: "bg-accent-muted border-accent/30 text-accent-hover",
  detour_disposition: "bg-surface-4 border-border-light text-gray-300",
  writeback_conflict: "bg-red-500/10 border-red-500/30 text-red-400",
  writeback_failed: "bg-red-500/10 border-red-500/30 text-red-400",
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function proposedTextFor(row: DecisionQueueItem): string {
  const payload = row.payload as { verdict?: { proposed_text?: string | null } } | null;
  return payload?.verdict?.proposed_text || "";
}

function paceCounts(summary: PortfolioProjectSummary | undefined) {
  return summary?.pace.counts ?? { no_target: 0, on_track: 0, behind: 0, done: 0 };
}

export function ProjectManager() {
  const { t } = useTranslation("projectManager");
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioProjectSummary[]>([]);
  const [queue, setQueue] = useState<DecisionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<string>("all");
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});
  const [draftText, setDraftText] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const [projectsRes, portfolioRes, queueRes] = await Promise.all([
        api.projects.list(),
        api.portfolio.summary(),
        api.decisionQueue.list({ limit: 200 }),
      ]);
      setProjects(projectsRes.projects);
      setPortfolio(portfolioRes.projects);
      setQueue(queueRes.queue);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Degrades safely if a push is missed or delayed: the next relevant event
  // (or a manual navigation back to this page) still triggers a fresh fetch,
  // and every render here reflects the last successful load, never a
  // partially-applied local patch.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    return eventBus.subscribe((msg: WSMessage) => {
      if (
        msg.type === "session_created" ||
        msg.type === "session_updated" ||
        msg.type === "session_deleted" ||
        msg.type === "plan_updated" ||
        msg.type === "decision_queue_updated" ||
        msg.type === "detour_disposition"
      ) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(load, 300);
      }
    });
  }, [load]);

  const portfolioByProject = useMemo(
    () => new Map(portfolio.map((p) => [p.project_id, p])),
    [portfolio]
  );
  const projectName = useCallback(
    (projectId: string | null) =>
      projects.find((p) => p.id === projectId)?.name ?? t("resolved.title"),
    [projects, t]
  );

  const pendingQueue = useMemo(() => queue.filter((q) => q.status === "pending"), [queue]);
  const resolvedQueue = useMemo(
    () =>
      queue
        .filter((q) => q.status !== "pending")
        .sort((a, b) => (b.resolved_at || "").localeCompare(a.resolved_at || ""))
        .slice(0, 8),
    [queue]
  );

  const scopedProjects = scope === "all" ? projects : projects.filter((p) => p.id === scope);
  const scopedQueue =
    scope === "all" ? pendingQueue : pendingQueue.filter((q) => q.project_id === scope);
  const scopedResolved =
    scope === "all" ? resolvedQueue : resolvedQueue.filter((q) => q.project_id === scope);

  const behindItems = useMemo(() => {
    const rows: Array<{
      projectId: string;
      item: PortfolioProjectSummary["pace"]["behind"][number];
    }> = [];
    for (const p of portfolio) {
      if (scope !== "all" && p.project_id !== scope) continue;
      for (const item of p.pace.behind) rows.push({ projectId: p.project_id, item });
    }
    return rows.sort((a, b) => b.item.days_overdue - a.item.days_overdue);
  }, [portfolio, scope]);

  const totalBehind = useMemo(
    () => portfolio.reduce((sum, p) => sum + p.pace.counts.behind, 0),
    [portfolio]
  );
  const detoursResolved7d = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return queue.filter(
      (q) =>
        q.kind === "detour_disposition" &&
        q.status !== "pending" &&
        q.resolved_at &&
        new Date(q.resolved_at).getTime() >= cutoff
    ).length;
  }, [queue]);

  async function runAction(id: number, run: () => Promise<unknown>) {
    setPendingActionId(id);
    try {
      await run();
      setActionErrors((prev) => ({ ...prev, [id]: "" }));
      await load();
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setPendingActionId(null);
    }
  }

  const handleQueueResolve = (id: number, action: "resolve" | "dismiss" | "retry_write") =>
    runAction(id, () => api.decisionQueue.resolve(id, action));

  const handleDetourResolve = (row: DecisionQueueItem, disposition: DetourDispositionValue) => {
    if (row.ref_id == null) return;
    const text = draftText[row.id];
    runAction(row.id, () =>
      api.detours.resolve(row.ref_id as number, {
        disposition,
        ...(disposition === "fold_in" || disposition === "new_item"
          ? { proposed_text: text || proposedTextFor(row) }
          : {}),
      })
    );
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">{t("title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("subtitle")}</p>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <CardSkeleton key={i} className="h-20" />
          ))}
        </div>
        <CardSkeleton className="h-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CardSkeleton className="h-64 lg:col-span-2" />
          <CardSkeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center flex-shrink-0">
          <Milestone className="w-4 h-4 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-100">{t("title")}</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">{t("subtitle")}</p>
        </div>
      </div>

      {error && <div className="badge bg-red-500/10 border-red-500/30 text-red-400">{error}</div>}

      {projects.length === 0 ? (
        <EmptyState icon={Milestone} title={t("rollup.title")} description={t("rollup.empty")} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                scope === "all"
                  ? "bg-accent-muted border-accent/30 text-accent-hover"
                  : "bg-surface-2 border-border text-gray-400 hover:text-gray-200"
              }`}
            >
              {t("scope.all")}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setScope(p.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  scope === p.id
                    ? "bg-accent-muted border-accent/30 text-accent-hover"
                    : "bg-surface-2 border-border text-gray-400 hover:text-gray-200"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile label={t("kpi.projectsTracked")} value={String(projects.length)} />
            <KpiTile
              label={t("kpi.itemsBehindPace")}
              value={String(totalBehind)}
              tone={totalBehind > 0 ? "warn" : undefined}
            />
            <KpiTile
              label={t("kpi.openDecisions")}
              value={String(pendingQueue.length)}
              tone={pendingQueue.length > 0 ? "warn" : undefined}
            />
            <KpiTile label={t("kpi.detoursResolved")} value={String(detoursResolved7d)} />
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-gray-200">{t("rollup.title")}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2 font-semibold">{t("rollup.project")}</th>
                    <th className="px-4 py-2 font-semibold">{t("rollup.progress")}</th>
                    <th className="px-4 py-2 font-semibold">{t("rollup.milestones")}</th>
                    <th className="px-4 py-2 font-semibold">{t("rollup.pace")}</th>
                    <th className="px-4 py-2 font-semibold">{t("rollup.openDecisions")}</th>
                    <th className="px-4 py-2 font-semibold">{t("rollup.lastActivity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedProjects.map((project) => {
                    const summary = portfolioByProject.get(project.id);
                    const counts = paceCounts(summary);
                    const milestones = summary?.milestones ?? { done: 0, total: 0 };
                    const pct =
                      milestones.total > 0
                        ? Math.round((milestones.done / milestones.total) * 100)
                        : null;
                    const openCount = pendingQueue.filter(
                      (q) => q.project_id === project.id
                    ).length;
                    return (
                      <tr
                        key={project.id}
                        onClick={() => navigate(`/projects/${project.id}`)}
                        className="border-t border-border hover:bg-surface-4 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-100">{project.name}</div>
                        </td>
                        <td className="px-4 py-3">
                          {pct === null ? (
                            <span className="text-gray-500">{t("rollup.noPlan")}</span>
                          ) : (
                            <div className="flex items-center gap-2 min-w-[9rem]">
                              <div className="flex-1 h-1.5 rounded-full bg-surface-5 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-accent"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs text-gray-300 w-9 text-right">
                                {pct}%
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-400">
                          {milestones.done} / {milestones.total}
                        </td>
                        <td className="px-4 py-3">
                          <PaceBadge counts={counts} t={t} />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`badge ${
                              openCount > 0
                                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                                : "bg-surface-4 border-border-light text-gray-400"
                            }`}
                          >
                            {openCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {project.last_activity ? timeAgo(project.last_activity) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="card overflow-hidden lg:col-span-2">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  <Inbox className="w-4 h-4 text-gray-400" />
                  {t("queue.title")}
                </h2>
                <span className="count-badge font-mono text-xs text-accent-hover bg-accent-muted-2 border border-accent/25 rounded-full px-2 py-0.5">
                  {t("queue.openCount", { count: scopedQueue.length })}
                </span>
              </div>
              {scopedQueue.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("queue.empty")}
                </div>
              ) : (
                <div>
                  {scopedQueue.map((row) => (
                    <QueueCard
                      key={row.id}
                      row={row}
                      projectLabel={projectName(row.project_id)}
                      busy={pendingActionId === row.id}
                      error={actionErrors[row.id]}
                      draftText={draftText[row.id] ?? proposedTextFor(row)}
                      onDraftChange={(value) =>
                        setDraftText((prev) => ({ ...prev, [row.id]: value }))
                      }
                      onResolve={(action) => handleQueueResolve(row.id, action)}
                      onDetourResolve={(disposition) => handleDetourResolve(row, disposition)}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                    <Target className="w-4 h-4 text-gray-400" />
                    {t("pace.title")}
                  </h2>
                </div>
                {behindItems.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-500">
                    {t("pace.empty")}
                  </div>
                ) : (
                  <div>
                    {behindItems.map(({ projectId, item }) => (
                      <div
                        key={`${item.cwd}-${item.item_id}`}
                        className="flex items-start gap-3 px-4 py-3 border-t border-border first:border-t-0"
                      >
                        <div className="w-6 h-6 rounded-md bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm text-gray-200">
                            <span className="font-medium text-gray-100">
                              {projectName(projectId)}
                            </span>{" "}
                            — {item.text}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            <span className="font-mono">{item.target_date}</span> ·{" "}
                            <span className="font-mono text-amber-400">
                              {t("pace.overdue", { count: item.days_overdue })}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                    <CornerDownRight className="w-4 h-4 text-gray-400" />
                    {t("resolved.title")}
                  </h2>
                </div>
                {scopedResolved.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-500">
                    {t("resolved.empty")}
                  </div>
                ) : (
                  <div>
                    {scopedResolved.map((row) => (
                      <div
                        key={row.id}
                        className="flex items-start gap-3 px-4 py-3 border-t border-border first:border-t-0"
                      >
                        <div
                          className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            row.status === "dismissed"
                              ? "bg-surface-4 text-gray-500"
                              : "bg-accent-muted text-accent-hover"
                          }`}
                        >
                          {row.status === "dismissed" ? (
                            <XCircle className="w-3.5 h-3.5" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm text-gray-200">
                            <span className="font-medium text-gray-100">
                              {projectName(row.project_id)}
                            </span>{" "}
                            — {row.message}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {row.resolved_at ? timeAgo(row.resolved_at) : "—"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold font-mono ${tone === "warn" ? "text-amber-400" : "text-gray-100"}`}
      >
        {value}
      </div>
    </div>
  );
}

function PaceBadge({
  counts,
  t,
}: {
  counts: { no_target: number; on_track: number; behind: number; done: number };
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (counts.behind > 0) {
    return (
      <span className="badge bg-amber-500/10 border-amber-500/30 text-amber-400">
        <AlertTriangle className="w-3 h-3" />
        {t("rollup.behind", { count: counts.behind })}
      </span>
    );
  }
  if (counts.done > 0 && counts.on_track === 0 && counts.no_target === 0) {
    return (
      <span className="badge bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
        <Check className="w-3 h-3" />
        {t("rollup.done")}
      </span>
    );
  }
  if (counts.on_track > 0) {
    return (
      <span className="badge bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
        <Check className="w-3 h-3" />
        {t("rollup.onTrack")}
      </span>
    );
  }
  return (
    <span className="badge bg-surface-4 border-border-light text-gray-400">
      {t("rollup.noTarget")}
    </span>
  );
}

function QueueCard({
  row,
  projectLabel,
  busy,
  error,
  draftText,
  onDraftChange,
  onResolve,
  onDetourResolve,
  t,
}: {
  row: DecisionQueueItem;
  projectLabel: string;
  busy: boolean;
  error?: string;
  draftText: string;
  onDraftChange: (value: string) => void;
  onResolve: (action: "resolve" | "dismiss" | "retry_write") => void;
  onDetourResolve: (disposition: DetourDispositionValue) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const Icon = KIND_ICON[row.kind];
  return (
    <div className="px-4 py-3 border-t border-border first:border-t-0 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <span className={`badge ${KIND_BADGE_CLASS[row.kind]}`}>
          <Icon className="w-3 h-3" />
          {t(`queue.kinds.${row.kind}`)}
        </span>
        <span className="text-xs text-gray-500 whitespace-nowrap">{timeAgo(row.created_at)}</span>
      </div>
      <div className="text-xs text-gray-500">
        <span className="text-gray-300 font-medium">{projectLabel}</span>
        {row.cwd ? <span className="font-mono ml-2 text-gray-500">{row.cwd}</span> : null}
      </div>
      <p className="text-sm text-gray-300">{row.message}</p>

      {row.kind === "detour_disposition" && row.ref_id != null && (
        <textarea
          className="input w-full text-xs"
          rows={2}
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={t("queue.actions.newItem")}
        />
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {row.kind === "detour_disposition" && row.ref_id != null ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDetourResolve("fold_in")}
              className="btn-primary disabled:opacity-50"
            >
              {t("queue.actions.foldIn")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDetourResolve("new_item")}
              className="btn-ghost disabled:opacity-50"
            >
              {t("queue.actions.newItem")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDetourResolve("deliberate")}
              className="btn-ghost disabled:opacity-50"
            >
              <Flag className="w-3.5 h-3.5" />
              {t("queue.actions.deliberate")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDetourResolve("discard")}
              className="btn-ghost text-gray-500 hover:text-red-400 disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              {t("queue.actions.discard")}
            </button>
          </>
        ) : row.kind === "writeback_conflict" || row.kind === "writeback_failed" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve("retry_write")}
              className="btn-primary disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("queue.actions.retryWrite")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve("dismiss")}
              className="btn-ghost text-gray-500 hover:text-red-400 disabled:opacity-50"
            >
              {t("queue.actions.dismiss")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve("resolve")}
              className="btn-primary disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              {t("queue.actions.resolve")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve("dismiss")}
              className="btn-ghost text-gray-500 hover:text-red-400 disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              {t("queue.actions.dismiss")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
