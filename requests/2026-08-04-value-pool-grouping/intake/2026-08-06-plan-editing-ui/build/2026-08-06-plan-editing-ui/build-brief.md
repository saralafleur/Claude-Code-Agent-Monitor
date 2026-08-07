# Build Brief — Value Pool Slice 4, Phase 4a: Plan editing UI + atomic claim composer

**Triage date:** 2026-08-06
**Effort slug:** `2026-08-06-plan-editing-ui`
**Outer skill invocation:** `auto-pilot` — **NOT fast**: a real, buildable
test-plan exists; full test-plan gate applies.

## Verdict: READY

---

## What we're building

Phase 4a of Value Pool Slice 4 gives `PlanLedgerPanel` a real editing surface
(add top-level/sub-items, edit an item's `text` and re-parent it in place) and
makes the per-unit claim `<select>` hierarchy-aware by rendering the same
`buildItemTree` derivation the read-only tree already uses (via a new
`flattenItemTree` projection — one derivation, multiple consumers, proven by a
cross-consumer equality test). In the same phase, `POST /:id/claims`'s
single-unit `new_item` path becomes genuinely atomic: its write path is
extracted into one shared, transactional composer (`claimUnitIntoItem` in
`server/lib/plan-lifecycle.js`) so a later validation failure can no longer
leave a committed orphan plan item behind — a real, found-live defect (a
"D4: … is atomic" test that has been green since 2026-08-02 while not actually
proving atomicity), folded into 4a's scope as an our-cost bug carve-out
(`DEC-S4-2`). The re-parent capability ships with a server-side same-plan +
cycle guard (`DEC-S4-7`) because a picker built from `buildItemTree` can
directly offer a cycle, and a cycle silently vanishes items from the ledger
with no error (§9.8 OVERLOADED-ABSENCE) if unguarded. Phase 4b (batch
group-claim, hierarchy-aware claim of a whole proposed group) is explicitly
**out of scope** here — deferred, with a named trigger, because it depends on
Slice 3's unmerged `value_groups` schema (`effort/2026-08-06-auto-group-proposal`,
tip `72feac9`, not on `master`).

## Plan sources

- Technical plan: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/technical-plan.md`
- Test plan: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/qa/test-plan.md`
- Also read (load-bearing decisions live here, not only in `decisions.md` —
  a known housekeeping gap from a still-unresolved concurrent-session conflict
  on the shared `PROJECT-CONTEXT.md`):
  `decisions.md`, `decisions-tech-lead-addendum.md`, `decisions-qa-addendum.md`,
  `catalog-patch.md`, `catalog-patch-qa.md`.

