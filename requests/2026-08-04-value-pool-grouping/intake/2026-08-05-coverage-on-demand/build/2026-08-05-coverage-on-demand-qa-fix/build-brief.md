# Build Brief — coverage-on-demand QA-fix follow-up (Value Pool Slice 2 QA debt closure)

**Triage date:** 2026-08-05
**Effort slug:** `2026-08-05-coverage-on-demand-qa-fix`
**Outer skill invocation:** `auto direct` — auto-pilot + direct. **NOT fast** — a
real `test-plan.md` exists and is this build's own change-set specification.

---

## What we're building

This is a **follow-up QA-fix build against already-shipped, already-merged
code**, not a fresh feature build. Value Pool Slice 2 ("coverage-on-demand")
built and merged to `master` at `4c2e931` earlier today. A `team-qa`
post-merge pass (`qa-lead`, synthesizing `coverage.md` + `risk.md` +
`unit-tests.md` + `e2e-tests.md`) then found three live, reproducible-today
defects the merged suite (1784/1784 server + 817/817 client, green) cannot
see: **SF-8** (a mounted `PlanLedgerPanel` leaks the previous project's
coverage snapshot across a `projectId` switch, because `mergeCoverage`
compares only `computed_at`, never `project_id`), **SF-9** (`GET /coverage`
is bundled into the same `Promise.all`/`catch` as the panel's core content
fetches, so a failing coverage call blanks the whole panel instead of
degrading), and **SF-6** (`shouldBroadcastCoverage`'s `transitioned` check is
structurally incapable of firing on a project's first-ever observed sweep in
a process lifetime, so an already-complete pool never broadcasts its
terminal state). This build closes all three (P0, gates the push to `origin`
and Slice 3), rides two durable structural guards in the same change set
(P1: N2's exact-exemption assertion, SF-4's route↔route composition-parity
guard), removes one false-confidence signal (P2: SF-7's existence-only smoke
cases), fixes a screens-snapshot blind spot that was silently short-circuiting
past the panel entirely, and does the P3 items (a new
`coverage-request-e2e.test.js`, route-level `draining` case, client WS
lifecycle-edge cases, an N1 characterization test) if time allows.

## Plan sources

