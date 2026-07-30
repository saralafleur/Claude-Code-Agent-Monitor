---
id: kb-architecture-dashboard-dev-stack-topology
domain: architecture
subdomain: dev-environment
title: Dev-stack port topology — dev backend, Vite client, and a possible stray prod build all compete for the same port number
description: >-
  Load when a dashboard browser tab isn't reflecting edits to `client/src`,
  when diagnosing "hot reload doesn't seem to work", when something is
  already listening on port 4820 (or whatever `DASHBOARD_PORT` resolves to)
  and it's unclear what, or when using the `devops` skill's `/devops web-up`
  (PID file `~/.claude/.ccam-web-dev.pid`, log `~/.claude/.ccam-web-dev.log`).
  Explains why the same port number can be either the real dev API (no UI at
  all) or a stale `client/dist/` production build, and gives concrete ways to
  tell them apart before assuming either one.
tags: [dev-server, vite, express, port-conflict, hot-reload, devops-skill]
status: active
created: 2026-07-29
updated: 2026-07-29
source: session diagnosing a stale-build/hot-reload confusion in Claude-Code-Agent-Monitor
---

# Dev-stack port topology — dev backend, Vite client, and a possible stray prod build

## What this is
`npm run dev` (`scripts/dev.js`) spawns **two** processes: the Express backend
(`server/index.js`, run via `node --watch`, conventional port 4820 controlled by
`DASHBOARD_PORT`) and the Vite client dev server (`client/vite.config.ts`,
hardcoded `server.port: 5173`), which proxies `/api` and `/ws` to the backend's
`DASHBOARD_PORT`. Critically, **in dev mode Express serves no UI at all** — no
static handler, no catch-all route. `server/index.js` only mounts
`express.static(client/dist)` when `NODE_ENV === "production"` (see the
`isProduction` branch, currently around lines 154-190; note line 6 defaults
`NODE_ENV` to `"production"` if unset at all, so a bare `node server/index.js`
with no env override serves the built `dist/`).

## Why it matters / the problem it solves
Because of this, **the port number alone never tells you what's serving a
tab**. Port `DASHBOARD_PORT` (conventionally 4820) can be:
- the dev backend from `npm run dev` — API/WebSocket only, and visiting it in
  a browser shows nothing useful (or whatever the client proxy forwards), OR
- a separately-started, standalone `node server/index.js` (no `--watch`,
  `NODE_ENV` defaulted to production) — which silently serves a **stale**
  `client/dist/` build from whenever `npm run build` last ran.

During this session a stray standalone `node server/index.js` was squatting on
port 4820 serving a stale build, while the real Vite hot-reload dev server sat
unused on port 5173. Edits to `client/src` were invisible on the port-4820 tab
— an incorrect "yes it hot-reloaded" claim was made and had to be corrected
once this was properly diagnosed. This is a recurring trap: don't assume a
given port is "the dev server" just because it's the conventional one.

## How (the durable knowledge)
To determine what's actually serving a given port/tab:
1. `curl -sI http://localhost:<port>/` and check `X-Powered-By: Express` +
   absence of a `@vite/client` script tag in the HTML body — a real Vite dev
   response includes a `<script type="module" src="/@vite/client">` tag; a
   built bundle does not.
2. Check `client/dist/index.html`'s mtime against your last edit — if the
   mtime predates your edit, you're looking at a stale build, not hot reload.
3. If using the `devops` skill's managed dev server (`/devops web-up`), it
   tracks its process via `~/.claude/.ccam-web-dev.pid` and logs to
   `~/.claude/.ccam-web-dev.log`; grep that log for `[vite]` HMR lines
   (`grep '\[vite\]' ~/.claude/.ccam-web-dev.log`) to confirm the dev server is
   actually the one hot-reloading, and confirm which port it bound (the log
   also records the resolved `DASHBOARD_PORT`, see `scripts/dev.js`'s port
   probing/fallback behavior).
4. Kill any stray standalone `node server/index.js` (check `ps` for it) before
   trusting a "no hot reload" or "stale content" observation — it, not Vite,
   may be answering that port.
5. The client-side, non-guessing way to tell dev-vs-built from *inside* the
   running app is `import.meta.env.DEV` (see
   `kb-frontend-dev-tooling-dev-build-site-indicator`) — reliable regardless of
   which port answers, unlike port-number guessing.

## Decisions & rationale
No architecture change here — this is a debugging/mental-model capture, not a
decision. The actual fix built from this diagnosis (a UI indicator so this
never needs re-diagnosing manually) is `kb-frontend-dev-tooling-dev-build-site-indicator`.

## Related
- [[kb-frontend-dev-tooling-dev-build-site-indicator]] — the UI fix built to make this distinction visible at a glance instead of requiring manual diagnosis.
- [[kb-frontend-conventions-vite-build-time-globals]] — the build-time-global mechanism the fix relies on.
