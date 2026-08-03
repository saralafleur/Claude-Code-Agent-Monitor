# Build Brief — Slice 5 (Plan Ledger workbench UI)

**Effort:** `intake/2026-08-02-plan-lifecycle-value-ledger/` (parent intake) —
**this build is slice 5 only**, run as its own dated build cycle after
`DEC-12` was answered SIGNAL on 2026-08-03.
**Slug for this build:** `2026-08-03-plan-lifecycle-workbench-ui`
**Branch:** `effort/2026-08-03-plan-lifecycle-workbench-ui`

## What we're building

Slices 0-4 (schema, `plan-lifecycle.js`, `value-ledger.js`,
`/api/project-plans` routes, `ccam ledger` CLI) already shipped to `master`
(merge commit `9ee4653`, `intake/.../build/2026-08-02-.../build-report.md`,
verdict GREEN-WITH-CAVEATS). This build adds the deferred client surface: a
self-contained `<PlanLedgerPanel>` two-pane reconciliation workbench
(left = a project's open plans with nested items and a close action; right =
the live unclaimed value pool with tier badges and a claim gesture; closed
generations collapse into history), rendered as a card inside the existing
Project Detail page. Health numbers (`unclaimedPoolSize`, `daysSinceLastClosure`,
etc.) render **verbatim from the server payload** — the client performs no
re-derivation of any value already computed in `server/lib/value-ledger.js`.
No new route, nav entry, or i18n namespace — strings land in the existing
`projectDetail.json` × 4 locales, per `DEC-8`'s "gate before the surface, then
keep it small" design (the point of the whole slicing: `18196dc`'s costly UI
blast radius is what this shape avoids).

