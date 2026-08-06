# Build Brief — Value Pool altitude cache: mutability-aware caching + invalidation (Slice 1)

**Triage date:** 2026-08-05
**Effort slug:** `2026-08-04-altitude-invalidation`
**Outer skill invocation:** `fast` — **but this is NOT a smoke-level build.** Both
`technical-plan.md` and `test-plan.md` were produced by full `team-intake` +
`team-qa` passes (not a fast/smoke-only pass). Full-strength verification
discipline applies; do not degrade to smoke checks.

---

## What we're building

The Value Pool's `value_unit_summaries` cache currently generates two
plain-language sentences per unit of delivered work and serves them forever,
on the stated (and false) premise that a unit's "ground fact" is immutable
once seen. In reality `buildPrompt` renders `value_source`, `label ||
value_ref`, **and `stage`**, and `stage` moves for `intake_initiative` and
`merge_commit` units — there is a live example on record (the Resume
project's job-pipeline-tracker initiative, cached as "built and being
tested" indefinitely). This slice stores the raw prompt-input snapshot on
each cached row, compares it field-wise on every read for the mutable
sources (`intake_initiative`, `detour`, `merge_commit`), treats a mismatch
as an ordinary cache miss that flows through the existing regeneration
machinery untouched, serves the old text with a named `freshness` value
while a refresh is pending/unavailable (never blanks it), tracks
server-side `seen_at` acknowledgement of a refreshed unit, logs invalidation
counts from both the request path and the background tick, and rewrites the
now-false "generated once, served forever" schema/header comments. A shared
`unitFacts()` extraction is the single source both `buildPrompt` and the new
comparator read from, with a structural guard making it physically
impossible for the prompt's input set and the compared input set to diverge
— this is the plan's stated "never traded away" durable cure.

## Plan sources

- Technical plan: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/technical-plan.md`
- Test plan: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/qa/test-plan.md`
- PM plan (context): `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/pm-plan.md`
- Decisions log (context, DEC-1..DEC-15 + WATCH-A..G + OPEN-1..4): `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/decisions.md`
- QA decision addendum: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/decisions-qa-addendum.md`

Both plans confirmed present, non-empty, and mutually consistent — the
test-plan's amendments (§A, MANDATORY A-1..A-4) sit directly on top of the
technical-plan's change set and both target the identical file surface
(`server/db.js`, `server/lib/value-summary.js`, `server/lib/value-ledger.js`,
`server/lib/value-summary-tick.js`, `server/routes/project-plans.js`, plus
the client altitude-rendering surface). The technical plan has a concrete
Change set (§3) and Implementation steps (§4, 13 steps, explicitly ordered
and non-reorderable for 2→8). The test-plan names specific spec files +
exact assertions (A1/A2/D1–D6/D5b/L1–L3/M1/M2/SEEN-1..7/C1–C3/etc.) with a
red-first discipline stated per case and a repo-wide non-negotiable
verification discipline section. **This is a real, buildable pair.**

## Surfaces touched

- **Schema/data:** `server/db.js` — schema comment rewrite, two additive
  migrations (`value_unit_summaries` +5 nullable columns, guarded via the
  test-plan's MANDATORY `addColumnsIfMissing` helper — supersedes the
  technical-plan's own raw multi-ALTER block, see A-1/A-2 below;
  `value_summary_generation_log` +1 nullable column), two new/widened
  statements.
- **Synthesis composer (§9.1/§9.8-critical):** `server/lib/value-summary.js`
  (`unitFacts`, `compareUnitInputs`, gated `readCached`, widened
  `enrichPoolAltitudes` return shape, `ALTITUDE_FRESHNESS` registry),
  `server/lib/value-ledger.js` (`MUTABLE_VALUE_SOURCES`).
- **Background sweep:** `server/lib/value-summary-tick.js`.
- **Request fast lane:** `server/routes/project-plans.js` (new
  `POST /api/project-plans/altitudes/seen`, request-path generation
  logging).
- **Structural guards:** `server/__tests__/single-writer-guard.test.js`
  (multiple new/widened scans — this is the file every §9.1 obligation on
  this project routes through).
- **Client:** `client/src/lib/types.ts`, `client/src/lib/api.ts`,
  `client/src/components/PlanLedgerPanel.tsx` (component is actually named
  `ValueUnitRow` in source, not `PoolUnitRow` as the technical-plan text
  says — test-plan A-7 flags this), all four i18n locales.
- **Docs/catalog:** `PROJECT-CONTEXT.md` (§9.1/§9.8 notes, effort branch
  only), `docs/API.md`, `docs/DATABASE.md`, `server/README.md`,
  `ARCHITECTURE.md` via the `update-project-docs` skill.

### Project-specific risk surfaces flagged by this project's own defect catalog (`PROJECT-CONTEXT.md` §9)

- **§9.1 DERIVED-DUAL-VIEW** — twice-proven on this project that "a
  rogue-*reader* scan does not catch a rogue *re-derivation*." This plan's
  own `A2` structural scan (single-writer-guard.test.js) is designed
  specifically to close that gap for `buildPrompt`/`unitFacts` — verify at
  build time that it actually ships in its **strong** form (exactly-one-
  mention, not just no-dot-access) per test-plan A-4, not the weaker form
  the technical-plan's own §6 text describes.
- **§9.3 VACUOUS-GUARD / PLAN-LEVEL VACUOUS FIXTURE / AGENT-SELF-REPORTED-RED**
  — the prior effort on this exact file (`value-summary-tick`, 2026-08-04)
  produced **eight** §9.3-family events in one build, the highest recorded
  density in the catalog. This plan explicitly inherits that lesson
  (§"Verification discipline (non-negotiable)" in technical-plan.md, and
  the test-plan's own per-case red-proof table). Standing rule applies: no
  DoD row is ticked on an agent's self-report; every guard must be observed
  red against a real mutation by someone re-running it, not just reading a
  report that says it was red.
- **§9.5 FRESH-DB-BLIND / §9.6 NON-ATOMIC REBUILD** — this slice ships DDL
  against the shared `~/.claude/agent-dashboard/dashboard.db`. The
  technical-plan's original Step 2.4 (raw multi-`ALTER` `db.exec` block) is
  **withdrawn** by the test-plan's MANDATORY amendment A-1: build must use
  the new `addColumnsIfMissing({table, columns})` helper (transactional,
  per-column probe, catches and never throws — `db.js` runs at
  `require()` time against the live shared DB for every process: server,
  MCP, desktop, VS Code extension). A-2 (companion, also MANDATORY) adds two
  scans (`HELPER-CASE-SCAN`, `ALTER-BLOCK-SCAN`) closing the gap where the
  durable-cure helper's own templated-column ALTERs would otherwise be
  invisible to the existing migration meta-test's regex.
- **TEST-AGAINST-LIVE-DB (candidate, 3rd decline recorded)** — every test
  invocation must set `DASHBOARD_DB_PATH` to a temp path, scoped to the
  exact block that `require`s `../db`, not per-file (a per-file `grep` is a
  **proven-invalid** sweep per the catalog's own 2026-08-03 note). The
  test-plan's item #14 requires a **positive** `DASHBOARD_DB_PATH` control
  in every touched/new server spec.

## Durable-cure obligations (MANDATORY — not optional, cite plan/catalog id)

1. **`unitFacts()` single-reader cure (DEC-15 / §9.1).** `buildPrompt` must
   consume `unitFacts(u)` exclusively; the structural scan must ship in the
   **strong** form specified by test-plan A-4 (exactly one mention of the
   per-unit identifier in the map callback, derived from source — not
   hand-typed `u`/`unit`), with all 9 evasion classes red-proven
   individually (M-A2-1..8 plus the array-index class #9 the technical-plan's
   own weaker regex would have missed).
2. **`addColumnsIfMissing` migration helper (test-plan A-1/A-2, MANDATORY,
   supersedes technical-plan.md Step 2.4).** Do not build the raw 5-ALTER
   `db.exec` block described in `technical-plan.md:297-316` — it is
   withdrawn. Build the shared helper, its interruption-leg test (`M1-INT`),
   and both new migration meta-test scans in the same commit set as the
   schema change, or the six new columns ship invisible to the migration
   registry-completeness guard (per the plan's own "the two amendments ship
   together or neither ships" statement).
3. **One computed-once partition (DEC-14 / A-3, MANDATORY).**
   `enrichPoolAltitudes` computes `counts` (the four-term identity plus
   `stale_regenerated`) exactly once; the tick and the route both read it,
   neither re-derives it. The route additionally takes `opts.droppedCount`
   (A-3/DC-2) rather than computing its own partition arithmetic — the
   technical-plan's original Step 9.2 route-logging arithmetic is defective
   as written (it double-counts against `units.length` vs `clean.length`)
   and must not be carried forward verbatim.
4. **`seen_at` compare-and-set, not unconditional (test-plan A-5, MANDATORY).**
   The technical-plan's Step 2.5 unconditional `UPDATE … SET seen_at = ?
   WHERE unit_key = ?` is superseded by the `AND regenerated_at IS ?`
   compare-and-set form — an unconditional stamp can land on a generation
   the user never saw (the exact defect the slice exists to prevent,
   inverted).
5. **§9.1 "belt" scan direction.** The mandatory structural guard direction
   this catalog has never previously named explicitly: a **prompt** field
   added without a matching **comparator** field. `A2`'s scan is what closes
   this, not merely a reader-scope check.

## Worktree set

Single-repo project (confirmed via `PROJECT-CONTEXT.md` §"Repo topology" —
self-contained monorepo, no sibling repos). One worktree provisioned.

| | |
|---|---|
| Path | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor` |
| Branch | `effort/2026-08-04-altitude-invalidation` (**new branch**) |
| Base ref | `master` (current HEAD at provisioning time) |
| Starting commit | `c8eecf374cde7fcc3118f5abeeb4aded49caf600` |
| Worktree status at handoff | clean (`git status --porcelain` empty) |

**Note on the plan's pinned substrate vs. the actual branch point.** The
technical-plan and test-plan both pin their line-number citations against
`origin/master @ 55fe900`. `55fe900` **is** an ancestor of the branch point
(`c8eecf3`) — confirmed via `git merge-base --is-ancestor 55fe900
c8eecf3` → yes — so every file/function/behavior the plan depends on exists.
However, `c8eecf3` also contains 6 commits landed after `55fe900`
(`c6f8154`, `975f0a2`, `64dca22`, `21ab284`, `9a36d1c`, `7af585c` — a
Playbook feature and several intake-docs commits), none of which touch this
slice's target files **except** `server/db.js`, which gained **+55 lines**
(two new blocks: a `playbook_settings` table + two new prepared statements,
both unrelated to the Value Pool). This shifts the technical-plan's cited
line numbers for `value_summary_generation_log`'s CREATE body (originally
"1822-1835") and the `upsertValueUnitSummary`/`insertValueSummaryGeneration`
statement citations (originally "3190-3238") downward by roughly 25-40
lines on the actual worktree. **This is consistent with, not contrary to,
the plan's own repeated instruction** ("re-anchor the line numbers on the
worktree," "verify, do not assume" — stated at multiple points in both
plans) and the durable-cure migration registry already keys off
`table.firstColumn` strings, never line numbers. Non-blocking; flagged so
the implementer greps for content rather than trusting line numbers verbatim
on first touch of `server/db.js`.

