# PM Plan — Trunk-drift detection

Slug: `2026-08-02-trunk-drift-detection` · PM pass: 2026-08-02
Inputs read: `request-brief.md`, `request-source.md`, all four supporting
evaluations (`product-owner.md`, `architect.md`, `engineer.md`, `qa.md`),
`PROJECT-CONTEXT.md` §9.1–§9.6, `intake/2026-08-01-build-project-manager/`
(`pm-plan.md`, `decisions.md` — DEC-7/DEC-13/WATCH-2/WATCH-4),
`intake/2026-07-31-focus-untracked-commits/pm-plan.md`,
`intake/2026-08-02-practice-kind-override/decisions.md` (DEC-5, WATCH-3) and
its in-flight `build-task-list.md`, the `portfolio-reconciliation-vision`
memory, the global request-log and decision-log, plus direct reads of
`server/db.js`, `server/lib/reconciliation.js`, `git log master`, and **live
queries against the real `~/.claude/agent-dashboard/dashboard.db`**.

---

## 1. Request summary

Everything the dashboard knows about "what work happened" comes from the
Claude Code hook event stream — it only sees work done inside a session that
ran hooks and declared (or was inferred to have) a focus. Work committed
straight to a repo's trunk (`main`/`master`) by a human, or by a session that
never called `ccam focus`, is structurally invisible to layers 3–6 of the
portfolio-reconciliation model. Sara wants the dashboard to notice that work
by itself. She deliberately split the ask in two and scoped **only step 1**:
a passive, live-computed, uncached git derivation — same posture as
`server/lib/repo-topology.js` — that answers "is there a body of unattributed
work on this repo's trunk branch, and which commits/diff make it up?" No
classification judgment happens in the detector. Its output is meant to slot
into the already-built `detour_dispositions` pending lifecycle as a third
`source` value (`trunk_drift`), reusing the existing pending-detour badge
("a badge indicating unknown work"), so the existing `reconciliation.js` LLM
disposition pass eventually qualifies it. The classification machinery
(`fold_in`/`new_item`/`deliberate`/`discard`, `plan-writeback.js`,
`decision_queue`) and the layer-7 rollup UI are explicitly out of scope.

---

## 2. Request type — final call

### **`new-feature`** — confirmed, with one carve-out on cost (below).

Triage's provisional call stands, and the product owner reached the same
conclusion independently. My reasoning, having read the 2026-08-01 plan of
record end to end:

- **Not a bug.** Nothing is broken. No code path today claims to detect trunk
  work and fails to.
- **Not a regression.** This never worked. `repo-topology.js` has never
  walked commit history; confirmed by direct read (worktree list + `git
  status --porcelain` only, no `log`/`diff`, no `defaultBranch` concept).
- **Not a missed-requirement against `2026-08-01-build-project-manager`.**
  This was the live alternative and I explicitly reject it. That effort's
  scope was the *disposition lifecycle* for detours the focus classifier
  already produces; layer 4 in the confirmed 7-layer model is defined in the
  `portfolio-reconciliation-vision` memory as "focus-inference already
  classifies undeclared session time as a detour… what's MISSING is the
  disposition step." A trunk-commit-history walker was never named, implied,
  or promised in that plan, its `decisions.md`, or the memory. Building what
  was asked and later discovering a *different* input source is worth having
  is a new ask, not a broken promise.
- **Not text/content-change or clarification-only.**

**The carve-out that actually matters for cost framing.** One piece of this
request is *not* new-feature work: widening
`detour_dispositions.source`'s CHECK constraint. That cost was identified,
priced and **knowingly deferred** by us on 2026-08-01 as **WATCH-4**
("CHECK-constrained enums are rebuild-to-widen"), which names
`detour_dispositions… .source` by exact column and states outright that
adding a value later "requires the full rename-copy-drop dance." We took that
shortcut deliberately. It is now due. Treat the migration line item as
**accepted technical debt coming due — our cost**, and the detector + plumbing
as **the new ask**. That split is the honest answer to "is this our bug or a
new request," and it matters because the migration, not the detector, is the
largest single piece of work here (both the architect and the engineer landed
on that independently).

---

## 3. History / background — have we seen this before?

**Yes — three separate threads converge on this request. Two are recurrences.**

### Thread A — the incident class this detector exists to catch

