# Project Context

## Repo topology

Confirmed 2026-07-31 via the `worktree` skill's `story-discovery` pass.

- **Claude-Code-Agent-Monitor** (this repo) — self-contained monorepo.
  Bundles every surface of the product under one root: Express/SQLite
  server, React+Vite client, MCP server, desktop (Electron) app, VS Code
  extension, and monitoring stack. No separate sibling repo exists — this
  is a single-repo solution.

**Explicitly excluded:**
- No candidates found. Sibling directories under `~/CODE-LOCAL/SARA/*`
  were scanned for a matching git remote (`hoangsonww`, `agent-monitor`,
  `claude-code-agent`, `ccam`) — none matched. Desktop and VS Code
  extension sub-packages declare the same repo URL as the root
  `package.json`, confirming they're part of this repo, not standalone.

## Recurring defect-class patterns

Named patterns this project has independently rediscovered more than once.
Cite by name in review when a change touches the surface described.

### 9.1 DERIVED-DUAL-VIEW

A derived/summary value (e.g. `wall_ms`, `active_ms`, a concurrency ratio) is
computed once — server-side, in `server/lib/focus-report.js` — and consumed
by multiple independent client rendering surfaces. A fix or new field applied
to one consumer does not automatically apply to the others unless the value
and its rendering are shared via an extracted component/hook, not
hand-copied.

**Flagged in:** `intake/2026-07-26-focus-calendar-board/`,
`intake/2026-07-26-focus-report-fidelity/`,
`intake/2026-07-31-focus-untracked-commits/` (this item — 4th touch).

**Acceptance criterion:** same field, same value, across every consumer of a
given `FocusReport`, enforced by a cross-consumer test — not eyeballing two
UIs. See `client/src/components/__tests__/FocusReportModal.test.tsx`'s
`[standing template]`/`[board-mode extension]`/`[FocusPage extension]` tests
(search `extend THIS test`) for the live implementation of this criterion.

**How to comply:** extract a shared component/hook (see
`HourWindowZoomBar`/`useHourWindowZoom`, `StatTile`/`ConcurrencyStatTile`,
`ProjectScopeFilters` for precedent) rather than reimplementing a formula in
a new consumer. If client-side duplication is genuinely unavoidable (a real
UX cost to a server round-trip), document it in the introducing file's own
header the way `client/src/lib/windowedTotals.ts` does: name the risk
explicitly, explain why extraction wasn't possible, and state the bound on
how far the duplicated value can diverge from the canonical one.

**Design-time pre-flag (2026-08-01, `intake/2026-08-01-build-project-manager/`
— NOT an occurrence, count unchanged):** the layers 4-6 build introduces three
new derived values at once (pace status, detour disposition, decision-queue
entry) with a deliberately-deferred layer-7 rollup UI queued to become their
second consumer. This pattern's own history shows the failure lands when
consumer #2 appears, not at introduction — so each computation must be written
as a single shared function on day one, before any second consumer exists.
Re-check at build/QA time and increment only if a real duplication ships.

**QA-pass note (2026-08-01, `team-qa` strategist, same intake — count still
unchanged, nothing built yet):** the planned test design covers the
*computation* form well (one `pace.js`, one `DISPOSITIONS` vocabulary) but
**not the write-sequence form**: `unit-tests.md` §4c and §5b each prove their
own call site invokes `applyDisposition` with the write path *stubbed*, and
`e2e-tests.md` does the one real end-to-end write only via reconciliation
(§4.2 stubs it for the human-resolve route) — so nothing asserts the two call
sites emit the same bytes for the same inputs, which is this entry's own
acceptance criterion. Systemic cause, now confirmed to be the same on the
server as on the client: **test scope is per-module, not per-shape** — the
one-spec-file-per-module convention gives a cross-consumer test no home, so it
is nobody's file and does not get written. This is the first change to run with
this entry live and enforceable (it was promoted to the catalog only last
cycle), so a plan that skips the criterion is the fix regressing, not a fresh
touch. Must-add before build: a cross-call-site byte-parity test in
`reconciliation-full-tick.test.js`. See
`intake/2026-08-01-build-project-manager/qa/qa-assessment.md`.

