# QA Decision Log — 2026-08-04-altitude-invalidation (Value Pool Slice 1)

> Every call the QA pass made that the technical plan did not already make, the
> context behind it, the options, and the choice. Readable on its own. Newest at
> the bottom.
>
> **Run mode: auto-pilot.** Every row below is `DECIDED-AUTO` — taken by the QA
> team on its own best recommendation, without asking. **Sara may reverse any of
> them without reopening the build**; each row names what reversing costs.
>
> Status values: **PENDING** (asked, awaiting answer) · **DECIDED** ·
> **DECIDED-AUTO** · **PARKED** · **SUPERSEDED**.
>
> **Numbering is folder-local** (`QA-DEC-n`), following the sibling run's
> convention. Rows whose ruling must outlive this QA pass are **mirrored into the
> intake `decisions.md`** as `DEC-17..DEC-26` (+ a WATCH-C amendment); the mirror
> id is stated in each row. Unqualified `DEC-n` / `WATCH-x` / `OPEN-n` references
> below are the intake file's local ids; cross-effort references are qualified
> "prior effort".
>
> Substrate for every fact cited: `origin/master` @ `55fe900`, read via `git show`.
> Companion documents: `./qa-assessment.md` (verdict **BLIND**), `./test-plan.md`
> (what to build), `./supporting/{coverage,risk,unit-tests,e2e-tests}.md`.

---

## QA-DEC-1 — T-D: the `/seen` stamp becomes a compare-and-set

- **Item / area:** acknowledge round-trip; `markValueUnitSummariesSeen`; the
  `POST /api/project-plans/altitudes/seen` payload shape
- **Status:** DECIDED-AUTO · **Raised:** 2026-08-04 · **Decided:** 2026-08-04 ·
  **Decided by:** auto-pilot (`qa-lead`)
- **Recurring-issue link:** INV-6 (round-trip); adjacent to §9.8 (a distinguishable
  outcome — "the stamp missed" — that would otherwise be silent)
- **Mirrored as:** intake `decisions.md` **DEC-17**

### The question
`risk.md` T-D: the planned statement is an unconditional
`UPDATE … SET seen_at = now WHERE unit_key = ?`. In the interleaving *user views
G1's marker → the tick regenerates the unit to G2 (arming a new marker) → the
user's in-flight `/seen` POST lands*, the blind stamp marks G2 as seen and **G2's
"updated" marker is never shown**. Do we take the compare-and-set, or keep the
blind stamp and record a knowing gap?

### Where we're coming from (2026-08-04)
Same-process interleaving is real: the route handles requests between the tick's
async LLM awaits. `unit-tests.md` SEEN-4 pins the *other* direction (a later
regeneration re-arms the marker via `seen_at = NULL` inside the one writer's
`DO UPDATE SET`) and is correct and kept — but the strategist is explicit that the
two halves must not be conflated: SEEN-4 does not address the inversion. The
slice's headline promise ("the user is always told when something they saw has
changed") has already been reduced once, knowingly, by OPEN-1 (marker on next
view, no WebSocket subscriber).

### Options presented
- **A) Compare-and-set.** `… WHERE unit_key = ? AND regenerated_at IS ?`
  (`IS ?` so the first-generation NULL leg matches). The client already holds
  `regenerated_at` on the entry it is dismissing. Still idempotent, still one
  statement, still one lexical call site. Costs a payload change:
  `{project_id, units: [{unit_key, regenerated_at}]}`.
- **B) Keep the blind stamp + a WATCH row.** Zero code cost; defensible for a
  local-first single-user app; silently falsifies the headline promise in the
  interleaving.
- **C) Compare-and-set on `seen_at IS NULL` instead.** Rejected on inspection — it
  does not discriminate *which generation* the stamp was aimed at, so it closes
  nothing.

### Decision
**Chosen: A — compare-and-set.**
**Rationale / implications:** one predicate plus one deterministic (no-timing)
test closes a silent falsification of the request's own vision sentence. Two
reductions of one promise, one of them undisclosed, is not a defensible shipping
posture. `{updated: n}` becomes honest — it reports the miss. The payload change is
free right now because none of these tests are built yet; it costs four touched
files (`routes/project-plans.js`, `client/src/lib/types.ts`,
`client/src/lib/api.ts` → `markAltitudesSeen(projectId, units)`,
`PlanLedgerPanel.tsx`) and rewrites `SEEN-1..7`/`E3`/`E5`/`C2` against the new
shape — all enumerated in `test-plan.md` §A-5. Pinned by **`SEEN-6`**, red-proven
in two directions (drop the predicate → the stale stamp silently eats the marker;
change `IS ?` to `= ?` → a first-generation marker becomes undismissible).
**Reversing costs:** delete the predicate and the `regenerated_at` field, delete
`SEEN-6`, and add a WATCH row naming the un-shown-marker race.

