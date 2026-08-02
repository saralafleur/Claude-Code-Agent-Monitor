# Engineer Findings — Layers 4–6 (detour disposition / pace / reconciliation)

Grounded against the actual code as of this intake (2026-08-01), not pm.md's
paraphrase. Line numbers cited where useful but treat them as
approximate — re-grep before editing.

## 0. The one finding that should reframe the whole build

`server/lib/plan-ingest.js` states twice, in its own header and inline
comments, that `AGENT-PLAN.md` is the **human-owned source of truth** and
"the dashboard never writes it." I confirmed there is no write-back path
anywhere in the repo (`grep -rn writeFileSync server/lib` turns up nothing
touching `AGENT-PLAN.md`). `plan_items` is a **read-only mirror**, rebuilt
from the file on every ingest (`ingestPlanForCwd`), and `deletePlanItemsNotIn`
(`server/db.js` ~L2183) actively deletes any DB row not present in the file.

This directly collides with two of layer 4's four dispositions:
- **"fold into plan as a new milestone"** and **"spin into a new plan
  item"** both mean *adding a plan item*. Today that is only possible by a
  human hand-editing `AGENT-PLAN.md` — writing a new item straight to
  `plan_items` would be silently reverted (or duplicated) on the very next
  poll/SessionStart ingest, since the file re-asserts itself as ground truth.
- **"log as a deliberate accepted deviation"** and **"discard as noise"**
  have no such conflict — they're pure metadata about a detour, not a change
  to the plan's own content, so they fit cleanly into a new DB-only table.

**This is a feasibility fork the architect needs to resolve explicitly**,
not an implementation detail:
- (a) Layer 4 only *records* the disposition + (for fold/new-item) a
  suggested markdown snippet, and a human pastes it into `AGENT-PLAN.md`
  (keeps the existing "file is truth" invariant untouched, but means
  "resolve, don't just observe" is only half-automatic for those two
  dispositions); or
- (b) the dashboard gains a **new** write-back capability for `AGENT-PLAN.md`
  (a real scope expansion beyond "layers 4-6 build on existing machinery" —
  it also needs conflict handling with concurrent human edits, since
  `ingestPlanForCwd` is fully content-hash/mtime driven and has no concept of
  "the dashboard's own edit" vs "a human's edit").

I did not find any prior art for (b) in this codebase; (a) is much closer to
"minimal, reversible" per CLAUDE.md's engineering rules.

## Layer 4 — Detour/discovery disposition

### Exact change set

- **New table** (in `server/db.js`, alongside the `plan_items`/`focus_inferences`
  block, ~L620-640): something like `detour_dispositions`. Suggested shape:
  ```sql
  CREATE TABLE IF NOT EXISTS detour_dispositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cwd TEXT NOT NULL,
    session_id TEXT,                 -- nullable: audit trail, no FK (same idiom as alert_events.session_id)
    source TEXT NOT NULL CHECK(source IN ('declared','inferred')),
    source_ref TEXT,                 -- events.id (declared push/bug/feature) or focus_inferences snapshot key
    label TEXT,
    disposition TEXT NOT NULL DEFAULT 'pending'
      CHECK(disposition IN ('pending','fold_in','new_item','deliberate','discard')),
    resolved_item_id TEXT,           -- plan_items.item_id, when disposition = fold_in
    decided_by TEXT CHECK(decided_by IN ('rule','llm','human')),
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    resolved_at TEXT
  );
  ```
