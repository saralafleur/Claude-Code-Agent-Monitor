# Product Owner Assessment — value-summary-tick

**Intake item:** `intake/2026-08-04-value-summary-tick/`
**Role:** intake-product-owner · **Date:** 2026-08-04
**Inputs read:** `request-brief.md`; `PROJECT-CONTEXT.md` (§9.1 DERIVED-DUAL-VIEW,
§9.7 HAND-SCOPED STRUCTURAL SCAN, the `wip-queue-page` precedent);
`intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md` (DEC-P4, DEC-8,
DEC-12, DEC-16) and its `supporting/product-owner.md`; session memory
`portfolio-reconciliation-vision`; `server/lib/value-summary.js`;
`server/routes/settings.js` + `client/src/components/CacheSection.tsx`
(Focus Summaries observability precedent, live and shipped).

---

## 1. Value & intent

Sara (sole stakeholder and sole end user — this is a local-first, single-operator
dashboard) wants to open a project with 100+ value-pool units and get a
**complete, trustworthy** answer, not a partial one that silently depends on
how many times she has reloaded the page. Today the interactive endpoint
synthesizes at most 40 uncached units per request; full coverage of a large
project needs ~3 reloads, with **no signal distinguishing "still generating"
from "the LLM was unavailable this round."** That ambiguity is the real defect
— a user cannot tell a transient gap from a permanent one, which undermines
trust in every altitude label the feature renders, not just the missing ones.

This isn't a new want; it is the previously-shipped Value Pool altitude
feature (`2026-08-02-plan-lifecycle-value-ledger`, DEC-P4) hitting the scale
its own design didn't anticipate, caught by Sara herself in design review the
same day it shipped, before it became a real support-facing gap. That framing
matters for priority (see §4) — it is quality debt on a feature she is about
to depend on for the reconciliation workflow the `portfolio-reconciliation-vision`
memory names as her build priority, not a nice-to-have polish item.

## 2. Scope check

**In scope for the mission and for the parent feature's own governing decisions** —
with three explicit forks flagged in §3 that need Sara's call before build starts.

- The parent feature's own decision log (DEC-16) already anticipated more
  consumers arriving for `value-ledger.js`'s outputs and set the standing rule
  that any new consumer must read health/pool values through the shared
  module, never recompute — this request's proposed tick reuses
  `assembleValuePool` and does not re-derive pool membership, which is
  consistent with that rule and should be carried into acceptance criteria
  verbatim, per the request brief's own flag.
- DEC-P4 (altitude ceiling: the DB holds delivered value, desired value, and
  reconciliation — nothing repo-local) is unaffected: PROJECT/STAKEHOLDER
  synthesis text is exactly the kind of thing already inside that boundary,
  and nothing in the proposed direction stores new repo-local content.
- This is **not** a repeat of the `wip-queue-page` failure (a portfolio UI
  built before its data was known to be worth rendering, reverted two days
  later) — the data model here already survived that gate in the parent
  effort (DEC-12, "signal not noise," Sara's own verdict). This request is a
  reliability/scale fix to an already-validated feature, which is a materially
  lower-risk category than net-new portfolio surface. Don't let the size of
  the proposed direction (new table, new routes, new WebSocket type) read as
  "as risky as a new portfolio page" — it isn't; the value question is already
  answered.
- No contradiction found with any signed-off decision. Nothing here reopens
  DEC-P2 (AGENT-PLAN.md import inversion), DEC-P6 (closure invariant), or any
  of the WATCH items in the parent decision log.

**Request-type framing:** I'd call this **scale-hardening of shipped behavior**
rather than either pure `new-feature` or `missed-requirement`. It's not a bug
(nothing is broken below ~40 units) and it's not really a "we forgot a
requirement" — 40 units was a real, documented design choice
(`MAX_UNITS_PER_PROMPT`, with a stated batching rationale) that a subsequent
data point (a 100+-unit real project) invalidated. This framing doesn't change
the acceptance bar, but it does argue against treating the fix as low-priority
polish (see §4).

## 3. The three flagged open questions — value/scope read

### Q1 — Tick sweep scope

**Recommendation: sweep every project with a `project_paths` mapping (i.e.
every project the dashboard already tracks), not a curated subset — but bound
the *work*, not the *scope*.**

Reasoning specific to how Sara actually uses this tool: it's a personal,
local-first, multi-project dashboard, and her own confirmed model
(`portfolio-reconciliation-vision`) is that she wants a periodic pass that
runs "not continuously, per project" across her whole fleet without her having
to remember to open a project first. Restricting the sweep to "only projects
with an open plan" or "only recently-viewed" quietly reintroduces the exact
problem this request exists to remove: staleness that depends on Sara's own
click history, i.e. the same "did I visit enough times" dependency as the
current 3-reload problem, just moved from request-time to tick-time. A project
she hasn't opened in months is precisely the one she'd want already caught up
the next time she does open it — "recently viewed" scope actively defeats
that.

The cost concern in the brief ("LLM spawn frequency × project count") is
overstated as a linear cost, because of a property already built into
`value-summary.js`: `value_unit_summaries` is keyed on immutable unit identity
with **no digest gating — generated once, served forever.** A tick sweeping a
project with zero new units since the last tick costs a DB-and-git read
(`assembleValuePool`), not an LLM spawn — the LLM only fires for genuinely new
uncached units, which only accumulate on projects with real new activity
(commits, intake merges). So "every project" scope is not "every project pays
LLM cost every tick"; it's "every project pays a cheap freshness check every
tick, and only active projects pay the LLM cost." That is the right shape for
a personal multi-project tool where the whole point is not having to
remember which projects are "active" — the tool should know.

What *should* be bounded is the sweep's own resource ceiling per cycle (batch
size per tick, and the assembleValuePool cost itself for very large or
many-project fleets), not the project-selection scope. If Sara's real fleet
size turns this cheap-check assumption into a measurable per-tick cost, that's
an empirical thing to check at build time against her real DB (the same
"verify against a real project" caution the request brief already raises),
not a reason to default to a narrower, staleness-reintroducing scope.

