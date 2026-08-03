# Product Owner Assessment — plan-lifecycle-value-ledger

**Intake item:** `intake/2026-08-02-plan-lifecycle-value-ledger/`
**Role:** intake-product-owner · **Date:** 2026-08-02 · **Run mode:** auto-pilot
**Inputs read:** `request.md`, `request-brief.md`, `decisions.md` (DEC-P1..P6),
`PROJECT-CONTEXT.md`, `intake/2026-08-01-build-project-manager/decisions.md`
(WATCH-2, WATCH-3, DEC-7, DEC-13), session memory
(`portfolio-reconciliation-vision`, `holistic-focus-history`).

---

## 1. Value & intent

**Who the user is:** Sara — this is a single-stakeholder, local-first product;
"the requester" and "the end user" are the same person, which makes the
acceptance sketch in `request.md` unusually authoritative.

**The outcome she actually wants:** the ability to ask *"what value did this
project deliver, and did we clear our milestone?"* and get an answer from
recorded state, not archaeology. Concretely: delivered effort (trunk commits,
merged intake initiatives, detours) currently accumulates faster than any
forward plan and never gets *closed out*. The three existing layers each answer
a different question — focus answers "what happened" (empirical), intake
answers "what's in motion" (flow), plans answer "what's intended" (forward) —
and nothing answers "what's *done and declared*." This request adds the closure
layer, with the DEC-P6 invariant (value exits only through a plan) as the
mechanism that makes the answer trustworthy.

**Why it matters:** the `portfolio-reconciliation-vision` memory records this
as the confirmed missing piece of the 7-layer portfolio model and names
reconciliation as *the* build priority. The health metrics (unclaimed-pool
size, time since last closure) turn "are we just having fun?" from a vibe into
a number — that's the product-level payoff.

**Value verdict: real and high.** This is not speculative feature surface; it
is the named continuation (WATCH-2) of a shipped effort, requested verbally by
the sole stakeholder, with the architecture questions already settled by her.

## 2. Scope check

**In scope for the mission — with a documented trail.** The project mission is
"a reliable local-first dashboard for Claude Code session monitoring," and this
request extends monitoring into declaration/closure. That extension was already
approved in substance: layers 4–6 (detour dispositions, pace, decision queue)
shipped in `2026-08-01-build-project-manager`, and that effort's **WATCH-2**
explicitly recorded plan lifecycle as *deliberately unscheduled, pending its
own design brief* — this request **is** that thread arriving with its brief.
This is the intended mechanism working, not scope creep.

**No contradiction with approved decisions, with one exception that must be
handled explicitly:**

- **DEC-P2 vs. DEC-2/DEC-13 (prior effort).** Sara previously chose real
  auto-write-back into `AGENT-PLAN.md` (DEC-2 = B, DEC-13 = A, both her calls,
  both against team recommendation). DEC-P2 now inverts the relationship: the
  file becomes an import source / read-only view, DB leads. These cannot both
  be fully true. DEC-P2 is the later ruling by the same stakeholder, so it
  governs — but the supersession of DEC-2/DEC-13 must be **recorded in both
  decision logs**, not left implicit, and the fate of `plan-writeback.js`
  (retire / repurpose as the export renderer / transition period) is a design
  decision this intake must produce. The request itself flags this
  (non-blocking open question #1). Note DEC-7's live-trial gate was widened
  specifically to cover auto-writes into `AGENT-PLAN.md`; if DEC-P2 retires
  unattended file writes, that half of DEC-7's scope dissolves with it —
  another reason the supersession needs to be written down, not inferred.

- **WATCH-3 (layer-7 portfolio rollup UI) is adjacent, not this.** This
  request's workbench is **per-project** (open one project → its plans + its
  pool). Cross-project rollup — any "all projects at a glance" value view —
  stays out. The brief already says this; I'm ratifying it as a scope boundary
  with acceptance force (see §6).

- **DEC-P4 (altitude) is a scope *ceiling*, pre-settled.** The dashboard DB
  holds exactly three things: delivered value, desired value, reconciliation.
  Guarded in §6 below.

- **WATCH-1 (target-date inference) and WATCH-5 (cost allocation)** remain
  unscheduled and are not smuggled in by this request. Confirmed by reading the
  request — it does not ask for either.

**Request type:** concur with the clerk's provisional `new-feature`
(portfolio-layer capability, sequel-style — most mechanical pieces have shipped
precedent).

## 3. Acceptance criteria

Concretized from Sara's acceptance sketch. "The workbench" below means
whatever UI surface slice 1+2 land on (recommendation: Project Detail page —
see §5), not necessarily a new page.

### AC-1 — Plans are lifecycle objects (DEC-P5, part A)
Done when: a project can have **two or more open plans simultaneously**, each
independently editable (add first-level items, nest sub-items via
`parent_item_id`), and creating a second open plan on a cwd neither errors nor
clobbers the first. The one-plan-per-cwd assumption is gone from every write
path and read surface.

