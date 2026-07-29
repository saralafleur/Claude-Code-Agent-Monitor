# QA Assessment — wip-queue-page

> Authored by `qa-strategist`. **This is the document the user reads first.** It
> answers: is the change adequately tested, where are the gaps, have we shipped
> this *class* of gap before, and how do we stop it.

## Change summary
This is a pre-build technical plan (no code exists yet) for a new top-level
**WIP** page: a single, live, priority-ordered queue of active-only session
cards, sorted awaiting-input-first then by a new per-project `priority` value
Sara sets via drag-and-drop in a collapsible sidecar, laid out in a
responsive 1/2/3-column priority-fill driven by the queue container's own
measured width. It is the **fourth independent consumer** of the shared
`Session`/`isSessionAwaitingInput`/`effectiveSessionStatus`/cwd→project
derivation surface (after Kanban, Focus List, Focus Calendar), and it
includes one real edit to already-shipped, tested code: extracting
Kanban's inline cwd→project join into a shared `projectLookup.ts` that both
Kanban and WIP will consume. This assessment evaluates the **proposed** test
plan (unit-tests.md + e2e-tests.md), not a built artifact — the question is
whether that proposal, if built exactly as specified, would actually guard
this change's real risks.

## Coverage verdict
**GAPPED**

Not BLIND: this project has a named, three-times-fired recurring failure
mode — informally tracked as **DERIVED-DUAL-VIEW** in this project's own QA
run-log (round-4 Focus Calendar-only fix → `focus-report-fidelity` closing
the Focus List/Calendar gap → `focus-calendar-board` adding a 3rd consumer
with a parity test), and for once, the proposed plan attacks it head-on and
well: `sessionSurfaceParity.test.ts` uses one shared fixture set (not two
independently-authored ones), derives its primary-awaiting-reason coverage
programmatically from `AWAITING_REASON_CONFIG` (so a future reason is
auto-covered), and includes adversarial fixtures (trailing-slash/case cwd
mismatch, null cwd) specifically aimed at the reverse-join risk. This is
materially stronger design than most of what this run-log has seen for this
failure class elsewhere — a real, structural countermeasure, not a
happy-path assertion. It would not ship BLIND against its own #1 risk.

Not ADEQUATE either, for two concrete reasons that keep it at GAPPED:

1. **`technical-plan.md` itself still specifies a field that does not
   exist.** §3/§6.1 names `sortWipQueue`'s tertiary sort key as
   `session.updated_at`. There is no `updated_at` on the client `Session`
   interface (`client/src/lib/types.ts:662-716`) — the only recency field is
   `last_activity` (a server-computed join alias,
   `server/routes/sessions.js:173/227`), and every existing consumer already
   reads `last_activity`, never `.updated_at`. The unit-test architect caught
   this and designed `wipQueue.test.ts` around `last_activity` — but that is
   a correction buried in a test-design doc's grounding note, not a
   correction applied to the plan the build team will actually read and
   implement from. **This must be fixed in `technical-plan.md` before or
   during build, not treated as a nice-to-have** — if an implementer builds
   from the plan literally, either (a) `Session.updated_at` ships as an
   always-`undefined` field silently breaking the tertiary sort for every
   queue member simultaneously (recency tiebreak becomes arbitrary), or (b)
   the fixtures in `wipQueue.test.ts` get quietly rewritten to match the
   wrong field name during implementation, at which point the test would
   agree with the bug instead of catching it — the same "test shares the
   bug's own assumption" shape risk.md names for the separate
   priority-direction risk.
2. **The single highest-risk visual case in this plan (sidecar-shrinks-
   container column-fill) has no tooling path to real proof in this repo.**
   e2e-tests.md is honest about this: no Playwright/Cypress exists, jsdom has
   no layout engine, and the fake-`ResizeObserver` wiring test in
   `WIP.test.tsx` proves the page reads container width instead of viewport
   width — it cannot prove the sidecar actually shrinks the container by a
   real number of pixels crossing the real 768/1024 threshold in a real
   browser. This is a genuine, disclosed tooling gap (not a scoping
   shortcut), mitigated only by the plan's own manual-verification step.
   That's an acceptable mitigation for a first ship, but it means this one
   surface stays UNGUARDED by any automated test regardless of how well the
   rest of the suite is built.

