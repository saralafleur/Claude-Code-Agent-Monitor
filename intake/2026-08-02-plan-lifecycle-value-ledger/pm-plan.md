# PM Plan — Plan lifecycle + value ledger ("plans as closable value-buckets")

**Intake item:** `intake/2026-08-02-plan-lifecycle-value-ledger/`
**Role:** intake-project-manager · **Date:** 2026-08-02 · **Run mode:** auto-pilot
(preference-level calls recorded as recommendations, not questions)
**Inputs read:** `request.md`, `request-brief.md`, `decisions.md` (DEC-P1..P6),
all four `supporting/` assessments, `PROJECT-CONTEXT.md` §9.1–§9.7,
`intake/2026-08-01-build-project-manager/decisions.md`,
`intake/2026-08-02-trunk-drift-detection/decisions.md`,
`~/.claude/skills/team-intake/memory/request-log.md` + `decision-log.md`,
and Sara's **live** `~/.claude/agent-dashboard/dashboard.db` (findings in §3.4/§5.3).

---

## 1. Request summary

Sara wants the project plan to become the **closure layer** of the monitoring
stack. Today three layers each answer a different question — focus answers
"what happened," intake answers "what's in motion," plans answer "what's
intended" — and nothing answers "what's *done and declared*." Delivered effort
(trunk commits, merged initiatives, detours) piles up faster than any forward
plan and is never bundled into a communicable outcome, so "did we clear the
milestone or are we just having fun?" is only answerable by archaeology. The
ask: DB-backed plans with **open → closed generations** (retained forever,
multiple open concurrently per project), an automatically assembled **pool of
delivered-but-unclaimed value**, a **two-pane workbench** to pull pool items
left into plan items, and a **claims ledger** that persists those judgments —
with the invariant that **the plan is the only door value exits through**.

---

## 2. Request type — **`new-feature`** (confirmed)

All four evaluators proposed `new-feature`; I concur, and the classification is
not marginal:

- **Not `missed-requirement`.** The prior effort did not fail to deliver this.
  `intake/2026-08-01-build-project-manager/decisions.md` **WATCH-2** records
  cross-plan lifecycle reconciliation as *deliberately unscheduled, pending its
  own design brief*, with a named partial mitigation shipped in its place (the
  reconciliation tick skips `missing_at` / planless cwds). This request **is**
  that thread arriving with its brief. WATCH rows exist precisely so a later ask
  is a new intake rather than a bug against an old delivery — that mechanism is
  working as designed.
- **Not `regression` or `bug`.** Nothing here worked and broke. Every named
  surface (`plans`/`plan_items`, `plan-ingest.js`, `detour_dispositions`,
  `reconciliation.js`) behaves as specified.
- **Not `text/content-change` or `clarification-only`.** New tables, new routes,
  new UI, new semantics.

### One cost carve-out inside the `new-feature` classification

Following the precedent this repo set eight hours earlier on
`trunk-drift-detection` (WATCH-4's CHECK-widening rebuild priced as *accepted
debt coming due*, not new-ask scope), one slice of this request is **our cost,
not a new ask**:

> **The unwinding of `plan-writeback.js`'s unattended file-write path is debt
> from DEC-2/DEC-13, not scope Sara is asking us to add.** She chose real
> auto-write-back on 2026-08-01 against the team's recommendation; DEC-P2 now
> reverses that direction. Retiring what we built at her direction is ordinary
> lifecycle cost. It is *not* a defect — the code does exactly what DEC-13 asked
> — so it is neither a bug nor a regression; it is the ordinary cost of a
> stakeholder changing a settled direction, and it should be scheduled and
> named rather than absorbed silently.

### Cross-effort supersession — recorded explicitly (both trails)

**DEC-P2 (2026-08-02, Sara) supersedes DEC-2 = B and DEC-13 = A
(2026-08-01, Sara).** These cannot both be fully true: DEC-2/DEC-13 make the
dashboard an unattended *writer* of `AGENT-PLAN.md`; DEC-P2 makes the file an
*import source and read-only view* with the DB leading. The later ruling by the
same stakeholder governs. Consequences that must not be left implicit:

1. **DEC-7's live-trial gate was widened *specifically* to cover "the actual
   content auto-written into her `AGENT-PLAN.md` files."** If DEC-P2 retires
   unattended file writes, roughly half of DEC-7's scope dissolves with it. It
   does **not** dissolve retroactively: two unattended writes have already
   fired on Sara's real fleet and one **failed** (§3.4). The trial still owes an
   answer about what already happened, even if the mechanism is retired.
2. **`plan-writeback.js` (~680 lines of sanitizer + optimistic content-hash lock
   + backup + EOL preservation + `single-writer-guard.test.js`) exists solely
   because the file was human-owned and DB-only rows got deleted.** Under
   DEC-P1/P2 that entire problem class disappears for the new layer.
3. This supersession must be written into **both** decision logs — this item's
   `decisions.md` **and** `intake/2026-08-01-build-project-manager/decisions.md`
   (as a status amendment on DEC-2 and DEC-13), plus the shared decision-log.
   §9.4's lesson applies at the *decision* layer too: a settled item that
   silently stops being true is the same failure shape as a review finding that
   is neither fixed nor recorded.

---

## 3. History / background — where this is coming from

### 3.1 The design thread (four captures, one delivery)

| When | What | Outcome |
|---|---|---|
| — | `holistic-focus-history` session memory | 7-layer portfolio model, "open, undesigned" |
| — | `portfolio-reconciliation-vision` session memory | same model; "reconciliation pass is the missing piece, **build priority**" |
| — | `pm.md` | same model restated |
| 2026-08-01 | `build-project-manager` | Layers 4–6 **built**; layer 7 deferred (WATCH-3); plan lifecycle deferred (**WATCH-2**) |
| 2026-08-02 | **this request** | WATCH-2's thread, with its design brief and DEC-P1..P6 pre-settled |

The 2026-08-01 PM plan named the recurrence on this thread precisely:
**deliberation was recurring instead of delivery** — the same model and the same
open questions were re-captured three times with no schema line written, because
the questions were never converted from prose into recorded decisions. The
durable fix applied then (end the cycle in a `decisions.md`) worked: layers 4–6
shipped. Sara arriving here with DEC-P1..P6 already settled *before* intake
started is that same fix applied one level earlier. **This is the pattern
breaking, not repeating.**

### 3.2 The portfolio-altitude UI scar (1x, decisive)

`wip-queue-page` (request-log 2026-07-28) was this repo's **first**
portfolio-altitude UI feature. It went through this exact pipeline, was
approved, was built — and was **fully removed two days later** in `18196dc`:
route, nav entry, i18n across four locales, components, and the
`projects.priority` column. It has been cited as the governing sequencing
precedent in **every** portfolio-adjacent PM plan since (`build-project-manager`
DEC-3/WATCH-3, `practice-kind-override`, `trunk-drift-detection` DEC-1's phase
split). All four evaluators cited it independently this cycle. It is the single
most load-bearing piece of history for this request.

### 3.3 The defect-class catalog — every failure mode of this build has a prior

The feature is new; **its failure modes are not.** Catalog matches:

- **§9.1 DERIVED-DUAL-VIEW** — 5 counted occurrences, plus design-time
  pre-flags on `build-project-manager`, `practice-kind-override`, and a
  *retracted* one on `trunk-drift-detection`. **Directly implicated here:**
  DEC-P2 announces **three-to-four consumers of the same derived values on day
  one** (workbench UI, `ccam`, MCP, optional AGENT-PLAN.md export). The entry's
  own history says the failure lands when consumer #2 appears — here consumers
  2–4 are named in the request itself. Aggravating fact the engineer surfaced:
  `mcp/src/tools/` has **zero** plan tools and `ccam` reads plans only via
  `/api/plans/*`, so those consumers are **net-new work**, not adaptations —
  i.e. three fresh opportunities to hand-copy a formula.
- **§9.2 row-id-as-chronology-proxy** — 4 discovery sites. Focus-bracketing of
  direct-to-trunk commits walks `events`/`focus_inferences`/`sessions`; every
  such query needs `ORDER BY created_at, id` **before** any `LIMIT`.
- **§9.3 VACUOUS-GUARD** — 6 shapes in one build, survived two BLOCKED verifier
  passes. Every structural guard this build writes must have a **recorded red
  state**.
