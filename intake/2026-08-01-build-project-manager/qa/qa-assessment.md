# QA Assessment — build-project-manager (layers 4–6)

> Authored by `qa-strategist`, 2026-08-01. **This is the document to read
> first.** It answers: is the *planned* test coverage adequate, where are the
> gaps, have we shipped this class of gap before, and how do we stop it.
>
> **Framing:** nothing is built yet. This assesses the coverage *designed*
> across `supporting/{coverage,risk,unit-tests,e2e-tests}.md` against the risks
> those same documents identified — not a diff of shipped code. The verdict
> below is about the plan, not about `master`.

## Change summary

This build adds the missing middle of the 7-layer portfolio model as a net-new
server-side subsystem: plan items get an out-of-band `target_date` and a single
shared pace computation (Layer 5); every undeclared detour gets a durable,
resolvable disposition, and a `fold_in`/`new_item` verdict now **writes real
content into `AGENT-PLAN.md`** unattended, through one guarded path that
re-runs the existing ingest so `plan_items` keeps exactly one writer (Layer 4);
and an in-process scheduler uses deterministic rules to decide *whether* to
escalate plus one batched `claude -p` call to decide *what* a flagged detour is
(Layer 6). Two new tables, one new column, three new routes, two new CLI
commands, no client changes. The headline fact: **this is the change that ends
"the dashboard never writes `AGENT-PLAN.md`."** That file is a real, human-owned
document, and after this ships an LLM classification can reach it with no human
reading the exact text first.

## Coverage verdict

**GAPPED**

Not `BLIND` — and that's a genuine improvement over this project's last four QA
runs. Both recurring-defect entries were pre-flagged at *design* time for the
first time in this catalog's history, and the plan carries real countermeasures
aimed at each: DEC-14 pins one write-composer, the unit design contains an
out-of-order-insertion regression test for two of the new queries, and the
`sanitizeLlmPlanText` suite correctly asserts on **parse-back through
`parsePlanMarkdown`** rather than on the sanitized string. On the two headline
traps you asked about specifically:

- **`AGENT-PLAN.md` corruption / data loss — well covered, one real hole.** The
  optimistic-lock conflict tests, the "human's bytes survive byte-for-byte"
  assertions (at both unit and full-tick level), the byte-identical-after-
  rejection caps tests, the `atomic-file.js` failed-rename test, and the
  adversarial sanitizer table are collectively a strong design. **But nothing
  in either test document asserts a backup file actually lands** — zero
  occurrences of "backup" across `unit-tests.md` and `e2e-tests.md`, while
  `technical-plan.md` §7's entire rollback story and WATCH-8 both depend on
  those backups existing. The recovery path for the worst-case outcome is the
  one part of the data-loss story with no automated proof.

- **Silent second `plan_items` writer — *not* adequately covered.** The plan
  catches a second writer in *today's* implementation (the "real re-ingest
  produces the row" ordering assertion would fail a write-back that called
  `upsertPlanItem` directly). It does nothing about a *future* second writer,
  which is the actual failure mode this project has hit four times. The
  Definition of Done's mitigation is a **manual grep run once at ship time**;
  `unit-tests.md` §8 lists three grep gates and none of them is the
  single-writer check. More seriously: **`decisions.md` WATCH-11 states its
  mitigation is "applied in `test-plan.md`" — a registry-style meta-test
  asserting exactly one call site of the write primitive. That file does not
  exist yet, and no such test appears anywhere in `unit-tests.md` or
  `e2e-tests.md`.** A WATCH row is currently closed against a mitigation that
  exists only as a sentence.

Held at GAPPED rather than ADEQUATE by five specific, cheap-to-close items (§
Recommendation). None of them requires redesigning anything; four are additive
tests and one is a two-line export change.

## Current coverage

