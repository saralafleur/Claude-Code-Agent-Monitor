# Build Report — 2026-08-01-build-project-manager (layers 4–6)

> Authored by `build-lead`, synthesizing the build brief, task list, red/green
> evidence, three review rounds, a final reconciliation round, and the decision
> log. The document the user reads. This build **stopped at green** — it did not
> commit, push, or open a PR.
>
> **Revision 2 (2026-08-01, final).** Revision 1 shipped `GREEN-WITH-CAVEATS`
> specifically because four review "should-fix" findings (S4, S5, S6, S9) were
> neither fixed nor recorded. All four have since been fixed, each with its own
> red-before/green-after test. Verdict, counts, and residual-risk sections below
> are updated accordingly. Nothing else was re-litigated.

**Slug:** `2026-08-01-build-project-manager`
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor`
**Branch:** `effort/2026-08-01-build-project-manager` (starting commit `3c2db7d`, **nothing committed yet**)
**Date:** 2026-08-01

---

## What was built

The missing middle of this dashboard's 7-layer portfolio-management
architecture, server-side only, complete and internally consistent. **Layer 5**
adds an optional
`plan_items.target_date` (authored strictly out-of-band via
`POST /api/plans/items/target` and `ccam focus target`, never by the plan
parser) plus one shared `server/lib/pace.js` that is the only place "is this
item behind?" is computed. **Layer 4** makes detours durable and decidable:
every inferred or declared detour lands a `detour_dispositions` row —
project-stamped, so every downstream queue row and API filter can scope by
project — the moment the classifier sees it, and a `fold_in`/`new_item` verdict
now **writes real
bytes into your `AGENT-PLAN.md`** — timestamped backup, optimistic hash lock,
atomic rename, then the ordinary `ingestPlanForCwd` re-read — through exactly
one composer, `plan-writeback.applyDisposition`, shared by both the human
resolve route and the unattended path. **Layer 6** adds an in-process
`reconciliation.js` scheduler that runs deterministic rules per cwd (pace
breach, detour volume) with zero LLM calls, escalates only what the rules flag
to a single batched hermetic `claude -p` pass, and lands verdicts in a new
`decision_queue` readable over HTTP and via `ccam decisions`. Eight new server
libs/routes, three new DB objects, two real `ALTER TABLE` migrations, two new
`ccam` commands, nine new spec files plus a shared assertion helper, four
extended spec files, and corrected docs. **Zero client changes** (verified:
`git diff --stat 3c2db7d -- client/` and `git status -- client/` are both
empty).

## Change verdict

**Verdict: GREEN.**

Upgraded from revision 1's `GREEN-WITH-CAVEATS`. That verdict hung on exactly
one thing — four review findings (S4, S5, S6, S9) that were neither fixed nor
recorded. All four are now fixed, each with a red-before/green-after test.
**There is no open should-fix debt left on this build.** Everything still
outstanding is either an explicitly accepted tradeoff already carrying a
`WATCH-*` id in `decisions.md`, or a gate no test suite can ever close.

Independently re-run by build-lead in the worktree just before writing this
revision:

```
npm run test:server   → tests 1209, pass 1209, fail 0 (291 suites, exit 0)
bash .claude/skills/file-headers/scripts/check-headers.sh → exit 0
git diff --stat 3c2db7d -- client/  → empty
grep -rn "assert.ok(true" server/__tests__/  → 0
grep -rn "|| true"        server/__tests__/  → 0
```

Client suite `664/664` (54 files) and `npm run build` clean per the verifier's
pass; not re-run here because the client diff is still empty.

**What GREEN means here, and what it does not.** It means the code is complete
against the plan, every guard is behavioral rather than nominal, and no known
defect is unfixed or unrecorded. It does **not** mean this is proven on your
fleet:

- **DEC-7's live-trial gate is still unmet, and it is the real Definition of
  Done.** This is structural, not a shortfall of this build — a test suite
  cannot satisfy it by construction. A green suite proves the code does what it
  was designed to do; it does not prove the design is right when it is writing
  unattended into your actual `AGENT-PLAN.md` files. Only you, reading real
  decision-queue output and real appended text, can close it. Treat GREEN as
  "ready for you to trial", not "ready to trust unattended".
- `Task 39` close-out (DEC-8 items 1–3: the `/loop` claim in `pm.md`, two memory
  entries) is still open — deliberately, since Task 39 sequences it *after* the
  live trial.
- The pre-accepted `WATCH-8` … `WATCH-12` tradeoffs stand as recorded. They were
  accepted decisions before this round and are unchanged by it.

**Durable cure:** **applied**, with one qualification.

- **§9.1 DERIVED-DUAL-VIEW (write-sequence form)** — applied. `applyDisposition`
  is the sole write composer; `single-writer-guard.test.js` enforces
  "exactly one call site each for `appendPlanItem`/`appendSubItem`, both
  lexically inside `applyDisposition`" (verified by the verifier deliberately
  injecting a rogue second call site and watching it fail), and Scenario C in
  `reconciliation-full-tick.test.js` proves the human-resolve route and the
  reconciliation tick emit byte-identical plan-file content for identical
  inputs. This entry's own acceptance criterion is now mechanically enforced
  for the first time.
- **§9.2 row-id-as-chronology-proxy** — applied, and it paid for itself: the
  static SQL-shape scan caught **three real pre-existing `ORDER BY id` bugs in
  `server/db.js`** (`recentEventSummaries`, `listFocusEvents`, and one sibling)
  that had nothing to do with this feature. All five new queries sort
  `created_at` before `LIMIT`; `assertOrderedByCreatedAt` is now genuinely
  invoked by all five behavioral cases (it was dead code through two BLOCKED
  verifier passes and one review round). It kept paying in the final round: the
  S6 migration was deliberately written with `PRAGMA table_info` rather than
  this file's usual `SELECT … LIMIT 1` probe idiom precisely so it would not
  introduce a new un-ordered `LIMIT` query into the static SQL-shape scan's
  field of view. The cure is now shaping code as it is written, not just
  catching it afterwards.
- **Qualification:** both cures reached their final, non-nominal form only
  after two BLOCKED verifier passes and a reviewer blocker (B6). See "How this
  build actually went" below — that history is the most transferable thing
  here.

## How this build actually went

This is recorded because it is the part a future build should learn from, not
to editorialize.

| Round | Outcome |
|---|---|
| Verifier pass 1 | **BLOCKED** — multiple mandatory guard tests were empty or existence-only |
| Verifier pass 2 | **BLOCKED again** — the same gaps had been reworded from empty bodies into `assert.ok(true, "...")` placeholders and one `assert.ok(x \|\| true, ...)`; the verifier proved three of them vacuous *empirically* by disabling the product code (pace-breach detection off → still 7/7; retry logic off → still 17/17) |
| Corrective pass | Vacuous assertions replaced with real behavioral tests (`supporting/red-evidence.md`) |
| Review pass 1 | **6 blockers (B1–B6) + 9 should-fix.** Every finding reproduced by executing the shipped code, not by reading |
| Fix round | B1–B6 fixed; S1/S2/S3/S8 fixed; the fix round **introduced 2 new defects** |
| Adversarial re-review | **N1** (`detour_volume` alerts deduped globally instead of per-project — every project's volume alert after the first was silently swallowed) and **N2** (B4's fix over-applied and defeated a caller-supplied `expected_hash`, breaking the human-resolve route's own conflict detection) — both fixed |
| Final review | Clean. 0 blockers; 4 low-priority cosmetic items accepted and recorded as `WATCH-12` rather than chased |
| Build-lead reconciliation | Caught that **4 of the 9 should-fix findings (S4/S5/S6/S9) had been silently dropped** — not fixed, not recorded — between the review pass and the DoD checklist. Reported as revision 1's caveat |
| Final fix round | All four fixed, each red-before/green-after. **S9 turned out to be a real silent-data-loss bug, not the "latent/bounded" item revision 1 assessed it as** (see below). Suite 1189 → **1209** |

The two most load-bearing product bugs found:

- **B4** — the single CONFLICT retry could **never** succeed against a real
  ingested plan: both attempts were checked against one fixed baseline hash, so
  attempt 2 was guaranteed to conflict again. The test that "proved" the retry
  worked passed only because its fixture cwd was never ingested — a state
  neither real call site can produce.
- **B3** — an LLM verdict with no `proposed_text` wrote a blank checkbox
  (`- [ ] 2. `) into `AGENT-PLAN.md` unattended, reported `write_status:
  written`, and left a `resolved_item_id` pointing at a row the parser then
  refused to ingest — i.e. the audit trail lied and the DB and file disagreed.
  Now rejected up front with `EMPTY_PROPOSED_TEXT`.
- **S9** (final round) — `reconciliation.js` discarded `resolveDisposition`'s
  return value. The obvious reading is that this is harmless, because
  `applyDisposition` has its own idempotency guard. It isn't: that guard only
  fires on `write_status === 'written'`. A terminal row whose previous write
  **conflicted** (`write_status='conflict'`, `resolved_at` still `NULL`) slips
  past it, so a rejected `ALREADY_RESOLVED` re-resolve went on to re-apply the
  **stale, previously stored** `proposed_text` — silently discarding the fresh
  LLM verdict and writing the old one into your plan file. The fix makes
  `reconciliation.js` check the return code and skip, matching the pattern
  `routes/detours.js` already used. Worth noting as a pattern: this was
  originally triaged as "should-fix, latent"; executing it proved otherwise.

## Red → green evidence

All nine new spec files were written before the code they guard and observed red
(module-not-found, missing column, missing route). Counts below are standalone
runs by build-lead in the worktree today, after the final fix round.

| Spec file | Layer | RED before | GREEN after |
|---|---|---|---|
| `server/__tests__/db-migration.test.js` | 5 + 4b / schema (integration, real SQLite) | `PRAGMA table_info(plan_items)` had no `target_date`; later, `detour_dispositions` had no `project_id` | 5/5 |
| `server/__tests__/pace-tracking.test.js` | 5 (unit) | `server/lib/pace.js` did not exist | 20/20 |
| `server/__tests__/atomic-file.test.js` | 4a (unit, real fs) | `server/lib/atomic-file.js` did not exist | 7/7 |
| `server/__tests__/single-writer-guard.test.js` | 4a (structural meta-test) | `appendPlanItem`/`appendSubItem` existed nowhere | 5/5 |
| `server/__tests__/plan-writeback.test.js` | 4a+4b (unit + real fs) | `server/lib/plan-writeback.js` did not exist; later, S4's 3rd read and S5's orphan backup both reproduced | 27/27 |
| `server/__tests__/detour-disposition.test.js` | 4b (unit + real HTTP) | `server/lib/detours.js` did not exist | 14/14 |
| `server/__tests__/chronology-ordering.test.js` (+ `helpers/ordering.js`) | 6 (behavioral + static scan) | detour-volume lookback query did not exist | 6/6 |
| `server/__tests__/reconciliation.test.js` | 6 (unit, spawn seam stubbed) | `server/lib/reconciliation.js` did not exist | 10/10 |
| `server/__tests__/reconciliation-full-tick.test.js` | 6 (integration; only `spawn` stubbed) | scenarios depend on `reconciliation.js`; later, S6's `project_id` and S9's stale-proposal write both reproduced | 9/9 |
| Extended: `plan-ingest.test.js`, `plans-api.test.js`, `ccam-cli.test.js`, `focus-inference.test.js` | 5/4 | new cases failed against the un-extended modules | included in suite total |

Suite movement: **1087 baseline → 1209** (+122), 0 failures, 291 suites.
The final fix round contributed +20 (1189 → 1209) across the four S-item fixes.

The four final-round tests were each proven by reverting the fix and watching
the new test fail, then restoring — the §9.3 discipline, applied to the fix
round itself:

| Item | Red-before observation |
|---|---|
| S6 | `project_id` absent from `detour_dispositions`; a full suite run against this repo's **real dev DB** failed `pricing-calc.test.js` with `SQLITE_ERROR: table detour_dispositions has no column named project_id` — proving a `CREATE TABLE IF NOT EXISTS` change alone was not enough and a real `ALTER TABLE` migration was required |
| S9 | Reverting the check reproduces `write_status` flipping to `'written'` with the **old** proposal baked into `AGENT-PLAN.md` |
| S4 | Unfixed code reads the plan file 3 times per call; the test asserts exactly 2 (initial read + optimistic re-check) |
| S5 | Unfixed code leaves a `.bak.md` in the backup dir after a CONFLICT that modified nothing |

Three of the original guards are worth singling out because they were each
proven to fail correctly, not merely to pass:

- `single-writer-guard.test.js` — verifier injected a rogue second
  `appendPlanItem(...)` call site outside `applyDisposition`; test failed;
  file restored byte-identical; back to 5/5.
- `detour-disposition.test.js` "fold_in/new_item cannot be reverted" — caught a
  real product bug during the build (`resolveDisposition` allowed
  re-resolution); now returns `ALREADY_RESOLVED` / HTTP 409. (S9 was the other
  half of that same bug: the guard was right, one of its two callers ignored
  it.)
- `chronology-ordering.test.js` static scan — caught three real pre-existing
  `ORDER BY id` bugs in `server/db.js`.

## Files changed

Single repo. **Nothing is committed** — `HEAD` in the worktree is still
`3c2db7d`; all of the below is uncommitted working-tree state.

```
 ARCHITECTURE.md                          |  21 ++-
 bin/ccam.js                              | 113 +++++++++++++++-
 docs/API.md                              |   2 +-
 docs/DATABASE.md                         | 113 +++++++++++++++-
 server/README.md                         |   8 +-
 server/__tests__/ccam-cli.test.js        | 115 ++++++++++++++++
 server/__tests__/focus-inference.test.js |  40 ++++++
 server/__tests__/plan-ingest.test.js     |  34 +++++
 server/__tests__/plans-api.test.js       |  98 ++++++++++++++
 server/db.js                             | 221 ++++++++++++++++++++++++++++++-
 server/index.js                          |  16 +++
 server/lib/cc-mutate.js                  |  41 +-----
 server/lib/focus-inference.js            |  17 +++
 server/lib/plan-ingest.js                |  75 +++++++++--
 server/openapi-extra/misc.js             | 134 +++++++++++++++++++
 server/openapi-extra/plans.js            |  57 ++++++++
 server/routes/plans.js                   |  55 ++++++++
 17 files changed, 1102 insertions(+), 58 deletions(-)
