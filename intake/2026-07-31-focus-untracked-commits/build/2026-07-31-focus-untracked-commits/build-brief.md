# Build Brief — focus-untracked-commits

Slug: `2026-07-31-focus-untracked-commits`
Prepared by: Build-Intake Clerk
Date: 2026-07-31

**STATUS: READY.**

## What we're building

A retroactive-documentation-plus-two-live-bug-fix effort closing the process
gap `team-status` flagged (seven merged commits, `0416066`..`60af828`, with no
intake record). Six of eight action items are paperwork: a verified
"what shipped" record (§3), two retroactive decision entries (`decisions.md`
DEC-7/DEC-8, plus a DEC-9 for the deferred durable-cure call), and two
defect-class catalogue entries in `PROJECT-CONTEXT.md`
(`DERIVED-DUAL-VIEW`, `row-id-as-chronology-proxy`). The other two are real,
contained one-file code fixes against currently-shipped, currently-live bugs
this retroactive review surfaced: (1) a React render cascade in
`useHourWindowZoom.ts` (live-zoom branch reads `Date.now()` on every render
instead of once per 60s tick, tripping "Maximum update depth exceeded"), and
(2) an un-sorted-before-`LIMIT` chronology query in
`focus-inference.js`'s `buildActivityDigest()` (the same
"row id is not chronological order" root cause `b3a2cc9` already fixed once
on this surface, now found live at a second call site with a worse failure
mode — a bad `LIMIT`-selected subset, not just a bad order). End state:
`master` unchanged in behavior except for the two bug fixes; the pipeline has
a complete paper trail; the next contributor touching `FocusReport` consumers
or the `events` table has a named pattern to grep for.

## Plan sources

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-07-31-focus-untracked-commits/technical-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-07-31-focus-untracked-commits/qa/test-plan.md`

Both plans read in full. The test-plan's tests correspond directly to the
technical-plan's change set — same two live-bug surfaces
(`client/src/hooks/useHourWindowZoom.ts`, `server/lib/focus-inference.js`),
same three backfill surfaces (`focus-report.js`'s interval-building path,
`ConcurrencyStatTile.tsx`, `server/routes/settings.js`'s export route), same
sequencing (chronology fix / render-cascade fix / cross-view parity /
backfill as four workstreams), same red-first discipline (both plans state,
per fix, "confirm fails against unfixed code" before "apply fix" before
"confirm passes"), same durable-cure framing (`DERIVED-DUAL-VIEW`,
`row-id-as-chronology-proxy`, both explicitly deferring the two structural
guards — a consumer-registry meta-test and an `ORDER BY id` grep guard — as a
provisional call flagged for the user, DEC-9). No inconsistency found between
them.

## Buildability check

- Technical-plan has a concrete **Change set** (§5, 10 numbered
  client/server/docs items) and concrete, sequenced **Implementation steps**
  via §4's exact current-code/fixed-code diffs plus §7's per-item run
  commands and §11's Definition of Done checklist.
- Test-plan names **specific spec files + assertions** (§ Test change set —
  exact case-by-case assertions for all 6 new/extended specs, e.g.
  `focus-inference.test.js` Case A/Case B with an explicit "JS-level
  post-`.all()` sort would NOT pass this case" acceptance bar) and an
  explicit **red-first** implementation sequence (§ Implementation steps,
  14 steps across 4 workstreams, each fix workstream stating what must be
  observed RED before the fix lands and GREEN after).
- Neither plan is vague — both are buildable as written. **Not blocked** on
  this axis.

## Repo layout

Per `PROJECT-CONTEXT.md` (repo root, "Repo topology" section, confirmed
2026-07-31 via the `worktree` skill's `story-discovery` pass): single
self-contained monorepo, no sibling repos, no separate repo layout to
discover. Base/working branch: `master` (`git symbolic-ref
refs/remotes/origin/HEAD` → `refs/remotes/origin/master`; local checkout is
also on `master`). One repo touched trivially — this effort's whole change
set (client hook/component/test files, server lib/test files, docs) lives in
this one repo.

Efforts convention (same one the `2026-07-26-focus-calendar-board` triage
pass established and used): a shared sibling directory,
`/Users/sara/CODE-LOCAL/SARA/efforts/<slug>/<repo-name>`, one level above all
repos under `~/CODE-LOCAL/SARA/`.

## Safety gate

The main repo checkout (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`)
currently has pre-existing uncommitted changes unrelated to this effort
(`server/db.js`, `server/routes/run.js`, `PROJECT-CONTEXT.md`,
`capture-claude-usage.sh`, `server/lib/origin-guard.js`, plus this session's
own `intake/` planning artifacts). These are explicitly **out of scope** for
this build and were **not** touched or carried into the effort worktree —
`git worktree add` checks out a new working tree from the branch ref
(commit), not from another worktree's uncommitted state, which is exactly
why this gate is run against the new worktree, not the main checkout.

