/**
 * @file Tests for SessionCard's "open new terminal" button: rendered for any
 * local session with a known cwd (active or not — unlike "jump to terminal",
 * it doesn't need a resolved pid since it starts a fresh `claude` instance
 * rather than locating a running one). Clicking it opens a small anchored
 * popover prompting for an optional effort name (passed through as
 * `claude -n <name>` on api.sessions.openTerminal) rather than firing
 * immediately; Enter or the popover's own "Open" button submits (with or
 * without a name typed), Escape/outside-click cancels without opening
 * anything. Also covers the button's own local pending → success/error
 * feedback and that none of this triggers the card's own navigate-to-detail
 * (no toast system in this codebase - see client/src/pages/Run.tsx for the
 * same local-state convention).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
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

function getNameInput() {
  return screen.getByLabelText("Effort name (optional)");
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

  it("opens a name popover on click instead of calling openTerminal immediately", () => {
    renderCard(makeSession());

    fireEvent.click(getButton());

    expect(getNameInput()).toBeInTheDocument();
    expect(openTerminalMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("submits with no name (Enter on an empty input) and calls openTerminal(id) alone", () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    renderCard(makeSession());

    fireEvent.click(getButton());
    fireEvent.keyDown(getNameInput(), { key: "Enter" });

    expect(openTerminalMock).toHaveBeenCalledWith("sess-term-1");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("submits a typed name (Enter) and calls openTerminal(id, name), trimmed", () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    renderCard(makeSession());

    fireEvent.click(getButton());
    fireEvent.change(getNameInput(), { target: { value: "  Fix desktop freeze  " } });
    fireEvent.keyDown(getNameInput(), { key: "Enter" });

    expect(openTerminalMock).toHaveBeenCalledWith("sess-term-1", "Fix desktop freeze");
  });

  it("submits via the popover's own Open button", () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    renderCard(makeSession());

    fireEvent.click(getButton());
    fireEvent.change(getNameInput(), { target: { value: "Docs pass" } });
    const popover = screen.getByRole("dialog");
    fireEvent.click(within(popover).getByRole("button", { name: "Open new terminal here" }));

    expect(openTerminalMock).toHaveBeenCalledWith("sess-term-1", "Docs pass");
  });

  it("closes the popover on Escape without calling openTerminal", () => {
    renderCard(makeSession());

    fireEvent.click(getButton());
    fireEvent.keyDown(getNameInput(), { key: "Escape" });

    expect(screen.queryByLabelText("Effort name (optional)")).not.toBeInTheDocument();
    expect(openTerminalMock).not.toHaveBeenCalled();
  });

  it("closes the popover on an outside click without calling openTerminal", () => {
    renderCard(makeSession());

    fireEvent.click(getButton());
    fireEvent.mouseDown(document.body);

    expect(screen.queryByLabelText("Effort name (optional)")).not.toBeInTheDocument();
    expect(openTerminalMock).not.toHaveBeenCalled();
  });

  it("shows success feedback after the call resolves", async () => {
    openTerminalMock.mockResolvedValue({ ok: true });
    renderCard(makeSession());

    fireEvent.click(getButton());
    fireEvent.keyDown(getNameInput(), { key: "Enter" });

    await waitFor(() => expect(getButton().querySelector("svg.lucide-check")).toBeInTheDocument());
  });

  it("shows error feedback with the server's message as the tooltip when the call rejects", async () => {
    openTerminalMock.mockRejectedValue(
      new Error("No working directory was recorded for this session.")
    );
    renderCard(makeSession());

    fireEvent.click(getButton());
    fireEvent.keyDown(getNameInput(), { key: "Enter" });

    await waitFor(() =>
      expect(getButton()).toHaveAttribute(
        "title",
        "No working directory was recorded for this session."
      )
    );
    expect(getButton().querySelector("svg.lucide-x")).toBeInTheDocument();
  });

  it("ignores a click on the button while a request is still pending", () => {
    let resolveCall: (v: { ok: true }) => void = () => {};
    openTerminalMock.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderCard(makeSession());

    fireEvent.click(getButton());
    fireEvent.keyDown(getNameInput(), { key: "Enter" });
    fireEvent.click(getButton());

    expect(openTerminalMock).toHaveBeenCalledTimes(1);
    resolveCall({ ok: true });
  });
});