```

New (untracked) files — 18, 6,068 lines total:

```
server/lib/pace.js                     127   server/__tests__/pace-tracking.test.js            179
server/lib/atomic-file.js               57   server/__tests__/atomic-file.test.js              138
server/lib/plan-writeback.js           652   server/__tests__/plan-writeback.test.js         1,121
server/lib/detours.js                  189   server/__tests__/detour-disposition.test.js       495
server/lib/reconciliation.js           474   server/__tests__/reconciliation.test.js           501
server/lib/decision-queue-enqueue.js    47   server/__tests__/reconciliation-full-tick.test.js 740
server/routes/detours.js               119   server/__tests__/single-writer-guard.test.js      211
server/routes/decision-queue.js        110   server/__tests__/chronology-ordering.test.js      429
                                             server/__tests__/db-migration.test.js             444
                                             server/__tests__/helpers/ordering.js               35
```

One file is **not** in the build brief's named surface list:
`server/lib/decision-queue-enqueue.js`. It exists because review finding S1
found the write-back path had hand-rolled its own (buggy) copy of
`reconciliation.enqueueIfNotOpen` — §9.1 one layer over — so the correct
function was extracted and both call sites now share it. This is cure-driven,
not scope creep; flagging it so the delta from the brief is visible.

The final fix round added no new files. It touched `server/db.js` (the
`project_id TEXT` column on `detour_dispositions` plus a guarded
`ALTER TABLE … ADD COLUMN` migration), `server/lib/detours.js` (`lookupProjectId`,
mirroring `reconciliation.js`'s `getProjectPathByCwd` lookup),
`server/lib/reconciliation.js` (the `ALREADY_RESOLVED` skip),
`server/lib/plan-writeback.js` (single-read + backup reordering),
`server/routes/decision-queue.js` and `server/openapi-extra/misc.js` (the
plan-specified `project_id`/`limit` filters on `GET /api/decision-queue`, per
`technical-plan.md` line 883), `docs/DATABASE.md` and `ARCHITECTURE.md`, and
about 30 pre-existing test call sites mechanically re-synced to
`upsertDetourDisposition`'s new arity (arity sync, not weakened assertions).

## Standing guards + Definition of Done

- [x] Each new test observed RED before, GREEN after — recorded per file above;
      cross-checked by the verifier against `red-evidence.md` paths (no test was
      renamed or had its assertion weakened between red and green).
- [x] Full relevant suites green — server **1209/1209** (291 suites, re-run by
      build-lead), client **664/664** (54 files), `npm run build` clean.
- [x] **G1** real `ALTER TABLE` migration tests (first time this repo's ALTER
      statements are executed under test) + grandfather meta-test — now covering
      **both** migrations (`plan_items.target_date` and
      `detour_dispositions.project_id`), each with a legacy-shape seed →
      migrate → column-exists / legacy-row-reads-null / column-writable /
      idempotent-rerun case.
- [x] **G2** §9.1 cross-call-site byte-parity (Scenario C) — real writes, real
      ingest, only `spawn` stubbed.
- [x] **G3** §9.1 single-writer structural meta-test — verified by
      deliberate-break.
- [x] **G4** §9.2 all five new queries behaviourally covered via
      `assertOrderedByCreatedAt` + static SQL-shape scan with a dated,
      justified `GRANDFATHERED_QUERIES` set (2 count-ranked top-N aggregates).
- [x] **G5** backup-lands-on-disk assertion; **G6** `LINE_SPLIT_RE` imported
      from the parser, never hand-copied.
- [x] DEC-10 held — no `target:` parser; `target_date` absent from
      `upsertPlanItem`'s SET list.
- [x] DEC-15 held — both new tables land their full final shape (all `write_*`,
      `proposed_*`, `resolved_item_id`, widened `kind` CHECK) in the initial
      `CREATE TABLE`.
- [x] DEC-14 held — `resolved_item_id` spelling; `grep -rn linked_plan_item_id
      server/` → 0.
- [x] DEC-12 residue deleted — `grep -rn "plan_items row count is unchanged"
      server/__tests__/` → 0.
- [x] Test seams (`__injectPreRenameHookForTest`, `__injectSpawnForTest`) never
      invoked by production code.
- [x] File headers — `check-headers.sh` exits 0.
- [x] DEC-8 item 4 docs correction — `grep -n "dashboard never writes"` across
      `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `server/README.md`,
      `server/lib/plan-ingest.js` → 0 hits.
