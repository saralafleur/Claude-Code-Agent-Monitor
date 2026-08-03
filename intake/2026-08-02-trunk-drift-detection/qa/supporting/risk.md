# Risk & Regression Analysis — trunk-drift-detection (Phase 1a)

> Companion to `qa/change-brief.md`. Scope: **Phase 1a only** — the read-only
> detector, `git-refs.js` extraction, `GET /:id/trunk-drift`, the Project
> Detail card, and the DEC-4 logging carve-out in `reconciliation.js`. Phase
> 1b (schema/write/reconciliation-pickup) is out of scope for this pass and
> is not analyzed here except where a Phase-1a decision creates or defers
> Phase-1b risk.

Grounded in: `PROJECT-CONTEXT.md` §9.1–§9.6 (defect catalog),
`server/lib/update-check.js` (current, read in full),
`server/lib/repo-topology.js` (current, read in full),
`server/__tests__/update-check.test.js` (import surface confirmed),
`intake/2026-08-02-trunk-drift-detection/technical-plan.md`,
`intake/2026-08-02-trunk-drift-detection/decisions.md`.

---

## 1. Blast radius

Beyond the literal new files, this change's dependency graph is small but has
two genuinely load-bearing edges:

- **`server/lib/git-refs.js` (new) ← consumed by both `update-check.js` and
  `trunk-drift.js`.** This is the shared registry. Anything that changes
  `resolveDefaultBranch`, `pickCanonicalRemote`, `listRemotes`, or
  `REMOTE_PRIORITY` after this lands affects **two independent features**
  simultaneously: the "check for dashboard updates" banner and the new
  "direct-to-trunk work" card. A bug fix aimed at one consumer's edge case
  (e.g. tightening remote-priority logic for trunk-drift's benefit) can
  silently change which remote `update-check.js` fetches from.
- **`server/lib/update-check.js`'s public contract.** Only `getUpdatesStatus`
  and `DEFAULT_ROOT` are exported and consumed externally
  (`server/update-scheduler.js`, `server/routes/updates.js`,
  `server/__tests__/update-check.test.js` — confirmed by grep, no other file
  imports `update-check.js`). The internal functions being deleted
  (`REMOTE_PRIORITY`, `listRemotes`, `pickCanonicalRemote`) have **zero**
  external consumers today, so the extraction's blast radius is contained to
  `update-check.js`'s own internal call graph — but that call graph is deep:
  `pickCanonicalRemote` → gates whether `getUpdatesStatus` even attempts a
  fetch, which gates `resolveCompareRefForRemote`, `tracksCanonical`,
  `situation`, and the `manual_command` string shown to the user. A subtly
  wrong re-import (e.g. accidentally binding a *new* `pickCanonicalRemote`
  with different remote-priority defaults) would ripple through every branch
  of `getUpdatesStatus`'s return shape without touching a single line inside
  `update-check.js` itself.
- **`server/lib/repo-topology.js`'s `isGitRepo`** — imported (read-only) by
  `trunk-drift.js` per the plan. `isGitRepo` is also depended on by
  `buildProjectRepoTopology` (the existing `/:id/repos` route) and by
  `routes/projects.js`'s general path-mapping logic. No behavior change is
  planned here, but it becomes a second consumer of a previously
  single-consumer function — worth a grep-confirm that no default parameter
  or signature change sneaks in.
- **`server/routes/projects.js`** — gains a new route beside `/:id/repos`.
  Both routes now iterate `stmts.listProjectPaths.all(project.id)` and call
  `isGitRepo` per path independently. Any future refactor that tries to
  "share the iteration" between these two routes is a second `git-refs.js`-shaped
  extraction risk waiting to happen — not needed now, but worth flagging so
  a future change doesn't reach for `Promise.all` + shared state and
  accidentally couple the two routes' failure isolation (one repo's
  `git log` failure must never abort another repo's result in either route).
- **`client/src/pages/ProjectDetail.tsx`'s existing repo-topology wiring** —
  the new card is explicitly modeled on the `api.projects.repos` /
  `repoTopology` state precedent. `ProjectDetail.tsx` is already a large,
  multi-card page; a new card sharing loading/error-state scaffolding with
  the existing repo-topology card is a plausible copy-paste site for the
  "renders `skipped`/error as clean" mistake (see §4).
- **Four locale files** (`en`/`ko`/`vi`/`zh` `projectDetail.json`) — a shared
  registry in the completeness sense (§2, Completeness across a
  registry/enum). Each must gain the same new keys in the same change.
- **`server/lib/reconciliation.js`'s `parseDispositionOutput`** — the DEC-4
  carve-out touches a function inside the disposition-parsing hot path.
  Even though the plan states "zero verdict change," this function is
  consumed by every reconciliation tick today (`inferred`/`declared`
  sources), so a mistake here (e.g. logging *before* the return, changing
  control flow) has blast radius across the **existing** disposition
  pipeline, not just future `trunk_drift` rows.

**Modules to name explicitly for the test plan:** `server/lib/git-refs.js`
(new shared home), `server/lib/update-check.js` (refactor target),
`server/lib/trunk-drift.js` (new consumer), `server/lib/repo-topology.js`
(`isGitRepo` cross-consumption), `server/routes/projects.js` (`/:id/repos`
vs `/:id/trunk-drift` isolation), `client/src/pages/ProjectDetail.tsx` (card
scaffolding reuse), the four `projectDetail.json` locale files,
`server/lib/reconciliation.js` (`parseDispositionOutput`).

---

## 2. Invariants that must hold

This project has a configured recurring-defect catalog (`PROJECT-CONTEXT.md`
§9.1–§9.6). Mapping this change against it directly, plus first-principles
invariants for the parts the catalog doesn't name:

1. **Consistency across paths — §9.1 DERIVED-DUAL-VIEW, narrowly applicable
   as "single-home discipline," not the strict "same value" form.**
   `resolveDefaultBranch` is the *one* implementation of "what is this repo's
   trunk," consumed by both `trunk-drift.js` (new) and, via the refactor,
   `update-check.js` (existing). The technical plan (§5 item 2) explicitly
   invokes this discipline by name even though the catalog's §9.1 entry
   itself is about derived *values* (pace, wall_ms), not git-ref resolution.
   The change-brief's own read is correct: this is the *same shape* of
   discipline §9.1 exists to enforce, applied one layer down the stack.
   **Test-invariant:** both consumers import from `git-refs.js` — not a
   re-copy — and `update-check.js`'s own resolution behavior (`remote_ref`,
   `tracksCanonical`, `situation` branches) is unchanged post-extraction,
   proven by `update-check.test.js` passing **unmodified**.

