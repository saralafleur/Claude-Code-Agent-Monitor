/**
 * @file ProjectDetail.tsx
 * @description Dedicated full page for one project (route `/projects/:id`,
 * reached from a Projects row's "open detail" button or a Project Manager
 * row), for doing sustained work against a single project's plan rather
 * than the Projects page's inline expand strip. The "Back" link returns to
 * whichever of those two pages linked in, carried via router location
 * state (`{ from: "/project-manager" }`) rather than the URL, defaulting
 * to `/projects` when absent. Composes four independent fetches — `api.projects`
 * (to resolve the project itself), `api.projects.repos`, `api.projects.intake`,
 * and `api.plans.projectRollup` — mirroring `ProjectManager.tsx`'s own
 * `Promise.all(...)` pattern rather than a combined endpoint, since each
 * already has its own single-responsibility server-side owner.
 *
 * Renders four sections: the project's AGENT-PLAN.md plan(s) (via the
 * existing `PlanPanel`/`PlanModal` — no new plan UI); a single Repos card
 * (matching the app's standard `.card` shell, same as e.g. Usage.tsx's
 * Accounts card) showing which of the project's mapped folders are git repos
 * with their live worktrees (each mapped repo/folder has its own Remove
 * button — a two-click confirm, mirroring Usage.tsx's AccountRow idiom,
 * that unmaps it via `DELETE /:id/paths/:pathId`), plus related repos not
 * yet part of the project — detected via a mapped repo's own
 * PROJECT-CONTEXT.md, a live scan of its sibling directories (gated behind
 * the project's own `siblingScanEnabled` toggle, default off, rendered as a
 * checkbox in the Suggested repos section — off by default because that scan
 * surfaces every unrelated repo sitting in the same parent folder in a flat
 * multi-project workspace), and a bounded scan of its own subfolders for
 * nested repos (submodules, vendored checkouts, always on) — shown as
 * suggestions only (adding one is an explicit click, never automatic) and
 * tagged with which of those ways it was found.
 * Every path shown anywhere in this card (a worktree's own location, a
 * repo's cwd, a suggestion's path) is rendered in full, never truncated to
 * a hover-only tooltip, since a worktree can legitimately live at an
 * arbitrary, "physically different" location from its own repo. Every mapped
 * folder (repo or non-repo) also carries a "terminalDefault" checkbox (Full
 * view only, alongside its Remove button) that toggles whether it's offered
 * as a choice when opening a new Claude terminal for this project — see
 * OpenTerminalModal.tsx's folder-picker step and PATCH `/:id/paths/:pathId`
 * in server/routes/projects.js. Every historical mapping (from before this
 * feature existed) keeps showing up in that picker exactly as it does today;
 * going forward, only a project's first mapped folder defaults on and every
 * folder mapped alongside/after it defaults off, toggleable here either way.
 * Every worktree row also carries its own "Continue" button (always visible,
 * independent of Compact/Full — it's a launcher, not a project-mutating
 * action like Remove/Add/Ignore) that opens a terminal in that exact
 * worktree with a FRESH `claude` instance seeded with a server-built
 * resume-nudge prompt (POST `/:id/continue-worktree` in
 * server/routes/projects.js) — deliberately not `-c`/`--continue`, which
 * would silently resume whatever prior conversation happened in that
 * directory; the prompt tells the new session to re-orient itself via git
 * instead. Feedback (spinner → check/error, auto-reverting) lives on the
 * button itself, same convention as SessionCard.tsx's own terminal button.
 * A suggestion can also be explicitly dismissed ("Ignore") into a separate
 * muted "Ignored repos" list ("Unignore" reverses it) so a suggestion the
 * project genuinely doesn't want stops reappearing on every rescan — both
 * actions round-trip through `POST`/`DELETE /:id/ignored-repos`. The card's
 * header has a Refresh button that re-fetches just this repo topology on
 * demand, independent of the rest of the page, and pops up a summary of
 * what the rescan found (the popup always shows full actions, independent
 * of the card's own view mode below); and team-intake initiatives found
 * under `intake/<slug>/` with a pipeline stage inferred from which
 * delivery-team artifact files exist. Initiatives at the terminal
 * "Released / Merged" stage (merged back into the default branch, whether
 * recorded via `merge.json` or only git-detected — see intake-scan.js) are
 * split out of the main list into their own subgroup with a collapse
 * toggle that starts COLLAPSED (in-memory only, resets on reload — the
 * opposite default of the Repos card's own collapse toggle below), since
 * that work is done and the card should default to spotlighting what's
 * still active. The repo/worktree/intake data is
 * computed live by the server on every load or manual refresh (no
 * persistence of the scan itself), so this page always reflects the current
 * filesystem/git state rather than a cached snapshot — adding/removing a
 * repo mapping and ignoring/un-ignoring a suggestion are the parts of this
 * that ARE persisted, via `POST`/`DELETE /:id/paths` and `POST`/`DELETE
 * /:id/ignored-repos` respectively.
 *
 * The Repos card's own header carries two independent view controls: a
 * collapse/expand toggle (chevron + click on the title, always starts
 * expanded — in-memory only, resets on reload) that hides the entire card
 * body, and a Compact/Full view-mode segmented toggle (persisted globally
 * to `localStorage` under `project-detail-repos-view-mode`, defaulting to
 * Full) that controls how much of the card's own functionality shows —
 * Compact keeps every repo/worktree/suggestion/ignored row's information
 * visible but hides their Remove/Add to project/Ignore/Unignore action
 * buttons, while Full shows everything. These two controls are orthogonal:
 * collapsing hides the whole card regardless of view mode, and the view
 * mode still applies the next time the card is expanded.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
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
  RefreshCw,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import { Checkbox } from "../components/Checkbox";
import { PlanPanel } from "../components/PlanPanel";
import { PlanModal, type PlanModalEntry } from "../components/PlanModal";
import { useFocusMap } from "../lib/focusStore";
import { pathTail, timeAgo } from "../lib/format";
import type {
  DetectedSiblingRepo,
  IgnoredRepo,
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

/** "full" shows every action (Remove/Add/Ignore/Unignore) on the Repos
 *  card; "compact" shows the same information with those actions hidden.
 *  Persisted globally (not per-project), same convention as
 *  Sidebar.tsx's own `sidebar-collapsed` — a deliberate, lasting viewing
 *  preference, unlike the card's own collapse/expand state which always
 *  resets to expanded (see REPOS_VIEW_MODE_STORAGE_KEY vs. the
 *  in-memory-only `reposCollapsed` state in {@link ProjectDetail}). */
