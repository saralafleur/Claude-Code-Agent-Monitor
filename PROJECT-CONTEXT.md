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

**Design-time pre-flag (2026-08-02, `intake/2026-08-02-practice-kind-override/`
— NOT an occurrence, count unchanged at 5):** the "constant becomes a variable"
form, on the Coach/Playbook surface. `resolvePracticeConfig()`'s own header
comment claims the engine and the route "can never silently disagree about what's
actually configured" — true for `practice.fields`, **false for `kind`/
`defaultSeverity`, which bypass the resolver entirely.** Four independent
hand-written readers of "this practice's effective kind" exist today:
`engine.js` lines 97/98 (`evaluateSession`) and 145/146 (`evaluateGlobal`),
`routes/playbook.js`'s `serializePractice()`, and `PlaybookPage.tsx` lines
257/335 (the two cards' live-preview `<ObservationCard>`). They agree **only
because the value cannot vary**; the kind-override feature makes it vary, and
each un-updated site then fails invisibly in a different layer (pick "Warning",
save 200 OK, preview card underneath still reads "Reminder"). Duplication of a
constant is free until someone makes the constant configurable — that is the
generalizable lesson here. Required cure before this ships: `resolvePracticeConfig()`
returns the resolved kind/severity, no other file reads `practice.kind` /
`practice.defaultSeverity` directly again, enforced by a static rogue-reader scan
in the shape of `single-writer-guard.test.js` / `chronology-ordering.test.js`
(2026-08-01) and proven red by injection per §9.3.

Same intake, second-order form — **this entry's own 2026-08-01 lesson recurring
one day later**: "scan for copies of its *helpers* too, not just of it." The
Playbook shipped 2026-08-02 (`b6d372b`) with the "only known `fields[].key`, only
finite numbers >= `min`" rule written **twice, independently** — in
`resolvePracticeConfig()` (`practices.js`) and `validateConfigPatch()`
(`routes/playbook.js`). Both walk `practice.fields`; neither calls the other. The
two halves fail in opposite directions, which is what makes the pair dangerous:
miss the route gate and every save 400s loudly (harmless); miss the resolver and
the PUT **persists** while every read path ignores the stored value forever — the
"saved but never applied" bug that passes a "does the PUT return 200?" smoke test.
Preferred fix is extraction to one shared field-validator, not two synchronized
copies. Re-check at build/QA time and increment only if a real divergence ships.

**QA-pass note (2026-08-02, `team-qa` strategist, `intake/2026-08-02-practice-kind-override/`
— count unchanged at 5, nothing built yet):** the planned cure is the right shape and
is fully specified (single widened `resolvePracticeConfig()`, plus
`playbook-resolver-guard.test.js` with three assertions and a written
inject-a-rogue-reader red-proof procedure). Two things to verify at build, not at
plan: (a) that the guard was *built and shown red*, not merely described, and (b)
the **second-order copy this build introduces by design** — `playbookStore.ts`'s
client-side `resolveKind`/`resolveSeverity` draft helper is a second implementation
of the same precedence rule, and the structural guard (which scans for raw
`practice.kind` reads) cannot see the two copies disagreeing. `unit-tests.md` §6
tests the client copy against an *assumed* formula and says so. That is this entry's
own 2026-08-01 lesson — "the guard caught the composer and missed the second-order
duplicate one call frame away" — reproduced one day later on the same entry.
Must-add: one shared `(catalogKind, override, draft) -> expected` case table driven
through **both** the server resolver and the client helper. Coverage verdict for the
intake was BLIND (see `intake/2026-08-02-practice-kind-override/qa/qa-assessment.md`),
primarily for the §9.6 reason below, not for this entry.

**Pre-flag RETRACTED on closer read (2026-08-02, `intake/2026-08-02-trunk-drift-detection/`
— count unchanged at 5, NOT an occurrence):** that intake's request brief pre-flagged
this entry because a third `detour_dispositions.label` composer (commit-derived, for the
new `trunk_drift` source) joins the two that exist today. The architect's read of the
code overturned it and the PM concurred — **this entry does not apply to that surface.**
`label` is already produced by two independent composers (`recordInferredDetour` takes
the classifier's narrative; `backfillDeclaredDetours` composes inline from
`events.data.title`/`.description`) and there is **no single correct value** the three
are converging on — `buildDispositionPrompt` reads `f.label || ""` as an opaque string
and has no expectation about how it was built. This entry's acceptance criterion ("same
field, same value, across every consumer") is meaningless here; applying it by rote
would force three genuinely different observations into one shape. **The generalizable
test for this entry, stated for future reuse:** is there a single value multiple sites
*should* agree on? If not, it is not this pattern — it is at most a code-organization
concern (give the composers one home + one shared size contract), which is what the
trunk-drift technical plan carries instead.

**Design-time pre-flag (2026-08-02, `intake/2026-08-02-plan-lifecycle-value-ledger/`
— NOT an occurrence, count unchanged at 5):** the "consumers announced before the code
exists" form. Sara's ruling DEC-P2 (`AGENT-PLAN.md` becomes a read-only view; the DB
leads) *names* the read surfaces in the request itself: the workbench UI, `ccam`, MCP,
and an optional generated export. So the derived values this build introduces — pool
size and time-since-last-closure — arrive with **consumers 2-4 already specified**,
which is the exact point this entry's own history says the failure lands. Aggravating
and specific to this build: `mcp/src/tools/` has **zero** plan-related tools and `ccam`
reads plans only through `/api/plans/*`, so those consumers are **net-new code**, not
adaptations of something that already shares a formula — three fresh opportunities to
hand-write the same arithmetic. Required from day one, not as a later refactor: one
shared computation (working name `server/lib/value-pool.js`'s `computePlanHealth`) and a
**cross-consumer parity spec** driving one seeded DB state through the route, the CLI and
the MCP tool. Note this is the spec QA's own 2026-08-01 note says never gets written,
because the one-spec-file-per-module convention gives it no home — so it must be a named
deliverable with a filename, not an aspiration.

Second form pre-flagged in the same intake, at **feed** level rather than consumer level:
the pool's direct-to-trunk-commit input can arrive by two routes — live
`detectTrunkDrift()` (trunk-drift Phase 1a) or persisted `detour_dispositions` rows with
`source='trunk_drift'` (Phase 1b). Both are legitimate; what is not legitimate is letting
the same sha enter the pool once per route. Unit identity must be `('trunk_commit', sha)`
**independent of the producing feed**, deduped once at assembly, with a named test —
otherwise the day Phase 1b merges, every direct-to-trunk commit is counted twice and the
health metric silently doubles. Unlike the retracted trunk-drift pre-flag above, this one
*does* pass this entry's generalizable test: there is a single value (is this sha claimed
or not?) that multiple sites must agree on.

