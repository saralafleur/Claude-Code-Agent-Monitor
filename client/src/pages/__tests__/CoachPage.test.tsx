/**
 * @file Tests for CoachPage: renders the empty state with zero open
 * Observations, renders a fetched Observation as a card with its
 * i18n-templated message, and Dismiss calls
 * `api.coach.respondToObservation` and removes the card from the Feed.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CoachPage } from "../CoachPage";

const OBSERVATION = {
  id: 1,
  practice_id: "session-token-ceiling",
  scope_type: "session" as const,
  scope_id: "sess-1",
  kind: "risk" as const,
  severity: "warning",
  values_json: JSON.stringify({ totalTokens: 150_000_000, thresholdTokens: 100_000_000 }),
  status: "open" as const,
  detected_at: new Date().toISOString(),
  responded_at: null,
};

const ACCOUNT_BALANCE_OBSERVATION = {
  id: 2,
  practice_id: "account-weekly-balance",
  scope_type: "global" as const,
  scope_id: null,
  kind: "info" as const,
  severity: "info",
  values_json: JSON.stringify({
    lowLabel: "Work",
    lowPct: 40,
    highLabel: "Personal",
    highPct: 80,
    gapPct: 40,
  }),
  status: "open" as const,
  detected_at: new Date().toISOString(),
  responded_at: null,
};

const listObservations = vi.fn();
const respondToObservation = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    coach: {
      listObservations: (...args: unknown[]) => listObservations(...args),
      respondToObservation: (...args: unknown[]) => respondToObservation(...args),
    },
  },
}));

vi.mock("../../lib/eventBus", () => ({
  eventBus: {
    subscribe: () => () => {},
    publish: () => {},
    onConnection: () => () => {},
    connected: true,
    setConnected: () => {},
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/coach"]}>
      <CoachPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  listObservations.mockResolvedValue({ observations: [] });
  respondToObservation.mockResolvedValue({ ...OBSERVATION, status: "dismissed" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CoachPage", () => {
  it("shows the empty state when there are no open observations", async () => {
    renderPage();
    expect(await screen.findByText("Nothing to flag right now")).toBeInTheDocument();
    expect(listObservations).toHaveBeenCalledWith("open");
  });

  it("renders a fetched observation with its templated message", async () => {
    listObservations.mockResolvedValue({ observations: [OBSERVATION] });
    renderPage();
    expect(await screen.findByText(/150\.0M tokens/)).toBeInTheDocument();
  });

  it("renders a global-scoped account-weekly-balance observation with its templated message", async () => {
    listObservations.mockResolvedValue({ observations: [ACCOUNT_BALANCE_OBSERVATION] });
    renderPage();
    expect(
      await screen.findByText("Work has 40% more weekly quota left than Personal (40% vs 80% used)")
    ).toBeInTheDocument();
    // Global-scoped observations have no session to open, so no "Open session" action...
    expect(screen.queryByRole("link", { name: "Open session" })).not.toBeInTheDocument();
    // ...but Dismiss must still be reachable, or a global observation could never be cleared.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("dismissing a global-scoped observation calls respondToObservation and removes the card", async () => {
    listObservations.mockResolvedValue({ observations: [ACCOUNT_BALANCE_OBSERVATION] });
    respondToObservation.mockResolvedValue({ ...ACCOUNT_BALANCE_OBSERVATION, status: "dismissed" });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Work has 40% more weekly quota left than Personal (40% vs 80% used)");

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(respondToObservation).toHaveBeenCalledWith(2, "dismissed");
    });
    await waitFor(() => {
      expect(
        screen.queryByText("Work has 40% more weekly quota left than Personal (40% vs 80% used)")
      ).not.toBeInTheDocument();
    });
  });

  it("dismissing an observation calls respondToObservation and removes the card", async () => {
    listObservations.mockResolvedValue({ observations: [OBSERVATION] });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/150\.0M tokens/);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(respondToObservation).toHaveBeenCalledWith(1, "dismissed");
    });
    await waitFor(() => {
      expect(screen.queryByText(/150\.0M tokens/)).not.toBeInTheDocument();
    });
  });
});
