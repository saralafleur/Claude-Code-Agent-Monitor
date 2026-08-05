# Build Brief — value-summary-tick

Slug: `2026-08-04-value-summary-tick`
Prepared by: Build-Intake Clerk
Date: 2026-08-04

**STATUS: READY.**

## What we're building

A project's PROJECT/STAKEHOLDER altitude synthesis today completes only 40
uncached units per page visit, so a large pool (the measured worst case is
182 units) needs several manual reloads to fill, and a unit with no text is
indistinguishable from a unit whose synthesis genuinely failed. This build
adds a bounded background tick (`server/lib/value-summary-tick.js`,
registered in `startBackgroundServices()`) that sweeps `MAX_PROJECTS_PER_TICK`
projects per cycle in least-recently-swept rotation and makes exactly one
`enrichPoolAltitudes` call per swept project, drains overflow unattended, and
lands two new audit tables (`value_summary_sweep_state`,
`value_summary_generation_log`) recording what each sweep did. The composer's
return shape grows a `states` map (`queued` vs `unavailable`) so absence is no
longer overloaded, `POST /api/project-plans/altitudes` forwards it unchanged
(still synchronous, still capped at 40), and the client panel renders the two
states distinguishably in the same render. No read-only cutover, no client
live-subscription in v1 (both explicitly declined — DEC-3, DEC-8/OPEN-3).

## Plan sources

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-04-value-summary-tick/technical-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-04-value-summary-tick/qa/test-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-04-value-summary-tick/decisions.md` (DEC-1…DEC-15, WATCH-1…WATCH-8, OPEN-1…OPEN-4 — read in full)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-04-value-summary-tick/qa/decisions.md` (QA-DEC-1…QA-DEC-4)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-04-value-summary-tick/pm-plan.md`, `request-brief.md`, `supporting/`, `qa/supporting/` (context)
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/PROJECT-CONTEXT.md` (repo topology + defect catalog, read in full)

**Both plans present, non-empty, and buildable.** `technical-plan.md` has a
concrete change set (§3, per-file diffs) and 18 dependency-ordered
implementation steps (§4), each with a stated "Proves:" line. `test-plan.md`
names specific spec files, exact case counts, exact assertion forms (e.g. the
corrected four-term audit-log partition, §0 C1), and enforces red-first
discipline explicitly at every step (§ "Implementation steps", each numbered
step states its red-first proof and required mutation). The two plans are
about the same surfaces: `server/lib/value-summary.js`,
`server/lib/value-summary-tick.js` (new), `server/routes/project-plans.js`,
`server/db.js`, `server/lib/value-ledger.js`, `server/index.js`,
`client/src/lib/types.ts`/`api.ts`, `client/src/components/PlanLedgerPanel.tsx`,
the four `projectDetail.json` locales, and the guard files
(`single-writer-guard.test.js`, `ledger-metrics-parity.test.js`,
`chronology-ordering.test.js`). No drift found between the two plans within
scope — the test-plan's own §0 explicitly reconciles three arithmetic
corrections against the technical plan's own definitions (e.g. the four-term
partition is derived directly from `technical-plan.md` step 5's
`cacheHits`/`generated`/`queued`/`unavailable` definitions).

## Repo layout

Confirmed via `PROJECT-CONTEXT.md` ("Repo topology," confirmed 2026-07-31) and
independently re-verified now: `find <root> -maxdepth 2 -name .git` finds only
the top-level `.git`. **Single self-contained monorepo** — Express/SQLite
server, React+Vite client, MCP server, Electron desktop app, VS Code
extension, all under one root, no sibling repos. Base/working branch:
`master` (`refs/remotes/origin/HEAD` → `refs/remotes/origin/master`; local
checkout was also on `master` at provisioning time, at `b155f83`). One repo
touched — this effort's whole change set (server libs/routes/schema, client
lib/component/i18n, docs) lives in this one repo.

