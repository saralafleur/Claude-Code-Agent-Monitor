---
id: kb-frontend-conventions-vite-build-time-globals
domain: frontend
subdomain: conventions
title: Pattern — injecting build-time constants via Vite's `define` (`__APP_VERSION__`, `__DASHBOARD_PORT__`)
description: >-
  Load when you need a value baked into the client bundle at build time
  (version strings, a backend origin/port, a fixed feature flag) rather than
  fetched or configured at runtime — covers the three places such a global
  must be touched in this repo (`client/vite.config.ts`'s `define`, mirrored
  in `client/vitest.config.ts` for tests, declared in
  `client/src/vite-env.d.ts`) and the existing precedent
  (`__APP_VERSION__`, `__DASHBOARD_PORT__`) to copy.
tags: [vite, build-config, typescript, testing, convention]
status: active
created: 2026-07-29
updated: 2026-07-29
source: session that added __DASHBOARD_PORT__ alongside the existing __APP_VERSION__ global
---

# Pattern — injecting build-time constants via Vite's `define` (`__APP_VERSION__`, `__DASHBOARD_PORT__`)

## What this is
This client uses Vite's `define` config option to bake compile-time global
constants directly into the bundle, instead of fetching them at runtime.
Two exist today:
- `__APP_VERSION__` — the repo-root `package.json` version, shown in the UI
  footer/settings without a runtime fetch.
- `__DASHBOARD_PORT__` — the `DASHBOARD_PORT` this specific build's client was
  configured with (the backend origin its `/api`/`/ws` proxy targets),
  consumed by `DevBuildSiteCard` to link to "the other site."

## Why it matters / the problem it solves
Adding a new build-time global requires touching **three** files in lockstep,
or the global will be `undefined` at runtime or fail typecheck/tests — easy to
half-do:
1. `client/vite.config.ts` — add the key under `define:` with a real,
   computed value (`JSON.stringify(...)`), used for actual dev/prod builds.
2. `client/vitest.config.ts` — mirror the same `define:` entry with a fixed
   test-time value (e.g. `__DASHBOARD_PORT__: JSON.stringify(4820)`), so
   components referencing the global don't blow up under Vitest (which
   doesn't run through `vite.config.ts`'s dev-server logic).
3. `client/src/vite-env.d.ts` — add `declare const __MY_GLOBAL__: <type>;` so
   TypeScript recognizes the identifier as a global, not an undefined name.

## How (the durable knowledge)
Copy the existing `__APP_VERSION__`/`__DASHBOARD_PORT__` pattern:
- In `vite.config.ts`, compute the value with a small resolver function that
  tries a couple of candidate sources and falls back to a safe default (see
  `resolveAppVersion()`'s root-`package.json` → client-`package.json` →
  placeholder fallback chain — this exists so the build never hard-fails in
  environments that only copy `client/`, e.g. a Docker stage).
- `JSON.stringify()` the value going into `define` (define does raw text
  substitution, not JS-value substitution).
- Add a one-line doc comment above the `declare const` in `vite-env.d.ts`
  explaining what consumes it, so the next person doesn't have to grep to find
  the reason it exists.

## Decisions & rationale
Build-time injection (over a runtime `/api/...` fetch) was chosen for values
that are properties of *this specific build/deploy* rather than live server
state — version and configured backend port don't change without a rebuild, so
there's no correctness reason to pay a network round-trip for them, and it
keeps `DevBuildSiteCard` usable even when the two origins can't necessarily
reach each other's API yet (e.g. before confirming which one is healthy).

## Related
- [[kb-frontend-dev-tooling-dev-build-site-indicator]] — the consumer that motivated adding `__DASHBOARD_PORT__`.