| When | What | Type | How it was found | What we did |
|---|---|---|---|---|
| 2026-07-26 → 07-30 | 7 commits (`0416066`..`60af828`) shipped real feature/bug work direct to `master`, no intake folder, no declared focus | `missed-requirement` (process) | **Manual** — `team-status`'s reconciler, after the fact | Retroactive intake `2026-07-31-focus-untracked-commits/`; catalogued §9.1/§9.2; **no detection tooling proposed** |
| 2026-08-02 ~00:01–08:17 | The entire Coach/Playbook surface (`dc6682d`, `b6d372b`, `0a291e9` — engine, 2 tables, routes, +481-line UI) shipped direct to `master`, no intake folder | `new-feature` w/ embedded missed-requirement | **Manual** — noticed ~90 min later when a related request arrived | Retroactive intake `2026-08-02-practice-kind-override/`; raised **DEC-5** (adopt an intake routing rule) — **still PENDING** |
| Cross-project echo, 2026-07-31 | New Group's "un-intake'd-code cluster" — 4 members across 2 checkpoint commits, 3 given retroactive cycles | `missed-requirement` ×2 | **Manual** | Same recommendation made a third time; the `/wrap-up` new-capability-diff routing rule was written into **New Group's** `PROJECT-CONTEXT.md` only, recorded there as **unadopted**, never ported here |
| **Right now (verified this pass)** | `git log master` for 2026-07-31 → 2026-08-02 contains **8 `feat(...)` commits with no intake folder behind them** — `3c2db7d`, `c46c55c`, `9d01959`, `d834e48`, `dc6682d`, `f78b2ec` (pin-to-top), `5030ddd` (Project Detail page), `aca4b51` (per-account usage capture + Activity card) — plus ~50 modified files and 2 brand-new untracked server modules (`server/lib/consumption-rate.js` + its test) sitting uncommitted | — | **Nobody. Not found until this PM pass.** | — |

So: the failure mode is not a historical incident that happened twice. **It
is this repo's current, dominant working mode**, and it is still being
discovered only by whoever happens to look.

### Thread B — the subsystem this request extends

| When | What | Relevance now |
|---|---|---|
| 2026-08-01 | `2026-08-01-build-project-manager` builds layers 4–6: `detour_dispositions` (+`source`/`source_ref`/`source_seen_at`, unique index `(cwd, source, source_ref)`), `detours.js`, `plan-writeback.js`, `reconciliation.js`, `decision_queue`. DEC-2→**DEC-13**: write-back is **real and auto-fires unattended** | The machine this request points a new input at |
| 2026-08-01 | **WATCH-4** logged: `detour_dispositions.source` CHECK is rebuild-to-widen; accepted | **Confirmed and now due — see §4.2.** The architect's finding is correct; I re-read WATCH-4 and it names this exact column |
| 2026-08-01 | **DEC-7** logged: live-trial gate — "a passing test suite is not sign-off"; Sara must review real decision-queue output **and real unattended `AGENT-PLAN.md` writes**. Status: **the remaining open item**, per the memory's own closing line | The sequencing question — see §6.2 |
| 2026-08-01 | **WATCH-2**: reconciliation skips cwds with no live plan / no `plan_items` | Binds any `trunk_drift` row's `cwd` — see §6.4 |

### Thread C — the migration pattern

| When | What |
|---|---|
| 2026-08-01 | §9.5 FRESH-DB-BLIND SCHEMA CHANGE catalogued — caught on **this exact table** (`detour_dispositions.project_id` added with no `ALTER TABLE`; surfaced only by an incidental test coupling) |
| 2026-08-02 (today, earlier) | §9.6 NON-ATOMIC REBUILD catalogued, from `practice-kind-override`'s QA pass — **5 of 6 existing rebuilds in `server/db.js` are non-atomic**; durable cure (`rebuildTableAtomically` helper + `REBUILD_CASES` meta-test) recommended, **not built** |
| 2026-08-02 (today, in flight) | `practice-kind-override`'s build task list opens with **Task 1: an atomic `coach_observations` rebuild**, hand-copying the `agents` pattern |
| 2026-08-02 (this request) | Needs **a second CHECK-widening atomic rebuild, within the same 24 hours**, on `detour_dispositions` |

