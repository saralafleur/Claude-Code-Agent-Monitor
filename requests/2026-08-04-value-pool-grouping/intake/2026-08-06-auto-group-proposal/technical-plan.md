# Technical Plan — Value Pool Slice 3: Auto-group proposal engine

**Intake:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/`
**Stage:** `intake-tech-lead` (Wave 3) · **Written:** 2026-08-06
**Request type (PM, final):** `new-feature` + two scheduled-debt carve-outs
(SF-4 extraction, AC-7 coverage-gate UI)
**Effort branch:** `effort/2026-08-06-auto-group-proposal`
**Inputs synthesized:** `request-brief.md`, `run-plan.md`, `pm-plan.md`,
`supporting/architect.md`, `supporting/engineer.md`,
`supporting/product-owner.md`, `supporting/qa.md`, plus live reads of
`server/lib/value-ledger.js`, `server/lib/value-summary.js`,
`server/lib/value-coverage.js`, `server/lib/focus-summary.js`,
`server/routes/project-plans.js`, `server/db.js`,
`server/__tests__/single-writer-guard.test.js`,
`server/__tests__/project-plans-api.test.js`,
`client/src/components/PlanLedgerPanel.tsx` (all read 2026-08-06).

**Decisions log for this slice:** `decisions.md` (same folder). Every scope
boundary this plan declines is a row there, cited inline below.

---

## 0. Build readiness — this plan is NOT gated on anything

State this plainly because two prior slices in this family stalled on a
premise nobody re-checked:

- **Slices 1 and 2 are fully landed on `master`** (`b38b4a1`, `4c2e931`,
  QA-fix `5ec640b`, doc sync `b0e3157`). Nothing in this plan depends on
  unmerged work.
- **AC-6 / model calibration is CLOSED** (DEC-10, commit `c233a36`): sonnet
  is pinned for both stages, `summaryModel("grouping")` and
  `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL` already exist
  (`server/lib/value-summary.js:107,122-131`; `.env.example:137-138`).
  **Do not re-run calibration. Do not re-test model selection.**
- **OPEN-4 (`MAX_PROJECTS_PER_TICK`) is CLOSED** by Slice 2 DEC-3 — default
  3 is a spec, not a pending question, and there is to be no second tuning
  mechanism. Slice 3 does not touch it. Cite DEC-3; do not re-argue it.
- **The coverage gate field is live**: `coverageSnapshot.complete`
  (`server/lib/value-coverage.js:134`).
- **`value_groups` is genuinely unclaimed schema space** (`grep -c
  "value_groups" server/db.js` → 0).

**Build may start immediately, on all rulings as written.** The only
open items for Sara (PM §7) are cheap-to-reverse vetoes, none blocking.

---

## 1. Objective

Add a two-stage, proposal-only grouping engine over a project's Value Pool:
a free, deterministic **mechanical pre-grouping** pass (initiative-slug
references, local-calendar-day time adjacency, shared-surface proxy) over
`assembleValuePool`'s units, followed by **one sonnet call per batch** (plus
one rollup call when the pool exceeds a single prompt) that turns raw
candidate clusters into named proposals carrying a name, a stakeholder-level
summary sentence, member `unitKey`s, and a rationale. Proposals persist to
three new tables (`value_group_runs`, `value_groups`, `value_group_members`)
and render in `PlanLedgerPanel` for human review with **approve** and
**dismiss** actions that change a status column and nothing else. The whole
feature is gated server-side on `coverageSnapshot.complete === true`. In the
same change set we pay the inherited SF-4 debt by extracting
`buildProbeCoverage` and making Slice 3's gate its third — not fourth-hand-
copied — call site.

**End state:** Sara opens a project whose altitude coverage is 100%, clicks
Auto-group, and within one run sees a list of named candidate groups, each
explained in one sentence, each showing its members with a per-member
**live** availability state, with the run's own state (`in_progress` /
`completed` / `completed_zero_groups` / `failed` / `not_attempted`) always
visible and never inferable-only-from-an-empty-list. Nothing in this slice
can create, edit, or claim a plan item.

---

## 2. Recommended approach — and what it overrides

The design is the architect's four-layer extension (composer →
per-unit synthesis → coverage → **grouping**), with the engineer's
concrete extraction/schema mechanics, corrected by the PM where the two
conflicted. Explicit overrides:

| # | Overridden | Ruling | Why |
|---|---|---|---|
| O-1 | **Engineer's two-table schema** (`value_groups` with a `run_id TEXT` column + members) | **Three tables** — `value_group_runs` / `value_groups` / `value_group_members` (architect §5, PM-3) | Two tables structurally cannot represent run-level state: zero-clusters is byte-identical to never-attempted (`SELECT … WHERE project_id=?` → `[]`), and `in_progress` — the longest-running action in this product — has no home at all. This is §9.8's live instance #1 reproduced on the surface it was catalogued from. |
| O-2 | **Engineer §1.3: "no structural guard exists, nothing to delete"** | **False. T7 exists** at `server/__tests__/project-plans-api.test.js:905`, is anchored (lines 988-998), and **will go red** when the extraction lands | T7 asserts each handler *body* literally contains `await valueLedger.assembleValuePool(dbModule, { id: projectId })` and `await enrichPoolAltitudes(dbModule, units, { probe: true })`. After extraction those lines live in `value-coverage-probe.js`. **T7 is deleted and replaced in the same commit — never "adjusted until it passes."** (WATCH-S3-D.) |
| O-3 | **QA §4's post-extraction route↔route parity guard** | **Do NOT build it.** Build a single-call-site / structural-scan guard instead (QA's own §4 acceptance-verification pattern) | Once both handlers call one function, `deepEqual(A, B)` degenerates to `deepEqual(f(X), f(X))` — the exact vacuity shape `value-coverage-parity.test.js` shipped in Slice 2. The catalog's own words: "replace the guard then — **do not keep both**." QA's *anchoring* instinct survives as an anchored assertion on each route's **response key set** (the non-vacuous half of T7's value). |
| O-4 | **Architect's "defer per-member re-validation with a WATCH row"** | **Build v1 now**, read-time only (PM-1) | Zero new schema: availability is derived at READ time from live pool + claims, never persisted. Claim-time re-validation is deferred as **WATCH-S3-A** and Sara does not need to re-decide it. |
| O-5 | **Three competing vocabularies** (engineer `status`, architect `review_status`, PO approve/dismiss) | **One vocabulary, three orthogonal axes** — see §3 | Two lifecycles collapsed into one column is §9.8 in miniature; a schema value that disagrees with the button label is a future §9.1 translation layer. |
| O-6 | **Engineer's `parent_group_id` column and `reviewed_by` column** | **Both dropped** | Nothing in Slice 3 or Slice 4 reads a persisted intermediate leaf group (the rollup merges by reference and only final proposals persist), and this is a single-user local tool with no identity source — a column no writer can truthfully fill is an absence wearing a value's clothes. §9.6: prefer inapplicability. |
| O-7 | **Engineer's open question "sibling route file vs. `project-plans.js`"** | **Routes live in `server/routes/project-plans.js`** | It already mounts `/pool`, `/altitudes`, `/coverage` for the very same panel and is already a registered `CONSUMERS` entry; a sibling file adds a mount point and a second composer-consumer path for zero benefit. |
| O-8 | **Architect's "value-groups.js must not call `assembleValuePool`"** vs **engineer's "value-groups.js is the 4th CONSUMER"** | **Both, reconciled:** `value-groups.js` never calls the composer (route handlers pass `units` in, mirroring `value-summary.js`'s own header contract) **and** it is still registered in `CONSUMERS` as a derived-values reader | The registry is a tripwire for "who depends on these derived numbers," and `mechanicalPreGroup` / `resolveMemberAvailability` consume them wholesale. Under-registering is §9.7's recorded failure mode (this project's 6th instance of that class if missed); over-registering costs one string. Register it, with the parenthetical naming the consumption mode. |

Everything else stands as the evaluators wrote it: the mechanical pass
over-generates auditable candidate clusters and the LLM disambiguates
(architect §3a); a cluster is the atomic unit of decomposition and is never
split across batches; a failed batch **discloses** as unrefined mechanical
proposals rather than vanishing; membership is a join table, not a JSON blob.

---

## 3. Vocabulary and discriminated states — MANDATORY, inline build obligation

This section is the condition under which triage's open question #3 was
allowed to be technical-plan scope at all (run-plan §Wave 3). Every state
below is **server-authored, exported as a named registry, and rendered
verbatim by the client.** No client-side inference from a missing key, a
NULL text field, or an empty array is permitted anywhere.

**Three orthogonal axes plus two response-level signals. They never merge.**

### 3.1 Run state — `GROUP_RUN_STATES` (per project, per run)

Exported from `server/lib/value-groups.js`.

| Wire value | Persisted? | Meaning |
|---|---|---|
| `not_attempted` | **No — intentional absence of any run row** | No grouping pass has ever executed for this project. |
| `in_progress` | Yes | Mechanical pass and/or a sonnet call is running now. |
| `completed` | Yes | Run finished, ≥1 group proposed. |
| `completed_zero_groups` | Yes | Run finished, zero groups — every candidate filtered out, or refinement legitimately returned none. **Never the same value as `not_attempted`.** |
| `failed` | Yes | The pass errored/timed out before producing any group, or was interrupted by a restart (`error_reason` names which). |

Two exports, because the wire set and the CHECK set genuinely differ:

```js
const GROUP_RUN_ROW_STATES = ["in_progress", "completed", "completed_zero_groups", "failed"]; // the CHECK
const GROUP_RUN_STATES = ["not_attempted", ...GROUP_RUN_ROW_STATES];                          // the wire
```

**Required assertion (anchored exemption set, PM-5c shape):**
`assert.deepEqual(GROUP_RUN_STATES.filter(s => !GROUP_RUN_ROW_STATES.includes(s)), ["not_attempted"])`
— so a 6th wire value, or a wire value that quietly becomes persistable,
breaks the test at the point of growth.

### 3.2 Per-group refinement state — `GROUP_REFINEMENT_STATES`

`value_groups.refinement_state`, the **batch-disclosure** axis:

- `pending` — mechanical cluster persisted, sonnet call not yet attempted.
- `refined` — sonnet call succeeded; `name`/`summary_sentence`/`rationale` are non-NULL.
- `zero_members` — refinement succeeded but resolved no members (a named outcome, never an empty join silently).
- `failed` — this batch's sonnet call errored/timed out/parsed unusable; the group survives as its raw mechanical cluster (signal + member list, no LLM text). This is the architect's **disclose** half, made mechanical.

`name`/`summary_sentence`/`rationale` stay NULL for every value except
`refined`. **The client must read `refinement_state` and must never infer
state from NULL-ness of those text fields** — that inference is the trap.

### 3.3 Per-group review lifecycle — `GROUP_REVIEW_STATES`

`value_groups.review_status`: `proposed` → `approved` | `dismissed`, plus
`claimed` **reserved in the CHECK and unreachable in Slice 3** (PM-3).

- `approved` (not `reviewed`) because that is the word AC-5 and the button
  copy use.
- `claimed` is reserved so Slice 4 needs no `rebuildTableAtomically` +
  `REBUILD_CASES` + interruption test to add it (WATCH-4's recorded lesson).
- **Unreachability is guarded, not narrated:** a structural scan asserts
  **zero code paths in Slice 3 set `review_status = 'claimed'`**, red-proven
  by injecting one.

### 3.4 Per-member availability — `GROUP_MEMBER_AVAILABILITY` (derived, never persisted)

Computed at READ time on `GET /groups` only. **There is no
`still_available` column** on `value_group_members` — staleness is made
structurally impossible rather than guarded (§9.6 applied one layer up; the
same cure `value_claims` used by having no `closed_at`).

Precedence is fixed and tested (a claimed unit is *also* absent from the
live pool, so claims must win):

1. `already_claimed` — the member's `unitKey` appears in `listClaimsForProject`.
2. `available` — otherwise, present in the live `assembleValuePool` output.
3. `no_longer_in_pool` — otherwise (reattributed, discarded, repo remapped).

**Partition assertion:** every member lands in **exactly one** bucket, never
zero, never two; the per-group counts sum to the member row count.

### 3.5 Propose outcome — `GROUP_PROPOSE_OUTCOMES` (response-level, not a run state)

`POST /groups/propose` always answers with an `outcome`:

- `started` (202) — a new run row was created `in_progress`.
- `reused_unchanged` (200) — input digest matches the most recent
  `completed`/`completed_zero_groups` run; that run's proposals are returned
  and **no LLM is spawned** (PM-4). A `failed` run is **never** reused, even
  on a digest match.
- `already_running` (200) — a run for this project is `in_progress`; the
  existing run is returned, no second spawn.
- `blocked_coverage_incomplete` (409) — the gate rejected the request.

### 3.6 Gate state — `GROUP_GATE_STATES` (kept OUT of the run enum, QA §1c)

`["ready", "blocked_coverage_incomplete"]`, carried on **both** `GET /groups`
and the 409 body, alongside the full `coverageSnapshot` so the client reuses
its existing coverage/ETA rendering instead of a second error shape. A gate
rejection is **not** a run outcome and must never be folded into §3.1.

### 3.7 Ungrouped-unit disclosure — `UNGROUPED_REASONS` (AC-3)

`["no_shared_signal", "not_selected_by_refinement"]`. Every pool unit that
ends up in no proposal is counted under exactly one reason and surfaced as
`ungrouped_unit_count` + a per-reason breakdown on the run. **No unit is ever
silently absent from every group.**

### 3.8 Registry-at-the-CJS/Vite-boundary obligation (PM-5c)

Each of the six registries above needs a hand-maintained client mirror (the
§9.7-accepted exception — a CJS server module cannot cross the Vite
boundary) plus keys in **four** locale files
(`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`, the namespace
that already owns `planLedger.*`). **Each mirror gets the anchored
exemption-set assertion from day one** — `assert.deepEqual(exemptStates,
[<reviewed list>])`, the two-line shape that closed N2 — so a 5th value
breaks the test at the point of growth. A derived enumeration whose miss
branch is `if (!key) continue;` is a hand-typed scan in derived clothing and
does not satisfy this.

---

## 4. Schema — three new tables (`server/db.js`)

All three are brand-new: plain `CREATE TABLE IF NOT EXISTS` inside the
existing `db.exec(...)` block. **Zero `ALTER TABLE`, zero `UPGRADE_CASES`
entry, zero `PRAGMA table_info` guard** — §9.6's "prefer inapplicability over
compliance" applies literally (§9.5's "does an old DB get the column"
acceptance criterion does not apply; there is no column being added to an
existing table). Any later CHECK widening routes through
`rebuildTableAtomically` (`server/db.js:1664`) + a `REBUILD_CASES` entry —
never a hand-rolled rename/create/copy/drop.

```sql
-- One row per grouping attempt. Direct structural analogue of
-- value_summary_sweep_state: it exists so that "no groups" can be told apart
-- from "never tried" (§9.8 live instance #1). `not_attempted` is the ABSENCE
-- of a row here and is never written.
CREATE TABLE IF NOT EXISTS value_group_runs (
  id TEXT PRIMARY KEY,                     -- `${projectId}::${startedAt}::${rand}`
  project_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN
    ('in_progress','completed','completed_zero_groups','failed')),
  input_digest TEXT,                       -- PM-4 cache key; NULL only while in_progress
  model TEXT,                              -- summaryModel("grouping")'s resolved value
  batch_count INTEGER NOT NULL DEFAULT 0,
  oversized_batch_count INTEGER NOT NULL DEFAULT 0,  -- a single cluster over budget is
                                                     -- NEVER split; it becomes its own
                                                     -- batch and is disclosed here
  group_count INTEGER NOT NULL DEFAULT 0,
  ungrouped_no_signal INTEGER NOT NULL DEFAULT 0,        -- UNGROUPED_REASONS, AC-3
  ungrouped_not_selected INTEGER NOT NULL DEFAULT 0,
  error_reason TEXT,                       -- non-NULL iff state='failed'
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT                        -- NULL iff state='in_progress'
);
CREATE INDEX IF NOT EXISTS idx_value_group_runs_project
  ON value_group_runs(project_id, started_at, id);   -- §9.2: time key, id tiebreak

