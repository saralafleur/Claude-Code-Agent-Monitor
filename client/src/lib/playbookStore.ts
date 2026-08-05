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
import type { ObservationKind, ObservationSeverity, PlaybookPractice, WSMessage } from "./types";

// resolveDraftKind/resolveDraftSeverity are a second, independent copy of
// the server's resolution formula (server/lib/playbook/practices.js's
// resolvePracticeConfig()), and that duplication is unavoidable: the server
// cannot resolve a value the operator hasn't saved yet, and the Playbook
// page's live preview (PlaybookPage.tsx) exists specifically to reflect what
// is currently being edited, before any save. Per §9.1 DERIVED-DUAL-VIEW's
// "documented-duplication" route (see client/src/lib/windowedTotals.ts for
// the precedent), the duplication is named here, along with its bound:
//
//   The duplicate is used ONLY for unsaved draft state. The instant a save
//   completes, the optimistic merge below is overwritten by the server's own
//   `resolvedKind`/`resolvedSeverity` (the PUT response), so divergence
//   between this formula and the server's can never outlive a single save.
//
// Parity with the server formula is enforced by a shared JSON case table,
// driven through both runtimes — see
// server/__tests__/fixtures/playbook-resolution-cases.json,
// server/__tests__/playbook-resolver-parity.test.js (server half), and
// client/src/lib/__tests__/playbookStore.test.ts (client half).
//
// `draft` follows the same "in vs. === undefined" partial-patch discipline
// as the server: `undefined` means "no draft touch yet, fall through to the
// stored override"; an explicit `null` means "the operator picked 'use
// default'", which must fall all the way to the catalog value, not to
// whatever override happens to be stored.
//
// Mirrors server/lib/playbook/practices.js's KIND_VALUES/SEVERITY_VALUES/
// coerceEnum() exactly, so an out-of-enum value (e.g. a stale cached
// snapshot from before an enum change) fails safe to the catalog value here
// too, never rendering or saving garbage — the same fail-safe disposition
// the server's resolver has, proven byte-identical by the shared case table
// (playbook-resolution-cases.json)'s out-of-enum rows.
const KIND_VALUES: ObservationKind[] = ["risk", "info", "good"];
const SEVERITY_VALUES: ObservationSeverity[] = ["info", "warning"];

function coerceKind(value: ObservationKind | null | undefined): ObservationKind | null {
  return value != null && KIND_VALUES.includes(value) ? value : null;
}
function coerceSeverity(value: ObservationSeverity | null | undefined): ObservationSeverity | null {
  return value != null && SEVERITY_VALUES.includes(value) ? value : null;
}

// Destructured (not read as dot-notation off `practice` inline) so this file
// has zero raw reads of the practice's catalog kind/severity fields outside
// their PlaybookPractice interface declaration in types.ts — enforced by
// playbook-resolver-guard.test.js's client-display-path assertion. Falling
// through to the catalog value here is the correct, intended behavior for
// this sanctioned second-order resolver duplicate, not a bypass.
export const resolveDraftKind = (
  practice: PlaybookPractice,
  draft: ObservationKind | null | undefined
): ObservationKind => {
  const { kind, kindOverride } = practice;
  const chosen = draft !== undefined ? draft : kindOverride;
  return coerceKind(chosen) ?? kind;
};

export const resolveDraftSeverity = (
  practice: PlaybookPractice,
  draft: ObservationSeverity | null | undefined
): ObservationSeverity => {
  const { defaultSeverity, severityOverride } = practice;
  const chosen = draft !== undefined ? draft : severityOverride;
  return coerceSeverity(chosen) ?? defaultSeverity;
};

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
   *  Returns the promise so a caller can surface a save error. `kindOverride`/
   *  `severityOverride` follow the same `in`-based partial-patch discipline
   *  as the server (server/routes/playbook.js): an omitted key leaves the
   *  stored override unchanged; an explicit `null` clears it. */
  save(
    id: string,
    patch: {
      enabled?: boolean;
      config?: Record<string, number | boolean>;
      kindOverride?: ObservationKind | null;
      severityOverride?: ObservationSeverity | null;
    }
  ): Promise<PlaybookPractice> {
    const current = snapshot.find((p) => p.id === id);
    if (current) {
      const kindOverride =
        "kindOverride" in patch
          ? (patch.kindOverride as ObservationKind | null)
          : current.kindOverride;
      const severityOverride =
        "severityOverride" in patch
          ? (patch.severityOverride as ObservationSeverity | null)
          : current.severityOverride;
      // Recompute the resolved values locally via this file's own
      // resolveDraftKind/resolveDraftSeverity (the same formula the server
      // uses, including their enum-coercion fail-safe) so the live preview
      // doesn't flicker while the PUT is in flight — replaced below by the
      // server's own authoritative resolvedKind/resolvedSeverity the instant
      // the response lands.
      const optimistic: PlaybookPractice = {
        ...current,
        enabled: patch.enabled ?? current.enabled,
        config: { ...current.config, ...patch.config },
        kindOverride,
        severityOverride,
      };
      mergePractice({
        ...optimistic,
        resolvedKind: resolveDraftKind(optimistic, kindOverride),
        resolvedSeverity: resolveDraftSeverity(optimistic, severityOverride),
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
