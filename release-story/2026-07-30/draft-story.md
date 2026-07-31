# Release Story — Claude Code Agent Monitor (ccam)
**Range:** fork point `6758179` (2026-07-24) → HEAD (2026-07-30) — 46 commits, single repo (see `discovery-candidates.md`: no sibling repo found; `vscode-extension/`, `desktop/`, `mcp/`, `plugins/`, `monitoring/`, `wiki/` all live in this one checkout).

---

## Solution composition

This single repo bundles several distinct surfaces, not just one product:

- **`server/` + `bin/ccam.js`** — the Express API/backend and the `ccam` CLI. This is the core: the `agent-dashboard` npm package published from this repo ships `server`, `scripts`, `data`, `mcp`, and `statusline` — every other surface either wraps this in-process, embeds it, or talks to it over HTTP.
- **`client/`** — the React + Vite web UI. It builds to `client/dist` and is served by the Express server in production; it is not an independently deployed service.
- **`desktop/`** — the Electron desktop shell (macOS/Windows). **Important nuance: this is a packaging wrapper, not a separate app or codebase.** `desktop/src/server-host.ts` `require()`s `server/index.js`'s exported `createApp`/`startServer` directly (no child process), and `desktop/src/window.ts`'s `BrowserWindow` loads that same embedded server, which serves the same `client/dist`. Its own `prebuild.js` builds `client/dist` first if missing. So almost anything that ships to the web app also ships to the desktop app automatically, with no separate desktop-side code required.
- **`mcp/`** — a local MCP server exposing dashboard operations as MCP tools, tightly coupled to the root package via a `file:..` dependency.
- **`vscode-extension/`** — a thin VS Code extension that polls a *running* dashboard server over plain HTTP (`/api/sessions`, `/api/stats`, `/api/analytics`, `/api/health`) and renders a sidebar webview; it does not embed or ship the server itself.
- **`plugins/`** — a 10-plugin Claude Code plugin marketplace (`ccam-analytics`, `ccam-config`, `ccam-cost-guard`, `ccam-dashboard`, `ccam-devtools`, `ccam-insights`, `ccam-productivity`, `ccam-quality`, `ccam-sessions`, `ccam-workflows`) that consumes the dashboard's local API at runtime — a distinct, independently installable surface.
- **`monitoring/`** — a Prometheus/Grafana observability stack for operating the dashboard; not a shippable product surface (absent from the published package's `files` allowlist).

**What this release actually touched:** cross-referencing every one of the 46 commits' changed files against the directories above, this release is almost entirely a `client/` + `server/` (+ `bin/ccam.js` for a few CLI-only changes) release. Zero commits touched `mcp/`, `vscode-extension/`, or `plugins/` at all. Exactly one commit (`e97c514`) touched `desktop/`, and only its `package-lock.json` (an incidental lockfile diff, not feature code) — no `desktop/src` changes anywhere in range. Because `desktop/` wraps `client/`+`server/` in-process, every "Web app" story unit below also reaches the desktop app automatically; the tags below call that out per unit rather than assuming it, and flag the one case (the dev/prod build indicator) where that automatic reach is functionally questionable.

---

## Plans (AGENT-PLAN.md)

### Session focus declarations, detours, and drift auditing
**What changed** — A monitored project can now keep a human-approved `AGENT-PLAN.md` checklist, and a running session declares which item it's working on (or that it's off-plan on a detour, bug fix, or small feature); the dashboard flags when a session's actual activity looks like it's drifted from what it declared.
**Why it exists** — Without this, the dashboard could show a session was "active" but not *what for*, so a stakeholder watching the board had no way to tell if work matched the agreed plan. Two bugs were caught and fixed while building it: a session with a still-working sub-agent was briefly showing as falsely "Waiting," and a `)` or shell redirect character inside a quoted bug/feature title could truncate the parsed declaration — both fixed in the same arc.
**Where to find it** — CLI: `ccam focus set <n>`, `ccam focus push <desc>`, `ccam focus bug/feature "<title>" "<summary>"`, `ccam focus pop` (see `ccam help`). Surfaces on session cards (breadcrumb + drift badge), in `SessionDetail`'s Plan tab, and in the Plan modal opened from Projects/Kanban project headers.
**Surface(s)** — CLI (`bin/ccam.js`) + Web app (`client/` + `server/`), also reaches the Desktop app (desktop wraps this same client+server in-process; the CLI itself is a separate binary, not part of the desktop wrapper — verified: `46912c8`, `921fdd5`, `81291e1` all touch `bin/ccam.js` directly).
**Example** — This repo dogfoods its own `AGENT-PLAN.md` at its root (and one of this arc's own commits, `921fdd5`, edited it), which is a real working instance of the exact file format this feature consumes:
```markdown
- [x] 3. Plan Tracking: See each project's plan and progress right in the dashboard. — acceptance: plans show live progress, focus, and drift alerts
- [x] 4. Cost Tracking: Know exactly what every session and subagent is costing you. — acceptance: accurate per-session and per-subagent cost breakdowns
- [ ] 6. MCP Reliability: Make the local MCP tools something you can always count on. — acceptance: MCP tools work reliably, every time
```
**Proof point** — A session card showing its current plan-item breadcrumb, with a drift badge lighting up when declared focus and actual activity diverge.
**How to use it**
1. Add an `AGENT-PLAN.md` to a monitored repo's root (see the excerpt above for the real checkbox + acceptance-criteria format).
2. From a Claude Code session in that repo, run `ccam focus set 3` to declare you're on item 3 (or `ccam focus push "investigating a flaky test"` for a detour).
3. Open the dashboard's Projects or Kanban view and click the project's "view plan" icon.
4. Watch the session card's focus line and drift badge update live as work progresses.
**Domain / Subdomain** — Plans / Focus declarations & drift

### Hierarchical plan sub-items
**What changed** — A plan item can now be broken into dotted sub-stages (e.g. `1.1`, `1.2`) with their own checkbox and note, instead of every item being a single flat line.
**Why it exists** — Some plan items are naturally multi-part (e.g. "Pipeline Environment" splitting into image/animation/voice work); flattening them into separate top-level numbers made reordering fragile and hid the parent/child relationship.
**Where to find it** — Plan modal / Plan panel (same entry points as above); sub-items render as a nested tree with a done/total rollup badge.
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `090ada9` touches `client/src/components/PlanModal.tsx`/`PlanPanel.tsx` and `server/lib/plan-ingest.js`/`server/routes/plans.js`, no `bin/ccam.js` in this commit).
**How to use it**
1. In `AGENT-PLAN.md`, nest a sub-item under a parent using the documented `N.M` id format.
2. Ingest the file (automatic on next hook event, or via the project-plan skill).
3. Open the Plan modal — the sub-items appear indented under their parent with their own checkboxes.
**Proof point** — The Plan modal showing a parent item with its 1.1/1.2 sub-items collapsed into a rollup badge, then expanded.
**Domain / Subdomain** — Plans / Plan structure

