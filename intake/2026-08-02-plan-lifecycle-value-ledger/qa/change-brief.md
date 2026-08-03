# Change Brief — 2026-08-02-plan-lifecycle-value-ledger

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-08-02
- **Scope source:** intake-handoff — **PRE-BUILD**. The change set below is the
  *intended* change from `technical-plan.md` §3–§4; **none of it exists in the
  tree yet** (verified: `server/lib/value-ledger.js`, `cwd-identity.js`,
  `plan-lifecycle.js`, `routes/project-plans.js`,
  `client/src/components/PlanLedgerPanel.tsx` are all absent). Tests planned
  from this brief will be authored red-first against unbuilt code.
- **Intake link:** `intake/2026-08-02-plan-lifecycle-value-ledger/`
  (`technical-plan.md`, `decisions.md` DEC-P1..P6 + DEC-1..DEC-19,
  `supporting/qa.md` T1–T7 as adopted-with-modifications by the tech lead).

## Change summary

Adds an additive portfolio layer — closable, generation-chained plans per
`project_id` plus a persisted value-claims ledger and a live-derived unclaimed
value pool — so "what value did this project deliver, and did we clear the
milestone?" is answerable from recorded state. Three new SQLite tables
(`project_plans`, `project_plan_items`, `value_claims`; zero `ALTER`, zero
rebuilds), one shared computation module (`server/lib/value-ledger.js`), a
one-shot DEC-P2 import of each existing `AGENT-PLAN.md` as generation 1, a new
`/api/project-plans` namespace + `ccam ledger` CLI, and — only after Sara's
slice-4 "signal or noise?" gate — a `<PlanLedgerPanel>` inside Project Detail.
Legacy cwd-keyed `plans`/`plan_items`, focus, pace, detours, reconciliation are
explicitly **untouched**.

## Changed files (by layer) — intended; all paths repo-relative

**Database (`server/db.js` — modify)**
- Three `CREATE TABLE IF NOT EXISTS` blocks + indexes per §3.1 DDL (full
  5-value `value_source`, 3-tier `attribution`, 2-state `status` vocabularies
  in the initial DDL; `value_claims` deliberately has **no** `closed_at`;
  `source_cwd NOT NULL DEFAULT ''` so the per-(unit,item) UNIQUE index bites;
  import-idempotency UNIQUE on `(project_id, imported_content_hash)`).
- ~17 new prepared `stmts`. No `ALTER TABLE`, no rebuild, nothing else in
  `db.js` changes. (Anchor verified: legacy `plans` at `server/db.js:561`,
  `cwd TEXT PRIMARY KEY` at 562 — the untouched layer.)

**Server libs (new)**
- `server/lib/cwd-identity.js` — single home for cwd canonicalization
  (`canonicalizeCwd`, `repoRootFor`, `dirIdentity`, `groupCwdsByIdentity`).
- `server/lib/plan-lifecycle.js` — plan/item CRUD, `closePlan` (the single
  closure composer), `importGenerationFromPlan` (DEC-P2; `plan-ingest.js`
  stays the sole markdown parser), derived `generationOrdinal`.
- `server/lib/value-ledger.js` — the §9.1 single home: `assembleValuePool`,
  `computePlanHealth`, `summarizeDeliveredValue`, `unitKey`, exported
  `VALUE_SOURCES` / `ATTRIBUTION_TIERS`. (DEC-5: **no** `value-pool.js` module
  is ever created; `value-pool.test.js` is a spec name only.)

**Server routes (new + registration)**
- `server/routes/project-plans.js` — new namespace per §3.3 route table;
  mounted in `server/index.js`; digit-constrained `:id(\d+)` params. Additive
  WS types `project_plan_updated`, `value_claim_updated`; `plan_updated`
  payload untouched.

**CLI (`bin/ccam.js` — modify)**
- `cmdLedger` + dispatch + help: `ccam ledger
  plans|pool|health|history|import|claim|close --project <id|name>`. Prints
  API values verbatim — no CLI-side arithmetic (T6 parity target).

**Client (slice 5 only, gated on DEC-12)**
- `client/src/components/PlanLedgerPanel.tsx` (new, self-contained);
  `client/src/pages/ProjectDetail.tsx` (render slot; file verified present);
  `client/src/lib/api.ts` (`api.projectPlans` beside `api.plans`, ~line 2511
  verified); `client/src/lib/types.ts` (6 new types; `Plan`/`PlanItem`
  untouched); strings into **existing** `projectDetail.json` ×4 locales
  (en/ko/vi/zh). No new route, nav entry, or i18n namespace.