---

## QA-DEC-2 — T-H: the deterministic half of WATCH-C's convergence claim gets a test

- **Item / area:** route→tick convergence; WATCH-C's wording
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** §9.1 DERIVED-DUAL-VIEW; INV-10
- **Mirrored as:** intake `decisions.md` **DEC-18** + the **WATCH-C amendment**

### The question
WATCH-C is the right disposition for the *racy* half (a stale tab's POST
interleaving with a tick). But WATCH-C's own text asserts a **deterministic**
property nothing tests: "the next tick's fresh `assembleValuePool` re-invalidates
and **converges**." Test it, or amend the row to say the claim is unverified?

### Where we're coming from (2026-08-04)
`e2e-tests.md` E6 covers tick→route only. If the comparator or the two paths'
normalization is asymmetric, the route and the tick ping-pong the same unit
forever — silent, unbounded LLM spend — and today's suite would be green
throughout. The steady-state assertion (INV-10) that would catch it exists nowhere:
L3 stops at tick 2.

### Options presented
- **A) Add the two-step convergence case** (`E7`): seed snapshot B → POST at stage
  A → assert stamped A → tick with pool at B → assert stamped B → **tick again,
  unchanged → `generated = 0`**. Doubles as the only route→tick integration test of
  the whole staleness machinery.
- **B) Skip it and amend WATCH-C** to "converges is *asserted, not verified*".

### Decision
**Chosen: A — add `E7`, and amend WATCH-C anyway.**
**Rationale / implications:** the case is ~20 lines in a file that already hosts
both seams (E6's precedent), and it is the third of three places INV-10 is cheap to
pin (the others being `L3` tick 3 and `D5b`). WATCH-C's amendment now reads the
other way: **convergence is verified by `E7`; only the timing half remains
watched.** Red proof: make the route's coercion asymmetric with the assembler's
(`stage ?? ""`) → `E7`'s third step goes red.
**Reversing costs:** drop `E7` and amend WATCH-C to option B's wording instead —
but then INV-10 is pinned only at the tick, and the route seam (where the
normalization difference actually lives) stays unverified.

---

## QA-DEC-3 — T-I: the OpenAPI fragment for `/altitudes/seen` is declined this slice

- **Item / area:** `server/openapi-extra/`, `npm run openapi:yaml`, the
  `openapi-contract.test.js` scope limit
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** **CONTRACT-SPEC-DRIFT** (candidate; **pre-flag, NOT an
  occurrence — count unchanged**) with §9.7 inside its own cure
- **Mirrored as:** intake `decisions.md` **DEC-19**

### The question
`POST /api/project-plans/altitudes/seen` is a new endpoint and the altitude entry
schema is widened, and neither appears in `openapi.yaml`. Ship the fragment, or
record the decline?

### Where we're coming from (2026-08-04)
The 2026-08-03 `openapi-contract.test.js` derives its scope from
`app.use("/api/…")` **mounts**. `/api/project-plans` is already mounted and
documented, so a brand-new route *under an existing mount* is **structurally
invisible** to it — the guard stays green over the omission. The candidate entry's
promotion trigger is "(a) a second hand-maintained canonical artifact drifting the
same way, or (b) a shipped consumer built against the stale artifact"; neither is
met (same artifact, nothing shipped).

### Options presented
- **A) Ship the fragment** (+ namespaced `operationId` per the 2026-08-03 collision
  lesson, `npm run openapi:yaml` in the docs step, byte-round-trip test).
- **B) Decline, record the row, and write the mount-level scope limit into the
  catalog.**

