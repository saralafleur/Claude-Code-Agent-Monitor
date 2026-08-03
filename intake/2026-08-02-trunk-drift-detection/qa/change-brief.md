# Change Brief — trunk-drift-detection (Phase 1a only)

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-08-02
- **Scope source:** intake-handoff (team-intake hand-off; no code written yet)
- **Intake link:** `intake/2026-08-02-trunk-drift-detection/` —
  `technical-plan.md` + `pm-plan.md` + `decisions.md` (same folder)

## ⚠️ Scope boundary — read before planning tests

This intake specifies **two phases**. **This QA pass covers Phase 1a ONLY.**
Phase 1b (`detour_dispositions.source` CHECK-widening atomic rebuild,
`server/lib/db-rebuild.js`, the `detours.js` write adapter
(`recordTrunkDriftDetour`/`backfillTrunkDriftDetours`), `reconciliation.js`
periodic-tick wiring, and the prompt-budget hardening in
`buildDispositionPrompt`) is **explicitly out of scope for this round — not
"not needed," but *not yet authorized***. Per `decisions.md` **WATCH-5**,
Phase 1b is hard-gated on Sara personally reviewing a live pending
`decision_queue` write-back failure (DEC-7's live trial) before it may start;
that trial has not happened as of this pass. Do not design tests for
`server/lib/db-rebuild.js`, the CHECK widening, `recordTrunkDriftDetour`,
`backfillTrunkDriftDetours`, `SOURCES`, `capLabel`, `formatTrunkDriftLabel`,
the `reconcileCwd` periodic-invocation step, or `buildDispositionPrompt`'s
reorder/budgeting — none of that code exists yet and none of it is being
built this round.

The **one deliberate exception** carried into Phase 1a from the Phase 1b
list: `parseDispositionOutput`'s logging fix in `reconciliation.js` (DEC-4
carve-out) — two `log()` calls, zero behavioral/verdict change. That one
Phase-1b-adjacent edit **is** in scope for this pass.

## Change summary

Add a read-only, live-computed "direct-to-trunk commit" detector
(`server/lib/trunk-drift.js`) that walks a repo's default-branch first-parent
line via a new shared `server/lib/git-refs.js` helper (partially extracted
from `server/lib/update-check.js`), expose it through a new
`GET /api/projects/:id/trunk-drift` route, and surface it as a new read-only
card on the Project Detail page (all four locales) — plus two log lines
added to `reconciliation.js`'s `parseDispositionOutput`. No schema change, no
`detour_dispositions` write, no LLM/classification logic anywhere in this
phase.

## Changed files (by layer)

**Backend — new**
- `server/lib/git-refs.js` (NEW) — `execGit`, `listRemotes`,
  `pickCanonicalRemote`, `REMOTE_PRIORITY` moved *verbatim* out of
  `update-check.js`, plus new `resolveDefaultBranch(repoPath, opts)`
  (5-step resolution order: `remote_head` → `remote_ref` (candidates
  `main`/`master`) → `local_ref` → `sole_local_branch` → `null`; never a
  GitHub API call, no fetch unless `allowFetch === true`, which no Phase 1a
  caller passes).
- `server/lib/trunk-drift.js` (NEW) — `detectTrunkDrift(repoPath, opts)`: one
  bounded `git log --first-parent --no-merges --since=… --max-count=…
  --shortstat --not --exclude=refs/heads/<branch> --branches` walk. Imports
  `{ execGit, resolveDefaultBranch }` from `./git-refs` and `{ isGitRepo }`
  from `./repo-topology` (no third private `execGit` copy). Writes nothing,
  reads no SQLite, caches nothing — same posture as `repo-topology.js`.
  Returns `{ skipped: null, commits: [...], commitCount, truncated, range,
  ... }` or `{ skipped: "not_a_repo"|"no_default_branch"|"no_commits"|
  "git_error", repoPath }` — never a throw, never a guessed "clean".

**Backend — modified**
- `server/lib/update-check.js` — delete private `REMOTE_PRIORITY`,
  `listRemotes`, `pickCanonicalRemote`; import from `./git-refs` instead.
  `execGit` (120s default, for `git fetch`) and `resolveCompareRefForRemote`
  are left byte-for-byte unchanged. `module.exports` stays
  `{ getUpdatesStatus, DEFAULT_ROOT }`.
