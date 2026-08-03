# Risk & Regression Analysis — 2026-08-02-plan-lifecycle-value-ledger

> Authored by `qa-risk-analyst` (team-qa, PRE-BUILD). Inputs: `qa/change-brief.md`,
> `technical-plan.md` (§3.1 DDL, §5, §7), `decisions.md` (DEC-P1..P6, DEC-2..19),
> `PROJECT-CONTEXT.md` §9.1–§9.7 + CWD-IDENTITY-FANOUT candidate. All file/line
> claims below re-verified against the live tree on 2026-08-02, not taken from
> the plan.
>
> North star: **green suite ≠ no drift.** This project has shipped exactly that
> failure repeatedly (§9.3: vacuous guards survived two BLOCKED verifier passes;
> §9.5: a schema change that only an accidental test coupling caught; §9.7:
> scans that report clean while blind). Every trap below names the assertion
> that would catch it.

---

## 1. Blast radius (beyond the literal diff)

**1a. `server/db.js` → the shared user-global DB, four processes.**
`DB_PATH` resolves to `~/.claude/agent-dashboard/dashboard.db`; `db.js` runs at
`require()` time for the server, MCP server, desktop app, and VS Code extension.
A throwing statement in the new `CREATE TABLE` blocks bricks boot for **all
four** against the one shared file (§9.6 "never throw" note). The first time any
checkout with slice-1 code boots — including a test run in a worktree, since
part of the server suite runs against the real DB (§9.5's `pricing-calc.test.js`
precedent) — the three tables land in Sara's live DB. Rollback is priced
(orphaned additive tables), but the DDL must be right the first time it touches
the real file. **The insertion anchor is itself moving:** the plan says "after
`detour_dispositions`, ~line 696" — verified at `server/db.js:696` today, but
master's working tree holds **+129 uncommitted lines in `db.js` right now**
(the Refresh/Project-Detail work). Locate by grep, never by line, and rebase
before writing DDL.

**1b. The three live plan-ingest triggers.**
`deletePlanItemsNotIn` is live at `server/lib/plan-ingest.js:396` (statement at
`server/db.js:2590`), fired by three trigger paths. The additive design makes it
structurally unreachable for `project_plan_items` **only while no code path
bridges the layers**. The blast radius is any convenience added at build time —
a "sync imported items on re-ingest" helper, a writeback re-point (DEC-10 is
PENDING, recommendation is no-change) — that gives ingest a write path into the
new tables. T4's full-ingest-cycle + static rogue-writer scan is the fence.

**1c. Project Detail request path (perf + collision).**
`assembleValuePool` on `GET /pool` does subprocess and fs work per request:
`detectTrunkDrift` (git log walk), `repoRootFor` (two `git rev-parse` per cwd),
`realpathSync` per cwd, `scanIntakeForCwd` (directory walk). Slice 5 wires this
into a page that is already 1,400+ lines, currently **dirty on master
(+1,287 uncommitted lines)** and *also* modified in the trunk-drift worktree.
No caching/debounce decision exists anywhere in the plan (DEC-6 bounds lookback
depth, not request cost). A slow pool doesn't just degrade the page — it
degrades the **slice-4 gate itself** (Sara judging "signal or noise" through a
10-second `ccam ledger pool`).

**1d. Cross-boundary contracts.**
- `VALUE_SOURCES`/`ATTRIBUTION_TIERS` exports must mirror the `CHECK`
  constraints byte-for-byte (two sides of the DDL boundary; routes validate
  against exports).
- `unitKey(source, ref, cwd)` must be computed identically at pool assembly,
  claim-subtraction, and dedupe — it is the serialization-boundary token of this
  feature (see trap T2 below).
- WS types `project_plan_updated`/`value_claim_updated` additive;
  `plan_updated`'s `{ plan, items }` payload has 6 existing call sites and must
  not change.
- `chronology-ordering.test.js:80-86` — verified still the hand-typed 5-file
  list; all four new server files are born outside it (§9.7).
- i18n: `projectDetail.json` ×4 locales — key-set parity; **all four files are
  dirty on master and modified in the trunk-drift worktree** right now.
- `scanIntakeForCwd` (verified public, `server/lib/intake-scan.js:168`) gains a
  second consumer — its output shape becomes a contract.