### Stable plan-item identity across reorders
**What changed** — Reordering items in `AGENT-PLAN.md` no longer looks, to the dashboard, like deleting one item and creating a new one — each item now keeps its own identity independent of its display number.
**Why it exists** — Under the old scheme, a session's "done" timestamp and live focus pointer were silently lost the moment someone reordered the checklist, punishing normal editing.
**Where to find it** — Invisible to the user by design — the fix is in `plan_items`' storage layer (`item_id` vs. positional `item_number`); the visible effect is that reordering a plan file no longer resets progress.
**Surface(s)** — CLI (`bin/ccam.js`) + Web app (`client/` + `server/`), also reaches the Desktop app (verified: `81291e1` touches `bin/ccam.js`, `client/src/components/PlanModal.tsx`, `server/db.js`, `server/lib/plan-ingest.js`).
**How to use it**
1. Not a user action — reorder items freely in `AGENT-PLAN.md`.
2. Confirm done/focus state survives the reorder.
**Proof point** — N/A (backend correctness fix); folded in here rather than "Under the hood" because it directly enables safe everyday editing of the plan feature above.
**Domain / Subdomain** — Plans / Plan structure

---

## Focus Reporting

### Per-project focus-time report
**What changed** — Each project now has a "time on item" report: how long sessions actually spent on each plan item, detour, bug, or feature, with long idle stretches discounted.
**Why it exists** — Answers "where did the time actually go on this project" without hand-tallying session logs.
**Where to find it** — Kanban project column header and the standalone Projects page — a report icon opens the focus-time report modal.
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `d87415e` is server-only, `19e1c35` is client-only, `6e29722`'s fix lands in `client/src/lib/idleStripes.ts`).
**How to use it**
1. Go to Kanban or Projects.
2. On a project's header, click the focus-time report icon.
3. Switch between List and Calendar sub-views inside the modal; both now agree on active vs. idle time (a List-view accuracy bug was fixed the day after this shipped, `6e29722`).
**Proof point** — The focus-time report modal open on a project, showing per-item time bars.
**Domain / Subdomain** — Focus Reporting / Per-project report

