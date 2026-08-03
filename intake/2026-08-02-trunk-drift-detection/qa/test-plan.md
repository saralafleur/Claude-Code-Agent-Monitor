# Test Plan — trunk-drift-detection (Phase 1a)

> Authored by `qa-lead`, reconciling `supporting/coverage.md` + `supporting/risk.md`
> + `supporting/unit-tests.md` + `supporting/e2e-tests.md` against the strategist's
> **GAPPED** verdict in `qa-assessment.md`. This is the buildable deliverable: exactly
> what tests to add, in what order, with the exact assertions and the exact red-proofs.
> The assessment says *whether* coverage is adequate; this says *what to build* to make
> it so. Scope: **Phase 1a only** (no `db-rebuild.js`, no CHECK widening, no
> `recordTrunkDriftDetour`, no `reconcileCwd` periodic wiring, no `buildDispositionPrompt`
> reorder — all Phase 1b, hard-gated on WATCH-5).

## Objective

Add the test coverage that makes Phase 1a's new detector safe to trust and its refactor
provably lossless: real-git-fixture unit coverage for `server/lib/trunk-drift.js` and the
new `server/lib/git-refs.js`, a **derived-scope** single-home structural guard that fails
when any `git-refs.js` export lacks an explicit shared/private disposition at each consumer,
one minimum-flow route contract test for `GET /api/projects/:id/trunk-drift` including
per-repo failure isolation, component + registry-derived i18n coverage for the new
read-only card, and log-assertion coverage for a **widened** DEC-4 carve-out. End state:
five invariants are guarded that are guarded by nothing today — (1) DEC-5's false-positive
predicate, all three clauses, each proven red by mutation, including the worktree flow the
predicate exists to protect; (2) `update-check.js`'s `git fetch` keeps its effective 120 s
timeout and does **not** silently inherit `git-refs.js`'s 10 s default; (3) uncertainty
(`skipped`) never renders as "clean," server-side or client-side; (4) one mapped repo's git
failure cannot suppress another repo's result in the same response; (5) a reconciliation
tick that dies because the Claude CLI never answered is no longer silent — the exit that
`decisions.md` calls dominant is logged and log-asserted, so WATCH-5's live trial is run
with a working instrument.

## Coverage gap being closed

| # | UNGUARDED surface | Catalog id | Assertion that now pins it |
|---|---|---|---|
| G1 | `update-check.js`'s `execGit` rewiring during the `git-refs.js` extraction — `unit-tests.md` §2.1's scan is blind to it *and its positive regex matches the bad state* | **§9.7 HAND-SCOPED STRUCTURAL SCAN** (OPEN, 4x) + §9.3 VACUOUS-GUARD | `git-refs.test.js` §1: `doesNotMatch` on `execGit` in `update-check.js`'s `require("./git-refs")` destructure; `match` on the **fetch call site's** explicit `timeout: 120_000`; plus every `execGit(` call in `trunk-drift.js` carries an explicit `timeout:` and no fetch-shaped op exists there. **Never** an assertion on the (dead) `?? 120_000` default. |
| G2 | Every `git-refs.js` export that nobody wrote a disposition for — the *scope* of the scan itself | **§9.7** | `server/__tests__/helpers/single-home.js` derives scope from `Object.keys(require("../lib/git-refs"))` and fails on any export with no `shared`/`private`/`absent` disposition at each listed consumer. |
| G3 | `classifyFlaggedDetours` exit 5 (`runClaudePromptJson` → `null`: spawn error / non-zero exit / kill-timer) and exit 4 (`probeClaudeCli` false) — entirely unlogged today, in *both* `reconciliation.js` and `focus-inference.js` | no catalog id (DEC-4 scope defect) | `reconciliation.test.js` new block: log-call-count `=== 1` on exits 4 and 5 with distinguishable text, `=== 0` on exits 1–3 and on the happy path, `result.size === 0` unchanged in every case. |
| G4 | DEC-5 clause 3 against the **worktree** flow it exists to protect — all 14 planned cases use plain `git branch` | no id (`risk.md` §3 Assumption C) | `trunk-drift.test.js` case 3c: branch created via `git worktree add -b`, fast-forwarded into trunk, worktree still live → `commits.length === 0`; fixture self-check asserts `git worktree list` really shows 2 entries. |
| G5 | Per-repo failure **isolation** in the route's fan-out loop — both test docs only cover `skipped` values the detector returns *on purpose*, never a genuine git failure | no id (`risk.md` §7 / trap 6) | `projects.test.js` case R5: three mapped repos (healthy + empty + object-store-corrupted) in one 200 response; healthy repo's `drift` fully populated, corrupted repo reports `skipped: "git_error"`. |
| G6 | `parseDispositionOutput`'s terminal catch + zero-verdict path (confirmed unreached by any existing test) | §9.3 | `reconciliation.test.js`: log fires exactly once per failure path, `result.size` unchanged (the pre-fix-identical half of the assertion is what proves behavior-neutrality). |
| G7 | `resolveDefaultBranch`, `detectTrunkDrift`, `GET /:id/trunk-drift`, the card, the new types/api method — none exist | §9.1 (single-home form) | The full case matrices below. |
| G8 | Four-locale key completeness for the new card | §9.1 variant-isolation / `risk.md` §2 item 7 | `i18n.test.ts` registry-derived block over the existing `LOCALES` array × the card's `KEYS`, plus `empty !== unknown` in `en`. |

