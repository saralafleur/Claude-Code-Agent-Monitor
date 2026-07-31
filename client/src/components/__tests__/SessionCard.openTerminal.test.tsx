/**
 * @file Tests for SessionCard's "open new terminal" button: rendered for any
 * local session with a known cwd (active or not — unlike "jump to terminal",
 * it doesn't need a resolved pid since it starts a fresh `claude` instance
 * rather than locating a running one), calls api.sessions.openTerminal on
 * click without also triggering the card's own navigate-to-detail
 * (stopPropagation), and its own local pending → success/error feedback (no
 * toast system in this codebase - see client/src/pages/Run.tsx for the same
 * local-state convention).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionCard } from "../SessionCard";
import type { Session } from "../../lib/types";

const openTerminalMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    sessions: {
      transcript: vi.fn().mockResolvedValue({ messages: [] }),
      openTerminal: (...args: unknown[]) => openTerminalMock(...args),
    },
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderCard(session: Session) {
  return render(
    <MemoryRouter>
      <SessionCard session={session} />
    </MemoryRouter>
  );
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-term-1",
    name: "Terminal session",
    status: "active",
    cwd: "/repo/agent-monitor",
    model: "claude-opus-4-6",
    started_at: "2026-06-10T11:00:00.000Z",
    ended_at: null,
    metadata: null,
    pid: 4242,
    ...overrides,
  } as Session;
}

function getButton() {
  return screen.getByLabelText("Open new terminal here");
}

describe("SessionCard - open new terminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders for an active local session with a cwd", () => {
    renderCard(makeSession());
    expect(getButton()).toBeInTheDocument();
  });

  it("renders for a completed session too, unlike jump-to-terminal", () => {
    renderCard(
      makeSession({ status: "completed", ended_at: "2026-06-10T12:00:00.000Z", pid: null })
    );
    expect(getButton()).toBeInTheDocument();
  });

  it("does not render when the session has no recorded cwd", () => {
    renderCard(makeSession({ cwd: null }));
    expect(screen.queryByLabelText("Open new terminal here")).not.toBeInTheDocument();
  });

  it("does not render for a session collected from another machine", () => {
    renderCard(makeSession({ source: "laptop-2" }));
    expect(screen.queryByLabelText("Open new terminal here")).not.toBeInTheDocument();
  });

  it("renders when source is unset (defaults to local)", () => {
    renderCard(makeSession({ source: undefined }));
    expect(getButton()).toBeInTheDocument();
  });

  it("calls api.sessions.openTerminal on click without navigating to the detail page", () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    renderCard(makeSession());

    fireEvent.click(getButton());

    expect(openTerminalMock).toHaveBeenCalledWith("sess-term-1");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows success feedback after the call resolves", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    renderCard(makeSession());

    const button = getButton();
    fireEvent.click(button);

    await waitFor(() => expect(button.querySelector("svg.lucide-check")).toBeInTheDocument());
  });

  it("shows error feedback with the server's message as the tooltip when the call rejects", async () => {
    openTerminalMock.mockRejectedValue(
      new Error("No working directory was recorded for this session.")
    );
    renderCard(makeSession());

    const button = getButton();
    fireEvent.click(button);

    await waitFor(() =>
      expect(button).toHaveAttribute("title", "No working directory was recorded for this session.")
    );
    expect(button.querySelector("svg.lucide-x")).toBeInTheDocument();
  });

  it("ignores a second click while the first request is still pending", () => {
    let resolveCall: (v: { ok: true }) => void = () => {};
    openTerminalMock.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderCard(makeSession());

    const button = getButton();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(openTerminalMock).toHaveBeenCalledTimes(1);
    resolveCall({ ok: true });
  });
});
