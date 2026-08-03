# QA Assessment — trunk-drift-detection (Phase 1a)

> Authored by `qa-strategist`. **This is the document the user reads first.** It
> answers: is the change adequately tested, where are the gaps, have we shipped
> this *class* of gap before, and how do we stop it.
>
> **Pre-build pass.** No code exists yet. The verdict below is about whether the
> **planned test design** in `supporting/unit-tests.md` + `supporting/e2e-tests.md`
> would guard this change once built — not about coverage of code on disk. The
> cartographer confirmed a fully-green baseline first (server 1370/1370, client
> 718/718), so every gap named here is a gap in the *plan*, not a red test.

## Change summary

Phase 1a adds a read-only "did work land straight on trunk?" detector: a new
`server/lib/trunk-drift.js` walks a repo's default-branch first-parent line with
one bounded `git log`, a new `GET /api/projects/:id/trunk-drift` route returns
one result per mapped repo, and a new read-only card on Project Detail renders it
in all four locales. Nothing is written — no schema change, no `detour_dispositions`
row, no LLM call. To avoid two independent "what is trunk?" guesses, four git
primitives (`execGit`, `listRemotes`, `pickCanonicalRemote`, `REMOTE_PRIORITY`)
are extracted out of the existing `update-check.js` into a shared
`server/lib/git-refs.js`, joined by a new `resolveDefaultBranch`. One
Phase-1b-adjacent edit rides along: the DEC-4 carve-out, two `log()` calls added
to `reconciliation.js`'s currently-silent `parseDispositionOutput` failure path.

## Coverage verdict

**GAPPED** — and one decision away from BLIND.

The planned design is the strongest this project has produced in three QA cycles.
It picks up things that were owned by nobody last round: the i18n four-locale
completeness meta-test (`unit-tests.md` §6) is exactly the registry-derived guard
the `practice-kind-override` pass had to flag as unowned; the clause-3
`--exclude`/`--branches` red-proof that `risk.md` §10 flagged as missing from the
plan's DoD **was** picked up by `unit-tests.md` §1 case 3b; the client-side
false-clean guard is designed with a `not.toBe` cross-check (case 3) rather than
two independently-passable assertions. Credit where due — most of the surface is
genuinely covered.

But four real surfaces are UNGUARDED by the plan as written, and the worst one is
worse than "missing": **the guard `risk.md` proposes for it would pass while the
regression it names ships.** That is §9.3 VACUOUS-GUARD, the entry that survived
two consecutive BLOCKED verifier passes on this project. If the build writes that
assertion in its proposed form, ticks the DoD box, and moves on, this verdict
should be read as BLIND retroactively. See Gap 1.

Not BLIND today because: the single most load-bearing invariant (DEC-5's
false-positive guard, cases 3/3b) *is* designed with mutation red-proofs on both
clauses; no catalog entry is OPEN on a Phase-1a surface; and every gap below is a
specific, addable assertion rather than a structural blind spot in the harness.

## Current coverage

Cartographer's live baseline, run at HEAD against the pre-change tree:

| Layer | Result |
|---|---|
| Targeted (`update-check`, `repo-topology`, `reconciliation`, `reconciliation-full-tick`, `projects`) | 29 suites / **95 pass, 0 fail** |
| Full server (`npm run test:server`, 78 files) | 332 suites / **1370 pass, 0 fail** |
| Full client (`npm run test:client`, 59 files) | **718 pass, 0 fail** |

What guards the touched surfaces **today**:

- **`update-check.js` — PARTIAL.** `update-check.test.js` covers `getUpdatesStatus`
  end-to-end across all five branch/remote situations with real bare-remote + clone
  fixtures. It never imports `listRemotes`/`pickCanonicalRemote`/`REMOTE_PRIORITY`
  directly, so it is a black-box behavior-preservation proof — appropriate for this
  refactor, but it cannot localize a fault, and it exercises no remote topology
  outside its own five fixtures.
- **`GET /:id/repos` shape — GUARDED.** `projects.test.js:867+` pins the exact key
  set; an accidental widening by the sibling route would fail today.
