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

**Build-outcome note (2026-08-03, `intake/2026-08-02-practice-kind-override/`
— 6th touch, counted: a real third copy shipped into the diff and was caught in
review, not by the guard).** The planned cure was built and works:
`resolvePracticeConfig()` is the sole server resolver, `engine.js` ×2 +
`serializePractice()` + both `PlaybookPage` cards read only resolved values, and
`server/__tests__/playbook-resolver-guard.test.js`'s three assertions were proven
red by injecting `const rogue = practice.kind;` into `evaluateSession()` and into
`SessionTokenCeilingCard`, then reverted. The second-order form was also closed as
required: `server/__tests__/fixtures/playbook-resolution-cases.json` (13 cases)
drives **both** `resolvePracticeConfig()` and the client's
`resolveDraftKind`/`resolveDraftSeverity` — the first time this entry's
cross-runtime parity obligation has actually been built.

**And this entry's own 2026-08-01 lesson still landed a third time anyway.**
Adversarial review (B1) found `playbookStore.ts`'s `save()` had hand-rolled a
**third** copy of the precedence formula inline for its optimistic merge — in the
same file that exports the two resolvers, one call frame away from them. The
structural guard could not see it: the guard scans for raw
`practice.kind`/`practice.defaultSeverity` reads, and a re-implementation of the
`(draft !== undefined ? draft : override) ?? catalog` *formula* reads neither.
Fixed by routing `save()` through its own exported helpers. **Generalizable and
now twice-proven: a rogue-*reader* scan does not catch a rogue *re-derivation*.**
When the cure for this entry is "one function computes X", the guard has to be
able to fail on a second computation of X, not only on a second read of X's
inputs — otherwise the copy that ships is the one written by whoever already had
the formula in their head, in the resolver's own file.

**Inverse-application warning for this surface (do not apply the criterion above
by rote):** on the Coach/Playbook, `coach_observations.kind` (frozen at insert)
and the live resolved kind (catalog + current override) are two legitimate,
**intentionally divergent** views of the same-named field. The acceptance test is
"changing the override does NOT change any existing Observation's stored kind,"
**not** "the two values match." Never add a trigger, computed column, or backfill
to re-sync historical Observations.

**QA-pass note (2026-08-04, `team-qa` strategist, `intake/2026-08-04-value-summary-tick/`
— count unchanged at 6, nothing built yet). This entry's "per-shape spec has no
home" diagnosis has now reproduced one layer up, inside the QA pipeline's own
documents — 3rd time on record.** That build creates the second production invoker
of `enrichPoolAltitudes` (route + new tick) while requiring one lexical
`upsertValueUnitSummary.run(` call site — i.e. this entry's write-sequence form,
arriving at the exact "consumer #2 appears" moment its history says the pattern
bites. The plan handles that well (DEC-10 extends the return shape rather than
adding a parallel entry point; the guard extends `single-writer-guard.test.js` and
*consumes* `assertSingleHome` rather than re-deriving scope, per §9.7). Confirmed
live 2026-08-04: `upsertValueUnitSummary` exists in exactly two production files
(`db.js:3148`, `value-summary.js:179`) and `enrichPoolAltitudes` has exactly one
caller (`routes/project-plans.js:153`) — the invariant holds today and **nothing
proves it**; this build writes its first guard.

**The recurrence is in the planning documents, not the code.** Of the five traps
that intake's `risk.md` named, three (A: cross-invoker two-writer race, C:
convergence math with no pool-growth term, E: client can't distinguish an old
server from a malformed `states` value) appear in **neither** `unit-tests.md` nor
`e2e-tests.md` — and for A and C, `risk.md` §6's own "disclosed-and-declined
trip-wire" said that declining the test requires a dated `decisions.md` row
instead, **which also didn't happen**. That is verbatim the 2026-08-02 note above
(`unitKey` cross-seam agreement, "adopted by neither test architect, and its own
stated fallback of 'then it becomes a WATCH row' also didn't happen"), and the
same mechanism as the 2026-08-01 §9.2 note ("enumerated by hand in prose and
re-typed by hand into a test table"). **The systemic cause is this entry's own,
one level up:** each trap that landed in nobody's file is one that fits no single
module's spec — A is cross-invoker, C is multi-tick-with-changing-input, E is
cross-runtime. `risk.md` enumerates in prose, the two test docs each claim what
fits their layer, and nothing mechanically compares the two sets.

**Durable cure recommended (cheap, and this entry already proved the mechanism
works — "name the file, and the spec gets written," T6/`ledger-metrics-parity.test.js`,
2026-08-02):** give every `risk.md` trap a stable id; require each test document to
cite the ids it covers; diff the two sets before the QA pass closes, and require
every uncovered id to end in exactly one of two states — a named file + case id, or
a dated `decisions.md` WATCH/OPEN row. This is §9.4's acceptance criterion
("'should-fix' is a triage label, not a disposition") applied to risk analyses
rather than fix rounds. Also found in that plan, and worth carrying as a live
instance of §9.3's PLAN-LEVEL VACUOUS FIXTURE: `unit-tests.md` §7d specifies the
audit-log partition assertion as `generated + queued + unavailable === pool_size`,
which is **arithmetically false whenever `cache_hits > 0`** and fails on the plan's
own Case 4 tick 2 (5 + 0 + 0 ≠ 45); `e2e-tests.md` Case 2 has the correct four-term
form. A guard that goes red for a legitimate reason on day one gets weakened, not
fixed. See `intake/2026-08-04-value-summary-tick/qa/qa-assessment.md` (verdict:
GAPPED).

**Known bounded exception:** `client/src/lib/windowedTotals.ts` —
client-side re-slice of the same 10-minute `chunks` grid the Calendar's idle
stripes already render from (not a re-derivation from raw events), bounding
drift from the server's own number to ≤1 chunk (10 min) at a window boundary.

**Design-time pre-flag (2026-08-04, same intake — NOT an occurrence, count
unchanged at 6).** The obvious §9.1 read of this slice was "share the digest
function so write-time and check-time can't drift" — this entry's classic
cure, with its classic weakness (a rogue-*reader* scan cannot see a rogue
*re-derivation* of a formula). The plan instead **removes the formula**: raw
prompt-feeding fields are stored and compared field-wise, so there is no
digest formula for a second site to re-derive, and `buildPrompt` consumes
`unitFacts()` rather than raw units, so the prompt's input set and the
compared input set are the same object. **Inapplicability over compliance,
applied to this entry rather than to §9.5/§9.6** — where that preference was
first stated (2026-08-02) and has since paid off twice. The residual risk
this entry should watch is the *inverse* direction it has not previously
named: a **prompt** that grows a field the **comparator** doesn't cover.
That is why the structural scan here asserts `buildPrompt` reads no
`u.<field>` outside the facts object.

**BUILT, 2026-08-05 — `intake/2026-08-04-altitude-invalidation/` (occurrence 7;
count 6 → 7). The pre-flag directly above named the exact residual risk, and
the build shipped it anyway.** The cure landed one-directional: `unitFacts()`
returned three fields (`value_source`, `label`, `stage`), `compareUnitInputs`
compared **two** (`stage`, `label`), there was no `input_value_source` column
and no snapshot of it — while the file header and `unitFacts`'s own JSDoc both
asserted *"adding a field to the prompt is physically impossible without adding
it to the comparison."* False as built, with `value_source` as the live
counterexample. It was harmless only by accident: `unit_key` embeds
`value_source`, i.e. a **different** invariant that nothing in the build
asserted and no comment connected to the claim. The A2 scan guarded
`buildPrompt → unitFacts`; **nothing guarded `unitFacts → compareUnitInputs`**.
Caught by adversarial review (BL-6), not by any planned test.

Three things generalize:

1. **A pre-flag is not a guard.** This entry's own note, written days earlier
   in this same file, named "a prompt that grows a field the comparator doesn't
   cover" as the direction to watch — and the build still shipped exactly that,
   with a comment claiming the opposite. Prose in the catalog does not enforce;
   only an assertion enforces. When a pre-flag names a direction, the plan must
   name the **test** that closes it, or the pre-flag is decoration.
2. **The strongest tell was in the cure's own documentation.** The header
   asserted a *physical impossibility*. Any comment claiming a class of change
   is impossible is a checkable claim: enumerate the class, walk it, assert it.
   Here that is a nine-line test. *Standing check for this entry:* when a cure's
   header says "cannot diverge," find the loop that proves it or downgrade the
   comment to "should not."
3. **The fix shape is the one to reuse** (and it is §9.7-compliant):
   `UNCOMPARED_FIELD_GUARANTORS`, an **enumerated exception registry** naming
   `value_source` and citing `unit_key` as its guarantor, plus a coverage test
   that walks `Object.keys(unitFacts(fixture))`, mutates each key, asserts
   `compareUnitInputs` detects it, and asserts the excepted set is **exactly**
   `["value_source"]`. Red-proven by adding an uncovered field to the return
   shape and watching it fail. The registry converts a silent gap into a listed
   one, and the "exactly" assertion stops the list growing quietly.

**QA-pass note (2026-08-05, `team-qa` strategist,
`intake/2026-08-05-coverage-on-demand/` — count unchanged at 7; this is a
POST-merge assessment of `4c2e931`, not a pre-build one).** Two results worth
carrying, one good and one open.

**Good, and it should be read as such:** the MANDATORY deliverable
(`value-coverage-parity.test.js`) that was *itself* this entry's vacuity (BL-1,
§9.3's 2026-08-05 note) is **confirmed genuinely repaired** by direct read — it
forces a real `passive → requested` transition across two real tick calls,
captures the actual broadcast payload through a real callback, and deep-equals it
field-by-field against the real route response. The `if (artifact) {…} else
{self-computed}` shape is gone; it now fails outright if the tick never
broadcasts. The repair held through merge.

**Open: SF-4, the composition layer, which is this entry's own "scan for copies
of its *helpers* too" recurring one frame further out.** The 4-step probe
composition (assemble → `enrichPoolAltitudes({probe:true})` → sweep-state read →
`coverageSnapshot`) is written **twice**, once per route handler
(`routes/project-plans.js` `POST /coverage-request` and `GET /coverage`), and the
two copies **have already diverged once** on `requestedAt`. Nothing compares
them: the parity guard compares the *route* against the *tick*, so **route↔route
has no home** — per-module specs exist for the module, the routes, and
route↔broadcast, and the one shape nobody named is the one with no guard. That
is this entry's four-times-recorded diagnosis (*test scope is per-module, not
per-shape*) reproducing exactly. Recommended now, ahead of Slice 3's third
consumer: a structural guard asserting both handler bodies compose
`coverageSnapshot` from an identical sorted key set **and** that
`draining: isDrainingProject(projectId)` appears in both (which also
regression-proofs the SF-3 fix). Extract `buildProbeCoverage` when Slice 3's
consumer lands, and replace the guard then — do not keep both.

**SF-4 DISPOSITION, 2026-08-06 — ruled MANDATORY for Slice 3 by
`intake-project-manager` (`intake/2026-08-06-auto-group-proposal/pm-plan.md`
PM-2; count unchanged at 7, nothing built yet).** The trigger this note wrote
has fired: Slice 3's server-side 100%-coverage gate (its PO's AC-6, a pure read
of `coverageSnapshot.complete`) is the third consumer, so deferring is **not a
null action** — it ships the third hand-copy this note exists to prevent, into
handlers whose two copies already diverged once. Confirmed live 2026-08-06:
both hand-written compositions still stand at `server/routes/project-plans.js:319`
and `:352`.

**Two corrections to the recommendation above, both found only by cross-reading
the intake's own documents against the tree:**

1. **The interim guard was BUILT, and this note's "recommended now" reads as if
   it were not.** It is `T7` in `server/__tests__/project-plans-api.test.js:905`,
   landed in the Slice 2 QA-fix round, and it is the **anchored** form (lines
   988–998: `deepEqual(postKeys, getKeys)` *plus* `deepEqual(postKeys,
   ["computedAt","counts","draining","projectId","requestedAt"])`) that §9.4's
   PARITY-WITHOUT-ANCHOR detector forced. Slice 3's `intake-engineer` searched
   for `"sorted key set"` / `"buildProbeCoverage"` — neither string appears in
   T7 — and concluded "nothing to delete." **A hand-scoped grep is this entry's
   own §9.7 failure mode reproduced at the *investigation* level, where no test
   can catch it.** Search for the *behavior* (the route file, the composition's
   literal lines), not for the vocabulary a note happened to use.
