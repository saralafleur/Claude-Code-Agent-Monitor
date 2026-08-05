/**
 * @file PlaybookPage.tsx
 * @description Standalone page (route `/coach/playbook`) — the Playbook
 * editor: turn a practice on/off and tune its config, both server-shared and
 * live across every connected computer (`playbookStore.ts`, the same
 * server-persisted/WS-broadcast shape `colorThresholds.ts` already
 * established for the Usage page's Color Thresholds card).
 *
 * Master-detail layout: `PlaybookSidecar`, a page-local left rail (there is
 * no shared sidecar/master-detail component elsewhere in this codebase —
 * every other tabbed page, e.g. `CcConfig.tsx`, uses a horizontal tab bar
 * instead — so this is a new, narrow-purpose component, not a reuse), lists
 * **Settings** first, then one entry per catalog practice (name + an
 * enabled/disabled dot), and the body to its right renders exactly ONE
 * selected item's full card — `GlobalSettingsCard` for Settings, or the
 * matching `PRACTICE_CARDS` entry for a practice. Selection is local
 * `useState` (`selectedId`, defaulting to `"settings"` so the body always
 * has something to show even before `usePlaybookPractices()` hydrates), not
 * URL-driven — same disposition `CcConfig.tsx`'s own tab state uses.
 * Switching away from a card unmounts it, discarding any in-progress unsaved
 * edit on that card — acceptable since this mirrors how every other
 * conditionally-rendered tab panel in this codebase already behaves.
 *
 * `session-token-ceiling` gets its own k/m/b-shorthand token-field card.
 * `account-weekly-balance` has no editable field of its own at all — its
 * one trigger threshold is `color_thresholds.rotation_switch_pct`, shared
 * with the Usage page's Rotation Plan card via `useColorThresholds()`
 * (read-only here; edited on the Usage page), so its card is just the
 * enable toggle, kind/severity overrides, and a live preview — see
 * `AccountWeeklyBalanceCard`'s own doc comment. A third practice is a new
 * `PRACTICE_CARDS` entry, not a page rewrite. `GlobalSettingsCard`
 * (`playbookSettingsStore.ts` — see its own doc comment for why this is a
 * separate singleton store, not another practice card) edits the Playbook's
 * one global setting: the auto-resolve time window every practice's open
 * Observations share.
 *
 * Each card with an editable field seeds its own draft state from its
 * practice's config once, on first arrival (not re-synced on every later
 * store update) — a deliberately simpler version of `Usage.tsx`'s
 * `ColorThresholdsCard` "resync only while the draft still matches what was
 * last saved" dance, since a single numeric field per card makes an
 * in-progress-edit collision unlikely enough that the extra bookkeeping
 * isn't worth it yet.
 *
 * The live preview below each card reuses `ObservationCard` in preview mode
 * (no `detectedAt`/`onRespond`) fed the draft's own current values, so
 * typing a new threshold visibly changes exactly what would show up in the
 * Feed — the same component, not a look-alike.
 *
 * `session-token-ceiling`'s card also renders a toggle for its boolean
 * `autoResolveOnSessionEnd` field (`ToggleField`, reusing
 * `PracticeCardShell`'s own enable/disable switch markup) — tracked as its
 * own draft state, parallel to `kindDraft`/`severityDraft`, not folded into
 * the numeric `draft` object, since only the token field needs the
 * k/m/b-shorthand text-parsing dance this component already does.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Compass } from "lucide-react";
import { usePlaybookPractices, playbookStore, resolveDraftKind } from "../lib/playbookStore";
import { useColorThresholds } from "../lib/colorThresholds";
import {
  usePlaybookSettings,
  playbookSettingsStore,
  DEFAULT_PLAYBOOK_SETTINGS,
} from "../lib/playbookSettingsStore";
import { CoachTabs } from "../components/coach/CoachTabs";
import { ObservationCard } from "../components/coach/ObservationCard";
import { parseTokenShorthand, fmtTokensFull } from "../lib/format";
import type { ObservationKind, ObservationSeverity, PlaybookPractice } from "../lib/types";

const MS_PER_MINUTE = 60_000;

const KIND_OPTIONS: ObservationKind[] = ["risk", "info", "good"];
const SEVERITY_OPTIONS: ObservationSeverity[] = ["info", "warning"];

/** Shared kind/severity override selector, rendered on every practice card
 *  (DEC-2 — the override mechanism is generic, no per-practice special
 *  case). Free choice of any value, including "downgrades" (DEC-4) — no
 *  ordering is enforced or implied by the option order below. The first
 *  option on each selector is "use default", which sends `null` (clears any
 *  stored override back to the catalog value) rather than omitting the key.
 *
 *  WATCH-2: the severity selector here has no visible effect anywhere in the
 *  product today — `ObservationCard.tsx` never renders severity, so a
 *  `severityOverride` only ever shows up in the raw API/WS payload, not in
 *  any preview or the live Feed. The control is still wired end-to-end
 *  (saved, resolved, round-tripped) so it's ready the moment a consumer
 *  renders severity; it isn't dead code, just not yet visibly wired up. */
