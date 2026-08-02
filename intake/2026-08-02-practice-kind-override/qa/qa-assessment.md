# QA Assessment — practice-kind-override

> Authored by `qa-strategist`. **This is the document to read first.** It answers:
> is this change adequately guarded, where are the gaps, have we shipped this
> *class* of gap before, and what stops it permanently.

---

## 🛑 Headline — read this before anything else

**This plan cannot be marked "adequately guarded" as currently written, and the
reason is not a missing test — it is a defect in the technical plan itself.**

`technical-plan.md` Step 2.2 rebuilds `coach_observations` (to add
`CHECK(severity IN ('info','warning'))`, which SQLite cannot add via `ALTER
TABLE`) and explicitly models that rebuild on this repo's **`plan_items`**
precedent. In that precedent only the *row copy* is transaction-wrapped; the
`RENAME` / `CREATE` / `DROP` around it are separate, unwrapped statements. The
repo's **`agents`** precedent (`server/db.js:1478-1514`) does it correctly —
the entire rebuild is one `BEGIN; … COMMIT;`. The plan copied the wrong one.

Consequence, walked through concretely:

1. Boot runs `CREATE TABLE coach_observations` (new, empty, **CHECK-bearing**).
2. Process dies before the row-copy transaction commits — OOM, `kill -9`, power
   loss, an operator Ctrl-C'ing a first boot that feels slow after an upgrade.
3. Next boot, the idempotency guard reads `sqlite_master.sql` for
   `coach_observations`, sees `CHECK(severity IN`, and concludes **the migration
   already ran**. It will never run again.
4. Every historical Observation sits orphaned in `coach_observations_old`,
   unreferenced by any code path. The app boots clean. Nothing logs. Nothing
   throws. The Coach feed is simply empty forever.

The WATCH-3 pre-flight scan does not save this either — on that next boot it
counts out-of-enum severities in the *new, empty* table, gets `0`, and also
concludes all is well. **Both independent guards misread the same partial state
as success.**

**A test cannot fix this. A test can only document it.** The recommendation is
therefore a *plan change*, not a test addition: wrap the whole rebuild in one
transaction, matching the `agents` precedent, before or as part of build. That
is roughly five lines and it removes the failure mode entirely — after which the
crash-window test becomes a cheap proof that the fix is real, rather than the
only thing standing between the user and silent total loss of Coach history.

This was found by `qa-risk-analyst` on this pass and is confirmed here directly
against `server/db.js`. It is not in `decisions.md`, not in any WATCH row, and
not covered by any of the six assertions the plan's §6.4 test list specifies.

---

## Change summary

Coach Playbook practices currently have a fixed `kind` (`risk`/`info`/`good`)
and `defaultSeverity` baked into the code catalog. This change lets the operator
override both, per practice, from the Playbook page — stored as
`kindOverride`/`severityOverride` inside the existing
`playbook_practice_config.config` JSON blob, resolved through one widened
`resolvePracticeConfig()`, and **frozen onto each `coach_observations` row at
fire time** so changing an override later never retroactively relabels an
Observation that already happened. It also promotes `severity` to a real enum
with a DB `CHECK`, which — because SQLite cannot add a `CHECK` via `ALTER TABLE`
— forces a one-time rebuild of the `coach_observations` table on every existing
install. Nothing is built yet; this is a pre-build assessment of a technical
plan plus four QA design documents.

---

## Coverage verdict

# **BLIND**

Two independent reasons, either of which alone would justify it:

**1. The change lands squarely on a live, pre-named recurring failure mode with
zero guard.** `PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW carries a design-time
pre-flag dated 2026-08-02 that names *this exact intake by path* and enumerates
the four hand-written readers of "this practice's effective kind" that agree
today **only because the value cannot vary**. This build is what makes it vary.
The cartographer confirmed by grep that not one test in the repo reads
`kind` or `severity` on this surface — `playbook.test.js` returns **zero
matches**. The suite is 48/48 green and would stay 48/48 green if the engine
wrote the wrong kind, if the route dropped the override, or if the preview card
kept showing the stale catalog value. That is the definition of a blind spot,
not a gap.

**2. The highest-severity risk in the change is not test-addressable at all, and
the one meta-test that exists to catch schema mistakes structurally cannot see
it.** `db-migration.test.js`'s §9.5 enforcement meta-test scans for
`/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/g` (line 720). A
rename→create→copy→drop rebuild matches nothing in that regex. **The meta-test
will report clean whether or not the rebuild is ever written, and whether or not
it is atomic.** So the project's own automated §9.5 conscience is silent on the
single most dangerous step in this plan.

**What BLIND does *not* mean here:** it is not a criticism of the four QA design
documents. They are unusually strong — the frozen-snapshot design covers both
scopes, the structural guard has a written red-proof procedure, and the risk
analysis found a real plan defect. BLIND describes the *state of coverage as it
stands today* plus the one planned-but-unclosable-by-test hazard. Once the
atomicity fix and the must-add list below land, this change becomes safe to
ship — see Recommendation.

---

## Current coverage

Baseline actually run by `qa-coverage-cartographer` against HEAD (`f78b2ec`),
targeted at the touched surfaces rather than the full world:

| Suite | Result |
|---|---|
| `node --test server/__tests__/{playbook,db-migration,single-writer-guard}.test.js` | **38/38 pass**, 0 fail, 312ms |
| `npx vitest run src/pages/__tests__/PlaybookPage.test.tsx` | **10/10 pass** |
| **Total** | **48/48 GREEN** |

What that green actually guards, by layer:

- **Engine (`playbook.test.js`, `describe("playbook engine")`)** — fires /
  doesn't-fire / dedup / re-fire / disabled / numeric-threshold-override for
  both practices, asserting `practice_id`, `scope_type`, `scope_id`, `status`,
  `values_json`. **Never asserts `.kind` or `.severity`.**
- **Routes (`describe("playbook + coach routes")`)** — real Express app, real
  HTTP, real temp SQLite. `GET /practices` asserts `enabled`/`config`/`scope`;
  `PUT` asserts persistence, 404, 400-unknown-field, 400-below-min. **Never
  reads `.kind` or `.defaultSeverity` off a response body**, though
  `serializePractice()` emits both.
- **DB** — no dedicated schema test for `coach_observations`. The existing
  `kind` CHECK is guarded "by construction" (every writer passes a catalog
  constant), never by a direct out-of-enum insert test. `severity` has no CHECK
  at all today.
- **Client (`PlaybookPage.test.tsx`)** — 10 tests covering threshold rendering,
  live preview reacting to the *threshold* field, invalid-input Save gating,
  preset chips, save payloads, one card per practice. **No test asserts what
  value reaches `<ObservationCard kind=… />`** at lines 257/335 — the two lines
  this change must fix.
- **Structural precedent that exists and works** —
  `single-writer-guard.test.js` (fs-walk + exact-file-set assertion, proven by
  rogue injection) and `chronology-ordering.test.js` (static SQL scan with a
  dated grandfather list). Both green, neither touches this surface.

Per-surface verdicts from the cartographer: **2 GUARDED** (numeric config/enabled
merge; `validateConfigPatch`'s current numeric-only shape), **2 GUARDED-by-
construction-only**, **10 UNGUARDED** — including every surface this change
actually modifies.

---

## Gaps & test-debt diagnosis

### The UNGUARDED surfaces that matter

1. **The `coach_observations` rebuild's crash window** (P0, silent, total data
   loss) — see headline. No test in the repo, in any of the four QA docs, or in
   the plan's §6.4 list, interrupts a migration. Every migration test this
   project has ever written proves only the *clean-completion* path.
2. **Frozen-snapshot invariant** — the feature's whole point. Nothing writes an
   Observation, changes a config, and re-reads the Observation. Zero coverage.
3. **Both engine call sites** — `evaluateSession()` and `evaluateGlobal()` are
   two independent `insertCoachObservation.run(...)` writers; a green test on one
   proves nothing about the other (§9.4's exact shape). Zero coverage.
4. **"Saved but never applied"** — a PUT that 200s while every read path ignores
   the stored value. Passes any status-code-only test. Zero coverage.
5. **Live-preview wiring (`PlaybookPage.tsx:257`, `:335`)** — invisible to every
   server-side test that will ever exist. Zero coverage.
6. **i18n completeness across all four locales** — named as an invariant in
   `change-brief.md`, then **owned by neither test-design document**.
   `e2e-tests.md` §6 explicitly hands it off ("a static file-presence check, not
   a flow"); `unit-tests.md` §5a asserts English strings only. It fell between
   the two docs.
7. **Client draft-resolver vs. server resolver precedence parity** — this change
   deliberately ships a *second* copy of the resolution rule
   (`playbookStore.ts`'s `resolveKind`/`resolveSeverity`, bounded to unsaved
   draft state). `unit-tests.md` §6 tests that copy against its own assumed
   formula and openly flags that it is unsure of the `null`-vs-`undefined`
   precedence. The structural guard (§2c) scans for raw `practice.kind` reads and
   would **not** catch the two copies disagreeing. This is §9.1's own
   2026-08-01 second-order lesson — *"the guard caught the composer and missed
   the second-order duplicate one call frame away"* — reproduced by design, one
   day later, on the same catalog entry.

### The systemic reasons (not "someone forgot a test")

**Systemic cause A — the repo's table-rebuild idiom is copy-the-nearest-previous
-rebuild, and the majority precedent is wrong.** Verified directly in
`server/db.js`: there are **six** table rebuilds (lines 755, 822, 1063, 1439,
1481, 1589) and **exactly one** — `agents`, line 1478 — is wrapped in a single
`BEGIN; … COMMIT;`. The other five run their DDL as separate autocommitted
statements. There is **no shared `rebuildTable()` helper**, so every rebuild
re-decides atomicity by hand, from whichever neighbour the author happened to
read. The plan read `plan_items`.

**Systemic cause B — every one of those six guards asks a question the
migration's own first statement makes true.** They gate on the *current* table's
shape: `!sql.includes("item_id")`, `!sql.includes("parent_item_id")`,
`sql.includes("'idle'")`, `sql.includes("'slack','discord',…")`, or a
`try { SELECT model … } catch` probe. In every case the very first DDL statement
of the rebuild flips that condition. A half-finished rebuild is therefore
*indistinguishable from a completed one*, by construction. Confirmed:
**zero** queries anywhere in `server/db.js` look for an orphaned `_old`/`_new`
table (`SELECT … FROM sqlite_master WHERE name LIKE '%_old'` appears 0 times).
Five latent instances are live in the shipped product today; this build would be
the sixth.

**Systemic cause C — the §9.5 meta-test enumerates by regex over one migration
shape, so an entire family of migrations is outside its field of view.** It
scans `ALTER TABLE … ADD COLUMN` only. Six rebuilds, zero of them visible to it.
This is the identical *structure* to the §9.2 finding from 2026-08-01 (a scan
whose pattern silently under-scanned and reported clean) — a scanner that
under-scans is worse than none, because the next reader sees a tick.

**Systemic cause D (process, cross-document) — invariants are hand-carried from
the brief into two independently-authored test-design docs with no mechanical
reconciliation.** That is exactly how gap #6 (i18n) ended up owned by nobody:
`e2e-tests.md` correctly declined it, `unit-tests.md` never picked it up, and no
step in the pipeline diffs the brief's checkbox list against the union of the
two designs.

### Have we shipped this class of gap before?

**Two different answers, and the distinction matters.**

**(a) The kind/severity dual-view gap — YES, 5x, and this one is being handled
right.** `PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW, count 5, **OPEN**, with a
live design-time pre-flag naming this intake by path. Plus a second live §9.1
instance already on this exact surface (`resolvePracticeConfig()` vs
`validateConfigPatch()`'s hand-copied field rule, shipped 2026-08-02 in
`b6d372b`) — also **OPEN**, and only *contained* by this plan (shared enum, not
extracted function), not closed. The planned cure for the primary instance
(single resolver + `playbook-resolver-guard.test.js` proven red by injection) is
the correct shape and matches the catalog's stated requirement. The job at build
time is to verify it was **built and red-proven**, not merely described — and to
close the second-order copy gap (#7 above), which is where this same entry burned
us one day ago.

**(b) The non-atomic-rebuild / partial-migration-looks-done shape — NEW to the
QA record, but with FIVE latent instances already shipped.** Checked
deliberately:

- **QA run-log:** five prior runs on this project (`focus-report-fidelity`,
  `focus-calendar-board`, `wip-queue-page`, `focus-untracked-commits`,
  `build-project-manager`). None involves a table rebuild; the 2026-08-01 DB work
  was a plain `ADD COLUMN`. **No prior occurrence.**
- **Catalog §9.5 FRESH-DB-BLIND** is the nearest entry but names a *different*
  failure: a migration that was never written. Here the migration **is** written,
  **does** run, and its own idempotency guard misreads a partial run as a
  finished one. §9.5's prescribed cure (`ALTER TABLE ADD COLUMN` + an
  `UPGRADE_CASES` entry) is mechanically inapplicable to a `CHECK`, and its
  meta-test cannot see the migration at all.

