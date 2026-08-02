/**
 * @file KanbanBoard.layoutMenu.test.tsx
 * @description Tests the Kanban board's combined layout menu (see
 * `LayoutMenu` in KanbanBoard.tsx) - the single icon that replaced the old
 * pair of blind cycle-buttons (orientation toggle + wrap-count cycle) on
 * each Agents/Sessions status column header. Verifies the full flow reads
 * as "one click to open, one click on the visual tile you want, done": the
 * popover opens on trigger click, picking a tile applies both the
 * orientation and the wrap count in a single step and closes the popover,
 * and the choice is persisted to localStorage keyed by view+status like the
 * old controls were.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KanbanBoard } from "../KanbanBoard";
import type { Agent, Session } from "../../lib/types";

const STATUS_COLUMN_ORIENTATION_STORAGE_KEY = "kanban-status-column-orientation";
const STATUS_COLUMN_WRAP_STORAGE_KEY = "kanban-status-column-wrap";

const mockWorkingAgent: Agent = {
  id: "agent-1",
  session_id: "sess-1",
  name: "Worker",
  status: "working",
  task: "Doing work",
  started_at: "2026-06-10T11:00:00.000Z",
  ended_at: null,
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

// Every status column gets its own layout-menu trigger, so a bare
// `getByTitle("Arrange layout")` matches more than one. The column label
// (`title={label}` on its own span) is unique, and shares a header row with
// its trigger, so scope the query through that.
function getWorkingColumnLayoutTrigger() {
  const headerRow = screen.getByTitle("Working").closest("div");
  if (!headerRow) throw new Error("Working column header row not found");
  return within(headerRow).getByTitle("Arrange layout");
}

describe("Kanban Board - combined layout menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.clear();
    } catch {
      /* jsdom always has localStorage; guard only for odd environments */
    }
    agentsListMock.mockImplementation((params?: { status?: string }) =>
      Promise.resolve({
        agents:
          params?.status === "working"
            ? [mockWorkingAgent]
            : [mockWorkingAgent].filter((a) => a.status === params?.status),
      })
    );
    sessionsListMock.mockResolvedValue({ sessions: [mockActiveSession], total: 1 });
    projectsListMock.mockResolvedValue({
      projects: [],
      unassigned: { cwds: [], session_count: 0, active_count: 0, last_activity: null },
    });
  });

  it("opens on one click, applies a full orientation+wrap combination on the next click, and closes", async () => {
    renderPage();
    await screen.findByText("Worker");

    const trigger = getWorkingColumnLayoutTrigger();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Tiles aren't in the document until the menu is opened.
    expect(screen.queryByTitle("2 columns")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const twoColumnsTile = await screen.findByTitle("2 columns");

    fireEvent.click(twoColumnsTile);

    // One click on a tile both applies the pick and closes the popover.
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByTitle("2 columns")).not.toBeInTheDocument();

    const orientationMap = JSON.parse(
      localStorage.getItem(STATUS_COLUMN_ORIENTATION_STORAGE_KEY) ?? "{}"
    );
    const wrapMap = JSON.parse(localStorage.getItem(STATUS_COLUMN_WRAP_STORAGE_KEY) ?? "{}");
    expect(orientationMap["agents-working"]).toBe("horizontal");
    expect(wrapMap["agents-working"]).toBe("2");
  });

  it("closes without changing anything when clicking outside the popover", async () => {
    renderPage();
    await screen.findByText("Worker");

    fireEvent.click(getWorkingColumnLayoutTrigger());
    await screen.findByTitle("2 columns");

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTitle("2 columns")).not.toBeInTheDocument();
    expect(localStorage.getItem(STATUS_COLUMN_ORIENTATION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(STATUS_COLUMN_WRAP_STORAGE_KEY)).toBeNull();
  });
});
