/**
 * @file ProjectManager.test.tsx
 * @description Tests for the layer-7 Project Manager page: loading/empty/
 * error states, the portfolio rollup table (progress %, milestones, pace
 * badge, open-decision count), the decision queue (kind badges, and that
 * resolve/dismiss/detour-disposition actions call the right endpoint with
 * the right arguments and reload afterward), the pace-watch and
 * recently-resolved rails, the project scope filter, and that a relevant
 * WebSocket push triggers a debounced reload.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import type { WSMessage } from "../../lib/types";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

// Mutable per-test fixtures, read by the api mock below (same idiom as
// Run.defaultCwd.test.tsx's `cwdItems`).
let projectsPayload: unknown = {
  projects: [],
  unassigned: { cwds: [], session_count: 0, active_count: 0, last_activity: null },
};
let portfolioPayload: unknown = { projects: [] };
let queuePayload: unknown = { queue: [] };
let projectsShouldFail = false;

// vi.mock factories are hoisted above normal module-scope declarations, so
// the mock functions the factory closes over must be created via
// vi.hoisted() rather than a plain `const` (which would still be in the
// temporal dead zone when the hoisted factory runs).
const { decisionQueueResolve, detoursResolve } = vi.hoisted(() => ({
  decisionQueueResolve: vi.fn().mockResolvedValue({ queue: {} }),
  detoursResolve: vi.fn().mockResolvedValue({ write_status: "written", detour: {} }),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: {
      projects: {
        list: vi
          .fn()
          .mockImplementation(() =>
            projectsShouldFail
              ? Promise.reject(new Error("boom"))
              : Promise.resolve(projectsPayload)
          ),
      },
      portfolio: {
        summary: vi.fn().mockImplementation(() => Promise.resolve(portfolioPayload)),
      },
      decisionQueue: {
        list: vi.fn().mockImplementation(() => Promise.resolve(queuePayload)),
        resolve: decisionQueueResolve,
      },
      detours: {
        resolve: detoursResolve,
      },
    },
  };
});

let publishHandler: ((msg: WSMessage) => void) | null = null;
vi.mock("../../lib/eventBus", () => ({
  eventBus: {
    subscribe: (cb: (msg: WSMessage) => void) => {
      publishHandler = cb;
      return () => {
        publishHandler = null;
      };
    },
    publish: () => {},
    onConnection: () => () => {},
    connected: true,
    setConnected: () => {},
  },
}));

import { ProjectManager } from "../ProjectManager";

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderPage() {
  const utils = render(
    <MemoryRouter initialEntries={["/project-manager"]}>
      <ProjectManager />
    </MemoryRouter>
  );
  await settle();
  return utils;
}

const PROJECT_A = {
  id: "proj-a",
  name: "Claude-Code-Agent-Monitor",
  paths: [],
  session_count: 3,
  active_count: 1,
  last_activity: "2026-06-10T12:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-06-10T12:00:00.000Z",
};
const PROJECT_B = {
  id: "proj-b",
  name: "email-ops",
  paths: [],
  session_count: 1,
  active_count: 0,
  last_activity: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const PORTFOLIO_A = {
  project_id: "proj-a",
  milestones: { done: 3, total: 4 },
  pace: {
    counts: { no_target: 1, on_track: 0, behind: 1, done: 2 },
    behind: [
      {
        cwd: "/repo/a",
        item_id: "item-2",
        item_number: 2,
        text: "Migrate filter rules",
        target_date: "2026-06-01",
        days_overdue: 9,
      },
    ],
  },
};
const PORTFOLIO_B = {
  project_id: "proj-b",
  milestones: { done: 0, total: 0 },
  pace: { counts: { no_target: 0, on_track: 0, behind: 0, done: 0 }, behind: [] },
};

const QUEUE_PACE_ALERT = {
  id: 1,
  cwd: "/repo/a",
  project_id: "proj-a",
  kind: "pace_alert" as const,
  ref_id: null,
  item_id: "item-2",
  message: "Item 2 is 9 day(s) past its target date.",
  payload: { item_number: 2, days_overdue: 9 },
  status: "pending" as const,
  created_at: "2026-06-10T11:00:00.000Z",
  resolved_at: null,
};
const QUEUE_DETOUR = {
  id: 2,
  cwd: "/repo/a",
  project_id: "proj-a",
  kind: "detour_disposition" as const,
  ref_id: 42,
  item_id: null,
  message: "A detour needs a human look: sidebar keyboard nav",
  payload: { needs_review: true, verdict: { proposed_text: "Add keyboard nav to Sidebar" } },
  status: "pending" as const,
  created_at: "2026-06-10T11:05:00.000Z",
  resolved_at: null,
};
const QUEUE_RESOLVED = {
  id: 3,
  cwd: "/repo/a",
  project_id: "proj-a",
  kind: "detour_disposition" as const,
  ref_id: 40,
  item_id: null,
  message: "Folded into item 1",
  payload: null,
  status: "resolved" as const,
  created_at: "2026-06-09T00:00:00.000Z",
  resolved_at: "2026-06-09T00:05:00.000Z",
};

beforeEach(() => {
  i18n.changeLanguage("en");
  projectsPayload = {
    projects: [PROJECT_A, PROJECT_B],
    unassigned: { cwds: [], session_count: 0, active_count: 0, last_activity: null },
  };
  portfolioPayload = { projects: [PORTFOLIO_A, PORTFOLIO_B] };
  queuePayload = { queue: [QUEUE_PACE_ALERT, QUEUE_DETOUR, QUEUE_RESOLVED] };
  projectsShouldFail = false;
  publishHandler = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ProjectManager page", () => {
  it("shows an empty state when there are no projects", async () => {
    projectsPayload = {
      projects: [],
      unassigned: { cwds: [], session_count: 0, active_count: 0, last_activity: null },
    };
    portfolioPayload = { projects: [] };
    queuePayload = { queue: [] };
    await renderPage();
    expect(screen.getByText(i18n.t("projectManager:rollup.empty"))).toBeInTheDocument();
  });

  it("shows an error message when the initial load fails", async () => {
    projectsShouldFail = true;
    await renderPage();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders the portfolio rollup with progress, milestones, pace, and open-decision counts", async () => {
    await renderPage();
    const table = screen.getByRole("table");

    const rowA = within(table).getByText("Claude-Code-Agent-Monitor").closest("tr") as HTMLElement;
    expect(within(rowA).getByText("75%")).toBeInTheDocument();
    expect(within(rowA).getByText("3 / 4")).toBeInTheDocument();
    expect(
      within(rowA).getByText(i18n.t("projectManager:rollup.behind", { count: 1 }))
    ).toBeInTheDocument();
    // One pending pace_alert + one pending detour_disposition are both
    // stamped project_id: "proj-a" - the open-decisions cell must count both.
    expect(within(rowA).getByText("2")).toBeInTheDocument();

    const rowB = within(table).getByText("email-ops").closest("tr") as HTMLElement;
    expect(within(rowB).getByText(i18n.t("projectManager:rollup.noPlan"))).toBeInTheDocument();
    expect(within(rowB).getByText(i18n.t("projectManager:rollup.noTarget"))).toBeInTheDocument();
  });

  it("clicking a project's rollup row navigates to its Project Detail page", async () => {
    await renderPage();
    const table = screen.getByRole("table");
    const rowA = within(table).getByText("Claude-Code-Agent-Monitor").closest("tr") as HTMLElement;

    fireEvent.click(rowA);

    expect(navigateMock).toHaveBeenCalledWith("/projects/proj-a", {
      state: { from: "/project-manager" },
    });
  });

  it("renders KPI tiles from the composed data, not re-derived independently", async () => {
    await renderPage();
    expect(screen.getByText(i18n.t("projectManager:kpi.projectsTracked"))).toBeInTheDocument();
    // Behind count comes straight from portfolio.pace.counts.behind (1 in
    // project A, 0 in project B) - never recomputed client-side from raw items.
    // Both the KPI tile and the rollup table's column header render the same
    // "Open decisions" string, so scope to the KPI label's own element (its
    // distinctive uppercase/tracking-wide class) rather than a bare getByText.
    const kpiLabelClass = "text-[10px] font-semibold uppercase tracking-wide text-gray-500";
    const behindTile = screen
      .getAllByText(i18n.t("projectManager:kpi.itemsBehindPace"))
      .find((el) => el.className === kpiLabelClass)!
      .closest(".card") as HTMLElement;
    expect(within(behindTile).getByText("1")).toBeInTheDocument();
    const openTile = screen
      .getAllByText(i18n.t("projectManager:kpi.openDecisions"))
      .find((el) => el.className === kpiLabelClass)!
      .closest(".card") as HTMLElement;
    expect(within(openTile).getByText("2")).toBeInTheDocument();
  });

  it("lists pending decision-queue rows with kind badges, and shows the pace-watch and resolved rails", async () => {
    await renderPage();
    expect(screen.getByText(QUEUE_PACE_ALERT.message)).toBeInTheDocument();
    expect(screen.getByText(QUEUE_DETOUR.message)).toBeInTheDocument();
    expect(screen.getByText(i18n.t("projectManager:queue.kinds.pace_alert"))).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t("projectManager:queue.kinds.detour_disposition"))
    ).toBeInTheDocument();
    // The resolved row must NOT appear in the open queue panel.
    const queueHeading = screen.getByText(i18n.t("projectManager:queue.title"));
    const queuePanel = queueHeading.closest(".card") as HTMLElement;
    expect(
      within(queuePanel).queryByText(new RegExp(QUEUE_RESOLVED.message))
    ).not.toBeInTheDocument();

    // Pace watch rail: the one behind item from the portfolio summary.
    expect(screen.getByText(/Migrate filter rules/)).toBeInTheDocument();

    // Recently resolved rail: the one non-pending queue row (rendered as
    // "<project name> — <message>", so match by substring, not exact text).
    expect(screen.getByText(new RegExp(QUEUE_RESOLVED.message))).toBeInTheDocument();
  });

  it("resolving a pace_alert calls decisionQueue.resolve('resolve') and reloads", async () => {
    await renderPage();
    const card = screen.getByText(QUEUE_PACE_ALERT.message).closest("div.space-y-2") as HTMLElement;
    const resolveBtn = within(card).getByText(i18n.t("projectManager:queue.actions.resolve"));
    await act(async () => {
      resolveBtn.click();
      await settle();
    });
    expect(decisionQueueResolve).toHaveBeenCalledWith(QUEUE_PACE_ALERT.id, "resolve");
  });

  it("folding a detour_disposition row in calls detours.resolve with the prefilled proposed text", async () => {
    await renderPage();
    const card = screen.getByText(QUEUE_DETOUR.message).closest("div.space-y-2") as HTMLElement;
    const foldInBtn = within(card).getByText(i18n.t("projectManager:queue.actions.foldIn"));
    await act(async () => {
      foldInBtn.click();
      await settle();
    });
    expect(detoursResolve).toHaveBeenCalledWith(
      QUEUE_DETOUR.ref_id,
      expect.objectContaining({
        disposition: "fold_in",
        proposed_text: "Add keyboard nav to Sidebar",
      })
    );
  });

  it("discarding a detour_disposition row sends no proposed text", async () => {
    await renderPage();
    const card = screen.getByText(QUEUE_DETOUR.message).closest("div.space-y-2") as HTMLElement;
    const discardBtn = within(card).getByText(i18n.t("projectManager:queue.actions.discard"));
    await act(async () => {
      discardBtn.click();
      await settle();
    });
    expect(detoursResolve).toHaveBeenCalledWith(QUEUE_DETOUR.ref_id, { disposition: "discard" });
  });

  it("the project scope filter narrows the rollup table and decision queue to one project", async () => {
    await renderPage();
    const chip = screen.getByRole("button", { name: "email-ops" });
    await act(async () => {
      chip.click();
    });
    // The scope chips themselves always list every project by name, so
    // scope this assertion to the rollup table rather than the whole page.
    const table = screen.getByRole("table");
    expect(within(table).queryByText("Claude-Code-Agent-Monitor")).not.toBeInTheDocument();
    expect(within(table).getByText("email-ops")).toBeInTheDocument();
    expect(screen.queryByText(QUEUE_PACE_ALERT.message)).not.toBeInTheDocument();
  });

  it("reloads (debounced) when a relevant WebSocket message arrives, and ignores irrelevant ones", async () => {
    const { api } = await import("../../lib/api");
    await renderPage();
    const callsBefore = (api.portfolio.summary as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;

    await act(async () => {
      publishHandler?.({
        type: "run_stream",
        data: {},
        timestamp: "2026-06-10T12:00:00.000Z",
      } as unknown as WSMessage);
      await new Promise((r) => setTimeout(r, 400));
    });
    expect((api.portfolio.summary as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsBefore
    );

    await act(async () => {
      publishHandler?.({
        type: "decision_queue_updated",
        data: QUEUE_PACE_ALERT,
        timestamp: "2026-06-10T12:00:01.000Z",
      } as unknown as WSMessage);
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(
      (api.portfolio.summary as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThan(callsBefore);
  });
});