**Effort registry: none configured.** `PROJECT-CONTEXT.md` names no effort
registry for this project (only "Repo topology," "Recurring defect-class
patterns," and "Planning notes" sections exist) — step skipped, consistent
with every prior triage pass on this repo (`2026-07-26-focus-calendar-board`
through `2026-08-02-trunk-drift-detection`).

## Docker stack

**Not provisioned.** Three docker-compose files exist at the project root
(`docker-compose.yml`, `docker-compose.full.yml`, `monitoring/docker-compose.yml`),
but they describe the containerized **production** build path — a separate,
optional path from the native dev/test loop, per `.claude/skills/devops/SKILL.md`.
Confirmed for this build specifically: `package.json`'s `test:server`
(`node --test server/__tests__/*.test.js`) and `test:client`
(`cd client && npm test`, Vitest) both run directly against throwaway SQLite
DBs (each server spec sets its own `DASHBOARD_DB_PATH`) with no container
dependency, and `test-plan.md`'s own "How to run" section verifies exclusively
via those same commands plus single-spec `node --test`/`vitest run` invocations
— no external stack, no browser e2e, no reference to `docker compose` anywhere
in either plan. This matches every prior triage pass on this repo
(`2026-07-26-focus-calendar-board` through `2026-08-02-trunk-drift-detection`),
none of which provisioned a Docker stack for the same reason. `build-verifier`
will run the suite commands directly against the worktree; no compose file,
`.env`, or port-block assignment is needed.

## Safety gate

The main repo checkout (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`)
shows two items in `git status` unrelated to this build: `AGENT-PLAN.md`
(modified) and `.claude/agent-plan-backups/` (untracked) — pre-existing noise
from before this session (likely a concurrent session or an auto-backup), plus
the entire `intake/2026-08-04-value-summary-tick/` folder (untracked —
process documentation for this build itself, not product code). None of this
is this build's concern and none of it carried into the worktree: a fresh
`git worktree add` checks out from the branch ref, not from the main
checkout's dirty index/working tree.

**Per-effort worktree provisioned and verified clean:**

```
$ git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor status --porcelain
(no output)
```

Clean — confirms the pre-existing main-checkout noise did not carry over.

**The branch pre-existed this triage pass, as flagged in the task input**, and
was reused rather than recreated:

```
$ git rev-parse master
b155f830c79698349952d2c88ea9f60bedaaf66d
$ git rev-parse effort/2026-08-04-value-summary-tick
b155f830c79698349952d2c88ea9f60bedaaf66d
$ git log -1 --format="%H %s" b155f83
b155f830c79698349952d2c88ea9f60bedaaf66d feat(client,server): three-altitude Value Pool + info modal on Plan Ledger
```

Confirmed: `master` and `effort/2026-08-04-value-summary-tick` are both at
`b155f83` — byte-identical, as stated in the task input and as
`test-plan.md`'s own header independently asserts ("`effort/2026-08-04-value-summary-tick`
is byte-identical to `master`. Every test below is red-first against unbuilt
code."). `b155f83`'s commit message (`feat(client,server): three-altitude
Value Pool + info modal on Plan Ledger`) matches **DEC-13**'s description of
the ~991-line altitude layer this technical plan's own Step 1 calls for
committing on `master` before branching — that precondition is already
satisfied; **Step 1 sub-steps 1–3 (verify green, commit) and sub-step 4
(branch) are done.** The implementer does not need to repeat them, only
confirm `git diff --name-only master effort/2026-08-04-value-summary-tick` is
empty at their own start (which it is, right now) before beginning Step 2.

**Verdict: clean. Proceeding.**

## Worktree set

| Repo | Worktree path | Branch | Type | Starting commit |
|---|---|---|---|---|
| Claude-Code-Agent-Monitor | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor` | `effort/2026-08-04-value-summary-tick` | **existing branch, reused** (base `master`) | `b155f830c79698349952d2c88ea9f60bedaaf66d` |

- Base branch: `master`.
- Created via: `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor
  worktree add
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor
  effort/2026-08-04-value-summary-tick` — no `-b`, since the branch already
  existed (per the task input) and was verified at `b155f83`/clean before
  reuse, not recreated.
- Verified clean immediately after creation (see Safety gate above).
- No other repos exist under this project (confirmed by `PROJECT-CONTEXT.md`
  and by `find <root> -maxdepth 2 -name .git` finding only the top-level
  `.git`), so there are no "untouched repos" needing a base-HEAD-only
  worktree.
- Efforts convention: the shared sibling directory
  `/Users/sara/CODE-LOCAL/SARA/efforts/<slug>/<repo-name>`, matching the
  convention this project's prior triage passes established and used (e.g.
  `2026-08-02-trunk-drift-detection`, `2026-08-03-trunk-drift-open-branch-blindness`,
  both still present as sibling worktrees, unaffected by this provisioning).

## Surfaces touched

**Schema / data (server):** `server/db.js` — two new additive
`CREATE TABLE IF NOT EXISTS` (`value_summary_sweep_state`,
`value_summary_generation_log`) + indexes + 3 new prepared statements. No
`ALTER TABLE`, no rebuild — **§9.5 FRESH-DB-BLIND SCHEMA CHANGE and §9.6
NON-ATOMIC REBUILD are inapplicable by construction**, and the plan requires
this to be proven, not merely asserted (`git diff master -- server/db.js |
grep -i "ALTER TABLE"` must return nothing — technical-plan step 18, DoD row,
test-plan "How to run").

**Synthesis composer + request path:** `server/lib/value-summary.js`
(`enrichPoolAltitudes` return shape widened to `{ altitudes, states }`, new
`ALTITUDE_STATES` export), `server/routes/project-plans.js` (forwards
`states`, no other route behavior change).

**Background tick (net-new):** `server/lib/value-summary-tick.js`,
registered in `server/index.js`'s `startBackgroundServices()`;
`server/lib/value-ledger.js`'s `CONSUMERS` gains the new file.

**Client (types + placeholder states only, no live subscriber):**
`client/src/lib/types.ts`, `client/src/lib/api.ts`,
`client/src/components/PlanLedgerPanel.tsx`, four `projectDetail.json`
locales.

**Tests / guards:** `server/__tests__/value-summary.test.js` (updated),
`server/__tests__/value-summary-tick.test.js` (new),
`server/__tests__/single-writer-guard.test.js`,
`server/__tests__/ledger-metrics-parity.test.js`,
`server/__tests__/chronology-ordering.test.js`,
`client/src/components/__tests__/PlanLedgerPanel.test.tsx`.

**Docs:** `ARCHITECTURE.md` (+ whatever `update-project-docs` resolves) — new
tick in background-services list, two new tables, three new env vars, the
`states` field on the route response.

### Project-specific risk surfaces to flag (from `PROJECT-CONTEXT.md`'s defect catalog)

- **§9.1 DERIVED-DUAL-VIEW (write-sequence form, 6th recorded touch on this
  project, live and enforceable).** This build creates the **second**
  production invoker of `enrichPoolAltitudes` (route + new tick) while
  requiring the invariant of exactly **one** lexical
  `upsertValueUnitSummary.run(` call site. This is the exact "consumer #2
  appears" moment the catalog says the pattern historically bites. The plan's
  cure is DEC-10 (extend the return shape, don't add a second entry point)
  plus a mandatory, red-proven-by-injection guard in
  `single-writer-guard.test.js` (technical-plan step 9, test-plan L2/step 13).
  **MANDATORY**, not optional: the guard must be observed red under an
  injected rogue call site before being trusted green.
- **§9.8 OVERLOADED-ABSENCE** — this build is named in the catalog as the
  cure for the pattern's first instance. The `queued`/`unavailable` split
  replaces an overloaded absence with a discriminated wire state; test-plan G1
  is its direct coverage.
- **§9.3 VACUOUS-GUARD, standing rule.** Every new/extended structural guard
  in this build (single-writer guard ×2, both `assertSingleHome` blocks, the
  tick's overlap guard, the DEC-16 structural scan, the `chronology-ordering`
  / `ledger-metrics-parity` registry entries, the T-C `pending_after_sweep`
  instrument, the i18n registry→locale check) **must be observed red by a
  real mutation, then restored, before being counted done** — not read, not
  merely passed. `test-plan.md`'s Definition of Done has a dedicated
  "Red-before-green evidence" checklist for exactly this; treat it as binding.
  Per the catalog's 2026-08-03 AGENT-SELF-REPORTED-RED sub-pattern, a red
  observation reported by the implementing agent is **unverified** until
  re-run or read by someone else (i.e., surfaced for review, not just
  self-certified in the build report).
- **§9.2 row-id-as-chronology-proxy.** `listValueSweepTargets`'s rotation
  query orders by `last_swept_at` (a real timestamp), not row id — already
  compliant per the technical plan, but `test-plan.md` Case 3's mutation proof
  (`ORDER BY p.id ASC`/`DESC` must both fail the exact expected array) is the
  check that this stays true in the shipped code, not just the plan.
- **§9.4 FIX-ROUND-REGRESSION.** If any blocker/should-fix round happens
  during this build, it gets its own adversarial review pass over the fix
  diff — not a re-run of the suite that was already green — per the catalog's
  standing acceptance criterion.

## Durable-cure obligations (MANDATORY)

1. **Single-writer invariant on `value_unit_summaries`** — exactly one
   lexical `upsertValueUnitSummary.run(` call site, lexically inside
   `enrichPoolAltitudes`, red-proven by injecting a rogue second call site in
   the route and observing the specific failure. (§9.1 DERIVED-DUAL-VIEW cure;
   technical-plan step 9, test-plan step 13.)
2. **Single-writer invariant on `insertValueSummaryGeneration`** — exactly one
   production call site (`db.js`, `value-summary-tick.js`), same red-proof
   discipline. (Same pattern, same step.)
3. **Pool-membership single source of truth** — the tick calls
   `value-ledger.js`'s `assembleValuePool` and only it; both `CONSUMERS` and
   `ledger-metrics-parity.test.js` C2.4 must name the new file in the **same
   change**, with C2.4 observed red before the entry lands (DEC-7,
   technical-plan step 6, test-plan step 12). A structural scan
   (test-plan Case 8) asserts the tick contains no `FROM project_paths` /
   `FROM detour_dispositions` / `detectTrunkDrift` of its own.
4. **`chronology-ordering.test.js`'s `FILE_DISPOSITIONS` registry** must be
   observed to fail on the new undispositioned file **first**, then get its
   entry — never added blind (DEC-9, technical-plan step 8, test-plan step 3).
5. **The audit-log partition assertion is the four-term form**
   (`cache_hits + generated + queued + unavailable === pool_size`) at every
   occurrence, with **no `<=` variant and no three-term variant anywhere** —
   test-plan §0 C1 corrects this from the supporting docs and the DoD requires
   a grep sweep proving it.
6. **`ALTITUDE_STATES` → i18n key chain is registry-derived, not hand-typed**
   — the new server-side registry→locale test derives its scope from the
   `ALTITUDE_STATES` export, and `i18n.test.ts` E1.1 propagates the obligation
   to all four locales mechanically (§9.7 HAND-SCOPED STRUCTURAL SCAN's own
   documented cure).
7. **The trap-coverage reconciliation table in `test-plan.md`** (T-A…T-E) must
   end this build with zero unresolved rows — every trap terminates in a named
   `file :: case` or a dated `qa/decisions.md` row, per QA-DEC-4's own
   standing-rule proposal (itself the cure for a pattern that has now
   recurred three times in the QA pipeline's own documents, per
   `PROJECT-CONTEXT.md`'s 2026-08-04 QA-pass note under §9.1).

## Back-out command(s)

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-value-summary-tick/Claude-Code-Agent-Monitor reset --hard b155f830c79698349952d2c88ea9f60bedaaf66d
```

This is a no-op today (the worktree is already at that commit) and becomes
the full back-out once the build has made commits on the branch. It does not
touch `master` or the main checkout.

## Open questions

**BLOCKING:** none.

**Non-blocking (assumption stated):**

1. **OPEN-1 (branch/commit sequencing) is already resolved** by the state
   handed to this triage pass: the ~991-line altitude layer is committed on
   `master` at `b155f83`, and `effort/2026-08-04-value-summary-tick` is
   already cut from it. Assumption: no further action needed on this axis;
   the implementer proceeds straight to `technical-plan.md` step 2.
2. **OPEN-3 (v1 ships the broadcast with no client subscriber — Sara,
   PENDING)** and **OPEN-4 (coverage-latency must be measured against the
   real fleet before sign-off — PENDING, technical-plan step 15)** are both
   live, unresolved decision rows in `decisions.md`. Neither blocks starting
   the build — both have stated fallbacks/next actions in the plan itself
   (OPEN-3: ship as-is, flag at sign-off; OPEN-4: measure at step 15, retune
   env vars if the worst case exceeds ~2h). Assumption: proceed with the plan
   as written; do not treat either as a build-time blocker.
3. **Docker / effort-registry non-provisioning** are project-level "not
   configured" calls, consistent with every prior triage pass on this repo,
   not a fresh judgment call unique to this effort.
4. **`AGENT-PLAN.md` / `.claude/agent-plan-backups/`** dirty/untracked state
   in the main checkout is unrelated pre-existing noise (per the task input)
   and was not touched, stashed, or lost by this provisioning — it simply
   does not exist in the fresh worktree. Flagging for whoever next works in
   the main checkout, not a concern for this build.
