/**
 * @file ProjectDetail.tsx
 * @description Dedicated full page for one project (route `/projects/:id`,
 * reached from a Projects row's "open detail" button), for doing sustained
 * work against a single project's plan rather than the Projects page's
 * inline expand strip. Composes four independent fetches — `api.projects`
 * (to resolve the project itself), `api.projects.repos`, `api.projects.intake`,
 * and `api.plans.projectRollup` — mirroring `ProjectManager.tsx`'s own
 * `Promise.all(...)` pattern rather than a combined endpoint, since each
 * already has its own single-responsibility server-side owner.
 *
 * Renders four sections: the project's AGENT-PLAN.md plan(s) (via the
 * existing `PlanPanel`/`PlanModal` — no new plan UI), which of the project's
 * mapped folders are git repos with their live worktrees, sibling repos
 * detected via a mapped repo's own PROJECT-CONTEXT.md that aren't part of
 * the project yet (shown as suggestions only — adding one is an explicit
 * click, never automatic), and team-intake initiatives found under
 * `intake/<slug>/` with a pipeline stage inferred from which delivery-team
 * artifact files exist. The repo/worktree/intake data is computed live by
 * the server on every load (no persistence), so this page always reflects
 * the current filesystem/git state rather than a cached snapshot.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  FolderKanban,
  GitBranch,
  GitFork,
  FolderX,
  Loader2,
  Plus,
  ListChecks,
  GitCommitHorizontal,
  CircleCheck,
  CircleAlert,
  CircleHelp,
} from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import { PlanPanel } from "../components/PlanPanel";
import { PlanModal, type PlanModalEntry } from "../components/PlanModal";
import { useFocusMap } from "../lib/focusStore";
import { pathTail, timeAgo } from "../lib/format";
import type {
  DetectedSiblingRepo,
  IntakeStage,
  Project,
  ProjectIntakeReport,
  ProjectRepoTopology,
  ProjectTrunkDriftResponse,
  Session,
  TrunkDriftResult,
  WorktreeInfo,
} from "../lib/types";

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

const STAGE_BADGE_CLASSES: Record<IntakeStage, string> = {
  requested: "bg-surface-4 border-border-light text-gray-400",
  planned: "bg-sky-500/10 border-sky-500/30 text-sky-400",
  qa: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  built: "bg-violet-500/10 border-violet-500/30 text-violet-400",
  released: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
};

function IntakeStageBadge({ stage, label }: { stage: IntakeStage; label: string }) {
  return <span className={`badge ${STAGE_BADGE_CLASSES[stage]}`}>{label}</span>;
}

function DirtyIndicator({ dirty, t }: { dirty: boolean | null; t: TFunc }) {
  if (dirty === null) {
    return (
      <span
        className="flex items-center gap-1 text-[11px] text-gray-500"
        title={t("repos.unknown")}
      >
        <CircleHelp className="w-3 h-3" /> {t("repos.unknown")}
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-amber-400" title={t("repos.dirty")}>
        <CircleAlert className="w-3 h-3" /> {t("repos.dirty")}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-emerald-400" title={t("repos.clean")}>
      <CircleCheck className="w-3 h-3" /> {t("repos.clean")}
    </span>
  );
}

function WorktreeRow({ worktree, t }: { worktree: WorktreeInfo; t: TFunc }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 pl-6 border-l border-border">
      <div className="min-w-0 flex items-center gap-2">
        <GitBranch className="w-3 h-3 text-gray-500 flex-shrink-0" />
        <span className="text-xs text-gray-300 truncate" title={worktree.path}>
          {worktree.detached ? t("repos.detached") : worktree.branch || pathTail(worktree.path)}
        </span>
        {worktree.head && (
          <span className="text-[10px] font-mono text-gray-600 flex-shrink-0">
            {worktree.head.slice(0, 7)}
          </span>
        )}
      </div>
      <DirtyIndicator dirty={worktree.dirty} t={t} />
    </div>
  );
}

function RepoCard({ cwd, worktrees, t }: { cwd: string; worktrees: WorktreeInfo[]; t: TFunc }) {
  return (
    <div className="rounded-lg border border-border bg-surface-1/60 p-3 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <GitFork className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="text-sm font-medium text-gray-200 truncate" title={cwd}>
          {pathTail(cwd)}
        </span>
        <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0">
          {t("repos.worktrees", { count: worktrees.length })}
        </span>
      </div>
      <div className="space-y-1">
        {worktrees.map((wt) => (
          <WorktreeRow key={wt.path} worktree={wt} t={t} />
        ))}
      </div>
    </div>
  );
}

/** One commit row in a {@link TrunkDriftCard} — short SHA, subject, author,
 *  relative date, and the shortstat delta. Each field is its own DOM node
 *  (never string-concatenated) so it's individually text-matchable. */
