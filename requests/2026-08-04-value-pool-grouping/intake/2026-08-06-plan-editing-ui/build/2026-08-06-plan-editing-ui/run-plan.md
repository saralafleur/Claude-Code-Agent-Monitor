# Run Plan — `team-build` (direct mode), `2026-08-06-plan-editing-ui`

**Director of Engineering scope-sizing pass**
**Date:** 2026-08-06
**Mode:** `direct` (NOT fast — build brief states full test-plan gate applies)
**Decision: full roster. Both discretionary agents run.**

---

## 1. Scope read

This is not a small change. Slice 4 Phase 4a spans **both tiers of the
application** and mixes three distinct kinds of work in one build: (a) a
server-side **behavioral refactor** — `POST /:id(\d+)/claims`'s single-unit
`new_item` write path is extracted into a new transactional composer
`claimUnitIntoItem` in `server/lib/plan-lifecycle.js`, reducing the route to a
thin delegator while holding a **byte-identical wire contract** (AC-13:
response shape, status codes, five/six named error strings, every pre-existing
claims test passing *unmodified*); (b) a **new capability** — re-parenting plan
items, with a new `reparentProjectPlanItem` prepared statement in `server/db.js`
and a server-side same-plan + cycle guard; and (c) a **new client editing
surface** in `PlanLedgerPanel.tsx` (add top-level/sub-item, edit-in-place,
hierarchy-aware claim `<select>` via a new `flattenItemTree` projection over the
existing `buildItemTree` derivation), plus new `planLedger.*` keys in all four
locales and a reviewed snapshot-baseline regeneration.

Blast radius: 5 product files (`server/db.js`, `server/lib/plan-lifecycle.js`,
`server/routes/project-plans.js`, `client/src/components/PlanLedgerPanel.tsx`,
`client/src/lib/api.ts`), 4 locale files, 1 new server test helper module
(`server/__tests__/helpers/table-writers.js`), 4 edited test files, a snapshot
baseline, and docs. It crosses a **real API boundary** (a public route's write
path is re-plumbed under a no-change contract), a **schema-adjacent boundary**
(a new writer into `project_plan_items`), and a **cross-cutting derivation
boundary** (`buildItemTree` goes from one consumer to four). It carries a
first-commit doc obligation on the effort branch (`catalog-patch.md` then
`catalog-patch-qa.md` into `PROJECT-CONTEXT.md` §9.3/§9.9, both patch files
deleted in the same commit; dated `## Corrections` appended to the parent
`request.md` per `DEC-S4-5`). And it fixes a **found-live defect**: the existing
`D4 "… is atomic"` test has been green since 2026-08-02 without proving
atomicity, so a validation failure can currently commit an orphan plan item.

**Four mandatory durable-cure obligations from this project's own defect
catalog are in scope** (§9.3/§9.9 NAME-OVERCLAIMING GUARD, §9.1
DERIVED-DUAL-VIEW, §9.7 HAND-SCOPED STRUCTURAL SCAN, §9.8 OVERLOADED-ABSENCE),
and a fifth catalog entry (§9.4 FIX-ROUND-REGRESSION) is structurally implicated
by the refactor's shape. That alone settles the roster.

---

## 2. Agents to run

Ordered; the skill's existing dependency order is preserved.

1. **`build-triage`** — structural, already complete. Verdict **READY**, no
   blocking open questions, worktree provisioned and independently verified
   clean at `d3842493`.
2. **`build-planner`** — **RUNS.** See §2.1.
3. **`build-test-author`** — structural (red-first TDD core). Authors the red
   evidence: D4 rewritten (not extended) + PX forced-throw composer proof, C3
   cross-consumer equality over a *reordered* input, P1-P7 cycle rejection at
   depth ≥ 4, C7 grandchild exclusion at 4 levels, G-1/G-2 over the new derived
   `assertTableWritersSingleHome` helper.
4. **`build-implementer`** — structural. Product change only after red is
   observed and recorded.
5. **`build-verifier`** — structural. Green-after evidence, `npm run
   test:server`, `npm run test:client`, the three mandatory §9.7 mutation
   proofs, and confirmation that every pre-existing claims test passes
   unmodified (AC-13).
