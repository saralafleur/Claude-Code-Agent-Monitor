# Decision Log — trunk-drift detection

> Every clarifying / blocking question the team raised on this request, the
> context behind it, the options offered, and the choice made. Readable on its
> own — someone should be able to open this months later and understand *what we
> decided and why*. Newest decisions at the bottom.
>
> Status values: **PENDING** (asked, awaiting answer) · **DECIDED** ·
> **DECIDED-AUTO** (decided by the team itself under `auto-pilot`, on its own
> best recommendation, without asking) · **PARKED** (deferred to stakeholder /
> later) · **SUPERSEDED** (a later decision overrode this one — link it).

Companion doc: `technical-plan.md` (same folder). Every row below is cited by
section number from that plan; every scope boundary that plan declines is
backed by a row here rather than by prose alone.

---

## DEC-1 — Phase 1a / 1b split: adopted

- **Item / area:** Whole request — sequencing
- **Status:** DECIDED-AUTO (adopting the PM's §6.1 recommendation; Sara's
  open decision #1 remains hers to override)
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead
- **Recurring-issue link:** — (sequencing, not a defect class)

### The question

PM `pm-plan.md` §6.1 recommends splitting this build into **1a** (detector,
read-only, no schema change, no `detour_dispositions` write) and **1b** (the
`source` CHECK-widening rebuild + `detours.js` adapter + reconciliation pickup
+ badge), approving 1a now and gating 1b on DEC-7 (`intake/2026-08-01-build-project-manager/decisions.md`)
and on the `rebuildTableAtomically` decision. Adopt or override?

### Decision

**Adopted, unchanged.** `technical-plan.md` is written as two independently
shippable phases with a hard gate between them.

**Rationale / implications:**
- 1a carries no schema risk, no write risk, and no LLM-pipeline risk: it is
  git-read-only and touches nothing that already exists except one new route
  and one new UI card. It closes most of the discovery-latency gap on its own.
- 1b points a mechanically-generated, higher-volume source at an unattended
  auto-write pipeline (DEC-13) whose live trial (DEC-7) has not happened and
  which is currently 1-for-2 on real unattended writes to a stakeholder-owned
  `AGENT-PLAN.md`. That is exactly the amplifier DEC-7 exists to catch. See
  WATCH-5.
- One deliberate exception to "1a touches nothing existing" is carried in
  DEC-4 (the `parseDispositionOutput` logging fix), justified there.
- If Sara prefers the badge immediately, the PM's stated alternative
  (`DASHBOARD_TRUNK_DRIFT_CLASSIFY`, default `off`) is the fallback — it is
  *more* code, not less, so the plan does not build it speculatively.

---

## DEC-2 — `source_ref` identity: one row per commit SHA, not the trunk HEAD sha

- **Item / area:** `server/lib/detours.js`, `detour_dispositions.source_ref`,
  `idx_detour_dispositions_src`
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead
- **Recurring-issue link:** — (idempotency design)

### The question

The architect (§7) and the engineer (§5) agree `source_ref` must not be a
`start..end` range string, and disagree on what it should be instead:
architect says **one row per unattributed commit, `source_ref` = that
commit's SHA**; engineer says **one row per detection, `source_ref` = the
default branch's HEAD sha at detection time**. The PM (§6.4) required the tech
plan to pick one and say why.

### Options presented

- **A) Per-commit SHA (architect §7)** — one `detour_dispositions` row per
  direct-to-trunk commit; `source_ref` is content-addressed and permanent.
- **B) Trunk HEAD sha at detection (engineer §5)** — one row per detection
  run; the row refreshes while HEAD is unchanged, and a brand-new row appears
  the moment any commit lands on trunk.

### Decision

**Chosen: A — per-commit SHA.** The engineer's HEAD-sha recommendation is
**explicitly overridden**.

