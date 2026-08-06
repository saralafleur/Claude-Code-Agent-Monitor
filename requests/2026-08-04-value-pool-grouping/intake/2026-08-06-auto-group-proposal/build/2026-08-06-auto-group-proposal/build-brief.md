# Build Brief — Value Pool Slice 3: Auto-group proposal engine

**Triage date:** 2026-08-06
**Effort slug:** `2026-08-06-auto-group-proposal`
**Outer skill invocation:** `auto direct` — auto-pilot + direct, **NOT fast**
(a real test-plan exists; full test-plan gate applies).

## Verdict: BLOCKED

**Reason: dirty base branch.** `master` in the main checkout
(`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`) currently has an
uncommitted, tracked-file modification:

```
$ git status --porcelain
 M PROJECT-CONTEXT.md
?? .claude/agent-plan-backups/
?? requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/
```

- `PROJECT-CONTEXT.md` — **200 lines inserted, uncommitted**
  (`git diff --stat`: `1 file changed, 200 insertions(+)`), mtime
  2026-08-06 07:08:56, i.e. minutes before this triage pass started. The
  diff is a well-formed addition to §9.7 SF-4 DISPOSITION covering exactly
  this intake — "ruled MANDATORY for Slice 3 by `intake-project-manager`
  (PM-2)", the T7 deletion/replacement analysis, and a
  `team-qa`-strategist "QA-pass note (2026-08-06 ... GAPPED)" — i.e. this
  looks like real, finished intake-pipeline output that simply has not been
  committed yet, not a stray edit.
- The two untracked entries are the same class of pre-existing,
  known-benign untracked state prior triage runs in this same intake chain
  have already noted (`.claude/agent-plan-backups/`, and this intake's own
  folder, which is expected input) — **not** part of the block.

**This is exactly the case my safety gate exists to catch, not a false
positive to wave through.** Two independent signals point the same way:

1. **Timing.** `qa/qa-assessment.md` (mtime 07:07), `qa/test-plan.md`
   (mtime 07:18) and the dirty `PROJECT-CONTEXT.md` (mtime 07:08) in this
   same intake are all minutes old relative to this triage pass — the
   intake/QA pipeline for this exact effort looks like it finished (or is
   still finishing) writing artifacts moments ago, and the
   `PROJECT-CONTEXT.md` note appears to be one of those artifacts, not yet
   committed.
2. **Concurrent-session risk (per this project's own standing guidance,
   and explicitly re-flagged in this task).** `ps` shows multiple
   long-running interactive `claude` processes with cwd inside this repo,
   including PID 264 (started 9:41AM, ~94 CPU-minutes accumulated — still
   running) and a shell (PID 89649) also cwd'd here. I did not find a
   process with the file open via `lsof` at the moment I checked, but a
   long-lived session actively producing timestamped artifacts in this
   exact intake folder, seconds before I looked, is a live match for the
   risk this project's memory explicitly warns about ("multiple claude
   sessions share this repo's cwd... has caused real work loss").

Per my own operating rule, this is **non-negotiable**: a dirty base branch
blocks the start regardless of whether the diff looks safe or whether
`git worktree add` would technically pull from the clean committed ref
rather than this dirty working tree. I did not commit, stash, or otherwise
touch `PROJECT-CONTEXT.md` myself — finalizing another pipeline stage's
apparently-still-in-flight, uncommitted output is not this role's call to
make, and could clobber or fork a concurrent session's own commit if it is
mid-write.

