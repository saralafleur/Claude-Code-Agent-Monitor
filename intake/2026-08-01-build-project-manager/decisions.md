# Decision Log — build-project-manager (layers 4–6)

> Every clarifying / blocking question the team raised on this request, the
> context behind it, the options offered, and the choice made. Readable on its
> own — someone should be able to open this months later and understand *what we
> decided and why*. Newest decisions at the bottom.
>
> Status values: **PENDING** (asked, awaiting answer) · **DECIDED** ·
> **PARKED** (deferred to stakeholder / later) · **SUPERSEDED** (a later
> decision overrode this one — link it).
>
> Recurring-issue catalog for this project: `PROJECT-CONTEXT.md` §9.1
> DERIVED-DUAL-VIEW, §9.2 row-id-as-chronology-proxy.

---

## DEC-1 — Classification and scope
- **Item / area:** Whole request
- **Status:** DECIDED (PM), awaiting cheap confirm from Sara
- **Raised:** 2026-08-01 · **Decided:** 2026-08-01 · **Decided by:** PM
- **Recurring-issue link:** —

### The question
Is this a `new-feature`, and is the buildable scope layers 4–6 only?

### Decision
**`new-feature`**, sub-classified as a *net-new subsystem built as a sequel*
(every mechanical piece has a shipped precedent in this repo). Scope is
**layers 4, 5, 6 only**. Layers 1–3 already shipped; layer 7 (portfolio
rollup UI) stays out — see WATCH-3.

---

## DEC-2 — Plan write-back fork (highest-stakes item)
- **Item / area:** Layer 4 disposition semantics
- **Status:** DECIDED — **B (real write-back)**
- **Raised:** 2026-08-01 (engineer §0, elevated by PM) · **Decided:** 2026-08-01 · **Decided by:** Sara
- **Recurring-issue link:** —

### The question
Two of layer 4's four dispositions (`fold_in`, `new_item`) mean *creating a
plan item*. Can the dashboard write them into `plan_items` / `AGENT-PLAN.md`?

### Where we're coming from
`server/lib/plan-ingest.js` states in its own header that `AGENT-PLAN.md` is
the human-owned source of truth and the dashboard never writes it. The
enforcement is `deletePlanItemsNotIn` (`server/db.js:2183`):
`DELETE FROM plan_items WHERE cwd = ? AND item_id NOT IN (...)`, run on every
ingest. Any DB-only plan item is deleted on the very next poll/SessionStart.

### Options presented
- **A) Advisory-only** (PM + tech-lead recommendation) — record the
  disposition, link it to the detour, and emit a **paste-ready markdown
  snippet** Sara drops into `AGENT-PLAN.md` herself. Plan file stays hers.
- **B) Real `AGENT-PLAN.md` write-back** — new capability, needs
  concurrent-edit conflict handling (ingest is purely content-hash/mtime
  driven, no notion of "my own edit"), zero prior art, raises layer 4 M→L.

### Decision
**B — real write-back.** Sara chose this against the team's recommendation.
Implications: Layer 4's technical-plan section is **reopened** — a new
write-back module must be designed (safe append into `AGENT-PLAN.md`,
self-write/concurrent-edit detection so the ingest watcher doesn't treat the
dashboard's own edit as an external change or a race against a simultaneous
human edit, and how `deletePlanItemsNotIn` behaves across a
dashboard-initiated write). Effort moves from M to **L**. QA's DEC-12
rewrite (written for advisory-only) is superseded — see DEC-13. Sent back to
architect/engineer/QA for a Layer-4 redesign pass before the technical plan
is finalized.

### Follow-through (2026-08-01, tech lead)
The redesign pass is complete. The architect's resolution: item identity in
this system is the `id:` line, not authorship, and `deletePlanItemsNotIn`
only runs after a `content_hash` mismatch and only deletes by absent
`item_id` — so a well-formed dashboard-written block with a synthesized `id:`
is indistinguishable from a human's and survives every subsequent ingest.
`technical-plan.md`'s Layer 4 section has been rewritten in place around
`server/lib/plan-writeback.js`; see its "Revision history" note.

---

## DEC-3 — Build sequence
- **Item / area:** Delivery sequencing
- **Status:** DECIDED (PM + engineer + architect converged), cheap confirm
- **Raised:** 2026-08-01 · **Decided by:** PM

### Decision
**Layer 5 → Layer 4 → Layer 6**, each shown to Sara before the next starts.
Layer 6's rule half cannot run without layer 5's `target_date` and pace
utility; its LLM half needs layer 4's durable detour identity to write a
verdict onto. Three judgeable checkpoints rather than one delivery — the
direct counter to the WIP-queue removal (`18196dc`, 2026-07-30).

