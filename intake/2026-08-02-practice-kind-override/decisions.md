# Decision Log — practice-kind-override

> Every clarifying / blocking question the team raised on this request, the
> context behind it, the options offered, and the choice made. Readable on its
> own — someone should be able to open this months later and understand *what we
> decided and why*. Newest decisions at the bottom.
>
> Status values: **PENDING** (asked, awaiting answer) · **DECIDED** ·
> **DECIDED-AUTO** (decided by the team itself under `auto-pilot`, on its own
> best recommendation, without asking) · **PARKED** (deferred to stakeholder /
> later) · **SUPERSEDED** (a later decision overrode this one — link it).

---

## DEC-1 — Is `defaultSeverity` override in scope for v1, or `kind` alone?

- **Item / area:** Coach Playbook — practice config override
  (`server/lib/playbook/practices.js`, `client/src/pages/PlaybookPage.tsx`)
- **Status:** DECIDED
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** Sara
- **Recurring-issue link:** — (scope question, not a defect class)

### The question

The raw request hedges: "let a user override a practice's `kind` (and/or
`defaultSeverity`)". Do you want both in v1, or just `kind`?

### Where we're coming from (history, as of when)

The Coach/Playbook surface shipped this morning (2026-08-02, `b6d372b` +
`0a291e9`). `kind` and `defaultSeverity` are sibling fields in the catalog and
are written to `coach_observations` by the same two engine call sites
(`engine.js` lines 97/98 and 145/146), so mechanically the override is the same
work for either field.

They are **not** equally mature, though — engineer's §5.5, verified in code:

| | `kind` | `defaultSeverity` |
|---|---|---|
| DB constraint | `CHECK(kind IN ('risk','info','good'))` | `severity TEXT`, no CHECK |
| TS type | union type | plain `string` |
| i18n labels | `kindLabel` present in all 4 locales | none anywhere |
| Rendered in the Feed | yes — drives badge + border colour | **never rendered at all** by `ObservationCard.tsx` |

So a severity selector means inventing an enum that doesn't exist, authoring new
strings in four locale files, and shipping a control for a value the user cannot
see anywhere in the product.

### Options presented

- **A) `kind` only (recommended)** — smallest slice, reuses existing enum +
  existing i18n keys, zero new strings. `defaultSeverity` override can be added
  later on identical mechanics if it's ever wanted.
- **B) Both `kind` and `defaultSeverity`** — matches the raw request's widest
  reading; costs an invented severity vocabulary, 4 new locale entries, and a
  second selector controlling an invisible value.

### Decision

**Chosen:** **B) Both `kind` and `defaultSeverity`.**
**Note from decision-maker:** Explicitly asked what `defaultSeverity` was before
deciding (it's not rendered anywhere today — confirmed inert); chose to build
the override mechanism for both now rather than defer severity to a second
pass.
**Rationale / implications:** Since no severity enum, CHECK constraint, TS
type, or i18n label exists today, the technical plan must define one as part
of this build (not invent it ad hoc at the engine layer) — pin the value set,
add a `CHECK` constraint alongside `kind`'s, add i18n `severityLabel` keys in
all 4 locales, and note in the UI/QA docs that the severity control has no
visible effect in the product yet (nothing renders it), so its correctness can
only be verified at the data layer, not visually. QA §3a's five-step
frozen-snapshot test must be mirrored for `severity` as well as `kind`.

**Tech-plan follow-up (2026-08-02, `technical-plan.md` §2.3 / Override 2):**
the enum is pinned to exactly **`info` / `warning`** (the only two values the
catalog has ever written), because the new `CHECK` must be a superset of all
existing data or the migration fails at `require` time. Separately, the tech
lead found that this decision's `CHECK`-constraint clause **does** require DDL,
contrary to the "zero schema change" framing carried into the plan stage:
SQLite cannot add a `CHECK` to an existing table, so this needs a guarded
one-time table rebuild of `coach_observations` (see `technical-plan.md` Step 2,
and WATCH-3 below). The *override mechanism itself* still needs zero DDL.

---

## DEC-2 — Is the override generic across every practice, or scoped to named practices?

- **Item / area:** Coach Playbook — practice catalog + config UI
- **Status:** DECIDED
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** Sara
- **Recurring-issue link:** §9.1 DERIVED-DUAL-VIEW (indirect — a generic path is
  the single-resolver-friendly one)

### The question

Should every practice get a kind override for free, or only specific ones (e.g.
just `account-weekly-balance` / Account Rotation, the one in your example)?

### Where we're coming from (history, as of when)

The catalog has **no** "is this practice's kind overridable" flag today. There
are exactly two practices as of 2026-08-02 (`session-token-ceiling`,
session-scoped; `account-weekly-balance`, global-scoped) — which conveniently
covers both engine scopes for testing.

`practices.js`'s own file header states the design ethos: *"a new practice is a
new catalog entry, not new plumbing."* A generic mechanism honours that. But it
also means a selector appears on **every** practice card in the Playbook UI,
which is a more visible UI change than one control on one card — and the two
existing cards are bespoke components (`SessionTokenCeilingCard`,
`AccountWeeklyBalanceCard`) with no shared field-rendering abstraction between
them, so "generic" still means writing the control into both.

### Options presented

- **A) Generic — every practice (recommended)** — build it into the shared
  `resolvePracticeConfig()` path; future practices inherit it with no new
  plumbing. More visible UI change now.