**Rationale / implications:**
- Option B produces **overlapping rows whose bodies of work are supersets of
  each other**. Run 1 writes a row for HEAD=`aaa` describing commits
  {c1,c2}. A third commit lands; run 2 writes a *second* row for HEAD=`bbb`
  describing {c1,c2,c3}. Both are `pending`, both reach
  `buildDispositionPrompt` in the same batch, and under DEC-13 (auto-write,
  unattended) both can be dispositioned `new_item`/`fold_in` — writing the
  same work into `AGENT-PLAN.md` twice. That failure is silent and lands in a
  human-owned file. Option A cannot produce it: a SHA appears in exactly one
  row, forever.
- Option A also matches how the two existing sources already key identity —
  one row per one underlying observation (`focus_inferences.id`, `events.id`)
  — so no new shape convention is introduced.
- The engineer's actual concern (a growing range string fragments into N rows)
  is real and is honoured: no range string is used anywhere.
- Cost accepted: volume. Eight direct-to-trunk commits produce eight pending
  detours. This is bounded by `DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS` (7),
  `MAX_TRUNK_DRIFT_COMMITS` (200) and `MAX_DETOURS_PER_TICK` (10), and it is
  the reason `MAX_DETOUR_LABEL_CHARS` in DEC-4 is non-optional.
- Sara's "commit range and enough content to describe what happened" output
  requirement is satisfied at the **detector's return value** (a structured
  range object, `technical-plan.md` §3.2), which is what the read-only 1a
  surface renders. Row-per-commit is the persistence shape only.

---

## DEC-3 — Build `rebuildTableAtomically` now; `detour_dispositions` is call site #1

- **Item / area:** `server/lib/db-rebuild.js` (new), `server/db.js`,
  `server/__tests__/db-migration.test.js`
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead
- **Recurring-issue link:** **§9.6 NON-ATOMIC REBUILD** (durable cure,
  recommended 2026-08-02, not yet built)

### The question

PM §6.3 / open decision #3: build the generic
`rebuildTableAtomically({ table, createSql, copySelect, indexes })` helper now
and make this request and `practice-kind-override`'s in-flight
`coach_observations` rebuild its first two call sites — or hand-roll a second
copy of the `agents` pattern? PM noted "if `practice-kind-override`'s build
starts first, the helper should land there and this request becomes call site
#2. Either order works; what must not happen is two independent hand-rolls."

### Where we're coming from (history, as of when)

Checked on 2026-08-02 during this plan pass:
`intake/2026-08-02-practice-kind-override/build/2026-08-02-practice-kind-override/build-task-list.md`
**exists and that build has already started.** Its Task 1 hand-rolls the
`coach_observations` rebuild, and its Task 4 (T1a) is a **structural scan test
keyed to the literal source text** ``db\.exec\(\s*`[^`]*CREATE TABLE coach_observations_new[^`]*`\s*\)``
with red-first evidence already being recorded against it. Routing that site
through a helper would invalidate that test and its red evidence mid-flight.

### Options presented

- **A) Build the helper here; `detour_dispositions` is call site #1; leave the
  in-flight `coach_observations` hand-roll alone and track its conversion.**
- **B) Wait for `practice-kind-override` to land the helper, hand-roll here.**
  Rejected — that build is already past the point where the helper could land
  in it without invalidating written tests, and waiting means this request
  hand-rolls, which is the outcome PM explicitly said must not happen.
- **C) Reopen `practice-kind-override`'s build to retrofit the helper.**
  Rejected — invalidates in-flight red evidence on another effort for no
  safety gain (their atomic hand-roll is correct as written; the helper's value
  is preventing the *next* hand-roll, and this plan is the next one).

### Decision

**Chosen: A.** `server/lib/db-rebuild.js` is built in Phase 1b, and the
`detour_dispositions.source` CHECK widening is its first call site.

**Rationale / implications:**
- The helper's whole purpose is that atomicity stops being re-decided per
  site. It does that from call site #1 onward regardless of whether
  `coach_observations` is retrofitted.
