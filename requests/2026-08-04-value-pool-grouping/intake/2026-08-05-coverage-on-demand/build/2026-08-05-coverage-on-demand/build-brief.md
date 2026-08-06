# Build Brief — Value Pool Slice 2: coverage-on-demand + progress UX + model tiering

**Triage date:** 2026-08-05
**Effort slug:** `2026-08-05-coverage-on-demand`
**Outer skill invocation:** `fast` — implies auto-pilot + direct.

**MODE: FAST — no test-plan; smoke-level verification only.** No
`test-plan.md` exists for this intake (`team-qa` was deliberately deferred,
intake `decisions.md` DEC-F2, "FAST — QA debt"). This build's own
`build/2026-08-05-coverage-on-demand/decisions.md` DEC-1 already accepted
"build now, smoke-level proof, `FAST — QA debt` carried forward" as the
run mode, chosen by Sara via the dispatching session. **Nuance every
downstream agent must inherit:** this is not a bare smoke pass — the
technical-plan itself inlines this project's defect-catalog guardrail floor
(§6 "Testing & verification", G1a–G6) as **non-negotiable build-time
obligations**, independent of the missing test-plan. Fast mode narrows
*test-plan* coverage (no full E2E, no snapshot-baseline sweep, no drain
load/perf, no locale-copy review — see this build's DEC-1 for the exact
deferred list); it does **not** narrow the catalog floor. Derive 1-3 smoke
assertions from the technical-plan's own acceptance criteria (§8 "Product",
AC-1..AC-6) in addition to the mandatory guardrails below.

---

## What we're building

Give the Value Pool's background altitude-generation sweep a second,
explicit demand level and make its progress honest and live. A **coverage
request** stamps `value_summary_sweep_state.coverage_requested_at` for one
project, jumps it to the head of the rotation, and drains it in bounded
back-to-back ≤40-unit composer batches until a freshly re-derived count
reads zero. One server-side module (`server/lib/value-coverage.js`)
computes a single `coverageSnapshot` object — `described` / `pool_size` /
`pending` / `complete` / `demand` / `eta` / `computed_at` — carried
**verbatim** by a new `GET /api/project-plans/coverage` and by an
additively-widened `value_altitudes_updated` WebSocket payload;
`PlanLedgerPanel` gains its first-ever `eventBus` subscription, renders "N
of M described · ~X min remaining" (or the named `estimating` state), and
offers **"prioritize now"** as the coverage request's entry point.
Separately, `summaryModel()` becomes stage-aware (`unit` / `grouping`) so
per-unit compression and Slice 3's grouping synthesis can run on different
model tiers, with the default pinned only after a one-time
haiku-vs-sonnet calibration on a real 40-unit batch. End state: passive
behavior byte-identical for unflagged projects, one requested project
drainable to 100% while the UI tells the truth about where it is, and no
number on either wire computed anywhere but the one server-side home.

## Plan sources