- `detectTrunkDrift(repoPath, { seenShas, lookbackDays, maxCommits, timeout, now })`
  — signature verified only in the **uncommitted** worktree
  (`efforts/2026-08-02-trunk-drift-detection/…`, `?? server/lib/git-refs.js`,
  `?? server/lib/trunk-drift.js`); must be re-confirmed at merge, including the
  exact semantics of `seenShas` (exclusion set, not since-marker).

**1e. Guard-helper reuse.** The trunk-drift worktree already contains an
uncommitted `server/__tests__/helpers/single-home.js` — the §9.7
`assertSingleHome` cure. If this build hand-rolls its own single-home/rogue-writer
scanner instead of consuming that helper post-merge, we get two copies of the
guard-scoping logic — §9.1's "scan for copies of its *helpers* too" lesson,
recurring at the meta level.

---

## 2. Invariants that must hold (testable statements)

| # | Invariant | Testable form | Pinned by |
|---|---|---|---|
| I-1 | **Closure only through plan** (DEC-P6) | No API/DB path marks a value unit closed except `POST /:id/close`; closed plans + their claims reject every write/delete; no reopen | T2, T5 negatives + closure single-writer guard (export-derived scope, red-proven) |
| I-2 | **Claims persisted, never recomputed** | Claim rows byte-identical across re-assembly with grown git/intake history; server restart preserves claims and closed generations | T3 ratchet-across-two-runs; trial DoD |
| I-3 | **Pool excludes claimed units at first claim** (DEC-7) | After claiming unit U into item A, U absent from pool; second claim of U into item B is deliberate and allowed; same-(U,item) duplicate blocked by UNIQUE — proven with `source_cwd=''` (NULL would exempt the row from the index) | T5 |
| I-4 | **Cross-feed identity** (DEC-4) | A sha present in live `detectTrunkDrift` output AND a `detour_dispositions source='trunk_drift'` row → exactly **one** pool unit, one health count | T3 named dedupe test, red-proven |
| I-5 | **Import idempotency** on `(project_id, imported_content_hash)`, never cwd | Re-import same hash → no-op returning existing plan; `DND`/`dnd` case-variants import **once** | T4 |
| I-6 | **Generation ordinal derived**, never stored | No ordinal column in DDL; ordinal from walking `succeeds_plan_id` | T2 + DDL review |
| I-7 | **Closure derived by join** | No `closed_at`/flag on `value_claims` (grep-proven); no response field carries a per-claim closed flag | DoD grep + T5 |
| I-8 | **Cwd canonicalized at every seam** — import, pool assembly, **claim write** | `unitKey` for the same physical unit identical whether the cwd arrived as `/SARA/DND`, `/SARA/dnd`, or a worktree path; `cwd-identity.js` sole canonicalizer (no other `realpathSync`/`rev-parse` on plan/pool paths — static scan) | T3, T4, T5 (see trap T2 — currently **under-specified**) |
| I-9 | **Legacy layer untouched** | 144-case baseline green with zero behaviour edits; `plan-ingest.test.js` green and unmodified; 5 named modules unmodified; `/api/plans` shapes + `plan_updated` payload unchanged | baseline run + diff review |
| I-10 | **Chronology before LIMIT** (§9.2) | Every LIMITed query over `events`/`focus_inferences`/`sessions` in the new modules orders `created_at, id` first; scrambled-id fixture where id-order ≠ created_at-order | T3 I7 case + registered scan |
| I-11 | **Locale key parity** | `projectDetail.json` key sets identical across en/ko/vi/zh | existing i18n parity test (slice 5) |
| I-12 | **Vocabulary exports mirror CHECKs** | `VALUE_SOURCES`/`ATTRIBUTION_TIERS` === the CHECK lists; routes validate via exports only | T5 + static check |

---

## 3. Defect-catalog mapping (configured catalog, read first — all applicable entries)

**§9.1 DERIVED-DUAL-VIEW — three design-time pre-flags already on file for THIS
item (count 5).** This is the most-touched entry in the catalog and this change
is its named next test case:
1. *Announced-consumers form:* pool size / time-since-last-closure arrive with
   consumers 2–4 specified pre-code; two (`ccam ledger`, MCP-later) are net-new.
   Cure: `value-ledger.js` single home (DEC-5) + **T6 parity spec as a named
   deliverable** — the catalog's own QA note says this per-shape spec "never
   gets written because it has no home." Watch it.
