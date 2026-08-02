# PM Plan — practice-kind-override

> Authored by `intake-project-manager`. **This is the document you read first.**
> It answers: what is this really, where is it coming from, and how do we stop it
> coming back.

## Request summary

Sara wants to be able to re-label a Coach Playbook practice for her own install:
`account-weekly-balance` (Account Rotation) ships in the catalog as
`kind: "info"`, which renders in the Feed as "Reminder", but for her it is
operationally critical and should render as "Warning" (`kind: "risk"`). Today
`kind` is hardcoded per practice in `server/lib/playbook/practices.js`, and the
only way to change it is to edit the shipped catalog — which would change it for
everyone. The ask is a per-practice override of `kind` (and possibly
`defaultSeverity`) stored alongside the practice's existing user-editable config
(the same place `thresholdTokens`/`gapThresholdPct` live), defaulting to the
catalog value when unset. The one hard constraint she stated herself: the
override must be read **at fire time**, when the Coach engine creates an
Observation — so changing the override later must never retroactively relabel
Observations that already exist.

All four evaluators independently converged on the same build shape: extend the
existing per-practice `config` JSON blob on `playbook_practice_config` with an
enum-valued override field, resolved through the existing
`resolvePracticeConfig()`. No DDL, no `ALTER TABLE`, no migration test — which
sidesteps this project's §9.5 FRESH-DB-BLIND SCHEMA CHANGE defect class entirely
rather than having to comply with it.

## Request type

**`new-feature`** — confirming triage's provisional call, with one embedded,
separable **`missed-requirement`** called out inside it (see below).

Reasoning:

- Not a **bug**: nothing is broken. `kind` being catalog-fixed is the deliberate
  current design; the engine, route, and UI all behave exactly as written.
- Not a **regression**: this never worked. The override mechanism does not exist
  anywhere in schema, engine, route, or UI — verified in code
  (`resolvePracticeConfig()` merges only `typeof value === "number"` entries from
  `practice.fields`; `engine.js` lines 97/98 and 145/146 pass the bare
  `practice.kind` / `practice.defaultSeverity` straight into
  `insertCoachObservation.run(...)`).
- Not a **missed-requirement** *for the main ask*: the approved spec for this
  surface — `library/knowledge/product/coach/coach-playbook-vocabulary.md`
  (created 2026-08-01, the project's own naming/architecture source of truth for
  the Coach) — defines **Practice config** as "user-adjustable settings for a
  practice — enabled on/off, thresholds/params." `kind` is not a threshold or a
  param; it is a classification. The build delivered what the spec described. The
  spec simply didn't anticipate that the sole operator would disagree with a
  catalog default within hours of using it. That is product feedback, not a
  broken promise.

