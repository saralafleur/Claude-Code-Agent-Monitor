# Risk & Regression Analysis — 2026-08-04-altitude-invalidation (Value Pool Slice 1)

> Authored by `qa-risk-analyst`, 2026-08-04. Substrate: `origin/master` @ `55fe900`,
> read via `git show` (local checkout is behind + dirty; never used). The change is
> **planned, not built** — every risk below grades the plan's intended shape and
> names the assertion the build must ship. Trap ids are stable (`T-A`…`T-K`) per the
> sibling run's QA-DEC-4 convention: **every id must end reconciled in the coverage
> table — a named spec file + case id, or a dated `decisions.md` WATCH/OPEN/PENDING
> row. No id may end as prose only.**

Substrate facts verified directly for this analysis (beyond the change-brief's own
spot-checks):

- `server/db.js:134-136` — `journal_mode = WAL`, `busy_timeout = 5000`. Migrations
  run at `require()` time against the shared user-global DB.
- `server/routes/project-plans.js` `POST /altitudes` — the composer is called with
  the **sanitized** `clean` array; units the sanitization loop rejects are put in a
  **route-level** `states` map (`"unavailable"`) that the composer never sees, and a
  key-less unit is dropped entirely (documented S3 scoping). Load-bearing for T-F.
- `server/__tests__/single-writer-guard.test.js` — the existing call-site scanner
  strips `//` comments only; the two *file-set* scans (`/upsertValueUnitSummary/`,
  `/insertValueSummaryGeneration/`) match **any mention, including comments**, in
  any non-test file under `server/`. Load-bearing for T-B and the blast radius.
- `client/src/components/PlanLedgerPanel.tsx` `AltitudeText` — any unrecognized
  *string* altitude renders the "unavailable" copy; a resolved **object** renders
  `altitude[field]`. Load-bearing for T-C. (Naming note: the component the plan
  calls `PoolUnitRow` is `ValueUnitRow` in source — cosmetic, but the build's
  anchors should use the real name.)

---

## 1. Blast radius

Beyond the ~21 files in the plan's change set:

1. **Every process that `require`s `server/db.js`** — Express server, MCP server,
   desktop (Electron), VS Code extension, and every server spec file. Migrations
   run at require time against `~/.claude/agent-dashboard/dashboard.db` (shared,
   user-global, currently held open by a ~19h dev server in WAL mode). A migration
   defect here does not stay in the worktree; it reaches the live dashboard the
   first time anything in the worktree boots without `DASHBOARD_DB_PATH`. This is
   also the stated **promotion trigger for the TEST-AGAINST-LIVE-DB candidate**
   (§9.3 candidate, 2026-08-03) — if the build declines to promote, that decline
   needs its own `decisions.md` row (the plan already binds this; hold it to it).
