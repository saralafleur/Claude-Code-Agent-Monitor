# Change Brief — build-project-manager (layers 4–6)

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-08-01
- **Scope source:** intake-handoff
- **Intake link:** `intake/2026-08-01-build-project-manager/` — primary
  source `technical-plan.md` (tech-lead pass, includes a 2026-08-01
  "Revision history" note documenting a mid-intake Layer 4 redesign),
  cross-read against `pm-plan.md`, `decisions.md` (DEC-1..15, WATCH-1..9),
  and `supporting/{architect,engineer,qa}.md` including each file's appended
  REVISION section.

## Important framing for this pass

**Nothing has been built yet.** This is a pre-build QA planning pass over an
*intended* change, not a diff of already-written code. I confirmed this
directly (see "Confirmed against live code" below): every new file, table,
column, route, and CLI command the technical plan names is absent from the
current tree, and every existing file the plan proposes to edit is
byte-identical to `HEAD` (no stray in-progress edits). The baseline
`npm run test:server` suite is green (1087/1087, 0 failures) — a clean
starting point for whatever test suite gets planned against this brief.

## Change summary

Build the missing middle of this dashboard's 7-layer portfolio-management
model as a net-new subsystem, sequenced **Layer 5 → Layer 4 → Layer 6**:
Layer 5 adds an out-of-band, human-authored `target_date` to plan items plus
a single shared pace computation (`server/lib/pace.js`); Layer 4 gives every
undeclared "detour" a durable, resolvable disposition
(`detour_dispositions`) and — per Sara's explicit override of the team's
advisory-only recommendation (DEC-2 = B) plus her choice of unattended
auto-write (DEC-13 = A) — a `fold_in`/`new_item` verdict now **writes real
content into `AGENT-PLAN.md`** the instant it is decided, through one
guarded write path (`server/lib/plan-writeback.js`) that re-runs the
existing `ingestPlanForCwd` so `plan_items` keeps exactly one writer; Layer 6
adds an in-process reconciliation scheduler (`server/lib/reconciliation.js`)
that uses deterministic rules to decide *whether* to escalate and a single
batched hermetic `claude -p` call to decide *what* a flagged detour is,
writing to a new `decision_queue` table. No client changes ship in this
effort.

## Changed files (by layer)

All of the following are **currently absent / unmodified** — this is the
plan's proposed change set, verified file-by-file against live code (line
numbers cited by the plan were spot-checked and match within a line or two
in every case checked).