### Focus Calendar board (cross-project)
**What changed** — A dedicated "Calendar" page shows the swim-lane focus-time view across *every* monitored project at once (not just one project at a time), with its own project/session/time-window filters, hover popups with active/idle striping, a raw-events inspector, and a zoomable hour window.
**Why it exists** — The per-project modal only ever showed one project; there was no way to see plan progress across the whole portfolio on one timeline. Along the way, a real data-corruption bug was found and fixed: sessions with heavy sub-agent activity could ingest events out of chronological order, inflating a segment's "active" time past its own wall-clock duration (`b3a2cc9`).
**Where to find it** — Sidebar → Calendar (`/focus-calendar`, placed right after Projects per an explicit decision, DEC-5).
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified across `2c1ef2f`, `2416292`, `e4d4bda`, `ed23878`: all client + server; `b3a2cc9`, `0416066` are effectively client/server-test-only with no `desktop/`, `mcp/`, or `vscode-extension/` files anywhere in the arc).
**How to use it**
1. Open the Calendar page from the sidebar.
2. Pick a day or custom range with the time-period picker.
3. Hover a block for the styled popup, or click its "</>" icon to inspect raw hook events in 10-minute buckets.
4. Use the zoom bar (4h/8h/12h/24h presets) to narrow the window; the stat tiles recompute to match what's actually visible.
**Proof point** — The Focus Calendar board with several concurrent session lanes, one block's hover popup open showing active/idle striping.
**Domain / Subdomain** — Focus Reporting / Focus Calendar

### Focus page: plain-English activity summaries
**What changed** — A second, non-calendar report page turns the same underlying data into a plain "what happened" list — one row per plan item, detour, bug, or feature, each with a one-sentence reason — and now includes an AI-generated narrative summary block for the selected time window, with multi-day rollups for wider ranges.
**Why it exists** — The Calendar's swim-lane grid is precise but not something you'd hand to a non-technical stakeholder; this page answers "what did we actually do this week" in sentences. The background classifier that attributes unlabeled sessions to plan items previously only ran for projects that *had* an `AGENT-PLAN.md`; it now also summarizes activity in plan-less projects instead of leaving them invisible.
**Where to find it** — Sidebar → Focus (`/focus`, placed right after Calendar).
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `31927e2`, `b930824`, `0d5fbe7` all pair `client/src/pages/FocusPage.tsx` with `server/lib/focus-inference.js`/`focus-summary.js`/`focus-report.js`; no `desktop/`, `mcp/`, or `vscode-extension/` touches).
**How to use it**
1. Open the Focus page from the sidebar.
2. Pick a project and time window.
3. Scroll to the Summary block — it shows a live elapsed clock while generating, then a narrative summary with model attribution; unchanged windows re-serve from cache instantly.
4. Expand "+N more sessions" on any unclassified bucket for per-session detail.
**Proof point** — The Focus page's Summary block finishing generation and rendering its bulleted "what happened" narrative.
**Domain / Subdomain** — Focus Reporting / Focus page

