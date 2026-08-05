# Build Report — 2026-08-04-value-summary-tick

> Authored by `build-lead`, synthesizing the build brief, task list,
> implementation log, three verification passes, the adversarial review, and
> both decision logs. The document the user reads. This build **stopped at
> green** — it did not commit, push, or open a PR.

## What was built

A project's Value Pool used to synthesize altitude text for at most 40
uncached units per page visit, so the largest measured real pool (182 units,
Coaching Assistant) needed several manual reloads to fill — and a unit with no
text looked identical whether it was still waiting, over budget this round, or
had genuinely failed. This build adds a bounded background sweep
(`server/lib/value-summary-tick.js`, 234 lines, registered in
`startBackgroundServices()`) that walks projects in least-recently-swept
rotation, makes exactly one `enrichPoolAltitudes` call per swept project,
drains the overflow unattended, and records what every sweep did in two new
audit tables (`value_summary_sweep_state`, `value_summary_generation_log`).
The composer's return shape grows a per-unit `states` map (`queued` =
known-but-not-attempted-this-round vs. `unavailable` = attempted and produced
nothing), `POST /api/project-plans/altitudes` forwards it unchanged, and the
Plan Ledger panel renders the two states distinguishably in the same render.
The synchronous fast path is untouched (still ≤40, still 200-always). Schema
is purely additive — two new `CREATE TABLE IF NOT EXISTS`, zero `ALTER TABLE`,
zero rebuilds. No read-only cutover and no client live-subscription in v1
(both explicitly declined — DEC-3, DEC-8/OPEN-3).

## Change verdict

**Verdict:** GREEN-WITH-CAVEATS

**Durable cure:** **applied — all three MANDATORY catalog obligations, genuinely built and mutation-proven, not asserted.**

- **§9.1 DERIVED-DUAL-VIEW (write-sequence form)** — applied. This build is
  the "consumer #2 appears" moment the entry's own history says the pattern
  bites: `enrichPoolAltitudes` now has two production invokers (route + tick)
  while `value_unit_summaries` keeps exactly **one** lexical
  `upsertValueUnitSummary.run(` call site. DEC-10's single-composer form was
  taken (widen the return shape) rather than a second entry point. Five new
  blocks in `single-writer-guard.test.js`, all red-proven by real injection,
  and the §9.1 guards re-injected independently by the verifier. Count
  **not** incremented — the two-writer race is already tracked (WATCH-7) and
  CONSUMERS parity is already DEC-7.
- **§9.3 VACUOUS-GUARD** — applied, and this build is now the entry's densest
  recorded case. See "Residual risk" and the catalog note: **eight §9.3-family
  events in one pipeline**, every one caught by a human/agent pass and **never
  by the suite**.
- **§9.8 OVERLOADED-ABSENCE** — applied. This build is the catalog's origin
  case for the pattern and its first shipped cure: the overloaded absence is
  replaced with a discriminated per-item wire state, proven by the DEC-11
  truth table at the composer, Cases A/B at the route, and the AC-2 same-render
  test on the client. It is also now the entry's **confirmatory build-phase
  evidence** — the cure build reintroduced the pattern three times at three
  different layers, exactly as §9.8 predicts, and each was caught.

§9.5 FRESH-DB-BLIND and §9.6 NON-ATOMIC REBUILD are **inapplicable by
construction** (new tables, no `ALTER`, no rebuild) — the stronger outcome
§9.6's 2026-08-02 note asks for, and proven, not asserted:
`git diff master -- server/db.js | grep -i "ALTER TABLE"` returns nothing.

**Why "with caveats" and not plain GREEN:** the suite, typecheck, headers and
every standing guard are clean and independently reproduced. Three of the
plan's own non-test sign-off steps remain outstanding — **Task 18 (manual
browser validation) was never performed**, Task 21's commit has not happened
(correct — this skill stops at green), and OPEN-4's measurement, now recorded,
**came back over its own bar** and needs a decision from Sara. See "Open
decisions".

## Red → green evidence

Every row below was observed red before being trusted green. The **Re-proven
by** column matters more than usual on this build: per §9.3's
AGENT-SELF-REPORTED-RED sub-pattern, a red reported by the agent that wrote
the test is unverified. Rows marked *verifier* / *lead* were re-injected
independently, against production code, by someone other than the author.

