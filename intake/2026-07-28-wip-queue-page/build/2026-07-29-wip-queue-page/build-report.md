# Build Report — 2026-07-28-wip-queue-page

> Authored by `build-lead`, synthesizing the build brief, task list, red/green
> evidence, and review. The document the user reads. This build **stopped at
> green** — it did not commit, push, or open a PR.

## What was built

A new top-level `/wip` page: a single, live, priority-ordered queue of
`status === "active"` session cards, sorted awaiting-input-first and then by a
new per-project `priority` (set via drag reorder in a collapsible right-hand
sidecar, `WipPrioritySidecar.tsx`), rendered as a responsive 1/2/3-column
contiguous-chunk fill driven by the queue container's own measured width
(`ResizeObserver`, not viewport breakpoints). Everything — queue membership,
sort order, priority changes from any tab — is WebSocket-live via a new
`project_updated` broadcast scoped narrowly to reorder (nothing else fires
it, confirmed by a dedicated negative test). This is the fourth independent
consumer of the `Session`/`isSessionAwaitingInput`/cwd→project-join surface
(after Kanban, Focus List, Focus Calendar), and the build's central
discipline — routing every leg of that surface through the existing shared
helpers plus one newly-extracted one, `client/src/lib/projectLookup.ts` —
was carried through end to end, not just test-covered. Server side: a guarded
`priority` column migration on `projects` (mirroring the existing `source`
migration), and a new `PUT /api/projects/reorder` endpoint (first
bulk-array-order-persistence endpoint in this codebase, modeled on the
now-merged monitors GET/PUT-full-state-broadcast pattern).

## Change verdict

**Verdict: GREEN.**

- Full suites: `npm run test:server` 1009/1009 pass; `cd client && npx vitest
  run` 658/658 pass across 48 files. Both re-confirmed independently by the
  verifier and again by the reviewer (not taken on faith).
- One build-blocking TS error was found and fixed by the verifier before
  green was declared: `noUnusedLocals` flagged an unread constructor-param
  field in a test helper class (`WIP.test.tsx`'s `FakeResizeObserver`). The
  fix removed the `private` modifier only — zero behavior/assertion change,
  confirmed by re-running the file (still 12/12) and both full suites
  afterward. This is closed, not a caveat.
- Adversarial review: **0 blockers, 0 should-fix, 1 nit** (`Project.priority`
  typed optional rather than the plan's literal required `number` — a
  deliberate, commented, low-risk narrowing; every real consumer already
  defaults it with `?? 0`).

**Durable cure — MANDATORY [DERIVED-DUAL-VIEW] (informal id; this project has
no `PROJECT-CONTEXT.md` catalog): applied, and independently re-verified by
both the verifier and the reviewer, not just test-covered.** All three
required legs held:
- **Extract, don't copy** — `projectLookup.ts` (`buildCwdProjectIndex`/
  `projectForSession`) is the single canonical cwd→project join;
  `KanbanBoard.tsx`'s two inline join sites were refactored to call it. The
  reviewer specifically checked for a leftover "second join sitting beside
  the new one" and found none — the one inline `Map` still in
  `KanbanBoard.tsx` (`sessionsByCwd`) is a genuinely different, still-needed
  cwd→sessions bucket for the Unassigned column, not a cwd→project join.
- **Fork, don't edit** — `WipSessionCard.tsx` wraps `SessionCard` unmodified;
  `git diff --stat` on `SessionCard.tsx` (against both working tree and base
  commit `50a2800`) is empty, confirmed by verifier and reviewer separately.
- **Reuse, don't re-derive** — `wipQueue.sortWipQueue` imports and calls
  `isSessionAwaitingInput`/`normalizeAwaitingReason`/`AWAITING_REASON_CONFIG`
  from `types.ts` directly; the reviewer specifically hunted for a third
  independent "is this session awaiting" or "which project owns this
  session" computation across `WIP.tsx`, `WipSessionCard.tsx`, and
  `WipPrioritySidecar.tsx` and found none (the sidecar's own
  `priority`-ordering comparator is a legitimate, plan-acknowledged third
  *priority-direction* site, not a re-derivation of awaiting-state or
  project-resolution).