2. *Feed-level form:* `('trunk_commit', sha)` identity regardless of feed
   (DEC-4/R7). The catalog states the failure explicitly: the day Phase 1b
   lands, every direct-to-trunk commit counts twice, silently.
3. *Write-sequence form:* no `closed_at` on claims; derived-by-join. The
   2026-08-01 build was burned by exactly this shape.
   Plus the standing helper-copy lesson: scan for duplicates of `unitKey`,
   `canonicalizeCwd`, and the enqueue/broadcast helpers, not just of the
   composers.

**§9.2 row-id-as-chronology-proxy — applies.** Focus-session bracketing of
trunk commits walks `sessions`/`focus_inferences`/`events` — all
`workflow-ingest.js` bulk-insert targets. Prior build's scan found 3 latent
violations in `db.js` on first derived-scope run; expect the same here. The
scrambled-id fixture must make the **LIMIT select the wrong subset**, not just
present the right subset misordered (else tautology, §9.3).

**§9.3 VACUOUS-GUARD — applies to every structural guard in T2/T4/T5 and the
scans.** Project history: five spec files, two consecutive BLOCKED passes,
placeholders reworded rather than fixed. Pre-build twist: red-first tests
against unbuilt code are *supposed* to be red — the §9.3 obligation here is the
**recorded red state at build time** (mutation: rogue writer injected, rogue
close call site injected, dedupe disabled) plus the sweeps
(`assert.ok(true`, `|| true` at 0).

**§9.5 / §9.6 — "inapplicable by design"; verified plausible, but conditional.**
The claim holds *only while the diff stays exactly as planned*. Concrete ways
the real build silently reintroduces the exposure:
- **Any mid-build vocabulary edit** (a 6th `value_source`, a third `status` like
  `'abandoned'`, a 4th attribution tier) — a CHECK is rebuild-to-widen; the full
  vocabulary is in the initial DDL precisely to prevent this. If it happens
  anyway, §9.6 applies in full and T1's shrunken scope (tables-exist +
  second-boot-no-op only) **cannot see it**.
- **`source_cwd` built nullable** ("DEFAULT '' looks redundant") — the UNIQUE
  index silently stops biting for NULL rows, and fixing it later is itself a
  rebuild. T5 must prove the `''`-not-NULL behaviour, not just read the DDL.
- **A write-side `project_paths` "fix"** for cwd fan-out (DEC-15 says read-side
  only in v1) — touches an existing table and reactivates §9.5.
- **DoD grep scope:** "zero `ALTER`, zero rebuilds in the diff" must be run
  against the value-ledger commits specifically — master's working tree already
  carries +129 uncommitted `db.js` lines from another effort, so a whole-tree
  grep can both false-positive and, worse, launder a smuggled change.

**§9.7 HAND-SCOPED STRUCTURAL SCAN — 5th flag, cure still unbuilt; this build
is the named "next build that should build it."** Verified live:
`chronology-ordering.test.js` `filesToScan` is still the hand-typed 5-file
list. All four new server files are born outside it. DEC-9: register in the
same commit **and** derive the scope; the bounded fallback must be a recorded
row, not the silent default. Closure single-writer guard scope from the
module's real export list. Prefer the worktree's incoming
`helpers/single-home.js` over a new hand-roll (§1e).

**CWD-IDENTITY-FANOUT (candidate, DEC-15) — this build is the promotion
trigger.** The health metric is exactly "a shipped aggregate that under- or
double-reports because of cwd fan-out." Live facts: 10 `plans` rows = 8 plans;
`DND`/`dnd` one inode, two `project_id`s (DEC-13 PENDING — if uncleaned, the
slice-4 trial measures a double-counted fleet); effort worktrees have no
`project_paths` mapping (DEC-17). If the trial shows a miscount, promote the
pattern per its recorded trigger.

**§9.4 FIX-ROUND-REGRESSION — applies prospectively.** The review/fix round on
this build must get its own adversarial pass; every dedup key introduced here
(`(value_source, value_ref, source_cwd, item_id)`, import hash key) needs one
negative case **per dimension** — N1's lesson was a dedup key missing exactly
one dimension (cwd) and swallowing every other project's rows.

---

## 4. "Ships green but broken" traps (each = a required assertion)