**Build-outcome note (2026-08-01, `intake/2026-08-01-build-project-manager/`
— 5th touch, counted: a real duplication was written, caught in review before
merge):** the write-sequence form is now mechanically enforced for the first
time — `plan-writeback.applyDisposition` is the sole write composer, guarded by
`server/__tests__/single-writer-guard.test.js` (exact call-site count + lexical
nesting, proven by injecting a rogue second call site) and by the cross-call-site
byte-parity test (`reconciliation-full-tick.test.js` Scenario C). The pattern
still recurred one layer over inside the same build: `plan-writeback.js`
hand-rolled its own copy of `reconciliation.enqueueIfNotOpen`, and **the copy was
the wrong one** (its dedup probe passed `item_id IS NULL` while its own insert
stored a real `item_id`, so it never matched its own open row). Found by review
(S1), fixed by extracting `server/lib/decision-queue-enqueue.js` and pointing
both call sites at it. Lesson to carry: the guard caught the composer this entry
was written about, and missed the second-order duplicate one call frame away —
when a build introduces a new "one function does X for everybody" rule, scan for
copies of *its helpers* too, not just of it.

**Known bounded exception:** `client/src/lib/windowedTotals.ts` —
client-side re-slice of the same 10-minute `chunks` grid the Calendar's idle
stripes already render from (not a re-derivation from raw events), bounding
drift from the server's own number to ≤1 chunk (10 min) at a window boundary.

### 9.2 row-id-as-chronology-proxy

A query or aggregation over a table with an auto-increment `id` assumes
`ORDER BY id ASC/DESC` reflects real chronological (`created_at`) order.
Breaks once `server/lib/workflow-ingest.js` bulk-inserts events after the
fact — those rows land at whatever `id` is next, regardless of their own
`created_at`.

**Flagged in:** `6e9a443` (2026-04-26, `client/src/pages/SessionDetail.tsx`,
display-ordering), `b3a2cc9` (2026-07-27, `server/lib/focus-report.js`,
arithmetic double-counting — real session confirmed with 7,152/8,117 events
out-of-order by id), and the `focus-inference.js` `buildActivityDigest()` fix
in `intake/2026-07-31-focus-untracked-commits/` (3rd instance, found live and
unaudited during this retroactive review, same batch as `b930824`'s AI
window-summary feature that consumes it).

**Acceptance criterion:** any code that walks `events` (or any other table
`workflow-ingest.js` bulk-inserts into) for chronological logic must sort by
`created_at` explicitly — never rely on `id` order alone. When a `LIMIT` is
applied in the same query, the `created_at` sort must happen **before** the
`LIMIT`, not after, since an id-ordered `LIMIT` can select the wrong subset
of rows entirely, not just present a correct subset in the wrong order.

**How to comply:** `ORDER BY created_at ASC/DESC, id ASC/DESC` (id as
tiebreak for equal timestamps) — this project's own established convention,
already used throughout `server/db.js` (`listEvents`,
`getEventsBySessionSince`, `webhook_deliveries` queries). `events.created_at`
is fixed-width ISO-8601 text, already indexed
(`idx_events_created ON events(created_at DESC)`) — no schema change needed
to comply.

**Design-time pre-flag (2026-08-01, `intake/2026-08-01-build-project-manager/`
— NOT an occurrence, count unchanged):** layer 6's reconciliation pass computes
a detour-volume ratio and "recent sessions/detours" windows over `events` and
`focus_inferences`; every such query must sort by `created_at` (id as tiebreak)
before any `LIMIT`.

**QA-pass note (2026-08-01, `team-qa` strategist, same intake — count still
unchanged, nothing built yet):** this is the first time the countermeasure is
being applied *before* the bug ships — the catalog working as intended — but
the planned suite covers **2 of the 5** queries the QA pass enumerated.
`unit-tests.md` §4g writes the trap-defeating out-of-order fixture for
`backfillDeclaredDetours` and `listPendingDetours`; `listStaleResolvedDetours`,
`listDecisionQueue`, and — worst — **layer 6's detour-volume-ratio lookback**
have none (§5a's R2 cases are ratio/session-count tables with no scrambled
insertion anywhere, so a chronology bug there flags the *wrong sessions* while
the suite stays green). Systemic cause: **the guarded-query list is enumerated
by hand in prose and re-typed by hand into a test table**, so a query named in
one document and not the other ships unguarded. Durable cure recommended:
derive the guarded-query list from one exported array with a
registry-completeness meta-test, plus a shared
`assertOrderedByCreatedAt(queryFn, seedFn)` helper so adding the regression
test costs less than skipping it. See
`intake/2026-08-01-build-project-manager/qa/qa-assessment.md`.