- **Standing guard** — `client/src/lib/__tests__/sessionSurfaceParity.test.ts`
  was authored alongside `wipQueue.ts` (not deferred), exercises a genuinely
  non-trivial shared 9-session fixture, and both the verifier and reviewer
  read it in full to confirm it isn't vacuous.

**This is DERIVED-DUAL-VIEW's 4th occurrence on this project** (Focus
Calendar-only ship → `focus-report-fidelity` fix → Focus Calendar's
3rd-consumer parity test → now WIP as the 4th consumer). **Both pm-plan.md
and qa-assessment.md independently recommend promoting it to a formal
`PROJECT-CONTEXT.md` defect-class catalog entry now** — this project has no
such catalog configured, so this build did not create one. Carrying the
recommendation forward for a human decision: without a formal catalog entry,
this cure is still being caught by conscientious-evaluator habit each cycle,
not an enforced rule a 5th consumer would inherit automatically.

## Red → green evidence

7 new/extended spec files, all independently confirmed red-before (specific
failure reason recorded) and green-after (same test, same assertions, now
passing) by both the test-author and the verifier:

| Test | Layer | RED before | GREEN after |
|------|-------|-----------|-------------|
| `client/src/lib/__tests__/wipQueue.test.ts` | client/unit | module `../wipQueue` not found | 32/32 pass |
| `client/src/lib/__tests__/projectLookup.test.ts` | client/unit | module `../projectLookup` not found | 12/12 pass |
| `client/src/lib/__tests__/sessionSurfaceParity.test.ts` (MANDATORY guard) | client/unit (structural) | module `../wipQueue` not found | 20/20 pass |
| `client/src/components/__tests__/WipSessionCard.test.tsx` | client/component | module `../WipSessionCard` not found | 6/6 pass |
| `client/src/pages/__tests__/WIP.test.tsx` | client/page | module `../WIP` not found | 12/12 pass |
| `client/src/pages/__tests__/screens.snapshot.test.tsx` (extended) | client/snapshot | cascading collect failure (`../WIP` missing), documented precedent shape | 15/15 pass (whole file) |
| `server/__tests__/projects.test.js` (extended) | server/integration | 13 new assertions red (missing `priority` column / 404 route / broadcast timeout); 1 new negative-broadcast test legitimately green pre-implementation (correctly, not a false green) | all pass, part of full 1009/1009 server run |

Regression guards re-confirmed unmodified and green at multiple checkpoints
(not just "green by the end"): `KanbanBoard.projectsView.test.tsx` (22/22,
run immediately after the `projectLookup.ts` extraction and again at the
end), `SessionCard.test.tsx`/`SessionCard.focus.test.tsx`, and
`server/__tests__/session-liveness.test.js` — all unmodified, all green.

Full-suite totals: server 995 baseline → 1009/1009 (14 new tests, zero
regressions); client 575 baseline → 658/658 across 48 files (83 new tests,
zero regressions — the interim "561/575" red-phase dip was the expected
cascading-collect-failure shape of `screens.snapshot.test.tsx`, not a real
loss).

## Files changed

Diff against starting commit `50a28004946e1505e99e9a344bba8a740f5da0c9`, one
repo (`Claude-Code-Agent-Monitor`):

```
 ARCHITECTURE.md                                    |  17 +-
 README-CN.md                                       |   3 +-
 README-KO.md                                       |   3 +-
 README-VN.md                                       |   3 +-
 README.md                                          |   4 +-
 client/README.md                                   |   5 +
 client/src/App.tsx                                 |   3 +
 client/src/components/Sidebar.tsx                  |   5 +
 client/src/i18n/index.ts                           |   9 +
 client/src/i18n/locales/en/nav.json                |   1 +
 client/src/i18n/locales/ko/nav.json                |   1 +
 client/src/i18n/locales/vi/nav.json                |   1 +
 client/src/i18n/locales/zh/nav.json                |   1 +
 client/src/lib/api.ts                              |  12 +
 client/src/lib/types.ts                            |  31 ++-
 client/src/pages/KanbanBoard.tsx                   |  36 ++-
 .../__snapshots__/screens.snapshot.test.tsx.snap   | 172 ++++++++++++++
 .../src/pages/__tests__/screens.snapshot.test.tsx  |  15 ++
 docs/API.md                                        |  50 +++-
 docs/DATABASE.md                                   |   8 +-
 server/README.md                                   |   8 +-
 server/__tests__/projects.test.js                  | 255 ++++++++++++++++++++-
 server/db.js                                       |  15 ++
 server/routes/projects.js                          |  45 ++++
 wiki/index.html                                    |  24 +-
 25 files changed, 701 insertions(+), 26 deletions(-)
```

