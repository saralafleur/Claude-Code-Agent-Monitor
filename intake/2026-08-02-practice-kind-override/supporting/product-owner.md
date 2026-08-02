# Product Owner Assessment — Per-Practice `kind` Override

Source: `intake/2026-08-02-practice-kind-override/request-brief.md`
Grounding checked: `PROJECT-CONTEXT.md` (repo topology + recurring-defect-class
catalog — no dedicated scope-decision/business-requirements doc set exists in
this repo beyond this), `library/knowledge/product/coach/
coach-playbook-vocabulary.md` (the Coach/Playbook naming and design-intent
source of truth), `server/lib/playbook/practices.js`,
`client/src/lib/playbookStore.ts` (read directly to confirm the brief's
framing).

## 1. Value & intent

The requester (Sara, who is both the project owner and the app's sole
operator) is not asking for a new category of information — she's asking to
fix a **miscalibration between a catalog default and her own operational
reality**. `account-weekly-balance` ships as `kind: "info"` ("Reminder")
because that's the right default for *most* people running this dashboard,
but for Sara specifically, letting an account run out of weekly quota without
a rotation is operationally costly. Today the only way to make that practice
visually stand out in the Feed is to edit the shipped catalog file, which
would also change the label for every other install.

The actual outcome wanted: **the Coach's Feed should reflect the true
severity a practice has *for the person running it*, not just its shipped
default** — without forking the catalog. This matters because the entire
point of the Coach/Playbook (per the vocabulary doc) is to be trusted signal;
a practice that's silently mislabeled "Reminder" when it should read
"Warning" is exactly the kind of thing that erodes trust in the Feed and
causes a real risk to be scrolled past.

## 2. Scope check

**In scope, and consistent with (not contradicting) the approved design.**

- The vocabulary doc's own definition of **Practice config** is: "User-
  adjustable settings for a practice — enabled on/off, thresholds/params.
  Server-persisted, shared live across every connected computer, editable
  from the Coach page — same architecture as Usage's Color Thresholds card."
  A `kind`/`defaultSeverity` override is the same *shape* of thing (a
  per-practice, user-adjustable, globally-persisted setting) as the
  thresholds already living there — this is an incremental extension of an
  already-approved pattern, not a new one.
- Nothing in the vocabulary doc forbids or reserves `kind` as
  catalog-immutable. It defines `kind` as a modeling requirement so the Coach
  can distinguish risk from reinforcement — it doesn't state that value must
  be fixed forever per practice.
- **One real, but non-blocking, doc/code inconsistency to flag explicitly**
  (the brief already caught this, and I agree with its handling): the
  vocabulary doc lists the "FINAL AGREED" `kind` enum as `opportunity / risk
  / reinforcement / reminder / standard`, but the shipped code
  (`practices.js`, `coach.json` `kindLabel`) actually implements
  `risk / info / good`. That doc is explicitly marked as the project's
  naming/vocabulary source of truth for this feature area — so this is a
  live discrepancy between an approved spec and what's shipped, independent
  of this request. **I agree this ticket should build against the shipped
  enum** (that's what actually renders in the UI today, and re-deriving a
  three-year-old wish-list enum mid-feature would be scope creep), **but I'm
  flagging it for Sara as a separate, explicit follow-up**: either the
  vocabulary doc should be updated to match what shipped, or someone decided
  to diverge from it silently at build time and that decision was never
  recorded. Don't let this override feature quietly become the vehicle for
  that reconciliation — it should be its own small doc-fix ticket.
- No approved decision anywhere says a practice's `kind` must stay fixed
  post-catalog, and no signed-off spec is contradicted by adding an override.

**"Per-user" framing — I agree with the brief's resolution.** This is a
single-operator, local-first dashboard with an explicitly documented
"no user accounts" model (`playbookStore.ts`'s own header comment, and the
`playbook_practice_config` table's schema — singleton keyed only by
`practice_id`, no user/account column anywhere). Reading "per-user override"
as "an override on the existing global per-practice singleton, same object
today's numeric fields already live in" is the only reading that matches how
this codebase already talks about itself (it already calls today's shared
singleton fields "user-editable" despite there being exactly one user). I
see no signal anywhere — in the raw request, the vocabulary doc, or the
schema — that Sara actually wants per-*account* differentiation (which this
app has no identity model to hang on at all). If that turns out to be wrong,
it's a materially larger, different feature and should be re-scoped as such
before design, not discovered mid-build.

## 3. Acceptance criteria (user-facing, testable)

Done when all of the following hold:

1. **Configurability**: for a practice whose kind is overridable, the
   Playbook config UI (`PlaybookPage.tsx`) presents a kind selector (values:
   Warning / Reminder / Reinforcement, i.e. the shipped `risk`/`info`/`good`
   set with existing `kindLabel` i18n strings), defaulting to the practice's
   built-in `kind` when no override has been set.
2. **Persistence**: setting an override survives a page reload and is
   visible/consistent across every connected computer/tab (same
   shared-singleton behavior the existing numeric fields already have —
   e.g. `gapThresholdPct`).
