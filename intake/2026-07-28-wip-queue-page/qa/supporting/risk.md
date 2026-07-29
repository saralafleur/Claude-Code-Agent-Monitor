# Risk & Regression Analysis — WIP queue page (pre-build)

> Authored by `risk-analyst`. Grounded in `qa/change-brief.md`,
> `technical-plan.md`, `pm-plan.md`, and direct inspection of the current
> code (`client/src/pages/KanbanBoard.tsx`, `client/src/lib/types.ts`,
> `client/src/lib/projectOrder.ts`, `server/routes/projects.js`,
> `server/routes/monitors.js`, `server/index.js`, `server/routes/sessions.js`,
> `server/routes/hooks.js`).

No `PROJECT-CONTEXT.md`/defect-class catalog exists for this repo. Per the
task's binding framing, `pm-plan.md`'s own recurrence diagnosis is treated as
the catalog substitute for this cycle: WIP is the fourth independent
consumer of the shared `Session`/`isSessionAwaitingInput`/cwd-project-join
surface, the exact "one surface, many consumers, drift without a shared
helper" shape that produced `focus-report-fidelity` (fixed via DEC-1..6
extract-not-copy + a standing cross-view parity test) two days ago. That
diagnosis is cited throughout below in place of catalog ids.

## 1. Blast radius

Beyond the literal new files, this change touches:

- **`KanbanBoard.tsx`'s Projects-view pipeline** (`sessionsByCwd` at
  `~:492-499`, feeding `projectColumns`' `cwds.flatMap(...)` at `~:707-730`).
  This is Kanban's **only** existing consumer of cwd→session/project
  grouping — it is not, as the change-brief's file-inventory loosely implies,
  used by the Sessions/Agents view toggles at all (`sessionsByCwd` has
  exactly one call site, line 724, inside the Projects-view-only column
  builder). Refactoring this is lower blast-radius than "three view modes"
  suggests, but the pipeline itself is subtler than a simple lookup: it's a
  **forward** join (project → its mapped cwds → matching sessions via a
  `Map<cwd, Session[]>`), built with **exact-string** `cwd` matching (no
  trim/case/trailing-slash normalization anywhere in the current code).
  `projectLookup.ts` needs a **reverse** join (`projectForSession(session,
  index)`, session → project) to serve `wipQueue.sortWipQueue`'s tiebreak.
  Writing a reverse-direction function and asserting it is behaviorally
  identical to the existing forward one is a bigger claim than "extracted
  the existing code verbatim" — it's closer to "invented new code that must
  reproduce the existing code's edge-case behavior," including:
  - Sessions with `cwd: null`/`""` (Kanban's loop explicitly does
    `if (!s.cwd) continue`) — `projectForSession` must return `undefined`
    the same way, not throw or coerce.
  - Two projects should never map the same cwd (server enforces this via
    `ALREADY_MAPPED` on `POST`/path-add), but nothing in the extracted client
    helper re-validates that invariant — if it's ever violated server-side,
    `buildCwdProjectIndex` and Kanban's per-project `cwds.flatMap` could
    silently disagree on which project "wins" for a given cwd (last-write в map vs. whichever project column iterates second).
- **`server/routes/projects.js`** — shared with the standalone Projects
  page and Kanban's Projects view (`GET /`, `POST /`, `PATCH /:id`, path
  add/remove, `DELETE /:id`). The new `PUT /reorder` sits in this same
  router; a validation bug here (e.g. accepting a partial project-id list,
  silently leaving unlisted projects' `priority` untouched vs. explicitly
  intending that) affects every reader of `GET /api/projects`, not just WIP.
- **`server/db.js`** — the `projects` table migration path is shared
  infrastructure; the guarded `ALTER TABLE` idiom this plan copies
  (`SELECT priority FROM projects LIMIT 1` / catch / `ALTER TABLE`) is the
  same pattern the existing `source` column uses, so a mistake here (e.g.
  omitting `NOT NULL DEFAULT 0`) would surface as `undefined`/`null`
  priorities silently breaking sort in **every** priority-consuming call
  site (WIP's sort, the sidecar's initial order) simultaneously.