## Test change set

This project has **three real layers** (discovered, `package.json` + `coverage.md` §"Test
stack"): server `node:test` unit, server `node:test` route/integration (same glob, real
Express on an OS-assigned port — *there is no separate e2e runner, framework, bucket or tag
mechanism in this repo; do not invent one*), and client Vitest + Testing Library
(including the per-screen render-snapshot suite).

### Backend — unit (`node:test`, real throwaway git repos, never mocked `child_process`)

**`server/__tests__/helpers/single-home.js`** — **NEW (test helper, not a spec).**
Exports `assertSingleHome(sharedModulePath, consumers)`:

```js
// consumers: { [consumerRelPath]: { shared?: string[], private?: string[], absent?: string[] } }
assertSingleHome("../lib/git-refs", {
  "../lib/update-check": {
    shared:  ["listRemotes", "pickCanonicalRemote", "REMOTE_PRIORITY"],
    private: ["execGit"],                 // 120s-default fetch copy stays local — G1
    absent:  ["resolveDefaultBranch"],
  },
  "../lib/trunk-drift": {
    shared:  ["execGit", "resolveDefaultBranch"],
    absent:  ["listRemotes", "pickCanonicalRemote", "REMOTE_PRIORITY"],
  },
});
```

Behavior (all four assertions are load-bearing):
1. `const exports = Object.keys(require(sharedModulePath))` — **scope is derived, never
   hand-typed**. For each consumer, `shared ∪ private ∪ absent` must equal `exports`
   exactly; any export with no disposition fails with a message naming it (`"git-refs.js
   exports 'X' but ../lib/trunk-drift gives it no disposition"`).
2. `shared` names: consumer source **matches** `/\{[^}]*\bNAME\b[^}]*\}\s*=\s*require\(["']\.\/git-refs["']\)/s`.
3. `private` names: consumer source **doesNotMatch** that same regex **and** does declare it
   locally (`/^\s*(async\s+)?function\s+NAME\s*\(|^\s*const\s+NAME\s*=/m`) — both halves
   required, so deleting the private copy fails just as loudly as importing the shared one.
4. `absent` names: matches neither the destructure nor a local declaration.

Anything deliberately left hand-typed inside this helper gets a dated grandfather comment
with a reason, per `chronology-ordering.test.js`'s `GRANDFATHERED_QUERIES` convention —
never a weakened regex.

**`server/__tests__/git-refs.test.js`** — **NEW.**

*§1 Single-home structural guard (G1 + G2).* Reads
`fs.readFileSync(require.resolve("../lib/update-check"), "utf8")` and the same for
`../lib/trunk-drift`. Exact tests:

- `it("every git-refs.js export has an explicit disposition at every consumer (§9.7)")` →
  the `assertSingleHome(...)` call above.
- `it("update-check.js does NOT import the shared execGit — its private 120s-default copy stays local")` →
  `assert.doesNotMatch(updateCheckSrc, /\{[^}]*\bexecGit\b[^}]*\}\s*=\s*require\(["']\.\/git-refs["']\)/s)`