- **`repo-topology.isGitRepo` — GUARDED.** Directly exercised; not edited this phase.
- **`parseDispositionOutput`'s silent catch — UNGUARDED.** Confirmed by direct read:
  no test in either reconciliation spec ever feeds it malformed stdout; all five
  `envelope(...)` call sites construct valid JSON. The happy path is covered
  thoroughly (including the §9.1 byte-parity assertion); the failure path is not
  reached by anything.
- **`git-refs.js`, `trunk-drift.js`, the new route, the card, the new types/api
  method — UNGUARDED.** None exist.

## Gaps & test-debt diagnosis

### Gap 1 — the `execGit` timeout trap: real risk, wrong mechanism, and the proposed guard is vacuous (HIGH)

This is the first of the two findings escalated to me for a verdict, and it needs
a correction before it is actioned.

**Verdict: the unit-test plan does not guard it — and neither would `risk.md`'s
proposed assertion.**

`unit-tests.md` §2.1 is the single-home structural scan. It asserts five things
about `update-check.js`'s source: that it requires `./git-refs`, that it no longer
privately declares `listRemotes`, `pickCanonicalRemote`, or `REMOTE_PRIORITY`, and
that the destructure actually pulls the first two names in. `execGit` appears in
none of them. Worse, the positive-match regex

```js
assert.match(src, /\{[^}]*\blistRemotes\b[^}]*\}\s*=\s*require\(["']\.\/git-refs["']\)/s)
```

matches happily against `const { execGit, listRemotes, pickCanonicalRemote } =
require("./git-refs")` — i.e. **the scan the plan calls its single-home guard is
blind by construction to the exact rewiring `risk.md` §8 trap 2 names as the
highest-severity refactor risk.** `risk.md` named it; `unit-tests.md` did not pick
it up. Clean hand-off loss between two independently-authored design docs.

**Now the correction.** I read `server/lib/update-check.js` in full. The premise
that the 120 s default protects `git fetch` is **wrong**: every one of the nine
`execGit` call sites in that file passes an explicit `timeout`, including the fetch
itself —

```js
// server/lib/update-check.js:139
await execGit(root, ["fetch", canonicalRemote, "--prune"], { timeout: 120_000 });
```

— with the other eight at `10_000` (×7) and `30_000` (×1). The `opts.timeout ??
120_000` default on line 22 is **dead today; no call site reads it.** Rewiring
`update-check.js` onto `git-refs.js`'s 10 s-default `execGit` would, on its own,
change nothing at all.

So `risk.md`'s proposed required assertion — "source-level check that
`update-check.js`'s `execGit` still exists locally with its own `120_000` default"
— pins a value no production path consumes. It is green whether or not the feature
works, which is §9.3's "a fixture in a state no real call site can produce" in its
subtlest form. Writing it would produce a checkmark that protects nothing, on the
one *existing shipped feature* this refactor can break.

**The behaviorally load-bearing invariant is the fetch call site's effective
timeout, not the function's default.** The real regression path is the tidy-up
move: after Step 1, `update-check.js` has a private `execGit` sitting next to a
`require("./git-refs")` destructure, and the obvious "clean this up" edit is to
fold `execGit` into the destructure *and* drop the now-redundant-looking explicit
`{ timeout: 120_000 }` on line 139. That composite change is silent, invisible to
local-fixture tests, and only fails against a slow real remote.

### Gap 2 — DEC-4 instruments one of five silent exits; the console spy proves the wrong thing (HIGH)

Second escalated finding. **Verdict: the console-spy design is sufficient to prove
the two `log()` calls fire and are behavior-neutral. It is not sufficient to prove
the fix achieves its stated purpose — and that purpose gates the roadmap.**

The spy mechanics are sound. I traced both fixtures against the real function
(`reconciliation.js:198`): `"not json at all"` throws on the first `JSON.parse` and
reaches the terminal catch; the `{result: JSON.stringify({verdicts:[{id:999,…}]})}`
fixture parses cleanly and yields `out.size === 0` because `999 ∉ flaggedIds`. Both
hit their intended branch. The dual `console.error`/`console.warn` spy is the right
hedge for a not-yet-written call site (this repo's convention is
`console.warn("[TAG] …")` — see `alerts.js`/`webhooks.js`; `reconciliation.js` has
**zero** console calls today, so there is no existing `log` helper to bind to). The
architect's red-first note — run all three against today's `reconciliation.js`,
watch `calls.length` fail `0 !== 1` while `result.size` still passes — satisfies
§9.3 properly. Case 3 (no logging on the happy path) is a genuinely good addition.