### Refinement (2026-08-01, post-DEC-2/DEC-13)
Layer 4 is now the heaviest slice, so it gets an internal split and a
**fourth** checkpoint: the write-path plumbing (`atomic-file.js` extraction,
`plan-ingest.js` exports, `plan-writeback.js`'s low-level functions) has no
dependency on `detour_dispositions` existing and is built, tested and shown
first — at the exact point the risk concentrates, which is writing Sara's
file. See `technical-plan.md` §4 step 11a.

---

## DEC-4 — Architect's Q1–Q4 adopted as a batch
- **Item / area:** System design
- **Status:** DECIDED (PM), cheap confirm
- **Raised:** 2026-08-01 · **Decided by:** PM

### Decision
- **Q1** — new `detour_dispositions` table (durable decision), separate from
  the classifier's re-derivable `focus_inferences` (observation). Record
  created **at classification time** inside `inferSession`. No FK on
  `session_id` (audit trail outlives session cleanup, per `alert_events`).
- **Q2** — new `decision_queue` table, shaped like but **not** reusing
  `alert_rules`/`alert_events`.
- **Q3** — `plan_items.target_date`, additive `ALTER TABLE`, authored
  out-of-band, **excluded from `upsertPlanItem`'s `SET` list** (mirrors
  `declared_done_at` literally). See DEC-10.
- **Q4** — new in-process scheduler `server/lib/reconciliation.js` +
  `startReconciliation()`, wired from `server/index.js`. Not `/loop` (does
  not exist in this repo), not OS cron (second process on the same SQLite
  file = WAL contention + a second path to the WebSocket broadcast).

Q1's table shape has since gained a write-audit block and `proposed_*`
content columns (DEC-2/DEC-13), and Q2's `kind` enum gained two values —
both landing in the initial `CREATE TABLE`, per DEC-15. Q3 and Q4 are
unchanged.

---

## DEC-5 — Pace math's completion signal
- **Item / area:** Layer 5 semantics
- **Status:** DECIDED — **A** (defines what "on track" means)
- **Raised:** 2026-08-01 (engineer) · **Decided:** 2026-08-01 · **Decided by:** Sara

### The question
Does "done" for pace purposes mean `plan_items.checked` (the human-owned
checkbox mirrored from the file) or `declared_done_at` (the agent's own claim
via `ccam focus done N`)? They can and do disagree.

### Options presented
- **A) `checked` primary, `declared_done_at` secondary** (PM + tech-lead
  recommendation) — an item counts as complete when **either** is set;
  `pace.js` returns which signal fired so the two can be told apart.
- **B) `checked` only** — strictest, but an agent-completed-but-unchecked item
  keeps raising pace alerts until Sara ticks the box.
- **C) `declared_done_at` only** — earliest signal, but an agent's claim
  silences a real pace alert.

### Decision
**A — confirmed.** Layer 6's rule must call layer 5's `pace.js` utility and
never re-derive its own completion test (§9.1 by construction). No rework
needed — the technical plan was already written against this option.

---

## DEC-6 — `target_date` format
- **Item / area:** Layer 5 schema
- **Status:** DECIDED (tech lead, per architect), cheap confirm
- **Raised:** 2026-08-01 (architect) · **Decided by:** Tech lead

### Decision
**Date-only `YYYY-MM-DD`, interpreted as a local calendar day** — not an
ISO-8601 UTC instant like `declared_done_at`. "By Friday" is a calendar day;
a UTC instant invites off-by-one pace comparisons across timezones.
Boundary pinned: an item whose `target_date` **equals today** is `on_track`
(grace runs through the end of the target day); `behind` starts the next
local day. An unparseable/invalid stored value degrades to `no_target`,
never to `behind`.

---

