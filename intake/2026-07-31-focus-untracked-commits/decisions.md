# Decisions — 2026-07-31-focus-untracked-commits (retroactive)

## DEC-7: /focus is an intentional second, narrative-lens route
Date recorded: 2026-07-31 (retroactive; feature shipped 2026-07-26, `31927e2`)
Decision: `/focus` (FocusPage.tsx) is an intentional second consumer of the
FocusReport shape alongside `/focus-calendar` (FocusCalendarBoard.tsx), not
scope drift. It serves a stakeholder-facing, narrative/list-first reading of
the same underlying data the calendar board renders spatially. Sara authored
and reviewed this herself; recorded here so a future reader doesn't mistake
a second route on the same data as unreviewed scope creep.
Alternatives considered: none recorded at time of shipping (pre-dates this
retroactive pass) — this entry documents the decision after the fact per the
team-status gate's option A.

## DEC-8: AI window-summary cost/latency profile accepted
Date recorded: 2026-07-31 (retroactive; feature shipped 2026-07-29, `b930824`)
Decision: DASHBOARD_FOCUS_SUMMARY_MODEL defaults to a full-capability model
(sonnet), not a cheaper/faster one (haiku), because the output is
stakeholder-facing prose where quality matters more than latency for this
use case. The associated cost/latency is mitigated, not ignored: digest-based
caching (`focus_summaries` table) bounds repeated LLM calls to real data
changes, and the feature fails open (`{ summary: null }` + 200) rather than
blocking on any LLM unavailability, consistent with this project's existing
focus-audit/focus-inference fail-safe posture.
Alternatives considered: none recorded at time of shipping — this entry
documents the accepted default after the fact per the team-status gate's
option A.

## DEC-9: Durable-cure structural guards — deferral status
Date recorded: 2026-07-31
Status: **PENDING — flagged for Sara's input, not decided by the build team.**

Both `technical-plan.md` and `qa/test-plan.md`'s "Durable-cure decision"
section scope this build as point-tests-only: the two new/extended
regression tests (Case A/B in `focus-inference.test.js`, the render-cascade
case in `useHourWindowZoom.test.ts`) close the two live bugs this pass found,
plus the `PROJECT-CONTEXT.md` catalogue entries (§9.1 `DERIVED-DUAL-VIEW`,
§9.2 `row-id-as-chronology-proxy`) and the `[FocusPage extension]` cross-view
parity test. The two *structural* guards a stricter reading of "durable cure"
would call for were **not built** in this pass:

1. A `FocusReport`-consumer registry meta-test that fails automatically when
   a new consumer is added without a corresponding parity-chain entry (would
   generalize the point-in-time `[FocusPage extension]` test into a
   standing structural guard against a 5th `DERIVED-DUAL-VIEW` instance).
2. An `ORDER BY id`-without-`created_at` AST/grep guard over the `events`
   table (would generalize the point-fix in `focus-inference.js` into a
   standing structural guard against a 4th `row-id-as-chronology-proxy`
   instance).

This is the **4th recorded instance of `DERIVED-DUAL-VIEW`** and the
**3rd recorded instance of `row-id-as-chronology-proxy`** on this codebase.
Notably, a prior QA run (`intake/2026-07-28-wip-queue-page/`) already
recommended formalizing the `DERIVED-DUAL-VIEW` registry meta-test after
that pattern's 3rd occurrence, and that recommendation was not acted on
before this 4th instance shipped.

Per `build-brief.md`'s "Durable-cure obligations" #5 and the open-questions
section, this deferral decision belongs to Sara, not the build team — the
implementer's job was to record whichever way it resolves rather than
leaving it implicit. It has not been decided either way as part of this
build; the point-tests-only scope was carried through as written, and this
entry surfaces the open question rather than silently accepting or silently
building either guard.
