/**
 * @file Renders one Coach Observation — kind-colored left border, a
 * severity/kind badge, an i18n-templated message + recommendation (keyed by
 * `practiceId`; this app has no server-side i18n, so display copy is fully
 * owned here, not the DB row), and, for a session-scoped observation with a
 * known scope, two generic suggested actions (open the session, copy a
 * summary to the clipboard).
 *
 * Used in two modes by design, so the exact same rendering code proves the
 * config -> output link instead of a look-alike duplicate:
 *   - Real mode (CoachPage's Feed): a persisted row, `detectedAt` set,
 *     `onRespond` wired to POST /api/coach/observations/:id/respond.
 *   - Preview mode (PlaybookPage's editor): synthetic `values` taken
 *     straight from the config form's current inputs, `detectedAt`/
 *     `onRespond` omitted — same card, no time stamp, no Dismiss button.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fmt, timeAgo } from "../../lib/format";

/** Maps a practice id to its i18n key segment (lower camelCase, per this
 *  repo's key-naming convention) — extend when a second practice ships. */
const PRACTICE_I18N_KEY: Record<string, string> = {
  "session-token-ceiling": "sessionTokenCeiling",
};

/** Formats a practice's raw `values` into the params its message/
 *  recommendation i18n templates interpolate — extend alongside the map above. */
function messageParams(practiceId: string, values: Record<string, number>): Record<string, string> {
  if (practiceId === "session-token-ceiling") {
    return {
      tokens: fmt(values.totalTokens ?? 0),
      threshold: fmt(values.thresholdTokens ?? 0),
    };
  }
  return {};
}

export interface ObservationCardProps {
  practiceId: string;
  kind: "risk" | "info" | "good";
  values: Record<string, number>;
  scopeType?: "session" | "project" | "global";
  scopeId?: string | null;
  /** ISO timestamp; omit for a live-preview card (no time shown). */
  detectedAt?: string;
  status?: "open" | "acknowledged" | "dismissed" | "resolved";
  onRespond?: (response: "dismissed") => void;
  respondPending?: boolean;
}

export function ObservationCard({
  practiceId,
  kind,
  values,
  scopeType,
  scopeId,
  detectedAt,
  status,
  onRespond,
  respondPending,
}: ObservationCardProps) {
  const { t } = useTranslation("coach");
  const key = PRACTICE_I18N_KEY[practiceId] ?? practiceId;
  const params = messageParams(practiceId, values);
  const message = t(`practices.${key}.message`, params);
  const recommendation = t(`practices.${key}.recommendation`, params);

  const borderClass =
    kind === "risk"
      ? "border-l-orange-400"
      : kind === "good"
        ? "border-l-emerald-400"
        : "border-l-sky-400";
  const badgeClass =
    kind === "risk"
      ? "bg-orange-400/15 text-orange-400"
      : kind === "good"
        ? "bg-emerald-400/15 text-emerald-400"
        : "bg-sky-400/15 text-sky-400";

  const showActions = scopeType === "session" && !!scopeId && detectedAt !== undefined;

  return (
    <div className={`card border-l-[3px] ${borderClass} p-4`}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>
          {t(`kindLabel.${kind}`)}
        </span>
        {detectedAt !== undefined && (
          <span className="text-[10.5px] text-gray-600">{timeAgo(detectedAt)}</span>
        )}
      </div>
      <p className="text-sm font-medium text-gray-100">{message}</p>
      <p className="text-xs text-gray-400 mt-1">{recommendation}</p>
      {showActions && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Link
            to={`/sessions/${scopeId}`}
            className="text-[11px] font-medium bg-surface-3 border border-border-light text-gray-300 hover:bg-surface-4 hover:text-gray-100 px-2.5 py-1 rounded-md transition-colors"
          >
            {t("actions.openSession")}
          </Link>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(`${message} — ${recommendation}`);
            }}
            className="text-[11px] font-medium bg-surface-3 border border-border-light text-gray-300 hover:bg-surface-4 hover:text-gray-100 px-2.5 py-1 rounded-md transition-colors"
          >
            {t("actions.copySummary")}
          </button>
          {onRespond && status === "open" && (
            <button
              type="button"
              disabled={respondPending}
              onClick={() => onRespond("dismissed")}
              className="text-[11px] font-medium text-gray-500 hover:text-gray-200 px-2.5 py-1 rounded-md transition-colors disabled:opacity-50 ml-auto"
            >
              {t("actions.dismiss")}
            </button>
          )}
          {status && status !== "open" && (
            <span className="text-[11px] text-gray-600 ml-auto italic">
              {t(`statusLabel.${status}`)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