**Baseline (independently run by the cartographer, twice):** `npm run
test:server` → **1087 pass / 0 fail** (250 suites, ~37s), plus a targeted
7-file subset at 178/178. Clean tree, this effort's files confirmed absent.
Client suite not run — zero client changes ship this round (WATCH-3).

There is no separate integration or e2e layer in this repo. Everything
server-side is one flat `node --test server/__tests__/*.test.js` glob; the
"bucket" unit is the spec file, and isolation comes from each file setting its
own temp `DASHBOARD_DB_PATH` before `require("../db")`.

What actually guards these surfaces today:

| Surface | Today |
|---|---|
| `plan-ingest.js` parse + ingest | **GUARDED** — `plan-ingest.test.js` (21 tests), `plans-api.test.js` |
| `focus-inference.js` `inferSession`/digest/classify | **GUARDED** — 670-line suite, including two dedicated §9.2 chronology-proxy regression tests |
| `plans.js` existing routes | **GUARDED** — `plans-api.test.js` |
| `cc-mutate.js`'s `atomicWriteFile` (extraction source) | **PARTIAL** — exercised only through `cc-config.test.js`'s route-level assertions; no unit test of the primitive |
| `plan_items` schema (current columns) | **GUARDED** via consumers; no dedicated `db.test.js` |
| `plan_items.target_date` + its `ALTER` migration | **UNGUARDED** — see below, sharper than the cartographer flagged |
| `detour_dispositions`, `decision_queue`, all new routes/CLI/schedulers, `pace.js`, `detours.js`, `plan-writeback.js`, `reconciliation.js`, `atomic-file.js` | **UNGUARDED** — none exist |
| `startBackgroundServices` scheduler wiring | **UNGUARDED (pre-existing)** — no test calls `startFocusAudit`/`startFocusInference` either; consistent accepted gap, fine to inherit if stated as a decision in the new file's header |

**One correction to the coverage map, in your favour and then against it.**
`coverage.md` says this repo has *no* ALTER-migration test precedent. A file
named `server/__tests__/sessions-transcript-path-migration.test.js` does exist
— so there *is* a template. But read it: `before()` creates a **brand-new temp
DB**, and the assertion `PRAGMA table_info(sessions)` contains
`transcript_path` is satisfied entirely by the `CREATE TABLE` half. It never
seeds an old-shape DB with the column absent, so **it never executes the
`ALTER` path it is named after.** `server/db.js` carries 35 `ALTER TABLE`
statements and not one of them has ever been exercised by a test. The
cartographer's conclusion was right and is actually worse than stated: there
is a test that *looks* like this is covered, which is exactly how the gap has
survived every column this project has ever added.

## Gaps & test-debt diagnosis

Five gaps, worst first. Each is stated with its **systemic** cause, not just
the missing test.

**1. The upgrade path (`ALTER`) is invisible to the entire test suite — and
you are the person who breaks first.** Every spec file in this repo sets
`DASHBOARD_DB_PATH` to a *fresh* temp file. That is a good isolation
convention and it is also why 100% of the 1087-test suite exercises the
`CREATE TABLE` branch and 0% exercises the `ALTER` branch. If Layer 5's
`try { SELECT target_date } catch { ALTER TABLE plan_items ADD COLUMN ... }`
block is wrong, missing, or typo'd, every test passes, every fresh install
works, and **your live dashboard DB — the one with real data in it — has no
`target_date` column, so `setPlanItemTargetDate` throws at runtime.**
*Systemic cause: the test harness's own isolation design makes the upgrade
path structurally unreachable.* This is a genuinely new class for this
project, not in the catalog, and it will recur on literally every future
column.

