# Build Brief — trunk-drift-detection

Slug: `2026-08-02-trunk-drift-detection`
Prepared by: Build-Intake Clerk
Date: 2026-08-02

**STATUS: READY — Phase 1a ONLY.**

## Critical scope boundary — read before planning any task

This build is **Phase 1a only**: the detector module, read-only, no schema
change (`server/lib/trunk-drift.js`, shared `server/lib/git-refs.js`,
`GET /api/projects/:id/trunk-drift`, a read-only Project Detail card), plus
DEC-4's logging-only fix widened per the QA pass to cover exit 4
(`!available`) and exit 5 (`stdout == null`) of `classifyFlaggedDetours`.

**Phase 1b is NOT authorized.** Per `decisions.md` **WATCH-5**, Phase 1b (the
`detour_dispositions.source` CHECK-widening rebuild, `server/lib/db-rebuild.js`,
the `detours.js` write adapter, `reconciliation.js`'s periodic-tick wiring) is
explicitly gated on Sara reviewing a live pending write-back failure
(`detour_dispositions` id 19, `write_status='failed'`) and closing DEC-7's live
trial. WATCH-5's status in `decisions.md` is **PENDING** — the gate has not
closed. `technical-plan.md` §4 Steps 8–16 (the `rebuildTableAtomically` helper,
the CHECK widening, the label composers, `recordTrunkDriftDetour` /
`backfillTrunkDriftDetours`, prompt-budget hardening, and the periodic
`reconcileCwd` invocation) are **all Phase 1b and out of scope for this build.**
`test-plan.md` is itself scoped to Phase 1a only (its own header says so
explicitly) and contains no Phase 1b test cases to build against.

**Build-planner (next step): the task list that follows this brief must cover
`technical-plan.md` §4 Steps 1–7 only** (git-refs extraction, the detector, the
route, the client card, the DEC-4 logging carve-out widened per the QA pass,
docs). Building any Phase 1b code — a schema migration, a
`detour_dispositions` write path, `db-rebuild.js`, or the periodic tick call —
would violate an explicit, recorded human gate and must not happen in this
build.

## What we're building

A new git-derivation module, `server/lib/trunk-drift.js`, gives the dashboard
a live-computed, read-only signal for commits that landed directly on a
repo's trunk/default branch — bypassing the tracked worktree/focus flow — the
failure mode that has produced at least three un-recorded capability drops on
this repo alone and today is found only by a human running a manual sweep. It
resolves the repo's default branch through a new shared helper,
`server/lib/git-refs.js` (extracted from `update-check.js`'s ref-resolution
primitives, with a new remote-optional `resolveDefaultBranch`), then runs one
bounded, git-native `--first-parent --no-merges --not --exclude=<trunk>
--branches` walk to find commits that are on trunk's first-parent line, are
not merges, and are not reachable from any other local branch (DEC-5's
false-positive guard). It reads no SQLite, writes nothing, and caches nothing
— same posture as `repo-topology.js`. The result surfaces on a new
`GET /api/projects/:id/trunk-drift` route and a new, purely read-only Project
Detail card ("Direct-to-trunk work"): default branch, commit count, lookback
window, and the commit list. Alongside this, `reconciliation.js`'s
`classifyFlaggedDetours` gains two logging-only lines (DEC-4's carve-out,
widened by QA to cover both silent-failure exits) so DEC-7's live trial this
week has a working instrument instead of a silent one. No classification
logic, no disposition vocabulary change, no schema change, no
`detour_dispositions` write, no layer-7 UI.

## Plan sources

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-trunk-drift-detection/technical-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-trunk-drift-detection/qa/test-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-trunk-drift-detection/decisions.md` (DEC-1…DEC-5, WATCH-1…WATCH-8 — read in full; WATCH-5 is the hard scope gate)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-trunk-drift-detection/pm-plan.md` (context)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-trunk-drift-detection/qa/qa-assessment.md`, `qa/supporting/` (context behind `test-plan.md`'s coverage-gap table)

Read `technical-plan.md` and `test-plan.md` in full before implementing. The
test-plan's tests correspond directly to the technical-plan's Phase 1a change
set — same surfaces: `server/lib/git-refs.js`, `server/lib/trunk-drift.js`,
`server/routes/projects.js`, the `ProjectDetail.tsx` card, the four
`projectDetail.json` locales, and `reconciliation.js`'s
`parseDispositionOutput`/`classifyFlaggedDetours`. No drift found between the
two plans within Phase 1a scope. (The technical-plan additionally covers
Phase 1b surfaces — `db-rebuild.js`, `db.js`'s CHECK widening, `detours.js`'s
write adapter — that `test-plan.md` deliberately does not test, consistent
with the scope boundary above.)

## Buildability check

- **Technical-plan**: concrete **Change set** (§3, file-by-file, with literal
  code shapes and exact guard orderings) and concrete, sequenced
  **Implementation steps** (§4, 16 steps, each independently checkable, red-first
  discipline stated explicitly). Phase 1a is Steps 1–7, cleanly separated from
  Phase 1b (Steps 8–16) by an explicit "GATE between phases" section. Buildable
  as written for Phase 1a.
- **Test-plan**: names **specific spec files + assertions** for every Phase 1a
  surface (`git-refs.test.js`, `trunk-drift.test.js`, `projects.test.js`'s new
  `describe` block, `reconciliation.test.js`'s two new blocks,
  `ProjectDetail.test.tsx`, `i18n.test.ts`), a numbered, dependency-ordered
  13-step **Implementation steps** list, and a red-first discipline with ten
  named red-proofs (RP-1…RP-10), each with its exact mutation and expected
  failure. Not vague — buildable as written.
- **Not blocked** on this axis.

## Repo layout

Confirmed via `PROJECT-CONTEXT.md` ("Repo topology," confirmed 2026-07-31) and
independently re-verified now: `find <root> -maxdepth 2 -name .git` finds only
the top-level `.git`. **Single self-contained monorepo** — Express/SQLite
server, React+Vite client, MCP server, Electron desktop app, VS Code
extension, all under one root, no sibling repos. Base/working branch:
`master` (`refs/remotes/origin/HEAD` → `refs/remotes/origin/master`; local
checkout was also on `master` at provisioning time). One repo touched — this
effort's whole Phase 1a change set (server libs/routes, client
pages/lib/i18n, docs) lives in this one repo.

**Docker: not provisioned, consistent with every prior triage pass on this
repo** (`2026-07-26-focus-calendar-board`, `2026-07-31-focus-untracked-commits`,
`2026-08-01-build-project-manager`, `2026-08-02-practice-kind-override`). Three
docker-compose files exist (`docker-compose.yml`, `docker-compose.full.yml`,
`monitoring/docker-compose.yml`), but per `.claude/skills/devops/SKILL.md`
these describe the containerized **production** build path, a separate,
optional path from the native dev/test loop. `technical-plan.md` §6.6 and
`test-plan.md`'s "How to run" section both verify exclusively via
`npm run test:server` / `npm run test:client` / single-spec `node --test`
runs against real throwaway git repos and an OS-assigned Express port — no
external stack, no browser e2e. **Skipped.**

**Effort registry: none configured.** `PROJECT-CONTEXT.md` names no effort
registry for this project — step skipped, consistent with every prior triage
pass on this repo.

## Safety gate

The main repo checkout (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`)
carries substantial pre-existing, unrelated, in-flight work at the moment of
provisioning (per the git status snapshot at session start): 43 modified
files (docs, i18n locale JSON, client components/pages, server routes/lib,
`server/db.js`) plus two untracked files
(`server/__tests__/consumption-rate.test.js`, `server/lib/consumption-rate.js`)
and an untracked `intake/2026-08-02-practice-kind-override/build/` directory.
**None of this overlaps this build's Phase 1a change set** — the technical
plan touches `server/lib/git-refs.js` (new), `server/lib/trunk-drift.js`
(new), `server/lib/update-check.js`, `server/routes/projects.js`,
`server/lib/reconciliation.js`, `client/src/lib/types.ts`,
`client/src/lib/api.ts`, `client/src/pages/ProjectDetail.tsx`, the four
`projectDetail.json` locales, plus docs — of these, `server/routes/projects.js`,
`client/src/lib/api.ts`, `client/src/lib/types.ts`, `client/src/pages/ProjectDetail.tsx`,
and the `projectDetail.json` locales **are** already dirty in the main
checkout (unrelated in-flight work, confirmed by content — Sidebar/OpenTerminalModal/
usage/color-thresholds/account work, not trunk-drift). This is expected and
harmless for an isolated worktree, but is a real merge-time consideration for
whoever reconciles both efforts later: those files will diverge between the
main checkout's WIP and this effort's worktree.