**Prior decisions this request touches (cited, not re-litigated):** WATCH-4
(accepted, now due), DEC-7 (open, and this request depends on it — §6.2),
DEC-13 (auto-write, unattended — raises the stakes of a new input), WATCH-2
(planless cwds are skipped), WATCH-3 (layer 7 stays deferred — this request
correctly does not touch it). **Nothing in this request contradicts a settled
decision.** It is additive within a layer whose `source` column and its
unique index were visibly designed to be source-polymorphic.

---

## 4. Recurrence diagnosis

### 4.1 The headline recurrence — and why this request is only half the fix

The recurring thing is **not** "trunk-drift detection keeps breaking." It is:

> **Real new capability ships straight to trunk with nothing recording that
> it happened, and is discovered only when a human happens to run a manual
> review — after the fact.**

That has now happened at least three times on this repo (2026-07-31 ×7
commits, 2026-08-02 ×3 commits, and 8 more `feat` commits right now that no
cycle has yet acknowledged) plus twice cross-project on New Group. Each time,
the *same* durable fix was recommended: a binding rule that a diff
introducing a new capability must have an intake folder before it merges. It
has been recommended **three times, adopted zero times** — written into New
Group's `PROJECT-CONTEXT.md` only, flagged there as unadopted, and raised
here as `practice-kind-override` **DEC-5, still PENDING**.

**Systemic cause:** the countermeasure that has been recommended every time is
a *process* rule that requires a human to remember it at commit time, and it
was never wired into anything that runs. Nothing in the pipeline enforces it,
so it degrades to advice, and advice loses to momentum every single time.

**Why this request is the right instinct but not, by itself, the cure.** A
detector converts "found by a manual `team-status` sweep, days later" into
"surfaced by the dashboard, automatically." That is a genuine and large
improvement in *discovery latency* — and it is the first countermeasure in
this whole history that doesn't depend on anyone remembering anything. But it
is still detection **after** the commit lands. It reduces latency; it does not
prevent recurrence. The complete fix is both halves:

1. **Detection** (this request) — nothing escapes notice.
2. **Adoption of the routing rule** (`practice-kind-override` DEC-5) — new
   capability doesn't ship un-intake'd in the first place.

Approving only #1 and leaving #2 pending for a fourth cycle is the outcome I
most want to avoid, because it is exactly what the last three cycles did.

### 4.2 Second recurrence — the CHECK-widening rebuild, twice in 24 hours

The architect's WATCH-4 finding is **confirmed**: `server/db.js:701` reads
`source TEXT NOT NULL CHECK(source IN ('inferred','declared'))`, SQLite cannot
loosen a CHECK in place, and WATCH-4 (2026-08-01) named this exact column and
accepted the cost. The request brief pointed at the wrong column —
`source_ref TEXT NOT NULL` is unconstrained and needs no change; the architect
and engineer both caught this independently and are right.

What neither of them could see, and what I found by checking what else is in
flight: **`practice-kind-override`'s build task list, written today, opens
with a hand-rolled atomic rebuild of `coach_observations`.** So within one
24-hour window this project needs its **second and third** careful table
rebuilds, both hand-copying the same `agents` template, on the same day §9.6
was catalogued with a durable cure that was recommended and not built.

**Systemic cause:** atomicity is re-decided by hand at every rebuild site, and
the file itself is full of the wrong precedent — 5 of the 6 existing rebuilds
(`plan_items` ×2 at `db.js:776`/`843`, `token_usage` ×2 at `1084`/`1674`,
`webhook_targets` at `1524`) are non-atomic, and only `agents`
(`db.js:1560-1600`) is correct. A builder grepping for "how does this repo
rebuild a table" finds the wrong answer five times out of six.

**Also found this pass, and worth fixing immediately:** §9.6's own catalog
entry cites the `agents` rebuild at `server/db.js:1478-1514`. **Those line
numbers are stale** — the file has grown and the correct range is
`1560-1600` (`PRAGMA foreign_keys = OFF` at 1562, `BEGIN;` at 1563,
`ALTER TABLE agents_new RENAME TO agents` at 1598). A stale pointer in the
one entry whose entire instruction is "copy *this* site, not the other five"
is a real hazard. Corrected in the catalog as part of this pass.

### 4.3 The catalog entries — final calls