- **`server/lib/focus-inference.js`** (`inferSession`, ~L473-520 and the
  `upsertFocusInference` call) — this is the actual gap. `focus_inferences`
  is **one row per session, upserted** (see the schema comment at
  `server/db.js` ~L616-625: "One row per session, re-inferred when the
  session gains activity"). That means a detour's identity does not survive
  re-inference: if a session is re-classified, the *previous* detour
  classification is overwritten, not archived. A `detour_dispositions` row
  keyed off "whatever `focus_inferences` currently says" would silently
  orphan itself the moment the session is re-inferred with a different
  verdict. **The disposition record must be created at classification time**
  (when `inferSession` first writes a `kind: 'detour'` row), not read
  lazily off `focus_inferences` later — this is a real ordering dependency,
  not a style preference.
- **`server/lib/focus-commands.js`** — declared detours (`ccam focus
  push/bug/feature`) already have a natural identity: the `events` row
  (`event_type = 'Focus'`, `data.verb` = push/bug/feature). A declared
  detour's disposition can reference that `events.id` directly as
  `source_ref` without needing a new write path — `focus-commands.js` itself
  likely does not need to change; the new disposition logic is a consumer.
- **New route**, e.g. `server/routes/detours.js` (new file, following
  `server/routes/plans.js`'s shape): `GET /api/detours?cwd=` /
  `?project_id=`, `POST /api/detours/:id/resolve { disposition, note }`.
  Needs to be mounted in `server/index.js` next to the other routers.
- **Websocket**: a new broadcast type (e.g. `detour_disposition_updated`) —
  additive, so it doesn't break the "stable message types" rule in
  `.claude/rules/backend-node.md`.

### Feasibility

Not as simple as "add a table." Two real branches:
1. Declared vs inferred detours have **different identity sources** (an
   `events` row vs a `focus_inferences` upsert) — the new code has to handle
   both, and inferred detours need the create-at-classification-time fix
   above or they'll drift.
2. The "fold in / new item" half of the four dispositions bumps into the
   file-ownership wall in §0 above.

### Effort: **M**
Schema + new route + wiring `focus-inference.js` to emit a durable record is
moderate, well-precedented work. The complexity is in getting the identity
model right (declared vs inferred) and in the architect's call on §0 — if
(b) is chosen, this becomes **L**.

### Gotchas
- **DERIVED-DUAL-VIEW (9.1)**: if a future decision-queue view AND a
  session-detail view both need to show "this session's detour disposition,"
  extract a shared component/hook — don't hand-copy the label/status
  rendering into two places.
- Any query that reconstructs "which detours happened, in what order" for a
  cwd/project must sort `events`/`focus_inferences` by `created_at`
  explicitly, not by `id` (**9.2**) — `workflow-ingest.js` bulk-inserts events
  after the fact, so `id` order is not chronological.
- `focus_inferences.session_id` has a hard FK with `ON DELETE CASCADE`
  (`server/db.js` ~L636) — if a `detour_dispositions` row's `session_id`
  keeps a hard FK too, deleting a session (session cleanup sweep) will
  cascade-delete disposition history. Existing precedent
  (`alert_events.session_id`, `webhook_deliveries.alert_id`) deliberately
  has **no FK** on audit-trail columns for exactly this reason — follow that,
  not the `focus_inferences` FK.

### Verification hooks
- `server/__tests__/focus-inference.test.js` — covers `inferSession`'s
  detour classification path; any change to how/when a detour record is
  created must extend this file, not just add a new isolated test.
- `server/__tests__/focus-hook.test.js` / `focus-commands.test.js` — covers
  declared push/bug/feature detours; a disposition route reading `events`
  rows should be checked against these fixtures.
- No existing test covers a "detour disposition" concept at all (grepped
  `server/__tests__/*.test.js` for "disposition" — zero hits) — this is
  wholly new coverage, not a case of an existing spec needing extension.

## Layer 5 — Pace tracking

### Exact change set

- **`server/db.js`**: add a nullable `target_date TEXT` column to
  `plan_items` (`CREATE TABLE` block ~L571-586) **and** a matching
  `ADD COLUMN` migration block for existing DBs, following the exact idiom
  already used for `workflow_run_id`/`workflow_phase` (~L794-799) or
  `cache_write_1h_per_mtok` (~L813-828):
  ```js
  try {
    db.prepare("SELECT target_date FROM plan_items LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE plan_items ADD COLUMN target_date TEXT").run();
  }
  ```
  This is a plain additive column (nullable, no NOT NULL constraint), so —
  unlike the `item_id`/`parent_item_id` migrations above it in the same
  file — it does **not** need the full rename-rebuild-drop dance those two
  needed (that dance exists only because SQLite can't add/relax a NOT NULL
  constraint via `ALTER TABLE`).
- **`server/lib/plan-ingest.js`**:
  - New regex alongside `ID_LINE_RE`/`DETAIL_LINE_RE` (~L85-87), e.g.
    `TARGET_LINE_RE = /^target\s*:\s*(.*)$/i`, parsed the same way `detail:`
    is in `parsePlanMarkdown` (~L198-203).
  - `upsertPlanItem` (db.js ~L2142-2154) needs the new column added to both
    its `INSERT` column list and its `ON CONFLICT ... DO UPDATE SET` clause
    — **and** every call site that positionally binds its params
    (`plan-ingest.js` ~L336-347) needs the new argument inserted in the
    matching position. This is the exact "must stay in sync" trap CLAUDE.md
    and PROJECT-CONTEXT.md's 9.1 pattern warn about, just on the SQL/param
    side rather than the client-rendering side — a prepared statement's
    `?` positions and its call site's argument list are a sibling pair that
    silently desyncs if only one is edited.
  - `MAX_TEXT_LEN`-style caps: add a length cap for the raw target string
    before storing (the file already caps `detail`/`acceptance`; an
    unbounded `target:` line should follow the same pattern).
- **New shared comparison utility** — a plain function (new file, e.g.
  `server/lib/pace.js`, or added to `focus-report.js`) computing a status
  (`on_track` / `behind` / `stalled` / `done_late` / `done_on_time`) from
  `target_date` vs "now" vs actual completion. **Open question the architect
  should settle**: what counts as "actual completion" — `checked` (the
  human-owned checkbox, i.e. the file's own truth) or `declared_done_at`
  (the agent's own claim via `ccam focus done N`, which can be set before a
  human ever checks the box)? They can and do disagree. Given `checked` is
  what plan-ingest.js treats as human-authoritative and `declared_done_at`
  is explicitly the *agent's claim* (per the schema comment at db.js
  ~L560-563), pace math should probably key off `checked`, with
  `declared_done_at` as a secondary/earlier signal — but this is a design
  call, not something obviously implied by the schema.
- Exposing pace status: either add it as a computed field in `GET
  /api/plans` / `GET /api/plans/project/:projectId` responses
  (`server/routes/plans.js`), or defer it entirely to layer 6's
  reconciliation output. Given layer 7 (rollup UI) is explicitly deferred,
  there's no UI consumer forcing this yet — recommend deferring the "expose
  it on the plans route" work until layer 6 needs it, to avoid building an
  API shape twice.

### Feasibility
Genuinely simple for the schema/ingest half — this is the smallest of the
three layers and matches the brief's own "start with the smallest concrete
slice" framing. The only real design decision is the completion-signal
question above.

### Effort: **S**

### Gotchas
- **Backward compatibility with existing `AGENT-PLAN.md` files with no
  target dates** (named explicitly in the ask): `target_date` must be
  nullable and every consumer (pace comparison, layer 6 rules) must treat
  `null` as "no target set — exempt from pace rules," not as "target
  epoch/overdue." `parsePlanMarkdown`'s tolerant-parser stance (unrecognized
  lines are ignored, not errors) already supports this for free on the
  ingest side; the gotcha is downstream code assuming `target_date` is
  always present.
- The `upsertPlanItem` positional-params trap above is the single highest-
  probability bug source in this layer — a missed second edit here can't be
  caught by TypeScript (this is a Node/JS backend) and won't fail loudly;
  it just silently binds `target_date`'s value to the wrong column, or the
  column is left `NULL` forever.
- `MAX_ITEMS`/`MAX_TEXT_LEN`-style caps exist specifically to keep
  `plan_updated` broadcasts under the websocket's 64 KB `maxPayload`
  (`plan-ingest.js` ~L58-66) — a new field adds to every broadcast payload;
  trivial for a single date string, but worth remembering the budget exists
  if a future field is bigger.

### Verification hooks
- `server/__tests__/plan-ingest.test.js` — the `describe("parsePlanMarkdown"...)`
  and `describe("ingestPlanForCwd"...)` blocks (~L64-263) are the direct
  spec to extend: a new test alongside "parses id: and detail: lines" for
  `target:`, and alongside "preserves declared_done_* across re-ingest" to
  confirm `target_date` also survives a re-ingest.
- `server/__tests__/plans-api.test.js` — covers `GET /api/plans` /
  `/for-cwd` / `/project/:id` response shapes; if `target_date` (or a
  computed pace field) is added to the route response, this is where a
  shape-regression would be caught.

## Layer 6 — Reconciliation pass (hybrid escalation)

### Exact change set / precedent

Two directly reusable precedents already exist in this repo, and they map
almost one-to-one onto the hybrid model:

- **Fixed-rule half** → `server/lib/session-liveness.js`'s `probeLiveCwds()`
  is the cited precedent, but it's a poor structural match (it's a
  synchronous `ps`/`lsof` probe, not a scheduled loop). The **actual**
  closest precedent for "a periodic per-entity pass with a fixed-rule
  decision" is `server/lib/focus-audit.js`'s `startFocusAudit()` /
  `tick()` (~L306-347): env-driven interval (`DASHBOARD_FOCUS_AUDIT_MS`),
  `unref()`'d timer, an overlap guard (`running` flag), a per-tick
  candidate cap (`MAX_SESSIONS_PER_TICK`), and a mode switch
  (`llm`/`heuristic`/`off`) — this is the shape layer 6's scheduler should
  copy almost verbatim, scoped to projects instead of sessions.
