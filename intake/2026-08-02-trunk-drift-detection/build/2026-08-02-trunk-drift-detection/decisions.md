# Decision Log — trunk-drift detection build (Phase 1a)

> Status values: **PENDING** · **DECIDED** · **DECIDED-AUTO** (decided by the
> team itself under `auto-pilot`) · **PARKED** · **SUPERSEDED**.

---

## DEC-B1 — SHIP gate: commit + push under auto-pilot, no PR opened

- **Item / area:** Step 8 SHIP gate — `effort/2026-08-02-trunk-drift-detection`
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** build lead
  (orchestrator), per `team-build`'s auto-pilot rule

### The question

Standard mode stops at green + report with no commit/push. Under auto-pilot,
Step 8 commits + pushes on the effort's own isolated branch and opens a PR
"if this project has that convention." Does this project have that
convention, and should a PR be opened automatically?

### Decision

**Committed and pushed** to `origin/effort/2026-08-02-trunk-drift-detection`
(commit `ef42b65c28b36aa7079adf29ce71c7918d3a7370`) — this half of the SHIP
gate is unambiguous under auto-pilot. **No PR opened automatically.**

**Rationale / implications:**
- PR convention here is thin: `gh pr list` shows exactly one prior PR ever,
  `effort/2026-07-28-wip-queue-page` — merged, then fully reverted two days
  later (per this project's own `portfolio-reconciliation-vision` memory,
  cited as the precedent this build's own sequencing explicitly tried to
  avoid repeating). That is not a convention strong enough to auto-invoke on
  a second data point.
- `build-report.md` also flags a real merge-time consideration: two files
  (`client/src/lib/api.ts`, `client/src/lib/types.ts`) are simultaneously
  being edited by the still-live `2026-08-02-practice-kind-override` effort.
  Both diffs look additive, but merge sequencing is a judgment call, not one
  auto-pilot should make silently via an opened PR.
- Never force-pushed, never `--no-verify`, never pushed to `master` — the
  standing safety floor that holds in every mode.
- Branch stays live and unmerged; teardown remains manual per this skill's
  own rule, in every mode.