-- One row per proposed group. NOTE: no project_id column — it is reachable
-- through run_id and copying it would be §9.1's write-sequence form.
CREATE TABLE IF NOT EXISTS value_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES value_group_runs(id),
  name TEXT,                               -- NULL unless refinement_state='refined'
  summary_sentence TEXT,                   -- NULL unless refinement_state='refined'
  rationale TEXT,                          -- NULL unless refinement_state='refined'
  pregroup_signal TEXT NOT NULL CHECK(pregroup_signal IN
    ('slug','time','surface','mixed')),
  refinement_state TEXT NOT NULL DEFAULT 'pending' CHECK(refinement_state IN
    ('pending','refined','zero_members','failed')),
  review_status TEXT NOT NULL DEFAULT 'proposed' CHECK(review_status IN
    ('proposed','approved','dismissed','claimed')),
  -- 'claimed' is RESERVED for Slice 4 (a CHECK is rebuild-to-widen, WATCH-4)
  -- and is UNREACHABLE in Slice 3 — proven by a structural scan, not by prose.
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  refined_at TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_value_groups_run ON value_groups(run_id, created_at, id);

-- Membership is ROWS, mirroring value_claims (there is no precedent in this
-- schema for a queryable set stored as a JSON array). Deliberately carries NO
-- availability column: that is derived at read time (§3.4).
CREATE TABLE IF NOT EXISTS value_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES value_groups(id),
  value_source TEXT NOT NULL CHECK(value_source IN
    ('trunk_commit','merge_commit','intake_initiative','detour','focus_segment')),
  value_ref TEXT NOT NULL,
  source_cwd TEXT NOT NULL DEFAULT ''      -- '' not NULL so the UNIQUE index bites
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_value_group_members_unit_group
  ON value_group_members(group_id, value_source, value_ref, source_cwd);