- **B) Opt-in per practice** — add an `overridableKind: true` flag to catalog
  entries; only flagged practices render the selector. Slightly more catalog
  machinery, quieter UI, and a per-practice gate someone must remember to set.
- **C) Hardcode to `account-weekly-balance` only** — smallest possible change;
  guarantees a second request the first time another practice needs it. Not
  recommended.

### Decision

**Chosen:** **A) Generic — every practice.**
**Note from decision-maker:** Went with the team's recommendation.
**Rationale / implications:** Resolution stays inside `resolvePracticeConfig()`
for both `kind` and (per DEC-1) `defaultSeverity` — no per-practice special
case in `engine.js`, which would recreate the two-codepaths-for-one-fact shape
§9.1 names. The selector appears on both existing practice cards
(`SessionTokenCeilingCard`, `AccountWeeklyBalanceCard`) and on any future one.

**Tech-plan follow-up (2026-08-02, `technical-plan.md` Override 1):** to make
"generic" literal, the override is a **top-level** field on the practice
resource rather than an entry in each practice's `fields[]` array — so a future
practice inherits it with zero catalog edits, and the `config` object stays
numeric-only end to end. Storage is unchanged (still the same
`playbook_practice_config.config` JSON blob, still zero DDL).

---

## DEC-3 — Does the vocabulary-doc / code `kind` enum mismatch get its own ticket?

- **Item / area:** `library/knowledge/product/coach/coach-playbook-vocabulary.md`
  vs. shipped code (`practices.js`, `coach.json`, `coach_observations` CHECK)
- **Status:** DECIDED
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** Sara
- **Recurring-issue link:** — (spec/code drift; related to the un-intake'd-build
  process gap, see DEC-5)

### The question

The Coach vocabulary doc specifies the `kind` enum as
`opportunity / risk / reinforcement / reminder / standard`. The shipped code uses
`risk / info / good`. Should the doc be corrected to match what shipped, as its
own separate small ticket?

### Where we're coming from (history, as of when)

`coach-playbook-vocabulary.md` was authored **2026-08-01** and its own
front-matter states its purpose: *"so a future session implements against agreed
terms instead of re-deriving or drifting from them."* Its source line records
*"placeholder /coach page already shipped; this is naming/architecture only,
nothing built."*

The Playbook then shipped **2026-08-02 07:39** (`b6d372b`) using a different
`kind` enum — roughly eight hours later. No decision recording that deviation
exists anywhere in the repo, in the request-log, or in the decision-log. The
deviation is now locked into the database (`coach_observations` has
`CHECK(kind IN ('risk','info','good'))`) and into the i18n keys in all four
locales, so the code is the de facto truth and the doc is simply wrong on the one
enum this feature depends on.

PM classified this as a genuine **missed-requirement**, embedded inside (but
separable from) this `new-feature` request.

### Options presented

- **A) Separate follow-up ticket to correct the doc (recommended)** — update the
  vocab doc's enum to `risk/info/good`, note the date and reason. Keeps this
  override ticket clean.
- **B) Fix the doc inline as part of this ticket** — cheap, but quietly turns a
  feature ticket into a spec reconciliation, and buries a real spec-deviation
  record inside an unrelated change.
