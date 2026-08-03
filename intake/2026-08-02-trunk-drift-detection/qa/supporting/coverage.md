# Coverage Map — trunk-drift-detection (Phase 1a)

> Coverage Cartographer pass. Maps *existing* coverage for the surfaces this
> Phase-1a change touches, before any code lands. No new tests were designed
> or written here — see the technical plan (§4/§6) for what's specified to be
> built. Scope matches `qa/change-brief.md`: Phase 1a only.

## Test stack (discovered)

This project has two runnable server-side "layers" plus one client layer,
per `package.json` and observed test files — no separate e2e layer today:

- **Server unit/integration** — Node's built-in `node:test` + `node:assert/strict`.
  Real SQLite (via `server/db.js`, `DASHBOARD_DB_PATH` pointed at a tmp file)
  and, for git-derivation modules, **real throwaway git repos** built with
  `execFileSync` under `fs.realpathSync(os.tmpdir())` — never mocked
  `child_process`. Run: `npm run test:server` (= `node --test
  server/__tests__/*.test.js`), or a single file with `node --test
  server/__tests__/<file>.test.js`. No project/tag bucketing (smoke vs.
  regression) — one flat `server/__tests__/*.test.js` glob, 78 files.
- **Client unit/component** — Vitest + Testing Library. Run: `npm run
  test:client` (= `cd client && npm test` = `vitest run`), or scoped with
  `cd client && npx vitest run <path>`. Includes a dedicated per-screen
  render-snapshot suite, `client/src/pages/__tests__/screens.snapshot.test.tsx`,
  which is the one place a new page-level card shows up as a diff even if no
  other test asserts on it directly.
- **No separate e2e/API-integration layer** — the "integration" tier is
  folded into the server `node:test` suite itself: route tests in
  `server/__tests__/projects.test.js` spin up the real Express app
  (`createApp`) and hit it over real HTTP (see `reconciliation-full-tick.test.js`'s
  `fetch()` helper, same pattern), rather than living in a separate
  supertest/e2e directory.

## 1–2. Existing coverage by surface, with verdict

### Surface: `server/lib/repo-topology.js` (precedent only — not itself changed this phase)

Cited by the change brief as the real-git-fixture pattern `trunk-drift.test.js`
must mirror, and `trunk-drift.js` imports `isGitRepo` from it directly.

- **Server unit:** `server/__tests__/repo-topology.test.js` (410 lines) — real
  `git init` fixtures under `fs.realpathSync(os.tmpdir())`, isolated git env
  (`GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY`/
  `GIT_ALTERNATE_OBJECT_DIRECTORIES` stripped), a `makeDbModule()` fake of
  just `{ stmts.listProjectPaths, stmts.listIgnoredRepos }`, no mocked
  `child_process`. Covers `isGitRepo`, `listGitWorktrees`,
  `checkWorktreeDirty` (including its `null`-on-uncertainty contract — the
  exact contract `trunk-drift.js`'s `skipped` reasons are asked to extend),
  `findDetectedSiblings`, `findSiblingReposOnDisk`, `findNestedReposOnDisk`,
  `buildProjectRepoTopology`.
- **Verdict: GUARDED.** `isGitRepo` (the one function `trunk-drift.js`
  imports from this module) is directly exercised. Since this file is not
  being edited in Phase 1a, no regression risk here beyond "does the new
  consumer import correctly," which is `trunk-drift.test.js`'s job, not
  this file's.

### Surface: `server/lib/update-check.js` / new `server/lib/git-refs.js` extraction

- **Server unit:** `server/__tests__/update-check.test.js` (192 lines) — 5
  scenarios, each a real bare-remote + working-clone git fixture (isolated
  env, same stripped-key list): local-on-canonical (`tracks_canonical:
  true`, suggests `git pull --ff-only`), local-on-a-feature-branch (must NOT
  suggest `git pull`), fork layout (`upstream` preferred over `origin`,
  fetch+merge command), detached HEAD, no-remotes-configured. All run with
  `skipFetch: true` (offline). This suite **exercises `pickCanonicalRemote`,
  `listRemotes`, and `REMOTE_PRIORITY` indirectly** (through
  `getUpdatesStatus`'s canonical-remote selection) but has **zero direct
  unit tests of those three functions in isolation** — every assertion is on
  `getUpdatesStatus`'s composed output.
- **git-refs.js (does not exist yet):** no test file exists — confirmed by
  `find server/__tests__ -iname "*git-refs*"` returning nothing.
- **Baseline observed:** ran `node --test server/__tests__/update-check.test.js`
  directly — **29/29 suites, 95/95 tests pass** (run together with the other
  4 targeted files below; isolated single-file run also green). This is the
  exact check the plan's Step 1 requires ("zero edits to that file, green")
  — it is green **today, pre-refactor**, which is the correct baseline to
  diff the post-extraction run against.
- **Verdict: PARTIAL today, becomes the load-bearing regression check
  post-refactor.** `update-check.test.js` is real coverage of
  `getUpdatesStatus`'s observable behavior across all 5 branch/remote
  situations — good breadth. But because it never imports/calls
  `pickCanonicalRemote`/`listRemotes`/`REMOTE_PRIORITY` directly, it proves
  "the composed function behaves right" without pinpointing *why* if a
  future edit to the extracted `git-refs.js` internals breaks one case —
  acceptable per the plan's own framing (`update-check.test.js` green
  **unmodified** is explicitly the proof required), but worth noting for
  the architects: nothing here separately unit-tests `resolveDefaultBranch`
  (the *new* function) against `update-check.js`'s own resolution needs —
  that new coverage has to come from `trunk-drift.test.js` and/or a new
  `git-refs.test.js`, neither of which exists yet.

### Surface: new `server/lib/git-refs.js` (`resolveDefaultBranch`, `execGit`, `listRemotes`, `pickCanonicalRemote`)

- **No test file exists** — module itself does not exist yet.
- **Verdict: UNGUARDED.** This is the single home for "what is trunk,"
  named in the change brief's own Variant-relevance §1 as directly relevant
  to this project's #1 recurring defect class (cross-consumer value
  consistency, catalog §9.1). Per the technical plan, its coverage is
  intended to come from two places: (a) `trunk-drift.test.js`'s cases
  1a–2c (default-branch resolution across `main`/`master`/nonstandard names,
  with/without a remote — §6.1), and (b) `update-check.test.js` passing
  **unmodified** as the cross-consumer proof. Until `trunk-drift.js` and
  `git-refs.js` are built and those tests written, there is no direct test
  of `resolveDefaultBranch` at all.

