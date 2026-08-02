/**
 * @file Tests for PlaybookPage: renders the v1 session-token-ceiling
 * practice from `api.playbook.listPractices`, toggling the switch + editing
 * the threshold and saving calls `api.playbook.updatePracticeConfig`, and
 * the live preview text reacts to the current (unsaved) field value.
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
  defaultSeverity: "warning",
  fields: [
    { key: "thresholdTokens", type: "number" as const, default: 100_000_000, min: 1_000_000 },
  ],
  enabled: true,
  config: { thresholdTokens: 100_000_000 },
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
});