- `server/routes/projects.js` — add `GET /:id/trunk-drift`, placed beside the
  existing `GET /:id/repos` (confirmed at line 381 in current code). Iterates
  `stmts.listProjectPaths`, skips non-repos, calls `detectTrunkDrift` per
  mapped path, returns `{ repos: [{ cwd, pathId, drift }] }`. Passes no
  `seenShas` (nothing persisted in this phase). `/:id/repos`'s existing
  response shape is required to stay unchanged.
- `server/lib/reconciliation.js` — **DEC-4 carve-out only.** Two `log()`
  calls added: one in `parseDispositionOutput`'s terminal `catch`, one after
  a successful parse when `out.size === 0 && flagged.length > 0`. Confirmed
  by direct read (current `catch { return new Map(); }` at line ~237 is
  silent today). Zero change to any verdict, to `buildDispositionPrompt`, or
  to any other exported function.

**Frontend — modified**
- `client/src/lib/types.ts` — add `TrunkDriftCommit`, `TrunkDriftResult`,
  `ProjectTrunkDriftResponse` types, beside the existing
  `ProjectRepoTopology`.
- `client/src/lib/api.ts` — add `projects.trunkDrift(id)` beside the existing
  `projects.repos(id)` (confirmed at line 2420 in current code), same
  doc-comment style.
- `client/src/pages/ProjectDetail.tsx` — one new read-only card
  ("Direct-to-trunk work"), per mapped repo: default branch, commit count,
  lookback window, commit list (short SHA · subject · author · relative
  date · +I/-D). Confirmed the page's existing repo-topology wiring
  (`api.projects.repos`, `repoTopology` state, `ProjectRepoTopology` type at
  lines ~130/648/808/867+) as the precedent this new card follows.
  `skipped` reasons must render as an explicit "unknown" state, never as
  "clean." No badge, no verdict, no action button.
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — new keys for
  the card, all four locales in the same change.

**Database / migration**
- None. No `CREATE TABLE` edit, no `ALTER TABLE`, no CHECK change in this
  phase. Confirmed by direct read: `server/db.js:701` still reads
  `source TEXT NOT NULL CHECK(source IN ('inferred','declared'))` — the
  widening to add `'trunk_drift'` is Phase 1b, untouched here.