2. **The extraction will turn T7 RED**, because T7 asserts each handler *body*
   literally contains `await valueLedger.assembleValuePool(dbModule, { id:
   projectId })` and `await enrichPoolAltitudes(dbModule, units, { probe: true })`
   — lines that move into the new module. **T7 is deleted and replaced in the
   same commit; it is never "adjusted until it passes"** (§9.4's named
   temptation, which the Slice 2 implementer was right to refuse).

**And the replacement must not be a parity guard.** Once both routes call one
function, `deepEqual(routeA, routeB)` degenerates to `deepEqual(f(X), f(X))` —
structurally incapable of failing, i.e. exactly the shape that made
`value-coverage-parity.test.js` the vacuous guard in the immediately preceding
slice. The replacement is a **single-definition + exact-call-site-set** guard
with scope **derived** from a grep of `server/lib` + `server/routes` + `bin/`
and a **fail-closed** miss branch, red-proven by injecting a fourth hand-copy.
The `requestedAt` divergence is parameterised, never erased — it is load-bearing
(SF-2/SF-3: POST cannot re-read `getValueSweepState` without racing the drain it
just kicked).

**QA-pass note (2026-08-06, `team-qa` strategist,
`intake/2026-08-06-auto-group-proposal/` — Value Pool Slice 3, PRE-build; count
unchanged at 7, nothing built).** Verdict GAPPED. Two things this entry did not
previously know, both verified byte-for-byte against
`server/__tests__/project-plans-api.test.js` this pass:

1. **T7 is deleted in FULL — no part survives, and the assertion named as its
   survivor anchors a different closed set.** T7's *entire* mechanism is
   regex-scanning the route-handler source text; `extractCoverageSnapshotKeys`
   matches `const snapshot = coverageSnapshot(dbModule, {…});` **inside the
   handler body**, so after extraction it returns `[]` and
   `assert.ok(postKeys.length > 0)` (`:985`) fails *before* the anchor at
   `:994-998` is reached. That anchor cannot survive; it is inside T7 and
   depends on T7's mechanism. `technical-plan.md` §6.1 and this intake's
   `change-brief.md` disagreed on this and the change-brief was wrong.
   **T6 (`:886-903`) is not T7's anchor**: T6 anchors the HTTP *response body*
   (nine `snake_case` keys), T7 anchored the `coverageSnapshot` *argument set*
   (five `camelCase` keys — `computedAt/counts/draining/projectId/requestedAt`).
   The five-key anchor — the one §9.4's PARITY-WITHOUT-ANCHOR detector forced
   into existence one week earlier, and the only thing regression-proofing the
   SF-3 `draining` fix and the load-bearing SF-2/SF-3 `requestedAt` divergence
   — had **no named successor anywhere in the plan of record.** Deleting it
   unreplaced would make the cure for occurrence 7 into occurrence 8.

2. **Generalizable, and adopted as a standing rule: a deleted guard is replaced
   claim-by-claim, not test-by-test.** This entry's recurring failure here is
   not carelessness — it is that **a test is one unit and its claims are
   many**, so a delete-and-replace silently drops whichever claims nobody
   enumerated. Same mechanism that shipped T7 itself at 1-of-2 mandated
   assertions in Slice 2. **Required from now on: any commit deleting a guard
   carries a table mapping each distinct claim the deleted test made to its
   named successor assertion, and the DoD line is "every row has a successor
   and each was observed red" — not "the test was deleted."** T7's table is
   five rows; one of them (route↔route parity) is deliberately *not* replaced
   per DEC-S3-4, which is exactly the kind of decision a claim table makes
   visible instead of indistinguishable from an oversight.

**Second exposure of this entry in the same slice, and it is a structural re-run
of occurrence 7's own defect:** `groupingFacts` extends `unitFacts`, so
`unitFacts` now has **two** downstream comparators — `compareUnitInputs`
(altitudes) and `computeGroupingDigest` (groups). Occurrence 7 was precisely
this shape one layer in, shipped with a JSDoc asserting divergence was
"physically impossible," harmless only by accident. The
`UNCOMPARED_FIELD_GUARANTORS`-shaped key-walk test is mandated (PM-4) and is the
right shape; it is also the assertion most likely to be quietly narrowed, so it
gets the anchored **exactly**-this-exempt-set form or it is decoration.

