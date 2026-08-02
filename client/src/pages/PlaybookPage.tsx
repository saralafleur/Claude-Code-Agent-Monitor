/**
 * @file PlaybookPage.tsx
 * @description Standalone page (route `/coach/playbook`) — the Playbook
 * editor: turn a practice on/off and tune its config, both server-shared and
 * live across every connected computer (`playbookStore.ts`, the same
 * server-persisted/WS-broadcast shape `colorThresholds.ts` already
 * established for the Usage page's Color Thresholds card). Renders one card
 * per catalog practice returned by `usePlaybookPractices()`, keyed by id —
 * `session-token-ceiling` gets its own k/m/b-shorthand token-field card,
 * `account-weekly-balance` a plain percentage-field card; a third practice
 * is a new `PRACTICE_CARDS` entry, not a page rewrite.
 *
 * Each card seeds its own draft state from its practice's config once, on
 * first arrival (not re-synced on every later store update) — a
 * deliberately simpler version of `Usage.tsx`'s `ColorThresholdsCard`
 * "resync only while the draft still matches what was last saved" dance,
 * since a single numeric field per card makes an in-progress-edit collision
 * unlikely enough that the extra bookkeeping isn't worth it yet.
 *
 * The live preview below each field reuses `ObservationCard` in preview mode
 * (no `detectedAt`/`onRespond`) fed the draft's own current values, so
 * typing a new threshold visibly changes exactly what would show up in the
 * Feed — the same component, not a look-alike.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Compass } from "lucide-react";
import { usePlaybookPractices, playbookStore } from "../lib/playbookStore";
import { CoachTabs } from "../components/coach/CoachTabs";
import { ObservationCard } from "../components/coach/ObservationCard";
import { parseTokenShorthand, fmtTokensFull } from "../lib/format";
import type { PlaybookPractice } from "../lib/types";

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
  const [draft, setDraft] = useState<Record<string, number>>(practice.config);
  const [thresholdText, setThresholdText] = useState("");
  const seeded = useRef(false);
  const { saving, savedPulse, save } = useSavePulse();

  const field = practice.fields[0];

  useEffect(() => {
    if (field && !seeded.current) {
      setThresholdText(fmtTokensFull(practice.config[field.key] ?? field.default));
      seeded.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice]);

  if (!field) return null;

  const draftValue = draft[field.key] ?? field.default;
  const isDirty = enabled !== practice.enabled || draftValue !== practice.config[field.key];
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

      <div className="mt-4 pt-4 border-t border-border">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
          {t("playbook.previewLabel")}
        </div>
        <ObservationCard
          practiceId={practice.id}
          kind={practice.kind}
          values={{ totalTokens: draftValue * 1.024, thresholdTokens: draftValue }}
        />
      </div>

      <PracticeCardActions
        saving={saving}
        isValid={isValid}
        isDirty={isDirty}
        savedPulse={savedPulse}
        onSave={() => save(() => playbookStore.save(practice.id, { enabled, config: draft }))}
        onReset={() => applyThreshold(field.default)}
      />
    </PracticeCardShell>
  );
}

function AccountWeeklyBalanceCard({ practice }: PracticeCardProps) {
  const { t } = useTranslation("coach");
  const [enabled, setEnabled] = useState(practice.enabled);
  const [draft, setDraft] = useState<Record<string, number>>(practice.config);
  const { saving, savedPulse, save } = useSavePulse();

  const field = practice.fields[0];
  if (!field) return null;

  const draftValue = draft[field.key] ?? field.default;
  const isDirty = enabled !== practice.enabled || draftValue !== practice.config[field.key];
  const isValid = Number.isFinite(draftValue) && draftValue >= field.min;

  // Illustrative preview pair: a low account sitting at a fixed 40% used,
  // a high account exactly `draftValue` points above it — so the preview
  // always reflects the threshold currently being edited.
  const previewLowPct = 40;
  const previewHighPct = previewLowPct + draftValue;

  return (
    <PracticeCardShell
      practice={practice}
      nameKey="practices.accountWeeklyBalance.name"
      descriptionKey="practices.accountWeeklyBalance.description"
      enabled={enabled}
      onToggle={setEnabled}
    >
      <div className="mt-4 pt-4 border-t border-border">
        <label
          htmlFor={`${practice.id}-field`}
          className="block text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5"
        >
          {t("practices.accountWeeklyBalance.fieldLabel")}
        </label>
        <div className="flex items-stretch border border-border rounded-lg overflow-hidden bg-surface-3 max-w-xs">
          <input
            id={`${practice.id}-field`}
            type="number"
            min={field.min}
            step={1}
            value={draftValue}
            onChange={(e) => setDraft({ [field.key]: Number(e.target.value) })}
            className="flex-1 min-w-0 bg-transparent border-none text-gray-100 font-mono text-sm px-2.5 py-1.5 tabular-nums focus:outline-none"
          />
          <span className="flex items-center px-2.5 text-[11px] text-gray-500 bg-surface-4 border-l border-border">
            {t("practices.accountWeeklyBalance.unit")}
          </span>
        </div>
        {!isValid && (
          <p className="text-[11px] text-red-400 mt-1.5">
            {t("playbook.minError", { min: field.min.toLocaleString() })}
          </p>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
          {t("playbook.previewLabel")}
        </div>
        <ObservationCard
          practiceId={practice.id}
          kind={practice.kind}
          values={{
            lowLabel: t("practices.accountWeeklyBalance.previewLowLabel"),
            lowPct: previewLowPct,
            highLabel: t("practices.accountWeeklyBalance.previewHighLabel"),
            highPct: previewHighPct,
            gapPct: draftValue,
          }}
        />
      </div>

      <PracticeCardActions
        saving={saving}
        isValid={isValid}
        isDirty={isDirty}
        savedPulse={savedPulse}
        onSave={() => save(() => playbookStore.save(practice.id, { enabled, config: draft }))}
        onReset={() => setDraft({ [field.key]: field.default })}
      />
    </PracticeCardShell>
  );
}

/** Maps a practice id to its card component — extend when a new practice ships. */
const PRACTICE_CARDS: Record<string, (props: PracticeCardProps) => React.JSX.Element | null> = {
  "session-token-ceiling": SessionTokenCeilingCard,
  "account-weekly-balance": AccountWeeklyBalanceCard,
};

export function PlaybookPage() {
  const { t } = useTranslation("coach");
  const practices = usePlaybookPractices();

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="text-xs text-gray-500 bg-surface-1 border border-dashed border-border rounded-lg px-3 py-2.5">
        <strong className="text-gray-400 font-semibold">{t("playbook.noteStrong")}</strong>{" "}
        {t("playbook.note")}
      </div>

      {practices.length === 0 ? (
        <p className="text-xs text-gray-500 italic py-6 text-center">{t("playbook.loading")}</p>
      ) : (
        <div className="space-y-4">
          {practices.map((practice) => {
            const Card = PRACTICE_CARDS[practice.id];
            return Card ? <Card key={practice.id} practice={practice} /> : null;
          })}
        </div>
      )}
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
