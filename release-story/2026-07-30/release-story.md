# Claude Code Agent Monitor (ccam) — release story
**Repos covered:** Claude-Code-Agent-Monitor (single-repo monorepo — dashboard `server/`+`client/`, MCP server `mcp/`, VS Code extension `vscode-extension/`, desktop app `desktop/`, plugin marketplace `plugins/`, monitoring stack `monitoring/`, and `wiki/` all live in this one checkout; no sibling repo found, see `discovery-candidates.md`)
**Range:** Since fork point — diverged from `upstream/master` (`hoangsonww/Claude-Code-Agent-Monitor`) at merge-base `6758179` (2026-07-24 21:12:38 -0700) — 46 commits through HEAD (2026-07-30)
**Generated:** 2026-07-30

---

## Solution composition

This single repo bundles several distinct surfaces, not just one product:

- **`server/` + `bin/ccam.js`** — the Express API/backend and the `ccam` CLI. This is the core: the `agent-dashboard` npm package published from this repo ships `server`, `scripts`, `data`, `mcp`, and `statusline` — every other surface either wraps this in-process, embeds it, or talks to it over HTTP.
- **`client/`** — the React + Vite web UI. It builds to `client/dist` and is served by the Express server in production; it is not an independently deployed service.
- **`desktop/`** — the Electron desktop shell (macOS/Windows). Important nuance: this is a packaging wrapper, not a separate app or codebase. `desktop/src/server-host.ts` `require()`s `server/index.js`'s exported `createApp`/`startServer` directly (no child process), and `desktop/src/window.ts`'s `BrowserWindow` loads that same embedded server, which serves the same `client/dist`. Its own `prebuild.js` builds `client/dist` first if missing. So almost anything that ships to the web app also ships to the desktop app automatically, with no separate desktop-side code required.
- **`mcp/`** — a local MCP server exposing dashboard operations as MCP tools, tightly coupled to the root package via a `file:..` dependency.
- **`vscode-extension/`** — a thin VS Code extension that polls a *running* dashboard server over plain HTTP (`/api/sessions`, `/api/stats`, `/api/analytics`, `/api/health`) and renders a sidebar webview; it does not embed or ship the server itself.
- **`plugins/`** — a 10-plugin Claude Code plugin marketplace (`ccam-analytics`, `ccam-config`, `ccam-cost-guard`, `ccam-dashboard`, `ccam-devtools`, `ccam-insights`, `ccam-productivity`, `ccam-quality`, `ccam-sessions`, `ccam-workflows`) that consumes the dashboard's local API at runtime — a distinct, independently installable surface.
- **`monitoring/`** — a Prometheus/Grafana observability stack for operating the dashboard; not a shippable product surface (absent from the published package's `files` allowlist).

**What this release actually touched:** cross-referencing every one of the 46 commits' changed files against the directories above, this release is almost entirely a `client/` + `server/` (+ `bin/ccam.js` for a few CLI-only changes) release. Zero commits touched `mcp/`, `vscode-extension/`, or `plugins/` at all. Exactly one commit (`e97c514`) touched `desktop/`, and only its `package-lock.json` (an incidental lockfile diff, not feature code) — no `desktop/src` changes anywhere in range. Because `desktop/` wraps `client/`+`server/` in-process, every "Web app" story unit below also reaches the desktop app automatically; the Surface tags below call that out per unit rather than assuming it, and flag the one case (the dev/prod build indicator) where that automatic reach is functionally questionable.

That same commit, `e97c514`, is also where the standalone Projects page and its backing API were created — a foundational surface that several story units below rely on already existing. That gap is flagged, not resolved, under Needs review → Likely-missing coverage.

---

## Plans

### Session focus declarations, detours, and drift auditing
*Subdomain: Focus declarations & drift*
- **What changed:** A monitored project can now keep a human-approved `AGENT-PLAN.md` checklist, and a running session declares which item it's working on (or that it's off-plan on a detour, bug fix, or small feature); the dashboard flags when a session's actual activity looks like it's drifted from what it declared.
- **Why it exists:** Without this, the dashboard could show a session was "active" but not *what for*, so a stakeholder watching the board had no way to tell if work matched the agreed plan. Two bugs were caught and fixed while building it: a session with a still-working sub-agent was briefly showing as falsely "Waiting," and a `)` or shell redirect character inside a quoted bug/feature title could truncate the parsed declaration (`8e30dfc`) — both fixed in the same arc.
- **Where to find it:** CLI: `ccam focus set <n>`, `ccam focus push <desc>`, `ccam focus bug/feature "<title>" "<summary>"`, `ccam focus pop` (see `ccam help`). Surfaces on session cards (breadcrumb + drift badge), in `SessionDetail`'s Plan tab, and in the Plan modal opened from Projects/Kanban project headers.
- **Surface(s):** CLI (`bin/ccam.js`) + Web app (`client/` + `server/`), also reaches the Desktop app (desktop wraps this same client+server in-process; the CLI itself is a separate binary, not part of the desktop wrapper — verified: `46912c8`, `921fdd5`, `81291e1` all touch `bin/ccam.js` directly).
- **Example:** This repo dogfoods its own `AGENT-PLAN.md` at its root (and one of this arc's own commits, `921fdd5`, edited it), which is a real working instance of the exact file format this feature consumes:
  ```markdown
  - [x] 3. Plan Tracking: See each project's plan and progress right in the dashboard. — acceptance: plans show live progress, focus, and drift alerts
  - [x] 4. Cost Tracking: Know exactly what every session and subagent is costing you. — acceptance: accurate per-session and per-subagent cost breakdowns
  - [ ] 6. MCP Reliability: Make the local MCP tools something you can always count on. — acceptance: MCP tools work reliably, every time
  ```
- **Proof point:** A session card showing its current plan-item breadcrumb, with a drift badge lighting up when declared focus and actual activity diverge.
- **How to use it:**
  1. Add an `AGENT-PLAN.md` to a monitored repo's root (see the excerpt above for the real checkbox + acceptance-criteria format).
  2. From a Claude Code session in that repo, run `ccam focus set 3` to declare you're on item 3 (or `ccam focus push "investigating a flaky test"` for a detour).
  3. Open the dashboard's Projects or Kanban view and click the project's "view plan" icon.
  4. Watch the session card's focus line and drift badge update live as work progresses.

### Hierarchical plan sub-items
*Subdomain: Plan structure*
- **What changed:** A plan item can now be broken into dotted sub-stages (e.g. `1.1`, `1.2`) with their own checkbox and note, instead of every item being a single flat line.
- **Why it exists:** Some plan items are naturally multi-part (e.g. "Pipeline Environment" splitting into image/animation/voice work); flattening them into separate top-level numbers made reordering fragile and hid the parent/child relationship.
- **Where to find it:** Plan modal / Plan panel (same entry points as above); sub-items render as a nested tree with a done/total rollup badge.
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `090ada9` touches `client/src/components/PlanModal.tsx`/`PlanPanel.tsx` and `server/lib/plan-ingest.js`/`server/routes/plans.js`, no `bin/ccam.js` in this commit).
- **How to use it:**
  1. In `AGENT-PLAN.md`, nest a sub-item under a parent using the documented `N.M` id format.
  2. Ingest the file (automatic on next hook event, or via the project-plan skill).
  3. Open the Plan modal — the sub-items appear indented under their parent with their own checkboxes.