- **§9.1 DERIVED-DUAL-VIEW — does NOT apply. Recording this explicitly so it
  isn't re-derived next cycle.** The request brief pre-flagged it (label
  source #2); the architect's closer read overturned it, and I side with the
  architect. `detour_dispositions.label` is *already* produced by two
  independent composers (`recordInferredDetour` takes the classifier's
  narrative; `backfillDeclaredDetours` composes inline from
  `events.data.title`/`.description`), and there is no single correct value
  the three are trying to converge on — `buildDispositionPrompt` reads
  `f.label || ""` as an opaque string. §9.1's acceptance criterion ("same
  field, same value, across every consumer") is meaningless here. The
  architect's *residual* concern is valid and is a plain code-organization
  requirement, not a catalog occurrence: give all three composers one home in
  `detours.js` as named exported functions with a shared size cap. **Count
  unchanged. No occurrence.**
- **§9.2 row-id-as-chronology-proxy — narrow, non-binding on the core
  design.** Under the architect's recommended Option 3 the "already seen"
  check is a set-membership test on SHAs, not a chronological sort, so §9.2
  doesn't bind it. It binds only if a later round joins
  `events`/`focus_inferences` for smarter attribution (out of scope). The
  tech plan must still state which axis governs what: git's DAG/committer
  order for commit sequencing, `created_at` (id tiebreak) for any dashboard
  table query. **Count unchanged.**
- **§9.5 / §9.6 — §9.6 applies squarely, as a design-time pre-flag.** No code
  is written yet, so per this project's own precedent (`build-project-manager`,
  `practice-kind-override`) the count is **not** incremented; a dated
  pre-flag note is added instead, and it converts to an occurrence only if a
  non-atomic rebuild actually ships.

### 4.4 The genuinely new risk — and my call on cataloguing it

The architect found a risk nobody else did, and it is the sharpest technical
finding in this intake: `buildDispositionPrompt` ends with
`.slice(0, 8_000)` applied to the **whole assembled prompt** — preamble +
PLAN ITEMS + every flagged detour + the JSON reply instruction. It is
source-blind and was sized for short session-narrative labels.

**I verified this is reachable with realistic numbers, not theoretical:**

- The prompt's **tail** is what gets cut, and the tail is the
  `Reply with ONLY JSON: {...}` instruction, *after* the detour list.
- `parseDispositionOutput` ends in `catch { return new Map(); }` — **silent**.
  No log, no error, no failed test. An overrun produces *zero verdicts for
  the entire tick*, and every detour in that batch simply stays `pending`
  forever, looking exactly like "the LLM hasn't gotten to it yet."
- Live budget math from the real DB: preamble ≈1.5 KB; the largest real
  `PLAN ITEMS` block across Sara's 9 plans is ≈1.2 KB; `MAX_DETOURS_PER_TICK`
  = 10. Today's labels are capped upstream at 120 chars
  (`focus-inference.js:288`), so the detour list is ≈1.4 KB and total
  utilization is ≈50%. Headroom for the detour list is roughly **540 chars
  per detour at a full batch of 10**. A `trunk_drift` label built from a
  commit subject plus a diffstat blows straight through that.

So: one oversized trunk-drift label can silently void an entire tick's
verdicts for *unrelated* detours, with a green suite and no log line.

**Catalog call: do NOT open a new catalog entry yet.** Reasoning:

- The catalog's own bar is "patterns this project has **independently
  rediscovered more than once**." This has zero prior occurrences.
- §9.6 is the precedent for a zero-occurrence entry, but it earned that on
  **five confirmed, currently-reachable latent instances**. Here, every
  existing shared-budget site (`focus-inference.js` 6 K ×2,
  `focus-summary.js` 12 K/16 K, `focus-audit.js` 4 K, `reconciliation.js`
  8 K) is safe today *by construction*, because every input feeding them is
  capped upstream. Nothing is currently reachable. It becomes reachable only
  because this request introduces the first unbounded input.
- A catalog whose entries are all load-bearing is the asset; diluting it with
  a speculative seventh entry costs more than it buys.

**What to do instead — three things, all concrete:**

1. **Mandatory technical-plan tasks** (not a note): (a) a shared
   `MAX_DETOUR_LABEL_CHARS` cap applied at the point *every* composer
   returns, not just the trunk-drift one; (b) **move the JSON reply
   instruction above the PLAN ITEMS/DETOURS lists**, or truncate per-item
   instead of whole-prompt, so an overrun can never drop the output contract;
   (c) make `parseDispositionOutput`'s empty-map return **log loudly** — the
   silence is what makes this class of failure invisible.