Environment/session-safety note (Step 1 of the technical plan, carried
forward): a `concurrently` dev server (pid 79758, ~1 day uptime) and several
live `claude` CLI processes are running and one Node process (pid 59764)
holds `~/.claude/agent-dashboard/dashboard.db` open — matches the plan's own
expectation. No git operation touched the main checkout beyond read-only
`status`/`fetch`/`log`; the main checkout's working tree was not stashed,
reset, or checked out during triage. Its only present state is a handful of
pre-existing untracked files (`.claude/agent-plan-backups/`, two intake docs
under `requests/2026-08-04-value-pool-grouping/intake/`) — not modifications
to any tracked file — left over from other in-flight work; these are inert
with respect to `git worktree add` (which operates on committed refs) and do
not block this build. **Per the technical plan's own Step 1 obligation, the
implementer must still back up the live DB before booting/testing the effort
branch even once** (this slice ships DDL and `db.js` runs migrations at
`require()` time against the shared path) — that has not been done as part
of triage and is not a triage responsibility; it is the build's first
action.

## Docker stack

**Not provisioned — this project has no Docker stack applicable to this
surface.** A `docker-compose.yml` exists at the project root, but it is a
single-container **production deployment** wrapper (mounts the same
host `~/.claude/agent-dashboard` SQLite file the `npm run dev`/`npm start`
workflow already uses; publishes the dashboard on `127.0.0.1`) — it is not a
per-effort isolated stack, and `PROJECT-CONTEXT.md` documents no per-effort
Docker/compose convention or port-registry for this project. The technical
plan's own verification commands (`§6 Commands`) run directly via `node
--test`, `npm run test:server`, `npm run test:client`, and `npm run dev` in
the worktree — no compose invocation anywhere in either plan. Skipped per
the standing instruction ("If none exists, skip this step entirely").

## Effort registry

Not provisioned — `PROJECT-CONTEXT.md` documents no effort-registry file for
this project (checked; no such convention is named). Existing sibling
worktrees under `/Users/sara/CODE-LOCAL/SARA/efforts/` follow the same
`<slug>/Claude-Code-Agent-Monitor` layout by convention alone, which this
worktree now matches.

## Back-out command

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor \
  reset --hard c8eecf374cde7fcc3118f5abeeb4aded49caf600
```

