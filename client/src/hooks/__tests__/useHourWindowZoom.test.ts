/**
 * @file useHourWindowZoom.test.ts
 * @description Isolated hook-level tests for `useHourWindowZoom` — the
 * windowing formula for each `HOUR_WINDOW_OPTIONS` size, the
 * `windowIsFuture` boundary (strict `>`), `customOffsetMs` surviving a
 * day-navigation round trip, and — the render-cascade regression this file
 * exists to guard — that a LIVE-zoomed window's `windowStartMs`/`windowEndMs`
 * stay bit-identical across unrelated re-renders and only re-anchor on the
 * hook's own `ZOOM_REFRESH_MS` tick, with no runaway self-triggered render
 * loop and no "Maximum update depth exceeded" console warning. First file
 * under `client/src/hooks/__tests__/` — `HourWindowZoomBar`'s own
 * presentational coverage stays in the existing
 * `FocusCalendarView.test.tsx`/`FocusPage.test.tsx` integration suites.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHourWindowZoom, HOUR_WINDOW_OPTIONS } from "../useHourWindowZoom";

// Mirrors the hook's own private constants (not exported — re-derived here,
// matching this repo's own convention for pinning a formula from outside its
// module, per qa/supporting/unit-tests.md's guidance for this exact file).
const HOUR_MS = 60 * 60_000;
const FUTURE_PAD_MS = 2 * 60 * 60_000;
const ZOOM_REFRESH_MS = 60_000;

// Fixed LOCAL "now", built via local Date setters (not a raw ISO string) so
// dayStart/dayEnd are deterministic regardless of the test runner's
// timezone — mirrors FocusPage.test.tsx's own ZOOM_NOW/todayAt convention.
function makeNow(): Date {
  const d = new Date();
  d.setHours(15, 0, 0, 0);
  return d;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

describe("useHourWindowZoom", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("windowing formula", () => {
    let NOW: Date;
    let dayStart: number;
    let dayEnd: number;

    beforeEach(() => {
      NOW = makeNow();
      dayStart = startOfLocalDay(NOW).getTime();
      dayEnd = dayStart + 24 * 60 * 60_000;
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    for (const hours of HOUR_WINDOW_OPTIONS.filter((h) => h < 24)) {
      it(`computes windowStartMs/windowEndMs for the ${hours}h zoom size (live, today)`, () => {
        const { result } = renderHook(() => useHourWindowZoom(NOW));
        act(() => {
          result.current.setHourWindow(hours);
        });
        expect(result.current.windowEndMs - result.current.windowStartMs).toBe(
          (hours + 2) * HOUR_MS
        );
        expect(result.current.windowStartMs).toBe(
          Math.max(dayStart, NOW.getTime() - hours * HOUR_MS)
        );
        expect(result.current.windowEndMs).toBe(Math.min(dayEnd, NOW.getTime() + FUTURE_PAD_MS));
      });
    }

    it("the 24h option is the full, unzoomed day — no future pad, no clamp math", () => {
      const { result } = renderHook(() => useHourWindowZoom(NOW));
      act(() => {
        result.current.setHourWindow(24);
      });
      expect(result.current.windowStartMs).toBe(dayStart);
      expect(result.current.windowEndMs).toBe(dayEnd);
      expect(result.current.zoomable).toBe(false);
    });
  });

  describe("windowIsFuture", () => {
    let NOW: Date;

    beforeEach(() => {
      NOW = makeNow();
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    it("is false (strict >, not >=) exactly at the boundary, then true once the picked start is 1ms in the future", () => {
      const { result, rerender } = renderHook(() => useHourWindowZoom(NOW));
      // A custom quick-start offset that lands the window's start exactly at
      // "now" — noon is `NOW`'s own local midnight + 12h.
      const dayStart = startOfLocalDay(NOW).getTime();
      const offsetToNow = NOW.getTime() - dayStart;
      act(() => {
        result.current.handleQuickStartClick(offsetToNow);
      });
      expect(result.current.windowStartMs).toBe(NOW.getTime());
      expect(result.current.windowIsFuture).toBe(false);

      // Move "now" 1ms EARLIER, without touching the (custom, time-independent)
      // windowStartMs — the picked start is now 1ms in the future.
      act(() => {
        vi.setSystemTime(new Date(NOW.getTime() - 1));
        rerender();
      });
      expect(result.current.windowStartMs).toBe(NOW.getTime());
      expect(result.current.windowIsFuture).toBe(true);
    });

    it("is always false on a non-today selectedDate, even with a future-looking customOffsetMs", () => {
      const nonToday = new Date(NOW);
      nonToday.setDate(nonToday.getDate() + 3);
      const { result } = renderHook(() => useHourWindowZoom(nonToday));
      act(() => {
        // A deliberately "future" offset relative to the fake NOW's time-of-day.
        result.current.handleQuickStartClick(23 * HOUR_MS);
      });
      expect(result.current.isToday).toBe(false);
      expect(result.current.windowIsFuture).toBe(false);
    });
  });

  describe("customOffsetMs across a day-navigation round trip", () => {
    it("keeps the same clock-time offset when paging to a new day, and effectiveAnchorMode reads 'custom' there regardless of stored mode", () => {
      const NOW = makeNow();
      vi.useFakeTimers();
      vi.setSystemTime(NOW);

      const { result, rerender } = renderHook(
        ({ selectedDate }: { selectedDate: Date }) => useHourWindowZoom(selectedDate),
        { initialProps: { selectedDate: NOW } }
      );

      act(() => {
        result.current.handleQuickStartClick(8 * HOUR_MS);
      });
      expect(result.current.effectiveAnchorMode).toBe("custom");

      const nextDay = new Date(NOW);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStart = startOfLocalDay(nextDay).getTime();
      rerender({ selectedDate: nextDay });

      // Same clock-time offset (8am) carried over onto the new day.
      expect(result.current.windowStartMs - nextDayStart).toBe(8 * HOUR_MS);
      expect(result.current.effectiveAnchorMode).toBe("custom");
    });

    it("effectiveAnchorMode reads 'custom' on a non-today day even when windowAnchorMode was never explicitly changed from its 'live' default", () => {
      const NOW = makeNow();
      vi.useFakeTimers();
      vi.setSystemTime(NOW);

      const { result, rerender } = renderHook(
        ({ selectedDate }: { selectedDate: Date }) => useHourWindowZoom(selectedDate),
        { initialProps: { selectedDate: NOW } }
      );
      // No handleQuickStartClick call — windowAnchorMode is still its "live"
      // default. On today, that renders as "live".
      expect(result.current.effectiveAnchorMode).toBe("live");

      const nextDay = new Date(NOW);
      nextDay.setDate(nextDay.getDate() + 1);
      rerender({ selectedDate: nextDay });

      // Navigating off today flips effectiveAnchorMode to "custom" purely via
      // the isToday gate, with no explicit mode change from the caller.
      expect(result.current.effectiveAnchorMode).toBe("custom");
    });
  });

  // The render-cascade regression this file exists to guard (technical-plan
  // §4.1 / build-brief.md's live bug #1): pre-fix, the live-zoom branch reads
  // Date.now() directly on every render instead of a state value updated only
  // once per ZOOM_REFRESH_MS tick, so ANY unrelated re-render (not just a real
  // tick) can produce a new windowStartMs/windowEndMs — and, one layer up in
  // FocusCalendarView, feeds an effect that depends on those values, tripping
  // React's "Maximum update depth exceeded" warning.
  describe("live-zoom render-cascade regression", () => {
    it("keeps windowStartMs/windowEndMs bit-identical across unrelated re-renders, re-anchoring only on the ZOOM_REFRESH_MS tick, with no extra self-triggered renders and no console.error warning", () => {
      const NOW = makeNow();
      vi.useFakeTimers();
      vi.setSystemTime(NOW);

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      let renderCount = 0;
      const { result, rerender } = renderHook(() => {
        renderCount += 1;
        return useHourWindowZoom(NOW, { defaultHourWindow: 4 });
      });

      const first = result.current.windowStartMs;
      const firstEnd = result.current.windowEndMs;

      // Several unrelated re-renders, no clock movement — must not change
      // the window at all.
      for (let i = 0; i < 5; i++) {
        act(() => {
          rerender();
        });
        expect(result.current.windowStartMs).toBe(first);
        expect(result.current.windowEndMs).toBe(firstEnd);
      }

      // Advance the fake clock by 1ms — far short of the 60s ZOOM_REFRESH_MS
      // tick — then force a re-render. Pre-fix (raw Date.now() reads), this
      // shifts windowStartMs by 1ms; post-fix (nowMs state, only updated on
      // the interval), it must not move at all.
      act(() => {
        vi.advanceTimersByTime(1);
        rerender();
      });
      expect(result.current.windowStartMs).toBe(first);
      expect(result.current.windowEndMs).toBe(firstEnd);

      // Now actually cross the ZOOM_REFRESH_MS tick — the window MUST
      // re-anchor (the fix must not freeze the window forever).
      act(() => {
        vi.advanceTimersByTime(ZOOM_REFRESH_MS);
      });
      expect(result.current.windowStartMs).not.toBe(first);
      expect(result.current.windowEndMs).not.toBe(firstEnd);

      // Render-count containment: exactly the renders this test itself
      // drove (1 initial mount + 5 unrelated rerenders + 1 rerender after the
      // 1ms advance + 1 render from the ZOOM_REFRESH_MS tick's own state
      // update) — no *extra* renders from an effect chasing its own changed
      // dependency.
      expect(renderCount).toBe(1 + 5 + 1 + 1);

      expect(
        errorSpy.mock.calls.some(([msg]) => String(msg).includes("Maximum update depth exceeded"))
      ).toBe(false);

      errorSpy.mockRestore();
    });
  });

  // A false→true transition of isLiveZoom (e.g. clicking back to "Live" after
  // a custom pick) must resync `nowMs` to the CURRENT time immediately, not
  // wait for the next ZOOM_REFRESH_MS tick — otherwise the window renders
  // stale (frozen at whatever time it was when isLiveZoom last went false, or
  // at mount) for up to 60s despite the UI claiming to "follow the current
  // time".
  describe("live re-anchor on a false→true isLiveZoom transition", () => {
    it("resyncs windowStartMs/windowEndMs to the current time immediately on switching back to live, without waiting for a ZOOM_REFRESH_MS tick", () => {
      const NOW = makeNow();
      const dayStart = startOfLocalDay(NOW).getTime();
      const dayEnd = dayStart + 24 * 60 * 60_000;
      vi.useFakeTimers();
      vi.setSystemTime(NOW);

      const { result } = renderHook(() => useHourWindowZoom(NOW, { defaultHourWindow: 4 }));

      // Leave live mode via a custom quick-start pick — isLiveZoom goes
      // true -> false.
      act(() => {
        result.current.handleQuickStartClick(8 * HOUR_MS);
      });
      expect(result.current.effectiveAnchorMode).toBe("custom");

      // Advance real time by 30s — well short of the 60s ZOOM_REFRESH_MS
      // tick — while NOT live, so the interval-driven refresh never fires.
      const advancedNow = NOW.getTime() + 30_000;
      act(() => {
        vi.setSystemTime(new Date(advancedNow));
      });

      // Switch back to live — isLiveZoom goes false -> true. No further
      // clock movement or interval tick happens after this.
      act(() => {
        result.current.setWindowAnchorMode("live");
      });

      // The window must reflect the ADVANCED current time right away, not
      // the stale time from before the custom detour.
      expect(result.current.windowStartMs).toBe(Math.max(dayStart, advancedNow - 4 * HOUR_MS));
      expect(result.current.windowEndMs).toBe(Math.min(dayEnd, advancedNow + FUTURE_PAD_MS));
    });
  });
});