### Surface: new `server/lib/trunk-drift.js` (`detectTrunkDrift`)

- **No test file exists** (`server/__tests__/trunk-drift.test.js` does not
  exist — confirmed).
- **Verdict: UNGUARDED.** Wholly new surface, wholly new detector, the
  actual ask of this phase. The technical plan's §6.1 table enumerates 14
  required cases (1a/1b/1c/2/2b/2c/3/3b/4/5/5b/6/6b/7/8) including the
  load-bearing false-positive guard (case 3/3b) and the git-DAG-vs-
  `created_at` ordering distinction (case 7, this project's §9.2
  row-id/ordering discipline applied to a non-DB, git-native context) —
  none of these exist as code yet, so none are "already covered." Flagging
  for the architects: case 3's own red-proof (remove `--first-parent`/
  `--no-merges`, confirm it fails) is stated as mandatory in both the change
  brief and the DoD — this is the one case where "GUARDED" cannot be
  claimed by a green run alone; the red observation must be recorded.

### Surface: `server/routes/projects.js` — new `GET /:id/trunk-drift`, existing `GET /:id/repos` (must stay unchanged)

- **Server route tests:** `server/__tests__/projects.test.js` (1053 lines),
  `describe("GET /:id/repos", ...)` at line 867 — three cases: 404 on
  unknown project id, `{ repos: [], nonRepoFolders: [], detectedSiblings: [] }`
  on a project with no mapped folders, and a populated case using a real
  fixture repo (`makeFixtureRepo`, same isolated-git-env real-repo pattern
  as `repo-topology.test.js`) asserting `res.body.repos[0].cwd`,
  `.worktrees.length`, `.worktrees[0].dirty === false`. `/:id/repos` is also
  exercised incidentally by the `POST /:id/continue-worktree` tests (lines
  775, 819, 849), which read a live worktree path back out of a real
  `/repos` call rather than hand-typing one.