2. **A WATCH row in this intake's `decisions.md`** naming the risk, the
   8,000-char budget, the tail-truncation ordering, and the silent catch.
3. **An explicit promotion trigger**, so the next cycle doesn't have to
   re-argue it: *promote to a new catalog entry (working name
   SHARED-BUDGET-STARVATION) the first time either (a) a second shared
   truncation budget is found taking unbounded input, or (b) this one
   actually fires.* Recorded below in the memory update.

---

## 5. Where this is coming from

**Root source: a real, structural blind spot in a subsystem we built
correctly — surfaced by a working mode we have declined three times to
change.**

- Not a changed requirement. The 7-layer model was confirmed with Sara on
  2026-08-01 and this fits inside layer 4 exactly as designed; the
  `source` column and its `(cwd, source, source_ref)` unique index were built
  source-polymorphic from day one.
- Not drift between an approved doc and the code. There is no content
  source-of-truth to diff here (the PO flagged this explicitly).
- Not a misunderstanding. This is the best-specified intake this project has
  produced — it names the files, the columns, the precedent to follow, and
  the scope boundary, and every downstream evaluator confirmed the boundary
  is drawn correctly.
- **It is a blind spot that became visible because the failure it causes kept
  happening.** Layers 3–6 are keyed off the hook event stream. That was a
  correct and complete design *for sessions*. The failure mode is
  work that happens outside a session — which, per §3 Thread A, is currently
  how most of this repo's work ships.

The one thing I'd name as an antecedent we own: we have now written the words
"work shipped to trunk with no intake behind it" into three separate PM plans
and never once converted them into a mechanism. This request is the first
time anyone proposed a mechanism instead of a reminder. That's the right
turn — and it should come with the second half (§6.2).

---

## 6. Recommendation to the human

### 6.1 Approve — with a phase split

**Approve the request.** It is well-scoped, it extends architecture built to
be extended, all four evaluators converged, and it targets an evidenced,
currently-active failure mode. Effort is **M** (engineer's estimate, which I
agree with — the detector itself is S; the migration and its interruption
test are the drivers).

**Recommended shape: split step 1 into 1a and 1b, and approve 1a now.**

- **Phase 1a — the detector, read-only.** `server/lib/trunk-drift.js` as a
  pure live git derivation (architect's §9 recommendation: shared
  `resolveDefaultBranch` helper extracted from `update-check.js`, no forced
  fetch, no GitHub API, bounded lookback window, bounded commit count,
  `{ skipped: <reason> }` rather than guessing), surfaced on the Project
  Detail page. **No schema change, no `detour_dispositions` write, no CHECK
  rebuild.** Delivers "notice unattributed trunk work" to a human today at a
  fraction of the risk.
- **Phase 1b — the plumbing.** The `source` CHECK-widening atomic rebuild,
  `recordTrunkDriftDetour` in `detours.js`, the label-composer consolidation
  and size cap, and the badge. Gate on §6.2 and §6.3 below.

**Why the split, concretely:** (i) the auto-write pipeline 1b feeds has never
been reviewed by a human and is currently 1-for-2 on unattended writes (§6.2);
(ii) 1b is where all the schema risk lives, and its rebuild wants a decision
that is cheaper to make once alongside another in-flight rebuild (§6.3);
(iii) 1a alone closes most of the discovery-latency gap. It also matches
Sara's own two-step instinct, applied one level down.

**If Sara wants the badge immediately** (a legitimate preference — the badge
*is* the ask), the acceptable alternative is: ship 1a+1b together but land
`trunk_drift` rows **excluded from the LLM disposition pass by default**
behind a config flag (`DASHBOARD_TRUNK_DRIFT_CLASSIFY`, default `off`),
flipped on when DEC-7 closes. Same protection, more code.

### 6.2 The DEC-7 sequencing question — my actual recommendation

The PO raised this and asked for a real call rather than a pass-through.
Here it is, grounded in live data I pulled from
`~/.claude/agent-dashboard/dashboard.db` this pass:

- `detour_dispositions`: **24 rows across 5 cwds, every one
  `source='inferred'`**. 22 still `pending`.