- **`client/src/lib/types.ts`'s `WSMessage` union** — a single shared
  discriminated union consumed by every page's `eventBus` handler
  (`Dashboard.tsx`, `KanbanBoard.tsx`, `WIP.tsx`, Focus surfaces, etc.).
  Adding `"project_updated"` is additive/safe in principle, but any existing
  `switch`/`if` handling `WSMessage` that isn't written as exhaustive
  (missing a `default` no-op) is a latent site where a new message type
  could hit an unhandled-case bug that a static type system wouldn't catch
  at runtime — worth a sweep, not just trusting "additive == safe."
- **`client/src/lib/projectOrder.ts`** — untouched, but now a **second,
  competing "project order" concept** exists side by side with the new
  server-persisted `priority`: Kanban's Projects-view column order remains
  per-browser `localStorage` (`projectOrder.ts`), while WIP's tiebreak order
  and sidecar display order are the new server-synced, cross-tab-live
  `priority` field. These are conceptually adjacent ("how are my projects
  ordered") but mechanically and semantically distinct, and nothing unifies
  or even cross-references them. This isn't a code defect the plan
  introduces — it's a **product-surface fork** the plan explicitly declines
  to resolve (change-brief confirms this is "changed only for WIP, not
  touched elsewhere"). Flagging it here because it's exactly the kind of
  thing that reads as "two features, working as designed, individually
  green" but produces a support-burden-shaped "why did my project order
  change in one place but not the other" report from Sara later.
- **`SessionCard.tsx`** — explicitly zero-diff per the plan, so its existing
  consumers (Kanban, and whatever else renders it) have zero blast radius
  from this change *if and only if* `WipSessionCard.tsx` truly wraps rather
  than forks-and-diverges from its props/behavior contract (e.g. if
  `WipSessionCard` needs a session prop shape `SessionCard` doesn't already
  accept, that's a sign the "wrap, don't edit" boundary is leaking).

## 2. Invariants that must hold

No formal catalog id exists; per the task framing, `pm-plan.md`'s
recurrence diagnosis is treated as binding, and the general invariant
classes below are mapped against it explicitly.

- **Consistency across paths** (= `pm-plan.md`'s recurrence-diagnosis
  pattern, cited as this project's #1 recurring drift shape). Two
  concrete pairs must agree, not just "look similar":
  1. WIP's "awaiting" partition (via `sortWipQueue`, consuming
     `isSessionAwaitingInput`/`sessionAwaitingReason` as-is) vs. Kanban's
     own primary-awaiting-reason-aware bucketing (`isPrimaryAwaitingReason`
     in `KanbanBoard.tsx`) — for every fixture session, not just the happy
     path. This is exactly what `sessionSurfaceParity.test.ts` is specified
     to assert; its absence or a weak fixture set is the single biggest
     residual risk in this plan.
  2. `projectLookup.projectForSession` (reverse join) vs. Kanban's
     `sessionsByCwd` + `project.paths` (forward join) — must resolve to the
     *same* project for every fixture session, including the edge cases in
     §1 above (null/empty cwd, a cwd matching zero projects → "unassigned").
- **Priority-direction convention integrity** (named explicitly as a top
  risk in both `pm-plan.md` §"auto-decided defaults" and
  `technical-plan.md` §7): `priority` is dense-rank, **lower = higher**,
  default `0`. Three independent places must agree on direction, not just
  on the number `0` as a default:
  - DB default (`INTEGER NOT NULL DEFAULT 0`, migration).
  - `sortWipQueue`'s comparator (`ascending` on `priority` — a sign flip
    here silently inverts the whole queue while every unit test that only
    checks "lower number sorts first among two arbitrary values" could
    still pass if the test itself also encodes the same inverted
    assumption).
  - `WipPrioritySidecar`'s **initial, undragged** display order — this is
    the one place the plan itself flags as a distinct third site (not just
    "the sort function and the DB"), because it's read directly from
    `project.priority` before any local reordering, and a bug here would
    only surface visually, not through `wipQueue.test.ts`'s pure-function
    coverage at all.
- **Completeness across a registry/enum** — the i18n rollout
  (`nav:wip` + `wip.json` across `en/vi/zh/ko`) is exactly this invariant
  class: four locales are a small, closed enumeration, and shipping three
  is a silent, easy-to-miss gap (a raw key or English fallback leaking into
  a non-English locale) unless a test or lint step enumerates all four and
  fails on any missing key.
- **Isolation across variants** — `WipSessionCard.tsx` forking instead of
  editing `SessionCard.tsx` is this project's chosen mechanism for
  variant isolation (per `pm-plan.md`'s explicit override of the
  architect's additive-prop recommendation). The invariant to pin: WIP's
  card changes must be provably zero-diff against Kanban's `SessionCard`
  render output — i.e. `SessionCard.test.tsx`/`SessionCard.focus.test.tsx`
  passing unmodified is the actual assertion, not just "we didn't touch the
  file" by inspection.
- **Round-trip integrity** — a dragged `priority` must survive: (a) the
  `PUT /reorder` write, (b) a full page refresh (server round-trip through
  `GET /api/projects`), and (c) a second open tab receiving `project_updated`
  without re-fetching. Additionally: every **pre-existing** project must
  read back `priority: 0` post-migration with no error — this is a
  round-trip invariant on the migration itself, not just the new endpoint.
- **No-leak at boundaries** — the narrowly-scoped `project_updated`
  broadcast (`{ projects: [{ id, priority }] }` only) is a deliberate,
  documented exception to "project mutations are plain CRUD, not
  broadcast." The boundary-leak risk here is inverted from the usual
  shape: it's not "something internal leaks out," it's "the scope of what's
  broadcast quietly widens" — i.e. some other project mutation (rename,
  path add/remove, delete) starts riding the same broadcast channel by
  accident (e.g. a future edit to `PATCH /:id` that reuses the reorder
  route's broadcast helper for convenience) and the documented carve-out in
  `docs/DATABASE.md` becomes silently false.

## 3. Recurring-issue mapping

No formal catalog exists, so per the task's binding framing this section
maps directly onto `pm-plan.md`'s recurrence diagnosis rather than catalog
ids:

- **This change touches a surface this project has already bled on.** The
  `focus-report-fidelity` incident (2026-07-26, `missed-requirement`) was
  exactly "fixed one consumer [Focus Calendar], not the other [Focus
  List]" of a shared data/render surface, with no shared helper and no
  cross-view test to catch drift — closed via DEC-2/DEC-3 (extract-not-copy
  + standing cross-view test). WIP is the *next* consumer of an adjacent
  but analogous shared surface (`Session`/`isSessionAwaitingInput`/cwd-
  project join), and the plan explicitly names this as the same shape "one
  consumer later." This is not a hypothetical analogy — it is the stated
  reason `technical-plan.md` §5 exists at all.
- **This is a live/recurring surface, not a closed thread.** `pm-plan.md`
  itself verifies (via git log) that iteration on the Focus fidelity area
  has continued through the present day (`b3a2cc9` → `ed23878` → `b930824`
  → `0d5fbe7`). Treat the underlying "shared surface, multiple consumers"
  risk as **ongoing/WATCH**, not resolved-and-done, even though the
  specific Focus List/Calendar instance of it was fixed.
- **Regression-of-the-fix risk, specifically:** the durable fix from that
  incident was "extract a shared helper + add a standing cross-consumer
  test." If WIP's build skips or weakens `sessionSurfaceParity.test.ts` (or
  writes it against a thin/happy-path-only fixture set), that is not a
  new, independent gap — it is a **regression of the exact discipline**
  the prior incident's fix established, one surface over. This should be
  escalated with the same weight as reopening a RESOLVED defect would be
  on a project with a formal catalog: the mechanism (shared surface, no
  enforced parity check) is identical, only the specific fields
  (`priority`/awaiting-partition vs. `wall_ms`/`active_ms`/chunks) differ.
- **Second-order version of the same shape, inside this change itself:**
  the `KanbanBoard.tsx` refactor is simultaneously (a) the *fix* for a
  future drift (extracting the join so a 5th consumer doesn't re-derive it
  again) and (b) a *new* regression-of-a-different-kind risk in its own
  right — if the extraction subtly changes Kanban's existing behavior (see
  §1's forward-vs-reverse-join point), it would be introducing exactly the
  kind of "one surface, quietly different behavior in one of its
  consumers" defect this whole plan exists to prevent, via the mechanism
  meant to prevent it. `KanbanBoard.projectsView.test.tsx` passing
  unmodified is the only thing standing between "clean extraction" and
  "silent Kanban regression," which is why technical-plan.md step 4
  correctly sequences that test run immediately after the extraction
  rather than at the end.

## 4. "Ships green but broken" traps

Each is a concrete mistake that would pass `npm run test:server && npm run
test:client` as currently planned, and the specific assertion that closes
it:

1. **Reverse-join direction drift (highest-risk, specific to this change).**
   `projectLookup.projectForSession` is new code, not a lift of existing
   code (see §1) — it could implement subtly different matching (e.g.
   normalizing trailing slashes, or picking the first vs. last project when
   two `project_paths` rows improperly share a cwd) than Kanban's `cwds
   .flatMap(cwd => sessionsByCwd.get(cwd))`, and every planned test
   (`projectLookup.test.ts`'s own fixtures, `wipQueue.test.ts`'s fixtures)
   could still pass because they're self-consistent, testing the new code
   against itself rather than against Kanban's actual resolution for the
   *same* input. **Required assertion:** `sessionSurfaceParity.test.ts`
   must include at least one adversarial fixture — a cwd with mixed
   casing/trailing slash relative to its `project_paths` row, and a session
   with `cwd: null` — not just the clean happy-path fixtures already listed
   in technical-plan.md §5's bullet list.
2. **Priority direction sign-flip caught by tests that share the bug's own
   assumption.** If `sortWipQueue`'s comparator and its own unit test both
   independently get the direction backwards (an easy mistake — "lower
   priority number" is a naturally ambiguous phrase), the test still passes
   green. **Required assertion:** a test that pins the *concrete* rule
   against an explicit, named example ("project priority 0 must appear
   above project priority 1 in the queue," not just "priorities sort") —
   and separately, a rendered-output check (not just a pure-function unit
   test) that the sidecar's *initial undragged* display order matches that
   same direction, since that's a third site the pure-function tests don't
   reach at all.
3. **Live-membership: only one removal path gets wired, the other looks
   covered by inference.** `isWipMember(session)` (`status === "active"`)
   is a single predicate, but there are **two structurally distinct WS
   events** that can remove a session from the queue: `session_updated`
   with a flipped `status` (confirmed as the actual mechanism for
   completion/abandonment — `server/routes/hooks.js`'s many
   `broadcast("session_updated", ...)` calls after status changes) vs.
   `session_deleted` (a **separate** event, only fired from
   `server/routes/sessions.js`'s `DELETE /:id` route, carrying only `{ id
   }` — no `status` field at all). A merge handler that only re-filters on
   `session_updated` and doesn't separately remove-by-id on
   `session_deleted` (or vice versa) would pass any test that only exercises
   one path, and would look correct in every manual check that happens to
   end sessions via completion rather than explicit deletion (the more
   common case). **Required assertion:** `WIP.test.tsx` must include two
   independently-named test cases for the two removal signals (already
   specified in technical-plan.md §6.4/Engineer's gotcha #2 — the trap is
   this getting silently collapsed into one "removal" test during
   implementation under time pressure, since both currently produce the
   same visible outcome).
4. **Column-fill algorithm: correct on fabricated unit-test inputs, wrong
   at real breakpoints.** `assignToColumns` is a pure function and easy to
   over-test with clean, evenly-divisible inputs (e.g. 6 items / 2 columns)
   while never exercising the actual `ResizeObserver`-driven width
   thresholds (`<768` / `768–1023` / `≥1024`) with the sidecar open (which
   shrinks the queue's content width independent of the window) — a
   viewport-vs-container-width bug is invisible to any test that mocks
   `ResizeObserver` with a fixed value. **Required assertion:** at least one
   `WIP.test.tsx`/manual-script case with the sidecar expanded at a
   viewport width that would give 3 columns by viewport alone but only 2 by
   actual container width — this is explicitly why `pm-plan.md` picked
   container-width over viewport-width, and it's exactly the case a lazy
   test suite would skip.
5. **"Project name more prominent" satisfied by two visibly different,
   both-technically-compliant implementations.** No mockup exists (flagged
   explicitly by PO and PM as the single highest-risk-of-mismatch
   acceptance criterion). A test asserting only "a project-name element
   renders and has *some* different className/weight than base
   `SessionCard`" would pass green for practically any visual treatment,
   including one Sara considers wrong on sign-off. This is not closable by
   a stronger unit test — it's closable only by the plan's own named gate
   (before/after screenshot, explicit async sign-off) — but the risk is
   real:  do not let a passing snapshot test substitute for that sign-off,
   since `screens.snapshot.test.tsx`'s new `"WIP"` case will happily
   baseline *whatever* was first implemented and then "pass" on every
   subsequent run regardless of whether it matches what Sara actually
   wants.
6. **Broadcast scope creep on `project_updated`.** Nothing currently stops
   a future (or even this) change from also broadcasting `project_updated`
   (or reusing its handler) on `PATCH /:id` (rename) or path add/remove,
   quietly widening the documented carve-out. **Required assertion:**
   an explicit **negative** test — rename a project via `PATCH /:id` and
   assert *no* WS broadcast fires — not just a positive test that reorder
   *does* broadcast. Positive-only coverage here is the textbook
   ships-green-but-broken gap: the carve-out silently widens and every
   existing test keeps passing because none of them assert absence.
7. **Reorder endpoint's empty-array/partial-array behavior left
   ambiguous.** The plan explicitly says "pick one [empty-array behavior]
   and assert it" — if the implementation and its own test agree on an
   undocumented choice that diverges from `docs/API.md`, the suite is green
   but the documented contract is wrong from day one. Same risk, less
   obviously, for a *partial* array (fewer ids than existing projects): the
   plan's route only touches ids present in `order`, leaving unlisted
   projects' `priority` untouched — reasonable, but untested by the
   currently-listed happy-path/404/400 cases, and a client that assumes
   "reorder always covers all projects" would silently misbehave.

## 5. Severity & priority

Ranked worst-first (user-visible / data-integrity / contractually-implied
by the plan's own DoD, vs. cosmetic):

1. **P0 — Live-membership on both removal paths (§4.3).** User-visible,
   directly contradicts the page's core promise ("no refresh, ever"); a
   stuck completed/deleted session sitting in the "who needs me" queue is
   the single worst outcome this feature could ship, since it actively
   misleads Sara about what's still active.
2. **P0 — Reverse cwd→project join parity with Kanban (§4.1) /
   `sessionSurfaceParity.test.ts` strength.** Silent data-attribution
   errors (wrong project's priority applied to a session, or Kanban's
   Projects view silently regressing) are the exact recurrence class this
   whole plan cycle exists to prevent; this is also the item most likely to
   be quietly weakened under implementation time pressure since it's the
   most abstract requirement to test well.
3. **P1 — Priority-direction convention (§2, §4.2).** Silent, plausible,
   easy to ship inverted; affects every session in the queue at once
   (systemic, not a one-off), but is at least visually obvious once someone
   looks at the sidecar, unlike the join-parity risk.
4. **P1 — `KanbanBoard.projectsView.test.tsx` regression from the
   extraction (§1, §3).** Would break already-shipped, daily-use behavior
   (Kanban's Projects view) as a side effect of a feature Sara didn't even
   ask to change — highest "why did this break, I didn't touch that"
   support cost of anything on this list.
5. **P2 — Broadcast scope creep (§4.6) / round-trip on migration (§2).**
   Lower immediate user-visibility (would surface as a documentation/API
   contract violation or a future maintenance trap), but cheap to close
   with a single negative test now vs. expensive to unwind once other code
   starts depending on the widened behavior.
6. **P2 — Column-fill container-width fidelity (§4.4).** Real but
   contained to visual layout at one specific interaction (resize with
   sidecar open); degrades gracefully (worst case is a suboptimal column
   count, not lost/wrong data).
7. **P3 — i18n completeness across 4 locales (§2).** Mechanical and
   easy to lint/enumerate; low severity individually but a real
   "ships green but incomplete" gap if the four-locale rollout isn't
   checked as a set.
8. **P3 — "Project name more prominent" mismatch (§4.5) and the two-orders
   product-fork (§1's `projectOrder.ts` vs. `priority` point).** Real, but
   explicitly non-blocking per the plan's own framing (design sign-off
   pending; dual-order UX is a disclosed tradeoff) — track, don't gate the
   build on either.
