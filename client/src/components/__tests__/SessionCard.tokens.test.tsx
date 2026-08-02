/**
 * @file SessionCard.tokens.test.tsx
 * @description Tests for SessionCard's token strip: the cache read/write split
 * (two separate figures, not the old combined "Cache" number), the
 * cost-weighted Effective aggregate replacing the raw input+output+cache sum,
 * graceful fallback for legacy API payloads that predate the split fields,
 * and the strip staying hidden when a session has no token usage.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionCard } from "../SessionCard";
import type { Session } from "../../lib/types";

vi.mock("../../lib/api", () => ({
  api: {
    sessions: {
      transcript: vi.fn(),
    },
  },
}));

function renderCard(session: Session) {
  return render(
    <MemoryRouter>
      <SessionCard session={session} />
    </MemoryRouter>
  );
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-tokens",
    name: "Token strip session",
    status: "active",
    cwd: "/repo/agent-monitor",
    model: "claude-sonnet-5",
    started_at: "2026-08-01T09:00:00.000Z",
    ended_at: null,
    metadata: null,
    ...overrides,
  } as Session;
}

describe("SessionCard - token strip (cache split + effective total)", () => {
  it("shows cache read and write as separate figures plus the Effective total", () => {
    renderCard(
      makeSession({
        tokens: {
          input: 2_140_000,
          output: 890_000,
          cache: 409_200_000,
          cache_read: 398_000_000,
          cache_write: 11_200_000,
          effective: 56_830_000,
        },
      })
    );

    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Write")).toBeInTheDocument();
    expect(screen.getByText("398.0M")).toBeInTheDocument();
    expect(screen.getByText("11.2M")).toBeInTheDocument();
    // The aggregate is the cost-weighted effective figure, NOT the raw
    // 412.2M sum that treated cheap cache reads like full-rate tokens.
    expect(screen.getByText("Effective")).toBeInTheDocument();
    expect(screen.getByText("56.8M")).toBeInTheDocument();
    expect(screen.queryByText("412.2M")).not.toBeInTheDocument();
  });

  it("falls back for legacy payloads without the split fields (read <- cache, write 0, effective <- raw sum)", () => {
    renderCard(
      makeSession({
        tokens: {
          input: 1_000,
          output: 500,
          cache: 8_000,
        } as Session["tokens"],
      })
    );

    // Combined figure lands in the read column; write shows zero rather than
    // hiding, and the aggregate degrades to the raw sum (1000+500+8000).
    expect(screen.getByText("8.0K")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("9.5K")).toBeInTheDocument();
  });

  it("renders no token strip when the session has no token usage", () => {
    renderCard(makeSession());
    expect(screen.queryByText("Effective")).not.toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
  });
});
