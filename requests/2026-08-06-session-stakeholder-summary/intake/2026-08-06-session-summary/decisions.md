# Decision Log — session-stakeholder-summary

> Every clarifying / blocking question the team raised on this request, the
> context behind it, the options offered, and the choice made. Status values:
> **PENDING** · **DECIDED** · **DECIDED-AUTO** (fast/auto-pilot, team's own
> best call, not asked) · **PARKED** · **SUPERSEDED**.

---

## DEC-1 — Model tier for the new "session" summary stage
- **Item / area:** `server/lib/value-summary.js`'s `summaryModel(stage)` cascade
- **Status:** DECIDED (Sara confirmed the PM's ruling)
- **Raised:** 2026-08-06 · **Decided:** 2026-08-06 · **Decided by:** Sara (confirming `intake-project-manager`'s recommendation)
- **Recurring-issue link:** §9.1 DERIVED-DUAL-VIEW (rogue re-derivation shape) — the underlying trap is a second model-selection path silently opting a new stage out of a tiering decision already made once.

### The question
Which model tier should the new per-session summary generation use — haiku
(architect's first recommendation, "per-session compression, not cross-session
judgment") or sonnet?

### Where we're coming from (history, as of when)
Commit `c233a36` (2026-08-06, ~01:53, ~24h before this intake) closed
DEC-10/AC-6 on the sibling Value Pool feature: Sara reviewed a real 40-unit
haiku-vs-sonnet calibration side-by-side and **pinned sonnet for both stages**,
explicitly stating cost was not the driver. `summaryModel()` only pins tier
per-stage via `..._UNIT_MODEL`/`..._GROUPING_MODEL` env vars and falls through
to a hardcoded `"haiku"` default for anything not explicitly pinned — so
adding a new `"session"` stage without pinning it silently reintroduces the
tier Sara just declined, on a different but adjacent surface.

### Options presented
- **A) haiku (architect's original call)** — cheaper, and the per-session
  compression task is arguably simpler than cross-unit grouping judgment.
- **B) sonnet, explicitly pinned** — consistent with Sara's very recent,
  explicit, evidence-based call on the sibling feature; avoids a silent
  tier regression via an unpinned default.

### Decision
**Chosen:** B — `DASHBOARD_VALUE_SUMMARY_SESSION_MODEL` defaults to `sonnet`.
**Note from decision-maker:** Confirmed by Sara at the Step 6 report-back gate
(2026-08-06) — "Sonnet (Recommended)."
**Rationale / implications:** Cheap to override via env var either way; the
risk of silently reintroducing a tier Sara just rejected outweighs the cost
delta.

---

## DEC-2 — Trigger model: on-demand vs. background sweep
- **Item / area:** session-summary generation trigger
- **Status:** DECIDED-AUTO
- **Raised / Decided:** 2026-08-06 · **Decided by:** `intake-architect`, upheld by PM
- **Recurring-issue link:** —

### The question
Should summary generation be view-triggered only (generate on session open,
show "preparing"), or should a background tick (mirroring
`value-summary-tick.js`) proactively summarize ended sessions?

### Options presented
- **A) On-demand only** — matches Sara's literal framing ("each time we pull
  in a session and it does not have that summary..."); no scheduler to build
  or tune against unknown load.
- **B) Background sweep** — better perceived latency on repeat opens, but
  `value-summary-tick.js` itself was only built after the sync path
  (`value-summary.js`) showed a measured overflow in production use — building
  a sweep now would be sizing a scheduler against zero data.

### Decision
**Chosen:** A — on-demand only for this build.
**Rationale / implications:** Background sweep remains a real, named
fast-follow (**WATCH-1**, not dropped) — revisit once on-demand usage data
exists, same sequencing this repo already used once on the sibling feature.

---

