# Architect Assessment — Build the Project Manager (Layers 4-6)

Intake: `intake/2026-08-01-build-project-manager/` · Architect pass

Grounded against live code (not pm.md's summary of it) in: `server/db.js`,
`server/lib/focus-report.js`, `server/lib/focus-summary.js`,
`server/lib/focus-inference.js`, `server/lib/session-liveness.js`,
`server/lib/plan-ingest.js`, `server/lib/alerts.js`,
`server/update-scheduler.js`, `server/routes/plans.js`,
`server/routes/projects.js`, and `PROJECT-CONTEXT.md`.

## 1. Affected subsystems & boundaries

- **`server/db.js`** — schema owner. Needs: one new column on `plan_items`
  (target date, layer 5), one new table for durable detour dispositions
  (layer 4), one new table for the reconciliation decision queue (layer 6).
  This file also owns the migration idiom to follow (see §3, Q3).
- **`server/lib/focus-inference.js`** — owns the *only* existing source of
  "detour" data today: the background classifier that writes
  `focus_inferences` rows (`kind: 'item' | 'detour' | 'unclassified'`).
  Layer 4 consumes this table; it must not become a second place that also
  writes classification data (see risk in §4).
- **`server/lib/focus-report.js`** — read-only consumer of `focus_inferences`
  (via `NONE_KIND`/`inferred` segments) and of declared `session_focus`
  detour stacks. Layer 6's "recent detours" queries should reuse or mirror
  this file's existing session/segment traversal rather than re-deriving it
  a third way.
- **`server/lib/focus-summary.js`** — the hierarchical LLM-synthesis and
  hermetic-spawn precedent layer 6's LLM-judgment half should reuse
  verbatim (`runClaudePromptJson`, exported from `focus-inference.js`).
- **`server/lib/session-liveness.js`** — the fail-safe hard-rule precedent
  layer 6's rule half should match in spirit: "whenever the probe cannot
  produce a trustworthy answer it reports `available: false` ... the caller
  must change nothing" (file header, verbatim).
- **`server/lib/plan-ingest.js`** + **`server/routes/plans.js`** — owns the
  contract that `AGENT-PLAN.md` is "the human-owned source of truth; the
  dashboard only mirrors it" for plan *content* (text/acceptance/detail),
  while a small set of fields (`declared_done_at`, `declared_done_session`)
  are deliberately excluded from the file-driven upsert and live purely in
  the DB, mutated out-of-band. This split matters directly for Q3.
- **`server/lib/alerts.js`** (`alert_rules`/`alert_events`) — the closest
  existing precedent for "a queue of flagged items awaiting human
  acknowledgment," including the audit-trail convention (no cascading FK on
  `session_id`, so history outlives session cleanup) layer 6's decision
  queue should copy.
- **`server/update-scheduler.js`** and `focus-inference.js`'s
  `startFocusInference()` — the two existing in-process periodic-scheduler
  implementations, both wired from `server/index.js` at boot. This is the
  real precedent for layer 6's "process mechanism" question (see Q4) —
  **not** an external `/loop` mechanism, which does not exist anywhere in
  this repo (grepped `.claude/`, `server/`, `scripts/`; no match).
- **New code, net-new subsystem**: a reconciliation module (e.g.
  `server/lib/reconciliation.js`) plus new route(s) exposing the decision
  queue and target-date authoring. No client changes are in scope (layer 7
  deferred), but the new server-side computations must be written as a
  single shared function from day one so a future UI consumer doesn't
  reintroduce 9.1 DERIVED-DUAL-VIEW (see §4).

## 2. Current design (as it actually exists today)

**Detours today are an observation, not a decision.** `focus-inference.js`
runs a background classifier (`startFocusInference()`, boot delay + unref'd
`setInterval`, `TICK_MS` default, `running` overlap guard, serial per row,
`MAX_SESSIONS_PER_TICK` cap) over sessions with **no declared** Focus
history. For each, `heuristicClassify`/`llmClassify` produce one of:
`kind: 'item'` (matched a plan item), `kind: 'detour'` (`item_id: null`,
a 2-5 word LLM-given `label`, e.g. "detour_title" in the prompt at
`focus-inference.js:237`), or `kind: 'unclassified'`. This is written via
`upsertFocusInference` to `focus_inferences` (PK `session_id`) —
**re-inferred and overwritten** whenever a session gains new activity after
its last `inferred_at` (`listCandidates`, `focus-inference.js:449-470`).
Nothing today reads this table and decides what to *do* with a `'detour'`
row — it just surfaces as a report line (`focus-report.js`'s `NONE_KIND`
segment, `inferred: true`, carrying `reason`).