- **C) Change the code to match the doc** — reject. Would require a DB CHECK
  migration, new i18n keys in four locales, and re-labelling live Observations,
  to adopt a five-value vocabulary nothing needs.

### Decision

**Chosen:** **B) Fix the doc inline, as part of this same ticket.**
**Note from decision-maker:** Preferred folding it into the current effort
rather than opening a separate ticket.
**Rationale / implications:** The technical plan must include a task to
correct `coach-playbook-vocabulary.md`'s `kind` enum table to `risk/info/good`
(matching the DB CHECK constraint), record the date and reason for the
deviation inline in that doc, and — per DEC-1 — also document the new
`defaultSeverity` enum this build introduces, since none existed when that doc
was written. This ticket still builds against the shipped enum regardless;
the doc fix makes the doc agree with it rather than changing any runtime
behavior.

**Tech-plan follow-up (2026-08-02):** scheduled as `technical-plan.md` Step 13,
targeting line ~98 of the vocabulary doc.

---

## DEC-4 — Are all three kind values freely selectable, including downgrades?

- **Item / area:** Coach Playbook config UI — kind selector
- **Status:** DECIDED
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** Sara
- **Recurring-issue link:** —

### The question

Should the override let you pick any of the three kinds freely — including
"downgrading" a practice that ships as `risk` ("Warning") to `good`
("Reinforcement") or `info` ("Reminder") — or should only upgrades be allowed?

### Where we're coming from (history, as of when)

Your own worked example is an **upgrade**: `account-weekly-balance` from `info`
("Reminder") to `risk` ("Warning"). Nothing in the raw request says anything
about downgrades either way.

All three values already have `kindLabel` i18n strings shipped in all four
locales (`en`/`vi`/`zh`/`ko` — verified), so free choice costs nothing extra to
build. Restricting to upgrades-only would require defining an ordering over the
three kinds, which does not exist anywhere in the code today.

There is a product argument on each side: a "Warning" you can silence becomes a
Reminder you scroll past (the trust-erosion the vocabulary doc cares about); but
equally, you are the sole operator of your own tool and muting a practice you've
judged low-stakes is legitimate — and you can already disable a practice
entirely, which is a strictly stronger action than downgrading it.

### Options presented

- **A) Free choice of all three (recommended)** — no ordering to invent, no new
  strings, matches the existing enum exactly. The "you can already disable it
  outright" argument makes downgrade-blocking hard to justify.
- **B) Upgrades only** — requires inventing and encoding a severity ordering
  (`good < info < risk`) that exists nowhere today, plus UI to explain why an
  option is disabled.

### Decision

**Chosen:** **A) Free choice of all three.**
**Note from decision-maker:** Went with the team's recommendation.
**Rationale / implications:** No ordering to invent. QA's existing plan
already exercises all three values (`info` → `risk` → `good`) across the new
tests as written — no change needed to QA §3a for this decision.

---

## DEC-5 — Adopt an un-intake'd-capability routing rule in this repo's `PROJECT-CONTEXT.md`?

- **Item / area:** Process governance — `PROJECT-CONTEXT.md`, `/wrap-up` /
  pre-merge step
- **Status:** PENDING
- **Raised:** 2026-08-02 · **Decided:** — · **Decided by:** —
- **Recurring-issue link:** — (candidate new process-governance entry; not one of
  §9.1–§9.5)

### The question

Should this repo's `PROJECT-CONTEXT.md` gain a binding rule that any diff
introducing a **new capability** (new table, route, page, engine, or catalog)
must have an intake folder before it merges?

*(PM-raised — not one of the four sign-off questions from the product owner, but
the one item on this list that addresses the pattern rather than the instance.)*

### Where we're coming from (history, as of when)

The surface this request modifies shipped direct-to-master with **no intake
folder**, roughly 90 minutes before the request arrived:

- 2026-08-02 00:01 `dc6682d` — vocabulary doc lands, bundled inside an unrelated
  `feat(kanban)` commit
- 2026-08-02 07:39 `b6d372b` — Playbook engine, both tables, routes, UI
- 2026-08-02 08:17 `0a291e9` — `account-weekly-balance` practice, +481 lines to
  `PlaybookPage.tsx`
