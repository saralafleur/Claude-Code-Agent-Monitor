/**
 * @file colorThresholds.ts
 * @description Server-backed store for the Usage page's global green/
 * yellow/orange/red color thresholds - shared across every computer
 * connected to this dashboard (this app has no user accounts, so there is
 * exactly one setting for everyone). Two independent scopes, `session` and
 * `weekly`, since the session (5h) window and the weekly window are
 * separate quotas that shouldn't have to share one ramp. Hydrated from
 * GET /api/color-thresholds on first subscribe and kept live via
 * `color_thresholds_updated` WebSocket pushes - mirrors monitorGroups.ts's
 * pattern for the Kanban Board layout. Unlike that store, there's no legacy
 * localStorage to migrate from: this is a brand-new setting, so the
 * snapshot always starts at the same sane defaults the server itself seeds
 * a fresh row with, and every consumer of `colorBand`/`pctBarColor`/
 * `pctTextColor` in Usage.tsx reads through this one store rather than
 * hand-copying the thresholds - the DERIVED-DUAL-VIEW class of bug this
 * project has repeatedly hit (see PROJECT-CONTEXT.md 9.1) is exactly a
 * shared value drifting because a second consumer reimplemented it instead
 * of sharing the source.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useSyncExternalStore } from "react";
import { api } from "./api";
import { eventBus } from "./eventBus";
import type { ColorThresholds, ColorThresholdsConfig, WSMessage } from "./types";

/** Matches the server's own seed row (server/db.js) - used until the first
 *  real hydrate resolves, and as the fallback if the server is unreachable. */
export const DEFAULT_COLOR_THRESHOLDS: ColorThresholds = {
  yellowAt: 50,
  orangeAt: 80,
  redAt: 100,
};

export const DEFAULT_COLOR_THRESHOLDS_CONFIG: ColorThresholdsConfig = {
  session: DEFAULT_COLOR_THRESHOLDS,
  weekly: DEFAULT_COLOR_THRESHOLDS,
};

function isValidScope(value: unknown): value is ColorThresholds {
  const v = value as ColorThresholds | null;
  return (
    !!v &&
    typeof v.yellowAt === "number" &&
    typeof v.orangeAt === "number" &&
    typeof v.redAt === "number"
  );
}

/** Current snapshot. Swapped wholesale so `useSyncExternalStore` gets a
 *  stable reference between changes. */
let snapshot: ColorThresholdsConfig = DEFAULT_COLOR_THRESHOLDS_CONFIG;
/** Store subscribers (React components via useSyncExternalStore). */
const listeners = new Set<() => void>();
/** One-shot hydrate latch. */
let hydrated = false;
let hydrating: Promise<void> | null = null;

function notify(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a broken listener must not starve the others */
    }
  });
}

function setSnapshot(next: ColorThresholdsConfig): void {
  snapshot = next;
  notify();
}

// Merge live pushes for the lifetime of the tab, so a threshold change made
// from another connected computer shows up here without a reload -
// registered at module scope (like the socket itself) so updates accumulate
// even while no component is currently subscribed.
eventBus.subscribe((msg: WSMessage) => {
  try {
    if (msg.type !== "color_thresholds_updated") return;
    const data = msg.data as ColorThresholdsConfig;
    if (!data || !isValidScope(data.session) || !isValidScope(data.weekly)) return;
    setSnapshot(data);
  } catch {
    /* never propagate into the bus dispatch loop */
  }
});

export const colorThresholdsStore = {
  /** Subscribe to snapshot changes; triggers the lazy first hydrate. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    void colorThresholdsStore.hydrate();
    return () => listeners.delete(listener);
  },

  /** Current immutable snapshot (stable reference between changes). */
  getSnapshot(): ColorThresholdsConfig {
    return snapshot;
  },

  /** One-shot bulk hydrate from GET /api/color-thresholds. */
  hydrate(): Promise<void> {
    if (hydrated) return Promise.resolve();
    if (hydrating) return hydrating;
    // Guards test mocks that stub the api module without a `colorThresholds`
    // namespace (mirrors monitorGroups.ts's identical guard for `api.monitors`).
    if (typeof api.colorThresholds?.get !== "function") {
      hydrated = true;
      return Promise.resolve();
    }
    hydrating = api.colorThresholds
      .get()
      .then((config) => {
        hydrated = true;
        setSnapshot(config);
      })
      .catch(() => {
        // Leave hydrated=false so a later subscribe retries (e.g. the server
        // wasn't up yet); WS pushes still populate the snapshot meanwhile.
        hydrating = null;
      });
    return hydrating;
  },

  /** Test-only: reset the store to its pristine state. */
  __resetForTest(): void {
    snapshot = DEFAULT_COLOR_THRESHOLDS_CONFIG;
    hydrated = false;
    hydrating = null;
  },

  /** Optimistically updates either/both scopes, then best-effort persists
   *  them. Returns the promise so a caller (the settings card) can surface a
   *  save error instead of silently swallowing it, unlike the
   *  fire-and-forget `save*` helpers in monitorGroups.ts. */
  save(patch: {
    session?: Partial<ColorThresholds>;
    weekly?: Partial<ColorThresholds>;
  }): Promise<ColorThresholdsConfig> {
    const optimistic: ColorThresholdsConfig = {
      session: { ...snapshot.session, ...patch.session },
      weekly: { ...snapshot.weekly, ...patch.weekly },
    };
    setSnapshot(optimistic);
    return api.colorThresholds.update(patch).then((result) => {
      setSnapshot(result);
      return result;
    });
  },
};

/** React hook: the live global color thresholds for both scopes. Re-renders
 *  on store changes only. */
export function useColorThresholds(): ColorThresholdsConfig {
  return useSyncExternalStore(colorThresholdsStore.subscribe, colorThresholdsStore.getSnapshot);
}