2. **§9.1's *inverse* lesson also applies here, and the plan already caught
   it once** — decisions.md records that the request-brief's pre-flag of a
   *third* `detour_dispositions.label` composer as a §9.1 violation was
   **retracted** on closer read: three label composers converging on no
   single correct value is not this pattern. That retraction is Phase-1b
   scoped (label composition), not Phase-1a, but it is worth restating for
   this pass because it demonstrates the catalog's own generalizable test
   ("is there a single value multiple sites *should* agree on?") is exactly
   the test that correctly *does* fire for `resolveDefaultBranch` (yes, one
   true trunk) and correctly *does not* fire for label composition (no, three
   legitimately different narratives).

3. **False-positive guard as a git-native predicate — DEC-5, the single most
   load-bearing test in the plan.** No catalog id names this directly (it is
   new detector logic, not a repeat of a previously-named pattern), but it is
   the general **isolation across variants** invariant in a very literal
   form: work that went through the tracked/declared flow must never leak
   into the "direct-to-trunk" bucket. See §3/§4 below for the specific
   predicate analysis requested.

4. **"Never guess, never a false clean" — an established, named contract in
   this codebase** (`repo-topology.js`'s `checkWorktreeDirty`, see the code
   comment at line 149-151: *"Returns true/false, or null when dirtiness
   genuinely couldn't be determined... callers must render that as unknown,
   never fall back to a false clean."*). The technical plan explicitly
   extends this contract to `trunk-drift.js`'s `skipped` reasons. This is
   the same invariant class as **no-leak at boundaries**, inverted: instead
   of "don't let an internal token leak out," it's "don't let uncertainty
   get silently resolved to a specific, wrong external-facing value
   ('clean')."  **Test-invariant:** every one of the four `skipped` reasons
   (`not_a_repo`, `no_default_branch`, `no_commits`, `git_error`) renders as
   an explicit "unknown" state in the client, never as "clean" — and
   `commits: []` (a real empty result, distinct from `skipped`) must also
   never be conflated with `skipped` in the UI, since both look like "no
   commits" but mean different things (one is a confident negative, one is
   "we don't know").

5. **Behavior-preservation of the refactor target** — general invariant, not
   catalog-named, but stated as a hard requirement in both the plan and the
   change-brief: `update-check.test.js` green with **zero edits** is the
   plan's own proof. This is round-trip integrity in spirit (the refactor
   must be a lossless transformation of behavior), even though nothing is
   literally being written/read across a persistence boundary.

