/**
 * @file ProjectDetail.test.tsx
 * @description Tests for the Project Detail page: the not-found state for an
 * unknown project id, rendering the plan/repo/worktree/suggested-sibling/
 * team-intake sections against a mocked api layer, and that adding a
 * suggested sibling repo calls addPath then refetches the repo topology.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
  siblingScanEnabled: false,
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
    {
      name: "sibling-repo",
      path: "/repo/sibling-repo",
      sourceRepoCwd: "/repo/agent-monitor",
      source: "context",
    },
  ],
  ignoredRepos: [],
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
      mergeRecorded: false,
      mergeCommit: null,
      worktree: {
        path: "/repo/efforts/2026-08-01-build-project-manager/agent-monitor",
        branch: "effort/2026-08-01-build-project-manager",
      },
    },
    {
      sourceCwd: "/repo/agent-monitor",
      slug: "2026-07-31-focus-untracked-commits",
      path: "/repo/agent-monitor/intake/2026-07-31-focus-untracked-commits",
      stage: "released",
      artifacts: {
        requestBrief: true,
        technicalPlan: true,
        qaAssessment: true,
        buildReport: true,
        merged: true,
      },
      mergeRecorded: false,
      mergeCommit: "56242ae",
      worktree: null,
    },
  ],
};

const listMock = vi.fn();
const reposMock = vi.fn();
const intakeMock = vi.fn();
const addPathMock = vi.fn();
const removePathMock = vi.fn();
const ignoreRepoMock = vi.fn();
const unignoreRepoMock = vi.fn();
const setSiblingScanEnabledMock = vi.fn();
const setPathTerminalDefaultMock = vi.fn();
const continueWorktreeMock = vi.fn();
const sessionsListMock = vi.fn();
const projectRollupMock = vi.fn();
const focusAllMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    projects: {
      list: (...args: unknown[]) => listMock(...args),
      repos: (...args: unknown[]) => reposMock(...args),
      intake: (...args: unknown[]) => intakeMock(...args),
      addPath: (...args: unknown[]) => addPathMock(...args),
      removePath: (...args: unknown[]) => removePathMock(...args),
      ignoreRepo: (...args: unknown[]) => ignoreRepoMock(...args),
      unignoreRepo: (...args: unknown[]) => unignoreRepoMock(...args),
      setSiblingScanEnabled: (...args: unknown[]) => setSiblingScanEnabledMock(...args),
      setPathTerminalDefault: (...args: unknown[]) => setPathTerminalDefaultMock(...args),
      continueWorktree: (...args: unknown[]) => continueWorktreeMock(...args),
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
    localStorage.clear();
    listMock.mockResolvedValue({ projects: [mockProject], unassigned: mockUnassigned });
    reposMock.mockResolvedValue(mockRepoTopology);
    intakeMock.mockResolvedValue(mockIntakeReport);
    sessionsListMock.mockResolvedValue({ sessions: mockSessions, total: mockSessions.length });
    projectRollupMock.mockResolvedValue({ project_id: "proj-1", plans: [] });
    focusAllMock.mockResolvedValue({ focus: [] });
    addPathMock.mockResolvedValue({ project: mockProject });
    removePathMock.mockResolvedValue({ project: mockProject });
    ignoreRepoMock.mockResolvedValue(mockRepoTopology);
    unignoreRepoMock.mockResolvedValue(mockRepoTopology);
    setSiblingScanEnabledMock.mockResolvedValue({
      project: { ...mockProject, siblingScanEnabled: true },
    });
    setPathTerminalDefaultMock.mockResolvedValue(mockRepoTopology);
    continueWorktreeMock.mockResolvedValue({ ok: true });
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

    // Full paths are rendered as plain visible text everywhere - a
    // worktree's own path, a repo's cwd, and a suggestion's path - never
    // truncated behind a hover-only title.
    expect(screen.getAllByText("/repo/agent-monitor").length).toBeGreaterThan(0);
    expect(screen.getByText("/repo/sibling-repo")).toBeInTheDocument();

    // Every mapped repo/folder row has a Remove control (one for the repo
    // card, one for the non-repo folder row).
    expect(screen.getAllByRole("button", { name: /Remove/ })).toHaveLength(2);

    // Ignoring a suggestion is available right next to adding it, and
    // there's nothing in the (empty) Ignored repos list yet.
    expect(screen.getByText("Ignore")).toBeInTheDocument();
    expect(screen.queryByText("Ignored repos")).not.toBeInTheDocument();

    // Team-intake initiative with its inferred stage badge.
    expect(screen.getByText("2026-08-01-build-project-manager")).toBeInTheDocument();
    expect(screen.getByText("QA")).toBeInTheDocument();

    // Initiative with a live effort worktree shows its branch.
    expect(screen.getByText("effort/2026-08-01-build-project-manager")).toBeInTheDocument();

    // The released/merged initiative is done, so it starts tucked away in
    // its own collapsed subgroup rather than mixed in with active work.
    expect(screen.getByText("Released / Merged (1)")).toBeInTheDocument();
    expect(screen.queryByText("2026-07-31-focus-untracked-commits")).not.toBeInTheDocument();
    expect(screen.queryByText("No active worktree")).not.toBeInTheDocument();
    expect(screen.queryByText("Merged (no merge.json)")).not.toBeInTheDocument();

    // Expanding it reveals the initiative: no live worktree (merged &
    // cleaned up), and flags that the merge was git-detected rather than
    // recorded via merge.json.
    fireEvent.click(screen.getByText("Released / Merged (1)"));
    expect(screen.getByText("2026-07-31-focus-untracked-commits")).toBeInTheDocument();
    expect(screen.getByText("No active worktree")).toBeInTheDocument();
    expect(screen.getByText("Merged (no merge.json)")).toBeInTheDocument();
  });

  it("the sibling disk-scan toggle defaults to off, and toggling it calls setSiblingScanEnabled then refetches", async () => {
    renderPage();
    await screen.findByText("sibling-repo");

    const scanToggle = screen.getByRole("checkbox", { name: "Scan for sibling repos" });
    expect(scanToggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(scanToggle);

    await waitFor(() => expect(setSiblingScanEnabledMock).toHaveBeenCalledWith("proj-1", true));
    // Applies the returned project directly, then re-fetches topology since
    // the set of suggestions can change once the scan is enabled.
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Scan for sibling repos" })).toHaveAttribute(
        "aria-checked",
        "true"
      )
    );
    await waitFor(() => expect(reposMock).toHaveBeenCalledTimes(2));
  });

  it("the repo card's terminal-folder toggle defaults to on, and toggling it off calls setPathTerminalDefault and applies the returned topology", async () => {
    renderPage();
    await screen.findByText("sibling-repo");

    // Both the repo card and the non-repo folder row carry their own
    // "Offer for new terminal" toggle - the first is the repo card's (pathId 1).
    const firstTerminalToggle = () =>
      screen.getAllByRole("checkbox", { name: "Offer for new terminal" })[0]!;
    expect(screen.getAllByRole("checkbox", { name: "Offer for new terminal" })).toHaveLength(2);
    expect(firstTerminalToggle()).toHaveAttribute("aria-checked", "true");

    const afterToggle: ProjectRepoTopology = {
      ...mockRepoTopology,
      repos: [{ ...mockRepoTopology.repos[0]!, terminalDefault: false }],
    };
    setPathTerminalDefaultMock.mockResolvedValue(afterToggle);

    fireEvent.click(firstTerminalToggle());

    await waitFor(() =>
      expect(setPathTerminalDefaultMock).toHaveBeenCalledWith("proj-1", 1, false)
    );
    await waitFor(() => expect(firstTerminalToggle()).toHaveAttribute("aria-checked", "false"));
    // Applies the returned topology directly - no extra repos() round trip.
    expect(reposMock).toHaveBeenCalledTimes(1);
  });

  it("shows an empty-state message under Suggested repos when there are no current suggestions", async () => {
    reposMock.mockResolvedValue({ ...mockRepoTopology, detectedSiblings: [] });
    renderPage();

    await screen.findByText("Suggested repos");
    expect(screen.getByText("No suggestions right now.")).toBeInTheDocument();
    // The toggle itself stays visible/discoverable even with nothing to show.
    expect(screen.getByRole("checkbox", { name: "Scan for sibling repos" })).toBeInTheDocument();
  });

  it("the Repos card starts expanded and can be collapsed/expanded via its header toggle", async () => {
    renderPage();
    await screen.findByText("sibling-repo");

    // Expanded by default - repo content and the collapse trigger both visible.
    expect(screen.getAllByText("/repo/agent-monitor").length).toBeGreaterThan(0);
    // The toggle button's accessible name comes from its own text ("Repos"),
    // not its title tooltip, so query by title instead of role name.
    const collapseToggle = screen.getByTitle("Collapse");
    expect(collapseToggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapseToggle);

    // Body content is gone; the header (title + toggle) remains.
    expect(screen.queryByText("/repo/agent-monitor")).not.toBeInTheDocument();
    expect(screen.queryByText("sibling-repo")).not.toBeInTheDocument();
    const expandToggle = screen.getByTitle("Expand");
    expect(expandToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(expandToggle);
    expect(screen.getAllByText("/repo/agent-monitor").length).toBeGreaterThan(0);
  });

  it("the Compact view mode hides Remove/Add/Ignore actions; Full restores them and the choice persists", async () => {
    renderPage();
    await screen.findByText("sibling-repo");

    // Full is the default.
    expect(screen.getAllByRole("button", { name: /Remove/ })).toHaveLength(2);
    expect(screen.getByText("Add to project")).toBeInTheDocument();
    expect(screen.getByText("Ignore")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Compact" }));

    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Add to project")).not.toBeInTheDocument();
    expect(screen.queryByText("Ignore")).not.toBeInTheDocument();
    // The information itself stays visible in Compact - only the actions hide.
    expect(screen.getByText("sibling-repo")).toBeInTheDocument();
    expect(localStorage.getItem("project-detail-repos-view-mode")).toBe("compact");

    fireEvent.click(screen.getByRole("button", { name: "Full" }));
    expect(screen.getAllByRole("button", { name: /Remove/ })).toHaveLength(2);
    expect(localStorage.getItem("project-detail-repos-view-mode")).toBe("full");
  });

  it("removing a mapped repo/folder needs a second confirming click, then calls removePath and refetches", async () => {
    renderPage();
    await screen.findByText("Agent Monitor");

    const firstRemoveButton = () => {
      const buttons = screen.getAllByRole("button", { name: /Remove/ });
      expect(buttons).toHaveLength(2);
      return buttons[0] as HTMLElement;
    };

    // First click on the repo card's own Remove button just arms a confirm
    // state - nothing is removed yet.
    fireEvent.click(firstRemoveButton());
    expect(firstRemoveButton()).toHaveTextContent("Remove?");
    expect(removePathMock).not.toHaveBeenCalled();

    // Second click on the same (now-armed) button actually removes it.
    fireEvent.click(firstRemoveButton());
    await waitFor(() => expect(removePathMock).toHaveBeenCalledWith("proj-1", 1));
    // Initial load + the post-remove refetch.
    await waitFor(() => expect(reposMock).toHaveBeenCalledTimes(2));
  });

  it("clicking a worktree's Continue button calls continueWorktree with its path and shows success feedback", async () => {
    renderPage();
    await screen.findByText("Agent Monitor");

    const continueButton = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(continueButton);

    await waitFor(() =>
      expect(continueWorktreeMock).toHaveBeenCalledWith("proj-1", "/repo/agent-monitor")
    );
    // Settles to the success label on the button itself - no toast, no repo
    // refetch (opening a terminal doesn't change the project's topology).
    await waitFor(() => expect(screen.getByRole("button", { name: "Opened" })).toBeInTheDocument());
    expect(reposMock).toHaveBeenCalledTimes(1);
  });

  it("shows the server's error message on the Continue button when continueWorktree rejects", async () => {
    continueWorktreeMock.mockRejectedValue(new Error("path is not a known worktree"));
    renderPage();
    await screen.findByText("Agent Monitor");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByTitle("path is not a known worktree")).toBeInTheDocument()
    );
  });

  it("ignoring a suggestion calls ignoreRepo with just {path, name, source} and applies the response directly", async () => {
    const afterIgnore: ProjectRepoTopology = {
      ...mockRepoTopology,
      detectedSiblings: [],
      ignoredRepos: [
        {
          id: 5,
          path: "/repo/sibling-repo",
          name: "sibling-repo",
          source: "context",
          ignoredAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    ignoreRepoMock.mockResolvedValue(afterIgnore);

    renderPage();
    await screen.findByText("sibling-repo");

    fireEvent.click(screen.getByText("Ignore"));

    await waitFor(() =>
      expect(ignoreRepoMock).toHaveBeenCalledWith("proj-1", {
        path: "/repo/sibling-repo",
        name: "sibling-repo",
        source: "context",
      })
    );
    // The response is applied directly - ignoring never needs a second
    // GET /repos round trip the way adding does.
    expect(reposMock).toHaveBeenCalledTimes(1);

    await screen.findByText("Ignored repos");
    expect(screen.getByText("Unignore")).toBeInTheDocument();
    expect(screen.queryByText("Add to project")).not.toBeInTheDocument();
  });

  it("unignoring calls unignoreRepo with the row id and applies the response directly", async () => {
    const withIgnored: ProjectRepoTopology = {
      ...mockRepoTopology,
      detectedSiblings: [],
      ignoredRepos: [
        {
          id: 5,
          path: "/repo/sibling-repo",
          name: "sibling-repo",
          source: "context",
          ignoredAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    reposMock.mockResolvedValue(withIgnored);
    unignoreRepoMock.mockResolvedValue(mockRepoTopology);

    renderPage();
    await screen.findByText("Ignored repos");

    fireEvent.click(screen.getByText("Unignore"));

    await waitFor(() => expect(unignoreRepoMock).toHaveBeenCalledWith("proj-1", 5));
    expect(reposMock).toHaveBeenCalledTimes(1); // applied directly, no extra fetch

    await screen.findByText("Add to project");
    expect(screen.queryByText("Ignored repos")).not.toBeInTheDocument();
  });

  it("adding a suggested sibling calls addPath then refetches repo topology", async () => {
    renderPage();
    await screen.findByText("sibling-repo");

    fireEvent.click(screen.getByText("Add to project"));

    await waitFor(() => expect(addPathMock).toHaveBeenCalledWith("proj-1", "/repo/sibling-repo"));
    // Initial load + the post-add refetch.
    await waitFor(() => expect(reposMock).toHaveBeenCalledTimes(2));
  });

  it("adding a suggested sibling from inside the scan-results popup rescans without closing it", async () => {
    const secondScan: ProjectRepoTopology = {
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
        {
          cwd: "/repo/sibling-repo",
          pathId: 3,
          worktrees: [
            {
              path: "/repo/sibling-repo",
              head: "1234567890abcdef",
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
      nonRepoFolders: mockRepoTopology.nonRepoFolders,
      detectedSiblings: [
        {
          name: "grandchild-repo",
          path: "/repo/grandchild-repo",
          sourceRepoCwd: "/repo/sibling-repo",
          source: "disk-sibling",
        },
      ],
      ignoredRepos: [],
    };

    renderPage();
    await screen.findByText("Agent Monitor");

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Repo scan results")).toBeInTheDocument();
    expect(within(dialog).getByText("sibling-repo")).toBeInTheDocument();

    reposMock.mockResolvedValueOnce(secondScan);
    fireEvent.click(within(dialog).getByText("Add to project"));

    await waitFor(() => expect(addPathMock).toHaveBeenCalledWith("proj-1", "/repo/sibling-repo"));
    await waitFor(() => expect(within(dialog).getByText("grandchild-repo")).toBeInTheDocument());
    // The popup stayed open through the add + rescan, so the newly-found
    // suggestion (relative to the just-added repo) is visible right there.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders the plan-empty and intake-empty states when there is nothing to show", async () => {
    reposMock.mockResolvedValue({
      project_id: "proj-1",
      repos: [],
      nonRepoFolders: [],
      detectedSiblings: [],
      ignoredRepos: [],
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
});
