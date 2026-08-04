# Build Report — 2026-08-02-practice-kind-override

> Authored by `build-lead`, synthesizing the build brief, task list, both
> red-evidence passes, and four `build-verifier` passes. The document the user
> reads. This build reached green and **the diff was committed to the effort
> branch** (`3b9769e`) — it was **not** pushed, **not** merged, and the
> mandatory F3 manual double-boot walkthrough has **not** been performed.

## What was built

A Coach Playbook practice's `kind` (Risk / Reminder / Good) and
`defaultSeverity` (Info / Warning) can now be overridden per practice from the
Playbook config UI. The override is stored as top-level
`kindOverride`/`severityOverride` keys inside the existing
`playbook_practice_config.config` JSON blob — no new column, no re-keying — and
is resolved through **one** widened `resolvePracticeConfig()` on the server and
one matching `resolveDraftKind`/`resolveDraftSeverity` pair on the client. The
engine's two fire sites (`evaluateSession`/`evaluateGlobal`), the route's
`serializePractice()`, and both `PlaybookPage` preview cards now read only the
resolved value; a structural guard test fails the suite if any of them reads
`practice.kind`/`practice.defaultSeverity` raw again. The resolved kind/severity
is frozen onto the `coach_observations` row at fire time and never re-derived,
so changing an override later never relabels an existing Observation. In the
same change, `defaultSeverity` became a first-class enum (`info`/`warning`) with
a DB `CHECK`, a TS union, and labels in all four locales — which forced a
one-time rebuild of `coach_observations`, built as a fully atomic
create-new → copy → drop → rename inside a single `BEGIN…COMMIT`, behind a new
shared `rebuildTableAtomically()` helper, an orphan-table guard, and a
try/catch/rollback that can never throw at `require()` time. OpenAPI schema and
examples, all four `coach.json` locales, and the Playbook vocabulary doc were
updated in the same commit.

## Change verdict

**Verdict:** GREEN (with one mandatory pre-merge human gate outstanding — F3)

