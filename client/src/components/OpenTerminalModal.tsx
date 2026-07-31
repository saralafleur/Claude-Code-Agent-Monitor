/**
 * @file OpenTerminalModal.tsx
 * @description Popup for opening a brand-new Terminal.app window (running a
 * fresh `claude` instance) in one of a Project's mapped folders. Opened from
 * the Kanban board's header "more" (filters) menu — unlike SessionCard's own
 * "open new terminal" button, which always knows its one session's cwd, this
 * action starts from a Project, which may map to zero, one, or many folders.
 * It first lists every project; clicking one with exactly one mapped folder
 * opens it immediately (no extra step), while a project mapped to more than
 * one folder drills into a second screen listing just its folders, and
 * clicking one of those opens it. Mirrors SessionCard's local
 * pending/success/error feedback convention (no toast system in this
 * codebase, see client/src/pages/Run.tsx) but auto-closes shortly after a
 * successful open, since the popup's whole job is done at that point. When
 * there are more than three projects with any usage history, the top-level
 * list is split into a "Most used" section (the 3 highest `session_count`,
 * ties broken alphabetically) followed by the rest in the server's
 * alphabetical order — otherwise (few projects, or none used yet) it's
 * shown as one plain alphabetical list. An optional "effort name" text
 * field sits below the header, persists across the project/folder
 * navigation, and (when filled in) is passed along on open as `claude -n
 * <name>` so the fresh session starts already titled - typing one is never
 * required, and a click on a project/folder still opens immediately with no
 * extra step either way.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ChevronLeft, FolderOpen, SquareTerminal, Loader2, Check } from "lucide-react";
import { api } from "../lib/api";
import type { Project } from "../lib/types";
import { pathTail } from "../lib/format";

export interface OpenTerminalModalProps {
  onClose: () => void;
}

type OpenState = "idle" | "pending" | "success" | "error";

// How long the success check mark stays visible before the whole modal
// auto-closes - long enough to register as feedback, short enough not to
// feel like it's stuck open with nothing left to do.
const AUTO_CLOSE_MS = 900;
// Mirrors SessionCard's own terminal-button revert delay, so a failed
// attempt's error state doesn't linger indefinitely if the user just moves
// on without retrying.
const ERROR_REVERT_MS = 2500;

/**
 * Project → (folder, when there's more than one) picker that opens a new
 * Terminal.app window running `claude` in the chosen folder.
 * @param props See {@link OpenTerminalModalProps}.
 */
