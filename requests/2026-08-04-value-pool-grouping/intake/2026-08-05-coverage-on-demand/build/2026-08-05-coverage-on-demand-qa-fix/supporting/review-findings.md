# Build Review — coverage-on-demand QA-fix (adversarial, §9.4 FIX-ROUND-REGRESSION pass)

**Reviewer:** build-reviewer (independent, read-only)
**Date:** 2026-08-05
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor`
**Branch:** `effort/2026-08-05-coverage-on-demand-qa-fix`
**Diff reviewed:** `git diff 4c2e93187f5fe3edb64099992f4e3eceda8a0e99` — 10 files, +1094 / −75
**Governing catalog entries:** §9.4 FIX-ROUND-REGRESSION, §9.3 VACUOUS-GUARD, §9.1 DERIVED-DUAL-VIEW, §9.7, §9.8 OVERLOADED-ABSENCE

**Verdict: 4 blockers, 4 should-fix, 2 nits.** Two blockers are *proven live*
by my own independent mutation/probe runs, not inferred from reading.

**Worktree integrity:** every mutation I applied was reverted and verified
byte-identical (`shasum` + full-diff `diff` against a pre-review baseline
patch). Final `git diff` is byte-identical to the pre-review state; both temp
probe files deleted; `git status --porcelain` matches the pre-review listing.
No product or test file was left modified by this review.

---

## BLOCKERS

### B1 — SF-8 is only half-fixed: the cross-project coverage leak is still live (PROVEN)
**`client/src/components/PlanLedgerPanel.tsx:692–734`**
**Catalog: MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH + §9.1 DERIVED-DUAL-VIEW + §9.4 (partial fix, sibling case uncovered)**

`useEffect(() => setCoverage(null), [projectId])` only cures the case where
the *previous* project's coverage has **already landed** before the switch.
It does nothing about the case where the previous project's `load()` is still
**in flight** across the switch — there is no request-generation guard, no
`AbortController`, and `mountedRef` only tracks unmount, not prop change.

Timeline that still leaks:
1. `projectId = "proj-A"` → `load()` starts; A's coverage leg is slow.
2. `projectId → "proj-B"` → the load effect re-runs (fetch B starts) and the
   reset effect sets `coverage = null`.
3. B's fetch resolves → header shows B's honest snapshot.
4. **A's fetch resolves late** → `setCoverage(prev => mergeCoverage(prev, A))`.
   `prev` is B's snapshot; A's `computed_at` is newer, so A **wins**.
5. Because the merge is monotonic, B can now *never* reclaim the header. The
   leak is permanent for the life of the mount.

**Proven live.** I wrote a throwaway probe (deleted) reproducing exactly this
against the fixed code:

```
PROBE FINAL HEADER: "10 of 10 described"     <- proj-A's snapshot, rendered under proj-B
PROBE PLAN TITLES: A Plan PRESENT (leak)     <- plans/units/health leak too
AssertionError: expected '10 of 10 described' not to contain '10 of 10'
```

This is the *same defect SF-8 named*, with a different (and in production the
more likely) trigger: a user clicking from project A's detail page to project
B's while A's `/coverage` is still outstanding. The shipped SF-8 test
(`PlanLedgerPanel.test.tsx`, "SF-8: switching projectId does not leak…")
fully awaits A before rerendering, so it cannot see this at all.

The build-brief itself offered the other half — *"add
`useEffect(...)` **and/or** a `project_id`-aware `mergeCoverage`"* — and
durable-cure obligation #1 requires the fix be **structural, not incidental**.
Resetting on a prop change is timing-dependent, i.e. incidental. Note the
component **already has the correct idiom on its sibling ingest path**: the
eventBus subscriber at `PlanLedgerPanel.tsx:826` does
`if (!data || data.project_id !== projectId) return;`. The HTTP path lacks the
identical guard — a textbook §9.1 DERIVED-DUAL-VIEW: two ingest paths for the
same `CoverageSnapshot`, only one carries the project check.

**Concrete fix (pick both, they are cheap and complementary):**
1. Make the merge entity-aware — `CoverageSnapshot.project_id` is a *required*
   field (`client/src/lib/types.ts:2802`), so:
   ```ts
   function mergeCoverage(prev, next, projectId) {
     if (!next || next.project_id !== projectId) return prev;   // reject foreign snapshots
     if (!prev) return next;
     return next.computed_at > prev.computed_at ? next : prev;
   }
   ```
   Apply at all three call sites (`load()` :711, eventBus :829,
   `handlePrioritizeNow` :854 — the last one has the same in-flight race on a
   click-then-switch).
2. Add a stale-response generation guard in `load()` so **all four legs**
   (plans/units/health/coverage — I proved plans leak too) drop a response
   from a superseded `projectId`:
   ```ts
   const loadSeq = useRef(0);
   const load = useCallback(async () => {
     const seq = ++loadSeq.current;
     ...
     if (seq !== loadSeq.current) return;   // superseded — drop everything
     setPlans(...); setUnits(...); setHealth(...); setCoverage(...);
   }, [projectId]);
   ```
   This is the structural cure obligation #1 actually asks for, and it fixes
   the next entity-scoped field for free.
3. Add the missing test case: same SF-8 fixture but **do not await A** before
   `rerender`; resolve A's deferred coverage *after* B's header appears.

---

### B2 — T7 (SF-4) composition-parity guard is blind to a matched pair of drifts; the mandated anchoring assertion was never written (PROVEN)
**`server/__tests__/project-plans-api.test.js:904–994`**
**Catalog: §9.3 VACUOUS-GUARD (partial guard) + §9.1 DERIVED-DUAL-VIEW**

`build-task-list.md` Task 10 step 3 mandates **two** key-set assertions:

```javascript
assert.deepEqual(postKeys, getKeys);
assert.deepEqual(postKeys, ["computedAt","counts","draining","projectId","requestedAt"]);
//                 ^ "The second assertion ensures a *matched pair of drifts* still fails."
```

Only the **first** shipped. The second — the entire point of the anchor — is
absent. The DoD checklist line ("T7 … added with literal-substring and key-set
assertions") is therefore unmet in substance.

**Proven live — my independent fourth mutation, on the dimension no prior pass
tried.** Both prior red-proofs (implementer and verifier) only ever mutated
*one* route, which the surviving `postKeys === getKeys` assertion does catch.
I mutated **both** routes identically:

- Mutation A — added `bogusExtraKey: "matched-pair-drift",` to *both*
  `coverageSnapshot(dbModule, {...})` calls (`project-plans.js:328` and `:354`):
  `# pass 35 / # fail 0` — **T7 stayed GREEN.**