- **§9.4 FIX-ROUND-REGRESSION** — the fix round is a build round; and its
  unfixed remainder is invisible unless every finding ends *fixed-with-a-test*
  or *recorded-in-decisions.md-with-an-id*.
- **§9.5 FRESH-DB-BLIND** / **§9.6 NON-ATOMIC REBUILD** — 5 latent non-atomic
  rebuild sites live in `server/db.js` today; `rebuildTableAtomically` is
  **recommended but still not built**.
- **§9.7 HAND-SCOPED STRUCTURAL SCAN** — 4 flagged instances, the newest catalog
  entry. **Confirmed live for this build:**
  `server/__tests__/chronology-ordering.test.js:80-86` hand-types a **5-file**
  `filesToScan` list (`db.js`, `detours.js`, `reconciliation.js`,
  `routes/detours.js`, `routes/decision-queue.js`), and
  `GRANDFATHERED_QUERIES.length` is asserted `=== 2`. A new `value-pool.js` is
  outside that list by default, so **every §9.2 obligation in Part B would be
  unenforced while the suite stays green** — §9.7's exact shape, pre-flagged
  before a line is written.

### 3.4 Live-fleet state (pulled this pass; nobody else had it)

Read directly from `~/.claude/agent-dashboard/dashboard.db` (4.2 GB):

- **DEC-7's live trial is still un-run, and unchanged since the trunk-drift PM
  pass ~5h earlier.** `detour_dispositions` now holds **26 rows across the
  fleet**, of which **24 are `pending`**. Exactly two have ever been disposed,
  both `decided_by='llm'`, both unattended: **id 3** (`new_item`,
  `write_status='written'`) and **id 19** (`fold_in`,
  **`write_status='failed'`**). `decision_queue` still holds exactly **two**
  rows — id 1 `detour_volume` and id 2 `writeback_failed` — **both `pending`,
  both unreviewed**, filed 2026-08-02 14:03–14:04.
  **A 1-of-2 failure rate on unattended writes into Sara's stakeholder document
  remains unexamined.** This is the strongest independent argument for DEC-P2's
  direction, and it is evidence the trial should still happen even though DEC-P2
  retires the mechanism.
- **Plan-identity fan-out is already real on the live fleet** (see §5.3) —
  10 `plans` rows representing 8 distinct plans.

### 3.5 Concurrency: three efforts are live in this repo right now

`git worktree list` shows master plus **two active effort worktrees**
(`2026-08-02-practice-kind-override`, `2026-08-02-trunk-drift-detection`), both
with uncommitted work in `server/lib/`, `server/db.js`, and the client. The
project's own auto-memory (`concurrent-session-risk`) records that this has
caused real work loss. This request would be the **fourth** concurrent touch of
`server/lib/`.

### Verdict: have we seen this before?

**The capability: NEW (0 prior request-log matches).**
**Its failure modes: SEEN, repeatedly — §9.1 (5x), §9.2 (4x), §9.3 (6 shapes),
§9.4 (2 forms), §9.5, §9.6 (5 latent live sites), §9.7 (4x).**
**Its sequencing risk: SEEN once, decisively — `wip-queue-page` / `18196dc`.**

---

## 4. Recurrence diagnosis

### 4.1 The systemic cause behind §9.1–§9.7 (one root, seven symptoms)

Every catalog entry on this project reduces to the same mechanism: **a rule is
agreed in prose and enforced by a human remembering it.** The catalog's own
history shows the escalation ladder and where it currently sits:

1. Prose rule in a doc → not enforced → recurs.
2. Behavioral test → passes for the case it was written for → the *next*
   consumer is unguarded (§9.1's original form).
3. Structural scan → real and red-provable → but its **scope is hand-typed**,
   so it is green and blind (§9.7 — the newest and now most common form).

The next rung, recommended in §9.6 and §9.7 and **still not built**, is a scan
whose scope is **derived from the artifact** (`Object.keys(require(...))`, the
file's actual SQL literals, the module's real export list) so that adding a
member breaks the scan until someone gives it a disposition.

**This build is where that rung gets built, or the pattern wins again.** It adds
a new lib module with chronology-sensitive queries, a new derived value with
3–4 announced consumers, and a new "one function composes the close write" rule
— i.e. it is a fresh instance of §9.1, §9.2 and §9.7 simultaneously.

### 4.2 The second, larger recurrence — and the reflexive point about this request

Separately, this repo has a **process** recurrence that all three of the last
PM plans named: *new capability ships direct-to-trunk with nothing recording it,
found only by after-the-fact review* — **3x on this repo** (7 commits
2026-07-31; the whole Coach/Playbook surface 2026-08-02; 8 more un-intake'd
`feat` commits found on master by the trunk-drift PM pass), plus 2x
cross-project. The same durable fix has been recommended **three times and
adopted zero times**, because it is a process rule requiring a human to remember
it at commit time, wired into nothing that runs.

**This request is the first thing in the queue that structurally attacks that
recurrence rather than reminding someone about it.** An unclaimed-value pool
that automatically surfaces every merge commit, direct-to-trunk commit and
intake initiative that has *not* been claimed into a plan is, mechanically, a
standing report of exactly the work that shipped without being recorded — and
the health metric ("size of the unclaimed pool") is a number for the chronic
condition. That materially raises this request's strategic value above "another
portfolio feature," and it is the reason I am recommending approval rather than
deferral behind the two in-flight efforts.

### 4.3 What makes *this* build's recurrence risk unusual

The `wip-queue-page` failure was not a coding failure. It was **an expensive UI
built before anyone checked whether the underlying data was worth rendering.**
The single question that would have prevented it — *"is this pool signal or
noise?"* — is answerable here **before** the workbench exists, via API and
`ccam`, on Sara's real Coaching Assistant data. Every evaluator independently
proposed a slicing that puts that question first. That convergence is the plan.

---

## 5. Where this is coming from (root source)

**Primary: a stakeholder-changed requirement, plus a deliberately deferred
thread arriving on schedule.** Not drift, not a misunderstanding, not a missing
test.

1. **Changed requirement (DEC-P2 supersedes DEC-2/DEC-13).** Sara reversed the
   file-vs-DB direction one day after settling it. The reversal is
   well-founded — DEC-2's own follow-through required a 680-line write-back
   module, and the live data (§3.4) shows a 1-of-2 unattended-write failure rate
   — but it is a direction change, and its unwinding cost is ours.
2. **Deferred thread maturing (WATCH-2).** The mechanism worked exactly as
   intended.
3. **A live operational pain.** 30 Coaching Assistant initiatives that cannot be
   closed out is the originating case; it is real, current, and it is the
   dataset the checkpoint should use.

### 5.3 A live-data root cause nobody else could see — plan/project identity fan-out

The `plans` table is keyed by `cwd`. On Sara's real DB **10 `plans` rows
represent 8 distinct plans**, and the duplication has **three independent
mechanisms**:

| Mechanism | Live evidence |
|---|---|
| **Case-insensitive filesystem** | `/SARA/DND` and `/SARA/dnd` are **the same directory** (`stat` confirms identical inode `17996204`) but are two `plans` rows with **identical** `content_hash` `966c7a8f…`, mapped in `project_paths` to **two different `project_id`s** (`52cd5a8c…` and `26b989c5…`) |
| **Effort worktrees** | `/SARA/New-Group-efforts/2026-08-02-clockify-verify-button` has its own `plans` row with `content_hash` `b8d50721…` — **byte-identical to `/SARA/New Group`'s** — and **no `project_paths` mapping at all**, so it is invisible to any project-keyed aggregation |
| **Renamed directories** | `games/lost-an-adventure-…` (11 items, `missing_at` set) vs `games/lost-and-found-an-adventure-…` (14 items) — a stale row left behind by a rename |

**Why this matters more than it looks.** This request's headline acceptance
test is *"what value did this project deliver across its life."* On today's data
that question, asked about the D&D project, would answer from **one of two
project ids** and silently omit whatever accrued under the other. The
DEC-P2 import ("existing plans import as generation 1") would create **two
generation-1s from one physical file**. And the value that most needs claiming —
work done in `*-efforts/` worktrees — currently has **no project home at all**.

This is not a reason to reject the design (project-level keying is right; the
architect's `project_id` soft-ref approach is right). It is a reason to (a) make
**import idempotency keyed on `content_hash` + `project_id`, not on `cwd`**, (b)
resolve every cwd through its **git common-dir / repo root** before attributing
value, so worktree cwds fold into their parent repo, and (c) **clean up the
`DND`/`dnd` duplicate project before the live trial**, or the checkpoint will
measure the ledger against a fleet that is itself double-counted.

---

## 6. Recommendation to the human

### 6.1 Headline

**Approve — highest-value item in this repo's portfolio thread — but ship it in
gated slices, with the "is this pool signal or noise?" checkpoint reached via
API/`ccam` on real data before any workbench UI is built.** All four evaluators
converged on this shape independently. It is the direct, specific counter to
`18196dc`.

### 6.2 Cost framing

| Slice | Framing | Who pays |
|---|---|---|
| Lifecycle tables, import, pool, claims, close, health metrics, workbench UI | **New ask** — new capability, scoped by DEC-P1..P6 | Sara's ask, our estimate: **L overall** (A=M, B=M *after trunk-drift*, C=L, D=S) |
| Retiring/repointing `plan-writeback.js`'s unattended write path | **Our cost** — DEC-2/DEC-13 debt made due by DEC-P2's reversal | Absorbed, but scheduled and named, not silent |
| `rebuildTableAtomically` (§9.6's durable cure) | **Not this request's cost** — and the recommended design makes it unnecessary here (see 6.3) | Belongs to whichever effort needs a rebuild first |
| Structural-guard scope derivation (§9.7 cure) | **Our cost** — the recurrence tax | Small, and it retires a 4x-recurring pattern |

### 6.3 The sequencing all four evaluators converged on — adopted, with two PM corrections

**Build order:**

> **Trunk-drift Phase 1a merges → Slice 1 (schema + import) → Slice 2 (claims +
> pool + close + health, API/`ccam` only) → SARA CHECKPOINT ON REAL DATA →
> Slice 3 (UI, itself sliced).**

**PM correction 1 — the dependency is on trunk-drift *Phase 1a only*, not the
whole effort, and the architect and engineer disagreed about this without
noticing.**

- The **architect's** pool design (§4, option B3) reads trunk commits as
  **persisted `detour_dispositions` rows with `source='trunk_drift'`**. That is
  trunk-drift **Phase 1b**, which `intake/2026-08-02-trunk-drift-detection/decisions.md`
  DEC-1 **gates on closing DEC-7** — so adopting it would transitively block this
  entire request on an unscheduled live trial.
- The **engineer's** design calls `detectTrunkDrift(cwd, { seenShas })`
  **live**, which is Phase **1a** — already in flight in the worktree
  (`server/lib/git-refs.js` and `server/lib/trunk-drift.js` exist there;
  `server/lib/db-rebuild.js` does **not** yet, so the engineer's claim that
  trunk-drift lands `rebuildTableAtomically` is Phase-1b-only and should not be
  relied on).

  **PM call: adopt the engineer's live-call form.** It keeps this request off
  DEC-7's critical path, matches the `repo-topology.js` live-derivation posture,
  and the `seenShas` parameter *is* the ratchet the ledger needs.
  **Required guard:** a value unit's identity is `('trunk_commit', <sha>)`
  **regardless of which feed produced it**, deduped once at assembly — otherwise
  the day Phase 1b lands, every direct-to-trunk commit appears in the pool
  **twice** (once live, once as a `detour_dispositions` row) and the health
  metric doubles. This is §9.1's shape at the *feed* level and must be a named
  test, not a comment.

**PM correction 2 — reconcile the two schema proposals now, not at build time.**
The architect proposed `project_plans` / `project_plan_items` / `value_claims`
(`value_source`/`value_ref`, 5 unit kinds, snapshot columns, generation ordinal
*derived* by walking `succeeds_plan_id`); the engineer proposed
`plan_generations` / `generation_items` / `value_claims` (`unit_kind`/`unit_ref`,
3 unit kinds, `unit_meta` JSON). Leaving this open guarantees the tech lead
re-derives it. **Recommended merge:**

- **Table names: the architect's** (`project_plans`, `project_plan_items`,
  `value_claims`) — "generation" is a *relationship between plan rows*, not a
  table; the `succeeds_plan_id` chain with a **derived** ordinal has nothing to
  drift and directly expresses "the next plan generation opens and new work
  accrues there."
- **Unit-kind vocabulary: the architect's full 5** (`trunk_commit`,
  `merge_commit`, `intake_initiative`, `detour`, `focus_segment`) even though
  slice 1 only produces three — per **WATCH-4 + DEC-15**, a `CHECK` is
  rebuild-to-widen, so the full final vocabulary lands in the initial
  `CREATE TABLE`. Same rule for `attribution` (all three tiers) and `status`
  (keep it exactly two: `open`/`closed`).
- **Snapshot columns explicit, not a JSON blob** — these are new tables, so
  §9.5 does not apply and there is no reason to trade queryability away.
- **Closure stamping: derive, never copy** (architect §5). No `closed_at` on
  claims; a claim's closed-ness is a join to `project_plans.status`. Copying the
  stamp onto N claim rows is §9.1's write-sequence form — the exact shape the
  2026-08-01 build was burned by.

**Slice detail:**

- **Slice 1 — additive schema + import.** Three new tables via
  `CREATE TABLE IF NOT EXISTS` (**zero `ALTER`, zero rebuilds** — this design
  makes §9.5/§9.6 *inapplicable* rather than *complied with*, which is the
  stronger outcome and matches the `practice-kind-override` JSON-blob precedent);
  `plan-ingest.js`'s pure parser reused for one-shot import; **no mirror-sync
  analogue exists in the new tables**, so `deletePlanItemsNotIn`'s data-loss trap
  (`server/lib/plan-ingest.js:396`, fired by three live triggers) is avoided
  *structurally*, not by a guard. **Any "just reuse `plan_items`" shortcut is a
  blocking objection at review.** Import idempotency keyed on
  `content_hash` + `project_id` per §5.3.
- **Slice 2 — claims + pool + close + health metrics, API and `ccam` only. No
  UI.** One shared `server/lib/value-pool.js` owning pool assembly *and*
  `computePlanHealth` (§9.1: consumers 2–4 are announced, so shared-computation
  is a day-one requirement). Register the new lib file in
  `chronology-ordering.test.js`'s `filesToScan` **in the same commit**.
- **CHECKPOINT (gate, not a demo).** Sara opens the Coaching Assistant project
  via API/`ccam`, on real data, with `~/.claude/agent-dashboard/dashboard.db`
  **backed up first**, and answers: *is this pool signal or noise?* Slice 3 does
  not start until she has. Auto-pilot cannot waive this.
- **Slice 3 — UI, itself sliced.** PO and architect recommended embedding in
  Project Detail; the engineer recommended a new page (`ProjectDetail.tsx` is
  already 1,433 lines with four fetches). **PM call — both are right about
  different things: 3a = a self-contained `<PlanLedgerPanel>` component file
  rendered *by* Project Detail** (own file, so the engineer's size concern is
  met; no new route/nav/×4-locale namespace, so the revert cost that `18196dc`
  paid is not incurred); **3b = promote to a dedicated
  `/projects/:id/reconcile` page only after the claim gesture has survived
  contact with Sara.** Defer the AGENT-PLAN.md read-only export entirely (it is
  a §9.1 consumer from birth).

### 6.4 The durable fixes — how the recurrences stop recurring here

1. **§9.7 — derive the scan's scope, don't type it.** Change
   `chronology-ordering.test.js`'s hand-typed 5-file `filesToScan` into a list
   **derived** from `server/lib/*.js` + `server/routes/*.js`, with an explicit
   per-file disposition (scanned / dated-grandfathered-with-reason). Adding a 6th
   lib file must then **break the scan** until someone dispositions it. This is
   the recommended-but-unbuilt cure from §9.6/§9.7, it is cheap, and this build
   is the first one that would visibly benefit. Same shape for the closure
   single-writer guard: derive its scope from the module's real exports
   (`assertSingleHome`), don't hand-type the names.
2. **§9.1 — one function, named consumers, cross-consumer test on day one.**
   Pool size and time-since-last-closure computed once in `value-pool.js`;
   a `ledger-metrics-parity` spec drives one seeded DB state through the API
   route **and** the `ccam` command (and MCP if it ships) and asserts identical
   values. QA's §9.1 note is that this "per-shape, not per-module" spec is the
   one that never gets written because it has no home under the
   one-spec-file-per-module convention — so it must be a **named deliverable**,
   not an aspiration.
3. **§9.3 — every guard gets a recorded red state.** Mutation-proven, with the
   observation written into the build notes; `grep -rn "assert.ok(true"` and
   `grep -rn "|| true"` over `server/__tests__/` stay at 0.
4. **§9.4 — every review finding ends as *fixed-with-a-test* or
   *recorded-in-decisions.md-with-an-id*.** The fix round gets its own
   adversarial pass. Extended this cycle to the **decision** layer: DEC-2/DEC-13
   get an explicit SUPERSEDED-BY amendment, not an inference.
5. **The `wip-queue` cure — a gate before the expensive surface.** Already
   encoded in 6.3.

---

## 7. Risk register

| # | Risk | Severity | Mitigation / owner |
|---|---|---|---|
| **R1** | **Transitional dual plan surface** — legacy cwd-keyed `plans` (+ poll + writeback + focus stack) coexisting with `project_plans`. Two things called "plan" in one UI is chronic-drift territory | High | Distinct route namespace (`/api/project-plans`, never blended into `/api/plans` responses), distinct client types, `imported_*` provenance columns, **and a tracked sunset as a WATCH row in `decisions.md`** — a disclosed-but-untracked exclusion equals an undiscovered one |
| **R2** | **Live plan/project identity fan-out** (§5.3): `DND`/`dnd` = one inode, two `project_id`s, identical `content_hash`; a worktree plan row with **no** `project_paths` mapping; a stale renamed-dir row | High — it corrupts the **headline acceptance answer** | Import idempotency on `content_hash`+`project_id` (not `cwd`); resolve cwds through repo root/common-dir so worktrees fold into parents; **clean up the `DND`/`dnd` duplicate before the live trial** |
| **R3** | **`deletePlanItemsNotIn` data loss** (`plan-ingest.js:396`, three live triggers) | High if the additive design is abandoned | Structurally impossible under additive tables; reviewers must **reject** any "reuse `plan_items`" shortcut. Pin with a test (QA T4) |
| **R4** | **§9.7 blind scan** — `value-pool.js` outside `filesToScan`, so every §9.2 obligation in Part B is unenforced while green | High (silent) | Derive the scan scope (§6.4.1); register new files in the same commit; red-prove |
| **R5** | **§9.1 across 3–4 announced consumers**, two of which (`ccam` plan surface, MCP plan tools) are **net-new** | High | One shared computation + `ledger-metrics-parity` spec, day one |
| **R6** | **Sequencing collision** — trunk-drift Phase 1a is uncommitted in a worktree touching `server/lib/`, `reconciliation.js`, `ProjectDetail.tsx`; practice-kind-override is a third concurrent effort; the project's own memory records real work loss from this | High | Trunk-drift Phase 1a merges **first**; check `git worktree list` + running sessions before any git operation; do not start slice 1 while two efforts hold `server/lib/` |
| **R7** | **Double-counted trunk commits** once trunk-drift Phase 1b persists `source='trunk_drift'` rows alongside the live `detectTrunkDrift` feed | Medium, silent, inflates the health metric | Unit identity `('trunk_commit', sha)` deduped at assembly, with a named test (§6.3 correction 1) |
| **R8** | **UI blast radius** (`18196dc` precedent) | Medium | Checkpoint gate + component-in-Project-Detail before any new route/nav/i18n |
| **R9** | **Pool floods on run #1** with full multi-year history and reads as noise at the exact moment Sara is judging signal-vs-noise | Medium — it would fail the gate for the wrong reason | Bounded default lookback + explicit per-project "backfill history" opt-in (Coaching Assistant will want it; most projects won't) |
| **R10** | **DEC-7 still open with a 1-of-2 unattended-write failure** (`writeback_failed` queue id 2, unreviewed since 2026-08-02 14:04) | Medium | Do **not** serialize this effort behind it; run the trial **during** slice 1; keep LLM-minted claims (`claimed_by='llm'`) **closed** until it clears |
| **R11** | **Closed-generation immutability / claim permanence** eroded by a later "cleanup" convenience | Medium, product-guarantee-level | No delete path for closed generations or claims, ever — enforced in routes, asserted by negative tests (PO §6.5, architect §6.4) |
| **R12** | **Concurrent-plan fallout on focus/pace/detours** — `ccam focus set <n>` and `(cwd, item_number)` resolution assume one plan per cwd | Medium | Additive design leaves the legacy layer untouched in slice 1; pace stays on the legacy layer; existing specs stay green **unmodified** except where the behavior change *is* the request, each such edit named |
| **R13** | **Un-mapped cwds have no pool home** (accepted, not accidental — but §5.3 shows the un-mapped set is exactly the effort worktrees) | Low-Medium | State it in docs; fold worktrees into parent repos per R2 so the accepted gap shrinks to genuinely unregistered directories |

---

## 8. Open decisions for the user

Auto-pilot: everything preference-level below is recorded as a **recommendation
already taken**; Sara may override any of them. Only the first three genuinely
need her.

**Needs Sara (cannot be auto-decided):**

- **S-1 — Confirm DEC-P2 supersedes DEC-2 and DEC-13, and the fate of
  `plan-writeback.js`.** DEC-2 (B) and DEC-13 (A) were both her explicit calls
  *against* the team's recommendation, so only she can retire them.
  **Recommendation:** keep `plan-writeback.js` load-bearing for **not-yet-imported**
  cwds during the transition, add **no new call sites**, point
  `fold_in`/`new_item` at DB plan items for imported plans (retaining
  `sanitizeLlmPlanText` — the trust boundary is LLM→Sara's plan, not LLM→file),
  and **retire** the module as its own later change rather than repurposing it
  as the export generator. (The architect and engineer converge on
  keep-then-retire; the PO leaned retire-now. I take the slower option because
  slice 1 doesn't need it decided, and the live `write_status='failed'` row still
  wants diagnosing against the code that produced it.)
- **S-2 — Run the DEC-7 live trial during slice 1.** Two unattended writes have
  fired, one failed, and both decision-queue entries are still unreviewed. Its
  verdict feeds S-1 directly.
- **S-3 — Confirm the slice-1/2 checkpoint is a gate, not a demo.** This is the
  `wip-queue-page` insurance and the one thing auto-pilot must not waive.

**Auto-decided (recommendations; override at will):**

- **S-4 — Ratchet baseline for run #1:** bounded default lookback (trunk-drift's
  own window), plus an explicit per-project "backfill history" action.
- **S-5 — Claim cardinality:** many-to-many at the schema level
  (`UNIQUE(value_source, value_ref, source_cwd, item_id)`), a unit counts as
  out-of-pool at its **first** claim, and a second claim on an already-claimed
  unit is a deliberate, visible action. This defines what the health metric
  counts.
- **S-6 — UI placement:** self-contained component inside Project Detail first;
  dedicated `/projects/:id/reconcile` page only after the checkpoint.
- **S-7 — AGENT-PLAN.md read-only export:** **deferred** (explicitly optional in
  DEC-P2; a §9.1 consumer the moment it exists).
- **S-8 — Schema naming/vocabulary merge:** architect's table names +
  `succeeds_plan_id` chain, full 5-value unit vocabulary and both enum
  vocabularies landed in the initial `CREATE TABLE` per WATCH-4/DEC-15, explicit
  snapshot columns, closure derived-not-copied.
- **S-9 — Trunk feed:** live `detectTrunkDrift()` (Phase 1a) rather than
  `detour_dispositions source='trunk_drift'` rows (Phase 1b), keeping this
  effort off DEC-7's critical path, with sha-level dedupe against the future
  Phase 1b feed.
- **S-10 — `DND`/`dnd` duplicate project cleanup** before the live trial (data
  hygiene, not a design question — but it changes what the checkpoint measures).

---

## 9. Memory updated

- Appended this request to
  `~/.claude/skills/team-intake/memory/request-log.md` (global fallback —
  `PROJECT-CONTEXT.md` names no project-local request-log).
- `PROJECT-CONTEXT.md` defect catalog: design-time pre-flags added to **§9.1**
  and **§9.7** (counts unchanged — nothing built yet), a note on **§9.5/§9.6**
  recording that this design makes those entries *inapplicable* rather than
  *complied-with*, and a new **candidate pattern CWD-IDENTITY-FANOUT** recorded
  with an explicit promotion trigger (per the SHARED-BUDGET-STARVATION
  precedent) rather than a premature 8th entry.
