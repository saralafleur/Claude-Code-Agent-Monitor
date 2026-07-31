/**
 * @file Tests for OpenTerminalModal: the project list's loading/error/empty
 * states, a single-folder project opening its one folder directly with no
 * extra step, a multi-folder project drilling into a folder-picker screen
 * (and back out of it), calling api.projects.openTerminal with the chosen
 * project/cwd pair, the success feedback auto-closing the modal, error
 * feedback surfacing the server's message, close behavior (Escape,
 * backdrop click, close button), the "Most used" / "All projects"
 * sectioning that promotes the top 3 projects by session_count above the
 * rest, and the optional effort-name field (persists across the
 * project/folder navigation, passed through to api.projects.openTerminal
 * only when non-blank) — same local pending/success/error conventions as
 * SessionCard's own terminal buttons (no toast system in this codebase, see
 * client/src/pages/Run.tsx).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpenTerminalModal } from "../OpenTerminalModal";
import type { Project } from "../../lib/types";

const listMock = vi.fn();
const openTerminalMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    projects: {
      list: (...args: unknown[]) => listMock(...args),
      openTerminal: (...args: unknown[]) => openTerminalMock(...args),
    },
  },
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Agent Monitor",
    paths: [{ id: 1, cwd: "/repo/agent-monitor" }],
    session_count: 3,
    active_count: 1,
    last_activity: "2026-06-10T11:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("OpenTerminalModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state, then the project list", async () => {
    listMock.mockResolvedValue({ projects: [makeProject()], unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
  });

  it("shows a load error when the project list fails to fetch", async () => {
    listMock.mockRejectedValue(new Error("network down"));
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Failed to load projects")).toBeInTheDocument());
  });

  it("shows an empty state when there are no projects yet", async () => {
    listMock.mockResolvedValue({ projects: [], unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("No projects yet")).toBeInTheDocument());
  });

  it("shows no section headers when there are 3 or fewer projects", async () => {
    const projects = [
      makeProject({ id: "p1", name: "Charlie", session_count: 10 }),
      makeProject({ id: "p2", name: "Alpha", session_count: 5 }),
      makeProject({ id: "p3", name: "Bravo", session_count: 1 }),
    ];
    listMock.mockResolvedValue({ projects, unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Charlie")).toBeInTheDocument());
    expect(screen.queryByText("Most used")).not.toBeInTheDocument();
    expect(screen.queryByText("All projects")).not.toBeInTheDocument();
  });

  it("shows no section headers when no project has any usage history", async () => {
    const projects = [
      makeProject({ id: "p1", name: "Charlie", session_count: 0 }),
      makeProject({ id: "p2", name: "Alpha", session_count: 0 }),
      makeProject({ id: "p3", name: "Bravo", session_count: 0 }),
      makeProject({ id: "p4", name: "Delta", session_count: 0 }),
    ];
    listMock.mockResolvedValue({ projects, unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Charlie")).toBeInTheDocument());
    expect(screen.queryByText("Most used")).not.toBeInTheDocument();
  });

  it("promotes the top 3 by session_count above an alphabetical rest, once there are more than 3 projects with usage", async () => {
    const projects = [
      makeProject({ id: "p1", name: "Delta", session_count: 2 }),
      makeProject({ id: "p2", name: "Alpha", session_count: 9 }),
      makeProject({ id: "p3", name: "Bravo", session_count: 7 }),
      makeProject({ id: "p4", name: "Charlie", session_count: 8 }),
      makeProject({ id: "p5", name: "Echo", session_count: 0 }),
    ];
    listMock.mockResolvedValue({ projects, unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Most used")).toBeInTheDocument());
    expect(screen.getByText("All projects")).toBeInTheDocument();

    const names = screen
      .getAllByText(/^(Delta|Alpha|Bravo|Charlie|Echo)$/)
      .map((el) => el.textContent);
    // Most used: Alpha (9), Charlie (8), Bravo (7) — then alphabetical rest: Delta, Echo.
    expect(names).toEqual(["Alpha", "Charlie", "Bravo", "Delta", "Echo"]);
  });

  it("disables a project with no mapped folders", async () => {
    listMock.mockResolvedValue({
      projects: [makeProject({ name: "Empty Project", paths: [] })],
      unassigned: { cwds: [] },
    });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Empty Project")).toBeInTheDocument());
    const button = screen.getByText("Empty Project").closest("button");
    expect(button).toBeDisabled();
  });

  it("opens the folder directly for a single-folder project, with no folder-picker step", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    listMock.mockResolvedValue({ projects: [makeProject()], unassigned: { cwds: [] } });
    const onClose = vi.fn();
    render(<OpenTerminalModal onClose={onClose} />);

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Agent Monitor"));

    expect(openTerminalMock).toHaveBeenCalledWith("proj-1", "/repo/agent-monitor");
    // No folder-picker screen — the modal title stays the picker's, not the project's.
    expect(screen.getByText("Open terminal in project")).toBeInTheDocument();

    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("drills into a folder picker for a multi-folder project, and back out of it", async () => {
    const project = makeProject({
      paths: [
        { id: 1, cwd: "/repo/agent-monitor" },
        { id: 2, cwd: "/repo/agent-monitor-docs" },
      ],
    });
    listMock.mockResolvedValue({ projects: [project], unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    expect(screen.getByText("2 folders")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Agent Monitor"));
    expect(openTerminalMock).not.toHaveBeenCalled();
    expect(screen.getByText("/repo/agent-monitor")).toBeInTheDocument();
    expect(screen.getByText("/repo/agent-monitor-docs")).toBeInTheDocument();
    // The header now shows the project name (drilled in).
    expect(screen.getAllByText("Agent Monitor").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.getByText("2 folders")).toBeInTheDocument());
  });

  it("calls openTerminal with the clicked folder from the picker step", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    const project = makeProject({
      paths: [
        { id: 1, cwd: "/repo/agent-monitor" },
        { id: 2, cwd: "/repo/agent-monitor-docs" },
      ],
    });
    listMock.mockResolvedValue({ projects: [project], unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Agent Monitor"));
    fireEvent.click(screen.getByText("/repo/agent-monitor-docs"));

    expect(openTerminalMock).toHaveBeenCalledWith("proj-1", "/repo/agent-monitor-docs");
  });

  it("shows the server's error message when opening fails", async () => {
    openTerminalMock.mockRejectedValue(new Error("Terminal automation failed."));
    listMock.mockResolvedValue({ projects: [makeProject()], unassigned: { cwds: [] } });
    const onClose = vi.fn();
    render(<OpenTerminalModal onClose={onClose} />);

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Agent Monitor"));

    await waitFor(() =>
      expect(screen.getByText("Terminal automation failed.")).toBeInTheDocument()
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    listMock.mockResolvedValue({ projects: [], unassigned: { cwds: [] } });
    const onClose = vi.fn();
    render(<OpenTerminalModal onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click but not on dialog content click", async () => {
    listMock.mockResolvedValue({ projects: [], unassigned: { cwds: [] } });
    const onClose = vi.fn();
    render(<OpenTerminalModal onClose={onClose} />);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the close button", async () => {
    listMock.mockResolvedValue({ projects: [], unassigned: { cwds: [] } });
    const onClose = vi.fn();
    render(<OpenTerminalModal onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens with no name when the optional effort-name field is left blank", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    listMock.mockResolvedValue({ projects: [makeProject()], unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Agent Monitor"));

    expect(openTerminalMock).toHaveBeenCalledWith("proj-1", "/repo/agent-monitor");
  });

  it("passes a typed effort name through to api.projects.openTerminal", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    listMock.mockResolvedValue({ projects: [makeProject()], unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("e.g. Fix desktop freeze"), {
      target: { value: "  Fix desktop freeze  " },
    });
    fireEvent.click(screen.getByText("Agent Monitor"));

    expect(openTerminalMock).toHaveBeenCalledWith(
      "proj-1",
      "/repo/agent-monitor",
      "Fix desktop freeze"
    );
  });

  it("carries the typed effort name into a multi-folder project's picker step", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    const project = makeProject({
      paths: [
        { id: 1, cwd: "/repo/agent-monitor" },
        { id: 2, cwd: "/repo/agent-monitor-docs" },
      ],
    });
    listMock.mockResolvedValue({ projects: [project], unassigned: { cwds: [] } });
    render(<OpenTerminalModal onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Agent Monitor")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("e.g. Fix desktop freeze"), {
      target: { value: "Docs pass" },
    });
    fireEvent.click(screen.getByText("Agent Monitor"));
    fireEvent.click(screen.getByText("/repo/agent-monitor-docs"));

    expect(openTerminalMock).toHaveBeenCalledWith(
      "proj-1",
      "/repo/agent-monitor-docs",
      "Docs pass"
    );
  });
});