Note a real naming trap: `focus_inferences.kind = 'detour'` (inferred,
undeclared) is a different thing from `session_focus.detour_stack`
(**declared** via `ccam focus push --kind detour`, layer 3, already built).
Layer 4 operates on the former only — worth stating explicitly in any
build-phase doc so "detour" isn't ambiguous across the two tables.

**Plan items already have one field that survives re-ingest by design.**
`plan_items` (`db.js:571-586`) is upserted from the file on every ingest
(`upsertPlanItem`, `db.js:2142-2153`) — `text/acceptance/detail/checked/
position/item_number/parent_item_id` are all overwritten from the file
every time, but `declared_done_at`/`declared_done_session` are **excluded**
from that `SET` list on purpose (comment at `db.js:2137-2141`: "conflict
target is item_id ... so declared_done_at (deliberately untouched below)
survives"). Those two columns are instead written by
`server/lib/focus-commands.js:365` (`setPlanItemDeclaredDone`, driven by
`ccam focus done N`), fully out-of-band from the markdown file. This is the
single most relevant precedent for Q3.

**Migrations use two idioms**, chosen by risk: additive
(`ALTER TABLE x ADD COLUMN`, dozens of examples — `sessions.pid`,
`agents.workflow_run_id`, `usage_captures.account_id`, etc.) for a new
nullable/defaulted field, versus the full rename-copy-drop dance (only used
twice for `plan_items`, and for `token_usage`/`webhook_targets`/`agents`)
reserved for constraint changes SQLite can't `ALTER` directly (dropping
`NOT NULL`, changing a PK). A new `target_date` column is squarely in the
first, low-risk category.

**Two proven in-process scheduler shapes already exist**, both wired from
`server/index.js`: `startUpdateScheduler()` (`server/update-scheduler.js`,
boot `setTimeout` + unref'd `setInterval`, fingerprint-gated no-op skip,
env-disable, configurable interval) and `startFocusInference()`
(`server/lib/focus-inference.js:537-574`, same shape plus an overlap guard
and a per-tick row cap). `server/lib/alerts.js` adds a third, slightly
different variant: a module-scope `setInterval(sweepTimeRules,
SWEEP_INTERVAL_MS)` that starts at `require()` time rather than from an
explicit `start...()` call from `index.js`. All three run *inside* the
existing long-lived dashboard server process — none of them are, or use, an
external "loop" agent.

**Domain pattern check (`PROJECT-CONTEXT.md`)**: both of this project's two
named recurring-defect classes are live risks here, exactly as the brief
already flags:
- **9.1 DERIVED-DUAL-VIEW** — no violation exists yet (no UI consumes any
  layer-6 output), but the computation (pace status, disposition, queue
  entries) must be written once, as a function/module the eventual layer-7
  UI and any CLI/API path both call — not inlined per-consumer later.
- **9.2 row-id-as-chronology-proxy** — any "how many detours in the last N
  days" or "recent sessions" query layer 6 runs must sort by `created_at`
  (id as tiebreak), matching the convention already used in
  `listEvents`/`getEventsBySessionSince` and fixed 3 times already in
  adjacent focus-inference-family code per `PROJECT-CONTEXT.md` §9.2.

## 3. Options for the four open design questions

### Q1 — Detour entity representation