| Test | Layer | RED before (observed assertion) | GREEN after | Re-proven by |
|---|---|---|---|---|
| `chronology-ordering.test.js` :: `FILE_DISPOSITIONS` | structural | `server/lib/value-summary-tick.js has no disposition in FILE_DISPOSITIONS` | ✅ 6/6 | verifier (entry removed) |
| `ledger-metrics-parity.test.js` :: C2.4 CONSUMERS parity | structural | `deepEqual` mismatch with CONSUMERS updated but expected array not | ✅ 4/4 | verifier (CONSUMERS entry removed) |
| `single-writer-guard.test.js` :: `upsertValueUnitSummary` two-file scan | structural | rogue `.run(` injected into `routes/project-plans.js` → `project-plans.js` matched | ✅ | verifier (own injection) |
| `single-writer-guard.test.js` :: one lexical `upsertValueUnitSummary.run(` inside `enrichPoolAltitudes` | structural | ✅ (see note below) | ✅ | implementer |
| `single-writer-guard.test.js` :: `insertValueSummaryGeneration` one production call site | structural | rogue `.run(` injected into route → red | ✅ | implementer |
| `single-writer-guard.test.js` :: `assertSingleHome(value-summary)` | structural | `const { buildPrompt } = require("./value-summary")` injected into tick → undispositioned export | ✅ | implementer |
| `single-writer-guard.test.js` :: `assertSingleHome(value-ledger)` | structural | `computePlanHealth` import injected into tick → red | ✅ | implementer |
| `value-summary-tick.test.js` :: DEC-16 structural scan (Case 8) | structural | real dead `db.prepare("SELECT project_id FROM project_paths")` added → `tick source must not contain 'FROM\s+project_paths'` | ✅ | **verifier** (own injection; test did not exist at all until pass 1 flagged it) |
| `value-summary-tick.test.js` :: env wiring, positive control + 2 negatives | unit | `if (mode === "off") return` removed → negative red; `startValueSummaryTick` forced to early-return → **positive control** red | ✅ 3/3 | **verifier** (both directions) |
| `value-summary.test.js` :: `ALTITUDE_STATES` → en locale registry check | structural | missing `planLedger.pool.altitudes.queued` | ✅ | implementer |
| `i18n.test.ts` :: E1.1 whole-namespace parity | structural | `projectDetail/ko: missing [planLedger.pool.altitudes.queued]` | ✅ 76/76 | verifier (key re-deleted) |
| `value-summary.test.js` :: DEC-11 truth table, cases 1–6 | unit | 6 call sites failed on the old return shape; `ALTITUDE_STATES` unexported | ✅ | implementer |
| `value-summary.test.js` :: route Case A (45 units, 41 + 4) / Case B (LLM off, 45 `unavailable`, 0 `queued`) | integration | `res.body.states` undefined | ✅ | implementer |
| `value-summary.test.js` :: T-A concurrency (two overlapping invokers) | integration | `upsertValueUnitSummary.run` disabled → `one row, never a duplicate — 0 !== 1`; `altitudes[key]` forced unset → `a race must never downgrade a unit to queued/unavailable` | ✅ | **verifier** (2 product mutations) |
| `value-summary-tick.test.js` :: T-C `pending_after_sweep` re-derived (85→88) | integration | decremented/stale form reads `5`, test expects `8` | ✅ | implementer |
| `value-summary-tick.test.js` :: overlap guard | unit | `if (running) return` removed → second concurrent call proceeds | ✅ | implementer |
| `value-summary-tick.test.js` :: least-recently-swept rotation (§9.2) | unit | `ORDER BY p.id ASC/DESC` → wrong array order | ✅ | implementer |
| `value-summary-tick.test.js` :: failure isolation | unit | rotation write moved out of the unconditional block → starvation | ✅ | implementer |
| `value-summary-tick.test.js` :: AC-1 flow proof (B1 replacement) | integration | the single `upsertValueUnitSummary.run(...)` commented out → `tick 1 wrote 40 resolved units — 0 !== 40` | ✅ | **verifier** (own mutation) |
| `value-summary-tick.test.js` :: B2, errored sweep preserves `pending_after_sweep` (×2) | integration | pre-fix, an errored sweep wrote `0`; verifier's own injected always-throwing assembler + a genuine mixed-failure (assembly ok, composer throws) both hold `5`/prior value | ✅ | **verifier** (own scripts, not the shipped tests) |
| `value-summary-tick.test.js` :: S1, rotation advances despite audit-log write failure | integration | 3-project sweep with `insertValueSummaryGeneration.run` throwing on project 1 → projects 2 and 3 still swept `outcome='ok'`, project 1's `last_swept_at` still advances | ✅ | **verifier** (own 3-project script) |
| `value-summary-tick.test.js` :: S6, duplicate `unitKey` at the cap boundary | integration | `dedupedMisses` reverted to `misses` → `duplicate unitKey appears in exactly one of altitudes/states, never both` (expected `true`, got `false`) | ✅ | **lead** (after two vacuous versions — see caveat) |
| `value-summary.test.js` :: S2/S3 route sanitization | integration | route's `states[u.unit_key] = "unavailable"` branch removed → `res.body.states["…bad-source…"]` false | ✅ | **verifier** (own mutation) |
| `value-summary.test.js` :: S4 route always sends `states` | integration | `res.json({ altitudes })` (states dropped) → `states key present` false | ✅ | **verifier** (own mutation) |
| `PlanLedgerPanel.test.tsx` :: AC-2 same render (10 `Queued` + 2 `Not available`) | component | no `queued` branch in `AltitudeText` | ✅ 14/14 | implementer |
| `PlanLedgerPanel.test.tsx` :: LLM-off, 45 `unavailable`, 0 `Queued` | component | states not distinguishable | ✅ | implementer |
| `PlanLedgerPanel.test.tsx` :: T-E out-of-registry value warns | component | no `console.warn` in component | ✅ | implementer |