- The unattended auto-write pipeline (DEC-13) has fired on Sara's real fleet
  **exactly twice**, both `decided_by='llm'`, both against
  `/Users/sara/CODE-LOCAL/SARA/emails`:
  - id 3, `new_item`, `write_status='written'` (2026-08-02T05:21)
  - id 19, `fold_in`, **`write_status='failed'`** (2026-08-02T14:03)
- `decision_queue` currently holds **2 pending entries**, one of which is a
  `writeback_failed` escalation — i.e. the failure above escalated correctly,
  and **has not yet been looked at**.

So the honest status of DEC-7 is: the live trial has not happened, and the
sample that exists is **one successful and one failed unattended write to a
stakeholder-facing file, unreviewed**.

**Recommendation: do not point a second, mechanically-generated, higher-volume
source at that pipeline before DEC-7 closes — but do not block the whole
request on it either.** Specifically:

1. **Approve and build Phase 1a now.** It touches none of that machinery.
2. **Close DEC-7 as its own small task, this week.** It is one sitting: read
   the 2 pending `decision_queue` entries, diagnose the one
   `write_status='failed'` row (id 19), read the block that *did* land in
   `/Users/sara/CODE-LOCAL/SARA/emails`'s `AGENT-PLAN.md`, and answer "signal
   or noise?" That is the pass criterion DEC-7 already defines.
3. **Gate Phase 1b on that answer.** If the trial says "signal," 1b proceeds
   unchanged. If it says "noise," 1b would have multiplied the noise — and
   we'd want to know that *before* adding a source that can emit one row per
   commit.

This is not process theatre. A 50% failure rate on unattended edits to a
human-owned file, unexamined, is precisely the condition DEC-7 was written to
catch, and the trunk-drift source is precisely the amplifier it was written
to protect against.

### 6.3 The durable fixes to approve alongside the build

1. **Build `rebuildTableAtomically({ table, createSql, copySelect, indexes })`
   now, and make this request and `practice-kind-override` its first two call
   sites.** §9.6 recommended this helper today and it wasn't built; within 24
   hours we have two rebuilds queued, each hand-copying `agents`. Hand-rolling
   the second and third is how the existing 5-of-6 non-atomic population came
   to exist. Ship the helper plus §9.6's `REBUILD_CASES`
   registry-completeness meta-test (requiring a legacy-DB case **and** an
   interruption case per site), grandfathering the five existing sites with a
   dated reason rather than weakening the scan — the same shape as
   `chronology-ordering.test.js`'s `GRANDFATHERED_QUERIES`. *(Note the
   sequencing: if `practice-kind-override`'s build starts first, the helper
   should land there and this request becomes call site #2. Either order
   works; what must not happen is two independent hand-rolls.)*
2. **Adopt the un-intake'd-capability routing rule
   (`practice-kind-override` DEC-5).** This is the §4.1 durable fix and my
   single highest-value recommendation in this plan. It has been recommended
   three times across two projects and adopted zero times, while 8 more
   un-intake'd `feat` commits landed on `master` in the last 48 hours. The
   detector will find this work *after* it ships; the rule stops it shipping
   un-recorded. They are complements, and approving only the fun one is how
   this recurs a fourth time.
3. **Prompt-budget hardening as mandatory tech-plan tasks** (§4.4: shared
   label cap at every composer, reply-instruction ordering, and make the
   silent `catch` log).

### 6.4 Non-negotiables to carry into the technical plan

- **Atomic rebuild, copying `agents` at `server/db.js:1560-1600` — not
  `plan_items`/`token_usage`/`webhook_targets`.** `PRAGMA foreign_keys = OFF`
  outside and before `BEGIN`. Gated on `hasNewShape && !orphanExists`, and on
  orphan detection **log loudly and skip — never throw** (`db.js` runs at
  `require()` time; a throw bricks boot for server, MCP, desktop and the VS
  Code extension against the one shared `DB_PATH`).
- **An interruption test, not just a clean-completion test** (§9.6's
  acceptance criterion), modelled on `agents-legacy-rebuild.test.js`; plus a
  `db-migration.test.js` `UPGRADE_CASES` entry proving pre-existing
  `inferred`/`declared` rows survive byte-identical, `'trunk_drift'` inserts
  succeed, `'bogus'` still fails, and `idx_detour_dispositions_src` survives.
