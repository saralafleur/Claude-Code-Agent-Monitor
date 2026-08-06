# Build Report — Value Pool Slice 2: `2026-08-05-coverage-on-demand`

> Authored by `build-lead`, synthesizing the build brief, run plan, task list,
> red evidence, verification evidence, review findings, and both decision logs.
> The document the user reads. This build **stopped at green** — it did not
> commit, push, or open a PR.

---

## ⚠️ FAST — QA debt

**This build ran in `fast` mode (auto-pilot + direct). There is no
`test-plan.md` for this intake, and `team-qa` never ran for it** (intake
`decisions.md` DEC-F2; this build's own `decisions.md` DEC-1). Test coverage
authored *for this slice's acceptance criteria* is **smoke-level only**.

**The smoke assertions, named:** `server/__tests__/coverage-smoke.test.js`
(8 cases / 4 suites), derived from technical-plan §8's acceptance criteria —

- **AC-2** (coverage request flags a project and drains it): `stmts.requestValueCoverage`
  exists; `stmts.clearValueCoverageRequest` exists. *(DB-statement layer only.)*
- **AC-3** (header renders "N of M described · ~X min", cold start renders
  `estimating`): `server/lib/value-coverage.js` exists and exports
  `coverageSnapshot` + `estimateEta`; `coverageSnapshot` computes
  `described`/`pending`/`complete` from `counts`; the snapshot carries a
  `demand` field; `estimateEta` returns a `state` supporting cold-start
  `estimating`. *(Library-function layer only.)*
- **AC-5** (WS payload carries coverage): `ValueAltitudesUpdatedPayload`
  declares `coverage?: CoverageSnapshot` inside its own interface body;
  `stmts.listRecentValueGenerationDurations` exists. *(Type + statement layer
  only.)*

AC-1, AC-4 and AC-6 have **no smoke assertion of their own** in this file.

**Deferred, verbatim from intake `decisions.md` DEC-F2's "Scope of the debt"**
(which is itself `supporting/qa.md`'s DEFERRED list):

1. **Full E2E of the coverage-request flow.**
2. **`screens.snapshot.test.tsx` baselines** for the header / "prioritize now"
   control.
3. **Drain-loop load/perf** — WATCH-5 git cost, WATCH-7 race frequency under
   continuous drain.
4. **WS subscriber lifecycle edge cases** (reconnect, stale-tab merge) beyond
   the G2 parity assertion.
5. **Calibration output quality judgment.** ⚠️ Stronger than deferred-judgment:
   **Task 12's calibration never ran at all.** Only the env-var *plumbing*
   (`DASHBOARD_VALUE_SUMMARY_UNIT_MODEL` / `..._GROUPING_MODEL`, both unset by
   default) exists; no haiku-vs-sonnet measurement was performed, no artifact
   is attached to DEC-10, and no calibration-informed default was pinned — the
   fallback tail still ends in `"haiku"`, unchanged from before this build. So
   **AC-6 is unmet**, not merely un-reviewed. See DEC-2 in this build's
   `decisions.md`.
6. **Locale copy review beyond mechanical key-completeness.** (Mechanical
   en↔ko/vi/zh key parity *is* covered and mutation-proven — see §Standing
   guards.)

**Also deferred, recorded by the verifier / reviewer** (dispositions in this
build's `decisions.md` DEC-3): SF-4 (route probe-composition duplicated across
two handlers — a live §9.1 shape), SF-6 (`shouldBroadcastCoverage` drops a
terminal `complete` transition on a project's first post-restart observation),
SF-7 (four existence-only smoke cases under acceptance-criterion titles — §9.3
shape, still shipped), SF-8 (client `coverage` state not reset on `projectId`
change), SF-9 (a failing `GET /coverage` blanks the whole Plan Ledger panel),
SF-10.2 (Slice-1-inherited `assert.ok(true` in
`value-summary-interrupted-boot.test.js:133`), and nits N1–N5.

**`supporting/qa.md`'s G1–G6 were NOT deferred** and are not part of this debt
— they are this build's minimum done-bar, and all six were independently
mutation-proven (see §Standing guards).

**Recommended follow-up:** run **`team-qa` on this intake folder**
(`requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/`),
then a **follow-up build** for the tests it plans. A later `team-status` pass
should read this stamp and recommend exactly that. **This build is not fully
verified — do not present it as such.**

---

## What was built

The Value Pool's background altitude sweep now has a second, explicit demand
level, and the UI tells the truth about where it is. A **coverage request**
(`POST /api/project-plans/coverage-request`) stamps
`value_summary_sweep_state.coverage_requested_at` for one project, jumps it to
the head of the sweep rotation, and kicks a dedicated `runCoverageDrain()` that
drains that project in bounded, back-to-back ≤40-unit composer batches — each
iteration re-assembling the pool and **re-deriving** `pending` from that
iteration's own full-pool counts — until a freshly re-derived count reads zero,
or one of six named, mutually exclusive exit conditions fires (including a hard
`MAX_DRAIN_BATCHES_PER_RUN = 25` cap and a 24 h TTL sweep). One new server-side
module, `server/lib/value-coverage.js`, is the **only** place
`described`/`pool_size`/`pending`/`complete`/`demand`/`eta`/`computed_at` is
computed; that single `coverageSnapshot` object is carried verbatim by the new
`GET /api/project-plans/coverage` and by an additively-widened
`value_altitudes_updated` WebSocket payload. `PlanLedgerPanel` gains its
first-ever `eventBus` subscription, renders "N of M described · ~X min
remaining" (or the named `estimating` state — `~0 min` cannot render), offers
**"prioritize now"** as the request's entry point, and merges snapshots
monotonically on `computed_at` so an HTTP/WS race can never visibly regress
progress. Separately, `summaryModel(stage)` + `SUMMARY_STAGES` make the model
cascade stage-aware (`unit` / `grouping`) with the fallback tail written exactly
once — plumbing only; no default was re-pinned. Passive behavior for unflagged
projects is unchanged, and `server/index.js` is byte-identical to the base
commit.

## Change verdict

**Verdict: `GREEN-WITH-CAVEATS`**

Every line of shipped code is green and guarded: all suites pass, both review
blockers are fixed and independently re-verified, and every standing guard this
project's catalog demands was observed **red against a real injected mutation**
and restored. There is **no known defect outstanding in shipped code.**

It is not plain `GREEN` for one reason, and it is a scope reason rather than a
quality one: **Task 12 (calibration, DEC-10) — a MANDATORY task-list row and
the whole of acceptance criterion AC-6 — genuinely never ran.** Calling that
row done would be exactly the "green tick over a thing that never happened"
failure this project's catalog exists to prevent, so it is carried as a caveat
with a dated disposition (DEC-2) rather than absorbed into a GREEN. Nothing
incorrect shipped as a result: DEC-10's own gate was *calibrate before pinning*,
and no default was pinned, so the model cascade behaves exactly as it did
before this build.

**Durable cure: applied** — six of them, all named by the technical plan and
this project's own catalog, each independently mutation-proven:

| Cure | Catalog id | State |
|---|---|---|
| One coverage/ETA home (`value-coverage.js`, DEC-5) — no pool-membership SQL in the tick, route, or module; fed solely by the composer's `counts` | **§9.1 DERIVED-DUAL-VIEW** | Applied; enforced by the named deliverable `value-coverage-parity.test.js` (G2) **after** that guard was itself repaired — see loop-backs |
| One model cascade (`summaryModel(stage)` + `SUMMARY_STAGES`, DEC-7/O2), fallback tail written once | **§9.1** | Applied |
| Re-derive `pending`, never decrement (DEC-4); pool growth mid-drain extends the drain for free | **§9.1 / WATCH-8 lineage** | Applied; proven by the pool-growth case (`generated === 10`, not the naive 5) |
| `created_at DESC, id DESC` **before** `LIMIT` on both new duration reads | **§9.2 row-id-as-chronology-proxy** | Applied; red-proven by flipping to `ORDER BY id` |
| Guarded `PRAGMA table_info` ALTER + `UPGRADE_CASES` entry (column exists / legacy row NULL / writable / second run no-op) | **§9.5 FRESH-DB-BLIND SCHEMA CHANGE** | Applied; `assertLegacyRow`/`assertWritable` confirmed actually invoked (not REGISTRATION ≠ EXECUTION) |
| Every new export dispositioned in `single-writer-guard.test.js`; `value-coverage.js` registered `"scanned"` in `chronology-ordering.test.js`'s `FILE_DISPOSITIONS` | **§9.7 HAND-SCOPED STRUCTURAL SCAN** | Applied — including the reviewer's SF-5 catch (the new consumer edge `value-coverage → value-summary` was missing from the hand-typed consumer map) |

**Deferred cures** (dispositioned, DEC-3, not silently dropped): SF-4's shared
`buildProbeCoverage` helper (§9.1 at the composition layer — the next consumer
acquires a third copy), SF-6's first-observation broadcast fix, SF-8/SF-9's
client robustness fixes, and the class-level cure for the StrictMode blind spot
(only a single targeted regression test was added, not a suite-wide
`StrictMode` render harness).

---

## Loop-back history — read this before you trust the first number

This build reported green three separate times before it actually was. That is
the finding, and it is on record because it is **this project's single
highest-density defect surface, recurring on the same file family for the third
consecutive effort**.

**Round 1 — implementer self-report: "all green."** Suites did pass.

**Round 2 — `build-verifier` (independent re-execution, no self-report
trusted) → `GREEN-WITH-CAVEATS`.** Re-ran everything from scratch, injected
six mutations itself, and found **two real gaps** the implementer's report had
counted as done:
1. A `MAX_DRAIN_BATCHES_PER_RUN` comment citing **`DEC-12` — a decision row
   that does not exist** (rows run DEC-1..DEC-11).
2. A new `assert.ok(true, …)` dead `catch`-fallback branch in
   `coverage-smoke.test.js`, which made the plan's own literal G5 gate
   (`grep -rn "assert.ok(true" server/__tests__/` must return 0) false, and the
   task list's "zero vacuous guards detected" confirm-bullet inaccurate.

   Both fixed in a loop-back and independently re-verified by the dispatching
   session. (The AC-5 fix was substantive, not cosmetic: the fallback was
   deleted *and* the assertion hardened from a whole-file substring match to an
   interface-body-scoped `coverage?: CoverageSnapshot` match.)

   The verifier also confirmed a **pre-existing flaky test** (timestamp
   collision in `value-summary-tick.test.js`) by running the untouched Slice-1
   worktree 8×, failing 4/8 — genuinely not this build's fault.

**Round 3 — `build-reviewer` (adversarial, read-only) → 2 BLOCKERS, 11
should-fix, 5 nits**, on a build two prior passes had called green:

- **BL-1 — the MANDATORY §9.1 parity deliverable was itself the vacuous guard.**
  `value-coverage-parity.test.js`'s `if (broadcastPayload)` branch was
  **unreachable under the file's own fixture** (heuristic mode ⇒
  `generated === 0`, plus `__resetTickStateForTest()` ⇒ no transition ⇒
  `shouldBroadcastCoverage` returns false). Its `else` fallback then built the
  "broadcast" side by calling `coverageSnapshot()` **from the test itself**,
  with `pool_size: 3` hardcoded — so the "route vs. broadcast parity"
  assertion degenerated to `coverageSnapshot(X) deepEquals coverageSnapshot(X)`
  and could only ever catch a rogue re-derivation on the **route** side. Which
  is precisely where the verifier's own two mutations had landed, which is why
  a correctly-executed mutation pass certified it green. **The guard whose
  entire job was to catch dual derivation was itself the dual-derivation-hiding
  vacuity.**
- **BL-2 — a real React 18 StrictMode regression.** `mountedRef` was created
  `useRef(true)` with a cleanup-only effect that set it `false` and a setup body
  that never re-armed it. Under `<StrictMode>` (which `main.tsx:98` wraps the
  app in, on `react ^18.3.1`) dev runs setup → cleanup → setup, so
  `mountedRef.current === false` from first paint for the component's whole
  life: **no unit would ever render its altitude text in `npm run dev`** — the
  entire point of Slices 1–2 — and "prioritize now" would stay permanently
  disabled after one click. It replaced a StrictMode-correct per-effect
  `let cancelled = false` local. **No existing test could see it: RTL renders
  without `StrictMode`.**

Both blockers were fixed in a second loop-back **with red proofs** (BL-1
red-proven by mutating the *tick* side — `pool_size: result.poolSize - 1` —
a mutation the guard as shipped was blind to; BL-2 by a new test that renders
the panel inside `<StrictMode>`), plus **SF-1, SF-2, SF-3 and SF-5** applied.
SF-10 and Task 12 were **explicitly deferred with dispositions**, not silently
dropped.

**Name the pattern: this is `PROJECT-CONTEXT.md` §9.3 VACUOUS-GUARD, on the
`value-summary-tick.js` / `value-coverage.js` sibling file family, for the third
effort running** — 8 §9.3-family events in `2026-08-04-value-summary-tick`, 9 in
`2026-08-04-altitude-invalidation` (Slice 1, this build's direct predecessor),
and 4 here. The catalog's own stated conclusion —
*"being warned about this entry does not reduce its incidence"* — held again:
every agent in this build was briefed on it by name, and the MANDATORY §9.1
deliverable still shipped vacuous.

**But it was caught, not shipped.** The reason is the catalog's own answer, and
it is not a technique — it is a headcount: the verifier caught what the
implementer missed, and the reviewer caught what the verifier's own
correctly-executed mutation pass had certified. Under `fast` mode the run plan
(`director-of-engineering`) deliberately kept **both** `build-planner` and
`build-reviewer` IN scope rather than trimming them. **Dropping either would
have shipped BL-1 and BL-2.** That call is the reason this report says
"caught," and it should be repeated on any future build touching this file
family.

---

## Red → green evidence

### A. Acceptance-criterion smoke tests (`fast` mode's authored coverage)

`server/__tests__/coverage-smoke.test.js` — 7 of 8 cases observed **RED** before
implementation (`red-evidence.md`), all 8 **GREEN** after; verified by the
verifier to be the same file, same test names, same assertion text — a genuine
red→green, not a rewritten test.

| Test case | AC | Layer | RED before | GREEN after |
|---|---|---|---|---|
| `requestValueCoverage statement should exist in db module` | AC-2 | unit (DB stmt) | ✅ `stmts.requestValueCoverage should exist` | ✅ |
| `clearValueCoverageRequest statement should exist in db module` | AC-2 | unit (DB stmt) | ✅ `stmts.clearValueCoverageRequest should exist` | ✅ |
| `should have value-coverage.js module with coverageSnapshot function` | AC-3 | unit (module) | ✅ `Cannot find module '../lib/value-coverage'` | ✅ |
| `coverageSnapshot should compute described, pending, complete from counts` | AC-3 | unit | ✅ `MODULE_NOT_FOUND` | ✅ |
| `coverageSnapshot should include demand field (closed registry)` | AC-3 | unit | ✅ `MODULE_NOT_FOUND` | ✅ |
| `estimateEta should return object with state field supporting cold-start 'estimating'` | AC-3 | unit | ✅ `MODULE_NOT_FOUND` | ✅ |
| `listRecentValueGenerationDurations statement should exist for ETA computation` | AC-5 | unit (DB stmt) | ✅ `stmts.listRecentValueGenerationDurations should exist` | ✅ |
| `ValueAltitudesUpdatedPayload type should have optional coverage field` | AC-5 | integration (type source) | ⚠️ passed vacuously at red time (dead `catch` fallback) — **rewritten in loop-back 1** to an interface-body-scoped `coverage?: CoverageSnapshot` match | ✅ |

### B. Standing-guard mutation proofs (performed by the verifier, not read from a report)

Each mutation was applied with a backup, observed failing, restored, and
`git diff --stat` confirmed byte-identical before re-running green.

| Guard | Catalog id | Mutation injected | Result |
|---|---|---|---|
| `db-migration.test.js` `coverage_requested_at` UPGRADE_CASES | §9.5 | removed the column from `addColumnsIfMissing` | ✅ 3 tests red (35/35 → 32/35), restored green |
| `value-coverage-parity.test.js` (G2, §9.1 named deliverable) | §9.1 | `snapshot.pending = counts.queued + counts.unavailable + 5` on the route | ✅ red (`described: -4, pending: 7` vs `1, 2`) — **but see BL-1: this proof only covered the route side** |
| `chronology-ordering.test.js` duration ordering | §9.2 | `ORDER BY created_at DESC, id DESC` → `ORDER BY id DESC` | ✅ red (`[2000,3000,1000]` vs `[3000,2000,1000]`), restored green |
| `single-writer-guard.test.js` `requestValueCoverage` | §9.7 / W-3 | rogue dead `if (false)`-gated second call site in the tick | ✅ red — lexical scan catches dead code, the correct shape here |
| `PlanLedgerPanel.test.tsx` R4 monotonic merge | §9.8 lineage | `mergeCoverage` → unconditional `return next` | ✅ red (stale snapshot overwrote newer), restored green |
| `i18n.test.ts` E1.1 whole-namespace parity | WATCH-S2-F / §9.7 | deleted `planLedger.pool.coverage.draining` from `ko` | ✅ red (`ko: missing [...]`) — mechanical scan, not a hand-typed key list |

**Recorded honestly (verifier §5b):** a *first*, naive parity mutation
(`snapshot.pending = counts.queued`, dropping `+ counts.unavailable`) **did not
fail** — probe mode routes every miss to `queued`, so `counts.unavailable === 0`
on the route path and the wrong formula gave the right number. Passing a
mutation test is not the same as the mutation being *catchable*.

### C. Loop-back fix red-proofs

| Fix | Red proof | Now |
|---|---|---|
| **BL-1** — delete the parity test's self-built fallback; force a real `passive → requested` broadcast and compare `broadcastPayload.coverage` | mutate the **tick** side (`pool_size: result.poolSize - 1` in `buildAndMaybeBroadcastCoverage`) — invisible to the test as originally shipped | ✅ green; no `if (broadcastPayload)` fallback remains (confirmed by re-read: the assertion now hard-requires the broadcast) |
| **BL-2** — re-arm `mountedRef.current = true` in the effect setup body | new test renders `PlanLedgerPanel` inside `<StrictMode>` and asserts altitude text renders and "prioritize now" does not stay disabled | ✅ green (client panel suite 25 → 26 cases) |
| **DEC-12 phantom citation** | n/a (comment accuracy) | ✅ now cites the measured 182-unit pool and DEC-3, not a non-existent row |
| **New `assert.ok(true` in `coverage-smoke.test.js`** | n/a (removal + hardening) | ✅ `grep -rn "assert.ok(true" server/__tests__/` now returns **1**, and that one is the Slice-1 inherited hit; `grep -rn "\|\| true"` returns **0** |

### D. Independent re-verification (by the dispatching session, after all loop-backs)

- `npm run test:server` — **1784 / 1784 tests, 443 suites**
- `npm run test:client` — **817 / 817 tests, 61 files**
- `npx tsc --noEmit` (in `client/`) — clean, exit 0
- `bash .claude/skills/file-headers/scripts/check-headers.sh` — clean, exit 0
- `git diff b38b4a1 -- server/index.js` — **empty**
- The repaired parity test's fallback branch — **confirmed genuinely gone**
- `isDrainingProject` — **confirmed wired into both HTTP routes**

**`build-lead` spot-confirmation (run now, in the worktree, not read from a
report):** the six guard/new-test files —
`value-coverage-parity`, `value-coverage`, `coverage-smoke`,
`single-writer-guard`, `chronology-ordering`, `db-migration` — **91 / 91 pass,
29 suites**; `client/src/components/__tests__/PlanLedgerPanel.test.tsx` —
**26 / 26 pass**, including the BL-2 StrictMode regression case.

---

## Files changed

Single repo. Base: `b38b4a151fe3e3bcd47c7858684f0b8121b53d57`.

```
 ARCHITECTURE.md                                    |  59 +-
 client/src/components/PlanLedgerPanel.tsx          | 301 +++++++---
 client/src/components/__tests__/PlanLedgerPanel.test.tsx  | 369 +++++++++++++
 client/src/i18n/locales/en/projectDetail.json      |   8 +
 client/src/i18n/locales/ko/projectDetail.json      |   8 +
 client/src/i18n/locales/vi/projectDetail.json      |   8 +
 client/src/i18n/locales/zh/projectDetail.json      |   8 +
 client/src/lib/api.ts                              |  32 ++
 client/src/lib/types.ts                            |  92 +++-
 client/src/pages/__tests__/ProjectDetail.test.tsx  |  30 +
 docs/API.md                                        |  10 +-
 docs/DATABASE.md                                   |   6 +-
 server/README.md                                   |   6 +-
 server/__tests__/chronology-ordering.test.js       |  57 ++
 server/__tests__/db-migration.test.js              | 145 +++++
 server/__tests__/project-plans-api.test.js         |  85 +++
 server/__tests__/single-writer-guard.test.js       |  79 +++
 server/__tests__/value-summary-tick.test.js        | 383 +++++++++++++
 server/__tests__/value-summary.test.js             | 131 ++++-
 server/db.js                                       | 105 +++-
 server/lib/value-summary-tick.js                   | 603 +++++++++++++++++----
 server/lib/value-summary.js                        |  64 ++-
 server/routes/project-plans.js                     |  91 +++-
 23 files changed, 2472 insertions(+), 208 deletions(-)

+ 4 new (untracked) files, 958 lines:
 server/lib/value-coverage.js                       | 166
 server/__tests__/value-coverage.test.js            | 362
 server/__tests__/value-coverage-parity.test.js     | 217
 server/__tests__/coverage-smoke.test.js            | 213
```

`server/index.js`: **0 lines changed** (a MANDATORY obligation, verified).
`PROJECT-CONTEXT.md`: updated on this branch by `build-lead` (DEC-11's planning
note + catalog updates — see §Memory below); it is **not** in the stat above
because that stat was captured before this report was written.

## Standing guards + Definition of Done

- [x] **Each new test observed RED before, GREEN after** — 7/8 smoke cases
      (`red-evidence.md`); the 8th was rewritten in loop-back 1 after it was
      found to pass vacuously.
- [x] **Full relevant suites green** — server 1784/1784 (443 suites), client
      817/817 (61 files), `tsc --noEmit` clean. Independently re-run.
- [x] **§9.1 DERIVED-DUAL-VIEW** — single coverage/ETA home; named parity
      deliverable exists, compares the **real** broadcast payload, and is
      red-proven against a *tick-side* mutation. **Known residual: SF-1's
      original dual computation was fixed (the WS payload now carries
      `snapshot.pending`), SF-4's duplicated route composition is not.**
- [x] **§9.2 row-id-as-chronology-proxy** — both new duration reads sort
      `created_at DESC, id DESC` before `LIMIT`; red-proven.
- [x] **§9.3 VACUOUS-GUARD** — 4 family events, all found by a *later* gate
      than the one that should have caught them; all dispositioned (2 fixed
      with red proofs, SF-7's four existence-only cases deferred under DEC-3).
      **Sweep: `assert.ok(true` returns 1 (Slice-1 inherited, disposed in
      DEC-3), `|| true` returns 0.** The plan's literal G5 gate ("must return
      0") is therefore **not** met — by one inherited line, not a new one.
- [x] **§9.5 FRESH-DB-BLIND SCHEMA CHANGE** — guarded `PRAGMA table_info`
      ALTER (not the deprecated `SELECT … LIMIT 1` probe); real `UPGRADE_CASES`
      entry, actually invoked; red-proven. No `CHECK` change, so §9.6 does not
      apply and none was introduced.
- [x] **§9.7 HAND-SCOPED STRUCTURAL SCAN** — all new exports dispositioned;
      `value-coverage.js` registered `"scanned"`. **Recurred once (SF-5) and
      was fixed**; see catalog note.
- [x] **§9.8 OVERLOADED-ABSENCE** — `demand` and `eta.state` are closed,
      exported, server-authored registries; a stalled drain stays `requested`
      (flag preserved); `estimating` never carries a fabricated `ms_remaining`;
      `formatEtaMinutes` floors at 1 so `~0 min` cannot render.
- [x] **Build/typecheck clean** — `tsc --noEmit` exit 0; file-headers audit
      exit 0.
- [x] **`server/index.js` diff empty**; **drain never reads
      `MAX_PROJECTS_PER_TICK`** (brace-matched body scan, verified).
- [x] **Docs updated** (`update-project-docs`, mandatory) — `ARCHITECTURE.md`,
      `docs/API.md`, `docs/DATABASE.md`, `server/README.md`, all confirmed
      accurate against the code by the reviewer.
- [ ] **Plan's own DoD — AC-6 / Task 12 (calibration + pinned defaults):
      NOT MET.** Deferred with a dated disposition (DEC-2).
- [ ] **Plan's literal G5 gate (§9.3 sweep returns 0): NOT MET** by one
      Slice-1-inherited line (DEC-3).

**Deviation reviewed and upheld:** the route calls `runCoverageDrain()` where
technical-plan §3.5's literal snippet named `runValueSummaryTickOnce`. Both the
verifier and the reviewer independently confirmed this is a **plan
self-contradiction correctly resolved**, not scope creep — §3.5's literal form
contradicts §1's own objective and DEC-3.3 (which forbids the drain reading
`MAX_PROJECTS_PER_TICK`, a knob `runValueSummaryTickOnce` reads), and would
have left `runCoverageDrain` with no production caller at all.

**Scope creep: none.** Every touched file is inside technical-plan §3.1–3.8's
change set plus the four new test files it names.

## Worktree & stack

- **Worktree (this is where you review and commit — *not* the main checkout):**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor`
- **Branch:** `effort/2026-08-05-coverage-on-demand`
- **Base ref / starting commit:** `master` @
  `b38b4a151fe3e3bcd47c7858684f0b8121b53d57` (Slice 1, altitude-invalidation)
- **Docker stack:** **none provisioned.** This project's `docker-compose.yml` /
  `docker-compose.full.yml` are single-container production wrappers that mount
  the same host `~/.claude/agent-dashboard` SQLite file as `npm run dev`; there
  is no per-effort isolated stack or port registry. To poke at this live, run
  `npm run dev` **from the worktree above** — and read the shared-DB caution
  below first.

⚠️ **Shared-DB caution.** This slice ships DDL (an additive nullable column)
against `~/.claude/agent-dashboard/dashboard.db`, which `db.js` migrates at
`require()` time for **every** process (server, MCP, desktop, VS Code
extension) regardless of which worktree runs it. **Back up that file before
booting the effort branch**, and set `DASHBOARD_DB_PATH` to a scoped temp path
for any ad-hoc invocation that `require()`s `server/db.js`. The ALTER is
additive and idempotent, so it is safe on the live DB — but it is not
reversible by `git reset`.

⚠️ **Artifact locations are split** (worth 30 seconds of your attention). The
build docs of record — `build-brief.md`, `run-plan.md`, `build-task-list.md`,
`decisions.md`, and **this report** — live in the **main checkout** at
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-05-coverage-on-demand/build/2026-08-05-coverage-on-demand/`.
The three supporting evidence files (`red-evidence.md`,
`verification-evidence.md`, `review-findings.md`) were written by sub-agents
into the **worktree's** copy of that path, and have been **copied** into the
main checkout's `supporting/` so they survive worktree teardown. `build/` is
gitignored, so none of it is ever committed — if these should be preserved,
they need to be moved outside `build/` deliberately.

## Shipped commit

- **Per repo:** `Claude-Code-Agent-Monitor` — commit `4c2e931` on branch
  `effort/2026-08-05-coverage-on-demand`, pushed to
  `origin/effort/2026-08-05-coverage-on-demand` on 2026-08-05. **Not yet
  merged to master.** The repo's pre-commit hook re-ran Prettier + the full
  server (1784/1784) and client (817/817) suites after formatting staged
  files and both passed before the commit landed.

## Residual risk & back-out

**Watch:**

1. **AC-6 is unmet** (Task 12 / DEC-10). Model tiering is plumbing only; the
   `unit` and `grouping` stages both still resolve to `haiku` by default. The
   consequence is inertness, not misbehavior — but Slice 3's grouping synthesis
   is designed to run on a *different* tier, so this must close before Slice 3
   or Slice 3 will silently run grouping on `haiku`.
2. **SF-4 — the probe-snapshot composition is written twice** in
   `routes/project-plans.js` (`:308-319` and `:334-345`), and the two copies
   have **already diverged** in their `requestedAt` argument. This is §9.1's
   own lesson ("scan for copies of its *helpers* too") at the composition
   layer, and it is exactly how Slice 3 / `ccam` / MCP acquires a third copy.
   **Highest-value single follow-up.**
3. **SF-6 — a terminal `complete` broadcast can be dropped** on a project's
   first observation in a process lifetime (drain-first resume after a server
   restart, or a pool completed by `POST /altitudes` between ticks). An open
   tab then never learns coverage finished — narrowly, the exact failure DEC-6
   exists to close.
4. **SF-8 — `PlanLedgerPanel` is rendered unkeyed** (`ProjectDetail.tsx:1292`),
   so switching projects reuses the instance; if the previous project's
   `computed_at` is newer, the monotonic merge **permanently rejects** the new
   project's snapshot and the header renders project A's counts under project
   B's pool.
5. **SF-9 — a failing `GET /coverage` blanks the entire Plan Ledger panel**
   (the new call joined the existing `Promise.all`). Coverage is
   progressive-enhancement; it should not be able to take down the plan list.
6. **StrictMode blind spot (class-level, unfixed).** BL-2 was a real regression
   that **no test could see**, because RTL renders without `StrictMode`. One
   targeted regression test now exists for this panel; the *class* of
   double-invoke bugs remains structurally invisible to the client suite.
   Recorded as a new candidate catalog pattern.
7. **Pre-existing flaky test** (not this build's): timestamp-collision
   `notStrictEqual` in `value-summary-tick.test.js`, reproduced 4/8 runs on the
   untouched Slice-1 worktree.
8. **Live WATCH rows** carried from intake: WATCH-S2-B (`requestedAltitudesRef`
   fetch-once semantics end with this slice), WATCH-S2-C (ETA averages across
   model tiers once tiering lands), WATCH-S2-E (git-walk cost × drain
   iterations + per-mount probes), WATCH-S2-F (new client registry copies at
   the CJS/Vite boundary — **triggers already firing** on any Slice 3 growth).

**Back-out (single repo):**

```bash
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor \
  reset --hard b38b4a151fe3e3bcd47c7858684f0b8121b53d57
```

`reset --hard` does **not** remove the four new untracked files. To back out
completely, follow with:

```bash
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor \
  clean -fd server/
```

(Scoped to `server/` deliberately — an unscoped `clean -fd` would also delete
the untracked intake/build docs in that worktree.) Note again: **neither
command reverts the `coverage_requested_at` column** already added to any
`dashboard.db` that has booted this branch. The column is additive and
nullable, so leaving it is harmless.

## Open decisions

| Id | Log | Status | What it needs |
|---|---|---|---|
| **OPEN-S2-1** | intake `decisions.md` | **PENDING (Sara)** | Which real project validates the coverage flow end-to-end. Assumption carried through the build: whichever real project has the largest uncovered pool at the time. Does not block; recorded so it does not silently close. |
| **DEC-2** (new, written by `build-lead`) | build `decisions.md` | **DECIDED-AUTO — deferred** | Task 12 / AC-6 calibration deferred to the follow-up `team-qa` + build pass, with the reason recorded. Needs Sara's confirmation if she wants it done before Slice 3. |
| **DEC-3** (new, written by `build-lead`) | build `decisions.md` | **DECIDED-AUTO — deferred** | Disposition for SF-4, SF-6, SF-7, SF-8, SF-9, SF-10.2 and N1–N5 (§9.4: "should-fix is a triage label, not a disposition"). |
| **WATCH-S2-A..F** | intake `decisions.md` | live, unarmed except F | Promotion triggers as recorded; WATCH-S2-F's trigger fires on any Slice 3 registry growth. |
| **DEC-11** | intake `decisions.md` | **CLOSED by this report** | `PROJECT-CONTEXT.md` planning note applied on the effort branch (not the shared main checkout), as DEC-11 required. |

## Next step

**This build stops at green. The user commits / pushes / opens a PR — or hands
it back for changes.** This skill does not commit.

It also does **not** tear down the worktree, and there is no Docker stack to
tear down. The worktree at
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor`
**stays live until whoever merges runs the teardown manually** (`git worktree
remove …` + branch deletion). Nothing here is automatic cleanup — if you leave
it, it stays.

Recommended order:
1. Review the diff in the worktree (start with `PlanLedgerPanel.tsx` and
   `routes/project-plans.js` — the two surfaces carrying live residual risk).
2. Commit on `effort/2026-08-05-coverage-on-demand`; fill in **Shipped
   commit** above.
3. Run **`team-qa`** on this intake folder to close the QA debt named in the
   stamp at the top, then a follow-up build for the tests it plans — **before**
   Slice 3, because Slice 3 depends on both the coverage mechanism and the
   model tiering AC-6 never validated.

---

## Memory updated (`build-lead`)

- **Build run-log:** row appended to
  `~/.claude/skills/team-build/memory/build-run-log.md` (this project names no
  build run-log of its own in `PROJECT-CONTEXT.md`, so the cross-project
  fallback was used).
- **Defect catalog** (`PROJECT-CONTEXT.md`, **on this effort branch**, per
  DEC-11):
  - **§9.3 VACUOUS-GUARD** — dated 2026-08-05 note added: third consecutive
    effort on this file family, and a new twist recorded — *the MANDATORY
    guardrail deliverable was itself the vacuity, and its `else` fallback made
    a correctly-executed mutation proof certify it green.*
  - **§9.7 HAND-SCOPED STRUCTURAL SCAN** — dated note added for SF-5 (the
    hand-typed **consumer** list, on the guard this build extended in the same
    commit).
  - **New candidate pattern, not promoted — `STRICTMODE-BLIND CLIENT SUITE`**,
    recorded with an explicit promotion trigger.
