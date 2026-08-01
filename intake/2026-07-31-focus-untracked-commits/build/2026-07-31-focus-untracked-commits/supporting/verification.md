# Verification — 2026-07-31-focus-untracked-commits

Verifier pass, run independently in the effort worktree:
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-07-31-focus-untracked-commits/Claude-Code-Agent-Monitor`
(branch `effort/2026-07-31-focus-untracked-commits`). No Docker stack —
confirmed correctly not provisioned per `build-brief.md` (this effort's whole
verification loop is `npm run test:server` + `cd client && npx vitest run`,
no live-service dependency).

Node version on this machine: `v22.23.1`.

## 1. Full-suite results (run independently, not taken from implementer)

- `npm run test:server` → **1052/1052 pass, 0 fail** (matches implementer's
  claim exactly).
- `cd client && npx vitest run` → **659/659 pass, 0 fail** (matches
  implementer's claim exactly).
- `cd client && npx vitest run` full-output grep for `"Maximum update depth"`
  → **zero matches**, both in the full run and in the isolated
  `screens.snapshot.test.tsx` run (14/14 pass, no snapshot diff).
- `cd client && npx tsc --noEmit -p .` → clean, no errors.
- `bash .claude/skills/file-headers/scripts/check-headers.sh` → `✔ All
  applicable files carry the authorship header.` (exit 0).

## 2. Red→green, per test named in `red-evidence.md`

All four cross-checked by path + exact assertion text/description, not just
"a test with a similar name is green now":

| Test | Was red (per red-evidence.md) | Now | Verified independently |
|---|---|---|---|
| `server/__tests__/focus-inference.test.js` — "orders prompts by created_at, not by id/insertion order" | Yes, wrong order | GREEN | Ran `node --test ... --test-name-pattern "buildActivityDigest"` → 32/32 pass (was 30/32 with these 2 red). Same test name, unchanged. |
| `server/__tests__/focus-inference.test.js` — "selects the chronologically-correct subset before LIMIT, not an id-ordered subset (trap-defeating LIMIT case)" | Yes, `digest.prompts.length` 0 vs expected 1 | GREEN | Same run as above. |
| `client/src/hooks/__tests__/useHourWindowZoom.test.ts` — "keeps windowStartMs/windowEndMs bit-identical across unrelated re-renders, re-anchoring only on the ZOOM_REFRESH_MS tick, with no extra self-triggered renders and no console.error warning" | Yes, 1785517200001 vs expected 1785517200000 | GREEN | Ran isolated with `-t "live-zoom render-cascade regression"` → 1 passed, 8 skipped. Same test name, unchanged. |
| `client/src/components/__tests__/FocusReportModal.test.tsx` — "[FocusPage extension of the standing template] ..." | Natural-red check came back green (no live bug at that exact spot); red proven instead via a manufactured one-line divergence (`Math.round`→`Math.floor` in `FocusPage.tsx`), reverted | GREEN, and confirmed genuinely diffing the two trees (uses shared `report` object fed by reference to both `focusReportMock` and `topLevelFocusReportMock`, not two separately-authored fixtures) | Ran isolated with `-t "FocusPage extension"` → 3 passed, 21 skipped. Read the test body directly (`FocusReportModal.test.tsx:892-1020+`) — confirms shared-object-reference discipline, not eyeballed. |

Code fix inspection (both match technical-plan §4 exactly, verbatim, and no
disallowed workaround was used):

- `server/lib/focus-inference.js`: `ORDER BY id ASC LIMIT ?` →
  `ORDER BY created_at ASC, id ASC LIMIT ?`. Grepped the diff for `.sort(` —
  none added (confirms no JS-level-sort substitute, which the build-task-list
  explicitly disallows since it would pass Case A but not Case B).
- `client/src/hooks/useHourWindowZoom.ts`: `forceRefresh` bump-counter
  replaced with `nowMs` state + `ZOOM_REFRESH_MS`-interval effect; live-zoom
  `windowStartMs`/`windowEndMs` read `nowMs`. `git diff --stat` confirms
  `FocusCalendarView.tsx` is **untouched** — the effect dependency array at
  lines 453-456 was not modified, so the disallowed stale-closure symptom
  patch was not used.

## 3. Backfill tests (should-add), each re-run individually

- `node --test server/__tests__/focus-report.test.js --test-name-pattern
  "high interval volume"` → GREEN (1/1).
- `cd client && npx vitest run src/components/__tests__/ConcurrencyStatTile.test.tsx`
  → GREEN (4/4).
- `node --test server/__tests__/settings-export.test.js` → GREEN (2/2).

## 4. Standing guards / catalog entries

- `PROJECT-CONTEXT.md` (worktree root): `## Recurring defect-class patterns`
  section present, both `### 9.1 DERIVED-DUAL-VIEW` and
  `### 9.2 row-id-as-chronology-proxy` entries present, text matches
  technical-plan §9 verbatim (diffed by eye against the plan's own quoted
  block — identical). This is this project's **first** formally catalogued
  defect-class registry; both `MANDATORY` forward-references in the build
  task list (tasks #2, #7) resolve correctly since this landed in the same
  build.
- `intake/2026-07-31-focus-untracked-commits/decisions.md` (main repo, not
  worktree — correct per instructions, since this is a docs/process
  deliverable scoped to the intake folder, not the code worktree): DEC-7 and
  DEC-8 present, verbatim match to technical-plan §8. DEC-9 present and
  explicitly labeled **PENDING — flagged for Sara's input, not decided by the
  build team** — correct handling per test-plan's "Durable-cure decision"
  section and build-brief's open question #2 (this decision is explicitly
  not the implementer's or verifier's to make).
- Settings-export bundling process footnote: already present in
  `technical-plan.md` (row for `60af828`, "See §8 for the bundling process
  note") and `pm-plan.md` §7.7/§8 — satisfies the DoD bullet as written ("noted
  somewhere in this intake's record... no code or test action required").

## 5. Definition of Done — technical-plan.md §11

- [x] §4.1 fix applied; "Maximum update depth exceeded" does not reproduce
      (confirmed via stderr scan of the full client suite and the specific
      `FocusReportModal.test.tsx` run — zero matches).
- [x] §4.2 fix applied (SQL-level, verified no `.sort()` substitute).
- [x] All 6 §7 tests written and green, individually and in full suite.
- [x] `npm run test:server` green in full (1052/1052).
- [x] `cd client && npx vitest run` green in full (659/659).
- [x] `check-headers.sh` passes, exit 0.
- [x] `decisions.md` has DEC-7, DEC-8.
- [x] `PROJECT-CONTEXT.md` has the catalogue section, both entries.
- [x] Settings-export bundling footnote present (pre-existing in
      technical-plan/pm-plan, per above).
- [x] technical-plan + pm-plan + decisions.md stand as the complete
      retroactive record.

## Definition of Done — qa/test-plan.md

- [x] Must-add #1 (Cases A/B): red→green confirmed.
- [x] Must-add #2 (cross-view parity): written, proven via manufactured
      divergence (not natural red, which is explicitly anticipated and
      handled correctly per the plan), asserts both unwindowed and windowed
      (4h) parity, shared-fixture-by-reference confirmed by reading the code.
      `FocusPage.test.tsx`'s hardcoded 75%/25% redirected with a comment
      pointing at the new test — confirmed by diff.
- [x] Must-add #3 (render-cascade): red→green confirmed, including the
      `console.error` spy assertion (not value-stability alone) — read
      directly in the test body (lines 237-239 of the test file).
- [~] Should-add backfill: all 3 written and green. D1
      (`focus-report.test.js`'s >65,536-interval case) and D2
      (`ConcurrencyStatTile.test.tsx`)'s **manufactured-red proof was not
      performed** — correctly deferred by the test-author (blocked by their
      own permission classifier from touching product code) rather than
      silently skipped or improvised around. See item 7 below for
      independent re-verification of whether this gap is consequential.
- [x] `npm run test:server` green at `1052/1052` (1047+5 baseline+new — matches).
- [x] `cd client && npx vitest run` green at `659/659` (645+14 — matches).
- [x] `check-headers.sh` exits 0.
- [x] `screens.snapshot.test.tsx` shows no diff.
- [x] Both live fixes applied, each individually red-before/green-after.
- [x] Durable-cure decision recorded explicitly (DEC-9, PENDING, not silent).

## 6. Independent judgment — flagged item #1: `windowIsFuture` deviation

**Read the current code directly** (`useHourWindowZoom.ts:188-199`) and the
relevant test (`useHourWindowZoom.test.ts:84-125`, the `windowIsFuture`
describe block).

**Finding: the deviation is safe. No render-cascade risk, no real correctness
gap.**

- `windowIsFuture` is consumed in exactly one place downstream:
  `HourWindowZoomBar.tsx:211` (`{windowIsFuture && (...)}`), a pure JSX
  conditional render of a warning banner. Grepped the whole `client/src` tree
  for other consumers — none.
- It does **not** feed any `useEffect` dependency array anywhere in the
  codebase. The only cascade-triggering effect in this surface
  (`FocusCalendarView.tsx:453-456`) depends on `[zoomable, windowStartMs,
  windowEndMs]` only — `windowIsFuture` is absent from that array, confirmed
  by reading the effect directly. Since the render cascade mechanism
  requires a value that changes on every render AND feeds an effect that
  calls a state setter one level up, and `windowIsFuture` satisfies neither
  half of that (it's presentational-only), it structurally cannot
  reintroduce the bug §4.1 fixed, regardless of whether it reads `Date.now()`
  or `nowMs`.
- The `windowIsFuture` test itself (`useHourWindowZoom.test.ts:93-113`)
  actually *requires* the raw-`Date.now()` behavior: it moves the system
  clock backward by 1ms via `vi.setSystemTime` and asserts `windowIsFuture`
  flips to `true` on the very next render — a sub-`ZOOM_REFRESH_MS`-tick
  change. If `windowIsFuture` were switched to read `nowMs` (which only
  updates once per 60s interval tick), this assertion would fail since
  `nowMs` would still reflect the pre-move value. So the "broke an existing
  passing test" claim is real and reproducible by inspection, not a
  fabricated excuse.
- Net effect: leaving `windowIsFuture` on raw `Date.now()` is arguably *more*
  correct than switching it to `nowMs` would have been — a future/past
  boundary warning that only updated once every 60s would be measurably
  stale for a value whose whole job is "tell the user right now whether
  their picked start time is in the future." The technical-plan itself
  correctly labeled this a "hygiene fix, not required to close the cascade."
- **Verdict: this deviation does not need to go back to the implementer.**
  It should be captured as a one-line note in the build's closing record
  (deviation from technical-plan §4.1's literal text, but not from its
  actual risk-closing intent) — not a blocking gap.

## 7. Independent judgment — flagged item #2: >65,536-interval test

**Independently re-verified the push-spread-limit claim** with a standalone
Node script on this environment's Node (`v22.23.1`), not taken on the
implementer's word:

```
node -e '... push(...arr) for various n ...'
```

Results: `push(...arr)` does **not** throw at 65,536, 70,000, or even
100,000 elements on this Node version — first throws between 100,000 and
120,000. Binary-searched the exact boundary: **throws starting at 109,828
elements, still fine at 109,827** — a long way above both the historical
`~65,536` V8 spread-as-arguments ceiling the original bug comment cites and
the test's actual `70,000`-event / `70,001`-interval fixture size (confirmed
by reading `server/__tests__/focus-report.test.js:1109-1153` directly — the
file's own comment says "70,001 gaps/intervals," consistent with what I
counted).

**Confirms the implementer's claim is accurate**: reverting the loop-push
back to `push(...intervals)` and running this test at its current 70,000-event
size would **not** go red on this Node version — the manufactured-red proof
test-plan step 9 / build-task-list task #10 calls for is not currently
achievable here, and the implementer was right to flag rather than force it
or fabricate a red result.

**Assessment of consequence:**

- The underlying **code fix itself is unchanged and still correct** —
  `focus-report.js`'s loop-push (vs. spread-push) is strictly safer
  regardless of where V8's current ceiling sits, and nothing about this
  finding calls that fix's correctness into question.
- The **test as currently written is not fully vacuous** — it still asserts
  real, non-trivial arithmetic correctness at scale (`active_ms <= wall_ms`,
  `active_ms + idle_ms === wall_ms` across 70,001 intervals) and does
  exercise the real code path end-to-end without throwing. That's
  meaningfully more coverage than existed before this build (there was no
  test at this event-volume scale at all).
- It **is** a weaker regression guard than the technical-plan/test-plan
  intended specifically for "a future readability-motivated revert to
  `push(...x)`" (test-plan §ObjectiveL21-22's own stated purpose for this
  test) — on *this* Node version, such a revert would sail through
  undetected at the current 70,000-event fixture size. That is a real,
  independently-confirmed gap, not a false alarm.
- This is explicitly a **should-add / backfill / non-blocking** item in both
  plans' own language ("backfill only, no live bug," test-plan's own
  "should-add, not blocking" framing) — it guards already-shipped,
  already-correct code (`60af828`), not a currently-live bug this build
  exists to fix. It does not gate the two MANDATORY durable-cure tasks
  (`row-id-as-chronology-proxy` SQL fix, `DERIVED-DUAL-VIEW` parity test),
  which are unaffected by this finding.
- **Verdict: acceptable, non-blocking gap — not a reason to send this back
  to the implementer**, but worth naming explicitly rather than letting the
  DoD checkbox read as unconditionally satisfied. Recommend (not a build
  requirement) a future bump of `EVENT_COUNT` in this test to a value safely
  above the observed modern-Node boundary (e.g. 150,000) so the
  manufactured-red proof becomes achievable again — flagging this as a
  suggestion for a follow-up, not a blocker for this build.

## Overall gate verdict: GREEN-WITH-CAVEATS

Both MANDATORY durable-cure tasks (row-id-as-chronology-proxy SQL fix,
DERIVED-DUAL-VIEW cross-view parity test) are correctly implemented, proven
red→green, and not satisfied via a disallowed shortcut. Both catalog entries
landed. Both live bugs are fixed at the source, confirmed by direct code
reading, not just green tests. Full suites are green (1052/1052 server,
659/659 client, independently re-run). No collateral damage. File headers
and typecheck clean. DEC-9 correctly left PENDING for Sara rather than
silently resolved.

Two non-blocking caveats, both independently investigated and judged safe to
ship:
1. `windowIsFuture` deviation from technical-plan §4.1's literal text —
   confirmed safe by inspection (doesn't feed any effect, can't reintroduce
   the cascade), and arguably more correct than the plan's own suggested
   change.
2. The `>65,536`-interval backfill test's manufactured-red proof could not
   be completed on this Node version (confirmed independently: the real
   V8 spread-push ceiling here is ~109,827, not ~65,536) — the test still
   provides real arithmetic-correctness coverage but is not currently a
   reliable guard against a revert of the loop-push fix specifically. Non-
   blocking (should-add item, guards already-shipped code, does not touch
   either MANDATORY durable cure); worth a follow-up `EVENT_COUNT` bump.