**2. §9.1 DERIVED-DUAL-VIEW, write-sequence form: no cross-call-site test, and
the human-resolve path never does a real write anywhere.** `unit-tests.md` §4c
proves the resolve route calls `applyDisposition` (write path stubbed);
`unit-tests.md` §5b proves the reconciliation tick calls it (write path
stubbed); `e2e-tests.md` §4.5 runs the full real write, but **only through the
reconciliation path**. §4.2 explicitly stubs the write for the route. So
consumer #2 gets real end-to-end proof, consumer #1 gets none, and **nothing
asserts the two produce the same bytes for the same inputs** — which is
verbatim what `PROJECT-CONTEXT.md` §9.1's own acceptance criterion demands
("enforced by a cross-consumer test — not eyeballing two UIs") and what
`coverage.md` §3 named as the one check not to skip. *Systemic cause: test
scope is per-module, not per-shape.* This repo's one-spec-file-per-module
convention means each side's test naturally lives in its own file with the
other side stubbed; a cross-call-site test belongs to no module, so it is
nobody's file and does not get written. That is the **identical** root cause
recorded four times on the client side ("test scope is per-consumer, not
per-shape") now reproducing itself verbatim on the server.

**3. No structural guard against a future second writer / second composer —
and WATCH-11 already claims otherwise.** The DoD's mitigation is a manual grep
at ship time; `unit-tests.md` §8's three grep gates cover DEC-14 spelling,
DEC-12 residue, and seam usage, but **not** direct `plan_items` inserts and
**not** `appendPlanItem`/`appendSubItem` call sites outside `plan-writeback.js`.
`decisions.md` WATCH-11 asserts a registry-style meta-test was "applied in
`test-plan.md`" — that file does not exist and no such test appears in either
architect document. *Systemic cause: `decisions.md` and the QA artifacts are
hand-synced with no mechanical cross-check, so a WATCH row can be marked
mitigated by a document that was never written* — the same shape as the DEC-6
i18n-key omission from the `focus-calendar-board` run (2026-07-26). A manual
grep is also precisely the check a busy future change skips.

**4. §9.2 covers 2 of the 5 named queries, and misses the one that changes an
escalation decision.** `coverage.md` §3 and `risk.md` §2 both enumerate five
new queries needing `ORDER BY created_at …, id …` before `LIMIT`.
`unit-tests.md` §4g writes the trap-defeating out-of-order fixture for
`backfillDeclaredDetours` and `listPendingDetours` — correctly, cloning the
existing `focus-inference.test.js` pattern. It does not write one for
`listStaleResolvedDetours`, `listDecisionQueue`, or **Layer 6's
detour-volume-ratio lookback**. That last one is the one that matters: §5a's R2
tests are fixture-driven over ratio and session-count combinations with no
out-of-order insertion anywhere, so a chronology bug there makes R2 flag or
skip the *wrong sessions* while every test passes. `risk.md` trap #3 asked for
a shared `assertOrderedByCreatedAt()` helper to lower the activation energy for
the next query; it did not land. *Systemic cause: the guarded-query list is
enumerated by hand in prose and re-typed by hand into a test table, so a query
named in one document and not the other ships unguarded.*

**5. WATCH-8's rollback story has zero automated proof.** No test in either
document asserts a timestamped backup lands under
`<cwd>/.claude/agent-plan-backups/`. `technical-plan.md` §7's entire recovery
path depends on it, and WATCH-8 currently defers verification to the live
trial. *Systemic cause: backups are a side effect of the write, not a return
value, so nothing in the natural assertion surface of the function points at
them.* One `fs.readdirSync` assertion closes this.

Two smaller items, correctly identified and correctly triaged as accepted
tradeoffs, noted so they stay decisions rather than oversights:
`sanitizeLlmPlanText` hand-rolls its own newline definition instead of sourcing
`plan-ingest.js`'s `/\r?\n/` (WATCH-11's second half — the field regexes *are*
imported, which is most of the value, but the line-boundary definition is
still duplicated); and the `setInterval` registration for `startReconciliation`
inherits its two siblings' untested status.

**Have we shipped this class of gap before?** **Yes — this is the 5th cycle,
across two catalog entries, one of which is a regression of the fix itself.**

