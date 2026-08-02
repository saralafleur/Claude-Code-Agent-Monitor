# Technical Plan — Build the Project Manager (layers 4–6)

Intake: `intake/2026-08-01-build-project-manager/` · Tech-lead pass · 2026-08-01
Request type (final, from PM): **`new-feature`** — net-new subsystem built as a
sequel to shipped precedents, not greenfield.

Inputs reconciled: `request-brief.md`, `supporting/architect.md`,
`supporting/engineer.md`, `supporting/qa.md`, `pm-plan.md`, and this intake's
`decisions.md` (written alongside this plan — every scope boundary below cites
a row there).

Grounded against live code: `server/db.js`, `server/lib/plan-ingest.js`,
`server/lib/plan-writeback.js` (does not exist yet — designed here),
`server/lib/cc-mutate.js`, `server/lib/focus-inference.js`,
`server/lib/focus-audit.js`, `server/lib/focus-summary.js`,
`server/lib/focus-commands.js`, `server/routes/plans.js`,
`server/routes/hooks.js`, `server/index.js`, `bin/ccam.js`,
`PROJECT-CONTEXT.md`.

---

## Revision history

**2026-08-01 — Layer 4 redesigned in place (DEC-2 = B, DEC-13 = A).** The first
version of this plan specified Layer 4 as **advisory-only**: dispositions would
record a decision and emit a paste-ready markdown snippet, and nothing in the
change set would ever write `AGENT-PLAN.md` or `plan_items`. Sara overruled that
recommendation. **DEC-2** chose **real write-back** into `AGENT-PLAN.md`, and
**DEC-13** chose **auto-write on disposition** — the file write fires
immediately and unattended the moment a `fold_in`/`new_item` disposition is
decided, including when the decider is Layer 6's LLM judgment pass rather than
Sara. `decisions.md` **DEC-12** (which had rewritten QA's `fold_into_plan` spec
into its inverse, "must NOT create a `plan_items` row") is therefore
**SUPERSEDED** — the original assertion direction is correct again, but by a
different mechanism (write the file, then re-run the *real* ingest; never a
direct DB insert).

What that means for a reader of this document:

- **§3's Layer 4 change set, §4's steps 11–21, §6's Layer 4 test section, and
  every "advisory-only" claim in §1/§2/§5/§7/§8 were rewritten.** Layer 4 is
  now structurally heavier than Layers 5 and 6 — it carries a new file-mutation
  module, an extracted atomic-write primitive, a concurrency-control primitive
  with no precedent in this repo, a mandatory content sanitizer, a write-audit
  schema block, and a conflict-escalation path. That asymmetry is deliberate
  and is the direct cost of DEC-2 + DEC-13.
- **Layer 4's effort moves M → L, high end** (per the engineer's revision).
  DEC-2 alone priced write-back at L; DEC-13's auto-write adds the
  `applyDisposition` orchestration layer, the write-audit columns, the
  retry-once/escalate policy, and the sanitizer-as-a-shipped-tested-function
  on top of that L.
- **Layers 5 and 6 are otherwise untouched by this fork.** The only Layer 6
  edits are the two auto-write wiring points DEC-13 requires, both marked
  **[DEC-13]** inline: step 23(d)'s `fold_in`/`new_item` branch now calls
  `applyDisposition`, and step 23(a)'s tick must filter dead/planless cwds
  *before* the LLM step. Layer 6's rules/LLM split, scheduling, digest gating,
  and queue semantics are unchanged. (Layer 6's step numbers shifted from
  18–26 to 22–30 because Layer 4 grew.)

---

## 1. Objective

Give this dashboard the missing middle of the confirmed 7-layer
portfolio-management architecture, so Sara can answer "are we on track, and
what did the undeclared work actually mean" without rotating through sessions
by hand. Concretely: every plan item gains an optional **target date**
(`plan_items.target_date`) and a single shared **pace** computation; every
inferred detour gains a **durable, queryable disposition record**
(`detour_dispositions`) with a stable identity that survives the classifier
re-inferring the session; a `fold_in`/`new_item` disposition **writes real
content into `AGENT-PLAN.md`** the moment it is decided (DEC-2/DEC-13) through
one guarded write path that then re-runs the ordinary ingest, so `plan_items`
keeps exactly one writer; and a new **in-process reconciliation scheduler**
(`server/lib/reconciliation.js`) runs a per-cwd tick that uses *deterministic
rules only* to decide **whether** to escalate, then — only for what the rules
flagged — one batched hermetic `claude -p` call to decide **what a detour is**,
writing results to a `decision_queue` table readable over HTTP and `ccam`.
End state: three new DB objects, one new scheduler, three new derivation libs
(`pace.js`, `detours.js`, `reconciliation.js`), two new write-path libs
(`plan-writeback.js` plus the extracted `atomic-file.js`), two new routes, two
new `ccam` commands, five new/extended server test suites, zero client changes.

---

## 2. Recommended approach

Adopt the architect's Q1–Q4 recommendations as a batch (decisions.md **DEC-4**),
built in the PM's sequence **layer 5 → layer 4 → layer 6** (**DEC-3**), using
the engineer's file/function-level change set — with four explicit overrides,
and with Layer 4's write path taken from the architect's and engineer's
**2026-08-01 revisions** (real write-back + auto-write).

**The design in one line:** observations stay re-derivable and classifier-owned
(`focus_inferences`); decisions become durable and reconciliation-owned
(`detour_dispositions`, `decision_queue`); and when a decision means *new plan
content*, the dashboard writes the human-owned file itself
(`AGENT-PLAN.md`) — atomically, sanitized, optimistically locked against a
concurrent human edit, and then re-ingested through the exact same
`ingestPlanForCwd` every other trigger already uses, so `plan_items` still has
exactly one writer and a dashboard-authored item is indistinguishable from one
Sara typed.

**Why that last clause is the whole design.** Item identity in this system is
the `id:` line, not authorship. `deletePlanItemsNotIn` (`server/db.js:2183`)
only runs *inside* the transaction that follows a `content_hash` mismatch, and
it deletes by `item_id` absence from the file — so a well-formed block with a
synthesized `id:` line survives every subsequent ingest exactly as a
hand-typed one does. No `plan_items.origin` column, no ingest awareness of
provenance, and no "dashboard-owned row" concept is needed or wanted.

**Effort:** Layer 5 = M (low). Layer 4 = **L, high end** (was M under
advisory-only; DEC-2 took it to L, DEC-13's auto-write took it to the high end
of L). Layer 6 = L (unchanged). Layer 4 is now the largest single slice of this
effort, which inverts the original sequencing intuition — see §4's build-order
note under the Layer 4 heading.

### Overrides I am making

**Override 1 — the engineer's `plan-ingest.js` `target:` parser is dropped
(decisions.md DEC-10).** The engineer's layer-5 change set proposes a
`TARGET_LINE_RE` in `plan-ingest.js` plus adding `target_date` to
`upsertPlanItem`'s INSERT column list, its `ON CONFLICT … SET` clause, and the
positional argument list at every call site. **Do not implement that.** A field
carried in that `SET` clause is overwritten from the file on *every* ingest —
so any reformat or edit of `AGENT-PLAN.md` silently resets the target date,
which is the exact opposite of the `declared_done_at` protection this field is
meant to mirror. It also deletes the engineer's own highest-probability bug in
this layer (prepared-statement `?` positions desyncing from the call site's
argument list) by never touching that statement at all. `target_date` is
authored out-of-band, exactly like `declared_done_at`.

This override survives the Layer 4 redesign unchanged: `plan-writeback.js`
adds **exports only** to `plan-ingest.js` (regexes + caps), never a new parse
rule and never a new `upsertPlanItem` column.

**Override 2 — Layer 4 writes the real file; the advisory-only design and
DEC-12's inverted test spec are both superseded (decisions.md DEC-2, DEC-13;
DEC-12 now SUPERSEDED).** The previous version of this section argued
advisory-only on the grounds that a DB-only plan item cannot survive
`deletePlanItemsNotIn`. That reasoning was correct *about a DB-only item* and
is not a reason against writing the file: a real, well-formed
`AGENT-PLAN.md` block with an `id:` line survives ingest by construction.
Sara chose write-back knowing the cost. Therefore:

- `fold_in` → `appendSubItem` under the parent item; `new_item` →
  `appendPlanItem` at end of file. Both write real bytes.
- **Never** a direct `plan_items` insert. `ingestPlanForCwd` remains the sole
  writer of `plan_items`/`plans` — including for our own writes.
- **Auto-write, both trigger points.** DEC-13 = A means the write fires the
  instant the disposition is decided: unattended from the Layer 6 LLM pass
  **and** synchronously inside the human `POST /api/detours/:id/resolve`
  request. A human clicking resolve is not a separate, gentler path — it is
  the second of the two DEC-13 trigger points.
- **The sanitizer is mandatory, not a mitigation to remember.** With no human
  reading the exact text before it lands, `sanitizeLlmPlanText()` is the only
  thing standing between an LLM classification and Sara's stakeholder-facing
  plan file. It ships as its own exported, independently unit-tested function.
- QA's Layer 4 spec reverts to its *original* direction (a `fold_in` **does**
  produce a `plan_items` row) with the mechanism corrected — see §6.

**Override 3 — test templates follow the engineer's correction, not pm.md's
citation (decisions.md DEC-11).** `session-liveness.test.js` is the wrong
structural template (it tests a synchronous `ps`/`lsof` probe, not a scheduled
loop). Scheduler and fixed-rule tests copy `server/__tests__/focus-audit.test.js`;
LLM-half tests copy `server/__tests__/focus-summary.test.js`.
`session-liveness.js` stays the citation for the *fail-safe contract*, not for
test shape. For Layer 4's new concurrency tests there is **no** in-repo
template — the injected-seam discipline of `focus-summary.test.js` is the
closest analogue and is mandated in §6 (`__injectPreRenameHookForTest`), but no
existing spec in this repo retries a file write against a human's concurrent
edit.

**Override 4 — kill switches: both, with precedence (decisions.md DEC-9).**
The architect leaned toward reusing `DASHBOARD_FOCUS_INFER_MODE`; the engineer
proposed a new `DASHBOARD_RECONCILE_MODE`. Ship a new
`DASHBOARD_RECONCILE_MODE` **that additionally honors**
`DASHBOARD_FOCUS_INFER_MODE=off` for its LLM half only. Reconciliation can be
disabled without disabling session classification; disabling the focus-infer
LLM still stops every spawn everywhere, while the deterministic rule half keeps
running (it never calls an LLM by design).

**Override 5 (new, this revision) — one write path, one composer, one set of
column names (decisions.md DEC-14).** Three small conflicts across the three
revision sections are resolved as follows, and the losing spellings must not
appear in the code:
- The disposition→write orchestration lives **only** in
  `plan-writeback.js`'s `applyDisposition()`. Neither `routes/detours.js` nor
  `reconciliation.js` may compose its own write sequence — two hand-written
  copies of "sanitize, dispatch, audit, retry, escalate" is
  §9.1 DERIVED-DUAL-VIEW on the write path.
- The markdown block is composed **only** inside `plan-writeback.js`. The
  advisory-era `detours.buildPlanSnippet()` is **dropped from the change set**;
  `detour_dispositions.suggested_markdown` survives as a column but is now
  written by `plan-writeback.js` with *the exact block that was attempted*, so
  a `writeback_conflict` queue entry can show Sara what we tried to add.
- The forward pointer from a disposition to the plan item it created is
  **`resolved_item_id`** (the engineer's spelling, holding
  `plan_items.item_id`). QA's revision calls it `linked_plan_item_id` and
  stores the integer PK; that spelling is **not** used. `item_id` is the stable
  identity in this schema — the integer PK is not stable across the
  rename-rebuild dances `plan_items` has already been through.
- The disposition's own lifecycle is expressed as `disposition` (the verdict) +
  `write_status` (the file-write audit) + `resolved_at`. QA's revision refers
  to a `status: proposed → resolved`; read that as
  `write_status: 'pending' → 'written'` with `resolved_at` stamped only on a
  successful write.

### Structural non-negotiables carried from the PM

1. **The hybrid split is structural.** `evaluateRules()` contains **zero** LLM
   calls and completely determines the escalation set; only what it returns may
   reach `classifyFlaggedDetours()`. One-directional call, two separately
   exported functions, enforced by a test that stubs the spawn seam to throw.