Ran `git -C <worktree-path> status --porcelain` immediately after
provisioning:

```
(no output)
```

Clean. **Verdict: clean. Proceeding.**

## Worktree set

| Repo | Worktree path | Branch | Type | Starting commit |
|---|---|---|---|---|
| Claude-Code-Agent-Monitor | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-07-31-focus-untracked-commits/Claude-Code-Agent-Monitor` | `effort/2026-07-31-focus-untracked-commits` | new branch off `master` | `dfe920874b68f1219f0b16268864894ef542eb48` |

- Base branch: `master`, HEAD at time of provisioning =
  `dfe9208` (same commit as the starting commit above — the new branch was
  cut directly from it, tip commit message: "Make devops audit scripts
  respect the invoking worktree's pwd").
- Created via: `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor
  worktree add
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-07-31-focus-untracked-commits/Claude-Code-Agent-Monitor
  -b effort/2026-07-31-focus-untracked-commits master`.
- Verified clean immediately after creation: `git status --porcelain` on the
  new worktree returned no output.
- No other repos exist under this project (confirmed by `PROJECT-CONTEXT.md`
  and by `find <root> -maxdepth 2 -name .git` finding only the top-level
  `.git`), so there are no "untouched repos" needing a base-HEAD-only
  worktree.

## Docker stack

**Not provisioned**, same call the prior `2026-07-26-focus-calendar-board`
effort in this repo made, for the same reason and re-verified here:
`docker-compose.yml`, `docker-compose.full.yml`, and
`monitoring/docker-compose.yml` exist at the project root/subdirectories, but
they describe a **production-style deployment** of the whole dashboard
(single build context `.`, bind-mounting the real
`~/.claude/agent-dashboard` host directory) — not a multi-service dev/test
stack this effort's verification loop touches. Both plans confirm the
verification path is `npm run test:server` (Node's built-in test runner) and
`cd client && npx vitest run` (Vitest + RTL), no browser-e2e layer, no
containerized dependency named in either plan. `PROJECT-CONTEXT.md` names no
Docker-stack convention for this project either. Skipping now avoids standing
up an isolated stack (port-offset/`.env` bookkeeping) that nothing in this
effort's test plan will ever start; if a later build step turns out to need
one, it can be provisioned then.

## Effort registry

No effort registry exists for this project (`PROJECT-CONTEXT.md` names none)
— step skipped.

## Surfaces touched

**Client:**
- `client/src/hooks/useHourWindowZoom.ts` — §4.1 live fix (`nowMs` state
  replacing the `Date.now()`-per-render live-zoom branch; `windowIsFuture`
  reads `nowMs`).
- `client/src/hooks/__tests__/useHourWindowZoom.test.ts` (new) — first file
  under `client/src/hooks/__tests__/`.
- `client/src/components/__tests__/FocusReportModal.test.tsx` (extend) —
  new `[FocusPage extension of the standing template]` cross-view parity
  test.
- `client/src/pages/__tests__/FocusPage.test.tsx` (extend) — hardcoded
  `75%`/`25%` assertion redirected to point at the new cross-view test.
- `client/src/components/__tests__/ConcurrencyStatTile.test.tsx` (new,
  backfill).

**Server:**
- `server/lib/focus-inference.js` — §4.2 live fix (`buildActivityDigest`'s
  query: `ORDER BY id ASC` → `ORDER BY created_at ASC, id ASC` before
  `LIMIT`).
- `server/__tests__/focus-inference.test.js` (extend) — Cases A/B regression.
- `server/__tests__/focus-report.test.js` (extend, backfill) —
  >65,536-interval regression.
- `server/__tests__/settings-export.test.js` (new, backfill).

**Docs / process (no code):**
- `PROJECT-CONTEXT.md` — new `## Recurring defect-class patterns` section,
  two entries (`DERIVED-DUAL-VIEW` §9.1, `row-id-as-chronology-proxy` §9.2).
- `intake/2026-07-31-focus-untracked-commits/decisions.md` (new) — DEC-7,
  DEC-8, and DEC-9 (the durable-cure deferral, per test-plan's "Durable-cure
  decision" section — flagged as an open decision for the user, not a
  QA-lead unilateral call; the implementer should record whichever way it
  resolves rather than leaving it silent).

**Risk-surface note (this is this project's own first catalogued defect
class, established by this very build — see Durable-cure obligations
below):** the `events` table and any `FocusReport`-rendering consumer are
now named, project-specific risk surfaces per `PROJECT-CONTEXT.md` §9 (once
this build lands it). This build touches both: `focus-inference.js` reads
`events` (row-id-as-chronology-proxy, 3rd instance on this codebase) and
`useHourWindowZoom.ts` feeds a `DERIVED-DUAL-VIEW` consumer chain
(`FocusCalendarView`/`FocusPage`, 4th instance). Flag both surfaces for
extra review attention, not as a fresh/unknown risk — the plans already
name and fix the specific defects found.

