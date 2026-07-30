---
id: kb-frontend-dev-tooling-dev-build-site-indicator
domain: frontend
subdomain: dev-tooling
title: DevBuildSiteCard — in-UI indicator + switcher for "am I on the Vite dev server or the built bundle"
description: >-
  Load when touching `client/src/components/DevBuildSiteCard.tsx`, the top of
  `Sidebar.tsx` (brand/title block area), the `__DASHBOARD_PORT__` build-time
  global, or when asked to add/modify a "which environment/mode is this" UI
  affordance. Also relevant background for anyone confused about whether a
  dashboard tab is hot-reloading or showing a stale build — this component is
  the shipped fix for exactly that confusion.
tags: [dev-server, vite, sidebar, ui-indicator, hot-reload, build-time-global]
status: active
created: 2026-07-29
updated: 2026-07-29
source: session that diagnosed the dev/build port confusion and built this fix
---

# DevBuildSiteCard — in-UI indicator + switcher for "am I on the Vite dev server or the built bundle"

## What this is
A small orange two-segment card ("Hot Reload" / "Built") rendered in the
sidebar (`client/src/components/DevBuildSiteCard.tsx`, mounted in
`Sidebar.tsx` above the brand/title block) that tells you, from inside the
running app, whether you're looking at the Vite hot-reload dev server or a
built production bundle — and lets you jump to the other one.

## Why it matters / the problem it solves
Port numbers don't reliably tell you this (see
`kb-architecture-dashboard-dev-stack-topology`) — either site can, in
principle, be reached at either port depending on what's running. This
component removes the need to `curl`/inspect mtimes/grep logs to answer "is
this actually hot-reloading" — it's answered visually, always, from any tab.

## How (the durable knowledge)
- **Detection**: `import.meta.env.DEV` — Vite sets this `true` only under
  `vite dev` (i.e. `npm run dev:client`) and `false` in an actual `vite build`
  bundle, **regardless of which port or process serves it**. This is why it's
  reliable where port-number guessing isn't.
- **Switching**: clicking the *inactive* segment does a full
  `window.location.href` navigation (not a client-side route change) to the
  other server's origin, preserving the current `pathname` + `search`. The
  active segment is disabled (no-op click).
- **Target URLs**:
  - Built site's origin = `__DASHBOARD_PORT__` (a build-time global — the
    backend port this specific build's proxy/API target was configured with).
  - Dev site's origin = a hardcoded `DEV_PORT = 5173` constant in
    `DevBuildSiteCard.tsx`, matching `vite.config.ts`'s `server.port`. This is
    **not** dynamically discovered — Vite doesn't expose its own dev port to
    client code at build/runtime, so it's hardcoded to the documented
    convention instead.
- Hidden while the sidebar is collapsed (same visibility rule as the brand
  text beneath it).

## Decisions & rationale
- Chose `import.meta.env.DEV` over any port-based heuristic specifically
  because it survives the "stray prod build squatting on the dev port"
  failure mode this was built to solve.
- Chose a full page navigation over an in-app route/state change because
  switching origins means switching which server (and which JS bundle) is
  live — an SPA route change can't do that; a real navigation can.
- Chose to hardcode `DEV_PORT` rather than try to discover it, since there is
  no build-time or runtime signal Vite exposes for its own dev port to client
  code — the alternative (an env var threaded through) was judged not worth
  the complexity for a fixed, well-known convention.

## Related
- [[kb-architecture-dashboard-dev-stack-topology]] — the underlying confusion this component solves.
- [[kb-frontend-conventions-vite-build-time-globals]] — how `__DASHBOARD_PORT__` gets into the bundle.
