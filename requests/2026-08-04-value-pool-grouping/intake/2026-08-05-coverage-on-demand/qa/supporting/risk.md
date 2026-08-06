# Risk & Regression Analysis — coverage-on-demand (Value Pool Slice 2)

**Analyst:** qa-risk-analyst · **Date:** 2026-08-05 · **Commit evaluated:** `4c2e931`
(merged to local `master`, parent `b38b4a1` = Slice 1 altitude-invalidation)
**Grounded against (read in full before writing this):** `PROJECT-CONTEXT.md` §9
(defect catalog, esp. §9.1, §9.3, §9.7, §9.8, the new STRICTMODE-BLIND CLIENT SUITE
candidate), `qa/change-brief.md`, `technical-plan.md`, intake `decisions.md`
(DEC-1..DEC-11, WATCH-S2-A..F, OPEN-S2-1), build `decisions.md` (DEC-1..DEC-3, the
SF-4/6/7/8/9/10.2/N1/N2 disposition table), `supporting/review-findings.md`
(2 blockers, 11 should-fix, 5 nits), and direct reads of the shipped code
(`server/routes/project-plans.js`, `server/lib/value-summary-tick.js`,
`client/src/components/PlanLedgerPanel.tsx`, `server/__tests__/value-coverage.test.js`)
to confirm every named risk below is still live at `4c2e931`, not stale from review.

**Verified live at HEAD (not just "found in review"):** BL-1 and BL-2 (the two
blockers) and SF-1/SF-2/SF-3/SF-5 are fixed in the shipped diff — confirmed by direct
read (`isDrainingProject` is real and threaded at both routes; `mountedRef` is
re-armed in setup; the tick's comment at `value-summary-tick.js:205-214` explicitly
disclaims posing as the single home). The six risks this task calls out
(SF-4, SF-6, SF-7, SF-8, SF-9, N1/N2) are confirmed **still present, unfixed, and
knowingly deferred** per build `decisions.md` DEC-3's disposition table.

---

## 1. Blast radius

Beyond the literal diff (`server/db.js`, `server/lib/value-coverage.js` [new],
`server/lib/value-summary.js`, `server/lib/value-summary-tick.js`,
`server/routes/project-plans.js`, `client/src/lib/{types,api}.ts`,
`client/src/components/PlanLedgerPanel.tsx`, 4 locale files):