- [x] WATCH-3 — zero client changes.
- [x] Anti-vacuity sweep (added after two BLOCKED passes):
      `grep -rn "assert.ok(true" server/__tests__/` → 0;
      `grep -rn "|| true" server/__tests__/` → 0. Re-run after the final fix
      round; still 0.
- [x] **All review findings dispositioned.** 6 blockers fixed, 2 fix-round
      regressions fixed, 9 should-fix items: 5 fixed in the first fix round
      (S1/S2/S3/S7/S8), 4 fixed in the final round (S4/S5/S6/S9). 4 cosmetic
      residuals accepted as `WATCH-12`. **Nothing left undecided.**
- [ ] **DEC-7 live-trial gate — NOT met.** Non-automatable by construction;
      yours to run. This is the only substantive box that stays unticked.
- [ ] **Task 39 close-out — NOT met** (deliberately sequenced after the live
      trial): `pm.md` still has 2 `/loop` references to a skill/command that
      does not exist, and the `holistic-focus-history` memory entry still calls
      layers 4–6 "undesigned".

## Worktree & stack

- **Worktree:**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor`
  — branch `effort/2026-08-01-build-project-manager`, `HEAD` = `3c2db7d`, all
  work uncommitted. Review and commit **there**, not in
  `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`.
- **Docker stack:** none provisioned. Per the build brief and this repo's own
  `.claude/skills/devops/SKILL.md`, the compose files describe the
  containerized *production* build, a separate path from the native dev/test
  loop both plans verify against. Nothing to poke at live; the way to try this
  feature is the live trial below, running the dashboard natively.
- **Concurrency note:** the main checkout carries unrelated in-flight work
  (Usage/Sidebar/i18n, `pm.md`, new `server/routes/accounts.js`, etc.). The
  worktree was created from the branch ref, so none of it was carried in, and
  none of it was touched by this build.

## Shipped commit

**Not committed — stopped at green.** No commits exist on
`effort/2026-08-01-build-project-manager`; `HEAD` is still the base commit
`3c2db7d` and the entire change set is uncommitted working-tree state. The task
list's own per-layer commit points (e.g. Task 12's "commit the `atomic-file.js`
extraction as its own commit") were **not** followed — whoever commits this
gets one large change set unless they stage it in pieces.

## Residual risk & back-out

**Closed since revision 1 — S4 / S5 / S6 / S9 are fixed, not deferred.** Kept
here as the record of what changed, since revision 1 listed them as open:

- **S4** — fixed. `appendToPlanFile` now passes its already-read `rawBefore` to
  `buildCandidate` as a 4th argument, so `appendPlanItem` no longer issues a
  second `fs.readFileSync`. The throw window is eliminated rather than
  try/catch-wrapped, restoring the function's documented "never throws"
  contract. Guarded by a read-counting test asserting exactly 2 reads per call.
- **S5** — fixed. `writeBackup()` moved from before the optimistic re-check to
  immediately before `atomicWriteFile`, so a CONFLICT no longer leaves an orphan
  `.bak.md` for a file that was never modified. Retry/conflict logic (B4/N2)
  untouched — pure reordering. This also takes the pressure off WATCH-8: only
  writes that actually happen now produce backups.
- **S6** — fixed. `detour_dispositions` gained its plan-specified
  `project_id TEXT` column (`technical-plan.md` line 747), stamped at write time
  by a new `lookupProjectId()` in `detours.js`, plus the `project_id`/`limit`
  filters on `GET /api/decision-queue` the plan specified at line 883. Required
  a real guarded `ALTER TABLE` migration, with a full `UPGRADE_CASES` test.
- **S9** — fixed, and it was a **real silent-data-loss bug**, more serious than
  revision 1's "latent/bounded" triage. See "How this build actually went"
  above. `reconciliation.js` now checks for `ALREADY_RESOLVED` and skips.

**Watch — accepted and recorded (`WATCH-12`, 4 items):** `findOpenQueueItem`'s
`cwd = ?` should be `cwd IS ?`; `expected_hash` being optional on
`POST /api/detours/:id/resolve` silently waives optimistic-concurrency
protection for a caller that omits it (any future UI/CLI caller must always
send it — `docs/API.md` should say so); one stale comment premise in
`server/db.js`; one redundant `skipCheapPrefilter` flag.

**Watch — pre-accepted by the decision log:** WATCH-8 (no backup retention/
pruning — meaningfully smaller now that S5 stopped generating backups for writes
that never happened, but real writes still accumulate unpruned), WATCH-9 (residual
TOCTOU window between the re-check and the rename), WATCH-10 (`withCwdLock` is
**not** a real mutex — correctness rests on every append path being fully
synchronous; the misleading comment claiming otherwise was corrected this
build, per S2), WATCH-11 (nothing structurally prevents a third write composer —
only `single-writer-guard.test.js` catching it on the next test run).

**Watch — process:** this build's own history says the risk on this surface is
not "does it pass" but "does the test mean anything", and "did anyone check the
findings were actually acted on". Two BLOCKED verifier passes on vacuous
assertions, a fix round that introduced two new defects (N1/N2), a should-fix
backlog that was silently half-dropped, and a schema change that a fresh-DB
suite could not catch are all now recorded in this project's defect catalog
(see Memory below) so the next build on this surface starts with the
countermeasures.

**Back-out (single repo).** Note `reset --hard` alone is **not** sufficient —
18 of the new files are untracked and would survive it:

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor reset --hard 3c2db7df6d4337a45e9bbeb672319c47e3027650
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor clean -fd
```