**Tests planned in this set (do not exist yet — red-first deliverables)**
- T1 extend `server/__tests__/db-migration.test.js` (legacy-DB boot gains the
  three tables; no `UPGRADE_CASES`/`REBUILD_CASES`/interruption case — intake
  QA's T1 rebuild scope was **dropped** by the tech lead: no rebuild exists).
- T2 `plan-lifecycle.test.js`, T4 `plan-import-inversion.test.js` (slice 1);
  T5 `value-ledger.test.js` (slice 2); T3 `value-pool.test.js` +
  T6 `ledger-metrics-parity.test.js` + `chronology-ordering.test.js` scope
  work (slice 3); T7 client specs + reviewed snapshot regen (slice 5).
- Baseline floor: the nine existing specs on this surface (144/144 per intake
  QA) stay green with **zero behaviour edits**; `plan-ingest.test.js` stays
  green and **unmodified** (intake QA's "consciously rewrite the
  deletes-removed-numbers case" was overridden — under the additive design
  that case remains correct for the legacy layer).

**Docs (same change-set)**
- `docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`, `README.md`,
  `server/README.md`.

**Explicitly NOT changed (violations are review blockers)**
- `server/lib/plan-ingest.js`, `plan-writeback.js`, `reconciliation.js`,
  `pace.js`, `server/routes/plans.js`; `/api/plans` response shapes;
  `plan_updated` WS payload; `mcp/` (zero plan tools today, deferred DEC-16);
  no `deletePlanItemsNotIn` analogue against the new tables, ever.

## Surfaces / features touched

- **New:** portfolio plan lifecycle (`project_plans` generations, close-only
  door `POST /:id/close`), value-claims ledger, unclaimed value pool
  (feeds: `scanIntakeForCwd` — verified public at `server/lib/intake-scan.js:168`;
  live `detectTrunkDrift` — trunk-drift Phase 1a; `detour_dispositions`
  reads; focus-bracket correlational tier), health metrics, whole-life
  summary, `ccam ledger`, `PlanLedgerPanel` in Project Detail.
- **Adjacent-untouched (regression surface):** legacy plan mirror + ingest
  (the `deletePlanItemsNotIn` trap verified live at
  `server/lib/plan-ingest.js:396` / `server/db.js:2590`), focus/pace/detours,
  reconciliation, `/api/plans`, Project Detail's existing cards.

## Variant relevance

- **Dual plan surface (R1/DEC-14):** legacy cwd-keyed plans and new
  project-keyed plans coexist; the two must never blend in one response or
  render as one thing. This is the change's own #1 cross-path hazard.
- **Cross-consumer parity (§9.1):** the same health numbers must be identical
  via API route, `ccam ledger`, and (future) MCP/export — consumers 2–4 are
  announced before the code exists; two are net-new surfaces.
- **Cross-feed identity (R7/DEC-4):** the same trunk sha may arrive via live
  `detectTrunkDrift` *and* (post-Phase-1b) persisted
  `detour_dispositions source='trunk_drift'` rows — one pool unit, ever.
- **Locales:** slice 5 adds strings to `projectDetail.json` in all four
  locales (en/ko/vi/zh) — key-set parity across the four files applies.

## Test-invariants at risk

- [ ] **Closure invariant (DEC-P6 / I1)** — value reaches closed only through
  plan closure; closed plans and their claims are immutable, no delete path.
  T2/T5 negatives; closure single-writer guard with export-derived scope.
- [ ] **Ratchet / claims never recomputed (I2)** — a claimed unit never
  re-enters the pool; claim rows byte-identical across re-assembly with grown
  history. T3/T5.
- [ ] **Import no-data-loss (I3 / R3)** — `deletePlanItemsNotIn`
  (`plan-ingest.js:396`) made structurally unreachable, not guarded: a full
  ingest cycle deletes zero `project_plan_items`; static rogue-writer scan,
  red-proven. T4. Re-import idempotent on `(project_id, content_hash)`.
- [ ] **§9.1 DERIVED-DUAL-VIEW (design-time pre-flag on file, count 5)** — one
  module (`value-ledger.js`) for every derived value; **T6
  `ledger-metrics-parity.test.js` is a named deliverable shipping in slice 3**
  — the exact "per-shape spec that never gets written" the catalog's QA notes
  name. Also the write-sequence form: closure derived by join, no `closed_at`
  on claims (grep-proven per DoD).
- [ ] **§9.2 row-id-as-chronology-proxy** — pool/focus-bracketing queries over
  `events`/`focus_inferences`/`sessions` order by `created_at, id` before any
  `LIMIT`; scrambled-id fixture (I7) via `assertOrderedByCreatedAt`.
- [ ] **§9.7 HAND-SCOPED STRUCTURAL SCAN (design-time pre-flag on file, 5th
  flag)** — `chronology-ordering.test.js:80-86` hand-types 5 files (verified);
  the four new server files register **in the same commit** and the scope
  becomes derived from `server/lib/*.js` + `server/routes/*.js` with per-file
  dispositions (DEC-9, bounded fallback recorded).
  `GRANDFATHERED_QUERIES.length` stays 2.
- [ ] **§9.3 VACUOUS-GUARD** — every structural guard (import single home,
  closure composer, derived scan scope, cross-feed dedupe) needs a recorded
  red state; `assert.ok(true` / `|| true` sweeps at 0.
- [ ] **Migration safety on the shared user-global DB (§9.5/§9.6 —
  inapplicable-by-design, verify it stays that way)** — zero `ALTER`, zero
  rebuilds in the diff is itself a DoD line; T1 shrinks to legacy-DB boot
  gains three tables + second-boot no-op. Any `ALTER`/rebuild appearing in
  the actual diff re-activates §9.5/§9.6 in full and invalidates this brief's
  T1 scoping. DB backup before Sara's trial (shared
  `~/.claude/agent-dashboard/dashboard.db`).