- **New `GET /:id/trunk-drift` route:** does not exist yet — no test exists.
- **Verdict:**
  - `GET /:id/repos`'s current response shape — **GUARDED.** Line 879
    (`assert.deepEqual(res.body.repos, [])`) and lines 896–899 pin the exact
    shape (`{ project_id, repos, nonRepoFolders, detectedSiblings,
    ignoredRepos }` per the route's own composition at line 381–388) that
    `.claude/rules/backend-node.md` and this plan both require stay
    unchanged when the sibling route is added. A regression that widened or
    narrowed this shape would be caught here today.
  - `GET /:id/trunk-drift` — **UNGUARDED.** Route does not exist. The plan's
    own required case list (404 on unknown project, `{ repos: [] }` on no
    repo paths, populated `drift` for a fixture repo with a
    direct-to-trunk commit) mirrors the `/:id/repos` precedent above line
    for line — good news for the architects: the fixture/harness code for
    the third case (a real repo with a direct-to-trunk commit) can be built
    by extending `makeFixtureRepo` with one more commit, not by inventing a
    new harness.

### Surface: `server/lib/reconciliation.js` — `parseDispositionOutput`'s silent-catch path (DEC-4 carve-out, the one Phase-1b-adjacent edit in scope)

- **Server unit/integration:**
  - `server/__tests__/reconciliation.test.js` (532 lines) — `describe("classifyFlaggedDetours", ...)`
    at line 470. Two cases: (a) calling `classifyFlaggedDetours` with an
    **empty** `flagged` array — returns early (`if (!flagged || flagged.length
    === 0) return new Map();`, line ~248) **before ever reaching
    `parseDispositionOutput`**; (b) the "hybrid-escalation-non-inversion"
    invariant, asserting a rogue spawn injected via `__injectSpawnForTest`
    is never called when nothing is flagged — again an early-return path
    that never reaches parse logic.
  - `server/__tests__/reconciliation-full-tick.test.js` (805 lines) —
    Scenarios A/B/C exercise `classifyFlaggedDetours` end-to-end with a
    **stubbed spawn** returning well-formed JSON (`envelope(llmOutput)`,
    lines 183/288/371/506/771) — this covers `parseDispositionOutput`'s
    **happy path** (valid envelope, valid JSON body) thoroughly, including
    the cross-call-site byte-parity assertion (Scenario C, the catalog
    §9.1 acceptance criterion for this surface).
  - **Neither file ever feeds `parseDispositionOutput` malformed/
    unparseable stdout.** Grep for `malformed`, `unparseable`, and every
    `envelope(...)` call site in `reconciliation-full-tick.test.js` — all
    five construct well-formed JSON. `parseDispositionOutput` is exported
    (`module.exports` line 468) but no test file imports and calls it
    directly, and no test constructs a stub spawn whose stdout is not valid
    JSON.
- **Verdict: UNGUARDED for exactly the code path being touched.** The
  catch-block this change adds two `log()` calls to (line ~237,
  `catch { return new Map(); }`) is **not exercised by any existing test
  today** — confirmed by the change brief's own framing ("confirmed by
  direct read... is silent today") and by this pass's grep sweep finding no
  malformed-stdout fixture anywhere in either reconciliation test file. The
  zero-verdicts-for-a-non-empty-batch log point (`out.size === 0 &&
  flagged.length > 0`) is similarly unexercised — every existing
  well-formed-envelope test produces at least one verdict when `flagged` is
  non-empty. Since the plan states this is a "zero behavioral/verdict
  change" edit, the DoD's own bar (`reconciliation.test.js` green,
  **unmodified**) is achievable without new coverage — but that only proves
  *the parse path that already worked still works*, not that the two new
  `log()` calls actually fire on the malformed/zero-verdict paths they're
  meant to instrument. A test asserting the log call happens (e.g. spy/stub
  `log`, feed malformed stdout via a rogue spawn, assert the message) does
  not exist and is not required by the plan's own DoD language, but is the
  one place this "logging-only" edit could ship silently inert.
- **Baseline observed:** `node --test server/__tests__/reconciliation.test.js
  server/__tests__/reconciliation-full-tick.test.js` (run together with the
  3 other targeted files) — **green**, part of the 95/95 combined result
  below.

### Surface: `client/src/pages/ProjectDetail.tsx` — new "Direct-to-trunk work" card

- **Client component tests:** `client/src/pages/__tests__/ProjectDetail.test.tsx`
  (593 lines, 15 tests) — covers the existing Repos card precedent this new
  card is asked to follow: not-found state, repos-with-worktrees rendering,
  non-repo folders, suggested siblings + intake initiatives, the
  sibling-scan toggle, the per-folder terminal-default toggle, empty-state
  messaging, expand/collapse, Compact-vs-Full view mode gating
  Remove/Add/Ignore actions, remove-needs-second-click, Continue-button
  success/error feedback, ignore/unignore suggestion flows, add-suggestion
  flows (including from inside the scan popup), and the plan-empty/
  intake-empty states. All exercise `api.projects.repos` via mocks of
  `client/src/lib/api.ts`.
  - `client/src/pages/__tests__/screens.snapshot.test.tsx` — per-screen
    render snapshot; will change once the new card is added (confirmed:
    grep for `trunk` across `types.ts`/`api.ts`/`ProjectDetail.tsx`/docs
    returns nothing today, so the snapshot has no trunk-drift content to
    diverge from yet).
