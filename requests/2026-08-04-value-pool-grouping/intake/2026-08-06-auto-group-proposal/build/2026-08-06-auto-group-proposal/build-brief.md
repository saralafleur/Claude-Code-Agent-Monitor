# Build Brief — Value Pool Slice 3: Auto-group proposal engine

**Triage date:** 2026-08-06 (retry pass — supersedes the prior BLOCKED brief
below the divider)
**Effort slug:** `2026-08-06-auto-group-proposal`
**Outer skill invocation:** `auto direct` — auto-pilot + direct, **NOT fast**
(a real test-plan exists; full test-plan gate applies).

## Verdict: READY

**Prior block resolved.** The previous triage pass BLOCKED on an uncommitted
`PROJECT-CONTEXT.md` modification (200-line SF-4 DISPOSITION addition) sitting
dirty on `master`. That change has since been committed
(`d3842493bb6902181cc4991c855bda25ffa6cf7d`, "docs(intake): record Value Pool
Slice 3 intake and QA pass (auto-group proposal engine)") and pushed
(`origin/master` matches). Re-verified this pass:

```
$ git status --porcelain   # on master, main checkout
?? .claude/agent-plan-backups/
```

Only the pre-existing, known-benign untracked `.claude/agent-plan-backups/`
noise remains (unrelated to this effort, already noted by prior triage runs
in this same intake chain) — `master`'s tracked working tree is clean.
`master` HEAD == `d3842493...` == `origin/master`.

## Worktree set

Single-repo project (confirmed, see "Repo layout" below) — one worktree.

| | |
|---|---|
| Path | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor` |
| Branch | `effort/2026-08-06-auto-group-proposal` (**new**, off `master`) |
| Starting commit | `d3842493bb6902181cc4991c855bda25ffa6cf7d` |
| Base ref | `master` |
| Command used | `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor worktree add /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor -b effort/2026-08-06-auto-group-proposal master` |
| Post-create status | `git -C <worktree> status --porcelain` → empty (clean) |

Existing sibling worktrees (unaffected, for reference):
```
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor              effort/2026-08-02-trunk-drift-detection
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-trunk-drift-open-branch-blindness/Claude-Code-Agent-Monitor  effort/2026-08-03-trunk-drift-open-branch-blindness
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor              effort/2026-08-04-altitude-invalidation
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor          effort/2026-08-05-coverage-on-demand-qa-fix
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor                 effort/2026-08-05-coverage-on-demand
```

## Back-out command

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor reset --hard d3842493bb6902181cc4991c855bda25ffa6cf7d
```

(No commits have been made in the worktree yet — this is a no-op reset to
the starting point, recorded here for when it isn't.)

## What we're building

Value Pool Slice 3 adds an auto-group proposal engine: mechanical
pre-grouping of value-pool units followed by LLM-assisted refinement and
hierarchical rollup, exposed via a new server module, new schema tables, an
extended route surface (replacing the old SF-4 `coverageSnapshot`
hand-duplication with a single extracted function), and a client panel
update to surface proposed groups for review.

## Plan sources

- Technical plan: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/technical-plan.md`
- Test plan: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/qa/test-plan.md`

Both confirmed present, non-empty, and buildable (953 / 838 lines
respectively; concrete change set + implementation steps in the technical
plan, specific spec files + red-first discipline in the test plan). Plans
correspond — heading correspondence between technical-plan §3-8 (schema →
SF-4 extraction → mechanical/LLM grouping → routes/client) and test-plan
"Test change set" (a)-(d) (backend pure-function specs, structural registry
specs, route/E2E specs, client component specs).

**Corrections owed back to technical-plan.md**, per the test-plan's own
"Build-time obligations (flag-backs)" section — not triage blockers, flagged
here for `build-planner`/`build-implementer`:
- **BO-2:** technical-plan §6.1 needs a T7-successor table added.
- **BO-4:** technical-plan §9's file list needs `ledger-metrics-parity.test.js`
  added.

## Repo layout

`find /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor -maxdepth 2 -name
.git` returns only the root `.git` — matches `PROJECT-CONTEXT.md`'s "Repo
topology" section (self-contained monorepo, no sibling repos). One worktree
needed, provisioned above.

## Surfaces touched (from technical-plan §9)

- **New — server:** `server/lib/value-groups.js` (mechanical pre-grouping +
  LLM refinement + hierarchical rollup), new schema tables (§4, three new
  tables in `server/db.js`).
- **New — tests:** per test-plan "Test change set" (a)-(c) — pure-function
  module specs, structural registry specs, route/real-app E2E specs (~40
  specs total across the suite).
- **Edited — server:** `server/routes/project-plans.js` (SF-4 extraction — T7
  deleted and replaced per §6.1/§6.2; new group-proposal route surface per
  §7), `server/db.js`.
- **Edited — tests:** `server/__tests__/project-plans-api.test.js` (T7
  deletion), `single-writer-guard.test.js` / `chronology-ordering.test.js`
  (§9.7 registry hygiene), plus `ledger-metrics-parity.test.js` per BO-4.
- **Edited — client:** `client/src/components/PlanLedgerPanel.tsx` (§8).
- **Edited — docs:** per repo `CLAUDE.md`'s `update-project-docs` skill.

## Durable-cure obligations (MANDATORY — carried into the build)

1. **§6 SF-4 extraction, PM-2-mandated.** `coverageSnapshot` composition
   currently hand-duplicated at `server/routes/project-plans.js:319` and
   `:352` must be extracted to a single function. **T7
   (`project-plans-api.test.js:905`) is deleted in full, not adjusted** — its
   five-claim table (per the now-committed `PROJECT-CONTEXT.md` §9.7 SF-4
   DISPOSITION note) must get a named successor for each claim, one of which
   (route↔route parity) is deliberately *not* replaced per DEC-S3-4 — that
   must be a visible, dated decision, not a silent drop. Replacement guard is
   single-definition + exact-call-site-set with a fail-closed miss branch,
   red-proven by injecting a fourth hand-copy (§9.7 HAND-SCOPED STRUCTURAL
   SCAN family) — **not** a `deepEqual(routeA, routeB)` parity guard (would
   degenerate to `deepEqual(f(X), f(X))`, the §9.3 VACUOUS-GUARD shape this
   project has hit repeatedly on this exact file).
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

(Full detail on all of the above lives in `PROJECT-CONTEXT.md`'s §9.7 SF-4
DISPOSITION section — now committed at `d3842493` — and in
`qa/qa-assessment.md` / `technical-plan.md` §6.)

## Docker stack — not applicable

`docker-compose.yml`, `docker-compose.full.yml` (root), and
`monitoring/docker-compose.yml` exist, but (per Slice 1/Slice 2 triage,
re-confirmed, nothing changed) they are single-container production
deployment wrappers / an opt-in Prometheus+Grafana observability stack — not
a per-effort isolated dev stack. `PROJECT-CONTEXT.md` names no per-effort
port registry or cross-service override registry. This slice's own
technical-plan verification commands run directly in the worktree
(`npm run test:server`, `npm run test:client`, targeted `node --test`, `npm
run dev`) — no compose invocation anywhere in either plan. Skipped.

## Effort registry

`PROJECT-CONTEXT.md` names no formal effort registry file distinct from
itself; not applicable — skipped per step 8's own escape hatch.

## Open questions

**Non-blocking, with stated assumption:**
- None. The single blocking question from the prior triage pass (whether the
  dirty `PROJECT-CONTEXT.md` change was finished, authored work) has been
  answered by its commit (`d3842493`) and push to `origin/master`.

**BLOCKING:**
- None.

---

## Superseded: prior BLOCKED pass (2026-08-06, earlier same day)

The original triage attempt BLOCKED on a dirty `master` — an uncommitted
200-line `PROJECT-CONTEXT.md` addition (the §9.7 SF-4 DISPOSITION note) sitting
in the main checkout's working tree, plus a live concurrent-session signal
(`ps` showing a long-running `claude` process cwd'd in this repo). That
diligence pass's plan/test-plan review, repo-layout confirmation, and Docker
findings are reproduced above unchanged, since nothing about the plans or
repo topology changed between passes — only the dirty-tree condition that
blocked the start has been resolved.