- **Proof point:** The Plan modal showing a parent item with its 1.1/1.2 sub-items collapsed into a rollup badge, then expanded.

### Stable plan-item identity across reorders
*Subdomain: Plan structure*
- **What changed:** Reordering items in `AGENT-PLAN.md` no longer looks, to the dashboard, like deleting one item and creating a new one — each item now keeps its own identity independent of its display number.
- **Why it exists:** Under the old scheme, a session's "done" timestamp and live focus pointer were silently lost the moment someone reordered the checklist, punishing normal editing.
- **Where to find it:** Invisible to the user by design — the fix is in `plan_items`' storage layer (`item_id` vs. positional `item_number`); the visible effect is that reordering a plan file no longer resets progress.
- **Surface(s):** CLI (`bin/ccam.js`) + Web app (`client/` + `server/`), also reaches the Desktop app (verified: `81291e1` touches `bin/ccam.js`, `client/src/components/PlanModal.tsx`, `server/db.js`, `server/lib/plan-ingest.js`).
- **How to use it:** Not a user action — reorder items freely in `AGENT-PLAN.md` and confirm done/focus state survives.
- **Proof point:** N/A (backend correctness fix); folded in here rather than "Under the hood" because it directly enables safe everyday editing of the plan feature above. (See Needs review → Possibly mis-tagged for the boundary judgment call this placement represents.)

