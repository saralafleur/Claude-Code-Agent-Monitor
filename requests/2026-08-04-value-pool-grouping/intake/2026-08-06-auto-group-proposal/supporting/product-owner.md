# Product Owner Assessment — Slice 3: Auto-group proposal engine

**Intake:** `2026-08-06-auto-group-proposal`
**Assessed:** 2026-08-06
**Verdict:** IN SCOPE, approved, build it. Priority: high within the value-pool
roadmap — it is the slice that makes the "act on a group as a unit" promise
first become real (even though the *acting* part is still Slice 4).

---

## 1. Value & intent

Sara's own framing (`request.md`, verbal 2026-08-04) is the north star: once
every unit has its per-unit text, she wants to **auto-group the pool in a
fashion appropriate to the solution, then act on a group as a unit**. Slice 3
delivers the *first half* of that sentence only — the grouping — but it is the
half that unlocks everything downstream. Today, at ~100-200 units per pool,
finding "which units belong together" is a manual read-every-row exercise;
that does not scale, and it is exactly the toil Slices 3-4 exist to remove.

The outcome she wants from Slice 3 specifically: look at a project's value
pool and see it **pre-organized into named, explained candidate groups** —
each with a plain-language summary sentence and a rationale she can sanity-
check in seconds — without any of those groups being able to silently commit
her to a plan change. The "proposals, never actions" framing is not a hedge;
it is the same correlational-tier-suggests-never-auto-claims principle that
already governs the rest of the ledger, extended to a new, higher-leverage
surface (a wrong per-unit suggestion is a small error; a wrong *group*
suggestion that got auto-claimed would misattribute several units' delivered
value at once).

It matters to end users (here, exclusively Sara) because the ledger is the
surface she uses to reconcile "what did we actually deliver" into her plan —
per her own portfolio-reconciliation direction (project memory). A grouping
engine that hides its work, silently drops units it couldn't place, or gives
her no way to tell "nothing proposed yet" from "tried and found nothing"
would corrupt that reconciliation exactly the way Slice 1 fixed stale text
from corrupting it. §9.8 OVERLOADED-ABSENCE is named by the parent request
itself as the standing trap for this reason — it is a product risk here, not
just an engineering one.

## 2. Scope check

- **Inside approved scope, verbatim.** The brief's "raw ask" section quotes
  `request.md`'s Slice 3 section unparaphrased, and the parent doc's sequencing
  constraint ("slices ship independently, in order") has held for two prior
  slices without deviation. No contradiction found against any signed-off
  spec.
- **Source of truth for this project's scope decisions.** This project has no
  separate business-requirements doc; `PROJECT-CONTEXT.md` is an engineering
  defect catalog, not a scope/business-requirements source. For this
  initiative the source of truth is `request.md` (Sara's own words, plus the
  "Agreed architectural direction" section she approved in-session) at the
  parent level, and each slice's own `decisions.md` once the tech-lead/PM
  stage produces one — decisions there are binding and must not be
  re-litigated by this intake. Two are directly load-bearing for Slice 3 and
  are treated as **closed inputs**, per the run-plan's own instruction:
  - **DEC-10** (Slice 2): sonnet, not haiku, for both per-unit and grouping
    synthesis, based on a real 40-unit calibration. Slice 3 consumes
    `summaryModel("grouping")` and `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL`;
    it does not re-run calibration.
  - **DEC-2** (Slice 2): no scaffolded/disabled Auto-group button shipped
    ahead of the real action, specifically to avoid manufacturing an
    OVERLOADED-ABSENCE state at the UX layer (disabled-because-incomplete
    vs. disabled-because-nonexistent would have rendered identically).
    Confirmed live: `PlanLedgerPanel.tsx` today has no Auto-group button at
    all, only the coverage header + a single `prioritize-now-button`. DEC-2
    also **inherits one acceptance criterion into this intake verbatim** —
    see AC-7 below — which this document is required to carry forward, not
    silently drop.
- **No contradiction found.** Nothing in the request-brief's live-verification
  pass or this review found Slice 3 asking for anything the parent doc,
  Slice 1's or Slice 2's decisions, or Sara's verbal framing forecloses.
- **One scope boundary this document must rule precisely** (per the task) —
  see §3's AC-4/AC-5 and §7 below: where "review/approval" ends and "claiming"
  begins.

## 3. Acceptance criteria ("done when…")

