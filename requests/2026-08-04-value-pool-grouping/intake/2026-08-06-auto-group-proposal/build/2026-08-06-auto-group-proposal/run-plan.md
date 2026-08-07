# Run Plan — team-build `direct` mode

**Effort:** Value Pool Slice 3 — Auto-group proposal engine
(`2026-08-06-auto-group-proposal`)
**Mode:** `auto direct`, **NOT fast** — a real test-plan exists (GAPPED verdict,
four binding rulings R1–R4), so the full test-plan gate applies and the
fast-mode "skip QA-angle agents" inversion does **not** apply here.
**Written:** 2026-08-06 · **Decided by:** director-of-engineering

**Verdict up front: both discretionary agents are IN. Nothing is trimmed.**
Direct mode buys formality here, not scope — this build is at the far end of
the size/risk distribution the discretion was written for, and one of the two
skips is explicitly forbidden by the plan of record.

---

## 1. Scope read

This is not a slice-sized change wearing a large plan; it is a genuinely large
build. It adds **three new schema tables** (`value_group_runs` /
`value_groups` / `value_group_members`) plus ~12 prepared statements, **two new
server modules** (`server/lib/value-groups.js` — six state registries, a
deterministic mechanical pre-grouping stage, an LLM refinement stage over a
spawned sonnet call, hierarchical batching + rollup, a cost-control digest, a
read-time availability resolver, an orchestrator that is sole writer of all
three tables, and a boot-time interrupted-run reconciler; and
`server/lib/value-coverage-probe.js` for the SF-4 extraction), **four new
routes**, a **client surface** in `PlanLedgerPanel.tsx` with six hand-mirrored
registries across **four locale files**, and a boot hook in `server/index.js`.
Blast radius crosses every boundary that matters in this repo at once: schema,
a new LLM spawn path, an HTTP contract, the `CONSUMERS` registry, both
`assertSingleHome` consumer maps, `chronology-ordering`'s `filesToScan`,
`ledger-metrics-parity`'s C2.4 anchor, and the CJS↔Vite registry boundary. It
also performs a **destructive test edit** — T7
(`project-plans-api.test.js:905`) is deleted in full, deliberately, taking with
it the only route↔route composition guard the project has, against a
five-claim successor table (T7-C1…C5) where one claim (C4) is intentionally
*not* replaced. The test-plan builds 5 new spec files + 1 e2e boot spec + 7
edited specs, ~40 specs total, with red-first proof obligations on nearly all
of them. Four catalog classes are live simultaneously, three of them repeat
offenders on this exact file family.

---

## 2. Agents to run (in team-build's normal dependency order)

1. **build-triage** — done, verdict **READY** (`build-brief.md`). Worktree
   provisioned at
   `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor`
   on `effort/2026-08-06-auto-group-proposal` off `d3842493`. No blocking
   questions. Non-skippable by construction.