---

## Focus Reporting

### Per-project focus-time report
*Subdomain: Per-project report*
- **What changed:** Each project now has a "time on item" report: how long sessions actually spent on each plan item, detour, bug, or feature, with long idle stretches discounted.
- **Why it exists:** Answers "where did the time actually go on this project" without hand-tallying session logs.
- **Where to find it:** Kanban project column header and the standalone Projects page — a report icon opens the focus-time report modal.
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `d87415e` is server-only, `19e1c35` is client-only, `6e29722`'s fix lands in `client/src/lib/idleStripes.ts`).
- **How to use it:**
  1. Go to Kanban or Projects.
  2. On a project's header, click the focus-time report icon.
  3. Switch between List and Calendar sub-views inside the modal; both now agree on active vs. idle time (a List-view accuracy bug was fixed the day after this shipped, `6e29722`).
- **Proof point:** The focus-time report modal open on a project, showing per-item time bars.

### Focus Calendar board (cross-project)
*Subdomain: Focus Calendar*
- **What changed:** A dedicated "Calendar" page shows the swim-lane focus-time view across *every* monitored project at once (not just one project at a time), with its own project/session/time-window filters, hover popups with active/idle striping, a raw-events inspector, and a zoomable hour window.
- **Why it exists:** The per-project modal only ever showed one project; there was no way to see plan progress across the whole portfolio on one timeline. Along the way, a real data-corruption bug was found and fixed: sessions with heavy sub-agent activity could ingest events out of chronological order, inflating a segment's "active" time past its own wall-clock duration (`b3a2cc9`).
- **Where to find it:** Sidebar → Calendar (`/focus-calendar`, placed right after Projects per an explicit decision, DEC-5).
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified across `2c1ef2f`, `2416292`, `e4d4bda`, `ed23878`: all client + server; `b3a2cc9`, `0416066` are effectively client/server-test-only with no `desktop/`, `mcp/`, or `vscode-extension/` files anywhere in the arc).
- **How to use it:**
  1. Open the Calendar page from the sidebar.
  2. Pick a day or custom range with the time-period picker.
  3. Hover a block for the styled popup, or click its "</>" icon to inspect raw hook events in 10-minute buckets.
  4. Use the zoom bar (4h/8h/12h/24h presets) to narrow the window; the stat tiles recompute to match what's actually visible.
- **Proof point:** The Focus Calendar board with several concurrent session lanes, one block's hover popup open showing active/idle striping.

### Focus page: plain-English activity summaries
*Subdomain: Focus page*
- **What changed:** A second, non-calendar report page turns the same underlying data into a plain "what happened" list — one row per plan item, detour, bug, or feature, each with a one-sentence reason — and now includes an AI-generated narrative summary block for the selected time window, with multi-day rollups for wider ranges.
- **Why it exists:** The Calendar's swim-lane grid is precise but not something you'd hand to a non-technical stakeholder; this page answers "what did we actually do this week" in sentences. The background classifier that attributes unlabeled sessions to plan items previously only ran for projects that *had* an `AGENT-PLAN.md`; it now also summarizes activity in plan-less projects instead of leaving them invisible.
- **Where to find it:** Sidebar → Focus (`/focus`, placed right after Calendar).
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `31927e2`, `b930824`, `0d5fbe7` all pair `client/src/pages/FocusPage.tsx` with `server/lib/focus-inference.js`/`focus-summary.js`/`focus-report.js`; no `desktop/`, `mcp/`, or `vscode-extension/` touches).
- **How to use it:**
  1. Open the Focus page from the sidebar.
  2. Pick a project and time window.
  3. Scroll to the Summary block — it shows a live elapsed clock while generating, then a narrative summary with model attribution; unchanged windows re-serve from cache instantly.
  4. Expand "+N more sessions" on any unclassified bucket for per-session detail.
