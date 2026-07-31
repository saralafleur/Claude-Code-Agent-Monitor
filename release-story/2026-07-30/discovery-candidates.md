# Discovery candidates

**Seed repo:** /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor

**Repo set (re-confirmed this pass):** single repo, no siblings.
**Range (re-confirmed this pass):** since fork point, merge-base
`6758179` (2026-07-24 21:12:38 -0700), HEAD 46 commit(s) ahead of
`upstream/master`.

## Summary

No other repository is believed to belong to this solution. Claude Code
Agent Monitor (ccam) is a single-repo monorepo: the dashboard (`server/`,
`client/`), the local MCP server (`mcp/`), the VS Code extension
(`vscode-extension/`), the desktop app (`desktop/`), the monitoring stack
(`monitoring/`), the Claude Code plugin marketplace (`plugins/`), and the
wiki (`wiki/`) all live inside this one git repository, with no separate
`.git` directories, no `.gitmodules`, and no submodules. Each
sub-package's own `package.json` `repository` field points back to the
same upstream URL (`https://github.com/hoangsonww/Claude-Code-Agent-Monitor`),
confirming they are not independently versioned/published repos.

## Investigation performed

- Read `package.json` (name `agent-dashboard`, bin `ccam`, `repository`
  pointing to `hoangsonww/Claude-Code-Agent-Monitor`) and the `setup`/
  `desktop:*`/`mcp:*`/`monitoring:*` npm scripts, all of which `cd` into
  in-repo subdirectories (`client`, `vscode-extension`, `mcp`, `desktop`,
  `monitoring`) rather than referencing sibling checkouts.
- Read `README.md` and grepped it (plus `docker-compose.yml`,
  `docker-compose.full.yml`) for `github.com/<org>/<repo>` references and
  for "wiki"/"companion"/"extension"/"desktop" mentions. The only GitHub
  repo referenced anywhere is `hoangsonww/Claude-Code-Agent-Monitor`
  itself (star-history badge, funding link, etc). `docker-compose.full.yml`
  only adds `prom/prometheus` and `grafana/grafana` official upstream
  images — not sibling product repos.
- Confirmed `wiki/`, `desktop/`, `vscode-extension/`, `mcp/`, `client/`,
  `server/`, `monitoring/`, `plugins/` have no nested `.git` directory and
  there is no `.gitmodules` file — they are ordinary in-repo directories,
  not separate repos or submodules.
- Checked `vscode-extension/package.json`, `desktop/package.json`, and
  `mcp/package.json` `repository`/`homepage` fields — all point to the
  same `github.com/hoangsonww/Claude-Code-Agent-Monitor` as the root
  `package.json`, i.e. they are published as part of the same repo, not
  as independently versioned products.
- Listed the seed's parent directory
  (`/Users/sara/CODE-LOCAL/SARA/`, 67 entries) and checked every entry
  with a `.git` directory for a remote matching the seed's own orgs
  (`saralafleur`, `hoangsonww`). Many siblings share the `saralafleur`
  GitHub owner (`devops`, `dnd`, `docker-host`,
  `ember_google_workspace_mcp`, `ember-claude-toolkit`,
  `ember-microsoft365`, `ember-otter-ai-mcp`, `home-data-center`,
  `iphone-app`, `laundryroom-alerts`, `meeting-transcriber`, `otter.ai`,
  `prompt_vault`, `resume`, `the-sleep-lady`, `todo`) — but this is
  Sara's single personal GitHub account holding dozens of unrelated
  personal projects, so shared ownership alone is not being treated as
  relatedness evidence per this skill's own caution against asserting
  relatedness "just because it happens to be nearby." None of these
  siblings reference `ccam`/`Claude-Code-Agent-Monitor`/`agent-dashboard`
  by name in their READMEs, package.json, or other config
  (verified with a recursive grep across all sibling READMEs).
- Scanned sibling directory names for product-family naming patterns
  (`*claude*`, `*ccam*`, `*agent-monitor*`, `*agent-dashboard*`). Only
  `claude-example` and `ember-claude-toolkit` matched, and both are
  unrelated: `claude-example` is an empty/placeholder nested directory,
  and `ember-claude-toolkit` is Sara's own separate toolkit repo with no
  reference to ccam anywhere in its docs.
- Noted three other siblings (`efforts/`, `New Group/`,
  `New-Group-efforts/`) that superficially resemble ccam's own
  `intake/`/`library/`/`release-story/` working-directory pattern, but
  inspection shows they belong to a completely different project (a
  coaching/agent-team codebase unrelated to Claude Code session
  monitoring) — not included as candidates.
- This pass re-listed `/Users/sara/CODE-LOCAL/SARA/` again to confirm no
  new sibling repos appeared since the earlier discovery run today; the
  directory listing is unchanged in relevant respects (same set, no new
  `Claude-Code-Agent-Monitor-*`/`ccam-*`-named git repos).

## Candidates

None found. No sibling repo, README/config reference, shared-remote-org
signal with corroborating evidence, or product-family name match points
to a genuinely separate repository that is part of this solution.

## Composition

