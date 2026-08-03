# E2E / API-Contract Test Plan — trunk-drift-detection (Phase 1a only)

> Authored by `qa-e2e-architect`. Scope-locked to **Phase 1a** per
> `qa/change-brief.md`'s scope boundary — no `detour_dispositions` write path,
> no `db-rebuild.js`, no periodic tick, nothing from Phase 1b is in play here.

## 0. Tooling grounding (confirmed against live code, not assumed)

This repo has **no separate e2e framework** — no Cypress, no Playwright, no
tagged smoke/regression suite, no bucket config file. Confirmed:

- `package.json`: `"test:server": "node --test server/__tests__/*.test.js"` —
  a single flat glob over `node:test` spec files. No `test:e2e` script, no
  `--grep`/tag flag, nothing client-side either (`client/package.json`'s
  `test` script is Vitest against `client/src/**/__tests__`, no browser
  automation runner).
- `PROJECT-CONTEXT.md` has no bucket/tag scheme to discover — its only
  mentions of "e2e" are prose references to *this same doc's own name* from
  prior intakes (`grep -n -i "e2e" PROJECT-CONTEXT.md` → line 67, a QA note
  about a different change's coverage gap, not a framework pointer).
- This project's own established substitute for an "e2e" tier — confirmed by
  reading three prior QA passes' `e2e-tests.md`
  (`intake/2026-08-01-build-project-manager/`,
  `intake/2026-08-02-practice-kind-override/`) plus the actual spec files
  they point at — is: **a real Express server on an OS-assigned port
  (`createApp()` + `startServer(app, 0)`), driven with a hand-rolled
  `http.request` helper (no supertest), against real on-disk fixtures**
  (real temp SQLite file and/or real `git init` repos), living as a
  `describe` block **inside the relevant route's existing spec file** —
  not a dedicated "e2e" directory or file-name convention.
- `server/__tests__/projects.test.js` is exactly this shape already, and is
  the file both `qa/change-brief.md` and `technical-plan.md` §4 Step 4 name
  as the home for this change's route test. Its own header comment (line
  96-98) states the precedent directly: *"`GET /:id/repos` and `GET /:id/intake`
  do real filesystem/git work... so they need an actual tmp dir with real
  repos in it"* — confirmed by reading `FS_FIXTURE_ROOT`/`makeFixtureRepo`
  (lines 99-136) and the existing `describe("GET /:id/repos")` block (lines
  867-903), which is the direct sibling this change's route sits next to
  (`projects.js` places `GET /:id/trunk-drift` beside `GET /:id/repos` at
  line ~381, per the technical plan).

**Conclusion for "bucket"/"tag":** as with the prior two intakes' e2e passes,
this project's only bucketing unit is *the spec file itself*, and isolation
(unique `DASHBOARD_DB_PATH` per file, unique `FS_FIXTURE_ROOT` tmp dir) is
what makes tests parallel-safe by construction, not a serial/tag flag. No
tagging mechanism should be invented for this effort.

---

## 1. Does this change need a dedicated e2e/API-integration layer beyond the
route-level test already in scope? **No — and here is the reasoning, not an
assumption.**

Phase 1a's actual risk profile, cross-checked against `qa/change-brief.md`'s
own "Test-invariants at risk" section:

- **No write, no persistence, no round trip to prove.** Every write-then-
  reread flow this project's e2e-shaped tests exist to catch (the
  `reconciliation-full-tick.test.js` write-back-to-disk-and-reingest chain,
  the `playbook.test.js` override-round-trip-through-a-live-tick) is
  structurally about proving *"what got written is what comes back."*
  `detectTrunkDrift` writes nothing, reads no SQLite, caches nothing — the
  change brief's own words, confirmed against the technical plan's return
  shape (§3.1: `skipped: null` or one of four `skipped` reasons, never a
  DB row). There is no round trip to prove because there is no persistence
  step in the loop.
