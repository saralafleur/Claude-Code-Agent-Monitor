# PM Plan — Value Pool altitude cache: mutability-aware caching + invalidation (Slice 1)

**Intake:** `2026-08-04-altitude-invalidation`
**Parent request:** `requests/2026-08-04-value-pool-grouping/request.md` (four-slice vision; this is Slice 1 only)
**Run mode:** auto-pilot — every fork below is taken by the team and logged
`DECIDED-AUTO`. Sara may reverse any of them without reopening the build.
**Date:** 2026-08-04

---

## 1. Request summary

The Value Pool generates two sentences of plain-language description
("PROJECT" / "STAKEHOLDER" altitude) per unit of delivered work and caches
them forever, keyed on the unit's key. That is correct for a commit — a SHA's
subject line never changes — and wrong for an initiative or a detour, whose
**stage** and **label** move on while the cached sentence does not. There is a
live example on record: the Resume project's `2026-08-03-job-pipeline-tracker`
initiative is cached as *"The job pipeline tracker is built and being tested"*
and will keep saying that after the tracker ships. This slice makes the cache
honest: store the inputs each cached sentence was generated from, treat a
change in those inputs as a cache miss for that one unit, show the user an
"updated — stage changed" marker until they acknowledge it, and record the
invalidation in the generation log. Commit-keyed units keep today's
generate-once behavior.

---

## 2. Request type

### Final call: **`missed-requirement`**, with one **`new-feature` carve-out** (the seen-state round-trip)

Triage's provisional `new-feature` is overturned. The product owner's reading
("new-feature that retires a latent correctness defect") describes the *shape
of the remedy*, not the *class of the defect* — and on this project that
distinction has already been ruled on once, one day ago, on this same file.

**The evidence is inside the change that shipped the defect, not one document
away.** `server/db.js` (verified at `origin/master:55fe900`, lines 821-825)
declares:

> Keyed on the unit's own unitKey, NOT a content digest like focus_summaries —
> a unit's ground fact (a commit's subject line, an intake slug) is immutable
> once seen, so there is nothing to invalidate: generated once, served forever.

That sentence is *true of the two things it names* (a commit subject, an
intake slug) and **false of what the code in the same module actually feeds
the model**. `buildPrompt` (`value-summary.js:99-105`, verified) renders
`value_source`, `label || value_ref`, **and `u.stage`** — and
`assembleValuePool` (`value-ledger.js:207-223`, verified) stamps
`stage: initiative.stage` onto initiative *and* merge-commit units by
construction. Stage is a progress field. It was mutable on the day the comment
was written, provably, from the same author's own code. Nothing had to change
in the world for the claim to be wrong; it was never true.

So:

- **Not a bug.** The code does exactly what it was designed and documented to
  do. Nothing is broken relative to its specification; the specification is the
  defect.
- **Not a regression.** Generate-once never worked "before"; it has behaved
  identically since it shipped (`b155f83`, 2026-08-04).
- **Not a new-feature.** The requirement "a cached description must reflect
  the inputs it was generated from" is not a new capability anyone asked for
  late — it is the minimum obligation of any cache, and it went unstated
  because **the prompt's input set was never enumerated**. The requirement was
  incomplete from the start. That is the definition of `missed-requirement`.

**Consistency with the immediate precedent.** The sibling intake
`2026-08-04-value-summary-tick` was classified `missed-requirement` on exactly
this test: a shipped design's own comment (`MAX_UNITS_PER_PROMPT = 40`, *"Pool
batches are small in practice, so overflow is expected to be rare"*) was
disproven by a 182-unit pool already recorded in the previous effort's
`decisions.md` one day earlier. The test applies here **more strongly, not
less**: that falsifier was one day and one document away; this one is zero days
and zero documents away — it is the sibling function in the same file. If
`value-summary-tick` was a missed requirement, this is one a fortiori.

### The `new-feature` carve-out

Genuinely additive capability, not implied by any prior requirement, and the
first thing to cut if the slice needs shrinking:

- **The seen-state round-trip** — `seen_at` on the summary row, a second
  writer statement (`markValueUnitSummariesSeen`) and its new single-writer
  guard, `POST /api/project-plans/altitudes/seen`, the client marker +
  acknowledge interaction, and its four locales. Nothing in the pool's prior
  design contemplated per-unit acknowledgement state. Same shape as the
  sibling's carve-out (its operator-level Settings surface).

### Two things that are neither, named so they aren't mis-billed

- **Request-path generation logging (WATCH-6, fork (a) below)** — *scheduled
  debt, now due.* DEC-14 built the `source='request'` enum value for precisely
  this, and WATCH-6 names this as the widening moment. Same framing as
  `trunk-drift-detection`'s WATCH-4 precedent: pre-priced, not new scope.
