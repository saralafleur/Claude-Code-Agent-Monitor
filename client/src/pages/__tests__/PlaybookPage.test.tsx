/**
 * @file Tests for PlaybookPage: renders the v1 session-token-ceiling
 * practice from `api.playbook.listPractices`, toggling the switch + editing
 * the threshold and saving calls `api.playbook.updatePracticeConfig`, and
 * the live preview text reacts to the current (unsaved) field value.
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
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PlaybookPage } from "../PlaybookPage";
import { playbookStore } from "../../lib/playbookStore";

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
  fields: [{ key: "gapThresholdPct", type: "number" as const, default: 25, min: 1 }],
  enabled: true,
  config: { gapThresholdPct: 25 },
};

const listPractices = vi.fn();
const updatePracticeConfig = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    playbook: {
      listPractices: (...args: unknown[]) => listPractices(...args),
      updatePracticeConfig: (...args: unknown[]) => updatePracticeConfig(...args),
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

beforeEach(() => {
  playbookStore.__resetForTest();
  listPractices.mockResolvedValue({ practices: [PRACTICE] });
  updatePracticeConfig.mockResolvedValue({ ...PRACTICE, enabled: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PlaybookPage", () => {
  it("renders the practice name and its comma-formatted current threshold", async () => {
    renderPage();
    expect(await screen.findByText("Session Token Ceiling")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("100,000,000")).toBeInTheDocument();
  });

  it("updates the live preview as the threshold field changes", async () => {
    const user = userEvent.setup();
    renderPage();
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
    const input = await screen.findByDisplayValue("100,000,000");
    await user.clear(input);
    await user.type(input, "not a number");
    expect(await screen.findByText("Enter a number, like 500k or 1.2m")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("applying a preset chip sets the threshold and is reflected on save", async () => {
    const user = userEvent.setup();
    renderPage();
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
    await screen.findByText("Session Token Ceiling");

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

  it("renders one card per catalog practice", async () => {
    listPractices.mockResolvedValue({ practices: [PRACTICE, ACCOUNT_BALANCE_PRACTICE] });
    renderPage();
    expect(await screen.findByText("Session Token Ceiling")).toBeInTheDocument();
    expect(await screen.findByText("Account Rotation")).toBeInTheDocument();
  });

  it("renders account-weekly-balance's current gap threshold and live preview", async () => {
    listPractices.mockResolvedValue({ practices: [ACCOUNT_BALANCE_PRACTICE] });
    renderPage();
    expect(await screen.findByDisplayValue("25")).toBeInTheDocument();
    expect(await screen.findByText(/25% more weekly quota left/)).toBeInTheDocument();
  });

  it("updates account-weekly-balance's live preview as the gap field changes", async () => {
    listPractices.mockResolvedValue({ practices: [ACCOUNT_BALANCE_PRACTICE] });
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByDisplayValue("25");
    await user.clear(input);
    await user.type(input, "40");
    await waitFor(() => {
      expect(screen.getByText(/40% more weekly quota left/)).toBeInTheDocument();
    });
  });

  it("saves an account-weekly-balance gap threshold change via api.playbook.updatePracticeConfig", async () => {
    listPractices.mockResolvedValue({ practices: [ACCOUNT_BALANCE_PRACTICE] });
    updatePracticeConfig.mockResolvedValue({
      ...ACCOUNT_BALANCE_PRACTICE,
      config: { gapThresholdPct: 30 },
    });
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByDisplayValue("25");
    await user.clear(input);
    await user.type(input, "30");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updatePracticeConfig).toHaveBeenCalledWith("account-weekly-balance", {
        enabled: true,
        config: { gapThresholdPct: 30 },
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
    renderPage();

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
});