- **Proof point:** The Focus page's Summary block finishing generation and rendering its bulleted "what happened" narrative.

### Focus summary cache visibility (Settings)
*Subdomain: Settings visibility*
- **What changed:** Settings gained a "Focus Summaries" section showing the AI-summary cache's size, hit rate, a day-bucketed hit/miss timeline, and a drill-down into individual cached resolutions for one day — bucketed by the viewer's own local calendar day rather than UTC (fixed the day after initial ship, `2394bc7`, since UTC bucketing put activity on the wrong day for anyone outside UTC).
- **Why it exists:** Lets a user see whether the Focus page's AI summaries are actually being cached (cheap) or regenerated (costs an LLM call), and inspect what's in the cache.
- **Where to find it:** Settings page → Focus Summaries section (`CacheSection` component).
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `524ed95`, `18196dc`, `2394bc7` all pair `client/src/components/CacheSection.tsx` with `server/lib/focus-summary.js`/`server/routes/settings.js`).
- **How to use it:**
  1. Open Settings.
  2. Scroll to Focus Summaries.
  3. Read the size/hit-rate tiles, or click a day in the timeline to drill into that day's individual cache entries.
- **Proof point:** The Focus Summaries timeline in Settings with a day drilled into, showing hit vs. miss entries.

---

## Kanban Board

### Monitor groupings (draggable "desk layout" boxes)
*Subdomain: Monitor layout*
- **What changed:** Project columns on the Kanban Projects view can now be grouped into named, drag-reorderable "monitor" boxes mirroring a user's physical multi-monitor desk layout; boxes and their contained columns can collapse, and the layout is now shared/synced live across every connected browser instead of living only in one browser's localStorage.
- **Why it exists:** Users watching several projects at once wanted the on-screen layout to match how they'd spread windows across physical monitors, and wanted that arrangement to be consistent whether they open the dashboard from a laptop or a second machine.
- **Where to find it:** Kanban board (`/kanban`), Projects view — "Add monitor" button in the header; drag a project column into a box to assign it.
- **Surface(s):** Web app (`client/`, later `+ server/`), also reaches the Desktop app (verified: `56c00b0`/`3d656d1` are client-only for the box UI itself; `50a2800` adds `server/routes/monitors.js` + `server/db.js` for the live-broadcast/sync piece — so the sync half of this feature is genuinely client+server, the layout/collapse half is client-only).
- **How to use it:**
  1. Switch Kanban to Projects view.
  2. Click "Add monitor," name it.
  3. Drag project columns into the box; boxes sit side by side and can be collapsed to a strip.
  4. Reload from another browser/tab — the same grouping now shows there too, live.
- **Proof point:** Two named monitor boxes side by side on the Kanban board, one collapsed into the strip above.

### Consolidated status filters
*Subdomain: Filters*
- **What changed:** The four separate completed/abandoned/error/internal header toggles on the Kanban board were replaced with one "Filters" overflow button.
- **Why it exists:** The individual toggles crowded the header and got clipped at narrower browser widths.
- **Where to find it:** Kanban board header, "Filters" button (ellipsis icon).
- **Surface(s):** Web app (`client/` only), also reaches the Desktop app (verified: `15a1898` touches only `client/src/pages/KanbanBoard.tsx`, its tests, and `kanban.json` locales — no `server/` files at all).
- **How to use it:**
  1. Open Kanban.
  2. Click "Filters" in the header.
  3. Toggle any of completed/abandoned/error/internal visibility from the dropdown.
- **Proof point:** The Filters dropdown open, showing all four toggles in one place.