### AC-2 — Import inversion loses nothing (DEC-P2)
Done when: an existing `AGENT-PLAN.md` imports as generation 1, and after
import, **no re-ingest path can delete or overwrite DB-authored plan items**
— specifically, the `deletePlanItemsNotIn` behavior (or its successor) is
proven by test to leave DB-only items intact. A project with no
`AGENT-PLAN.md` can still get a plan created directly in the DB (required for
DEC-P6's retroactive detour-bundle plans).

### AC-3 — The pool shows delivered-but-unclaimed value (part B)
Done when: opening a project shows a pool assembled from at least
(a) trunk merge commits matching `Merge effort/<slug>:` **mechanically linked
to their intake initiative**, (b) intake initiatives and stages, (c)
direct-to-trunk commits, with focus-session bracketing shown as *suggested*
attribution where available. Every pool item displays its **confidence tier**
(mechanical / correlational / judgment) and no correlational or judgment
attribution is applied without a human claim action. Already-claimed value
never reappears in the pool (ratchet).

### AC-4 — Claiming is a persisted judgment (part D)
Done when: pulling a pool item into a plan (attach to existing item, or create
an item from it) writes a **claims ledger row** that survives restarts,
re-scans, and re-ingests — claims are never recomputed or garbage-collected by
any automatic pass. Un-claiming, if offered, is an explicit human action only.

### AC-5 — Closure is deliberate, stamped, and permanent (DEC-P6, part A)
Done when: closing a plan is an explicit plan-level action that stamps a
closure date and accepts closure annotations; a closed plan (generation)
disappears from the "open" view, its claimed value counts as closed, the pool
shrinks correspondingly, and the closed generation is **browsable forever** —
no delete path exists for closed generations. There is **no other route to
"closed"**: no auto-close, no bulk "mark all done," no closure via file edit.

### AC-6 — The whole-life question is answerable (Sara's headline test)
Done when: for a project with ≥2 closed generations, one view (UI, and the
same data via API/`ccam`) answers "what value did this project deliver across
its life" from closed generations + claims — listing what closed, when, and
what evidence (commits/initiatives/detours) backs each claim. **This is the
acceptance test Sara should personally run on a real project (Coaching
Assistant is the named origin case) before this effort is called done.**

### AC-7 — Health metrics exist and agree with the ledger (part D)
Done when: unclaimed-pool size and time-since-last-closure are visible per
project, and each is computed in **exactly one shared server-side function**
consumed by every surface that renders it (§9.1 DERIVED-DUAL-VIEW — this is a
day-one requirement, not a refactor for later, because CLI/MCP/UI consumers
are all named in the request).

### AC-8 — Live-trial gate (carried from DEC-7's precedent)
Done when: Sara has used the workbench against her **real fleet data** on at
least one real project, pulled real value into a real plan, closed a real
generation, and judged the pool "signal, not noise." A green suite is not
sufficient sign-off on this surface — same standard the prior effort set.

Engineering-side acceptance (schema migration safety per §9.5/§9.6 incl. the
`rebuildTableAtomically` recommendation, chronology ordering per §9.2,
red-proven guards per §9.3/§9.7) is real and mandatory but belongs to QA/eng;
I note it here only so the DoD doesn't treat it as optional.

## 4. Priority & impact

- **Who is blocked:** no one is *hard*-blocked — the dashboard works today.
  But Sara's stated operating model (portfolio reconciliation across many
  concurrent projects) is missing its keystone, and the origin case is live:
  30 Coaching Assistant initiatives she cannot close out. The cost is paid
  continuously as archaeology.
- **Priority: HIGH — build next in this repo's portfolio thread**, per the
  confirmed vision memory ("reconciliation pass is the missing piece, build
  priority"). Not urgent in the outage sense; no external deadline.
- **Relative to DEC-7's open live-trial gate — RECOMMENDATION (auto-pilot
  call):** do **not** serialize this whole effort behind DEC-7. The first
  slice (schema + pool assembly + read surfaces, §5) shares no surface with
  the auto-write path DEC-7 gates. But two touchpoints must be sequenced:
  1. The DEC-7 live trial should run **during** slice 1 — it is cheap (Sara
     reviews real decision-queue output + any real auto-writes that landed),
     and its outcome directly informs the `plan-writeback.js` fate decision
     that DEC-P2 forces anyway.
  2. Nothing in this effort should extend or add call sites to
     `plan-writeback.js`'s file-write path until its fate is decided
     (SIGN-OFF-1, §7). Building new capability onto a possibly-retiring trust
     boundary is how we'd waste the most work.

## 5. Minimum first slice (wip-queue-page lesson applied)

