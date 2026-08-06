/**
 * @file PlanLedgerPanel.tsx
 * @description Two-pane workbench for the portfolio-layer plan lifecycle +
 * value ledger (`server/routes/project-plans.js` / `server/lib/value-ledger.js`),
 * rendered as its own card on {@link ProjectDetail}. Left pane: open plans,
 * each with its nested items (`parent_item_id`-aware) and a close action,
 * plus a collapsible "History" section for closed generations rendered
 * strictly read-only (no edit/claim/unclaim affordances — closed plans and
 * their claims are immutable). Right pane: the live, unclaimed value pool,
 * each unit shown at THREE altitudes at once (Sara's 2026-08-04 request) —
 * GROUND (the raw `value_source`/label/attribution-tier badge, exactly as
 * before), PROJECT (a short relational phrase), and STAKEHOLDER (one plain
 * sentence) — the latter two synthesized and cached server-side by
 * `server/lib/value-summary.js` via `api.projectPlans.altitudes`, the same
 * leveling mechanism Focus's own window summary already uses, one altitude
 * higher. A simple "Claim into…" gesture follows (a `<select>` of open items
 * plus a Claim button — no drag-and-drop in this pass). A small health strip
 * above both panes renders `unclaimedPoolSize`,
 * `lastClosureAt`/`daysSinceLastClosure`, and `openPlanCount` from
 * `api.projectPlans.health()` VERBATIM — this is the PROJECT-CONTEXT.md
 * §9.1 DERIVED-DUAL-VIEW guard applied here: this component never derives
 * those numbers itself (e.g. never renders `units.length` where the server
 * gave `unclaimedPoolSize`). Every visible string routes through
 * `useTranslation("projectDetail")` under the `planLedger.*` keys — no new
 * i18n namespace, mirroring how {@link ProjectDetail} itself is localized.
 *
 * The header also carries an info button (`ValuePoolInfoModal`) that opens a
 * plain-language explainer of the pool/claim/close model in-place — fully
 * self-contained app UI built from this same `planLedger.info.*` i18n
 * namespace and the app's own card/badge classes, not a link out to any
 * externally hosted page.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import type {
  CoverageSnapshot,
  PlanHealth,
  ProjectPlanItem,
  ProjectPlanWithItems,
  ValueAltitudesUpdatedPayload,
  ValueUnit,
} from "../lib/types";

/** Hand-maintained mirror of `server/lib/value-summary.js`'s
 *  `ALTITUDE_FRESHNESS` export (§9.7 accepted exception, WATCH-F — a CJS
 *  server module cannot be imported across the Vite/Node boundary). Grow
 *  this ONLY when the server export grows; `server/__tests__/value-summary.test.js`'s
 *  i18n-registry test and this file's own out-of-registry warn below are the
 *  two compensating pins that keep this copy from drifting silently. */
const ALTITUDE_FRESHNESS = [
  "stale_refresh_queued",
  "stale_refresh_unavailable",
  "updated_unseen",
] as const;

/**
 * Value Pool Slice 2 (DEC-5/DEC-1, §9.1): the monotonic merge rule. Accepts
 * `next` only if its `computed_at` is strictly newer than `prev`'s —
 * otherwise an HTTP response that lands AFTER a later WS broadcast (or vice
 * versa) would visibly regress the header, which is "decrement" wearing a
 * race's clothes (architect R4). ISO-8601 timestamps compare correctly as
 * plain strings. This is the ONLY comparison this file performs on a
 * `CoverageSnapshot` — every other field is rendered verbatim, never
 * recomputed.
 */
function mergeCoverage(
  prev: CoverageSnapshot | null,
  next: CoverageSnapshot | null | undefined
): CoverageSnapshot | null {
  if (!next) return prev;
  if (!prev) return next;
  return next.computed_at > prev.computed_at ? next : prev;
}

/**
 * Formats an already-server-computed `ms_remaining` (a `CoverageSnapshot`
 * field this file never derives) into whole minutes for display. This is a
 * UNIT CONVERSION of a value the server already computed — not a re-
 * derivation of the estimate itself (DEC-1/DEC-5's "no ETA arithmetic"
 * bars deriving `ms_remaining`/`batches_remaining` from more primitive
 * inputs here, which this file never does; it never reads `duration_ms` or
 * any generation-log data at all). Floors at 1 so a near-complete drain
 * never displays "~0 min remaining" (a fabricated zero is explicitly a
 * requirement violation, not a rounding choice — technical-plan.md §8).
 */