### Focus summary cache visibility (Settings)
**What changed** — Settings gained a "Focus Summaries" section showing the AI-summary cache's size, hit rate, a day-bucketed hit/miss timeline, and a drill-down into individual cached resolutions for one day — bucketed by the viewer's own local calendar day rather than UTC (fixed the day after initial ship, `2394bc7`, since UTC bucketing put activity on the wrong day for anyone outside UTC).
**Why it exists** — Lets a user see whether the Focus page's AI summaries are actually being cached (cheap) or regenerated (costs an LLM call), and inspect what's in the cache.
**Where to find it** — Settings page → Focus Summaries section (`CacheSection` component).
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `524ed95`, `18196dc`, `2394bc7` all pair `client/src/components/CacheSection.tsx` with `server/lib/focus-summary.js`/`server/routes/settings.js`).
**How to use it**
1. Open Settings.
2. Scroll to Focus Summaries.
3. Read the size/hit-rate tiles, or click a day in the timeline to drill into that day's individual cache entries.
**Proof point** — The Focus Summaries timeline in Settings with a day drilled into, showing hit vs. miss entries.
**Domain / Subdomain** — Focus Reporting / Settings visibility

---

## Kanban Board

### Monitor groupings (draggable "desk layout" boxes)
**What changed** — Project columns on the Kanban Projects view can now be grouped into named, drag-reorderable "monitor" boxes mirroring a user's physical multi-monitor desk layout; boxes and their contained columns can collapse, and the layout is now shared/synced live across every connected browser instead of living only in one browser's localStorage.
**Why it exists** — Users watching several projects at once wanted the on-screen layout to match how they'd spread windows across physical monitors, and wanted that arrangement to be consistent whether they open the dashboard from a laptop or a second machine.
**Where to find it** — Kanban board (`/kanban`), Projects view — "Add monitor" button in the header; drag a project column into a box to assign it.
**Surface(s)** — Web app (`client/`, later `+ server/`), also reaches the Desktop app (verified: `56c00b0`/`3d656d1` are client-only for the box UI itself; `50a2800` adds `server/routes/monitors.js` + `server/db.js` for the live-broadcast/sync piece — so the sync half of this feature is genuinely client+server, the layout/collapse half is client-only).
**How to use it**
1. Switch Kanban to Projects view.
2. Click "Add monitor," name it.
3. Drag project columns into the box; boxes sit side by side and can be collapsed to a strip.
4. Reload from another browser/tab — the same grouping now shows there too, live.
**Proof point** — Two named monitor boxes side by side on the Kanban board, one collapsed into the strip above.
**Domain / Subdomain** — Kanban Board / Monitor layout

### Consolidated status filters
**What changed** — The four separate completed/abandoned/error/internal header toggles on the Kanban board were replaced with one "Filters" overflow button.
**Why it exists** — The individual toggles crowded the header and got clipped at narrower browser widths.
**Where to find it** — Kanban board header, "Filters" button (ellipsis icon).
**Surface(s)** — Web app (`client/` only), also reaches the Desktop app (verified: `15a1898` touches only `client/src/pages/KanbanBoard.tsx`, its tests, and `kanban.json` locales — no `server/` files at all).
**How to use it**
1. Open Kanban.
2. Click "Filters" in the header.
3. Toggle any of completed/abandoned/error/internal visibility from the dropdown.
**Proof point** — The Filters dropdown open, showing all four toggles in one place.
**Domain / Subdomain** — Kanban Board / Filters