type ReposViewMode = "compact" | "full";
const REPOS_VIEW_MODE_STORAGE_KEY = "project-detail-repos-view-mode";

function loadReposViewMode(): ReposViewMode {
  try {
    return localStorage.getItem(REPOS_VIEW_MODE_STORAGE_KEY) === "compact" ? "compact" : "full";
  } catch {
    return "full";
  }
}

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

/** One team-intake initiative row — shared by the active-work list and the
 *  collapsed-by-default Released/Merged subgroup on the Project Detail
 *  page, so both render identically. */
function IntakeInitiativeRow({
  initiative,
  t,
}: {
  initiative: ProjectIntakeReport["initiatives"][number];
  t: TFunc;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm text-gray-200 truncate">{initiative.slug}</div>
        <div className="text-[11px] text-gray-500 truncate" title={initiative.sourceCwd}>
          {pathTail(initiative.sourceCwd)}
        </div>
        <div className="flex items-center gap-1 mt-0.5 min-w-0">
          <GitBranch className="w-3 h-3 text-gray-600 flex-shrink-0" />
          {initiative.worktree ? (
            <span className="text-[11px] text-gray-400 truncate" title={initiative.worktree.path}>
              {initiative.worktree.branch}
            </span>
          ) : (
            <span className="text-[11px] text-gray-600 italic">{t("intake.noActiveWorktree")}</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <IntakeStageBadge stage={initiative.stage} label={t(`intake.stages.${initiative.stage}`)} />
        {initiative.mergeCommit && !initiative.mergeRecorded && (
          <span
            className="text-[10px] text-amber-400/80"
            title={t("intake.mergeDetectedTitle", { commit: initiative.mergeCommit })}
          >
            {t("intake.mergeDetected")}
          </span>
        )}
      </div>
    </div>
  );
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

/** Per-worktree "Continue" action state, as tracked by the parent
 *  {@link ProjectDetail} - only one worktree's request is ever in flight or
 *  showing a just-finished result at a time (same single-in-flight
 *  assumption as e.g. `addingSiblingPath`), keyed by the worktree's own path
 *  since a project can have several worktrees across several repos. */
export type ContinueWorktreeState = {
  path: string;
  status: "pending" | "success" | "error";
  message?: string;
};

/** Opens a new terminal for one worktree via POST /:id/continue-worktree - a
 *  FRESH `claude` instance seeded with a server-built resume prompt, never a
 *  silently-resumed prior conversation (`-c`/`--continue`) for that
 *  directory - feedback lives on the button itself (spinner → check/error,
 *  auto-reverting), mirroring SessionCard.tsx's own "jump to terminal"
 *  button rather than a toast. */
function ContinueWorktreeButton({
  worktreePath,
  state,
  onClick,
  t,
}: {
  worktreePath: string;
  state: ContinueWorktreeState | null;
  onClick: (path: string) => void;
  t: TFunc;
}) {
  const isThis = state?.path === worktreePath;
  const status = isThis ? state.status : null;
  const title =
    status === "error" && state?.message ? state.message : t("repos.continueWorktree.title");
  return (
    <button
      type="button"
      onClick={() => onClick(worktreePath)}
      disabled={status === "pending"}
      title={title}
      className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border flex-shrink-0 disabled:opacity-60 ${
        status === "success"
          ? "border-emerald-500/40 text-emerald-400"
          : status === "error"
            ? "border-red-500/40 text-red-300"
            : "border-border text-gray-500 hover:text-accent hover:border-accent/40"
      }`}
    >
      {status === "pending" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : status === "success" ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <SquareTerminal className="w-3.5 h-3.5" />
      )}
      {status === "pending"
        ? t("repos.continueWorktree.opening")
        : status === "success"
          ? t("repos.continueWorktree.opened")
          : t("repos.continueWorktree.label")}
    </button>
  );
}

function WorktreeRow({
  worktree,
  continueState,
  onContinue,
  t,
}: {
  worktree: WorktreeInfo;
  continueState: ContinueWorktreeState | null;
  onContinue: (path: string) => void;
  t: TFunc;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 pl-6 border-l border-border">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-3 h-3 text-gray-500 flex-shrink-0" />
          <span className="text-xs text-gray-300 truncate">
            {worktree.detached ? t("repos.detached") : worktree.branch || pathTail(worktree.path)}
          </span>
          {worktree.head && (
            <span className="text-[10px] font-mono text-gray-600 flex-shrink-0">
              {worktree.head.slice(0, 7)}
            </span>
          )}
        </div>
        {/* Full path, always visible (not truncated) - a worktree can live
            anywhere on disk, "physically different" from its own repo, and
            that location needs to be legible without hovering. */}
        <div className="text-[11px] text-gray-500 break-all pl-5">{worktree.path}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <DirtyIndicator dirty={worktree.dirty} t={t} />
        <ContinueWorktreeButton
          worktreePath={worktree.path}
          state={continueState}
          onClick={onContinue}
          t={t}
        />
      </div>
    </div>
  );
}

/** Shared "Remove"/"Remove?" button for a mapped `project_paths` row — one
 *  click arms a confirm state, a second click (within the window the parent
 *  keeps it armed) actually removes; matches Usage.tsx's AccountRow
 *  remove-confirmation idiom rather than a full modal, since unmapping is
 *  cheaply reversible (the folder and its sessions are untouched — see
 *  DELETE /:id/paths/:pathId). */
function RemovePathButton({
  busy,
  confirming,
  onClick,
  t,
}: {
  busy: boolean;
  confirming: boolean;
  onClick: () => void;
  t: TFunc;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={t("repos.remove")}
      className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border flex-shrink-0 disabled:opacity-60 ${
        confirming
          ? "border-red-500/40 text-red-300 bg-red-500/10"
          : "border-border text-gray-500 hover:text-red-300 hover:border-red-500/40"
      }`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      {confirming ? t("repos.removeConfirm") : t("repos.remove")}
    </button>
  );
}

function RepoCard({
  cwd,
  pathId,
  worktrees,
  terminalDefault,
  togglingTerminalDefault,
  onToggleTerminalDefault,
  removing,
  confirmingRemove,
  onRemoveClick,
  continueWorktreeState,
  onContinueWorktree,
  compact,
  t,
}: {
  cwd: string;
  pathId: number;
  worktrees: WorktreeInfo[];
  terminalDefault: boolean;
  togglingTerminalDefault: boolean;
  onToggleTerminalDefault: (pathId: number, next: boolean) => void;
  removing: boolean;
  confirmingRemove: boolean;
  onRemoveClick: (pathId: number) => void;
  continueWorktreeState: ContinueWorktreeState | null;
  onContinueWorktree: (path: string) => void;
  compact: boolean;
  t: TFunc;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1/60 p-3 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <GitFork className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="text-sm font-medium text-gray-200 truncate">{pathTail(cwd)}</span>
        <span className="text-[11px] text-gray-500 flex-shrink-0">
          {t("repos.worktrees", { count: worktrees.length })}
        </span>
        {!compact && (
          <div className="ml-auto flex-shrink-0">
            <RemovePathButton
              busy={removing}
              confirming={confirmingRemove}
              onClick={() => onRemoveClick(pathId)}
              t={t}
            />
          </div>
        )}
      </div>
      {/* Full path, always visible - see WorktreeRow's own path line for why. */}
      <div className="text-[11px] text-gray-500 break-all">{cwd}</div>
      {!compact && (
        <Checkbox
          checked={terminalDefault}
          onChange={(next) => onToggleTerminalDefault(pathId, next)}
          label={t("repos.terminalDefault.label")}
          className={togglingTerminalDefault ? "opacity-60 pointer-events-none" : ""}
          labelClassName="text-[11px] text-gray-400 group-hover:text-gray-300"
        />
      )}
      <div className="space-y-1">
        {worktrees.map((wt) => (
          <WorktreeRow
            key={wt.path}
            worktree={wt}
            continueState={continueWorktreeState}
            onContinue={onContinueWorktree}
            t={t}
          />
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

/** A mapped folder that isn't a git repo — same removable `project_paths`
 *  row as a {@link RepoCard}, so it gets the same Remove control. */
function NonRepoFolderRow({
  folder,
  togglingTerminalDefault,
  onToggleTerminalDefault,
  removing,
  confirmingRemove,
  onRemoveClick,
  compact,
  t,
}: {
  folder: { cwd: string; pathId: number; terminalDefault?: boolean };
  togglingTerminalDefault: boolean;
  onToggleTerminalDefault: (pathId: number, next: boolean) => void;
  removing: boolean;
  confirmingRemove: boolean;
  onRemoveClick: (pathId: number) => void;
  compact: boolean;
  t: TFunc;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 rounded-md border border-border/60 px-2.5 py-1.5">
      <FolderX className="w-3.5 h-3.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="break-all">{folder.cwd}</span>
        <span className="text-gray-600 ml-1">— {t("repos.nonRepoFolder")}</span>
      </div>
      {!compact && (
        <>
          <Checkbox
            checked={folder.terminalDefault !== false}
            onChange={(next) => onToggleTerminalDefault(folder.pathId, next)}
            label={t("repos.terminalDefault.label")}
            className={`flex-shrink-0 ${togglingTerminalDefault ? "opacity-60 pointer-events-none" : ""}`}
            labelClassName="text-[11px] text-gray-400 group-hover:text-gray-300"
          />
          <RemovePathButton
            busy={removing}
            confirming={confirmingRemove}
            onClick={() => onRemoveClick(folder.pathId)}
            t={t}
          />
        </>
      )}
    </div>
  );
}

/** Short "how was this found" label for a {@link DetectedSiblingRepo} —
 *  surfaced next to every suggestion so a disk-scan guess never reads as
 *  authoritative as a PROJECT-CONTEXT.md-named one (see
 *  server/lib/repo-topology.js's three detection sources). */
function sourceLabel(source: DetectedSiblingRepo["source"], t: TFunc): string {
  switch (source) {
    case "context":
      return t("suggestedRepos.source.context");
    case "disk-sibling":
      return t("suggestedRepos.source.diskSibling");
    case "disk-nested":
      return t("suggestedRepos.source.diskNested");
    default:
      return "";
  }
}

function SuggestedRepoRow({
  sibling,
  addBusy,
  ignoreBusy,
  onAdd,
  onIgnore,
  compact,
  t,
}: {
  sibling: DetectedSiblingRepo;
  addBusy: boolean;
  ignoreBusy: boolean;
  onAdd: () => void;
  onIgnore: () => void;
  compact: boolean;
  t: TFunc;
}) {
  const disabled = addBusy || ignoreBusy;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-accent/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm text-gray-200 truncate">{sibling.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 border border-border text-gray-500 flex-shrink-0">
            {sourceLabel(sibling.source, t)}
          </span>
        </div>
        {/* Full path, always visible - see WorktreeRow's own path line for
            why (this is exactly how you tell two look-alike suggestions
            apart when the same repo name shows up from different locations). */}
        <div className="text-[11px] text-gray-500 break-all">{sibling.path}</div>
      </div>
      {!compact && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onIgnore}
            disabled={disabled}
            title={t("suggestedRepos.ignore")}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-gray-500 hover:text-gray-300 hover:border-border-light disabled:opacity-60"
          >
            {ignoreBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            {ignoreBusy ? t("suggestedRepos.ignoring") : t("suggestedRepos.ignore")}
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-60"
          >
            {addBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {addBusy ? t("suggestedRepos.adding") : t("suggestedRepos.add")}
          </button>
        </div>
      )}
    </div>
  );
}

/** One dismissed suggestion in the "Ignored repos" section — muted styling
 *  (it's deliberately lower visual weight than an active suggestion) with a
 *  single "Unignore" action that puts it back into detectedSiblings on the
 *  next scan. */
function IgnoredRepoRow({
  ignored,
  busy,
  onUnignore,
  compact,
  t,
}: {
  ignored: IgnoredRepo;
  busy: boolean;
  onUnignore: () => void;
  compact: boolean;
  t: TFunc;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 opacity-75">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm text-gray-400 truncate">{ignored.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 border border-border text-gray-500 flex-shrink-0">
            {sourceLabel(ignored.source, t)}
          </span>
        </div>
        <div className="text-[11px] text-gray-600 break-all">{ignored.path}</div>
      </div>
      {!compact && (
        <button
          type="button"
          onClick={onUnignore}
          disabled={busy}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-gray-400 hover:text-accent hover:border-accent/40 disabled:opacity-60 flex-shrink-0"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
          {busy ? t("ignoredRepos.unignoring") : t("ignoredRepos.unignore")}
        </button>
      )}
    </div>
  );
}

/** Popup summarizing what a manual "Refresh" scan of the Repos card just
 *  found — mapped repos with their worktree counts, non-repo folders, and
 *  any newly-suggested sibling repos — so the result of an on-demand rescan
 *  is legible before it's dismissed, rather than only visible as an inline
 *  diff in the card underneath. Follows the same backdrop/Escape/click-out
 *  dismissal convention as {@link ConfirmModal}. */
function RepoScanModal({
  open,
  topology,
  addingSiblingPath,
  ignoringPath,
  addSiblingError,
  ignoreError,
  onAddSibling,
  onIgnoreSibling,
  onClose,
  t,
}: {
  open: boolean;
  topology: ProjectRepoTopology | null;
  addingSiblingPath: string | null;
  ignoringPath: string | null;
  addSiblingError: string | null;
  ignoreError: string | null;
  onAddSibling: (sibling: DetectedSiblingRepo) => void;
  onIgnoreSibling: (sibling: DetectedSiblingRepo) => void;
  onClose: () => void;
  t: TFunc;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !topology) return null;

  const nothingFound =
    topology.repos.length === 0 &&
    topology.nonRepoFolders.length === 0 &&
    topology.detectedSiblings.length === 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-lg max-h-[85vh] rounded-xl border border-border bg-surface-1 shadow-xl shadow-black/40 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 pb-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center flex-shrink-0">
            <GitFork className="w-4.5 h-4.5 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-100">{t("repos.scanModal.title")}</h3>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              {t("repos.scanModal.description")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 p-1 -mt-1 -mr-1"
            aria-label={t("repos.scanModal.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-2 overflow-y-auto space-y-4">
          {nothingFound && (
            <p className="text-xs text-gray-500 italic">{t("repos.scanModal.empty")}</p>
          )}

          {topology.repos.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-gray-400">
                {t("repos.scanModal.reposFound", { count: topology.repos.length })}
              </h4>
              <div className="space-y-1">
                {topology.repos.map((repo) => (
                  <div
                    key={repo.cwd}
                    className="flex items-center gap-2 text-xs text-gray-300 rounded-md border border-border bg-surface-2/60 px-2.5 py-1.5"
                  >
                    <GitFork className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                    <span className="break-all">{repo.cwd}</span>
                    <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0">
                      {t("repos.worktrees", { count: repo.worktrees.length })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topology.detectedSiblings.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-gray-400">
                {t("repos.scanModal.siblingsFound", { count: topology.detectedSiblings.length })}
              </h4>
              {addSiblingError && (
                <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                  {t("suggestedRepos.addFailed")}: {addSiblingError}
                </div>
              )}
              {ignoreError && (
                <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                  {t("suggestedRepos.ignoreFailed")}: {ignoreError}
                </div>
              )}
              <div className="space-y-1">
                {topology.detectedSiblings.map((sibling) => (
                  <SuggestedRepoRow
                    key={sibling.path}
                    sibling={sibling}
                    addBusy={addingSiblingPath === sibling.path}
                    ignoreBusy={ignoringPath === sibling.path}
                    onAdd={() => onAddSibling(sibling)}
                    onIgnore={() => onIgnoreSibling(sibling)}
                    // The scan-results popup always shows full actions,
                    // independent of the card's own compact/full toggle -
                    // it's a momentary "here's what I found" surface, not
                    // the card's own steady-state display.
                    compact={false}
                    t={t}
                  />
                ))}
              </div>
              <p className="text-[11px] text-gray-500">{t("repos.scanModal.siblingsHint")}</p>
            </div>
          )}

          {topology.nonRepoFolders.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-gray-400">
                {t("repos.scanModal.nonRepoFound", { count: topology.nonRepoFolders.length })}
              </h4>
              <div className="space-y-1">
                {topology.nonRepoFolders.map((folder) => (
                  <div key={folder.cwd} className="flex items-center gap-2 text-xs text-gray-500">
                    <FolderX className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="break-all">{folder.cwd}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 pt-3 flex-shrink-0">
          <button onClick={onClose} className="btn-ghost border border-border text-xs">
            {t("repos.scanModal.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Full-page view of one project: its plan, repo/worktree topology, detected
 *  but unmapped sibling repos, and team-intake initiative status. */
export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation("projectDetail");
  const focusBySession = useFocusMap();
  const location = useLocation();
  const cameFromProjectManager =
    (location.state as { from?: string } | null)?.from === "/project-manager";
  const backTo = cameFromProjectManager ? "/project-manager" : "/projects";
  const backLabel = cameFromProjectManager ? t("backToProjectManager") : t("backToProjects");

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
  const [togglingSiblingScan, setTogglingSiblingScan] = useState(false);
  const [siblingScanToggleError, setSiblingScanToggleError] = useState<string | null>(null);
  const [ignoringPath, setIgnoringPath] = useState<string | null>(null);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const [unignoringId, setUnignoringId] = useState<number | null>(null);
  const [unignoreError, setUnignoreError] = useState<string | null>(null);
  const [confirmRemovePathId, setConfirmRemovePathId] = useState<number | null>(null);
  const [removingPathId, setRemovingPathId] = useState<number | null>(null);
  const [removePathError, setRemovePathError] = useState<string | null>(null);
  const [togglingTerminalDefaultPathId, setTogglingTerminalDefaultPathId] = useState<number | null>(
    null
  );
  const [terminalDefaultToggleError, setTerminalDefaultToggleError] = useState<string | null>(null);
  const [refreshingRepos, setRefreshingRepos] = useState(false);
  const [refreshReposError, setRefreshReposError] = useState<string | null>(null);
  // Per-worktree "Continue" button feedback - see ContinueWorktreeButton;
  // only one worktree's request is tracked at a time (same convention as
  // e.g. addingSiblingPath above), auto-reverting to idle a couple seconds
  // after it settles, same timing as SessionCard.tsx's own terminal button.
  const [continueWorktreeState, setContinueWorktreeState] = useState<ContinueWorktreeState | null>(
    null
  );
  const continueWorktreeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  // Always starts expanded on a fresh load/navigation — deliberately NOT
  // persisted, unlike reposViewMode below.
  const [reposCollapsed, setReposCollapsed] = useState(false);
  const [reposViewMode, setReposViewMode] = useState<ReposViewMode>(loadReposViewMode);
  // Released/merged initiatives are done and no longer active work, so this
  // subgroup starts COLLAPSED (the opposite default of reposCollapsed above)
  // to keep the card focused on what's still in flight — in-memory only,
  // resets to collapsed again on reload, same non-persistence convention.
  const [releasedInitiativesCollapsed, setReleasedInitiativesCollapsed] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(REPOS_VIEW_MODE_STORAGE_KEY, reposViewMode);
    } catch {
      // best-effort only
    }
  }, [reposViewMode]);

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

  const handleRefreshRepos = useCallback(async () => {
    if (!id) return;
    setRefreshingRepos(true);
    setRefreshReposError(null);
    try {
      const [repos, intake] = await Promise.all([api.projects.repos(id), api.projects.intake(id)]);
      setRepoTopology(repos);
      setIntakeReport(intake);
      setScanModalOpen(true);
    } catch (err) {
      setRefreshReposError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingRepos(false);
    }
  }, [id]);

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

  // Toggling this re-fetches topology (not just the project record) since
  // enabling/disabling the disk-sibling scan changes which suggestions
  // `detectedSiblings` actually contains.
  const handleToggleSiblingScan = useCallback(
    async (next: boolean) => {
      if (!id) return;
      setTogglingSiblingScan(true);
      setSiblingScanToggleError(null);
      try {
        const { project: updated } = await api.projects.setSiblingScanEnabled(id, next);
        setProject(updated);
        const repos = await api.projects.repos(id);
        setRepoTopology(repos);
      } catch (err) {
        setSiblingScanToggleError(err instanceof Error ? err.message : String(err));
      } finally {
        setTogglingSiblingScan(false);
      }
    },
    [id]
  );

  const handleIgnoreSibling = useCallback(
    async (sibling: DetectedSiblingRepo) => {
      if (!id) return;
      setIgnoringPath(sibling.path);
      setIgnoreError(null);
      try {
        const topology = await api.projects.ignoreRepo(id, {
          path: sibling.path,
          name: sibling.name,
          source: sibling.source,
        });
        setRepoTopology(topology);
      } catch (err) {
        setIgnoreError(err instanceof Error ? err.message : String(err));
      } finally {
        setIgnoringPath(null);
      }
    },
    [id]
  );

  const handleUnignore = useCallback(
    async (ignored: IgnoredRepo) => {
      if (!id) return;
      setUnignoringId(ignored.id);
      setUnignoreError(null);
      try {
        const topology = await api.projects.unignoreRepo(id, ignored.id);
        setRepoTopology(topology);
      } catch (err) {
        setUnignoreError(err instanceof Error ? err.message : String(err));
      } finally {
        setUnignoringId(null);
      }
    },
    [id]
  );

  // Two-click confirm, mirroring Usage.tsx's AccountRow remove idiom: the
  // first click arms a 3s confirm window (reused for both a repo card and a
  // non-repo folder row, since both are just a project_paths row by pathId),
  // a second click within that window actually unmaps it.
  const handleRemovePathClick = useCallback(
    (pathId: number) => {
      if (confirmRemovePathId !== pathId) {
        setConfirmRemovePathId(pathId);
        setTimeout(() => setConfirmRemovePathId((cur) => (cur === pathId ? null : cur)), 3000);
        return;
      }
      if (!id) return;
      setConfirmRemovePathId(null);
      setRemovingPathId(pathId);
      setRemovePathError(null);
      api.projects
        .removePath(id, pathId)
        .then(() => api.projects.repos(id))
        .then((repos) => setRepoTopology(repos))
        .catch((err) => setRemovePathError(err instanceof Error ? err.message : String(err)))
        .finally(() => setRemovingPathId(null));
    },
    [id, confirmRemovePathId]
  );

  // Toggles a mapped folder's eligibility in the "open a new Claude
  // terminal" pickers (see ProjectPath.terminalDefault). The server returns
  // the freshly recomputed topology directly (same convention as
  // handleIgnoreSibling/handleUnignore above), so this updates local state
  // in one round trip rather than re-fetching repos() separately.
  const handleToggleTerminalDefault = useCallback(
    async (pathId: number, next: boolean) => {
      if (!id) return;
      setTogglingTerminalDefaultPathId(pathId);
      setTerminalDefaultToggleError(null);
      try {
        const topology = await api.projects.setPathTerminalDefault(id, pathId, next);
        setRepoTopology(topology);
      } catch (err) {
        setTerminalDefaultToggleError(err instanceof Error ? err.message : String(err));
      } finally {
        setTogglingTerminalDefaultPathId(null);
      }
    },
    [id]
  );

  // Opens a terminal for one live worktree and resumes work there (POST
  // /:id/continue-worktree) - unlike the toggle/remove handlers above, this
  // doesn't refetch topology on success (nothing about the project's
  // repos/worktrees changed, only a terminal opened), it just settles the
  // button's own feedback state and reverts it back to idle shortly after,
  // same ERROR_REVERT_MS-style timing as SessionCard.tsx's terminal button.
  const handleContinueWorktree = useCallback(
    (worktreePath: string) => {
      if (!id) return;
      if (continueWorktreeResetTimerRef.current)
        clearTimeout(continueWorktreeResetTimerRef.current);
      setContinueWorktreeState({ path: worktreePath, status: "pending" });
      api.projects
        .continueWorktree(id, worktreePath)
        .then(() => {
          setContinueWorktreeState({ path: worktreePath, status: "success" });
        })
        .catch((err: unknown) => {
          setContinueWorktreeState({
            path: worktreePath,
            status: "error",
            message: err instanceof Error ? err.message : t("repos.continueWorktree.failed"),
          });
        })
        .finally(() => {
          continueWorktreeResetTimerRef.current = setTimeout(
            () => setContinueWorktreeState(null),
            2000
          );
        });
    },
    [id, t]
  );

  // Clears the auto-revert timer on unmount so it can't fire a state update
  // after the page has navigated away.
  useEffect(() => {
    return () => {
      if (continueWorktreeResetTimerRef.current)
        clearTimeout(continueWorktreeResetTimerRef.current);
    };
  }, []);

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
        <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm text-accent mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> {backLabel}
        </Link>
        <EmptyState icon={FolderKanban} title={t("notFound")} description={t("notFoundDesc")} />
      </div>
    );
  }

  // Released/merged initiatives are done, so they're split into their own
  // collapsed-by-default subgroup (see releasedInitiativesCollapsed above)
  // instead of sitting mixed in with still-active work.
  const sortedInitiatives = (intakeReport?.initiatives ?? [])
    .slice()
    .sort((a, b) => b.slug.localeCompare(a.slug));
  const activeInitiatives = sortedInitiatives.filter((i) => i.stage !== "released");
  const releasedInitiatives = sortedInitiatives.filter((i) => i.stage === "released");

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-accent mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {backLabel}
        </Link>
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center flex-shrink-0">
              <FolderKanban className="w-4 h-4 text-accent" />
            </div>
            <h1 className="text-lg font-semibold text-gray-100 truncate">{project.name}</h1>
          </div>
          <button
            type="button"
            onClick={handleRefreshRepos}
            disabled={refreshingRepos}
            title={t("repos.refresh")}
            className="btn-ghost text-xs disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingRepos ? "animate-spin" : ""}`} />
            {refreshingRepos ? t("repos.refreshing") : t("repos.refresh")}
          </button>
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

      <section className="card">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <button
            type="button"
            onClick={() => setReposCollapsed((c) => !c)}
            aria-expanded={!reposCollapsed}
            title={reposCollapsed ? t("repos.expand") : t("repos.collapse")}
            className="flex items-center gap-2 min-w-0 text-left"
          >
            {reposCollapsed ? (
              <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
            )}
            <GitFork className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <h2 className="text-sm font-semibold text-gray-200">{t("repos.title")}</h2>
          </button>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              className="flex items-center rounded-md border border-border overflow-hidden text-[11px] font-medium"
              role="group"
              aria-label={t("repos.viewMode.label")}
            >
              <button
                type="button"
                onClick={() => setReposViewMode("compact")}
                aria-pressed={reposViewMode === "compact"}
                title={t("repos.viewMode.compactHint")}
                className={`px-2 py-1 transition-colors ${
                  reposViewMode === "compact"
                    ? "bg-accent/20 text-accent"
                    : "bg-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {t("repos.viewMode.compact")}
              </button>
              <button
                type="button"
                onClick={() => setReposViewMode("full")}
                aria-pressed={reposViewMode === "full"}
                title={t("repos.viewMode.fullHint")}
                className={`px-2 py-1 border-l border-border transition-colors ${
                  reposViewMode === "full"
                    ? "bg-accent/20 text-accent"
                    : "bg-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {t("repos.viewMode.full")}
              </button>
            </div>
          </div>
        </div>

        {!reposCollapsed && (
          <>
            <div className="p-4 space-y-3">
              {refreshReposError && (
                <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                  {t("repos.refreshFailed")}: {refreshReposError}
                </div>
              )}
              {removePathError && (
                <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                  {t("repos.removeFailed")}: {removePathError}
                </div>
              )}
              {terminalDefaultToggleError && (
                <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                  {t("repos.terminalDefault.toggleFailed")}: {terminalDefaultToggleError}
                </div>
              )}
              {!repoTopology || repoTopology.repos.length === 0 ? (
                <p className="text-xs text-gray-500 italic">{t("repos.empty")}</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {repoTopology.repos.map((repo) => (
                    <RepoCard
                      key={repo.cwd}
                      cwd={repo.cwd}
                      pathId={repo.pathId}
                      worktrees={repo.worktrees}
                      terminalDefault={repo.terminalDefault !== false}
                      togglingTerminalDefault={togglingTerminalDefaultPathId === repo.pathId}
                      onToggleTerminalDefault={handleToggleTerminalDefault}
                      removing={removingPathId === repo.pathId}
                      confirmingRemove={confirmRemovePathId === repo.pathId}
                      onRemoveClick={handleRemovePathClick}
                      continueWorktreeState={continueWorktreeState}
                      onContinueWorktree={handleContinueWorktree}
                      compact={reposViewMode === "compact"}
                      t={t}
                    />
                  ))}
                </div>
              )}
              {repoTopology && repoTopology.nonRepoFolders.length > 0 && (
                <div className="pt-1 space-y-1">
                  <h3 className="text-xs font-medium text-gray-500">
                    {t("repos.nonRepoFoldersTitle")}
                  </h3>
                  {repoTopology.nonRepoFolders.map((folder) => (
                    <NonRepoFolderRow
                      key={folder.cwd}
                      folder={folder}
                      togglingTerminalDefault={togglingTerminalDefaultPathId === folder.pathId}
                      onToggleTerminalDefault={handleToggleTerminalDefault}
                      removing={removingPathId === folder.pathId}
                      confirmingRemove={confirmRemovePathId === folder.pathId}
                      onRemoveClick={handleRemovePathClick}
                      compact={reposViewMode === "compact"}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </div>

            {repoTopology && (
              <div className="px-4 py-3 border-t border-border space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-gray-300">
                      {t("suggestedRepos.title")}
                    </h3>
                    <p className="text-[11px] text-gray-500">{t("suggestedRepos.description")}</p>
                  </div>
                  <Checkbox
                    checked={!!project.siblingScanEnabled}
                    onChange={handleToggleSiblingScan}
                    label={t("suggestedRepos.siblingScan.label")}
                    className={togglingSiblingScan ? "opacity-60 pointer-events-none" : ""}
                    labelClassName="text-[11px] text-gray-400 group-hover:text-gray-300"
                  />
                </div>
                <p className="text-[11px] text-gray-500">{t("suggestedRepos.siblingScan.hint")}</p>
                {siblingScanToggleError && (
                  <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                    {t("suggestedRepos.siblingScan.toggleFailed")}: {siblingScanToggleError}
                  </div>
                )}
                {addSiblingError && (
                  <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                    {t("suggestedRepos.addFailed")}: {addSiblingError}
                  </div>
                )}
                {ignoreError && (
                  <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                    {t("suggestedRepos.ignoreFailed")}: {ignoreError}
                  </div>
                )}
                {repoTopology.detectedSiblings.length === 0 ? (
                  <p className="text-[11px] text-gray-500 italic">{t("suggestedRepos.empty")}</p>
                ) : (
                  <div className="space-y-2">
                    {repoTopology.detectedSiblings.map((sibling) => (
                      <SuggestedRepoRow
                        key={sibling.path}
                        sibling={sibling}
                        addBusy={addingSiblingPath === sibling.path}
                        ignoreBusy={ignoringPath === sibling.path}
                        onAdd={() => handleAddSibling(sibling)}
                        onIgnore={() => handleIgnoreSibling(sibling)}
                        compact={reposViewMode === "compact"}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {repoTopology && repoTopology.ignoredRepos.length > 0 && (
              <div className="px-4 py-3 border-t border-border space-y-2">
                <div>
                  <h3 className="text-xs font-semibold text-gray-400">{t("ignoredRepos.title")}</h3>
                  <p className="text-[11px] text-gray-500">{t("ignoredRepos.description")}</p>
                </div>
                {unignoreError && (
                  <div className="badge bg-red-500/10 border-red-500/30 text-red-400">
                    {t("ignoredRepos.unignoreFailed")}: {unignoreError}
                  </div>
                )}
                <div className="space-y-2">
                  {repoTopology.ignoredRepos.map((ignored) => (
                    <IgnoredRepoRow
                      key={ignored.id}
                      ignored={ignored}
                      busy={unignoringId === ignored.id}
                      onUnignore={() => handleUnignore(ignored)}
                      compact={reposViewMode === "compact"}
                      t={t}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5 text-accent" /> {t("intake.title")}
        </h2>
        {!intakeReport || intakeReport.initiatives.length === 0 ? (
          <p className="text-xs text-gray-500 italic">{t("intake.empty")}</p>
        ) : (
          <>
            {activeInitiatives.length > 0 && (
              <div className="space-y-1.5">
                {activeInitiatives.map((initiative) => (
                  <IntakeInitiativeRow
                    key={`${initiative.sourceCwd}:${initiative.slug}`}
                    initiative={initiative}
                    t={t}
                  />
                ))}
              </div>
            )}
            {releasedInitiatives.length > 0 && (
              <div className={activeInitiatives.length > 0 ? "pt-2 border-t border-border" : ""}>
                <button
                  type="button"
                  onClick={() => setReleasedInitiativesCollapsed((c) => !c)}
                  aria-expanded={!releasedInitiativesCollapsed}
                  title={
                    releasedInitiativesCollapsed
                      ? t("intake.releasedGroup.expand")
                      : t("intake.releasedGroup.collapse")
                  }
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-200"
                >
                  {releasedInitiativesCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  )}
                  {t("intake.releasedGroup.title", { count: releasedInitiatives.length })}
                </button>
                {!releasedInitiativesCollapsed && (
                  <div className="space-y-1.5 mt-1.5">
                    {releasedInitiatives.map((initiative) => (
                      <IntakeInitiativeRow
                        key={`${initiative.sourceCwd}:${initiative.slug}`}
                        initiative={initiative}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
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

      <RepoScanModal
        open={scanModalOpen}
        topology={repoTopology}
        addingSiblingPath={addingSiblingPath}
        ignoringPath={ignoringPath}
        addSiblingError={addSiblingError}
        ignoreError={ignoreError}
        onAddSibling={handleAddSibling}
        onIgnoreSibling={handleIgnoreSibling}
        onClose={() => setScanModalOpen(false)}
        t={t}
      />
    </div>
  );
}