- **§9.1 DERIVED-DUAL-VIEW** — status **WATCH** (design-time pre-flag
  2026-08-01, count deliberately not incremented). Four prior touches:
  `2026-07-26-focus-report-fidelity` (BLIND), `2026-07-26-focus-calendar-board`
  (GAPPED), `2026-07-28-wip-queue-page` (GAPPED),
  `2026-07-31-focus-untracked-commits` (BLIND). **Escalate this as
  regression-of-the-fix, not a fresh add.** The `wip-queue-page` run
  recommended promoting this to a formal catalog entry at its 3rd occurrence;
  that wasn't acted on and a 4th shipped; it was finally promoted into
  `PROJECT-CONTEXT.md` §9.1 during the *last* cycle. This is therefore the
  **first change to run with the catalog entry live and enforceable — and the
  planned test suite still does not implement the entry's own stated
  acceptance criterion.** The catalog entry *is* the fix; a plan that doesn't
  comply with it is that fix regressing on its first outing. Gap #2 above.
- **§9.2 row-id-as-chronology-proxy** — status **WATCH** (design-time
  pre-flag 2026-08-01). Three prior code instances (`6e9a443`, `b3a2cc9`, the
  `focus-inference.js` `buildActivityDigest()` fix). This plan is the first to
  apply the countermeasure *before* the bug ships, which is the catalog
  working as designed — but at 2 of 5 queries. Gap #4 above.
- **Migration/upgrade-path blindness** — **genuinely new**, no catalog entry,
  zero confirmed live occurrences. Gap #1 above. Proposed as a new §9.3 entry
  (see Open decisions — not added unilaterally, since the catalog's own
  criterion is "rediscovered more than once" and this has zero observed
  occurrences).
- **Meta-pattern, cross-project:** "`risk.md`'s named required assertion
  doesn't mechanically land in the test-design doc" — seen in
  laundryroom-alerts (2026-07-17), todo-ios-app (2026-07-19), rule-manager-v2
  (2026-07-24), focus-report-fidelity (2026-07-26); it did *not* repeat on
  wip-queue-page or focus-untracked-commits. **It repeated here**, on three
  counts: risk trap #2's structural guard, trap #3's shared ordering helper,
  and trap #1's line-boundary coupling all appear in `risk.md` and in
  WATCH-10/11, but not in `unit-tests.md`.

## Recommendation

**Must-add-now — these gate the change.** All five are additive and cheap; none
changes the design.

1. **`server/__tests__/db-migration.test.js` — upgrade-path test for
   `target_date`.** Seed a DB file, `ALTER TABLE plan_items DROP COLUMN
   target_date` (or build the old shape directly), then re-open through a
   cache-busted `require("../db")` and assert the column now exists and reads
   `NULL` on pre-existing rows. Write it **generically** so future columns
   inherit it. Highest priority: it is the only gap on this list that breaks
   *your own live database* on day one with a fully green suite, and the
   existing `sessions-transcript-path-migration.test.js` gives a false sense
   that it's already covered.
2. **Cross-call-site byte-parity test** (`reconciliation-full-tick.test.js` —
   it already has the fixture harness). Drive the same disposition inputs
   through `routes/detours.js`'s **real, unstubbed** write path and through
   `reconciliation.js`'s real path against two identical fixture cwds; assert
   the resulting `AGENT-PLAN.md` bytes are identical modulo the minted `id`.
   This is §9.1's acceptance criterion made executable, and it simultaneously
   closes the "human-resolve path never does a real write in any test" hole.
3. **Executable single-writer meta-test**, replacing the DoD's manual grep:
   a spec that scans `server/**/*.js` and asserts `upsertPlanItem` has exactly
   one call site (`plan-ingest.js`), and that `appendPlanItem`/`appendSubItem`
   have none outside `plan-writeback.js`. This is WATCH-11's already-claimed
   mitigation; either build it or reopen the row.
