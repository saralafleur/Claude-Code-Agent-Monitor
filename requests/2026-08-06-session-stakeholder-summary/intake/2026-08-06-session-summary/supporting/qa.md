# QA Pass — session-stakeholder-summary (FAST mode, narrowed mandate)

**Scope note (per director's run-plan, `run-plan.md` §2.4 / §4):** this is a
FAST-mode run. `intake-qa` was forced back on for exactly one reason — a
direct-hit match against two `PROJECT-CONTEXT.md` defect-catalog entries,
**§9.1 DERIVED-DUAL-VIEW** (count 7) and **§9.8 OVERLOADED-ABSENCE** (line
1645). This document is scoped to those two guardrails and their stated
acceptance criteria only. Full regression/test-suite planning (spec-by-spec
coverage of the whole feature) is explicitly deferred to the follow-up QA
pass at build time — do not read section 2 below as a complete regression
inventory.

Stack confirmed from repo config, not `PROJECT-CONTEXT.md` (no dedicated
test-stack section found there): server tests run on Node's built-in test
runner (`npm run test:server` → `node --test server/__tests__/*.test.js`,
single spec: `node --test server/__tests__/<file>.test.js`); client tests run
on Vitest (`npm run test:client` → `cd client && vitest run`, single spec:
`cd client && npx vitest run src/.../<File>.test.tsx -t "<name>"`).

---

## 1. §9.8 OVERLOADED-ABSENCE — does this build repeat Trap E or the
   `pending_after_sweep` trap?

### What Trap E and the `pending_after_sweep` trap actually were

Both were found in `intake/2026-08-04-value-summary-tick/qa/supporting/risk.md`
(Traps C and E), confirmed live 2026-08-04, and are recorded in
`PROJECT-CONTEXT.md` §9.8 as bugs **the cure for OVERLOADED-ABSENCE itself
introduced** — i.e., the precedent this new feature is told to clone
(`server/lib/value-summary.js`, `PlanLedgerPanel.tsx`'s `AltitudeText`)
already relapsed into this entry's own pattern once, inside the very build
that fixed the two original instances.

**Trap E — client fallback branch masks a real server regression.**
`AltitudeText`'s "anything not `undefined`/`"queued"`/an altitude object →
render the `unavailable` string" fallback is deliberately forward-compatible
(an old server that predates the `states` field, or a stale tab across an
upgrade, should degrade gracefully). But the same fallback branch also
catches a genuinely different case: **a new server sending a malformed or
out-of-registry `states` value** (a real bug). Both render identically —
same italic "Not available" text, no distinguishing signal anywhere in the
UI. A test suite that only exercises "old server, no `states` key at all"
passes even if a live regression ships a garbage `states` value for a unit
that actually resolved. Risk severity was rated Low-Medium ("masks future
bugs rather than causing one now") but flagged as requiring an explicit
decision either way, not silence.

**`pending_after_sweep` trap (catalog's Trap C, `risk.md`'s "convergence
math assumes no pool growth") — two distinct manifestations, both real:**
1. *Design-time (risk.md Trap C):* `pending_after_sweep` is a single number
   with no way to tell "shrinking toward zero" from "treading water" for a
   project whose pool grows between sweeps — an active project could show a
   non-zero pending count forever and there is no way to tell "backlog" from
   "will never actually finish."
2. *Build-phase (§9.8's "Never zero" B2 blocker, found by adversarial
   review, not by the planned tests):* an **errored** sweep ran its
   bookkeeping with every counter still at its initializer and wrote
   `pending_after_sweep = 0` — the most optimistic possible value — silently
   **overwriting** the last good sweep's real count. A project whose sweep
   throws every cycle (moved repo root, git lock, etc.) would report "fully
   drained" forever, indistinguishable from actually being done, because
   there was no `outcome` column to tell the two apart.

Both are documented as **fixed** in the existing codebase (verified live,
see §1.3 below) — they are cautionary precedent for *this* build, not open
defects to re-fix.

### Does this session-summary feature actually inherit these traps?

**Trap E — yes, directly, and it is the load-bearing one.** The brief
explicitly instructs the client "generating" placeholder to follow
`AltitudeText`'s pattern and to use a three-state contract (generating /
queued-behind-other-work / unavailable). Any component built from that
precedent will, by construction, have exactly the same shape of fallback
branch — "anything I don't recognize renders as the safe default" — unless
it deliberately closes the gap `AltitudeText` had to close after the fact.

**`pending_after_sweep` trap — conditionally, only if a background sweep is
built.** The brief's open question #2 (trigger model) currently recommends
**on-demand-only** generation for this build's scope, with a
`value-summary-tick.js`-style background sweep flagged as a possible
fast-follow, not this build. If architecture confirms on-demand-only, there
is no per-project "how many are still pending" counter in this build at all,
so the *literal* `pending_after_sweep` bug (a decremented/overwritten
progress counter) has no surface to land on. **This is a scope-dependent
finding, not a clean bill of health** — if architecture instead adopts (or
a later slice adds) a sweep/backlog mechanism over multiple sessions, the
generalized lesson still applies in full (see acceptance criterion below)
and must be re-checked against whatever shape that sweep takes.

### Acceptance criterion this build must satisfy (§9.8)

Per the catalog's own text: *"each genuinely distinguishable outcome must be
representable on the wire, and a consumer must never be asked to reconstruct
*why* something is absent from *what* is absent... every item submitted
lands in exactly one bucket, never zero and never two... any single number
reported as progress must be re-derived from the live input each round, not
decremented."* Concretely, for this feature:

1. **The wire contract is a closed, discriminated enum**, not a boolean or
   `undefined`/`null` flag — minimum three states per the brief:
   `generating` (in flight), `queued` (known, not started this round — only
   applicable if a sweep/backlog exists), and `unavailable` (attempted and
   failed, or permanently not produceable e.g. no transcript). Model the
   server export the way `value-summary.js` exports `ALTITUDE_STATES` — a
   single named, importable list, not a string type scattered across files.
2. **The client must not let "no state recognized" collapse into
   "unavailable" invisibly.** When the client receives a status value
   outside the registry, it must render the same safe fallback (never
   throw/block — that half of the house rule stays correct) **but also emit
   an observable, testable signal** — a `console.warn` naming the
   unrecognized value and the session id, exactly the shape
   `AltitudeText`'s post-Trap-E fix uses. This is the specific, minimal
   cure §9.8's own decisions.md record chose for Trap E (Option B: "doc
   comment + one client test + a dev `console.warn`") over a heavier
   redesign — reuse that choice, don't re-litigate it.
3. **If (and only if) this build or a fast-follow introduces any progress
   counter across multiple sessions** (e.g., "N sessions still awaiting a
   summary"), that counter must be **re-derived from the live input every
   round it is reported**, never decremented, and an errored round must
   **preserve the last known-good value** rather than overwrite it with a
   false zero — the literal `upsertValueSweepStateKeepPending` pattern.

### Test precedent to follow (name the exact shape, not just "write tests")

- **Client, Trap-E shape** — precedent test:
  `client/src/components/__tests__/PlanLedgerPanel.test.tsx` ::
  `"an out-of-registry states value warns and does not masquerade as an
  old-server absence (T-E)"` (confirmed present and passing, see §1.3). New
  spec (name TBD by architecture, e.g.
  `client/src/pages/__tests__/SessionSummaryCard.test.tsx` or wherever the
  card component lands) needs the **structural twin** of this test: mock the
  summary-status API response with a status value outside the registry
  (e.g. `"bogus"`), assert (a) the client still renders the safe fallback
  text and does not throw, (b) `console.warn` fires exactly once naming the
  bad value and the session id, and (c) this is a *different, distinguishable*
  render/log signature from the "no status field present at all" (old-server)
  case exercised in a sibling test in the same file.
- **Combination testing, not one-test-per-branch** — precedent:
  `server/__tests__/value-summary.test.js`'s `describe("enrichPoolAltitudes
  DEC-11 truth table")` (Cases 1–5, including the explicit "mutual
  exclusivity and complete partition (never in both, never in neither)"
  case). Any new server-side composer for the session summary needs an
  equivalent truth table covering the **combination** of "LLM
  available/unavailable" × "already cached/not cached" × (if a sweep
  exists) "over-budget this round," not each dimension tested in isolation
  — §9.8's own text: *"the outage-vs-backlog conflation only reproduces when
  the item is both over-cap and the LLM path is down."*
- **If any sweep/progress counter is built** — precedent:
  `server/__tests__/value-summary-tick.test.js`'s
  `describe("value-summary-tick: B2 blocker fix (errored sweep preserves
  pending_after_sweep)")` and `describe("value-summary-tick: T-C instrument
  (pending_after_sweep re-derived, not decremented)")` (both confirmed
  passing, see §1.3). New spec needs the same two assertions transplanted:
  a failed round does not zero/clobber the last known-good progress number,
  and the number is computed fresh each round, never decremented from a
  cached prior value.
- **Header-comment discipline** — §9.1's 2026-08-05 standing check, restated
  under §9.8 for broadcast/never triggers: grep any new/changed file headers
  or JSDoc for "never", "can only", "impossible", "always" and treat each as
  a claim requiring its own test. Do not let a new `sessionSummaryStatus.js`
  (or equivalent) ship a comment claiming a state transition "can never"
  happen without a red-then-green test proving it.

---

## 2. §9.1 DERIVED-DUAL-VIEW — does it bind this build?

**Plain answer: not yet, but the build must act as if it will.** §9.1's
acceptance criterion — *"same field, same value, across every consumer of a
given [derived value], enforced by a cross-consumer test"* — is, by the
catalog's own retraction precedent (2026-08-02, trunk-drift-detection:
*"is there a single value multiple sites should agree on? If not, it is not
this pattern"*), **meaningless with a single consumer**. Today this feature
has exactly one consumer, `SessionDetail.tsx`. A cross-consumer test with
only one consumer to compare against zero others is a §9.3 VACUOUS-GUARD —
it would assert nothing and could not fail. **Do not write a cross-consumer
parity test yet; there is nothing to compare it against.**

However, §9.1's own repeated lesson (stated first 2026-08-01, re-confirmed
2026-08-02, and again by the request brief itself) is that **the failure
lands when consumer #2 appears, not at introduction** — and this brief
pre-flags the second consumer explicitly: "if the session summary is ever
also rendered as a Board-card badge or similar, this applies from that
second consumer's day one." That is exactly the design-time pre-flag shape
§9.1 has recorded five times before shipping a real duplication once
(count 7 → the 2026-08-05 `altitude-invalidation` occurrence) and catching
a near-miss twice more in review.

### What must be written now, before there is a second consumer

Per §9.1's own "How to comply" clause — *"if client-side duplication is
genuinely unavoidable, document it in the introducing file's own header the
way `client/src/lib/windowedTotals.ts` does: name the risk explicitly,
explain why extraction wasn't possible, and state the bound"* — and per the
2026-08-01 design-time pre-flag's instruction (*"each computation must be
written as a single shared function on day one, before any second consumer
exists"*):

1. **The summary fetch/format logic must be written as a single exported
   function or hook from day one** (e.g. a `useSessionSummary(sessionId)`
   hook, or a `formatSessionSummary()` pure function alongside the
   API-fetch logic) — even though `SessionDetail.tsx` is the only caller
   today. Do **not** inline the fetch/status-render logic directly in
   `SessionDetail.tsx`'s JSX/component body in a way a future Board-card
   consumer would have to copy rather than import.
2. **An explicit extraction-boundary note belongs in that function/hook's
   own header comment**, `windowedTotals.ts`-shaped: name that this is the
   single canonical computation of "this session's stakeholder summary and
   its status," state plainly that any future consumer (the pre-flagged
   Board-card badge named in this brief) must import it rather than
   re-derive it, and — if any genuinely unavoidable client-side
   re-derivation is later needed (e.g. a lightweight badge that can't afford
   the full hook's payload) — that future code must state the bound on how
   far it's allowed to diverge, the way `windowedTotals.ts` bounds its
   re-slice at "≤1 chunk (10 min) at a window boundary." This is a
   documentation/structural requirement to land **in this build**, not a
   test.
3. **No test is owed yet under §9.1's own criterion** — writing one now
   would be structurally incapable of failing (single consumer,
   `deepEqual(f(X), f(X))`), which is the exact shape §9.1's 2026-08-06 note
   calls out as "the shape that made `value-coverage-parity.test.js` the
   vacuous guard in the immediately preceding slice." **What is owed is a
   tripwire, not a test:** a dated note (in this build's `decisions.md` or
   equivalent, or a code comment citing this entry) stating that the day a
   second consumer of the session summary is added — the Board-card badge or
   anything else — a cross-consumer test (structural precedent:
   `client/src/components/__tests__/FocusReportModal.test.tsx`'s
   `[standing template]`/`[board-mode extension]` pattern, or the
   server-side `reconciliation-full-tick.test.js` Scenario C byte-parity
   shape if the second consumer is server-rendered) becomes MANDATORY before
   that consumer merges, not optional. That is the concrete action that
   stops this from becoming the 8th occurrence when the badge lands — a
   named, dated trigger with no ambiguity about whether it fired.

---

## 3. Regression coverage confirmed for this pass

Both precedent test suites this build is told to clone from were run
directly (not assumed from the catalog text) to confirm they are green
today, since this feature's correctness depends on that precedent still
holding:

- `node --test server/__tests__/value-summary-tick.test.js` — the
  `pending_after_sweep` re-derivation tests (`T-C instrument`) and the `B2
  blocker fix` tests **pass** (`tick 1`/`tick 2` re-derivation, `pool grows
  85→88; pending_after_sweep re-derived to 8`, both `B2 blocker` cases).
  One **unrelated** failure exists in the same file
  (`S1 should-fix (sweep rotation advances even on bookkeeping failure)`,
  `"rotation timestamp advances even if the audit-log write fails"`) — not
  a §9.1/§9.8 concern, out of this pass's scope, flagged here only so it
  isn't mistaken for something this feature broke.
- `cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
  -t "T-E"` — `"an out-of-registry states value warns and does not
  masquerade as an old-server absence (T-E)"` **passes**.
- `node --test server/__tests__/single-writer-guard.test.js` — passes,
  confirming the structural single-writer-guard shape this feature's new
  cache-write path (a new `sessions`-adjacent summary table) should be
  guarded by if it ends up with more than one write composer (see §9.1's
  "How to comply" — extend `single-writer-guard.test.js` rather than hand-
  rolling a second structural scan, per §9.7).

Full regression coverage for the rest of the feature (transcript-summary
prompt correctness, DB migration for the new cache table, WebSocket event
delivery, "generating → result" transition without reload) is explicitly
**out of scope for this pass** per the director's narrowed mandate and is
deferred to the follow-up QA pass at build time.

---

## 4. Test data / fixtures

- A mock/stub summary-status API response fixture with a status value
  **outside** the eventual `SESSION_SUMMARY_STATES`-equivalent registry
  (e.g. `"bogus"`), for the Trap-E-shaped client test.
- A second fixture with **no status field present at all**, to prove the
  old-server/no-status case renders and logs distinguishably from the
  malformed-value case above (both must fail into the same *visual*
  fallback but must be **distinguishable** by the warn-signal test).
- If a background/sweep mechanism is built: a fixture round where the
  synthesis step throws (simulating spawn/CLI failure) with a non-zero
  prior progress count already recorded, to prove the errored round
  preserves rather than zeroes it — direct transplant of
  `value-summary-tick.test.js`'s B2 blocker fixture shape.
- A truth-table fixture set combining "not cached" × "LLM
  available/unavailable" × (if applicable) "queued behind other sessions,"
  mirroring `value-summary.js`'s DEC-11 Cases 1–5, including the explicit
  "never in both, never in neither" partition case.

---

## 5. Definition of Done (§9.1 + §9.8 only — narrowed scope)

- [ ] Session-summary status is a closed, named, exported enum (≥3 states:
      generating / queued-if-applicable / unavailable), not a boolean or
      bare `undefined`/`null`.
- [ ] Client rendering of an out-of-registry status value is
      **distinguishable-by-test** from the "no status field / old server"
      case, even though both share the same safe visual fallback — proven
      by a `console.warn` (or equivalent) assertion, structural twin of
      `PlanLedgerPanel.test.tsx`'s T-E test.
- [ ] If any cross-round progress counter exists in this build's scope, it
      is re-derived from live input every round (never decremented) and an
      errored round preserves rather than zeroes the last known-good value
      — structural twin of the B2-blocker / T-C-instrument tests.
- [ ] Any new composer combining "cache state" × "LLM availability" ×
      (if applicable) "budget/queue" is tested on the **combination**, not
      one test per dimension — DEC-11-truth-table-shaped.
- [ ] The session-summary fetch/format logic is a single exported
      function/hook, not inlined per-consumer, even with only one consumer
      today.
- [ ] That function/hook's header comment names it as the canonical
      computation and instructs future consumers (naming the pre-flagged
      Board-card badge explicitly) to import rather than re-derive —
      `windowedTotals.ts`-shaped.
- [ ] A dated tripwire (decisions log or code comment) states that adding a
      second consumer of the session summary makes a cross-consumer parity
      test MANDATORY before that consumer merges — so §9.1 does not recur
      silently when the Board-card badge lands.
- [ ] No cross-consumer test is written this round (would be vacuous with
      one consumer) — confirmed as an intentional omission, not an
      oversight, by the tripwire above.
