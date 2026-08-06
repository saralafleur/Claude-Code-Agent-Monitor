# Build Report — Value Pool Slice 3: Auto-group proposal engine (`2026-08-06-auto-group-proposal`)

> Authored by `build-lead` (Step 7), synthesizing the build brief, task list,
> red evidence, two verifier passes, and one adversarial review. The document
> the user reads. This build **stopped at green** — it did not commit, push, or
> open a PR.

**Date:** 2026-08-06
**Mode:** `auto direct` — auto-pilot + direct, **NOT fast**. A real test plan
existed (`qa/test-plan.md`, 838 lines, ~40 specs) and the full test-plan gate
applied. No QA debt is being deferred by mode.

---

## What was built

The Value Pool panel can now propose groupings of unclaimed value units on
demand. Three new SQLite tables (`value_group_runs`, `value_groups`,
`value_group_members`) persist a grouping run and its results; a new
`server/lib/value-groups.js` (935 lines) does mechanical pre-grouping over
shared signals, an LLM refinement pass over the resulting clusters, and a
hierarchical rollup that merges leaf clusters by name; four new routes on
`server/routes/project-plans.js` (`POST /:projectId/groups/propose`,
`GET /:projectId/groups`, `POST /:projectId/groups/:groupId/approve`,
`POST /:projectId/groups/:groupId/dismiss`) expose it, gated behind the same
coverage-completeness check Slice 2 introduced; and `PlanLedgerPanel.tsx` gains
an "Auto-group" control plus a proposed-groups list rendering each group's
server-computed member-availability partition (`available` /
`already_claimed` / `no_longer_in_pool`), across four locales. Approve and
dismiss are pure bookkeeping — nothing in this slice ever claims a unit.
Alongside the feature, the PM-mandated **SF-4 durable cure** landed: the
`coverageSnapshot` composition that had been hand-duplicated across route
handlers is extracted into a new `server/lib/value-coverage-probe.js` with a
single definition and a structurally-derived call-site guard, and the old
regex-based T7 guard it obsoleted was deleted in full with a named successor
for each of its five claims.

## Change verdict

**Verdict:** **GREEN** — reached the long way.

`build-verifier`'s round-2 pass returned **GREEN-WITH-CAVEATS**, with exactly
two named conditions for a clean GREEN: (1) disposition BL-5's partial closure
as a dated `decisions.md` row, and (2) optionally fix one residual vacuous
assertion in `PlanLedgerPanel.groups.test.tsx` C-5. **Both were done** —
`DEC-S3-FIX3-VERIFY` was added to `decisions.md`, and the C-5 assertion was
corrected to `getByText(...)` / `expect(x).not.toBeNull()` per BL-9's own
already-decided fix pattern — and the result was independently re-verified by
the orchestrating session as the last action before this report:

- `npm run test:server` (isolated `DASHBOARD_DB_PATH`): **1858/1858 pass, 0 fail**
- `npm run test:client`: **831/831 pass, 0 fail**
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: **exit 0**
- Production DB `~/.claude/agent-dashboard/dashboard.db`: **0 rows** in all
  three new `value_group*` tables, confirmed after the full suite run

**Durable cure:** **APPLIED** (all mandated ones), plus one knowingly narrowed:

| Catalog id | Obligation | Status |
|---|---|---|
| **§9.1 DERIVED-DUAL-VIEW** (SF-4 extraction, DEC-S3-2/PM-2) | `buildProbeCoverage` extracted to one definition in `server/lib/value-coverage-probe.js`; T7 deleted in full, five claims each with a named successor (T7-C4 route↔route parity deliberately not replaced per DEC-S3-4) | **Applied** — recorded in `PROJECT-CONTEXT.md` §9.1's BUILD OUTCOME note |
| **§9.1** (2nd exposure, PM-4) | `GROUPING_UNCOMPARED_FIELD_GUARANTORS` key-walk in the anchored exactly-this-exempt-set form (`deepEqual(Object.keys(...), [])`) plus R-9b's structural scan of `buildGroupingPrompt`'s own source | **Applied** (landed via BL-8's fix) |
| **§9.7 HAND-SCOPED STRUCTURAL SCAN** | `assertConsumerScopeDerived(modulePath)` built generically in `server/__tests__/helpers/single-home.js`, fail-closed (throws, never `continue`), wired to all four registration points; red-proven by injecting an undisposed importer | **Applied** — the cure this entry had recommended half-built since occurrence 6 |
| **§9.8 OVERLOADED-ABSENCE** | Three-table schema (run state has a home; zero-clusters ≠ never-attempted), `GROUP_RUN_STATES` truth table, boot-time interrupted-run reconciliation | **Applied** |
| **§9.8** (BL-5's second face) | Per-group failure discriminator (`llm_unavailable` vs `llm_output_unusable` on an individual group inside an otherwise-`completed` run) | **DEFERRED** — `DEC-S3-FIX3-VERIFY`, with a named gate: close before any UI surfaces per-group failure reasons individually |

## The loop-back history (this is a finding, not an aside)

This build took **three implementer rounds, two verifier rounds, and one
adversarial review** to reach green. The sequence is worth reading as data:

| Pass | Outcome |
|---|---|
| `build-triage` (1st) | **BLOCKED** — dirty base branch (an uncommitted 200-line `PROJECT-CONTEXT.md` intake note on `master`, with a concurrent `claude` session live in the same cwd). Correctly refused to provision a worktree. |
| `build-triage` (retry) | **READY** — the note was committed as `d384249`; `master` clean; worktree provisioned. |
| `build-planner` → `build-test-author` | 8 test files, 80 cases, **all observed RED** before any product code. |
| `build-implementer` (round 1) | Feature built. Also **found and flagged, without fixing, a materially large number of pre-authored test-file defects** (missing `await`s, a `unitKey` format mismatch, a nonexistent prepared statement in a shared seed helper, missing DB-path isolation, unreachable boot-hook triggers, a malformed `vi.mock`). Refusing to adjust broken tests until they pass is the correct behavior under §9.3 and cost the loop-backs below. |
| `build-verifier` (round 1) | **BLOCKED** — P-7, the single most important guard in the build (sole successor to T7-C5), was itself a **VACUOUS-GUARD**; the §9.8 truth table and the E2E lifecycle block had **zero** passing coverage. |
| `build-implementer` (fix rounds 1 & 2) | Test-file-only repairs. Suite reached green: 1865 server / 830 client. |
| `build-verifier` (round 1 re-run) | **GREEN** on the numbers. |
| `build-reviewer` | **FIX BLOCKERS FIRST — 17 blockers, 13 should-fix, 8 nits**, against a suite two prior passes had certified green. Four were **live product defects reproduced with probes** (BL-1 client crash, BL-2 `rollupGroups` positional corruption, BL-3 tests writing the production DB, BL-13 propose route awaiting the whole LLM pipeline). Twelve were `[M]`-MANDATORY guards that could not fail. |
| `build-implementer` (fix round 3) | Real product-code + test fixes across all 17, plus `DEC-S3-FIX3` dispositioning every should-fix and nit with a named consequence. |
| `build-verifier` (round 2) | **GREEN-WITH-CAVEATS** — re-checked all 17 by reading the code, not by trusting the re-run. 16/17 fully closed; BL-5 closed for its severe half only; one new residual vacuous assertion found (C-5). |
| Orchestrating session | Applied `DEC-S3-FIX3-VERIFY` + the C-5 fix directly, re-verified: **1858/1858 server, 831/831 client, headers exit 0, production DB clean.** |

**The headcount argument is now four-for-four on this file family.** Every gate
found something the previous gate's self-report had missed:

- The reviewer found 17 blockers on a build the verifier had already called
  green — the third consecutive effort on this surface where that happened, and
  the reason `PROJECT-CONTEXT.md` §9.3's standing recommendation ("do not trim
  `build-reviewer` on this file family") exists. It held again.
- **BL-3 is a textbook §9.4 FIX-ROUND-REGRESSION:** the DB-isolation class was
  *reported cured* in fix round 1 and was only actually cured in the two files
  the verifier happened to check. Two other files still carried it, and the
  suite was green throughout. The real root cause — a module-scope
  `require("../db")` singleton in `server/lib/value-groups.js` — was not found
  until fix round 3, and removing it is what actually closed the class.
- **The §9.3 count is the headline:** one diff produced **nine separate
  VACUOUS-GUARD instances** (BL-4, BL-6, BL-7, BL-8, BL-10, BL-11, BL-15,
  BL-16, BL-17 — twelve counting the should-fix items), beating this project's
  own prior record of nine set one day earlier. Every one was `[M]`-marked or
  plan-mandated. Being warned about this entry still does not reduce its
  incidence; the gate count is what catches it.

Three defect-catalog entries were updated with these occurrences — see
"Memory updated" below.

## Red → green evidence

**Authoring pass (`supporting/red-evidence.md`) — 8 files, 80 cases, all RED
before any product code existed:**

| Test file | Spec ids | Cases | RED before (observed) | GREEN after |
|---|---|---|---|---|
| `server/__tests__/db-migration.test.js` | S-1…S-4 | 4 | 3 fail (`PRAGMA table_info` undefined — tables absent); S-3 passes by design (asserts *absence* of migration cases) | ✅ 39/39 (file) |
| `server/__tests__/value-coverage-probe.test.js` | P-1…P-8 | 8 | all 8 `Cannot find module '../lib/value-coverage-probe'` | ✅ 8/8 |
| `server/__tests__/value-groups-mechanical.test.js` | M-1…M-9 | 9 | all 9 `Cannot find module '../lib/value-groups'` | ✅ 9/9 |
| `server/__tests__/value-groups-refinement.test.js` | R-1…R-13, D-1…D-4, E-5 | 18 | 16 fail (module not found) | ✅ 19/19 |
| `server/__tests__/value-groups-interrupted-boot.test.js` | E-5.1…E-5.4 | 4 | 1 fail (boot hook absent) | ✅ 4/4 |
| `server/__tests__/value-groups-api.test.js` | TT-a…TT-i, TT-read, N-1…N-4, E-1…E-6, RT-1…RT-3 | 27 | 1 structural fail (routes absent) | ✅ 20/20 |
| `server/__tests__/single-writer-guard.test.js` | G-1, G-2, G-4 | 3 | 2 fail (`buildProbeCoverage` not found; call-site count 0 ≠ 3) | ✅ 23/23 |
| `client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx` | C-1…C-8 + registry + snapshot | 10 | RED (component surface absent) | ✅ (in 831/831) |

Red-proof methods recorded, not asserted: 32 missing-module, 3 missing-table,
2 missing-function, 2 assertion-mismatch, 1 verified-inapplicability.
**Caveat, and it is why the review mattered:** 39 of the 80 cases were authored
as explicit `assert.ok(true, "...")` body stubs pending the route surface. Those
stubs are the ancestor of most of the §9.3 blockers the reviewer later found —
a red-evidence log can be honest about *why* a case is red and still be
counting a case that asserts nothing.

**Fix-round-3 tests — authored against a real, reproduced defect, and each is
the guard that would have caught it:**

| Test | Layer | Guards | RED before |
|---|---|---|---|
| `value-groups-api.test.js` **E-4.1…E-4.4** | integration | BL-2 `rollupGroups` positional corruption — 45-unit, 3-day, 2-batch pool with an order-independent rollup stub merging 2 of 3 leaf groups; asserts exactly 2 persisted groups (never 3 = no merge, never 1 = over-merge) with exact member unions | ✅ reproduced BL-2's own review fixture |
| `value-groups-api.test.js` **TT-c** | integration | BL-5 digest poisoning — drives a real all-heuristic pass to `failed` by BL-5's own mechanism (not a manual `UPDATE`), then asserts the next propose genuinely `started` with spawn delta 1 | ✅ |
| `PlanLedgerPanel.groups.test.tsx` **BL-1 [M]** | component | BL-1 client crash — actually clicks `data-test="auto-group-button"` against a propose mock that deliberately omits `groups` (the real server contract) and asserts enriched content renders | ✅ |
| `value-groups-refinement.test.js` **R-9b** | unit/structural | BL-8 — regex-extracts `buildGroupingPrompt`'s source, pins its parameter list, asserts every `f.<field>` access is a real `groupingFacts()` key and the body never touches `unit.`/`unitsByKey` | ✅ |
| `db-migration.test.js` **S-2** | unit/structural | BL-6 — parses the literal value list out of each real `CHECK(<col> IN (...))` clause and `deepEqual`s against the imported registry (previously a "verified elsewhere" comment) | ✅ |
| `single-writer-guard.test.js` **G-2** | structural | BL-14 — brace-walks all four coverage-composing handler bodies and asserts zero `enrichPoolAltitudes(`/`coverageSnapshot(` inside each, closing the inline-hand-copy blind spot the count-based check couldn't see | ✅ |

Full per-blocker re-verification lives in
`supporting/verifier-findings-round2.md` — it reads the shipped code directly
rather than trusting the green re-run, per §9.4.

**Suite movement:** 1787/1787 pre-Slice-3 baseline → 1865 server at review time
→ **1858 server / 831 client** final. The server count *dropped* by 7 during fix
round 3 and that is correct: BL-15's fix collapsed the §9.8 truth table from
nine independent `it()`s into **one** `it()` driving a 9-row data table with
exact spawn-delta assertions per row. Fewer, stronger cases.

## Files changed

Nothing is committed. All of the below is working-tree state on
`effort/2026-08-06-auto-group-proposal` over `d384249`.

```
$ git -C <worktree> diff --stat HEAD -- . ':(exclude)requests/'
 ARCHITECTURE.md                                    |  51 ++++
 PROJECT-CONTEXT.md                                 |  44 +++
 README.md                                          |  11 +
 client/src/components/PlanLedgerPanel.tsx          | 297 +++++++++++++++++++
 client/src/i18n/locales/en/projectDetail.json      |  45 +++
 client/src/i18n/locales/ko/projectDetail.json      |  45 +++
 client/src/i18n/locales/vi/projectDetail.json      |  45 +++
 client/src/i18n/locales/zh/projectDetail.json      |  45 +++
 client/src/lib/api.ts                              |  53 ++++
 client/src/lib/types.ts                            |  84 ++++++
 .../__snapshots__/screens.snapshot.test.tsx.snap   |  25 ++
 server/__tests__/chronology-ordering.test.js       |   2 +
 server/__tests__/db-migration.test.js              | 245 ++++++++++++++++
 server/__tests__/helpers/single-home.js            | 109 ++++++-
 server/__tests__/ledger-metrics-parity.test.js     |  11 +-
 server/__tests__/project-plans-api.test.js         | 108 +------
 server/__tests__/single-writer-guard.test.js       | 321 ++++++++++++++++++++-
 server/db.js                                       | 139 +++++++++
 server/index.js                                    |  17 ++
 server/lib/focus-summary.js                        |   6 +
 server/lib/value-ledger.js                         |   9 +-
 server/routes/project-plans.js                     | 213 ++++++++++++--
 22 files changed, 1791 insertions(+), 134 deletions(-)
```

New (untracked) files, with line counts:

```
server/lib/value-groups.js                                      935
server/lib/value-coverage-probe.js                               72
server/__tests__/value-groups-api.test.js                      1080
server/__tests__/value-groups-refinement.test.js                547
server/__tests__/value-groups-mechanical.test.js                305
server/__tests__/value-coverage-probe.test.js                   258
server/__tests__/value-groups-interrupted-boot.test.js          167
client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx  548
```

Plus this intake's own artifacts under
`requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/`
(`decisions.md`, `technical-plan.md`, `qa/change-brief.md` modified; the whole
`build/2026-08-06-auto-group-proposal/` folder new).

Note `server/__tests__/project-plans-api.test.js` is net **−108 lines** — that
is T7's full deletion (WATCH-S3-D / DEC-S3-3), with a single explanatory comment
left in place. T3/T4/T6 are byte-identical to `master`, grep-confirmed.

## Standing guards + Definition of Done

- [x] **Each new test observed RED before, GREEN after** — 80 authoring-pass
      cases with a recorded per-case red reason; fix-round-3 guards each
      red-proven against the live defect they name.
- [x] **Full relevant suites green** — server 1858/1858 (isolated
      `DASHBOARD_DB_PATH`), client 831/831. Every new/edited Slice-3 file also
      re-run individually with its own isolated DB path and green.
- [x] **§9.1 DERIVED-DUAL-VIEW** — SF-4 extraction landed, single definition,
      derived call-site guard; T7's five claims each have a named successor
      (T7-C4 deliberately unreplaced per DEC-S3-4, which is *visible* rather
      than indistinguishable from an oversight); no forbidden route↔route
      `deepEqual` parity guard anywhere (grep-confirmed 0 hits);
      `value-coverage-parity.test.js` byte-identical to `master` and green.
- [x] **§9.3 VACUOUS-GUARD sweep** — `assert.ok(true` across
      `server/__tests__/` returns **1** hit, and it is the pre-existing,
      already-disclosed `value-summary-interrupted-boot.test.js:133`. All three
      Slice-3 hits are gone.
- [x] **§9.7 registry hygiene** — `CONSUMERS` at 4 entries with its growth-rule
      comment widened in the same change (the rule that DEC-S3-10's own
      registration would otherwise have falsified); both `assertSingleHome`
      consumer maps updated; `ledger-metrics-parity.test.js` C2.4 anchor
      updated; `chronology-ordering.test.js` dispositions added for both new
      lib files; `assertConsumerScopeDerived` wired at all 4 registration
      points, fail-closed.
- [x] **§9.8** — truth table shipped as one data-driven `it()` with exact spawn
      deltas per row; interrupted-run boot reconciliation proven behaviorally.
- [x] **Negative proof N-1…N-4** — all four real and red-proven; N-3 now
      matches this codebase's real argument-form write shape, not just the
      assignment form it was blind to.
- [x] **File-header audit** — `check-headers.sh` exit 0.
- [x] **Production DB untouched** — 0 rows in all three new tables, confirmed
      before and after every run in the final pass.
- [x] **Docs** — `README.md` documents the 4 new endpoints, `ARCHITECTURE.md`
      updated, `PROJECT-CONTEXT.md` carries the SF-4 build-outcome note.
- [x] **AC-1…AC-7** — each spot-checked against its named proof and confirmed
      non-vacuous by the round-2 verifier.
- [ ] **BL-5's per-group failure discriminator** — not built. Dispositioned as
      `DEC-S3-FIX3-VERIFY` with a named gate. See residual risk.
- [ ] **OpenAPI documentation for the 4 new routes** — not written.
      Pre-recorded as **BO-7** at intake (matching Slice 1's own precedent for
      `/altitudes/seen`), documentation-drift risk only.
- [ ] **Commit-per-logical-unit history** — `build-task-list.md` mandated "ONE
      COMMIT" for Tasks 2 and 3 to avoid guard-gap windows in history. The
      entire diff is still one uncommitted working tree. Not a correctness
      defect (every file is internally consistent and green) but the history
      shape the plan asked for does not exist yet. **This is the ship step's
      call to make.**

## Worktree & stack

- **Worktree:**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor`
- **Branch:** `effort/2026-08-06-auto-group-proposal`
- **Starting commit:** `d3842493bb6902181cc4991c855bda25ffa6cf7d`
  ("docs(intake): record Value Pool Slice 3 intake and QA pass")
- **Docker stack:** none. Confirmed again this slice — the repo's compose files
  are a single-container production wrapper and an opt-in Prometheus/Grafana
  observability stack, not a per-effort dev stack, and neither plan invokes
  compose. Verification ran directly in the worktree.
- **Live poke-around:** `npm run dev` inside the worktree.

## Shipped commit

**Not yet committed — stopped at green.** `git log master..HEAD` is empty.

## Residual risk & back-out

**Watch:**

1. **`PROJECT-CONTEXT.md` is being edited in two trees at once — this is the
   most likely thing to bite at merge.** This build modified the worktree's
   copy (+44 lines: the §9.1 SF-4 build-outcome note, plus this report's
   catalog updates). Meanwhile the **main checkout has its own uncommitted
   65-line addition to the same file** from a *different, concurrent* intake
   (`requests/2026-08-06-session-stakeholder-summary/`), touching §9.1 and
   §9.8 — the exact sections this build also touched. The main checkout is
   also carrying an uncommitted modification to this effort's own
   `build/.../build-brief.md` (the READY retry brief, which supersedes the
   committed BLOCKED one) and an untracked `run-plan.md`. **Reconcile
   `PROJECT-CONTEXT.md` deliberately at merge — do not let either side win by
   accident.** This project's own memory flags concurrent sessions in this cwd
   as having caused real work loss before; the first triage pass BLOCKED on
   exactly this hazard and was right to.
2. **BL-5's per-group failure discriminator (`DEC-S3-FIX3-VERIFY`).** A
   mixed-outcome run — some groups refined, others failed for genuinely
   different reasons (LLM timeout on one batch, unparsable JSON on another) —
   reports all failed groups identically. No live UI consequence today (no
   consumer reads a per-group reason; it renders as one undifferentiated
   "Refinement failed" chip either way). **Named gate: close this before any
   UI surfaces per-group failure reasons individually.** The severe half —
   permanent digest-cache poisoning after an LLM outage — is genuinely fixed
   and proven by TT-c.
3. **13 should-fix items and 8 nits, each deferred with a named consequence.**
   Do not re-derive these — the full per-item table is `decisions.md`
   **`DEC-S3-FIX3`**. The two worth knowing before merge: **SF-2** (approve/
   dismiss never verify the group belongs to `:projectId` — an authorization
   gap, blast radius limited to pure bookkeeping) and **SF-7** (`rationale`
   optional in the parser but required by `insertValueGroupRow`'s R-7
   biconditional — a real model response omitting it would persist a `refined`
   row violating that invariant in production). One should-fix was *not*
   deferred: `notSelected`'s per-cluster arithmetic shared BL-2's exact root
   cause and was fixed in the same change.
4. **Two guards remain hand-scoped one layer out** (SF-12): the §9.7 cure
   helper's own `defaultScanTargets` hard-codes `server/lib`, `server/routes`,
   `bin`, `server/index.js` — `mcp/src`, `scripts/`, `desktop/` are unscanned.
   A future consumer added there registers nowhere and nothing notices.
5. **No group-level WebSocket broadcast (WATCH-S3-E)** and **approve returns no
   freshness snapshot (WATCH-S3-F)** — both deliberate, both with fire-on
   triggers recorded.

**Back-out (single repo):**

```bash
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor \
  reset --hard d3842493bb6902181cc4991c855bda25ffa6cf7d
```

⚠️ Because nothing was committed, `reset --hard` alone reverts only the 22
modified tracked files. The 8 new product/test files are **untracked** and
survive it. A genuinely complete back-out is:

```bash
git -C <worktree> reset --hard d3842493bb6902181cc4991c855bda25ffa6cf7d && \
git -C <worktree> clean -fd
```

`clean -fd` also deletes this build's own artifacts under
`requests/.../build/2026-08-06-auto-group-proposal/` (including this report) —
copy them out first if you want the record.

## Open decisions

| Id | Status | What it needs |
|---|---|---|
| **DEC-S3-FIX3** | DECIDED-AUTO (deferred, 13 should-fix + 8 nits, each with a consequence) | No action to merge. Sara may override any row. |
| **DEC-S3-FIX3-VERIFY** | DECIDED-AUTO (BL-5 per-group discriminator deferred) | No action to merge; gated on the first UI that surfaces per-group failure reasons. |
| **PENDING 1–6** (`decisions.md`) | PENDING — cheap-to-reverse vetoes for Sara, none blocking | Now *expensive* to reverse for **DEC-S3-8** (`claimed` reserved in the CHECK — a CHECK is rebuild-to-widen) and **DEC-S3-6** (a shipped column + wire state). These were "cheap to reverse before build"; the build has happened. |
| **WATCH-S3-A/B/C/E/F**, **BO-7**, **BO-8**, **OPEN-S2-1** | Open, each with a Fires-on / Lands-in | Carried to Slice 4. |
| **§9.7 SF-12 scan-target widening** | Open, undecided | Whether `mcp/src`/`scripts/`/`desktop/` should be in the consumer scan is a real scope question, not a guess. |

## Next step

**Stops at green. The user commits / pushes / opens a PR — or hands it back for
changes.** This skill does not commit.

Two things to decide at that moment, both flagged above rather than assumed:

1. Whether to reconstruct the plan's mandated commit-per-logical-unit structure
   or land the diff as one commit.
2. How to reconcile `PROJECT-CONTEXT.md` against the concurrent session's
   uncommitted edits in the main checkout.

**This does not tear down the worktree or any stack.** The worktree at
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor`
and the branch `effort/2026-08-06-auto-group-proposal` stay live until whoever
merges runs `git worktree remove` manually. Nothing is cleaned up automatically.

## Memory updated

- **Build run-log:** row appended to
  `~/.claude/skills/team-build/memory/build-run-log.md` (this project names no
  project-specific log in `PROJECT-CONTEXT.md`, and this is the log its prior
  builds have used).
- **Defect catalog** (`PROJECT-CONTEXT.md`, worktree copy), four dated notes:
  - **§9.3 VACUOUS-GUARD** — nine instances in one diff, breaking the
    2026-08-05 record of nine set one day earlier; the per-*gate* count and the
    reviewer-after-a-green-verifier pattern now three-for-three.
  - **§9.4 FIX-ROUND-REGRESSION** — BL-3, a fix reported cured that was only
    cured in the files the verifier happened to check.
  - **§9.1 DERIVED-DUAL-VIEW** — BL-2 and BL-9 as concrete occurrences 8 and 9.
  - **§9.7 HAND-SCOPED STRUCTURAL SCAN** — BL-14, three guards with three
    different blind spots; and the generic cure finally built.
