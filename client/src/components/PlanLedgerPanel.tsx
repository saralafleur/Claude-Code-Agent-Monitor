/**
 * @file PlanLedgerPanel.tsx
 * @description Two-pane workbench for the portfolio-layer plan lifecycle +
 * value ledger (`server/routes/project-plans.js` / `server/lib/value-ledger.js`),
 * rendered as its own card on {@link ProjectDetail}. Left pane: open plans,
 * each with its nested items (`parent_item_id`-aware) and a close action,
 * plus a collapsible "History" section for closed generations rendered
 * strictly read-only (no edit/claim/unclaim affordances — closed plans and
 * their claims are immutable). Right pane: the live, unclaimed value pool,
 * each unit showing its `value_source` and an attribution-tier badge
 * (mechanical/correlational/judgment) with a simple "Claim into…" gesture
 * (a `<select>` of open items plus a Claim button — no drag-and-drop in this
 * pass). A small health strip above both panes renders `unclaimedPoolSize`,
 * `lastClosureAt`/`daysSinceLastClosure`, and `openPlanCount` from
 * `api.projectPlans.health()` VERBATIM — this is the PROJECT-CONTEXT.md
 * §9.1 DERIVED-DUAL-VIEW guard applied here: this component never derives
 * those numbers itself (e.g. never renders `units.length` where the server
 * gave `unclaimedPoolSize`). Every visible string routes through
 * `useTranslation("projectDetail")` under the `planLedger.*` keys — no new
 * i18n namespace, mirroring how {@link ProjectDetail} itself is localized.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { PlanHealth, ProjectPlanItem, ProjectPlanWithItems, ValueUnit } from "../lib/types";

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

/** One open plan item, tree-shaped from its flat `parent_item_id` links. */
type ItemNode = ProjectPlanItem & { children: ItemNode[] };

/** Groups a plan's flat item list into a parent/child tree — a `children`
 *  array nested under each top-level item, recursively. Items whose
 *  `parent_item_id` doesn't resolve within this same plan (shouldn't
 *  happen, but a stale/partial fetch is not this component's job to
 *  validate) fall back to top-level so nothing silently disappears. */