- **LLM-judgment half** → `server/lib/focus-summary.js`'s pattern is the
  right one to follow: model selection via
  `DASHBOARD_FOCUS_SUMMARY_MODEL` → shared fallback → `"haiku"`
  (`summaryModel()`, ~L90-94), a stable content-digest
  (`computeInputDigest`, sha1 over the summary-relevant slice) gating
  whether to re-spawn at all, and the shared hermetic spawn contract
  `runClaudePromptJson` from `focus-inference.js` (hooks disabled, all
  tools disallowed, `cwd = os.tmpdir()`, kill-timer) — **do not** write a
  third slightly-different `claude -p` invocation path; both
  `focus-audit.js` and `focus-summary.js` already explicitly avoid that.
- **Existing scheduling mechanism** → there is **no cron and no `/loop`
  hook-up in the server**; every "periodic" thing in this codebase (focus
  audit, focus inference, plan poll, remote source sync, alert sweep,
  session cleanup — see `server/index.js` ~L383-440 and ~L951 for the
  registration block, plus `server/lib/alerts.js` ~L310) is an in-process
  `setInterval` with an env-configurable tick, started from
  `server/index.js`'s startup sequence inside a `try { require(...); start(...) }
  catch` block. **This directly answers one of pm.md's open questions**:
  the "existing `/loop` mechanism" and "scheduled cron agent" framing in
  pm.md doesn't match what's actually in the codebase — the established,
  working convention is a same-process interval timer, and a new
  `startReconciliation(broadcast)` in a new `server/lib/reconciliation.js`,
  wired into `server/index.js` next to `startFocusAudit`/`startFocusInference`,
  is the path of least resistance and highest consistency with everything
  else in the file. This should be surfaced back to the architect as a
  correction to pm.md's framing, not just an implementation footnote.

### New pieces needed

- **`server/lib/reconciliation.js`** (new file): per-project tick that:
  1. Reads plan items + `target_date` (layer 5) and recent
     `detour_dispositions`/`focus_inferences` (layer 4) for each project's
     mapped cwds.
  2. Runs the **fixed rules only**: pace-vs-target (needs layer 5's
     comparison utility) and detour-volume ratio (count of
     `kind='detour'` rows in a lookback window vs. total session count —
     easy to compute from `focus_inferences` + `events` push/bug/feature
     rows, mind 9.2 chronology ordering).
  3. For whatever the rules flag, spawns **one** `runClaudePromptJson` call
     per flagged detour (or a batched prompt over all of a project's
     flagged detours in one shot, mirroring `focus-summary.js`'s "one
     spawn over N segments" batching rather than N spawns) asking
     specifically "which of fold_in/new_item/deliberate/discard is this,"
     never "should this be escalated" — the LLM must not make the
     escalation call, only the classification call, per the confirmed
     design.
  4. Writes results to a **new `decision_queue` table** (or reuses/extends
     `detour_dispositions` with a `queue_status` column — the architect's
     call per the brief's own open question #2; a separate table is
     cleaner since a decision-queue item is a distinct object from the
     detour record it's about, and a pace-alert queue item has no
     corresponding detour at all).
- **New table**, e.g.:
  ```sql
  CREATE TABLE IF NOT EXISTS decision_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('pace_alert','detour_volume','detour_disposition')),
    ref_id INTEGER,              -- e.g. detour_dispositions.id, when kind = detour_disposition
    payload TEXT,                -- JSON: rule inputs + (if applicable) LLM verdict/confidence/reason
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    resolved_at TEXT
  );
  ```
- **New route**, e.g. `server/routes/decision-queue.js`: `GET
  /api/decision-queue?project_id=` (or nested under
  `/api/projects/:id/decision-queue`, matching the existing
  `/api/projects/:id/focus-report` nesting convention in
  `server/routes/projects.js` ~L217-242), `POST
  /api/decision-queue/:id/resolve { action, note }`.
- **New env knobs**, matching the `DASHBOARD_*` naming convention already
  used everywhere (`DASHBOARD_FOCUS_AUDIT_MS`, `DASHBOARD_FOCUS_AUDIT_MODE`,
  etc.): something like `DASHBOARD_RECONCILE_MS` (tick interval),
  `DASHBOARD_RECONCILE_MODE` (`on`/`off`), `DASHBOARD_PACE_GRACE_DAYS`,
  `DASHBOARD_DETOUR_VOLUME_THRESHOLD`.

### Feasibility
The mechanical scaffolding (scheduler, LLM spawn, DB writes) is very
well-trodden in this codebase — three near-identical precedents to copy
from. The actual hard part is **cost/scope control**, not code shape (see
gotchas).

### Effort: **M** (assuming layers 4 and 5 already exist to build on) —
would be **L** if built without them, since the rule engine has nothing to
compare against.

### Dependencies & build order
1. **Layer 5 first** (schema column + comparison utility) — layer 6's
   fixed-rule half literally cannot run without `target_date` existing and
   a shared "is this on track" function to call. Trivial to build in
   isolation; nothing downstream needs to exist first.
2. **Layer 4 second** (durable detour record) — layer 6's LLM-judgment half
   needs something with stable identity to classify and write a verdict
   onto. Building layer 6 before layer 4 means the reconciliation pass has
   nothing durable to attach a disposition to; it would have to re-derive
   "what detours exist" from `focus_inferences` on every tick, defeating
   the point of a persisted decision.
3. **Layer 6 last**, consuming both. Its own new tables
   (`decision_queue`, and layer 4's `detour_dispositions` if not already
   shipped) can technically be added in the same migration batch as layer 4
   if the team wants to ship 4+6 together, but the rule engine and LLM pass
   are still logically downstream of both.

### Gotchas
- **Cost of an LLM pass per project per cycle** (named explicitly in the
  ask): with 8-10 projects and even a conservative 4-hour tick, that's
  48-60 spawns/day of a full `claude -p` headless process — each one forks
  a CLI process (`os.tmpdir()`, hermetic, ~seconds of wall time per the
  `DASHBOARD_FOCUS_AUDIT_TIMEOUT_MS`/`DASHBOARD_FOCUS_INFER_TIMEOUT_MS`
  precedent, default 30s kill timer). The existing precedents already solve
  the "make this cheap" problem three separate ways worth reusing
  directly: (1) **only spawn when the fixed rules actually flag
  something** — most ticks for most projects should do zero LLM calls, by
  design of the hybrid model itself; (2) **content-digest gating**
  (`focus-summary.js`'s `computeInputDigest`) so an unchanged set of
  flagged detours doesn't get re-classified every tick; (3) **batch
  multiple flagged detours from the same project into one prompt**
  (`focus-summary.js`'s multi-segment prompt) rather than one spawn per
  detour.
- **Migration safety**: every new table above should use `CREATE TABLE IF
  NOT EXISTS` (universal convention in `db.js`) and any new column on an
  existing table (`plan_items.target_date`) must get the try/SELECT-catch/
  ALTER pattern, not a bare `ALTER TABLE`, or a fresh install's
  `CREATE TABLE` and an upgrading install's migration block will disagree
  — **exactly** the "must stay in sync" trap PROJECT-CONTEXT.md's 9.1 names
  for client rendering, mirrored here on the schema side: the `CREATE TABLE
  IF NOT EXISTS` block (fresh DBs) and the standalone `ALTER TABLE`
  migration blocks (upgrading DBs) are a sibling pair — this file's own
  history (`item_id`, `parent_item_id`, `workflow_run_id`,
  `cache_write_1h_per_mtok`, `fast_input_per_mtok`, `intro_until`) shows a
  new column is *always* added in both places, never one.
- **Inverting the hybrid model** (explicit non-negotiable per the brief):
  the rule-evaluation code must never ask the LLM "should I escalate this,"
  and the LLM-classification code must never itself decide pace status —
  keep these as two separate functions/modules with a one-directional call
  (rules → decide what to send the LLM), so a future edit to one can't
  accidentally blur the boundary.
- **`declared_done_at` vs `checked`** ambiguity (layer 5) propagates
  directly into layer 6's pace rule — whichever the architect picks,
  layer 6's rule must use the *same* signal layer 5's utility uses, not
  re-derive its own.

### Verification hooks
- No existing test file covers anything resembling a reconciliation pass —
  this is entirely new coverage. The **shape** to copy for the fixed-rule
  half's tests is `server/__tests__/focus-audit.test.js`'s `heuristicVerdict`/
  `auditSession` tests (pure-function unit tests plus an injected-spawn
  integration test via `__injectSpawnForTest`); for the LLM half, copy
  `server/__tests__/focus-summary.test.js`'s prompt-building/output-parsing/
  cache-digest test structure.
- `server/__tests__/session-liveness.test.js` is the wrong template
  structurally (it's a `ps`/`lsof` probe test, not a scheduled-loop test) —
  don't follow its shape for the scheduler despite pm.md citing it as the
  hybrid-model precedent; it's the right citation for "fixed rules exist
  elsewhere in this codebase," not for "how to structure a periodic loop."

## Summary table

| Layer | New DB objects | New/changed files | Effort |
|---|---|---|---|
| 4 — detour disposition | `detour_dispositions` table | `focus-inference.js` (emit at classify-time), new `routes/detours.js` | M (L if plan write-back is chosen) |
| 5 — pace tracking | `plan_items.target_date` column | `plan-ingest.js` (parse + upsert), new `lib/pace.js` | S |
| 6 — reconciliation | `decision_queue` table | new `lib/reconciliation.js`, new `routes/decision-queue.js`, `index.js` wiring | M (given 4+5 exist) |

## Commands used to verify (for the record)

- `npm run test:server` was **not run** as part of this investigation
  (no code was changed — this is a read-only intake pass). Anyone
  implementing this should run `npm run test:server` before finishing per
  CLAUDE.md's testing policy, plus the specific files named above.

---

## REVISION (2026-08-01) — Layer 4 real write-back + auto-write, per DEC-2/DEC-13

Grounded fresh against the live code, none of which yet contains any of
layer 4's tables/modules (`grep -rn "detour_dispositions\|decision_queue"
server/` is empty — this is still a pre-implementation design pass, not a
retrofit): `server/lib/cc-mutate.js` (full file, the `atomicWriteFile` to
extract), `server/lib/plan-ingest.js` (full file — parser regexes, caps,
`ingestPlanForCwd`, module exports), `server/db.js:535-593` (`plans`/
`plan_items` schema) and `:2116-2188` (their prepared statements,
especially `upsertPlanItem`'s `ON CONFLICT` list and `deletePlanItemsNotIn`),
`server/db.js:404-421` (`alert_events`, the no-cascade-FK audit-trail
precedent), `server/routes/plans.js` (full file, the router shape a new
`routes/detours.js` and `routes/decision-queue.js` would copy), and
`server/index.js:554-599` (`startPlanPoll`) / `server/routes/hooks.js:~1185`
(`SessionStart` ingest trigger) to confirm every existing path into
`ingestPlanForCwd`. This section answers DEC-13 = **A (auto-write)** at
implementation-detail grounding; it does not reopen DEC-2/DEC-13 themselves.

### Exact change set

- **`server/lib/atomic-file.js`** (new file) — `atomicWriteFile(filePath,
  content)` extracted verbatim from `server/lib/cc-mutate.js:218-247` (temp
  file in the same dir, best-effort `fsync`, `renameSync`, tmp unlinked on
  any failure path). `cc-mutate.js` deletes its local copy and does
  `const { atomicWriteFile } = require("./atomic-file")` — `cc-mutate.js`
  exports nothing named `atomicWriteFile` today (confirmed at its
  `module.exports` block, `cc-mutate.js:527-535`), so this extraction is a
  pure internal refactor with zero external API change. `plan-writeback.js`
  imports the same shared helper — this is the one piece of this revision
  that is genuinely just "move code," not new logic.
- **`server/lib/plan-ingest.js`** — four new **exports only**, no behavior
  change: `ID_LINE_RE`, `ACCEPTANCE_LINE_RE`, `DETAIL_LINE_RE` (currently
  module-scope consts, `plan-ingest.js:85-87`) and the safety caps
  `MAX_ITEMS`, `MAX_TEXT_LEN`, `MAX_ACCEPTANCE_LEN`, `MAX_DETAIL_LEN`
  (`plan-ingest.js:61-66`). `plan-writeback.js` needs these to (a) know what
  a "structural line" looks like when sanitizing LLM text and (b) enforce
  identical caps on write that `plan-ingest.js` already enforces on read.
  This keeps `plan-ingest.js` the sole owner of "what this file's syntax
  means," per the architect's explicit constraint — `plan-writeback.js` must
  never hand-roll a second copy of these regexes/caps.
- **`server/lib/plan-writeback.js`** (new file) — the write-back module
  itself:
  - `sanitizeLlmPlanText(input, maxLen)` — the mandatory-per-DEC-13
    function (see below).
  - `appendPlanItem(dbModule, { cwd, text, acceptance, detail, expectedHash })`
    / `appendSubItem(dbModule, { cwd, parentItemId, text, acceptance,
    detail, expectedHash })` — per the architect's mechanism design: per-cwd
    mutex → read+hash the file fresh → cheap `expectedHash` pre-check →
    `parsePlanMarkdown` (imported from `plan-ingest.js`, never re-derived)
    for max-number/id-collision/parent-block-boundary lookup → mint a new
    id via `crypto.randomBytes(4).toString("hex")` → **sanitize** `text`/
    `acceptance`/`detail` → pre-flight `MAX_ITEMS`/`MAX_FILE_BYTES` →
    backup → re-hash-immediately-before-rename optimistic check → atomic
    write via `atomic-file.js` → call the real `ingestPlanForCwd(dbModule,
    cwd)` → release mutex. Returns a structured result, never throws:
    `{ ok:true, itemId, hashBefore, hashAfter, backupPath, plan, items }` or
    `{ ok:false, code: 'CONFLICT'|'CAPS_EXCEEDED'|'NO_PLAN_FILE'|'IO_ERROR', error, currentHash? }`.
  - `applyDisposition(dbModule, dispositionId, { broadcast, retried })` —
    **new orchestration function this revision adds beyond the architect's
    original two-function design**, needed specifically because DEC-13 now
    requires two call sites (a human `resolve` route call and Layer 6's
    unattended reconciliation tick) to fire the *identical* write+audit
    sequence — writing that sequence twice would be exactly the
    **DERIVED-DUAL-VIEW (9.1)** trap the architect's own file already
    flags for pace/disposition computation, just recurring one layer over
    on the write path instead. It: loads the `detour_dispositions` row,
    stamps `write_status='pending'`/`write_attempted_at` via a new prepared
    statement, dispatches to `appendPlanItem`/`appendSubItem` based on
    `disposition` (`fold_in` → `appendSubItem` under
    `proposed_parent_item_id`; `new_item` → `appendPlanItem`), and on return
    writes the result back onto the same row (`write_status`,
    `write_completed_at`/`write_error`, `resolved_item_id`,
    `write_backup_path`, `write_content_hash_before/after`) — see the new
    columns below. Retry-on-conflict policy (one retry, then escalate) lives
    **here**, not inside `appendPlanItem`/`appendSubItem` themselves, so the
    low-level functions stay simple, synchronous-shaped, and independently
    testable.
- **`server/db.js`** — this changes the **not-yet-shipped** `Q1`
  (`detour_dispositions`) and `Q2` (`decision_queue`) table designs from the
  original architect/engineer passes, not a live-schema migration (see
  Migration steps below):
  - `detour_dispositions` gains a write-audit block beyond DEC-4/Q1's
    original shape: `write_status TEXT NOT NULL DEFAULT 'none' CHECK(write_status
    IN ('none','pending','written','failed','conflict'))`,
    `write_attempted_at TEXT`, `write_completed_at TEXT`, `write_error TEXT`,
    `write_backup_path TEXT`, `write_content_hash_before TEXT`,
    `write_content_hash_after TEXT`, plus the LLM/rule's **proposed content**
    that `applyDisposition` sanitizes and writes:
    `proposed_text TEXT`, `proposed_acceptance TEXT`, `proposed_detail TEXT`,
    `proposed_parent_item_id TEXT` (set only for `fold_in`). `resolved_item_id`
    (already in DEC-4's shape) is the forward pointer from disposition →
    the `plan_items.item_id` it produced; together with the new
    `write_*` columns this satisfies DEC-13's traceability requirement in
    both directions — given a `plan_items` row, `SELECT * FROM
    detour_dispositions WHERE resolved_item_id = ?` recovers which detour,
    which classification (`decided_by`, `reason`), and when
    (`write_completed_at`).
  - `decision_queue`'s `kind` `CHECK` constraint needs a fourth/fifth value
    added at initial creation (again: pre-implementation, not yet a live
    `CHECK`) for the new conflict/failure-escalation path:
    `'writeback_conflict'` and `'writeback_failed'` alongside the original
    `pace_alert | detour_volume | detour_disposition`. Per **WATCH-4**
    (already recorded: "CHECK-constrained enums are rebuild-to-widen"), if
    this table ships *before* this write-back sub-design is finalized,
    widening it later needs the full rename-copy-drop dance `plan_items`'
    own history shows — strong reason to land Q2's schema and this
    revision's addendum in the **same** migration batch rather than two.
  - New prepared statements (alongside where `Q1`/`Q2`'s original
    statements would live, near `plan_items`' block at `db.js:2116-2188`):
    `markDetourWritePending`, `markDetourWriteResult` (single statement
    setting `write_status`/`write_completed_at`/`write_error`/
    `resolved_item_id`/`write_backup_path`/hash columns/`resolved_at`
    together, so a partial update can't leave the row half-consistent).
- **`server/routes/detours.js`** (new, per the original engineer.md) —
  `POST /:id/resolve { disposition, note, target_item_id? }`'s handler now
  additionally calls `applyDisposition(dbModule, id, { broadcast })`
  synchronously (within the same request, per DEC-13's "fires immediately"
  requirement) when `disposition` is `fold_in`/`new_item`, and returns the
  write result (`write_status`, `resolved_item_id`, or the conflict/error)
  in the response body — a human resolving a decision-queue item by hand is
  the **second** of DEC-13's two auto-write trigger points, not exempt from
  it just because a human clicked something (DEC-13's "A" was chosen
  precisely to include this path, not only the unattended LLM path).
- **`server/lib/reconciliation.js`** (new, layer 6, per the original
  engineer.md) — after writing a `detour_dispositions` row with
  `decided_by='llm'` for a flagged detour, calls the same
  `applyDisposition(dbModule, id, { broadcast })` in-process, no route hop —
  this is the **first**, unattended trigger point DEC-13 names explicitly.
  `reconciliation.js` must own the `broadcast("plan_updated", …)` call for
  this path (mirroring `plan-ingest.js`'s existing "caller owns
  broadcasting" contract) exactly as `startPlanPoll`/the `SessionStart` hook
  already do for every other ingest trigger.
- **`server/routes/decision-queue.js`** (new, per the original engineer.md)
  — needs one more action beyond plain `resolve`/`dismiss`: a manual
  `retry_write` action for a `writeback_conflict`/`writeback_failed` queue
  entry, which re-invokes `applyDisposition` with a fresh optimistic check
  (no stale `expectedHash` carried over from the failed attempt).
- **CLI**: no new `ccam` command is strictly required — `ccam`'s existing
  pattern (`ccam focus done <n>`, `bin/ccam.js:~1683`) is a thin HTTP client
  over the route layer, so a human retrying a stuck write-back would use
  whatever `ccam`-side surface is added for the decision queue generally
  (out of this revision's scope — the original engineer.md's layer 6 route
  design already implies a `ccam decisions ...` family). Recording this so
  it isn't assumed to need a bespoke write-back CLI command of its own.

### The sanitization function (DEC-13, now mandatory)

```js
// server/lib/plan-writeback.js
const {
  ID_LINE_RE, ACCEPTANCE_LINE_RE, DETAIL_LINE_RE,
} = require("./plan-ingest");