## DEC-7 — Live-trial gate before "done"
- **Item / area:** Definition of Done
- **Status:** DECIDED (PM), cheap confirm
- **Raised:** 2026-08-01 (product owner AC #8) · **Decided by:** PM

### Decision
A passing test suite is **not** sufficient sign-off. Sara reviews real
decision-queue output against her own fleet for a period, and her read
("signal, not noise") is the pass criterion. Non-optional DoD item.

### Scope widened (2026-08-01, per DEC-13)
This gate now also covers **the actual content auto-written into her
`AGENT-PLAN.md` files**, not only decision-queue entries. Under DEC-13 =
auto-write, "signal, not noise" has to hold for unattended edits to a
stakeholder-facing document — the highest-stakes surface in this effort.

---

## DEC-8 — Close-out obligations
- **Item / area:** Process
- **Status:** DECIDED (PM), ours to absorb
- **Raised:** 2026-08-01 · **Decided by:** PM

### Decision
1. Correct the `/loop` claim in `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/pm.md`
   and in the `portfolio-reconciliation-vision` auto-memory — no `/loop` file,
   script, skill, or command exists in this repo (three independent greps).
2. Sync `portfolio-reconciliation-vision` and `holistic-focus-history` memory
   entries once layers 4–6 land (both currently describe them as undesigned).
3. Update `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`,
   `server/README.md` per the `update-project-docs` trigger.
4. **(Added 2026-08-01, per DEC-2.)** Correct every claim in code and docs
   that the dashboard never writes `AGENT-PLAN.md` — including
   `server/lib/plan-ingest.js`'s own file header, which currently asserts it.
   A stale claim about a trust boundary is worse than no claim.

---

## DEC-9 — LLM kill switch naming
- **Item / area:** Layer 6 config
- **Status:** DECIDED (tech-lead call, flagged to Sara)
- **Raised:** 2026-08-01 (architect vs. engineer split) · **Decided by:** Tech lead

### The question
Reuse `DASHBOARD_FOCUS_INFER_MODE` for the reconciliation LLM path
(architect's lean: "disable the LLM path" means one thing everywhere), or add
a new `DASHBOARD_RECONCILE_MODE` (engineer's proposal)?

### Decision
**Both, with a defined precedence.** A new `DASHBOARD_RECONCILE_MODE`
(`on`|`off`, default `on`) plus `DASHBOARD_RECONCILE_MS` controls the
reconciliation pass independently, **and** the LLM half additionally honors
the existing `DASHBOARD_FOCUS_INFER_MODE=off`. So: turning reconciliation off
does not disable session classification, and turning the focus-infer LLM off
still stops every LLM spawn everywhere — including reconciliation's, while
its deterministic rule half keeps running (rules never call an LLM by
design, so there is nothing to disable there).

**Note under DEC-13:** `DASHBOARD_RECONCILE_MODE=off` is now also the kill
switch for *unattended file writes* — with the tick off, the only remaining
write trigger is a human's explicit resolve call.

---

## DEC-10 — `target_date` authoring path (engineer override)
- **Item / area:** Layer 5 implementation
- **Status:** DECIDED (tech lead)
- **Raised:** 2026-08-01 (engineer/architect conflict) · **Decided by:** Tech lead

### The question
The engineer's layer-5 change set proposes parsing a `target:` line out of
`AGENT-PLAN.md` (new `TARGET_LINE_RE` in `plan-ingest.js`, new column in
`upsertPlanItem`'s INSERT + `SET` list, new positional arg at every call
site). The architect's Q3 recommends out-of-band authoring instead.

### Decision
**Out-of-band only — the engineer's `plan-ingest.js` parser change is
overridden and must NOT be implemented.** Reasons, in order of weight:
1. A file-parsed `target:` written through `upsertPlanItem`'s `SET` list is
   **reset or nulled by any reformat/edit of the file** — the opposite of the
   `declared_done_at` protection this field is supposed to mirror.
2. It avoids the engineer's own highest-probability bug in this layer: the
   `upsertPlanItem` prepared-statement `?` positions and its `plan-ingest.js`
   call-site argument list are a silently-desyncing sibling pair. Not adding
   the column to that statement removes the trap entirely.
3. A target date is scheduling state layered onto plan content, not plan
   content — keeping it out of the file keeps `AGENT-PLAN.md` at the
   plain-language stakeholder altitude layers 1–2 exist to hold.

Authoring path: `POST /api/plans/items/target` + `ccam focus target <n>
<YYYY-MM-DD> | --clear`.

**Unaffected by DEC-2:** the write-back design adds **exports only** to
`plan-ingest.js` (field regexes + safety caps), never a new parse rule and
never a new `upsertPlanItem` column.

---

## DEC-11 — Test-template precedent (PM-flagged conflict, resolved)
- **Item / area:** Test structure
- **Status:** DECIDED (tech lead)
- **Raised:** 2026-08-01 (PM flagged engineer-vs-QA conflict) · **Decided by:** Tech lead

### The question
QA's plan cites `server/__tests__/session-liveness.test.js` as the template
for layer 6's fixed-rule tests (following pm.md's own framing). The engineer
corrected this: that file tests a synchronous `ps`/`lsof` probe, not a
scheduled loop.

### Decision
Resolve toward the **engineer's corrected recommendation**:
- Scheduler + fixed-rule tests → copy `server/__tests__/focus-audit.test.js`
  (pure-function verdict tests + an injected-spawn integration test, exported
  tick function called directly rather than waiting on a timer).
- LLM-half tests → copy `server/__tests__/focus-summary.test.js`
  (`envelope()` / `fakeSpawn()` / `fakeSpawnSequence()` /
  `__injectSpawnForTest`, digest-gated cache assertions, garbage-input
  degradation).
`session-liveness.js` remains the right citation for the **fail-safe
contract** ("no trustworthy read → change nothing"), not for test shape.

**Gap noted (2026-08-01):** Layer 4's write-back conflict tests have **no**
in-repo template at all — nothing in this codebase retries a file write
against a human's concurrent edit. The injected-seam *discipline* of
`focus-summary.test.js` carries over (`__injectPreRenameHookForTest`), but
the assertions are net-new.

---

## DEC-12 — QA's `fold_into_plan` spec is known-wrong, rewritten
- **Item / area:** Layer 4 test guidance
- **Status:** **SUPERSEDED** by DEC-2 (B) + DEC-13 (A) — see below
- **Raised:** 2026-08-01 (PM) · **Decided by:** Tech lead
- **Superseded:** 2026-08-01

### The question
QA's layer-4 spec asserts a `fold_into_plan` disposition "produces a new
`plan_items` row … and the row's identity survives a subsequent
`AGENT-PLAN.md` ingest."

### Decision (now superseded)
That assertion **cannot pass** under current ingest semantics
(`deletePlanItemsNotIn` removes it) and is replaced by its inverse: a
`fold_in`/`new_item` disposition **must not** create a `plan_items` row, must
persist a `suggested_markdown` snippet instead, and a regression test must
assert `plan_items` row count is unchanged across the disposition **and**
across a following re-ingest. Same for `new_plan_item`. The disposition enum
values are also renamed to the schema's own vocabulary
(`fold_in`/`new_item`/`deliberate`/`discard`) so tests and CHECK constraint
cannot drift.

### Why it is superseded
This row was explicitly contingent on DEC-2 landing as **A (advisory-only)**.
Sara chose **B**. Under real write-back, QA's *original* assertion direction
is correct again — a `fold_in` **does** produce a `plan_items` row — but by a
different mechanism: write the real file, then re-run the real
`ingestPlanForCwd`, never a direct DB insert. The reasoning above was correct
about a *DB-only* item and was never a reason against writing the file.

**What survives from this row:** the enum vocabulary
(`fold_in`/`new_item`/`deliberate`/`discard`) is unchanged and still
canonical, spelled once in `server/lib/detours.js`'s `DISPOSITIONS`.

**Action required:** the inverted assertions must be **deleted**, not left
passing. Grep the suite for any `plan_items row count is unchanged`
assertion tied to `fold_in`/`new_item` — a stale copy passing silently would
mean the two dispositions are, in practice, writing nothing. This is a DoD
item in `technical-plan.md` §8.

---

## WATCH-1 — Target-date *inference* deferred
- **Status:** PENDING (deliberately unscheduled)
- **Raised:** 2026-08-01 (architect)

Auto-estimating target dates instead of manual authorship is **not built**
and not scheduled. Layer 5 ships manual authorship only. Recorded so it is
not silently expected to "just work" later. Any later ask for it is a new
intake, not a bug against this delivery.

---

## WATCH-2 — Cross-plan lifecycle reconciliation NOT modeled
- **Status:** PENDING (deliberately unscheduled), with a required mitigation
- **Raised:** 2026-08-01 (architect; open thread in the
  `holistic-focus-history` memory)

Layer 6 reasons about **item-level pace and detour disposition only**. It
does **not** model plan lifecycle state (on hold / superseded / archived).
**Required mitigation in this build (not deferrable):** the reconciliation
tick must skip any cwd whose `plans` row has `missing_at` set, and must skip
a cwd with zero plan items, rather than firing a false pace alarm on a dead
plan. Full lifecycle modelling remains unscheduled.

**Widened 2026-08-01 (DEC-13 composition).** That same filter must now run
**before** the LLM classification step, not just before the pace-alert write,
because a `fold_in`/`new_item` verdict for a dead or planless cwd would
otherwise attempt an unattended file write into a plan that isn't there. The
invariant is enforced once, in `listReconcileTargets`. The easy way to get
this half-right is to add the `missing_at` filter to the pace branch and
forget the write-back branch — `technical-plan.md` §6 requires a test on
**both** branches.

---

## WATCH-3 — Layer 7 (portfolio rollup UI) out of scope
- **Status:** PENDING (deliberately unscheduled)
- **Raised:** 2026-08-01 (PO, re-flagged by architect for a durable row)

No client changes ship in this effort — **no badge, no card field, no nav
entry**, not even "while we're in here." The decision queue is API + CLI
only this round. Rationale: `18196dc` removed this repo's first
portfolio-altitude UI two days after shipping it; layer 7 waits until layer 6
produces verdicts worth rendering. **If any layer-4/5/6 derived value does get
rendered in a UI surface during this build, §9.1 DERIVED-DUAL-VIEW applies
immediately** and a cross-consumer parity test in the `[standing template]`
style is mandatory.

---

## WATCH-4 — CHECK-constrained enums are rebuild-to-widen
- **Status:** PENDING (accepted tradeoff)
- **Raised:** 2026-08-01 (tech lead)

`detour_dispositions.disposition`, `.source`, `.decided_by`, `.write_status`
and `decision_queue.kind`, `.status` carry SQLite `CHECK` constraints. SQLite
cannot alter a `CHECK` in place — adding a fifth disposition later requires
the full rename-copy-drop dance (`plan_items`' own history in `db.js` shows
the cost). Accepted because the four dispositions are fixed by a confirmed
design decision, and because a silently-accepted junk value is the worse
failure. Precedent: `alert_rules.rule_type`. See **DEC-15** for the
consequence on landing order.

---

## WATCH-5 — Cost allocation (from the original raw ask) not addressed
- **Status:** PENDING (deliberately unscheduled)
- **Raised:** 2026-08-01 (tech lead, reading the raw ask in
  `request-brief.md`)

The raw ask names "cost allocation" as part of the project-manager vision.
Layers 4–6 do **not** deliver it — they add per-tick spawn caps and
digest gating to keep *this feature's own* LLM spend bounded, which is a
different thing from attributing spend to projects/plan items. Recorded so
the gap is not discovered later as an assumed deliverable.

---

## WATCH-6 — No MCP tool surface this round
- **Status:** PENDING (deliberately unscheduled)
- **Raised:** 2026-08-01 (tech lead)

The decision queue is not exposed through `mcp/`. `npm run mcp:typecheck` /
`mcp:build` are therefore not required for this effort unless a build step
touches `mcp/` (it should not). Recorded so "an agent can read its own
decision queue" is not assumed to work.

---

## DEC-13 — Write-back trigger point (surfaced by DEC-2's redesign)
- **Item / area:** Layer 4 write-back timing
- **Status:** DECIDED — **A (auto-write on disposition)**
- **Raised:** 2026-08-01 (architect, in the DEC-2 real-write-back revision) · **Decided:** 2026-08-01 · **Decided by:** Sara

### The question
Now that Layer 4 writes real content into `AGENT-PLAN.md` (DEC-2 = B), when
does the write actually fire?

### Where we're coming from
DEC-2 settled *whether* the dashboard may write the file, not *when*. The
architect's write-back design (`plan-writeback.js`) is mechanically capable
of firing the moment a `fold_in`/`new_item` disposition is decided — but a
disposition can be decided by the LLM judgment pass unattended (Layer 6),
not only by Sara resolving a decision-queue item by hand. Writing into her
stakeholder-facing plan document without a human look at the exact text
first is a materially different trust boundary than advisory-only ever
required.

### Options presented
- **A) Auto-write on disposition** — the moment `fold_in`/`new_item` is
  decided (by the LLM pass or by Sara), `plan-writeback.js` fires
  immediately. Fastest — fully closes the loop Layer 4 was built for — but
  `AGENT-PLAN.md` can change with no per-edit human look.
- **B) Confirm-then-write** (architect's implicit lean, not yet Sara's
  call) — the disposition lands in the decision queue with its proposed
  markdown; the write only fires when Sara takes an explicit "approve and
  add to plan" action. Slower per item, keeps a human check on every line
  that enters the stakeholder document.