2. **Fail-safe per stage, not one top-level try/catch** — matching
   `session-liveness.js`'s stated contract. Rule evaluation, LLM
   classification, file write-back, and each persistence write each no-op
   independently and leave prior state untouched.
3. **§9.1 DERIVED-DUAL-VIEW by construction** — pace status, disposition,
   queue entries, **and the write sequence** are each computed/performed by
   exactly one exported function, on day one, before a second consumer exists.
4. **§9.2 row-id-as-chronology-proxy** — every "recent detours / recent
   sessions" query sorts `ORDER BY created_at …, id …` with the sort **before**
   any `LIMIT`.
5. **Cost control by design** — zero spawns on a tick where the rules flag
   nothing; digest gating so an unchanged flagged set is not re-classified; one
   batched prompt per cwd, not one per detour.
6. **One writer of `plan_items`** — `ingestPlanForCwd`, forever. The write-back
   module mutates bytes on disk and then calls it; it never touches
   `upsertPlanItem`.

---

## 3. Change set

### Layer 5 — pace tracking (build first)

| File | Change |
|---|---|
| `server/db.js` | Add `target_date TEXT` to the `plan_items` `CREATE TABLE` block (~L571-586) **and** a sibling `try/SELECT/catch/ALTER` migration block for existing DBs. Extend the schema comment above the table (~L551-570). Add `setPlanItemTargetDate` prepared statement next to `setPlanItemDeclaredDone` (~L2186). Add a comment to `upsertPlanItem` (~L2137-2141) naming `target_date` alongside `declared_done_at` as deliberately excluded. |
| `server/lib/pace.js` | **New file.** The single shared pace computation: `paceStatus(item, opts)`, `isComplete(item)`, `localDayString(date)`. Pure, no DB, no I/O. |
| `server/routes/plans.js` | New `POST /api/plans/items/target` — sets/clears one item's target date, broadcasts `plan_updated`. |
| `bin/ccam.js` | New `focus target` subcommand: entry in `COMMAND_GROUPS` ("Plan & Focus" group), entry in `SUBCOMMANDS.focus`, handling inside `cmdFocus`. |
| `server/openapi-extra/misc.js` | OpenAPI entry for the new route (this repo documents routes there). |

### Layer 4 — detour disposition + real plan write-back (build second)