/**
 * Neutralize LLM-influenced text before it is composed into AGENT-PLAN.md.
 * A multi-line string is exactly how a forged "id:"/"acceptance:"/"detail:"
 * continuation line gets injected — plan-ingest.js's parser treats any
 * further-indented line after a checkbox item as a continuation of it (see
 * ID_LINE_RE/ACCEPTANCE_LINE_RE/DETAIL_LINE_RE handling in
 * parsePlanMarkdown). Collapsing newlines to spaces removes the ONLY
 * mechanism by which composed markdown could grow a second structural line
 * the parser would honor. As defense in depth, a resulting string that still
 * matches one of the parser's own field-prefix regexes (e.g. an LLM literally
 * emitting "detail: rm -rf /" as its whole answer) has that prefix stripped
 * so it can never masquerade as a structural line if some future caller ever
 * places it back on its own line. Never throws; non-string input degrades to
 * "" so a caller can uniformly treat empty as "nothing to write" instead of
 * partially composing a corrupt block.
 */
function sanitizeLlmPlanText(input, maxLen) {
  if (typeof input !== "string") return "";
  let collapsed = input.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (ID_LINE_RE.test(collapsed) || ACCEPTANCE_LINE_RE.test(collapsed) || DETAIL_LINE_RE.test(collapsed)) {
    collapsed = collapsed.replace(/^(id|acceptance|detail)\s*:\s*/i, "");
  }
  return collapsed.slice(0, maxLen);
}
```

This is a design-grade sketch, not verified-running code (no test was
executed as part of this pass — see Verification hooks). `applyDisposition`
must run `proposed_text`/`proposed_acceptance`/`proposed_detail` through
this **individually**, with `plan-ingest.js`'s own
`MAX_TEXT_LEN`/`MAX_ACCEPTANCE_LEN`/`MAX_DETAIL_LEN` as `maxLen`, before
handing them to `appendPlanItem`/`appendSubItem` — sanitizing the composed
block as a whole instead would be too late (a forged line could already
span what should have been two separate fields).

### Migration steps

**None on the live schema today** — `detour_dispositions` and
`decision_queue` do not exist yet anywhere in `server/db.js` (confirmed by
grep). This revision changes what their `CREATE TABLE IF NOT EXISTS`
statements should contain *before* they are first written, not an `ALTER
TABLE` against rows that already exist. Two things still matter for
whoever writes that `CREATE TABLE`:
1. Land the write-audit columns (`write_status`, `write_attempted_at`, …)
   and the widened `decision_queue.kind` enum **in the same initial
   `CREATE TABLE`** as Q1/Q2's base shape, not as a follow-up `ALTER TABLE`
   — per **WATCH-4**, every `CHECK` constraint here is rebuild-to-widen, so
   splitting this into "ship the table, then ALTER it a week later" costs a
   full rename-copy-drop dance for zero benefit when it's this cheap to get
   right the first time.
2. **If** Q1/Q2 somehow ship (e.g. layers 4's base disposition-recording
   half lands) **before** this write-back redesign is implemented — a real
   possibility given DEC-3's Layer 5 → Layer 4 → Layer 6 sequencing and
   Sara being shown each layer before the next starts — then this
   revision's columns become a genuine `ALTER TABLE` migration, following
   the exact idiom every additive column in `db.js` already uses (e.g.
   `workflow_run_id`/`cache_write_1h_per_mtok`, `db.js:~794-828`):
   ```js
   try {
     db.prepare("SELECT write_status FROM detour_dispositions LIMIT 1").get();
   } catch {
     db.prepare("ALTER TABLE detour_dispositions ADD COLUMN write_status TEXT NOT NULL DEFAULT 'none'").run();
     // ...repeat per new column; CHECK constraints CANNOT be added via ALTER TABLE ADD COLUMN in SQLite —
     // if the write_status/decision_queue.kind CHECK needs to be enforced on an already-shipped table,
     // that specific constraint requires the full rename-copy-drop dance, not a bare ALTER.
   }
   ```
   This is the one real risk of shipping layer 4's base table before this
   write-back revision is finalized: SQLite cannot add a `CHECK` constraint
   via `ALTER TABLE ADD COLUMN` at all, so the `write_status` enum
   specifically (not the other new nullable text columns) would need the
   full `plan_items`-style rebuild if added after the fact. Strongly prefer
   landing this whole revision's schema **before** any live DB has a
   `detour_dispositions` table, per point 1.

### Failure-mode handling (CONFLICT and friends)

`applyDisposition` is the single place this policy lives (never duplicated
into the route handler and the reconciliation tick separately):

1. **Cheap pre-check conflict** (the `expectedHash` passed in — for the
   human-`resolve` path this is "whatever `plans.content_hash` was when the
   decision-queue item was displayed"; for the unattended reconciliation
   path, `applyDisposition` itself reads `stmts.getPlanByCwd.get(cwd)
   .content_hash` immediately before calling `appendPlanItem`/`appendSubItem`,
   since there is no "what the human last saw" to compare against) — cheap,
   fails before any parsing/composition work.
2. **Real optimistic-lock conflict** (the re-hash-immediately-before-rename
   check inside `appendPlanItem`/`appendSubItem` itself) — this is the one
   that actually matters, since it catches an edit that happened *during*
   this write attempt, not just before it started.
3. **On either kind of `CONFLICT`: retry exactly once**, immediately,
   in-process, with a **fully fresh** read (no reused `expectedHash`,
   re-derive current `plans.content_hash` from disk again) — a single
   transient race against a human's editor autosave is the expected shape
   of this failure per the architect's own framing ("very small relative to
   interactive human editing cadence"), and a same-process immediate retry
   costs nothing extra (`ingestPlanForCwd`'s own hash-match no-op means the
   retry's re-parse is cheap even if nothing actually changed).
4. **If the retry ALSO conflicts** — this means sustained editing, not a
   transient race; retrying a third time risks a live-lock chasing a human's
   editor and must not happen. Instead: mark
   `detour_dispositions.write_status='conflict'` (leaving `resolved_item_id`
   null — no plan item was ever created) and insert a
   `decision_queue` row with `kind='writeback_conflict'`,
   `ref_id=<disposition id>`, `payload` carrying the disposition's
   proposed content plus the current file hash, so nothing is silently
   lost — the *decision to fold this in* is still recorded and visible, only
   the mechanical write didn't land yet. A human resolves it later via the
   new `retry_write` decision-queue action, which calls `applyDisposition`
   again with a fresh check.
5. **Any non-conflict failure** (`CAPS_EXCEEDED`, `NO_PLAN_FILE`,
   `IO_ERROR`) — no retry (retrying an out-of-space disk or an already-full
   `MAX_ITEMS` file won't succeed on the second attempt); go straight to
   `write_status='failed'` + a `decision_queue` row with
   `kind='writeback_failed'` on the first attempt. This is deliberately
   asymmetric from the `CONFLICT` path (immediate escalation, no retry)
   because the underlying cause is not transient.
6. **A disposition decided by the LLM/rule pass with no corresponding plan
   file at all** (`NO_PLAN_FILE` — e.g. `plans.missing_at` is set, or the
   cwd never had a plan) is a **hard stop, not a queue item that waits for a
   file to reappear on its own** — this composes directly with **WATCH-2**'s
   already-recorded mitigation ("the reconciliation tick must skip any cwd
   whose `plans` row has `missing_at` set… rather than firing a false pace
   alarm on a dead plan"): a reconciliation tick that skips a dead-plan cwd
   for pace purposes must equally never attempt a `fold_in`/`new_item`
   write-back into it. In practice this means `reconciliation.js`'s
   per-project loop should filter out `missing_at`/planless cwds **before**
   ever reaching the LLM-classification step, not rely on
   `appendPlanItem` catching it downstream — cheaper, and keeps the same
   invariant enforced in exactly one place instead of two.

### Feasibility

Mechanically feasible — every new piece (mutex, atomic write, hash-based
optimistic lock, structured retry) is a well-understood pattern and the
codebase already has half of it (`cc-mutate.js`'s backup+atomic-write shape,
`plan-ingest.js`'s parser/caps, `alert_events`'s audit-trail-no-FK
convention). The genuinely new surface is:
1. **The per-cwd mutex** — this codebase has **no existing precedent**
   for an in-process write-serialization primitive (`grep -rn "mutex\|
   inFlight\|writeQueue" server/lib` turns up nothing). This is not a big
   function, but it is new, untested-in-this-repo concurrency-control code,
   not a copy of an existing pattern the way everything else in this
   revision is.