Once must-fix #1 is applied and the must-add-now tests below actually land
as specified, this change would be safe to ship — the plan's structural
answer to this project's recurring drift shape is genuinely one of the
better-designed instances of it seen across this run-log.

## Current coverage
Baseline (actually re-run by the cartographer against the current working
tree, which includes uncommitted monitor-groups work): **995/995 server
tests green**, **575/575 full client tests green** (55/55 on the four
directly-relevant files). Fully clean starting point.

By surface, today (before any WIP code exists):
- **Shared awaiting predicates** (`isSessionAwaitingInput`/
  `effectiveSessionStatus`/`sessionAwaitingReason`) — PARTIAL. No dedicated
  unit test pins their contract directly; they're exercised only indirectly
  through `SessionCard.test.tsx`'s border-color assertions. `effectiveSessionStatus`
  has no isolated coverage at all today.
- **Kanban's cwd→project join** (`KanbanBoard.projectsView.test.tsx`, 22
  tests) — GUARDED for column placement / Unassigned fallback; PARTIAL on
  trailing-slash/cwd-normalization edge cases (no fixture exercises a
  near-miss cwd string) — this is exactly the edge the reverse-join
  extraction risks landing on differently.
- **`SessionCard.tsx`** (19 tests across two files) — GUARDED as it exists
  today; not yet applicable to the not-yet-built `WipSessionCard.tsx`.
- **`projects` table/routes** — UNGUARDED for `priority` and
  `PUT /reorder`, correctly so (neither exists yet); this is the literal
  punch list for the plan's server test additions.
- **Cross-consumer parity (Kanban vs Focus List vs Focus Calendar vs WIP)**
  — UNGUARDED anywhere in the current suite, for any pair of consumers,
  today. This is this project's #1 recurring drift shape and the single
  clearest gap in the map, independent of WIP.
- **WS broadcast-content assertions** — repo-wide convention gap: no server
  test in this codebase opens a real WebSocket client to verify a broadcast
  frame; `PUT /api/monitors`'s own precedent test only checks the HTTP
  response. (The WIP plan's own e2e design closes this specific instance —
  see below.)

## Gaps & test-debt diagnosis

**UNGUARDED surfaces this change lands on, and the systemic reason each exists:**

