/**
 * @file SessionCard.tsx
 * @description Compact session card for the Kanban board's "Sessions" view.
 * Mirrors AgentCard's information hierarchy (icon · title · meta line) but
 * surfaces session-relevant fields: model, agent count, cost, last activity,
 * and — when the session response joins token usage — a compact input/
 * output/cache token strip with an aggregate total. Clicking the card
 * navigates to the session detail page. While a session is
 * Waiting, a thin 25px hover bar appears flush against the card's bottom
 * edge; hovering THAT bar (not the card at large — a full-card hover proved
 * too eager/intrusive) lazily fetches the last thing Claude actually said
 * and shows it in a floating popup (portaled to `document.body`, positioned
 * off the bar's own bounding rect) rendered through the same markdown/
 * code-block renderer used in the Conversation tab — the badge alone tells
 * you the session is blocked on you, not what it's blocked ON, which is
 * what you need to decide whether to act now. The popup never resizes the
 * card itself or reflows its neighbors. The "open new terminal" button
 * opens a small anchored popover prompting for an optional effort name
 * (passed through as `claude -n <name>`) before actually launching -
 * Enter or its own "Open" button submits, Escape/outside-click cancels.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/Claude-Code-Agent-Monitor/client/src/components/SessionCard.tsx`
 * **Purpose:** Dashboard module consumed by the React client, MCP tools, or desktop shell depending on deployment mode.
 *
 * ## Design constraints
 * - Local-first: no telemetry leaves the machine unless the user configures webhooks.
 * - Fail-safe hooks path on the server must never block Claude Code; UI mirrors that
 *   philosophy by degrading gracefully (empty states, stale badges, reconnect loops).
 * - Destructive flows stay behind explicit confirmation modals and server-side gates.
 * - Internationalization: user-visible strings belong in i18n JSON, not literals here.
 *
 * ## Remote data & SSH
 * Remote Data Sources let operators aggregate multiple machines. SSH entries describe
 * how to reach a peer dashboard; the global data scope (`dataScope.ts`) narrows every
 * scoped GET via `?sources=`. Health checks and import history surface in Settings.
 *
 * ## Observability
 * Prometheus scrapes `GET /api/metrics` (see `monitoring/`). Grafana ships four
 * provisioned boards (overview, sessions, tools, alerts). Native npm scripts and
 * Docker Compose profiles are documented in `monitoring/README.md`.
 *
 * ## Internal dependencies
 * - `./StatusBadge`
 * - `../lib/types`
 * - `../lib/format`
 *
 * ## Public surface
 * - `SessionCard` — exported API; see TSDoc on the symbol for behavior.
 *
 * ## Testing pointers
 * - Prefer colocated `__tests__` with Vitest + Testing Library for UI.
 * - Server contract changes require `npm run test:server` and OpenAPI sync.
 * - MCP edits: `npm run mcp:typecheck` and `npm run mcp:build`.
 *
 * ## Related docs
 * - `ARCHITECTURE.md` — hooks → API → SQLite → WebSocket → UI pipeline.
 * - `docs/API.md` — REST reference.
 * - `.claude/skills/file-headers/` — mandatory `@author` header policy.
 * ============================================================================= */
/* -----------------------------------------------------------------------------
 * EXPORT CATALOG — quick index of symbols defined below (documentation only).
 * -----------------------------------------------------------------------------
 * **SessionCard**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen,
  Bot,
  Clock,
  Coins,
  Cpu,
  MessageSquare,
  Terminal,
  SquareTerminal,
  Loader2,
  Check,
  X,
  ArrowDown,
  ArrowUp,
  Database,
} from "lucide-react";
import { SessionStatusBadge } from "./StatusBadge";
import { FOCUS_KIND_ICONS } from "./PlanModal";
import { MarkdownContent } from "./conversation/MarkdownContent";
import { api } from "../lib/api";
import {
  effectiveSessionStatus,
  isSessionAwaitingInput,
  sessionAwaitingReason,
  focusKind,
  FOCUS_KIND_CONFIG,
  AWAITING_REASON_CONFIG,
} from "../lib/types";
import type { Session, TranscriptMessage } from "../lib/types";
import {
  formatDuration,
  timeAgo,
  formatModelName,
  isExpensiveModel,
  pathTail,
  fmt,
} from "../lib/format";
import { useSessionFocus } from "../lib/focusStore";

/** Joins a transcript message's "text" content blocks (ignores thinking/tool_use/
 *  tool_result blocks — those aren't what Claude "said"). Empty string when the
 *  message carries no text block (e.g. a bare tool call). */
