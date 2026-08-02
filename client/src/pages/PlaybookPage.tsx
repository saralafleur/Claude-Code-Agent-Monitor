/**
 * @file PlaybookPage.tsx
 * @description Standalone page (route `/coach/playbook`) — the Playbook
 * editor: turn a practice on/off and tune its config, both server-shared and
 * live across every connected computer (`playbookStore.ts`, the same
 * server-persisted/WS-broadcast shape `colorThresholds.ts` already
 * established for the Usage page's Color Thresholds card). v1 ships exactly
 * one practice (`session-token-ceiling`), rendered inline rather than as a
 * collapsible list — collapsing only earns its keep once there's a second
 * practice to hide.
 *
 * Draft state is seeded from the practice's config once, on first arrival
 * (not re-synced on every later store update) — a deliberately simpler
 * version of `Usage.tsx`'s `ColorThresholdsCard` "resync only while the
 * draft still matches what was last saved" dance, since a single numeric
 * field makes an in-progress-edit collision unlikely enough that the extra
 * bookkeeping isn't worth it yet.
 *
 * The live preview below the field reuses `ObservationCard` in preview mode
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

const PRACTICE_ID = "session-token-ceiling";

// Common ceilings, offered as one-click chips next to the free-text field.
const TOKEN_PRESETS = [
  { value: 500_000, label: "500K" },
  { value: 1_000_000, label: "1M" },
  { value: 5_000_000, label: "5M" },
  { value: 10_000_000, label: "10M" },
  { value: 50_000_000, label: "50M" },
  { value: 100_000_000, label: "100M" },
];

export function PlaybookPage() {
  const { t } = useTranslation("coach");
  const practices = usePlaybookPractices();
  const practice = practices.find((p) => p.id === PRACTICE_ID);

  const [enabled, setEnabled] = useState(true);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [thresholdText, setThresholdText] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    const seedField = practice?.fields[0];
    if (practice && seedField && !seeded.current) {
      setEnabled(practice.enabled);
      setDraft(practice.config);
      setThresholdText(fmtTokensFull(practice.config[seedField.key] ?? seedField.default));
      seeded.current = true;
    }
  }, [practice]);

  const field = practice?.fields[0];
  if (!practice || !field) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <p className="text-xs text-gray-500 italic py-6 text-center">{t("playbook.loading")}</p>
      </div>
    );
  }

  const draftValue = draft[field.key] ?? field.default;
  const isDirty = enabled !== practice.enabled || draftValue !== practice.config[field.key];
  const parsedThreshold = parseTokenShorthand(thresholdText);
  const isValid = parsedThreshold !== null && parsedThreshold >= field.min;

  const handleSave = async () => {
    setSaving(true);
    try {
      await playbookStore.save(practice.id, { enabled, config: draft });
      setSavedPulse(true);
      setTimeout(() => setSavedPulse(false), 2200);
    } finally {
      setSaving(false);
    }
  };

  const applyThreshold = (value: number) => {
    setDraft({ [field.key]: value });
    setThresholdText(fmtTokensFull(value));
  };

  const handleReset = () => {
    applyThreshold(field.default);
  };

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="text-xs text-gray-500 bg-surface-1 border border-dashed border-border rounded-lg px-3 py-2.5">
        <strong className="text-gray-400 font-semibold">{t("playbook.noteStrong")}</strong>{" "}
        {t("playbook.note")}
      </div>

      <div className="card p-5">
        <div className="flex items-start gap-3">
          <label className="flex-shrink-0 mt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="peer sr-only"
              aria-label={t(`practices.sessionTokenCeiling.name`)}
            />
            <span className="block w-8 h-[18px] rounded-full bg-surface-5 border border-border-light peer-checked:bg-accent peer-checked:border-accent transition-colors relative">
              <span className="absolute top-[1px] left-[1px] w-[14px] h-[14px] rounded-full bg-gray-400 peer-checked:bg-white peer-checked:translate-x-[14px] transition-transform" />
            </span>
          </label>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-gray-100">
                {t("practices.sessionTokenCeiling.name")}
              </h2>
              <code className="text-[10.5px] text-gray-600">{practice.id}</code>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {t("practices.sessionTokenCeiling.description")}
            </p>
          </div>
          <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-surface-4 text-gray-400 border border-border-light flex-shrink-0">
            {t(`scopeLabel.${practice.scope}`)}
          </span>
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <label
            htmlFor="threshold-field"
            className="block text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5"
          >
            {t("practices.sessionTokenCeiling.fieldLabel")}
          </label>
          <div className="flex items-stretch border border-border rounded-lg overflow-hidden bg-surface-3 max-w-xs">
            <input
              id="threshold-field"
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

        <div className="flex items-center gap-2 mt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isValid || !isDirty}
            className="btn-primary text-xs disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? t("playbook.saving") : t("playbook.save")}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            className="btn-ghost text-xs disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t("playbook.resetDefault")}
          </button>
          {savedPulse && (
            <span className="text-[11px] text-emerald-400 ml-1">{t("playbook.saved")}</span>
          )}
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