3. **Forward effect, correctly scoped**: after overriding
   `account-weekly-balance` from Reminder to Warning, the **next** Observation
   the Coach engine creates for that practice is labeled "Warning" in the
   Feed.
4. **Non-retroactivity (the requester's explicit, named criterion)**:
   Observations created *before* the override was set — open, acknowledged,
   or dismissed — keep displaying their original stored `kind`/severity label
   after the override changes. This must be proven by an automated regression
   test that creates an Observation, changes the override, and asserts the
   existing row's stored `kind` is byte-unchanged — not by inspection. (Note
   for whoever writes QA: per §9.1 in `PROJECT-CONTEXT.md`, do **not** apply
   the "same value everywhere" derived-value criterion here — this feature's
   correct behavior is that the live resolved kind and the frozen historical
   kind are *supposed* to diverge after an override change. The acceptance
   test is "the old row didn't change," not "the two values match.")
5. **Reversibility**: clearing/unsetting the override returns new
   Observations to the catalog's built-in `kind`/`defaultSeverity`.
6. **i18n correctness**: the overridden label renders correctly in all four
   shipped locales (en/vi/zh/ko), not just `en` — the brief notes this
   wasn't independently verified beyond `en`, so it should be checked as
   part of "done," not assumed.
7. **No catalog mutation**: setting an override for one install/session does
   not alter `practices.js`'s built-in defaults (verifies the "without
   touching the catalog" intent is actually met, not just claimed).

There is no content-wording concern here in the classic sense (no
marketing/support copy is changing) — the existing `kindLabel` strings are
being reused, not authored — so the usual "matches the approved source
wording exactly" criterion collapses to: correct label is selected and
correct i18n key is reused, nothing new coined.

## 4. Priority & impact

- **Who's blocked**: exactly one person — Sara, the project owner and this
  app's only operator. There is no other stakeholder or end user population
  to weigh.
- **Visibility**: high *to her*, low in absolute terms — this is a daily-use
  tool for one person, and the miscategorization is something she
  encounters personally every time Account Rotation fires as a low-key
  "Reminder" when it matters more to her than that.
- **Urgency**: no active incident, no external deadline, no other person's
  work is gated on this. This reads as an accumulating-friction /
  trust-in-the-tool issue, not an emergency. I'd call this normal priority
  by default — but since the requester is also the sole stakeholder, her own
  stated urgency should simply override my read here if she has one; there's
  no competing party to negotiate against.
- **Sizing signal for prioritization purposes only** (not my call to make,
  flagging for whoever sequences intake): the request brief's own scope
  section shows this touches schema-or-config-shape, engine, API docs, and
  net-new UI (no existing generic kind-selector control to reuse) — this is
  a real, if small, feature, not a one-line tweak, which is relevant to how
  it gets slotted against other queued intake items.

## 5. Stakeholder questions (need Sara's sign-off before build)

1. **`kind` only, or `kind` + `defaultSeverity` for v1?** The raw request
   hedges with "and/or." Since each is the same mechanism, I don't object to
   building both, but confirm this is actually wanted for v1 and not
   scope-padding — an extra selector Sara doesn't need is still UI surface
   someone has to maintain.
2. **Every practice, or a named subset?** No catalog flag exists today for
   "this practice's kind is overridable." I'd default to "generic, every
   practice" per this codebase's stated design ethos ("a new practice is a
   new catalog entry, not new plumbing"), but confirm — a generic selector on
   every practice card is a bigger, more visible UI change than one scoped to
   just Account Rotation.
3. **Vocabulary-doc drift (flagged in §2 above)**: should
   `coach-playbook-vocabulary.md`'s stated `kind` enum
   (`opportunity/risk/reinforcement/reminder/standard`) be corrected to match
   what actually shipped (`risk/info/good`), as its own separate small
   ticket? I'd recommend yes, since that doc explicitly bills itself as the
   thing a future session should "build against" and is currently wrong on
   the one enum this very feature touches — but that's a call for Sara, not
   something to silently patch as a side effect of this ticket.
4. **Schema-shape choice** (extend the generic `fields`/`config` JSON vs. a
   new dedicated column) is a build/design decision, not a product one — no
   sign-off needed from me here, just flagging that whichever the design
   stage picks, §9.5 in `PROJECT-CONTEXT.md` (FRESH-DB-BLIND SCHEMA CHANGE)
   applies if a dedicated column is chosen, since `DB_PATH` resolves to the
   real shared dashboard DB.
5. **Selectable values**: should all three kinds be freely selectable
   (including "downgrading," e.g. turning something risk-by-default into a
   Reminder), or only upgrades? Nothing in the raw ask restricts this; I'd
   default to "free choice" (matches existing i18n coverage, and an operator
   overriding her own tool's severity for her own workflow is a legitimate
   use even if it's a downgrade) — but worth a one-line confirmation since
   it's cheap to ask and avoids guessing wrong on a UX detail.