**The embedded missed-requirement (separable, and NOT this ticket's job to fix):**
the same vocabulary doc specifies the `kind` enum as
`opportunity / risk / reinforcement / reminder / standard`, while the code that
shipped ~8 hours later uses `risk / info / good` — a divergence from an approved,
explicitly-"build against this" spec that was never recorded anywhere. That is a
genuine missed-requirement on its own, and it needs its own small ticket. This
project has direct precedent for this mixed classification: `focus-report-fidelity`
(2026-07-26, DEC-1) was logged as "missed-requirement overall, with one standalone
bug called out inside it." Same structure here, inverted. **Do not let this
override ticket become the vehicle for that reconciliation** — build against the
shipped enum (`risk`/`info`/`good`), which is also what `coach_observations`'s
`CHECK(kind IN ('risk','info','good'))` constraint and the `kindLabel` i18n keys
in all four locales already enforce.

## History / background

Sources checked: `~/.claude/skills/team-intake/memory/request-log.md`,
`~/.claude/skills/team-intake/memory/decision-log.md`,
`PROJECT-CONTEXT.md` §9.1–§9.5 defect catalog, all five prior `intake/` folders
in this repo, and `git log` on the Coach/Playbook surface.

**Timeline of this exact area:**

| When | What |
|---|---|
| 2026-08-01 | `coach-playbook-vocabulary.md` authored — the Coach/Playbook naming + architecture decision doc. Front-matter states its own purpose: *"so a future session implements against agreed terms instead of re-deriving or drifting from them."* Source line: *"placeholder /coach page already shipped; this is naming/architecture only, nothing built."* Specifies `kind` as `opportunity/risk/reinforcement/reminder/standard`. |
| 2026-08-02 00:01 (`dc6682d`) | That vocabulary doc lands — bundled inside an unrelated `feat(kanban)` commit. |
| 2026-08-02 07:39 (`b6d372b`) | `feat(coach): finish Playbook UI + docs` — the whole Playbook engine, `playbook_practice_config` + `coach_observations` schema, routes, and UI ship. Shipped with `kind` = `risk/info/good`, i.e. already diverged from the doc written the day before. |
| 2026-08-02 08:17 (`0a291e9`) | `feat(coach,devops): add account-weekly-balance Playbook practice` — the **exact practice this request is about** ships, `kind: "info"`, +481 lines to `PlaybookPage.tsx`. |
| 2026-08-02 ~09:42 | This intake folder is created. |

**Have we seen this before?**

Two different answers, and both matter:

1. **The Coach/Playbook surface: no — 0 prior intake cycles. Genuinely new.**
   Zero matches in the request-log, zero in the decision-log, and none of this
   repo's five prior intake cycles (`focus-report-fidelity`,
   `focus-calendar-board`, `wip-queue-page`, `focus-untracked-commits`,
   `build-project-manager`) touched it. No settled decision is being
   re-litigated and nothing here contradicts a prior ruling.