- **No cross-module wiring gap the unit layer can't already see.** The one
  named cross-consumer risk (`git-refs.js`'s `resolveDefaultBranch` shared
  by `trunk-drift.js` and `update-check.js`) is a **structural**
  single-home guarantee, not a runtime-behavior one: both consumers call
  the *same function*, so if `update-check.test.js` passes unmodified
  (proving `update-check.js`'s behavior is unchanged) and
  `trunk-drift.test.js` proves `resolveDefaultBranch`'s own resolution
  order against real fixtures (technical plan §6.1, cases 1a-2c), there is
  no additional fact a live-server round trip through *both* routes in the
  same test would add — it would just re-exercise the same shared function
  twice through two more HTTP hops, at real cost, for zero new confidence.
  (Contrast with `practice-kind-override`'s e2e pass, which *did* need a
  live round trip, because that change's risk was specifically about
  values surviving through storage and a second read — a persistence
  question this change does not have.)
- **No auth, no external service, no multi-tenant/session state.** Nothing
  in this route depends on request context beyond `:id` — no session
  cookie, no account scoping beyond the existing project-lookup 404, no
  outbound HTTP call (the git walk is local-only, confirmed: no `git
  fetch` unless `allowFetch === true`, which no Phase 1a caller passes).
- **The client side has no round trip to prove either.** The card is a pure
  read/render of `GET .../trunk-drift`'s response — no form submission, no
  follow-up write, no navigation flow. `ProjectDetail.test.tsx`
  (component-level, mocked `api.projects.trunkDrift`) and
  `screens.snapshot.test.tsx` (render-level) are the correct and sufficient
  owners of "does the card render the four states (`populated`,
  `skipped`-as-unknown-not-clean, all-locales, no-badge/no-action)" — a
  real-server-plus-real-browser round trip would only prove the fetch
  wiring works, which the already-planned `api.ts` unit coverage plus the
  component test's mocked-response shape already covers without a server.

The one genuinely "wired flow" fact worth proving through a **real** server
(not mocked route handler, not mocked git) is the route's **aggregation
contract** — that `GET /:id/trunk-drift` correctly loops
`stmts.listProjectPaths`, skips non-repos, calls `detectTrunkDrift` per
mapped path, and assembles `{ repos: [{ cwd, pathId, drift }] }` for a
**multi-repo** project where the repos land in *different* `drift` states
at once (one populated, one `skipped`). That is exactly the shape of test
this project's convention already puts in `projects.test.js`'s
`describe("GET /:id/repos")` sibling block — which `technical-plan.md` §4
Step 4 already directs into that same file. **This is the plan's existing
route-level test, not a new layer.** Per this task's own framing ("prefer
[a contract check] over a full UI flow when the risk is contract/persistence,
not UI") — the risk here actually is neither: it is a pure read contract
with zero persistence, so the *thin* API-contract case already in scope is
correctly sized, and there is nothing to add above it.

**Verdict: no dedicated e2e spec, bucket, or tag is warranted for this
change.** The minimum-sufficient coverage is the API-contract case already
named in `technical-plan.md` §4 Step 4, landed in the existing
`server/__tests__/projects.test.js` file, immediately following the
`describe("GET /:id/repos")` block it is modeled on. This document's
remaining sections specify that case precisely (naming two assertions the
technical plan's one-line description doesn't spell out) so the build has a
concrete spec, not a vague pointer — not to invent a second layer of
coverage on top of it.

---

## 2. Spec file

| # | Spec file | New/extend | Bucket rationale |
|---|---|---|---|
| 1 | `server/__tests__/projects.test.js` | **extend** — new `describe("GET /:id/trunk-drift")` block, immediately after the existing `describe("GET /:id/repos")` block (line ~903) | This is the file `technical-plan.md` §4 Step 4 already names, and the file that already owns every other real-git-fixture route test in this router (`GET /:id/repos`, `GET /:id/intake`, sibling-scan toggle). Reuses the file's existing `FS_FIXTURE_ROOT`/`ISOLATED_GIT_ENV`/`makeFixtureRepo` fixture machinery — no new fixture harness needed. |

No second spec file. `server/__tests__/trunk-drift.test.js` (also new, per
the technical plan) is the **unit** layer's file — real git fixtures calling
`detectTrunkDrift(repoPath, opts)` directly, no HTTP, no Express — and stays
out of this document's scope per this task's framing (this layer proves the
wired-up flow, not the permutation matrix; §6.1's 14 cases belong to the
unit-tests pass).