Plus 13 new untracked files (new modules/components/tests/i18n namespace):

```
client/src/components/WipPrioritySidecar.tsx
client/src/components/WipSessionCard.tsx
client/src/components/__tests__/WipSessionCard.test.tsx
client/src/i18n/locales/en/wip.json
client/src/i18n/locales/ko/wip.json
client/src/i18n/locales/vi/wip.json
client/src/i18n/locales/zh/wip.json
client/src/lib/__tests__/projectLookup.test.ts
client/src/lib/__tests__/sessionSurfaceParity.test.ts
client/src/lib/__tests__/wipQueue.test.ts
client/src/lib/projectLookup.ts
client/src/lib/wipQueue.ts
client/src/pages/WIP.tsx
client/src/pages/__tests__/WIP.test.tsx
```

Reviewer confirmed scope is clean: no file outside the plan's named change
set, except `client/src/i18n/index.ts` (necessary namespace-registration
wiring for the new locale files, not scope creep).

## Standing guards + Definition of Done

- [x] Each new test observed RED before, GREEN after (table above)
- [x] Full relevant suites green: server 1009/1009, client 658/658 (48 files)
- [x] `SessionCard.tsx` zero diff (verified against working tree and base
      commit, by both verifier and reviewer)
- [x] `KanbanBoard.projectsView.test.tsx` green unmodified, at both the
      immediate post-extraction checkpoint and the final regression pass
- [x] `sessionSurfaceParity.test.ts` (MANDATORY DERIVED-DUAL-VIEW guard)
      authored alongside `wipQueue.ts`, non-trivial, confirmed by reading it
      in full (not vacuous)
- [x] `WIP.test.tsx` has two independently-named removal-path tests
      (`session_updated` status-flip vs. `session_deleted`) — not collapsed
- [x] Empty-array `PUT /reorder` behavior decided (400) and asserted in both
      the route and `docs/API.md`
- [x] `project_updated` broadcast scope is genuinely priority-only — one
      call site (`server/routes/projects.js:189`), backed by a dedicated
      negative test across the other five project mutation types
- [x] Build/typecheck clean (`npx tsc -b`, `npm run build`) — after the
      verifier's one-line fix
- [x] File-header audit passes (`check-headers.sh` exit 0)
- [x] i18n keys present in all four locales (`en`/`vi`/`zh`/`ko`)
- [x] Docs updated together (`docs/DATABASE.md`, `docs/API.md`,
      `ARCHITECTURE.md`, README + CN/KO/VN, `server/README.md`,
      `client/README.md`, `wiki/`) — spot-checked against actual shipped
      shapes, no drift found
- [ ] **Manual, real-browser visual/interactive verification pass** (resize-
      with-sidecar-open column-fill, live drag reorder, cross-tab update) —
      **not performed by anyone in this build.** Non-blocking caveat #1
      below.
- [ ] Nav placement / sidecar defaults / prominence treatment shown to Sara
      for sign-off — explicitly async/non-blocking per both plans, not a DoD
      gate; nav entry placed per the plan's stated default (right after
      Dashboard), first-pass prominence treatment shipped as agreed.

## Worktree & stack

