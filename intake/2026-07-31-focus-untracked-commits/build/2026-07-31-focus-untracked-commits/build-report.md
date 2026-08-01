# Build Report — 2026-07-31-focus-untracked-commits

> Authored by `build-lead`, synthesizing the build brief, task list, red/green
> evidence, and review. The document the user reads. This build **stopped at
> green** — it did not commit, push, or open a PR.

## What was built

This is a retroactive-documentation-plus-two-live-bug-fix effort closing the
process gap `team-status` flagged: seven merged commits (`0416066`..`60af828`)
that shipped with no intake record. Six of eight action items are paperwork —
`decisions.md` DEC-7/DEC-8 (retroactive, recording decisions Sara already made
when `/focus` and the AI window-summary feature shipped) plus DEC-9 (a new,
still-open decision), and `PROJECT-CONTEXT.md`'s **first** formally catalogued
`## Recurring defect-class patterns` section, naming `DERIVED-DUAL-VIEW`
(§9.1) and `row-id-as-chronology-proxy` (§9.2). The other two are real,
contained code fixes against currently-shipped, currently-live bugs this
retroactive review surfaced: (1) `server/lib/focus-inference.js`'s
`buildActivityDigest()` sorted `events` by `id` and applied `LIMIT` *before*
sorting by `created_at` — the 3rd instance of `row-id-as-chronology-proxy` on
this codebase, and the worst failure mode yet (a bad `LIMIT`-selected subset,
not just a bad order — a JS-level post-fetch sort would not have fixed it);
and (2) `client/src/hooks/useHourWindowZoom.ts`'s live-zoom branch read raw
`Date.now()` on every render instead of a state value ticking once per 60s,
tripping a React "Maximum update depth exceeded" render cascade. A second
fix-loop, driven by review, closed a related gap in the same hook: after the
first fix, switching *back* to live mode (clicking "Live," or navigating back
to today) left the window frozen on stale time for up to 60s because `nowMs`
wasn't eagerly resynced on the `isLiveZoom` false→true transition — now fixed
with an eager `setNowMs(Date.now())` call in that effect, with its own
regression test. End state: `master`'s behavior is unchanged except for these
two live-bug fixes; the pipeline has a complete paper trail; the next
contributor touching a `FocusReport` consumer or the `events` table has a
named pattern to grep for.

## Change verdict

**Verdict:** GREEN (final, after one review-driven fix-loop; the standalone
verifier pass recorded GREEN-WITH-CAVEATS, both caveats independently judged
safe and non-blocking — see below)

**Durable cure:** Applied, both MANDATORY cures —
- `row-id-as-chronology-proxy` (`PROJECT-CONTEXT.md` §9.2, 3rd recorded
  instance): fixed at the SQL level (`ORDER BY created_at ASC, id ASC LIMIT
  ?`), not via a JS-level post-fetch sort. Confirmed by grepping the diff for
  `.sort(` — none added.
- `DERIVED-DUAL-VIEW` (`PROJECT-CONTEXT.md` §9.1, 4th recorded instance):
  fixed at the hook's one source (`useHourWindowZoom.ts`), not per-consumer;
  pinned by a new cross-view parity test asserting on a shared fixture object
  reference, not two separately-authored "equivalent" fixtures.

**Important distinction:** this build did not *re-apply* pre-existing catalog
entries — it is the event that created `PROJECT-CONTEXT.md`'s catalog
section in the first place. Both patterns had been informally named in prior
build-report.md files and run-log rows (`focus-report-fidelity`,
`focus-calendar-board`, `wip-queue-page` for `DERIVED-DUAL-VIEW`; `6e9a443`,
`b3a2cc9` for `row-id-as-chronology-proxy`) but never formalized into a
catalog document until this build. Treat this as catalogue-creation, not a
repeat shortcut — though it is worth Sara noting that the 3rd/4th occurrence
of each pattern is exactly what finally triggered the formalization; a prior
QA run (`intake/2026-07-28-wip-queue-page/`) had already recommended doing
this after the pattern's 3rd occurrence and it wasn't acted on until now.

A third, narrower structural question — whether to also build the two
*generalizing* guards (a `FocusReport`-consumer registry meta-test; an
`ORDER BY id`-without-`created_at` grep/AST guard) — was explicitly scoped
out of this build and recorded as **DEC-9, PENDING**, not decided by the
build team. See "Open decisions" below.

## Red → green evidence

