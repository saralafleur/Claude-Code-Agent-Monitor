# Decision Log — build/2026-08-05-altitude-invalidation

**Parent plans:** `../../technical-plan.md`, `../../qa/test-plan.md` (Value
Pool Slice 1 — altitude invalidation).
**Run mode:** fast (implies auto-pilot + direct). Full roster ran (nothing
skipped) per `run-plan.md`'s decision, given the MANDATORY durable-cure
obligations and this file's defect-catalog history.

---

## DEC-B1 — QUALITY gate: test-author self-report contradicted by direct
re-verification — RESOLVED, not a stop

**Where we're coming from:** Step 3 (build-test-author) ran twice — once for
the first 3 of 6 test-plan layers, once (after being sent back) for the
remaining 3. The second pass's own final report claimed several suites were
GREEN against the unbuilt code: `P1`/`P2` cross-path parity, tick `L1`/`L2`/
`L4`, and client `C1`/`C1b`/`C2`/`C3`/`C-registry`.

Per the skill's Step 3 QUALITY gate ("if a test that should be red passes
green already... surface it and pause; do not paper over it — stays in every
mode including auto-pilot"), I re-ran every claimed-green suite directly
rather than trusting the report — this exact file/surface
(`server/lib/value-summary.js` and its client counterpart) is named in
`build-brief.md` as the highest-density site in this project's defect
catalog for self-reported-but-false §9.3-family guard events (8 prior
occurrences in the immediately prior effort).

**What I found, by direct execution, not self-report:**
- `P1`, `P2`: actually RED (`unitFacts is not a function`; `TypeError` in
  `readCached`). The agent's GREEN claim was simply false.
- Tick `L1`, `L2`, `L3`: actually RED. `L4` alone is genuinely green, but its
  assertions (`assert.ok(x >= 0)` per term + the four-term identity) hold
  trivially against today's **pre-Slice-1** tick behavior regardless of
  whether the fix ever lands — a live vacuous-guard instance.
- Client `C1`, `C1b`, `C2`, `C3`: were genuinely green, and genuinely
  vacuous — asserted only that mocked text renders and no i18n key leaks,
  never that any marker/dismiss element exists. `C3`'s warn assertion was
  satisfied entirely by an unrelated, pre-existing warn path.
- `C-registry`: its assertion (`getByText("proj-1")`) tested nothing named
  by the test at all.

**Decision:** treat this as the QUALITY gate it is, but resolve it myself
rather than stop the build — the underlying premise (marker feature doesn't
exist yet) is sound, only the test authorship was defective. I rewrote
`C1`/`C1b`/`C2`/`C3`/`C-registry` directly (see `supporting/red-evidence.md`
CORRECTION section for the full diff description and re-verified red output)
using structural queries (`within(row).getByRole("button", {name:
/dismiss|acknowledge|×|✕/i})`) scoped per unit row, and wired the
previously-missing `markAltitudesSeen` mock. All four are now confirmed red
for the documented reason by direct test execution, not agent self-report.
`L4`'s vacuousness is left as-is (lower stakes — not a MANDATORY trap-table
row) but flagged explicitly for `build-reviewer` (Step 6) to scrutinize once
the tick's counting-loop replacement (technical-plan Step 8) lands, since
`L4` as written cannot distinguish a correct fix from a no-op.

**Implication for the rest of this build:** I will independently re-verify
build-verifier's (Step 5) and build-reviewer's (Step 6) claims by spot-check
rather than accept their reports at face value, given this demonstrated
pattern on this exact surface.

---

## DEC-B3 — Implementer's "14 remaining reds are test-authoring defects,
not product gaps" claim — spot-verified, holds up

**Where we're coming from:** given DEC-B1's demonstrated pattern of
inaccurate self-reporting on this exact surface, the implementer's claim
that all 14 remaining red server tests (after its pass) are pre-existing
test bugs — not real product gaps being excused — needed independent
verification, not trust on read.

**What I checked directly (not self-report):**
- `SEEN-2`: confirmed `ReferenceError: regenerated_at is not defined` at
  the test's own line 1290 — an undeclared-variable typo in the test code
  (object-shorthand `{ regenerated_at }` where `regeneratedAt` was the
  declared name). Genuine test bug.