CREATE INDEX IF NOT EXISTS idx_value_group_members_group
  ON value_group_members(group_id);
```

**Two schema-level obligations:**

1. The `value_source` CHECK list must be **asserted equal to
   `valueLedger.VALUE_SOURCES`** in a test (§9.1 rule 2: validate against the
   registry, never a typed literal). Same for `value_claims`' existing list —
   reuse its precedent, do not fork it.
2. The member row stores the `(value_source, value_ref, source_cwd)` triple;
   the wire `unitKey` is produced by **`valueLedger.unitKey(...)`**, the one
   existing formatter. `value-groups.js` must never string-concatenate a
   unitKey itself (§9.1 rogue re-derivation).

**Prepared statements** (`server/db.js`, beside the existing value-pool
statements): `insertValueGroupRun`, `updateValueGroupRunState`,
`getLatestValueGroupRun`, `getValueGroupRun`, `listValueGroupRunsForProject`,
`markInterruptedValueGroupRuns`, `insertValueGroup`, `listValueGroupsForRun`,
`getValueGroup`, `setValueGroupReviewStatus`, `insertValueGroupMember`,
`listValueGroupMembersForRun`.

---

## 5. Module design — `server/lib/value-groups.js` (the one new home)

Architectural posture is `value-summary.js`'s, verbatim: **this module never
calls `assembleValuePool` itself.** Route handlers resolve the pool and the
units' cached altitude text and pass them in. Nothing in the route layer or
the client may compute a cluster, a membership decision, or a group-level
rollup number.

### 5.1 Stage 1 — mechanical pre-grouping (pure, deterministic, zero LLM, zero DB)

```js
mechanicalPreGroup(units) -> {
  clusters: [{ clusterId, signal: "slug"|"time"|"surface", memberUnitKeys: string[], anchor?: string }],
  ungrouped: [{ unitKey, reason: "no_shared_signal" }],
  signalAudit: { slug: {...}, time: {..., units_without_timestamp: n}, surface: {...} }
}
```

- **Deterministic and LLM-free** (AC-1). `clusterId` is a stable hash of
  `signal + sorted memberUnitKeys`. Running it twice on the same pool yields
  byte-identical output. It takes no `dbModule` and does no `await` — so its
  spec needs **zero spawn mocking**.
- **Over-generation is by design**: a unit may appear in more than one
  cluster (slug *and* time). Resolving the overlap is the LLM stage's job.
- **Slug signal** — pure string match over fields the pool already carries
  (verified live in `value-ledger.js:219-262`): `intake_initiative` units
  have `value_ref`/`label` = the slug; `merge_commit` units have `label` =
  `` `Merge effort/${slug}` ``; `trunk_commit` units have `label` = the commit
  subject. A commit unit clusters with an initiative unit when the subject
  contains the slug substring or `effort/<slug>`. **No second git walk, no
  second `intake-scan.js` read** — this closes the engineer's feasibility
  item #1.
- **Time-adjacency signal** — bucket by **local calendar day**, reusing
  `focus-summary.js`'s already-exported `localDayLabel` (`focus-summary.js:363`,
  exported at `:563-564`). Do **not** invent a second duration constant; this
  project has exactly one canonical definition of a synthesis time bucket.
  Units carrying no timestamp (`intake_initiative`, `merge_commit` — they have
  no `seen_at`) are **ineligible for this signal only** and that count is
  reported in `signalAudit.time.units_without_timestamp` — never a silent skip.
  **WATCH-S3-C: the declaring comment must cite the measured distribution
  from the live pool (~102 units today, 182 recorded). A bound comment that
  cannot name a number does not ship.**
- **Shared-surface signal** — v1 is a conservative label/path-substring proxy
  over commit subjects, **not** commit-diff file-path analysis (the pool's
  unit objects carry no file paths; adding them is real per-unit cost at
  200-unit scale). This narrowing is tracked as **WATCH-S3-B**, not prose.

### 5.2 Stage 2 — LLM refinement (one sonnet call per batch)

```js
groupingFacts(unit, cachedText) -> { unitKey, value_source, label, stage, seen_at, project_level, stakeholder_level }
buildGroupingPrompt(clusters, factsByKey) -> string
parseGroupingOutput(stdout, clusters) -> [{ name, summary, rationale, memberUnitKeys }] | null
refineBatch(clusters, factsByKey, { model }) -> ...
```

- **Prompt shape** mirrors `value-summary.js`'s `buildPrompt` idiom —
  numbered structured fact lines, never a hand-composed prose paragraph:
  ```
  CLUSTER 1 (signal=slug, anchor=intake_initiative:2026-08-04-value-pool-grouping):
    - [trunk_commit] <label> — <cached PROJECT/STAKEHOLDER text>
  ```
- **Member text is the already-cached `value_unit_summaries` text**, read via
  the existing `getValueUnitSummary` statement. **Never re-synthesized. Never
  a second LLM call over a unit.** `value-groups.js` **writes nothing** to
  `value_unit_summaries` — the existing WATCH-6 guard set does **not** widen
  (architect ruling 3, engineer §4, both confirmed).
- **Spawn path, pinned** (the engineer flagged this as untraced): use
  `runClaudePromptJson(prompt, { model })` from `./focus-inference` — the
  same import `value-summary.js:64` already uses (`value-summary.js:517`).
  Do **not** introduce a second spawn idiom, and do **not** route through
  `focus-summary.js`.
- **Model:** `summaryModel("grouping")` — the first real caller of the
  already-built cascade. No new model work, no calibration (DEC-10).
- **`parseGroupingOutput` is a strict whitelist** (QA §5.4): only `name`,
  `summary`, `rationale`, `memberUnitKeys` are read from the model's JSON.
  **Any other field is discarded, including `status`/`review_status`/
  `claimed`.** `review_status` is set to `'proposed'` unconditionally on
  insert, never from model output. Member keys not present in the input
  cluster set are dropped and counted — the model cannot invent membership.

### 5.3 Hierarchical decomposition and rollup

- **Budget:** `MAX_UNITS_PER_GROUPING_PROMPT`, sized against and citing the
  same measured distribution `MAX_UNITS_PER_PROMPT = 40` was sized against
  (182-unit measured max, DEC-12). Comment must name the number.
- **Batching packs whole clusters.** A cluster's `memberUnitKeys` is **never
  split across two calls** — the group-level analogue of "no cap ever drops a
  whole day." A single cluster larger than the budget becomes its own
  oversized batch (never truncated); the count is disclosed on the run row.
- **Decompose:** no candidate cluster is ever dropped from consideration
  because the pool exceeded one prompt's worth. Guaranteed a batch, always.
- **Rollup:** when `batch_count > 1`, **one** additional sonnet call over the
  leaf groups' `(name, summary, member_count)` — *not* full member text —
  merges duplicates across batch boundaries. Member unitKeys are carried
  forward **by reference**; the rollup only decides which leaf groups are the
  same real thing. Only final post-rollup groups persist (O-6: no
  intermediate rows, no `parent_group_id`).
- **Disclose:** a batch whose call fails/times out **still persists its
  clusters as groups** with `refinement_state='failed'` (signal + members,
  no LLM text). It is never silently merged into "zero groups," and the run
  as a whole is `completed`, not `failed`, if other batches succeeded. Run
  `failed` is reserved for a pass that produced no group rows at all.

### 5.4 Cost-control cache (PM-4, minimum honest form)

```js
computeGroupingDigest(units, clusters) -> string   // stable hash
GROUPING_UNCOMPARED_FIELD_GUARANTORS = { /* enumerated exceptions, each named */ }
```

- **Reuse Slice 1's comparator shape; do not invent a second digest
  formula** (§9.1 rogue re-derivation). `groupingFacts` is built **on top of**
  `value-summary.js`'s exported `unitFacts(unit)` — the existing single
  prompt-input-set function — extended with the two fields grouping actually
  renders (`seen_at` for the time signal, the cached altitude text) plus
  `unitKey`. The digest is computed over the sorted `groupingFacts` list and
  the sorted cluster membership.
- **The digest input set and the prompt input set are the same object by
  construction:** `buildGroupingPrompt` may read unit fields **only** via
  `groupingFacts` — enforced by the same structural scan
  `single-writer-guard.test.js` already runs on `buildPrompt`
  (`single-writer-guard.test.js:485`, DEC-24 strong form). Copy that test's
  shape, not just its intent.
- **Mandatory coverage test (`UNCOMPARED_FIELD_GUARANTORS` shape, the fix
  this project already proved on 2026-08-05):** walk
  `Object.keys(groupingFacts(fixture))`, mutate each key, assert the digest
  changes — with the excepted set asserted to be **exactly** the reviewed
  list. Slice 1 shipped the one-directional version of this with a header
  comment claiming the gap was physically impossible. **Do not ship that
  comment again without the loop that proves it.**
- On propose: digest match against the most recent
  `completed`/`completed_zero_groups` run → `reused_unchanged`, **no spawn**.
  A `failed` run is never reused. This is also, mechanically, Sara's "tell me
  when something I saw before has changed" signal.

### 5.5 Read-time drift safety (PM-1, §3.4)

```js
resolveMemberAvailability(memberRows, liveUnits, claims) -> {
  byGroupId: { [id]: [{ unitKey, availability }] },
  countsByGroupId: { [id]: { available, already_claimed, no_longer_in_pool } }
}
```

Pure function, no DB, no persistence. The route passes live
`assembleValuePool` units and `listClaimsForProject` rows in. **IN scope:**
display-time truth on `GET /groups`. **OUT of scope, explicitly:** no
write-back to `value_group_members`, no auto-dismiss of a fully-departed
group, no re-proposal, no claim-time conflict resolution — those are Slice
4's and are tracked as **WATCH-S3-A**.

### 5.6 Orchestration and interrupted runs

`runGroupingPass(dbModule, projectId, units, factsByKey)` is the **sole
writer** of all three tables. It writes the run row `in_progress` before any
spawn, then groups+members, then the terminal state; any throw lands
`state='failed'` with `error_reason`. An `in_progress` row cannot outlive the
process honestly, so add
`reconcileInterruptedGroupRuns(dbModule)` — flips surviving `in_progress`
rows to `failed` / `error_reason='interrupted_restart'` — called once at boot
beside the existing tick start (`server/index.js:465-470`, same try/catch
posture). Without it, a crashed run renders "running" forever: an
overloaded-absence with a spinner on it.

---

## 6. SF-4 extraction — MANDATORY in this slice (PM-2)

**Deferral is not available.** The catalog's trigger names this slice
literally ("extract `buildProbeCoverage` when Slice 3's consumer lands"), and
Slice 3's coverage gate **is** that consumer. Without the extraction, the
gate is the **third hand-copy by construction**, into a pair of handlers that
have already diverged once on `requestedAt`.

**New file `server/lib/value-coverage-probe.js`** (not folded into
`value-coverage.js`, whose own header at lines 12-18 states it contains "NO
pool-membership SQL and NO membership query of its own" — `buildProbeCoverage`
must call `assembleValuePool` directly and would contradict that contract):

```js
async function buildProbeCoverage(dbModule, projectId, opts = {}) {
  const { units } = await valueLedger.assembleValuePool(dbModule, { id: projectId });
  const { counts } = await enrichPoolAltitudes(dbModule, units, { probe: true });
  let requestedAt;
  if (Object.prototype.hasOwnProperty.call(opts, "requestedAt")) {
    requestedAt = opts.requestedAt;              // caller has a fresher value (POST)
  } else {
    const state = dbModule.stmts.getValueSweepState.get(projectId);
    requestedAt = state ? state.coverage_requested_at : null;
  }
  return coverageSnapshot(dbModule, {
    projectId, counts, requestedAt,
    draining: isDrainingProject(projectId),
    computedAt: new Date().toISOString(),
  });
}
```

**Preserve the `requestedAt` divergence — it is load-bearing, not a bug to
erase.** POST cannot re-read `getValueSweepState` without racing the
fire-and-forget drain it just kicked (SF-2/SF-3; the rationale comment lives
at `project-plans.js:320-327` and must move with the code). The extraction
**parameterises** the difference; a guard that forced the two routes to
behave identically here would re-introduce a fixed bug.

**Exactly three call sites, all landing in this slice:**

1. `POST /coverage-request` — `buildProbeCoverage(dbModule, projectId, { requestedAt: nowIso })`
2. `GET /coverage` — `buildProbeCoverage(dbModule, projectId)`
3. `POST /groups/propose` (the gate) — `buildProbeCoverage(dbModule, projectId)`, reads `.complete`

### 6.1 T7 must be DELETED and REPLACED in the same commit (WATCH-S3-D)

`server/__tests__/project-plans-api.test.js:905` — "T7 (SF-4)" — asserts each
handler **body** literally contains
`await valueLedger.assembleValuePool(dbModule, { id: projectId })` and
`await enrichPoolAltitudes(dbModule, units, { probe: true })` (lines 921-938).
After extraction those lines are gone from both handlers and **T7 goes red by
design.** It is deleted and replaced in the same commit. It is **never
"adjusted until it passes"** — that is the §9.4-named temptation this
project's Slice-2 implementer was praised for refusing. The half of T7 worth
keeping is its anchored assertion on each route's **response** key set
(`project-plans-api.test.js:890-902`, T6) — that survives, untouched. (BO-2
correction: T7 is deleted **in full** — zero lines of T7 itself survive; the
survivor, T6, is a *different, pre-existing* assertion adjacent to T7, not a
fragment of T7.)

**T7-successor table (BO-2, added post-build; each claim independently
red-proven before landing):**

| T7 claim | Successor | Priority |
|---|---|---|
| T7-C1 — both handlers call `assembleValuePool(dbModule, {id: projectId})` | `single-writer-guard.test.js` G-2 + `value-coverage-probe.test.js` P-1 | `[M]` |
| T7-C2 — both call `enrichPoolAltitudes(..., {probe: true})` | G-2 + P-5 | `[M]` |
| T7-C3 — both pass `draining: isDrainingProject(projectId)` | P-6 | `[M]` |
| T7-C4 — `postKeys === getKeys` (route↔route parity) | **Deliberately NOT replaced** (DEC-S3-4) | `[M]` (negative) |
| T7-C5 — `postKeys === [computedAt,counts,draining,projectId,requestedAt]` | P-7 (behavioral spy) + P-8 | `[M]` |

DoD line: ~~"T7 deleted"~~ → **"every T7 claim has a named successor, each
observed red."**

### 6.2 The replacement guard — single-call-site, NOT route↔route parity (O-3)

In `server/__tests__/single-writer-guard.test.js`, same shape as the existing
`requestValueCoverage` case (lines 346-385):

- `buildProbeCoverage` is **defined exactly once**, in
  `server/lib/value-coverage-probe.js`.
- Its **call-site set is exactly three**, at the three handlers above, each
  appearing exactly once lexically inside its own handler body. **(Build-time
  widening, documented in `single-writer-guard.test.js`'s G-2: `GET /groups`
  turned out to need its own fresh gate/coverage read too — §7's own response
  shape `{run, groups, gate, coverage}`, exercised by the TT-read mid-flight-
  regression case. The count is 4 in the shipped build, not 3 — still one
  composition, never a hand-copy; the guard's own exact-count assertion moved
  with it, in the same commit as the route.)**
- **Scope is derived**, by scanning `server/lib` + `server/routes` + `bin/`
  for importers, and **fails closed** on any importer with no disposition. A
  derived scope whose miss branch `continue`s is a hand-typed scan in derived
  clothing (§9.7's sharper statement).
- Plus `assertSingleHome("../lib/value-coverage-probe", { "../routes/project-plans": {...} })`.
- **Red-proof:** inject a fourth hand-copy of the 4-step composition into a
  route handler, watch the guard fail, restore byte-identical. **Performed,
  not reported** — and re-run by someone other than its author (§9.3
  AGENT-SELF-REPORTED-RED).
- **Do not add a route↔route parity assertion.** Both sides call one
  function; `deepEqual(A, B)` becomes `deepEqual(f(X), f(X))`.
- `server/__tests__/value-coverage-parity.test.js` (G2, route↔tick) must keep
  passing **unmodified** — neither side of that comparison changes shape.

---

## 7. Route surface (`server/routes/project-plans.js`)

All four handlers sit beside the existing `/coverage` handlers. Response
shapes are additive; no existing response changes.

**`POST /api/project-plans/groups/propose` `{project_id}`**
1. Validate `project_id` (400 `INVALID_INPUT`, existing idiom).
2. `const coverage = await buildProbeCoverage(dbModule, projectId);`
   If `!coverage.complete` → **409** `{ outcome: "blocked_coverage_incomplete",
   gate: "blocked_coverage_incomplete", coverage, error: { code:
   "COVERAGE_INCOMPLETE", ... } }` — the full snapshot rides along so the
   client reuses its existing coverage/ETA rendering (AC-6/AC-7). **The gate
   is server-side and non-negotiable** (DEC-2's binding condition); the client
   gate mirrors it, never replaces it.
3. If a run is `in_progress` → 200 `already_running` with that run.
4. Assemble the pool + cached altitude text; `mechanicalPreGroup`; compute
   digest. Digest match on the latest completed run → 200 `reused_unchanged`
   with that run's proposals, **no spawn**.
5. Otherwise `runGroupingPass(...)` → 202 `started`.

**`GET /api/project-plans/groups?project_id=`** — returns
`{ run, groups, gate, coverage }` where `run.state ∈ GROUP_RUN_STATES`
(`not_attempted` when no row exists), each group carries
`refinement_state`, `review_status`, `name`, `summary_sentence`, `rationale`,
`members: [{ unitKey, availability }]`, and `member_availability_counts`
computed **server-side** (§3.4). Ordering: `created_at ASC, id ASC` (§9.2 —
never insertion id alone).

**`POST /api/project-plans/groups/:id/approve`** and
**`POST /api/project-plans/groups/:id/dismiss`** — two named routes, **not**
one `/review {status}` route. A body-supplied status is a hole through which
`claimed` reaches the DB; two verbs close it structurally and match the UI
copy exactly (O-5). Each is a pure `review_status` + `reviewed_at` update via
`setValueGroupReviewStatus`, never a delete/recreate, and touches no plan
item, milestone, or claim.

---

## 8. Client surface (`client/src/components/PlanLedgerPanel.tsx`)

Extends the existing panel (no new page). Renders **verbatim** what the
server computed — no client-side member count, no coverage-of-members math,
no rollup formula (§9.1's rogue re-derivation sub-form is the named risk
here, not just a rogue read).

- **Auto-group button**, in the same pane as the existing coverage header.
  **Disabled while `!coverage.complete`**; its disabled affordance references
  the **existing** coverage header ETA and reuses the **existing**
  `handlePrioritizeNow` / single `prioritize-now-button` — **no second
  prioritize-now control, no duplicate handler, no duplicate locale keys**
  (PO §5, satisfying AC-7's inherited language).
- **Proposal list**: name, summary sentence, rationale, member count and
  member `unitKey`s with their per-member availability chip. Run state and
  ungrouped-unit disclosure ("N units not yet grouped", AC-3) always visible.
- **Approve / Dismiss** per group. **No "Approve & claim". No claim-target
  picker. No plan-item create/edit affordance.** (PO §7/§8 fence — if any of
  those appear in the diff, the slice has grown; cut it back.)
- **PM-5a MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH (binding).** `ProjectDetail.tsx:1292`
  renders this panel **unkeyed**, so React reuses its state across a project
  switch, and every field the panel gains inherits the leak (`altitudes` and
  `requestedAltitudesRef` already did). **Every new entity-scoped state — the
  group list, the run state, any in-flight proposal request — resets on
  `projectId` change**, structurally, in the same `useEffect` shape SF-8
  already established (`PlanLedgerPanel.tsx:748-775`). The new spec carries a
  *"switch the id, assert the state followed and the old project's groups are
  gone"* case, **with at least one case holding a response open across the
  transition** — the quiescent-only fixture is exactly how the Slice 2 fix
  looked complete while the in-flight leak stayed live.
- **PM-5b STRICTMODE-BLIND CLIENT SUITE (binding).** This candidate *fired*
  on this exact component in Slice 2 (BL-2): a `useRef(true)` +
  cleanup-only `useEffect` meant that under `npm run dev` **no unit ever
  rendered its text**, with an 817/817 green suite over it. **Any new
  effect/ref must re-arm in setup whatever it tears down in cleanup, and at
  least one new Slice 3 client test renders under `<StrictMode>`.**
- API client: add `groups`, `proposeGroups`, `approveGroup`, `dismissGroup`
  to `client/src/lib/api.ts:2654`'s `projectPlans` block, beside `coverage`
  (`:2797`) — same `request<T>` idiom, same error posture.

---

## 9. Change set (exact files)

### New — server
| Path | Contents |
|---|---|
| `server/lib/value-coverage-probe.js` | `buildProbeCoverage` (SF-4 extraction) |
| `server/lib/value-groups.js` | 6 state registries, `UNGROUPED_REASONS`, `MAX_UNITS_PER_GROUPING_PROMPT`, `mechanicalPreGroup`, `groupingFacts`, `GROUPING_UNCOMPARED_FIELD_GUARANTORS`, `buildGroupingPrompt`, `parseGroupingOutput`, `refineBatch`, `rollupGroups`, `computeGroupingDigest`, `resolveMemberAvailability`, `runGroupingPass`, `reconcileInterruptedGroupRuns` |

### New — tests
`server/__tests__/value-groups-mechanical.test.js` (LLM-free stage),
`server/__tests__/value-groups-refinement.test.js` (stubbed spawn, persistence, rollup, disclose),
`server/__tests__/value-groups-api.test.js` (routes, gate, drift, negative proof),
`server/__tests__/value-coverage-probe.test.js` (extraction behavior),
`client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx`.

### Edited — server
| Path | Change |
|---|---|
| `server/db.js` | three `CREATE TABLE IF NOT EXISTS` blocks (§4) + ~12 prepared statements |
| `server/routes/project-plans.js` | both coverage handlers call `buildProbeCoverage` (replacing the inlined 4 steps at `:318-334` and `:351-365`, moving the SF-2/SF-3 rationale comment with it); 4 new group handlers |
| `server/lib/value-ledger.js:70-74` | `CONSUMERS` gains `"server/lib/value-groups.js (derived-values reader: pre-grouping + member availability)"` — same commit as the consumer (O-8) |
| `server/index.js:465-470` | `reconcileInterruptedGroupRuns(dbModule)` at boot, same try/catch posture as the tick start |
| `server/openapi.js` / `server/openapi-extra/plans.js` | document the 4 new endpoints (repo convention) |

### Edited — tests
| Path | Change |
|---|---|
| `server/__tests__/project-plans-api.test.js` | **DELETE T7 (line 905)**; keep the response-key-set anchor at `:890-902` |
| `server/__tests__/single-writer-guard.test.js` | new `buildProbeCoverage` single-call-site guard; new `insertValueGroup*` / `updateValueGroupRunState` writer guards; `assertSingleHome` for `../lib/value-groups` and `../lib/value-coverage-probe`; **consumer-map additions for `../lib/value-ledger` (`:467`) and `../lib/value-summary` (`:413`) naming `../lib/value-groups`**, dispositions for **every** export on both |
| `server/__tests__/chronology-ordering.test.js` | add `value-groups.js` (and `value-coverage-probe.js`) to `filesToScan` |
| `server/__tests__/db-migration.test.js` | **no `UPGRADE_CASES`/`REBUILD_CASES` entry** — new tables (§9.6). Confirm the registry-completeness meta-test still passes |
| `server/__tests__/ledger-metrics-parity.test.js` | BO-4 addition (missing from this table originally): C2.4's `CONSUMERS` literal, title, and failure message updated to the widened 4-entry set (BO-3) in the SAME commit `value-ledger.js` gains the `value-groups.js` consumer entry — otherwise C2.4 goes red by construction with no planned successor |

### Edited — client
`client/src/components/PlanLedgerPanel.tsx`,
`client/src/lib/api.ts`,
`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` (all four, same commit),
`client/src/pages/__tests__/screens.snapshot.test.tsx` (review the diff, regenerate deliberately with `cd client && npx vitest run -u` — never blind-update).

### Edited — docs
`PROJECT-CONTEXT.md` (SF-4 → build-outcome note; N2's stale "OPEN" already corrected by the PM), `README`/`ARCHITECTURE`/`SETUP` where the new endpoints/tables/env surface appear — apply the `update-project-docs` skill at the end of the change set, unprompted.

**File headers:** every new `.js`/`.tsx` file starts with the file-overview
header + the exact line `@author Son Nguyen <hoangson091104@gmail.com>`.
`bash .claude/skills/file-headers/scripts/check-headers.sh` must exit 0 —
re-run after each new file lands, not only at the end.

---

## 10. Implementation steps (ordered; each independently checkable)

1. **Schema + statements** (`server/db.js`, §4) — plus the test asserting the
   member `value_source` CHECK list equals `valueLedger.VALUE_SOURCES`.
   *Check:* boot on a copy of a real DB; the three tables exist; `db-migration`
   suite green with no new registry entries.
2. **SF-4 extraction** — create `value-coverage-probe.js`, rewrite both
   coverage handlers, **delete T7**, add the single-call-site guard +
   `assertSingleHome`, red-prove by injecting a fourth hand-copy.
   *Check:* `node --test server/__tests__/project-plans-api.test.js` and
   `value-coverage-parity.test.js` green **unmodified**; injected copy fails
   the new guard.
   *Sequenced second on purpose:* the gate must be `buildProbeCoverage`'s
   third call site from day one, never a fourth copy "cleaned up later."
3. **Registries + `CONSUMERS` + `assertSingleHome` maps** — create
   `value-groups.js` with only its six registries and constants; register it
   in `CONSUMERS`; update both existing consumer maps.
   *Check:* the anchored exemption-set assertions exist and are red-proven by
   adding a 5th value locally.
4. **Mechanical stage** (`mechanicalPreGroup`, `groupingFacts`) with its own
   spec — **zero spawn mocking**, fixture-anchored membership assertions.
   *Check:* red-prove by disabling one heuristic branch; the specific expected
   cluster goes missing; restore byte-identical; re-run green.
5. **Digest + cache** (`computeGroupingDigest`,
   `GROUPING_UNCOMPARED_FIELD_GUARANTORS`) + the key-walking coverage test +
   the `buildGroupingPrompt`-reads-only-`groupingFacts` structural scan.
6. **Refinement + rollup + orchestration** (`buildGroupingPrompt`,
   `parseGroupingOutput`, `refineBatch`, `rollupGroups`, `runGroupingPass`,
   `reconcileInterruptedGroupRuns`) with a stubbed spawn.
   *Check:* persisted row content matches the stub fixture field-by-field;
   a failed batch persists as `refinement_state='failed'` with its members;
   an oversized cluster is never split.
7. **Drift resolution** (`resolveMemberAvailability`) + its partition test.
8. **Routes** (propose / list / approve / dismiss) + the gate + the
   negative proof (§11.4).
9. **Boot hook** in `server/index.js`.
10. **Client**: api methods → registry mirrors + 4 locale files → panel UI →
    entity-switch and StrictMode specs → snapshot review.
11. **Docs sync** (`update-project-docs`), header audit, full suites.

---

## 11. Testing & verification (QA's checklist, folded in as build obligations)

Run: `npm run test:server`, `npm run test:client`; single spec
`node --test server/__tests__/<file>.test.js`.

### 11.1 §9.8 — the four named wire states + the MANDATORY combination test
Each of `not_attempted` / `in_progress` / `completed_zero_groups` / `failed`
must be **independently reachable and independently asserted** — declaring
the registry is not evidence. Then, **one test exercising the combination,
not four isolated branches** (§9.8's own instruction): a project with
**incomplete coverage AND a prior `failed` run AND a re-run request** must
respond `blocked_coverage_incomplete` — not resurrect the stale `failed`
state, not silently attempt the run. Model it as a DEC-11-style **truth
table** over state × gate, not one test per state.

### 11.2 §9.3 — guards that can actually go red
- **Mechanical stage:** assert computed membership against a known fixture —
  never `Array.isArray` / "a non-empty array was returned". Red-proven by
  disabling one heuristic.
- **Persistence:** assert persisted **row content** (members, name,
  rationale, summary) against the stub input, and that a partial/failed run
  does not silently promote a group to `refined`. Red-proven by dropping a
  field before insert.
- **Digest:** red-proven by mutating each `groupingFacts` key.
- **Every red proof is performed and independently re-run, not reported**
  (§9.3 AGENT-SELF-REPORTED-RED).
- **Sweep before declaring any guard done:** `grep -rn "assert.ok(true"
  server/__tests__/` and `grep -rn "|| true" server/__tests__/` both return
  0 for new/edited specs; additionally grep new specs for `typeof `,
  `Array.isArray`, bare `assert.ok(` with no compared value, and empty
  `=> {}` bodies — the first two sweeps catch none of those four.
- **Adversarial review pass, budgeted and independent of build/verify.** On
  this file family the reviewer has found blockers a *correctly executed*
  verifier mutation pass had already certified green, three builds running.
  **`intake-qa` and `build-reviewer` are non-trimmable here regardless of
  mode** (PM-6.1).

### 11.3 §9.1 — single home, anchored
Group data is computed once server-side. Any parity test anchors against a
**literal fixture** on both sides (two `deepEqual`s against the anchor, not
one `deepEqual` between two derived views). The guard must be able to catch a
re-**computation** (e.g. a client recomputing "how many members resolved"),
not merely a rogue read.

### 11.4 "Proposals never actions" — negative proof, both halves, both red-proven
1. **Structural scan:** `server/lib/value-groups.js` and the new route
   handlers contain **zero** call sites of the plan-claim writers —
   enumerated from the real write surface (`insertValueClaim`,
   `deleteValueClaim`, `server/db.js:3360,3375`), **not hand-guessed**.
2. **Behavioral:** run a full pass end-to-end (mechanical → stubbed
   refinement → persist) against a seeded DB and assert the `value_claims`
   row count is **unchanged** before/after — not merely that the response
   body looks like a proposal.
3. **Reserved-but-unreachable:** assert **zero code paths set
   `review_status = 'claimed'`** in Slice 3.
4. **Adversarial LLM response:** a model output containing
   `status: "claimed"` (or any other lifecycle field) must be discarded by
   the whitelist; the row inserts as `proposed`.
5. **Red-prove all four** by injecting a rogue claim write / a `claimed`
   assignment / an un-whitelisted field, confirming failure, then reverting.
   An unproven negative assertion is exactly as vacuous as a positive one.

### 11.5 §9.7 registry hygiene (same commit, no follow-ups)
`CONSUMERS` gains `value-groups.js`; `assertSingleHome` maps gain it on
**both** axes for `value-ledger.js` and `value-summary.js`; new
`assertSingleHome` entries for `value-groups.js` and
`value-coverage-probe.js`; importers enumerated by
`grep -rn "require(.*value-groups" server/lib server/routes bin/`, never by
memory. **Precedent to not repeat (SF-5, 2026-08-05): a build edited the very
map it needed to register itself in, and still didn't.** Being inside the map
while editing it is not sufficient.

### 11.6 Client
Entity-switch reset test **including one in-flight case across the
transition**; one `<StrictMode>` render test; four locale files updated
together; snapshot diffs reviewed, then regenerated deliberately.

---

## 12. Acceptance criteria → how each is proven

| AC | Criterion | Proof |
|---|---|---|
| **AC-1** | Mechanical pre-grouping is real, deterministic, LLM-free; same pool → same clusters | `value-groups-mechanical.test.js`: fixture-anchored membership, run twice → identical, spec requires **no spawn mock at all** |
| **AC-2** | One sonnet call per prompt's worth; each proposal has name + stakeholder sentence + member unitKeys + rationale | Stubbed-spawn test asserts exactly one spawn for a single-batch pool and all four fields non-NULL on every `refined` row; a proposal missing any field is a defect, not "done" |
| **AC-3** | Hierarchical decomposition exercised against a pool that **actually exceeds** the cap; nothing silently dropped; ungrouped units disclosed | Oversized-pool test asserts `batch_count > 1`, one rollup call, no cluster split, and `ungrouped_*` counts surfaced on the run and rendered |
| **AC-4** | Proposals persist and render; nothing auto-claims | Persistence content test + §11.4's negative proof + the PO §8 fence checked in review |
| **AC-5** | Approve/dismiss exist and are bookkeeping only | Route tests assert only `review_status`/`reviewed_at` change; `value_claims`, plans, and items row-counts unchanged; UI copy carries no "approve & claim" |
| **AC-6** | Gate is a pure read of `coverageSnapshot.complete`; absence states named | Gate test (server-side 409) + no client-side `described`/`pool_size` math anywhere + §11.1's truth table |
| **AC-7** | Group action visibly disabled until 100%, showing ETA and a "prioritize now" action | Client test: button disabled while `!coverage.complete`, affordance references the **existing** coverage header/ETA, and the **single existing** `prioritize-now-button`/`handlePrioritizeNow` is reused — a second control fails review |

---

## 13. Single-source-of-truth guardrail (this project's own convention)

This change touches three canonical-registry surfaces. Each MUST be routed
through, never hand-edited on one path:

1. **`assembleValuePool` is the sole pool composer (DEC-16).** No
   hand-rolled pool query anywhere in `value-groups.js` — grep it at review
   time for raw `SELECT` against `value_claims` / `detour_dispositions` /
   `project_paths`. New consumer registered in `CONSUMERS`
   (`value-ledger.js:70-74`) **in the same commit**.
2. **`buildProbeCoverage` is the sole probe-coverage composition.** Three
   call sites, one definition, derived-and-fails-closed scan (§6.2). Slice 3
   must not become the third hand-copy the WATCH was written to prevent.
3. **`assertSingleHome` consumer maps + the state registries.** Every export
   of every touched module gets an explicit disposition at every consumer;
   every new registry gets an anchored exemption-set assertion and its four
   locale files in the same commit. §9.7 has 7 recorded occurrences and this
   surface produced the most recent one — **a registration that lands "as a
   follow-up" is the failure, not a delay.**

---

## 14. Risks & rollback

**Rollback:** the whole slice is additive — three new tables, two new server
modules, four new routes, one panel extension. Reverting the effort branch
removes all of it; the three tables simply go unused (`CREATE TABLE IF NOT
EXISTS` leaves no migration to unwind, and nothing else reads them). The one
non-additive edit is the SF-4 extraction inside two existing handlers plus
T7's deletion; reverting restores the two hand-copies byte-for-byte. No
existing response shape, WS message type, or schema column changes.

**Watch during build:**
- The refinement pass is the longest-running action in the product; a 200-unit
  pool means multiple sequential sonnet calls. `in_progress` must be visible
  from the first moment, and `reconcileInterruptedGroupRuns` must exist before
  the first real run, or a crash leaves a permanent spinner.
- Prompt-budget arithmetic is where `value-summary.js` previously copied
  `focus-summary.js`'s cap and dropped both the decompose and disclose halves.
  That is the single most likely defect in this slice.

**Declined scope — each is a tracked row in `decisions.md`, not prose here**
(a disclosure that exists only as a sentence in this section is how a
declined-scope item becomes a live incident later; both items the architect
flagged in its own Return summary are carried forward here rather than
dropped at synthesis):

| Row | Declined now | Fires-on / Lands-in |
|---|---|---|
| **WATCH-S3-A** | Claim-time member re-validation (display-time truth does not make a *claim* safe — a member can leave the pool between render and click) | Slice 4's batch-claim build / Slice 4's claim route + its transaction test |
| **WATCH-S3-B** | Shared-surface heuristic narrowed to a label/path-substring proxy, not commit-diff file-path analysis (architect §3b, carried forward from its Return summary) | An observed real miss, or `trunk-drift.js` commit objects gaining cheap file paths / `value-groups.js`'s `mechanicalPreGroup` + its spec |
| **WATCH-S3-C** | Time-adjacency width must be measured, not guessed — the declaring comment cites the live-pool distribution | Build time / the constant's own declaring comment |
| **WATCH-S3-D** | T7 deleted, not adjusted, when SF-4 lands | The extraction commit / `project-plans-api.test.js:905` removal + the new call-site-set guard |
| **WATCH-S3-E** | No group-level WS broadcast in v1 (the panel refetches on the existing `value_altitudes_updated` message and on its own propose response) | A run whose completion the UI misses in practice / `server/lib/value-groups.js` + `PlanLedgerPanel`'s WS handler |
| **OPEN-S2-1** | Carried, still open: which real project validates the flow end to end | Non-blocking; recorded so it does not silently close |

---

## 15. Definition of Done

Schema & structure
- [ ] Three tables created as plain `CREATE TABLE IF NOT EXISTS`; **no**
      `UPGRADE_CASES`/`REBUILD_CASES` entry added; member `value_source`
      CHECK asserted equal to `valueLedger.VALUE_SOURCES`.
- [ ] `value_groups` carries no `project_id`, no `parent_group_id`, no
      `reviewed_by`; `value_group_members` carries **no** availability column.

States (§9.8)
- [ ] All six registries exported and mirrored client-side, each with an
      anchored exemption-set assertion; four locale files updated together.
- [ ] `not_attempted` / `in_progress` / `completed_zero_groups` / `failed`
      each independently reachable **and independently tested**.
- [ ] `blocked_coverage_incomplete` is a distinct signal from both
      `not_attempted` and `failed`; the **combination test** (incomplete
      coverage + prior failed run + re-request) exists and passes.
- [ ] Zero-member and failed-batch groups are named states, never missing rows.
- [ ] Every new bound (`MAX_UNITS_PER_GROUPING_PROMPT`, time-adjacency width,
      any timeout) cites a **measured number** in its declaring comment.

SF-4
- [ ] `buildProbeCoverage` defined once, exactly three call sites, derived
      scope failing closed, red-proven by injecting a fourth copy (re-run by a
      second party).
- [ ] **T7 deleted and replaced in the same commit** — not adjusted.
- [ ] **No route↔route parity guard added**; the anchored response-key-set
      assertions survive; `value-coverage-parity.test.js` passes unmodified.
- [ ] The `requestedAt` divergence preserved, with its SF-2/SF-3 rationale
      comment moved alongside the code.

Registries (§9.7)
- [ ] `CONSUMERS` includes `value-groups.js`; `assertSingleHome` updated on
      **both** axes for `value-ledger.js` and `value-summary.js`; new
      `assertSingleHome` entries for `value-groups.js` and
      `value-coverage-probe.js`; importers enumerated by grep.
- [ ] `chronology-ordering.test.js` `filesToScan` includes the new modules;
      every time-ordered query sorts by timestamp with an id tiebreak.
- [ ] WATCH-6 unchanged: `value-groups.js` writes nothing to
      `value_unit_summaries`; new tables have their own single-writer guards
      from day one.

Guards (§9.3) & negative proof
- [ ] Mechanical, persistence, and digest guards each assert real content and
      are each red-proven by mutation, performed and independently re-run.
- [ ] `assert.ok(true` / `|| true` sweep = 0; the four extra sweeps clean.
- [ ] Negative proof complete: structural scan (real writer names, enumerated)
      + claims-row-count-unchanged + zero `review_status='claimed'` paths +
      LLM-field whitelisting — **all four red-proven**.
- [ ] Adversarial review pass run independently of build/verify, before merge.

Product
- [ ] AC-1 … AC-7 each demonstrably met (§12).
- [ ] No claim-target picker, no plan-item create/edit UI, no batch claim, no
      "approve & claim" copy anywhere in the diff (PO §8).
- [ ] Entity-switch reset test with an in-flight case; one `<StrictMode>`
      client test; snapshots reviewed, not blind-updated.

Process
- [ ] `npm run test:server` green; `npm run test:client` green; new specs
      individually re-runnable.
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] `update-project-docs` applied; `PROJECT-CONTEXT.md`'s SF-4 entry updated
      to a build-outcome note.
- [ ] **Every open row whose `Fires-on` names this slice is dispositioned**
      (PM-6.2) — SF-4 ✔, AC-7 ✔, DEC-2 ✔, DEC-10 consumed ✔, DEC-3 cited ✔.