function TrunkDriftCommitRow({
  commit,
}: {
  commit: NonNullable<TrunkDriftResult["commits"]>[number];
}) {
  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      <span className="font-mono text-gray-500 flex-shrink-0">{commit.shortSha}</span>
      <div className="min-w-0 flex-1">
        <span className="text-gray-300">{commit.subject}</span>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span>{commit.authorName}</span>
          <span>·</span>
          <span>{timeAgo(commit.committedAt)}</span>
          <span>·</span>
          <span className="font-mono">
            +{commit.insertions}/-{commit.deletions} in {commit.filesChanged}{" "}
            {commit.filesChanged === 1 ? "file" : "files"}
          </span>
        </div>
      </div>
    </div>
  );
}

// Maps each `skipped` reason to its own distinct copy rather than
// collapsing every reason into the generic "Unknown trunk branch" text.
// `budget_exceeded` in particular is misleading under that generic copy —
// the trunk branch IS knowable there, it just wasn't checked yet this page
// load (server/routes/projects.js's per-request cap) — so it, `git_error`,
// and `not_a_repo` each get copy that describes what actually happened.
// `no_default_branch` is the one case "Unknown trunk branch" genuinely
// describes, so it keeps using `trunkDrift.unknown`.
function trunkDriftSkipText(skipped: NonNullable<TrunkDriftResult["skipped"]>, t: TFunc): string {
  switch (skipped) {
    case "budget_exceeded":
      return t("trunkDrift.budgetExceeded");
    case "git_error":
      return t("trunkDrift.gitError");
    case "not_a_repo":
      return t("trunkDrift.notARepo");
    case "no_default_branch":
    case "no_commits":
    default:
      return t("trunkDrift.unknown");
  }
}

/** Read-only "Direct-to-trunk work" card for one mapped repo (Phase 1a — see
 *  server/lib/trunk-drift.js). `skipped` renders as an explicit "unknown"
 *  state — visually and textually distinct from the genuinely-clean
 *  (`commits: []`, `skipped: null`) state, since a client that ever renders
 *  both the same way is exactly the "silent false clean" failure mode this
 *  feature exists to catch. No badge, no verdict button, no classification
 *  vocabulary — this card is read-only. */