New this pass: mapping the seed repo's internal composition (sub-solutions
and surfaces bundled inside the one repo), since this capability didn't
exist when discovery first ran today. Each surface below was verified
independently (own manifest/config inspected, not just taken on the
hint's word) via `find`/`grep`/`Read` over the actual files.

### server/ + bin/ccam.js — Express API/backend + CLI (root package)
- Evidence: root `package.json` `main: server/index.js`, `bin.ccam:
  bin/ccam.js`; `server/index.js` exports `createApp`/`startServer`;
  `server/routes/`, `server/db.js`, `server/websocket.js` present. The
  `files` array in root `package.json` ships `server`, `scripts`, `data`,
  `mcp`, `statusline`, README, LICENSE — this is what's actually
  published as the `agent-dashboard` npm package.
- Relationship: the core surface. Every other surface below either wraps
  it, embeds it in-process, or talks to it over HTTP.

### client/ — React + Vite web UI
- Evidence: own `package.json` (`agent-dashboard-client`), React 18 +
  Vite 6 + TypeScript deps, `vite build` script.
- Relationship: built to `client/dist` and served by the Express server
  (`server/index.js`) in production — not an independently deployed
  service. Root `npm run build` == `cd client && npm run build`.

### desktop/ — Electron desktop shell (macOS/Windows)
- Evidence: own `package.json` (`agent-dashboard-desktop`), `electron` +
  `electron-builder` devDependencies, `electron-builder.yml`,
  `dmg`/`win`/`win:portable` build scripts confirming a real packaged
  native app.
- Relationship: NOT a separate codebase from client/server — it
  `require()`s `server/index.js` in-process (`desktop/src/server-host.ts`:
  "The dashboard's `server/index.js` already exports `{ createApp,
  startServer }` ... We import that module directly — no child process")
  and its `BrowserWindow` (`desktop/src/window.ts`) does `loadURL` against
  that embedded server, which serves `client/dist`. Its own
  `scripts/prebuild.js` explicitly builds `client/dist` first if missing.
  So desktop/ is a native packaging/distribution wrapper around
  server/ + client/, not an independent product.

### mcp/ — Local MCP server
- Evidence: own `package.json` (`agent-dashboard-mcp-server`), dependency
  `@modelcontextprotocol/sdk: ^1.0.0`, `bin.agent-dashboard-mcp`, its own
  `tsconfig.json`/`build`/`test` pipeline.
- Relationship: tightly coupled to the root package via
  `"agent-dashboard": "file:.."` dependency (i.e., it requires the root
  package to exist as a sibling directory, not a fully standalone
  service). Exposes dashboard operations as MCP tools.

### vscode-extension/ — VS Code extension
- Evidence: own `package.json` with `engines.vscode: "^1.75.0"`,
  `publisher: hoangsonw`, `contributes.commands`/`views`/`menus` (a real
  VS Code extension manifest, not just a folder name).
- Relationship: thin client only — `extension.js`/`sidebar.js` poll a
  dashboard server over plain HTTP on `localhost:4820` (or `:5173` in dev)
  and render a webview; it does not embed or ship the server itself, it
  expects one (started via `ccam`, the desktop app, or `npm run dev`) to
  already be running.

### monitoring/ — Prometheus/Grafana observability stack
- Evidence: own `package.json` (`@ccam/monitoring`), `docker-compose.yml`,
  `grafana/`, `prometheus/` config dirs, `scripts/verify.js`.
- Relationship: operational/observability tooling for running the
  dashboard, not a shippable product surface itself — confirmed absent
  from the root package's `files` allowlist (so it's never published as
  part of the `agent-dashboard` npm package). Consistent with the prior
  investigation's characterization.

### plugins/ — Claude Code plugin marketplace (newly identified this pass)
- Evidence: `.claude-plugin/marketplace.json` declares
  `claude-code-agent-monitor-plugins`, listing 10 plugins under
  `plugins/` (`ccam-analytics`, `ccam-config`, `ccam-cost-guard`,
  `ccam-dashboard`, `ccam-devtools`, `ccam-insights`, `ccam-productivity`,
  `ccam-quality`, `ccam-sessions`, `ccam-workflows`), each in its own
  directory under `plugins/`.
- Relationship: a distinct, independently installable product surface (a
  Claude Code plugin marketplace) that consumes the dashboard's local API
  at runtime, bundled in this repo alongside the other surfaces. Not
  mentioned in the earlier known-dirs list handed into this run — worth
  carrying forward as part of this repo's release-story composition so
  plugin-affecting changes aren't missed.

### statusline/ — not a separate surface
- Evidence: no `package.json`; contains only `statusline-command.sh`,
  `statusline.py`, README. It's shipped inside the root `agent-dashboard`
  package (`files` includes `statusline`) as a Claude Code statusline
  integration, not an independently versioned product.

### wiki/ — docs, not a product surface
- Evidence: no `package.json`; content-only directory feeding the GitHub
  wiki. Already noted as part of the single-repo footprint above (no
  nested `.git`).

## History detection (seed only, no candidates)

### /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor — seed
- Remotes:
  - `origin` -> https://github.com/saralafleur/Claude-Code-Agent-Monitor.git
  - `upstream` -> https://github.com/hoangsonww/Claude-Code-Agent-Monitor.git
- Fork candidates: `upstream/master` — merge-base `6758179` (2026-07-24 21:12:38 -0700), HEAD is 46 commit(s) ahead (HEAD has genuinely diverged from upstream)
- Root commit: `d0bda57` (2026-03-05 11:09:47 -0500)

## Dropped from prior grouping

Not applicable — no prior confirmed grouping exists for this seed beyond
today's own earlier discovery pass (checked
`~/.claude/skills/release-story/memory/repo-groupings.md`; only the
template example is present). The repo set and range from today's earlier
confirmation (single repo, since fork point at merge-base `6758179`)
still check out and are unchanged. The only substantive change in this
re-run is the addition of the Composition section (new capability) and,
within it, surfacing `plugins/` as an additional internal surface that the
earlier, composition-blind pass did not identify.