- 2026-08-02 ~09:42 — this intake folder created

This is the **2nd instance on this repo**, after
`intake/2026-07-31-focus-untracked-commits/` (7 un-intake'd commits, 2026-07-31,
classified `missed-requirement`), and it matches New Group's un-intake'd-code
cluster (`calendar-scheduled-session-sync` and `db-backup-retroactive-intake`,
both 2026-07-31, both same classification).

All three of those PM plans recommended the same durable fix — have `/wrap-up`
flag new-capability diffs for mandatory intake. It was written into **New
Group's** `PROJECT-CONTEXT.md`, recorded there as still unadopted as of
2026-07-31, and was never brought to this repo at all — this repo's
`PROJECT-CONTEXT.md` currently has a defect catalog (§9.1–§9.5) but no
process-governance section.

The cost is already concrete, not theoretical: DEC-3 exists only because an
approved spec and the code diverged inside a single working day with no gate to
catch it.

### Options presented

- **A) Adopt as binding, in this repo's `PROJECT-CONTEXT.md` (recommended)** —
  add a process-governance section; new table/route/page/engine/catalog diffs
  require an intake folder pre-merge. Costs a little friction on fast solo work.
- **B) Adopt as advisory** — write it down, don't enforce it. This is
  effectively the status quo, which has now failed twice on this repo.
- **C) Decline** — accept that capabilities ship first and get documented
  retroactively, and budget for follow-up cycles as the normal cost of working
  this way. A legitimate choice for a solo project, but it should be a choice
  rather than a drift.

### Decision

**Chosen:** — (pending)
**Note from decision-maker:** —
**Rationale / implications:** Team recommends **A**. Does not block this build.

---

## WATCH-1 — Multi-human distinct overrides are deliberately excluded

- **Item / area:** `playbook_practice_config` schema, "per-user" semantics
- **Status:** PARKED (recorded so the exclusion is tracked, not re-discovered)
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 (team assumption, unchallenged
  by all four evaluators) · **Decided by:** intake team
- **Recurring-issue link:** —

### The question

The request says "per-user override." This app has no user accounts. What does
per-user mean here?

### Where we're coming from (history, as of when)

`playbookStore.ts`'s own header comment states: *"this app has no user accounts,
so there is exactly one setting for everyone."* `playbook_practice_config` is a
singleton keyed only by `practice_id` — no user or account column exists anywhere
in the schema. The request's own phrasing ties the override to "that practice's
per-user config, alongside its existing **user-editable** fields (e.g.
`thresholdTokens`, `gapThresholdPct`)" — i.e. the same global singleton the
codebase already calls "user-editable" despite having exactly one user.

### Decision

**Chosen:** "Per-user" = the existing global per-practice config singleton — one
override value per practice, shared across every connected computer for this
install's single operator.