- **Including `merge_commit` in the mutability set (fork (b))** — a *scope
  correction*, our cost, one string.

**Cost framing in one line:** the input-snapshot gating, the regeneration
behavior, the doc/comment corrections and their tests are **our cost** (we
shipped the defect two days ago); the seen-state round-trip is **new scope**
Sara has already approved; the request-path log widening is **debt coming due**.

---

## 3. History / background — where this is coming from

### Timeline of this exact surface

| When | Event | Classification |
|---|---|---|
| 2026-08-02 | `plan-lifecycle-value-ledger` intake creates the value pool (`assembleValuePool`, `value_claims`, the unit vocabulary). No altitude layer yet. | new-feature |
| 2026-08-03 | That effort's **DEC-12** signs off against a rendered **live 182-unit** Coaching Assistant pool. | — |
| 2026-08-04 (early) | The altitude layer — `server/lib/value-summary.js`, `value_unit_summaries`, `POST /altitudes` — is found as **~991 uncommitted lines on `master`** and committed as `b155f83` (that cycle's OPEN-1/DEC-13). Its schema comment declares generate-once-serve-forever. **The prompt already feeds `stage`.** | — |
| 2026-08-04 | `value-summary-tick` intake: the 40-unit cap silently collapses five distinguishable outcomes into one absence. Classified **`missed-requirement`**. Promotes **§9.8 OVERLOADED-ABSENCE** to a numbered catalog entry, whose **live instance #1 is `enrichPoolAltitudes`**. Built and merged as **`55fe900`**. | missed-requirement |
| 2026-08-04 (now) | **This intake.** The *other* unevidenced claim in the same module — "immutable once seen" — is disproven, with a live stale row to show for it. | missed-requirement |

### Have we seen this before?

**Yes — three ways, and it is worth separating them because they have
different cures.**

1. **The surface: 3rd intake in 3 days, 2nd consecutive on `value-summary.js`,
   and both of those classified `missed-requirement`.** This is not a module
   that keeps breaking; it is a module that keeps **shipping with an
   unexamined premise**, twice in a row, in the same week.
2. **The failure *shape*: an unevidenced claim in a comment.** Both instances
   are a load-bearing assertion about the world, written into a comment as
   justification for a design shortcut, falsifiable at the moment of writing
   from artifacts already in hand, with **no mechanism that forces anyone to
   check it**:
   - `value-summary-tick`: *"overflow is expected to be rare"* — falsified by
     DEC-12's 182 units, recorded the previous day.
   - here: *"a unit's ground fact … is immutable once seen"* — falsified by
     `buildPrompt`'s own `u.stage` read, thirty lines away.
3. **The catalog entries this lands on, all previously seen:**
   - **§9.8 OVERLOADED-ABSENCE** — this is that entry's own live instance #1,
     and this slice is **the follow-through on its named cure**. §9.8's build
     confirmation (2026-08-04) closed the absence half; this closes the
     staleness half. **Count stays unchanged** — re-encountering a known
     instance is explicitly *not* an occurrence per the entry's own rule. The
     new states introduced here are a **design-time pre-flag**, not a new
     occurrence.
   - **§9.1 DERIVED-DUAL-VIEW** (at 6, twice-proven "a rogue-*reader* scan does
     not catch a rogue *re-derivation*") — the shared-comparator obligation.
     §5 and DEC-2 below make it *inapplicable* rather than guarded.
   - **§9.5 FRESH-DB-BLIND SCHEMA CHANGE** — guarded ALTER + `UPGRADE_CASES`.
     **The request brief pointed at the wrong idiom**; corrected in DEC-5.
   - **§9.3 VACUOUS-GUARD** — the prior effort on this exact surface holds the
     project record: **eight** §9.3-family events in one pipeline, including
     the **VACUOUS-REPAIR** sub-pattern (the repair of a vacuous guard was
     itself vacuous). That discipline carries into this build unchanged.
   - **WATCH-6 / WATCH-7** from that effort's `decisions.md` — both are
     touched here, deliberately (forks (a) and (c)).

### Decisions this request touches, and whether it contradicts any

| Prior decision | Effect here |
|---|---|
| **DEC-14** (`source='request'` in the log enum, unused, pre-paid) | Consumed by fork (a). Working as designed. |
| **WATCH-6** ("the guard will go red when request-path logging lands … widen deliberately, in the same change") | This is that change. Ruled: widen now. |
| **WATCH-7** (route-vs-tick two-writer race blessed safe-but-wasteful) | Frequency profile changes; extended, not re-litigated (fork (c)). |
| **DEC-10 / DEC-11** (server-authored per-unit state; strict `{altitudes, states}` partition, "never both, never neither") | **Preserved intact.** Freshness rides as extra fields on resolved entries, not as new `states` values — see DEC-3. |
| **DEC-16 / `CONSUMERS`** (`assembleValuePool` is the sole pool composer) | Untouched. No new pool assembly. |
| **DEC-12 / WATCH-2** (Settings "clear data" omits the value tables) | Unchanged by this slice; the fast-follow still owns it. |
| **OPEN-2** (validation project, PENDING Sara) | Does not block — this slice's walkthrough is fixed on the Resume example by the request itself. Don't let it silently close. |
| **db.js schema comment** ("generated once, served forever") | **Deliberately reversed**, with the request's explicit authority. Rewriting it is a done-criterion (PO AC-7), not a nice-to-have. |

**No contradiction of a settled decision.** The one reversal is authorized in
the request text itself.

---

## 4. Recurrence diagnosis — the systemic cause

**The fix is not "add a digest." The fix is to stop a class of claim from
being unfalsifiable.**

Both consecutive defects on this surface have the same author-side mechanism:

> A design shortcut is justified by an assertion about the world, the
> assertion is written in a comment, and **nothing in the pipeline can fail
> because the assertion is wrong.** Tests assert the documented contract; the
> documented contract *is* the defect. The suite is green in both cases.

§9.8's build already named the countermeasure for the *bound* form:

> **"Any bound on a user-visible collection must cite, in its own declaring
> comment, the measured real distribution it was sized against."**
> — with the killer observation that *"a comment forced to name the number
> could not have been written."*

That cure was adopted for bounds and **was never generalized to
invariants**. This request is the identical failure one class over: an
**unevidenced invariant** ("these inputs are immutable") instead of an
unevidenced bound ("this collection is small"). The same sentence, with two
words changed, would have prevented it:

> **A cache/immutability claim must enumerate the input set it is a claim
> about, and name the single function that computes that set.**

A comment forced to enumerate `{value_source, label||value_ref, stage}` could
not have concluded "immutable."

**And the durable form of that rule is not a comment — it is a shape.** The
recurrence risk that survives this slice is the *next* field added to the
prompt: someone adds `attribution` or a date to `buildPrompt`, does not add it
to the comparison, and silent staleness returns with every test green. That is
§9.1's twice-proven lesson (a rogue-*reader* scan misses a rogue
*re-derivation*) pointing in the less-obvious direction — a **prompt** reading
a field the **comparator** doesn't cover.

**So the durable fix is structural, and it is cheap:** `buildPrompt` must
consume `unitFacts(unit)` and **never** the raw unit, so the prompt's input
set and the compared input set are *the same object*, and a new prompt field
is physically impossible to add without adding it to the comparison. Not a
guard someone must keep correct forever — inapplicability, which this project's
own catalog says to prefer over compliance (§9.6's 2026-08-02 lesson, proven
twice since). A structural scan asserting `buildPrompt`'s body contains no
`u.<field>` / `unit.<field>` access outside the facts object is the belt
(DEC-2), red-proven per §9.3.

**Secondary, process-level recurrence worth stating plainly:** the altitude
layer reached `master` as 991 uncommitted lines and needed OPEN-1 to unstick
it; today the main checkout is **44 dirty paths** from a concurrent session,
three of which are files this slice edits. The "capability ships with nothing
recording it" thread (3× in this repo, 2× cross-project, same process fix
recommended 3× and adopted 0×) is still live. §5's branch-cut procedure is how
this slice avoids becoming its 4th instance — and it is a **precondition, not
a recommendation**.