(The worktree is brand new and currently identical to its branch point, so
this is a no-op unless/until the build commits or dirties it.)

## Open questions

**Non-blocking, with stated assumption:**

1. The technical-plan's Step 2.4 (raw multi-ALTER `db.exec` block) is
   explicitly withdrawn and replaced by the test-plan's MANDATORY A-1/A-2
   `addColumnsIfMissing` helper. **Assumption carried into the build:** the
   test-plan is the amending document and wins on conflict (both documents
   say this explicitly — test-plan's own preamble: "Where they disagree,
   this plan wins"). No action needed from triage; flagged here only so the
   build doesn't accidentally implement the withdrawn Step 2.4 verbatim.
2. Line-number citations against `server/db.js` are stale by ~25-40 lines
   for the two ranges noted above (unrelated Playbook feature landed
   in between). **Assumption:** implementer re-anchors by content/grep, per
   both plans' own repeated instruction to do so, not by trusting the cited
   line numbers.
3. OPEN-1..OPEN-4 in `decisions.md` and the technical-plan's own listed
   risks/watches (DEC-11, WATCH-A, WATCH-B, WATCH-F) are pre-existing,
   already-tracked plan-level open items, not new triage findings — left to
   the build/implementer to carry per each item's own stated disposition
   (fixed-with-a-test or watch). Not re-litigated here.

**No blocking open questions.** Both plans are self-consistent, the
worktree is clean, and the substrate the plans depend on is present on the
branch.

---

## Verdict: READY
