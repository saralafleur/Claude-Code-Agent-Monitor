# Green Evidence — 2026-08-03-plan-lifecycle-workbench-ui

Captured on the effort worktree
(`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor`)
after fixing the 3 failing cases the build-implementer left behind and closing
the two gaps (TS strictness, F3 premise) found while finishing the build.

## Full client suite

```
$ npm run test:client
 Test Files  60 passed (60)
      Tests  782 passed (782)
```

773 pre-existing + 9 new (F1: 7, F2: 1, F3: 1 — F3 unchanged, see "F3" below).

## File-header audit

```
$ bash .claude/skills/file-headers/scripts/check-headers.sh
✔ All applicable files carry the authorship header.
(exit 0)
```

## TypeScript compilation

```
$ cd client && npx tsc --noEmit
```

Clean except 6 pre-existing errors in `src/i18n/__tests__/i18n.test.ts`
(missing `@types/node` — `fs`/`path`/`require`/`__dirname` unresolved).
Confirmed present on `master` before this build touched anything
(`git -C <main checkout> ... npx tsc --noEmit` reproduces the identical 6
errors on the untouched tree) — pre-existing baseline noise, not introduced
by or in scope for this slice.

## §9.1 DERIVED-DUAL-VIEW red-proof (F1.5 / R1) — performed live, not described

1. Baseline: `npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "verbatim"` → **PASS**.
2. Mutation: in `PlanLedgerPanel.tsx`, changed
   `<HealthStrip health={health} t={t} />` to
   `<HealthStrip health={{ ...health, unclaimedPoolSize: units.length }} t={t} />`
   (renders the pool array length instead of the server's
   `health.unclaimedPoolSize`).
3. Re-run: same command → **FAIL** (`expected pool-length to render "37"`,
   asserted 37 not present — the mutation was caught).
4. Restore: reverted the edit exactly.
5. Re-run: same command → **PASS** again.

Confirms the panel is a consumer of `health.unclaimedPoolSize`, not a
re-deriver of `units.length` — the guard this project's defect catalog
(§9.1) requires is live and enforced by F1.5, not merely asserted.

## What was actually broken (3 failures found, all in test code, not the component)

1. `PlanLedgerPanel.test.tsx` "renders pool units with tier badges" —
   `makeUnit()` left `id` at its hardcoded default across all 4 calls in this
   case (only `source`/`sourceRef` were overridden), producing 4 pool units
   sharing one React key and an ambiguous `/intake_initiative|Intake/i` query
   that also matched the unrelated plan title "Phase 1: Intake". Fixed by
   deriving `id` from `source`/`sourceRef` in the factory and scoping the
   query with `within(poolPane)`.
2. `PlanLedgerPanel.test.tsx` "calls api.projectPlans.close…" —
   `/closed|history/i` matched both the "History" section header and the
   closed plan's own title "Closed Plan". Fixed by asserting each text
   explicitly instead of one shared regex.
3. `ProjectDetail.test.tsx` "renders the PlanLedgerPanel card… (F2)" —
   `getByText("Write test plan")` matched both the item's row in the plan
   list and its own `<option>` in the claim-target `<select>` (intentional
   dual rendering, not a bug). Fixed by scoping to the open-plans pane with
   `within()`. The same case's next assertion (`/5|unclaimed|pool/i`) had the
   identical ambiguity one line later; scoped to the health strip the same
   way.

In every case the component's actual behavior was already correct — verified
by reading `PlanLedgerPanel.tsx` alongside each failure before touching
anything, per this project's own "don't blindly edit tests to pass" rule.
These were selector-ambiguity bugs in the test file, not weakened assertions.

## F3 (screens.snapshot.test.tsx) — task premise did not hold, not executed as literally planned

The build-task-list's F3 assumed the shared "Project detail" screen-snapshot
case renders the populated detail page (and therefore `PlanLedgerPanel`'s
real markup). It does not: that test case's own pre-existing comment states
it deliberately exercises the **not-found** state (the shared
`projects.list` fixture is an empty array, so `:id` never resolves to a
project, and `ProjectDetail` short-circuits to `EmptyState` before any card —
including `PlanLedgerPanel` — ever mounts), with the explicit rationale that
"the populated/happy path … is covered by `ProjectDetail.test.tsx` instead."
That happy-path coverage is exactly what F2 (case 3 above) proves.

Forcing this snapshot into a populated state would have meant fighting an
already-documented architectural decision in this file. Instead:

- Added a deterministic, crash-safe empty `api.projectPlans` fixture
  (`list`/`pool`/`health`/`claim`/`close`) to the shared mock block, matching
  the file's own established idiom for every other namespace.
- Left the "Project detail" case's not-found assertion untouched.
- Confirmed no snapshot diff resulted:
  `git diff --stat client/src/pages/__tests__/__snapshots__/screens.snapshot.test.tsx.snap`
  → empty. No blind regen was needed or performed.

The 9th "new case" the build-task-list counted for F3 is therefore not a new
snapshot assertion — it's the defensive fixture addition above, which is
real and load-bearing (keeps every other screen crash-safe against the new
`api.projectPlans` surface) but does not by itself prove PlanLedgerPanel
markup renders anywhere in this file. That proof lives in F1 (component
level) and F2 (page level, `ProjectDetail.test.tsx`).
