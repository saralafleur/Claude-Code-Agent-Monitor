# PM Plan — Build the Project Manager (Layers 4–6)

Intake: `intake/2026-08-01-build-project-manager/` · Date: 2026-08-01 · PM pass
Inputs read: `request-brief.md`, `supporting/product-owner.md`,
`supporting/architect.md`, `supporting/engineer.md`, `supporting/qa.md`,
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/pm.md`,
`PROJECT-CONTEXT.md`, the cross-project request-log and decision-log, and the
two auto-memory entries (`project_portfolio-reconciliation-vision.md`,
`project_holistic-focus-history.md`).

---

## 1. Request summary

Sara runs 12–20 concurrent Claude Code sessions across 8–10 projects and can
no longer answer "what are we building, are we on track, what did the last
hour accomplish, and how do detours map back to intent" without manually
rotating through every session — a workaround she describes as hitting a hard
scalability wall and being exhausting. Over a multi-turn design conversation
(today, this same session) she and Claude worked out and she explicitly
confirmed a 7-layer portfolio-management model. Layers 1–3 (objectives via
`AGENT-PLAN.md`, nested milestones via `plan_items.parent_item_id`, declared
activity via `ccam focus set/push/pop`) are already shipped. Layer 7 (a
portfolio rollup UI) is deliberately deferred until there are real verdicts to
render. This request is to build the missing middle: **layer 4** (give every
undeclared "detour" a resolved disposition instead of just observing it),
**layer 5** (a target date on plan items so pace is measurable), and **layer
6** (a periodic per-project reconciliation pass that quietly resolves routine
cases using fixed rules and surfaces to Sara only what genuinely needs a human
call).

## 2. Request type

**`new-feature`** — confirmed, upgrading triage's provisional call to final.

Reasoning, against each alternative:

- **Not `bug`.** Nothing works incorrectly. I verified directly that layers
  4–6 do not exist in any form: `grep` across `server/` and `client/src/` for
  `target_date`, `detour_disposition`, `decision_queue`, and a reconciliation
  module returns zero product hits (the only `reconciliation` matches are
  unrelated — remote-sync mirror reconciliation and a dashboard-runs startup
  pass). `server/lib/` contains no `pace.js` or `reconciliation.js`. There is
  nothing here that "never worked correctly"; there is nothing here at all.
- **Not `regression`.** Nothing worked and then broke.
- **Not `missed-requirement`.** This is the distinction worth being careful
  about, because this project's two most recent intakes were both classified
  `missed-requirement` and it would be easy to reach for that again. It does
  not apply: no prior effort ever promised disposition, pace, or
  reconciliation. `focus-inference.js` was scoped to *classify* undeclared
  session time and it does exactly that; the disposition step was never in its
  ask (pm.md's own word for layer 4 is "half-built," meaning half the
  *architecture* exists, not that half a commitment was delivered). The
  7-layer model itself was only articulated today. Nothing was built to an
  incomplete requirement — a new requirement was created.
- **Not `text/content-change`** or **`clarification-only`.**

**Sub-classification worth carrying into the technical plan:** this is a
*net-new subsystem built as a sequel*, not greenfield. Every mechanical piece
has a shipped precedent in this exact repo — the periodic-scheduler shape
(`focus-audit.js`, `focus-inference.js`, `update-scheduler.js`), the hermetic
LLM-spawn contract (`runClaudePromptJson`), the fail-safe rule pass
(`session-liveness.js`), the audit-trail queue table
(`alert_rules`/`alert_events`), and the "DB field deliberately protected from
file re-ingest" idiom (`plan_items.declared_done_at`). That is why the
engineer sizes this S+M+M rather than L, and it is the strongest argument for
proceeding: almost nothing here requires inventing a new pattern.

**Cost framing:** this is a **new ask, Sara's cost** — not warranty work on a
prior delivery. Two small close-out items ride along at our cost (§6).

## 3. History / background — where this is coming from

**Have we seen this before? As a *build request*: no, this is the first time.
As a *design thread*: yes, three times, and that is the important finding.**

I searched the cross-project request-log and decision-log for every prior
touch of this surface. This project (`Claude-Code-Agent-Monitor`) has four
prior intake cycles logged, none of which asked for detour disposition, pace
tracking, or a reconciliation pass. Zero prior entries mention any of them.

Timeline:

| Date | Event | Relevance |
|---|---|---|
| 2026-07-26 | `focus-report-fidelity` (missed-requirement) | Fixed one consumer of `focus-report.js`, not the other. First naming of this repo's chronic multi-consumer-drift shape. |
| 2026-07-26 | `focus-calendar-board` (new-feature) | Created a 3rd consumer of the same surface; DEC-1..6 mandated "extract shared component, don't copy-paste" + a standing cross-view parity test. |
| 2026-07-28 | `wip-queue-page` (new-feature) | **The first portfolio-altitude feature this repo ever built** — a live priority-ordered cross-project queue, new `projects.priority` column, DnD reordering, 9 auto-piloted defaults. Approved and built. |
| **2026-07-30** | **commit `18196dc` — "Remove the WIP queue feature"** | **Fully reverted two days after shipping**: the `/wip` route, nav entry, i18n namespace, both components, `wipQueue.ts`, the `projects.priority` column (dropped via guarded migration), and `PUT /api/projects/reorder`. See §4 — this is the single most instructive piece of history for this request. |
| 2026-07-28 | `holistic-focus-history` memory updated | Hierarchical LLM window summaries shipped — the direct precedent layer 6's LLM half should copy. |
| 2026-07-31 | `focus-untracked-commits` (missed-requirement) | Retroactive intake for 7 un-intake'd focus-report commits. Its RECOMMEND-1 (finally catalogue the two recurring defect classes, after 4 prior punts) **has since landed** — `PROJECT-CONTEXT.md` now carries §9.1 DERIVED-DUAL-VIEW and §9.2 row-id-as-chronology-proxy. |
| 2026-08-01 (today) | Multi-turn design conversation with Sara | Produced the confirmed 7-layer model, the confirmed hybrid-escalation split, and four explicitly-open questions. Captured to `pm.md` and to the `portfolio-reconciliation-vision` memory (whose `originSessionId` is this same session). |
| 2026-08-01 (today) | This intake | pm.md's own "Open question #1" was literally *how to move from design to build*; running this intake is the answer to it. |

**Settled decisions this request touches (cited, not re-litigated):**

- **pm.md's "Decided (confirmed): hybrid escalation, not uniform"** — fixed
  rules decide *whether* to escalate (pace vs. target date, detour-volume
  ratio); an LLM judgment pass decides only *what a detour is* once flagged.
  This is stated in the same register as the 7-layer framing itself ("yes this
  tracks to the intent I shared"). Any implementation that inverts it is
  **non-compliant, not an alternative interpretation**. The PO, architect,
  engineer, and QA all independently flagged this and all four designed
  against it correctly.
- **`focus-calendar-board` DEC-2 / `wip-queue-page` DEC-2** — shared
  extraction over copy-paste for any value with more than one consumer. Binds
  here (§4).
- **`focus-untracked-commits` RECOMMEND-1** — now landed as PROJECT-CONTEXT.md
  §9.1/§9.2. Binds here as written policy, not as a re-derived judgment call.

**Does this request contradict anything already settled? No.** But **pm.md
itself contains a factual error that must not propagate**: it names "the
existing `/loop` mechanism" as a candidate for the reconciliation pass's
process shape. The architect and the engineer independently grepped for it and
found nothing — no `/loop` file, script, skill, or command exists anywhere in
this repo (I re-verified: `.claude/commands/` does not exist). The real
established convention is an in-process `setInterval` started from
`server/index.js`, used by six existing periodic jobs. pm.md and the
`portfolio-reconciliation-vision` memory both need this correction (§6).

## 4. Recurrence diagnosis

This is a new request, so there is no defect recurrence to diagnose. There
are, however, **two live recurrence risks and one behavioral pattern** that
this plan exists to get in front of.

### 4a. The design thread has recurred three times without producing a line of code

The same 7-layer model, the same four open questions, and the same "layer 6 is
the missing piece" conclusion have now been captured in three separate durable
places: the `holistic-focus-history` memory (2026-07-28 refinements), the
`portfolio-reconciliation-vision` memory (2026-08-01), and `pm.md`
(2026-08-01) — the last of which explicitly says it was distilled from the
second and that the two must be kept in sync. That is not a defect; it is
**deliberation recurring instead of delivery**. pm.md's own first open
question is "how to move from design to build," with "keep designing in chat
first" listed as one of the options.

**Systemic cause:** the four open questions were never converted from prose
into recorded decisions, so each new session re-encounters them as open and
re-captures the same framing. **Durable fix:** this cycle must end with those
four questions marked DECIDED in a `decisions.md` for this intake (this
project already has the convention —
`intake/2026-07-26-focus-calendar-board/decisions.md`), not carried forward as
"assumptions." Both the PO and the architect independently asked for exactly
this. It is the cheapest thing in this plan and the one that stops a fourth
capture.

### 4b. DERIVED-DUAL-VIEW (§9.1) — pre-flagged, not yet an occurrence

This work introduces **three brand-new derived values at once** (pace status,
detour disposition, decision-queue entry) and has a deliberately-deferred
layer-7 UI queued to become their second consumer. §9.1's own citation history
(4 touches) shows the failure never happens when a value is introduced — it
happens the moment a second consumer appears and re-derives instead of
calling. **This is therefore a scheduled-in-advance recurrence unless the
computation is written as one shared function on day one, before any second
consumer exists.** The architect, engineer, and QA all independently reached
this same conclusion. I am **not** incrementing §9.1's occurrence count — no
code exists yet and this is design-time risk flagging, consistent with the
precedent set in the 2026-07-24 `simulator-mode-switch` cycle.

### 4c. The WIP-queue removal is the cautionary precedent, and it is directly on point

Three days ago this repo built its first portfolio-altitude feature through
this exact pipeline. Two days ago it was removed in full, schema column and
all. That is not a criticism of the build — the code discipline held — it is a
signal about **what kind of feature is hard to get right here**: cross-project
management surfaces are judged almost entirely on whether Sara actually reaches
for them in daily use, and that judgment cannot be made from a spec. The PO
reached the same place from a different direction (acceptance criterion 8:
"signal, not noise" is a taste judgment only Sara can close).

**What this changes about how we build:** sequence so that Sara gets something
she can *use and judge* as early as possible, and treat a live-trial
checkpoint as a real gate rather than paperwork. It also independently
validates keeping layer 7 out of scope — building the rollup UI before layer 6
produces verdicts worth rendering is exactly how you get another `18196dc`.

## 5. Where this is coming from — root source

**Changed/new requirement, from a design conversation — not drift, not a
missing test, not a misunderstanding.** Layers 1–3 were built correctly and
still work. The gap is that until today nobody had articulated that
observation without disposition, and milestones without target dates, add up
to something that cannot answer "are we on track." The request is the direct,
well-evidenced output of Sara naming her own current pain in the present
tense.

One genuine surprise surfaced during evaluation that changes the shape of the
build, and it is the single most important technical finding in this intake:

### The engineer's finding: `AGENT-PLAN.md` is human-owned and the dashboard never writes it

`server/lib/plan-ingest.js` states this in its own header — "The file is the
source of truth — the dashboard never writes it" — and the engineer confirmed
no write-back path exists anywhere in the repo. I verified the enforcement
mechanism directly:

```sql
DELETE FROM plan_items WHERE cwd = ? AND item_id NOT IN (SELECT value FROM json_each(?))
```

That is `deletePlanItemsNotIn` (`server/db.js:2183`), run on every ingest. Any
plan item written straight to the DB — with no corresponding entry in the
markdown file — **is deleted on the very next poll or SessionStart ingest.**

This collides head-on with two of layer 4's four dispositions. "Fold into the
plan as a new milestone" and "spin into a new plan item" both mean *creating a
plan item*, which today is only possible by a human editing `AGENT-PLAN.md`.
The other two dispositions ("deliberate accepted deviation," "discard as
noise") are pure metadata about a detour and have no conflict at all.

**Resolution — my call, elevating what the architect left implicit:**
**disposition is advisory-only. No file write-back.** The architect's
assessment does not resolve the engineer's fork in so many words, but every
piece of its reasoning points one way: it identifies the plan-ingest
file-ownership contract as a first-class boundary in §1, and its entire Q3
recommendation (put `target_date` in the DB, out-of-band, protected from the
upsert, *specifically because* the file overwrites everything it owns on every
ingest) is the same principle applied to a smaller field. Option (b) — giving
the dashboard a real `AGENT-PLAN.md` write-back capability — is a genuine
scope expansion that also needs conflict handling against concurrent human
edits (ingest is purely content-hash/mtime driven and has no notion of "my own
edit" vs "a human's edit"), has zero prior art in this codebase, and would
raise layer 4 from M to L.

So: for `fold_in` and `new_item`, layer 4 records the disposition, links it to
the detour, and produces a **ready-to-paste markdown snippet** that Sara (or an
agent she directs) drops into `AGENT-PLAN.md`. The plan file stays hers.

**This needs Sara's explicit sign-off (DEC-2 below), because it partially
redefines the ask.** "Resolve, don't just observe" becomes fully automatic for
two of four dispositions and one-click-plus-a-paste for the other two. I think
that is the right trade — it preserves the invariant that the plan is a
human-owned document, which is the whole reason layers 1–2 stay at stakeholder
altitude — but it is her call, not ours.

**Knock-on correction the tech lead must apply:** QA's layer-4 test spec
currently asserts that a `fold_into_plan` disposition "produces a new
`plan_items` row … and the row's identity survives a subsequent
`AGENT-PLAN.md` ingest." Under current ingest semantics that test cannot pass
— `deletePlanItemsNotIn` will remove it. Those test cases must be rewritten
against the advisory-only model once DEC-2 lands. This is a conflict between
two evaluator documents, not a defect; flagging it so it is caught at planning
time rather than during a red test run.

## 6. Recommendation to the human

**Approve the build, on the architect's four recommendations, in the sequence
below, with the advisory-only resolution to the plan write-back fork.**

### Recommended build sequence: layer 5 → layer 4 → layer 6

The engineer derived this from hard dependencies and the architect arrived at
the same ordering independently via which decisions unblock which. I concur,
and add a delivery-risk reason of my own.

1. **Layer 5 first (effort S).** `plan_items.target_date`, the additive
   migration, and a shared pace-comparison function. Layer 6's fixed-rule half
   literally cannot run without it. It is the smallest slice, has no
   dependencies, and matches pm.md's own "start with the smallest concrete
   slice" instinct — while, unlike that instinct, still landing inside a plan
   rather than instead of one.
2. **Layer 4 second (effort M).** The durable `detour_dispositions` record.
   Layer 6's LLM half needs something with stable identity to write a verdict
   onto. Built after 6, the pass would have to re-derive "what detours exist"
   from `focus_inferences` every tick — defeating the entire point of
   persisting a decision.
3. **Layer 6 last (effort M, given 4 and 5 exist).** The scheduler, the
   fixed-rule pass, the LLM classification pass, and the `decision_queue`.

**My addition to the sequencing:** treat each step as independently useful and
show it to Sara before starting the next. Layer 5 alone already answers "which
items are behind" via CLI. Layer 4 alone already gives detours a resolved
state. That cadence is the direct counter to the WIP-queue outcome (§4c) —
three chances to hear "this isn't what I reach for" instead of one, at the
end.

### Adopt as a batch (architect's Q1–Q4, all four recommendations)

- **Q1** — new `detour_dispositions` table, separating durable *decisions*
  from the classifier's re-derivable *observations*. Critically, per the
  engineer, the disposition record must be created **at classification time**
  inside `inferSession`, not read lazily off `focus_inferences` later —
  `focus_inferences` is one upserted row per session and a detour's identity
  does not survive re-inference. And **no cascading FK on `session_id`**,
  following `alert_events`, so disposition history outlives session cleanup.
- **Q2** — new `decision_queue` table shaped like (but deliberately not
  reusing) `alert_rules`/`alert_events`. Minimal, queryable via CLI/API now;
  renderable by layer 7 later with zero schema change.
- **Q3** — `plan_items.target_date`, plain additive `ALTER TABLE`, authored
  **out-of-band** via a new route/`ccam` command and **excluded from
  `upsertPlanItem`'s `SET` list**, mirroring `declared_done_at` literally.
  This is the same principle as DEC-2 and follows from it.
- **Q4** — a new in-process scheduler (`server/lib/reconciliation.js` +
  `startReconciliation()`, wired from `server/index.js`), copying the
  `focus-audit.js` tick shape almost verbatim. **Not** `/loop` (does not
  exist) and **not** OS cron (a second process on the same SQLite file
  introduces WAL contention and a second path to the WebSocket broadcast —
  §9.1's shape at the process level).

### Non-negotiables to carry into the technical plan

1. **The hybrid split is structural, not conventional.** Rule evaluation and
   LLM classification live in two separate, independently testable functions
   with a one-directional call (rules → what to send the LLM). QA's
   stub-the-LLM-to-throw test is the enforcement. A single "ask the LLM to
   decide everything" call is the easy, quiet violation of a decision Sara has
   already made.
2. **Fail-safe per stage, not one top-level try/catch.** Match
   `session-liveness.js`'s stated contract: no trustworthy read → change
   nothing. A partial failure must never leave `decision_queue` and
   `detour_dispositions` inconsistent with each other.
3. **§9.1 compliance by construction.** Pace status, disposition, and queue
   entries each computed by exactly one shared function from day one, before a
   second consumer exists.
4. **§9.2 compliance.** Every "recent detours / recent sessions" query sorts
   `ORDER BY created_at, id` — with the sort **before** any `LIMIT`, per the
   catalog's own acceptance criterion.
5. **Cost control by design.** Zero LLM spawns on a tick where the rules flag
   nothing; content-digest gating so an unchanged flagged set is not
   re-classified; batch a project's flagged detours into one prompt. All three
   have shipped precedents in `focus-summary.js`.
6. **The live-trial gate is real.** Per the PO's acceptance criterion 8, a
   passing test suite is not sufficient sign-off. Sara reviews decision-queue
   output against her real fleet for a period before this is called done.

### Close-out items at our cost (cheap, do not defer)

- Correct the `/loop` claim in `pm.md` and in the
  `portfolio-reconciliation-vision` memory — it does not exist, and leaving it
  will mislead the next session that reads either file cold.
- Sync both memory entries once layers 4–6 land; they currently describe all
  three as missing/undesigned, and pm.md itself instructs keeping them
  current.
- Update `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md` per this repo's
  own `update-project-docs` trigger (new schema, new scheduled process, new
  API/CLI surface).

## 7. Open decisions for the user

Recommend these land as a `decisions.md` in this intake folder (this
project's own convention) — that artifact is the durable fix from §4a, not
optional paperwork.

| id | Decision | PM recommendation | Needs Sara? |
|---|---|---|---|
| **DEC-1** | Classification and scope: `new-feature`, layers 4–6 only, layer 7 stays out with a WATCH row against opportunistic creep | Confirm as stated | Cheap confirm |
| **DEC-2** | **Plan write-back fork.** `fold_in`/`new_item` dispositions cannot create `plan_items` rows — `deletePlanItemsNotIn` deletes them on next ingest. Advisory-only (record disposition + emit a paste-ready markdown snippet) vs. build real `AGENT-PLAN.md` write-back | **Advisory-only.** Preserves the human-owned-file invariant; write-back is a real scope expansion (layer 4 M→L) with no prior art and unsolved concurrent-edit handling | **Yes — this partially redefines "resolve, don't just observe." Highest-stakes item in this plan.** |
| **DEC-3** | Build sequence | Layer 5 → 4 → 6, each shown to Sara before the next starts | Cheap confirm |
| **DEC-4** | Architect's Q1–Q4 as a batch (`detour_dispositions`, `decision_queue`, out-of-band `plan_items.target_date`, in-process scheduler) | Adopt all four | Cheap confirm |
| **DEC-5** | **Pace math's completion signal:** `checked` (human-authoritative, from the file) vs `declared_done_at` (the agent's own claim via `ccam focus done`). These can and do disagree. The architect did not cover this; the engineer raised it | `checked` as primary, `declared_done_at` as a secondary/earlier signal. Whichever is chosen, layer 6's rule must use the **same** signal layer 5's utility uses — never re-derive its own | **Yes — this defines what "on track" means** |
| **DEC-6** | `target_date` format: date-only `YYYY-MM-DD` local calendar day vs. ISO-8601 UTC instant like `declared_done_at` | Date-only. "By Friday" is a calendar day; a UTC instant invites off-by-one pace comparisons | Cheap confirm |
| **DEC-7** | Live-trial gate before "done" (PO AC #8) | Adopt as a non-optional DoD item, with Sara's own read of decision-queue output as the pass criterion | Cheap confirm |
| **DEC-8** | Close-out obligations: `/loop` correction in pm.md + memory, memory sync post-build, doc updates | Adopt; ours to absorb | Cheap confirm |
| **DEC-9** | LLM kill switch: reuse the existing `DASHBOARD_FOCUS_INFER_MODE` so "disable the LLM path" means one thing everywhere (architect's lean) vs. a new `DASHBOARD_RECONCILE_MODE` (engineer's proposal). A genuine, minor evaluator split | A **new** `DASHBOARD_RECONCILE_MODE` for on/off/interval, so reconciliation can be disabled without also disabling session classification — but it must additionally **honor** the existing focus-infer kill switch, so turning that off still stops all LLM spawns | Tech-lead call, flag to Sara |
| **WATCH-1** | Target-date *inference* (auto-estimating dates) explicitly deferred | PENDING row so it isn't silently expected to work later | — |
| **WATCH-2** | Cross-plan lifecycle reconciliation (plan on hold / superseded / archived — the open thread in `holistic-focus-history`) is **not** modeled by layer 6. At minimum the tick must skip an archived/missing plan gracefully rather than fire a false pace alarm on a dead plan | WATCH row | — |

**Correction for the tech lead, not a decision:** QA's layer-4 spec asserts
that `fold_into_plan` creates a `plan_items` row surviving re-ingest. That is
impossible under current ingest semantics and must be rewritten against
whatever DEC-2 resolves to.

---

### Summary judgment

Approve. This is a coherent, well-evidenced response to a real present-tense
pain, scoped by Sara's own prior prioritization rather than by the intake
process, and every mechanical piece has a shipped precedent in this repo. The
two things that will decide whether it succeeds are not code-quality
questions: **DEC-2** (does Sara accept advisory-only disposition, given the
plan file stays hers) and the **live-trial gate** (does she actually reach for
the decision queue instead of falling back to manual rotation). The
WIP-queue removal three days ago is the reason to take the second one
seriously, and the reason to ship layers 5, 4, and 6 as three judgeable
checkpoints rather than one delivery.