Turning the brief's five extracted (not requester-verified) "done when"
signals into ruled, testable criteria, in this project's numbered `AC-`
convention (continuing, not restarting, the sequence Slice 2 used — Slice 2's
own AC-4 is carried forward here as AC-7 per DEC-2's explicit instruction to
copy it into this intake folder).

1. **AC-1 (mechanical pre-grouping is real and LLM-free).** Given a project's
   assembled value pool, the mechanical pre-grouping pass produces candidate
   pre-groups using only trunk-commit initiative-slug references,
   time-adjacency clustering, and shared-surface signals — **zero LLM calls**.
   Running it twice against the same pool state (no underlying data change)
   produces the same candidate pre-groups. This half of the engine must be
   independently inspectable/testable without ever invoking the model — that
   auditability is the whole point of doing it mechanically first.
2. **AC-2 (LLM refinement produces the four named fields, one call per
   prompt's worth).** For a pool that fits in one prompt, exactly one sonnet
   call (via the existing `summaryModel("grouping")` stage — DEC-10, closed)
   refines the mechanical pre-groups into named proposals. Each proposal
   returned to the client has: a **name**, a **stakeholder-level one-sentence
   summary**, its **member unitKeys**, and a **rationale**. A proposal missing
   any of these four fields is not "done," it's a defect.
3. **AC-3 (hierarchical decomposition is exercised, not just named).** When a
   pool exceeds one prompt's worth, the refinement stage decomposes
   hierarchically rather than truncating, sampling, or silently dropping
   units — demonstrated against a real oversized pool (the live pool is
   ~102 units today, 182 recorded historically; the architect's chosen
   per-prompt cap must be tested against a pool that actually exceeds it, not
   only against a synthetic pool sized just under the cap). **Any unit not
   included in any proposal for pool-size reasons is disclosed as such**,
   named and visible — not silently absent from every group. This is the
   group-level instance of the "decompose, don't drop; disclose what's
   dropped" standard §9.8 already names as this surface's history (the same
   failure mode `value-summary.js` fell into copying `focus-summary`'s cap).
4. **AC-4 (proposals persist and render for review; nothing auto-claims).**
   Every grouping run's output persists to the new `value_groups` table as
   proposals. The client renders, at minimum, a **list of proposed groups**
   — name, summary sentence, member count/unitKeys, rationale — one entry
   per proposed group, for the target project. **No action available in
   Slice 3's UI claims a group's members into any plan item, and no action
   in Slice 3's UI creates a plan item or sub-item.** See §7 for the precise
   Slice 3/Slice 4 line this enforces.
5. **AC-5 (review/dismiss exists; it is bookkeeping, not action).** Each
   proposed group carries a per-group **approve** (mark reviewed/accepted-
   in-principle) and **dismiss** action. Both actions only change the
   group's own status in `value_groups`; neither touches a plan item, a
   milestone, or any unit's claim state. "Approved" means "Sara has looked at
   this and it's a reasonable candidate to act on later" — it is explicitly
   **not** "claimed," and the UI copy must not imply otherwise (no "Approve
   & claim" combined action ships in Slice 3).
6. **AC-6 (coverage gate is a pure read of the server field, and overloaded-
   absence states are named).** The grouping-run action is unavailable until
   `coverageSnapshot.complete === true` for the target project, read
   directly from Slice 2's server-authored field — never re-derived
   client-side from `described`/`pool_size`. Below 100%, no separate
   client-side "is it done yet" math exists. Distinctly from the gate itself:
   a completed run that resolved zero members into any group, a
   not-yet-attempted run, and a failed/timed-out refinement pass are each a
   **named, distinguishable wire state** — never a bare empty list a user
   (or QA) cannot tell apart from "haven't tried."
7. **AC-7 (inherited verbatim from Slice 2 DEC-2 — carried forward as
   instructed, not re-derived).** *"the group action is visibly disabled
   until coverage is 100%, showing the ETA and a 'prioritize now' action."*
   Slice 3 is where this ships for the first time, because Slice 3 is the
   first slice with a real group action to disable. **Ruling on how it ships
   is in §5** — the letter of DEC-2's inherited text is satisfied without a
   second, duplicate "prioritize now" control (see §5).

## 4. Priority & impact

- **Who is blocked:** Sara, sole user, on the surface she reads to answer
  "what did this work deliver" and to reconcile it into her plan. Without
  Slice 3, that reconciliation stays a manual per-unit read at ~100-200 units
  a project — the scale problem her own framing names explicitly
  ("generation cost/scale must be handled well at ~200-unit pools").
- **Visibility:** internal-only, single-user, local-first tool — no external
  stakeholder visibility. Impact is entirely on Sara's own workflow
  efficiency and trust in the ledger, not on any client-facing surface.
- **Urgency:** next in the approved sequence. Slices 1-2 are merged; Slice 3
  is explicitly the next slice per "slices ship independently, in order,"
  and it is a **hard dependency for Slice 4** (batch claiming needs proposed
  groups to claim). Not an emergency — nothing is broken today — but it is
  the critical-path item for the vision Sara approved as a whole.

## 5. Ruling on the deferred UX question (Slice 2 run-plan → this intake, by
name)

**Question as handed forward:** was the disabled-gate + ETA + "prioritize
now" pattern from Slice 2 the right call, now that Slice 3 makes the group
action real — or would "prioritize now" alone deliver the value?

**Ruling: the pattern is still right, but it must not duplicate what Slice 2
already shipped.** Two things are true at once:

1. **DEC-2's call to *not* ship a scaffolded disabled button in Slice 2 was
   correct**, and this intake does not reopen it. A disabled button with
   nothing behind it is indistinguishable from a disabled button whose
   feature doesn't exist yet — the exact §9.8 trap. Deferring the gate until
   the action was real was the right sequencing call, not a UX compromise.
2. **Now that the action is real, the gate belongs on the Auto-group control
   itself — as a `disabled` state with an explanatory affordance — not as a
   second, independent "prioritize now" surface.** Live-checked:
   `PlanLedgerPanel.tsx` already renders a coverage header with a single
   `prioritize-now-button` whenever `!coverage.complete && coverage.demand
   === "passive"`, immediately above where the pool's units render. The
   Auto-group control (new in Slice 3) sits in that same pane. Shipping a
   *second* "prioritize now" button/link attached to the Auto-group control
   itself would be a UX-level instance of the same rogue-re-derivation risk
   §9.1 names for computed values — two controls doing the same thing,
   liable to drift (e.g., one updates optimistically, the other doesn't).
   **Ruling: the Auto-group button is disabled while `!coverage.complete`,
   its disabled-state affordance (tooltip or inline note) references the
   *existing* coverage header text/ETA, and clicking anywhere in that
   explanation reuses the *same* `handlePrioritizeNow` action already wired
   — not a duplicate handler, not duplicate locale keys for the same
   action.** This satisfies AC-7's inherited language exactly ("visibly
   disabled… showing the ETA and a 'prioritize now' action") while keeping
   one prioritize-now control, one coverage read, one source of truth —
   consistent with Sara's own standing UX constraint that the dashboard
   "must always tell the user what's happening… and when something they saw
   before has changed."
3. **"'Prioritize now' alone, no gate at all" is rejected.** Without a
   visible disabled state on the Auto-group button itself, a user who
   hasn't noticed the coverage header has no way to know *why* clicking
   Auto-group does nothing (or worse, if the API doesn't also gate server-
   side, why it silently degrades). The gate must exist on the control that
   the coverage blocks, not only as an ambient header elsewhere on the page.
   This is also a hard requirement independent of UI: the server-side
   500-of-`coverageSnapshot.complete` check is non-negotiable per DEC-2's
   binding condition, and the client gate should mirror what the server
   already enforces, not invent a softer client-only version of it.

No further sign-off is required on this ruling for build to proceed (it is a
direct, cheap-to-verify application of an already-decided principle plus a
duplication check against already-shipped code), but it is called out
explicitly in §6 below so Sara can veto cheaply if she pictured something
different (e.g. a *second*, group-specific ETA sentence).

## 6. Stakeholder questions (sign-off needed before/at delivery)

There is **no client ask** on this work. Sara is the sole stakeholder — she
is the requester (verbal, 2026-08-04), the project owner, and the only user
of the dashboard. This mirrors Slices 1-2's disposition exactly (both skipped
`intake-client-liaison` for the same reason). No content/copy is being
retconned against an existing approved wording either — Slice 3 is net-new
UI text, not a fix to previously-agreed copy, so the "delivered output
matches the source verbatim" bar applies only to the one piece of copy that
*is* inherited: AC-7's "visibly disabled… ETA… 'prioritize now'" phrase,
which must render as that idea, reusing existing wiring, per §5.

Open items worth a cheap confirm-or-veto pass with Sara before/at delivery,
none of them blocking:

1. **§5's ruling** — gate lives on the Auto-group button itself, reusing the
   existing single `prioritize-now-button`, not a second copy. Flag in case
   she pictured a distinct group-specific ETA sentence.
2. **AC-5's "approve" semantics** — "approve" means reviewed/accepted-in-
   principle, never claims anything. If Sara's mental model of "approve" was
   closer to "commit this to the plan," that is actually a request to
   *loosen* the never-auto-claims principle for Slice 3, which this document
   does not grant on its own — it would need to be a named, explicit
   decision (and would also contradict the parent doc's own Slice 4
   boundary — see §7). Worth a one-line confirm.
3. **AC-3's disclosure mechanism** — what "disclosed" looks like for a unit
   dropped from every proposal for pool-size reasons (a small "N units not
   yet grouped" note vs. something more prominent) is left to
   architect/engineer/QA to design; PO's bar is only that it exists and is
   truthful. No blocking sign-off, but Sara should see it once built.
4. No other sign-offs needed — scope, table, and gating principle were all
   approved as part of the four-slice vision on 2026-08-04 and are written
   down in `request.md`.

## 7. Scope ruling — precisely where Slice 3 ends and Slice 4 begins

The parent doc already draws this line at the noun level (Slice 3 = proposal
engine + `value_groups`; Slice 4 = plan editing UI + batch claiming). This
document rules it at the **UI-affordance level**, since that is where scope
creep would actually happen:

**Slice 3's UI must show:**
- A list of a project's proposed groups (name, summary sentence, member
  count/unitKeys, rationale) — this is the minimum; a fuller per-member
  expandable view is acceptable if cheap, but not required.
- A per-group **approve** and **dismiss** action, each a pure status write to
  `value_groups` (see AC-5). Approve/dismiss is in scope for Slice 3 because
  it is still "review," matching the request's own words ("rendered for
  review/approval") — it changes nothing about the plan.
- The coverage gate on the grouping-run trigger itself (AC-6/AC-7, §5).
- The named, distinguishable overloaded-absence states from AC-6 (zero-
  member run, not-yet-attempted, failed/timed-out).

**Slice 3's UI must NOT show, and no code path in Slice 3 may execute:**
- Any control that claims a group's members into an existing plan item
  (that is Slice 4's "claim-all-members-into-existing-item, one
  transaction").
- Any control that creates a new plan item or sub-item from a group (Slice
  4's "create-new-item(-or-sub-item)-then-claim").
- A claim-target picker or any plan-item/sub-item hierarchy browsing UI —
  that hierarchy already exists server-side, but its *editing/browsing* UI
  is explicitly Slice 4's deliverable, not Slice 3's.
- Individual-unit claiming changes (unaffected by this slice either way —
  units keep their existing single-claim gesture until Slice 4 adds
  sub-item targets).

**The one state Slice 3 is allowed to *reserve* but not *reach*:** the
brief's open question #3 names a plausible lifecycle
`proposed → reviewed → claimed-or-dismissed`. Slice 3 may define `claimed`
as a valid schema value (so Slice 4 doesn't need a schema migration to add
it), but **no code path in Slice 3 may ever set a group's status to
`claimed`** — only Slice 4's batch-claim action does that, once it exists.
If the technical plan finds it cleaner to omit `claimed` from the enum
entirely until Slice 4 needs it (per §9.6 "prefer inapplicability over
compliance" — a new table needs zero forward-reserved states it can't yet
reach), that is also an acceptable ruling; either way is a PO-approved
choice, left to the architect/engineer to pick and the tech-lead to record.

## 8. Scope guard — named Slice 4 territory (do NOT let Slice 3 absorb)

If any of these appear in Slice 3's plan or diff, it has grown; cut it back:

- Plan-item/sub-item add/edit UI in `PlanLedgerPanel` (add milestone, add
  sub-milestone).
- A claim-target picker showing the plan-item hierarchy.
- Batch-claim (claim-all-members-into-existing-item) as an executable action.
- Create-new-item(-or-sub-item)-then-claim as an executable action.
- Any UI copy implying "approve" commits a group to the plan (see §6.2).

Standing constraints that *do* bind Slice 3 (already ruled by architect/
engineer/QA per the run-plan, restated here only because they're also
product-relevant): `assembleValuePool` remains the sole pool composer
(DEC-16/`CONSUMERS`); the `value_unit_summaries` single-writer guard widens
only if Slice 3 turns out to need to write there (it shouldn't — Slice 3
writes only to `value_groups`); §9.8 named states for every new absence, not
just the ones this document called out by name.