**Build-outcome note (2026-08-01, same intake — 4th discovery site, counted):**
the recommended cure was built (`server/__tests__/helpers/ordering.js`'s
`assertOrderedByCreatedAt`, invoked by all five behavioral cases, plus a static
SQL-shape scan over `server/db.js`/`lib/detours.js`/`lib/reconciliation.js`/the
two new routes with a dated `GRANDFATHERED_QUERIES` set). It paid for itself
immediately: the static scan found **three pre-existing `ORDER BY id` queries in
`server/db.js`** (incl. `recentEventSummaries`, `listFocusEvents`) unrelated to
this feature — the 4th confirmed discovery site — all fixed to
`ORDER BY created_at …, id …`. Two build-process lessons:
1. The scan's first SQL-literal regex used a body class of `[^`'"]`, so it
   silently skipped **every statement containing a quoted literal** — 5 of 11
   candidate queries inspected, and it reported clean. A scanner that under-scans
   is worse than none: extract each string literal FIRST, then test
   `^\s*SELECT` + `LIMIT`. (Fixed; see the header comment in
   `chronology-ordering.test.js`.)
2. Legitimate non-chronological `LIMIT`s exist (count-ranked top-N aggregates,
   e.g. "top 20 tools by count"). They belong in `GRANDFATHERED_QUERIES` with a
   reason and a date — not as a reason to weaken the scan.

### 9.3 VACUOUS-GUARD (a green test that asserts nothing)

A test written to close a *known* risk — usually a mandatory structural guard
demanded by this very catalog — ships in a shape that cannot fail: an empty
body, an existence-only check (`assert.ok(stmts.listX)`), a literal
`assert.ok(true, "…")` placeholder, an escape hatch (`assert.ok(x || true, …)`),
a tautology (asserting that rows returned by an `ORDER BY created_at` re-query
are in `created_at` order), a shared assertion helper that is imported and never
called, or a fixture in a state no real call site can produce. The suite is
green, the Definition of Done shows a tick, and the guard protects nothing. This
is more dangerous than no test: the next change reads the checkmark and stops
looking.

**Flagged in:** `intake/2026-08-01-build-project-manager/` — found across
**five** spec files, survived **two** consecutive BLOCKED verifier passes (the
second time, the placeholders had been reworded from empty bodies into
`assert.ok(true, …)` — cosmetic, not a fix), and a **sixth** shape (B4's
never-ingested fixture) survived into code review. Directly related to §9.1/§9.2:
in every case the vacuous test was the mandated cure for one of those two
entries, so a vacuous guard here silently un-does the catalog itself.

**Acceptance criterion:** for any test whose purpose is to guard a named risk,
the test must be shown to **fail** when the behavior it names is broken — not
merely to pass when it works. A guard with no recorded red state is not a guard.

**How to comply:**
- Prove it by mutation, not by reading: break the product code (disable the
  retry, `if (false)` the pace-breach branch, add a rogue second call site),
  observe the specific test fail, restore, confirm byte-identical, re-run green.
  Record the observation. This is how all six instances above were surfaced —
  three tests stayed green with the feature they name completely disabled.
- Cheap sweep before declaring done:
  `grep -rn "assert.ok(true" server/__tests__/` and
  `grep -rn "|| true" server/__tests__/` must both return 0; any shared
  assertion helper must have a call site (`grep` for its name).
- Watch for the subtler forms no grep catches: a fixture whose state no
  production call site can reach (B4), an assertion on `typeof`/`Array.isArray`
  where the test's own title promises a value, and a "verified elsewhere"
  comment standing in for an assertion.

**2026-08-01 — the cure held under its own fix round.** All four final-round
fixes (S4/S5/S6/S9) were proven by reverting the fix and observing the specific
new test fail, then restoring; the `assert.ok(true` / `|| true` sweep was re-run
and stayed at 0. Suite 1189 → 1209. Applying §9.3 to the *fix* round, not just
the build round, is what made "these four are fixed" a checkable claim rather
than an assertion.

### 9.4 FIX-ROUND-REGRESSION (the fix round is a build round)

A round of blocker fixes on the dispositional/queue surface introduces new
defects at roughly the same rate as ordinary implementation, but is reviewed as
if it were a touch-up. The failure shape is specific and repeats: a fix is
correct for the caller that motivated it and **over-applies** to a sibling
caller, or a new dedup/lookup key is scoped for one dimension and silently
swallows another.