---

## 5. Environment prerequisite — branch-cut procedure (BLOCKING)

Verified by direct inspection, 2026-08-04:

- Local `master` = **`d830a44`**, `[origin/master: behind 2]`.
  `origin/HEAD` = **`55fe900`** (the tick merge). Behind, fast-forwardable,
  **not diverged**.
- The working tree has **44 modified paths** from a concurrent session —
  including **`server/db.js`, `client/src/lib/api.ts`, `client/src/lib/types.ts`**,
  i.e. three files this slice must edit — plus Coach/Playbook/Usage/i18n work
  that has nothing to do with this request.
- Two effort worktrees already exist under
  `/Users/sara/CODE-LOCAL/SARA/efforts/`.
- A dev server is running (`concurrently` pid 79758, ~19h uptime) against the
  **shared** `~/.claude/agent-dashboard/dashboard.db`, and a `claude` CLI
  session (pid 88709) is live.

**Procedure — mandatory, in this order:**

1. `ps -eo pid,etime,command | grep -i claude` and
   `lsof ~/.claude/agent-dashboard/dashboard.db` **before any git operation**
   (this repo's `concurrent-session-risk` memory: multiple sessions share this
   cwd and it *has* caused real work loss).
2. **Do not** fast-forward, stash, checkout, or clean the main checkout. Leave
   the 44 dirty paths exactly as they are; they are someone else's in-flight work.