- The `REBUILD_CASES` registry meta-test lands with it (PM §6.3). It scans
  `server/db.js` for `CREATE TABLE (\w+)_new` / `ALTER TABLE (\w+) RENAME TO \1_old`
  and requires each discovered site to be registered with a legacy case **and**
  an interruption case, or grandfathered with a dated reason — the
  `GRANDFATHERED_QUERIES` shape from `chronology-ordering.test.js`.
- **`coach_observations` is pre-seeded into the grandfather list with a dated
  reason** (`technical-plan.md` §5.3) so that whichever effort merges second
  does not break `master` for the other. Its conversion to the helper is
  tracked by **WATCH-6**, not left to chance.
- The five existing non-atomic sites (`plan_items` ×2, `token_usage` ×2,
  `webhook_targets`) are grandfathered, not retrofitted — also **WATCH-6**.

---

## DEC-4 — Prompt-budget hardening is in scope (Phase 1b), with the logging fix pulled into 1a

- **Item / area:** `server/lib/reconciliation.js`
  (`buildDispositionPrompt`, `parseDispositionOutput`), `server/lib/detours.js`
  (`MAX_DETOUR_LABEL_CHARS`)
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead
- **Recurring-issue link:** candidate **SHARED-BUDGET-STARVATION**
  (`PROJECT-CONTEXT.md` §9.6 tail; promotion trigger recorded there) — see
  WATCH-3

### The question

`buildDispositionPrompt` ends in `.slice(0, 8_000)` applied to the *whole*
assembled prompt, so the **tail** — which is where the `Reply with ONLY JSON`
instruction lives — is what gets cut; and `parseDispositionOutput` ends in
`catch { return new Map(); }` with no log, so an overrun yields **zero
verdicts for the entire tick** with a green suite and nothing written down.
This is a pre-existing latent bug, currently unreachable only because every
input is capped upstream (`focus-inference.js:288` caps labels at 120 chars).
Is fixing it in scope for *this* plan, or a separate item?

### Decision

**In scope, as mandatory Phase 1b tasks** (PM §4.4 / §6.3.3 required this
explicitly), with **one carve-out pulled forward into Phase 1a**: the
`parseDispositionOutput` / zero-verdict logging fix.

**Rationale / implications:**
- It is only "latent" because nothing unbounded feeds it. This request *is*
  the first unbounded input (commit subjects, author names, diffstats). Landing
  `trunk_drift` labels without the cap converts a latent bug into a live one in
  the same change — that is not a separate item, it is this change's own blast
  radius.
- Three fixes, all Phase 1b except where noted:
  1. `MAX_DETOUR_LABEL_CHARS = 400`, applied at the point **every** composer
     returns (`capLabel()` in `detours.js`), not only the trunk-drift one — so
     the fix generalises instead of special-casing the new source. 400 is
     derived from the PM's live budget math: ~540 chars/detour of headroom at
     `MAX_DETOURS_PER_TICK` = 10, minus margin.
  2. Move the JSON reply instruction **above** the `PLAN ITEMS` / `DETOURS`
     lists, and budget those lists per-section, so whole-prompt truncation can
     never drop the output contract. The 8,000 backstop stays but logs when it
     bites.
  3. `parseDispositionOutput`'s empty-map return **logs loudly** — both the
     `catch` and the "parsed fine but produced zero verdicts for a non-empty
     batch" case.
- **Why (3) moves to Phase 1a:** DEC-7's live trial is scheduled for this week
  and one of its two data points is an unexplained `write_status='failed'` row
  (id 19). Diagnosing that trial while the pipeline's main failure mode is
  silent is strictly harder. The change is log-only — zero behavioural change
  to verdicts — so it does not violate 1a's read-only posture in any way that
  matters, and it makes 1b's gate cheaper to clear.
- No new catalog entry is opened (PM §4.4 call, upheld). The promotion trigger
  lives in `PROJECT-CONTEXT.md` §9.6's tail and is restated in WATCH-3.

### Amendment (QA Phase-1a pass, 2026-08-02)