- Technical plan: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/technical-plan.md`
- Test plan: **does not exist** — deferred by design (intake `decisions.md`
  DEC-F2; this build's own `decisions.md` DEC-1). Not a blocker per the
  orchestrator's explicit `fast`-mode instruction.
- PM plan (context): `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/pm-plan.md`
- Supporting (context): `supporting/architect.md`, `supporting/engineer.md`, `supporting/qa.md` (same intake folder) — `qa.md`'s G1–G6 minimum guardrail checklist is inlined into `technical-plan.md` §6 as build obligations even though `team-qa` itself never ran.
- Decisions log (intake, DEC-1..DEC-11 / WATCH-S2-A..F / OPEN-S2-1): `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/decisions.md` — confirmed present (all rows found by heading scan).
- Decisions log (this build): `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/build/2026-08-05-coverage-on-demand/decisions.md` (DEC-1 — fast-mode choice, already recorded).

**Buildability check:** the technical-plan has a concrete Change set (§3,
9 numbered surfaces across schema/lib/routes/client), sequenced
Implementation steps (§4, 16 steps, each independently checkable), and
usable acceptance criteria (§8 "Product", AC-1..AC-6, each phrased as a
falsifiable behavior — e.g. "a rendered `~0 min` is a requirement
violation, not a rounding choice"). This is a real, buildable plan on its
own. **No test-plan check applies** (fast mode, none exists).

## Surfaces touched

- **Schema/statements:** `server/db.js` — `value_summary_sweep_state` gains
  nullable `coverage_requested_at TEXT` via the guarded-ALTER `PRAGMA
  table_info` idiom (§9.5 FRESH-DB-BLIND SCHEMA CHANGE — copy the precedent
  at `db.js:1023`/`:1466`, **not** the deprecated try/`SELECT…LIMIT
  1`/catch probe); widened `listValueSweepTargets` ORDER BY with a TTL
  cutoff param; new `requestValueCoverage` / `clearValueCoverageRequest` /
  `listRecentValueGenerationDurations` statements (the latter is the ETA's
  sole input, sorted `created_at DESC, id DESC` before `LIMIT` — §9.2
  row-id-as-chronology-proxy).
- **New single home:** `server/lib/value-coverage.js` (DEC-5) — the only
  place `described`/`pending`/`complete`/ETA is computed; exports
  `coverageSnapshot` + `estimateEta`.
- **Composer:** `server/lib/value-summary.js` — probe mode on
  `enrichPoolAltitudes` (classify-only, no spawn, no log row — DEC-9);
  `summaryModel(stage)` + exported `SUMMARY_STAGES` (DEC-7/O2, replaces a
  second `groupingModel()` sibling the engineer's input proposed).
- **Tick/drain:** `server/lib/value-summary-tick.js` — `runCoverageDrain()`
  sharing the existing module-scope `running` guard; re-derived
  `pending`/`described` every iteration (never a decremented counter);
  named exit conditions incl. a hard `MAX_DRAIN_BATCHES_PER_RUN = 25` cap
  and a 24h TTL sweep (DEC-8); widened broadcast condition.
- **Routes:** `server/routes/project-plans.js` — new `POST
  /coverage-request` and `GET /coverage`; explicitly **not** widening
  `POST /altitudes` (partial-batch counts would lie with full-pool
  authority).
- **Client:** `client/src/lib/types.ts`, `client/src/lib/api.ts`,
  `client/src/components/PlanLedgerPanel.tsx` (first-ever `eventBus`
  subscription on this panel; monotonic `computed_at` merge to prevent
  progress regression on an HTTP/WS race), all four i18n locales
  (`en`/`ko`/`vi`/`zh`).
- **Explicitly untouched (verify diff is empty):** `server/index.js` — the
  engineer's environment correction, load-bearing: only `db.js:466-467`
  threads `broadcast` into the tick, the payload composes at
  `value-summary-tick.js:170-176`.
- **Docs (mandatory per this project's CLAUDE.md `update-project-docs`
  skill):** `docs/DATABASE.md`, `docs/API.md`, `ARCHITECTURE.md`,
  `server/README.md`.
- **`PROJECT-CONTEXT.md`:** a planning note is applied **on the effort
  branch**, not in triage (DEC-11) — do not touch the shared file from the
  main checkout as part of this build.

### Project-specific risk surfaces flagged by this project's own defect catalog (`PROJECT-CONTEXT.md` §9)

- **§9.1 DERIVED-DUAL-VIEW** — the technical-plan's own §5 names this
  explicitly as a 4-surface guardrail for this slice (the coverage/ETA
  computation, pool membership, the model cascade, the wire-state
  registries) and requires the named `server/__tests__/value-coverage-parity.test.js`
  (G2) to catch a **re-computation**, not just a rogue read — this
  catalog's twice-proven weak spot ("a rogue-reader scan does not catch a
  rogue re-derivation," `PROJECT-CONTEXT.md` 2026-08-03 note on
  `practice-kind-override`). Verify at build time this parity test is
  actually written with that filename and actually deep-equals route vs.
  broadcast `coverage`.
- **§9.2 row-id-as-chronology-proxy** — `listRecentValueGenerationDurations`
  is a new chronology-sensitive read; must sort `created_at DESC, id DESC`
  **before** `LIMIT` (G4, red-proof by flipping to `ORDER BY id`).
- **§9.3 VACUOUS-GUARD family — HIGHEST-DENSITY SURFACE ON THIS PROJECT.**
  `PROJECT-CONTEXT.md` records **eight** §9.3-family events on this exact
  file surface in `2026-08-04-value-summary-tick`, and **nine** in the very
  next effort on the same surface (`2026-08-04-altitude-invalidation`,
  Slice 1 — this build's own direct predecessor, landed as `b38b4a1`).
  "Being warned about this entry does not reduce its incidence" is the
  catalog's own stated conclusion. Standing rule applies without exception:
  no DoD row is ticked on an agent's self-report; every guard named in
  technical-plan §6 (G1a–G6) must be **observed red against a real
  mutation by someone re-running it**, not read from a report. Watch
  specifically for TEST-PINS-THE-DEFECT (a scope-qualifying comment
  accommodating a known gap instead of reporting it) and
  REGISTRATION≠EXECUTION (a registry/meta-test proving entries exist but
  never proving the harness iterates them) — both catalogued from this
  same file family.
- **§9.5 FRESH-DB-BLIND SCHEMA CHANGE / §9.6 NON-ATOMIC REBUILD** — this
  slice ships an additive nullable-column ALTER against the shared
  `~/.claude/agent-dashboard/dashboard.db` (`DB_PATH` is user-global —
  every worktree's migrations land on the real dashboard the moment any
  process boots). Guarded-ALTER via `PRAGMA table_info`, plus a
  `db-migration.test.js` `UPGRADE_CASES` entry proving: column exists,
  legacy row reads NULL, column writable, second run is a no-op (G3). No
  `CHECK` constraint changes anywhere in this slice, so §9.6's rebuild path
  does not apply — do not introduce one.
- **§9.7 HAND-SCOPED STRUCTURAL SCAN** — every new export in
  `value-coverage.js` / `value-summary.js` must be added to
  `single-writer-guard.test.js`'s `assertSingleHome` disposition map in the
  same commit (plan §3.2/§3.3); `value-coverage.js` must also get a
  `FILE_DISPOSITIONS` entry in `chronology-ordering.test.js`'s scanned-file
  scope or the suite fails by design (§9.7 "working as intended").
- **§9.8 OVERLOADED-ABSENCE** — `demand` (`passive`/`requested`/`draining`)
  and `eta.state` (`measured`/`estimating`/`none`) are closed,
  server-authored registries specifically so a drain-stalled state reads
  as `demand:"requested"` (flag kept) rather than silently collapsing into
  the same absence as "never requested." Do not let a no-progress exit and
  a cold-start ETA collapse to the same wire value.
- **WATCH-E/WATCH-F (inherited, cited as WATCH-S2-F)** — client registry
  drift at the CJS/Vite boundary for the new `demand`/`eta.state` wire
  values; same-commit rule across `types.ts`, `PlanLedgerPanel.tsx`, and
  all four locale files, each carrying a canonical-source doc comment
  (the `TrunkDriftResult["skipped"]` precedent).

## Durable-cure obligations (MANDATORY — not optional, cite plan/catalog id)

1. **One coverage/ETA home (DEC-5, §9.1).** `server/lib/value-coverage.js`
   is the *only* place `described`/`pending`/`complete`/ETA is computed.
   Fed solely by the composer's `counts` — **no pool-membership SQL** in
   the tick, the route, or this module (DEC-16 sole-composer rule,
   inherited from Slice 1). Enforced by the **named** deliverable
   `server/__tests__/value-coverage-parity.test.js` (G2).
2. **One model cascade (DEC-7/O2, §9.1).** `summaryModel(stage = "unit")`
   + exported `SUMMARY_STAGES` — not a second `groupingModel()` sibling.
   Fallback tail (`DASHBOARD_VALUE_SUMMARY_MODEL → DASHBOARD_FOCUS_SUMMARY_MODEL
   → DASHBOARD_FOCUS_INFER_MODEL → "haiku"`) written exactly once.
3. **Re-derive, never decrement (WATCH-8/QA-DEC-2 lineage, DEC-4).** Each
   drain iteration re-assembles the pool and re-derives `pending` from that
   iteration's own full-pool `counts` — never a locally decremented
   counter. Pool growth mid-drain must extend the drain for free (G1c).
4. **`server/index.js` diff is empty.** The engineer's explicit correction;
   do not open this file for this slice.
5. **Guarded ALTER, not a raw multi-statement block (§9.5).** Copy the
   `PRAGMA table_info` precedent at `db.js:1023` / `:1466`, `:1484`,
   `:1503` — do not reintroduce the deprecated try/`SELECT…LIMIT
   1`/catch probe idiom.
6. **`MAX_PROJECTS_PER_TICK` stays untouched and the drain must not read
   it at all (DEC-3.3).** No `MAX_DRAIN_*` env knob family; the
   `MAX_DRAIN_BATCHES_PER_RUN = 25` cap is a safety bound whose declaring
   comment must cite the measured 182-unit pool it was sized against
   (§9.8 bounds-rule precedent from the same catalog family).
7. **Client never computes (DEC-1/DEC-5, §9.1).** `PlanLedgerPanel`
   renders fields from the snapshot; it must not re-derive `described`,
   `pending`, or any ETA arithmetic. Merge rule: accept a snapshot only if
   its `computed_at` is newer than the one currently held (prevents an
   HTTP/WS race from visibly regressing progress).

**Sequencing obligation carried into the build (technical-plan §4, steps
1-3):** before any Slice-2 code is written, re-read intake `decisions.md`
DEC-1..DEC-11 / WATCH-S2-A..F / OPEN-S2-1 against Slice 1's **actual landed
code** (not its planned shapes) and correct any `[S1-dep]` drift. This is a
build-team responsibility, not a triage one — flagged here so it isn't
skipped. Two preconditions this technical-plan gated on (§0 P1 git
reconciliation, §0 P2 Slice 1 landed) are **already satisfied** — see
"Worktree set" below for the verification.

## Worktree set

Single-repo project (confirmed via `PROJECT-CONTEXT.md` §"Repo topology" —
self-contained monorepo, no sibling repos, re-confirmed by `find
<root> -maxdepth 2 -name .git` returning only the root `.git`). One
worktree provisioned, following the existing sibling-effort convention
under `/Users/sara/CODE-LOCAL/SARA/efforts/` (no `PROJECT-CONTEXT.md`
naming an `efforts/`-at-project-root convention; the established local
pattern is `efforts/<slug>/Claude-Code-Agent-Monitor`, matched here).

| | |
|---|---|
| Path | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor` |
| Branch | `effort/2026-08-05-coverage-on-demand` (**new branch**) |
| Base ref | `master` (current HEAD at provisioning time) |
| Starting commit | `b38b4a151fe3e3bcd47c7858684f0b8121b53d57` |
| Worktree status at handoff | clean (`git status --porcelain` empty) |

