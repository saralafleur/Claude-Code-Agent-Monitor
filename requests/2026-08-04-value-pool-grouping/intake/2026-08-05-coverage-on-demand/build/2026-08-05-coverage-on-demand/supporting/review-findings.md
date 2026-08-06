# Adversarial code review — Value Pool Slice 2 (coverage-on-demand)

**Reviewer:** build-reviewer (read-only, no edits made)
**Date:** 2026-08-05
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor`
(branch `effort/2026-08-05-coverage-on-demand`)
**Diff reviewed:** `git diff b38b4a151fe3e3bcd47c7858684f0b8121b53d57` + 4 untracked new files
(`server/lib/value-coverage.js`, `server/__tests__/value-coverage.test.js`,
`server/__tests__/value-coverage-parity.test.js`, `server/__tests__/coverage-smoke.test.js`)
— 23 modified files, ~2,270 insertions. Every hunk read.

**Verdict: 2 blockers, 11 should-fix, 5 nits.** No scope creep. `server/index.js` diff
confirmed empty. Both blockers are catalog traps (§9.3 VACUOUS-GUARD; a behavior
regression the suite structurally cannot see).

---

## BLOCKERS

### BL-1 — G2, the named MANDATORY §9.1 parity deliverable, never compares a WS broadcast (§9.3 PLAN-LEVEL VACUOUS FIXTURE)

**File:** `server/__tests__/value-coverage-parity.test.js:136-175`
**Severity:** blocker. **Catalog id: §9.3** (PLAN-LEVEL VACUOUS FIXTURE + AGENT-SELF-REPORTED-RED), enabling a latent **§9.1** gap.

The test's own title and header claim it "proves the HTTP route and the WS broadcast
carry the IDENTICAL `coverageSnapshot` object". It does not. The `if (broadcastPayload)`
branch at line 158 is **unreachable under this file's own fixture**:

- line 34 sets `DASHBOARD_FOCUS_INFER_MODE=heuristic` → `llmAvailable()` false →
  every miss is `unavailable`, `counts.generated === 0`;
- line 138 calls `__resetTickStateForTest()` → `lastBroadcastState` empty →
  `shouldBroadcastCoverage(pid, 0, "passive", false)` computes
  `transitioned = !!undefined && … = false` and returns `0 > 0 || false` → **false**;
- therefore `broadcast` is never invoked and `broadcastPayload` stays `null`.

Empirically confirmed (instrumented copy of the shipped file run out-of-tree, product
code untouched):

```
# BROADCAST_BRANCH_TAKEN= false
# pass 2
# fail 0
```

The `else` fallback then builds `tickCoverage` by calling `coverageSnapshot()` **from the
test itself**, with `pool_size: 3` **hardcoded** and `requestedAt: null` / `draining: false`
hand-fed. So the "parity" assertion degenerates to
`coverageSnapshot(X) deepEquals coverageSnapshot(X)` compared against the route — i.e. it
can only ever detect a rogue re-derivation on the **route** side, which is exactly where
the verifier's two mutations landed (verification-evidence §5b), which is why the vacuity
was not caught. Concretely unguarded today:

1. any rogue re-computation inside `buildAndMaybeBroadcastCoverage` /
   `runCoverageDrain` / `runValueSummaryTickOnce` (the §9.1 shape this file exists for);
2. **agreement of the denominator M** between the tick's own `assembleValuePool` and the
   route's — the fallback hardcodes `pool_size: 3` instead of reading the tick's.

**Fix (concrete).** Make the broadcast happen, then delete the fallback — the fallback is
the load-bearing half of the defect, because a guard that silently substitutes a
self-computed object for the artifact it names cannot fail:

```js
// 1st tick: records (passive,false) with no broadcast (generated === 0).
await runValueSummaryTickOnce(dbModule, {});
// Now create a real demand transition, still with the LLM off:
stmts.requestValueCoverage.run(projectId, new Date().toISOString());
// 2nd tick: demand passive → requested ⇒ shouldBroadcastCoverage fires on the
// TRANSITION with generated === 0 — which is also DEC-6's own headline case.
const tickResult = await runValueSummaryTickOnce(dbModule, { broadcast: capture });
assert.ok(broadcastPayload, "the tick must have broadcast — G2 compares the real payload");
const tickCoverage = broadcastPayload.coverage;   // no fallback branch at all
```

(Route-side `requestedAt` must then also be non-null for the deep-equal, so fetch
`GET /coverage` after the request is stamped, or stamp/clear symmetrically.)
Red-prove it per §9.3 by mutating the **tick** side (e.g. `pool_size: result.poolSize - 1`
inside `buildAndMaybeBroadcastCoverage`) and watching G2 go red — a mutation that is
invisible to the test as shipped.

---

### BL-2 — `mountedRef` is never re-armed: under React 18 StrictMode the panel's altitude rendering is dead in `npm run dev`

**File:** `client/src/components/PlanLedgerPanel.tsx:675-681` (used at `:716`, `:764`, `:829`)
**Severity:** blocker (behavior regression of an existing, shipped feature; CLAUDE.md
"Preserve existing behavior unless explicitly asked to change it").

```ts
const mountedRef = useRef(true);
useEffect(
  () => () => {
    mountedRef.current = false;   // cleanup only — the setup body never sets it back
  },
  []
);
```

`client/src/main.tsx:98` wraps the app in `<StrictMode>` and `client/package.json` pins
`react ^18.3.1`, so in dev React runs **setup → cleanup → setup**. The second setup
returns a fresh cleanup but never restores `mountedRef.current = true`, so from the first
paint onward `mountedRef.current === false` for the component's whole life. Effects:

- `fetchAltitudesFor(...).then(...)` and its `.catch(...)` both early-return →
  `setAltitudes` is never called → **no unit ever renders its PROJECT/STAKEHOLDER text
  in dev**, the whole point of Slices 1–2;
- `handlePrioritizeNow`'s `finally` never clears `requestingCoverage` → the
  "prioritize now" button is **permanently disabled** after one click.

This is a regression introduced by this diff: the code it replaced used a per-effect
`let cancelled = false` local (see the removed lines in the diff), which is
StrictMode-correct. No test can see it — RTL renders without `StrictMode`.

**Fix:**

```ts
useEffect(() => {
  mountedRef.current = true;
  return () => {
    mountedRef.current = false;
  };
}, []);
```

Add a client test that renders the panel inside `<StrictMode>` and asserts altitude text
appears, or the next refactor reintroduces it.

---

## SHOULD-FIX

### SF-1 — the tick still computes `pending` itself, and both copies ride the same WS message (§9.1)

`server/lib/value-summary-tick.js:294` (`pending: queued + unavailable`) and `:261`
(`upsertValueSweepState(..., queued + unavailable)`). The file header (`:40-42`) and
`sweepOneProject`'s JSDoc (`:188-190`) both assert the opposite — *"Contains NO coverage
arithmetic of its own (§9.1) … never re-deriving `pending`/`described` here."* That is a
checkable claim, and it is false as written. The WS payload (`:325-330`) then carries
`pending` (tick-computed) **and** `coverage.pending` (single-home-computed) on the same
message — two computations of one contract field, one field apart. They agree today only
because both read the same `counts`; the day `value-coverage.js` refines `pending` (e.g.
to exclude stale-but-served units, which DEC-1 already treats specially) the two silently
diverge on one wire. §9.1's 2026-08-05 standing check applies verbatim: *"when a cure's
header says 'cannot diverge', find the loop that proves it or downgrade the comment."*
**Fix:** build the snapshot first and set `pending: snapshot.pending` in the payload; keep
`result.pending` as internal bookkeeping only (it is also the `pending_after_sweep` input),
and correct both comments to say what is actually true.

### SF-2 — `POST /coverage-request` races its own fire-and-forget drain and can answer `demand: "passive"`

`server/routes/project-plans.js:296-320`. The drain is kicked at `:307` **before** the
handler's own `assembleValuePool` → probe → `getValueSweepState` (`:310-312`). If the drain
wins the race it clears `coverage_requested_at` first, and the 202 for a request that was
just accepted reports `demand: "passive"` — and `project-plans-api.test.js` T3
(`assert.notEqual(res1.body.coverage.demand, "passive")`) goes red. Ran the file 3× — green
3×, so this is latent, not live; the ordering is nonetheless genuinely undetermined
(both paths await the same async assembly). Note also that the
`state ? state.coverage_requested_at : nowIso` fallback is dead code:
`requestValueCoverage` is an upsert, so the row always exists.
**Fix:** pass `requestedAt: nowIso` (the value this handler just wrote) instead of
re-reading it, or compose the response before kicking the drain.

### SF-3 — `demand: "draining"` is unreachable from either HTTP route

Both routes hardcode `draining: false` (`project-plans.js:315`, `:341`) and
`value-summary-tick.js` exports no way to ask whether a drain is in flight for a project
(the `running` flag is module-private and not project-scoped). So `GET /coverage` and the
202 report `"requested"` while the WS simultaneously reports `"draining"` for the same
instant — the two wires disagree about a closed registry value, and technical-plan §3.5
explicitly specifies the 202 as *"`demand: "requested"` or `"draining"`"*. A tab mounted
mid-drain shows the wrong state until the next broadcast.
**Fix:** keep `let drainingProjectId = null` beside `running`, export
`isDrainingProject(projectId)`, and pass it at both route call sites.

### SF-4 — the probe-snapshot composition is duplicated between the two routes, and the copies have already diverged

`project-plans.js:308-319` and `:334-345` are the same four steps (assembleValuePool →
`enrichPoolAltitudes({probe:true})` → `getValueSweepState` → `coverageSnapshot`), written
twice, already differing in the `requestedAt` argument (`… : nowIso` vs `… : null`). This
is §9.1's own 2026-08-01 lesson ("scan for copies of its *helpers* too, not just of it") at
the composition layer, and it is how the next consumer (Slice 3, `ccam`, MCP) acquires a
third copy.
**Fix:** one `async function buildProbeCoverage(dbModule, projectId, { draining })` in this
router (or beside `coverageSnapshot`), called by both.

### SF-5 — `value-coverage.js` is an undispositioned third consumer of `value-summary.js` (§9.7)

`server/lib/value-coverage.js:29` — `const { MAX_UNITS_PER_PROMPT } = require("./value-summary");`.
`single-writer-guard.test.js:400-435`'s `assertSingleHome("../lib/value-summary", …)` still
lists exactly two consumers (`../routes/project-plans`, `../lib/value-summary-tick`).
`assertSingleHome` derives its **export** scope from the artifact but its **consumer** scope
is hand-typed, so this new consumer is invisible to the guard while the suite is green —
§9.7 HAND-SCOPED STRUCTURAL SCAN, on the guard this build extended in the same commit
(`SUMMARY_STAGES` was added to both existing consumers' `absent` lists, so the author was
in this exact map).
**Fix:** add
`"../lib/value-coverage": { shared: ["MAX_UNITS_PER_PROMPT"], absent: [<the other 9 exports>] }`.
Worth also considering deriving the consumer list from a `grep` of `server/lib` +
`server/routes` for the module's own import specifier, per §9.7's "enumerate from the
artifact" rule.

### SF-6 — `shouldBroadcastCoverage` updates its memory on non-broadcasts, and its "can only suppress a redundant broadcast" claim is false

`server/lib/value-summary-tick.js:173-178`. The map is written on **every** call
(`lastBroadcastState.set(...)` at `:176`) regardless of the return value, contradicting its
own doc (`:94-95`, *"the demand/complete pair last actually broadcast"*). More importantly
the header's bound at `:98-101` — *"it can only ever SUPPRESS one redundant early
broadcast, never fabricate a false one"* — is not provable and is false in at least one
real case: the **first** observation for a project in a process lifetime is treated as "no
transition", so a terminal `complete` transition with `generated === 0` on that first
observation (drain-first resume after a server restart, or a pool completed by
`POST /altitudes` between ticks) is dropped, and an open tab never learns coverage
finished. That is precisely the failure DEC-6 exists to close, merely narrowed to
"post-restart".
**Fix:** treat an absent prior as a transition when `complete === true` (or unconditionally
— an extra broadcast is free and the pre-Slice-2 rule was strictly narrower), and either
update the map only on real broadcasts or fix the comment to describe what the code does.

### SF-7 — `coverage-smoke.test.js` carries four existence-only cases under acceptance-criterion titles (§9.3)

`server/__tests__/coverage-smoke.test.js:25-44`, `:48-67`, `:202-211`:
`assert.ok(stmts.requestValueCoverage)`, `assert.ok(stmts.clearValueCoverageRequest)`,
`assert.ok(coverageModule.coverageSnapshot)`, `assert.ok(stmts.listRecentValueGenerationDurations)`.
§9.3 names this exact shape as its canonical example (*"an existence-only check
(`assert.ok(stmts.listX)`)"*), and the enclosing describe is titled *"AC-2: Coverage Request
Mechanism and Snapshot Structure"* — the title promises the mechanism (flag → rotation jump
→ drain), the body proves a property exists on an object. Two further cases are
near-vacuous: `assert.ok(snapshot.demand !== undefined)` (`:120-123`) and the
**conditional** assertion at `:149-154` (`if (eta.state === "estimating") { assert… }` —
vacuous for any other state). Mitigation: the real AC-2/AC-3 proofs do exist elsewhere
(`value-summary-tick.test.js`'s drain exit-condition matrix, `project-plans-api.test.js`
Group T, `value-coverage.test.js`), so this is a misleading DoD tick rather than a coverage
hole — which is exactly §9.3's stated danger ("the next change reads the checkmark and
stops looking").
**Fix:** delete the existence-only cases, or replace each with the behavioral assertion its
title promises.

### SF-8 — client `coverage` state is not reset on `projectId` change, and `mergeCoverage` ignores `project_id`

`PlanLedgerPanel.tsx:658` + `:690` + `:81-88`. `ProjectDetail.tsx:1292` renders
`<PlanLedgerPanel projectId={id} />` **unkeyed**, so switching projects reuses the instance
and its state. `load()` merges the new project's snapshot against the **previous
project's** held snapshot; if the old `computed_at` is the newer of the two, the new
project's snapshot is rejected and the header keeps rendering project A's
`described`/`pool_size` under project B's pool. (`altitudes`/`requestedAltitudesRef` have
the same pre-existing staleness, but only `coverage` adds a filter that can make it
permanent.)
**Fix:** `setCoverage(null)` when `projectId` changes, and/or have `mergeCoverage` reject a
`next` whose `project_id` differs from the current one.

### SF-9 — a failing `GET /coverage` blanks the entire Plan Ledger panel

`PlanLedgerPanel.tsx:686-700`: the new `api.projectPlans.coverage(projectId)` call joined
the existing `Promise.all`, so any 4xx/5xx from the new route rejects the whole load and
`plans`/`units`/`health` are all left unset behind an error banner. Coverage is a
progressive-enhancement header; it should not be able to take down the plan list and the
pool.
**Fix:** `api.projectPlans.coverage(projectId).catch(() => ({ coverage: null }))` on that
leg only.

### SF-10 — DoD rows that are unmet and, per §9.4, currently have no disposition anywhere

1. **DEC-11's `PROJECT-CONTEXT.md` planning note was not applied.** The intake decision
   deferred it *"to the effort branch"* — this is the effort branch, and
   `PROJECT-CONTEXT.md` is untouched in the diff (`git status` clean for it).
2. **The §9.3 sweep still does not return 0.** `grep -rn "assert.ok(true" server/__tests__/`
   returns **1** — `value-summary-interrupted-boot.test.js:133`
   (`assert.ok(true, "startServer completed without throwing")`). It is inherited from
   Slice 1, but the plan's G5 gate is literal and there is no dated row disposing of the
   inherited hit. (The new one the verifier found in `coverage-smoke.test.js` is confirmed
   fixed.) `grep -rn "|| true"` returns 0 — clean.
3. **No `build-report.md` / `FAST — QA debt` stamp exists**, so `supporting/qa.md`'s
   deferred list is not written down anywhere for a later `team-status` pass to pick up.

Per §9.4, each must end as *fixed with a test* or *a dated `decisions.md` row* — "should-fix
is a triage label, not a disposition."

### SF-11 — Task 12 (calibration, DEC-10 / AC-6): I concur with the verifier — genuinely unmet, correctly disclosed

Independently confirmed from the diff: `summaryModel`'s fallback tail is unchanged and
still ends in `"haiku"`; the two per-stage env vars ship documented as *"unset by default"*;
no artifact is attached to DEC-10 anywhere in either checkout. The **plumbing** (DEC-7/O2's
single cascade, `SUMMARY_STAGES`, the precedence tests) is real and correct — what is
missing is the measurement and the pinned default. This is not a code defect and does not
warrant a code change; it is a MANDATORY task-list row that needs either execution or a
dated descope row. Flagging it because §9.4's 2026-08-05 note is explicit that an unfixed
item with no disposition row is how this project loses them.

---

## NITS

- **N1 — `estimateEta` selects a column it never uses.** `db.js`'s two duration statements
  `SELECT duration_ms, generated`, but `value-coverage.js:90-91` averages `duration_ms`
  alone, so a 3-unit batch weighs the same as a 40-unit batch in `per_batch_ms`. The
  extracted-but-unused column is §9.1's "dropped assertion leaves a fingerprint" shape at
  the query layer. WATCH-S2-C already accepts ETA skew, so this is a nit — but either drop
  `generated` from the SELECT or normalize per-unit and say so.
- **N2 — the i18n registry scan skips silently instead of failing.**
  `value-coverage.test.js:286-326`: `STATE_TO_LOCALE_KEY` is hand-typed and unmapped
  registry members hit `if (!key) continue;`, so a 4th `DEMAND_STATES`/`ETA_STATES` value
  would ship with no locale key and no failure (§9.7). The catalog's own fix shape
  (`UNCOMPARED_FIELD_GUARANTORS`, §9.1 2026-08-05) is one extra line: assert the exempt set
  is **exactly** `["passive"]` / `["none"]`. (`i18n.test.ts`'s generic E1.1 parity already
  covers en↔ko/vi/zh drift, so this only affects *new* registry members.)
- **N3 — the parity file's second case scans its own source.**
  `value-coverage-parity.test.js:198-209` asserts that *this test file* contains no
  `pool_size - queued`. It asserts nothing about product code and can only fail if someone
  edits the test. If a "no second computation" static scan is wanted, point it at
  `routes/project-plans.js`, `lib/value-summary-tick.js` and `PlanLedgerPanel.tsx` — where
  it would presently go red on SF-1.
- **N4 — the probe comment argues with itself.** `value-summary.js:485-488` says probe mode
  *"reuses the existing cap/gate machinery"* and then says *"it does not slice a batch or
  check `llmAvailable()` at all"* (technical-plan §3.3 asked for the former). Harmless for
  coverage — `pending` is `queued + unavailable` either way — but the comment should state
  the one true thing.
- **N5 — `POST /coverage-request` writes a sweep-state row for any string.** No project
  existence check (`project-plans.js:298-305`), so an arbitrary `project_id` accumulates
  rows in `value_summary_sweep_state`. Consistent with this router's own documented
  convention (only create/import require the project row) and harmless (the rotation JOINs
  `projects`), so recorded only for completeness.

---

## What I checked and found clean

- **Scope creep: none.** Every touched file is inside technical-plan §3.1–3.8's change set
  plus the four new test files it names. `server/index.js` diff is empty (confirmed by
  `git diff --stat`). No unexplained edits.
- **§9.5 landing (G3):** `addColumnsIfMissing` PRAGMA idiom (not the deprecated
  `SELECT … LIMIT 1` probe), `UPGRADE_CASES` entry with a real legacy `CREATE TABLE`,
  legacy row reads NULL, writable via `requestValueCoverage`, clearable, second-boot no-op.
  Real; `assertLegacyRow`/`assertWritable` are actually invoked (not REGISTRATION ≠
  EXECUTION).
- **§9.2 (G4):** both new duration statements sort `created_at DESC, id DESC` **before**
  `LIMIT`; the new `chronology-ordering.test.js` case stamps `created_at` scrambled
  relative to insertion id, so it genuinely distinguishes `ORDER BY id`; `value-coverage.js`
  is registered `"scanned"` in the derived `FILE_DISPOSITIONS`; no new `GRANDFATHERED`
  entries. `listExpiredCoverageRequests` has no `LIMIT`, so §9.2 doesn't apply to it.
- **The drain loop:** all six exit reasons are mutually exclusive and individually tested;
  the flag is cleared **only** at true completion or TTL, never on `error`/`no_progress`
  (§9.8-correct); every iteration passes the **full** unit list to `enrichPoolAltitudes`
  (so the four-term partition holds on iteration ≥ 2); `pending` is re-derived from that
  iteration's own counts, proven by the pool-growth case (`generated === 10`, not the
  naive 5); the cap test is real (25 iterations, unique keys per iteration).
  `MAX_PROJECTS_PER_TICK` is genuinely absent from the drain path, and the guard for it is
  a real brace-matched body scan, not a whole-file grep.
- **DEC-6 broadcast widening:** the transition rule is implemented and the
  `value-summary-tick.test.js` "terminal iteration via cache-hit" case really exercises it
  (`generated === 0`, 2 broadcasts, terminal `complete: true`) and would fail if the
  condition were narrowed back to `generated > 0`. See SF-6 for the one gap.
- **R4 monotonic merge:** correct (`next.computed_at > prev.computed_at`), ISO strings
  compare correctly, equal timestamps keep `prev`; the client test publishes newer-then-older
  and would fail on an unconditional accept. See SF-8 for the cross-project gap.
- **§9.8 discrimination:** `demand` and `eta.state` are closed, exported, server-authored
  registries; `estimating` never carries a fabricated `ms_remaining`;
  `formatEtaMinutes` floors at 1 so `~0 min` cannot render; the errored sweep still routes
  through `upsertValueSweepStateKeepPending` (Slice 1's B2 cure preserved).
- **Probe mode (DEC-9):** never spawns, writes no cache row, writes no generation-log row,
  still resolves cache hits — all four asserted with real fixtures.
- **`summaryModel(stage)` (DEC-7/O2):** one cascade, one fallback tail, per-stage override
  prepended; precedence table covers default/unit/grouping/shared/all-unset plus a real
  end-to-end spawn-args assertion.
- **Docs:** `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `server/README.md` all
  updated and accurate against the code, including the superseded "no client subscriber"
  notes and the two new env vars.
