# Run Plan — `2026-08-05-coverage-on-demand-qa-fix` (team-build, direct mode)

**Director of Engineering scope-sizing pass.** Mode: `direct`, **not fast** —
the build-brief states this explicitly, and a real `test-plan.md` exists as
this build's change-set specification.

**Verdict up front: build-planner IN, build-reviewer IN.** Direct mode
produces **no reduction** on this build. Both discretionary agents are
warranted on this build's actual scope and risk; build-reviewer is
additionally *forced* on by a defect-catalog match that direct mode is not
permitted to bend. See §4.

---

## 1. Scope read

This is a **fix round against already-shipped, already-merged production
code** (`master`/`origin/master` both at `4c2e931`, 0 ahead / 0 behind),
closing a `team-qa` finding list. It is not a touch-up. The change set spans
**three production-code fixes in two languages** (`PlanLedgerPanel.tsx`
per-leg fetch isolation + entity-scoped state reset; `value-summary-tick.js`
`shouldBroadcastCoverage` first-observation rule, plus two now-false comments
that make checkable claims), **10 named test cases across 6 existing spec
files plus 1 new spec file**, across **two independent test harnesses**
(`node --test` and `vitest`), in **four priority tiers** with a hard P0 gate,
plus a `qa/decisions.md` deliverable that is a Definition-of-Done item rather
than documentation. The blast radius is genuinely cross-boundary on two
counts: the SF-6 fix **changes wire behavior** (when a terminal `complete`
broadcast reaches the WebSocket), which touches a stability contract
`CLAUDE.md` names explicitly and which the test-plan's own DoD flags for a
docs sweep; and the SF-8/SF-9 fixes change the `PlanLedgerPanel` fetch/state
contract that `ProjectDetail.tsx` and the shared screens-snapshot mock both
depend on. Six separate **mutate-source-then-revert** red-proof cycles are
mandated on shared files, in a repo with multiple concurrent `claude`
sessions attached to the main checkout. Nothing about this is small, and
nothing about it is a single obviously-ordered task.

---

## 2. Agents to run

In the calling skill's existing dependency order.

1. **build-triage** — done, verdict **READY** (`build-brief.md`). Retained as
   the record of intake; no re-run needed.