**Stakeholder question:** confirm this reading, and provide (or approve a
recommended default for) the tick cadence and per-tick batch-size numbers the
brief flags as unset.

### Q2 — Fully read-only interactive endpoint (loses same-visit synthesis for brand-new units)

**This is a real, user-visible regression worth guarding against — recommend
the hybrid, not pure read-only.**

Concretely: today, a unit created right after a commit lands gets synthesized
on the very next page visit (below the 40-cap, which is the common case for
most of Sara's projects most of the time — 100+-unit projects are the stated
exception, not the norm). Under a fully read-only design, that same common
case regresses to "wait for the next tick," which could be minutes, purely to
solve a problem that only exists above the 40-unit threshold. That's solving
the tail by breaking the median.

This matters because the acceptance bar Sara herself set is **"scalable... and
the right long-term fix"** — a design that is scalable at 100+ units but
strictly worse than today's UX at the (more common) <40-unit size is not
obviously "the right long-term fix"; it's a trade that solves one failure mode
by introducing a different, newly-created one. The brief's own suggested
alternative — request-path synthesis stays for the first ≤40 units (today's
existing behavior, unchanged), and the tick exists purely to cover the
overflow the request-path structurally cannot reach — keeps the fast path for
the common case and adds the missing coverage for the tail, without a new
regression. I'd treat that hybrid as the default recommendation rather than
"full read-only," pending Sara's sign-off, because "read-only" was Sara's
sketch, not her ruling (the brief is explicit the direction is
"NOT yet approved or scoped").

Note this interacts with §9.1 DERIVED-DUAL-VIEW from `PROJECT-CONTEXT.md`: the
hybrid reintroduces exactly the two-writer shape (interactive endpoint writes
+ tick writes) the request's own pre-flag was cautious about — that's an
engineering-review concern (single-writer guard scoped correctly, no silent
second write path), not a reason to avoid the hybrid on value grounds. The
value case for keeping same-visit synthesis for the common case is strong
enough that the engineering cost of guarding two writers correctly should be
paid, not designed around.

**Stakeholder question:** confirm whether preserving same-visit synthesis for
the ≤40-unit case is a hard requirement (my read: yes, given her own
"scalable" bar shouldn't cost the common case anything) or whether she's
consciously willing to trade it away for design simplicity (one writer, one
mental model).

### Q3 — Settings observability parity in this build vs. fast-follow

**Recommend splitting: ship (a) read-only/hybrid endpoint + (b) background
tick + (c) WebSocket live update now; sequence (d) the full Settings UI
audit-table/routes/UI section as an explicit, named fast-follow — but do not
let "observable" silently drop off the requirements list in the process.**

Reasoning: (a)-(c) are the direct fix for the two problems named in the
brief — coverage at scale, and telling "still generating" apart from
"unavailable." Those two problems are fully solved without (d): a live
WebSocket update that flips "Generating…" to real text, or to an explicit
"unavailable this round, retrying next tick" state, already gives the user
the missing signal *in the surface she's actually looking at* (the Project
Detail page), which is arguably a more useful "observable" than a Settings
page she'd have to remember to go check. (d) is what makes the system
observable *by Sara-as-operator* (audit trail, hit rate, backlog size over
time) rather than observable *by Sara-as-user-of-one-project* — a real and
legitimate second need, but a different one, and the larger of the two in
new-surface terms (new table + two new routes + one new UI section, per the
brief's own inventory).

Sara's third stated criterion is literally "observable," so I would not treat
(d) as optional forever — I'd treat it as sequenced, not dropped, with an
explicit fast-follow item recorded (mirroring how DEC-16 in the parent effort
recorded deferred consumers as WATCH items rather than silently letting them
disappear). Shipping (a)-(c) sooner also gives Sara a shorter feedback loop to
validate the tick/hybrid design against her real fleet before investing in a
whole observability layer for it — the same "checkpoint before the expensive
UI" discipline that governed the parent effort's own slicing (DEC-12).

**Stakeholder question:** confirm the v1/fast-follow split, and confirm
whether the per-project "Generating… / unavailable, retry at next tick" signal
on Project Detail is an acceptable interim satisfaction of "observable," or
whether she wants the Settings audit layer before this is called done.

## 4. Acceptance criteria — anchored on Sara's own three words, not invented

Per instruction, using Sara's own bar directly rather than substituting a new
one. Each is stated as a testable "done when."

### AC-1 — Scalable
Done when: opening a Project Detail page for a project with an arbitrarily
large pool (proven against a real project, not just a synthetic fixture — the
brief flags no real project ID was validated against yet) requires **zero
page reloads** to eventually see every unit's altitude text populated, and the
per-request cost of viewing the page does not grow with total pool size (i.e.
the interactive endpoint's own per-visit work stays bounded — either fully
read-only, or bounded to the existing ≤40-unit fast path per Q2). No user
action is required to "unstick" coverage beyond waiting.

### AC-2 — Observable
Done when: for any unit not yet showing synthesized text, the UI distinguishes
at least two states — "queued for the next tick" vs. "the LLM was unavailable
this round and will retry" — so a user is never left guessing which failure
mode they're looking at (this is the literal problem statement in the brief,
restated as the criterion). If the Settings audit-table/UI parity is
sequenced as a fast-follow per Q3, this project-page-level signal is the
minimum bar for "observable" in the v1 cut; the Settings layer is the
operator-level extension, tracked as its own deliverable with its own
acceptance criteria when it ships.