function TrunkDriftCard({ cwd, drift, t }: { cwd: string; drift: TrunkDriftResult; t: TFunc }) {
  return (
    <div
      data-testid="trunk-drift-card"
      className="rounded-lg border border-border bg-surface-1/60 p-3 space-y-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <GitCommitHorizontal className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="text-sm font-medium text-gray-200 truncate" title={cwd}>
          {t("trunkDrift.title")}
        </span>
        <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0 truncate" title={cwd}>
          {pathTail(cwd)}
        </span>
      </div>
      {drift.skipped ? (
        <p className="text-xs text-gray-500 italic">{trunkDriftSkipText(drift.skipped, t)}</p>
      ) : (
        <>
          <div className="text-[11px] text-gray-500">
            {drift.defaultBranch && (
              <>
                {t("trunkDrift.defaultBranch")}:{" "}
                <span className="text-gray-400">{drift.defaultBranch}</span>
                {" · "}
              </>
            )}
            {/* drift.lookbackDays ?? 7: this branch only renders when
                drift.skipped is null (a real, populated detectTrunkDrift
                result), where the server always sets lookbackDays — so this
                fallback never overrides a real server-provided value. It
                exists only as defense-in-depth against a malformed payload,
                and 7 matches trunk-drift.js's own
                DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS, so it can never silently
                disagree with the server's own default. */}
            {t("trunkDrift.lookbackWindow", { days: drift.lookbackDays ?? 7 })}
            {" · "}
            {drift.commitCount ?? 0} {t("trunkDrift.commitCount")}
          </div>
          {drift.commits && drift.commits.length > 0 ? (
            <div className="space-y-0.5">
              {drift.commits.map((commit) => (
                <TrunkDriftCommitRow key={commit.sha} commit={commit} />
              ))}
              {drift.truncated && (
                <p className="text-[11px] text-amber-500/80 italic pt-1">
                  {t("trunkDrift.truncated")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">{t("trunkDrift.empty")}</p>
          )}
        </>
      )}
    </div>
  );
}

function SuggestedRepoRow({
  sibling,
  busy,
  onAdd,
  t,
}: {
  sibling: DetectedSiblingRepo;
  busy: boolean;
  onAdd: () => void;
  t: TFunc;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-accent/30 px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm text-gray-200 truncate">{sibling.name}</div>
        <div className="text-[11px] text-gray-500 truncate" title={sibling.path}>
          {sibling.path}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={busy}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-60 flex-shrink-0"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        {busy ? t("suggestedRepos.adding") : t("suggestedRepos.add")}
      </button>
    </div>
  );
}

/** Full-page view of one project: its plan, repo/worktree topology, detected
 *  but unmapped sibling repos, and team-intake initiative status. */
export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation("projectDetail");
  const focusBySession = useFocusMap();

  const [project, setProject] = useState<Project | null>(null);
  const [repoTopology, setRepoTopology] = useState<ProjectRepoTopology | null>(null);
  const [intakeReport, setIntakeReport] = useState<ProjectIntakeReport | null>(null);
  const [trunkDrift, setTrunkDrift] = useState<ProjectTrunkDriftResponse | null>(null);
  const [planEntries, setPlanEntries] = useState<PlanModalEntry[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openPlan, setOpenPlan] = useState<PlanModalEntry[] | null>(null);
  const [addingSiblingPath, setAddingSiblingPath] = useState<string | null>(null);
  const [addSiblingError, setAddSiblingError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [projectsRes, repos, intake, planRollup, sessionsRes] = await Promise.all([
        api.projects.list(),
        api.projects.repos(id),
        api.projects.intake(id),
        api.plans.projectRollup(id),
        api.sessions.list({ limit: 10000 }),
      ]);
      const found = projectsRes.projects.find((p) => p.id === id) ?? null;
      setProject(found);
      setRepoTopology(repos);
      setIntakeReport(intake);
      setPlanEntries(planRollup.plans.map(({ plan, items }) => ({ plan, items })));
      const projectCwds = new Set((found?.paths ?? []).map((p) => p.cwd));
      setSessions(sessionsRes.sessions.filter((s) => s.cwd && projectCwds.has(s.cwd)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }

    // Trunk-drift is fetched independently of the block above: it is a
    // slower, best-effort, read-only card, and a failure here must not
    // block or blank out the rest of the page (project name, existing
    // Repos/Plan/Intake cards) — degrade this card alone.
    try {
      setTrunkDrift(await api.projects.trunkDrift(id));
    } catch {
      setTrunkDrift(null);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddSibling = useCallback(
    async (sibling: DetectedSiblingRepo) => {
      if (!id) return;
      setAddingSiblingPath(sibling.path);
      setAddSiblingError(null);
      try {
        await api.projects.addPath(id, sibling.path);
        const repos = await api.projects.repos(id);
        setRepoTopology(repos);
      } catch (err) {
        setAddSiblingError(err instanceof Error ? err.message : String(err));
      } finally {
        setAddingSiblingPath(null);
      }
    },
    [id]
  );

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <CardSkeleton className="h-12" />
        <CardSkeleton className="h-32" />
        <CardSkeleton className="h-48" />
        <CardSkeleton className="h-48" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <Link to="/projects" className="inline-flex items-center gap-1.5 text-sm text-accent mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> {t("backToProjects")}
        </Link>
        <EmptyState icon={FolderKanban} title={t("notFound")} description={t("notFoundDesc")} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-accent mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {t("backToProjects")}
        </Link>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center flex-shrink-0">
            <FolderKanban className="w-4 h-4 text-accent" />
          </div>
          <h1 className="text-lg font-semibold text-gray-100">{project.name}</h1>
        </div>
      </div>

      {error && <div className="badge bg-red-500/10 border-red-500/30 text-red-400">{error}</div>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">{t("plan.title")}</h2>
        {planEntries.length === 0 ? (
          <p className="text-xs text-gray-500 italic">{t("plan.empty")}</p>
        ) : (
          <div className="space-y-2">
            {planEntries.map((entry) => (
              <PlanPanel
                key={entry.plan.cwd}
                plan={entry.plan}
                items={entry.items}
                onOpen={() => setOpenPlan([entry])}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">{t("repos.title")}</h2>
        {!repoTopology || repoTopology.repos.length === 0 ? (
          <p className="text-xs text-gray-500 italic">{t("repos.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {repoTopology.repos.map((repo) => (
              <RepoCard key={repo.cwd} cwd={repo.cwd} worktrees={repo.worktrees} t={t} />
            ))}
          </div>
        )}
        {repoTopology && repoTopology.nonRepoFolders.length > 0 && (
          <div className="pt-1 space-y-1">
            <h3 className="text-xs font-medium text-gray-500">{t("repos.nonRepoFoldersTitle")}</h3>
            {repoTopology.nonRepoFolders.map((folder) => (
              <div key={folder.cwd} className="flex items-center gap-2 text-xs text-gray-500">
                <FolderX className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate" title={folder.cwd}>
                  {folder.cwd}
                </span>
                <span className="text-gray-600">— {t("repos.nonRepoFolder")}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {trunkDrift && trunkDrift.repos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">{t("trunkDrift.title")}</h2>
          <p className="text-xs text-gray-500">{t("trunkDrift.description")}</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {trunkDrift.repos.map((repo) => (
              <TrunkDriftCard key={repo.cwd} cwd={repo.cwd} drift={repo.drift} t={t} />
            ))}
          </div>
        </section>
      )}

      {repoTopology && repoTopology.detectedSiblings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">{t("suggestedRepos.title")}</h2>
          <p className="text-xs text-gray-500">{t("suggestedRepos.description")}</p>
          {addSiblingError && (
            <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
              {t("suggestedRepos.addFailed")}: {addSiblingError}
            </div>
          )}
          <div className="space-y-2">
            {repoTopology.detectedSiblings.map((sibling) => (
              <SuggestedRepoRow
                key={sibling.path}
                sibling={sibling}
                busy={addingSiblingPath === sibling.path}
                onAdd={() => handleAddSibling(sibling)}
                t={t}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5 text-accent" /> {t("intake.title")}
        </h2>
        {!intakeReport || intakeReport.initiatives.length === 0 ? (
          <p className="text-xs text-gray-500 italic">{t("intake.empty")}</p>
        ) : (
          <div className="space-y-1.5">
            {intakeReport.initiatives
              .slice()
              .sort((a, b) => b.slug.localeCompare(a.slug))
              .map((initiative) => (
                <div
                  key={`${initiative.sourceCwd}:${initiative.slug}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200 truncate">{initiative.slug}</div>
                    <div
                      className="text-[11px] text-gray-500 truncate"
                      title={initiative.sourceCwd}
                    >
                      {pathTail(initiative.sourceCwd)}
                    </div>
                  </div>
                  <IntakeStageBadge
                    stage={initiative.stage}
                    label={t(`intake.stages.${initiative.stage}`)}
                  />
                </div>
              ))}
          </div>
        )}
      </section>

      {openPlan && (
        <PlanModal
          plans={openPlan}
          sessions={sessions}
          focusBySession={focusBySession}
          onClose={() => setOpenPlan(null)}
        />
      )}
    </div>
  );
}