function messageText(message: TranscriptMessage): string {
  return message.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n\n")
    .trim();
}

interface SessionCardProps {
  session: Session;
  onClick?: () => void;
}

function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

const PREVIEW_POPUP_MIN_WIDTH = 420;
// A hard ceiling, not a target - stays readable even on an ultrawide
// monitor. computePreviewPopupStyle further shrinks whatever width is
// requested to fit the actual viewport, so it never overflows the screen.
const PREVIEW_POPUP_MAX_WIDTH = 900;

/**
 * Widens the popup for content that would otherwise need a lot of vertical
 * scrolling at the base width - more width means fewer line-wraps, which
 * means less scrolling to read the same message. A rough heuristic (overall
 * length, and the single longest line for code blocks / dense text) rather
 * than an actual layout measurement, so there's no flash-of-relayout while
 * opening. Callers still clamp the result to the viewport.
 */
function estimatePreviewWidth(text: string): number {
  if (!text) return PREVIEW_POPUP_MIN_WIDTH;
  const longestLine = text.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
  const byLength =
    text.length > 1400
      ? PREVIEW_POPUP_MAX_WIDTH
      : text.length > 700
        ? 700
        : PREVIEW_POPUP_MIN_WIDTH;
  const byLongestLine =
    longestLine > 110 ? PREVIEW_POPUP_MAX_WIDTH : longestLine > 70 ? 700 : PREVIEW_POPUP_MIN_WIDTH;
  return Math.max(byLength, byLongestLine);
}

/** Popup anchored off the hovered card's rect - flips to the card's left
 *  when it wouldn't fit on the right, and clamps both axes AND its own
 *  width/height to the current viewport (re-read on every open, so this is
 *  correct across resizes and orientation changes, not just at mount).
 *  Height is capped (not measured) so this needs no two-phase render: a
 *  short message just leaves empty space below within the box - width,
 *  though, is widened up front via `estimatePreviewWidth` so a long message
 *  needs less of that vertical scroll in the first place. */
function computePreviewPopupStyle(rect: DOMRect, targetWidth: number): React.CSSProperties {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const pad = 12;
  const width = Math.min(targetWidth, vw - pad * 2);
  const maxHeight = Math.min(vh - pad * 2, 560);

  let left = rect.right + pad;
  if (left + width > vw - pad) left = rect.left - width - pad;
  left = Math.min(Math.max(left, pad), Math.max(pad, vw - width - pad));

  let top = rect.top;
  if (top + maxHeight > vh - pad) top = Math.max(pad, vh - maxHeight - pad);

  return { position: "fixed", left, top, width, maxHeight, zIndex: 9999 };
}

const FOCUS_POPUP_WIDTH = 340;

/** Popup anchored off the breadcrumb's own rect - opens below by default,
 *  flipping above when there's more room that direction (e.g. a card near
 *  the bottom of the viewport). Clamped to the viewport on both axes, same
 *  spirit as {@link computePreviewPopupStyle} but simpler: this popup's
 *  content is a handful of short lines, not an arbitrarily long message. */
function computeFocusPopupStyle(rect: DOMRect): React.CSSProperties {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const pad = 12;
  const width = Math.min(FOCUS_POPUP_WIDTH, vw - pad * 2);
  const left = Math.min(Math.max(rect.left, pad), Math.max(pad, vw - width - pad));

  const spaceBelow = vh - rect.bottom - pad;
  const spaceAbove = rect.top - pad;
  const openBelow = spaceBelow >= 140 || spaceBelow >= spaceAbove;
  const maxHeight = Math.min(Math.max(openBelow ? spaceBelow : spaceAbove, 100), 420);
  const top = openBelow ? rect.bottom + 6 : Math.max(pad, rect.top - 6 - maxHeight);

  return { position: "fixed", left, top, width, maxHeight, zIndex: 9999 };
}

