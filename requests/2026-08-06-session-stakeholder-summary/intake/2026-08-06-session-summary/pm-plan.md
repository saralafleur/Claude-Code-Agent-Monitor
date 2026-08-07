# PM Plan — AI-generated stakeholder summary card for session transcripts

**Mode:** FAST (auto-pilot + direct). Scoped accordingly: classification,
history, recurrence diagnosis, the rulings the evaluators left contradictory
or under-decided, and the cycle-breaker. Not a full PM essay.

**Date:** 2026-08-06 · **Repo:** `Claude-Code-Agent-Monitor` ·
**Intake:** `requests/2026-08-06-session-stakeholder-summary/intake/2026-08-06-session-summary/`

---

## 1. Request summary

Sara wants a fast, non-technical read on "what did we do / what's next" for a
session without reading the raw transcript. When she opens a session that has
no cached summary, a card above the transcript should say it's preparing, then
flip to the generated summary — reusing the existing `claude -p` CLI-spawn path
(`runClaudePromptJson`) and the shape of the already-merged Value Pool
`value-summary` feature, not a new LLM-invocation path. Concretely: a new
server synthesis module, a new `session_summaries` cache table, a new
`POST /api/sessions/:id/summary` route, a WS completion event, and a new card
in `SessionDetail.tsx` above `ConversationView`.

---

## 2. Request type — **`new-feature`** (triage's provisional call UPHELD)

Net-new capability on a surface that has never had it: no existing column, no
existing route, no existing card, no prior approved requirement this falls
short of. The product owner searched `PROJECT-CONTEXT.md` and the existing
`decisions.md` trail for any prior session-summary commitment and found none;
I re-checked the request-log and decision-log and agree — there is nothing here
we were supposed to have built and didn't.

Explicitly **not** the other classes:
- Not `missed-requirement`, which is where the four immediately preceding
  intakes on this surface landed (`value-summary-tick`, `altitude-invalidation`
  2026-08-04; `personal-company-status-email-exclude`; and see §3). Those were
  our-cost because a shipped capability had a defect designed into it. Nothing
  shipped here yet.
- Not `bug`/`regression` — nothing worked and broke.

**Two our-cost carve-outs, named so they are not silently absorbed into this
new ask or silently dropped:**

- **C-1 — a live, intermittently RED guard on `master`, in exactly the test
  family this build is told to transplant.** `intake-qa` reported "one
  unrelated failure" in `server/__tests__/value-summary-tick.test.js`. I ran
  the file four times. It is **flaky, not consistently red**: 0 leaf failures
  on two runs, 1 on two runs, and on one run a *second* test in the same family
  failed the same way. Both failures are `notStrictEqual` on ISO-8601
  timestamps where `expected === actual` to the millisecond — i.e. the
  assertion "the rotation timestamp advanced" loses to clock resolution, not to
  a product defect:
  ```
  not ok 1 - rotation timestamp advances even if the audit-log write fails
    error: 'rotation timestamp advanced despite audit-log write failure (S1 fix)'
    expected: '2026-08-06T19:53:26.731Z'
    actual:   '2026-08-06T19:53:26.731Z'
    operator: 'notStrictEqual'
  ```
  and, on one run, the same shape inside `B2 blocker fix (errored sweep
  preserves pending_after_sweep)`. These are the §9.8 B2-blocker / T-C-instrument
  guards — the ones `qa.md` §"Test precedent" instructs this build to
  **transplant verbatim** if it ever grows a progress counter. Our cost to fix
  (it is Slice-2 debt, not this request's), and a hard instruction for this
  build: **do not copy the `notStrictEqual(timestamp)` assertion shape.** Per
  §9.3, a guard that goes red for a legitimate reason gets weakened rather than
  fixed; a guard that goes red *intermittently* gets ignored, which is worse.
- **C-2 — process debt, not scope:** this run has **no `decisions.md`**, while
  `architect.md` names five distinct rows it says are required (background-sweep
  deferral, stale-but-served divergence, manual-regenerate deferral, hook-extraction
  trigger, concurrency-cap revisit) and `qa.md`'s DoD requires a sixth (the §9.1
  tripwire). See PM-4 — this is the same gap, in the same form, that this
  project already converted into a hard gate once.

---

## 3. History / background — have we seen this before?

**The feature: no. The lineage: yes, five times in nine days, all on the same
LLM-synthesis surface this one clones.** Timeline from the request-log and this
repo's own record:

| Date | Intake | Class | What it left behind that this request inherits |
|---|---|---|---|
| 2026-08-02 | `plan-lifecycle-value-ledger` | new-feature | The Value Pool + `value_unit_summaries` cache shape |
| 2026-08-04 | `value-summary-tick` | **missed-requirement** | `value-summary.js`'s 40-cap shipped with a false rationale comment; **promoted §9.8 OVERLOADED-ABSENCE** to the catalog; cycle-breaker = a `decisions.md` hard gate before build |
| 2026-08-04 | `altitude-invalidation` (slice 1) | **missed-requirement** | §9.1 **occurrence 7**: `unitFacts` grew a field `compareUnitInputs` didn't compare, under a JSDoc claiming that was "physically impossible" |
| 2026-08-05 | `coverage-on-demand` (slice 2) | new-feature | Trap E's cure (`AltitudeText` + its T-E test), SF-6 (a terminal state silently never broadcast), SF-4 (two hand-copied route compositions) |
| 2026-08-06 (01:53) | DEC-10 closed by **Sara directly** | — | Real 40-unit calibration; **sonnet pinned for both synthesis stages**, haiku rejected |
| 2026-08-06 | `auto-group-proposal` (slice 3) | new-feature | **Build in flight, not landed.** Edits `server/lib/value-summary.js` — the same file this request edits |
| 2026-08-06 | **this request** | new-feature | — |

So: **the request is new; the surface is the most-worked, most-defect-catalogued
surface in the repo**, and this is the sixth intake against it in nine days.
Both catalog entries the brief names are real and current: **§9.1
DERIVED-DUAL-VIEW at count 7**, **§9.8 OVERLOADED-ABSENCE at line 1645** — and
§9.8's *live evidence #1 is the exact file we are being told to model on*.

**Evaluation caught and corrected a request-brief assumption — this is the
process working, not scope creep.** The brief proposed a simplification:
sessions are append-only once ended, so "generate once, never invalidate" is
enough. `intake-architect` §4.2 overturned it **on direct evidence**, and I
re-verified: `server/db.js:2306` defines `reactivateSession`
(`status='active', ended_at=NULL`), called live from `server/routes/hooks.js:397`,
`:1063`, `:1400`. A session's `ended_at` is not stable, so a summary generated
at the first ending would describe superseded work — the exact failure a
stakeholder-facing "what's next" cannot survive. Accepting the correction costs
one snapshot column (`input_ended_at`) plus one positive-control test. **Adopt
the architect's version; the brief's default must not ship.**

---

## 4. Recurrence diagnosis

**The feature is not a recurrence. The *shape* is, and it recurs in a specific
direction the evaluators have not fully closed.**

§9.8's own most recent lesson (2026-08-05, SF-6) is: *"a registry closes the
state **shape**; it does not close the **delivery** of a state."* Slice 2 built
a perfect closed registry and still dropped a terminal state on the wire, so an
open tab froze at its last value forever — no error, no retry, no signal.

This design is **more** exposed to that than Slice 2 was, because the architect
deliberately (and correctly, §5.1) made the request path fire-and-forget: the
terminal state now reaches the user **only** over the WebSocket. That creates a
delivery gap Slice 2 did not have and no evaluator named:

> If generation completes between the `POST` returning `generating` and the
> client's `useEffect` subscribing to `session_summary_updated`, the terminal
> event is broadcast to nobody and the card renders "preparing…" **forever**.