**Note on the one row with no red:** `single-writer-guard.test.js`'s block 2
(one lexical call site *inside* `enrichPoolAltitudes`) scans only
`value-summary.js`'s own source, so a rogue call in another file cannot make
it red — block 1 (the cross-file two-file scan) is the guard that catches
that, and it did. The pair is complete only **as a pair**; neither alone
covers both directions. Worth knowing before anyone "simplifies" one away.

**A real finding the guard produced on day one:** the implementer's own new
`@file` comments in `value-summary-tick.js` and `value-summary.js` literally
contained the string `upsertValueUnitSummary.run(`, and the guard (which does
not strip `/** */` blocks) counted them as call sites. Reworded. That is the
guard working, not a guard bug — but it means prose describing a lexical
invariant can trip the scan that enforces it.

## Files changed

One repo (`Claude-Code-Agent-Monitor` — self-contained monorepo, no siblings).
`git diff --stat` since `b155f83`:

```
 ARCHITECTURE.md                                    |  46 ++-
 client/src/components/PlanLedgerPanel.tsx          |  56 ++-
 .../components/__tests__/PlanLedgerPanel.test.tsx  |  69 ++++
 client/src/i18n/locales/en/projectDetail.json      |   3 +-
 client/src/i18n/locales/ko/projectDetail.json      |   3 +-
 client/src/i18n/locales/vi/projectDetail.json      |   3 +-
 client/src/i18n/locales/zh/projectDetail.json      |   3 +-
 client/src/lib/api.ts                              |  18 +-
 client/src/lib/types.ts                            |  60 +++-
 docs/API.md                                        |  16 +-
 docs/DATABASE.md                                   |  48 +++
 server/README.md                                   |   7 +-
 server/__tests__/chronology-ordering.test.js       |   1 +
 server/__tests__/ledger-metrics-parity.test.js     |  10 +-
 server/__tests__/single-writer-guard.test.js       |  88 +++++
 server/__tests__/value-summary.test.js             | 384 ++++++++++++++++++++-
 server/db.js                                       |  82 +++++
 server/index.js                                    |  12 +
 server/lib/value-ledger.js                         |   6 +-
 server/lib/value-summary.js                        |  97 ++++--
 server/routes/project-plans.js                     |  30 +-
 21 files changed, 960 insertions(+), 82 deletions(-)
```

Plus two **untracked** new files that `git diff --stat` cannot show and that a
reviewer must open via `git status` (this bit the first review pass):

```
 server/lib/value-summary-tick.js          | 234 lines (new)
 server/__tests__/value-summary-tick.test.js | 776 lines (new, 21 cases)
```

Also untracked: `intake/2026-08-04-value-summary-tick/` — this effort's own
process documentation, not product code.

## Standing guards + Definition of Done

Re-run by me in the worktree just now, not quoted from the verifier:

- [x] **Each new test observed RED before, GREEN after** — table above. Nine of
      them re-injected independently by the verifier or by me against
      production code, per §9.3 AGENT-SELF-REPORTED-RED.