**Per-effort worktree provisioned and verified clean**, independent of the
main checkout's dirty state:

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor status --porcelain
(no output)
```

Clean. The worktree was created with `git worktree add <path> -b <branch>
master` — a checkout from the branch ref/commit at the moment of creation,
not from the main checkout's dirty index or working tree — so none of the
main checkout's uncommitted state was or could be carried into it, and none
of the main checkout's WIP was touched or disturbed by provisioning this
worktree. **Verdict: clean. Proceeding.**

## Worktree set

| Repo | Worktree path | Branch | Type | Starting commit |
|---|---|---|---|---|
| Claude-Code-Agent-Monitor | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor` | `effort/2026-08-02-trunk-drift-detection` | new branch off `master` | `5bed29aca2d7a587d75a0d8b427cf76a0d128e7d` |

- Base branch: `master`.
- Created via: `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor
  worktree add
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor
  -b effort/2026-08-02-trunk-drift-detection master`.
- Verified clean immediately after creation (see Safety gate above).
- No other repos exist under this project (confirmed by `PROJECT-CONTEXT.md`
  and by `find <root> -maxdepth 2 -name .git` finding only the top-level
  `.git`), so there are no "untouched repos" needing a base-HEAD-only
  worktree.
- Efforts convention: the shared sibling directory
  `/Users/sara/CODE-LOCAL/SARA/efforts/<slug>/<repo-name>`, matching the
  convention this project's four prior triage passes established and used
  (most recently `2026-08-02-practice-kind-override`, still active at
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor`,
  branch `effort/2026-08-02-practice-kind-override`, unaffected by this
  provisioning).

## Docker stack

**Not provisioned.** See "Repo layout" above for full reasoning.

## Surfaces touched (Phase 1a only)

**Git-derivation layer:**
- **NEW** `server/lib/git-refs.js` — `execGit`, `listRemotes`,
  `pickCanonicalRemote`, `REMOTE_PRIORITY` (moved verbatim from
  `update-check.js`), plus new `resolveDefaultBranch`.
- **MODIFIED** `server/lib/update-check.js` — deletes its private
  `REMOTE_PRIORITY`/`listRemotes`/`pickCanonicalRemote`, imports from
  `./git-refs`; keeps its own private `execGit` (120 s fetch default) and
  `resolveCompareRefForRemote` byte-for-byte unchanged. `module.exports`
  stays `{ getUpdatesStatus, DEFAULT_ROOT }`.
- **NEW** `server/lib/trunk-drift.js` — `detectTrunkDrift`, the detector.
  Imports `{ execGit, resolveDefaultBranch }` from `./git-refs` and
  `{ isGitRepo }` from `./repo-topology`. Writes nothing, reads no SQLite,
  caches nothing.

**API layer:** **MODIFIED** `server/routes/projects.js` — one new route,
`GET /:id/trunk-drift`, beside `GET /:id/repos` (~line 381), with a
per-mapped-path try/catch fan-out so one repo's git failure cannot suppress
another's result. `/:id/repos`'s response shape is unchanged.

**Client layer:** **MODIFIED** `client/src/lib/types.ts`, `client/src/lib/api.ts`
(new `projects.trunkDrift(id)`), `client/src/pages/ProjectDetail.tsx` (new
read-only "Direct-to-trunk work" card, `data-testid="trunk-drift-card"`, no
badge/verdict/action button), and all four
`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` in the same change.

**Reconciliation layer (DEC-4 carve-out, widened per QA):** **MODIFIED**
`server/lib/reconciliation.js` — `parseDispositionOutput`'s terminal catch and
its zero-verdicts-for-a-non-empty-batch path each gain one `log()` call
(unchanged behavior, zero verdict impact); `classifyFlaggedDetours` gains two
more `log()` calls at exit 4 (`!available`, CLI unavailable) and exit 5
(`stdout == null`, CLI answered nothing/crashed/timed out) — the QA-mandated
widening (test-plan.md G3/Block B) so the two silent failure modes are
distinguishable in the log before DEC-7's live trial runs. Logging-only, no
control-flow or verdict change.

**Test layer:** new `server/__tests__/helpers/single-home.js`,
`server/__tests__/git-refs.test.js`, `server/__tests__/trunk-drift.test.js`;
updated `server/__tests__/projects.test.js`, `server/__tests__/reconciliation.test.js`,
`client/src/pages/__tests__/ProjectDetail.test.tsx`,
`client/src/i18n/__tests__/i18n.test.ts`,
`client/src/pages/__tests__/screens.snapshot.test.tsx` (regenerate only after
eyeballing the diff).

**Docs:** `docs/API.md` (new route), `ARCHITECTURE.md` (new derivation
module and its recompute-per-request posture), `server/README.md`
(`DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS` env knob), `docs/DATABASE.md` (a note
that the Phase 1b `source` enum widening is deferred, not that it shipped).

**Project-specific risk surfaces flagged, per `PROJECT-CONTEXT.md` §9 and
`decisions.md`:**

- **§9.7 HAND-SCOPED STRUCTURAL SCAN (OPEN, 4 cited occurrences).** This is
  the change that catalogued it. The `git-refs.js` export surface is consumed
  by two independent paths (`update-check.js`, `trunk-drift.js`); QA's
  `assertSingleHome` helper (`server/__tests__/helpers/single-home.js`) must
  derive its scope from `Object.keys(require("../lib/git-refs"))`, never a
  hand-typed name list, and must fail loudly naming any export with no
  disposition at any consumer. This is a **mandatory durable-cure obligation**
  below, not optional test scaffolding.
- **§9.3 VACUOUS-GUARD.** DEC-5's false-positive predicate (all three clauses)
  and the `assertSingleHome` scan itself must each be proven red by mutation
  before they count — `technical-plan.md` Step 8's RP-1/RP-2 and
  `test-plan.md`'s RP-3…RP-6 name the exact mutations and expected failures.
- **§9.2 row-id-as-chronology-proxy** is explicitly bounded out of the
  detector by DEC-5: commit sequencing is git's own DAG order
  (`--first-parent`), never `committedAt`/`created_at`. `trunk-drift.js` must
  not re-sort by any timestamp — test-plan case 7 asserts this directly.
- **§9.1 DERIVED-DUAL-VIEW does NOT apply in its strict form** to the three
  label composers (per PM §4.3, upheld in `technical-plan.md` §2.3 item 5) —
  but this is a Phase 1b concern (`formatTrunkDriftLabel` doesn't exist until
  Step 12) and is flagged here only so it is not mistakenly "fixed" if a
  Phase 1a implementer notices the pattern early.

## Durable-cure obligations (MANDATORY, Phase 1a)

1. **§9.7 — `server/__tests__/helpers/single-home.js` (`assertSingleHome`)
   ships in this build, not deferred.** `test-plan.md`'s own "Durable-cure
   decision" section argues this explicitly: §9.7 is OPEN with a roughly-daily
   recurrence rate, this change is the instance that catalogued it, and it is
   the rare moment the cure's first real consumer (`git-refs.js`) is created
   in the same commit. Scope must be **derived** from
   `Object.keys(require("../lib/git-refs"))`, never hand-typed; every export
   needs an explicit `shared`/`private`/`absent` disposition at each of
   `update-check.js` and `trunk-drift.js`; proven red by RP-6 (add a 5th
   export, confirm the scan fails naming it).
2. **G1's three-part guard is load-bearing, not decorative:** `execGit` must
   stay a **private, undestructured** copy in `update-check.js` (its 120 s
   fetch-safe default must not be silently inherited from `git-refs.js`'s
   10 s default); the fetch call site's explicit `timeout: 120_000` must stay
   assertable in source text (never assert on the dead `?? 120_000` fallback);
   every `execGit(` call inside `trunk-drift.js` must carry an explicit
   `timeout:` argument. Proven red by RP-3/RP-4/RP-5.
3. **DEC-5's false-positive predicate — all three clauses proven red by
   mutation, including the worktree flow (G4).** RP-1 (drop
   `--first-parent`/`--no-merges`, case 3 must fail), RP-2 (drop only the
   `--not --exclude --branches` tail, cases 3b **and** 3c must fail — 3c is
   the new worktree-flow case QA added because all 14 originally-planned
   cases used plain `git branch`, never `git worktree add`). This is the
   single most load-bearing red-proof pair in the whole build per
   `test-plan.md`'s own framing.
4. **Per-repo failure isolation in the route's fan-out loop (G5).** R5's
   three-repo mixed-state case (healthy / empty / `makeCorruptRepo`) must
   prove one repo's git failure cannot suppress another repo's fully-populated
   result in the same 200 response.
5. **`skipped` never renders as "clean," server-side or client-side.**
   `ProjectDetail.test.tsx` case 3's `not.toBe(cleanText)` is the actual
   guard (case 2 alone is passable by rendering both states identically) —
   build against case 3, not just case 2.
6. **DEC-4's widened logging carve-out (G3) — both silent failure modes must
   be distinguishable in the log**, per Block B's B1/B2 `assert.notEqual`
   requirement: "CLI unavailable" and "CLI answered nothing" must not produce
   the same log text, or DEC-7's live trial still can't tell which failure
   mode dominates.
7. **`decisions.md` amendment is a required non-test task, not optional
   prose:** DEC-4's row must be amended to record the widened scope (exits 4
   and 5, not just `parseDispositionOutput`), and WATCH-5's trial note must
   record that the instrument now distinguishes
   CLI-unavailable / CLI-returned-nothing. Per `test-plan.md` step 1: without
   this amendment, the build is editing `reconciliation.js` outside its
   authorized carve-out.
8. **Behavior-preservation proofs are Definition-of-Done gates, not
   suggestions:** `git diff --stat server/__tests__/update-check.test.js`
   empty and that spec green after the `git-refs.js` extraction; R6
   (`GET /:id/repos`'s key set) green **before and after** the new route
   lands; `reconciliation.test.js` / `reconciliation-full-tick.test.js`'s
   pre-existing `describe`/`it` blocks unedited and green.

## Back-out command(s)

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor reset --hard 5bed29aca2d7a587d75a0d8b427cf76a0d128e7d
```

## Open questions

**BLOCKING:** none.

**Non-blocking (assumption stated):**

1. **Phase 1b is out of scope, not merely deferred within this build.** Any
   Phase 1b work (schema, `db-rebuild.js`, `detours.js` write adapter,
   periodic-tick wiring) surfaced by `build-planner` or an implementer should
   be flagged back rather than built — WATCH-5's gate is Sara's call, not a
   build-time judgment call, and `decisions.md` records its status as
   **PENDING** (unresolved) as of this triage.
2. **Docker / effort-registry non-provisioning** are project-level "not
   configured" calls, consistent with every prior triage pass on this repo,
   not a fresh judgment call unique to this effort.
3. **`server/routes/projects.js`, `client/src/lib/api.ts`, `client/src/lib/types.ts`,
   `client/src/pages/ProjectDetail.tsx`, and the `projectDetail.json` locales**
   are all dirty in the main checkout with unrelated in-flight work (see
   Safety gate). This is expected and not a blocker to starting in the
   isolated worktree, but is worth a heads-up for whoever reconciles both
   efforts at merge time — these files will need a real merge, not a fast
   rebase.
4. **A second effort worktree (`2026-08-02-practice-kind-override`) is
   already active on this repo**, on its own branch, unaffected by this
   provisioning. Most of the two efforts' Phase 1a change sets don't overlap
   (practice-kind-override touches Playbook/coach surfaces; this effort
   touches trunk-drift/reconciliation surfaces) — but **`client/src/lib/api.ts`
   and `client/src/lib/types.ts` are touched by both** (practice-kind-override
   adds Playbook override fields; this effort adds `TrunkDriftCommit` /
   `TrunkDriftResult` / `ProjectTrunkDriftResponse` types and a
   `projects.trunkDrift()` api method). Both efforts are additive to different
   sections of the same two files, so a clean merge is likely, but this is a
   real merge-time consideration, not a hypothetical — flag it explicitly
   when either effort merges second.