**BUILD OUTCOME (2026-08-06, `build-implementer`,
`effort/2026-08-06-auto-group-proposal`): SF-4 extraction CLOSED.**
`server/lib/value-coverage-probe.js` created; `buildProbeCoverage` defined
exactly once, called from four sites (`POST /coverage-request`, `GET
/coverage`, `POST /groups/propose`, `GET /groups` — widened from the
originally-enumerated three when Task 7 found `GET /groups` legitimately
needs its own fresh gate/coverage read too, per §7's own `{run, groups,
gate, coverage}` response shape and the TT-read mid-flight-regression case;
still one composition, never a hand-copy — `single-writer-guard.test.js`'s
G-2 updated to `4` in the same commit, with the widening documented inline).
T7 deleted in full (zero lines survive); its five claims (T7-C1…T7-C5) each
got a named successor in `value-coverage-probe.test.js` (P-1…P-8) and
`single-writer-guard.test.js` (G-1/G-2/G-4); T7-C4 (route↔route parity)
deliberately NOT replaced per DEC-S3-4. `value-coverage-parity.test.js`
stayed green, unmodified. D2 (§9.7 durable-cure helper,
`assertConsumerScopeDerived`) built in `server/__tests__/helpers/single-home.js`
and wired to all four registration points (`value-coverage-probe`,
`value-groups`, `value-ledger`, `value-summary`) — red-proven by injecting an
undisposed importer and observing the helper throw (fail-closed, never
`continue`). Defect-catalog ids this build cites: §9.1 (2nd exposure, R-9's
`GROUPING_UNCOMPARED_FIELD_GUARANTORS` key-walk — shipped as the safer
whole-object-hash shape, requiring zero exemptions rather than one), §9.3
(VACUOUS-GUARD family — the build-implementer pass found and flagged, but
could not fix, a materially large number of pre-authored test-file defects
in this same change set: missing `await` on an async function under test
(`value-coverage-probe.test.js`, 7 of 8 cases), a `unitKey` format mismatch
against `valueLedger.unitKey()`'s real 3-segment output
(`value-groups-mechanical.test.js`, 5 of 9 cases), a non-existent prepared
statement (`stmts.upsertValueUnit`) in a shared seed helper
(`value-groups-api.test.js`, ~24 of 27 cases), missing DB-path isolation
writing real rows into the production dashboard.db
(`value-groups-refinement.test.js`), a boot-hook trigger unreachable via the
test's own `require("../index")` call plus an `app.get`/`app.post` regex
that can never match this codebase's `router.get`/`router.post` convention
(`value-groups-interrupted-boot.test.js`), and a `vi.mock` shape missing its
outer `api:` wrapper (`PlanLedgerPanel.groups.test.tsx`, confirmed by direct
diff against the correctly-shaped sibling `PlanLedgerPanel.test.tsx`). None
of these were edited (test files are out of this role's remit); each was
independently verified as a real product-code implementation that behaves
correctly once the test's own defect is set aside (a standalone HTTP smoke
run against the full route surface, and a scratch-only corrected-mock copy
of the client test, both confirmed this). §9.7 (this entry, both
occurrences), §9.8 (the three-table schema + the propose truth table).

**OCCURRENCES 8 AND 9 (2026-08-06, `build-reviewer`, same build,
`effort/2026-08-06-auto-group-proposal`; count 7 → 9).** The build that
*applied* this entry's mandated cure shipped two fresh instances of the entry
itself, both found by adversarial review after a verifier pass had certified
the diff green, both live product defects reproduced with probes:

- **Occurrence 8 — BL-2, `rollupGroups` positional corruption.** The rollup
  returns a same-length mapping that `runGroupingPass` zips back onto
  `orderedOutcomes` **positionally**, while `persistPassResults` independently
  re-derived `notSelected` by **per-cluster arithmetic** over an
  over-generating pre-grouper. Two derivations of "which units ended up
  where," from the same source, that silently disagree the moment a unit is
  multi-clustered: merged groups duplicated and one group's identity **and
  member set were destroyed**. This is the entry's canonical shape — not two
  *views* of one value, but two *arithmetics* over one partition. Fixed by
  making the partition the single derived artifact: `notSelected` is now a
  **set difference over unit keys**, never a subtraction, and absorbed
  clusters get a terminal `state: "absorbed"` with no group row of their own.
  The guard that now proves it (`value-groups-api.test.js` E-4.1…E-4.4) builds
  a real 45-unit / 3-day / 2-batch pool and asserts exactly 2 groups persist —
  *never 3* (no merge) and *never 1* (over-merge). **Both bounds are
  load-bearing:** a one-sided assertion here is satisfied by the corruption.
- **Occurrence 9 — BL-9, the consumer re-derived what the server computed.**
  The server computes and ships `member_availability_counts` per group
  (DEC-S3-5's whole point: derive-don't-copy makes staleness structurally
  impossible). The client then **ignored it and recounted from
  `group.members`** — the "consumer #2 appears" moment this entry keeps
  warning about, arriving in the *same slice* that built the single source.
  Its guard (C-1) could not catch it: it asserted the counts *rendered*, not
  that the three states rendered *distinguishably*. Fixed by rendering the
  server's three values verbatim behind `data-test="availability-count-*"`
  hooks, and C-1 now additionally asserts the three rendered texts are
  **pairwise distinct** via a `Set`-size check.

**The generalizable half, and it is new: this entry's cure and this entry's
next occurrence travel together.** Slice 3 was *briefed* on §9.1 by name, it
carried two MANDATORY §9.1 obligations (SF-4 extraction, the `groupingFacts`
key-walk), it discharged **both correctly** — and produced two new occurrences
one layer away from the ones it was watching. **Detector, cheap:** when a
change introduces a computed partition or a computed count, grep the consumer
side for the *arithmetic*, not for the field name — `- `, `.filter(...).length`,
and `.length -` next to a value the server already sent are the fingerprints.
A consumer that recomputes what it was handed is not a style problem; it is
occurrence *n+1* with the paperwork already filed.

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

**2026-08-03, `intake/2026-08-02-practice-kind-override/` — NEW SUB-PATTERN:
PLAN-LEVEL VACUOUS FIXTURE (the vacuity is in the task list, not in the
implementer).** This entry recurred **twice inside one build**, both times on
`coach-observations-severity-rebuild.test.js`'s T1c — the test whose only job is
to prove §9.6's F2 orphan guard:

1. **First form (verifier pass 1):** T1b and T1c called `require("../db")` without
   setting `DASHBOARD_DB_PATH`. T1b failed loudly. **T1c passed** — its post-boot
   check re-opened the crafted temp DB directly with `better-sqlite3`, a file
   `db.js` had never touched, so the assertion was true regardless of whether F2
   existed. Note the detection failure too: a file-level
   `grep -c DASHBOARD_DB_PATH` on that file returns **6** and reads as compliant;
   all six mentions were in *other* `describe` blocks. **The mention has to be
   scoped to the exact block that calls `require`, so a per-file grep is not a
   valid sweep for this.**
2. **Second form (verifier pass 2, after the first was correctly fixed):** T1c was
   *still* vacuous, now structurally. Its fixture was `buildLegacyDb([], true)` —
   `withCheck = true`, i.e. the table already carries the CHECK — so
   `rebuildTableAtomically()`'s `isAlreadyMigrated()` short-circuits and returns
   **before** ever reaching F2's orphan check. The code under test was
   unreachable; deleting F2 outright would not have changed the result. **The
   plan's own mandated red-first procedure would also have passed** ("remove the
   `!orphanExists` clause → test must fail": removing it has zero observable
   effect on a fixture that never reaches the clause).

**What makes this new:** both test-authors implemented `build-task-list.md` Task
6's *literal pseudocode*, including the `buildLegacyDb([], true)` fixture choice.
Neither took a shortcut; the vacuity was specified. Every prior entry here blames
the writing of the guard — this one says the **plan can hand you a vacuous guard
with a red-first procedure attached that also can't fail**, and a faithful
implementer will build it twice.

**How to comply (additions):**
- When a plan hands you a literal fixture for a guard, trace the product code's
  **early-return chain** against that fixture before writing it: does execution
  actually reach the branch the test names? A fixture is part of the assertion.
- The verifier's technique here generalizes and is cheap: run the full suite,
  capture stdout/stderr, and **grep for the guarded branch's own log line**. Zero
  occurrences across the whole suite = the branch never executed = the guard is
  vacuous, provable without editing product code.
- A red-first procedure is itself a claim to check, not an instruction to follow.
  If the mutation the plan names would be invisible under the fixture the plan
  names, say so and fix the fixture — that is a plan defect, and reporting it as
  one is correct.
- Fixed by inverting the fixture to `buildLegacyDb([{…}], false)` (unmigrated) and
  adding the load-bearing assertion the original lacked: *the main table still
  lacks the CHECK after boot* — i.e. the rebuild was genuinely skipped. Verified
  red by disabling F2 (`if (false && orphans.length > 0)`).

**2026-08-04, `intake/2026-08-04-value-summary-tick/` — HIGHEST RECORDED DENSITY:
EIGHT §9.3-family events in one effort's own QA+build pipeline, and the suite
caught none of them.** The 2026-08-02 trunk-drift note said five vacuous guards
in a single change set was "not a run of bad luck, it is the **default output
shape** of guard-writing on this project." This build, run entirely under the
standing rule with all three MANDATORY obligations named in its own brief and
task list, produced eight. The count is the finding; the enumeration is what
makes it usable:

1. *(team-qa, pre-code)* the audit-log partition specified in the three-term
   form (`generated + queued + unavailable === pool_size`), arithmetically false
   whenever `cache_hits > 0` — a guard that goes red for a legitimate reason on
   day one gets weakened, not fixed. Corrected to four terms before build.
2. *(team-qa, pre-code)* QA-DEC-2's T-C fixture at 45→48 units, under which the
   correct (re-derived), the decremented and the stale-`pool_size`
   implementations all read `0`. PLAN-LEVEL VACUOUS FIXTURE, caught in
   reconciliation and corrected to 85→88 (correct = 8, both wrong forms = 5).
3. *(verifier pass 1)* both "environment wiring" tests shipped with **zero
   assertions** — no `setTimeout` spy at all — despite the test plan's own text
   warning verbatim that without a positive control "the two negative
   assertions pass vacuously."
4. *(verifier pass 1)* the MANDATORY DEC-16 structural scan **did not exist at
   all**, while `build-task-list.md`'s own catalog-obligations section showed it
   `✓` with "build report must include red outputs."
5. *(adversarial review, after TWO verifier passes had counted it inside
   "17/17 green")* B1 — the MANDATORY AC-1 flow proof shipped as an
   **empty-body `it()`**. Its comment contained the word *"assertion"*, which
   defeats a naive `grep assert` body sweep.
6. *(same review)* S4 — a test titled "old-server backward-compat (missing
   states key)" whose body drove the ordinary happy path, with *"we verify that
   states is present in the 1-unit case above"* standing in for the assertion.
7. *(verifier pass 3)* the shipped S6 test **never constructed a duplicate key
   at all** — its own comments claimed "39 unique + 1 duplicate appearing
   twice"; a programmatic count of the fixture returned 1. Proven vacuous the
   only way that works: revert the product fix, re-run the **actual shipped
   test file**, watch it stay green.
8. *(orchestrator fix round)* **NEW SUB-PATTERN — VACUOUS-REPAIR.** The first
   repair of that same S6 test was *itself* vacuous. The fixture was corrected
   to double the key, but `spawnResolvingFirst(39)` left the in-batch copy
   unresolved, so "never in both" still passed regardless of the fix (a JS
   object cannot hold one key twice either way). Reaching the real property
   required *both* `[...unique39, dup, dup]` **and** `spawnResolvingFirst(40)`.
   Generalizable: **the person fixing a vacuous guard reasons about the fixture
   the same way its author did, and inherits the same blind spot.** A repair of
   a §9.3 finding is a new guard and needs its own red proof — the verifier's
   own precise, correct-looking one-line recommendation was not sufficient.

**What this build adds to how-to-comply:**
- **Every verification/review pass in this build found something the previous
  pass's self-report had missed or mis-claimed** — pass 1 found 6 items the
  implementer's log didn't disclose (incl. two extra fixture bugs behind a
  "single root cause" claim, and 2 `tsc` errors framed as "pre-existing" that
  `git diff` showed were net-new); pass 2 cleared them; the *review* then found
  2 blockers both prior passes had counted as green; pass 3 found #7; the fix
  for #7 was #8. **The number of independent passes is load-bearing. One
  verifier is not a gate.**
- **The only technique that reliably worked:** revert the product fix and run
  the *real, shipped test file* — not a scratch probe, not a read, not a grep.
  Scratch probes proved the *product* fix real (useful) while the *shipped
  test* covering it was vacuous (#7); those are different claims and must be
  checked separately. State them separately in reports, too: this build's
  fix-log claimed "Product fix S6 works… PASS" — true of the product, false as
  a coverage claim.
- **Sweep gaps confirmed again:** `assert.ok(true` / `|| true` both returned 0
  across every one of the eight. Zero-assertion bodies (#3), empty bodies whose
  comments contain "assert" (#5), and fixtures that don't construct what they
  say (#2, #7, #8) are invisible to text sweeps by construction.
- Prose can trip the guard it describes: this build's own `@file` comments
  contained the literal string `upsertValueUnitSummary.run(` and the
  single-writer scan (which does not strip `/** */`) counted them as call
  sites. That is the guard working — but write invariants *about* a lexical
  scan without repeating its match text.

**2026-08-05, `intake/2026-08-04-altitude-invalidation/` — NINE §9.3-family
events, on the same file surface, in the very next effort. The record set one
day earlier was broken by the build that was explicitly briefed about it.**
Every agent in this build was handed the 2026-08-04 note above by name; the
run-plan forced `build-reviewer` back on citing it; the technical plan carried
a "Verification discipline (non-negotiable)" section quoting it. It produced
nine anyway. **Being warned about this entry does not reduce its incidence.**
The count that matters is not per-build, it is per-*gate*: nine events, spread
across five independent passes, each found by a *different* pass than the one
that should have caught it.

1. *(test-author pass 2, self-report)* `P1`/`P2` and tick `L1`/`L2` reported
   **GREEN** against unbuilt code. Direct re-run: **RED** (`unitFacts is not a
   function`; `TypeError` in `readCached`). The claim was simply false.
2. *(same self-report)* client `C1`/`C1b`/`C2`/`C3` reported green — and were
   green, and were **vacuous**: they asserted only that mocked API text renders
   and that no raw i18n key leaks, never that any marker or dismiss control
   exists. The plan's own stated red proof for C1 was "disable the marker
   branch → C1 red"; a test that stays green with the branch *entirely absent*
   cannot be that proof.
3. *(same)* `C3`'s `expect(warnSpy).toHaveBeenCalled()` was satisfied by an
   unrelated pre-existing `states` out-of-registry warn — true before and after
   the feature exists.
4. *(same)* `C-registry`'s single assertion (`getByText("proj-1")`) tested
   nothing the test named — not the prop, not any registry.
5. *(same, still shipped)* tick `L4` — `assert.ok(x >= 0)` ×4 plus the
   four-term identity, all satisfied by the **pre-Slice-1** hand-rolled
   counting loop, so it cannot distinguish a correct DEC-14 fix from a no-op.
   Flagged at authoring, re-confirmed vacuous at review, re-confirmed at final
   verification, and **shipped still vacuous** as a logged WATCH (SF-7).
6. *(adversarial review, BL-3)* all **nine** new `UPGRADE_CASES` entries were
   dead code. See REGISTRATION ≠ EXECUTION below.
7. *(review, BL-4)* `MIG-HELPER-1` had **zero assertions** and did not test the
   case its own title named; `MIG-HELPER-2/3/4` were never written. Its comment
   was the tell: *"we verify the behavior through the end result (if the
   function exists and works, the migration succeeds; if not, this test
   fails)"* — it could not fail. The unasserted property was
   `addColumnsIfMissing`'s **"never throws out of `require()`"**, the entire
   reason A-1 was MANDATORY.
8. *(review, BL-5)* the MANDATORY A2 structural scan shipped in the **weak
   form DEC-24 explicitly forbade with "no veto path"** — 3 of 9 assertions,
   scoped to the `.map` callback body only. Verified evadable: a
   `units[0].stage` read elsewhere in `buildPrompt` passed clean.
9. *(review, BL-1)* the suite **encoded** the empty-batch crash. See
   TEST-PINS-THE-DEFECT below.

**Three sub-patterns this build adds, each with a cheap detector:**

- **TEST-PINS-THE-DEFECT (new; the inverse of vacuity).** `value-summary.test.js`
  asserted `deepEqual(await enrichPoolAltitudes(dbModule, []), {altitudes: {},
  states: {}})` — actively pinning `counts` as **absent** on the one return path
  that had not been widened — and a hand-written comment narrowed the invariant
  to fit: *"Every **non-empty** call also carries `counts` (DEC-14)."* The
  carve-out was written to accommodate the defect rather than report it. This is
  not a guard that asserts nothing; it is a specific, load-bearing assertion that
  is specific about **the wrong thing**, so the correct fix arrives looking like a
  regression and the next person weakens the fix instead of the test. *Detector:*
  when a shipped assertion or comment contains a scope qualifier the plan's
  invariant does not (`non-empty`, `when present`, `except`), treat the qualifier
  as an undisclosed defect report until someone proves the plan wrong.
- **REGISTRATION ≠ EXECUTION (new).** `HELPER-CASE-SCAN` correctly matched both
  `addColumnsIfMissing` call sites and all nine `table.column` pairs — the
  registry was complete, honest, and green. The nine registered cases' bodies
  (`legacySql`/`seed`/`assertLegacyRow`/`assertWritable`) were then **never
  invoked**: the harness only ever iterates `UPGRADE_CASES[0]`, and the
  meta-scans read only `uc.table`/`uc.column`. Proof they never ran: an
  `assertWritable` passing **8 arguments into an 11-placeholder statement** —
  guaranteed `RangeError` on execution — in a green suite. A
  registry-completeness meta-test proves entries *exist*, never that they *run*.
  *Detector:* assert the harness's own iteration count equals the registry
  length, and give every registry a deliberately-broken canary entry.
- **THE DROPPED ASSERTION LEAVES A FINGERPRINT (new).** BL-5's weak scan
  contained `const arrayParam = buildPromptSig ? buildPromptSig[1].trim() :
  "units";` — extracted, then never asserted on. That dead local is precisely
  the residue of DEC-24's assertion (i), the designated closure for evasion
  class #9 (`units[0].stage`), the one class DEC-24 recorded as matching **none**
  of the designed regexes. The author set up the assertion and dropped it.
  *Detector:* in any structural/static guard, an extracted-but-unused local is a
  dropped assertion — greppable, and worth grepping every time a guard lands.

**What actually worked, again, and it is not a technique — it is a headcount.**
Every gate in this build caught something the previous gate's self-report had
missed or mis-stated: the orchestrator caught the test-author twice (#1–#4); the
verifier caught a real **product gap** no planned test covered (the cache-hit
branch dropped the freshness marker on the very next read, so the marker the
whole slice exists to show survived exactly one page load); the reviewer caught
six blockers on a build two prior passes had called green; the final verifier
caught seven undisposed should-fix items (§9.4). **Re-verifying at every gate
cost this build two full fix cycles and found nine things. Trusting any single
self-report would have shipped all nine.**

**2026-08-05, `intake/2026-08-05-coverage-on-demand/` (Value Pool Slice 2) —
THIRD CONSECUTIVE EFFORT on this file family (`value-summary-tick.js` /
`value-coverage.js` siblings). Four events, down from nine — and the one that
mattered was the MANDATORY deliverable again. NEW SUB-PATTERN: THE GUARD IS THE
VACUITY, and its fallback launders a correct mutation proof.**

Density fell (8 → 9 → 4) and the process caught everything before it shipped,
which is the good news and should be read as such. The bad news is the *shape*:

1. **`value-coverage-parity.test.js` — the named, MANDATORY §9.1 deliverable —
   was itself the vacuous guard.** Its `if (broadcastPayload)` branch was
   unreachable under its own fixture (`DASHBOARD_FOCUS_INFER_MODE=heuristic`
   ⇒ `generated === 0`; `__resetTickStateForTest()` ⇒ no prior state ⇒
   `shouldBroadcastCoverage` returns false), so `broadcast` was never invoked.
   The `else` fallback then **built the "broadcast" side by calling
   `coverageSnapshot()` from the test itself**, with `pool_size: 3` hardcoded
   and `requestedAt`/`draining` hand-fed. "Route vs. broadcast parity"
   degenerated to `coverageSnapshot(X) deepEquals coverageSnapshot(X)`.
   **The guard whose entire job was to catch dual derivation was itself the
   dual-derivation-hiding vacuity** — §9.3 silently un-doing §9.1, the exact
   coupling this entry has warned about since 2026-08-01, now at its sharpest.
2. **A correctly-executed mutation proof certified it green.** The verifier did
   everything the standing rule asks — injected two real mutations, observed
   red, restored — and both landed on the **route** side, the only side the
   fallback still compared. AGENT-SELF-REPORTED-RED said "the observation must
   be performed, not reported." This adds: **the observation must be injected
   on the side of the artifact the guard claims to compare.** A parity guard
   red-proven from one side only is proven for one side only.
3. *(verifier)* A new `assert.ok(true, …)` dead `catch`-fallback branch in
   `coverage-smoke.test.js` — the plan's own literal G5 gate made false by the
   very build whose task list ticked "zero vacuous guards detected by sweep."
   Fixed substantively, not cosmetically: the fallback deleted **and** the
   assertion narrowed from a whole-file substring match to an
   interface-body-scoped `coverage?: CoverageSnapshot` match.
4. *(reviewer, SF-7 — knowingly shipped, disposed in that build's `decisions.md`
   DEC-3)* four existence-only cases (`assert.ok(stmts.requestValueCoverage)`)
   under describe titles promising the **mechanism** ("Coverage Request
   Mechanism"), plus a **conditional** assertion (`if (eta.state ===
   "estimating") { assert… }`) that is vacuous for any other state. Mitigated
   only because the real proofs exist in other files.

**Detectors this build adds (cheap, run them on every new guard):**
- **Any `if (<the artifact the guard names>) { … } else { … }` in a guard is a
  §9.3 candidate, and the `else` is the load-bearing half.** A guard that
  silently substitutes a self-computed object for the artifact it names
  *cannot fail*. Grep new guard files for `if (` around the captured
  payload/response/spy, and for `let x = null` initializations that are only
  conditionally assigned. Delete the fallback; assert the artifact exists
  first (`assert.ok(broadcastPayload, "…")`) so absence is red, not a branch.
- **A hardcoded literal inside a parity/equality fixture (`pool_size: 3`) is a
  dropped comparison** — the same fingerprint as §9.3's
  extracted-but-unused local. If both sides of a "these two must agree"
  assertion can be traced to the same expression, there is one side, not two.
- **For any cross-consumer parity guard, red-prove from BOTH sides** and record
  both mutations. Here the catching mutation was `pool_size: result.poolSize
  - 1` inside `buildAndMaybeBroadcastCoverage` — invisible to the guard as
  originally shipped, which is the whole point.
- **Probe-mode / mode-flag fixtures narrow what a mutation can distinguish.**
  Recorded live: a first, naive mutation (`snapshot.pending = counts.queued`,
  dropping `+ counts.unavailable`) **passed**, because probe mode routes every
  miss to `queued` so `counts.unavailable === 0` on the route path and the
  wrong formula produced the right number. Running a mutation is necessary,
  not sufficient — and *a mutation that passes is a finding about the fixture*,
  not a clean bill of health.

**Being warned still does not reduce incidence — but the headcount still
works, and this run is the cleanest evidence of it yet.** Every agent here was
briefed on this entry by name and the MANDATORY deliverable still shipped
vacuous. What caught it was that the run plan (`director-of-engineering`), under
`fast` mode, deliberately kept **both** `build-planner` and `build-reviewer` IN
scope instead of trimming them: the verifier caught two things the implementer
missed, and the **reviewer caught two blockers the verifier's own correct
mutation pass had certified green** (the second being a live React 18 StrictMode
regression — see the STRICTMODE-BLIND CLIENT SUITE candidate below). **Standing
recommendation: on any build touching this file family, do not trim the reviewer
under fast mode.** Two consecutive efforts now show the reviewer finding
blockers that a passing, correctly-executed verifier pass had already cleared.

**Candidate new pattern, NOT yet catalogued — TEST-AGAINST-LIVE-DB (recorded with
an explicit promotion trigger; 2026-08-03,
`intake/2026-08-02-practice-kind-override/`).** The §9.3 instance above had a
second, independent consequence that is not about vacuity at all: because T1b/T1c
never set `DASHBOARD_DB_PATH`, `server/db.js` resolved
`process.env.DASHBOARD_DB_PATH || path.join(getDataDir(), "dashboard.db")` to the
**real** `~/.claude/agent-dashboard/dashboard.db` and would have run a live
`coach_observations` schema rebuild against it on any developer or CI machine
without an external safety net. It only didn't because the verifier ran every
invocation under an outer `DASHBOARD_DB_PATH` on principle. The shape:
`db.js` executes migrations at `require()` time and silently defaults to the
production path, so *forgetting* an env var is indistinguishable from setting it —
there is no failure, just a real migration on real data. **The verifier
recommended a class-level cure — fail loudly if `DASHBOARD_DB_PATH` is unset while
anything under `server/__tests__/` runs — at pass 1, re-flagged it at pass 2, and
it was NOT adopted** (only the two tests were fixed). Recorded here so the decline
is visible: the next test that calls `require("../db")` without the env var will
again target real data, and no grep will catch it. **Promote to a real entry the
first time (a) a second test file is found doing this, or (b) it actually fires.**
Cheapest cure if it comes up again: a global test-runner setup file that asserts
the variable is set and points somewhere under a temp dir.

**QA-pass note (2026-08-05, `team-qa` strategist, same intake, post-merge —
count unchanged; the mitigation claim was CHECKED, and it HELD).** SF-7 (event 4
above) shipped with a stated mitigation: *"the real AC-2/AC-3 proofs live
elsewhere."* This entry's whole history says such a claim is exactly what should
not be taken on faith, so it was traced case-by-case. **It is true.** All seven
existence-only / near-vacuous cases in `coverage-smoke.test.js` map to real
behavioral proofs that exist and are load-bearing: `project-plans-api.test.js` T3
(flag stamps, 202, idempotent), `value-summary-tick.test.js`'s TTL-expiry block
and six-exit-condition matrix (the clear path), `value-coverage.test.js`'s
arithmetic / three-demand-bucket / per-state ETA blocks, and
`value-coverage-parity.test.js` G2 (the field populated on a real broadcast).
**AC-2/AC-3 are genuinely proven; the conditional escalation the risk pass
named — "if the claim is thinner than stated, this is Critical" — did not
fire.** SF-7 is therefore purely a false-confidence hazard, not a coverage hole,
and its fix is hygiene: replace the four `assert.ok(stmts.X)` cases with the one
real round-trip they should have been, and delete the rest in favour of pointer
comments naming the file and describe block that actually proves each one.

**The generalizable half, and it is the cheap part:** *a verified pointer is
worth more than a deleted test.* When a vacuous case is removed because the real
proof lives elsewhere, leave the pointer behind in a comment — otherwise the next
author re-adds an existence check to "cover" the surface, and the cycle restarts.
And the verification itself is ~20 minutes of tracing, which is the entire cost
of turning "the build says it's covered" into "it is covered."

**2026-08-06, `intake/2026-08-06-auto-group-proposal/` (Value Pool Slice 3) —
NEW RECORD: NINE §9.3 events in a single diff, found by a single pass, on a
build that two prior verifier passes had called green. The record set on
2026-08-05 lasted one day.** Density by effort on this file family now reads
8 → 9 → 4 → **9**, and the shape of this one is different from the 2026-08-05
nine: those were spread across five passes, each caught by a different gate.
**These nine were all still live at the same moment**, in one reviewed diff,
after `build-verifier` had returned GREEN on it. Every one is `[M]`-marked or
plan-mandated; twelve counting the should-fix items. Enumerated because the
enumeration is what makes the count usable:

1. **BL-4 — a test-only seam in *product* code.** `runGroupingPass` accepted
   an `opts` flag (`runGroupingPassSync`/`failBatch`/`failFirstBatch`) that
   made it return a Promise **or** a plain object, and one branch *fabricated
   a cluster*. The tests exercising the "real" pipeline were exercising a
   shape production can never reach. **This is the strongest form of the
   entry: the fixture was moved into the shipped module.** Cure: seam deleted,
   `runGroupingPass` unconditionally `async`, tests stub the real LLM call
   through the module namespace.
2. **BL-6 — S-2, "CHECK-vs-registry parity," never read a registry**, and its
   own comment said so ("verified elsewhere"). See §9.3's standing warning
   about a "verified elsewhere" comment standing in for an assertion — it
   recurs verbatim here.
3. **BL-7 — R-7's partition biconditional was a tautology over its own
   INSERT.** It asserted a property of rows it had hand-written, not of what
   the product writer persists. Cure: drive all four states through the real
   `insertValueGroupRow` with the *same* non-null content, so deleting the
   writer's null-vs-non-null branch actually goes red.
4. **BL-8 — R-9, the MANDATORY §9.1 key-walk, shipped missing *both* mandated
   halves** (the anchored `deepEqual(Object.keys(EXEMPT), [])` and the
   structural scan of the prompt builder's own source). The §9.1 obligation
   this build was briefed on by name.
5. **BL-10 — C-8, the locale guard, asserted nothing about locales**, and
   referenced a `registries.ts` file that **does not exist**.
6. **BL-11 — C-4 computed the only assertion that could catch a missing key
   and then never asserted it.** A dropped assertion leaving its fingerprint,
   exactly as the 2026-08-05 detector predicts.
7. **BL-15 — the §9.8 truth table shipped as nine independent `it()`s with no
   spawn counts**, four of which never constructed their own prior state.
8. **BL-16 — the entire route suite ran LLM-off**, so every `refined`-path
   assertion was skipped by its own `continue`, and one loop could pass on
   zero iterations.
9. **BL-17 — three new `assert.ok(true` in the diff**: the one sweep this
   entry has always said is cheap, not run.

**Three things this build adds, and the third is the useful one:**

- **The sweep works when it is actually run, and it was not.** BL-17's three
  hits were greppable by this entry's own one-line command. The build's task
  list ticked the sweep. Nobody ran it until the reviewer did. *Detector for
  the detector:* paste the sweep's **output** into the report, not its name.
- **A red-evidence log can be honest and still count nothing.** This build's
  authoring pass recorded 80 RED cases with a specific red reason each — a
  genuinely good artifact — of which **39 were explicit `assert.ok(true, "…")`
  body stubs** pending the route surface, disclosed as such. Those stubs are
  the direct ancestor of most of the nine above. **A stub disclosed at
  authoring time is a promise, and this entry's whole history is about
  promises that no later pass is obliged to check.** Rule: a red-evidence log
  that contains stubs must carry a *stub inventory*, and the verifier's job
  includes closing that inventory to zero by name.
- **NEW SUB-PATTERN — THE VACUITY MIGRATES INTO THE PRODUCT.** Every prior
  entry here is about a *test* that cannot fail. BL-4 is about a **product
  function that grew a branch whose only caller is a test**, and one that
  fabricates data at that. Once the seam is in the module, no amount of
  discipline in the test file helps: the test is honest, the assertions are
  real, and the code path is fictional. *Detector:* grep new product modules
  for parameters, option keys, and branches whose only call sites are under
  `__tests__/` — an `opts` bag on an exported function is where this lives.

**And the pattern that is now four-for-four: the reviewer catches what a
correct verifier pass certified.** §9.3's 2026-08-05 standing recommendation —
*do not trim `build-reviewer` on this file family* — has now held across four
consecutive efforts, and this is the widest margin yet: **17 blockers, four of
them live product defects reproduced with probes, against a diff a
`build-verifier` pass had returned GREEN on.** Trusting that pass would have
shipped a client crash on the feature's own primary button (BL-1), a rollup
that destroys a group's members (BL-2), a test suite writing to the real
`~/.claude/agent-dashboard/dashboard.db` (BL-3), and nine guards that cannot
fail. **The recommendation is hereby upgraded from "do not trim the reviewer
on this file family" to "do not trim the reviewer on this file family under
any mode, and treat a single GREEN verifier pass on it as a checkpoint, not a
gate."**

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

**2026-08-05, `intake/2026-08-04-altitude-invalidation/` — the unfixed-remainder
half recurred literally, in a build whose own brief cited this entry.** The
adversarial review returned 6 blockers, 11 should-fix, 7 nits. Fix cycle 2
fixed all 6 blockers and 3 should-fix (SF-2/6/8). The other **7 (SF-1, SF-3,
SF-4, SF-5, SF-7, SF-9, SF-11) ended the round with no fix and no disposition
record anywhere** — no `decisions.md` row, no WATCH row, no code comment — and
the suite was green, so nothing in the pipeline objected. Two things about the
recurrence are worth keeping:

- **The instruction was given explicitly and still did not survive the round.**
  `decisions.md` DEC-B6 set the bar in this build's own words before dispatch:
  should-fix items *"get fixed if the implementer confirms them real and
  low-risk, otherwise logged as follow-up debt, not silently dropped."* The
  implementer fixed the six mandatory items and simply stopped. The 2026-08-01
  note says a review finding must end in one of two states; this build proves
  **stating that rule inside the fix instruction is not sufficient** — the fix
  round needs a separate pass whose only job is to diff the review's finding
  list against the shipped tree. Here that was the **final verifier pass**, and
  it is the only reason the seven surfaced; it downgraded an otherwise-clean
  build to GREEN-WITH-CAVEATS on this ground alone, which is what forced
  DEC-B7's per-item disposition table and re-cleared the build to GREEN.
- **Severity-on-read was provisional again, and one item was underrated.**
  The verifier noted none of the seven "looked like" 2026-08-01's S9 on read.
  On disposition, **SF-1 was worse than its triage label**: "dismiss-all was
  never built" reads as a missing convenience, but DEC-21/QA-DEC-5 had accepted
  the ~182-marker first-upgrade flood **conditional on that mitigation being
  tested, not assumed**. The unfixed should-fix item was therefore silently
  voiding an *already-granted* risk acceptance upstream — a plan-level
  invariant, not a UI nicety. **Add to how-to-comply:** when triaging an
  unfixed finding, grep the decision log for the feature's name before
  assigning severity — an item that some earlier decision cited as *its own*
  mitigation is never a should-fix.

**2026-08-06, `intake/2026-08-05-coverage-on-demand/` (QA-fix build,
`2026-08-05-coverage-on-demand-qa-fix`) — the strongest confirmation yet, and
the shape is new: the QA fixes were themselves half-fixed, and the half that
was missing was in each case the half nobody had thought to mutate.** A
`team-qa` post-merge pass returned BLIND with three live defects (SF-6/8/9).
The fix build closed all three, `build-verifier` round 1 independently
mutation-proved every one of them and returned GREEN-WITH-CAVEATS — and
`build-reviewer` then returned **4 blockers, 2 of them proven live by its own
probes, against fixes two prior passes had certified**:

- **B1** — SF-8's fix (`useEffect(() => setCoverage(null), [projectId])`) cured
  the *already-landed* case and left the *in-flight* case live: switch A→B while
  A's `load()` is outstanding, A resolves late with a newer `computed_at`, the
  monotonic merge hands the header to A **permanently**. The exact leak SF-8
  names, with the more likely production trigger. Textbook §9.4 "correct for
  the caller that motivated it."
- **B2** — a parity guard's blind spot that generalizes. See the detector below.

**NEW DETECTOR — PARITY-WITHOUT-ANCHOR (cheap, run it on every parity guard).**
A guard asserting `deepEqual(sideA, sideB)` is **structurally incapable** of
detecting a drift applied identically to both sides. T7 (the SF-4 route↔route
composition guard) shipped with only `assert.deepEqual(postKeys, getKeys)`; the
task list had mandated a *second*, anchoring assertion against a literal closed
set, and only the first shipped. Both prior red-proofs (implementer and
verifier) mutated **one route at a time**, which the parity check does catch —
so both correctly reported red, and both were proving the wrong thing. The
reviewer added `bogusExtraKey` to *both* routes: **T7 stayed green.** Deleted
`requestedAt` from *both*: **T7 stayed green.** This extends §9.3's existing
"red-prove from BOTH sides" bullet, which is about mutating A and B
*separately*; the missing case is mutating A and B *simultaneously and
identically*. **Rule: every parity assertion needs an anchor** — `deepEqual(A,
B)` plus `deepEqual(A, <literal reviewed closed set>)` — and the red-proof set
for a parity guard is three mutations, not two: side A only, side B only, and
the matched pair. A parity guard with no anchor is a §9.3 vacuity waiting for
its first symmetric refactor.

**Second detector, reinforcing §9.3's "probe-mode fixtures narrow what a
mutation can distinguish": a fixture's *synchronization* narrows it too.** The
shipped SF-8 test fully `await`s project A before `rerender`ing to B, so it
cannot observe an in-flight response at all. The fix looked complete because
the test's timing had already excluded the failing state space. When a guard
covers an entity switch, a cache invalidation, or anything else where "when"
matters, **at least one case must hold a response open across the transition**
(manually-resolved deferred promises), or the guard only proves the quiescent
half.

**The headcount argument is now three-for-three, and this run makes it
strongest.** §9.3's 2026-08-05 note already recorded the standing
recommendation — *do not trim `build-reviewer` on this file family* — after two
consecutive efforts. This is the third, and the first where the reviewer's
catch was against a **fix round**, not an implementation round: the round that
is most often reviewed as a touch-up is the one where a careful, honest,
correctly-executed verifier pass proved insufficient twice over. `auto direct`
mode kept both `build-planner` and `build-reviewer` IN; four internal loop-backs
(implementer → test-author → verifier r1 → reviewer → test-author + implementer
→ verifier r2) were needed to reach real green. **Trusting round 1 would have
shipped a live cross-project data leak and a parity guard that cannot fail.**

**One thing this build got right that is worth copying: `build-implementer`
refused to touch two broken tests it found** (SF-6 case 2's fixture, which
resolved synchronously so its "not complete" precondition could never hold; and
a T7 guard that did not fire) and reported them instead of adjusting assertions
until they passed. Under §9.3 that adjustment is the tempting move and it is
how vacuities are born. Refusing is the correct behavior, and it cost one
loop-back to do properly — cheap.

**Residual, recorded because it is the same shape one level up:** B1's fix
(`currentProjectIdRef` request-generation guard) shipped **with no standing
test** — the reviewer's and verifier's proofs were both throwaway probes,
deleted after use, and the reviewer's explicit "add the missing test case"
instruction was not carried out. Disposed as test-debt in that intake's
`qa/decisions.md` §6.6 rather than dropped. **Add to how-to-comply:** when a
review blocker is proven with a throwaway probe, the probe is the test — the
disposition is "promote the probe," not "the fix is in." A deleted probe leaves
a fix nobody can regress against.

**2026-08-06, `intake/2026-08-06-auto-group-proposal/` (Value Pool Slice 3) —
BL-3, and it is the cleanest instance this entry has: the fix round cured the
*instances the verifier named* and left the *class* live, because nobody
looked for the root cause.** `build-verifier` round 1 found two new server
test files writing to the **real** `~/.claude/agent-dashboard/dashboard.db`
(the TEST-AGAINST-LIVE-DB candidate under §9.3, firing for real). Fix round 1
set `DASHBOARD_DB_PATH` in **those two files**, re-ran green, and reported the
class cured. `build-reviewer` then proved it was not: **two further files
still wrote production rows**, and the actual mechanism was upstream of all of
them — a **module-scope `require("../db")` singleton in
`server/lib/value-groups.js`**, which resolves the DB path at *module
evaluation time*, before any test body can set an env var. Setting the
variable inside a `beforeEach` is too late by construction. The real cure was
deleting the singleton (dependency now passed in) **plus** setting
`DASHBOARD_DB_PATH` at module-evaluation time, before any `require`, in every
consuming test file.

**Why this one is worth keeping, beyond being another tally mark:**

- **The fix round's own verification defined its own scope.** Round 1 fixed
  exactly the files named in the finding and re-ran the suite; the suite was
  green before, during, and after — as this entry's acceptance criterion has
  said since 2026-08-01. A finding is a **sample**, not a scope. **Add to
  how-to-comply: for any finding phrased "file X does Y," the fix round's
  first action is to grep the whole tree for Y and report the count, before
  fixing anything.** Here that grep is
  `grep -rln 'require(\"\\.\\./db\")' server/lib server/__tests__` and it
  would have returned the root cause in one command.
- **This class is invisible to every gate except a direct external check.**
  Nothing in the suite fails when a test writes real data — it passes
  *better*. The only reliable detector is the one this build finally adopted:
  **query the production DB for row counts in the new tables before and after
  every suite run, and put the numbers in the report.** Round 2 did exactly
  that (0 rows, confirmed after each run) and the final orchestrator pass
  repeated it. That check, not the green suite, is the evidence.
- **Promotion note for §9.3's TEST-AGAINST-LIVE-DB candidate.** Its recorded
  promotion trigger was *"(a) a second test file is found doing this, or (b)
  it actually fires."* **Both fired here** — four files, and real rows were
  written to the production DB during this build. The class-level cure that
  candidate recommended and that was declined twice (a global test-runner
  setup asserting `DASHBOARD_DB_PATH` is set and points under a temp dir)
  would have made all four impossible. It is still not built. This is the
  third recorded decline.

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
- Durable cure recommended 2026-08-02, **BUILT 2026-08-03** (see the
  build-outcome note below — the helper and the registry now exist; copy the
  helper, do not hand-roll a seventh site): one
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

**Build-outcome note (2026-08-03, `intake/2026-08-02-practice-kind-override/`,
commit `3b9769e` — the durable cure is BUILT; this entry's instruction changes
from "copy `agents`" to "call the helper").** `server/db.js` now exports/uses
`rebuildTableAtomically({ table, createSql, copySelect, indexes })`, with
`coach_observations` as its first call site: one `db.exec("BEGIN; CREATE TABLE
…_new; INSERT INTO …_new SELECT …; DROP TABLE …; ALTER TABLE …_new RENAME TO …;
COMMIT;")`, `PRAGMA foreign_keys = OFF/ON` issued outside it, indexes recreated
after. F2's orphan gate (`sqlite_master` for `<table>_old`/`<table>_new` → log and
`return false`, never throw) and the WATCH-3 pre-flight skip live in the helper,
so both are inherited by every future site instead of re-decided. D2's
`REBUILD_CASES` registry-completeness scan is in `db-migration.test.js`; it lit up
the five pre-existing non-atomic sites on first run and they are **grandfathered
with dated reasons, not waived** — the scan was not weakened and the five were not
retrofitted (still their own follow-up, still needing their own backup and crash
tests). **A third failure mode this entry had not named, added by adversarial
review as B3:** the helper's `execute()` had no error handling, so a genuine
mid-transaction failure (`SQLITE_BUSY` from a concurrent lock-holder, a CHECK
violation on a column the pre-flight scan doesn't inspect) would throw out of
`require("../db")` and brick boot for the Express server, MCP server, desktop app
and VS Code extension simultaneously — the exact blast radius this entry's "never
throw" bullet exists to prevent, reached by a path that bullet didn't cover.
Cured with `try { execute() } catch { rollback if db.inTransaction; log; return
false } finally { PRAGMA foreign_keys = ON }`, proven red by removing the
try/catch and observing an uncaught `SQLITE_CONSTRAINT_CHECK` escape `require()`.
**Add to this entry's how-to-comply: atomicity is necessary and not sufficient —
the rebuild must also be unable to throw, because the caller is `require()`.**

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

**2026-08-05, `intake/2026-08-05-coverage-on-demand/` — occurrence 7, on
`assertSingleHome`'s *other* hand-typed axis: the CONSUMER list.** The
derived-scope cure above fixed the **export** axis — `assertSingleHome` derives
which exports to check from the artifact itself. Its **consumer** scope is still
hand-typed. Slice 2 added `server/lib/value-coverage.js` as a third consumer of
`value-summary.js` (`const { MAX_UNITS_PER_PROMPT } = require("./value-summary")`),
while `single-writer-guard.test.js`'s `assertSingleHome("../lib/value-summary", …)`
still listed exactly two (`../routes/project-plans`, `../lib/value-summary-tick`).
Green suite, invisible consumer. **The aggravating detail: the same build edited
that same map in the same commit** (adding `SUMMARY_STAGES` to both existing
consumers' `absent` lists), so the author was inside the map and still did not
see that the map's own membership was stale — a hand-typed registry does not
prompt you to add yourself to it. Caught by the reviewer (SF-5), fixed in the
same change set.

**The generalizable half:** a guard with one derived axis and one hand-typed
axis reads as "derived" and is trusted as such. **Enumerate the consumer list
from the artifact too** — `grep` `server/lib` + `server/routes` for the module's
own import specifier and fail on any importer missing from the map, exactly as
`FILE_DISPOSITIONS` fails on an undispositioned file. Count 6 → 7; the cure
recommended at occurrence 6 remains half-built, and this is what the unbuilt
half costs.

**2026-08-05, same build, same axis, one layer down — N2, still OPEN (count
unchanged at 7; recorded by `team-qa` strategist post-merge because it is the
*same* defect as occurrence 7 in the *same* change set, not a new one).**
`value-coverage.test.js`'s i18n guard derives its scope correctly from the real
exported `DEMAND_STATES` / `ETA_STATES` registries — and then maps them through a
**hand-typed** `STATE_TO_LOCALE_KEY`, whose miss branch is `if (!key) continue;`.
So the derived axis makes the guard read as registry-complete while the
hand-typed axis fails **open**: a 4th `demand` or `eta.state` value (Slice 3
growth, WATCH-S2-F's literal trigger) ships with no locale key in any of the four
files and the suite stays green. One build, two instances, two layers: SF-5 on
`assertSingleHome`'s consumer axis (fixed), N2 on the locale-key axis (open).

**The sharper statement of this entry, earned here:** it is not enough for a
scan's *scope* to be derived — its **miss branch must fail closed**. A derived
enumeration that `continue`s past an unhandled member is a hand-typed scan
wearing a derived scan's clothes. Fix shape is already proven in this file
(§9.1's `UNCOMPARED_FIELD_GUARANTORS`, 2026-08-05): assert the exempt set is
**exactly** the reviewed list — `assert.deepEqual(exemptDemand, ["passive"])`,
`assert.deepEqual(exemptEta, ["none"])` — so registry growth breaks the test at
the point of growth until someone dispositions the new member. Two lines. Worth
landing before Slice 3 touches either registry rather than after.

**N2 CLOSED — correction recorded 2026-08-06 by `intake-project-manager` during
`intake/2026-08-06-auto-group-proposal/` (Value Pool Slice 3; count unchanged at
7).** The note above says N2 is open. **It is not, and has not been since
`5ec640b`** (the Slice 2 QA-fix commit): `server/__tests__/value-coverage.test.js:297`
now carries exactly the two-line cure this entry specified —
`assert.deepEqual(exemptDemand, ["passive"])` / `assert.deepEqual(exemptEta,
["none"])` — so the hand-typed `STATE_TO_LOCALE_KEY` axis fails **closed** at the
point of registry growth. Verified by direct read, not by the commit message.
**Recorded as a correction rather than silently edited, because the stale status
is itself an instance of this project's live recurrence:** a deferral whose
trigger nothing is obliged to check. Slice 3's intake had three chances to read
this file correctly and got one of three — it caught SF-4, re-argued a closed
decision (Slice 2 DEC-3 / OPEN-4) from code instead of citing it, and would have
re-done N2. **Standing instruction for this entry: a catalog row's status is a
claim about the tree, and it goes stale the moment a fix round lands. Re-verify
by direct read before acting on an "OPEN" marker.**

**Still live on this axis for Slice 3, and it is the reason the cure above must
be copied rather than admired:** WATCH-S2-F's literal trigger ("any Slice 3
growth of `demand`/`eta.state`") does **not** fire — Slice 3 grows neither. It
adds *new sibling registries at the same CJS/Vite boundary* instead
(`GROUP_RUN_STATES`, per-group `refinement_state`, `review_status`, and the
per-member availability states ruled in that intake's `pm-plan.md` PM-1), each
needing four locale files. A trigger written against two named registries cannot
see a third being born. Each new registry gets the anchored exemption-set
assertion **from day one**.

**QA-pass note (2026-08-06, `team-qa` strategist,
`intake/2026-08-06-auto-group-proposal/` — Value Pool Slice 3, PRE-build; count
unchanged at 7).** Slice 3 must register **one** new consumer
(`value-groups.js`) in **four** hand-typed places: `CONSUMERS`
(`value-ledger.js:70-74`), both `assertSingleHome` consumer maps
(`single-writer-guard.test.js` `:400` and `:462`), and — the one the technical
plan's own change-set table omitted — **`ledger-metrics-parity.test.js:281`
(C2.4)**, which `deepEqual`s `CONSUMERS` against a literal 3-entry array and
therefore goes red by construction. Confirmed live. That omission is this
entry's shape at the *plan* level: **a registry's anchor lives in a different
file from the registry, so the registration edit and the anchor edit are two
files no single obligation owns jointly** — identical to SF-5, where the author
was inside the map and still did not see its own membership was stale.

**New, and it changes what the fix must be: the registration `DEC-S3-10`
mandates is forbidden by `CONSUMERS`' own declaring comment.** That comment
(`value-ledger.js:64-69`) states the growth rule *"grow this list ONLY when the
new consumer reads `computePlanHealth`/`assembleValuePool`/
`summarizeDeliveredValue` directly"* — and `DEC-S3-10` rules that
`value-groups.js` **never calls `assembleValuePool`** (route handlers pass
`units` in); it calls `unitKey` and nothing else. Over-registering is a
defensible call, but as planned the registry's membership would falsify the
registry's own comment. Per §9.1's standing check this is the **fourth
consecutive build** in which an unevidenced invariant claim in a header marked
the exact spot the invariant fails. **Ruling: the growth rule is widened in the
same commit as the 4th entry, and C2.4's failure message updated to match.**

**Good news, both verified by direct read this pass, and worth recording
because this entry's notes have twice gone stale in the other direction:**
`FILE_DISPOSITIONS` in `chronology-ordering.test.js` genuinely fails closed
(throws at `:243` on an undispositioned file, at `:249` on a stale entry), and
N2's cure is confirmed landed at `value-coverage.test.js:297`. Both are the
working shape.

**The cure this entry has recommended since occurrence 6 remains half-built,
and Slice 3 is the strongest forcing function it will get.** Build
`assertConsumerScopeDerived(modulePath)` **once**, generically — enumerate the
consumer list from a grep of `server/lib` + `server/routes` + `bin/` for the
module's own import specifier, fail closed on any importer missing from the map
— and point all four registrations at it, including `CONSUMERS`, whose own
completeness has never been guarded by anything. ~40 lines, and both
constituent patterns already exist in this tree (`FILE_DISPOSITIONS`' miss
branch; the anchored exemption-set assertion). This is copying two working
local patterns, not inventing one. Escalated to Sara as an open decision;
declining means a 5th hand-registration in Slice 4.

**BUILD OUTCOME (2026-08-06, `effort/2026-08-06-auto-group-proposal`) — the
cure recommended since occurrence 6 is BUILT, and the same build produced a
fresh occurrence anyway (count 7 → 8).**

**The good half, and it should be read as such: `assertConsumerScopeDerived`
exists.** Built generically in `server/__tests__/helpers/single-home.js`,
enumerating each module's importers from the tree rather than from a hand list,
**failing closed** (throws — never `continue`) on any importer missing from the
map, and wired to all four registration points (`value-coverage-probe`,
`value-groups`, `value-ledger`, `value-summary`). Red-proven the only way that
counts: an undisposed importer was injected and the helper was observed to
throw. Four builds of recommending it, one build of writing ~40 lines.

**The occurrence — BL-14, and it is this entry's thesis stated three times in
one diff.** Three separate structural guards in the same change set each
enumerated their own blind spot, and each blind spot was *the exact shape the
guard existed to catch*:

- **G-2** guarded the SF-4 extraction by **counting** `buildProbeCoverage`
  call sites. An inline hand-copy calling `enrichPoolAltitudes(` /
  `coverageSnapshot(` directly — i.e. **the thing SF-4 was extracted to
  prevent** — leaves the count untouched and is invisible. Cured by
  brace-walking all four coverage-composing handler bodies and asserting
  **zero** occurrences of those two calls inside each.
- **N-1** scanned `value-groups.js` only, so the route handlers — the other
  half of the surface — were unscanned. Cured by scanning both, reusing G-2's
  brace-walker, **and deleting its `if (!fs.existsSync(...)) return` escape
  hatch**, which had made the whole guard fail-open on a path typo.
- **N-3** proved `claimed` is unreachable (DEC-S3-8) with an
  **assignment-form** regex, while this codebase's real write shape is
  **argument-form** (`stmts.setValueGroupReviewStatus.run("claimed", …)`).
  The guard was blind to the only way the value could actually be written.
  Cured by matching both forms.

**The sharper statement this build earns: a hand-scoped guard's blind spot is
not random — it is the *idiom the author was not thinking in*.** G-2 thought
in call counts and missed inlining. N-1 thought in modules and missed routes.
N-3 thought in assignments and missed arguments. In all three the author knew
the risk by name and wrote a real, red-provable, correct-for-its-scope guard.
**Detector, and it is a question, not a grep: for every structural guard, name
the *other syntactic form* the same write/call could take in this codebase,
and assert against that form too — or state in a comment why it cannot
occur.** Both cures here (brace-walking to a body, matching both call forms)
already existed in this tree; neither is invention.

**Also confirmed live this build, and it is the reason "derived" is not a
synonym for "safe":** `assertConsumerScopeDerived` — this entry's own generic
cure — ships with a **hand-typed `defaultScanTargets`** (`server/lib`,
`server/routes`, `bin`, `server/index.js`). `mcp/src`, `scripts/` and
`desktop/` are unscanned. A hand list inside the helper built to cure hand
lists, one layer further out. Disposed as SF-12 in that intake's
`decisions.md` rather than dropped, because widening it is a real scope
question. Recorded here so the deferral has a trigger: **the first consumer of
any of these modules added under `mcp/src`, `scripts/`, or `desktop/` is
unregistered and undetected.**

### 9.8 OVERLOADED-ABSENCE (distinguishable outcomes collapsed into one absent value)

**PROMOTED from candidate to a numbered entry 2026-08-04** by `team-qa`
`qa-strategist` during `intake/2026-08-04-value-summary-tick/`. Originally recorded
the same day by the PM with an explicit promotion trigger (see "Trigger, and why it
fired" below). Adjacent to §9.1 but **deliberately not filed under it** — see the
discrimination test below.

**The shape:** a module written to the (correct, house-standard) rule *"never throws,
never blocks — return null/empty on any unavailability"* encodes several genuinely
distinguishable outcomes — **not-yet-attempted**, **over-budget-this-round**, and
**permanently-failed** — as the *same* absent or empty value. The rule is right; the
implementation of the rule destroys information. No consumer can tell transient from
terminal, so the UI cannot render an honest state, and no operator can tell a backlog
from an outage. The suite stays green because every test asserts the documented
contract, and the documented contract is the defect.

**Live evidence (both verified by direct read, 2026-08-04):**
1. `server/lib/value-summary.js`'s `enrichPoolAltitudes` — its own JSDoc states *"A unit
   absent from the result means no altitude could be produced this round (LLM
   off/unavailable, spawn failure, or unparsable output)"*, **plus** over the
   `MAX_UNITS_PER_PROMPT = 40` cap, **plus** simply not attempted yet. Five states, one
   wire representation. This is the entire content of the `value-summary-tick` request:
   the user cannot distinguish "still generating" from "unavailable."
2. `server/lib/reconciliation.js`'s `parseDispositionOutput` — ends in
   `catch { return new Map(); }`, **silently**. An empty map means both "nothing to
   disposition" and "the whole tick's verdicts were voided by one oversized prompt."
   Already documented from a different angle under SHARED-BUDGET-STARVATION (§9.6);
   recorded here because the *observability* failure is the same one, independent of the
   budget cause.

**How it gets written (both instances):** the bounded/never-throwing contract is copied
from a sibling that solved the same problem more completely, and the half that made the
sibling honest is dropped. `focus-summary.js` caps too — but it also **decomposes**
(hierarchical per-day synthesis above `DIRECT_WINDOW_MAX_DAYS`, so no cap ever drops a
whole day) and **discloses** ("earlier ones dropped with an explicit note").
`value-summary.js` copied the cap and its rationale comment verbatim, and neither of
those two.

**Discrimination test — when this is NOT §9.1.** §9.1's criterion is *"same field, same
value, across every consumer."* Apply that here and it is meaningless: there is no single
value multiple sites should agree on. Filing this under §9.1 and "fixing" it by extracting
a shared helper would leave the ambiguity entirely intact. Same reasoning that retracted
the trunk-drift pre-flag on 2026-08-02 — ask first whether a single correct value exists.

**Cure (recommended, not yet built):** a per-item **discriminated state** on the wire —
at minimum `queued` vs. `unavailable-retrying` vs. `resolved` — never a heuristic
reconstructed on the client from what is missing. Raising the bound is not a fix: it moves
the threshold and preserves the ambiguity. Corollary worth applying independently: **any
bound on a user-visible collection should cite, in its own declaring comment, the measured
real distribution it was sized against.** `MAX_UNITS_PER_PROMPT = 40` was declared with
*"Pool batches are small in practice, so overflow is expected to be rare"* one day after
`intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md` DEC-12 recorded a signed-off
**182-unit** live pool. A comment forced to name the number could not have been written.

**Trigger, and why it fired (2026-08-04, `qa-strategist`).** The written trigger was
*"(a) a third surface is found collapsing distinguishable outcomes into one absent/empty
value, or (b) one of the two instances above is shown to have misled a real diagnosis."*
Both clauses are met, on evidence, and neither rests on the weak argument that a second
team member read the same file — re-encountering a known instance is **not** an
occurrence, and this entry should not be counted that way in future:

- **(b), decisively.** `intake/2026-08-04-value-summary-tick/request-brief.md` exists
  *because* instance #1 misled a real diagnosis: a 182-unit backlog was
  indistinguishable from an outage, so the reasonable read of a half-empty Value Pool
  was "this is broken," not "this is still working." The user's own diagnosis was the
  one misled. That is the clause, satisfied literally.
- **(a), twice, and from inside this pattern's own cure — which is the strongest
  available evidence that it generalizes.** That intake's `risk.md` found two further
  surfaces collapsing distinguishable outcomes: **Trap E**, the client's
  `AltitudeText` fallback, which renders "old server that predates `states`" and
  "new server sending a malformed/out-of-registry `states` value" identically, so a
  real server regression is invisible; and **Trap C**, `pending_after_sweep`, a single
  number that cannot distinguish "draining toward zero" from "treading water" for a
  project whose pool grows between sweeps. Both were introduced by the change written
  to cure instances #1 and #2. Compare §9.7's own argument for itself ("the failure
  survives even in the build that builds the cure") and §9.1's 2026-08-03 note ("this
  entry's own lesson landed a third time anyway").

**Acceptance criterion.** For any module under the never-throws/never-blocks contract:
each genuinely distinguishable outcome must be representable on the wire, and a
consumer must never be asked to reconstruct *why* something is absent from *what*
is absent. Concretely — every item submitted lands in **exactly one** bucket, never
zero and never two; "not attempted yet," "over budget this round," and
"attempted and failed" are different values; and any single number reported as
progress must be **re-derived from the live input each round**, not decremented,
or it silently becomes another collapsed absence. Prove the "never zero" direction
explicitly: it is the one that a naive "no key appears in both maps" check misses.

**How to comply.**
- Return a discriminated per-item state, not a sparse map plus a JSDoc paragraph
  explaining the five things an absence might mean. Raising the bound is not a fix:
  it moves the threshold and preserves the ambiguity.
- Test the **combination**, not the two branches separately. The
  outage-vs-backlog conflation only reproduces when the item is *both* over-cap
  *and* the LLM path is down; a suite with one test per branch passes while the
  "cap first, then gate" ordering bug ships. (`intake/2026-08-04-value-summary-tick/`
  got this right — copy its DEC-11 truth table shape.)
- When copying a bounded/never-throwing contract from a sibling, copy the halves that
  made the sibling honest too — `focus-summary.js` **decomposes** (hierarchical
  per-day synthesis, so no cap ever drops a whole day) and **discloses** ("earlier
  ones dropped with an explicit note"). Both live instances copied the cap and the
  rationale comment and neither of those.
- **Any bound on a user-visible collection must cite, in its own declaring comment,
  the measured real distribution it was sized against.** `MAX_UNITS_PER_PROMPT = 40`
  was declared with *"Pool batches are small in practice, so overflow is expected to
  be rare"* one day after `intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md`
  DEC-12 recorded a signed-off **182-unit** live pool. A comment forced to name the
  number could not have been written.

**Still-open instances at promotion time (2026-08-04):** #2 (`parseDispositionOutput`'s
silent `catch { return new Map(); }`) is **unfixed** — tracked from the budget angle
under §9.6's SHARED-BUDGET-STARVATION candidate. Traps C and E above are unfixed and,
as of the QA pass, carried no `decisions.md` row either. Remaining unexamined
candidates, all sharing the never-throws contract: `focus-inference.js`'s
`parseLlmOutput`, `focus-audit.js`, and any future `runClaudePromptJson` consumer.

**BUILD-PHASE CONFIRMATION, 2026-08-04 — `intake/2026-08-04-value-summary-tick/`
(the cure is BUILT for instance #1, and the entry is now proven out through a
real build with real bugs caught at every layer it predicts; count unchanged —
this is the same instance closing, not a new one).** Promoted from candidate
during that intake's `team-qa` pass on argument alone; this is the build that
tested the argument. `enrichPoolAltitudes` now returns
`{ altitudes, states }` with a discriminated per-unit state
(`queued` = known, not attempted this round; `unavailable` = attempted, produced
nothing), exported as `ALTITUDE_STATES`, forwarded unchanged by
`POST /api/project-plans/altitudes`, and rendered distinguishably by
`PlanLedgerPanel`. The i18n obligation is closed *mechanically* — a server-side
check derives its scope from the `ALTITUDE_STATES` export and `i18n.test.ts`
E1.1 propagates it to all four locales. Raising the bound was never on the
table; the bound is unchanged at 40 and the overflow is now **reported** and
then **drained** by a background sweep, which is the "decompose and disclose"
half this entry says both live instances dropped when they copied
`focus-summary.js`'s cap.

**The predictive claim held, three times, in the build written to cure it.**
This entry's own argument for itself was that the failure survives even in the
cure. Adversarial review and verification found exactly that, at three
different layers, and **both halves of the acceptance criterion — "never zero"
and "never two" — were violated inside the change enforcing them:**

1. **"Never zero," at the observability layer (B2, blocker).** An errored sweep
   ran its bookkeeping with every counter still at its initializer, writing
   `pending_after_sweep = 0` — the most optimistic possible value — and
   **overwriting** the last good sweep's count. A project whose
   `assembleValuePool` throws every cycle (moved repo root, git lock) would
   report "fully drained" forever, with no `outcome` column on
   `value_summary_sweep_state` to tell it apart. This is verbatim this entry's
   *"any single number reported as progress must be re-derived from the live
   input each round … or it silently becomes another collapsed absence"* — and
   WATCH-8's instrument failing in the one direction WATCH-8 exists to prevent.
   The T-C test could not see it: T-C exercises only the happy path. Cured with
   a second prepared statement (`upsertValueSweepStateKeepPending`) whose SQL
   has **no `pending_after_sweep` clause at all**, so the error path is
   *structurally* unable to touch it — inapplicability over compliance, per
   §9.6's 2026-08-02 lesson. The bare `catch {}` was also bound and made to log.
2. **"Never zero," one layer *above* the two states being discriminated (S3).**
   A unit rejected by the route's own sanitizing loop (unrecognized
   `value_source`) never reached the composer, so its key appeared in
   **neither** `altitudes` nor `states` — and because `requestedAltitudesRef`
   marks it already-requested, it rendered *"Generating…"* forever with no
   retry. **The same diff's brand-new `api.ts` JSDoc asserted "never both,
   never neither."** The contract was false at the route the day it was
   written, and the test that would have exercised that path had been deleted
   in the same diff. Cured by marking route-dropped keys `"unavailable"`. The
   one irreducible case — a unit with no usable `unit_key` — genuinely has no
   representable slot in a key-indexed map, and is documented as scoping rather
   than papered over.
3. **"Never two" (S6).** A duplicate `unitKey` straddling the 40-unit cap
   landed in **both** maps (`queued` from the overflow copy, resolved from the
   in-batch copy; the reconciling loop only ever *added* `unavailable`, never
   cleared a stale `queued`). Not reachable from the tick — `assembleValuePool`
   dedupes — but the route accepts caller-supplied arrays. Cured with one line
   (`[...new Map(misses.map(u => [u.unitKey, u])).values()]`) placed *before*
   the LLM-availability gate so the outage rule still applies to the deduped
   set.

**Two lessons to carry:**
- **This entry's "prove the never-zero direction explicitly" instruction earned
  its place.** Both #1 and #2 are never-zero failures, and the naive "no key in
  both maps" check misses both. The build's DEC-11 truth-table Case 5 got this
  right (`altKeys.size + stateKeys.size === submitted.length`) — but only *at
  the composer*. The two failures landed at the **route** and at the
  **sweep-state table**, i.e. at the seams the composer's partition test cannot
  see. Extend the "exactly one bucket" assertion to every layer that can add or
  drop an item, not just the one that computes the buckets.
- **The DEC-11 truth table is the reusable artifact.** This entry already says
  "copy its shape"; confirmed at build. The combination case (over-cap **and**
  LLM down) is the one that catches a "cap first, then gate" ordering bug, and
  the shipped code gets the order right — `llmAvailable()` runs *before* the
  slice, so an outage marks every miss `unavailable` including over-cap ones,
  pinned at the composer (Case 3), the route (Case B) and the client (the
  45-unavailable render test).

**Design-time pre-flag (2026-08-04,
`requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/`
— NOT an occurrence, count unchanged).** This entry's live instance #1
(`enrichPoolAltitudes`) returns for the *other* half of its problem: not
which absence, but which *staleness*. The generalizable addition is the
**invariant sibling** of this entry's existing bounds rule. Today it says a
bound must cite the measured distribution it was sized against; add: **a
cache/immutability claim must enumerate the input set it is a claim about,
and name the single function that computes that set.**
`value_unit_summaries`' schema comment ("a unit's ground fact — a commit's
subject line, an intake slug — is immutable once seen, so there is nothing
to invalidate") was true of the two fields it names and false of the three
`buildPrompt` actually renders, because `u.stage` was never enumerated.
Same mechanism as `MAX_UNITS_PER_PROMPT = 40` one day earlier, one class
over: an unevidenced **invariant** rather than an unevidenced **bound**,
falsifiable at the moment of writing from code thirty lines away. A comment
forced to enumerate `{value_source, label||value_ref, stage}` could not
have concluded "immutable."

---

**QA-pass note (2026-08-05, `team-qa` strategist,
`intake/2026-08-05-coverage-on-demand/` — the very next build on this surface;
count unchanged, this is the same family closing one half and leaving the
other).** Slice 2 built two closed, server-authored registries specifically to
satisfy this entry — `demand` (`passive`/`requested`/`draining`) and `eta.state`
(`measured`/`estimating`/`none`) — and the **state-shape** half held: SF-3 (the
`draining` value being unreachable from either HTTP route) was found in review
and **fixed**, `isDrainingProject` is threaded into both handlers.

**What did not hold is one layer over, at the BROADCAST-TRIGGER, and it is this
entry's own "never zero" direction: SF-6, still open at `4c2e931`.**
`shouldBroadcastCoverage(projectId, generated, demand, complete)` computes
`const transitioned = !!prior && (prior.demand !== demand || prior.complete !==
complete)`, so a project's **first observation in a process lifetime is
structurally incapable of being a transition** — and with `generated > 0` as the
only other trigger, a first-observed terminal `complete` (post-restart drain
resume, or a pool completed by `POST /altitudes` between ticks) is **silently
dropped from the wire**. An open tab freezes at its last percentage forever: no
error, no retry, no signal. That is precisely a distinguishable outcome
("finished") collapsed into the same absence as "nothing happened," and it
directly undermines AC-5, the acceptance criterion the whole slice exists for.
Every existing broadcast-widening test seeds `lastBroadcastState` via a prior
tick first, so **the suite structurally cannot observe the case**.

**Two things generalize:**

1. **A registry closes the state *shape*; it does not close the *delivery* of a
   state.** This entry's tests have all lived at the layer that computes the
   buckets. SF-6 lives at the layer that decides whether to *send* one. Extend the
   "never zero" question to every gate between the computation and the consumer —
   the trigger predicate, the transport, the client's merge rule — not just the
   producer. (The 2026-08-04 build's own lesson said this about layers that *add
   or drop items*; add: layers that decide whether to *emit*.)
2. **The tell was in the comment again, and it is checkable again.**
   `shouldBroadcastCoverage`'s header claims it *"can only ever SUPPRESS, never
   fabricate."* That is false as written — suppressing a terminal transition is
   the whole defect. Per §9.1's standing check (*"when a cure's header says
   'cannot,' find the loop that proves it or downgrade the comment"*), this is the
   third consecutive build in which an unevidenced invariant claim in a header
   comment marked the exact spot where the invariant fails. **Standing check,
   now cheap enough to be routine: grep new/changed headers for "never", "can
   only", "impossible", "always" — each is a test someone has not written yet.**
   Required assertion here: `shouldBroadcastCoverage(pid, 0, "passive", true)`
   with `lastBroadcastState` empty must return `true`, plus the negative case
   (first observation, not complete → no broadcast) to bound the fix.

**QA-pass note (2026-08-06, `team-qa` strategist,
`intake/2026-08-06-auto-group-proposal/` — Value Pool Slice 3, PRE-build; count
unchanged).** Slice 3 lands three orthogonal axes of this entry at once (5 run
states / 4 refinement states / 3 member-availability states). The reusable
artifact this pass produced is the **reconciled combination-table row set**, and
the reason it needed reconciling is itself this project's recorded meta-failure.

`technical-plan.md` mandated **one** row; `unit-tests.md` designed **six** (a–f);
`risk.md` named **three** more. Reconciled to **nine**, plus one read-side case:

- One of `risk.md`'s three (complete coverage + prior `failed` + re-request →
  *fresh* attempt) was **already** `unit-tests.md`'s row c — two documents
  independently specifying the same row, neither aware.
- One (`completed_zero_groups` + digest match → `reused_unchanged`) was named in
  `risk.md` §4.1 and **fell out of `risk.md`'s own §6 tracked-artifact list** —
  i.e. *"named by the risk analyst, adopted by neither architect, and the
  WATCH-row fallback also didn't happen"* (§9.1's 2026-08-02 note) recurring
  **inside the QA pass whose job was to prevent it**. Adopted, not dropped.
- `unit-tests.md`'s deferred candidate conflated two routes: it reasoned about a
  `GET /groups` poll but proposed a `POST /groups/propose` table row, where
  §7's own ordering (gate at step 2, `in_progress` at step 3) makes it assert
  the opposite of the plan. Split: relocated to a read-side case, and its
  ordering concern promoted to its own propose-table row.

**Three rows added beyond the six, all of them branch-*ordering* seams — the
"cap first, then gate" shape this entry's own worked example names:** (g)
`in_progress` **and** a matching digest → `already_running`, proving step 3
precedes step 4 and no second spawn ever fires; (h) digest match against
`completed_zero_groups` specifically, since that is the state most likely to be
conflated with "not attempted" and seeding only a `completed` fixture leaves the
more dangerous half of the `OR` untested; (i) `in_progress` **and** incomplete
coverage → 409, pinning the gate-vs-`in_progress` ordering, with the same test
asserting `GET /groups` still reports `run.state === "in_progress"` — two
both-true facts that must never collapse into one field. **Generalizable
addition to this entry: a suite organized one-test-per-branch is structurally
incapable of containing a seam *between* branches; enumerate the orderings the
handler's own step list creates, not just the states its registry declares.**

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

**Scope limit found 2026-08-04 (`altitude-invalidation`):** the mount↔path scan is
derived from `app.use("/api/…")` mounts, so a NEW route under an ALREADY-documented
mount (`POST /api/project-plans/altitudes/seen`) is structurally invisible to it —
§9.7's shape inside this candidate's own cure. This slice declined the OpenAPI
fragment (DEC-19, QA-DEC-3) — `docs/API.md` documents the endpoint instead — so
`openapi.yaml` and `openapi-contract.test.js` both stay silent over the omission.
Count unchanged (pre-flag, not an occurrence; neither promotion trigger is met).

---

### Candidate new pattern, NOT yet catalogued — STRICTMODE-BLIND CLIENT SUITE

Recorded with an explicit promotion trigger, same convention as
CWD-IDENTITY-FANOUT above. **First occurrence, and it fired** — this one is not
theoretical.

**The shape:** `client/src/main.tsx:98` wraps the app in `<StrictMode>` and
`client/package.json` pins `react ^18.3.1`, so **in `npm run dev` React runs
every effect setup → cleanup → setup**. React Testing Library renders **without**
`StrictMode`. Therefore an entire class of double-invoke defects — refs and
module-scope state armed once at creation and disarmed by a cleanup that the
second setup never re-arms, subscriptions/timers/aborts created twice,
idempotence assumptions in effect bodies — is **structurally invisible to this
project's client suite**. Not "untested": *unobservable*. `npm run test:client`
can be 817/817 green over a panel that renders nothing in dev.

**How it fired (2026-08-05, `intake/2026-08-05-coverage-on-demand/`, review
blocker BL-2).** `PlanLedgerPanel.tsx` replaced a StrictMode-correct per-effect
`let cancelled = false` local with a shared `const mountedRef = useRef(true)`
plus a **cleanup-only** effect:

```ts
const mountedRef = useRef(true);
useEffect(() => () => { mountedRef.current = false; }, []);   // never re-armed
```

Under StrictMode the second setup returns a fresh cleanup but never restores
`true`, so `mountedRef.current === false` from first paint for the component's
whole life. Consequences in dev: `fetchAltitudesFor(...).then/.catch` both
early-return ⇒ `setAltitudes` never called ⇒ **no unit ever renders its
PROJECT/STAKEHOLDER text — the entire point of Value Pool Slices 1–2** — and
`handlePrioritizeNow`'s `finally` never clears `requestingCoverage` ⇒ the
"prioritize now" button is **permanently disabled after one click**. Two
independent verification passes (one of them a six-mutation injection pass) and
a full green client suite saw none of it. It was caught by a human-style read of
the diff against `main.tsx`, and only because the reviewer went looking for
what the suite *cannot* see.

**Why the cheap fix is not the cure.** The build added one regression test that
renders this panel inside `<StrictMode>` (red-proven against the un-re-armed
ref). That closes this component. The **class** stays open for every other
component, and the next `useRef`/`useEffect` refactor reintroduces it with a
green suite.

**Cures worth considering when it is promoted** (cheapest first): wrap the
shared render helper in `client/src/test/` so *every* RTL render runs under
`<StrictMode>` (expect a first-run red set — per §9.3's own history, a parity
check that goes red for legitimate reasons on day one gets weakened, so triage
the initial failures deliberately rather than reverting); or a lint rule /
structural guard rejecting `useRef(true)` + cleanup-only `useEffect` on the same
ref; or, narrowest, require any effect that flips a ref in cleanup to set it in
setup.

**Promote to a real catalog entry the first time either (a) a second
StrictMode-only defect is found in any client component, or (b) a
double-invoke bug reaches Sara's running dashboard.** Until then, anyone
touching `useRef`/`useEffect` in `client/src/components/` should read this and
check the setup body re-arms whatever the cleanup tears down.

---

### Candidate new pattern, NOT yet catalogued — MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH

Recorded 2026-08-05 by `team-qa` `qa-strategist` during
`intake/2026-08-05-coverage-on-demand/` (Value Pool Slice 2), with an explicit
promotion trigger — same convention as CWD-IDENTITY-FANOUT / CONTRACT-SPEC-DRIFT /
STRICTMODE-BLIND above. **First occurrence, and it fired: the defect is live on
`master` at `4c2e931` (SF-8), with both suites 100% green over it.** Registered
because the risk pass correctly flagged that no existing id owns this shape:
§9.1 is about two *computations* of one value; §9.8 is about one *value*
overloading several outcomes; this is about one value being compared against a
value from a **different logical entity**.

**The shape:** a component (or cache, or reducer) holds state for one entity,
guards that state with a **monotonicity / staleness rule** — *accept `next` only
if it is newer than `prev`* — and is then reused for a **different entity**
without the state being reset, because the identity it is scoped to is a prop or
key the guard never reads. The comparison silently changes meaning from *"is this
a fresher view of the same thing?"* to *"is this thing newer than that unrelated
thing?"*, and the correct answer to the second question is meaningless. **The
correctness guard becomes the leak mechanism**, and it leaks in the worst
direction: it can *permanently* reject the new entity's legitimate data, so the
defect does not self-heal and shows no error.

**Live evidence (verified by direct read, 2026-08-05):**
- `client/src/components/PlanLedgerPanel.tsx:71-78` — `mergeCoverage(prev, next)`
  returns `next.computed_at > prev.computed_at ? next : prev`. It compares
  `computed_at` and **nothing else**; `CoverageSnapshot` carries a `project_id`
  the merge never reads.
- The rule is *correct for its stated purpose* and is mutation-proven for it (R4:
  an out-of-order HTTP/WS delivery must not visibly regress progress). It is not
  a sloppy guard — it is a good guard with an unstated precondition.
- `client/src/pages/ProjectDetail.tsx:1292` renders `{id && <PlanLedgerPanel
  projectId={id} />}` — **unkeyed**. React reuses the instance and its state
  across a project switch. There is no `useEffect(() => setCoverage(null),
  [projectId])`, and `load()` itself routes the *new* project's fresh HTTP
  response through `mergeCoverage`.
- Net effect: switch from project A to project B where A's snapshot happens to
  have a later `computed_at`, and B's real snapshot is rejected — by the initial
  fetch **and** by every subsequent broadcast until one arrives with a later
  timestamp than A's. **Project A's "N of M described" renders under project B's
  pool**, indefinitely, with no error state. A user can click "prioritize now" or
  trust a completion percentage on another project's numbers.

**Why it will repeat rather than being one bug:** the precondition is a
*convention*, not a mechanism. Nothing in this repo asserts "a component's state
belongs to the entity it was mounted for" at any layer — no test anywhere mounts
a component, changes its entity-id prop, and asserts the state followed. So
**every future field `PlanLedgerPanel` gains inherits the same leak** (its
`altitudes` and `requestedAltitudesRef` already do), and any other component
taking an entity id inherits it on the day it gains its first cross-render guard.
The two ingredients are individually normal and individually reviewed as
correct — an unkeyed child, and a staleness comparison — which is why review
caught this one only by tracing them together.

**Discrimination test (do not file the next instance under §9.1 or §9.8):** ask
what the comparison's operands are. Two derivations of one value → §9.1. One
value standing for several distinguishable outcomes → §9.8. Two values that are
each correct for a *different entity*, compared as if they were the same
entity's → **this pattern**.

**Cures, cheapest first:** (a) reset entity-scoped state on the id change
(`useEffect(() => setX(null), [entityId])`) — preferred over keying the component,
because keying also discards unrelated caches and does not stop the *next* state
field from inheriting the bug; (b) make the guard itself identity-aware —
`mergeCoverage` accepts unconditionally when `next.project_id !==
prev.project_id`, which fails safe by construction; (c) the durable one — a
shared `useEntityScopedState(entityId, initial)` hook, or a structural/lint guard
rejecting a `useState` holding entity-scoped data in a component that takes an
entity-id prop with no matching reset effect; (d) the cheapest first step, worth
adopting regardless of promotion: a **standing test convention** that any spec
file for a component taking an entity-id prop must carry one *"switch the id,
assert the state followed and the old entity's values are gone"* case.

**Promote to a real catalog entry the first time either (a) a second
entity-scoped state leak is found in any component or server-side cache, or (b)
this one is shown to have misled a real decision in Sara's running dashboard.**
Until then, anyone adding a cross-render comparison (`>`, `newer`, `Math.max`,
"only accept if changed") to component state should read this and check what
identity the two operands belong to.

---

## Planning notes for `team-intake` / `team-qa`

### Intake throughput can outrun build throughput, and the working tree pays for it

**2026-08-05, `requests/2026-08-04-value-pool-grouping/`** (applied on the
`effort/2026-08-05-coverage-on-demand` branch per that intake's DEC-11 / PM-5,
verbatim from `pm-plan.md` §PM-5).

Slice 1 was intaken 2026-08-04 with six documents and zero lines of code; Slice
2 was intaken 2026-08-05 on top of it, also with zero lines of code, while the
*previous* effort's merged work existed locally only as an unlabelled
~2,000-line staged diff on a `master` that was 6 ahead / 2 behind origin. The
concrete cost landed inside the intake itself: Slice 2's `DEPENDENCY-F1` was
written on the factually wrong premise that the staged diff was Slice 1's build,
and was corrected only because two agents independently checked live git instead
of reading the decision row. A working tree ambiguous enough to make a careful
reader wrong is a project risk, not a housekeeping issue. **This is the known
"capability ships with nothing recording it" thread (recorded 3×, adopted 0×)
running in reverse — the record shipping with no capability.** Cheapest durable
rule, and the only one this project has evidence of being able to adopt: **do
not intake slice N+1 of a multi-slice request until slice N's build has
landed.** The existing worktree / `ps` / `lsof` guidance stays necessary and is
demonstrably not sufficient.

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