**No worktree was provisioned and nothing was mutated in the main
checkout.** Only read-only `git status` / `git diff` / `git log` /
`git rev-parse` / `ps` / `lsof` were run against
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`.

**Path to READY (for whoever re-runs this triage):**
1. Confirm the concurrent session (if any) has finished writing
   `PROJECT-CONTEXT.md`'s SF-4 DISPOSITION note.
2. Commit it (a docs-only commit, matching this intake chain's own
   convention of committing `PROJECT-CONTEXT.md` notes at intake time —
   see `c8eecf3`, `c6f8154`, `975f0a2`, `64dca22`).
3. Re-run `git -C <repo> status --porcelain` and confirm empty before
   provisioning the worktree.

---

## Diligence completed despite the block (so re-triage is fast)

### Plans — confirmed present and buildable

- Technical plan:
  `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/technical-plan.md`
  (953 lines). Concrete Change set (§9, new/edited server/tests/client/docs
  files enumerated) and sequenced Implementation steps (§10, independently
  checkable), plus vocabulary/state registries (§3), schema (§4), module
  design (§5), the mandated SF-4 extraction (§6), route/client surfaces
  (§7-8), and a QA-folded verification checklist (§11). Buildable on its
  own terms.
- Test plan:
  `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/qa/test-plan.md`
  (838 lines). Names specific spec files (backend pure-function specs,
  cross-cutting structural registry specs, route/real-app E2E specs,
  client component specs — §"Test change set" a-d), fixtures, exact "How
  to run" commands with red-first diff targets ("1787/1787 pre-Slice-3"
  full-suite counts as the baseline to beat), and a Definition of Done.
  Real, thorough, ~40-spec plan (matches the task description). Both plans
  are about the same surfaces (schema → SF-4 extraction →
  mechanical/LLM grouping → routes/negative-proof → client) — confirmed by
  heading correspondence between technical-plan §3-8 and test-plan
  §"Test change set" (a)-(d).
- **Corrections owed back to technical-plan.md**, per the test-plan's own
  "Build-time obligations (flag-backs)" section — **not** triage
  blockers, flagged here for `build-planner`/`build-implementer`:
  - **BO-2:** technical-plan §6.1 needs a T7-successor table added.
  - **BO-4:** technical-plan §9's file list needs
    `ledger-metrics-parity.test.js` added.

### Repo layout — confirmed single-repo

`find /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor -maxdepth 2
-name .git` returns only the root `.git` — matches `PROJECT-CONTEXT.md`'s
own "Repo topology" section (self-contained monorepo, no sibling repos).
One worktree needed if/when triage proceeds.

### Base branch state — matches the task's expected premise

`git log --oneline -3` on `master`:
```
c233a36 docs(env,intake): close AC-6 — pin Value Pool synthesis to sonnet after real calibration
b0e3157 docs(intake): sync delivery-pipeline artifacts for value-pool-grouping slices 1-2; fix build/ gitignore anchor
5ec640b fix(server,client): close team-qa findings on Value Pool Slice 2 coverage-on-demand
```
`master` HEAD == `c233a36` (also == `origin/master`), matching the task's
stated premise ("latest commit `c233a36`") — the **history** is as
expected; only the **working tree** is dirty.

**Intended worktree (once unblocked), for the record:**
| | |
|---|---|
| Path | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor` |
| Branch | `effort/2026-08-06-auto-group-proposal` (new, off `master`) |
| Base ref | `master` @ `c233a36` (pending confirmation this is still HEAD once the dirty state is resolved) |
| Command | `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor worktree add /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor -b effort/2026-08-06-auto-group-proposal master` |

Existing sibling worktrees (for reference, all healthy):
```
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor              effort/2026-08-02-trunk-drift-detection
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-trunk-drift-open-branch-blindness/Claude-Code-Agent-Monitor  effort/2026-08-03-trunk-drift-open-branch-blindness
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor              effort/2026-08-04-altitude-invalidation
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor          effort/2026-08-05-coverage-on-demand-qa-fix
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor                 effort/2026-08-05-coverage-on-demand
```

### Docker stack — not applicable (matches prior slices' finding)

`docker-compose.yml`, `docker-compose.full.yml` (root) and
`monitoring/docker-compose.yml` exist, but per Slice 1/Slice 2 triage
(re-confirmed, nothing changed) they are single-container production
deployment wrappers / an opt-in Prometheus+Grafana observability stack —
not a per-effort isolated dev stack, and `PROJECT-CONTEXT.md` names no
per-effort port registry or cross-service override registry. This slice's
own technical-plan verification commands run directly in the worktree
(`npm run test:server`, `npm run test:client`, targeted `node --test`,
`npm run dev`) — no compose invocation anywhere in either plan. Skipped.