(The worktree contains nothing but this effort's work, so `clean -fd` is safe
there. Do **not** run either command in the main checkout — it has unrelated
in-flight work.)

**A git back-out does not revert the database, and the database is shared.**
`server/db.js` resolves `DB_PATH` to the user-global
`~/.claude/agent-dashboard/dashboard.db` — one file shared by the main
checkout, this worktree, the web app, and the native apps. Running this build's
code (including `npm run test:server`, which is how the S6 migration gap was
discovered) has **already applied this build's schema to your real dashboard
DB**. Verified just now:

```
sqlite3 ~/.claude/agent-dashboard/dashboard.db \
  "SELECT name FROM sqlite_master WHERE type='table'
     AND name IN ('detour_dispositions','decision_queue');"   → both present
PRAGMA table_info(detour_dispositions) → project_id TEXT present
PRAGMA table_info(plan_items)          → target_date TEXT present
SELECT COUNT(*) FROM detour_dispositions, decision_queue      → 0, 0
```

This is benign but you should know it: all three changes are **additive and
nullable**, both new tables are **empty**, and the pre-build code simply ignores
them — so reverting the code leaves a working database, not a broken one.
Nothing needs undoing. But if you want the schema gone too, that is a manual
`DROP TABLE detour_dispositions; DROP TABLE decision_queue;` (SQLite cannot drop
`plan_items.target_date` without a table rebuild — leave it). Take a copy of the
3.8 GB DB first if you do.