- **Option A (recommended): new `detour_dispositions` table.** One row per
  disposition decision, referencing the `focus_inferences` row it was made
  from (by `session_id` + a stored snapshot of `inferred_at`/a content
  digest — see §4 risk), holding `disposition` (`fold_in | new_item |
  deliberate_deviation | discard`), `status` (`proposed | resolved`),
  `resolved_at`, `linked_plan_item_id` (set when `fold_in`/`new_item`
  creates or attaches to a plan item), and free-text `note`. No cascading FK
  on `session_id` (mirrors `alert_events`'s "audit trail must outlive
  session cleanup" rationale) so a disposition survives session deletion.
- **Option B: extend `focus_inferences` in place** with disposition
  columns. Fewer tables, but conflates two different owners on one row: the
  classifier re-derives and **overwrites** `kind`/`label`/`confidence`
  whenever a session's activity changes after `inferred_at`
  (`listCandidates`'s re-classify trigger) — bolting a "decision" onto that
  same row means every future re-classification risks silently clobbering
  an already-made human/reconciliation decision unless the upsert is
  carefully changed to protect the new columns, the same discipline
  `plan_items` already needs a code comment to enforce for
  `declared_done_at`. That's a second place to remember the same lesson.
- **Option C: fully recomputed on read, no persistence** — rejected by the
  brief's own reasoning and by the PO's stated acceptance bar ("re-running
  the reconciliation pass on already-dispositioned time does not silently
  re-flag or duplicate a decision already made"); also re-spends LLM cost
  on every read.

**Recommendation: A.** It cleanly separates "observation" (`focus_inferences`,
classifier-owned, re-derivable) from "decision" (a new table,
reconciliation-owned, durable, independently queryable) — the same
separation this codebase already draws between `focus_inferences` (machine
guess) and `session_focus` (declared ground truth) never being mixed at
report time.

### Q2 — Reconciliation output / escalation ("decision queue") format

- **Option A (recommended): new `decision_queue` table**, modeled directly
  on `alert_rules`/`alert_events` (`db.js:390-419`): `type` (`pace_breach |
  detour_volume | detour_needs_call`), `project_id`/`cwd`, a subject
  reference (`plan_item_id` or a detour reference), a plain-language
  `message`, a `details` JSON blob (target date, actual, ratio, the LLM's
  proposed disposition + confidence when applicable), `status`
  (`pending | resolved | dismissed`), `created_at`, `resolved_at`. Same "no
  FK cascade, audit trail outlives the thing it's about" rule as
  `alert_events`.
- **Option B: reuse `alert_events` itself**, adding new `rule_type` values.
  Rejected: `alert_rules`/`alert_events` is a user-configurable,
  event-triggered (`evaluateEvent`) or time-swept (`sweepTimeRules`)
  ops-alerting feature with its own `rule_type` `CHECK` constraint and its
  own audience (session-level ops alerts). Widening that `CHECK` and mixing
  portfolio-decision rows into the same table couples two features with
  different trust boundaries and blast radii for no structural benefit —
  the tables are *shaped* alike, which is exactly why copying the shape
  (Option A) rather than the table gets the reuse benefit without the
  coupling cost.
- **Option C: compute-on-request only, no persistence** — rejected: breaks
  "resolve/log everything else quietly," gives no stable list an eventual
  `ccam` command or layer-7 UI can page/acknowledge/diff over time, and
  re-runs LLM classification on every request.

**Recommendation: A.** New, purpose-built, small table — enough for a
CLI/API check now (per the brief's own steer to not over-build for the
deferred layer-7 UI), while leaving room for layer 7 to render it later
with zero schema change (the same relationship `alert_events` already has
to the existing Alerts UI).

### Q3 — Target-date field shape and authorship

Confirmed additive-migration precedent (§2) makes *where it lives* an easy
call: a nullable column on `plan_items` (`target_date` or `target_at`),
added via a plain `ALTER TABLE plan_items ADD COLUMN`, no rename-dance
needed — a separate table is not warranted (no evidence of needing history
of target-date changes, and one target per item matches `declared_done_at`'s
own one-value-per-item shape).

The real fork is *how it's authored*, and this is where I differ slightly
from treating the brief's assumption as fully settled:

- **Option A: file-authored**, parsed from `AGENT-PLAN.md` (e.g. a `target:
  2026-08-05` line next to `acceptance:`), by extending
  `plan-ingest.js`'s parser. Consistent with "the file is the human-owned
  source of truth for plan content" — but a target date is a
  scheduling/management attribute, not "what are we building" stakeholder
  content, and `plan-ingest.js`'s upsert **overwrites** `text/acceptance/
  detail` from the file on *every* ingest — so a target date living there
  would be silently reset/nulled by any edit or reformat of the file,
  unlike `declared_done_at`'s protected-from-upsert model. It also means
  touching a parser this file's own header describes as "deliberately
  tolerant" with hand-tuned safety caps (`MAX_ITEMS`, `MAX_TEXT_LEN`, etc.)
  for a feature that doesn't need parser changes at all.
- **Option B (recommended): out-of-band, CLI/API-set**, mirroring
  `declared_done_at` exactly — excluded from `upsertPlanItem`'s `SET` list
  (so it survives re-ingest untouched, exactly like `declared_done_at`
  today), written via a new small route (e.g. `PATCH
  /api/plans/:cwd/items/:number/target`) and/or a new `ccam` command (e.g.
  `ccam plan target set <n> <date>`), same shape as the existing
  `setPlanItemDeclaredDone` statement and `ccam focus done` command.

**Recommendation: B.** It requires zero changes to the already
carefully-tuned ingest parser, and — more importantly — a target date is
dashboard/runtime state layered onto human plan content (a layer-5/6
concern), not plan content itself; keeping it out of the markdown file also
keeps that file at the plain-language altitude layers 1-2 are meant to
stay at. This is the literal reading of the brief's own steer ("matches
existing `declared_done_at` precedent on the same table"), not just "same
table, any authoring path."

### Q4 — Process mechanism for the periodic reconciliation pass

pm.md names two unresolved candidates: "the existing `/loop` mechanism" or
"a scheduled cron agent." **I could not find an in-repo `/loop` mechanism**
— it is not a file, script, skill, or command anywhere in this repo. It most
likely refers to Claude Code's own external agentic-loop capability
(re-running a `claude` CLI session repeatedly outside this codebase's
process), not something this repo owns or can extend in place. That
reframes the real choice as: reuse this repo's own proven in-process
scheduler pattern, or stand up a new external-process mechanism.

- **Option A (recommended): new in-process scheduler**, e.g.
  `server/lib/reconciliation.js` exporting `startReconciliation()`, wired
  from `server/index.js` next to `startFocusInference()`/
  `startUpdateScheduler()`. Same shape: boot-delay `setTimeout`, unref'd
  `setInterval`, a `running` overlap guard, serial per-project tick, a
  per-tick cap, env mode/interval knobs (e.g.
  `DASHBOARD_RECONCILE_MODE`/`DASHBOARD_RECONCILE_MS`) following the exact
  naming convention `DASHBOARD_FOCUS_INFER_MODE`/`_MS` already established.
- **Option B: external Claude Code agent loop** (pm.md's likely intent for
  "`/loop`") — one long-lived external process per tracked project doing
  its own periodic reconciliation. Con: an entirely new class of
  operational component (N extra long-lived processes, their own
  crash/restart/logging story) sitting outside the dashboard server's
  existing process lifecycle, env-config, and broadcast plumbing; a far
  larger LLM footprint (persistent agent loop vs. one hermetic `claude -p`
  spawn per flagged item, matching `runClaudePromptJson`'s existing
  contract); and it duplicates scheduling/fail-safe infrastructure the
  dashboard already owns instead of reusing it.
- **Option C: OS-level cron/launchd** invoking a one-shot `ccam reconcile`
  CLI per tick. Decouples from the dashboard server's own lifecycle
  (works even while the dashboard is stopped — arguably a plus), but this
  project already centralizes exactly this class of periodic/liveness logic
  (session-liveness's reaper, focus-inference's classifier) *inside* the
  running server process; a second, independent process touching the same
  SQLite DB introduces a new WAL-contention/locking surface and a second
  path to reach (or fail to reach) the server's in-memory WebSocket
  broadcast for any live signal — the same "two paths, one truth" shape
  9.1 DERIVED-DUAL-VIEW warns against, just at the process level instead of
  the render level.

**Recommendation: A.** Lowest-risk, most idiomatic, reuses
`runClaudePromptJson`'s hermetic per-item spawn contract for the
LLM-judgment half (not a persistent agent loop), and keeps the tick
serial/overlap-guarded exactly like `focus-inference.js`'s proven pattern.

## 4. Architectural risks

- **Hybrid-escalation inversion is the highest-leverage risk.** The
  confirmed design ("rules decide *whether*, LLM decides *what*") must be
  enforced structurally, not just by convention: a rule-evaluation function
  with **zero** LLM calls (pace-vs-target, detour-volume ratio) must run
  first and completely decide the escalation set; only items it flags may
  ever reach the LLM-classification function. Recommend these live in two
  separate, independently unit-testable functions/files from the start, and
  a test that stubs the LLM path entirely and asserts rule-based escalation
  decisions are unaffected (already named by the PO as AC #7) — a single
  combined "ask the LLM to decide everything" shortcut would be a quiet,
  easy-to-introduce violation of an explicitly confirmed decision.
- **Disposition durability vs. classifier re-inference.** `focus_inferences`
  rows are overwritten whenever a session gains new activity after
  `inferred_at` (a session can go quiet, get classified, then resume and
  re-classify). Whatever detour entity is chosen (Q1) must be able to tell
  "the underlying inference changed since I last decided" — e.g. by storing
  the `inferred_at`/digest it was made from — so the reconciliation pass
  re-flags a genuinely-changed detour instead of either (a) silently
  treating stale data as still resolved, or (b) re-flagging every already-
  resolved detour on every tick regardless of whether anything changed.
- **Fail-safe must be structural, not a single top-level try/catch.**
  Mirroring `session-liveness.js`'s own stated contract, each stage (rule
  evaluation, LLM classification, persistence) must independently no-op on
  failure and leave prior state untouched — a partial failure (rules ran,
  write failed) must never leave `decision_queue` and the detour-disposition
  table inconsistent with each other or with `focus_inferences`.
- **9.2 row-id-as-chronology-proxy** — any "detours/sessions in the last N
  days" query for the detour-volume ratio or recency checks must `ORDER BY
  created_at` (id as tiebreak), per this project's own 3-times-fixed
  history in adjacent code.
- **9.1 DERIVED-DUAL-VIEW** — write pace-status/disposition computation as
  one shared function even before any second consumer exists, so the
  eventual layer-7 UI (or a `ccam` command added later) calls the same
  function the reconciliation pass does rather than re-deriving it.
- **Target-date format/timezone.** `declared_done_at` is a full ISO-8601
  UTC timestamp; a human-set "target date" is more naturally a plain
  calendar day ("by Friday"), not a UTC instant — needs an explicit
  `YYYY-MM-DD` (date-only, local-calendar-day) decision to avoid off-by-one
  pace comparisons across timezones. This is a concrete choice the
  engineering stage needs handed to it, not left implicit.
- **LLM cost/latency fan-out.** The LLM-judgment half runs once per flagged
  detour per project per tick, across up to 8-10 concurrently tracked
  projects — needs a per-tick cap analogous to `MAX_SESSIONS_PER_TICK`, and
  should honor the same `DASHBOARD_FOCUS_INFER_MODE=off`-style kill switch
  already established for `focus-inference.js`/`focus-summary.js`, ideally
  the *same* env var rather than a fourth differently-named toggle, so
  disabling "the LLM path" disables it everywhere consistently.
- **New route/CLI input validation and trust boundary.** New
  target-date-set and decision-queue-ack endpoints need structured
  validation/errors per this repo's backend rules; confirm no new exposure
  through `remote_sources`/`webhook_targets` (which already exist for other
  data) crosses this dashboard's local-only trust boundary without an
  explicit decision to do so.

**Scope boundaries disclosed here that must not remain prose-only** — each
of these needs an explicit `decisions.md` PENDING/WATCH row for this
intake (this project already has the convention, e.g.
`intake/2026-07-26-focus-calendar-board/decisions.md`), not just a mention
in this file:

1. **Layer 7 (portfolio rollup UI)** stays out of scope this round —
   needs a WATCH row so no opportunistic "just add a decision-queue badge
   while we're in here" creep happens during layer 4-6 build (already
   flagged once by the PO; it needs the durable row, not a second mention).
2. **Target-date *inference*** (auto-estimating dates instead of manual
   authorship) is explicitly deferred — needs a PENDING row so it isn't
   silently expected to "just work" later without ever being scheduled.
3. **Cross-plan lifecycle reconciliation** (a plan going on hold/superseded/
   archived — named in the `holistic-focus-history` memory as a related,
   separate open thread) is NOT modeled by this reconciliation pass: layer
   6 only reasons about item-level pace and detour disposition, not plan
   lifecycle state. At minimum the reconciliation tick must skip an
   archived/missing plan gracefully (fail-safe, not a false pace alarm on a
   dead plan) — needs its own WATCH row rather than only this paragraph.
4. **Memory-sync obligation** (`portfolio-reconciliation-vision`,
   `holistic-focus-history`) — already named by the PO; once any of the Q1-Q4
   recommendations above are accepted, both memory entries become stale on
   the spot (they currently describe layers 4-6 as undesigned). This is a
   process/close-out item, not an architecture decision, but it should ride
   in the same decisions.md so it isn't lost between this file and delivery.

## 5. Recommended approach (summary)

- **Q1 (detour entity):** new `detour_dispositions` table — decision-owned,
  durable, separate from the classifier's re-derivable `focus_inferences`.
- **Q2 (decision-queue format):** new `decision_queue` table, shaped like
  (but not reusing) `alert_rules`/`alert_events` — same audit-trail
  conventions, different table, different audience/trust boundary.
- **Q3 (target-date field):** `plan_items.target_date`, added via a plain
  additive `ALTER TABLE ADD COLUMN` (date-only, e.g. `YYYY-MM-DD`),
  authored out-of-band via a new route/CLI command excluded from
  `upsertPlanItem`'s overwrite set — mirroring `declared_done_at` literally,
  not just "a column on the same table."
- **Q4 (process mechanism):** a new in-process scheduler
  (`server/lib/reconciliation.js` + `startReconciliation()`, wired from
  `server/index.js`) reusing the exact `startFocusInference()`/
  `startUpdateScheduler()` shape — not an external `/loop` or cron process
  (no in-repo `/loop` mechanism exists to extend).
- **Across all four:** rule-evaluation and LLM-judgment must be
  structurally separate functions so the confirmed hybrid-escalation split
  is enforceable and independently testable, and every new periodic/LLM
  code path must be fail-safe (no trustworthy read → change nothing) by
  the same discipline `session-liveness.js` already established.

---

## REVISION (2026-08-01) — Layer 4 real write-back, per DEC-2

Sara overruled the advisory-only recommendation above via `decisions.md`
DEC-2: **real write-back is required.** `fold_in`/`new_item` dispositions
must actually create content in `AGENT-PLAN.md` (and, via the existing
ingest path, `plan_items`). This section is a redesign of Q1's write path
only — Q1's table shape (`detour_dispositions`), Q2 (`decision_queue`), Q3
(`target_date` out-of-band), and Q4 (in-process scheduler) all stand
unchanged. Grounded fresh against the live code: `server/lib/plan-ingest.js`
(full file), `server/db.js:535-593` (schema) and `:2116-2188` (statements),
`server/routes/plans.js`, `server/routes/hooks.js:1185-1197`,
`server/index.js:554-599` (`startPlanPoll`), and the closest in-repo
precedent for mutating a human-owned text file, `server/lib/cc-mutate.js`.

### What actually triggers ingest today (confirmed by reading the code)

Three call sites, all converging on `ingestPlanForCwd`, all fail-safe:
1. **`server/routes/hooks.js:1188-1197`** — `SessionStart` hook, opportunistic,
   fires once per session open.
2. **`server/index.js`'s `startPlanPoll`** (default `DASHBOARD_PLAN_POLL_MS=10000`)
   — mtime-fingerprinted per cwd via a local `lastSeen` Map; on a fingerprint
   miss it re-runs `ingestPlanForCwd`, which then does its own independent
   `content_hash` compare against `plans.content_hash` before touching any row.
3. **`POST /api/plans/refresh`** (`server/routes/plans.js:64-79`) — manual,
   CLI/tests.

Two independent short-circuits already exist and matter for the redesign:
`startPlanPoll`'s mtime Map (skip the whole ingest call) and
`ingestPlanForCwd`'s own sha1 `content_hash` compare (skip the DB write even
if ingest runs). `deletePlanItemsNotIn` (`db.js:2183-2185`,
`DELETE FROM plan_items WHERE cwd = ? AND item_id NOT IN (...)`) only runs
*inside* the transaction that follows a hash mismatch — so anything that
never changes the file's bytes never reaches it, and anything that changes
the file's bytes in a way that keeps an item's `id:` line intact is a normal
upsert, not a deletion, regardless of who edited the file.

That last fact is the whole design: **item identity in this system is the
`id:` line, not authorship.** If the dashboard's write produces a real,
well-formed entry in the file with a synthesized `id:` line, ingest cannot
tell it apart from a line a human typed — which is exactly the "survives
re-ingest as if a human had typed it" bar DEC-2 sets. No new "dashboard-owned
row" concept, no ingest awareness of provenance, is needed at all.

### Recommended approach: write the real file, then re-run the real ingest

New module **`server/lib/plan-writeback.js`**:

- `appendPlanItem(dbModule, { cwd, text, acceptance, detail, expectedHash })`
  — new top-level item, appended at end of file.
- `appendSubItem(dbModule, { cwd, parentItemId, text, acceptance, detail, expectedHash })`
  — new sub-item (`fold_in` under an existing item), inserted immediately
  after the parent's own block (its checkbox line plus any of its existing
  continuation/sub-item lines) so `SUBITEM_RE`'s "parent must already be seen"
  parse precondition trivially holds regardless of where in the file the
  parent sits.

Mechanism, concretely:

1. **Per-cwd in-process mutex** (a `Map<cwd, Promise>` chain inside
   `plan-writeback.js`) serializes concurrent dashboard-initiated writes to
   the same cwd — needed because two disposition applications racing in the
   same reconciliation tick (or a tick racing a manual API call) would
   otherwise both read the same "before" bytes and only one write would
   actually be reflected.
2. **Read the file fresh** (`fs.readFileSync`, not the DB's cached
   `content_hash`) and hash it (`hashBefore`). If the caller passed an
   `expectedHash` (e.g. what the UI/CLI last displayed) and it doesn't match,
   fail fast with `CONFLICT` — cheap optimism check before doing any parsing
   or composition work.
3. **Reuse `parsePlanMarkdown`** (already pure, already the one place this
   codebase understands `AGENT-PLAN.md` syntax) to find the current max
   top-level number, the full current id set (collision check), and the
   parent's current block boundaries for `appendSubItem`. `plan-ingest.js`
   needs two small additive exports for this — the existing `ITEM_RE`/
   `SUBITEM_RE` regexes (or a new pure helper, e.g. `findItemLineRange`) and
   the safety caps (`MAX_ITEMS`, `MAX_TEXT_LEN`, `MAX_ACCEPTANCE_LEN`,
   `MAX_DETAIL_LEN`) it already defines. **`plan-writeback.js` must never
   hand-roll a second regex pass over the file** — that would be the same
   duplicated-understanding shape this project's own `§9.1
   DERIVED-DUAL-VIEW` pattern warns about, just moved from the render layer
   to the parse layer. `plan-ingest.js` stays the only owner of "what this
   file's syntax means"; `plan-writeback.js` only owns "how to safely mutate
   bytes on disk."
4. **Mint a new `id:`** via `crypto.randomBytes(4).toString("hex")` (not
   `fallbackItemId`'s deterministic cwd+number hash — that scheme is for
   *inferring* an id for pre-existing unlabeled items, and reusing it here
   for brand-new items risks a real collision against a fallback-id future
   ingest would independently derive for some other unnumbered item).
   Regenerate on collision against the freshly parsed id set (effectively
   never happens, checked anyway).
5. **Sanitize `text`/`acceptance`/`detail` before composing markdown** — see
   the new risk below; this step did not exist in the advisory-only design
   because a paste-ready snippet shown in the UI carries no ambient parser
   trust, and a string auto-written into the real file does.
6. **Immediately before writing, re-read and re-hash the file and compare to
   `hashBefore`.** If it changed, a human's concurrent edit landed in the
   window between step 2 and now — abort with `CONFLICT` (return the new
   hash so the caller can recompose against current content) rather than
   clobbering it. This is the actual optimistic lock; step 2's check is only
   a cheap pre-filter.
7. **Atomic write**: temp file in the same directory, `fsync`, `renameSync`
   over the real path — extract the existing `atomicWriteFile` out of
   `server/lib/cc-mutate.js` into a small shared `server/lib/atomic-file.js`
   and have both modules import it, rather than hand-copying the
   temp+fsync+rename primitive a second time. This guarantees the poller,
   the `SessionStart` hook, and any human-side file watcher/editor always see
   either the fully-old or fully-new file, never a torn write.
8. **Timestamped backup before the mutation**, mirroring `cc-mutate.js`'s
   "always back up before mutating a human-owned file" rule — land it
   outside the cwd root's normal view (e.g.
   `<cwd>/.claude/agent-plan-backups/AGENT-PLAN.<timestamp>.bak.md`) so it
   can't be mistaken for a second live plan and plan-ingest's fixed
   `PLAN_FILENAME` lookup never touches it.
9. **After a successful rename, call the real `ingestPlanForCwd(dbModule, cwd)`
   in-process** — the write-back module never calls `upsertPlanItem`/
   `upsertPlan` directly. This is what keeps there being exactly one writer
   of `plan_items`: ingest. The route/reconciliation code that invoked
   `appendPlanItem`/`appendSubItem` gets back ingest's normal `{ changed,
   plan, items }` shape and owns the `broadcast("plan_updated", ...)` call,
   per the contract `plan-ingest.js`'s own header already states ("the
   CALLER owns broadcasting") — no new broadcast contract needed.
10. Release the per-cwd mutex in a `finally`.

Because the file is genuinely the only thing mutated (the DB is only ever
updated by re-running the same ingest every other trigger uses),
**requirement 3 in the task is already satisfied by construction**: I
grepped for an existing "plan changed externally" signal
(`plan_updated` consumers in `client/src`, `rule_type` values in
`server/lib/alerts.js`) and found none — there is no drift/alert mechanism
today that a dashboard-triggered `content_hash` change could falsely trip.
The only existing short-circuit is `ingestPlanForCwd`'s own hash-match
no-op, which correctly and harmlessly no-ops on the *next* poll tick once
our own re-ingest in step 9 has already updated `plans.content_hash` —
exactly the same redundant-but-cheap double-check that already happens
today between a `SessionStart`-triggered ingest and the next poll tick.

### Alternatives considered and rejected

- **DB-only write + teach `deletePlanItemsNotIn` to spare "dashboard-owned"
  rows** (e.g. a new `plan_items.origin` column, delete only
  `origin='file'` rows not present in the file). Rejected: it never
  actually writes `AGENT-PLAN.md`, which is the literal thing DEC-2 asks
  for once read together with its own concurrency framing; it makes a
  dashboard-created item invisible to a human reading the file, which
  breaks this repo's stated design that the file is the plain-language,
  stakeholder-visible plan; and it reintroduces the DERIVED-DUAL-VIEW shape
  one layer down — `plan_items` would gain two owners with two different
  lifecycle rules that every future ingest change has to remember, forever.
  It also does nothing for requirement 2 (a human editing the file
  concurrently isn't protected at all by an `origin` column).
- **External advisory lockfile** (e.g. `proper-lockfile`) held across the
  read-modify-write. Rejected: it only protects cooperating writers — a
  human's text editor has no knowledge of the lock and will overwrite the
  file mid-hold regardless, so it doesn't actually close the
  human-vs-dashboard gap (the one that matters most here); it only closes
  the dashboard-vs-dashboard gap, which the much cheaper in-process per-cwd
  mutex already covers with no new dependency and no stale-lock-on-crash
  failure mode to manage.

### New risks introduced by real write-back (why this is now L, not M)

- **Markdown/continuation-line injection is a genuinely new trust-boundary
  risk that advisory-only never had.** `fold_in`/`new_item` content can
  originate from the LLM-judgment half of layer 4 (confirmed hybrid-escalation
  design in the original architect pass). If `text`/`acceptance`/`detail`
  is written into the file without stripping embedded newlines and
  lines matching `ID_LINE_RE`/`ACCEPTANCE_LINE_RE`/`DETAIL_LINE_RE`, an
  LLM-influenced string could forge a fake `id:`/`acceptance:`/`detail:`
  continuation line the very next time this same file is parsed —
  effectively letting model output inject structure into a human-owned
  file, not just prose into a field. A paste-ready snippet shown in a UI
  (the original advisory design) had no such consequence; a string written
  directly into the parsed file does. Mitigation is mandatory, not
  optional: reject/strip embedded newlines and re-derive the same
  `MAX_TEXT_LEN`/`MAX_ACCEPTANCE_LEN`/`MAX_DETAIL_LEN` caps `plan-ingest.js`
  already enforces (exported, not copy-pasted) before composing the block.
- **Residual TOCTOU window.** Step 6's re-hash-then-rename is the strongest
  check achievable without an OS-level lock a foreign editor process would
  also have to honor (which doesn't exist for this file). The gap between
  the re-check read and the rename is real, just very small relative to
  interactive human editing cadence. This should be stated as an accepted,
  documented residual risk in the technical plan, not silently assumed away.
- **`MAX_ITEMS`/byte caps must be pre-flighted by the writer, not just the
  reader.** If a write-back append pushes the file past `MAX_ITEMS` or
  `MAX_FILE_BYTES`, `parsePlanMarkdown` would silently drop the new item (or
  the whole ingest would skip via the size guard) on the very next read —
  directly violating "the write survives the next ingest cycle." The writer
  must check the same caps *before* writing and fail loudly (e.g. a 409/422
  from the API) rather than writing something ingest will then quietly
  undo the visibility of.
- **Backup accumulation has no retention policy yet.** Every successful
  write leaves a timestamped backup; at disposition-write frequency (per
  detour, per project, per reconciliation tick over time) this grows
  unbounded unless capped (e.g. keep last N per cwd, mirroring the general
  shape `cc-mutate.js` already has for its own backups, though that module
  currently has no visible pruning either — worth confirming during
  implementation rather than assuming it's already bounded).
- **New file/module surface, testing cost.** This needs its own test file
  (e.g. `server/__tests__/plan-writeback.test.js`) exercising: happy-path
  append survives a subsequent `ingestPlanForCwd`; a simulated concurrent
  human edit between read and write produces `CONFLICT` and does not
  clobber the human's content; two racing write-back calls for the same cwd
  serialize correctly via the mutex; injection-shaped `text` is neutralized;
  `MAX_ITEMS`/byte-cap pre-flight rejects rather than silently truncating.
  This test surface, plus the extraction of `atomic-file.js`, plus the two
  new `plan-ingest.js` exports, is the concrete shape of the M→L jump DEC-2
  already flagged.
- **No schema change required for the mechanism itself** — worth stating as
  a contained positive: this redesign is pure file-I/O plus reuse of the
  existing ingest path, so it does not touch `db.js`'s migration surface at
  all. The schema-level pieces from the original Q1-Q4 pass
  (`detour_dispositions`, `decision_queue`, `plan_items.target_date`) are
  unaffected and still stand as designed above.

### Scope boundaries this revision deliberately does NOT resolve

Two things surfaced during this redesign that must **not** live as prose
only — each needs its own `decisions.md` PENDING/WATCH row before the
technical plan is finalized, the same way the original pass's four
scope-boundary items did:

1. **Creating a brand-new `AGENT-PLAN.md` for a cwd that has none.** This
   design requires an existing plan file to append into; a cwd with no plan
   file gets a hard error from `appendPlanItem`/`appendSubItem`, never a
   synthesized fresh file. That's a deliberate, larger-blast-radius decision
   (authoring a plan from scratch on a human's behalf) that this revision
   does not make and should not make implicitly by omission.
2. **When in the disposition lifecycle the file write actually fires** —
   the instant a `fold_in`/`new_item` disposition is decided (possibly by
   the LLM half, unattended), or only once a human confirms/resolves it via
   `ccam`/API (`detour_dispositions.status: proposed → resolved`). This
   redesign specifies the write *mechanism* only; it does not pick the
   trigger point, and given DEC-2's own emphasis on this being the
   highest-stakes item in the intake, an unattended LLM-triggered file write
   is a materially different risk posture than a human-confirmed one. This
   needs its own DEC row, not a default assumption baked in during
   engineering.

### Recommended approach (summary of this revision)

Write the real `AGENT-PLAN.md` bytes atomically (temp+fsync+rename, backed
up first), guarded by an in-process per-cwd mutex plus a
read-hash-immediately-before-rename optimistic check against concurrent
human edits, then re-run the exact same `ingestPlanForCwd` every other
trigger already uses so `plan_items`/`plans` gain exactly one writer. Reuse
`plan-ingest.js`'s parser/regexes/caps rather than re-deriving file
structure a second time, and extract `cc-mutate.js`'s atomic-write primitive
into a shared helper rather than hand-copying it. This keeps the "the file
is the single source of truth, the dashboard mirrors it" invariant fully
intact even under real write-back — the dashboard's write becomes, by
construction, indistinguishable from a human's edit to every downstream
consumer.