function OverrideSelects({
  practice,
  kindDraft,
  severityDraft,
  onKind,
  onSeverity,
}: {
  practice: PlaybookPractice;
  kindDraft: ObservationKind | null | undefined;
  severityDraft: ObservationSeverity | null | undefined;
  onKind: (v: ObservationKind | null) => void;
  onSeverity: (v: ObservationSeverity | null) => void;
}) {
  const { t } = useTranslation("coach");
  // Destructured (not read as dot-notation off `practice` inline below) so
  // this file has zero raw reads of the practice's catalog kind/severity
  // fields outside their PlaybookPractice interface declaration in
  // types.ts — enforced by playbook-resolver-guard.test.js's client-
  // display-path assertion. Reading the catalog value here is still
  // correct, not a resolver bypass: the "use default (X)" option is
  // supposed to name the catalog default, not the resolved value.
  const {
    kind: catalogKind,
    defaultSeverity: catalogSeverity,
    kindOverride,
    severityOverride,
  } = practice;
  const kindValue = kindDraft !== undefined ? kindDraft : kindOverride;
  const severityValue = severityDraft !== undefined ? severityDraft : severityOverride;

  return (
    <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-3 max-w-xs">
      <label className="block text-xs text-gray-400">
        <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
          {t("playbook.kindOverrideLabel")}
        </span>
        <select
          value={kindValue ?? ""}
          onChange={(e) =>
            onKind(e.target.value === "" ? null : (e.target.value as ObservationKind))
          }
          className="w-full bg-surface-3 border border-border rounded-lg text-gray-100 text-xs px-2 py-1.5"
        >
          <option value="">
            {t("playbook.useDefaultOption", { value: t(`kindLabel.${catalogKind}`) })}
          </option>
          {KIND_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {t(`kindLabel.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-gray-400">
        <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
          {t("playbook.severityOverrideLabel")}
        </span>
        <select
          value={severityValue ?? ""}
          onChange={(e) =>
            onSeverity(e.target.value === "" ? null : (e.target.value as ObservationSeverity))
          }
          className="w-full bg-surface-3 border border-border rounded-lg text-gray-100 text-xs px-2 py-1.5"
        >
          <option value="">
            {t("playbook.useDefaultOption", { value: t(`severityLabel.${catalogSeverity}`) })}
          </option>
          {SEVERITY_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {t(`severityLabel.${value}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

interface PracticeCardProps {
  practice: PlaybookPractice;
}

// Common ceilings, offered as one-click chips next to the free-text field.
const TOKEN_PRESETS = [
  { value: 500_000, label: "500K" },
  { value: 1_000_000, label: "1M" },
  { value: 5_000_000, label: "5M" },
  { value: 10_000_000, label: "10M" },
  { value: 50_000_000, label: "50M" },
  { value: 100_000_000, label: "100M" },
];

/** Shared card chrome (toggle, name/description, scope badge) every
 *  practice card wraps its own field UI in — keeps that layout in one place
 *  instead of duplicated per practice. */
function PracticeCardShell({
  practice,
  nameKey,
  descriptionKey,
  enabled,
  onToggle,
  children,
}: {
  practice: PlaybookPractice;
  nameKey: string;
  descriptionKey: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("coach");
  return (
    <div className="card p-5">
      <div className="flex items-start gap-3">
        <label className="flex-shrink-0 mt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="peer sr-only"
            aria-label={t(nameKey)}
          />
          <span className="block w-8 h-[18px] rounded-full bg-surface-5 border border-border-light peer-checked:bg-accent peer-checked:border-accent transition-colors relative">
            <span className="absolute top-[1px] left-[1px] w-[14px] h-[14px] rounded-full bg-gray-400 peer-checked:bg-white peer-checked:translate-x-[14px] transition-transform" />
          </span>
        </label>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-100">{t(nameKey)}</h2>
            <code className="text-[10.5px] text-gray-600">{practice.id}</code>
          </div>
          <p className="text-xs text-gray-500 mt-1">{t(descriptionKey)}</p>
        </div>
        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-surface-4 text-gray-400 border border-border-light flex-shrink-0">
          {t(`scopeLabel.${practice.scope}`)}
        </span>
      </div>
      {children}
    </div>
  );
}

/** A labeled boolean toggle for one `fields` entry whose `type` is
 *  `"boolean"` (e.g. session-token-ceiling's `autoResolveOnSessionEnd`) —
 *  same switch markup as `PracticeCardShell`'s own enable/disable control,
 *  just labeled inline instead of in the card header. */
function ToggleField({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="mt-4 pt-4 border-t border-border flex items-start gap-3">
      <label htmlFor={id} className="flex-shrink-0 mt-0.5 cursor-pointer">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
          aria-label={label}
        />
        <span className="block w-8 h-[18px] rounded-full bg-surface-5 border border-border-light peer-checked:bg-accent peer-checked:border-accent transition-colors relative">
          <span className="absolute top-[1px] left-[1px] w-[14px] h-[14px] rounded-full bg-gray-400 peer-checked:bg-white peer-checked:translate-x-[14px] transition-transform" />
        </span>
      </label>
      <div className="flex-1 min-w-0">
        <label htmlFor={id} className="block text-xs font-medium text-gray-300 cursor-pointer">
          {label}
        </label>
        <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>
      </div>
    </div>
  );
}

/** Save/Reset row + "Saved" pulse, shared by every practice card. */
function PracticeCardActions({
  saving,
  isValid,
  isDirty,
  savedPulse,
  onSave,
  onReset,
}: {
  saving: boolean;
  isValid: boolean;
  isDirty: boolean;
  savedPulse: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation("coach");
  return (
    <div className="flex items-center gap-2 mt-4">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !isValid || !isDirty}
        className="btn-primary text-xs disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? t("playbook.saving") : t("playbook.save")}
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={saving}
        className="btn-ghost text-xs disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {t("playbook.resetDefault")}
      </button>
      {savedPulse && (
        <span className="text-[11px] text-emerald-400 ml-1">{t("playbook.saved")}</span>
      )}
    </div>
  );
}

function useSavePulse() {
  const [saving, setSaving] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const save = async (run: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await run();
      setSavedPulse(true);
      setTimeout(() => setSavedPulse(false), 2200);
    } finally {
      setSaving(false);
    }
  };
  return { saving, savedPulse, save };
}

function SessionTokenCeilingCard({ practice }: PracticeCardProps) {
  const { t } = useTranslation("coach");
  const [enabled, setEnabled] = useState(practice.enabled);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [thresholdText, setThresholdText] = useState("");
  const [kindDraft, setKindDraft] = useState<ObservationKind | null | undefined>(undefined);
  const [severityDraft, setSeverityDraft] = useState<ObservationSeverity | null | undefined>(
    undefined
  );
  const [autoResolveDraft, setAutoResolveDraft] = useState<boolean | undefined>(undefined);
  const seeded = useRef(false);
  const { saving, savedPulse, save } = useSavePulse();

  // `fields[0]` (thresholdTokens) is a "number" field — practices.js's
  // catalog order is fixed per practice id, so this positional read is safe
  // the same way it always has been; only the TS type is a union now (a
  // sibling "boolean" field on the same practice), so this local narrowing
  // cast keeps every existing numeric use below (min/default/arithmetic)
  // exactly as it was instead of scattering casts through the whole card.
  const field = practice.fields[0] as { key: string; default: number; min: number } | undefined;
  // autoResolveOnSessionEnd is looked up by key (not position) since it's
  // the second, independently-added field — resolveDraftKind-style optional
  // chaining below already handles it being absent on a differently-shaped
  // practice, so this card degrades gracefully if the catalog ever changes.
  const autoResolveField = practice.fields.find((f) => f.key === "autoResolveOnSessionEnd") as
    | { key: string; default: boolean }
    | undefined;

  useEffect(() => {
    if (field && !seeded.current) {
      setThresholdText(
        fmtTokensFull((practice.config[field.key] as number | undefined) ?? field.default)
      );
      seeded.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice]);

  if (!field) return null;

  const draftValue =
    draft[field.key] ?? (practice.config[field.key] as number | undefined) ?? field.default;
  const autoResolveCurrent = autoResolveField
    ? ((practice.config[autoResolveField.key] as boolean | undefined) ?? autoResolveField.default)
    : true;
  const autoResolveValue = autoResolveDraft !== undefined ? autoResolveDraft : autoResolveCurrent;
  const isDirty =
    enabled !== practice.enabled ||
    draftValue !== ((practice.config[field.key] as number | undefined) ?? field.default) ||
    (kindDraft !== undefined && kindDraft !== practice.kindOverride) ||
    (severityDraft !== undefined && severityDraft !== practice.severityOverride) ||
    (autoResolveDraft !== undefined && autoResolveDraft !== autoResolveCurrent);
  const parsedThreshold = parseTokenShorthand(thresholdText);
  const isValid = parsedThreshold !== null && parsedThreshold >= field.min;

  const applyThreshold = (value: number) => {
    setDraft({ [field.key]: value });
    setThresholdText(fmtTokensFull(value));
  };

  return (
    <PracticeCardShell
      practice={practice}
      nameKey="practices.sessionTokenCeiling.name"
      descriptionKey="practices.sessionTokenCeiling.description"
      enabled={enabled}
      onToggle={setEnabled}
    >
      <div className="mt-4 pt-4 border-t border-border">
        <label
          htmlFor={`${practice.id}-field`}
          className="block text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5"
        >
          {t("practices.sessionTokenCeiling.fieldLabel")}
        </label>
        <div className="flex items-stretch border border-border rounded-lg overflow-hidden bg-surface-3 max-w-xs">
          <input
            id={`${practice.id}-field`}
            type="text"
            inputMode="decimal"
            placeholder={t("practices.sessionTokenCeiling.hint")}
            value={thresholdText}
            onChange={(e) => {
              const raw = e.target.value;
              setThresholdText(raw);
              const parsed = parseTokenShorthand(raw);
              if (parsed !== null) setDraft({ [field.key]: parsed });
            }}
            onBlur={() => {
              if (parsedThreshold !== null) setThresholdText(fmtTokensFull(parsedThreshold));
            }}
            className="flex-1 min-w-0 bg-transparent border-none text-gray-100 font-mono text-sm px-2.5 py-1.5 tabular-nums focus:outline-none"
          />
          <span className="flex items-center px-2.5 text-[11px] text-gray-500 bg-surface-4 border-l border-border">
            {t("practices.sessionTokenCeiling.unit")}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {TOKEN_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => applyThreshold(preset.value)}
              className={`text-[11px] font-mono px-2 py-1 rounded-md border transition-colors ${
                draftValue === preset.value
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border-light bg-surface-3 text-gray-400 hover:text-gray-200 hover:border-border"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {!isValid && (
          <p className="text-[11px] text-red-400 mt-1.5">
            {parsedThreshold === null
              ? t("playbook.parseError")
              : t("playbook.minError", { min: field.min.toLocaleString() })}
          </p>
        )}
      </div>

      {autoResolveField && (
        <ToggleField
          id={`${practice.id}-auto-resolve-on-session-end`}
          checked={autoResolveValue}
          onChange={setAutoResolveDraft}
          label={t("practices.sessionTokenCeiling.autoResolveOnSessionEndLabel")}
          hint={t("practices.sessionTokenCeiling.autoResolveOnSessionEndHint")}
        />
      )}

      <OverrideSelects
        practice={practice}
        kindDraft={kindDraft}
        severityDraft={severityDraft}
        onKind={setKindDraft}
        onSeverity={setSeverityDraft}
      />

      <div className="mt-4 pt-4 border-t border-border">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
          {t("playbook.previewLabel")}
        </div>
        <ObservationCard
          practiceId={practice.id}
          kind={
            kindDraft === undefined ? practice.resolvedKind : resolveDraftKind(practice, kindDraft)
          }
          values={{ totalTokens: draftValue * 1.024, thresholdTokens: draftValue }}
        />
      </div>

      <PracticeCardActions
        saving={saving}
        isValid={isValid}
        isDirty={isDirty}
        savedPulse={savedPulse}
        onSave={() =>
          save(() =>
            playbookStore.save(practice.id, {
              enabled,
              config: {
                // draftValue (not the possibly-empty `draft` object) so the
                // threshold is always sent at its current resolved value,
                // touched or not — same "always send this field" behavior
                // this card always had, from back when it was the only field.
                [field.key]: draftValue,
                // Only included when the operator actually touched the
                // toggle — an untouched toggle must not add a key and
                // silently overwrite whatever's already stored server-side.
                ...(autoResolveDraft !== undefined && autoResolveField
                  ? { [autoResolveField.key]: autoResolveDraft }
                  : {}),
              },
              ...(kindDraft !== undefined ? { kindOverride: kindDraft } : {}),
              ...(severityDraft !== undefined ? { severityOverride: severityDraft } : {}),
            })
          )
        }
        onReset={() => {
          applyThreshold(field.default);
          setKindDraft(null);
          setSeverityDraft(null);
          if (autoResolveField) setAutoResolveDraft(autoResolveField.default);
        }}
      />
    </PracticeCardShell>
  );
}

/** Unlike session-token-ceiling, this practice carries no `fields` of its
 *  own — its one trigger threshold is `color_thresholds.rotation_switch_pct`,
 *  shared with the Usage page's Rotation Plan card via `useColorThresholds()`
 *  (same store that card itself reads), not a Coach-specific config value.
 *  So this card has nothing numeric to edit: just the enable toggle, the
 *  kind/severity overrides every practice gets, a read-only note pointing
 *  at where the threshold actually lives, and a live preview built from the
 *  current shared threshold. It also never shows an auto-resolve toggle —
 *  this practice's Observations always self-clear once the condition stops
 *  holding (server/lib/playbook/engine.js's `autoResolveClearedGlobalObservations`),
 *  no per-practice setting needed. */
function AccountWeeklyBalanceCard({ practice }: PracticeCardProps) {
  const { t } = useTranslation("coach");
  const { rotationSwitchPct } = useColorThresholds();
  const [enabled, setEnabled] = useState(practice.enabled);
  const [kindDraft, setKindDraft] = useState<ObservationKind | null | undefined>(undefined);
  const [severityDraft, setSeverityDraft] = useState<ObservationSeverity | null | undefined>(
    undefined
  );
  const { saving, savedPulse, save } = useSavePulse();

  const isDirty =
    enabled !== practice.enabled ||
    (kindDraft !== undefined && kindDraft !== practice.kindOverride) ||
    (severityDraft !== undefined && severityDraft !== practice.severityOverride);

  // Illustrative preview pair built from the real shared threshold, so
  // typing never applies here but the preview still reflects reality.
  const previewLowPct = Math.max(0, rotationSwitchPct - 40);
  const previewActivePct = rotationSwitchPct + 5;

  return (
    <PracticeCardShell
      practice={practice}
      nameKey="practices.accountWeeklyBalance.name"
      descriptionKey="practices.accountWeeklyBalance.description"
      enabled={enabled}
      onToggle={setEnabled}
    >
      <p className="mt-4 pt-4 border-t border-border text-xs text-gray-500">
        {t("practices.accountWeeklyBalance.thresholdInfo", { value: rotationSwitchPct })}
      </p>
      <p className="mt-2 text-xs text-gray-500">
        {t("practices.accountWeeklyBalance.autoResolveNote")}
      </p>

      <OverrideSelects
        practice={practice}
        kindDraft={kindDraft}
        severityDraft={severityDraft}
        onKind={setKindDraft}
        onSeverity={setSeverityDraft}
      />

      <div className="mt-4 pt-4 border-t border-border">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
          {t("playbook.previewLabel")}
        </div>
        <ObservationCard
          practiceId={practice.id}
          kind={
            kindDraft === undefined ? practice.resolvedKind : resolveDraftKind(practice, kindDraft)
          }
          values={{
            activeLabel: t("practices.accountWeeklyBalance.previewActiveLabel"),
            activePct: previewActivePct,
            lowLabel: t("practices.accountWeeklyBalance.previewLowLabel"),
            lowPct: previewLowPct,
            rotationSwitchPct,
          }}
        />
      </div>

      <PracticeCardActions
        saving={saving}
        isValid={true}
        isDirty={isDirty}
        savedPulse={savedPulse}
        onSave={() =>
          save(() =>
            playbookStore.save(practice.id, {
              enabled,
              // See SessionTokenCeilingCard's onSave for why these are
              // conditionally included.
              ...(kindDraft !== undefined ? { kindOverride: kindDraft } : {}),
              ...(severityDraft !== undefined ? { severityOverride: severityDraft } : {}),
            })
          )
        }
        onReset={() => {
          setKindDraft(null);
          setSeverityDraft(null);
        }}
      />
    </PracticeCardShell>
  );
}

/** Maps a practice id to its card component — extend when a new practice ships. */
const PRACTICE_CARDS: Record<string, (props: PracticeCardProps) => React.JSX.Element | null> = {
  "session-token-ceiling": SessionTokenCeilingCard,
  "account-weekly-balance": AccountWeeklyBalanceCard,
};

/** Maps a practice id to its display-name i18n key — same catalog `PRACTICE_CARDS`
 *  extends alongside, kept separate since the sidecar needs just the name,
 *  not the whole card. */
const PRACTICE_NAME_KEYS: Record<string, string> = {
  "session-token-ceiling": "practices.sessionTokenCeiling.name",
  "account-weekly-balance": "practices.accountWeeklyBalance.name",
};

/** Edits the Playbook's one global setting — the auto-resolve time window
 *  every practice's open Observations share (playbookSettingsStore.ts's
 *  singleton, not a `PlaybookPractice` — no `enabled` toggle, no per-
 *  practice `fields`, so this is its own small card rather than another
 *  `PRACTICE_CARDS` entry). Editable in minutes — fine enough granularity to
 *  set a short backstop (a few minutes) without forcing fractional input,
 *  unlike the hours unit this replaced — converted to/from the millisecond
 *  value the API and DB actually store. */
function GlobalSettingsCard() {
  const { t } = useTranslation("coach");
  const settings = usePlaybookSettings();
  const [minutesText, setMinutesText] = useState("");
  const seeded = useRef(false);
  const { saving, savedPulse, save } = useSavePulse();

  useEffect(() => {
    if (!seeded.current) {
      setMinutesText(String(settings.autoResolveAfterMs / MS_PER_MINUTE));
      seeded.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const parsedMinutes = Number(minutesText);
  const isValid = minutesText.trim() !== "" && Number.isFinite(parsedMinutes) && parsedMinutes >= 0;
  const draftMs = isValid ? Math.round(parsedMinutes * MS_PER_MINUTE) : settings.autoResolveAfterMs;
  const isDirty = isValid && draftMs !== settings.autoResolveAfterMs;

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-gray-100">{t("playbook.settingsTitle")}</h2>
      <p className="text-xs text-gray-500 mt-1">{t("playbook.settingsDescription")}</p>

      <div className="mt-4">
        <label
          htmlFor="playbook-auto-resolve-minutes"
          className="block text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5"
        >
          {t("playbook.settingsFieldLabel")}
        </label>
        <div className="flex items-stretch border border-border rounded-lg overflow-hidden bg-surface-3 max-w-xs">
          <input
            id="playbook-auto-resolve-minutes"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={minutesText}
            onChange={(e) => setMinutesText(e.target.value)}
            className="flex-1 min-w-0 bg-transparent border-none text-gray-100 font-mono text-sm px-2.5 py-1.5 tabular-nums focus:outline-none"
          />
          <span className="flex items-center px-2.5 text-[11px] text-gray-500 bg-surface-4 border-l border-border">
            {t("playbook.settingsUnit")}
          </span>
        </div>
        {!isValid && (
          <p className="text-[11px] text-red-400 mt-1.5">{t("playbook.settingsParseError")}</p>
        )}
        <p className="text-[11px] text-gray-600 mt-1.5">{t("playbook.settingsDisabledHint")}</p>
      </div>

      <PracticeCardActions
        saving={saving}
        isValid={isValid}
        isDirty={isDirty}
        savedPulse={savedPulse}
        onSave={() => save(() => playbookSettingsStore.save({ autoResolveAfterMs: draftMs }))}
        onReset={() =>
          setMinutesText(String(DEFAULT_PLAYBOOK_SETTINGS.autoResolveAfterMs / MS_PER_MINUTE))
        }
      />
    </div>
  );
}

const SETTINGS_ID = "settings";

/** One sidecar row — shared active/inactive styling for both the Settings
 *  entry and every practice entry below it. */
function SidecarItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
        active
          ? "bg-accent/15 text-accent border-accent/30"
          : "text-gray-400 hover:text-gray-200 hover:bg-surface-2 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

/** The Playbook's left rail: **Settings** first (always present, even before
 *  `practices` hydrates), then one row per catalog practice — its name plus
 *  a small enabled/disabled dot, so status is scannable without opening the
 *  card. Selecting a row is the only way to change `selectedId`; this
 *  component owns no state of its own. */
function PlaybookSidecar({
  practices,
  selectedId,
  onSelect,
}: {
  practices: PlaybookPractice[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("coach");
  return (
    <nav
      aria-label={t("playbook.sidecar.label")}
      className="w-full md:w-56 flex-shrink-0 space-y-4"
    >
      <SidecarItem active={selectedId === SETTINGS_ID} onClick={() => onSelect(SETTINGS_ID)}>
        {t("playbook.sidecar.settingsLabel")}
      </SidecarItem>

      {practices.length > 0 && (
        <div className="space-y-1">
          <div className="px-3 text-[10.5px] font-semibold uppercase tracking-wide text-gray-600">
            {t("playbook.sidecar.practicesLabel")}
          </div>
          {practices.map((practice) => (
            <SidecarItem
              key={practice.id}
              active={selectedId === practice.id}
              onClick={() => onSelect(practice.id)}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    practice.enabled ? "bg-emerald-400" : "bg-gray-600"
                  }`}
                />
                <span className="truncate">
                  {t(PRACTICE_NAME_KEYS[practice.id] ?? practice.id)}
                </span>
              </span>
            </SidecarItem>
          ))}
        </div>
      )}
    </nav>
  );
}

export function PlaybookPage() {
  const { t } = useTranslation("coach");
  const practices = usePlaybookPractices();
  const [selectedId, setSelectedId] = useState<string>(SETTINGS_ID);

  const selectedPractice = practices.find((p) => p.id === selectedId);
  const SelectedCard = selectedPractice ? PRACTICE_CARDS[selectedPractice.id] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="text-xs text-gray-500 bg-surface-1 border border-dashed border-border rounded-lg px-3 py-2.5">
        <strong className="text-gray-400 font-semibold">{t("playbook.noteStrong")}</strong>{" "}
        {t("playbook.note")}
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <PlaybookSidecar practices={practices} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="flex-1 min-w-0 w-full">
          {selectedId === SETTINGS_ID ? (
            <GlobalSettingsCard />
          ) : practices.length === 0 ? (
            <p className="text-xs text-gray-500 italic py-6 text-center">{t("playbook.loading")}</p>
          ) : selectedPractice && SelectedCard ? (
            <SelectedCard practice={selectedPractice} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PageHeader() {
  const { t } = useTranslation("coach");
  return (
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
  );
}