2. **`single-writer-guard.test.js` as shared guard infrastructure.** After this
   slice it hosts *two different comment-stripping regimes* (existing scanner:
   `//` only; new A2/DEC-15 scan: `//` **and** `/** */`) and two *opposite*
   expected behaviors on widening (`upsertValueUnitSummary.run(` must stay at 1;
   `insertValueSummaryGeneration`'s file set must go red and be widened). Every
   future guard author copies from this file; copying the wrong scanner or the
   wrong widening posture is a live §9.7 hazard. Also: because the file-set scans
   match mentions in comments, the planned **header rewrites** of `db.js` and
   `value-summary.js` (PO AC-7) can flip a guard by prose alone — a rewritten
   `value-summary.js` header that mentions `insertValueSummaryGeneration` adds
   that file to the file-set scan's expected list. Write invariants *about* a
   lexical scan without repeating its match text (§9.3, 2026-08-04 lesson).
3. **The composer's return shape `{altitudes, states, counts}`** — consumed by the
   route (wire + log), the tick (log), and transitively the client. `counts` is
   server-internal (not on the wire), so a counts bug is invisible to every client
   test and every snapshot: only L1–L3 and the new route-seam log assertion can
   see it.
4. **Registries that must move in lockstep:** `MUTABLE_VALUE_SOURCES`
   (value-ledger, one home), `ALTITUDE_FRESHNESS` (value-summary export → 4th
   hand-copied client registry: `Altitude` union arm, `api.ts` response type,
   i18n key set — WATCH-F), the six i18n keys × 4 locales (E1.1 derives from
   `en`), and `assertSingleHome`'s `absent` lists (two new exports).
5. **The serialization boundary contract** `regen_reason → i18n key`: the server
   chooses the reason string; the client maps it to `updatedStageChanged` /
   `updatedLabelChanged`. This is a token that must match on both sides, with no
   mechanical parity check across the CJS/Vite boundary — the reason vocabulary
   is now a fifth hand-synced pair (see T-C leg 3).
6. **Docs + contract artifacts:** `docs/API.md`, `docs/DATABASE.md`,
   `server/README.md`, `ARCHITECTURE.md` are planned. **`openapi.yaml` /
   `server/openapi-extra/` are not in the plan's docs table** — see T-I.
7. **What is deliberately NOT in the blast radius and must be proven untouched:**
   the tick scheduler / overlap guard / `pending_after_sweep` (prior effort
   WATCH-8, B2), `ALTITUDE_STATES` and its three client hand-copies (DEC-3,
   WATCH-E), `assembleValuePool`, and `chronology-ordering.test.js` (PRAGMA idiom
   adds no `SELECT … LIMIT` literal — verify, don't assume; plan already says so).

---

## 2. Invariants that must hold (catalog-mapped)

- **INV-1 (§9.1 DERIVED-DUAL-VIEW, 6 touches on record — the #1 class):**
  `unitFacts()` is the *sole* reader of unit fields for synthesis; the prompt's
  input set ≡ the stored snapshot ≡ the compared set, by construction. The reason
  is computed once at read and carried to the write; `counts` computed once by the
  composer for both loggers. The twice-proven corollary: *a rogue-reader scan does
  not catch a rogue re-derivation* — the A2 scan must be able to fail on a second
  computation, not only a second read (see T-B).
- **INV-2 (§9.8 OVERLOADED-ABSENCE — this surface IS live instance #1):** every
  submitted unit lands in exactly one wire bucket and exactly one log bucket, **at
  every seam that can add or drop an item** (composer, route sanitization, log
  write, client merge) — the 2026-08-04 build-phase note says verbatim that both
  prior violations landed at the seams the composer-level partition test cannot
  see. Every new distinguishable outcome is named (`ALTITUDE_FRESHNESS` × 3;
  `input_label IS NULL` = legacy, exactly one meaning; `stale_regenerated IS
  NULL` = predates measurement ≠ 0; `regenerated_at` = marker discriminator).
- **INV-3 (DEC-11, by design):** the log partition counts *work*, the wire
  partition counts *renderability*, and for a stale-served unit they **disagree
  on purpose**. Asserting their agreement is asserting a bug (see T-A).
- **INV-4 (WATCH-A):** `cache_hits + generated + queued + unavailable ===
  pool_size`, exactly four terms, unconditional; `stale_regenerated` is an
  overlap counter bounded by the misses it explains, never a fifth term.
- **INV-5 (§9.5 / §9.6-adjacent):** an *existing* DB gains all six columns —
  atomically or convergently, never partially — and a legacy row reads NULL (M2:
  NULL, not 0). The migration must be **unable to throw out of `require()`**
  (§9.6's B3 lesson: the caller is every process at once). See T-E.
- **INV-6 (round-trip):** `seen_at` survives acknowledge → reload; it is reset to
  NULL **only** inside the one writer's `DO UPDATE SET` (G3); and a stamp must
  never land on a generation the user hasn't seen (see T-D).
- **INV-7 (isolation / old-client variant):** an un-upgraded tab never blanks
  text it was displaying — R3: a unit with a cached row is ALWAYS in `altitudes`;
  `ALTITUDE_STATES` gains nothing. And symmetric for the **new** client: no
  freshness value, present or future, may route a resolved entry into a string
  state (see T-C).
- **INV-8 (no-leak at the boundary):** marker copy comes from i18n keys chosen by
  `regen_reason`; an out-of-registry reason must degrade to a generic marker, not
  a raw i18next key string leaking to the user (see T-C leg 3).
- **INV-9 (§9.3 standing rule + AGENT-SELF-REPORTED-RED + VACUOUS-REPAIR):**
  every guard observed red against a real mutation of the thing it names, red
  recorded per test, no DoD tick on self-report, repairs get fresh red proofs.
  This exact surface produced EIGHT §9.3-family events last effort. The only
  technique that reliably worked: revert the product change and run the actual
  shipped spec file.
- **INV-10 (steady state — anti-oscillation):** after any regeneration, the next
  read of the same unchanged unit is a snapshot-valid cache hit (`generated = 0`
  on the following tick). This is the invariant that catches *both* DEC-7
  normalization drift and T-G's fake-legacy rows, and no planned test currently
  asserts it post-regeneration (L3 stops at tick 2).

---

## 3. Recurring-issue mapping

| Catalog entry | Status vs this change |
|---|---|
| §9.1 DERIVED-DUAL-VIEW (6 touches) | **Centrally engaged.** Plan's posture (make it inapplicable) is right; the residual risk is the A2 scan's own scope (T-B) and the route-seam count re-derivation (T-F). |
| §9.3 VACUOUS-GUARD + sub-patterns | **OPEN, highest density ever on this exact surface (8 events).** Every red proof in this plan is a claim to verify, not a fact. The A2 mutation set (T-B) is where a vacuous guard would cost the most — it is the plan's one never-traded-away item. |
| §9.5 FRESH-DB-BLIND | Cure planned correctly (PRAGMA + M1/M2). Residual: partial-failure convergence (T-E), which §9.5's clean-run idempotence test cannot see. |
| §9.6 NON-ATOMIC REBUILD | **No rebuild here, but the failure physics apply**: a 5-statement `db.exec` ALTER block with a single-column probe is a half-run migration that either bricks boot or looks finished (T-E). §9.6's B3 note ("must be unable to throw — the caller is `require()`") applies verbatim. |
| §9.7 HAND-SCOPED STRUCTURAL SCAN (6x) | Engaged twice: the A2 scan's identifier set is hand-typed (`u`/`unit` — derive from the signature instead, T-B), and WATCH-E/F's four client hand-copies are the accepted, tracked exception. |
| §9.8 OVERLOADED-ABSENCE | **This change is the entry's own cure landing on instance #1.** The entry's build-phase note predicts the violations land at the route and table seams — T-F is exactly that prediction for the new log write. NULL-meaning matrix in §5 below. |
| §9.2 / chronology | Should stay quiet by construction (PRAGMA idiom). Verify, don't assume (plan already binds this). |
| §9.4 FIX-ROUND-REGRESSION | Applies to this build's inevitable fix round: any repair to the partition/counts arithmetic must name the *other* seam (route vs tick) and re-prove both. |
| TEST-AGAINST-LIVE-DB (candidate) | **This slice is the stated promotion trigger.** Decline requires a decisions row (plan §7 binds it; DoD must show it). |
| CONTRACT-SPEC-DRIFT (candidate) | **Engaged and currently unhandled** — new endpoint, no OpenAPI work in the plan (T-I). |
| WATCH-C (this effort) / prior WATCH-7 | Convergence race — disposition assessed in T-H. |

---

## 4. "Ships green but broken" traps

### T-A — A well-meaning test author "fixes" the DEC-11 log/wire disagreement
**The trap:** for a stale-served unit the wire says "renderable" (`altitudes`, old
text, `freshness`) and the log says "miss" (`queued`/`unavailable`/`generated`,
never `cache_hits`). Both one-line "fixes" regress the design: counting
stale-served as `cache_hits` overshoots `pool_size` (L1); dropping stale units
from `altitudes` blanks an old client's visible text (R3). The planned guards
live in **different spec files** (L1 in `value-summary-tick.test.js`, R3/Case 5
in `value-summary.test.js`) — a fixer who runs only the file they touched sees
green.
**Required test SHAPE (the ask in one sentence):** one composer-level case, in one
`it()`, one fixture containing at least one stale-served unit (stale × over-cap
is the deterministic way to force "served but not refreshed"), calling
`enrichPoolAltitudes` **once** and asserting **both partitions against the same
`unit_key` from the same return value**: (a) present in `altitudes` with its old
text and `freshness = "stale_refresh_queued"`, absent from `states`; (b)
`counts.queued` includes it and `counts.cache_hits` equals the exact fresh-hit
count (excluding it); (c) the four-term sum === `pool_size`. Title and comment
must cite DEC-11 and say the disagreement is BY DESIGN — the test's name is the
message to the future fixer. Because the composer returns both partitions from
one call, a "fix" in *either* direction turns exactly this one test red.
**Red proofs:** count stale-served into `cache_hits` → leg (c) red; re-home the
stale unit into `states` → leg (a) red.

### T-B — The A2/DEC-15 structural scan is evadable (or vacuous) — and the plan disagrees with itself about its strength
**The discrepancy first:** DEC-15's *title* says "permits exactly one mention of
the unit: `unitFacts(u)`"; its *body* (and plan §4 Step 5, §6 A2) specifies the
weaker "no `u.<field>` / `unit.<field>` property access". A faithful implementer
builds the body's weak form. The weak form is evadable by every construction
below; the title's strong form kills all but two. **Build the strong form:
extract `buildPrompt`'s body, strip both comment styles, and assert the
parameter identifier occurs exactly once, as the argument of `unitFacts(...)`.**
**Evasion classes (how loose before vacuous), each needing a mutation:**
| # | Evasion | Caught by weak form? | By strong form? |
|---|---|---|---|
| 1 | `u.value_ref` at the **end** of the body (proves full-body extraction, not truncated brace-matching) | yes | yes |
| 2 | `` `${u.stage}` `` inside a template literal | yes — *unless* the scanner strips string/template literals; it must NOT | yes |
| 3 | `u["stage"]` bracket access | **no** | yes |
| 4 | `const { stage } = u` destructuring | **no** | yes |
| 5 | `const w = u; w.stage` aliasing | **no** | yes |
| 6 | `const facts2 = { ...u }` spread-copy (then `facts2.stage` — and note the `facts.` sentinel is satisfied!) | **no** | yes |
| 7 | Rename the parameter (`unit` → `entry`); every read invisible | **no** (hand-typed `u`/`unit` = §9.7) | only if the identifier is **derived from the function signature**, never hand-typed |
| 8 | Helper one frame away: `formatUnit(u)` defined elsewhere in the file, reading `u.stage` in its own body | **no** — outside the lexical body | **no** — same |
**Dispositions:** #1–#7 → mutation set, each observed red (a scan that passes all
seven mutations green is vacuous for that class — record which classes it
covers). #8 is structurally out of reach for a lexical body scan; its backstops
are the comparator-single-home scan (guard #4), the DEC-7 parity test, and
INV-10's steady-state assertion — **write that disposition down in the scan's own
comment**, or #8 becomes §9.1's "one call frame away" recurrence with a green
tick over it. Vacuity floor: scope-non-empty + `facts.` sentinel (planned) is
necessary but not sufficient — mutation #1 (end-of-body) is what proves the
extraction covers the whole body.

### T-C — The NEW client blanks or corrupts stale-served text (the §9.8 failure this slice's parent exists to prevent, one layer up)
Old clients are safe by design (R3 + no new `ALTITUDE_STATES` values). The new
client adds freshness handling, and three specific bugs ship green:
1. **Freshness routed through the state path.** The tempting implementation of
   the `staleRefreshQueued` badge is to reuse the existing queued/unavailable
   copy by mapping `freshness: "stale_refresh_unavailable"` → altitude string
   `"unavailable"` before render — `AltitudeText` then replaces the old text
   with the unavailable placeholder. Verified: any string altitude renders the
   placeholder copy. **Assertion:** for **each** member of `ALTITUDE_FRESHNESS`
   (derive the loop from the registry, not three hand-typed cases — §9.7), the
   entry's old `project`/`stakeholder` text renders **verbatim** with the badge
   alongside, in the same render as a `queued` and an `unavailable` unit (the
   combined-render shape §9.8 mandates; plan C1 covers `updated_unseen` only —
   widen it to all three).
2. **Unknown-freshness forward compat.** Slice 2+ will grow `ALTITUDE_FRESHNESS`;
   today's client is then the "old client". An entry with
   `freshness: "some_future_value"` must render its text plain (badge dropped or
   generic), never crash, never fall to the unavailable path. This is the exact
   mistake `AltitudeText`'s unknown-string fallback already institutionalizes one
   type over. **Assertion:** out-of-registry freshness → text renders, no
   placeholder; mirrors C3/T-E's warn-path honesty.
3. **Unknown `update_reason` → raw i18n key leak.** The marker key is chosen from
   `update_reason` (`stage_changed` → `updatedStageChanged`). `regen_reason` has
   deliberately **no CHECK** ("future reasons stay additive") — so a future
   server sends a reason today's client has no key for, and naive
   `t(mapReason(reason))` renders the literal key string
   (`planLedger.pool.altitudes.updatedSomethingChanged`) to the user — an
   unresolved boundary token at the UI. **Assertion:** unknown reason → generic
   "updated" copy, never the raw key.

### T-D — Acknowledge round-trip race: the blind stamp marks the NEW generation as seen
The planned statement is an **unconditional** `UPDATE … SET seen_at = now WHERE
unit_key = ?` (plan Step 2.5 — chosen for idempotence). Interleaving: user views
generation G1's marker → tick regenerates the unit to G2 (the one writer's
`DO UPDATE SET` correctly resets `seen_at = NULL`, stamps `regenerated_at = t2`)
→ the user's in-flight `/seen` POST lands → blind stamp sets `seen_at` → **G2's
"updated" marker is never shown**, which is a silent failure of the slice's
headline promise ("always tell the user when something they saw has changed").
Same-process interleaving is real (route handles requests between the tick's
async LLM awaits). D6 cannot see it — it tests acknowledge and regenerate in
separate steps, not the inversion.
**Cheap compare-and-set:** the client already has `regenerated_at` on the entry
it is dismissing; send it, and predicate the stamp:
`… WHERE unit_key = ? AND regenerated_at IS ?` (better-sqlite3 `IS ?` handles the
NULL leg) — still idempotent, and a stamp aimed at G1 misses G2, leaving the
marker up. `{updated: n}` then honestly reports the miss.
**Assertion (deterministic, no timing):** seed row at G1 → run the upsert
(simulating regeneration to G2) → run `markValueUnitSummariesSeen` with G1's
`regenerated_at` → assert `seen_at IS NULL` still, marker condition still true.
**If the build keeps the blind stamp instead:** that is a knowing gap in INV-6
and needs a dated `decisions.md` PENDING/WATCH row — not a comment.
*(Minor sibling, T-K below: the same statement ignores `project_id` entirely.)*

### T-E — The 5-column ALTER block is not "all-or-nothing": partial failure either bricks every boot or half-migrates silently
Plan Step 2.4: one `db.exec` of five ALTERs, guarded by a probe on `input_label`
— with `input_stage` added **first** and no transaction. `db.exec` on a
multi-statement string is sequential, not atomic. Against the live shared DB
(dev server holding it, WAL, `busy_timeout=5000` softening but not eliminating
`SQLITE_BUSY`; plus the §9.6-catalogued crash/OOM/Ctrl-C-on-slow-first-boot
cases), a death between statement 1 and 2 leaves `input_stage` present,
`input_label` absent. Next `require()`: probe says "missing" → block re-runs →
`ALTER TABLE … ADD COLUMN input_stage` throws `duplicate column name` **out of
`require()`** → Express, MCP, desktop and the VS Code extension all brick on
boot against the one shared DB (§9.6's B3 blast radius, reached without any
rebuild). Reordering `input_label` first only swaps the failure: probe then says
"present" → block skipped forever → four columns silently missing = §9.6's
"half-run migration that looks finished", and the first
`upsertValueUnitSummary.run()` throws inside the tick instead.
**Required shape (either):** (a) wrap the five ALTERs in one `BEGIN;…COMMIT;`
(SQLite supports ADD COLUMN in a transaction) so the probe's all-or-nothing
claim becomes true, **and** catch-log-continue so `require()` cannot throw
(§9.6 B3); or (b) probe **per column** so any partial state converges. 
**Assertion (the §9.5 suite cannot see this — M1's clean-run idempotence passes
either way):** an interruption `UPGRADE_CASES` leg — seed a legacy table **plus
`input_stage` only** (the mid-crash state), `require` db.js, assert: no throw,
all five columns present after, second run no-op. That one fixture kills both
failure orderings.

### T-F — The request-path log row violates the four-term identity the moment sanitization drops a unit (verified against live route code)
DEC-4/plan Step 9.2: log `pool_size = units.length` (**submitted**) with "the
four terms from `counts`". But the composer is called with `clean` — the
sanitized subset. Any request containing a unit the loop rejects (bad
`value_source` → route-level `states`; missing `unit_key` → dropped) yields
`counts` summing to `clean.length < units.length` → **the very first log row
from a real old-client or malformed request breaks INV-4**, and §9.3's history
says a guard that goes red for a legitimate reason on day one gets *weakened*
(that was literally event #1 of the prior effort, on this same identity). This
is also §9.8's build-phase prophecy verbatim: "the two failures landed at the
route and the table — the seams the composer's partition test cannot see."
**Required decision + assertion:** pick one — (a) route adds its own dropped
count into the `unavailable` term before logging (mirrors the S3 wire fix:
route-dropped = attempted-and-unusable), or (b) log `pool_size = clean.length`
and abandon "submitted batch size" (weaker: the log then can't see malformed
traffic). Either way, the **route-seam log partition test**: POST N good + 1
bogus-`value_source` + 1 key-less unit → exactly one log row, four-term sum ===
logged `pool_size`, and the wire still buckets every keyed unit exactly once.
Red proof: feed `counts` through unadjusted with submitted `pool_size` → red.

### T-G — A post-slice writer that stores NULL `input_label` creates a fake-legacy row → that unit regenerates every tick, forever, silently
`input_label IS NULL` = legacy is guaranteed only by `unitFacts()`'s
`"(untitled)"` fallback **and** every write path actually storing
`facts.label`. Two one-line mistakes recreate NULL on a *new* row: storing the
raw `u.label` column instead of the resolved fact (the plan's own named
anti-pattern), or a param plumbing slip in the widened upsert. A NULL-label row
is stale on every read → regenerates → writes NULL again → **infinite
regeneration loop, one unit per tick, silent LLM spend** — the severity class of
DEC-7's oscillation, reachable without any route/tick divergence. The legacy
NULL meaning ("regenerate once") is shadowed by the bug NULL meaning
("regenerate forever"), and nothing planned distinguishes them: D3 asserts "row
carries new snapshot" (make the `input_label IS NOT NULL` / `regen_reason IS NOT
NULL` legs explicit), but no test runs the tick **past** the regeneration.
**Assertion (INV-10, the loop detector):** extend L3 with tick 3 — after tick
2's single regeneration, tick 3 on unchanged inputs must log
`cache_hits = pool_size, generated = 0, stale_regenerated = 0`. This one cheap
case catches T-G, residual DEC-7 drift, and any comparator asymmetry, at the
seam where they all present identically (a unit that never comes to rest).

### T-H — WATCH-C convergence race: the WATCH disposition is adequate ONLY for the timing half; the convergence property itself is deterministic and cheap to pin
The racy half (a stale tab's POST interleaving with a tick) is genuinely
untestable-cheaply and DEC-4 makes it observable in the log — WATCH-C is the
right disposition for *that*. But WATCH-C's own description asserts a
deterministic property nothing tests: "the next tick's fresh `assembleValuePool`
re-invalidates and **converges**." That is checkable without any race: seed a
cached row with snapshot B → POST `/altitudes` with stage A (the stale tab,
deterministically) → assert regeneration stamped A (+ request-source log row) →
run the tick with pool stage B → assert regeneration stamped B, marker present,
**and (INV-10) tick 2 quiesces at `generated = 0`**. If the comparator or
normalization is asymmetric, this is where it diverges instead of converging —
and today the suite would be green while two paths ping-pong spend forever.
**Disposition:** the two-step convergence case should be added (it doubles as
the only route→tick integration test of the whole staleness machinery); if the
build declines it, WATCH-C's row must be **amended** to say the convergence
claim is unverified, not just the race unobserved.

### T-I — `POST /api/project-plans/altitudes/seen` ships with no OpenAPI entry and the contract suite stays green (CONTRACT-SPEC-DRIFT, trigger (a) territory)
The plan's docs table names four markdown docs; `server/openapi-extra/` and
`npm run openapi:yaml` appear nowhere. The 2026-08-03 `openapi-contract.test.js`
is **mount-level** — `/api/project-plans` is already mounted and documented, so
a new route *under* an existing mount trips nothing. Result: the artifact the
repo declares "the source of truth for request/response contracts" silently
omits the new endpoint (and the widened altitudes-response `freshness` fields),
which is the exact drift shape the candidate entry records — one hand-maintained
canonical artifact, no scan, green suite. **Required:** an `openapi-extra`
fragment for `/altitudes/seen` (+ the widened altitude entry schema), namespaced
operationId per the 2026-08-03 collision lesson, `npm run openapi:yaml` in the
docs step, byte-round-trip test green. **If declined:** dated `decisions.md`
row; and note this would be a second live drift instance — the candidate's own
promotion trigger.

### T-J — First-upgrade marker flood (severity: cosmetic, but user-visible on day one)
DEC-9's legacy burst regenerates every legacy mutable row (~182-unit pool scale,
OPEN-3 sets drain time at ~1h40m–4h10m). Each regeneration passes through the
one writer's `DO UPDATE SET regenerated_at = now, seen_at = NULL` — so after the
burst, **every legacy mutable unit carries an "updated" marker**, with
`regen_reason` = `label_changed`/`stage_changed` chosen by a comparison against
a NULL legacy snapshot (the reason string is technically true and semantically
noise). Sara's first post-upgrade panel view is a wall of "updated — label
changed" markers for texts that mostly did not meaningfully change. "Dismiss
all" (planned) is the mitigation and is probably sufficient — but this is a
knowing UX consequence of DEC-9 + D6's marker condition and should be **stated
in a decisions row or in OPEN-4's copy discussion**, not discovered by the user.
(Alternative if Sara objects: suppress the marker when the *previous* snapshot
was legacy-NULL, i.e. `regenerated_at` set but reason derived from a NULL row —
one predicate, but it weakens D5/D6's symmetry; needs its own ruling either way.)

### T-K — `/seen` ignores `project_id` at the statement layer (minor)
The endpoint takes `{project_id, unit_keys[]}` but the planned statement filters
on `unit_key` alone. `unit_key` embeds cwd, so accidental cross-project
collision is unlikely, but the API shape implies a scoping the SQL does not
enforce (a client can stamp another project's keys). Local-first, low severity.
Either add `AND unit_key LIKE '%::' || ?`-style scoping / validate keys belong
to the project, or document that `project_id` is advisory. One-line disposition;
fold into T-D's endpoint tests.

---

## 5. The NULL-meaning matrix (DEC-12 verification — brief item 7)

| Column | NULL means | Guaranteed by | Shadowing risk |
|---|---|---|---|
| `input_label` | **exactly one thing: legacy pre-slice row** | `unitFacts()`'s `"(untitled)"` fallback + every writer storing `facts.label` | **T-G**: a post-slice writer storing raw `label` or dropping the param recreates NULL → "legacy, regenerate once" shadowed by "bug, regenerate forever". Pin with the post-write NOT-NULL legs + INV-10 steady state. |
| `input_stage` | three things, deliberately: legacy row; `detour` (no stage key, `value-ledger.js:257-266`); a mutable unit whose stage is genuinely null | comparator treats `NULL === null` as match; legacy rows are still caught by `input_label` | Safe **only** while `input_label` stays a reliable discriminator — i.e. T-G is also the guard for this column. A legacy `detour` row (both NULL) falls stale via the label leg with reason `label_changed` — correct behavior, mildly misleading reason (see T-J). |
| `regen_reason` | legacy only (stamped `'initial'` on every first write) | the upsert stamping it on **every** write, both INSERT and DO UPDATE arms | a write path that stamps it only on regeneration silently recreates the legacy meaning on fresh rows; add the NOT-NULL leg to D1/D3 fixtures' write assertions. |
| `regenerated_at` | "first generation" (marker discriminator: marker ⇔ `regenerated_at IS NOT NULL AND seen_at IS NULL`) | INSERT arm leaves NULL, DO UPDATE arm sets it — correct **by construction** only because the composer writes exclusively on miss (no-row → INSERT, stale-row → conflict). If any future caller upserts a *fresh* row, `regenerated_at` gets stamped without a text change → phantom marker. The single-writer guard is what keeps this construction true — say so in its comment. |
| `seen_at` | "not seen" (never marked, or reset by regeneration) | reset lives inside the one writer (G3) | two meanings but harmless: the marker condition ANDs with `regenerated_at`. A blind-stamped `seen_at` on a never-regenerated row is inert. The real hazard is T-D's race, not the NULL. |
| `stale_regenerated` (log) | predates measurement (≠ measured 0) | nullable, **no DEFAULT** (DEC-3); M2 pins NULL-not-0 | a later "helpful" `DEFAULT 0` backfill or `COALESCE(…,0)` in a reader silently converts "unknown" to "measured zero" — M2 is the tripwire; keep it. |

---

## 6. Severity & priority

| Rank | Trap | Severity | Why |
|---|---|---|---|
| 1 | **T-E** | Critical | Bricks boot for every process on the shared live DB, or half-migrates silently (§9.6 physics); the planned suite is structurally blind to it (clean-run idempotence passes both failure orderings). |
| 2 | **T-F** | High | Concrete arithmetic bug in the plan as written, verified against route code; first malformed/old-client request breaks INV-4, and this identity's history says the guard gets weakened, not fixed. |
| 3 | **T-B** | High (meta) | The plan's single never-traded-away cure ships in a weak form its own DEC title contradicts; on the surface with 8 recorded §9.3 events, an evadable A2 scan is a green tick over the disease this slice exists to cure. |
| 4 | **T-A** | High | Both regressions are one line; one blanks old clients' visible text (user-facing), the other corrupts the audit identity; guards currently live in different files. |
| 5 | **T-C** | Medium-high | User-visible text blanking / raw-key leak in the **new** client; legs 2–3 are forward-compat debts that bite in slice 2 with today's client as the "old" one. |
| 6 | **T-G** | Medium | Silent unbounded LLM spend, invisible to every planned test; one cheap tick-3 case closes it plus two other risk classes. |
| 7 | **T-D** | Medium | Rare interleaving, but it silently falsifies the slice's headline promise; the CAS fix is one predicate. |
| 8 | **T-H** | Medium-low | Bounded waste, already WATCH-C; the deterministic convergence half deserves its cheap test or an amended row. |
| 9 | **T-I** | Low-medium | Contract drift, no user-facing breakage today; second live instance would promote the candidate. |
| 10 | **T-J / T-K** | Low | Cosmetic / hygiene; each needs a one-line disposition, not a build change. |

---

## 7. Disclosed-and-declined trip-wire (per this analysis; reconcile in the coverage table)

Every id above must end as either a named spec file + case id or a dated
`decisions.md` row. The ones structurally likely to be declined this round, and
what each decline requires:

- **T-D** (blind stamp kept) → PENDING/WATCH row naming the un-shown-marker race.
- **T-H** (convergence test skipped) → amend WATCH-C: "converges" is asserted,
  not verified.
- **T-I** (OpenAPI skipped) → decisions row + note it arms CONTRACT-SPEC-DRIFT's
  promotion trigger.
- **T-J** (marker flood accepted) → one sentence in OPEN-4 or its own row.
- **T-B #8** (helper-frame reads out of scan reach) → disposition written in the
  scan's own comment naming the backstops.
- **TEST-AGAINST-LIVE-DB** promotion decline (if taken) → its own row, already
  bound by plan §7 — verify it actually happens; the 2026-08-04 catalog note
  records that this exact "the fallback row also didn't happen" failure has now
  occurred three times on record.