export function SessionCard({ session, onClick }: SessionCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(["kanban", "plan"]);
  const isActive = session.status === "active";
  const isWaiting = isSessionAwaitingInput(session);
  const status = effectiveSessionStatus(session);
  // 'subagent'/'shell'/'monitor' mean "still actively working via a child",
  // not blocked on the human - the card's left-border accent should match the
  // green badge inside it (working/active) rather than reading yellow Waiting.
  const waitingReason = sessionAwaitingReason(session);
  const isPrimaryReason = !!waitingReason && AWAITING_REASON_CONFIG[waitingReason].primary === true;
  const title = session.name?.trim() || t("session.anonymous");
  const agentCount = session.agent_count ?? 0;
  const model = formatModelName(session.model);
  const modelIsExpensive = isExpensiveModel(session.model);
  const lastActivity = session.last_activity || session.ended_at || session.started_at;
  // Session-lifetime token totals (undefined on responses that don't join
  // token_usage) - the aggregate is derived here rather than trusting a
  // server-computed sum, so it always matches what the three figures above it show.
  const tokens = session.tokens;
  // Raw sum is only the strip's visibility gate — the displayed aggregate is
  // `effective` (cost-weighted input-equivalent tokens, computed server-side
  // from the pricing rules), which tracks the $ figure instead of counting a
  // ~10%-rate cache-read token the same as a full-rate output token.
  const tokenTotal = tokens ? tokens.input + tokens.output + tokens.cache : 0;
  // Fallbacks cover cached/stale API payloads that predate the split fields.
  const tokenCacheRead = tokens ? (tokens.cache_read ?? tokens.cache) : 0;
  const tokenCacheWrite = tokens ? (tokens.cache_write ?? 0) : 0;
  const tokenEffective = tokens ? (tokens.effective ?? tokenTotal) : 0;

  // Declared focus breadcrumb (AGENT-PLAN.md item + detour chain). Read from
  // the shared focusStore — one bulk hydrate + WS merges, never a per-card
  // fetch. Elapsed time belongs to the deepest current segment: the top
  // detour when one is open, else the item itself. Timestamps (not a local
  // counter) drive the figure, so a delayed WS can never fake liveness.
  const focus = useSessionFocus(session.id);
  // Which of the four states (known item / plain detour / feature / bug) the
  // breadcrumb's icon represents — same classification PlanModal's focus
  // lines use, so the vocabulary reads the same in both places.
  const focusKindValue = focusKind(focus);
  const focusTopDetour =
    focus && focus.detour_stack.length > 0
      ? focus.detour_stack[focus.detour_stack.length - 1]
      : undefined;
  const focusElapsedAnchor = focusTopDetour?.pushed_at ?? focus?.since ?? null;
  // Plain-text summary for the breadcrumb's aria-label (screen readers /
  // keyboard focus) — the visual detail now lives in the hover popup below,
  // not a native `title` tooltip, so this never competes with it on-screen.
  const focusSummary = focus
    ? [
        focus.item_number != null
          ? `${t("plan:focus.itemLabel", { number: focus.item_number })}: ${focus.item_text ?? ""}`
          : null,
        ...focus.detour_stack.map((d) => `▸ ${d.title ?? d.description}`),
        focus.since ? t("plan:focus.since", { time: timeAgo(focus.since) }) : null,
      ]
        .filter(Boolean)
        .join("\n")
    : undefined;

  // Last-said-by-Claude preview, fetched on demand the first time the
  // Waiting-only hover bar (below) is hovered - not fetched up front for
  // every card (that's one transcript read per session; only pay for it
  // when actually looked at). Rendered as a popup anchored off the bar's
  // rect rather than expanding the card itself - it never resizes the card
  // or reflows its neighbors.
  const cardRef = useRef<HTMLDivElement>(null);
  const previewBarRef = useRef<HTMLDivElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewFetchedRef = useRef(false);
  // Closing on a short delay (rather than instantly on mouseleave) gives the
  // pointer time to cross the gap from the card to the portaled popup - both
  // the card and the popup clear this timer on their own mouseenter, and
  // only actually close when the pointer has left BOTH for the full delay.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const fetchPreview = useCallback(() => {
    if (previewFetchedRef.current) return;
    previewFetchedRef.current = true;
    setPreviewLoading(true);
    api.sessions
      .transcript(session.id, { limit: 10 })
      .then((res) => {
        const lastAssistant = [...res.messages].reverse().find((m) => m.sender === "assistant");
        setPreviewText(lastAssistant ? messageText(lastAssistant) || null : null);
      })
      .catch(() => setPreviewText(null))
      .finally(() => setPreviewLoading(false));
  }, [session.id]);

  function handleClick() {
    if (onClick) onClick();
    else navigate(`/sessions/${session.id}`);
  }

  // "Jump to terminal" — offered only for a local, active session with a
  // resolved pid (see Session.pid's doc comment in lib/types.ts for why an
  // older/remote/never-resolved session won't have one). Feedback lives on
  // the button itself (pending spinner → check/x, auto-reverting) rather
  // than a toast, since this codebase has no toast primitive - see
  // client/src/pages/Run.tsx for the same local-state convention.
  const canFocusTerminal =
    (session.source === "local" || !session.source) && isActive && !!session.pid;
  const [terminalState, setTerminalState] = useState<"idle" | "pending" | "success" | "error">(
    "idle"
  );
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const terminalResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleFocusTerminal(e: React.MouseEvent) {
    e.stopPropagation();
    if (terminalState === "pending") return;
    if (terminalResetTimerRef.current) clearTimeout(terminalResetTimerRef.current);
    setTerminalState("pending");
    setTerminalError(null);
    api.sessions
      .focusTerminal(session.id)
      .then(() => setTerminalState("success"))
      .catch((err: unknown) => {
        setTerminalError(err instanceof Error ? err.message : t("session.focusTerminalError"));
        setTerminalState("error");
      })
      .finally(() => {
        terminalResetTimerRef.current = setTimeout(() => setTerminalState("idle"), 2000);
      });
  }

  // "Open new terminal" — sibling action to "Jump to terminal" above, but
  // starts a brand-new `claude` instance in the session's cwd instead of
  // locating the existing one. Doesn't require the session to still be
  // active/have a resolved pid (unlike canFocusTerminal) since it's opening
  // a fresh process, not locating a running one — only a known local cwd.
  const canOpenTerminal = (session.source === "local" || !session.source) && !!session.cwd;
  const [openTerminalState, setOpenTerminalState] = useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [openTerminalError, setOpenTerminalError] = useState<string | null>(null);
  const openTerminalResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Click opens a small anchored popover prompting for an optional effort
  // name (passed through as `claude -n <name>` so the fresh session starts
  // already titled) rather than firing immediately - the popover's own
  // "Open" button / Enter key is what actually calls the API.
  const openTerminalBtnRef = useRef<HTMLButtonElement | null>(null);
  const [showNamePopover, setShowNamePopover] = useState(false);
  const [namePopoverRect, setNamePopoverRect] = useState<DOMRect | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const namePopoverRef = useRef<HTMLDivElement | null>(null);

  function handleOpenTerminal(name?: string) {
    if (openTerminalState === "pending") return;
    if (openTerminalResetTimerRef.current) clearTimeout(openTerminalResetTimerRef.current);
    setOpenTerminalState("pending");
    setOpenTerminalError(null);
    const call = name
      ? api.sessions.openTerminal(session.id, name)
      : api.sessions.openTerminal(session.id);
    call
      .then(() => setOpenTerminalState("success"))
      .catch((err: unknown) => {
        setOpenTerminalError(err instanceof Error ? err.message : t("session.openTerminalError"));
        setOpenTerminalState("error");
      })
      .finally(() => {
        openTerminalResetTimerRef.current = setTimeout(() => setOpenTerminalState("idle"), 2000);
      });
  }

  function handleOpenTerminalButtonClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (openTerminalState === "pending") return;
    if (showNamePopover) {
      setShowNamePopover(false);
      return;
    }
    if (openTerminalBtnRef.current) {
      setNamePopoverRect(openTerminalBtnRef.current.getBoundingClientRect());
    }
    setNameDraft("");
    setShowNamePopover(true);
  }

  function submitOpenTerminal() {
    setShowNamePopover(false);
    handleOpenTerminal(nameDraft.trim() || undefined);
  }

  // Closes the popover on an outside click (mirrors the escape-to-cancel
  // keydown handler on the input itself) without opening a terminal - only
  // the popover's own submit path should ever call handleOpenTerminal.
  useEffect(() => {
    if (!showNamePopover) return;
    function handleDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (namePopoverRef.current?.contains(target)) return;
      if (openTerminalBtnRef.current?.contains(target)) return;
      setShowNamePopover(false);
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, [showNamePopover]);

  // Only the bottom hover bar (rendered when isWaiting) opens the preview
  // popup now - the card at large no longer does, since that read as too
  // intrusive for a card the user was merely scanning past.
  function handlePreviewBarMouseEnter(e: React.MouseEvent) {
    e.stopPropagation();
    clearCloseTimer();
    if (previewBarRef.current) setAnchorRect(previewBarRef.current.getBoundingClientRect());
    setShowPreview(true);
    fetchPreview();
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setShowPreview(false), 150);
  }

  // Focus-breadcrumb detail popup - a separate hover target/timer from the
  // last-message preview above (a session can be both Waiting and focused,
  // and the two popups anchor off different rects). `mouseenter` fires
  // independently per element (it doesn't bubble the way `mouseover` does),
  // so entering the breadcrumb also fires the card's own `handleMouseEnter`
  // - stopPropagation on the synthetic event can't stop that. Instead,
  // entering the breadcrumb explicitly closes the preview popup so only one
  // popup is ever showing at a time.
  const breadcrumbRef = useRef<HTMLParagraphElement>(null);
  const [showFocusPopup, setShowFocusPopup] = useState(false);
  const [focusAnchorRect, setFocusAnchorRect] = useState<DOMRect | null>(null);
  const focusCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFocusCloseTimer = useCallback(() => {
    if (focusCloseTimerRef.current) {
      clearTimeout(focusCloseTimerRef.current);
      focusCloseTimerRef.current = null;
    }
  }, []);

  function handleFocusMouseEnter(e: React.MouseEvent) {
    e.stopPropagation();
    clearFocusCloseTimer();
    if (breadcrumbRef.current) setFocusAnchorRect(breadcrumbRef.current.getBoundingClientRect());
    setShowFocusPopup(true);
    // The card's own handleMouseEnter already fired (see comment above) and
    // may have opened/queued the last-message preview - close it so the two
    // popups never stack on top of each other.
    clearCloseTimer();
    setShowPreview(false);
  }

  function scheduleFocusClose(e: React.MouseEvent) {
    e.stopPropagation();
    clearFocusCloseTimer();
    focusCloseTimerRef.current = setTimeout(() => setShowFocusPopup(false), 150);
  }

  return (
    <div
      ref={cardRef}
      onClick={handleClick}
      className={`card-hover p-4 cursor-pointer animate-fade-in overflow-hidden ${
        isWaiting
          ? isPrimaryReason
            ? "border-l-2 border-l-emerald-500/50"
            : "border-l-2 border-l-yellow-500/60"
          : isActive
            ? "border-l-2 border-l-emerald-500/50"
            : ""
      }`}
    >
      <p className="text-sm font-medium text-gray-200 truncate mb-2">{title}</p>

      <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-accent/15 text-accent">
            <FolderOpen className="w-3.5 h-3.5" />
          </div>
          <p className="text-[11px] text-gray-500 font-mono truncate">{session.id.slice(0, 12)}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* compact: cards are narrow — inline reason chip would squeeze the
              title, so the reason stays hover-tooltip-only here. */}
          <SessionStatusBadge status={status} reason={sessionAwaitingReason(session)} compact />
          {canOpenTerminal && (
            <button
              ref={openTerminalBtnRef}
              type="button"
              onClick={handleOpenTerminalButtonClick}
              disabled={openTerminalState === "pending"}
              title={
                openTerminalState === "error"
                  ? (openTerminalError ?? undefined)
                  : t("session.openTerminal")
              }
              aria-label={t("session.openTerminal")}
              className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors ${
                openTerminalState === "success"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : openTerminalState === "error"
                    ? "bg-red-500/15 text-red-500"
                    : "bg-accent/15 text-accent hover:bg-accent/25"
              }`}
            >
              {openTerminalState === "pending" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : openTerminalState === "success" ? (
                <Check className="w-3.5 h-3.5" />
              ) : openTerminalState === "error" ? (
                <X className="w-3.5 h-3.5" />
              ) : (
                <SquareTerminal className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          {canFocusTerminal && (
            <button
              type="button"
              onClick={handleFocusTerminal}
              disabled={terminalState === "pending"}
              title={
                terminalState === "error"
                  ? (terminalError ?? undefined)
                  : t("session.focusTerminal")
              }
              aria-label={t("session.focusTerminal")}
              className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors ${
                terminalState === "success"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : terminalState === "error"
                    ? "bg-red-500/15 text-red-500"
                    : "bg-accent/15 text-accent hover:bg-accent/25"
              }`}
            >
              {terminalState === "pending" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : terminalState === "success" ? (
                <Check className="w-3.5 h-3.5" />
              ) : terminalState === "error" ? (
                <X className="w-3.5 h-3.5" />
              ) : (
                <Terminal className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {session.cwd && (
        <p
          className="text-xs text-gray-400 mb-3 truncate font-mono leading-relaxed"
          title={session.cwd}
        >
          {pathTail(session.cwd)}
        </p>
      )}

      {focus && focusKindValue && isActive && (
        <p
          ref={breadcrumbRef}
          onMouseEnter={handleFocusMouseEnter}
          onMouseLeave={scheduleFocusClose}
          aria-label={focusSummary}
          className="flex items-center gap-1 text-[11px] mb-3 min-w-0 overflow-hidden whitespace-nowrap cursor-help"
        >
          {(() => {
            const FocusIcon = FOCUS_KIND_ICONS[focusKindValue];
            return (
              <FocusIcon
                className={`w-3 h-3 flex-shrink-0 ${FOCUS_KIND_CONFIG[focusKindValue].color}`}
              />
            );
          })()}
          {focus.item_number != null && (
            <span className={`truncate ${FOCUS_KIND_CONFIG[focusKindValue].color}`}>
              {t("plan:focus.itemLabel", { number: focus.item_number })}
              {": "}
              {focus.item_text ?? t("plan:focus.unknownItem")}
            </span>
          )}
          {focus.detour_stack.map((d, i) => (
            <span
              key={`${d.pushed_at}-${i}`}
              className="min-w-0 truncate text-amber-400/90 flex-shrink"
            >
              <span aria-hidden="true" className="text-gray-600 mx-0.5">
                {"▸"}
              </span>
              {d.title ?? d.description}
            </span>
          ))}
          {focusElapsedAnchor && (
            <span className="text-gray-600 flex-shrink-0">
              ({formatDuration(focusElapsedAnchor, new Date().toISOString())})
            </span>
          )}
          {focus.drift === true && (
            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
              {t("plan:focus.drift")}
            </span>
          )}
        </p>
      )}

      <div className="flex items-center gap-3 text-[11px] text-gray-500 min-w-0 overflow-hidden flex-wrap">
        <span className="flex items-center gap-1 flex-shrink-0">
          <Bot className="w-3 h-3" />
          {t("session.agentSummary", { count: agentCount })}
        </span>
        {model && (
          <span
            className={`flex items-center gap-1 flex-shrink-0 truncate ${
              modelIsExpensive ? "text-red-500 font-semibold" : ""
            }`}
            title={modelIsExpensive ? t("session.expensiveModel") : undefined}
          >
            <Cpu className="w-3 h-3" />
            <span className="truncate">{model}</span>
          </span>
        )}
        {typeof session.cost === "number" && session.cost > 0 && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Coins className="w-3 h-3" />
            {formatCost(session.cost)}
          </span>
        )}
        <span className="flex items-center gap-1 flex-shrink-0">
          <Clock className="w-3 h-3" />
          {session.ended_at
            ? `${t("ran")}${formatDuration(session.started_at, session.ended_at)}`
            : `${t("running")}${formatDuration(session.started_at, new Date().toISOString())}`}
        </span>
        <span className="text-gray-600 flex-shrink-0 ml-auto">
          {timeAgo(session.ended_at || lastActivity)}
        </span>
      </div>

      {/* Compact token strip - input/output/cache-read/cache-write totals plus
          the cost-weighted Effective aggregate, same hairline-separated
          treatment as the Waiting hover bar below. Cache is split because the
          two halves mean opposite things: writes (amber) are the premium-priced
          "context churn" signal, reads (purple) are the cheap per-turn re-read
          of the whole prefix. Only present once the session has used tokens. */}
      {tokens && tokenTotal > 0 && (
        <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-2.5 mt-2.5 pt-2 border-t border-border/50">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-gray-600 mb-0.5 whitespace-nowrap">
              <ArrowDown className="w-2.5 h-2.5 text-sky-400" />
              {t("session.tokens.in")}
            </div>
            <div
              className="text-[11px] font-semibold text-gray-300 truncate"
              title={t("session.tokens.inTooltip")}
            >
              {fmt(tokens.input)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-gray-600 mb-0.5 whitespace-nowrap">
              <ArrowUp className="w-2.5 h-2.5 text-emerald-400" />
              {t("session.tokens.out")}
            </div>
            <div
              className="text-[11px] font-semibold text-gray-300 truncate"
              title={t("session.tokens.outTooltip")}
            >
              {fmt(tokens.output)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-gray-600 mb-0.5 whitespace-nowrap">
              <Database className="w-2.5 h-2.5 text-purple-400" />
              {t("session.tokens.cacheRead")}
            </div>
            <div
              className="text-[11px] font-semibold text-gray-300 truncate"
              title={t("session.tokens.cacheReadTooltip")}
            >
              {fmt(tokenCacheRead)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-gray-600 mb-0.5 whitespace-nowrap">
              <Database className="w-2.5 h-2.5 text-amber-400" />
              {t("session.tokens.cacheWrite")}
            </div>
            <div
              className="text-[11px] font-semibold text-gray-300 truncate"
              title={t("session.tokens.cacheWriteTooltip")}
            >
              {fmt(tokenCacheWrite)}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[9px] uppercase tracking-wide text-accent-hover mb-0.5 whitespace-nowrap">
              {t("session.tokens.effective")}
            </div>
            <div
              className="text-xs font-bold text-accent-hover"
              title={t("session.tokens.effectiveTooltip")}
            >
              {fmt(tokenEffective)}
            </div>
          </div>
        </div>
      )}

      {/* Waiting-only hover bar - flush against the card's bottom edge via
          negative margins that cancel the card's own p-4 padding, clipped to
          the card's rounded corners by its overflow-hidden. Deliberately a
          narrow, separate hover target (not the whole card) so scanning past
          a Waiting card doesn't pop the last-message preview open unasked. */}
      {isWaiting && (
        <div
          ref={previewBarRef}
          onMouseEnter={handlePreviewBarMouseEnter}
          onMouseLeave={scheduleClose}
          className="flex items-center justify-center gap-1 h-[25px] -mx-4 -mb-4 mt-3 border-t border-border/50 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-surface-3/60 transition-colors cursor-help"
        >
          <MessageSquare className="w-3 h-3" />
          {t("session.lastMessage")}
        </div>
      )}

      {isWaiting &&
        showPreview &&
        anchorRect &&
        createPortal(
          <div
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
            style={computePreviewPopupStyle(
              anchorRect,
              previewText ? estimatePreviewWidth(previewText) : PREVIEW_POPUP_MIN_WIDTH
            )}
            className="flex flex-col rounded-lg border border-border bg-surface-2 shadow-2xl overflow-hidden animate-fade-in"
          >
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/60 text-[10px] font-semibold uppercase tracking-wider text-gray-500 flex-shrink-0">
              <MessageSquare className="w-3 h-3" />
              {t("session.lastMessage")}
            </div>
            {session.cwd && (
              <p
                className="px-3 pt-2 text-[11px] text-gray-500 font-mono break-all flex-shrink-0"
                title={session.cwd}
              >
                cwd: {session.cwd}
              </p>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
              {previewLoading ? (
                <p className="text-xs text-gray-500 italic">{t("session.lastMessageLoading")}</p>
              ) : previewText ? (
                <MarkdownContent text={previewText} dense />
              ) : (
                <p className="text-xs text-gray-500 italic">{t("session.lastMessageEmpty")}</p>
              )}
            </div>
          </div>,
          document.body
        )}

      {focus &&
        focusKindValue &&
        showFocusPopup &&
        focusAnchorRect &&
        createPortal(
          <div
            onMouseEnter={clearFocusCloseTimer}
            onMouseLeave={scheduleFocusClose}
            style={computeFocusPopupStyle(focusAnchorRect)}
            className="flex flex-col rounded-lg border border-border bg-surface-2 shadow-2xl overflow-hidden animate-fade-in"
          >
            <div
              className={`flex items-center gap-1.5 px-3 py-2 border-b border-border/60 text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 ${FOCUS_KIND_CONFIG[focusKindValue].color}`}
            >
              {(() => {
                const FocusIcon = FOCUS_KIND_ICONS[focusKindValue];
                return <FocusIcon className="w-3 h-3" />;
              })()}
              {t(FOCUS_KIND_CONFIG[focusKindValue].labelKey)}
            </div>
            {session.cwd && (
              <p
                className="px-3 pt-2 text-[11px] text-gray-500 font-mono break-all flex-shrink-0"
                title={session.cwd}
              >
                cwd: {session.cwd}
              </p>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2.5 text-xs text-gray-300 leading-relaxed">
              {focus.item_number != null && (
                <p>
                  <span className="text-gray-500">
                    {t("plan:focus.itemLabel", { number: focus.item_number })}:
                  </span>{" "}
                  {focus.item_text ?? t("plan:focus.unknownItem")}
                </p>
              )}
              {focus.detour_stack.map((d, i) => (
                <div key={`${d.pushed_at}-${i}`} className="border-l-2 border-amber-500/30 pl-2">
                  <p className="text-amber-400/90 font-medium">{d.title ?? d.description}</p>
                  {d.detail && <p className="text-gray-400 mt-0.5">{d.detail}</p>}
                  <p className="text-[10px] text-gray-600 mt-1">{timeAgo(d.pushed_at)}</p>
                </div>
              ))}
              {focus.since && (
                <p className="text-[10px] text-gray-600">
                  {t("plan:focus.since", { time: timeAgo(focus.since) })}
                </p>
              )}
              {focus.drift === true && (
                <p className="text-yellow-400 text-[11px] flex items-start gap-1">
                  <span aria-hidden="true">⚠</span>
                  <span>{focus.drift_reason || t("plan:focus.drift")}</span>
                </p>
              )}
            </div>
          </div>,
          document.body
        )}

      {showNamePopover &&
        namePopoverRect &&
        createPortal(
          <div
            ref={namePopoverRef}
            role="dialog"
            aria-label={t("session.openTerminal")}
            onClick={(e) => e.stopPropagation()}
            style={computeFocusPopupStyle(namePopoverRect)}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 shadow-2xl p-3 animate-fade-in"
          >
            <label
              htmlFor={`open-terminal-name-${session.id}`}
              className="text-[10px] font-semibold uppercase tracking-wider text-gray-500"
            >
              {t("session.openTerminalNameLabel")}
            </label>
            <input
              id={`open-terminal-name-${session.id}`}
              type="text"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitOpenTerminal();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setShowNamePopover(false);
                }
              }}
              placeholder={t("session.openTerminalNamePlaceholder")}
              className="input w-full text-sm"
            />
            <button
              type="button"
              onClick={submitOpenTerminal}
              className="btn-primary w-full justify-center text-xs py-1.5"
            >
              <SquareTerminal className="w-3.5 h-3.5" />
              {t("session.openTerminal")}
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