- **`server/lib/value-coverage.js` is a new, third-consumer node on the
  `value-summary.js` export graph** (`MAX_UNITS_PER_PROMPT` import), sitting beside
  the existing two (`routes/project-plans.js`, `lib/value-summary-tick.js`). Its own
  guard (`single-writer-guard.test.js`'s `assertSingleHome("../lib/value-summary", …)`)
  was **not** updated for it (SF-5, fixed in review loop-back per DEC-3's table
  showing SF-5 fixed — confirm this at build time, it is listed among the fixed set,
  not the deferred set). The general lesson still applies to any future consumer:
  the consumer-axis of `assertSingleHome` remains hand-typed (§9.7 occurrence 7,
  logged 2026-08-05 in this very build) — a fourth consumer (Slice 3, `ccam`, MCP)
  is invisible to the guard by construction.
- **`coverageSnapshot()` / `estimateEta()` in `value-coverage.js` are the single
  contractual source for `described`/`pool_size`/`pending`/`complete`/`demand`/`eta`.**
  Everything downstream of that object — the HTTP route JSON, the WS broadcast
  payload, `PlanLedgerPanel`'s render, and (named explicitly in DEC-2) **Slice 3's
  Auto-group gate**, which is designed to be a "pure read of one server field" —
  inherits any defect in this module's inputs. The composer's `counts` (from
  `enrichPoolAltitudes`) is therefore also in the blast radius: Slice 1's
  fresh-or-immutable classification feeds this slice's coverage arithmetic
  directly (DEC-1's "described ≠ displayed" is architecturally coupled to Slice 1's
  cache/staleness logic).
- **`value_summary_sweep_state`** (schema) and **`value_summary_generation_log`**
  (audit) are shared tables read/written by both the passive tick and the new
  drain path, and by `listValueSweepTargets`'s widened `ORDER BY` — a regression
  in the new leading term risks corrupting **passive rotation ordering for every
  unflagged project**, not just the flagged one (mitigated by the "passive ordering
  byte-identical" acceptance criterion, which review confirmed clean).
- **The WS `value_altitudes_updated` message** is a shared wire contract. Any open
  tab on **any** project subscribes to the broadcast; widening its payload and its
  trigger condition (DEC-6) changes behavior for every existing subscriber, not
  just `PlanLedgerPanel`'s new one — worth confirming no other client-side listener
  assumes the old, narrower `generated > 0` trigger semantics.
- **`PlanLedgerPanel.tsx`** is rendered unkeyed at `ProjectDetail.tsx:1292`, so its
  internal state (`coverage`, `altitudes`, `requestedAltitudesRef`) is
  **project-instance-shared** across a project switch — this is the mechanism
  behind SF-8, and it means *any* future state this component gains inherits the
  same cross-project leak risk unless the component is explicitly reset or keyed.
- **`docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`, `server/README.md`**
  are all downstream consumers of the same contract in prose form — confirmed
  accurate by the build's own reviewer, but any future drift here re-opens the
  CONTRACT-SPEC-DRIFT candidate pattern (`PROJECT-CONTEXT.md`, not yet promoted).
- **Model-tiering plumbing (`summaryModel(stage)`, `SUMMARY_STAGES`)** is inert in
  this slice but is Slice 3's grouping-tier gate (AC-6). Its blast radius is
  currently zero (both stages resolve to `haiku`) but the moment Slice 3 pins a
  `grouping` default without AC-6 closing first, grouping silently runs on the
  wrong tier — this is a named, gated dependency (DEC-2 in build `decisions.md`),
  not speculative.

## 2. Invariants that must hold

This project has a configured defect-class catalog (`PROJECT-CONTEXT.md` §9);
citing its ids directly rather than reasoning from scratch.

- **§9.1 DERIVED-DUAL-VIEW — cross-path consistency.** The entire design of this
  slice is "one `coverageSnapshot` object, carried verbatim by HTTP and WS." The
  catalog's own twice-proven lesson: the guard that must catch this has to fail on
  a **second computation**, not just a second read. This slice's own MANDATORY
  guard (`value-coverage-parity.test.js`) was *itself* the vacuous instance this
  round (BL-1, fixed) — proof that this invariant is exactly as hard to actually
  pin as the catalog says. **SF-1 is the residual live instance one layer down:**
  the tick computes its own `pending` (`queued + unavailable`) at
  `value-summary-tick.js` for internal bookkeeping, and while the fix comment now
  disclaims it feeding the wire, the *fact* that a second `pending` computation
  exists in the tick at all is the exact shape §9.1 warns about — worth an
  explicit "these agree structurally, not by convention" test, not just a comment.
- **§9.3 VACUOUS-GUARD, sub-pattern "the guard is the vacuity."** Newly logged from
  this exact build. Any guard whose fixture makes its own comparison branch
  unreachable (an `if (artifact) {…} else {self-computed fallback}` shape) is
  worse than no guard — it certifies a defect class as closed while leaving it
  open. **SF-7 is a live, still-shipped instance of the classic form**
  (existence-only assertions under mechanism-promising titles in
  `coverage-smoke.test.js`) and its risk is exactly what the catalog names:
  "the next change reads the checkmark and stops looking."
- **§9.7 HAND-SCOPED STRUCTURAL SCAN.** `assertSingleHome`'s consumer axis is
  hand-typed; N2's `STATE_TO_LOCALE_KEY` in `value-coverage.test.js` is a second,
  narrower instance — an enumerated exception map that `continue`s silently on an
  unmapped member instead of failing closed. Both are the same generalizable
  defect: a scan that reads as "derived" because one axis is, while the other
  axis is still hand-maintained.
- **§9.8 OVERLOADED-ABSENCE.** `demand` (`passive`/`requested`/`draining`) and
  `eta.state` (`measured`/`estimating`/`none`) are closed, server-authored
  registries specifically designed to satisfy this invariant (never collapse
  "not yet attempted" into "unavailable" into "complete"). **SF-3's original gap
  (draining unreachable from either route) is fixed**, but **SF-6 is a live
  residual instance**: a project's first observation in a process lifetime with
  `generated === 0` is treated as "no transition" even when `complete === true`,
  so the wire can go silent on exactly the transition (`→ complete`) this
  registry exists to report honestly. This is §9.8's "never zero" direction,
  reproduced at the *broadcast-trigger* layer rather than the *state-shape* layer
  the registries themselves already close.
- **§9.2 row-id-as-chronology-proxy.** Verified clean for this change (both new
  duration-log statements sort `created_at DESC, id DESC` before `LIMIT`,
  mutation-proven). Not at risk from this slice specifically, but N1 (ETA ignores
  `generated`, extracting a column it never uses) is the same family of defect
  as §9.1's "dropped assertion leaves a fingerprint" — a value pulled from the
  query and never consumed is worth treating as a live signal that a computation
  is incomplete, not just a nit.
- **Round-trip / no-decrement integrity (WATCH-8, this catalog's own convention,
  not yet numbered).** `pending` must be **re-derived from live input each round**,
  never decremented — verified correct in the drain loop (pool-growth case
  proven). The client-side analogue is **SF-8**: `mergeCoverage`'s monotonic
  `computed_at` rule was built to prevent *regression*, and instead — because the
  component is unkeyed on `projectId` — it can **permanently reject a legitimate
  new snapshot** because it is compared against a stale value from a different
  logical entity (a different project) that the merge rule was never designed to
  discriminate against. This is a round-trip/isolation invariant violated by the
  very mechanism built to protect a different invariant.
- **No-leak-at-boundary — isolation across variants (project A/B).** SF-8 is,
  independent of the merge-rule framing above, a straightforward **cross-tenant
  (cross-project) data leak**: project A's `described`/`pool_size` counts render
  under project B's URL/pool after a project switch. This is the general
  "isolation across variants" invariant this task's brief calls out by name, and
  it is the most user-visible of the six named risks.
- **No-leak at boundaries — partial failure isolation.** SF-9 (a failing
  `GET /coverage` blanking the whole `Promise.all`) is the general
  "no single field should have veto power over unrelated content" invariant —
  progressive-enhancement data must fail independently of core data.

## 3. Recurring-issue mapping

This project's catalog is configured and was read first (`PROJECT-CONTEXT.md`
§9). Direct mapping of this change's six named risks:

| Risk | Catalog id | Status on this surface |
|---|---|---|
| SF-4 (dual probe-snapshot composition) | §9.1 DERIVED-DUAL-VIEW, "scan for copies of its *helpers*" corollary | **OPEN**, knowingly deferred (build `decisions.md` DEC-3). Not yet a live defect (both copies agree today), but the exact pre-condition for a future divergence — the copies **have already diverged** on one argument (`requestedAt`), which is this catalog's own tell for "the next consumer acquires a third copy." |
| SF-6 (dropped terminal broadcast on first post-restart observation) | §9.8 OVERLOADED-ABSENCE ("never zero" direction) | **OPEN**, knowingly deferred. Narrows but does not close the exact failure DEC-6 was written to prevent. The header's own claim ("can only ever SUPPRESS, never fabricate") is stated by the build's own reviewer to be **false as written** — an unevidenced invariant claim, the same shape §9.1's 2026-08-05 note calls out ("find the loop that proves it or downgrade the comment"). |
| SF-7 (existence-only smoke assertions) | §9.3 VACUOUS-GUARD, textbook example | **OPEN**, knowingly shipped. This is a live instance of the catalog's *canonical* named shape (`assert.ok(stmts.listX)`), under acceptance-criterion titles. Mitigating fact (per build's own decisions.md and independently worth re-verifying, not assuming): real behavioral proof is claimed to live in `value-summary-tick.test.js`'s exit-condition matrix, `project-plans-api.test.js` Group T, and `value-coverage.test.js`. |
| SF-8 (unkeyed panel, cross-project state leak) | Isolation-across-variants invariant (general; also a round-trip integrity violation of the R4 merge rule) | **OPEN**, knowingly deferred. No catalog id currently owns "unkeyed component state leaks across a switched entity" as a named pattern — worth flagging as a **candidate** for this catalog given the mechanism (a correctness guard, the monotonic merge, actively causing the leak once its precondition — "same entity" — is silently violated). |
| SF-9 (failing GET blanks whole panel) | No-leak/no-veto boundary invariant (general) | **OPEN**, knowingly deferred, one-line fix named. |
| N1 (ETA ignores `generated`) | §9.1 "dropped assertion leaves a fingerprint" shape, at the query layer | **OPEN**, accepted under WATCH-S2-C (ETA skew). |
| N2 (locale-key exemption set silently skips) | §9.7 HAND-SCOPED STRUCTURAL SCAN | **OPEN**, tied to WATCH-S2-F's "any Slice 3 registry growth" trigger. |