**Scope widened per QA assessment:** the logging-only fix now covers both:
- `parseDispositionOutput`: terminal catch (unparseable JSON) and zero-verdicts-for-non-empty-batch path
- `classifyFlaggedDetours`: exit 4 (`!available`, CLI unavailable) and exit 5 (`stdout == null`, CLI answered nothing)

Both additions are logging-only, zero behavioural change to verdict production. The two exits are distinguishable in the log, so DEC-7's live trial can differentiate "CLI tool missing" from "CLI tool answered nothing" — the dominant failure mode hypothesis in that trial.

---

## DEC-5 — "Work that happened directly on trunk" is defined git-natively, with no DB attribution join

- **Item / area:** `server/lib/trunk-drift.js` — the detection predicate
- **Status:** DECIDED-AUTO
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead
- **Recurring-issue link:** §9.2 row-id-as-chronology-proxy (bounded out by
  this decision — see below)

### The question

`request-brief.md`'s assumption #2 says the detector "does not need to attempt
attribution at all." QA §3a case 3 says the **single most important test in the
whole suite** is that work which *did* go through the declared focus /
worktree-branch flow is **not** flagged. Those two pull in opposite directions:
with no attribution test whatsoever, every commit on trunk inside the lookback
window becomes a `trunk_drift` detour, including work that went through the
tracked flow and merged in. What is the predicate?

### Options presented

- **A) No predicate — flag every commit on trunk in the window.** Rejected:
  fails QA's load-bearing false-positive guard, and a noisy detector destroys
  the "unknown work" badge's meaning (the stated product risk).
- **B) Join `events` / `focus_inferences` / session time-windows to decide
  whether a session was live when the commit was authored.** Rejected: this is
  the "smarter attribution heuristic" the brief explicitly puts out of scope,
  it makes the detector DB-coupled (breaking the `repo-topology.js` posture and
  its testability), and it drags §9.2's `created_at`-ordering requirement into
  the detector's core.
- **C) A purely git-native predicate (chosen).**

### Decision

**Chosen: C.** A commit is "direct-to-trunk work" iff **all** hold, and all
three are properties git already knows:

1. it is on the default branch's **first-parent** line (`--first-parent`) —
   commits that entered via a merge's side branch are, by construction, the
   worktree/feature-branch flow the dashboard already tracks;
2. it is **not itself a merge commit** (`--no-merges`) — a merge on trunk
   *represents* branch work, it isn't direct-to-trunk work;
3. it is **not reachable from any other local branch ref**
   (`--not --exclude=refs/heads/<trunk> --branches`) — covers the
   fast-forward case where a still-existing feature branch's commits sit on
   trunk's first-parent line with no merge commit.

Plus the idempotency filter, which is **not** attribution: SHAs already
present as `detour_dispositions(source='trunk_drift', source_ref=<sha>)` rows
for that `cwd`, supplied by the caller as a `Set` so the detector stays
DB-free (architect §4 Option 3).

**Rationale / implications:**
- This is literally Sara's own phrasing — "real work has happened **directly**
  on a repo's trunk/default branch" — expressed as a git property. It makes no
  judgement about *what* the work is (no classification), and reads no
  dashboard table.
- §9.2 is bounded out of the detector entirely: the only DB read is a
  `SELECT source_ref … WHERE cwd = ? AND source = 'trunk_drift'` set-membership
  query with no `LIMIT`, no window, and no ordering. Commit sequencing is
  governed by **git's own DAG order** (`--first-parent` walk), never by
  `created_at`. The two axes are named separately in `technical-plan.md` §3.3
  so they cannot be silently conflated.
- Accepted residual false positive: **WATCH-1**.

---

## WATCH-1 — A fast-forward-merged, then-deleted branch is indistinguishable from direct-trunk work

- **Item / area:** `server/lib/trunk-drift.js` detection predicate (DEC-5)
- **Status:** PARKED (accepted limitation, shipping knowingly) — **superseded
  2026-08-03, see below: the scope of the accepted risk widened.**
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead
- **Recurring-issue link:** —

