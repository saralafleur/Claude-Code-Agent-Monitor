# Change Brief — auto-group-proposal (Value Pool Slice 3)

> Authored by `qa-triage`. The single normalized statement of *what we are
> about to build*, before any test-design pass. **Forward mode**: this is a
> team-intake hand-off with nothing built yet — `team-qa` runs before
> `team-build` here, planning what tests must exist so the build can be
> written test-first. This is not the backwards-looking QA-fix flow used on
> Slice 2's post-merge round.

- **Date:** 2026-08-06
- **Scope source:** intake-handoff
- **Intake link:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/`
  (`technical-plan.md` = intended change; `decisions.md` = 14 RESOLVED
  rulings + 6 WATCH rows + 1 carried OPEN, all non-blocking per PM;
  `pm-plan.md` = the PM's cross-reconciliation of the four evaluator docs,
  including two corrections to `PROJECT-CONTEXT.md` itself; `supporting/*.md`
  = architect, engineer, product-owner, qa evaluator passes)

## Change summary
Add a two-stage, proposal-only grouping engine over a project's Value Pool —
a free deterministic mechanical pre-grouping pass (slug reference /
time-adjacency / shared-surface signals) followed by one sonnet call per
batch that turns raw candidate clusters into named proposals (name,
stakeholder summary sentence, member `unitKey`s, rationale) — persisted to
three new tables and rendered in `PlanLedgerPanel` for human **approve**/
**dismiss** review only. In the same change set, extract `buildProbeCoverage`
(SF-4, scheduled debt from Slice 2) so Slice 3's coverage gate becomes its
third call site rather than a fourth hand-copy, deliberately turning the
existing T7 guard red and replacing it in the same commit.