**This change also touches, without landing new occurrences in, three other
catalog surfaces** — worth naming because they are exactly the kind of place
this project has bled before with a green suite:

- **§9.1's MANDATORY parity guard was found to *be* the vacuous instance mid-build
  (BL-1)** — fixed with a route-and-tick-side red proof before merge, but this is
  the **third consecutive effort on this exact file family**
  (`value-summary-tick.js`/`value-coverage.js` siblings) to produce a §9.3-family
  event in its own MANDATORY deliverable (8 → 9 → 4 events across the last three
  builds, per the catalog's own running count). **New sub-pattern this build
  logged: "the guard is the vacuity."** A parity guard's `if (artifact) {…} else
  {self-computed fallback}` shape is a §9.3 candidate on sight — grep new guards
  for this shape before trusting them.
- **STRICTMODE-BLIND CLIENT SUITE (candidate, first occurrence, fired in this
  build — BL-2).** `PlanLedgerPanel.tsx`'s `mountedRef` bug was invisible to the
  entire client suite (RTL renders without `<StrictMode>`) and was caught only by
  a human reviewer reading the diff. **Fixed in this build for this one
  component's one effect** — the class remains open for this component's *other*
  effects (the WS subscriber effect, the coverage-fetch effect) and for every
  other client component using `useRef`+cleanup-only `useEffect`. This is
  directly relevant here because **SF-8/SF-9 both live in the same effect bodies
  BL-2 just patched** — any regression test added for BL-2 should be checked for
  whether it also exercises the coverage-fetch path, not just the altitude-fetch
  path that broke.
- **§9.4 FIX-ROUND-REGRESSION / "should-fix is a triage label, not a
  disposition."** This build is the *positive* case: all 11 should-fix items got
  a named disposition row (build `decisions.md` DEC-3) rather than silently
  dropping, which is exactly what §9.4's 2026-08-05 note (same file, same day,
  the sibling `altitude-invalidation` build) says usually fails to happen. Worth
  stating plainly: **this is the mechanism working, not a gap** — but per this
  task's own item 6, disclosure in `decisions.md` is necessary, not sufficient;
  each row still needs its own promotion trigger honored (see §6 below).

## 4. The "ships green but broken" traps

Concrete failure modes a change to this surface could introduce that would pass
the *current* suite (including the new tests this slice added) undetected:

1. **A refactor of the coverage composition adds a third hand-copy instead of
   extracting `buildProbeCoverage` (SF-4's predicted failure).** Nothing in the
   current suite asserts "there is exactly one place that assembles pool → probe
   → sweep-state read → `coverageSnapshot`." A Slice 3 consumer (or `ccam`, or an
   MCP tool) that copies the pattern a third time ships green — the
   `value-coverage-parity.test.js` guard only compares the *route's* output
   against the *tick's*, and structurally cannot see a third composition site
   agreeing with neither by construction until it diverges. **Required
   assertion:** a static single-composition-site scan (N3's fix suggestion: point
   the "no second computation" scan at `routes/project-plans.js`,
   `lib/value-summary-tick.js`, and any new consumer file), or extract
   `buildProbeCoverage` now rather than at the next consumer.
2. **A server restart (or `POST /altitudes` completing a pool between ticks)
   silently drops a "coverage finished" notification, and no test catches it
   (SF-6).** The suite tests `shouldBroadcastCoverage` against seeded prior
   state; it does not test the **absent**-prior-state case combined with
   `complete === true`. A user watching an open tab across a deploy/restart
   during an active drain would never see "100% described" — the tab hangs at
   its last-known percentage forever, with no error, no retry, no visible
   signal anything is wrong. **Required assertion:** `shouldBroadcastCoverage(pid,
   0, "requested", true)` with `lastBroadcastState` empty (fresh process) must
   return `true`. Also correct or delete the header comment that claims the
   function "can only ever SUPPRESS, never fabricate" — that specific sentence is
   now a checkable claim that is false.
3. **A future change to `POST /coverage-request` that "helpfully" removes the
   fire-and-forget drain call's error swallow ships a request-crashing
   regression, and SF-7's existence-only assertions stay green throughout**
   (they only check that the statement objects exist, not that the mechanism
   they claim to test — flag → jump rotation → drain → 100% — actually works
   end to end). Anyone reading a green `coverage-smoke.test.js` under an
   "AC-2: Coverage Request Mechanism" title reasonably concludes the mechanism
   is proven here; it is not. **Required assertion:** either delete the
   existence-only cases (they add negative value — a false sense of coverage) or
   replace them with the behavioral assertion their own titles promise.
4. **A project switch in the UI silently shows stale/wrong coverage counts, and
   no test catches it because `PlanLedgerPanel.test.tsx` never renders the
   component twice with different `projectId` props against a stale merge state
   (SF-8).** This is the single most user-visible trap in this set: a real user
   clicking between two projects in the same session, where the first project's
   pool happened to compute a later `computed_at` than the second's actual fresh
   snapshot, sees **project A's numbers permanently under project B's URL** —
   with no error, no stale-indicator, nothing to signal it's wrong. It self-heals
   only if a later WS broadcast for project B happens to have an even newer
   `computed_at` — not guaranteed, and not visible to the user either way while
   it's wrong. **Required assertion:** render `<PlanLedgerPanel projectId="A" />`,
   feed it a coverage snapshot with a later `computed_at`, then re-render with
   `projectId="B"` and a snapshot with an earlier `computed_at` — assert the
   header shows project B's counts, not project A's.
5. **A future dependency (adding a field to the Plan Ledger panel, e.g. a
   "recent activity" mini-feed) is joined into the same `Promise.all` as
   `coverage`, and one failing progressive-enhancement fetch takes down the
   entire panel again — the same shape SF-9 already is, now duplicated.**
   `PlanLedgerPanel.test.tsx` presumably tests the happy path of all four
   `Promise.all` legs succeeding; nothing forces a "partial failure isolation"
   test per leg going forward, so this trap doesn't just apply to `coverage` —
   it is a template for the next added field to repeat. **Required assertion:**
   mock `api.projectPlans.coverage` to reject and assert `plans`/`units`/`health`
   still render — this closes SF-9 today and, if written as a reusable helper,
   guards every future leg added to the same `Promise.all`.
6. **A 4th `demand` or `eta.state` value is added for Slice 3 (e.g. a `paused`
   demand state), ships with a locale key in only 3 of 4 locale files, and
   `value-coverage.test.js`'s own STATE_TO_LOCALE_KEY-driven i18n check stays
   green because the unmapped member is silently `continue`d past (N2).** The
   generic `i18n.test.ts` E1.1 whole-namespace parity scan would likely still
   catch a locale *file* missing a key it has elsewhere, but it cannot catch a
   key that was simply never written anywhere, because `STATE_TO_LOCALE_KEY`
   never asserted the new registry member needed one. **Required assertion:**
   assert `Object.keys(STATE_TO_LOCALE_KEY.demand)` (and `.eta`) is **exactly**
   the registry's real exported member list, minus a named, dated exemption set
   (currently `["passive"]`/`["none"]`) — so growth breaks the test until
   someone dispositions the new member, per the catalog's own
   `UNCOMPARED_FIELD_GUARANTORS` fix shape (§9.1, 2026-08-05).
7. **The tick's internal `pending` computation (SF-1's residual shape, now
   disclaimed by comment rather than structurally prevented) silently starts
   feeding the wire again in a future edit** — e.g. someone "simplifies" the
   broadcast payload assembly by reusing `result.pending` instead of
   `snapshot.pending` because they're both in scope and look interchangeable at
   the call site. Nothing currently asserts the wire's `pending` field is
   *sourced from* `coverageSnapshot` rather than merely *equal to* it today.
   **Required assertion:** a mutation test that changes `value-coverage.js`'s
   `pending` formula (e.g. to exclude a category DEC-1 treats specially) and
   confirms the WS payload's `pending` changes with it — proving the wire reads
   from the single home, not merely agrees with it by coincidence of shared
   inputs.

## 5. Severity & priority

Ranked by user-visibility and blast radius, worst first:

1. **SF-8 — client cross-project state leak (Critical / must-fix-now).**
   User-visible, silently wrong data attributed to the wrong project, no error
   signal, potentially indefinite ("permanently rejects" per review). This is
   the closest thing in this batch to a correctness/trust bug — a user could
   make a real decision ("prioritize now" / trust a completion percentage) off
   another project's numbers. One-paragraph fix, one test. No excuse to defer
   past this QA pass.
2. **SF-9 — failing coverage fetch blanks the whole panel (High /
   must-fix-now).** User-visible, disproportionate blast radius (progressive
   enhancement takes down core content), one-line fix. Cheap enough that
   deferring it costs more in reviewer/QA re-litigation than fixing it now.
3. **SF-6 — dropped terminal broadcast, post-restart (Medium-High /
   must-fix-now given severity, acceptable-with-a-guard on timing).** Not
   silently wrong data, but a silently stuck UI state ("estimating"/percentage
   frozen forever) with no recovery short of a manual refresh, and it directly
   undermines the acceptance criterion (AC-5, "coverage updates in place in an
   open tab") this whole slice exists to satisfy. Its trigger condition
   (process restart or `POST /altitudes` racing a drain) is realistic in this
   project's own deploy pattern (`server/lib/update-check.js` prints a restart
   command that users run). Fix is small (treat absent-prior + complete as a
   transition); should not wait for a "trigger fires" promotion event the way
   the WATCH rows do, because the trigger condition (restart) is routine, not
   exotic.
4. **SF-7 — vacuous smoke-suite assertions (Medium / acceptable-with-a-guard,
   *if* the claimed real coverage is independently verified).** Not itself a
   product defect — it's a false-confidence hazard. Its severity is
   conditional: this QA pass's own job (per the task brief) is to verify the
   claim that `value-summary-tick.test.js`, `project-plans-api.test.js` Group T,
   and `value-coverage.test.js` actually prove AC-2/AC-3 behaviorally. If that
   verification holds, SF-7 is a cosmetic/DoD-hygiene fix (delete or replace the
   existence-only cases) that can ride the follow-up `team-qa` pass. If it does
   not hold — if the real behavioral proof is thinner than claimed — this jumps
   to Critical, because it means AC-2/AC-3 are effectively unverified.
5. **SF-4 — duplicated probe-snapshot composition (Medium / acceptable-with-a-
   guard, not must-fix-now).** Not a live defect (both copies currently agree);
   its own build already assessed this correctly ("highest-value single
   follow-up," not "ship-blocking"). The risk is compounding, not immediate —
   it should be fixed **before** Slice 3 adds a third consumer, not necessarily
   in this QA pass, but a regression test asserting the two existing copies stay
   in sync is cheap and worth adding now regardless of when the refactor lands.
6. **N1 — ETA ignores batch size (Low / acceptable-with-a-guard).** Already
   accepted under WATCH-S2-C; the ETA is cosmetic (a "~X min" estimate), never
   gates a real action, and the skew direction is bounded and disclosed.
7. **N2 — locale-key exemption silently skips unmapped members (Low today,
   escalates to Medium the moment Slice 3 adds a registry member).** Zero
   current impact (the registry hasn't grown), but it is exactly the kind of
   gap that ships invisibly the day it matters (a new demand/eta state ships
   with no locale key and no test failure) — cheap to close now (one line, per
   trap 6 above) versus expensive to discover later as a real user-facing raw
   key or blank string.

## 6. Disclosed-and-declined coverage — trip-wire

Per this task's own instruction: naming a risk here is not sufficient tracking.
Cross-checking against what this project's own catalog says happens to prose-only
risk disclosures (§9.1's 2026-08-04 note: "risk.md enumerates in prose... and
nothing mechanically compares the two sets"; §9.4: "should-fix is a triage label,
not a disposition").

**Good news first:** SF-4, SF-6, SF-7, SF-8, SF-9, SF-10.2, N1, N2 **already each
have a `decisions.md` row** (build `decisions.md` DEC-3's disposition table, dated
2026-08-05, with a named consequence-if-left per item) — this build did the thing
the catalog's own history says usually doesn't happen. That table is the tracked
artifact this task's item 6 asks for; it exists.

**What is NOT yet tracked, and needs its own row before this QA pass closes:**

- **This risk.md itself introduces one new candidate pattern** (§3 above): "unkeyed
  component + a correctness-motivated merge rule causing a cross-entity leak" (the
  general shape behind SF-8). It has no catalog id today. If this QA pass declines
  to fix SF-8 immediately (it should not — see §5, ranked Critical/must-fix-now —
  but if schedule pressure defers it anyway), that decline needs its **own** dated
  `decisions.md` PENDING/WATCH row in this intake folder's `qa/` decision log, not
  just this paragraph.
- **Trap 7 (§4 above)** — "the tick's disclaimed-but-still-present internal
  `pending` computation could silently start feeding the wire again" — is a risk
  *this analysis* is naming for the first time; it has no `decisions.md` row
  anywhere. If the coverage-planning stage that consumes this brief decides not to
  add the mutation-proof test named in trap 7 this round, that decision needs a
  WATCH row with a promotion trigger (suggested: "any future edit to the WS
  broadcast payload assembly in `value-summary-tick.js`"), not just this
  paragraph.
- **The STRICTMODE-BLIND CLIENT SUITE candidate's residual scope** (BL-2 fixed one
  effect; the WS-subscriber effect and coverage-fetch effect in the same component
  are still unexamined for the same class) has a promotion trigger recorded in
  `PROJECT-CONTEXT.md` itself, so it is already tracked at the catalog level — no
  new row needed unless this QA pass decides *not* to add StrictMode coverage for
  those other two effects, in which case that specific declination should be its
  own line in this intake's QA decision log, distinct from the catalog's general
  promotion trigger.

Everything else in this document (SF-4/6/7/8/9, N1/N2) inherits its tracking from
the build's own `decisions.md` DEC-3 and does not need a duplicate row — but the
next stage consuming this brief should re-open that exact table rather than
re-deciding severities from scratch, since re-triaging from a fresh read is
exactly how §9.4's "severity-on-read was provisional" failure mode recurs.