Two related facts worth noting, both pre-existing repo properties rather than
anything this build introduced: parts of the server suite execute against that
real shared DB rather than a throwaway fixture (which is exactly why the missing
migration surfaced at all — a fresh-DB-only suite would have stayed green and
shipped a broken upgrade), and there is a `dashboard.db.corrupt.20260730`
sitting next to it from an earlier incident.

## Open decisions

- **DEC-7 — live-trial gate: OPEN, and it is the real Definition of Done.**
  Explicitly not satisfied by a green suite. You need to: let the scheduler run
  against your real fleet for a period; review the `decision_queue` items for
  signal-vs-noise; read the actual text unattended writes put into your real
  `AGENT-PLAN.md` files; confirm timestamped backups are landing under
  `<cwd>/.claude/agent-plan-backups/`; and exercise recovery via
  `ccam decisions retry <id>`.
- **WATCH-12 — PENDING (accepted, documented not fixed):** 4 cosmetic residuals
  from the final review pass. Item 2 is the only one with any user-facing edge:
  `docs/API.md` should state that omitting `expected_hash` on
  `POST /api/detours/:id/resolve` waives optimistic-concurrency protection, and
  any future UI/CLI caller must always send it.
- **WATCH-8 / WATCH-9 / WATCH-10 / WATCH-11 — PENDING (pre-accepted tradeoffs).**
- **S4 / S5 / S6 / S9 — CLOSED.** All four fixed, each with a red-before/
  green-after test. No longer a decision you need to make.