function buildItemTree(items: ProjectPlanItem[]): ItemNode[] {
  const byId = new Map<number, ItemNode>();
  for (const item of items) byId.set(item.id, { ...item, children: [] });
  const roots: ItemNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_item_id != null ? byId.get(node.parent_item_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function ItemNodeRow({ node, depth }: { node: ItemNode; depth: number }) {
  return (
    <div style={{ paddingLeft: depth * 16 }} className="text-xs text-gray-300 py-0.5">
      <span>{node.text}</span>
      {node.claims.length > 0 && (
        <span className="ml-2 text-[10px] text-emerald-400">
          {node.claims.map((c) => c.label_snapshot || c.value_ref).join(", ")}
        </span>
      )}
      {node.children.map((child) => (
        <ItemNodeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function ItemTree({ items, t }: { items: ProjectPlanItem[]; t: TFunc }) {
  const tree = buildItemTree(items);
  if (tree.length === 0) {
    return <p className="text-xs text-gray-500 italic">{t("planLedger.items.empty")}</p>;
  }
  return (
    <div>
      {tree.map((node) => (
        <ItemNodeRow key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}

/** One plan's card: title, (open-only) close control, and its item tree.
 *  Closed plans render exactly the same item tree with zero extra
 *  affordances — the "no edit/claim/unclaim on a closed plan" rule is
 *  satisfied by simply never wiring those controls up for any item here,
 *  not by hiding them conditionally per plan. */
function PlanSection({
  entry,
  closed,
  busy,
  onClose,
  t,
}: {
  entry: ProjectPlanWithItems;
  closed: boolean;
  busy?: boolean;
  onClose?: (note: string) => void;
  t: TFunc;
}) {
  const [note, setNote] = useState("");
  return (
    <div
      data-test="plan-section"
      className="rounded-lg border border-border bg-surface-1/60 p-3 space-y-2 mb-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-200">{entry.plan.title}</h4>
        {!closed && onClose && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("planLedger.openPlans.closeNotePlaceholder")}
              className="text-[11px] bg-surface-2 border border-border rounded px-1.5 py-0.5 text-gray-300 w-32"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => onClose(note)}
              className="text-[11px] px-2 py-1 rounded-md border border-border text-gray-400 hover:text-accent hover:border-accent/40 disabled:opacity-60"
            >
              {busy ? t("planLedger.openPlans.closing") : t("planLedger.openPlans.close")}
            </button>
          </div>
        )}
      </div>
      {closed && entry.plan.closure_note && (
        <p className="text-[11px] text-gray-500 italic">{entry.plan.closure_note}</p>
      )}
      <ItemTree items={entry.items} t={t} />
    </div>
  );
}

/** One row in the right-pane value pool: the raw `value_source` (a plain
 *  data value, not an i18n key — the same convention as e.g. commit shas
 *  elsewhere in the app), an attribution-tier badge, and — only when at
 *  least one open item exists to claim into — a target-item picker plus a
 *  Claim button. */
function ValueUnitRow({
  unit,
  openItems,
  busy,
  onClaim,
  t,
}: {
  unit: ValueUnit;
  openItems: Array<{ id: number; text: string }>;
  busy: boolean;
  onClaim: (unit: ValueUnit, itemId: number) => void;
  t: TFunc;
}) {
  const [targetItemId, setTargetItemId] = useState<number | null>(openItems[0]?.id ?? null);
  return (
    <div
      data-test="pool-unit"
      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-1/60 px-3 py-2 mb-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-mono text-gray-300 truncate">{unit.source}</span>
          <span className={`badge attribution-${unit.attribution}`}>
            {t(`planLedger.attribution.${unit.attribution}`)}
          </span>
        </div>
        {unit.label && <div className="text-[11px] text-gray-500 truncate">{unit.label}</div>}
      </div>
      {openItems.length > 0 && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <select
            aria-label={t("planLedger.pool.claimTarget")}
            value={targetItemId ?? ""}
            onChange={(e) => setTargetItemId(Number(e.target.value))}
            className="text-[11px] bg-surface-2 border border-border rounded px-1 py-0.5 text-gray-300 max-w-[8rem]"
          >
            {openItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.text}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || targetItemId == null}
            onClick={() => targetItemId != null && onClaim(unit, targetItemId)}
            className="text-[11px] px-2 py-1 rounded-md border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-60"
          >
            {busy ? t("planLedger.pool.claiming") : t("planLedger.pool.claim")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Formats an ISO closure timestamp for display; only ever called when the
 *  caller has already confirmed the value is non-null, so this never has to
 *  guard against rendering "Invalid Date". */
function formatClosureDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function HealthStrip({ health, t }: { health: PlanHealth; t: TFunc }) {
  return (
    <div
      data-test="plan-ledger-health"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-border text-[11px] text-gray-400"
    >
      <span>
        {t("planLedger.health.unclaimedPoolSize")}:{" "}
        <strong className="text-gray-200">{health.unclaimedPoolSize}</strong>
      </span>
      <span>
        {t("planLedger.health.openPlanCount")}:{" "}
        <strong className="text-gray-200">{health.openPlanCount}</strong>
      </span>
      <span>
        {t("planLedger.health.lastClosure")}:{" "}
        {health.lastClosureAt == null ? (
          <strong className="text-gray-200">{t("planLedger.health.noClosures")}</strong>
        ) : (
          <strong className="text-gray-200">
            {formatClosureDate(health.lastClosureAt)}
            {typeof health.daysSinceLastClosure === "number"
              ? ` (${t("planLedger.health.daysAgo", { count: health.daysSinceLastClosure })})`
              : ""}
          </strong>
        )}
      </span>
    </div>
  );
}

/** Two-pane plan lifecycle + value ledger workbench for one project. Loads
 *  {@link api.projectPlans.list}/`pool`/`health` together on mount and after
 *  every claim/close, so every pane always reflects one consistent
 *  snapshot rather than three independently-stale fetches. */
export function PlanLedgerPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation("projectDetail");
  const [plans, setPlans] = useState<ProjectPlanWithItems[]>([]);
  const [units, setUnits] = useState<ValueUnit[]>([]);
  const [health, setHealth] = useState<PlanHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimingUnitId, setClaimingUnitId] = useState<string | null>(null);
  const [closingPlanId, setClosingPlanId] = useState<number | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const [plansRes, poolRes, healthRes] = await Promise.all([
        api.projectPlans.list(projectId),
        api.projectPlans.pool(projectId),
        api.projectPlans.health(projectId),
      ]);
      setPlans(plansRes.plans);
      setUnits(poolRes.units);
      setHealth(healthRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleClaim = useCallback(
    async (unit: ValueUnit, itemId: number) => {
      setClaimingUnitId(unit.id);
      try {
        await api.projectPlans.claim(projectId, itemId, unit);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setClaimingUnitId(null);
      }
    },
    [projectId, load]
  );

  const handleClose = useCallback(
    async (planId: number, closureNote: string) => {
      setClosingPlanId(planId);
      try {
        await api.projectPlans.close(projectId, planId, {
          closure_note: closureNote || undefined,
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setClosingPlanId(null);
      }
    },
    [projectId, load]
  );

  const openPlans = plans.filter((p) => p.plan.status === "open");
  const closedPlans = plans.filter((p) => p.plan.status === "closed");
  const openItems = openPlans.flatMap((p) => p.items.map((it) => ({ id: it.id, text: it.text })));

  return (
    <section className="card" data-test="plan-ledger-panel">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-gray-200">{t("planLedger.title")}</h2>
      </div>

      {error && (
        <div className="mx-4 mt-3 badge bg-red-500/10 border-red-500/30 text-red-400">{error}</div>
      )}

      {health && <HealthStrip health={health} t={t} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        <div data-test="open-plans-pane">
          <h3 className="text-xs font-semibold text-gray-300 mb-2">
            {t("planLedger.openPlans.title")}
          </h3>
          {openPlans.length === 0 ? (
            <p className="text-xs text-gray-500 italic mb-3">{t("planLedger.openPlans.empty")}</p>
          ) : (
            openPlans.map((entry) => (
              <PlanSection
                key={entry.plan.id}
                entry={entry}
                closed={false}
                busy={closingPlanId === entry.plan.id}
                onClose={(note) => handleClose(entry.plan.id, note)}
                t={t}
              />
            ))
          )}

          <div data-test="closed-plans-history" className="pt-2 border-t border-border">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-xs font-semibold text-gray-400">
                {t("planLedger.closedPlans.title")}
              </h3>
              <button
                type="button"
                onClick={() => setHistoryCollapsed((c) => !c)}
                aria-expanded={!historyCollapsed}
                className="text-[11px] text-gray-500 hover:text-gray-300"
              >
                {historyCollapsed
                  ? t("planLedger.closedPlans.expand")
                  : t("planLedger.closedPlans.collapse")}
              </button>
            </div>
            {!historyCollapsed &&
              (closedPlans.length === 0 ? (
                <p className="text-xs text-gray-500 italic">{t("planLedger.closedPlans.empty")}</p>
              ) : (
                closedPlans.map((entry) => (
                  <PlanSection key={entry.plan.id} entry={entry} closed t={t} />
                ))
              ))}
          </div>
        </div>

        <div data-test="value-pool-pane">
          <h3 className="text-xs font-semibold text-gray-300 mb-2">{t("planLedger.pool.title")}</h3>
          {units.length === 0 ? (
            <p className="text-xs text-gray-500 italic">{t("planLedger.pool.empty")}</p>
          ) : (
            units.map((unit) => (
              <ValueUnitRow
                key={unit.id}
                unit={unit}
                openItems={openItems}
                busy={claimingUnitId === unit.id}
                onClaim={handleClaim}
                t={t}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
