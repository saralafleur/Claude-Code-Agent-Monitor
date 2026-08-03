# Build Report — 2026-08-03-plan-lifecycle-workbench-ui

> Synthesizes `build-brief.md`, `build-task-list.md`, and
> `supporting/green-evidence.md`. The build-implementer's pass left 3 client
> tests red and nothing committed; this report covers the pass that closed
> those out, fixed the gaps it found along the way, and committed the result.

---

## Headline verdict

**GREEN, SHIPPED to the effort branch (not yet merged to `master`).**

782/782 client tests, file-header audit clean, `tsc --noEmit` clean (net of
6 pre-existing `i18n.test.ts` errors confirmed present on `master` too, out
of scope). The §9.1 DERIVED-DUAL-VIEW health-verbatim guard (F1.5/R1) was
proven red under a live mutation and green on restore — not merely described.
Committed `98b0f96` on `effort/2026-08-03-plan-lifecycle-workbench-ui`.

## What was built

`PlanLedgerPanel.tsx` — the two-pane workbench specified in the technical
plan's §4 slice 5: left pane lists a project's open plans with nested items
(`parent_item_id`-aware) and a close-with-note action; right pane lists the
live unclaimed value pool with attribution-tier badges and a claim gesture
(item picker + Claim button); closed generations collapse into a read-only
"History" section with zero edit/claim/unclaim affordances. A health strip
renders `unclaimedPoolSize` / `openPlanCount` / `lastClosureAt` +
`daysSinceLastClosure` **verbatim** from `api.projectPlans.health()` — no
client-side re-derivation. Rendered as a new card on `ProjectDetail`, wired
through `api.ts`/`types.ts`, localized into the existing `projectDetail.json`
namespace across all 4 locales. No server files, routes, or schema touched —
this slice is 100% client, matching scope.

## What this pass found and fixed (beyond what the task list anticipated)

1. **3 failing client tests, all test-authoring bugs, not component bugs.**
   Verified this by reading `PlanLedgerPanel.tsx` against each failure before
   changing anything (this project's own "don't blindly edit tests to pass"
   rule): a mock-data factory left a hardcoded default `id` across 4
   differently-sourced pool units (duplicate React keys), and three
   assertions used regexes/text queries that matched more than one
   legitimately-rendered element (e.g. `/Intake/i` matching both a plan
   titled "Phase 1: Intake" and an "intake_initiative" badge; an item's text
   matching both its list row and its own `<option>` in the claim-target
   `<select>`). Fixed by disambiguating the mock data and scoping queries
   with `within()` — see `supporting/green-evidence.md` for the full
   before/after on each.
2. **3 TypeScript strict-mode errors** in the new test file (nullable
   `.closest()` results passed where `within()` expects `HTMLElement`, one
   unused variable) — fixed with explicit casts/removal.
3. **F3's premise didn't hold.** The build-task-list assumed
   `screens.snapshot.test.tsx`'s "Project detail" case renders the populated
   page. It doesn't — that case's own pre-existing comment documents it as a
   deliberate not-found state (empty `projects.list` fixture, so `:id` never
   resolves and `ProjectDetail` short-circuits to `EmptyState` before any
   card mounts), with populated-state coverage intentionally delegated to
   `ProjectDetail.test.tsx` — which is exactly what F2 already proves. Rather
   than force a populated snapshot against that documented design, added a
   crash-safe empty `api.projectPlans` fixture to the shared mock (matching
   the file's own idiom for every other namespace) and left the not-found
   case untouched. Confirmed zero snapshot diff resulted — no blind regen
   was performed or needed.

## Durable-cure obligations — status

- **§9.1 DERIVED-DUAL-VIEW**: enforced, F1.5 + live R1 mutation proof
  recorded in `supporting/green-evidence.md`.
- **File-header convention**: clean (`check-headers.sh` exit 0).
- **No raw locale keys in DOM**: covered by F1.7, passing.
- **Closed generations expose no edit/claim/unclaim affordances**: covered
  by F1.6, passing; verified by reading `PlanSection`'s render logic
  (no conditional hiding — the controls are simply never wired for
  `closed=true`, per the component's own doc comment).
- **No blind snapshot regen**: honored — no regen was performed since none
  was warranted (see F3 above).

## Residual risk / what's not proven

- **Not merged to `master`.** This build stops at a clean, green commit on
  the effort branch — merge was explicitly out of scope for this pass.
- **Visual review not done.** No screenshot/manual browser check of the
  rendered panel — only jsdom-based component/page tests and the (unchanged)
  screen snapshot. Layout/spacing/dark-mode correctness is unverified beyond
  what the tests assert structurally.
- **`DEC-16 (WATCH)`** (MCP tools / `AGENT-PLAN.md` export as future
  consumers #3/#4) remains untouched, as scoped — `mcp/` was not built or
  typechecked in this pass.

## Files changed (commit `98b0f96`)

```
client/src/lib/types.ts
client/src/lib/api.ts
client/src/components/PlanLedgerPanel.tsx                       (new)
client/src/components/__tests__/PlanLedgerPanel.test.tsx        (new)
client/src/pages/ProjectDetail.tsx
client/src/pages/__tests__/ProjectDetail.test.tsx
client/src/pages/__tests__/screens.snapshot.test.tsx
client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json
```

## Verification evidence

See `supporting/green-evidence.md` for full command output: the 782/782
client suite, the header audit, the `tsc --noEmit` diff against `master`
baseline, the F1.5 red-proof transcript, and the exact fix applied to each
of the 3 failing cases.