## Durable-cure obligations (MANDATORY)

No formally catalogued defect-class registry exists in `PROJECT-CONTEXT.md`
yet — **this build is what establishes the first two entries** (technical-
plan §9, verbatim text to paste in). Per both plans:

1. **`row-id-as-chronology-proxy` (technical-plan §9.2, 3rd recorded
   instance on this codebase after `6e9a443` and `b3a2cc9`).** Any query or
   aggregation over `events` (or any other table `workflow-ingest.js`
   bulk-inserts into) for chronological logic must sort by `created_at`
   explicitly (id as tiebreak) — never rely on `id` order alone, and when a
   `LIMIT` is applied, the `created_at` sort must happen **before** the
   `LIMIT`. `buildActivityDigest`'s fix (`ORDER BY created_at ASC, id ASC
   LIMIT ?`) is the concrete instance; the catalogue entry generalizes it for
   future call sites. Pinned by test-plan's Case B (the "trap-defeating"
   800-filler-then-target-row fixture that a JS-level post-`.all()` sort
   would NOT pass).
2. **`DERIVED-DUAL-VIEW` (technical-plan §9.1, 4th recorded instance).** A
   value/rendering computed once and consumed by multiple independent
   client rendering surfaces must route through the extract-and-share
   discipline this codebase already established
   (`HourWindowZoomBar`/`useHourWindowZoom`, `StatTile`/`ConcurrencyStatTile`,
   `ProjectScopeFilters`) — never hand-copy a formula into a new consumer.
   This build's §4.1 fix stabilizes `useHourWindowZoom.ts` at its one
   source, not per-consumer. Pinned by the new
   `[FocusPage extension of the standing template]` cross-view parity test
   (must assert on a **shared fixture object reference**, per test-plan's
   own single-source-of-truth guardrail — do not accept two
   separately-authored "equivalent" fixtures for the two trees).
3. **Fix-at-source, not fix-at-symptom, for both live bugs.** §4.1 must not
   be solved by removing `windowStartMs`/`windowEndMs` from the effect's
   dependency array (a stale-closure workaround) — that silences the
   symptom while leaving the hook producing a new value identity on every
   render. §4.2 must not be solved by a JS-level post-fetch sort — the
   `LIMIT`-before-sort trap means only a SQL-level `ORDER BY ... LIMIT`
   fix is correct (proven by Case B).
4. **File-header compliance.** Every new/edited applicable source file must
   carry the mandatory `@author Son Nguyen <hoangson091104@gmail.com>`
   header per `CLAUDE.md`/`.claude/rules/file-headers.md`; verify with
   `bash .claude/skills/file-headers/scripts/check-headers.sh` — technical-
   plan's own Definition of Done (§11) requires this, and test-plan's
   Definition of Done (step 13) separately names the 3 new test files that
   need it.
5. **Durable-cure deferral must be recorded, not silent (DEC-9).**
   Test-plan explicitly declines to build the two structural guards
   (`FocusReport`-consumer registry meta-test; `ORDER BY id`-without-
   `created_at` AST/grep guard) in this pass, framing that as an **open
   decision for the user** given this is the 4th/3rd occurrence of each
   pattern respectively and a prior QA run already recommended
   formalizing the `DERIVED-DUAL-VIEW` guard after the 3rd occurrence
   without it being acted on. The implementer must write `decisions.md`'s
   DEC-9 recording whichever way this resolves (accept-deferral-as-is or
   build one/both guards now) rather than leaving it implicit.

## Back-out command(s)

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-07-31-focus-untracked-commits/Claude-Code-Agent-Monitor reset --hard dfe920874b68f1219f0b16268864894ef542eb48
```

## Open questions

**BLOCKING:** none.

**Non-blocking (assumption stated):**

1. **Docker non-provisioning** — assumption stated above (production-style
   compose files, not part of this project's test/verification loop, same
   call as the prior `focus-calendar-board` effort). If a later build step
   turns out to need a running dashboard container for some reason not
   visible in either plan, flag it and Docker can be provisioned at that
   point.
2. **DEC-9 (durable-cure deferral) is explicitly unresolved by design** —
   test-plan frames this as a call for the user, not the implementer or this
   triage pass. Assumption: the implementer proceeds with the point-tests-
   only scope as written (both plans' Definition of Done lists only the 3
   must-add-now tests + 3 backfill tests as required-to-close), and records
   the deferral verbatim in `decisions.md` DEC-9 rather than unilaterally
   building either structural guard mid-build. If Sara wants one or both
   guards built now, that should be surfaced back to her before this build
   is marked closed, not decided silently by the build team.
3. **`decisions.md` does not yet exist in the intake folder** — expected;
   technical-plan §5 change-set item 10 and §8 name it as one of this
   build's own deliverables (DEC-7, DEC-8, and per open question 2 above,
   DEC-9). Not a blocker; flagged so the build team knows to create it, not
   look for a pre-existing one.