- Mutation B — deleted `requestedAt:` from *both* routes:
  T7 **stayed GREEN** (`ok 7 - T7 (SF-4)…`). A different behavioural case
  caught it, but the guard that exists specifically to catch composition drift
  did not.

Both mutations reverted; `server/routes/project-plans.js` shasum restored to
`907a89c51ffbd838d5f36de414b31db7ace219f5`.

This is precisely the §9.3 shape this project has now logged repeatedly on
this file family: a guard that is *verified red* under the mutations someone
named, and silent on the dimension that actually matters.

**Concrete fix:** add the mandated second assertion verbatim after the parity
one:
```javascript
assert.deepEqual(
  postKeys,
  ["computedAt", "counts", "draining", "projectId", "requestedAt"],
  "coverageSnapshot argument key set is the reviewed closed set — a matched pair of drifts must still fail"
);
```
Then re-run the matched-pair mutation above and confirm it goes red.

---

### B3 — `expectPanelCoreIntact` — the MANDATORY SF-9 durable-cure template — ships with a dead, self-contradicting assertion
**`client/src/components/__tests__/PlanLedgerPanel.test.tsx:1258–1269`**
**Catalog: §9.3 VACUOUS-GUARD, "THE GUARD IS THE VACUITY" sub-pattern**

```typescript
// Asserts no full-panel error banner is replacing core content   <-- claim
const errorBanner = screen.queryByRole("alert");
if (errorBanner) {
  expect(screen.getByText("Phase 1: Intake")).toBeInTheDocument();      // already asserted 4 lines up
  expect(document.querySelector('[data-test="pool-unit"]')).toBeInTheDocument(); // ditto
}
```

Two independent vacuities stacked:
1. **The selector can never match.** The panel's error banner is a plain
   `<div className="… badge …">{error}</div>` at
   `client/src/components/PlanLedgerPanel.tsx:941–943` — **no `role="alert"`,
   no `aria-live`**. `queryByRole("alert")` therefore returns `null` on every
   possible run, so the `if` body is unreachable dead code.
2. **Even if it were reachable, the body asserts nothing new** — it re-runs
   the two assertions made unconditionally immediately above it.

So the helper's third documented guarantee ("no full-panel error banner is
replacing core content") is fiction, and the comment asserting it is false.
This matters more than a normal dead assertion because build-brief durable-cure
obligation #2 designates this helper *"the template for every future leg added
to the panel's `Promise.all`"* — the vacuity is designed to be copied.

