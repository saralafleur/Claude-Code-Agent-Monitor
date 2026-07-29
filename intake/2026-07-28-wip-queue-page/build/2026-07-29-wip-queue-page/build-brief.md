# Build Brief — WIP (work-in-progress) queue page

Slug: `2026-07-28-wip-queue-page`
Prepared by: Build-Intake Clerk
Date: 2026-07-29 (retry of the 2026-07-28 triage pass, which returned BLOCKED)

**STATUS: READY.** The dirty base branch that blocked the prior triage pass
has been resolved — the "server-shared Kanban monitor layout" feature has
been committed to `master` as `50a2800` ("feat(kanban): shared monitor-layout
groupings with live broadcast"). This pass independently re-verified
`git status --porcelain` on `master` (not taken on faith), confirmed every
specific citation the prior BLOCKED brief flagged as unexecutable now
genuinely exists in `master`'s `HEAD`, and provisioned the effort worktree.

## What we're building

A new top-level `/wip` page: a single, live, priority-ordered queue of
`status === "active"` session cards (awaiting-input sessions always sorted
above non-awaiting, ties broken by a new per-project `priority` set via drag
reorder in a collapsible right-hand sidecar), rendered as a responsive
1/2/3-column contiguous-chunk fill driven by the queue container's own
measured width (`ResizeObserver`, not viewport breakpoints). Everything —
queue membership, sort order, priority changes made in any tab — is
WebSocket-live. This is the fourth independent consumer of the
`Session`/`isSessionAwaitingInput`/`effectiveSessionStatus`/cwd→project-join
surface (after Kanban, Focus List, Focus Calendar); the plan's central
discipline is routing every leg of it through the existing shared helpers
(and extracting one new shared one, `projectLookup.ts`) rather than
re-deriving any of it a fourth time.

## Plan sources

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-07-28-wip-queue-page/technical-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-07-28-wip-queue-page/qa/test-plan.md`

Both exist, are non-empty, and are buildable: `technical-plan.md` has a
concrete, file-by-file change set with line-number anchors and 10 ordered
implementation steps; `test-plan.md` names specific spec files, specific
assertions per file, an explicit red-first sequencing tied 1:1 to the
technical-plan's implementation steps (with QA-mandated corrections/gates
inserted at exact points), and a stated honest scope limit (no real-browser
breakpoint proof — jsdom wiring tests only, backstopped by a required manual
verification pass). The test-plan's surfaces match the technical-plan's
change set exactly (same files, same new modules, same endpoint). **Not a
blocker**, unchanged from the prior pass's finding.

## Buildability check

- Concrete **Change set** (§3, 8 file-group sections) and sequenced
  **Implementation steps** (§4, 10 steps). Not vague.
- Test-plan names **specific spec files + assertions** (§ Test change set)
  and an explicit **red-first** discipline (§ Implementation steps, 18
  numbered steps, each stating what's RED before / GREEN after).
- **Not blocked** on this axis.

## The prior blocker — re-verified resolved, not taken on faith

### 1. Base branch clean

```
$ git status --porcelain
?? intake/2026-07-28-wip-queue-page/
```

Only the untracked `intake/2026-07-28-wip-queue-page/` planning folder
remains — this build's own planning artifacts, not product code; it is not
part of any build and was left untouched. `git log -1 --oneline` on `master`
confirms `50a2800 feat(kanban): shared monitor-layout groupings with live
broadcast` is the current tip — the 18 modified tracked files and 2 untracked
files that blocked the prior pass (`ARCHITECTURE.md`, `server/db.js`,
`client/src/lib/types.ts`, `client/src/lib/api.ts`,
`client/src/pages/KanbanBoard.tsx`, `server/routes/monitors.js`,
`server/__tests__/monitors.test.js`, docs, etc.) are gone from the diff,
consistent with the claim that they're now folded into `50a2800`.

### 2. Every specific citation the prior brief flagged as unexecutable, re-checked directly against `master`'s `HEAD`

The prior BLOCKED brief's core finding was that `technical-plan.md` cited
content ("the existing `monitors_updated → MonitorLayoutPayload` line" in
`client/src/lib/types.ts`, among others) that existed only in a dirty tree,
not in any commit. Re-verified each cited anchor directly against `HEAD`:

| Citation | Plan says | Verified in `master`@`50a2800` |
|---|---|---|
| `client/src/lib/types.ts` — `monitors_updated → MonitorLayoutPayload` doc-comment line | "existing ... line" to add a doc-comment entry alongside | **Present** — `MonitorLayoutPayload` interface at line 2094, doc-comment mapping line at 2124-2125, `"monitors_updated"` in the `WSMessage.type` union at 2145, `MonitorLayoutPayload` in the `data` union at 2163. |
| `server/db.js` — cwd→project-join convention comment (~409-413) | "mirrors the documented ... convention already in `server/db.js:409-413`" | **Present** — the "no `project_id` column on sessions ... derived by joining sessions.cwd against project_paths.cwd" comment sits directly above `CREATE TABLE IF NOT EXISTS projects` (~405-413). |
| `server/db.js` — `source` column migration precedent (~977-981) | "guarded `ALTER TABLE` migration identical in shape to the existing `source` column migration" | **Present** — `ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'local'` at line 980, same guarded try/`SELECT ... LIMIT 1`/catch idiom the plan describes. |
| `server/db.js` — `renameProject` anchor (~1814) for the new `setProjectPriority` stmt | "near `renameProject`, ~:1814" | **Present** — `renameProject:` at line 1814, `getProject`/`listProjects` immediately above (1812-1813). |
| `server/routes/monitors.js` GET/PUT-full-state-broadcast pattern | "already-merged ... closest real precedent" | **Present, and now genuinely merged** — `server/routes/monitors.js` and `server/__tests__/monitors.test.js` are tracked, committed files in `50a2800`; the prior brief's "already-merged" claim, previously false, is now true. |
| `server/routes/projects.js` — `PATCH /:id` anchor (~146) for the new `PUT /reorder` route | "placed after the existing `PATCH /:id` handler" | **Present** — `PATCH /:id` at line 133, `DELETE /:id` at 151; `reorder` route lands cleanly between/after these. |
| `client/src/lib/api.ts` — `api.projects` block (~2028-2062) | anchor for the new `reorder` method | **Present** — `projects:` block starts at line 2028 with the documented `list`/`create`/`rename`/`delete`/paths/focus-report methods immediately following. |
| `KanbanBoard.tsx` — two inline cwd→project join sites (~492-493, ~707-712) | extraction targets for `projectLookup.ts` | **Present** — `sessionsByCwd` join at ~492-493 (Sessions/Agents grouping) and the Projects-view per-project `cwds` derivation at ~707-712, matching the plan's description. |
| `KanbanBoard.tsx` — native HTML5 DnD handlers (~574-627) | reuse target for the sidecar's drag reorder | **Present** — `handleColumnDragStart` (574), `handleColumnDragOver` (580), `handleColumnDragEnd` (612). |
| `server/__tests__/session-liveness.test.js`, `server/__tests__/projects.test.js` | regression-guard files the test-plan re-runs/extends | **Both present** on disk. |

**Verdict on this axis: fully resolved.** Every anchor the plan's change-set
text depends on now exists in committed history at the exact locations
described; a worktree cut from `HEAD` matches the file states the plan's own
line numbers assume.

### 3. A real, separate defect the test-plan itself already caught and corrects — not a blocker, flagged for the implementer

`test-plan.md` independently found (its own "Coverage gap being closed"
section) that `technical-plan.md` §3/§6.1 cites a `session.updated_at` field
for the queue's tertiary sort key, but `client/src/lib/types.ts`'s `Session`
interface has no `updated_at` field — only `last_activity` (confirmed:
`grep -n "last_activity" client/src/lib/types.ts` → line 39; no
`updated_at` field exists on `Session`). The test-plan's own Implementation
step 2 requires this to be corrected in `technical-plan.md` itself, before or
during the `wipQueue.ts` implementation step (step 8), not left as a silent
test-fixture workaround. This is a **build-time correction obligation for the
implementer**, already scheduled by the test-plan's own sequencing — it does
not block triage/start, since the test-plan has already designed the fix and
gates it at a specific, early implementation step.

## Repo layout

Single git repo at `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`
(confirmed: `find <root> -maxdepth 2 -name .git` finds only the root
`.git` — no nested/monorepo-wrapper repos). No `PROJECT-CONTEXT.md` exists at
the project root, so this triage proceeded in pure-generic-discovery mode.
Base/working branch: `master` (`git branch --show-current` → `master`;
`origin/master` is the tracked upstream, confirmed via `git branch -a`). This
project touches one repo trivially (itself) — no repo-selection ambiguity.

Efforts convention (reused from the immediately preceding build on this repo,
`2026-07-26-focus-calendar-board`, and independently confirmed by inspecting
the filesystem before creating anything): a shared sibling directory,
`/Users/sara/CODE-LOCAL/SARA/efforts/<slug>/<repo-name>`, one level above all
repos under `~/CODE-LOCAL/SARA/`. `ls /Users/sara/CODE-LOCAL/SARA/efforts/`
shows 13 prior effort directories, all left empty (their worktrees were
cleaned up after each build finished, consistent with normal effort
lifecycle) — none collide with this slug.

## Surfaces touched

- **Server**: `server/db.js` (guarded `priority` column migration on
  `projects`, mirroring the `source` migration; new `stmts.setProjectPriority`
  near `renameProject`), `server/routes/projects.js` (new
  `PUT /projects/reorder` — first bulk-array-order-persistence endpoint in
  this codebase, modeled on the now-merged `server/routes/monitors.js`
  GET/PUT-full-state-broadcast pattern).
- **Client — shared surface (the guardrail piece)**: new
  `client/src/lib/projectLookup.ts` (extracted cwd→project join,
  `buildCwdProjectIndex`/`projectForSession`) + refactor of
  `KanbanBoard.tsx`'s two inline join sites (~492-493, ~707-712) to use it —
  the one edit to already-shipped code in this change.
- **Client — new pure logic**: `client/src/lib/wipQueue.ts`
  (`isWipMember`/`sortWipQueue`/`assignToColumns`),
  `client/src/lib/__tests__/sessionSurfaceParity.test.ts` (durable
  cross-consumer guard, non-negotiable per plan §5).
- **Client — new UI**: `WipSessionCard.tsx` (fork, not edit —
  `SessionCard.tsx` itself gets zero diff), `WIP.tsx`,
  `WipPrioritySidecar.tsx`, nav entry (`Sidebar.tsx`), route (`App.tsx`),
  i18n keys in all four locales (`en`/`vi`/`zh`/`ko`).
- **Client — types/API**: `client/src/lib/types.ts` (`Project.priority`,
  `ProjectPriorityUpdatedPayload`, new `"project_updated"` `WSMessage`
  union entry alongside the now-real `monitors_updated` precedent),
  `client/src/lib/api.ts` (`api.projects.reorder`).
- **Docs** (per `CLAUDE.md`'s `update-project-docs` obligation):
  `docs/DATABASE.md`, `docs/API.md`, `ARCHITECTURE.md`, `README.md`
  (+CN/KO/VN), `server/README.md`, `client/README.md`, `wiki/`.

**Project-specific risk surface flagged by this project's own recurring
history** (no formal `PROJECT-CONTEXT.md` defect catalog exists for this
repo, so this is named directly from the plans' own text, informally tracked
as `DERIVED-DUAL-VIEW` in `test-plan.md` — its 4th occurrence: Focus
Calendar-only ship → `focus-report-fidelity` fix → Focus Calendar's
3rd-consumer parity test → now WIP as the 4th consumer of
`Session`/`isSessionAwaitingInput`/cwd→project derivation). Both plans
independently recommend promoting this to a formal `PROJECT-CONTEXT.md`
catalog entry after this build lands — a follow-up recommendation, not a
gate on this build.

## Durable-cure obligations (MANDATORY)

- **Extract, don't copy**: `client/src/lib/projectLookup.ts` must be the
  single canonical cwd→project join; `KanbanBoard.tsx`'s two inline join
  sites must be refactored to call it (not left in place alongside a new,
  second WIP-only join). Enforced by `projectLookup.test.ts`'s
  frozen-reference regression case (written *before* the refactor lands,
  per test-plan step 6) and by an immediate, unmodified re-run of
  `KanbanBoard.projectsView.test.tsx` right after the extraction (test-plan
  step 7) — not deferred to the end of the build.
- **Reuse, don't re-derive**: `wipQueue.sortWipQueue` must import and use
  `isSessionAwaitingInput`/`effectiveSessionStatus`/the primary-awaiting-reason
  carve-out exactly as-is — no new "is this session waiting" predicate.
- **Fork, don't edit**: `SessionCard.tsx` gets zero diff; `WipSessionCard.tsx`
  is a new wrapper component.
- **Standing structural guard, not just point tests**:
  `client/src/lib/__tests__/sessionSurfaceParity.test.ts` (`DERIVED-DUAL-VIEW`,
  informal 4th-occurrence id per test-plan.md) is non-negotiable per plan §5
  and test-plan's "Durable-cure decision" — the same durable mechanism that
  closed the prior Focus List/Calendar occurrence of this drift shape,
  applied here to the Kanban↔WIP pair. Must be authored alongside the
  `wipQueue.ts` step (test-plan step 9), not deferred to the end.
- **Plan-correction gate**: `test-plan.md` Implementation step 2 requires
  `technical-plan.md`'s tertiary-sort field reference to be corrected from
  the nonexistent `session.updated_at` to `last_activity` (fallback
  `started_at`) before or during the `wipQueue.ts` implementation step (step
  8) — this is a scheduled build-time task, not something left implicit.

## Worktree set

| Repo | Worktree path | Branch | Type | Starting commit |
|---|---|---|---|---|
| Claude-Code-Agent-Monitor | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-07-28-wip-queue-page/Claude-Code-Agent-Monitor` | `effort/2026-07-28-wip-queue-page` | new branch off `master` | `50a28004946e1505e99e9a344bba8a740f5da0c9` |

- Base branch: `master`, `HEAD` at provisioning time = `50a2800` (same commit
  as the starting commit above — the new branch was cut directly from it).
- Created via: `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor
  worktree add
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-07-28-wip-queue-page/Claude-Code-Agent-Monitor
  -b effort/2026-07-28-wip-queue-page master`.
- Verified clean immediately after creation: `git -C <worktree-path> status
  --porcelain` returned no output.
- No other repos exist under this project (single repo, confirmed above), so
  there are no "untouched repos" needing a base-HEAD-only worktree.

## Docker stack

**Not provisioned**, by deliberate choice (same call the two immediately
preceding builds on this repo made, for the same reason): `docker-compose.yml`,
`docker-compose.full.yml`, and `monitoring/docker-compose.yml` exist at the
project root/subdirectories, but they describe a **production-style
deployment** of the whole dashboard (single build context `.`, bind-mounting
the real `~/.claude/agent-dashboard` host directory, plus an optional
Prometheus/Grafana observability stack) — not a multi-service dev/test stack
this effort's verification loop touches. Both plans confirm the verification
path is `npm run test:server` / `npm run test:client` plus a manual
click-path pass against `npm run dev` in a real browser (test-plan's "How to
run" section names only npm/vitest/node --test commands; QA's own "Honest
scope limit" section confirms no browser-automation runner exists in this
repo). Nothing in either plan names a containerized dependency. If a later
step in this build does need Docker, provisioning can be revisited then.

## Effort registry

No effort registry exists for this project (no `PROJECT-CONTEXT.md` names
one) — this step is a no-op, same as the two preceding builds on this repo.

## Back-out command(s)

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-07-28-wip-queue-page/Claude-Code-Agent-Monitor \
  reset --hard 50a28004946e1505e99e9a344bba8a740f5da0c9
```

`master` itself was never touched by this triage pass (read-only
verification only) — no back-out needed there.

## Open questions

**BLOCKING:** none. The prior pass's blocking question (what to do about the
in-flight monitors feature) is resolved: it was committed to `master` as
`50a2800`, and every citation the WIP plan makes against it has been
independently re-verified against that commit's actual content, not assumed.

**Non-blocking (stated assumption, safe to proceed on):**
- Nav placement (`/wip` right after Dashboard, before `/projects`) and the
  sidecar's default-collapsed/default-scope-to-queue-projects choices are
  explicitly named in the plan as build-now defaults pending Sara's async
  confirmation — not a gate on starting the build. Assumption: proceed with
  the plan's stated defaults; note the pending confirmation in the PR
  description per the plan's own Definition of Done.
- The "project name more prominent" `WipSessionCard` visual treatment is
  explicitly a first-pass guess (no mockup exists) pending Sara's
  before/after-screenshot sign-off — same, non-blocking per the plan's own
  Definition of Done. Assumption: ship the first-pass treatment, flag it in
  the PR, don't block the rest of the build on it.
- Empty-array `PUT /projects/reorder` behavior (400 vs. documented no-op) is
  explicitly left as an implementer decision in both plans, to be picked and
  then asserted/documented consistently (test-plan Definition of Done item).
  Assumption: not a triage gate — the test-plan already schedules "pick one
  and assert it" as part of the build itself.