6. **API response-shape stability — `.claude/rules/backend-node.md`.**
   `GET /:id/repos`'s existing response shape (`{ project_id, repos,
   nonRepoFolders, detectedSiblings, ignoredRepos }`) must be provably
   unchanged; `/:id/trunk-drift` is additive-only.

7. **Completeness across a registry/enum** — the four locale files are a
   canonical list; every entry must gain the new keys in the same change, or
   a locale silently falls back to a raw i18n key (this project's own named
   variant-isolation failure mode per the change-brief).

8. **Round-trip integrity / no-leak at boundaries — explicitly N/A this
   phase**, correctly marked as such in the change-brief: nothing is
   persisted in Phase 1a, and no commit-subject text reaches an LLM prompt
   in Phase 1a (that risk is WATCH-4, deferred to Phase 1b along with the
   `formatTrunkDriftLabel` composer). Confirmed correct scoping — flagging
   here only so the boundary is explicit for whoever reads this file without
   the full plan.

---

## 3. DEC-5's false-positive predicate — what must hold for it to NOT flag normal, declared-focus/worktree work

This is the single highest-risk surface in the whole Phase-1a change, by the
plan's own framing, and it deserves the closest read.

### The predicate, restated precisely

A commit is "direct-to-trunk work" iff **all three** hold:
1. On the default branch's **first-parent** line (`--first-parent`).
2. **Not itself a merge commit** (`--no-merges`).
3. **Not reachable from any other local branch ref**
   (`--not --exclude=refs/heads/<trunk> --branches`).

### Invariants the *normal* declared-focus/worktree flow must satisfy for this to be safe

The predicate's correctness rests on an assumption about **how work normally
lands on trunk in this project** — the plan does not state this assumption
explicitly as a precondition, so it's worth naming for the test plan:

- **Assumption A: normal flow merges with `--no-ff`.** If `ccam focus` /
  the declared worktree flow's *normal, blessed* path is a `--no-ff` merge
  (a real merge commit on trunk's first-parent line, with the feature
  branch's commits reachable only from that merge's second parent), then
  clause 1 (`--first-parent`) alone excludes every commit of that work from
  the walk — they are never on the first-parent line at all. This is
  Case 3 in §6.1 and is the primary, common-case guard.
- **Assumption B: the feature branch either still exists (fast-forward
  case) or was deleted after `--no-ff` merge (irrelevant, since `--no-ff`
  commits aren't on first-parent line regardless).** Clause 3 exists
  specifically for the **fast-forward** sub-case (Case 3b): if the flow ever
  fast-forwards trunk instead of `--no-ff` merging, the feature commits
  *do* land on trunk's first-parent line indistinguishably from
  direct-to-trunk work — clause 3 rescues this **only while the feature
  branch ref still exists locally**. The moment that branch ref is deleted
  (a completely normal cleanup step after a merge), clause 3 can no longer
  see it, and the commits are flagged. **This is WATCH-1**, analyzed in
  §4 below.
- **Assumption C: "local branch" in clause 3 means what the fixture tests
  mean by it — a ref under `refs/heads/`, present in the same repo instance
  the detector runs against.** If the declared-focus/worktree flow uses
  `git worktree add` (a **separate working directory, same repo, same
  `.git`**), the feature branch ref still lives under `refs/heads/` in the
  *same* repository and clause 3's `--branches` (all local branches) sees
  it correctly — this is the expected common case for this project's
  worktree-based flow and should hold. But if a worktree is ever created in
  a way that uses a *linked* `.git` file pointing elsewhere, or a submodule,
  or any construction where `git branches` in the trunk-check's execution
  context does not enumerate that ref, clause 3 silently stops protecting
  it. **This project's worktree machinery should be checked against this
  assumption directly** — a fixture test that creates the feature branch via
  `git worktree add` (not just `git branch` + `git checkout`) and confirms
  clause 3 still excludes it would close this gap. The plan's §6.1 table
  does not appear to include a worktree-specific fixture (cases 1a-8 use
  ordinary branches/merges) — this is a **gap worth flagging back**, since
  "worktree flow" is literally the flow this predicate is supposed to
  recognize as safe.
- **Assumption D: `--exclude`/`--branches` argument ordering is
  order-sensitive** — the plan says so itself (§4 Step 3: *"Verify the
  `--exclude`/`--branches` argument ordering against the real fixtures — it
  is order-sensitive and is the mechanism behind DEC-5 clause 3"*) and
  treats this as a build-time verification, not a pre-verified fact. This is
  exactly right per §9.3 VACUOUS-GUARD discipline — but it means the guard's
  correctness is **not yet demonstrated as of this plan-review pass** (no
  code exists yet). The red-first requirement on Case 3 (prove it fails when
  `--first-parent`/`--no-merges` is removed) is the mandated proof; there is
  no equivalent stated red-proof step for clause 3's `--exclude`/`--branches`
  ordering specifically (Case 3b tests the *behavior*, but the plan's
  explicit red-proof instruction in §8 DoD only names removing
  `--first-parent`/`--no-merges`, not permuting the `--exclude`/`--branches`
  argument order). **Recommend**: Case 3b should have its own red-proof —
  e.g. reversing `--branches --exclude=...` order or omitting `--exclude`
  — recorded the same way Case 3's is, since the plan itself calls this
  clause "order-sensitive" and that is precisely the shape of thing §9.3
  exists to catch from shipping vacuously.

### Concrete false-positive traps for the test plan to pin

- A commit made on a short-lived feature branch, `--no-ff` merged, branch
  **not** deleted → must NOT be flagged (tests clause 1, independent of
  clause 3).
- Same, but branch **deleted** after `--no-ff` merge → must NOT be flagged
  (clause 1 alone protects this; clause 3 is irrelevant here since the
  commits were never on first-parent line to begin with — worth its own
  explicit case distinct from 3/3b, since it's a different mechanism than
  what 3b exercises).
- Fast-forward merge, branch **still present** → must NOT be flagged
  (Case 3b, clause 3).
- Fast-forward merge, branch **deleted** → **will** be flagged (WATCH-1's
  accepted residual — see §4).
- Fast-forward merge via `git worktree add` (not `git branch`) → should NOT
  be flagged while the worktree/branch exists; **not currently in the
  §6.1 table** — recommend adding.
- A rebase-then-fast-forward (commits get new SHAs, same content) with
  branch retained → should NOT be flagged (clause 3 keys on the *current*
  SHA being reachable from the retained branch ref, so this should hold,
  but is worth a fixture given rebases are common in this kind of flow).

---

## 4. Refactor risk — `git-refs.js` extraction out of `update-check.js`

Read `server/lib/update-check.js` (current, in full) and
`server/__tests__/update-check.test.js`'s import surface directly for this
assessment.

### What must NOT change

- **Public export shape**: `module.exports = { getUpdatesStatus,
  DEFAULT_ROOT }`. Confirmed by grep: `server/update-scheduler.js` and
  `server/routes/updates.js` both import only `getUpdatesStatus`;
  `update-check.test.js` imports only `getUpdatesStatus`. No external
  consumer touches `REMOTE_PRIORITY`/`listRemotes`/`pickCanonicalRemote`
  directly today, so **removing them from `update-check.js`'s exports is
  safe as a compile-time matter** — but the plan is correct that they must
  still exist, imported from `git-refs.js`, and behave identically.
- **`execGit`'s own semantics inside `update-check.js` stay put**:
  `update-check.js`'s private `execGit` uses a **120s default timeout**
  (`timeout = opts.timeout ?? 120_000`, line 22) — because it's used for
  `git fetch`, a network call. `git-refs.js`'s new shared `execGit` per the
  plan (§3.1) uses a **10s default** (`timeout default 10_000`). These are
  **two different functions with the same name and different defaults**,
  by design (the plan states this explicitly: "Keep its own `execGit`").
  **This is the single easiest way to introduce a silent regression**: if
  the extraction accidentally has `update-check.js` import `execGit` from
  `git-refs.js` instead of keeping its own, `git fetch` calls would get a
  10s timeout instead of 120s and start failing/timing out on slow networks
  — a regression that would not show up in `update-check.test.js`'s fixture
  repos (fast, local, no real network fetch latency) and would only surface
  in production against a real slow remote. **Required test-invariant**:
  assert (via source inspection or a timing-sensitive test double) that
  `update-check.js`'s `execGit` retains its own 120s default and is *not*
  the one imported from `git-refs.js`.
- **`resolveCompareRefForRemote` stays byte-for-byte unchanged** — its
  fork-workflow-specific logic (prefers `master` before `main`, unlike
  `git-refs.js`'s new `resolveDefaultBranch` which the plan states tries
  `main` before `master` per its `candidates` default — worth double-
  checking these two independently-tuned orderings don't get conflated
  during the extraction, since they are *intentionally* different: one is
  fork-workflow-tuned, one is dashboard-population-tuned per DEC-5's
  narrowing decision in the plan §2.3 item 2).
- **`REMOTE_PRIORITY` value itself**: `["upstream", "origin"]`. Must move
  verbatim — a reordering (even if semantically "improved") changes which
  remote `update-check.js` treats as canonical for the update-check feature,
  which changes `manual_command`, `situation`, and `tracks_canonical` for
  every fork-workflow user of this dashboard.
- **`getCurrentBranch` / `getBranchUpstream` / `stripRemotePrefix`** — not
  mentioned in the plan's extraction list at all (only `execGit`,
  `listRemotes`, `pickCanonicalRemote`, `REMOTE_PRIORITY` move). These stay
  in `update-check.js` and are not shared. Confirm they are **not**
  accidentally swept into the extraction along with the four named items —
  the plan is specific about the four; a broader "let's move everything
  git-ref-related" instinct during implementation would be scope creep that
  the plan doesn't ask for and that isn't covered by `git-refs.js`'s
  documented API (§3.1's `module.exports` list is exactly four names plus
  `resolveDefaultBranch`).

### Test-invariant for this refactor

- `update-check.test.js` passes **unmodified** (the plan's own stated
  proof) — but note this test only exercises `getUpdatesStatus` end-to-end
  (confirmed: it doesn't import `listRemotes`/`pickCanonicalRemote`
  directly), so it is a **black-box** behavior-preservation proof, not a
  unit-level one. That's *appropriate* for this refactor (it proves the
  thing that matters — end-user-visible behavior — is unchanged) but means
  a bug introduced purely inside `listRemotes`/`pickCanonicalRemote` that
  happens to produce the *same* observable `getUpdatesStatus` output for
  every fixture in that test file, but a *different* one for some
  untested remote-topology (e.g. three remotes, or a remote named
  differently than the fixtures use) would ship undetected. Given
  `trunk-drift.js` is now a **second, independent consumer** of these same
  functions, its own `trunk-drift.test.js` fixtures (1a/1b/1c/2/2b/2c) add
  real additional coverage of `resolveDefaultBranch`'s remote-handling paths
  — worth explicitly cross-referencing in the test plan as *shared*
  coverage of `git-refs.js`, not duplicated effort.

---

## 5. Recurring-issue mapping

This project **has** a configured recurring-defect catalog:
`PROJECT-CONTEXT.md` §9.1–§9.6. Direct mapping of this change against it:

- **§9.1 DERIVED-DUAL-VIEW — touches the surface, count unchanged, applies in
  its "single-home" form.** As covered in §2 item 1 above. Not an
  open/regressed instance — this is the *design-time application* of the
  discipline, done correctly per the plan (one `resolveDefaultBranch`,
  shared, tested from both call sites). **No regression risk to a prior
  fix here** — this is new ground for the catalog (git-ref resolution, not
  a value the catalog has previously tracked), so there's nothing to
  regress. The risk is purely: does the build actually route both consumers
  through the shared function, or does `trunk-drift.js` end up with its own
  inline `main`/`master` guess because it was faster to write standalone
  during implementation? That would be a **fresh instance** of the pattern,
  the same way `resolvePracticeConfig()`'s `kind`/`defaultSeverity` bypass
  became a fresh instance in `practice-kind-override`.
- **§9.1's retracted pre-flag (label composers)** — correctly out of scope
  for Phase 1a (label composition is Phase 1b). Flagging only so whoever
  reads this file knows it was considered and correctly dismissed, not
  overlooked.
- **§9.2 row-id-as-chronology-proxy — explicitly and correctly bounded out**
  by DEC-5/the plan's own §3.3. The only DB read this feature adds in
  *any* phase is `listTrunkDriftRefs` (Phase 1b, not built yet), a
  set-membership query with no `LIMIT`/no ordering, so §9.2 doesn't bind it.
  Commit sequencing is governed by git's own DAG order, which the plan
  states explicitly must not be re-sorted by `committedAt` — Case 7 in
  §6.1 tests this directly. **No open exposure here for Phase 1a** — there
  is no `created_at`-ordered query in this phase's actual code (only a
  planned Phase-1b one).
- **§9.3 VACUOUS-GUARD — directly binding on this pass's own required
  red-proof.** Case 3 (clean trunk / no drift) must be proven red by
  removing `--first-parent`/`--no-merges`. As noted in §3 above, there is
  no equivalently explicit red-proof instruction for clause 3's
  `--exclude`/`--branches` **ordering** specifically, even though the plan
  itself calls that ordering "order-sensitive" — this is the shape of gap
  §9.3 exists to catch (a guard whose correctness is asserted by behavior
  but never proven to fail when broken). **Recommend closing this before
  the case is marked done.**
- **§9.5 FRESH-DB-BLIND SCHEMA CHANGE — not applicable to Phase 1a**
  (no schema change in this phase; confirmed no `CREATE TABLE`/`ALTER
  TABLE` edit anywhere in the changed-files list).
- **§9.6 NON-ATOMIC REBUILD — explicitly named in the plan itself as the
  forcing function for building `rebuildTableAtomically`, and explicitly
  Phase 1b.** Not touched by Phase 1a's code at all — no rebuild ships in
  this pass. Flagging only to confirm: **the change-brief's exclusion of
  Phase-1b surfaces from this QA pass is correct**, and this analysis
  agrees no §9.6 exposure exists in what's actually being built now.
- **No catalog entry is OPEN/REGRESSED/WATCH on a surface this Phase-1a
  change touches.** The closest thing to a live "we've bled here before"
  signal is **WATCH-1** (decisions.md, this same intake) — not a
  catalog entry, but a tracked accepted-risk row on the exact predicate this
  phase's read-only card renders. See §6 below — this is the one place this
  pass should escalate loudly, even though it's a *decisions.md* WATCH row
  rather than a `PROJECT-CONTEXT.md` catalog id.

---

## 6. WATCH-1 (fast-forward-merged-then-deleted-branch) — is Phase 1a's framing strong enough?

**The decision as recorded:** DEC-5's clause 3 cannot distinguish a
fast-forward-merged-and-branch-deleted commit from genuine direct-to-trunk
work, because git retains no evidence either way — no ref, no merge commit,
no trailer. `decisions.md` accepts this as a known false positive and notes
impact is "limited by the `pending` lifecycle" (Phase 1b) and that a false
positive "costs one LLM verdict and one `decision_queue` row someone
dismisses."

**Why that mitigation argument does not fully carry over to Phase 1a**,
and this is the substantive point to raise:

The `decisions.md` rationale for WATCH-1 is written entirely in terms of
Phase 1b's cost model (an LLM verdict, a dismissible queue row). **Phase 1a
has no LLM, no queue row, and no dismissal mechanism.** What Phase 1a *does*
have is a **human reading a card** on Project Detail that lists the commit,
its author, and its subject, under the label "Direct-to-trunk work." For a
repo where the project's normal flow is fast-forward merges (not
universally true, but plausible for any project using `git merge --ff-only`
or simple `git rebase && git push` habits — and this dashboard's own
`update-check.js` explicitly recommends `git pull --ff-only` as its default
suggested flow, meaning fast-forward is a **normal, encouraged pattern in
this very codebase's own tooling**), a developer who did everything "right" —
worked on a branch, merged, deleted the branch — will see their own commit
listed under a card titled "Direct-to-trunk work" with **no caveat
explaining that fast-forward-then-delete is indistinguishable from
literally typing on trunk.**

This is a **read-only, non-classifying, non-writing surface**, so the
*technical* residual risk (bad data, wrong write, corrupted state) is
genuinely low, matching the plan's own severity framing. But the
**product/UX risk is not zero and is not the same risk WATCH-1 was written
to describe** — WATCH-1's rationale is about a dismissible LLM-adjacent
queue entry; Phase 1a is a **card a human reads and may trust as an
authoritative claim about their own workflow**, exactly the kind of "the
detector's own read-only card must not lie to a human either" concern the
change-brief itself names in its Test-invariants section, but the *labeling*
of the card and its rows does not yet have a stated UI treatment for this
specific ambiguity.

**Assessment: the residual risk is acceptable to ship, but the current plan
under-specifies its UI framing for this one case.** Concretely:
- The plan's §3.7 client spec lists exactly what the card renders per
  commit (short SHA, subject, author, relative date, +I/-D) and what
  `skipped` states render as ("unknown," never "clean") — but has **no
  equivalent framing for the WATCH-1 ambiguity itself**. There's no proposed
  copy like "may include work merged via fast-forward" or similar
  qualifying language on the card.
- This is a **disclosed-and-declined** risk per the task framing: WATCH-1 is
  already a tracked decisions.md row (good — it's not just prose), but its
  *scope* as written only reasons about Phase 1b's cost model. **Recommend**:
  either (a) amend WATCH-1's own rationale in `decisions.md` to explicitly
  address the Phase-1a read-only-card exposure (not just the Phase-1b
  queue-row exposure), since the row currently doesn't mention the card at
  all, or (b) add a lightweight card-level caveat/tooltip in Phase 1a's
  `ProjectDetail.tsx` implementation and note that decision in
  `decisions.md` alongside WATCH-1. Either is a small addition; leaving it
  unaddressed is the "disclosed only as prose in one document that
  reasons about a different phase's cost model" trap the task brief warns
  about.

---

## 7. `checkWorktreeDirty` contract risk if `trunk-drift.js` reuses `repo-topology.js`/`update-check.js` patterns

Per the plan (§3.1), `trunk-drift.js` imports `{ execGit,
resolveDefaultBranch }` from `./git-refs` (not from `repo-topology.js`) and
`{ isGitRepo }` from `./repo-topology` — **read-only, no `execGit` copy from
`repo-topology.js`**. This is explicitly by design (plan: *"No third private
`execGit` copy is created... the two existing private copies in
`repo-topology.js` / `update-check.js` are left alone"*).

Because `trunk-drift.js`'s own `execGit` comes from the **new**
`git-refs.js`, it does **not** directly inherit `repo-topology.js`'s
`checkWorktreeDirty` implementation or its exact null-on-uncertainty return
convention — it has to **re-implement** the same discipline independently
inside `trunk-drift.js`'s own error handling (`{ skipped: "git_error" }`
etc.). This is a genuine, if small, risk:

- **`checkWorktreeDirty` returns `true | false | null`** with `null`
  meaning "genuinely couldn't determine" — a **three-state contract on a
  single return value**.
- **`trunk-drift.js`'s planned shape is different**: a `{ skipped: reason }`
  **object-tagged union**, not a tri-state boolean. This is *not* a bug —
  it's arguably a better shape for a richer result type (`trunk-drift.js`'s
  success case carries a whole commit list, not a boolean) — but it means
  the invariant "never guess, never a false clean" is being **re-derived
  independently** in a new module with a different data shape, rather than
  reused via a shared helper or shared type. That's fine as *code*, but it
  means **the invariant itself, not just the code, needs its own explicit
  test in `trunk-drift.test.js`** rather than inheriting confidence from
  `repo-topology.test.js`'s existing coverage of `checkWorktreeDirty`. The
  plan's §6.1 case 8 (*"not a repo / empty repo / detached HEAD worktree /
  bare repo → `{ skipped: … }` with the right reason; never a throw, never a
  false clean"*) is the right test, and it's present — flagging only that
  this is the invariant doing real, freshly-written work here, not
  inherited-for-free work, and should be weighted accordingly in review
  (i.e., don't wave it through as "well `repo-topology.js` already proved
  this pattern works" — a **different module** is asserting the same
  property with different code).
- **The isolated-git-env pattern** (`isolatedGitEnv()`, stripping
  `GIT_DIR`/`GIT_WORK_TREE`/etc.) is shared correctly at the `git-refs.js`
  layer (both `repo-topology.js` and `update-check.js` already use
  `isolatedGitEnv()` from `./git-env`, and `git-refs.js`'s new `execGit` is
  specified to use `env: isolatedGitEnv()` too per §3.1's comment). This
  part **is** genuinely shared (same `git-env.js` import), so no new
  isolation-boundary risk there — worth confirming in review that
  `git-refs.js`'s `execGit` literally imports `isolatedGitEnv` from
  `./git-env` (not a re-copied env-stripping list), matching the existing
  two private copies' pattern.
- **Concrete trap**: if `trunk-drift.js`'s `git log` call throws for a
  reason that *isn't* one of the four named `skipped` reasons (e.g. a
  `maxBuffer` overrun on a pathological repo, or an `ENOENT` if `git` itself
  isn't installed), does it fall through to `git_error` (safe) or does an
  uncaught exception propagate up through
  `routes/projects.js`'s per-repo iteration and abort the **whole**
  `/:id/trunk-drift` response for **every other mapped repo** in that
  project, not just the failing one? The plan states `detectTrunkDrift`
  "never throws," but the route-level iteration in `routes/projects.js`
  needs its own try/catch **per mapped path** (mirroring
  `buildProjectRepoTopology`'s pass-1 `try { worktrees = await
  listGitWorktrees(p.cwd); } catch { worktrees = []; }` pattern) as a
  belt-and-suspenders measure, since "never throw" is a contract on one
  function, not a guarantee enforced by the type system. **This is a
  concrete required assertion**: a `projects.test.js` case where one mapped
  repo's git call fails/throws and the response still contains correct
  `drift` results for the project's *other* mapped repos (isolation across
  variants, applied per-repo instead of per-tenant).

---

## 8. The "ships green but broken" traps — concrete, per surface

Each of these is a mistake that would pass `npm run test:server` /
`npm run test:client` as currently scoped, and each is a required new
assertion:

1. **`trunk-drift.js` re-implements its own `main`/`master` guess instead of
   calling `git-refs.resolveDefaultBranch`.** Ships green if
   `trunk-drift.test.js`'s fixtures happen to use `main`/`master`/`trunk`
   the same way `git-refs.js` would resolve them — the *output* looks
   right, the *source* is wrong, and the single-home guarantee (§2 item 1)
   is silently violated. **Required assertion**: a source-level check
   (grep/AST scan, in the shape of `single-writer-guard.test.js`) that
   `trunk-drift.js` contains no `main`/`master` string literal outside of
   passing through `git-refs.js`'s `candidates` default.
2. **The `git-refs.js` extraction accidentally has `update-check.js` import
   the *new* module's 10s-default `execGit` instead of keeping its own
   120s-default one** (§4 above). Ships green because
   `update-check.test.js`'s fixtures are fast local repos with no real
   network latency — a 10s vs 120s timeout difference is invisible in every
   fixture but would fail in production against a slow real remote.
   **Required assertion**: source-level check that `update-check.js`'s
   `execGit` function definition still exists locally with its own
   `120_000` default, not re-exported/imported from `git-refs.js`.
3. **The `--exclude`/`--branches` argument order in the `git log` call gets
   silently permuted** during implementation (e.g. by an editor's
   auto-format, or a well-meaning "alphabetize the flags" pass) and clause 3
   of DEC-5 stops working — but Case 3b's fixture happens to still pass
   because its particular fast-forward setup doesn't exercise the ordering
   sensitivity the same way a different fast-forward topology would.
   **Required assertion**: the dedicated red-proof for clause 3 named in §3
   above (not currently mandated as explicitly as Case 3's is).
4. **A locale file is updated with the new keys but with the wrong values
   copy-pasted from another locale** (e.g. `ko/projectDetail.json` gets
   English placeholder text under the right keys). Ships green because
   `screens.snapshot.test.tsx` renders in one locale (need to confirm which)
   and the completeness check (does every locale *have* the key) doesn't
   catch a wrong-but-present *value*. **Required assertion**: at minimum,
   confirm the four locale files are reviewed for content correctness, not
   just key presence, during the snapshot-diff eyeball step the plan already
   mandates.
5. **`skipped` reasons render as an empty/blank card state instead of an
   explicit "unknown" label** — e.g. the client short-circuits on
   `drift.commits.length === 0` without checking `drift.skipped !== null`
   first, so both "confirmed clean" and "couldn't determine" render
   identically as "no drift commits." Ships green if the snapshot test's
   fixture data only exercises the `skipped: null, commits: []` case and
   never a real `skipped` case. **Required assertion**: a
   `screens.snapshot.test.tsx` (or component-level) case that seeds a
   `skipped` response and asserts the rendered text differs from the
   confirmed-clean case's rendered text.
6. **One mapped repo's git failure aborts the whole
   `/:id/trunk-drift` response** for a multi-repo project (§7 above). Ships
   green if `projects.test.js`'s new case only tests a single-repo, all-
   succeeding fixture.
7. **WATCH-1's ambiguity ships with zero card-level caveat**, and nothing in
   the test suite can catch this because it's a copy/UX gap, not a logic
   bug — the card will render "correct" data (the commit *is*
   git-natively indistinguishable from direct-to-trunk work) with no signal
   to the human reading it that this specific row might be a false
   positive of a *known, accepted* kind. This is exactly the class of risk
   item 6 in the task instructions warns about: **it must not ship as prose
   only** — see the summary below for the required tracked artifact.

---

## 9. Severity & priority

Ranked by user-visible impact and data/trust consequence, worst first:

| # | Risk | Severity | Why |
|---|---|---|---|
| 1 | DEC-5 clause-3 ordering silently breaks (trap #3) | **High** | Directly defeats the plan's own named "single most load-bearing test." A silent break here means the card actively lies to a human about their own normal workflow, undermining trust in the whole feature on day one. |
| 2 | `update-check.js` execGit timeout regression (trap #2) | **High** | Silent, environment-dependent (only manifests on slow real networks), affects an **existing, shipped** feature (dashboard update-check) that has nothing to do with this new feature — a pure refactor regression with no compensating new value for the user who hits it. |
| 3 | Per-repo failure isolation in `/:id/trunk-drift` (trap #6) | **Medium-High** | Data-loss-adjacent for a multi-repo project (one bad repo hides good data for all others on the same page load) even though nothing is actually lost server-side — it's a UX/completeness failure, not corruption. |
| 4 | `trunk-drift.js` re-derives its own branch-name guess instead of using the shared home (trap #1) | **Medium** | Violates the single-home invariant silently; low immediate user impact (output may look identical for common cases) but is exactly the shape of drift §9.1 exists to prevent, and it compounds — the next person editing "the" default-branch logic edits only one of two copies. |
| 5 | `skipped` vs. confirmed-clean conflation in the UI (trap #5) | **Medium** | Directly regresses the "never guess, never false clean" contract's *purpose* even if the backend never lies — a human reading "no drift" when the real answer is "we don't know" is the exact failure mode `checkWorktreeDirty`'s convention was built to prevent, now reproduced one layer up. |
| 6 | WATCH-1's Phase-1a card framing (trap #7) | **Medium** | Not a logic bug and technically an accepted, already-tracked risk — but its current tracking only reasons about Phase 1b's cost model, leaving the Phase-1a card exposure effectively undisclosed for this specific surface. Cosmetic/trust risk, not data risk, but user-visible on every page load for any repo with this history. |
| 7 | Locale content-correctness (trap #4) | **Low-Medium** | Cosmetic, scoped to non-English locales, doesn't affect data correctness or the false-positive guard, but is this project's own named variant-isolation failure mode. |

---

## 10. Disclosed-and-declined coverage — trip-wire

Per the task's own standard, nothing below should exist as prose in this
file alone:

- **WATCH-1's Phase-1a card-framing gap (§6, §8 item 7, §9 rank 6)** is a
  risk this analysis is naming that the current plan does not fully
  address for this specific phase. **This needs a `decisions.md` row** —
  either an amendment to WATCH-1 itself (broadening its rationale to cover
  the Phase-1a read-only card, not just the Phase-1b queue-row cost model)
  or a new WATCH row cross-referencing WATCH-1. It should not ship as only
  a paragraph in this risk file.
- **The DEC-5 clause-3 ordering red-proof gap (§3, §5, §8 item 3, §9 rank
  1)** — the plan's own §9.3 VACUOUS-GUARD discipline requires a red-proof
  for any guard test whose correctness is asserted by behavior rather than
  demonstrated by breaking it. Case 3 has an explicit, named red-proof step
  in the plan's DoD; clause 3 (the `--exclude`/`--branches` ordering) does
  not have an equally explicit one, despite the plan itself calling that
  ordering "order-sensitive." If the build proceeds without adding this
  red-proof, that is a **known gap being knowingly shipped** and needs its
  own `decisions.md` PENDING/WATCH row (or an explicit DoD-item addition)
  rather than being left as a finding only in this file.
- **The worktree-specific fixture gap (§3)** — DEC-5's clause 3 exists
  specifically to protect the worktree-based flow, but the §6.1 test table
  as currently specified doesn't include a fixture built via `git worktree
  add` rather than plain `git branch`/`git checkout`. If the build proceeds
  without adding this case, it should be recorded (WATCH row or DoD
  addition), not silently accepted.

If none of these three get a tracked row, they will read, months from now,
as gaps nobody knew about rather than gaps the team knowingly accepted this
round — exactly the failure mode the task brief warns against.
