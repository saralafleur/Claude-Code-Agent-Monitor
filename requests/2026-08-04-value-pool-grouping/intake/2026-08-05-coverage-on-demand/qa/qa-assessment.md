# QA Assessment — coverage-on-demand (Value Pool Slice 2)

> Authored by `qa-strategist`. **This is the document to read first.** It answers:
> is the change adequately tested, where are the gaps, have we shipped this *class*
> of gap before, and how do we stop it.
>
> **Date:** 2026-08-05 · **Commit assessed:** `4c2e931`, already merged to local
> `master` (ancestor of `HEAD`; not yet on `origin/master`). This is a
> **post-merge** assessment — the must-adds below gate the *next* push and Slice 3,
> not a pre-merge decision that has already been made.

## Change summary

Slice 2 gives the background altitude sweep a second, explicit demand level: a
project can be flagged ("prioritize now"), jumped to the head of the sweep
rotation, and drained in bounded batches until 100% of its value pool is
described. Progress is computed in exactly one new server module
(`server/lib/value-coverage.js`) and carried verbatim over two delivery paths —
a new HTTP `GET /api/project-plans/coverage` and a widened
`value_altitudes_updated` WebSocket broadcast. `PlanLedgerPanel` gains its
first-ever live WS subscription to render that progress in an open tab. A
stage-aware model cascade (`summaryModel("unit"|"grouping")`) ships as inert
plumbing for Slice 3, with **AC-6 (the calibration run) explicitly unmet** — no
default was re-pinned, so nothing misbehaves today, but the acceptance criterion
never happened.

## Coverage verdict

**BLIND**

Scoped honestly: the *majority* of this slice is genuinely well guarded, and that
should be said plainly before the bad news. The drain loop's six exit conditions,
the shared overlap guard, the TTL sweep, the passive-ordering-byte-identical
regression, the coverage/ETA arithmetic, the guarded ALTER, the `created_at DESC,
id DESC` chronology on both new duration reads, the four-locale key parity, and —
critically — the MANDATORY §9.1 route↔broadcast parity guard (which was itself
vacuous mid-build, BL-1, and is **confirmed genuinely repaired**, verified by
direct read this pass) are all real, load-bearing, mutation-proven coverage. The
baseline is **1784/1784 server + 817/817 client, fully green, zero drift since
merge**.

The verdict is BLIND anyway, on three grounds:

1. **The suite is 100% green over three defects that are reproducible today, and
   two of them are user-visible.** SF-8 (a cross-project data leak in the Plan
   Ledger header), SF-9 (a failing progressive-enhancement fetch blanking the
   whole panel), and SF-6 (a permanently-dropped "coverage finished" broadcast
   after a restart). I re-confirmed all three in the shipped code myself, not
   from the review's description: `mergeCoverage` compares only `computed_at` and
   never `project_id` (`PlanLedgerPanel.tsx:71-78`) while `ProjectDetail.tsx:1292`
   renders the panel unkeyed; `api.projectPlans.coverage(projectId)` sits inside
   the same `Promise.all` and the same `try` as `list`/`pool`/`health`
   (`:696-708`); and `shouldBroadcastCoverage`'s `const transitioned = !!prior &&
   (…)` (`value-summary-tick.js:190-195`) makes a first observation structurally
   incapable of being a transition. Green-suite-but-broken is this project's
   signature failure mode, and this is it, live on `master`.
2. **Every one of the four gap classes lands squarely on a numbered catalog entry
   that is OPEN on this exact surface** — §9.1 (SF-4), §9.3 (SF-7), §9.7 (N2),
   §9.8 (SF-6) — with no guard on the shipped instance. Per §9.4's own standing
   lesson, *"should-fix is a triage label, not a disposition"*: every one of these
   **does** have a dated `decisions.md` row, which is the mechanism working and is
   genuinely to this build's credit — but a disposition row cannot go red. Only an
   assertion can.
3. **SF-6 is §9.8 OVERLOADED-ABSENCE recurring inside the second consecutive
   build on the file family that promoted §9.8**, and SF-7 is §9.3 VACUOUS-GUARD
   recurring in the third consecutive build on that same family (event density
   8 → 9 → 4). The catalog's own repeated finding is that being warned about these
   entries does not reduce their incidence — only a red-provable assertion does.

What BLIND does **not** mean here: it does not mean the merge was wrong, that the
build was sloppy (it was not — it disclosed everything it left open, which is
rare), or that the change should be reverted. It means **do not push this to
`origin` and do not start Slice 3 until the three must-adds below are in**,
because those three are live defects, not hypotheticals, and today nothing in
either suite can see them.

## Current coverage

Baseline actually run by the cartographer this pass, against a working tree clean
of code changes (so it reflects real `4c2e931`, not a modified tree):

| Layer | Command | Result |
|---|---|---|
| Server (unit + integration, one bucket) | `npm run test:server` | **1784 / 1784 passing**, 443 suites, 0 failed/skipped (~58s) |
| Client (component + i18n + screen snapshots) | `npm run test:client` | **817 / 817 passing**, 61 files, 0 failed (~7s) |
| E2E (browser) | — | **No layer exists.** No Playwright/Cypress config, no `e2e/` dir, no script. Debt item A.1 is new tooling, not a missing file. |
| MCP | `npm run mcp:typecheck` | Untouched by this slice, not run |

Both numbers match the build report's independently re-verified counts exactly —
no drift between what the build claimed and what QA observed. One known
pre-existing rerun-away flake (a timestamp-collision `notStrictEqual` in
`value-summary-tick.test.js`, ~4/8 on the untouched Slice-1 worktree) did not
fire this pass. Not re-run this pass: `npx tsc --noEmit` and the file-headers
audit (both confirmed clean by the build's own verification).

**What guards these surfaces today (GUARDED):** `runCoverageDrain`'s six named
mutually-exclusive exit conditions and the shared `running` overlap guard in both
directions; the TTL-expiry paths plus the passive-ordering-byte-identical
regression; `coverageSnapshot`/`estimateEta` arithmetic including all three
`demand` buckets, all three `eta.state` branches, the K=5 cap and the
per-project-then-fleet fallback; the guarded `PRAGMA table_info` ALTER and legacy-row
`NULL` read; both new duration reads' `created_at DESC, id DESC`; the
`POST /altitudes` no-`coverage`-leak negative guarantee (DEC-9); four-locale key
parity (mutation-proven by deleting a `ko` key); and the WS subscriber's own
contract — subscribe, `project_id` filter, monotonic merge, unsubscribe on
cleanup, plus the BL-2 StrictMode regression case.

**The single most important positive finding:** `value-coverage-parity.test.js` —
the named MANDATORY §9.1 deliverable, which was itself the vacuous guard mid-build
(BL-1) — is **confirmed genuinely repaired** by direct read. It now forces a real
`passive → requested` transition across two real tick calls, captures the actual
broadcast payload through a real callback, and deep-equals it field-by-field
against the real route response. The `if (broadcastPayload) { … } else
{ self-computed fallback }` shape is gone; the test fails outright if the tick
never broadcasts. This is a real guard now, and it is worth stating plainly
because the opposite was true as recently as this same build's Round 2.

**PARTIAL:** `demand: "draining"` over HTTP (the mechanism is real — `isDrainingProject`
is threaded into both routes, contradicting a stale review-findings label — but T3
only asserts permissive membership against an empty pool, so no test ever observes
`"draining"` on a real mid-flight drain); and the wire's `pending` field, which is
asserted only as `typeof … === "number"` and so cannot catch a re-divergence from
`coverage.pending`.

## Gaps & test-debt diagnosis

Five UNGUARDED surfaces, all independently confirmed live at `4c2e931`:

| # | Gap | Layer | State today | Catalog |
|---|---|---|---|---|
| SF-8 | Panel's `coverage` state is not reset on `projectId` change; `mergeCoverage` compares only `computed_at`. If project A's snapshot is newer, project B's real snapshot is **permanently rejected** and A's counts render under B's pool. | client | **Live user-visible defect.** Silently wrong data, no error, no self-heal guarantee. | *(no id — new candidate, registered this pass)* |
| SF-9 | `GET /coverage` shares one `Promise.all` and one `catch` with `list`/`pool`/`health`; any 4xx/5xx blanks the entire Plan Ledger behind an error banner. | client | **Live user-visible defect.** One-line fix. | boundary/no-veto invariant (general) |
| SF-6 | `shouldBroadcastCoverage` treats an absent prior as "no transition," so a first-observation terminal `complete` (post-restart drain resume, or `POST /altitudes` completing a pool between ticks) is dropped from the wire. | server | **Live defect.** Open tab freezes at its last percentage forever. Directly undermines AC-5. | **§9.8 OVERLOADED-ABSENCE**, OPEN |
| SF-4 | The 4-step probe composition (assemble → probe → sweep-state read → `coverageSnapshot`) is written twice, once per route handler, and the two copies **have already diverged once** on `requestedAt`. | server | Not yet a live defect (copies agree). Pre-condition for the next one. | **§9.1 DERIVED-DUAL-VIEW**, OPEN (7 occurrences) |
| N2 | `value-coverage.test.js`'s hand-typed `STATE_TO_LOCALE_KEY` silently `continue`s past any unmapped registry member, so a 4th `demand`/`eta.state` value ships with no locale key and no failure. | server (test layer) | Zero impact today; fires the day Slice 3 grows either registry. | **§9.7 HAND-SCOPED STRUCTURAL SCAN**, OPEN (7 occurrences) |

**Plus one structural blind spot found this pass, stronger than the "stale
baseline" it was filed as.** QA debt item A.2 was recorded as "`screens.snapshot.test.tsx`
has no baseline for the new coverage header." The real finding is worse: that
suite's shared API mock replaces `api.projectPlans` wholesale and lists only
`list`/`pool`/`health`/`claim`/`close` — **`coverage` and `requestCoverage` are
absent entirely.** If the "Project detail" case ever mounted `PlanLedgerPanel`,
`api.projectPlans.coverage(...)` would throw `TypeError: not a function`, land in
SF-9's shared `catch`, and blank the panel. It doesn't fail today only because
the mocked project id doesn't exist in the mocked project list, so the page
short-circuits to "Project not found" **before the panel ever mounts**. So SF-9
is already sitting in the suite as a live, silent demonstration of itself, and
`PlanLedgerPanel` is structurally invisible to the entire screens-snapshot suite —
not merely un-baselined.

### The systemic reasons (three, and none of them is "someone forgot a test")

1. **Test scope on this project is per-module, not per-shape — so a cross-seam
   invariant is nobody's file and does not get written.** This is §9.1's own
   diagnosis, now recorded four separate times in this catalog, and it is exactly
   why SF-4 has no guard: there is a `value-coverage.test.js` (the module), a
   `project-plans-api.test.js` (the routes), and a `value-coverage-parity.test.js`
   (route↔broadcast) — but **route↔route** fits none of the three, so it is
   unowned. This project has already proven the cure works — *"name the file and
   the spec gets written"* (`ledger-metrics-parity.test.js`,
   `value-coverage-parity.test.js`) — and the gaps that persist are precisely the
   shapes nobody named.
2. **Every scan on this surface has one derived axis and one hand-typed axis, and
   the derived half makes the hand-typed half look enforced.** That is §9.7
   verbatim. `assertSingleHome` derives exports, hand-types consumers (SF-5 —
   occurrence 7, in this very build, while the author was editing that same map).
   `STATE_TO_LOCALE_KEY` reads a derived registry and hand-types the mapping, then
   `continue`s past the gap instead of failing closed (N2). Same defect, two
   layers, one build.
3. **On the client, "a component's state belongs to the entity it was mounted
   for" is an invariant nothing in this project asserts, at any layer.** SF-8 is
   the sharpest possible instance: the monotonic `computed_at` merge is *correct*
   for its stated purpose (an HTTP/WS race must not visibly regress progress) and
   is mutation-proven for that purpose (R4). It becomes a leak the moment its
   silent precondition — "both snapshots describe the same entity" — is violated
   by a project switch the component never learns about, because it is rendered
   unkeyed. **The correctness guard is the leak mechanism.** No test in this repo
   mounts any component, changes its entity prop, and asserts the state followed;
   the whole class is untested by convention, and every future field
   `PlanLedgerPanel` gains inherits it.

### Have we shipped this class of gap before?

**Yes — every one of them, and the counts are on record in `PROJECT-CONTEXT.md` §9.**

- **§9.1 DERIVED-DUAL-VIEW — 7 occurrences (6 → 7 on 2026-08-05).** SF-4 is OPEN
  on it. This entry's own 2026-08-01 lesson is *"scan for copies of its helpers
  too, not just of it"* — SF-4 is that lesson recurring at the composition layer.
  This build also produced the sharpest instance the catalog has: **§9.1's own
  MANDATORY guard was §9.3's vacuity** (BL-1), fixed pre-merge.
- **§9.3 VACUOUS-GUARD — this build contributed 4 events (8 → 9 → 4 across three
  consecutive efforts on this file family; ~21 total).** SF-7 is the one
  knowingly shipped. **The mitigation claim was independently verified this pass
  and it holds** — the unit architect traced all seven existence-only/near-vacuous
  cases to real behavioral proofs elsewhere (`project-plans-api.test.js` T3,
  `value-summary-tick.test.js`'s TTL + exit-condition matrix,
  `value-coverage.test.js`'s arithmetic/demand/ETA blocks,
  `value-coverage-parity.test.js` G2). **This is important and de-escalating:** the
  risk analyst's conditional — *"if the claimed coverage doesn't hold, AC-2/AC-3
  are effectively unverified and this jumps to Critical"* — did **not** fire.
  AC-2/AC-3 are genuinely proven. SF-7 is now purely a false-confidence hazard,
  not a coverage hole.
- **§9.7 HAND-SCOPED STRUCTURAL SCAN — 7 occurrences**, the 7th (SF-5) landing in
  this build on `assertSingleHome`'s consumer axis. N2 is the same shape one layer
  down, in the test layer, still open.
- **§9.8 OVERLOADED-ABSENCE — promoted 2026-08-04, and this is the very next build
  on the surface that promoted it.** SF-3 (the state-shape half) was found and
  **fixed**. SF-6 is the residual, at the *broadcast-trigger* layer rather than the
  state-shape layer, and it is the entry's own "never zero" direction: the wire
  goes silent on exactly the transition the registry exists to report honestly.
- **STRICTMODE-BLIND CLIENT SUITE (candidate, promotion trigger armed) — first
  occurrence, and it fired** (BL-2, caught by human reading, not by 817 green
  tests). Fixed for one effect on one component. **The residual matters here
  specifically:** SF-8 and SF-9 both live in the same effect bodies BL-2 just
  patched.
- **SF-8's shape — genuinely new, no id owned it.** Registered this pass as a new
  candidate: **MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH** (see `PROJECT-CONTEXT.md`,
  candidate section), with an explicit promotion trigger, per this project's
  convention for candidates.

## Recommendation

### Must-add-now — three tests, all RED today, all independently reproduced

These are not "more coverage." Each one fails against merged `master` right now,
and that failure *is* the reproduction of a live defect. Do these before pushing
to `origin` and before Slice 3.

1. **SF-8 — cross-project coverage leak.** *(Critical, most user-visible.)*
   `PlanLedgerPanel.test.tsx`: render with `projectId="proj-A"` and a snapshot
   whose `computed_at` is **newer**, `rerender` with `projectId="proj-B"` and an
   **older** snapshot, assert the header shows B's counts and no trace of A's.
   Fix: `useEffect(() => setCoverage(null), [projectId])`, or make `mergeCoverage`
   `project_id`-aware. (Keying the panel in `ProjectDetail.tsx` also works but
   throws away the fetch cache and doesn't stop the *next* state field from
   inheriting the bug — prefer the explicit reset.)
2. **SF-9 — partial-failure isolation.** *(High, one-line fix, cheapest of the
   three.)* `PlanLedgerPanel.test.tsx`: reject `api.projectPlans.coverage`, assert
   the plan title and pool unit still render and no banner replaces them. Fix:
   `.catch(() => ({ coverage: null }))` on that one leg. **Write the assertion as a
   reusable helper** — this is a template for every future leg added to that
   `Promise.all`, which is the actual risk.
3. **SF-6 — first-observation terminal broadcast.** *(Medium-High; its trigger is a
   server restart, which is routine on this project — `update-check.js` literally
   prints a restart command for the user to run.)* `value-summary-tick.test.js`,
   after `__resetTickStateForTest()`: a project whose first-ever observed sweep is
   already complete with `generated === 0` must broadcast; plus the negative case
   (first observation, not complete → no broadcast) to bound the fix. Fix: treat
   an absent prior as a transition when `complete === true`. **And delete or
   correct the header comment claiming the function "can only ever SUPPRESS, never
   fabricate"** — per §9.1's own standing check, *when a cure's header says
   "cannot," find the loop that proves it or downgrade the comment.*

Also fold in, cheaply, while in those files:

4. **N2's exact-exemption assertion** — `assert.deepEqual(exemptDemand, ["passive"])`
   / `(exemptEta, ["none"])`. One line each, closes WATCH-S2-F **before** Slice 3
   grows either registry rather than at the moment it bites, and it is the exact
   `UNCOMPARED_FIELD_GUARANTORS` fix shape §9.1 already proved on 2026-08-05.
5. **SF-4's composition-parity structural guard** — assert both route handler
   bodies compose `coverageSnapshot` from an identical sorted key set, and that
   `draining: isDrainingProject(projectId)` appears in both (regression-proofing
   the SF-3 fix in the same stroke). Cheap, and it fails on the *next* divergence
   instead of waiting for Slice 3's third copy.
6. **SF-7's cleanup** — replace the four existence-only cases with the one real
   round-trip they should have been, and delete the rest in favour of pointer
   comments at the real proofs. Now purely hygiene (the mitigation verified), but
   §9.3's whole thesis is *"the next change reads the checkmark and stops
   looking"* — a green tick under "AC-2: Coverage Request Mechanism" that proves
   nothing has negative value.

**Acceptable as-is, no action:** **N1** (batch-size-blind ETA) — accepted under
WATCH-S2-C, cosmetic, gates no action; take the architect's characterization test
if it's free, so the next edit to the weighting shows up as a diff against a named
baseline instead of a silent change. **SF-10.2** — pre-existing, Slice-1-inherited,
already dispositioned, out of this change set; do not re-open it here.

### The durable cures (this is the part that stops the class)

Point tests close these five instances. They do not stop the sixth. Three
structural cures, cheapest first:

- **For the SF-8 class — make "does this state belong to this entity?" a
  mechanically answerable question.** The narrow cure is a shared
  `useEntityScopedState(projectId, initial)` hook (or a lint/structural guard that
  rejects a `useState` holding entity-scoped data in a component that takes an
  entity id prop without a matching reset effect). Cheapest first step, and worth
  doing regardless: a **standing test convention** — any component test file for a
  component taking an entity-id prop must include one "switch the id, assert the
  state followed" case, added to the client testing conventions the same way
  `screens.snapshot.test.tsx`'s shared-mock rule should be.
- **For the SF-9 class — partial-failure isolation as a per-leg rule, not a
  per-field fix.** Extract the panel's multi-fetch into a helper where each leg
  carries its own failure disposition (`required` vs `enhancement`), so a future
  field *cannot* be joined into the blocking set by accident. The reusable test
  helper from must-add #2 is the assertion half of this.
- **For the §9.7 class (SF-5 + N2 in one build) — finish the half-built cure.**
  §9.7's own recommendation, now half-built for two builds running: derive the
  **consumer** axis of `assertSingleHome` from the artifact (grep `server/lib` +
  `server/routes` for the module's import specifier, fail on any importer with no
  disposition), exactly as `FILE_DISPOSITIONS` already fails on an undispositioned
  file. That closes SF-5's *class*, not SF-5. N2's exact-exemption assertion is the
  same discipline applied to the locale map.
- **For the screens-snapshot blind spot — fix the mount, then the baseline.** A
  baseline over a "Project not found" empty state is worse than no baseline: it
  reads as coverage. Give the suite a real project fixture so `PlanLedgerPanel`
  actually mounts, add `coverage`/`requestCoverage` to the shared API mock (per the
  convention the cartographer documented: **any new API method a page calls must be
  added to that shared mock, or it throws into whatever `try/catch` wraps it**), and
  anchor the snapshot with the behavioral `ProjectDetail.test.tsx` assertion the
  unit architect designed — never a bare `-u` regenerate.
- **Worth considering, not urgent:** promote STRICTMODE-BLIND's cheapest cure — wrap
  the shared RTL render helper in `<StrictMode>` — but only with the deliberate
  triage the candidate entry itself warns about (expect a first-run red set; a
  parity check that goes red for legitimate reasons on day one gets weakened, not
  fixed). Not a gate for this change.

### Is it safe to ship?

The change **is already merged locally** and is not doing harm at rest: the drain
converges, the passive path is behavior-preserving, and the parity guard is real.
**It is not safe to push to `origin` or to start Slice 3 as-is** — SF-8 puts one
project's numbers under another project's URL with no error signal, and that is a
trust bug in a dashboard whose entire job is telling Sara what is true. With
must-adds 1–3 in (roughly one afternoon: two client tests, one server test, three
small fixes), it is safe to push. Items 4–6 should ride the same change set —
they are all one-liners in files already being opened.

Separately, **AC-6 remains unmet and is a hard gate on Slice 3, not a QA finding**:
the haiku-vs-sonnet calibration never ran, so pinning a `grouping` default before
it does means Slice 3's grouping synthesis silently runs on `haiku`. No test can
prove a calibration happened — this needs to be scheduled, not tested.

## Open decisions for the user

- [ ] **Accept the durable cures now, or take only the point tests?** The three
      must-adds close the three live defects either way. The question is whether
      the entity-scoped-state convention and the per-leg failure-disposition
      refactor land in this change set or become their own slice. My
      recommendation: take the **SF-9 reusable helper** now (it is nearly free and
      it is the one with the clearest "next field repeats this" trajectory), and
      schedule the other two.
- [ ] **Two risks still have no tracked decision row anywhere**, flagged by the
      risk analyst and unresolved by this pass. Both need a dated row in this
      intake's `qa/` decision log if they are not fixed now: **(a)** the SF-8
      *pattern* (now catalogued as a candidate, but a *decline to fix SF-8 itself*
      would need its own row); **(b) trap 7** — the tick's disclaimed-but-still-present
      internal `pending` computation could silently start feeding the wire again in
      a future edit, and nothing asserts the wire's `pending` is *sourced from*
      `coverageSnapshot` rather than merely equal to it today. Suggested promotion
      trigger for (b): *"any future edit to the WS broadcast payload assembly in
      `value-summary-tick.js`."*
- [ ] **STRICTMODE-BLIND residual scope.** BL-2 fixed one effect. The WS-subscriber
      effect and the coverage-fetch effect in the same component are unexamined for
      the same class — and SF-8/SF-9 live in exactly those bodies. Extend the
      StrictMode case to cover them while fixing SF-8/SF-9, or record the
      declination as its own line (the catalog's general promotion trigger does not
      cover this specific choice).
- [ ] **When does AC-6's calibration run?** It gates Slice 3 by DEC-2. This is a
      scheduling call, not a testing one.
- [ ] **`OPEN-S2-1` (which real project validates the coverage flow end-to-end)**
      is still PENDING and explicitly non-blocking; QA proceeded on fixtures. Worth
      closing before the first real drain on a large pool, since WATCH-5 (git-walk
      cost × drain iterations) has never been measured under real load.

---
*Memory updated:* `~/.claude/skills/team-qa/memory/qa-run-log.md` (cross-project
fallback — this project names no QA run-log in `PROJECT-CONTEXT.md`) ✅ ·
this project's recurring-issue catalog `PROJECT-CONTEXT.md` §9 — new candidate
entry **MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH** registered, plus dated QA-pass
notes on §9.1, §9.3, §9.7, §9.8 (counts unchanged — these are this build's
already-logged events now carrying QA dispositions, not new occurrences) ✅
