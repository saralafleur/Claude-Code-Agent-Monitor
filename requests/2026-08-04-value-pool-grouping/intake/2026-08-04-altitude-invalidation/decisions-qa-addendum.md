# Decision Log Addendum — QA-pass rows (2026-08-04, `team-qa`)

> **What this file is:** the rows the QA pass opened, written in the intake
> `decisions.md`'s own voice and numbering (`DEC-17..DEC-26`, plus one amendment
> to `WATCH-C`), **ready to paste** into
> `intake/2026-08-04-altitude-invalidation/decisions.md` verbatim.
>
> **Why it is a separate file rather than an in-place edit** — the same posture
> `DEC-10` set for `PROJECT-CONTEXT.md`: `decisions.md` is a tracked artifact in
> the **main checkout**, which is shared with a concurrent session, and
> `technical-plan.md` Step 1.5 / `DEPENDENCY-2` bind the authoritative copy to the
> **effort branch**, which does not exist yet. Editing it here risks sweeping QA
> text into another session's commit and forking the log.
>
> **Fold-in is a build obligation, not a suggestion.** `test-plan.md` Implementation
> step 18 and its Definition of Done require `QA-DEC-1..11` to exist on the effort
> branch and to be mirrored here as `DEC-17..DEC-26` + the `WATCH-C` amendment.
> Paste these rows into `decisions.md` at **Step 1.5** (when the request tree is
> copied onto the branch), then delete this addendum file in the same commit so
> there is exactly one decision log.
>
> Full reasoning, options considered and reversal costs for every row live in
> `qa/decisions.md` (`QA-DEC-1..QA-DEC-11`); the strategist's evidence lives in
> `qa/qa-assessment.md` (verdict: **BLIND**); the buildable consequence lives in
> `qa/test-plan.md`.

---

## Paste target 1 — append to the **PM/tech-lead rows** section, after `DEC-16`

### DEC-17 — `/altitudes/seen` uses a compare-and-set stamp (QA-DEC-1, amends Step 2.5)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead, auto-pilot) — reversible by
  Sara without reopening the build
- **Decision:** `markValueUnitSummariesSeen` becomes
  `UPDATE value_unit_summaries SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE unit_key = ? AND regenerated_at IS ?`
  (`IS ?` so the first-generation NULL leg matches; `= ?` would silently stamp
  nothing). The endpoint payload becomes
  `{ project_id: string, units: [{ unit_key: string, regenerated_at: string|null }] }`
  → `{ updated: n }`, where `n` is the summed `.changes` and therefore honestly
  reports a stamp that missed.