**Layer 5 — pace tracking**
- `server/db.js` — add `target_date TEXT` to `plan_items`' `CREATE TABLE`
  (confirmed table starts at line 571, matching the plan's "~571-586") +
  sibling `try/SELECT/catch/ALTER` migration block; new
  `setPlanItemTargetDate` statement next to `setPlanItemDeclaredDone`
  (confirmed at line 2186). `upsertPlanItem`'s SQL (confirmed at line 2142)
  is explicitly **not** touched beyond a comment (DEC-10 override of the
  engineer's original `target:`-parser proposal).
- `server/lib/pace.js` — **new file.** `paceStatus`, `isComplete`,
  `localDayString`. Confirmed does not exist yet.
- `server/routes/plans.js` — new `POST /api/plans/items/target`.
- `bin/ccam.js` — new `focus target` subcommand (confirmed `COMMAND_GROUPS`
  at line 1630, `SUBCOMMANDS` at line 2495, existing `focus done` precedent
  at line 1683).
- `server/openapi-extra/misc.js` — new OpenAPI entry (confirmed this file
  exists and is the repo's convention for route docs).

**Layer 4 — detour disposition + real plan write-back** (heaviest slice;
internally sequenced (a) write-path plumbing → (b) disposition schema/module
→ (c) verification)
- `server/lib/atomic-file.js` — **new file.** `atomicWriteFile` extracted
  verbatim from `server/lib/cc-mutate.js:218-247` (confirmed function starts
  at line 218; confirmed `module.exports` at line 527, and that it currently
  does **not** export `atomicWriteFile` — the extraction is a pure internal
  refactor).
- `server/lib/cc-mutate.js` — delete local `atomicWriteFile`, `require` the
  extracted version. No other change; no external API change.
- `server/lib/plan-ingest.js` — **exports only**, no behavior change: add
  `ID_LINE_RE`/`ACCEPTANCE_LINE_RE`/`DETAIL_LINE_RE` (confirmed at lines
  85-87) and `MAX_FILE_BYTES`/`MAX_ITEMS`/`MAX_TEXT_LEN`/
  `MAX_ACCEPTANCE_LEN`/`MAX_DETAIL_LEN` (confirmed at lines 61-66) to
  `module.exports` (confirmed at line 438, currently exporting only
  `PLAN_FILENAME`/`parsePlanMarkdown`/`ingestPlanForCwd`/`planFileMtime`/
  `fallbackItemId`/`attachDisplayNumbers`). Also update this file's header
  comment, which **currently and accurately** states (confirmed verbatim at
  line ~24): *"The file is the source of truth — the dashboard never writes
  it."* This claim becomes false the moment Layer 4 ships and must be
  corrected in the same change (DEC-8 item 4).
- `server/lib/plan-writeback.js` — **new file.** `sanitizeLlmPlanText`,
  `appendPlanItem`, `appendSubItem`, `applyDisposition`,
  `__injectPreRenameHookForTest`. Confirmed does not exist yet anywhere in
  the repo.
- `server/db.js` — new `detour_dispositions` table (full final shape,
  including write-audit columns, landed in the initial `CREATE TABLE` per
  DEC-15/WATCH-4) in the same block as `focus_inferences` (confirmed at line
  626); new prepared statements.
- `server/lib/detours.js` — **new file.** `recordInferredDetour`,
  `backfillDeclaredDetours`, `resolveDisposition`, `DISPOSITIONS` enum.
- `server/lib/focus-inference.js` — one guarded `try/catch` block added
  immediately after the existing `upsertFocusInference.run(...)` call
  (confirmed at line 517, inside `inferSession` which starts at line 473 —
  matches the plan's "~473-530"/"~517-526" citations closely).
- `server/routes/detours.js` — **new file.** `GET /api/detours`,
  `POST /api/detours/:id/resolve`.
- `server/index.js` — mount `/api/detours` in the router block (confirmed
  existing router mounts run lines 98-127, matching the plan's "~98-127").
- `server/openapi-extra/misc.js` — new entries.

**Layer 6 — reconciliation pass**
- `server/db.js` — new `decision_queue` table (full final shape, widened
  `kind` enum from creation, per DEC-15/WATCH-4).
- `server/lib/reconciliation.js` — **new file.** `startReconciliation`,
  `reconcileCwd`, `evaluateRules`, `classifyFlaggedDetours`,
  `buildDispositionPrompt`, `parseDispositionOutput`, `computeFlaggedDigest`,
  `listReconcileTargets`.
- `server/routes/decision-queue.js` — **new file.**
- `server/index.js` — mount `/api/decision-queue`; start the scheduler in
  `startBackgroundServices()` (confirmed this function starts at line 317,
  with `startFocusAudit`/`startFocusInference` wiring at lines 405-418,
  matching the plan's "~400-421" citation) inside its own `try/catch`.
- `bin/ccam.js` — new top-level `decisions` command.
- `server/openapi-extra/misc.js` — new entries.

**Docs (end of change set, per CLAUDE.md's `update-project-docs` trigger)**
- `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `server/README.md` —
  schema/WebSocket/CLI sections, **plus a required correction**: every claim
  (including `plan-ingest.js`'s own header) that "the dashboard never writes
  `AGENT-PLAN.md`" must be updated once Layer 4 ships.
- `pm.md` + two auto-memory entries (`portfolio-reconciliation-vision`,
  `holistic-focus-history`) — DEC-8 close-out. **Already partially done as
  process artifacts of this intake**, not the build: `git diff pm.md` and
  `git diff PROJECT-CONTEXT.md` show the `/loop`-claim correction and two
  §9.1/§9.2 design-time pre-flags already applied in the working tree ahead
  of any code change. These are documentation/process edits, not
  implementation, and are consistent with the intake's own instructions —
  noted here so they aren't mistaken for partial code delivery.

**Database / migration**
- Two new tables (`detour_dispositions`, `decision_queue`) and one new
  column (`plan_items.target_date`) — see per-layer entries above. **Not yet
  present in `server/db.js`** — confirmed by `grep -rn
  "detour_dispositions\|decision_queue\|target_date" server/ client/src/`,
  which returns zero product hits (only unrelated matches: remote-sync
  mirror reconciliation and a dashboard-runs startup pass, exactly as
  `pm-plan.md`'s own request-type analysis claims).

**Tests changed in this set**
- **None yet — the plan specifies but has not created:**
  `server/__tests__/pace-tracking.test.js`, `plan-writeback.test.js`,
  `atomic-file.test.js` (or folded into the above), `detour-disposition.test.js`,
  `reconciliation.test.js`, plus extensions to the existing
  `plan-ingest.test.js`, `plans-api.test.js`, and `focus-inference.test.js`.
  Confirmed all five new spec files are absent from `server/__tests__/`.
  `server/__tests__/cc-config.test.js` exists today and is the regression
  guard the plan requires to stay green, unchanged, immediately after the
  `atomic-file.js` extraction (step 11).

**Config / other**
- New env knobs across all three layers (`DASHBOARD_RECONCILE_MODE`,
  `DASHBOARD_RECONCILE_MS`, `DASHBOARD_PACE_GRACE_DAYS`,
  `DASHBOARD_RECONCILE_LOOKBACK_DAYS`, `DASHBOARD_DETOUR_VOLUME_MIN_SESSIONS`,
  `DASHBOARD_DETOUR_VOLUME_THRESHOLD`, `DASHBOARD_DETOUR_PENDING_DAYS`,
  `MAX_DETOURS_PER_TICK`, `MAX_TARGETS_PER_TICK`,
  `DASHBOARD_DETOUR_CONFIDENCE_MIN`), all new, none touching existing knobs.
  `DASHBOARD_RECONCILE_MODE` additionally honors the existing
  `DASHBOARD_FOCUS_INFER_MODE=off` for its LLM half only (DEC-9).

## Surfaces / features touched

- **`AGENT-PLAN.md` write ownership** — the single highest-stakes surface in
  this change. Confirmed today's `plan-ingest.js` header literally states
  the dashboard never writes this file; this build ends that, through
  exactly one guarded path (`plan-writeback.applyDisposition`).
- **`plan_items` schema + ingest identity** (`server/db.js`,
  `server/lib/plan-ingest.js`) — new column, and (indirectly) new rows via
  write-back-then-reingest, never via a second/direct writer.
- **`focus_inferences` classifier** (`server/lib/focus-inference.js`,
  `inferSession`) — gains a one-line, fail-safe hook that records (never
  writes a file for) an inferred detour.
- **New API surfaces**: `POST /api/plans/items/target`,
  `GET|POST /api/detours[...]`, `GET|POST /api/decision-queue[...]`.
- **New CLI surfaces**: `ccam focus target`, `ccam decisions [ack|dismiss|retry]`.
- **New in-process scheduler**: `server/lib/reconciliation.js`, following the
  exact `startFocusAudit`/`startFocusInference` shape.
- **No client/UI surface** — confirmed zero client file changes named
  anywhere in the plan (WATCH-3 explicitly forbids it this round).

## Variant relevance

This project's configured recurring-defect catalog
(`PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW, §9.2
row-id-as-chronology-proxy) is the direct analogue of "surfaces that must
stay identical across paths/variants" here, and **this change touches both,
directly and by the tech lead's own explicit design**:

- **§9.1 DERIVED-DUAL-VIEW — touched, and the plan's central defensive
  theme.** This build introduces three new derived *values* at once (pace
  status, disposition, decision-queue entry) **plus one new derived
  *action*** (the disposition→file-write sequence) — with a deliberately
  deferred Layer-7 rollup UI queued to become their second consumer later.
  §9.1's own citation history (4 prior touches, per `PROJECT-CONTEXT.md`) is
  explicit that the failure lands the moment a second consumer appears and
  re-derives instead of calling — not at introduction. DEC-14 exists
  specifically to head this off *twice over*: once for the computation
  (`pace.js` is the only pace implementation; `detours.js` is the only
  disposition vocabulary) and once for the write path (`applyDisposition` is
  the *only* place "sanitize → dispatch → audit → retry → escalate" may be
  composed — both the human-resolve route and the unattended reconciliation
  tick must call it, neither may hand-roll it). `PROJECT-CONTEXT.md` was
  pre-flagged (not incremented — correctly, per the 2026-07-24
  `simulator-mode-switch` precedent cited in `pm-plan.md`) with two
  design-time notes already visible in the working tree.
- **§9.2 row-id-as-chronology-proxy — touched.** Every new "recent
  detours/sessions" query this build adds (`listPendingDetours`,
  `listStaleResolvedDetours`, `backfillDeclaredDetours`, Layer 6's
  detour-volume-ratio lookback) must sort `ORDER BY created_at …, id …`
  before any `LIMIT` — named explicitly because `workflow-ingest.js` already
  bulk-inserts `events` after the fact, so `id` order is provably not
  chronological in this codebase, and this pattern has already been fixed
  three times in adjacent `focus-inference`-family code per
  `PROJECT-CONTEXT.md`.

## Test-invariants at risk

- [x] **DERIVED-DUAL-VIEW (§9.1)** — touched. At risk both as a *computation*
      duplication (pace/disposition logic re-derived by a second consumer)
      and, newly, as a *write-sequence* duplication (the human-resolve route
      and the reconciliation tick each hand-composing "sanitize → dispatch →
      audit → retry → escalate" instead of both calling
      `plan-writeback.applyDisposition`). DEC-14 names this explicitly.
- [x] **row-id-as-chronology-proxy (§9.2)** — touched. Every new lookback/
      "recent N" query over `events`/`focus_inferences`/`detour_dispositions`
      must sort by `created_at` with `id` only as a tiebreak, before `LIMIT`.
- [x] **Single-writer integrity (project-specific invariant, not in the
      catalog but structurally central to this change)** — `plan_items` must
      have exactly one writer (`ingestPlanForCwd`) even after Layer 4 ships;
      `plan-writeback.js` must never call `upsertPlanItem` directly. This is
      the direct analogue of "round-trip integrity": a `fold_in`/`new_item`
      write must survive a full write→re-ingest→re-read round trip and be
      indistinguishable from a human-typed item.
- [x] **No unresolved/forged-boundary-token leak (project-specific analogue)**
      — `sanitizeLlmPlanText` must neutralize LLM-influenced text so it can
      never forge a structural `id:`/`acceptance:`/`detail:` continuation
      line the next time `AGENT-PLAN.md` is parsed. This is a genuinely new
      trust-boundary risk introduced by DEC-2/DEC-13 that advisory-only never
      had (an unattended LLM classification can now reach a stakeholder-
      facing document with no human read of the exact text first).
- [x] **Fail-safe-per-stage (session-liveness.js's own stated contract)** —
      rule evaluation, LLM classification, file write-back, and each
      persistence write must each independently no-op on failure and leave
      prior state untouched; a partial failure must never leave
      `decision_queue` and `detour_dispositions` inconsistent with each
      other.
- [x] **Hybrid-escalation non-inversion (this project's confirmed, explicit
      design decision)** — `evaluateRules()` must contain zero LLM calls and
      completely determine the escalation set; the LLM may only ever
      classify what rules already flagged, never decide whether to escalate.
      Both the PM (`pm-plan.md`) and every supporting document independently
      name this as the single highest-leverage risk in the whole build.

## Stated intent / acceptance

- **Definition of Done** is fully enumerated in `technical-plan.md` §8 (32
  checklist items) — notably: real write-back must hold (a `fold_in`/`new_item`
  survives a real re-ingest as a `plan_items` row, with **zero** direct
  `plan_items` inserts anywhere); no residue of the superseded DEC-12
  "must-not-create-a-row" assertion may survive in the test suite; retry
  policy pinned (exactly one retry on `CONFLICT`, zero on
  `CAPS_EXCEEDED`/`NO_PLAN_FILE`/`IO_ERROR`); traceability answerable in one
  query in both directions (`detour_dispositions.id` → what it wrote, and
  `plan_items.item_id` → which decision produced it, via `resolved_item_id`);
  classification (`inferSession`) must never itself write the file.
- **DEC-7 live-trial gate (non-negotiable per the PO's own acceptance
  criterion 8, widened by DEC-13)**: a green test suite is explicitly stated
  to be **not sufficient sign-off**. Sara must review real decision-queue
  output *and* the actual unattended content written into her
  `AGENT-PLAN.md` files against her real fleet before this is called done.
  This is directly informed by this repo's own most recent cautionary
  precedent — commit `18196dc`, "Remove the WIP queue feature," reverted two
  days after shipping.
- **WATCH-8**: backups under `<cwd>/.claude/agent-plan-backups/` have no
  retention policy; the rollback story in §7 depends on them landing, and
  the live trial must confirm they actually do.

## Open questions

**Blocking (cannot plan tests):**
- None found. The technical plan resolves every prior evaluator conflict
  explicitly and traceably (DEC-2 supersedes advisory-only; DEC-13 answers
  the auto-write-trigger question the architect's revision deliberately left
  open; DEC-14 resolves three vocabulary/shape conflicts across the
  architect/engineer/QA revisions by name, stating which spelling loses;
  DEC-15 resolves the schema-landing-order question). No PENDING
  `decisions.md` row gates any of the three layers — every WATCH row is
  explicitly "deliberately unscheduled" or "accepted residual risk," not an
  unresolved question the build depends on. Live code was checked
  file-by-file against the plan's citations (line numbers, function names,
  export lists, header comments) and matches closely enough to trust the
  plan's grounding.

**Non-blocking (proceeding on assumption):**
- Step 0's own baseline note ("the working tree currently carries unrelated
  uncommitted work — `usage-captures-db`, `accounts`, `usage-fetch-oauth`")
  is now stale: that work has since been committed (`3c2db7d`,
  "feat(usage,sidebar): OAuth-based account credentials + terminal-focus
  open-terminal"). → Assumption: the current clean, green
  (`npm run test:server`: 1087 pass / 0 fail) baseline supersedes the plan's
  own note and should be used as *the* baseline going forward; the plan text
  does not need correcting for this brief to be actionable.
- `client/src/components/Sidebar.tsx` and its test are currently modified in
  the working tree, unrelated to this intake (a "new session" button
  collapsed-state layout change, part of separate in-flight work). →
  Assumption: out of scope for this change's test planning; flagged only so
  it isn't mistaken for part of this effort (this plan makes no client
  changes at all, per WATCH-3).
- The two `PROJECT-CONTEXT.md` §9.1/§9.2 pre-flag notes and the `pm.md`
  `/loop`-claim correction are already present in the working tree ahead of
  any code. → Assumption: these are intake-process artifacts (per DEC-8 and
  the architect's risk-flagging pass), not partial code delivery, and should
  not be read as "layer 4/5/6 is partially built."

## Verdict

**READY**
