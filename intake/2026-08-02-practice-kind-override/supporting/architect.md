# Architect assessment: Per-practice `kind`/`defaultSeverity` override

## 1. Affected subsystems & boundaries

This is a **single-owner change with a clean vertical slice** — no subsystem
boundary is ambiguous, which is unusual for this project's intake set and
worth stating up front.

| Layer | File | Role in this change |
|---|---|---|
| Catalog (owns knowledge/defaults) | `server/lib/playbook/practices.js` | Add an `overridable` field descriptor for `kind` (and optionally `defaultSeverity`) to the `fields` schema, or an adjacent concept; extend `resolvePracticeConfig()` to merge a non-numeric (enum-string) override — today it only merges `typeof value === "number"`, so string values are silently dropped by the existing merge loop, not rejected loudly. |
| Engine (owns fire-time write) | `server/lib/playbook/engine.js` | `evaluateSession()` / `evaluateGlobal()` — the two call sites that pass `practice.kind, practice.defaultSeverity` straight to `insertCoachObservation.run(...)`. This must change to pass the *resolved* `{ practice, config }` object's overridden kind/severity, already available in `enabledPractices` (produced by `resolveEnabledPractices()` → `resolvePracticeConfig()`), not a new lookup. |
| Storage (owns config persistence, and owns the frozen record) | `server/db.js` | `playbook_practice_config` (global singleton per practice — the config side) and `coach_observations` (the frozen-at-insert record side). No `coach_observations` schema change is implied by this feature: it already has `kind`/`severity` columns, written from whatever the engine hands it — that call site is exactly the boundary that needs to change, not the column set. |
| API contract | `server/routes/playbook.js`, `server/openapi-extra/playbook-coach.js` | `serializePractice()`, `validateConfigPatch()` need to accept and validate the new override field(s) (enum-membership check, not numeric-min check — this is new *shape* of validation, not a copy of the existing numeric one). OpenAPI schemas (`PlaybookField`, `PlaybookConfigPatchRequest`, `PlaybookPractice`) need the new field(s) documented. |
| Client store/UI | `client/src/lib/playbookStore.ts`, `client/src/pages/PlaybookPage.tsx`, `client/src/lib/types.ts` (implied — wherever `PlaybookPractice`/field patch types live) | New kind-selector control (genuinely new UI — no existing generic enum-field renderer to reuse, per the brief); `playbookStore.save()`'s patch type (`{ enabled?, config?: Record<string, number> }`) needs to accept a string-valued override, which is a type widening, not a new store. |
| i18n | `client/src/i18n/locales/{en,vi,zh,ko}/coach.json` | `kindLabel` keys already exist for `risk`/`info`/`good` in `en`; only need to confirm the other three locales mirror them (per the brief's own open item) — no new label strings needed for the selector itself if it reuses `kindLabel`. |

**Ownership is not in dispute anywhere in this slice**: the catalog still owns
the *default*, the config table still owns the *override*, the engine is
still the sole writer of `coach_observations`, and the observations table is
still the frozen record. The feature is additive to an existing, correctly-
factored pipeline — it does not require moving logic across an existing
boundary, which is the main thing that usually goes wrong in this class of
request.

## 2. Current design

Today's flow, exactly as implemented:

1. `PRACTICES` (catalog, `practices.js`) hard-codes `kind` and
   `defaultSeverity` per practice — e.g. `account-weekly-balance: kind:
   "info"`.
2. `resolvePracticeConfig(row, practice)` merges a practice's stored
   `playbook_practice_config` row over catalog defaults — but **only for
   numeric `fields`** (`typeof value === "number"`). `kind`/`defaultSeverity`
   are not part of `fields` at all today; they're read directly off the bare
   `practice` object, never through the resolve function.
3. `engine.js`'s `evaluateSession()`/`evaluateGlobal()` call
   `stmts.insertCoachObservation.run(practice.id, scopeType, scopeId,
   practice.kind, practice.defaultSeverity, ...)` — i.e., they read the
   catalog's raw `.kind`/`.defaultSeverity`, not anything that has passed
   through config resolution. This is the exact seam the request needs to
   widen.
4. `coach_observations.kind`/`severity` are then frozen forever at that row
   — nothing ever re-reads or re-writes them after insert (confirmed:
   `updateCoachObservationStatus` only touches `status`/`responded_at`).
5. `routes/playbook.js`'s `serializePractice()` re-derives the *live*
   resolved view (`resolvePracticeConfig` again, same function the engine
   uses) for `GET /api/playbook/practices` — this is already, by the
   project's own comment in `practices.js`, "the single source of truth for
   'defaults + stored overrides' both the engine … and the route … read
   through, so the two can never silently disagree."

**Established pattern this must extend, not duplicate:** `resolvePracticeConfig()`
is already this project's single-source-of-truth resolver for "catalog
default + stored override," used identically by both the write path (engine)
and the read path (API). This is the same shape the Coach/Playbook vocabulary
doc (`library/knowledge/product/coach/coach-playbook-vocabulary.md`) frames
as generalized from the Color Thresholds precedent: one resolver, every
consumer reads through it. **The only correct design is to extend this one
function to also resolve `kind`/`defaultSeverity`, and to point the engine's
insert call sites at its output instead of at `practice.kind` directly.**
Any design that has the engine special-case "if there's a kind override,
use it, else use practice.kind" as separate logic from what
`resolvePracticeConfig` already does for numeric fields would be
reintroducing exactly the two-codepaths-for-one-fact shape this project's
own §9.1 DERIVED-DUAL-VIEW pattern (and the Color-Thresholds/Playbook design
note) warns against — the resolver must remain the one place "effective
config" is computed, for both routes and engine.

The vocabulary doc (`coach-playbook-vocabulary.md` line 98) also documents a
**pre-existing, separately-known vocabulary drift**: it specifies `kind` as
`opportunity/risk/reinforcement/reminder/standard`, while shipped code uses
`risk/info/good`. The request-brief already flags this and instructs
building against the shipped set. The architect note here is narrower: this
override feature's UI/API/DB enum values must be `risk`/`info`/`good` (matching
`coach_observations.kind`'s `CHECK` constraint and `PlaybookPractice.kind`'s
OpenAPI enum) — do not let the override's own enum quietly diverge from
either the DB `CHECK` or the vocab doc a third way.

