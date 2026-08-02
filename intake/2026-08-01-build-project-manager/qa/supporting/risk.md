# Risk & Regression Analysis — build-project-manager (layers 4–6)

> Role: Risk & Regression Analyst, `team-qa` pipeline. Read against
> `PROJECT-CONTEXT.md` (§9.1 DERIVED-DUAL-VIEW, §9.2
> row-id-as-chronology-proxy), `qa/change-brief.md`, `technical-plan.md`
> (incl. Revision history, §§2–8), and `decisions.md` (DEC-1..15,
> WATCH-1..9). Nothing in this effort is built yet — this is a pre-build risk
> pass over an intended change, same posture as the change brief.
>
> Headline: this plan is unusually self-aware about its own risk surface —
> DEC-14 and §5/§7 already name most of what a Risk Analyst would otherwise
> have to surface from scratch. My job here is (a) confirm those mitigations
> actually cover the invariant they claim to, (b) find what they *don't*
> cover, and (c) rank all of it by what breaks worst if it ships wrong.

---

## 1. Blast radius

Beyond the literal new files, this change touches shared infrastructure with
independent existing consumers:

- **`AGENT-PLAN.md` itself** — the single highest-stakes shared resource in
  this repo. Every consumer that reads it today (`plan-ingest.js`'s poller,
  the `SessionStart` hook path, `ccam focus` commands, Sara's own editor)
  becomes a downstream consumer of Layer 4's unattended writer. A bug here
  doesn't stay contained to a test file — it lands in a real human-owned
  document.
- **`plan_items` / `plans` tables** — `ingestPlanForCwd` (`server/lib/plan-ingest.js`)
  is the sole writer today; `upsertPlanItem`'s `ON CONFLICT` clause,
  `deletePlanItemsNotIn` (`server/db.js:2183`), and `migrateFocusNumbersOnReorder`
  all encode assumptions (identity = `id:` line, not authorship) that
  `plan-writeback.js` depends on for its "indistinguishable from human-typed"
  claim (DEC-2 follow-through). Any future edit to `upsertPlanItem`,
  `deletePlanItemsNotIn`, or the reorder-migration logic silently changes what
  "survives ingest" means for write-back too — those three are now a coupled
  triad, not independent.
- **`focus_inferences` / `inferSession`** (`server/lib/focus-inference.js`) —
  gains a one-line hook (`recordInferredDetour`) inside the hot classification
  path used by every session. `probeClaudeCli`, `__injectSpawnForTest`, and
  `runClaudePromptJson` are reused by Layer 6's LLM half — a change to any of
  those three exported seams (already shared with `focus-summary.js`) now has
  three consumers instead of two.
- **`session_focus.detour_stack`** (declared detours) and
  `focus_inferences.kind='detour'` (inferred detours) — two independent
  sources feeding one new table (`detour_dispositions`, tagged by `source`).
  Any future change to either upstream signal's shape must be mirrored in
  both `recordInferredDetour` and `backfillDeclaredDetours`.
- **`server/lib/cc-mutate.js`** — loses its private `atomicWriteFile` and
  gains a shared dependency on the newly extracted `atomic-file.js`. This
  primitive currently has **zero direct test coverage** (confirmed by QA) and
  is about to go from single-consumer to dual-consumer (`cc-mutate.js` +
  `plan-writeback.js`) in the same change that extracts it — the extraction
  and the second consumer land together, which is exactly the moment §9.1's
  own history says drift risk appears.
- **`server/index.js`'s background-services block** — a third scheduler
  (`startReconciliation`) joins `startFocusAudit`/`startFocusInference`,
  sharing the same process, the same SQLite connection, and the same
  `try/catch`-per-service isolation contract. A bug in the new scheduler's
  interval/overlap-guard logic risks starving or double-running alongside the
  other two if it doesn't follow their `running` flag idiom exactly.
- **`decision_queue` and `detour_dispositions` as a pair** — `resolveDecisionQueueItem`
  for `kind='detour_disposition'` must update both tables in one transaction
  (per the plan). Any future route or script that touches one table without
  the other reopens the exact "two tables disagree" failure mode the plan
  otherwise closes.
- **`bin/ccam.js`'s `COMMAND_GROUPS`/`SUBCOMMANDS` registry** — the single
  source every CLI-derived surface (`help`, REPL completion, `commands`,
  unknown-command detection) reads from. Two new commands (`focus target`,
  `decisions`) must land in all three registration points or the CLI ships
  a working command with broken discoverability — a subtler version of
  §9.1 at the CLI-metadata layer.
- **`server/openapi-extra/misc.js`** — the repo's documented convention for
  route docs; every new route this change adds must appear here or the
  OpenAPI surface silently understates the real API (a discoverability gap,
  not a functional one, but still drift between code and its own docs).

## 2. Invariants that must hold

This project has a configured defect-class catalog (`PROJECT-CONTEXT.md`
§9.1, §9.2). Both are directly cited by the technical plan itself (DEC-14,
§4 step 16-17, §5). In addition to matching this change against those two,
three more project-specific invariants are structurally central here (named
explicitly in the change brief and DEC-14/DEC-13) and are treated with the
same weight:

- **§9.1 DERIVED-DUAL-VIEW, computation form** — pace status (`pace.js`),
  disposition vocabulary (`detours.js`'s `DISPOSITIONS`), and markdown
  composition (`plan-writeback.js`) must each have exactly one
  implementation. Layer 7's UI is the deferred *second consumer* — the
  catalog's own history (4 prior touches) says the failure lands there, not
  at introduction.
- **§9.1 DERIVED-DUAL-VIEW, write-sequence form (new this build)** — the
  "sanitize → dispatch → audit → retry → escalate" sequence must live only
  in `plan-writeback.applyDisposition()`. This is DEC-14's whole reason for
  existing: two hand-composed copies (human-resolve route +
  reconciliation tick) is the same failure shape one layer over.
- **§9.2 row-id-as-chronology-proxy** — every new "recent N" query
  (`listPendingDetours`, `listStaleResolvedDetours`, `backfillDeclaredDetours`,
  Layer 6's detour-volume-ratio lookback, `listDecisionQueue`) must sort
  `ORDER BY created_at …, id …` **before** any `LIMIT`. This codebase has
  hit this exact bug three times already in `focus-inference`-adjacent code
  (`b3a2cc9`, `buildActivityDigest()`, `6e9a443`), specifically because
  `workflow-ingest.js` bulk-inserts `events` after the fact.
- **Single-writer integrity for `plan_items`** — `ingestPlanForCwd` remains
  the only writer, including for the dashboard's own content.
  `plan-writeback.js` must never call `upsertPlanItem` directly. Functionally
  this is this project's **round-trip integrity** invariant: a
  `fold_in`/`new_item` write must survive write → re-ingest → re-read and be
  indistinguishable from a human-typed item.
- **No-leak at the LLM→file trust boundary** — `sanitizeLlmPlanText` must
  neutralize LLM-influenced text so it can never forge a structural
  `id:`/`acceptance:`/`detail:` continuation line on the next parse. This is
  a **genuinely new** boundary DEC-2/DEC-13 introduced: advisory-only never
  let an LLM classification reach a stakeholder-facing document unread.
- **Fail-safe-per-stage** (session-liveness.js's own stated contract, reused
  here per DEC-11 for the fail-safe posture, not the test shape) — rule
  evaluation, LLM classification, file write-back, and each persistence
  write must each independently no-op on failure, leaving prior state
  untouched, and `decision_queue`/`detour_dispositions` must never end up
  inconsistent with each other after a partial failure.
- **Hybrid-escalation non-inversion** — `evaluateRules()` contains zero LLM
  calls and completely determines the escalation set; the LLM only
  classifies what rules already flagged. Both the PM and every supporting
  document name this as the single highest-leverage risk in the build.

## 3. Recurring-issue mapping

`PROJECT-CONTEXT.md` was read first, per policy. Both catalog entries are
**touched directly**, and both were pre-flagged at design time (not
incremented — correctly, per the `simulator-mode-switch` precedent cited in
`pm-plan.md`) rather than discovered live. That pre-flagging is itself worth
noting: this is the first time in this catalog's history that a design has
been checked against §9.1/§9.2 *before* code exists, rather than after a
live bug. That's a genuine process improvement — but it also means the
pre-flag's claims (that the mitigations are sufficient) have not yet been
tested against real code, only against a plan. My read below is: the plan's
mitigations for the *known* shape of each defect class are structurally
sound, but each catalog entry has a related shape this plan doesn't fully
close (see §4).

- **§9.1 DERIVED-DUAL-VIEW — touched, and correctly treated as the plan's
  central defensive theme.** Three new derived values (pace status,
  disposition, decision-queue entry) plus one new derived *action* (the
  write sequence) all get "one function, day one" treatment via DEC-14. This
  is the right shape of mitigation for a catalog entry whose own history
  says the failure appears at the *second consumer*, not at introduction —
  **and Layer 7's rollup UI is an already-scheduled second consumer**, so
  this entry is not closed by this build, only correctly set up not to fail
  when Layer 7 lands. If Layer 7 (or any "just a quick badge" UI addition)
  ships without re-reading `pace.js`/`detours.js`/`applyDisposition` as
  sole sources, this becomes the catalog's 5th touch.
- **§9.2 row-id-as-chronology-proxy — touched.** Every new lookback query is
  named in the plan with the correct `ORDER BY created_at …, id …`
  requirement, and `technical-plan.md` §6 requires an explicit
  out-of-order-insertion regression test for `backfillDeclaredDetours` and
  `listPendingDetours`. This would be the catalog's 4th independent
  discovery site if missed — but this is the first time the mitigation is
  being applied *before* the bug ships, which is exactly the intended use
  of a defect catalog.
- **Not a catalog entry, but adjacent and worth watching alongside them:**
  `18196dc` ("Remove the WIP queue feature," reverted two days after
  shipping) is this repo's most recent cautionary precedent for exactly this
  shape of feature — an unattended/automatic system producing output a human
  later found to be noise. DEC-7's live-trial gate exists specifically
  because of that precedent, and the change brief already ties it to this
  effort. **This is not a green-suite risk** (a passing suite cannot detect
  "the LLM's classifications are technically correct but not useful") — it's
  the reason DEC-7's non-test acceptance criterion exists at all, and it
  should stay a first-class gate, not something the test plan tries to
  subsume.

## 4. The "ships green but broken" traps

Ranked roughly by how quietly each one would pass today's planned test suite.

1. **Sanitizer/parser line-boundary drift (highest-value new trap, not
   explicitly named in the plan).** `plan-ingest.js`'s `parsePlanMarkdown`
   splits the file on `text.split(/\r?\n/)` (confirmed at
   `server/lib/plan-ingest.js:117`). `sanitizeLlmPlanText`'s newline-collapsing
   logic is specified in the plan as its **own** hand-implemented
   "collapse `\r`/`\n` runs" step — it is *not* built by importing
   `plan-ingest.js`'s actual line-split regex, only its field regexes
   (`ID_LINE_RE`/`ACCEPTANCE_LINE_RE`/`DETAIL_LINE_RE`) and caps. Today the
   two definitions of "what is a line boundary in this file" agree by
   construction. **The trap:** a future change to `parsePlanMarkdown`'s line
   splitting (e.g., to also treat a lone `\r`, a Unicode line/paragraph
   separator, or some other whitespace variant as a boundary, for better
   markdown-editor compatibility) would not be caught by any existing test,
   because `sanitizeLlmPlanText`'s tests exercise its own hand-rolled
   understanding of "newline," not `plan-ingest.js`'s current regex. The
   suite stays green; the sanitizer silently stops covering the actual
   split behavior. **Required assertion:** a test that parametrizes
   `sanitizeLlmPlanText`'s adversarial cases directly off
   `plan-ingest.js`'s exported line-split behavior (or, better, sourcing the
   split delimiter itself from an exported constant instead of duplicating
   `/\r?\n/` knowledge in two files) — this is §9.1 DERIVED-DUAL-VIEW moved
   to the *definition of a line boundary*, one layer below the field regexes
   the plan already protects.
2. **A future third write-composer.** DEC-14 pins the write sequence to
   `applyDisposition()` and both of *today's* two callers (human-resolve
   route, reconciliation tick) are tested to call it. Nothing in the planned
   test suite would catch a **future** third call site — e.g., a bulk
   "resolve all pending detours" admin script, an MCP tool exposing
   detour-resolution later, or a debug route — that hand-rolls
   `appendPlanItem` + its own retry logic instead of calling
   `applyDisposition`. That new code would pass its own tests (it does what
   it intends) and the existing suite (nothing it touches is asserted
   against), while silently reintroducing §9.1 on the write path — this is
   the exact failure shape the catalog says shows up at the *second/third
   consumer*, not the first. **Required assertion:** either a structural
   test (grep the source tree for direct calls to `appendPlanItem`/
   `appendSubItem` outside `plan-writeback.js` and `applyDisposition`'s own
   body, failing the build if any exist) or, more robustly, don't export
   `appendPlanItem`/`appendSubItem` from `plan-writeback.js`'s public API at
   all — keep them module-private and export only `applyDisposition`, so a
   future caller has no low-level function to misuse in the first place.
3. **A new escalation rule (R4+) that queries `events`/`focus_inferences`
   without the `created_at`-before-`LIMIT` discipline.** The plan is
   explicit and tested for R1/R2/R3's *existing* queries. The trap is not in
   what's built now — it's in the next rule someone adds to
   `evaluateRules()` six months from now, copy-pasting an existing query's
   shape but reaching for `LIMIT ... ORDER BY id` because it "looks
   chronological enough" on a small dev DB where `id` and `created_at`
   happen to agree. This has already happened three times in this exact
   code family. **Required assertion:** the existing out-of-order-insertion
   regression tests (per §9.2) should be written as a **shared test helper**
   (e.g., `assertOrderedByCreatedAt(queryFn, ...)`) that a future new rule's
   test can trivially reuse — lowering the activation energy for "add the
   regression test" below "just ship the query."
4. **`decision_queue` and `detour_dispositions` updated outside the one
   transaction.** The plan requires `resolveDecisionQueueItem` for
   `kind='detour_disposition'` to update both tables atomically. If a future
   change adds a second way to resolve a queue item (e.g., a bulk "dismiss
   all pace alerts" action) that only touches `decision_queue`, the two
   tables silently diverge — a `detour_dispositions` row stays `pending`
   forever while its queue entry reads `resolved`. Existing single-row tests
   would not catch a *bulk* code path added later. **Required assertion:** a
   cross-table consistency check (`decision_queue.status='resolved'` implies
   `detour_dispositions.disposition != 'pending'` for every
   `kind='detour_disposition'` row) runnable as a standalone invariant check,
   not just asserted inline in one happy-path test.
5. **In-process mutex assumes single dashboard process per DB.** The
   per-cwd `Map<cwd, Promise>` mutex in `plan-writeback.js` only serializes
   writes within one Node process. The existing "Dashboard is already
   running" port guard (`server/index.js`) makes a second same-config
   instance unlikely in normal operation, but nothing in this plan asserts
   that guard is what makes the mutex-sufficiency claim true — if that guard
   is ever weakened (e.g., a future change makes the port configurable per
   instance to allow two dashboards against the same repo tree, or a
   container/multi-user setup runs two server processes against the same
   SQLite file), the mutex silently stops protecting against
   dashboard-vs-dashboard races, and only the optimistic lock (designed for
   human-vs-dashboard races, with an accepted TOCTOU gap per WATCH-9) is
   left standing. **This is not currently a WATCH row** — see §6.
6. **A `target_date` alert rule that re-derives "is this behind" instead of
   calling `pace.js`.** The plan pins this by construction (`evaluateRules`
   R1 must call `paceStatus()`), and DEC-5 pins the completion signal. The
   trap is a future consumer — a report, a digest, a CLI summary line — that
   compares `target_date` to "today" inline for a quick display without
   pulling in `pace.js`, disagreeing on the DEC-6 boundary case
   (`target_date === today` is `on_track`, not `behind`) the moment someone
   gets that comparison direction wrong by one day.

## 5. Severity & priority

Ranked by user-visible / data-loss / trust-boundary impact, worst first:

1. **Critical — data loss or corruption of `AGENT-PLAN.md`.** Anything that
   lets a malformed write, a lost human edit, or a forged structural line
   land in Sara's real stakeholder-facing plan file. Covered extensively by
   the plan's own optimistic-lock, sanitizer, and CAPS_EXCEEDED tests — but
   trap #1 above (sanitizer/parser line-boundary drift) is the one gap in
   this category that isn't yet closed by an explicit test tying the two
   files together.
2. **Critical — silent second writer of `plan_items`.** Any code path that
   inserts into `plan_items` outside `ingestPlanForCwd` reintroduces the
   exact conflict DEC-2's whole design exists to avoid, and would be very
   hard to notice until items mysteriously vanish on the next real ingest.
   The DoD's "grep for direct `plan_items` inserts" requirement is the right
   mitigation; it should be automated (a repo-wide grep in CI or a
   pre-commit check), not a one-time manual grep at ship time, since it's
   exactly the kind of check a busy future PR skips.
3. **High — unattended write fires when it shouldn't (dead/planless cwd, or
   escalation-set inversion).** WATCH-2's composition requirement (filter
   before the LLM step, not just before the pace branch) and the
   hybrid-escalation non-inversion invariant both sit here. A failure is
   less catastrophic than #1/#2 (it's caught by `NO_PLAN_FILE`/rules-only
   design as defense in depth) but would mean the cost/predictability
   contract of the whole reconciliation design is broken.