### Shareable dashboard link
*Subdomain: Sharing*
- **What changed:** A dashboard URL can now carry a `?token=` query parameter; opening that link captures the token into local storage on first load and strips it from the visible address bar.
- **Why it exists:** Lets someone share a working link to a token-protected dashboard without the recipient needing to separately paste in an auth token, and without the token lingering visibly in the URL/browser history afterward.
- **Where to find it:** Any dashboard page — behavior triggers on load whenever a `token` query param is present. The capture function is `captureTokenFromUrl()` in `client/src/lib/api.ts:453`, invoked as a top-level module side effect on import (`client/src/lib/api.ts:467`): it reads `?token=` via `URLSearchParams`, writes it to `localStorage["dashboard_token"]`, then strips it via `history.replaceState`. Cross-referenced by a doc comment (`{@link captureTokenFromUrl}`) in `client/src/pages/KanbanBoard.tsx:2133`. *(Resolved this pass — previously marked uncertain; confirmed directly via grep against a file already known to be touched by `c4ed211`, not guessed.)*
- **Surface(s):** Web app (`client/` only) — verified `c4ed211` touches only `client/src/pages/KanbanBoard.tsx`, `client/src/lib/api.ts`, and locales, no `server/`. Whether the token-cleanup behavior is meaningful inside the Desktop app's Electron `BrowserWindow`, which has no visible address bar to "clean up," was not verified in this pass — see Needs review → Surface tag mismatches.
- **How to use it:**
  1. Generate/copy a dashboard link that includes `?token=...` (e.g. via the Kanban board's copy-link action).
  2. Send it to another user.
  3. They open it once — the token is stored locally and the URL cleans itself up.
- **Proof point:** A shared link opening, the `?token=` briefly visible then disappearing from the address bar.

---

## Sessions

### Per-session delete
*Subdomain: Session management*
- **What changed:** A single session (e.g. one stuck in "abandoned") can now be deleted directly from its own detail page, instead of only via Settings' bulk age-based cleanup.
- **Why it exists:** Explicitly requested — a way to purge one specific session directly from its detail page.
- **Where to find it:** `SessionDetail` page header (`/sessions/:id`) — two-click confirm delete button.
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `9e1b4d7` touches `client/src/pages/SessionDetail.tsx`/`Sessions.tsx`/`KanbanBoard.tsx`/`Projects.tsx` and `server/routes/sessions.js`/`server/openapi.js`; note `vscode-extension/extension.js` separately calls a *bulk* `DELETE /api/sessions` for its own cleanup command, unrelated to this per-session endpoint and not touched by this commit).
- **How to use it:**
  1. Open a session's detail page.
  2. Click delete in the header, click again to confirm.
  3. The session (and its agents/events/tokens) is removed; any other open tab viewing that session updates live via a `session_deleted` broadcast.
- **Proof point:** The two-click confirm delete button on SessionDetail, then the session list updating live in another tab.

### Honest "still working" status for background activity
*Subdomain: Status accuracy*
- **What changed:** Sessions blocked on a sub-agent, shell command, or monitor process now show their own labeled, green "working" status instead of a generic yellow "Waiting" badge.
- **Why it exists:** "Waiting" implied the session was blocked on a human, when it was actually still doing real work via a child process — misleading at a glance.
- **Where to find it:** Session/agent status badges anywhere they render (Kanban cards, Sessions list, session detail), including compact mode.
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `0ef79b3` touches `client/src/components/AgentCard.tsx`/`SessionCard.tsx`/`StatusBadge.tsx` and `server/routes/hooks.js`).
- **How to use it:** No action needed — a session with an active sub-agent/shell/monitor process now automatically shows the correct label and color.
- **Proof point:** A session card switching from what would have been "Waiting" (yellow) to "Running sub-agent" (green) while a background task executes.

### Per-turn context-size chart
*Subdomain: Context tracking*
- **What changed:** Session detail now charts the *active* context window size turn-by-turn (distinct from lifetime token totals already shown), including a labeled vertical token-count scale with gridlines, so you can see the sawtooth of normal growth and the resets from `/compact` or `/clear`.
- **Why it exists:** Lifetime token totals don't show current context pressure; this makes it possible to see at a glance how close a session is to its context limit and when it was last compacted, with actual token counts readable off the chart rather than just a fixed 200K warning line.
- **Where to find it:** `SessionDetail` / `SessionOverview` component.
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `57b875d` touches `client/src/components/SessionOverview.tsx` plus `server/db.js`/`server/lib/transcript-cache.js`/`server/routes/hooks.js`/`server/routes/sessions.js`; `e685700`'s scale addition is client-only).
- **How to use it:**
  1. Open a session's detail page.
  2. Scroll to the context-size chart.
  3. Read gridlines at 0/25/50/75/100% of the session's max observed context; watch for the sawtooth reset pattern after a `/compact`.
