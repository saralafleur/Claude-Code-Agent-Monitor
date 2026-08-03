# QA Assessment — plan-lifecycle-value-ledger

> Authored by `qa-strategist` (team-qa, auto-pilot), 2026-08-02. **This is the
> document to read first.** It answers: is the planned coverage adequate, where
> are the gaps, have we shipped this *class* of gap before, and how do we stop it.
>
> **PRE-BUILD.** None of the change exists in the tree. The verdict below is
> about whether the **planned** test obligations — as designed by the four
> evaluators — would actually guard the planned change, and what today's
> baseline means.

---

## Change summary

This build adds a portfolio layer beside (never inside) the existing plan
surface: three new SQLite tables (`project_plans`, `project_plan_items`,
`value_claims`), one shared computation module (`server/lib/value-ledger.js`), a
cwd canonicalizer (`cwd-identity.js`), a lifecycle module (`plan-lifecycle.js`),
a new `/api/project-plans` namespace, a `ccam ledger` CLI, and — only after
Sara's slice-4 "signal or noise?" gate — a `PlanLedgerPanel` in Project Detail.
It answers "what value did this project deliver, and did we clear the
milestone?" by importing each existing `AGENT-PLAN.md` as generation 1, deriving
an unclaimed-value pool from intake scans / trunk commits / detours, and letting
Sara *claim* units into plan items and *close* plans. Nothing existing changes:
zero `ALTER TABLE`, zero rebuilds, five named modules untouched, `/api/plans`
and the `plan_updated` WS payload frozen.

---

## Coverage verdict

**GAPPED — and one escape hatch away from BLIND.**

*Why not ADEQUATE:* trivially, every surface of this change is UNGUARDED today
because it does not exist. More usefully: four real obligations that the risk
analysis or the live tree names are covered by **no planned test in any of the
four documents** — cross-seam `unitKey` agreement, the OpenAPI/contract-doc
surface (which carries a live `operationId` collision), the DEC-4 dedupe
fixture's schema block, and whole-namespace locale key parity.

*Why not BLIND:* BLIND is reserved for "lands squarely on a known recurring
failure mode **with no guard**." This change lands on the two most-touched
entries in the catalog (§9.1, 5 touches; §9.7, now **6 occurrences** — and its
`assertSingleHome` cure was built, and red-proven twice, by the trunk-drift
build *while this QA pass was running*) — but in both cases the cure is **specified as a named, dated
deliverable with a filename and a written red-proof procedure** (DEC-5 + T6
`ledger-metrics-parity.test.js`; DEC-9 + the derived `filesToScan` scope). This
is the strongest pre-build plan this project has produced across its four QA
cycles: it names the per-shape parity spec that the catalog's own notes say
"never gets written," it derives two structural scans' scopes from real
artifacts instead of typed names, and it makes registration a numbered build
step rather than a hope.

*The escape hatch:* **DEC-9's "bounded fallback"** permits landing
registration-only (four files added to the hand-typed list) and deferring the
derived-scope cure. If the build takes that path, §9.7 recurs for the 7th time
on a build that could instead have been its second clean call site, and every
§9.2 obligation inside
`value-ledger.js` is unenforced while the suite is green and the DoD shows a
tick. The fallback needs a forcing function: **it may only be taken with a dated
`decisions.md` row naming the pre-existing violator set** — never as the silent
default under schedule pressure.

*One regression-of-a-fix to watch:* `single-writer-guard.test.js` +
`reconciliation-full-tick.test.js` Scenario C (the cross-call-site byte-parity
test) were built 2026-08-01 as §9.1's cure and are marked as holding. T6 is that
same cure re-forked for a new pair of consumers. If T6 degenerates into "spawn
the CLI with the API mocked" (risk.md trap T5), that is **the fix regressing**,
not a fresh gap — grade it accordingly at build review.

---

## Current coverage

**Observed baseline (cartographer actually ran it, 2026-08-02): 241/241 green,
zero failures anywhere.**