2. **The *shape* of how it got here: yes — 2nd time on this repo, ~5th across
   Sara's projects.** The entire surface this request modifies shipped
   direct-to-master with **no intake folder behind it**, roughly 90 minutes
   before the request arrived. That is precisely
   `intake/2026-07-31-focus-untracked-commits/` (2026-07-31, this repo, 7
   un-intake'd commits, classified `missed-requirement`), and it matches New
   Group's un-intake'd-code cluster (`calendar-scheduled-session-sync`,
   `db-backup-retroactive-intake`, both 2026-07-31, both same classification).
   The durable fix all three of those plans recommended — make `/wrap-up` flag
   new-capability diffs (new tables/routes/jobs) for mandatory intake before the
   next status run — was written into **New Group's** `PROJECT-CONTEXT.md` and
   was still recorded as unadopted as of 2026-07-31. It was never brought to
   this repo's `PROJECT-CONTEXT.md` at all, which currently has no
   process-governance section.

3. **The defect class the build will run into: §9.1 DERIVED-DUAL-VIEW, 6th
   touch — but as a design-time pre-flag, not a counted occurrence.** Details in
   the next section.

## Recurrence diagnosis

Two distinct recurrences, one systemic cause each.

### Recurrence A — §9.1 DERIVED-DUAL-VIEW, in its "constant becomes a variable" form

This is the important one for the build, and it is subtle enough that it would
be easy to miss.

`resolvePracticeConfig()`'s own header comment claims it is the single source of
truth: *"the engine … and the route … read through [it], so the two can never
silently disagree about what's actually configured."* That claim is true for
`practice.fields` — and **false for `kind`/`defaultSeverity`, which route around
it entirely.** There are three independent hand-written readers of "this
practice's effective kind" today:

- **write path** — `engine.js` lines 97/98 and 145/146 (`evaluateSession` and
  `evaluateGlobal`, two separate call sites) read `practice.kind` directly;
- **read path** — `routes/playbook.js`'s `serializePractice()` hardcodes
  `kind: practice.kind`;
- **display path** — `PlaybookPage.tsx` lines 257 and 335 pass `practice.kind`
  into the live-preview `<ObservationCard>` in each of the two practice cards.

Those four sites agree today **only because the value cannot vary**. This feature
makes it vary. The instant an override exists, every site that wasn't updated
silently keeps showing/writing the catalog default — and each failure is invisible
in a different layer. The engineer's §5.3 is the sharpest illustration: miss the
two client preview lines and the operator picks "Warning", saves successfully, and
watches the preview card directly underneath the control still say "Reminder."

This is the exact shape §9.1's own most recent entry warned about. Its
2026-08-01 build-outcome note says: *"when a build introduces a new 'one function
does X for everybody' rule, scan for copies of its helpers too, not just of it."*
The Playbook shipped the very next morning with a textbook copy: the
"only known `fields[].key`, only finite numbers ≥ `min`" rule is written
**twice, independently** — once in `resolvePracticeConfig()` (`practices.js`) and
once in `validateConfigPatch()` (`routes/playbook.js`). Both walk
`practice.fields`; neither calls the other.

**Systemic cause:** this codebase's resolver-as-single-source-of-truth discipline
is applied to *values that already vary* (numeric thresholds) and skipped for
*values that don't yet* (`kind`, `defaultSeverity`). Duplication of a constant is
invisible — it costs nothing and breaks nothing until the day someone makes the
constant configurable. Which is today.

**Count: NOT incremented (stays at 5).** Nothing has misbehaved; all four sites
currently agree, and no code has been written for this request. This follows the
catalog's own established convention for design-time pre-flags
(`build-project-manager`, 2026-08-01: *"Re-check at build/QA time and increment
only if a real duplication ships."*). I have added a dated pre-flag to §9.1 naming
all four sites.

### Recurrence B — capability ships, *then* comes to intake

The Coach/Playbook — a new engine, two new tables, new routes, a new page, and a
practice catalog — went from "nothing built" (2026-08-01) to fully shipped on
master (2026-08-02 08:17) without an intake folder, and the first intake touch of
that surface is this follow-up request 90 minutes later.

**Systemic cause:** there is no mechanism that routes a new capability into intake
*before* it merges. The fix for this was diagnosed correctly twice on 2026-07-31
(here and in New Group), written down once (in New Group's `PROJECT-CONTEXT.md`),
adopted zero times, and never propagated to this repo. A recommendation that lives
in one project's context file and is enforced by nothing is not a durable fix — it
is a note. That is why the same thing happened again the very next week.

The observable cost is already visible, and it is not abstract: the vocabulary
doc's `kind` enum and the shipped `kind` enum diverged inside a single working
day, with no decision recorded anywhere, on the one enum this very request
depends on. That divergence is what makes PO's open question 3 necessary at all.

## Where this is coming from

Root source, in order of weight:

1. **A changed requirement, discovered by first contact with the shipped
   thing.** The catalog default (`info`/"Reminder") was a reasonable general
   default and a wrong personal default. Sara found that out by using the
   feature the same morning it shipped. Nothing was mis-built; the requirement
   was incomplete because nobody had run the feature yet. This is the healthy
   kind of feedback, and it is the majority of this request.

2. **Spec/code drift on the `kind` enum**, unrecorded — a real
   missed-requirement, separable from this ask, caused by Recurrence B (the
   build never passed a gate that would have caught it).

3. **A latent single-source-of-truth gap** — `kind`/`defaultSeverity` bypass the
   resolver that the codebase's own comment says everything reads through. Not a
   defect today; guaranteed to become one the moment this feature ships
   partially. This is the thing that turns a small feature into a recurring one
   if we get it wrong.

There is no misunderstanding, no ambiguity about intent, and no blocking
question. Triage's READY verdict holds.

## Recommendation

### Approve — as a small `new-feature`, our-new-ask (not our-cost), scoped tight

This is **a new ask, not a warranty repair**. The original build met its spec;
nobody owes this. It is also cheap and clearly worth doing for the sole operator
— effort **M**, concentrated in the client (new selector control, which has no
existing generic enum-field renderer to reuse).

**Build it as Option A — the generic `config` JSON blob, resolved through
`resolvePracticeConfig()`.** All four evaluators reached this independently, and
I concur. Two reasons beyond their technical case:

- It makes §9.5 FRESH-DB-BLIND SCHEMA CHANGE **inapplicable** rather than
  *complied with*. `playbook_practice_config.config` is already
  `TEXT NOT NULL DEFAULT '{}'` — a new key needs no DDL, no `PRAGMA table_info`
  guard, no `UPGRADE_CASES` entry. Given that this project's last brush with
  §9.5 (`detour_dispositions.project_id`) would have broken every existing
  install and was caught only by an incidental test coupling, "the trap can't
  apply" beats "we remembered to disarm the trap."
- It keeps `resolvePracticeConfig()` as the one place effective config is
  computed, which is the direct countermeasure to Recurrence A.

### The durable fix — three items, in priority order

**D1 (blocking, in this build): make the resolver actually be the single source
of truth for `kind`, and prove it structurally.** Not "update the four sites" —
that is the patch, and it is exactly what will rot. Instead:

- `resolvePracticeConfig()` returns the resolved `kind`/`severity` alongside
  `enabled`/`config`, and `resolveEnabledPractices()` attaches it once per tick;
- **`engine.js`, `serializePractice()`, and both `PlaybookPage.tsx` preview
  cards read that resolved value — nobody reads `practice.kind` directly again**;
- add a **guard test that fails when a new direct reader appears** — a static
  scan for `practice.kind` / `practice.defaultSeverity` outside
  `practices.js`, in the shape of the `single-writer-guard.test.js` /
  `chronology-ordering.test.js` scans this repo already built on 2026-08-01. Two
  lessons from that build apply verbatim: prove the guard by injecting a rogue
  reader and watching it go red (§9.3 VACUOUS-GUARD), and don't let the scan's
  regex silently under-scan.

**D2 (blocking, in this build): the two numeric gates must move in lockstep —
and the diff must be reviewed as a fix round, not a touch-up.** This is the
engineer's headline flag and I am elevating it, because each half fails
*silently in a different direction*:

- miss `validateConfigPatch` (`routes/playbook.js`, `typeof value !== "number"`
  throws) → every save 400s with `unknown config field "kind"`; loud, annoying,
  harmless;
- miss `resolvePracticeConfig` (`practices.js`, `typeof value === "number"`
  filter) → the PUT **succeeds and persists**, and every read path silently
  ignores it forever. This is the classic "saved but never applied" bug, and it
  passes a "does the PUT return 200?" smoke test.

The better durable answer is to stop having two copies: have
`validateConfigPatch` and `resolvePracticeConfig` share one exported
field-validation function, so the second branch (enum membership) is written
once. If that extraction is judged too invasive for this ticket, then at minimum
both copies change in the same commit with a test per direction — but the
extraction is what actually closes it, and it is small.

**D3 (this build's acceptance test — the load-bearing one): the frozen-snapshot
regression test, written in the INVERSE of §9.1's usual form.** QA's §3a is the
right test and should be built as written: fire → assert `info` → dismiss →
set override → fire → assert `risk` → change override again → **assert both
prior rows' `kind` are byte-unchanged**. Two guardrails around it:

- Per §9.3, it must be shown to go **red** against the pre-change code before
  it counts. A frozen-snapshot test that passes trivially (because nothing ever
  updates the row) is exactly the vacuous shape §9.3 names.
- **Explicitly do not apply §9.1's normal "same field, same value, across every
  consumer" criterion to `coach_observations.kind` vs the live resolved kind.**
  They are *supposed* to diverge after an override change — that is the feature.
  All four evaluators flagged this independently and QA already has it as a DoD
  line item; I am restating it here because §9.1 is now a written, citable
  catalog entry, and the failure mode is a reviewer applying it by rote and
  demanding the wrong behavior. Under no circumstances should anyone add a
  trigger, computed column, or backfill to "re-sync" old Observations.

**D4 (process, and the one I most want a decision on): port the un-intake'd-code
routing rule into *this* repo's `PROJECT-CONTEXT.md` and make it binding.** Two
retroactive/follow-up cycles on this repo in three days now trace to the same
missing gate, and the remedy has been recommended three times across two projects
and adopted zero times. Concretely: `/wrap-up` (or the pre-merge step, whichever
is real here) flags any diff introducing a new table, route, page, engine, or
catalog and requires an intake folder before merge. Without it, the next Coach
feature will arrive the same way and we will have this conversation a third time.

### Scope guidance

**Superseded by decision (see DEC-1 below):** Sara reviewed the team's
`kind`-only recommendation, asked for the `kind` vs. `defaultSeverity`
distinction to be explained, and chose to build the override for **both**
`kind` and `defaultSeverity` in v1. Since `severity` has no enum today
(`severity TEXT` with no `CHECK`), no TS union, and no i18n labels, the
technical plan must define that enum as first-class work in this build — not
bolt it on ad hoc — including a `CHECK` constraint alongside `kind`'s and new
`severityLabel` i18n keys in all four locales. Note for QA and future readers:
the severity control will have no visible effect in the product yet
(`ObservationCard.tsx` doesn't render it), so its correctness is verified at
the data layer (frozen-snapshot test, mirroring `kind`'s), not visually.

One precedent still worth naming for sequencing: `wip-queue-page` went through
this full pipeline on 2026-07-28 and was **removed entirely two days later**
(`18196dc`, 2026-07-30). Small operator-facing features on this repo have a
real history of not surviving contact — worth keeping in mind now that scope
grew by one field beyond the team's minimal recommendation.

## Open decisions for the user

Recorded in `decisions.md` as DEC-1 … DEC-5. Sara decided DEC-1 through DEC-4
directly in chat on 2026-08-02; DEC-5 (process governance, doesn't block this
build) remains **PENDING**.

- [x] **DEC-1 — `kind` only, or `kind` + `defaultSeverity` for v1?**
      **DECIDED: both.** Team recommended `kind` only; Sara asked for the
      distinction to be explained (severity has no enum, no labels, and is
      never rendered anywhere today) and chose to build both anyway. The
      technical plan must define the `defaultSeverity` enum from scratch as
      part of this work.
- [x] **DEC-2 — override available on every practice generically, or only on
      named ones (e.g. just Account Rotation)?**
      **DECIDED: generic**, per the catalog's own ethos ("a new practice
      is a new catalog entry, not new plumbing"). Selector appears on every
      practice card, including future ones.
- [x] **DEC-3 — does the vocab-doc/code `kind` enum mismatch get its own
      ticket?** Doc says `opportunity/risk/reinforcement/reminder/standard`;
      code ships `risk/info/good`. **DECIDED: no separate ticket — fix the
      doc inline, in this same effort.** Team had recommended a separate
      ticket; Sara chose to fold it in. The technical plan must include
      correcting that doc's enum table (and documenting the new
      `defaultSeverity` enum this build introduces) alongside the code
      changes.
- [x] **DEC-4 — are all three kind values freely selectable, including
      "downgrades" (e.g. a `risk` practice overridden down to `good`)?**
      **DECIDED: free choice.** Matches the team's recommendation — all three
      already have `kindLabel` i18n keys in all four locales.
- [ ] **DEC-5 — adopt the un-intake'd-capability routing rule in this repo's
      `PROJECT-CONTEXT.md`?** (PM's own addition — see D4.) Team recommends
      **yes**. This is the only item on the list that stops the pattern rather
      than the instance.

Also recorded as a **WATCH** row, not a question: multi-human distinct overrides
are deliberately excluded. "Per-user" here means the existing global singleton
`playbook_practice_config` row (no user/account column exists anywhere in this
app). If a second human user ever materializes, this exclusion is where to look.

---
*Memory updated:* `request-log.md` ✅ · `PROJECT-CONTEXT.md` §9.1
DERIVED-DUAL-VIEW — dated design-time pre-flag added, **occurrence count
unchanged at 5** (no code written; all four readers currently agree).
