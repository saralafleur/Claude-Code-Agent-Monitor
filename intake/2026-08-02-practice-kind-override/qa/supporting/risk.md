# Risk & Regression Analysis — practice-kind-override

> Authored by `qa-risk-analyst`. Grounds the change-brief's already-detailed
> test-invariants list in this project's `PROJECT-CONTEXT.md` §9.1–§9.5
> catalog and in the actual current source (`server/db.js`, `server/lib/
> playbook/{practices,engine}.js`, `server/routes/playbook.js`,
> `client/src/pages/PlaybookPage.tsx`), read directly for this pass rather
> than taken on the plan's word. The change-brief and technical plan already
> name most of the structural risk correctly — this document's job is to
> confirm it against code, sharpen the DB-rebuild risk with a mechanism the
> plan's own rails do not fully cover, and rank everything for test-writing
> order.

---

## 1. Blast radius

Beyond the 14 changed files, this build touches or is downstream of:

- **`server/db.js` module-load sequence.** `db.js` runs its entire schema
  block — `CREATE TABLE IF NOT EXISTS` bodies, then every guarded
  rebuild/migration block, in file order — synchronously at `require()`
  time, before any route or the Coach engine can run. Every one of the ~20
  files that `require("../db")` (`server/index.js`, every route, `engine.js`,
  `alerts.js`, `reconciliation.js`, `account-capture-scheduler.js`, etc.)
  depends on this sequence completing without throwing. A bug in the new
  `coach_observations` rebuild block does not just risk that one table — it
  risks the entire server failing to boot, for every route in the app, not
  just Playbook's.
- **`DB_PATH` is a single shared file across every surface this monorepo
  ships** (`server/db.js:117`, confirmed): the Express server, the MCP
  server, the Electron desktop app, and the VS Code extension all resolve to
  the same `dashboard.db` (or `DASHBOARD_DB_PATH` override) and each
  independently executes this same `require("./db")` migration code on its
  own process start. This is the concrete referent behind §9.5's own note
  ("`DB_PATH` resolves to the user-global shared file, so a schema change
  from any worktree immediately reaches the real dashboard") — extended here
  to *multiple concurrently-running processes*, not just multiple worktrees.
- **`resolvePracticeConfig()`** (`server/lib/playbook/practices.js`) is
  explicitly being promoted to sole source of truth for effective
  kind/severity. Its consumers after this build: `engine.js` (×2 call
  sites), `routes/playbook.js` (`serializePractice`, and the `PUT` handler's
  own `current = resolvePracticeConfig(...)` call used to preserve
  untouched overrides — see §4 below), and indirectly `playbookStore.ts`'s
  new draft-resolution helper (a *documented*, bounded duplicate for
  unsaved-draft state only).
- **The `playbook_practice_config.config` TEXT/JSON blob** becomes a shared
  namespace: numeric field keys (`gapThresholdPct`, `thresholdTokens`) and
  the two new override keys (`kindOverride`, `severityOverride`) now live
  side by side in the *same* stored JSON object, even though they are
  presented as separate top-level fields on the wire. Any code that treats
  `row.config` as "just the numeric fields" (present or future) is now
  wrong.
- **`coach-playbook-vocabulary.md`** — the spec-of-record for `kind`/
  `severity` naming — is being corrected in the same commit as the schema
  change it describes. `DEC-3`'s history (the vocabulary doc drifted from
  shipped code within 8 hours, undetected, on 2026-08-01→02) is itself the
  live precedent for why doc and code must land together here.
- **`GET /api/playbook/practices`'s WebSocket broadcast**
  (`playbook_practice_config_updated`) fans out to every connected browser
  tab across every computer this single-operator install is open on
  (`WATCH-1` — no user-identity model, one global singleton). A malformed
  `serializePractice()` output after this change reaches every open tab
  simultaneously, not just the one that saved.

---

## 2. Invariants that must hold (mapped to this project's defect catalog)

This project has a configured catalog (`PROJECT-CONTEXT.md` §9.1–§9.5). All
five entries are directly implicated by this change — an unusually high
density for one intake, and correctly recognized as such in both the
change-brief and the technical plan.