2. **build-planner — IN (discretionary, kept).** The foldable case is "a single
   obviously-ordered task." This is 11 ordered implementation steps whose
   ordering is *load-bearing and counter-intuitive*: the SF-4 extraction is
   sequenced **second, on purpose**, so the coverage gate is
   `buildProbeCoverage`'s third call site from day one rather than a fourth
   hand-copy cleaned up later; registries land before the stages that consume
   them; the T7 deletion and its replacement guard must land in the *same
   commit*; and every red proof has to be performed-and-re-run rather than
   reported. On top of that the build inherits **three unreconciled flag-backs**
   that no downstream agent owns by default — **BO-1** (the technical plan's
   §6.1 claim that T7's anchored response-key-set assertion survives is
   factually wrong per the test-plan's byte-for-byte read; T7 dies in full),
   **BO-2** (§6.1 needs the five-claim T7-successor table copied in), and
   **BO-4** (§9's file list is missing `ledger-metrics-parity.test.js`). Handing
   a known-contradictory plan pair straight to build-test-author and
   build-implementer is how a corrected fact gets silently re-broken. Planner
   reconciles the two documents and sequences the work; that is exactly its job
   and it is not optional at this size.
3. **build-test-author** — always. Authors the ~40 specs red-first per the
   test-plan: M-1…M-9, R-7…R-13, D-4, TT-a…TT-i + TT-read, N-1…N-4, G-1…G-6,
   P-1…P-8, E-5/E-6.5, C-1…C-8. Note the test-plan's own instruction that red
   proofs are **performed, not reported**, and per §9.3
   AGENT-SELF-REPORTED-RED some must be independently re-run by a party other
   than the author — which is a second structural reason a reviewer must exist
   downstream.
4. **build-implementer** — always. Executes technical-plan §10 steps 1–11 in
   order against the reconciled plan.
5. **build-verifier** — always. Full suites (`npm run test:server`,
   `npm run test:client`), targeted `node --test` re-runs, header audit
   (`bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0), the
   vacuity sweeps (`assert.ok(true`, `|| true`, plus the four extra greps the
   first two miss), and independent re-run of the red proofs.
6. **build-reviewer — IN (discretionary, kept, and additionally forced).** See
   §4 — this one is not mine to trim.
7. **build-lead** — always. Produces the single build report `team-status` and
   the downstream QA-fix round read.

---

## 3. Agents skipped

**None.** Every agent in team-build's roster runs.

For the record, so the non-skip is a decision rather than an omission: the two
skips available to me were build-planner ("foldable for a single
obviously-ordered task") and build-reviewer ("skippable only for a small,
low-risk diff"). Neither predicate is remotely satisfied — this is an
11-step, multi-module, schema-plus-LLM-plus-client change set with a
deliberate destructive test deletion. Skipping either would be trimming on a
build that is the opposite of the case the discretion was written for.

---

## 4. Forced back on

Three independent overrides, any one of which alone is sufficient. They apply
to **build-reviewer** specifically:

- **Plan-of-record prohibition.** `technical-plan.md` §11.2 states verbatim:
  *"`intake-qa` and `build-reviewer` are **non-trimmable here regardless of
  mode** (PM-6.1)."* This is a written PM ruling in the approved plan. Direct
  mode makes a roster leaner; it does not overrule the plan the roster is
  building. Confirmed again in §15 Definition of Done: *"Adversarial review
  pass run independently of build/verify, before merge."*
- **Defect-catalog match, four classes, three of them repeat offenders on this
  exact file family.** §9.1 DERIVED-DUAL-VIEW (7th occurrence, and this slice
  opens a *second* axis on it — `unitFacts` gains a second downstream
  comparator via `groupingFacts` → `computeGroupingDigest`, structurally the
  same shape as the occurrence whose divergence was declared "physically
  impossible" and wasn't); §9.3 VACUOUS-GUARD (9/9/4 events across the three
  prior builds of this family — the project's single highest-density recurring
  defect, and this build's replacement-guard design is precisely where its
  `deepEqual(f(X), f(X))` shape wants to reappear); §9.7 HAND-SCOPED STRUCTURAL
  SCAN (6+ occurrences, most recent SF-5 one slice ago **on this exact registry
  pair**, where a build edited the very map it needed to register itself in and
  still didn't); §9.8 OVERLOADED-ABSENCE (promoted last build, recurred
  immediately in the next one, and is live instance #1 of the run-state design
  here). A catalog match always forces the full roster back on for that
  concern. Four matches force it four times over.
- **Empirical track record on this exact surface.** On Slice 2 both
  discretionary agents were kept in both rounds (original build and its QA-fix
  round), and **build-reviewer caught 2 real blockers that a passing,
  mutation-tested build-verifier pass had already certified green — twice.**
  The test-plan records the same pattern holding *three builds running*. A
  green verifier is demonstrably not a substitute for the adversarial pass on
  this file family, which is the whole reason §11.2 was written.

One further boundary worth naming for the kept agents rather than as an
override: the SF-4 extraction and T7 deletion are the only non-additive edits
in an otherwise fully additive slice, and they land inside two existing
handlers that have already diverged once on `requestedAt`. That divergence is
**load-bearing (SF-2/SF-3) and must be preserved, not erased** — a reviewer
who "fixes" it would re-introduce a fixed bug. Reviewer should read
technical-plan §6 before §6.1.

**No override runs the other way** — nothing in this build argues for a leaner
roster than the full seven.