## 3. Options for storing the override

### Option A — Extend the generic `fields`/`config` JSON (recommended)

Add `kind` (and optionally `defaultSeverity`) as an `enum`-typed entry in a
practice's `fields` array (or a small adjacent `overridableEnumFields`
concept, if mixing enum and numeric shapes in one `fields` array is judged
too messy) — e.g. `{ key: "kind", type: "enum", options: ["risk","info","good"],
default: practice.kind }`. `resolvePracticeConfig()` gains a branch for
`type === "enum"` (validate membership in `options`) alongside its existing
numeric branch. No `CREATE TABLE` change; `playbook_practice_config.config`
already stores arbitrary JSON per practice, so a `kind` key is simply another
entry.

**Trade-offs:**
- (+) Zero schema risk — §9.5 FRESH-DB-BLIND SCHEMA CHANGE does not apply at
  all, because no `CREATE TABLE` body changes and no migration is needed.
- (+) Reuses the exact resolver/validate/route/store/broadcast pipeline that
  already exists for numeric fields — the "generic `fields` schema, new
  practice/new field is a catalog entry not new plumbing" ethos the catalog's
  own file header states as its design intent.
- (+) Matches the codebase's own generalization precedent (Color Thresholds
  → Playbook config, both JSON-blob-per-row, no per-setting columns).
- (-) `resolvePracticeConfig`'s per-field-type branching gets slightly more
  complex (numeric vs. enum validation), and `validateConfigPatch` in
  `routes/playbook.js` needs a matching second branch. This is real but
  small, contained to two functions already designed to be extended this way.
- (-) The OpenAPI `PlaybookField.type` enum (`["number"]` today) needs to grow
  to include `"enum"`, and `PlaybookConfigPatchRequest.config`'s
  `additionalProperties: { type: "number" }` needs to become a union
  (number or string) — a real but mechanical doc update.

### Option B — Dedicated typed column(s) on `playbook_practice_config`