### Shareable dashboard link
**What changed** — A dashboard URL can now carry a `?token=` query parameter; opening that link captures the token into local storage on first load and strips it from the visible address bar.
**Why it exists** — Lets someone share a working link to a token-protected dashboard without the recipient needing to separately paste in an auth token, and without the token lingering visibly in the URL/browser history afterward.
**Where to find it** — Any dashboard page — behavior triggers on load whenever a `token` query param is present *(uncertain: exact capture code not pinpointed in this pass; confirmed only via commit message and diff, not read directly)*.
**Surface(s)** — Web app (`client/` only) *(uncertain in one respect: this is fundamentally a browser-URL/localStorage mechanism — verified `c4ed211` touches only `client/src/pages/KanbanBoard.tsx`, `client/src/lib/api.ts`, and locales, no `server/`; whether it behaves the same inside the Desktop app's Electron `BrowserWindow`, which has no visible address bar to "clean up," was not verified in this pass)*.
**How to use it**
1. Generate/copy a dashboard link that includes `?token=...` (e.g. via the Kanban board's copy-link action).
2. Send it to another user.
3. They open it once — the token is stored locally and the URL cleans itself up.
**Proof point** — A shared link opening, the `?token=` briefly visible then disappearing from the address bar.
**Domain / Subdomain** — Kanban Board / Sharing

---

## Sessions

### Per-session delete
**What changed** — A single session (e.g. one stuck in "abandoned") can now be deleted directly from its own detail page, instead of only via Settings' bulk age-based cleanup.
**Why it exists** — Explicitly requested ("Sara asked for a way to purge one specific session... directly from its detail page").
**Where to find it** — `SessionDetail` page header (`/sessions/:id`) — two-click confirm delete button.
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `9e1b4d7` touches `client/src/pages/SessionDetail.tsx`/`Sessions.tsx`/`KanbanBoard.tsx`/`Projects.tsx` and `server/routes/sessions.js`/`server/openapi.js`; note `vscode-extension/extension.js` separately calls a *bulk* `DELETE /api/sessions` for its own cleanup command, unrelated to this per-session endpoint and not touched by this commit).
**How to use it**
1. Open a session's detail page.
2. Click delete in the header, click again to confirm.
3. The session (and its agents/events/tokens) is removed; any other open tab viewing that session updates live via a `session_deleted` broadcast.
**Proof point** — The two-click confirm delete button on SessionDetail, then the session list updating live in another tab.
**Domain / Subdomain** — Sessions / Session management

### Honest "still working" status for background activity
**What changed** — Sessions blocked on a sub-agent, shell command, or monitor process now show their own labeled, green "working" status instead of a generic yellow "Waiting" badge.
**Why it exists** — "Waiting" implied the session was blocked on a human, when it was actually still doing real work via a child process — misleading at a glance.
**Where to find it** — Session/agent status badges anywhere they render (Kanban cards, Sessions list, session detail), including compact mode.
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `0ef79b3` touches `client/src/components/AgentCard.tsx`/`SessionCard.tsx`/`StatusBadge.tsx` and `server/routes/hooks.js`).
**How to use it**
1. No action needed — a session with an active sub-agent/shell/monitor process now automatically shows the correct label and color.
**Proof point** — A session card switching from what would have been "Waiting" (yellow) to "Running sub-agent" (green) while a background task executes.
**Domain / Subdomain** — Sessions / Status accuracy

### Per-turn context-size chart
**What changed** — Session detail now charts the *active* context window size turn-by-turn (distinct from lifetime token totals already shown), including a labeled vertical token-count scale with gridlines, so you can see the sawtooth of normal growth and the resets from `/compact` or `/clear`.
**Why it exists** — Lifetime token totals don't show current context pressure; this makes it possible to see at a glance how close a session is to its context limit and when it was last compacted, with actual token counts readable off the chart rather than just a fixed 200K warning line.
**Where to find it** — `SessionDetail` / `SessionOverview` component.
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `57b875d` touches `client/src/components/SessionOverview.tsx` plus `server/db.js`/`server/lib/transcript-cache.js`/`server/routes/hooks.js`/`server/routes/sessions.js`; `e685700`'s scale addition is client-only).
**How to use it**
1. Open a session's detail page.
2. Scroll to the context-size chart.
3. Read gridlines at 0/25/50/75/100% of the session's max observed context; watch for the sawtooth reset pattern after a `/compact`.
**Proof point** — The context-size chart showing a sawtooth pattern with a visible drop at a `/compact` event, gridlines labeled with token counts.
**Domain / Subdomain** — Sessions / Context tracking