| Test | Layer | RED before | GREEN after |
|------|-------|-----------|-------------|
| `server/__tests__/focus-inference.test.js` — "orders prompts by created_at, not by id/insertion order" | integration (SQLite-backed) | ✅ `deepStrictEqual` mismatch — prompts returned in insertion order, not chronological order | ✅ |
| `server/__tests__/focus-inference.test.js` — "selects the chronologically-correct subset before LIMIT, not an id-ordered subset (trap-defeating LIMIT case)" | integration (SQLite-backed) | ✅ `digest.prompts.length` `0` vs expected `1` — target row dropped by `LIMIT` before JS ever saw it (proves a JS-level `.sort()` fix would not have worked) | ✅ |
| `client/src/hooks/__tests__/useHourWindowZoom.test.ts` — "live-zoom render-cascade regression: keeps windowStartMs/windowEndMs bit-identical across unrelated re-renders... with no extra self-triggered renders and no console.error warning" | unit (renderHook) | ✅ `1785517200001` vs expected `1785517200000` — a 1ms clock nudge (far short of the 60s tick) shifted the window on every render | ✅ |
| `client/src/components/__tests__/FocusReportModal.test.tsx` — "[FocusPage extension of the standing template] ..." | unit/component (RTL, cross-tree parity) | ✅ (manufactured-divergence proof, since the natural-red check came back green — no live bug at this exact spot): one-line `Math.round`→`Math.floor` divergence in `FocusPage.tsx` produced `Unable to find an element with the text: 67%` in `pageContainer` scope, confirming the test genuinely diffs the two trees | ✅ (divergence reverted, confirmed byte-identical, 24/24 green in the file) |
| `client/src/hooks/__tests__/useHourWindowZoom.test.ts` — "live re-anchor on a false→true isLiveZoom transition: resyncs windowStartMs/windowEndMs to the current time immediately on switching back to live, without waiting for a ZOOM_REFRESH_MS tick" (added in the review-driven fix-loop) | unit (renderHook) | ✅ implementer proved red against the pre-fix hook (`nowMs` stayed frozen at the pre-detour time after the live re-anchor); verifier independently re-derived red by reverting the fix's one added line (`setNowMs(Date.now())` inside the `isLiveZoom` effect) and re-running | ✅ (fix line restored, confirmed green; verified live in the worktree at time of this report — see below) |

Backfill (should-add, non-blocking, guard already-shipped code — no live bug
at these three spots):

| Test | Result |
|---|---|
| `server/__tests__/focus-report.test.js` — `>65,536`-interval regression (70,001 intervals, loop-push arithmetic sanity) | GREEN on first run (already-fixed `master`). Manufactured-red proof **not performed** — blocked by the test-author's own permission classifier from touching `server/lib/focus-report.js`, correctly deferred rather than forced/faked. Verifier independently re-derived the reason it can't currently go red on this Node version: this environment's real V8 spread-push ceiling is ~109,827 elements (binary-searched), not the historical ~65,536 the original bug comment cites — the fixture's 70,000-event size sits safely below that on modern Node. The fix itself (loop-push vs. spread-push) is still correct and unaffected; this is a weaker-than-intended regression guard specifically against a future revert, not a defect in the shipped code. |
| `client/src/components/__tests__/ConcurrencyStatTile.test.tsx` (new, 4 cases) | GREEN on first run (already-shipped, already-working component). Manufactured-red proof not performed for the same permission-classifier reason, correctly deferred to the implementer rather than forced. |
| `server/__tests__/settings-export.test.js` (new, 2 cases) | GREEN on first run — expected outcome per the test-plan itself ("no fix to prove against... a mismatch here would indicate a real bug in the already-shipped route"). No stop-and-report trigger hit. |

## Files changed

```
$ git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-07-31-focus-untracked-commits/Claude-Code-Agent-Monitor diff --stat dfe9208
 .../components/__tests__/FocusReportModal.test.tsx | 237 ++++++++++++++++++++-
 client/src/hooks/useHourWindowZoom.ts              |  42 +++-
 client/src/pages/__tests__/FocusPage.test.tsx      |  16 +-
 server/__tests__/focus-inference.test.js           |  78 +++++++
 server/__tests__/focus-report.test.js              |  55 +++++
 server/lib/focus-inference.js                      |   9 +-
 6 files changed, 420 insertions(+), 17 deletions(-)
```

Plus untracked (new) files, not captured by `diff --stat` against a commit:
- `client/src/hooks/__tests__/useHourWindowZoom.test.ts` (new, 287 lines, 10
  cases — the 9 the test-author wrote plus 1 added by the review-driven
  fix-loop)
- `client/src/components/__tests__/ConcurrencyStatTile.test.tsx` (new, 106
  lines, backfill)
- `server/__tests__/settings-export.test.js` (new, 199 lines, backfill)
- `PROJECT-CONTEXT.md` (new file in this worktree — the repo's first;
  §"Repo topology" + §"Recurring defect-class patterns" §9.1/§9.2)

Outside the worktree, in the main checkout's intake folder (correct per this
project's convention — a docs/process deliverable scoped to the intake
folder, not the code worktree):
- `intake/2026-07-31-focus-untracked-commits/decisions.md` (new — DEC-7,
  DEC-8, DEC-9)

Product code touched: exactly 2 files
(`server/lib/focus-inference.js`, `client/src/hooks/useHourWindowZoom.ts`),
both matching the two named live-bug fixes, nothing else.

## Standing guards + Definition of Done

- [x] Each new test observed RED before, GREEN after (5 must-add cases +
      1 fix-loop case, all confirmed for the right reason, not a
      setup/compile failure)