- **Proof point:** The context-size chart showing a sawtooth pattern with a visible drop at a `/compact` event, gridlines labeled with token counts.

### Jump to a session's live terminal tab
*Subdomain: Terminal integration*
- **What changed:** A button on the session card resolves a session's live `claude` process and, on macOS, brings its actual Terminal.app tab to the front (selecting it, fronting the window, flashing it) so you can find the exact terminal a session is running in without hunting.
- **Why it exists:** With many concurrent sessions, finding which physical terminal tab corresponds to a dashboard card was pure guesswork.
- **Where to find it:** Session card, "focus terminal" icon button.
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `524ed95` adds `server/lib/terminal-focus.js` and `server/lib/scripts/focus-terminal-tab.applescript`, paired with `client/src/components/SessionCard.tsx`; the AppleScript automation itself runs server-side and is macOS-only regardless of which surface the UI is opened from).
- **How to use it:**
  1. Find a session card for a session you want to jump to.
  2. Click the focus-terminal icon.
  3. Terminal.app comes to front with the matching tab selected and briefly flashed.
- **Proof point:** Clicking the icon and watching Terminal.app's matching tab flash and come to the front.

### Open a new terminal in a project
*Subdomain: Terminal integration*
- **What changed:** A separate action opens a brand-new Terminal.app window/tab already `cd`'d into a project's working directory (picking which folder if a project maps to more than one), from either a session card or the Kanban project menu — and can now optionally pass an effort name so the new session starts pre-titled via `claude -n <name>` instead of needing a manual rename. The project picker also now surfaces a "Most used" section once there's enough history, instead of a flat alphabetical list.
- **Why it exists:** Starting a *second* session against the same project previously meant manually finding and `cd`-ing into the folder; this makes "just open a fresh terminal here" a one-click action, and the effort-name option removes the extra manual rename step.
- **Where to find it:** Session card menu, and Kanban board header (standalone icon next to the copy-link button, promoted out of the Filters overflow menu on `4a48a48`).
- **Surface(s):** Web app (`client/` + `server/`), also reaches the Desktop app (verified: `8e495e7` adds `client/src/components/OpenTerminalModal.tsx` plus `server/lib/scripts/open-terminal-session.applescript`/`server/lib/terminal-focus.js`/`server/routes/projects.js`/`server/routes/sessions.js`; `4a48a48` is client-only UI placement; `ff83064`'s effort-name option again pairs client + `server/lib/terminal-focus.js`).
- **How to use it:**
  1. On a session card or in Kanban, click "Open terminal in project."
  2. If the project has multiple folders, pick one (Most-used section listed first).
  3. Optionally type an effort name.
  4. A new Terminal.app window opens already in that directory, pre-titled if a name was given.
- **Proof point:** The Open Terminal modal's folder picker with a "Most used" section, followed by a freshly titled terminal window opening.

---

## Settings

### Dev vs. production build indicator
*Subdomain: Local dev affordances*
- **What changed:** A small sidebar card now tells you whether the tab you're looking at is the Vite hot-reload dev server or the built production bundle (both can be served from any port, so the URL alone doesn't say), with a one-click full navigation to the other one.
- **Why it exists:** It's easy to lose track of which build you're testing against when both dev and prod can run on arbitrary ports; a stale-bundle bug in the dev workflow (`a9576ed`, `web-up` defaulting to production and silently serving stale `dist/` instead of proxying Vite) made this worth surfacing directly in the UI.
- **Where to find it:** Sidebar, pinned above the brand block (visible whenever the sidebar is expanded).
- **Surface(s):** Web app (`client/` only — verified `524ed95` adds `client/src/components/DevBuildSiteCard.tsx` with no `server/` route changes). Whether this is meaningfully functional inside the Desktop app is doubtful: the card's whole premise is comparing which localhost port/build the browser tab is currently pointed at and offering a full-page navigation to the other one, but the Electron `BrowserWindow` has no address bar and always loads the embedded server's own build — the underlying dev-vs-prod distinction this card exists to surface may not apply there. Not verified against `desktop/src/window.ts` in this pass — see Needs review → Surface tag mismatches.
- **How to use it:**
  1. Look at the sidebar card — it reads "Dev" or "Built" depending on the current tab.
  2. Click the inactive segment to jump to the other one at the same path.