- [ ] **Cross-feed dedupe (R7/DEC-4)** — named test: a sha in both the live
  feed and a `source='trunk_drift'` row yields exactly one pool unit and one
  health count.
- [ ] **CWD-IDENTITY-FANOUT (candidate pattern, DEC-15)** — import keyed on
  content-hash+project, never cwd; `DND`/`dnd` case-variant imports once;
  worktree cwds fold to repo root; `identityWarnings` emitted. The health
  metric is exactly the aggregate whose miscount is this pattern's promotion
  trigger.

## Stated intent / acceptance

Technical-plan §8 DoD verbatim, most load-bearing: 144-baseline green with no
behaviour edits; T1–T7 exist with recorded red states; the five untouched
modules stay untouched; **Sara's slice-4 live trial on real Coaching Assistant
data — "is this pool signal or noise?" — is sign-off, not the suite, and
auto-pilot cannot waive it (DEC-12)**; slice 5 does not start until answered.

## Open questions

**Blocking (cannot plan tests):**
- None.

**Non-blocking (proceeding on assumption):**
- **DEC-2 dependency is in-flight, not merged.** Trunk-drift Phase 1a is fully
  built in the effort worktree
  (`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor`,
  branch at `5bed29a` = master HEAD, all work **uncommitted**: `git-refs.js`,
  `trunk-drift.js`, specs, red/green evidence in its `build/` folder), and
  nothing of it exists on master. → Assumption: per DEC-19 this blocks the
  *build's slice 1*, not QA planning; tests are planned against the
  worktree-verified `detectTrunkDrift(repoPath, { seenShas, lookbackDays,
  maxCommits, timeout, now })` signature and must be re-confirmed at merge.
- **Plan/DEC-2 misstate `isGitRepo`'s home.** Verified in the worktree:
  `git-refs.js` exports `{ execGit, listRemotes, pickCanonicalRemote,
  resolveDefaultBranch, REMOTE_PRIORITY }` — **no `isGitRepo`**; it lives
  pre-existing in `server/lib/repo-topology.js` (line 39, exported at 219) and
  `trunk-drift.js` imports it from there. → Assumption: cosmetic plan error;
  the build imports from `repo-topology.js` and any §9.7 export-derived scan
  over `git-refs.js` uses the real export list, not the plan's.
- **Both live worktrees hold uncommitted changes overlapping slice-5 files**
  (`ProjectDetail.tsx`, `api.ts`, `types.ts`, `projectDetail.json` ×4 are
  dirty in master's working tree *and* modified in the trunk-drift worktree) —
  R6/DEC-2's sequencing-collision risk is live right now, and project memory
  records real work loss from this. → Assumption: build honors slice 0's
  `git worktree list` + running-session check; QA planning proceeds.
- **DEC-10..DEC-13 are PENDING (Sara)** with recommendations already reflected
  in the plan (no `plan-writeback.js` change; prior-effort trial during
  slice 1 with `claimed_by='llm'` inert; slice-4 gate; `DND`/`dnd` cleanup
  before the trial). → Assumption: plan tests to the recommendations;
  DEC-13's cleanup is a trial precondition, not a test-planning input.

## Verdict

**READY**