### AC-3 — The right long-term fix
Done when: (a) `assembleValuePool` remains the single composer of pool
membership — the tick reuses it, never re-derives (DEC-16's standing
obligation, carried forward explicitly here per the request brief's own
flag); (b) `value_unit_summaries` remains the single cache/write target, with
any write-path guard (single-writer or otherwise) scoped exactly to the
surfaces that actually write it, not hand-typed narrower or wider (§9.7
caution); (c) whatever the endpoint's read/write split ends up being per Q2,
it is a deliberate, recorded design decision (not an accidental byproduct of
"read-only was easiest to build") — because "the right long-term fix" is a
claim about the shape of the solution, not just whether it currently works.

## 5. Priority & impact

- **Who is blocked:** no one is hard-blocked today — this is pre-emptive
  design-quality work, caught before a support issue, exactly as the brief
  frames it. But the underlying feature (Value Pool altitude synthesis) feeds
  directly into the reconciliation workflow the `portfolio-reconciliation-vision`
  memory names as Sara's stated build priority, and the origin case for the
  parent feature (Coaching Assistant, ~182 units at last live-trial read) is
  already well past the 40-unit cap that motivates this request. So while
  nothing is on fire, the gap is already live on Sara's own primary use case,
  not hypothetical.
- **Visibility:** high to Sara personally (she caught it herself, same-day,
  in design review), zero to anyone else — single-stakeholder product.
- **Urgency rationale:** moderate-high, not urgent-in-the-outage sense. I'd
  sequence it as the next hardening pass on the just-shipped Value Pool
  feature, ahead of net-new portfolio surface (e.g. WATCH-3's cross-project
  rollup UI, or DEC-16's deferred consumers), because those consumers would
  otherwise inherit the same 40-unit ceiling and the same "still generating
  vs. unavailable" ambiguity — building on top of the known-broken-at-scale
  version compounds the eventual fix.

## 6. Stakeholder questions needing sign-off before building

1. **Q1 scope confirmation** — sweep-every-tracked-project as recommended, or
   a narrower scope Sara has a specific reason to prefer? Plus: approve a
   concrete tick-cadence value and per-tick batch-size cap (both currently
   unset per the brief).
2. **Q2 hybrid vs. pure read-only** — confirm same-visit synthesis for the
   ≤40-unit case must be preserved (my recommendation), or that Sara knowingly
   accepts the regression for design simplicity.
3. **Q3 sequencing** — confirm v1 ships (a) hybrid/read-only endpoint + (b)
   tick + (c) WebSocket live update + per-unit state signal on Project Detail,
   with (d) the Settings audit-table/routes/UI section tracked as a named
   fast-follow rather than folded into this build or silently dropped.
4. **Real-project validation** — the brief notes the "~100+ units" / "~3
   reloads" figures are estimates, not measured. Worth confirming a real
   project ID (Coaching Assistant is the likely candidate, per the parent
   effort's own live-trial data) to design and test against, so AC-1 is
   verified against real scale, not a synthetic fixture.
5. No new content-approval question here — this request changes system
   behavior/architecture, not any stakeholder-approved wording or source-of-truth
   text, so the "does delivered output match approved source wording" class of
   acceptance criterion doesn't apply to this item.