That is SF-6 one layer over — same failure (a distinguishable outcome collapsed
into the same absence as "nothing happened"), same invisibility, same
"structurally cannot be observed by a suite that always seeds the subscription
first." It is aggravated by StrictMode's double-invoke (the architect's own
§5.1(2)) and by the fact that `architect.md` §5.3 asserts the broadcast
discipline holds *"by construction"* — which is precisely this project's
recorded tell (§9.1's standing check: *grep new headers for "never" / "can
only" / "always" — each is a test someone has not written yet*).

**Systemic cause, stated plainly:** each build on this surface closes the layer
where the *previous* build was burned, and the next failure appears one layer
further out — composer (2026-08-04) → route (2026-08-04) → sweep-state table
(2026-08-04) → broadcast trigger (2026-08-05) → **transport/subscription race
(this build, predicted)**. The catalog's cure has always been written against
the layer that just failed. Nothing has ever asserted the invariant *end to
end*, from "the server decided a terminal state" to "the mounted component
rendered it."

---

## 5. Where this is coming from

- **Root source: a genuine new ask from Sara**, unprompted, driven by real
  friction (reading transcripts to find out what happened).
- **Not** a changed requirement, drift, or a misunderstanding.
- **One real misunderstanding inside the request**, already correctly handled:
  "the individual person's card" names nothing in this codebase (PO verified —
  zero matches for `PersonCard`/`AssigneeCard`). Read as shorthand for the
  existing session-open flow. Cheap to invalidate later; see PM-8.
- **One factually wrong premise in the brief**, caught by evaluation:
  the append-only session assumption (§3 above).

---

## 6. Recommendation to the human

Approve the feature. Six rulings, in priority order.

### PM-1 — Model tier: **OVERTURN the architect's "haiku, confirmed."**

`architect.md` §4.3 recommends `haiku` as the confirmed default for a new
`summaryModel("session")` stage. **Less than 24 hours earlier, on 2026-08-06
at 01:53, Sara personally decided the opposite for this exact synthesis
family** (commit `c233a36`, closing DEC-10 / AC-6): a real 40-unit calibration
was run, Sara reviewed the side-by-side output, and **sonnet was pinned for
both stages**, with haiku rejected as *"topically correct but relationally
flat"* and less reliable on timing. Cost was explicitly recorded as **not** the
driver.

This is a settled decision, and I am not re-litigating it — I am flagging that
the auto-decision silently reintroduces the option it declined. The mechanism
is subtle and worth naming, because it will recur: `summaryModel()` resolves a
per-stage env var first, then the shared chain, then falls through to a
**hardcoded `"haiku"`**. Sara pinned `..._UNIT_MODEL` and `..._GROUPING_MODEL`.
A new `"session"` stage arrives with **no** pin, so it inherits the literal
fallback — i.e. *adding a stage to the registry silently opts that stage out of
the decision Sara just made.*

**Ruling:** default the session stage to **sonnet**
(`DASHBOARD_VALUE_SUMMARY_SESSION_MODEL=sonnet`, documented in `.env.example`
alongside the other two), reversible by env var exactly as DEC-10 promised. And
fold the tier check into work the PO already requires at zero extra cost:
`product-owner.md` AC-5 already mandates a **human read of real generated
output against a real transcript** before this is done — run that spot-check
**side-by-side haiku vs sonnet on the same session** and let the result stand
as this stage's calibration record. Haiku's recorded weakness (no cross-unit
relational awareness) may genuinely not transfer to a single-session summary —
that is an argument for *measuring*, not for assuming.

### PM-2 — §9.1 extraction: the architect and QA **contradict each other**; QA wins

- `architect.md` §6: *"do not extract a `useSessionSummary` hook now"* — keep
  the logic inline in `SessionDetail.tsx`, with the cut line named in prose for
  whoever adds consumer #2.
- `qa.md` §2 + DoD: *"the session-summary fetch/format logic is a single
  exported function/hook, not inlined per-consumer, even with only one consumer
  today."*

Both cite §9.1 correctly; they disagree on the remedy. **Resolve in QA's
favour**, on this entry's own most recent recorded lesson (§9.1, 2026-08-05,
lesson 1): *"A pre-flag is not a guard… Prose in the catalog does not enforce;
only an assertion enforces."* The architect's remedy is a pre-flag written in a
document that stops being read — the identical shape that has now failed on
this entry three times. §9.1's 2026-08-01 pre-flag language is unambiguous:
*"each computation must be written as a single shared function on day one,
before any second consumer exists."*

**Ruling:**
1. Extract `client/src/hooks/useSessionSummary.ts` **in this build** (fetch +
   state + WS subscribe, returning `{state, summary, reason}`). One consumer
   today; the cost is a file boundary, not a formula duplication.
2. **No cross-consumer parity test this round** — with one consumer it degrades
   to `deepEqual(f(X), f(X))`, the exact vacuous shape §9.1's 2026-08-06 note
   names. The architect and QA already agree here.
3. A **dated tripwire row** in `decisions.md`: the day a second consumer is
   scheduled, a cross-consumer test is MANDATORY before it merges.
4. The hook's header carries the `windowedTotals.ts`-shaped canonical-computation
   note QA specifies — and it must **not** contain "never"/"impossible"
   language it cannot prove (§9.1 standing check).

### PM-3 — §9.8: close the **delivery** layer, not just the state shape

Endorse the architect's four-state contract
(`resolved`/`generating`/`queued`/`unavailable` + mandatory `reason`) and the
explicit Trap E cure in the renderer (§5.4) — both are right and both are
better than a copy of `AltitudeText`.

**Add, per §4's diagnosis, and treat as MANDATORY:**
- **A subscribe-before-request ordering guarantee, or a bounded re-read.** The
  client must subscribe to `session_summary_updated` **before** issuing the POST,
  **or** re-read the summary once on a short bounded timer after entering
  `generating`. Then assert it: a test in which the terminal broadcast fires
  *before* the component's subscription and the card still resolves. Slice 2's
  SF-6 was invisible precisely because every test seeded the subscription first.
- **Delete or prove the "by construction" claim** in `architect.md` §5.3
  ("a broadcast is only ever a terminal transition… by construction"). Either
  there is a loop that proves it, or the comment says "should," per §9.1's
  standing check.