2. **build-planner** — **IN.** Three independent reasons, none of them a
   default:
   - **The test-plan is ordered, but the *agent* sequencing is not.** The
     plan's P0 steps 1–3 each interleave one test and one production fix with
     a **RED-observed-before / GREEN-after** obligation per case. That is not
     this skill's normal "author all tests, then implement" handoff between
     build-test-author and build-implementer; run naively, the red state is
     never independently observed and the build ships §9.3's
     **AGENT-SELF-REPORTED-RED** shape — the exact sub-pattern the build-brief
     flags as already active on this effort. Somebody has to specify that
     handoff before the always-on agents start. That is planner work.
   - **Six mutate-and-revert cycles need explicit hygiene.** Steps 5, 6, 8, 9b
     and 11 require temporarily breaking shared source (`DEMAND_STATES`, both
     route handlers, `requestValueCoverage`'s SQL, `PlanLedgerPanel.tsx`'s
     render gate, `listValueSweepTargets`' `ORDER BY`) and reverting. A
     revert that lands non-byte-identical is precisely how a "proven" guard
     ships vacuous. Combined with the brief's concurrent-session caution and
     the `DASHBOARD_DB_PATH` scoping requirement, the mutation cycles need to
     be planned, not improvised mid-implementation.
   - **P3 is a live scope decision.** Four optional items with an explicit
     time-box (item 12: "if it cannot be made deterministic in under ~30
     minutes, skip it and record the reason") and a required skip-with-reason
     record. Someone must own the P0–P2-first ordering and the P3 cut line.
3. **build-test-author** — always. 10 cases across 7 files; the operative spec.
4. **build-implementer** — always. Three production fixes plus the comment
   corrections at `value-summary-tick.js:111-118` / `:180-183`.
5. **build-verifier** — always. Both suites green at **≥1786 / ≥819**, the
   `assert.ok(true` sweep returning exactly **1** (not 0), scoped snapshot
   regeneration, `tsc --noEmit`, and the file-header audit.
6. **build-reviewer** — **IN, forced.** See §4.
7. **build-lead** — always. Produces the one build report; the P3
   done/skipped-with-reason record and the DoD checklist land here.

**Agents skipped: none.**

---

## 3. Agents skipped

None. Recorded deliberately: I looked for a fold on both discretionary
agents and neither survives contact with this build's scope.

The candidate case for folding **build-planner** was that the test-plan is
already a strictly ordered 14-step sequence with exact file/line anchors, so
an implementer could arguably execute it directly. That case fails on the
foldability criterion itself — "a single obviously-ordered task." This is 14
steps, 8 files, 2 languages, 2 harnesses, 4 priority tiers, an optional tier
requiring a judgment call, and a **non-standard interleaved test/implement
handoff** that the test-plan specifies but that this skill's default agent
ordering would silently flatten. The plan being ordered for a *human reader*
is not the same as the *agent pipeline* being ordered.

---

## 4. Forced back on

**Yes — `PROJECT-CONTEXT.md` §9.4 FIX-ROUND-REGRESSION is a direct, literal
match, and it forces build-reviewer on independent of any leaner call I might
otherwise make.**

§9.4's acceptance criterion is written for exactly this situation, verbatim:

> *"a fix round on this surface gets its own adversarial review pass over the
> fix diff, with the same standard as the original build — not a re-run of
> the suite that was already green when the blockers were found."*

Every clause matches this build:

- **It is a fix round.** The whole change set exists to close a review/QA
  finding list (SF-4, SF-6, SF-7, SF-8, SF-9, N2).
- **The suite was green when the defects were found** — 1784/1784 and 817/817
  at `4c2e931`. §9.4's parenthetical ("in this build the suite was green
  before, during, and after both regressions") describes the current state
  precisely. build-verifier's green run therefore cannot be the review.
- **The named failure shape is present in the diff.** §9.4's shape is "a fix
  correct for the caller that motivated it that **over-applies** to a sibling
  caller." The SF-6 fix changes a broadcast predicate consumed by every
  project on every tick; the test-plan itself anticipates pre-existing
  broadcast-count assertions flipping and forbids relaxing them silently.
  That is the over-application shape, live, in the P0 diff.
- **The recurrence is one effort old.** §9.4's 2026-08-05 note records the
  unfixed-remainder half recurring **literally, in a build whose own brief
  cited this entry** (`intake/2026-08-04-altitude-invalidation/`): 7 of 11
  should-fix items ended the round with no fix and no disposition anywhere,
  suite green, nothing objecting. The note's own conclusion is that stating
  the rule inside the fix instruction **is not sufficient** — the round needs
  a separate pass whose only job is to diff the finding list against the
  shipped tree.

Concrete standing obligations that pass carries here, from §9.4's
how-to-comply and the two most recent catalog notes:

- Every QA finding in this change set must end in one of exactly two states —
  **fixed with a test**, or **recorded in `qa/decisions.md` with an id**.
  "P3, time allowing" is a triage label, not a disposition; each P3 item needs
  a done-or-skipped-with-reason row.
- For the SF-6 fix, **name the other callers** of `shouldBroadcastCoverage`
  and state what the fix does to each.
- When triaging any finding left unfixed, **grep the decision log for the
  feature's name before assigning severity** — an item some earlier decision
  cited as *its own* mitigation is never a should-fix (§9.4, 2026-08-05).

**Secondary forcing factors**, each sufficient on its own:

- **§9.3 VACUOUS-GUARD** — 4 events in the Slice-2 pipeline alone on this
  exact file family, on top of 8–9 prior, plus the **THE GUARD IS THE
  VACUITY** sub-pattern where the MANDATORY named deliverable was itself
  briefly the vacuous guard. This build's P1 deliverables (T7, N2) are
  precisely "a mandatory structural guard demanded by this very catalog" —
  §9.3's highest-risk category by its own text. Their red-proofs must be
  **independently re-run and observed**, never accepted from a sub-agent's
  report.
- **§9.8 OVERLOADED-ABSENCE** — SF-6's own catalog id, and it recurred in the
  build immediately after being named. The negative bounding case (case 2) is
  P0, not optional; shipping only the positive case is a known failure shape
  on this exact file.
- **§9.1 DERIVED-DUAL-VIEW (7th occurrence)** and **§9.7 HAND-SCOPED
  STRUCTURAL SCAN (7th)** — SF-4 and N2 respectively. §9.7's live shape is a
  guard that is real for the names hand-typed into it and blind to the rest,
  which is a reviewer-detectable defect, not a suite-detectable one.
- **Cross-boundary blast radius** — the SF-6 fix is a WebSocket wire-behavior
  change; `CLAUDE.md` requires WS message types stay stable and
  backward-compatible, and the DoD requires a docs sweep of
  `docs/API.md` / `ARCHITECTURE.md` / `server/README.md` for statements of the
  old rule. A boundary two delivery paths rely on is never review-skippable
  on size.

Nothing here overrides in the other direction: there is no ambiguity in the
inputs that would justify adding scope beyond the roster, and no roster agent
is rendered inapplicable by this change.