## DEC-3 — Staleness / invalidation model
- **Item / area:** session-summary cache invalidation
- **Status:** DECIDED-AUTO (overturns the request brief's own proposed simplification)
- **Raised / Decided:** 2026-08-06 · **Decided by:** `intake-architect`

### The question
Can generation be gated on "session has ended" with no further invalidation
(the brief's proposed simplification, on the assumption sessions are
append-only once ended), or is a real invalidation story needed?

### Where we're coming from
The brief assumed sessions are append-only once ended. The architect verified
this is **false**: `server/db.js:2306` (`reactivateSession`) has three live
call sites in `server/routes/hooks.js` (`:397`, `:1063`, `:1400`) where a
session genuinely resumes after being marked ended.

### Options presented
- **A) Brief's original assumption** — gate on ended-state only, no digest.
  Ruled out — factually wrong for this codebase.
- **B) `input_ended_at` snapshot-compare** — same shape as `value-summary.js`'s
  `compareUnitInputs`/`MUTABLE_VALUE_SOURCES`; invalidate the cached summary
  when a session's actual end timestamp no longer matches what was summarized
  (covers reactivation).

### Decision
**Chosen:** B, with one **named divergence** from `value-summary.js`'s own
"never blank, serve stale text while regenerating" rule — flagged as
**WATCH-2**, not silently copied, since serving a stale "what we did / what's
next" summary after a session reactivates could actively mislead a stakeholder
(unlike the Value Pool's lower-stakes staleness case).
**Rationale / implications:** Needs a positive-control test (seed → reactivate
→ assert cache-miss) per the architect's own top risk callout.

---

## DEC-4 — Wire contract / async generation shape
- **Item / area:** server→client contract for summary generation
- **Status:** DECIDED-AUTO
- **Raised / Decided:** 2026-08-06 · **Decided by:** `intake-architect`

### The question
Should on-demand generation be synchronous (block the HTTP request, like
`/api/project-plans/altitudes`), or fire-and-forget with a WS completion push?

### Options presented
- **A) Synchronous** — matches the literal sibling-route precedent
  (`POST /api/project-plans/altitudes`), but `runClaudePromptJson` can take
  several seconds and blocks the caller.
- **B) Fire-and-forget + WS push + in-flight de-dup** — avoids holding an HTTP
  request open for an LLM call; guards against this repo's own confirmed
  STRICTMODE-BLIND defect class (a React double-mount double-spawning
  `claude -p` without de-dup).

### Decision
**Chosen:** B. Four-state contract: `resolved` / `generating` / `queued` /
`unavailable` (with **mandatory `reason`** on `unavailable`), per §9.8
OVERLOADED-ABSENCE — an out-of-registry state value must log + render
distinguishably, must never silently collapse into the `unavailable` branch
(this is exactly how §9.8's "Trap E" happened on `AltitudeText`).
**Rationale / implications:** A deliberate, named departure from the
`/altitudes` route's literal shape — document why in the route's own header
comment so a future reader doesn't "fix" it back to synchronous.

---

## DEC-5 — §9.1 DERIVED-DUAL-VIEW remedy: extract now, or defer?
- **Item / area:** summary fetch/format logic, single current consumer (`SessionDetail.tsx`)
- **Status:** DECIDED-AUTO (PM resolved a direct architect/QA conflict)
- **Raised:** 2026-08-06 · **Decided by:** `intake-project-manager`
- **Recurring-issue link:** §9.1 DERIVED-DUAL-VIEW (count 7, unchanged — design-time pre-flag only)

### The question
With only one consumer today (a pre-flagged Board-card badge is a *likely*,
not scheduled, second consumer), should the fetch/format logic be extracted
into a shared hook now, or left inline with a documented extraction boundary
for later?

### Where we're coming from
Architect and QA gave **opposite recommendations in the same run**: architect
said no extraction yet (single consumer, avoid over-engineering, document the
boundary); QA said extract a hook now with a `windowedTotals.ts`-style header
comment. §9.1's own 2026-08-05 note in `PROJECT-CONTEXT.md` says "a pre-flag
is not a guard" — i.e., naming a future risk in prose has already proven
insufficient to prevent this pattern recurring on this project.

### Options presented
- **A) Architect's call** — inline now, prose boundary note, extract when
  consumer #2 actually appears.