- **Combination testing, not one-test-per-branch** — DEC-11-truth-table-shaped,
  per `qa.md`. The specific combination to force here is *cache-miss × LLM down
  × at the concurrency cap*, which is where "queued" and "unavailable" are most
  likely to collapse into each other.

### PM-4 — Cycle-breaker: `decisions.md` is a **hard gate before the first line of build code**

This is the cure this project already adopted once for this exact surface
(`value-summary-tick`, 2026-08-04: "architect flagged all three forks as
disclosed-but-untracked with no `decisions.md` row; converted into a hard gate
— DEC-1..DEC-9 + WATCH-1..3 + OPEN-1/2 must exist before the first line of
build code"). It worked. **It was not applied here, and the same condition is
already present**: `architect.md` names five deferrals that exist only as
sentences in a document, and there is no `decisions.md` in this intake folder.

**Required rows before build starts** (this is the whole cycle-breaker; it is
cheap and it is the only mechanism this project has evidence of adopting):
`DEC` — model tier (PM-1) · `DEC` — on-demand only, background sweep deferred ·
`DEC` — stale/reactivated sessions report `unavailable` rather than
stale-but-served · `DEC` — no manual regenerate this round ·
`DEC` — hook extracted now (PM-2) · `WATCH` — cross-consumer test MANDATORY at
consumer #2 · `WATCH` — `MAX_CONCURRENT_SESSION_SUMMARIES = 2` is a guess;
revisit against measured use · `WATCH` — C-1 flaky timestamp guards on `master`.

### PM-5 — Sequencing: **do not start this build until Slice 3's build lands**

Verified live: `auto-group-proposal` (Value Pool Slice 3) was intaken today and
its build is **in flight, not landed** — `git status` on `master` shows its
build docs modified/untracked and **zero source changes**. Its
`technical-plan.md` edits `server/lib/value-summary.js` (builds `groupingFacts`
on the exported `unitFacts`, registers a new `CONSUMERS` entry). This request
also edits `server/lib/value-summary.js` (`SUMMARY_STAGES` at line 107,
`summaryModel`). Same file, two unlanded plans.

`PROJECT-CONTEXT.md`'s planning note ("Intake throughput can outrun build
throughput, and the working tree pays for it") states the rule as *do not intake
slice N+1 until slice N's build has landed*. This is a different request, so
the letter doesn't bind — **the hazard is identical and does**. Finishing this
intake is fine and useful; starting the build is not. Land Slice 3 first.

### PM-6 — Adopt the architect's reactivation-invalidation finding as designed

Including its positive-control test (seed a resolved summary → reactivate the
session → assert the next read is a cache **miss**, not stale-served). This is
the load-bearing new invariant in the build and it is the one the brief got
wrong.

### Cost/scope framing

**All of the above is inside this new ask** except: **C-1** (flaky `master`
guards — Slice-2 debt, our cost, small) and the `SUMMARY_STAGES`/WS-union
registry entries, which are shared-infrastructure edits this feature legitimately
pays for as its first real consumer. There is **no missed-requirement carve-out**
in this request — a first for this surface in five intakes.

---

## 7. Open decisions for the user

1. **Model tier (PM-1) — needs Sara, non-blocking to start.** Confirm sonnet as
   the session-stage default (consistent with your 2026-08-06 DEC-10 call), and
   confirm you're willing to eyeball one haiku-vs-sonnet side-by-side on a real
   session transcript as part of the AC-5 register check. If you'd rather just
   pin sonnet and skip the comparison, say so and we'll pin it.
2. **Surface read (PO §5.1) — one sentence, non-blocking.** "The individual
   person's card > Sessions > expand a session" matches nothing in the app; we
   read it as the existing `SessionCard → SessionDetail → Conversation tab`
   flow, card mounted above the transcript. Confirm — if you actually pictured a
   *rollup across several sessions for one agent/person*, tell us now, because
   that is a different surface (and it would instantly create §9.1 consumer #2,
   changing PM-2's cost).
3. **Sequencing (PM-5) — needs your call.** Slice 3's build hasn't landed and
   touches the same file. Recommend: land Slice 3, then build this. Say the word
   if you want them interleaved anyway and we'll plan the merge explicitly rather
   than discovering it.
4. **Background sweep** stays deferred (on-demand only). Flagging so scope isn't
   quietly narrowed without you: pre-generating summaries for ended sessions is a
   real fast-follow, not a maybe.

---

## 8. Memory updated

- Appended a row to `~/.claude/skills/team-intake/memory/request-log.md`.
- `PROJECT-CONTEXT.md`: added **design-time pre-flag** notes to **§9.1** and
  **§9.8** — *NOT occurrences, counts unchanged at 7 and unchanged respectively*,
  per this project's existing convention that a pre-build catch is a pre-flag,
  not an occurrence.
