# Decision Log — coverage-on-demand (Value Pool Slice 2 build)

> Every clarifying / blocking question the build team raised on this build, the
> context behind it, the options offered, and the choice made. Readable on its own.
> Newest decisions at the bottom.
>
> Status values: **PENDING** (asked, awaiting answer) · **DECIDED** ·
> **DECIDED-AUTO** (decided by the team itself under `auto-pilot`, on its own
> best recommendation, without asking) · **PARKED** (deferred to stakeholder /
> later) · **SUPERSEDED** (a later decision overrode this one — link it).

---

## DEC-1 — No test-plan.md; build from technical-plan alone
- **Item / area:** fast-mode QA-detour default (Step 0 PREFERENCE gate)
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-05 · **Decided:** 2026-08-05 · **Decided by:** auto-pilot (fast mode)
- **Recurring-issue link:** intake `decisions.md` DEC-F2 (QA stage deliberately
  deferred at intake time; `supporting/qa.md`'s G1-G6 minimum guardrail
  checklist is inlined into `technical-plan.md` as build-time obligations)

### The question
Build from `technical-plan.md` alone (no `test-plan.md` exists — `team-qa`
was never run for this intake, per its own DEC-F2), or stop and run `team-qa`
first?

### Where we're coming from (history, as of when)
Intake for `2026-08-05-coverage-on-demand` ran in fast mode and explicitly
deferred the `team-qa` stage (`decisions.md` DEC-F2, `FAST — QA debt`), on
the reasoning that the technical-plan already inlines the minimum
catalog-guardrail checklist (§9.8, §9.1, §9.5, §9.2, §9.3/WATCH-6,
WATCH-E/F) as non-negotiable build-time obligations. Sara confirmed
"build now, QA after" when this build was dispatched (2026-08-05), matching
the intake's own stated plan rather than reopening it.

### Options presented
- **A) Build now with smoke-level proof** — derive 1-3 smoke assertions from
  the technical-plan's acceptance criteria, prove red-then-green, run the
  fast DoD (existing suites green + smoke proof + the catalog guardrails
  already named in the plan). Defer full test-plan coverage as `FAST — QA
  debt`, to be closed by a follow-up `team-qa` + build pass.
- **B) Stop and run `team-qa` first** — close the QA debt before any code
  lands for Slice 2.

### Decision
**Chosen:** A — build now, smoke-level proof, `FAST — QA debt` carried
forward.
**Note from decision-maker:** Sara, via the dispatching session, 2026-08-05.
**Rationale / implications:** Matches DEC-F2's own plan. The build must
still red-prove every catalog guardrail the technical-plan names as a build
obligation (§9.8 absence states, §9.1 cross-consumer parity, §9.5
`UPGRADE_CASES`, §9.2 chronology ordering, §9.3/WATCH-6 guard widening,
WATCH-E/F registry sync) — fast mode narrows *test-plan* coverage, not the
defect-catalog floor. The `build-report.md` must carry the `FAST — QA debt`
stamp listing exactly what remains deferred (full E2E, snapshot baselines,
drain load/perf, WS lifecycle edge cases beyond G2, calibration judgment,
locale copy review) so a later `team-status` pass recommends the follow-up
`team-qa` run.

---