| Run | Result |
|---|---|
| The nine-spec plan-surface floor (`plan-ingest`, `plans-api`, `plan-writeback`, `detour-disposition`, `db-migration`, `reconciliation-full-tick`, `chronology-ordering`, `single-writer-guard`, `pace-tracking`) | **144/144** |
| Pool-feed specs (`intake-scan`, `repo-topology`) | **27/27** |
| Client slice-5 host (`ProjectDetail.test.tsx`, `screens.snapshot.test.tsx`) | **34/34** |
| DEC-2 dependency in the trunk-drift worktree (`git-refs`, `trunk-drift`) | **36/36** (uncommitted; **0 on master**) |

**What that green means, and what it does not.** It means the adjacent-untouched
regression surface is well guarded and the additive boundary is checkable: if
any of the 144 needs a behaviour edit, the design has been violated. It does
**not** speak to this change at all — all six new modules are UNGUARDED by
construction, and two existing guards are **PARTIAL by construction** in ways
that matter here:

- `chronology-ordering.test.js:80-86` hand-types `filesToScan` as exactly five
  files (verified by direct read). All four new server files are born **outside**
  the scan's scope.
- `client/src/i18n/__tests__/i18n.test.ts` has no whole-namespace key-set parity
  assertion — it accretes one hand-typed key block per build, ×4 locales.
- **No test anywhere asserts OpenAPI `operationId` uniqueness or route/spec
  completeness** (verified: zero `operationId` references under
  `server/__tests__/`; `api.test.js` only smoke-checks that
  `/api/openapi.json` returns `openapi: "3.0.3"`).

**Caveat that must be honored, not just noted:** this baseline is against a
**dirty working tree** — 60 modified paths, including +1,287 lines in
`ProjectDetail.tsx` and +129 in `server/db.js`, and the trunk-drift worktree
touches the same files. Re-baseline on a clean tree after the DEC-2 merge before
slice 1. A slice-5 snapshot regen on today's tree would launder a sibling
effort's unreviewed UI diff into reviewed baselines — explicitly forbidden by
`CLAUDE.md`.

---

## Gaps & test-debt diagnosis

### Gap 1 — Cross-seam `unitKey` agreement: named by risk, adopted by nobody (HIGH)

`unitKey(source, ref, cwd)` is the serialization-boundary token of this whole
feature, and `source_cwd` is inside the per-(unit,item) UNIQUE index. The plan
canonicalizes cwd at **each seam individually** (import, pool assembly, claim
write — technical-plan §4 steps 4/8/13) but **nothing asserts the seams agree**.

If claim-write canonicalizes and pool assembly doesn't — or one resolves through
`realpathSync` casing and the other through the `project_paths` mapped casing —
then the claimed key `('trunk_commit', sha, '/SARA/dnd')` never matches the
pool's `('trunk_commit', sha, '/SARA/DND')`. The consequences are all silent:
the claimed unit **re-enters the pool** (I-2/I-3 broken), the UNIQUE index never
fires, and a second claim double-counts the headline health number. Every test
that seeds one consistent casing ships green — and every planned test does
exactly that.

Checked case-by-case: `unit-tests.md` §4 (T5) "first-claim-removes-from-pool"
asserts `unitKey` membership but seeds one casing; §5 (T3) `identityWarnings`
case (a) proves two *mapped `project_paths` cwds* collapse at assembly; §3 (T4)
proves *import* folds case-variants. **No case writes a claim through a
case-variant or worktree cwd and then assembles the pool through the canonical
one.** `risk.md` trap T2 names this exactly and says: "If the test-plan pass
doesn't adopt it as a T3/T5 case, it must become a WATCH row." Neither happened.

This is the single highest-value missing assertion in the set: it defeats the
ratchet, it is invisible, and a miscount here is literally
CWD-IDENTITY-FANOUT's recorded promotion trigger.

### Gap 2 — The OpenAPI/contract-doc surface is owned by no document, and already broken (HIGH)

Found by the cartographer as the *only* grep hit for the new names, and it is not
coverage: `server/openapi-extra/plans.js:236` already defines
`operationId: "getProjectPlans"` for the **legacy** `GET /api/plans/project/{projectId}`
rollup. The moment `/api/project-plans` gets a spec entry, that id is taken —
an R1 "the two plan surfaces must never blend" collision, at the docs layer,
where every generated client and every reader of the contract lands.

Three compounding facts, all verified live:

1. **The change set doesn't include the doc surface at all.** The brief's
   changed-files list names `docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`,
   the READMEs — and **not** `server/openapi-extra/` or the committed
   `openapi.yaml`. So the plan ships a new public namespace that is absent from
   the artifact `server/README.md:523` calls "the source of truth for
   request/response contracts."
2. **There is no guard at any layer.** No spec asserts operationId uniqueness;
   no spec asserts every mounted `/api/*` router has a path entry (32 mounts in
   `server/index.js`, 96 path entries in `openapi.yaml`).
3. **The drift has already shipped, repeatedly.** `openapi.yaml` was last
   regenerated 2026-07-30 and contains **zero** entries for `topology`,
   `intake-status`, `color-thresholds`, or `terminal-focus` — four route
   families merged since. Green suite, ticked DoD, stale contract.

This is a genuinely new class for this catalog: not a scan with the wrong scope
(§9.7), but a documented-as-canonical surface with **no scan at all**, whose
enumeration is hand-maintained per feature.

### Gap 3 — The DEC-4 named dedupe test is schema-blocked, and the workaround changes what it proves (HIGH-MED)

DEC-4 requires a *named test*, not a comment: a sha arriving via both the live
`detectTrunkDrift` feed and a persisted `detour_dispositions` row with
`source='trunk_drift'` must yield exactly one pool unit and one health count.
But `server/db.js:701` is still
`source TEXT NOT NULL CHECK(source IN ('inferred','declared'))` — the row the
test needs **cannot be inserted** until trunk-drift Phase 1b widens the CHECK,
and Phase 1b is itself gated on an unscheduled live trial.

The unit architect saw this and proposed two answers (`unit-tests.md` §5 + Gaps
note 1), and they are **not equivalent**:

- **`db.pragma("ignore_check_constraints = 1")` for the seed**, restored after.
  Keeps the *full assembly path* real. Cost: the fixture is in a state no
  production writer can currently produce — §9.3's B4 shape ("a fixture in a
  state no real call site can reach"), the exact form that survived into code
  review last build. It is defensible *here* because the state is
  future-real rather than never-real, but that argument must be written down
  next to the pragma or the next reader deletes the test.
- **Export the row→unit mapper and test the mapping directly.** Honest and
  cheap, but proves the mapper, not the assembly — and R7's failure is an
  *assembly* failure.

Recommendation: **do both** (pragma-seeded assembly test as the primary, mapper
unit test as the fast diagnostic), and add the thing neither document has: a
**tripwire that fires the day Phase 1b lands** — assert in the spec that
`detour_dispositions`' CHECK text still excludes `'trunk_drift'`, with a message
saying "Phase 1b has landed: drop the pragma, re-run this test against a real
row, and re-verify `source_ref` carries a full 40-char sha." Without it, the
pragma silently outlives its reason and the one thing it cannot prove — that
Phase 1b's writer uses the same `source_ref` shape the mapper expects — is
where R7 actually lands.