- [x] Full relevant suites green: `npm run test:server` **1052/1052**;
      `cd client && npx vitest run` **660/660** (confirmed live in the
      worktree at report time — 659 at the standalone verifier pass, +1 from
      the fix-loop's new regression test)
- [x] `cd client && npx tsc --noEmit -p .` clean
- [x] `bash .claude/skills/file-headers/scripts/check-headers.sh` — exit 0,
      "All applicable files carry the authorship header" (re-confirmed live)
- [x] Both MANDATORY durable-cure obligations met (`row-id-as-chronology-proxy`
      SQL-level fix; `DERIVED-DUAL-VIEW` shared-hook fix + shared-fixture
      parity test) — confirmed by direct code reading, not just green tests
- [x] `PROJECT-CONTEXT.md` catalog section present, both entries verbatim
      per technical-plan §9
- [x] `decisions.md` has DEC-7, DEC-8 recorded; DEC-9 recorded as explicitly
      PENDING, not silently resolved either way
- [x] No collateral damage: `screens.snapshot.test.tsx` shows no diff;
      `git status --porcelain` shows only the files listed above touched
- [x] Review pass 2: PASS, 0 blockers, confirmed the fix-loop introduced no
      new issue

## Worktree & stack

- **Worktree path:**
  `/Users/sara/CODE-LOCAL/SARA/efforts/2026-07-31-focus-untracked-commits/Claude-Code-Agent-Monitor`
  (branch `effort/2026-07-31-focus-untracked-commits`, cut from `master` at
  `dfe9208`) — this is where the diff actually lives; not the shared main
  checkout (`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`), which
  has unrelated pre-existing uncommitted changes (`server/db.js`,
  `server/routes/run.js`, `capture-claude-usage.sh`,
  `server/lib/origin-guard.js`) that were correctly never touched or carried
  into this effort.
- **`decisions.md`** lives in the main checkout's intake folder
  (`intake/2026-07-31-focus-untracked-commits/decisions.md`), per this
  project's docs/process convention — not in the worktree.
- **Docker stack:** not provisioned. Both plans' verification loop is
  `npm run test:server` + `cd client && npx vitest run`, no containerized
  dependency; same call the prior `focus-calendar-board` effort in this repo
  made for the same reason.

## Residual risk & back-out

**Watch:**
1. DEC-9 leaves both generalizing structural guards (a `FocusReport`-consumer
   registry meta-test; an `ORDER BY id`-without-`created_at` grep/AST guard)
   unbuilt. This is the 4th/3rd occurrence of each pattern respectively, and
   a prior QA run already recommended building the `DERIVED-DUAL-VIEW` guard
   after the 3rd occurrence without it being acted on — worth deciding one
   way or the other rather than letting a 5th/4th instance repeat the cycle.
2. The `>65,536`-interval backfill test (`focus-report.test.js`) is a weaker
   regression guard than intended on modern Node — a future revert of the
   loop-push fix back to spread-push would currently sail through undetected
   at the test's 70,000-event fixture size, since this environment's real V8
   ceiling sits at ~109,827 elements. **Recommended non-blocking follow-up:**
   bump `EVENT_COUNT` in that test to a value safely above the observed
   boundary (e.g. ~150,000) so the manufactured-red proof becomes achievable
   again. Does not affect either MANDATORY durable cure and does not gate
   this build.
3. `windowIsFuture` in `useHourWindowZoom.ts` was deliberately left reading
   raw `Date.now()` rather than the new `nowMs` state — a literal-text
   deviation from the technical plan's suggested change, independently
   verified safe (it feeds no effect, only a pure JSX conditional banner, and
   switching it to `nowMs` would make it *more* stale, not less, since its
   whole job is "right now"). Flagged so it isn't mistaken for an oversight
   later.

**Back-out (single repo touched):**
```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-07-31-focus-untracked-commits/Claude-Code-Agent-Monitor reset --hard dfe920874b68f1219f0b16268864894ef542eb48
```
Note this reverts the worktree's code/test changes only; `decisions.md` and
`PROJECT-CONTEXT.md`'s new section (if later committed in the main checkout)
would need to be reverted there separately if the whole effort is undone.

## Open decisions

- **DEC-9 — PENDING.** Whether to build the two generalizing structural
  guards (`FocusReport`-consumer registry meta-test; `ORDER BY id`-without-
  `created_at` grep/AST guard) now, or continue accepting per-instance point
  fixes. Explicitly flagged for Sara, not decided by the build team. See
  `intake/2026-07-31-focus-untracked-commits/decisions.md`.
- DEC-7, DEC-8: DECIDED (retroactive documentation only, no open action).

## Next step

Stops at green. **The user commits / pushes / opens a PR — or hands it back
for changes.** This skill does not commit. It does **not** tear down the
worktree at
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-07-31-focus-untracked-commits/Claude-Code-Agent-Monitor`
— that stays live until whoever merges runs the manual teardown. No Docker
stack was provisioned, so there is nothing to tear down there.