**Rationale / implications:** Architectural consequence, stated plainly (per the
architect's §4.5): once saved, an override applies to **every** practice
evaluation this install ever performs, for anyone using this dashboard from any
computer. If distinct overrides for multiple *different* humans are ever wanted,
that is a materially larger build — this app has no user-identity model to hang
it on — and this row is where to start. Flagged by the architect (§4.6) as
needing to be tracked rather than left as prose in an assessment file nobody
re-reads.

**Carried forward by the tech plan (2026-08-02):** cited in
`technical-plan.md` §7.3 as a declined scope boundary backed by this row.

---

## WATCH-2 — The severity selector controls a value nothing in the product renders

- **Item / area:** Coach Playbook config UI (`PlaybookPage.tsx`) vs. the Feed
  (`client/src/components/coach/ObservationCard.tsx`)
- **Status:** PARKED (disclosed limitation shipping knowingly, tracked so it
  isn't re-discovered as a bug)
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead, implementing DEC-1
- **Recurring-issue link:** — (scope limitation, not a defect class)

### The question

DEC-1 chose to build the override for `defaultSeverity` as well as `kind`. But
`ObservationCard.tsx` never renders `severity` anywhere — only `kind` drives the
badge and border colour (confirmed by reading the whole file). What is the
status of a shipped control whose value the operator cannot see?

### Where we're coming from (history, as of when)

Verified in code on 2026-08-02: `coach_observations.severity` is written at
insert time and read by nothing in the client's rendering path. The engineer
flagged this as §5.5; the PM plan restated it; DEC-1 accepted it explicitly
("the severity control will have no visible effect in the product yet … its
correctness is verified at the data layer only").

### Decision

**Chosen:** Ship the severity override anyway, per DEC-1, and record the
limitation here rather than leaving it as prose in an assessment file.

**Rationale / implications:**
- The severity override is fully functional at the data layer: it resolves
  through `resolvePracticeConfig()`, is frozen onto `coach_observations.severity`
  at fire time by both engine call sites, and is enforced by the new
  `CHECK(severity IN ('info','warning'))`.
- Its correctness is provable **only** by the frozen-snapshot regression test
  (`technical-plan.md` §6.1), which is why that test must assert `severity`
  alongside `kind` at every step. There is no visual verification path.
- If the Feed should ever *display* severity (e.g. an urgency dot distinct from
  the kind badge), that is a separate, small UI change — and this row is where
  to start. The i18n keys it would need (`severityLabel.info` /
  `severityLabel.warning`, all four locales) already exist as of this build.
- Watch for: a future reader concluding "the severity selector does nothing" and
  removing it as dead code. It is not dead; it is unrendered.

---

## WATCH-3 — The severity CHECK migration deliberately skips on non-conforming data

- **Item / area:** `server/db.js` — `coach_observations` guarded rebuild
  (`technical-plan.md` Step 2)
- **Status:** PARKED (accepted partial outcome, tracked)
- **Raised:** 2026-08-02 · **Decided:** 2026-08-02 · **Decided by:** intake
  tech lead, implementing DEC-1
- **Recurring-issue link:** §9.5 FRESH-DB-BLIND SCHEMA CHANGE (this row is the
  residue left after complying with it)

### The question

DEC-1 requires a `CHECK` constraint on `coach_observations.severity`. SQLite
cannot add a `CHECK` to an existing table, so this needs a full guarded table
rebuild. What happens on an install whose existing rows hold a severity value
outside the pinned `{info, warning}` set?

### Where we're coming from (history, as of when)

- `server/db.js` line 1373: `severity TEXT NOT NULL` — no CHECK today.
- `server/db.js` line 672 already records the constraint this runs into:
  *"SQLite cannot add a CHECK via ALTER TABLE ADD COLUMN at all, so shipping the
  base shape first would cost a full rebuild."*
- Adding the CHECK to the `CREATE TABLE IF NOT EXISTS` body alone would silently
  no-op on every existing install — textbook §9.5, the exact defect class this
  ticket was otherwise avoiding.
- `db.js` executes at `require` time, so a throw during migration **bricks the
  dashboard at boot**, not at first use.
- The only values the catalog has ever written are `"warning"`
  (`session-token-ceiling`) and `"info"` (`account-weekly-balance`), so this
  branch should be unreachable in practice.

### Options considered

- **A) Rewrite offending rows to a conforming value** — rejected. This feature's
  entire premise is that `coach_observations` rows are frozen historical facts;
  silently rewriting one to satisfy a constraint violates the invariant being
  shipped.
- **B) Throw / abort** — rejected. Bricks the app at boot for a defence-in-depth
  constraint.
- **C) Pre-flight scan; skip the rebuild and leave the table unconstrained
  (chosen).**

### Decision

**Chosen:** **C.** The migration counts rows with `severity NOT IN
('info','warning')` before touching anything; if the count is non-zero it skips
the rebuild entirely, leaving the table as-is and the app booting normally.

**Rationale / implications:**
- Such an install keeps the application-layer enum enforcement (the route
  validator and `SEVERITY_VALUES`) but **not** the DB-level constraint. That is
  a real, if narrow, divergence between two installs' schemas.
- Because the skip is silent by design (no throw), nothing will surface it at
  runtime. This row is the only record that the divergence is possible. If a
  future change assumes the CHECK is universally present, start here.
- Covered by `technical-plan.md` §6.4 assertion 6 (seeded out-of-enum row →
  table untouched, no throw).
- Note that `db-migration.test.js`'s meta-test only scans for
  `ALTER TABLE … ADD COLUMN` and will **not** auto-catch this rebuild; its
  migration test is a required deliverable, not a tripwire we can lean on.

---
<!-- copy the DEC block above for each new question -->