2. **Auto-write from an unattended path is a materially different trust
   posture than the original architect design assumed** (that design's own
   §"Scope boundaries this revision deliberately does NOT resolve" #2
   explicitly left the trigger-point question open, calling it "a
   materially different risk posture"). DEC-13 answering that question as
   "auto-write" is what turns "mandatory once real write-back happens" (the
   sanitizer) into "mandatory, full stop" and adds the entire
   `applyDisposition`/retry/decision-queue-escalation layer that a
   confirm-gated design would not have needed at all (a human reviewing the
   exact text before approving is itself a sanitization backstop that
   auto-write does not have).
3. **Two independent call sites must invoke identical logic**
   (`routes/detours.js`'s human-resolve path and `reconciliation.js`'s
   unattended LLM path) — this is why `applyDisposition` exists as a shared
   function rather than two call sites each composing
   `appendPlanItem`/`appendSubItem` themselves; skipping this and hand-writing
   the sequence twice would be a second occurrence of **DERIVED-DUAL-VIEW
   (9.1)**, this time on the write path rather than a render path.

### Effort estimate

**L, and larger than the L that DEC-2 alone already produced.** DEC-2's
architect revision priced "write the file safely, guard against concurrent
human edits, re-run the real ingest" as L. DEC-13's auto-write choice adds,
on top of that L:
- the `applyDisposition` orchestration layer + its write-audit columns
  (net-new, ~half a day of schema+wiring),
- the retry-once/escalate-to-queue policy and its `decision_queue` widening
  (net-new, needs its own tests — retry-then-conflict, retry-then-succeed,
  non-conflict-failure-no-retry are three distinct paths),
- the mandatory sanitizer as an explicit, independently-tested function
  (was "a mitigation to remember" before, is now a shipped function with its
  own unit tests for the injection-shaped-input case),
- and the WATCH-2 composition point (reconciliation must filter dead/missing
  plans **before** the LLM step, not just at write time) becoming a required
  ordering constraint in `reconciliation.js` rather than an implicit one.

None of these individually is large, but together they roughly double the
net-new (not extracted/reused) code surface this revision needs relative to
the confirm-then-write alternative DEC-13 rejected — call it **L, high
end** rather than L, low end. Still well short of a new **XL** — no schema
change exists on the live DB today (see Migration steps), and three of the
four building blocks (`atomic-file.js`'s extraction, `parsePlanMarkdown`
reuse, `alert_events`-style audit-trail-no-FK convention) are copy-not-invent.

### Dependencies & order

1. **`atomic-file.js` extraction first** — trivial, zero-risk, unblocks
   both `cc-mutate.js` (unchanged behavior) and `plan-writeback.js`. Do this
   as its own small commit before anything else in this revision, so a
   regression in `cc-mutate.js`'s existing callers (`server/routes/cc-config.js`)
   is caught by `cc-config.test.js` in isolation from the much larger
   write-back change.
2. **`plan-ingest.js` exports** (regexes + caps) — additive, zero behavior
   change, unblocks `plan-writeback.js`'s sanitizer and cap pre-flight.
3. **`plan-writeback.js`'s low-level functions** (`appendPlanItem`,
   `appendSubItem`, `sanitizeLlmPlanText`) — buildable and fully unit-testable
   in isolation, with **no dependency on `detour_dispositions` existing at
   all** (they take plain `{ cwd, text, acceptance, detail, expectedHash }`
   args, not a disposition row). This is the layer to build and test first.
