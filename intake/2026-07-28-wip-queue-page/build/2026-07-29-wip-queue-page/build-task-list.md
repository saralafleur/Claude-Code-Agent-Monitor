# Build Task List — 2026-07-28-wip-queue-page

> Authored by `build-planner`, merging `technical-plan.md` (what to change)
> and `qa/test-plan.md` (what to prove) into ONE ordered, dependency-correct
> sequence. The implementer follows this top to bottom, test-first. Do not
> re-read the original investigation — everything needed is here.

**Worktree (use these paths for every task below, not the shared repo
checkout):** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-07-28-wip-queue-page/Claude-Code-Agent-Monitor`
(branch `effort/2026-07-28-wip-queue-page`, off `master`@`50a28004946e1505e99e9a344bba8a740f5da0c9`).
All file paths below are relative to this worktree root. No Docker stack for
this effort (see build-brief.md's "Docker stack" section) — verification is
`npm run test:server` / `npm run test:client` plus a manual `npm run dev`
pass; there is no live-service port block to reference.

Back-out if needed: `git -C <worktree> reset --hard 50a28004946e1505e99e9a344bba8a740f5da0c9`.

---

## Build order (dependency-correct, red-first)

> Tests that prove a change come BEFORE the change they guard. `[test]` =
> author a failing test; `[impl]` = product code; `MANDATORY [DERIVED-DUAL-VIEW]`
> = durable cure — this project has no formal `PROJECT-CONTEXT.md` catalog,
> so `DERIVED-DUAL-VIEW` is the informal id both `pm-plan.md`/`qa-assessment.md`
> already use for this recurring "independent consumers silently disagree"
> pattern (4th occurrence: Focus Calendar-only ship → focus-report-fidelity
> fix → Focus Calendar's 3rd-consumer parity test → now WIP). Treat it with
> the same gating weight a formal catalog id would carry.

| # | Task | Type | Layer | File(s) | Done-check |
|---|------|------|-------|---------|------------|
| 0 | Establish clean baseline before touching anything. | test | server+client | — | `npm run test:server && npm run test:client` green (expected 995/995 server, 575/575 client per QA's cartographer count). If not green, **stop and report** — do not build on a dirty baseline. |
| 1 | **Correct `technical-plan.md`'s tertiary-sort field reference** — replace every `session.updated_at (fallback started_at)` citation (§3 "Client — pure sort/layout logic", §6.1) with `last_activity (fallback started_at)`. `Session.updated_at` does not exist (`client/src/lib/types.ts` — only `last_activity` at line 698); this must be a correction to the plan document itself, not a silent test-fixture workaround, per test-plan.md Implementation step 2. | impl (doc) | docs/plan | `intake/2026-07-28-wip-queue-page/technical-plan.md` | Grep confirms zero remaining `session.updated_at`/`session\.updated_at` occurrences in the file; `last_activity (fallback started_at)` appears in its place. **Gate: must land before or during Task 11 (`wipQueue.ts`) — do not defer.** |
| 2 | Schema migration: guarded `priority` column on `projects`. | impl | server/DB | `server/db.js` (new guarded block placed immediately after the `source` column migration at line 980, same try/`SELECT ... LIMIT 1`/catch idiom) | Red-first: `db.prepare("SELECT priority FROM projects LIMIT 1").get()` throws today. After: boot server against dev DB, `GET /api/projects` echoes `priority: 0` for every existing row, no error. |
| 3 | `stmts.setProjectPriority`. | impl | server/DB | `server/db.js` (near `renameProject`, line 1814) — `db.prepare("UPDATE projects SET priority = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")` | Statement compiles at server boot (no SQLite prepare error). |
| 4 | Server test: migration/default coverage — fresh project reads `priority: 0`; directly-inserted pre-migration-style row reads `priority: 0` with no error; re-invoking the migration guard a second time doesn't throw/duplicate the column (mirrors the `source`-column idempotency proof). | test | server/integration | `server/__tests__/projects.test.js` (extend existing file) | Red-first: fails today (`priority` column doesn't exist). Green after Task 2. Run: `node --test server/__tests__/projects.test.js`. |
| 5 | `PUT /api/projects/reorder` route — body `{ order: string[] }`, dense ranks `0..N-1` in one `db.transaction` (mirrors `POST /` transaction at ~122-125), placed after the existing `PATCH /:id` handler (line 133). Validation: non-empty string array; every id resolves via `stmts.getProject` else `404 NOT_FOUND` naming the missing id; duplicate ids → `400 INVALID_INPUT`; empty array → **pick one behavior (400 or documented no-op) and implement it explicitly** — do not leave this ambiguous. Respond `{ projects: [{ id, priority }] }`, then `broadcast("project_updated", { projects: [...] })`. | impl | server/API | `server/routes/projects.js` | Manual `curl`/Postman round-trip confirms shape before any client code depends on it (per technical-plan.md step 2's explicit gate). |
| 6 | Server test: `PUT /reorder` happy path (dense ranks match array order, exact response shape, follow-up `GET /api/projects` reflects same values — DB round-trip not just PUT echo; re-reordering fully replaces ranks; omitted project keeps prior priority — "partial reorder," distinct from unknown-id 404) + validation cases (unknown id 404, duplicate id 400, non-array 400, non-string entry 400, empty array — assert whichever Task 5 actually implements). | test | server/integration | `server/__tests__/projects.test.js` | Red-first: route 404s today (Express default handler). Green after Task 5. `node --test server/__tests__/projects.test.js`. |
| 7 | Server test: real `ws` client receives exactly one `project_updated` message shaped `{ projects: [{ id, priority }] }` after a successful reorder (use a `put` helper copied from `monitors.test.js`'s `put`). **Negative test**: attach the same kind of `ws` client, then `POST /` / `PATCH /:id` / `POST /:id/paths` / `DELETE /:id/paths/:id` / `DELETE /:id` — assert no `project_updated` fires for any of them. | test | server/integration | `server/__tests__/projects.test.js` | Red-first: no `project_updated` broadcast exists anywhere before Task 5. Green after. Closes the repo-wide "broadcast trusted by convention only" gap for this one endpoint. |
| 8 | Regression re-run: `server/__tests__/session-liveness.test.js` unmodified — confirms the `session_updated`-status-flip / separate-`session_deleted` broadcast contract WIP's client removal logic (Task 26) will depend on hasn't shifted. | test | server/integration | `server/__tests__/session-liveness.test.js` (no edits) | `node --test server/__tests__/session-liveness.test.js` green, unmodified. |
| 9 | Client types/API client — `Project.priority: number` (doc-commented, on the `Project` interface), new `ProjectPriorityUpdatedPayload { projects: Array<{ id: string; priority: number }> }`, `"project_updated"` added to `WSMessage`'s `type` union (line ~2145) and `ProjectPriorityUpdatedPayload` added to the `data` union (line ~2163), doc-comment mapping entry alongside the existing `monitors_updated → MonitorLayoutPayload` line (~2124-2125). | impl | client/types | `client/src/lib/types.ts` | `npx tsc --noEmit` (or `npm run build` in `client/`) compiles clean. **Hard dependency gate: do not start Task 12+ against a guessed shape.** |
| 10 | `api.projects.reorder(order: string[])` — `PUT /projects/reorder`, mirrors the `api.projects` block style (~line 2028). | impl | client/API | `client/src/lib/api.ts` | Type-checks against Task 9's shape; matches Task 5's request/response contract exactly. |
| 11 | **Write `projectLookup.test.ts`'s frozen-reference regression case FIRST**, before the `KanbanBoard.tsx` refactor lands. Verbatim-copy the current inline join (`sessionsByCwd` at `KanbanBoard.tsx` ~492-493; Projects-view `cwds` derivation at ~700-712) into the test file as a comment-dated reference function (`oldWay`), against a shared ≥5-session/≥3-project fixture including one unmapped cwd, one zero-`paths` project, one trailing-slash cwd. | test | client/unit | `client/src/lib/__tests__/projectLookup.test.ts` | Red-first note: at this point the test passes trivially (both "ways" are the same code) — expected, not a false pass; becomes meaningful once Task 12 exists. Run: `cd client && npx vitest run src/lib/__tests__/projectLookup.test.ts`. |
| 12 | Extract `client/src/lib/projectLookup.ts` — `buildCwdProjectIndex(projects): Map<string, Project>`, `projectForSession(session, index): Project \| undefined`. **Refactor `KanbanBoard.tsx`'s two inline join sites (~492-493, ~700-712) to import and use it** — do not leave the inline join in place alongside a second WIP-only version. | impl | client/lib (shared) | `client/src/lib/projectLookup.ts` (new), `client/src/pages/KanbanBoard.tsx` (edit) | See Task 13 (immediate regression run) and Task 14 (rest of `projectLookup.test.ts`) — both must pass. |
| 13 | **Run `KanbanBoard.projectsView.test.tsx` immediately after Task 12, before writing anything WIP-specific.** Not optional, not satisfiable by "green by the end of the build." | test | client/component | `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx` (no edits) | `cd client && npx vitest run src/pages/__tests__/KanbanBoard.projectsView.test.tsx` passes unmodified. If it fails, the extraction changed Kanban's behavior — fix `projectLookup.ts`, do not edit this test to make it pass. |
| 14 | Rest of `projectLookup.test.ts` — direct `buildCwdProjectIndex`/`projectForSession` cases (every mapped cwd resolves reference-equal; unmapped cwd absent from map not `undefined`-valued; zero-`paths` project doesn't throw; `undefined` for `cwd: null`; `undefined` for unmapped cwd) + confirm Task 11's frozen-reference case now compares two genuinely independent implementations and still passes. | test | client/unit | `client/src/lib/__tests__/projectLookup.test.ts` | Red-first: fails at import until Task 12's module exists. Green after. If Task 11's frozen-reference case fails here, the extraction changed behavior — fix `projectLookup.ts`, not the reference copy. |
| 15 | `SessionCard.test.tsx`/`SessionCard.focus.test.tsx` regression re-run (unmodified) — proves the `projectLookup` extraction and `KanbanBoard.tsx` edit left the shared card exactly as it was. | test | client/component | `client/src/components/__tests__/SessionCard.test.tsx`, `SessionCard.focus.test.tsx` (no edits) | `cd client && npx vitest run src/components/__tests__/SessionCard.test.tsx src/components/__tests__/SessionCard.focus.test.tsx` green, unmodified. |
| 16 | `client/src/lib/wipQueue.ts` — `isWipMember(session): boolean` (`status === "active"`, single membership definition). `sortWipQueue(sessions, projectIndex): Session[]` — primary `isSessionAwaitingInput` (imported as-is, line 806) descending, applying the same primary-awaiting-reason carve-out Kanban already uses (`AWAITING_REASON_CONFIG`-derived, not a hand-typed list); secondary `projectForSession(...)?.priority ?? 0` ascending; tertiary **`last_activity` (fallback `started_at`)** descending (per Task 1's correction — do not use `updated_at`). `assignToColumns<T>(sortedItems, columnCount: 1\|2\|3): T[][]` — contiguous-chunk fill, col 1 gets first `Math.ceil(n/columnCount)` items. Pure, no DOM. | impl | client/lib (pure) | `client/src/lib/wipQueue.ts` (new) | See Task 17 (unit tests). This is the cheapest place to pin the tertiary-sort and priority-direction decisions as executable spec — must happen before any React page exists. |
| 17 | `wipQueue.test.ts` — `isWipMember` (active member, completed/error/abandoned non-member, awaiting-flag doesn't affect membership). `sortWipQueue`: awaiting-first regardless of priority; primary-awaiting-reason carve-out excludes `subagent`/`shell`/`monitor`, keeps `notification`/`stop`/`session_start`/`interrupted` in the awaiting bucket (loop derived from `AWAITING_REASON_CONFIG`, not hand-typed); **named-example**: "project priority 0 ranks above priority 1"; unmapped cwd falls back to priority `0` (not `Infinity`); tertiary is `last_activity` descending, fallback `started_at`; non-`active` session never surfaces in output. `assignToColumns`: exact boundary table as its own named `it(...)` each — 0/3, 1/1, 1/3, 2/3, 4/1, 4/2, 5/2, 5/3, 6/3, 7/3 — plus "column 1's first item is always the top-sorted item" (rejects a round-robin-but-plausible wrong implementation). | test | client/unit | `client/src/lib/__tests__/wipQueue.test.ts` (new) | Red-first: fails at import until Task 16 exists; the carve-out and priority-direction named-example cases specifically fail against a plausible-but-wrong implementation (re-derived "awaiting" logic, naive priority-first comparator). `cd client && npx vitest run src/lib/__tests__/wipQueue.test.ts`. |
| 18 | **`MANDATORY [DERIVED-DUAL-VIEW]` — author `sessionSurfaceParity.test.ts` now, alongside Task 16/17, not deferred to the end.** One shared ≥8-session fixture (not two independently-authored sets) covering every non-primary and every primary awaiting reason (both derived from `AWAITING_REASON_CONFIG`), a plain active non-awaiting session, and a session whose cwd maps to no project. Assertion (a): WIP's awaiting-bucket boolean matches Kanban's own primary-awaiting-reason-aware bucketing for every fixture session (per-session failure message naming session id + reason). Assertion (b): `projectLookup.projectForSession` resolves to the same project id Kanban's own (now-shared, post-Task-12) call resolves to, for every session, plus a non-vacuity check (at least one resolved project defined, at least one `undefined`) so it can't pass trivially on an all-`undefined` fixture bug. | test | client/unit (structural guard) | `client/src/lib/__tests__/sessionSurfaceParity.test.ts` (new) | Red-first: fails today because `wipQueue.ts`/`projectLookup.ts` don't exist yet at build start; once Tasks 12+16 land, it specifically fails if `sortWipQueue` ever re-derives "awaiting" instead of reusing `isSessionAwaitingInput`/`sessionAwaitingReason` as-is. This is the standing guard against `DERIVED-DUAL-VIEW` recurring a 5th time — **non-negotiable, gates Definition of Done.** `cd client && npx vitest run src/lib/__tests__/sessionSurfaceParity.test.ts`. |
| 19 | `WipSessionCard.tsx` — wraps `<SessionCard>` imported **unmodified** from `client/src/components/SessionCard.tsx`, layering a visually-prominent project-name header using `projectForSession`'s lookup. `SessionCard.tsx` itself receives zero edits. Can run in parallel with Tasks 16-18 once Task 12's lookup helper exists. Note in the PR: prominence treatment is a first-pass guess (no mockup), needs Sara's before/after-screenshot sign-off — ship, don't block the rest of the build on it. | impl | client/component (fork, not edit) | `client/src/components/WipSessionCard.tsx` (new) | See Task 20. `git diff` on `SessionCard.tsx` must be empty at the end of the build (checked again at Task 34). |
| 20 | `WipSessionCard.test.tsx` — renders project name prominently in a distinct, assertable wrapper element when `cwd` resolves to a project; renders an explicit "no project" state when it doesn't; reuses real `SessionCard` (not mocked), asserting the same badge/waiting-reason text `SessionCard.test.tsx`/`SessionCard.focus.test.tsx` already assert (proof the fork composes, not reimplements); forwards click/nav behavior identically to bare `SessionCard`. Do **not** assert a specific className/font-weight — only assert presence of a distinct project-name element. | test | client/component | `client/src/components/__tests__/WipSessionCard.test.tsx` (new) | Red-first: fails at import until Task 19 exists; project-name/"no project" cases discriminate a component that never wired `projectForSession` from one wired backwards. `cd client && npx vitest run src/components/__tests__/WipSessionCard.test.tsx`. |
| 21 | `client/src/pages/WIP.tsx` — fetch `api.sessions.list({ status: "active", limit: 500 })` + `api.projects.list()` once on mount; subscribe via `eventBus` (same pattern as `KanbanBoard.tsx` ~425-462) to `session_created`, `session_updated`, `session_deleted`, `project_updated`; merge into local state (`!isWipMember` filter-out, remove-by-id on `session_deleted`, patch `priority` in place on `project_updated`); ~300ms debounce before recompute (same window Kanban already uses, to avoid visible reorder thrash under WS bursts); measure own queue container via `ResizeObserver` (pattern from `Dashboard.tsx`/`CcConfig.tsx`/`Sidebar.tsx`); `useMemo` → `assignToColumns(sortWipQueue(...), columnCount)`; render N `flex flex-col` columns of `<WipSessionCard>`. | impl | client/page | `client/src/pages/WIP.tsx` (new) | Depends on Tasks 9, 10, 16, 19. Verified by Task 26 (`WIP.test.tsx`) and Task 28 (snapshot). |
| 22 | Sidebar nav entry — add to `NAV_KEYS` (currently lines 98-100, right after `nav:dashboard`, before `nav:projects`): `{ to: "/wip", icon: <pick an unused lucide icon>, key: "nav:wip" }`, with an inline comment matching this file's existing convention noting placement is a build-now default pending Sara's confirm. | impl | client/nav | `client/src/components/Sidebar.tsx` | Verified by Task 28's screens.snapshot before/after diff review (Task 28) and manual load of `/wip` from the sidebar. |
| 23 | Route wiring — `import { WIP } from "./pages/WIP";` (alongside the other page imports, ~line 77) and `<Route path="wip" element={<WIP />} />`, placed to match nav order (right after Dashboard's implicit `/` route, before `projects`). | impl | client/routing | `client/src/App.tsx` | `npm run dev`, navigate to `/wip`, page renders with no route-not-found fallback. |
| 24 | i18n — add `nav:wip` to all four locale `nav.json` files in the same change (not just `en`), plus new `{en,vi,zh,ko}/wip.json` namespace for page-specific strings, following the existing per-page namespace convention (`SessionCard.tsx`'s `useTranslation(["kanban","plan"])` pattern). | impl | client/i18n | `client/src/i18n/locales/{en,vi,zh,ko}/nav.json`, `client/src/i18n/locales/{en,vi,zh,ko}/wip.json` (new) | All four locale dirs have both keys; no missing-translation console warning when loading `/wip` under any locale switch in dev. |
| 25 | `WipPrioritySidecar.tsx` — collapsible right-hand panel, collapsed by default, listing queue-represented projects by default with a "show all projects" toggle (both PM auto-decided defaults), native HTML5 DnD copied from `KanbanBoard.tsx`'s `handleColumnDragStart`/`DragOver`/`DragEnd` (lines 574/580/612), committing on drop via `api.projects.reorder(...)`. Wire into `WIP.tsx` (Task 21). | impl | client/component | `client/src/components/WipPrioritySidecar.tsx` (new) | Verified by Task 26's sidecar-DnD and initial-order cases. |
| 26 | `WIP.test.tsx` — mount real `WIP` page with **mocked `api`** but the **real, un-mocked `eventBus` singleton** (the `SessionCard.focus.test.tsx`/`Tabby.test.tsx` publish-then-assert pattern — NOT the no-op `eventBus` mock in `screens.snapshot.test.tsx`/`KanbanBoard.projectsView.test.tsx`, which cannot drive publish-then-assert). Cases, each independently named: (1) `session_created` (active, non-awaiting) → correctly sorted position. (2) `session_updated` setting `awaiting_input_since` → live-reorders to top of priority tier, no re-fetch (assert mock call counts unchanged). (3) **`session_updated` flipping `status` off `"active"` → card removed immediately, no re-fetch** — its own named test. (4) **`session_deleted` → card removed immediately, no re-fetch** — its own independently-named test, must NOT be collapsed into (3): both currently produce the same visible outcome, which is exactly why a lazy single test could pass while only one WS handler is actually wired. (5) `project_updated` with new priority order (no session event) → queue tiebreak changes live. (6) Sidecar drag commit (`dragStart`/`dragOver`/`dragEnd`, no `dataTransfer` mock needed, same shape as `KanbanBoard.projectsView.test.tsx`'s monitor-box drag) → `api.projects.reorder` called with expected id order. (7) **Sidecar's initial, undragged display order** — project `priority: 0` renders above `priority: 1` pre-drag (third priority-direction site, not reachable by `wipQueue.test.ts`'s pure coverage). (8) Reload round-trip: after drag commits, unmount/remount against mocked list data reflecting post-drag priorities → new order renders, proving persistence isn't optimistic-only. (9) Column-fill wiring only (fake `ResizeObserver`): firing container observer at 1200/900/500px → 3/2/1 columns, `window.innerWidth` untouched; a bare `window resize` event with no observer callback fires no change — proves container width, not viewport, drives it. Exhaustive fill-math stays in `wipQueue.test.ts` (Task 17), not repeated here. | test | client/page | `client/src/pages/__tests__/WIP.test.tsx` (new) | Red-first: fails at import until Tasks 21+25 exist. Cases (3)/(4) specifically: an implementation wiring only one of the two WS event handlers passes the other's setup but fails its own removal assertion. `cd client && npx vitest run src/pages/__tests__/WIP.test.tsx`. |
| 27 | Server: extend `projects.test.js` — this is a re-confirmation checkpoint, not new work; Tasks 4/6/7/8 already cover the server surface. Skip if already green; otherwise fix regressions before proceeding. | test | server/integration | `server/__tests__/projects.test.js` | `npm run test:server` full suite green. |
| 28 | `screens.snapshot.test.tsx` — add `it("WIP", ...)` following the file's own `FocusCalendarBoard` precedent (mocked API incl. `priority`/`api.projects.reorder`, no-op `eventBus`, empty fixtures; `ResizeObserver` already globally stubbed in this file), placed right after the `"Dashboard"` case to mirror sidebar nav order. **Run the full snapshot suite before AND after Task 22's `Sidebar.tsx` nav-entry change**; review (never blindly `-u`) any diff in other screens' snapshots that render sidebar chrome. | test | client/snapshot | `client/src/pages/__tests__/screens.snapshot.test.tsx` (extend) | `cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx` — new `"WIP"` case passes; any sidebar-chrome diff in other cases has been manually reviewed (not `-u`'d blind) before accepting. |
| 29 | `KanbanBoard.projectsView.test.tsx` — **second, final regression confirmation** (distinct from Task 13's immediate post-extraction run). | test | client/component | `client/src/pages/__tests__/KanbanBoard.projectsView.test.tsx` (no edits) | `cd client && npx vitest run src/pages/__tests__/KanbanBoard.projectsView.test.tsx` green, unmodified. |
| 30 | `SessionCard.test.tsx`/`SessionCard.focus.test.tsx` — final regression re-run (distinct from Task 15). | test | client/component | same files, no edits | `cd client && npx vitest run src/components/__tests__/SessionCard.test.tsx src/components/__tests__/SessionCard.focus.test.tsx` green, unmodified. |
| 31 | `server/__tests__/session-liveness.test.js` — final regression re-run (distinct from Task 8). | test | server/integration | no edits | `node --test server/__tests__/session-liveness.test.js` green, unmodified. |
| 32 | Full suite confirmation. | test | server+client | — | `npm run test:server && npm run test:client` fully green. |
| 33 | Manual verification (`npm run dev`) — seed ≥4 active sessions across ≥2 differently-prioritized projects (≥2 awaiting input), plus one terminal-state session that must not appear. Confirm membership, awaiting-first sort, priority tiebreak, column-count/fill at each breakpoint **including with the sidecar open** (the one place a viewport-only trigger would silently misbehave — this is the only mitigation for the accepted jsdom-has-no-layout-engine gap), live sidecar drag reorder in the same tab and a second open tab, live removal on session end/abandon with no refresh. | manual | client/e2e-equivalent | — (`npm run dev`) | Script completed once, no step skipped; resize-with-sidecar-open specifically exercised. This is required, not a nice-to-have — it is the only proof of the real-browser column-fill breakpoint behavior (no Playwright/Cypress exists in this repo). |
| 34 | `SessionCard.tsx` zero-diff confirmation. | verify | client/component | `client/src/components/SessionCard.tsx` | `git diff --stat client/src/components/SessionCard.tsx` (against this effort's base commit `50a2800`) shows no output. |
| 35 | Docs sync — `docs/DATABASE.md` (`projects` columns table: add `priority` row; update "no WebSocket broadcast" line to the explicit carve-out: "`priority` changes broadcast `project_updated`; all other project mutations remain plain CRUD, not broadcast"), `docs/API.md` (new `PUT /api/projects/reorder` section alongside existing `/api/projects/*` block), `ARCHITECTURE.md`, `README.md` (+CN/KO/VN), `server/README.md`, `client/README.md`, `wiki/` — new nav entry, new DB column, new WS message type. Apply per this repo's `update-project-docs` skill/convention (CLAUDE.md obligation) and `.claude/rules/docs-markdown.md` (executable command examples, rooted paths, all affected docs together). | impl (docs) | docs | `docs/DATABASE.md`, `docs/API.md`, `ARCHITECTURE.md`, `README.md`, `README-CN.md`, `README-KO.md`, `README-VN.md`, `server/README.md`, `client/README.md`, `wiki/` | Docs describe the final route shape/DB column/WS message exactly (do this last, once Tasks 2-25 are final facts, not moving targets). |
| 36 | File-header audit. | verify | repo-wide | every new file from Tasks 2-26 (`.js/.ts/.tsx`) | `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0 — every new file (`WIP.tsx`, `WipSessionCard.tsx`, `WipPrioritySidecar.tsx`, `wipQueue.ts`, `projectLookup.ts`, and every new `*.test.ts(x)`) carries the header + `@author Son Nguyen <hoangson091104@gmail.com>` line. |

---

## Mandatory durable-cure tasks

- **#18 — `client/src/lib/__tests__/sessionSurfaceParity.test.ts`**
  `MANDATORY [DERIVED-DUAL-VIEW]` — this project has no formal
  `PROJECT-CONTEXT.md` defect catalog, so `DERIVED-DUAL-VIEW` is the informal
  id both `pm-plan.md` and `qa-assessment.md` already assign to this
  project's recurring "multiple independent consumers of the
  `Session`/`isSessionAwaitingInput`/cwd→project surface silently disagree"
  pattern — this is its 4th occurrence (Focus Calendar-only ship →
  `focus-report-fidelity` fix → Focus Calendar's 3rd-consumer parity test →
  now WIP as the 4th consumer). This is structural, not a point-fix: it is a
  standing, registry-derived, shared-fixture cross-consumer test that will
  keep catching drift on every future edit to either Kanban's or WIP's
  awaiting-partition/project-resolution logic, not a one-time code-review
  observation. Both `technical-plan.md` §5 and `test-plan.md`'s
  "Durable-cure decision" section independently name it non-negotiable.
  **Both plans chose the structural cure here — there is no point-fix
  shortcut to flag as an open decision for this occurrence.**
- **#11/#12/#14 — `projectLookup.ts` extraction + frozen-reference regression
  test** `MANDATORY [DERIVED-DUAL-VIEW]` (same informal id, the
  extract-not-copy half of the cure) — `KanbanBoard.tsx`'s two inline
  cwd→project join sites must be refactored to call the new shared
  `projectLookup.ts`, not left in place alongside a second, WIP-only join.
  Enforced two ways, not by inspection: the frozen-reference regression case
  (#11/#14) and the immediate, unmodified `KanbanBoard.projectsView.test.tsx`
  re-run (#13) right after the extraction.
- **Open decision surfaced, not silently encoded:** neither plan chose a
  point-fix over `DERIVED-DUAL-VIEW`'s structural cure for this
  consumer-pair — both plans are explicit that this is the correct answer
  for Kanban↔WIP. What both plans *do* leave open, and this task list
  surfaces rather than resolves: `DERIVED-DUAL-VIEW` remains **only
  partially closed project-wide** even after this build — the pre-existing
  Kanban↔Focus List/Focus Calendar parity gap is untouched by this change,
  and there is still no formal `PROJECT-CONTEXT.md` catalog entry for the
  pattern (both plans recommend creating one at this, its 4th occurrence, as
  a non-blocking follow-up). Flag this in the PR description; it is not a
  gate on this build.
- **#1 — plan-correction gate (`session.updated_at` → `last_activity`)** —
  not a `DERIVED-DUAL-VIEW` instance, but its own mandatory gate per
  `test-plan.md` Implementation step 2: must land before or during Task 16
  (`wipQueue.ts`), not left implicit or silently fixed only in test
  fixtures.

## Sequencing notes

- **Single sequential implementer — do not parallelize across the numbered
  list.** Two narrow exceptions the plan itself calls out: Task 19
  (`WipSessionCard.tsx`) may start in parallel with Tasks 16-18 once Task 12
  (`projectLookup.ts`) lands; nothing else in this list is safe to
  interleave, because Tasks 9→10→12→16→18→21→25→26 form one dependency
  chain (types → API client → shared join → pure sort/columns → parity
  guard → page → sidecar → page tests) and several tasks edit the same
  files in sequence (`KanbanBoard.tsx` at Task 12, `Sidebar.tsx`/`App.tsx`
  at Tasks 22/23, `screens.snapshot.test.tsx` at Task 28 needs Task 22's
  nav change to exist first for its before/after diff review to mean
  anything).
- **Hard gates — do not skip ahead of these:**
  - Task 1 (plan correction) before Task 16 (`wipQueue.ts` implementation).
  - Task 9 (types/API client) before any of Tasks 12+ — "do not start against
    a guessed shape" per technical-plan.md step 3.
  - Task 11 (frozen-reference test) authored **before** Task 12 (the
    refactor itself) — writing it after the refactor defeats its purpose.
  - Task 13 (Kanban regression run) **immediately** after Task 12 — not
    deferred to "green by the end of the build."
  - Task 18 (`sessionSurfaceParity.test.ts`) authored alongside Tasks
    16-17, not deferred to the end — this is the point QA calls out
    explicitly as a common implementation-pressure failure mode (writing it
    last, as an afterthought, defeats its role as a standing guard rather
    than a final checkbox).
- **Needs services up vs. pure unit-level:** Tasks 0, 4, 6, 7, 8, 27, 31, 32
  (server) need a real (throwaway, per-test) SQLite DB and, for Task 7, a
  real `ws` WebSocket client against the running test server — this is this
  repo's existing `server/__tests__/*.test.js` pattern (real HTTP + real
  SQLite, no separate service to boot). Task 33 (manual verification) needs
  `npm run dev` running against the effort's own dev DB. Everything else
  (Tasks 1-3, 9-26 except 26's `WIP.test.tsx` which uses jsdom + mocked
  `api`, 28-30, 34-36) is pure unit/component-level — no live service
  required. There is no Docker stack for this effort and no port block to
  reference (see build-brief.md's "Docker stack" section — deliberately not
  provisioned; this feature's verification never touches it).
- **Stop-and-report triggers (plan-is-wrong conditions — escalate, don't
  improvise):**
  - Task 13 or Task 29 (`KanbanBoard.projectsView.test.tsx`) fails after the
    `projectLookup.ts` extraction — this means the extraction changed
    Kanban's real behavior; fix `projectLookup.ts` to match the frozen
    reference, do not edit the Kanban test to accept new behavior.
  - Task 18 (`sessionSurfaceParity.test.ts`) fails after `wipQueue.ts`/
    `projectLookup.ts` exist — this means WIP's logic has drifted from
    Kanban's; fix the drift, do not adjust the parity test's fixtures to
    paper over it.
  - Task 5's empty-array `PUT /reorder` behavior is undecided at
    implementation time — pick one (400 or no-op) explicitly, assert it in
    Task 6, and document it in Task 35's `docs/API.md` update; do not ship
    an implicit, untested choice.
  - Any point in the build where `WipSessionCard.tsx` (Task 19) is found
    computing its own cwd→project resolution instead of calling
    `projectForSession` — this is a `DERIVED-DUAL-VIEW` regression in
    progress; stop and route it through `projectLookup.ts` before continuing.