No spec needs a serial bucket: the new block runs inside the same file,
same process, same `before`/`after` server lifecycle as every other
`describe` block in `projects.test.js` already does — no shared external
resource, no port conflict (OS-assigned), no DB path conflict (one
`TEST_DB` for the whole file, already how the file's other ~10 `describe`
blocks coexist).

---

## 3. Tag

None — this project has no smoke/regression/serial tag mechanism (see §0).
The new block is picked up automatically by `test:server`'s
`server/__tests__/*.test.js` glob the moment it exists; no registration
step, no annotation.

---

## 4. Assertions

New `describe("GET /:id/trunk-drift")` block, using `makeFixtureRepo` and a
new small helper (`makeTrunkDriftCommit(repo, subject)` — a plain `git
commit --allow-empty` directly on the fixture's default branch, no feature
branch, no merge) to produce a genuine direct-to-trunk commit without
duplicating `trunk-drift.test.js`'s own fixture-building depth:

1. **404 for a project that doesn't exist** — `GET
   /api/projects/does-not-exist/trunk-drift` → `404`,
   `body.error.code === "NOT_FOUND"` (mirrors the existing `GET /:id/repos`
   404 case immediately above it, same error shape).
2. **`{ repos: [] }` for a project with no mapped folders** — a fresh
   project with no `cwds` → `200`, `body.repos` deep-equals `[]`. Confirms
   the route never throws on the empty-paths case and never omits the
   `repos` key.
3. **Non-repo mapped folder is skipped, not errored** — a project mapped to
   a plain (non-git) folder only → `200`, `body.repos` deep-equals `[]` (the
   folder is filtered out via `isGitRepo`, same as `/:id/repos`'s
   `nonRepoFolders` split, but `/:id/trunk-drift` has no `nonRepoFolders`
   key to report it under — confirm that key is simply absent, not present
   as `undefined` or an empty array masquerading as data).
4. **Populated `drift` for a fixture repo with a genuine direct-to-trunk
   commit** — `makeFixtureRepo` + one extra empty commit straight on the
   default branch (no feature branch involved) → `200`,
   `body.repos.length === 1`, `body.repos[0].cwd` equals the fixture path,
   `body.repos[0].drift.skipped === null`,
   `body.repos[0].drift.commits.length === 1`, and the one commit's `sha`/
   `subject` match what was actually committed (read via `git log` in the
   test, not hardcoded) — proving the route is calling the real
   `detectTrunkDrift`, not a stub.
5. **Multi-repo aggregation, mixed states in one response** (the one case
   the technical plan's one-line description doesn't spell out, added here
   because it is this route's actual "wired flow" — looping
   `listProjectPaths` and assembling one array from N independent
   per-path results): a project mapped to **two** fixture repos — one with
   a direct-to-trunk commit (as in #4) and one with **zero** commits at all
   (`git init` only, no commit) → `200`, `body.repos.length === 2`, the
   first repo's `drift.skipped === null` with its commit populated, the
   second repo's `drift.skipped === "no_commits"` — proving one repo's
   `skipped` state does not short-circuit or corrupt the other repo's
   populated result in the same response.
6. **`GET /:id/repos`'s response shape is unchanged** (the plan's own
   additive-only requirement, `.claude/rules/backend-node.md`) — re-run
   the existing `describe("GET /:id/repos")` assertions unmodified (no
   code change needed here; noted so the build treats a green, **unedited**
   `GET /:id/repos` block as part of this route's own Definition of Done,
   not just an incidental side effect).
7. **No unresolved-boundary-token leak on the API surface itself:** every
   `skipped` value returned is one of the four documented reasons
   (`not_a_repo`/`no_default_branch`/`no_commits`/`git_error`) or `null` —
   never `undefined`, never a raw internal error message string leaking
   into the JSON body (the technical plan's `git_error` catch-all exists
   precisely so a raw `stderr` string never reaches this response).

---

## 5. How to run a single spec

No base URL, no external stack, no environment bring-up — this spec (like
every other file in `server/__tests__/`) is self-contained: it sets its own
`DASHBOARD_DB_PATH` to a fresh temp SQLite file, starts its own Express app
on an OS-assigned port, builds its own real `git init` fixtures under a
`mkdtempSync` tmp dir, and cleans both up in `after()`. There is no shared
dev server or "stack must be up" prerequisite.

```bash
# Run the whole file (existing GET /:id/repos block + the new
# GET /:id/trunk-drift block together):
node --test server/__tests__/projects.test.js