### Decision
**Chosen: B — decline, recorded.**
**Rationale / implications:** the slice is already carrying three product
amendments under a BLIND verdict; the contract guard cannot see this either way,
so shipping the fragment buys documentation, not protection, and the documentation
is being written into `docs/API.md` regardless (with the QA-DEC-1 payload and the
QA-DEC-4 advisory note). **Consequence, stated plainly:** `openapi.yaml` — the
artifact the repo declares the source of truth for request/response contracts —
will omit this endpoint and the widened response, and the suite will stay green
over it. **This decline makes the catalog's "optional" CONTRACT-SPEC-DRIFT
one-liner mandatory for this build** (the exact text is in
`qa-assessment.md` §"Catalog notes"): the mount↔path scan's scope limit must be
recorded so the next reader does not mistake green for covered. If a second
artifact drifts or a consumer is built against the stale spec, the candidate
promotes and the guard should be extended to route level.
**Reversing costs:** one `openapi-extra` fragment + one `npm run openapi:yaml` run
in the docs step; the catalog line stays useful either way.

---

## QA-DEC-4 — T-K: `project_id` on `/altitudes/seen` is advisory

- **Item / area:** `/altitudes/seen` scoping; `markValueUnitSummariesSeen`'s WHERE
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** — (API-shape hygiene)
- **Mirrored as:** intake `decisions.md` **DEC-20**

### The question
The endpoint takes `{project_id, …}` but the statement filters on `unit_key`
alone, so the API shape implies a scoping the SQL does not enforce. Enforce it, or
document it as advisory?

### Where we're coming from (2026-08-04)
`unit_key` embeds the cwd (`intake_initiative::<ref>::<cwd>`), so an accidental
cross-project collision is not reachable in practice; this is a local-first,
single-user dashboard. Real enforcement would mean resolving the project's path
and validating every key's trailing segment against it — meaningful complexity for
a threat that does not exist here.

### Options presented
- **A) Enforce** (validate each key belongs to the project's path).
- **B) Advisory** — `project_id` is validated for shape (non-empty string, 400
  otherwise) and used for nothing at the statement layer; documented in
  `docs/API.md`; **pinned by a test titled BY DESIGN** so a future author does not
  half-fix it into a silent no-op.

### Decision
**Chosen: B — advisory, documented, and pinned.**
**Rationale / implications:** `SEEN-7` asserts the behavior *and* carries the
reason in its body, in the same style as `DEC-11-ANTIFIX`: the danger here is not
the missing scope, it is a later "fix" that makes dismissal fail invisibly for
legitimate keys. Route-level validation of `project_id` stays (it 400s when
missing or non-string) so the contract is honest about requiring it.
**Reversing costs:** add key-belongs-to-project validation + widen `SEEN-7` into
its enforcing form; the documented contract changes, so `docs/API.md` moves too.

---

## QA-DEC-5 — T-J: the first-upgrade marker flood is accepted as one-time noise

- **Item / area:** DEC-9's legacy regeneration burst × D6's marker condition
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** — (UX consequence of a migration; the class §9.1
  finding 3 calls "nobody's file")
- **Mirrored as:** intake `decisions.md` **DEC-21** + one sentence into **OPEN-4**