6. **`build-reviewer`** — **RUNS.** See §2.2.
7. **`build-lead`** — structural. Synthesizes the single build doc that
   `team-status` and downstream skills read.

### 2.1 Why `build-planner` runs

The "foldable for a single obviously-ordered task" exemption does not come close
to applying. The ordering here is **real, non-obvious, and multi-directional**:

- **Composer-before-caller.** `claimUnitIntoItem` and `reparentProjectPlanItem`
  must exist in `plan-lifecycle.js` / `db.js` before `project-plans.js`'s route
  can be reduced to a delegator. Getting this backwards produces a transiently
  broken route with a green-looking suite.
- **Helper-before-guard.** The derived `assertTableWritersSingleHome` helper
  (`server/__tests__/helpers/table-writers.js`) must exist before the G-1/G-2
  guard tests that consume it — and the helper itself parses `server/db.js`'s
  `stmts` registry, so it has a dependency on the very file this build is adding
  a statement to. That is a genuine ordering hazard, not a formality.
- **Red-before-product, with a cross-author constraint.** The DoD requires D4's
  red to be observed **by someone other than its own author**, and requires
  red-before/green-after pasted as real command output. That is a sequencing
  contract across two agents; somebody has to own writing it down.
- **First-commit doc obligation.** `catalog-patch.md` **then**
  `catalog-patch-qa.md` applied to `PROJECT-CONTEXT.md`, both deleted in the
  same commit, plus the parent `request.md` `## Corrections` append. Order
  matters (the QA patch amends the first), and this is explicitly owed to
  `build-planner`/`build-implementer` rather than to triage.