3. `git fetch origin`, then cut a **fresh worktree** from `55fe900` (or later):
   ```
   git worktree add /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor \
     -b effort/2026-08-04-altitude-invalidation 55fe900
   ```
   Then `npm run setup` (or `npm install`) inside the worktree.
4. **Back up the live DB before the effort branch is booted or tested even
   once.** This slice ships DDL; `DB_PATH` resolves to the user-global shared
   file, a dev server is currently holding it, and `db.js` runs migrations at
   `require()` time. The columns are additive/nullable so a code-level back-out
   leaves a working database (§9.5's own guidance) — the backup is for the
   crash-mid-run case, not the rollback case.
5. **Every** test invocation sets `DASHBOARD_DB_PATH` to a temp path, scoped to
   the block that calls `require("../db")` — a per-file grep is a proven-invalid
   sweep for this (§9.3, 2026-08-03). This is the still-uncatalogued
   **TEST-AGAINST-LIVE-DB** candidate, and a schema-shipping slice is exactly
   its promotion trigger.
6. All intake/QA/build artifacts for this slice are written **in the worktree**,
   not in the dirty main checkout. (Exception already taken: this plan itself,
   under the untracked new `requests/` tree — isolated, no tracked file touched.)

---

## 6. Decisions — reconciling the four evaluations

The specialists converge cleanly on the architecture: one shared `unitFacts()`
extraction, gating inside `readCached`, stale-becomes-a-miss reusing the
existing machinery untouched, freshness as extra fields on resolved entries
(not new `states` strings), server-side "seen", and stale-on-first-check for
pre-digest rows. Those are adopted as written. What follows is what needed a
ruling.

### DEC-1 — Classification — **DECIDED-AUTO**
`missed-requirement` with a `new-feature` carve-out (seen-state round-trip), per §2.

### DEC-2 — Storage shape: **store the raw prompt-feeding fields; NO digest column** — **DECIDED-AUTO**

This reconciles the engineer's correction with the architect's digest design,
in the engineer's favour.

**Ruling:** `value_unit_summaries` gains **`input_stage TEXT`** and
**`input_label TEXT`** (nullable). There is **no `input_digest` column**, and
**no belt-and-braces "both" design** — two representations of one truth is
§9.1 by construction. Comparison is field-wise, in one shared function.

Reasoning:

1. **A sha1 cannot produce the required wording.** The approved copy is
   *"updated — stage changed"*; a hash over `(stage, label)` destroys which
   field moved, forcing the PO's degraded fallback (*"details changed"*) for
   the **only** case Sara actually named. The engineer's G2 is decisive.
2. **The fields ARE the digest.** `focus_summaries` hashes because its input is
   a multi-KB segment tree; here the input is two short strings. Hashing buys
   no space and loses information. The precedent transfers in **shape** (one
   shared extraction feeding both the prompt and the comparison) — which is the
   part §9.1 cares about — not in **representation**.
3. **It makes §9.1 inapplicable rather than guarded.** With a digest there is a
   *formula*, and this catalog has twice proven that a rogue-reader scan cannot
   see a second *derivation* of a formula. With raw fields there is no formula
   to re-derive: a second site would have to re-implement `a !== b`, which is
   not a divergence risk. Inapplicability over compliance, per the catalog's own
   preference.
4. **It is §9.5-identical in cost** — additive nullable TEXT, PRAGMA-guarded
   ALTER, no CHECK touched, no §9.6 rebuild.
5. **The reason comes for free**, computed by the same comparator that gated the
   read — never a second derivation (§9.1's "rogue re-derivation" lesson).

**Binding implementation details (do not let these be decided implicitly):**

- **Store the *resolved* value the prompt renders, not the raw column.**
  `buildPrompt` uses `u.label || u.value_ref || "(untitled)"`. Store *that*.
  Storing raw `label` makes a unit whose label goes `null` → `value_ref`
  fallback compare as "changed" when the prompt did not change (or vice versa)
  — §9.1's drift, in miniature, on day one.
- **Normalize `undefined → null` inside `unitFacts()`.** `detour` units carry
  **no `stage` key at all** (`value-ledger.js:259-266`, verified). One home for
  the normalization is what makes route-vs-tick parity structural (see DEC-7).
- **Reason precedence when both fields moved:** `stage_changed` wins, else
  `label_changed`, else (regeneration with no prior row) `initial`. One reason
  string, no CHECK on the column so future reasons stay additive.
- **Naming:** the whole surface should say "input snapshot", not "digest" —
  columns, the reason vocabulary, the rewritten `db.js` comment, and the
  ARCHITECTURE/DATABASE doc updates. "Digest" would leave a comment describing
  a mechanism that isn't there, which is the exact defect class this slice exists
  to close.
- **QA re-target (important — the QA plan is written around
  `computeUnitInputDigest`):** A1 becomes comparator stability/sensitivity
  (unchanged inputs → `null`; stage-only change → `"stage_changed"`; label-only
  change → `"label_changed"`); A2's structural scan targets the comparator +
  asserts no other file reads `input_stage`/`input_label`; **A3's mutation still
  applies verbatim** — have the write path stamp a mutated stage, and D2's
  zero-spawn assertion must catch it. D4 (label-only) and D3 (stage-only)
  remain the pair that pins both fields separately, and now also pin the two
  reason strings.

### DEC-3 — Freshness rides on resolved entries; `ALTITUDE_STATES` gains nothing — **DECIDED-AUTO** (architect Option A, ratified)

Architect Option B (new `states` strings) is **rejected on verified evidence**:
`AltitudeText` renders any unrecognized string as the "unavailable" copy, so a
live tab across the upgrade would *lose text it was already displaying* — the
one regression DEC-11's fallback exists to prevent. Freshness is a second,
server-authored, named dimension on the resolved entry, with its own exported
registry. DEC-11's partition stays byte-for-byte intact.

**Invariant to pin in tests:** *a unit with a cached row is ALWAYS present in
`altitudes`, whatever its freshness.* (Architect R3.)

§9.8 enumeration for this slice — every new distinguishable outcome, named, with
no silent absences: `stale_refresh_queued` (old text served, refresh over cap),
`stale_refresh_unavailable` (old text served, refresh attempted/impossible),
`updated_unseen` (regenerated, not yet acknowledged), `input_stage/input_label =
NULL` (**exactly one meaning: legacy pre-snapshot row** — stamped on every new
write, so it never also means "immutable unit"), `stale_regenerated = NULL` in
the log (predates measurement — hence **nullable, no DEFAULT**; `ADD COLUMN …
DEFAULT 0` would stamp history with a false measured zero).

### DEC-4 — Fork (a), WATCH-6: **request-path logging lands NOW** — **DECIDED-AUTO** (architect A1)

With gating in the shared read path, the request path regenerates stale units
whether or not it logs. If it does not log, a view-triggered invalidation
produces **no audit row anywhere** (the tick later sees a cache hit) — and the
log's silence would then mean two different things ("no invalidation happened"
vs "one happened on the fast lane"). That is §9.8's shape at the observability
layer, introduced by the change written to cure §9.8. Acceptance signal 4 would
be only tick-complete while reading as complete.

DEC-14 pre-paid `source='request'`; WATCH-6 names this as the moment and says
"deliberately, in the same change"; QA has pre-declared the guard-red; the
engineer scoped it at ~10 route lines. Deferring buys ~10 lines and costs a
second WATCH row on a surface that already has eight — the disclosed-and-declined
shape this catalog says degenerates into nothing.

Conditions: widen `single-writer-guard.test.js`'s
`insertValueSummaryGeneration` file set **in the same commit**, red-proven by
injection (§9.3); the route honors the four-term partition using its
submitted-batch size as `pool_size`; and per engineer **G7**,
`stale_regenerated` is an **overlap counter, not a fifth partition term** —
document that at the column or the next test author will "fix" the identity
into a wrong five-term form.

### DEC-5 — §9.5 idiom: **PRAGMA `table_info`, not the try/SELECT probe** — **DECIDED-AUTO** (engineer's correction adopted; the brief and the architect both cited the deprecated form)

The request brief asked for the try/`SELECT … LIMIT 1`/catch idiom, and the
architect's §2 concluded it "applies" here because `value_unit_summaries` is not
a §9.2-scanned table. **Both are wrong, and the architect's exemption argument
fails on a verifiable fact:** since 2026-08-03 `chronology-ordering.test.js`
derives `filesToScan` from `server/lib/*` + `server/routes/*` **plus
`server/db.js`**, and `FILE_DISPOSITIONS["server/db.js"] = "scanned"` (verified
at `origin/master`). The scan looks at *db.js's SQL literals*, not at which
table they hit — so a new `SELECT … LIMIT 1` probe there is a scan candidate
regardless. §9.5's how-to-comply is also unconditional: use PRAGMA "rather than
this file's older try/`SELECT … LIMIT 1`/catch probe idiom." Copy
`detour_dispositions.project_id` (`db.js:1023-1026`), not
`plan_items.target_date`.

New columns land in **both** the `CREATE TABLE` body **and** the guarded ALTER,
with `UPGRADE_CASES` entries. **No new `GRANDFATHERED` entries** — the
db-migration meta-test forcing these cases is by design.

### DEC-6 — Fork (b), `merge_commit`: **included as mutable in slice 1** — **DECIDED-AUTO** (overrides the request's scope fence; cheap veto)

Verified: `value-ledger.js:216-223` stamps `stage: initiative.stage` on
`merge_commit` units and `buildPrompt` feeds stage into the prompt. So the
request's fence ("content-addressed → correct as-is") rests on **the same
unexamined premise this entire intake exists to correct** — the SHA is
immutable, the *prompt input set* is not.

Taking the architect's WATCH row instead would knowingly ship a fix for a defect
class while leaving a live member of that class in place, disclosed in advance.
That is verbatim the shape §9.7 and §9.8 both cite as their own argument for
themselves ("the failure survives even in the build that builds the cure"), and
§9.1 recorded it landing a third time one day after being written down. Not
again, not for one string.

**Ruling:** `MUTABLE_VALUE_SOURCES = ["intake_initiative", "detour",
"merge_commit"]`, homed in `value-ledger.js` beside `VALUE_SOURCES` (source
taxonomy, not synthesis logic), with `assertSingleHome`'s `absent` lists in
`single-writer-guard.test.js` updated deliberately. `trunk_commit` stays exempt
— it carries `label` only, sha-derived, so AC-1 holds for it literally.

Knock-ons: **PO AC-1 is restated** as "`trunk_commit` units unchanged" (not
"`trunk_commit`/`merge_commit`"); QA's **D1 immutable canary targets
`trunk_commit`**, which is what the existing fixture already defaults to
(`value-summary.test.js:97-106`) — **zero test churn**. Cost: one extra
regeneration (~$0.001) per initiative stage transition, and the marker appears
on both the initiative and its merge-commit unit — redundant but honest.
Exemption keys on `value_source`, **never** on "does this unit have a stage"
(engineer G1).

**Veto path:** if Sara prefers to honor the fence as written, drop
`"merge_commit"` from the array and take the architect's WATCH row — a one-line
reversal, no redesign.

### DEC-7 — Fork (c), the stale-client route race: **split into a required test + a WATCH row** — **DECIDED-AUTO**

The architect bundled two different things under one MEDIUM risk. They need
different treatments:

- **Deterministic half — REQUIRED TEST, not a watch.** If the route and the tick
  normalize `stage`/`label` differently (`""` vs `null`, dropped key), the same
  unit oscillates stale↔fresh between paths and regenerates on *every*
  alternation — silent, unbounded LLM spend that no existing test can see
  (engineer G8). This is not a race; it is a bug waiting for a normalization
  difference. Cure: `unitFacts()` is the sole normalizer for **both** paths
  (structural), **plus** an explicit cross-path parity case asserting the route's
  reconstructed unit and the tick's `assembleValuePool` unit produce identical
  facts.
- **Genuinely racy half — WATCH-C (below).** A stale tab regenerating from old
  inputs and stamping old inputs; the next tick re-invalidates and converges.
  Same posture as WATCH-7. Note the synergy with DEC-4: adopting request-path
  logging is what makes this WATCH's trigger *observable* at all.

### DEC-8 — "Seen" fires on **explicit acknowledgement**, not auto-on-render — **DECIDED-AUTO**

PO ruled "seen" server-side and left the mechanism to engineering; the engineer
flagged auto-on-render as cheapest. Ruling against it: auto-on-render means the
marker is consumed by the **panel mounting**, so a unit regenerated while a
second device sits on the page — real since LAN hosting shipped (`23cabdc`), the
very argument PO used to put "seen" server-side — is marked "seen" by a person
who never read it. "Seen" would then mean two things (rendered vs. read), which
is §9.8's shape reproduced at the acknowledgement layer, inside the slice whose
entire purpose is *"tell the user when something they saw before has changed."*

Per-unit acknowledge (a "×" on the marker) plus the PO-blessed one-click
"dismiss all updated markers". Cost: one click. `seen_at` is reset **inside the
single `upsertValueUnitSummary` writer's `DO UPDATE SET`** (engineer G3), never
as a second UPDATE from a caller.

### DEC-9 — Pre-snapshot rows: **stale-on-first-check, no backfill** — **DECIDED-AUTO** (PO AC-3, architect and engineer concur; ratified unchanged)

Backfilling from *current* stage/label would fabricate provenance — asserting a
text was generated from inputs it was not — and would stamp the motivating
Resume row **fresh**, defeating the request's own example. QA's D5 red-proof
("implement backfill → D5 red") is the executable record of this ruling and must
be written that way. Burst is bounded by existing caps (40/prompt, 3
projects/tick) and self-drains; observe and record its real size once (engineer
G10).

### DEC-10 — Catalog updates are a **build-phase task in the worktree**, not an edit here — **DECIDED-AUTO**

`PROJECT-CONTEXT.md` is tracked and currently **clean** in a 44-file dirty
checkout. Editing it now risks it being swept into a concurrent session's
commit — precisely the hazard §5 exists to avoid. The two notes below are
therefore written here verbatim and applied on the effort branch, as a DoD line.

> **§9.8, append — "Design-time pre-flag (2026-08-04,
> `requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/`
> — NOT an occurrence, count unchanged).** This entry's live instance #1
> (`enrichPoolAltitudes`) returns for the *other* half of its problem: not
> which absence, but which *staleness*. The generalizable addition is the
> **invariant sibling** of this entry's existing bounds rule. Today it says a
> bound must cite the measured distribution it was sized against; add: **a
> cache/immutability claim must enumerate the input set it is a claim about,
> and name the single function that computes that set.** `value_unit_summaries`'
> schema comment ("a unit's ground fact — a commit's subject line, an intake
> slug — is immutable once seen, so there is nothing to invalidate") was true of
> the two fields it names and false of the three `buildPrompt` actually renders,
> because `u.stage` was never enumerated. Same mechanism as
> `MAX_UNITS_PER_PROMPT = 40` one day earlier, one class over: an unevidenced
> **invariant** rather than an unevidenced **bound**, falsifiable at the moment
> of writing from code thirty lines away. A comment forced to enumerate
> `{value_source, label||value_ref, stage}` could not have concluded
> "immutable."

> **§9.1, append — "Design-time pre-flag (2026-08-04, same intake — NOT an
> occurrence, count unchanged at 6).** The obvious §9.1 read of this slice was
> "share the digest function so write-time and check-time can't drift" — this
> entry's classic cure, with its classic weakness (a rogue-*reader* scan cannot
> see a rogue *re-derivation* of a formula). The plan instead **removes the
> formula**: raw prompt-feeding fields are stored and compared field-wise, so
> there is no digest formula for a second site to re-derive, and `buildPrompt`
> consumes `unitFacts()` rather than raw units, so the prompt's input set and
> the compared input set are the same object. **Inapplicability over compliance,
> applied to this entry rather than to §9.5/§9.6** — where that preference was
> first stated (2026-08-02) and has since paid off twice. The residual risk this
> entry should watch is the *inverse* direction it has not previously named: a
> **prompt** that grows a field the **comparator** doesn't cover. That is why the
> structural scan here asserts `buildPrompt` reads no `u.<field>` outside the
> facts object."