## DEC-2 — Task 12 (calibration + pinned per-stage defaults, AC-6) deferred, not done — **RESOLVED 2026-08-06**
- **Item / area:** MANDATORY build-task-list Task 12 / technical-plan §3.7 / AC-6 / intake DEC-10
- **Status:** RESOLVED — closed 2026-08-06 per intake `decisions.md` DEC-10's resolution. Sara chose sonnet for
  both the `unit` and `grouping` stages after reviewing a real 40-unit
  calibration batch (sonnet showed cross-unit relational reasoning haiku
  didn't). Pinned via env vars in `.env`/`.env.example`, no product code
  changed. The Slice-3 gate this row named is now open.
- **Raised:** 2026-08-05 (verifier §8, reviewer SF-11) · **Decided:** 2026-08-05, deferred · **Resolved:** 2026-08-06 · **Decided by:** `build-lead` under auto-pilot, then Sara directly
- **Recurring-issue link:** `PROJECT-CONTEXT.md` §9.4 — *"an unfixed item with no disposition row is how this project loses them."* This row exists so it is not lost.

### The question
Task 12 required a real 40-unit batch run through both `haiku` and `sonnet`
from a scratchpad script, both outputs plus a recommendation attached to
DEC-10, **before** per-stage defaults are pinned. Independently confirmed by
both the verifier and the reviewer: **it never ran.** No artifact exists in
either checkout; `summaryModel`'s fallback tail is unchanged and still ends in
`"haiku"`; the two new per-stage env vars ship documented as "unset by
default". What exists is the **plumbing** (DEC-7/O2's single cascade,
`SUMMARY_STAGES`, the precedence tests) — real, correct, and tested — but not
the measurement and not a calibration-informed default. So AC-6 is unmet.
Descope with a row, or hold the build?

### Options presented
- **A) Defer with this row.** Ship the plumbing (inert: both stages resolve as
  before), close the measurement in the follow-up `team-qa` + build pass this
  build's `FAST — QA debt` stamp already recommends.
- **B) Hold the build** until the calibration runs.
- **C) Say nothing** and let the DoD row stay silently unticked.

### Decision
**Chosen:** A — deferred, with this row and a named gate.
**Rationale / implications:** DEC-10's own gate was *calibrate **before**
pinning defaults*, and **no default was pinned** — so nothing incorrect
shipped; the model cascade behaves exactly as it did before this build. C is
excluded by §9.4. B is disproportionate: calibration is a measurement task
with zero code dependency on the rest of the slice, and holding a fully-green
7-surface build on it would strand the coverage mechanism Slices 3–4 are gated
on. **Named gate: this must close before Slice 3 builds** — Slice 3's grouping
synthesis is designed to run on a *different* model tier, and with AC-6 unmet
it would silently run grouping on `haiku`. Carried into `build-report.md`'s
`FAST — QA debt` stamp as item 5, upgraded from "judgment deferred" to "never
ran".

---

## DEC-3 — Disposition for the review's unapplied should-fix items and nits
- **Item / area:** `supporting/review-findings.md` SF-4, SF-6, SF-7, SF-8, SF-9, SF-10.2, N1–N5
- **Status:** DECIDED-AUTO (deferred, each with a named consequence)
- **Raised:** 2026-08-05 (build-reviewer) · **Decided:** 2026-08-05 · **Decided by:** `build-lead` under auto-pilot
- **Recurring-issue link:** `PROJECT-CONTEXT.md` §9.4 — *"should-fix is a triage label, not a disposition."* SF-10 was itself the reviewer flagging exactly this gap on this build.

### The question
The review returned 2 blockers, 11 should-fix and 5 nits. Both blockers plus
**SF-1, SF-2, SF-3 and SF-5** were fixed with red proofs in the second
loop-back. SF-11 is Task 12 (see DEC-2), and SF-10.1 (DEC-11's
`PROJECT-CONTEXT.md` note) and SF-10.3 (the missing `build-report.md`) are both
closed by this `build-lead` pass. The rest are unapplied. §9.4 says each must
end as *fixed with a test* or *a dated decisions row*. This is that row.

### Decision — deferred, per item, with consequence