Both plans present, non-empty, and buildable: technical-plan.md has a
concrete, file-by-file change set (§3) and dependency-ordered, independently
checkable implementation steps (§4, 14 steps) for phase 4a; 4b is deliberately
left unspecified (§9) with a named trigger, not vague — the plan explains why
(4b's dependency is unmerged code that may still change) and pins 4b's binding
design constraints so it isn't a blank slate later. test-plan.md names
specific spec files (`project-plans-api.test.js`, `plan-lifecycle.test.js`,
`single-writer-guard.test.js`, a new `helpers/table-writers.js`,
`PlanLedgerPanel.test.tsx`) with per-case assertions (D4/D4-empty-text/D4-happy/D4b,
I1/I2, P1-P7/P3-mirror/PA/PX/A2.20/PZ, G-1/G-2, C1-C7) and explicit red-first
discipline throughout §4 (e.g. "observe D4 red for the stated reason, before
any product change", mutation-proofs required for G-1/G-2 and the atomicity
fix, red-before/green-after pasted as real command output per the DoD).

**Plans correspond.** Test-plan §2's "UNGUARDED surface" table maps 1:1 onto
technical-plan §3's change set: atomicity (§3.2 `claimUnitIntoItem`) ↔ D4/PX;
re-parent (§3.1-3.2) ↔ P1-P7/I1/I2; hierarchy projection (§3.5
`flattenItemTree`) ↔ C3; writer guards (§5/§6 of technical-plan) ↔ G-1/G-2 via
the derived `assertTableWritersSingleHome` helper (test-plan §6 upgrades the
technical plan's hand-scoped G-A/G-B to a derived guard — a scope widening,
not a contradiction, and technical-plan's own §6.1/§9.1 language anticipates
exactly this kind of structural-guard requirement). No test-plan section
exercises phase-4b surfaces; test-plan §0/§1 states 4b (I1-I8 in the
technical-plan's §9 numbering) is explicitly out of scope here, matching
`DEC-S4-1`.

**Confirmed: 4a is buildable purely against `master`'s current HEAD.**
Technical-plan.md's own header states this in DEC-S4-1 terms ("4a forks from
`master` now; 4b's fork point decided at 4b's start"), and independently
verified live: `git branch --merged master` on the main checkout does **not**
list `effort/2026-08-06-auto-group-proposal` (tip `72feac9`) — Slice 3 is
unmerged. This build's worktree was forked from `master`, **not** from the
Slice 3 branch (see below). 4b's own trigger (`WATCH-S4-C`) explicitly defers
that fork-point decision to 4b's own start, "against Slice 3's real merge
state at that moment" — not this triage's call.

## Repo layout

Single-repo project, per `PROJECT-CONTEXT.md`'s "Repo topology" section
(re-confirmed unchanged): self-contained monorepo bundling server, client,
MCP, desktop, VS Code extension under one root; no sibling repos.
`find /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor -maxdepth 2 -name .git`
returns only the root `.git`. One worktree needed; provisioned below.

## Surfaces touched (from technical-plan §3)

- **Edited — server:** `server/db.js` (one new prepared statement,
  `reparentProjectPlanItem`), `server/lib/plan-lifecycle.js` (extend
  `updateProjectPlanItem`; new export `claimUnitIntoItem` — the sole
  `value_claims` composer), `server/routes/project-plans.js` (`POST
  /:id(\d+)/claims` reduced to a thin delegator).
- **New — server tests:** `server/__tests__/helpers/table-writers.js` (derived
  single-writer-guard helper, must carry the file header per
  `.claude/rules/file-headers.md`).
- **Edited — server tests:** `server/__tests__/project-plans-api.test.js`,
  `server/__tests__/plan-lifecycle.test.js`,
  `server/__tests__/single-writer-guard.test.js`.
- **Edited — client:** `client/src/components/PlanLedgerPanel.tsx`
  (`flattenItemTree` projection, hierarchy-aware claim `<select>`, add-item
  form, edit-in-place), `client/src/lib/api.ts` (doc note only — no new
  methods), `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` (new
  `planLedger.*` keys, all four locales, same commit).
- **Edited — client tests:** `client/src/components/__tests__/PlanLedgerPanel.test.tsx`,
  reviewed (never blind) regeneration of
  `client/src/pages/__tests__/screens.snapshot.test.tsx`.
- **Edited — docs:** per `CLAUDE.md`'s `update-project-docs` skill (API
  behavior change to the claims route, new UI capability).

**Project-specific risk surfaces flagged (from `PROJECT-CONTEXT.md`):**
`PlanLedgerPanel.tsx` / `project-plans-api.test.js` are named directly in
`decisions.md` DEC-S4-1 constraint 3 as "this project's highest-defect
surface" for merge-order churn (§9.4 FIX-ROUND-REGRESSION) — Slice 3's branch
touches the same file (+363 lines), the same test file, all four locale files,
and the snapshot baseline. **`WATCH-S4-A`** is the tracked mitigation:
whichever of Slice 3 / Slice 4a merges second rebases and *reviews* (never
blind-regenerates) the snapshot diff. Not a build blocker for 4a itself
(4a merges into `master`, not into Slice 3's branch), but the implementer and
whoever runs the eventual merge must carry it forward.

## Durable-cure obligations (MANDATORY — carried into the build)

1. **§9.3 VACUOUS-GUARD / new §9.9 NAME-OVERCLAIMING GUARD sub-shape
   (`DEC-S4-2`, `catalog-patch.md`).** The existing `D4` test's *name*
   ("… is atomic") overclaims what its fixture actually reaches — real,
   honest assertions, narrower failure case than the guarantee in its title.
   Required cure: **D4 is rewritten, not extended** (test-plan §3.1), plus an
   independent forced-throw composer-level proof (**PX**). Both must be
   observed red-before/green-after by mutation, per the standing §9.3 rule,
   **and D4's red must be observed by someone other than its own author**
   (technical-plan DoD; test-plan §9).
2. **§9.1 DERIVED-DUAL-VIEW, new exposure (`buildItemTree` gaining consumers
   #2-#4 in this same slice).** The claim `<select>`, the add-item parent
   picker, and the edit-in-place parent picker must all render
   `flattenItemTree(buildItemTree(...))` — never a second hand-rolled
   flattening. **C3** is the mandated cure: a cross-consumer equality
   assertion over a *reordered* input array (not `deepEqual(f(X), f(X))`,
   which this catalog names as the vacuous degenerate form). This entry's own
   history (7 prior occurrences, most recently the 2026-08-05
   `value_source`/`compareUnitInputs` gap) is the reason C3 must derive both
   arrays independently rather than compare one to a hand-written expectation.
3. **§9.7 HAND-SCOPED STRUCTURAL SCAN (7 occurrences, OPEN — "cure remains
   half-built").** Technical-plan's originally-planned G-A/G-B (hand-scoped,
   two-file guards) are **superseded by test-plan §6**: a derived
   `assertTableWritersSingleHome` helper (writer set parsed from
   `server/db.js`'s own `stmts` registry, homes asserted by enclosing-function
   identity, plus a fifth "inline SQL write" axis with no statement name).
   This is not optional scope creep — the test-plan found a live fifth writer
   (`plan-lifecycle.js:288-290`, an inline `db.prepare(...)` inside legacy
   `doImport`, doing exactly what the new `reparentProjectPlanItem` does) that
   no hand-scoped guard would have seen. **Three mutation proofs are
   MANDATORY before this guard counts as built** (rogue call site → red;
   inline `.prepare` write → red; undispositioned new `stmts` entry → red) —
   test-plan §6's own stated fallback (four hand-scoped point guards) is
   permitted **only** if the derived helper cannot be built without weakening
   any of its five checks; weakening a check to keep it is explicitly not
   permitted.
4. **§9.8 OVERLOADED-ABSENCE, created by this build's own new capability.**
   A re-parent cycle, if unguarded, makes every member of the cycle vanish
   from `buildItemTree`'s `roots` — no error anywhere. Server-side rejection
   (P4-P7, at depth ≥ 4 per `DEC-S4-10` — a depth-2/3 fixture is explicitly
   rejected as insufficient) **and** UI exclusion of self+descendants (C7, at
   4 levels, asserting the **grandchild** specifically) are both required —
   per this project's rule, the structural cure is primary but a
   render-erasing corruption does not get a UI-only guard.
5. **Byte-identical wire contract (AC-13).** `POST /:id/claims` response
   shape, status codes, and the five/six named error strings must be
   byte-identical to `master` after the route becomes a delegator; every
   pre-existing claims test must pass **unmodified** — a test needing edits to
   pass means the refactor is wrong, not the test (technical-plan §7 risk
   row).

## Build-time obligations NOT performed by this triage pass (flagged forward)

Per `DEC-S4-4`/`DEC-S4-5` (this project's settled posture for exactly this
situation, set previously by `DEC-10`/`DEC-11`): catalog and request-tree
corrections are **not** applied to the dirty shared main checkout. They ship
as ready-to-paste files in this intake folder and are the **first commit**
obligation on the effort branch (technical-plan §4 step 1 / test-plan §4 step
1), owed to `build-planner`/`build-implementer`, not to this triage pass:

- Apply `catalog-patch.md` **then** `catalog-patch-qa.md` to
  `PROJECT-CONTEXT.md` §9.3/§9.9 on the **effort branch**, then delete both
  patch files in that same commit, so exactly one catalog exists.
- Append the dated `## Corrections` section to the parent
  `requests/2026-08-04-value-pool-grouping/request.md` (`DEC-S4-5`) — two
  falsified premises (the stale `OPEN-4` bullet, and "the claims API's atomic
  inline `new_item` already supports the shape").

These files exist, are ready to paste, and were read in full for this brief.
Neither has been applied anywhere — the worktree provisioned below carries
`PROJECT-CONTEXT.md` exactly as committed at `d3842493` (unmodified), which is
correct: this triage pass does not make product/doc commits.

## Worktree set

Single-repo project — one worktree.

| | |
|---|---|
| Path | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-plan-editing-ui/Claude-Code-Agent-Monitor` |
| Branch | `effort/2026-08-06-plan-editing-ui` (**new**, off `master` — **not** off `effort/2026-08-06-auto-group-proposal`) |
| Starting commit | `d3842493bb6902181cc4991c855bda25ffa6cf7d` |
| Base ref | `master` (== `origin/master`, `+0 -0` ahead/behind at fork time) |
| Command used | `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor worktree add /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-plan-editing-ui/Claude-Code-Agent-Monitor -b effort/2026-08-06-plan-editing-ui master` |
| Post-create status | `git -C <worktree> status --porcelain` → empty (clean) |
| Verified | `git -C <worktree> show HEAD:PROJECT-CONTEXT.md` byte-identical to the file on disk in the new worktree — confirms the worktree carries committed `HEAD` only, **not** the concurrent session's uncommitted edit (see "Dirty base branch" below) |

Existing sibling worktrees (unaffected, for reference):
```
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-trunk-drift-detection/Claude-Code-Agent-Monitor              effort/2026-08-02-trunk-drift-detection
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-trunk-drift-open-branch-blindness/Claude-Code-Agent-Monitor  effort/2026-08-03-trunk-drift-open-branch-blindness
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor              effort/2026-08-04-altitude-invalidation
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand-qa-fix/Claude-Code-Agent-Monitor          effort/2026-08-05-coverage-on-demand-qa-fix
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-05-coverage-on-demand/Claude-Code-Agent-Monitor                 effort/2026-08-05-coverage-on-demand
/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-auto-group-proposal/Claude-Code-Agent-Monitor                effort/2026-08-06-auto-group-proposal
```

## Back-out command

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-06-plan-editing-ui/Claude-Code-Agent-Monitor reset --hard d3842493bb6902181cc4991c855bda25ffa6cf7d
```

(No commits have been made in the worktree yet — this is a no-op reset to the
starting point, recorded here for when it isn't.)

## Dirty base branch — investigated in detail, ruled non-blocking for this build

`master` in the main checkout (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`)
is **not clean**:

```
$ git status --porcelain
 M PROJECT-CONTEXT.md
 M requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/build/2026-08-06-auto-group-proposal/build-brief.md
?? .claude/agent-plan-backups/
?? requests/2026-08-04-value-pool-grouping/intake/2026-08-06-auto-group-proposal/build/2026-08-06-auto-group-proposal/run-plan.md
?? requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/
?? requests/2026-08-06-session-stakeholder-summary/
```

This triage pass did **not** treat that as an automatic block. Reasoning,
with evidence, so it is auditable rather than asserted:

1. **`git worktree add` does not read the main checkout's working directory
   or index — only the ref/commit.** Verified directly: the new worktree's
   on-disk `PROJECT-CONTEXT.md` is byte-identical to `git show HEAD:PROJECT-CONTEXT.md`,
   not to the dirty file in the main checkout. Forking a worktree is
   mechanically safe regardless of the source checkout's uncommitted state —
   it cannot pick up, silently drop, or corrupt anyone's in-progress edit.
2. **The dirty `PROJECT-CONTEXT.md` diff is confirmed unrelated to this
   build.** Read in full (`git diff -- PROJECT-CONTEXT.md`): 65 lines, two
   catalog-note insertions, both scoped explicitly to
   `requests/2026-08-06-session-stakeholder-summary/intake/2026-08-06-session-summary/`
   — a different, unrelated intake. Nothing in the diff touches the "Repo
   topology" section, §9.1/§9.7/§9.8/§9.9 (the entries this build's own
   durable-cure obligations cite), or anything plan-editing-ui-related.
3. **The live process is confirmed and matches the task's account.**
   `ps aux` + `lsof -p <pid> | grep cwd` shows PID 264 (a long-running
   `claude` process, started Wed 09AM) with `cwd` = this repo root — the
   session actively working `requests/2026-08-06-session-stakeholder-summary/`
   (that folder exists, untracked, with a full intake artifact set:
   `request.md`, `technical-plan.md`, `pm-plan.md`, `decisions.md`,
   `supporting/{architect,qa,product-owner,engineer}.md`). This is a live,
   legitimate, unrelated concurrent session, not build debris — consistent
   with the task's framing, independently verified rather than taken on
   faith (per this project's own "verify before punting" convention).
4. **The second dirty file** (`.../2026-08-06-auto-group-proposal/build-brief.md`)
   is unrelated to this build for a different reason: it is stale, uncommitted
   *editorial* debris on **Slice 3's own** already-committed build-brief (the
   working copy holds the finished "READY, retry pass" text; the committed
   version at `d3842493` holds the superseded "BLOCKED" text — i.e. someone
   forgot to `git add`/commit an edit hours ago, mtime 07:28, six hours before
   this triage pass). Neither version touches plan-editing-ui.
5. **This project's own committed precedent independently reaches the same
   conclusion for the analogous case.** `decisions.md` `DEC-S4-4`/`DEC-S4-5`
   (this same intake, decided earlier today) rule that catalog/doc edits are
   kept **off** the dirty shared checkout and shipped as apply-on-the-effort-
   branch patch files instead — precisely so that a dirty, unrelated
   concurrent-session edit to `PROJECT-CONTEXT.md` does not block this
   slice's own effort-branch work. That decision's own citations (`DEC-10`,
   `DEC-11`) establish this as a repeated, deliberate project convention, not
   an improvised exception.
6. **Contrast with why Slice 3's own prior triage pass BLOCKED on a
   superficially similar dirty tree:** that pass's dirty `PROJECT-CONTEXT.md`
   diff was **load-bearing for the effort being triaged** — a 200-line §9.7
   SF-4 DISPOSITION note that Slice 3's own build-brief needed to cite, and
   whose "finished vs. still-in-progress" status was genuinely undetermined
   at that moment. Forking from `master`'s HEAD then would have silently
   *dropped* information that build depended on. Neither condition holds
   here: this build's dependency surface (its own intake folder's plans,
   decisions, addenda, catalog-patches) is fully self-contained and was read
   directly; nothing this build needs lives in the dirty diff.
7. **No git operation was performed against the main checkout beyond
   `worktree add`** (confirmed: no lock files, no in-progress
   merge/rebase/cherry-pick under `.git/`, `git status --porcelain=2` shows no
   conflict markers). The dirty state was read, not written to, stashed, or
   reset.

**Net: the new worktree is clean and independently verified; the main
checkout's dirty state is unrelated, confirmed live, and untouched.** This is
recorded in full so a human reviewing this brief can immediately see the
evidence and override if they read it differently — the intent is
transparency, not talking the gate down.

## Docker stack — not applicable

`docker-compose.yml`, `docker-compose.full.yml` (root) and
`monitoring/docker-compose.yml` exist (re-confirmed unchanged since Slice 1-3
triage): single-container production deployment wrapper / an opt-in
Prometheus+Grafana observability stack — not a per-effort isolated dev stack.
`PROJECT-CONTEXT.md` names no per-effort port registry or cross-service
override registry. Both plans run verification directly in the worktree
(`npm run test:server`, `npm run test:client`, targeted `node --test`, `npx
vitest run`) — no compose invocation anywhere in either plan. Skipped.

## Effort registry

`PROJECT-CONTEXT.md` names no formal effort registry file distinct from
itself; not applicable — skipped per step 8's own escape hatch (consistent
with every prior slice's triage in this initiative).

## Open questions

**Non-blocking, with stated assumption:**
- **4b's fork point** (`WATCH-S4-C`, pre-existing) — deliberately deferred to
  4b's own start, per `DEC-S4-1` constraint 2. Assumption: this triage's job
  is 4a only; 4b will get its own triage pass once Slice 3's merge state (or
  an explicit PM ruling to fork from the Slice 3 branch) is known.
- **Merge-order collision** (`WATCH-S4-A`, pre-existing) — `PlanLedgerPanel.tsx`,
  its test file, all four locale files, and the snapshot baseline are touched
  by both this effort and the unmerged Slice 3 branch. Assumption: whichever
  merges second rebases and reviews (never blind-regenerates) the snapshot
  diff, per the tracked row; not this triage's action to take.
- **Catalog-patch / request.md correction application** — assumption stated
  above under "Build-time obligations NOT performed by this triage pass":
  owed to the first commit on this effort branch, not to triage.

**BLOCKING:**
- None. Both plans are buildable and correspond; the new worktree is clean;
  the dirty main checkout is confirmed unrelated and mechanically inert to
  the fork operation performed.
