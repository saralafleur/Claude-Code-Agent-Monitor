/**
 * @file HourWindowZoomBar.tsx
 * @description Presentational half of the "hour-window zoom" control —
 * the duration-pill row (`4h`/`8h`/`12h`/`24h`), the "Live" toggle, the
 * quick-start preset row, and the future-window warning. Moved verbatim
 * out of `FocusCalendarView.tsx` (same classNames/`t()` keys/aria-labels)
 * so a second consumer (`FocusPage.tsx`) can render the identical control
 * without a calendar grid attached — driven entirely by
 * `useHourWindowZoom`'s return value, spread in as props.
 * `FocusCalendarView.tsx` renders this exact component too; neither may
 * re-derive or copy-paste this JSX elsewhere.
 *
 * Deliberately has NO free-text/fine-grained time entry (no
 * `<input type="time">`, no prev/next block stepper) — window starts are
 * only ever picked via the quick-start presets (aligned to
 * `QUICK_START_STEP_HOURS`) or by following "Live". This was an explicit
 * product decision to keep window-start selection to coarse, aligned
 * blocks rather than arbitrary minute-level ranges.
 *
 * Every control group (`leadingRowContent`, the duration pills, the
 * "Live" toggle, and the quick-start presets) is a direct child of ONE
 * `flex flex-wrap` row, left-aligned - not stacked `<div>` rows. A single
 * shared flex container is what lets the browser pack every group onto one
 * line when there's enough width and wrap only the groups that don't fit
 * down to their own line otherwise, rather than always breaking after each
 * group regardless of available space. The quick-start group keeps its own
 * internal `flex-wrap` too, so if even a full-width viewport can't fit all
 * of ITS buttons on one line, only that group's own buttons wrap internally
 * rather than forcing everything before it down.
 * The future-window warning stays a separate block below this row - it's an
 * alert banner with a full sentence, not a control, so it always gets its
 * own line regardless of available width.
 *
 * A thin vertical divider (`w-px h-4 bg-border`, the same token used by
 * Sessions.tsx's own toolbar separators) renders between each CONSECUTIVE
 * pair of groups that's actually present - built from a filtered `groups`
 * array rather than a fixed set of dividers, so a hidden group (e.g. the
 * "Live" toggle on a non-today day) never leaves a stray, unpaired divider
 * behind. Purely decorative (`aria-hidden`), so it adds no extra stops to
 * screen-reader/keyboard navigation between the real controls.
 *
 * `leadingRowContent` lets `FocusCalendarView` fold its own date-nav
 * (Prev/Today/Next + date label) into this same row instead of a separate
 * one - passed as that date-nav JSX there, and counted as one group for
 * divider purposes (no divider between the nav buttons and the date label
 * themselves, only before/after the pair as a whole). `FocusPage` has no
 * date-nav to fold in, so it omits this prop entirely.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { Fragment } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { HOUR_WINDOW_OPTIONS } from "../hooks/useHourWindowZoom";
import type { HourWindowZoom } from "../hooks/useHourWindowZoom";

export interface HourWindowZoomBarProps extends HourWindowZoom {
  leadingRowContent?: ReactNode;
}

/** Purely decorative separator between two adjacent control groups - see
 *  file header. Not rendered before the first or after the last group. */
function GroupDivider() {
  return <span aria-hidden="true" className="w-px h-4 bg-border flex-shrink-0" />;
}

/** Renders `useHourWindowZoom`'s state as the zoom toolbar - see file header. */
export function HourWindowZoomBar({
  hourWindow,
  setHourWindow,
  zoomable,
  isToday,
  effectiveAnchorMode,
  setWindowAnchorMode,
  dayStart,
  windowStartMs,
  handleQuickStartClick,
  quickStartOptions,
  quickStartLabel,
  windowIsFuture,
  leadingRowContent,
}: HourWindowZoomBarProps) {
  const { t } = useTranslation("plan");

  const groups: { key: string; node: ReactNode }[] = [];

  if (leadingRowContent) {
    groups.push({ key: "leading", node: leadingRowContent });
  }

  // Hour-window zoom - narrows the view on ANY day (not just today); see
  // `zoomable` and the quick-start preset group below, which picks WHERE in
  // the day that window sits.
  groups.push({
    key: "duration",
    node: (
      <div
        role="group"
        aria-label={t("report.calendar.hourWindow.groupLabel")}
        className="flex items-center gap-1"
      >
        {HOUR_WINDOW_OPTIONS.map((hours) => (
          <button
            key={hours}
            type="button"
            onClick={() => setHourWindow(hours)}
            aria-pressed={hourWindow === hours}
            title={
              hours === 24
                ? t("report.calendar.hourWindow.fullDayTitle")
                : t("report.calendar.hourWindow.optionTitle", { hours })
            }
            className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
              hourWindow === hours
                ? "bg-accent text-white"
                : "text-gray-400 hover:bg-surface-2 hover:text-gray-200"
            }`}
          >
            {t("report.calendar.hourWindow.option", { hours })}
          </button>
        ))}
      </div>
    ),
  });

  // "Live" (today only) snaps back to following the current time instead of
  // a frozen custom start.
  if (zoomable && isToday) {
    groups.push({
      key: "live",
      node: (
        <button
          type="button"
          onClick={() => setWindowAnchorMode("live")}
          aria-pressed={effectiveAnchorMode === "live"}
          title={t("report.calendar.windowStart.liveTitle")}
          className={`px-2 py-0.5 text-[10px] font-semibold rounded-full transition-colors ${
            effectiveAnchorMode === "live"
              ? "bg-accent text-white"
              : "text-gray-400 hover:bg-surface-2 hover:text-gray-200 border border-border"
          }`}
        >
          {t("report.calendar.windowStart.live")}
        </button>
      ),
    });
  }

  // Quick-start presets - every QUICK_START_STEP_HOURS-aligned start time
  // from midnight up to the latest legal start for this window size (see
  // `quickStartOptions`). Available on any day, today included - a custom
  // start is just as meaningful while following "live" is still an option.
  // A preset landing after the real current time is styled amber (still
  // clickable, just a heads-up) rather than disabled, since the same preset
  // becomes meaningful again once "now" catches up to it.
  if (zoomable && quickStartOptions.length > 0) {
    groups.push({
      key: "quickstart",
      node: (
        <div
          role="group"
          aria-label={t("report.calendar.windowStart.quickStart.groupLabel")}
          className="flex items-center gap-1 flex-wrap"
        >
          {quickStartOptions.map((offset) => {
            const isActive =
              effectiveAnchorMode === "custom" && windowStartMs - dayStart === offset;
            const isFutureOption = isToday && dayStart + offset > Date.now();
            const label = quickStartLabel(offset);
            return (
              <button
                key={offset}
                type="button"
                onClick={() => handleQuickStartClick(offset)}
                aria-pressed={isActive}
                title={
                  isFutureOption
                    ? t("report.calendar.windowStart.quickStart.futureOptionTitle", { time: label })
                    : t("report.calendar.windowStart.quickStart.optionTitle", { time: label })
                }
                className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${
                  isActive
                    ? "bg-accent text-white"
                    : isFutureOption
                      ? "text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-300"
                      : "text-gray-400 hover:bg-surface-2 hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ),
    });
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {groups.map((group, i) => (
          <Fragment key={group.key}>
            {i > 0 && <GroupDivider />}
            {group.node}
          </Fragment>
        ))}
      </div>

      {windowIsFuture && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded-md px-2 py-1">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          {t("report.calendar.windowStart.futureWarning")}
        </div>
      )}
    </>
  );
}