Add `kind_override TEXT` (and optionally `severity_override TEXT`) as real
columns on `playbook_practice_config`, e.g. `ALTER TABLE
playbook_practice_config ADD COLUMN kind_override TEXT CHECK(kind_override IN
('risk','info','good'))`.

**Trade-offs:**
- (+) A `CHECK` constraint enforces valid enum values at the DB layer, not
  just in application code.
- (+) Slightly more explicit/discoverable in a schema dump than a JSON blob
  key.
- (-) **Directly triggers §9.5 FRESH-DB-BLIND SCHEMA CHANGE.** This project's
  own catalog is unambiguous that any `CREATE TABLE` body change needs (a) a
  guarded `ALTER TABLE … ADD COLUMN` via `PRAGMA table_info` (not the
  deprecated try/`SELECT`/catch probe) and (b) a `db-migration.test.js`
  `UPGRADE_CASES` entry seeding the pre-change table shape and asserting the
  four properties that entry demands (column exists, legacy row reads NULL,
  column is writable, second migration run is a no-op). This is not
  optional ceremony — the catalog's most recent instance of skipping it
  (`detour_dispositions.project_id`) shipped and broke every existing
  install, caught only by incidental coupling to a real shared-DB test.
- (-) Introduces a second config-storage shape (some fields live in the
  `config` JSON blob, `kind`/`severity` live in dedicated columns) for
  conceptually the same "practice config" object — a schema-level split that
  has no functional justification here (unlike, say, `enabled`, which is
  genuinely a different kind of thing and already has its own column). This
  is inconsistent with the file's own comment that `config` exists precisely
  *because* "each practice defines its own field set" — `kind` is exactly
  that kind of per-practice-definable field.
- (-) `resolvePracticeConfig()`'s return shape (`{ enabled, config }`) would
  need a third top-level member (or `kind`/`severity` folding into `config`
  anyway at the call site, undermining the point of a dedicated column).

### Option C — New dedicated override table, keyed by practice_id

A `playbook_practice_overrides` table separate from
`playbook_practice_config`, one row per practice with an override.

**Trade-offs:**
- (-) New `CREATE TABLE` — no §9.5 migration risk *for existing rows* (a
  brand-new table has no legacy shape to miss), but it's a second table doing
  the same conceptual job as `playbook_practice_config`, which is worse
  factoring than Option B, let alone Option A. No stated advantage over A or
  B; not recommended. Included only for completeness — do not pick this.

## 4. Architectural risks

1. **The single-writer seam is exactly two call sites, and both must move
   together.** `evaluateSession()` and `evaluateGlobal()` each independently
   call `insertCoachObservation.run(..., practice.kind, practice.defaultSeverity,
   ...)`. A fix that updates one and not the other is precisely the "fix
   correct for the caller that motivated it, doesn't propagate to a sibling
   caller" shape this project's own §9.4 FIX-ROUND-REGRESSION pattern names
   (N1: a fix scoped to one dimension silently missing a sibling). Any
   build/QA plan must assert **both** call sites read through the same
   resolved value, with a test exercising a global-scoped practice's
   override, not just a session-scoped one (today's only two practices
   happen to cover one of each scope, which is good test coverage if used —
   `account-weekly-balance` is global, `session-token-ceiling` is session).

2. **§9.1 DERIVED-DUAL-VIEW's INVERSE must be the acceptance test, not its
   usual form.** This is the most important thing to get right in review:
   the normal §9.1 acceptance bar ("same field, same value, across every
   consumer") is the **wrong** test here and must not be mechanically
   applied. `coach_observations.kind` (frozen, historical) and the Playbook
   config UI's live resolved kind (catalog + current override) are two
   *legitimate*, intentionally-divergent views of the same-named field —
   by design, per the requester's own explicit acceptance signal. The
   correct regression test is the opposite of the usual §9.1 shape:
   **"changing the override does NOT change any existing Observation's
   stored kind/severity."** If this project's QA/build stages default to
   applying the catalog's own named pattern by rote (find two consumers of
   `kind` → assert they match), that would actively demand the *wrong*
   behavior. This needs to be called out explicitly wherever the pattern's
   acceptance criterion gets cited in this effort's QA docs, not left as
   prose only a careful reader would connect back to the DERIVED-DUAL-VIEW
   entry.