**§0 preconditions verified live at triage, not re-derived from the plan's
stale premise.** The technical-plan's §0 text describes an *earlier* state
(local `master` at `c6f8154`, 6 ahead/2 behind `origin/master`, a staged
duplicate diff from `value-summary-tick`) — that state has since been
resolved by other work:
- `git rev-parse master` == `git rev-parse origin/master` ==
  `b38b4a151fe3e3bcd47c7858684f0b8121b53d57` (0 ahead / 0 behind).
- `master`'s tip commit message is `feat(server,client): mutability-aware
  Value Pool altitude caching + invalidation` — **Slice 1**, confirming §0
  P2 (Slice 1 built and landed) is satisfied. Slice 1 is also present as
  its own worktree/branch at the same commit
  (`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor`,
  `effort/2026-08-04-altitude-invalidation` @ `b38b4a1`), and the
  `value-summary-tick` merge (`55fe900`) is an ancestor of `master`,
  satisfying §0 P1.
- Every `[S1-dep]` shape the technical-plan cites (`enrichPoolAltitudes`
  returning `counts`, `ALTITUDE_FRESHNESS`, DEC-14's `counts` shape) must
  still be **re-verified against Slice 1's actual landed code** by the
  build team per the plan's own instruction — triage confirms the
  precondition is satisfied, not that every downstream shape citation is
  byte-accurate.

**Concurrent-session check (re-run at triage, per this project's standing
concurrent-session guidance).** Three interactive `claude` processes (PIDs
264, 96004, 96133) and a `concurrently`-driven dev server (`vite` PID
79851, `esbuild` PID 79853, uptime since Tue 01AM) are live against the
main checkout's cwd. **No git operation touched the main checkout beyond
read-only `status`/`log`/`rev-parse`** during this triage; the worktree
was provisioned via `git worktree add` against the committed `master` ref
only. The main checkout's only present state is the same handful of
pre-existing untracked files noted at session start
(`.claude/agent-plan-backups/`,
`requests/2026-08-04-value-pool-grouping/intake/2026-08-04-altitude-invalidation/decisions-qa-addendum.md`,
the `2026-08-05-coverage-on-demand` intake folder itself) — not
modifications to any tracked file, and inert with respect to `git
worktree add`. This build's own work must happen exclusively inside the
new worktree from here on.

**Shared-DB caution carried forward from Slice 1's own build-brief:** this
slice ships DDL (an additive nullable column) against the shared
`~/.claude/agent-dashboard/dashboard.db`, which `db.js` migrates at
`require()` time for *every* process (server, MCP, desktop, VS Code
extension) regardless of which worktree runs it. Back up the live DB
before booting/testing the effort branch, and ensure `DASHBOARD_DB_PATH`
is set to a scoped temp path for every test invocation that
`require()`s `../db` (TEST-AGAINST-LIVE-DB candidate entry,
`PROJECT-CONTEXT.md` §9.3, 3rd decline recorded — do not let this build be
the promotion trigger).

## Docker stack

**Not provisioned — this project has no per-effort Docker/compose
convention applicable to this build.** `docker-compose.yml` and
`docker-compose.full.yml` exist at the project root, but (matching Slice
1's own triage finding, re-confirmed here — nothing about this changed)
they are single-container **production deployment** wrappers that mount
the same host `~/.claude/agent-dashboard` SQLite file the `npm run
dev`/`npm start` workflow already uses; they are not a per-effort isolated
stack, and `PROJECT-CONTEXT.md` documents no per-effort port registry or
cross-service override registry for this project. The technical-plan's own
verification commands (`npm run test:server`, `npm run test:client`,
`node --test …`, `npm run dev`) run directly in the worktree — no compose
invocation anywhere in the plan. Skipped per the standing instruction ("If
none exists, skip this step entirely").

## Effort registry

Not provisioned — `PROJECT-CONTEXT.md` documents no effort-registry file
for this project. Existing sibling worktrees under
`/Users/sara/CODE-LOCAL/SARA/efforts/` (`2026-08-02-trunk-drift-detection`,
`2026-08-03-rule-coverage-team`,
`2026-08-03-trunk-drift-open-branch-blindness`,
`2026-08-04-altitude-invalidation`, `2026-08-04-devops-control-plane`)
follow the same `<slug>/Claude-Code-Agent-Monitor` layout by convention
alone; this worktree now matches.

## Back-out command

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor \
  reset --hard b38b4a151fe3e3bcd47c7858684f0b8121b53d57
```

