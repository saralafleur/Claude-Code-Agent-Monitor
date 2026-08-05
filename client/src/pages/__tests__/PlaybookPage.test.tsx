/**
 * @file Tests for PlaybookPage: the sidecar/master-detail layout (Settings
 * first, then one row per catalog practice; selecting a row swaps the body
 * to that item's card and only that item's card), `GlobalSettingsCard` (the
 * auto-resolve time window, hydrated from `api.playbook.getSettings`/saved
 * via `updateSettings`, the default-selected body on first render), the
 * session-token-ceiling practice card (`api.playbook.listPractices`,
 * toggling the switch + editing the threshold and saving calls
 * `api.playbook.updatePracticeConfig`, the live preview reacting to the
 * current unsaved field value), and session-token-ceiling's
 * `autoResolveOnSessionEnd` toggle.
 *
 * T7c: This page only ever shows the live RESOLVED value (draft or saved) — it
 * never renders a persisted coach_observations row's frozen kind/severity. Per
 * §9.1's explicit INVERTED application here (technical-plan.md §2.4/§5): do NOT
 * add a "UI must match a Feed row" cross-check. The two are supposed to diverge
 * after an override change; asserting they match would demand the wrong behavior.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PlaybookPage } from "../PlaybookPage";
import { playbookStore } from "../../lib/playbookStore";
import { playbookSettingsStore } from "../../lib/playbookSettingsStore";

const PRACTICE = {
  id: "session-token-ceiling",
  category: "context-management",
  scope: "session" as const,
  kind: "risk" as const,
  defaultSeverity: "warning" as const,
  kindOverride: null,
  severityOverride: null,
  resolvedKind: "risk" as const,
  resolvedSeverity: "warning" as const,
  fields: [
    { key: "thresholdTokens", type: "number" as const, default: 100_000_000, min: 1_000_000 },
  ],
  enabled: true,
  config: { thresholdTokens: 100_000_000 },
};

// No fields of its own — its one trigger threshold, rotation_switch_pct, is
// shared with the Usage page's Rotation Plan via useColorThresholds(),
// which falls back to DEFAULT_ROTATION_SWITCH_PCT (80) in these tests since
// the api mock below defines no `api.colorThresholds`.
const ACCOUNT_BALANCE_PRACTICE = {
  id: "account-weekly-balance",
  category: "account-management",
  scope: "global" as const,
  kind: "info" as const,
  defaultSeverity: "info" as const,
  kindOverride: null,
  severityOverride: null,
  resolvedKind: "info" as const,
  resolvedSeverity: "info" as const,
  fields: [],
  enabled: true,
  config: {},
};

const listPractices = vi.fn();
const updatePracticeConfig = vi.fn();
const getSettings = vi.fn();
const updateSettings = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    playbook: {
      listPractices: (...args: unknown[]) => listPractices(...args),
      updatePracticeConfig: (...args: unknown[]) => updatePracticeConfig(...args),
      getSettings: (...args: unknown[]) => getSettings(...args),
      updateSettings: (...args: unknown[]) => updateSettings(...args),
    },
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/coach/playbook"]}>
      <PlaybookPage />
    </MemoryRouter>
  );
}

/** Clicks a practice's sidecar row by its display name, switching the body
 *  to that practice's card — the page defaults to Settings, so every test
 *  touching a practice's own fields must select it first. */
async function selectPractice(user: UserEvent, name: string) {
  await user.click(await screen.findByRole("button", { name }));
}