3. **Silent-drop risk in the existing merge loop, not a new one.**
   `resolvePracticeConfig()`'s current numeric-merge loop
   (`if (typeof value === "number" && ...)`ignores any non-numeric stored
   value for a field). If Option A is implemented by simply adding a `kind`
   key to `fields` without an explicit `type` dispatch, a stored `kind`
   override would be silently dropped by the existing numeric-only branch
   (fails safe — falls back to catalog default — but silently, with no error
   surfaced to the UI). The engine/route/resolver change must add an
   explicit non-numeric branch, not rely on the numeric branch coincidentally
   working.

4. **`enabled`/`config` are patched independently at `PUT
   /practices/:id/config` today (`body.enabled === undefined ? current.enabled
   : ...`), and `config` itself is applied via `Object.assign` (a per-key
   patch, not a full replace).** Any new override key must follow this same
   partial-patch discipline: omitting `kind` from a PUT must not reset it to
   the catalog default, the same way omitting a numeric field today leaves
   it unchanged. Get this wrong and every existing numeric-field save
   silently loses its accompanying kind override.

5. **"Per-user" is a client-shared global, not a per-account setting** — this
   is already an explicit, well-reasoned non-blocking assumption in the
   request-brief and does not need re-litigating here, but the architectural
   consequence is worth stating plainly: **the override, once saved, applies
   to every practice-evaluation this install ever does, for anyone using
   this dashboard from any connected computer** — there is no per-human
   scoping possible without a much larger user-identity build the brief
   already flags as out of scope. This is a correct read of the existing
   `playbook_practice_config` schema (global singleton, no user/account
   column) — not a gap this feature introduces.

6. **Explicit scope exclusion that needs tracking, not just this prose:**
   multi-account/multi-human distinct overrides (request-brief open question
   #1) is being deliberately excluded from this round on the stated
   assumption that "per-user" means "the one shared install-wide setting."
   **This must be recorded as a PENDING/WATCH row in this effort's
   `decisions.md`** (not yet created for this intake) once the pipeline
   reaches a stage that produces one — a disclosed-but-untracked exclusion
   like this is functionally identical to an undiscovered one if nobody
   re-reads this file in three months when a second human account
   materializes. I am not creating `decisions.md` myself (out of this
   stage's scope), but flagging it explicitly so PM/tech-plan does.

## 5. Recommended approach

**Option A — extend the generic `fields`/`config` JSON with an enum-typed
field for `kind` (and optionally `defaultSeverity`), resolved through the
existing `resolvePracticeConfig()`.**

Rationale:
- It is the only option that touches zero `CREATE TABLE` bodies, so it
  carries no §9.5 FRESH-DB-BLIND SCHEMA CHANGE risk and needs no
  `db-migration.test.js` `UPGRADE_CASES` entry — a real, load-bearing
  simplicity win given this project's own history with that exact defect
  class (`detour_dispositions.project_id`, caught only by incidental test
  coupling to the real shared DB).
- It is the option that **keeps `resolvePracticeConfig()` as the single
  source of truth** for "effective practice config" that both the engine
  (write path) and the API route (read path) already share — extending it
  is strictly additive to an already-correct single-source-of-truth
  boundary, rather than introducing a second, parallel resolution path
  (which a dedicated column risks if `resolvePracticeConfig`'s return shape
  doesn't absorb it cleanly).
- It matches this codebase's own stated design ethos for this exact file
  ("a new practice is a new catalog entry, not new plumbing") and the
  Playbook's own generalization precedent from Color Thresholds.

The one piece of real engineering work this recommendation implies — and
which should be called out to whoever plans/builds this — is that
`resolvePracticeConfig()` and `validateConfigPatch()` both need a genuine
second branch (enum validation, not numeric-min validation), and the
OpenAPI `PlaybookField`/`PlaybookConfigPatchRequest` schemas need their
`type`/`additionalProperties` widened accordingly. That is normal feature
work, not a hidden architectural cost — but it's real enough that "just add
a key to fields" undersells the change slightly if read too literally.