- **B) QA's call** — extract a canonical hook/function now, with a dated
  header comment instructing any future consumer to import it, not
  re-derive it. No cross-consumer test yet (would be vacuous with one
  consumer) — but the extraction itself is what makes a future test cheap
  to add.

### Decision
**Chosen:** B, per QA's own §9.1 citation of the pattern's history.
**Rationale / implications:** Zero behavior change, marginal build cost now;
directly closes the mechanism (§9.1's own diagnosis: "the cross-consumer test
is nobody's file and does not get written," and separately, "a pre-flag is
not a guard") that has produced this project's highest defect-class count.
The deliberate omission of a cross-consumer test **this** round is tracked as
**WATCH-4**, so it cannot read later as an oversight.

---

## DEC-6 — Surface assumption: "person's card" = `SessionDetail.tsx` flow
- **Item / area:** UI placement
- **Status:** DECIDED (Sara confirmed at the Step 6 report-back gate)
- **Raised / Decided:** 2026-08-06 · **Decided by:** Sara, confirming triage + product-owner's independently-verified read

### The question
Sara described this living on "the individual person's card > Sessions >
expand a session" — no such component exists in this codebase.

### Where we're coming from
Two independent searches (triage's, product-owner's) confirm zero
`PersonCard`/`AssigneeCard`/developer-grouping concept exists anywhere in
`client/src`. The actual click path: `AgentCard`/`SessionCard` (Board or
Projects page) → navigate → `SessionDetail.tsx` → Conversation tab →
`ConversationView.tsx` renders the transcript.

### Options presented
- **A) Loose framing for the existing flow** — build the card into
  `SessionDetail.tsx` above `ConversationView`.
- **B) A genuinely new per-person/assignee grouping surface is wanted** —
  out of scope for this request unless Sara confirms it.

### Decision
**Chosen:** A — confirmed by Sara (2026-08-06): "Existing session-detail view
(Recommended)." The card mounts in `SessionDetail.tsx` above `ConversationView`;
no new per-person surface is in scope for this request.
**Rationale / implications:** Note the coupling to DEC-5/WATCH-4 stands as a
forward-looking tripwire regardless: if a per-person rollup is ever requested
later, that rollup is §9.1 consumer #2 on day one and WATCH-4's cross-consumer
test fires immediately.

---

## DEC-7 — Build sequencing vs. in-flight Slice 3 (`value-pool-grouping`)
- **Item / area:** timing / merge conflict risk
- **Status:** DECIDED — **build is on HOLD pending Slice 3's merge**
- **Raised:** 2026-08-06 · **Decided:** 2026-08-06 · **Decided by:** Sara

### The question
Should this build start now, given an unlanded, in-flight effort
(`requests/2026-08-04-value-pool-grouping`, Slice 3 — auto-group proposal
engine) is actively editing the same file this build is instructed to model
itself on and extend, `server/lib/value-summary.js`?

### Where we're coming from
PM's history reconstruction found Slice 3's build in flight and unmerged as
of this intake. Building this feature concurrently risks either a merge
conflict or, worse, silently diverging from whatever shape `summaryModel()`
and the stage registry end up in once Slice 3 lands.

### Options presented
- **A) Wait for Slice 3 to merge**, then start this build against the
  settled file.
- **B) Proceed now**, accept rebase/merge risk, coordinate manually.

### Decision
**Chosen:** A — wait for Slice 3 to merge (2026-08-06: "Wait for Slice 3 to
merge (Recommended)").
**Rationale / implications:** `technical-plan.md` is already correct as
written and needs no rework — DEC-7 only gates **when** Step 1 runs, not
**what** it contains. `team-build` should not be dispatched on this plan
until `requests/2026-08-04-value-pool-grouping` Slice 3 has merged to the
repo's default branch. A later `team-status`/`worktree` check (or Sara
telling the team directly) is what should unblock this.

---