- **Worktree path:**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-07-28-wip-queue-page/Claude-Code-Agent-Monitor`
  (branch `effort/2026-07-28-wip-queue-page`, off `master`@`50a2800`) — this
  is the only touched repo; review/commit happens here, not against the
  shared `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor` checkout.
- **Docker stack:** none provisioned for this effort (deliberate — the
  repo's compose files describe a production-style single-service deployment
  bind-mounting the real dashboard host directory, not a dev/test stack this
  build's verification touches; both plans confirmed verification is
  `npm run test:server` / `npm run test:client` plus manual `npm run dev`).
  The verifier did stand up a throwaway second server instance
  (`DASHBOARD_DB_PATH` override + non-default port) for live API/WS checks,
  and tore it down immediately after — nothing persists to poke at.

## Residual risk & back-out

**Two honest, non-blocking caveats, both already surfaced by the verifier
and independently re-confirmed (not newly discovered, not dropped) by the
reviewer:**

1. **Real-browser manual click-through was not performed by anyone** — not
   the implementer, not the verifier. This is a genuine tooling gap in this
   repo/environment, not a corner someone cut: this repo has no
   Playwright/Cypress/browser-automation runner (confirmed by the test-plan's
   own "honest scope limit"), and the verifier's own automation context has
   no working screen-capture (`screencapture` fails — no capturable display)
   or browser-automation tool either. The verifier did open the page in real
   Chrome via a safe throwaway-DB instance and proved every *API/WS-level*
   behavior (reorder round-trip, broadcast shape, priority persistence) live,
   but could not observe or interact with the rendered page — specifically,
   the resize-with-sidecar-open column-fill behavior (1/2/3 columns) and live
   drag-reorder/cross-tab visual behavior remain unverified by human or
   automated eyes. **Recommend Sara run the manual script herself** (build-
   task-list Task 33, or just `npm run dev` + `/wip`) before merging, since
   this is the one thing in the plan's own Definition of Done that
   genuinely isn't met.
2. **Untested residual risk: rapid WS-event-burst sort-thrash.** `WIP.tsx`
   does a client-derived local merge with no debounce on re-sort (a
   deliberate, tests-satisfying deviation from the plan's Risks section
   suggestion of "the same debounce Kanban uses" — investigated and found
   not to map cleanly, since Kanban's debounce guards a full refetch, not a
   local re-sort). React 18 batches same-tick updates, but separately-
   delivered WS `message` events in different ticks are NOT batched — no
   test in this change exercises multiple quick-succession awaiting-flip
   events to prove or disprove visible reorder thrash under a real burst.
   **Neither plan's DoD requires this**, so it does not block green, but
   it's a real, named gap worth a follow-up (either add a debounce, or add a
   burst test proving batching is sufficient) before this page sees heavy
   concurrent multi-session traffic.

**Back-out command:**
```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-07-28-wip-queue-page/Claude-Code-Agent-Monitor \
  reset --hard 50a28004946e1505e99e9a344bba8a740f5da0c9
```
`master` itself was never touched — no back-out needed there.

## Open decisions

- **DERIVED-DUAL-VIEW catalog promotion — PENDING, human decision.** Both
  `pm-plan.md` and `qa-assessment.md` recommend formalizing this pattern
  (now at its 4th occurrence) into a `PROJECT-CONTEXT.md` defect-class
  catalog entry, so a 5th consumer of `Session`/project-derivation logic
  inherits an enforced rule instead of relying on each cycle's evaluators
  independently re-discovering the same cure. This build did not create
  `PROJECT-CONTEXT.md` (not authorized to invent that unasked) — flagging it
  here for Sara to decide. Also still open project-wide even after this
  build: the pre-existing Kanban↔Focus List/Focus Calendar parity gap is
  untouched by this change (only the Kanban↔WIP pair got a parity guard this
  cycle).
- Nav placement (`/wip` after Dashboard) and the sidecar's default-collapsed
  scoping were shipped on the plan's stated build-now defaults, pending
  Sara's async confirmation — non-blocking per both plans' own DoD.
- The `WipSessionCard` "project name more prominent" visual treatment was
  shipped as an explicit first-pass guess (no mockup existed) pending Sara's
  before/after sign-off — non-blocking per both plans' own DoD.

## Next step

Stops at green. **The user commits / pushes / opens a PR — or hands it back
for changes.** This skill does not commit. It does not tear down the
worktree or Docker stack (none was provisioned for this effort) — those stay
live until whoever merges runs the manual teardown.
