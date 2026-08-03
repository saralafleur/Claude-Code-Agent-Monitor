# Build Brief — practice-kind-override

Slug: `2026-08-02-practice-kind-override`
Prepared by: Build-Intake Clerk
Date: 2026-08-02

**STATUS: READY** (with one mandatory plan correction — see "Corrected approach
for Step 2" below, which supersedes `technical-plan.md`'s original wording).

## What we're building

A per-practice override of a Coach Playbook practice's `kind` and
`defaultSeverity`, settable from the Playbook config UI, stored inside the
existing `playbook_practice_config.config` JSON blob as top-level
`kindOverride`/`severityOverride` keys, and resolved through one widened
`resolvePracticeConfig()` that becomes the single place in the codebase where
"this practice's effective kind/severity" is computed — the engine's two fire
sites, the route's `serializePractice()`, and both client preview cards all
read that one resolved value, enforced by a new structural guard test. The
resolved value is frozen onto the `coach_observations` row at fire time and
never re-derived, so changing an override later never relabels an existing
Observation. `defaultSeverity` is promoted to a first-class enum in the same
build (`["info","warning"]`, DB `CHECK`, TS union, i18n labels in all four
locales), which forces a one-time guarded rebuild of `coach_observations`
(SQLite cannot add a `CHECK` via `ALTER TABLE`) — this rebuild, and getting its
atomicity right, is the single highest-risk piece of the change.

## Plan sources

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-practice-kind-override/technical-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-practice-kind-override/qa/test-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-practice-kind-override/decisions.md` (DEC-1…DEC-5, WATCH-1…WATCH-3 — read in full, cited throughout below)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-practice-kind-override/pm-plan.md` (recurrence diagnosis, D1–D4 durable-fix priorities)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-practice-kind-override/qa/qa-assessment.md` (verdict: **BLIND** at assessment time, for two reasons — see below; the plan correction closes the more severe one)

Read all five in full before implementing. The test-plan's tests correspond
directly to the technical-plan's change set (same files: `server/db.js`,
`server/lib/playbook/practices.js`, `server/lib/playbook/engine.js`,
`server/routes/playbook.js`, `client/src/lib/{types,api,playbookStore}.ts`,
`client/src/pages/PlaybookPage.tsx`, the four `coach.json` locales, and the
vocabulary doc) — no drift found between them.

## Buildability check

- **Technical-plan**: concrete **Change set** (§3, 14 files modified + 1
  added, file-by-file) and concrete, sequenced **Implementation steps** (§4,
  13 steps, each independently checkable with literal code snippets and a
  "Checkable:" line). Buildable as written, **except** Step 2.2's rebuild
  shape, which QA's must-fix items F1–F3 supersede (below).
- **Test-plan**: names **specific spec files + assertions** for all 8 gating
  test groups (T1–T8), a numbered, dependency-ordered **Implementation steps**
  list (26 steps), and an explicit **red-first discipline** — every gating
  test has a stated red-proof procedure (mutation or pre-change baseline), not
  just "should be red before the fix." Not vague — buildable as written.
- **Not blocked** on this axis.

## Corrected approach for Step 2 — build against this, not `technical-plan.md`'s original wording

`technical-plan.md` Step 2.2 explicitly models the `coach_observations`
severity-`CHECK` rebuild on this repo's **`plan_items`** precedent
(`server/db.js` lines 749-807), in which only the row-copy is wrapped in a
`db.transaction()` and the surrounding `RENAME`/`CREATE`/`DROP` are separate,
unwrapped (autocommitted) statements. **`qa-risk-analyst`/`qa-lead` found this
at pre-build review, before any code was written, and classified it as a
plan defect, not a missing test** (`qa-assessment.md` headline; new catalog
entry **§9.6 NON-ATOMIC REBUILD** in `PROJECT-CONTEXT.md`). Walked through: if
the process dies between the `CREATE TABLE …_new`/rename-first steps and the
final `COMMIT`, the next boot's idempotency guard reads the *current* table's
`sqlite_master.sql` text, sees the new CHECK-bearing shape, and concludes the
migration already ran — it never runs again. Every historical Observation
sits orphaned in `coach_observations_old`, the app boots clean, nothing
throws, nothing logs, and the Coach feed is silently empty forever. A test
cannot fix this; only a plan change can. **This is not optional and not a
style preference — `build-planner` must plan against the corrected approach
below, not `technical-plan.md`'s §2.2 prose.**

**The corrected approach — `test-plan.md` §0, items F1–F3 (must land first, before any test in T1/T3 is written):**

- **F1 — one atomic transaction, create-new-then-rename shape** (model:
  `agents` rebuild, `server/db.js:1478-1514` — the *only* one of this repo's
  six existing table rebuilds that gets this right):
  1. `PRAGMA foreign_keys = OFF` **outside and before** `BEGIN` (SQLite
     ignores the pragma inside a transaction).
  2. One single `db.exec(...)` containing, in this order: `BEGIN;` →
     `CREATE TABLE coach_observations_new (…CHECK(severity IN
     ('info','warning'))…);` → `INSERT INTO coach_observations_new SELECT …
     FROM coach_observations;` → `DROP TABLE coach_observations;` →
     `ALTER TABLE coach_observations_new RENAME TO coach_observations;` →
     `COMMIT;`.
  3. Restore `PRAGMA foreign_keys = ON`, then recreate
     `idx_coach_observations_open` and `idx_coach_observations_detected_at`.
  - Use **create-new → copy → drop-old → rename**, not `plan_items`'
    rename-first direction: on rollback the original table is still sitting
    there under its own name, so even a torn WAL recovery lands on the
    pre-migration state.
- **F2 — orphan detection in the idempotency guard** (cheap belt, should be
  unreachable if F1 is correct — that's why it's worth having): gate the
  rebuild on `hasCheck && !orphanExists`, where `orphanExists` is `SELECT name
  FROM sqlite_master WHERE type='table' AND name IN
  ('coach_observations_old','coach_observations_new')`. If it ever fires,
  **log loudly and skip — never throw** (`db.js` runs at `require()` time; a
  throw bricks boot for the Express server, MCP server, Electron app, and VS
  Code extension simultaneously).
- **F3 — keep the plan's manual DoD gate**: back up the real `dashboard.db`
  before the first boot of the new build, and do the `technical-plan.md` §6.6
  manual double-boot walkthrough against a **copy** of it. F1 makes this
  safer; it does not make it optional.

The pre-flight non-conforming-data scan (WATCH-3, `technical-plan.md` §2.2's
"Pre-flight safety scan") and the "skip, don't rewrite, don't throw" rule for
out-of-enum rows are **unchanged** by this correction and still apply exactly
as `technical-plan.md` describes.

Everything else in `technical-plan.md` (Steps 1, 3–13) is unaffected by this
correction and should be built as written.

**Test-plan implication:** `test-plan.md` also deviates from `technical-plan.md`'s
naming — the migration tests land in a **new file**,
`server/__tests__/coach-observations-severity-rebuild.test.js` (not
`db-migration.test.js`, per `test-plan.md`'s own recorded rationale: the
`UPGRADE_CASES` harness is built for `ALTER TABLE … ADD COLUMN` and cannot
represent a rebuild or the interruption test's raw multi-connection control).
Build against `test-plan.md`'s file layout, not `technical-plan.md` §6.4's
file name.

## Repo layout

Confirmed via `PROJECT-CONTEXT.md` ("Repo topology" section, confirmed
2026-07-31) and independently re-verified now: `find <root> -maxdepth 2 -name
.git` finds only the top-level `.git`. **Single self-contained monorepo** —
Express/SQLite server, React+Vite client, MCP server, Electron desktop app, VS
Code extension, all under one root, no sibling repos. Base/working branch:
`master` (`git symbolic-ref refs/remotes/origin/HEAD` →
`refs/remotes/origin/master`; local checkout was also on `master` at
provisioning time). One repo touched — this effort's whole change set (server
libs/routes/db/tests, client pages/lib/i18n, docs) lives in this one repo.

**Docker: confirmed not needed for this build.** Three docker-compose files
exist (`docker-compose.yml`, `docker-compose.full.yml`,
`monitoring/docker-compose.yml`), but per this repo's own
`.claude/skills/devops/SKILL.md` these describe the **containerized
production build** path (`docker-up`/`docker-down`, `node:22-alpine`,
`NODE_ENV=production`) — a separate, optional path from the native dev/test
loop. Both plans' entire verification path is `npm test` / `npm run
test:server` / `npm run test:client` (Node's built-in test runner + Vitest
against temp SQLite files and an OS-assigned port) — `test-plan.md`'s own "How
to run" section states explicitly: *"No base URL, no external stack, no
environment bring-up… `npm run test:mcp` and `npm run desktop:test` are not
required — neither surface is touched."* Same call this project's prior
triage passes made (`2026-07-26-focus-calendar-board`,
`2026-07-31-focus-untracked-commits`, `2026-08-01-build-project-manager`), for
the same reason. **Skipped.**

**Effort registry: none configured.** `PROJECT-CONTEXT.md` names no effort
registry for this project — step skipped, consistent with every prior triage
pass on this repo.

## Safety gate

The main repo checkout (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`)
carried substantial pre-existing, unrelated, in-flight work at the moment of
provisioning — a different effort (Projects/ProjectDetail "pin-to-top" +
account-activity/capture-scheduler work), not this one:

```
 M ARCHITECTURE.md  M PROJECT-CONTEXT.md  M README-CN.md  M README-KO.md
 M README-VN.md  M README.md  M client/README.md  M client/src/App.tsx
 M client/src/i18n/index.ts  M client/src/i18n/locales/{en,ko,vi,zh}/{projects,usage}.json
 M client/src/lib/api.ts  M client/src/lib/types.ts
 M client/src/pages/{ProjectManager,Projects,Usage}.tsx (+ tests, snapshot)
 M docs/API.md  M server/README.md
 M server/__tests__/{accounts,projects}.test.js
 M server/{index.js,lib/update-check.js,routes/accounts.js,routes/projects.js}
?? client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json
?? client/src/pages/ProjectDetail.tsx (+ test)
?? server/__tests__/{intake-scan,repo-topology,account-activity,account-capture-scheduler}.test.js
?? server/lib/{git-env,intake-scan,repo-topology,account-activity,account-capture-scheduler,account-capture}.js
?? intake/2026-08-02-practice-kind-override/   (this effort's own intake artifacts — expected)
```

**None of this overlaps this build's change set.** The technical plan touches
`server/db.js`, `server/lib/playbook/{practices,engine}.js`,
`server/routes/playbook.js`, `server/openapi-extra/playbook-coach.js`,
`client/src/lib/playbookStore.ts`, `client/src/pages/PlaybookPage.tsx`, the
`coach.json` locales, and `coach-playbook-vocabulary.md` — none of which
appear in the dirty set above. (`client/src/lib/api.ts` and `types.ts` **are**
both dirty in the main checkout and **are** also touched by this build's plan
— worth flagging: those two files will diverge between the main checkout's
WIP and this effort's worktree, which is expected and fine for an isolated
worktree, but is a real merge-time consideration for whoever reconciles both
efforts later.)

