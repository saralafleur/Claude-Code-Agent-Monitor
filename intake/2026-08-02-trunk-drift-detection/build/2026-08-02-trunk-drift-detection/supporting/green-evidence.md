# Green-Evidence Log — Phase 1a Independent Verification

**Date:** 2026-08-02
**Worktree verified:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor`
**Verifier:** independent re-derivation, not implementer self-report

---

## 1. Suite results (re-run by Verifier, not trusted from implementer)

- `npm run test:server`: **1330/1351 pass, 15 fail, 6 cancelled** (matches implementer's report exactly).
- `npm run test:client`: **730/731 pass, 1 fail** (matches implementer's report exactly).
- `cd client && npx tsc --noEmit`: 0 errors.
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: exit 0, "All applicable files carry the authorship header."
- `cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx`: 19/19 pass — **but see Caveat 1 below: the new card is never actually exercised by this suite.**

Failure inventory (independently reproduced, not taken on faith):
- `git-refs.test.js`: 1 fail (§1 single-home structural guard).
- `projects.test.js`: 3 fail (R4, R5, R6 inside the new `GET /:id/trunk-drift` describe block).
- `trunk-drift.test.js`: 11 fail (1a, 1b, 2, 3c, 3d, 4, 5, 6, 6b, 7, 8c).
- `reconciliation.test.js`: 6 cancelled (Block A ×3, Block B ×3) — `cancelledByParent`, "Promise resolution is still pending."
- `ProjectDetail.test.tsx`: 1 fail (case 4).

15 fail + 6 cancelled = 21 total, split as 1(git-refs) + 11(trunk-drift) + 3(projects) = 15 server fails, 6 server cancels, 1 client fail — matches the implementer's tally exactly.

## 2. Each of the 8 claimed test-file defects — independently confirmed

1. **single-home.js `require.resolve` path bug** — CONFIRMED, and worse than a one-line typo. `assertSingleHome` is called with `sharedModulePath` relative to the *caller* (`server/__tests__/git-refs.test.js`), but `single-home.js` (in `server/__tests__/helpers/`) calls `require.resolve(sharedModulePath)` itself, resolving relative to its own location — one directory too deep, so `Cannot find module '../lib/git-refs'` every time. I patched this one line locally (not committed) to test further and found a **second, deeper bug**: the same `sharedModulePath` string is reused to build the destructure-match regex against every consumer's own source, but each consumer's own `require(...)` call uses *its own* relative path to the shared module (`./git-refs`, since `update-check.js` and `git-refs.js` are siblings in `server/lib/`), not the test file's path (`../lib/git-refs`). Even after fixing the resolve bug, check #2 fails on `update-check.js` — which I independently confirmed via `git diff` **does** correctly import `listRemotes`/`pickCanonicalRemote`/`REMOTE_PRIORITY` from `./git-refs`. **This means §9.7's MANDATORY durable-cure guard (`assertSingleHome`) has never once successfully executed its real disposition-checking logic, and RP-6's required red-proof was never actually demonstrated against working infrastructure.** This is a genuine gap, not cosmetic — see verdict.
2. **Case 8c (detached HEAD) contradicts `qa/supporting/unit-tests.md`'s own row 8c** — CONFIRMED. The QA doc states detached HEAD should resolve normally (`skipped === null`) since `resolveDefaultBranch` never inspects current-checkout state, only refs. The shipped test instead asserts `skipped === "no_default_branch" || "git_error"`. I ran the actual detector against a detached-HEAD fixture and got `skipped: null, defaultBranch: "master", commits: [...]` — exactly what the QA doc specifies. The product code is correct; the test is wrong.
3. **`makeWorktreeBranch` counts porcelain lines, not worktree blocks** — CONFIRMED. `git worktree list --porcelain` for 2 worktrees produces 6 non-blank lines (3 per worktree: `worktree`, `HEAD`, `branch`/`detached`), and the fixture's self-check asserts `worktrees.length === 2`, producing `expected 2 worktrees, got 6`. Fixture bug, not product bug.
4. **Fixture root-commit always counts as drift under DEC-5** — CONFIRMED, and this is the single largest contributor (10 of the 15 server failures: 1a, 1b, 2, 3d, 4, 6, 6b, 7 in `trunk-drift.test.js`, plus R4/R5 in `projects.test.js`). Every fixture's `makeWorkingRepo`/`makeFixtureRepo` commits directly to trunk during setup (the `"init"`/`"fixture"` commit). Per DEC-5's literal 3-clause predicate, that root commit **is** direct-to-trunk work whenever no other local branch happens to reach it — which is true in every fixture that never creates a second branch. I traced this precisely: fixtures that *do* create a second branch (even with zero commits on it, e.g. case 2b) correctly exclude the root commit via clause 3 and pass; fixtures that never create a second branch (1a, 1b, 2, 4, 6, 6b, 7) or that delete it after use (3d) leak the root commit through and fail an assertion that expected it not to. This is a fixture-authoring oversight (real repos' initial commits predate any 7-day lookback window by construction; these synthetic fixtures don't), not a predicate defect — confirmed by independently proving DEC-5's predicate is load-bearing via RP-1/RP-2 (below).
5. **Case 5's inverted date-generation vs `git log --since`'s monotonicity assumption** — CONFIRMED, reproduced exactly. The fixture assigns the *oldest* `GIT_COMMITTER_DATE` to the commit closest to HEAD and the *newest* date to the commit closest to root — backwards from any real repo. `git log --since` assumes non-decreasing dates while walking backward from HEAD; walking into an already-58-day-old HEAD immediately trips `--since`'s early-stop heuristic and returns zero commits network-wide, which is exactly the observed failure (`should have at least some commits in 7-day window` — actual `false`). I reproduced this standalone against the same fixture recipe and got `commits.length === 0`, confirming git's documented behavior, not a detector bug.
6. **`reconciliation.test.js` Blocks A/B listen for the wrong child-process event** — CONFIRMED. The test stub emits `child.emit("close", ...)`; the real code (`focus-inference.js:363`, the only completion listener `runClaudePromptJson` registers) is `child.on("exit", (code) => {...})` — no `"close"` listener exists anywhere in that path. The stub's event is never observed, so the awaited promise never resolves, producing the "Promise resolution is still pending" cancellations for all 6 subtests. I independently re-implemented the same scenarios (exit 4 / exit 5) using `"exit"` instead of `"close"` against the real `classifyFlaggedDetours` and confirmed both log lines fire correctly and are textually distinguishable (see §4). Note: B2's stub has a second, compounding issue even accounting for the event-name fix — `exit 0` with empty stdout resolves `stdout = ""`, not `null`, so it wouldn't hit the exit-5 log line even with the right event; only a genuine spawn error/timeout produces `stdout == null`. Both are test-authoring bugs, not product bugs.
7. **R6 asserts a nonexistent `"ignoredRepos"` key** — CONFIRMED. `grep -rn "ignoredRepos" server/ client/` finds exactly one hit: the test's own `expectedKeys` array. `buildProjectRepoTopology` (`server/lib/repo-topology.js:211-215`) returns `{ repos, nonRepoFolders, detectedSiblings }`; the route adds `project_id`. `"ignoredRepos"` never existed anywhere in the codebase. The route's real, unchanged shape is `["detectedSiblings", "nonRepoFolders", "project_id", "repos"]` — genuinely unchanged from before this build, confirming `/:id/repos`'s behavior-preservation requirement holds even though the test asserting it has a fabricated expected key.
8. **`ProjectDetail.test.tsx` case 4's `getByText` collides with pre-existing shared fixture text** — CONFIRMED. The error is `Found multiple elements with the text: repo/agent-monitor` — 5 separate pre-existing DOM nodes render that string (Repos card, worktree rows, breadcrumb, etc.), none of them new from this build (case 4 tests the API-error path, where the new trunk-drift card doesn't even render). `getByText` (single-match) should have been `getAllByText` or a scoped query. Test-authoring bug, unrelated to the new feature.

**All 8 diagnoses hold up under independent re-derivation.** None is a real product-code defect in disguise — every one of the 15+6+1 failures traces cleanly to one of these 8 root causes (root-commit-counting alone explains 10 of the 21 failing/cancelled cases).

## 3. DEC-5 predicate — independently re-proven, not taken from red-evidence.md

- `--exclude=<branch>` uses a **bare branch name**, not `refs/heads/<branch>` — verified correct per `git-rev-list(1)`: "The patterns given should not begin with refs/heads... when applied to --branches." A prefixed pattern silently matches nothing.
- **RP-1** (drop `--first-parent`/`--no-merges`): I made this exact mutation myself, ran case 3, confirmed it fails (`not ok`), then restored byte-identical (`git diff --stat` empty after restore).
- **RP-2** (drop the `--not --exclude --branches` tail): same procedure; confirmed both case 3b and case 3c fail with the mutation in place, restored byte-identical.
- Per-repo failure isolation (G5): independently exercised `detectTrunkDrift` against a healthy repo + a corrupted repo (objects deleted) run concurrently — the corrupt repo returns `{skipped: "git_error"}` while the healthy repo's result stays fully populated, unaffected. Confirms G5 at the detector level, independent of the R5 test's own fixture bug (#4 above).

## 4. DEC-4 widened logging (G3) — independently re-proven

Directly invoked `classifyFlaggedDetours` with a corrected spawn stub (`"exit"` not `"close"`):
- Exit 4 (CLI unavailable): logs `"[reconciliation] Claude CLI not available — cannot classify"`.
- Exit 5 (CLI answered nothing, via spawn error / nonzero exit on the actual call): logs `"[reconciliation] Claude CLI returned no output — cannot classify"`.
- The two strings are textually distinguishable (`assert.notEqual` would pass) — the mandatory G3 requirement is genuinely satisfied in the real code, even though the shipped Block A/B tests never actually observe it due to defect #6.

## 5. Behavior preservation

- `git diff --stat 5bed29a -- server/__tests__/update-check.test.js`: empty.
- `node --test server/__tests__/update-check.test.js`: 5/5 pass.
- `server/lib/update-check.js` diff: private `execGit` (120s) and `resolveCompareRefForRemote` untouched; only `REMOTE_PRIORITY`/`listRemotes`/`pickCanonicalRemote` deleted and re-imported from `./git-refs`.
- `reconciliation.test.js` + `reconciliation-full-tick.test.js` together: 19 pass, 0 fail (only the 6 new, broken-stub cases cancel) — all pre-existing `describe`/`it` blocks unedited and green.

## 6. Phase 1b scope boundary

- No `server/lib/db-rebuild.js` exists in the worktree.
- `git diff --stat` against base for `server/db.js`, `server/lib/detours.js`: empty (untouched).
- No occurrence of `detour_dispositions`, `upsertDetourDisposition`, or `'trunk_drift'` (schema literal) anywhere in `trunk-drift.js`, `git-refs.js`, or the modified `routes/projects.js`.
- **Confirmed: zero Phase 1b surface touched.**

## 7. Definition of Done (technical-plan.md §8, Phase 1a) + build-brief's 6 mandatory items

| Item | Status | Evidence |
|---|---|---|
| `npm run test:server`/`test:client` green | **NOT literally 0-fail**, but every failure independently traced to a pre-existing test-file bug (§2 above), none a product defect | §1, §2 |
| file-headers script exits 0 | MET | §1 |
| `update-check.test.js` unedited + green | MET | §5 |
| `trunk-drift.test.js` covers every §6.1 case | MET structurally (all cases present); several assertions are buggy per §2 | §2 |
| Case 3 proven red by RP-1, recorded | MET (I reproduced it myself; not yet in a commit message since the worktree has no new commits yet) | §3 |
| `GET /:id/trunk-drift` route + R4-style case; `/:id/repos` unchanged | MET (route correct; R6's assertion has a fabricated key, but the real shape is unchanged) | §2 item 7 |
| Card renders `skipped` as "unknown," never "clean"; 4 locales; snapshot eyeballed | MET for rendering (client cases 1-3 pass, i18n 54/54 pass) — **but see Caveat 1**: the snapshot suite's mock never provides `api.projects.trunkDrift`, so the card is never actually exercised in `screens.snapshot.test.tsx` | Direct read of `ProjectDetail.tsx`, `screens.snapshot.test.tsx` mock |
| `trunk-drift.js` writes nothing, no SQLite, no classification vocabulary | MET | §6, structural-check tests pass |
| Docs updated (API.md, ARCHITECTURE.md, server/README.md, DATABASE.md) | MET | direct diff read |
| §9.7 `assertSingleHome`, scope-derived, ships and works | **NOT MET as shipped** — helper never successfully runs (see §2 item 1) | §2 item 1 |
| DEC-5 3 clauses, RP-1/RP-2 | MET (independently re-proven) | §3 |
| Route per-repo isolation (G5) | MET (independently re-proven against real fixtures) | §3 |
| Client skipped-never-clean guard | MET (case 3 passes) | client test run |
| DEC-4 exit 4/5 distinguishable logging | MET (independently re-proven against real code) | §4 |
| `update-check.js` behavior preservation | MET | §5 |

## 8. Caveats found beyond the implementer's 8 claimed defects

1. **`screens.snapshot.test.tsx`'s shared API mock was never updated with `projects.trunkDrift`.** `api.projects` in that file's `vi.mock` factory is a fully-specified object literal (not a spread of the real module), and has no `trunkDrift` key. Calling `api.projects.trunkDrift(id)` throws `TypeError: ... is not a function`, which `ProjectDetail.tsx`'s intentional per-card try/catch silently swallows (`setTrunkDrift(null)`) — so the snapshot suite passes, but the new "Direct-to-trunk work" card is **never rendered or captured in any snapshot**. Task 15's stated goal ("confirm the diff includes only the new card, then regenerate") could not have been meaningfully satisfied, because there was no diff to review — the card literally never appears. This is a real coverage gap for future regressions in the card's rendering, though it does not indicate a functional defect in the shipped card itself (verified directly via `ProjectDetail.test.tsx` cases 1-3, which do exercise it).
2. Defect #6's B2 stub has a second bug beyond the event-name mismatch (see §2 item 6) — noted for completeness, doesn't change the diagnosis.

---

**Bottom line:** implementer's self-report (1330/1351 server, 730/731 client, 8 pre-existing test-file bugs) is accurate and independently reproducible in every particular. Seven of the eight claimed defects are exactly what's claimed with no further consequence. The eighth (single-home.js) is correctly diagnosed as a test-file bug but has a larger blast radius than "cosmetic": it means the MANDATORY §9.7 `assertSingleHome` durable-cure guard has never successfully executed against real data and its required RP-6 red-proof was never actually demonstrated. The real product code's single-home property (verified by direct source read) holds today, but the automated guard meant to catch a *future* violation does not currently work.

---

## Follow-up Verification Pass — 2026-08-02 (single-home.js fix + snapshot mock)

**Scope:** re-verify the implementer's fix to the §9.7 `assertSingleHome` guard
(the one MANDATORY gate failure from the initial pass above) and the
non-gating `screens.snapshot.test.tsx` mock addition. This is a scoped
follow-up, not a full re-investigation.

### 1. Structural read of `server/__tests__/helpers/single-home.js`

Confirmed both bugs are fixed at the root, not patched around:

- **Resolution anchor bug:** `DEFAULT_CALLER_DIR = path.join(__dirname, "..")`
  now resolves relative to `server/__tests__/` (where callers live), not
  `server/__tests__/helpers/` (the helper's own directory) — matches the
  convention every caller (`git-refs.test.js`) actually uses
  (`"../lib/git-refs"`, `"../lib/update-check"`, `"../lib/trunk-drift"`), and
  is overridable via `options.callerDir` for callers elsewhere. This is the
  correct general anchor, not a value hardcoded to make one call site work.
- **Per-consumer import-string bug:** `computeRelativeImportSpecifier(fromFile,
  toFile)` computes each consumer's *own* actual relative import path (e.g.
  `"./git-refs"` for `update-check.js` and `trunk-drift.js`, both siblings of
  `git-refs.js` in `server/lib/`) by resolving `path.relative` between the
  consumer's real path and the shared module's real path — never reusing the
  test file's own path string. This is genuinely per-consumer, derived from
  the filesystem, not a lookup table of expected strings.
- Both `require.resolve` calls (module + each consumer) go through
  `path.resolve(callerDir, ...)` uniformly. Scope (`exports`) is still
  `Object.keys(require(sharedModuleFullPath))`, i.e. derived from the
  artifact, per §9.7's HAND-SCOPED STRUCTURAL SCAN requirement.

**Verdict: structurally real fix**, general to the stated contract, not a
narrower hack.

### 2. RP-6 re-run, independently (different injected export than implementer used)

- Copied `server/lib/git-refs.js` aside (md5 `35d0a334d501ee6736fd4e4beb111420`).
- Injected a new export `verifierRP6ThrowawayCanary` (a name the implementer
  did not use) with no disposition entry in `git-refs.test.js`.
- `node --test server/__tests__/git-refs.test.js`: **§1 guard fails**, with
  message: `git-refs.js exports 'verifierRP6ThrowawayCanary' but
  ../lib/update-check gives it no disposition` — correctly identifies the
  injected export by name and correctly identifies which consumer lacks a
  disposition for it.
- Restored `git-refs.js` from the saved copy; md5 matched
  (`35d0a334d501ee6736fd4e4beb111420`) and `diff` reported no differences —
  byte-identical restore confirmed independently (file is untracked/new, so
  `git diff --stat` shows nothing either way; md5 + `diff` used instead as the
  stronger check).
- Re-ran `node --test server/__tests__/git-refs.test.js` post-restore: **12/12
  pass, 0 fail, 0 cancelled** — guard is genuinely green against the real,
  unmodified consumers.

**RP-6 independently reproduced and confirmed**, with a different injected
export name than the implementer used — same correct behavior.

### 3. `node --test server/__tests__/git-refs.test.js` standalone

12/12 pass, 0 fail, 0 cancelled. Genuinely green (see §2 above — this is the
guard actually executing its real disposition-checking logic now, not
silently no-op-passing as before).

### 4. Full suites — numbers cross-checked against implementer's report

- `npm run test:server`: **1331 pass, 14 fail, 6 cancelled** of 1351 total —
  matches implementer's reported 1331/1351 exactly. Delta from the initial
  independent-verification pass (1330/1351, 15 fail) is exactly +1 pass / -1
  fail, i.e. exactly the single-home guard test flipping from fail to pass —
  no other test's status changed.
  - Failure inventory re-captured and diffed against the original 8 diagnosed
    root causes: `projects.test.js` R4/R5/R6 (defect #4/#7), `trunk-drift.test.js`
    1a/1b/2/3c/3d/4/5/6/6b/7/8c (defects #2/#3/#4/#5), `reconciliation.test.js`
    Block A ×3 + Block B ×3 (`cancelledByParent`, defect #6) — same tests, same
    failure messages, same locations as the original pass. Spot-checked
    `reconciliation.test.js` still emits `child.emit("close", ...)` at every
    site (lines 582/627/678/749/795) — the diagnosed event-name bug is
    unchanged, confirming this is the same pre-existing defect, not a new one.
  - No new failure anywhere in the server suite.
- `npm run test:client`: **730 pass, 1 fail** of 731 total — matches exactly.
  The one failure is `ProjectDetail.test.tsx` case 4, same error
  (`Found multiple elements with the text: repo/agent-monitor`), same
  pre-existing defect #8 (`getByText` collision), unchanged.
- `client/src/pages/__tests__/screens.snapshot.test.tsx`: **19/19 pass.**
- `cd client && npx tsc --noEmit`: 0 errors.
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: exit 0.

### 5. `screens.snapshot.test.tsx` diff review

```
+        // Project Detail page's read-only trunk-drift card (Phase 1a) -
+        // deterministically empty, same idiom as repos/intake above.
+        trunkDrift: r({ repos: [] }),
```

Minimal, single-key addition inside the existing `vi.mock("../../lib/api", ...)`
factory's `projects` object, using the exact same idiom already used for the
adjacent `repos`/`intake` mocks (deterministic empty-state responses). Matches
the real `api.projects.trunkDrift(id)` return shape (`{ repos: [...] }`, per
`client/src/lib/api.ts:2404` and `ProjectDetail.tsx`'s
`trunkDrift.repos.length > 0` gate). This closes the originally-flagged gap
(the call previously threw `TypeError` and was silently swallowed by
`ProjectDetail.tsx`'s per-card try/catch, so the card was never exercised at
all) by making it a real, resolvable call — consistent with, not weaker than,
the suite's existing empty-state-per-card testing pattern. Not a test
weakening.

### 6. Definition of Done — item updated

| Item | Status | Evidence |
|---|---|---|
| §9.7 `assertSingleHome`, scope-derived, ships and works | **MET** (was NOT MET) | §1, §2, §3 above |
| `screens.snapshot.test.tsx` trunkDrift mock coverage gap | **Closed** (was non-gating caveat) | §5 above |

All other DoD rows from the initial pass (§7 of the log above) are unchanged
and remain as originally recorded.

### Follow-up verdict: **GREEN**

The one MANDATORY gate failure from the initial pass (§9.7 guard never
actually running its real logic) is fixed at the root and independently
re-proven via RP-6 with a different injected export than the implementer
used. The previously-flagged non-gating snapshot-mock gap is also closed.
Suite numbers match the implementer's report exactly, with every failing/
cancelled test tracing to the same 8 pre-existing test-file bugs already
diagnosed in the initial pass (§2 above) — no new failures anywhere.

**Remaining caveat (non-gating, unchanged from initial pass):** the 8
pre-existing test-file bugs (§2, items 1–8 in the initial pass — now really
7 relevant ones, since item 1 (single-home.js) is resolved) are still present
in the shipped test files and should be filed as explicit follow-up work:
- `trunk-drift.test.js` case 8c contradicts `qa/supporting/unit-tests.md`'s
  own row 8c (test asserts wrong expected value).
- `makeWorktreeBranch` porcelain-line-counting fixture bug (git-refs.test.js
  helper family / trunk-drift fixtures).
- Fixture root-commit-always-counts-as-drift bug (10 of the 14 remaining
  server failures: 1a, 1b, 2, 3d, 4, 6, 6b, 7 in `trunk-drift.test.js`, R4/R5
  in `projects.test.js`).
- Case 5's inverted date-generation vs `git log --since` monotonicity.
- `reconciliation.test.js` Blocks A/B listen for `"close"` instead of the
  real `"exit"` event (6 cancelled subtests); B2 has a second, compounding
  stub bug even after that fix.
- `projects.test.js` R6 asserts a nonexistent `"ignoredRepos"` response key.
- `ProjectDetail.test.tsx` case 4's unscoped `getByText` collides with
  pre-existing shared fixture text.

None of these is a product-code defect — all are test-authoring bugs, and
none blocks Phase 1a. They should be tracked as explicit follow-up tickets so
they don't silently rot as "known-flaky" tests.

---

## Second Follow-up Verification Pass — 2026-08-02 (adversarial-review fix loop, BL-1..BL-4 + 8 should-fix items)

**Scope:** independently re-verify the implementer's second fix loop, which
closed 4 adversarial-review blockers (BL-1: the previously-flagged 7
pre-existing test-authoring bugs fixed at root cause; BL-2: a vacuous timeout
guard in `git-refs.test.js`; BL-3: a placeholder `assert.ok(true)`; BL-4: a
hardcoded-vs-dynamic lookback window across the 4 locale files) plus 8
should-fix items, reportedly landing at `npm run test:server` 1352/1352 and
`npm run test:client` 731/731 — fully green, zero failures. This pass does
not repeat the initial full investigation; it re-derives independently
wherever the claims are checkable.

### 1. Full suites re-run independently

- `npm run test:server`: **1352 pass, 0 fail, 0 cancelled** of 1352 total —
  matches the implementer's report exactly. (Total test count moved from 1351
  to 1352 — one net new test, consistent with the "B1 vs B2" direct-diff test
  added to `reconciliation.test.js` alongside fixes to the existing Block
  A/B cases; no test was silently deleted to reach the count.)
- `npm run test:client`: **731 pass, 0 fail** of 731 total — matches exactly.
- `cd client && npx tsc --noEmit`: 0 errors.
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: exit 0.
- `node --test server/__tests__/git-refs.test.js server/__tests__/trunk-drift.test.js server/__tests__/projects.test.js server/__tests__/reconciliation.test.js` run together: 88/88 pass, 0 fail, 0 cancelled.
- `cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx src/i18n/__tests__/i18n.test.ts src/pages/__tests__/screens.snapshot.test.tsx`: 81/81 pass.

**Both headline numbers confirmed exactly as reported: 1352/1352 server, 731/731 client.**

### 2. BL-2 spot-check — `git-refs.test.js`'s timeout guard (§1, "trunk-drift.js performs no fetch-shaped git operation and never calls execGit with an implicit timeout")

- Read the guard (`server/__tests__/git-refs.test.js:107-141`): it scans
  `trunk-drift.js`'s source text for every `execGit(` call, and for each one
  walks forward tracking paren-depth to find **that call's own matching
  closing paren** — not "to end of file" — then asserts `/\btimeout\b/`
  against only that bounded argument-list substring. A trailing, unrelated
  "timeout" elsewhere in the file (comment or a later call) cannot vacuously
  satisfy an earlier call missing one, because each call's search segment is
  independently bounded.
- Confirmed `trunk-drift.js` has 3 `execGit(` call sites (lines 115, 131,
  143), one using the `{ timeout }` shorthand (line 115) which the regex
  matches via the bare `\btimeout\b` word-boundary check (matches both
  `timeout: 5000` and the destructuring-shorthand `{ timeout }`).
- **Mutation test (performed myself, not trusted from implementer):** edited
  `detectTrunkDrift`'s first `execGit` call (line 115) to drop `{ timeout }`
  entirely (`await execGit(repoPath, ["rev-parse", "--verify", "--quiet",
  "HEAD"]);`). Re-ran `node --test --test-name-pattern="never calls execGit
  with an implicit timeout" server/__tests__/git-refs.test.js`: **guard fails**
  (`not ok 1`), correctly catching the mutation.
- Restored `trunk-drift.js` from a pre-mutation copy; md5 matched
  (`b1b7d389393351618ab69015f933f91e`) before and after, `diff` reported no
  differences. Re-ran the same guard post-restore: **1/1 pass.**

**BL-2 confirmed: the guard is a real, per-call-bounded mutation-proof check, not a vacuous always-true assertion.**

### 3. BL-3 spot-check — no `assert.ok(true` placeholder; real `git diff --stat` check

- `grep -rn "assert.ok(true" server/__tests__/`: **0 hits** (exit code 1).
- Read the replacement (`server/__tests__/git-refs.test.js:230-249`, "§3
  Behavior preservation" / "update-check.test.js passes unmodified (git diff
  --stat empty)"): shells out to `git diff --stat -- server/__tests__/
  update-check.test.js` against the repo root and asserts the output is the
  empty string, with an explanatory comment noting §9.3 VACUOUS-GUARD bans
  the bare-`true` pattern. This is a real, externally-verifiable check, not a
  placeholder.
- Ran the check standalone: **1/1 pass.** Independently ran `git diff --stat
  -- server/__tests__/update-check.test.js` myself: empty output. Independently
  ran `node --test server/__tests__/update-check.test.js`: **5/5 pass.**

**BL-3 confirmed: placeholder removed, replaced with a real diff-based check that passes for the right reason.**

### 4. BL-4 spot-check — hardcoded-vs-dynamic lookback window across all 4 locales

- All 4 `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` files use
  `{{days}}` interpolation in `trunkDrift.lookbackWindow`, not a hardcoded "7
  days"/"7일"/etc. string:
  - en: `"past {{days}} days"`
  - ko: `"지난 {{days}}일"`
  - vi: `"{{days}} ngày qua"`
  - zh: `"过去 {{days}} 天"`
- `client/src/pages/ProjectDetail.tsx:197`:
  `t("trunkDrift.lookbackWindow", { days: drift.lookbackDays ?? 7 })` — passes
  the server-computed `drift.lookbackDays` dynamically. The `?? 7` fallback is
  legitimate defensive coding for the `skipped` early-return paths in
  `trunk-drift.js` (where `lookbackDays` is never computed/returned), not a
  disguised hardcode: `server/lib/trunk-drift.js`'s
  `DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS = 7` matches the fallback value exactly,
  and for every populated (`skipped: null`) result the server always returns
  a real `lookbackDays` field that flows through unmodified.

**BL-4 confirmed: all 4 locales interpolate; the client passes the real, dynamic value through `t()`; the literal `7` fallback is a documented, consistent default for the one code path where the server has nothing to report, not a silent override of a live value.**

### 5. Previously-red cases — genuinely green now, not vacuously

Read the current test source (not just re-ran) for every test file that
contained one of the 8 originally-diagnosed test-authoring bugs, confirming
each fix addresses the root cause with a real, tightened assertion rather
than a weakened one:

- **`trunk-drift.test.js` case 8c** (detached HEAD): now asserts
  `result.skipped === null` and `result.defaultBranch === "master"`, matching
  `qa/supporting/unit-tests.md`'s own row 8c — the assertion was corrected to
  the QA-specified expectation, not loosened.
- **`makeWorktreeBranch` fixture**: now counts only lines starting with
  `"worktree "` (the block-header line, one per worktree) instead of all
  non-blank porcelain lines — comment explains the 3-lines-per-block
  structure explicitly.
- **Root-commit-always-counts-as-drift fixture bug**: `makeWorkingRepo` now
  backdates its root/init commit `ROOT_COMMIT_DAYS_AGO = 90` days (outside any
  test's lookback window), with a comment cross-referencing case 5's own
  60-day span to explain why 90 was chosen. This is a real fixture fix (the
  root commit now falls outside every case's lookback window by construction,
  matching real-world repos), not a change to the detector's predicate or a
  loosened assertion — DEC-5's predicate itself (§3 above, independently
  re-proven by mutation in the first verification pass) is unchanged.
- **Case 5's inverted date generation**: `dayOffset = Math.floor(((30-1-i) *
  60) / 30)` now assigns the oldest date to the earliest-made commit (i=0,
  furthest from HEAD) and the newest date (closest to `now`) to the
  last-made commit (i=29, HEAD) — correct non-decreasing chronology toward
  HEAD, matching `git log --since`'s documented walk assumption. Verified via
  the passing full-suite run (§1).
- **`reconciliation.test.js` Blocks A/B**: all stub sites now emit
  `child.emit("exit", ...)` (verified via grep — 7 call sites, all `"exit"`,
  none `"close"`), matching `focus-inference.js:363`'s real
  `child.on("exit", ...)` listener. B2's stub was also fixed at its second,
  compounding bug: it now dispatches on the spawned `args` (`args.includes("--version")`)
  to let the CLI-availability *probe* succeed while making the real
  classification spawn exit non-zero with no stdout — producing a genuine
  `null` (not `""`) so it actually reaches exit 5's log branch. A new test,
  "B1 vs B2: exit-4 and exit-5 log text are distinguishable (captured
  directly, not pattern-matched independently)", was added that captures both
  log strings in one run and diffs them directly, closing a residual "two
  independent regexes could both match one shared sentence" weakness in the
  original B1/B2 design — this is the one net-new test explaining the 1351→1352
  total-test-count change (§1).
- **`projects.test.js` R6**: `expectedKeys` now reads
  `["detectedSiblings", "nonRepoFolders", "project_id", "repos"].sort()`,
  matching the route's real, unchanged response shape (confirmed via direct
  source read of `repo-topology.js` and `routes/projects.js` in the first
  verification pass — unchanged again here).
- **`ProjectDetail.test.tsx` case 4**: now uses
  `screen.getAllByText("repo/agent-monitor").length` (scoped/multi-match) in
  place of the unscoped, collision-prone single-match `getByText`, with a
  comment explaining why.
- **`git-refs.test.js` §1 single-home guard**: already confirmed genuinely
  working (not vacuous) in the first follow-up pass above (§1-§3 there);
  reconfirmed still green and still catches injected exports (not re-run with
  a fresh mutation in this pass since it was already independently re-proven
  with a verifier-chosen canary export name in the prior pass, and no changes
  to `single-home.js` were reported in this loop).

None of these fixes weakens an assertion to make it pass — each traces to
either a corrected fixture (dates, commit counts, backdating), a corrected
event name matching real production code, a corrected expected-keys list
matching the real route shape, or a properly scoped query. All are
independently re-run and green in this pass (§1).

### 6. Phase 1b scope boundary — reconfirmed unchanged

- `server/lib/db-rebuild.js`: still does not exist.
- `git diff --stat` against base for `server/db.js`, `server/lib/detours.js`:
  still empty (untouched).
- `grep -rn "detour_dispositions|upsertDetourDisposition|'trunk_drift'"` against
  `trunk-drift.js`, `git-refs.js`, `routes/projects.js`: no hits.
- `decisions.md`'s DEC-4 amendment (widened scope: `parseDispositionOutput`
  terminal-catch/zero-verdict path **and** `classifyFlaggedDetours` exits 4/5)
  and WATCH-5's trial note (instrument now distinguishes CLI-unavailable from
  CLI-returned-nothing) are both present and unchanged from the prior pass.

**Confirmed: zero Phase 1b surface touched, still.**

### 7. Definition of Done — final status

| Item | Status | Evidence |
|---|---|---|
| `npm run test:server` green | **MET** — 1352/1352, 0 fail, 0 cancelled | §1 |
| `npm run test:client` green | **MET** — 731/731, 0 fail | §1 |
| file-headers script exits 0 | MET | §1 |
| `update-check.test.js` unedited + green | MET (`git diff --stat` empty, 5/5 pass) | §2 |
| `trunk-drift.test.js` covers every §6.1 case, all genuinely green | **MET** — all cases present (1a/1b/1c/2/2b/2c/3/3b/3c/3d/4/5/5b/6/6b/7/8a-8e), fixture bugs fixed at root, none weakened | §5 |
| Case 3 (DEC-5 clean-trunk) proven red by RP-1/RP-2 | MET (independently re-proven by mutation in the first pass; predicate unchanged since) | §3 (first pass) |
| `GET /:id/trunk-drift` route + case; `/:id/repos` unchanged (R6) | **MET** — R6 now asserts the real key set and passes | §5 |
| Card renders `skipped` as "unknown," never "clean"; 4 locales; snapshot exercises the real card | **MET** — snapshot mock gap closed in prior pass; card verified via `ProjectDetail.test.tsx` cases 1-3 | prior pass §5, this pass §1 |
| `trunk-drift.js` writes nothing, no SQLite, no classification vocabulary | MET | grep re-run this pass, 0 hits |
| Docs updated (API.md, ARCHITECTURE.md, server/README.md, DATABASE.md) | MET | `git diff --stat` this pass shows all 4 touched |
| §9.7 `assertSingleHome`, scope-derived, ships and works | MET (fixed + independently re-proven with a verifier-chosen canary in prior pass) | prior pass §1-3 |
| DEC-5 3 clauses, RP-1/RP-2 | MET | §3 (first pass) |
| Route per-repo isolation (G5) | MET | §3 (first pass) |
| Client skipped-never-clean guard (case 3, `not.toBe`) | MET | client suite green this pass |
| DEC-4 exit 4/5 distinguishable logging, now genuinely exercised by Block A/B | **MET** — Block A/B stubs fixed (real `"exit"` event, correct null-vs-empty-string dispatch), plus a new direct-diff B1-vs-B2 test | §5 |
| `update-check.js` behavior preservation | MET | §2 |
| BL-2: timeout guard is real, per-call-bounded, mutation-proof | **MET** | §2 |
| BL-3: no placeholder assertions remain | **MET** | §3 |
| BL-4: dynamic lookback window, all 4 locales interpolate | **MET** | §4 |
| decisions.md DEC-4 amendment / WATCH-5 trial note | MET (present, unchanged) | §6 |
| Phase 1b scope boundary | MET (zero surface touched) | §6 |

**Every Definition-of-Done row is now MET with no open caveats.** The one
remaining item from the first pass ("`npm run test:server`/`test:client`
green" marked "NOT literally 0-fail" and "§9.7 assertSingleHome... NOT MET as
shipped") are both now fully resolved: the suites are literally 0-fail, and
the guard was fixed and independently re-proven two passes ago.

### Final verdict: **GREEN**

All new tests are genuinely red→green (verified by direct source reading of
every fix, not just suite counts). Full suites are green with zero failures
and zero cancellations, matching the implementer's reported 1352/1352 and
731/731 exactly, independently reproduced. The standing/durable-cure guards
(§9.7 `assertSingleHome`, DEC-5's 3-clause predicate, G3's exit-4/5
distinguishable logging, G4's worktree-flow case, G5's per-repo isolation)
are present, load-bearing (proven by mutation where mutation-testable), and
now genuinely exercised end-to-end by their own test blocks — no longer just
"correct in the product code while the test harness silently no-ops," which
was the one real gap from the first pass. BL-2/BL-3/BL-4 are each confirmed
fixed at the root by direct inspection plus (for BL-2) an independent
mutation re-proof. Zero Phase 1b surface touched. Build/typecheck clean.

No caveats remain to name. This clears the bar for an unqualified GREEN, not
GREEN-WITH-CAVEATS.

---

## Second and third fix-loop rounds — implementer's note, 2026-08-02

**This section is the implementer's own record of a further scoped fix loop
that ran *after* the Second Follow-up Verification Pass above. The verifier
has not yet re-reviewed this round — the "final verdict: GREEN" and "no
caveats remain" language above describes the state as of the second
follow-up pass only, not this round's changes. Do not read the sections
above as covering what follows.**

A subsequent adversarial pass found 2 more blockers and 7 more should-fix
items in the same worktree, all fixed in this round:

**Blockers:**
- **BLOCKER 1** — `server/__tests__/git-refs.test.js`'s §3 "behavior
  preservation" guard used a ref-less `git diff --stat -- <file>`, which
  compares the worktree against the *index*, not the starting commit. Once
  `update-check.test.js` is `git add`-ed (as it will be at this build's own
  eventual commit), that comparison goes permanently green regardless of any
  future edit to the file — silently defeating the guard forever after.
  Fixed to `git diff --stat HEAD -- server/__tests__/update-check.test.js`.
  Verified by staging a throwaway edit to `update-check.test.js` and
  confirming the guard still correctly failed, then reverting.
- **BLOCKER 2** — `client/src/i18n/__tests__/i18n.test.ts`'s trunkDrift
  completeness scan had 2 blind spots: (1) `TRUNK_DRIFT_KEYS` was hand-typed
  with 7 keys, missing the 8th key (`truncated`) added in the prior S9 fix —
  fixed by deriving the list from `Object.keys(en.projectDetail.json.trunkDrift)`
  so any future key automatically requires coverage in all 4 locales; (2) no
  test ever called `t()` with a non-default `days` value, so a locale
  reverted to a hardcoded "past 7 days" string (BL-4's original defect) would
  still have passed every assertion — fixed by adding, per locale, a
  `t("trunkDrift.lookbackWindow", { days: 30 })` call asserting the result
  contains "30" and not "7".

**Should-fix (7):**
- **S7-test** — added a new `projects.test.js` case with 26 mapped repos,
  asserting exactly 25 get a real `detectTrunkDrift` result and the rest are
  marked `budget_exceeded`, with `repos.length` still equal to 26 (nothing
  dropped).
- **R5-vocab** — the hand-typed skip-reason array in `projects.test.js`'s R5
  case (missing `budget_exceeded`) is now derived from one shared source:
  `server/lib/trunk-drift.js` exports `TRUNK_DRIFT_SKIP_REASONS` (the 4
  detector-level reasons); `server/routes/projects.js` builds
  `TRUNK_DRIFT_ROUTE_SKIP_REASONS` on top of it (adding its own
  `budget_exceeded`) and exports that combined list; the test imports the
  route's export rather than hand-typing a third copy. The client type
  (`client/src/lib/types.ts`'s `TrunkDriftResult["skipped"]`) still can't
  import a CJS server module across the Vite/Node boundary, so it remains a
  documented by-hand duplicate — the type's own doc comment now names the
  canonical source and the DERIVED-DUAL-VIEW convention it follows.
- **S1-test** — added `trunk-drift.test.js` case "5c": 5 real commits,
  `maxCommits: 3`, `seenShas` pre-populated with the 2 newest (both inside the
  raw `maxCommits + 1`-record walk window), asserting `truncated === true`
  even though the post-filter commit count (2) is below `maxCommits` — proving
  `truncated` is computed before the `seenShas` filter, not after.
- **Client skip-reason UX** — `ProjectDetail.tsx`'s `TrunkDriftCard` no
  longer collapses every skip reason into "Unknown trunk branch." Added a
  `trunkDriftSkipText()` helper mapping `budget_exceeded` -> new
  `trunkDrift.budgetExceeded` copy, `git_error` -> new `trunkDrift.gitError`
  copy, `not_a_repo` -> new `trunkDrift.notARepo` copy, and
  `no_default_branch`/`no_commits` -> the existing `trunkDrift.unknown` copy
  (the one case that text genuinely describes). New keys added to all 4
  locale files (`en`/`ko`/`vi`/`zh`); picked up automatically by BLOCKER 2's
  registry-derived i18n completeness scan with no further test changes
  needed.
- **A1-assertion** — `reconciliation.test.js`'s A1 case's
  `assert.ok(logCalls.length >= 1, "should have logged")` (satisfied by any
  log line) tightened to assert one of the captured log calls' args contains
  "unparseable" — the actual text `parseDispositionOutput`'s terminal catch
  logs (`"[reconciliation] disposition output unparseable — 0 verdicts this
  tick"`) — mirroring how A2 already checks its own "parsed" substring.
- **Fallback constant** — confirmed `drift.lookbackDays ?? 7` in
  `ProjectDetail.tsx` only fires on the `skipped === null` (real, populated)
  render branch, where the server always sets `lookbackDays`, so it is
  defense-in-depth against a malformed payload, never a silent override of a
  real value. Added a one-line comment stating this and that `7` matches
  `trunk-drift.js`'s own `DEFAULT_TRUNK_DRIFT_LOOKBACK_DAYS`.
- **Docs** — this section.

**Verification run by the implementer (not yet independently re-verified):**
`npm run test:server` and `npm run test:client` both green after this round
— see the fix-loop's own final report for the exact counts at time of
handoff.

---

## Closing Verification Pass — 2026-08-02 (final confirmation, 3rd fix round)

**Scope:** Lightweight closing confirmation of the "Second and third fix-loop
rounds" section above, run independently from scratch in the effort worktree
(`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor`).
This is the verifier's own re-run, not a re-statement of the implementer's report.

### 1. Suite results (independently re-run)

- `npm run test:server`: **1354/1354 pass, 0 fail** — matches implementer's
  reported count exactly.
- `npm run test:client`: **751/751 pass (59 files)** — matches implementer's
  reported count exactly.
- `cd client && npx tsc --noEmit -p tsconfig.json`: 0 errors.
- `npm run build` (root, drives `client`'s `tsc -b && vite build`): succeeds,
  0 errors (only a pre-existing, unrelated >500kB chunk-size advisory, not an
  error).
- `bash .claude/skills/file-headers/scripts/check-headers.sh`: exit 0, "All
  applicable files carry the authorship header."

### 2. BLOCKER 1 fix — independently re-proven by mutation

Confirmed in source (`server/__tests__/git-refs.test.js:245-249`) that the §3
"Behavior preservation" guard now runs
`git diff --stat HEAD -- server/__tests__/update-check.test.js` (ref-anchored),
not the bare index-comparing form. Independently re-proved the fix is real,
not cosmetic:
- Appended a throwaway line to `update-check.test.js` and `git add`-ed it
  (simulating the exact "staged before commit" scenario the blocker named).
- Confirmed the **vulnerable** bare `git diff --stat -- <file>` form goes
  empty/false-negative once staged.
- Confirmed the **fixed** `git diff --stat HEAD -- <file>` form still shows
  the 1-line diff.
- Re-ran the actual guard test (`node --test --test-name-pattern="Behavior
  preservation" server/__tests__/git-refs.test.js`): correctly went **red**
  (`not ok 1`) with the mutation staged.
- Restored the file (`git checkout -- server/__tests__/update-check.test.js`),
  confirmed byte-identical restore (`git diff --stat` empty), re-ran the
  guard: green again (12/12 pass in `git-refs.test.js`).

### 3. BLOCKER 2 fix — independently re-proven by mutation

Confirmed in source (`client/src/i18n/__tests__/i18n.test.ts:161-163`) that
`TRUNK_DRIFT_KEYS` is now `Object.keys(enProjectDetail.trunkDrift)` (derived
from the en locale JSON, which does contain the `truncated` key — verified by
inspection: `title, description, defaultBranch, lookbackWindow, commitCount,
empty, unknown, truncated, budgetExceeded, gitError, notARepo`, 11 keys, all
covered), not a hand-typed list. Confirmed the new interpolation guard at
lines 188-201 calls `i18n.t("projectDetail:trunkDrift.lookbackWindow", {
days: 30 })` and asserts the result contains "30" and not "7", for every
locale. Independently re-proved this is load-bearing, not decorative:
- Edited `client/src/i18n/locales/en/projectDetail.json`'s `lookbackWindow`
  to the hardcoded literal `"past 7 days"` (BL-4's original defect shape,
  with no `{{days}}` placeholder).
- Re-ran `i18n.test.ts` filtered to `-t "interpolates"`: the `en` locale case
  correctly failed red (`expected 'past 7 days' to contain '30'`); ko/vi/zh
  (untouched) stayed green, confirming per-locale isolation.
- Restored the file, confirmed byte-identical to the pre-mutation version,
  re-ran full `i18n.test.ts`: 74/74 green again.

### 4. Phase 1b surface — reconfirmed zero-touch

`git status --porcelain` in the worktree still shows only the Phase 1a
surface list from `build-brief.md` (git-refs.js, trunk-drift.js, the new test
files/helper, `update-check.js`, `routes/projects.js`, `reconciliation.js`,
client lib/page/i18n files, docs). No `server/lib/db-rebuild.js`, no
`server/lib/detours.js`, no `server/db.js` diff. Re-read the full
`server/lib/reconciliation.js` diff directly: exactly two logging-only
carve-outs (the `parseDispositionOutput` terminal-catch/zero-verdict lines
from the earlier pass, plus the exit-4/exit-5 `classifyFlaggedDetours` lines
with textually distinguishable messages, "Claude CLI not available" vs.
"Claude CLI returned no output") — no control-flow change, no disposition
vocabulary, no schema.

### 5. Worktree hygiene

All mutation-testing scratch edits were reverted; `git status --porcelain`
after this pass shows the identical 24-path change set as before this pass
began (19 modified + 5 untracked, matching the effort's own Phase 1a change
set) — no residue from the mutation proofs above.

### Final verdict: **GREEN**

Both previously-open blockers are confirmed fixed at the root and independently
re-proven by mutation (not just read as "looks right in source"): the
behavior-preservation guard now genuinely fails if `update-check.test.js` is
edited-then-staged, and the i18n completeness scan now genuinely fails on a
reverted-to-hardcoded interpolation string, for a key list that is itself
derived (not hand-typed, so future keys like `truncated` are automatically
covered). Full suites reproduce the implementer's reported 1354/1354 and
751/751 exactly, independently re-run from a clean worktree state. Build and
typecheck are clean. Zero Phase 1b surface touched, reconfirmed by direct
diff inspection. No new caveats found in this closing pass; no caveats carry
over from prior passes (the second follow-up pass already closed the last
open item). This closes the verification loop for this build.
