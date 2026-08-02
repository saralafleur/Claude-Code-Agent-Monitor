# Request Brief: Per-User Override of a Practice's `kind` in the Coach's Playbook

## Raw ask (verbatim)

From Sara, the project owner, via conversation, 2026-08-02:

> "Add a per-user override for a Practice's `kind` in the Coach's Playbook.
>
> Context: Today `kind` (risk / info / good — which drives the Feed label
> Warning / Reminder / Reinforcement) is hardcoded per practice in the
> catalog (server/lib/playbook/practices.js), e.g. `account-weekly-balance`
> ships as `kind: "info"` (labeled "Reminder"). Sara wants some practices to
> be reclassifiable per user — e.g. Account Rotation is a low-stakes
> "Reminder" for most people, but for Sara personally it's operationally
> critical and should render as a "Warning".
>
> Requested capability: let a user override a practice's `kind` (and/or
> `defaultSeverity`) in that practice's per-user config, alongside its
> existing user-editable fields (e.g. thresholdTokens, gapThresholdPct). The
> override should default to the practice's built-in `kind` when unset.
>
> Known constraint to preserve (already true today, confirmed by reading
> server/openapi-extra/playbook-coach.js and server/lib/playbook/practices.js):
> an Observation's `kind` is copied from the practice's kind at detection
> time, not derived live at render time. Any override must apply at fire-time
> so that changing your override later does not retroactively relabel past
> open/acknowledged/dismissed Observations.
>
> Scope to evaluate: schema change to practice config
> (server/lib/playbook/practices.js `fields`, or a new dedicated override
> column separate from the generic `config` JSON), the Coach engine
> (server/lib/playbook/engine.js) reading the override when creating an
> Observation, the Playbook API/config UI (client/src/pages/PlaybookPage.tsx,
> playbookStore.ts) exposing a kind selector, and i18n label updates if
> needed (client/src/i18n/locales/*/coach.json)."

## Restated ask

Let the operator override a built-in Practice's `kind` (and optionally its
`defaultSeverity`) from the Playbook config UI, per practice, so a practice
that ships as a low-stakes catalog default (e.g. Account Rotation's
`kind: "info"` → "Reminder") can be locally reclassified to a
higher-attention label (e.g. "Warning") without touching the catalog. The
override must be read by the Coach engine only at Observation-creation
("fire") time, so changing the override later never relabels
already-created Observations.

## Requester / source

Sara, project owner, via direct conversation on 2026-08-02 (no ticket/email
— conversational request relayed to intake).

## Surface / area touched

The Coach's Playbook, specifically:

- `server/lib/playbook/practices.js` — the practice catalog; `PRACTICES[].kind` /
  `.defaultSeverity` (built-in defaults), the `fields` schema, and
  `resolvePracticeConfig()` (currently only merges *numeric* stored field
  overrides — `typeof value === "number"` — over catalog defaults; has no
  concept of an enum/string override today).
- `server/lib/playbook/engine.js` — `evaluateSession()` / `evaluateGlobal()`,
  which currently write `practice.kind` / `practice.defaultSeverity`
  (the catalog's built-in values, unconditionally) into
  `insertCoachObservation.run(...)` at fire time. This is the exact call
  site that must switch to reading the resolved override instead of the
  bare catalog value.
- `server/db.js` — `playbook_practice_config` table (`practice_id TEXT
  PRIMARY KEY, enabled, config, updated_at` — a **global singleton per
  practice**, not scoped by any user/account id; see Known-variant
  relevance below for why this matters) and `coach_observations` (stores
  `kind`/`severity` per row, frozen at insert).
- `server/openapi-extra/playbook-coach.js` — API contract docs for the
  Playbook/Coach routes; will need the new override field(s) documented.
- `client/src/pages/PlaybookPage.tsx` / `client/src/lib/playbookStore.ts` —
  the config UI. Each practice currently renders one bespoke card
  (`SessionTokenCeilingCard`, `AccountWeeklyBalanceCard`) that edits
  exactly `practice.fields[0]` with a practice-specific numeric-input
  widget — there is no generic/shared "kind selector" control today, so
  this is new UI, not a drop-in reuse of the existing numeric-field
  renderer.
- `client/src/i18n/locales/{en,vi,zh,ko}/coach.json` — `kindLabel` already
  defines all three shipped kind labels (`risk`→"Warning",
  `info`→"Reminder", `good`→"Reinforcement") across all four locales, so a
  kind *selector* in the config UI can likely reuse these existing keys
  rather than needing brand-new label strings — confirmed by reading the
  `en` file; only needs verification that `vi`/`zh`/`ko` mirror it (not
  independently checked here).

## Known-variant relevance

Two items from `PROJECT-CONTEXT.md`'s recurring-defect-class catalog are
directly relevant to how this should be built and reviewed:

1. **§9.5 FRESH-DB-BLIND SCHEMA CHANGE — directly on point.** The request
   itself poses "a new dedicated override column separate from the generic
   `config` JSON" as an option to evaluate. `playbook_practice_config` is
   defined via `CREATE TABLE IF NOT EXISTS` in `server/db.js`, and
   `DB_PATH` resolves to the shared, already-existing dashboard DB — the
   exact shape this pattern warns about. **If the team picks the dedicated-
   column route, it must ship with a guarded `ALTER TABLE … ADD COLUMN`
   (via `PRAGMA table_info`, not the old try/`SELECT`/catch probe) plus a
   `db-migration.test.js` `UPGRADE_CASES` entry seeding the legacy table
   shape** — an `IF NOT EXISTS`-only change would silently no-op on every
   existing install. This does not apply if the team instead extends the
   generic `fields`/`config` JSON blob (no `CREATE TABLE` shape change),
   which is the other option the request explicitly leaves open.

2. **§9.1 DERIVED-DUAL-VIEW — relevant in the *inverse* direction; flag
   this explicitly so QA doesn't misapply its acceptance criterion here.**
   §9.1 demands "same field, same value, across every consumer" for a
   derived value. This feature's own stated constraint is the **opposite**:
   `coach_observations.kind` is an intentional point-in-time snapshot that
   must stay frozen once written, even as the practice's *current* resolved
   kind (catalog default + override) moves on. Two legitimate "views" of
   "kind" will coexist by design — the live resolved value (catalog +
   current override, shown in the Playbook config UI) and the frozen
   historical value (stored per Observation, shown in the Feed) — and they
   are *supposed* to diverge after an override change. Whoever designs/QAs
   this should write the acceptance test as "changing the override does NOT
   change any existing Observation's stored `kind`," not "the two values
   must match."

No other named pattern (§9.2 chronology, §9.3 vacuous guards, §9.4
fix-round regression) is obviously implicated by this request as scoped,
though §9.3's guard-quality bar and §9.4's "review the fix diff like a
build" bar apply to any test/fix work here as a matter of course, not
because this request specifically triggers them.

## Provisional request type

`new-feature` (PROVISIONAL — PM makes the final call). This is new
capability, not a fix: no override mechanism for `kind`/`defaultSeverity`
exists anywhere in the current schema, engine, or UI.

## Attachments / evidence

- No screenshots, tickets, or written expected-vs-actual — this is a
  conversational feature request from the project owner. All context above
  was independently verified by reading the five files the request itself
  cites (`server/lib/playbook/practices.js`, `server/lib/playbook/engine.js`,
  `server/openapi-extra/playbook-coach.js`, `client/src/pages/PlaybookPage.tsx`,
  `client/src/lib/playbookStore.ts`) plus `server/db.js` and
  `client/src/i18n/locales/en/coach.json`; nothing in the raw request
  contradicts what's actually in the code.
- Concrete worked example given by the requester: `account-weekly-balance`
  ships `kind: "info"` (label "Reminder"); Sara wants it overridable to
  `kind: "risk"` (label "Warning") for her own instance, without changing
  the catalog default for everyone else who might run this dashboard.

## Explicit acceptance signals

The requester stated one explicit, testable "done when" (not phrased as
that exact term, but functionally one):

> "Any override must apply at fire-time so that changing your override
> later does not retroactively relabel past open/acknowledged/dismissed
> Observations."

I.e.: acceptance requires (a) a working kind (and optionally severity)
override surfaced per-practice in the Playbook config UI, (b) the Coach
engine reading the resolved override — not the bare catalog value — at the
moment it creates a new Observation, and (c) a regression test proving that
changing the override after Observations already exist leaves their stored
`kind`/`severity` unchanged.

## Open questions

### BLOCKING

None. The core behavior is unambiguous and independently verifiable against
the current code (the fire-time-snapshot constraint the requester describes
matches exactly what `engine.js` already does with the catalog's bare
`practice.kind`/`practice.defaultSeverity` — the only change is which value
feeds that same call site). No downstream stage needs a decision only Sara
can make in order to start scoping/designing this.

### Non-blocking (proceed with stated assumption)

1. **What does "per-user" mean in an app with no user-accounts concept?**
   `playbookStore.ts`'s own header comment states plainly: "this app has no
   user accounts, so there is exactly one setting for everyone" — and
   `playbook_practice_config` is a global singleton keyed only by
   `practice_id`, with no user/account dimension anywhere in the schema.
   The request's own phrasing ties the override to "that practice's
   **per-user config**, alongside its existing **user-editable** fields
   (e.g. thresholdTokens, gapThresholdPct)" — i.e., the *same* existing
   global singleton config object that today's numeric fields already live
   in, which this codebase already calls "user-editable" despite having one
   shared setting for the whole (single-operator) install.
   **Assumption: "per-user override" means an override on the existing
   global per-practice config (one override value per practice, shared
   across every connected computer for the app's one operator) — not a new
   multi-account/multi-human dimension.** If Sara actually wants distinct
   overrides for multiple *different* human users of the same install, that
   is a materially larger effort (this app has no user-identity model to
   hang it on at all) and should be called out explicitly before design
   starts.

2. **Does the override apply to every practice generically, or only to
   specific practices (e.g. just `account-weekly-balance`, the one named in
   the example)?** The catalog has no existing "is this practice's kind
   overridable" flag. Assumption: build it generically into the shared
   `fields`/config-resolution path so any current or future practice gets
   it for free — consistent with this codebase's stated design ethos ("a
   new practice is a new catalog entry, not new plumbing").

3. **Is `defaultSeverity` override actually required for v1, or is `kind`
   the real ask and severity a "nice if cheap" add-on?** The raw request
   hedges with "kind (and/or `defaultSeverity`)". Assumption: treat both as
   in scope with identical mechanics (each defaults to the practice's
   built-in value when unset), since the request explicitly names both and
   the underlying mechanism (an optional override merged at resolve-time)
   is the same for either field — but the PM/tech-plan stage should confirm
   this isn't scope creep beyond what's actually wanted for v1.

4. **Schema shape — extend the generic `fields`/`config` JSON (which today
   only validates numeric fields) vs. a new dedicated column?** The request
   explicitly frames this as something "to evaluate," not a decision
   already made. Left to the design/build stage; see Known-variant
   relevance above for the §9.5 migration obligation if a dedicated column
   is chosen.

5. **Which kind values should be selectable in the override UI — any of
   the three (`risk`/`info`/`good`), or only values "more severe" than the
   built-in default?** Nothing in the request restricts this. Assumption:
   expose all three as a free choice (matches the existing `kindLabel` i18n
   keys already shipped for all three values in all four locales), since
   the requester's own example is an upgrade (info→risk) but nothing states
   downgrades should be disallowed.

6. **Pre-existing, out-of-scope doc/code inconsistency (flagged per
   instruction, not part of this ask):** `library/knowledge/product/coach/
   coach-playbook-vocabulary.md` specifies the `kind` vocabulary as
   `opportunity/risk/reinforcement/reminder/standard`, but the shipped code
   (`practices.js`, `coach.json` `kindLabel`) actually uses `risk/info/good`.
   This override feature should be built against the **shipped** vocabulary
   (`risk/info/good`), not the vocab doc's originally-specified set — do not
   let this ticket become an implicit vocabulary reconciliation.