- **Proof point:** The sidebar card, and clicking it to swap from the dev tab to the prod-build tab (or vice versa).

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
- One trivial `desktop/package-lock.json` diff in `e97c514` (a lockfile-only touch, no `desktop/src` change) — not treated as a desktop-surface feature change anywhere in this pass. That same commit's real substance — the Projects page/API — has no story unit; see Needs review → Likely-missing coverage.
- **Built-then-reverted feature (not part of the current product):** a top-level "WIP" page (live priority-ranked work-in-progress queue, drag-and-drop per-project priority, `/wip` route, sidebar entry, `WipPrioritySidecar`/`WipSessionCard` components) shipped in `fa3f460`/`97ae0a5`/`01eb368` (2026-07-29) and was fully removed the next day in `18196dc` ("Remove the WIP queue feature") — route, nav entry, i18n namespace, components, the `projects.priority` DB column (dropped via a guarded migration), and `PUT /api/projects/reorder` were all deleted. `projectLookup.ts`, extracted as part of that effort, was kept because Kanban's Projects view also depends on it. This is not currently true of the product and is intentionally excluded from the story units above — a deliberate exclusion, not a coverage gap.

---

## Needs review

### Unconfirmed locations
None outstanding. The one previously-uncertain location — the Shareable dashboard link's token-capture code — was resolved this pass: the completeness critic confirmed via direct grep that `captureTokenFromUrl()` is defined at `client/src/lib/api.ts:453` and invoked as a top-level module side effect at `client/src/lib/api.ts:467`, cross-referenced by a doc comment in `client/src/pages/KanbanBoard.tsx:2133`. This was a confirmation of fact in a file already known to be touched by `c4ed211`, not a guess, so the story unit above has been updated directly rather than left as an open flag. No other story unit above has an unconfirmed location.