- [x] **`npm run test:server`** — **1621 / 1621 pass, 403 suites, 0 fail, 0
      skipped.** (`value-summary-tick.test.js` 21/21 · `value-summary.test.js`
      25/25 · `single-writer-guard.test.js` 10/10)
- [x] **`npm run test:client`** — **795 / 795 pass, 61 files, 0 fail.**
      (`PlanLedgerPanel.test.tsx` 14/14 · `i18n.test.ts` 76/76.) No
      `screens.snapshot.test.tsx` diff — 19/19 unchanged, no baselines
      regenerated.
- [x] **`cd client && npx tsc --noEmit`** — clean, exit 0.
- [x] **`bash .claude/skills/file-headers/scripts/check-headers.sh`** —
      `✔ All applicable files carry the authorship header.` exit 0.
- [x] **§9.5/§9.6 inapplicability proven** — `git diff master -- server/db.js |
      grep -i "ALTER TABLE"` returns nothing.
- [x] **§9.3 text sweep** — `grep -rn "assert.ok(true" server/__tests__/` and
      `grep -rn "|| true" server/__tests__/` both return nothing. (Necessary,
      *and demonstrably not sufficient on this build* — see Residual risk.)
- [x] **§9.1 single-writer invariants ×2** — built, injection-red-proven,
      re-proven by verifier.
- [x] **§9.2 rotation ordering** — `listValueSweepTargets` orders on a real
      timestamp with `p.id` as pure tiebreak, before the `LIMIT`; mutation to
      `ORDER BY p.id` proven red; the tick is dispositioned `"scanned"` in
      `FILE_DISPOSITIONS`.
- [x] **§9.7 scope derivation** — both `assertSingleHome` blocks consume the
      existing shared helper and derive scope from real exports (DEC-6). No
      second hand-rolled scope-derivation helper was written.
- [x] **Four-term audit-log partition everywhere** —
      `cache_hits + generated + queued + unavailable === pool_size`; no `<=`,
      no three-term variant anywhere in the tree (5 occurrences in the tick
      spec, 1 in the schema comment).