### The question
Every legacy mutable row regenerates on first check (DEC-9), and every
regeneration arms a marker via the one writer's `DO UPDATE SET regenerated_at =
now, seen_at = NULL`. At the measured 182-unit pool scale, Sara's first
post-upgrade panel view is a wall of "updated — label changed" markers for texts
that mostly did not meaningfully change (drain time ~1h40m–4h10m depending on
`MAX_PROJECTS_PER_TICK`, OPEN-3). Accept, or suppress?

### Options presented
- **A) Accept**; "dismiss all" (already planned) is the mitigation.
- **B) Suppress the marker when the *previous* snapshot was legacy-NULL** — one
  predicate, but it weakens D5/D6's symmetry (the marker would then mean two
  things) and adds a branch to the one writer.

### Decision
**Chosen: A — accept, with the mitigation tested rather than assumed.**
**Rationale / implications:** the flood is one-time, self-draining, and honest
(those texts *were* regenerated). Option B introduces exactly the "one flag, two
meanings" shape §9.8 exists to prevent, inside the writer this slice is trying to
keep single-purpose. What the accept requires is that "dismiss all" actually
scales: **`C2(c)` now asserts 60 unseen units are batched into ONE
`markAltitudesSeen` call** with exactly the unseen key set — the mitigation is a
tested behavior, not a plan sentence. One sentence goes into OPEN-4 so Sara meets
this in writing before she meets it on screen.
**Reversing costs:** one predicate in the marker condition + a D5/D6 symmetry
review; take it if Sara finds the first view unusable.

---

## QA-DEC-6 — TEST-AGAINST-LIVE-DB: third decline, recorded, with a compensating control

- **Item / area:** the uncatalogued candidate pattern; `DASHBOARD_DB_PATH`
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** **TEST-AGAINST-LIVE-DB** (candidate; promotion trigger
  **not** met — no second file found, it has not fired)
- **Mirrored as:** intake `decisions.md` **DEC-22**

### The question
This DDL-shipping slice is the candidate's stated promotion trigger. Adopt the
class-level cure (a test-runner setup that fails loudly when `DASHBOARD_DB_PATH`
is unset), or decline a third time?

### Where we're coming from (2026-08-04)
A verifier has recommended the class-level cure twice and it was declined twice;
the catalog records both. `db.js` runs migrations at `require()` time against the
shared user-global `~/.claude/agent-dashboard/dashboard.db`, currently held open by
a ~19h dev server, and this slice ships six columns of DDL. Both test documents
correctly bind `DASHBOARD_DB_PATH` **per block**, and correctly note that a
per-file grep is a proven-invalid sweep.

### Options presented
- **A) Runner-level env check** (fail at process start if unset).
- **B) A refusal inside `db.js`** when running under test.
- **C) Decline again, with a positive in-process control.**

### Decision
**Chosen: C — decline, recorded, plus the control.**
**Rationale / implications:** option A is *structurally wrong here* — specs
legitimately set the variable **inside** the block before requiring `../db`, which
is exactly why the per-file grep is invalid; a process-start check would fail
correct specs. Option B is the right cure and is a **product change to the boot
path**, which does not belong in a slice already carrying DDL, a new writer, a
guard widening and three P0 amendments; it deserves its own small intake with its
own tests. **Adopted now instead:** `db.js` already exports `DB_PATH`
(`db.js:118`, `module.exports` at `3214`), so **every server spec this plan
touches or creates asserts `require("../db").DB_PATH === <its temp path>`** — a
positive, in-process control that a grep can never be. **Consequence of deferring,
stated:** a future spec that requires `../db` without setting the path still
migrates Sara's live DB and nothing fails loudly. Promotion triggers unchanged:
(a) a second test file found doing it, or (b) it actually fires.
**Reversing costs:** option B, roughly an afternoon including the tests that prove
it does not break the desktop/MCP boot paths.

---

## QA-DEC-7 — T-F: the request-path partition gets ONE owner (DC-2), not a route-side fold

- **Item / area:** DEC-4's log arithmetic; `enrichPoolAltitudes`'s signature
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** **§9.8 OVERLOADED-ABSENCE** (live instance #1, its own
  cure being extended) + **§9.1 DERIVED-DUAL-VIEW** + **§9.3 PLAN-LEVEL VACUOUS
  FIXTURE**
- **Mirrored as:** intake `decisions.md` **DEC-23** (amends **DEC-4**)

### The question
The composer is called with `clean` (the sanitized subset) but DEC-4 logs
`pool_size = units.length`, so `counts` sums to `clean.length` and the four-term
identity breaks on the first malformed or old-client request. Worse, `unit-tests.md`
§2.5 **specifies a test that asserts the broken identity**. Fix the arithmetic at
the route (the strategist's P0-2), or remove the second derivation (the
strategist's DC-2)?

### Where we're coming from (2026-08-04)
Verified at `origin/master:server/routes/project-plans.js:148-171`: a unit with an
unrecognised `value_source` is diverted to a **route-level** `states` map the
composer never sees, and a key-less unit is dropped entirely. That sanitizing loop
**is S3's own fix**, shipped six days earlier; DEC-4 now adds a logger downstream
of it that re-derives the pool size upstream of it. §9.3's history says a guard
that goes red for a legitimate reason on day one gets **weakened, not fixed** —
that was literally event #1 of the prior effort, on this same identity.

### Options presented
- **A) P0-2, route-side fold:** keep `pool_size = units.length`; the route adds its
  own dropped/rejected count into the `unavailable` term before logging.
- **B) DC-2, one owner:** `enrichPoolAltitudes(db, units, { droppedCount })` folds
  the count into `counts.unavailable` and `counts.pool_size`; the route passes
  `units.length - clean.length` and logs `counts` verbatim.
- **C) Log `pool_size = clean.length`** — rejected: the log then cannot see
  malformed traffic at all, which is the one thing that made this class visible.

### Decision
**Chosen: B — DC-2 in its cheap form, superseding the route-side fold.**
**Rationale / implications:** identical arithmetic to A, one optional parameter of
extra cost, and it removes the *class*: after this there is exactly one place the
partition is computed, for both loggers and both seams, so `pool_size` and the four
terms **cannot disagree by construction**. DEC-14's "computed once by the composer
for both loggers" becomes true at the route too. Inapplicability over compliance,
per §9.6's 2026-08-02 lesson. The tick passes nothing (`droppedCount` defaults to
0) so every existing tick number is unchanged; the wire is untouched. Pinned by
**`ROUTE-SEAM-1`** (N good + 1 bogus `value_source` + 1 key-less → one log row,
`pool_size === units.length === counts.pool_size`, four terms sum exactly, every
**keyed** unit bucketed once on the wire) and **`COUNTS-DROPPED`**.
**`unit-tests.md` §2.5's route-logging assertion is corrected here and must not be
carried forward** — grep the shipped diff for `pool_size === units.length` with
unadjusted `counts` before closing.
**Reversing costs:** option A — same numbers, but the two derivations return and
the next person maintaining the route has to remember.

---

## QA-DEC-8 — T-B/DEC-15: the STRONG scan form is plan-of-record; the weak form is rejected

- **Item / area:** the `buildPrompt` structural scan — the slice's one
  never-traded-away cure
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** **§9.1 DERIVED-DUAL-VIEW** (6 touches) + **§9.7
  HAND-SCOPED STRUCTURAL SCAN** (6×) + **§9.3** (an evadable guard is a green tick
  over the disease)
- **Mirrored as:** intake `decisions.md` **DEC-24** (amends **DEC-15**)

### The question
DEC-15's **title** says the scan "permits exactly one mention of the unit:
`unitFacts(u)`". Its **body**, and `technical-plan.md` Step 5 / §6 A2, specify only
"no `u.<field>` / `unit.<field>` property access". A faithful implementer builds
the body's version. Which is plan-of-record?

### Where we're coming from (2026-08-04)
The weak form is evaded by bracket access, destructuring, aliasing, spread-copy
(which even satisfies the planned `facts.` sentinel) and parameter renaming — five
of the seven evasions in `risk.md`'s table. `unit-tests.md` §1.1 designs the strong
form correctly with a mutation per class, but the build task list is written from
the technical plan. Reconciling the two documents surfaced a **ninth** evasion
class neither had: `units[0].stage` — indexing `buildPrompt`'s array parameter
directly, which matches **none** of §1.1's regexes (`\b(u|unit)` in the string
`units[` is followed by `s`, not by `.` or `[`).

### Options presented
- **A) The body's weak form** (as the plan of record stands).
- **B) The title's strong form**, with the identifier hand-typed as `u`/`unit`.
- **C) The title's strong form with both identifiers derived from source**, plus
  §1.1's seven assertions, plus the new array-parameter assertion.

### Decision
**Chosen: C.** Nine assertions; the per-unit identifier derived from the units
`.map(` callback's first parameter and the array identifier from `buildPrompt`'s
signature (never hand-typed — §9.7, evasion #7); **exactly one mention of the
per-unit identifier inside the callback body**, and that mention is the argument of
`unitFacts(...)`; **exactly one mention of the array parameter**, immediately
followed by `.map(` (the new evasion class #9); eight mutations each observed red
individually plus a comment green-proof as the over-breadth control. Full mechanics
in `test-plan.md` §Layer 1 → `A2`.
**Rationale / implications:** this is the slice's single never-traded-away item on
the surface with eight recorded §9.3 events. Shipping the weak form means the one
structural cure ships evadable, with a green tick over it. **Evasion #8** (a helper
one frame away in the same file reading `u.stage`) is structurally out of a lexical
body scan's reach; its disposition — naming `A2-HOME`, the DEC-7 parity cases and
INV-10's steady state as the backstops — **must be written into the scan's own
comment**, or it becomes §9.1's "one call frame away" recurrence with a green tick
over it.
**Reversing costs:** none available — reversing means shipping an evadable cure,
which the plan itself forbids.

---

## QA-DEC-9 — T-E: DC-1 `addColumnsIfMissing` is built now, and the meta-test learns to see it

- **Item / area:** `technical-plan.md` Step 2.4; `server/db.js` migrations;
  `db-migration.test.js`'s meta-tests
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** **§9.5 FRESH-DB-BLIND** (how-to-comply gap) carrying
  **§9.6 NON-ATOMIC REBUILD**'s physics + **§9.2** (registry-derived read as
  block-derived) + **§9.7**
- **Mirrored as:** intake `decisions.md` **DEC-25** (replaces Step 2.4; amends
  **DEC-5**, which stays correct about the PRAGMA idiom)

### The question
Step 2.4 is one `db.exec` of five sequential `ALTER`s behind a single probe on
`input_label` (the *second* column added), with no transaction and no try/catch.
Point-fix the block (~10 lines), or build the `addColumnsIfMissing` helper +
meta-test (~1 afternoon) that retires the same hazard on five already-shipped
blocks?

### Where we're coming from (2026-08-04)
`db.exec` on a multi-statement string is sequential, not atomic. A death between
statements 1 and 2 leaves `input_stage` present and `input_label` absent; the probe
then says "missing", the block re-runs, and `ADD COLUMN input_stage` throws
`duplicate column name` **out of `require()`** — bricking Express, MCP, the desktop
app and the VS Code extension simultaneously against the one shared user-global DB
(§9.6's B3 blast radius, reached with no rebuild anywhere). Probing the *first*
column instead only swaps it for the silent failure. **Neither planned test can see
either outcome:** M1's `UPGRADE_CASES` legs are clean-run and pass under **both**
failure orderings, and e2e B1 boots on a *complete* legacy DB. §9.6's acceptance
criterion is literally "proven by an interruption test", and its 2026-08-03 note
adds "atomicity is necessary and not sufficient — the rebuild must also be unable
to throw, because the caller is `require()`." `server/db.js` already contains
**five** such hand-rolled blocks; this plan copies the file's own precedent at its
largest size yet, and is compliant with the catalog as written — which is why the
catalog is being amended too.

### Options presented
- **A) Point fix:** probe per column (or wrap in `BEGIN…COMMIT`) at this site only,
  plus catch-log-continue.
- **B) DC-1:** one `addColumnsIfMissing({table, columns})` helper mirroring
  `rebuildTableAtomically` (`db.js:1640`) — per-column probe, single transaction,
  catch-log-continue, cannot throw out of `require()` — with this slice as its
  first call site and the five pre-existing blocks **grandfathered with dated
  reasons rather than the scan weakened** (the exact `REBUILD_CASES` precedent).

### Decision
**Chosen: B — DC-1 now, with the meta-test extended in the same change.**
**Rationale / implications:** this is the same move that closed §9.6, and §9.6's
own history says hand-rolled instances 2 and 3 are how the non-atomic population
came to exist — this slice would be the 6th. **The interaction that makes the
meta-test extension non-optional:** `db-migration.test.js:1414-1451` derives its
obligation by regex-scanning `db.js` for `ALTER TABLE (\w+) ADD COLUMN (\w+)` and
**skips templated columns**. Routing the DDL through a helper that builds
`ALTER TABLE ${table} ADD COLUMN ${name} ${type}` makes all six columns **invisible
to that scan** — the six `UPGRADE_CASES` entries would stop being mechanically
forced the moment the durable cure lands, and every future helper call site would
inherit the hole. So DC-1 ships with **two new scans**: `HELPER-CASE-SCAN` (every
`table.column` passed to the helper needs its own `UPGRADE_CASES` entry — six, not
two) and `ALTER-BLOCK-SCAN` (no multi-statement ALTER block outside the helper;
the five pre-existing sites in an **exact-set** grandfather registry with dated
reasons). Proof is the **interruption** case at two grains: `M1-INT` (module) and
`B4` (whole-app boot, because §9.6's claim is about `require()`'s blast radius),
each red-proven under **both** failure orderings.
**Reversing costs:** option A clears T-E for this slice only; the five shipped
sites stay latent and the next author has to remember. Do not take it silently.

---

## QA-DEC-10 — T-C leg 3: a seventh i18n key (`updatedGeneric`) in all four locales

- **Item / area:** the `update_reason → i18n key` boundary contract
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** INV-8 (no unresolved-boundary-token leak) — the change
  brief's own named invariant
- **Mirrored as:** intake `decisions.md` **DEC-26** + one line into **OPEN-4**

### The question
`regen_reason` deliberately has **no CHECK** ("future reasons stay additive"), so a
future server will send a reason today's client has no key for, and a naive
`t(mapReason(reason))` renders the literal
`planLedger.pool.altitudes.updatedSomethingChanged` to the user. Which leg of T-C
neither architect claimed. Fix how?

### Options presented
- **A) A `default` arm in the reason→key map pointing at a new generic key**
  (`updatedGeneric`, en: *"updated"*), in all four locales; `C3(d)` asserts the
  generic copy renders and that `document.body.textContent` matches no
  `/planLedger\.[a-zA-Z]/`.
- **B) Drop the marker entirely for unknown reasons** — loses the signal that
  something changed, which is the slice's whole point.
- **C) Add a CHECK to `regen_reason`** — contradicts DEC-12's additive design and
  turns a forward-compat问题 into a migration one.

### Decision
**Chosen: A.**
**Rationale / implications:** the plan's key count moves **6 → 7**
(`updatedStageChanged`, `updatedLabelChanged`, `staleRefreshQueued`,
`staleRefreshUnavailable`, `dismiss`, `dismissAll`, **`updatedGeneric`**), all four
locales, and the client's reason→key map gains a `default` arm pinned by
`C-registry`. `i18n.test.ts` E1.1 derives ko/vi/zh parity from `en`, so adding the
key to `en` arms the parity check mechanically. OPEN-4's copy list grows by one
string — Sara's approval of the marker wording now covers a fallback too.
**Reversing costs:** none sensible; without it this is a *when*, not an *if*.

---

## QA-DEC-11 — Layer reconciliation: what moved between the unit and e2e designs

- **Item / area:** reconciling `supporting/unit-tests.md` and
  `supporting/e2e-tests.md` into one buildable set
- **Status:** DECIDED-AUTO · **Raised/Decided:** 2026-08-04 · **Decided by:** auto-pilot
- **Recurring-issue link:** — (QA process; recorded so neither architect's document
  is silently contradicted)
- **Mirrored as:** — (QA-pass-local; the substance lives in `test-plan.md`)

### The question
The two architects' documents overlap in three places and disagree in two. Which
layer owns what, and which of their assertions are being changed rather than
carried?

### Decision
**Chosen: push exhaustive permutation coverage down; keep e2e to the minimum flow
proof; correct two assertions rather than carry them.**
1. **Moved DOWN to unit:** the `/seen` validation matrix — `e2e-tests.md` E5 shrinks
   to a status-code smoke assertion; the 8-way malformed-input matrix lives in
   `SEEN-3`.
2. **Moved DOWN to unit:** freshness rendering permutations — `C1b` **loops
   `ALTITUDE_FRESHNESS`** instead of three hand-typed cases (§9.7); e2e asserts only
   that `freshness`/`update_reason` reach the wire (`E2`).
3. **Kept UP at e2e, deliberate duplication, one seam each:** `E2` echoes `D3`
   because the route's sanitization loop is a real seam `D3` never crosses (that
   seam is why DEC-7 exists); `B4` echoes `M1-INT` because only the full
   `require("../index")` graph proves §9.6's "cannot throw out of `require()`" for
   *every* process rather than for `../db` alone.
4. **Added at e2e:** `E7` (QA-DEC-2).
5. **CORRECTED, not carried — `unit-tests.md` §2.5's route-logging assertion**
   (`pool_size === units.length` with unadjusted `counts`) **asserts the defect**;
   replaced by `ROUTE-SEAM-1` per QA-DEC-7. A plan-level vacuous fixture (§9.3's
   sub-pattern) must not reach the implementer.
6. **CORRECTED, not carried — the `SEEN-*`/`E3`/`E5`/`C2` payload shape**, per
   QA-DEC-1's compare-and-set.
7. **Bookkeeping:** the server baseline is **78** (25/21/10/22), not the plan's
   blanket 77; the component the plan calls `PoolUnitRow` is **`ValueUnitRow`** in
   source.
**Rationale / implications:** both architects' documents remain the reference for
mechanics; where `test-plan.md` differs it is because of a row in this file, and
every difference is enumerated there so nobody re-derives it at build time.
