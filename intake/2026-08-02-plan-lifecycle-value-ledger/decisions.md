# Decision Log — 2026-08-02-plan-lifecycle-value-ledger

Run mode: **auto-pilot** (`/team-intake auto`). PREFERENCE gates are decided
automatically as `DECIDED-AUTO` with the team's best recommendation; QUALITY
gates and required-input gates still stop.

---

## DEC-1 — Intake base folder resolution

- **Status:** DECIDED-AUTO (2026-08-02)
- **Question:** Which folder is the intake base for this request?
- **Where we're coming from:** The skill argument carried only the mode token
  (`auto`), no path. However, the request was specified verbatim in the
  invoking conversation, which ended with the recommendation to "drop the
  whole thing into this repo's intake/ as a request" — and Sara then invoked
  `/team-intake`. This repo's root is an established intake base
  (`intake/2026-08-01-build-project-manager/` et al.).
- **Options:** A) this repo root (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`);
  B) stop and ask.
- **Decision:** A. The location was named in the conversation ("this repo's
  intake/"), satisfying the required-input gate via the message rather than
  the argument. The request document was authored into the item folder from
  the conversation's settled rulings (which are also persisted in session
  memory `project_holistic-focus-history.md`).

---

## Pre-settled rulings imported from the design conversation (NOT re-litigable here)

These were decided by Sara in the 2026-08-02 design conversation before this
intake run started; they are constraints on the evaluation, not open
questions. Full wording in `request.md` ("Confirmed rulings").

- **DEC-P1 — DB-first** for the portfolio layer (plans/generations/ledger in
  this app's SQLite DB). DECIDED (Sara, 2026-08-02).
- **DEC-P2 — AGENT-PLAN.md inverts to import source / read-only view.**
  DECIDED (Sara, 2026-08-02).
- **DEC-P3 — File artifact layer stays foundational per-solution.** DECIDED
  (Sara, 2026-08-02).
- **DEC-P4 — Dashboard altitude = delivered value + desired value +
  reconciliation, nothing more.** DECIDED (Sara, 2026-08-02).
- **DEC-P5 — Multiple concurrent plans per project.** DECIDED (Sara,
  2026-08-02).
- **DEC-P6 — Closure invariant: value closes only through a plan.** DECIDED
  (Sara, 2026-08-02).

---

## Build-phase rows (appended by the tech lead, 2026-08-02)

Opened while writing `technical-plan.md`, reconciling the architect's §8
"must land as tracked rows, not prose" list with the PM's §8 open-decisions
list. Auto-pilot conventions: preference-level calls are recorded as
**DECIDED-AUTO** with the recommendation already taken (Sara may override any of
them without re-opening the build); **PENDING (Sara)** rows carry a
recommendation and do not stop the build unless noted; **WATCH** rows are
carried-forward risks with an owner and a trigger; **DEPENDENCY** rows are hard
sequencing gates.

> **Numbering note.** Inside this file a bare `DEC-n` means *this* item's log.
> Decisions from the prior effort are always cited in full, e.g.
> **`DEC-7 (2026-08-01-build-project-manager)`** — the still-open live-trial
> gate — to avoid collision with this log's own numbering.

---

### DEC-2 — Trunk-drift Phase 1a must merge before slice 1

- **Status:** DEPENDENCY — **SATISFIED (2026-08-02)**: trunk-drift Phase 1a merged to master at `554f7d1` (worktree/session check performed; conflicts resolved both-sides-kept; suites 1425/1425 server + 771/771 client post-merge).
- **What:** `intake/2026-08-02-trunk-drift-detection` **Phase 1a** must be on
  `master` before slice 1 of this build starts. It lands `server/lib/git-refs.js`
  (`execGit`, `resolveDefaultBranch`, `isGitRepo`) and `server/lib/trunk-drift.js`
  (`detectTrunkDrift(repoPath, { seenShas, lookbackDays, maxCommits, timeout })`).
- **Why:** the pool's direct-to-trunk feed *is* `detectTrunkDrift`; a second
  trunk walker would re-fragment a git surface intake explicitly consolidated
  (§9.1 at module scale). Three efforts currently hold `server/lib/`; the
  project's own memory records real work loss from concurrent sessions.
- **Note:** `server/lib/db-rebuild.js` / `rebuildTableAtomically` is trunk-drift
  **Phase 1b** and is *not* expected here — this design needs no rebuild, so the
  engineer's assumption that it arrives with the dependency is not relied on.
- **Trigger to close:** trunk-drift Phase 1a merged; `git worktree list` and
  running sessions checked before the first commit of slice 1.

### DEC-3 — Merged schema adopted (PM correction 2)

- **Status:** DECIDED-AUTO (2026-08-02)
- **Decision:** `project_plans` / `project_plan_items` / `value_claims`
  (architect's names) with the engineer's provenance columns folded in;
  generation ordinal **derived** by walking `succeeds_plan_id`, never stored;
  full final `value_source` (5), `attribution` (3) and `status` (2) vocabularies
  in the **initial** `CREATE TABLE` per WATCH-4 / DEC-15 of
  `2026-08-01-build-project-manager` (a `CHECK` is rebuild-to-widen); explicit
  snapshot columns, not a JSON blob; **closure derived by join, never copied
  onto claim rows**; `source_cwd NOT NULL DEFAULT ''` so the per-(unit,item)
  UNIQUE index actually bites. Full DDL in `technical-plan.md` §3.1.
- **Why:** the architect's and engineer's proposals were incompatible; leaving
  them open guarantees re-derivation at build time.

### DEC-4 — Trunk feed is the live `detectTrunkDrift()` call, with sha-level dedupe

- **Status:** DECIDED-AUTO (2026-08-02, PM correction 1)
- **Decision:** consume `detectTrunkDrift(repoRoot, { seenShas })` **live**
  (trunk-drift Phase 1a), *not* `detour_dispositions` rows with
  `source='trunk_drift'` (Phase 1b, which
  `intake/2026-08-02-trunk-drift-detection/decisions.md` DEC-1 gates on
  `DEC-7 (2026-08-01-build-project-manager)` — adopting it would transitively
  block this whole request on an unscheduled live trial).
- **Required guard:** a value unit's identity is `('trunk_commit', <sha>)`
  **regardless of feed**, deduped once at assembly. A `detour_dispositions` row
  with `source='trunk_drift'` maps to `('trunk_commit', source_ref)`; every other
  detour row maps to `('detour', <id>)`. Without this, the day Phase 1b lands
  every direct-to-trunk commit appears twice and the health metric doubles (R7).
  **Named test required**, not a comment.

### DEC-5 — One shared computation module: `server/lib/value-ledger.js`

- **Status:** DECIDED-AUTO (2026-08-02) — overrides the engineer's
  `server/lib/value-pool.js` naming
- **Decision:** pool assembly, `computePlanHealth`, `summarizeDeliveredValue`,
  `unitKey`, and the `VALUE_SOURCES` / `ATTRIBUTION_TIERS` vocabularies all live
  in **one** module. QA's spec **paths are kept** (`value-pool.test.js` = pool
  behaviours, `value-ledger.test.js` = claims/close/health): two specs, one
  module. Recorded so nobody creates a `value-pool.js` to match a filename.
- **Why:** §9.1's failure lands when consumer #2 appears; this request announces
  consumers 2–4 on day one and two of them are net-new surfaces.

### DEC-6 — Ratchet baseline for run #1

- **Status:** DECIDED-AUTO (2026-08-02; Sara may override — PM S-4)
- **Decision:** bounded default lookback (trunk-drift's own env-tunable window)
  plus an explicit `?backfill=1` / `--backfill` request parameter for a deep
  walk. **No persisted per-project baseline table in v1** — a query parameter is
  sufficient for the API/`ccam` checkpoint, and it is cheaper and more reversible
  than a fourth table.
- **Why:** a 3,000-commit pool on day one would fail the slice-4 gate for the
  wrong reason (R9). Coaching Assistant will likely want backfill; most projects
  won't.
- **Revisit if:** Sara wants a sticky per-project baseline after the checkpoint.

### DEC-7 — Claim cardinality

- **Status:** DECIDED-AUTO (2026-08-02; Sara may override — PM S-5)
- **Decision:** many-to-many at the schema level — one value unit may be claimed
  into multiple plan items — guarded by
  `UNIQUE(value_source, value_ref, source_cwd, item_id)` against duplicate claims
  of the same unit into the same item. A unit counts as **out of the pool at its
  first claim**; a second claim on an already-claimed unit is a deliberate,
  visible action. This defines what the health metric counts.

### DEC-8 — UI placement: component inside Project Detail, no new route in v1

- **Status:** DECIDED-AUTO (2026-08-02; PM correction on the PO/architect vs
  engineer split — PM S-6)
- **Decision:** slice 5 ships `client/src/components/PlanLedgerPanel.tsx`, a
  self-contained component **file** rendered by `ProjectDetail.tsx`. Strings go
  into the existing `projectDetail.json` namespace ×4 locales. **No new route,
  no nav entry, no new i18n namespace.** Promotion to a dedicated
  `/projects/:id/reconcile` page is deferred (see DEC-16).
- **Why:** meets the engineer's 1,433-line concern (own file) without paying
  `18196dc`'s revert cost (route + nav + ×4 locale namespace).

### DEC-9 — §9.7: register the new files *and* derive the scan's scope

- **Status:** DECIDED-AUTO (2026-08-02) — this is the recurrence tax, our cost
- **Decision:** in the *same commit* that adds `server/lib/value-ledger.js`, add
  it plus `cwd-identity.js`, `plan-lifecycle.js` and `routes/project-plans.js` to
  `filesToScan` in `server/__tests__/chronology-ordering.test.js:80-86`
  (currently a hand-typed 5-file list). Then replace the hand-typed list with a
  scope **derived** from `server/lib/*.js` + `server/routes/*.js` plus an explicit
  per-file disposition (`scanned` | dated-grandfathered-with-reason), so adding a
  6th lib file breaks the scan until someone dispositions it. Same instruction
  for the closure single-writer guard: scope derived from the module's real
  export list, never typed names.
- **Bounded fallback (recorded, not open-ended):** if deriving the scope
  uncovers a large pre-existing violation set, land the derived scan with those
  violators dated-dispositioned and record the remainder as a new row rather than
  weakening the scan. `GRANDFATHERED_QUERIES.length === 2` stays 2 unless a new
  entry gets the same dated review.
- **Why:** §9.7 has now been flagged five times with its cure unbuilt; without
  registration every §9.2 obligation in the pool module is unenforced *while the
  suite is green and the DoD shows a tick*.

### DEC-10 — Fate of `plan-writeback.js` + the DEC-2/DEC-13 supersession

- **Status:** **PENDING (Sara)** — PM S-1 / PO SIGN-OFF-1 / architect §8
- **Question:** DEC-P2 makes `AGENT-PLAN.md` an import source and read-only view,
  which cannot be simultaneously true with DEC-2 (=B) and DEC-13 (=A) of
  `2026-08-01-build-project-manager` (unattended auto-write-back). Both were
  Sara's explicit calls against team lean, so only she can retire them.
- **Recommendation (already reflected in the plan):** **no change to
  `plan-writeback.js` or `reconciliation.js` in this effort, and no new call
  sites.** Keep it load-bearing for not-yet-imported cwds; later, point
  `fold_in`/`new_item` at DB plan items for imported plans (retaining
  `sanitizeLlmPlanText` — the trust boundary is LLM→Sara's plan, not LLM→file);
  **retire** the module as its own change rather than repurposing it as the
  export generator (its competence is surgical in-place mutation of a
  human-owned file; a generated view is ~50 lines of full-file composition).
- **Owed regardless of the fate call:** the supersession must be written into
  **both** decision logs — this one and
  `intake/2026-08-01-build-project-manager/decisions.md` (status amendment on
  DEC-2 and DEC-13) — plus the shared decision log. §9.4's lesson applies at the
  decision layer: a settled item that silently stops being true is the same
  failure shape as an unrecorded review finding.

### DEC-11 — Run the prior effort's live-trial gate during slice 1; LLM-minted claims stay closed until it clears

- **Status:** **PENDING (Sara)** — PM S-2 / PO SIGN-OFF-5 / architect §6.3
- **Facts (PM read Sara's live DB, 2026-08-02):** `detour_dispositions` holds 26
  rows, 24 `pending`; exactly two were ever disposed, both `decided_by='llm'`,
  both unattended — id 3 `written`, **id 19 `failed`**. `decision_queue` holds two
  rows (`detour_volume`, `writeback_failed`), **both pending, both unreviewed**
  since 2026-08-02 14:04. A 1-of-2 failure rate on unattended writes into Sara's
  stakeholder document remains unexamined.
- **Recommendation:** do **not** serialize this effort behind
  `DEC-7 (2026-08-01-build-project-manager)`; run its trial **during** slice 1
  (cheap, and its verdict feeds DEC-10 directly). Meanwhile **`claimed_by='llm'`
  claims stay closed** — the column exists in the schema, no code path writes it
  — until that gate clears.
- **Note:** DEC-P2 retires the mechanism prospectively but not retroactively;
  the trial still owes an answer about the two writes that already fired.

### DEC-12 — The slice-4 checkpoint is a gate, not a demo

- **Status:** **DECIDED — SIGNAL (2026-08-03, Sara)**
- **Decision to confirm:** after slices 1–3 (schema + import + claims + close +
  pool + health, reachable via API and `ccam ledger` only), Sara exercises the
  feature on real Coaching Assistant data and answers **"is this pool signal or
  noise?"**. **Slice 5 (UI) does not start until she has answered.**
- **Why:** `wip-queue-page` (built 2026-07-30, fully reverted in `18196dc` two
  days later) failed at exactly this altitude — an expensive portfolio UI built
  before anyone checked whether the underlying data was worth rendering. That
  question is answerable here *before* the workbench exists.
- **How answered:** the orchestrator rendered the live 182-unit pool (90-day
  lookback) plus the two already-claimed generations as a one-off scratch
  artifact (real commit messages, real intake slugs, real detour labels — no
  mock content: https://claude.ai/code/artifact/0bc831f0-9e82-4ab6-8004-3fb054fe7146),
  so the pool could be judged by its actual contents rather than a bare count.
- **Sara's verdict (verbatim intent):** the data is real signal — "we have
  visibility, but visibility alone is good but the process by which we then
  turn that known information into something and funnel it to a plan or
  multiple plans in order to bucket it and to qualify the value" is the
  missing piece, not the data itself. She confirmed the drag/claim workflow
  gap is exactly slice 5, then said "ok, proceed."
- **Consequence:** slice 5 (the two-pane reconciliation workbench —
  [[holistic-focus-history]] UI model, confirmed 2026-08-02: left pane =
  plans, right pane = unclaimed pool, pull right→left to claim, close is a
  plan-level action) is now unblocked. `team-intake` runs next on that scope.

### DEC-13 — Clean up the `DND`/`dnd` duplicate project before the live trial

- **Status:** **DECIDED — RESOLVED (2026-08-03, Sara)**
- **Facts (as found):** `/Users/sara/CODE-LOCAL/SARA/DND` and `.../dnd` are the
  **same directory** (identical inode `17996204`) but existed as two `plans`
  rows with an identical `content_hash`, mapped in `project_paths` to two
  different `project_id`s.
- **Why it had to precede the trial:** read-side canonicalization (see DEC-15)
  fixes fan-out *within* one project's assembly; it structurally cannot merge two
  different `project_id`s. If the duplicate stood, the checkpoint would measure
  the ledger against a fleet that was itself double-counted — and the headline
  "what did this project deliver" answer would come from one of the two ids.
- **Resolution, verified live against the dashboard DB:** exactly one project
  remains mapped to the directory — `project_id 26b989c5-8f85-4020-9406-a87c7843d336`
  (`name: "D&D"`), with a single `project_paths` row pointing at
  `/Users/sara/CODE-LOCAL/SARA/dnd`. No orphaned second project row or second
  `project_paths` mapping for this directory exists. `DND`/`dnd` still resolve
  to the same physical directory on disk (expected — case-insensitive
  filesystem, unrelated to this fix), but it is no longer double-registered.
- **Downstream effect:** this was the last blocker DEC-2 through DEC-13 named
  ahead of the slice-4 checkpoint. DEC-11 (prior live trial) remains open and
  unrelated. **DEC-12 is now resolved — SIGNAL (2026-08-03)** — see that entry;
  slice 5 is unblocked.

### DEC-14 — WATCH: transitional dual plan surface

- **Status:** WATCH (opened 2026-08-02; architect §6.1 / PM R1)
- **The risk:** legacy cwd-keyed `plans`/`plan_items` (+ poll + writeback + focus
  stack + `/api/plans` + `PlanPanel`) coexist with `project_plans`. Two things
  both called "plan" rendering in one UI is chronic-drift territory.
- **Mitigations in the plan:** distinct route namespace (`/api/project-plans`,
  never blended into `/api/plans` responses), distinct client types, distinct
  additive WS types, `imported_*` provenance columns.
- **Sunset (owed, not scheduled):** once every monitored repo has imported, the
  legacy layer's read surfaces should collapse into the portfolio layer and the
  poll/writeback path retire (see DEC-10). No date is set; this row exists so the
  coexistence is a tracked debt rather than a disclosed-and-forgotten one.
- **Escalate if:** a third read surface of "plan" appears, or any response blends
  the two shapes.

### DEC-15 — WATCH: CWD-IDENTITY-FANOUT (candidate catalog pattern)

- **Status:** WATCH (opened 2026-08-02; `PROJECT-CONTEXT.md` records this as a
  candidate pattern with an explicit promotion trigger)
- **The shape:** state keyed by `cwd` fans out to N rows for one logical thing —
  case-insensitive filesystem (`DND`/`dnd`, one inode, two `project_id`s), effort
  worktrees (a `plans` row with **no** `project_paths` mapping), renamed
  directories (a stale row left behind). 10 `plans` rows represent 8 distinct
  plans on Sara's live DB.
- **Cures adopted by this build:** `server/lib/cwd-identity.js` is the single
  home for canonicalization (`realpathSync` → on-disk casing; `rev-parse
  --show-toplevel` / `--git-common-dir` folds worktree cwds into their parent
  repo); **import idempotency keyed on `content_hash` + `project_id`, never on
  `cwd`**; `identityWarnings` returned on the pool response so "N rows, one
  directory" is a reportable condition rather than normal.
- **Explicitly NOT done in v1:** no rewrite of `project_paths`; cross-project
  fan-out is surfaced, not repaired (that is DEC-13, Sara's manual action).
- **Promotion trigger (from `PROJECT-CONTEXT.md`):** promote to a real catalog
  entry the first time either (a) a second `cwd`-keyed surface is found fanning
  out the same way, or (b) a shipped aggregate is shown to under- or
  double-report because of it. **This build's health metric is exactly such an
  aggregate — if the slice-4 trial shows a miscount, promote it.**

### DEC-16 — WATCH/DEFERRED: the three unbuilt §9.1 consumers

- **Status:** WATCH (opened 2026-08-02; architect §8, PM S-7, PO §6.4)
- **Deferred out of this effort:** (a) **MCP plan/ledger tools** —
  `mcp/src/tools/` has zero plan tools today, so this is net-new work;
  (b) the **read-only generated `AGENT-PLAN.md` export** — explicitly optional in
  DEC-P2 and a §9.1 consumer from birth (if ever built: new full-file composition
  with a "GENERATED — do not edit" banner, **not** a repurposing of
  `plan-writeback.js`); (c) promotion of `PlanLedgerPanel` to a dedicated
  `/projects/:id/reconcile` page (only after the claim gesture survives contact
  with Sara).
- **Standing obligation:** each of these, on arrival, **must join
  `server/__tests__/ledger-metrics-parity.test.js` as a consumer** and must read
  health values from `server/lib/value-ledger.js` — never recompute. No new
  unattended file-write capability is added by any of them (PO §6.4).

### DEC-17 — WATCH: unmapped cwds have no pool home

- **Status:** WATCH (opened 2026-08-02; architect §6.5, PM R13)
- **The gap:** the pool aggregates via `project_paths`, so value in a cwd mapped
  to no project has no pool home — consistent with how sessions/plans/intake
  already behave, and therefore **accepted, not accidental**. The live-data twist
  (§5.3 of the PM plan) is that the unmapped set is *exactly the effort
  worktrees* — i.e. some of the value most worth claiming.
- **Mitigation in the plan:** worktree cwds fold into their parent repo root, so
  the accepted gap shrinks to genuinely unregistered directories; the residue is
  surfaced as an `identityWarning` and stated in the docs.
- **Escalate if:** the slice-4 trial shows real delivered value invisible to the
  pool because its repo is unmapped.

### DEC-18 — WATCH: legacy focus/pace/one-plan-per-cwd untouched in v1

- **Status:** WATCH (opened 2026-08-02; engineer §2 hidden coupling, PM R12)
- **What is deliberately not done:** `pace.js` stays on the legacy per-cwd layer
  (`project_plan_items.target_date` exists for shape-compatibility but nothing
  computes pace over it); `ccam focus set <n>` / `(cwd, item_number)` resolution,
  `focus_inferences`, `session_focus` and `detour_dispositions.resolved_item_id`
  keep pointing at legacy `plan_items`; `imported_item_id` preserves the link so
  focus history stays correlatable without touching those tables.
- **Consequence to watch:** once plans are authored DB-first, "focus on item N"
  and "pace against target date" will increasingly describe the *old* plan.
  Re-pointing the focus stack is its own effort with its own §9.6 exposure.
- **Escalate if:** Sara sets a target date in the ledger UI and expects a pace
  alert, or focus commands start resolving against the wrong plan.

### DEC-19 — Proceed to team-qa

- **Status:** DECIDED-AUTO (2026-08-02, Step 6 PREFERENCE gate under auto-pilot)
- **Decision:** the next pipeline stage is `team-qa` on this item's
  `technical-plan.md` — greenlit without waiting, per auto-pilot convention
  (unblocking the next stage is the skill's purpose). Build itself remains
  gated behind DEC-2 (trunk-drift Phase 1a merge) and the PENDING (Sara)
  rows DEC-10..DEC-13 noted above; none of those block QA planning.

### DEC-20 — DEC-9 bounded fallback invoked: deriving `chronology-ordering.test.js`'s scope surfaced 6 pre-existing files

- **Status:** DECIDED-AUTO (2026-08-02, build phase, T3.14) — the bounded fallback DEC-9 itself anticipated, taken per QDEC-5's forcing function
- **What happened:** replacing `chronology-ordering.test.js`'s hand-typed
  5-file `filesToScan` with a scope derived from `server/lib/*.js` +
  `server/routes/*.js` (88 files total, including `server/db.js`) surfaced 11
  matches across 6 files never previously scanned. Each was reviewed
  individually (not batch-waived) and dispositioned in the test file's new
  `FILE_DISPOSITIONS` map:
  - `server/lib/scoped-stats.js`, `server/routes/hooks.js`,
    `server/routes/workflows.js` — **verified-fine false positives**:
    count-ranked top-N leaderboards (same shape as `db.js`'s two existing
    `GRANDFATHERED_QUERIES` entries) or `SELECT 1 ... LIMIT 1`
    existence/dedup checks, neither of which is a "most recent N" window.
  - `server/lib/focus-inference.js` — **verified-fine false positive of the
    scanner's own technique**: `listCandidates()`'s LIMIT is over `sessions`
    ordered by `updated_at DESC`, not over the flagged tables; the scanner's
    substring table-name match was fooled by nested `NOT EXISTS`/`EXISTS`
    correlated subqueries referencing `events`/`focus_inferences`.
  - **`server/lib/focus-report.js` — a genuine, pre-existing §9.2-shaped risk,
    NOT introduced by this effort and not fixed by it.**
    `resolveSessionStart()`'s `SELECT created_at FROM events WHERE
    session_id = ? ORDER BY id ASC LIMIT 1` fallback picks "the earliest
    event" by insertion order, not by `created_at` — the exact
    row-id-as-chronology-proxy shape §9.2 exists to catch. The file's own
    sibling query (`allEvents`, a few lines below, no LIMIT) already
    documents the failure mode in a comment (bulk-ingested Workflow-tool
    events landing at whatever row id was next, regardless of their own
    `created_at`) and correctly re-sorts numerically before use —
    `resolveSessionStart()` does not. This effort's scan was simply never
    wide enough to see it before.
- **Disposition:** all six are dated-grandfathered (file-level, `2026-08-02`)
  in `FILE_DISPOSITIONS`, distinct from — and without widening —
  `GRANDFATHERED_QUERIES`, which stays at its original 2 reviewed entries
  exactly as T3.14 requires. **The remainder, tracked here rather than
  silently fixed or silently ignored:** `server/lib/focus-report.js`'s
  `resolveSessionStart()` fallback is a real, open defect candidate. It
  affects `session.started_at`-less sessions' segment-bookend timestamp in
  the focus-time report (`server/lib/focus-report.js`, unrelated to this
  effort's own change set) and is **out of scope for this build** to fix —
  no file in that surface is touched by `plan-lifecycle-value-ledger`.
- **Recommendation:** file this as its own small, separate fix (swap the
  `ORDER BY id ASC LIMIT 1` for `ORDER BY created_at ASC LIMIT 1`, or better,
  reuse the sibling query's fetch-all-then-sort-numerically pattern) the next
  time `server/lib/focus-report.js` is touched, or as a standalone one-line
  fix with its own red-first test. Sara may prioritize directly.

### DEC-21 — SHIP gate resolved for real; committed and pushed

- **Status:** DECIDED-AUTO (2026-08-03, Step 8 SHIP gate, auto-pilot)
- **What happened:** build-lead's report (drafted while the client suite was
  genuinely unrun/unknown) flagged O-8 (whole-namespace i18n key-set parity)
  as an unbuilt, vacuous stub. The orchestrator closed it for real —
  registry-derived, plural-suffix-aware key-set comparison across all
  namespaces × 4 locales, live-mutation-proven — which required touching
  client code (client/src/i18n/__tests__/i18n.test.ts) and fixed one real,
  pre-existing translation gap it surfaced (sessions.remoteSourceBadgeTitle
  missing from ko/vi/zh — added). That made `npm run test:client` runnable
  for the first time this build; result 773/773, unaffected.
- **Decision:** with server (1531/1531) and client (773/773) both genuinely
  green, the `.husky/pre-commit` hook's real requirement was satisfied
  without `--no-verify` and without a human bypass decision. Per this run's
  auto-pilot mode, Step 8 executed as designed: committed `f1799e9` on
  `effort/2026-08-02-plan-lifecycle-value-ledger`, pushed to `origin` (fork
  remote, never `upstream`, never the default branch). No PR opened — none
  requested.
- **Still open, unaffected by this:** DEC-10/11/12/13 and QDEC-14/15 remain
  PENDING (Sara) — none of them gated the commit itself, only slice 4/5 and
  two smaller CLI/API-shape preferences.
