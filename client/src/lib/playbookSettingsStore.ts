/**
 * @file Server-backed store for the Coach's Playbook's global settings -
 * NOT scoped to any one practice (unlike playbookStore.ts's per-practice
 * config list), so a new practice never has to configure this itself.
 * Shared across every computer connected to this dashboard (this app has no
 * user accounts, so there is exactly one setting for everyone). Hydrated
 * from GET /api/playbook/settings on first subscribe and kept live via
 * `playbook_settings_updated` WebSocket pushes - mirrors colorThresholds.ts's
 * singleton-object store shape exactly (playbookStore.ts's list shape isn't
 * the right fit here: there's exactly one settings object, not one per
 * practice).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useSyncExternalStore } from "react";
import { api } from "./api";
import { eventBus } from "./eventBus";
import type { PlaybookSettings, WSMessage } from "./types";

/** Matches the server's own seed row (server/db.js) - used until the first
 *  real hydrate resolves, and as the fallback if the server is unreachable. */
export const DEFAULT_PLAYBOOK_SETTINGS: PlaybookSettings = {
  autoResolveAfterMs: 3 * 60 * 60 * 1000,
};

function isValidSettings(value: unknown): value is PlaybookSettings {
  const v = value as PlaybookSettings | null;
  return !!v && typeof v.autoResolveAfterMs === "number";
}

/** Current snapshot. Swapped wholesale so `useSyncExternalStore` gets a
 *  stable reference between changes. */
let snapshot: PlaybookSettings = DEFAULT_PLAYBOOK_SETTINGS;
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

function setSnapshot(next: PlaybookSettings): void {
  snapshot = next;
  notify();
}

// Merge live pushes for the lifetime of the tab, so a settings change made
// from another connected computer shows up here without a reload -
// registered at module scope (like the socket itself) so updates accumulate
// even while no component is currently subscribed.
eventBus.subscribe((msg: WSMessage) => {
  try {
    if (msg.type !== "playbook_settings_updated") return;
    if (!isValidSettings(msg.data)) return;
    setSnapshot(msg.data);
  } catch {
    /* never propagate into the bus dispatch loop */
  }
});

export const playbookSettingsStore = {
  /** Subscribe to snapshot changes; triggers the lazy first hydrate. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    void playbookSettingsStore.hydrate();
    return () => listeners.delete(listener);
  },

  /** Current immutable snapshot (stable reference between changes). */
  getSnapshot(): PlaybookSettings {
    return snapshot;
  },

  /** One-shot bulk hydrate from GET /api/playbook/settings. */
  hydrate(): Promise<void> {
    if (hydrated) return Promise.resolve();
    if (hydrating) return hydrating;
    // Guards test mocks that stub the api module without a
    // `playbook.getSettings` namespace (mirrors colorThresholds.ts's
    // identical guard for `api.colorThresholds.get`).
    if (typeof api.playbook?.getSettings !== "function") {
      hydrated = true;
      return Promise.resolve();
    }
    hydrating = api.playbook
      .getSettings()
      .then((settings) => {
        hydrated = true;
        setSnapshot(settings);
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
    snapshot = DEFAULT_PLAYBOOK_SETTINGS;
    hydrated = false;
    hydrating = null;
  },

  /** Optimistically patches the settings, then best-effort persists them.
   *  Returns the promise so the settings card can surface a save error. */
  save(patch: { autoResolveAfterMs?: number }): Promise<PlaybookSettings> {
    setSnapshot({ ...snapshot, ...patch });
    return api.playbook.updateSettings(patch).then((result) => {
      setSnapshot(result);
      return result;
    });
  },
};

/** React hook: the live global Playbook settings. Re-renders on store changes only. */
export function usePlaybookSettings(): PlaybookSettings {
  return useSyncExternalStore(playbookSettingsStore.subscribe, playbookSettingsStore.getSnapshot);
}
