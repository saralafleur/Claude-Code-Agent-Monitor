/**
 * @file KanbanBoard.errorColumn.test.tsx
 * @description Tests that the Kanban board's Agents and Sessions views drop
 * their "Error" status column outright when nothing is in it, and bring it
 * back the moment an agent/session lands in "error" status - unlike "Hide
 * completed"/"Hide abandoned", this isn't a user preference toggle, so no
 * interaction is needed to see it appear or disappear.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KanbanBoard } from "../KanbanBoard";
import type { Agent, Session } from "../../lib/types";

const mockWorkingAgent: Agent = {
  id: "agent-1",
  session_id: "sess-1",
  name: "Worker",
  status: "working",
  task: "Doing work",
  started_at: "2026-06-10T11:00:00.000Z",
  ended_at: null,
} as Agent;

const mockErrorAgent: Agent = {
  ...mockWorkingAgent,
  id: "agent-2",
  status: "error",
} as Agent;

const mockActiveSession: Session = {
  id: "sess-1",
  name: "Active session",
  status: "active",
  cwd: "/repo/agent-monitor",
  model: "claude-opus-4-6",
  started_at: "2026-06-10T11:00:00.000Z",
  ended_at: null,
  metadata: null,
} as Session;

const mockErrorSession: Session = {
  ...mockActiveSession,
  id: "sess-2",
  name: "Errored session",
  status: "error",
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

describe("Kanban Board - Error column visibility", () => {
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

  it("Agents view: hides the Error column when no agent has errored, shows it once one does", async () => {
    agentsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        agents:
          params?.status === "error"
            ? []
            : params?.status
              ? [mockWorkingAgent].filter((a) => a.status === params.status)
              : [],
      })
    );
    sessionsListMock.mockResolvedValue({ sessions: [mockActiveSession], total: 1 });

    renderPage();
    await screen.findByText("Worker");
    expect(screen.queryByTitle("Error")).not.toBeInTheDocument();

    agentsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        agents:
          params?.status === "error"
            ? [mockErrorAgent]
            : params?.status === "working"
              ? [mockWorkingAgent]
              : [],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByTitle("Error")).toBeInTheDocument());
  });

  it("Sessions view: hides the Error column when no session has errored, shows it once one does", async () => {
    sessionsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        sessions:
          params?.status === "error"
            ? []
            : [mockActiveSession].filter((s) => s.status === params?.status),
        total: 0,
      })
    );

    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Sessions" }));
    await screen.findByText("Active session");
    expect(screen.queryByTitle("Error")).not.toBeInTheDocument();

    sessionsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        sessions:
          params?.status === "error"
            ? [mockErrorSession]
            : [mockActiveSession].filter((s) => s.status === params?.status),
        total: 1,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByTitle("Error")).toBeInTheDocument());
  });
});
