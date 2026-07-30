/**
 * @file KanbanBoard.hideOldErrors.test.tsx
 * @description Tests the Kanban board's "Hide errors older than 1 week"
 * toggle on the Agents and Sessions views - unlike the Error column's
 * hide-when-empty behavior (see KanbanBoard.errorColumn.test.tsx), this one
 * is a user preference: it starts off (all errors visible, including ones
 * left over from before the periodic purge runs) and, once switched on,
 * drops only the error items whose ended_at/last activity is more than a
 * week old, leaving recent errors and the column itself alone.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KanbanBoard } from "../KanbanBoard";
import type { Agent, Session } from "../../lib/types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const oldTimestamp = new Date(Date.now() - 10 * ONE_DAY_MS).toISOString();
const recentTimestamp = new Date(Date.now() - 1 * ONE_DAY_MS).toISOString();

const mockOldErrorAgent: Agent = {
  id: "agent-old",
  session_id: "sess-1",
  name: "Old failure",
  status: "error",
  task: "Doing work",
  started_at: oldTimestamp,
  ended_at: oldTimestamp,
} as Agent;

const mockRecentErrorAgent: Agent = {
  id: "agent-recent",
  session_id: "sess-1",
  name: "Recent failure",
  status: "error",
  task: "Doing work",
  started_at: recentTimestamp,
  ended_at: recentTimestamp,
} as Agent;

const mockActiveSession: Session = {
  id: "sess-1",
  name: "Active session",
  status: "active",
  cwd: "/repo/agent-monitor",
  model: "claude-opus-4-6",
  started_at: recentTimestamp,
  ended_at: null,
  metadata: null,
} as Session;

const mockOldErrorSession: Session = {
  ...mockActiveSession,
  id: "sess-old",
  name: "Old errored session",
  status: "error",
  ended_at: oldTimestamp,
} as Session;

const mockRecentErrorSession: Session = {
  ...mockActiveSession,
  id: "sess-recent",
  name: "Recent errored session",
  status: "error",
  ended_at: recentTimestamp,
} as Session;

const agentsListMock = vi.fn();
const sessionsListMock = vi.fn();
const projectsListMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    agents: { list: (...args: unknown[]) => agentsListMock(...args) },
    sessions: { list: (...args: unknown[]) => sessionsListMock(...args) },
    projects: {
      list: (...args: unknown[]) => projectsListMock(...args),
      focusReport: vi.fn(),
    },
    monitors: {
      get: vi.fn().mockResolvedValue({ monitors: [], monitorMap: {}, collapsedProjects: {} }),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../lib/eventBus", () => ({
  eventBus: {
    subscribe: vi.fn(() => () => {}),
    onConnection: () => () => {},
    connected: true,
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <KanbanBoard />
    </MemoryRouter>
  );
}

describe("Kanban Board - Hide errors older than 1 week", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.clear();
    } catch {
      /* jsdom always has localStorage; guard only for odd environments */
    }
    projectsListMock.mockResolvedValue({
      projects: [],
      unassigned: { cwds: [], session_count: 0, active_count: 0, last_activity: null },
    });
  });

  it("Agents view: leaves old errors visible until the toggle is switched on, then hides only the old one", async () => {
    agentsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        agents: params?.status === "error" ? [mockOldErrorAgent, mockRecentErrorAgent] : [],
      })
    );
    sessionsListMock.mockResolvedValue({ sessions: [mockActiveSession], total: 1 });

    renderPage();
    await screen.findByText("Old failure");
    expect(screen.getByText("Recent failure")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide errors older than 1 week" }));

    await waitFor(() => expect(screen.queryByText("Old failure")).not.toBeInTheDocument());
    expect(screen.getByText("Recent failure")).toBeInTheDocument();
    expect(screen.getByTitle("Error")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all errors" }));
    await waitFor(() => expect(screen.getByText("Old failure")).toBeInTheDocument());
  });

  it("Agents view: drops the Error column once toggling hides the only (old) error", async () => {
    agentsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        agents: params?.status === "error" ? [mockOldErrorAgent] : [],
      })
    );
    sessionsListMock.mockResolvedValue({ sessions: [mockActiveSession], total: 1 });

    renderPage();
    await screen.findByText("Old failure");
    expect(screen.getByTitle("Error")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide errors older than 1 week" }));

    await waitFor(() => expect(screen.queryByTitle("Error")).not.toBeInTheDocument());
  });

  it("Sessions view: hides only the old errored session, persists the choice across a refresh", async () => {
    sessionsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        sessions:
          params?.status === "error"
            ? [mockOldErrorSession, mockRecentErrorSession]
            : [mockActiveSession].filter((s) => s.status === params?.status),
        total: 2,
      })
    );

    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Sessions" }));
    await screen.findByText("Old errored session");
    expect(screen.getByText("Recent errored session")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide errors older than 1 week" }));
    await waitFor(() => expect(screen.queryByText("Old errored session")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Recent errored session");
    expect(screen.queryByText("Old errored session")).not.toBeInTheDocument();

    expect(localStorage.getItem("kanban-hide-old-errors")).toBe("true");
  });
});