### Decision
**A — auto-write on disposition.** Sara chose this against the architect's
implicit lean, consistent with the whole request's goal (minimize
human-in-the-loop, escalate only for genuine judgment calls). Implications
this reopens for the engineer pass: (1) the architect's flagged content-
sanitization mitigation (strip embedded newlines / fake `id:`/`acceptance:`
continuation lines from LLM-influenced text before composing markdown) is
now **mandatory, not optional** — this is the only guard between an
unattended LLM classification and Sara's stakeholder-facing plan file; (2)
every auto-write must be traceable back to the `detour_dispositions` row
that caused it (which detour, which classification, when) so a stray write
is diagnosable after the fact, since no human confirmed it in the moment;
(3) DEC-7's live-trial gate carries even more weight now — "signal, not
noise" has to hold for unattended file writes, not just decision-queue
entries.

### Follow-through (2026-08-01, tech lead)
All three implications are now specified in `technical-plan.md`:
(1) `sanitizeLlmPlanText` ships as an exported, independently unit-tested
function called **per field before composition**; (2) the write-audit
columns + `resolved_item_id` make "which detour, which classification, when"
answerable in one query in both directions; (3) DEC-7 widened above.
Two further consequences the decision implies and the plan now pins: the
**human resolve route is also an auto-write trigger point** (A was chosen to
include it, not exempt it), and `applyDisposition` exists as the single
shared write sequence so those two call sites cannot drift (DEC-14).

