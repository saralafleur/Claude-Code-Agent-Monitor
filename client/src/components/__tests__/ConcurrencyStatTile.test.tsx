/**
 * @file ConcurrencyStatTile.test.tsx
 * @description Presentational smoke tests for the shared Concurrency stat
 * tile: the primary/secondary ratio render + swap (with localStorage
 * persistence under `CONCURRENCY_PRIMARY_KEY`), the null-ratio safe-render
 * case (renders "—", never throws, swap button stays present), and the
 * `label` prop override. Backfill coverage (D2, should-add) for an
 * already-shipped, already-working component — see this file's own
 * red-first note in the PR description for the manufactured-break proof
 * (there's no historical live bug to anchor to here).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ConcurrencyStatTile, CONCURRENCY_PRIMARY_KEY } from "../ConcurrencyStatTile";
import { formatMs } from "../../lib/format";

function tile(): HTMLElement {
  // StatTile's label span's grandparent is the tile's own outer div - same
  // traversal FocusReportModal.test.tsx's own concurrency test uses.
  return screen.getByText("Concurrency").closest("div")!.parentElement as HTMLElement;
}

beforeEach(() => {
  localStorage.removeItem(CONCURRENCY_PRIMARY_KEY);
});

describe("ConcurrencyStatTile", () => {
  it("renders the primary/secondary ratio for a normal input, and the swap button inverts + persists which is primary", () => {
    render(
      <ConcurrencyStatTile
        concurrencyRatio={1.5}
        activeConcurrencyRatio={2.25}
        wallClockMs={2 * 60 * 60_000}
        activeWallClockMs={90 * 60_000}
      />
    );

    // Active is primary by default (loadPrimary()'s own fallback).
    expect(within(tile()).getByText("2.25x")).toBeInTheDocument();
    expect(within(tile()).getByText(`of ${formatMs(90 * 60_000)} active time`)).toBeInTheDocument();
    expect(within(tile()).getByText("1.50x across open sessions")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Swap primary concurrency ratio"));

    // Primary/secondary invert, and the choice persists to localStorage.
    expect(within(tile()).getByText("1.50x")).toBeInTheDocument();
    expect(
      within(tile()).getByText(`of ${formatMs(2 * 60 * 60_000)} open-session time`)
    ).toBeInTheDocument();
    expect(within(tile()).getByText("2.25x while active")).toBeInTheDocument();
    expect(localStorage.getItem(CONCURRENCY_PRIMARY_KEY)).toBe("open");
  });

  it("renders '—' without throwing when the primary ratio is null, and keeps the swap button present", () => {
    expect(() =>
      render(
        <ConcurrencyStatTile
          concurrencyRatio={1.2}
          activeConcurrencyRatio={null}
          wallClockMs={60_000}
          activeWallClockMs={null}
        />
      )
    ).not.toThrow();

    // Active (null here) is primary by default.
    expect(within(tile()).getByText("—")).toBeInTheDocument();
    // The swap button doesn't conditionally disappear just because one
    // ratio is null - the preference can still be set for reports that do
    // carry both.
    expect(screen.getByLabelText("Swap primary concurrency ratio")).toBeInTheDocument();
    // The non-null secondary (open) ratio still renders its sub-line.
    expect(within(tile()).getByText("1.20x across open sessions")).toBeInTheDocument();
  });

  it("omits the secondary sub-line entirely when the secondary ratio is also null", () => {
    render(
      <ConcurrencyStatTile
        concurrencyRatio={null}
        activeConcurrencyRatio={null}
        wallClockMs={null}
        activeWallClockMs={null}
      />
    );
    expect(within(tile()).getByText("—")).toBeInTheDocument();
    expect(within(tile()).queryByText(/across open sessions/)).not.toBeInTheDocument();
    expect(within(tile()).queryByText(/while active/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Swap primary concurrency ratio")).toBeInTheDocument();
  });

  it("renders a custom label override instead of the default 'Concurrency' i18n label", () => {
    render(
      <ConcurrencyStatTile
        concurrencyRatio={1}
        activeConcurrencyRatio={1}
        wallClockMs={60_000}
        activeWallClockMs={60_000}
        label="Concurrent agent sessions"
      />
    );
    expect(screen.getByText("Concurrent agent sessions")).toBeInTheDocument();
    expect(screen.queryByText("Concurrency")).not.toBeInTheDocument();
  });
});