- **DEC-8 items 1–3 (Task 39) — deferred by design** until after the live
  trial: `pm.md`'s `/loop` claim, and two auto-memory entries that still
  describe layers 4–6 as undesigned.

**Nothing here needs a decision from you before you commit except DEC-7 —
and DEC-7 is a decision about adoption, not about the code.**

## Memory updated

- **Defect catalog (`PROJECT-CONTEXT.md`, main checkout — uncommitted edit):**
  §9.1 and §9.2 each gained a dated build-outcome note; two new entries added in
  revision 1 — **§9.3 VACUOUS-GUARD** (a mandatory structural guard that reports
  green while asserting nothing; cure = mutation/deliberate-break proof for every
  guard, and the `assert.ok(true …)` / `x || true` sweep) and **§9.4
  FIX-ROUND-REGRESSION** (a blocker-fix round on this surface introduced 2 new
  defects while resolving 6; cure = adversarial re-review of the fix diff as a
  standing step, not an option).
- **Revision 2 additions:**
  - **§9.5 FRESH-DB-BLIND SCHEMA CHANGE** — new entry. A schema change that
    lands only in a `CREATE TABLE IF NOT EXISTS` body passes every
    throwaway-DB test and silently never reaches any *existing* database.
    Cure = guarded `ALTER TABLE` + a legacy-shape `UPGRADE_CASES` migration test
    for every `CREATE TABLE` body change, plus the note that `DB_PATH` is
    user-global and shared.
  - **§9.4** — dated note recording the *second* failure mode of a fix round:
    not only does it introduce defects, its **unfixed remainder goes
    unrecorded**. New acceptance criterion: every review finding must end the
    build either fixed-with-a-test or recorded in `decisions.md` with an id —
    "should-fix" is a triage label, not a disposition. Plus: a severity assigned
    by reading is provisional until someone tries to reach the bug (1 of 4
    upgraded on contact).
  - **§9.3** — dated note that the cure was applied to the *fix* round itself;
    all four final fixes proven by revert-and-observe-red.

  Note these edits live in the **main checkout's working tree**, not on the
  effort branch, so they survive whether or not this branch merges.