`build-verifier` reached this over **four passes**: pass 1 BLOCKED (a critical
live-data-safety bug plus 5 test-authoring defects and a broken client build),
pass 2 BLOCKED (a structurally vacuous orphan-guard test traced to a defective
fixture in the *plan's own* Task 6 pseudocode), pass 3 GREEN, pass 4 GREEN
after an adversarial review round (B1/B2/B3 + S1–S9). Every pass independently
re-derived its findings from source and re-ran the suites itself rather than
accepting a self-report.

**Durable cure:** **applied — in full, nothing deferred**, against
`PROJECT-CONTEXT.md` §9:

| Obligation | Catalog id | Status |
|---|---|---|
| Single resolver, structurally enforced (no raw `practice.kind` readers) | **§9.1 DERIVED-DUAL-VIEW**, primary form | Applied — `playbook-resolver-guard.test.js`, 3 assertions, red-by-injection proven twice (engine + client card) |
| Client/server resolver parity (the second-order copy this build introduces by design) | **§9.1**, second-order form | Applied — one shared 13-case JSON fixture driven through both `resolvePracticeConfig()` and `resolveDraftKind`/`resolveDraftSeverity` |
| Atomic table rebuild (F1), orphan guard (F2), never-throw error handling (B3) | **§9.6 NON-ATOMIC REBUILD** | Applied — single `BEGIN…COMMIT` `db.exec`, `PRAGMA foreign_keys` outside the transaction, create-new-then-rename, F2 log-and-skip, B3 try/catch/rollback |
| `rebuildTableAtomically()` helper extracted (D1) | §9.6 durable cure | Applied **now, not deferred** — `coach_observations` is its first call site |
| `REBUILD_CASES` registry-completeness scan (D2) | §9.6 durable cure | Applied — five pre-existing non-atomic sites grandfathered with dated reasons; scan **not** weakened; the five were deliberately not retrofitted (separate change, its own backup) |
| Every new structural guard shown red against a real mutation | **§9.3 VACUOUS-GUARD** standing rule | Applied — 4 recorded injection proofs, each independently reproduced by the verifier |
| Two call sites for one fact change together | **§9.4 FIX-ROUND-REGRESSION** | Applied at design time — both engine sites, both cards, both DDL CHECK lists |

## Red → green evidence

Sources: `supporting/red-evidence-loopback-1.md` (items 1–7),
`supporting/red-evidence.md` (B3, B1/B2), and the verifier's own independent
red-by-injection reproductions in `supporting/verification.md` passes 1, 3
and 4. **38 new `it()` cases** landed across 4 new and 4 extended spec files.
The load-bearing structural guards — the ones this catalog exists to protect —
each carry a recorded red observation:

| Test | Layer | RED before | GREEN after |
|------|-------|-----------|-------------|
| `playbook-resolver-guard.test.js` :: "engine.js contains zero raw practice.kind reads" (T4b) | unit / static scan | ✅ injected `const rogue = practice.kind;` into `evaluateSession()`'s loop → `expected: 0, actual: 1` | ✅ reverted byte-identical, green |
| `playbook-resolver-guard.test.js` :: "client/src reads practice.kind nowhere but types.ts" (T4c) | unit / static scan | ✅ same injection into `SessionTokenCeilingCard` → 1 subtest failed | ✅ reverted, green |
| `playbook-resolver-guard.test.js` :: "raw reads only inside practices.js" (T4a) | unit / static scan | ✅ covered by the same two injections (scope proven non-empty) | ✅ |
| `coach-observations-severity-rebuild.test.js` :: "boots without throwing when an orphaned `coach_observations_old` exists, and skips the rebuild" (T1c, F2) | integration (real `require("../db")` against a crafted temp DB) | ✅ disabled F2 via `if (false && orphans.length > 0)` → failed on "main table should still LACK CHECK(severity IN after boot", `expected: true, actual: false` | ✅ restored, 14/14 green |
| `coach-observations-severity-rebuild.test.js` :: "a mid-execute failure rolls back cleanly and does not throw out of `require(\"../db\")`" (B3) | integration (real un-mocked `SQLITE_CONSTRAINT_CHECK`) | ✅ removed the try/catch → uncaught `SQLITE_CONSTRAINT_CHECK: kind IN ('risk','info','good')` escaped `require("../db")` | ✅ restored, 15/15 green |
| `coach-observations-severity-rebuild.test.js` :: "an interrupted rebuild rolls back: every original row is still readable" (T1b) | integration | ✅ observed red at pass 1 (`CHECK should be present after successful migration`, `expected: true, actual: false`) | ✅ |
| `coach-observations-severity-rebuild.test.js` :: T1a atomicity scan (single `BEGIN…COMMIT`; `PRAGMA foreign_keys = OFF` outside it) | unit / static scan | ✅ pre-change baseline (no atomic rebuild existed) | ✅ |
| `coach-observations-severity-rebuild.test.js` :: T3a/T3b legacy-DB rebuild + idempotency + index recreation (6 cases) | integration | ✅ pre-change baseline | ✅ |
| `coach-observations-severity-rebuild.test.js` :: WATCH-3 pre-flight skip (3 cases — no throw, skip, never rewrite) | integration | ✅ pre-change baseline | ✅ |
| `coach-observations-severity-rebuild.test.js` :: T3d "DDL CHECK values match the exported SEVERITY_VALUES/KIND_VALUES registries" | unit / static scan | ✅ red at pass 1 (`expected: "'info','warning'", actual: 'info,warning'`) then fixed and re-proven | ✅ |
| `db-migration.test.js` :: `REBUILD_CASES` registry-completeness scan (D2) | unit / meta-test | ✅ lit up immediately against the five pre-existing non-atomic sites (grandfathered, not weakened) | ✅ 10/10 |
| `playbook-resolver-parity.test.js` :: 13-case shared fixture through `resolvePracticeConfig()` (T8 server half) | unit | ✅ red at pass 1 (`should resolve to 'risk' but got 'info'` — practice-id mapping inversion) | ✅ |
| `playbook-resolver-parity.test.js` :: "coerces out-of-enum overrides to catalog defaults, never throws" | unit | ✅ | ✅ |
| `playbookStore.test.ts` :: 13-case shared fixture through the **real** `resolveDraftKind`/`resolveDraftSeverity` (T8 client half) | unit (client) | ✅ red at pass 1 — 4/4 failing against a local mock; mock deleted, real resolver imported | ✅ |
| `playbook.test.js` :: T2 engine fire-site cases (session + global scope) | integration (server) | ✅ red at pass 1 (`expected account-weekly-balance to fire`; `UNIQUE constraint failed: sessions.id`) | ✅ |
| `playbook.test.js` :: T5/T6 route serialization + `PUT` partial-patch/`null`-clear/400 cases | integration (server) | ✅ pre-change baseline | ✅ |
| `PlaybookPage.test.tsx` :: T7 selector render, live-preview reflects draft, save payload (5 cases) | component (client) | ✅ red at pass 1 (DOM still `"Loading…"` at query time; ambiguous "use default"; over-strict payload assertion) | ✅ |

**Two red-proof caveats, disclosed rather than glossed:**

- **B1 and B2 carry no new red-first proof.** B1 (routing `playbookStore.save()`'s
  optimistic merge through the real resolver helpers instead of a third inline
  copy of the formula) was closed by making already-green tests exercise the
  corrected path. B2 (preview cards reading the server's `resolvedKind` before
  any edit) was confirmed by inspection only — distinguishing "read the served
  value" from "read the client-recomputed value that happens to equal it"
  needs a fixture where the two diverge, which was judged out of scope for that
  pass. The verifier independently reasoned through both for staleness and
  confirmed them fixed, but neither has a mutation proof.
- **F2's orphan-check branch is unreachable by design** when F1 is correct — the
  belt to F1's braces. T1c reaches it only via a deliberately unmigrated
  fixture. That is the correct shape, but it means the guard proves F2's logic,
  not that F2 ever fires in production.

## Files changed

Single repo, single commit `3b9769e` against base `f78b2ec`:

```
 client/package-lock.json                           |  18 +
 client/package.json                                |   1 +
 client/src/i18n/locales/en/coach.json              |   9 +-
 client/src/i18n/locales/ko/coach.json              |   9 +-
 client/src/i18n/locales/vi/coach.json              |   9 +-
 client/src/i18n/locales/zh/coach.json              |   9 +-
 client/src/lib/__tests__/playbookStore.test.ts     | 102 +++
 client/src/lib/api.ts                              |  21 +-
 client/src/lib/playbookStore.ts                    | 103 ++-
 client/src/lib/types.ts                            |  44 +-
 client/src/pages/PlaybookPage.tsx                  | 184 ++++-
 client/src/pages/__tests__/PlaybookPage.test.tsx   | 155 +++-
 .../__snapshots__/screens.snapshot.test.tsx.snap   |  65 ++
 .../src/pages/__tests__/screens.snapshot.test.tsx  |   8 +
 .../product/coach/coach-playbook-vocabulary.md     |  44 +-
 .../coach-observations-severity-rebuild.test.js    | 831 +++++++++++++++++++++
 server/__tests__/db-migration.test.js              |  92 +++
 .../fixtures/playbook-resolution-cases.json        | 106 +++
 server/__tests__/playbook-resolver-guard.test.js   |  84 +++
 server/__tests__/playbook-resolver-parity.test.js  | 162 ++++
 server/__tests__/playbook.test.js                  | 295 ++++++++
 server/db.js                                       | 180 ++++-
 server/lib/playbook/engine.js                      |  12 +-
 server/lib/playbook/practices.js                   |  79 +-
 server/openapi-extra/playbook-coach.js             | 100 ++-
 server/routes/playbook.js                          |  88 ++-
 26 files changed, 2738 insertions(+), 72 deletions(-)
```

Product code is 6 files (`server/db.js`, `practices.js`, `engine.js`,
`routes/playbook.js`, `playbookStore.ts`, `PlaybookPage.tsx`) plus API surface,
i18n and docs; the bulk of the diff is tests.

## Standing guards + Definition of Done

- [x] **Each new test observed RED before, GREEN after** — with the two
      disclosed exceptions above (B1, B2 — inspection-confirmed, not
      mutation-proven).
- [x] **Full relevant suites green** — server `1300/1300` (314 suites, 0 fail),
      client `699/699` (59 files, 0 fail). Both independently re-run by the
      verifier at pass 4 under an external `DASHBOARD_DB_PATH` safety net.
      (The 701 → 699 client drop was investigated, not accepted: S7 consolidated
      4 `it()` wrappers into 2 case-table loops; zero case coverage lost.)
- [x] **§9.1 DERIVED-DUAL-VIEW** — single resolver, zero raw readers
      (`grep` empty), guard red-proven; second-order client copy closed by the
      shared parity fixture.
- [x] **§9.3 VACUOUS-GUARD** — every new structural guard has a recorded red
      observation against a real mutation, restored byte-identical.
- [x] **§9.4 FIX-ROUND-REGRESSION** — both engine sites, both cards, both DDL
      CHECK lists changed together in one commit.
- [x] **§9.6 NON-ATOMIC REBUILD** — F1 + F2 + B3 + D1 helper + D2 registry.
- [x] **Build/typecheck clean** — `rm -rf tsconfig.tsbuildinfo dist && npm run
      build` (forced clean rebuild, to rule out a stale build cache) succeeds,
      zero errors; only the pre-existing chunk-size warning.
- [x] **File-header audit** — `bash .claude/skills/file-headers/scripts/check-headers.sh`
      exits 0 (re-run by `build-lead`: "All applicable files carry the
      authorship header").
- [x] **Plan DoD** — resolver 8-field shape; route's 4 new fields +
      `in`-based partial patch (`null` clears, invalid 400s); i18n keys in all
      four locales; OpenAPI schema + both example blocks; vocabulary doc
      corrected and dated citing DEC-3; **no test anywhere asserts
      `observation.kind === resolvedKind` after an override change** (re-grepped
      across `server/__tests__` and `client/src`, zero hits) — DEC-2 genericity
      and DEC-4 free choice held; WATCH-1/2/3 preserved exactly as decided.
- [ ] **F3 — DB backup + manual double-boot walkthrough (Task 37).**
      **NOT performed. Mandatory before merge.** See below.
- [x] **Production `dashboard.db` untouched** — verified by checksum/mtime in
      all four passes; drift attributed to independently-running dev servers
      whose `cwd` is the main checkout, confirmed via `ps`/`lsof`.

## Worktree & stack

- **Worktree path (review and merge from here, not the main checkout):**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor`
- **Branch:** `effort/2026-08-02-practice-kind-override` (no upstream; never
  pushed)
- **Base:** `master` at `f78b2ec2805dcb2828e94cba339923687418ea81`
- **Docker stack:** none provisioned — this repo's compose files describe the
  containerized production path only, and both plans verify exclusively via
  `npm run test:server` / `npm run test:client`. Nothing to tear down.

## Shipped commit

- **Claude-Code-Agent-Monitor:** `3b9769e136d33af7704c0dab27a829e9957fceb0` —
  26 files, +2738/−72. Committed on the effort branch only; **not pushed, not
  merged**. The commit message records all four red-by-injection proofs
  verbatim, per the §9.1 durable-cure obligation.

## Residual risk & back-out

**Watch:**

1. **F3 (Task 37) is the merge gate and has deliberately not been run.** It is
   a human-supervised step: back up the real `/Users/sara/.claude/agent-dashboard/dashboard.db`,
   then boot twice against a **copy**, verifying the migration runs, is
   idempotent on the second boot, preserves rows and indexes, pins the enum,
   renders the i18n keys, and throws nothing / loses nothing. No verification
   or build agent performed it, and no backup artifact for this effort exists.
   F1 makes this safer; it does not make it optional. **Do not merge before
   this passes its own Done-check.**
2. **`master` has moved a long way since the base commit.** The branch is based
   on `f78b2ec`; `master` is now at `00655dc` — 20+ commits, including two other
   merged efforts. Six of this build's 26 files also changed on `master`:
   `client/src/lib/api.ts`, `client/src/lib/types.ts`,
   `client/src/pages/__tests__/screens.snapshot.test.tsx` (+ its snapshot),
   `server/db.js`, and `server/__tests__/db-migration.test.js`. A dry-run merge
   (`git merge-tree`) auto-merges five of the six and produces **exactly one
   textual conflict: `server/__tests__/db-migration.test.js`** — both sides made
   adjacent additive edits (`master` added new `UPGRADE_CASES` entries; this
   branch added the D2 `REBUILD_CASES` registry). Mechanically resolvable by
   keeping both, but re-run the full server suite after resolving, since that
   file is where the D2 registry guard lives. This is broader than the build
   brief's original `api.ts`/`types.ts` heads-up.
3. **B1/B2 have no mutation proof** (see the red→green caveats). If either
   regresses, no test names it. A follow-up worth considering: a fixture where
   the server's `resolvedKind` and the client's recomputed value deliberately
   diverge, so "which one did the card read?" becomes testable.
4. **The five pre-existing non-atomic rebuild sites in `server/db.js`**
   (`plan_items` ×2, `token_usage` ×2, `webhook_targets`) remain live and are
   now formally grandfathered in the `REBUILD_CASES` registry with dated
   reasons. They are unfixed §9.6 instances, deliberately out of scope. The
   registry means the next new rebuild site cannot join them silently.
5. **F2's orphan-check branch executes in no production scenario** if F1 holds,
   and only fires on a torn state F1 is designed to prevent. Correct by design;
   it means the guard's real-world exercise count is expected to be zero.
6. **WATCH-2 ships knowingly incomplete:** the severity selector saves a value
   nothing in the product currently renders. Data-layer verification only, as
   decided. The `OverrideSelects` doc comment now says so accurately (S1).

**Back-out (per touched repo):**

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor reset --hard f78b2ec2805dcb2828e94cba339923687418ea81
```

(One repo — this project is a single self-contained monorepo, confirmed at
triage. The commit is unpushed, so this is a complete back-out.)

## Open decisions

- **DEC-5 — adopt an un-intake'd-capability routing rule in this repo's
  `PROJECT-CONTEXT.md`: PENDING.** A forward-looking process change, not a
  build input; does not block this merge.
- **WATCH-1 — no per-user override model: PARKED** (exclusion tracked, not
  re-discovered).
- **WATCH-2 — the severity selector controls a value nothing renders: PARKED**
  (disclosed limitation shipped knowingly).
- **WATCH-3 — the severity CHECK migration skips on non-conforming data:
  PARKED** (accepted partial outcome; behavior preserved exactly — skip, never
  rewrite, never throw).
- DEC-1, DEC-2, DEC-3, DEC-4: DECIDED, all honored in the built code.

**Declined/deferred verifier recommendation, recorded so it is not mistaken for
done:** after the live-data-safety incident (pass 1), the verifier recommended a
**global test-runner safety net** — fail loudly if `DASHBOARD_DB_PATH` is unset
while anything in `server/__tests__/` runs — independent of any one test file
remembering to set it. It was flagged again at pass 2 as still absent and
**was not adopted**. The per-test fix landed; the class-level guard did not.
The next server test that calls `require("../db")` without setting
`DASHBOARD_DB_PATH` will again target the real `dashboard.db`, and a file-level
grep will not catch it (the mention must be scoped to the exact `describe`
calling `require`).

## Next step

This build **stopped at green and committed to the effort branch** — it did not
push, did not open a PR, and did not merge. The next actions are the user's:

1. **Run F3 (Task 37) — mandatory, human-supervised.** Back up the real
   `dashboard.db`, boot twice against a copy, work the Done-check list in
   `build-task-list.md`. Merge is gated on this.
2. Resolve the one `db-migration.test.js` merge conflict against current
   `master` and re-run `npm run test:server`.
3. Then merge / push / open a PR, or hand it back for changes.

**No teardown has been performed and none is automatic.** The worktree at
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor`
and the branch `effort/2026-08-02-practice-kind-override` are left live
deliberately, so F3 and the merge happen against the exact tree that was
verified. Whoever merges runs the teardown manually
(`git worktree remove …`). No Docker stack was provisioned, so there is none to
stop.