- **§9.1 DERIVED-DUAL-VIEW, in its normal form** — applies in full to the
  four *live* readers of effective kind/severity (`engine.js` ×2,
  `serializePractice()`, both `PlaybookPage.tsx` preview lines). All four
  must agree, always, post-change. Confirmed live in the catalog itself
  under a **design-time pre-flag dated for this exact intake** — this is not
  a hypothetical mapping, the catalog already names this build by path.
  There is also a **second, independent §9.1 instance already live on this
  surface**, unrelated to kind/severity: `resolvePracticeConfig()`'s numeric
  field-merge rule is hand-copied into `validateConfigPatch()`
  (`routes/playbook.js`) — confirmed in current code (both walk
  `practice.fields` independently, neither calls the other). The plan's
  Override 1 keeps these as two functions sharing one enum/helper rather
  than doing PM's requested full extraction — accepted as a smaller cure,
  correctly flagged as a scope note rather than a blocker.
- **§9.1's INVERTED form for this specific surface — the one novel wrinkle
  in this catalog entry.** `coach_observations.kind`/`.severity` (frozen at
  insert) and the live-resolved kind/severity (catalog + current override)
  are two *intentionally divergent* views of the same-named field once an
  override changes. The catalog states this explicitly and pre-emptively:
  "Never add a trigger, computed column, or backfill to re-sync historical
  Observations," and "the acceptance test is 'changing the override does
  NOT change any existing Observation's stored kind,' not 'the two values
  match.'" **A reviewer or a test-writer applying §9.1's usual criterion by
  rote here produces the wrong test.** This is worth over-communicating to
  whoever writes `playbook.test.js`: an assertion of the form
  `observation.kind === serializePractice(practice).resolvedKind` after an
  override change is not a stronger version of the frozen-snapshot test —
  it is a test for the opposite, wrong behavior, and if written and made to
  pass, it means the freeze was broken to satisfy it.
- **§9.3 VACUOUS-GUARD** — applies to the new
  `playbook-resolver-guard.test.js` (must be shown red by rogue-reader
  injection before it counts) *and* to the frozen-snapshot regression test
  itself (a test that never updates a row trivially "passes" without
  proving anything — it must also be shown red against pre-change code,
  where the engine still writes the bare catalog value on every tick).
  Two independent guards in this one build both carry a live §9.3
  obligation; do not let either one's red-state proof get skipped because
  the other's was done.
- **§9.4 FIX-ROUND-REGRESSION** — directly on point for `evaluateSession()`
  / `evaluateGlobal()`. This is not a "fix round" in the literal sense (it's
  a build, not a post-merge patch), but the shape is identical to what §9.4
  names: two independent call sites into the same sink
  (`insertCoachObservation.run`), a change motivated by (and easy to test
  against) one scope, with a structurally separate sibling caller that a
  single test run against only the global-scoped practice cannot prove
  clean. `account-weekly-balance` (global) is the worked example throughout
  the request/pm-plan/decisions — the session-scoped twin
  (`session-token-ceiling`) is the one that a lazy pass could skip.
- **§9.5 FRESH-DB-BLIND SCHEMA CHANGE, in a variant the catalog's own
  acceptance criterion doesn't literally cover.** §9.5's stated cure is "a
  guarded `ALTER TABLE … ADD COLUMN` plus an `UPGRADE_CASES` entry" — but a
  `CHECK` constraint cannot be added via `ALTER TABLE ADD COLUMN` at all
  (SQLite limitation, already documented in this file at line 672 re:
  `detour_dispositions`), so the prescribed cure is mechanically
  inapplicable and a full rebuild is required instead. **This means
  `db-migration.test.js`'s own meta-test — which enforces §9.5 by scanning
  only for `ALTER TABLE … ADD COLUMN` occurrences — cannot see this
  migration at all.** The meta-test will report clean even if the rebuild
  is never written. This is exactly why the technical plan calls the new
  `db-migration.test.js` case a required deliverable rather than a tripwire
  — confirmed correct by reading the meta-test's regex directly
  (`server/__tests__/db-migration.test.js:714-720`, `alterPattern = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/g`).
  QA must not treat "the meta-test still passes" as any signal at all about
  this migration's correctness.

---

## 3. Recurring-issue mapping — direct hits, not analogies

Every one of the five catalog entries is touched, not by inference but by
the catalog's own text:

- **§9.1** carries a **live design-time pre-flag dated 2026-08-02 naming
  this exact intake path**, plus a second live instance (the
  `validateConfigPatch`/`resolvePracticeConfig` field-merge duplication)
  discovered on the very same surface one day prior. Both are **open** —
  neither is resolved by this plan, only contained (structural guard for
  the first; shared-enum-not-shared-function for the second, explicitly
  logged as a smaller cure than requested). Treat both as **WATCH**, not
  closed, going into this build.
- **§9.3** is not "possibly relevant" — the plan's own Step 6 and §6.1 both
  mandate red-state proof for the two guards this build must ship, matching
  §9.3's acceptance criterion verbatim.
- **§9.4**'s catalog text describes a *fix round*, and this is formally a
  build, not a fix round — but the failure shape it names ("correct for the
  caller that motivated it, missing a sibling caller") is the literal
  structure of `evaluateSession()`/`evaluateGlobal()` here. Treat the
  catalog's acceptance criterion ("name the other callers, state what the
  fix does to each, one negative case per dimension") as binding even
  though this is a first build, not a fix round — the two-call-site shape
  is what matters, not which pipeline stage introduced it.
- **§9.5** is a **direct regression risk against a fix this project has
  already paid for once**: `server/db.js` line 672's comment
  ("SQLite cannot add a CHECK via ALTER TABLE ADD COLUMN at all, so
  shipping the base shape first would cost a full rebuild") was written
  *for a different table* (`detour_dispositions`, DEC-15/WATCH-4) as a
  lesson from having designed around this exact SQLite limitation before.
  This build is the first time that lesson is being applied to a
  *pre-existing* table with *live* data (`detour_dispositions`' write-audit
  columns shipped in the initial `CREATE TABLE`, before any real rows
  existed — this is not the same situation). **If the rebuild block gets
  this wrong, it does not "regress" §9.5's fix — it is the first real test
  of whether that lesson generalizes to existing data, and a failure here
  is a first occurrence, not a recurrence,** which arguably makes it more
  dangerous: there is no second data point yet to say the pattern is safe.

**This change touches a live, unresolved §9.1 entry** (the design-time
pre-flag naming this exact intake) and should be treated with the same
weight as an entry marked OPEN elsewhere in this catalog's convention.

---

## 4. The single highest-risk item: the guarded `coach_observations` rebuild

This deserves analysis beyond what the technical plan's own rails cover,
because the plan models Step 2.2 on `server/db.js`'s existing `plan_items`
rebuild precedent (lines 749-807) — and that precedent has a real,
un-flagged crash-window gap of its own, which this build would inherit
verbatim if copied as literally as the plan's prose describes.

### 4.1 The crash-window gap inherited from the `plan_items` precedent

Reading `server/db.js`'s two existing rebuild precedents side by side:

- **`plan_items`** (`server/db.js:749-807`): `ALTER TABLE … RENAME TO
  plan_items_old` and `CREATE TABLE plan_items (…)` run as **separate,
  unwrapped statements** — only the row-copy loop is inside a
  `db.transaction()`. `DROP TABLE plan_items_old` runs after that, also
  unwrapped.
- **`agents`** (`server/db.js:~1472-1513`): the **entire** sequence —
  `CREATE TABLE agents_new`, `INSERT INTO agents_new SELECT …`,
  `DROP TABLE agents`, `ALTER TABLE agents_new RENAME TO agents` — is
  wrapped in one explicit `BEGIN; … COMMIT;` block via `db.exec(...)`,
  making the whole rebuild atomic: a crash at any point before `COMMIT`
  leaves the *original* `agents` table completely intact on the next boot
  (SQLite rolls back an uncommitted transaction automatically).

The technical plan's Step 2.2 explicitly says it is "modelled on the
`plan_items` rebuild" (the **weaker, non-atomic** precedent), not the
`agents` one. Walking through what that means for `coach_observations`:

Sequence: `RENAME coach_observations → coach_observations_old` → `CREATE
TABLE coach_observations (new schema, with CHECK)` → `db.transaction()`
wrapping the row copy → `DROP TABLE coach_observations_old`.

The idempotency guard on the *next* boot is: read `sqlite_master.sql` for
the table named `coach_observations`, and skip the whole block if that text
already contains `CHECK(severity IN`.

**The gap:** if the process is killed (crash, OOM, `kill -9`, power loss)
at any point *after* `CREATE TABLE coach_observations` succeeds but
*before* the row-copy transaction commits, the table named
`coach_observations` on disk is now the **freshly created, empty** one —
and its `sqlite_master.sql` text already contains the `CHECK` clause,
because that's literally the first thing written into the new table's DDL.
On the next boot:

1. The plain `CREATE TABLE IF NOT EXISTS coach_observations` at the top of
   `db.js` is a no-op (the table already exists — it's the new empty one).
2. The guard for the rebuild block reads `sqlite_master.sql`, sees the
   `CHECK` clause is already present, and concludes **the migration already
   ran** — it will not attempt the rebuild again.
3. `coach_observations_old` — holding every historical Observation ever
   recorded on this install — sits on disk, orphaned, un-referenced by any
   code path, forever. The application boots clean, looks healthy, and
   every Observation the operator ever saw is gone from every view the
   product renders.

This is **not a hypothetical edge case reachable only by extreme bad luck**:
it is a crash during the exact multi-hundred-millisecond-to-multi-second
window this migration runs in, on a step this plan itself calls "the
single largest risk item in the plan" and schedules first specifically
because it runs at boot. A killed process during an OS-level restart,
resource-constrained environment kill, or an operator impatiently
Ctrl-C'ing a slow-feeling first boot after upgrade are all realistic ways
to land in this window. **This is worse than the WATCH-3 skip-path the
plan already accepts** — WATCH-3 is a *known, disclosed, narrow* divergence
(no CHECK, data intact); this crash-window gap is *silent, total, and
already looks like success* (CHECK present, boots clean, data invisible).

**What a correct test/build must verify, beyond the plan's current §6.4
list:** either (a) the rebuild block adopts the `agents` precedent's
atomic-transaction shape (single `BEGIN…COMMIT` wrapping rename-or-create,
copy, and drop, so a mid-sequence crash rolls back to the pre-migration
state on next open rather than landing in a state indistinguishable from
success), or (b) the idempotency guard is strengthened to also detect an
orphaned `coach_observations_old` table (`SELECT name FROM sqlite_master
WHERE type='table' AND name='coach_observations_old'`) and treat its
*presence* as "an incomplete prior rebuild — resume/repair," not merely
gate on the new table's schema text. As written, the plan's Step 2.2 does
neither. **This is the single test this whole risk document most wants
written: kill the process (or simulate it by running each DDL statement as
a separate `db.exec` call and stopping partway) between `CREATE TABLE` and
the transaction commit, restart, and assert the old data is not silently
lost.**

### 4.2 Pre-existing rows with unexpected severity values (WATCH-3 path)

Already well-covered by the plan (pre-flight `COUNT(*) WHERE severity NOT
IN (...)`, skip-don't-throw-don't-rewrite) and tracked in `decisions.md`.
One addition worth pinning as a specific test case, not just the aggregate
count check the plan's §6.4 item 6 describes: verify the skip path is
triggered by **a single non-conforming row among thousands of conforming
ones**, not just an all-non-conforming fixture — an off-by-one in the
`COUNT(*)` guard (e.g., checking `> some threshold` instead of `> 0`, or a
query that accidentally filters using the wrong table name mid-refactor)
would only be caught by a fixture where the count is exactly 1.

### 4.3 Concurrent access during the rebuild — a real, if narrow, hazard

`server/db.js` sets `journal_mode = WAL` and `busy_timeout = 5000`
(confirmed, lines 133/135), which absorbs *brief* write contention between
processes sharing the same `DB_PATH` file. But per §1 above, this repo
ships **multiple independent processes** that can each open the same
`dashboard.db` and independently run this exact migration code at their
own process start (the Express server, and separately the desktop/VS Code
surfaces per this repo's topology). SQLite allows only one writer at a
time regardless of journal mode, and schema-changing DDL (`RENAME`,
`CREATE TABLE`, `DROP TABLE`) requires an exclusive lock. If two such
processes are started within the same ~5-second window on the *first* boot
after this upgrade (a very plausible moment — an operator upgrading and
restarting more than one connected surface at once), one of two things
happens: they serialize cleanly within the 5-second `busy_timeout` (best
case, likely the common case on this table's probably-modest row count),
or the second process's blocked statement outlives the timeout and throws
`SQLITE_BUSY` — which, because `db.js` runs at `require()` time, **crashes
that second process's boot entirely**, not just one request. This is worth
a manual verification step (start two processes against the same
freshly-copied real DB near-simultaneously, confirm one wins cleanly and
the other either waits successfully or fails in a way that is safe to
simply retry/restart) rather than a `node:test` case, since it is
inherently a timing/OS-process concern — but it should be explicitly
exercised once, not left as an assumption that WAL mode alone makes this
"someone else's problem."

---

## 5. The two-independent-validators hazard — confirmed live in current code

Read directly, not inferred: `resolvePracticeConfig()`
(`server/lib/playbook/practices.js:99-116`) and `validateConfigPatch()`
(`server/routes/playbook.js:52-70`) are today two **separately** written
functions that both walk `practice.fields` and both apply the same "known
key, finite number, >= min" rule — confirmed independent implementations,
not a shared helper. The technical plan's Override 1 does not fix this; it
explicitly keeps this pattern and applies the same shape to the *new*
fields (`resolvePracticeConfig`'s widened form vs. the new sibling
`validateOverridePatch()`), unified only by a shared exported
`KIND_VALUES`/`SEVERITY_VALUES`/`coerceEnum` — vocabulary shared, logic
still duplicated once per function.

The two functions must fail in **opposite directions** by design (resolver
fails safe/coerces-to-null because it runs outside `tick()`'s per-scope
try/catch and a throw there kills every practice's evaluation for that
tick; the route validator fails loud/400s because a rejected PUT is
recoverable and a silently-dropped one is not) — this is a deliberate,
correct design choice, not a bug to unify away. The risk is narrower and
sharper than "these two functions disagree": **it is that a future edit to
one side's field/enum handling silently stops being mirrored on the
other**, and the two failure directions make that divergence invisible in
opposite ways:

- Miss updating the route validator for a new override field → every PUT
  attempting to set it either 400s (if it happens to fail the *old*
  validator's rules) or is silently accepted as an "unknown key" that never
  reaches persistence in the shape the resolver expects.
- Miss updating the resolver for a new override field → the route
  validates and persists it (PUT returns 200, looks correct), but no read
  path (`engine.js`, `serializePractice()`) ever surfaces it — "saved but
  never applied," which passes any test that only checks the PUT's HTTP
  status code.

**The concrete test that catches the second, more dangerous direction** —
already correctly named in both the change-brief and technical plan §6.2 —
is a PUT-then-GET round trip asserting `resolvedKind` in the *follow-up
GET* actually changed, not merely that the PUT returned 200. A test that
stops at "PUT succeeded" is a §9.3 VACUOUS-GUARD shape for this specific
hazard: it can stay green while the override is silently inert.

There is a second, related fragility specific to the **round-trip of the
existing override on every ordinary numeric save** (§2's "invariants," item
4 in the brief): the current (pre-change) `PUT` handler
(`server/routes/playbook.js:88`) builds its persisted `config` object as
`{ ...current.config }` where `current = resolvePracticeConfig(row,
practice)` — and today, `resolvePracticeConfig`'s returned `config` is
*strictly* the practice's declared numeric `fields[].key`s (built by
`defaultConfigFor()` plus the merge loop), with no pass-through for
unrecognized stored keys. **This means the correctness of "a numeric-only
PUT preserves an existing override" depends entirely on every future PUT
handler continuing to source `kindOverride`/`severityOverride` from the
*resolver's* widened return (`current.kindOverride`), not from spreading
`row.config`/`current.config` directly** — spreading either of those alone
would silently drop the override, because neither ever carried it in the
first place. The technical plan's Step 5.3 code gets this right by
constructing a fresh `stored` object from `config` (numeric) plus
explicitly re-attached `kindOverride`/`severityOverride` — but this is a
one-line-away-from-wrong pattern, and worth a comment at the call site (not
just this document) warning a future maintainer not to "simplify" it back
to `{ ...row.config, ...body }`.

---

## 6. The "ships green but broken" traps

Each of these is a concrete mistake that would pass `npm test` (current
suite, and even a plausibly-sloppy version of the *new* tests) undetected:

1. **A frozen-snapshot test that only exercises `account-weekly-balance`
   (global scope).** Green, and proves nothing about
   `evaluateSession()`/`session-token-ceiling`. This is §9.4's exact shape,
   and it's the easiest trap to fall into here because the worked example
   throughout the request/pm-plan/decisions is the global-scope practice.
   **Required assertion:** a twin frozen-snapshot test for the
   session-scoped practice, independently red-proven.
2. **The rebuild guard's idempotency check is schema-text-only, with no
   detection of an incomplete prior attempt.** Passes every test that only
   checks "second boot = no-op" against a *cleanly completed* first boot —
   because that's the only scenario `db-migration.test.js`'s §6.4 list
   currently describes. A crash-mid-rebuild scenario (§4.1 above) is
   invisible to that test shape entirely; the suite stays green while a
   real upgrade path silently loses every historical Observation.
   **Required assertion:** a test that interrupts the rebuild
   mid-sequence (simulate by running the DDL statements individually and
   stopping after `CREATE TABLE` but before the copy commits) and asserts
   the old data is either recovered on next boot or the migration visibly
   refuses to proceed — not silently treated as done.
3. **The structural guard (`playbook-resolver-guard.test.js`) is written
   but never shown red.** A guard added in the same commit as the fix it's
   meant to prevent will trivially pass forever, because the violation it
   exists to catch was never present while the test existed. Passes `npm
   test`. Catches nothing. **Required:** the injection-then-revert
   exercise the plan's own Step 6 mandates, recorded in the PR/commit
   message — QA should verify this record exists, not just that the test
   file exists.
4. **`validateOverridePatch()` gets the new fields; `resolvePracticeConfig`
   doesn't (or vice versa).** A test suite that only checks `PUT →
   200/400` status codes passes either way. **Required:** the PUT-then-GET
   round trip named in §5 above, specifically checking that `resolvedKind`
   changed, not merely that the response was 200.
5. **`PlaybookPage.tsx` lines 257/335 left un-fixed (or fixed on one card,
   not both).** Every server-side test — route tests, engine tests, the
   structural guard's server-side assertions — stays green. Nothing on the
   server can see this; it is purely a client rendering bug. The operator
   selects "Warning," the save succeeds, the preview directly under the
   control still reads "Reminder." **Required:** the client test named in
   plan §6.5 ("changing the kind selector updates the live preview
   **before** saving"), run against **both** card fixtures — a pass on one
   card's test proves nothing about the other, structurally identical to
   the server-side §9.4 concern one layer up in the stack.
6. **A missing `severityLabel` key in one locale.** `i18next` (or
   equivalent) typically falls back to rendering the raw key string rather
   than throwing, so this ships silently to any user on that locale with no
   test failure anywhere unless a test explicitly asserts translated output
   (not just that the key path resolves) in **all four** locale files.
7. **A well-intentioned "consistency" fix that re-syncs historical
   Observations to a changed override** (a trigger, a computed column, a
   view, a backfill script run once by a future maintainer "cleaning up"
   old data). This would make a naive dual-view consistency test *pass*
   while violating the actual contract this feature exists to provide.
   Catalog §9.1's inverted-application warning for this surface exists
   specifically to head this off — but it's a trap a reviewer applying
   §9.1's *usual* form by rote could introduce as a "fix," not just a
   builder. **Required:** the plan's own DoD line, "No test anywhere
   asserts 'live resolved kind == a stored Observation's kind' post-override,"
   should be checked as a literal `grep`/review pass over the diff, not
   assumed from good intentions.

---

## 7. Severity & priority

Ranked by (a) whether it can brick every install on this dashboard vs. one
feature, (b) whether it is silent/undetectable by the current or planned
suite vs. loud, and (c) data-loss vs. cosmetic:

| # | Risk | Blast radius | Detectability without a new test | Priority |
|---|---|---|---|---|
| 1 | Rebuild crash-window data loss (§4.1) | Every route/process using this DB; total loss of `coach_observations` history | Silent — looks like a clean, successful upgrade | **P0** — test/harden before anything else |
| 2 | Rebuild pre-flight skip miscounts or is bypassed (§4.2) | App-wide boot; either bricks boot (if a throw slips in) or silently ships without the CHECK | Silent (skip path) or catastrophic (throw path) | **P0** |
| 3 | Resolver/route-validator divergence, "saved but never applied" direction (§5) | Every operator interaction with the override UI | Silent — 200 OK, feature just doesn't work | **P1** |
| 4 | One engine call site missed (§9.4, item 1) | Half of all Observations (one scope) never honor overrides | Silent unless both scopes are tested | **P1** |
| 5 | Live-preview lines not fixed (§6, item 5) | Every operator's first impression of the feature | Silent to any server-side test; loud to a human eventually | **P1** — user-visible, trust-eroding, but not data-destructive |
| 6 | Numeric save clears an existing override (§5, round-trip fragility) | Any operator who sets an override then later tweaks a threshold | Silent — override just vanishes | **P1** |
| 7 | Vacuous structural/frozen-snapshot guards (§6, items 2–3) | Whole build's safety net | By definition invisible until exploited | **P1** — a process gap, not a runtime bug, but it invalidates confidence in everything above |
| 8 | Concurrent-process rebuild race (§4.3) | Narrow — only the unlucky process that loses a lock race, on first boot after upgrade | Loud (throws) for the losing process; not silent, but easy to dismiss as "just restart it" | **P2** |
| 9 | Missing i18n key / re-sync-Observation "fix" (§6, items 6–7) | One locale's users; or a future well-intentioned regression | Silent (i18n) / would be caught by review if §9.1's inverted note is heeded | **P2** |

P0/P1 items are exactly the ones the technical plan's own DoD and §6 test
plan already target — this ranking mainly argues for sequencing: write and
prove the rebuild's crash-window and pre-flight tests (§4) **before**
polishing the frozen-snapshot/route/client tests, since a broken rebuild
bricks the ability to run *any* of the rest of the suite against a real
upgraded DB.

---

## 8. Disclosed-and-declined coverage — needs a tracked artifact, not just this file

Per this pipeline's own rule (and the technical plan's §7.3, which already
does this correctly for its three items), the following risk named in this
document is **not** currently guarded by any test in the plan's §6 list and
is being knowingly left unguarded this round:

- **§4.1 above — the rebuild's crash-mid-sequence data-loss window.** This
  is a real gap in the plan as written (Step 2.2 models the weaker
  `plan_items` precedent rather than the atomic `agents` precedent, and the
  plan's own §6.4 test list only proves idempotency on a *cleanly
  completed* first boot). It is not named anywhere in `decisions.md` as a
  WATCH row, and it is not covered by any of the six `db-migration.test.js`
  assertions in the plan's §6.4. If the build team chooses to ship Step 2.2
  as literally specified (non-atomic, `plan_items`-style) without either
  hardening the guard or adding a crash-simulation test, **that choice
  needs a `decisions.md` WATCH row of its own** — this cannot be the first
  time this gap is mentioned, and it should not exist only as prose in this
  file. If the build team instead adopts the `agents`-style atomic wrap (or
  adds the "detect an orphaned `_old` table" guard), no WATCH row is
  needed — the risk is closed rather than accepted.

Everything else this document raises is already either (a) explicitly
covered by a named test in the technical plan's §6, or (b) already tracked
in `decisions.md` (WATCH-1, WATCH-2, WATCH-3, DEC-5) as of this pass.

---

## Files read for this analysis

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-practice-kind-override/qa/change-brief.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-practice-kind-override/technical-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-practice-kind-override/decisions.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/PROJECT-CONTEXT.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/db.js` (schema
  block, `plan_items`/`webhook_targets`/`agents` rebuild precedents,
  `coach_observations`/`playbook_practice_config` bodies, WAL/busy_timeout
  pragmas, `DB_PATH` resolution)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/lib/playbook/practices.js`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/lib/playbook/engine.js`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/routes/playbook.js`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/pages/PlaybookPage.tsx`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/client/src/components/coach/ObservationCard.tsx`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/db-migration.test.js` (meta-test regex, confirmed `ALTER TABLE … ADD COLUMN`-only scope)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/server/__tests__/single-writer-guard.test.js` (structural-guard shape precedent)