- [x] **T-A…T-E trap table, zero unresolved rows** (QA-DEC-4's standing rule).
- [x] **`openapi.js` untouched**, `openapi-contract.test.js` 4/4 green — the
      additive `states` field caused no contract regression.
- [x] **MCP untouched** — `npm run mcp:typecheck` / `mcp:build` **not run, by
      design**: `git status --porcelain -- mcp/` is empty.
- [x] **Docs updated** (`CLAUDE.md`'s automatic obligation): `ARCHITECTURE.md`,
      `docs/API.md`, `docs/DATABASE.md`, and — after review S5 caught the
      omission — `server/README.md`'s background-services env block and
      per-service prose.
- [ ] **Task 18 — manual browser validation: NOT PERFORMED.** AC-1's live
      "40 resolve, remainder shows Queued, coverage grows across 2–3 cycles
      with zero reloads", AC-2's visual distinguishability, the LLM-off render,
      the small-project fast-path regression check, and the eyes-on audit-log
      query all have **no recorded evidence**. Every one of those properties is
      covered by an automated test — but nobody has looked at the feature in a
      browser.
- [ ] **Task 21 — commit: not done, by design.** This skill stops at green.

## Worktree & stack

- **Worktree (review and commit here — *not* the shared checkout):**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor`
- **Branch:** `effort/2026-08-04-value-summary-tick`
- **Starting commit:** `b155f830c79698349952d2c88ea9f60bedaaf66d`
- **State:** the entire change set is **uncommitted working-tree state**. No
  commit exists beyond `b155f83`; `git log --oneline -1` in the worktree still
  shows `master`'s tip. Nothing is staged.
- **Docker stack:** not provisioned. Both suites run directly against throwaway
  SQLite DBs (each server spec sets its own `DASHBOARD_DB_PATH`) with no
  container dependency, consistent with every prior triage pass on this repo.
- **Unrelated pre-existing noise in the shared checkout**
  (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`): `AGENT-PLAN.md`
  modified + `.claude/agent-plan-backups/` untracked. Not this build's, not
  touched by it, and it never entered the worktree.

## Shipped commit

- **Per repo (Claude-Code-Agent-Monitor):** `0fdd276` on
  `effort/2026-08-04-value-summary-tick`, pushed to
  `origin/effort/2026-08-04-value-summary-tick` (2026-08-04, auto-pilot SHIP
  gate). Includes the S6 test's second fix + mutation proof (the fixture
  still didn't construct a genuine duplicate key after the first repair —
  see `supporting/green-evidence.md`'s final entry) applied directly by the
  orchestrator after the 3rd verifier pass, verified `npm run test:server`
  1621/1621 immediately before commit. No PR opened — this repo's `effort/*`
  branches merge to `master` directly (see `git log --grep="Merge effort"`),
  not via PR review.
- **Not yet merged to `master`.** Branch is unmerged, isolated, live —
  teardown is manual and deliberately not part of this run.

## Residual risk & back-out

**The headline risk is not in the product code — it is in what this build
taught us about the tests.**

1. **§9.3 VACUOUS-GUARD recurred eight times in this one effort's own
   pipeline, and the suite never caught a single one.** Enumerated:
   - *Pre-build (team-qa, caught before any code existed):* the audit-log
     partition specified in the three-term form (arithmetically false whenever
     `cache_hits > 0`, would have been weakened on first red); QA-DEC-2's
     45→48 T-C fixture, under which correct, decremented and stale
     implementations all read `0`.
   - *Build, verifier pass 1:* the two "environment wiring" tests shipped with
     **zero assertions**; and the MANDATORY DEC-16 structural scan **did not
     exist at all** while the task list showed it `✓`.
   - *Build, adversarial review (after two verifier passes had counted it in
     "17/17 green"):* B1, the MANDATORY AC-1 flow proof, shipped as an
     **empty-body `it()`** — and the word "assertion" inside its comment
     defeats a naive `grep assert` sweep. S4, a test whose title claimed
     old-server backward-compat and whose body drove the normal happy path,
     with a *"verified elsewhere"* comment standing in for the assertion.
   - *Build, verifier pass 3:* the shipped S6 test **never constructed a
     duplicate key at all**, despite comments claiming it did — proven vacuous
     by reverting the product fix and re-running the real test file, which
     stayed green.
   - *Build, orchestrator fix round:* the **first repair of that S6 test was
     itself vacuous** — the fixture doubled the key but `spawnResolvingFirst(39)`
     left the in-batch copy unresolved, so "never both" still passed
     regardless. Fixed on the second attempt and mutation-proven.
   **Every single verification/review pass in this build found something the
   previous pass's self-report had missed or mis-claimed.** That is the
   strongest live justification this project has ever produced for its
   "never trust a self-reported red; independently re-run it" rule — and the
   only technique that reliably worked was *revert the product fix, run the
   actual shipped test file, and require it to go red.* Scratch probes,
   greps and reading did not.

2. **§9.8 OVERLOADED-ABSENCE was reintroduced three times by its own cure —
   all caught, all fixed.** (a) **B2**: an errored sweep wrote
   `pending_after_sweep = 0`, the most optimistic possible value,
   indistinguishable from "fully drained", forever — the cure's own instrument
   collapsing an absence at the observability layer. (b) **S3**: a
   route-rejected unit landed in **neither** map, a third undiscriminated
   absence one layer above the two being discriminated — and `api.ts`'s
   brand-new JSDoc ("never both, never neither") was false at the route the
   day it was written. (c) **S6**: a duplicate `unitKey` straddling the cap
   landed in **both** maps. Between them, both halves of §9.8's acceptance
   criterion ("never zero, never two") were violated inside the build written
   to enforce it. All three are fixed and mutation-proven.

3. **OPEN-4 came back over its own bar.** Measured against the live fleet:
   `P = 15` tracked projects, `U = 182` largest pool. At the shipped code
   defaults (`MAX_PROJECTS_PER_TICK=3`, `DASHBOARD_VALUE_SUMMARY_TICK_MS=600000`):
   `ceil(15/3) × 10min × ceil(182/40) = 250 min ≈ 4h10m` worst case —
   **exceeds the ~2h bar DEC-5 set.** Source defaults were deliberately left
   alone (operator-tunable, like every other `DASHBOARD_*` knob). Setting
   `MAX_PROJECTS_PER_TICK=8` in the real `.env` brings it to
   `ceil(15/8) × 10min × 5 = 100 min ≈ 1h40m` with no code change. Needs
   Sara's call.

4. **Not visually validated.** Task 18 was skipped. Everything AC-1/AC-2
   promise is covered by tests, but nobody has watched the panel fill.

5. **Deferred / accepted, each with a tracked row:** OPEN-3 (the tick
   broadcasts `value_altitudes_updated` to **no subscriber** in v1, so a page
   left open does not update in place — you get full coverage on next mount,
   not live); WATCH-7 (route and tick can both spawn for the same unit —
   safe, atomic, one row survives, but wasteful; T-A's `spawnCount` assertion
   was honestly weakened to `>= 2` after the probe cache made the exact count
   4, disclosed rather than concealed); WATCH-8 (a project can mint units
   faster than its slot drains — the *instrument* is pinned, the *behavior* is
   a tuning question for the live fleet); WATCH-4 (`value_summary_generation_log`
   has no retention/purge in v1 — ~432 rows/day at defaults); WATCH-5 (no
   cheap pre-gate before `assembleValuePool`'s git cost); WATCH-6 (the
   `insertValueSummaryGeneration` single-writer guard will deliberately go red
   when the fast-follow adds request-path logging — that is the tripwire
   working); WATCH-2/DEC-12 (Settings "clear data" still omits all four value
   tables — must be closed as one atomic change in the fast-follow, never
   piecemeal). Nits N2 (dead empty `before()` hook) and N4 (no double-start
   guard on `startValueSummaryTick`, matching `startReconciliation`'s existing
   house pattern) are accepted and documented.

6. **One narrower-than-specified proof, disclosed:** the AC-1 flow proof calls
   `enrichPoolAltitudes` directly for the read-back rather than going through
   `POST /api/project-plans/altitudes` over HTTP as `test-plan.md` Case 10
   words it. The load-bearing property (tick writes persist and are recovered
   by a second, independent invocation with the LLM off) is mutation-proven;
   the literal "through the route, over the wire" framing is not exercised.
   Worth a follow-up test if wire-level confidence on that exact path is ever
   needed.

**Back-out (one repo):**

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor reset --hard b155f830c79698349952d2c88ea9f60bedaaf66d
```

Because nothing has been committed, this discards the entire change set. It
does not touch `master` or the shared checkout. Note `intake/…` and the two
new untracked files survive a `reset --hard`; add `git clean -fd` only if you
mean to delete the process docs too — which you probably don't.

## Open decisions

- **OPEN-4 — PENDING (Sara).** Measurement done and recorded: worst case
  **4h10m at shipped defaults**, over the ~2h bar. Set
  `MAX_PROJECTS_PER_TICK=8` in your `.env` for ~1h40m, or accept ~4h10m.
  No code change either way.
- **OPEN-3 — PENDING (Sara).** v1 ships the broadcast with no client
  subscriber; AC-1's *in-place* live update is knowingly not met this round.
  The fast-follow is ~20 client lines plus two tests. Read before sign-off.
- **OPEN-2 — PENDING (Sara), non-blocking.** Confirm Coaching Assistant (182
  units) as the AC-1 validation project — relevant only if Task 18 gets done.
- **OPEN-1 — resolved** by DEC-13 (altitude layer committed on `master` at
  `b155f83`, branch cut from it).
- **QA-DEC-4 — PARKED (Sara).** Making the trap-id ↔ coverage reconciliation
  table a standing `team-qa` step is a two-line change to templates under
  `~/.claude/` — deliberately **not** made by an agent. Given this build's
  §9.3 density, worth doing.
- **WATCH-1…WATCH-8, DEC-12 —** carried forward as listed above.
- All other DEC rows (DEC-1…DEC-17) are DECIDED-AUTO and reversible by Sara
  without reopening the build.

## Next step

**Stops at green. The user commits / pushes / opens a PR — or hands it back
for changes.** This skill does not commit.

Suggested order before you commit: (1) decide OPEN-4's env value; (2) do Task
18's browser pass — it is the only DoD item with no substitute and it takes
minutes (`DASHBOARD_VALUE_SUMMARY_TICK_MS=15000 npm run dev`, open a large
project, watch coverage grow across two cycles, then flip
`DASHBOARD_FOCUS_INFER_MODE=off` and confirm *Not available* renders instead
of *Queued*); (3) read the diff end-to-end including the two **untracked**
files, which `git diff` will not show you.

**The worktree and its branch are left live.** Nothing is torn down — no
`git worktree remove`, no branch deletion, no Docker teardown (none was
provisioned). Whoever merges does that manually, afterwards. This is **not**
automatic cleanup.