### WATCH rows carried into the build (tracked, not prose)

| Id | Risk | Trigger to promote |
|---|---|---|
| **WATCH-A** | `stale_regenerated` is an overlap counter, not a partition term (G7) — the next test author may "fix" the four-term identity into a wrong five-term one | any proposed change to the partition identity |
| **WATCH-B** | One-time regeneration burst across legacy mutable rows on first check | real size exceeds one batch per project, or a sweep visibly stalls |
| **WATCH-C** | Stale-client route regeneration from old inputs; converges via the next tick (extends WATCH-7's blessed race) | observed text flip-flop, or anomalous duplicate-generation counts — now visible in the log thanks to DEC-4 |
| **WATCH-D** | `buildPrompt`'s whole-prompt `.slice(0, 12_000)` truncates the **reply-format instruction first** (it is in the tail) — the uncatalogued SHARED-BUDGET-STARVATION shape, pre-existing and unchanged by this slice, but this slice increases traffic through it | a parse failure in the generation log, or any unbounded field entering the prompt |
| **WATCH-E** | The client hand-types the state registry in three places (`PlanLedgerPanel.tsx:558`, the `Altitude` union at 321, `api.ts`'s `Record<…>`) — §9.7's accepted CJS/Vite exception | any growth of `ALTITUDE_STATES` (this slice adds none, by DEC-3) |

---

## 7. Recommendation to the human

**Approve and build Slice 1 as scoped, on a fresh worktree from `55fe900`.**

- **What you're approving:** input-snapshot gating for
  `intake_initiative`/`detour`/**`merge_commit`** units; stale = a normal cache
  miss for that one unit on both the view path and the sweep; `trunk_commit`
  unchanged; an "updated — stage changed" marker until you acknowledge it,
  with "seen" stored server-side; the invalidation reason on the unit row and a
  count in the run log; the false schema comment rewritten.
- **Cost framing:** the gating, regeneration, doc corrections and their tests
  are **our cost** — a missed requirement we shipped two days ago. The
  seen-state round-trip is **new scope you already approved**, and is the first
  thing to cut if the slice runs long. Request-path logging is **debt coming
  due**, pre-priced by DEC-14. Overall size **M**, with the test/guard work the
  largest single chunk — as this project's history predicts.
- **Runtime cost is negligible** and should not enter the decision: ~$0.001 per
  unit, one-time, and a one-off legacy burst bounded to mutable units only
  (~20¢ at the known 182-unit pool scale).
- **The durable fix that stops recurrence** — and the one thing not to trade
  away under schedule pressure: **`buildPrompt` consumes `unitFacts()` and never
  the raw unit**, so the prompt's inputs and the compared inputs are the same
  object and a future prompt field cannot silently escape invalidation; plus the
  structural scan that fails if `buildPrompt` reads a unit field outside that
  object, red-proven per §9.3. Everything else in this slice fixes today's stale
  sentence; that one line of design is what stops the third instance.
- **The process fix that matters as much:** §5's branch-cut procedure. Two of
  the last three efforts on this surface hit environment trouble (991
  uncommitted lines; today's 44 dirty paths, three of them files this slice
  edits). Treat it as a gate.
- **Testing discipline, non-negotiable:** the prior effort on this exact surface
  produced **eight** §9.3-family events, including a vacuous *repair* of a
  vacuous guard. Every guard red-proven against a real mutation, every red
  recorded per-test (not a blanket sentence), **no DoD row ticked on an agent's
  self-report**, and plan for multiple independent verification passes — every
  pass in that build found something the previous pass had mis-claimed.

**Recommended sequence** (engineer's, adopted): db.js (columns + PRAGMA-guarded
ALTERs + `UPGRADE_CASES` in the same commit) → `value-summary.js` (`unitFacts`,
comparator, gated `readCached`, extended return shape) → tick (count + log
param) → route (seen endpoint + request logging + deliberate guard widening) →
client (types → api → panel → i18n ×4 → reviewed snapshot regeneration) → docs.
Guards written *with* each layer, never batched at the end.

---

## 8. Open decisions for the user

All non-blocking. The build proceeds on the recommendations above unless Sara
says otherwise.

1. **`merge_commit` inclusion (DEC-6)** — this is the one place the team
   deliberately deviates from your written scope line, because that line's
   stated reason ("content-addressed") is false about the *prompt inputs*.
   Cost is one string; reversal is one string. **Say the word and it becomes a
   WATCH row instead.**
2. **Acknowledgement gesture (DEC-8)** — markers clear on an explicit click
   (per-unit "×" plus "dismiss all"), not automatically when the panel renders.
   Cheaper is auto-on-render; the team judged that it would let a second device
   consume markers you never read.
3. **Marker copy** — "updated — stage changed" / "updated — label changed" are
   taken as your approved wording. Any change is a content change and gets
   reflected back into `request.md`, not just shipped in the component.
4. **OPEN-2 (carried, still PENDING you)** — validation project choice for the
   parent effort. Does **not** block this slice (the walkthrough is fixed on the
   Resume example), but should not silently close.
5. **OPEN-4 (carried)** — you were asked to set `MAX_PROJECTS_PER_TICK=8` in
   your real `.env` (measured worst case is ~4h10m at the shipped default vs
   ~1h40m tuned). Still unanswered, and it directly sets how long the one-time
   regeneration burst takes to drain. Worth answering before this ships.

---

## 9. Definition of Done additions owned by this plan

- [ ] Effort branch cut per §5 from `55fe900`+ in a fresh worktree; main
      checkout's 44 dirty paths untouched; live DB backed up before first boot.
- [ ] `decisions.md` exists on the effort branch with DEC-1..DEC-10 and
      WATCH-A..WATCH-E transcribed, **before the first line of build code**
      (the parent effort's cycle-breaker, retained).
- [ ] `buildPrompt` consumes `unitFacts()` only; structural scan proves no
      `u.<field>` read outside it, red-proven by injecting one.
- [ ] The two `PROJECT-CONTEXT.md` catalog notes from DEC-10 applied **on the
      effort branch** (§9.8 invariant corollary; §9.1 inapplicability note),
      both explicitly marked count-unchanged.
- [ ] `db.js` schema comment and `value-summary.js`'s file-header
      "generated once, served forever" paragraph both rewritten in the same diff
      (PO AC-7); `update-project-docs` run for `docs/API.md`,
      `docs/DATABASE.md`, `server/README.md`, `ARCHITECTURE.md`.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