So: **not a regression of a fix**, and not a recurrence — but not a one-off
either. It is a genuinely new class with five unguarded live instances in
`server/db.js` right now, which is why it is being **added to the catalog as
§9.6** rather than logged as an incident on this intake alone. Sara should know
that the first time this project applies its "SQLite can't ALTER a CHECK" lesson
to a table that already holds *real user data* is right now — `detour_dispositions`
(the table that taught the lesson) had no rows when it shipped.

---

## Recommendation

Three tiers, deliberately separated. Tier 1 is a **code change to the plan**;
tiers 2 and 3 are tests.

### Tier 1 — MUST FIX IN THE PLAN (not a test; do this first)

**F1. Wrap the entire `coach_observations` rebuild in one transaction, matching
the `agents` precedent at `server/db.js:1478-1514`.** Concretely: set `PRAGMA
foreign_keys = OFF` *outside* and *before* the transaction (SQLite ignores it
inside one — the `agents` block already gets this right), then a single
`db.exec` of `BEGIN; CREATE TABLE coach_observations_new (…CHECK…); INSERT INTO
coach_observations_new SELECT … FROM coach_observations; DROP TABLE
coach_observations; ALTER TABLE coach_observations_new RENAME TO
coach_observations; COMMIT;`, then restore the pragma and recreate both indexes.
Prefer this **create-new-then-rename** direction over `plan_items`'
rename-first direction: on rollback the original table is still sitting there
under its original name, so even a torn WAL recovery lands on the pre-migration
state. Cost: ~5 lines. Benefit: the failure mode ceases to exist rather than
being merely documented.

