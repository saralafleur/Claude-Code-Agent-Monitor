/**
 * @file Renders one same-practice cluster of Coach Observations from the
 * Feed's flat, most-recent-first list (grouped by `practice_id` in
 * `CoachPage.tsx` — see that file for why grouping lives there and not in
 * the API). A practice that has only ever fired once renders exactly like a
 * bare `ObservationCard` always did. A practice with several open
 * Observations (e.g. session-token-ceiling tripping across many sessions)
 * instead shows just the latest as the card, plus a `common:showMore` toggle
 * — same collapse/expand convention `FocusActivityCard.tsx` uses — so the
 * Feed doesn't drown in near-duplicate cards while every instance (and its
 * own Dismiss/Open-session actions) stays reachable.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CoachObservation } from "../../lib/types";
import { ObservationCard } from "./ObservationCard";

export interface ObservationGroupProps {
  items: CoachObservation[];
  respondingId: number | null;
  onRespond: (id: number) => void;
}

export function ObservationGroup({ items, respondingId, onRespond }: ObservationGroupProps) {
  const { t } = useTranslation("coach");
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  // items.length > 0 is just proven above, so this index is always
  // in-bounds — noUncheckedIndexedAccess still types items[0] as possibly
  // undefined, hence the assertion.
  const latest = items[0] as CoachObservation;
  const rest = items.slice(1);

  const renderCard = (o: CoachObservation) => (
    <ObservationCard
      key={o.id}
      practiceId={o.practice_id}
      kind={o.kind}
      values={JSON.parse(o.values_json) as Record<string, number | string>}
      scopeType={o.scope_type}
      scopeId={o.scope_id}
      detectedAt={o.detected_at}
      status={o.status}
      onRespond={() => onRespond(o.id)}
      respondPending={respondingId === o.id}
    />
  );

  return (
    <div className="space-y-2">
      {renderCard(latest)}
      {rest.length > 0 &&
        (expanded ? (
          <>
            <div className="space-y-2 pl-3 border-l-2 border-border-light">
              {rest.map(renderCard)}
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[11px] font-medium text-accent hover:underline px-1"
            >
              {t("feed.showFewer")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[11px] font-medium text-accent hover:underline px-1"
          >
            {t("common:showMore", { count: rest.length })}
          </button>
        ))}
    </div>
  );
}