### Surfaces touched (from technical-plan §9, for downstream reference)

- **New — server:** `server/lib/value-groups.js` (the one new home for
  mechanical pre-grouping + LLM refinement + hierarchical rollup), new
  schema tables (§4, three new tables in `server/db.js`).
- **New — tests:** per test-plan §"Test change set" (a)-(c) — pure-function
  module specs, structural registry specs, route/real-app E2E specs
  (~40 specs total across the suite).
- **Edited — server:** `server/routes/project-plans.js` (SF-4 extraction —
  T7 deleted and replaced per §6.1/§6.2; new group-proposal route surface
  per §7), `server/db.js`.
- **Edited — tests:** `server/__tests__/project-plans-api.test.js` (T7
  deletion), `single-writer-guard.test.js` / `chronology-ordering.test.js`
  (§9.7 registry hygiene), plus `ledger-metrics-parity.test.js` per BO-4.
- **Edited — client:** `client/src/components/PlanLedgerPanel.tsx` (§8).
- **Edited — docs:** per repo `CLAUDE.md`'s `update-project-docs` skill.

### Durable-cure obligations (MANDATORY — carried into the build, cite catalog ids)

1. **§6 SF-4 extraction, PM-2-mandated.** `coverageSnapshot` composition
   currently hand-duplicated at `server/routes/project-plans.js:319` and
   `:352` must be extracted to a single function. **T7
   (`project-plans-api.test.js:905`) is deleted in full, not adjusted** —
   its five-claim table (per the pending `PROJECT-CONTEXT.md` note) must
   get a named successor for each claim, one of which (route↔route parity)
   is deliberately *not* replaced per DEC-S3-4 — that must be a visible,
   dated decision, not a silent drop. Replacement guard is
   single-definition + exact-call-site-set with a fail-closed miss branch,
   red-proven by injecting a fourth hand-copy (§9.7 HAND-SCOPED STRUCTURAL
   SCAN family) — **not** a `deepEqual(routeA, routeB)` parity guard
   (would degenerate to `deepEqual(f(X), f(X))`, the §9.3 VACUOUS-GUARD
   shape this project has hit repeatedly on this exact file).
2. **§9.1 DERIVED-DUAL-VIEW, second exposure in this same slice.**
   `groupingFacts` extends `unitFacts`, giving `unitFacts` two downstream
   comparators (`compareUnitInputs` for altitudes, `computeGroupingDigest`
   for groups) — structurally the same shape as the prior §9.1 occurrence
   (7th touch, "physically impossible" divergence that wasn't). PM-4's
   `UNCOMPARED_FIELD_GUARANTORS`-shaped key-walk test is mandated and must
   ship in the **anchored, exactly-this-exempt-set form**, not a narrowed
   version.
3. **§9.4-shaped obligation for this build's own risk analysis:** the
   test-plan's coverage-gap section and the technical-plan's §11 must stay
   reconciled — per this project's recurring "risk enumerated in prose,
   nothing mechanically compares the two sets" defect, do not let a trap
   named in one document go uncovered in the other without a dated
   decisions-log row.

(Full detail on all of the above lives in the still-uncommitted
`PROJECT-CONTEXT.md` diff and in `qa/qa-assessment.md` /
`technical-plan.md` §6 themselves, which I *did* read for this brief even
though the base branch's working-tree copy is what's currently dirty —
reading is safe, writing to it is what's blocked.)

## Back-out command

Not applicable — no worktree was created, no commit was made, nothing in
the main checkout was mutated by this triage pass.

## Open questions

**Non-blocking, with stated assumption:**
- None beyond the block itself.

**BLOCKING:**
1. Is the uncommitted `PROJECT-CONTEXT.md` change on `master` finished,
   authored work waiting on a commit, or genuinely-still-in-progress WIP
   from a concurrent session? **Assumption I am NOT making:** I am not
   assuming either answer — this is exactly the question that has to be
   answered by a human or the orchestrator before I provision a worktree,
   per this role's non-negotiable dirty-base-branch gate.