## DEC-8 — Scope: summaries for in-progress sessions, or ended-only?
- **Item / area:** feature scope
- **Status:** DECIDED
- **Raised:** 2026-08-06 · **Decided:** 2026-08-06 · **Decided by:** Sara

### The question
DEC-3's invalidation design *architecturally supports* generating a summary
for an in-progress (not-yet-ended) session and invalidating it on
reactivation — but should the product actually offer that, or only summarize
sessions once they've ended/gone stable?

### Options presented
- **A) Ended sessions only** — simpler mental model ("what did we do" reads
  oddly for something still happening).
- **B) Any session, in-progress included** — "what is next" arguably reads
  more naturally for a session still in flight.

### Decision
**Chosen:** A — ended sessions only (2026-08-06: "Ended sessions only
(Recommended)").
**Rationale / implications:** Cheap to change later regardless of DEC-3's
architecture; a plain product preference, not a technical constraint.
`technical-plan.md` already implements this as its default — no rework
needed. It implements this as a **single named constant**
(`REQUIRE_ENDED_SESSION` in `server/lib/session-summary.js`, default `true`
= Option A) plus a second snapshot field (`input_last_event_at`/
`input_last_event_id`) that makes Option B safe without an architecture
change. Flipping the answer is a one-line edit plus one test case, not a
redesign.

---

## WATCH-1 — Background summary sweep deferred
- **Item / area:** trigger model (from DEC-2)
- **Status:** PENDING (deferred, tracked — not dropped)
- **Raised:** 2026-08-06 by `intake-architect` §4.1; carried by `intake-tech-lead`

On-demand-only shipped this round. A `value-summary-tick.js`-style background
sweep that pre-generates summaries for ended sessions is a **real fast-follow,
not a maybe**. **Revisit trigger:** once real session-open volume against
un-summarized ended sessions has been observed for at least one week of
normal use. If that sweep is ever built, QA's §9.8 progress-counter clause
binds in full — any "N sessions still awaiting a summary" number must be
re-derived from live input each round, never decremented, and an errored
round must preserve rather than zero the last known-good value
(`upsertValueSweepStateKeepPending` pattern; test shape transplanted from
`server/__tests__/value-summary-tick.test.js`'s B2-blocker / T-C-instrument
describes — but see WATCH-6 before copying their assertion style).

---

## WATCH-2 — Named divergence: reactivated sessions report `unavailable`, not stale-but-served
- **Item / area:** cache read semantics (from DEC-3)
- **Status:** PENDING (deliberate simplification, tracked)
- **Raised:** 2026-08-06 by `intake-architect` §4.2; carried by `intake-tech-lead`

`value-summary.js`'s `reHomeStaleUnits` rule is "never blank — serve the old
text with a freshness marker while regenerating." This build **deliberately
diverges**: a stale/reactivated session reports
`{state:"unavailable", reason:"session_active"}` rather than re-serving
superseded "what's next" prose. Rationale: a single-item stakeholder card
whose entire content is forward-looking is more actively misleading when
stale than a list row is. **Revisit trigger:** if a future round wants
stale-but-served behavior (e.g. "here's the last summary, from before this
session resumed"), it must be designed deliberately, not arrived at by
copying `reHomeStaleUnits`. The divergence is documented in
`server/lib/session-summary.js`'s header comment citing this row.

---

## WATCH-3 — Manual "regenerate" affordance not built this round
- **Item / area:** UI scope (from `intake-architect` §4.2)
- **Status:** PENDING (deferred, tracked)
- **Raised:** 2026-08-06 by `intake-architect`; carried by `intake-tech-lead`

The DEC-3 invalidate-on-input-change mechanism covers the actual
data-integrity risk (a summary that missed real work). A manual "regenerate"
button covers a different case — "the LLM output is just wrong or oddly
worded" with no underlying data change — and is **not** built this round.
**Revisit trigger:** the first time Sara reports a summary that is stale in
*quality* rather than in *inputs*. Note the server already supports it
cheaply: `generateSessionSummary` is idempotent per session and the
four-state wire contract already carries `generating`, so a regenerate button
is a route flag plus a button, not new machinery.

---

## WATCH-4 — Cross-consumer parity test becomes MANDATORY at consumer #2
- **Item / area:** §9.1 DERIVED-DUAL-VIEW tripwire (from DEC-5, QA §2.3, PO AC-8)
- **Status:** PENDING (dated tripwire — this is the guard, not a note)
- **Raised:** 2026-08-06 by `intake-qa`, ruled by `intake-project-manager` (PM-2.3)

`client/src/hooks/useSessionSummary.ts` is the canonical fetch/format path for
"this session's stakeholder summary and its status." **No cross-consumer
parity test is written this round** — with one consumer it degrades to
`deepEqual(f(X), f(X))`, the vacuous shape §9.3 names and the shape that made
`value-coverage-parity.test.js` a vacuous guard in the immediately preceding
slice. That omission is **intentional and recorded here**, not an oversight.
**Trigger (unambiguous):** the day a second consumer of the session summary is
*scheduled* — the pre-flagged Board-card badge, a per-person rollup (see
DEC-6), or anything else — a cross-consumer parity test becomes **MANDATORY
before that consumer merges**. Structural precedents:
`client/src/components/__tests__/FocusReportModal.test.tsx`'s
`[standing template]`/`[board-mode extension]` pattern for a client consumer,
or `server/__tests__/reconciliation-full-tick.test.js` Scenario C's
byte-parity shape for a server-rendered one. The consumer must **import** the
hook, not hand-copy it, even as a "quick first pass."

---

## WATCH-5 — `MAX_CONCURRENT_SESSION_SUMMARIES = 2` is a reasoned guess, not a measurement
- **Item / area:** concurrency cap in `server/lib/session-summary.js` (from `intake-architect` §5.2/§7)
- **Status:** PENDING (bound with no measured distribution behind it)
- **Raised:** 2026-08-06 by `intake-architect`; carried by `intake-tech-lead`

§9.8's own bounds rule is "any bound must cite the real distribution it was
sized against." There is no such distribution for this feature yet — nobody
has ever opened a session under it. The cap is set at **2 deliberately low**,
with the cited reason being *reachability*: it guarantees the `queued` state
is actually exercised by ordinary multi-tab use rather than being a
decorative branch nobody hits. That is an honest rationale, but it is not a
measurement. **Revisit trigger:** the first time a real user reports
`queued` showing up as friction rather than as information, or after one
week of normal use, whichever comes first. This is the same underlying
unknown as WATCH-1 ("how many sessions does Sara actually open at once") —
resolve them together. The constant's own JSDoc must cite this row and must
**not** claim the number is derived from usage.

---

## WATCH-6 — Flaky `notStrictEqual`-on-timestamp guards live on `master` (do not copy the shape)
- **Item / area:** `server/__tests__/value-summary-tick.test.js` (Slice-2 debt, our cost)
- **Status:** PENDING (pre-existing defect, not this build's to fix, but binding on this build's test style)
- **Raised:** 2026-08-06 by `intake-project-manager` (carve-out C-1); carried by `intake-tech-lead`

PM ran the file four times: 0 leaf failures on two runs, 1 on two runs, and on
one run a second test in the same family failed identically. Both failures are
`notStrictEqual` on ISO-8601 timestamps where `expected === actual` to the
millisecond — the assertion "the rotation timestamp advanced" losing to clock
resolution, not to a product defect. Affected describes: `S1 should-fix (sweep
rotation advances even on bookkeeping failure)` and, intermittently, `B2
blocker fix (errored sweep preserves pending_after_sweep)`.
**Binding on this build:** `server/__tests__/session-summary.test.js` must
**not** use `assert.notStrictEqual(tsA, tsB)` to prove a timestamp advanced.
Assert monotonicity with an injected clock or with an explicitly distinct
seeded value. Per §9.3, a guard that goes red for a legitimate reason gets
weakened; a guard that goes red *intermittently* gets ignored, which is worse.
**Revisit trigger:** fix as Slice-2 debt in its own change, separately from
this feature.

---