**T1 — Dedupe test quietly downgraded to a comment because Phase 1b "doesn't
exist yet."** The `source='trunk_drift'` disposition rows the dedupe defends
against have **no production writer today** — the builder can argue the fixture
is unreachable (§9.3's B4 shape) and skip it. The suite stays green for months;
the day trunk-drift Phase 1b merges, every direct-to-trunk commit appears twice
and `unclaimedPoolSize` doubles — precisely when Sara is trusting the number.
*Required:* T3's named test seeds a synthetic `detour_dispositions` row with
`source='trunk_drift'`, `source_ref=<sha>` alongside a live-feed emission of the
same sha → exactly one pool unit, one health count; red-proven by disabling the
dedupe. (§9.1 feed form, DEC-4/R7.)

**T2 — Canonicalization asymmetry defeats the ratchet.** `unitKey(source, ref,
cwd)` includes cwd, and `source_cwd` is in the UNIQUE index. If claim-write
canonicalizes but pool assembly doesn't (or vice versa, or one uses `realpath`
casing and the other the mapped `project_paths` casing), then the claimed key
`('trunk_commit', sha, '/SARA/dnd')` never matches the pool's `('trunk_commit',
sha, '/SARA/DND')`: the claimed unit **re-enters the pool** (I-2/I-3 broken),
the UNIQUE index never fires, and a second claim double-counts health. Every
test that seeds one consistent casing ships green. *Required:* a T3/T5 case
where the claim is written via a case-variant or worktree cwd and the pool is
assembled via the canonical one — unit still excluded, duplicate still blocked.
(CWD-IDENTITY-FANOUT + I-2/I-3; not currently an explicit case in the plan's
test table — the plan canonicalizes each seam but never asserts cross-seam
agreement.)

**T3 — Structural guards built as existence checks.** The T4 rogue-writer scan,
the T5 closure single-writer guard, and the derived chronology scope are all
guards this catalog's history says get shipped vacuous (`assert.ok(stmts.x)`,
hand-typed scope that misses the new file, regex that matches the bad state —
§9.7 flag 4). *Required:* recorded red states by mutation (inject a rogue
`project_plan_items` writer in `intake-scan.js`; inject a second
`closeProjectPlan` call site; add a 6th lib file and watch the scan fail), plus
the two greps at 0. (§9.3 + §9.7.)

**T4 — The "zero ALTER" property silently lost at build time.** Any of: a CHECK
tweak mid-build, `source_cwd` landing nullable, a `project_paths` write-side
convenience, or an index "fix" on an existing table — reactivates §9.5/§9.6
while T1 (scoped to tables-exist + no-op-second-boot) stays green and the DoD
box stays ticked. *Required:* T1 additionally asserts the **legacy tables'
schema text is unchanged** after boot (e.g. `sqlite_master.sql` snapshot for
`plans`/`plan_items`/`detour_dispositions`), and the DoD grep for
`ALTER TABLE|RENAME TO .*_old|CREATE TABLE .*_new` runs against this change-set's
diff. (§9.5/§9.6.)

**T5 — T6 parity spec degenerates into a stub.** The catalog's own QA note:
the per-shape cross-consumer spec "never gets written." The cheap fake is a
`ccam` unit test with the API mocked — it proves the CLI prints what it's told,
not that both consumers derive identical values from one DB state. *Required:*
T6 boots one seeded DB, drives the real route and the real
`ccam ledger health` process, and diffs the values; MCP/export join it on
arrival (DEC-16). (§9.1 announced-consumers form.)

**T6 — Import fan-out mints two generation-1s.** If import idempotency is
keyed on cwd anywhere (or canonicalization happens after the uniqueness probe),
`DND`/`dnd` — live today with identical `content_hash`, two `project_id`s —
imports twice, and the whole-life answer splits across two generations.
Cross-project fan-out is *known-unfixable* in v1 (DEC-13/DEC-15): within-project
duplication is the part tests must pin. *Required:* T4's two-case-variant-cwds
import-once case, red-proven. (CWD-IDENTITY-FANOUT, I-5.)

**T7 — Red-first tests drift from the built code.** Pre-build-specific: tests
authored now against the *planned* signatures (`detectTrunkDrift` from an
uncommitted worktree; `isGitRepo`'s home already misstated once in the plan and
corrected by the brief) will be "fixed" at build time when reality differs —
and the fix direction under schedule pressure is to weaken the assertion, not
strengthen the code. Most-likely quiet weakenings, in order: the dedupe fixture
(T1 above), the cross-seam canonicalization case (T2 above), the derived-scan
scope (DEC-9 fallback becoming default), the scrambled-id fixture collapsing
into a tautology, and `seenShas` semantics (if the build passes only
already-claimed shas but not shas emitted by sibling feeds in the same
assembly, intra-run double-emission survives). *Required:* at merge of DEC-2,
re-diff every mocked `detectTrunkDrift` call against the real export; any test
edited between red-authoring and green must have the edit named in build notes.

---

## 5. Severity & priority (worst first)

| P | Risk | Why this rank |
|---|---|---|
| P0 | Shared-DB integrity: DDL error bricking 4 processes at `require()`; any smuggled ALTER/rebuild on the user-global DB (trap T4) | All-processes outage or silent legacy-data damage on Sara's real data; the DB is not test data |
| P0 | Claims-ledger permanence (I-1/I-2): closed plans/claims deletable or recomputable | Claims are Sara's judgments — the only non-recomputable data in the feature; loss is unrecoverable by design |
| P1 | Health-metric double-count (traps T1, T2, T6) | Corrupts the headline "what did this project deliver" answer AND the slice-4 gate decision itself; silent, user-visible, promotion trigger for CWD-IDENTITY-FANOUT |
| P1 | Legacy-layer regression via a bridging write path (I-9, `deletePlanItemsNotIn`) | Data loss on the existing plan mirror; the trap has three live triggers |
| P2 | Vacuous guards (trap T3) | Not itself user-visible, but converts every P0/P1 fence above into a painted one — the catalog's core lesson |
| P2 | Sequencing collision: three dirty checkouts overlapping on `db.js`, `routes/projects.js`, `ProjectDetail.tsx`, `api.ts`, `types.ts`, `projectDetail.json` ×4, `screens.snapshot.test.tsx`; project memory records real work loss | Work loss / snapshot regen absorbing a sibling effort's unreviewed UI diff into baselines |
| P3 | Pool-assembly perf on the request path (§1c) | Degrades Project Detail and the gate trial; no data loss |
| P3 | Locale key drift (I-11) | Cosmetic (raw keys render); existing parity test likely covers |

Sequencing specifics (P2 detail): slice 0's `git worktree list` + running-session
check is load-bearing, not ceremonial. The snapshot regen in slice 5
(`npx vitest run -u`) must happen on a tree containing **only** this effort's UI
change — both `screens.snapshot.test.tsx.snap` and the page under snapshot are
currently dirty from other work, so a blind regen would launder foreign diffs
into reviewed baselines (explicitly forbidden by CLAUDE.md).

---

## 6. Disclosed-and-declined — trip-wire

Already tracked (no action needed beyond honoring them): DEC-14 (dual surface),
DEC-15 (fan-out, read-side only), DEC-16 (unbuilt consumers), DEC-17 (unmapped
cwds), DEC-18 (focus/pace), DEC-9's fallback-if-taken, DEC-10..13 PENDING rows.

**Naming three risks with no tracked artifact — each needs a `decisions.md`
PENDING/WATCH row (or defect-catalog stub) if left unguarded this round:**
1. **Pool-assembly request-path cost** (§1c): git subprocesses + fs walks per
   `GET /pool` / Project Detail load, uncached, unbudgeted. No DEC row, no
   planned test. If no perf bound or cache lands this round → WATCH row with an
   escalation trigger ("pool endpoint > N ms on Coaching Assistant data at the
   slice-4 trial").
2. **`seenShas` semantics + signature re-confirmation at merge** (trap T7): the
   change-brief carries this as a proceeding-on-assumption note, but nothing
   tracks the *obligation to re-verify* once DEC-2 merges. One-line row on
   DEC-2's trigger-to-close, or its own PENDING row.
3. **Cross-seam canonicalization agreement** (trap T2): the plan canonicalizes
   at each seam individually but no planned test asserts the seams agree on
   `unitKey` for the same physical unit. If the test-plan pass doesn't adopt it
   as a T3/T5 case, it must become a WATCH row — this is the exact shape whose
   miscount is DEC-15's promotion trigger.