Rewritten 2026-08-01 per DEC-2/DEC-13. Grouped by sub-layer, because the build
order inside Layer 4 matters (see §4's build-order note).

**(a) Write-path plumbing — buildable and testable with no Layer 4 schema at
all:**

| File | Change |
|---|---|
| `server/lib/atomic-file.js` | **New file.** `atomicWriteFile(filePath, content)` extracted **verbatim** from `server/lib/cc-mutate.js:218-247` (tmp file in the same dir → best-effort `fsync` → `renameSync`, tmp unlinked on every failure path). Pure move, no behavior change. |
| `server/lib/cc-mutate.js` | Delete the local `atomicWriteFile` definition; `const { atomicWriteFile } = require("./atomic-file");`. Its two call sites (`:286`, `:437`) are unchanged. It never exported the function (`module.exports` at `:527-535`), so this is an internal refactor with **zero** external API change. |
| `server/lib/plan-ingest.js` | **Exports only — no behavior change, no new parse rule.** Add to `module.exports` (`:438-445`): `ID_LINE_RE`, `ACCEPTANCE_LINE_RE`, `DETAIL_LINE_RE` (module-scope consts at `:85-87`) and the caps `MAX_FILE_BYTES`, `MAX_ITEMS`, `MAX_TEXT_LEN`, `MAX_ACCEPTANCE_LEN`, `MAX_DETAIL_LEN` (`:61-66`). Optionally one pure helper `findItemLineRange(lines, itemId)` if the parent-block boundary lookup cannot be expressed cleanly off `parsePlanMarkdown`'s output — but **no second regex pass** may live in `plan-writeback.js`. |
| `server/lib/plan-writeback.js` | **New file.** `sanitizeLlmPlanText(input, maxLen)`, `appendPlanItem(dbModule, opts)`, `appendSubItem(dbModule, opts)`, `applyDisposition(dbModule, dispositionId, opts)`, `__injectPreRenameHookForTest(fn)`. Owns *how to safely mutate the bytes of `AGENT-PLAN.md`* and nothing else: it never re-derives the file's syntax (imports `parsePlanMarkdown`) and never writes `plan_items` (calls `ingestPlanForCwd`). |

**(b) Disposition schema + module:**

| File | Change |
|---|---|
| `server/db.js` | New `CREATE TABLE IF NOT EXISTS detour_dispositions` + indexes, in the same `db.exec` block as `focus_inferences` (~L626-639) — **including the write-audit and proposed-content columns from the start** (see §4 step 15 and WATCH-4/DEC-15: `CHECK`ed enums are rebuild-to-widen, so `write_status`'s CHECK must not be a follow-up `ALTER`). New prepared statements: `upsertDetourDisposition`, `listDetourDispositions`, `getDetourDisposition`, `resolveDetourDisposition`, `listPendingDetours`, `listStaleResolvedDetours`, `markDetourWritePending`, `markDetourWriteResult`. |
| `server/lib/detours.js` | **New file.** `recordInferredDetour()`, `backfillDeclaredDetours()`, `resolveDisposition()`, `DISPOSITIONS` enum. Owns every read/write of `detour_dispositions` **except** the write-audit columns, which `plan-writeback.js`'s `applyDisposition` owns. `buildPlanSnippet()` is **removed** from this module's API (Override 5) — markdown composition now lives only in `plan-writeback.js`. |
| `server/lib/focus-inference.js` | In `inferSession` (~L473-530), **after** the existing `upsertFocusInference.run(...)`, add a self-contained `try { require("./detours").recordInferredDetour(dbModule, row, result); } catch {}` guarded to `result.kind === "detour"`. No other change — the classifier stays the only writer of `focus_inferences`, and it never triggers a file write (recording a detour is not deciding one). |
| `server/routes/detours.js` | **New file.** `GET /api/detours`, `POST /api/detours/:id/resolve` — the latter calls `applyDisposition` synchronously for `fold_in`/`new_item` (DEC-13 trigger point #2) and returns the write outcome in the response body. |
| `server/index.js` | Mount `app.use("/api/detours", detoursRouter)` in the router block (~L98-127). |
| `server/openapi-extra/misc.js` | OpenAPI entries for both new endpoints, including the write-outcome fields in the resolve response. |

`server/lib/focus-commands.js` is **not** changed — declared detours already
have a durable identity (their `events` row) and are picked up by
`backfillDeclaredDetours()` as a consumer.

### Layer 6 — reconciliation pass (build last)

| File | Change |
|---|---|
| `server/db.js` | New `CREATE TABLE IF NOT EXISTS decision_queue` + index, with `kind` widened at creation time to include `writeback_conflict` and `writeback_failed` (WATCH-4/DEC-15 — do not add these later). New prepared statements: `insertDecisionQueueItem`, `listDecisionQueue`, `getDecisionQueueItem`, `resolveDecisionQueueItem`, `findOpenQueueItem`. |
| `server/lib/reconciliation.js` | **New file.** `startReconciliation(broadcast)`, `reconcileCwd()`, `evaluateRules()`, `classifyFlaggedDetours()`, `buildDispositionPrompt()`, `parseDispositionOutput()`, `computeFlaggedDigest()`, `listReconcileTargets()`. Calls `plan-writeback.applyDisposition` for `fold_in`/`new_item` verdicts (DEC-13 trigger point #1) and owns the resulting `broadcast("plan_updated", …)`. |
| `server/routes/decision-queue.js` | **New file.** `GET /api/decision-queue`, `POST /api/decision-queue/:id/resolve` with actions `resolve` \| `dismiss` \| `retry_write`. |
| `server/index.js` | Mount `app.use("/api/decision-queue", decisionQueueRouter)`; start the scheduler in `startBackgroundServices()` next to `startFocusAudit`/`startFocusInference` (~L400-421), inside its own `try/catch` with the same `console.warn` shape. |
| `bin/ccam.js` | New top-level `decisions` command (list + `ack` + `dismiss` + `retry`): `COMMAND_GROUPS` entry, `SUBCOMMANDS.decisions`, `runCommand` case, `cmdDecisions()`. |
| `server/openapi-extra/misc.js` | OpenAPI entries for both new endpoints. |

### Docs (end of the change set, per CLAUDE.md's `update-project-docs` trigger)

`ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `server/README.md`
(schema + WebSocket + CLI sections), plus the **DEC-8** close-out edits to
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/pm.md` and the two
auto-memory entries.

**`ARCHITECTURE.md` and `server/README.md` additionally need the write-back
statement corrected**: `plan-ingest.js`'s own header states the dashboard never
writes `AGENT-PLAN.md`. That is no longer true. Update that header comment and
every doc claim derived from it to the accurate form: *the file is still the
single source of truth and still human-owned; the dashboard now appends to it
through one audited path, and reads it back through the same ingest as always.*
Leaving the old claim in place would make the code's own documentation actively
misleading about a trust boundary.

**No client changes.** See decisions.md **WATCH-3**.

---

## 4. Implementation steps

Each step is independently checkable. Do not start a layer before the previous
layer's tests are green and Sara has seen it (**DEC-3**).

### Step 0 — baseline

1. On a clean checkout of the target branch, run `npm run test:server` and
   `npm run test:client` and record the result. The working tree currently
   carries unrelated uncommitted work (`usage-captures-db`, `accounts`,
   `usage-fetch-oauth`); isolate this effort's diff before attributing any
   failure to it.
2. **DEC-2, DEC-5 and DEC-13 are answered** (B / A / A respectively) — no
   longer gating. Confirm before starting that no *further* PENDING row in
   `decisions.md` gates the layer you are about to build; DEC-14 and DEC-15 are
   tech-lead calls recorded there, and WATCH-7/8/9 are the accepted residual
   risks of the write-back design.

### Layer 5 — pace tracking

3. **Schema, both halves (the sibling-pair rule).** In `server/db.js`, add
   `target_date TEXT` to the `plan_items` `CREATE TABLE IF NOT EXISTS` block
   (after `declared_done_session`) **and** add the migration for existing DBs
   after the plan_items rebuild + unique-index block (~L789), using this file's
   established probe idiom (the `agents.workflow_run_id` block at ~L794-799 is
   the model):
   ```js
   // Migrate: give plan_items an optional human-set target date (layer 5 pace
   // tracking). Date-only YYYY-MM-DD, local calendar day. Additive and
   // nullable — no rename-rebuild needed (that dance exists only for NOT NULL
   // / PK changes SQLite can't ALTER). Deliberately NOT written by
   // upsertPlanItem, so it survives re-ingest exactly like declared_done_at.
   try {
     db.prepare("SELECT target_date FROM plan_items LIMIT 1").get();
   } catch {
     db.prepare("ALTER TABLE plan_items ADD COLUMN target_date TEXT").run();
   }
   ```
   A new column is **always** added in both places in this file
   (`item_id`, `parent_item_id`, `workflow_run_id`, `cache_write_1h_per_mtok`,
   `intro_until` all did) — a fresh install reads the `CREATE TABLE`, an
   upgrading install reads the `ALTER`, and they must agree.
4. **Do not touch `upsertPlanItem`'s SQL** beyond extending its existing
   comment to read "…so declared_done_at and target_date (deliberately
   untouched below) survive." This is the whole point of DEC-10.
5. Add the out-of-band writer next to `setPlanItemDeclaredDone` (~L2186):
   ```js
   setPlanItemTargetDate: db.prepare(
     "UPDATE plan_items SET target_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cwd = ? AND item_number = ?"
   ),
   ```
   Passing `null` clears it.
6. **Write `server/lib/pace.js`** — the single shared computation (§9.1). File
   header with the exact `@author Son Nguyen <hoangson091104@gmail.com>` line
   per `.claude/rules/file-headers.md`. Pure functions, `now` injectable:
   - `localDayString(date)` → `YYYY-MM-DD` in local time (`en-CA` formatting).
   - `isComplete(item)` → per **DEC-5**: `{ complete, signal }` where
     `signal` is `"checked" | "declared" | null`; complete when
     `item.checked === 1` **or** `item.declared_done_at` is set.
   - `paceStatus(item, { now = new Date(), graceDays = 0 } = {})` →
     `{ status, target_date, days_overdue, completed_signal }` with `status` in
     **`no_target` | `on_track` | `behind` | `done`**, resolved in this order:
     1. `isComplete(item).complete` → `done` (a completed item is **never**
        `behind`, however late — QA's rule).
     2. no `target_date`, or a value not matching `/^\d{4}-\d{2}-\d{2}$/`, or
        not a real calendar date → `no_target` (**never** `behind` — an
        unparsed value must not manufacture an alarm).
     3. `localDayString(now) > target_date` by more than `graceDays` days →
        `behind`, with `days_overdue` set.
     4. otherwise → `on_track`. **Boundary pinned per DEC-6:**
        `target_date === today` is `on_track`; `behind` starts the next local
        day.
   Nothing else in the codebase may re-implement this test — layer 6 calls it.
7. **Route.** In `server/routes/plans.js`, add
   `POST /api/plans/items/target` with body `{ cwd, item_number, target_date }`.
   Validate per `.claude/rules/backend-node.md`: `cwd` a non-empty string,
   `item_number` a positive integer, `target_date` either `null` or a
   `YYYY-MM-DD` string that parses to a real date — structured `400
   { error: "…" }` otherwise; `404` when `getPlanItem` finds no row. On
   success run `setPlanItemTargetDate`, then broadcast using the **existing**
   message type and payload shape (`server/lib/focus-commands.js:403` is the
   precedent): `broadcast("plan_updated", { plan, items: stmts.listPlanItems.all(cwd) })`.
   Do not invent a new WebSocket message type for this.
8. **CLI.** Add `focus target` in `bin/ccam.js`: one entry in `COMMAND_GROUPS`'
   "Plan & Focus" group (`["focus target <n>", "<YYYY-MM-DD> | --clear",
   "Set or clear a plan item's target date (pace tracking)"]`), add `"target"`
   to `SUBCOMMANDS.focus`, and handle the verb inside `cmdFocus` reusing its
   existing session/cwd resolution. See §5 — `COMMAND_GROUPS` is this repo's
   canonical command registry and every derived surface reads from it.
9. **Tests** (`server/__tests__/pace-tracking.test.js`, new) — see §6.
10. Run `npm run test:server`. **Checkpoint: show Sara.** Layer 5 alone already
    answers "which items are behind" from the CLI.

### Layer 4 — detour disposition + real plan write-back

> **Build-order note (new, this revision).** Layer 4 is now the heaviest slice,
> not the middle one. Build it in the sub-order (a) → (b) → (c) below: the
> write-path plumbing (steps 11–14) has **no dependency on
> `detour_dispositions` existing at all** — `appendPlanItem`/`appendSubItem`/
> `sanitizeLlmPlanText` take plain
> `{ cwd, text, acceptance, detail, expectedHash }` arguments — so it can be
> built, fully tested, and merged before the disposition schema is finalized.
> This gives Sara a fourth judgeable checkpoint at the exact place the risk
> actually concentrates (writing her file), instead of bundling it into a
> single large Layer 4 review.

#### (a) Write-path plumbing — steps 11–14, merge as its own commit(s)

11. **Extract `atomicWriteFile` first — its own commit.** Create
    `server/lib/atomic-file.js` with the mandatory file header and the function
    moved verbatim from `server/lib/cc-mutate.js:218-247`. In `cc-mutate.js`,
    delete the local definition and `require` it instead. **Nothing else in
    this commit.** Then run `node --test server/__tests__/cc-config.test.js`
    (the existing coverage of `cc-mutate.js`'s `writeArtifact`/backup path)
    before touching anything else — a regression here must be caught in
    isolation from the much larger write-back change. Note for expectations:
    the primitive itself has **no direct test coverage today** (QA confirmed no
    `cc-mutate.test.js` exists); the extraction is the first point it gets
    tested at all (see §6).
12. **Additive exports in `server/lib/plan-ingest.js`.** Add `ID_LINE_RE`,
    `ACCEPTANCE_LINE_RE`, `DETAIL_LINE_RE`, `MAX_FILE_BYTES`, `MAX_ITEMS`,
    `MAX_TEXT_LEN`, `MAX_ACCEPTANCE_LEN`, `MAX_DETAIL_LEN` to the
    `module.exports` block at `:438-445`. No other change to this file. Also
    update this file's header comment, which currently asserts the dashboard
    never writes `AGENT-PLAN.md` — it now does, through `plan-writeback.js`,
    and the header must say so and name that module.
13. **Write `server/lib/plan-writeback.js`** (new, mandatory file header). Four
    exported functions plus one test seam.

    **(i) `sanitizeLlmPlanText(input, maxLen)` — mandatory per DEC-13.**
    Collapse all `\r`/`\n` runs to a single space, collapse whitespace, trim,
    strip a leading `id:`/`acceptance:`/`detail:` prefix if the result still
    matches one of `plan-ingest.js`'s own field regexes, then `slice(0, maxLen)`.
    Never throws; non-string input returns `""` so a caller can uniformly treat
    empty as "nothing to write" rather than composing a partial block.
    The engineer's revision carries a design-grade sketch of this function —
    it is a sketch, not verified-running code; write it against the tests in
    §6, not by pasting the sketch.
    **Rationale to keep in the code comment:** `parsePlanMarkdown` treats a
    further-indented line after a checkbox item as a *continuation* of it, so a
    multi-line string is the entire mechanism by which LLM output could forge a
    structural `id:`/`acceptance:`/`detail:` line inside a human-owned file.
    Collapsing newlines removes that mechanism; the prefix strip is defense in
    depth.
    **Call it per field, never on the composed block** — sanitizing after
    joinery is too late, because a forged line could already span what should
    have been two separate fields. Each field gets its own cap
    (`MAX_TEXT_LEN` / `MAX_ACCEPTANCE_LEN` / `MAX_DETAIL_LEN`), imported from
    `plan-ingest.js`, never hand-copied numbers.

    **(ii) `appendPlanItem(dbModule, { cwd, text, acceptance, detail, expectedHash })`**
    (new top-level item, appended at end of file) and
    **`appendSubItem(dbModule, { cwd, parentItemId, text, acceptance, detail, expectedHash })`**
    (inserted immediately after the parent's own block — its checkbox line plus
    its existing continuation/sub-item lines — so `SUBITEM_RE`'s "parent must
    already be seen" precondition holds regardless of where the parent sits).
    Both follow this exact sequence:
    1. **Acquire the per-cwd mutex** — a `Map<cwd, Promise>` chain inside this
       module. Two dispositions applied in the same reconciliation tick, or a
       tick racing a manual API call, would otherwise both read the same
       "before" bytes and only one write would survive. **Key the map on the
       byte-identical `cwd` string** `ingestPlanForCwd`/`getPlanByCwd` use —
       neither normalizes with `path.resolve`, so a trailing-slash difference
       between call sites would silently unserialize two writes to the same
       file. Release in a `finally`.
    2. **Read the file fresh** (`fs.readFileSync` at
       `path.join(cwd, PLAN_FILENAME)`, **not** the DB's cached
       `content_hash`) and hash it → `hashBefore`. Missing file →
       `{ ok:false, code:'NO_PLAN_FILE' }`. **Never synthesize a plan file** —
       decisions.md **WATCH-7**.
    3. **Cheap pre-check:** if the caller passed `expectedHash` and it differs
       from `hashBefore` → `{ ok:false, code:'CONFLICT', currentHash }`, before
       any parsing or composition work.
    4. **`parsePlanMarkdown`** (imported) for the current max top-level number,
       the full existing id set, and the parent's block boundaries. **No second
       regex pass may be hand-rolled here** — `plan-ingest.js` stays the only
       owner of what this file's syntax means; `plan-writeback.js` only owns
       how to safely mutate bytes.
    5. **Mint the new `id:`** via `crypto.randomBytes(4).toString("hex")` —
       **not** `fallbackItemId`, whose deterministic cwd+number hash exists to
       *infer* ids for pre-existing unlabeled items and could collide with one
       a future ingest independently derives. Regenerate on collision against
       the freshly parsed id set.
    6. **Sanitize each field independently, then compose** the markdown block.
       This module is the only composer (Override 5).
    7. **Pre-flight the reader's caps as a writer:** if appending would push
       the file past `MAX_ITEMS` or `MAX_FILE_BYTES` →
       `{ ok:false, code:'CAPS_EXCEEDED' }` and write nothing. Skipping this
       means `parsePlanMarkdown` silently drops the new item (or the whole
       ingest skips on the size guard) on the very next read — a write that
       "succeeded" and then invisibly didn't.
    8. **Timestamped backup** to
       `<cwd>/.claude/agent-plan-backups/AGENT-PLAN.<timestamp>.bak.md`,
       mirroring `cc-mutate.js`'s "always back up before mutating a human-owned
       file" rule. It lives outside the cwd root so it can never be mistaken
       for a second live plan and `PLAN_FILENAME`'s fixed lookup never sees it.
       Retention is **not** solved here — decisions.md **WATCH-8**.
    9. **Fire `__injectPreRenameHookForTest`'s hook if set**, then **re-read and
       re-hash the file and compare to `hashBefore`.** Changed → a human's
       concurrent edit landed in the window; abort with
       `{ ok:false, code:'CONFLICT', currentHash }` rather than clobbering it.
       *This* is the optimistic lock; the cheap pre-check in sub-step 3 is only
       a pre-filter. The residual gap between this re-check and the rename is
       real and accepted — decisions.md **WATCH-9**.
    10. **Atomic write** via `atomic-file.js` (temp → fsync → rename), so the
        poller, the `SessionStart` hook, and any human-side editor always see
        either the fully-old or the fully-new file, never a torn write.
    11. **Call the real `ingestPlanForCwd(dbModule, cwd)` in-process.** This
        module never calls `upsertPlanItem`/`upsertPlan`. The `{ changed, plan,
        items }` shape comes back to the caller, who owns
        `broadcast("plan_updated", …)` per `plan-ingest.js`'s existing
        "the CALLER owns broadcasting" contract (`plan-ingest.js:46`) — no new
        broadcast contract, no new message type.
    12. Return
        `{ ok:true, itemId, hashBefore, hashAfter, backupPath, markdown, plan, items }`.
        **These functions never throw** — every failure is a structured `{ ok:false, code }`
        with `code` in `CONFLICT` | `CAPS_EXCEEDED` | `NO_PLAN_FILE` | `IO_ERROR`.

    **(iii) `__injectPreRenameHookForTest(fn)`** — the deterministic seam that
    fires between sub-step 2's read and sub-step 9's re-check, mirroring
    `focus-inference.js`'s `__injectSpawnForTest`. This exists so the conflict
    tests are synchronous and deterministic instead of timing-dependent races.

    **(iv) `applyDisposition(dbModule, dispositionId, { broadcast, retried })`**
    — the single orchestration path both DEC-13 trigger points call. It:
    - loads the `detour_dispositions` row;
    - stamps `write_status='pending'` + `write_attempted_at`
      (`markDetourWritePending`);
    - dispatches on `disposition`: `fold_in` → `appendSubItem` under
      `proposed_parent_item_id`; `new_item` → `appendPlanItem`;
      `deliberate`/`discard` → **no file write at all**, resolve the row and
      return;
    - for the unattended path, derives `expectedHash` itself from
      `stmts.getPlanByCwd.get(cwd).content_hash` immediately before the call
      (there is no "what the human last saw"); for the human-resolve path, uses
      the hash the caller passes through from what was displayed;
    - writes the outcome back onto the same row in **one** statement
      (`markDetourWriteResult`: `write_status`, `write_completed_at` /
      `write_error`, `resolved_item_id`, `suggested_markdown`,
      `write_backup_path`, `write_content_hash_before` /
      `write_content_hash_after`, `resolved_at`) so a partial update can never
      leave the row half-consistent;
    - owns the **retry-once-then-escalate** policy (below). The policy lives
      here, not inside `appendPlanItem`/`appendSubItem`, so the low-level
      functions stay simple and independently testable;
    - is **idempotent**: a disposition already at `write_status='written'` is a
      no-op returning the existing `resolved_item_id`. Re-dispatch must not
      call the write path a second time at all — a second unnecessary file
      write is itself a regression under DEC-13's framing.

    **Failure policy (one place, never duplicated into the two callers):**
    | Outcome | Action |
    |---|---|
    | `CONFLICT` (either kind), first attempt | **Retry exactly once**, immediately, in-process, with a **fully fresh** read and re-derived hash — no reused `expectedHash`. A single transient race against an editor autosave is the expected shape, and `ingestPlanForCwd`'s own hash-match no-op makes the retry cheap. |
    | `CONFLICT` on the retry | **Stop.** A third attempt risks live-locking against a human's editor. Set `write_status='conflict'`, leave `resolved_item_id` NULL and `resolved_at` NULL, and insert a `decision_queue` row `kind='writeback_conflict'`, `ref_id=<disposition id>`, `payload` = the attempted markdown + the current file hash. The *decision* is still recorded and visible; only the mechanical write didn't land. |
    | `CAPS_EXCEEDED` / `NO_PLAN_FILE` / `IO_ERROR` | **No retry** — the cause is not transient. Straight to `write_status='failed'` + a `decision_queue` row `kind='writeback_failed'` on the first attempt. |
    | `NO_PLAN_FILE` specifically, from the unattended path | Should be **unreachable**: `reconciliation.js` must filter `plans.missing_at` and zero-item cwds *before* the LLM step (WATCH-2 composition — see step 23(a)). Keep the guard anyway, but the invariant is enforced upstream, in one place. |

14. **Tests for the plumbing** (`server/__tests__/plan-writeback.test.js` +
    atomic-file baseline coverage) — see §6. Run `npm run test:server`.
    **Checkpoint: show Sara** — this is the commit that first writes her file.

#### (b) Disposition schema + module — steps 15–19

15. **Schema.** In `server/db.js`, in the same `db.exec` block as
    `focus_inferences`, add — with a comment block in this file's house style
    explaining the observation-vs-decision split and the naming trap
    (`focus_inferences.kind='detour'` is *inferred*;
    `session_focus.detour_stack` is *declared* — layer 4 covers both, tagged by
    `source`) — the table **including its write-audit block from the start**:
    ```sql
    CREATE TABLE IF NOT EXISTS detour_dispositions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cwd TEXT NOT NULL,
      session_id TEXT,                 -- no FK on purpose: audit trail must outlive session cleanup (same rule as alert_events.session_id)
      source TEXT NOT NULL CHECK(source IN ('inferred','declared')),
      source_ref TEXT NOT NULL,        -- inferred: sessions.id · declared: events.id
      source_seen_at TEXT,             -- the focus_inferences.inferred_at / events.created_at this record was built from
      label TEXT,
      item_id TEXT,                    -- the plan item the detour departed from, when known
      disposition TEXT NOT NULL DEFAULT 'pending'
        CHECK(disposition IN ('pending','fold_in','new_item','deliberate','discard')),
      decided_by TEXT CHECK(decided_by IN ('rule','llm','human')),
      confidence REAL,
      reason TEXT,
      note TEXT,
      -- proposed content: what the rule/LLM decided should be added. Sanitized
      -- by plan-writeback.sanitizeLlmPlanText BEFORE composition (DEC-13).
      proposed_text TEXT,
      proposed_acceptance TEXT,
      proposed_detail TEXT,
      proposed_parent_item_id TEXT,    -- fold_in only: the plan_items.item_id to nest under
      -- write audit (DEC-2 real write-back + DEC-13 auto-write). Every auto-write
      -- must be diagnosable after the fact, because no human confirmed it in the moment.
      write_status TEXT NOT NULL DEFAULT 'none'
        CHECK(write_status IN ('none','pending','written','failed','conflict')),
      write_attempted_at TEXT,
      write_completed_at TEXT,
      write_error TEXT,
      write_backup_path TEXT,
      write_content_hash_before TEXT,
      write_content_hash_after TEXT,
      suggested_markdown TEXT,         -- the EXACT block attempted, written by plan-writeback.js at compose time (not a separate snippet generator)
      resolved_item_id TEXT,           -- the plan_items.item_id this disposition produced (NULL unless write_status='written')
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_detour_dispositions_src ON detour_dispositions(cwd, source, source_ref);
    CREATE INDEX IF NOT EXISTS idx_detour_dispositions_cwd_created ON detour_dispositions(cwd, created_at);
    CREATE INDEX IF NOT EXISTS idx_detour_dispositions_resolved_item ON detour_dispositions(resolved_item_id);
    ```
    New table → `CREATE TABLE IF NOT EXISTS` only; no `ALTER` block needed
    (that pairing is required only for a new column on an **existing** table).
    **The write-audit columns and their `CHECK` must land in this initial
    `CREATE TABLE`, not as a follow-up `ALTER`** — SQLite cannot add a `CHECK`
    via `ALTER TABLE ADD COLUMN` at all, so shipping the base table first would
    cost a full rename-copy-drop rebuild for `write_status` alone
    (decisions.md **WATCH-4**, **DEC-15**). Enum widening beyond this still
    needs a rebuild — accepted.

    `resolved_item_id` + the `write_*` columns are what satisfy DEC-13's
    traceability requirement in **both** directions: from a disposition, "what
    did this decision write, and did it land?"; from a `plan_items` row,
    `SELECT * FROM detour_dispositions WHERE resolved_item_id = ?` recovers
    which detour, which classification (`decided_by`, `reason`, `confidence`),
    and when (`write_completed_at`).
16. **Prepared statements** in `server/db.js`:
    - `upsertDetourDisposition` — the durability guarantee lives here. On
      conflict it refreshes only the *observation* fields and **never** the
      decision or write-audit fields, the same deliberate-exclusion idiom
      `upsertPlanItem` uses for `declared_done_at`:
      ```sql
      INSERT INTO detour_dispositions (cwd, session_id, source, source_ref, source_seen_at, label, item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cwd, source, source_ref) DO UPDATE SET
        label = excluded.label,
        item_id = excluded.item_id,
        source_seen_at = excluded.source_seen_at
      -- disposition / decided_by / confidence / reason / note / proposed_* /
      -- write_* / suggested_markdown / resolved_item_id / resolved_at are
      -- deliberately untouched: re-inference of a session must never clobber a
      -- decision already made about it, and must NEVER cause a second file write.
      ```
    - `listPendingDetours` — `WHERE cwd = ? AND disposition = 'pending' ORDER BY created_at ASC, id ASC LIMIT ?` (§9.2: sort **before** the limit).
    - `listStaleResolvedDetours` — `WHERE cwd = ? AND resolved_at IS NOT NULL AND source_seen_at > resolved_at` — this is the architect's
      "the underlying inference changed since I decided" detector; without it
      the pass either treats stale data as still resolved or re-flags
      everything every tick. **Note:** a stale-resolved row whose
      `write_status='written'` must **not** trigger a second write — it can be
      re-surfaced for review, never re-applied. Assert this in §6.
    - `markDetourWritePending` — sets `write_status='pending'`,
      `write_attempted_at`.
    - `markDetourWriteResult` — a **single** statement setting
      `write_status`, `write_completed_at`, `write_error`, `resolved_item_id`,
      `suggested_markdown`, `write_backup_path`,
      `write_content_hash_before`/`_after`, and `resolved_at` together.
    - `listDetourDispositions`, `getDetourDisposition`,
      `resolveDetourDisposition` (sets `disposition`, `decided_by`,
      `confidence`, `reason`, `proposed_*`, `note`).
17. **`server/lib/detours.js`** (new, with the mandatory file header):
    - `DISPOSITIONS = ["fold_in","new_item","deliberate","discard"]` — the one
      place the enum is spelled, imported by the route, the reconciliation
      module, `plan-writeback.js`, and the tests, so the JS check and the SQL
      `CHECK` cannot drift.
    - `recordInferredDetour(dbModule, row, result)` — writes a `pending` row
      with `source='inferred'`, `source_ref = row.id` (the session id, matching
      `focus_inferences`' own PK), `source_seen_at = <the inferred_at just
      written>`, `label = result.label`, `item_id = result.item_id`. Never
      throws. **Never writes a file** — recording a detour is not deciding one.
    - `backfillDeclaredDetours(dbModule, cwd, sinceIso)` — reads `events` where
      `event_type='Focus'` and the parsed `data.verb` is `push`/`bug`/`feature`,
      `ORDER BY created_at ASC, id ASC` (§9.2 — `workflow-ingest.js` bulk-inserts
      events after the fact, so `id` order is not chronological), and upserts one
      `source='declared'` row per event with `source_ref = events.id`.
    - `resolveDisposition(dbModule, id, { disposition, decided_by, confidence, reason, proposed_text, proposed_acceptance, proposed_detail, proposed_parent_item_id, note })`
      — validates against `DISPOSITIONS`, records the verdict and its proposed
      content, returns the updated row. **It does not write the file** and does
      not stamp `resolved_at` for `fold_in`/`new_item` — those are
      `applyDisposition`'s to stamp, only on a successful write. For
      `deliberate`/`discard` it stamps `resolved_at` directly (nothing to
      write).
    - `buildPlanSnippet()` from the advisory design is **not** implemented
      (Override 5).
18. **Wire the classifier.** In `server/lib/focus-inference.js`'s
    `inferSession`, immediately after the existing
    `dbModule.stmts.upsertFocusInference.run(...)` call (~L517-526):
    ```js
    if (result.kind === "detour") {
      try {
        require("./detours").recordInferredDetour(dbModule, row, result);
      } catch {
        /* fail-safe: a disposition-record failure must never lose the inference */
      }
    }
    ```
    This is the engineer's ordering dependency, and it is not a style
    preference: `focus_inferences` is one upserted row per session, so a
    detour's identity does not survive re-inference — the durable record must
    be created *at classification time*, not read lazily off the table later.
    Its own `try/catch` is the per-stage fail-safe. **Note the boundary:** this
    hot path records a `pending` detour and nothing else. It must never reach
    `applyDisposition`, so classifying a session can never write `AGENT-PLAN.md`.
19. **Route** `server/routes/detours.js` (new): `GET /api/detours` with
    optional `cwd`, `project_id` (resolved through `project_paths`, the same
    join `server/routes/focus-report.js` uses), `status`
    (`pending`|`resolved`|`conflict`|`failed`), `limit` (capped);
    `POST /api/detours/:id/resolve` with
    `{ disposition, note, proposed_text?, proposed_acceptance?, proposed_detail?, target_item_id?, expected_hash? }`,
    validated against `DISPOSITIONS` with a structured `400` on anything else,
    `decided_by = 'human'`. For `fold_in`/`new_item` the handler then calls
    `applyDisposition(dbModule, id, { broadcast, expectedHash })`
    **synchronously within the request** (DEC-13's "fires immediately") and
    returns `write_status`, `resolved_item_id`, and any conflict/error in the
    response body — a human resolving by hand is not exempt from auto-write;
    DEC-13 = A was chosen precisely to include this path. Mount in
    `server/index.js`. Broadcast an **additive** new type
    `detour_disposition` with the updated row, plus the existing
    `plan_updated` type when a write landed (existing message types stay
    untouched, per `.claude/rules/backend-node.md`).

#### (c) Layer 4 verification — steps 20–21

20. **Tests** (`server/__tests__/detour-disposition.test.js`, new) — see §6.
21. Run `npm run test:server`. **Checkpoint: show Sara.** Layer 4 now gives
    every detour a resolvable state *and* closes the loop into her plan file.

### Layer 6 — reconciliation pass

> Unchanged by the DEC-2/DEC-13 fork except the two auto-write wiring points
> marked **[DEC-13]** below. (Step numbers shifted from 18–26 to 22–30 because
> Layer 4 grew; the content is otherwise as originally planned.)

22. **Schema.** New table in `server/db.js` (same block), with a comment
    explaining that it is shaped like `alert_events` but deliberately separate
    (different audience, different trust boundary, no widening of
    `alert_rules.rule_type`'s CHECK):
    ```sql
    CREATE TABLE IF NOT EXISTS decision_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cwd TEXT,
      project_id TEXT,                 -- stamped via project_paths at write time; no FK (audit trail)
      kind TEXT NOT NULL CHECK(kind IN ('pace_alert','detour_volume','detour_disposition','writeback_conflict','writeback_failed')),
      ref_id INTEGER,                  -- detour_dispositions.id when kind='detour_disposition' | 'writeback_conflict' | 'writeback_failed'
      item_id TEXT,                    -- plan_items.item_id when kind='pace_alert'
      message TEXT NOT NULL,           -- plain-language, stakeholder altitude
      payload TEXT,                    -- JSON: rule inputs + (if applicable) LLM verdict/confidence/reason + the attempted markdown and file hash for writeback_* kinds
      input_digest TEXT,               -- gates re-classification (focus-summary.js's computeInputDigest pattern)
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decision_queue_status_created ON decision_queue(status, created_at);
    ```
    **[DEC-13]** `writeback_conflict` and `writeback_failed` must be in this
    `CHECK` at creation time — WATCH-4/DEC-15 again: widening it later is a
    full rebuild.
    Statements: `insertDecisionQueueItem`, `listDecisionQueue` (`ORDER BY
    created_at DESC, id DESC` before any `LIMIT`), `getDecisionQueueItem`,
    `resolveDecisionQueueItem`, and `findOpenQueueItem` (`WHERE kind = ? AND
    ref_id IS ? AND item_id IS ? AND status = 'pending'`) — the anti-duplicate
    guard that stops the same condition re-queuing every tick.
23. **`server/lib/reconciliation.js`** (new, mandatory file header). Structure
    it so the confirmed hybrid split is enforced by the module's own shape:

    **(a) `listReconcileTargets(dbModule, limit)`** — the units of work are
    **cwds that have a plan** (`plans` joined to `plan_items`), not projects;
    `project_id` is stamped from `getProjectPathByCwd` for later rollup.
    **Skip any cwd whose `plans.missing_at` is set, and any cwd with zero plan
    items** — decisions.md **WATCH-2**'s required mitigation, so a dead or
    archived plan can never fire a false pace alarm. **[DEC-13]** This filter
    now also guards the write path: a cwd filtered out here must never reach
    the LLM-classification step, so a `fold_in`/`new_item` verdict for a
    dead/planless cwd is structurally impossible rather than caught downstream
    by `appendPlanItem`'s `NO_PLAN_FILE`. Enforce the invariant **once, here** —
    the easy way to get this half-right is to add the `missing_at` filter to the
    pace-alert branch and forget the write-back branch.

    **(b) `evaluateRules(dbModule, target, opts)` — deterministic, ZERO LLM
    calls, pure enough to unit test.** Returns
    `{ paceBreaches, detourVolume, flaggedDetours }`:
    - **R1 pace breach** — for each top-level plan item (`item_number != null`)
      call `require("./pace").paceStatus(item, { now, graceDays })`; flag when
      `status === 'behind'` and `days_overdue > DASHBOARD_PACE_GRACE_DAYS`
      (default `1`). It must call `pace.js`, never re-derive the comparison
      (§9.1, and DEC-5's "same signal" requirement).
    - **R2 detour volume** — over a lookback window
      (`DASHBOARD_RECONCILE_LOOKBACK_DAYS`, default `7`), ratio of
      detour-classified sessions to total classified sessions for the cwd.
      Flag when total sessions ≥ `DASHBOARD_DETOUR_VOLUME_MIN_SESSIONS`
      (default `5`) **and** ratio ≥ `DASHBOARD_DETOUR_VOLUME_THRESHOLD`
      (default `0.4`). Every query behind this sorts/filters by `created_at`
      (`focus_inferences.inferred_at` / `events.created_at`), never by `id`
      (§9.2).
    - **R3 which detours reach the LLM** — a pending `detour_dispositions` row
      is flagged when it has been pending longer than
      `DASHBOARD_DETOUR_PENDING_DAYS` (default `2`) **or** its cwd tripped R2,
      plus every row returned by `listStaleResolvedDetours` (the underlying
      inference changed since the decision). Capped at
      `MAX_DETOURS_PER_TICK` (default `10`). This is the whole "rules decide
      *whether*" contract: a fresh detour in a healthy project is **not**
      flagged, so a quiet project spawns nothing. **[DEC-13]** A stale-resolved
      row whose `write_status='written'` may be re-surfaced for review but must
      never be re-applied — no second file write for the same disposition.

    **(c) `classifyFlaggedDetours(dbModule, target, flagged)` — LLM only, and
    only ever called with what (b) returned.**
    - Skip entirely if `flagged.length === 0`, if `DASHBOARD_RECONCILE_MODE`
      is `off`, if `DASHBOARD_FOCUS_INFER_MODE === 'off'` (DEC-9), or if
      `probeClaudeCli()` is false. Each is a no-op, not an error.
    - `computeFlaggedDigest(flagged)` — sha1 over the sorted
      `[id, source_seen_at, label]` triples, mirroring `focus-summary.js`'s
      `computeInputDigest`. If an open `decision_queue` row for this cwd
      already carries the same digest, **do not spawn**.
    - **One** `runClaudePromptJson(buildDispositionPrompt(...))` call for the
      whole batch — imported from `server/lib/focus-inference.js`, which
      already owns the hermetic contract (hooks disabled, all tools
      disallowed, `cwd = os.tmpdir()`, kill timer). **Do not write a third
      `claude -p` invocation path**; `focus-audit.js` and `focus-summary.js`
      both deliberately avoid that. Tests therefore stub
      `require("../lib/focus-inference").__injectSpawnForTest`.
    - The prompt asks **only** "which of `fold_in` / `new_item` /
      `deliberate` / `discard` is each of these detours, and why" — it must
      never be asked whether something should be escalated. For
      `fold_in`/`new_item` it additionally returns the proposed item text
      (and optional acceptance/detail), which becomes `proposed_*` on the
      disposition row and is sanitized by `plan-writeback.js` before it ever
      reaches the file.
    - `parseDispositionOutput(stdout, flagged)` — same defensive posture as
      `parseWindowSummaryOutput`: unparseable JSON, a missing field, an unknown
      5th value, or an id not in `flagged` yields `null` for that entry. Never
      guess a disposition from garbage.

    **(d) Persistence — per-verdict, each in its own try/catch:**
    - `deliberate` / `discard` with `confidence >=
      DASHBOARD_DETOUR_CONFIDENCE_MIN` (default `0.6`) → resolve the
      disposition quietly (`decided_by='llm'`, `resolved_at` set). **No
      decision-queue row, no file write** — this is the "resolve everything
      else quietly" half of the ask.
    - **[DEC-13]** `fold_in` / `new_item` with sufficient confidence → record
      the verdict via `detours.resolveDisposition` (`decided_by='llm'`, with
      `proposed_text`/`proposed_acceptance`/`proposed_detail`/
      `proposed_parent_item_id`), then **immediately call
      `plan-writeback.applyDisposition(dbModule, id, { broadcast })`
      in-process — no route hop.** This is the first and primary of DEC-13's
      two trigger points: the write is unattended. `reconciliation.js` owns the
      resulting `broadcast("plan_updated", …)`, exactly as `startPlanPoll` and
      the `SessionStart` hook already do for every other ingest trigger. On a
      successful write, **no** `decision_queue` row is created — the loop is
      closed, and the audit lives on the disposition row. On
      `conflict`/`failed`, `applyDisposition` itself enqueues the
      `writeback_conflict` / `writeback_failed` row. *(This replaces the
      advisory-only behavior in the previous version of this plan, where these
      verdicts left `resolved_at` NULL and waited for Sara to ack a snippet.)*
    - Low confidence, or a `null` from `parseDispositionOutput` → leave the
      disposition `pending`, **write nothing to the file**, and enqueue a queue
      row with `payload.needs_review = true`. Never a guessed verdict, and
      never an unattended write behind one.
    - R1/R2 flags → `pace_alert` / `detour_volume` queue rows with a plain-
      language `message` and the rule inputs in `payload`, guarded by
      `findOpenQueueItem` so a still-unfixed condition does not re-queue every
      tick.

    **(e) `startReconciliation(broadcast)`** — copy
    `focus-audit.js`'s `startFocusAudit` (~L310-347) almost verbatim:
    `DASHBOARD_RECONCILE_MODE` (`on`|`off`, default `on`) early-return;
    `DASHBOARD_RECONCILE_MS` (default `14_400_000` = 4h) with a finite/positive
    guard; a boot-delay `setTimeout` (matching `startFocusInference`'s backfill
    tick); an unref'd `setInterval`; a module-scope `running` overlap guard;
    serial iteration over at most `MAX_TARGETS_PER_TICK` (default `10`) cwds;
    a `try/catch` per cwd so one bad project cannot stop the tick. Export
    `reconcileCwd` so tests trigger it directly instead of waiting on a real
    timer (the same seam `livenessReap`/`auditSession` already provide).
24. **Wire it** in `server/index.js`'s background-services block, next to
    `startFocusAudit`/`startFocusInference` (~L400-421), inside its own
    `try { … } catch (err) { console.warn("reconciliation failed to start:", err.message); }`.
25. **Route** `server/routes/decision-queue.js` (new):
    `GET /api/decision-queue?status=&project_id=&cwd=&limit=` returning rows
    with `payload` parsed, and
    `POST /api/decision-queue/:id/resolve { action, note }` where `action` is
    `resolve`, `dismiss`, or **[DEC-13]** `retry_write`. When the row is
    `kind='detour_disposition'`, the same call also resolves the linked
    `detour_dispositions` row with `decided_by='human'` — in one transaction,
    so the two tables can never disagree. `retry_write` (valid only for
    `kind='writeback_conflict'`/`'writeback_failed'`) re-invokes
    `applyDisposition` with a **fresh** optimistic check — never a stale
    `expectedHash` carried over from the failed attempt — and returns the new
    outcome. Mount in `server/index.js`; broadcast additive
    `decision_queue_updated`.
26. **CLI.** `ccam decisions` (list pending), `ccam decisions ack <id>` /
    `dismiss <id>`, and **[DEC-13]** `ccam decisions retry <id>` (the
    `retry_write` action for a stuck write-back), registered in
    `COMMAND_GROUPS` + `SUBCOMMANDS` + the `runCommand` switch (§5). No bespoke
    write-back CLI command is needed — `ccam` is a thin HTTP client over the
    route layer (`ccam focus done <n>`, `bin/ccam.js:~1683`, is the shape).
27. **Tests** (`server/__tests__/reconciliation.test.js`, new) — see §6.
28. Run `npm run test:server` and `npm run test:client` (the latter must be
    unchanged and green — there are no client edits).
29. **Docs + close-out** per DEC-8: `ARCHITECTURE.md`, `docs/API.md`,
    `docs/DATABASE.md`, `server/README.md`; **correct every doc claim that the
    dashboard never writes `AGENT-PLAN.md`**, including `plan-ingest.js`'s own
    header; correct the `/loop` claim in `pm.md` and the
    `portfolio-reconciliation-vision` memory; sync both memory entries. Run
    `bash .claude/skills/file-headers/scripts/check-headers.sh` (must exit 0).
30. **Live trial** per DEC-7 — see §8. **[DEC-13]** This gate now covers
    unattended *file writes*, not just queue entries: Sara must review what
    actually landed in her `AGENT-PLAN.md` files, not only what the queue says.

---

## 5. Single-source-of-truth guardrail

This project has two configured conventions that this change set touches, plus
one registry in the CLI. All three are mandatory routes, not preferences.

**(a) `PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW — the canonical-computation
rule.** This work introduces three new derived values at once (pace status,
detour disposition, decision-queue entry) plus **one new derived *action*** (the
disposition→file write), and has a deliberately deferred layer-7 UI queued to
become their second consumer. §9.1's own citation history (4 touches) shows the
failure lands when consumer #2 appears and re-derives rather than calls.
Therefore:
- **Pace status is computed only in `server/lib/pace.js`.** Layer 6's R1 rule
  calls `paceStatus()`. The plans route, any future `ccam` output, and the
  eventual layer-7 UI call the same function. No second implementation of
  "is this item behind," and no second definition of "complete" (DEC-5).
- **Disposition vocabulary lives only in `server/lib/detours.js`**
  (`DISPOSITIONS`). The route, the reconciliation module, `plan-writeback.js`,
  and the tests import from there; the SQL `CHECK` constraint is its mirror and
  must be edited in the same change if the enum ever changes (decisions.md
  WATCH-4).
- **The write sequence lives only in `plan-writeback.applyDisposition()`.**
  DEC-13 creates two call sites for the identical sequence (the human
  `POST /api/detours/:id/resolve` handler and `reconciliation.js`'s unattended
  tick). Hand-writing "sanitize → dispatch → audit → retry → escalate" in both
  is §9.1 on the write path — the same failure shape, one layer over. Neither
  caller may compose the sequence itself; both call `applyDisposition`.
- **Markdown composition lives only in `plan-writeback.js`** (Override 5 —
  `detours.buildPlanSnippet` is dropped). One composer, one sanitizer, one set
  of caps.
- If any of these values is rendered in a UI surface during this build (it
  should not be — WATCH-3), a cross-consumer parity test in the
  `[standing template]` style of
  `client/src/components/__tests__/FocusReportModal.test.tsx` becomes mandatory
  in the same change.

**(b) The `CREATE TABLE` / `ALTER TABLE` sibling pair in `server/db.js`.** This
is the same "must stay in sync" shape at the schema level. A fresh install
builds `plan_items` from the `CREATE TABLE IF NOT EXISTS` block; an upgrading
install gets the column from the standalone migration block. `target_date`
**must be added in both places** in step 3 — this file's own history
(`item_id`, `parent_item_id`, `workflow_run_id`, `cache_write_1h_per_mtok`,
`fast_input_per_mtok`, `intro_until`) shows a new column is always added in
both, never one. New *tables* need only the `CREATE TABLE IF NOT EXISTS` form —
but see DEC-15: for `detour_dispositions` and `decision_queue`, the whole
final shape (write-audit columns, widened `kind` enum) must land in that single
initial `CREATE TABLE`, because SQLite cannot add a `CHECK` via `ALTER TABLE
ADD COLUMN` at all.

**(c) `bin/ccam.js`'s `COMMAND_GROUPS` is the CLI's canonical registry.** Its
own header states it is "One source of truth for every command's group,
invocation, and one-line description," from which the one-shot `help`, the
REPL's categorized help, `commands`, per-command `help <cmd>`, the tab
completer's `COMMANDS` list, and unknown-command detection are all derived.
The new `focus target` and `decisions` commands **must** be added there (plus
`SUBCOMMANDS` for tab completion and the `runCommand` switch for dispatch) —
never by hand-editing a help string or the completer list.

**(d) `AGENT-PLAN.md` remains the single source of truth for plan content —
and `plan-ingest.js` remains the single owner of its syntax.** Per DEC-2 the
dashboard now *appends* to that file, which changes who may write it but not
what is authoritative. The invariants that make that safe are all
single-source rules:
- **`ingestPlanForCwd` is the only writer of `plan_items`/`plans`**, including
  for our own writes. `plan-writeback.js` mutates bytes and then calls it.
  A future "just also write the DB row directly, to save an ingest round-trip"
  optimization is the exact mistake to refuse — it resurrects the
  `deletePlanItemsNotIn` conflict this design exists to avoid, and gives
  `plan_items` two owners with two lifecycle rules forever.
- **`plan-ingest.js` is the only place that knows what this file's syntax
  means.** `plan-writeback.js` imports `parsePlanMarkdown`, the field regexes,
  and the caps; it must never hand-roll a second regex pass over the file.
  A duplicated parser is DERIVED-DUAL-VIEW moved from the render layer to the
  parse layer.
- **The reader's caps are the writer's caps.** `MAX_ITEMS`, `MAX_FILE_BYTES`,
  `MAX_TEXT_LEN`, `MAX_ACCEPTANCE_LEN`, `MAX_DETAIL_LEN` are imported, never
  re-typed as literals in the writer.
- **The file is still human-owned.** The optimistic lock exists so that when
  the dashboard and Sara disagree about the bytes, **Sara wins** and the
  dashboard escalates — never the reverse.

---

## 6. Testing & verification

QA's plan is adopted with the corrections in §2 (Overrides 2, 3 and 5). Stack,
as QA confirmed: server = `node:test` + `node:assert/strict` via
`npm run test:server`, one spec per lib, each spinning up its own temp SQLite
file by setting `process.env.DASHBOARD_DB_PATH` **before** requiring `../db`.

### `server/__tests__/pace-tracking.test.js` (new, layer 5)
- `no_target` for an item with no `target_date` — asserted as a distinct third
  value, never coerced to `on_track` or `behind`.
- `no_target` for a malformed/impossible stored value (`"friday"`,
  `"2026-13-45"`) — degradation must not manufacture `behind`.
- `on_track` for an open item with a future target; `behind` for an open item
  with a past target beyond grace.
- **Boundary pinned (DEC-6):** `target_date === today` → `on_track`; the next
  local day → `behind`.
- **Completed items are exempt:** an item with `checked = 1` and an item with
  `declared_done_at` set each report `done`, never `behind`, however late —
  and `completed_signal` distinguishes which fired (DEC-5).
- `graceDays` honored: explicit-value and default-when-unset cases, following
  `focus-report.test.js`'s idle-grace suite shape.
- **Re-ingest survival:** extend `server/__tests__/plan-ingest.test.js`'s
  existing "preserves `declared_done_*` across re-ingest" describe block with
  a sibling assertion that `target_date` also survives a re-ingest untouched.
  Extend that spec — do not write a parallel assertion in a new file that can
  silently drift from it.
- **Route contract:** extend `server/__tests__/plans-api.test.js` for
  `POST /api/plans/items/target` — happy path, `400` on a malformed date,
  `404` on an unknown item, clear-to-null, and `target_date` round-tripping
  through `GET /api/plans`.

### Layer 4 test guidance — REWRITTEN 2026-08-01 (DEC-2/DEC-13)

> **This supersedes DEC-12's guidance entirely.** DEC-12 inverted QA's original
> `fold_into_plan` assertion into "must NOT create a `plan_items` row" on the
> premise of advisory-only. Under real write-back the **original direction is
> correct again**: a `fold_in` *does* produce a `plan_items` row — via the file
> plus the real ingest, never a direct insert. **Before finishing Layer 4,
> grep the suite for any surviving `plan_items row count is unchanged`
> assertion tied to `fold_in`/`new_item` and delete it.** A stale copy of the
> superseded assertion passing silently would mean the two dispositions are, in
> practice, writing nothing.

#### `server/__tests__/atomic-file.test.js` (new, or folded into plan-writeback's spec)
This primitive has **zero** direct coverage today; the extraction is the first
point it is tested at all. Minimum:
- Successful write: content on disk matches exactly, no stray `.tmp` left.
- Failure mid-way (stub `fs.renameSync` to throw, or target an uncreatable
  path): the **original file is untouched** and the `.tmp` is removed. The
  existing comment at `cc-mutate.js:214-217` already claims this; this is the
  first test that pins it.
- `server/__tests__/cc-config.test.js` must pass **unchanged** after the
  extraction — behavior-preserving refactor, not a rewrite.

#### `server/__tests__/plan-writeback.test.js` (new — the primary new spec)
Own temp DB via `DASHBOARD_DB_PATH`, own `fs.mkdtempSync` work dir, mandatory
file header. Reuse `plan-ingest.test.js`'s `writePlan()` helper pattern
verbatim for before-state fixtures — do not hand-roll a second file-writing
helper. Separate `describe` blocks so each DEC-13 guard is independently
falsifiable:

- **`describe("happy path — real write survives re-ingest")`**
  - `appendPlanItem` on a seeded `AGENT-PLAN.md`, then the **real**
    `ingestPlanForCwd(dbModule, cwd)` (never a stub), then assert a **new**
    `plan_items` row exists for the minted `item_id` with `parent_item_id IS
    NULL`. Name it explicitly, e.g. `"a new_item write appears as a new
    plan_items row after write-back + re-ingest"`, so a future reader does not
    have to cross-reference `decisions.md` to know this intentionally reverses
    DEC-12.
  - `appendSubItem` under an existing top-level item: the new row's
    `parent_item_id` is the parent's `id`, and `attachDisplayNumbers` assigns a
    correct `N.M` display number on the next read. Do not re-implement
    `plan-ingest.test.js`'s sub-item assertions — just confirm write-back's
    output feeds them correctly.
  - Re-run `ingestPlanForCwd` a second time with no further changes: the
    content-hash short-circuit fires (no row churn) — proving write-back's own
    re-ingest correctly updated `plans.content_hash` so the next independent
    trigger (poll tick, `SessionStart`) harmlessly no-ops.
  - An unrelated pre-existing item elsewhere in the file is byte-identical
    apart from the new block (append never reflows or mangles existing
    content).
- **`describe("optimistic-lock conflict — no data loss")`**
  **Do not attempt real filesystem races** — timing-dependent and flaky by
  construction, which is exactly what `focus-summary.test.js`'s injected-seam
  pattern exists to avoid. Use `__injectPreRenameHookForTest(fn)`, which fires
  deterministically after the initial read/hash and before the pre-rename
  re-check; the hook body is just `fs.writeFileSync(planPath, humanEdited)`.
  - Human edit lands in the window → the call returns
    `{ ok:false, code:'CONFLICT' }` (not a silent success, not a generic
    throw).
  - **Both sides verifiably not lost:** after the `CONFLICT`, (a) the file on
    disk holds the human's edit **byte-for-byte** with no dashboard content
    appended over or around it; (b) the caller-side state was **not** advanced
    to resolved — model this with a stand-in that only flips its own flag on a
    non-CONFLICT return, and assert it stays unflipped.
  - Cheap pre-filter conflict: caller passed `expectedHash`, file already
    differs before any write attempt → also `CONFLICT`, without needing the
    hook at all.
  - **Same-cwd mutex serialization:** two `appendPlanItem` calls issued
    back-to-back (no `await` between them) for the same cwd both eventually
    succeed, each producing its own distinct new row — proving the
    `Map<cwd, Promise>` mutex, not the optimistic-lock path, handles
    same-process concurrency. They must never see each other as a `CONFLICT`.
  - **Mutex key identity:** two calls whose `cwd` strings differ only by a
    trailing slash are a **known hazard**, not a supported case — assert the
    disposition row's stored `cwd` and the value passed to the write path are
    byte-identical at the one place that matters (`applyDisposition`), so the
    map can never key two writes to the same file differently.
- **`describe("sanitization — adversarial LLM-influenced input")`**
  Unit tests on `sanitizeLlmPlanText` (no file I/O, no DB), table-driven with
  one `it()` per row: `{ name, input, mustNotAppearAsParsedField }`.
  **Assert the parse-back, not the string transform** — what matters is what
  `parsePlanMarkdown` does with the composed output.
  - Fake `id:` continuation line inside `text`/`detail`
    (`"Some text\n      id: deadbeef"`) → the composed block, parsed back,
    produces no second `id` value and no phantom extra item.
  - Same for forged `acceptance:` and `detail:` lines — one case each.
  - Raw newline with no field keyword (`"Ship it\n- [ ] 99. injected fake
    item"`) → parsed back, no extra top-level item.
  - Oversized `text`/`acceptance`/`detail` each individually beyond
    `MAX_TEXT_LEN`/`MAX_ACCEPTANCE_LEN`/`MAX_DETAIL_LEN` (**imported** from
    `plan-ingest.js`, never hand-copied numbers) → truncated by the sanitizer
    **before** composition. Do not rely on `plan-ingest.js`'s own truncation on
    the next read to save you.
  - Combined worst case: newline + fake `id:` + oversized in one string — all
    three guards apply, order-independent of which "wins."
  - **Joinery test (the engineer's gotcha):** a sanitized `text` ending
    mid-word adjacent to an `acceptance` beginning with `id:` must not
    recombine into a structural-looking line. Test the composition, not only
    each field in isolation.
  - **Negative control:** a clean, ordinary string (no newlines, no keywords,
    under all caps) is byte-identical after sanitization — proving the
    sanitizer is not overly aggressive on legitimate content.
- **`describe("MAX_ITEMS / byte-cap pre-flight")`**
  - A file already at `MAX_ITEMS` (or right at `MAX_FILE_BYTES`) rejects with
    `{ ok:false, code:'CAPS_EXCEEDED' }` and writes **nothing** — not a silent
    write the next ingest would quietly drop.
- **`describe("traceability — plan_items row back to its detour_dispositions row")`**
  - The real round trip, since the two identifiers become known at different
    times: (1) `appendPlanItem`, capture the minted `item_id`; (2) real
    `ingestPlanForCwd`; (3) `SELECT` the new `plan_items` row by
    `(cwd, item_id)`; (4) that same `item_id` is on the disposition row as
    `resolved_item_id` (**not** `linked_plan_item_id`, and **not** the integer
    PK — Override 5/DEC-14) along with `write_completed_at`; (5) assert a query
    starting **only** from `detour_dispositions.id` answers DEC-13's exact
    phrasing — *which detour, which classification, when* — in one query:
    `disposition`, `decided_by`, `reason`, `session_id`, `write_completed_at`,
    and the joined `plan_items.text`/`acceptance` matching what the disposition
    recorded as its intent.
  - Reverse direction: starting from a `plan_items` row,
    `SELECT * FROM detour_dispositions WHERE resolved_item_id = ?` recovers the
    decision.
  - **Negative case:** a disposition that ended in `CONFLICT` has
    `resolved_item_id IS NULL`, `write_status='conflict'`, and `resolved_at IS
    NULL` — distinguishable by query alone (no log-reading) from one that
    landed.
- **`describe("applyDisposition — retry and escalation policy")`**
  Stub `appendPlanItem`/`appendSubItem` (this is the one behavior in this
  effort with **no** existing sibling test to copy — nothing in this codebase
  retries a file write against a human's concurrent edit):
  - Two consecutive `{ ok:false, code:'CONFLICT' }` → **exactly one** retry
    happened (not zero, not two), `write_status='conflict'`, and a
    `decision_queue` row with `kind='writeback_conflict'` carrying the
    attempted markdown + current hash exists.
  - `CONFLICT` then success → one retry, `write_status='written'`,
    `resolved_item_id` set, and **no** queue row.
  - `CAPS_EXCEEDED` / `NO_PLAN_FILE` / `IO_ERROR` → **zero** retries,
    `write_status='failed'`, one `writeback_failed` queue row. (Deliberately
    asymmetric from `CONFLICT`: the cause is not transient.)
  - `deliberate`/`discard` → the write path is **never called at all**.
  - Idempotency: re-invoking `applyDisposition` on a row already at
    `write_status='written'` calls the write path **zero** additional times and
    returns the existing `resolved_item_id`. A second unnecessary file write is
    itself a regression under DEC-13.
  - `retry_write` after a conflict re-derives the hash from disk — assert it
    does **not** reuse the stale `expectedHash` from the failed attempt.

#### `server/__tests__/detour-disposition.test.js` (new, layer 4)
Focus here is disposition logic; **stub `plan-writeback.js`** — integration
coverage of the real write lives in `plan-writeback.test.js`. Do not re-test
file mechanics twice.
- **Enum guard:** `resolveDisposition` accepts exactly the four values and
  rejects a fifth with a structured error — the JS `DISPOSITIONS` list and the
  SQL `CHECK` agree.
- **`fold_in` / `new_item` (rewritten — DEC-12's assertions deleted):**
  disposing drives exactly one call into `plan-writeback.applyDisposition`; on
  success the row has `write_status='written'`, `resolved_item_id` set, and
  `resolved_at` stamped; on `CONFLICT` it has `write_status='conflict'`,
  `resolved_item_id IS NULL`, `resolved_at IS NULL` — obviously retryable, not
  silently dropped. This is the caller-side half of the "not lost" guarantee
  `plan-writeback.test.js` covers from the callee side.
- **`deliberate` and `discard`:** resolve without any write-path call; the
  disposition record stays queryable after resolution (discard is a
  resolution, not a delete of history).
- **Durability across re-inference (the architect's top risk):** create an
  inferred detour, resolve it (with a written disposition), then re-run
  `inferSession` for the same session so `upsertDetourDisposition` fires again
  — assert `disposition`, `decided_by`, `resolved_at`, `write_status` and
  `resolved_item_id` are all unchanged, `source_seen_at` advanced, and **no
  second write-path call happened**. Then advance `source_seen_at` past
  `resolved_at` and assert `listStaleResolvedDetours` returns it — and that
  re-surfacing it for review still does not re-apply the write.
- **Idempotency:** recording the same detour twice yields exactly one row (the
  `(cwd, source, source_ref)` unique index), and resolving twice neither
  duplicates a row nor triggers a second write.
- **§9.2 ordering regression:** seed detour-bearing `events` whose `created_at`
  order does **not** match `id` insertion order (same scrambled-insert
  technique as `focus-report.test.js`'s out-of-order test) and assert
  `backfillDeclaredDetours` and `listPendingDetours` process them in
  `created_at` order.
- Extend `server/__tests__/focus-inference.test.js` (do **not** isolate this):
  a session classified `kind='detour'` now also produces exactly one pending
  `detour_dispositions` row; a session classified `item`/`unclassified`
  produces none; a thrown error inside `recordInferredDetour` still leaves the
  `focus_inferences` row written (per-stage fail-safe); and **classification
  never writes `AGENT-PLAN.md`** — assert the file is byte-identical across an
  `inferSession` that produces a detour.
- Route tests: `GET /api/detours` filtering by `cwd`/`project_id`/`status`;
  `POST /api/detours/:id/resolve` happy path returning `write_status` and
  `resolved_item_id` in the body, `400` on a bogus disposition, and a
  `CONFLICT` outcome surfaced in the response rather than a 500.

### `server/__tests__/reconciliation.test.js` (new, layer 6)
Structure with four `describe` blocks so the confirmed rules/LLM boundary is
enforced by the test file's own shape. Template: `focus-audit.test.js` for the
rule/scheduler halves and `focus-summary.test.js` for the LLM half (DEC-11) —
**not** `session-liveness.test.js`.

- **`describe("escalation rules — deterministic, no LLM")`**
  - Table-driven over R1 and R2 with the spawn seam stubbed to throw
    (`require("../lib/focus-inference").__injectSpawnForTest(() => { throw new Error("no LLM call expected"); })`),
    exactly the technique `focus-summary.test.js` already uses. A stray call
    here is a design violation, not a slow test.
  - Fixture per QA: one item behind beyond threshold, one within threshold, a
    cwd above the detour-volume ratio, a cwd below it — escalation fires for
    the first and third only.
  - Threshold boundary cases (exactly at the ratio, exactly at the grace day)
    pinned explicitly.
  - A project with no escalation-worthy condition → **empty queue, zero
    spawns, zero file writes**.
  - **WATCH-2 mitigation:** a cwd whose `plans.missing_at` is set, and a cwd
    with zero plan items, are skipped — no `pace_alert` is ever produced for
    them, **and** they never reach the LLM step, so no write-back can be
    attempted against them (the WATCH-2/DEC-13 composition point; assert both
    branches, since the easy bug is fixing only the pace one).
- **`describe("LLM judgment pass — classification only")`**
  - `fakeSpawn` / `fakeSpawnSequence` / `envelope` helpers copied from
    `focus-summary.test.js`. **No real `claude` CLI is ever spawned** — a CI
    run with the CLI unavailable must still pass.
  - One case per disposition value returned by the stub, asserting the
    `detour_dispositions` row and/or `decision_queue` payload carries that
    exact verdict unmodified.
  - **The auto-write boundary (replaces the old "advisory boundary" case):** a
    stubbed high-confidence `fold_in` verdict calls
    `plan-writeback.applyDisposition` exactly once (stub the write path here)
    and, on its success, produces **no** `decision_queue` row — the loop is
    closed on the disposition row. A stubbed `{ ok:false, code:'CONFLICT' }`
    twice produces a `writeback_conflict` queue row instead.
  - **Quiet resolution:** a stubbed high-confidence `discard`/`deliberate`
    resolves the disposition, creates no queue row, and **never calls the write
    path**.
  - Malformed output — unparseable JSON, missing field, invented 5th value,
    unknown detour id, low confidence — leaves the disposition `pending`,
    enqueues `needs_review`, and **writes nothing to any file**. Never a
    guessed verdict, and never an unattended write behind one. (Same defensive
    shape as `parseWindowSummaryOutput`'s "returns null for garbage" tests.)
  - Digest gating: an unchanged flagged set on a second tick spawns nothing;
    changing a detour's `source_seen_at`/`label` changes the digest and allows
    one spawn.
- **`describe("decision queue output")`**
  - Queryable over the route with no UI consumer; contains only rules-escalated
    items and write-back escalations — an LLM-classified-but-not-escalated
    detour that wrote successfully can never appear (structurally impossible,
    but asserted).
  - A resolved/dismissed item does not resurface on the next tick
    (`findOpenQueueItem` guard).
  - Resolving a `detour_disposition` queue row also resolves its linked
    `detour_dispositions` row, in one transaction.
  - `retry_write` on a `writeback_conflict` row re-invokes `applyDisposition`
    and, on success, flips both the queue row and the disposition row.
- **`describe("scheduling / fail-safe")`**
  - `reconcileCwd` called directly (never waiting on a real timer), the same
    seam `livenessReap`/`auditSession` provide.
  - LLM unavailable (`probeClaudeCli` false), spawn throws, a write-back
    throws, or a DB error mid-write → prior `decision_queue` and
    `detour_dispositions` state is **untouched**, nothing is marked resolved,
    **no partial file write is left behind**, and the scheduler does not crash.
    Mirrors `session-liveness.js`'s `available: false → change nothing`
    contract.
  - `DASHBOARD_RECONCILE_MODE=off` → the tick never runs (and therefore no
    unattended file write can occur — this is the kill switch for auto-write);
    `DASHBOARD_FOCUS_INFER_MODE=off` → rules still run, LLM half spawns
    nothing, no write-back is attempted (DEC-9).

### Commands to run
- After every layer, and after the write-path plumbing commits (steps 11–14):
  `npm run test:server`.
- Immediately after the `atomic-file.js` extraction, in isolation:
  `node --test server/__tests__/cc-config.test.js`.
- Once, at the end: `npm run test:client` (must be untouched and green — no
  client edits in this effort).
- `bash .claude/skills/file-headers/scripts/check-headers.sh` (exit 0) — six
  new `.js` files (`pace.js`, `atomic-file.js`, `plan-writeback.js`,
  `detours.js`, `reconciliation.js`, plus the new route files) need the header
  with the exact `@author Son Nguyen <hoangson091104@gmail.com>` line.
- MCP typecheck/build are **not** required — decisions.md **WATCH-6** (no MCP
  surface this round).

---

## 7. Risks & rollback

### Watch list during the build

| Risk | Mitigation in this plan |
|---|---|
| **Markdown/continuation-line injection into a human-owned file** — new with DEC-2/DEC-13; LLM-sourced text can now reach the parser as structure, not just prose | `sanitizeLlmPlanText` per field before composition, prefix strip as defense in depth, joinery tested separately, and every assertion made on the **parse-back** rather than the string |
| **A human's concurrent edit clobbered by an unattended write** | Per-cwd mutex + cheap pre-check + re-hash-immediately-before-rename optimistic lock; on conflict **Sara wins** and we escalate. Residual TOCTOU window accepted — **WATCH-9** |
| **Retry live-locking against an editor** | Exactly one retry, then `writeback_conflict` escalation. Never a third attempt |
| **A write that "succeeded" but is invisible** (file past `MAX_ITEMS`/`MAX_FILE_BYTES`, silently dropped on the next parse) | Writer pre-flights the reader's own caps; `CAPS_EXCEEDED` and write nothing |
| **A second file write for the same disposition** (re-inference, re-dispatch, stale-resolved re-surfacing) | `upsertDetourDisposition` never touches write-audit columns; `applyDisposition` is idempotent on `write_status='written'`; `listStaleResolvedDetours` re-surfaces for review only, never re-applies. All three asserted |
| **Backup files accumulating unbounded** — worse under auto-write than under a confirm gate, because nothing paces it | **WATCH-8**: retention deliberately not solved this round; the accepted mitigation is that backups live under `<cwd>/.claude/agent-plan-backups/`, outside `PLAN_FILENAME`'s lookup, and are visible for manual pruning |
| **Mutex key divergence** (trailing-slash cwd) unserializing two writes to the same file | Key on the byte-identical `cwd` string `ingestPlanForCwd`/`getPlanByCwd` use; asserted at `applyDisposition` |
| **Two call sites drifting** (human resolve vs. unattended tick) | Both call `applyDisposition`; neither composes the sequence (§5(a), DEC-14) |
| **`plan_items` gaining a second writer** | `plan-writeback.js` never calls `upsertPlanItem`; it re-runs the real `ingestPlanForCwd`. Asserted by every write-back test ending in a real (not stubbed) ingest |
| **Hybrid-escalation inversion** (LLM asked whether to escalate) — the confirmed design's explicit non-compliance condition | Two separately exported functions with a one-directional call; the stub-to-throw rule tests make it falsifiable |
| **A decision clobbered by re-inference** | `upsertDetourDisposition` never writes decision columns on conflict; `listStaleResolvedDetours` detects genuine change |
| **§9.2 id-as-chronology** in the new lookback queries | `ORDER BY created_at …, id …` before any `LIMIT`, plus an out-of-order-insert regression test |
| **§9.1 second-consumer drift** | `pace.js` / `detours.js` / `plan-writeback.js` as the only implementations, on day one — of the computation *and* of the write sequence |
| **LLM cost fan-out** across 8–10 projects | Rules-gated spawning, digest gating, one batched prompt per cwd, `MAX_TARGETS_PER_TICK` / `MAX_DETOURS_PER_TICK`, 4h default tick, two kill switches |
| **`target_date` off-by-one across timezones** | DEC-6: date-only local calendar day, boundary pinned by test |
| **Partial-failure inconsistency** between the two new tables | Per-stage try/catch; `markDetourWriteResult` writes the whole outcome in one statement; the human-resolve path writes both rows in one transaction |
| **New routes as a trust-boundary change** | Local-only, behind the existing `app.use("/api", tokenGuard)`; nothing added to `remote_sources`/`webhook_targets` |
| **Docs asserting the opposite of the code** (`plan-ingest.js`'s header still says the dashboard never writes the file) | Steps 12 and 29 both require correcting it; a stale claim about a trust boundary is worse than no claim |

### Scope boundaries this plan knowingly declines — each backed by a tracked row

Prose disclosure is not sufficient; every item below has a row in
`intake/2026-08-01-build-project-manager/decisions.md`, carrying forward the
four the architect flagged under "Architectural risks" in the original pass and
the two he flagged under "Scope boundaries this revision deliberately does NOT
resolve" in the write-back revision:

- **Layer 7 (portfolio rollup UI) not built; no UI surface at all this round** —
  **WATCH-3** (architect's item 1; also guards against opportunistic
  "just a badge" creep, which would immediately trigger §9.1).
- **Target-date inference not built** — **WATCH-1** (architect's item 2).
- **Cross-plan lifecycle reconciliation not modeled** (on hold / superseded /
  archived) — **WATCH-2** (architect's item 3), with the mandatory
  skip-missing-plan mitigation specified in step 23(a), now also gating the
  write path (DEC-13 composition), and tested in both branches.
- **Memory-sync + `/loop` correction obligations** — **DEC-8** (architect's
  item 4).
- **Enum widening requires a table rebuild** — **WATCH-4**, with **DEC-15**
  requiring the full final shape of both new tables to land in their initial
  `CREATE TABLE`.
- **Cost allocation** (named in the original raw ask, not delivered by layers
  4–6) — **WATCH-5**.
- **No MCP tool surface** — **WATCH-6**.
- **Creating a brand-new `AGENT-PLAN.md` for a cwd that has none is out of
  scope** — **WATCH-7** (architect's write-back revision, scope boundary #1).
  `appendPlanItem`/`appendSubItem` hard-fail with `NO_PLAN_FILE`; the dashboard
  never authors a plan from scratch on Sara's behalf.
- **Backup retention/pruning for `<cwd>/.claude/agent-plan-backups/` not
  built** — **WATCH-8** (architect + engineer both flagged; auto-write makes it
  near-term rather than someday).
- **Residual TOCTOU window between the pre-rename re-hash and the rename is
  accepted, not eliminated** — **WATCH-9**. Closing it fully needs an OS-level
  lock a foreign editor would also have to honor, which does not exist for this
  file. Documented rather than silently assumed away.

### Rollback

The change set is additive and reversible in four independent slices, in
reverse build order — **with one asymmetry that did not exist under
advisory-only and must be understood before Layer 4 ships**:

> **Layer 4's file writes are not rollback-able by reverting code.** Any
> `AGENT-PLAN.md` content written before a revert **stays written** — it is now
> ordinary plan content, indistinguishable from a human's. That is by design
> (it is exactly what makes it survive ingest), and it is the price of DEC-2.
> The recovery path is the per-write timestamped backup under
> `<cwd>/.claude/agent-plan-backups/` plus git history of the plan file where
> the project tracks it. Confirm during the live trial (DEC-7) that those
> backups are actually landing before trusting them as the rollback story.

1. **Layer 6:** remove the `startReconciliation` call from
   `server/index.js` (or set `DASHBOARD_RECONCILE_MODE=off` — no deploy
   needed, and this is also the fastest kill switch for *unattended* writes),
   unmount `/api/decision-queue`, delete `server/lib/reconciliation.js` and its
   route/CLI entries. `decision_queue` can be left in place harmlessly (unread)
   or dropped.
2. **Layer 4 (disposition half):** remove the `recordInferredDetour` call from
   `inferSession` (a five-line, self-contained block), unmount `/api/detours`.
   Existing `detour_dispositions` rows become inert history — including their
   write audit, which stays readable and is the record of what was written.
3. **Layer 4 (write half):** delete `server/lib/plan-writeback.js` and revert
   `plan-ingest.js`'s added exports. Keep `server/lib/atomic-file.js` and
   `cc-mutate.js`'s import of it — that extraction is behavior-preserving and
   independently useful; reverting it buys nothing and re-introduces a
   duplicated primitive.
4. **Layer 5:** remove the route/CLI entries. **Leave the `target_date`
   column** — dropping a column in SQLite means the full rename-copy-drop
   rebuild, which is far riskier than an unread nullable column. If a full
   revert is genuinely required, follow `18196dc`'s own precedent for the
   guarded `projects.priority` drop.

Existing behavior is otherwise unmodified: `upsertPlanItem`'s SQL,
`plan-ingest.js`'s parsing and ingest logic, `focus-commands.js`, every
existing route response shape, and every existing WebSocket message type are
untouched. The edits to existing hot paths are exactly three: the guarded
five-line block in `inferSession`, the `atomicWriteFile` import swap in
`cc-mutate.js`, and additive exports in `plan-ingest.js`.

---

## 8. Definition of Done

- [ ] **DEC-2 (B), DEC-5 (A) and DEC-13 (A)** recorded as DECIDED in
      `decisions.md`, and **DEC-12 marked SUPERSEDED** — done; re-confirm no
      new PENDING row gates the layer being built.
- [ ] `target_date` added to **both** the `plan_items` `CREATE TABLE` block and
      a `try/SELECT/catch/ALTER` migration block; `upsertPlanItem`'s SQL
      unchanged apart from its comment; verified against both a fresh DB and an
      upgraded copy of an existing one.
- [ ] `server/lib/pace.js` is the only implementation of pace status and of the
      completion test; layer 6's R1 rule calls it.
- [ ] `atomicWriteFile` extracted to `server/lib/atomic-file.js` as its own
      commit, `cc-mutate.js` importing it, `cc-config.test.js` passing
      **unchanged**, and baseline coverage added for the primitive (currently
      zero-coverage code being promoted to shared, doubly-relied-on
      infrastructure).
- [ ] `detour_dispositions` and `decision_queue` created with their **full
      final shape in the initial `CREATE TABLE`** — write-audit columns,
      `proposed_*` columns, `resolved_item_id`, and the widened `kind` enum
      including `writeback_conflict`/`writeback_failed` (DEC-15/WATCH-4) — with
      no cascading FK on `session_id`; a decision survives session cleanup and
      survives re-inference of its session.
- [ ] **Real write-back holds:** a `fold_in` produces a real sub-item and a
      `new_item` a real top-level item in `AGENT-PLAN.md`, each with a
      synthesized `id:` line, each surviving a subsequent real
      `ingestPlanForCwd` as a `plan_items` row, and **no code path anywhere
      inserts into `plan_items` directly**. Every write-back test ends in a
      real (not stubbed) ingest.
- [ ] **No DEC-12 residue:** grep the suite — no surviving `plan_items row
      count is unchanged` assertion tied to `fold_in`/`new_item`.
- [ ] **Sanitization proven by parse-back, not by string inspection** — forged
      `id:`/`acceptance:`/`detail:` lines, bare injected item lines, oversized
      fields, the combined worst case, the joinery case, and a clean negative
      control.
- [ ] **Conflict = no data loss, both sides:** the human's bytes intact on
      disk, and the disposition left obviously retryable
      (`write_status='conflict'`, `resolved_item_id IS NULL`, `resolved_at IS
      NULL`) rather than silently dropped.
- [ ] **Retry policy pinned:** exactly one retry on `CONFLICT`, zero on
      `CAPS_EXCEEDED`/`NO_PLAN_FILE`/`IO_ERROR`, escalation to
      `writeback_conflict`/`writeback_failed`, and idempotent re-dispatch that
      never writes twice.
- [ ] **Traceability answerable in one query** from `detour_dispositions.id`
      ("which detour, which classification, when") and in reverse from
      `plan_items` via `resolved_item_id` — the DEC-13 requirement, using the
      DEC-14 column names.
- [ ] **Classification never writes the file:** `inferSession` producing a
      detour leaves `AGENT-PLAN.md` byte-identical.
- [ ] `applyDisposition` is the **only** place the write sequence exists; both
      `routes/detours.js` and `reconciliation.js` call it and neither composes
      it (§5(a)).
- [ ] Rules and LLM are two separately exported functions with a
      one-directional call; the rule tests pass with the spawn seam stubbed to
      throw, and a no-condition project produces an empty queue, zero spawns,
      and zero file writes.
- [ ] The reconciliation tick skips `plans.missing_at` cwds and zero-item cwds
      **before the LLM step** (WATCH-2 + DEC-13 composition), with a test
      covering **both** the pace branch and the write-back branch.
- [ ] No real `claude` CLI process is spawned by any test (grep the new specs
      for `__injectSpawnForTest`; a run with the CLI unavailable still passes),
      and no test relies on a real filesystem race (grep for
      `__injectPreRenameHookForTest`; no sleeps, timers, or worker threads in
      the conflict specs).
- [ ] Every new query over `events` / `focus_inferences` sorts by `created_at`
      (id tiebreak) **before** any `LIMIT`, with an out-of-order-insertion
      regression test (§9.2).
- [ ] `npm run test:server` passes, including the new suites; the pre-existing
      `focus-report`, `focus-summary`, `focus-inference`, `focus-audit`,
      `session-liveness`, `plan-ingest`, `plans-api`, `cc-config` suites all
      still pass with only **additive** changes.
- [ ] `npm run test:client` passes with **no** client diff (WATCH-3). If a UI
      surface was added anyway, §9.1's cross-consumer parity test and a
      reviewed `screens.snapshot.test.tsx` update are mandatory — never a blind
      `-u`.
- [ ] `focus target` and `decisions` (incl. `retry`) are registered in
      `bin/ccam.js`'s `COMMAND_GROUPS` + `SUBCOMMANDS` + `runCommand`, and show
      up correctly in `ccam help`, `help <cmd>`, and REPL tab completion.
- [ ] All new `.js` files carry the required header; `bash
      .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] Docs updated: `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`,
      `server/README.md` (schema, WebSocket types, CLI, env knobs) — **and
      every "the dashboard never writes `AGENT-PLAN.md`" claim corrected,
      including `plan-ingest.js`'s own file header.**
- [ ] DEC-8 close-out done: `/loop` claim corrected in `pm.md` and the
      `portfolio-reconciliation-vision` memory; both memory entries synced to
      describe layers 4–6 as built.
- [ ] **DEC-7 live-trial gate:** Sara has reviewed real decision-queue output
      **and the actual content auto-written into her `AGENT-PLAN.md` files**
      against her own fleet and confirms it is signal, not noise. A green suite
      is not sign-off — and under DEC-13 this gate now covers unattended edits
      to a stakeholder-facing document, which is the highest-stakes surface in
      this effort. This is the gate the WIP-queue removal (`18196dc`) exists to
      teach.
- [ ] Backups are confirmed landing under `<cwd>/.claude/agent-plan-backups/`
      during the live trial (WATCH-8/rollback story depends on them).