The `wip-queue-page` precedent (built 2026-07-30, fully reverted two days
later, `18196dc`) failed at exactly this altitude: a whole portfolio UI shipped
in one shot before its underlying data proved worth rendering. The counter that
worked in the prior effort was DEC-3's "each layer shown to Sara before the
next starts." Apply the same shape here.

**RECOMMENDED slicing (auto-pilot recommendation, checkpoint after each):**

- **Slice 1 — lifecycle backend + pool, read-only. No new page.**
  Schema (generations, multi-plan, claims tables — full final shape in initial
  `CREATE TABLE` per the DEC-15 lesson; migration-safe for existing tables),
  `AGENT-PLAN.md` import-as-generation-1, pool assembly at the **mechanical
  tier only** (merge-slug matches + intake initiatives + direct-to-trunk
  commits listed unattributed), surfaced via API + `ccam` + a **read-only pool
  section on the existing Project Detail page**. Zero write gestures.
  **Checkpoint question for Sara: "Is this pool real value or noise?"** —
  the exact question whose wrong answer killed the wip-queue page, asked
  before the expensive UI exists.
- **Slice 2 — claim + close.** The claim action (pool → plan item), plan
  item editing, the close-plan action with stamp + annotations, closed-history
  browsing, health metrics. Still on Project Detail. This is the smallest
  slice that delivers the *actual* value (AC-4/5/6) — slice 1 alone is
  scaffolding.
- **Slice 3 — workbench ergonomics + correlational tier.** Two-pane layout
  polish (dedicated page only if Project Detail proves cramped in real use),
  focus-bracketing suggested attributions, LLM-proposed judgment-tier claims
  (human-gated), optional AGENT-PLAN.md read-only export.

**UI placement — RECOMMENDATION:** extend the just-shipped Project Detail page
rather than adding a new nav destination. It already answers "open a project →
see its repo/worktree topology and intake status"; plans + pool are the same
altitude, and a section on an existing page is a far cheaper revert than a page
+ nav entry + i18n across 4 locales if the concept needs rework (that revert
cost is precisely what `18196dc` paid).

## 6. Explicitly NOT in scope (guard rails)

1. **DEC-P4 altitude ceiling:** no repo-local pipeline detail enters the
   dashboard DB — no `decisions.md` content, no technical plans, no QA/build
   evidence, no per-solution artifacts. Pool items reference value units
   (commit, initiative, detour) by identity + summary line, and "engage with
   detail" means opening Claude in that repo, full stop. Any pool-item design
   that wants to *store* artifact content is a scope violation, not an
   enhancement.
2. **No cross-project rollup UI** (WATCH-3 stays deferred). Everything ships
   per-project.
3. **No target-date inference** (WATCH-1) and **no cost allocation**
   (WATCH-5) — unchanged.
4. **No new unattended file-write capability.** Whatever SIGN-OFF-1 decides
   about the existing `plan-writeback.js`, this effort adds no *new* paths
   that write into repo files on Sara's behalf. The optional AGENT-PLAN.md
   export, if built, is a generated read-only view, clearly marked as such,
   and is a §9.1 consumer from birth.
5. **No deletion of closed generations or claims, ever** — not even an admin
   endpoint "for cleanup." Permanence is the product guarantee (AC-5).

## 7. Stakeholder sign-off items (Sara only)

- **SIGN-OFF-1 — Fate of `plan-writeback.js` / supersession of DEC-2+DEC-13.**
  DEC-P2 makes the file a view; auto-writing dispositions into it contradicts
  that. *Recommendation:* retire unattended file-writes; `fold_in`/`new_item`
  dispositions write **DB plan items** instead (which the new model makes
  first-class), and the writeback machinery is repurposed as the read-only
  export renderer if/when that ships. But DEC-13 was Sara's explicit choice
  against team lean — only she can supersede it. Must be recorded in both this
  item's and the prior effort's decision logs.
- **SIGN-OFF-2 — Ratchet baseline for run #1.** Does the initial pool include
  full trunk history or start from a baseline? *Recommendation:* default
  baseline = per-project import moment, with an explicit opt-in "backfill
  history" action per project (Coaching Assistant will likely want backfill;
  most projects won't).
- **SIGN-OFF-3 — Claim cardinality.** *Recommendation:* schema permits
  many-to-many (one value unit claimable into multiple plan items — the
  request's own rationale mentions it), UI treats a second claim on an
  already-claimed unit as a deliberate, visible action, and a unit counts as
  "out of the pool" after its first claim. Needs Sara's confirmation because
  it defines what the health metric counts.
- **SIGN-OFF-4 — Slice-1 checkpoint is a gate, not a demo.** Confirm that the
  "pool: signal or noise?" review happens before slice 2 starts (this is the
  wip-queue insurance; auto-pilot cannot waive it).
- **SIGN-OFF-5 — DEC-7 live-trial scheduling.** Confirm running the still-open
  prior-effort trial in parallel with slice 1, since its verdict feeds
  SIGN-OFF-1.
