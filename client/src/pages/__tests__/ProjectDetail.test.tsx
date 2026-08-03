/**
 * @file ProjectDetail.test.tsx
 * @description Tests for the Project Detail page: the not-found state for an
 * unknown project id, rendering the plan/repo/worktree/suggested-sibling/
 * team-intake sections against a mocked api layer, and that adding a
 * suggested sibling repo calls addPath then refetches the repo topology.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectDetail } from "../ProjectDetail";
import type {
  Project,
  ProjectIntakeReport,
  ProjectRepoTopology,
  Session,
  UnassignedProjectBucket,
} from "../../lib/types";

const mockProject: Project = {
  id: "proj-1",
  name: "Agent Monitor",
  paths: [{ id: 1, cwd: "/repo/agent-monitor" }],
  session_count: 1,
  active_count: 1,
  last_activity: "2026-06-10T12:00:00.000Z",
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-10T12:00:00.000Z",
  pinned: false,
};

const mockUnassigned: UnassignedProjectBucket = {
  cwds: [],
  session_count: 0,
  active_count: 0,
  last_activity: null,
};

const mockSessions: Session[] = [
  {
    id: "sess-1",
    name: "Test session",
    status: "active",
    cwd: "/repo/agent-monitor",
    model: "claude-opus-4-6",
    started_at: "2026-06-10T11:00:00.000Z",
    ended_at: null,
    metadata: null,
  } as Session,
];

const mockRepoTopology: ProjectRepoTopology = {
  project_id: "proj-1",
  repos: [
    {
      cwd: "/repo/agent-monitor",
      pathId: 1,
      worktrees: [
        {
          path: "/repo/agent-monitor",
          head: "abcdef1234567890",
          branch: "refs/heads/master",
          bare: false,
          detached: false,
          locked: false,
          prunable: false,
          dirty: false,
        },
      ],
    },
  ],
  nonRepoFolders: [{ cwd: "/repo/scratch-notes", pathId: 2 }],
  detectedSiblings: [
    { name: "sibling-repo", path: "/repo/sibling-repo", sourceRepoCwd: "/repo/agent-monitor" },
  ],
};

const mockIntakeReport: ProjectIntakeReport = {
  project_id: "proj-1",
  initiatives: [
    {
      sourceCwd: "/repo/agent-monitor",
      slug: "2026-08-01-build-project-manager",
      path: "/repo/agent-monitor/intake/2026-08-01-build-project-manager",
      stage: "qa",
      artifacts: {
        requestBrief: true,
        technicalPlan: true,
        qaAssessment: true,
        buildReport: false,
        merged: false,
      },
    },
  ],
};

const listMock = vi.fn();
const reposMock = vi.fn();
const intakeMock = vi.fn();
const addPathMock = vi.fn();
const sessionsListMock = vi.fn();
const projectRollupMock = vi.fn();
const focusAllMock = vi.fn();
const trunkDriftMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    projects: {
      list: (...args: unknown[]) => listMock(...args),
      repos: (...args: unknown[]) => reposMock(...args),
      intake: (...args: unknown[]) => intakeMock(...args),
      addPath: (...args: unknown[]) => addPathMock(...args),
      trunkDrift: (...args: unknown[]) => trunkDriftMock(...args),
    },
    sessions: {
      list: (...args: unknown[]) => sessionsListMock(...args),
    },
    plans: {
      projectRollup: (...args: unknown[]) => projectRollupMock(...args),
      focusAll: (...args: unknown[]) => focusAllMock(...args),
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

function renderPage(id = "proj-1") {
  return render(
    <MemoryRouter initialEntries={[`/projects/${id}`]}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProjectDetail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({ projects: [mockProject], unassigned: mockUnassigned });
    reposMock.mockResolvedValue(mockRepoTopology);
    intakeMock.mockResolvedValue(mockIntakeReport);
    sessionsListMock.mockResolvedValue({ sessions: mockSessions, total: mockSessions.length });
    projectRollupMock.mockResolvedValue({ project_id: "proj-1", plans: [] });
    focusAllMock.mockResolvedValue({ focus: [] });
    addPathMock.mockResolvedValue({ project: mockProject });
    trunkDriftMock.mockResolvedValue({ repos: [] });
  });

  it("shows a not-found state for an unknown project id", async () => {
    renderPage("does-not-exist");

    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    expect(screen.getByText("Back to Projects")).toBeInTheDocument();
  });

  it("renders the project name, repos with worktrees, non-repo folders, suggested siblings, and intake initiatives", async () => {
    renderPage();

    expect(await screen.findByText("Agent Monitor")).toBeInTheDocument();
    expect(reposMock).toHaveBeenCalledWith("proj-1");
    expect(intakeMock).toHaveBeenCalledWith("proj-1");

    // Repo card: shows the repo's tail path (last two segments) and its
    // worktree branch — see pathTail() in lib/format.ts.
    expect(screen.getAllByText("repo/agent-monitor").length).toBeGreaterThan(0);
    expect(screen.getByText("refs/heads/master")).toBeInTheDocument();
    expect(screen.getByText("Clean")).toBeInTheDocument();

    // Non-repo folder line.
    expect(screen.getByText("/repo/scratch-notes")).toBeInTheDocument();
    expect(screen.getByText(/Not a git repo/)).toBeInTheDocument();

    // Suggested sibling repo.
    expect(screen.getByText("sibling-repo")).toBeInTheDocument();
    expect(screen.getByText("Add to project")).toBeInTheDocument();

    // Team-intake initiative with its inferred stage badge.
    expect(screen.getByText("2026-08-01-build-project-manager")).toBeInTheDocument();
    expect(screen.getByText("QA")).toBeInTheDocument();
  });

  it("adding a suggested sibling calls addPath then refetches repo topology", async () => {
    renderPage();
    await screen.findByText("sibling-repo");

    fireEvent.click(screen.getByText("Add to project"));

    await waitFor(() => expect(addPathMock).toHaveBeenCalledWith("proj-1", "/repo/sibling-repo"));
    // Initial load + the post-add refetch.
    await waitFor(() => expect(reposMock).toHaveBeenCalledTimes(2));
  });

  it("renders the plan-empty and intake-empty states when there is nothing to show", async () => {
    reposMock.mockResolvedValue({
      project_id: "proj-1",
      repos: [],
      nonRepoFolders: [],
      detectedSiblings: [],
    });
    intakeMock.mockResolvedValue({ project_id: "proj-1", initiatives: [] });

    renderPage();
    await screen.findByText("Agent Monitor");

    expect(
      screen.getByText("No AGENT-PLAN.md found in this project's folders yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("None of this project's mapped folders are git repos yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("No intake/ folders found in this project's mapped folders yet.")
    ).toBeInTheDocument();
  });

  it("renders trunk-drift card with populated content (case 1)", async () => {
    trunkDriftMock.mockResolvedValue({
      repos: [
        {
          cwd: "/repo/agent-monitor",
          pathId: 1,
          drift: {
            skipped: null,
            defaultBranch: "master",
            defaultBranchVia: "remote_head",
            headSha: "abc1234567890def",
            lookbackDays: 7,
            since: "2026-07-26T00:00:00Z",
            commits: [
              {
                sha: "abc1234567890def",
                shortSha: "abc1234",
                authorName: "Test Author",
                authorEmail: "test@example.com",
                committedAt: "2026-07-28T10:00:00Z",
                subject: "Direct trunk commit",
                filesChanged: 3,
                insertions: 5,
                deletions: 1,
              },
            ],
            commitCount: 1,
            truncated: false,
            range: {
              firstSha: "abc1234567890def",
              lastSha: "abc1234567890def",
            },
          },
        },
      ],
    });

    renderPage();
    await screen.findByText("Agent Monitor");

    expect(trunkDriftMock).toHaveBeenCalledWith("proj-1");
    expect(screen.getByTestId("trunk-drift-card")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("Direct trunk commit")).toBeInTheDocument();
    expect(screen.getByText("Test Author")).toBeInTheDocument();

    // No classification/action surfaces
    expect(screen.queryByText(/fold_in|new_item|deliberate|discard/i)).not.toBeInTheDocument();
    const cardElement = screen.getByTestId("trunk-drift-card");
    const buttons = cardElement.querySelectorAll("button");
    const hasActionButton = Array.from(buttons).some((btn) =>
      /dismiss|resolve|fold|discard|classify/i.test(btn.textContent || "")
    );
    expect(hasActionButton).toBe(false);
  });

  it("renders skipped state as unknown (case 2)", async () => {
    trunkDriftMock.mockResolvedValue({
      repos: [
        {
          cwd: "/repo/agent-monitor",
          pathId: 1,
          drift: {
            skipped: "no_default_branch",
            repoPath: "/repo/agent-monitor",
          },
        },
      ],
    });

    renderPage();
    await screen.findByText("Agent Monitor");

    const cardElement = screen.getByTestId("trunk-drift-card");
    const cardText = cardElement.textContent || "";
    expect(cardText.toLowerCase()).toContain("unknown");
    expect(cardText.toLowerCase()).not.toContain("clean");
  });

  it("distinguishes empty-clean state from unknown state (case 3 — load-bearing guard)", async () => {
    trunkDriftMock.mockResolvedValue({
      repos: [
        {
          cwd: "/repo/agent-monitor",
          pathId: 1,
          drift: {
            skipped: null,
            defaultBranch: "master",
            defaultBranchVia: "remote_head",
            headSha: "def7890",
            lookbackDays: 7,
            since: "2026-07-26T00:00:00Z",
            commits: [],
            commitCount: 0,
            truncated: false,
            range: null,
          },
        },
        {
          cwd: "/repo/other-repo",
          pathId: 2,
          drift: {
            skipped: "no_default_branch",
            repoPath: "/repo/other-repo",
          },
        },
      ],
    });

    renderPage();
    await screen.findByText("Agent Monitor");

    const cardElements = screen.getAllByTestId("trunk-drift-card");
    expect(cardElements.length).toBe(2);

    // Find the text for each state
    const allCardText = cardElements.map((el) => el.textContent || "");
    const cleanText = allCardText.find(
      (text) => text.toLowerCase().includes("no direct") || text.toLowerCase().includes("commits")
    );
    const unknownText = allCardText.find((text) => text.toLowerCase().includes("unknown"));

    expect(cleanText).toBeTruthy();
    expect(unknownText).toBeTruthy();
    expect(cleanText).not.toBe(unknownText);
  });

  it("handles trunk-drift api error gracefully (case 4)", async () => {
    trunkDriftMock.mockRejectedValue(new Error("network error"));

    renderPage();
    await screen.findByText("Agent Monitor");

    // Page should still render project name and existing cards. "repo/agent-monitor"
    // is rendered more than once on this page (shared mock fixtures used
    // elsewhere on the screen also render it), so scope with getAllByText
    // rather than the unscoped, collision-prone getByText.
    expect(screen.getByText("Agent Monitor")).toBeInTheDocument();
    expect(screen.getAllByText("repo/agent-monitor").length).toBeGreaterThan(0);
  });
});