## Changed files (by layer)
*(from `technical-plan.md` §9 "Change set" — intended, not yet built; every
path below was checked for a real anchor point, see "Reference-point
verification" below.)*

**Backend — new**
- `server/lib/value-coverage-probe.js` — `buildProbeCoverage` (SF-4 extraction)
- `server/lib/value-groups.js` — 6 state registries + `mechanicalPreGroup`,
  `groupingFacts`, `buildGroupingPrompt`, `parseGroupingOutput`,
  `refineBatch`, `rollupGroups`, `computeGroupingDigest`,
  `resolveMemberAvailability`, `runGroupingPass`,
  `reconcileInterruptedGroupRuns`

**Backend — edited**
- `server/db.js` — 3 new `CREATE TABLE IF NOT EXISTS` blocks
  (`value_group_runs`, `value_groups`, `value_group_members`) + ~12 prepared
  statements
- `server/routes/project-plans.js` — both existing coverage handlers
  rewritten to call `buildProbeCoverage`; 4 new group route handlers
  (`POST /groups/propose`, `GET /groups`, `POST /groups/:id/approve`,
  `POST /groups/:id/dismiss`)
- `server/lib/value-ledger.js:70-74` — `CONSUMERS` array gains a 4th entry
  for `value-groups.js`
- `server/index.js:465-470` — `reconcileInterruptedGroupRuns(dbModule)` added
  at boot beside the existing tick start
- `server/openapi.js` / `server/openapi-extra/plans.js` — document 4 new endpoints

**Database / migration**
- 3 brand-new tables, plain `CREATE TABLE IF NOT EXISTS`; explicitly **zero**
  `ALTER TABLE`, **zero** `UPGRADE_CASES`/`REBUILD_CASES` entries (confirmed
  genuinely new — see verification below)

**Tests changed in this set**
- New: `server/__tests__/value-groups-mechanical.test.js`,
  `value-groups-refinement.test.js`, `value-groups-api.test.js`,
  `value-coverage-probe.test.js`,
  `client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx`
- Edited: `server/__tests__/project-plans-api.test.js` — **T7 (line 905)
  deleted IN FULL in the same commit — zero lines survive.** BO-1
  correction (found by `team-qa`'s 2026-08-06 pre-build pass, confirmed by
  the build itself): the earlier claim in this brief that "the anchored
  assertion at lines 988-998 survives unmodified" was wrong. Lines 988-998
  are T7's OWN five-key `coverageSnapshot`-argument-set anchor
  (`computedAt/counts/draining/projectId/requestedAt`) and depend on T7's
  own regex-scan mechanism (`extractCoverageSnapshotKeys`), which returns
  `[]` post-extraction — that anchor cannot survive detached from T7. The
  assertion that DOES survive unmodified is **T6** (`:886-903` pre-edit),
  the HTTP response-BODY key-set anchor (nine `snake_case` keys) — a
  different assertion, on a different object (`coverageSnapshot`'s
  *return* shape, not its *argument* shape). T7's five claims each got a
  named successor instead (`value-coverage-probe.test.js`'s P-1…P-8 +
  `single-writer-guard.test.js`'s G-1/G-2/G-4); the five-key argument
  anchor's own successor is P-7.
- Edited: `server/__tests__/single-writer-guard.test.js` — new
  `buildProbeCoverage` single-call-site guard; new writer guards for the 3
  new tables; `assertSingleHome` consumer-map additions at the existing
  `../lib/value-ledger` (line 467) and `../lib/value-summary` (line 413) call
  sites, naming `../lib/value-groups`
- Edited: `server/__tests__/chronology-ordering.test.js` — add
  `value-groups.js`/`value-coverage-probe.js` to `filesToScan`
- Edited: `server/__tests__/db-migration.test.js` — confirm registry-
  completeness meta-test still passes with **no** new `UPGRADE_CASES`/
  `REBUILD_CASES` entry (intentional — new tables need none)
- No test file for this surface exists today (`grep -rn
  "value_groups\|value-groups" server/__tests__/` → 0 hits, confirmed live) —
  this is genuinely new coverage, not a gap in existing coverage.

**Config / other**
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — all four,
  same commit, for the 6 new state registries
- `client/src/components/PlanLedgerPanel.tsx`, `client/src/lib/api.ts`
- `client/src/pages/__tests__/screens.snapshot.test.tsx` — review diff,
  regenerate deliberately (`cd client && npx vitest run -u`), never blind-update
- Docs: `PROJECT-CONTEXT.md` (SF-4 → build-outcome note), README/ARCHITECTURE/
  SETUP wherever new endpoints/tables/env surface — `update-project-docs`
  applied at end of change set, unprompted, per repo CLAUDE.md

## Surfaces / features touched
- **Value Pool grouping/proposal engine** (net-new): `server/lib/value-groups.js`
- **Probe-coverage composition** (SF-4 extraction of existing duplicated
  logic): `server/lib/value-coverage-probe.js`, consumed by
  `POST /coverage-request`, `GET /coverage` (both existing, rewritten), and
  the new `POST /groups/propose` gate check
- **`PlanLedgerPanel`** (client, extended, not new page) — Auto-group button,
  proposal list, approve/dismiss actions, per-member availability chips
- **Schema**: 3 new tables (`value_group_runs`, `value_groups`,
  `value_group_members`) — no existing table altered
- **Route surface**: 4 new endpoints on `server/routes/project-plans.js`
- Explicitly **not** touched, and fenced by the product owner (§7/§8 of
  `supporting/product-owner.md`): any claim-target picker, batch-claim
  action, or plan-item create/edit UI — that is Slice 4.

## Variant relevance
This project's #1 recurring defect class is **§9.1 DERIVED-DUAL-VIEW**
(same computed value, multiple consumers) — not literally a tenant/locale
variant, but the project's own generalization of "must stay identical across
paths." This change touches it directly, on two axes:

1. **The probe-coverage composition** (SF-4) currently exists as **two
   independent hand-copies** (`POST /coverage-request`, `GET /coverage`) that
   have already diverged once on `requestedAt`. Slice 3 adds a **third**
   consumer (the grouping gate) and the plan's own fix is to collapse all
   three onto one function (`buildProbeCoverage`) — this is the textbook
   §9.1 cure, being applied to a defect that already exists in the codebase
   today, not merely a new-code risk.
2. **Group data rendering** — if a group's summary sentence, member set, or
   any per-group rollup figure is ever read by more than the one `GET
   /groups` route (e.g. a future `ccam`/MCP surface), it must stay
   server-computed only. QA's own supporting doc explicitly names the
   "rogue re-derivation" sub-form (a second computation of the rollup
   formula, not just a second raw read) as the trap to guard against here.

There is also a genuine **locale-variant** surface: 6 new server-authored
state registries each need mirrored keys across **four** locale files
(`en`/`ko`/`vi`/`zh`), which is this project's literal cross-path-consistency
obligation at the CJS/Vite boundary (§9.7).

## Test-invariants at risk
Cited against `PROJECT-CONTEXT.md` §9 (already the intake's own primary
grounding document — this is the 4th consecutive build on the single
highest-defect-density surface in the project, 9/9/4 §9.3-family events
across the three prior builds on this exact file family).

- [ ] **§9.8 OVERLOADED-ABSENCE** — named by the parent request itself as
      this surface's standing trap, and it bites at *two* altitudes in this
      slice: run-level (`not_attempted` / `in_progress` / `completed` /
      `completed_zero_groups` / `failed` must be 5 genuinely distinguishable
      wire values, never collapsed) and batch-level
      (`refinement_state` = `pending`/`refined`/`zero_members`/`failed` must
      never be inferred from NULL-ness of `name`/`summary_sentence`/
      `rationale`). The plan's own DoD requires a **combination test**
      (incomplete coverage + prior failed run + re-request →
      `blocked_coverage_incomplete`, not a resurrected `failed` or a silent
      re-attempt) modeled as a truth table, not four isolated branches.
- [ ] **§9.1 DERIVED-DUAL-VIEW / rogue re-derivation** — SF-4's
      `buildProbeCoverage` extraction (single home for a composition that
      exists as two hand-copies today) and the "group data is computed once
      server-side, never re-derived client-side" rule for
      `resolveMemberAvailability` / rollup figures. QA's own supporting doc
      flags PARITY-WITHOUT-ANCHOR as the specific guard shape to avoid
      repeating (a guard comparing two derived views to *each other*, as
      `value-coverage-parity.test.js` did in Slice 2) — any parity guard
      here must anchor against a literal fixture.
- [ ] **§9.7 HAND-SCOPED STRUCTURAL SCAN** — `CONSUMERS` (value-ledger.js)
      and both `assertSingleHome` consumer maps (value-ledger.js line 467,
      value-summary.js line 413) are **hand-typed** on their consumer axis
      and must gain `value-groups.js` in the *same commit* the new `require`
      lands — this exact axis silently went stale once already on this file
      family (SF-5, 2026-08-05, caught only by reviewer). `chronology-
      ordering.test.js`'s `filesToScan` (derived from `readdirSync`, not
      hand-typed, since 2026-08-03) must pick up the two new lib files.
- [ ] **§9.3 VACUOUS-GUARD** — the mechanical pre-grouping guard and the
      persisted-proposal guard must assert real computed content
      (fixture-anchored membership; persisted row content field-by-field),
      red-proven by mutation, not existence-only (`assert.ok(stmts.x)`) or
      shape-only (`Array.isArray`) checks. QA's own doc explicitly calls out
      that on this file family the adversarial reviewer has caught blockers
      a correctly-executed verifier mutation pass had already certified
      green, three builds running — `intake-qa` and `build-reviewer` are
      ruled non-trimmable here (PM-6.1).
- [ ] **"Proposals never actions" — negative proof.** Not a named catalog
      entry, but the single acceptance property the whole feature exists
      under (PO framing: "a wrong per-unit suggestion is a small error; a
      wrong *group* suggestion that got auto-claimed would misattribute
      several units' delivered value at once"). Required: a structural scan
      that `value-groups.js` and its routes contain zero call sites of the
      real plan-claim writers (enumerated from the real write surface, not
      hand-guessed), a behavioral test that a full grouping pass leaves
      `value_claims`' row count unchanged, a structural scan that zero code
      paths set `review_status = 'claimed'` (reserved-but-unreachable in
      this slice), and an adversarial-LLM-response test (a model output
      containing `status: "claimed"` must be discarded by a strict
      whitelist). All four red-proven.
- [ ] **Round-trip / cache-key integrity (PM-4)** — `computeGroupingDigest`'s
      input set and the LLM prompt's input set must be the *same object by
      construction* (`groupingFacts`); the mandatory
      `UNCOMPARED_FIELD_GUARANTORS`-shaped coverage test (walk every key,
      mutate, assert the digest changes) is the concrete proof, in the exact
      shape this project already proved works on 2026-08-05.

## Stated intent / acceptance
Seven acceptance criteria are ruled in `supporting/product-owner.md` §3 and
carried into `technical-plan.md` §12 with a named proof mechanism for each
(AC-1 mechanical pass is real/LLM-free/deterministic; AC-2 LLM refinement
produces all four named fields, one call per prompt's worth; AC-3
hierarchical decomposition is exercised against a pool that actually exceeds
the cap, nothing silently dropped; AC-4 proposals persist/render, nothing
auto-claims; AC-5 approve/dismiss are bookkeeping-only; AC-6 the gate is a
pure read of `coverageSnapshot.complete`; AC-7, inherited verbatim from Slice
2's DEC-2, the group action is visibly disabled until coverage is 100%,
reusing the existing coverage header ETA and the single existing
`prioritize-now-button`, no second control). The technical plan's full
`Definition of Done` (§15) enumerates the build-time obligations under each.

## Open questions
**Blocking (cannot plan tests):**
- None found. The scope source is a completed intake with a technical plan
  that resolves every open design question (14 `DEC-S3-*` rulings), and
  every reference point this brief needed to confirm against live code
  checked out (see "Reference-point verification" below).

**Non-blocking (proceeding on assumption):**
- Six items in `decisions.md`'s PENDING section are cheap-to-reverse vetoes
  for Sara (adds read-time member re-validation; reserves `claimed` in the
  enum now; adds a cache column/wire state; "approve" semantics;
  reuse-not-duplicate the existing prioritize-now button; the disclosure
  affordance's exact look) — none blocking, build proceeds on the rulings as
  written per the PM. → Assumption: test planning proceeds against the
  rulings in `decisions.md` as the ground truth; if Sara vetoes any of the
  six, the corresponding test obligations in this brief's invariant list
  need a one-line update, not a re-plan.
- `OPEN-S2-1` (carried) — which real project validates the end-to-end flow.
  Non-blocking per PM; recorded so it does not silently close.
- The technical plan is a design document, not a diff — line numbers cited
  for *new* code (e.g. exact prepared-statement names, exact route line
  numbers) are necessarily provisional until build. → Assumption: test
  planning targets the *named functions/tables/registries* the plan commits
  to (e.g. `buildProbeCoverage`, `GROUP_RUN_STATES`, `value_group_runs`),
  not speculative line numbers.

## Reference-point verification (live code, 2026-08-06)
Per this triage's specific brief, the following claims in `technical-plan.md`
were checked against the actual repository state — not re-derived from
prose, and not assumed correct because the plan asserts them:

| Claim | Verified |
|---|---|
| `server/__tests__/project-plans-api.test.js:905` — "T7 (SF-4)" exists, literally asserts each handler body contains `assembleValuePool(dbModule, { id: projectId })` and `enrichPoolAltitudes(dbModule, units, { probe: true })`, plus an anchored `deepEqual` on the `coverageSnapshot` argument key set | **CONFIRMED**, byte-for-byte. `it("T7 (SF-4): ...")` starts exactly at line 905; the anchored assertion (`postKeys` vs. the literal `["computedAt","counts","draining","projectId","requestedAt"]`) sits at lines 988-998, matching the PM's citation exactly. Because T7 string-matches the composition *inline in the route handler body*, extracting that composition into `value-coverage-probe.js` will make those literal substrings disappear from the handler bodies — **T7 will go red on extraction**, confirming the PM's correction of the engineer's (incorrect) claim that no such guard exists. |
| `CONSUMERS` array in `server/lib/value-ledger.js` | **CONFIRMED** at lines 70-74, exactly 3 entries (`server/routes/project-plans.js`, `bin/ccam.js (cmdLedger)`, `server/lib/value-summary-tick.js`) as the plan states — `value-groups.js` is not yet a member, consistent with "nothing built yet." |
| `assertSingleHome` consumer maps in `single-writer-guard.test.js` | **CONFIRMED** at both cited locations: `../lib/value-summary`'s map at line 413 (3 consumers: `../routes/project-plans`, `../lib/value-summary-tick`, `../lib/value-coverage`), `../lib/value-ledger`'s map at line 462/467 (1 consumer: `../lib/value-summary-tick`). Neither currently disposes `../lib/value-groups` — consistent with the plan's obligation to add it in the same commit as the new consumer. |
| `summaryModel("grouping")` / `SUMMARY_STAGES` / `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL` are real, already-shipped (Slice 2/DEC-10) | **CONFIRMED**, not aspirational. `SUMMARY_STAGES = ["unit", "grouping"]` at `value-summary.js:107`; `summaryModel(stage = "unit")` at line 122 with the documented fallback cascade; `.env.example:138` documents `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL=sonnet` with a dated 2026-08-06 calibration comment. The JSDoc explicitly notes the `"grouping"` stage has "NO consumer yet" — Slice 3 is genuinely its first caller, exactly as the plan claims. |
| No `value_groups`/`value_group_runs`/`value_group_members` tables exist yet | **CONFIRMED genuinely new.** `grep -n "value_group" server/db.js` → 0 hits. Repo-wide `grep -rn "value_group\|value-groups"` across `server/` and `client/` source (excluding this intake's own docs) → 0 hits. No test file for this surface exists (`server/__tests__/` has no `value-groups*` file). |
| Supporting reference points spot-checked for internal consistency | `VALUE_SOURCES` export exists (`value-ledger.js:42`); `rebuildTableAtomically` exists at `db.js:1664`; `coverageSnapshot`'s `complete` field exists in `value-coverage.js`; both existing coverage route handlers (`POST /coverage-request` at `project-plans.js:299`, `GET /coverage` at `:344`) independently call `enrichPoolAltitudes(..., { probe: true })` today (lines 319, 352) — confirming the SF-4 duplication the plan is extracting is real, present-tense, not hypothetical; `localDayLabel` exists in `focus-summary.js:363` (the reused time-bucketing convention); the boot-hook precedent (`server/index.js:465-470`, `startValueSummaryTick` beside `startReconciliation`) is the real shape `reconcileInterruptedGroupRuns` is meant to follow. |

## Verdict
**READY**