4. **§9.2 ordering tests for the remaining three queries**, detour-volume
   lookback **first** — it is the one where a chronology bug silently changes
   an escalation decision. Write them via a shared
   `assertOrderedByCreatedAt(queryFn, seedFn)` helper, per `risk.md` trap #3.
5. **One backup-landed assertion** in `plan-writeback.test.js`: after a
   successful `appendPlanItem`, `fs.readdirSync(<cwd>/.claude/agent-plan-backups/)`
   is non-empty and the newest entry's content equals the pre-write file.
   Closes WATCH-8's automated half.

**The durable cure — what actually kills the class.** Items 1, 3 and 4's helper
are already the structural fixes rather than point tests; two more make the
whole family impossible rather than merely tested:

- **Don't export `appendPlanItem`/`appendSubItem` at all.** Keep them
  module-private and export only `applyDisposition`. `risk.md` proposed this
  and it is strictly better than any meta-test: a future third caller has no
  low-level function to misuse. Cost: `unit-tests.md` §3a currently imports
  them directly and would need to test through `applyDisposition` instead —
  the only real tradeoff on this page.
- **Export the line-split source of truth.** Have `plan-ingest.js` export the
  `/\r?\n/` delimiter and have `sanitizeLlmPlanText` import it, the same way it
  already imports `ID_LINE_RE` and the caps. Turns WATCH-11's second half from
  a test problem into a non-problem.
- **Derive the §9.2 guarded-query list from one exported array** rather than
  from prose, with a meta-test asserting every entry has an ordering test —
  same registry-completeness shape `unit-tests.md` §4a already uses well for
  `DISPOSITIONS`. This is the direct cure for "enumerated by hand, so a new
  entry ships unguarded."

**Is it safe to ship once the must-adds are in?** For the automated half, yes —
this is one of the better-designed test plans in this project's QA history, and
the five additions above bring it to genuinely adequate. But hold the line on
**DEC-7**: a green suite is explicitly *not* sign-off here. No test can tell you
whether the LLM's unattended classifications are *useful* rather than merely
well-formed, and `18196dc` ("Remove the WIP queue feature," reverted two days
after shipping) is this repo's own precedent for exactly that failure. Review
real decision-queue output and the actual text written into your real
`AGENT-PLAN.md` files before calling this done.

## Open decisions for the user

- [ ] **Durable cure now, or point tests only?** Recommendation: take items 1,
      3, and the §9.2 registry meta-test now — all three are cheap and all
      three kill a class rather than an instance. Item 2 is required either
      way.
- [ ] **Un-export `appendPlanItem`/`appendSubItem`?** Strictly safer, but it
      invalidates `unit-tests.md` §3a's direct-import structure and pushes
      those tests through `applyDisposition`. Your call on whether the test
      rewrite is worth removing the footgun permanently.
- [ ] **WATCH-11 is currently overstated** — it claims a mitigation applied in
      a `test-plan.md` that doesn't exist. Either the qa-lead's `test-plan.md`
      must land item 3 verbatim, or the row should be reworded to
      "PENDING, mitigation not yet designed." Don't leave it as-is.
- [ ] **Add `PROJECT-CONTEXT.md` §9.3 for migration/upgrade-path blindness?**
      Genuinely new class, zero observed live occurrences, certain to recur on
      every future column. Not added unilaterally because the catalog's stated
      criterion is "rediscovered more than once" — one word from you and it
      goes in.
- [ ] **Accept the `startReconciliation` `setInterval` wiring as untested**,
      consistent with its two siblings? Recommendation: yes, but say so in the
      new spec file's header so it reads as a decision, not an oversight.

---
*Memory updated:* `~/.claude/skills/team-qa/memory/qa-run-log.md` ✅ ·
`PROJECT-CONTEXT.md` §9.1 and §9.2 — dated QA-pass notes appended, **counts not
incremented** (per each entry's own "increment only if a real duplication
ships" instruction; nothing is built yet) ✅