> **Update (2026-08-03) — DEC-5 clause 3 removed entirely, by
> `2026-08-03-trunk-drift-open-branch-blindness`.** Found via the
> `plan-lifecycle-value-ledger` effort's slice-4 checkpoint against real
> Coaching Assistant data: clause 3 (`--not --exclude=<trunk> --branches`)
> doesn't just protect the ff-merge-branch-still-exists case this WATCH row
> names — it excludes trunk's *entire* history shared with *any* other local
> branch that merely exists, regardless of how much or little that branch has
> diverged. A concurrently-open effort worktree (a completely ordinary,
> frequent state for this kind of project) was enough to blind the detector
> across its whole lookback window, not just anything related to that branch.
> Traced the topology and confirmed: a fast-forward-merged-but-undeleted
> branch and a freshly-created-but-not-yet-started branch are **provably
> indistinguishable** from git alone (same merge-base, zero commits ahead
> either way) — there is no narrower fix that protects one without permitting
> the other. Given this project's real merge convention is always `--no-ff` +
> branch deletion (never bare fast-forward), the scenario clause 3 protected
> was judged unlikely to occur in practice, while the blind spot it caused was
> frequent and severe. Clause 3 was removed; `--first-parent --no-merges`
> alone remains (a `--no-ff` merge's own commits are already invisible to a
> first-parent walk regardless of branch existence, so that half of DEC-5 is
> untouched). **This WATCH-1 row's accepted risk is hereby widened**: a
> ff-merged branch now reads as direct-to-trunk work **for as long as its ref
> exists**, not only after deletion — see
> `intake/2026-08-03-trunk-drift-open-branch-blindness/decisions.md` for the
> full trade-off record and `server/__tests__/trunk-drift.test.js` cases
> 3b/3c (updated expectations) and 6c (new, red-proven regression case for
> the actual bug).

### The question

DEC-5's clause 3 excludes commits still reachable from another local branch.
What about work that went through a feature branch, was **fast-forward**
merged into trunk (no merge commit), and whose branch ref was then deleted?

### Decision

**Accepted as a known false positive.** Git retains no evidence distinguishing
that history from commits typed directly on trunk — there is no ref, no merge
commit, and no trailer to read. The detector will flag such commits.