- Technical plan (context — the original Slice 2 design that shipped as
  `4c2e931`; **not** this build's change-set spec):
  `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/technical-plan.md`
- Test plan (**this build's actual change-set specification** — read this
  first, it is buildable standalone):
  `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/qa/test-plan.md`
- QA assessment (context): `qa/qa-assessment.md` — verdict **BLIND (scoped)**;
  synthesis of `qa/supporting/{coverage,risk,unit-tests,e2e-tests}.md`.
- QA change-brief (context): `qa/change-brief.md`.

**Buildability check.**
- **Technical-plan** has a concrete Change set (§3, 9 numbered surfaces) and
  sequenced Implementation steps (§4, 16 steps) — already executed, present
  only as surface/behavior context for the fixes below.
- **Test-plan is the operative spec for this build** and is fully buildable
  on its own: 10 named test cases across 6 spec files
  (`value-summary-tick.test.js`, `value-coverage.test.js`,
  `project-plans-api.test.js`, `coverage-smoke.test.js`,
  `PlanLedgerPanel.test.tsx`, `ProjectDetail.test.tsx`,
  `screens.snapshot.test.tsx`) plus one new file
  (`coverage-request-e2e.test.js`, P3), each with exact file/line anchors,
  exact assertions, an explicit **RED before / GREEN after** procedure per
  case, and a strictly ordered implementation sequence (P0 items 1-4 gate
  everything else). Both plans correspond to the same surfaces
  (`value-coverage.js`, `value-summary-tick.js`, `PlanLedgerPanel.tsx`,
  `routes/project-plans.js`) — the test-plan is a QA pass *over* the
  technical-plan's shipped change set, not an unrelated surface.

## Surfaces touched

**P0 — MANDATORY, live defects (build-report must record each as RED-then-GREEN, not self-reported):**
- `client/src/components/PlanLedgerPanel.tsx:696-701` — isolate the
  `coverage` fetch leg with its own `.catch(() => ({ coverage: null }))`
  (SF-9); add `useEffect(() => { setCoverage(null); }, [projectId])` and/or a
  `project_id`-aware `mergeCoverage` (SF-8).
- `server/lib/value-summary-tick.js:190-195` (+ stale comments at `:111-118`
  and `:180-183`) — `shouldBroadcastCoverage`'s first-observation fix (SF-6):
  `transitioned = prior ? (...) : complete === true`.
- New test cases: `server/__tests__/value-summary-tick.test.js` (SF-6 × 2),
  `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (SF-8, SF-9 × 2,
  including the reusable `expectPanelCoreIntact` helper).

**P1 — durable cure (same change set):**
- `server/__tests__/value-coverage.test.js` — N2 exact-exemption case
  (`assert.deepEqual(exemptDemand, ["passive"])` /
  `assert.deepEqual(exemptEta, ["none"])`).
- `server/__tests__/project-plans-api.test.js` — new T7 case, a source-scan
  structural guard proving `POST /coverage-request` and `GET /coverage`
  compose `coverageSnapshot` from an identical building-block set (literal
  `assembleValuePool`/`enrichPoolAltitudes(...,{probe:true})`/
  `draining: isDrainingProject(projectId)` calls + sorted key-set
  `deepEqual`), against `server/routes/project-plans.js`.

**P2 — hygiene / false-confidence removal:**
- `server/__tests__/coverage-smoke.test.js` — replace-in-place: delete two
  existence-only cases + one near-vacuous ETA case, add one real round-trip
  case.
- `client/src/pages/__tests__/screens.snapshot.test.tsx` — add
  `coverage`/`requestCoverage` to the shared API mock (currently missing,
  which means any page mounting the panel throws straight into SF-9's shared
  catch); add one additive snapshot case.
- `client/src/pages/__tests__/ProjectDetail.test.tsx` — one behavioral
  anchor case, must land **before** the new snapshot baseline.
- `requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/qa/decisions.md`
  (new file, or append to the intake's existing QA addendum) — dated rows for
  Trap 7 (wire `pending` sourcing), the STRICTMODE-BLIND residual scope, the
  four deferred durable cures with triggers, and the SF-8 `altitudes`/
  `requestedAltitudesRef` scope note. **This file is part of this build's
  Definition of Done**, not optional documentation.

**P3 — optional, do only if P0-P2 green and time allows:**
- New `server/__tests__/coverage-request-e2e.test.js` (first spec in this
  repo to open a real `ws` client against a real booted server).
- `server/__tests__/project-plans-api.test.js` T8 (route-level `draining`
  under a real in-flight drain).
- Two new `describe` blocks in `PlanLedgerPanel.test.tsx` (WS lifecycle
  edges).
- `value-coverage.test.js` N1 characterization case.

**Explicitly NOT reopened:** SF-1/SF-2/SF-3/SF-5 (verified fixed), SF-10.2
(pre-existing, dispositioned — the `assert.ok(true` sweep must return
exactly **1**, not 0, because of it), N1 (accepted under WATCH-S2-C), AC-6
(scheduling gate, not a testable gap).

### Project-specific risk surfaces flagged by this project's own defect catalog (`PROJECT-CONTEXT.md` §9)

- **§9.3 VACUOUS-GUARD — the highest-density recurring risk surface on this
  exact file family, and it has already recurred on this exact effort.**
  `PROJECT-CONTEXT.md`'s own 2026-08-05 note on `intake/2026-08-05-coverage-on-demand/`
  records **four** §9.3-family events in the Slice-2 build/QA pipeline itself
  (down from 9 → 8 → 4 across three consecutive efforts on
  `value-summary-tick.js`/`value-coverage.js`), and names a **new**
  sub-pattern from that same pass — **THE GUARD IS THE VACUITY** — where the
  MANDATORY named deliverable (`value-coverage-parity.test.js`) was itself
  briefly the vacuous guard before being caught and genuinely repaired. This
  test-plan's own P0/P1 items are written with an explicit RED-before/
  GREEN-after procedure per case for exactly this reason — **every one of
  them must be independently re-run and observed, not accepted from a
  sub-agent's report** (§9.3's AGENT-SELF-REPORTED-RED sub-pattern). Watch
  specifically for the catalog's named detectors: TEST-PINS-THE-DEFECT (a
  scope-qualifying comment that accommodates a known gap instead of
  reporting it) and REGISTRATION≠EXECUTION (a registry/meta-test proving
  entries exist without proving the harness iterates them).
- **§9.8 OVERLOADED-ABSENCE** — SF-6's own catalog id. The fix's whole point
  is that "first observation, already complete" must not collapse into the
  same silent absence as "never observed." The test-plan's negative case
  (case 2: not-yet-complete first observation → zero broadcasts) exists
  specifically to bound the fix against the obvious overcorrection.
- **§9.1 DERIVED-DUAL-VIEW (7 occurrences)** — SF-4's catalog id. The 4-step
  probe composition (assemble → probe → sweep-state read →
  `coverageSnapshot`) is written twice, once per route handler, and has
  *already diverged once* on `requestedAt`. T7 is this pattern's "scan for
  copies of the helpers too" corollary landing on the route↔route seam that
  fit none of this project's three existing per-module spec files — which is
  exactly why it shipped with no guard the first time.
- **§9.7 HAND-SCOPED STRUCTURAL SCAN (7 occurrences)** — N2's catalog id.
  `STATE_TO_LOCALE_KEY`'s silent `continue` past an unmapped registry member
  is this pattern's exact shape; the fix is an **exact**-exemption assertion
  (`deepEqual`, not a subset check) so registry growth breaks the test at the
  point of growth, not later.
- **MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH** (candidate pattern, registered
  *this QA pass* by the test-plan itself for SF-8) — worth carrying forward:
  the test-plan's own P1-deferred item recommends a standing test convention
  ("any component test file for a component taking an entity-id prop must
  include one 'switch the id, assert the state followed' case") rather than
  a one-off fix; record that convention in this build's own decision log if
  it lands.

## Durable-cure obligations (MANDATORY — not optional, cite plan/catalog id)

1. **SF-8 fix must be structural, not incidental.** `PlanLedgerPanel`'s
   coverage state must be reset (or made `project_id`-aware) on every
   `projectId` change — test-plan step 2's preferred fix
   (`useEffect(() => setCoverage(null), [projectId])`) over keying the panel,
   because keying only fixes `coverage` and does not stop the *next*
   entity-scoped field from inheriting the same leak
   (MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH).
2. **SF-9's per-leg isolation must ship as a reusable helper**
   (`expectPanelCoreIntact`), not a one-off assertion — it is the template
   for every future leg added to the panel's `Promise.all`.
3. **SF-6's fix must not overcorrect.** Both cases (complete-on-first-observation
   broadcasts once; not-yet-complete-on-first-observation broadcasts zero
   times) are P0 — shipping only the positive case is a known failure shape
   on this exact file (§9.3, TEST-PINS-THE-DEFECT).
4. **T7 (SF-4) and N2 must each be red-proven by the exact mutations the
   test-plan names**, then reverted — not merely written and left green:
   - T7: (a) hardcode `draining: false` in one route → literal-substring
     assertion must go red; (b) add a 6th key to only one route's
     `coverageSnapshot(...)` call → key-set `deepEqual` must go red.
   - N2: temporarily add a 4th `DEMAND_STATES` member with no locale key →
     the new case must go red while the four existing per-locale cases stay
     green.
5. **No pre-existing assertion may be weakened or deleted to make the
   suites pass.** Any pre-existing broadcast-count assertion that changes
   as a side effect of the SF-6 fix needs its own one-line written
   justification, not a silent adjustment.
6. **`qa/decisions.md` is a Definition-of-Done item**, not optional
   documentation — four categories of dated rows are required (see Surfaces
   touched, P2).

## Worktree set

Single-repo project (confirmed via `PROJECT-CONTEXT.md` §"Repo topology" —
self-contained monorepo, no sibling repos; re-confirmed by the existing
`git worktree list`, which shows only this repo's worktrees). One worktree
provisioned, following this project's established sibling-effort convention
under `/Users/sara/CODE-LOCAL/SARA/efforts/`.

| | |
|---|---|
| Path | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor` |
| Branch | `effort/2026-08-05-coverage-on-demand-qa-fix` (**new branch** — checked for collision against `git branch -a`, none found) |
| Base ref | `master` at provisioning time |
| Starting commit | `4c2e93187f5fe3edb64099992f4e3eceda8a0e99` (`feat(server,client): coverage-on-demand — Value Pool Slice 2`) |
| Worktree status at handoff | clean (`git status --porcelain` empty) |

**Distinct from the prior Slice-2 build worktree.** The earlier
`effort/2026-08-05-coverage-on-demand` worktree (also at `4c2e931`, also
clean) is the **already-merged** Slice 2 implementation effort and is left
untouched — this is a new, separate branch/worktree for the QA-fix follow-up
only, per this task's explicit instruction not to reuse or mutate it.

**`master`/`origin/master` state at triage (re-verified live, not assumed
from the test-plan's own header, which was written earlier today and is
stale on this point):** `git rev-parse master` == `git rev-parse
origin/master` == `4c2e93187f5fe3edb64099992f4e3eceda8a0e99` — **0 ahead / 0
behind**, already pushed. The test-plan's "not yet on `origin/master`"
premise no longer holds; nothing to reconcile before this build starts.

**Concurrent-session check (per this project's standing guidance — `ps`/
`lsof` before/during git ops).** Multiple `claude` CLI processes remain
attached to the main checkout's cwd (confirmed live: PIDs 264, 96004, 96133,
98278, plus a `vite`/`esbuild` dev-server pair). No git operation touched the
main checkout beyond read-only `status`/`rev-parse`/`branch`/`worktree list`
during this triage; the new worktree was provisioned via `git worktree add`
against the committed `master` ref only, and the main checkout's working
tree (the pre-existing modified `PROJECT-CONTEXT.md` and untracked intake
files noted at session start) was left untouched. This build's work must
happen exclusively inside the new worktree from here on.

**Shared-DB caution carried forward (§9.5/§9.6, and this project's standing
TEST-AGAINST-LIVE-DB decline).** This build ships no new DDL, but its test
suites still `require("../db")`, which migrates the shared
`~/.claude/agent-dashboard/dashboard.db` at boot for *every* process
regardless of worktree. Ensure `DASHBOARD_DB_PATH` is set to a scoped temp
path for every test invocation, exactly as the prior Slice-2 build brief
required.

## Docker stack

**Not provisioned — re-confirmed, matches the prior Slice-2 triage finding
verbatim; nothing about this changed.** `docker-compose.yml` and
`docker-compose.full.yml` exist at the project root, but both are
single-container **production deployment** wrappers around the same host
`~/.claude/agent-dashboard` SQLite file that `npm run dev`/`npm start`
already use — not a per-effort isolated stack. `PROJECT-CONTEXT.md`
documents no per-effort port registry or cross-service override registry.
The test-plan's own "How to run" section confirms this explicitly: "No
external stack, Docker, base URL, or seeded shared DB is required — every
server spec boots its own throwaway SQLite file and an ephemeral HTTP+WS
server on port 0." Skipped per the standing instruction.

## Effort registry

Not provisioned — `PROJECT-CONTEXT.md` documents no effort-registry file for
this project (same finding as the prior Slice-2 triage). Existing sibling
worktrees under `/Users/sara/CODE-LOCAL/SARA/efforts/` follow the
`<slug>/Claude-Code-Agent-Monitor` layout by convention alone; this worktree
now matches.

## Back-out command

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor \
  reset --hard 4c2e93187f5fe3edb64099992f4e3eceda8a0e99
```

(The worktree is brand new and currently identical to its branch point, so
this is a no-op unless/until the build commits or dirties it.)

## Open questions

**Non-blocking, with stated assumption:**

1. **P3 items (test-plan §"P3", DoD's P3 checklist)** are explicitly
   optional per the test-plan's own text ("do only if the P0-P2 set is
   green and time allows... mark each done or explicitly skipped with a
   reason"). **Assumption:** the build team attempts P0-P2 first in full,
   then P3 in the order listed, and records any P3 skip with a reason in the
   build report — not a triage blocker.
2. **`qa/decisions.md` does not exist yet** — the test-plan instructs
   creating it (step 10) as part of this build's own work, not triage's.
   **Assumption:** the build team creates it inside the new worktree, per
   the test-plan's exact required rows, before declaring P2 done.

**No blocking open questions.** Both plans are present and buildable, the
test-plan corresponds to the technical-plan's shipped surfaces, the new
worktree is clean and isolated from the prior Slice-2 build's worktree and
from the main checkout, `master`/`origin/master` are already reconciled
(0 ahead/0 behind), and no Docker stack applies.

---

## Verdict: READY