Also unguarded and connected: `risk.md` trap T1 predicts this test is the
*first* thing dropped ("Phase 1b doesn't exist yet, the fixture is
unreachable"). That prediction plus a schema block is how a named DEC obligation
becomes a comment.

### Gap 4 — §9.7's cure now exists (unmerged); the risk shifts from "build it" to "consume it, and don't take the fallback" (MED-HIGH)

> **Reconciled mid-pass, 2026-08-02.** The trunk-drift build landed
> `server/__tests__/helpers/single-home.js` — `assertSingleHome(sharedModulePath,
> {consumer: {shared, private, absent}})`, scope derived from
> `Object.keys(require(shared))`, proven red twice with two different canary
> exports — and recorded it in the catalog while this pass was in flight.
> **Verified: it is still absent from `master`** (as are `git-refs.js` and
> `trunk-drift.js`); it arrives with the DEC-2 dependency that already hard-gates
> slice 1. So the obligation is no longer "build the cure" but **"consume it"**:
> the closure single-writer guard (T5) and T4's import rogue-writer scan must be
> *call sites of `assertSingleHome`*, not a second hand-rolled scope-derivation
> helper — which would be §9.1's "scan for copies of its *helpers* too" lesson
> recurring at the guard level within the same week. The risk analyst flagged this
> as §1e before the helper existed; it is now a concrete, verified instruction.
> Note also that the same build recorded **two fresh §9.7 occurrences inside the
> build that built the cure** — including `assertSingleHome`'s own path resolution
> being anchored to the wrong directory, so the scan never ran while the DoD showed
> a tick. Consuming it is not the same as trusting it: assert that the new call
> sites actually load and actually fail on an injected undispositioned export.

`chronology-ordering.test.js`'s hand-typed 5-file `filesToScan` is confirmed
live. DEC-9 adopts both halves (same-commit registration **and** derived scope),
`unit-tests.md` §8 specifies the disposition map and even a red-proof (drop a
scratch `server/lib/zz-scratch.js` with an undispositioned LIMITed SELECT; the
suite must fail on **scope**, not on SQL shape). That is exactly right and it is
the best-specified version of this cure the project has had. The only gap is the
**escape hatch** described in the verdict above.

The same shape lives in a second place that no document has connected to §9.7:
**`i18n.test.ts` is a hand-typed key registry that accretes one block per
build.** A namespace-wide, plural-aware key-set audit run against the live tree
right now finds a real divergence the suite cannot see —
`sessions:remoteSourceBadgeTitle` exists in `en` only (the ko/vi/zh
translations of that string live under a *different* namespace,
`settings.json`). `unit-tests.md` §9 puts slice 5's locale parity assertion
**inside `PlanLedgerPanel.test.tsx`** ("extend the existing locale-parity test
if one exists, else add it here"). That is the wrong home three times over: it
is slice-5-gated (so if Sara answers "noise" at the gate, it never ships), it
covers only this feature's new keys, and a locale-registry invariant living
inside a component spec is nobody's file — the precise mechanism §9.1's
2026-08-01 QA note blames for per-shape specs never being written.

**Important shaping detail for whoever builds the cure:** a naive
`deepEqual(sorted(keys(en)), sorted(keys(locale)))` lands **red on day one on 8
legitimate pairs**, because i18next plural rules give zh/vi/ko a single plural
category — `plugins.skills_one`, `sessionCount_one`, `concurrency.active_one`
etc. correctly do not exist there. A parity test that goes red for a legitimate
reason on its first run gets weakened, not fixed (§9.3's whole history). The
test must strip/exempt `_one|_two|_few|_many|_zero` suffixes for
single-plural-form locales, and then it is green today except for the one real
divergence above — which should be fixed in the same commit.

### Gap 5 — T6's parity spec: the right idea, with two soft spots (MED)

T6 is the deliverable this whole plan is built around and it is well designed
(one seeded DB, real route, real spawned CLI process, verbatim value match, no
tolerance). Two soft spots:

1. **Its `CONSUMERS` registry is a length assertion, not a derived one.**
   `assert.equal(CONSUMERS.length, 2)` catches silent *widening*; it cannot
   catch a consumer that arrives and never registers — which is the exact
   DEC-16 failure mode (MCP tools, the AGENT-PLAN.md export). This is
   acceptable for now, but say so in the spec: this is a tripwire on the array,
   not a completeness guard on the surface.
2. **`ccam ledger health`'s output format is unspecified** (`unit-tests.md` gap
   4), so T6's label-anchored regex extraction is pinned to labels nobody has
   agreed are contract. Recommend `ccam ledger health --json`: it makes T6 an
   exact deep-equal instead of a regex, and removes the "someone reworded a
   label and the parity test silently stopped matching" failure — which would
   read as green.

### Gap 6 — Contract and trip-wire decisions with no tracked artifact (MED, mostly non-test)

`risk.md` §6 names three risks with no `decisions.md` row, and the e2e pass adds
three contract questions the plan never answers. None of them is covered by a
planned test because none of them has been *decided*:

| Item | Source | Why it matters |
|---|---|---|
| Pool-assembly **request-path cost** — git subprocesses + `realpathSync` + intake dir walks per `GET /pool`, uncached, unbudgeted | risk.md §1c/§6.1 | Degrades Project Detail *and* the slice-4 gate itself (Sara judging "signal or noise" through a 10-second CLI call) |
| **`seenShas` semantics + `detectTrunkDrift` signature re-confirmation** at DEC-2 merge | risk.md §6.2, trap T7 | Every T3 case is designed against an **uncommitted worktree** signature; nothing tracks the obligation to re-verify. If `seenShas` is an exclusion set vs a since-marker, the ratchet test passes for the wrong reason |
| **Cross-seam canonicalization agreement** | risk.md §6.3 | Gap 1 above — must become either a test case or a WATCH row; currently neither |
| **S1 — unknown-project 404 vs audit semantics** | e2e §7 | `project_plans.project_id` has no FK *by design* so closed generations outlive their project. A blanket "unknown project → 404" on GETs makes `history`/`health` unreachable the day a project row is deleted — destroying the audit story this feature exists for |
| **S3 — create returns 200 or 201?** | e2e §7 | Three consumers (route/CLI/UI) fork on it if unpinned |
| **S5 — `ccam ledger` offline posture** | e2e §7 | Undesigned; recommend refuse (server-side math), matching `cost` |

### The systemic reason these gaps exist

Two mechanisms, both already on record for this project, both still live:

**(a) Test scope is per-module, not per-shape.** The one-spec-file-per-module
convention means any obligation that spans modules or spans *artifacts* has no
home, so it is nobody's file and does not get written. This is the catalog's own
diagnosis (§9.1 QA note, 2026-08-01) and it is still the best explanation of
four of the six gaps above: cross-consumer parity (fixed this round — T6 is
named with a filename, which is exactly the right countermeasure), cross-seam
agreement (**not** fixed — Gap 1), locale key-sets (**not** fixed — parked
inside a component spec, Gap 4), and route↔spec completeness (**not** fixed —
no document owns it, Gap 2). The plan proves the countermeasure works: name the
file, and the spec gets written. It just applied it once instead of four times.

**(b) Invariants are hand-carried between four independently-authored documents
with no reconciliation step**, so "named in `risk.md`, adopted by neither test
architect" is structurally undetectable. Trap T2 (Gap 1) was named with its
required assertion spelled out, was picked up by nobody, and its own stated
fallback ("then it must become a WATCH row") also didn't happen — because
nothing checks. This is **verbatim** the systemic cause recorded for
`trunk-drift-detection` one day earlier, where three risk-named gaps went
unowned, which was itself verbatim the cause recorded for
`practice-kind-override` the day before that, where i18n went unowned. The
*invariants* got fixed each round; **the mechanism that drops invariants has now
survived three consecutive QA cycles.**

**Have we shipped this class of gap before?**

**Yes — repeatedly, and this change touches five catalog entries plus both
candidate patterns.**

| Catalog id | Status | How it applies here |
|---|---|---|
| **§9.1 DERIVED-DUAL-VIEW** | OPEN, count **5**, with **three** design-time pre-flags already on file for *this* item | Announced-consumers form (pool size / time-since-closure arrive with consumers 2–4 named pre-code, two net-new); feed-level form (DEC-4 sha identity — Gap 3); write-sequence form (no `closed_at` on claims, derive by join). The plan's cures are correct and named. Watch for the **regression-of-the-fix**: T6 degenerating into a mocked-API CLI test un-does the parity cure proven at build-project-manager |
| **§9.7 HAND-SCOPED STRUCTURAL SCAN** | **OPEN**, **6 occurrences**; cure **BUILT 2026-08-02 but unmerged** (`helpers/single-home.js`, trunk-drift worktree — verified absent from `master`) | The obligation flips from "build it" to "consume it" — T5's closure guard and T4's rogue-writer scan must be `assertSingleHome` call sites (Gap 4). DEC-9's fallback is the remaining escape hatch. `i18n.test.ts` is occurrence 6 and its fix was scoped to one key group; whole-namespace parity (M4) is still missing |
| **§9.3 VACUOUS-GUARD** | OPEN (5 spec files, **two consecutive BLOCKED verifier passes**, a 6th shape into code review) | Four structural guards planned here (import rogue-writer, closure single-writer, derived chronology scope, cross-feed dedupe). Pre-build twist: red-first tests are *supposed* to be red, so the §9.3 obligation is the **recorded red state at build time** by mutation. Sweeps are at 0 on master today — verified |
| **§9.5 / §9.6 (FRESH-DB-BLIND / NON-ATOMIC REBUILD)** | OPEN; §9.6 has **5 latent live instances** | **Inapplicable by design here — the strongest possible outcome**, and the catalog's own generalizable lesson (2026-08-02) cites this very item as the exemplar: prefer a design that makes them inapplicable over one that complies. Conditional though: any mid-build vocabulary edit, a nullable `source_cwd`, or a `project_paths` write-side "fix" reactivates both while T1's shrunken scope stays green (risk.md trap T4) |
| **§9.2 row-id-as-chronology-proxy** | OPEN, 4 discovery sites | Focus-bracketing walks `sessions`/`events`/`focus_inferences`. Covered by T3's scrambled-id fixture *plus* the registered scan — but only if the scan's scope actually reaches the new files (Gap 4) |
| **§9.4 FIX-ROUND-REGRESSION** | OPEN | Applies prospectively: the fix round needs its own adversarial pass, and every dedup key here (`(value_source, value_ref, source_cwd, item_id)`, the import hash key) needs one negative case **per dimension** — N1's lesson was a key missing exactly one dimension |
| **CWD-IDENTITY-FANOUT** (candidate) | candidate, promotion trigger armed | This build's health metric **is** the trigger ("a shipped aggregate shown to under- or double-report"). Gap 1 is the untested path to exactly that |
| **SHARED-BUDGET-STARVATION** (candidate) | candidate, parked | Not touched by this change |

Two process precedents worth carrying into build review: the `wip-queue-page`
build (2026-07-30) was fully reverted two days later for shipping a portfolio UI
before anyone checked the underlying data was worth rendering — which is exactly
what DEC-12's slice-4 gate exists to prevent, and why "auto-pilot cannot waive
it" must be honored literally. And this project's vacuous guards survived **two
consecutive BLOCKED verifier passes**, with placeholders reworded rather than
fixed between passes — so "the guard exists" is not evidence; "the guard was
observed red" is.

---

## Recommendation

**Headline: ship this plan — it is the strongest pre-build design this project
has produced — but treat four specific additions as non-negotiable slice gates,
and close DEC-9's escape hatch. The plan already contains the cure for its own
biggest catalog risk; the failure mode to guard against is not a bad design, it
is the derived-scope work quietly downgrading to registration-only, and the four
homeless obligations staying homeless.**

### Must-add-now (worst first)

| # | Add | Where | Why it can't wait |
|---|---|---|---|
| **M1** | **Cross-seam `unitKey` agreement case.** Write the claim through a case-variant (`.../DND` vs `.../dnd`, darwin-guarded) or worktree cwd; assemble the pool through the canonical one. Assert: the unit is still excluded from the pool, and a second claim of the same unit into the same item is still blocked by the UNIQUE index. Red-proof by removing canonicalization from **one** seam only | `value-ledger.test.js` (T5) + `value-pool.test.js` (T3) | Gap 1. Silent ratchet defeat; the CWD-IDENTITY-FANOUT promotion trigger; named by risk and adopted by nobody |
| **M2** | **OpenAPI contract obligations.** (a) Give `/api/project-plans` its own `server/openapi-extra/project-plans.js` fragment with **non-colliding** operationIds (`listPortfolioPlans`, `closePortfolioPlan`, …); (b) add a spec-level test asserting **operationId uniqueness across the whole merged spec** and that every `app.use("/api/…")` mount in `server/index.js` has at least one path entry, with a dated grandfather list for today's four known-missing families; (c) regenerate `openapi.yaml` (`npm run openapi:yaml`) in the same change-set | new `server/__tests__/openapi-contract.test.js`; brief's changed-file list | Gap 2. A live collision on a surface no document owns, plus 4 already-shipped omissions |
| **M3** | **DEC-4 dedupe: decide the seeding mechanism, and add the Phase-1b tripwire.** Pragma-seeded full-assembly test **and** an exported-mapper unit test; plus an assertion that `detour_dispositions`' CHECK text still excludes `'trunk_drift'`, whose failure message is the instruction to re-verify against a real Phase-1b row (including that `source_ref` carries a full sha) | `value-pool.test.js` (T3) | Gap 3. The one DEC that says "named test required, not a comment" is the one currently blocked by schema |
| **M4** | **Locale key-set parity in its own home**, not in a component spec: a plural-suffix-aware whole-namespace `deepEqual` loop over all 21 namespaces × 4 locales, in `i18n.test.ts`. Fix `sessions:remoteSourceBadgeTitle` in the same commit. **Ship it in slice 1, not slice 5** — it is not UI work and must not be gated behind DEC-12 | `client/src/i18n/__tests__/i18n.test.ts` | Gap 4. ~15 lines; retires the per-build key-block accretion permanently |
| **M5** | **Close DEC-9's escape hatch, and consume rather than re-derive:** the bounded fallback may only be taken with a dated `decisions.md` row naming the pre-existing violator set. T5's closure guard and T4's rogue-writer scan must be `assertSingleHome` call sites (post-DEC-2), each red-proven by injecting an undispositioned export. Record the `zz-scratch.js` scope failure in build notes | `decisions.md` + build notes | Gap 4. 7th recurrence of §9.7 otherwise — and a second hand-rolled scope helper is §9.1's helper-copy lesson repeating within the week |
| **M6** | **Tracked rows for the six undecided items** in Gap 6's table (pool request cost as a WATCH with an escalation trigger; DEC-2 signature re-confirmation on DEC-2's trigger-to-close; S1/S3/S5 as pinned contract decisions) | `decisions.md` | §9.4's lesson at the decision layer: a settled-looking item that was never decided fails the same way as an unrecorded review finding |

### Slice-gate mapping (what blocks what)

| Slice | Gate — none of these may be deferred to a later slice |
|---|---|
| **0** (DEC-2 merge) | Re-baseline on a **clean** tree (today's 241/241 is against 60 dirty paths). Re-diff every planned `detectTrunkDrift` usage against the real merged export, incl. `seenShas` semantics (**M6**). Consume the worktree's incoming `server/__tests__/helpers/single-home.js` — do **not** hand-roll a second scope-derivation helper (risk.md §1e: that is §9.1 recurring at the guard level). `git worktree list` + running-session check before the first commit |
| **1** (schema + import) | T1 (incl. legacy `sqlite_master.sql` text unchanged + the `/ALTER TABLE/` count pin), T2, T4 with the rogue-writer scan **red-proven by injecting a writer into `plan-ingest.js`**, `cwd-identity.test.js`, and **M4**. T4's "legacy `plan_items` count actually shrank" sub-assertion is load-bearing — without it the survival test passes vacuously on a fixture where `deletePlanItemsNotIn` never fired |
| **2** (claims + close) | T5, incl. the closure single-writer guard with **export-derived** scope, red-proven by injecting a second close call site; the `source_cwd ''`-not-NULL executable proof (not a DDL read); claims byte-identical across `closePlan`; **M1** |
| **3** (pool + parity) | T3, T6, the chronology derived-scope cure (**M5**), **M2**, **M3**. The §9.2 scrambled-id fixture must make the **LIMIT select the wrong subset**, not merely present the right subset misordered — otherwise it is a tautology (§9.3) |
| **4** (Sara's gate) | DB backup **first**; `DND`/`dnd` cleanup (DEC-13) **before** the trial or it measures a double-counted fleet; read `identityWarnings` out loud; if the health number miscounts, **promote CWD-IDENTITY-FANOUT to a real catalog entry** per its trigger. Auto-pilot cannot answer this box |
| **5** (UI) | Only after slice 4 is answered. Snapshot regen on a tree containing **only** this effort's UI diff. The "health rendered verbatim (37, not pool.length=5)" case is the §9.1 client trap and must be red-proven |

### The durable cures (what kills the classes, not the instances)

1. **Derive the scan's scope from the artifact** (DEC-9) — `server/lib/*.js` +
   `server/routes/*.js` with per-file dispositions, so a 6th lib file **breaks
   the suite** until someone dispositions it. For the export-scoped guards
   (closure single-writer, import rogue-writer) this is now a *reuse* task, not
   a build task: **consume `assertSingleHome`** from the incoming DEC-2 merge and
   prove each new call site red by injecting an undispositioned export.
2. **Registry-derived meta-tests everywhere a vocabulary exists** — the unit
   architect's design here is exemplary and should be the template: parse the
   `CHECK` list out of `sqlite_master`, `deepEqual` it against the exported
   `VALUE_SOURCES`, **and** require every member to carry a test disposition in
   a literal map whose `Object.keys` set-equals the export. A 6th source cannot
   ship green in either direction. Endorsed as-is.
3. **One whole-namespace locale parity test** (M4) — retires the per-build
   hand-typed key block for every future feature, not just this one.
4. **One contract-completeness test for the OpenAPI surface** (M2) — derived
   from the router registry, not maintained per feature. This is the new class;
   see the catalog note added this pass.
5. **A reconciliation step between the four QA documents** (the meta-cure).
   Every `risk.md` invariant/trap id must end a QA pass in one of exactly two
   states: **claimed by a named case in a test-design doc**, or **recorded as a
   tracked row**. Cheapest form: a coverage-matrix table at the top of
   `unit-tests.md`/`e2e-tests.md` listing every I-n/T-n and its owning case.
   This is §9.4's "fixed-with-a-test or recorded-with-an-id" rule applied to the
   QA stage instead of the fix round — and it is the one cure that would have
   caught Gap 1 here, the i18n gap in `practice-kind-override`, and three gaps
   in `trunk-drift-detection`.

**Is it safe to ship once M1–M6 are in?** For slices 1–3, yes — with the
standing caveat that the DoD's "zero `ALTER`, zero rebuilds" grep must be run
against **this change-set's diff**, not the whole tree (master already carries
+129 uncommitted `db.js` lines, which can both false-positive and launder a
smuggled change). Slices 4–5 are gated on Sara, not on the suite: DEC-12 is
sign-off and the suite cannot substitute for it.

---

## Open decisions for the user

- [ ] **Accept the durable cures now, or just the point tests?** M2 (OpenAPI
      contract test) and M4 (locale parity) both fix classes that are *already*
      broken on master and are not, strictly, this feature's fault. Adding them
      here costs perhaps an hour and retires two recurring taxes; deferring them
      means this feature ships a colliding operationId and a locale registry
      that only covers keys someone remembered to type. **Recommendation: take
      both now** — M4 in slice 1, M2 in slice 3.
- [ ] **DEC-9's bounded fallback — accept the forcing function?** Recommendation:
      yes; the fallback stays available but requires a dated `decisions.md` row.
      Without that, five flags become six.
- [ ] **`ccam ledger health --json`?** Recommendation: yes. It converts T6 from
      regex-scraped labels into an exact deep-equal and removes a silent-drift
      path in the one spec this whole plan is built around.
- [ ] **S1 — audit semantics for a deleted project.** Recommendation (from the
      e2e pass, endorsed): create/import 404 on unknown project; list / pool /
      health / history 404 **only** when neither a project row nor any
      `project_plans` row exists. Otherwise closed generations become
      unreachable the day a project is deleted, which defeats AC-6.
- [ ] **DEC-10 … DEC-13 remain PENDING (Sara).** DEC-13 (`DND`/`dnd` merge) is a
      hard precondition of the slice-4 trial, not a preference — if it is
      skipped, the gate measures a double-counted fleet and its verdict means
      nothing.
- [ ] **DEC-12 stands as written:** slice 5 does not start until Sara answers
      "is this pool signal or noise?" on real Coaching Assistant data. Recorded
      here because `wip-queue-page` was fully reverted (`18196dc`) for skipping
      exactly this altitude of check.

---

*Memory updated:* qa-run-log.md ✅ · `PROJECT-CONTEXT.md` recurring-issue catalog
✅ (§9.1 QA-pass note, count unchanged at 5; §9.7 QA-pass note, count unchanged at
6, reconciled against the concurrently-added BUILT note; new candidate pattern
**CONTRACT-SPEC-DRIFT** recorded with an explicit promotion trigger)

> **Concurrency note.** `PROJECT-CONTEXT.md` was edited by another live session
> (the trunk-drift build's outcome notes) *during* this pass — the same
> shared-checkout hazard R6/DEC-2 and project memory both warn about. Nothing was
> clobbered (all edits were anchored inserts) and this assessment was reconciled
> against the new content, but it is a live demonstration that slice 0's
> `git worktree list` + running-session check is load-bearing, not ceremonial.