export function OpenTerminalModal({ onClose }: OpenTerminalModalProps) {
  const { t } = useTranslation("kanban");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [openState, setOpenState] = useState<OpenState>("idle");
  const [openError, setOpenError] = useState<string | null>(null);
  const [openingCwd, setOpeningCwd] = useState<string | null>(null);
  // Optional effort name, typed once and carried across the project/folder
  // navigation below - whatever's in it when a project/folder is clicked is
  // what gets passed to `openCwd`.
  const [nameInput, setNameInput] = useState("");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Splits into a "most used" top 3 (by session_count, ties alphabetical)
  // plus the remainder, which stays in the server's alphabetical order.
  // Skipped (empty topUsed) when there's nothing meaningful to promote.
  const { topUsed, rest } = useMemo(() => {
    if (!projects || projects.length <= 3 || !projects.some((p) => p.session_count > 0)) {
      return { topUsed: [] as Project[], rest: projects ?? [] };
    }
    const byUsage = [...projects].sort(
      (a, b) => b.session_count - a.session_count || a.name.localeCompare(b.name)
    );
    const top = byUsage.slice(0, 3);
    const topIds = new Set(top.map((p) => p.id));
    return { topUsed: top, rest: projects.filter((p) => !topIds.has(p.id)) };
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    api.projects
      .list()
      .then((res) => {
        if (!cancelled) setProjects(res.projects);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Clears any in-flight auto-close/revert timers on unmount so they don't
  // fire a state update (or an onClose from a stale modal) after the fact.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    };
  }, []);

  function openCwd(project: Project, cwd: string) {
    if (openState === "pending") return;
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    setOpenState("pending");
    setOpenError(null);
    setOpeningCwd(cwd);
    const name = nameInput.trim();
    const call = name
      ? api.projects.openTerminal(project.id, cwd, name)
      : api.projects.openTerminal(project.id, cwd);
    call
      .then(() => {
        setOpenState("success");
        closeTimerRef.current = setTimeout(onClose, AUTO_CLOSE_MS);
      })
      .catch((err: unknown) => {
        setOpenError(err instanceof Error ? err.message : t("openTerminalPicker.error"));
        setOpenState("error");
        revertTimerRef.current = setTimeout(() => setOpenState("idle"), ERROR_REVERT_MS);
      });
  }

  function handleProjectClick(project: Project) {
    if (openState === "pending") return;
    const [only, ...otherPaths] = project.paths;
    if (!only) return;
    if (otherPaths.length === 0) {
      openCwd(project, only.cwd);
    } else {
      setSelected(project);
      setOpenState("idle");
      setOpenError(null);
    }
  }

  function handleBack() {
    setSelected(null);
    setOpenState("idle");
    setOpenError(null);
  }

  function renderProjectRow(project: Project) {
    const disabled = project.paths.length === 0;
    const onlyPath = project.paths.length === 1 ? project.paths[0] : undefined;
    const isOpeningThis = !!openingCwd && project.paths.some((p) => p.cwd === openingCwd);
    return (
      <button
        key={project.id}
        type="button"
        disabled={disabled || openState === "pending"}
        onClick={() => handleProjectClick(project)}
        title={disabled ? t("openTerminalPicker.noFolders") : undefined}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
          disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-4"
        }`}
      >
        <FolderOpen className="w-4 h-4 text-gray-500 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-200 truncate">{project.name}</p>
          <p className="text-[11px] text-gray-500 truncate">
            {onlyPath
              ? pathTail(onlyPath.cwd)
              : t("openTerminalPicker.folderCount", { count: project.paths.length })}
          </p>
        </div>
        {isOpeningThis && openState === "pending" && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent flex-shrink-0" />
        )}
        {isOpeningThis && openState === "success" && (
          <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        )}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-terminal-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md max-h-[75vh] card shadow-2xl animate-slide-up overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {selected && (
              <button
                type="button"
                onClick={handleBack}
                title={t("openTerminalPicker.back")}
                aria-label={t("openTerminalPicker.back")}
                className="p-1 -ml-1 rounded-md text-gray-500 hover:text-gray-200 hover:bg-surface-3 flex-shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <SquareTerminal className="w-4 h-4 text-accent flex-shrink-0" />
            <h2
              id="open-terminal-modal-title"
              className="text-sm font-semibold text-gray-100 truncate"
            >
              {selected ? selected.name : t("openTerminalPicker.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t("common:close")}
            aria-label={t("common:close")}
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-200 hover:bg-surface-3 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border flex-shrink-0">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            aria-label={t("openTerminalPicker.nameLabel")}
            placeholder={t("openTerminalPicker.namePlaceholder")}
            disabled={openState === "pending"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="input w-full text-sm"
          />
        </div>

        {openState === "error" && openError && (
          <p className="px-5 pt-3 text-xs text-rose-400">{openError}</p>
        )}

        <div className="px-3 py-3 overflow-y-auto">
          {!selected && projects === null && !loadFailed && (
            <p className="text-xs text-gray-500 italic py-6 text-center">
              {t("openTerminalPicker.loading")}
            </p>
          )}
          {!selected && loadFailed && (
            <p className="text-xs text-rose-400 py-6 text-center">
              {t("openTerminalPicker.loadError")}
            </p>
          )}
          {!selected && projects && projects.length === 0 && (
            <p className="text-xs text-gray-500 py-6 text-center">
              {t("openTerminalPicker.noProjects")}
            </p>
          )}
          {!selected && projects && projects.length > 0 && topUsed.length > 0 && (
            <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {t("openTerminalPicker.mostUsed")}
            </p>
          )}
          {!selected &&
            projects &&
            projects.length > 0 &&
            topUsed.map((project) => renderProjectRow(project))}
          {!selected && projects && projects.length > 0 && topUsed.length > 0 && (
            <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {t("openTerminalPicker.allProjects")}
            </p>
          )}
          {!selected &&
            projects &&
            projects.length > 0 &&
            rest.map((project) => renderProjectRow(project))}

          {selected && (
            <div className="space-y-1">
              {selected.paths.map((p) => {
                const isThis = openingCwd === p.cwd;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={openState === "pending"}
                    onClick={() => openCwd(selected, p.cwd)}
                    title={p.cwd}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-gray-200 hover:bg-surface-4 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                    <span className="text-sm truncate flex-1">{p.cwd}</span>
                    {isThis && openState === "pending" && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent flex-shrink-0" />
                    )}
                    {isThis && openState === "success" && (
                      <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
