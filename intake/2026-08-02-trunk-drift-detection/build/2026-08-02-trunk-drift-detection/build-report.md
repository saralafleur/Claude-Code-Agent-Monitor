# Build Report — 2026-08-02-trunk-drift-detection (Phase 1a)

> Authored by `build-lead`, synthesizing the build brief, task list, red/green
> evidence, and the three adversarial-review fix rounds recorded in
> `supporting/green-evidence.md`. The document the user reads. This build
> **stopped at green** — it did not commit, push, or open a PR.

**Slug:** `2026-08-02-trunk-drift-detection`
**Date:** 2026-08-02
**Scope built:** Phase 1a only (`technical-plan.md` §4 Steps 1–7). Phase 1b not
started — see "Phase 1b gate" below.

---

## What was built

The dashboard can now tell you, live and read-only, which commits landed
straight on a repo's trunk instead of going through the tracked
worktree/focus flow — the failure mode that has silently eaten at least three
capability drops on this repo and until today was only findable by a human
running a manual sweep. A new detector, `server/lib/trunk-drift.js`, resolves
the repo's real default branch through a newly extracted shared helper
(`server/lib/git-refs.js`, lifted out of `update-check.js`'s ref-resolution
primitives and given a new remote-optional `resolveDefaultBranch`), then runs
one bounded, git-native `--first-parent --no-merges --not --exclude=<trunk>
--branches` walk to find commits that are on trunk's first-parent line, are
not merges, and are not reachable from any other local branch. It reads no
SQLite, writes nothing, and caches nothing — the same posture as
`repo-topology.js`. Results surface on a new `GET /api/projects/:id/trunk-drift`
route (with a per-repo try/catch fan-out and a 25-repo budget, so one broken
repo can't suppress another's result) and on a new, purely read-only
"Direct-to-trunk work" card on Project Detail, fully translated across all
four locales. Alongside it, `server/lib/reconciliation.js` gained four
logging-only lines (DEC-4's carve-out, widened by QA) so that when Sara runs
DEC-7's live trial she can finally tell "Claude CLI not available" apart from
"Claude CLI returned no output" instead of staring at one undifferentiated
silence. No schema change, no `detour_dispositions` write, no classification
vocabulary, no layer-7 UI.

## Change verdict

**Verdict:** **GREEN** (unqualified — the verifier's closing pass explicitly
states "no new caveats found in this closing pass; no caveats carry over from
prior passes").

**Durable cure:** **applied** — **§9.7 HAND-SCOPED STRUCTURAL SCAN**. This
entry has been flagged five times across this project and its recommended cure
had never been built. It is built now:
`server/__tests__/helpers/single-home.js` exports `assertSingleHome`, which
derives its scope from `Object.keys(require(<sharedModule>))` — never a
hand-typed name list — computes each consumer's *own* relative import
specifier from the filesystem, and fails loudly naming any export that has no
explicit `shared` / `private` / `absent` disposition at any listed consumer.
It required two rounds to become genuinely functional (see "How this build
went" below) and is now proven by mutation, twice, with two different injected
export names (implementer's, then a verifier-chosen canary
`verifierRP6ThrowawayCanary`).

**Also applied: §9.3 VACUOUS-GUARD**, five times over — every structural guard
in this change set is now recorded red-by-mutation, not merely green
(RP-1/RP-2 on DEC-5's predicate, RP-6 on `assertSingleHome`, the per-call
paren-bounded `execGit` timeout guard, the ref-anchored behavior-preservation
diff, and the i18n interpolation guard).

## How this build went (3 fix rounds)

Worth reading before the evidence table, because the number of rounds is the
story:

| Round | Trigger | Outcome |
|---|---|---|
| 1 | Verify gate | Suites at 1330/1351 server, 730/731 client. All 21 failures traced to **8 test-authoring bugs**, zero product defects — but one of them (`single-home.js`'s broken path resolution) meant the MANDATORY §9.7 guard had *never once executed its real logic*. Gate failed. |
| 2 | Adversarial review | 4 blockers (BL-1 the 7 remaining test bugs, BL-2 a vacuous `execGit` timeout guard, BL-3 an `assert.ok(true)` placeholder, BL-4 hardcoded lookback strings in all 4 locales) + 8 should-fix. Landed 1352/1352 + 731/731. |
| 3 | Second adversarial review | 2 more blockers (a ref-less `git diff --stat` behavior-preservation check that would go permanently green once staged; an i18n completeness scan with a hand-typed key list missing the newly-added `truncated` key, plus no test that ever varied `days`) + 7 should-fix. Landed **1354/1354 + 751/751**. |

Each round's fixes were independently re-verified by mutation, not read.

## Red → green evidence

Every new test was authored red-first and observed failing for a named,
specific reason before any product code existed (`supporting/red-evidence.md`),
and is green now (`supporting/green-evidence.md`, closing pass).

| Test | Layer | RED before | GREEN after |
|------|-------|-----------|-------------|
| `server/__tests__/git-refs.test.js` §1 — 5 cases (single-home §9.7 guard; `execGit` stays private; fetch call site keeps explicit `timeout: 120_000`; no implicit-timeout `execGit` in `trunk-drift.js`; no Phase-1a fetch caller) | unit / static scan | ✅ `Cannot find module '../lib/git-refs'` | ✅ |
| `server/__tests__/git-refs.test.js` §2 — 6 `resolveDefaultBranch` cases (main / master / nonstandard `trunk` / sole-local-branch / local_ref / ambiguous→`null`) | unit, real git fixtures | ✅ same module-load failure | ✅ |
| `server/__tests__/git-refs.test.js` §3 — behavior preservation (`git diff --stat HEAD -- update-check.test.js` empty) | static | ✅ (was an `assert.ok(true)` placeholder → BL-3; replaced, then ref-anchored in round 3) | ✅ |
| `server/__tests__/trunk-drift.test.js` — 24 cases (1a/1b/1c, 2/2b/2c, 3/3b/3c/3d, 4, 5/5b/5c, 6/6b, 7, 8a–8e + 2 structural checks) | unit, real throwaway git repos | ✅ `Cannot find module '../lib/trunk-drift'` | ✅ 36/36 with git-refs |
| `projects.test.js` R1–R4 (`GET /:id/trunk-drift`: 404 / empty / non-repo filtered / populated drift) | integration (Express, OS-assigned port) | ✅ 404 ≠ 200 — route absent | ✅ |
| `projects.test.js` R5 (G5 — healthy + empty + corrupt repo in one 200; healthy result NOT degraded) | integration | ✅ route absent | ✅ |
| `projects.test.js` R5b (S7 — 26 mapped repos: exactly 25 detected, rest `budget_exceeded`, none dropped) | integration | ✅ added round 3, red before the budget cap existed | ✅ |
| `projects.test.js` R6 (`GET /:id/repos` key set unchanged) | integration | n/a — **green before and after** by design (behavior-preservation gate) | ✅ |
| `reconciliation.test.js` Block A — A1/A2/A3 (`parseDispositionOutput` logging: terminal catch, zero-verdicts-for-non-empty-batch, silent happy path) | unit | ✅ no log calls in source | ✅ |
| `reconciliation.test.js` Block B — B1/B2/B3 (exit 4 `!available`, exit 5 `stdout == null`, exits 1–3 stay silent) | unit | ✅ no log calls in source | ✅ |
| `reconciliation.test.js` "B1 vs B2 distinguishable (captured directly)" | unit | ✅ added round 2 — closes the "two independent regexes could both match one shared sentence" hole in the original B1/B2 design | ✅ |
| `ProjectDetail.test.tsx` case 1 (populated card, no classification/action surface) | component | ✅ `trunkDriftMock` never called | ✅ |
| `ProjectDetail.test.tsx` case 2 (`skipped` renders explicit unknown, never "clean") | component | ✅ `data-testid="trunk-drift-card"` not in DOM | ✅ |
| `ProjectDetail.test.tsx` case 3 (**load-bearing** `expect(unknownText).not.toBe(cleanText)`) | component | ✅ card absent | ✅ |
| `ProjectDetail.test.tsx` case 4 (api error → page still renders) | component | ✅ card absent | ✅ |
| `i18n.test.ts` trunkDrift completeness — registry-derived, 11 keys × 4 locales | i18n | ✅ ko/vi/zh returned raw dotted keys | ✅ |
| `i18n.test.ts` `empty !== unknown` in `en` (client echo of never-guess-clean) | i18n | ✅ keys absent | ✅ |
| `i18n.test.ts` `{{days}}` interpolation guard × 4 locales (BL-4 regression) | i18n | ✅ added round 3; re-proven red by reverting `en` to the literal `"past 7 days"` | ✅ |
| `screens.snapshot.test.tsx` — `trunkDrift` added to the shared api mock | snapshot | n/a — closed a **coverage gap**: the card previously threw `TypeError`, was swallowed by the per-card try/catch, and was never rendered in any snapshot | ✅ 19/19 |

**Mutation proofs (§9.3 — a guard with no recorded red state is not a guard):**

| RP | Mutation | Observed failure | Restored byte-identical |
|---|---|---|---|
| RP-1 | drop `--first-parent` / `--no-merges` | case 3 (no-ff merged feature) returns commits instead of `[]` | ✅ |
| RP-2 | drop the `--not --exclude --branches` tail | cases 3b **and** 3c (worktree flow, G4) return commits instead of `[]` | ✅ |
| RP-6 | inject a 5th `git-refs.js` export | `assertSingleHome` fails *naming it*, and naming which consumer lacks a disposition — reproduced independently by the verifier with a different canary name | ✅ (md5 + `diff`) |
| BL-2 | drop `{ timeout }` from `trunk-drift.js`'s first `execGit` call | per-call, paren-bounded guard goes red — a "timeout" elsewhere in the file can't vacuously satisfy it | ✅ (md5) |
| BLOCKER 1 | edit + `git add` `update-check.test.js` | ref-anchored `git diff --stat HEAD -- …` still catches it; the old ref-less form goes false-negative | ✅ |
| BLOCKER 2 | revert `en`'s `lookbackWindow` to hardcoded `"past 7 days"` | `en` interpolation case red, ko/vi/zh stay green (per-locale isolation confirmed) | ✅ |

## Files changed

One repo touched (`Claude-Code-Agent-Monitor` — self-contained monorepo, no
siblings). Against starting commit `5bed29a`:

```
 ARCHITECTURE.md                                    |   4 +-
 client/src/i18n/__tests__/i18n.test.ts             |  50 +++
 client/src/i18n/locales/en/projectDetail.json      |  13 +
 client/src/i18n/locales/ko/projectDetail.json      |  13 +
 client/src/i18n/locales/vi/projectDetail.json      |  13 +
 client/src/i18n/locales/zh/projectDetail.json      |  13 +
 client/src/lib/api.ts                              |  10 +
 client/src/lib/types.ts                            |  61 +++
 client/src/pages/ProjectDetail.tsx                 | 140 ++++++-
 client/src/pages/__tests__/ProjectDetail.test.tsx  | 142 +++++++
 client/src/pages/__tests__/screens.snapshot.test.tsx |  3 +
 docs/API.md                                        |  49 +++
 docs/DATABASE.md                                   |   2 +
 server/README.md                                   |   1 +
 server/__tests__/projects.test.js                  | 193 +++++++++-
 server/__tests__/reconciliation.test.js            | 424 +++++++++++++++++++++
 server/lib/reconciliation.js                       |  27 +-
 server/lib/update-check.js                         |  27 +-
 server/routes/projects.js                          |  69 +++-
 19 files changed, 1223 insertions(+), 31 deletions(-)
```

Plus 5 new (untracked) files, 1310 lines:

```
 server/lib/git-refs.js                    146
 server/lib/trunk-drift.js                 223
 server/__tests__/git-refs.test.js         256
 server/__tests__/trunk-drift.test.js      549
 server/__tests__/helpers/single-home.js   136
```

Also amended outside the worktree (governance, in the main checkout's intake
tree): `intake/2026-08-02-trunk-drift-detection/decisions.md` — DEC-4's scope
amendment (exits 4 and 5) and WATCH-5's trial note. This was Task 1, a
required non-test gate: without it, editing `reconciliation.js` would have
been outside its authorized carve-out.

## Standing guards + Definition of Done

- [x] **Each new test observed RED before, GREEN after** — red states recorded
      per test in `supporting/red-evidence.md` with the exact failure text;
      green independently re-run by the verifier in the closing pass.
- [x] **Full relevant suites green** — `npm run test:server` **1354/1354, 0
      fail, 0 cancelled**; `npm run test:client` **751/751 (59 files), 0 fail**.
      Both independently re-run by the verifier, matching the implementer's
      report exactly. Suite baseline was 1351 server tests before this build;
      the +3 are net-new tests, with no test deleted to reach the count.
- [x] **Build/typecheck clean** — `npx tsc --noEmit -p tsconfig.json` 0 errors;
      `npm run build` (root, driving `tsc -b && vite build`) succeeds with only
      the pre-existing >500 kB chunk-size advisory.
- [x] **File headers** — `bash .claude/skills/file-headers/scripts/check-headers.sh`
      exits 0 on all 5 new source files.
- [x] **§9.7 HAND-SCOPED STRUCTURAL SCAN** — `assertSingleHome` ships, scope
      derived from the artifact, proven red by RP-6 twice with different
      canaries.
- [x] **§9.3 VACUOUS-GUARD** — every named guard proven red by mutation;
      `grep -rn "assert.ok(true" server/__tests__/` returns 0 hits.
- [x] **§9.2 row-id-as-chronology-proxy** — bounded out by DEC-5; commit order
      is git's own DAG order (`--first-parent`), never `committedAt`.
      `trunk-drift.test.js` case 7 asserts it directly against out-of-order
      `GIT_COMMITTER_DATE` fixtures.
- [x] **DEC-5's three-clause predicate** — all three clauses load-bearing,
      proven by RP-1/RP-2, including G4's worktree-flow case 3c.
- [x] **G5 per-repo failure isolation** — R5's three-repo mixed state; healthy
      repo's result fully populated while corrupt repo returns
      `{ skipped: "git_error" }`; also re-proven at the detector level directly.
- [x] **`skipped` never renders as "clean"** — client case 3's `not.toBe`
      guard, plus the i18n `empty !== unknown` assertion. Round 3 went further:
      skip reasons no longer collapse into one string — `budget_exceeded`,
      `git_error`, `not_a_repo` each got their own copy in all 4 locales.
- [x] **DEC-4 widened logging (G3)** — exit 4 and exit 5 produce textually
      distinguishable log lines, asserted by direct capture-and-diff, not by
      two independent regexes.
- [x] **Behavior preservation** — `update-check.test.js` unedited
      (`git diff --stat HEAD` empty) and 5/5 green; `update-check.js`'s private
      120 s `execGit` and `resolveCompareRefForRemote` byte-unchanged;
      `GET /:id/repos` key set unchanged (R6); `reconciliation.test.js` +
      `reconciliation-full-tick.test.js` pre-existing blocks unedited and green.
- [x] **Docs updated** — `docs/API.md` (new route), `ARCHITECTURE.md`
      (derivation module + recompute-per-request posture), `server/README.md`
      (`DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS`), `docs/DATABASE.md` (the Phase 1b
      `source` enum widening is recorded as *deferred*, not shipped).
- [x] **Snapshot diff eyeballed before regeneration** — CLAUDE.md's
      no-blind-update rule honored; the round-1 gap (card never actually
      rendered in the snapshot suite) was found and closed.
- [x] **No classification vocabulary, no SQLite** in `trunk-drift.js` — grep
      clean for `fold_in` / `new_item` / `deliberate` / `discard`.

**Every Definition-of-Done row from `technical-plan.md` §8 and the build
brief's 8 mandatory durable-cure obligations is MET.**

## Worktree & stack

- **Worktree path (review and commit here — NOT the main checkout):**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor`
- **Branch:** `effort/2026-08-02-trunk-drift-detection` (off `master`)
- **Starting commit:** `5bed29aca2d7a587d75a0d8b427cf76a0d128e7d`
- **Docker stack:** not provisioned. This project's containerized compose files
  describe the production path, a separate optional path from the native
  dev/test loop; every prior triage pass on this repo made the same call, and
  both plans verify exclusively via `npm run test:server` / `npm run test:client`
  against real throwaway git repos and an OS-assigned Express port.

## Shipped commit

- **Claude-Code-Agent-Monitor:** `ef42b65c28b36aa7079adf29ce71c7918d3a7370`
  ("feat(projects): detect unattributed work landed directly on trunk"),
  committed and pushed to `origin/effort/2026-08-02-trunk-drift-detection`
  under auto-pilot's SHIP gate. Pre-commit hooks (Prettier + full
  `test:server`/`test:client`) ran clean. Not merged to `master` — no PR
  opened automatically (this repo's PR convention is thin: exactly one prior
  PR exists, `effort/2026-07-28-wip-queue-page`, which merged and was fully
  reverted two days later per this project's own memory — merge/PR timing is
  left to Sara's judgment call, not auto-decided).

## Residual risk & back-out

**Watch:**

1. **Merge collision with the main checkout and with a sibling effort.** Five
   of this build's files — `server/routes/projects.js`, `client/src/lib/api.ts`,
   `client/src/lib/types.ts`, `client/src/pages/ProjectDetail.tsx`, and the four
   `projectDetail.json` locales — are *also* dirty in the main checkout with
   unrelated in-flight work, and `api.ts` / `types.ts` are also touched by the
   still-active `2026-08-02-practice-kind-override` effort worktree. Both sets
   of edits are additive to different sections, so a clean merge is likely, but
   **this needs a real merge, not a fast rebase.** Flag it explicitly whichever
   effort merges second.
2. **Deferred hand-typed-list hardening (review items S3/S4, out of scope,
   accepted).** The build derived the skip-reason vocabulary from a single
   source across three of its four consumers — `server/lib/trunk-drift.js`
   exports `TRUNK_DRIFT_SKIP_REASONS`, `server/routes/projects.js` composes
   `TRUNK_DRIFT_ROUTE_SKIP_REASONS` on top of it (adding `budget_exceeded`) and
   exports that, and `projects.test.js` imports the route's export rather than
   hand-typing a third copy. The **fourth** consumer,
   `client/src/lib/types.ts`'s `TrunkDriftResult["skipped"]` union, remains a
   by-hand duplicate: a CJS server module cannot be imported across the
   Vite/Node boundary. It is documented in place — the type's own doc comment
   names the canonical source and the DERIVED-DUAL-VIEW convention it follows.
   Consequence if it drifts: a new server-side skip reason renders as an
   unhandled string in the card rather than failing a test. Bounded and
   visible, not silent.
3. **Six minor nits, deferred**, all cosmetic/stylistic and none touching a
   guard, an assertion's strength, or a product behavior.
4. **WATCH-1 (PARKED, shipping knowingly):** a fast-forward-merged *then
   deleted* branch is genuinely indistinguishable from direct-trunk work under
   DEC-5's predicate. Case 3d pins the current behavior; the limitation is
   accepted and recorded, not a defect.
5. **Lookback fixtures vs. real repos.** The `ROOT_COMMIT_DAYS_AGO = 90`
   backdating in `makeWorkingRepo` exists because synthetic fixtures' init
   commits fall inside the lookback window in a way real repos' never do. If
   someone later adds a case with a >90-day span, the root commit re-enters
   scope and that case will look like a detector bug when it is a fixture
   assumption. The comment in the fixture cross-references case 5's own 60-day
   span for exactly this reason.

**Back-out (single touched repo):**

```bash
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor \
  reset --hard 5bed29aca2d7a587d75a0d8b427cf76a0d128e7d
```

Note: the 5 new files are untracked, so `reset --hard` will not remove them —
add `git clean -fd server/lib/git-refs.js server/lib/trunk-drift.js
server/__tests__/git-refs.test.js server/__tests__/trunk-drift.test.js
server/__tests__/helpers/` if a full back-out is wanted.

## Phase 1b gate

**Still blocked. Status unchanged.** `decisions.md` **WATCH-5** remains
**PENDING**: Phase 1b (the `detour_dispositions.source` CHECK-widening rebuild,
`server/lib/db-rebuild.js`, the `detours.js` write adapter, the periodic
`reconcileCwd` tick wiring — `technical-plan.md` §4 Steps 8–16) does not start
until Sara closes DEC-7's live trial by reviewing the pending write-back
failure (`detour_dispositions` id 19, `write_status='failed'`) and the two
unreviewed `decision_queue` entries.

**Zero Phase 1b surface was touched**, re-confirmed by direct diff inspection
in all three verification passes: `server/lib/db-rebuild.js` does not exist;
`server/db.js` and `server/lib/detours.js` diffs against base are empty;
`detour_dispositions` / `upsertDetourDisposition` / the `'trunk_drift'` schema
literal appear nowhere in the new or modified server files.

What this build *did* do for the gate: DEC-4's logging widening means the
instrument Sara needs for that trial now works. The two dominant silent
failure modes emit distinct lines —
`"[reconciliation] Claude CLI not available — cannot classify"` vs.
`"[reconciliation] Claude CLI returned no output — cannot classify"` — so the
trial can answer *which* failure dominates instead of just "classification
didn't happen."

## Open decisions

| Id | Status | What it needs |
|---|---|---|
| **WATCH-5** | **PENDING** | Sara's call — DEC-7's live trial. **Hard gate on Phase 1b.** Unchanged by this build; instrumented by it. |
| **WATCH-8** | **PENDING** | The un-intake'd-capability routing rule (`practice-kind-override` DEC-5) remains unadopted. Someone else's row, carried here so this build didn't step on it. |
| WATCH-1 | PARKED | Accepted limitation: ff-merged-then-deleted branch reads as direct-trunk work. Shipping knowingly. |
| WATCH-2 | PARKED | `trunk_drift` rows for planless cwds never reach the LLM (pre-existing behavior, restated). |
| WATCH-3 | PARKED | SHARED-BUDGET-STARVATION — promotion trigger recorded, not yet a catalog entry. |
| WATCH-4 | PARKED | `trunk_drift` labels would be the first `detour_dispositions.label` built from uncontrolled external text (Phase 1b concern; mitigated, not eliminated). |
| WATCH-6 | PARKED | Grandfathered rebuild sites — deliberate non-retrofit. |
| WATCH-7 | PARKED | Declined scope: classification vocabulary, `plan-writeback.js`, layer-7 rollup UI. |
| DEC-1…DEC-5 | DECIDED | DEC-4 amended by this build (widened to exits 4 and 5); DEC-5's predicate implemented and mutation-proven. |

## Notes fed back into memory

Two findings from this build were written back to the durable record (see
"Memory updated" at the end):

1. **A new standing rule in `PROJECT-CONTEXT.md` §9.3** — this single build
   independently re-discovered the vacuous-guard shape **three times** and the
   hand-scoped-scan shape **twice**, across five different guards. Every
   "add a structural guard to prevent X" step in this build initially shipped a
   guard that did not actually test for X. The recurrence density is the
   finding, not the individual instances.
2. **A plan-level lesson for `team-intake` / `team-qa`** — `technical-plan.md`
   specified `--exclude=refs/heads/<branch>`, which is **wrong**: per
   `git-rev-list(1)`, `--exclude` patterns applied to `--branches` must not
   begin with `refs/heads/`, and a prefixed pattern silently matches nothing —
   i.e. DEC-5's clause 3 would have been a no-op while every test that didn't
   specifically exercise it stayed green. Caught by the implementer and
   verified empirically against the man page's stated semantics. When a plan
   specifies exact CLI flags, the flags need an empirical check, not a
   documentation-reading check.

## Next step

**Stops at green. You commit / push / open a PR — or hand it back for changes.**
This skill does not commit.

It also does **not** tear down the worktree or any stack — there is no Docker
stack here, and the worktree at
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor`
stays live until whoever merges runs the teardown manually. Nothing about that
is automatic.

When you do commit, the red-proof ledger (RP-1, RP-2, RP-6, BL-2, BLOCKER 1,
BLOCKER 2 above) is what the plans asked to be recorded in the commit message.
