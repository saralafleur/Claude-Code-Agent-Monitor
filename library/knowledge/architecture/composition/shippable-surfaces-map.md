---
id: kb-architecture-composition-shippable-surfaces-map
domain: architecture
subdomain: composition
title: This repo is one monorepo bundling six distinct shippable surfaces (and one non-shippable one)
description: >-
  Load when asked "what does this project ship" or "what are all the ways
  people run/consume this," when scoping a change that might need to be
  mirrored beyond the web dashboard, when working in `desktop/`,
  `vscode-extension/`, `mcp/`, or `plugins/`, when deciding whether a bug fix
  or new API needs corresponding client-side updates in more than one place,
  or when the request mentions the Claude Code plugin marketplace, the
  Electron desktop app, the VS Code extension, or Prometheus/Grafana
  monitoring. Gives the confirmed (code-read, not guessed) map of each
  surface and how it relates to `server/`.
tags: [monorepo, desktop, electron, vscode-extension, mcp, plugins, marketplace, monitoring, composition]
status: active
created: 2026-07-30
updated: 2026-07-30
source: investigation during a release-story dogfood session in Claude-Code-Agent-Monitor (2026-07-30)
---

# This repo is one monorepo bundling six distinct shippable surfaces

## What this is
Claude-Code-Agent-Monitor is a single-repo monorepo that bundles **multiple
independently-relevant surfaces** around one core (`server/` + `bin/ccam.js`).
Confirmed by reading code (not previously documented anywhere found in the
repo or this library) as of 2026-07-30:

1. **`server/` + `bin/ccam.js`** — the core: Express API, hook ingestion,
   SQLite, WebSocket broadcast, and the `ccam` CLI. Everything else is a
   client of, or a wrapper around, this.
2. **`client/`** — the React/Vite web UI. Served as static assets by
   `server/index.js` in production, or by Vite's dev server against the same
   API in dev.
3. **`desktop/`** — an Electron wrapper, **not an independent codebase**.
   Confirmed via `desktop/src/server-host.ts`: it `require()`s
   `server/index.js`'s exported `{ createApp, startServer }` **in-process**
   (no child process, no IPC) and starts it on a free port; its
   `BrowserWindow` loads the same origin, i.e. the same `client/dist` build.
   It also probes for an already-running healthy server on the preferred
   port and *adopts* it instead of double-binding (`probePort` /
   `/api/health` check), and shares the same on-disk SQLite DB as `npm
   start`/`npm run dev` by default (writes to `~/.claude/agent-dashboard/`,
   not a private per-app data dir) so desktop and web share one database.
4. **`mcp/`** — a local MCP server exposing dashboard operations as tools to
   Claude Code itself. A separate TypeScript project (own build/typecheck).
5. **`vscode-extension/`** — a thin HTTP-polling client. Does **not** embed
   or spawn the server; it talks to an already-running dashboard over HTTP,
   unlike `desktop/`.
6. **`plugins/`** — a **Claude Code plugin marketplace**: 10 plugins
   declared under `.claude-plugin/marketplace.json` (`ccam-analytics`,
   `ccam-cost-guard`, `ccam-productivity`, `ccam-devtools`, `ccam-insights`,
   `ccam-sessions`, `ccam-workflows`, and three more), each consuming the
   dashboard's local REST API. This surface was newly discovered during this
   session — it wasn't previously documented in the library or flagged in
   prior sessions' notes.
7. **`monitoring/`** — Prometheus/Grafana observability (scrapes
   `GET /api/metrics`, four provisioned Grafana boards). Confirmed **NOT** a
   shippable surface: it is absent from the npm package's `"files"`
   allowlist in `package.json` (`["server", "scripts", "data", "mcp",
   "statusline", "README.md", "LICENSE"]`), i.e. it never ships in the
   published npm tarball — it's a docker-compose-based add-on for people
   running from a full git checkout.

## Why it matters / the problem it solves
Before this, there was no single confirmed map of "what does this project
actually ship" — assumptions about composition (e.g. "is desktop its own
server," "does the VS Code extension embed a copy of the backend," "is there
a plugin marketplace") had to be re-derived by reading multiple directories
each time. Two non-obvious findings specifically:
- `desktop/` looking like it could be a forked/duplicated server is wrong —
  it is genuinely just Electron-as-a-window-onto-the-same-code, verified by
  the in-process `require()` of `server/index.js`.
- The `plugins/` marketplace (10 plugins) is easy to miss entirely since it's
  not referenced from the top-level README/ARCHITECTURE docs in the places
  one would first look; it was found only by directly reading
  `.claude-plugin/marketplace.json`.

## How (the durable knowledge)
When scoping a change, ask which surfaces it touches:
- API/schema/behavior change in `server/` → check `desktop/` (in-process
  consumer, shares the DB), `vscode-extension/` (HTTP consumer, separate
  release cadence — has its own `.vsix` versions), `mcp/` (typed tool
  wrappers, needs `npm run mcp:typecheck`), and `plugins/*/` (each plugin's
  README/commands reference specific API endpoints/fields).
- UI-only change in `client/` → generally only affects `client/` + whichever
  of `desktop`/nothing-else renders it (desktop just loads `client/dist`, no
  separate UI code).
- `monitoring/` changes are scoped to people running from git checkout, not
  package.json consumers — don't assume it needs npm-publish-path treatment.

## Decisions & rationale
No architecture change made here — this is a composition-mapping capture,
done because the map didn't previously exist anywhere and had to be
re-derived by reading `desktop/src/server-host.ts`, `desktop/src/window.ts`,
`package.json`, and `.claude-plugin/marketplace.json` directly.

## Related
- None yet in the library; this is the first "composition" entry.