4. **`detour_dispositions`/`decision_queue` schema** (this revision's
   amended shape, including the write-audit + proposed-content columns) —
   must land before `applyDisposition` can be written against it, and before
   `routes/detours.js`/`routes/decision-queue.js` exist.
5. **`applyDisposition`** — depends on both 3 and 4.
6. **`routes/detours.js`'s resolve handler** and **`reconciliation.js`'s
   per-detour tick** wire into `applyDisposition` last, once it exists —
   these are the two call sites DEC-13 requires to behave identically.

This order is a refinement of DEC-3's Layer 5 → Layer 4 → Layer 6 sequencing,
not a replacement for it: steps 1-3 above can be built and merged as
"layer 4 write-back plumbing" before layer 4's own disposition-recording
schema (step 4) is finalized, and step 6's `reconciliation.js` half is still
correctly sequenced after layer 4 per the original plan.

### Gotchas

- **The markdown-injection line the architect's design does not fully
  close on its own**: sanitizing `text`/`acceptance`/`detail` independently
  is necessary but not sufficient if `applyDisposition` ever composes them
  by simple string concatenation before sanitizing the joined result — the
  join itself must happen **after** each field is independently sanitized,
  never before, or a sanitized `text` ending mid-word next to an
  unsanitized `acceptance` starting with `id:` could still recombine into a
  structural-looking line. Test this joinery explicitly, not just each
  field in isolation.