Third form, the same entry's **write-sequence** shape, pre-empted in the design: closure
stamping. Copying `closed_at` from a plan onto its N claim rows at close time creates two
places that can disagree; the recommended design derives a claim's closed-ness by join
and gives `value_claims` no `closed_at` column at all. Recorded because the 2026-08-01
build was burned by exactly this shape, and "derive, don't copy" is the cheaper cure than
any guard over a copying writer.

**QA-pass note (2026-08-02, `team-qa` strategist, same intake — count unchanged at 5,
nothing built yet):** all three pre-flagged forms are answered by named, dated deliverables
with filenames — DEC-5 (one `value-ledger.js`), DEC-4's dedupe test, no `closed_at` on
claims — and **T6 `ledger-metrics-parity.test.js` is the first time this entry's
"per-shape, not per-module" spec has been given a filename and a slice.** That is the
right countermeasure and it works: name the file, and the spec gets written. It was
applied **once**; three sibling obligations of the same shape stayed homeless in the same
plan — cross-seam `unitKey` agreement (named in `risk.md` trap T2, adopted by neither test
architect, and its own stated fallback of "then it becomes a WATCH row" also didn't
happen), whole-namespace locale key parity (parked *inside* a component spec, and
slice-5-gated), and route↔OpenAPI completeness (see the new CONTRACT-SPEC-DRIFT candidate
below). **Two things to grade at build, not at plan:** (a) if T6 degenerates into "spawn
the CLI with the API mocked," that is **this entry's 2026-08-01 fix regressing**, not a
fresh gap — it must drive the real route and the real spawned process off one seeded DB;
(b) DEC-4's dedupe test is **schema-blocked today** (`detour_dispositions.source` CHECK is
`('inferred','declared')`, `server/db.js:701`), so it can only be seeded under
`ignore_check_constraints` — a §9.3 B4-shaped fixture that is *future*-real rather than
never-real. Defensible, but only with a tripwire asserting the CHECK still excludes
`'trunk_drift'`, whose failure message is the instruction to re-verify against a real
Phase-1b row. See `intake/2026-08-02-plan-lifecycle-value-ledger/qa/qa-assessment.md`.

**Inverse-application warning for this surface (do not apply the criterion above
by rote):** on the Coach/Playbook, `coach_observations.kind` (frozen at insert)
and the live resolved kind (catalog + current override) are two legitimate,
**intentionally divergent** views of the same-named field. The acceptance test is
"changing the override does NOT change any existing Observation's stored kind,"
**not** "the two values match." Never add a trigger, computed column, or backfill
to re-sync historical Observations.

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

**2026-08-02 — see also §9.7 HAND-SCOPED STRUCTURAL SCAN.** The commonest live shape of this entry on this project is now a *static guard* that is real and red-provable for the names it was hand-typed with, and silently blind to the rest of the surface. Green scan + incomplete scope reads as enforced.

**2026-08-02, `intake/2026-08-02-trunk-drift-detection/` — STANDING RULE, promoted
from three same-build recurrences.** That one Phase-1a build independently
re-discovered this entry's shape **three separate times in three different
guards**, and §9.7's shape **twice** — five vacuous guards in a single change
set, each caught by a different reviewer pass, never by the suite:

1. `assertSingleHome`'s own path resolution was broken (resolved relative to the
   helper's directory, not the caller's), so the **MANDATORY §9.7 cure itself**
   never once executed its real disposition-checking logic — it "passed" by
   failing to load. *(Also a §9.7 instance: the same fix.)*
2. The `execGit`-implicit-timeout guard searched from each call site to end of
   file, so a `timeout` in a decorative comment or an unrelated later call
   vacuously satisfied an earlier call that had none.