## Plan sources

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-plan-lifecycle-value-ledger/technical-plan.md`
  — §4 "Slice 5 — UI (only after the gate)", items 18-21 (line ~384).
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-plan-lifecycle-value-ledger/qa/test-plan.md`
  — "Layer F — client component/page/snapshot (9 cases)" (line 432).
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-plan-lifecycle-value-ledger/build/2026-08-02-plan-lifecycle-value-ledger/build-task-list.md`
  — "SLICE 5 — UI" section, T5.1-T5.4 (line ~364), already fully specified,
  previously marked "not executed in this build" — that gate is now lifted.
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md`
  — `DEC-12`, status **DECIDED — SIGNAL (2026-08-03)** (verified by direct
  read, confirming the orchestrator's summary rather than trusting it).

Both plans were read in full for this scope and are buildable: the technical
plan names a concrete change set (5 files + 4 locale files + 2 new/updated
spec files) and implementation steps (18-21); the test plan names 3 specific
spec files (F1/F2/F3) with exact case counts (7+1+1=9), a stated red-proof
(F1's R1: temporarily render `pool.length` as the headline number, prove the
health-verbatim case goes red), and an explicit no-blind-regen discipline for
F3. The two plans correspond to the same surfaces (types/api/component/page/
locales/snapshot) — no drift between them.

## Surfaces touched

- `client/src/lib/types.ts` — add `ProjectPlan`, `ProjectPlanItem`, `ValueUnit`,
  `ValueClaim`, `PlanHealth`, `ValuePool` types.
- `client/src/lib/api.ts` — add `api.projectPlans.*` functions.
- `client/src/components/PlanLedgerPanel.tsx` — **new**.
- `client/src/pages/ProjectDetail.tsx` — render slot only (add the card beside
  existing ones); do not touch its other 15 existing test cases' behavior.
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — new strings,
  existing namespace, no new keyspace elsewhere.
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` — **new** (F1, 7
  cases).
- `client/src/pages/__tests__/ProjectDetail.test.tsx` — update (F2, 1 case;
  mock `api.projectPlans.*` in shared setup, not per-case).
- `client/src/pages/__tests__/__snapshots__/screens.snapshot.test.tsx.snap` +
  `screens.snapshot.test.tsx` — reviewed regen (F3, 1 case): add
  `api.projectPlans` responses to the Project Detail screen's mock fixture
  (~line 653 on the pre-build tree), regenerate with
  `cd client && npx vitest run -u`, and **review the diff** — it must touch
  only Project Detail (+ shell chrome) and must show the panel's real markup,
  never an empty/error state.
- **No server files, no new routes, no schema changes.** The backend is
  already shipped on `master` and is out of scope for this build.

**Project-specific risk surfaces to flag (from `PROJECT-CONTEXT.md`):**

- **§9.1 DERIVED-DUAL-VIEW is live and binding here.** `value-ledger.js`
  already owns every derived value; `PlanLedgerPanel.tsx` becomes derived-value
  **consumer #2** (alongside `ccam ledger`, consumer #1) the moment it renders
  a health number. The technical plan's own guardrail (§5, binding rule 1) is
  explicit: no React component may recompute or partially recompute
  `unclaimedPoolSize`, `daysSinceLastClosure`, the pool, the generation
  ordinal, or the whole-life summary. F1's health-verbatim case (mocked
  `unclaimedPoolSize=37` while the mocked pool array has length 5 → panel must
  show 37, not `pool.length`) is the enforcement mechanism — do not weaken or
  skip it.
- **CWD-IDENTITY-FANOUT** — out of scope for this slice by design (the panel
  reads server-computed `identityWarnings` off the pool response if present;
  it must not call any cwd-canonicalization logic itself — that stays sole
  property of `server/lib/cwd-identity.js`).
- **§9.3 VACUOUS-GUARD — this project's build-outcome note names this exact
  intake as the live example (2026-08-03 entry: two independent server-side
  test-author agents delivered whole spec files that passed while asserting
  nothing, on this same effort's earlier slices).** F1's red-proof (R1) must
  actually be performed and observed red, not merely described — mutate the
  component to render `pool.length` instead of `health.unclaimedPoolSize`,
  confirm the specific case fails, restore, confirm green again. A reported
  "I ran it red" without a fresh independent re-check is explicitly
  **unverified** per this project's own standing rule.
- **No blind snapshot regen (sequencing note #4 in the parent build-task-list).**
  Regenerate `screens.snapshot.test.tsx` baselines **only** on a tree
  containing this effort's UI diff and nothing else — this worktree, freshly
  branched off a clean `master`, satisfies that; do not run the regen against
  any other dirty checkout (e.g. the sibling `2026-08-02-trunk-drift-detection`
  or `2026-08-03-trunk-drift-open-branch-blindness` worktrees, which independently
  modify overlapping client files).

## Durable-cure obligations (MANDATORY)

1. **§9.1 DERIVED-DUAL-VIEW** — health/pool values render from the server
   payload only; no client re-derivation. Enforced by F1's health-verbatim
   case + its red-proof R1 (see above). This is the second consumer this
   catalog entry's own history says is where the failure lands — treat the
   guard as load-bearing, not decorative.
2. **File-header convention** (`.claude/rules/file-headers.md`, this build's
   own CLAUDE.md) — every new/edited applicable source file
   (`.ts/.tsx` here) must start with a truthful file-overview comment plus the
   exact line `@author Son Nguyen <hoangson091104@gmail.com>`. New files:
   `PlanLedgerPanel.tsx`, `PlanLedgerPanel.test.tsx`. Files already carrying a
   header just need their overview kept truthful if their purpose changes.
   Verify with `bash .claude/skills/file-headers/scripts/check-headers.sh`
   (exits 0 on the clean worktree as provisioned — see Verification below).
3. **No raw locale keys in the DOM** (F1's own case) — a missing/wrong i18n
   key must not leak `projectDetail.something.key` text into rendered output.
4. **Closed generations expose no item-edit/claim/unclaim affordances** (F1) —
   this is the client-side mirror of the server's already-enforced "no API or
   DB path marks a value unit closed except plan closure" (T2/T5, slices 1-3);
   don't let the UI offer an action the API would 409 on.

## Worktree

- **Path:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor`
- **Branch:** `effort/2026-08-03-plan-lifecycle-workbench-ui` — **new branch**
  off `master`.
- **Starting commit:** `2f8408a0d56799a8002d859e9f14e3927a3868af`
  (`feat(ccam): add --lookback-days to 'ledger pool', taking precedence over
  --backfill` — the tip of `master` at provisioning time, which already
  includes the slice 1-3 merge `9ee4653` and the subsequent slice-3/4
  follow-ups).
- **Status at provisioning:** confirmed clean (`git status --porcelain` empty)
  immediately after `git worktree add`.
- Repo layout is single-repo (`PROJECT-CONTEXT.md` confirmed, no sibling repos
  matched) — one worktree is the whole environment.
- Dependencies: `node_modules` did not exist in the new worktree (worktrees
  never inherit installed deps — this repo's own known gotcha). Ran `npm
  install` at the worktree root; the repo's own `postinstall` hook
  transitively installed `client/node_modules` as well (confirmed present,
  `vitest` binary resolves). No `mcp/`/`vscode-extension/` install was run —
  out of scope for this client-only slice and not needed for
  `npm run test:client`.
- **Pre-build baseline, captured on this worktree before any implementation:**
  `npm run test:client` → **59 files / 773 tests, all green.**
  `bash .claude/skills/file-headers/scripts/check-headers.sh` → clean.
  Neither `client/src/components/PlanLedgerPanel.tsx` nor
  `client/src/components/__tests__/PlanLedgerPanel.test.tsx` exist yet, and
  `client/src/lib/types.ts` / `api.ts` carry none of the new
  `ProjectPlan`/`ValueUnit`/`projectPlans` symbols — confirmed a clean slate
  for slice 5, not a partial prior attempt.
- No docker-compose stack was provisioned: this repo's `docker-compose.yml`
  files (`docker-compose.yml`, `docker-compose.full.yml`,
  `monitoring/docker-compose.yml`) are production/monitoring deployment
  artifacts (`build: .`, mounts `~/.claude/agent-dashboard`); local dev and
  test both run directly via `npm run dev` / `npm run test:client`, and
  `PROJECT-CONTEXT.md` names no per-effort Docker convention. Not applicable
  to this build.
- No effort registry file exists for this project (`PROJECT-CONTEXT.md` names
  none) — skipped per the generic process's own conditional step.

## Back-out

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor \
  reset --hard 2f8408a0d56799a8002d859e9f14e3927a3868af
```

Per the parent technical-plan's own rollback note for slice 5: if this needs
to be fully unwound later, delete `PlanLedgerPanel.tsx`, remove its render
slot in `ProjectDetail.tsx`, remove the `projectDetail.json` keys ×4 locales,
and regenerate snapshots — no route, nav entry, or locale namespace to unwind.

## Note on the main checkout

Before branching, `master`'s working tree carried two uncommitted docs edits
from earlier in this session (`README.md` — the `ledger pool --lookback-days`
CLI doc line; `intake/2026-08-02-plan-lifecycle-value-ledger/decisions.md` —
the `DEC-12` SIGNAL sign-off record). These were **stashed**, not committed or
discarded, so they don't blend into this build's starting commit:

```
git stash list   # "pre-slice5-triage: uncommitted docs edits (DEC-12 sign-off, README ledger CLI flags)"
git stash pop    # restore them on master when convenient — unrelated to this build
```

They are pure documentation of already-shipped slice 1-4 work, not code, and
have no bearing on this worktree's starting state.

## Open questions

**Non-blocking (stated assumption):**

- The technical plan's line-653 pointer for where to add
  `api.projectPlans` mock fixtures in `screens.snapshot.test.tsx` was written
  against an earlier tree state; the implementer should locate the Project
  Detail screen's existing mock fixture block by content, not by trusting the
  line number literally (this project's own recorded lesson from §9.6's
  "re-verify by grep, not by line number" applies generally here).
- `DEC-16 (WATCH)` — MCP tools and the `AGENT-PLAN.md` export are named future
  consumers #3/#4 of the shared ledger computation but are explicitly **not**
  part of this build (`No MCP change in this effort` per the technical plan's
  §6). Assumption: this build does not need to touch `mcp/` at all, and
  `npm run mcp:typecheck` is unaffected — consistent with the scope given.

No BLOCKING open questions — both plans are concrete enough to start.

## Verification commands the implementer should know

```
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
npm run test:client
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
cd client && npx vitest run -u   # snapshot regen — review the diff, never blind
bash .claude/skills/file-headers/scripts/check-headers.sh
```