The problem is upstream of the spy. `classifyFlaggedDetours` has **five silent
returns of an empty Map**, and DEC-4 instruments the fifth only:

```js
async function classifyFlaggedDetours(dbModule, target, flagged, opts = {}) {
  if (!flagged || flagged.length === 0) return new Map();            // 1 silent
  if (RECONCILE_MODE === "off") return new Map();                    // 2 silent
  if (FOCUS_INFER_MODE === "off") return new Map();                  // 3 silent
  if (!(await focusInference.probeClaudeCli())) return new Map();    // 4 silent
  const stdout = await focusInference.runClaudePromptJson(prompt, opts);
  if (stdout == null) return new Map();                              // 5 silent  <-- NOT instrumented
  return parseDispositionOutput(stdout, flagged);                    //           <-- DEC-4 logs in here
}
```

Exit 5 is the one that matters. `runClaudePromptJson` (`focus-inference.js:310`)
resolves `null` on **spawn error, non-zero exit, or the kill-timer firing** — and
`focus-inference.js` has no logging either. So a reconciliation tick where the
Claude CLI is missing, crashes, or times out produces exactly the same observable
signature after DEC-4 as before: nothing.

That matters because `decisions.md` states DEC-4's purpose explicitly: it "ships in
Phase 1a **specifically to make this trial easier to run**, since the pipeline's
dominant failure mode is currently silent" — the trial being DEC-7/WATCH-5's live
inspection of a pending `decision_queue` write-back failure, which is the **hard
gate on all of Phase 1b**. DEC-4 also serves as the promotion detector for the
PARKED SHARED-BUDGET-STARVATION candidate ("once DEC-4's logging fix ships,
condition (b) becomes observable rather than silent," `decisions.md` ~line 403).

Nothing anywhere establishes *which* of the five exits actually dominates in Sara's
live install. DEC-4 covers "the CLI answered, and the answer was garbage." If the
dominant mode is instead "the CLI never answered," the fix ships, the suite is
green, the trial is run against a still-silent pipeline, and a roadmap gate gets
evaluated with an instrument that didn't instrument. That is not a test-design
defect — the architect tested precisely the two lines the carve-out authorizes —
it is a **scope defect in DEC-4 itself**, surfaced by asking what the test proves
rather than whether it passes.

### Gap 3 — the worktree flow that DEC-5 clause 3 exists to protect has no fixture (MEDIUM-HIGH)

`risk.md` §3 Assumption C names it and neither test doc picked it up. Clause 3
(`--not --exclude=refs/heads/<trunk> --branches`) exists specifically so
declared-focus/worktree work is not flagged, yet all 14 planned cases build feature
branches with plain `git branch`/`git checkout`. No case creates one via
`git worktree add`. The assumption (a linked worktree's branch is a normal
`refs/heads/` ref in the same repo, so `--branches` sees it) is almost certainly
correct — but "almost certainly correct" is the state every accepted-then-regressed
assumption starts in, and this is the project's own flow. Cheap to close:
`repo-topology.test.js:105` already does `git(repo, ["worktree", "add", linkedPath,
"feature"])`; copy that line into one case.

### Gap 4 — per-repo failure isolation is asserted for `skipped`, never for a throw (MEDIUM)

`risk.md` §7 names a concrete required assertion: one mapped repo's git call
*fails* and the other repos' results still come back. Both test docs picked up the
adjacent-but-weaker version — `unit-tests.md` §4 does clean-vs-direct, `e2e-tests.md`
§4.5 does populated-vs-`no_commits`. Neither injects a genuine failure. `skipped`
is a value `detectTrunkDrift` returns on purpose; a throw is what happens when it
doesn't. "Never throws" is a contract on one function, not a property of the route's
iteration loop, and the loop is what fans out over N repos.

### Gap 5 — locale *content*, and WATCH-1's card framing (LOW-MED, both non-test)

The i18n meta-test proves every locale has a non-key-echoing string. It cannot
prove `ko`/`vi`/`zh` aren't English placeholders. Correctly left to the
snapshot-diff eyeball — flagged only so it's an accepted residual, not an assumed
one. Separately, `risk.md` §6 makes a substantive point I agree with: WATCH-1's
rationale is written entirely in Phase-1b's cost model (a dismissible queue row),
but Phase 1a ships a **card a human reads and trusts**, with no dismissal
mechanism and no caveat copy. Not test-addressable; needs a tracked row.

### The systemic reason

Every one of Gaps 1, 3 and 4 has the same shape: **`risk.md` named it, and neither
test-design doc picked it up.** Invariants are hand-carried from the risk pass into
two independently-authored documents with no reconciliation step, so an invariant
lands in both, one, or neither — and nothing detects "neither." This is verbatim
systemic cause (D) from the `practice-kind-override` assessment one day ago, where
i18n completeness ended up owned by nobody. That specific invariant got fixed this
round; the *mechanism that dropped it* did not, and it dropped three different
things instead.

Underneath Gap 1 specifically sits a second, sharper cause: **this project's
structural guards enumerate their own scope by hand.** `unit-tests.md` §2.1 scans
for three names because a human typed three names, while four move to `git-refs.js`.
Nothing compares the scanned set against the shared module's real export surface —
so the guard is not merely incomplete, it is incomplete *and* green, which reads as
enforced.

**Have we shipped this class of gap before?** **Yes — 4x, and it is a new catalog
entry as of this pass: §9.7 HAND-SCOPED STRUCTURAL SCAN (OPEN).**

I did not adopt the cartographer's candidate framing ("shared extraction with no
import-graph guard," under §9.1's family) — on inspection it's not right. There
*is* an import-graph guard here; §9.1's cure was applied. The failure is one layer
in: the guard's own name-list is hand-maintained and short by one. Cited instances,
all already recorded in this project's own catalog prose but never named as a
pattern:

1. **2026-08-01, `build-project-manager`** — §9.2's chronology SQL scan used a body
   class of ``[^`'"]``, silently skipping every statement containing a quoted
   literal (5 of 11 candidates), and **reported clean**. Recorded as §9.2 build-
   outcome lesson 1: *"a scanner that under-scans is worse than none."*
2. **2026-08-01, same build** — `single-writer-guard.test.js` scanned for copies of
   `applyDisposition` but not of its helper `enqueueIfNotOpen`; the copy shipped,
   and **it was the wrong one** (dedup probe on `item_id IS NULL` vs an insert
   storing a real `item_id`). Recorded as §9.1's build-outcome lesson.
3. **2026-08-02, `practice-kind-override`** — the planned `playbook-resolver-guard`
   scans for raw `practice.kind` reads and structurally cannot see `playbookStore.ts`'s
   client-side copy of the same precedence rule. Recorded as §9.1's QA-pass note,
   flagged there as *"§9.1's own 2026-08-01 lesson reproduced one day later."*
4. **2026-08-02, this pass** — `unit-tests.md` §2.1 enumerates 3 of the 4 names
   moving to `git-refs.js`; the omitted one is the highest-severity risk in the
   whole refactor, and the scan's own regex matches the bad state.

Three separate catalog entries (§9.1's guard, §9.2's scan, §9.6's proposed
`REBUILD_CASES` scan) have each independently recommended a hand-enumerated static
scan as their durable cure. This entry is about the failure mode those cures share.
Not a regression-of-a-fix — the fixes work; their *scope* is the un-guarded part.

## Recommendation

**Must-add-now — gate this change. Worst first.**

1. **Fix Gap 1's assertion before writing it.** Do *not* write `risk.md`'s proposed
   "`execGit` still defaults to `120_000`" check — it cannot fail. Write instead, in
   `git-refs.test.js` §2.1:
   - `assert.doesNotMatch(updateCheckSrc, /\{[^}]*\bexecGit\b[^}]*\}\s*=\s*require\(["']\.\/git-refs["']\)/s)`
     — `update-check.js` must not import the shared `execGit`;
   - `assert.match(updateCheckSrc, /"fetch"[\s\S]{0,160}timeout:\s*120_000/)`
     — the fetch call site keeps its explicit 120 s, which is the value that is
     actually load-bearing;
   - red-proof both by injection (add `execGit` to the destructure; delete the
     explicit timeout), per §9.3. Record the red observation.
2. **Decide DEC-4's scope (Gap 2)** — see Open decisions. Either add one assertion
   per remaining silent exit (a `log()` on exits 4 and 5, ~4 lines of product code,
   3 more spy cases), or amend `decisions.md` to record that DEC-4 covers the
   CLI-answered-with-garbage path only and that WATCH-5's trial must not be read as
   conclusive on a silent tick. Do not ship the current framing unchanged — it
   claims to de-silence a pipeline it de-silences one-fifth of.
3. **Add the `git worktree add` fixture** (Gap 3). One case, one line copied from
   `repo-topology.test.js:105`.
4. **Add the injected-failure isolation case** (Gap 4) — one mapped repo whose git
   invocation genuinely fails (chmod the `.git` dir, or point at a corrupt repo)
   alongside a healthy one; assert the healthy repo's `drift` is fully populated and
   the failing one reports `git_error`, in the same 200 response.
5. **Promote both clause red-proofs into the DoD** (`unit-tests.md` case 3 *and*
   3b). They exist in the test-design doc but the plan's §8 DoD names only the
   `--first-parent`/`--no-merges` one. §9.3's acceptance criterion is a *recorded*
   red state; an unrecorded one is indistinguishable from an unperformed one.

With 1–5 in, this change is **safe to ship**. None of them is large; items 1, 3 and
4 are one assertion each.

**The durable cure — kills the whole class, not this instance.**

Add `server/__tests__/helpers/single-home.js` exporting

```js
assertSingleHome(sharedModulePath, { [consumerPath]: { shared: [...], private: [...] } })
```

which reads `Object.keys(require(sharedModulePath))` and **fails if any export has
no explicit disposition at any listed consumer.** Adding a fifth export to
`git-refs.js` without saying "shared here / private there" then fails the scan
instead of silently widening its blind spot. Applied to this change, it would have
forced someone to write `execGit: private in update-check.js` — and then to answer
*how that is checked*, which is the question that surfaced this whole gap. Follow
`chronology-ordering.test.js`'s `GRANDFATHERED_QUERIES` convention for anything
deliberately left hand-typed: a dated reason, not a weakened scan.

Pair it with a lighter process fix for the hand-off loss: **`risk.md`'s "required
assertion" bullets get an explicit owner line in each test-design doc** — picked up
in §N, or declined with a reason. Three of this round's five gaps are invariants
that were correctly identified and then simply not carried across.

## Open decisions for the user

- [ ] **DEC-4's scope — the one real decision here.** Widen the carve-out by ~4
      lines to log on exits 4 and 5 of `classifyFlaggedDetours` (CLI unavailable /
      CLI returned nothing), so the fix actually de-silences the failure mode
      `decisions.md` calls dominant — **or** keep the authorized two-line scope and
      record in `decisions.md` that WATCH-5's live trial may observe a silent tick
      that DEC-4 does not explain. Widening is Phase-1b-adjacent scope creep on a
      deliberately narrow carve-out; not widening leaves a roadmap gate resting on a
      partial instrument. My recommendation: widen — it is 4 lines, it is
      logging-only, and DEC-4's entire justification for existing in Phase 1a is
      that trial.
- [ ] **Durable cure now, or point fixes only?** `assertSingleHome` is ~40 lines and
      would close a 4x pattern. The point fixes in Must-add 1 close this instance in
      ~6 lines. Doing only the point fixes is a defensible call for a Phase-1a
      read-only feature — but §9.7 then stays OPEN with no cure, and by its own
      history it recurs about once a day.
- [ ] **WATCH-1's Phase-1a card framing.** `risk.md` §6 is right that WATCH-1's
      rationale reasons entirely about Phase 1b's cost model. Amend WATCH-1 to cover
      the read-only card, or add caveat copy to the card itself. Either is small;
      leaving it is the "disclosed only as prose in a document about a different
      phase" trap. Not test-addressable — needs your call, not a test.
- [ ] **Locale content correctness** stays a manual eyeball. Confirm that's accepted
      rather than assumed.

---
*Memory updated:* qa-run-log.md ✅ · this project's recurring-issue catalog ✅
(`PROJECT-CONTEXT.md` — **new entry §9.7 HAND-SCOPED STRUCTURAL SCAN**, 4 cited
occurrences; §9.3 cross-referenced; no existing entry's count changed — nothing
built yet)