- **`client/src/lib/types.ts` / `client/src/lib/api.ts`:** `ProjectRepoTopology`
  (types.ts:1794) and `api.projects.repos` (api.ts, doc-commented, calls
  `GET /projects/:id/repos`) are the direct precedent the plan cites for
  `TrunkDriftResult`/`ProjectTrunkDriftResponse` and
  `api.projects.trunkDrift`. Neither the new types nor the new API method
  exist yet — no `trunk` string appears in either file.
- **Verdict: UNGUARDED.** Wholly new card, wholly new client surface. No
  test references trunk-drift in any form. The `skipped`-renders-as-
  "unknown"-never-"clean" requirement (mirroring `checkWorktreeDirty`'s
  `null`-on-uncertainty contract, already tested for worktree dirtiness at
  the repo-topology layer per ProjectDetail.test.tsx's existing worktree
  rendering assertions) has no analog yet for trunk-drift `skipped` reasons.
  The four-locale requirement (`en`/`ko`/`vi`/`zh` `projectDetail.json`) is
  a manual/visual convention in this codebase — no automated test currently
  asserts all four locale files carry the same key set for
  `projectDetail.json` (confirmed: no i18n-key-parity test file found under
  `client/src/i18n/__tests__/` beyond `i18n.test.ts`, which is a general
  i18n-config test, not a per-namespace key-parity scan). This is the
  concrete mechanism by which the brief's own "silently falls back to a raw
  i18n key in one locale" failure mode could ship undetected by any
  existing automated guard — worth flagging to the architects as a possible
  new assertion (diff the key sets of all four `projectDetail.json` files),
  not just a manual review step.

## 3. Registry/consistency gap check (catalog §9.1 DERIVED-DUAL-VIEW)

The change brief and technical plan both directly engage this project's
canonical-source convention (`PROJECT-CONTEXT.md` §9.1) for two candidate
variants, and PROJECT-CONTEXT.md itself carries a **pre-flag entry already
retracted** for a third:

1. **Default-branch resolution (`git-refs.resolveDefaultBranch`), shared by
   `trunk-drift.js` and `update-check.js`.** This is the one registry-style
   entry that applies: one function, two consumers, both required to agree.
   Per this pass's own audit above, `update-check.test.js` exercises the
   *composed* behavior of the existing consumer without asserting on the
   soon-to-be-shared primitives directly — so today there is no test that
   would catch `git-refs.js` and a hypothetical second hand-rolled copy
   diverging, because neither the shared module nor the second consumer
   exists yet. Once built, the coverage gap check is exactly the plan's own
   Step 1 requirement: **an entry in this "registry" (the set of
   `git-refs.js` exports) with no corresponding assertion is UNGUARDED even
   if the whole suite is green** — concretely, if `trunk-drift.js` ends up
   with a second private copy of `pickCanonicalRemote`/`listRemotes`
   instead of importing from `git-refs.js`, no test in this repo today
   would fail, because no test asserts on the *import graph*, only on
   behavior. Recommend the architects add a structural check (grep-shaped,
   matching this repo's own `single-writer-guard.test.js`/
   `chronology-ordering.test.js` precedent for "assert the single-home rule
   by static scan, not just by testing outputs") — the change brief already
   flags this as directly relevant but the technical plan does not name a
   specific structural test for it, only the two behavioral proofs
   (`trunk-drift.test.js` cases + `update-check.test.js` unmodified-green).
2. **PROJECT-CONTEXT.md §9.1's pre-flag on this exact intake was
   RETRACTED** (see PROJECT-CONTEXT.md, "Pre-flag RETRACTED on closer read
   (2026-08-02, `intake/2026-08-02-trunk-drift-detection/`") — the
   candidate third `detour_dispositions.label` composer does not apply
   §9.1's "single value multiple sites should agree on" criterion, per the
   architect's read (concurred by PM). **Not** an open gap for this pass;
   noted here only so the next reader doesn't re-flag it. It is also Phase
   1b scope regardless (label composers don't exist in Phase 1a).
3. **§9.6 NON-ATOMIC REBUILD is Phase 1b only** — the `detour_dispositions.source`
   CHECK widening this entry names is explicitly out of scope for this QA
   pass per the change brief's scope boundary. Not evaluated here.

No other named catalog entry (§9.2 row-id-as-chronology-proxy, §9.4
FIX-ROUND-REGRESSION, §9.5 FRESH-DB-BLIND SCHEMA CHANGE) applies to Phase 1a's
changed-files list: no schema edit, no `events`/chronology query, and this
isn't a fix round.

## 4. Baseline — actually run

All commands run from `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`
on 2026-08-02, against the pre-change working tree (`trunk-drift.js`,
`git-refs.js` do not exist; no client trunk-drift code exists).

**Targeted run — the 5 files this change touches or whose behavior must stay
provably unchanged:**

```
node --test server/__tests__/update-check.test.js \
             server/__tests__/repo-topology.test.js \
             server/__tests__/reconciliation.test.js \
             server/__tests__/reconciliation-full-tick.test.js \
             server/__tests__/projects.test.js
```
Result: **29 suites, 95 tests — 95 pass, 0 fail.**

**Full server suite** (`npm run test:server` = `node --test
server/__tests__/*.test.js`, 78 files):

Result: **332 suites, 1370 tests — 1370 pass, 0 fail.** Duration ~37s.

**Full client suite** (`npm run test:client` = `cd client && vitest run`):

Result: **59 files, 718 tests — 718 pass, 0 fail.** Includes
`ProjectDetail.test.tsx` (15/15 pass, also run in isolation) and
`screens.snapshot.test.tsx`.

No suite was skipped or estimated — every number above is from a real run in
this environment, no external service dependency (no Claude CLI required
since `classifyFlaggedDetours`'s tests either short-circuit on empty
`flagged` or stub the spawn). **Current baseline: fully green, both layers.**
This is the correct pre-change baseline to diff against once
`git-refs.js`/`trunk-drift.js` land — any of these 5 server files or either
client suite going red after the change (without an intentional, reviewed
edit to the test itself) is a regression, not a rebase artifact.

## 5. Conventions in play — where new tests should live

- **`server/__tests__/trunk-drift.test.js`** (new file) — same directory,
  same `describe`/`it` + `node:test`/`node:assert/strict` shape as
  `repo-topology.test.js` and `update-check.test.js`: real git fixtures
  under `fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "<prefix>-")))`,
  the same `ISOLATED_GIT_ENV` stripped-key list (copy-pasted verbatim in
  every existing fixture-based suite in this repo — not centralized into a
  shared test helper today, which is itself a minor duplication worth
  noting but out of this pass's scope to fix), `execFileSync` for setup,
  never mocked `child_process`.
- **`server/__tests__/projects.test.js`** — add the new `GET
  /:id/trunk-drift` cases as a new `describe("GET /:id/trunk-drift", ...)`
  block placed beside the existing `describe("GET /:id/repos", ...)` (line
  867), reusing `FS_FIXTURE_ROOT`/`makeFixtureRepo` already defined at the
  top of the file — do not build a second fixture harness.
- **`server/lib/reconciliation.js`'s two new `log()` calls** — no new test
  file needed per the plan's own DoD (unmodified-green is the bar), but if
  the architects want the logging itself proven live (recommended, see §2
  above), it belongs in the existing `describe("classifyFlaggedDetours",
  ...)` block in `reconciliation.test.js` (line 470), following the
  existing `__injectSpawnForTest` stub pattern already used in that file
  and in `reconciliation-full-tick.test.js`.
- **Client:** `client/src/pages/__tests__/ProjectDetail.test.tsx` — add the
  new card's cases beside the existing Repos-card `it(...)` blocks (the
  file has no nested `describe` per card, just one flat `describe("ProjectDetail
  page", ...)` with many `it`s — follow that flat shape, not a new nested
  `describe`). `client/src/pages/__tests__/screens.snapshot.test.tsx` will
  need its snapshot regenerated (`cd client && npx vitest run -u`) **only
  after** eyeballing the diff, per CLAUDE.md and the plan's own Step 5 —
  this pass did not regenerate it since no code changed yet.
- **i18n:** all four `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`
  files edited in the same commit — this repo has no automated key-parity
  test today (see §2 gap above); the current convention is manual
  same-change discipline only, enforced by `.claude/rules/docs-markdown.md`
  and reviewer attention, not by a test.