### Jump to a session's live terminal tab
**What changed** — A button on the session card resolves a session's live `claude` process and, on macOS, brings its actual Terminal.app tab to the front (selecting it, fronting the window, flashing it) so you can find the exact terminal a session is running in without hunting.
**Why it exists** — With many concurrent sessions, finding which physical terminal tab corresponds to a dashboard card was pure guesswork.
**Where to find it** — Session card, "focus terminal" icon button.
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `524ed95` adds `server/lib/terminal-focus.js` and `server/lib/scripts/focus-terminal-tab.applescript`, paired with `client/src/components/SessionCard.tsx`; the AppleScript automation itself runs server-side and is macOS-only regardless of which surface the UI is opened from).
**How to use it**
1. Find a session card for a session you want to jump to.
2. Click the focus-terminal icon.
3. Terminal.app comes to front with the matching tab selected and briefly flashed.
**Proof point** — Clicking the icon and watching Terminal.app's matching tab flash and come to the front.
**Domain / Subdomain** — Sessions / Terminal integration

### Open a new terminal in a project
**What changed** — A separate action opens a brand-new Terminal.app window/tab already `cd`'d into a project's working directory (picking which folder if a project maps to more than one), from either a session card or the Kanban project menu — and can now optionally pass an effort name so the new session starts pre-titled via `claude -n <name>` instead of needing a manual rename. The project picker also now surfaces a "Most used" section once there's enough history, instead of a flat alphabetical list.
**Why it exists** — Starting a *second* session against the same project previously meant manually finding and `cd`-ing into the folder; this makes "just open a fresh terminal here" a one click action, and the effort-name option removes the extra manual rename step.
**Where to find it** — Session card menu, and Kanban board header (standalone icon next to the copy-link button, promoted out of the Filters overflow menu on `4a48a48`).
**Surface(s)** — Web app (`client/` + `server/`), also reaches the Desktop app (verified: `8e495e7` adds `client/src/components/OpenTerminalModal.tsx` plus `server/lib/scripts/open-terminal-session.applescript`/`server/lib/terminal-focus.js`/`server/routes/projects.js`/`server/routes/sessions.js`; `4a48a48` is client-only UI placement; `ff83064`'s effort-name option again pairs client + `server/lib/terminal-focus.js`).
**How to use it**
1. On a session card or in Kanban, click "Open terminal in project."
2. If the project has multiple folders, pick one (Most-used section listed first).
3. Optionally type an effort name.
4. A new Terminal.app window opens already in that directory, pre-titled if a name was given.
**Proof point** — The Open Terminal modal's folder picker with a "Most used" section, followed by a freshly titled terminal window opening.
**Domain / Subdomain** — Sessions / Terminal integration

---

## Settings

### Dev vs. production build indicator
**What changed** — A small sidebar card now tells you whether the tab you're looking at is the Vite hot-reload dev server or the built production bundle (both can be served from any port, so the URL alone doesn't say), with a one-click full navigation to the other one.
**Why it exists** — It's easy to lose track of which build you're testing against when both dev and prod can run on arbitrary ports; a stale-bundle bug in the dev workflow (`a9576ed`, `web-up` defaulting to production and silently serving stale `dist/` instead of proxying Vite) made this worth surfacing directly in the UI.
**Where to find it** — Sidebar, pinned above the brand block (visible whenever the sidebar is expanded).
**Surface(s)** — Web app (`client/` only — verified `524ed95` adds `client/src/components/DevBuildSiteCard.tsx` with no `server/` route changes) *(uncertain whether this is meaningfully functional inside the Desktop app: the card's whole premise is comparing which localhost port/build the browser tab is currently pointed at and offering a full-page navigation to the other one, but the Electron `BrowserWindow` has no address bar and always loads the embedded server's own build — the underlying dev-vs-prod distinction this card exists to surface may not apply there. Not verified against `desktop/src/window.ts` in this pass.)*.
**How to use it**
1. Look at the sidebar card — it reads "Dev" or "Built" depending on the current tab.
2. Click the inactive segment to jump to the other one at the same path.
**Proof point** — The sidebar card, and clicking it to swap from the dev tab to the prod-build tab (or vice versa).
**Domain / Subdomain** — Settings / Local dev affordances