# Narrow to just the new block while iterating:
node --test --test-name-pattern="GET /:id/trunk-drift" \
  server/__tests__/projects.test.js

# The required gate before merge (per CLAUDE.md and this plan's DoD):
npm run test:server
npm run test:client   # for the card's component/snapshot coverage, owned elsewhere
```

---

## 6. Cost note — what this layer does and does not prove, and why nothing
more is added

This document adds **one new `describe` block, seven assertions, inside an
existing file** — not a new spec file, not a new fixture harness, not a new
bucket. That is a deliberate minimum, not an oversight:

**Covered here, once, at the seam that actually matters:**
- The route is reachable, mounted correctly beside `/:id/repos`, and
  returns the documented `{ repos: [...] }` shape for the 404/empty/
  non-repo/populated/mixed-multi-repo cases — proving the **aggregation
  loop** (the one piece of logic this route itself adds beyond calling
  `detectTrunkDrift`) is wired correctly against real git fixtures, not a
  stub.
- `GET /:id/repos`'s shape stays provably unchanged in the same file run.

**Deliberately left to the unit layer (do not duplicate here):**
- Every default-branch-resolution case (`main`/`master`/nonstandard names,
  with/without a remote, sole-local-branch, no-default-branch) —
  `trunk-drift.test.js`'s cases 1a-2c, against `resolveDefaultBranch`
  directly. Re-proving these through this route's HTTP layer would only
  add a second, slower path to the same fact.
- **The single most load-bearing case in this whole change** — the
  false-positive guard (clean-trunk/no-drift via `--no-ff` merge, and its
  fast-forward-then-deleted-branch twin, case 3/3b, proven red by removing
  `--first-parent`/`--no-merges` per §9.3) — belongs entirely to
  `trunk-drift.test.js`, called directly against `detectTrunkDrift`. This
  is a git-behavior proof, not a wiring proof; a real server adds latency
  and an extra process boundary without adding anything to what the red/
  green proof itself demonstrates.
- Bounded-lookback, truncation, `seenShas` filtering, DAG-vs-`created_at`
  ordering, and every other `skipped` reason (dirty-but-uncommitted,
  git-error, not-a-repo, detached HEAD, bare repo) — all `trunk-drift.test.js`
  table-driven cases, correctly owned there since none of them depend on
  the route or the project/path-mapping layer at all.
- `update-check.js`'s own default-branch/remote-resolution behavior after
  the `git-refs.js` extraction — `update-check.test.js` passing **with
  zero edits**, per the technical plan's own stated proof. Not re-verified
  through a live HTTP round trip here (see §1 above for why that would add
  no confidence over the structural single-function guarantee).
- The Project Detail card's rendering — all four `skipped`-as-"unknown"
  states, the commit list's `+I/-D` formatting, all four locales resolving
  (no raw i18n key visible), the "no badge, no verdict, no action button"
  constraint — entirely `client/src/pages/__tests__/ProjectDetail.test.tsx`
  (component, mocked `api.projects.trunkDrift`) and
  `screens.snapshot.test.tsx` (render snapshot, eyeballed before
  regeneration per CLAUDE.md). No server round trip is needed to prove
  what a React component renders from a given response shape, and this
  project has no browser-automation runner to drive one even if it were
  useful.
- The DEC-4 carve-out's two `reconciliation.js` log lines —
  `reconciliation.test.js` passing **unmodified** is the plan's own stated
  proof (log-only, zero verdict change); nothing for a wired-flow layer to
  add.
- The manual verification pass named in `technical-plan.md` §6.5 (hand-
  commit directly to a scratch worktree's trunk, confirm the card detects
  it; land a change through the declared-focus/`--no-ff` flow, confirm it
  is **not** flagged) is explicitly the plan's own one-time human check,
  not something this automated layer substitutes for — it is a Phase-1b-
  adjacent step in the plan's own numbering but its Phase-1a-relevant half
  (the negative false-positive check against real `ccam` behavior) is
  still real human judgment this document does not claim to replace.