---

## DEC-14 — One write path, one composer, one set of column names
- **Item / area:** Layer 4 implementation, cross-revision reconciliation
- **Status:** DECIDED (tech lead)
- **Raised:** 2026-08-01 (tech lead, reconciling the architect/engineer/QA
  write-back revisions) · **Decided by:** Tech lead
- **Recurring-issue link:** §9.1 DERIVED-DUAL-VIEW

### The question
The three write-back revisions describe the same feature with three partly
incompatible vocabularies and shapes. Left unresolved, each would produce
real code: two copies of the write sequence, two markdown composers, two
names for the disposition→item pointer, and two lifecycle vocabularies.

### Decision
1. **The write sequence lives only in `plan-writeback.applyDisposition()`.**
   DEC-13 creates two call sites (the human `POST /api/detours/:id/resolve`
   handler and `reconciliation.js`'s unattended tick). Neither may compose
   "sanitize → dispatch → audit → retry → escalate" itself. Two hand-written
   copies is §9.1 DERIVED-DUAL-VIEW on the write path — the same failure
   shape this project already catalogs, one layer over.
2. **Markdown composition lives only in `plan-writeback.js`.** The
   advisory-era `detours.buildPlanSnippet()` is **dropped from the change
   set**. `detour_dispositions.suggested_markdown` survives as a column but is
   now written by `plan-writeback.js` with *the exact block that was
   attempted*, so a `writeback_conflict` queue entry can show Sara what we
   tried to add.
3. **The disposition→item pointer is `resolved_item_id`** (the engineer's
   spelling), holding `plan_items.item_id`. QA's revision calls it
   `linked_plan_item_id` and stores the integer PK; that spelling is **not**
   used. `item_id` is the stable identity in this schema — the integer PK is
   not stable across the rename-rebuild dances `plan_items` has already been
   through.
4. **Lifecycle vocabulary:** `disposition` (the verdict) + `write_status`
   (the file-write audit) + `resolved_at`. QA's `status: proposed → resolved`
   reads as `write_status: 'pending' → 'written'`, with `resolved_at` stamped
   only on a successful write (or immediately, for
   `deliberate`/`discard`, which write nothing).

---

## DEC-15 — Land both new tables' full final shape in the initial CREATE TABLE
- **Item / area:** Layer 4 + Layer 6 schema, landing order
- **Status:** DECIDED (tech lead, per engineer's migration analysis)
- **Raised:** 2026-08-01 (engineer, write-back revision) · **Decided by:** Tech lead
- **Recurring-issue link:** WATCH-4

### The question
DEC-3 sequences Layer 4 before Layer 6, and splits Layer 4 internally. If
`detour_dispositions`'s base shape ships before the write-back redesign is
implemented — or `decision_queue` ships before its `kind` enum is widened for
write-back escalations — what does it cost to add the rest later?

### Decision
**Land the full final shape of both tables in their initial
`CREATE TABLE IF NOT EXISTS`.** Specifically: `detour_dispositions` includes
the `write_*` audit columns, the `proposed_*` content columns, and
`resolved_item_id` from the start; `decision_queue.kind`'s `CHECK` includes
`writeback_conflict` and `writeback_failed` from the start.

**Why this is not just tidiness:** SQLite **cannot add a `CHECK` constraint
via `ALTER TABLE ADD COLUMN` at all**. The other new columns are plain
nullable text and would migrate fine with this file's standard
`try/SELECT/catch/ALTER` idiom — but `write_status`'s enum and
`decision_queue.kind`'s widened enum would each require the full
rename-copy-drop rebuild (`plan_items`' own history in `db.js` shows the
cost) if added after any live DB has the table. That is a real, avoidable
cost for zero benefit when getting it right the first time is this cheap.

Grep confirms neither table exists anywhere in `server/db.js` today, so this
is still a pre-implementation choice and not a live migration.

---

## WATCH-7 — Creating a brand-new `AGENT-PLAN.md` is out of scope
- **Status:** PENDING (deliberately unscheduled)
- **Raised:** 2026-08-01 (architect, write-back revision scope boundary #1)

The write-back design **requires an existing plan file to append into**. A
cwd with no `AGENT-PLAN.md` gets a hard `NO_PLAN_FILE` error from
`appendPlanItem`/`appendSubItem` — never a synthesized fresh file. Authoring
a plan document from scratch on a human's behalf is a materially larger
blast radius than appending one item to a plan she already wrote, and this
effort does not make that decision implicitly by omission. Composes with
WATCH-2: the reconciliation tick filters planless cwds *before* the LLM step,
so this error should be unreachable from the unattended path — the guard
exists as defense in depth, not as the enforcement point.

---

## WATCH-8 — Backup retention/pruning not built
- **Status:** PENDING (deliberately unscheduled, near-term)
- **Raised:** 2026-08-01 (architect, re-flagged by engineer as worse under
  auto-write)

Every successful write-back leaves a timestamped backup under
`<cwd>/.claude/agent-plan-backups/`. There is **no retention policy**. Under
DEC-13's auto-write this grows at reconciliation-tick cadence with no human
pacing it — a confirm-gated design would have backed up once per human
approval. `cc-mutate.js`, the precedent for the backup-before-mutate rule,
has no visible pruning either, so there is no existing policy to copy.

Accepted for this round because the files are small, plain text, outside the
cwd root's normal view, and outside `PLAN_FILENAME`'s fixed lookup (so they
can never be mistaken for a second live plan). Recorded because the rollback
story in `technical-plan.md` §7 **depends on these backups existing** — the
live trial (DEC-7) must confirm they are actually landing. A retention policy
(keep last N per cwd) is the obvious follow-up and is not scheduled here.

**Build note (2026-08-01, build-implementer):** the automated half of this
watch item is now asserted by
`server/__tests__/plan-writeback.test.js`'s `"backup lands on disk — WATCH-8's
automated half"` describe block — a successful `appendPlanItem` leaves exactly
one timestamped backup under `<cwd>/.claude/agent-plan-backups/` whose content
equals the pre-write file, with a sortable `AGENT-PLAN.<ISO timestamp>.bak.md`
filename, and a `CAPS_EXCEEDED` rejection creates no backup. The still-PENDING
half is retention/pruning itself (not built) and the live-trial confirmation
that backups land on Sara's real fleet (DEC-7, Task 38 — not yet run as of
this note).

---

## WATCH-9 — Residual TOCTOU window in the optimistic lock, accepted
- **Status:** PENDING (accepted residual risk)
- **Raised:** 2026-08-01 (architect, write-back revision)

`plan-writeback.js` re-reads and re-hashes `AGENT-PLAN.md` immediately before
the atomic rename and aborts with `CONFLICT` if it changed. The gap between
that re-check and the rename is **real and not closable** without an
OS-level lock a foreign editor process would also have to honor — which does
not exist for this file. (An advisory lockfile was considered and rejected:
it only protects cooperating writers, and a human's text editor is not one,
so it would close the dashboard-vs-dashboard gap the in-process mutex already
covers while leaving the human-vs-dashboard gap — the one that matters —
wide open.)

The window is very small relative to interactive human editing cadence, and
the failure mode is bounded: the loser is the dashboard's own append, which is
recoverable from the timestamped backup and re-attemptable via
`ccam decisions retry <id>`. Recorded explicitly rather than assumed away,
because "we handle concurrent edits" is exactly the kind of claim that reads
as absolute once the prose is gone.

---

## WATCH-10 — `withCwdLock` is not a real mutex; correctness rests on synchronous calls, single-instance
- **Status:** PENDING (accepted, corrected 2026-08-01 post-build-review)
- **Raised:** 2026-08-01 (team-qa risk analyst) · **Corrected:** 2026-08-01 (build-reviewer S2, build-implementer)

Original framing (superseded below): `plan-writeback.js`'s per-cwd
`Map<cwd, Promise>` was described as an in-process mutex whose serialization
guarantee depends on exactly one server process holding that map — true as
far as it went, but the build-reviewer (S2) found the code comment overclaimed
what `withCwdLock` actually provides even within a single process: today's
call sites are synchronous, so there is no real async mutual-exclusion
mechanism being exercised — the "lock" does nothing an async caller could
rely on. The code comment has been corrected to state this plainly rather
than describe a guarantee that doesn't exist. A real per-cwd async lock was
NOT implemented in this build, since no async caller exists yet to need one;
implement one when a genuinely concurrent async write path is added, not
before.

Independent of that correction, the single-instance dependency noted
originally still holds: whatever serialization exists (today, purely
"synchronous calls never interleave") only protects against a second
*process* racing a write if `server/index.js`'s single-instance port guard
keeps a second dashboard process from starting at all. If a future change
allows multiple server instances against the same SQLite file (e.g. a
horizontally-scaled deployment), nothing here protects a concurrent write —
recorded so this is rediscovered as a documented gap, not an incident.

---

## WATCH-11 — No structural guard against a future second write-composer
- **Status:** PENDING (accepted tradeoff) — **mitigation built and passing**
- **Raised:** 2026-08-01 (team-qa risk analyst) · **Mitigation specified:** 2026-08-01 (qa-lead) · **Mitigation built:** 2026-08-01 (build-implementer)

DEC-14 established `applyDisposition()` as the sole write-composer for both
the manual resolve route and the unattended reconciliation tick, and this
build's own tests prove *today's* two call sites both use it. Nothing
prevents a **future** third call site (e.g. a new bulk-resolve endpoint) from
hand-rolling its own write instead of calling the shared function — the same
shape of trap this project's own §9.1 DERIVED-DUAL-VIEW catalog entry exists
to name. Relatedly, `sanitizeLlmPlanText`'s newline-collapsing logic is
hand-rolled rather than derived from `plan-ingest.js`'s actual line-split
regex, so a future parser change wouldn't be caught by the sanitizer's own
tests.

**Mitigation specified in `qa/test-plan.md`** (steps 6, 9, 10): a
registry-style meta-test asserting exactly one non-test reference to
`plan-writeback`'s internal write primitive (kept reachable only via a
`__testonly` namespace, per the qa-lead's partial disagreement with the
strategist's "don't export at all" suggestion — reasoning in `test-plan.md`),
plus a sanitizer test asserting against `plan-ingest.js`'s exported
`LINE_SPLIT_RE` constant directly rather than a hand-copied pattern. Accepted
as a tradeoff rather than a hard lint rule, since no such lint infrastructure
exists in this repo today.

**Build note (2026-08-01, build-implementer): both steps landed and pass.**
- `server/__tests__/single-writer-guard.test.js` — 5 passing assertions:
  `upsertPlanItem` has exactly one call site (`server/db.js` defines it,
  `server/lib/plan-ingest.js` calls it); no `INSERT INTO plan_items` outside
  `server/db.js`; `appendPlanItem`/`appendSubItem` exist only in
  `server/lib/plan-writeback.js`; each has exactly one call site, both inside
  `applyDisposition`'s own function body; `__testonly` is never referenced by
  production code. This is a pure source-scan test (no DB, no HTTP) and stays
  green as of this build.
- `server/lib/plan-ingest.js` exports `LINE_SPLIT_RE` (`/\r?\n/`, the literal
  regex `parsePlanMarkdown` splits lines on) at
  `server/lib/plan-ingest.js` line ~95, and it is the SAME regex instance used
  by the parser (not a re-typed copy). `server/lib/plan-writeback.js`'s
  `sanitizeLlmPlanText` imports it directly
  (`const { LINE_SPLIT_RE, ... } = require("./plan-ingest")`) and neutralizes
  every boundary it matches, plus a defensive catch-all for a lone `\r` (which
  `\r?\n` cannot match by construction, since it requires a trailing `\n`).
  Asserted by `server/__tests__/plan-writeback.test.js`'s
  `"imports and uses plan-ingest's LINE_SPLIT_RE for boundary neutralization"`
  case.

This row stays PENDING (accepted tradeoff, not a hard lint rule) because
nothing STRUCTURALLY prevents a future contributor from adding a third write
call site — only this test suite catching it on the next `npm run
test:server` run. That residual is the tradeoff decisions.md always intended
to accept; the mitigation itself is built and green.

---

## Verification log — plan re-checked against later commits

### 2026-08-01 — re-verified against commit `3c2db7d`
An unrelated commit (`feat(usage,sidebar): OAuth-based account credentials +
terminal-focus open-terminal`) landed on top of this effort's starting point,
touching two files this plan depends on: `server/db.js` (+61 lines, a new
`accounts` table + migration + prepared statements) and `server/index.js`
(+2 lines, mounting the new accounts router). Re-verified every file:line
citation in `technical-plan.md`, this file, and all `supporting/*.md` /
`qa/**/*.md` docs against the current on-disk code.

**Result: no drift, no conflicts.** All citations remain accurate
(`plan_items`/`plans` schema at `db.js:535-593`, `upsertPlanItem`/
`deletePlanItemsNotIn` at `2142`/`2183`, `alert_events` at `404-421`,
`startPlanPoll` at `index.js:554-599`, the `SessionStart` ingest trigger,
`routes/plans.js`'s refresh route, `focus-inference.js`'s scheduler
pattern, and the legacy `plan_items` migration block cited in
`qa/test-plan.md:92`). The new `accounts` table/route/column introduce no
name collisions with anything this plan adds (`detour_dispositions`,
`decision_queue`, `plan_items.target_date`). The commit's client-side
changes (Usage page, Sidebar) are irrelevant — this plan ships zero client
changes (WATCH-3). **No update to any plan artifact was needed.**

Side note, not a plan defect: that commit's own message states it "captures
portfolio/PM-layer design notes (pm.md)" — this effort's `pm.md` source
document was swept into an unrelated feature commit, most likely by a
concurrent session sharing this repo's working tree (see this project's
`concurrent-session-risk` memory). Recorded here so a later `team-status`
pass isn't confused by `pm.md`'s git history.

---

## Build-time findings — three review rounds, six blockers + two new defects, all resolved

The build went through triage → planner → test-author → implementer →
verifier (BLOCKED twice on vacuous tests, fixed) → reviewer (found B1-B6 +
S1-S3, all fixed) → re-reviewer (found N1/N2, two NEW defects introduced by
the B1-B6 fix round, both fixed) → final re-review (clean, zero blockers).
Full narrative and reproductions live in
`build/2026-08-01-build-project-manager/supporting/red-evidence.md`. Final
suite: 1200/1200 server tests green, 664/664 client tests green (untouched),
file-header audit clean, zero scope creep, zero client changes.

The most load-bearing findings, for anyone auditing this later: **B4**
(the optimistic-lock retry originally could never succeed against a real
ingested plan — fixed, then **N2** showed the fix over-applied and defeated
a caller-supplied `expected_hash`, silently breaking the human-resolve
route's own conflict detection — fixed by gating the fresh-rebaseline
behavior on whether the caller supplied a hash at all); and **N1** (the
`detour_volume` decision-queue kind deduped globally across every project
in the dashboard, not per-project, because its dedup key carried no `cwd`
column — silently swallowing every project's volume alert after the
first one filed — fixed by adding `cwd` to the dedup query).

## WATCH-12 — Accepted low-priority residuals from the final review pass, not chased further

- **Status:** PENDING (accepted, documented rather than fixed)
- **Raised:** 2026-08-01 (build-reviewer, third pass)

Four cosmetic/low-risk items surfaced in the final adversarial review round,
after two full blocker-fix cycles already landed. Judged not worth a fourth
implementer round given diminishing returns and zero live-path impact today:

1. **`findOpenQueueItem`'s `cwd = ?` should be `cwd IS ?`** (`server/db.js`
   ~line 2461), for NULL-safety consistency with the sibling `ref_id IS ?`/
   `item_id IS ?` clauses in the same query. No live path passes a null
   `cwd` today (`plans.cwd` is a PK, `detour_dispositions.cwd` is
   `NOT NULL`), so this is latent, not active. If a future caller ever
   passes a null cwd, this guard silently stops deduping for that call
   instead of throwing — fix opportunistically next time this file is
   touched.
2. **`expected_hash` is an optional field on `POST /api/detours/:id/resolve`**, and omitting it silently routes a human-initiated write onto the unattended fresh-rebaseline path — degrading N2's fix to opt-in by the caller rather than enforced. Not a code bug (graceful degradation is defensible), but `docs/API.md` should note that omitting `expected_hash` waives optimistic-concurrency protection, and any future UI/CLI caller should be written to always send it.
3. **A stale comment premise** in `server/db.js` (~line 2452-2459) claims `pace_alert` carries `ref_id=NULL AND item_id=NULL` — it doesn't; `pace_alert` carries a real `item_id`. The conclusion (cwd scoping is required) is still correct, just for a stronger reason (per-cwd item ids collide across projects) than the comment states.
4. **A redundant `skipCheapPrefilter` flag** on one `attempt(null, true)` call site in `server/lib/plan-writeback.js` (~line 542) — the flag can never change behavior on that specific call since the cheap prefilter is already gated on a non-null `expectedHash`, which this call never has. Cosmetic; a reader could mistakenly assume the flag is load-bearing there.
