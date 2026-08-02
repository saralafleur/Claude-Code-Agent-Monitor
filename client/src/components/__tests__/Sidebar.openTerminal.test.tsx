/**
 * @file Sidebar.openTerminal.test.tsx
 * @description Tests the Sidebar's "New session…" icon button, a second
 * entry point to the shared OpenTerminalModal project/session picker (the
 * Kanban board header owns the first one, see
 * KanbanBoard.openTerminalMenu.test.tsx). When expanded it sits next to the
 * Projects nav row; when collapsed it becomes its own icon-only row directly
 * above the Projects icon rather than disappearing. Only proves the button
 * wires up to the modal and repositions correctly across both states — the
 * picker's own mechanics are covered by OpenTerminalModal's own test file.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../Sidebar";
import type { Project } from "../../lib/types";

const projectsListMock = vi.fn();
const openTerminalMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    projects: {
      list: (...args: unknown[]) => projectsListMock(...args),
      openTerminal: (...args: unknown[]) => openTerminalMock(...args),
    },
    updates: {
      check: vi.fn().mockResolvedValue({ git_repo: false, update_available: false }),
    },
  },
}));

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

function renderSidebar(collapsed = false) {
  return render(
    <MemoryRouter>
      <Sidebar wsConnected={true} collapsed={collapsed} onToggle={() => {}} />
    </MemoryRouter>
  );
}

describe("Sidebar - New session button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectsListMock.mockResolvedValue({
      projects: [mockProject],
      unassigned: { cwds: [], session_count: 0, active_count: 0, last_activity: null },
    });
  });

  it("is reachable from the Projects nav row and opens the picker", () => {
    renderSidebar();

    fireEvent.click(screen.getByTitle("New session…"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens a single-folder project's terminal via api.projects.openTerminal", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    renderSidebar();

    fireEvent.click(screen.getByTitle("New session…"));

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Agent Monitor"));

    expect(openTerminalMock).toHaveBeenCalledWith("proj-1", "/repo/agent-monitor");
  });

  it("appears as its own row directly above the Projects icon while collapsed", () => {
    renderSidebar(true);

    const nav = screen.getByRole("navigation");
    const newSessionButton = screen.getByTitle("New session…");
    const projectsLink = screen.getByTitle("Projects");
    const items = Array.from(nav.querySelectorAll("a, button"));

    expect(items.indexOf(projectsLink)).toBe(items.indexOf(newSessionButton) + 1);
  });
});