1. **Cross-consumer derivation drift (DERIVED-DUAL-VIEW).** Systemic cause:
   this codebase has no enforced rule that a new consumer of `Session`/
   `SessionCard`/project-derivation logic must reuse the existing predicate/
   join and add a cross-consumer identity test — it is currently
   re-discovered and re-applied ad hoc, cycle by cycle, by conscientious
   evaluators (pm-plan.md says this explicitly: "it has held twice in a row
   so far; it is not yet guaranteed to hold the fourth time"). The proposed
   `sessionSurfaceParity.test.ts` is a real structural fix for *this*
   instance, but it does not retroactively close the still-open Kanban↔Focus
   List/Calendar gap, and nothing prevents a 5th consumer from skipping the
   discipline again unless it becomes a written rule rather than a habit.
2. **Reverse-join parity (`projectLookup.projectForSession` vs. Kanban's
   forward `sessionsByCwd` join).** Systemic cause: the extraction is not a
   verbatim lift — it inverts the join direction — so "extracted, therefore
   equivalent" is an assumption, not a fact, until proven per-fixture. The
   proposed frozen-reference regression test in `projectLookup.test.ts`
   (comparing against a comment-dated snapshot of the pre-refactor inline
   join) is the right mechanism and is well-specified, including the
   trailing-slash/empty-paths edge cases risk.md names.
3. **Live-membership on two independent removal paths.** Systemic cause:
   `isWipMember` is one predicate, but `session_updated`-status-flip and
   `session_deleted` are two structurally distinct WS events with no shared
   test forcing both to be wired — a build that only handles the more common
   path (completion) would look fully correct in casual/manual testing.
   Correctly specified as two independently-named test cases in
   `WIP.test.tsx` per the plan; the risk is this getting silently collapsed
   into one "removal" test under implementation time pressure, since it
   wouldn't cause a visible failure until a session is explicitly deleted
   while still active.
4. **`technical-plan.md`'s `session.updated_at` reference.** Systemic
   cause: the plan cites a field name on a typed interface by hand, with no
   mechanical cross-check against the actual `Session` type — the same root
   cause seen across this run-log's other projects as "hand-maintained
   field/schema references silently drift from the artifact they describe."
   Here it was caught before build only because the unit-test architect
   independently grepped `types.ts` — nothing makes that check mandatory or
   repeatable for the next plan.
5. **Real-browser container-width breakpoint proof.** Systemic cause: this
   repo has no browser-level e2e tooling at all (no Playwright/Cypress); the
   gap is infrastructural, not a design choice on this feature's part, and
   is honestly disclosed rather than silently assumed away.

**Have we shipped this class of gap before?** Yes — DERIVED-DUAL-VIEW has
fired **3 times** in this project already, all within the last two days
(round-4 Focus Calendar-only ship → `focus-report-fidelity` 2026-07-26 →
`focus-calendar-board` 2026-07-26, per this project's own QA run-log; no
formal `PROJECT-CONTEXT.md` catalog exists to assign it a catalog id, so
it's tracked as PM-established standing discipline). WIP is the 4th
consumer and the 4th cycle this pattern has been in play. If
`sessionSurfaceParity.test.ts` ships thin, happy-path-only, or gets
deferred/dropped under time pressure, that would not be a fresh gap — it
would be a **regression of the exact discipline** the prior two fixes
established, one surface later, and should be escalated with that weight.
Separately worth noting as a positive: this run-log has repeatedly found
(laundryroom-alerts, todo-ios-app, rule-manager-v2, coaching-web-portal)
that a risk analyst's required assertion fails to mechanically land in the
test-design docs. That did **not** happen here — every P0/P1 item risk.md
named (both removal paths, reverse-join parity, priority-direction, the
project-name-prominence non-blocker) is explicitly present in
unit-tests.md/e2e-tests.md. That's a genuinely good sign for this cycle,
not something to take for granted going forward.

## Recommendation

**Must-add-now (gates this change), worst-first:**
1. **Fix `technical-plan.md` §3/§6.1**: replace `session.updated_at` with
   `last_activity` (fallback `started_at`) — a plan correction, not a test,
   and it must happen before implementation starts so the build team isn't
   working from a spec citing a nonexistent field.
2. **`WIP.test.tsx`**: two independently-named test cases for the two
   removal signals (`session_updated` status-flip, `session_deleted`) — do
   not allow these to collapse into one "removal" test.
3. **`sessionSurfaceParity.test.ts`**: author alongside step 5 (once
   `wipQueue.ts` exists), not deferred to step 9; must include the
   adversarial fixtures (mixed-case/trailing-slash cwd, null cwd) and the
   registry-derived primary-reason loop, not just the happy-path list in
   technical-plan.md §5's bullets.
4. **`projectLookup.test.ts`**'s frozen-reference regression test — written
   *before* the `KanbanBoard.tsx` refactor lands, comparing against a
   comment-dated snapshot of the current inline join, over a fixture set
   that includes a trailing-slash cwd and a zero-path project.
5. **Priority-direction**: the named-example unit test ("priority 0 above
   priority 1") plus a rendered-output assertion of the sidecar's *initial,
   undragged* display order — this third site isn't reachable by
   `wipQueue.test.ts`'s pure-function coverage at all.
6. **`KanbanBoard.projectsView.test.tsx`** must be run and confirmed green
   immediately after the extraction step, and again at the end — honor the
   plan's own sequencing rather than treating "green by the end" as
   sufficient.
7. **Server**: the negative broadcast-scope test (no `project_updated` on
   rename/path-add/path-remove/delete) and the real-`ws`-client assertion
   for the reorder broadcast (e2e-tests.md §2a) — the latter also happens to
   close, for this one endpoint, a repo-wide "broadcast trusted by
   convention only" gap that every prior broadcast feature in this repo
   still has.
8. **Empty-array reorder behavior**: pick 400 (as designed) or the
   documented no-op, and assert whichever is actually implemented — don't
   let the suite and the implementation quietly agree on an undocumented
   choice that diverges from `docs/API.md`.

**Durable cure (stops the whole class, not just this instance):**
- The plan's own mechanism — extract-not-copy (`projectLookup.ts`) + a
  registry-derived, shared-fixture cross-consumer parity test
  (`sessionSurfaceParity.test.ts`) — *is* the correct durable cure for
  DERIVED-DUAL-VIEW, and it's well-executed here. What's still missing is
  making it a **written, enforced rule** rather than a habit four
  conscientious evaluators happened to converge on independently again this
  cycle. Recommend promoting DERIVED-DUAL-VIEW to a formal
  `PROJECT-CONTEXT.md` defect-class catalog entry now, at its 4th
  occurrence — so a 5th consumer (the next page that touches `Session`/
  project derivation) inherits an enforced check, not a repeat of ad hoc
  vigilance holding by luck.
- Separately, for the `session.updated_at`/field-drift gap: adopt a
  lightweight practice that any field name a technical plan cites on a typed
  interface gets grep-verified against the real interface before the plan
  is circulated for build — exactly what the unit-test architect did ad hoc
  here, but nothing currently makes that check mandatory for the next plan.
- For the real-browser breakpoint gap: no durable *test* cure exists without
  adding browser e2e tooling (Playwright/Cypress) to this repo — that's a
  larger infrastructure decision outside this feature's scope. Until then,
  treat the manual verification step as a required, standing mitigation for
  this one surface, not a one-time formality.

**Is this safe to ship once the must-adds are in?** Yes, with the plan
correction (must-add #1) applied first. This is a well-designed plan for its
riskiest, most recurrence-prone surface; the remaining gaps are narrow and
named, not systemic blind spots in the plan's own thinking.

## Open decisions for the user
- [ ] Apply the `technical-plan.md` `session.updated_at` → `last_activity`
      correction now, before build starts (recommended), vs. leaving it for
      the build team to discover via the test-design doc's grounding note.
- [ ] Commit the in-flight, uncommitted `monitors.js`/monitor-groups changes
      as their own change set before WIP's build begins (change-brief's own
      recommendation), so the `KanbanBoard.tsx` refactor and its regression
      test run land on a clean, stable base rather than a second uncommitted
      feature's diff.
- [ ] Decide `PUT /api/projects/reorder`'s empty-array behavior (400 vs.
      documented no-op) — QA's design defaults to 400 for convention
      consistency; needs an actual build-time decision, not just a test-side
      guess.
- [ ] Accept the real-browser sidecar-container-width breakpoint gap as
      manual-verification-only for this cycle, or treat it as the trigger to
      evaluate adding Playwright/Cypress to this repo (a separate,
      larger-scope decision, not a blocker for shipping WIP).
- [ ] Promote DERIVED-DUAL-VIEW to a formal `PROJECT-CONTEXT.md` catalog
      entry now that it has fired 3 times pre-WIP (4 times counting this
      change), so future consumers of `Session`/project-derivation logic
      inherit a written rule instead of relying on evaluator diligence each
      cycle.

---
*Memory updated:* qa-run-log.md ✅ (global fallback — no `PROJECT-CONTEXT.md`
configured for this repo) · no project-specific defect catalog exists to
update; DERIVED-DUAL-VIEW remains an informal, run-log-tracked pattern name
only.
