# QA Assessment — 2026-08-04-altitude-invalidation (Value Pool Slice 1)

> Authored by `qa-strategist`, 2026-08-04. **This is the document to read first.**
> The change is **planned, not built** — this verdict grades *the plan as designed*:
> if the whole designed test surface were executed faithfully, would this be
> adequately guarded? Substrate for every independent check below:
> `origin/master` @ `55fe900`, read via `git show` (the local checkout is 2
> commits behind with a 45-entry dirty tree from a concurrent session and was
> never used as a source of truth).

## Change summary

The Value Pool's per-unit altitude cache stops being write-once. Each cached
summary row gains a snapshot of the two facts that fed its prompt
(`input_stage`, `input_label`); on every read, for the three *mutable* value
sources (`intake_initiative`, `detour`, `merge_commit` — DEC-6 deliberately
overrides the request's `merge_commit` fence), the snapshot is compared
field-wise against the unit's current facts, and a mismatch is treated as an
ordinary cache miss so the existing batch/cap/partition machinery regenerates
exactly that unit. Units that are stale but not yet refreshed keep serving their
old text with a named `freshness`; regenerated units carry an "updated — stage
changed" marker until the user explicitly dismisses it (server-side `seen_at`
via a new `POST /api/project-plans/altitudes/seen`); the request path starts
writing generation-log rows (`source='request'`); six nullable columns are added
to two tables by guarded `ALTER`s; and the durable cure — `buildPrompt` may read
unit fields only through a shared `unitFacts()`, enforced by a structural scan —
is the item the plan marks as never traded away. ~21 files, server + client + 4
locales + 4 docs.

## Coverage verdict

**BLIND**

This is not a judgement on the plan's overall quality. On most of its surface
this is the best-guarded plan this pipeline has produced on this codebase: the
DEC-11 anti-"fix" test puts both sides of a deliberately-disagreeing partition in
one `it()` so either one-line regression turns exactly one test red; the two
single-writer guards with *opposite* expected behaviors are sequenced explicitly
so a test author cannot confuse "stays at 1" with "goes deliberately red"; every
named test carries a per-test mutation; the A1 comparator truth table has eleven
rows including the two NULL-meaning traps. If the verdict were about breadth it
would be ADEQUATE.

It is BLIND because on **three** named items the designed test surface, executed
faithfully and in full, would be **green over a defect that is specified in the
plan itself** — and two of those land squarely on catalogued recurring failure
modes whose acceptance criteria this plan does not meet:

1. **T-E — the migration (Critical, §9.5 cure carrying §9.6 physics).** Plan Step
   2.4 is one `db.exec` of five sequential `ALTER TABLE … ADD COLUMN` statements,
   guarded by a **single** probe on `input_label` (the *second* column added),
   with **no transaction and no try/catch**. Verified against the plan text at
   `technical-plan.md:300-316`. `db.exec` on a multi-statement string is
   sequential, not atomic. A death between statements 1 and 2 (`SQLITE_BUSY`
   against the live WAL DB a ~19h dev server is holding, OOM, `kill -9`, an
   operator Ctrl-C'ing a slow first boot) leaves `input_stage` present and
   `input_label` absent — and then the probe says "missing", the block re-runs,
   `ADD COLUMN input_stage` throws `duplicate column name` **out of
   `require()`**, and Express, MCP, the desktop app and the VS Code extension all
   brick on boot against the one shared user-global `~/.claude/agent-dashboard/dashboard.db`.
   Reordering the probe to the first column only swaps the failure to the silent
   one: block skipped forever, four columns permanently missing, first
   `upsertValueUnitSummary.run()` throwing inside the tick. **Neither planned
   test can see either outcome.** M1's `UPGRADE_CASES` legs are clean-run
   (columns present / idempotent / writable / behavioral) and pass under *both*
   failure orderings; e2e B1 boots on a *complete* legacy DB. Grep of
   `technical-plan.md`, `unit-tests.md` and `e2e-tests.md` for
   `interrupt|partial|BEGIN|COMMIT|half-migrat` returns exactly one hit, and it
   is about a mutated unit set. §9.6's acceptance criterion is literally *"proven
   by an interruption test, not only by the clean-completion test every existing
   migration test writes"*, and its 2026-08-03 build-outcome note adds *"atomicity
   is necessary and not sufficient — the rebuild must also be unable to throw,
   because the caller is `require()`."* The plan reads §9.6 as inapplicable
   ("no CHECK touched → no rebuild"), which is the reasoning error: the entry's
   *physics* apply to any multi-statement DDL executed at `require()` time.
2. **T-F — the request-path log row (High, §9.8's own route seam).** DEC-4 binds
   the route to log `pool_size = units.length` (submitted batch) with "the four
   terms from `counts`". But the composer is called with `clean` — the sanitized
   subset. Independently verified at `origin/master:server/routes/project-plans.js:148-171`:
   a unit with an unrecognised `value_source` is diverted to a **route-level**
   `states` map the composer never sees, and a key-less unit is dropped entirely.
   So `counts` sums to `clean.length`, and the **first real malformed or
   old-client request breaks the four-term identity** the whole slice treats as
   inviolable. Worse, this is *mis*-covered rather than uncovered:
   `unit-tests.md` §2.5's route-logging assertion specifies
   `pool_size === units.length` — **the planned test encodes the defect**. This
   is §9.8's build-phase note verbatim ("the two failures landed at the route and
   the table — the seams the composer's partition test cannot see") and §9.3's
   2026-08-04 event #1 recurring one effort later on the *same identity* ("a
   guard that goes red for a legitimate reason on day one gets weakened, not
   fixed").
3. **The trip-wire did not close — again.** `risk.md` adopted the sibling run's
   QA-DEC-4 convention (stable ids; every id must end as a named spec file + case
   id **or** a dated `decisions.md` row, never prose). Reconciling the id set
   against both test documents and `decisions.md`: **4 of 13 trap legs are
   covered, 8 end as prose, and not one of them has a `decisions.md` row.**
   `PROJECT-CONTEXT.md` §9.1's 2026-08-04 note records this exact
   "the fallback row also didn't happen" failure three times; this is the fourth,
   and the first where the convention was explicitly adopted up front and still
   did not close.

The bounded good news: the cure is **3 product amendments + 6 test additions**,
all cheap, none requiring a redesign. Fix those and this is ADEQUATE.

## Current coverage

Baseline **actually run** by the cartographer in a clean detached scratch
worktree at `55fe900` (never the dirty checkout), every server invocation under
a scratch `DASHBOARD_DB_PATH`:

| Spec | Result |
|---|---|
| `server/__tests__/value-summary.test.js` | **25/25 pass** |
| `server/__tests__/value-summary-tick.test.js` | **21/21 pass** |
| `server/__tests__/single-writer-guard.test.js` | **10/10 pass** |
| `server/__tests__/db-migration.test.js` | **22/22 pass** |
| `server/__tests__/focus-summary.test.js` | 21/21 pass (read-only precedent) |
| `server/__tests__/chronology-ordering.test.js` | 6/6 pass |
| `client/.../PlanLedgerPanel.test.tsx` | **14/14 pass** |
| `client/.../screens.snapshot.test.tsx` | 19/19 pass |
| `client/src/i18n/__tests__/i18n.test.ts` | 76/76 pass |

Everything relevant is **green**. **Bookkeeping correction the build must carry:**
the plan's Step 1 records "77/77 server across the four specs"; the observed sum
of those four is 25+21+10+22 = **78**. Use the per-file numbers, not the blanket
77 — a wrong baseline is how a genuinely-red spec later reads as "expected".

What guards these surfaces today:

- **GUARDED** — altitude synthesis batch/cap/partition/cache-hit path (25 tests
  incl. the DEC-11 truth table Cases 1-6 and the T-A concurrency case); the
  background sweep (21 tests, four-term identity asserted at three sites);
  `POST /altitudes` route behavior (7 tests); value taxonomy; current
  PlanLedgerPanel altitude rendering (6 cases + snapshot); i18n locale parity
  (derived from `en`, so new keys are mechanically parity-checked once added).
- **PARTIAL** — `buildPrompt`: its *rendering* is asserted by one test; *which
  fields it may read* is unguarded until the DEC-15 scan lands, and the
  `"(untitled)"` fallback is unasserted.
- **UNGUARDED** — every behavior this change is about: mutability/invalidation
  (no test anywhere mutates a unit's stage or label between reads; **every**
  existing cache fixture in both server specs is a `trunk_commit` unit, i.e. the
  immutable arm); `POST /altitudes/seen` (does not exist); the marker/acknowledge
  UI; the six new columns; and the false schema comment at `db.js:821-825`
  ("generated once, served forever"), which no test pins — its rewrite is
  churn-free.

Mechanical churn is small and fully inventoried: 2 of 25 `value-summary` tests
break on the `{altitudes, states, counts}` return shape (`deepEqual` on the full
return); 0 of 21 tick tests break mechanically — but those 21 are the
*behavioral* guard on DEC-14's counting-loop replacement, so if they go red they
are red genuinely, and the composer is what must be fixed; 3 of 10 single-writer
guards change, **two of them with opposite expectations** (see below).

## Gaps & test-debt diagnosis

### The reconciliation table (every `risk.md` id, per its own trip-wire rule)

| Id | Sev | Ends as | Disposition |
|---|---|---|---|
| T-A | High | `unit-tests` §2.4 DEC-11 anti-fix `it()` + L1 | **COVERED** |
| T-B | High (meta) | `unit-tests` §1.1 (7 assertions, mutations M-A2-1..6, comment green-proof) | **COVERED — but see below** |
| T-C leg 1 (freshness routed through the state path) | Med-high | C1 + C1b | **COVERED** |
| T-C leg 2 (unknown freshness) | Med-high | C3(b) | **COVERED** |
| T-C leg 3 (unknown `update_reason` → raw i18n key leaks to the user) | Med-high | *prose only* | **GAP — must-add** |
| T-D (blind `/seen` stamp marks the *new* generation seen) | Med | *prose only*; SEEN-4 pins the re-arm direction, not the inversion | **GAP — CAS or decisions row** |
| T-E (non-atomic 5-column ALTER) | **Critical** | *prose only* | **GAP — product amendment + interruption leg** |
| T-F (route log breaks the four-term identity) | High | `unit-tests` §2.5 — **asserting the defective semantics** | **MIS-COVERED — amendment + route-seam test** |
| T-G (fake-legacy NULL label ⇒ regenerates forever) | Med | D3 partial; L3 stops at tick 2 | **GAP — L3 tick 3** |
| T-H (WATCH-C convergence claim unverified) | Med-low | e2e E6 covers tick→route only | **PARTIAL — extend E6 or amend WATCH-C** |
| T-I (`/altitudes/seen` absent from OpenAPI) | Low-med | *prose only* | **GAP — fragment or decisions row** |
| T-J (first-upgrade marker flood) | Low | *prose only* | **GAP — one sentence in OPEN-4** |
| T-K (`/seen` ignores `project_id`) | Low | SEEN-3 covers validation, not scoping | **GAP — one-line disposition** |

**4 covered, 1 mis-covered, 1 partial, 7 prose-only, 0 `decisions.md` rows.**

### Four more findings that must not be lost

- **The migration meta-test demands six entries, not two.** Verified directly
  against `db-migration.test.js:1414-1451`: the covered-set is built as
  `UPGRADE_CASES.map(uc => \`${uc.table}.${uc.column}\`)`, i.e. **one
  `table.column` string per entry**, and the scan finds every `ALTER TABLE …
  ADD COLUMN` pair in `db.js`. This change adds **six**. `technical-plan.md`
  names **two** (M1, M2) and correctly forbids new `GRANDFATHERED` rows — so as
  the *plan of record* stands, the meta-test ships **red** on the other four
  columns. `unit-tests.md` §4 already resolves this (five entries sharing one
  `legacySql` via the `color_thresholds` spread-IIFE precedent, plus M2), but the
  build task list is written from the technical plan. **Carry the fix into the
  plan, not just the test doc.**
- **DEC-15 contradicts itself and the plan of record is the weak half.** The
  decision's *title* says the scan "permits exactly one mention of the unit:
  `unitFacts(u)`"; its *body* — and `technical-plan.md` Step 5 / §6 A2 — specify
  only "no `u.<field>` / `unit.<field>` property access". The weak form is
  evaded by bracket access, destructuring, aliasing, spread-copy (which even
  satisfies the planned `facts.` sentinel), and parameter renaming — five of the
  seven evasions in `risk.md`'s table. `unit-tests.md` §1.1 designs the strong
  form correctly with a mutation per class; **that design must be adopted as
  plan-of-record explicitly**, or a faithful implementer builds the body's
  version and this slice's one never-traded-away cure ships evadable. One
  residual: evasion #8 (a helper one frame away in the same file reading
  `u.stage`) is structurally out of a lexical body scan's reach — its
  disposition, naming the comparator-single-home scan / DEC-7 parity / INV-10 as
  backstops, **must be written into the scan's own comment** or it becomes
  §9.1's "one call frame away" recurrence with a green tick over it.
- **The two writer guards with opposite expectations are a live hazard for the
  test author, and the plan handles it well — hold the build to the sequence.**
  W-1 (`upsertValueUnitSummary.run(` count) **stays at exactly 1**: if it goes
  red the design was violated, fix the product, never widen. W-2
  (`insertValueSummaryGeneration`'s file set) **goes red deliberately** when
  route logging lands and is widened in the same commit — the shipped test's own
  259-265 comment pre-announces this. W-3 is net-new for
  `markValueUnitSummariesSeen`, a genuine second production writer to the cache
  table. Two build obligations: the W-2 red output must be **recorded** (not
  self-reported), and W-1's stripper must be upgraded to strip `/** */` in the
  same diff — this slice rewrites `value-summary.js`'s header, and a JSDoc
  containing the literal `upsertValueUnitSummary.run(` counts as a call site.
  That bit the parent build.
- **SEEN-4 answers half of T-D, and the halves must not be conflated.**
  `unit-tests.md` SEEN-4 pins the design's answer to *"a later change re-shows
  the marker"* — `seen_at = NULL` inside the one writer's `DO UPDATE SET`, never
  a caller's second UPDATE (which would trip W-1). That is correct and worth
  keeping. It does **not** address T-D's inversion: a user's in-flight `/seen`
  POST aimed at generation G1 landing *after* the tick regenerated to G2 clears
  the freshly-armed marker, and G2's "updated" state is never shown — a silent
  failure of the slice's own headline promise. The fix is one predicate
  (`… WHERE unit_key = ? AND regenerated_at IS ?`, `IS ?` handling the NULL leg),
  still idempotent, with a deterministic no-timing test.

### The systemic reasons (not "a missing test")

1. **Multi-column additive migrations are atomicity-decided by hand, per site,
   and the catalog does not say so.** §9.5's how-to-comply mandates the PRAGMA
   probe idiom — and stops there. It says nothing about a block adding *several*
   columns behind *one* probe. Direct read of `origin/master:server/db.js` finds
   **at least five such blocks already shipped**: `agents.workflow_run_id` +
   `workflow_phase` (1003-1008, probe on the first, ALTERs inside a `catch`, so a
   throw on the second escapes), `model_pricing.fast_*` (1059-1067),
   `color_thresholds` rate columns (**six** columns, one probe, 1466-1476),
   `color_thresholds`' legacy split (six more, 1503-1515), and
   `context_snapshots.input_tokens`/`cache_read`/`cache_write` (1959-1971). None
   is transactional; none can survive a mid-block death convergently. This is
   *exactly* the population shape §9.6 documented before the cure was built
   ("six table rebuilds exist and only one is wrapped in a single
   `BEGIN; … COMMIT;`") — and this plan copies the pattern at its largest size
   yet, from the file's own precedent. The gap is in the catalog, so the plan is
   compliant with what the catalog says and defective anyway.
2. **"The pool" is derived twice on the request path.** The four terms come from
   the composer's view (`clean`); `pool_size` comes from the route's view
   (`units`). Two derivations of one quantity with nothing forcing agreement —
   §9.1's shape, at the seam §9.8's build-phase note explicitly predicted, inside
   the change written to extend §9.8's own cure.
3. **Traps that belong to no single module's spec end in prose.** `risk.md`
   enumerates; each architect specs what fits their layer; nothing mechanically
   compares the sets. Every one of the 7 prose-only ids is cross-layer: T-E is
   process-lifecycle, T-F is route-vs-composer, T-D is route-vs-tick
   interleaving, T-I is code-vs-artifact, T-J is UX-consequence-of-a-migration.
   The one-spec-file-per-module convention gives them no home, so they are
   nobody's file.
4. **Registry-derived coverage was read as block-derived.** The migration
   meta-test derives its obligation *per column*; the plan reasoned *per ALTER
   block*. Same mechanism as §9.2's 2026-08-01 finding: a list enumerated by hand
   in prose and re-typed by hand into a test table.

### Have we shipped this class of gap before?

**Yes — repeatedly, and two of these are regressions-of-a-fix, not fresh adds.**

- **§9.5 FRESH-DB-BLIND (OPEN) + §9.6 NON-ATOMIC REBUILD (cure BUILT 2026-08-03,
  five sites grandfathered).** T-E is §9.6's failure physics arriving through
  §9.5's cure, on a path §9.6's own `ALTER TABLE … RENAME` / `CREATE TABLE …_new`
  scan cannot see. §9.6's 2026-08-03 note ends *"atomicity is necessary and not
  sufficient — the rebuild must also be unable to throw, because the caller is
  `require()`"*, proven red at the time by an uncaught `SQLITE_CONSTRAINT_CHECK`
  escaping `require()`. The plan's ALTER block satisfies neither half. Treat as
  **regression-of-the-fix**: the lesson exists, the helper exists, the shape
  escaped through the one door the built guard doesn't watch.
- **§9.8 OVERLOADED-ABSENCE (this surface is live instance #1; cure BUILT
  2026-08-04, same day, same files).** T-F is that entry's two carried lessons
  fired at once: *"extend the 'exactly one bucket' assertion to every layer that
  can add or drop an item, not just the one that computes the buckets"* and the
  route-seam prediction (S3 — a unit dropped by the route's own sanitizing loop
  landing in neither map, while the same diff's brand-new JSDoc asserted "never
  both, never neither"). The route sanitization loop that causes T-F **is S3's
  own fix**, shipped 6 days ago; DEC-4 now adds a logger downstream of it that
  re-derives the pool size upstream of it. **Regression-of-the-fix.**
- **§9.3 VACUOUS-GUARD (OPEN; eight events on this exact surface in the
  immediately preceding effort — the highest density on record).** The
  PLAN-LEVEL VACUOUS FIXTURE sub-pattern fires again here: `unit-tests.md`
  §2.5's route-log assertion is the plan handing the implementer a test that
  asserts a false identity — the *same class* as that effort's event #1 (the
  three-term partition, arithmetically false whenever `cache_hits > 0`), on the
  *same identity*, one effort later. Everything the standing rule asks for is
  otherwise present in this plan, and the AGENT-SELF-REPORTED-RED sub-pattern
  means every one of those red proofs is a claim to verify at build, not a fact.
- **§9.1 DERIVED-DUAL-VIEW (6 touches, OPEN).** The plan's posture — make §9.1
  *inapplicable* via `unitFacts()` + a structural scan — is right, and this is
  the third consecutive intake to reach for inapplicability over compliance.
  Residual risk is entirely in the scan's own strength (T-B) and the route-seam
  re-derivation (T-F). Its 2026-08-04 note ("this entry's own diagnosis has
  reproduced inside the QA pipeline's own documents — 3rd time on record") is
  the direct ancestor of finding 3 above; **this is the 4th.**
- **§9.7 HAND-SCOPED STRUCTURAL SCAN (6x).** Engaged twice and handled: the A2
  scan's identifier set should be derived from `buildPrompt`'s signature rather
  than hand-typed `u`/`unit` (evasion #7), and the four client hand-copies of
  `ALTITUDE_FRESHNESS` are the tracked, accepted CJS/Vite exception (WATCH-F)
  with three compensating pins.
- **CONTRACT-SPEC-DRIFT (candidate, first guard BUILT 2026-08-03).** T-I is a
  **pre-flag, NOT an occurrence — count unchanged.** The written trigger is
  "(a) a second hand-maintained canonical artifact drifting the same way, or
  (b) a shipped consumer built against the stale artifact"; neither is met (same
  artifact, nothing shipped). But the finding is sharper than a pre-flag: the
  guard that *was* built (`openapi-contract.test.js`) derives its scope from
  `app.use("/api/…")` **mounts**, and `/api/project-plans` is already mounted and
  documented — so a brand-new route *under an existing mount* is structurally
  invisible to it. That is §9.7's shape inside CONTRACT-SPEC-DRIFT's own cure.
  This slice is the first change to test it. If `/altitudes/seen` ships with no
  `openapi-extra` fragment, that is evidence for extending the guard to route
  level, and *then* the candidate should be re-argued.
- **TEST-AGAINST-LIVE-DB (candidate; class-level cure recommended twice by a
  verifier and declined twice).** Trigger is "(a) a second test file found doing
  this, or (b) it actually fires" — **neither is met, so no promotion**. But this
  slice ships six columns of DDL that migrate the real shared user-global DB at
  `require()` time and adds at least one brand-new spec file
  (`value-summary-legacy-boot.test.js`). It is the cheapest moment this cure will
  ever have. Both test docs correctly bind per-block `DASHBOARD_DB_PATH` and
  correctly note that a per-file grep is a proven-invalid sweep. A third decline
  should be **recorded**, not silent — the catalog already records the first two.

## Recommendation

### Must-fix-now — product amendments (3). These gate the build.

**P0-1 — Rewrite Step 2.4's migration (T-E).** Either (a) probe **per column** so
any partial state converges, or (b) wrap the five ALTERs in one
`BEGIN; … COMMIT;` (SQLite supports `ADD COLUMN` in a transaction). **Both
options additionally require catch-log-continue** so the block cannot throw out
of `require()` — §9.6 B3, non-negotiable, the caller is every process at once.
Preferred: (a) + the shared helper in DC-1 below; per-column probing is
convergent under *any* interleaving, whereas (b) only narrows the window.

**P0-2 — Fix DEC-4's log arithmetic (T-F).** Keep `pool_size = units.length`
(submitted batch — it is the more useful number, and it is what makes malformed
traffic visible at all) and have the route **fold its own dropped and rejected
units into the `unavailable` term before logging**. This mirrors the S3 wire fix
exactly — route-dropped = attempted-and-unusable — and keeps one meaning for
"unavailable" across wire and log. Amend `unit-tests.md` §2.5 accordingly; as
written it asserts the defect.

**P0-3 — Adopt DEC-15's strong form as plan-of-record.** Replace the decision
body's "no `u.<field>` access" with the title's "exactly one mention of the
parameter, as the argument of `unitFacts(...)`", and point Step 5 / §6 A2 at
`unit-tests.md` §1.1's seven assertions + six mutations. Derive the parameter
identifier from `buildPrompt`'s signature, never hand-type `u`/`unit` (§9.7).
Write evasion #8's disposition into the scan's own comment.

### Must-add-now — tests, worst first (6).

1. **Migration interruption leg (kills T-E's blind spot).** An `UPGRADE_CASES`
   leg seeding the legacy table **plus `input_stage` only** — the exact mid-crash
   state — then `require`ing `db.js` and asserting: no throw; all five columns
   present after; second run a no-op. That one fixture kills *both* failure
   orderings, and nothing else in the plan can see either.
2. **Route-seam log partition test (kills T-F).** POST N good units + 1 with a
   bogus `value_source` + 1 with no `unit_key` → exactly one log row; four-term
   sum === logged `pool_size`; and the wire still buckets every keyed unit
   exactly once. Red proof: feed `counts` through unadjusted with submitted
   `pool_size`.
3. **The A2 scan as designed in `unit-tests.md` §1.1** — seven assertions, all
   six mutations observed red individually, plus the comment green-proof
   (over-breadth control). This is the plan's one never-traded-away item; a build
   that ships it without observed reds is the cure regressing.
4. **Six `UPGRADE_CASES` entries, not two** — five sharing one `legacySql` via
   the `color_thresholds` spread-IIFE precedent, plus M2. Otherwise the migration
   meta-test is red on delivery and gets "fixed" by a `GRANDFATHERED` row, which
   its own comment forbids.
5. **L3 tick 3 — the steady-state / anti-oscillation assertion (INV-10).** After
   tick 2's single regeneration, tick 3 on unchanged inputs must log
   `cache_hits = pool_size, generated = 0, stale_regenerated = 0`. One cheap case
   that closes **three** risks at the seam where they present identically: T-G's
   fake-legacy infinite regeneration, residual DEC-7 normalization drift, and any
   comparator asymmetry — all of which otherwise present only as silent,
   unbounded LLM spend.
6. **C3(d) — unknown `update_reason` → generic "updated" copy, never the raw key
   (T-C leg 3).** `regen_reason` deliberately has no CHECK ("future reasons stay
   additive"), so a future server sends a reason today's client has no key for
   and naive `t(mapReason(reason))` renders
   `planLedger.pool.altitudes.updatedSomethingChanged` to the user. This is the
   change brief's own "no unresolved-boundary-token leak" invariant, and it is
   the one T-C leg neither architect claimed.

### Must-record-now — `decisions.md` rows (5). Not optional; this is the 4th run.

`T-D` (if the blind stamp is kept — a knowing INV-6 gap), `T-H` (if the
deterministic convergence case is skipped — then amend WATCH-C to say "converges"
is *asserted, not verified*), `T-I` (OpenAPI declined + the mount-level scope
finding), `T-J` (first-upgrade marker flood accepted — one sentence in OPEN-4 is
enough), `T-K` (`project_id` is advisory, or scope the statement).
Plus the TEST-AGAINST-LIVE-DB promotion decline, which `technical-plan.md` §7
already binds — verify it actually happens.

### The durable cures (what stops the class, not the instance)

**DC-1 — `addColumnsIfMissing(table, { column: type, … })` in `db.js`, mirroring
`rebuildTableAtomically`.** One helper that probes `PRAGMA table_info` **per
column**, applies only the missing ones inside a single transaction, catches and
logs and continues, and can never throw out of `require()`. Make this slice its
first call site (six columns, two tables — the largest such block in the file).
Then extend `db-migration.test.js` with a scan for multi-statement `db.exec`
ALTER blocks that are *not* routed through the helper, with the five pre-existing
sites **grandfathered with dated reasons rather than the scan weakened** — the
exact precedent `REBUILD_CASES` set on 2026-08-03. This is what turns "the next
person also has to remember" into "the next person cannot get it wrong", and it
is the same move that closed §9.6. Cost: roughly one afternoon; it retires a
latent hazard on five shipped sites at the same time.

**DC-2 — one owner for the request-path partition.** Rather than fixing T-F's
arithmetic once, remove the second derivation: have the route pass its rejected
keys into the composer (or accept a `dropped` count) so `counts` is the *only*
place the partition is ever computed, for both loggers and both seams. Then
`pool_size` and the four terms cannot disagree by construction, and DEC-14's
"computed once by the composer for both loggers" becomes true at the route too —
inapplicability over compliance, per §9.6's 2026-08-02 lesson.

**DC-3 — make the risk-id reconciliation a required artifact, not a convention.**
The trip-wire rule is right and has now failed to close four times on this
project (and, per the cross-project run-log, five times across four projects).
Prose enumeration plus per-layer claiming plus no mechanical diff = the leftovers
are always the cross-layer invariants. The reconciliation table at the top of
this section is what the rule was asking for; it should be produced *by the QA
pass, in the QA pass*, every time, and every uncovered id must leave the pass in
exactly one of two states. **This belongs in the `team-qa` skill itself** — it is
now its 5th independent derivation.

**Safe to ship?** Yes — once P0-1, P0-2, P0-3 and must-adds 1-6 are in, and the
five decision rows are written. The remaining design is sound, and the plan's
posture on its two hardest invariants (make §9.1 inapplicable; keep the four-term
identity exact with `stale_regenerated` as an overlap counter) is correct.

## Open decisions for the user

- [ ] **DC-1 now, or the point fix?** Amending Step 2.4 alone (~10 lines) clears
      T-E for this slice. The `addColumnsIfMissing` helper + meta-test (~1
      afternoon) additionally retires the same latent hazard on five already-shipped
      migration blocks. §9.6's history says the hand-rolled 2nd and 3rd instances
      are exactly how the non-atomic population came to exist — this slice would be
      the 6th.
- [ ] **T-D: cheap compare-and-set, or a knowing WATCH row?** The CAS is one
      predicate (`AND regenerated_at IS ?`) plus one deterministic test, and the
      client already holds `regenerated_at` on the entry it is dismissing. Keeping
      the blind stamp is defensible for a local-first single-user app — but it
      silently falsifies the slice's headline promise in the interleaving, so it
      needs a row either way.
- [ ] **T-I: ship the `openapi-extra` fragment, or record the decline?** Adding it
      costs a fragment + `npm run openapi:yaml` in the docs step. Declining is
      acceptable — but please record it, because the built contract guard is
      mount-level and will *stay green* over the omission, which is precisely the
      drift shape the candidate entry describes.
- [ ] **T-J: is a wall of "updated — label changed" markers on first post-upgrade
      view acceptable?** DEC-9's legacy burst regenerates every legacy mutable row
      (~182-unit pool; 1h40m-4h10m to drain depending on `MAX_PROJECTS_PER_TICK`),
      and each regeneration arms a marker. "Dismiss all" is planned and is probably
      sufficient. The alternative (suppress the marker when the *previous* snapshot
      was legacy-NULL) weakens D5/D6's symmetry — your call, and it interacts with
      OPEN-3's `.env` value.
- [ ] **TEST-AGAINST-LIVE-DB: adopt the class-level cure now?** A test-runner setup
      file that fails loudly when `DASHBOARD_DB_PATH` is unset. Recommended twice
      by a verifier, declined twice; this DDL-shipping slice is the cheapest moment
      it will ever have.
- [ ] **OPEN-1 (carried, still PENDING):** signal 5 ("the user is always told when
      something they saw has changed") is met **on next view, not in place** — no
      WebSocket subscriber ships this slice. Please read that reduction before
      sign-off; it is the request's headline promise.

---

## Catalog notes — verbatim text for build-time application (NOT applied here)

Following `DEC-10` and the sibling intake's precedent: `PROJECT-CONTEXT.md` lives
in a main checkout with a 45-entry dirty tree from a concurrent session, so
editing it here risks sweeping this text into another session's commit. The file
is byte-identical at `d830a44` and `origin/master` @ `55fe900`, so the text below
applies cleanly on the effort branch. **Apply on-branch at the build's catalog
step; do not fork the catalog.**

**Add under §9.5 FRESH-DB-BLIND SCHEMA CHANGE (new dated note; count unchanged):**

> **QA-pass note (2026-08-04, `team-qa` strategist,
> `intake/2026-08-04-altitude-invalidation/` — count unchanged, nothing built
> yet). This entry's how-to-comply is incomplete for *multi-column* blocks, and
> the gap is already shipped five times.** The entry mandates the PRAGMA
> `table_info` probe idiom and stops there. It says nothing about a block that
> adds *several* columns behind *one* probe, which is non-atomic (`db.exec` runs
> statements sequentially, no implicit transaction) and non-convergent: a death
> between statements leaves the probe column absent and the earlier columns
> present, so the next `require()` re-runs the block and `ADD COLUMN` throws
> `duplicate column name` **out of `require()`** — §9.6's B3 blast radius (Express,
> MCP, desktop, VS Code extension, one shared user-global DB) reached with no
> rebuild anywhere. Probing the *first* column instead only swaps it for the
> silent failure: block skipped forever, later columns permanently missing —
> §9.6's "half-run migration that looks finished." **`server/db.js` already
> contains five such blocks** (verified at `55fe900`): `agents.workflow_run_id` +
> `workflow_phase` (1003-1008 — ALTERs inside a `catch`, so a throw on the second
> escapes), `model_pricing.fast_*` (1059-1067), `color_thresholds` rate columns
> (six, 1466-1476), `color_thresholds`' legacy split (six, 1503-1515),
> `context_snapshots.input_tokens`/`cache_read_tokens`/`cache_write_tokens`
> (1959-1971). None transactional, none catch-protected. The altitude-invalidation
> plan's Step 2.4 (five columns, one probe on the *second*) was written by copying
> the file's own precedent and is compliant with this entry as written —
> which is why the entry, not the plan, is what needs amending.
> **Add to how-to-comply:** a migration that adds more than one column must either
> probe **per column** (convergent under any interleaving) or run inside one
> `BEGIN; … COMMIT;`, and in both cases must be wrapped so it cannot throw out of
> `require()`. **Durable cure recommended (same move that closed §9.6):** one
> `addColumnsIfMissing({ table, columns })` helper — per-column probe, single
> transaction, catch-log-continue — so atomicity stops being re-decided by hand
> per site, plus a `db-migration.test.js` scan for multi-statement ALTER blocks
> not routed through it, with the five existing sites grandfathered with dated
> reasons rather than the scan weakened. And per §9.6's acceptance criterion, the
> proof is an **interruption** case (seed legacy + the first column only), not the
> clean-run idempotence case every existing migration test writes — the clean-run
> case passes under *both* failure orderings.
> See `intake/2026-08-04-altitude-invalidation/qa/qa-assessment.md` (verdict: BLIND).

**Add under §9.8 OVERLOADED-ABSENCE (new dated note; count unchanged — same
instance, its cure being extended):**

> **QA-pass note (2026-08-04, `team-qa` strategist,
> `intake/2026-08-04-altitude-invalidation/` — count unchanged; this is instance
> #1's cure being extended, and this entry's own carried lesson firing on it).**
> Slice 1 adds request-path generation logging (DEC-4) downstream of the route's
> sanitizing loop — **the loop that is S3's own fix, shipped six days earlier** —
> while deriving `pool_size` from `units.length` upstream of it. The composer only
> ever sees `clean`, so the four terms sum to `clean.length` and the four-term
> identity breaks on the first request containing a unit with an unrecognised
> `value_source` or no `unit_key`. This is verbatim this entry's carried lesson
> ("extend the 'exactly one bucket' assertion to every layer that can add or drop
> an item, not just the one that computes the buckets") and its build-phase
> prediction ("the two failures landed at the route and the table — the seams the
> composer's partition test cannot see"), arriving at the route seam again, one
> effort later. Caught pre-build. Two things worth carrying: (1) the planned test
> **asserted the defective semantics** (`pool_size === units.length` with
> unadjusted `counts`) — a plan-level vacuous fixture, §9.3's sub-pattern, on the
> same identity as that entry's own event #1; (2) the durable form of the fix is
> not "adjust the terms at the route" but **give the partition one owner** — pass
> the route's rejected keys into the composer so `counts` is the only place it is
> ever computed. Inapplicability over compliance.

**Add under §9.1 DERIVED-DUAL-VIEW (append to the 2026-08-04 note; count
unchanged at 6):**

> **4th occurrence of the planning-document form (2026-08-04,
> `intake/2026-08-04-altitude-invalidation/`).** That intake's `risk.md` adopted
> the recommended cure from the note above — stable trap ids plus an explicit
> "disclosed-and-declined trip-wire" requiring every id to end as a named spec
> file + case id or a dated `decisions.md` row. **It still did not close:** of 13
> trap legs, 4 are covered by a named case, 1 is covered by a case asserting the
> *wrong* semantics, 1 is partial, and **7 end as prose with zero `decisions.md`
> rows**. Every one of the 7 is cross-layer (process-lifecycle, route-vs-composer,
> route-vs-tick interleaving, code-vs-artifact, UX-consequence-of-a-migration).
> Naming the ids is necessary and **not** sufficient: nothing mechanically diffs
> the id set against the two test documents, so the leftovers are still the
> invariants that are nobody's file. The reconciliation must be *performed and
> written down* by the QA pass itself (see that assessment's reconciliation
> table), not left as an instruction to a later reader.

**No change to the CONTRACT-SPEC-DRIFT or TEST-AGAINST-LIVE-DB candidates
(neither promotion trigger is met).** Optional one-line addition to
CONTRACT-SPEC-DRIFT's "FIRST GUARD BUILT" paragraph, if the build declines the
fragment: *"Scope limit found 2026-08-04 (`altitude-invalidation`): the
mount↔path scan is derived from `app.use("/api/…")` mounts, so a NEW route under
an ALREADY-documented mount (`POST /api/project-plans/altitudes/seen`) is
structurally invisible to it — §9.7's shape inside this candidate's own cure."*

---
*Memory updated:* `~/.claude/skills/team-qa/memory/qa-run-log.md` ✅ ·
project catalog (`PROJECT-CONTEXT.md`) — **not edited here by design** (DEC-10 +
dirty concurrent checkout); verbatim text carried above for on-branch application
at the build's catalog step.