- **Scale.** The technical plan already carries **14 dependency-ordered
  implementation steps** across §4, and the test plan carries its own §4
  sequence. A 14-step, two-tier, two-plan build with a superseded sub-plan
  (test-plan §6 supersedes technical-plan's G-A/G-B) needs one reconciled task
  list, or the implementer will silently build the superseded version.

That last point is the decisive one: **the two plans do not agree on the §9.7
guard's shape.** They correspond, but test-plan §6 *upgrades* technical-plan's
hand-scoped G-A/G-B to a derived helper. Someone must write down, before
implementation, that the derived helper is the binding requirement and the
hand-scoped fallback is permitted **only** if the derived form cannot be built
without weakening any of its five checks. Folding the planner would leave that
reconciliation to be improvised mid-build.

### 2.2 Why `build-reviewer` runs

The "small, low-risk diff" exemption fails on every axis, and is independently
**forced back on** by the catalog (§4).

- **Not small:** 5 product files across server and client, 4 locales, a new test
  helper module, 4 edited test files, a snapshot baseline, docs.
- **Not low-risk:** a public API's write path is re-plumbed under a
  byte-identical-contract requirement (AC-13). This is precisely the class of
  change where a defect is invisible to a green suite — the contract holds for
  the tested inputs and drifts on an error string, a status code, or a field
  order that no test pins. The brief's own risk row says a test needing edits to
  pass means the refactor is wrong; only an adversarial reader of the *diff*
  will catch the inverse case, where the refactor is wrong and no test noticed.
- **Highest-defect surface, named:** `PlanLedgerPanel.tsx` and
  `project-plans-api.test.js` are called out in `decisions.md` `DEC-S4-1`
  constraint 3 as **"this project's highest-defect surface."**
- **The build creates its own new §9.8 exposure.** A re-parent cycle silently
  erases every member of the cycle from `buildItemTree`'s `roots` with no error
  anywhere. Both the structural guard (P4-P7) and the UI exclusion (C7) are
  required; verifying that *neither* was quietly downgraded to the other is
  review work, not verification work.
- **A live "green but vacuous" defect is already proven to exist in this exact
  code.** D4 sat green for four days while not testing what its name claimed.
  That is direct, dated evidence that this surface's test suite has previously
  failed to detect its own gap — the exact condition under which skipping
  adversarial review is most expensive.

---

## 3. Agents skipped

**None.** No agent in the `team-build` roster has an angle that is inapplicable
to this change. Both discretionary slots are exercised in favor of running.

---

## 4. Forced back on

Even had I sized this leaner, the following would independently override a
skip. Recording them explicitly so the call is auditable:

1. **§9.4 FIX-ROUND-REGRESSION (defect catalog, `PROJECT-CONTEXT.md`:1042)** —
   forces `build-reviewer` on outright. Its stated acceptance criterion is that
   a fix round on this surface **"gets its own adversarial review pass over the
   fix diff, with the same standard as the original build — not a re-run of the
   suite that was already green when the blockers were found."** This build is
   exactly that shape: an our-cost bug carve-out (`DEC-S4-2`) folded into feature
   work, on a surface where the suite was green throughout the last two silent
   regressions (N1, N2). Its documented failure mode — a fix that is correct for
   the caller that motivated it and **over-applies to a sibling caller** — is
   the precise hazard of turning `POST /:id/claims` into a delegator over a
   shared composer. `build-verifier` re-running the suite does not satisfy this
   entry; the catalog says so in as many words.
2. **§9.7 HAND-SCOPED STRUCTURAL SCAN (7 occurrences, OPEN, "cure remains
   half-built")** — the test plan found a **live fifth writer** at
   `plan-lifecycle.js:288-290` (an inline `db.prepare(...)` inside legacy
   `doImport` doing what the new `reparentProjectPlanItem` does) that no
   hand-scoped guard would have seen. An open, repeatedly-recurring entry whose
   cure is admittedly incomplete, with a newly-discovered instance in the very
   file being edited, is the strongest possible case for full-roster treatment.
   The three mutation proofs (rogue call site → red; inline `.prepare` write →
   red; undispositioned new `stmts` entry → red) are **mandatory before the
   guard counts as built**; weakening any of the five checks to keep the derived
   form is explicitly not permitted, and someone independent of the author must
   confirm that no such weakening occurred.
3. **§9.1 DERIVED-DUAL-VIEW (7 prior occurrences, most recently 2026-08-05)** —
   `buildItemTree` gains consumers #2, #3, and #4 in this single slice. The
   mandated C3 cure has a named vacuous degenerate form
   (`deepEqual(f(X), f(X))`) that this catalog has been burned by before;
   detecting that the shipped C3 collapsed into the degenerate form is diff-review
   work.
4. **Cross-subsystem boundary** — server (`db.js` → `plan-lifecycle.js` →
   `routes/project-plans.js`) and client (`PlanLedgerPanel.tsx`, `api.ts`, 4
   locales, snapshot) in one change set, under a no-change wire contract. Two
   independent callers rely on the composer being shared; the boundary is real.
5. **`WATCH-S4-A` merge-order collision (carry-forward, not a blocker)** —
   `PlanLedgerPanel.tsx`, `PlanLedgerPanel.test.tsx`, all four locale files, and
   `screens.snapshot.test.tsx` are also touched by the unmerged Slice 3 branch
   (`effort/2026-08-06-auto-group-proposal`, tip `72feac9`, +363 lines on the
   same component). Whichever slice merges second rebases and **reviews** the
   snapshot diff — never blind-regenerates it, per `CLAUDE.md`'s testing policy
   and the tracked watch row. `build-implementer` and `build-reviewer` must both
   carry this forward; it is not a 4a build blocker (4a merges into `master`,
   not into Slice 3's branch).

---

## 5. Standing notes for the run

- **Not fast.** The full test-plan gate applies; no QA angle is deferred.
- **File headers are binding.** The new
  `server/__tests__/helpers/table-writers.js` must carry the header per
  `.claude/rules/file-headers.md`; `bash
  .claude/skills/file-headers/scripts/check-headers.sh` must exit 0.
- **Worktree:**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-plan-editing-ui/Claude-Code-Agent-Monitor`
  on `effort/2026-08-06-plan-editing-ui`, forked from `master` at `d3842493`.
  All work happens there — the main checkout is dirty with a **confirmed
  unrelated** live concurrent session (PID 264, working
  `requests/2026-08-06-session-stakeholder-summary/`) and must not be written to.
- **Phase 4b is out of scope** (`DEC-S4-1`), deferred with named trigger
  `WATCH-S4-C`; it depends on Slice 3's unmerged `value_groups` schema.