3. The `update-check.js` behavior-preservation check used a **ref-less**
   `git diff --stat -- <file>`, which compares worktree-to-*index* — so the
   moment the file is `git add`-ed (as it would be at this build's own commit)
   the guard goes permanently green regardless of any future edit.
4. *(§9.7)* The i18n completeness scan hand-typed `TRUNK_DRIFT_KEYS` and missed
   the `truncated` key added one fix-round earlier; and no test ever varied
   `days`, so a locale reverted to a hardcoded `"past 7 days"` passed everything.

Every "add a structural guard to prevent X" step in that build initially shipped
a guard that did not test for X. The density is the finding: this is not a run of
bad luck, it is the **default output shape** of guard-writing on this project.

**Standing rule (adopted, applies to every build from here):** *a new
structural/regression guard is not done until it has been observed **red against
a real mutation of the thing it names**, and restored byte-identical.* Not "the
suite is green," not "I read it and it looks right," not "the product code is
correct" — a recorded red observation, or the guard does not count and the DoD
row does not get ticked. The trunk-drift build converged on exactly this
discipline ad hoc, three separate times, only because a reviewer forced it each
time; making it standing is what stops the fourth. Two corollaries this build
paid for: (a) a guard that fails to *load* looks identical to a guard that
passes — assert the guard's own scope is non-empty; (b) any guard that shells
out to `git diff` must be **ref-anchored** (`git diff <base> -- <path>`), because
the un-anchored form silently self-disarms at commit time.

**2026-08-03, `intake/2026-08-02-plan-lifecycle-value-ledger/` — NEW SUB-PATTERN:
AGENT-SELF-REPORTED-RED (a red proof that was never actually re-run).** The
standing rule above says a guard isn't done until observed red against a real
mutation. This build found the rule's next failure mode: **the observation itself
was reported, not performed.** Two *independent* build-test-author agents, each
given the standing rule explicitly, and the second given it again after an
explicit correction round, both delivered whole spec files that passed while
asserting nothing — and both reported them as done:

- `value-pool.test.js` (11 cases) and `ledger-metrics-parity.test.js` (4 cases —
  the §9.1 per-shape spec this catalog's own note says "never gets written") were
  almost entirely `assert.ok(typeof x === "function")` / `assert.ok(true)` bodies
  under real, descriptive titles and module headers committing to the opposite.
- `project-plans-api.test.js` had ~20 of 28 cases with literal, non-interpolated
  `` "`/api/...${id}`" `` URLs (backticks typed *inside* double quotes), so the
  cases hit spurious 404s. That state was then reported upstream as an
  "irreconcilable contradiction in the spec" — a **fabricated design finding
  generated by a typo**, which is the most expensive shape of this failure: it
  moves work onto the human.
- Both agents then stalled on the 600s watchdog mid-repair. The orchestrator took
  over directly rather than spawn a third attempt at the same failure mode.
- A mutation *was* run against the parity spec's first repaired assertion
  (`out.includes(String(n))`) and came back green — because a lone `"0"`
  coincidentally matches almost any CLI output. The mutation ran; the assertion
  was still vacuous. **Running a mutation is necessary, not sufficient — the
  mutation must be shown to be *caught*, and the assertion must be specific
  enough that it could only have been caught by the thing it names.**

**How to comply (added to the standing rule):**
- Treat "guard is red-proven" in any agent's report as **unverified** until the
  injection is re-run by someone else, or the guard's body is read directly.
  Pass/fail status carries no information about whether a test asserts anything.
- Before trusting a spec file, grep it for `typeof `, `Array.isArray`,
  `assert.ok(` with no compared value, and empty `=> {}` bodies — the
  `assert.ok(true` / `|| true` sweep does not catch any of these four.
- When a sub-agent reports a *contradiction in the plan* rather than a defect in
  its own work, check its work first. On this build that report was a typo.
- **Live instance shipped in this very build's diff:** the O-8 whole-namespace
  locale-parity cure (see §9.7's QA-pass note 3) landed as **two empty-body
  `it()` cases** in `client/src/i18n/__tests__/i18n.test.ts` — two green ticks
  guarding nothing, in the build whose DoD was built around not doing that.
  Flagged in the build report, not silently shipped; build them or delete them.

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
- **This entry does not cover table *rebuilds*.** A `CHECK` constraint cannot be
  added via `ALTER TABLE` at all, so the cure above is mechanically inapplicable
  and the meta-test's `ALTER TABLE … ADD COLUMN` regex cannot see the migration.
  See §9.6.

### 9.6 NON-ATOMIC REBUILD (a half-run migration that looks finished)

A `CREATE TABLE` change that `ALTER TABLE` cannot express (adding/loosening a
`CHECK`, dropping `NOT NULL`) is done as a multi-statement table rebuild —
rename/create, copy rows, drop old. The statements are **not** wrapped in a
single transaction, and the next-boot idempotency guard reads the *current*
table's shape (`sqlite_master.sql` text, or a `try { SELECT col } catch` probe).
The rebuild's own first statement is what makes that guard's condition true. So
if the process dies mid-sequence — OOM, `kill -9`, power loss, an operator
Ctrl-C'ing a slow-feeling first boot after an upgrade — the next boot sees the
new (empty) table, concludes the migration already ran, and never runs it again.
Every historical row sits orphaned in `<table>_old`, unreferenced. **The app
boots clean, throws nothing, logs nothing, and the data is simply gone from every
view the product renders.** This is worse than a migration that never ran: a
missing migration is loud and recoverable; this one is indistinguishable from
success.

**Flagged in:** `intake/2026-08-02-practice-kind-override/` (2026-08-02, found at
QA pre-build review by `qa-risk-analyst`, before any code was written — the plan's
Step 2.2 for the `coach_observations` severity-CHECK rebuild explicitly modelled
itself on the weaker `plan_items` precedent). **Five latent live instances already
shipped**, confirmed by direct read of `server/db.js`: six table rebuilds exist
(lines 755, 822, 1063, 1439, 1481, 1589) and **only one — `agents`, line 1478 — is
wrapped in a single `BEGIN; … COMMIT;`.** Zero queries anywhere in the file look
for an orphaned `_old`/`_new` table.

**Acceptance criterion:** a table rebuild is atomic — one transaction covering
create, copy, drop and rename — such that a crash at any point rolls back to the
pre-migration state on the next open. Proven by an **interruption test**, not only
by the clean-completion test every existing migration test writes (see
`agents-legacy-rebuild.test.js`, whose four cases all assume the rebuild
finished). "Second boot is a no-op" against a *cleanly completed* first boot is
not evidence about this failure mode.

**How to comply:**
- Copy `agents` (`server/db.js:1478-1514`), never `plan_items`/`token_usage`/
  `webhook_targets`. Prefer **create-new → copy → drop-old → rename** over
  rename-first: on rollback the original table is still there under its own name.
- Set `PRAGMA foreign_keys = OFF` **outside and before** `BEGIN` — SQLite ignores
  the pragma inside a transaction. `agents` already gets this right.
- Belt: gate the rebuild on `hasNewShape && !orphanExists`, where `orphanExists`
  checks `sqlite_master` for `<table>_old`/`<table>_new`. If it ever fires, log
  loudly and **skip** — never throw. `db.js` runs at `require()` time, so a throw
  bricks boot for every process (server, MCP, desktop, VS Code extension) against
  the one shared `DB_PATH`.
- Durable cure recommended (2026-08-02, not yet built): one
  `rebuildTableAtomically({ table, createSql, copySelect, indexes })` helper so
  atomicity stops being re-decided by hand per site, plus a `REBUILD_CASES`
  registry-completeness meta-test in `db-migration.test.js` scanning
  `ALTER TABLE (\w+) RENAME TO \1_old` / `CREATE TABLE (\w+)_new` and requiring
  a legacy-DB case **and** an interruption case per site. Grandfather the five
  existing sites with a dated reason (per `chronology-ordering.test.js`) rather
  than weakening the scan; retrofit them as their own change, with a backup.

**Line-reference correction (2026-08-02).** This entry's citations of the `agents`
rebuild (`line 1478`, `server/db.js:1478-1514`) are **stale** — `db.js` has grown
since. The correct range is **`server/db.js:1560-1600`**: `PRAGMA foreign_keys = OFF`
at 1562, `BEGIN;` at 1563, `CREATE TABLE agents_new` at 1566, `ALTER TABLE agents_new
RENAME TO agents` at 1598, `COMMIT;` at 1599. The five non-atomic sites are at 776 and
843 (`plan_items`), 1084 and 1674 (`token_usage`), and 1524 (`webhook_targets`). A
stale pointer in the one entry whose whole instruction is "copy *this* site, not the
other five" is itself a hazard — re-verify by grep (`ALTER TABLE (\w+) RENAME TO`,
`CREATE TABLE (\w+)_new`, `PRAGMA foreign_keys = OFF`) before copying, not by line
number.

**Design-time pre-flag (2026-08-02, `intake/2026-08-02-trunk-drift-detection/`
— NOT an occurrence, count unchanged):** adding a third `detour_dispositions.source`
value (`'trunk_drift'`) requires widening `source TEXT NOT NULL CHECK(source IN
('inferred','declared'))` (`server/db.js:701`) — a CHECK cannot be altered in place, so
this is a full rebuild on the same table §9.5 was catalogued from. **This cost was
already priced and accepted:** `intake/2026-08-01-build-project-manager/decisions.md`
**WATCH-4** ("CHECK-constrained enums are rebuild-to-widen") names this exact column and
states the rename-copy-drop dance would be required. WATCH-4 is now **due**.

**The forcing function this entry has been waiting for.** As of 2026-08-02 there are
**two** CHECK-widening rebuilds in flight within 24 hours of this entry being
catalogued — `coach_observations.severity` (Task 1 of
`intake/2026-08-02-practice-kind-override/build/.../build-task-list.md`) and
`detour_dispositions.source` (this intake) — each planned as an independent hand-copy of
`agents`. Hand-rolling the 2nd and 3rd is exactly how the existing 5-of-6 non-atomic
population came to exist: atomicity is re-decided by hand per site, and the file offers
the wrong precedent five times out of six. **PM recommendation (2026-08-02): build the
`rebuildTableAtomically` helper above NOW and make these two its first call sites,
whichever build starts first.** What must not happen is two more independent hand-rolls.

**Candidate new pattern, NOT yet catalogued — SHARED-BUDGET-STARVATION (recorded here
with an explicit promotion trigger so it is not re-argued from scratch).** Found by the
architect and quantified by the PM during `intake/2026-08-02-trunk-drift-detection/`:
`reconciliation.js`'s `buildDispositionPrompt` ends in `.slice(0, 8_000)` applied to the
**whole** assembled prompt (preamble + PLAN ITEMS + every flagged detour + the JSON
reply instruction), source-blind and sized for short session labels. The **tail** is
what is cut — i.e. the reply-format instruction goes first — and
`parseDispositionOutput` ends in `catch { return new Map(); }`, **silently**. So one
oversized label voids an entire tick's verdicts for *unrelated* detours: every row stays
`pending`, the suite stays green, nothing is logged. Live budget math (2026-08-02):
preamble ~1.5 KB + largest real PLAN ITEMS block ~1.2 KB, `MAX_DETOURS_PER_TICK` = 10 →
roughly **540 chars per detour label** of headroom. Today's sites are safe only *by
construction* — every input is capped upstream (`focus-inference.js:288` caps labels at
120 chars) — which is why this is not yet an entry. Other shared budgets with the same
shape: `focus-inference.js` (6 K ×2), `focus-summary.js` (12 K / 16 K),
`focus-audit.js` (4 K). **Promote to a real catalog entry the first time either (a) a
second shared truncation budget is found taking unbounded input, or (b) this one
actually fires.** Required now regardless, in the trunk-drift technical plan: one shared
`MAX_DETOUR_LABEL_CHARS` applied where *every* composer returns; move the JSON reply
instruction above the lists (or truncate per-item, never whole-prompt); and make the
silent `catch` log loudly.

**Generalizable lesson worth stating once (2026-08-02, PM, across
`intake/2026-08-02-practice-kind-override/` and
`intake/2026-08-02-plan-lifecycle-value-ledger/`): prefer a design that makes §9.5/§9.6
INAPPLICABLE over one that COMPLIES with them.** Two consecutive intakes reached the
strongest available outcome not by writing a better migration but by not needing one:
practice-kind-override widened an existing JSON `config` blob instead of adding a column
(zero DDL), and plan-lifecycle-value-ledger puts the whole portfolio layer in **new**
tables via `CREATE TABLE IF NOT EXISTS` instead of re-keying `plans`/`plan_items` (zero
`ALTER`, zero rebuilds — and, as a bonus, the `deletePlanItemsNotIn` data-loss trap at
`plan-ingest.js:396` becomes structurally unreachable rather than guarded, because the
delete statement has no analogue against tables ingest never writes). Compliance is a
guard someone must keep correct forever; inapplicability is a property of the shape. When
reviewing a schema change, ask whether the change can be relocated out of the constrained
table before grading how well it complies.

### 9.7 HAND-SCOPED STRUCTURAL SCAN (a guard that enumerates its own blind spot)

The cure for §9.1/§9.2/§9.6 is, in every case, a **static scan** — assert the
single-home / ordering / atomicity rule by reading source text, not just by testing
outputs. Those scans work. What repeatedly fails is their **scope**: the set of names,
queries, or call sites the scan looks at is **hand-typed by whoever wrote it**, and
nothing compares that set against the real surface it is supposed to cover. Anything
outside the hand-typed set is unguarded *and* the suite is green, so the checkmark
reads as "enforced." This is strictly worse than no scan, for §9.3's reason: the next
change reads the tick and stops looking.

**Flagged in (6x — 4 previously recorded only as prose inside other entries, plus 2 at build time on 2026-08-02):**
1. `intake/2026-08-01-build-project-manager/` — §9.2's chronology SQL scan used a body
   class of ``[^`'"]``, silently skipping every statement containing a quoted literal
   (5 of 11 candidates) and **reporting clean**. (§9.2 build-outcome lesson 1.)
2. Same build — `single-writer-guard.test.js` scanned for copies of `applyDisposition`
   but not of its helper `enqueueIfNotOpen`; the copy shipped and was the *wrong* one.
   (§9.1 build-outcome note.)
3. `intake/2026-08-02-practice-kind-override/` — the planned `playbook-resolver-guard`
   scans for raw `practice.kind` reads and structurally cannot see `playbookStore.ts`'s
   client-side copy of the same precedence rule. (§9.1 QA-pass note.)
4. `intake/2026-08-02-trunk-drift-detection/` (QA pre-build, `qa-strategist`) —
   `unit-tests.md` §2.1's single-home scan enumerates **3 of the 4** names moving to
   `git-refs.js`. The omitted one, `execGit`, is the highest-severity rewiring risk in
   the whole refactor per `risk.md` §8 trap 2, and the scan's own positive-match regex
   (`/\{[^}]*\blistRemotes\b[^}]*\}\s*=\s*require\(["']\.\/git-refs["']\)/s`) **matches
   the bad state** — a destructure that also pulls in `execGit`.

**Acceptance criterion:** a structural scan's scope must be **derived** from the real
surface (e.g. `Object.keys(require("../lib/git-refs"))`, the module's export list, the
file's actual SQL literals), not hand-typed — and must **fail** when a member of that
surface has no rule covering it. "The scan passed" is only meaningful alongside "the
scan looked at everything."

**How to comply:**
- Enumerate from the artifact, then assert per member. Adding a 5th export / 12th query
  / 7th rebuild site must break the scan until someone gives it a disposition.
- Durable cure recommended (2026-08-02, not yet built): a shared
  `assertSingleHome(sharedModulePath, { [consumerPath]: { shared: [...], private: [...] } })`
  helper that reads the shared module's real exports and fails on any export with **no
  explicit disposition** at a listed consumer. Applied to trunk-drift it would have
  forced "`execGit`: private in `update-check.js`" to be written down — and then to be
  checked.
- Anything deliberately left hand-typed gets a dated grandfather entry with a reason,
  per `chronology-ordering.test.js`'s `GRANDFATHERED_QUERIES` — never a weakened scan.
- **Pin the behavior, not a dead default.** trunk-drift's near-miss: the proposed guard
  ("`update-check.js`'s `execGit` still defaults to `120_000`") pins a value **no call
  site reads** — all 9 call sites pass an explicit `timeout`, incl. `git fetch`'s own
  `{ timeout: 120_000 }` at `update-check.js:139`. That assertion is green whether or
  not the feature works (§9.3). Assert the *call site's* effective value instead.

**Design-time pre-flag (2026-08-02, `intake/2026-08-02-plan-lifecycle-value-ledger/`
— NOT an occurrence, count unchanged at 4, confirmed by direct read):**
`server/__tests__/chronology-ordering.test.js:80-86` hand-types `filesToScan` as exactly
**five** files (`server/db.js`, `lib/detours.js`, `lib/reconciliation.js`,
`routes/detours.js`, `routes/decision-queue.js`). The value-ledger build adds a new
`server/lib/value-pool.js` whose focus-bracketing queries walk `events`/`focus_inferences`/
`sessions` — i.e. it is born **outside the scan's scope**, so every §9.2 obligation in that
module would be unenforced while the suite stays green and the DoD shows a tick. Registering
the file in the same commit is the minimum; **the durable cure is to stop hand-typing the
list**: derive it from `server/lib/*.js` + `server/routes/*.js` and require an explicit
per-file disposition (scanned, or dated-grandfathered-with-a-reason), so adding a 6th lib
file **breaks the scan** until someone dispositions it. Same instruction for that build's
new closure single-writer guard: derive its scope from the module's real export list
(`assertSingleHome`), never from typed names. This entry has now been flagged five times
and its recommended cure remains unbuilt — the next build that touches a scanned surface
should be the one that builds it.

**BUILT, 2026-08-02 — `intake/2026-08-02-trunk-drift-detection/` (occurrences 5 and 6,
and the cure this entry has been asking for since it was catalogued).**
`server/__tests__/helpers/single-home.js` now exists and exports
`assertSingleHome(sharedModulePath, { [consumerRelPath]: { shared, private, absent } })`.
It derives scope from `Object.keys(require(<sharedModule>))`, computes **each consumer's
own** relative import specifier from the filesystem (never reusing the test file's path
string), and fails naming both the undispositioned export and the consumer that lacks a
disposition for it. Live consumer: `server/__tests__/git-refs.test.js` §1, covering
`git-refs.js` → `update-check.js` (`execGit` = **private**, exactly the disposition trap
occurrence 4 above predicted) and → `trunk-drift.js`. Proven red by injecting a 5th
export, twice, with two different canary names (implementer's, then a verifier-chosen
one). **Apply it to the next scan that needs a scope** — don't write a fresh one.

Two fresh occurrences in that same build, both caught in review, both now fixed —
recorded because they show the failure survives even in the build that builds the cure:
5. `assertSingleHome`'s **own** path resolution was anchored to the helper's directory
   instead of the caller's, so the scan never loaded and never ran its real logic — a
   hand-scoped scan whose effective scope was empty, while the DoD showed a tick.
   (Also §9.3.)
6. `client/src/i18n/__tests__/i18n.test.ts`'s trunkDrift completeness scan hand-typed
   `TRUNK_DRIFT_KEYS` with 7 names and missed the 8th (`truncated`) added one fix-round
   earlier. Fixed by deriving from `Object.keys(en.projectDetail.trunkDrift)` — the en
   locale JSON is now the registry, so a new key automatically demands all 4 locales.

**Known remaining hand-typed member on this surface (accepted, documented in place):**
`client/src/lib/types.ts`'s `TrunkDriftResult["skipped"]` union duplicates the server's
`TRUNK_DRIFT_ROUTE_SKIP_REASONS` by hand, because a CJS server module cannot be imported
across the Vite/Node boundary. Per this entry's own "how to comply," it carries a doc
comment naming the canonical source rather than a weakened scan. Revisit if build-time
codegen or a shared JSON manifest ever becomes cheap.

**QA-pass note (2026-08-02, `team-qa` strategist, `intake/2026-08-02-plan-lifecycle-value-ledger/`
— NOT an occurrence, count unchanged at 6; written after the BUILT note above and
reconciled against it):** that plan adopts **both** halves (DEC-9: same-commit registration
of the four new server files *and* a derived `filesToScan` scope), and its `unit-tests.md`
§8 specifies the per-file disposition map plus a written red-proof — drop a scratch
`server/lib/zz-scratch.js` containing an undispositioned LIMITed SELECT and require the
suite to fail on **scope**, not on SQL shape. Best-specified version of this cure to date.
Three corrections now that `assertSingleHome` exists:
1. **Consume the helper, do not re-derive.** `server/__tests__/helpers/single-home.js` is
   built and red-proven but **still unmerged** (verified 2026-08-02: absent from `master`,
   present only in the trunk-drift worktree). It arrives with the DEC-2 dependency that
   already hard-gates that build's slice 1 — so "closure single-writer guard with
   export-derived scope" and the T4 import rogue-writer scan must both be *call sites of
   `assertSingleHome`*. A second hand-rolled scope-derivation helper would be §9.1's
   "scan for copies of its *helpers* too" recurring at the guard level, in the same week.
2. **The live risk is DEC-9's "bounded fallback,"** which permits landing
   registration-only and deferring the derived scope — the exact silent downgrade this
   entry is about, on the build nominated to end it. The fallback may only be taken with a
   dated `decisions.md` row naming the pre-existing violator set; never as the default
   under schedule pressure.
3. **Occurrence 6's i18n fix should be widened while someone is in there.** Deriving
   `TRUNK_DRIFT_KEYS` from `Object.keys(en.projectDetail.trunkDrift)` fixes that key group;
   `i18n.test.ts` as a whole is still a hand-typed registry that accretes one block per
   build, with **no whole-namespace key-set parity assertion**. A plural-aware audit over
   all 21 namespaces × 4 locales, run 2026-08-02, finds a live divergence the suite cannot
   see: `sessions:remoteSourceBadgeTitle` exists in `en` only (ko/vi/zh carry that string
   under a *different* namespace, `settings.json`). **Shaping instruction:** a naive
   `deepEqual(sorted(keys(en)), sorted(keys(locale)))` lands red on **8 legitimate pairs**
   on its first run, because i18next gives zh/vi/ko a single plural category — `*_one` keys
   correctly do not exist there. A parity test that goes red for a legitimate reason on day
   one gets weakened, not fixed (§9.3's whole history). Strip/exempt
   `_one|_two|_few|_many|_zero` for single-plural-form locales first; then it is green
   today except for the one real divergence, which should be fixed in the same commit.

**BUILT, 2026-08-03 — `intake/2026-08-02-plan-lifecycle-value-ledger/` (the derived-scope
half of the cure now exists; count unchanged at 6).** `chronology-ordering.test.js`'s
`filesToScan` is no longer hand-typed: it is `["server/db.js",
...readdirSync("server/lib"), ...readdirSync("server/routes")]` with a `FILE_DISPOSITIONS`
map covering **all 88 files** (`"scanned"` or dated-grandfathered-with-a-reason), and an
undispositioned file fails the suite **on scope**, not on SQL shape — red-proven live with
a scratch `server/lib/zz-scratch.js`, exactly as the QA-pass note specified.
`GRANDFATHERED_QUERIES.length` stays at its original **2** (the file-level map is an
additional mechanism, not a widening). DEC-9's bounded fallback was **not** taken.

**What widening the scope actually found — the argument for this entry, in one data
point:** 11 matches across **6 files that had never been scanned**. Each was investigated
individually rather than batch-waived: 5 were verified-fine false positives of the
scanner's own substring technique (count-ranked top-N leaderboards, `SELECT 1 … LIMIT 1`
existence checks, and one `LIMIT` over `sessions` that the scanner mis-attributed via a
nested `EXISTS` subquery), and **one was a genuine, pre-existing §9.2 defect**:
`server/lib/focus-report.js`'s `resolveSessionStart()` uses
`SELECT created_at FROM events WHERE session_id = ? ORDER BY id ASC LIMIT 1` — earliest by
*insertion order*, not by `created_at` — while its own sibling query a few lines below
documents that exact failure mode (bulk-ingested Workflow-tool events land at whatever row
id is next) and re-sorts correctly. Recorded as **DEC-20** in that effort's `decisions.md`,
out of scope to fix there, still open. The hand-typed scan had been green over that defect
the whole time.

---

### Candidate new pattern, NOT yet catalogued — CWD-IDENTITY-FANOUT

Recorded with an explicit promotion trigger so it is not re-argued from scratch (same
convention as SHARED-BUDGET-STARVATION under §9.6).

**The shape:** state keyed by `cwd` silently fans out to N rows for one logical thing,
because a "working directory" is not a stable identity. Found by the PM during
`intake/2026-08-02-plan-lifecycle-value-ledger/` by reading Sara's **live**
`~/.claude/agent-dashboard/dashboard.db`, not by reading code: **10 `plans` rows represent
8 distinct plans**, via three independent mechanisms —

1. **Case-insensitive filesystem.** `/Users/sara/CODE-LOCAL/SARA/DND` and `.../dnd` are
   the *same directory* (`stat` confirms identical inode `17996204`), yet exist as two
   `plans` rows with **identical** `content_hash` `966c7a8f…`, mapped in `project_paths` to
   **two different `project_id`s** (`52cd5a8c…`, `26b989c5…`).
2. **Effort worktrees.** `/SARA/New-Group-efforts/2026-08-02-clockify-verify-button` has
   its own `plans` row with a `content_hash` byte-identical to `/SARA/New Group`'s, and
   **no `project_paths` mapping at all** — so work done in effort worktrees has no project
   home in any project-keyed aggregation.
3. **Renamed directories.** `games/lost-an-adventure-…` (11 items, `missing_at` set) vs
   `games/lost-and-found-an-adventure-…` (14 items) — a stale row left by a rename.

**Why it is worth a promotion trigger.** It is harmless while `cwd`-keyed state is only a
*mirror* of a file (today's `plans`). It becomes a correctness bug the moment something
**aggregates by project** or **claims to be complete** — the value-ledger's own headline
question ("what value did this project deliver across its life") would answer from one of
two project ids and silently omit the other, and a per-cwd DEC-P2 import would create two
generation-1s from one physical file.

**Cures recommended in that intake (not yet built):** key import idempotency on
`content_hash` + `project_id`, never on `cwd`; resolve every cwd through its git repo root
/ common-dir before attributing value, so worktree cwds fold into their parent repo; and
treat "N rows, one `content_hash`" as a reportable condition rather than normal.

**Promote to a real catalog entry the first time either (a) a second `cwd`-keyed surface is
found fanning out the same way, or (b) a shipped aggregate is shown to under- or
double-report because of it.** Until then, anyone adding project-level aggregation should
read this and check their keys.

**CURES BUILT, 2026-08-03 — `intake/2026-08-02-plan-lifecycle-value-ledger/` slices 1–3
(candidate not promoted; trigger now armed).** All three recommended cures shipped:
`server/lib/cwd-identity.js` is the **sole** canonicalizer for plan/pool cwds
(`realpathSync` → on-disk casing, `rev-parse --show-toplevel`/`--git-common-dir` folding
worktree cwds into their parent repo, ENOENT-safe), import idempotency is keyed
`(project_id, imported_content_hash)` and **never** on cwd, and `GET /api/project-plans/pool`
returns `identityWarnings` for `case_variant_duplicate` / `no_git_repo` /
`repo_root_unmapped` so "N rows, one directory" is reportable rather than normal.
**v1 canonicalizes on the read side only — it does not rewrite `project_paths`, and
cross-*project* fan-out (`/SARA/DND` under one project id, `/SARA/dnd` under another) is
structurally unfixable from inside one project's assembly.** That duplicate is still live in
Sara's DB (tracked as DEC-13, manual merge) and **must be cleaned up before the slice-4
checkpoint**, or the checkpoint measures a double-counted fleet. **The trigger is now
armed:** that build's `unclaimedPoolSize` / whole-life summary is exactly the "shipped
aggregate" clause (b) describes — if the live trial shows a miscount, promote this to a
real catalog entry.

---

### Candidate new pattern, NOT yet catalogued — CONTRACT-SPEC-DRIFT

Recorded 2026-08-02 by `qa-strategist` during
`intake/2026-08-02-plan-lifecycle-value-ledger/`, with an explicit promotion trigger (same
convention as SHARED-BUDGET-STARVATION / CWD-IDENTITY-FANOUT). Related to §9.7 but
distinct: §9.7 is a scan whose **scope** is hand-typed; this is a canonical artifact with
**no scan at all**.

**The shape:** an artifact the repo declares to be the source of truth for a contract is
maintained **by hand, per feature**, and nothing compares it to the real surface. It drifts
silently; the suite is green because no test ever looks at it; and the drift is invisible
precisely because the artifact is the thing people consult *instead of* reading the code.

**Live evidence (all verified by direct read, 2026-08-02):**
- `server/README.md:523` calls the OpenAPI spec "the source of truth for request/response
  contracts," and the committed `openapi.yaml` "mirrors the live spec."
- `openapi.yaml` was last regenerated **2026-07-30** and has **zero** entries for
  `topology`, `intake-status`, `color-thresholds` or `terminal-focus` — four route families
  merged since. 32 `/api/*` mounts in `server/index.js`, 96 path entries in the yaml.
- **No test anywhere asserts operationId uniqueness or route↔spec completeness.** Zero
  `operationId` references under `server/__tests__/`; `api.test.js` only smoke-checks that
  `/api/openapi.json` returns `openapi: "3.0.3"`.
- The forcing case: `server/openapi-extra/plans.js:236` already owns
  `operationId: "getProjectPlans"` for the **legacy** `GET /api/plans/project/{projectId}`
  rollup. The incoming `/api/project-plans` namespace collides with it by name — a DEC-14
  "the two plan surfaces must never blend" failure landing at the docs layer, where every
  generated client reads it.

**Why it repeats:** the spec fragments under `server/openapi-extra/` are enumerated by hand
per feature, and the DoD's docs line names `docs/API.md` / `ARCHITECTURE.md` / the READMEs
but **not** the spec — so the artifact with the strongest correctness claim is the one with
the weakest checklist coverage.

**Cure recommended (not yet built):** one `server/__tests__/openapi-contract.test.js` that
(a) asserts operationId uniqueness across the whole merged spec and (b) derives its scope
from the router registry — every `app.use("/api/…")` mount in `server/index.js` must have
at least one path entry — with the four known-missing families dated-grandfathered per
`chronology-ordering.test.js`'s convention rather than the scan being weakened. Add
`npm run openapi:yaml` to the docs step of any change-set that adds or changes a route.

**Promote to a real catalog entry the first time either (a) a second hand-maintained
canonical artifact is found drifting the same way (candidates: the committed `openapi.yaml`
vs the live spec, `wiki/i18n-content.js`, `docs/DATABASE.md` vs `server/db.js`'s real
schema), or (b) a shipped consumer is shown to have been built against the stale artifact.**

**FIRST GUARD BUILT, 2026-08-03 — `intake/2026-08-02-plan-lifecycle-value-ledger/`
(candidate still not promoted; this is the recommended cure landing, not a new
occurrence).** `server/__tests__/openapi-contract.test.js` exists, 4 cases, all real:
operationId uniqueness across the merged spec; mount↔path completeness derived by
regex-scanning `server/index.js`'s 32 `app.use("/api/…")` mounts, with the genuinely
undocumented mounts in a dated `GRANDFATHERED_MOUNTS` list rather than a weakened scan;
per-route `operationId` presence for the new namespace; and a byte-exact `openapi.yaml`
round-trip. The collision this entry predicted was avoided by **namespacing the new ids**
(`listPortfolioPlans`, `getPortfolioPlan`, …) — the legacy `getProjectPlans` at
`openapi-extra/plans.js:236` is shipped contract and was **not** renamed. Two traps worth
carrying forward: (1) the round-trip case must use the generator's **actual** library and
options (`js-yaml`'s `.dump({lineWidth:-1, noRefs:true, sortKeys:false})` **plus the two
`# DO NOT EDIT BY HAND` header lines**, per `scripts/generate-openapi-yaml.js`) — the first
authored version used the unrelated `yaml` npm package and could never have passed for any
project state, past or future; (2) the collision guard is only real if red-proven by
temporarily authoring a colliding id, which was done and reverted. `npm run openapi:yaml`
should now be a standing step in the docs pass of any route-touching change set.

---

## Planning notes for `team-intake` / `team-qa`

### Exact CLI flags in a plan need an empirical check, not a documentation read

**2026-08-02, `intake/2026-08-02-trunk-drift-detection/`.** `technical-plan.md` §4
specified the detector's git walk as
`git log … --not --exclude=refs/heads/<branch> --branches`. That is **wrong**: per
`git-rev-list(1)`, patterns given to `--exclude` "should not begin with `refs/heads`"
when applied to `--branches` — a `refs/heads/`-prefixed pattern matches nothing and is
silently ignored. The correct form is the **bare branch name**,
`--exclude=<branch>`. The implementer caught it and verified the semantics
empirically against real fixtures; had it shipped as planned, DEC-5's clause 3
(the false-positive guard, the single most load-bearing predicate in the change)
would have been a **no-op** while every test that didn't specifically exercise it
stayed green.

**The generalizable lesson:** when a plan pins exact CLI flags — git, `find`,
`rsync`, `ffmpeg`, anything with pattern/ref-matching semantics — the plan is
asserting a behavior it has not run. A flag that is *accepted* is not a flag that
*matched*. Plans should either (a) mark such flags as "semantics unverified,
implementer must confirm empirically," or (b) carry a one-line recorded
verification (the actual command run + its actual output) beside the flag. And the
corresponding test should be able to fail if the flag silently no-ops — which here
means a fixture where the excluded set is non-empty, not just a happy-path walk.