**Flagged in:** `intake/2026-08-01-build-project-manager/` — the B1–B6 fix round
resolved 6 blockers and introduced 2 new defects, both silent, both found only
because an adversarial re-review of the fix diff was run:
- **N1** — the `detour_volume` decision-queue kind deduped **globally across
  every project** because its dedup key carried no `cwd`: after the first
  project filed a volume alert, every other project's was swallowed.
- **N2** — B4's retry fix (re-baseline against a fresh read) over-applied and
  defeated a **caller-supplied** `expected_hash`, silently breaking the
  human-resolve route's own conflict detection. Fixed by gating the
  fresh-rebaseline on whether the caller supplied a hash at all.

**Acceptance criterion:** a fix round on this surface gets its own adversarial
review pass over the fix diff, with the same standard as the original build —
not a re-run of the suite that was already green when the blockers were found.
(In this build the suite was green before, during, and after both regressions.)

**How to comply:** for every fix, name the *other* callers of the function you
changed and state what the fix does to each; for every dedup/anti-duplicate key,
enumerate the dimensions it must separate (cwd/project, kind, ref, item) and
assert one negative case per dimension. Treat "the fix round" as a build round
in the pipeline, not as an epilogue.

**2026-08-01 (same build, later round) — the second failure mode of a fix
round: its *unfixed remainder is invisible*.** The round resolved 6 blockers and
5 of 9 should-fix findings, and reported done. The other 4 (S4/S5/S6/S9) were
neither fixed nor recorded in `decisions.md`, and nothing in the pipeline
noticed: the suite was green, the DoD checklist ticked, and the review document
that raised them was not re-read against the shipped tree. Build-lead caught it
only by diffing `review.md`'s finding list against the code. Worse, the drop was
not benign — **S9, triaged in the report as "latent/bounded", was a real silent
data-loss bug** (`reconciliation.js` discarded `resolveDisposition`'s
`ALREADY_RESOLVED` return, so a terminal row whose prior write *conflicted* —
not the `written` state the idempotency guard checks — got re-written with the
**stale** stored proposal, silently dropping the fresh LLM verdict into the
user's plan file). **Add to the acceptance criterion:** every finding from a
review round must end the build in one of exactly two states — *fixed with a
test*, or *recorded in `decisions.md` with an id*. "Should-fix" is a triage
label, not a disposition. And a severity assigned by reading is provisional
until someone tries to reach the bug: 1 of these 4 upgraded on contact.

### 9.5 FRESH-DB-BLIND SCHEMA CHANGE

A schema change lands only in a `CREATE TABLE IF NOT EXISTS` body. Every test
that builds its own throwaway database gets the new shape and passes; every
database that **already exists** — the user's real
`~/.claude/agent-dashboard/dashboard.db`, a developer's dev DB, an in-progress
effort's own DB — keeps the old shape forever, because `IF NOT EXISTS` is a
no-op on an existing table. The suite is green and the upgrade path is broken.

**Flagged in:** `intake/2026-08-01-build-project-manager/` — `project_id TEXT`
was added to `detour_dispositions`' `CREATE TABLE` and to
`upsertDetourDisposition`'s INSERT with no `ALTER TABLE`. It surfaced only
because part of this repo's server suite runs against the **real shared** DB:
`pricing-calc.test.js` failed with `SQLITE_ERROR: table detour_dispositions has
no column named project_id`. Had that incidental coupling not existed, this
would have shipped and broken every existing install.

**Acceptance criterion:** any change to a `CREATE TABLE` body in `server/db.js`
ships with (a) a guarded `ALTER TABLE … ADD COLUMN` and (b) an `UPGRADE_CASES`
entry in `server/__tests__/db-migration.test.js` that seeds the **legacy** table
shape, migrates, and asserts: column exists, a legacy row reads `NULL`, the
column is writable, and a second migration run is a no-op.

**How to comply:**
- Never rely on a fresh-DB test to validate a schema change. The question is
  never "does a new DB get the column", it is "does an old DB get the column".
- Guard the ALTER with `PRAGMA table_info` rather than this file's older
  try/`SELECT … LIMIT 1`/catch probe idiom — the probe form adds an un-ordered
  `LIMIT` query that §9.2's static SQL-shape scan then has to grandfather, for
  a query that is not a "most recent N" query at all.
- Remember `DB_PATH` resolves to the **user-global** shared file, so a schema
  change from any worktree immediately reaches the real dashboard. Keep changes
  additive and nullable so a code-level back-out leaves a working database.