**F2. Add orphan detection to the idempotency guard anyway (cheap belt).** Gate
the rebuild on `hasCheck && !orphanExists`, where `orphanExists` is
`SELECT name FROM sqlite_master WHERE type='table' AND name IN
('coach_observations_old','coach_observations_new')`. With F1 this should be
unreachable — which is precisely why it is worth having: if it ever fires,
something happened that the atomic wrap was supposed to prevent. Log loudly and
skip; **do not throw** — `db.js` runs at `require()` time and a throw bricks
boot for every process, which is strictly worse than the condition it reports.

**F3. Keep the plan's existing DoD gate: back up the real `dashboard.db` before
the first boot of the new build, and do the §6.6 manual double-boot walkthrough
against a copy of it.** F1 makes this much safer; it does not make it optional.

If the build team declines F1, then per `risk.md` §8 this **must** land as an
explicit WATCH row in `decisions.md` with the data-loss mechanism spelled out.
My recommendation is unambiguous: don't decline it. Five lines against permanent
silent loss of every Observation on the user's real DB is not a close call.

### Tier 2 — MUST-ADD-NOW TESTS (these gate the change)

Worst-first. Items 2–7 are already specified, in code-level detail, in
`unit-tests.md` / `e2e-tests.md`; item 1 and item 8 are **not in any document
yet** and are additions from this pass.