- `it("update-check.js's git fetch call site keeps its explicit 120_000 timeout (the value production actually reads)")` →
  `assert.match(updateCheckSrc, /"fetch"[\s\S]{0,160}timeout:\s*120_000/)`
  — **Do not** assert on `opts.timeout ?? 120_000`. That default is dead code: all nine
  `execGit` call sites in `update-check.js` pass an explicit `timeout`, including
  `update-check.js:139`'s fetch. An assertion on the default is green whether or not the
  feature works (§9.3 / §9.7's "pin the behavior, not a dead default").
- `it("trunk-drift.js performs no fetch-shaped git operation and never calls execGit with an implicit timeout")` →
  `assert.doesNotMatch(trunkDriftSrc, /["']fetch["']/)`,
  `assert.doesNotMatch(trunkDriftSrc, /allowFetch\s*:\s*true/)`, and a derived loop:
  `trunkDriftSrc.split("execGit(").slice(1)` — every segment's first 300 chars must match
  `/timeout:\s*\d/`.
  *Reconciliation note (read this before writing it):* the brief's instruction reads
  "`doesNotMatch`/absence check on `execGit` … in trunk-drift.js's destructure." Taken
  literally that contradicts the technical plan, which has `trunk-drift.js` deliberately
  import `{ execGit, resolveDefaultBranch }` from `./git-refs` precisely so no third
  private copy is created. The invariant behind the instruction — *`trunk-drift.js` must
  never run a fetch-shaped operation on an implicit default timeout* — is preserved above
  and made stricter (no implicit timeout on **any** call, not just fetch-shaped ones),
  while the `execGit`-must-stay-private `doesNotMatch` is applied where it is actually
  load-bearing: `update-check.js`. If the build decides `trunk-drift.js` should not import
  `execGit` at all, that is a technical-plan change and `assertSingleHome`'s dispositions
  must be edited with it — which is exactly the forcing function §9.7 asks for.
- `it("no Phase-1a caller enables fetch")` → read `trunk-drift.js` **and**
  `server/routes/projects.js`; `assert.doesNotMatch(src, /allowFetch\s*:\s*true/)` for both.

*§2 `resolveDefaultBranch` direct unit cases* (real fixtures; six cases, verbatim from
`unit-tests.md` §2.3 — kept at this layer, not duplicated in `trunk-drift.test.js`):
remote_head with nonstandard name `develop`; remote_ref fallback when no symref;
`candidates: ["trunk"]` honored **and** `{ branch: null, via: null }` without the override
(proves the option is threaded, not decorative); `sole_local_branch` reached even with an
irrelevant remote present; ambiguous local+remote → `{ branch: null, via: null }` and never
`feat-x` by alphabetical accident; never throws.

*§3 Behavior preservation.* No test code — a recorded command:
`node --test server/__tests__/update-check.test.js` green with **zero edits** to that file
(verify with `git diff --stat server/__tests__/update-check.test.js` → empty). Its five
existing `describe` blocks already exercise `pickCanonicalRemote`/`REMOTE_PRIORITY` (fork
case) and `listRemotes`'s empty path (no-remotes case); their continuing to pass **is** the
behavior proof for those two functions.

**`server/__tests__/trunk-drift.test.js`** — **NEW.** Mirror `repo-topology.test.js`
exactly: `fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "trunkdrift-")))`, the
same five stripped `GIT_*` env keys, `execFileSync`, **no `db` module required at all**.
Helpers to add: `makeBareRemote`, `makeWorkingRepo`, `setRemoteHead` (required for every
`via: "remote_head"` case — without it those cases silently degrade to `remote_ref` and
pass for the wrong reason), `commitOn` (with `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE`
override), `mergeNoFF`, `fastForwardMerge`, plus two new ones this plan adds:

- `makeWorktreeBranch(repo, branchName, linkedPath)` — `git worktree add -b <branch>
  <linkedPath>`; **fixture self-check:** assert `git worktree list --porcelain` reports 2
  worktrees before the case proceeds (a worktree fixture that silently degraded to a plain
  branch is §9.3's "fixture in a state no real call site can produce").
- `makeCorruptRepo(parent, name)` — a normal repo with ≥1 commit, then delete the
  *contents* of `.git/objects` (keep the `objects` directory itself, so git's repo
  discovery — and therefore `isGitRepo` — still succeeds while the commit walk cannot).
  **Fixture self-check:** `assert.throws(() => execFileSync("git", ["log", "-1"], { cwd }))`
  and `assert.equal(isGitRepo(cwd), true)` — both required, or the case proves nothing.

Cases: all 14 from `unit-tests.md` §1 (1a/1b/1c/2/2b/2c/3/3b/4/5/5b/6/6b/7/8a-8d) with
their stated exact assertions — **unchanged, adopt as written**; they are the strongest
part of the design (exact diffstat equality, exact windowed count, sha-level `seenShas`
assertion, the positive "is NOT date-sorted" assertion in case 7). Plus these three, new
in this plan:

- **3c (G4) — the worktree flow.** `makeWorktreeBranch(repo, "feature", linked)`; two
  commits made *in the linked worktree*; back in the main repo `git merge --ff-only
  feature`; worktree and branch both still present → `assert.equal(result.commits.length, 0)`
  and `assert.equal(result.skipped, null)`. This is the only case that exercises clause 3
  against the flow clause 3 exists for.
- **3d — the `--no-ff`-then-branch-deleted case** (`risk.md` §3, a *different* mechanism
  from 3/3b: clause 1 alone protects it) → `commits.length === 0`.
- **8e — `git_error`.** `makeCorruptRepo` → `{ skipped: "git_error", repoPath }`, no throw
  (call it with no try/catch; an uncaught throw fails at the framework level, which is the
  correct proof of "never a throw").

*Structural checks co-located in this file* (adopt from `unit-tests.md` §1): no
classification vocabulary (`/\bfold_in\b|\bnew_item\b|\bdeliberate\b|\bdiscard\b/` must not
match the module source — the automated form of the DoD's grep bullet), and no
`require("../db")`/`require("./db")`/`require("better-sqlite3")`.

### Backend — route / integration (`server/__tests__/projects.test.js`, real Express + real git fixtures)

**`server/__tests__/projects.test.js`** — **UPDATE.** One new
`describe("GET /:id/trunk-drift")` block placed immediately after the existing
`describe("GET /:id/repos")` (line ~867), reusing `FS_FIXTURE_ROOT`, `ISOLATED_GIT_ENV`
and `makeFixtureRepo` (line 117) — **no second fixture harness.** Six cases:

- **R1** 404 unknown project → `status === 404`, `body.error.code === "NOT_FOUND"`.
- **R2** project with no mapped folders → `200`, `assert.deepEqual(body.repos, [])`.
- **R3** mapped non-repo folder is filtered out → `200`, `body.repos.length === 1`, and
  `assert.equal("nonRepoFolders" in body, false)` (absent, not `undefined`, not an empty
  array masquerading as data).
- **R4** populated `drift` for a fixture repo with one extra direct-to-trunk commit →
  `drift.skipped === null`, `drift.defaultBranch === "master"`, `pathId` matches the created
  path row, and the commit's `sha`/`subject` read back via `git log` **in the test** (not
  hardcoded) — proving the route calls the real `detectTrunkDrift`, not a stub.
- **R5 (G5) — mixed-state aggregation with an injected failure.** One project mapped to
  **three** repos in one request: healthy-with-direct-commit, `git init`-only (no commits),
  and `makeCorruptRepo`. Assert in the same 200 response: `body.repos.length === 3`; the
  healthy repo's `drift.commits.length === 1` and `drift.skipped === null` (fully populated,
  *not* degraded); the empty repo's `drift.skipped === "no_commits"`; the corrupt repo's
  `drift.skipped === "git_error"`. Also assert every returned `skipped` is `null` or one of
  the four documented reasons — never `undefined`, never a raw `stderr` string.
- **R6** `GET /:id/repos`'s response shape unchanged →
  `assert.deepEqual(Object.keys(res.body).sort(), ["detectedSiblings","ignoredRepos","nonRepoFolders","project_id","repos"].sort())`.
  This case must pass **today, unmodified** — it guards a future accidental widening, it
  does not gate the new route.

**Layer reconciliation — two checks moved, stated explicitly:**
1. `unit-tests.md` §4's "clean (merged) repo vs direct-commit repo don't contaminate each
   other" route case is **removed from the route layer**. The merge/no-merge permutation is
   `trunk-drift.test.js`'s cases 3/3b/3c/3d, where it is proven red by mutation; re-proving
   it over HTTP adds a slower path to the same fact and would be the *only* copy of DEC-5
   logic outside its red-proof.
2. `e2e-tests.md` §4.5's populated-vs-`no_commits` mixed-state case is **folded into R5**
   rather than kept separate — R5 covers it plus the genuine-failure case the strategist
   named as the actual gap (a `skipped` value the detector returns on purpose is not a proof
   about the fan-out loop; a corrupted repo is). Net route layer: 6 cases, one describe
   block, no new harness — the minimum flow proof, exactly as `e2e-tests.md` §1 concluded.

### Backend — logging carve-out (`server/__tests__/reconciliation.test.js`)

**UPDATE, append-only.** Two new `describe` blocks after the existing
`describe("classifyFlaggedDetours")` (line 470). **Zero edits to any existing
`describe`/`it`** in this file or in `reconciliation-full-tick.test.js`.

*Block A — `parseDispositionOutput` (the authorized two-line carve-out, G6).* Adopt
`unit-tests.md` §3's three cases verbatim: terminal-catch logs exactly once and still
returns `size 0`; successful-parse-with-zero-verdicts-for-a-non-empty-batch logs exactly
once and still returns `size 0`; happy path logs **zero** times and returns the same
`size 1` / `disposition: "discard"` result. Spy on both `console.error` and `console.warn`
via `t.mock.method` and assert on the combined count (`reconciliation.js` has zero console
calls today, so there is no existing `log` helper to bind to); once the real call site is
written, tighten to the single method used and delete the other spy.

*Block B — the DEC-4 **scope widening** (G3), new in this plan.* Product-code change:
two more `log()` calls in `classifyFlaggedDetours` (`reconciliation.js:248-263`), at exit 4
(`if (!available)`, line 255) and exit 5 (`if (stdout == null)`, line 261) — ~4 lines total,
logging-only, no control-flow or verdict change. Exit 5 is the load-bearing one:
`focus-inference.js:310`'s `runClaudePromptJson` resolves `null` on spawn error, non-zero
exit, **or** the kill-timer firing, and `focus-inference.js` has no logging either, so a tick
where the CLI is missing/crashes/times out is today indistinguishable from a healthy quiet
tick — the exact condition WATCH-5's live trial must be able to read. The log line goes in
`reconciliation.js`, not `focus-inference.js` (keeps the carve-out inside the one file the
change brief authorizes editing).

Cases (mirror Block A's shape — combined-spy log-call-count + unchanged `result.size`),
driven through the existing `reconciliation.__injectSpawnForTest` seam, which forwards to
`focus-inference.__injectSpawnForTest` and resets `probeCache` on every call:

- **B1 — exit 4, CLI unavailable.** Stub: any spawn → child exits `1`. Then
  `await classifyFlaggedDetours(dbModule, testCwd, [{ id: 1, label: "x" }])` →
  `assert.equal(result.size, 0)` (**unchanged from pre-fix**),
  `assert.equal(calls.length, 1)`, `assert.match(loggedText, /claude cli|unavailable|not available/i)`.
- **B2 — exit 5, CLI answered nothing (the dominant-mode candidate).** Stub dispatches on
  argv: `args[0] === "--version"` → exit `0` (probe available); any other invocation → exit
  `1` with no stdout, so `runClaudePromptJson` resolves `null`. Then →
  `assert.equal(result.size, 0)` (**unchanged**), `assert.equal(calls.length, 1)`,
  `assert.match(loggedText, /no output|returned nothing|null/i)`, and
  `assert.notEqual(loggedTextB2, loggedTextB1)` — the two exits must be **distinguishable in
  the log**, or the trial still can't tell which one dominates, which is the entire point of
  the widening.
- **B3 — exits 1–3 stay silent.** `classifyFlaggedDetours(dbModule, testCwd, [])` (empty
  flagged) → `assert.equal(result.size, 0)`, `assert.equal(calls.length, 0)`. Guards against
  the widening turning every healthy quiet tick into log noise.

Use the `fakeSpawn`-style EventEmitter child from `reconciliation-full-tick.test.js:69-82`
(copy it into this file per this repo's one-helper-per-file convention). Always restore with
`reconciliation.__injectSpawnForTest(null)` in a `finally`.

**Non-test task that must land with this:** `decisions.md`'s DEC-4 row is amended to record
the widened scope (exits 4 and 5, not just `parseDispositionOutput`), and WATCH-5's trial
note records that the instrument now distinguishes CLI-unavailable / CLI-returned-nothing /
CLI-answered-garbage. Without that amendment the build is editing outside the authorized
carve-out.

### Frontend (Vitest + Testing Library)

**`client/src/pages/__tests__/ProjectDetail.test.tsx`** — **UPDATE.** Add
`trunkDriftMock = vi.fn()` to the existing `vi.mock("../../lib/api")` factory under
`api.projects`, with a `{ repos: [] }` default in `beforeEach` so all 15 existing tests pass
unmodified. Four cases, adopt `unit-tests.md` §5 verbatim:

1. Populated card content contract — `trunkDriftMock` called with `"proj-1"`; card title;
   `screen.getByText("abc1234")`; subject; author; diffstat `/\+5.*-1|\+5\/-1/`; default
   branch and lookback window both rendered; **no classification/action surface**:
   `queryByText(/fold_in|new_item|deliberate|discard/i)` is `null` and no button inside
   `within(screen.getByTestId("trunk-drift-card"))` has an accessible name matching
   `/dismiss|resolve|fold|discard|classify/i` (add that `data-testid` to the new card).
2. `skipped: "no_default_branch"` renders the explicit unknown state, and the word "clean"
   (case-insensitive) does **not** appear in that repo's card region.
3. **The load-bearing client guard:** same render with a *second* repo at
   `{ skipped: null, commits: [], commitCount: 0 }` → its empty-state string is distinct,
   and `expect(unknownText).not.toBe(cleanText)`. Case 2 alone is passable by rendering both
   states identically; case 3's `not.toBe` is the actual guard.
4. `trunkDriftMock.mockRejectedValue(new Error("network"))` → page still renders the project
   name and the existing Repos card (independent degradation, per
   `.claude/rules/frontend-react.md`).

**`client/src/i18n/__tests__/i18n.test.ts`** — **UPDATE.** New registry-derived block over
the file's existing `LOCALES = ["en","ko","vi","zh"]` array (line 15) × the card's `KEYS`
(`title`, `description`, `defaultBranch`, `lookbackWindow`, `commitCount`, `empty`,
`unknown` — pinned to what `ProjectDetail.tsx` actually calls, not aspirational): each key
resolves to a non-empty, non-key-echoing string in each locale, plus
`t("projectDetail:trunkDrift.empty") !== t("projectDetail:trunkDrift.unknown")` in `en` —
the client-side echo of the never-guess-clean invariant.

**`client/src/pages/__tests__/screens.snapshot.test.tsx`** — **UPDATE (regenerate, never
blind-update).** Eyeball the diff, confirm it is only the new "Direct-to-trunk work" card,
then `cd client && npx vitest run -u`.

**`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`** — all four in the same commit.

### Fixtures / test data

Reuse `projects.test.js`'s `FS_FIXTURE_ROOT`/`ISOLATED_GIT_ENV`/`makeFixtureRepo` and
`repo-topology.test.js`'s fixture idiom. **Two genuinely new fixture builders**, both with
mandatory self-checks: `makeWorktreeBranch` (assert `git worktree list` shows 2) and
`makeCorruptRepo` (assert `git log` throws **and** `isGitRepo` still returns `true`). No
mocked `child_process` anywhere. No new SQLite fixtures — Phase 1a persists nothing.

## Implementation steps

Each step is independently checkable and stated red-first. Record every red observation in
the commit message (§9.3's acceptance criterion: an unrecorded red state is
indistinguishable from an unperformed one).

1. **Record the scope amendments in `decisions.md`** — DEC-4 widened to exits 4 and 5
   (logging-only, ~4 lines); WATCH-1 amended (or a cross-referencing row added) to cover the
   Phase-1a read-only card, not just Phase 1b's dismissible-queue-row cost model; a DoD line
   for DEC-5 clause 3's own red-proof. *Check:* three rows exist; no code touched yet.
   *(Not a test — but steps 6 and 11 are outside the change brief's authorized scope without it.)*
2. **Write `server/__tests__/helpers/single-home.js` + `git-refs.test.js` §1.**
   *Red:* the whole file fails on `Cannot find module '../lib/git-refs'`.
3. **Write `git-refs.test.js` §2** (the six `resolveDefaultBranch` cases). *Red:* same module
   error. Sanity-check the design against a deliberately naive stub (hardcoded `main`→`master`,
   no `candidates`, no step-4): the nonstandard-name and `candidates`-override rows must fail
   on it while the `main`/`master` happy-path rows still pass — if they don't, the case isn't
   pinning anything.
4. **Extract `server/lib/git-refs.js`; rewire `update-check.js`.** Move `execGit`,
   `listRemotes`, `pickCanonicalRemote`, `REMOTE_PRIORITY` verbatim; add `resolveDefaultBranch`;
   delete `update-check.js`'s private `listRemotes`/`pickCanonicalRemote`/`REMOTE_PRIORITY`;
   **leave its private `execGit` and `resolveCompareRefForRemote` byte-for-byte in place**;
   `module.exports` stays `{ getUpdatesStatus, DEFAULT_ROOT }`. *Green:* `git-refs.test.js`
   §1+§2, and `node --test server/__tests__/update-check.test.js` with `git diff --stat` on
   that spec file empty.
5. **Run the four G1/G2 injection red-proofs and record them** (restore after each; confirm
   byte-identical): **RP-3** add `execGit` to `update-check.js`'s destructure → the
   `doesNotMatch` test fails; **RP-4** delete `{ timeout: 120_000 }` from `update-check.js:139`
   → the fetch-call-site test fails; **RP-5** add an `execGit(repoPath, ["fetch", …])` call with
   no `timeout` to `trunk-drift.js` (after step 7) → the implicit-timeout loop fails; **RP-6**
   add a 5th export to `git-refs.js` → `assertSingleHome` fails naming it.
6. **Write `server/__tests__/trunk-drift.test.js`** — all 14 adopted cases plus 3c, 3d, 8e,
   plus the two structural checks. *Red:* `Cannot find module '../lib/trunk-drift'`.
7. **Implement `server/lib/trunk-drift.js`.** Guard order `isGitRepo` →
   `resolveDefaultBranch` → `rev-parse --verify --quiet`; one bounded `git log`; every failure
   ⇒ `{ skipped: "git_error" }`. *Green:* step 6's file.
8. **Run and record the two DEC-5 mutation red-proofs** (this is the single most load-bearing
   pair in the change): **RP-1** delete `--first-parent` and `--no-merges` from the argv →
   case 3 fails (`commits.length > 0`); **RP-2** delete **only** the
   `--not --exclude=refs/heads/<branch> --branches` tail, leaving `--first-parent --no-merges`
   intact → cases 3b **and** 3c fail (the fast-forwarded commits leak through). Restore, confirm
   byte-identical, re-run green. Both observations go in the commit message.
9. **Add `GET /api/projects/:id/trunk-drift`** beside `GET /:id/repos` (`projects.js:381`),
   with a per-mapped-path `try/catch` in the fan-out loop (mirroring
   `buildProjectRepoTopology`'s pass-1 pattern) — "never throws" is a contract on one
   function, not a property of the loop. Write the R1–R6 block first. *Red:* R1–R5 fail with
   `Cannot GET /api/projects/.../trunk-drift`; **R6 must be green before and after** — if R6
   is red at any point, the sibling route's shape has been widened. *Green after:* all six,
   with R5's corrupt repo reporting `git_error` while the healthy repo stays fully populated.
10. **Client, in this order:** `types.ts` → `api.ts` → `ProjectDetail.tsx` (card +
    `data-testid="trunk-drift-card"`) → `en/projectDetail.json` **only**. Write
    `ProjectDetail.test.tsx` cases 1–4 and the `i18n.test.ts` block first. *Red:* cases 1–3 fail
    at the first assertion (no `trunkDrift` api method, card title never found); the `i18n`
    block's `ko`/`vi`/`zh` iterations fail on the raw dotted key returned by i18next's
    missing-key fallback — **RP-8**, the recorded proof the completeness meta-test works. Then
    fill `ko`/`vi`/`zh` → green.
11. **DEC-4 carve-out + widening.** Write `reconciliation.test.js` Blocks A and B first.
    *Red (RP-7):* Block A's first two cases fail `0 !== 1` on `calls.length` while their
    `result.size` assertions still pass; Block B's B1/B2 fail the same way; Block A's third
    case and B3 pass unchanged both before and after (the behavior-neutrality proof). Then add
    the two `parseDispositionOutput` `log()` calls and the two `classifyFlaggedDetours` ones →
    all six green. *Check:*
    `node --test server/__tests__/reconciliation.test.js server/__tests__/reconciliation-full-tick.test.js`
    green with every pre-existing assertion untouched.
12. **Snapshot:** eyeball the `screens.snapshot.test.tsx` diff (confirm only the new card),
    then `cd client && npx vitest run -u`.
13. **Docs + headers + full suites.** `docs/API.md` (new route), `ARCHITECTURE.md` (new
    derivation module), `server/README.md` (`DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS`),
    `docs/DATABASE.md` (note the Phase-1b schema deferral);
    `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0;
    `npm run test:server` and `npm run test:client` both green.

## Single-source-of-truth guardrail

**Applicable, and it is this plan's central structural requirement.** This change creates a
canonical registry — `server/lib/git-refs.js`'s export surface — consumed by two independent
rendered paths (`update-check.js`'s update banner, `trunk-drift.js`'s new card). Every
structural assertion about that registry must **derive its scope from the artifact**, never
from a hand-typed name list:

- `assertSingleHome` enumerates from `Object.keys(require("../lib/git-refs"))`. Adding a
  fifth export without giving it a disposition at each consumer **must fail the scan** — this
  is §9.7's acceptance criterion, and it is the mechanism that would have caught `execGit`
  being the omitted fourth name in the first place.
- The i18n completeness block iterates the file's existing `LOCALES` array, not a re-typed
  locale list; a fifth locale is covered the day it is added.
- `skipped` reasons: the route-level assertion checks membership in the documented set
  (`not_a_repo`/`no_default_branch`/`no_commits`/`git_error`) rather than spot-checking one
  value, so a new reason invented in the detector without a UI disposition surfaces at the
  contract boundary.
- **Never bless a hand-edited bypass:** if a check cannot be derived, it gets a dated
  grandfather entry with a reason (per `chronology-ordering.test.js`'s `GRANDFATHERED_QUERIES`),
  not a loosened regex. A "green because it only looked at three of four names" scan is worse
  than no scan — §9.3's next-reader-stops-looking failure.

## Durable-cure decision

**Build the structural cure now — `assertSingleHome` ships in this change.** I agree with the
strategist and am not deferring it.

Reasoning: (a) §9.7 is OPEN with four cited occurrences across two days, and its own recorded
recurrence rate is roughly daily; (b) this change is the instance that catalogued it, and it is
the rare moment when the cure's **first real consumer is being created in the same commit** —
a helper written later, against no live consumer, is exactly how hand-scoped scans get written
in the first place; (c) it is ~40 lines of test-only code with zero production risk on a
read-only feature; (d) the point fix alone (adding `execGit` to a hand-typed list) *is the
pattern* — it closes this instance and leaves the next hand-typed list to be short by one; and
(e) it has a cheap, real red-proof (RP-6: add a fifth export, watch the scan fail naming it),
so it does not itself become a vacuous guard.

Consequence of deferring, stated for the record in case the build overrides this call: §9.7
stays OPEN with no cure, the `git-refs.js` registry ships with a scan whose scope is a human's
memory of four names, and the next export added to it is unguarded *and* green.

**Also carried, non-test but required:** the two `decisions.md` amendments in step 1. Three of
this round's five gaps were invariants `risk.md` named that neither test-design doc picked up
(systemic cause D, verbatim from the `practice-kind-override` pass one day ago). The
lightweight process fix — every `risk.md` "required assertion" bullet gets an explicit
picked-up-in-§N or declined-with-reason line in each test-design doc — is a QA-process change,
not a Phase-1a build task; it is noted here so it is a tracked recommendation rather than
prose that evaporates.

## How to run

Commands from `CLAUDE.md` and `package.json` (no `PROJECT-CONTEXT.md` command block; verified
against `coverage.md`'s live baseline run):

```bash
# Server unit / route layer — single spec while iterating
node --test server/__tests__/git-refs.test.js
node --test server/__tests__/trunk-drift.test.js
node --test server/__tests__/projects.test.js
node --test --test-name-pattern="GET /:id/trunk-drift" server/__tests__/projects.test.js
node --test server/__tests__/update-check.test.js       # must be green with ZERO edits
node --test server/__tests__/reconciliation.test.js server/__tests__/reconciliation-full-tick.test.js

# Client layer
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx
cd client && npx vitest run src/i18n/__tests__/i18n.test.ts
cd client && npx vitest run -u        # snapshot regen — ONLY after eyeballing the diff

# Full gates
npm run test:server                   # baseline to beat: 332 suites / 1370 pass / 0 fail
npm run test:client                   # baseline to beat: 59 files / 718 pass / 0 fail
bash .claude/skills/file-headers/scripts/check-headers.sh    # must exit 0
```

## Definition of Done

**Red-proofs — each observed, then restored, then re-run green, with the observation recorded
in the commit message:**

- [ ] **RP-1 (DEC-5 case 3):** removing `--first-parent` and `--no-merges` from the `git log`
      argv makes `trunk-drift.test.js` case 3 fail (`commits.length > 0`).
- [ ] **RP-2 (DEC-5 case 3b, clause 3):** removing **only** the
      `--not --exclude=refs/heads/<branch> --branches` tail makes cases 3b **and** 3c fail.
- [ ] **RP-3:** adding `execGit` to `update-check.js`'s `require("./git-refs")` destructure
      fails the `doesNotMatch` test.
- [ ] **RP-4:** deleting `{ timeout: 120_000 }` from `update-check.js:139` fails the
      fetch-call-site test.
- [ ] **RP-5:** an `execGit(..., ["fetch", …])` call with no explicit `timeout` in
      `trunk-drift.js` fails the implicit-timeout scan.
- [ ] **RP-6:** a 5th export added to `git-refs.js` fails `assertSingleHome`, naming it.
- [ ] **RP-7:** against pre-fix `reconciliation.js`, all four log-count assertions fail
      `0 !== 1` (Block A cases 1–2, Block B cases B1–B2) while their `result.size` assertions
      still pass; Block A case 3 and B3 pass identically before and after.
- [ ] **RP-8:** with only `en/projectDetail.json` filled, the `ko`/`vi`/`zh` iterations of the
      i18n block fail on the raw dotted key.
- [ ] **RP-9 (fixture self-check):** `makeCorruptRepo` asserts `git log` throws **and**
      `isGitRepo` returns `true`.
- [ ] **RP-10 (fixture self-check):** `makeWorktreeBranch` asserts `git worktree list` reports
      2 worktrees.

**Coverage delivered:**

- [ ] `server/__tests__/helpers/single-home.js` exists; scope derived from
      `Object.keys(require("../lib/git-refs"))`; every export has a `shared`/`private`/`absent`
      disposition at both consumers.
- [ ] `server/__tests__/git-refs.test.js` exists with §1 (single-home + G1's three assertions +
      no-fetch) and §2 (six `resolveDefaultBranch` cases).
- [ ] `server/__tests__/trunk-drift.test.js` covers all §6.1 cases **plus 3c (worktree), 3d
      (`--no-ff`+deleted), 8e (`git_error`)**, plus the no-classification-vocabulary and
      no-SQLite structural checks.
- [ ] `server/__tests__/projects.test.js` has cases R1–R6, including **R5's three-repo
      injected-failure isolation** in one 200 response.
- [ ] `server/__tests__/reconciliation.test.js` has Block A (3 cases) **and Block B (B1/B2/B3,
      the DEC-4 widening to exits 4 and 5)**; B1's and B2's log texts are asserted distinct.
- [ ] `ProjectDetail.test.tsx` cases 1–4, including case 3's `not.toBe(cleanText)`.
- [ ] `i18n.test.ts` registry-derived `trunkDrift.*` block over `LOCALES`, plus
      `empty !== unknown` in `en`.

**Behavior preservation:**

- [ ] `git diff --stat server/__tests__/update-check.test.js` is **empty** and that spec is green.
- [ ] `reconciliation.test.js`'s and `reconciliation-full-tick.test.js`'s pre-existing
      `describe`/`it` blocks are unedited and green (`git diff` on those files shows only
      appended blocks).
- [ ] R6 (`GET /:id/repos` key set) green before **and** after the new route lands.

**Source-of-truth / suite gates:**

- [ ] All four `projectDetail.json` locales updated in the same commit; snapshot diff eyeballed
      (only the new card) before `npx vitest run -u`.
- [ ] `npm run test:server` green (≥ 1370 pass, 0 fail); `npm run test:client` green
      (≥ 718 pass, 0 fail).
- [ ] `bash .claude/skills/file-headers/scripts/check-headers.sh` exits 0.
- [ ] `grep -rn "assert.ok(true" server/__tests__/` and `grep -rn "|| true" server/__tests__/`
      both return 0 (§9.3 sweep).
- [ ] `server/lib/trunk-drift.js` contains no `fold_in`/`new_item`/`deliberate`/`discard`
      (now automated, not a manual grep).
- [ ] `decisions.md` carries the DEC-4 widened-scope amendment, the WATCH-1 Phase-1a
      card-framing amendment, and the DEC-5 clause-3 red-proof DoD line.
- [ ] Docs updated: `docs/API.md`, `ARCHITECTURE.md`, `server/README.md`, `docs/DATABASE.md`
      (deferral note).
