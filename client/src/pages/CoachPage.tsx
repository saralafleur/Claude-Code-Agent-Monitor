/**
 * @file CoachPage.tsx
 * @description Standalone page (route `/coach`, sidebar label "Coach") — the
 * Coach Feed: open Observations the Playbook engine
 * (server/lib/playbook/engine.js) has produced, most recent first. Fetches
 * `GET /api/coach/observations?status=open` on mount, then stays live via
 * the `coach_observation_created` (prepend) and `coach_observation_updated`
 * (a Dismiss elsewhere, e.g. a second connected computer — remove from this
 * open-only list) WebSocket pushes, same local-state + eventBus.subscribe
 * pattern `ActivityFeed.tsx` uses for its own live list. Each card's own
 * Dismiss button calls `POST /api/coach/observations/:id/respond` and
 * optimistically removes it. A `CoachTabs` row (Feed/Playbook) doubles as
 * the way to the Playbook editor — no separate button needed, the tab itself
 * is the click-through.
 *
 * The flat list is clustered by `practice_id` (order preserved — the API
 * already returns most-recent-first, so a group sorts wherever its newest
 * member falls) and each cluster renders as one `ObservationGroup`, so a
 * practice that has tripped for many sessions (e.g. session-token-ceiling)
 * shows as one card + a "show more" toggle instead of flooding the Feed with
 * near-duplicate cards. Grouping is derived with `useMemo` from `observations`
 * so it stays correct through the same live create/update pushes below.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Compass, Radar } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import type { CoachObservation, WSMessage } from "../lib/types";
import { EmptyState } from "../components/EmptyState";
import { CoachTabs } from "../components/coach/CoachTabs";
import { ObservationGroup } from "../components/coach/ObservationGroup";

export function CoachPage() {
  const { t } = useTranslation("coach");
  const [observations, setObservations] = useState<CoachObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<number | null>(null);

  const load = useCallback(() => {
    api.coach
      .listObservations("open")
      .then(({ observations: rows }) => setObservations(rows))
      .catch(() => {
        /* leave the prior list showing rather than blank the page on a transient error */
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "coach_observation_created") {
        const row = msg.data as CoachObservation;
        setObservations((prev) => [row, ...prev.filter((o) => o.id !== row.id)]);
      } else if (msg.type === "coach_observation_updated") {
        const row = msg.data as CoachObservation;
        if (row.status !== "open") {
          setObservations((prev) => prev.filter((o) => o.id !== row.id));
        }
      }
    });
  }, []);

  const respond = (id: number) => {
    setRespondingId(id);
    api.coach
      .respondToObservation(id, "dismissed")
      .then(() => setObservations((prev) => prev.filter((o) => o.id !== id)))
      .finally(() => setRespondingId(null));
  };

  const groups = useMemo(() => {
    const byPractice = new Map<string, CoachObservation[]>();
    const order: string[] = [];
    for (const o of observations) {
      if (!byPractice.has(o.practice_id)) {
        byPractice.set(o.practice_id, []);
        order.push(o.practice_id);
      }
      byPractice.get(o.practice_id)!.push(o);
    }
    return order.map((practiceId) => ({ practiceId, items: byPractice.get(practiceId)! }));
  }, [observations]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Compass className="w-5 h-5 text-accent flex-shrink-0" />
          <div>
            <h1 className="text-lg font-semibold text-gray-100">{t("title")}</h1>
            <p className="text-xs text-gray-500">{t("subtitle")}</p>
          </div>
        </div>
        <CoachTabs />
      </div>

      {loading ? (
        <p className="text-xs text-gray-500 italic py-6 text-center">{t("feed.loading")}</p>
      ) : observations.length === 0 ? (
        <div className="card p-5">
          <EmptyState icon={Radar} title={t("empty.title")} description={t("empty.description")} />
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ practiceId, items }) => (
            <ObservationGroup
              key={practiceId}
              items={items}
              respondingId={respondingId}
              onRespond={respond}
            />
          ))}
        </div>
      )}
    </div>
  );
}