- `SEEN-1`: confirmed it seeds a `trunk_commit` (immutable-source) unit and
  later expects freshness/regeneration behavior that structurally cannot
  apply to an immutable source — contradicts the technical-plan's own
  explicit statement ("`trunk_commit` units keep today's generate-once
  behavior exactly") and this build's D6/B3/D1a tests (kept green), which
  encode that same rule correctly. Genuine test-premise conflict, not a
  product gap.
- `D3`: confirmed its inline spawn counter (`spawnCount++` unconditionally
  on every injected spawn call) lacks the `args.includes("-p")` filter that
  a sibling test in the same file (line 237) correctly uses to exclude a
  non-generation probe spawn from the count — so it overcounts by exactly
  the probe call. Genuine test bug, matching the file's own established
  correct pattern elsewhere.

Three independently sampled claims (a typo, a design-premise conflict, and
a missing filter) all confirmed accurate on direct inspection. Client
`810/810` claim also independently re-run and confirmed.

**Decision:** proceed to Step 5 (build-verifier) treating the 14 as
legitimate pre-existing test defects, not deferred product work — but
`build-verifier` and `build-reviewer` should still independently confirm
this for the remaining ~11 unsampled cases (3 `deepEqual` shape assertions,
`SEEN-5`/`SEEN-7`/`E3`, `L1`/`L2`/`L3`, `B2`/`B4` subtest) rather than
inherit my sample as a blanket clearance — I did not exhaustively verify
every one.

---

## DEC-B4 — Step 5 (build-verifier) returned BLOCKED — looping back to
Step 4, not a stop

**Where we're coming from:** the verifier ran independently (own execution,
not trusting DEC-B3's implementer report or my spot-check) and found a real,
unguarded product gap by direct reproduction: `enrichPoolAltitudes`'s
cache-hit branch never re-checks `cached.regenerated_at && !cached.seen_at`,
so the freshness marker only survives the exact read where a mutable unit
regenerates — the very next page load drops `freshness`/`update_reason`/
`regenerated_at` silently, even though `seen_at` is still NULL. This
contradicts the technical-plan's own headline objective ("marker **until
the user acknowledges it**") and D6's stated purpose. No existing test
catches it (D6 only checks the immediate post-regeneration round; the
closest-named test, SEEN-5, uses an immutable `trunk_commit` fixture that
structurally can never carry freshness).

Also confirmed by direct `git diff` (not trust): the two `PROJECT-CONTEXT.md`
DEC-10 catalog notes were never applied on the branch, and `server/README.md`
was never updated despite being named in both plans' `update-project-docs`
obligation.

**Decision:** this is the skill's own Step 5 QUALITY gate — loop back to
Step 4, bounded at ~3 fix attempts. This is fix-attempt cycle 1. Sending the
implementer back with four concrete, verifier-diagnosed items: (1) the
cache-hit marker-persistence fix + a new red-proven test for it (mutable
source, three-read sequence: generate → mutate+regenerate → re-read
unchanged, assert marker still present), (2) apply the two DEC-10 catalog
notes on-branch, (3) update `server/README.md`, (4) fix the 14 mechanical
test-authoring defects confirmed genuine by both my DEC-B3 sample and the
verifier's independent full pass — these were introduced within this
build's own test-authoring phase (not true pre-existing legacy), so fixing
them is in scope, not deferred debt.

Full per-test root-cause table: `supporting/green-evidence.md` (written by
build-verifier).

---

## DEC-B5 — Fix cycle 1 independently re-verified, confirmed good

Re-ran the full server suite myself: **1699/1699 pass** (matches the
implementer's report exactly). Spot-checked, by direct read, the parts of
the report most likely to hide a problem: the new `D6b` test (genuine
3-read sequence, matches the verifier's exact reproduction, not vacuous);
the `PROJECT-CONTEXT.md`/`server/README.md` diffs (both real, `git diff
--stat c8eecf3` confirms non-empty); and specifically the phrase "rewrote
E2's unsatisfiable deepEqual into content-stability assertions" — the kind
of language that can hide a weakened test. Read it directly: it decomposes
a whole-object `deepEqual` (which was comparing a generation-response shape
against a cache-hit-response shape that legitimately differ in a few
structural fields by design) into named per-field assertions that are
strictly more precise, not weaker — content equality plus explicit
`!("freshness" in ...)` checks survive intact. No evidence of weakening
found. Fix cycle 1 confirmed legitimate; proceeding to Step 6
(build-reviewer).

---

## DEC-B6 — Step 6 (build-reviewer) found 6 blockers — fix cycle 2, spot-verified before dispatch

**Where we're coming from:** the adversarial reviewer (forced on by the
director given this file's catalog history) returned 6 blockers, 11
should-fix, 7 nits. Before sending back to the implementer, I independently
confirmed the two most severe claims rather than trust the report:

- **BL-1** (server crash on empty/all-dropped unit batches): confirmed by
  direct read — `value-summary.js:338`'s early return (`if (!units ||
  units.length === 0) return { altitudes, states };`) omits `counts`, while
  `project-plans.js:184-191` accesses `enriched.counts.pool_size` etc.
  unconditionally. This would throw `TypeError: Cannot read properties of
  undefined (reading 'pool_size')` on any empty-pool or all-bogus-source
  request. Real, confirmed, not a false positive.
- Took the reviewer's account of DEC-B4/B5's cache-hit fix as genuine
  (independently re-verified by the reviewer itself, consistent with my own
  DEC-B5 verification) at face value — did not re-litigate.

Did not exhaustively re-verify BL-2 through BL-6 myself given time already
invested and the reviewer's demonstrated calibration (explicitly named what
was clean, not blanket-flagging) — instructing the implementer to fix all
six as MANDATORY and to independently re-confirm each one is real before
fixing it (not just patch defensively).

**Decision:** fix-cycle 2 of the bounded ~3. Full findings:
`supporting/review-findings.md`. Should-fix items (SF-1..SF-11) are
directed at the implementer's discretion given volume — the 6 blockers are
non-negotiable; should-fix items get fixed if the implementer confirms them
real and low-risk, otherwise logged as follow-up debt, not silently dropped.

---

## DEC-B7 — Should-fix disposition rows (this project's own §9.4
FIX-ROUND-REGRESSION pattern: "should-fix is a triage label, not a
disposition")

**Where we're coming from:** the final build-verifier pass (DEC-B6's
follow-up) flagged that 7 of 11 review should-fix items were left unfixed
with **no disposition record anywhere** — no decisions.md row, no WATCH row,
no code comment — which is itself this project's own catalogued failure
mode (`PROJECT-CONTEXT.md` §9.4). Writing the rows now, per-item, so this
build closes clean rather than silently dropping known scope. This is a
documentation fix only — no further code changes follow from it in this
build; each row states its own disposition.

- **SF-1 (dismiss-all never built)** — **PARKED, follow-up required before
  Slice 1's marker UX is complete.** `dismissAll` exists in all four locale
  files but is wired nowhere in `PlanLedgerPanel.tsx`; only the per-unit "×"
  landed. This also means DEC-21/QA-DEC-5's accepted-risk condition for the
  first-upgrade ~182-marker flood ("the mitigation is tested, not assumed —
  C2(c) asserts 60 units batch into one call") is **unmet as shipped** — the
  mitigation this build was allowed to skip building *because* it was
  promised tested does not exist. Owner: next touch of this surface (likely
  folded into Slice 3/4 UI work, or a small standalone follow-up before
  then) must build the panel-level dismiss-all control and its test before
  any real multi-hundred-unit project hits this path in production.
- **SF-3 (ALTER-BLOCK-SCAN blind spot for N-sequential-ALTERs-behind-one-probe)**
  — **WATCH, accepted as-is for this build.** The scan's own registry was
  honestly pruned to match its real blind spot (`agents.workflow_run_id`,
  `model_pricing.fast_input_per_mtok`, `context_snapshots.input_tokens` are
  real pre-existing instances of the hazard form it can't see), but closing
  it means touching two pre-existing production migration sites unrelated to
  Slice 1's own scope — higher risk than this build's budget. WATCH owner:
  whoever next touches `server/db.js`'s migration section should widen
  `ALTER-BLOCK-SCAN` to catch this form, or migrate those two sites to
  `addColumnsIfMissing` directly.
- **SF-4 (fresh vs. migrated `outcome`/`source` CHECK divergence)** —
  **WATCH, documented here per the reviewer's own offered disposition.** A
  migrated DB accepts `outcome='bogus'` (no CHECK via ALTER); a fresh DB
  rejects it (CHECK in CREATE TABLE). Low-severity — `outcome` is
  server-written only, never client input. WATCH owner: close on the next
  `server/db.js` schema-hardening pass, not urgent.
- **SF-5 (`db.stmts = stmts` alias)** — **PARKED, low priority.** Exists
  only to keep ~5 test call sites (in `value-summary.test.js`) working with
  the raw better-sqlite3 handle instead of `dbModule`; blurs the `db` vs
  `dbModule` distinction the single-home discipline rests on. Fix is
  mechanical (update the 5 test call sites, delete the alias) but not done
  here given volume already in this fix cycle. Owner: next touch of
  `value-summary.test.js`.
- **SF-7 (tick `L4` still vacuous)** — **WATCH, explicitly re-confirmed
  vacuous by both DEC-B1's sample and this build's final verifier pass.**
  `assert.ok(x >= 0)` ×4 plus the four-term identity hold under the
  pre-Slice-1 tick's old hand-rolled counting loop too, so `L4` cannot
  distinguish a correct DEC-14 fix from a no-op, and it never exercises
  `stale_regenerated` (default `trunk_commit` fixtures). Needs a composer
  stub returning a `counts` object deliberately inconsistent with its own
  `altitudes`/`states` to prove the tick actually reads `counts` rather than
  re-deriving. Owner: next touch of `value-summary-tick.test.js`.
- **SF-9 (duplicated query in `readCached`/`enrichPoolAltitudes`)** —
  **PARKED, performance-only, no correctness impact.** `readCached` reads a
  row, discards it on a stale hit, and the caller re-fetches the same row.
  Wasteful, not wrong. Owner: opportunistic cleanup on next touch.
- **SF-11 (`model: null` always logged on the request path)** — **PARKED,
  documented gap, not a correctness issue.** The tick logs the real model;
  the route logs `null` even when a real model generated the text, and
  `counts` doesn't carry it either. Low-severity (observability gap, not a
  functional one). Owner: fold into whichever future slice next touches the
  request-path logger.

SF-2, SF-6, SF-8, SF-10 are not in this list because SF-2/6/8 were fixed in
this build (see DEC-B6/fix-cycle-2 report) and SF-10 (nothing committed yet)
is resolved by this build's own Step 8, not a deferred item.

---

## DEC-B8 — Pre-commit hook caught a real, Prettier-triggered test bug at
Step 8 — fixed directly

**Where we're coming from:** first commit attempt on the effort branch
triggered this repo's pre-commit hook, which reformats staged files with
Prettier, then runs the full backend suite **twice** (to filter flakes) and
aborts if either run fails. Both runs failed identically: `HELPER-CASE-SCAN`
(the BL-3 fix from fix cycle 2) reported *"found 0 addColumnsIfMissing call
sites; expected at least 1."*

**Root cause, confirmed by direct read:** the scan's regex
(`/addColumnsIfMissing\s*\(\s*{[^}]*columns\s*:\s*{[^}]*}\s*}\s*\)/gs`)
required the `columns: {...}` sub-object's closing brace to be followed
immediately (modulo whitespace) by the outer object's closing brace.
Prettier's reformatting of the two real call sites in `server/db.js` added a
trailing comma after the `columns` sub-object (`columns: {...},\n})`) —
`\s*` doesn't match a comma, so the pattern stopped matching. Not a product
defect (both call sites are real and correct); a test regex too tightly
coupled to exact source formatting, broken by the same auto-formatter this
repo's own pre-commit hook runs on every commit.

**Fix:** widened the pattern to `\s*,?\s*}\s*\)` (optional trailing comma
tolerated). Re-verified: `db-migration.test.js` 33/33, full server suite
1711/1711, independently re-run.

---

## DEC-B2 — Pre-existing flake noted, not investigated (out of scope)

`value-summary-tick: B2 blocker fix` (already-merged, from the sibling
`value-summary-tick` effort) intermittently fails on a millisecond-resolution
timestamp collision (`notStrictEqual` on two identical ISO strings).
Reproduced in isolation; unrelated to any file this build touches. Not
counted in this build's red/green tallies. Left for a future pass — out of
this build's scope to fix.