**Tests already changed in this set**
- None — no code exists yet (confirmed: `server/lib/trunk-drift.js`,
  `server/lib/git-refs.js` do not exist in the working tree; no
  `trunk`-related string appears anywhere in `client/src/lib/types.ts`,
  `client/src/lib/api.ts`, `client/src/pages/ProjectDetail.tsx`,
  `docs/API.md`, `docs/DATABASE.md`, or `ARCHITECTURE.md`). The technical
  plan specifies tests to be written as part of the same build
  (`server/__tests__/trunk-drift.test.js` new, plus a case added to
  `server/__tests__/projects.test.js`), listed here as **planned**, not
  "already covered":
  - `trunk-drift.test.js` — real throwaway git fixtures (no mocked
    `child_process`), §6.1 cases 1a–8 in `technical-plan.md` (default-branch
    resolution across `main`/`master`/nonstandard names, with/without a
    remote; no-default-branch skip; clean-trunk/no-drift + the fast-forward
    variant — the load-bearing false-positive guard; dirty-but-uncommitted;
    bounded first-run lookback; truncation; genuine positive; `seenShas`
    idempotency filter; git-DAG-vs-`created_at` ordering; every `skipped`
    reason).
  - `update-check.test.js` — must pass **unmodified** after the `git-refs.js`
    extraction (the plan's own proof the refactor is behavior-preserving).
  - `projects.test.js` — new case: 404 on unknown project, `{ repos: [] }`
    on no repo paths, populated `drift` for a fixture repo with a
    direct-to-trunk commit.
  - `reconciliation.test.js` — must pass green **unmodified** after the
    DEC-4 logging carve-out.
  - `client/src/pages/__tests__/screens.snapshot.test.tsx` — will change
    (new card); plan requires eyeballing the diff before regenerating with
    `cd client && npx vitest run -u`, never blind-updating.

**Config / other**
- Env knob: `DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS` (default 7 days), read by
  `trunkDriftLookbackDaysFromEnv()`. To be documented in `server/README.md`.
- Docs updates required per CLAUDE.md's `update-project-docs` skill:
  `docs/API.md` (new route), `docs/DATABASE.md` (n/a for 1a — no schema
  change, but should note the deferral), `ARCHITECTURE.md` (new derivation
  module), `server/README.md` (the env knob). None of these edits exist yet.

## Surfaces / features touched

- **New surface:** "Direct-to-trunk work" read-only detection, exposed via
  `GET /api/projects/:id/trunk-drift` and a new Project Detail page card.
- **Refactored, behavior-preserving:** `server/lib/update-check.js`'s
  default-branch/remote-resolution internals (the "check for dashboard
  updates" feature) — via the `git-refs.js` extraction. This is the one
  place a regression in *existing* behavior could hide inside an
  otherwise-new-feature change.
- **Logging-only:** `server/lib/reconciliation.js`'s disposition-parsing
  failure path (layer 6, the LLM disposition pass) — no verdict/behavior
  change, only observability.
- **Untouched despite being nearby:** `detour_dispositions` table/writes,
  `server/lib/detours.js`, the pending-detour badge on `ProjectManager.tsx`,
  `plan-writeback.js`, `decision_queue` — all Phase 1b or explicitly
  declared out of scope (WATCH-7).

## Variant relevance

This project's configured recurring-defect catalog (`PROJECT-CONTEXT.md`
§9.1 DERIVED-DUAL-VIEW) names cross-consumer/cross-path value consistency as
its #1 recurring bug class. Two candidate "variants" for this change:

1. **Default-branch resolution has exactly one implementation** —
   `git-refs.resolveDefaultBranch`, used by both `trunk-drift.js` (new) and
   (via the refactor) `update-check.js` (existing). The plan is explicit
   this must not become two independent "what is trunk" guesses. **Directly
   relevant** — a test should confirm `update-check.js`'s own resolution
   behavior for `remote_ref`/symbolic-ref cases is unchanged post-extraction
   (its own test suite green, unmodified, is the plan's stated proof), not
   just that `trunk-drift.js`'s new call sites work in isolation.
2. **Locale variants** — all four locale files
   (`en`/`ko`/`vi`/`zh` `projectDetail.json`) must gain the same new keys in
   the same change; a card that silently falls back to a raw i18n key in one
   locale is this project's variant-isolation failure mode.

No tenant/office/multi-render-path variant applies otherwise — this is a
single server-side detector with one client card.

## Test-invariants at risk

- [x] **Cross-path consistency (git-refs.js single-home rule)** — no
  catalog id (project's catalog §9.1/§9.2 are about derived *values*, not
  git-ref resolution, per se — but the technical plan itself states this is
  the equivalent discipline: "two 'what is trunk' implementations is the
  shape the catalog keeps re-flagging"). Touched: yes — `trunk-drift.js` and
  `update-check.js` share `resolveDefaultBranch`/`pickCanonicalRemote`/
  `listRemotes`. Verify both consumers actually import from `git-refs.js`
  (not a re-copy) and that `update-check.test.js` passes with zero edits.
- [x] **False-positive guard (git-native predicate)** — DEC-5, the single
  most load-bearing test in the whole suite per QA's own framing: work that
  went through the tracked worktree/declared-focus flow and merged
  (`--no-ff`) must **never** be flagged, including the fast-forward-then-
  branch-deleted edge case named as WATCH-1's accepted residual false
  positive (still true even though the badge/LLM pipeline it would normally
  feed is Phase 1b — the *detector's own read-only card* must not lie to a
  human either). Case 3/3b in `technical-plan.md` §6.1; must be proven red
  by removing `--first-parent`/`--no-merges` per the project's §9.3
  VACUOUS-GUARD convention.
- [x] **"Never guess, never a false clean"** — `checkWorktreeDirty`'s
  established contract in this codebase (`repo-topology.js`), explicitly
  extended to `trunk-drift.js`: every failure/uncertainty path returns
  `{ skipped: <reason> }`, never a throw, never an empty-commits "clean"
  result. Touched directly — verify all `skipped` reasons (`not_a_repo`,
  `no_default_branch`, `no_commits`, `git_error`) render as "unknown" in the
  UI, never as "clean."
- [ ] **Round-trip integrity** — not applicable in this phase; nothing is
  persisted (no DB write at all in Phase 1a).
- [ ] **No unresolved-boundary-token leak** — not applicable; no template
  rendering of user-composed labels into an LLM prompt happens in Phase 1a
  (that risk — WATCH-4, commit-subject text reaching an LLM prompt — is a
  Phase 1b concern, out of scope here since no label is composed or written
  anywhere in Phase 1a).
- [x] **Behavior-preservation of the refactor target** — general invariant,
  not catalog-named: `update-check.js`'s existing "check for dashboard
  update" feature must be provably unchanged after `git-refs.js`
  extraction. The plan's own check is `update-check.test.js` green with
  zero edits to that file; a test plan should treat that as a hard
  requirement, not an assumption.
- [x] **API response-shape stability** — `.claude/rules/backend-node.md`:
  `GET /:id/repos`'s existing response shape must be provably unchanged
  (confirmed today it returns `{ project_id, repos, nonRepoFolders,
  detectedSiblings, ignoredRepos }` from `buildProjectRepoTopology`); the
  new `/:id/trunk-drift` route must be additive only.

## Stated intent / acceptance

From `technical-plan.md` §8 Definition of Done (Phase 1a subset):
- `npm run test:server` and `npm run test:client` green;
  `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- `update-check.test.js` passes with **zero edits** after the `git-refs.js`
  extraction.
- `trunk-drift.test.js` covers every §6.1 case (enumerated above).
- Case 3 (clean trunk / no drift) is **proven red** by removing
  `--first-parent`/`--no-merges`, with the red observation recorded in the
  commit message.
- `GET /api/projects/:id/trunk-drift` returns per-mapped-repo results;
  `/:id/repos`'s response shape is unchanged.
- Project Detail renders the card; `skipped` renders as "unknown," never
  "clean"; all four locales updated together; snapshot diff eyeballed
  before regeneration.
- `server/lib/trunk-drift.js` contains **no** occurrence of `fold_in`,
  `new_item`, `deliberate`, or `discard` (grep-checkable) — no
  classification logic anywhere in the detector.
- Docs updated (`docs/API.md`, `ARCHITECTURE.md`, `server/README.md`).

## Open questions

**Blocking (cannot plan tests):**
- (none)

**Non-blocking (proceeding on assumption):**
- The technical plan's Phase 1b column-count claim ("the full current
  28-column shape") does not match a direct count of today's
  `detour_dispositions` `CREATE TABLE` body (`server/db.js:696-733`), which
  is 29 columns, not 28 → assumption: irrelevant to this Phase 1a pass
  (no rebuild is being built or tested this round), but worth flagging back
  to the build for whenever Phase 1b actually starts, since the plan
  states this count must be verified "column-by-column against the live
  `CREATE TABLE` body."
- The plan's git-log command in §3.1/step 3
  (`--not --exclude=refs/heads/<branch> --branches`) is stated as
  "order-sensitive" and something the build must "verify… against the real
  fixtures." → assumption: this is exactly what `trunk-drift.test.js`'s
  case 3/3b (proven red per §9.3) is designed to catch, so treating it as a
  build-time verification step (not a pre-verified fact) is correct and
  matches the plan's own instruction.
- No git diff/build artifacts exist yet for this feature (confirmed: no
  `trunk-drift.js`/`git-refs.js` files, no `trunk` string in any client/doc
  file listed above) → assumption: this is a pure pre-build plan review, so
  the "changed files" list above is the **intended** change set per the
  technical plan, cross-checked against current code where the plan cites
  specific line numbers/behavior (all citations confirmed accurate: db.js
  line 701's CHECK, projects.js line 381's route, api.ts line 2420's
  `repos` entry, `update-check.js`'s current `REMOTE_PRIORITY`/
  `listRemotes`/`pickCanonicalRemote`/`resolveCompareRefForRemote` shape,
  `reconciliation.js`'s current silent `catch { return new Map(); }`).

## Verdict
**READY**
