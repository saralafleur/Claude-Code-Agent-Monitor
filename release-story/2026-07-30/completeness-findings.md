# Completeness Findings — Claude Code Agent Monitor Release Story
**Re-critique pass** (2026-07-30) — covers the re-synthesized `draft-story.md`, including the new Surface(s) and Example fields.

Scope checked: `draft-story.md` against `discovery-candidates.md`, `raw/Claude-Code-Agent-Monitor.txt`, `raw/merged-timeline.txt`, and direct `git show`/`grep` verification against the working tree.

---

## Likely-missing coverage (most actionable — one major gap)

**The "Projects" view itself has no story unit.** Commit `e97c514` (`feat(projects): group sessions/kanban by project, add devops skill and docs updates`, 2026-07-25, first commit in the range) is the commit that *creates* the dedicated Projects page and its backing API — 64 files changed, 5168 insertions: new `client/src/pages/Projects.tsx` (762 lines), new `server/routes/projects.js` (208 lines), `client/src/lib/projectOrder.ts` (61 lines), `server/db.js` schema additions, plus tests (`Projects.test.tsx`, `KanbanBoard.projectsView.test.tsx`, `server/__tests__/projects.test.js`). Confirmed neither `client/src/pages/Projects.tsx` nor `server/routes/projects.js` exists at the fork point (`git show 6758179:client/src/pages/Projects.tsx` / `...server/routes/projects.js` both fail with "exists on disk, but not in 6758179").

The draft's **only** mention of this commit is a single "Under the hood" line: *"One trivial `desktop/package-lock.json` diff in `e97c514`"* — which is true but describes an incidental 4-line lockfile change inside a commit whose actual substance is an entirely new top-level surface. Every later story unit in the draft treats "the standalone Projects page" / "Kanban Projects view" as pre-existing furniture ("Kanban project column header and the standalone Projects page," "Switch Kanban to Projects view," "Sidebar → Calendar... placed right after Projects") without ever having introduced it. This also matches `AGENT-PLAN.md` item 2 verbatim: `- [x] 2. Projects & Kanban: Group your work into projects and track it on a drag-and-drop board. — acceptance: Projects page and Kanban board are live and working` — i.e. this is a plan-tracked, shippable capability, not incidental scaffolding.

Recommendation: this needs its own story unit (or at minimum a clear "foundational" framing note), since a viewer of the release story would otherwise never learn where "Projects" came from despite seven other units depending on it existing.

Everything else with real diffstat weight (`intake/` 21.8%, `.claude/skills/devops/` 4.9%, `library/` 3.3%) is explicitly and correctly accounted for under "Under the hood" as non-product/maintainer tooling — those are clean.

---

## Unconfirmed "Where to find it" — one is resolvable, not just uncertain

**Shareable dashboard link** — the draft marks this `(uncertain: exact capture code not pinpointed in this pass; confirmed only via commit message and diff, not read directly)`. This is over-cautious: the capture function is not hidden — it lives in exactly the file the draft's own Surface-tag note already identifies as touched by `c4ed211` (`client/src/lib/api.ts`). Grep confirms:
```
client/src/lib/api.ts:453:function captureTokenFromUrl(): void {
client/src/lib/api.ts:467:captureTokenFromUrl();
```
It runs as a top-level module side effect on import (line 467), reads `?token=` via `URLSearchParams`, writes it to `localStorage["dashboard_token"]`, then strips it and calls `history.replaceState` (lines ~453-464). `client/src/pages/KanbanBoard.tsx` also cross-references it in a doc comment (`{@link captureTokenFromUrl}`) at line 2133. The `(uncertain)` tag on "Where to find it" should be removed/resolved — this was confirmable with the file already in hand.

Everything else spot-checked below (CLI commands, routes, component locations) confirmed clean — see per-unit notes.

---

## Orphaned commits

None found beyond the `e97c514` gap already covered above (which is really a mis-scoped mention, not a total orphan — the commit hash does appear in the draft, just attached to the wrong 4% of its content).