(The worktree is brand new and currently identical to its branch point, so
this is a no-op unless/until the build commits or dirties it.)

## Open questions

**Non-blocking, with stated assumption:**

1. **OPEN-S2-1 (Validation project choice)** — carried in intake
   `decisions.md`, PENDING Sara. **Assumption carried into the build:**
   the calibration/validation project is chosen at build time (technical
   plan §3.7/step 14) using whichever real project has the largest
   uncovered pool at that moment, unless Sara names one first; this does
   not block starting the build.
2. **`[S1-dep]` shape citations** in the technical-plan (e.g. exact
   `enrichPoolAltitudes` `counts` field names) are pinned against Slice
   1's *planned* shapes, not a fresh read of the landed code at `b38b4a1`.
   **Assumption:** the build's step 3 (re-transcribe and re-verify DEC-1..
   DEC-11 against Slice 1's landed code) happens before any Slice 2 code
   is written, per the plan's own explicit instruction — not re-litigated
   here.
3. **Fast-mode QA debt** (this build's own `decisions.md` DEC-1) — the
   full `supporting/qa.md` test-plan-equivalent coverage (E2E, snapshot
   baselines, drain load/perf, WS lifecycle edge cases beyond G2,
   calibration judgment, locale copy review) is deferred and must be
   named verbatim in the `build-report.md`'s `FAST — QA debt` stamp so a
   later `team-status` pass recommends a follow-up `team-qa` run. Not a
   triage blocker; already decided.

**No blocking open questions.** The technical-plan is buildable on its own
(fast mode; no test-plan required), the worktree is clean, both of §0's
hard preconditions (git reconciliation, Slice 1 landed) are verified
satisfied against live git state, and the main checkout was not mutated
during triage.

---

## Verdict: READY