4. **High — `detour_dispositions`/`decision_queue` traceability breaks.**
   Not user-visible in the sense of corrupting a file, but it is the entire
   mechanism DEC-13 relies on to make an unattended write "diagnosable after
   the fact." If traceability silently breaks, Sara loses the ability to
   answer "why did this text appear in my plan" — which is the DEC-7
   live-trial gate's actual subject matter.
5. **Medium — §9.2 ordering bugs in the new lookback queries.** Wrong
   detours/sessions get flagged or missed, or the wrong subset is selected
   under a `LIMIT`. Not data-loss, but it directly undermines the
   "rules decide whether to escalate" contract's correctness — a
   chronology bug here could make R2/R3 flag (or fail to flag) the wrong
   sessions entirely, which the current fixture-driven tests will not catch
   unless the out-of-order-insertion test discipline (§9.2) is followed
   for every new query, including ones added later (trap #3).
6. **Medium — cost/spawn-control regression.** Digest gating, per-tick caps,
   and the rules-only-gate-spawning design keep LLM spend bounded. A
   regression here is a cost and noise problem, not a correctness or
   data-loss one.
7. **Low — CLI/docs/registry omissions.** `COMMAND_GROUPS` entries, OpenAPI
   docs, header comments (`plan-ingest.js`'s stale "never writes" claim).
   Cosmetic/discoverability, but explicitly called out by DEC-8 as
   "a stale claim about a trust boundary is worse than no claim" — worth
   fixing but not worth blocking Layer 4/5/6 functional sign-off on.

## 6. Disclosed-and-declined coverage — trip-wire

Per this pipeline's own rule: a risk that only exists as prose in this file
is exactly how a known gap ships as a live incident later. The following
need a tracked artifact, not just this paragraph:

- **Already tracked, no action needed from me:** WATCH-1 through WATCH-9 in
  `decisions.md` already cover backup retention (WATCH-8), the TOCTOU window
  (WATCH-9), enum-widening cost (WATCH-4), cross-plan lifecycle modeling
  (WATCH-2), and four scope boundaries (WATCH-1, 3, 5, 6, 7). These are
  correctly disclosed *and* tracked — good precedent, not a gap.
- **NOT currently tracked — needs a new `decisions.md` WATCH row before this
  ships:** the in-process, single-mutex assumption from trap/blast-radius
  item #5 above (the per-cwd `Map<cwd, Promise>` mutex only protects
  same-process writers; its sufficiency depends entirely on the existing
  "already running" port guard staying in force). This is a real,
  consciously-acceptable-for-now risk — but right now it exists nowhere
  except this file and the technical plan's prose about the mutex's
  purpose. It should get its own `WATCH-10` row naming the dependency on the
  single-instance guard explicitly, so a future change that touches
  multi-instance behavior (a container/multi-user deployment mode, a
  configurable port for running two dashboards) is forced to re-examine
  write-back safety rather than discovering the gap live.
- **NOT currently tracked — needs a decisions.md row or an explicit DoD
  line:** trap #1 (sanitizer/parser line-boundary coupling) and trap #2
  (no structural guard against a future third write-composer) are both
  invariants this round is *implicitly* declining to enforce mechanically —
  the plan relies on code review discipline and the two current callers'
  tests, not on a structural check that would catch a *future* violation.
  If the team accepts that trade-off for this round (reasonable, given
  effort is already L-high), it should be a named PENDING/WATCH row so the
  decision to rely on review-only enforcement is a decision, not a silent
  gap discovered after Layer 7 or an MCP tool ships and reimplements the
  write path.

---

### Files read for this pass
- `PROJECT-CONTEXT.md` (§9.1, §9.2)
- `intake/2026-08-01-build-project-manager/qa/change-brief.md`
- `intake/2026-08-01-build-project-manager/technical-plan.md` (full)
- `intake/2026-08-01-build-project-manager/decisions.md` (full)
- `server/lib/plan-ingest.js` (header, line-split regex, `module.exports`)
- `server/lib/focus-inference.js` (`inferSession`, spawn/probe seams)
- `server/lib/session-liveness.js` (fail-safe contract header)
- `server/lib/focus-summary.js` (`computeInputDigest` precedent)
- `server/db.js` (`upsertPlanItem`, `deletePlanItemsNotIn`, plan_items block)
- `server/index.js` (single-instance port guard)
- `bin/ccam.js` (single-instance already-running message)
