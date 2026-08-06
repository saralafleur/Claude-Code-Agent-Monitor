# Run Plan — team-build (direct mode, fast run)

**Effort:** `2026-08-05-coverage-on-demand` (Value Pool Slice 2)
**Dispatched:** 2026-08-05 · direct mode implied by `fast`
**Director verdict:** **full roster — both discretionary agents IN.** Direct
mode buys no reduction on this build.

---

## 1. Scope read

This is not a small change. The technical-plan carries **16 sequenced
implementation steps** across five subsystems that each depend on the one
before it: an additive nullable-column schema migration on the shared
user-global `dashboard.db` (`value_summary_sweep_state.coverage_requested_at`),
four new/widened `db.js` statements including a re-ordered `listValueSweepTargets`
ORDER BY and a new chronology-sensitive ETA read, a brand-new single-home lib
(`server/lib/value-coverage.js`), probe mode plus a stage-aware `summaryModel()`
on the composer, a new `runCoverageDrain()` loop inside the tick with six named
exit conditions and an iteration cap, two new HTTP routes, an additively widened
`value_altitudes_updated` WebSocket payload, and `PlanLedgerPanel`'s first-ever
`eventBus` subscription with a monotonic `computed_at` merge rule — plus four
locale files and four docs. Blast radius crosses at least three real boundaries:
a **schema** boundary against a DB every worktree and every process (server, MCP,
desktop, VS Code extension) migrates at `require()` time; an **API contract**
boundary (two new endpoints whose response must be byte-identical to a WS
payload key); and a **cross-consumer** boundary where the same `coverageSnapshot`
object must travel two independent wires without either side re-deriving it.
The build also lands on the surface this project's own catalog calls **the
highest-density defect surface it has** — eight §9.3-family events in
`2026-08-04-value-summary-tick` and nine more in Slice 1 (`2026-08-04-altitude-invalidation`,
this build's direct predecessor) on this same file family.

---

## 2. Agents to run

Ordered; team-build's normal dependency order preserved.

1. **build-triage** — already ran; verdict READY, worktree provisioned at
   `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor`
   on `effort/2026-08-05-coverage-on-demand` @ `b38b4a1`. Structural, always runs.
2. **build-planner** — **IN.** See §4 for the forcing rationale. This is the
   opposite of "a single obviously-ordered task": 16 steps whose order is
   load-bearing correctness, not convenience (the single home must exist at
   step 6 *before* any consumer, per §9.1's own ordering rule; the schema
   commit must precede the statements commit; the parity test at step 11 is
   deliberately hoisted ahead of the client step). Several steps also carry
   MANDATORY durable-cure status that the planner must stamp as such — the
   seven obligations in the build-brief plus technical-plan §5's four
   single-source-of-truth surfaces. Additionally the planner must fold in
   step 3's non-optional precondition: re-verify every `[S1-dep]` shape against
   Slice 1's *landed* code at `b38b4a1` before the first line of Slice 2 code,
   since the plan cites Slice 1's planned shapes only.
3. **build-test-author** — structural, always runs. Red-first TDD core; here it
   owns G1a–G6 and the named deliverable `server/__tests__/value-coverage-parity.test.js`.
4. **build-implementer** — structural, always runs.
5. **build-verifier** — structural, always runs. Must independently observe each
   guard red against a real mutation; no DoD row ticked on an agent's self-report
   (§9.3 AGENT-SELF-REPORTED-RED).
6. **build-reviewer** — **IN.** See §4. Adversarial diff review against the
   catalog traps this build sits directly on top of.
7. **build-lead** — structural, always runs. Produces `build-report.md` carrying
   the **`FAST — QA debt`** stamp naming `supporting/qa.md`'s deferred list
   verbatim (intake DEC-F2, this build's DEC-1).

---

## 3. Agents skipped

**None.** Every agent in team-build's roster runs for this build. The two
agents I had discretion over (`build-planner`, `build-reviewer`) both fail
their own skip criteria on the merits, and independently are forced back on
by defect-catalog matches.

For the record, the fast-mode QA-deferral that *would* normally lean agents
toward skipped does not reach either of them here: fast mode narrows the
**test-plan** (no E2E, no snapshot-baseline sweep, no drain load/perf, no
locale copy review — this build's DEC-1) and it deferred the separate
`team-qa` *stage*. It does **not** narrow the catalog guardrail floor, which
the technical-plan §6 inlines as build-time obligations, and it does not touch
build-time planning or diff review at all.

---

## 4. Forced back on

Three independent overrides apply. Any one of them alone would be sufficient.

- **Defect-catalog match — §9.3 VACUOUS-GUARD family (build-reviewer).**
  `PROJECT-CONTEXT.md` §9.3 records 8 events on this exact file family in
  `2026-08-04-value-summary-tick` and 9 in Slice 1, including a vacuous
  *repair* of a vacuous guard, and the catalog's own stated conclusion is that
  "being warned about this entry does not reduce its incidence." That is
  precisely the class of finding a self-reporting implementer cannot be trusted
  to surface about its own diff. Reviewer must specifically hunt
  TEST-PINS-THE-DEFECT (a scope-qualifying comment accommodating a known gap
  instead of reporting it) and REGISTRATION≠EXECUTION (a registry meta-test
  proving entries exist without proving the harness iterates them) — both
  catalogued from this same family.

- **Defect-catalog match — §9.1 DERIVED-DUAL-VIEW (both agents).** The plan's
  §5 names four separate single-source surfaces (coverage/ETA computation, pool
  membership, the model cascade, the wire-state registries) and states the
  guard must be able to fail on a **second computation**, not merely a second
  read — the catalog's twice-proven weak spot. Enforcing "one home exists before
  consumer #2" is a *sequencing* property (planner) and "no second computation
  one call frame away" is a *diff-shape* property (reviewer). Neither is
  detectable by the structural agents alone.

- **Cross-subsystem boundary (both agents).** Schema → statements → lib →
  composer → tick → routes → wire types → component → locales → docs, where a
  shared user-global SQLite file is mutated at `require()` time by every
  process on the machine, and where the same object must be byte-identical
  across an HTTP response and a WebSocket payload. Also live: §9.2 (new
  chronology read must sort before LIMIT), §9.5 (guarded ALTER via the
  `PRAGMA table_info` idiom, not the deprecated try/SELECT-LIMIT-1/catch probe),
  §9.7 (every new export needs an `assertSingleHome` disposition; the new lib
  needs a `FILE_DISPOSITIONS` entry in the same commit), and §9.8 (`demand` and
  `eta.state` are closed server-authored registries that must not collapse a
  drain-stalled state into the same absence as never-requested).

Two further non-catalog reasons the reviewer's skip test ("small, low-risk
diff") plainly fails: the diff is neither small (nine numbered change surfaces,
16 steps) nor low-risk (a negative requirement — `server/index.js` diff must be
**empty** — and a prohibition the plan explicitly says to grep for: the drain
must not read `MAX_PROJECTS_PER_TICK` anywhere).

**One open item to carry, not a blocker:** OPEN-S2-1 (validation project
choice) remains PENDING Sara; the build proceeds on triage's stated assumption
that the calibration project is whichever real project has the largest
uncovered pool at step 14 unless Sara names one first.