- **Every guard proven red before green** (§9.3) — including the
  false-positive guard QA names as load-bearing (work that *did* go through
  the declared focus flow must not be flagged), proven by stubbing the
  "already attributed" check and observing the failure.
- **`source_ref` = a commit SHA, one row per commit** (architect §7, engineer
  §5 — they differ on *which* SHA; the tech plan must pick one and say why).
  Not a `start..end` range string, which breaks idempotency the moment the
  range grows.
- **`cwd` must equal `plans.cwd`, not "the repo's git root"** (engineer's
  gotcha #3, and WATCH-2). A row written against the wrong worktree path
  either never reaches `evaluateRules` or pollutes another project's pending
  list.
- **First-run behavior must be an explicit decision, not an accident** (QA
  §3a case 5). **My recommendation: a bounded lookback window with a
  conservative default (7 days), no persisted watermark** — it satisfies the
  request's own no-cache posture, avoids the architect's Option-2 "marker
  silently skips a commit forever" failure, and prevents the first-run flood.
  The flood is not hypothetical here: pointed at this repo today, an
  unbounded first run would flag most of the last week of `master`.
- **Local-first: no GitHub API, no mandatory `git fetch`** on a per-request
  path (PO acceptance criterion #6, CLAUDE.md's mission).
- **The scope boundary stands** — no classification logic in the detector, no
  `plan-writeback.js` changes, no layer-7 UI. Any proposal to cross it comes
  back to Sara as a separate request.

---

## 7. Open decisions for the user

| # | Decision | Recommendation | Blocking? |
|---|---|---|---|
| 1 | **Phase split** — 1a (detector, read-only) now, 1b (schema + plumbing + badge) gated? Or ship both with the LLM pickup flag-defaulted `off`? | **Split; approve 1a now.** | Blocks build start |
| 2 | **DEC-7's live trial** — run it before Phase 1b? | **Yes.** One sitting: 2 pending `decision_queue` entries + the `write_status='failed'` row (id 19) + the block that landed in `emails`' `AGENT-PLAN.md`. Currently 1-for-2 on unattended writes, unreviewed. | Blocks 1b only |
| 3 | **Build `rebuildTableAtomically` now**, shared with `practice-kind-override`'s in-flight `coach_observations` rebuild — or hand-roll a second copy of `agents`? | **Build the helper.** Second and third rebuilds in 24h; §9.6 already recommended it. | Blocks 1b only |
| 4 | **Adopt the un-intake'd-capability routing rule** (`practice-kind-override` DEC-5) into this repo's `PROJECT-CONTEXT.md`? | **Yes.** 3rd recommendation, 0 adoptions, 8 un-intake'd `feat` commits in 48h. | Not blocking |
| 5 | **First-run behavior** — bounded lookback vs. persisted watermark vs. full history | **Bounded lookback, 7-day default, no watermark.** | Not blocking (tech plan) |
| 6 | **Trigger** — on-demand per page view only, or also inside `reconciliation.js`'s periodic tick? | **Both, but staged:** on-demand in 1a; periodic in 1b. On-demand-only would mean drift on a project Sara isn't looking at never reaches the queue, which undercuts the point. | Not blocking |
| 7 | **Default-branch resolution** — confirm local-only, no GitHub API | **Confirm as a hard requirement** (extract a shared helper from `update-check.js`; local-only, remote-optional). | Not blocking |
| 8 | **The 8,000-char prompt-budget risk** — catalog entry now, or WATCH row + promotion trigger? | **WATCH row + promotion trigger** (§4.4). Zero occurrences, no currently-reachable latent instance. Fix it in the tech plan regardless. | Not blocking |

---

## Memory updated

- Row appended to `~/.claude/skills/team-intake/memory/request-log.md`.
- `PROJECT-CONTEXT.md` §9.6 updated: dated design-time pre-flag for this
  request (count unchanged), the second-rebuild-in-24h note, the
  candidate SHARED-BUDGET-STARVATION pattern with its promotion trigger, and
  a correction of the stale `agents`-rebuild line reference
  (`1478-1514` → `1560-1600`).
- `PROJECT-CONTEXT.md` §9.1 updated: dated note recording that this surface
  was pre-flagged and, on closer read, **does not** apply — so it isn't
  re-derived next cycle.