### Orphaned commits
None. Four "plans" arc commits are not cited by hash in the "Session focus declarations, detours, and drift auditing" unit's prose (`c2e79fb`, `d5a5ea9`, `f17a7b7`, `8e30dfc`), but their substance is genuinely folded into that unit's narrative: `c2e79fb` wires the client `api.plans` bindings, `d5a5ea9` adds the "view plan" icon to project/Kanban headers (matches that unit's "Where to find it" claim), `f17a7b7` unifies focus-state rendering so detours with no base item are visible (part of drift-auditing surfacing), and `8e30dfc` is the specific `)`/redirect-character quote-parsing bug that unit's "Why it exists" describes — this citation has now been added directly to that field above, since it was a missing bibliographic reference for an already-accurately-described bug, not an open question.

### Likely-missing coverage
**(High)** The Projects page and its backing API have no story unit despite being foundational to at least seven units above. Commit `e97c514` (`feat(projects): group sessions/kanban by project, add devops skill and docs updates`, 2026-07-25, first commit in range, 64 files changed, 5168 insertions) is the commit that *creates* `client/src/pages/Projects.tsx` (762 lines), `server/routes/projects.js` (208 lines), `client/src/lib/projectOrder.ts` (61 lines), `server/db.js` schema additions, and their tests (`Projects.test.tsx`, `KanbanBoard.projectsView.test.tsx`, `server/__tests__/projects.test.js`). Confirmed neither `client/src/pages/Projects.tsx` nor `server/routes/projects.js` exists at the fork point (`git show 6758179:client/src/pages/Projects.tsx` and `...server/routes/projects.js` both fail with "exists on disk, but not in 6758179"). 12 of the 46 commits in range touch this surface, yet the only mention of `e97c514` anywhere in this document is the "Under the hood" line about its incidental 4-line `desktop/package-lock.json` diff — true, but describing a tiny fraction of a commit whose real substance is an entirely new top-level product surface. Every other story unit above treats "the standalone Projects page" / "Kanban Projects view" as pre-existing furniture ("Kanban project column header and the standalone Projects page," "Switch Kanban to Projects view," "Sidebar → Calendar... placed right after Projects") without ever introducing it. This also matches `AGENT-PLAN.md` item 2 verbatim (`- [x] 2. Projects & Kanban: Group your work into projects and track it on a drag-and-drop board. — acceptance: Projects page and Kanban board are live and working`) — a plan-tracked, shippable capability, not incidental scaffolding. **Not resolved here** — a human reviewer should decide whether to add a dedicated "Projects page" story unit (new domain, or folded into Kanban Board) before this document is used as a storyboard/video source.

### Speculative motivation
None — every unit's "Why it exists" was checked against commit messages/bodies and confirmed supported: Session focus declarations (both named bugs confirmed in `0ef79b3`/hook-path commits and `8e30dfc`'s commit body), Hierarchical plan sub-items (`090ada9` + `plan-ingest.test.js` fixtures), Stable plan-item identity (`81291e1`'s commit body matches almost word-for-word), Per-project focus-time report / Focus Calendar / Focus page (all supported by their respective commit bodies), Monitor groupings (`56c00b0`'s "physical desk layout" language), Consolidated status filters (`15a1898`'s "crowding... clipped at narrower widths"), Shareable dashboard link (`c4ed211`'s commit body), Per-session delete (honestly attributed to a direct request rather than inferred), Honest "still working" status (`0ef79b3`), Per-turn context-size chart (`57b875d`, confirmed genuinely new — zero "context" references in `SessionOverview.tsx` at the fork point), Dev vs. production build indicator (`a9576ed`'s `NODE_ENV`/stale-`dist/` bug).

### Possibly mis-tagged
None as hard flags. Two boundary judgment calls worth the human's attention, both already disclosed transparently in the story units themselves rather than hidden:
- **Stable plan-item identity across reorders** is, by its own text, a backend-only correctness fix ("Proof point: N/A — backend correctness fix," "Invisible to the user by design") presented as a headline Plans story unit rather than folded into "Under the hood." The stated rationale (load-bearing enabler for the plan-editing feature above it, and reordering-without-data-loss is itself an observable behavior change) is reasonable, but the placement is a judgment call the lead should confirm stands.
- **Honest "still working" status for background activity** reads partly like a corrected mislabel, but it does add three new distinguishable badge states versus one generic "Waiting," which is a real, if small, user-facing capability change rather than just a fix/revert. Not flagged as wrong, just noted as a boundary case.

### Surface tag mismatches
None found. All 12 multi-surface claims in this document were spot-checked directly against `git show --name-only` diffstats and every one is accurately backed by the commits cited (Session focus declarations, Stable plan-item identity, Hierarchical plan sub-items, Monitor groupings, Consolidated status filters, Shareable dashboard link, Per-session delete, Per-turn context-size chart, Jump to a session's live terminal tab, Open a new terminal in a project, Focus summary cache visibility, Dev vs. production build indicator).

Two narrower, separate open questions survive from the original synthesis and were **not** resolved by this critique pass (unverified functional-behavior doubts, not tag inaccuracies, carried forward for completeness): whether the Shareable dashboard link's URL-cleanup behavior is meaningful inside the Desktop app's Electron `BrowserWindow` (which has no visible address bar), and whether the Dev vs. production build indicator's whole premise (comparing which localhost port a browser tab is currently on) applies at all inside that same window. Neither has been checked against `desktop/src/window.ts` by either the synthesis or critique passes.

### Missing or unverified examples
None. Both examples in this document were verified:
- The `AGENT-PLAN.md` excerpt on "Session focus declarations, detours, and drift auditing" is a byte-for-byte match to lines 5, 6, and 8 of this repo's real root `AGENT-PLAN.md` (confirmed via grep), and `921fdd5`'s edit to that file is also confirmed (`git show --stat 921fdd5` shows `AGENT-PLAN.md | 8 +`).
- "Hierarchical plan sub-items" correctly omits an Example: the repo's own `AGENT-PLAN.md` has zero `N.M` nested items (`grep -nE "^\s*- \[.\] [0-9]+\.[0-9]+" AGENT-PLAN.md` → zero matches), and the only place that format appears with real content is a test fixture (`server/__tests__/plan-ingest.test.js`), which was correctly not presented as a dogfooded example.

No other story unit above instructs the reader to author or edit a specific file format without either providing or correctly explaining the absence of an example.