1. **Interrupted-rebuild test** *(new — not in any doc)*. Build a legacy
   `coach_observations` DB, run the rebuild's statements individually and abort
   partway (throw inside the transaction, or drive the DDL by hand and stop after
   `CREATE`), reopen the file, `require("../db")`, and assert **every original row
   is still readable through `coach_observations`**. This is the test that proves
   F1 actually shipped. Against a non-atomic implementation it fails; against the
   atomic one it passes. That is exactly the signal we want.
2. **Frozen-snapshot regression, both scopes** — `unit-tests.md` §1a
   (`account-weekly-balance`, global) **and** §1b (`session-token-ceiling`,
   session), asserting `kind` *and* `severity` at every step, plus the standalone
   `updateCoachObservationStatus never touches kind or severity` case. Both must
   be **shown red against pre-change code** before they count (§9.3). A single-
   scope version of this test is the §9.4 trap and does not satisfy this item.
3. **Migration / boot tests** — `unit-tests.md` §4a (6 assertions: no-throw,
   CHECK present, rows byte-identical incl. `id`s, both indexes recreated,
   out-of-enum insert rejected, second boot no-op) and §4b (WATCH-3 skip path:
   does not throw, CHECK absent, offending row **not** rewritten). §4b's fixture
   with exactly one bad row among conforming rows correctly satisfies `risk.md`
   §4.2's off-by-one concern. Plus `e2e-tests.md` §4.2 item 8 — boot the **real
   Express server** against the migrated legacy DB and serve
   `GET /api/coach/observations`, proving the whole app survives an upgrade boot,
   not just `db.js`.
4. **`playbook-resolver-guard.test.js`** — all three assertions (server-strict,
   engine-sharpest, client-display-path), **proven red by injecting a rogue
   `practice.kind` reader into both `engine.js`'s `evaluateSession()` and a
   client card**, with that observation recorded in the commit message. Per §9.3,
   a guard with no recorded red state is not a guard. Keep the regexes
   whole-token, per §9.2's 2026-08-01 under-scanning lesson.
5. **"Saved but never applied" round trip** — `unit-tests.md` §3a: PUT 200
   **and** a follow-up `GET` showing `resolvedKind` actually changed. A
   status-code-only test is vacuous for this hazard.
6. **Partial-patch discipline** — `unit-tests.md` §3d: a numeric-only
   `PUT { config: { gapThresholdPct: 30 } }` must leave an existing
   `kindOverride` intact. Requires `in`-based key-presence checks, not
   `=== undefined`. Get this wrong and every ordinary threshold save silently
   eats the operator's override.
7. **Live-preview-before-save, on both cards** — `unit-tests.md` §5b × §5e. The
   *only* place in the entire stack where the lines-257/335 regression can be
   caught. One card passing proves nothing about the other.
8. **Client-vs-server resolver precedence parity** *(new — not in any doc)*.
   Drive one shared table of cases —
   `(catalogKind, kindOverride, draft) → expectedKind`, including the
   `null`-means-clear vs `undefined`-means-untouched distinction — through
   **both** `resolvePracticeConfig()` (server) and `playbookStore`'s
   `resolveKind`/`resolveSeverity` (client), asserting identical results. This is
   the §9.1 second-order form the catalog was burned by on 2026-08-01;
   `unit-tests.md` §6 currently tests the client copy against an assumed formula
   and says so explicitly. Also resolve the naming collision before writing it:
   the brief says `resolveKind`, the plan's Step 9.3 says `resolveDraftKind`.

### Tier 3 — SHOULD-ADD / NICE-TO-HAVE (do not gate the change)

- **i18n four-locale completeness** — a static check that `severityLabel.info`,
  `severityLabel.warning` and the new `playbook.*` keys exist in all four locale
  files. Currently owned by neither test doc. Cheap; assign it an owner.
- **No-re-sync-mechanism check** — the plan's DoD line ("no test anywhere
  asserts live-resolved kind == a stored Observation's kind") is currently a
  human review pass. A one-line grep in the resolver-guard file would mechanize
  it and protect against a *future* reviewer applying §9.1 by rote and
  "fixing" the intentional divergence.