**A live concurrent process is actively committing to `master` in this repo
right now** — confirmed directly: `master`'s HEAD was `f78b2ec` when this
triage began and had already advanced to `5030ddd` within the same minute,
during worktree provisioning, with no action taken by this triage pass. This
is exactly the scenario per-effort worktree isolation exists to protect
against. `f78b2ec` is not an arbitrary snapshot — it is the exact commit both
`technical-plan.md`'s citations and `qa-assessment.md`'s baseline run
("Baseline actually run by `qa-coverage-cartographer` against HEAD
(`f78b2ec`)") were verified against, so pinning the effort's worktree there
keeps the build's starting point consistent with what both plans were
written and tested against.

The worktree was created with `git worktree add <path> -b <branch> master` —
a checkout from the **branch ref/commit at the moment of creation**, not from
the main checkout's dirty index or working tree — so none of the above
uncommitted state, and none of the subsequent concurrent commits to `master`,
could have been or will be carried into it. Verified immediately after
provisioning:

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor status --porcelain
(no output)
```

Clean. Re-checked after the concurrent-commit observation above — still no
output. **Verdict: clean. Proceeding.**

## Worktree set

| Repo | Worktree path | Branch | Type | Starting commit |
|---|---|---|---|---|
| Claude-Code-Agent-Monitor | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor` | `effort/2026-08-02-practice-kind-override` | new branch off `master` | `f78b2ec2805dcb2828e94cba339923687418ea81` |

- Base branch: `master`.
- Created via: `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor
  worktree add
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor
  -b effort/2026-08-02-practice-kind-override master`.
- Verified clean immediately after creation and again after observing
  concurrent activity on `master` (see Safety gate above).
- No other repos exist under this project (confirmed by `PROJECT-CONTEXT.md`
  and by `find <root> -maxdepth 2 -name .git` finding only the top-level
  `.git`), so there are no "untouched repos" needing a base-HEAD-only
  worktree.
- Efforts convention: the shared sibling directory
  `/Users/sara/CODE-LOCAL/SARA/efforts/<slug>/<repo-name>`, matching the
  convention this project's three prior triage passes established and used.

## Docker stack

**Not provisioned.** See "Repo layout" above for full reasoning (production-only
compose files per the devops skill; both plans verify exclusively via `npm
test` / `npm run test:server` / `npm run test:client`, no browser e2e, no
containerized dependency named in either plan). Same call every prior triage
pass on this repo has made, for the same reason.

## Surfaces touched

**Server — data layer:** `server/db.js` — `coach_observations`'
`CREATE TABLE` body gains `CHECK(severity IN ('info','warning'))`, plus the
**corrected** atomic guarded rebuild (see above) for existing installs. No
change to `playbook_practice_config`.

**Server — catalog/resolver (the single source of truth):**
`server/lib/playbook/practices.js` — new exports `KIND_VALUES`,
`SEVERITY_VALUES`, `coerceEnum()`; `resolvePracticeConfig()` widens to return
`{ enabled, config, kindOverride, severityOverride, catalogKind,
catalogSeverity, kind, severity }`.

**Server — engine (fire-time write sites):** `server/lib/playbook/engine.js`
— both `evaluateSession()` and `evaluateGlobal()` stop reading
`practice.kind`/`practice.defaultSeverity` directly; both must change in the
same commit (§9.4 FIX-ROUND-REGRESSION shape — one covers session scope, one
covers global scope, and a fix proven on only one proves nothing about the
other).

**Server — API:** `server/routes/playbook.js` (`serializePractice()` gains
4 new fields; new `validateOverridePatch()`; `PUT` handler gets
`in`-based partial-patch discipline so a numeric-only save never silently
clears an override) and `server/openapi-extra/playbook-coach.js` (schema +
both hand-written example blocks).

**Client:** `client/src/lib/types.ts`, `client/src/lib/api.ts`,
`client/src/lib/playbookStore.ts` (new `resolveDraftKind`/
`resolveDraftSeverity` — the deliberately-duplicated client resolution
formula), `client/src/pages/PlaybookPage.tsx` (new shared `OverrideSelects`
control wired into both practice cards; **the load-bearing fix is lines 257
and 335** — the live-preview `<ObservationCard>` in both cards currently
passes the bare catalog `practice.kind`, which must become
`resolveKind(practice, kindDraft)` or an operator can save an override
successfully and watch the preview underneath keep showing the stale value).

**i18n:** `client/src/i18n/locales/{en,vi,zh,ko}/coach.json` — new
`severityLabel` block + new `playbook.*` selector-label keys, all four
locales (missing in even one locale renders the raw key to the user).

**Docs:** `library/knowledge/product/coach/coach-playbook-vocabulary.md` —
corrects the stale `kind` enum table (DEC-3) and documents the new
`defaultSeverity` enum, in the same commit as the schema change.

**Tests:** `server/__tests__/playbook.test.js` (extended — T2, T5, T6),
`server/__tests__/coach-observations-severity-rebuild.test.js` (new — T1,
T3), `server/__tests__/playbook-resolver-guard.test.js` (new — T4),
`server/__tests__/playbook-resolver-parity.test.js` (new — T8 server half),
`client/src/lib/__tests__/playbookStore.test.ts` (new — T8 client half),
`client/src/pages/__tests__/PlaybookPage.test.tsx` (extended — T7),
`server/__tests__/fixtures/playbook-resolution-cases.json` (new shared case
table).

**Project-specific risk surfaces flagged, per `PROJECT-CONTEXT.md` §9:**

- **§9.1 DERIVED-DUAL-VIEW, "constant becomes a variable" form (6th touch on
  this entry, live design-time pre-flag naming this exact intake by path).**
  Four independent hand-written readers of "this practice's effective kind"
  exist today and agree only because the value cannot vary: `engine.js` ×2,
  `serializePractice()`, and `PlaybookPage.tsx` ×2 preview lines. This build
  makes the value vary. **Explicit inverse-application warning, stated in
  both `PROJECT-CONTEXT.md` and `technical-plan.md` §2.4/§5: do NOT apply the
  usual "all consumers must agree" criterion to `coach_observations.kind`
  (frozen at insert) vs. the live resolved kind — those two are *supposed* to
  diverge after an override change.** Any reviewer citing §9.1 on this pair is
  wrong; §9.1 applies only to the four *live* readers.
- **§9.1, second-order form (same entry, reproduced one day later on the same
  catalog entry per QA's own note).** `playbookStore.ts`'s client-side
  `resolveDraftKind`/`resolveDraftSeverity` is a second, independent copy of
  the server's resolution formula, invisible to the structural guard (which
  only scans for raw `practice.kind` reads). T8's shared JSON case table
  driven through both runtimes is the mandatory closure for this.
- **§9.6 NON-ATOMIC REBUILD (new catalog entry, added by this intake's QA
  pass; 5 latent live instances already shipped elsewhere in `server/db.js`).**
  This is the corrected-approach item above — the reason this build brief
  overrides `technical-plan.md`'s original Step 2.2 wording.
- **§9.3 VACUOUS-GUARD** applies to every structural guard this build adds
  (`playbook-resolver-guard.test.js`, the T1a atomicity scan, T3d's
  registry-derived CHECK assertion) — each must be shown red by mutation
  before it counts, procedures are written out in `test-plan.md` steps 3–8,
  16, 19.

## Durable-cure obligations (MANDATORY)

1. **§9.1 (primary form) — `resolvePracticeConfig()` must actually become the
   sole resolver, enforced structurally, not by review.** `engine.js`,
   `serializePractice()`, and both `PlaybookPage.tsx` preview cards must read
   only the resolved value; `playbook-resolver-guard.test.js`'s three
   assertions (server-strict, engine-sharpest, client-display-path) must each
   be proven red by injecting a rogue `practice.kind` reader, then reverted,
   with the observation recorded verbatim in the commit message
   (`technical-plan.md` Step 6, `test-plan.md` steps 16/T4).
2. **§9.1 (second-order form) — T8's client/server resolver parity table is
   not optional.** One shared JSON fixture
   (`server/__tests__/fixtures/playbook-resolution-cases.json`), driven
   through both `resolvePracticeConfig()` and
   `resolveDraftKind`/`resolveDraftSeverity`, asserting byte-identical
   results including the out-of-enum fail-safe case. This is the entry's own
   2026-08-01 lesson ("the guard caught the composer and missed the
   second-order duplicate one call frame away") reproduced by design one day
   later — closing it is this build's specific obligation on that lesson.
3. **§9.6 — the corrected atomic-rebuild approach above (F1/F2/F3) is
   mandatory, not a nice-to-have.** `build-planner` must plan against the
   corrected Step 2 in this brief, not `technical-plan.md`'s original
   `plan_items`-modeled wording. If F1 is ever declined during build, that
   decline must land as an explicit new WATCH row in `decisions.md` naming
   the silent-total-data-loss mechanism — per `test-plan.md` §0's own
   instruction, the recommendation against declining is unambiguous.
4. **Durable cure beyond the point fix (D1+D2, `test-plan.md` "Durable-cure
   decision" — build now, per that document's call):**
   - **D1** — extract `rebuildTableAtomically({ table, createSql, copySelect,
     indexes })` in `server/db.js`, route `coach_observations` through it
     (refactor only, T1/T3 must stay green with no test edits across it).
   - **D2** — extend `db-migration.test.js`'s meta-test with a
     `REBUILD_CASES` registry-completeness scan for
     `ALTER TABLE (\w+) RENAME TO \1_old` / `CREATE TABLE (\w+)_new`; expect
     it to immediately light up this repo's five pre-existing non-atomic
     rebuild sites (`server/db.js` lines 755, 822, 1063, 1439, 1589) —
     grandfather those five with a dated list and per-entry reason (exactly
     as `chronology-ordering.test.js` does); do **not** weaken the scan to
     make them pass; **do not** retrofit the five existing sites in this
     change (separate follow-up, its own backup, its own crash tests).
5. **§9.4 FIX-ROUND-REGRESSION shape, applied at design time, not after a fix
   round.** Every place this plan touches two call sites for one fact
   (`evaluateSession`/`evaluateGlobal`; both practice cards; both DDL `CHECK`
   lists) must change together, in the same commit, with a test per site —
   never "fix the one that was reported."
6. **DEC-2 genericity — no per-practice special case anywhere.** The override
   mechanism and both selectors must work identically for
   `session-token-ceiling`, `account-weekly-balance`, and any future catalog
   entry with zero new plumbing.
7. **DEC-4 — free choice of all three kind values (including downgrades), no
   ordering invented.**
8. **WATCH-1/WATCH-2/WATCH-3 must remain exactly as decided, not "fixed" by
   this build:** no per-user override model (WATCH-1, out of scope); ship the
   severity control even though nothing renders it yet (WATCH-2, data-layer
   verification only); the migration's pre-flight skip-not-throw-not-rewrite
   behavior on non-conforming data (WATCH-3) must be preserved exactly.
9. **Step 26 / N2 — no test anywhere may assert `observation.kind ===
   resolvedKind` after an override change.** That equality is the *wrong*
   criterion on this surface (see §9.1 inverse-application warning above); if
   it exists and passes, the freeze has been broken to satisfy it.

## Back-out command(s)

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor reset --hard f78b2ec2805dcb2828e94cba339923687418ea81
```

## Open questions

**BLOCKING:** none.

**Non-blocking (assumption stated):**

1. **Docker / effort-registry non-provisioning** — both are project-level
   "not configured" calls, consistent with every prior triage pass on this
   repo, not a fresh judgment call unique to this effort.
2. **DEC-5 (process-governance rule: gate new-capability diffs behind a
   mandatory intake folder before merge) is explicitly PENDING** in
   `decisions.md` and does not block this build — it is a separate,
   forward-looking process change, not a build input.
3. **Concurrent activity on `master`** (see Safety gate) is assumed to be
   unrelated, out-of-scope work by a different effort and not a signal to
   pause this one — the isolated worktree is unaffected either way. If that
   assumption is wrong (e.g., the concurrent work is actually racing to touch
   the Playbook surface), flag it before merge.
4. **`client/src/lib/api.ts` / `types.ts` divergence** between the main
   checkout's unrelated WIP and this effort's worktree (see Safety gate) is
   expected and not a blocker to starting, but is worth a heads-up for
   whoever reconciles both efforts at merge time.