**Rationale / implications:**
- The correct fix is either (a) an attribution join against
  `events`/`focus_inferences` session windows — explicitly out of scope per
  `request-brief.md` assumption #2, and if it is ever added, §9.2's
  `created_at`-ordering requirement binds that join and needs its own WATCH row
  at that time (architect's own carried-forward boundary), or (b) a
  repo-side convention (`--no-ff` merges, or a commit trailer written by
  `ccam focus`), which is a process change, not this build.
- Impact is limited by the `pending` lifecycle: a false positive costs one
  LLM verdict and one `decision_queue` row someone dismisses — it does not
  corrupt data. Under DEC-13 auto-write it *can* cost a spurious
  `AGENT-PLAN.md` line, which is one more reason Phase 1b is gated on DEC-7
  (WATCH-5).
- **Watch for:** this row being read as "the detector is broken." It is not —
  it is precise about a thing git cannot answer.

---

## WATCH-2 — `trunk_drift` rows for planless cwds never reach the LLM

- **Item / area:** `server/lib/reconciliation.js` `listReconcileTargets`,
  `reconcileCwd`
- **Status:** PARKED (pre-existing behaviour, restated for this source)
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 (inherited) · **Decided
  by:** `intake/2026-08-01-build-project-manager` WATCH-2
- **Recurring-issue link:** —

### The question

`listReconcileTargets` only returns cwds with a live plan (`plans.missing_at
IS NULL` and ≥1 `plan_items` row), and `reconcileCwd` returns
`{ skipped: "no_plan" | "no_items" }` otherwise. A repo with trunk drift but no
`AGENT-PLAN.md` therefore gets rows written and never dispositioned.

### Decision

**Unchanged behaviour, restated so it is not rediscovered as a bug.** This is
identical to how `inferred`/`declared` detours already behave.

**Rationale / implications:**
- It has a sharper edge for this source: trunk drift is *most* likely on repos
  that are informally managed, which correlates with not having a plan.
- Consequence the plan honours: the Phase 1a read-only Project Detail card is
  **not** gated on a plan existing, so an unplanned repo's drift is still
  visible to a human even though it never reaches the queue.
- `detour_dispositions.cwd` **must** equal `plans.cwd`, not the repo's git
  root (engineer gotcha #3) — `technical-plan.md` §4.4 makes this a hard
  requirement with its own test, because getting it wrong silently pollutes
  another project's pending list.

---

## WATCH-3 — SHARED-BUDGET-STARVATION: promotion trigger, not yet a catalog entry

- **Item / area:** `server/lib/reconciliation.js` `buildDispositionPrompt`
  (8,000-char whole-prompt budget); sibling budgets in
  `focus-inference.js` (6 K ×2), `focus-summary.js` (12 K / 16 K),
  `focus-audit.js` (4 K)
- **Status:** PARKED (recorded with an explicit promotion trigger)
- **Raised:** 2026-08-02 (architect §5, quantified by PM §4.4) ·
  **Decided:** 2026-08-02 · **Decided by:** PM, upheld by tech lead
- **Recurring-issue link:** candidate 7th `PROJECT-CONTEXT.md` catalog entry

### Decision

**No new catalog entry now.** Zero prior occurrences, and every existing
shared-budget site is safe *by construction* because its inputs are capped
upstream. **Promote to a real entry the first time either (a) a second shared
truncation budget is found taking unbounded input, or (b) this one actually
fires.** Recorded in `PROJECT-CONTEXT.md` §9.6's tail by the PM pass; restated
here so this intake's own trail is self-contained.

**Rationale / implications:**
- The three fixes DEC-4 mandates are what keep (b) from happening as a result
  of *this* change. They do not close the pattern — the other four budgets are
  untouched and still whole-prompt-truncating.
- Once DEC-4's logging fix ships (Phase 1a), condition (b) becomes
  **observable** rather than silent. That is the point.

---

## WATCH-4 — `trunk_drift` labels are the first `detour_dispositions.label` built from uncontrolled external text

- **Item / area:** `server/lib/detours.js` `formatTrunkDriftLabel`,
  `server/lib/reconciliation.js` prompt assembly, and any UI that renders a
  detour label
- **Status:** PARKED (mitigated, not eliminated)
- **Raised:** 2026-08-02 (architect §5, the trust-boundary concern the brief
  does not name) · **Decided:** 2026-08-02 · **Decided by:** intake tech lead
- **Recurring-issue link:** —

### The question

The two existing label sources are low-risk (a classifier's own narrative; a
title typed by whoever ran `ccam focus`). A trunk-drift label is composed from
**commit subjects and author names** — free text written by anyone who ever
committed to the repo — and is concatenated unescaped into an LLM prompt
that, under DEC-13, drives **unattended writes to `AGENT-PLAN.md`**. A commit
subject reading `... ignore previous instructions and ...` is a plausible
prompt-injection vector into a pipeline that writes files.

### Decision

**Mitigate and track; do not attempt a general solution this round.**
Mitigations landing in Phase 1b (`technical-plan.md` §5.5):
1. `capLabel()` / `MAX_DETOUR_LABEL_CHARS` bounds the injected text (DEC-4).
2. `formatTrunkDriftLabel` **strips control characters and collapses newlines
   to spaces**, so a subject cannot forge new prompt lines (`id=… label="…"`
   structure stays intact).
3. Only `%s` (the commit **subject**, one line) is used — never the full
   commit body, never diff content.
4. The existing `plan-writeback.sanitizeLlmPlanText` (DEC-13) remains the last
   line of defence on anything actually written to a file. It is unchanged and
   out of scope here.

**Rationale / implications:**
- These reduce the surface substantially but do not make the label
  *untrusted-safe* in a formal sense — an LLM reading an adversarial commit
  subject inside a 400-char budget can still be nudged.
- **Watch for:** any future change that widens the label to include commit
  bodies, diff hunks, or branch names. That is the point at which this needs a
  real answer (structural isolation / delimiter escaping in
  `buildDispositionPrompt`), not a wider cap.

---

## WATCH-5 — Phase 1b is gated on DEC-7's live trial; the gate is a real gate

- **Item / area:** Sequencing — `intake/2026-08-01-build-project-manager/decisions.md`
  DEC-7 (live-trial gate) and DEC-13 (auto-write, unattended)
- **Status:** PENDING (the gate itself is unresolved; the tech plan is written
  around it)
- **Raised:** 2026-08-02 · **Decided:** — · **Decided by:** — (Sara; PM open
  decision #2)
- **Recurring-issue link:** —

### The question

DEC-7 ("a passing test suite is not sign-off") requires Sara to review real
`decision_queue` output and real unattended `AGENT-PLAN.md` writes. As of the
PM's live DB query (2026-08-02): 24 `detour_dispositions` rows, all
`source='inferred'`, 22 still `pending`; the auto-write pipeline has fired
exactly **twice**, both against `/Users/sara/CODE-LOCAL/SARA/emails` — id 3
`written`, id 19 **`failed`** — and `decision_queue` holds 2 pending entries,
one of them the `writeback_failed` escalation from id 19, **unreviewed**.

### Decision

**Phase 1b does not start until DEC-7 closes.** Recorded here rather than left
as a sentence in `technical-plan.md` §7, because a gate that exists only in
prose is a gate that gets stepped over at build time.

**Rationale / implications:**
- DEC-7's trial is one sitting: read the 2 pending `decision_queue` entries,
  diagnose the `write_status='failed'` row (id 19), read the block that landed
  in `emails`' `AGENT-PLAN.md`, answer "signal or noise?"
- If the answer is "noise," 1b would have multiplied it — and per DEC-2 this
  source can emit one row per commit. That is precisely the amplification
  DEC-7 was written to catch.
- DEC-4's logging fix ships in Phase 1a **specifically to make this trial
  easier to run**, since the pipeline's dominant failure mode is currently
  silent.
- **Trial note (updated with DEC-4's widened scope):** the instrument now
  distinguishes CLI-unavailable (`classifyFlaggedDetours` exit 4, `!available`)
  from CLI-returned-nothing (exit 5, `stdout == null`) in the log — two
  distinct, non-identical log lines — so when Sara runs this trial she can
  tell which of the two silent failure modes actually dominates instead of
  a single undifferentiated "classification didn't happen" signal.
- **Blocking:** Phase 1b only. Phase 1a is unblocked.

---

## WATCH-6 — Grandfathered rebuild sites: five legacy + `coach_observations`

- **Item / area:** `server/db.js` table rebuilds; `REBUILD_CASES` registry in
  `server/__tests__/db-migration.test.js`
- **Status:** PARKED (deliberate non-retrofit, tracked)
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead, implementing DEC-3
- **Recurring-issue link:** **§9.6 NON-ATOMIC REBUILD** (five confirmed latent
  live instances)

### The question

DEC-3 builds `rebuildTableAtomically` and a `REBUILD_CASES`
registry-completeness meta-test. What happens to the six rebuild sites that
already exist, and to `coach_observations`, which is mid-flight in another
effort?

### Decision

**Grandfather, with dated reasons; do not retrofit in this change.** The
registry ships pre-seeded with:

| Site | Status in registry | Dated reason |
|---|---|---|
| `plan_items` (×2, `db.js:776`, `843`) | grandfathered | 2026-08-02 — §9.6 latent instance; retrofit is its own change, with a DB backup |
| `token_usage` (×2, `db.js:1084`, `1674`) | grandfathered | 2026-08-02 — same |
| `webhook_targets` (`db.js:1524`) | grandfathered | 2026-08-02 — same |
| `agents` (`db.js:1560-1600`) | grandfathered (partial) | 2026-08-02 — atomic and correct; has a legacy case (`agents-legacy-rebuild.test.js`) but **no interruption case** |
| `coach_observations` | grandfathered | 2026-08-02 — owned by in-flight effort `2026-08-02-practice-kind-override`; converting it here would invalidate that build's Task 4 structural scan and its recorded red evidence (DEC-3) |
| `detour_dispositions` | **registered** | new: legacy case in `db-migration.test.js` + interruption case in `detour-dispositions-source-rebuild.test.js` |

**Rationale / implications:**
- Grandfathering rather than weakening the scan is the
  `chronology-ordering.test.js` `GRANDFATHERED_QUERIES` precedent, which
  §9.6's own "how to comply" section names.
- **The two follow-ups this row exists to track:**
  1. Convert `coach_observations` to `rebuildTableAtomically` once
     `2026-08-02-practice-kind-override` merges, and move it from
     grandfathered to registered.
  2. Retrofit the five non-atomic sites as their own change, with a real
     `dashboard.db` backup taken first (§9.6's own instruction).
- **Watch for:** the grandfather list growing. Every new entry after this row
  means the helper failed at its one job. A new rebuild site that is neither
  registered nor grandfathered fails the meta-test — that is the tripwire.

---

## WATCH-7 — Declined scope: classification vocabulary, `plan-writeback.js`, layer-7 rollup UI

- **Item / area:** Whole request — scope boundary
- **Status:** PARKED (carried forward from `request-brief.md`'s
  "Confirmed scope boundary — do not re-litigate", and
  `practice-kind-override` WATCH-3)
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** Sara
  (in the originating design conversation), upheld by PM §6.4
- **Recurring-issue link:** —

### Decision

This build does **not** touch: the `fold_in` / `new_item` / `deliberate` /
`discard` vocabulary or the logic that assigns it; `server/lib/plan-writeback.js`;
`decision_queue`'s shape; or the layer-7 portfolio rollup UI (still deliberately
deferred per the `portfolio-reconciliation-vision` memory).

**Rationale / implications:**
- The detector produces **no verdict**. `technical-plan.md` §8's Definition of
  Done carries an explicit check that no disposition string appears anywhere in
  `server/lib/trunk-drift.js`.
- `buildDispositionPrompt` **is** modified — but only for the budget/ordering
  hardening of DEC-4, never for source-awareness. It continues to read
  `f.label || ""` as an opaque string with no knowledge of `source`.
- Any proposal to cross these lines goes back to Sara as a separate request.

---

## WATCH-8 — The un-intake'd-capability routing rule (`practice-kind-override` DEC-5) remains unadopted

- **Item / area:** Process governance — `PROJECT-CONTEXT.md`
- **Status:** PENDING (someone else's row; carried here so this build does not
  read as the whole fix)
- **Raised:** 2026-08-02 · **Decided:** — · **Decided by:** —
- **Recurring-issue link:** — (candidate process-governance entry)

### Decision

**Not in this build's scope, and explicitly not solved by it.** PM §4.1 is
unambiguous: this detector converts "found by a manual sweep, days later" into
"surfaced automatically," which is a large improvement in *discovery latency*
and the first countermeasure in this history that does not depend on anyone
remembering anything — but it is still detection **after** the commit lands.
The routing rule (`practice-kind-override` DEC-5) is the half that prevents
recurrence, and it has been recommended three times across two projects and
adopted zero times while 8 more un-intake'd `feat` commits landed on `master`
in 48 hours.

**Rationale / implications:** shipping this request and leaving DEC-5 pending
for a fourth cycle is the outcome the PM plan names as the one most worth
avoiding. This row exists so that outcome is at least *recorded* rather than
quietly repeated.

---
<!-- copy the DEC block above for each new question -->