- **Why:** `risk.md` **T-D**. The planned unconditional stamp loses a marker in a
  real same-process interleaving (user views G1 → the tick regenerates to G2,
  arming a new marker → the user's in-flight `/seen` POST lands and clears it), so
  G2's "updated" state is **never shown** — a silent failure of the slice's
  headline promise, which `OPEN-1` has already reduced once knowingly. `SEEN-4`
  pins the *other* direction (regeneration re-arms via `seen_at = NULL` inside the
  one writer's `DO UPDATE SET`) and is kept; the two halves must not be conflated.
- **Ripple (all planned, none built yet):** `server/routes/project-plans.js`
  (validation + statement), `client/src/lib/types.ts`, `client/src/lib/api.ts`
  (`markAltitudesSeen(projectId, units)`), `client/src/components/PlanLedgerPanel.tsx`
  (both the per-unit "×" and dismiss-all already hold `regenerated_at`), and the
  `SEEN-*` / `E3` / `E5` / `C2` cases. Still idempotent, still one statement, still
  one lexical call site (guard **W-3** unaffected).
- **Pinned by:** `SEEN-6` (deterministic, no timing), red-proven twice — drop the
  predicate → the stale stamp silently eats the marker; `IS ?` → `= ?` → a
  first-generation marker becomes undismissible.
- **Veto path (Sara):** delete the predicate and the `regenerated_at` field, delete
  `SEEN-6`, and open a WATCH row naming the un-shown-marker race.

### DEC-18 — The deterministic half of WATCH-C's convergence claim is tested (QA-DEC-2)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** add `E7` — seed a cached row at snapshot B → `POST /altitudes` at
  stage A (the stale-tab shape, deterministically) → assert regeneration stamped A
  plus a `source='request'` log row → run the tick with the pool at stage B →
  assert regeneration stamped B with the marker present → **run the tick again,
  inputs unchanged → `generated = 0`, `cache_hits = pool_size`, zero broadcasts**
  (INV-10).
- **Why:** `risk.md` **T-H**. `WATCH-C`'s own text asserts a *deterministic*
  property nothing tested ("the next tick's fresh `assembleValuePool` re-invalidates
  and **converges**"). If the two paths normalize asymmetrically they ping-pong the
  same unit forever — silent, unbounded LLM spend with a green suite throughout.
  `E6` covers tick→route only.
- **Red proof:** make the route's coercion asymmetric with the assembler's
  (`stage ?? ""`) → `E7`'s third step goes red.
- **See also:** the `WATCH-C` amendment below.

### DEC-19 — The `openapi-extra` fragment for `/altitudes/seen` is declined this slice (QA-DEC-3)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** no OpenAPI fragment and no `npm run openapi:yaml` in this slice's
  docs step. `docs/API.md` documents the endpoint (with DEC-17's payload and
  DEC-20's advisory `project_id`) instead.
- **Consequence, stated plainly:** `openapi.yaml` — the artifact this repo declares
  the source of truth for request/response contracts — will omit the new endpoint
  **and** the widened altitude entry schema, and `openapi-contract.test.js` will
  **stay green over the omission**, because its scan derives scope from
  `app.use("/api/…")` **mounts** and `/api/project-plans` is already mounted and
  documented. A brand-new route *under an existing mount* is structurally invisible
  to it — §9.7's shape inside CONTRACT-SPEC-DRIFT's own cure.
- **Therefore binding on this build:** the CONTRACT-SPEC-DRIFT scope-limit note in
  `qa/qa-assessment.md` §"Catalog notes" (written there as *optional, if the build
  declines*) is **required**, applied verbatim on the effort branch at the catalog
  step. The candidate's count stays unchanged — this is a pre-flag, not an
  occurrence (neither promotion trigger is met).
- **Veto path (Sara):** one fragment + one `npm run openapi:yaml` run; the catalog
  line stays useful either way.

### DEC-20 — `project_id` on `/altitudes/seen` is advisory (QA-DEC-4)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** `project_id` is validated for **shape** (non-empty string; 400
  otherwise) and used for nothing at the statement layer, which scopes by
  `unit_key` alone. Documented as advisory in `docs/API.md`.
- **Why:** `risk.md` **T-K**. `unit_key` embeds the cwd
  (`intake_initiative::<ref>::<cwd>`), so cross-project collision is not reachable
  in practice on a local-first single-user dashboard; real enforcement would mean
  resolving the project path and validating every key's trailing segment.
- **Pinned by:** `SEEN-7`, titled **BY DESIGN** and carrying the reason in its body
  — the hazard here is not the missing scope, it is a later half-fix that makes
  dismissal fail **invisibly** for legitimate keys. If real scoping is ever wanted,
  the documented contract changes first.

### DEC-21 — The first-upgrade marker flood is accepted as one-time noise (QA-DEC-5)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** no suppression. DEC-9's legacy burst arms a marker on every legacy
  mutable row (~182-unit pool, draining ~1h40m–4h10m per `OPEN-3`), so Sara's first
  post-upgrade panel view is a wall of "updated — label changed" markers for texts
  that mostly did not meaningfully change. "Dismiss all" is the mitigation.
- **Why not suppress:** the alternative (suppress when the *previous* snapshot was
  legacy-NULL) makes the marker mean two things and adds a branch to the one
  writer — §9.8's shape inside the writer this slice is keeping single-purpose —
  and it weakens D5/D6's symmetry.
- **What the accept requires:** the mitigation is **tested, not assumed** —
  `C2(c)` asserts 60 unseen units are batched into **one** `markAltitudesSeen` call
  carrying exactly the unseen key set.
- **Also:** one sentence added to `OPEN-4` so Sara meets this in writing before she
  meets it on screen.

### DEC-22 — TEST-AGAINST-LIVE-DB: third decline, recorded, with a compensating control (QA-DEC-6)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead) — the decline
  `technical-plan.md` §7 already binds; this is that row
- **Decision:** the class-level cure is **not** promoted in this slice. A
  runner-level "fail if `DASHBOARD_DB_PATH` is unset" check is *structurally wrong
  here*: specs legitimately set the variable **inside** the block before requiring
  `../db`, which is exactly why a per-file grep is a proven-invalid sweep; a
  process-start check would fail correct specs. The right cure is a refusal inside
  `db.js` when running under test — a product change to the boot path, which does
  not belong in a slice already carrying DDL, a new writer, a guard widening and
  three P0 amendments. It deserves its own small intake.
- **Compensating control adopted now:** `db.js` exports `DB_PATH` (`db.js:118`,
  `module.exports` at `3214`), so **every server spec this build touches or creates
  asserts `require("../db").DB_PATH === <its temp path>`** — a positive, in-process
  control a grep can never be.
- **Consequence of deferring:** a future spec that requires `../db` without setting
  the path still migrates Sara's live user-global DB, and nothing fails loudly.
  Promotion triggers unchanged: (a) a second test file found doing it, or (b) it
  actually fires. This is the **third** recorded decline; the catalog already
  records the first two.

### DEC-23 — DEC-4's log arithmetic: the request-path partition gets ONE owner (QA-DEC-7, amends DEC-4)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead) — **amends DEC-4**, which
  otherwise stands
- **The defect being fixed (verified at `origin/master:server/routes/project-plans.js:148-171`):**
  the composer is called with `clean` — the sanitized subset — so `counts` sums to
  `clean.length`, while DEC-4 logs `pool_size = units.length`. A unit with an
  unrecognised `value_source` is diverted to a **route-level** `states` map the
  composer never sees, and a key-less unit is dropped entirely, so the **first
  malformed or old-client request breaks the four-term identity** the whole slice
  treats as inviolable. This is §9.8's own build-phase prediction ("the two failures
  landed at the route and the table — the seams the composer's partition test
  cannot see") arriving at the route seam one effort later, downstream of the very
  sanitizing loop that was S3's fix.
- **Decision:** rather than fixing the arithmetic at the route, remove the second
  derivation. `enrichPoolAltitudes(dbModule, units, opts)` accepts
  `opts.droppedCount` (default `0`) and folds it **inside the one place counts are
  computed**: `counts.pool_size = units.length + droppedCount` and
  `counts.unavailable = <composer unavailable> + droppedCount` (route-dropped =
  attempted-and-unusable, mirroring the S3 wire fix). The route passes
  `droppedCount: units.length - clean.length` at its single composer call site and
  logs `counts` **verbatim**, `pool_size` included; it never computes a partition
  term. The tick passes nothing, so every existing tick number is unchanged. The
  wire (`altitudes`/`states`) is untouched.
- **Effect:** `pool_size` is still the submitted batch size (malformed traffic stays
  visible in the log), the four terms still sum to it **by construction rather than
  by arithmetic care**, and DEC-14's "computed once by the composer for both
  loggers" becomes true at the route too. Inapplicability over compliance.
- **Pinned by:** `ROUTE-SEAM-1` (N good + 1 bogus `value_source` + 1 key-less → one
  log row, `pool_size === units.length === counts.pool_size`, four terms sum
  exactly, every **keyed** unit bucketed once on the wire) and `COUNTS-DROPPED`.
- **Carried warning:** `qa/supporting/unit-tests.md` §2.5's route-logging assertion
  (`pool_size === units.length` with unadjusted `counts`) **asserts the defect** — a
  plan-level vacuous fixture, §9.3's sub-pattern. It is corrected in `test-plan.md`
  and must not be carried forward; grep the shipped diff before closing. And per
  §9.3's event #1 one effort ago on this same identity: **if this guard goes red on
  day one, fix the product, never weaken the guard.**

### DEC-24 — DEC-15 resolves to its TITLE: the strong scan form is plan-of-record (QA-DEC-8, amends DEC-15)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead) — **amends DEC-15**'s body
  and `technical-plan.md` Step 5 / §6 A2
- **The contradiction:** DEC-15's *title* says the scan "permits exactly one mention
  of the unit: `unitFacts(u)`"; its *body* specifies only "no `u.<field>` /
  `unit.<field>` property access". A faithful implementer builds the body's version,
  which is evaded by bracket access, destructuring, aliasing, spread-copy (which
  even satisfies the planned `facts.` sentinel) and parameter renaming — five of the
  seven evasions in `risk.md`'s table.
- **Decision — the title wins, in its strongest form.** The scan: strips **both**
  comment styles (block first, then line); extracts `buildPrompt`'s lexical body;
  **derives both identifiers from source, never hand-typed** (§9.7, evasion #7) —
  the per-unit identifier from the units `.map(` callback's first parameter, the
  array identifier from `buildPrompt`'s signature; and asserts nine things,
  including **exactly one mention of the per-unit identifier inside the callback
  body**, that mention being the argument of `unitFacts(...)`. Eight mutations, each
  observed red **individually**, plus a comment green-proof as the over-breadth
  control. Full mechanics in `qa/test-plan.md` §Layer 1 → `A2`.
- **New evasion class found while reconciling the two QA documents (#9):**
  `units[0].stage` — indexing `buildPrompt`'s **array** parameter directly. It
  matches **none** of the designed regexes (in the string `units[`, `\b(u|unit)` is
  followed by `s`, not by `.` or `[`). Closed by assertion (i): the array parameter
  is mentioned exactly once, immediately followed by `.map(`. Mutation `M-A2-7`.
- **Evasion #8** (a helper one frame away in the same file reading `u.stage`) is
  structurally out of a lexical body scan's reach. Its disposition — naming the
  comparator-single-home scan, the DEC-7 parity cases and INV-10's steady state as
  the backstops — **must be written into the scan's own comment**, or it becomes
  §9.1's "one call frame away" recurrence with a green tick over it.
- **No veto path.** This is the slice's one never-traded-away item; the weak form
  ships the cure evadable.

### DEC-25 — Step 2.4 is replaced by `addColumnsIfMissing`, and the migration meta-test learns to see it (QA-DEC-9)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead) — **replaces
  `technical-plan.md` Step 2.4**; `DEC-5` stands (the PRAGMA idiom is still the
  right probe)
- **The defect being fixed (`risk.md` T-E, Critical):** Step 2.4 is one `db.exec` of
  five sequential `ALTER`s behind a **single** probe on `input_label` — the *second*
  column added — with no transaction and no try/catch. `db.exec` on a
  multi-statement string is sequential, not atomic. A death between statements 1 and
  2 (SQLITE_BUSY against the live WAL DB a long-running dev server holds, OOM,
  `kill -9`, a Ctrl-C on a slow first boot) leaves `input_stage` present and
  `input_label` absent; the probe then says "missing", the block re-runs, and
  `ADD COLUMN input_stage` throws `duplicate column name` **out of `require()`** —
  bricking Express, MCP, the desktop app and the VS Code extension simultaneously
  against the one shared user-global DB (§9.6's B3 blast radius, reached with no
  rebuild anywhere). Probing the *first* column instead only swaps it for the silent
  failure: block skipped forever, four columns permanently missing. **Neither planned
  test can see either outcome** — M1's clean-run legs pass under both orderings and
  e2e B1 boots on a *complete* legacy DB.
- **Decision:** build the durable cure now — `addColumnsIfMissing({ table, columns })`
  in `server/db.js`, mirroring `rebuildTableAtomically` (`db.js:1640`): probes
  `PRAGMA table_info` **per column** (convergent under any interleaving), applies
  only the missing ones inside **one** `BEGIN…COMMIT`, and **catches, rolls back,
  logs and continues** so it can never throw out of `require()` (§9.6's "atomicity
  is necessary and not sufficient — the caller is `require()`"). This slice is its
  **first call site**, for both blocks (six columns, two tables — the largest such
  block in the file). The **five** pre-existing hand-rolled blocks at `55fe900`
  (`agents.workflow_run_id`+`workflow_phase` ~1003-1008 — ALTERs inside a `catch`,
  so a throw on the second escapes; `model_pricing.fast_*` ~1059-1067;
  `color_thresholds` rate columns, six, ~1466-1476; `color_thresholds`' legacy
  split, six, ~1503-1515; `context_snapshots.input_tokens`/`cache_read_tokens`/
  `cache_write_tokens` ~1959-1971) are **grandfathered with dated reasons rather
  than the scan weakened** — the exact `REBUILD_CASES` precedent.
- **The interaction that makes the meta-test extension non-optional:**
  `db-migration.test.js:1414-1451` derives its obligation by regex-scanning `db.js`
  for `ALTER TABLE (\w+) ADD COLUMN (\w+)` and **skips templated columns**. Routing
  the DDL through a helper that builds `ALTER TABLE ${table} ADD COLUMN ${name}
  ${type}` makes all six columns **invisible to that scan** — the six
  `UPGRADE_CASES` entries would stop being mechanically forced the moment the cure
  lands, and every future helper call site would inherit the hole. So the cure ships
  with two new scans: **`HELPER-CASE-SCAN`** (every `table.column` passed to the
  helper needs its own `UPGRADE_CASES` entry — **six**, not two, per
  `db-migration.test.js:1414-1451`'s per-column derivation) and
  **`ALTER-BLOCK-SCAN`** (no multi-statement ALTER block outside the helper; the
  five pre-existing sites in an **exact-set** grandfather registry with dated
  reasons — an orphan entry fails too).
- **Proof is an INTERRUPTION case at two grains**, not the clean-run idempotence
  case every existing migration test writes: `M1-INT` (module grain — seed legacy
  **plus `input_stage` only**, `require`, assert no throw / all five present /
  pre-existing data survived / second run a no-op) and `B4` (whole-app boot grain,
  new spec `server/__tests__/value-summary-interrupted-boot.test.js`, because §9.6's
  claim is about `require()`'s blast radius across the **whole module graph**). Each
  red-proven under **both** failure orderings, both outputs recorded.
- **Veto path (Sara):** the point fix (probe per column at this site only, plus
  catch-log-continue) clears T-E for this slice — but the five shipped sites stay
  latent and the next author has to remember, which is how §9.6's non-atomic
  population came to exist. Do not take it silently.

### DEC-26 — A seventh i18n key: `updatedGeneric` (QA-DEC-10)

- **Status:** DECIDED-AUTO (2026-08-04, `team-qa` lead)
- **Decision:** the client's `update_reason → i18n key` map gains a `default` arm
  pointing at a new key `planLedger.pool.altitudes.updatedGeneric` (en: *"updated"*),
  added in **all four** locales. The slice's key count moves **6 → 7**.
- **Why:** `risk.md` **T-C leg 3** — the one leg neither test architect claimed.
  `regen_reason` deliberately has **no CHECK** (DEC-12: "future reasons stay
  additive"), so a future server will send a reason today's client has no key for,
  and a naive `t(mapReason(reason))` renders the literal
  `planLedger.pool.altitudes.updatedSomethingChanged` to the user — an unresolved
  boundary token at the UI, against the change brief's own named invariant.
- **Pinned by:** `C3(d)` (generic copy renders; `document.body.textContent` matches
  no `/planLedger\.[a-zA-Z]/`), `C-registry` (the `default` arm exists), and the
  extended server-side registry→locale test. `i18n.test.ts` E1.1 derives ko/vi/zh
  parity from `en` mechanically.
- **Knock-on:** `OPEN-4`'s copy list grows by one string — Sara's approval of the
  marker wording now covers a fallback too.

---

## Paste target 2 — append under the **WATCH rows** table

### Amendment to WATCH-C (2026-08-04, `team-qa` pass — see DEC-18 / QA-DEC-2)

> **WATCH-C's convergence claim is now verified, not merely asserted.** The row's
> text asserted a *deterministic* property nothing tested — "the next tick's fresh
> `assembleValuePool` re-invalidates and **converges**". `E7` pins it end to end
> (route regenerates from stale client inputs → the tick re-invalidates from fresh
> assembler inputs → **a third tick on unchanged inputs quiesces at
> `generated = 0`**, INV-10). **What remains watched is only the timing half** — a
> stale tab's POST interleaving with an in-flight tick, which is genuinely
> untestable cheaply and which DEC-4's request-path log row makes observable in
> production. Trigger unchanged: observed text flip-flop, or anomalous
> duplicate-generation counts in the log.

---

## Paste target 3 — one sentence into **OPEN-4** (see DEC-21 / DEC-26)

> **Two copy consequences the QA pass surfaced.** (1) On the **first** post-upgrade
> view, DEC-9's legacy burst arms an "updated — label changed" marker on **every**
> legacy mutable unit (~182 at the measured pool size, draining ~1h40m–4h10m per
> OPEN-3) for texts that mostly did not meaningfully change; this is accepted as
> one-time noise with "dismiss all" as the mitigation (DEC-21), and the mitigation
> is tested at burst scale rather than assumed. (2) A **seventh** string is now in
> scope — `updatedGeneric` (en: *"updated"*), the fallback rendered when a future
> server sends a `regen_reason` this client has no key for (DEC-26). Both are
> content changes if Sara wants different wording, and both reflect back into
> `requests/2026-08-04-value-pool-grouping/request.md`, not just into the component.
