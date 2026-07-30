/**
 * @file Tests for SessionCard's "jump to terminal" button: only rendered for
 * an active, local session with a resolved pid, calls
 * api.sessions.focusTerminal on click without also triggering the card's
 * own navigate-to-detail (stopPropagation), and its own local pending →
 * success/error feedback (no toast system in this codebase - see
 * client/src/pages/Run.tsx for the same local-state convention).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionCard } from "../SessionCard";
import type { Session } from "../../lib/types";

const focusTerminalMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    sessions: {
      transcript: vi.fn().mockResolvedValue({ messages: [] }),
      focusTerminal: (...args: unknown[]) => focusTerminalMock(...args),
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
  return screen.getByLabelText("Jump to terminal");
}

describe("SessionCard - jump to terminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders for an active local session with a resolved pid", () => {
    renderCard(makeSession());
    expect(getButton()).toBeInTheDocument();
  });

  it("does not render when the session has no recorded pid", () => {
    renderCard(makeSession({ pid: null }));
    expect(screen.queryByLabelText("Jump to terminal")).not.toBeInTheDocument();
  });

  it("does not render for a non-active session", () => {
    renderCard(makeSession({ status: "completed", ended_at: "2026-06-10T12:00:00.000Z" }));
    expect(screen.queryByLabelText("Jump to terminal")).not.toBeInTheDocument();
  });

  it("does not render for a session collected from another machine", () => {
    renderCard(makeSession({ source: "laptop-2" }));
    expect(screen.queryByLabelText("Jump to terminal")).not.toBeInTheDocument();
  });

  it("renders when source is unset (defaults to local)", () => {
    renderCard(makeSession({ source: undefined }));
    expect(getButton()).toBeInTheDocument();
  });

  it("calls api.sessions.focusTerminal on click without navigating to the detail page", () => {
    focusTerminalMock.mockResolvedValue({ ok: true });
    renderCard(makeSession());

    fireEvent.click(getButton());

    expect(focusTerminalMock).toHaveBeenCalledWith("sess-term-1");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows success feedback after the call resolves", async () => {
    focusTerminalMock.mockResolvedValue({ ok: true });
    renderCard(makeSession());

    const button = getButton();
    fireEvent.click(button);

    await waitFor(() => expect(button.querySelector("svg.lucide-check")).toBeInTheDocument());
  });

  it("shows error feedback with the server's message as the tooltip when the call rejects", async () => {
    focusTerminalMock.mockRejectedValue(
      new Error("The claude process for this session is no longer running.")
    );
    renderCard(makeSession());

    const button = getButton();
    fireEvent.click(button);

    await waitFor(() =>
      expect(button).toHaveAttribute(
        "title",
        "The claude process for this session is no longer running."
      )
    );
    expect(button.querySelector("svg.lucide-x")).toBeInTheDocument();
  });

  it("ignores a second click while the first request is still pending", () => {
    let resolveCall: (v: { ok: true }) => void = () => {};
    focusTerminalMock.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderCard(makeSession());

    const button = getButton();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(focusTerminalMock).toHaveBeenCalledTimes(1);
    resolveCall({ ok: true });
  });
});