Four "plans" arc commits are not cited by hash anywhere in the draft (`c2e79fb`, `d5a5ea9`, `f17a7b7`, `8e30dfc`) but their substance is genuinely folded into the "Session focus declarations, detours, and drift auditing" narrative:
- `c2e79fb` — wires client `api.plans` bindings (plumbing for the same feature).
- `d5a5ea9` — adds the "view plan" icon to project/Kanban headers (matches "Where to find it"'s claim of Plan modal entry points from Projects/Kanban headers).
- `f17a7b7` — unifies focus-state rendering (session cards + Plan modal) so detours with no base item are visible — this is arguably part of "drift auditing" surfacing.
- `8e30dfc` — this is specifically **the** `)`/redirect-character quote-parsing bug the draft's "Why it exists" describes ("a `)` or shell redirect character inside a quoted bug/feature title could truncate the parsed declaration"), confirmed by commit body (`FOCUS_RE`... "wasn't quote-aware... a `)` inside a properly-quoted bug/feature title truncated the capture"). The draft describes this bug accurately but never cites `8e30dfc` by hash (compare: the sibling "still-working sub-agent" bug is cited by hash in "Under the hood," `46912c8`/`921fdd5`). Minor gap — not a missing-coverage issue, just an incomplete citation.

Not flagging these four as orphans since their content is substantively represented; flagging only the missing hash citation on `8e30dfc` as a minor completeness nit.

---

## Speculative "Why it exists"

Checked every unit's "Why it exists" against commit messages/bodies. All are supported:
- Session focus declarations — the two named bugs (sub-agent false-Waiting, quote-parsing truncation) are both real, confirmed in `0ef79b3`/hook-path commits and `8e30dfc`'s commit body respectively.
- Hierarchical plan sub-items — commit `090ada9` message and `plan-ingest.test.js` fixtures ("Pipeline Environment" parent/child pattern) support the "naturally multi-part" framing.
- Stable plan-item identity — `81291e1`'s commit body directly states "declared_done_at and any live session focus pointer were silently lost" on reorder, matching the draft's claim word-for-word in substance.
- Per-project focus-time report / Focus Calendar / Focus page — all supported by their respective commit bodies (`e4d4bda`, `31927e2`, etc.) describing the stated motivations (single-project limit, non-technical stakeholder need).
- Monitor groupings — `56c00b0`'s commit body ("mirroring their physical desk layout") directly supports the stated motivation.
- Consolidated status filters — `15a1898`'s commit body ("crowding the... board and getting clipped at narrower widths") directly matches.
- Shareable dashboard link — `c4ed211`'s commit body directly supports "without the recipient needing to separately paste in an auth token... without the token lingering visibly."
- Per-session delete — explicitly attributed to a direct request; not independently verifiable from commit messages alone, but the draft is honest that this is sourced from a request rather than a commit-message inference, so not speculative.
- Honest "still working" status — `0ef79b3`'s commit body directly supports "misleading at a glance."
- Per-turn context-size chart — `57b875d`'s commit body directly supports the stated motivation; confirmed this chart is genuinely new (`SessionOverview.tsx` at fork point has zero "context" references).
- Dev vs. production build indicator — `a9576ed`'s commit body directly supports the cited bug (`NODE_ENV` defaulting to production, serving stale `dist/`).

No speculative "Why it exists" entries found — this category is clean.

---

## Mis-tagged as a feature

Nothing found that's actually a pure fix/revert/internal change mis-presented as a feature. Two borderline cases worth noting (both already handled honestly by the draft, not hard flags):

- **"Stable plan-item identity across reorders"** — this is, by the draft's own admission, a backend-only correctness fix ("Proof point: N/A (backend correctness fix)," "Invisible to the user by design"). It's presented as a headline Plans story unit rather than folded into "Under the hood," but the draft explicitly discloses this and gives a reasonable rationale (it's a load-bearing enabler for the plan-editing feature above it, and reordering-without-data-loss is itself an observable behavior change). Transparent, not misleading — not flagging as a hard mistag, just noting the boundary case for the lead's judgment call.
- **"Honest 'still working' status for background activity"** — reads partly like correcting a wrong status label, but it does add distinguishable new UI states (three new labeled/colored badges vs. one generic "Waiting"), which is a real, if small, user-facing capability change, not just a revert/fix. Not flagging.

---

## Surface tag mismatches

Spot-checked every unit claiming more than one surface (all of the multi-surface claims in this draft are CLI+Web or Web-app-only, since zero commits touch `mcp/`/`vscode-extension/`/`plugins/` and only a lockfile touches `desktop/`, as the draft itself states). Diffstats pulled directly via `git show --name-only`:

| Unit | Claimed surfaces | Verified via | Result |
|---|---|---|---|
| Session focus declarations | CLI + Web app | `46912c8`, `921fdd5`, `81291e1` all touch `bin/ccam.js` | Confirmed |
| Stable plan-item identity | CLI + Web app | `81291e1` touches `bin/ccam.js`, `client/src/components/PlanModal.tsx`, `server/db.js`, `server/lib/plan-ingest.js` | Confirmed |
| Hierarchical plan sub-items | Web app only | `090ada9` touches only `client/`+`server/` files, no `bin/ccam.js` | Confirmed |
| Monitor groupings | Web app (client-only → later +server) | `56c00b0`/`3d656d1`: client + `server/README.md` (docs only, not real server code — "client-only" claim reasonable); `50a2800`: adds real `server/routes/monitors.js` + `server/db.js` | Confirmed |
| Consolidated status filters | Web app (client only) | `15a1898`: only `client/src/pages/KanbanBoard.tsx`, its tests, and `kanban.json` locales | Confirmed |
| Shareable dashboard link | Web app (client only) | `c4ed211`: `client/` + README docs + `server/README.md` (docs only) — no real server route | Confirmed |
| Per-session delete | Web app | `9e1b4d7`: `client/src/pages/SessionDetail.tsx`/`Sessions.tsx`/`KanbanBoard.tsx`/`Projects.tsx` + `server/routes/sessions.js`/`server/openapi.js` | Confirmed |
| Per-turn context-size chart | Web app | `57b875d`: `client/src/components/SessionOverview.tsx` + `server/db.js`/`server/lib/transcript-cache.js`/`server/routes/hooks.js`/`server/routes/sessions.js`; `e685700` client-only | Confirmed |
| Jump to live terminal tab | Web app | `524ed95`: `server/lib/terminal-focus.js` + `server/lib/scripts/focus-terminal-tab.applescript` + `client/src/components/SessionCard.tsx` | Confirmed |
| Open terminal in project | Web app | `8e495e7`/`4a48a48`/`ff83064`: matches draft's per-commit breakdown exactly (client-only for `4a48a48`; client+server for the other two) | Confirmed |
| Focus summary cache visibility | Web app | `524ed95`/`18196dc`/`2394bc7` all pair `client/src/components/CacheSection.tsx` with `server/lib/focus-summary.js`/`server/routes/settings.js` | Confirmed |
| Dev vs. production build indicator | Web app (client only) | `524ed95`: `DevBuildSiteCard.tsx`/`.test.tsx` only, zero server files touched by that component in the same commit | Confirmed |

No mismatches found. Every Surface(s) tag in this draft is accurately backed by the diffstat it cites. This is a clean category.

---

## Missing or unverified examples

- **"Session focus declarations, detours, and drift auditing"** — Example excerpt verified as genuine, exact content from the repo's real `AGENT-PLAN.md`:
```
grep -n "3\. Plan Tracking\|4\. Cost Tracking\|6\. MCP Reliability" AGENT-PLAN.md
5:- [x] 3. Plan Tracking: See each project's plan and progress right in the dashboard. — acceptance: plans show live progress, focus, and drift alerts
6:- [x] 4. Cost Tracking: Know exactly what every session and subagent is costing you. — acceptance: accurate per-session and per-subagent cost breakdowns
8:- [ ] 6. MCP Reliability: Make the local MCP tools something you can always count on. — acceptance: MCP tools work reliably, every time
```
This is a byte-for-byte match to lines 5, 6, and 8 of the real `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/AGENT-PLAN.md`. Not invented. Confirmed clean. The draft's claim that `921fdd5` edited `AGENT-PLAN.md` is also confirmed (`git show --stat 921fdd5` shows `AGENT-PLAN.md | 8 +`).

- **"Hierarchical plan sub-items"** — draft claims no Example field is provided because the root `AGENT-PLAN.md` has no nested `N.M` items and only a test fixture demonstrates the format. Verified true on both counts:
  - `grep -nE "^\s*- \[.\] [0-9]+\.[0-9]+" AGENT-PLAN.md` → **zero matches** (file is genuinely flat).
  - `server/__tests__/plan-ingest.test.js` does contain real `N.M` fixture content (`"  - [ ] 1.1. Image Generation"`, `"  - [x] 1.2. Rough Animation"`, etc., confirmed by grep at multiple lines).
  This is an accurate, correctly-explained gap — not a silently-dropped example. Clean.

- No other story unit's "How to use it" instructs the reader to author/edit a specific file format without an Example field. (`AGENT-PLAN.md` and its `N.M` extension are the only two file-authoring instructions in the draft, and both are handled correctly — one with a real example, one with an explicit, verified explanation for its absence.)

This category is clean.

---

## Summary of actionable items for the lead

1. **(High)** Add a story unit (or explicit framing note) for the Projects page/API itself, shipped in `e97c514` — currently invisible in the draft except for an incidental lockfile mention, despite being foundational to ~7 other units and directly matching a checked `AGENT-PLAN.md` item.
2. **(Low)** Resolve the "(uncertain)" tag on Shareable dashboard link's "Where to find it" — the capture function (`captureTokenFromUrl`, `client/src/lib/api.ts:453-467`) was findable in the same file the draft already knew was touched.
3. **(Trivial)** Cite `8e30dfc` by hash next to the quote-parsing bug description in "Session focus declarations" (currently described accurately but uncited), for consistency with how the sibling sub-agent bug is cited.

All other checked categories (orphaned commits, likely-missing coverage elsewhere, speculative motivations, feature mis-tagging, surface-tag accuracy, example grounding) came back clean.