---

## Under the hood

- Hook path fix: sessions with a still-working sub-agent were briefly mislabeled on the Stop/SubagentStop path — same root cause folded into the focus-declarations arc above (`46912c8`, `921fdd5`).
- `fix(build)`: guarded `prepare`/`postinstall` scripts against a nested `mcp/` reinstall corrupting the shared git-worktree config (`e0c96f0`) — root-caused two real same-day incidents.
- `fix(update-check)`: isolated the git subprocess environment from `GIT_DIR`/`GIT_WORK_TREE` so running under a pre-commit hook no longer leaked into and corrupted the calling repo (`5077a72`).
- Settings data export (`GET /api/settings/export`) changed from materializing whole tables into memory to streaming row-by-row, fixing a multi-minute event-loop stall on large databases; a related stack-overflow in focus-report interval building (`push(...intervals)` exceeding V8's spread-argument limit) was fixed the same day (`60af828`). No user-visible change beyond "large exports/reports no longer hang the server."
- Kanban board column-container vertical alignment fix (`flex items-start`) so columns of differing height stop stretching their children (bundled into `57b875d`).
- `.claude/skills/devops` gained `docker-up`/`docker-down` commands (build/start/stop the containerized production build) and a git worktree/branch status table in `/devops status` — maintainer tooling for running this repo's own dev/prod/desktop stacks, not part of the shipped dashboard product surface (`524ed95`, `a9576ed`).
- New shared knowledge-library scaffold (`library/`) for durable cross-session engineering notes — internal documentation infrastructure, not a product feature.
- Extensive documentation/i18n sync commits (README ×4 locales, ARCHITECTURE, docs/API, docs/DATABASE, wiki + i18n cache bumps) accompanying nearly every feature above — not itemized individually.
- `intake/` delivery-pipeline docs (decisions, plans, QA/build reports) tracked retroactively for several efforts after a `.gitignore` rule was silently swallowing them (`0416066`).
- Test infrastructure: a standing `sessionSurfaceParity` test was added to guard against session/project-derivation logic silently diverging across independent consumers (introduced for WIP, later removed with it — see notes below).
- One trivial `desktop/package-lock.json` diff in `e97c514` (a lockfile-only touch, no `desktop/src` change) — not treated as a desktop-surface feature change anywhere in this pass.

---

## Synthesizer notes

- **Built-then-reverted feature, excluded from story units above:** a top-level "WIP" page (live priority-ranked work-in-progress queue, drag-and-drop per-project priority, `/wip` route, sidebar entry, `WipPrioritySidecar`/`WipSessionCard` components) shipped in `fa3f460`/`97ae0a5`/`01eb368` (2026-07-29) and was fully removed the next day in `18196dc` ("Remove the WIP queue feature") — route, nav entry, i18n namespace, components, the `projects.priority` DB column (dropped via guarded migration), and `PUT /api/projects/reorder` were all deleted. `projectLookup.ts`, extracted as part of that effort, was kept because Kanban's Projects view also depends on it. This is **not currently true of the product** and is intentionally not written up as a story unit above.
- **Heavy/entangled commits:** `524ed95` ("Land accumulated uncommitted work") and `18196dc` ("Remove the WIP queue feature; land accumulated cache-timeline/session-card work") each bundle multiple unrelated efforts landed together (a real feature ship plus in-progress, previously-uncommitted work from other efforts). I split their contents by capability above rather than treating them as single story units — worth the critic double-checking I attributed each file correctly, since these commits mix new features with drive-by fixes.
- **Cross-day arcs:** several "one feature" units above span many commits and days purely because of iterative bug-fixing on freshly-shipped surfaces (Focus Calendar accuracy fixes landed 1-2 days after the calendar itself; the cache-timeline timezone fix landed the day after the cache section). I treated these as one story per capability rather than separate units per fix, per the synthesis guidance — flagging in case the critic wants the fix commits called out individually.
- **Shareable dashboard link** (`c4ed211`): I could not pinpoint the exact client file that captures `?token=` from the URL in this pass (grepped likely locations without a clean match) — marked `(uncertain)` above; worth the critic verifying the actual capture site before this ships in a video walkthrough.
- **Devops skill and knowledge library**: judged as maintainer-facing tooling (not part of the ccam dashboard product a session-monitoring user would ever open) and placed under "Under the hood" rather than as domain story units — flagging this classification call in case the critic disagrees, since `/devops` is itself a documented, usable command surface.
- **Quip/Tabby work-in-progress** mentioned inside `792577b`'s commit body ("wip expensive-model quips... currently missing the `expensive_model` QuipKey entry... needs a follow-up fix") appears to be an incomplete, non-shippable fragment picked up from the working tree — not enough evidence of a coherent finished capability to write a story unit, and no later commit in this range appears to finish it. Flagging as thin/incomplete evidence rather than writing a speculative entry.
- **Settings data export streaming / focus-report stack-overflow fix** (`60af828`): classified as "Under the hood" since both are performance/correctness fixes to already-existing capabilities (export button, focus report) with no new user-visible surface — but the export bug (server hangs on large DBs) was severe enough a critic might want it elevated to its own reliability note.
- **Surface-tagging method (this pass):** every story unit's Surface tag above was determined by cross-referencing that unit's actual commit `--name-only` diffstats (re-pulled directly from `git log`, not just the raw gathered cumulative percentages) against discovery's `## Composition` directory map. Result: this entire 46-commit release is a `client/` + `server/` (+ occasional `bin/ccam.js`) release — literally zero commits touch `mcp/`, `vscode-extension/`, or `plugins/`, and only one incidental lockfile line touches `desktop/`. Every "Web app" tag above therefore also reaches the Desktop app structurally (it embeds the same server and serves the same client build), which I noted per unit rather than blanket-asserting; the one place I flagged that automatic reach as functionally doubtful rather than just structurally true is the dev/prod build indicator (Settings), since its whole premise — comparing which localhost port a browser tab is on — may not translate to an Electron window with no address bar. I did not verify that doubt against `desktop/src/window.ts` in this pass; a critic with time to spare could.
- **vscode-extension overlap check:** I greped `vscode-extension/extension.js` and `sidebar.js` for their actual polled endpoints (`/api/sessions`, `/api/stats`, `/api/analytics`, `/api/health`) to check whether any story unit above secretly also surfaces in the VS Code sidebar. None of this release's new/changed routes (`plans.js`, `focus-report.js`, `monitors.js`, the new terminal-focus endpoints, the per-session delete endpoint) overlap with what the extension actually polls, so no story unit is tagged with the VS Code extension as a surface. Noting the check was done rather than skipped, since the extension does hit `/api/sessions`, which is adjacent to (but not the same endpoint as) the per-session delete work.
- **Example grounding:** only one story unit in this release requires the reader to author/edit a file themselves — the `AGENT-PLAN.md` plan-declaration feature — and it's grounded in this repo's own real, dogfooded `AGENT-PLAN.md` at the repo root (excerpt included above). The "Hierarchical plan sub-items" unit, which documents the `N.M` nested-id format, has **no real example available**: the repo's own `AGENT-PLAN.md` is currently flat (no nested items), and the only place the `N.M` format actually appears with real content is a test fixture (`server/__tests__/plan-ingest.test.js`), which I did not treat as a "real dogfooded example" for grounding purposes — flagging this gap explicitly rather than inventing sample nested-item content. No other story unit above asks the reader to author a specific file format.
