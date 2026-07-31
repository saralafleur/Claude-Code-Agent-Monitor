/**
 * @file KanbanBoard.openTerminalMenu.test.tsx
 * @description Tests the Kanban board header's "Open terminal in project…"
 * entry (in the same overflow "filters" menu as hide-completed/
 * hide-abandoned/etc.): reachable from any board view, not just Projects,
 * opens OpenTerminalModal's picker, and a single-folder project opens
 * directly through it via api.projects.openTerminal. OpenTerminalModal's
 * own picker mechanics (multi-folder drill-in, error/success feedback) are
 * covered by its own test file — this one only proves the menu entry wires
 * up to the modal correctly.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KanbanBoard } from "../KanbanBoard";
import type { Agent, Project } from "../../lib/types";

const agentsListMock = vi.fn();
const sessionsListMock = vi.fn();
const projectsListMock = vi.fn();
const openTerminalMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    agents: { list: (...args: unknown[]) => agentsListMock(...args) },
    sessions: { list: (...args: unknown[]) => sessionsListMock(...args) },
    projects: {
      list: (...args: unknown[]) => projectsListMock(...args),
      openTerminal: (...args: unknown[]) => openTerminalMock(...args),
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

const mockAgent: Agent = {
  id: "agent-1",
  session_id: "sess-1",
  name: "Worker",
  status: "working",
  task: "Doing work",
  started_at: "2026-06-10T11:00:00.000Z",
  ended_at: null,
} as Agent;

const mockProject: Project = {
  id: "proj-1",
  name: "Agent Monitor",
  paths: [{ id: 1, cwd: "/repo/agent-monitor" }],
  session_count: 0,
  active_count: 0,
  last_activity: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <KanbanBoard />
    </MemoryRouter>
  );
}

describe("Kanban Board - Open terminal in project menu entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.clear();
    } catch {
      /* jsdom always has localStorage; guard only for odd environments */
    }
    agentsListMock.mockResolvedValue({ agents: [] });
    sessionsListMock.mockResolvedValue({ sessions: [], total: 0 });
    projectsListMock.mockResolvedValue({
      projects: [mockProject],
      unassigned: { cwds: [], session_count: 0, active_count: 0, last_activity: null },
    });
  });

  it("is reachable from the Agents view's filters menu and opens the picker", async () => {
    renderPage();
    // Waits for the load to fully settle (not just for the mock to have been
    // called) before interacting - React 18 can interleave a still-in-flight
    // data-load render with a synchronous click's own render, so a weaker
    // "was it called" wait can race an in-progress commit.
    await screen.findByText("No agents tracked yet");

    fireEvent.click(screen.getByTitle("Filters"));
    fireEvent.click(screen.getByText("Open terminal in project…"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
  });

  it("opens a single-folder project's terminal via api.projects.openTerminal", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    renderPage();
    // Waits for the load to fully settle (not just for the mock to have been
    // called) before interacting - React 18 can interleave a still-in-flight
    // data-load render with a synchronous click's own render, so a weaker
    // "was it called" wait can race an in-progress commit.
    await screen.findByText("No agents tracked yet");

    fireEvent.click(screen.getByTitle("Filters"));
    fireEvent.click(screen.getByText("Open terminal in project…"));

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Agent Monitor"));

    expect(openTerminalMock).toHaveBeenCalledWith("proj-1", "/repo/agent-monitor");
  });

  it("closes the filters menu when the entry is clicked", async () => {
    renderPage();
    // Waits for the load to fully settle (not just for the mock to have been
    // called) before interacting - React 18 can interleave a still-in-flight
    // data-load render with a synchronous click's own render, so a weaker
    // "was it called" wait can race an in-progress commit.
    await screen.findByText("No agents tracked yet");

    fireEvent.click(screen.getByTitle("Filters"));
    expect(screen.getByRole("menuitem", { name: "Hide completed" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open terminal in project…"));

    expect(screen.queryByRole("menuitem", { name: "Hide completed" })).not.toBeInTheDocument();
  });

  // A non-empty board takes a DIFFERENT return branch than the other tests
  // here (KanbanBoard early-returns a dedicated empty-state tree when
  // `total === 0`, which is what those tests exercise) - guards against a
  // regression where the picker modal is wired into only one of the two
  // branches (exactly what shipped first: the empty-state branch reused
  // `Header`, so the menu entry and click handler both fired, but the modal
  // itself lived only in the other branch and never rendered).
  it("is also reachable when the board has agents (the non-empty-state branch)", async () => {
    agentsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        agents: params?.status === "working" ? [mockAgent] : [],
      })
    );
    renderPage();
    await screen.findByText("Worker");

    fireEvent.click(screen.getByTitle("Filters"));
    fireEvent.click(screen.getByText("Open terminal in project…"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
  });
});