- **`upsertPlanItem`'s `ON CONFLICT` list is a sibling-pair trap that also
  applies here, one level removed**: `plan-writeback.js` never calls
  `upsertPlanItem` directly (by design — `ingestPlanForCwd` is the only
  writer of `plan_items`), so this revision does **not** reintroduce the
  layer-5 positional-params trap DEC-10 killed. But if a future change ever
  tempts someone to have `appendPlanItem` "just also write the DB row
  directly, to save an ingest round-trip," that is exactly the mistake to
  refuse — re-running the real `ingestPlanForCwd` is what keeps `plan_items`
  at exactly one writer, and skipping it to be faster would silently
  resurrect the very problem `§0`/DEC-2 exists to solve.
- **The per-cwd mutex must be keyed on the exact same `cwd` string
  `ingestPlanForCwd`/`getPlanByCwd` use** (raw, not normalized/resolved) —
  `plan-ingest.js` and `db.js` both key everything off the literal cwd
  string passed in (no `path.resolve` normalization visible anywhere in
  `ingestPlanForCwd`), so if `plan-writeback.js`'s mutex map key ever
  diverges (e.g. one call site passes a trailing slash, another doesn't) two
  writes to what is actually the same file would run unserialized. Confirm
  the disposition row's stored `cwd` and the mutex key are byte-identical.
- **Backup accumulation** (already flagged by the architect) gets worse
  under auto-write specifically: a confirm-gated design would back up once
  per human-approved write; auto-write backs up once per LLM-decided
  `fold_in`/`new_item`, at reconciliation-tick cadence, with no human
  pacing it. Retention/pruning for
  `<cwd>/.claude/agent-plan-backups/` is now a near-term need, not a
  someday one.
- **`WATCH-2` composition** (see Failure-mode handling #6) — easy to get
  half-right by adding the `missing_at` filter to the pace-alert path but
  forgetting the write-back path, since they're two different code
  branches inside the same `reconciliation.js` tick.

### Verification hooks

- **`server/__tests__/cc-config.test.js`** — the existing coverage of
  `cc-mutate.js`'s `writeArtifact`/backup/atomic-write behavior; extracting
  `atomicWriteFile` into `atomic-file.js` must leave every assertion in this
  file passing unchanged (behavior-preserving refactor, not a rewrite) — run
  this file specifically after step 1 of the build order above, before
  touching anything else.
- **`server/__tests__/plan-ingest.test.js`** — the `parsePlanMarkdown`/
  `ingestPlanForCwd` suite; any `plan-writeback.js` happy-path test should
  assert against **this same file's fixtures/helpers** for "does the
  resulting file still parse the way `plan-ingest.js` expects," not a
  second hand-rolled parser assertion.
- **New `server/__tests__/plan-writeback.test.js`** (does not exist yet —
  wholly new coverage) — must cover, at minimum: happy-path append survives
  a subsequent `ingestPlanForCwd`; a simulated concurrent edit between the
  pre-check read and the pre-rename re-check produces exactly one retry then
  either succeeds or surfaces `CONFLICT`; two racing `plan-writeback` calls
  for the same cwd serialize via the mutex (no torn/interleaved write); an
  injection-shaped `text`/`acceptance`/`detail` (embedded newline containing
  a fake `id:`/`detail:` line) is neutralized by `sanitizeLlmPlanText` both
  in isolation and after joinery; `MAX_ITEMS`/`MAX_FILE_BYTES` pre-flight
  rejects with `CAPS_EXCEEDED` rather than writing a file `plan-ingest.js`
  would then silently truncate on the next read.
- **New `server/__tests__/detours.test.js`** and a new reconciliation test
  file (per the original engineer.md's layer 4/6 guidance) — must each
  include a case that stubs `plan-writeback.js`'s `appendPlanItem`/
  `appendSubItem` to return `{ ok:false, code:'CONFLICT' }` twice in a row
  and assert (a) exactly one retry happened (not zero, not two), and (b) a
  `decision_queue` row with `kind='writeback_conflict'` was created —
  this is the one behavior in this whole revision with no existing sibling
  test to copy the shape from, since no prior feature in this codebase
  retries a file write against a human's own concurrent edit.
- `npm run test:server` was **not run** as part of this pass — no code was
  changed, this is a read-only design/grounding pass. Run it, plus the
  specific files above, before any of this revision's code merges.