**Concrete fix:** either (a) give the banner `role="alert"` in
`PlanLedgerPanel.tsx:941` and make the assertion real
(`expect(screen.queryByRole("alert")).toBeNull()` for the pure-degradation
case), or (b) delete the dead branch and correct the helper's comment to
describe what it actually guarantees (core plan title + pool unit present).
Do not leave the comment claiming a guarantee the code does not provide.

---

### B4 — Wire-behaviour docs still state the pre-SF-6 broadcast rule (explicit DoD item, unfixed, undisposed)
**`docs/API.md:1937`, `docs/API.md:2455`, `ARCHITECTURE.md:2253–2255`**
**Catalog: §9.4 FIX-ROUND-REGRESSION (unfixed remainder with no disposition row) + CLAUDE.md non-negotiable**

The diff touches **zero** documentation files. All three locations still
document the two-condition rule the SF-6 fix superseded:

> "…broadcasts `value_altitudes_updated` … whenever it generates at least one
> unit, OR (Slice 2, DEC-6) whenever `coverage.demand`/`coverage.complete`
> **transitioned since the last broadcast** for that project"

After SF-6 there is a **third** condition the docs do not mention: *a project's
first observation in a process lifetime broadcasts iff `complete === true`* —
which is not a "transition since the last broadcast" under any reading, since
there is no last broadcast. `docs/API.md:2455` is the `value_altitudes_updated`
**wire-contract** section, so this is a wrong public contract, not a stale aside.