| Id | Item | Why deferred | Consequence if left |
|---|---|---|---|
| **SF-4** | Probe-snapshot composition written twice in `routes/project-plans.js` (`:308-319`, `:334-345`), copies already diverged on `requestedAt` | Not a live defect — both copies currently produce correct answers; extracting `buildProbeCoverage` is a refactor better done with Slice 3's own consumer in hand | §9.1 at the composition layer. **Highest-value follow-up.** The next consumer (Slice 3 / `ccam` / MCP) acquires a third copy |
| **SF-6** | `shouldBroadcastCoverage` treats a project's first observation in a process lifetime as "no transition", so a terminal `complete` with `generated === 0` is dropped; and the map is written on non-broadcasts, contradicting its own doc | Narrow (post-restart / `POST /altitudes`-between-ticks only); the fix changes broadcast semantics and wants its own red proof | An open tab never learns coverage finished — a narrowed form of the exact failure DEC-6 exists to close. **The header comment's "can only ever SUPPRESS, never fabricate" claim is false as written and should be corrected even if the behavior is not** |
| **SF-7** | Four existence-only cases (`assert.ok(stmts.X)`) under acceptance-criterion titles in `coverage-smoke.test.js`, plus two near-vacuous cases | These are the **fast-mode smoke tests themselves**, and the real AC-2/AC-3 proofs exist elsewhere (`value-summary-tick.test.js` exit-condition matrix, `project-plans-api.test.js` Group T, `value-coverage.test.js`) | **A live §9.3 instance, knowingly shipped.** Danger is the misleading DoD tick — "the next change reads the checkmark and stops looking". The follow-up `team-qa` pass should replace them with the behavioral assertions their titles promise, not merely add to them |
| **SF-8** | Client `coverage` state not reset on `projectId` change; `PlanLedgerPanel` rendered unkeyed at `ProjectDetail.tsx:1292` | Client fix outside the guarded server surface; wants a test that switches projects | If project A's `computed_at` is newer, the monotonic merge **permanently** rejects project B's snapshot and the header renders A's counts under B's pool |
| **SF-9** | A failing `GET /coverage` rejects the shared `Promise.all` and blanks the whole panel | One-line fix, but untested as written | A progressive-enhancement header can take down the plan list, the pool and health behind an error banner |
| **SF-10.2** | Slice-1-inherited `assert.ok(true, "startServer completed without throwing")` at `value-summary-interrupted-boot.test.js:133` | Pre-existing, out of this slice's change set; confirmed present verbatim in `b38b4a1` | The plan's literal G5 gate (`grep -rn "assert.ok(true" server/__tests__/` returns 0) stays **unmet by exactly this one line**. **This row is the disposition the reviewer said did not exist.** Fix it in the next build that touches boot: assert the observable post-condition, not the absence of a throw |
| **N1** | `estimateEta` SELECTs `generated` and never uses it — a 3-unit batch weighs the same as a 40-unit batch in `per_batch_ms` | WATCH-S2-C already accepts ETA skew | §9.1's "dropped assertion leaves a fingerprint" shape at the query layer. Either drop the column or normalize per-unit and say so |
| **N2** | `value-coverage.test.js`'s hand-typed `STATE_TO_LOCALE_KEY` silently `continue`s on unmapped registry members | `i18n.test.ts`'s generic E1.1 parity already covers locale drift; this only affects *new* registry members | §9.7. **WATCH-S2-F's trigger fires on any Slice 3 registry growth — close this then**, one line: assert the exempt set is exactly `["passive"]` / `["none"]` |
| **N3** | `value-coverage-parity.test.js`'s second case scans **its own source** for `pool_size - queued` | Harmless; asserts nothing about product code | Can only fail if someone edits the test. If a "no second computation" static scan is wanted, point it at `routes/project-plans.js`, `lib/value-summary-tick.js`, `PlanLedgerPanel.tsx` — where it would presently go red on SF-4 |
| **N4** | `value-summary.js:485-488`'s probe-mode comment contradicts itself | Cosmetic | Comment drift on a surface this catalog repeatedly finds lying |
| **N5** | `POST /coverage-request` writes a sweep-state row for any string (no project-existence check) | Matches this router's documented convention; rotation JOINs `projects` | Junk rows only; recorded for completeness |

**Note from decision-maker:** these are dispositions, not dismissals. Every row
above is reproduced in `build-report.md`'s **Residual risk** section so the
person who merges sees them without opening this log, and the `FAST — QA debt`
stamp routes them into the follow-up `team-qa` pass.

---
<!-- copy the DEC block above for each new question -->