- **Concurrent-process rebuild race** (`risk.md` §4.3) — a manual one-time
  check: start two processes against the same freshly-copied real DB and confirm
  one wins cleanly and the other waits or fails retryably. Worth noting that F1
  makes the losing process fail **loudly at `BEGIN`** rather than interleave —
  loud-and-retryable is the outcome we want. Manual checklist item, not a
  `node:test` case.

### Durable cure (kills the whole class, not just this instance)

Adding the crash test from Tier 2 item 1 guards *this one* rebuild. Two
structural changes stop the next five:

- **D1. One `rebuildTableAtomically({ table, createSql, copySelect, indexes })`
  helper in `server/db.js`,** atomic by construction (the `agents` shape) with
  orphan detection built in. Every future rebuild calls it instead of
  re-deciding atomicity from whichever neighbour it was copied from. Use it for
  `coach_observations` now; retrofit the five existing sites as a **separate**
  follow-up change with its own backup and its own crash tests — do not widen
  this change's blast radius to `plan_items` and `token_usage`.
- **D2. Extend `db-migration.test.js`'s meta-test to see the rebuild family.**
  Today it scans `ALTER TABLE … ADD COLUMN` only. Add a second scan for
  `ALTER TABLE (\w+) RENAME TO \1_old` and `CREATE TABLE (\w+)_new`, and require
  every site it finds to appear in a `REBUILD_CASES` registry that carries a
  legacy-DB case **and** an interruption case — registry-completeness, so a new
  rebuild either ships guarded or fails the suite. This is the same cure that
  paid for itself immediately on §9.2 in 2026-08-01 (the static scan found three
  unrelated pre-existing bugs on its first run). Expect it to light up all five
  existing sites — grandfather them with a dated list and a reason, exactly as
  `chronology-ordering.test.js` does, rather than weakening the scan.

**Is this change safe to ship?** Yes — **after F1 lands and Tier 2 is green and
red-proven.** With F1 in place, the residual risks are all disclosed and narrow
(WATCH-2's invisible severity, WATCH-3's skip path, the accepted client draft
duplication). Without F1, no amount of testing makes it safe: the failure mode is
silent, total, and reachable on the very first boot of the new build against
Sara's real `dashboard.db`.

---

## Open decisions for the user

- [ ] **Atomic rebuild — accept F1 now, or ship the `plan_items`-style
      non-atomic rebuild with a `decisions.md` WATCH row?** (Strong
      recommendation: F1. ~5 lines, matches an existing in-repo precedent, and
      removes a silent-total-data-loss path rather than documenting it.)
- [ ] **Durable cure scope — build D1+D2 as part of this change, or just the
      point crash test?** D2 (the `REBUILD_CASES` registry meta-test) is the one
      that stops the class; it will surface the five existing non-atomic rebuilds
      immediately, which is a feature but does add findings to triage this round.
- [ ] **Retrofit the five existing non-atomic rebuilds now or as a follow-up?**
      (Recommendation: follow-up, separate change, own backup — `plan_items` and
      `token_usage` are not this feature's blast radius.)
- [ ] **Who owns the i18n four-locale completeness check** — client Vitest, or a
      server-side JSON scan? Right now: nobody.
- [ ] **Client draft-resolver — accept the documented duplication plus the parity
      test (Tier 2 item 8), or extract properly?** §9.1's own most recent lesson
      argues for at least the parity test; full extraction was already declined
      once this cycle (Override 1).
- [ ] **Confirm the new catalog entry §9.6 wording** in `PROJECT-CONTEXT.md` —
      added by this pass, shared with `team-intake`, edit freely.

---

*Memory updated:* `~/.claude/skills/team-qa/memory/qa-run-log.md` ✅ (no
project-local QA run-log is configured in `PROJECT-CONTEXT.md`; prior runs for
this project also live in the global fallback) · recurring-issue catalog:
**§9.6 NON-ATOMIC REBUILD added**, §9.1 QA-pass note appended (count unchanged
at 5), §9.5 cross-reference added.