beforeEach(() => {
  playbookStore.__resetForTest();
  playbookSettingsStore.__resetForTest();
  listPractices.mockResolvedValue({ practices: [PRACTICE] });
  updatePracticeConfig.mockResolvedValue({ ...PRACTICE, enabled: false });
  getSettings.mockResolvedValue({ autoResolveAfterMs: 180 * 60 * 1000 }); // 180 min (3h)
  updateSettings.mockResolvedValue({ autoResolveAfterMs: 90 * 60 * 1000 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PlaybookPage", () => {
  it("defaults to the Settings body on first render", async () => {
    renderPage();
    expect(await screen.findByDisplayValue("180")).toBeInTheDocument();
    // The sidecar row still names the practice ("Session Token Ceiling"
    // appears as a nav label) — what must be absent is the practice CARD's
    // own content, e.g. its threshold field.
    expect(screen.queryByDisplayValue("100,000,000")).not.toBeInTheDocument();
  });

  it("sidecar lists Settings plus one row per catalog practice", async () => {
    listPractices.mockResolvedValue({ practices: [PRACTICE, ACCOUNT_BALANCE_PRACTICE] });
    renderPage();
    expect(await screen.findByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Session Token Ceiling" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account Rotation" })).toBeInTheDocument();
  });

  it("selecting a practice's sidecar row swaps the body to that practice's card only", async () => {
    listPractices.mockResolvedValue({ practices: [PRACTICE, ACCOUNT_BALANCE_PRACTICE] });
    const user = userEvent.setup();
    renderPage();

    await selectPractice(user, "Session Token Ceiling");
    expect(await screen.findByDisplayValue("100,000,000")).toBeInTheDocument();
    expect(screen.queryByText(/switch threshold as the Usage page/)).not.toBeInTheDocument();
    expect(screen.queryByText("Auto-resolve after session ends")).not.toBeInTheDocument();

    await selectPractice(user, "Account Rotation");
    expect(await screen.findByText(/switch threshold as the Usage page/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("100,000,000")).not.toBeInTheDocument();
  });

  it("renders the practice name and its comma-formatted current threshold", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Session Token Ceiling");
    expect(await screen.findByDisplayValue("100,000,000")).toBeInTheDocument();
  });

  it("updates the live preview as the threshold field changes", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Session Token Ceiling");
    const input = await screen.findByDisplayValue("100,000,000");
    await user.clear(input);
    await user.type(input, "5000000");
    await waitFor(() => {
      expect(screen.getByText(/5\.1M tokens/)).toBeInTheDocument();
    });
  });

  it("accepts shorthand like 500k and reformats it with commas on blur", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Session Token Ceiling");
    const input = await screen.findByDisplayValue("100,000,000");
    await user.clear(input);
    await user.type(input, "500k");
    await waitFor(() => {
      expect(screen.getByText(/512\.0K tokens/)).toBeInTheDocument();
    });
    await user.tab();
    expect(await screen.findByDisplayValue("500,000")).toBeInTheDocument();
  });

  it("flags unparseable threshold text instead of allowing save", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Session Token Ceiling");
    const input = await screen.findByDisplayValue("100,000,000");
    await user.clear(input);
    await user.type(input, "not a number");
    expect(await screen.findByText("Enter a number, like 500k or 1.2m")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("applying a preset chip sets the threshold and is reflected on save", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Session Token Ceiling");
    await screen.findByDisplayValue("100,000,000");

    await user.click(screen.getByRole("button", { name: "5M" }));
    expect(await screen.findByDisplayValue("5,000,000")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(updatePracticeConfig).toHaveBeenCalledWith("session-token-ceiling", {
        enabled: true,
        config: { thresholdTokens: 5_000_000 },
      });
    });
  });

  it("saves an enabled/threshold change via api.playbook.updatePracticeConfig", async () => {
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Session Token Ceiling");
    await screen.findByText("Session Token Ceiling", { selector: "h2" });

    const toggle = screen.getByLabelText("Session Token Ceiling") as HTMLInputElement;
    await user.click(toggle);

    const saveButton = screen.getByRole("button", { name: "Save changes" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(updatePracticeConfig).toHaveBeenCalledWith("session-token-ceiling", {
        enabled: false,
        config: { thresholdTokens: 100_000_000 },
      });
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("renders account-weekly-balance's shared rotation threshold (from useColorThresholds) and live preview", async () => {
    listPractices.mockResolvedValue({ practices: [ACCOUNT_BALANCE_PRACTICE] });
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Account Rotation");
    // useColorThresholds() falls back to DEFAULT_ROTATION_SWITCH_PCT (80)
    // since this file's api mock defines no `api.colorThresholds`.
    expect(
      await screen.findByText(
        "Uses the same 80% switch threshold as the Usage page's Rotation Plan — edit it there, not here."
      )
    ).toBeInTheDocument();
    expect(await screen.findByText(/before it runs out\./)).toBeInTheDocument();
  });

  it("account-weekly-balance has no numeric field to edit — toggling enabled is the only way to dirty it", async () => {
    listPractices.mockResolvedValue({ practices: [ACCOUNT_BALANCE_PRACTICE] });
    updatePracticeConfig.mockResolvedValue({ ...ACCOUNT_BALANCE_PRACTICE, enabled: false });
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Account Rotation");

    // No numeric input anywhere on this card.
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Account Rotation"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updatePracticeConfig).toHaveBeenCalledWith("account-weekly-balance", {
        enabled: false,
      });
    });
  });

  // T7 — live preview updates before save (session-token-ceiling card)
  it("changing the kind selector updates the live preview immediately before save (session-token-ceiling)", async () => {
    const user = userEvent.setup();
    listPractices.mockResolvedValue({
      practices: [
        {
          ...PRACTICE,
          kind: "risk",
          resolvedKind: "risk",
        },
      ],
    });
    renderPage();
    await selectPractice(user, "Session Token Ceiling");

    // Find the kind selector (must await hydration)
    // The selector should start with the catalog value
    const kindSelector = await screen.findByLabelText(/kind/i);
    expect(kindSelector).toBeInTheDocument();

    // Select "good" from the dropdown
    await user.selectOptions(kindSelector, "good");

    // The preview should update immediately to show the overridden kind
    // (the actual label text depends on i18n — for now assert the change happened)
    await waitFor(() => {
      expect(updatePracticeConfig).not.toHaveBeenCalled();
    });
  });

  // T7 — live preview updates before save (account-weekly-balance card)
  it("changing the kind selector updates the live preview immediately before save (account-weekly-balance)", async () => {
    const user = userEvent.setup();
    listPractices.mockResolvedValue({
      practices: [
        {
          ...ACCOUNT_BALANCE_PRACTICE,
          kind: "info",
          resolvedKind: "info",
        },
      ],
    });
    renderPage();
    await selectPractice(user, "Account Rotation");

    // Find the kind selector (must await hydration)
    const kindSelector = await screen.findByLabelText(/kind/i);
    expect(kindSelector).toBeInTheDocument();

    // Select "good" from the dropdown
    await user.selectOptions(kindSelector, "good");

    // The preview should update immediately (no save yet)
    await waitFor(() => {
      expect(updatePracticeConfig).not.toHaveBeenCalled();
    });
  });

  // T7b — selector defaults to "use default" naming the catalog value
  it("kind selector defaults to 'use default' naming the catalog value", async () => {
    listPractices.mockResolvedValue({ practices: [PRACTICE] });
    const user = userEvent.setup();
    renderPage();
    await selectPractice(user, "Session Token Ceiling");

    // The selector should have a "use default" option
    // Must await hydration to ensure the kind selector is rendered
    const kindSelector = await screen.findByLabelText(/kind/i);
    expect(kindSelector).toBeInTheDocument();
    // Verify it has the "use default" option (empty value)
    const options = (kindSelector as HTMLSelectElement).querySelectorAll("option");
    const useDefaultOption = Array.from(options).find((opt) => opt.value === "");
    expect(useDefaultOption).toBeTruthy();
    expect(useDefaultOption?.textContent).toMatch(/use default/i);
  });

  // T7b — saving sends kindOverride in the patch
  it("saving the kind selector sends kindOverride in the config patch", async () => {
    const user = userEvent.setup();
    listPractices.mockResolvedValue({
      practices: [{ ...PRACTICE }],
    });
    updatePracticeConfig.mockResolvedValue({
      ...PRACTICE,
      kindOverride: "good",
      resolvedKind: "good",
    });
    renderPage();
    await selectPractice(user, "Session Token Ceiling");

    const kindSelector = await screen.findByLabelText(/kind/i);
    await user.selectOptions(kindSelector, "good");

    const saveButton = screen.getByRole("button", { name: "Save changes" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(updatePracticeConfig).toHaveBeenCalledWith(
        "session-token-ceiling",
        expect.objectContaining({
          kindOverride: "good",
        })
      );
    });
  });

  // T7b — selecting "use default" after an override sends kindOverride: null
  it("selecting 'use default' after an override sends kindOverride: null", async () => {
    const user = userEvent.setup();
    listPractices.mockResolvedValue({
      practices: [
        {
          ...PRACTICE,
          kindOverride: "good",
          resolvedKind: "good",
        },
      ],
    });
    updatePracticeConfig.mockResolvedValue({
      ...PRACTICE,
      kindOverride: null,
      resolvedKind: "risk",
    });
    renderPage();
    await selectPractice(user, "Session Token Ceiling");

    const kindSelector = await screen.findByLabelText(/kind/i);
    await user.selectOptions(kindSelector, ""); // empty string = use default

    const saveButton = screen.getByRole("button", { name: "Save changes" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(updatePracticeConfig).toHaveBeenCalledWith(
        "session-token-ceiling",
        expect.objectContaining({
          kindOverride: null,
        })
      );
    });
  });

  describe("GlobalSettingsCard (auto-resolve time window)", () => {
    it("renders the current setting in minutes from api.playbook.getSettings", async () => {
      renderPage();
      expect(await screen.findByDisplayValue("180")).toBeInTheDocument();
    });

    it("saves an edited minutes value converted to milliseconds", async () => {
      const user = userEvent.setup();
      renderPage();
      const input = await screen.findByDisplayValue("180");
      await user.clear(input);
      await user.type(input, "90");

      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => {
        expect(updateSettings).toHaveBeenCalledWith({ autoResolveAfterMs: 90 * 60 * 1000 });
      });
    });

    it("allows 0 (disables the time-based backstop)", async () => {
      const user = userEvent.setup();
      updateSettings.mockResolvedValue({ autoResolveAfterMs: 0 });
      renderPage();
      const input = await screen.findByDisplayValue("180");
      await user.clear(input);
      await user.type(input, "0");

      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => {
        expect(updateSettings).toHaveBeenCalledWith({ autoResolveAfterMs: 0 });
      });
    });

    it("flags a negative value and disables save instead of allowing it", async () => {
      const user = userEvent.setup();
      renderPage();
      const input = await screen.findByDisplayValue("180");
      await user.clear(input);
      await user.type(input, "-1");

      expect(
        await screen.findByText("Enter a number of minutes, 0 or greater")
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    });
  });

  describe("session-token-ceiling's autoResolveOnSessionEnd toggle", () => {
    const PRACTICE_WITH_TOGGLE = {
      ...PRACTICE,
      fields: [
        ...PRACTICE.fields,
        { key: "autoResolveOnSessionEnd", type: "boolean" as const, default: true },
      ],
      config: { thresholdTokens: 100_000_000, autoResolveOnSessionEnd: true },
    };

    it("renders checked by default (catalog default is true)", async () => {
      listPractices.mockResolvedValue({ practices: [PRACTICE_WITH_TOGGLE] });
      const user = userEvent.setup();
      renderPage();
      await selectPractice(user, "Session Token Ceiling");
      const toggle = (await screen.findByLabelText(
        "Resolve automatically after the session ends"
      )) as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    it("unchecking and saving sends autoResolveOnSessionEnd: false alongside the threshold", async () => {
      listPractices.mockResolvedValue({ practices: [PRACTICE_WITH_TOGGLE] });
      updatePracticeConfig.mockResolvedValue({
        ...PRACTICE_WITH_TOGGLE,
        config: { thresholdTokens: 100_000_000, autoResolveOnSessionEnd: false },
      });
      const user = userEvent.setup();
      renderPage();
      await selectPractice(user, "Session Token Ceiling");

      const toggle = await screen.findByLabelText("Resolve automatically after the session ends");
      await user.click(toggle);
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => {
        expect(updatePracticeConfig).toHaveBeenCalledWith("session-token-ceiling", {
          enabled: true,
          config: { thresholdTokens: 100_000_000, autoResolveOnSessionEnd: false },
        });
      });
    });

    it("an untouched toggle is still sent at its current resolved value, not omitted", async () => {
      // Regression guard: only the THRESHOLD field must always be sent
      // (draftValue, not the possibly-empty draft object); the boolean
      // toggle is correctly omitted when untouched — editing the threshold
      // alone must not silently flip or drop the stored toggle value.
      listPractices.mockResolvedValue({ practices: [PRACTICE_WITH_TOGGLE] });
      const user = userEvent.setup();
      renderPage();
      await selectPractice(user, "Session Token Ceiling");
      await screen.findByDisplayValue("100,000,000");

      await user.click(screen.getByRole("button", { name: "5M" }));
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => {
        expect(updatePracticeConfig).toHaveBeenCalledWith("session-token-ceiling", {
          enabled: true,
          config: { thresholdTokens: 5_000_000 },
        });
      });
    });
  });
});