This is an explicit line on the build's own DoD checklist ("Docs updated if
wire behavior changed (SF-6 is a wire-behavior change; verify `docs/API.md` /
`ARCHITECTURE.md` / `server/README.md` …)"), it is a CLAUDE.md
non-negotiable ("apply the `update-project-docs` skill automatically at the
end of every change-set that alters behavior … events"), and there is **no row
in `qa/decisions.md` deferring it** — so under §9.4 it is neither fixed nor
disposed. That is the exact unfixed-remainder half of §9.4 that recurred in
the immediately-prior effort.

**Concrete fix:** update all three passages to the three-condition rule
(mirroring the corrected in-code comments at
`server/lib/value-summary-tick.js:112–121` and `:181–196`), and include the
empty-pool consequence from S2 below. `server/README.md` and `mcp/` carry no
`value_altitudes_updated` text (verified) — no change needed there.

---

## SHOULD-FIX

### S1 — SF-9's `.catch(() => ({ coverage: null }))` is a fully silent swallow — it cures §9.8 on the server and reintroduces it on the client
**`client/src/components/PlanLedgerPanel.tsx:706`**
**Catalog: §9.8 OVERLOADED-ABSENCE (this build's own named risk surface)**

The catch discards the error entirely: no `console.warn`, no retry, no state
flag, no user-visible indicator. Because `mergeCoverage(prev, null)` returns
`prev` and the header's gate is `coverage && coverage.pool_size > 0`, a
persistently failing `GET /coverage` renders **exactly the same UI** as a
project with an empty value pool. "Coverage failed to load" and "this project
has no coverage" collapse into one silent absence — literally the pattern
§9.8 is named for, and the pattern SF-6 exists in this same build to remove
from the server side.

It is also inconsistent with this file's own two established conventions:
- `fetchAltitudesFor`'s `.catch` (`:793–800`) degrades to a **visible**
  `"unavailable"` marker rather than to nothing;
- the T-E registry traps (`:754`, `:769`) `console.warn` on anomalies
  precisely so a silent degradation is never unremarked in dev.

**Concrete fix (minimum):**
```ts
api.projectPlans.coverage(projectId).catch((err) => {
  console.warn(`coverage fetch failed for project ${projectId} — header degraded:`, err);
  return { coverage: null };
}),
```
Better: track a `coverageFailed` flag and render a small inline "coverage
unavailable" marker in the header slot, matching the `altitudes` precedent.
Add an assertion for whichever is chosen to the SF-9 test (which today only
proves the *core* survived, never that the failure is observable anywhere).

---

### S2 — SF-6 widens the wire to emit a vacuous terminal frame for every EMPTY-pool project on first observation (PROVEN; untested, undocumented, undisposed)
**`server/lib/value-summary-tick.js:199–207`**

`complete` is `pending === 0` (`server/lib/value-coverage.js:134`), which is
**trivially true for a zero-unit pool**. So `: complete === true` fires for
every project whose pool is empty, on its first sweep after every process
start. Before the fix such a project broadcast nothing, ever.

**Proven live** with a throwaway probe (deleted):
```
SWEPT: 1 BROADCASTS: 1
PAYLOAD: {"project_id":"rev-empty-…","unit_keys":[],"pending":0,
          "coverage":{"described":0,"pool_size":0,"pending":0,"complete":true,
                      "demand":"passive","eta":{"state":"none"},…}}
```

No visible client harm today (`coverage.pool_size > 0` gates the header), but:
- it is undocumented wire widening on a fleet monitor where freshly-imported
  projects routinely have empty pools;
- any consumer treating a `value_altitudes_updated` frame as "something
  changed" now gets a false positive with `unit_keys: []`;
- **neither SF-6 test case covers it** — both use non-empty pools, so the fix's
  actual reachable state space is wider than what was red/green-proven.

**Concrete fix:** either narrow the predicate to
`: complete === true && poolSize > 0` (requires threading `result.poolSize`
into `shouldBroadcastCoverage` — trivial, and the JSDoc rule statement should
follow), **or** accept it deliberately with a third SF-6 test case pinning the
behaviour plus a `qa/decisions.md` row and the doc line from B4. What is not
acceptable under §9.4 is the current state: reachable, unproven, unmentioned.

---

### S3 — the `prior.demand !== demand` arm of `shouldBroadcastCoverage` is entirely unguarded (PROVEN)
**`server/lib/value-summary-tick.js:202–204`**

I deleted the demand arm outright:
```javascript
const transitioned = prior ? prior.complete !== complete : complete === true;
```
`node --test server/__tests__/value-summary-tick.test.js` → `# pass 44 / # fail 1`,
where the single failure is the **pre-existing** `S1/B2 timestamp-collision`
flake the verifier already characterised (confirmed: the identical failure
occurs on the unmutated baseline, same shasum-verified file). So **no test in
the suite covers DEC-6's demand-transition half** — `passive → requested`,
`requested → draining`, `draining → passive` can all silently stop broadcasting.

Pre-existing rather than introduced, but the diff **rewrites this exact
expression and both its explanatory comments**, and it is exactly the
"one dimension proven, its sibling silent" shape the reviewer brief asks for.
`describe("Broadcast widening (DEC-6)…")` only covers the `complete` half.

**Concrete fix:** add one case to the DEC-6 describe block: seed a prior
`{demand:"passive", complete:false}`, sweep with a live coverage request so
`snapshot.demand === "requested"` and `generated === 0`, assert exactly one
broadcast. Then red-prove it by deleting the demand arm.

---

### S4 — `qa/decisions.md` §6 is stale and now materially false; the B2 residual has no disposition row
**`requests/…/qa/decisions.md:116–196`**
**Catalog: §9.4**

§6 is a verbatim record of the *first* loop-back, never revised after the
test-author's fixes landed. As shipped it tells a reader:
- item 2: T7 "does not actually fire under either named mutation" and the
  key-set `deepEqual` "does not exist anywhere in the T7 test" — both were
  subsequently fixed; the text is now false;
- item 3: `tsc --noEmit` fails on `TS6133 'coverageHeader'` — I ran
  `npx tsc --noEmit`: **clean**. Also false;
- the closing "**Recommended next action (not performed by this build)**"
  block prescribes work that *was* performed.

Meanwhile the one T7 gap that **is** still real (B2 above — the missing
anchored key-set assertion, i.e. the literal "a matched pair of drifts still
fails" property §6 itself names) has no row anywhere. A §9.4-compliant
decision log that mis-reports which findings are open is worse than none: the
next reader will re-investigate two closed items and skip the open one.

**Concrete fix:** rewrite §6 as a dated resolution table (finding → state →
where resolved), and add a real row (or better, fix B2 and drop it) for the
matched-pair blindness.

---

## NITS

### N1 — SF-6 test hygiene
**`server/__tests__/value-summary-tick.test.js:1400, 1454, 1465`**
- Both new cases bind `const projectId = await makeSweptProject(…)` and never
  read it.
- Case 2 sets `process.env.DASHBOARD_FOCUS_INFER_MODE = "heuristic"` and
  `delete`s it only on the happy path — a throw inside
  `runValueSummaryTickOnce` leaks the env var into every later test in the
  file (`beforeEach` clears three other `DASHBOARD_*` vars but not this one).
  Move the delete into `beforeEach` or a `try/finally`.
- Case 2 asserts `hasIncomplete` but never asserts
  `result.projects[0].generated === 0`. Since `generated > 0` short-circuits
  the whole predicate, the case's zero-broadcast assertion is only meaningful
  under that unstated precondition — pin it explicitly.

### N2 — minor test/process observations
- `PlanLedgerPanel.test.tsx` SF-8 case: `expect(headerB).not.toContain("10 of 10")`
  is trivially satisfied by any header rendering B's `3 of 20`. Harmless, but
  it reads as a guard and isn't one.
- The entire build is **uncommitted** in the worktree (10 modified files +
  an untracked `requests/…` tree). Given this project's standing
  concurrent-session hazard note, nothing here is durable until committed.

---

## What I checked and found clean

- **N2 exact-exemption guard (`value-coverage.test.js:298–303`) — genuinely
  real.** Independently mutated a dimension no prior pass touched: added a 4th
  member to **`ETA_STATES`** (prior proofs only used `DEMAND_STATES`). N2 went
  red (`not ok 1 - N2: …`) while all four per-locale cases stayed green —
  exactly the mandated shape. It imports the real registries from
  `../lib/value-coverage` (not a test-local copy) and retains marginal value
  over the pre-existing closed-registry assertion at `:143`. Reverted;
  `value-coverage.js` shasum restored.
- **SF-6 boolean shape re-derived independently over the full state space.**
  `complete` is a strict boolean (`pending === 0`,
  `value-coverage.js:134`), so `complete === true` is safe. Single call site
  (`:365`), reached from both `runValueSummaryTickOnce` and `runCoverageDrain`
  via the shared `buildAndMaybeBroadcastCoverage` tail, and only on
  `outcome === "ok"` — no dual-view divergence. The `lastBroadcastState` map is
  written unconditionally (pre-existing), but since `transitioned` is true
  whenever the stored value would change, the map stays consistent with actual
  broadcasts for every already-seeded project; the only unbroadcast write is
  the first-observation-incomplete seed, which is correct and matches
  pre-Slice-2 behaviour. Residuals are S2 (empty pool) and S3 (untested demand
  arm), both above.
- **`L3: three-tick quiesce` edit (`value-summary-tick.test.js:944–951`) is a
  legitimate tightening, not a weakening.** Independent read: tick 1 is that
  project's first observation with all 10 units cached → `generated 0`,
  `queued 0`, `unavailable 0` → `complete true`, so exactly one broadcast is
  the correct post-fix expectation; the old `0` was literally
  TEST-PINS-THE-DEFECT. It *increases* specificity (`=== 1`, not `> 0`), it
  carries the one-line written justification obligation #5 requires, and tick 2
  (`> 0`) and tick 3 (`=== 0`) are untouched and remain consistent under the
  new rule. This is the opposite of the catalog's "weakened to hide a
  regression" shape. It is also the **only** pre-existing assertion in the
  diff whose expectation changed.
- **SF-7 smoke-suite replacement** (`coverage-smoke.test.js`): honest. Four
  existence-only cases removed, each with a pointer comment to where the real
  proof lives; the conditional ETA case is now unconditional
  (`assert.equal(eta.state, "estimating")`); the round-trip case uses the
  correct positional `stmts.requestValueCoverage.run(projectId, iso)` signature
  (the task list's proposed object form would not have worked) and the file
  scopes `DASHBOARD_DB_PATH` to a temp file before `require("../db")`.
- **Snapshot discipline:** `screens.snapshot.test.tsx.snap` diff is purely
  additive — the only `-` line is the `---` file header; one new entry
  (`Project detail (coverage in progress) 1`) which genuinely contains
  `coverage-header`, `prioritize-now-button` and `4 of 10`, i.e. not the
  "Project not found" stub. Pre-existing entries byte-unchanged.
- **Hygiene gates, all re-run by me:** `grep -rn 'assert.ok(true' server/__tests__/`
  → **1** (SF-10.2, as required); `grep -rn '|| true' server/__tests__/` → **0**;
  `grep -c 'assert.ok(stmts\.' coverage-smoke.test.js` → **0**;
  `bash .claude/skills/file-headers/scripts/check-headers.sh` → **exit 0**;
  `cd client && npx tsc --noEmit` → **clean**; `npm run test:client` →
  **61 files / 821 tests passed**.
- **Scope creep: none.** All ten touched files are named in
  `build-task-list.md`. The one addition beyond the literal task text — the
  `altitudes` entry in the shared snapshot API mock — is required by the new
  snapshot case (which supplies a non-empty pool) and is explained in a
  comment. No unexplained edits.