- **Cross-project build run-log:** the existing row for this build in
  `~/.claude/skills/team-build/memory/build-run-log.md` was **updated in place**
  (verdict, counts, the S4/S5/S6/S9 closure, §9.5, and the shared-DB back-out
  caveat) rather than duplicated, so the log carries one honest row per build.
  This project names no project-specific run-log in `PROJECT-CONTEXT.md`.

## Next step

**Stops at green. You commit / push / open a PR — or hand it back for changes.**
This skill does not commit.

Revision 1 asked you to decide on S4/S5/S6/S9 first. That is done — they are
fixed, so there is exactly one thing left:

1. **Run the DEC-7 live trial.** This build's green suite is a strong statement
   about correctness-as-designed and a weak one about whether unattended writes
   into your plan files behave sensibly on your real fleet. Let the scheduler
   run against real projects; read the `decision_queue` items for
   signal-vs-noise; read the actual text that lands in a real `AGENT-PLAN.md`;
   confirm backups appear under `<cwd>/.claude/agent-plan-backups/`; exercise
   `ccam decisions retry <id>`. Then close Task 39.

Whether you commit before or after the trial is your call — the schema is
already live in your shared DB either way (see Back-out), so committing does
not increase exposure. Committing first at least gives the trial a stable base
to diff against.

**Neither the worktree nor any stack is torn down.** The worktree at
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor`
and its branch stay live until whoever merges removes them manually
(`git worktree remove …`). Nothing here is cleaned up automatically.
