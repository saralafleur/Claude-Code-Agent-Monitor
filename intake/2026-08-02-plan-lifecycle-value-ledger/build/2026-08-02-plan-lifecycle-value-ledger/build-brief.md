# Build Brief — plan-lifecycle-value-ledger

**Role:** build-triage · **Date:** 2026-08-02 · **Verdict: READY** (one caveat, below)
**Effort slug:** `2026-08-02-plan-lifecycle-value-ledger`

---

## What we're building

A portfolio-layer **plan lifecycle + value ledger**: three new additive SQLite
tables (`project_plans`, `project_plan_items`, `value_claims`) keyed by
`project_id`; a one-shot DEC-P2 import turning each existing `AGENT-PLAN.md`
into generation 1 (no mirror-sync, no data-loss path); one shared server module
`server/lib/value-ledger.js` owning pool assembly, health metrics and the
whole-life summary for every consumer; a `/api/project-plans` route namespace +
`ccam ledger` CLI; and — only after Sara's slice-4 "signal or noise?" gate — a
`<PlanLedgerPanel>` inside Project Detail. Legacy cwd-keyed `plans`/`plan_items`,
focus, pace, detours and reconciliation are untouched. Slices 0–5;
slice 0 (DEC-2 dependency) is already satisfied.

## Plan sources

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-plan-lifecycle-value-ledger/technical-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-plan-lifecycle-value-ledger/qa/test-plan.md` (obligations O-1…O-24; ~120 cases across A1–A6, B1, C2, D1–D2, E1, F3)
- Decision logs: `.../decisions.md` (DEC-2…DEC-18) and `.../qa/decisions.md` (QDEC rows)

Buildability check: technical plan has full DDL, a per-layer change set, slice-gated
implementation steps, named specs T1–T7 with filenames; test plan is slice-gated with
red-first discipline per case. The two correspond surface-for-surface. **Buildable.**

## Worktree (isolated build tree — all edits happen here)

- **Path:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-plan-lifecycle-value-ledger/Claude-Code-Agent-Monitor`
- **Branch:** `effort/2026-08-02-plan-lifecycle-value-ledger` (new, off `master`)
- **Starting commit:** `554f7d19863dec8cd04010a1d9a598f43901ef81` (`554f7d1`, the trunk-drift Phase-1a merge — DEC-2's own artifact)
- **Cleanliness:** `git status --porcelain` empty at creation and after dependency install.
- **Dependencies:** `npm install` run in worktree root and `client/` (both verified:
  `node_modules/.bin/concurrently`, `client/node_modules/.bin/vitest` present).
  **Deliberately did NOT run `npm run setup`** — its `link-cli` step would re-point the
  global `ccam` symlink at this worktree, hijacking the shared CLI. If T6 needs to spawn
  the CLI, spawn `node bin/ccam.js` from the worktree, never the global `ccam`.
  `vscode-extension/` deps not installed (surface untouched by this effort).

## Back-out

```bash
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-plan-lifecycle-value-ledger/Claude-Code-Agent-Monitor reset --hard 554f7d19863dec8cd04010a1d9a598f43901ef81
```

DB note: the schema change is additive `CREATE TABLE IF NOT EXISTS` only; a code-level
back-out leaves a working database (tables present, unreferenced). `DB_PATH` resolves to
the **user-global** `~/.claude/agent-dashboard/dashboard.db` — back it up before the
slice-4 live trial (DoD line), and never `DROP` the three tables as routine cleanup (R11).

## Slice-0 obligations — status

- **O-1 (worktree + session check): DONE.** `git worktree list` shows three checkouts:
  main (`master` @ 554f7d1), `efforts/2026-08-02-practice-kind-override/` (live, dirty —
  **do not touch**), `efforts/2026-08-02-trunk-drift-detection/` (merged, awaiting
  teardown — **do not touch**), plus this effort's new one. `ps`/`lsof` confirm **live
  Claude sessions and a running dev stack (vite + concurrently, `scripts/dev.js`) hold
  files in the main checkout.** All build git ops and edits stay inside this effort's
  worktree; no `checkout`/`reset`/`stash` against the main checkout, ever
  (project memory: real work loss from exactly this).
- **O-2 (DEC-2 merge): DONE** — Phase 1a is on `master` at 554f7d1, including
  `server/lib/git-refs.js`, `server/lib/trunk-drift.js`, their specs, and
  `server/__tests__/helpers/single-home.js` (verified present on master — consume it,
  per QA correction 1; do not re-derive a scope helper).
- **O-3 (signature re-confirmation): DONE** — see next section. Closes **QDEC-18**.
- **O-4 (re-baseline): DONE** by the orchestrator post-merge on the clean tree:
  **server 1425/1425, client 771/771, zero failures.** (The test plan's earlier 241/241
  floor figure was taken pre-merge against 60 dirty paths; the verbatim rerun commands
  in test-plan "Regression floor" remain the per-slice floor checks — the 144-case
  nine-spec floor must stay green with zero behaviour edits.)

## O-3 — `detectTrunkDrift` merged signature (read from master, `server/lib/trunk-drift.js`)

```
async detectTrunkDrift(repoPath, opts = {})
  opts: { lookbackDays?, maxCommits?, now?, seenShas?, timeout? }
```

- **`seenShas` is an EXCLUSION SET** (`Set<string>` of full 40-char shas; anything not a
  `Set` is replaced by an empty Set) — **not a since-marker**. A6.3's ratchet design is
  valid as planned; no redesign needed.
- Filter semantics worth knowing at assembly time: `truncated` is computed from the raw
  walk hitting `maxCommits + 1` **before** the `seenShas` filter runs (so a capped walk
  still reports `truncated: true` even if filtering empties it); the `maxCommits` slice
  is applied **after** filtering.
- Return shapes: `{ skipped: <reason>, repoPath }` with
  `TRUNK_DRIFT_SKIP_REASONS = ["not_a_repo","no_default_branch","no_commits","git_error"]`,
  or `{ skipped: null, repoPath, defaultBranch, defaultBranchVia, headSha, lookbackDays,
  since, commits[], commitCount, truncated, range }`. Each commit:
  `{ sha, shortSha, authorName, authorEmail, committedAt, subject (≤160 chars),
  filesChanged, insertions, deletions }`. Never throws.
- Module exports: `detectTrunkDrift`, `trunkDriftLookbackDaysFromEnv`,
  `MAX_TRUNK_DRIFT_COMMITS` (200), `DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS` (7),
  `TRUNK_DRIFT_SKIP_REASONS`.
- **Plan misstatement confirmed (test plan was right):** `isGitRepo` is **not** exported
  by `git-refs.js` (its exports are `execGit`, `listRemotes`, `pickCanonicalRemote`,
  `resolveDefaultBranch`, `REMOTE_PRIORITY`). `isGitRepo` lives in
  `server/lib/repo-topology.js` and `trunk-drift.js` itself imports it from there.
  `value-ledger.js` must import it from `repo-topology.js`.

## Surfaces touched

- `server/db.js` (three additive `CREATE TABLE IF NOT EXISTS` blocks + ~17 stmts; locate
  insertion point **by grep, not line number**)
- `server/lib/cwd-identity.js`, `server/lib/plan-lifecycle.js`,
  `server/lib/value-ledger.js` (all new), `server/routes/project-plans.js` (new),
  `server/index.js` (mount), `bin/ccam.js` (`ledger` command)
- `server/openapi-extra/project-plans.js` (new, O-19)
- Slice 5 only: `client/src/components/PlanLedgerPanel.tsx` (new),
  `ProjectDetail.tsx`, `api.ts`, `types.ts`, `projectDetail.json` ×4 locales
- Tests: T1–T7 files + `db-migration.test.js` and `chronology-ordering.test.js`
  (the only two of the 144-floor specs that may be modified, exactly as specified)
- Docs: `docs/API.md`, `docs/DATABASE.md`, `ARCHITECTURE.md`, `README.md`,
  `server/README.md`
- **Must remain byte-unmodified:** `plan-ingest.js`, `plan-writeback.js`,
  `reconciliation.js`, `pace.js`, `routes/plans.js`, `plan-ingest.test.js`,
  `single-writer-guard.test.js`

## Durable-cure obligations (MANDATORY — defect-catalog citations)

1. **§9.1 DERIVED-DUAL-VIEW** (pre-flagged for this build, 3 forms): one home
   `server/lib/value-ledger.js` for every derived value (DEC-5); **T6
   `ledger-metrics-parity.test.js`** drives one seeded DB through the real route AND the
   real spawned CLI — if T6 becomes "spawn the CLI with the API mocked," that is the
   2026-08-01 fix regressing; cross-feed dedupe on `('trunk_commit', sha)` (DEC-4/O-16,
   all three parts incl. the Phase-1b CHECK tripwire A6.7); closure derived by join —
   **no `closed_at` on `value_claims`, ever**.
2. **§9.2 row-id-as-chronology-proxy:** every LIMITed walk of
   `events`/`sessions`/`focus_inferences` orders by `created_at, id` first.
3. **§9.3 VACUOUS-GUARD (standing rule):** every structural guard ships with a
   **recorded red state** against a real mutation, restored byte-identical;
   `assert.ok(true` / `|| true` sweeps stay at 0.
4. **§9.7 HAND-SCOPED STRUCTURAL SCAN (DEC-9/O-18):** register the four new server files
   in `chronology-ordering.test.js` **in the same commit as `value-ledger.js`**, then
   derive `filesToScan` from `server/lib/*.js` + `server/routes/*.js` with per-file
   dispositions. The DEC-9 "bounded fallback" may only be taken with a dated
   `decisions.md` row. Consume `server/__tests__/helpers/single-home.js` for every
   scope-derived guard (A3.6, A5 closure guard) — never a second hand-rolled helper.
5. **CWD-IDENTITY-FANOUT (candidate):** import idempotency keyed
   `(project_id, imported_content_hash)`, never cwd; `cwd-identity.js` is the sole
   canonicalizer; `identityWarnings` on the pool response.
6. **CONTRACT-SPEC-DRIFT (candidate, O-19):** new `openapi-contract.test.js`;
   the `getProjectPlans` operationId collision (`server/openapi-extra/plans.js:236`)
   is blocking; regenerate `openapi.yaml` in the docs step.
7. **§9.5/§9.6 are INAPPLICABLE by design** (new tables, zero ALTER, zero rebuilds) —
   any "just reuse `plan_items`" shortcut is a blocking review objection (R3).
8. **Project rule:** file-overview + `@author Son Nguyen <hoangson091104@gmail.com>`
   header on every new source file; `check-headers.sh` exits 0.

## Environment / session-safety notes

- **No Docker stack** — npm-based project; no compose file exists, step skipped.
- **Effort registry:** `PROJECT-CONTEXT.md` names no effort-registry convention and no
  `.em-state/` exists — registration step skipped per instructions. The worktree itself
  is registered in git (`git worktree list`).
- **Ports:** the shared dev stack is already running from the main checkout
  (`DASHBOARD_PORT` default **4820**, vite client on its own port via `scripts/dev.js`).
  Do not start a second `npm run dev` from the worktree without setting a different
  `DASHBOARD_PORT`. Test suites (`node --test`, `vitest run`) don't need the dev stack.
- **Shared DB:** `DB_PATH` → user-global `~/.claude/agent-dashboard/dashboard.db` from
  any worktree. Tests must use throwaway DBs (existing convention); the live trial
  (slice 4) requires the DB backup first.
- **Sibling efforts:** `practice-kind-override` (dirty, live) and
  `trunk-drift-detection` (merged, pending teardown) worktrees exist — do not touch.

## Caveat (non-blocking, dispositioned here)

The main checkout has exactly **one** dirty file:
`intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md` — a 1-line edit marking
DEC-2 **SATISFIED** (this pipeline's own bookkeeping from the merge step that ran
minutes ago). It is a planning artifact of this very effort, not code; it is not on any
surface the build touches; and it cannot enter the isolated worktree (created from
committed HEAD 554f7d1, verified clean). Disposition: the orchestrator should commit it
to `master` as intake bookkeeping (the repo's existing `docs(intake): record …`
convention) at the next natural commit point. Recorded here so it is not a silent pass.

## Open questions

- **BLOCKING:** none.
- **Non-blocking (assumptions stated):**
  - O-4 baseline is taken as the orchestrator's post-merge clean-tree run
    (server 1425/1425, client 771/771); the implementer should still run the verbatim
    floor commands from test-plan "Regression floor" at each slice gate.
  - DEC-12 (Sara's slice-4 gate) and DEC-13 (`DND`/`dnd` cleanup before the trial) are
    human-gated and cannot be waived by auto-pilot — build stops at slice 4 until
    answered.
