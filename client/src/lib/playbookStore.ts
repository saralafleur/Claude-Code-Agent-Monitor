/**
 * @file Server-backed store for the Coach's Playbook - the practice catalog
 * merged with its current (server-shared) config, shared across every
 * computer connected to this dashboard (this app has no user accounts, so
 * there is exactly one setting for everyone). Hydrated from
 * GET /api/playbook/practices on first subscribe and kept live via
 * `playbook_practice_config_updated` WebSocket pushes - mirrors
 * `colorThresholds.ts`'s store shape exactly, generalized from "one
 * singleton config object" to "a list of practices, each independently
 * patchable by id."
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useSyncExternalStore } from "react";
import { api } from "./api";
import { eventBus } from "./eventBus";
import type { PlaybookPractice, WSMessage } from "./types";

function isValidPractice(value: unknown): value is PlaybookPractice {
  const v = value as PlaybookPractice | null;
  return !!v && typeof v.id === "string" && typeof v.enabled === "boolean" && !!v.config;
}

/** Current snapshot. Swapped wholesale so `useSyncExternalStore` gets a
 *  stable reference between changes. */
let snapshot: PlaybookPractice[] = [];
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

function setSnapshot(next: PlaybookPractice[]): void {
  snapshot = next;
  notify();
}

function mergePractice(next: PlaybookPractice): void {
  const idx = snapshot.findIndex((p) => p.id === next.id);
  if (idx === -1) {
    setSnapshot([...snapshot, next]);
  } else {
    const merged = snapshot.slice();
    merged[idx] = next;
    setSnapshot(merged);
  }
}

// Merge live pushes for the lifetime of the tab, so a config change made
// from another connected computer shows up here without a reload -
// registered at module scope (like the socket itself) so updates accumulate
// even while no component is currently subscribed.
eventBus.subscribe((msg: WSMessage) => {
  try {
    if (msg.type !== "playbook_practice_config_updated") return;
    if (!isValidPractice(msg.data)) return;
    mergePractice(msg.data);
  } catch {
    /* never propagate into the bus dispatch loop */
  }
});

export const playbookStore = {
  /** Subscribe to snapshot changes; triggers the lazy first hydrate. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    void playbookStore.hydrate();
    return () => listeners.delete(listener);
  },

  /** Current immutable snapshot (stable reference between changes). */
  getSnapshot(): PlaybookPractice[] {
    return snapshot;
  },

  /** One-shot bulk hydrate from GET /api/playbook/practices. */
  hydrate(): Promise<void> {
    if (hydrated) return Promise.resolve();
    if (hydrating) return hydrating;
    if (typeof api.playbook?.listPractices !== "function") {
      hydrated = true;
      return Promise.resolve();
    }
    hydrating = api.playbook
      .listPractices()
      .then(({ practices }) => {
        hydrated = true;
        setSnapshot(practices);
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
    snapshot = [];
    hydrated = false;
    hydrating = null;
  },

  /** Optimistically patches one practice, then best-effort persists it.
   *  Returns the promise so a caller can surface a save error. */
  save(
    id: string,
    patch: { enabled?: boolean; config?: Record<string, number> }
  ): Promise<PlaybookPractice> {
    const current = snapshot.find((p) => p.id === id);
    if (current) {
      mergePractice({
        ...current,
        enabled: patch.enabled ?? current.enabled,
        config: { ...current.config, ...patch.config },
      });
    }
    return api.playbook.updatePracticeConfig(id, patch).then((result) => {
      mergePractice(result);
      return result;
    });
  },
};

/** React hook: the live Playbook practice list. Re-renders on store changes only. */
export function usePlaybookPractices(): PlaybookPractice[] {
  return useSyncExternalStore(playbookStore.subscribe, playbookStore.getSnapshot);
}