function formatEtaMinutes(msRemaining: number): number {
  return Math.max(1, Math.round(msRemaining / 60_000));
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

const TIER_BADGE_CLASS: Record<"mechanical" | "correlational" | "judgment", string> = {
  mechanical: "bg-sky-500/10 border-sky-500/30 text-sky-400",
  correlational: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  judgment: "bg-violet-500/10 border-violet-500/30 text-violet-400",
};

const INFO_FEED_KEYS = ["initiatives", "trunk", "detours", "sessionLinked"] as const;
const INFO_FEED_TIER: Record<
  (typeof INFO_FEED_KEYS)[number],
  "mechanical" | "correlational" | "judgment"
> = {
  initiatives: "mechanical",
  trunk: "mechanical",
  detours: "judgment",
  sessionLinked: "correlational",
};
const INFO_HEALTH_KEYS = ["unclaimedPoolSize", "openPlanCount", "lastClosure"] as const;

/** Plain-language "what is this panel" explainer, opened from the header's
 *  info button. Self-contained: no iframe/redirect to any externally
 *  published page — every string routes through `planLedger.info.*` and
 *  every visual comes from the app's own card/badge classes, so it renders
 *  correctly in both themes and every locale this panel already supports.
 *  Follows the same backdrop/Escape/click-out dismissal convention as
 *  {@link ConfirmModal} and `ProjectDetail.tsx`'s own `RepoScanModal`. */
function ValuePoolInfoModal({
  open,
  onClose,
  t,
}: {
  open: boolean;
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("planLedger.info.title")}
    >
      <div
        className="relative w-full max-w-xl max-h-[85vh] rounded-xl border border-border bg-surface-1 shadow-xl shadow-black/40 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 pb-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center flex-shrink-0">
            <Info className="w-4.5 h-4.5 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-100">{t("planLedger.info.title")}</h3>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              {t("planLedger.info.subtitle")}
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

        <div className="px-5 pb-5 overflow-y-auto space-y-5">
          <p className="text-xs text-gray-300 leading-relaxed border-l-2 border-accent/50 pl-3">
            {t("planLedger.info.principle")}
          </p>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-300">
              {t("planLedger.info.feedsTitle")}
            </h4>
            <div className="space-y-1.5">
              {INFO_FEED_KEYS.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-200">
                      {t(`planLedger.info.feeds.${key}.name`)}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {t(`planLedger.info.feeds.${key}.desc`)}
                    </div>
                  </div>
                  <span className={`badge flex-shrink-0 ${TIER_BADGE_CLASS[INFO_FEED_TIER[key]]}`}>
                    {t(`planLedger.attribution.${INFO_FEED_TIER[key]}`)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 pt-1">
              {(["mechanical", "correlational", "judgment"] as const).map((tier) => (
                <span key={tier}>
                  <strong className="text-gray-300 font-medium">
                    {t(`planLedger.attribution.${tier}`)}
                  </strong>{" "}
                  — {t(`planLedger.info.tierKey.${tier}`)}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-gray-300">
              {t("planLedger.info.claimTitle")}
            </h4>
            <p className="text-[11px] text-gray-400">{t("planLedger.info.claimDesc")}</p>
            <p className="text-[11px] text-amber-400/90">{t("planLedger.info.claimNote")}</p>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-300">
              {t("planLedger.info.healthTitle")}
            </h4>
            <p className="text-[11px] text-gray-500">{t("planLedger.info.healthDesc")}</p>
            <dl className="grid grid-cols-3 gap-2">
              {INFO_HEALTH_KEYS.map((key) => (
                <div
                  key={key}
                  className="rounded-lg border border-border bg-surface-2/60 px-2.5 py-2"
                >
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {t(`planLedger.health.${key}`)}
                  </dt>
                  <dd className="text-[11px] text-gray-400 mt-1 leading-snug">
                    {t(`planLedger.info.healthDescs.${key}`)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-gray-300 leading-relaxed pt-1">
              {t("planLedger.info.closing")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 pt-3 flex-shrink-0 border-t border-border">
          <button onClick={onClose} className="btn-ghost border border-border text-xs">
            {t("repos.scanModal.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

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

/** One resolved unit's PROJECT/STAKEHOLDER synthesis, optionally carrying a
 *  freshness marker (mutability-aware caching, altitude-invalidation build):
 *  `freshness: "updated_unseen"` means this text just replaced a mutable
 *  unit's stale text and the user has not yet explicitly acknowledged it
 *  (the per-unit dismiss control below); `"stale_refresh_queued"`/
 *  `"stale_refresh_unavailable"` mean the unit's cache went stale but could
 *  NOT be refreshed this round — this is still its OLD text, never blanked.
 *  All three fields are absent on a plain resolved/cache-hit entry and on
 *  any older-server response (backward compat — `"freshness" in altitude`
 *  is the presence check used throughout, never a truthy check alone). */
type ResolvedAltitude = {
  project: string;
  stakeholder: string;
  freshness?: string;
  update_reason?: string;
  regenerated_at?: string | null;
};

/** One unit's PROJECT/STAKEHOLDER synthesis, four states (DEC-11):
 *  `undefined` while {@link api.projectPlans.altitudes} hasn't resolved for
 *  this unit yet this mount; `"queued"` when the server says this unit fell
 *  beyond this round's cap and was never attempted (a later pass — the
 *  background tick, `server/lib/value-summary-tick.js` — will pick it up);
 *  `"unavailable"` when the server attempted this unit and still produced
 *  nothing (LLM off, spawn failure, unparsable output) OR when an older
 *  server sent no `states` entry at all (the safe fallback — precedent:
 *  `TrunkDriftResult["skipped"]`); or the resolved {@link ResolvedAltitude}.
 *  The two string literals mirror `server/lib/value-summary.js`'s
 *  `ALTITUDE_STATES` export — that export is the canonical source (§9.7);
 *  this union is a known, hand-maintained cross-runtime member because a
 *  CJS server module cannot be imported across the Vite/Node boundary. */
type Altitude = ResolvedAltitude | "queued" | "unavailable" | undefined;

/** Chooses the i18n key for one resolved altitude's freshness marker —
 *  never a hardcoded English string, and never a raw `update_reason`/
 *  `freshness` value interpolated into a key (that would fabricate a key
 *  this file's registry never declared, the exact §9.7 hazard this helper
 *  exists to close off). Returns `null` when the entry carries no
 *  `freshness` at all (a plain resolved entry, or an older-server
 *  response) — the ONLY case with no marker control. Any `freshness` value
 *  outside {@link ALTITUDE_FRESHNESS} still renders (generic fallback,
 *  A-6) after the caller warns once (see the altitude-fetch effect below). */
function altitudeMarkerKey(altitude: ResolvedAltitude): string | null {
  if (!("freshness" in altitude) || !altitude.freshness) return null;
  if (altitude.freshness === "stale_refresh_queued") {
    return "planLedger.pool.altitudes.staleRefreshQueued";
  }
  if (altitude.freshness === "stale_refresh_unavailable") {
    return "planLedger.pool.altitudes.staleRefreshUnavailable";
  }
  if (altitude.freshness === "updated_unseen") {
    if (altitude.update_reason === "stage_changed") {
      return "planLedger.pool.altitudes.updatedStageChanged";
    }
    if (altitude.update_reason === "label_changed") {
      return "planLedger.pool.altitudes.updatedLabelChanged";
    }
    return "planLedger.pool.altitudes.updatedGeneric";
  }
  // Out-of-registry freshness value (future server, or a malformed
  // response) — same generic fallback rather than rendering nothing.
  return "planLedger.pool.altitudes.updatedGeneric";
}

/** Renders one altitude line's content: the resolved text, or a muted
 *  "generating…"/"queued"/"unavailable" placeholder — never blank, so the
 *  row's three-line shape never jumps as altitudes resolve. Reads `field`
 *  off the whole `altitude` object itself (not a pre-extracted value) —
 *  optional chaining on a string altitude collapses to `undefined` at the
 *  field level, which would make "resolved but unavailable" indistinguishable
 *  from "not yet resolved". */
function AltitudeText({
  altitude,
  field,
  t,
}: {
  altitude: Altitude;
  field: "project" | "stakeholder";
  t: TFunc;
}) {
  if (altitude === undefined) {
    return (
      <span className="italic text-gray-600">{t("planLedger.pool.altitudes.generating")}</span>
    );
  }
  if (altitude === "queued") {
    return <span className="italic text-gray-600">{t("planLedger.pool.altitudes.queued")}</span>;
  }
  if (typeof altitude === "string") {
    // "unavailable", or any other unrecognized string — same safe fallback
    // (see the out-of-registry console.warn in the altitude effect below).
    return (
      <span className="italic text-gray-600">{t("planLedger.pool.altitudes.unavailable")}</span>
    );
  }
  return <>{altitude[field]}</>;
}

/** One value-pool unit at all three altitudes at once (Sara's 2026-08-04
 *  request): GROUND (the raw fact, exactly as before — source type, label,
 *  attribution-tier badge), PROJECT (a short relational phrase), and
 *  STAKEHOLDER (one plain sentence), joined by a small vertical "rail" whose
 *  dots grow from Ground to Stakeholder — the altitude that should read as
 *  most prominent gets the most visual weight. Project/Stakeholder text
 *  comes from `altitude`, resolved by the parent's batched {@link
 *  api.projectPlans.altitudes} call; see {@link Altitude} for its
 *  undefined/null/resolved states. */
function ValueUnitRow({
  unit,
  altitude,
  openItems,
  busy,
  onClaim,
  onAcknowledge,
  t,
}: {
  unit: ValueUnit;
  altitude: Altitude;
  openItems: Array<{ id: number; text: string }>;
  busy: boolean;
  onClaim: (unit: ValueUnit, itemId: number) => void;
  onAcknowledge: (unit: ValueUnit, altitude: ResolvedAltitude) => void;
  t: TFunc;
}) {
  const [targetItemId, setTargetItemId] = useState<number | null>(openItems[0]?.id ?? null);
  // A resolved entry only (never "queued"/"unavailable"/undefined) can carry
  // a freshness marker — `altitude[field]` above already narrows this same
  // way for AltitudeText's own object branch.
  const resolved = altitude && typeof altitude === "object" ? (altitude as ResolvedAltitude) : null;
  const markerKey = resolved ? altitudeMarkerKey(resolved) : null;
  return (
    <div
      data-test="pool-unit"
      className="rounded-lg border border-border bg-surface-1/60 px-3 py-2.5 mb-2"
    >
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-3 flex-shrink-0 pt-1">
          <span className="w-1.5 h-1.5 rounded-full bg-surface-5 border border-border-light flex-shrink-0" />
          <span className="w-px flex-1 bg-border-light my-0.5" />
          <span className="w-2 h-2 rounded-full bg-surface-5 border border-border-light flex-shrink-0" />
          <span className="w-px flex-1 bg-border-light my-0.5" />
          <span className="w-2.5 h-2.5 rounded-full bg-accent ring-[3px] ring-accent-muted flex-shrink-0" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="w-16 flex-shrink-0 text-[9px] font-mono uppercase tracking-wide text-gray-600">
              {t("planLedger.pool.levels.ground")}
            </span>
            <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-mono text-gray-300">{unit.source}</span>
              {unit.label && (
                <span className="text-[11px] font-mono text-gray-500 truncate">{unit.label}</span>
              )}
              <span className={`badge flex-shrink-0 ${TIER_BADGE_CLASS[unit.attribution]}`}>
                {t(`planLedger.attribution.${unit.attribution}`)}
              </span>
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="w-16 flex-shrink-0 text-[9px] font-mono uppercase tracking-wide text-gray-600">
              {t("planLedger.pool.levels.project")}
            </span>
            <div className="min-w-0 flex-1 text-[12px] text-gray-400">
              <AltitudeText altitude={altitude} field="project" t={t} />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="w-16 flex-shrink-0 text-[9px] font-mono uppercase tracking-wide text-accent-hover">
              {t("planLedger.pool.levels.stakeholder")}
            </span>
            <div className="min-w-0 flex-1 text-[13px] font-medium text-gray-100">
              <AltitudeText altitude={altitude} field="stakeholder" t={t} />
            </div>
          </div>
          {markerKey && resolved && (
            <div className="flex items-center gap-1.5 pl-[calc(4rem+0.5rem)]">
              <span className="text-[10px] text-amber-400/90 italic">{t(markerKey)}</span>
              {/* SF-2: the dismiss control only makes sense for
                  `updated_unseen` — the marker that means "this text WAS
                  just regenerated; has the user seen it." A
                  `stale_refresh_queued`/`stale_refresh_unavailable` row is
                  still serving its OLD, never-regenerated text (this round
                  simply couldn't refresh it); there is no new generation to
                  acknowledge. Rendering a dismiss control there let a click
                  send the row's stale `regenerated_at` (an EARLIER,
                  separate, already-served generation) to the compare-and-set
                  seen endpoint, which could mis-stamp `seen_at` for that
                  earlier generation and silently swallow a later, genuinely
                  unacknowledged `updated_unseen` marker for the same unit —
                  the exact T-D class DEC-17's CAS exists to prevent. Those
                  markers keep their informational text above; they simply
                  get no dismiss affordance (server re-derives them from
                  staleness on every read regardless of any client action). */}
              {resolved.freshness === "updated_unseen" && (
                <button
                  type="button"
                  aria-label={t("planLedger.pool.altitudes.dismiss")}
                  title={t("planLedger.pool.altitudes.dismiss")}
                  onClick={() => onAcknowledge(unit, resolved)}
                  className="text-[11px] leading-none text-gray-500 hover:text-gray-300 px-1 rounded"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {openItems.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border pl-6">
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
 *  snapshot rather than three independently-stale fetches. PROJECT/
 *  STAKEHOLDER altitudes are a separate, non-blocking fetch ({@link
 *  api.projectPlans.altitudes}) kicked off once the pool's units are known —
 *  deliberately NOT folded into the `load()` Promise.all above, so a cold
 *  cache's LLM latency (server/lib/value-summary.js) never delays the rest
 *  of the panel, same separation Focus's own window-summary block already
 *  uses relative to its main report fetch. */
export function PlanLedgerPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation("projectDetail");
  const [plans, setPlans] = useState<ProjectPlanWithItems[]>([]);
  const [units, setUnits] = useState<ValueUnit[]>([]);
  const [health, setHealth] = useState<PlanHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimingUnitId, setClaimingUnitId] = useState<string | null>(null);
  const [closingPlanId, setClosingPlanId] = useState<number | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [altitudes, setAltitudes] = useState<Record<string, Altitude>>({});
  // Value Pool Slice 2: the single coverage/ETA snapshot, server-computed
  // (server/lib/value-coverage.js) and rendered verbatim — this component
  // never derives `described`/`pending`/`complete`/an ETA number itself.
  const [coverage, setCoverage] = useState<CoverageSnapshot | null>(null);
  const [requestingCoverage, setRequestingCoverage] = useState(false);
  // Tracks every unit id ever requested, independent of `altitudes` state
  // timing — the effect below reads this instead of `altitudes` itself so
  // it never needs `altitudes` in its own dependency array (no feedback
  // loop between "state I set" and "state that re-triggers me").
  const requestedAltitudesRef = useRef<Set<string>>(new Set());
  // Mirrors `units` for the eventBus handler below (WATCH-S2-B), which is
  // subscribed once per `projectId` (not re-subscribed on every pool
  // change) and therefore needs a way to read the CURRENT pool without a
  // stale closure over an old `units` array.
  const unitsRef = useRef<ValueUnit[]>([]);
  useEffect(() => {
    unitsRef.current = units;
  }, [units]);
  const mountedRef = useRef(true);
  useEffect(() => {
    // Re-arm on every setup, not just at the initial `useRef(true)` — under
    // React 18 StrictMode dev double-invoke (setup -> cleanup -> setup),
    // leaving this armed only once at declaration time means the SECOND
    // setup never restores `true` after the first cleanup flips it `false`,
    // so `mountedRef.current` stays `false` for the component's entire life
    // and every `fetchAltitudesFor` response / `handlePrioritizeNow` finally
    // block silently no-ops (build-reviewer BL-2). Mirrors the per-effect
    // `let cancelled = false` local this replaced, just shared across this
    // component's several callbacks instead of scoped to one effect.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const [plansRes, poolRes, healthRes, coverageRes] = await Promise.all([
        api.projectPlans.list(projectId),
        api.projectPlans.pool(projectId),
        api.projectPlans.health(projectId),
        api.projectPlans.coverage(projectId),
      ]);
      setPlans(plansRes.plans);
      setUnits(poolRes.units);
      setHealth(healthRes);
      setCoverage((prev) => mergeCoverage(prev, coverageRes.coverage));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Shared altitude-fetch body — called both for genuinely-new pool units
  // (the effect below) and for the eventBus handler's WATCH-S2-B refetch of
  // exactly the units a live broadcast named (never the whole pool, never
  // coverage — the message IS the coverage).
  const fetchAltitudesFor = useCallback(
    (unitsToFetch: ValueUnit[]) => {
      if (unitsToFetch.length === 0) return;
      api.projectPlans
        .altitudes(projectId, unitsToFetch)
        .then((res) => {
          if (!mountedRef.current) return;
          // T-E trap coverage: an out-of-registry states value (a malformed
          // new-server response) must not silently masquerade as an
          // old-server absence — warn once per occurrence so it is visible in
          // dev, then still fall through to the same safe "unavailable"
          // render as any other unrecognized string (see AltitudeText above).
          for (const [uid, state] of Object.entries(res.states ?? {})) {
            if (state && !["queued", "unavailable"].includes(state)) {
              console.warn(
                `Altitude state "${state}" not in ALTITUDE_STATES registry for unit ${uid}`
              );
            }
          }
          // Same T-E-shaped coverage for the new freshness registry: an
          // out-of-registry `freshness` value (a malformed/future-server
          // response) still renders (generic fallback, altitudeMarkerKey
          // above) but is never silently unremarked in dev.
          for (const [uid, entry] of Object.entries(res.altitudes)) {
            const freshness = (entry as { freshness?: string }).freshness;
            if (
              freshness &&
              !ALTITUDE_FRESHNESS.includes(freshness as (typeof ALTITUDE_FRESHNESS)[number])
            ) {
              console.warn(
                `Altitude freshness "${freshness}" not in ALTITUDE_FRESHNESS registry for unit ${uid}`
              );
            }
          }
          setAltitudes((prev) => {
            const next = { ...prev };
            for (const u of unitsToFetch) {
              const a = res.altitudes[u.id];
              next[u.id] = a
                ? {
                    project: a.project,
                    stakeholder: a.stakeholder,
                    ...(a.freshness ? { freshness: a.freshness } : {}),
                    ...(a.update_reason ? { update_reason: a.update_reason } : {}),
                    ...("regenerated_at" in a ? { regenerated_at: a.regenerated_at ?? null } : {}),
                  }
                : res.states?.[u.id] === "queued"
                  ? "queued"
                  : "unavailable";
            }
            return next;
          });
        })
        .catch(() => {
          if (!mountedRef.current) return;
          setAltitudes((prev) => {
            const next = { ...prev };
            for (const u of unitsToFetch) next[u.id] = "unavailable";
            return next;
          });
        });
    },
    [projectId]
  );

  useEffect(() => {
    const missing = units.filter((u) => !requestedAltitudesRef.current.has(u.id));
    if (missing.length === 0) return;
    for (const u of missing) requestedAltitudesRef.current.add(u.id);
    fetchAltitudesFor(missing);
  }, [units, fetchAltitudesFor]);

  // Value Pool Slice 2 (§3.6c–f): this panel's FIRST-EVER eventBus
  // subscription. The handler must not throw — eventBus.publish is
  // synchronous and a throwing subscriber aborts delivery to the handlers
  // registered after it (colorThresholds.ts:105 / focusStore.ts precedent),
  // so the entire body is wrapped in try/catch. The subscriber NEVER
  // refetches coverage on a WS message — the message IS the coverage
  // (merged via the monotonic {@link mergeCoverage} rule); it only refetches
  // altitude TEXTS, and only for the message's own `unit_keys` (WATCH-S2-B).
  useEffect(() => {
    if (!projectId) return;
    const unsubscribe = eventBus.subscribe((msg) => {
      try {
        if (msg.type !== "value_altitudes_updated") return;
        const data = msg.data as ValueAltitudesUpdatedPayload;
        if (!data || data.project_id !== projectId) return;

        if (data.coverage) {
          setCoverage((prev) => mergeCoverage(prev, data.coverage));
        }

        if (Array.isArray(data.unit_keys) && data.unit_keys.length > 0) {
          const keySet = new Set(data.unit_keys);
          // Relax the once-ever semantics for exactly these keys — a live-
          // updated unit must refetch its text, not sit stale forever
          // because it was already "requested" once (WATCH-S2-B).
          for (const key of keySet) requestedAltitudesRef.current.delete(key);
          const toRefetch = unitsRef.current.filter((u) => keySet.has(u.id));
          for (const u of toRefetch) requestedAltitudesRef.current.add(u.id);
          fetchAltitudesFor(toRefetch);
        }
      } catch {
        /* a throwing subscriber must not abort other eventBus handlers */
      }
    });
    return unsubscribe;
  }, [projectId, fetchAltitudesFor]);

  const handlePrioritizeNow = useCallback(async () => {
    if (!projectId) return;
    setRequestingCoverage(true);
    try {
      const res = await api.projectPlans.requestCoverage(projectId);
      setCoverage((prev) => mergeCoverage(prev, res.coverage));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setRequestingCoverage(false);
    }
  }, [projectId]);

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

  // Explicit acknowledge only (DEC-8) — never called from a render/effect,
  // only from ValueUnitRow's dismiss button's own onClick. Optimistically
  // clears the local marker on success so the row doesn't wait for the next
  // altitude fetch to stop showing it; a failure leaves the marker exactly
  // as it was (no optimistic clear), matching the server's own
  // compare-and-set semantics (a stale/failed acknowledge must not look
  // like it succeeded).
  const handleAcknowledge = useCallback(
    async (unit: ValueUnit, altitude: ResolvedAltitude) => {
      try {
        await api.projectPlans.markAltitudesSeen(projectId, [
          { unit_key: unit.id, regenerated_at: altitude.regenerated_at ?? null },
        ]);
        setAltitudes((prev) => {
          const current = prev[unit.id];
          if (!current || typeof current !== "object") return prev;
          const { freshness: _freshness, update_reason: _updateReason, ...rest } = current;
          return { ...prev, [unit.id]: rest };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId]
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
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          title={t("planLedger.info.buttonLabel")}
          aria-label={t("planLedger.info.buttonLabel")}
          className="text-gray-500 hover:text-accent p-1 rounded-md flex-shrink-0"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>

      <ValuePoolInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} t={t} />

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
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h3 className="text-xs font-semibold text-gray-300">{t("planLedger.pool.title")}</h3>
            {coverage && coverage.pool_size > 0 && (
              <div
                className="flex items-center gap-2 text-[11px] text-gray-400"
                data-test="coverage-header"
              >
                <span>
                  {t("planLedger.pool.coverage.header", {
                    described: coverage.described,
                    poolSize: coverage.pool_size,
                  })}
                  {coverage.eta.state === "measured" && (
                    <>
                      {" · "}
                      {t("planLedger.pool.coverage.etaRemaining", {
                        minutes: formatEtaMinutes(coverage.eta.ms_remaining),
                      })}
                    </>
                  )}
                  {coverage.eta.state === "estimating" && (
                    <> · {t("planLedger.pool.coverage.estimating")}</>
                  )}
                </span>
                {coverage.demand === "requested" && (
                  <span className="text-accent">{t("planLedger.pool.coverage.requested")}</span>
                )}
                {coverage.demand === "draining" && (
                  <span className="text-accent">{t("planLedger.pool.coverage.draining")}</span>
                )}
                {!coverage.complete && coverage.demand === "passive" && (
                  <button
                    type="button"
                    onClick={handlePrioritizeNow}
                    disabled={requestingCoverage}
                    data-test="prioritize-now-button"
                    className="text-[11px] text-accent hover:underline disabled:opacity-50"
                  >
                    {t("planLedger.pool.coverage.prioritizeNow")}
                  </button>
                )}
              </div>
            )}
          </div>
          {units.length === 0 ? (
            <p className="text-xs text-gray-500 italic">{t("planLedger.pool.empty")}</p>
          ) : (
            units.map((unit) => (
              <ValueUnitRow
                key={unit.id}
                unit={unit}
                altitude={altitudes[unit.id]}
                openItems={openItems}
                busy={claimingUnitId === unit.id}
                onClaim={handleClaim}
                onAcknowledge={handleAcknowledge}
                t={t}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
